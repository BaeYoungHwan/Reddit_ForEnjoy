import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { context, reddit, redis } from '@devvit/web/server';
import type { T2 } from '@devvit/shared-types/tid.js';
import {
  detectorChargeKey,
  encodeLeaderboardScore,
  footprintKey,
  getKstDateString,
  itemBoardKey,
  itemSeededKey,
  leaderboardDetailKey,
  leaderboardKey,
  loadoutClaimedKey,
  parseTile,
  positionAnchorKey,
  tileMember,
  trapBoardKey,
  trapInstallerKey,
} from './core/redisKeys';
import {
  DATA_SAFETY_TTL_SECONDS,
  DETECTOR_REVEAL_RADIUS,
  FOOTPRINT_CAP_PER_MAP,
  PER_TYPE_TRAP_CAP,
  POSITION_ANCHOR_TTL_SECONDS,
  TOTAL_TRAP_CAP,
} from './core/gameConfig';
import { getMapStartPosition } from './core/maps';
import { getMysteryBoxSpawns, rollMysteryOutcome } from './core/items';
import type { Position, TrapInstance, TrapType } from '../shared/game-types';

type TrpcContext = { userId: string | undefined };

export const createContext = (): TrpcContext => ({ userId: context.userId });

const t = initTRPC.context<TrpcContext>().create();

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'userId is required but missing from context' });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

const positionSchema = z.object({ x: z.number().int(), y: z.number().int() });
const trapTypeSchema = z.enum(['slow', 'respawn', 'blind', 'reverse']);
const mapIdSchema = z.object({ mapId: z.string().min(1) });

function manhattanDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// 함정 탐지기 반경 계산 전용 — 그리드 4방향 이동 인접성 판정(manhattanDistance)과는
// 다른 기준. game.tsx의 updateFog 시야 반경 계산과 동일한 공식(대각선 포함, 정사각형 반경).
function chebyshevDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function toTrapInstances(installerFields: Record<string, string>): TrapInstance[] {
  return Object.entries(installerFields).map(([field, type]) => ({
    ...parseTile(field),
    type: type as TrapType,
  }));
}

// trap.trigger/item.pickup 공용: 위치 앵커를 읽는다. 함정/아이템 보드 조회와 서로 의존관계가
// 없어 Promise.all로 병렬 발사할 수 있도록 검증(assertAdjacent)/기록(commitPosition)과 분리했다
// (조작감 개선: 순차 Redis 왕복 4회 → 병렬 조회 1회 + 기록 1회로 축소, docs/wbs.md 72행 참조).
async function readPositionAnchor(posKey: string): Promise<{ x: number; y: number }> {
  const last = await redis.get(posKey);
  if (!last) {
    // map.getState 없이 호출됨 — 비정상 흐름이므로 오류로 처리한다.
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_SESSION' });
  }
  return parseTile(last);
}

// 인접 타일만 허용하는 이유: trap.trigger — 함정 위치를 미리 알아내는 오라클 공격 방지.
// item.pickup은 아이템 자체는 비밀이 아니지만, 같은 앵커를 공유하므로 검증도 동일하게 적용한다.
function assertAdjacent(last: { x: number; y: number }, next: { x: number; y: number }): void {
  if (manhattanDistance(last, next) > 1) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_MOVE' });
  }
}

async function commitPosition(posKey: string, x: number, y: number): Promise<void> {
  // SET에 expiration을 실어 보내 기존 SET + EXPIRE 순차 2회 왕복을 1회로 합친다.
  await redis.set(posKey, tileMember({ x, y }), {
    expiration: new Date(Date.now() + POSITION_ANCHOR_TTL_SECONDS * 1000),
  });
}

