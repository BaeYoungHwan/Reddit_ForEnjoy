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

// 2026-07-10 재설계: 기존 레이아웃은 골인 지점이 시작점의 정반대 모서리(우측 하단
// 코너)에 있어서 "그냥 대각선으로 쭉 가면 된다"는 게 너무 뻔히 보였음(예측 가능성 문제).
// 크기를 키우고(19x15 -> 23x19) 갈림길을 늘려 복잡도를 높이는 동시에, 골인 지점을 모서리가
// 아닌 미로 내부(시작점 기준 BFS 최단거리 82칸 지점)로 옮겨서 위치를 미리 짐작하기 어렵게 함.
// 생성/검증 스크립트는 시드 고정 recursive-backtracker + 루프 경로 추가 + BFS 도달성 검증
// 방식(재현 가능, 함정/아이템 스폰 좌표도 전부 이 레이아웃 기준으로 다시 확인해 갱신함 —
// server/core/items.ts, game.tsx의 TEMP_ITEMS/myTraps 폴백도 같이 확인할 것).
const MAP_1_LAYOUT = [
  '#######################',
  '#S....#.....#...#.....#',
  '#####.###.#.###.#.#.#.#',
  '#.#...#...#.#...#.#.#.#',
  '#.#.###.###.#.###.#.#.#',
  '#.#...#...#.....#.#.#.#',
  '#.###.###.#.#.#.#.#.###',
  '#.....#.......#...#...#',
  '#.#.###.#.###.#####.#.#',
  '#.#...#.....#.....#.#.#',
  '#.#.#.#####.#####.#.#.#',
  '#.....#.....#...#.#.#.#',
  '#.#####.#####.#.#.#.#.#',
  '#.......#.....#E#.#.#.#',
  '#.#.#.###.#.#.###.###.#',
  '#.#.#.#...#.#...#.....#',
  '#.###.#.###.#.#.#####.#',
  '#.....#.......#.......#',
  '#######################',
];

export const MAZE_MAPS: Record<string, MazeMap> = {
  'map-1': parseLayout('map-1', '첫 번째 미로', MAP_1_LAYOUT),
};

export function getMazeMap(mapId: string): MazeMap {
  return MAZE_MAPS[mapId] ?? MAZE_MAPS['map-1']!;
}
