import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getKstDateString,
  itemBoardKey,
  itemSeededKey,
  parseTile,
  positionAnchorKey,
  tileMember,
  trapBoardKey,
} from './core/redisKeys';
import { getMapExitPosition } from './core/maps';
import { getMazeMap } from '../shared/maps';
import type { Position } from '../shared/game-types';

/**
 * @devvit/web/server의 redis는 실제 Devvit 런타임에서만 접속 가능한 싱글턴이라,
 * 로컬 테스트에서는 필요한 서브셋만 흉내 낸 인메모리 가짜로 교체한다.
 * WATCH/MULTI/EXEC의 원자성(버전 확인과 적용 사이에 다른 트랜잭션이 끼어들 수 없음)을
 * 재현하는 게 핵심이라, exec()의 버전 체크~적용 구간에는 await(양보 지점)를 두지 않는다.
 */
const mocks = vi.hoisted(() => {
  type ZMember = { member: string; score: number };

  class FakeRedis {
    private strings = new Map<string, string>();
    private hashes = new Map<string, Map<string, string>>();
    private zsets = new Map<string, Map<string, number>>();
    private versions = new Map<string, number>();
    // 부분 실패(예: hSet 성공/실패 순서에 따른 시딩 갭) 회귀 테스트를 위한 실패 주입 훅
    // (docs/design-docs/move-run-finish-bugfixes.md 8절).
    private failNextCalls = new Map<string, number>();

    reset(): void {
      this.strings.clear();
      this.hashes.clear();
      this.zsets.clear();
      this.versions.clear();
      this.failNextCalls.clear();
    }

    failNext(method: string, times = 1): void {
      this.failNextCalls.set(method, times);
    }

    private maybeFail(method: string): void {
      const remaining = this.failNextCalls.get(method);
      if (remaining && remaining > 0) {
        this.failNextCalls.set(method, remaining - 1);
        throw new Error(`FakeRedis: injected failure for ${method}`);
      }
    }

    private bump(key: string): void {
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    }

    private version(key: string): number {
      return this.versions.get(key) ?? 0;
    }

    private hSetSync(key: string, fieldValues: Record<string, string>): number {
      const hash = this.hashes.get(key) ?? new Map<string, string>();
      this.hashes.set(key, hash);
      let added = 0;
      for (const [field, value] of Object.entries(fieldValues)) {
        if (!hash.has(field)) added++;
        hash.set(field, value);
      }
      this.bump(key);
      return added;
    }

    async get(key: string): Promise<string | undefined> {
      return this.strings.get(key);
    }

    async set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }): Promise<string | null> {
      if (options?.nx && this.strings.has(key)) return null;
      this.strings.set(key, value);
      this.bump(key);
      return 'OK';
    }

    async incrBy(key: string, value: number): Promise<number> {
      const next = Number(this.strings.get(key) ?? '0') + value;
      this.strings.set(key, String(next));
      this.bump(key);
      return next;
    }

    private delSync(key: string): void {
      const existed = this.strings.delete(key) || this.hashes.delete(key) || this.zsets.delete(key);
      if (existed) this.bump(key);
    }

    async del(...keys: string[]): Promise<void> {
      for (const key of keys) {
        this.delSync(key);
      }
    }

    async expire(_key: string, _seconds: number): Promise<void> {}

    async hGetAll(key: string): Promise<Record<string, string>> {
      return Object.fromEntries(this.hashes.get(key) ?? []);
    }

    async hGet(key: string, field: string): Promise<string | undefined> {
      return this.hashes.get(key)?.get(field);
    }

    async hSet(key: string, fieldValues: Record<string, string>): Promise<number> {
      this.maybeFail('hSet');
      return this.hSetSync(key, fieldValues);
    }

    async hSetNX(key: string, field: string, value: string): Promise<number> {
      const hash = this.hashes.get(key) ?? new Map<string, string>();
      this.hashes.set(key, hash);
      if (hash.has(field)) return 0;
      hash.set(field, value);
      this.bump(key);
      return 1;
    }

    async hDel(key: string, fields: string[]): Promise<number> {
      const hash = this.hashes.get(key);
      if (!hash) return 0;
      let removed = 0;
      for (const field of fields) {
        if (hash.delete(field)) removed++;
      }
      if (removed) this.bump(key);
      return removed;
    }

    async zAdd(key: string, ...members: ZMember[]): Promise<number> {
      const zset = this.zsets.get(key) ?? new Map<string, number>();
      this.zsets.set(key, zset);
      let added = 0;
      for (const { member, score } of members) {
        if (!zset.has(member)) added++;
        zset.set(member, score);
      }
      this.bump(key);
      return added;
    }

    async zRange(key: string, start: number, stop: number): Promise<ZMember[]> {
      const sorted = [...(this.zsets.get(key) ?? new Map<string, number>()).entries()].sort(
        (a, b) => a[1] - b[1]
      );
      const n = sorted.length;
      const s = start < 0 ? Math.max(n + start, 0) : start;
      const e = stop < 0 ? n + stop : stop;
      return sorted.slice(s, e + 1).map(([member, score]) => ({ member, score }));
    }

    async zRemRangeByRank(key: string, start: number, stop: number): Promise<number> {
      const zset = this.zsets.get(key);
      if (!zset) return 0;
      const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1]);
      const n = sorted.length;
      const s = start < 0 ? Math.max(n + start, 0) : start;
      const e = stop < 0 ? n + stop : stop;
      if (s > e || s >= n) return 0;
      let removed = 0;
      for (let i = s; i <= Math.min(e, n - 1); i++) {
        const entry = sorted[i];
        if (entry && zset.delete(entry[0])) removed++;
      }
      if (removed) this.bump(key);
      return removed;
    }

    async zScore(key: string, member: string): Promise<number | undefined> {
      return this.zsets.get(key)?.get(member);
    }

    async zRank(key: string, member: string): Promise<number | undefined> {
      const sorted = [...(this.zsets.get(key) ?? new Map<string, number>()).entries()].sort(
        (a, b) => a[1] - b[1]
      );
      const idx = sorted.findIndex(([m]) => m === member);
      return idx === -1 ? undefined : idx;
    }

    async watch(...keys: string[]) {
      const snapshot = new Map(keys.map((key) => [key, this.version(key)]));
      const queued: Array<() => unknown> = [];
      const tx = {
        multi: async (): Promise<void> => {},
        hSet: (key: string, fieldValues: Record<string, string>) => {
          // 실제 hSet과 동일하게 failNext 주입을 존중한다 — 그러지 않으면 트랜잭션 경유
          // hSet은 실패 주입 테스트를 우회해버린다(2026-07-14 PR#70 리뷰 후속, seedMysteryBoxes가
          // WATCH/MULTI/EXEC로 바뀌며 드러남).
          queued.push(() => {
            this.maybeFail('hSet');
            return this.hSetSync(key, fieldValues);
          });
          return Promise.resolve(tx);
        },
        del: (...keys: string[]) => {
          queued.push(() => keys.forEach((key) => this.delSync(key)));
          return Promise.resolve(tx);
        },
        expire: (_key: string, _seconds: number) => {
          queued.push(() => undefined);
          return Promise.resolve(tx);
        },
        exec: async (): Promise<unknown[] | null> => {
          // 체크~적용 사이에 await가 없어야 다른 트랜잭션의 exec()이 끼어들 수 없다(원자성).
          for (const [key, version] of snapshot) {
            if (this.version(key) !== version) return null;
          }
          return queued.map((op) => op());
        },
      };
      return tx;
    }
  }

  const users = new Map<string, { username: string }>();
  const rejectIds = new Set<string>();

  return {
    redis: new FakeRedis(),
    reddit: {
      getUserById: async (id: string) => {
        if (rejectIds.has(id)) throw new Error(`getUserById 실패 (mock): ${id}`);
        return users.get(id);
      },
    },
    users,
    rejectIds,
  };
});

vi.mock('@devvit/web/server', () => ({
  redis: mocks.redis,
  reddit: mocks.reddit,
  context: { userId: undefined },
}));

