import { describe, expect, it } from 'vitest';
import { generateMazeGrid, generateDecorativeMazeBackground } from './mazePattern';

describe('generateMazeGrid', () => {
  it('throws for cellsX/cellsY less than 1', () => {
    expect(() => generateMazeGrid(0, 5)).toThrow();
    expect(() => generateMazeGrid(5, 0)).toThrow();
    expect(() => generateMazeGrid(-1, 5)).toThrow();
  });

  it('produces a grid sized (2*cellsX+1) x (2*cellsY+1)', () => {
    const grid = generateMazeGrid(4, 3);
    expect(grid.length).toBe(7);
    for (const row of grid) {
      expect(row.length).toBe(9);
    }
  });

  it('produces a perfect maze: every cell position is reachable from the origin', () => {
    const cellsX = 5;
    const cellsY = 5;
    const grid = generateMazeGrid(cellsX, cellsY);
    const width = grid[0]!.length;
    const height = grid.length;

    const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: [number, number][] = [[1, 1]];
    visited[1]![1] = true;

    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = x + dx!;
        const ny = y + dy!;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (visited[ny]![nx] || grid[ny]![nx]) continue;
        visited[ny]![nx] = true;
        queue.push([nx, ny]);
      }
    }

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        expect(visited[cy * 2 + 1]![cx * 2 + 1]).toBe(true);
      }
    }
  });
});

describe('generateDecorativeMazeBackground', () => {
  it('returns a data-uri background image string', () => {
    const { backgroundImage } = generateDecorativeMazeBackground(3, 3);
    expect(backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
  });
});
