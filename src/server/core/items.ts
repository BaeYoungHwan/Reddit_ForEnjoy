import type { ItemType, Position, TrapType } from '../../shared/game-types';
import { computeMandatoryPathTiles, getMazeMap } from '../../shared/maps';
import { MYSTERY_BOX_OUTCOME_POOL } from './gameConfig';

// 2026-07-14 임소리: PRD-v1.md 79행(P1 MVP 핵심 루프)이 "랜덤 스폰"을 명시하는데, 지금까지는
// 맵마다 고정 좌표 3곳만 심어둔 임시 구현이었다(스폰 "위치"는 고정, "결과"만 rollMysteryOutcome()
// 으로 픽업 시점에 랜덤 — items.md "스폰 시각/판정 방식 변경" 절). 실서버 QA에서 "박스가 안
// 보인다"는 반복 보고로 정식 랜덤 스폰을 이번에 구현: 호출부(trpc.ts ensureMysteryBoxesSeeded)가
// 넘기는 시드 문자열로 의사난수를 고정해, 벽·시작 칸·"무조건 지나가야 하는 칸"(아래 참고)을
// 제외한 바닥 칸 후보 중 8곳(결과 풀 8종 — 아이템4+함정4 — 과 개수를 맞춤, MYSTERY_BOX_OUTCOME_POOL
// 참고)을 고른다. 시작→골인 사이 "무조건 지나가야 하는 칸"(computeMandatoryPathTiles,
// shared/maps.ts)은 후보에서 제외한다 — 그런 칸에 스폰되면 함정 탐지기로 미리 알아도 피할
// 방법이 없어 탐지기의 의미가 없어진다(다른 유저가 일부러 길목에 설치하는 함정은 이 제약
// 대상이 아님, 그건 의도된 견제 메커니즘). 시드 문자열 자체(날짜/유저/재도전 횟수를 어떻게
// 조합할지)는 호출부 책임 — 이 함수는 "같은 시드는 항상 같은 결과"라는 순수 함수 계약만
// 지킨다(2026-07-14 재검토: 초기엔 맵+날짜로만 시드해 "같은 날 재도전해도 정확히 같은 위치가
// 다시 나오는" 버그가 있었음 — 재도전마다 결과가 달라야 한다는 요구사항 재확인 후, 시드에
// 유저+재도전 시각까지 섞도록 호출부를 수정함).
const MYSTERY_BOX_SPAWN_COUNT = MYSTERY_BOX_OUTCOME_POOL.length;

/** 시드 고정 의사난수 생성기(mulberry32) — mazePattern.ts와 동일한 패턴, Math.random 대신 사용. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// mapId는 getMazeMap이 이미 안전하게 화이트리스트 검증(hasOwnProperty 기반, 미등록 시 map-1로
// 폴백)하므로 여기서 별도 검증이 필요 없다(PR#60 리뷰에서 발견된 프로토타입 오염 취약점과 동일
// 클래스 방어를 getMazeMap 쪽에서 이미 재사용). seed는 순수하게 난수 고정용 문자열 — 형식
// 검증은 하지 않는다(호출부가 무엇을 섞어 넣을지 자유롭게 정함, 위 주석 참고).
export function getMysteryBoxSpawns(mapId: string, seed: string): Position[] {
  const map = getMazeMap(mapId);
  const mandatory = computeMandatoryPathTiles(map);

  const candidates: Position[] = [];
  for (let y = 0; y < map.grid.length; y++) {
    for (let x = 0; x < map.grid[y]!.length; x++) {
      if (map.grid[y]![x] !== 'floor') continue;
      if (x === map.start.x && y === map.start.y) continue;
      if (mandatory.has(`${x},${y}`)) continue;
      candidates.push({ x, y });
    }
  }

  // 2026-07-14 PR#70 리뷰 지적: 후보가 MYSTERY_BOX_SPAWN_COUNT(8)보다 적으면 아래 slice가
  // 에러 없이 그보다 적은 개수를 조용히 반환한다 — 지금 등록된 맵(25x21 안팎)에선 후보가
  // 항상 8개보다 훨씬 많아 실제로 발생하지 않지만, 나중에 더 작은 맵이 추가되면 "스폰 8곳
  // 보장"이 소리 없이 깨질 수 있으므로 개발 중 알아챌 수 있게 경고만 남긴다(런타임 동작은
  // 그대로 유지 — 이 함수는 순수 함수 계약을 지켜야 해서 여기서 에러를 던지지 않는다).
  if (candidates.length < MYSTERY_BOX_SPAWN_COUNT) {
    console.warn(
      `getMysteryBoxSpawns: 맵 "${map.id}"의 스폰 후보(${candidates.length}개)가 필요한 개수` +
        `(${MYSTERY_BOX_SPAWN_COUNT}개)보다 적습니다 — 스폰이 ${candidates.length}곳만 채워집니다.`
    );
  }

  const rand = mulberry32(hashSeed(`${map.id}:${seed}`));
  // Fisher-Yates 셔플(시드 고정이라 같은 mapId+seed는 항상 같은 순서) 후 앞에서 필요한 개수만.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  return candidates.slice(0, MYSTERY_BOX_SPAWN_COUNT);
}

export function rollMysteryOutcome():
  | { outcome: 'item'; type: ItemType }
  | { outcome: 'trap'; type: TrapType } {
  const index = Math.floor(Math.random() * MYSTERY_BOX_OUTCOME_POOL.length);
  return MYSTERY_BOX_OUTCOME_POOL[index]!;
}
