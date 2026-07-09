import type { Position } from '../../shared/game-types';

/**
 * 서버 인스턴스의 시스템 타임존에 의존하면 리셋 기준이 배포 환경마다 달라질 수 있어,
 * UTC 시각에 KST(UTC+9) 오프셋을 직접 더해 날짜를 계산한다.
 */
export function getKstDateString(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

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

export const leaderboardKey = (mapId: string, date: string): string => `leaderboard:${mapId}:${date}`;

export const positionAnchorKey = (mapId: string, date: string, userId: string): string =>
  `pos:${mapId}:${date}:${userId}`;

/**
 * 발자국/함정/랭킹/위치앵커는 키 이름에 날짜가 포함돼 자정이 지나면 자동으로 새 키에서
 * 시작하므로(async-delivery.md 2절/8.1) 별도 삭제 로직이 필요 없다. 이 키는 그 자동 리셋이
 * 실제로 발동했는지 확인하기 위한 관측용 마커일 뿐, 게임 로직이 이 키를 참조하지는 않는다.
 */
export const DAILY_RESET_MARKER_KEY = 'system:last-daily-reset';
