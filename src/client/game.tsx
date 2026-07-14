import './index.css';

import Phaser from 'phaser';
import { StrictMode, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { exitExpandedMode } from '@devvit/web/client';
import { getMazeMap } from '../shared/maps';
import { buildRockWallTileDataUri } from './mazePattern';
import { computeClothWaveX } from './goalFlagWave';
import { trpc } from './trpcClient';
import { SequentialDispatcher } from './sequentialDispatcher';
import { LOADOUT_STORAGE_KEY } from './loadout';
import { resolveTrapEncounters } from './trapResolution';
import type {
  ItemPickupOutput,
  ItemType,
  ItemUseDetectorOutput,
  Position,
  RunFinishOutput,
  TrapInstallOutput,
  TrapInstance,
  TrapTriggerOutput,
  TrapType,
} from '../shared/game-types';

// flashPlayerTrap/activeTrapEffects가 다루는 함정 종류. 슬라이드('slow')는 지속시간이
// 고정이 아니라(벽 만날 때까지) 이 지속시간 기반 메커니즘에 절대 들어가면 안 되고
// isSliding으로 따로 관리해야 하므로, 타입에서부터 제외해 실수로 섞여 들어가는 걸
// 컴파일 타임에 막는다.
type TimedTrapType = Exclude<TrapType, 'slow'>;

// 실제 고정 맵 데이터(송원호 담당, src/shared/maps.ts). splash.tsx의 배경 미리보기와 같은 데이터.
const MAIN_MAP = getMazeMap('map-1');
const MAP_WIDTH = MAIN_MAP.grid[0]!.length;
const MAP_HEIGHT = MAIN_MAP.grid.length;

// 서버에 등록된 실제 맵 ID. 함정/발자국 API는 mapId 단위로 데이터를 구분한다.
const MAP_ID = 'map-1';

// 지금이 백엔드 없는 로컬 정적 프리뷰(npx serve dist/client)인지 판단하는 기준. 실제 devvit
// 웹뷰(배포/playtest)는 절대 localhost로 안 뜨므로, 에러 종류를 추측하는 것보다 훨씬 확실한
// 신호다(2026-07-12, attemptInstall의 에러 처리를 상황별로 나누기 위해 도입 — 임소리 확인).
const IS_LOCAL_PREVIEW = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// 골인 후 처음 화면(스플래시)으로 돌아갈 방법이 없다는 피드백(2026-07-13) 반영 —
// Phaser 씬은 DOM 버튼을 직접 못 그려서(캔버스), 순위 공개가 끝났을 때 이 이벤트를
// window에 쏘고 React(App 컴포넌트)가 받아서 "Back to Menu" 버튼을 캔버스 위에 띄운다.
const MAZE_FINISHED_EVENT = 'maze:finished';

const TILE_SIZE = 64; // 타일 한 칸의 픽셀 크기 (정사각형 한 변의 길이)

// 카메라가 캐릭터를 따라다니는 뷰포트 크기(칸 단위, 2026-07-13 도입) — 예전엔 맵 전체(가로
// MAP_WIDTH칸)가 논리 해상도였는데, 그러면 항상 맵 전체가 한 화면에 다 보여서 카메라가
// 움직일 필요가 없었다. 이 값이 작을수록 확대되어 보인다. 맵 가로세로 비율(25:21)과 비슷하게
// 맞춰서 화면 비율이 크게 안 어긋나게 함.
const CAMERA_VIEWPORT_TILES_X = 13;
const CAMERA_VIEWPORT_TILES_Y = 11;

// 통로 폭(px). 칸 전체(TILE_SIZE)를 통로로 채우면 사방이 넓게 뚫린 팩맨 게임판처럼
// 보인다는 피드백 반영 — 칸보다 훨씬 좁은 길만 밝혀서, 어둠(칸의 나머지 공간 = 벽)
// 속에 좁은 길이 나 있는 실제 미로에 가깝게 만듦.
const PATH_WIDTH = 26;

// 벽 영역을 단색 도형이 아니라 텍스처로 채운다 — "Phaser 단색 사각형" 느낌에서 벗어나기 위함.
// 통로와 맞닿은 벽 칸에만 이 타일을 개별 도형으로 배치한다(전체 배경 이미지 한 장으로 깔면
// 안개와 무관하게 맵 전체가 항상 보여버려서 "탐험해야 벽도 보인다"는 안개 시스템의 핵심을
// 깨버림 — 반드시 인접 바닥 칸의 안개 상태에 종속시켜야 함).
//
// 2026-07-11 타일 아트 개선(1차, 커밋 83f2e1b): 각진 석벽 블록(모르타르 줄눈 + 모서리 직선
// 하이라이트) 텍스처에 색조 변형만 추가했었음 → 피드백: "이런 타일 느낌 말고, 지금은 석벽이라
// 단조로운 걸 미로같은 벽으로 만들어보자". 사용자가 "거친 동굴/암반 벽" 방향(각진 사각 블록 +
// 모르타르 줄눈 대신, 불규칙한 다각형 암반 조각 + 자연스러운 균열선, 줄눈 없이 이어지는 암석
// 경계)을 선택 → buildRockWallTileSvg(mazePattern.ts)로 교체. 타일 배경을 테두리 없는 단색
// 사각형으로 빈틈없이 채워서 옆 타일과 이어붙여도 격자 줄눈이 안 보이게 하고, 그 위에 시드
// 고정 의사난수(mulberry32, Math.random 아님)로 불규칙한 암반 조각 면 + 균열선을 얹음 —
// 변형 개수를 6개로 늘려(기존 4개) 반복 패턴이 덜 도드라지게 함. 벽 칸 좌표 기준 결정론적
// 해시로 변형을 고르는 방식은 그대로 유지(같은 맵은 항상 같은 결과).
const WALL_TILE_VARIANTS = [
  { seed: 101, baseFill: '#2b1d13', facetFill: '#1c1209', highlightFill: '#5a4030' },
  { seed: 202, baseFill: '#241709', facetFill: '#170f06', highlightFill: '#4a3325' },
  { seed: 303, baseFill: '#2a2410', facetFill: '#1a1608', highlightFill: '#4f4a28' },
  { seed: 404, baseFill: '#33231a', facetFill: '#211611', highlightFill: '#6b4d3a' },
  { seed: 505, baseFill: '#291a12', facetFill: '#190f09', highlightFill: '#553c2c' },
  { seed: 606, baseFill: '#2e2012', facetFill: '#1d130a', highlightFill: '#5c4630' },
] as const;
const WALL_TILE_TEXTURE_KEYS = WALL_TILE_VARIANTS.map((_, i) => `maze-wall-tile-${i}`);
const WALL_TILE_TEXTURE_URIS = WALL_TILE_VARIANTS.map((variant) =>
  buildRockWallTileDataUri({
    cellSize: TILE_SIZE,
    seed: variant.seed,
    baseFill: variant.baseFill,
    facetFill: variant.facetFill,
    highlightFill: variant.highlightFill,
  })
);

// 바닥 타일 실험(2026-07-14): 벽돌 → 이끼/풀숲 → 석조 슬라브를 차례로 시도했으나 매번 벽과
// 톤/입체감이 경쟁하거나 구분이 안 된다는 피드백이 반복되어 결국 원래대로 되돌림 — 바닥 칸은
// 다시 별도 도형 없이 검은 배경 그대로 둔다(과거 "회색 사각형이 이동할 때마다 선 생긴다"는
// 문제도 있었던 영역이라 보수적으로 접근). 시도했던 생성 함수(buildBrickFloorTileSvg 등,
// 실제로는 buildStoneFloorTileSvg/buildMossFloorTileSvg로 남아있음)는 mazePattern.ts에
// 그대로 남겨뒀으니 나중에 다시 시도할 때 재사용 가능.

// 벽 칸 좌표(x,y)로부터 항상 같은 변형 인덱스를 골라주는 결정론적 해시 — 같은 맵이면 새로고침
// 해도 벽 무늬가 안 바뀜(랜덤이면 매번 텍스처가 바뀌어 "깜빡이는" 느낌이 나서 고정 필요).
function wallVariantIndex(x: number, y: number): number {
  return (x * 31 + y * 17) % WALL_TILE_VARIANTS.length;
}

// 발자국 마커: splash.tsx의 FootprintIcon과 같은 발바닥 모양 SVG(타원 조합)를 재사용.
// 내 발자국은 안 그린다(안개가 걷혀서 "지나간 길"이 보이는 것만으로 충분) — 다른 유저가
// 남긴 발자국(map.getState의 footprints)만 이 아이콘으로 표시한다.
const FOOTPRINT_TEXTURE_KEY = 'footprint-icon';
const FOOTPRINT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#c9915a">
  <ellipse cx="12" cy="8" rx="5" ry="4.2" />
  <ellipse cx="12" cy="17" rx="3.8" ry="4.8" />
  <ellipse cx="6.6" cy="4.6" rx="1.6" ry="2.1" />
  <ellipse cx="9.6" cy="2.7" rx="1.4" ry="1.9" />
  <ellipse cx="12.7" cy="2.3" rx="1.4" ry="1.9" />
  <ellipse cx="15.5" cy="2.9" rx="1.3" ry="1.7" />
  <ellipse cx="17.8" cy="4.7" rx="1.1" ry="1.4" />
</svg>`;
const FOOTPRINT_TEXTURE_URI = `data:image/svg+xml,${encodeURIComponent(FOOTPRINT_SVG)}`;

// 맵 위 함정/아이템 마커 이미지. 원래 박스+물음표가 한 장으로 합쳐진 PNG(public/sprites/ItemBox.png)를
// 물음표 부분(ItemBox-mark.png)과 박스 부분(ItemBox-box.png)으로 미리 잘라서 준비해뒀다 —
// 박스는 고정, 물음표만 위아래로 통통 뜨게 하려면 두 레이어로 분리돼 있어야 하기 때문.
// 4종 함정 전부 같은 "미스터리 박스" 모양으로 통일 — 밟기 전엔 안에 뭐가 들었는지 안 보이는
// 컨셉과 잘 맞고, 어떤 함정인지는 밟았을 때 flashPlayer 색으로 구분된다.
const ITEM_BOX_TEXTURE_KEY = 'item-box';
const ITEM_MARK_TEXTURE_KEY = 'item-mark';
const ITEM_MARKER_SIZE = 40; // 마커 표시 크기(px, 정사각형 — 원본 512x512 캔버스를 이 크기로 축소)
const ITEM_MARK_BOB_PX = 4; // 물음표가 위아래로 움직이는 거리(px)
const ITEM_MARK_BOB_MS = 600; // 물음표 한 방향 이동에 걸리는 시간(ms, yoyo라 왕복은 2배)

// 골인 지점 깃발 이미지. 깃대+깃발 천이 한 장(public/sprites/GolaFlag.png, 512x512)으로
// 합쳐져 있던 걸, 깃대는 파란색·천은 흑백 체크무늬라는 색 차이를 이용해 열(column) 82를
// 경계로 잘라 GoalFlag-pole.png(깃대)/GoalFlag-cloth.png(천) 두 장으로 분리했다.
// 천을 여러 조각(Image)으로 쪼개 각자 흔드는 방식은 몇 차례 시도했지만(회전 → 찢어짐,
// y이동 → 위아래로만 흔들림, scaleX 접기 → 이산적인 3칸이라 뻣뻣하고 기계적) 전부
// "자연스럽지 않다"는 피드백을 받았다 — 근본 원인은 조각 수가 적어(3개) 사실상 계단식
// 움직임이라는 점. 대신 Phaser 4의 Mesh2D(정점을 직접 다루는 2D 메쉬 GameObject, WebGL
// 전용)로 천 하나를 가로 GOAL_FLAG_WAVE_COLS칸짜리 격자로 쪼개고, 매 프레임 각 칸 사이의
// "간격"을 사인파로 늘렸다 줄였다 해서 체크무늬 자체가 연속적으로 접혔다 펴지는 것처럼
// 보이게 한다(이음매가 아예 없는 연속 표면이라 찢어질 수 없음). 양 끝(깃대 부착점,
// 천 끝자락)은 항상 원래 폭으로 재조정(rescale)해 고정하므로 깃발이 밀렸다 당겨지는
// 느낌(예전 버그)도 생기지 않는다 — updateGoalFlagWave 참고.
// ⚠️ Mesh2D는 WebGL 전용 GameObject다. phaserConfig가 Phaser.AUTO라 WebGL이 없는 환경에서는
// Canvas 렌더러로 자동 폴백되는데, 그 경우 이 천 메쉬는 그려지지 않는다(깃대는 일반 Image라
// 정상 표시됨). Devvit 웹뷰는 최신 Chromium 기반이라 실질적으로 문제되지 않을 것으로 보지만,
// 다른 환경(구형 기기 등)에서 깃발 천만 안 보인다는 리포트가 오면 여기부터 의심할 것.
const GOAL_POLE_TEXTURE_KEY = 'goal-flag-pole';
const GOAL_CLOTH_TEXTURE_KEY = 'goal-flag-cloth';
// 원본 캔버스(512x512)에서 각 조각이 차지하던 바운딩 박스 — 잘라낸 PNG의 크기/위치와 일치한다.
const GOAL_FLAG_CANVAS = 512;
const GOAL_POLE_BOUNDS = { minX: 27, maxX: 81, minY: 11, maxY: 511 };
const GOAL_CLOTH_BOUNDS = { minX: 82, maxX: 484, minY: 0, maxY: 506 };
const GOAL_FLAG_DISPLAY_SIZE = TILE_SIZE * 0.85; // 깃발 전체(원본 512 기준)를 이 크기로 축소해 표시
const GOAL_FLAG_SCALE = GOAL_FLAG_DISPLAY_SIZE / GOAL_FLAG_CANVAS;
// 천 메쉬를 가로로 나누는 칸 수(정점 열은 이보다 1개 많음) — 많을수록 파동이 부드럽다.
const GOAL_FLAG_WAVE_COLS = 12;
const GOAL_FLAG_WAVE_CYCLES = 2; // 천 전체 폭 안에 들어가는 파동 주기 수
const GOAL_FLAG_WAVE_SPEED = 4.5; // 파동이 진행하는 속도(rad/sec)
const GOAL_FLAG_WAVE_AMPLITUDE = 0.7; // 칸 사이 간격이 흔들리는 비율(0~1)

// 플레이어 캐릭터 이미지(레딧 스누, public/sprites/Character-normal.png). 정면 고정 포즈
// 한 장뿐이라 4방향 스프라이트/걷기 프레임이 없다 — 좌우 이동 시엔 좌우 반전(flipX)으로
// 방향을 표현하고, 위/아래로만 이동할 때는 마지막으로 봤던 좌우 방향을 그대로 유지한다
// (뒷모습 그림이 없어 위/아래 방향 자체를 표현할 수는 없음). 걷는 모션도 별도 프레임이 없어서,
// 한 칸 이동할 때마다 짧게 눌렸다 펴지는(squash & stretch) 트윈으로 "한 걸음 내딛는" 느낌을
// 흉내낸다 — animatePlayerStep 참고.
const PLAYER_TEXTURE_KEY = 'player-character';
const PLAYER_DISPLAY_SIZE = PATH_WIDTH * 1.7; // 캐릭터 이미지 표시 크기(정사각형)
const PLAYER_WALK_SQUASH = 0.82; // 한 걸음 내딛을 때 세로로 눌리는 비율(작을수록 더 통통 튐)
const PLAYER_WALK_STRETCH = 1.12; // 눌리는 동안 가로로 살짝 넓어지는 비율

// 가만히 서 있을 때 숨쉬듯 위아래로 살짝 움직이는 idle 애니메이션(2026-07-14 도입) — 완전히
// 정지된 그림처럼 안 보이게 하기 위함. 진폭을 작게 잡아서 실제 그리드 위치 감각을 해치지 않는다.
const IDLE_BOB_AMPLITUDE_PX = 3;
const IDLE_BOB_DURATION_MS = 900;

// 골인 순간 캐릭터가 반갑다는 듯 통통 두 번 튀어 오르는 축하 홉(2026-07-14 도입) — 걷기
// 스쿼시(PLAYER_WALK_*)와 같은 원리지만 더 크고 두 번 반복해서 "골인했다"는 임팩트를 낸다.
const GOAL_HOP_HEIGHT_PX = TILE_SIZE * 0.28;
const GOAL_HOP_DURATION_MS = 180;
const GOAL_HOP_SQUASH = 0.85;
const GOAL_HOP_STRETCH = 1.15;

// 함정에 걸렸을 때 flashPlayer(색 틴트)만으로는 "무엇에 걸렸는지" 한눈에 안 들어와서, 캐릭터
// 이미지 자체를 그 함정을 상징하는 그림(예: 슬라이드→바나나 옷, 시야차단→고글)으로 바꾼다 —
// flashPlayerTrap 참고. 지속시간이 있는 효과(시야차단/역방향)는 그 효과가 끝날 때까지
// 캐릭터 이미지도 같이 유지해야 자연스럽다(효과는 끝났는데 캐릭터만 먼저 원래대로 돌아오면
// 어색함) — 아래 BLIND_DURATION_MS/REVERSE_DURATION_MS를 실제 효과 타이머와 캐릭터 이미지
// 유지시간 양쪽에 공유해서 항상 같이 끝나도록 한다. 함정 탐지기 아이템용 그림
// (Character-detector.png)도 같이 준비해뒀지만, 그 아이템 자체가 아직 서버에 구현 안 돼
// 있어(docs/wbs.md 참고) 지금은 로드만 해두고 실제로 쓰지는 않는다.
const PLAYER_TRAP_TEXTURE_KEYS: Record<TrapType, string> = {
  slow: 'player-character-slide',
  respawn: 'player-character-respawn',
  blind: 'player-character-blind',
  reverse: 'player-character-reverse',
};
const PLAYER_DETECTOR_TEXTURE_KEY = 'player-character-detector'; // 위 주석 참고 — 아직 미사용

// 2026-07-13: 아이템 전체를 "즉시 발동" → "보유 후 Z로 사용"으로 전환하면서 도입한 인벤토리
// 슬롯 UI. 아이콘은 종류별로 송원호님이 준 png(public/sprites/ItemSlot-*.png, 함정 설치만
// 폭탄 아이콘이라 파일명이 다름)를 그대로 씀.
const ITEM_SLOT_TEXTURE_KEYS: Record<ItemType, string> = {
  flashlight: 'item-slot-flashlight',
  shield: 'item-slot-shield',
  detector: 'item-slot-detector',
  trapInstall: 'item-slot-bomb',
};

// 슬롯 라벨 — 말풍선 토스트(ITEM_LABELS)와 달리 슬롯 폭이 좁아 더 짧은 이름을 따로 둔다.
const ITEM_SLOT_LABELS: Record<ItemType, string> = {
  flashlight: 'Flash',
  shield: 'Shield',
  trapInstall: 'Trap Kit',
  detector: 'Detector',
};

// 슬롯 배경 색상(2026-07-13 재작업) — 처음엔 맵 벽과 같은 절차적 암반 텍스처를 그대로
// 재사용했는데, 오히려 벽이랑 구분이 안 돼서 "슬롯 박스처럼 안 보인다"는 피드백을 받음.
// 벽(따뜻한 갈색 톤, mazePattern.ts 기본값)과 다른 차가운 슬레이트/금속 톤을 써서 "맵 안에
// 파묻힌 UI"가 아니라 "화면에 붙어있는 금속 소켓"으로 확실히 구분되게 한다.
const ITEM_SLOT_FRAME_COLOR = 0x2a2e35; // 소켓 프레임 기본색(차가운 슬레이트)
const ITEM_SLOT_FRAME_LIGHT = 0x5c6270; // 베벨 밝은 변(위/왼쪽)
const ITEM_SLOT_FRAME_DARK = 0x141519; // 베벨 어두운 변(아래/오른쪽)
const ITEM_SLOT_SOCKET_COLOR = 0x0d0e11; // 안쪽으로 파인 소켓(항상 어둡게)

// 2026-07-13 재작업: 4칸을 항상 다 그려두고 빈 칸은 "닫힌 박스"로 표시하던 방식 대신, 실제로
// 들고 있는 아이템 개수만큼만 박스를 동적으로 만들고 없애는 방식으로 변경(피드백: "먹을 때마다
// 박스가 생기는 구조가 더 좋을 것 같다"). ITEM_SLOT_MAX는 화면에 보여줄 고정 칸 수가 아니라
// "이 이상은 못 든다"는 상한일 뿐 — 로드아웃 1개 + 맵당 고정 미스터리 박스 스폰 3곳이 한
// 판에서 아이템을 획득할 수 있는 이론적 최댓값과 정확히 일치해서 이 값으로 정함.
const ITEM_SLOT_MAX = 4;
const ITEM_SLOT_SIZE = 60; // 2026-07-13: 60 → 44로 축소했었으나, 카메라 확대(뷰포트 축소) 도입 이후
// 상대적으로 너무 작아 보인다는 피드백으로 다시 60으로 복귀
const ITEM_SLOT_GAP = 6;
const ITEM_SLOT_MARGIN = 12;
// 2026-07-14 도입: 슬롯이 새로 생길 때 스케일 0→1로 팝 인(Back.easeOut, 살짝 튕기며 안착),
// X로 선택 슬롯을 바꿀 때 새로 선택된 테두리가 순간 커졌다 돌아오는 펀치 효과 — 예전엔
// refreshItemSlotsUI가 뭘 하든 항상 즉시 나타나기만 해서 뻣뻣해 보였다는 피드백.
const ITEM_SLOT_POP_DURATION_MS = 220;
const ITEM_SLOT_PUNCH_DURATION_MS = 160;
// 리스폰은 순간이동이라 별도 "효과 지속시간"이 없지만, 표정이 바뀌는 게 눈에 잘 안 보일
// 정도로 짧다는 피드백을 받아 리스폰만 따로 더 길게 유지되는 시간을 둔다.
const RESPAWN_FLASH_MS = 1600;

// vision-system.md 스펙: 기본 시야 반경 2칸.
// 나중에 손전등(4칸)/시야차단 함정(0.5~1칸)을 만들 때 이 값을 상황에 맞게 바꿔주면 됨.
const VISION_RADIUS = 2;

// 한 칸 이동에 걸리는 기본 시간(ms).
const BASE_MOVE_DURATION = 150;

// 벽에 부딪혔을 때 넛지 트윈 하나가 걸리는 시간(ms, bumpIntoWall 참고).
const WALL_BUMP_DURATION = 70;

// 벽을 계속 누르고 있을 때 넛지를 다시 재생하는 최소 간격(ms) — 매 프레임 재생하면 흔들림처럼
// 보이므로 "퉁, 퉁" 끊어지는 느낌이 나도록 제한한다.
const WALL_BUMP_COOLDOWN_MS = 150;

// 슬라이드 함정에 걸려 미끄러질 때, 한 칸당 걸리는 시간(ms).
// 기본 이동보다 짧게 줘서 "제어권을 잃고 빠르게 밀려나는" 느낌을 냄.
const SLIDE_STEP_DURATION = 80;

// 슬라이드 중 카메라 흔들림 — 몇 칸을 미끄러질지 미리 알 수 없어 넉넉한 길이로 걸어두고
// slideStep이 멈추는 지점에서 shakeEffect.reset()으로 조기 종료한다(applySlideTrap 참고).
const SLIDE_SHAKE_DURATION = 2000;
const SLIDE_SHAKE_INTENSITY = 0.008;

// 발자국을 한 칸마다 즉시 서버로 보내지 않고 이 주기(ms)마다 모아서 한 번에 보낸다.
// trap.trigger/item.pickup과 겹쳐 매 칸마다 요청이 늘어나는 걸 줄이기 위함
// (PR #31 리뷰 반영 — 렉 문제가 있는 상황에서 요청 수를 더 늘리면 안 된다는 피드백).
const FOOTPRINT_FLUSH_INTERVAL_MS = 2000;

// 다른 유저 발자국을 지나온 칸 전부가 아니라 이 비율만큼만 화면에 표시한다(렌더링 시점
// 필터링 — 서버엔 그대로 다 기록됨). 전부 다 보이면 누적된 경로가 사실상 정답 그리기가
// 돼버려서 도입(2026-07-13). 좌표 기반 결정론적 해시가 아니라 매 세션 Math.random()으로
// 뽑는다 — 볼 때마다 살짝 다르게 보이는 쪽이 안개/미스터리 박스가 주는 "불확실성" 컨셉과
// 더 잘 맞는다고 판단(임소리 결정).
const FOOTPRINT_DISPLAY_RATIO = 0.3;

// 캐릭터 시작 위치 (map-1의 실제 시작 칸 S). 리스폰 함정이 여길 기준으로 되돌림.
const SPAWN_POSITION = MAIN_MAP.start;

// 골인 지점 (map-1의 실제 출구 칸 E).
const GOAL_POSITION = MAIN_MAP.exit;

// 타일 하나가 지금 어떤 상태인지 3가지로 구분합니다.
// hidden   → 한 번도 안 가본 곳 (완전히 안 보임)
// explored → 예전에 가봤지만 지금은 시야 밖 (안개는 안 덮이지만 어둡게 표시 — "지나간 길" 기억)
// visible  → 지금 캐릭터 시야 범위 안 (원래 밝기로 표시)
type TileState = 'hidden' | 'explored' | 'visible';

// traps.md 기준 함정 4종. 서버 스키마(src/shared/game-types.ts)는 여전히 'slow'라는
// 이름을 쓰지만(이미 PR #3에서 API에 배포된 값이라 그대로 둠), 실제 효과는 팀 협의로
// "느려짐"이 아니라 "벽에 부딪힐 때까지 미끄러짐"으로 바뀌었다 — 아래 applySlideTrap 참고.
const TRAP_COLORS: Record<TrapType, number> = {
  slow: 0x3399ff, // 파랑 (미끄러짐 이펙트)
  respawn: 0xaa00ff, // 보라
  blind: 0x888888, // 회색
  reverse: 0xff8800, // 주황
};

const TRAP_TYPES: readonly TrapType[] = ['slow', 'respawn', 'blind', 'reverse'];

const TRAP_LABELS: Record<TrapType, string> = {
  slow: 'Slide',
  respawn: 'Respawn',
  blind: 'Blind',
  reverse: 'Reverse',
};

// 시야차단/역방향 효과의 실제 지속시간. applyBlindTrap/applyReverseTrap의 효과 타이머와
// flashPlayerTrap의 캐릭터 이미지 유지시간이 항상 같이 끝나도록 상수 하나를 공유한다.
const BLIND_DURATION_MS = 5000;
const REVERSE_DURATION_MS = 4000;

// 골인 연출: "GOAL!"이 먼저 뜨고, 약간의 텀을 두고 순위 정보가 아래에서 페이드인되며
// 등장한다(한 번에 다 뜨면 "결과 발표" 느낌이 덜해서 2단계로 분리, 2026-07-13).
const RANK_REVEAL_DELAY_MS = 450;
const RANK_REVEAL_RISE_PX = 14;
const RANK_REVEAL_DURATION_MS = 350;

// trap.install 실패 사유 → 안내 문구. TrapInstallOutput.reason은 optional이라(성공 시엔
// 항상 undefined) 값이 없을 때는 RETRY 문구로 대체.
type InstallFailureReason = NonNullable<TrapInstallOutput['reason']>;
const INSTALL_FAILURE_MESSAGES: Record<InstallFailureReason, string> = {
  TOTAL_CAP_REACHED: "You've used all your trap placements",
  TYPE_CAP_REACHED: "You can't place this trap type anymore",
  TILE_OCCUPIED: 'There is already a trap here',
  RETRY: 'Placement failed, please try again',
};

// 아이템 좌표(+로컬 폴백 전용 종류). 2026-07-12: 서버가 미스터리 박스 방식(개별 스폰에
// 타입을 저장하지 않고 픽업 시점에 rollMysteryOutcome()으로 결정)으로 재설계되면서
// map.getState가 주는 실제 스폰 좌표(state.mysteryBoxes)엔 더 이상 타입이 없다 — type은
// 백엔드 없는 로컬 프리뷰 폴백(TEMP_ITEMS/reportItemPickup의 catch)에서만 쓰인다.
// ItemType(4종) 각각의 상세 스펙·확정 배경은 docs/design-docs/items.md 참고.
type ItemInstance = { x: number; y: number; type?: ItemType };

// fetchItemEncounter()의 반환 타입 — 미스터리 박스가 없었는지, 아이템으로 나왔는지, 함정으로
// 나왔는지를 구분한다. resolveArrival이 이 결과와 fetchTrapTrigger의 설치형 함정 판정을 함께
// 모아 이펙트 적용/isMoving 해제를 결정한다.
type ItemEncounter = { kind: 'none' } | { kind: 'item'; type: ItemType } | { kind: 'trap'; type: TrapType };

// 인벤토리 슬롯 하나에 들어가는 데이터(2026-07-13 도입). 쉴드는 즉시무장 예외라 여기 안
// 들어간다 — type은 flashlight/detector/trapInstall 중 하나. 탐지기(detector)는 반경을
// 미리 저장해두지 않는다 — Z로 쓰는 바로 그 순간 item.useDetector를 호출해 그 자리 기준으로
// 매번 새로 스캔한다(주운 자리 기준 낡은 정보를 보여주거나, 그 사이 함정이 사라져도 반영이
// 안 되는 문제를 피하기 위함 — 2026-07-13 임소리 설계). trapType(함정 설치 전용): items.md
// 스펙("줍는 순간 함정 종류 랜덤 결정")을 지키기 위해 Z를 누른 시점이 아니라 습득 시점에
// 미리 뽑아서 저장해둔다.
type HeldItem = { type: ItemType; trapType?: TrapType };

const ITEM_COLORS: Record<ItemType, number> = {
  flashlight: 0xfff59d, // 옅은 노랑
  shield: 0x33ffee, // 청록
  trapInstall: 0xff3355, // 빨강
  detector: 0x34d399, // 에메랄드 — splash.tsx 로드아웃 화면의 Trap Detector 아이콘 색과 통일
};

// 픽업 라벨(말풍선 텍스트)에 쓸 이름 — splash.tsx 로드아웃 화면과 언어를 맞추기 위해 영문으로 통일.
const ITEM_LABELS: Record<ItemType, string> = {
  flashlight: 'Flashlight',
  shield: 'Shield',
  trapInstall: 'Trap Kit',
  detector: 'Trap Detector',
};

// items.md 초안: 반경 3칸 내 함정을 표시(수치는 ⚠️ 가정치, 플레이테스트로 확정 예정).
// 반경(DETECTOR_REVEAL_RADIUS=3)은 서버가 이미 적용해서 revealedTraps로 필터링해 보내주므로
// 클라이언트는 "얼마나 오래 화면에 보여줄지"만 관리하면 된다. 5초는 너무 길다는 피드백으로
// 2026-07-11 임소리 확인 후 3초로 축소.
const DETECTOR_REVEAL_DISPLAY_MS = 3000;

// 스캔 펄스 이펙트(applyDetectorItem)가 퍼지는 반지름(칸 단위). 서버의 정확한
// DETECTOR_REVEAL_RADIUS 값은 클라이언트로 안 넘어오므로(필터링된 결과만 옴), 순수 연출용으로
// 여기 값을 서버 상수와 수동으로 맞춰둔다 — 서버 값이 바뀌면 같이 확인할 것.
const DETECTOR_SCAN_RADIUS_TILES = 3;

// items.md: 손전등은 시야 반경 2→4칸, 8초. 원래는 "주웠다가 원할 때 쓰는" 아이템이지만
// 인벤토리/사용 버튼 UI가 아직 없어서, 이번엔 임시로 줍는 즉시 자동 발동시킨다
// (2026-07-09 임소리 확인 — UI 나오면 "보유 후 수동 발동"으로 바꿀 것).
const FLASHLIGHT_VISION_RADIUS = 4;
const FLASHLIGHT_DURATION_MS = 8000;

// ── 효과음(public/sounds/*, 원호가 직접 소싱) ──────────────────
// 배경음(BGM)과 로드아웃 화면의 아이템 선택/확정음은 이번 스코프에서 제외 — 그 두 가지만 빼고
// 게임 화면(Phaser)에서 나는 모든 효과음을 여기서 로드/재생한다. 로드아웃 화면 자체(splash.tsx)의
// 공용 버튼 클릭음은 Phaser가 아니라 별도로 처리(splash.tsx의 playUiClickSound 참고).
//
// footstep: 원본 오디오 파일이 걷기 한 사이클(발걸음 소리가 여러 번 반복 녹음된 것) 전체를
// 담고 있어서 재생할 때마다 여러 번 소리가 나는 문제가 있었음(무음 구간 분석으로 확인,
// analyze-footstep.mjs/analyze-newfootstep.mjs 스크립트로 RMS 엔벌로프 찍어서 확인) →
// extract-single-footstep.mjs로 그중 한 걸음만 잘라내 wav로 저장(원본은 삭제), 그 한 소리만
// 매 칸 이동마다 재생.
const SFX_PATHS = {
  footstep: '/sounds/footstep.wav',
  itemPickup: '/sounds/item-pickup.mp3',
  shieldBlock: '/sounds/shield-block.mp3',
  detectorScan: '/sounds/trap-detector-scan.mp3',
  trapInstallSuccess: '/sounds/trap-install-success.mp3',
  trapInstallFail: '/sounds/trap-install-fail.mp3',
  trapSlide: '/sounds/trap-slide.mp3',
  trapRespawn: '/sounds/trap-respawn.mp3',
  trapBlind: '/sounds/trap-blind.mp3',
  trapReverse: '/sounds/trap-reverse.mp3',
  goal: '/sounds/goal.mp3',
} as const;
type SfxKey = keyof typeof SFX_PATHS;

// 2026-07-11 피드백: 전반적으로 소리가 커서 기존 0.6 대비 20% 낮춤. 단, 리스폰 함정은
// 페널티가 가장 큰 함정(위치+탐험 기록 전부 초기화)이라 존재감이 있어야 한다는 반대 피드백을
// 받아 기존 0.6 대비 15% 키움 — 그래서 리스폰만 별도 볼륨을 준다.
const DEFAULT_SFX_VOLUME = 0.48;
const SFX_VOLUME_OVERRIDES: Partial<Record<SfxKey, number>> = {
  trapRespawn: 0.69,
};

// ── 아이템 스폰 좌표 ──────────────────────────
// 2026-07-09: 정상적으로는 loadServerState()가 map.getState 응답(2026-07-12부터
// state.mysteryBoxes)으로 remainingItems를 채운다. 이 상수는 서버 호출이 실패했을 때
// (백엔드 없는 로컬 프리뷰 등)의 폴백 전용 — src/server/core/items.ts의 실제 스폰 좌표
// (map-1)와 맞춰뒀다. 실제 스폰은 타입이 없는 미스터리 박스지만, 이 로컬 폴백은 백엔드 없이
// 픽업 배선이 동작하는지만 확인하면 되므로 타입을 고정해둔 채로 유지한다(reportItemPickup 참고).
// ⚠️ 이 좌표들은 MAIN_MAP(map-1)의 바닥 칸이어야 함 — 코드로 검증하지 않으므로, 맵 레이아웃이
// 또 바뀌면 여기도 같이 확인할 것(벽 칸을 가리키면 마커가 벽 속에 파묻혀 주울 수 없게 됨).
// 2026-07-10: map-1 레이아웃 4차 재설계(기능별 배치)에 맞춰 좌표 갱신.
const TEMP_ITEMS: ItemInstance[] = [
  { x: 5, y: 12, type: 'flashlight' },
  { x: 9, y: 1, type: 'shield' },
  { x: 23, y: 1, type: 'trapInstall' },
  { x: 15, y: 12, type: 'detector' }, // src/server/core/items.ts 실제 스폰 좌표와 동일
];

// Phaser의 "씬(Scene)" = 게임 화면 한 장을 담당하는 클래스.
// 우리 게임은 미로 플레이 화면 하나만 있으면 되니 씬도 하나만 만듭니다.
class MazeScene extends Phaser.Scene {
  // 플레이어의 위치를 "그리드 칸 번호"로 저장 (픽셀 좌표 아님! 예: (0,0) = 맨 왼쪽 위 칸)
  private playerGridX = 0;
  private playerGridY = 0;

  // 이동 애니메이션(트윈)이 재생 중인지 여부.
  // true인 동안은 새 방향키 입력을 무시해서, 한 칸씩 딱딱 끊어서 이동하게 만듦.
  private isMoving = false;

  // 스포트라이트 스폰 인트로가 암전 상태를 유지해야 하는 동안 updateFog() 호출을 전부
  // 무시하게 하는 플래그(2026-07-14, updateFog 선언부 주석 참고). create()에서 true로
  // 시작하고, 인트로의 마지막 flicker에서 false로 되돌린 뒤 실제 updateFog()를 호출한다.
  private suppressFogUpdates = false;

  // Phaser가 제공하는 "방향키 입력 감지" 객체 (매 프레임 자동으로 눌림 상태를 갱신해줌)
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // 캐릭터 이미지(Character-normal.png). setFlipX로 좌우 방향을 표현한다.
  private playerImg!: Phaser.GameObjects.Image;

  // flashPlayer가 예약해둔 "틴트 해제" 타이머. 새 flashPlayer 호출이 올 때 이전 타이머를
  // 취소해야, 200ms 안에 색이 다른 효과를 연달아 밟았을 때 먼저 걸린 타이머가 나중 색을
  // 조기에 지워버리는 문제가 안 생긴다.
  private clearTintTimer?: Phaser.Time.TimerEvent;

  // 캐릭터 이미지의 "쉬는 상태" 기준 스케일. 걷기 트윈(squash & stretch)이 매번 이 값을
  // 기준으로 눌렸다 펴져야 여러 번 빠르게 이동해도 크기가 조금씩 어긋나며 누적되지 않는다.
  private playerBaseScaleX = 1;
  private playerBaseScaleY = 1;

  // 걷기 스쿼시(squash & stretch) 트윈의 참조. 시야차단/역방향처럼 몇 초씩 지속되는 함정
  // 효과가 끝나 텍스처가 원복되는 시점은 이동과 전혀 무관한 고정 시각이라, 플레이어가 그
  // 사이 계속 걷고 있었다면 원복 순간에 이 트윈이 아직 scaleX/scaleY를 움직이고 있을 확률이
  // 꽤 높다 — 이 상태에서 텍스처를 바꾸면(setPlayerTexture) 트윈이 이후 프레임에도 계속
  // 자기 값으로 덮어써서 캐릭터 크기가 꼬인 채로 남는다. setPlayerTexture에서 텍스처를
  // 바꾸기 직전에 이 트윈을 멈춰서 막는다.
  private walkBobTween?: Phaser.Tweens.Tween;

  // 벽에 부딪혔을 때 짧게 튕기는 넛지 트윈(bumpIntoWall 참고). 방향키를 벽 쪽으로 계속 누르고
  // 있으면 update()가 매 프레임 tryMove를 호출하는데, 그때마다 새 트윈을 만들지 않고 이미
  // 있으면 멈춘 뒤 원위치로 되돌리고 새로 시작한다(위치가 밀려 쌓이는 것 방지).
  private wallBumpTween?: Phaser.Tweens.Tween;

  // wallBumpTween을 마지막으로 발동한 시각(this.time.now 기준 ms). 벽을 계속 누르고 있을 때
  // 매 프레임(약 16ms마다) 재생하면 너무 잦아 흔들림처럼 보이므로, 최소 간격을 두고 "퉁, 퉁"
  // 끊어지는 느낌으로 제한한다.
  private lastWallBumpAt = 0;

  // 지속시간이 있는 함정 효과(시야차단/역방향/리스폰)별로 "언제 끝나는지"(this.time.now 기준
  // ms)를 기억해두는 표. 예전엔 단순 카운터(토큰) 하나로 "마지막에 뭘 걸었는지"만 추적했는데,
  // 그러면 서로 다른 함정을 연달아 밟았을 때 나중에 건 효과가 먼저 끝나버려도 그 타이머가
  // "최신"이라고 오판해 캐릭터를 원복시켜버리는 문제가 있었다(실제로는 먼저 건 효과가 아직
  // 안 끝났는데). 이제는 "지금 활성 중인 효과들 중 가장 늦게 끝나는 것"을 항상 화면에
  // 반영한다 — refreshPlayerTrapVisual 참고. 슬라이드는 지속시간이 고정이 아니라(벽 만날
  // 때까지) 이 표에 넣지 않고 isSliding으로 따로 관리(슬라이드 중엔 항상 최우선으로 표시).
  private activeTrapEffects = new Map<TimedTrapType, number>();
  private isSliding = false;

  // 마지막으로 이동한 좌우 방향(true면 왼쪽을 보고 있음). 위/아래로만 이동해도 이 값은
  // 유지되므로, 캐릭터는 계속 마지막으로 봤던 좌우 방향을 보게 된다.
  private playerFacingLeft = false;

  // 각 타일의 현재 상태(hidden/explored/visible)를 기억해두는 표
  private tileStates: TileState[][] = [];

  // 통로와 맞닿은 벽 칸에 배치한 석벽 텍스처 도형들. 벽 칸 자체는 fog 상태가 없으므로
  // (통로만 hidden/explored/visible을 가짐), 인접한 바닥 칸들의 밝기 중 가장 밝은 값을
  // 따르도록 updateFog에서 매번 다시 계산한다 — 안개가 걷혀야 벽도 보이게 하기 위함.
  private wallTiles: { x: number; y: number; image: Phaser.GameObjects.Image }[] = [];

  // 다른 유저가 남긴 발자국 마커 도형(map.getState의 footprints). 안개 상태에 맞춰 같이
  // 밝기 조정됨(다시 안개가 덮이면 같이 흐려짐) — 내 발자국은 그리지 않는다.
  private footprintRects: (Phaser.GameObjects.Image | undefined)[][] = [];

  // 아직 서버로 보내지 않고 모아둔 내 발자국 좌표. FOOTPRINT_FLUSH_INTERVAL_MS마다
  // flushFootprints()가 한 번에 비워서 보낸다.
  private pendingFootprints: Position[] = [];

  // 함정 마커 도형(박스+물음표 이미지를 담은 컨테이너). 안개 상태에 맞춰 같이 밝기 조정됨
  // (함정 탐지기 아이템 없이는 안개에 덮인 함정이 안 보이게 하기 위함).
  private trapRects: (Phaser.GameObjects.Container | undefined)[][] = [];

  // 서버에서 받아온 "내가 설치한 함정" 목록. 다른 유저가 설치한 함정 좌표는 서버가
  // trap.trigger(인접 타일만 조회 가능)를 통해서만 알려주므로 클라이언트에 절대 미리 내려주지
  // 않는다 — 여기서 다른 유저 함정까지 렌더링하면 함정 위치를 미리 알아내는 치트가 된다.
  private myTraps: TrapInstance[] = [];

  // "x,y" 형태로 기록해두는, 내가 직접 설치한 함정의 좌표 집합. 실서버에서는 trap.trigger가
  // installerId로 자기 함정을 걸러주지만(trpc.ts), 백엔드 없는 로컬 프리뷰의 reportPosition
  // 폴백은 myTraps 배열만 보고 "칸이 일치하면 무조건 hit"으로 판정해서 자기 함정에 자기가
  // 걸리는 버그가 있었다(2026-07-11 임소리 발견) — 실제 게임 규칙(설치자 본인은 회피)을
  // 로컬 폴백에서도 재현하려고 별도로 추적한다.
  private selfInstalledTrapKeys = new Set<string>();

  // trap.trigger 호출이 dispatch된 순서대로만 네트워크로 나가도록 강제하는 큐.
  // (연속 이동 중 여러 trap.trigger가 동시에 in-flight 상태가 되면 응답 순서가
  //  역전돼 서버 위치 앵커가 뒤처진 채로 다음 이동을 검증해 정상 이동이
  //  INVALID_MOVE로 오판정될 수 있다 — 이를 막기 위한 요청 직렬화.)
  private trapDispatcher = new SequentialDispatcher<TrapTriggerOutput>();

  // item.pickup 전용 직렬화 큐 — trapDispatcher와 동일한 이유로 필요하다(reportItemPickup
  // 참고). 2026-07-14 발견: item.pickup을 직렬화 안 해도 된다고 판단했던 근거(2026-07-09,
  // reportItemPickup 주석)는 그 시점엔 resolveArrival이 끝날 때까지 isMoving이 잠겨있어 한
  // 번에 한 칸의 item.pickup만 in-flight일 수 있었기 때문에 성립했다 — 2026-07-13 PR #41
  // (조작감 개선, isMoving을 트윈 완료 즉시 해제)로 그 전제가 깨지면서, 서로 다른 칸의
  // item.pickup 두 개가 동시에 in-flight일 수 있게 됐다. Reddit 실환경처럼 응답 순서가
  // 역전되면(나중 칸 응답이 이전 칸 응답보다 먼저 도착) 위치 앵커가 아직 안 옮겨진 상태라
  // 정상적으로 있는 아이템도 INVALID_MOVE로 조용히 씹혀서 "아이템이 안 먹힌다"는 증상으로
  // 나타난다(실서버 QA 2026-07-14). trap.trigger는 같은 칸이면 병렬로, 다른 칸끼리는
  // 순서대로 나가도록 별도 큐로 분리해 병렬 조회 이점은 그대로 유지한다.
  private itemDispatcher = new SequentialDispatcher<ItemPickupOutput>();

  // 지금 재생 중인 발걸음 소리 인스턴스 — 다음 발걸음이 날 때 아직 안 끝났으면 끊어서 겹쳐
  // 들리지 않게 한다(playFootstepNow 참고).
  private footstepSound: Phaser.Sound.BaseSound | null = null;

  // 발걸음을 "이벤트 효과음이 끝난 뒤로" 미뤄뒀을 때, 그 사이 또 다른 발걸음 요청이 들어오면
  // 먼저 예약해둔 재생을 무효화하기 위한 토큰(playFootstep 참고) — 항상 가장 최근 요청 하나만
  // 실제로 재생됨.
  private footstepDelayToken = 0;

  // 지금 재생 중인 "이벤트" 효과음(발걸음 제외 — 함정 발동, 아이템 획득 등) 인스턴스. 함정을
  // 연달아 밟는 등 이벤트 효과음끼리 겹치면 두 소리가 뒤섞여 들리는 문제가 있어서, 새 이벤트
  // 효과음이 날 때 이전 것을 끊어 항상 "가장 최근에 발동한 효과음"만 들리게 한다(playSfx 참고).
  // 반대로 발걸음은 이벤트 효과음을 끊지 않고, 오히려 이벤트 효과음이 아직 재생 중이면 그게
  // 끝날 때까지 기다렸다가 재생한다(playFootstep 참고) — 아이템을 먹자마자 걸어도 두 소리가
  // 겹치지 않고 순서대로 들리게 하기 위함.
  private lastEventSound: Phaser.Sound.BaseSound | null = null;

  // lastEventSound가 재생을 시작한 시각(this.time.now 기준) — 남은 재생 시간을 "duration -
  // 경과 시간"으로 직접 계산하기 위함. `BaseSound.seek`로 경과 시간을 바로 읽을 수도 있지만,
  // `seek`는 `WebAudioSound`/`HTML5AudioSound` 같은 구체 클래스에만 있고 `BaseSound` 타입
  // 자체에는 없어서(`tsc --build` 기준 타입 에러 — `tsc --noEmit -p .`로는 못 잡았던 맹점,
  // 2026-07-13 CI 배포가 이 에러로 계속 실패하던 걸 뒤늦게 발견) 직접 추적하는 방식으로 변경.
  private lastEventSoundStartedAt = 0;

  // 아이템 마커 도형(별 모양 — 함정 마커는 박스 모양이라 헷갈리지 않게 구분). 함정 마커와
  // 동일하게 안개 상태에 맞춰 밝기 조정됨.
  private itemRects: (Phaser.GameObjects.Container | undefined)[][] = [];

  // 함정 탐지기(detector)로 반경 내 "다른 유저" 함정을 잠깐 공개할 때 쓰는 임시 마커.
  // this.myTraps(내가 설치한 함정, 항상 표시)와 달리 일정 시간 후 사라져야 하고, 안개(fog)와
  // 무관하게 항상 보여야 의미가 있다(탐지기의 목적 자체가 "아직 안 밝힌 곳의 위험을 미리
  // 알려주는 것") — applyDetectorItem/clearRevealedTrapMarkers 참고.
  private revealedTrapMarkers: Phaser.GameObjects.Arc[] = [];

  // applyDetectorItem이 예약한 "표시 종료" 타이머가 유효한지 판단하는 토큰. 탐지기는 맵당
  // 스폰이 1곳뿐이라 실제로 겹칠 일은 드물지만, flashPlayerTrap 등에서 이미 겪은 "먼저 걸린
  // 타이머가 나중 걸로 덮어써진 걸 모르고 지워버리는" 재트리거 경쟁을 막기 위해 동일한
  // 토큰 비교 패턴을 적용해둔다.
  private detectorRevealToken = 0;

  // 아직 안 주운 아이템 목록. loadServerState()가 map.getState 응답으로 채운다(서버 실패 시
  // TEMP_ITEMS로 폴백). 주우면 여기서 제거됨.
  private remainingItems: ItemInstance[] = [];

  // 보유 중인 쉴드 개수. 함정 하나를 막을 때마다 1씩 소모(1회성 소모 자체는 그대로, 다만
  // 여러 개를 동시에 들고 있을 수 있음). 2026-07-14 수정: 원래 boolean(hasShield)이었는데,
  // 로드아웃으로 쉴드를 고르고 게임 중 미스터리 박스로 쉴드를 또 주우면 "총 2개를 들고
  // 있어야" 하는데 두 번째 획득이 그냥 무시되고(이미 true라 값이 안 바뀜), 함정 하나만 막아도
  // 둘 다 없어져버리는 버그가 있었음(임소리 발견) — 개수를 세는 카운터로 교체.
  private shieldCount = 0;

  // trap.install 요청이 응답 오기 전에 Z를 연타해서 중복 요청이 동시에 나가는 것을 막는
  // 잠금 플래그. isMoving과 같은 목적이지만 "이동 애니메이션"이 아니라 "네트워크 요청 1건"을
  // 잠근다는 점이 다름.
  private isInstalling = false;

  // item.useDetector 요청이 응답 오기 전에 Z를 연타해 중복 요청이 나가는 것을 막는 잠금
  // 플래그(isInstalling과 동일한 목적).
  private isUsingDetector = false;

  // 지금 적용 중인 시야 반경. 평소엔 VISION_RADIUS와 같고, 시야차단 함정에 걸리면 잠깐 줄어듦.
  private currentVisionRadius = VISION_RADIUS;

  // 손전등 효과가 언제 끝나는지(this.time.now 기준 ms). applyBlindTrap/applyReverseTrap과
  // 똑같은 이유로 필요하다 — 지속시간이 끝나기 전에 손전등을 한 번 더 주우면, 먼저 걸린
  // 타이머가 나중에 뒤늦게 실행되면서 시야 반경을 조기에 원래대로 되돌려버리는 문제가
  // 있었다. 손전등은 함정이 아니라 activeTrapEffects에는 안 들어가므로 별도 필드로 관리.
  private flashlightExpireAt = 0;

  // 손전등이 켜져있는 동안 캐릭터를 감싸는 은은한 글로우. 픽업 순간의 버스트(1회성)와 별개로,
  // "지금 효과가 지속 중"임을 계속 보여주기 위한 것 — update()에서 매 프레임 캐릭터 위치로
  // 따라가도록 동기화한다. 지속시간이 끝나면(applyFlashlightItem 참고) 파괴하고 null로 되돌림.
  private flashlightGlow: Phaser.GameObjects.Arc | null = null;

  // 쉴드를 보유(shieldCount > 0)하고 있는 동안 캐릭터를 감싸는 얇은 링. 개수가 0이 되는
  // 순간(resolveArrival에서 showShieldBlockEffect 재생 시) 같이 파괴한다.
  private shieldRing: Phaser.GameObjects.Arc | null = null;

  // 2026-07-13: 쉴드는 밟는 즉시 발동이라 슬롯 UI에도 안 뜨는데, 그러면 "지금 쉴드 보유
  // 중"이라는 걸 알기 어렵다는 피드백 — 얇은 링(shieldRing)보다 눈에 띄게, 머리 위에 쉴드
  // 아이콘(슬롯 UI와 같은 png)을 띄워서 명확히 보여준다. 함정을 막아 개수가 0이 되는 순간
  // 원래 모습으로 되돌린다(위 shieldRing과 생명주기 동일).
  private shieldIcon: Phaser.GameObjects.Image | null = null;

  // 쉴드를 2개 이상 들고 있을 때만 아이콘 모서리에 남은 개수를 보여주는 원형 배지
  // (2026-07-14 도입, 쉴드 스택 버그 수정과 함께) — 1개일 땐 굳이 숫자를 안 띄워도 아이콘
  // 자체가 "보유 중"을 이미 알려주므로 생략, 개수가 여럿일 때만 의미가 있어서 조건부로 만든다.
  // 처음엔 파란 사각 태그(배경색+텍스트)였는데 shieldRing/shieldIcon의 시안색 톤과 안
  // 어울린다는 피드백으로, 알림 배지 느낌의 원형(shieldCountBadgeBg + 숫자만)으로 교체
  // (2026-07-14 재수정).
  private shieldCountBadgeBg: Phaser.GameObjects.Arc | null = null;
  private shieldCountLabel: Phaser.GameObjects.Text | null = null;

  // 2026-07-13 재작업: 4칸 고정 배열(null로 빈칸 표현) 대신, 실제로 들고 있는 아이템만큼만
  // 자라고 줄어드는 배열로 변경 — "먹을 때마다 박스가 생기는 구조가 더 좋을 것 같다"는
  // 피드백으로 빈 슬롯 개념 자체를 없앰(ITEM_SLOT_MAX에 도달하면 addHeldItem이 획득을 거부).
  private heldItems: HeldItem[] = [];
  // X로 순환하는 "지금 선택된 아이템" 인덱스. heldItems가 비어있으면 의미 없음
  // (useSelectedItem/cycleSelectedSlot이 각자 방어).
  private selectedSlotIndex = 0;
  // 아래 4개는 heldItems와 길이가 항상 같다 — refreshItemSlotsUI가 호출될 때마다 전부 지우고
  // heldItems 개수만큼 다시 만든다(최대 4개뿐이라 매번 다시 그려도 비용 미미).
  private itemSlotBgs: Phaser.GameObjects.Graphics[] = [];
  private itemSlotBorders: Phaser.GameObjects.Rectangle[] = [];
  // 아이콘 뒤에 까는 종류별 색 글로우(가산 블렌드) — 밋밋한 png 아이콘에 광택을 더해달라는
  // 피드백(2026-07-13). ITEM_COLORS(기존 픽업 이펙트에도 쓰는 종류별 색)를 그대로 재사용.
  private itemSlotGlows: Phaser.GameObjects.Arc[] = [];
  private itemSlotIcons: Phaser.GameObjects.Image[] = [];
  // 슬롯 이름표(영문) — 아이콘만으론 뭔지 안 보일 수 있다는 피드백(2026-07-13)으로 추가.
  private itemSlotLabels: Phaser.GameObjects.Text[] = [];
  // 선택된 슬롯 바로 아래에 뜨는 작은 삼각형 인디케이터 — 선택 표시가 테두리 색/두께
  // 차이뿐이라 눈에 덜 띈다는 피드백(2026-07-14)으로 추가. 선택된 슬롯 하나에만 존재하므로
  // 다른 배열과 달리 길이가 0 또는 1.
  private itemSlotSelectionIndicator: Phaser.GameObjects.Triangle | null = null;

  // 역방향 함정에 걸린 상태인지 여부. true면 방향키 입력을 반대로 뒤집어서 처리함.
  private isReversed = false;

  // 역방향 효과가 지속되는 동안 머리 위에서 계속 뱅글뱅글 도는 경고 아이콘. 처음 걸릴 때
  // 반짝이는 틴트만으로는 "지금 조작이 반대"라는 걸 계속 잊기 쉬워서(2026-07-11 임소리 피드백),
  // 지속시간 내내 눈에 띄게 유지한다. applyReverseTrap의 onExpire에서 파괴.
  private reverseIcon: Phaser.GameObjects.Text | null = null;

  // 골인 지점 깃발 마커(깃대+천 메쉬 컨테이너). 안개 상태에 맞춰 밝기가 같이 조정됨
  // (다른 타일들과 동일하게 탐색해야 보임).
  private goalRect!: Phaser.GameObjects.Container;

  // 깃발 천 메쉬(연속 표면, 정점을 매 프레임 직접 움직여서 펄럭임을 구현). goalClothWidth는
  // 천의 원래(안 접힌) 전체 폭 — 파동 계산 후 양 끝을 이 값으로 재조정(rescale)하는 데 쓰인다.
  private goalClothMesh!: Phaser.GameObjects.Mesh2D;
  private goalClothWidth = 0;
  private goalClothElapsed = 0; // 파동 애니메이션용 경과 시간(초)

  // 골인했는지 여부. true가 되면 더 이상 방향키 입력을 받지 않음(테스트용 종료 처리).
  private hasFinished = false;

  // 이번 판이 시작된 실제 시각(Date.now() 기준 ms) — create()에서 기록, 골인 시
  // clearTimeMs(= 지금 - 이 값)를 계산해 run.finish에 실어 보낸다.
  private runStartTime = 0;

  // 랭킹 1차 기준 — 성공적으로 이동한 칸 수(벽 부딪힘 제외, 슬라이드로 밀린 칸은 포함).
  // tryMove/slideStep이 실제로 playerGridX/Y를 옮길 때만 증가시킨다. 리스폰 함정의 순간이동은
  // "이동"이 아니라 위치 초기화라 여기 포함하지 않는다.
  private stepCount = 0;

  constructor() {
    // 'MazeScene'은 이 씬의 이름표. 씬이 여러 개일 때 구분하는 용도라 지금은 큰 의미 없음.
    super('MazeScene');
  }

  // preload(): 게임 시작 전에 이미지 등 리소스를 미리 불러오는 함수.
  // 벽 석벽 텍스처, 발자국 아이콘(SVG data URI)과 함정/아이템 박스 이미지(public/sprites, 실제
  // PNG 파일)를 로드해둔다.
  preload() {
    WALL_TILE_TEXTURE_KEYS.forEach((key, i) => this.load.image(key, WALL_TILE_TEXTURE_URIS[i]!));
    this.load.image(FOOTPRINT_TEXTURE_KEY, FOOTPRINT_TEXTURE_URI);
    this.load.image(ITEM_BOX_TEXTURE_KEY, '/sprites/ItemBox-box.png');
    this.load.image(ITEM_MARK_TEXTURE_KEY, '/sprites/ItemBox-mark.png');
    this.load.image(GOAL_POLE_TEXTURE_KEY, '/sprites/GoalFlag-pole.png');
    this.load.image(GOAL_CLOTH_TEXTURE_KEY, '/sprites/GoalFlag-cloth.png');
    this.load.image(PLAYER_TEXTURE_KEY, '/sprites/Character-normal.png');
    this.load.image(PLAYER_TRAP_TEXTURE_KEYS.slow, '/sprites/Character-slide.png');
    this.load.image(PLAYER_TRAP_TEXTURE_KEYS.respawn, '/sprites/Character-respawn.png');
    this.load.image(PLAYER_TRAP_TEXTURE_KEYS.blind, '/sprites/Character-blind.png');
    this.load.image(PLAYER_TRAP_TEXTURE_KEYS.reverse, '/sprites/Character-reverse.png');
    this.load.image(PLAYER_DETECTOR_TEXTURE_KEY, '/sprites/Character-detector.png');
    this.load.image(ITEM_SLOT_TEXTURE_KEYS.flashlight, '/sprites/ItemSlot-flashlight.png');
    this.load.image(ITEM_SLOT_TEXTURE_KEYS.shield, '/sprites/ItemSlot-shield.png');
    this.load.image(ITEM_SLOT_TEXTURE_KEYS.detector, '/sprites/ItemSlot-detector.png');
    this.load.image(ITEM_SLOT_TEXTURE_KEYS.trapInstall, '/sprites/ItemSlot-bomb.png');
    (Object.keys(SFX_PATHS) as SfxKey[]).forEach((key) => this.load.audio(key, SFX_PATHS[key]));
  }

  // 효과음 재생 공용 헬퍼 — 파일 하나가 로드 실패해도(예: 아직 못 구한 사운드) 게임 전체가
  // 멈추면 안 되므로 try/catch로 감싼다.
  //
  // 발걸음 소리(길이 0.3~0.5초)가 한 칸 이동 시간(BASE_MOVE_DURATION=150ms)보다 훨씬 길어서,
  // 도착 직후 아이템 획득/함정 발동 효과음이 겹쳐 재생되면 두 소리가 뒤섞여 들리는 문제가
  // 있었다 — 다른 효과음이 날 때는 항상 먼저 남아있는 발걸음 소리를 끊는다.
  //
  // 마찬가지로, 함정을 연달아 밟는 등 이벤트 효과음끼리 겹치는 경우도 있어서(이전 함정
  // 효과음이 아직 울리는 중에 새 함정을 밟으면 두 소리가 섞여 들림) 새 이벤트 효과음을 틀기
  // 전에 이전 이벤트 효과음도 끊는다 — 항상 "가장 최근에 발동한 효과음"만 들리게 함.
  private playSfx(key: SfxKey) {
    try {
      this.footstepSound?.stop();
      this.lastEventSound?.stop();
      const sound = this.sound.add(key);
      this.lastEventSound = sound;
      this.lastEventSoundStartedAt = this.time.now;
      sound.play({ volume: SFX_VOLUME_OVERRIDES[key] ?? DEFAULT_SFX_VOLUME });
    } catch (err) {
      console.error(`효과음 재생 실패: ${key}`, err);
    }
  }

  // 발걸음 재생 요청 — 아이템 획득 등 이벤트 효과음이 아직 재생 중이면 그게 끝날 때까지
  // 미뤘다가 재생한다(피드백: 아이템 먹고 바로 걸어도 두 소리가 안 겹치고 순서대로 나야 함).
  // 대기 중 또 다른 발걸음이 요청되면(연속 이동) 토큰을 갱신해 먼저 예약해둔 재생을 무효화 —
  // 항상 가장 최근 요청 하나만 실제로 재생됨.
  private playFootstep() {
    const activeEvent = this.lastEventSound;
    if (activeEvent?.isPlaying) {
      const token = ++this.footstepDelayToken;
      const elapsedMs = this.time.now - this.lastEventSoundStartedAt;
      const remainingMs = Math.max(30, activeEvent.duration * 1000 - elapsedMs);
      this.time.delayedCall(remainingMs, () => {
        if (token !== this.footstepDelayToken) return; // 그 사이 더 최근 요청이 들어왔으면 무시
        this.playFootstep(); // 재평가 — 대기하는 사이 다른 이벤트 효과음으로 바뀌었으면 다시 대기
      });
      return;
    }
    this.playFootstepNow();
  }

  // 발걸음 소리를 실제로 재생. 이전 발걸음이 아직 울리는 중에 새 걸음을 내디디면(연속 이동 시
  // 흔함) 겹쳐 들리지 않게 먼저 끊는다.
  private playFootstepNow() {
    try {
      this.footstepSound?.stop();
      this.footstepSound = this.sound.add('footstep');
      this.footstepSound.play({ volume: DEFAULT_SFX_VOLUME });
    } catch (err) {
      console.error('효과음 재생 실패: footstep', err);
    }
  }

  // create(): 게임이 시작될 때 딱 한 번만 실행됨. 여기서 맵과 캐릭터를 화면에 배치합니다.
  create() {
    // 이번 판의 클리어 시간 기준점. 골인 시 run.finish로 보낼 clearTimeMs 계산에 쓰인다
    // (2026-07-13: 지금까지 이 값 자체가 없어서 골인해도 리더보드에 기록이 전혀 안 남고
    // 있었음 — checkGoalReached/reportRunFinish 참고).
    this.runStartTime = Date.now();
    this.stepCount = 0;

    // 맵 크기만큼 타일 상태 배열을 준비한다. 통로와 맞닿은 벽 칸에는 석벽 텍스처 도형을
    // 하나씩 배치(깊은 안쪽 벽 칸은 어차피 안 보일 곳이라 만들지 않음). 벽 텍스처는 안개
    // 상태에 따라 밝기가 바뀐다(computeFogVisibility 참고) — 그래야 "탐험해야 벽도 보인다"는
    // 안개 시스템 취지가 유지된다. 바닥 칸 자체에는 별도 도형을 그리지 않는다(2026-07-14
    // 벽돌/이끼/석조를 차례로 시도했으나 매번 벽과 경쟁하거나 구분이 안 된다는 피드백으로
    // 원래대로 되돌림 — 검은 배경 그대로 유지).
    for (let y = 0; y < MAP_HEIGHT; y++) {
      this.tileStates[y] = [];
      this.trapRects[y] = [];
      this.footprintRects[y] = [];
      this.itemRects[y] = [];

      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileStates[y]![x] = 'hidden'; // 시작할 땐 전부 안개로 덮인 상태

        if (MAIN_MAP.grid[y]![x] === 'wall') {
          // 통로와 한 번이라도 맞닿아 있어야(=언젠가 보일 가능성이 있어야) 텍스처를 만든다.
          const touchesFloor =
            this.isWalkable(x, y - 1) || this.isWalkable(x, y + 1) || this.isWalkable(x - 1, y) || this.isWalkable(x + 1, y);
          if (touchesFloor) {
            const textureKey = WALL_TILE_TEXTURE_KEYS[wallVariantIndex(x, y)]!;
            const image = this.add
              .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, textureKey)
              .setDepth(-1)
              .setAlpha(0);
            this.wallTiles.push({ x, y, image });
          }
          continue; // 벽 칸은 통로 도형을 만들지 않고 건너뜀
        }
        // 바닥 칸 자체는 별도 도형을 그리지 않는다(과거 회색 사각형/연결 통로가 "이동할
        // 때마다 회색 선 생긴다"는 피드백으로 제거된 이력이 있어 리스크가 큼) — 검은 배경
        // 그대로 두고, 벽 텍스처(윤곽)와 발자국 아이콘만으로 통로를 표현한다.
      }
    }

    this.createGoalFlag();

    // 캐릭터를 맵 시작 칸(SPAWN_POSITION)에 배치.
    this.playerGridX = SPAWN_POSITION.x;
    this.playerGridY = SPAWN_POSITION.y;
    this.playerImg = this.add
      .image(
        this.playerGridX * TILE_SIZE + TILE_SIZE / 2,
        this.playerGridY * TILE_SIZE + TILE_SIZE / 2,
        PLAYER_TEXTURE_KEY
      )
      .setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE);
    this.playerBaseScaleX = this.playerImg.scaleX;
    this.playerBaseScaleY = this.playerImg.scaleY;
    this.playerImg.setDepth(10); // depth(그리기 순서)를 높여서 타일 위에 캐릭터가 보이게 함
    // 스폰 인트로(스포트라이트, 2026-07-14 — 하늘에서 떨어지기/살금살금 등장 후보는 비교
    // 검토 끝에 제거됨) — updateFog() 억제부터 시작해야 인트로 끝날 때까지 맵이 안 보인다.
    // 아래 카메라/아이템 슬롯/시야 계산 등 나머지 create() 로직보다 먼저 켜둔다.
    this.suppressFogUpdates = true;
    this.playSpawnIntroSpotlight();

    // 카메라가 캐릭터를 따라다니게 한다(2026-07-13 도입). setBounds로 맵 바깥은 스크롤이
    // 안 되게 막아서, 맵 가장자리에서도 화면 밖(빈 공간)이 보이지 않게 한다. startFollow의
    // lerp(0.1, 0.1)는 카메라가 캐릭터를 순간이동하듯 따라가지 않고 살짝 지연되며 부드럽게
    // 쫓아가게 하는 값 — 너무 낮으면(0에 가까우면) 카메라가 못 따라와 보이고, 너무 높으면
    // (1에 가까우면) 예전처럼 카메라가 딱 붙어 뚝뚝 끊겨 보인다.
    this.cameras.main.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);
    this.cameras.main.startFollow(this.playerImg, true, 0.1, 0.1);

    // 키보드의 방향키 입력을 받을 수 있도록 설정.
    // 이후 update()에서 this.cursors.left/right/up/down 으로 눌림 여부를 확인할 수 있음.
    this.cursors = this.input.keyboard!.createCursorKeys();

    // 아이템 슬롯 UI(우측 하단 고정, 2026-07-13 도입). 화면 좌표 기준 고정(setScrollFactor(0))
    // 이라 카메라가 캐릭터를 따라다녀도 항상 같은 자리에 보인다. 박스 자체는 refreshItemSlotsUI가
    // heldItems 개수만큼 동적으로 만들고 지운다("먹을 때마다 박스가 생기는 구조", 2026-07-13
    // 피드백) — 지금은 heldItems가 비어있어 호출해도 아무것도 안 생긴다.
    this.refreshItemSlotsUI();

    // 아이템 사용/슬롯 전환 키. 방향키(this.cursors)와 달리 "누르는 동안 계속"이 아니라
    // "딱 한 번" 반응해야 하는 단발성 입력이라 keydown 이벤트로 처리한다.
    this.input.keyboard!.on('keydown-Z', () => this.useSelectedItem());
    this.input.keyboard!.on('keydown-X', () => this.cycleSelectedSlot());

    // 시야(안개) 초기 계산은 여기서 하지 않는다 — "캐릭터에 불이 들어오는 순간"과 "맵이
    // 드러나는 순간"을 맞추려고 playSpawnIntroSpotlight의 마지막 flicker 단계에서 대신
    // 호출한다(그 전까진 맵 전체가 초기값 그대로 hidden 상태 유지 — wallTiles가 이미
    // setAlpha(0)로 시작하므로 별도 처리 불필요).

    // 스플래시 로드아웃 화면에서 고른 아이템 지급 — updateFog 이후에 호출해야 손전등이
    // 즉시 넓힌 시야가 초기 안개 계산에 덮이지 않는다.
    void this.applyLoadout();

    // 서버에 위치 앵커를 초기화하고 내가 설치한 함정 목록을 받아온다 (fire-and-forget).
    void this.loadServerState();

    // 모아둔 발자국을 주기적으로 한 번에 서버로 보낸다(칸마다 개별 요청하지 않기 위함).
    this.time.addEvent({
      delay: FOOTPRINT_FLUSH_INTERVAL_MS,
      loop: true,
      callback: () => void this.flushFootprints(),
    });
  }

  // 골인 지점 깃발(깃대+천 메쉬)을 만들어 this.goalRect에 담는다. 깃대 밑동이 타일 중심에
  // 오도록 기준점을 잡고, 깃대/천을 각각 원본 캔버스에서의 위치(GOAL_*_BOUNDS)만큼
  // 오프셋해서 원래 그림과 같은 배치로 복원한다.
  private createGoalFlag() {
    const goalTileX = GOAL_POSITION.x * TILE_SIZE + TILE_SIZE / 2;
    const goalTileY = GOAL_POSITION.y * TILE_SIZE + TILE_SIZE / 2;
    const goalOriginX = goalTileX - (GOAL_FLAG_CANVAS / 2) * GOAL_FLAG_SCALE; // 원본 캔버스 (0,0)의 화면 위치
    const goalOriginY = goalTileY - GOAL_POLE_BOUNDS.maxY * GOAL_FLAG_SCALE; // 깃대 밑동을 타일 중심에 맞춤

    // 깃대: 고정, 원본에서의 좌상단 위치로 배치(origin 기본값 0.5라서 중심 기준 좌표로 변환)
    const poleWidth = (GOAL_POLE_BOUNDS.maxX - GOAL_POLE_BOUNDS.minX + 1) * GOAL_FLAG_SCALE;
    const poleHeight = (GOAL_POLE_BOUNDS.maxY - GOAL_POLE_BOUNDS.minY + 1) * GOAL_FLAG_SCALE;
    const poleImg = this.add
      .image(
        goalOriginX + GOAL_POLE_BOUNDS.minX * GOAL_FLAG_SCALE + poleWidth / 2,
        goalOriginY + GOAL_POLE_BOUNDS.minY * GOAL_FLAG_SCALE + poleHeight / 2,
        GOAL_POLE_TEXTURE_KEY
      )
      .setDisplaySize(poleWidth, poleHeight);

    // 깃발 천: 하나의 연속된 Mesh2D로 만든다. 가로로 GOAL_FLAG_WAVE_COLS칸 격자(정점 열
    // GOAL_FLAG_WAVE_COLS+1개, 위/아래 두 줄)를 만들어두고, 매 프레임 칸 사이 간격을
    // 사인파로 흔드는 건 updateGoalFlagWave에서 한다(정점 좌표를 직접 수정하는 연속 표면이라
    // 조각 이음매 자체가 없어 절대 벌어지거나 찢어지지 않는다).
    this.goalClothWidth = (GOAL_CLOTH_BOUNDS.maxX - GOAL_CLOTH_BOUNDS.minX + 1) * GOAL_FLAG_SCALE;
    const clothHeight = (GOAL_CLOTH_BOUNDS.maxY - GOAL_CLOTH_BOUNDS.minY + 1) * GOAL_FLAG_SCALE;
    const clothAttachX = goalOriginX + GOAL_CLOTH_BOUNDS.minX * GOAL_FLAG_SCALE;
    const clothAttachY = goalOriginY + GOAL_CLOTH_BOUNDS.minY * GOAL_FLAG_SCALE; // 윗변 기준(origin 0,0)

    const vertices: number[] = [];
    const indices: number[] = [];
    for (let col = 0; col <= GOAL_FLAG_WAVE_COLS; col++) {
      const u = col / GOAL_FLAG_WAVE_COLS;
      const x = u * this.goalClothWidth;
      vertices.push(x, 0, u, 0); // 윗줄 정점
      vertices.push(x, clothHeight, u, 1); // 아랫줄 정점
    }
    for (let col = 0; col < GOAL_FLAG_WAVE_COLS; col++) {
      const topLeft = col * 2;
      const botLeft = col * 2 + 1;
      const topRight = (col + 1) * 2;
      const botRight = (col + 1) * 2 + 1;
      indices.push(topLeft, botLeft, topRight, 0);
      indices.push(botLeft, botRight, topRight, 0);
    }

    // flipV=true: WebGL 텍스처 좌표는 아래→위(bottom-up)가 기본인데, 위 정점 배열은 이미지
    // 좌표계(위→아래)로 v를 매겼기 때문에 그대로 두면 천 그림이 위아래로 뒤집혀 보인다.
    this.goalClothMesh = this.add.mesh2d(clothAttachX, clothAttachY, GOAL_CLOTH_TEXTURE_KEY, vertices, indices, true);
    this.goalClothMesh.setOrigin(0, 0);
    this.goalClothElapsed = 0;

    this.goalRect = this.add.container(0, 0, [poleImg, this.goalClothMesh]);
    this.goalRect.setDepth(6);
  }

  // map.getState를 호출해 서버 쪽 위치 앵커를 시작 지점으로 초기화하고, 내가 설치한
  // 함정 목록 + 다른 유저들이 남긴 발자국 좌표를 받아와 마커로 표시한다.
  private async loadServerState() {
    let footprints: Position[];
    try {
      const state = await trpc.map.getState.query({ mapId: MAP_ID });
      this.myTraps = state.myTraps;
      // state.myTraps는 서버가 실제로 확인해준 "내가 설치한 함정" 목록이라(trapInstallerKey
      // 기준) 이전 세션에 설치해둔 것도 포함될 수 있다. selfInstalledTrapKeys는 지금까지
      // handleInstallSuccess가 호출된 적 있는 것만 기록해서, 새로고침 등으로 여기서 처음
      // 불러온 기존 함정은 빠져있었다 — reportPosition의 로컬 폴백이 그런 함정도 다시 "내
      // 함정"으로 인식하도록 여기서 한 번에 채워준다(2026-07-11 발견/수정).
      for (const trap of state.myTraps) {
        this.selfInstalledTrapKeys.add(`${trap.x},${trap.y}`);
      }
      footprints = state.footprints;
      // 2026-07-12: 서버가 미스터리 박스 방식으로 재설계되며 필드명도 items → mysteryBoxes로
      // 바뀌었고, 타입 없이 좌표만 온다(오라클 방지 — 밟기 전엔 아이템/함정 여부조차 비밀).
      this.remainingItems = state.mysteryBoxes;
    } catch (err) {
      // 정적 빌드만 단독으로 띄우는 로컬 프리뷰(백엔드 없음)에서도 마커를 눈으로 확인할 수
      // 있도록 하는 개발용 폴백. 실제 서버(devvit playtest/배포 환경)가 응답하면 위 try에서
      // 이미 성공해 여기까지 오지 않는다.
      // ⚠️ 아래 좌표들도 TEMP_ITEMS와 마찬가지로 MAIN_MAP(map-1)의 바닥 칸이어야 하며
      // 코드로 검증하지 않는다 — 맵이 바뀌면 같이 확인할 것.
      // 2026-07-10: map-1 레이아웃 4차 재설계에 맞춰 좌표 갱신. myTraps는 실제로는 "내가
      // 설치한 함정"(서버 응답 기준, trapInstallerKey)이라 맵에 고정 배치되는 개념이 아님 —
      // 여기 좌표는 백엔드 없는 로컬 프리뷰에서만 쓰이는 임시 데이터라 실제 게임플레이에
      // 영향은 없지만, slow(슬라이드)만큼은 로컬에서 테스트할 때도 실제로 미끄러지는 게
      // 눈에 보여야 의미가 있음.
      // ⚠️ (3,9)로 한 번 옮겼다가 재발견: "이 칸에서 어느 방향으로든 러너웨이가 있는가"만
      // 계산하고 "그 방향으로 실제 진입이 가능한가"는 확인 안 해서, 정작 진입 가능한 두
      // 방향(위/왼쪽에서 들어옴) 모두 즉시 벽이라 실질 슬라이드 거리가 0이었음. "진입 가능한
      // 이전 칸이 열려있는지 + 그 방향으로 계속 몇 칸 갈 수 있는지"까지 확인해서 재배치 —
      // 아래 (2,19)는 실제로 왼쪽에서 오른쪽으로 걸어 들어오면서 그대로 오른쪽으로 15칸
      // 미끄러지는 지점(맵 하단의 긴 통로 한복판).
      console.error('map.getState 실패 — 로컬 프리뷰용 임시 데이터로 대체', err);
      this.myTraps = [
        { x: 2, y: 19, type: 'slow' },
        { x: 17, y: 3, type: 'respawn' },
        { x: 3, y: 17, type: 'blind' },
        { x: 21, y: 17, type: 'reverse' },
      ];
      // 발자국은 로컬 폴백 임시 좌표를 두지 않는다(2026-07-14 제거) — 시작 지점 근처 좌표라
      // 스폰 인트로가 끝나자마자 바로 보여서 "다른 유저 발자국"이라기엔 부자연스러웠음.
      footprints = [];
      // 아이템도 위와 동일한 이유(백엔드 없는 로컬 프리뷰)로 TEMP_ITEMS 좌표로 폴백한다.
      this.remainingItems = TEMP_ITEMS;
    }
    this.renderTrapMarkers();
    this.renderFootprintMarkers(footprints);
    this.renderItemMarkers();
  }

  // 함정/아이템 스폰 마커(박스 + 위아래로 통통 뜨는 물음표) 공용 생성 헬퍼. 2026-07-13:
  // 아이템:함정 확률이 반반인 미스터리 박스 도입으로 랜덤 스폰이 뭐가 나올지 밟기 전엔 알 수
  // 없어졌으므로, 예전에 "아이템=별 모양"으로 따로 구분해 그리던 걸 없애고 설치형 함정
  // 마커와 완전히 같은 모양으로 통일했다(임소리 피드백 — 확률이 반반으로 정해졌으니 시각적
  // 구분도 없애는 게 맞다고 판단).
  private buildMysteryBoxMarker(cx: number, cy: number): Phaser.GameObjects.Container {
    // 박스는 고정, 물음표만 따로 애니메이션을 걸어야 해서 두 이미지를 각각 만든 뒤
    // 컨테이너로 묶는다 — 컨테이너에 setAlpha를 하면 두 이미지가 함께 밝기 조정된다.
    const boxImg = this.add.image(0, 0, ITEM_BOX_TEXTURE_KEY).setDisplaySize(ITEM_MARKER_SIZE, ITEM_MARKER_SIZE);
    const markImg = this.add.image(0, 0, ITEM_MARK_TEXTURE_KEY).setDisplaySize(ITEM_MARKER_SIZE, ITEM_MARKER_SIZE);

    const marker = this.add.container(cx, cy, [boxImg, markImg]);
    marker.setDepth(6); // 타일(기본 depth 0)보다 위, 캐릭터(depth 10)보다 아래
    // 벽 타일(wallTiles)과 동일하게 기본값을 숨김(0)으로 시작 — updateFog()의 paintTile이
    // 안개 상태에 맞는 알파를 계산해줄 때까지는 안 보여야 한다. 스포트라이트 인트로처럼
    // updateFog()가 한동안 억제되는 동안에도(2026-07-14 발견) 이 기본값 덕분에 미리 노출되지
    // 않는다 — 억제 중이 아니면 호출부(renderItemMarkers/renderTrapMarkers)의 updateFog()가
    // 같은 프레임 안에서 바로 알맞은 알파로 보정하므로 평소 동작엔 영향 없다.
    marker.setAlpha(0);

    // 물음표만 위아래로 살짝 통통 뜨는 애니메이션 (박스는 움직이지 않음)
    this.tweens.add({
      targets: markImg,
      y: markImg.y - ITEM_MARK_BOB_PX,
      duration: ITEM_MARK_BOB_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return marker;
  }

  // this.remainingItems(미스터리 박스 스폰)를 화면에 마커로 그린다. renderTrapMarkers()와
  // 동일하게 loadServerState()에서 서버 응답을 받은 뒤 한 번 호출한다.
  private renderItemMarkers() {
    for (const item of this.remainingItems) {
      const cx = item.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = item.y * TILE_SIZE + TILE_SIZE / 2;
      this.itemRects[item.y]![item.x] = this.buildMysteryBoxMarker(cx, cy);
    }
    this.updateFog();
  }

  // this.myTraps(내가 설치한 함정)를 화면에 마커로 그린다.
  // 안개 상태를 바로 반영하기 위해 마지막에 updateFog도 호출.
  private renderTrapMarkers() {
    for (const trap of this.myTraps) {
      const cx = trap.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = trap.y * TILE_SIZE + TILE_SIZE / 2;
      this.trapRects[trap.y]![trap.x] = this.buildMysteryBoxMarker(cx, cy);
    }
    this.updateFog();
  }

  // 다른 유저들이 남긴 발자국(footprints)을 화면에 아이콘으로 그린다. 내 발자국은 그리지
  // 않음 — 지나온 길은 안개(explored 상태)가 걷혀 보이는 것만으로 표시한다.
  private renderFootprintMarkers(footprints: Position[]) {
    for (const tile of footprints) {
      if (this.footprintRects[tile.y]?.[tile.x]) continue; // 같은 칸에 중복 표시 방지
      if (Math.random() >= FOOTPRINT_DISPLAY_RATIO) continue; // 전체 경로가 다 보이지 않도록 일부만 랜덤 표시
      const marker = this.add.image(
        tile.x * TILE_SIZE + TILE_SIZE / 2,
        tile.y * TILE_SIZE + TILE_SIZE / 2,
        FOOTPRINT_TEXTURE_KEY
      );
      marker.setDisplaySize(PATH_WIDTH * 0.7, PATH_WIDTH * 0.7);
      marker.setDepth(2); // 통로(depth 0)보다 위, 함정/캐릭터(depth 6/10)보다 아래
      marker.setAlpha(0); // buildMysteryBoxMarker와 동일한 이유(안개 계산 전엔 숨김 기본값)
      this.footprintRects[tile.y]![tile.x] = marker;
    }
    this.updateFog();
  }

  // 천 메쉬의 정점 x좌표를 매 프레임 사인파로 흔들어 파동이 깃대에서 끝자락으로 흐르는
  // 것처럼 보이게 한다. 실제 수식(순증가 보장, 양 끝 고정)은 goalFlagWave.ts의
  // computeClothWaveX로 분리해뒀다(Phaser 없이도 단위 테스트 가능하도록).
  private updateGoalFlagWave(delta: number) {
    this.goalClothElapsed += delta / 1000;

    // 파동은 경과 시간(t)에 대해 주기적이다(주기 = 2π/SPEED, phase에 t*SPEED가 선형으로
    // 들어가고 sin의 주기가 2π이므로). 매 프레임 이 주기로 감아두면(wrap) 시각적으로는
    // 완전히 이어지면서도(주기 경계에서 sin 값이 정확히 같음) t가 무한정 커지며 부동소수점
    // 정밀도가 떨어지는 일(아주 오래 켜둔 세션에서)을 막을 수 있다.
    const wavePeriod = (2 * Math.PI) / GOAL_FLAG_WAVE_SPEED;
    this.goalClothElapsed %= wavePeriod;

    const xs = computeClothWaveX(
      GOAL_FLAG_WAVE_COLS,
      GOAL_FLAG_WAVE_CYCLES,
      GOAL_FLAG_WAVE_AMPLITUDE,
      GOAL_FLAG_WAVE_SPEED,
      this.goalClothElapsed,
      this.goalClothWidth
    );

    const vertices = this.goalClothMesh.vertices;
    for (let col = 0; col <= GOAL_FLAG_WAVE_COLS; col++) {
      vertices[col * 8 + 0] = xs[col]!; // 윗줄 정점의 x
      vertices[col * 8 + 4] = xs[col]!; // 아랫줄 정점의 x
    }
  }

  // attemptInstall()에서 방금 설치에 성공한 함정 1개만 그릴 때 쓰는 함수. renderTrapMarkers()
  // 전체를 재호출하면 이미 그려둔 마커가 dedup 없이 중복 생성되므로 새 함정 1개만 그린다.
  // renderTrapMarkers()의 그리기 로직(박스+통통 뜨는 물음표, 2️⃣/3️⃣ 작성분)과 겹치는 부분이
  // 있지만, 그쪽 함수를 리팩터링해서 공유하지 않고 별도 함수로 둔다 — 다른 팀원이 작성한
  // 함수는 건드리지 않기 위함(2026-07-09 임소리 확인).
  private renderInstalledTrapMarker(trap: TrapInstance) {
    const cx = trap.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = trap.y * TILE_SIZE + TILE_SIZE / 2;

    // 박스는 고정, 물음표만 따로 애니메이션을 걸어야 해서 두 이미지를 각각 만든 뒤
    // 컨테이너로 묶는다 — 컨테이너에 setAlpha를 하면 두 이미지가 함께 밝기 조정된다.
    const boxImg = this.add.image(0, 0, ITEM_BOX_TEXTURE_KEY).setDisplaySize(ITEM_MARKER_SIZE, ITEM_MARKER_SIZE);
    const markImg = this.add.image(0, 0, ITEM_MARK_TEXTURE_KEY).setDisplaySize(ITEM_MARKER_SIZE, ITEM_MARKER_SIZE);

    const marker = this.add.container(cx, cy, [boxImg, markImg]);
    marker.setDepth(6); // 타일(기본 depth 0)보다 위, 캐릭터(depth 10)보다 아래
    this.trapRects[trap.y]![trap.x] = marker;

    // 물음표만 위아래로 살짝 통통 뜨는 애니메이션 (박스는 움직이지 않음)
    this.tweens.add({
      targets: markImg,
      y: markImg.y - ITEM_MARK_BOB_PX,
      duration: ITEM_MARK_BOB_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // update(): 매 프레임(1초에 수십 번)마다 반복 실행되는 함수.
  // "지금 방향키가 눌렸는가?"를 확인해서 캐릭터를 움직이는 역할을 함.
  override update(_time: number, delta: number) {
    // 깃발 펄럭임은 골인 여부/이동 여부와 무관하게 항상 갱신
    this.updateGoalFlagWave(delta);

    // 보유/지속 중인 아이템 이펙트(손전등 글로우, 쉴드 링, 함정 보유 아이콘)도 골인 여부와
    // 무관하게 캐릭터 위치를 계속 따라가야 자연스럽다 — 이동은 트윈으로 매 프레임 좌표가
    // 바뀌므로, 이동 완료 시점이 아니라 여기서 매 프레임 동기화한다.
    this.syncHeldItemEffects();

    // 골인했으면 더 이상 입력을 받지 않음 (테스트용 종료 처리)
    if (this.hasFinished) return;

    // 이동 애니메이션이 재생 중이면 새 입력은 무시 (칸 단위로 딱딱 끊어 이동하게 하기 위함)
    if (this.isMoving) return;

    // 가만히 서 있을 때도 완전히 정지된 그림처럼 보이지 않도록 은은하게 숨쉬듯 위아래로
    // 움직이는 idle 애니메이션(2026-07-14 피드백). playerImg에 걸린 트윈이 하나도 없을 때만
    // 새로 시작한다 — 이동/착지/리스폰 등 다른 곳에서 killTweensOf(this.playerImg)로 정리되면
    // (기존에 이미 그렇게 하고 있음, applyRespawnTrap 등 참고) 자동으로 다음 프레임에 다시
    // 시작되므로 별도 필드로 상태를 직접 추적할 필요가 없다.
    if (this.tweens.getTweensOf(this.playerImg).length === 0) {
      this.startIdleBob();
    }

    const pressed = this.getPressedDirection();
    if (!pressed) return; // 아무 방향키도 안 눌렸으면 아무 것도 안 함

    let { dx, dy } = pressed;

    // 역방향 함정에 걸린 상태면 입력 방향을 반대로 뒤집음
    if (this.isReversed) {
      dx = -dx;
      dy = -dy;
    }

    this.tryMove(dx, dy);
  }

  // 보유/지속 중인 아이템·함정 이펙트를 캐릭터의 실제 화면 좌표로 옮긴다. 없으면(옵셔널
  // 체이닝) 아무 일도 안 하므로 매 프레임 불러도 비용이 거의 없다.
  private syncHeldItemEffects() {
    this.flashlightGlow?.setPosition(this.playerImg.x, this.playerImg.y);
    this.shieldRing?.setPosition(this.playerImg.x, this.playerImg.y);

    // 쉴드 아이콘과 역방향 경고 아이콘은 머리 위 같은 자리를 쓰는데, 동시에 뜰 수 있다(예:
    // 역방향 효과가 아직 지속 중일 때 쉴드를 새로 주움) — 둘 다 떠 있을 때만 좌우로 나눠
    // 배치하고, 하나만 있으면 정중앙에 둔다(2026-07-11 임소리가 heldTrapIcon/reverseIcon
    // 쌍에 적용했던 것과 동일한 패턴, 2026-07-13 shieldIcon으로 대상만 교체).
    const headIconY = this.playerImg.y - TILE_SIZE * 0.55;
    const headIconOffsetX = this.shieldIcon && this.reverseIcon ? TILE_SIZE * 0.22 : 0;
    const shieldIconX = this.playerImg.x - headIconOffsetX;
    this.shieldIcon?.setPosition(shieldIconX, headIconY);
    this.reverseIcon?.setPosition(this.playerImg.x + headIconOffsetX, headIconY);
    // 개수 배지는 쉴드 아이콘의 오른쪽 아래 모서리에 살짝 겹치게 붙인다(뱃지 느낌).
    const badgeX = shieldIconX + TILE_SIZE * 0.16;
    const badgeY = headIconY + TILE_SIZE * 0.14;
    this.shieldCountBadgeBg?.setPosition(badgeX, badgeY);
    this.shieldCountLabel?.setPosition(badgeX, badgeY);
  }

  // 지금 눌려있는 방향키를 -1/0/1 형태의 방향값으로 바꿔주는 함수. 아무 키도 안 눌렸으면 null.
  // isDown = "지금 눌려있는 상태"면 계속 true (누르고 있는 동안 쭉 true).
  private getPressedDirection(): { dx: number; dy: number } | null {
    if (this.cursors.left.isDown) return { dx: -1, dy: 0 };
    if (this.cursors.right.isDown) return { dx: 1, dy: 0 };
    if (this.cursors.up.isDown) return { dx: 0, dy: -1 };
    if (this.cursors.down.isDown) return { dx: 0, dy: 1 };
    return null;
  }

  // 스폰 인트로 — "스포트라이트"(2026-07-14, 하늘에서 떨어지기/살금살금 등장 후보와 비교
  // 검토 끝에 최종 채택).
  // - 1차(확 퍼지는 원)/2차(타원 빛무리)는 "캐릭터 자신이 빛을 뿜는" 손전등 인상이라는
  //   피드백 → 3차에서 위는 좁고 아래로 갈수록 넓어지는 삼각형 빔으로 교체.
  // - Phaser의 Triangle 게임 오브젝트는 지정한 세 점을 원점 기준 그대로 배치하는 게 아니라
  //   바운딩 박스 중심을 기본 origin(0.5, 0.5)에 맞춰 재배치해서 도형이 비스듬히 그려지는
  //   문제가 있었음(2026-07-14 발견) → 좌표를 완전히 직접 통제하는 Graphics로 교체.
  // - 6차에서 "캐릭터 먼저 페이드인 → 조명 따로 깜빡" 순서로 바꿨었는데, "암흑에서 시작해서
  //   조명이 깜빡일 때마다 캐릭터도 같이 보였다 안 보였다 하고, 조명이 완전히 켜지는 순간
  //   맵이 드러나면 좋겠다"는 피드백으로 재조정 → 다시 캐릭터를 lampGlow/beam과 같은
  //   flicker 토큰으로 묶되(runFlicker 안에서 셋 다 같이 토글), 맵 공개(updateFog)만 마지막
  //   켜짐 시점에 별도로 실행하는 형태로 정리(이 부분은 6차에서 그대로 유지).
  // - "삼각형이 너무 단단해 보인다, 그라디언트로 은은하게" 피드백 → Graphics의
  //   fillGradientStyle로 램프 쪽(꼭짓점)은 진하고 캐릭터 쪽(밑변)으로 갈수록 옅어지는
  //   수직 그라디언트 채우기로 교체(단색 fillStyle 대신).
  private playSpawnIntroSpotlight() {
    this.isMoving = true;
    this.playerImg.setAlpha(0);

    const lampX = this.playerImg.x;
    const lampY = this.playerImg.y - TILE_SIZE * 1.7;
    const beamBottomY = this.playerImg.y + TILE_SIZE * 0.4;
    const beamHalfWidth = TILE_SIZE * 0.85;

    const lampGlow = this.add.circle(lampX, lampY, TILE_SIZE * 0.15, 0xfff4c2, 0.7);
    lampGlow.setBlendMode(Phaser.BlendModes.ADD);
    lampGlow.setDepth(9);
    lampGlow.setAlpha(0);

    // Graphics는 world 좌표를 그대로 쓰므로(별도 origin 보정 없음), moveTo(램프 위치) →
    // 캐릭터 발밑 좌/우로 벌어진 두 점을 잇는 삼각형이 정확히 의도한 모양대로 그려진다.
    // fillGradientStyle(top,top,bottom,bottom, alphaTop,alphaTop,alphaBottom,alphaBottom) —
    // 꼭짓점(램프, 위)이 짙고 밑변(캐릭터, 아래)으로 갈수록 옅어져 "은은하게 퍼지는" 느낌.
    const beam = this.add.graphics();
    beam.fillGradientStyle(0xfff4c2, 0xfff4c2, 0xfff4c2, 0xfff4c2, 0.45, 0.45, 0.1, 0.1);
    beam.beginPath();
    beam.moveTo(lampX, lampY);
    beam.lineTo(lampX - beamHalfWidth, beamBottomY);
    beam.lineTo(lampX + beamHalfWidth, beamBottomY);
    beam.closePath();
    beam.fillPath();
    beam.setBlendMode(Phaser.BlendModes.ADD);
    beam.setDepth(9);
    beam.setAlpha(0);

    const flickers: Array<{ on: boolean; holdMs: number }> = [
      { on: true, holdMs: 80 },
      { on: false, holdMs: 70 },
      { on: true, holdMs: 50 },
      { on: false, holdMs: 120 },
      { on: true, holdMs: 90 },
      { on: false, holdMs: 50 },
      { on: true, holdMs: 0 }, // 마지막 — 이후 계속 켜진 채 유지
    ];

    const runFlicker = (index: number) => {
      const step = flickers[index];
      if (!step) return;

      lampGlow.setAlpha(step.on ? 0.7 : 0);
      beam.setAlpha(step.on ? 1 : 0); // beam 자체의 실제 밝기는 그라디언트 알파로 이미 고정
      this.playerImg.setAlpha(step.on ? 1 : 0); // 조명이 꺼질 때마다 캐릭터도 같이 안 보이게

      // 맵(벽/발자국/아이템/함정/골인 마커)도 캐릭터·조명과 같은 리듬으로 같이 깜빡이게 한다
      // (2026-07-14 피드백) — updateFog()는 suppressFogUpdates에 막혀 아직 아무 것도 안 하니,
      // 그 가드를 우회하는 실제 계산 함수(computeFogVisibility)/블랙아웃 함수를 켜짐/꺼짐마다
      // 직접 번갈아 호출한다. computeFogVisibility는 tileStates(탐험 기억)를 갱신하고,
      // blackoutMap은 그 기억은 안 건드리고 화면 표시만 끈다 — 그래서 다음 켜짐 때 다시
      // computeFogVisibility를 부르면 지금까지 쌓인 탐험 범위 그대로 정상 표시된다.
      if (step.on) this.computeFogVisibility();
      else this.blackoutMap();

      if (index + 1 >= flickers.length) {
        // 불이 정착하는 순간 — 이후엔 정상적인 updateFog() 호출(이동 등)이 다시 통하도록
        // 억제 플래그를 푼다. 위에서 이미 computeFogVisibility()로 직접 그렸으므로 여기서
        // updateFog()를 또 부를 필요는 없다.
        this.suppressFogUpdates = false;

        // 둘 다 캐릭터를 따라 움직이지 않는 고정 오브젝트라, 여기서 같이 안 지우면 캐릭터가
        // 걸어간 뒤에도 시작 칸에 빔이 영구히 남는다.
        this.tweens.add({
          targets: [lampGlow, beam],
          alpha: 0, // 각자 현재 알파(lampGlow=0.7, beam=1)에서부터 자연스럽게 옅어짐
          duration: 500,
          onComplete: () => {
            lampGlow.destroy();
            beam.destroy();
          },
        });
        this.isMoving = false;
        return;
      }
      this.time.delayedCall(step.holdMs, () => runFlicker(index + 1));
    };
    runFlicker(0);
  }

  // 골인 순간 재생하는 축하 홉 — 위아래로 통통 두 번 튀면서 동시에 스쿼시&스트레치를 줘서
  // 반가움을 표현한다(2026-07-14 도입). 시작 전에 killTweensOf로 진행 중일 수 있는 다른
  // 트윈(예: idle bob)을 확실히 정리한다 — 이동 트윈이 끝난 직후 호출되는 자리라 보통은
  // 이미 정리돼있지만, tryMove가 이동 시작 시 항상 killTweensOf를 부르는 것과 같은 방어적
  // 패턴을 여기서도 유지한다.
  private playGoalCelebration() {
    this.tweens.killTweensOf(this.playerImg);

    const baseY = this.playerImg.y;
    this.tweens.add({
      targets: this.playerImg,
      y: baseY - GOAL_HOP_HEIGHT_PX,
      duration: GOAL_HOP_DURATION_MS,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.playerImg.y = baseY;
      },
    });
    this.tweens.add({
      targets: this.playerImg,
      scaleY: this.playerBaseScaleY * GOAL_HOP_SQUASH,
      scaleX: this.playerBaseScaleX * GOAL_HOP_STRETCH,
      duration: GOAL_HOP_DURATION_MS,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.playerImg.setScale(this.playerBaseScaleX, this.playerBaseScaleY);
      },
    });
  }

  // 그리드 좌표(x, y)로 이동/통과 가능한지 확인하는 함수 (맵 범위 안 + 벽 아님).
  // 일반 이동(tryMove)과 슬라이드(slideStep) 둘 다 같은 기준으로 판정해야 해서 하나로 뽑아둠.
  private isWalkable(x: number, y: number): boolean {
    const isOutOfBounds = y < 0 || y >= MAP_HEIGHT || x < 0 || x >= MAP_WIDTH;
    if (isOutOfBounds) return false;

    return MAIN_MAP.grid[y]![x] !== 'wall';
  }

  // idle 애니메이션 시작 — 지금 그리드 칸의 고정 픽셀 좌표를 기준(baseY)으로 살짝 위로
  // 떴다가 돌아오는 걸 무한 반복한다. 시작 직전에 y를 baseY로 정확히 맞춰둬서, 이전에 남아있던
  // 오차(예: 벽 넛지 등) 없이 항상 같은 자리를 중심으로 흔들리게 한다.
  private startIdleBob() {
    const baseY = this.playerGridY * TILE_SIZE + TILE_SIZE / 2;
    this.playerImg.y = baseY;
    this.tweens.add({
      targets: this.playerImg,
      y: baseY - IDLE_BOB_AMPLITUDE_PX,
      duration: IDLE_BOB_DURATION_MS,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // 이동 방향에 맞춰 캐릭터 이미지를 좌우 반전(flipX)하고, 짧게 눌렸다 펴지는(squash &
  // stretch) 트윈으로 "한 걸음 내딛는" 느낌을 낸다. dx===0(위/아래로만 이동)일 때는 방향을
  // 안 바꾸고 마지막 좌우 방향을 유지한다 — 캐릭터 그림이 정면 한 장뿐이라 뒷모습이 없음.
  private animatePlayerStep(dx: number) {
    if (dx !== 0) {
      this.playerFacingLeft = dx < 0;
      this.playerImg.setFlipX(this.playerFacingLeft);
    }

    // 이전 걸음의 스쿼시 트윈이 아직 안 끝났으면(연속 이동 등) 멈추고 새로 시작 — 마무리 못한
    // 트윈이 남아있으면 setPlayerTexture가 맞춰둔 크기를 나중에 덮어써버릴 수 있다.
    this.walkBobTween?.stop();
    this.walkBobTween = this.tweens.add({
      targets: this.playerImg,
      scaleY: this.playerBaseScaleY * PLAYER_WALK_SQUASH,
      scaleX: this.playerBaseScaleX * PLAYER_WALK_STRETCH,
      duration: BASE_MOVE_DURATION / 2,
      yoyo: true,
      ease: 'Sine.easeInOut',
    });
  }

  // 벽(또는 맵 끝) 쪽으로 이동을 시도했다가 막혔을 때, 그 방향으로 살짝 튕겼다 돌아오는
  // 넛지 이펙트 — "눌렀는데 반응이 없다"는 느낌을 줄이기 위한 조작감 폴리싱(2026-07-11).
  // 방향키를 벽 쪽으로 계속 누르고 있으면 update()가 매 프레임 이 함수를 부르므로, 쿨다운으로
  // 너무 잦은 재생을 막는다. 기준 위치는 항상 현재 그리드 칸의 고정 픽셀 좌표라, 반복 호출돼도
  // 위치가 밀려 쌓이지 않는다.
  private bumpIntoWall(dx: number, dy: number) {
    if (this.time.now - this.lastWallBumpAt < WALL_BUMP_COOLDOWN_MS) return;
    this.lastWallBumpAt = this.time.now;

    const baseX = this.playerGridX * TILE_SIZE + TILE_SIZE / 2;
    const baseY = this.playerGridY * TILE_SIZE + TILE_SIZE / 2;

    // killTweensOf로 idle bob(startIdleBob)까지 함께 정리한다 — 안 그러면 idle 트윈이 계속
    // y를 건드려서 벽 넛지가 흔들려 보인다(2026-07-14, idle 애니메이션 도입과 함께 발견).
    this.tweens.killTweensOf(this.playerImg);
    this.playerImg.setPosition(baseX, baseY); // 트윈이 중간값을 남길 수 있어 먼저 원위치로

    this.wallBumpTween = this.tweens.add({
      targets: this.playerImg,
      x: baseX + dx * TILE_SIZE * 0.15,
      y: baseY + dy * TILE_SIZE * 0.15,
      duration: WALL_BUMP_DURATION,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  // 한 칸 이동을 시도하는 함수.
  // dx, dy는 "어느 방향으로 한 칸 움직이려 하는지" (-1, 0, 1 중 하나씩)
  private tryMove(dx: number, dy: number) {
    const targetX = this.playerGridX + dx;
    const targetY = this.playerGridY + dy;

    // 맵 범위 밖이거나 벽이면 이동 취소 — 예전엔 아무 반응 없이 조용히 무시했는데, "눌렀는데
    // 왜 안 움직이지"라는 느낌을 줄여보려고 살짝 부딪히는 느낌의 넛지를 추가했다(2026-07-11,
    // 조작감 폴리싱).
    if (!this.isWalkable(targetX, targetY)) {
      this.bumpIntoWall(dx, dy);
      return;
    }

    // 직전에 벽 넛지가 아직 돌아오는 중이었다면 멈춘다 — 안 멈추면 넛지 트윈과 지금 시작하는
    // 실제 이동 트윈이 같은 playerImg.x/y를 동시에 건드려서 서로 싸우다 캐릭터가 잠깐
    // 튀어보이는 문제가 있었음(2026-07-11 발견). idle 애니메이션(startIdleBob, 2026-07-14
    // 도입)도 같은 이유로 여기서 확실히 꺼야 한다 — 이동 트윈과 y를 동시에 건드리면 idle
    // 트윈이 계속 끼어들어 목적지에 정확히 안착하지 못하고 흔들리는 것처럼 보인다.
    this.wallBumpTween?.stop();
    this.tweens.killTweensOf(this.playerImg);

    this.isMoving = true;
    this.playerGridX = targetX;
    this.playerGridY = targetY;
    this.stepCount++;
    this.animatePlayerStep(dx);
    this.playFootstep();

    // tween(트윈) = 값을 순간이동이 아니라 "서서히" 바꿔주는 Phaser 기능.
    // 여기서는 캐릭터의 실제 화면 좌표(x, y)를 목표 지점까지 BASE_MOVE_DURATION(ms) 동안 부드럽게 이동시킴.
    // ease를 Sine.easeOut으로 줘서 도착 직전에 살짝 감속하는 느낌을 냄(2026-07-11 조작감 폴리싱
    // — 기존엔 ease 지정이 없어 등속(Linear)이라 뚝뚝 끊기는 인상이 있었음).
    this.tweens.add({
      targets: this.playerImg,
      x: targetX * TILE_SIZE + TILE_SIZE / 2,
      y: targetY * TILE_SIZE + TILE_SIZE / 2,
      duration: BASE_MOVE_DURATION,
      ease: 'Sine.easeOut',
      onComplete: () => {
        // 발자국 기록은 골인 여부와 무관하게 항상 남긴다.
        this.queueFootprint(targetX, targetY);

        if (this.checkGoalReached(targetX, targetY)) return; // 골인했으면 함정 확인 없이 종료

        // 조작감 개선(2026-07-13, docs/wbs.md 72행): 트윈이 끝나면 설치형 함정(trap.trigger)/
        // 미스터리 박스(item.pickup) 서버 응답을 기다리지 않고 곧바로 다음 입력을 받는다.
        // 예전엔 resolveArrival이 두 응답을 모두 받은 뒤에야 isMoving을 풀어서, 실배포 환경의
        // 네트워크 왕복이 매 칸 조작감 지연으로 그대로 이어졌다. 판정이 늦게 도착해 이미 다음
        // 이동이 진행 중이더라도 안전하도록 applyRespawnTrap/applySlideTrap이 killTweensOf로
        // 진행 중인 이동을 항상 이기게 처리한다(아래 두 함수 참고) — 슬라이드만 예외적으로
        // 스스로 다시 isMoving을 잠근다.
        this.isMoving = false;

        // 설치형 함정(trap.trigger)과 미스터리 박스(item.pickup)를 함께 판정한다. dx, dy(눌렀던
        // 방향)는 둘 중 하나(또는 둘 다)가 슬라이드 결과일 때 미끄러질 방향을 정하는 데 필요.
        void this.resolveArrival(targetX, targetY, dx, dy);
      },
    });

    // 위치가 바뀌었으니 시야(안개)도 다시 계산
    this.updateFog();
  }

  // trap.trigger를 호출해 서버 쪽 위치 앵커를 동기화하고, 함정에 걸렸는지 응답을 받는다.
  // 정말 백엔드 자체가 없을 때만(IS_LOCAL_PREVIEW — 로컬 정적 프리뷰) loadServerState와
  // 동일하게 로컬 myTraps 목록으로 직접 판정해 폴백한다 — 그래야 로컬 프리뷰에서도 함정을
  // "밟으면 실제로 발동"한다. attemptInstall/applyLoadout/reportRunFinish와 같은 패턴
  // (IS_LOCAL_PREVIEW로 실서버/로컬을 구분)으로 통일 — 처음엔 에러 모양(TRPCClientError.data
  // 유무)으로 "서버가 진짜 거부한 건지"를 구분했었는데, 그러면 실서버에서 응답 자체가 아예
  // 안 온 진짜 통신 장애(네트워크 오류 등, .data가 안 채워짐)까지 "백엔드 없음"으로 오판해
  // 여전히 로컬 폴백을 타버리는 구멍이 있었다(2026-07-14 리뷰에서 발견) — IS_LOCAL_PREVIEW는
  // 에러 종류와 무관하게 "지금 실서버인가"만 보므로 이 구멍이 없다. 실서버(IS_LOCAL_PREVIEW가
  // 아님)에서 trap.trigger가 실패하면 — 위치 앵커 레이스로 인한 정당한 INVALID_MOVE든, 진짜
  // 네트워크 장애든 — 폴백하지 않고 "이번 칸은 판정 실패"로 안전하게 처리한다. 폴백을 타면
  // 스폰형 함정(설치자가 없어 myTraps엔 없음)을 조용히 "함정 없음"으로 삼켜버리는 문제가
  // 있었다(실서버 QA 2026-07-13/14, "함정이 안 보이거나 밟아도 안 먹힌다").
  private async reportPosition(x: number, y: number) {
    try {
      return await this.trapDispatcher.enqueue(() =>
        trpc.trap.trigger.mutate({ mapId: MAP_ID, x, y })
      );
    } catch (err) {
      if (!IS_LOCAL_PREVIEW) {
        console.error('trap.trigger 실패(실서버 환경) — 로컬 폴백 안 함, 이번 칸은 판정 실패로 처리', err);
        return { hit: false };
      }

      console.error('trap.trigger 실패(백엔드 없음) — 로컬 함정 목록으로 직접 판정', err);
      const localTrap = this.myTraps.find((t) => t.x === x && t.y === y);
      if (!localTrap) return { hit: false };

      // 실서버의 "설치자 본인은 회피"(trpc.ts trap.trigger, installerId 비교)를 로컬 폴백에서도
      // 재현 — selfInstalledTrapKeys 참고.
      if (this.selfInstalledTrapKeys.has(`${x},${y}`)) return { hit: false };

      return { hit: true, type: localTrap.type };
    }
  }

  // 방금 도착한 칸에 설치형 함정이 있는지 서버에만 확인하는 순수 조회 함수 — 상태(isMoving,
  // shieldCount, 화면 이펙트)는 전혀 건드리지 않는다. 결과 적용/쉴드 소모/isMoving 해제는
  // resolveArrival이 미스터리 박스 판정(fetchItemEncounter)과 함께 모아서 한 곳에서 처리한다
  // (같은 타일에 설치형 함정과 미스터리 박스가 동시에 존재할 수 있어 — traps.md 0절 — 두 판정을
  // 따로따로 즉시 적용하면 어느 쪽 응답이 먼저 오느냐에 따라 결과가 달라지는 레이스가 있었음).
  private async fetchTrapTrigger(x: number, y: number): Promise<TrapType | null> {
    const result = await this.reportPosition(x, y);
    return result?.hit && result.type ? result.type : null;
  }

  // 함정을 밟았을 때 캐릭터 색을 잠깐 바꿔서 "뭔가 발동했다"는 걸 보여주는 간단한 이펙트.
  // 이전에 걸어둔 clearTint 타이머가 아직 안 끝났으면 취소하고 새로 건다 — 안 그러면 200ms
  // 안에 색이 다른 효과를 연달아 밟았을 때, 먼저 걸린 타이머가 나중 색을 조기에 지워버린다.
  private flashPlayer(color: number) {
    this.playerImg.setTint(color);
    this.clearTintTimer?.remove();
    this.clearTintTimer = this.time.delayedCall(200, () => {
      this.playerImg.clearTint(); // 원래 이미지 색으로 복귀
    });
  }

  // 캐릭터 이미지를 바꾸고, 그 텍스처 기준으로 "쉬는 상태" 스케일(playerBaseScaleX/Y)도 같이
  // 갱신한다. 함정별 원본 이미지 크기가 서로 달라서 setDisplaySize로 매번 크기를 다시 맞춰야
  // 하는데, 이때 playerBaseScaleX/Y를 안 갱신하면 이 함정 텍스처가 떠 있는 동안 걷기
  // 트윈(animatePlayerStep)이 이전 텍스처 기준 배율을 써서 캐릭터가 살짝 찌그러져 보인다 —
  // 항상 "지금 화면에 보이는 텍스처" 기준으로 걷기 트윈이 동작하도록 여기서 같이 맞춰준다.
  // 걷기 스쿼시 트윈을 먼저 멈추는 이유: 시야차단/역방향처럼 몇 초씩 지속되는 효과가 끝나서
  // 텍스처가 원복되는 시점은 이동과 무관한 고정 시각이라, 그 순간 이 트윈이 아직 돌고 있을
  // 수 있다 — 트윈을 안 멈추고 두면 이후 프레임에도 계속 scaleX/scaleY를 자기 값으로
  // 덮어써서, 지금 막 맞춘 크기가 곧바로 다시 틀어져 버린다.
  private setPlayerTexture(key: string) {
    this.walkBobTween?.stop();
    this.playerImg.setTexture(key).setDisplaySize(PLAYER_DISPLAY_SIZE, PLAYER_DISPLAY_SIZE);
    this.playerBaseScaleX = this.playerImg.scaleX;
    this.playerBaseScaleY = this.playerImg.scaleY;
  }

  // 지금 화면에 어떤 캐릭터 이미지를 보여줘야 하는지 다시 계산해서 반영한다 — 슬라이드 중이면
  // 무조건 슬라이드 이미지가 최우선(슬라이드는 activeTrapEffects에 안 들어가고 isSliding으로
  // 관리), 아니면 activeTrapEffects 중 "가장 늦게 끝나는" 효과의 이미지를 보여주고, 활성
  // 효과가 하나도 없으면 평상시 모습으로 되돌린다. 함정 효과 시작/종료(flashPlayerTrap의
  // 타이머, applySlideTrap/slideStep의 시작·종료 지점, checkGoalReached)에서 항상 이 함수를
  // 거쳐야 "지금 활성 중인 효과와 화면이 어긋나는" 문제가 안 생긴다.
  private refreshPlayerTrapVisual() {
    if (this.isSliding) {
      this.setPlayerTexture(PLAYER_TRAP_TEXTURE_KEYS.slow);
      return;
    }

    let latestType: TimedTrapType | undefined;
    let latestExpireAt = -Infinity;
    for (const [type, expireAt] of this.activeTrapEffects) {
      // 만료 시각이 정확히 같으면(같은 durationMs를 가진 서로 다른 함정을 짧은 간격으로
      // 걸었을 때 우연히 겹칠 수 있음) >= 를 써서 더 나중에 건 효과가 이기게 한다 — 단순 >
      // 이면 먼저 등록된 쪽이 항상 이겨서, 나중에 건 효과의 이미지가 활성 기간 내내 한 번도
      // 안 보이는 문제가 있었다.
      if (expireAt >= latestExpireAt) {
        latestExpireAt = expireAt;
        latestType = type;
      }
    }

    this.setPlayerTexture(latestType ? PLAYER_TRAP_TEXTURE_KEYS[latestType] : PLAYER_TEXTURE_KEY);
  }

  // 함정 종류별로 flashPlayer(색 틴트)에 더해 캐릭터 이미지 자체를 그 함정을 상징하는 그림으로
  // durationMs 동안 바꾼다 — 틴트 색만으로는 어떤 함정에 걸렸는지 직관적으로 안 와닿는다는 점을
  // 보완. durationMs는 그 함정의 실제 효과 지속시간과 맞춰서 넘겨야 한다(예: 시야차단은
  // BLIND_DURATION_MS) — 그래야 "효과가 지속되는 동안 캐릭터도 유지"된다. 슬라이드처럼 지속
  // 시간이 고정돼있지 않은 경우는 이 함수 대신 isSliding/refreshPlayerTrapVisual을 효과
  // 시작/종료 시점에 직접 호출한다(applySlideTrap/slideStep 참고).
  //
  // 지속시간이 끝나기 전에 같은(또는 다른) 함정을 다시 밟아도 activeTrapEffects에 각자 자기
  // 만료 시각으로 따로 기록되고, refreshPlayerTrapVisual이 그중 가장 늦게 끝나는 효과를
  // 계속 보여주므로, 먼저 건 효과가 아직 안 끝났는데 캐릭터가 먼저 원래대로 돌아와버리는
  // 문제가 안 생긴다(예전엔 카운터 하나로 "마지막에 뭘 걸었는지"만 봐서, 나중에 건 효과가
  // 먼저 끝나버리면 그 타이머가 캐릭터를 조기에 원복시켰음).
  // onExpire는 시야차단/역방향처럼 "캐릭터 이미지 말고 실제 게임 효과"도 같이 지속시간을
  // 갖는 경우, 그 효과를 복원하는 로직을 넘겨받아 이 함수의 재트리거 판정과 정확히 같은
  // 타이밍에 함께 실행한다(applyBlindTrap/applyReverseTrap 참고). 처음엔 이걸 "만료 시각을
  // 반환해서 호출자가 자기 타이머를 따로 걸게" 하는 방식으로 만들었는데, 그러면 이 함수
  // 내부 타이머와 호출자 타이머가 같은 durationMs로 각자 독립적으로 예약되어 거의 동시에
  // 실행되고, 어느 쪽이 먼저 activeTrapEffects에서 키를 지우느냐에 따라 나중 것이 "이미
  // 지워졌다"고 오판하는 경쟁 상태가 있었다 — 타이머를 하나로 합쳐야 근본적으로 안전하다.
  private flashPlayerTrap(type: TimedTrapType, durationMs: number, onExpire?: () => void) {
    this.flashPlayer(TRAP_COLORS[type]);
    const expireAt = this.time.now + durationMs;
    // 만료 시각이 다른 효과와 정확히 같아지는 경우(refreshPlayerTrapVisual의 동점 처리 참고)
    // "가장 최근에 건" 효과가 이기게 하려면, Map의 순서(iteration order)가 항상 최신 트리거
    // 순서를 따라야 한다. Map.set()은 이미 있는 키의 값만 바꿀 뿐 순서는 안 바꾸므로, 같은
    // 종류를 다시 밟아 재트리거하는 경우에도 순서가 갱신되도록 먼저 delete한 뒤 다시 set한다.
    this.activeTrapEffects.delete(type);
    this.activeTrapEffects.set(type, expireAt);
    this.refreshPlayerTrapVisual();

    this.time.delayedCall(durationMs, () => {
      // 그 사이 같은 종류가 다시 발동해서 만료 시각이 갱신됐으면(더 나중 시각), 이 타이머는
      // 오래된 것이니 아무것도 하지 않는다 — 갱신된 타이머가 나중에 알아서 지운다.
      if (this.activeTrapEffects.get(type) === expireAt) {
        this.activeTrapEffects.delete(type);
        this.refreshPlayerTrapVisual();
        onExpire?.();
      }
    });
  }

  // item.pickup을 호출해 서버에 픽업을 기록하고 실제로 주웠는지 응답을 받는다(다른 유저가
  // 먼저 주웠으면 picked:false). reportPosition과 동일한 이유로 실패 시 로컬 remainingItems
  // 목록으로 직접 판정하는 폴백을 둔다. itemDispatcher로 직렬화하는 이유는 trapDispatcher와
  // 동일 — 다른 칸끼리의 item.pickup 응답 순서가 역전되면 위치 앵커 검증에서 정상 이동이
  // INVALID_MOVE로 오판정될 수 있다(itemDispatcher 선언부 주석 참고).
  private async reportItemPickup(x: number, y: number): Promise<ItemPickupOutput> {
    try {
      return await this.itemDispatcher.enqueue(() =>
        trpc.item.pickup.mutate({ mapId: MAP_ID, x, y })
      );
    } catch (err) {
      if (!IS_LOCAL_PREVIEW) {
        // reportPosition 주석 참고 — 실서버에서 나는 에러는(위치 앵커 레이스로 인한 정당한
        // 거부든, 진짜 네트워크 장애든) 로컬 폴백으로 감싸지 않는다. 감싸버리면 서버 보드엔
        // 그대로 남아있는 박스를 클라이언트가 가짜로 "주웠다"고 판단해 마커를 지워버리는
        // 영구적인 클라/서버 상태 불일치가 생긴다.
        console.error('item.pickup 실패(실서버 환경) — 로컬 폴백 안 함, 이번 칸은 픽업 실패로 처리', err);
        return { picked: false };
      }

      console.error('item.pickup 실패(백엔드 없음) — 로컬 아이템 목록으로 직접 판정', err);
      const localItem = this.remainingItems.find((item) => item.x === x && item.y === y);
      if (!localItem) return { picked: false };

      // 2026-07-12: 서버가 미스터리 박스로 바뀌며 outcome:'item'|'trap' 판정이 추가됐지만,
      // 로컬 폴백은 실제 확률 풀(gameConfig.ts MYSTERY_BOX_OUTCOME_POOL)을 재현하지 않고
      // 기존처럼 TEMP_ITEMS에 박아둔 고정 타입을 outcome:'item'으로 그대로 반환한다 — 백엔드
      // 없는 환경에서 픽업 배선 자체가 동작하는지 확인하는 용도라, 8종 확률 재현은 스코프 밖
      // (실제 확률/함정 결과 테스트는 trpc.test.ts가 담당).
      return { picked: true, outcome: 'item', type: localItem.type ?? 'flashlight' };
    }
  }

  // 지나온 칸을 발자국 큐에 쌓아둔다(즉시 전송하지 않음). 실제 전송은 flushFootprints가
  // 주기적으로 처리 — trap.trigger/item.pickup과 매 칸 겹쳐서 요청이 늘어나는 걸 막기 위함.
  private queueFootprint(x: number, y: number) {
    this.pendingFootprints.push({ x, y });

    // 방금 도착한 칸에 다른 유저 발자국 마커가 떠 있었다면 지운다(2026-07-13) — 이미 직접
    // 밟아서 안개도 걷힌 칸이라 "누가 여기 지나갔다"는 표시가 더 이상 새로운 정보가 아님.
    this.footprintRects[y]?.[x]?.destroy();
    if (this.footprintRects[y]) this.footprintRects[y]![x] = undefined;
  }

  // pendingFootprints에 쌓인 좌표를 한 번의 요청으로 서버에 기록한다(map.getState가 다음
  // 세션에 반환하는 공유 발자국 목록에 반영되어 다른 유저에게도 보임). 실패해도 현재 게임
  // 진행과는 무관한 부가 기능이라 trap/item처럼 로컬 폴백을 두지 않고 로그만 남긴다.
  private async flushFootprints() {
    if (this.pendingFootprints.length === 0) return;

    const tiles = this.pendingFootprints;
    this.pendingFootprints = [];

    try {
      await trpc.footprint.record.mutate({ mapId: MAP_ID, tiles });
    } catch (err) {
      console.error('footprint.record 실패', err);
    }
  }

  // 방금 도착한 칸에 아직 안 주운 미스터리 박스가 있는지 서버에만 확인하는 순수 조회 함수.
  // 2026-07-12: 서버가 미스터리 박스로 재설계되며 응답이 outcome:'item'|'trap' 판별 유니언이
  // 됐다 — outcome을 먼저 안 보고 type만으로 분기하면 outcome:'trap'(전체 결과의 절반)일 때
  // 어떤 type도 안 걸려 마지막 else(함정 설치 아이템)로 잘못 빠지는 버그가 있었다(develop의
  // 미스터리 박스 서버 구현과 main의 클라이언트가 별도로 진행되다 병합 시 발견).
  // 아이템 목록/마커 제거(remainingItems, itemRects)는 isMoving·shieldCount와 무관한 순수 부기라
  // 여기서 바로 처리한다 — 실제 함정/아이템 이펙트 적용과 isMoving/shieldCount 관리는
  // resolveArrival이 fetchTrapTrigger 결과와 함께 모아서 한 곳에서 처리한다(fetchTrapTrigger
  // 주석 참고 — 같은 타일에 설치형 함정과 미스터리 박스가 동시에 존재할 수 있음).
  //
  // 2026-07-14 실서버 QA(아이템이 한참 뒤에야 먹힘): itemDispatcher(직렬화 큐)가 모든 칸마다
  // 요청을 넣다 보니, 연속 이동 중 네트워크 지연이 있으면 요청이 계속 밀려 쌓였다. remainingItems
  // 는 map.getState가 이미 공개적으로 내려준 "아직 안 주운 박스 좌표" 목록(박스는 마커로 항상
  // 표시되므로 위치 자체는 비밀이 아님 — outcome/type만 비밀)이라, 이 목록에 없는 칸이면
  // item.pickup 요청 자체를 생략해도 오라클 방지를 해치지 않는다. 박스는 맵에 몇 곳뿐이라
  // 대부분의 이동에서 요청이 아예 안 나가 큐가 밀릴 일이 없어진다. 함정 쪽은 상대가 몰래 설치한
  // 함정일 수 있어 이 최적화를 적용할 수 없다(모든 칸에서 서버 확인이 필수 — trap.trigger는
  // 그대로 둠).
  private async fetchItemEncounter(x: number, y: number): Promise<ItemEncounter> {
    if (!this.remainingItems.some((item) => item.x === x && item.y === y)) {
      return { kind: 'none' };
    }

    const result = await this.reportItemPickup(x, y);
    if (!result.picked) return { kind: 'none' };

    this.remainingItems = this.remainingItems.filter((item) => !(item.x === x && item.y === y));
    this.itemRects[y]![x]?.destroy();
    this.itemRects[y]![x] = undefined;

    if (result.outcome === 'trap') return { kind: 'trap', type: result.type };
    return { kind: 'item', type: result.type };
  }

  // tryMove가 한 칸 이동을 마친 뒤 호출하는 유일한 판정 지점. 설치형 함정(fetchTrapTrigger)과
  // 미스터리 박스(fetchItemEncounter)를 Promise.all로 병렬 조회한 뒤, 두 응답이 모두 도착한
  // 다음에야 쉴드 소모/함정 이펙트 적용을 한 곳에서 처리한다 — 예전엔 두 함수가 각자 독립적으로
  // isMoving과 shieldCount를 건드려서, 어느 쪽 응답이 먼저 오느냐에 따라 결과가 달라지는 레이스가
  // 있었다(2026-07-13 코드 리뷰로 발견). dx, dy는 함정 결과가 슬라이드일 때 미끄러질 방향.
  //
  // isMoving은 더 이상 여기서 다루지 않는다(조작감 개선, 2026-07-13) — tryMove의 트윈 완료
  // 시점에 이미 풀렸고, 이 함수는 그보다 늦게(네트워크 응답 도착 후) 실행되므로 이미 다음
  // 이동이 진행 중일 수 있다. respawn/slow처럼 위치·트윈에 개입하는 효과는 각자
  // (applyRespawnTrap/applySlideTrap) killTweensOf로 진행 중인 이동을 이기고 스스로 상태를
  // 정리한다.
  // 2026-07-13(임소리): 아이템 적용부는 즉시 발동 대신 인벤토리 슬롯에 채우는 방식(addHeldItem)
  // 으로 바꿈 — 쉴드만 예외(반응형이라 즉시 무장이 항상 이득, applyShieldItem 직접 호출 유지).
  private async resolveArrival(x: number, y: number, dx: number, dy: number) {
    // 이번 이동 "시작 시점"의 쉴드 보유 개수 스냅샷 — 이 판정 도중 새로 주운 쉴드(아래
    // outcome:'item' && type:'shield')가 같은 이동의 함정 판정에 소급 적용되지 않게 한다.
    const shieldCountBeforeMove = this.shieldCount;

    const [installedTrapType, itemEncounter] = await Promise.all([
      this.fetchTrapTrigger(x, y),
      this.fetchItemEncounter(x, y),
    ]);

    const mysteryTrapType = itemEncounter.kind === 'trap' ? itemEncounter.type : null;
    const resolution = resolveTrapEncounters(installedTrapType, mysteryTrapType, shieldCountBeforeMove > 0);

    // items.md: 쉴드는 반응형 1회 소모 — 설치형/미스터리 박스 함정이 동시에 걸려도 한 번만
    // 소모되고, 우선순위(기본: 설치형)에 따라 둘 중 하나만 무효화된다(resolveTrapEncounters 참고).
    // 여러 개를 들고 있었으면 1개만 깎이고 나머지는 그대로 남는다(2026-07-14 쉴드 스택 버그 수정
    // — 예전엔 boolean이라 몇 개를 들고 있었든 한 번 막으면 전부 사라졌음).
    if (resolution.shieldConsumedFor) {
      this.shieldCount -= 1;
      this.showShieldBlockEffect();
      if (this.shieldCount <= 0) {
        this.shieldRing?.destroy();
        this.shieldRing = null;
        this.shieldIcon?.destroy();
        this.shieldIcon = null;
        this.shieldCountBadgeBg?.destroy();
        this.shieldCountBadgeBg = null;
        this.shieldCountLabel?.destroy();
        this.shieldCountLabel = null;
      } else {
        this.refreshShieldCountLabel();
      }
    }

    // 슬라이드보다 순간 효과(respawn/blind/reverse)를 먼저 적용한다 — respawn이 위치 자체를
    // 스폰으로 되돌리므로, 슬라이드가 끝난 자리를 나중에 respawn이 덮어써서 위치가 튀는 상황을
    // 피하기 위함.
    for (const type of resolution.effectsToApply) {
      if (type === 'slow') continue;
      else if (type === 'respawn') this.applyRespawnTrap();
      else if (type === 'blind') this.applyBlindTrap();
      else this.applyReverseTrap();
    }

    if (itemEncounter.kind === 'item') {
      // 서버(shared/game-types.ts ItemType)는 'trapInstall'을 반환할 일이 없다 — 로컬 폴백
      // (reportItemPickup의 catch, TEMP_ITEMS 기반)에서만 나오는 클라이언트 전용 값이라 마지막
      // else로 잡는다. 'detector'를 명시적으로 분기하지 않으면 이 else가 실수로 삼켜서 함정
      // 설치 아이템으로 오판정되는 버그가 있었음(2026-07-10 발견).
      if (itemEncounter.type === 'detector') {
        // 반경 계산은 여기서 하지 않는다 — 서버가 충전(사용 가능 횟수)만 1 늘려두고, 실제
        // 스캔은 Z를 눌러 쓰는 순간 item.useDetector가 그 자리 기준으로 새로 한다.
        this.addHeldItem({ type: 'detector' });
      } else if (itemEncounter.type === 'shield') {
        // 함정이 안 보이는 게임이라 "언제 쓸지" 고를 방법이 없다 — 슬롯에 미루지 않고 줍는
        // 즉시 무장(applyLoadout과 동일한 이유).
        this.applyShieldItem();
      } else if (itemEncounter.type === 'flashlight') {
        this.addHeldItem({ type: itemEncounter.type });
      } else {
        // items.md 스펙: 함정 종류는 "줍는 순간" 랜덤 결정 — Z로 쓰는 시점이 아니라 여기서
        // 뽑아둔다. 슬롯(Z)에 넣되, Z를 누르면 "장전"이 아니라 그 즉시 그 자리에 바로 설치까지
        // 끝나도록 함(attemptInstall 참고) — 조작키를 Z/X 두 개로 통일하기 위해 Ctrl을 없앰.
        this.addHeldItem({
          type: 'trapInstall',
          trapType: TRAP_TYPES[Math.floor(Math.random() * TRAP_TYPES.length)]!,
        });
      }
    }

    if (resolution.effectsToApply.includes('slow')) {
      this.applySlideTrap(dx, dy); // 슬라이드는 killTweensOf로 진행 중인 이동을 이기고 스스로 다시 잠금
    }
  }

  // 캐릭터 머리 위에 짧은 안내 텍스트를 잠깐 띄우는 말풍선. 위로 떠오르면서 사라지는
  // 트윈 하나로 구현. 아이템 획득/함정 설치 성공·실패 안내에 공용으로 재사용.
  private showFloatingLabel(text: string) {
    const label = this.add
      .text(this.playerImg.x, this.playerImg.y - TILE_SIZE * 0.6, text, {
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#00000099',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(20);

    // 맵 가장자리 근처(예: 함정 설치 아이템 스폰 x:23, 맵 폭 25칸 중 우측 끝)에서 텍스트
    // 뒷부분이 화면 밖으로 잘려 안 보이던 문제(2026-07-13 QA 발견, PR #47/#48에서 각자 독립적
    // 으로 동일하게 수정 — 병합 충돌 정리하며 아래쪽(안전장치 포함) 버전으로 통일) — 카메라가
    // 캐릭터를 따라다니되(setBounds) 맵 가장자리에서는 더 스크롤할 수 없어서, 캐릭터가 뷰포트
    // 중앙이 아니라 가장자리 쪽으로 몰릴 때 라벨 폭만큼 카메라가 지금 보여주는 영역(worldView)
    // 밖으로 넘어갈 수 있다. 라벨 전체가 항상 그 안에 들어오도록 x를 클램프한다.
    const worldView = this.cameras.main.worldView;
    const halfWidth = label.displayWidth / 2 + 4;
    const minX = worldView.left + halfWidth;
    const maxX = worldView.right - halfWidth;
    if (minX <= maxX) {
      label.x = Phaser.Math.Clamp(label.x, minX, maxX);
    }

    // 예전엔 뜨자마자 바로 알파도 같이 줄어들어서 다 읽기 전에 흐려지기 시작했다(2026-07-11
    // 임소리 피드백). holdMs 동안은 알파를 그대로 유지해 읽을 시간을 확보하고, 그 뒤 fadeMs
    // 동안만 사라지게 y 이동/알파 트윈을 분리했다.
    const holdMs = 900;
    const fadeMs = 600;

    this.tweens.add({
      targets: label,
      y: label.y - TILE_SIZE * 0.5,
      duration: holdMs + fadeMs,
    });

    this.tweens.add({
      targets: label,
      alpha: 0,
      delay: holdMs,
      duration: fadeMs,
      onComplete: () => label.destroy(),
    });
  }

  // 픽업/설치/함정 발동 시 짧게 퍼졌다 사라지는 원형 이펙트 공통 헬퍼. 손전등 버스트, 쉴드 팝,
  // 탐지기 스캔 펄스, 함정 설치 쿵, 리스폰 소멸/생성 이펙트가 전부 "원을 만들고 커지거나
  // 작아지며 사라진다"는 같은 모양이라 하나로 뽑았다(2026-07-12, 코드 리뷰 피드백 반영 —
  // 예전엔 이 6곳이 거의 같은 코드를 조금씩 다르게 복붙하고 있었음). 옵션은 필요한 것만
  // 넘기면 되고 나머지는 기본값을 쓴다.
  //
  // endScale이냐 endRadius냐: 기본은 setScale로 통째로 확대/축소하는 endScale인데, 이러면
  // 테두리(strokeWidth)도 같이 두꺼워진다(원 전체가 그 비율로 커지므로) — 대부분의 이펙트는
  // 배율이 1.6~2배라 티가 안 나지만, 탐지기 스캔 펄스처럼 배율이 훨씬 크면(0.2칸→3칸, 15배)
  // 얇던 링이 두꺼운 원반처럼 보여버린다(2026-07-12 리뷰에서 발견). 이런 경우 endRadius를
  // 대신 지정하면 실제 반지름(geometry)만 늘어나고 테두리 두께는 그대로 유지된다.
  private spawnPulseEffect(
    x: number,
    y: number,
    opts: {
      radius: number;
      color: number;
      fillAlpha?: number; // 기본 0(테두리만 있는 링 모양) — 채워진 원이면 지정
      strokeWidth?: number; // 지정하면 테두리도 그림
      strokeColor?: number; // 기본값: color와 동일
      strokeAlpha?: number; // 기본 0.9
      startScale?: number; // 기본 1(원래 크기에서 시작)
      startAlpha?: number; // 기본 1
      endScale?: number; // endRadius와 둘 중 하나만 지정(둘 다 안 주면 크기 변화 없음)
      endRadius?: number; // 테두리 두께를 유지하며 반지름 자체를 늘리고 싶을 때
      endAlpha?: number; // 기본 0
      duration: number;
      depth?: number; // 기본 9(캐릭터 depth 10 바로 아래)
      additive?: boolean; // true면 가산 블렌드(겹칠수록 밝아지는 빛 느낌)
    }
  ) {
    const circle = this.add.circle(x, y, opts.radius, opts.color, opts.fillAlpha ?? 0);
    if (opts.strokeWidth) {
      circle.setStrokeStyle(opts.strokeWidth, opts.strokeColor ?? opts.color, opts.strokeAlpha ?? 0.9);
    }
    if (opts.additive) circle.setBlendMode(Phaser.BlendModes.ADD);
    circle.setDepth(opts.depth ?? 9);
    if (opts.startScale !== undefined) circle.setScale(opts.startScale);
    if (opts.startAlpha !== undefined) circle.setAlpha(opts.startAlpha);

    this.tweens.add({
      targets: circle,
      ...(opts.endRadius !== undefined ? { radius: opts.endRadius } : { scale: opts.endScale ?? 1 }),
      alpha: opts.endAlpha ?? 0,
      duration: opts.duration,
      onComplete: () => circle.destroy(),
    });
  }

  // 쉴드가 함정을 막아줬을 때 캐릭터를 감싸는 원형 이펙트 — 하얀 테두리 + 옅은 하늘색
  // 원이 커지면서 투명해지는 트윈으로 "보호막이 퍼졌다 사라지는" 느낌을 냄.
  private showShieldBlockEffect() {
    this.playSfx('shieldBlock');
    this.spawnPulseEffect(this.playerImg.x, this.playerImg.y, {
      radius: TILE_SIZE * 0.35,
      color: 0xbfffff,
      fillAlpha: 0.5,
      strokeWidth: 3,
      strokeColor: 0xffffff,
      endScale: 2,
      duration: 500,
      depth: 15,
    });

    // 카메라 펀치 — 링 이펙트만으로는 "막았다"는 임팩트가 약하다는 피드백(2026-07-14)으로
    // 추가. 살짝 확대했다가 원래 배율(1, 카메라 줌은 이 파일에서 여기 말고는 안 건드림)로
    // 되돌아오는 짧은 트윈. 진행 중인 줌 트윈이 있으면 먼저 죽여서, 연속으로 빠르게 함정을
    // 막았을 때 배율이 1을 기준으로 계속 누적되는 것을 방지한다(항상 절대값 1↔1.06로만 왕복).
    this.tweens.killTweensOf(this.cameras.main);
    this.cameras.main.zoom = 1;
    this.tweens.add({
      targets: this.cameras.main,
      zoom: 1.06,
      duration: 90,
      yoyo: true,
      ease: 'Sine.easeOut',
    });
  }

  // 손전등 — items.md: 시야 반경 2→4칸, 8초 후 원래대로 복귀.
  // 시야차단 함정(applyBlindTrap)과 반경을 같이 조작한다. 둘이 겹치면(예: 손전등 유지 중
  // 시야차단 함정을 밟는 경우) 시야차단 함정 쪽이 즉시 우선 적용되도록 함 — 손전등 덕분에
  // 함정 페널티가 무력화되면 안 되므로 이게 의도한 동작(2026-07-09 임소리 확인). 다만 시야차단
  // 효과가 끝난 뒤 손전등의 남은 지속시간이 복원되지 않고 기본값으로 돌아가는 것도 지금은
  // 의도한 단순화 — 팀 플레이테스트 피드백 있으면 재검토.
  private applyFlashlightItem() {
    this.playSfx('itemPickup');
    this.showFloatingLabel(`${ITEM_LABELS.flashlight} activated!`);
    this.flashPlayer(ITEM_COLORS.flashlight);
    this.currentVisionRadius = FLASHLIGHT_VISION_RADIUS;
    this.updateFog();

    // 픽업 순간 훅 퍼지는 버스트 — "빛이 확 켜졌다"는 느낌. 가산 블렌드(ADD)로 빛이 겹칠수록
    // 더 밝아지게 해서 반짝이는 인상을 준다.
    this.spawnPulseEffect(this.playerImg.x, this.playerImg.y, {
      radius: TILE_SIZE * 0.3,
      color: ITEM_COLORS.flashlight,
      fillAlpha: 0.6,
      additive: true,
      endScale: 3,
      duration: 400,
    });

    // 지속시간 내내 캐릭터를 은은하게 감싸는 글로우 — "지금 손전등이 켜져있다"를 계속 보여줌.
    // 재트리거(아래 만료 타이머 갱신)여도 이미 떠있는 글로우는 재사용하고 새로 만들지 않는다.
    if (!this.flashlightGlow) {
      this.flashlightGlow = this.add.circle(
        this.playerImg.x,
        this.playerImg.y,
        TILE_SIZE * 0.9,
        ITEM_COLORS.flashlight,
        0.18
      );
      this.flashlightGlow.setBlendMode(Phaser.BlendModes.ADD);
      this.flashlightGlow.setDepth(9);
    }

    // 지속시간이 끝나기 전에 손전등을 한 번 더 주우면(맵에 여러 개 스폰될 수 있음), 먼저
    // 걸린 타이머는 자기가 만료 시각을 갱신할 때 저장해둔 값과 지금 값이 다르면(=더 최신
    // 손전등이 그 사이 갱신했으면) 아무것도 하지 않는다 — applyBlindTrap/applyReverseTrap과
    // 동일한 재트리거 보호 패턴.
    const expireAt = this.time.now + FLASHLIGHT_DURATION_MS;
    this.flashlightExpireAt = expireAt;
    this.time.delayedCall(FLASHLIGHT_DURATION_MS, () => {
      if (this.flashlightExpireAt === expireAt) {
        this.currentVisionRadius = VISION_RADIUS;
        this.updateFog();
        this.flashlightGlow?.destroy();
        this.flashlightGlow = null;
      }
    });
  }

  // 함정 무효화(쉴드) — items.md: 반응형. 주우면 바로 발동하는 게 아니라 보유 상태로만
  // 바뀌고, 실제 효과는 다음 함정을 밟는 순간(resolveArrival)에 소모되며 적용됨.
  private applyShieldItem() {
    this.playSfx('itemPickup');
    this.shieldCount += 1;
    this.showFloatingLabel(
      this.shieldCount > 1 ? `${ITEM_LABELS.shield} acquired! (x${this.shieldCount})` : `${ITEM_LABELS.shield} acquired!`
    );
    this.flashPlayer(ITEM_COLORS.shield);

    // 픽업 순간 짧은 팝 — showShieldBlockEffect(소모될 때 터지는 큰 링)보다 작고 빠르게 해서
    // "장착됐다"와 "막아줬다"를 구분되게 한다.
    this.spawnPulseEffect(this.playerImg.x, this.playerImg.y, {
      radius: TILE_SIZE * 0.25,
      color: 0xbfffff,
      fillAlpha: 0.7,
      strokeWidth: 2,
      strokeColor: 0xffffff,
      endScale: 1.6,
      duration: 300,
    });

    // 보유 중임을 계속 보여주는 얇은 링. 이미 보유 중(재트리거)이면 새로 만들지 않는다.
    if (!this.shieldRing) {
      this.shieldRing = this.add.circle(this.playerImg.x, this.playerImg.y, TILE_SIZE * 0.38, 0x000000, 0);
      this.shieldRing.setStrokeStyle(2, 0xbfffff, 0.8);
      this.shieldRing.setDepth(9);
    }

    // 머리 위 쉴드 아이콘 — 슬롯 UI와 같은 png를 재사용. 이미 떠 있으면(재트리거) 새로
    // 만들지 않는다.
    if (!this.shieldIcon) {
      this.shieldIcon = this.add
        .image(this.playerImg.x, this.playerImg.y - TILE_SIZE * 0.55, ITEM_SLOT_TEXTURE_KEYS.shield)
        .setDisplaySize(TILE_SIZE * 0.4, TILE_SIZE * 0.4)
        .setDepth(11); // 캐릭터(depth 10) 위에 떠 보이게
    }

    this.refreshShieldCountLabel();
  }

  // 쉴드 개수 배지(원형 + 숫자)를 만들거나 갱신한다 — 1개 이하면 굳이 안 보여준다(아이콘
  // 자체가 "보유 중"은 이미 표시해줌, 개수가 여럿일 때만 추가 정보로 의미가 있음). 2026-07-14:
  // 실플레이 QA에서 "잘 눈에 안 띈다"는 피드백으로 한 차례 대비를 키웠는데(파란 사각 태그),
  // 이후 "shieldRing/shieldIcon의 시안색 톤과 안 어울린다"는 디자인 피드백으로 알림 배지
  // 느낌의 원형(shieldCountBadgeBg, shieldRing과 같은 시안 테두리)으로 재교체 — 텍스트도
  // "x2" 대신 숫자만 남겨 좁은 원 안에서 더 깔끔하게 보이도록 함.
  private refreshShieldCountLabel() {
    if (this.shieldCount <= 1) {
      this.shieldCountBadgeBg?.destroy();
      this.shieldCountBadgeBg = null;
      this.shieldCountLabel?.destroy();
      this.shieldCountLabel = null;
      return;
    }

    const text = String(this.shieldCount);
    if (this.shieldCountLabel && this.shieldCountBadgeBg) {
      this.shieldCountLabel.setText(text);
      const punch = { duration: 120, yoyo: true, ease: 'Sine.easeOut' as const };
      this.tweens.add({
        targets: this.shieldCountBadgeBg,
        scale: (_target: Phaser.GameObjects.Arc, _key: string, value: number) => value * 1.35,
        ...punch,
      });
      this.tweens.add({
        targets: this.shieldCountLabel,
        scale: (_target: Phaser.GameObjects.Text, _key: string, value: number) => value * 1.35,
        ...punch,
      });
      return;
    }

    // 배경 원 — shieldRing과 같은 시안 테두리로 통일해 같은 아이템의 UI라는 걸 알 수 있게 함.
    this.shieldCountBadgeBg = this.add.circle(this.playerImg.x, this.playerImg.y, TILE_SIZE * 0.17, 0x0c1a2e, 1);
    this.shieldCountBadgeBg.setStrokeStyle(2, 0xbfffff, 0.9);
    this.shieldCountBadgeBg.setScale(0);
    this.shieldCountBadgeBg.setDepth(12); // shieldIcon(depth 11)보다 위

    this.shieldCountLabel = this.add
      .text(this.playerImg.x, this.playerImg.y, text, {
        fontSize: '13px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScale(0)
      .setDepth(13); // 배경 원보다 위

    this.tweens.add({ targets: [this.shieldCountBadgeBg, this.shieldCountLabel], scale: 1, duration: 180, ease: 'Back.easeOut' });
  }

  // 함정 탐지기 — items.md 초안: 반경 3칸 내 함정을 표시. 반경 필터링은 서버
  // (revealNearbyTraps, DETECTOR_REVEAL_RADIUS)가 이미 끝낸 결과를 넘겨받으므로, 여기서는
  // "받은 좌표에 마커를 얼마나 오래 보여줄지"만 담당한다. myTraps(내가 설치한 함정)와 달리
  // 다른 유저의 함정이라 renderTrapMarkers 계열과 완전히 분리된 배열(revealedTrapMarkers)로
  // 관리 — 표시 시간이 끝나면 흔적 없이 사라져야 하고, 그 사이 실제 함정 판정(trap.trigger)
  // 로직에는 전혀 관여하지 않는 순수 시각 효과다.
  //
  // 2026-07-13: Z로 쓰는 시점(useSelectedItem)에 item.useDetector를 호출해 그 자리 기준으로
  // 매번 새로 스캔한 결과를 넘겨받는다 — 주운 자리 기준 낡은 정보를 보여주거나, 그 사이 다른
  // 유저가 함정을 치워도 반영이 안 되는 문제를 피하기 위함(배영환/임소리 논의로 확정).
  private applyDetectorItem(revealedTraps: TrapInstance[]) {
    // 공용 픽업음(itemPickup) 대신 detectorScan만 재생 — playSfx는 "이벤트 효과음끼리 겹치면
    // 최신 것만 들리게" 직전 소리를 끊는데, 둘을 곧바로 이어서 틀면 itemPickup이 시작하자마자
    // detectorScan한테 끊겨서 실제로는 절대 안 들리는 죽은 호출이 되므로 아예 하나만 남긴다.
    this.showFloatingLabel(`${ITEM_LABELS.detector} activated!`);
    this.flashPlayer(ITEM_COLORS.detector);
    this.playSfx('detectorScan');

    // 탐지 반경만큼 훅 퍼지는 스캔 펄스 — "지금 이 범위를 스캔했다"를 시각적으로 보여준다.
    // endRadius 사용(endScale 아님) — 배율이 15배(0.2칸→3칸)라 스케일로 키우면 테두리까지
    // 15배 두꺼워져서 "얇은 링"이 아니라 "두꺼운 원반"처럼 보이는 문제가 있었다(2026-07-12).
    this.spawnPulseEffect(this.playerImg.x, this.playerImg.y, {
      radius: TILE_SIZE * 0.2,
      color: ITEM_COLORS.detector,
      strokeWidth: 3,
      strokeAlpha: 0.8,
      startAlpha: 0.8,
      endRadius: TILE_SIZE * DETECTOR_SCAN_RADIUS_TILES,
      duration: 500,
    });

    this.clearRevealedTrapMarkers();
    const token = ++this.detectorRevealToken;

    for (const trap of revealedTraps) {
      const cx = trap.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = trap.y * TILE_SIZE + TILE_SIZE / 2;
      const marker = this.add.circle(cx, cy, TILE_SIZE * 0.22, TRAP_COLORS[trap.type], 0.35);
      marker.setStrokeStyle(3, TRAP_COLORS[trap.type], 0.9);
      marker.setDepth(12); // 안개/타일 도형(0~6)보다 위, 손전등 등 나머지 이펙트와 안 겹치는 자리

      // 안개(탐색 여부)와 무관하게 항상 보여야 하므로 updateFog의 알파 조정 대상에 넣지 않고
      // 여기서 직접 깜빡이는 펄스 트윈을 건다 — "위험 신호"처럼 눈에 띄게.
      this.tweens.add({
        targets: marker,
        alpha: { from: 0.9, to: 0.35 },
        duration: 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      this.revealedTrapMarkers.push(marker);
    }

    this.time.delayedCall(DETECTOR_REVEAL_DISPLAY_MS, () => {
      // 그 사이 탐지기를 한 번 더 써서(재사용) 이 타이머는 오래된 것이 됐다면, 새로 표시된
      // 마커를 건드리지 않는다 — 최신 타이머가 알아서 지운다.
      if (this.detectorRevealToken === token) this.clearRevealedTrapMarkers();
    });
  }

  private clearRevealedTrapMarkers() {
    for (const marker of this.revealedTrapMarkers) {
      this.tweens.killTweensOf(marker);
      marker.destroy();
    }
    this.revealedTrapMarkers = [];
  }

  // 슬롯 소켓 하나를 그린다(2026-07-13 재작업) — 바깥 베벨 프레임(위/왼쪽 밝게, 아래/오른쪽
  // 어둡게, "안으로 파인 소켓"처럼 보이게 하는 흔한 UI 베벨 기법) + 안쪽 어두운 소켓. 맵 벽의
  // 절차적 암반 텍스처(buildRockWallTileSvg)와 일부러 다른 차가운 톤을 써서, 맵 안에 파묻힌
  // 벽처럼 보이지 않고 화면에 붙어있는 금속 소켓으로 읽히게 한다.
  private buildItemSlotSocket(x: number, y: number): Phaser.GameObjects.Graphics {
    const half = ITEM_SLOT_SIZE / 2;
    const inset = 6;
    const g = this.add.graphics({ x, y }).setScrollFactor(0).setDepth(30);

    g.fillStyle(ITEM_SLOT_FRAME_COLOR, 1);
    g.fillRect(-half, -half, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE);

    g.lineStyle(3, ITEM_SLOT_FRAME_LIGHT, 1);
    g.beginPath();
    g.moveTo(-half + 1.5, half - 1.5);
    g.lineTo(-half + 1.5, -half + 1.5);
    g.lineTo(half - 1.5, -half + 1.5);
    g.strokePath();

    g.lineStyle(3, ITEM_SLOT_FRAME_DARK, 1);
    g.beginPath();
    g.moveTo(half - 1.5, -half + 1.5);
    g.lineTo(half - 1.5, half - 1.5);
    g.lineTo(-half + 1.5, half - 1.5);
    g.strokePath();

    g.fillStyle(ITEM_SLOT_SOCKET_COLOR, 1);
    g.fillRect(-half + inset, -half + inset, ITEM_SLOT_SIZE - inset * 2, ITEM_SLOT_SIZE - inset * 2);

    return g;
  }

  // heldItems가 바뀔 때마다(습득/사용/전환) 호출해 슬롯 UI를 통째로 다시 그린다. 2026-07-13
  // 재작업: 4칸을 항상 그려두고 내용물만 바꾸던 방식 대신, heldItems 길이만큼만 박스를 새로
  // 만든다("먹을 때마다 박스가 생기는 구조" 피드백) — 최대 4개뿐이라 매번 전부 destroy 후
  // 다시 만들어도 비용 미미. 화면 우측 하단에서 왼쪽으로 채워나간다.
  //
  // popInIndex/punchIndex(2026-07-14 도입) — 매번 통째로 다시 그리는 구조라 "새로 생긴 슬롯"과
  // "그대로 남아있는 슬롯"을 구분할 방법이 없어서, 호출하는 쪽(addHeldItem/cycleSelectedSlot)이
  // 어느 인덱스가 이번에 "새로 생겼는지"/"새로 선택됐는지"를 직접 알려준다. 나머지 슬롯은 평소
  // 처럼 그냥 나타난다(재조회 때마다 매번 팝/펀치가 재생되면 안 되므로).
  private refreshItemSlotsUI(options?: { popInIndex?: number; punchIndex?: number }) {
    // 팝인/펀치 트윈(160~220ms)이 아직 안 끝난 상태에서 또 refresh가 불리면(예: X 연타)
    // 곧바로 destroy될 옛 오브젝트를 계속 건드리는 트윈이 남는다 — 크래시는 안 나지만
    // (destroy된 오브젝트도 평범한 JS 객체라 속성 세팅 자체는 에러 없음) 이 파일의 다른 곳
    // (wallBumpTween?.stop(), killTweensOf(this.playerImg))과 마찬가지로 새로 그리기 전에
    // 이전 트윈부터 정리한다(2026-07-14 셀프 리뷰 반영).
    this.tweens.killTweensOf([
      ...this.itemSlotBgs,
      ...this.itemSlotBorders,
      ...this.itemSlotGlows,
      ...this.itemSlotIcons,
      ...this.itemSlotLabels,
    ]);
    this.itemSlotBgs.forEach((g) => g.destroy());
    this.itemSlotBorders.forEach((r) => r.destroy());
    this.itemSlotGlows.forEach((g) => g.destroy());
    this.itemSlotIcons.forEach((i) => i.destroy());
    this.itemSlotLabels.forEach((l) => l.destroy());
    this.itemSlotSelectionIndicator?.destroy();
    this.itemSlotSelectionIndicator = null;
    this.itemSlotBgs = [];
    this.itemSlotBorders = [];
    this.itemSlotGlows = [];
    this.itemSlotIcons = [];
    this.itemSlotLabels = [];

    const viewportWidth = CAMERA_VIEWPORT_TILES_X * TILE_SIZE;
    const viewportHeight = CAMERA_VIEWPORT_TILES_Y * TILE_SIZE;
    const slotY = viewportHeight - ITEM_SLOT_MARGIN - ITEM_SLOT_SIZE / 2;
    const count = this.heldItems.length;

    this.heldItems.forEach((item, i) => {
      const slotX =
        viewportWidth - ITEM_SLOT_MARGIN - ITEM_SLOT_SIZE / 2 - (count - 1 - i) * (ITEM_SLOT_SIZE + ITEM_SLOT_GAP);
      const selected = i === this.selectedSlotIndex;

      const bg = this.buildItemSlotSocket(slotX, slotY);
      this.itemSlotBgs.push(bg);
      const border = this.add
        .rectangle(slotX, slotY, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 0x000000, 0)
        .setStrokeStyle(selected ? 3 : 2, selected ? 0xffe066 : 0xffffff, selected ? 0.95 : 0.5)
        .setScrollFactor(0)
        .setDepth(32);
      this.itemSlotBorders.push(border);
      // 종류별 색 글로우(가산 블렌드) — 아이콘 자체가 밋밋한 png라 뒤에서 은은하게 빛나게
      // 해서 광택을 더한다(2026-07-13 피드백: "글로우 효과 주고 싶다").
      const glow = this.add
        .circle(slotX, slotY - 2, ITEM_SLOT_SIZE * 0.34, ITEM_COLORS[item.type], 0.55)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScrollFactor(0)
        .setDepth(30.5);
      this.itemSlotGlows.push(glow);
      const icon = this.add
        .image(slotX, slotY - 2, ITEM_SLOT_TEXTURE_KEYS[item.type])
        .setDisplaySize(ITEM_SLOT_SIZE * 0.58, ITEM_SLOT_SIZE * 0.58)
        .setScrollFactor(0)
        .setDepth(31);
      this.itemSlotIcons.push(icon);
      const label = this.add
        .text(slotX, slotY + ITEM_SLOT_SIZE / 2 - 7, ITEM_SLOT_LABELS[item.type], {
          fontSize: '8px',
          color: '#ffffff',
          fontStyle: 'bold',
          backgroundColor: '#00000099',
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(33);
      this.itemSlotLabels.push(label);

      // 선택된 슬롯 하나에만: 테두리 색/두께 차이만으론 눈에 덜 띈다는 피드백(2026-07-14)으로
      // 슬롯 바로 아래에 위쪽을 가리키는 작은 삼각형을 추가로 띄운다. 테두리와 같은 골드 톤.
      if (selected) {
        const indicatorY = slotY + ITEM_SLOT_SIZE / 2 + 8;
        this.itemSlotSelectionIndicator = this.add
          .triangle(slotX, indicatorY, -5, 5, 5, 5, 0, -4, 0xffe066, 1)
          .setScrollFactor(0)
          .setDepth(33);
      }

      // icon은 setDisplaySize()로 이미 원본 텍스처 대비 축소된 scale을 갖고 있어(다른
      // 파츠처럼 "정상 크기 = scale 1"이 아님) — 아래 팝인/펀치 트윈이 다른 파츠와 똑같이
      // "scale: 1"을 목표로 잡으면 icon만 원본 텍스처 크기 그대로 커져버린다(2026-07-14
      // 실플레이 QA로 발견된 버그). 트윈 시작 전 icon의 "정상" scaleX/Y를 미리 저장해두고,
      // icon은 항상 이 값을 기준으로 별도 트윈한다.
      const iconRestScaleX = icon.scaleX;
      const iconRestScaleY = icon.scaleY;

      if (options?.popInIndex === i) {
        // 아이템을 새로 얻어 슬롯이 막 생긴 순간 — 0에서 정상 크기로 팝 인 시키며 살짝
        // 튕기게 해서 "생겨났다"는 느낌을 준다.
        const parts = [bg, border, glow, label];
        parts.forEach((p) => p.setScale(0));
        icon.setScale(0);
        this.tweens.add({ targets: parts, scale: 1, duration: ITEM_SLOT_POP_DURATION_MS, ease: 'Back.easeOut' });
        this.tweens.add({
          targets: icon,
          scaleX: iconRestScaleX,
          scaleY: iconRestScaleY,
          duration: ITEM_SLOT_POP_DURATION_MS,
          ease: 'Back.easeOut',
        });
      } else if (options?.punchIndex === i) {
        // X로 방금 새로 선택된 슬롯 — 테두리/글로우/아이콘이 순간 커졌다 원래 크기로 돌아오며
        // "지금 여기로 바뀌었다"는 걸 강조한다.
        const parts = [border, glow];
        this.tweens.add({
          targets: icon,
          scaleX: iconRestScaleX * 1.25,
          scaleY: iconRestScaleY * 1.25,
          duration: ITEM_SLOT_PUNCH_DURATION_MS / 2,
          yoyo: true,
          ease: 'Sine.easeOut',
        });
        this.tweens.add({
          targets: parts,
          scale: 1.25,
          duration: ITEM_SLOT_PUNCH_DURATION_MS / 2,
          yoyo: true,
          ease: 'Sine.easeOut',
        });
      }
    });
  }

  // 아이템을 인벤토리에 채운다(로드아웃 지급/미스터리 박스 픽업 공용 진입점, 2026-07-13 도입).
  // 예전처럼 즉시 효과를 적용하지 않고 보유만 해서, Z를 눌렀을 때(useSelectedItem) 원하는
  // 타이밍에 쓸 수 있게 한다. ITEM_SLOT_MAX에 도달했으면(로드아웃 1 + 맵당 스폰 3곳을 전부
  // 아이템으로 얻어야 하는 이론적 상한 케이스) 획득에 실패한 것으로 처리 — 상한을 늘리는
  // 대신 알림만 띄운다.
  private addHeldItem(item: HeldItem) {
    if (this.heldItems.length >= ITEM_SLOT_MAX) {
      this.showFloatingLabel('Inventory full!');
      return;
    }
    this.heldItems.push(item);
    this.showFloatingLabel(`${ITEM_LABELS[item.type]} ready! (Z/X)`);
    this.refreshItemSlotsUI({ popInIndex: this.heldItems.length - 1 });
  }

  // Z키 — 지금 선택된 아이템을 사용(효과 적용)하고 목록에서 제거한다.
  // 2026-07-13: 조작키를 Z(사용)/X(전환) 두 개로 통일하기로 한 팀 결정에 맞춰, 함정 설치도
  // 더 이상 별도 Ctrl 키가 없다 — Z를 누르면 그 즉시 지금 서 있는 칸에 설치까지 끝난다
  // (attemptInstall). 손전등/탐지기는 서버 확인이 필요 없는 순수 로컬 효과라 그 자리에서
  // 바로 소모하지만, 함정 설치는 서버 응답(비동기)을 기다려야 해서 성공했을 때만 소모된다
  // (attemptInstall/handleInstallSuccess의 removeHeldItem 호출 참고) — 실패하면 계속 들고
  // 있다가 다른 칸에서 Z로 재시도할 수 있다.
  private useSelectedItem() {
    const item = this.heldItems[this.selectedSlotIndex];
    if (!item || this.hasFinished) return;

    // 쉴드는 여기 안 옴 — 즉시무장 예외라 애초에 인벤토리에 안 들어간다(applyLoadout/
    // resolveArrival 참고).
    if (item.type === 'flashlight') {
      this.applyFlashlightItem();
      this.removeHeldItem(item);
    } else if (item.type === 'detector') {
      void this.attemptUseDetector(item);
    } else {
      void this.attemptInstall(item);
    }
  }

  // Z로 탐지기 아이템을 사용했을 때(useSelectedItem) 호출됨. item.useDetector로 "지금 서
  // 있는 자리" 기준 반경을 그 순간 새로 스캔한다 — attemptInstall과 동일하게 서버 응답(비동기)을
  // 기다려야 해서 성공했을 때만 소모하고, 실패(충전 없음 등)하면 계속 들고 있다가 재시도 가능.
  private async attemptUseDetector(item: HeldItem) {
    if (this.hasFinished || this.isUsingDetector) return;

    this.isUsingDetector = true;
    try {
      const { revealedTraps }: ItemUseDetectorOutput = await trpc.item.useDetector.mutate({ mapId: MAP_ID });
      this.removeHeldItem(item);
      this.applyDetectorItem(revealedTraps);
    } catch (err) {
      if (!IS_LOCAL_PREVIEW) {
        // 실서버가 있는 환경에서 진짜로 실패한 경우(충전 소진 등) — 성공한 척하지 않고
        // 정직하게 실패로 안내한다. heldItems에서 안 지웠으니 다른 슬롯 선택 후 다시 시도 가능.
        console.error('item.useDetector 실패(실서버 환경)', err);
        this.showFloatingLabel('Detector unavailable');
      } else {
        // 백엔드 없는 로컬 프리뷰용 폴백 — 다른 유저 함정을 알 방법이 없으므로 빈 목록으로 처리.
        console.error('item.useDetector 실패 — 로컬 프리뷰용 빈 결과로 대체', err);
        this.removeHeldItem(item);
        this.applyDetectorItem([]);
      }
    } finally {
      this.isUsingDetector = false;
    }
  }

  // heldItems에서 특정 아이템을 제거하고 선택 인덱스/슬롯 UI를 갱신한다(사용 완료 공용 처리
  // — useSelectedItem의 즉시 소모 케이스와 attemptInstall의 비동기 성공 케이스가 공유).
  // 인덱스가 아니라 아이템 객체 참조로 찾는다 — 함정 설치는 서버 응답을 기다리는 동안 다른
  // 슬롯이 먼저 소모돼 인덱스가 밀릴 수 있어서, "그 사이에도 변하지 않는" 객체 자체로
  // 식별해야 안전하다.
  private removeHeldItem(item: HeldItem) {
    const index = this.heldItems.indexOf(item);
    if (index === -1) return;
    this.heldItems.splice(index, 1);
    // 마지막 자리를 쓰고 있었다면(뒤로 당겨질 아이템이 없음) 선택 인덱스가 배열 길이를
    // 벗어나므로 새 마지막 자리로 당겨준다.
    if (this.selectedSlotIndex >= this.heldItems.length) {
      this.selectedSlotIndex = Math.max(0, this.heldItems.length - 1);
    }
    this.refreshItemSlotsUI();
  }

  // X키 — 선택을 다음 아이템으로 옮긴다. 들고 있는 게 없으면 아무 일도 하지 않는다(순환할
  // 대상 자체가 없음 — 예전처럼 빈 슬롯을 순환 대상에 포함시키던 개념이 없어짐, 2026-07-13).
  private cycleSelectedSlot() {
    if (this.heldItems.length === 0) return;
    this.selectedSlotIndex = (this.selectedSlotIndex + 1) % this.heldItems.length;
    this.refreshItemSlotsUI({ punchIndex: this.selectedSlotIndex });
  }

  // 스플래시 로드아웃 화면(splash.tsx)에서 고른 아이템을 게임 시작 시 인벤토리에 지급한다.
  // 별도 웹뷰라 React state로 못 넘기고 localStorage로 넘겨받는다(loadout.ts 참고 — 예전엔
  // 이 값을 아무도 안 읽어서 로드아웃 선택이 실제 게임에 전혀 반영이 안 됐음, PR #33 리뷰로
  // 발견). 값이 없거나 알아볼 수 없으면(예: 스플래시를 거치지 않고 game.html에 바로 진입한
  // 로컬 프리뷰) 아무것도 지급하지 않는다 — "선택 안 하면 빈손으로 시작"이 안전한 기본값.
  // 2026-07-13: 즉시 발동(applyXItem 직접 호출) 대신 addHeldItem으로 슬롯에 채우도록 변경 —
  // 단 쉴드는 예외(같은 날 되돌림): 함정이 안 보이는 게임이라 "언제 Z로 쓸지" 판단할 방법이
  // 없다(임소리 피드백) — 쉴드는 애초에 지속시간도 없이 다음 함정을 맞을 때까지 무기한
  // 대기하는 반응형이라, 슬롯에 넣고 미루기보다 줍는 즉시 무장해두는 쪽이 항상 이득이다.
  private async applyLoadout() {
    let saved: string | null;
    try {
      saved = localStorage.getItem(LOADOUT_STORAGE_KEY);
    } catch {
      return; // localStorage 접근이 막힌 환경에서도 게임 자체는 정상 진행되게
    }

    if (saved === 'flashlight') this.addHeldItem({ type: 'flashlight' });
    else if (saved === 'shield') this.applyShieldItem();
    else if (saved === 'trapDetector') {
      // 로드아웃 지급은 localStorage만 읽는 클라이언트 로컬 처리라 서버가 몰랐다 — 탐지기는
      // 1회성을 서버가 강제해야 하는 민감 정보라, item.claimLoadout으로 서버에도 충전을
      // 등록한 뒤에야 슬롯에 채운다(배영환/임소리 논의로 확정, 2026-07-13).
      try {
        const { granted } = await trpc.item.claimLoadout.mutate({ mapId: MAP_ID, loadoutId: 'trapDetector' });
        if (granted) this.addHeldItem({ type: 'detector' });
      } catch (err) {
        if (IS_LOCAL_PREVIEW) {
          // 백엔드 없는 로컬 프리뷰 — 서버 충전 등록 없이도 로컬에서 슬롯 배선을 테스트할 수 있게.
          console.error('item.claimLoadout 실패 — 로컬 프리뷰용으로 그대로 지급', err);
          this.addHeldItem({ type: 'detector' });
        } else {
          console.error('item.claimLoadout 실패(실서버 환경) — 탐지기 미지급', err);
        }
      }
    }
  }

  // Z로 함정 설치 아이템을 사용했을 때(useSelectedItem) 호출됨. 지금 서 있는 칸에 바로
  // 설치를 시도한다 — 이 게임엔 "다른 칸을 조준"하는 입력 수단이 없어서 항상 현재 위치에
  // 설치하는 게 유일하게 말이 되는 선택.
  // 2026-07-13: 원래는 Z(장전)와 별도로 Ctrl(그 자리에 설치) 키가 따로 있었는데, "Z 누른
  // 자리와 실제 설치 자리가 다르다"는 혼란을 줬고, 애초에 팀이 "아이템 조작키는 Z/X 두 개로
  // 통일"하기로 정했던 것과도 어긋났다(임소리 지적) — Ctrl을 완전히 없애고, Z 한 번으로 그
  // 즉시 설치까지 끝나도록 합침.
  private async attemptInstall(item: HeldItem) {
    if (this.hasFinished || this.isInstalling) return;

    const type = item.trapType!;
    this.isInstalling = true;
    try {
      // tRPC가 서버의 각 return문에서 리터럴 유니언(성공 케이스엔 reason 필드 자체가 없음)을
      // 그대로 추론해버려서, result.success로 좁혀도 result.reason 접근이 막힌다. 공유 타입
      // TrapInstallOutput으로 변수 타입을 명시해 구조적으로 맞춰준다(as 캐스팅 아님 — 실제
      // 응답 모양이 TrapInstallOutput을 항상 만족하므로 대입 가능).
      const result: TrapInstallOutput = await trpc.trap.install.mutate({
        mapId: MAP_ID,
        type,
        x: this.playerGridX,
        y: this.playerGridY,
      });

      this.myTraps = result.myTraps;

      if (result.success) {
        this.handleInstallSuccess(type, item);
        return;
      }

      // 실패(개수 제한/타일 점유 등)면 소모되지 않고 그대로 들고 있음 — 다른 칸에서 Z로
      // 재시도 가능(heldItems에서 안 지웠으므로).
      this.playSfx('trapInstallFail');
      const message = result.reason
        ? INSTALL_FAILURE_MESSAGES[result.reason]
        : INSTALL_FAILURE_MESSAGES.RETRY;
      this.showFloatingLabel(message);
    } catch (err) {
      // 2026-07-12: 에러가 나면 무조건 "로컬이라 그렇겠지"하고 성공 처리하던 걸, IS_LOCAL_PREVIEW로
      // 실제 환경을 확인해서 나누도록 수정(임소리 지적 — 실배포에서 진짜 네트워크 에러가 나도
      // 똑같이 성공한 척 하면 서버엔 안 남았는데 클라만 설치된 것처럼 보이는 위험이 있었음).
      if (!IS_LOCAL_PREVIEW) {
        // 실서버가 있는 환경(devvit playtest/배포)에서 진짜로 실패한 경우 — 성공한 척하지 않고
        // 정직하게 실패로 안내한다. heldItems에서 안 지웠으니 다른 칸에서, 또는 같은 칸에서
        // 다시 시도 가능.
        console.error('trap.install 실패(실서버 환경)', err);
        this.playSfx('trapInstallFail');
        this.showFloatingLabel(INSTALL_FAILURE_MESSAGES.RETRY);
      } else {
        // 백엔드 없는 로컬 프리뷰용 폴백 — loadServerState/reportPosition/reportItemPickup과
        // 동일한 패턴. 개수 제한/타일 점유 같은 실패 판정은 서버 전용 로직(Redis 기반)이라
        // 로컬에서 재현할 수 없으므로, 여기선 항상 성공한 것으로 처리한다.
        console.error('trap.install 실패 — 로컬 프리뷰용 즉시 성공 처리로 대체', err);
        this.myTraps = [...this.myTraps, { x: this.playerGridX, y: this.playerGridY, type }];
        this.handleInstallSuccess(type, item);
      }
    } finally {
      this.isInstalling = false;
    }
  }

  // 함정 설치 성공 시 공통으로 처리하는 상태 변경 + 이펙트. attemptInstall의 서버 성공
  // 분기와 로컬 폴백 분기가 동일하게 재사용한다.
  private handleInstallSuccess(type: TrapType, item: HeldItem) {
    this.playSfx('trapInstallSuccess');
    this.removeHeldItem(item); // 성공해야 소모(1회성)
    // 로컬 폴백(reportPosition)이 "설치자 본인은 회피"를 재현할 수 있도록 기록 — selfInstalledTrapKeys 참고.
    this.selfInstalledTrapKeys.add(`${this.playerGridX},${this.playerGridY}`);
    this.renderInstalledTrapMarker({ x: this.playerGridX, y: this.playerGridY, type });
    this.updateFog();
    this.showFloatingLabel(`Trap placed! (${TRAP_LABELS[type]})`);

    // 설치 순간 "쿵" 내려놓는 느낌의 짧은 펄스 — 설치된 칸에서 함정 색으로 한 번 퍼짐.
    const cx = this.playerGridX * TILE_SIZE + TILE_SIZE / 2;
    const cy = this.playerGridY * TILE_SIZE + TILE_SIZE / 2;
    this.spawnPulseEffect(cx, cy, {
      radius: TILE_SIZE * 0.15,
      color: TRAP_COLORS[type],
      fillAlpha: 0.7,
      endScale: 3,
      duration: 350,
      depth: 11,
    });
  }

  // 1. 슬라이드 함정.
  // (배경: 랭킹을 클리어 시간이 아니라 발자국 개수로 매기기로 바뀌면서, 단순히 느려지는 효과보다
  //  "원치 않는 방향으로 계속 밀려나서 발자국이 늘어나는" 효과가 새 랭킹 룰과 더 잘 맞물림)
  // 효과: 밟으면 방금 누르고 있던 방향으로, 벽에 부딪힐 때까지 자동으로 한 칸씩 계속 미끄러짐.
  // 단, 미끄러지는 도중 "다른" 방향키를 누르면 그 자리에서 탈출 가능 (팀원 피드백 반영).
  private applySlideTrap(dx: number, dy: number) {
    // 조작감 개선(2026-07-13)으로 isMoving이 트윈 완료 즉시 풀리면서, 이 함수가 실제로
    // 불릴 땐(네트워크 응답 도착 후) 이미 다음 이동 트윈이 진행 중일 수 있다. 그 트윈을
    // 먼저 죽여서 슬라이드가 항상 이기게 한다(applyRespawnTrap과 동일한 목적).
    this.tweens.killTweensOf(this.playerImg);

    this.playSfx('trapSlide');
    this.flashPlayer(TRAP_COLORS.slow);
    this.isSliding = true; // 미끄러지는 동안엔 다른 함정 효과보다 슬라이드 이미지를 우선 표시
    this.refreshPlayerTrapVisual();
    this.isMoving = true; // 미끄러지는 동안은 방향키 입력을 무시하게 잠가둠

    // 미끄러지는 동안 화면이 살짝 흔들려서 "통제 불능/어질어질"한 느낌을 준다. 몇 칸을
    // 미끄러질지 미리 알 수 없어서 넉넉한 길이로 걸어두고, slideStep이 멈추는 두 지점(방향키
    // 이탈/벽 충돌)에서 shakeEffect.reset()으로 조기 종료한다.
    this.cameras.main.shake(SLIDE_SHAKE_DURATION, SLIDE_SHAKE_INTENSITY);

    this.slideStep(dx, dy);
  }

  // 슬라이드 함정 전용: 같은 방향(dx, dy)으로 한 칸 미끄러지고, 벽을 만날 때까지 스스로를 계속 호출함.
  private slideStep(dx: number, dy: number) {
    // 지금 누르고 있는 방향키가 미끄러지는 방향(dx, dy)과 다르면 탈출 — 그 자리에서 멈춤.
    // (같은 방향을 계속 누르거나 아무 키도 안 누르면 원래대로 벽까지 계속 미끄러짐)
    const pressed = this.getPressedDirection();
    if (pressed && (pressed.dx !== dx || pressed.dy !== dy)) {
      this.isMoving = false;
      this.isSliding = false;
      this.cameras.main.shakeEffect.reset(); // 조기 탈출 — 흔들림도 바로 멈춤
      this.refreshPlayerTrapVisual(); // 슬라이드 탈출 — 시야차단 등 다른 효과가 아직 활성이면 그걸로, 없으면 평상시 모습으로
      return;
    }

    const targetX = this.playerGridX + dx;
    const targetY = this.playerGridY + dy;

    if (!this.isWalkable(targetX, targetY)) {
      // 벽(또는 맵 끝)에 부딪혀서 미끄러짐이 끝남 → 다시 방향키 입력을 받을 수 있게 풀어줌
      this.isMoving = false;
      this.isSliding = false;
      this.cameras.main.shakeEffect.reset(); // 벽에 부딪혀 정지 — 흔들림도 바로 멈춤
      this.refreshPlayerTrapVisual(); // 슬라이드 종료 — 시야차단 등 다른 효과가 아직 활성이면 그걸로, 없으면 평상시 모습으로
      return;
    }

    // 미끄러지기 직전 위치에 옅은 잔상을 남기고 빠르게 사라지게 해서 속도감을 더한다.
    const ghost = this.add.image(this.playerImg.x, this.playerImg.y, this.playerImg.texture.key);
    ghost.setFlipX(this.playerImg.flipX);
    ghost.setDisplaySize(this.playerImg.displayWidth, this.playerImg.displayHeight);
    ghost.setAlpha(0.35);
    ghost.setDepth(9); // 캐릭터(depth 10) 바로 아래
    this.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: 250,
      onComplete: () => ghost.destroy(),
    });

    this.playerGridX = targetX;
    this.playerGridY = targetY;
    this.stepCount++;
    this.updateFog();

    // 슬라이딩 도중 지나가는 칸에 다른 함정이 있어도 이번 구현에서는 이펙트를 재발동시키지 않음
    // (여러 함정 중첩 처리는 traps.md에도 "안 정해짐"으로 남아있어 임의로 정하지 않음).
    // 단, 서버의 위치 앵커(trap.trigger의 인접 타일 검증 기준)는 매 칸마다 갱신해줘야
    // 슬라이딩이 끝난 뒤 다음 이동이 "너무 멀리 떨어진 좌표"로 거부되지 않는다 —
    // 그래서 이펙트는 무시하되(result를 안 씀) 호출 자체는 매 칸마다 한다.
    void this.reportPosition(targetX, targetY);

    // 일반 이동(BASE_MOVE_DURATION)보다 짧은 시간으로 빠르게 미끄러지는 느낌을 냄.
    this.tweens.add({
      targets: this.playerImg,
      x: targetX * TILE_SIZE + TILE_SIZE / 2,
      y: targetY * TILE_SIZE + TILE_SIZE / 2,
      duration: SLIDE_STEP_DURATION,
      onComplete: () => {
        // 슬라이드로 지나가는 칸도 일반 이동과 동일하게 발자국을 남긴다.
        this.queueFootprint(targetX, targetY);

        // 미끄러지는 도중에 골인 지점에 닿으면 거기서 바로 멈춤 (계속 미끄러지지 않음)
        if (this.checkGoalReached(targetX, targetY)) {
          this.cameras.main.shakeEffect.reset();
          return;
        }
        this.slideStep(dx, dy); // 같은 방향으로 다음 칸 미끄러짐 시도 (벽이면 위에서 멈춤)
      },
    });
  }

  // 2. 리스폰 함정 — traps.md: 즉시 시작점으로 순간이동.
  // + 플레이테스트 결과 반영: 위치뿐 아니라 지금까지 밝힌 길도 함께 초기화해서 페널티를 더 크게 함
  // (traps.md 원안은 "위치만" 리셋이었으나, 벌칙감이 부족해 시야차단 함정처럼 탐색 기록도 리셋하도록 조정).
  private applyRespawnTrap() {
    // 조작감 개선(2026-07-13)으로 isMoving이 트윈 완료 즉시 풀리면서, 이 함수가 실제로
    // 불릴 땐(네트워크 응답 도착 후) 이미 다음 이동 트윈이 진행 중일 수 있다. 그 트윈을
    // 먼저 죽이지 않으면 아래에서 강제로 맞추는 playerImg 좌표를 트윈이 다음 프레임에
    // 다시 덮어써서 캐릭터가 엉뚱한 위치에서 튀는 예전 버그가 재발한다.
    this.tweens.killTweensOf(this.playerImg);

    this.playSfx('trapRespawn');
    this.flashPlayerTrap('respawn', RESPAWN_FLASH_MS);

    // 사라지는 이펙트 — 원래 있던 자리에서 함정 색(보라)으로 작은 원이 확 커지며 흩어짐.
    this.spawnPulseEffect(this.playerImg.x, this.playerImg.y, {
      radius: TILE_SIZE * 0.3,
      color: TRAP_COLORS.respawn,
      fillAlpha: 0.6,
      endScale: 2.5,
      duration: 350,
      depth: 11,
    });

    this.playerGridX = SPAWN_POSITION.x;
    this.playerGridY = SPAWN_POSITION.y;
    this.playerImg.setPosition(
      SPAWN_POSITION.x * TILE_SIZE + TILE_SIZE / 2,
      SPAWN_POSITION.y * TILE_SIZE + TILE_SIZE / 2
    );

    // 나타나는 이펙트 — 스폰 위치에서 큰 원이 줄어들며 응축되는 느낌(사라지는 쪽과 대비되게
    // 시작 스케일을 크게 잡고 줄인다)으로 "다시 나타났다"를 표현.
    this.spawnPulseEffect(this.playerImg.x, this.playerImg.y, {
      radius: TILE_SIZE * 0.5,
      color: TRAP_COLORS.respawn,
      fillAlpha: 0.5,
      strokeWidth: 3,
      startScale: 2.5,
      endScale: 0.2,
      duration: 400,
      depth: 11,
    });

    // 지금까지 탐색해서 기억해둔 모든 타일을 다시 'hidden'으로 되돌림 (탐험 진행도 페널티)
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileStates[y]![x] = 'hidden';
      }
    }

    // 위치와 시야 상태가 둘 다 바뀌었으니 다시 계산
    this.updateFog();

    // killTweensOf로 죽인 이동 트윈의 onComplete(그 이동의 resolveArrival 호출)는 실행되지
    // 않으므로, 그 이동이 걸어뒀을 isMoving=true를 여기서 대신 풀어준다. 이미 false였다면
    // (응답이 늦지 않아 다음 이동이 아직 안 시작된 일반적인 경우) 아무 영향 없는 재설정이다.
    this.isMoving = false;
  }

  // 3. 시야차단 함정 — traps.md/vision-system.md: 지금까지 밝힌 길이 다시 안개로 덮이고,
  // 5초간 시야 반경이 크게 줄어듦 (이 게임의 시그니처 함정, 블라인드 모드와 직접 시너지).
  private applyBlindTrap() {
    this.playSfx('trapBlind');

    // 손전등 글로우가 떠 있었다면 즉시 꺼준다 — 시야가 실제로는 1칸까지 확 줄어들었는데
    // "손전등 켜져있다"는 글로우가 그대로 남아있으면 지금 시야 상태와 모순돼 보인다는
    // 피드백(2026-07-11). 손전등 자체의 지속시간 타이머는 안 건드리고 글로우만 지운다 —
    // 타이머가 나중에 만료돼도 이미 null이라 아무 일 안 함(flashlightGlow?.destroy()).
    if (this.flashlightGlow) {
      this.flashlightGlow.destroy();
      this.flashlightGlow = null;
    }

    // 화면이 잠깐 완전히 어두워졌다 걷히는 "눈 감았다 뜨는" 임팩트. 실제 지속 효과(시야 반경
    // 1칸, 아래)와 별개로 트리거 순간을 강조한다 — 시그니처 함정이라 캐릭터 주변보다 화면
    // 전체 연출이 어울린다는 판단(2026-07-11). 맵 전체를 덮는 사각형이라 depth를 다른 모든
    // 요소(말풍선 라벨 20 포함)보다 위로 둔다.
    const flash = this.add.rectangle(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE, 0x000000, 0.92);
    flash.setOrigin(0, 0);
    flash.setDepth(25);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      delay: 150, // 잠깐 완전히 어두운 채로 멈춰서 "눈 감음"을 느끼게 한 뒤 걷힘
      duration: 600,
      onComplete: () => flash.destroy(),
    });

    // 지금까지 탐색해서 기억해둔 모든 타일을 다시 'hidden'으로 되돌림 (탐험 진행도 페널티)
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileStates[y]![x] = 'hidden';
      }
    }

    // vision-system.md: 완전 암전 금지 — 최소 1칸은 항상 보이게 유지
    this.currentVisionRadius = 1;
    this.updateFog();

    // 캐릭터 이미지 원복과 실제 효과(시야 반경) 복원이 항상 같은 타이밍/조건으로 함께
    // 일어나도록 onExpire로 넘긴다 — 예전엔 이 복원을 별도 delayedCall로 따로 걸었는데,
    // 캐릭터 이미지는 재트리거 보호(activeTrapEffects)를 받는데 시야 반경은 못 받아서,
    // 지속시간이 끝나기 전에 시야차단을 다시 밟으면 먼저 걸린 타이머가 시야를 조기에
    // 풀어버리는(실제 게임 효과가 캐릭터 이미지보다 먼저 끝나버리는) 문제가 있었다.
    this.flashPlayerTrap('blind', BLIND_DURATION_MS, () => {
      this.currentVisionRadius = VISION_RADIUS;
      this.updateFog();
    });
  }

  // 4. 역방향 함정 — traps.md: 4초간 방향키 입력이 반대로 동작.
  private applyReverseTrap() {
    this.playSfx('trapReverse');
    this.isReversed = true;

    // 지속시간 내내 머리 위에서 뱅글뱅글 도는 경고 아이콘 — 처음 틴트만으로는 "지금 조작이
    // 반대"라는 걸 계속 잊기 쉬워서(2026-07-11 임소리 피드백) 추가. 재트리거(이미 떠 있으면)
    // 시 새로 만들지 않고 재사용.
    if (!this.reverseIcon) {
      this.reverseIcon = this.add
        .text(this.playerImg.x, this.playerImg.y - TILE_SIZE * 0.55, '⇄', {
          fontSize: '20px',
          color: '#ff8800', // TRAP_COLORS.reverse와 동일
        })
        .setOrigin(0.5)
        .setDepth(11); // 캐릭터(depth 10) 위에 떠 보이게
      this.tweens.add({
        targets: this.reverseIcon,
        angle: 360,
        duration: 800,
        repeat: -1,
        ease: 'Linear',
      });
    }

    // applyBlindTrap과 동일한 이유로 실제 효과 복원을 onExpire로 넘긴다.
    this.flashPlayerTrap('reverse', REVERSE_DURATION_MS, () => {
      this.isReversed = false;
      if (this.reverseIcon) {
        this.tweens.killTweensOf(this.reverseIcon);
        this.reverseIcon.destroy();
        this.reverseIcon = null;
      }
    });
  }

  // 골인 지점에 도착했는지 확인하는 함수. 도착했으면 true를 반환하고 게임을 "완료" 상태로 만듦.
  private checkGoalReached(x: number, y: number): boolean {
    if (x !== GOAL_POSITION.x || y !== GOAL_POSITION.y) return false;

    this.playSfx('goal');
    this.hasFinished = true;
    this.isMoving = false;

    // 슬라이드로 미끄러지다 정확히 골인 칸에 멈추는 경우, slideStep이 원복 호출까지 못
    // 가고 여기서 바로 끝나버려서 캐릭터가 슬라이드 의상을 입은 채로 골인 화면에 남는
    // 문제가 있었다 — 여기서도 확실히 정리한다.
    this.isSliding = false;
    this.refreshPlayerTrapVisual();
    this.playGoalCelebration();

    // 다음 주기적 flush까지 기다리면 마지막 몇 칸이 화면 종료 후로 밀릴 수 있어 바로 전송.
    void this.flushFootprints();

    // 2026-07-13: 카메라가 캐릭터를 따라다니게 되면서, 맵 중앙(world 좌표) 고정 위치에 그리면
    // 골인 지점이 맵 중앙이 아닐 때 화면(카메라 뷰포트) 밖으로 벗어나 안 보일 수 있다. 뷰포트
    // 중앙에 항상 고정되도록 setScrollFactor(0)(카메라가 움직여도 화면상 위치 불변)을 쓰고,
    // 좌표도 world 좌표가 아니라 뷰포트 크기(CAMERA_VIEWPORT_TILES_X/Y) 기준으로 계산한다.
    const goalCenterX = (CAMERA_VIEWPORT_TILES_X * TILE_SIZE) / 2;
    const goalCenterY = (CAMERA_VIEWPORT_TILES_Y * TILE_SIZE) / 2;

    this.add
      .text(goalCenterX, goalCenterY, 'MAZE CLEARED!', {
        fontFamily: 'Jua',
        fontSize: '50px',
        color: '#ffffff',
        stroke: '#7a2400',
        strokeThickness: 8,
        shadow: { offsetY: 4, color: '#000000', blur: 6, fill: true },
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20);

    // 순위 텍스트 — "몇 등인지"가 이 화면에서 가장 중요한 정보라, GOAL! 다음으로 크게(rankText)
    // 강조하고 그 아래에 보조 정보(걸음 수/신기록 여부, statsText)를 작게 둔다. 둘 다 GOAL!
    // 아래에 처음엔 투명하게 만들어두고, reportRunFinish가 서버 응답을 받으면 채워 넣은 뒤
    // 함께 페이드인시킨다(revealRankInfo 참고).
    const rankText = this.add
      .text(goalCenterX, goalCenterY + 58, '', {
        fontFamily: 'Jua',
        fontSize: '34px',
        color: '#e2e8f0',
        stroke: '#000000',
        strokeThickness: 5,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20)
      .setAlpha(0);

    const statsText = this.add
      .text(goalCenterX, goalCenterY + 96, '', {
        fontFamily: 'Jua',
        fontSize: '18px',
        color: '#94a3b8',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20)
      .setAlpha(0);

    void this.reportRunFinish(rankText, statsText);

    return true;
  }

  // GOAL! 텍스트가 뜬 뒤 살짝 텀을 두고, "내 순위" 텍스트와 보조 스탯 텍스트를 아래에서
  // 떠오르며 함께 페이드인시킨다.
  private revealRankInfo(
    rankText: Phaser.GameObjects.Text,
    statsText: Phaser.GameObjects.Text,
    rankLine: string,
    statsLine: string,
    rankColor: string
  ) {
    for (const target of [
      { text: rankText, content: rankLine, color: rankColor },
      { text: statsText, content: statsLine, color: '#94a3b8' },
    ]) {
      target.text.setText(target.content).setColor(target.color).setY(target.text.y + RANK_REVEAL_RISE_PX);
      this.tweens.add({
        targets: target.text,
        alpha: 1,
        y: target.text.y - RANK_REVEAL_RISE_PX,
        duration: RANK_REVEAL_DURATION_MS,
        ease: 'Sine.easeOut',
      });
    }

    // 순위 공개까지 끝난 시점에 "처음 화면으로 돌아가기" 버튼을 띄우라고 React 쪽에 알림
    // (Phaser 캔버스는 DOM 버튼을 못 그리므로 App 컴포넌트가 이 이벤트를 받아 렌더링한다).
    window.dispatchEvent(new CustomEvent(MAZE_FINISHED_EVENT));
  }

  // 골인 시 서버에 클리어 기록을 보내 리더보드에 반영한다. 2026-07-13까지 이 호출 자체가
  // 없어서(테스트 단계 상태로 남아있었음) 실제로 골인해도 리더보드에 기록이 전혀 안 남고
  // 있던 문제 수정 — 서버 run.finish는 이미 완전히 구현돼 있었음(docs/wbs.md 전체 블로커 참고).
  //
  // 2026-07-13 추가 수정: 실배포 환경에서 완주해도 리더보드에 기록이 안 남는다는 재현 보고를
  // 받았는데, 실패해도 무조건 조용히 넘어가게 짜여있어서 원인을 전혀 알 수 없었음(attemptInstall이
  // 이미 겪은 것과 같은 문제 — IS_LOCAL_PREVIEW 구분 없이 실배포 실패까지 로컬 프리뷰처럼
  // 처리하면 진단 자체가 불가능해짐). 실배포(=IS_LOCAL_PREVIEW가 아닌 환경)에서 실패하면
  // 화면에 실패 안내를 띄우고 에러 메시지를 콘솔에 남겨서, 최소한 무슨 에러인지 눈으로
  // 확인할 수 있게 함.
  private async reportRunFinish(rankText: Phaser.GameObjects.Text, statsText: Phaser.GameObjects.Text) {
    const clearTimeMs = Date.now() - this.runStartTime;
    try {
      const result: RunFinishOutput = await trpc.run.finish.mutate({
        mapId: MAP_ID,
        steps: this.stepCount,
        clearTimeMs,
      });
      await new Promise<void>((resolve) => this.time.delayedCall(RANK_REVEAL_DELAY_MS, resolve));
      // "몇 등인지"를 가장 또렷하게 전달하는 게 목적이라 "YOU'RE #N"처럼 플레이어를 직접
      // 지칭하는 문장으로 표현(2026-07-13 피드백 — 기존 "RANK #N"은 라벨처럼 밋밋해 보임).
      const rankLine = `YOU'RE #${result.rank}`;
      const statsLine = result.isNewRecord ? `✦ NEW RECORD ✦  ·  ${this.stepCount} STEPS` : `${this.stepCount} STEPS`;
      this.revealRankInfo(rankText, statsText, rankLine, statsLine, result.isNewRecord ? '#fcd34d' : '#e2e8f0');
    } catch (err) {
      if (IS_LOCAL_PREVIEW) {
        // 백엔드 없는 로컬 프리뷰에서는 실패가 정상 동작 — 다른 mutation들(reportPosition/
        // reportItemPickup)과 동일한 패턴.
        console.error('run.finish 실패 — 로컬 프리뷰에서는 정상(리더보드 미반영)', err);
        return;
      }
      // 실배포 환경에서 진짜로 실패한 경우 — 조용히 넘어가지 않고 화면에도 알린다.
      console.error('run.finish 실패(실서버 환경) — 리더보드에 기록 안 남음', err);
      await new Promise<void>((resolve) => this.time.delayedCall(RANK_REVEAL_DELAY_MS, resolve));
      this.revealRankInfo(rankText, statsText, 'Record not saved', '', '#f87171');
    }
  }

  // 안개(시야) 상태를 다시 계산하는 함수.
  // vision-system.md 규칙: 기본 시야 2칸 안쪽은 밝게, 지나간 타일은 안개가 다시 덮이지 않고 유지.
  private updateFog() {
    // 스포트라이트 인트로 진행 중엔 이 함수를 통째로 무시한다(2026-07-14 발견) — create()에서
    // 초기 호출만 건너뛰어도, 손전등 로드아웃이 저장돼 있으면 applyLoadout() →
    // applyFlashlightItem()이 자체적으로 updateFog()를 또 불러서 맵이 미리 드러나 버렸다.
    // 호출 지점마다 일일이 막는 대신 이 함수 진입점 자체를 막아서, 앞으로 updateFog를 부르는
    // 코드가 늘어나도 스포트라이트 인트로 중엔 항상 안전하게 무시되도록 한다. 실제 계산은
    // computeFogVisibility로 분리해뒀다 — playSpawnIntroSpotlight가 깜빡임 각 단계마다 이
    // 가드를 우회해서 직접 계산/블랙아웃을 번갈아 호출해야 하기 때문(아래 참고).
    if (this.suppressFogUpdates) return;
    this.computeFogVisibility();
  }

  // updateFog()의 실제 계산 로직 — suppressFogUpdates 가드 없이 항상 즉시 실행된다.
  private computeFogVisibility() {
    // 1단계: 플레이어 위치에서 시작해 벽이 아닌 칸만 타고(4방향) BFS로 반경만큼 퍼뜨려
    // "지금 보이는 칸" 집합을 구한다. 예전에는 체비셰프 거리(벽 무시하고 정사각형으로
    // 퍼짐)를 썼는데, 좁은 통로에서도 옆 통로/방까지 벽을 뚫고 보여서 "손전등"처럼 느껴지는
    // 문제가 있었다(2026-07-11 임소리 발견). BFS는 실제로 걸어야 갈 수 있는 거리만 세므로
    // 지나온 통로를 따라서만 시야가 퍼진다.
    const visibleNow = new Set<string>();
    const bfsQueue: { x: number; y: number; dist: number }[] = [
      { x: this.playerGridX, y: this.playerGridY, dist: 0 },
    ];
    visibleNow.add(`${this.playerGridX},${this.playerGridY}`);
    let head = 0;
    while (head < bfsQueue.length) {
      const { x, y, dist } = bfsQueue[head]!;
      head++;
      if (dist >= this.currentVisionRadius) continue;

      for (const [nx, ny] of [
        [x, y - 1],
        [x, y + 1],
        [x - 1, y],
        [x + 1, y],
      ] as const) {
        const key = `${nx},${ny}`;
        if (!this.isWalkable(nx, ny) || visibleNow.has(key)) continue;
        visibleNow.add(key);
        bfsQueue.push({ x: nx, y: ny, dist: dist + 1 });
      }
    }

    // 시야차단 함정에 걸린 동안엔 "한 번이라도 밝혀진 칸은 기억해서 은은하게 보여준다"는
    // 아래 탐험 기억 로직 자체를 꺼야 한다 — 안 그러면 블라인드 상태로 계속 걸어다닐 때마다
    // 매 걸음 반경 1칸이 그대로 "탐험 완료"로 기록되어, 지나온 자리가 다시 explored로 밝게
    // 남는다(2026-07-13 QA에서 "재-안개가 전혀 안 먹힌다"고 보고된 원인 — applyBlindTrap의
    // 리셋 자체는 정상 동작하지만, 그 직후 블라인드 상태로 한두 칸만 움직여도 이 기억 로직이
    // 즉시 다시 밝혀버려서 리셋이 무의미해 보였음). activeTrapEffects에 'blind'가 남아있는
    // 동안(=아직 지속시간 안 끝남)은 시야 밖으로 나간 칸을 기억하지 않고 곧장 다시 hidden으로
    // 되돌려, "블라인드 중엔 방금 지나온 곳도 기억 못 한다"는 의도를 매 걸음 유지한다.
    const isBlinded = this.activeTrapEffects.has('blind');

    // 2단계: 모든 칸의 상태(hidden/explored/visible)를 계산한다. 연결 통로(pathConnectors)는
    // 두 칸의 상태를 동시에 참조해야 하는데, 상태 계산과 화면 반영(paintTile)을 한 루프에서
    // 같이 하면 아직 계산 안 된 이웃 칸을 참조할 수 있어서, 상태 계산을 먼저 전부 끝낸 뒤
    // 화면 반영은 따로 3단계에서 처리한다.
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (visibleNow.has(`${x},${y}`)) {
          // 지금 시야 범위 안 → 밝게 표시
          this.tileStates[y]![x] = 'visible';
        } else if (isBlinded) {
          this.tileStates[y]![x] = 'hidden';
        } else if (this.tileStates[y]![x] !== 'hidden') {
          // 시야 밖이지만 예전에 한 번이라도 밝혀진 적 있음 → "지나간 길"로 기억, 어둡게 유지
          this.tileStates[y]![x] = 'explored';
        }
        // 그 외의 경우(BFS로도 못 닿았고 한 번도 안 가봄)는 계속 'hidden' 그대로 둠
      }
    }

    // 3단계: 계산이 끝난 상태를 바탕으로 실제 도형 밝기를 반영한다.
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.paintTile(x, y);
      }
    }

    // 벽 텍스처는 그 벽과 맞닿은 바닥 칸들 중 가장 밝은(가장 많이 탐험된) 쪽을 따른다 —
    // 반대로 통로처럼 "가장 어두운 쪽"을 따르면, 한쪽 통로를 이미 밝혔는데도 아직 안 가본
    // 반대쪽 통로 사정 때문에 벽이 계속 안 보이는 문제가 생기기 때문(벽은 한쪽에서만
    // 봐도 보여야 자연스러움 — 통로는 "그 사이 길 자체"를 미리 보여주면 안 되는 것과 다름).
    for (const wallTile of this.wallTiles) {
      let maxAlpha = 0;
      for (const [nx, ny] of [
        [wallTile.x, wallTile.y - 1],
        [wallTile.x, wallTile.y + 1],
        [wallTile.x - 1, wallTile.y],
        [wallTile.x + 1, wallTile.y],
      ] as const) {
        if (!this.isWalkable(nx, ny)) continue;
        maxAlpha = Math.max(maxAlpha, this.alphaForState(this.tileStates[ny]![nx]!));
      }
      wallTile.image.setAlpha(maxAlpha);
    }
  }

  // computeFogVisibility가 평소에 그리는 모든 것(벽 텍스처, 함정/발자국/아이템 마커, 골인
  // 마커)을 강제로 알파 0(완전 숨김)으로 되돌린다 — tileStates(탐험 기억)는 건드리지 않고
  // 화면 표시만 임시로 끈다. playSpawnIntroSpotlight의 조명 깜빡임 중 "꺼짐" 단계에서 맵도
  // 캐릭터와 같은 리듬으로 같이 안 보이게 하는 용도(2026-07-14 도입) — tileStates를 안
  // 건드리므로, 바로 다음 "켜짐" 단계에서 computeFogVisibility를 다시 부르면 지금까지
  // 쌓인 탐험 기억 그대로 정상적으로 다시 그려진다.
  private blackoutMap() {
    for (const wallTile of this.wallTiles) {
      wallTile.image.setAlpha(0);
    }
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.trapRects[y]?.[x]?.setAlpha(0);
        this.footprintRects[y]?.[x]?.setAlpha(0);
        this.itemRects[y]?.[x]?.setAlpha(0);
      }
    }
    this.goalRect.setAlpha(0);
  }

  // 타일 상태(hidden/explored/visible)를 실제 화면 밝기(alpha)로 변환하는 함수.
  private alphaForState(state: TileState): number {
    if (state === 'hidden') return 0; // 완전 투명 → 검은 배경만 보여서 "안개로 덮인 것"처럼 보임
    if (state === 'explored') return 0.35; // 지나간 적 있지만 지금 시야 밖 → 어둡게
    return 1; // 지금 시야 안 → 원래 밝기 그대로
  }

  // 타일 상태에 맞춰 실제 화면에 보이는 밝기를 반영하는 함수.
  // 그 타일에 함정/발자국이 있으면 같은 밝기로 함께 맞춰줌
  // (함정도 안개에 덮인 곳에서는 안 보여야 자연스러움 — 함정 탐지기 아이템이 있어야 볼 수 있는 구조).
  private paintTile(x: number, y: number) {
    if (MAIN_MAP.grid[y]![x] === 'wall') return; // 벽 칸은 별도 wallTiles 루프에서 처리

    const alpha = this.alphaForState(this.tileStates[y]![x]!);
    const trap = this.trapRects[y]?.[x];
    const footprint = this.footprintRects[y]?.[x];
    const item = this.itemRects[y]?.[x];

    trap?.setAlpha(alpha);
    footprint?.setAlpha(alpha);
    item?.setAlpha(alpha);

    if (x === GOAL_POSITION.x && y === GOAL_POSITION.y) {
      this.goalRect.setAlpha(alpha);
    }
  }
}

