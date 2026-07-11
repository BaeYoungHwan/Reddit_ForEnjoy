import type { ItemInstance } from '../../shared/game-types';

// items.md: 실제 랜덤 스폰 로직은 후속 작업(wbs.md 1️⃣ "그리드 맵 실데이터 교체" 참조 —
// 클라이언트가 아직 shared/maps.ts 실데이터로 안 옮겨서 좌표 체계를 맞춰줄 수 없음).
// 지금은 맵마다 고정 좌표 3곳(손전등/쉴드/함정 탐지기)만 심어두고, 랜덤화는 그리드 맵 교체 이후에 진행한다.
// 2026-07-10: map-1 레이아웃 4차 재설계에 맞춰 좌표 갱신 — 이번엔 단순히 거리로만 퍼뜨리지
// 않고 "각 아이템 기능에 어울리는 지점"을 실제 시작→골인 경로를 따라가며 배치함:
// 쉴드(다음 함정 1회 무효화)는 여정 초반에 미리 쥐여줘서 보호막을 깔고 진행하게, 손전등
// (시야 2→4칸 확장)은 교차로가 밀집된 중반 구간 진입 직전에 배치해 시야 확장이 실제로
// 갈림길 판단에 도움이 되도록, 함정 탐지기(반경 3칸 내 타 유저 함정 공개)는 후반 구간
// 진입 직전에 배치해 마지막 구간에서 다른 유저가 깔아둔 함정을 미리 살펴볼 수 있게 함.
const MAP_1_ITEM_SPAWNS: ItemInstance[] = [
  { x: 5, y: 12, type: 'flashlight' },
  { x: 9, y: 1, type: 'shield' },
  { x: 15, y: 12, type: 'detector' },
];

const ITEM_SPAWNS: Record<string, ItemInstance[]> = {
  'map-1': MAP_1_ITEM_SPAWNS,
};

export function getItemSpawns(mapId: string): ItemInstance[] {
  return ITEM_SPAWNS[mapId] ?? MAP_1_ITEM_SPAWNS;
}
