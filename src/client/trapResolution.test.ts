import { describe, expect, it } from 'vitest';
import { resolveTrapEncounters } from './trapResolution';

describe('resolveTrapEncounters', () => {
  it('둘 다 없으면 아무 효과도 적용하지 않는다', () => {
    expect(resolveTrapEncounters(null, null, false)).toEqual({
      shieldConsumedFor: null,
      effectsToApply: [],
    });
  });

  it('설치형 함정만 있으면 그대로 적용한다(쉴드 없음)', () => {
    expect(resolveTrapEncounters('respawn', null, false)).toEqual({
      shieldConsumedFor: null,
      effectsToApply: ['respawn'],
    });
  });

  it('미스터리 박스 함정만 있으면 그대로 적용한다(쉴드 없음)', () => {
    expect(resolveTrapEncounters(null, 'blind', false)).toEqual({
      shieldConsumedFor: null,
      effectsToApply: ['blind'],
    });
  });

  it('둘 다 있고 타입이 다르면 설치형 → 미스터리 순서로 둘 다 적용한다(쉴드 없음)', () => {
    expect(resolveTrapEncounters('respawn', 'blind', false)).toEqual({
      shieldConsumedFor: null,
      effectsToApply: ['respawn', 'blind'],
    });
  });

  it('쉴드가 있으면 기본 우선순위(설치형)를 막고, 미스터리 박스 효과만 적용한다', () => {
    expect(resolveTrapEncounters('respawn', 'blind', true)).toEqual({
      shieldConsumedFor: 'installed',
      effectsToApply: ['blind'],
    });
  });

  it('priority를 mystery로 넘기면 미스터리 박스를 막고 설치형 효과만 적용한다', () => {
    expect(resolveTrapEncounters('respawn', 'blind', true, 'mystery')).toEqual({
      shieldConsumedFor: 'mystery',
      effectsToApply: ['respawn'],
    });
  });

  it('쉴드가 있는데 설치형만 있으면(미스터리 없음) 그 하나를 막아 효과가 없다', () => {
    expect(resolveTrapEncounters('reverse', null, true)).toEqual({
      shieldConsumedFor: 'installed',
      effectsToApply: [],
    });
  });

  it('쉴드가 있는데 미스터리 박스만 있으면(설치형 없음) priority가 installed라도 미스터리를 막는다', () => {
    // priority가 가리키는 쪽이 애초에 존재하지 않으면 존재하는 쪽을 막는다.
    expect(resolveTrapEncounters(null, 'reverse', true)).toEqual({
      shieldConsumedFor: 'mystery',
      effectsToApply: [],
    });
  });

  it('둘 다 slow면 쉴드 없이도 effectsToApply에 slow가 정확히 1개만 남는다(슬라이드 중복 시작 방지)', () => {
    const result = resolveTrapEncounters('slow', 'slow', false);
    expect(result.effectsToApply).toEqual(['slow']);
  });

  it('둘 다 slow인데 쉴드가 있으면 하나가 막히고 나머지 slow 1개만 남는다', () => {
    const result = resolveTrapEncounters('slow', 'slow', true);
    expect(result.shieldConsumedFor).toBe('installed');
    expect(result.effectsToApply).toEqual(['slow']);
  });
});
