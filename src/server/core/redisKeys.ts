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