const { createCaller } = await import('./trpc');

beforeEach(() => {
  mocks.redis.reset();
  mocks.users.clear();
  mocks.rejectIds.clear();
});

// map-1 시작 좌표(shared/maps.ts MAP_1_LAYOUT의 'S' 위치, maps.test.ts에서 검증됨) — 미스터리
// 박스 스폰이 랜덤화(2026-07-14)된 뒤로 테스트가 목표 좌표를 매번 map.getState로 동적으로
// 알아내야 해서, "시작 좌표 → 목표 좌표"까지 걸어가는 절차가 여러 describe에서 반복된다.
const MAP_1_START: Position = { x: 1, y: 1 };

// assertAdjacent(trpc.ts)는 실제 미로 벽을 검증하지 않고 이전 앵커와의 거리<=1만 확인하므로,
// 테스트에서는 목표 좌표까지 "x축 먼저, y축 나중" 순서로 한 칸씩 아무 mutation이나 호출해
// 앵커만 옮기면 충분하다(실제 벽 통과 가능 여부 무관). trap.trigger로 이동하는 이유: 미스터리
// 박스 스폰이 이제 맵 전역에 랜덤 분포하므로, item.pickup으로 이동하면 지나가는 칸에 우연히
// 있는 다른 박스를 의도치 않게 주워버려(Math.random 소모, respawn이면 앵커까지 되돌아감)
// 걷는 경로가 깨질 수 있다 — trap.trigger는 설치형 함정 보드만 보므로 이런 부작용이 없다
// (지나가는 길에 우연히 설치된 함정이 있으면 걸릴 수는 있지만, 각 테스트가 직접 설치하는
// 함정 좌표를 걷는 경로와 겹치지 않게 고르면 된다).
// "x축 먼저, y축 나중" 순서로 from에서 to까지 지나가는 칸들을 순서대로 반환한다(from 자체는
// 제외, to는 포함) — 실제 밟는 경로를 미리 알아야 하는 테스트(예: "도착 직전 칸"이 필요한
// 위치 앵커 리셋 검증)를 위해 walkAnchorTo와 로직을 공유한다.
function computeWalkPath(from: Position, to: Position): Position[] {
  const path: Position[] = [];
  let x = from.x;
  const y0 = from.y;
  while (x !== to.x) {
    x += x < to.x ? 1 : -1;
    path.push({ x, y: y0 });
  }
  let y = y0;
  while (y !== to.y) {
    y += y < to.y ? 1 : -1;
    path.push({ x: to.x, y });
  }
  return path;
}

async function walkAnchorTo(
  caller: ReturnType<typeof createCaller>,
  mapId: string,
  from: Position,
  to: Position
): Promise<void> {
  for (const step of computeWalkPath(from, to)) {
    await caller.trap.trigger({ mapId, x: step.x, y: step.y });
  }
}

// run.finish의 골인 위치 검증(2026-07-14 추가) 회귀 대응 — 앵커를 실제 맵 골인 지점까지
// 옮겨야 run.finish가 NOT_AT_GOAL로 거부하지 않는다. from은 호출 시점의 실제 앵커 위치를
// 호출자가 정확히 알려줘야 한다(walkAnchorTo와 동일한 이유 — assertAdjacent는 Redis에 저장된
// 실제 앵커 기준으로만 검증하므로, from이 실제 앵커와 다르면 첫 스텝부터 INVALID_MOVE).
async function walkAnchorToGoal(
  caller: ReturnType<typeof createCaller>,
  mapId: string,
  from: Position
): Promise<void> {
  await walkAnchorTo(caller, mapId, from, getMapExitPosition(mapId));
}

// walkAnchorToGoal과 달리 from을 호출자가 미리 알 필요가 없다 — Redis에 실제로 커밋된 앵커를
// 직접 읽어서 그 자리부터 걷는다. item.pickup 직후처럼 "결과가 respawn이면 앵커가 시작 좌표로,
// 아니면 방금 주운 자리로" 갈리는 것처럼 실제 도착 위치가 테스트 코드만 보고는 확정할 수 없는
// 경우에 쓴다(2026-07-14 미스터리 박스 사전 확정 PR#70 이후, 스폰 시점에 이미 굴려둔 결과라
// pickup 호출 시점에 vi.spyOn(Math.random)을 걸어도 그 결과를 바꿀 수 없다 — 어떤 outcome이
// 나올지 테스트가 통제할 수 없으므로 anchor 위치도 예측할 수 없다).
async function walkAnchorToGoalFromCurrent(
  caller: ReturnType<typeof createCaller>,
  mapId: string,
  userId: string
): Promise<void> {
  const raw = await mocks.redis.get(positionAnchorKey(mapId, getKstDateString(), userId));
  if (!raw) throw new Error(`walkAnchorToGoalFromCurrent: 앵커 없음 (userId=${userId})`);
  await walkAnchorToGoal(caller, mapId, parseTile(raw));
}

// run.finish의 골인 위치 검증이 정확히 일치가 아니라 맨해튼 거리 ≤1을 허용하는 이유(/review 72
// 회귀 발견) 회귀 테스트용 — 실제 클라이언트는 골인 타일 자체에서는 move.arrive를 호출하지
// 않아(game.tsx의 checkGoalReached 조기 return) 서버 앵커가 골인 타일 "바로 인접한 칸"에
// 남아있는 상태로 run.finish가 호출된다. 골인 지점 좌표를 하드코딩하면 맵이 바뀔 때 깨지므로,
// 그리드에서 실제로 걸을 수 있는(벽이 아닌) 인접 칸을 찾아 반환한다.
function findAdjacentFloorTile(mapId: string): Position {
  const map = getMazeMap(mapId);
  const { exit, grid } = map;
  const candidates = [
    { x: exit.x + 1, y: exit.y },
    { x: exit.x - 1, y: exit.y },
    { x: exit.x, y: exit.y + 1 },
    { x: exit.x, y: exit.y - 1 },
  ];
  const found = candidates.find(({ x, y }) => grid[y]?.[x] === 'floor');
  if (!found) throw new Error(`findAdjacentFloorTile: ${mapId}의 골인 지점 주변에 floor 칸이 없음`);
  return found;
}

// map-1 그리드 크기(maps.test.ts에서 검증됨) — 아래 offsetWithinBounds가 랜덤 target 기준
// 오프셋이 그리드를 벗어나지 않게 하는 데 쓴다.
const MAP_1_WIDTH = 25;
const MAP_1_HEIGHT = 21;

// 2026-07-14 PR#70 리뷰 지적: 미스터리 박스 스폰이 랜덤화된 뒤로 target이 맵 가장자리 근처에
// 나올 수 있어, "target 기준 +delta" 좌표가 그리드 폭/높이를 넘어갈 수 있었다(trap.install이
// 좌표 유효성을 검증하지 않아 테스트 자체는 실패하지 않지만, 실제 게임에선 있을 수 없는 위치라
// 사실성이 떨어짐). +delta가 경계를 넘으면 -delta로 대신 오프셋한다 — 체비셰프/맨해튼 거리
// 단언은 |dx|만 보므로 방향을 뒤집어도 테스트 의도는 그대로 유지된다.
function offsetWithinBounds(value: number, delta: number, size: number): number {
  return value + delta <= size - 1 ? value + delta : value - delta;
}

describe('trap.install 동시성 (8.4 회귀 테스트)', () => {
  it('같은 유저가 서로 다른 두 타일에 동시에 설치하면 정확히 하나만 성공한다', async () => {
    const caller = createCaller({ userId: 'user-a' });
    const [resultA, resultB] = await Promise.all([
      caller.trap.install({ mapId: 'map-1', type: 'slow', x: 1, y: 0 }),
      caller.trap.install({ mapId: 'map-1', type: 'slow', x: 2, y: 0 }),
    ]);

    const results = [resultA, resultB];
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success && r.reason === 'RETRY')).toHaveLength(1);
  });
});

