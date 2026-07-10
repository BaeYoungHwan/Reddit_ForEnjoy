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

export type RockWallTileOptions = {
  cellSize?: number;
  baseFill?: string;
  facetFill?: string;
  highlightFill?: string;
  crackStroke?: string;
  seed?: number;
};

/** 시드 고정 의사난수 생성기(mulberry32) — Math.random 대신 써서 같은 seed면 항상 같은 결과. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 중심(cx, cy)을 둘러싼 각진 다각형(암반 조각처럼 꼭짓점이 불규칙한 모양) 점 목록을 만든다. */
function jaggedPolygonPoints(
  rand: () => number,
  vertexCount: number,
  jitter: number,
  cx: number,
  cy: number,
  radius: number
): string {
  const points: string[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * Math.PI * 2;
    const r = radius * (1 - jitter / 2 + rand() * jitter);
    points.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * 각진 석벽 블록 대신, 모르타르 줄눈 없이 이어지는 "거친 동굴 암반" 타일 하나를 SVG로 그린다.
 * 타일 전체를 빈틈없이 채우는 단색 바탕(테두리 선 없음 → 옆 타일과 이어붙여도 격자 줄눈이
 * 안 보임) 위에, 시드 기반 의사난수로 불규칙한 각진 조각(짙은 명암 면 + 밝은 하이라이트 면)과
 * 삐뚤빼뚤한 균열 선을 얹어 자연암 느낌을 낸다. seed가 같으면 항상 같은 모양(랜덤 아님).
 */
export function buildRockWallTileSvg(options: RockWallTileOptions = {}): string {
  const cellSize = options.cellSize ?? CELL_SIZE;
  const baseFill = options.baseFill ?? '#2b1d13';
  const facetFill = options.facetFill ?? '#1c1209';
  const highlightFill = options.highlightFill ?? '#5a4030';
  const crackStroke = options.crackStroke ?? '#000000';
  const rand = mulberry32(options.seed ?? 1);

  const base = `<rect x="0" y="0" width="${cellSize}" height="${cellSize}" fill="${baseFill}" />`;

  let facets = '';
  const facetCount = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < facetCount; i++) {
    const cx = rand() * cellSize;
    const cy = rand() * cellSize;
    const radius = cellSize * (0.28 + rand() * 0.22);
    const pts = jaggedPolygonPoints(rand, 5 + Math.floor(rand() * 3), 0.7, cx, cy, radius);
    facets += `<polygon points="${pts}" fill="${facetFill}" fill-opacity="0.55" />`;
  }

  const hcx = cellSize * (0.15 + rand() * 0.3);
  const hcy = cellSize * (0.15 + rand() * 0.3);
  const hRadius = cellSize * (0.2 + rand() * 0.15);
  const highlight = `<polygon points="${jaggedPolygonPoints(rand, 5, 0.5, hcx, hcy, hRadius)}" fill="${highlightFill}" fill-opacity="0.45" />`;

  let cracks = '';
  const crackCount = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < crackCount; i++) {
    const segments = 3 + Math.floor(rand() * 2);
    let x = rand() * cellSize;
    const path: string[] = [`M${x.toFixed(1)},0`];
    for (let s = 1; s <= segments; s++) {
      x = Math.max(0, Math.min(cellSize, x + (rand() - 0.5) * cellSize * 0.6));
      const y = (cellSize * s) / segments;
      path.push(`L${x.toFixed(1)},${y.toFixed(1)}`);
    }
    cracks += `<path d="${path.join(' ')}" stroke="${crackStroke}" stroke-opacity="0.35" stroke-width="0.6" fill="none" />`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cellSize}" height="${cellSize}">${base}${facets}${highlight}${cracks}</svg>`;
}

/** buildRockWallTileSvg를 Phaser 텍스처로 바로 로드할 수 있는 raw data URI로 반환한다. */
export function buildRockWallTileDataUri(options?: RockWallTileOptions): string {
  return `data:image/svg+xml,${encodeURIComponent(buildRockWallTileSvg(options))}`;
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
