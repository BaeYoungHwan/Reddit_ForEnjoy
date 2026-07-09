import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { context, reddit, redis } from '@devvit/web/server';
import type { T2 } from '@devvit/shared-types/tid.js';
import {
  footprintKey,
  getKstDateString,
  itemBoardKey,
  leaderboardKey,
  parseTile,
  positionAnchorKey,
  tileMember,
  trapBoardKey,
  trapInstallerKey,
} from './core/redisKeys';
import {
  DATA_SAFETY_TTL_SECONDS,
  FOOTPRINT_CAP_PER_MAP,
  PER_TYPE_TRAP_CAP,
  POSITION_ANCHOR_TTL_SECONDS,
  TOTAL_TRAP_CAP,
} from './core/gameConfig';
import { getMapStartPosition } from './core/maps';
import { getItemSpawns } from './core/items';
import type { ItemInstance, ItemType, TrapInstance, TrapType } from '../shared/game-types';

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

function toTrapInstances(installerFields: Record<string, string>): TrapInstance[] {
  return Object.entries(installerFields).map(([field, type]) => ({
    ...parseTile(field),
    type: type as TrapType,
  }));
}

function toItemInstances(boardFields: Record<string, string>): ItemInstance[] {
  return Object.entries(boardFields).map(([field, type]) => ({
    ...parseTile(field),
    type: type as ItemType,
  }));
}

// trap.trigger/item.pickup 공용: 위치 앵커가 있는지, 직전 위치와 인접한 타일인지 확인하고 앵커를 갱신한다.
// (인접 타일만 허용하는 이유: trap.trigger — 함정 위치를 미리 알아내는 오라클 공격 방지.
//  item.pickup은 아이템 자체는 비밀이 아니지만, 같은 앵커를 공유하므로 검증도 동일하게 적용한다.)
async function advancePosition(posKey: string, x: number, y: number): Promise<void> {
  const last = await redis.get(posKey);
  if (!last) {
    // map.getState 없이 호출됨 — 비정상 흐름이므로 오류로 처리한다.
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'NO_SESSION' });
  }
  if (manhattanDistance(parseTile(last), { x, y }) > 1) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_MOVE' });
  }

  await redis.set(posKey, tileMember({ x, y }));
  await redis.expire(posKey, POSITION_ANCHOR_TTL_SECONDS);
}

// 해당 맵/날짜의 아이템 보드가 비어있으면 고정 스폰 좌표로 채운다. hSetNX라 동시 호출돼도 안전.
async function ensureItemsSeeded(mapId: string, date: string): Promise<void> {
  const boardKey = itemBoardKey(mapId, date);
  await Promise.all(
    getItemSpawns(mapId).map((item) => redis.hSetNX(boardKey, tileMember(item), item.type))
  );
  await redis.expire(boardKey, DATA_SAFETY_TTL_SECONDS);
}

export const appRouter = t.router({
  map: t.router({
    getState: protectedProcedure.input(mapIdSchema).query(async ({ ctx, input }) => {
      const date = getKstDateString();
      const { mapId } = input;

      // 아이템은 함정과 달리 비공개일 필요가 없어(오라클 방지 대상 아님) 전체 유저에게 동일하게 노출한다.
      await ensureItemsSeeded(mapId, date);

      const [footprintMembers, myTrapFields, itemFields] = await Promise.all([
        redis.zRange(footprintKey(mapId, date), 0, -1),
        redis.hGetAll(trapInstallerKey(mapId, date, ctx.userId)),
        redis.hGetAll(itemBoardKey(mapId, date)),
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
        items: toItemInstances(itemFields),
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
        await advancePosition(posKey, x, y);

        const boardKey = trapBoardKey(mapId, date);
        const field = tileMember({ x, y });
        const raw = await redis.hGet(boardKey, field);
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
          await redis.set(posKey, tileMember(start));
          await redis.expire(posKey, POSITION_ANCHOR_TTL_SECONDS);
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
        await advancePosition(posKey, x, y);

        const boardKey = itemBoardKey(mapId, date);
        const field = tileMember({ x, y });
        const raw = await redis.hGet(boardKey, field);
        if (!raw) {
          return { picked: false as const };
        }

        // HDEL의 반환값(실제로 지운 개수)을 판정 기준으로 삼는다 — 두 유저가 같은 아이템을
        // 거의 동시에 주워도 hDel은 원자적이라 정확히 한 명만 1을 받는다(트랩 설치와 동일한 패턴).
        const deleted = await redis.hDel(boardKey, [field]);
        if (deleted === 0) {
          return { picked: false as const };
        }

        return { picked: true as const, type: raw as ItemType };
      }),
  }),

  run: t.router({
    finish: protectedProcedure
      .input(z.object({ mapId: z.string().min(1), clearTimeMs: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const { mapId, clearTimeMs } = input;
        const date = getKstDateString();
        const key = leaderboardKey(mapId, date);

        const prevScore = await redis.zScore(key, ctx.userId);
        const isNewRecord = prevScore === undefined || clearTimeMs < prevScore;
        if (isNewRecord) {
          await redis.zAdd(key, { member: ctx.userId, score: clearTimeMs });
          await redis.expire(key, DATA_SAFETY_TTL_SECONDS);
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
          return {
            userId: entry.member,
            username: username ?? entry.member,
            clearTimeMs: entry.score,
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
