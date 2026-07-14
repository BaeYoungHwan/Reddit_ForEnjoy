import { describe, expect, it } from 'vitest';
import {
  MAZE_MAPS,
  SPLASH_DECORATIVE_MAP,
  computeMandatoryPathTiles,
  getMazeMap,
  pickDailyMapId,
  isRegisteredMapId,
} from './maps';

function assertWalkableStartToExit(map: (typeof MAZE_MAPS)[string]) {
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

  return visited[map.exit.y]![map.exit.x];
}

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
    expect(assertWalkableStartToExit(map)).toBe(true);
  });
});

// 2026-07-13 데일리 맵 로테이션 도입 — map-1과 동일한 기본 무결성(시작/골인 타일 파싱,
// 그리드 크기, 도달 가능성)을 map-2에도 검증한다.
describe('MAZE_MAPS / map-2', () => {
  const map = MAZE_MAPS['map-2']!;

  it('parses S as the start tile and its grid cell as floor', () => {
    expect(map.start).toEqual({ x: 1, y: 1 });
    expect(map.grid[map.start.y]![map.start.x]).toBe('floor');
  });

  it('parses E as the exit tile and its grid cell as exit', () => {
    expect(map.exit).toEqual({ x: 11, y: 15 });
    expect(map.grid[map.exit.y]![map.exit.x]).toBe('exit');
  });

  it('produces a rectangular grid matching the layout dimensions', () => {
    expect(map.grid.length).toBe(21);
    for (const row of map.grid) {
      expect(row.length).toBe(25);
    }
  });

  it('has a walkable path from start to exit (not walled off)', () => {
    expect(assertWalkableStartToExit(map)).toBe(true);
  });
});

// 2026-07-14 피드백: 스플래시 배경 미로가 오늘 실제 플레이 맵과 똑같아서 스포일러가 되던 문제로
// 분리한 장식 전용 맵(splash.tsx가 배경/발자국 애니메이션에만 씀) — map-1/map-2와 동일한 무결성
// 검증에 더해, MAZE_MAPS에 절대 등록되면 안 된다는 것(=pickDailyMapId/getMazeMap이 실제 플레이
// 맵으로 못 고름)도 함께 고정한다.
describe('SPLASH_DECORATIVE_MAP', () => {
  const map = SPLASH_DECORATIVE_MAP;

  it('parses S as the start tile and its grid cell as floor', () => {
    expect(map.start).toEqual({ x: 1, y: 1 });
    expect(map.grid[map.start.y]![map.start.x]).toBe('floor');
  });

  it('parses E as the exit tile and its grid cell as exit', () => {
    expect(map.exit).toEqual({ x: 11, y: 3 });
    expect(map.grid[map.exit.y]![map.exit.x]).toBe('exit');
  });

  it('produces a rectangular grid matching the layout dimensions', () => {
    expect(map.grid.length).toBe(21);
    for (const row of map.grid) {
      expect(row.length).toBe(25);
    }
  });

  it('has a walkable path from start to exit (not walled off)', () => {
    expect(assertWalkableStartToExit(map)).toBe(true);
  });

  it('is not registered in MAZE_MAPS — must never be selectable as a real playable map', () => {
    expect(Object.values(MAZE_MAPS)).not.toContain(map);
    expect(MAZE_MAPS[map.id]).toBeUndefined();
  });
});

describe('getMazeMap', () => {
  it('returns the requested map by id', () => {
    expect(getMazeMap('map-1').id).toBe('map-1');
    expect(getMazeMap('map-2').id).toBe('map-2');
  });

  it('falls back to map-1 for an unknown id', () => {
    expect(getMazeMap('does-not-exist').id).toBe('map-1');
  });

  it('falls back to map-1 for Object.prototype keys instead of returning a non-map value', () => {
    expect(getMazeMap('constructor').id).toBe('map-1');
    expect(getMazeMap('toString').id).toBe('map-1');
  });
});

describe('isRegisteredMapId', () => {
  it('accepts registered map ids', () => {
    expect(isRegisteredMapId('map-1')).toBe(true);
    expect(isRegisteredMapId('map-2')).toBe(true);
  });

  it('rejects unknown ids', () => {
    expect(isRegisteredMapId('does-not-exist')).toBe(false);
  });

  it('rejects Object.prototype keys (in 연산자로는 뚫리는 프로토타입 우회 케이스)', () => {
    expect(isRegisteredMapId('constructor')).toBe(false);
    expect(isRegisteredMapId('toString')).toBe(false);
    expect(isRegisteredMapId('hasOwnProperty')).toBe(false);
    expect(isRegisteredMapId('valueOf')).toBe(false);
  });
});

