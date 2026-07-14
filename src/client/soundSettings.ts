// 배경음악(BGM)/효과음(SFX) 음소거·볼륨 설정을 splash.tsx(전체 조절 UI)와 game.tsx(인게임
// BGM 음소거 버튼) 사이에 공유하기 위한 저장소. 두 화면이 서로 다른 웹뷰(entrypoint)라
// React state로는 못 넘기고 loadout.ts와 동일한 방식으로 localStorage를 다리로 쓴다. 두 화면이
// 동시에 떠 있는 경우는 없어(메뉴→게임 순차 전환) 실시간 탭 간 동기화는 필요 없고, 화면 진입
// 시 1회 읽고 변경 시 즉시 저장하는 것으로 충분하다.
export const SOUND_SETTINGS_STORAGE_KEY = 'maze-footprints:sound-settings';

export type SoundSettings = {
  bgmMuted: boolean;
  bgmVolume: number; // 0~1
  sfxMuted: boolean;
  sfxVolume: number; // 0~1 — 기존 개별 효과음 볼륨(game.tsx DEFAULT_SFX_VOLUME 등)에 곱해지는 배율
};

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  bgmMuted: false,
  // 2026-07-14 피드백: 0.4는 발걸음/함정 등 게임 효과음을 덮을 만큼 커서 0.25로 낮춤 — game.tsx가
  // 효과음 재생 중엔 추가로 덕킹(duckBgmFor)까지 하므로, 이 값은 "아무 효과음도 안 날 때"의
  // 평상시 배경음량 기준이다.
  bgmVolume: 0.25,
  sfxMuted: false,
  sfxVolume: 1,
};

function clampVolume(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

// localStorage에 저장된 값이 구버전 스키마이거나 손상돼 있어도(직접 편집 등) 항상 안전한
// SoundSettings를 반환한다 — 필드 단위로 검증해 일부만 깨져도 나머지 기본값은 유지.
export function loadSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SOUND_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SOUND_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      bgmMuted: typeof parsed.bgmMuted === 'boolean' ? parsed.bgmMuted : DEFAULT_SOUND_SETTINGS.bgmMuted,
      bgmVolume:
        parsed.bgmVolume !== undefined ? clampVolume(parsed.bgmVolume) : DEFAULT_SOUND_SETTINGS.bgmVolume,
      sfxMuted: typeof parsed.sfxMuted === 'boolean' ? parsed.sfxMuted : DEFAULT_SOUND_SETTINGS.sfxMuted,
      sfxVolume:
        parsed.sfxVolume !== undefined ? clampVolume(parsed.sfxVolume) : DEFAULT_SOUND_SETTINGS.sfxVolume,
    };
  } catch {
    return DEFAULT_SOUND_SETTINGS;
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(SOUND_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage 접근이 막힌 환경에서도 현재 세션 재생엔 지장 없음 — 설정만 다음 로드에 반영 안 됨
  }
}