describe('trap.trigger 위치 앵커 검증 (8.4 회귀 테스트)', () => {
  it('map.getState 없이 호출하면 NO_SESSION 오류', async () => {
    const caller = createCaller({ userId: 'user-b' });
    await expect(caller.trap.trigger({ mapId: 'map-1', x: 5, y: 5 })).rejects.toMatchObject({
      message: 'NO_SESSION',
    });
  });

  it('앵커에서 2칸 이상 떨어진 좌표는 INVALID_MOVE 오류', async () => {
    const caller = createCaller({ userId: 'user-c' });
    await caller.map.getState({ mapId: 'map-1' });

    await expect(caller.trap.trigger({ mapId: 'map-1', x: 5, y: 5 })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
  });

  it('인접 타일 이동은 정상 처리된다', async () => {
    const caller = createCaller({ userId: 'user-d' });
    await caller.map.getState({ mapId: 'map-1' });

    await expect(caller.trap.trigger({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      hit: false,
    });
  });

  it('동일 함정 타일에 두 유저가 동시에 접근하면 한쪽만 hit:true를 받는다(이중발동 회귀, docs/design-docs/move-run-finish-bugfixes.md 2절)', async () => {
    const installer = createCaller({ userId: 'user-trigger-race-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'slow', x: 1, y: 0 });

    const callerA = createCaller({ userId: 'user-trigger-race-a' });
    const callerB = createCaller({ userId: 'user-trigger-race-b' });
    await callerA.map.getState({ mapId: 'map-1' });
    await callerB.map.getState({ mapId: 'map-1' });

    const [resultA, resultB] = await Promise.all([
      callerA.trap.trigger({ mapId: 'map-1', x: 1, y: 0 }),
      callerB.trap.trigger({ mapId: 'map-1', x: 1, y: 0 }),
    ]);

    expect([resultA, resultB].filter((r) => r.hit)).toHaveLength(1);
  });
});

describe('run.finish 골인 위치 검증 (리더보드 위조 방지 회귀 테스트)', () => {
  it('map.getState 없이(세션 없이) 호출하면 NO_SESSION으로 거부된다', async () => {
    const caller = createCaller({ userId: 'user-no-session' });
    await expect(caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 5000 })).rejects.toMatchObject({
      message: 'NO_SESSION',
    });
  });

  it('골인 지점에 도달하지 않은 채(시작 좌표 그대로) 호출하면 NOT_AT_GOAL로 거부된다', async () => {
    const caller = createCaller({ userId: 'user-not-at-goal' });
    await caller.map.getState({ mapId: 'map-1' }); // 앵커: 시작 좌표

    await expect(caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 5000 })).rejects.toMatchObject({
      message: 'NOT_AT_GOAL',
    });
  });

  it('입력값(steps/clearTimeMs)만으로는 위조할 수 없다 — 골인 지점까지 실제로 이동해야 리더보드에 반영된다', async () => {
    const caller = createCaller({ userId: 'user-forged-score' });
    await caller.map.getState({ mapId: 'map-1' });

    // 골인과 무관한 임의의 인접 좌표로만 한 칸 이동 — 실제 골인 지점이 아니다.
    await caller.trap.trigger({ mapId: 'map-1', x: 1, y: 0 });
    await expect(
      caller.run.finish({ mapId: 'map-1', steps: 0, clearTimeMs: 1 })
    ).rejects.toMatchObject({ message: 'NOT_AT_GOAL' });

    // 실제로 골인 지점까지 이동한 뒤에는 정상적으로 리더보드에 반영된다.
    await walkAnchorToGoal(caller, 'map-1', { x: 1, y: 0 });
    await expect(caller.run.finish({ mapId: 'map-1', steps: 42, clearTimeMs: 9999 })).resolves.toMatchObject({
      rank: 1,
    });
  });

  it('골인 지점 바로 인접 칸(맨해튼 거리 1)까지만 이동해도 성공한다 — 실제 클라이언트는 골인 타일 자체에서는 move.arrive를 호출하지 않는다(/review 72 회귀)', async () => {
    const caller = createCaller({ userId: 'user-adjacent-to-goal' });
    await caller.map.getState({ mapId: 'map-1' });

    // 골인 타일 자체는 밟지 않고, 바로 옆 칸까지만 이동한다 — game.tsx의 tryMove onComplete가
    // checkGoalReached에서 true를 반환하면 move.arrive 호출 없이 곧장 run.finish로 넘어가는
    // 실제 클라이언트 흐름을 그대로 재현한 것(walkAnchorToGoal로 골인 지점까지 직접 걷는
    // 위 테스트들과 달리, 이 테스트는 "정확히 일치"가 아니라 "인접"이 허용되는지가 핵심).
    const adjacent = findAdjacentFloorTile('map-1');
    await walkAnchorTo(caller, 'map-1', MAP_1_START, adjacent);

    await expect(
      caller.run.finish({ mapId: 'map-1', steps: 120, clearTimeMs: 30000 })
    ).resolves.toMatchObject({ rank: 1 });
  });
});

describe('map.getState 위치 앵커 (8.1 회귀 테스트)', () => {
  it('세션 중 재호출해도 진행 중인 앵커를 시작 좌표로 되돌리지 않는다', async () => {
    const caller = createCaller({ userId: 'user-e' });
    await caller.map.getState({ mapId: 'map-1' }); // 앵커: (0,0)
    await caller.trap.trigger({ mapId: 'map-1', x: 1, y: 0 }); // 앵커: (1,0)

    await caller.map.getState({ mapId: 'map-1' }); // 재호출 — 앵커가 되돌아가면 안 됨

    // 앵커가 (1,0)에 남아있어야 인접한 (2,0) 이동이 정상 처리된다
    await expect(caller.trap.trigger({ mapId: 'map-1', x: 2, y: 0 })).resolves.toEqual({
      hit: false,
    });
  });

  it('run.finish 후에는 앵커가 지워져 다음 getState가 시작 좌표로 다시 초기화한다', async () => {
    const caller = createCaller({ userId: 'user-f' });
    await caller.map.getState({ mapId: 'map-1' });
    await caller.trap.trigger({ mapId: 'map-1', x: 1, y: 0 }); // 앵커: (1,0)
    await walkAnchorToGoal(caller, 'map-1', { x: 1, y: 0 });
    await caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 12345 });

    await caller.map.getState({ mapId: 'map-1' }); // 새 런 — 앵커가 (0,0)으로 재초기화됨

    // (0,0) 기준으로는 인접하지 않은 좌표라 거부되어야 앵커가 실제로 리셋됐음을 확인할 수 있다
    await expect(caller.trap.trigger({ mapId: 'map-1', x: 2, y: 0 })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
  });
});

