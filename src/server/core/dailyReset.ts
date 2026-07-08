import { redis } from '@devvit/web/server';
import { DAILY_RESET_MARKER_KEY, getKstDateString } from './redisKeys';

export type DailyResetResult = { date: string; alreadyRanToday: boolean };

/**
 * KST 자정에 devvit.json의 scheduler cron으로 호출된다(0 15 * * * UTC = 00:00 KST,
 * DST 없는 고정 오프셋이므로 항상 정확 — 단 devvit 스케줄러의 cron이 UTC 기준이라는 점은
 * 문서화되어 있지 않아 실제 devvit playtest로 발동 시각을 검증할 것).
 *
 * 발자국/함정/랭킹/위치앵커는 키 이름에 날짜가 포함돼 자동으로 새 키에서 시작하므로
 * (async-delivery.md 2절/8.1) 여기서 삭제할 대상이 없다. 아이템 스폰 초기화와 데일리 맵
 * 전환은 각각 items.md 미확정, 맵 로테이션 정책 미확정으로 아직 구현 범위 밖이다
 * (TODO.local.md 참조) — 확정되면 이 함수에 로직을 추가한다.
 */
export async function runDailyReset(now: Date = new Date()): Promise<DailyResetResult> {
  const date = getKstDateString(now);
  const alreadyRan = await redis.get(DAILY_RESET_MARKER_KEY);
  await redis.set(DAILY_RESET_MARKER_KEY, date);
  return { date, alreadyRanToday: alreadyRan === date };
}
