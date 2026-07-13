// 게임 도메인 공유 타입. Redis 데이터 구조는 docs/design-docs/async-delivery.md 참조.

export type Position = { x: number; y: number };

export type TrapType = 'slow' | 'respawn' | 'blind' | 'reverse';

export type TrapInstance = Position & {
  type: TrapType;
};

// items.md 확정 4종 전부 — 손전등/쉴드/함정 탐지기/함정 설치.
export type ItemType = 'flashlight' | 'shield' | 'detector' | 'trapInstall';

export type LeaderboardEntry = {
  userId: string;
  username: string;
  steps: number;
  clearTimeMs: number;
  rank: number;
};

export type MapStateInput = { mapId: string };
export type MapStateOutput = {
  date: string;
  footprints: Position[];
  myTraps: TrapInstance[];
  // 미스터리 박스: 먹기 전엔 아이템/함정 여부조차 알 수 없으므로 좌표만 내려주고
  // 타입은 item.pickup 응답에서만(픽업 시점에 서버가 결정해) 밝혀진다.
  mysteryBoxes: Position[];
};

export type FootprintRecordInput = { mapId: string; tiles: Position[] };
export type FootprintRecordOutput = { recorded: number };

export type TrapInstallInput = Position & { mapId: string; type: TrapType };
export type TrapInstallOutput = {
  success: boolean;
  reason?: 'TOTAL_CAP_REACHED' | 'TYPE_CAP_REACHED' | 'TILE_OCCUPIED' | 'RETRY';
  myTraps: TrapInstance[];
};

export type TrapTriggerInput = Position & { mapId: string };
export type TrapTriggerOutput = { hit: boolean; type?: TrapType };

export type ItemPickupInput = Position & { mapId: string };
// 미스터리 박스: outcome이 'item'/'trap' 중 무엇인지는 서버가 pickup 시점에 결정해서 알려준다
// (근거: docs/design-docs/items.md "스폰 시각/판정 방식 변경" 절).
// revealedTraps: outcome이 'item'이고 type이 'detector'일 때만 채워짐 — 탐지기 사용을 별도
// API로 분리하지 않고 pickup 시점(이미 오라클 방지용 위치 인접 검증을 거친 이벤트)에 묶어 반환한다.
export type ItemPickupOutput =
  | { picked: false }
  | { picked: true; outcome: 'item'; type: ItemType; revealedTraps?: TrapInstance[] }
  | { picked: true; outcome: 'trap'; type: TrapType };

// 랭킹은 steps(성공 이동 칸 수) 1차, clearTimeMs 2차(동점 타이브레이크) 기준.
export type RunFinishInput = { mapId: string; steps: number; clearTimeMs: number };
export type RunFinishOutput = { rank: number; isNewRecord: boolean };

export type LeaderboardGetInput = { mapId: string };
export type LeaderboardGetOutput = { entries: LeaderboardEntry[] };

export type UserMeOutput = { userId: string };