// Phaser 게임 전체 설정.
// parent는 아래 App 컴포넌트에서 만든 div의 id와 반드시 이름이 같아야 함.
// width/height는 "게임 내부 논리 해상도"로만 쓰고 Scale.FIT으로 화면(부모 요소) 크기에 맞게
// 비율을 유지한 채 축소해서 보여준다. 2026-07-13: 이 값을 맵 전체 크기 대신 카메라 뷰포트
// 크기(CAMERA_VIEWPORT_TILES_X/Y)로 바꿈 — 카메라가 캐릭터를 따라다니게 되면서 화면엔 맵의
// 일부만 보이면 되고, 그래야 캐릭터/타일이 더 크게(확대되어) 보여서 몰입감이 생긴다.
const phaserConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // 브라우저가 WebGL을 지원하면 WebGL로, 아니면 자동으로 Canvas 방식으로 그림
  parent: 'phaser-container',
  width: CAMERA_VIEWPORT_TILES_X * TILE_SIZE,
  height: CAMERA_VIEWPORT_TILES_Y * TILE_SIZE,
  backgroundColor: '#000000', // hidden 타일은 투명해서 이 검은 배경이 그대로 "안개"처럼 보임
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [MazeScene],
};

// 골인 후 순위 공개가 끝나면(MAZE_FINISHED_EVENT) 뜨는 버튼 — 스플래시(초기 화면)로
// 돌아갈 방법이 없다는 피드백 반영. requestExpandedMode로 게임에 들어왔으므로 그 반대인
// exitExpandedMode를 호출해 인라인(스플래시) 프레젠테이션으로 되돌아간다.
const BackToMenuButton = () => (
  <button
    className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-800/90 border-2 border-slate-950 text-slate-100 font-display text-sm shadow-lg cursor-pointer select-none transition active:translate-y-[1px] hover:brightness-110 hover:text-white"
    onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
      try {
        exitExpandedMode(e.nativeEvent);
      } catch (err) {
        // 로컬 프리뷰 등 devvit 런타임 밖에서 game.html에 직접 진입한 경우 실패가 정상
        // — 다른 mutation들과 동일한 패턴(IS_LOCAL_PREVIEW).
        console.error('exitExpandedMode 실패 — devvit 환경 밖(로컬 프리뷰 등)에서는 정상', err);
      }
    }}
  >
    ← Back to Menu
  </button>
);

