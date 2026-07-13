import type { TrapType } from '../shared/game-types';

// 설치형 함정(trap.trigger)과 미스터리 박스 함정(item.pickup의 outcome:'trap')이 같은 이동에서
// 동시에 걸릴 수 있다(traps.md 0절: 두 보드는 완전히 독립돼 있어 같은 타일에 공존 가능). 이
// 함수는 두 판정 결과와 쉴드 보유 여부를 받아 "쉴드가 어느 쪽을 막았는지"와 "최종적으로 적용할
// 효과 목록"을 결정하는 순수 함수다 — Phaser/네트워크/isMoving 등 어떤 부수효과도 없어서
// game.tsx의 resolveArrival()이 이 결과를 그대로 실행만 하면 된다.
//
// game.tsx에서 checkItemPickup/checkTrapTrigger가 각자 독립적으로 isMoving과 hasShield를
// 건드리던 것을 이 함수 + resolveArrival 한 곳으로 합쳐서, 두 서버 응답이 어느 순서로 오든
// 최종 결과가 항상 같도록 만든다(레이스 제거).

export type ShieldPriority = 'installed' | 'mystery';

// 설치형 함정(다른 유저가 몰래 깐, 오라클 방지로 안 보이는 위협)을 미스터리 박스보다 먼저
// 막는다 — 미스터리 박스는 "내가 직접 밟기로 고른 도박"에 가까워, 남이 깐 함정으로부터
// 보호받고 싶다는 기대가 더 크다고 판단(팀 논의 전 기본값, 바꾸려면 이 상수만 수정하면 됨).
export const SHIELD_BLOCK_PRIORITY: ShieldPriority = 'installed';

export type TrapResolution = {
  shieldConsumedFor: 'installed' | 'mystery' | null;
  // 쉴드로 막힌 것 제외, 타입 중복 제거(둘 다 slow인 경우 슬라이드 중복 시작 방지), respawn과
  // slow가 같이 있으면 slow 제거(아래 respawn 처리 참고), 항상 installed → mystery 순서.
  effectsToApply: TrapType[];
};

export function resolveTrapEncounters(
  installedType: TrapType | null,
  mysteryType: TrapType | null,
  hasShieldBeforeMove: boolean,
  priority: ShieldPriority = SHIELD_BLOCK_PRIORITY
): TrapResolution {
  const encounters: Array<{ source: 'installed' | 'mystery'; type: TrapType }> = [];
  if (installedType) encounters.push({ source: 'installed', type: installedType });
  if (mysteryType) encounters.push({ source: 'mystery', type: mysteryType });

  if (encounters.length === 0) {
    return { shieldConsumedFor: null, effectsToApply: [] };
  }

  let survivors = encounters;
  let shieldConsumedFor: 'installed' | 'mystery' | null = null;

  if (hasShieldBeforeMove) {
    const preferred = encounters.find((e) => e.source === priority) ?? encounters[0]!;
    shieldConsumedFor = preferred.source;
    survivors = encounters.filter((e) => e !== preferred);
  }

  const seen = new Set<TrapType>();
  const effectsToApply: TrapType[] = [];
  for (const encounter of survivors) {
    if (seen.has(encounter.type)) continue;
    seen.add(encounter.type);
    effectsToApply.push(encounter.type);
  }

  // respawn과 slow가 같은 이동에서 함께 살아남으면(설치형+미스터리 박스 함정이 같은 타일에
  // 공존할 때 발생 가능) slow를 제거한다 — respawn은 위치를 스폰으로 되돌리는 효과라, 그 뒤에
  // slow(슬라이드)를 적용하면 game.tsx의 applySlideTrap이 "함정을 밟은 타일"이 아니라 "방금
  // 리스폰된 스폰 지점"을 기준으로 미끄러지기 시작해 위치가 뒤섞이는 버그가 있었다(2026-07-13
  // 코드리뷰 발견). respawn이 이미 위치·탐험 기록을 초기화하는 가장 강한 페널티라, 그 위에
  // slow를 얹지 않아도 페널티 의미는 유지된다.
  if (effectsToApply.includes('respawn')) {
    return { shieldConsumedFor, effectsToApply: effectsToApply.filter((type) => type !== 'slow') };
  }

  return { shieldConsumedFor, effectsToApply };
}
