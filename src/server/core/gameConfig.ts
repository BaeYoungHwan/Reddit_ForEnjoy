import type { ItemType, TrapType } from '../../shared/game-types';

/** 근거: docs/design-docs/async-delivery.md 6절 (렌더링/네트워크/게임성 트레이드오프) */
export const FOOTPRINT_CAP_PER_MAP = 300;

/** 근거: docs/design-docs/traps.md 공통 규칙. ⚠️ 플레이테스트로 조정 예정인 초안 수치 */
export const TOTAL_TRAP_CAP = 3;
export const PER_TYPE_TRAP_CAP: Record<TrapType, number> = {
  slow: 2,
  respawn: 1,
  blind: 1,
  reverse: 2,
};

/** 근거: async-delivery.md 2절 "위치 앵커" — 세션 안전장치용 TTL(2시간) */
export const POSITION_ANCHOR_TTL_SECONDS = 2 * 60 * 60;

/** 근거: async-delivery.md 2절 — 리셋 기준은 날짜가 포함된 키 이름, TTL은 메모리 정리용 안전장치(3일) */
export const DATA_SAFETY_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * 근거: docs/design-docs/items.md 함정 탐지기 초안 수치("반경 3칸") — 2026-07-14 실플레이
 * 피드백으로 7칸으로 확대(반경이 너무 좁다는 지적).
 * 거리 기준은 체비셰프 거리(대각선 포함, game.tsx의 updateFog 시야 반경 계산과 동일 공식) — 맨해튼 거리 아님.
 */
export const DETECTOR_REVEAL_RADIUS = 7;

/**
 * 미스터리 박스 결과 풀 — 8종 uniform random(각 12.5%, 아이템:함정 = 50:50).
 * 근거: docs/design-docs/items.md "스폰 시각/판정 방식 변경" 절.
 * ⚠️ 플레이테스트로 조정 예정인 가정치 — MVP 기본값으로 그룹 내 균등 분배 채택.
 */
export const MYSTERY_BOX_OUTCOME_POOL: ReadonlyArray<
  { outcome: 'item'; type: ItemType } | { outcome: 'trap'; type: TrapType }
> = [
  { outcome: 'item', type: 'flashlight' },
  { outcome: 'item', type: 'shield' },
  { outcome: 'item', type: 'detector' },
  { outcome: 'item', type: 'trapInstall' },
  { outcome: 'trap', type: 'slow' },
  { outcome: 'trap', type: 'respawn' },
  { outcome: 'trap', type: 'blind' },
  { outcome: 'trap', type: 'reverse' },
];
