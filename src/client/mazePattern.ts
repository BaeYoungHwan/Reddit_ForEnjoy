import type { MazeMap } from '../shared/maps';
import type { Position } from '../shared/game-types';

const CELL_SIZE = 14;

export type MazeBackgroundOptions = {
  cellSize?: number;
  wallFill?: string;
  mortarStroke?: string;
  highlightStroke?: string;
};

/**
 * 실제 맵 그리드를 각진 석벽 블록(모르타르 줄눈 + 상단/좌측 하이라이트) SVG 문자열로 그린다.
 * 맵마다 고정, 랜덤 없음. cellSize/색상을 바꿔 스플래시 배경(작고 옅게)과 게임 화면 벽 텍스처
 * (칸 크기 그대로, 진하게) 양쪽에 재사용한다.
 */
function buildMazeSvg(map: MazeMap, options: MazeBackgroundOptions = {}): { svg: string; width: number; height: number } {
  const cellSize = options.cellSize ?? CELL_SIZE;
  const wallFill = options.wallFill ?? 'white';
  const mortarStroke = options.mortarStroke ?? 'black';
  const highlightStroke = options.highlightStroke ?? 'white';

  const rows = map.grid.length;
  const cols = map.grid[0]?.length ?? 0;
  const width = cols * cellSize;
  const height = rows * cellSize;

  const wallCells: { x: number; y: number }[] = [];
  map.grid.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (tile === 'wall') wallCells.push({ x: x * cellSize, y: y * cellSize });
    })
  );

  const blocks = wallCells
    .map(
      ({ x, y }) =>
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${wallFill}" stroke="${mortarStroke}" stroke-width="1" stroke-opacity="0.5" />`
    )
    .join('');
  const topEdges = wallCells
    .map(({ x, y }) => `<line x1="${x}" y1="${y + 0.5}" x2="${x + cellSize}" y2="${y + 0.5}" />`)
    .join('');
  const leftEdges = wallCells
    .map(({ x, y }) => `<line x1="${x + 0.5}" y1="${y}" x2="${x + 0.5}" y2="${y + cellSize}" />`)
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <g>${blocks}</g>
    <g stroke="${highlightStroke}" stroke-opacity="0.85" stroke-width="1">${topEdges}${leftEdges}</g>
  </svg>`;

  return { svg, width, height };
}

/**
 * 실제 맵 그리드를 각진 석벽 블록(모르타르 줄눈 + 상단/좌측 하이라이트) CSS 배경 이미지로 변환한다.
 * 맵마다 고정, 랜덤 없음 — 화면 전체에 한 번만 그려서(no-repeat) 쓴다.
 */
export function buildMazeBackground(map: MazeMap): { backgroundImage: string; backgroundSize: string } {
  const { svg, width, height } = buildMazeSvg(map);

  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundSize: `${width}px ${height}px`,
  };
}

/**
 * buildMazeBackground와 같은 석벽 블록 그림을 Phaser 등에서 이미지 텍스처로 바로 로드할 수 있는
 * data URI 문자열로 반환한다(CSS의 url("...") 래핑 없이 raw data URI만).
 */
export function buildMazeSvgDataUri(map: MazeMap, options?: MazeBackgroundOptions): string {
  const { svg } = buildMazeSvg(map, options);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 그리드 좌표를 배경 이미지(0~100%) 기준 위치로 변환한다. */
export function tileToPercent(map: MazeMap, pos: Position): { left: string; top: string } {
  const cols = map.grid[0]?.length ?? 1;
  const rows = map.grid.length;
  return {
    left: `${((pos.x + 0.5) / cols) * 100}%`,
    top: `${((pos.y + 0.5) / rows) * 100}%`,
  };
}

/** a에서 b로 향하는 각도(도). 발자국 아이콘이 "위쪽(0deg)"을 향한다고 가정하고 +90 보정한다. */
export function angleBetween(a: Position, b: Position): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
}

/** map.start에서 map.exit까지 최단 경로(BFS)를 타일 좌표 목록으로 반환한다. 랜덤 없음, 항상 같은 결과. */
export function findPath(map: MazeMap): Position[] {
  const rows = map.grid.length;
  const cols = map.grid[0]?.length ?? 0;
  const key = (p: Position): string => `${p.x},${p.y}`;

  const cameFrom = new Map<string, Position>();
  const visited = new Set<string>([key(map.start)]);
  const queue: Position[] = [map.start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.x === map.exit.x && current.y === map.exit.y) break;

    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const next: Position = { x: current.x + dx!, y: current.y + dy! };
      if (next.x < 0 || next.x >= cols || next.y < 0 || next.y >= rows) continue;
      if (map.grid[next.y]![next.x] === 'wall') continue;
      if (visited.has(key(next))) continue;

      visited.add(key(next));
      cameFrom.set(key(next), current);
      queue.push(next);
    }
  }

  if (!visited.has(key(map.exit))) return [];

  const path: Position[] = [map.exit];
  let cursor = map.exit;
  while (key(cursor) !== key(map.start)) {
    const prev = cameFrom.get(key(cursor));
    if (!prev) break;
    path.push(prev);
    cursor = prev;
  }
  return path.reverse();
}
