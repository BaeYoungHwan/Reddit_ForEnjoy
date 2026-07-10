import type { TrapType } from '../../shared/game-types';

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

/** 근거: docs/design-docs/items.md 함정 탐지기 초안 수치("반경 3칸"). ⚠️ 플레이테스트로 조정 예정인 가정치 */
export const DETECTOR_REVEAL_RADIUS = 3;
