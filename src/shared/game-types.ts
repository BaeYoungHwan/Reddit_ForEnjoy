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
  // 새로고침/재접속 시 클라이언트가 실제 서버 위치로 캐릭터를 복원하는 데 쓴다 — 이게 없으면
  // 클라이언트는 항상 시작 좌표로 가정해, 진행 중이던 세션에서 새로고침하면 위치가 어긋난다.
  position: Position;
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

// move.arriveBatch: 여러 칸 연속 이동을 요청 1회로 묶어 왕복 횟수를 줄인다(픽업/판정 지연
// 완화, docs/wbs.md "아이템/함정 픽업 지연" 항목 참고). waypoints는 클라이언트가 실제로
// 지나간 칸들을 순서대로 담은 배열 — 서버는 이걸 move.arrive와 동일한 규칙으로 한 칸씩
// 순차 검증한다(오라클 방지 유지, 병렬 처리 불가). 중간에 인접성 검증이 실패하거나 리스폰이
// 나오면 그 지점에서 처리를 멈추고 그때까지의 결과만 반환한다 — stoppedEarly가 true면
// waypoints 전체가 아니라 results.length개만 실제로 처리된 것.
export type MoveArriveBatchInput = { mapId: string; waypoints: Position[] };
export type MoveArriveBatchOutput = {
  results: MoveArriveOutput[];
  stoppedEarly: boolean;
  // 배치 처리 후 서버가 실제로 커밋한 위치 — 클라이언트의 낙관적 이동(화면이 항상 서버보다
  // 앞서있는 설계)이 stoppedEarly로 인해 실제 서버 위치와 어긋났을 때, 화면을 이 값으로
  // 사후 보정(스냅백)하는 데 쓴다. 정상적으로 끝까지 처리됐을 때도 항상 포함해 클라이언트가
  // 매번 "이번 배치의 진짜 최종 위치"를 신뢰할 수 있게 한다.
  finalPosition: Position;
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
