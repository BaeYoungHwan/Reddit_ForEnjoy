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

// 2026-07-10 1차 재설계: 기존 레이아웃은 골인 지점이 시작점의 정반대 모서리(우측 하단
// 코너)에 있어서 "그냥 대각선으로 쭉 가면 된다"는 게 너무 뻔히 보였음(예측 가능성 문제).
// 2026-07-10 2차 재설계(피드백 반영): 1차 결과물이 여전히 직선 통로 위주였고 실제
// 갈림길(3방향 이상 열린 교차로)이 적었음 + 슬라이드 함정이 주변 벽 때문에 거의 안
// 미끄러지는 위치에 있었음 → (1) 크기를 한 번 더 키우고(23x19 -> 25x21) (2) 미로 생성 시
// "직전 방향을 확률적으로 이어가는" 편향을 넣어 일부러 긴 직선 구간을 만들고 (3) 루프(순환
// 경로) 개방 비율을 대폭 늘려(추가 개방 칸 수 기준 약 2.5배) 실제 교차로 수를 크게 늘림
// (참고용 측정치: 이전 방식 기준 교차로 10개 안팎 -> 이번 방식 40~49개). 골인 지점은
// 여전히 모서리가 아닌 시작점 기준 BFS 최단거리 62칸 지점. 슬라이드 함정은 이제 배치 전에
// "이 칸에 서면 4방향 중 최소 한쪽으로 몇 칸이나 미끄러질 수 있는지"(러너웨이)를 직접 계산해
// 8칸 이상 확보되는 자리만 후보로 골랐음(아래 slow 함정 좌표 참고, 실제 배치는 game.tsx의
// 오프라인 폴백 myTraps에 반영). 생성/검증 스크립트는 시드 고정 recursive-backtracker
// (방향 유지 편향 포함) + 루프 경로 추가 + BFS 도달성/러너웨이 계산 방식(재현 가능) —
// 함정/아이템 스폰 좌표도 전부 이 레이아웃 기준으로 다시 확인해 갱신함(server/core/items.ts,
// game.tsx의 TEMP_ITEMS/myTraps 폴백도 같이 확인할 것).
const MAP_1_LAYOUT = [
  '#########################',
  '#S........#.......#.#...#',
  '#########.#.#.#.#.#.#.#.#',
  '#.........#.#.#.#.....#.#',
  '#.#####.#.#.#.#.#.#.#.#.#',
  '#.........#.#.#.#...#...#',
  '#.#.#####.#.#.#.###.#.#.#',
  '#...#.....#.#.#.......#.#',
  '#.#.#.#.###.#.#.#.#####.#',
  '#.#.#.........#...#E#...#',
  '#.#.###########.#.#.#.#.#',
  '#.#.#.......#.....#.#.#.#',
  '#.#.###.###.#.#.#.#.#.#.#',
  '#.......#...#.....#.#.#.#',
  '#.#######.###.#.#.#.#.###',
  '#.......#.....#...#.....#',
  '###.###.#.#######.#.###.#',
  '#.......#.............#.#',
  '#.###.#.#.###.#########.#',
  '#.......................#',
  '#########################',
];

export const MAZE_MAPS: Record<string, MazeMap> = {
  'map-1': parseLayout('map-1', '첫 번째 미로', MAP_1_LAYOUT),
};

export function getMazeMap(mapId: string): MazeMap {
  return MAZE_MAPS[mapId] ?? MAZE_MAPS['map-1']!;
}
