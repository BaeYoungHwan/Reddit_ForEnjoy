import { describe, expect, it } from 'vitest';
import { MAZE_MAPS, getMazeMap } from './maps';

describe('MAZE_MAPS / map-1', () => {
  const map = MAZE_MAPS['map-1']!;

  it('parses S as the start tile and its grid cell as floor', () => {
    expect(map.start).toEqual({ x: 1, y: 1 });
    expect(map.grid[map.start.y]![map.start.x]).toBe('floor');
  });

  it('parses E as the exit tile and its grid cell as exit', () => {
    expect(map.exit).toEqual({ x: 15, y: 7 });
    expect(map.grid[map.exit.y]![map.exit.x]).toBe('exit');
  });

  it('parses # as wall and . as floor', () => {
    expect(map.grid[0]![0]).toBe('wall');
    expect(map.grid[1]![2]).toBe('floor');
  });

  it('produces a rectangular grid matching the layout dimensions', () => {
    expect(map.grid.length).toBe(21);
    for (const row of map.grid) {
      expect(row.length).toBe(25);
    }
  });

  it('has a walkable path from start to exit (not walled off)', () => {
    const width = map.grid[0]!.length;
    const height = map.grid.length;
    const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: [number, number][] = [[map.start.x, map.start.y]];
    visited[map.start.y]![map.start.x] = true;

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
        if (visited[ny]![nx]) continue;
        if (map.grid[ny]![nx] === 'wall') continue;
        visited[ny]![nx] = true;
        queue.push([nx, ny]);
      }
    }

    expect(visited[map.exit.y]![map.exit.x]).toBe(true);
  });
});

describe('getMazeMap', () => {
  it('returns the requested map by id', () => {
    expect(getMazeMap('map-1').id).toBe('map-1');
  });

  it('falls back to map-1 for an unknown id', () => {
    expect(getMazeMap('does-not-exist').id).toBe('map-1');
  });
});
