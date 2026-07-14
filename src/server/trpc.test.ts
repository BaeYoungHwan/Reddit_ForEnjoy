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
    await caller.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정(부수효과 없음)
    const picked = await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 });
    randomSpy.mockRestore();
    expect(picked.picked).toBe(true);

    // 리셋 전이라면 (기존 "재생성 버그" 회귀 테스트처럼) (5,12)는 다시 채워지지 않아야 정상이다.
    const beforeFinish = await caller.map.getState({ mapId: 'map-1' });
    expect(beforeFinish.mysteryBoxes).not.toContainEqual({ x: 5, y: 12 });

    await caller.run.finish({ mapId: 'map-1', steps: 30, clearTimeMs: 20000 });

    const afterFinish = await caller.map.getState({ mapId: 'map-1' });
    expect(afterFinish.mysteryBoxes).toEqual(
      expect.arrayContaining([
        { x: 5, y: 12 },
        { x: 9, y: 1 },
        { x: 15, y: 12 },
      ])
    );
  });

  it('신기록이 아니어도(더 느린 재도전) 아이템 보드는 항상 리셋된다', async () => {
    const caller = createCaller({ userId: 'user-reset-b' });
    await caller.map.getState({ mapId: 'map-1' });
    await caller.run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 5000 }); // 1차: 신기록

    // 리셋된 보드에서 (5,12)를 다시 주운다.
    await caller.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8);
    await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 });
    randomSpy.mockRestore();

    const result = await caller.run.finish({ mapId: 'map-1', steps: 50, clearTimeMs: 90000 }); // 2차: 신기록 아님
    expect(result.isNewRecord).toBe(false);

    const state = await caller.map.getState({ mapId: 'map-1' });
    expect(state.mysteryBoxes).toContainEqual({ x: 5, y: 12 });
  });
});

describe('map.getState 미스터리 박스 시딩', () => {
  it('첫 호출 시 고정 스폰 좌표가 채워지고, 재호출해도 같은 목록을 반환한다(타입은 노출하지 않음)', async () => {
    const caller = createCaller({ userId: 'user-k' });
    const first = await caller.map.getState({ mapId: 'map-1' });
    const second = await caller.map.getState({ mapId: 'map-1' });

    expect(first.mysteryBoxes).toEqual(
      expect.arrayContaining([
        { x: 5, y: 12 },
        { x: 9, y: 1 },
      ])
    );
    expect(second.mysteryBoxes).toEqual(first.mysteryBoxes);
  });

  it('픽업한 뒤 재호출해도 해당 박스가 다시 채워지지 않는다(재생성 버그 회귀)', async () => {
    const caller = createCaller({ userId: 'user-q' });
    await caller.map.getState({ mapId: 'map-1' });
    // 앵커(1,1) -> (5,12): 인접 이동만 반복(실제 미로 벽은 검증하지 않음, 거리<=1만 확인).
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }
    const result = await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 });
    expect(result.picked).toBe(true);

    const state = await caller.map.getState({ mapId: 'map-1' });
    expect(state.mysteryBoxes).not.toContainEqual({ x: 5, y: 12 });
    expect(state.mysteryBoxes).toContainEqual({ x: 9, y: 1 });
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

    // 두 유저 모두 아이템 좌표(5,12)에 인접하도록 앵커를 맞춰둔다.
    await callerA.map.getState({ mapId: 'map-1' });
    await callerB.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await callerA.item.pickup({ mapId: 'map-1', x, y: 1 });
      await callerB.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await callerA.item.pickup({ mapId: 'map-1', x: 5, y });
      await callerB.item.pickup({ mapId: 'map-1', x: 5, y });
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정
    const [resultA, resultB] = await Promise.all([
      callerA.item.pickup({ mapId: 'map-1', x: 5, y: 12 }),
      callerB.item.pickup({ mapId: 'map-1', x: 5, y: 12 }),
    ]);
    randomSpy.mockRestore();

    // 유저별 독립 보드라 경쟁이 없다 — 두 유저 모두 같은 결과를 각자 성공적으로 주울 수 있다.
    expect(resultA).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
    expect(resultB).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
  });

  it('같은 유저가 동일 요청을 중복 전송해도 한 번만 성공한다', async () => {
    const caller = createCaller({ userId: 'user-dup' });
    await caller.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }

    const [first, second] = await Promise.all([
      caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 }),
      caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 }),
    ]);

    const results = [first, second];
    expect(results.filter((r) => r.picked)).toHaveLength(1);
    expect(results.filter((r) => !r.picked)).toHaveLength(1);
  });
});