describe('run.finish 아이템 보드 리셋 (docs/design-docs/item-board-reset.md 회귀 테스트)', () => {
  it('골인 후 아이템 보드가 리셋되어 다음 map.getState가 미스터리 박스를 재시딩한다(재생성 버그 없이)', async () => {
    const caller = createCaller({ userId: 'user-reset-a' });
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정(부수효과 없음)
    const picked = await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });
    randomSpy.mockRestore();
    expect(picked.picked).toBe(true);

    // 리셋 전이라면 (기존 "재생성 버그" 회귀 테스트처럼) target은 다시 채워지지 않아야 정상이다.
    const beforeFinish = await caller.map.getState({ mapId: 'map-1' });
    expect(beforeFinish.mysteryBoxes).not.toContainEqual(target);

    await walkAnchorToGoalFromCurrent(caller, 'map-1', 'user-reset-a');
    await caller.run.finish({ mapId: 'map-1', steps: 30, clearTimeMs: 20000 });

    // 2026-07-14(랜덤 스폰 도입): 스폰 좌표는 매 시딩(재도전)마다 시드가 바뀌어 달라지므로,
    // 특정 좌표가 재등장하는지가 아니라 "재시딩으로 8곳이 다시 꽉 찼는지"로 리셋 여부를 검증한다.
    const afterFinish = await caller.map.getState({ mapId: 'map-1' });
    expect(afterFinish.mysteryBoxes).toHaveLength(8);
  });

  it('신기록이 아니어도(더 느린 재도전) 아이템 보드는 항상 리셋된다', async () => {
    const caller = createCaller({ userId: 'user-reset-b' });
    await caller.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(caller, 'map-1', MAP_1_START);
    await caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 5000 }); // 1차: 신기록

    // 리셋된 보드에서 하나를 다시 주운다.
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8);
    await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });
    randomSpy.mockRestore();

    await walkAnchorToGoalFromCurrent(caller, 'map-1', 'user-reset-b');
    const result = await caller.run.finish({ mapId: 'map-1', steps: 50, clearTimeMs: 90000 }); // 2차: 신기록 아님
    expect(result.isNewRecord).toBe(false);

    // 신기록이 아니어도 재시딩은 항상 일어나야 하므로, 방금 먹은 target까지 포함해 다시 8곳이 꽉 찬다.
    const state = await caller.map.getState({ mapId: 'map-1' });
    expect(state.mysteryBoxes).toHaveLength(8);
  });

  it('run.finish 직후, 개입하는 map.getState 호출 없이도 아이템 보드가 즉시 재시딩된다(즉시성 회귀, docs/design-docs/move-run-finish-bugfixes.md 1절)', async () => {
    const caller = createCaller({ userId: 'user-reset-immediate' });
    await caller.map.getState({ mapId: 'map-1' });
    const date = getKstDateString();
    const boardKey = itemBoardKey('map-1', date, 'user-reset-immediate');

    // 골인 전: 정상 시딩된 상태(맵당 스폰 8곳, 랜덤 스폰 도입 이후)
    expect(Object.keys(await mocks.redis.hGetAll(boardKey))).toHaveLength(8);

    await walkAnchorToGoal(caller, 'map-1', MAP_1_START);
    await caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 5000 });

    // map.getState를 다시 부르지 않고 run.finish 직후 Redis 상태를 직접 확인한다 — 지연
    // 재시딩(삭제만 하고 다음 map.getState를 기다림)이었다면 여기서 보드가 비어 있어야 하지만,
    // 즉시 재시딩이므로 개입 호출 없이도 이미 채워져 있어야 한다.
    const boardAfterFinish = await mocks.redis.hGetAll(boardKey);
    expect(Object.keys(boardAfterFinish)).toHaveLength(8);
  });

  it('run.finish의 강제 재시딩과 거의 동시에 도착한 map.getState의 재시딩이 겹쳐도, 두 세대의 필드가 뒤섞여 보드가 8개보다 커지지 않는다(WATCH 레이스 회귀, PR#70 리뷰 후속)', async () => {
    const caller = createCaller({ userId: 'user-concurrent-seed' });
    await caller.map.getState({ mapId: 'map-1' }); // 최초 시딩(8곳)
    const date = getKstDateString();
    const boardKey = itemBoardKey('map-1', date, 'user-concurrent-seed');

    // 레이스를 재현하려면 map.getState 쪽도 실제로 재시딩을 타야 한다 — 이미 seeded 상태라
    // ensureMysteryBoxesSeeded가 스킵해버리므로 마커를 지워 "아직 시딩 안 됨"으로 되돌린다.
    await mocks.redis.del(itemSeededKey('map-1', date, 'user-concurrent-seed'));
    await walkAnchorToGoal(caller, 'map-1', MAP_1_START);

    // run.finish(무조건 재시딩)와 map.getState(마커가 없어 재시딩)를 동시에 발사 — seedMysteryBoxes
    // 내부의 await 지점들에서 서로 인터리빙될 기회가 생긴다. WATCH 보호가 없다면 del→del→hSet→hSet
    // 순서로 겹쳐 8+8=16개까지 쌓일 수 있었다(바로 위 "즉시성 회귀" 테스트가 고쳤던 것과 같은 종류의
    // 버그가 동시성 경로에서 재발한 것).
    await Promise.all([
      caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 5000 }),
      caller.map.getState({ mapId: 'map-1' }),
    ]);

    expect(Object.keys(await mocks.redis.hGetAll(boardKey))).toHaveLength(8);
  });
});

describe('map.getState 미스터리 박스 시딩', () => {
  it('첫 호출 시 8곳(getMysteryBoxSpawns, 랜덤 스폰)이 채워지고, 재호출해도 같은 목록을 반환한다(타입은 노출하지 않음)', async () => {
    const caller = createCaller({ userId: 'user-k' });
    const first = await caller.map.getState({ mapId: 'map-1' });
    const second = await caller.map.getState({ mapId: 'map-1' });

    expect(first.mysteryBoxes).toHaveLength(8);
    expect(second.mysteryBoxes).toEqual(expect.arrayContaining(first.mysteryBoxes));
    expect(second.mysteryBoxes).toHaveLength(first.mysteryBoxes.length);
  });

  it('픽업한 뒤 재호출해도 해당 박스가 다시 채워지지 않는다(재생성 버그 회귀)', async () => {
    const caller = createCaller({ userId: 'user-q' });
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    const [target, ...rest] = mysteryBoxes;

    await walkAnchorTo(caller, 'map-1', MAP_1_START, target!);
    // 목적지 도착 직전까지는 trap.trigger로만 이동해 다른 박스를 건드리지 않았으므로, 여기서
    // Math.random 결과와 무관하게 target 자리의 박스를 그대로 집는다.
    const result = await caller.item.pickup({ mapId: 'map-1', x: target!.x, y: target!.y });
    expect(result.picked).toBe(true);

    const state = await caller.map.getState({ mapId: 'map-1' });
    expect(state.mysteryBoxes).not.toContainEqual(target);
    expect(state.mysteryBoxes).toContainEqual(rest[0]);
  });

  it('픽업 결과는 스폰(시딩) 시점에 이미 정해져 있다 — 픽업 시점엔 다시 안 굴린다(서버 2번 회귀, 함정 탐지기 확장의 전제조건)', async () => {
    const caller = createCaller({ userId: 'user-preroll' });
    // 시딩 시점 값: flashlight로 고정.
    const seedSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8);
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    seedSpy.mockRestore();
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    // 픽업 시점엔 완전히 다른 값(reverse)으로 바꿔둔다 — 만약 pickup이 여전히 그 순간에 다시
    // 굴린다면 reverse가 나와야 하지만, 미리 정해둔 값을 읽기만 한다면 시딩 시점의 flashlight가
    // 그대로 나와야 한다(픽업 시점 Math.random 값은 완전히 무시돼야 함).
    const pickupSpy = vi.spyOn(Math, 'random').mockReturnValue(7.5 / 8);
    const result = await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });
    pickupSpy.mockRestore();

    expect(result).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
  });
});

