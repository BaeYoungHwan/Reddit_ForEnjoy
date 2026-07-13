import { describe, expect, it } from 'vitest';
import { formatClearTime } from './format';

describe('formatClearTime', () => {
  it('formats zero', () => {
    expect(formatClearTime(0)).toBe('0:00.0');
  });

  it('formats sub-minute durations', () => {
    expect(formatClearTime(5432)).toBe('0:05.4');
  });

  it('formats minutes, seconds, and tenths together', () => {
    expect(formatClearTime(65432)).toBe('1:05.4');
  });

  it('pads seconds, truncates to one decimal', () => {
    expect(formatClearTime(60001)).toBe('1:00.0');
  });
});
