import type { Position } from '../../shared/game-types';

// 2026-07-13: 클라이언트(오늘의 맵 선택, shared/maps.ts의 pickDailyMapId)도 서버와 동일한
// 날짜 문자열을 계산해야 해서 shared/kstDate.ts로 옮김 — 기존 호출부(`./redisKeys`에서 import)가
// 안 깨지도록 여기서 재수출한다.
export { getKstDateString } from '../../shared/kstDate';

export const tileMember = (pos: Position): string => `${pos.x}:${pos.y}`;

export function parseTile(member: string): Position {
  const [x, y] = member.split(':').map(Number);
  return { x: Number.isFinite(x) ? x! : 0, y: Number.isFinite(y) ? y! : 0 };
}

export const footprintKey = (mapId: string, date: string): string => `footprint:${mapId}:${date}`;

export const trapBoardKey = (mapId: string, date: string): string => `trap:${mapId}:${date}`;

export const trapInstallerKey = (mapId: string, date: string, userId: string): string =>
  `trap:installer:${mapId}:${date}:${userId}`;

// 유저별 독립 보드 — 고정 스폰 좌표가 소수(현재 맵당 2곳)라 전역 공유로 두면 가장 먼저
// 도착한 유저가 그날 하루 치를 전부 가져가 버려 후속 유저는 리셋 전까지 아이템을 볼 수 없다.
// 함정(trapBoardKey)처럼 전원 공유가 아니라, 유저마다 자기만의 픽업 상태를 갖게 한다.
export const itemBoardKey = (mapId: string, date: string, userId: string): string =>
  `item:${mapId}:${date}:${userId}`;

export const itemSeededKey = (mapId: string, date: string, userId: string): string =>
  `item:seeded:${mapId}:${date}:${userId}`;

// 2026-07-14: 같은 날 재도전(run.finish가 itemSeededKey/itemBoardKey를 지움, trpc.ts 참고)해도
// 미스터리 박스 스폰 배치가 매번 달라져야 한다는 요구사항 때문에, 시딩할 때마다 증가하는
// 카운터를 스폰 시드에 섞어 넣는다. Date.now()만으로는 재시딩이 같은 밀리초 안에 연달아
// 일어나면(테스트처럼 실제 I/O 지연이 없는 환경 등) 시드가 우연히 같아질 수 있어, 원자적으로
// 항상 서로 다른 값을 보장하는 INCR 카운터를 대신 쓴다.
export const itemSeedGenerationKey = (mapId: string, date: string, userId: string): string =>
  `item:seedgen:${mapId}:${date}:${userId}`;

export const leaderboardKey = (mapId: string, date: string): string => `leaderboard:${mapId}:${date}`;

// leaderboardKey의 정렬 스코어는 steps/clearTimeMs를 하나의 숫자로 합쳐 인코딩(아래
// encodeLeaderboardScore 참고)한 값이라 그 자체로는 화면에 표시할 원본 걸음 수/시간을 복원할 수
// 없다. 이 해시에 유저별 원본 {steps, clearTimeMs}를 따로 저장해 leaderboard.get에서 읽어 쓴다.
export const leaderboardDetailKey = (mapId: string, date: string): string =>
  `leaderboard:detail:${mapId}:${date}`;

// 랭킹은 걸음 수(steps) 1차, 클리어 시간(clearTimeMs) 2차(동점 타이브레이크) 기준이다. Redis
// sorted set의 스코어는 숫자 하나뿐이라, steps를 상위 자리로 두고 clearTimeMs를 하위 자리에
// 끼워넣어 "낮을수록 좋다" 정렬 하나로 두 기준을 동시에 표현한다.
// TIME_SLOT_MS(하루)보다 실제 클리어 시간이 길어질 일은 없다고 가정하되, 페이지를 며칠씩 열어둔
// 채로 방치하다 골인하는 극단적인 경우에도 다음 steps 구간을 침범하지 않도록 clamp한다.
const TIME_SLOT_MS = 24 * 60 * 60 * 1000;
export function encodeLeaderboardScore(steps: number, clearTimeMs: number): number {
  const clampedTimeMs = Math.min(clearTimeMs, TIME_SLOT_MS - 1);
  return steps * TIME_SLOT_MS + clampedTimeMs;
}

export const positionAnchorKey = (mapId: string, date: string, userId: string): string =>
  `pos:${mapId}:${date}:${userId}`;

// 함정 탐지기 "충전"(사용 가능 횟수) 카운터 — 미스터리 박스 픽업/로드아웃 클레임이 +1,
// item.useDetector 성공 시 -1. 1회성을 서버가 강제하기 위한 값이라 클라이언트는 몰라도 된다.
export const detectorChargeKey = (mapId: string, date: string, userId: string): string =>
  `detector:charge:${mapId}:${date}:${userId}`;

// 로드아웃으로 지급된 탐지기를 서버에 등록(충전)한 적 있는지 판정하는 1회성 마커.
// ensureMysteryBoxesSeeded의 SET NX 패턴과 동일 — 같은 유저가 item.claimLoadout을 중복
// 호출해도(새로고침 등) 충전이 여러 번 쌓이지 않게 막는다.
export const loadoutClaimedKey = (mapId: string, date: string, userId: string): string =>
  `loadout:claimed:${mapId}:${date}:${userId}`;

/**
 * 발자국/함정/랭킹/위치앵커는 키 이름에 날짜가 포함돼 자정이 지나면 자동으로 새 키에서
 * 시작하므로(async-delivery.md 2절/8.1) 별도 삭제 로직이 필요 없다. 이 키는 그 자동 리셋이
 * 실제로 발동했는지 확인하기 위한 관측용 마커일 뿐, 게임 로직이 이 키를 참조하지는 않는다.
 */
export const DAILY_RESET_MARKER_KEY = 'system:last-daily-reset';