describe('map.getState 다른 유저 설치 함정 위치 공개 (2026-07-14 오라클 완화 — otherTraps)', () => {
  it('다른 유저가 설치한 함정은 타입 없이 좌표만 otherTraps로 내려오고, 본인 함정은 myTraps에만 있고 otherTraps엔 없다', async () => {
    const installer = createCaller({ userId: 'user-installer-2' });
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: 20, y: 5 });

    const viewer = createCaller({ userId: 'user-viewer' });
    await viewer.trap.install({ mapId: 'map-1', type: 'reverse', x: 21, y: 6 });

    const state = await viewer.map.getState({ mapId: 'map-1' });

    // 정확히 {x,y}만 있는 객체와 deep-equal이어야 통과 — type 필드가 섞여 있었다면 실패한다(오라클 방지: 종류는 비공개).
    expect(state.otherTraps).toContainEqual({ x: 20, y: 5 });
    expect(state.otherTraps).not.toContainEqual({ x: 21, y: 6 });
    expect(state.myTraps).toContainEqual({ x: 21, y: 6, type: 'reverse' });
  });

  it('타 유저 함정이 소모(hDel)되면 다음 map.getState 호출부터 otherTraps에서 사라진다(2026-07-14 PR#69 리뷰 지적 — 재생성/누락류 버그 회귀 방지)', async () => {
    const installer = createCaller({ userId: 'user-installer-3' });
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: 22, y: 5 });

    const viewer = createCaller({ userId: 'user-viewer-2' });
    const before = await viewer.map.getState({ mapId: 'map-1' });
    expect(before.otherTraps).toContainEqual({ x: 22, y: 5 });

    // trap.trigger의 인접 타일 검증(assertAdjacent)까지 걸어서 재현하는 대신, 소모의 최종
    // 효과(trapBoardKey에서 hDel됨)만 직접 재현해 otherTraps가 "그 순간의 보드 상태"를 그대로
    // 반영하는지(스냅샷이 아니라 매번 재조회하는지)를 격리해서 검증한다.
    const date = getKstDateString();
    await mocks.redis.hDel(trapBoardKey('map-1', date), [tileMember({ x: 22, y: 5 })]);

    const after = await viewer.map.getState({ mapId: 'map-1' });
    expect(after.otherTraps).not.toContainEqual({ x: 22, y: 5 });
  });

  it('시딩 도중 hSet이 실패해도 마커가 남지 않아 다음 호출이 자연 복구한다(PR #67 리뷰 회귀, docs/design-docs/move-run-finish-bugfixes.md 8절)', async () => {
    const caller = createCaller({ userId: 'user-seed-fail' });
    const date = getKstDateString();
    const boardKey = itemBoardKey('map-1', date, 'user-seed-fail');
    const seededKey = itemSeededKey('map-1', date, 'user-seed-fail');

    mocks.redis.failNext('hSet', 1);
    await expect(caller.map.getState({ mapId: 'map-1' })).rejects.toThrow();

    // 실패 지점이 보드 hSet이라, 마커(itemSeededKey)는 세워지지 않아야 한다 — 마커가 먼저 세워져
    // 있었다면(수정 전 SET NX 버전) 이 시점에 이미 '1'이라 아래 재호출도 영구히 스킵됐을 것이다.
    expect(await mocks.redis.get(seededKey)).toBeUndefined();
    expect(Object.keys(await mocks.redis.hGetAll(boardKey))).toHaveLength(0);

    // 실패 주입 없이 재호출하면 자연 복구되어야 한다.
    const state = await caller.map.getState({ mapId: 'map-1' });
    expect(state.mysteryBoxes).toHaveLength(8);
  });
});

describe('item.pickup 위치 앵커 검증', () => {
  it('map.getState 없이 호출하면 NO_SESSION 오류', async () => {
    const caller = createCaller({ userId: 'user-l' });
    await expect(caller.item.pickup({ mapId: 'map-1', x: 5, y: 5 })).rejects.toMatchObject({
      message: 'NO_SESSION',
    });
  });

  it('앵커에서 2칸 이상 떨어진 좌표는 INVALID_MOVE 오류', async () => {
    const caller = createCaller({ userId: 'user-m' });
    await caller.map.getState({ mapId: 'map-1' });

    await expect(caller.item.pickup({ mapId: 'map-1', x: 5, y: 5 })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
  });

  it('아이템이 없는 인접 타일은 picked: false를 반환한다', async () => {
    const caller = createCaller({ userId: 'user-n' });
    await caller.map.getState({ mapId: 'map-1' });

    await expect(caller.item.pickup({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      picked: false,
    });
  });
});

describe('item.pickup 유저별 독립 보드', () => {
  it('한 유저가 아이템을 주워도 다른 유저의 스폰에는 영향이 없다(각자 독립적으로 성공)', async () => {
    const callerA = createCaller({ userId: 'user-o' });
    const callerB = createCaller({ userId: 'user-p' });

    // 스폰 시드에 userId가 섞여 들어가(2026-07-14, 재도전마다 위치가 달라야 한다는 요구사항
    // 반영) 두 유저의 스폰 좌표는 서로 다를 수 있다 — 각자 자기 목록에서 목표를 고른다.
    // 결과가 스폰 시점에 정해지므로 Math.random은 각자의 map.getState(시딩)를 감싼다.
    const randomSpy1 = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정
    const { mysteryBoxes: boxesA } = await callerA.map.getState({ mapId: 'map-1' });
    const { mysteryBoxes: boxesB } = await callerB.map.getState({ mapId: 'map-1' });
    randomSpy1.mockRestore();
    const targetA = boxesA[0]!;
    const targetB = boxesB[0]!;

    await walkAnchorTo(callerA, 'map-1', MAP_1_START, targetA);
    await walkAnchorTo(callerB, 'map-1', MAP_1_START, targetB);

    const [resultA, resultB] = await Promise.all([
      callerA.item.pickup({ mapId: 'map-1', x: targetA.x, y: targetA.y }),
      callerB.item.pickup({ mapId: 'map-1', x: targetB.x, y: targetB.y }),
    ]);

    // 유저별 독립 보드라 경쟁이 없다 — 두 유저 모두 같은 결과를 각자 성공적으로 주울 수 있다.
    expect(resultA).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
    expect(resultB).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
  });

  it('같은 유저가 동일 요청을 중복 전송해도 한 번만 성공한다', async () => {
    const caller = createCaller({ userId: 'user-dup' });
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const [first, second] = await Promise.all([
      caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y }),
      caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y }),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.picked)).toHaveLength(1);
    expect(results.filter((r) => !r.picked)).toHaveLength(1);
  });
});

