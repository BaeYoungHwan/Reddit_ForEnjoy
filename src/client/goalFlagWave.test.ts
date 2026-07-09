import { describe, expect, it } from 'vitest';
import { computeClothWaveX } from './goalFlagWave';

const COLS = 12;
const CYCLES = 2;
const AMPLITUDE = 0.7;
const SPEED = 4.5;
const WIDTH = 340;

describe('computeClothWaveX', () => {
  it('always pins the first vertex at 0 and the last at the full width', () => {
    for (let t = 0; t < 20; t += 0.37) {
      const xs = computeClothWaveX(COLS, CYCLES, AMPLITUDE, SPEED, t, WIDTH);
      expect(xs[0]).toBe(0);
      expect(xs[COLS]).toBeCloseTo(WIDTH, 9);
    }
  });

  it('is strictly increasing (vertices never fold over or invert order)', () => {
    for (let t = 0; t < 20; t += 0.29) {
      const xs = computeClothWaveX(COLS, CYCLES, AMPLITUDE, SPEED, t, WIDTH);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
      }
    }
  });

  it('is deterministic for the same inputs', () => {
    const a = computeClothWaveX(COLS, CYCLES, AMPLITUDE, SPEED, 3.14, WIDTH);
    const b = computeClothWaveX(COLS, CYCLES, AMPLITUDE, SPEED, 3.14, WIDTH);
    expect(a).toEqual(b);
  });

  it('is continuous across one full wave period (no visual jump when wrapping elapsed time)', () => {
    const period = (2 * Math.PI) / SPEED;
    const before = computeClothWaveX(COLS, CYCLES, AMPLITUDE, SPEED, 5, WIDTH);
    const afterWrap = computeClothWaveX(COLS, CYCLES, AMPLITUDE, SPEED, 5 - period, WIDTH);
    for (let i = 0; i < before.length; i++) {
      expect(afterWrap[i]!).toBeCloseTo(before[i]!, 9);
    }
  });
});
