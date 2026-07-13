import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { context, reddit, redis } from '@devvit/web/server';
import type { T2 } from '@devvit/shared-types/tid.js';
import {
  encodeLeaderboardScore,
  footprintKey,
  getKstDateString,
  itemBoardKey,
  itemSeededKey,
  leaderboardDetailKey,
  leaderboardKey,
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
import type { TrapInstance, TrapType } from '../shared/game-types';

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
// 시딩 여부를 "필드 존재"가 아니라 전용 마커 키(NX)로 판정해야 한다 — hSetNX만 쓰면
// item.pickup의 hDel로 지워진 필드가 다음 map.getState 호출 때 다시 채워져 버려서
// (재생성 버그) 픽업한 박스가 무한정 재획득 가능해진다. 마커 키는 map.getState가 이미
// 위치 앵커 초기화에 쓰는 SET NX 1회성 패턴(아래 posKey 초기화 참고)과 동일하다.
// 보드 값 자체엔 타입을 저장하지 않는다 — 결과는 item.pickup이 픽업 시점에 rollMysteryOutcome()으로
// 결정하므로, 저장 값은 "이 타일에 미확인 박스가 있다"는 존재 표시(placeholder)일 뿐이다.
async function ensureMysteryBoxesSeeded(mapId: string, date: string, userId: string): Promise<void> {
  const seededKey = itemSeededKey(mapId, date, userId);
  const firstSeed = await redis.set(seededKey, '1', { nx: true });
  if (!firstSeed) return;

  const boardKey = itemBoardKey(mapId, date, userId);
  await redis.hSet(
    boardKey,
    Object.fromEntries(getMysteryBoxSpawns(mapId).map((pos) => [tileMember(pos), '1']))
  );
  await redis.expire(boardKey, DATA_SAFETY_TTL_SECONDS);
  await redis.expire(seededKey, DATA_SAFETY_TTL_SECONDS);
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

      const [footprintMembers, myTrapFields, mysteryBoxFields] = await Promise.all([
        redis.zRange(footprintKey(mapId, date), 0, -1),
        redis.hGetAll(trapInstallerKey(mapId, date, ctx.userId)),
        redis.hGetAll(itemBoardKey(mapId, date, ctx.userId)),
      ]);

      // NX: 세션 중 map.getState가 재호출돼도(탭 재포커스 등) 이미 진행 중인 앵커를 시작 좌표로
      // 되돌리지 않는다 — 되돌리면 이후 정상 이동까지 trap.trigger에서 INVALID_MOVE로 거부된다.
      // 새 런을 시작할 때는 run.finish가 앵커를 지우므로 그때만 다시 시작 좌표로 초기화된다.
      const start = getMapStartPosition(mapId);
      const posKey = positionAnchorKey(mapId, date, ctx.userId);
      await redis.set(posKey, tileMember(start), { nx: true });
      await redis.expire(posKey, POSITION_ANCHOR_TTL_SECONDS);

      return {
        date,
        footprints: footprintMembers.map((m) => parseTile(m.member)),
        myTraps: toTrapInstances(myTrapFields),
        // 타입 없이 좌표만 반환 — 먹기 전엔 아이템/함정 여부조차 알 수 없어야 한다.
        mysteryBoxes: Object.keys(mysteryBoxFields).map((field) => parseTile(field)),
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

        await redis.hDel(boardKey, [field]);
        await redis.hDel(trapInstallerKey(mapId, date, trap.installerId), [field]);

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

        if (rolled.type === 'detector') {
          const revealedTraps = await revealNearbyTraps(mapId, date, { x, y }, ctx.userId);
          return { picked: true as const, outcome: 'item' as const, type: rolled.type, revealedTraps };
        }

        return { picked: true as const, outcome: 'item' as const, type: rolled.type };
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
          await redis.zAdd(key, { member: ctx.userId, score });
          await redis.expire(key, DATA_SAFETY_TTL_SECONDS);
          // 스코어는 랭킹 정렬 전용 인코딩 값이라 화면에 표시할 원본 걸음 수/시간은
          // leaderboardDetailKey에 따로 보관한다 (leaderboard.get 참고).
          const detailKey = leaderboardDetailKey(mapId, date);
          await redis.hSet(detailKey, { [ctx.userId]: JSON.stringify({ steps, clearTimeMs }) });
          await redis.expire(detailKey, DATA_SAFETY_TTL_SECONDS);
        }

        const rank = await redis.zRank(key, ctx.userId);
        // 런 종료 — 다음 map.getState가 (NX로) 위치 앵커를 다시 시작 좌표로 초기화할 수 있도록 지운다.
        await redis.del(positionAnchorKey(mapId, date, ctx.userId));
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
          // 0/스코어값으로 방어적으로 폴백한다 — 화면이 깨지는 것보단 낫다.
          const rawDetail = details[entry.member];
          const detail = rawDetail ? (JSON.parse(rawDetail) as { steps: number; clearTimeMs: number }) : null;
          return {
            userId: entry.member,
            username: username ?? entry.member,
            steps: detail?.steps ?? 0,
            clearTimeMs: detail?.clearTimeMs ?? entry.score,
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
