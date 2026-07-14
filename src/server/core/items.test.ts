import { describe, expect, it } from 'vitest';
import { getMysteryBoxSpawns } from './items';

describe('getMysteryBoxSpawns', () => {
  it('returns the registered spawns for a known map id', () => {
    expect(getMysteryBoxSpawns('map-1')).toEqual([
      { x: 5, y: 12 },
      { x: 9, y: 1 },
      { x: 15, y: 12 },
    ]);
    expect(getMysteryBoxSpawns('map-2')).toEqual([
      { x: 17, y: 1 },
      { x: 11, y: 8 },
      { x: 12, y: 19 },
    ]);
  });

  it('falls back to map-1 spawns for an unknown id', () => {
    expect(getMysteryBoxSpawns('does-not-exist')).toEqual(getMysteryBoxSpawns('map-1'));
  });

  it('falls back to map-1 spawns for Object.prototype keys instead of crashing (PR#60 리뷰에서 발견)', () => {
    expect(getMysteryBoxSpawns('constructor')).toEqual(getMysteryBoxSpawns('map-1'));
    expect(getMysteryBoxSpawns('toString')).toEqual(getMysteryBoxSpawns('map-1'));
    expect(getMysteryBoxSpawns('hasOwnProperty')).toEqual(getMysteryBoxSpawns('map-1'));
  });
});