describe('item.pickup 함정 탐지기 충전 + item.useDetector 라이브 스캔 (오라클 방지 조율 회귀 테스트)', () => {
  it('탐지기를 주우면 revealedTraps 없이 충전만 기록되고, 그 자리에서 useDetector로 체비셰프 거리 반경(7칸) 내 타 유저 함정만 조회된다', async () => {
    const picker = createCaller({ userId: 'user-picker' });
    // 2026-07-14(서버 2번): 결과가 스폰 시점에 정해지므로 Math.random은 map.getState(시딩)를 감싼다.
    const randomSpy1 = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const { mysteryBoxes } = await picker.map.getState({ mapId: 'map-1' }); // 앵커: (1,1)
    randomSpy1.mockRestore();
    const target = mysteryBoxes[0]!;
    const near = offsetWithinBounds(target.x, 3, MAP_1_WIDTH);
    const far = offsetWithinBounds(target.x, 8, MAP_1_WIDTH);

    const installer = createCaller({ userId: 'user-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'slow', x: near, y: target.y }); // 탐지기 픽업 지점과 체비셰프 거리 3 — 반경 내
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: far, y: target.y }); // 체비셰프 거리 8 — 반경(7) 밖

    // trap.trigger로만 이동해 다른 랜덤 스폰 박스를 건드리지 않고 target까지 도달(walkAnchorTo 주석 참고).
    await walkAnchorTo(picker, 'map-1', MAP_1_START, target);

    const pickupResult = await picker.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });

    expect(pickupResult).toEqual({ picked: true, outcome: 'item', type: 'detector' });

    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).toEqual(expect.arrayContaining([{ x: near, y: target.y, type: 'slow' }]));
    expect(revealedTraps).not.toContainEqual(expect.objectContaining({ x: far, y: target.y }));
  });

  it('본인이 설치한 함정은 반경 내에 있어도 useDetector 결과에서 제외된다(myTraps와의 중복 표시 방지)', async () => {
    const picker = createCaller({ userId: 'user-self-installer' });
    const randomSpy1 = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const { mysteryBoxes } = await picker.map.getState({ mapId: 'map-1' });
    randomSpy1.mockRestore();
    const target = mysteryBoxes[0]!;
    const near = offsetWithinBounds(target.x, 3, MAP_1_WIDTH);
    await picker.trap.install({ mapId: 'map-1', type: 'slow', x: near, y: target.y }); // 반경 내, 본인 설치

    await walkAnchorTo(picker, 'map-1', MAP_1_START, target);
    await picker.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });

    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).not.toContainEqual(expect.objectContaining({ x: near, y: target.y }));
  });

  it('맨해튼 거리 기준이었다면 반경 밖으로 잘못 제외됐을 대각선 방향 함정도 체비셰프 기준으로 포함된다(거리 계산 버그 회귀)', async () => {
    const picker = createCaller({ userId: 'user-cheby-picker' });
    const randomSpy1 = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const { mysteryBoxes } = await picker.map.getState({ mapId: 'map-1' });
    randomSpy1.mockRestore();
    const target = mysteryBoxes[0]!;
    const near = offsetWithinBounds(target.x, 3, MAP_1_WIDTH);
    const diagonalY = offsetWithinBounds(target.y, 1, MAP_1_HEIGHT);

    const installer = createCaller({ userId: 'user-cheby' });
    // 탐지기 픽업 지점 기준 dx=3,dy=1 → 체비셰프 거리 3(반경 내), 맨해튼 거리 4(구현이 맨해튼이었다면 반경 밖으로 누락됐을 케이스)
    await installer.trap.install({ mapId: 'map-1', type: 'reverse', x: near, y: diagonalY });

    await walkAnchorTo(picker, 'map-1', MAP_1_START, target);
    await picker.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });

    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).toContainEqual({ x: near, y: diagonalY, type: 'reverse' });
  });

  it('탐지기 외 아이템은 기존과 동일한 응답 형태로 반환한다(손전등/쉴드 영향 없음)', async () => {
    const caller = createCaller({ userId: 'user-r' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    randomSpy.mockRestore();
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const result = await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });
    expect(result).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
  });

  it('충전이 없으면 useDetector는 NO_CHARGE로 거부하고, 성공 후엔 충전이 소모돼 재사용이 다시 거부된다(1회성 서버 강제)', async () => {
    const caller = createCaller({ userId: 'user-charge' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    randomSpy.mockRestore();
    const target = mysteryBoxes[0]!;

    await expect(caller.item.useDetector({ mapId: 'map-1' })).rejects.toThrow('NO_CHARGE');

    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);
    await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y }); // 충전 1회 획득

    await caller.item.useDetector({ mapId: 'map-1' }); // 충전 1회 소모
    await expect(caller.item.useDetector({ mapId: 'map-1' })).rejects.toThrow('NO_CHARGE');
  });

  it('claimLoadout(trapDetector)으로 충전을 1회 얻을 수 있고, 중복 호출은 granted:false로 추가 충전을 막는다', async () => {
    const caller = createCaller({ userId: 'user-loadout' });
    await caller.map.getState({ mapId: 'map-1' });

    const first = await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' });
    expect(first).toEqual({ granted: true });
    const second = await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' });
    expect(second).toEqual({ granted: false });

    await caller.item.useDetector({ mapId: 'map-1' }); // 충전이 1개뿐이라 성공은 여기까지만
    await expect(caller.item.useDetector({ mapId: 'map-1' })).rejects.toThrow('NO_CHARGE');
  });

  it('claimLoadout(shield/flashlight)은 서버 개입이 필요 없어 항상 granted:true만 반환하고 충전에 영향 없다', async () => {
    const caller = createCaller({ userId: 'user-loadout-other' });
    await caller.map.getState({ mapId: 'map-1' });

    expect(await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'shield' })).toEqual({ granted: true });
    expect(await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'flashlight' })).toEqual({ granted: true });
    await expect(caller.item.useDetector({ mapId: 'map-1' })).rejects.toThrow('NO_CHARGE');
  });

  it('충전 1개로 useDetector를 동시에 2번 호출하면 하나만 성공하고 나머지는 NO_CHARGE로 거부된다(레이스 컨디션 회귀)', async () => {
    const caller = createCaller({ userId: 'user-race' });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    randomSpy.mockRestore();
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);
    await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y }); // 충전 1회 획득

    const results = await Promise.allSettled([
      caller.item.useDetector({ mapId: 'map-1' }),
      caller.item.useDetector({ mapId: 'map-1' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('NO_CHARGE');
  });

  it('충전 차감 후 위치 조회 등 후속 단계가 실패하면 충전을 롤백한다(NO_SESSION 회귀)', async () => {
    const caller = createCaller({ userId: 'user-rollback' });
    // map.getState를 호출하지 않아 위치 앵커가 없는 상태 — claimLoadout은 위치 앵커 없이도 충전을 준다.
    await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' });

    await expect(caller.item.useDetector({ mapId: 'map-1' })).rejects.toThrow('NO_SESSION');

    // 롤백이 안 됐다면 세션을 정상적으로 연 뒤에도 NO_CHARGE로 거부됐을 것이다.
    await caller.map.getState({ mapId: 'map-1' });
    await caller.item.useDetector({ mapId: 'map-1' });
  });

  // 서버 3번(2026-07-14): 탐지 대상을 설치형 함정뿐 아니라 스폰형 미스터리 박스(outcome:'trap')
  // 까지 확장 — 서버 2번(스폰 시점 미리 굴리기) 덕분에 아직 안 먹은 박스도 종류를 미리 알 수 있다.
  it('스폰형 함정(아직 안 먹은 미스터리 박스)도 반경 내면 useDetector로 종류까지 탐지된다', async () => {
    const caller = createCaller({ userId: 'user-spawn-detect' });
    const seedSpy = vi.spyOn(Math, 'random').mockReturnValue(4.5 / 8); // 모든 박스를 slow(함정)로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    seedSpy.mockRestore();
    const target = mysteryBoxes[0]!;

    await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' }); // 픽업과 무관하게 충전 획득
    // trap.trigger로만 이동해 target 타일 바로 위까지 도달 — item.pickup을 호출하지 않으므로
    // 박스는 여전히 "미확인" 상태로 보드에 남아있다.
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const { revealedTraps } = await caller.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).toContainEqual({ x: target.x, y: target.y, type: 'slow' });
  });

  it('스폰형 결과가 함정이 아니라 아이템이면 탐지 결과에 포함되지 않는다(트랩만 대상)', async () => {
    const caller = createCaller({ userId: 'user-spawn-item-not-detected' });
    const seedSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 모든 박스를 flashlight(아이템)로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    seedSpy.mockRestore();
    const target = mysteryBoxes[0]!;

    await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' });
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const { revealedTraps } = await caller.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).not.toContainEqual(expect.objectContaining({ x: target.x, y: target.y }));
  });

  it('반경(7칸) 밖 스폰형 함정은 탐지되지 않는다', async () => {
    const caller = createCaller({ userId: 'user-spawn-out-of-range' });
    const seedSpy = vi.spyOn(Math, 'random').mockReturnValue(4.5 / 8); // 모든 박스를 slow(함정)로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    seedSpy.mockRestore();

    const chebyshev = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const farBox = mysteryBoxes.find((box) => chebyshev(box, MAP_1_START) > 7);
    // 맵이 25x21이라 랜덤 8곳 중 시작점에서 7칸 넘게 떨어진 곳이 최소 하나는 있을 것으로 기대.
    expect(farBox).toBeDefined();

    await caller.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' });
    // 이동 없이 시작 좌표(1,1)에서 바로 스캔 — farBox는 반경 밖이어야 한다.
    const { revealedTraps } = await caller.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).not.toContainEqual(expect.objectContaining({ x: farBox!.x, y: farBox!.y }));
  });

  it('설치형+스폰형 함정이 동시에 반경 내에 있으면 둘 다 종류까지 함께 반환된다', async () => {
    const picker = createCaller({ userId: 'user-mixed-detect' });
    const seedSpy = vi.spyOn(Math, 'random').mockReturnValue(7.5 / 8); // 모든 박스를 reverse(함정)로 고정
    const { mysteryBoxes } = await picker.map.getState({ mapId: 'map-1' });
    seedSpy.mockRestore();
    const spawnTarget = mysteryBoxes[0]!;

    // 설치형은 스폰형(reverse)과 다른 타입(blind)으로 둬서 두 출처가 응답에 섞여도 명확히 구분되게 한다.
    const installer = createCaller({ userId: 'user-mixed-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: spawnTarget.x + 2, y: spawnTarget.y }); // 체비셰프 거리 2 — 반경 내

    await picker.item.claimLoadout({ mapId: 'map-1', loadoutId: 'trapDetector' });
    await walkAnchorTo(picker, 'map-1', MAP_1_START, spawnTarget);

    // arrayContaining이라 이 자리 근처의 다른 스폰형 함정(전부 reverse로 고정됨)이 우연히
    // 반경 안에 더 있어도 실패하지 않는다 — 최소한 이 두 건은 반드시 포함돼야 한다.
    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).toEqual(
      expect.arrayContaining([
        { x: spawnTarget.x, y: spawnTarget.y, type: 'reverse' },
        { x: spawnTarget.x + 2, y: spawnTarget.y, type: 'blind' },
      ])
    );
  });
});

