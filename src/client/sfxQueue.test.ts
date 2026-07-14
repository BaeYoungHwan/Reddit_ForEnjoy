import { describe, expect, it } from 'vitest';
import { clearQueueOnMute, decideNextInQueue, decideSfxRequest } from './sfxQueue';

describe('decideSfxRequest', () => {
  it('ignores the request when muted, leaving the queue untouched', () => {
    const result = decideSfxRequest(['itemPickup'], 'goal', true, false, 5);
    expect(result).toEqual({ action: 'muted', queue: ['itemPickup'] });
  });

  it('plays immediately when nothing is currently playing', () => {
    const result = decideSfxRequest([], 'trapSlide', false, false, 5);
    expect(result).toEqual({ action: 'play', queue: [] });
  });

  it('queues the request when something is already playing (PR#66 발견 버그 — 예전엔 즉시 끊겨 안 들렸음)', () => {
    const result = decideSfxRequest([], 'itemPickup', false, true, 5);
    expect(result).toEqual({ action: 'queued', queue: ['itemPickup'] });
  });

  it('appends to an existing queue in order', () => {
    const result = decideSfxRequest(['trapBlind'], 'itemPickup', false, true, 5);
    expect(result).toEqual({ action: 'queued', queue: ['trapBlind', 'itemPickup'] });
  });

  it('drops the oldest queued item once the max length is reached', () => {
    const result = decideSfxRequest(['a', 'b', 'c'], 'd', false, true, 3);
    expect(result).toEqual({ action: 'queued', queue: ['b', 'c', 'd'] });
  });
});

describe('decideNextInQueue', () => {
  it('returns null and an empty queue when muted, even if items were queued', () => {
    expect(decideNextInQueue(['itemPickup', 'trapBlind'], true)).toEqual({ next: null, queue: [] });
  });

  it('returns null when the queue is already empty', () => {
    expect(decideNextInQueue([], false)).toEqual({ next: null, queue: [] });
  });

  it('shifts the first queued item off and returns the rest in order', () => {
    expect(decideNextInQueue(['trapBlind', 'itemPickup'], false)).toEqual({
      next: 'trapBlind',
      queue: ['itemPickup'],
    });
  });
});

describe('clearQueueOnMute', () => {
  it('empties the queue when muting', () => {
    expect(clearQueueOnMute(['itemPickup', 'trapBlind'], true)).toEqual([]);
  });

  it('leaves the queue untouched when unmuting', () => {
    expect(clearQueueOnMute(['itemPickup'], false)).toEqual(['itemPickup']);
  });
});
