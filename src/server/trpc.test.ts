import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    reset(): void {
      this.strings.clear();
      this.hashes.clear();
      this.zsets.clear();
      this.versions.clear();
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

    async set(key: string, value: string, options?: { nx?: boolean }): Promise<string | null> {
      if (options?.nx && this.strings.has(key)) return null;
      this.strings.set(key, value);
      this.bump(key);
      return 'OK';
    }

    async del(...keys: string[]): Promise<void> {
      for (const key of keys) {
        const existed = this.strings.delete(key) || this.hashes.delete(key) || this.zsets.delete(key);
        if (existed) this.bump(key);
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
          queued.push(() => this.hSetSync(key, fieldValues));
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
    await caller.run.finish({ mapId: 'map-1', clearTimeMs: 12345 });

    await caller.map.getState({ mapId: 'map-1' }); // 새 런 — 앵커가 (0,0)으로 재초기화됨

    // (0,0) 기준으로는 인접하지 않은 좌표라 거부되어야 앵커가 실제로 리셋됐음을 확인할 수 있다
    await expect(caller.trap.trigger({ mapId: 'map-1', x: 2, y: 0 })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
  });
});

describe('map.getState 아이템 시딩', () => {
  it('첫 호출 시 고정 스폰 좌표로 아이템이 채워지고, 재호출해도 같은 목록을 반환한다', async () => {
    const caller = createCaller({ userId: 'user-k' });
    const first = await caller.map.getState({ mapId: 'map-1' });
    const second = await caller.map.getState({ mapId: 'map-1' });

    expect(first.items).toEqual(
      expect.arrayContaining([
        { x: 3, y: 1, type: 'flashlight' },
        { x: 7, y: 5, type: 'shield' },
      ])
    );
    expect(second.items).toEqual(first.items);
  });

  it('아이템을 주운 뒤 재호출해도 해당 아이템이 다시 채워지지 않는다(재생성 버그 회귀)', async () => {
    const caller = createCaller({ userId: 'user-q' });
    await caller.map.getState({ mapId: 'map-1' });
    await caller.item.pickup({ mapId: 'map-1', x: 1, y: 0 });
    await caller.item.pickup({ mapId: 'map-1', x: 2, y: 0 });
    await caller.item.pickup({ mapId: 'map-1', x: 2, y: 1 });
    const result = await caller.item.pickup({ mapId: 'map-1', x: 3, y: 1 });
    expect(result).toEqual({ picked: true, type: 'flashlight' });

    const state = await caller.map.getState({ mapId: 'map-1' });
    expect(state.items).not.toContainEqual({ x: 3, y: 1, type: 'flashlight' });
    expect(state.items).toContainEqual({ x: 7, y: 5, type: 'shield' });
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

    // 두 유저 모두 아이템 좌표(3,1)에 인접하도록 앵커를 맞춰둔다.
    await callerA.map.getState({ mapId: 'map-1' });
    await callerA.item.pickup({ mapId: 'map-1', x: 1, y: 0 }); // 앵커: (1,0) → (3,1)과는 별개 경로
    await callerB.map.getState({ mapId: 'map-1' });
    await callerB.item.pickup({ mapId: 'map-1', x: 1, y: 0 });

    // 두 유저 모두 인접 이동을 반복해 (3,1) 근처(2,1)까지 이동시킨다.
    await callerA.item.pickup({ mapId: 'map-1', x: 2, y: 0 });
    await callerA.item.pickup({ mapId: 'map-1', x: 2, y: 1 });
    await callerB.item.pickup({ mapId: 'map-1', x: 2, y: 0 });
    await callerB.item.pickup({ mapId: 'map-1', x: 2, y: 1 });

    const [resultA, resultB] = await Promise.all([
      callerA.item.pickup({ mapId: 'map-1', x: 3, y: 1 }),
      callerB.item.pickup({ mapId: 'map-1', x: 3, y: 1 }),
    ]);

    // 유저별 독립 보드라 경쟁이 없다 — 두 유저 모두 같은 아이템을 각자 성공적으로 주울 수 있다.
    expect(resultA).toEqual({ picked: true, type: 'flashlight' });
    expect(resultB).toEqual({ picked: true, type: 'flashlight' });
  });

  it('같은 유저가 동일 요청을 중복 전송해도 한 번만 성공한다', async () => {
    const caller = createCaller({ userId: 'user-dup' });
    await caller.map.getState({ mapId: 'map-1' });
    await caller.item.pickup({ mapId: 'map-1', x: 1, y: 0 });
    await caller.item.pickup({ mapId: 'map-1', x: 2, y: 0 });
    await caller.item.pickup({ mapId: 'map-1', x: 2, y: 1 });

    const [first, second] = await Promise.all([
      caller.item.pickup({ mapId: 'map-1', x: 3, y: 1 }),
      caller.item.pickup({ mapId: 'map-1', x: 3, y: 1 }),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.picked)).toHaveLength(1);
    expect(results.filter((r) => !r.picked)).toHaveLength(1);
  });
});

