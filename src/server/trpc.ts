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
  itemSeedGenerationKey,
  leaderboardDetailKey,
  leaderboardKey,
  loadoutClaimedKey,
  moveFailureStreakKey,
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
  STUCK_SESSION_FAILURE_THRESHOLD,
  TOTAL_TRAP_CAP,
} from './core/gameConfig';
import { getMapExitPosition, getMapStartPosition } from './core/maps';
import { getMysteryBoxSpawns, rollMysteryOutcome } from './core/items';
import type { ItemType, Position, TrapInstance, TrapType } from '../shared/game-types';

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

// assertAdjacent 실패 횟수를 카운터에 기록한다(docs/design-docs/position-anchor-permanent-lock.md).
// 정상 플레이에서는 거의 없는 이벤트라, 이 카운터가 쌓인 세션은 위치 앵커가 실제로 얼어붙어
// 자력 복구가 불가능한 상태라는 신호로 run.finish가 참고한다. 실패 경로에서만 추가 왕복이
// 생기고(성공 경로는 그대로), assertAdjacent 자체는 순수 함수로 유지해 기존 호출부와의 계약을
// 그대로 지킨다.
async function assertAdjacentTracked(
  streakKey: string,
  last: { x: number; y: number },
  next: { x: number; y: number }
): Promise<void> {
  try {
    assertAdjacent(last, next);
  } catch (err) {
    try {
      await redis.incrBy(streakKey, 1);
      await redis.expire(streakKey, POSITION_ANCHOR_TTL_SECONDS);
    } catch (trackingErr) {
      // 실패 스트릭 기록 자체가 실패해도(드문 Redis 일시 오류 등) 원래 에러(INVALID_MOVE 등)를
      // 가리면 안 된다 — run.finish의 리셋 블록과 동일한 원칙(부가 효과 실패가 응답 계약을 깨지
      // 않게 함, /review 79 지적).
      console.error(`assertAdjacentTracked: 실패 스트릭 기록 실패 (streakKey=${streakKey})`, trackingErr);
    }
    throw err;
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
//
// trapBoardKey의 hash 원시값({field: JSON})을 {x,y,type,installerId}[]로 파싱하는 공통 헬퍼.
// revealNearbyTraps(반경+거리 필터)와 map.getState의 otherTraps(타입 제거, 거리 필터 없음) 양쪽이
// 같은 원시 스키마를 다른 방식으로 가공만 할 뿐이라 파싱 자체를 여기로 모았다 — 예전엔 두 곳에
// 각각 JSON.parse가 따로 있어서, trapBoardKey 저장 스키마가 바뀌면 한쪽만 갱신되고 다른 쪽은
// 방치될 위험이 있었다(2026-07-14 PR#69 리뷰 지적).
function parseInstalledTraps(
  rawFields: Record<string, string>
): Array<{ x: number; y: number; type: TrapType; installerId: string }> {
  return Object.entries(rawFields).map(([field, raw]) => {
    const parsed = JSON.parse(raw) as { type: TrapType; installerId: string };
    return { ...parseTile(field), type: parsed.type, installerId: parsed.installerId };
  });
}

// 2026-07-14 임소리(서버 3번): 기존엔 설치형 함정(trapBoardKey)만 탐지 대상이었다 — 스폰형
// 미스터리 박스는 픽업 전까지 결과가 안 정해져 있어서 애초에 "탐지"가 불가능했다. 서버 2번
// (스폰 시점 미리 굴리기)으로 저장 값에 이미 결과가 들어있게 됐으므로, 이 유저 본인의
// 미스터리 박스 보드(itemBoardKey)도 같이 스캔해 outcome이 'trap'인 것만 반경 내 대상에
// 합친다. 다른 유저의 미스터리 박스 보드는 안 본다 — 애초에 미스터리 박스는 유저별 독립
// 보드라(§ ensureMysteryBoxesSeeded) "다른 유저 화면의 박스"라는 개념 자체가 없다(내가 아직
// 안 먹은 박스만 내 보드에 존재).
async function revealNearbyTraps(
  mapId: string,
  date: string,
  center: { x: number; y: number },
  userId: string
): Promise<TrapInstance[]> {
  const [allTraps, myMysteryBoxes] = await Promise.all([
    redis.hGetAll(trapBoardKey(mapId, date)),
    redis.hGetAll(itemBoardKey(mapId, date, userId)),
  ]);

  const installedTraps = parseInstalledTraps(allTraps)
    .filter((trap) => trap.installerId !== userId && chebyshevDistance(trap, center) <= DETECTOR_REVEAL_RADIUS)
    .map(({ x, y, type }) => ({ x, y, type }));

  const spawnedTraps = Object.entries(myMysteryBoxes)
    .map(([field, raw]) => ({ ...parseTile(field), rolled: JSON.parse(raw) as { outcome: string; type: string } }))
    .filter(
      (box) => box.rolled.outcome === 'trap' && chebyshevDistance(box, center) <= DETECTOR_REVEAL_RADIUS
    )
    .map(({ x, y, rolled }) => ({ x, y, type: rolled.type as TrapType }));

  return [...installedTraps, ...spawnedTraps];
}

// 해당 맵/날짜/유저의 미스터리 박스 보드를 채운다. 유저별로 독립된 보드라 한 유저의 픽업이
// 다른 유저의 스폰 여부에 영향을 주지 않는다(스폰 좌표가 맵당 8곳뿐이라 전역 공유였다면
// 가장 먼저 도착한 유저가 하루치를 다 가져가 버렸을 것 — 함정과 달리 미스터리 박스는
// 유저마다 독립적으로 존재).
//
// map.getState(ensureMysteryBoxesSeeded)와 run.finish(아이템 보드 리셋) 양쪽에서 공유하는 시딩 로직
// (docs/design-docs/move-run-finish-bugfixes.md 1절). 보드를 먼저 채우고 마커(itemSeededKey)는
// 마지막에 세운다 — 순서를 반대로 하면(마커 먼저) hSet이 중간에 실패했을 때 "seeded=true인데
// 보드는 빈" 상태가 자정까지 고착될 수 있다. 이 순서면 중간에 끊겨도 "아직 시딩 안 됨"으로 남아
// 다음 호출이 자연 복구한다.
//
// 시드 문자열에 date만 쓰면 모든 유저가 같은 날 정확히 같은 8곳을 보게 된다 — PRD의 "같은
// 날엔 모든 유저가 같은 맵을 본다"는 map-1/map-2 중 어느 맵을 쓸지(pickDailyMapId)에 대한
// 별개 규칙일 뿐, 박스 위치까지 유저 간 공유해야 한다는 요구사항은 문서 어디에도 없다(임소리
// 확인). 그래서 userId + 시딩 횟수(itemSeedGenerationKey)를 시드에 섞어 유저마다 다르게 뽑는다.
//
// 2026-07-14 임소리(서버 2번 — 함정 탐지기 확장 준비): 보드 값에 더 이상 존재 표시 placeholder
// ('1')가 아니라 rollMysteryOutcome() 결과(JSON 직렬화)를 미리 굴려서 저장한다 — 이전엔
// item.pickup이 픽업하는 그 순간에야 결과를 굴려서, 아직 아무도 안 먹은 박스는 서버 자신도
// 그게 뭔지 몰랐다(진짜로 미확정 상태). 함정 탐지기가 "저 박스는 무슨 함정이다"를 미리
// 알려주려면 그 결과가 픽업 전부터 이미 정해져 있어야 하므로, 결정 타이밍을 스폰(시딩)
// 시점으로 앞당긴다. item.pickup은 이제 이 저장된 값을 그대로 읽기만 한다(아래 참고).
async function seedMysteryBoxes(mapId: string, date: string, userId: string): Promise<void> {
  const boardKey = itemBoardKey(mapId, date, userId);
  const generationKey = itemSeedGenerationKey(mapId, date, userId);
  const generation = await redis.incrBy(generationKey, 1);
  // 2026-07-14 PR#70 리뷰 지적: boardKey/itemSeededKey와 달리 이 카운터 키만 만료 설정이
  // 빠져 있어서, date가 키에 포함됨에도 영구히 안 지워지고 (유저×맵×날짜) 조합만큼 계속
  // 쌓이고 있었다 — 다른 하루짜리 키들과 동일하게 DATA_SAFETY_TTL_SECONDS로 맞춘다.
  await redis.expire(generationKey, DATA_SAFETY_TTL_SECONDS);
  const spawnSeed = `${date}:${userId}:${generation}`;

  // 2026-07-14 임소리(자체 리뷰 사이클 발견 — run.finish 재도전 테스트 3건이 랜덤 스폰 도입
  // 후 보드 길이가 8이 아니라 15/20으로 나오면서 드러남): 이 함수는 원래(고정 3좌표 시절)
  // "항상 같은 필드 키에 hSet하는 멱등 함수"라 run.finish가 별도 삭제 없이 재호출만 해도
  // 자연히 이전 값을 덮어써서 리셋된 것처럼 보였다(위 "PR #67 리뷰 회귀" 절 주석 참고). 랜덤
  // 스폰으로 매 시딩(generation)마다 필드 키 자체가 달라지면서 이 전제가 깨졌다 — 삭제 없이
  // hSet만 하면 이전 세대에 남아있던(아직 안 먹은) 필드가 지워지지 않고 새 8곳 위에 계속
  // 누적된다(재도전마다 보드가 무한정 커지는 버그). 재시딩은 항상 "완전히 새로운 8곳"이어야
  // 하므로, hSet 전에 이전 세대 전체를 지운다.
  //
  // 2026-07-14 PR#70 리뷰 후속 지적: del과 hSet이 별개의 두 호출이라, run.finish(강제 재시딩)와
  // 거의 동시에 도착한 ensureMysteryBoxesSeeded(map.getState 경유) 같은 동시 seedMysteryBoxes
  // 호출이 서로의 del/hSet과 인터리빙되면 두 세대의 필드가 뒤섞여 보드가 다시 8개보다 많아지는
  // (바로 위에서 고친 것과 같은 종류의) 레이스가 있었다. boardKey를 WATCH해 del+hSet+expire를
  // 하나의 트랜잭션으로 묶는다 — 우리가 스냅샷을 뜬 뒤 다른 트랜잭션이 먼저 boardKey를
  // 바꿔놓으면 exec()이 null을 반환(실패)하므로, 이 경우 상대방이 이미 완전한 재시딩(8곳 새로 +
  // itemSeededKey 설정)을 끝냈다고 보고 우리는 그냥 양보한다 — 재시도 없이 반환해도 안전하다
  // (trap.install의 WATCH 실패 시 RETRY 응답과 달리, 여긴 호출자에게 돌려줄 응답이 없는 내부
  // 헬퍼라 "누군가는 성공했다"만 보장되면 충분하다).
  const tx = await redis.watch(boardKey);
  await tx.multi();
  await tx.del(boardKey);
  await tx.hSet(
    boardKey,
    Object.fromEntries(
      getMysteryBoxSpawns(mapId, spawnSeed).map((pos) => [tileMember(pos), JSON.stringify(rollMysteryOutcome())])
    )
  );
  await tx.expire(boardKey, DATA_SAFETY_TTL_SECONDS);
  const results = await tx.exec();
  // 2026-07-14 임소리(실서버 아이템 미픽업 조사): 실제 @devvit/redis의 TxClient.exec()
  // (node_modules/@devvit/redis/RedisClient.js)는 항상 배열을 반환한다 — `let output = []`로
  // 시작해 response.response를 순회하며 채우는 구조라 WATCH 충돌로 트랜잭션이 취소돼도 null이
  // 아니라 빈 배열([])로 귀결된다(빈 배열은 JS에서 truthy라 `if (!results)`만으로는 실제
  // 환경에서 결코 참이 될 수 없었다). trap.install(위 343행)이 이미 쓰고 있던 더 방어적인
  // 패턴(`!results || results.length === 0`)과 동일하게 맞춘다 — FakeRedis(테스트 목)는 null을
  // 반환하도록 만들어져 있어 기존 방식으로도 단위테스트는 통과했지만, 그건 목이 실제 계약과
  // 다르게 구현돼 있었기 때문(테스트 목도 함께 [] 반환으로 수정).
  if (!results || results.length === 0) {
    return;
  }

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
      const otherTraps: Position[] = parseInstalledTraps(allTrapFields)
        .filter((trap) => trap.installerId !== ctx.userId)
        .map(({ x, y }) => ({ x, y }));

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
        await assertAdjacentTracked(moveFailureStreakKey(mapId, date, ctx.userId), last, { x, y });
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
        await assertAdjacentTracked(moveFailureStreakKey(mapId, date, ctx.userId), last, { x, y });
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

        // 2026-07-14 임소리(서버 2번): 결과는 더 이상 픽업 시점에 굴리지 않는다 — 스폰(시딩)
        // 시점에 ensureMysteryBoxesSeeded가 이미 굴려서 저장해둔 값을 그대로 읽는다(함정
        // 탐지기가 아직 안 먹은 박스의 종류를 미리 알려줄 수 있으려면 그 값이 픽업 전부터
        // 정해져 있어야 한다). raw는 hDel 이전에 이미 읽어둔 값이라 삭제 여부와 무관하게
        // 그대로 유효하다.
        const rolled = JSON.parse(raw) as
          | { outcome: 'item'; type: ItemType }
          | { outcome: 'trap'; type: TrapType };

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
        // 오라클 방지 — 커밋 여부와 무관하게 앵커 검증은 여기서 끝난다. 실패 시 카운터를 남겨
        // run.finish가 "진짜로 얼어붙은 세션"을 구분할 수 있게 한다(moveFailureStreakKey).
        await assertAdjacentTracked(moveFailureStreakKey(mapId, date, ctx.userId), last, { x, y });

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
        // 2026-07-14 임소리(배영환님 승인 하에 수정, 실서버 조사): 결과는 더 이상 픽업 시점에
        // 굴리지 않는다 — 스폰(시딩) 시점에 seedMysteryBoxes가 이미 굴려서 저장해둔 값을 그대로
        // 읽는다(item.pickup과 동일한 패턴, 428행 참고). PR#70에서 item.pickup은 이 값을 읽도록
        // 갱신됐지만 move.arrive는 갱신에서 빠져 있었다 — 함정 탐지기가 픽업 전에 미리 알려준
        // 종류와 실제로 밟았을 때 나오는 종류가 달라지는(재추첨) 버그였다. rawItem은 hDel 이전에
        // 이미 읽어둔 값이라 삭제 여부와 무관하게 그대로 유효하다.
        const rolled = rawItem
          ? (JSON.parse(rawItem) as { outcome: 'item'; type: ItemType } | { outcome: 'trap'; type: TrapType })
          : null;

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

        // 리더보드 위조 방지: 입력값(steps/clearTimeMs)을 그대로 신뢰하지 않고, 이동마다
        // 갱신되는 위치 앵커가 실제로 골인 지점 근처에 있는지 검증한다 — trap.trigger/item.pickup/
        // move.arrive가 전부 갖춘 readPositionAnchor 검증이 run.finish에만 빠져있으면, 이
        // 엔드포인트를 직접 호출해 임의의 steps/clearTimeMs로 리더보드를 조작할 수 있다.
        // 앵커가 없으면(map.getState 없이 호출) NO_SESSION.
        //
        // ⚠️ 정확히 골인 지점과 "일치"가 아니라 assertAdjacent와 동일한 허용치(맨해튼 거리 ≤1)로
        // 검증한다 — 정상 클라이언트는 골인 타일 자체에서는 move.arrive를 호출하지 않는다
        // (game.tsx의 tryMove onComplete가 checkGoalReached(targetX, targetY)를 먼저 확인해
        // true면 resolveArrival 호출 없이 곧장 run.finish로 넘어감, checkGoalReached 정의부
        // 참고). 즉 정상 골인 시 서버 앵커는 골인 타일 "한 칸 전"에 멈춰있다 — 정확히 일치를
        // 요구하면 정상적으로 골인한 유저가 전부 NOT_AT_GOAL로 거부된다(/review 72로 발견한
        // 회귀). 맨해튼 거리 ≤1을 허용해도 위협 모델은 그대로 막힌다 — assertAdjacent가
        // 강제하는 한 칸씩 이동을 거쳐야만 골인 지점 인접까지 도달할 수 있으므로, 임의 좌표에서
        // 즉시 호출하는 위조는 여전히 불가능하다.
        const posKey = positionAnchorKey(mapId, date, ctx.userId);
        const streakKey = moveFailureStreakKey(mapId, date, ctx.userId);
        const [position, failureStreakRaw] = await Promise.all([readPositionAnchor(posKey), redis.get(streakKey)]);
        const goal = getMapExitPosition(mapId);
        const atGoal = manhattanDistance(position, goal) <= 1;

        // 2026-07-15 배영환(임소리 리포트 반영, docs/design-docs/position-anchor-permanent-lock.md):
        // 골인 검증에 실패해도(NOT_AT_GOAL) 위치 앵커가 "실제로 얼어붙은 세션"이면 아래 리셋
        // 블록을 실행한다(리더보드 기록은 여전히 건너뜀). 예전엔 검증 실패 시 여기서 곧장
        // throw해 리셋 블록에 아예 도달하지 못했다 — move.arrive 요청 하나가 유실되면(네트워크
        // 순간 끊김, 모바일 백그라운드 전환 등) 위치 앵커가 그 자리에 얼어붙고, 그 이후 모든
        // 이동이 연쇄로 INVALID_MOVE 처리되며, run.finish도 항상 NOT_AT_GOAL로 거부돼 리셋에
        // 도달할 방법이 없어 위치 앵커 TTL(2시간) 만료까지 세션이 영구 고착됐다.
        //
        // 다만 "NOT_AT_GOAL이면 무조건 리셋"은 두 가지 부작용이 있어 채택하지 않았다(구현 중
        // 회귀 테스트로 발견):
        // (1) 골인 전에 run.finish를 시험 삼아 호출해도(실서버에선 발생하지 않지만 이 테스트
        //     스위트의 "위조 시도" 시나리오처럼) 세션 전체가 리셋돼, 계속 걸어서 정상적으로
        //     완주하려던 진행 상황(앵커/아이템)까지 잃게 된다 — ARRIVAL_IDLE_TIMEOUT_MS 레이스
        //     (game.tsx reportRunFinish 주석 참고, 마지막 커밋이 아직 안 반영된 채로 run.finish가
        //     호출되는 좁은 타이밍)도 같은 피해를 입는다.
        // (2) 고의로 assertAdjacent를 한 번 실패시킨 뒤 run.finish를 불러 자기 아이템 보드를
        //     원하는 때에 리롤하는 악용이 가능해진다.
        // 그래서 moveFailureStreakKey(assertAdjacent 실패 횟수)가 임계값 이상 쌓인 경우에만
        // "진짜로 얼어붙은 세션"으로 간주해 리셋한다 — 실제로 앵커가 멈추면 그 뒤 모든 이동이
        // 계속 실패하므로 몇 걸음만 더 걸어도 금방 임계값을 넘지만, 위 (1)의 정상/경합 케이스는
        // 선행 실패가 전혀 없어(streak=0) 리셋되지 않고 기존처럼 그냥 거부된다.
        //
        // "연속 실패 시 클라이언트가 임의 좌표로 위치 재동기화를 요청" 안은 기각했다 — 서버가
        // 클라이언트가 제시한 좌표를 그대로 앵커로 받아들이면, 원하는 곳으로 앵커를 옮긴 뒤 인접
        // 타일에 move.arrive를 호출해 함정 유무를 알아내는 오라클 공격이 가능해져 assertAdjacent가
        // 지켜온 방어 설계 전체가 무력화된다. 리셋은 항상 "이번 런을 포기하고 시작 좌표로 되돌리는
        // 것"뿐이라 이 문제가 없다.
        const failureStreak = Number(failureStreakRaw) || 0;
        const isStuckSession = failureStreak >= STUCK_SESSION_FAILURE_THRESHOLD;
        const shouldReset = atGoal || isStuckSession;

        let rank: number | undefined;
        let isNewRecord = false;

        if (atGoal) {
          const key = leaderboardKey(mapId, date);
          const score = encodeLeaderboardScore(steps, clearTimeMs);

          const prevScore = await redis.zScore(key, ctx.userId);
          isNewRecord = prevScore === undefined || score < prevScore;
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

          rank = await redis.zRank(key, ctx.userId);
        }
        // 런 종료(성공/실패 무관) — 위치 앵커를 지우고 유저별 아이템 보드를 즉시 재시딩한다(docs/design-docs/
        // move-run-finish-bugfixes.md 1절). 예전엔 itemBoardKey/itemSeededKey를 삭제만 하고 다음
        // map.getState가 재시딩하길 기다렸는데(지연 재시딩), 다중 탭 환경에서 동시 map.getState의
        // 시딩과 인터리빙되면 "itemSeededKey는 존재(재시딩 영구 차단) + itemBoardKey는 빈 채"인
        // 영구 빈 보드가 재현될 수 있었다.
        // 2026-07-14 임소리 정정: 이 주석은 원래 "seedMysteryBoxes는 항상 같은 최종 데이터(고정
        // 스폰 좌표)를 쓰는 멱등 함수라 트랜잭션 없이 안전하게 수렴한다"고 설명했는데, 랜덤 스폰
        // 도입으로 그 전제가 깨졌다(매 시딩마다 필드 키 자체가 달라짐 — seedMysteryBoxes 내부의
        // "PR#67 리뷰 회귀" 주석 참고). "매번 전체 삭제 후 새로 채우기"로만 바꾼 최초 수정본은
        // del/hSet이 두 호출로 분리돼 있어, run.finish의 강제 재시딩과 거의 동시에 도착한
        // ensureMysteryBoxesSeeded(map.getState 경유)가 서로의 del/hSet과 인터리빙되면 두 세대의
        // 필드가 다시 뒤섞이는 레이스가 남아있었다(PR#70 리뷰 후속 발견). 지금은 seedMysteryBoxes
        // 내부가 boardKey를 WATCH해 del+hSet+expire를 하나의 트랜잭션(MULTI/EXEC)으로 묶고 있으므로
        // (seedMysteryBoxes 정의부 주석 참고), 여기서 재차 동시성 처리를 할 필요 없이 그냥 재호출만
        // 해도 안전하다 — "동시 실행돼도 안전하다"는 결론은 유지되지만, 그 근거는 "완전 재시딩"이
        // 아니라 seedMysteryBoxes 내부의 WATCH 트랜잭션이라는 점에 유의(이 트랜잭션을 나중에
        // "중복"으로 오해해 제거하면 이 레이스가 재발한다).
        // isNewRecord/atGoal 여부와 무관하게 shouldReset이면 항상 실행(2026-07-15 갱신: 위치 앵커가
        // 얼어붙은 세션이면 atGoal이 false여도 실행하도록 바뀌었다 — 위 shouldReset 산출 주석 참고).
        // 2026-07-14 임소리: detectorChargeKey/loadoutClaimedKey 리셋 여부가 "밸런스 판단 필요,
        // 미정"으로 남아있었는데(item-board-reset.md 4절), 실서버 테스트 중 "탐지기 로드아웃을
        // 골랐는데 적용이 안 된다"는 증상으로 드러남 — loadoutClaimedKey가 하루 1회 NX라 재도전
        // 때마다 다시 지급받지 못했던 것(정상 동작이었지만 UX상 막힘). 아이템/함정 보드와 동일하게
        // "매 런은 새로 시작"이 이 게임의 일관된 원칙이라 판단해, 둘 다 여기서 함께 리셋하기로
        // 확정(임소리 결정). charge만 남기고 클레임만 리셋하면 매 런마다 충전이 계속 쌓이는
        // 실질적 무제한 충전이 될 수 있어, 반드시 둘을 같이 지운다.
        //
        // 리더보드 기록(zAdd/hSet)은 이미 위에서 커밋됐으므로, 여기서 실패해도 rank/isNewRecord
        // 응답까지 잃지 않도록 try/catch로 감싼다 — 실패를 그대로 던지면 이미 세운 기록의 응답이
        // 통째로 유실되고, 클라이언트가 재시도하면 score가 이미 같아 isNewRecord가 잘못 false로
        // 계산된다(move-run-finish-bugfixes.md 3절).
        if (shouldReset) {
          try {
            await Promise.all([
              redis.del(posKey),
              redis.del(streakKey),
              redis.del(loadoutClaimedKey(mapId, date, ctx.userId)),
              redis.del(detectorChargeKey(mapId, date, ctx.userId)),
              seedMysteryBoxes(mapId, date, ctx.userId),
            ]);
          } catch (err) {
            console.error(`run.finish: 위치 앵커/아이템 보드 정리 실패 (userId=${ctx.userId}, mapId=${mapId})`, err);
          }
        }

        if (!atGoal) {
          // isStuckSession이었다면 리셋은 위에서 이미 실행됐으므로, 여기서 던져도 클라이언트가
          // 새로고침하면 정상적으로 새 런을 시작할 수 있다 — 리더보드 기록만 없는 채로 실패
          // 응답을 받는다(기존과 동일). isStuckSession이 아니었다면(streak=0) 리셋 없이 기존과
          // 완전히 동일하게 거부만 되고, 세션은 그대로 살아있어 계속 걸어서 완주할 수 있다.
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'NOT_AT_GOAL' });
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