// 함정 탐지기 효과: 반경 내 함정을 별도 "스캔" API로 자유 조회하게 하면 trap.trigger의
// 오라클 방지 설계(assertAdjacent — 인접 타일만 허용)가 무의미해진다. 대신 이 조회를
// item.pickup 호출(이미 assertAdjacent로 위치가 검증된 이벤트) 결과에 얹어서, 실제로
// 탐지기 아이템이 있는 타일까지 걸어가 주웠을 때만 1회성으로 발동되게 한다.
// 본인이 설치한 함정은 제외한다 — trap.trigger가 이미 설치자 본인을 회피 처리하고
// 클라이언트도 myTraps로 항상 표시하므로(game.tsx), 여기 포함시키면 같은 함정이 두 번
// 그려지는 중복 표시가 생긴다.
async function revealNearbyTraps(
  mapId: string,
  date: string,
  center: { x: number; y: number },
  userId: string
): Promise<TrapInstance[]> {
  const boardKey = trapBoardKey(mapId, date);
  const allTraps = await redis.hGetAll(boardKey);
  return Object.entries(allTraps)
    .map(([field, raw]) => {
      const parsed = JSON.parse(raw) as { type: TrapType; installerId: string };
      return { ...parseTile(field), type: parsed.type, installerId: parsed.installerId };
    })
    .filter((trap) => trap.installerId !== userId && chebyshevDistance(trap, center) <= DETECTOR_REVEAL_RADIUS)
    .map(({ x, y, type }) => ({ x, y, type }));
}

// 해당 맵/날짜/유저의 미스터리 박스 보드를 하루 최초 1회만 고정 스폰 좌표로 채운다.
// 유저별로 독립된 보드라 한 유저의 픽업이 다른 유저의 스폰 여부에 영향을 주지 않는다
// (고정 스폰 좌표가 맵당 2곳뿐이라 전역 공유였다면 가장 먼저 도착한 유저가 하루치를
// 다 가져가 버렸을 것 — 함정과 달리 미스터리 박스는 유저마다 독립적으로 존재).
// 시딩 여부를 "필드 존재"가 아니라 전용 마커 키(itemSeededKey)로 판정해야 한다 — hSetNX만 쓰면
// item.pickup의 hDel로 지워진 필드가 다음 map.getState 호출 때 다시 채워져 버려서
// (재생성 버그) 픽업한 박스가 무한정 재획득 가능해진다.
// 보드 값 자체엔 타입을 저장하지 않는다 — 결과는 item.pickup이 픽업 시점에 rollMysteryOutcome()으로
// 결정하므로, 저장 값은 "이 타일에 미확인 박스가 있다"는 존재 표시(placeholder)일 뿐이다.
//
// map.getState(ensureMysteryBoxesSeeded)와 run.finish(아이템 보드 리셋) 양쪽에서 공유하는 시딩 로직
// (docs/design-docs/move-run-finish-bugfixes.md 1절). 보드를 먼저 채우고 마커(itemSeededKey)는
// 마지막에 세운다 — 순서를 반대로 하면(마커 먼저) hSet이 중간에 실패했을 때 "seeded=true인데
// 보드는 빈" 상태가 자정까지 고착될 수 있다. 이 순서면 중간에 끊겨도 "아직 시딩 안 됨"으로 남아
// 다음 호출이 자연 복구한다.
async function seedMysteryBoxes(mapId: string, date: string, userId: string): Promise<void> {
  const boardKey = itemBoardKey(mapId, date, userId);
  await redis.hSet(
    boardKey,
    Object.fromEntries(getMysteryBoxSpawns(mapId).map((pos) => [tileMember(pos), '1']))
  );
  await redis.expire(boardKey, DATA_SAFETY_TTL_SECONDS);
  await redis.set(itemSeededKey(mapId, date, userId), '1', {
    expiration: new Date(Date.now() + DATA_SAFETY_TTL_SECONDS * 1000),
  });
}

// PR #67 리뷰 후속(move-run-finish-bugfixes.md 8절): GET으로만 판정하고 실제 시딩(순서 보장 포함)은
// seedMysteryBoxes에 전량 위임한다 — 예전엔 여기서 SET NX로 마커를 먼저 선점한 뒤 seedMysteryBoxes를
// 불렀는데, 그러면 이 경로(가장 빈번한 호출 경로)에서만 "마커 먼저, 보드 나중"이 되어 seedMysteryBoxes
// 내부의 hSet이 실패했을 때 마커가 이미 세워진 채로 남아 자연 복구가 안 됐다(run.finish가 직접 부르는
// 경로에만 안전 순서가 적용되는 비대칭 버그). GET은 원자적 선점이 아니므로 같은 유저가 다중 탭으로
// 거의 동시에 호출하면 둘 다 재시딩을 시도할 수 있지만, getMysteryBoxSpawns가 순수함수라 항상 같은
// 데이터로 멱등 수렴한다(itemSeededKey가 유저별 독립 키라 다른 유저와는 애초에 경쟁하지 않음) — run.finish의
// 즉시 재시딩이 이미 감수 중인 다중 탭 리스크의 부분집합(노출 창이 더 좁음)이라 별도 대응하지 않는다.
async function ensureMysteryBoxesSeeded(mapId: string, date: string, userId: string): Promise<void> {
  const alreadySeeded = await redis.get(itemSeededKey(mapId, date, userId));
  if (alreadySeeded) return;
  await seedMysteryBoxes(mapId, date, userId);
}

