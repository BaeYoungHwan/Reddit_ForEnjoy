/**
 * 서버 인스턴스/브라우저의 시스템 타임존에 의존하면 리셋 기준이 배포 환경/유저 기기마다
 * 달라질 수 있어, UTC 시각에 KST(UTC+9) 오프셋을 직접 더해 날짜를 계산한다. 클라이언트(오늘의
 * 맵 선택)와 서버(자정 리셋, Redis 키)가 항상 같은 날짜 문자열을 봐야 하므로 shared에 둔다.
 */
export function getKstDateString(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
