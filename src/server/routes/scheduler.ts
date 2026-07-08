import { Hono } from 'hono';
import { runDailyReset } from '../core/dailyReset';

type SchedulerResponse = {
  status: 'success' | 'error';
  message: string;
};

export const scheduler = new Hono();

scheduler.post('/daily-reset', async (c) => {
  try {
    const { date, alreadyRanToday } = await runDailyReset();

    if (alreadyRanToday) {
      // cron 재시도/중복 발동 등으로 같은 날짜에 두 번 호출된 경우 — 이 엔드포인트는
      // 멱등(순수 마커 갱신)이라 안전하게 무시하고 그대로 success를 반환한다.
      console.warn(`Daily reset already ran for ${date}, skipping duplicate run`);
    } else {
      // playtest 로그 스트림에서 cron이 실제로 발동했는지 육안으로 확인할 수 있도록 기록한다.
      console.log(`Daily reset ran for ${date}`);
    }

    return c.json<SchedulerResponse>(
      { status: 'success', message: `Daily reset marker updated for ${date}` },
      200
    );
  } catch (error) {
    console.error(`Daily reset failed: ${error}`);
    return c.json<SchedulerResponse>({ status: 'error', message: 'Failed to run daily reset' }, 400);
  }
});
