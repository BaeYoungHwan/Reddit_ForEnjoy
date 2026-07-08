import { describe, expect, it } from 'vitest';
import { formatClearTime } from './format';

describe('formatClearTime', () => {
  it('formats zero', () => {
    expect(formatClearTime(0)).toBe('0:00.000');
  });

  it('formats sub-minute durations', () => {
    expect(formatClearTime(5432)).toBe('0:05.432');
  });

  it('formats minutes, seconds, and milliseconds together', () => {
    expect(formatClearTime(65432)).toBe('1:05.432');
  });

  it('pads seconds and milliseconds', () => {
    expect(formatClearTime(60001)).toBe('1:00.001');
  });
});
