import { describe, expect, it } from 'vitest';
import { computeMandatoryPathTiles, getMazeMap } from '../../shared/maps';
import { getMysteryBoxSpawns } from './items';
import { MYSTERY_BOX_OUTCOME_POOL } from './gameConfig';

describe('getMysteryBoxSpawns', () => {
  it('returns MYSTERY_BOX_OUTCOME_POOL.length(8) positions for a known map id', () => {
    expect(getMysteryBoxSpawns('map-1', '2026-07-14')).toHaveLength(MYSTERY_BOX_OUTCOME_POOL.length);
    expect(getMysteryBoxSpawns('map-2', '2026-07-14')).toHaveLength(MYSTERY_BOX_OUTCOME_POOL.length);
  });

  it('is deterministic — same mapId + date always yields the same spawns', () => {
    const first = getMysteryBoxSpawns('map-1', '2026-07-14');
    const second = getMysteryBoxSpawns('map-1', '2026-07-14');
    expect(second).toEqual(first);
  });

  it('picks different spawns on at least some different dates (not stuck on one layout)', () => {
    const dates = Array.from({ length: 20 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);
    const serialized = new Set(dates.map((date) => JSON.stringify(getMysteryBoxSpawns('map-1', date))));
    expect(serialized.size).toBeGreaterThan(1);
  });

  it('never spawns on a wall, the start tile, or a "무조건 지나가야 하는" mandatory-path tile', () => {
    for (const mapId of ['map-1', 'map-2'] as const) {
      const map = getMazeMap(mapId);
      const mandatory = computeMandatoryPathTiles(map);
      for (const date of ['2026-07-14', '2026-07-15', '2026-08-01']) {
        for (const spawn of getMysteryBoxSpawns(mapId, date)) {
          expect(map.grid[spawn.y]?.[spawn.x]).toBe('floor');
          expect(spawn).not.toEqual(map.start);
          expect(mandatory.has(`${spawn.x},${spawn.y}`)).toBe(false);
        }
      }
    }
  });

  it('never returns duplicate positions for the same mapId + date', () => {
    const spawns = getMysteryBoxSpawns('map-2', '2026-07-14');
    const unique = new Set(spawns.map((p) => `${p.x},${p.y}`));
    expect(unique.size).toBe(spawns.length);
  });

  it('falls back to map-1 spawns for an unknown id (getMazeMap의 기존 화이트리스트 폴백 재사용)', () => {
    expect(getMysteryBoxSpawns('does-not-exist', '2026-07-14')).toEqual(getMysteryBoxSpawns('map-1', '2026-07-14'));
  });

  it('falls back to map-1 spawns for Object.prototype keys instead of crashing (PR#60 리뷰에서 발견된 취약점과 동일 클래스)', () => {
    expect(getMysteryBoxSpawns('constructor', '2026-07-14')).toEqual(getMysteryBoxSpawns('map-1', '2026-07-14'));
    expect(getMysteryBoxSpawns('toString', '2026-07-14')).toEqual(getMysteryBoxSpawns('map-1', '2026-07-14'));
    expect(getMysteryBoxSpawns('hasOwnProperty', '2026-07-14')).toEqual(getMysteryBoxSpawns('map-1', '2026-07-14'));
  });
});
