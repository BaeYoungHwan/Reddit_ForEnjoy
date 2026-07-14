import type { ItemType, Position, TrapType } from '../../shared/game-types';
import { MYSTERY_BOX_OUTCOME_POOL } from './gameConfig';

// items.md "스폰 시각/판정 방식 변경": 스폰 좌표엔 더 이상 타입이 없다 — 미스터리 박스라
// 아이템/함정 전용 구분 없이 공용 좌표 풀이고, 실제 결과는 rollMysteryOutcome()이 픽업
// 시점에 결정한다. 실제 랜덤 스폰 로직(좌표 자체를 매일 무작위화하는 것)은 후속 작업으로 남김
// (wbs.md 1️⃣ "그리드 맵 실데이터 교체" 참조) — 지금은 맵마다 고정 좌표 3곳만 심어둔다.
// 좌표는 원래 구 map-1 레이아웃 기준 (3,1)/(7,5)/(14,9)였으나, main에 먼저 병합된 map-1
// 4차 재설계(#36) 이후 (14,9)가 벽으로 막혀버려 develop→main 병합 시(2026-07-12) main이
// 재설계 후 검증해둔 좌표(5,12)/(9,1)/(15,12)로 교체함 — 각 좌표는 "시작→골인 경로를 따라
// 기능에 어울리는 지점"으로 배치된 것(초반 보호/중반 교차로 진입 직전/후반 진입 직전)이라
// 미스터리 박스로 바뀐 지금도 위치 자체는 그대로 재사용한다.
const MAP_1_MYSTERY_SPAWNS: Position[] = [
  { x: 5, y: 12 },
  { x: 9, y: 1 },
  { x: 15, y: 12 },
];

// 2026-07-13 데일리 맵 로테이션 도입 — map-2 좌표는 최단경로(시작→골인 140칸)의 20/50/80%
// 지점(shared/maps.ts MAP_2_LAYOUT 생성 스크립트 참고)으로, map-1과 동일하게 "초반/중반/후반"
// 배치 관례를 따른다. game.tsx의 로컬 프리뷰 폴백(TEMP_ITEMS_BY_MAP)과 좌표를 맞춰뒀다.
const MAP_2_MYSTERY_SPAWNS: Position[] = [
  { x: 17, y: 1 },
  { x: 11, y: 8 },
  { x: 12, y: 19 },
];

const MYSTERY_SPAWNS: Record<string, Position[]> = {
  'map-1': MAP_1_MYSTERY_SPAWNS,
  'map-2': MAP_2_MYSTERY_SPAWNS,
};

// MYSTERY_SPAWNS[mapId] ?? MAP_1_MYSTERY_SPAWNS 형태로 직접 인덱싱하면 MYSTERY_SPAWNS가 일반
// 객체 리터럴이라 Object.prototype 체인을 탄다 — mapId==='constructor' 같은 값이 Object 생성자
// 함수(truthy)를 반환해 폴백이 안 걸리고, 이어지는 .map() 호출이 Function엔 없는 메서드라
// TypeError로 크래시한다. map.getState(trpc.ts)가 화이트리스트 검증 없는 클라이언트 입력
// (mapId: z.string().min(1))을 그대로 넘기므로 실제로 도달 가능한 경로다 — shared/maps.ts의
// isRegisteredMapId/getMazeMap과 정확히 같은 취약점 클래스라 같은 방식(hasOwnProperty)으로
// 막는다(PR#60 리뷰에서 발견).
export function getMysteryBoxSpawns(mapId: string): Position[] {
  return Object.prototype.hasOwnProperty.call(MYSTERY_SPAWNS, mapId)
    ? MYSTERY_SPAWNS[mapId]!
    : MAP_1_MYSTERY_SPAWNS;
}

export function rollMysteryOutcome():
  | { outcome: 'item'; type: ItemType }
  | { outcome: 'trap'; type: TrapType } {
  const index = Math.floor(Math.random() * MYSTERY_BOX_OUTCOME_POOL.length);
  return MYSTERY_BOX_OUTCOME_POOL[index]!;
}