describe('item.pickup 함정 탐지기 (반경 공개, 오라클 방지 조율 회귀 테스트)', () => {
  it('탐지기를 주우면 반경(3칸) 내 타 유저 함정만 revealedTraps로 함께 반환한다', async () => {
    const installer = createCaller({ userId: 'user-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'slow', x: 17, y: 9 }); // 탐지기 스폰(14,9)과 거리 3 — 반경 내
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: 18, y: 9 }); // 거리 4 — 반경 밖

    const picker = createCaller({ userId: 'user-picker' });
    await picker.map.getState({ mapId: 'map-1' }); // 앵커: (0,0)
    for (let x = 1; x <= 14; x++) {
      await picker.item.pickup({ mapId: 'map-1', x, y: 0 });
    }
    for (let y = 1; y <= 8; y++) {
      await picker.item.pickup({ mapId: 'map-1', x: 14, y });
    }

    const result = await picker.item.pickup({ mapId: 'map-1', x: 14, y: 9 });
    expect(result.picked).toBe(true);
    expect(result.type).toBe('detector');
    expect(result.revealedTraps).toEqual(expect.arrayContaining([{ x: 17, y: 9, type: 'slow' }]));
    expect(result.revealedTraps).not.toContainEqual(expect.objectContaining({ x: 18, y: 9 }));
  });

  it('탐지기 외 아이템은 revealedTraps 없이 반환한다(기존 손전등/쉴드 응답 형태 불변)', async () => {
    const caller = createCaller({ userId: 'user-r' });
    await caller.map.getState({ mapId: 'map-1' });
    await caller.item.pickup({ mapId: 'map-1', x: 1, y: 0 });
    await caller.item.pickup({ mapId: 'map-1', x: 2, y: 0 });
    await caller.item.pickup({ mapId: 'map-1', x: 2, y: 1 });

    await expect(caller.item.pickup({ mapId: 'map-1', x: 3, y: 1 })).resolves.toEqual({
      picked: true,
      type: 'flashlight',
    });
  });
});

describe('leaderboard.get username 매핑', () => {
  it('reddit.getUserById로 조회된 username을 entry에 채운다', async () => {
    mocks.users.set('user-g', { username: 'maze-runner' });
    const caller = createCaller({ userId: 'user-g' });
    await caller.run.finish({ mapId: 'map-1', clearTimeMs: 5000 });

    const { entries } = await caller.leaderboard.get({ mapId: 'map-1' });
    expect(entries).toEqual([{ userId: 'user-g', username: 'maze-runner', clearTimeMs: 5000, rank: 1 }]);
  });

  it('탈퇴/정지 등으로 조회가 안 되는 유저는 userId로 폴백한다', async () => {
    const caller = createCaller({ userId: 'user-h' });
    await caller.run.finish({ mapId: 'map-1', clearTimeMs: 6000 });

    const { entries } = await caller.leaderboard.get({ mapId: 'map-1' });
    expect(entries[0]?.username).toBe('user-h');
  });

  it('한 엔트리의 getUserById가 reject해도 나머지 엔트리는 정상 반환되고, 실패한 엔트리는 userId로 폴백한다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.users.set('user-i', { username: 'runner-i' });
    mocks.rejectIds.add('user-j');

    await createCaller({ userId: 'user-i' }).run.finish({ mapId: 'map-1', clearTimeMs: 4000 });
    await createCaller({ userId: 'user-j' }).run.finish({ mapId: 'map-1', clearTimeMs: 5000 });

    const { entries } = await createCaller({ userId: 'user-i' }).leaderboard.get({ mapId: 'map-1' });

    expect(entries).toEqual([
      { userId: 'user-i', username: 'runner-i', clearTimeMs: 4000, rank: 1 },
      { userId: 'user-j', username: 'user-j', clearTimeMs: 5000, rank: 2 },
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});