describe('item.pickup 미스터리 박스 결과 8종 (Math.random 모킹)', () => {
  const cases: Array<[number, { picked: true; outcome: 'item' | 'trap'; type: string }]> = [
    [0, { picked: true, outcome: 'item', type: 'flashlight' }],
    [1, { picked: true, outcome: 'item', type: 'shield' }],
    [3, { picked: true, outcome: 'item', type: 'trapInstall' }],
    [4, { picked: true, outcome: 'trap', type: 'slow' }],
    [6, { picked: true, outcome: 'trap', type: 'blind' }],
    [7, { picked: true, outcome: 'trap', type: 'reverse' }],
  ];
  // 인덱스 2(detector)·5(respawn)는 부가 효과(반경 공개/위치 앵커 리셋)까지 있어 위/아래 별도 테스트에서 검증한다.

  it.each(cases)('풀 인덱스 %i는 해당 결과를 그대로 반환한다', async (index, expected) => {
    const caller = createCaller({ userId: `user-pool-${index}` });
    // 2026-07-14(서버 2번): 결과가 이제 스폰(시딩) 시점에 정해지므로, Math.random은 pickup이
    // 아니라 첫 map.getState(시딩을 트리거)를 감싸야 한다 — 이 값으로 8곳 전부가 동일한
    // 결과로 시딩되므로 어느 박스를 걸어가서 주워도 같은 결과가 나온다.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue((index + 0.5) / 8);
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    randomSpy.mockRestore();
    const target = mysteryBoxes[0]!;
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const result = await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y });
    expect(result).toEqual(expected);
  });
});

