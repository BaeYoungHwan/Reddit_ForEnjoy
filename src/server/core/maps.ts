import type { Position } from '../../shared/game-types';

/**
 * 실제 고정 맵(PRD 7절 "팀이 미리 제작한 고정 맵 1~2개")은 아직 확정되지 않았다.
 * 맵 데이터가 나오면 이 표를 실제 시작 타일로 교체할 것 — 그 전까지 리스폰 함정 발동과
 * map.getState의 위치 앵커 초기화는 아래 placeholder 좌표를 사용한다.
 */
const MAP_START_POSITIONS: Record<string, Position> = {
  'map-1': { x: 0, y: 0 },
};

const DEFAULT_START_POSITION: Position = { x: 0, y: 0 };

export function getMapStartPosition(mapId: string): Position {
  return MAP_START_POSITIONS[mapId] ?? DEFAULT_START_POSITION;
}
