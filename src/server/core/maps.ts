import type { Position } from '../../shared/game-types';
import { getMazeMap } from '../../shared/maps';

export function getMapStartPosition(mapId: string): Position {
  return getMazeMap(mapId).start;
}