describe('item.pickup 함정 탐지기 충전 + item.useDetector 라이브 스캔 (오라클 방지 조율 회귀 테스트)', () => {
  it('탐지기를 주우면 revealedTraps 없이 충전만 기록되고, 그 자리에서 useDetector로 체비셰프 거리 반경(3칸) 내 타 유저 함정만 조회된다', async () => {
    const installer = createCaller({ userId: 'user-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'slow', x: 18, y: 12 }); // 탐지기 스폰(15,12)과 체비셰프 거리 3 — 반경 내
    await installer.trap.install({ mapId: 'map-1', type: 'blind', x: 19, y: 12 }); // 체비셰프 거리 4 — 반경 밖

    const picker = createCaller({ userId: 'user-picker' });
    await picker.map.getState({ mapId: 'map-1' }); // 앵커: (1,1)

    // 걷는 경로가 (9,1)의 실제 미스터리 박스 스폰(items.ts MAP_1_MYSTERY_SPAWNS)을 지나가므로,
    // 모킹 없이 걸으면 진짜 랜덤 굴림이 발생해 respawn이 나올 경우 앵커가 시작 좌표로 리셋되는
    // flaky 버그가 있었다 — 걷는 동안엔 항상 안전한 결과(flashlight, index 0)로 고정한다.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let x = 2; x <= 15; x++) {
      await picker.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y <= 11; y++) {
      await picker.item.pickup({ mapId: 'map-1', x: 15, y });
    }

    randomSpy.mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const pickupResult = await picker.item.pickup({ mapId: 'map-1', x: 15, y: 12 });
    randomSpy.mockRestore();

    expect(pickupResult).toEqual({ picked: true, outcome: 'item', type: 'detector' });

    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).toEqual(expect.arrayContaining([{ x: 18, y: 12, type: 'slow' }]));
    expect(revealedTraps).not.toContainEqual(expect.objectContaining({ x: 19, y: 12 }));
  });

  it('본인이 설치한 함정은 반경 내에 있어도 useDetector 결과에서 제외된다(myTraps와의 중복 표시 방지)', async () => {
    const picker = createCaller({ userId: 'user-self-installer' });
    await picker.map.getState({ mapId: 'map-1' });
    await picker.trap.install({ mapId: 'map-1', type: 'slow', x: 18, y: 12 }); // 탐지기 스폰(15,12)과 체비셰프 거리 3 — 반경 내, 본인 설치

    // (9,1) 실제 미스터리 박스 스폰을 지나가므로 걷는 동안엔 안전한 결과로 고정(위 테스트 주석 참고).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let x = 2; x <= 15; x++) {
      await picker.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y <= 11; y++) {
      await picker.item.pickup({ mapId: 'map-1', x: 15, y });
    }

    randomSpy.mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    await picker.item.pickup({ mapId: 'map-1', x: 15, y: 12 });
    randomSpy.mockRestore();

    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).not.toContainEqual(expect.objectContaining({ x: 18, y: 12 }));
  });

  it('맨해튼 거리 기준이었다면 반경 밖으로 잘못 제외됐을 대각선 방향 함정도 체비셰프 기준으로 포함된다(거리 계산 버그 회귀)', async () => {
    const installer = createCaller({ userId: 'user-cheby' });
    // 탐지기 스폰(15,12) 기준 dx=3,dy=1 → 체비셰프 거리 3(반경 내), 맨해튼 거리 4(구현이 맨해튼이었다면 반경 밖으로 누락됐을 케이스)
    await installer.trap.install({ mapId: 'map-1', type: 'reverse', x: 18, y: 13 });

    const picker = createCaller({ userId: 'user-cheby-picker' });
    await picker.map.getState({ mapId: 'map-1' });

    // (9,1) 실제 미스터리 박스 스폰을 지나가므로 걷는 동안엔 안전한 결과로 고정(위 테스트 주석 참고).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    for (let x = 2; x <= 15; x++) {
      await picker.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y <= 11; y++) {
      await picker.item.pickup({ mapId: 'map-1', x: 15, y });
    }

    randomSpy.mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    await picker.item.pickup({ mapId: 'map-1', x: 15, y: 12 });
    randomSpy.mockRestore();

    const { revealedTraps } = await picker.item.useDetector({ mapId: 'map-1' });
    expect(revealedTraps).toContainEqual({ x: 18, y: 13, type: 'reverse' });
  });

  it('탐지기 외 아이템은 기존과 동일한 응답 형태로 반환한다(손전등/쉴드 영향 없음)', async () => {
    const caller = createCaller({ userId: 'user-r' });
    await caller.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정
    const result = await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 });
    randomSpy.mockRestore();

    expect(result).toEqual({ picked: true, outcome: 'item', type: 'flashlight' });
  });

  it('충전이 없으면 useDetector는 NO_CHARGE로 거부하고, 성공 후엔 충전이 소모돼 재사용이 다시 거부된다(1회성 서버 강제)', async () => {
    const caller = createCaller({ userId: 'user-charge' });
    await caller.map.getState({ mapId: 'map-1' });

    await expect(caller.item.useDetector({ mapId: 'map-1' })).rejects.toThrow('NO_CHARGE');

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }
    await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 }); // 충전 1회 획득
    randomSpy.mockRestore();

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
    await caller.map.getState({ mapId: 'map-1' });

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }
    await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 }); // 충전 1회 획득
    randomSpy.mockRestore();

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
    await caller.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y });
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue((index + 0.5) / 8);
    const result = await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 });
    randomSpy.mockRestore();

    expect(result).toEqual(expected);
  });
});

