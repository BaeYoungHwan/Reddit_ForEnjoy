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

export const leaderboardKey = (mapId: string, date: string): string => `leaderboard:${mapId}:${date}`;

export const positionAnchorKey = (mapId: string, date: string, userId: string): string =>
  `pos:${mapId}:${date}:${userId}`;