export const App = () => {
  // 골인 후 순위 공개가 끝났을 때만 true — Phaser 씬(MazeScene.revealRankInfo)이
  // window에 쏘는 MAZE_FINISHED_EVENT를 받아서 켠다.
  const [showBackButton, setShowBackButton] = useState(false);

  // useEffect(콜백, [])는 "이 컴포넌트가 화면에 처음 나타났을 때 딱 한 번" 실행됨.
  // React가 화면을 그리는 시점과 Phaser 게임이 시작되는 시점을 여기서 이어주는 역할.
  useEffect(() => {
    const game = new Phaser.Game(phaserConfig);

    // 컴포넌트가 화면에서 사라질 때(정리 함수) Phaser 게임도 같이 정리해서 메모리 누수를 막음
    return () => {
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    const onFinished = () => setShowBackButton(true);
    window.addEventListener(MAZE_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(MAZE_FINISHED_EVENT, onFinished);
  }, []);

  return (
    // Scale.FIT은 부모 요소의 실제 크기를 기준으로 축소 비율을 계산하므로, 부모가 뷰포트
    // 전체를 채우고 있어야(w-screen h-screen) 화면 크기에 맞는 비율이 정확히 나온다.
    <div className="relative flex justify-center items-center w-screen h-screen bg-black">
      <div id="phaser-container" className="w-full h-full" />
      {showBackButton ? <BackToMenuButton /> : null}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
