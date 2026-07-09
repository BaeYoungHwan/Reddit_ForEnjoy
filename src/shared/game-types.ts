// 게임 도메인 공유 타입. Redis 데이터 구조는 docs/design-docs/async-delivery.md 참조.

export type Position = { x: number; y: number };

export type TrapType = 'slow' | 'respawn' | 'blind' | 'reverse';

export type TrapInstance = Position & {
  type: TrapType;
};

// items.md 확정 4종 중 서버 API가 필요한 손전등/쉴드 2종만 우선 (함정 탐지기/함정 설치는 후속).
export type ItemType = 'flashlight' | 'shield';

export type ItemInstance = Position & {
  type: ItemType;
};

export type LeaderboardEntry = {
  userId: string;
  username: string;
  clearTimeMs: number;
  rank: number;
};

export type MapStateInput = { mapId: string };
export type MapStateOutput = {
  date: string;
  footprints: Position[];
  myTraps: TrapInstance[];
  items: ItemInstance[];
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
export type ItemPickupOutput = { picked: boolean; type?: ItemType };

export type RunFinishInput = { mapId: string; clearTimeMs: number };
export type RunFinishOutput = { rank: number; isNewRecord: boolean };

export type LeaderboardGetInput = { mapId: string };
export type LeaderboardGetOutput = { entries: LeaderboardEntry[] };
