// playSfx의 "지금 재생할지 / 대기열에 쌓을지 / 음소거라 무시할지" 판단을 Phaser Sound/Timer와
// 분리된 순수 로직으로 뽑아서 vitest로 단위 테스트 가능하게 한다(PR#66 리뷰 — 이 상태 전이가
// 이미 세 번 재설계됐는데도 자동화된 회귀 테스트가 없었음). game.tsx의 MazeScene은 이 함수들의
// 결과에 따라 실제 Phaser 사운드 재생/파괴만 담당하고, "무엇을 할지"는 여기서 결정한다.

export type SfxRequestDecision<T> =
  | { action: 'play'; queue: T[] }
  | { action: 'queued'; queue: T[] }
  | { action: 'muted'; queue: T[] };

// playSfx가 새 효과음 요청을 받았을 때의 판단. 음소거면 큐를 안 건드리고 무시, 지금 다른
// 효과음이 재생 중이면 큐에 쌓되(상한을 넘으면 가장 오래된 것부터 버림 — 플레이어가 매우
// 빠르게 여러 함정을 연달아 밟는 극단적 상황에서 큐가 무한정 쌓이지 않게), 아니면 즉시 재생.
export function decideSfxRequest<T>(
  queue: readonly T[],
  key: T,
  isMuted: boolean,
  isCurrentlyPlaying: boolean,
  maxQueueLength: number
): SfxRequestDecision<T> {
  if (isMuted) return { action: 'muted', queue: [...queue] };
  if (isCurrentlyPlaying) {
    const next = [...queue];
    if (next.length >= maxQueueLength) next.shift();
    next.push(key);
    return { action: 'queued', queue: next };
  }
  return { action: 'play', queue: [...queue] };
}

// 재생 중이던 소리가 자연스럽게 끝나거나(재생 완료 타이머) 재생 자체가 실패했을 때(catch),
// 큐에서 다음에 재생할 것을 꺼낸다. 음소거 중이면 큐를 비우고 아무것도 재생하지 않는다 —
// 안 비우면 이미 대기 중이던 소리가 음소거 후에도 뒤늦게 재생되는 버그가 있었다(PR#66에서
// 발견: setSfxMuted가 큐를 비워도, 그 이전에 이미 예약된 재생-완료 타이머가 비우기 전 큐를
// 그대로 이어서 재생해버림).
export function decideNextInQueue<T>(queue: readonly T[], isMuted: boolean): { next: T | null; queue: T[] } {
  if (isMuted || queue.length === 0) return { next: null, queue: [] };
  const [next, ...rest] = queue;
  return { next: next as T, queue: rest };
}

// setSfxMuted(muted)가 호출됐을 때 큐에 적용할 값. 음소거하는 순간 대기 중이던 소리를 전부
// 버린다(위 decideNextInQueue의 방어와 같은 의도 — 음소거는 "지금부터 아무 효과음도 안 들림"
// 이어야 한다).
export function clearQueueOnMute<T>(queue: readonly T[], muted: boolean): T[] {
  return muted ? [] : [...queue];
}
