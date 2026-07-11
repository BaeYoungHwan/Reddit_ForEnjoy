import type { ItemType, Position, TrapType } from '../../shared/game-types';
import { MYSTERY_BOX_OUTCOME_POOL } from './gameConfig';

// items.md "스폰 시각/판정 방식 변경": 스폰 좌표엔 더 이상 타입이 없다 — 미스터리 박스라
// 아이템/함정 전용 구분 없이 공용 좌표 풀이고, 실제 결과는 rollMysteryOutcome()이 픽업
// 시점에 결정한다. 실제 랜덤 스폰 로직(좌표 자체를 매일 무작위화하는 것)은 후속 작업으로 남김
// (wbs.md 1️⃣ "그리드 맵 실데이터 교체" 참조) — 지금은 맵마다 고정 좌표 3곳만 심어둔다.
const MAP_1_MYSTERY_SPAWNS: Position[] = [
  { x: 3, y: 1 },
  { x: 7, y: 5 },
  { x: 14, y: 9 },
];

const MYSTERY_SPAWNS: Record<string, Position[]> = {
  'map-1': MAP_1_MYSTERY_SPAWNS,
};

export function getMysteryBoxSpawns(mapId: string): Position[] {
  return MYSTERY_SPAWNS[mapId] ?? MAP_1_MYSTERY_SPAWNS;
}

export function rollMysteryOutcome():
  | { outcome: 'item'; type: ItemType }
  | { outcome: 'trap'; type: TrapType } {
  const index = Math.floor(Math.random() * MYSTERY_BOX_OUTCOME_POOL.length);
  return MYSTERY_BOX_OUTCOME_POOL[index]!;
}