describe('item.pickup 스폰형 함정 (respawn 위치 앵커 리셋 회귀 테스트)', () => {
  it('outcome이 trap/respawn이면 위치 앵커가 시작 좌표로 리셋된다', async () => {
    const caller = createCaller({ userId: 'user-resp' });
    await caller.map.getState({ mapId: 'map-1' }); // map-1 시작 좌표는 (1,1) — 앵커: (1,1)
    for (let x = 2; x <= 5; x++) {
      await caller.item.pickup({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.item.pickup({ mapId: 'map-1', x: 5, y }); // 앵커: (5,11)
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(5.5 / 8); // 결과를 respawn으로 고정
    const result = await caller.item.pickup({ mapId: 'map-1', x: 5, y: 12 }); // 앵커: (5,12) → respawn 발동 시 (1,1)로 리셋
    randomSpy.mockRestore();

    expect(result).toEqual({ picked: true, outcome: 'trap', type: 'respawn' });

    // 앵커가 시작 좌표(1,1)로 리셋됐다면, (5,12)에만 인접했던 (5,11)은 더 이상 인접하지 않다.
    await expect(caller.trap.trigger({ mapId: 'map-1', x: 5, y: 11 })).rejects.toMatchObject({
      message: 'INVALID_MOVE',
    });
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
    await caller.map.getState({ mapId: 'map-1' });
    for (let x = 2; x <= 5; x++) {
      await caller.move.arrive({ mapId: 'map-1', x, y: 1 });
    }
    for (let y = 2; y < 12; y++) {
      await caller.move.arrive({ mapId: 'map-1', x: 5, y });
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5 / 8); // 결과를 flashlight로 고정
    const result = await caller.move.arrive({ mapId: 'map-1', x: 5, y: 12 });
    randomSpy.mockRestore();

    expect(result).toEqual({
      trap: { hit: false },
      item: { picked: true, outcome: 'item', type: 'flashlight' },
    });
  });

  it('한 칸에 함정(respawn)과 미스터리 박스(detector)가 동시에 있으면 위치 앵커 리셋과 탐지기 충전이 중복 없이 함께 처리된다', async () => {
    const installer = createCaller({ userId: 'user-move-h-installer' });
    await installer.trap.install({ mapId: 'map-1', type: 'respawn', x: 9, y: 1 }); // 미스터리 박스 스폰(9,1)과 같은 칸

    const picker = createCaller({ userId: 'user-move-h' });
    await picker.map.getState({ mapId: 'map-1' }); // map-1 시작 좌표(1,1) — 앵커: (1,1)
    for (let x = 2; x <= 8; x++) {
      await picker.move.arrive({ mapId: 'map-1', x, y: 1 }); // 앵커: (8,1)
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(2.5 / 8); // 결과를 detector로 고정
    const result = await picker.move.arrive({ mapId: 'map-1', x: 9, y: 1 });
    randomSpy.mockRestore();

    expect(result).toEqual({
      trap: { hit: true, type: 'respawn' },
      item: { picked: true, outcome: 'item', type: 'detector' },
    });

    // 앵커가 시작 좌표(1,1)로 리셋됐다면 옛 위치(9,1) 근처 이동은 더 이상 인접하지 않다.
    await expect(picker.move.arrive({ mapId: 'map-1', x: 10, y: 1 })).rejects.toMatchObject({
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
});

describe('leaderboard.get username 매핑', () => {
  it('reddit.getUserById로 조회된 username을 entry에 채운다', async () => {
    mocks.users.set('user-g', { username: 'maze-runner' });
    const caller = createCaller({ userId: 'user-g' });
    await caller.run.finish({ mapId: 'map-1', steps: 20, clearTimeMs: 5000 });

    const { entries } = await caller.leaderboard.get({ mapId: 'map-1' });
    expect(entries).toEqual([
      { userId: 'user-g', username: 'maze-runner', steps: 20, clearTimeMs: 5000, rank: 1 },
    ]);
  });

  it('탈퇴/정지 등으로 조회가 안 되는 유저는 userId로 폴백한다', async () => {
    const caller = createCaller({ userId: 'user-h' });
    await caller.run.finish({ mapId: 'map-1', steps: 20, clearTimeMs: 6000 });

    const { entries } = await caller.leaderboard.get({ mapId: 'map-1' });
    expect(entries[0]?.username).toBe('user-h');
  });

  it('한 엔트리의 getUserById가 reject해도 나머지 엔트리는 정상 반환되고, 실패한 엔트리는 userId로 폴백한다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.users.set('user-i', { username: 'runner-i' });
    mocks.rejectIds.add('user-j');

    await createCaller({ userId: 'user-i' }).run.finish({ mapId: 'map-1', steps: 10, clearTimeMs: 4000 });
    await createCaller({ userId: 'user-j' }).run.finish({ mapId: 'map-1', steps: 20, clearTimeMs: 5000 });

    const { entries } = await createCaller({ userId: 'user-i' }).leaderboard.get({ mapId: 'map-1' });

    expect(entries).toEqual([
      { userId: 'user-i', username: 'runner-i', steps: 10, clearTimeMs: 4000, rank: 1 },
      { userId: 'user-j', username: 'user-j', steps: 20, clearTimeMs: 5000, rank: 2 },
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });

  it('걸음 수가 랭킹 1차 기준이다 — 시간이 더 걸려도 걸음 수가 적으면 상위', async () => {
    await createCaller({ userId: 'user-fewer-steps' }).run.finish({
      mapId: 'map-1',
      steps: 10,
      clearTimeMs: 60000,
    });
    await createCaller({ userId: 'user-more-steps' }).run.finish({
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
    await createCaller({ userId: 'user-slower' }).run.finish({
      mapId: 'map-1',
      steps: 15,
      clearTimeMs: 9000,
    });
    await createCaller({ userId: 'user-faster' }).run.finish({
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