// computeMandatoryPathTiles와는 독립적으로 다시 구현한 BFS — "제거하면 시작→골인이 끊기는
// 칸"이라는 정의를 별도 코드로 재검증해 순환 논리(같은 구현으로 자기 자신을 검증)를 피한다.
function isConnectedWithoutTile(map: (typeof MAZE_MAPS)[string], excluded: { x: number; y: number }) {
  const width = map.grid[0]!.length;
  const height = map.grid.length;
  const visited = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
  if (map.start.x === excluded.x && map.start.y === excluded.y) return false;
  visited[map.start.y]![map.start.x] = true;
  const queue: [number, number][] = [[map.start.x, map.start.y]];

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
      if (nx === excluded.x && ny === excluded.y) continue;
      if (visited[ny]![nx]) continue;
      if (map.grid[ny]![nx] === 'wall') continue;
      visited[ny]![nx] = true;
      queue.push([nx, ny]);
    }
  }

  return visited[map.exit.y]![map.exit.x] === true;
}

describe('computeMandatoryPathTiles', () => {
  it.each(['map-1', 'map-2'] as const)(
    '%s: 반환된 모든 칸은 실제로 제거하면 시작→골인이 끊긴다(독립 BFS로 교차검증)',
    (mapId) => {
      const map = MAZE_MAPS[mapId]!;
      const mandatory = computeMandatoryPathTiles(map);
      expect(mandatory.size).toBeGreaterThan(0);
      for (const key of mandatory) {
        const [xStr, yStr] = key.split(',');
        const tile = { x: Number(xStr), y: Number(yStr) };
        expect(isConnectedWithoutTile(map, tile)).toBe(false);
      }
    }
  );

  it.each(['map-1', 'map-2'] as const)(
    '%s: 반환되지 않은 바닥 칸(표본)은 제거해도 시작→골인이 여전히 연결된다',
    (mapId) => {
      const map = MAZE_MAPS[mapId]!;
      const mandatory = computeMandatoryPathTiles(map);
      let checked = 0;
      for (let y = 0; y < map.grid.length && checked < 15; y++) {
        for (let x = 0; x < map.grid[y]!.length && checked < 15; x++) {
          if (map.grid[y]![x] !== 'floor') continue;
          if (x === map.start.x && y === map.start.y) continue;
          if (x === map.exit.x && y === map.exit.y) continue;
          if (mandatory.has(`${x},${y}`)) continue;
          expect(isConnectedWithoutTile(map, { x, y })).toBe(true);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0); // 표본이 하나도 없으면(전부 mandatory) 이 테스트가 무의미해짐 방지
    }
  );

  it('시작/골인 칸 자체는 결과에 포함하지 않는다', () => {
    for (const mapId of ['map-1', 'map-2'] as const) {
      const map = MAZE_MAPS[mapId]!;
      const mandatory = computeMandatoryPathTiles(map);
      expect(mandatory.has(`${map.start.x},${map.start.y}`)).toBe(false);
      expect(mandatory.has(`${map.exit.x},${map.exit.y}`)).toBe(false);
    }
  });

  it('벽 칸은 절대 포함하지 않는다', () => {
    for (const mapId of ['map-1', 'map-2'] as const) {
      const map = MAZE_MAPS[mapId]!;
      const mandatory = computeMandatoryPathTiles(map);
      for (const key of mandatory) {
        const [xStr, yStr] = key.split(',');
        expect(map.grid[Number(yStr)]![Number(xStr)]).toBe('floor');
      }
    }
  });
});

describe('pickDailyMapId', () => {
  it('is deterministic — same date string always yields the same map', () => {
    const a = pickDailyMapId('2026-07-13');
    const b = pickDailyMapId('2026-07-13');
    expect(a).toBe(b);
  });

  it('only ever returns a registered map id', () => {
    const ids = Object.keys(MAZE_MAPS);
    for (const date of ['2026-07-13', '2026-07-14', '2026-07-15', '2026-01-01', '2030-12-31']) {
      expect(ids).toContain(pickDailyMapId(date));
    }
  });

  it('picks different maps on at least some different dates (not stuck on one map)', () => {
    const picks = new Set(
      Array.from({ length: 30 }, (_, i) => pickDailyMapId(`2026-07-${String(i + 1).padStart(2, '0')}`))
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});
