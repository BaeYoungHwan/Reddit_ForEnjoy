function toSvgBackground(wallGrid: boolean[][], cellSize: number): { backgroundImage: string; width: number; height: number } {
  const rows = wallGrid.length;
  const cols = wallGrid[0]?.length ?? 0;
  const width = cols * cellSize;
  const height = rows * cellSize;

  const rects = wallGrid
    .flatMap((row, y) =>
      row.map((isWall, x) =>
        isWall ? `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" />` : ''
      )
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="white">${rects}</g></svg>`;

  return { backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, width, height };
}

/** Fisher-Yates — `.sort(() => Math.random() - 0.5)`는 균등 분포가 아니라서 사용하지 않는다. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * 재귀 백트래킹으로 구불구불한 "완전 미로"를 생성한다. 셀은 (cellsX, cellsY)개,
 * 실제 그리드는 셀 사이 벽을 표현하기 위해 (2*cells+1) 크기로 나온다.
 */
export function generateMazeGrid(cellsX: number, cellsY: number): boolean[][] {
  if (cellsX < 1 || cellsY < 1) {
    throw new Error(`generateMazeGrid: cellsX/cellsY must be >= 1 (got ${cellsX}, ${cellsY})`);
  }

  const width = cellsX * 2 + 1;
  const height = cellsY * 2 + 1;
  const wallGrid: boolean[][] = Array.from({ length: height }, () => Array(width).fill(true));
  const visited: boolean[][] = Array.from({ length: cellsY }, () => Array(cellsX).fill(false));

  const stack: [number, number][] = [[0, 0]];
  visited[0]![0] = true;
  wallGrid[1]![1] = false;

  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1]!;
    const directions = shuffle([
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]);

    let carved = false;
    for (const [dx, dy] of directions) {
      const nx = cx + dx!;
      const ny = cy + dy!;
      if (nx >= 0 && nx < cellsX && ny >= 0 && ny < cellsY && !visited[ny]![nx]) {
        visited[ny]![nx] = true;
        wallGrid[cy * 2 + 1 + dy!]![cx * 2 + 1 + dx!] = false;
        wallGrid[ny * 2 + 1]![nx * 2 + 1] = false;
        stack.push([nx, ny]);
        carved = true;
        break;
      }
    }
    if (!carved) stack.pop();
  }

  return wallGrid;
}

/**
 * 장식용 배경 전용 — `generateMazeGrid`의 결과를 CSS 배경 이미지 문자열로 변환한다.
 * 실제 게임 맵(map-1)과는 무관한, 화면 전체를 한 번만 덮는 불규칙한 패턴.
 */
export function generateDecorativeMazeBackground(
  cellsX: number,
  cellsY: number,
  cellSize = 20
): { backgroundImage: string } {
  const { backgroundImage } = toSvgBackground(generateMazeGrid(cellsX, cellsY), cellSize);
  return { backgroundImage };
}
