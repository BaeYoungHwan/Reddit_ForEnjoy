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
  // 2026-07-14 오라클 완화: 다른 유저가 설치한 함정 위치도 좌표만(타입 제외) 내려준다 —
  // mysteryBoxes와 동일하게 위치는 공개, 종류만 비공개(trpc.ts map.getState 참고).
  otherTraps: Position[];
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
// 탐지기(detector)는 픽업 시점에 반경을 계산하지 않는다 — Z를 눌러 발동하는 순간 그 자리
// 기준으로 매번 새로 스캔해야 하므로(item.useDetector 참고), pickup은 "충전 1회 획득"만 기록한다.
export type ItemPickupOutput =
  | { picked: false }
  | { picked: true; outcome: 'item'; type: ItemType }
  | { picked: true; outcome: 'trap'; type: TrapType };

// move.arrive: trap.trigger + item.pickup 통합 API(docs/design-docs/move-api-unification.md).
// 위치 앵커 검증/커밋을 1회만 수행하고 함정/아이템 판정을 한 응답에 함께 반환해 이동 1칸당
// 서버 왕복을 2회→1회로 줄인다. 기존 TrapTriggerOutput/ItemPickupOutput을 그대로 재사용해
// 응답을 두 하위 객체로 중첩한다 — 필드를 평평하게 섞으면 클라이언트가 매번 다른 필드 조합으로
// "이 type이 함정인지 아이템인지"를 구분해야 해 타입 처리가 복잡해진다.
export type MoveArriveInput = Position & { mapId: string };
export type MoveArriveOutput = {
  trap: TrapTriggerOutput;
  item: ItemPickupOutput;
};

// 탐지기 발동(Z 시점 라이브 스캔) — 로드아웃/미스터리 박스 두 경로 공통 창구.
// x, y를 입력받지 않는다 — 서버가 매 이동(trap.trigger)마다 갱신해온 위치 앵커를 그대로
// 신뢰한다. 클라이언트가 좌표를 직접 넘기게 하면 오라클 방지 설계가 무의미해진다.
export type ItemUseDetectorInput = { mapId: string };
export type ItemUseDetectorOutput = { revealedTraps: TrapInstance[] };

// 로드아웃 지급은 클라이언트 로컬(localStorage)로만 처리되던 것이라 서버가 몰랐다 — 탐지기는
// 1회성을 서버가 강제해야 하므로(민감 정보) 게임 시작 시 이 mutation으로 서버에도 알린다.
// granted:false는 이미 이번 세션/하루에 클레임을 마쳐 중복 충전을 막은 경우.
export type ItemClaimLoadoutInput = { mapId: string; loadoutId: 'trapDetector' | 'shield' | 'flashlight' };
export type ItemClaimLoadoutOutput = { granted: boolean };

// 랭킹은 steps(성공 이동 칸 수) 1차, clearTimeMs 2차(동점 타이브레이크) 기준.
export type RunFinishInput = { mapId: string; steps: number; clearTimeMs: number };
export type RunFinishOutput = { rank: number; isNewRecord: boolean };

export type LeaderboardGetInput = { mapId: string };
export type LeaderboardGetOutput = { entries: LeaderboardEntry[] };

export type UserMeOutput = { userId: string };
