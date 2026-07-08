import { describe, expect, it } from 'vitest';
import { angleBetween, buildMazeBackground, findPath, tileToPercent } from './mazePattern';
import { MAZE_MAPS } from '../shared/maps';

const map = MAZE_MAPS['map-1']!;

describe('buildMazeBackground', () => {
  it('returns a data-uri background image string and matching backgroundSize', () => {
    const { backgroundImage, backgroundSize } = buildMazeBackground(map);
    expect(backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    expect(backgroundSize).toBe('154px 126px');
  });

  it('is deterministic — same map always produces the same output', () => {
    expect(buildMazeBackground(map)).toEqual(buildMazeBackground(map));
  });
});

describe('tileToPercent', () => {
  it('converts a tile position to a percentage within the grid', () => {
    const { left, top } = tileToPercent(map, { x: 1, y: 1 });
    expect(parseFloat(left)).toBeCloseTo((1.5 / 11) * 100);
    expect(parseFloat(top)).toBeCloseTo((1.5 / 9) * 100);
  });
});

describe('findPath', () => {
  it('starts at map.start and ends at map.exit', () => {
    const path = findPath(map);
    expect(path[0]).toEqual(map.start);
    expect(path[path.length - 1]).toEqual(map.exit);
  });

  it('only steps through non-wall tiles', () => {
    for (const tile of findPath(map)) {
      expect(map.grid[tile.y]![tile.x]).not.toBe('wall');
    }
  });

  it('every consecutive pair of tiles is adjacent (no teleporting)', () => {
    const path = findPath(map);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      expect(manhattan).toBe(1);
    }
  });

  it('is deterministic — same map always produces the same path', () => {
    expect(findPath(map)).toEqual(findPath(map));
  });
});

describe('angleBetween', () => {
  it('points right (east) as 0deg', () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90 + 0);
  });

  it('points down (south) when moving in +y', () => {
    expect(angleBetween({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(180);
  });

  it('points left (west) when moving in -x', () => {
    expect(angleBetween({ x: 1, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(270);
  });

  it('points up (north) when moving in -y', () => {
    expect(angleBetween({ x: 0, y: 1 }, { x: 0, y: 0 })).toBeCloseTo(0);
  });
});