export const appRouter = t.router({
  // 리더보드에서 "내 순위" 강조(splash.tsx)를 위해 클라이언트가 자기 userId를 알아야 해서
  // 추가한 최소 엔드포인트 — leaderboard.get이 이미 entry마다 userId를 내려주므로, 이 값과
  // 비교해서 어떤 항목이 본인인지 클라이언트가 직접 판단한다.
  user: t.router({
    me: protectedProcedure.query(({ ctx }) => ({ userId: ctx.userId })),
  }),

  map: t.router({
    getState: protectedProcedure.input(mapIdSchema).query(async ({ ctx, input }) => {
      const date = getKstDateString();
      const { mapId } = input;

      // 미스터리 박스는 유저별 독립 보드 — 밟는 위치는 비밀이 아니지만(오라클 방지 대상 아님),
      // 스폰 좌표가 소수라 전역 공유하면 먼저 도착한 유저가 하루치를 다 가져가 버린다.
      await ensureMysteryBoxesSeeded(mapId, date, ctx.userId);

      const [footprintMembers, myTrapFields, mysteryBoxFields, allTrapFields] = await Promise.all([
        redis.zRange(footprintKey(mapId, date), 0, -1),
        redis.hGetAll(trapInstallerKey(mapId, date, ctx.userId)),
        redis.hGetAll(itemBoardKey(mapId, date, ctx.userId)),
        redis.hGetAll(trapBoardKey(mapId, date)),
      ]);

      // NX: 세션 중 map.getState가 재호출돼도(탭 재포커스 등) 이미 진행 중인 앵커를 시작 좌표로
      // 되돌리지 않는다 — 되돌리면 이후 정상 이동까지 trap.trigger에서 INVALID_MOVE로 거부된다.
      // 새 런을 시작할 때는 run.finish가 앵커를 지우므로 그때만 다시 시작 좌표로 초기화된다.
      const start = getMapStartPosition(mapId);
      const posKey = positionAnchorKey(mapId, date, ctx.userId);
      await redis.set(posKey, tileMember(start), { nx: true });
      await redis.expire(posKey, POSITION_ANCHOR_TTL_SECONDS);

      // 2026-07-14 오라클 방지 완화 결정(임소리, 함정 탐지기 확장 논의): 이전엔 다른 유저가
      // 설치한 함정 위치를 아예 안 내려줘서 화면에 전혀 안 보였다 — "길인 줄 알고 걸었는데
      // 함정이었다"는 억울함 피드백으로, 위치는 공개하고(박스+물음표 마커) 종류만 비공개로
      // 완화한다. myTraps(본인 설치, 타입 포함)와 달리 타입은 절대 포함하지 않는다.
      const otherTraps: Position[] = Object.entries(allTrapFields)
        .filter(([, raw]) => (JSON.parse(raw) as { installerId: string }).installerId !== ctx.userId)
        .map(([field]) => parseTile(field));

      return {
        date,
        footprints: footprintMembers.map((m) => parseTile(m.member)),
        myTraps: toTrapInstances(myTrapFields),
        // 타입 없이 좌표만 반환 — 먹기 전엔 아이템/함정 여부조차 알 수 없어야 한다.
        mysteryBoxes: Object.keys(mysteryBoxFields).map((field) => parseTile(field)),
        otherTraps,
      };
    }),
  }),

  footprint: t.router({
    record: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), tiles: z.array(positionSchema) }))
      .mutation(async ({ input }) => {
        const { mapId, tiles } = input;
        if (tiles.length === 0) {
          return { recorded: 0 };
        }

        const date = getKstDateString();
        const key = footprintKey(mapId, date);
        const now = Date.now();
        await redis.zAdd(key, ...tiles.map((tile) => ({ member: tileMember(tile), score: now })));
        // ZADD는 기존 멤버면 스코어만 갱신(dedup)하므로, 트림 한 번으로 "최근 N개 서로 다른 타일"이 항상 보장된다.
        await redis.zRemRangeByRank(key, 0, -(FOOTPRINT_CAP_PER_MAP + 1));
        await redis.expire(key, DATA_SAFETY_TTL_SECONDS);

        return { recorded: tiles.length };
      }),
  }),

  trap: t.router({
    install: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), type: trapTypeSchema, x: z.number().int(), y: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const { mapId, type, x, y } = input;
        const date = getKstDateString();
        const boardKey = trapBoardKey(mapId, date);
        const installerKey = trapInstallerKey(mapId, date, ctx.userId);
        const field = tileMember({ x, y });

        const current = await redis.hGetAll(installerKey);
        const currentEntries = Object.entries(current);

        if (currentEntries.length >= TOTAL_TRAP_CAP) {
          return { success: false, reason: 'TOTAL_CAP_REACHED' as const, myTraps: toTrapInstances(current) };
        }
        const typeCount = currentEntries.filter(([, t]) => t === type).length;
        if (typeCount >= PER_TYPE_TRAP_CAP[type]) {
          return { success: false, reason: 'TYPE_CAP_REACHED' as const, myTraps: toTrapInstances(current) };
        }

        // HSETNX로 타일 점유를 원자적으로 판정 — 두 유저가 같은 타일에 거의 동시에 설치해도 하나만 성공한다.
        const placed = await redis.hSetNX(
          boardKey,
          field,
          JSON.stringify({ type, installerId: ctx.userId, installedAt: Date.now() })
        );
        if (!placed) {
          return { success: false, reason: 'TILE_OCCUPIED' as const, myTraps: toTrapInstances(current) };
        }

        const tx = await redis.watch(installerKey);
        await tx.multi();
        await tx.hSet(installerKey, { [field]: type });
        await tx.expire(boardKey, DATA_SAFETY_TTL_SECONDS);
        await tx.expire(installerKey, DATA_SAFETY_TTL_SECONDS);
        const results = await tx.exec();

        if (!results || results.length === 0) {
          // 동일 유저의 동시 재설치 레이스로 트랜잭션이 취소된 경우, 위에서 심은 보드 엔트리를 롤백한다.
          await redis.hDel(boardKey, [field]);
          return { success: false, reason: 'RETRY' as const, myTraps: toTrapInstances(current) };
        }

        const updated = await redis.hGetAll(installerKey);
        return { success: true, myTraps: toTrapInstances(updated) };
      }),

    trigger: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), x: z.number().int(), y: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const { mapId, x, y } = input;
        const date = getKstDateString();
        const posKey = positionAnchorKey(mapId, date, ctx.userId);
        const boardKey = trapBoardKey(mapId, date);
        const field = tileMember({ x, y });

        const [last, raw] = await Promise.all([readPositionAnchor(posKey), redis.hGet(boardKey, field)]);
        assertAdjacent(last, { x, y });
        await commitPosition(posKey, x, y);

        if (!raw) {
          return { hit: false as const };
        }

        const trap = JSON.parse(raw) as { type: TrapType; installerId: string; installedAt: number };
        if (trap.installerId === ctx.userId) {
          // 설치자 본인은 자기 함정을 회피한다 — 소모되지 않음.
          return { hit: false as const };
        }

        // hDel 반환값(실제로 지운 개수)으로 게이팅한다 — hGet에서 봤다는 사실만으로 hit:true를
        // 반환하면, 같은 함정 타일에 두 유저가 거의 동시에 접근했을 때 둘 다 아직 지워지기 전의
        // hGet 스냅샷을 보고 둘 다 hit:true를 받는 이중발동이 가능해진다(오라클 방지 설계와는
        // 별개의 레이스 — 단일 소모 자원의 동시성 문제, docs/design-docs/move-run-finish-bugfixes.md
        // 2절). trapInstallerKey는 설치자 UI(myTraps) 표시용 부기일 뿐이라 게이팅 기준에서 제외한다
        // (실패해도 DATA_SAFETY_TTL_SECONDS로 자연 소멸).
        const deleted = await redis.hDel(boardKey, [field]);
        await redis.hDel(trapInstallerKey(mapId, date, trap.installerId), [field]);
        if (deleted === 0) {
          return { hit: false as const };
        }

        if (trap.type === 'respawn') {
          const start = getMapStartPosition(mapId);
          await commitPosition(posKey, start.x, start.y);
        }

        return { hit: true as const, type: trap.type };
      }),
  }),

  item: t.router({
    pickup: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), x: z.number().int(), y: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const { mapId, x, y } = input;
        const date = getKstDateString();
        const posKey = positionAnchorKey(mapId, date, ctx.userId);
        const boardKey = itemBoardKey(mapId, date, ctx.userId);
        const field = tileMember({ x, y });

        const [last, raw] = await Promise.all([readPositionAnchor(posKey), redis.hGet(boardKey, field)]);
        assertAdjacent(last, { x, y });
        await commitPosition(posKey, x, y);

        if (!raw) {
          return { picked: false as const };
        }

        // HDEL의 반환값(실제로 지운 개수)을 판정 기준으로 삼는다 — 보드가 유저별로 독립이라
        // 다른 유저와 경쟁할 일은 없지만, 같은 유저가 동일 요청을 중복 전송해도 hDel은
        // 원자적이라 정확히 한 번만 1을 받는다.
        const deleted = await redis.hDel(boardKey, [field]);
        if (deleted === 0) {
          return { picked: false as const };
        }

        // 미스터리 박스: 저장된 값엔 타입이 없다 — 여기서 결과를 굴려서 처음으로 결정한다.
        const rolled = rollMysteryOutcome();

        if (rolled.outcome === 'trap') {
          // 스폰형 함정: 설치형(trap.trigger)과 달리 설치자 개념이 없으므로 개수 제한/자기
          // 회피 로직 대상이 아니다 — 픽업자 본인에게 그 자리에서 즉시 발동.
          if (rolled.type === 'respawn') {
            const start = getMapStartPosition(mapId);
            await commitPosition(posKey, start.x, start.y);
          }
          return { picked: true as const, outcome: 'trap' as const, type: rolled.type };
        }

        // 탐지기: 반경 계산은 더 이상 픽업 시점에 하지 않는다(Z 발동 시점 라이브 스캔으로
        // 통일 — useDetector 참고). 여기서는 "충전 1회 획득"만 기록한다.
        if (rolled.type === 'detector') {
          await redis.incrBy(detectorChargeKey(mapId, date, ctx.userId), 1);
        }

        return { picked: true as const, outcome: 'item' as const, type: rolled.type };
      }),

    // 로드아웃 지급은 클라이언트 로컬(localStorage)에서만 처리돼 서버가 몰랐다 — 탐지기는
    // 1회성을 서버가 강제해야 하는 민감 정보라, 게임 시작 시 이 mutation으로 서버에도 알린다.
    // 쉴드/손전등은 서버 개입이 필요 없어(이미 100% 클라이언트 신뢰 방식) 그대로 통과시킨다.
    claimLoadout: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), loadoutId: z.enum(['trapDetector', 'shield', 'flashlight']) }))
      .mutation(async ({ ctx, input }) => {
        const { mapId, loadoutId } = input;
        if (loadoutId !== 'trapDetector') {
          return { granted: true as const };
        }

        const date = getKstDateString();
        const claimKey = loadoutClaimedKey(mapId, date, ctx.userId);
        const firstClaim = await redis.set(claimKey, '1', {
          nx: true,
          expiration: new Date(Date.now() + DATA_SAFETY_TTL_SECONDS * 1000),
        });
        if (!firstClaim) {
          // 이미 이번 세션/하루에 클레임을 마쳤음 — 재호출(새로고침 등)로 충전이 중복 쌓이지 않게 막는다.
          return { granted: false as const };
        }

        await redis.incrBy(detectorChargeKey(mapId, date, ctx.userId), 1);
        return { granted: true as const };
      }),

    // 함정 탐지기 발동(Z 시점 라이브 스캔) — 로드아웃/미스터리 박스 두 경로 공통 창구.
    // x, y를 입력받지 않는다: 매 이동(trap.trigger)마다 갱신돼온 위치 앵커를 그대로 신뢰해도
    // 안전하다(assertAdjacent가 매번 인접 타일만 허용해왔으므로 항상 최신 실좌표).
    useDetector: protectedProcedure.input(mapIdSchema).mutation(async ({ ctx, input }) => {
      const { mapId } = input;
      const date = getKstDateString();
      const posKey = positionAnchorKey(mapId, date, ctx.userId);
      const chargeKey = detectorChargeKey(mapId, date, ctx.userId);

      // GET으로 읽고 JS에서 검사한 뒤 별도로 차감하면 동시 요청 사이에 TOCTOU 레이스가 생겨
      // 충전 1개로 2회 이상 발동시킬 수 있다(오라클 방지 설계 무력화). INCRBY 자체가 원자적/
      // 전순서이므로 "먼저 차감 → 결과가 음수면 그 차감이 무허가였다는 뜻이니 롤백" 순서로
      // 바꾸면 별도 트랜잭션 없이 동시 요청에서도 정확히 남은 충전 수만큼만 성공한다.
      // 위치 조회는 차감과 병렬로 묶지 않는다 — 병렬로 묶으면 위치 조회 실패(NO_SESSION 등)
      // 시 Promise.all이 즉시 reject해 아래 롤백 분기를 못 타면서도 incrBy(-1)는 이미 발사돼
      // 실행되므로, 아무 효과도 없이 충전만 사라지는 문제가 생긴다. 차감을 먼저 확정한 뒤
      // 위치 조회/스캔을 수행하고, 그 이후 어떤 단계든 실패하면 실제로 발동되지 않았으므로
      // 충전을 반드시 복구한다.
      const remaining = await redis.incrBy(chargeKey, -1);
      if (remaining < 0) {
        await redis.incrBy(chargeKey, 1); // 롤백 — 충전 없음
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_CHARGE' });
      }

      try {
        const position = await readPositionAnchor(posKey);
        const revealedTraps = await revealNearbyTraps(mapId, date, position, ctx.userId);
        return { revealedTraps };
      } catch (err) {
        await redis.incrBy(chargeKey, 1); // 롤백 — 실제로 발동되지 않았음
        throw err;
      }
    }),
  }),

  // move.arrive: trap.trigger + item.pickup 통합 API(docs/design-docs/move-api-unification.md).
  // 연속 이동 시 클라이언트가 두 API를 각자 SequentialDispatcher로 직렬화하면서 요청이 밀려
  // 판정이 지연 반영되던 문제(실서버 RTT>0에서만 재현)의 근본 원인이 "이동 1칸당 서버 왕복 2회"였다.
  // 위치 앵커 검증/커밋을 1회로 합치고 함정/아이템 판정을 병렬로 조회해 한 응답에 함께 반환한다.
  // 마이그레이션 1단계(서버 PR)까지만 진행 — trap.trigger/item.pickup은 클라이언트가 전환할 때까지
  // 그대로 유지한다(구버전 세션 대응, 문서 5절 4단계 마이그레이션 참고).
  move: t.router({
    arrive: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), x: z.number().int(), y: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const { mapId, x, y } = input;
        const date = getKstDateString();
        const posKey = positionAnchorKey(mapId, date, ctx.userId);
        const trapBoard = trapBoardKey(mapId, date);
        const itemBoard = itemBoardKey(mapId, date, ctx.userId);
        const field = tileMember({ x, y });

        // RT1: 위치 앵커 + 함정보드 + 아이템보드 조회는 서로 의존관계가 없어 3방향 병렬. 위치는
        // 아직 커밋하지 않는다 — 최종 목적지(그대로 vs respawn 시작 좌표)를 알기 전에 커밋하면
        // respawn 타일마다 같은 키에 두 번 쓰는 낭비가 생긴다(docs/design-docs/move-run-finish-bugfixes.md 2절).
        const [last, rawTrap, rawItem] = await Promise.all([
          readPositionAnchor(posKey),
          redis.hGet(trapBoard, field),
          redis.hGet(itemBoard, field),
        ]);
        assertAdjacent(last, { x, y }); // 오라클 방지 — 커밋 여부와 무관하게 앵커 검증은 여기서 끝난다.

        let trapType: TrapType | undefined;
        let trapInstallerId: string | undefined;
        if (rawTrap) {
          const parsed = JSON.parse(rawTrap) as { type: TrapType; installerId: string };
          if (parsed.installerId !== ctx.userId) {
            // 설치자 본인은 자기 함정을 회피한다 — 소모되지 않음(trap.trigger와 동일 규칙).
            trapType = parsed.type;
            trapInstallerId = parsed.installerId;
          }
        }
        // 미스터리 박스: 결과는 픽업이 실제로 성사됐는지와 무관하게 미리 굴려도 안전하다(인메모리,
        // 부수효과 없음) — 아래에서 hDel 성공 여부로 실제 픽업 성사만 별도 확정한다.
        const rolled = rawItem ? rollMysteryOutcome() : null;

        // RT2(조건부): 소모할 게 있는 것만 개별 실행. Promise.allSettled로 서로의 실패를 격리한다 —
        // Promise.all로 묶으면 한쪽이 일시 실패했을 때 이미 성공한 다른 쪽 hDel(Redis에는 이미 반영됨)의
        // 결과를 응답으로 돌려주지 못하고 통째로 에러가 돼, 소모된 자원이 유실된 것처럼 보인다.
        const [trapBoardResult, , itemResult] = await Promise.allSettled([
          trapType ? redis.hDel(trapBoard, [field]) : Promise.resolve(0),
          // trapInstallerKey는 설치자 UI(myTraps) 표시용 부기일 뿐이라 게이팅에 쓰지 않는다
          // (trap.trigger와 동일 — 실패해도 DATA_SAFETY_TTL_SECONDS로 자연 소멸).
          trapType ? redis.hDel(trapInstallerKey(mapId, date, trapInstallerId!), [field]) : Promise.resolve(0),
          rawItem ? redis.hDel(itemBoard, [field]) : Promise.resolve(0),
        ]);

        // 게이팅: hGet 스냅샷이 아니라 hDel의 실제 반환값(fulfilled && count>0)으로만 소모 성사를
        // 인정한다 — 이전엔 hGet에서 봤다는 사실만으로 hit:true를 반환해, 같은 함정 타일에 두 유저가
        // 거의 동시에 접근하면 둘 다 hit:true를 받는 이중발동이 가능했다.
        const trapDeleted = trapBoardResult.status === 'fulfilled' ? trapBoardResult.value : 0;
        const itemDeleted = itemResult.status === 'fulfilled' ? itemResult.value : 0;

        const trap =
          trapType && trapDeleted > 0 ? ({ hit: true, type: trapType } as const) : ({ hit: false } as const);
        const item =
          rawItem && itemDeleted > 0 && rolled
            ? rolled.outcome === 'trap'
              ? ({ picked: true, outcome: 'trap', type: rolled.type } as const)
              : ({ picked: true, outcome: 'item', type: rolled.type } as const)
            : ({ picked: false } as const);

        const needsRespawn =
          (trap.hit && trap.type === 'respawn') ||
          (item.picked && item.outcome === 'trap' && item.type === 'respawn');
        const needsDetectorCharge = item.picked && item.outcome === 'item' && item.type === 'detector';

        // RT3: 위치 커밋은 이 시점에 단 1회만 — 목적지를 미리 정해서 쓰므로 이중쓰기가 없다.
        const destination = needsRespawn ? getMapStartPosition(mapId) : { x, y };
        await Promise.all([
          commitPosition(posKey, destination.x, destination.y),
          needsDetectorCharge ? redis.incrBy(detectorChargeKey(mapId, date, ctx.userId), 1) : Promise.resolve(),
        ]);

        return { trap, item };
      }),
  }),

  run: t.router({
    finish: protectedProcedure
      .input(
        z.object({
          mapId: z.string().min(1),
          steps: z.number().int().nonnegative(),
          clearTimeMs: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { mapId, steps, clearTimeMs } = input;
        const date = getKstDateString();
        const key = leaderboardKey(mapId, date);
        const score = encodeLeaderboardScore(steps, clearTimeMs);

        const prevScore = await redis.zScore(key, ctx.userId);
        const isNewRecord = prevScore === undefined || score < prevScore;
        if (isNewRecord) {
          // 스코어는 랭킹 정렬 전용 인코딩 값이라 화면에 표시할 원본 걸음 수/시간은
          // leaderboardDetailKey에 따로 보관한다(leaderboard.get 참고). 두 키가 원자적 트랜잭션으로
          // 묶여있지 않아 동시 요청 사이 레이스가 있을 수 있는데, detail을 zAdd보다 먼저 써두면
          // "zRange가 새 스코어를 보는 시점"엔 detail이 이미 존재할 가능성이 높아져 그 창이 줄어든다.
          const detailKey = leaderboardDetailKey(mapId, date);
          await redis.hSet(detailKey, { [ctx.userId]: JSON.stringify({ steps, clearTimeMs }) });
          await redis.expire(detailKey, DATA_SAFETY_TTL_SECONDS);
          await redis.zAdd(key, { member: ctx.userId, score });
          await redis.expire(key, DATA_SAFETY_TTL_SECONDS);
        }

        const rank = await redis.zRank(key, ctx.userId);
        // 런 종료 — 위치 앵커를 지우고 유저별 아이템 보드를 즉시 재시딩한다(docs/design-docs/
        // move-run-finish-bugfixes.md 1절). 예전엔 itemBoardKey/itemSeededKey를 삭제만 하고 다음
        // map.getState가 재시딩하길 기다렸는데(지연 재시딩), 다중 탭 환경에서 동시 map.getState의
        // 시딩과 인터리빙되면 "itemSeededKey는 존재(재시딩 영구 차단) + itemBoardKey는 빈 채"인
        // 영구 빈 보드가 재현될 수 있었다. seedMysteryBoxes는 항상 같은 최종 데이터(고정 스폰 좌표)를
        // 쓰는 멱등 함수라, ensureMysteryBoxesSeeded와 동시에 실행돼도 트랜잭션 없이 안전하게 수렴한다.
        // isNewRecord 여부와 무관하게 항상 실행 — 새로고침만 하고 이 mutation이 호출 안 된 경우는
        // 애초에 이 코드를 안 타므로 "정상 골인일 때만 리셋" 조건이 자연히 만족된다.
        // ⚠️ detectorChargeKey/loadoutClaimedKey 리셋 여부는 밸런스 판단이 필요해 미정(item-board-reset.md
        // 4절) — 이번 변경 범위에서는 건드리지 않는다.
        //
        // 리더보드 기록(zAdd/hSet)은 이미 위에서 커밋됐으므로, 여기서 실패해도 rank/isNewRecord
        // 응답까지 잃지 않도록 try/catch로 감싼다 — 실패를 그대로 던지면 이미 세운 기록의 응답이
        // 통째로 유실되고, 클라이언트가 재시도하면 score가 이미 같아 isNewRecord가 잘못 false로
        // 계산된다(move-run-finish-bugfixes.md 3절).
        try {
          await Promise.all([
            redis.del(positionAnchorKey(mapId, date, ctx.userId)),
            seedMysteryBoxes(mapId, date, ctx.userId),
          ]);
        } catch (err) {
          console.error(`run.finish: 위치 앵커/아이템 보드 정리 실패 (userId=${ctx.userId}, mapId=${mapId})`, err);
        }
        return { rank: (rank ?? 0) + 1, isNewRecord };
      }),
  }),

  leaderboard: t.router({
    get: t.procedure.input(mapIdSchema).query(async ({ input }) => {
      const date = getKstDateString();
      const entries = await redis.zRange(leaderboardKey(input.mapId, date), 0, -1, { by: 'rank' });
      const details = await redis.hGetAll(leaderboardDetailKey(input.mapId, date));
      // 리더보드에 Reddit userId를 그대로 노출하지 않도록 표시용 username을 조회한다.
      // reddit.getUserById의 reject 여부는 devvit SDK 타입에 문서화되어 있지 않아(내부 API
      // 실패 가능성 배제 불가), Promise.all 대신 allSettled로 개별 실패를 격리한다.
      // 탈퇴/정지 계정(fulfilled + undefined)과 조회 실패(rejected) 모두 userId로 폴백한다.
      const userResults = await Promise.allSettled(
        entries.map((entry) => reddit.getUserById(entry.member as T2))
      );
      return {
        entries: entries.map((entry, index) => {
          const result = userResults[index];
          if (result?.status === 'rejected') {
            console.error(`leaderboard.get: getUserById 실패 (userId=${entry.member})`, result.reason);
          }
          const username = result?.status === 'fulfilled' ? result.value?.username : undefined;
          // detail 해시는 스코어와 별도 쓰기라 이론상 순간적으로 어긋날 수 있어(레이스), 없으면
          // 0으로 방어적으로 폴백한다. entry.score는 steps*TIME_SLOT_MS+clearTimeMs로 인코딩된
          // 정렬 전용 값이라 그대로 clearTimeMs 자리에 쓰면 터무니없이 큰 시간이 표시된다 —
          // 실제로 이 폴백 자체가 버그였던 적이 있어(리뷰에서 발견) 반드시 0으로 폴백해야 한다.
          const rawDetail = details[entry.member];
          const detail = rawDetail ? (JSON.parse(rawDetail) as { steps: number; clearTimeMs: number }) : null;
          return {
            userId: entry.member,
            username: username ?? entry.member,
            steps: detail?.steps ?? 0,
            clearTimeMs: detail?.clearTimeMs ?? 0,
            rank: index + 1,
          };
        }),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

// 테스트/서버 내부 호출용 — HTTP 왕복 없이 라우터를 직접 호출할 때 사용.
export const createCaller = t.createCallerFactory(appRouter);