describe('item.pickup 스폰형 함정 (respawn 위치 앵커 리셋 회귀 테스트)', () => {
  it('outcome이 trap/respawn이면 위치 앵커가 시작 좌표로 리셋된다', async () => {
    const caller = createCaller({ userId: 'user-resp' });
    // 결과가 스폰 시점에 정해지므로 Math.random은 map.getState(시딩)를 감싼다.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(5.5 / 8); // 결과를 respawn으로 고정
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' }); // map-1 시작 좌표는 (1,1) — 앵커: (1,1)
    randomSpy.mockRestore();
    const target = mysteryBoxes[0]!;

    // target 바로 앞칸까지만 trap.trigger로 걷고, target 자체는 아래에서 item.pickup으로 밟는다
    // (target이 시작 좌표와 인접한 극단적 케이스라면 path가 비어있을 수 있음 — 그땐 stepBefore가
    // 시작 좌표 자신이 되고, 아래 "더 이상 인접하지 않음" 검증은 자연히 스킵된다).
    const path = computeWalkPath(MAP_1_START, target);
    const beforeTargetSteps = path.slice(0, -1);
    for (const step of beforeTargetSteps) {
      await caller.trap.trigger({ mapId: 'map-1', x: step.x, y: step.y });
    }
    const stepBefore = beforeTargetSteps.at(-1) ?? MAP_1_START;

    const result = await caller.item.pickup({ mapId: 'map-1', x: target.x, y: target.y }); // respawn 발동 시 (1,1)로 리셋

    expect(result).toEqual({ picked: true, outcome: 'trap', type: 'respawn' });

    // 앵커가 시작 좌표(1,1)로 리셋됐다면, target에만 인접했던 stepBefore는 더 이상 인접하지 않다.
    if (stepBefore.x !== MAP_1_START.x || stepBefore.y !== MAP_1_START.y) {
      await expect(caller.trap.trigger({ mapId: 'map-1', x: stepBefore.x, y: stepBefore.y })).rejects.toMatchObject({
        message: 'INVALID_MOVE',
      });
    }
    // 시작 좌표(1,1)에 인접한 (1,0)은 정상 처리된다 — 앵커가 실제로 리셋됐음을 확인.
    await expect(caller.trap.trigger({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({ hit: false });
  });
});

describe('move.arrive 통합 API (trap.trigger + item.pickup 통합, docs/design-docs/move-api-unification.md)', () => {
  it('map.getState 없이 호출하면 NO_SESSION 오류', async () => {
    const caller = createCaller({ userId: 'user-move-a' });
    await expect(caller.move.arrive({ mapId: 'map-1', x: 5, y: 5 })).rejects.toMatchObject({
      message: 'NO_SESSION',
    });
  });

  it('앵커에서 2칸 이상 떨어진 좌표는 INVALID_MOVE 오류', async () => {
    const caller = createCaller({ userId: 'user-move-b' });
    await caller.map.getState({ mapId: 'map-1' });
    await expect(caller.move.arrive({ mapId: 'map-1', x: 5, y: 5 })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
  });

  it('함정도 아이템도 없는 인접 타일은 trap.hit/item.picked 모두 false를 반환한다', async () => {
    const caller = createCaller({ userId: 'user-move-c' });
    await caller.map.getState({ mapId: 'map-1' });
    await expect(caller.move.arrive({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      trap: { hit: false },
      item: { picked: false },
    });
  });

  it('타인이 설치한 함정만 있는 칸은 hit:true를 반환하고 보드에서 소모된다(재방문 시 재발동 안 됨)', async () => {
    const installer = createCaller({ userId: 'user-move-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'slow', x: 1, y: 0 });

    const picker = createCaller({ userId: 'user-move-d' });
    await picker.map.getState({ mapId: 'map-1' });

    await expect(picker.move.arrive({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      trap: { hit: true, type: 'slow' },
      item: { picked: false },
    });

    // 소모됐으므로 같은 유저가 다시 인접해서 재조회해도 더 이상 발동하지 않는다.
    const other = createCaller({ userId: 'user-move-e' });
    await other.map.getState({ mapId: 'map-1' });
    await expect(other.move.arrive({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      trap: { hit: false },
      item: { picked: false },
    });
  });

  it('본인이 설치한 함정은 회피한다(trap.trigger와 동일 규칙) — 소모되지 않음', async () => {
    const caller = createCaller({ userId: 'user-move-f' });
    await caller.map.getState({ mapId: 'map-1' });
    await caller.trap.install({ mapId: 'map-1', type: 'slow', x: 1, y: 0 });

    await expect(caller.move.arrive({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      trap: { hit: false },
      item: { picked: false },
    });
  });

  it('아이템만 있는 칸은 rollMysteryOutcome 결과를 item에 담아 반환한다(트랩 필드는 항상 false)', async () => {
    const caller = createCaller({ userId: 'user-move-g' });
    const { mysteryBoxes } = await caller.map.getState({ mapId: 'map-1' });
    const target = mysteryBoxes[0]!;
    // trap.trigger는 아이템 보드를 안 건드리므로, target까지 미리 밟아둬도(walkAnchorTo) 이
    // 자리의 미스터리 박스는 그대로 남는다 — 이후 같은 좌표로 move.arrive를 다시 호출해도
    // 앵커 거리는 0이라 assertAdjacent를 통과한다(manhattanDistance > 1일 때만 거부).
    await walkAnchorTo(caller, 'map-1', MAP_1_START, target);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정
    const result = await caller.move.arrive({ mapId: 'map-1', x: target.x, y: target.y });
    randomSpy.mockRestore();

    expect(result).toEqual({
      trap: { hit: false },
      item: { picked: true, outcome: 'item', type: 'flashlight' },
    });
  });

  it('한 칸에 함정(respawn)과 미스터리 박스(detector)가 동시에 있으면 위치 앵커 리셋과 탐지기 충전이 중복 없이 함께 처리된다', async () => {
    const picker = createCaller({ userId: 'user-move-h' });
    const { mysteryBoxes } = await picker.map.getState({ mapId: 'map-1' }); // 앵커: (1,1)
    const target = mysteryBoxes[0]!;

    const installer = createCaller({ userId: 'user-move-h-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'respawn', x: target.x, y: target.y }); // 미스터리 박스 스폰과 같은 칸

    // target 직전 칸까지만 이동한다 — walkAnchorTo로 target까지 밟아버리면(trap.trigger) 방금
    // 설치한 함정이 move.arrive를 시험하기도 전에 먼저 소모돼, "한 칸에서 트랩+아이템 동시
    // 처리"라는 이 테스트의 핵심을 검증할 수 없다.
    for (const step of computeWalkPath(MAP_1_START, target).slice(0, -1)) {
      await picker.trap.trigger({ mapId: 'map-1', x: step.x, y: step.y });
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const result = await picker.move.arrive({ mapId: 'map-1', x: target.x, y: target.y });
    randomSpy.mockRestore();

    expect(result).toEqual({
      trap: { hit: true, type: 'respawn' },
      item: { picked: true, outcome: 'item', type: 'detector' },
    });

    // 앵커가 시작 좌표(1,1)로 리셋됐다면 옛 위치(target) 근처 이동은 더 이상 인접하지 않다.
    const farFromTarget = offsetWithinBounds(target.x, 1, MAP_1_WIDTH);
    await expect(picker.move.arrive({ mapId: 'map-1', x: farFromTarget, y: target.y })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
    // 시작 좌표(1,1)에 인접한 (1,0)은 정상 처리된다 — 앵커가 실제로 리셋됐음을 확인.
    await expect(picker.move.arrive({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      trap: { hit: false },
      item: { picked: false },
    });

    // 탐지기 충전도 함께 기록됐는지 확인(NO_CHARGE로 거부되지 않고 1회 성공).
    await picker.item.useDetector({ mapId: 'map-1' });
  });

  it('기존 trap.trigger/item.pickup과 보드를 공유한다 — move.arrive로 소모된 함정은 trap.trigger에서도 재발동하지 않는다', async () => {
    const installer = createCaller({ userId: 'user-move-i-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: 1, y: 0 });

    const caller = createCaller({ userId: 'user-move-i' });
    await caller.map.getState({ mapId: 'map-1' });
    await expect(caller.move.arrive({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({
      trap: { hit: true, type: 'blind' },
      item: { picked: false },
    });

    const other = createCaller({ userId: 'user-move-j' });
    await other.map.getState({ mapId: 'map-1' });
    await expect(other.trap.trigger({ mapId: 'map-1', x: 1, y: 0 })).resolves.toEqual({ hit: false });
  });

  it('동일 함정 타일에 두 유저가 동시에 접근하면 한쪽만 hit:true를 받는다(이중발동 회귀, docs/design-docs/move-run-finish-bugfixes.md 2절)', async () => {
    const installer = createCaller({ userId: 'user-move-race-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'slow', x: 1, y: 0 });

    const callerA = createCaller({ userId: 'user-move-race-a' });
    const callerB = createCaller({ userId: 'user-move-race-b' });
    await callerA.map.getState({ mapId: 'map-1' });
    await callerB.map.getState({ mapId: 'map-1' });

    const [resultA, resultB] = await Promise.all([
      callerA.move.arrive({ mapId: 'map-1', x: 1, y: 0 }),
      callerB.move.arrive({ mapId: 'map-1', x: 1, y: 0 }),
    ]);

    const hits = [resultA, resultB].filter((r) => r.trap.hit);
    expect(hits).toHaveLength(1);
  });
});

describe('leaderboard.get username 매핑', () => {
  it('reddit.getUserById로 조회된 username을 entry에 채운다', async () => {
    mocks.users.set('user-g', { username: 'maze-runner' });
    const caller = createCaller({ userId: 'user-g' });
    await caller.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(caller, 'map-1', MAP_1_START);
    await caller.run.finish({ mapId: 'map-1', steps: 20, clearTimeMs: 5000 });

    const { entries } = await caller.leaderboard.get({ mapId: 'map-1' });
    expect(entries).toEqual([
      { userId: 'user-g', username: 'maze-runner', steps: 20, clearTimeMs: 5000, rank: 1 },
    ]);
  });

  it('탈퇴/정지 등으로 조회가 안 되는 유저는 userId로 폴백한다', async () => {
    const caller = createCaller({ userId: 'user-h' });
    await caller.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(caller, 'map-1', MAP_1_START);
    await caller.run.finish({ mapId: 'map-1', steps: 20, clearTimeMs: 6000 });

    const { entries } = await caller.leaderboard.get({ mapId: 'map-1' });
    expect(entries[0]?.username).toBe('user-h');
  });

  it('한 엔트리의 getUserById가 reject해도 나머지 엔트리는 정상 반환되고, 실패한 엔트리는 userId로 폴백한다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.users.set('user-i', { username: 'runner-i' });
    mocks.rejectIds.add('user-j');

    const callerI = createCaller({ userId: 'user-i' });
    await callerI.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(callerI, 'map-1', MAP_1_START);
    await callerI.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 4000 });

    const callerJ = createCaller({ userId: 'user-j' });
    await callerJ.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(callerJ, 'map-1', MAP_1_START);
    await callerJ.run.finish({ mapId: 'map-1', steps: 20, clearTimeMs: 5000 });

    const { entries } = await createCaller({ userId: 'user-i' }).leaderboard.get({ mapId: 'map-1' });

    expect(entries).toEqual([
      { userId: 'user-i', username: 'runner-i', steps: 10, clearTimeMs: 4000, rank: 1 },
      { userId: 'user-j', username: 'user-j', steps: 20, clearTimeMs: 5000, rank: 2 },
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('걸음 수가 랭킹 1차 기준이다 — 시간이 더 걸려도 걸음 수가 적으면 상위', async () => {
    const callerFewerSteps = createCaller({ userId: 'user-fewer-steps' });
    await callerFewerSteps.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(callerFewerSteps, 'map-1', MAP_1_START);
    await callerFewerSteps.run.finish({
      mapId: 'map-1',
      steps: 10,
      clearTimeMs: 60000,
    });

    const callerMoreSteps = createCaller({ userId: 'user-more-steps' });
    await callerMoreSteps.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(callerMoreSteps, 'map-1', MAP_1_START);
    await callerMoreSteps.run.finish({
      mapId: 'map-1',
      steps: 20,
      clearTimeMs: 1000,
    });

    const { entries } = await createCaller({ userId: 'user-fewer-steps' }).leaderboard.get({
      mapId: 'map-1',
    });

    expect(entries.map((e) => e.userId)).toEqual(['user-fewer-steps', 'user-more-steps']);
  });

  it('걸음 수가 같으면 클리어 시간이 짧은 쪽이 상위(2차 타이브레이크)', async () => {
    const callerSlower = createCaller({ userId: 'user-slower' });
    await callerSlower.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(callerSlower, 'map-1', MAP_1_START);
    await callerSlower.run.finish({
      mapId: 'map-1',
      steps: 15,
      clearTimeMs: 9000,
    });

    const callerFaster = createCaller({ userId: 'user-faster' });
    await callerFaster.map.getState({ mapId: 'map-1' });
    await walkAnchorToGoal(callerFaster, 'map-1', MAP_1_START);
    await callerFaster.run.finish({
      mapId: 'map-1',
      steps: 15,
      clearTimeMs: 3000,
    });

    const { entries } = await createCaller({ userId: 'user-faster' }).leaderboard.get({ mapId: 'map-1' });

    expect(entries.map((e) => e.userId)).toEqual(['user-faster', 'user-slower']);
  });
});

describe('user.me', () => {
  it('현재 컨텍스트의 userId를 그대로 반환한다', async () => {
    const caller = createCaller({ userId: 'user-self' });
    await expect(caller.user.me()).resolves.toEqual({ userId: 'user-self' });
  });
});
