import type { ItemInstance } from '../../shared/game-types';

// items.md: 실제 랜덤 스폰 로직은 후속 작업(wbs.md 1️⃣ "그리드 맵 실데이터 교체" 참조 —
// 클라이언트가 아직 shared/maps.ts 실데이터로 안 옮겨서 좌표 체계를 맞춰줄 수 없음).
// 지금은 맵마다 고정 좌표 3곳(손전등/쉴드/함정 탐지기)만 심어두고, 랜덤화는 그리드 맵 교체 이후에 진행한다.
// 2026-07-10: map-1 레이아웃 재설계(23x19, 골인 지점 재배치)에 맞춰 좌표 갱신 — 전부
// 시작점 기준 BFS 최단거리로 이르게/중간/멀게 퍼뜨려서 진행 흐름에 맞게 배치.
const MAP_1_ITEM_SPAWNS: ItemInstance[] = [
  { x: 3, y: 3, type: 'flashlight' },
  { x: 1, y: 14, type: 'shield' },
  { x: 9, y: 9, type: 'detector' },
];

const ITEM_SPAWNS: Record<string, ItemInstance[]> = {
  'map-1': MAP_1_ITEM_SPAWNS,
};

export function getItemSpawns(mapId: string): ItemInstance[] {
  return ITEM_SPAWNS[mapId] ?? MAP_1_ITEM_SPAWNS;
}
