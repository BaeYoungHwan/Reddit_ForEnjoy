import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      get: vi.fn(async (key: string) => store.get(key)),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    },
  };
});

vi.mock('@devvit/web/server', () => ({ redis: mocks.redis }));

const { runDailyReset } = await import('./dailyReset');
const { DAILY_RESET_MARKER_KEY } = await import('./redisKeys');

beforeEach(() => {
  mocks.store.clear();
  vi.clearAllMocks();
});

describe('runDailyReset', () => {
  it('KST 자정 기준 날짜로 마커 키를 기록한다', async () => {
    // 2026-07-10 14:59:59 UTC = 2026-07-10 23:59:59 KST (자정 직전)
    const beforeMidnight = new Date('2026-07-10T14:59:59Z');
    const result = await runDailyReset(beforeMidnight);

    expect(result).toEqual({ date: '2026-07-10', alreadyRanToday: false });
    expect(mocks.store.get(DAILY_RESET_MARKER_KEY)).toBe('2026-07-10');
  });

  it('KST 자정을 넘긴 시각은 다음 날짜로 기록한다', async () => {
    // 2026-07-10 15:00:00 UTC = 2026-07-11 00:00:00 KST (정확히 자정)
    const atMidnight = new Date('2026-07-10T15:00:00Z');
    const result = await runDailyReset(atMidnight);

    expect(result).toEqual({ date: '2026-07-11', alreadyRanToday: false });
  });

  it('같은 날짜에 두 번 호출되면 alreadyRanToday가 true', async () => {
    const now = new Date('2026-07-11T00:00:00Z');
    await runDailyReset(now);
    const second = await runDailyReset(now);

    expect(second.alreadyRanToday).toBe(true);
  });
});
