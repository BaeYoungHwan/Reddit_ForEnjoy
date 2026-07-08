import type { Position } from './game-types';

export type TileType = 'wall' | 'floor' | 'exit';

export type MazeMap = {
  id: string;
  name: string;
  grid: TileType[][];
  start: Position;
  exit: Position;
};

const LEGEND: Record<string, TileType> = {
  '#': 'wall',
  '.': 'floor',
  S: 'floor',
  E: 'exit',
};

function parseLayout(id: string, name: string, rows: string[]): MazeMap {
  const grid = rows.map((row) => row.split('').map((ch) => LEGEND[ch] ?? 'wall'));
  let start: Position = { x: 0, y: 0 };
  let exit: Position = { x: 0, y: 0 };

  rows.forEach((row, y) => {
    row.split('').forEach((ch, x) => {
      if (ch === 'S') start = { x, y };
      if (ch === 'E') exit = { x, y };
    });
  });

  return { id, name, grid, start, exit };
}

const MAP_1_LAYOUT = [
  '###########',
  '#S....#...#',
  '#.###.#.#.#',
  '#...#...#.#',
  '###.#.###.#',
  '#...#.#...#',
  '#.###.#.#.#',
  '#.......#E#',
  '###########',
];

export const MAZE_MAPS: Record<string, MazeMap> = {
  'map-1': parseLayout('map-1', '첫 번째 미로', MAP_1_LAYOUT),
};

export function getMazeMap(mapId: string): MazeMap {
  return MAZE_MAPS[mapId] ?? MAZE_MAPS['map-1']!;
}
