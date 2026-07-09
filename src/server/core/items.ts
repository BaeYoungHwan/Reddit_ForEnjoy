import type { ItemInstance } from '../../shared/game-types';

// items.md: 실제 랜덤 스폰 로직은 후속 작업(wbs.md 1️⃣ "그리드 맵 실데이터 교체" 참조 —
// 클라이언트가 아직 shared/maps.ts 실데이터로 안 옮겨서 좌표 체계를 맞춰줄 수 없음).
// 지금은 맵마다 고정 좌표 2곳(손전등/쉴드)만 심어두고, 랜덤화는 그리드 맵 교체 이후에 진행한다.
const MAP_1_ITEM_SPAWNS: ItemInstance[] = [
  { x: 3, y: 1, type: 'flashlight' },
  { x: 7, y: 5, type: 'shield' },
];

const ITEM_SPAWNS: Record<string, ItemInstance[]> = {
  'map-1': MAP_1_ITEM_SPAWNS,
};

export function getItemSpawns(mapId: string): ItemInstance[] {
  return ITEM_SPAWNS[mapId] ?? MAP_1_ITEM_SPAWNS;
}
