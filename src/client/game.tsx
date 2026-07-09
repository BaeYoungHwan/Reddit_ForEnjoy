import './index.css';

import Phaser from 'phaser';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { getMazeMap } from '../shared/maps';
import type { MazeMap } from '../shared/maps';
import { buildMazeSvgDataUri } from './mazePattern';
import { trpc } from './trpcClient';
import type { TrapInstance, TrapType } from '../shared/game-types';

// 실제 고정 맵 데이터(송원호 담당, src/shared/maps.ts). splash.tsx의 배경 미리보기와 같은 데이터.
const MAIN_MAP = getMazeMap('map-1');
const MAP_WIDTH = MAIN_MAP.grid[0]!.length;
const MAP_HEIGHT = MAIN_MAP.grid.length;

// 서버에 등록된 실제 맵 ID. 함정/발자국 API는 mapId 단위로 데이터를 구분한다.
const MAP_ID = 'map-1';

const TILE_SIZE = 64; // 타일 한 칸의 픽셀 크기 (정사각형 한 변의 길이)

// 통로 폭(px). 칸 전체(TILE_SIZE)를 통로로 채우면 사방이 넓게 뚫린 팩맨 게임판처럼
// 보인다는 피드백 반영 — 칸보다 훨씬 좁은 길만 밝혀서, 어둠(칸의 나머지 공간 = 벽)
// 속에 좁은 길이 나 있는 실제 미로에 가깝게 만듦.
const PATH_WIDTH = 26;

// 통로 채움색(진짜 아트 나오기 전 임시 색).
// (한때 통로 가장자리에 그림자/하이라이트 베벨을 둘렀었는데, 이동해서 새 구간이 열릴 때마다
// 굵은 띠가 튀어나오는 것처럼 보인다는 피드백으로 제거 — 발자국 아이콘으로 "지나온 길"을
// 표시하는 쪽이 낫다는 판단)
const PATH_BASE_COLOR = 0x6b6b6b;

// 벽 영역을 단색 도형이 아니라 splash.tsx 배경과 같은 방식(각진 석벽 블록 + 모르타르 줄눈 +
// 모서리 하이라이트)의 SVG 텍스처로 채운다 — "Phaser 단색 사각형" 느낌에서 벗어나기 위함.
// 칸 하나짜리 가짜 맵(1x1 wall)을 buildMazeSvgDataUri에 넘겨서 타일 하나 크기의 석벽
// 이미지를 만들고, 통로와 맞닿은 벽 칸에만 이 타일을 개별 도형으로 배치한다(전체 배경
// 이미지 한 장으로 깔면 안개와 무관하게 맵 전체가 항상 보여버려서 "탐험해야 벽도 보인다"는
// 안개 시스템의 핵심을 깨버림 — 반드시 인접 바닥 칸의 안개 상태에 종속시켜야 함).
const WALL_TILE_TEXTURE_KEY = 'maze-wall-tile';
const WALL_TILE_MAP: MazeMap = { id: 'wall-tile', name: 'wall-tile', grid: [['wall']], start: { x: 0, y: 0 }, exit: { x: 0, y: 0 } };
const WALL_TILE_TEXTURE_URI = buildMazeSvgDataUri(WALL_TILE_MAP, {
  cellSize: TILE_SIZE,
  wallFill: '#2b1d13',
  mortarStroke: '#000000',
  highlightStroke: '#5a4030',
});

// 발자국 마커: splash.tsx의 FootprintIcon과 같은 발바닥 모양 SVG(타원 조합)를 재사용 —
// 색깔 원이 아니라 실제 "발자국처럼 생긴" 아이콘으로 지나온 길을 표시하기 위함.
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

// vision-system.md 스펙: 기본 시야 반경 2칸.
// 나중에 손전등(4칸)/시야차단 함정(0.5~1칸)을 만들 때 이 값을 상황에 맞게 바꿔주면 됨.
const VISION_RADIUS = 2;

// 한 칸 이동에 걸리는 기본 시간(ms).
const BASE_MOVE_DURATION = 150;

// 슬라이드 함정에 걸려 미끄러질 때, 한 칸당 걸리는 시간(ms).
// 기본 이동보다 짧게 줘서 "제어권을 잃고 빠르게 밀려나는" 느낌을 냄.
const SLIDE_STEP_DURATION = 80;

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

// Phaser의 "씬(Scene)" = 게임 화면 한 장을 담당하는 클래스.
// 우리 게임은 미로 플레이 화면 하나만 있으면 되니 씬도 하나만 만듭니다.
class MazeScene extends Phaser.Scene {
  // 플레이어의 위치를 "그리드 칸 번호"로 저장 (픽셀 좌표 아님! 예: (0,0) = 맨 왼쪽 위 칸)
  private playerGridX = 0;
  private playerGridY = 0;

  // 이동 애니메이션(트윈)이 재생 중인지 여부.
  // true인 동안은 새 방향키 입력을 무시해서, 한 칸씩 딱딱 끊어서 이동하게 만듦.
  private isMoving = false;

  // Phaser가 제공하는 "방향키 입력 감지" 객체 (매 프레임 자동으로 눌림 상태를 갱신해줌)
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // 캐릭터를 표시할 도형. 지금은 진짜 캐릭터 이미지가 없어서 노란 네모로 대체.
  // 나중에 아트가 나오면 이 부분만 스프라이트 이미지로 교체하면 됨.
  private playerRect!: Phaser.GameObjects.Rectangle;

  // 각 바닥 칸 중심에 그려둔 좁은 통로 사각형을 [y][x] 좌표로 저장해둠
  // (벽 칸은 따로 그리지 않아 undefined). 안개 상태가 바뀔 때마다 "다시 그리기"가 아니라
  // "이미 그려둔 도형의 밝기를 조정"하는 방식으로 처리.
  private tileRects: (Phaser.GameObjects.Rectangle | undefined)[][] = [];

  // 인접한 두 바닥 칸(중심 통로 사각형) 사이를 이어주는 좁은 연결 통로 도형.
  // 통로가 칸 중앙의 좁은 사각형뿐이면 옆 칸과 뚝뚝 끊어져 보이므로, 서로 통행 가능한
  // 두 칸 사이 빈틈을 이 연결 통로로 메워 하나로 이어진 길처럼 보이게 함.
  // 두 칸 중 하나라도 안개에 덮여 있으면 그 구간은 아직 안 보여야 하므로, 안개 계산 시
  // 두 칸의 밝기 중 더 어두운 쪽을 따른다(양쪽 다 밝혀졌을 때만 완전히 보임).
  private pathConnectors: {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    rect: Phaser.GameObjects.Rectangle;
  }[] = [];

  // 각 타일의 현재 상태(hidden/explored/visible)를 기억해두는 표
  private tileStates: TileState[][] = [];

  // 통로와 맞닿은 벽 칸에 배치한 석벽 텍스처 도형들. 벽 칸 자체는 fog 상태가 없으므로
  // (통로만 hidden/explored/visible을 가짐), 인접한 바닥 칸들의 밝기 중 가장 밝은 값을
  // 따르도록 updateFog에서 매번 다시 계산한다 — 안개가 걷혀야 벽도 보이게 하기 위함.
  private wallTiles: { x: number; y: number; image: Phaser.GameObjects.Image }[] = [];

  // 실제로 밟아본 적 있는 칸인지 표시(발자국 마커를 한 번만 만들기 위함). 시야 반경 안에
  // 들어와서 "보이기만" 한 칸과 구분하기 위해 tileStates와는 별도로 관리한다.
  private visited: boolean[][] = [];

  // 발자국 마커 도형. 안개 상태에 맞춰 같이 밝기 조정됨(다시 안개가 덮이면 같이 흐려짐).
  private footprintRects: (Phaser.GameObjects.Image | undefined)[][] = [];

  // 함정 마커 도형. 안개 상태에 맞춰 같이 밝기 조정됨
  // (함정 탐지기 아이템 없이는 안개에 덮인 함정이 안 보이게 하기 위함).
  private trapRects: (Phaser.GameObjects.Arc | undefined)[][] = [];

  // 서버에서 받아온 "내가 설치한 함정" 목록. 다른 유저가 설치한 함정 좌표는 서버가
  // trap.trigger(인접 타일만 조회 가능)를 통해서만 알려주므로 클라이언트에 절대 미리 내려주지
  // 않는다 — 여기서 다른 유저 함정까지 렌더링하면 함정 위치를 미리 알아내는 치트가 된다.
  private myTraps: TrapInstance[] = [];

  // 지금 적용 중인 시야 반경. 평소엔 VISION_RADIUS와 같고, 시야차단 함정에 걸리면 잠깐 줄어듦.
  private currentVisionRadius = VISION_RADIUS;

  // 역방향 함정에 걸린 상태인지 여부. true면 방향키 입력을 반대로 뒤집어서 처리함.
  private isReversed = false;

  // 골인 지점 마커 도형. 안개 상태에 맞춰 밝기가 같이 조정됨 (다른 타일들과 동일하게 탐색해야 보임).
  private goalRect!: Phaser.GameObjects.Rectangle;

  // 골인했는지 여부. true가 되면 더 이상 방향키 입력을 받지 않음(테스트용 종료 처리).
  private hasFinished = false;

  constructor() {
    // 'MazeScene'은 이 씬의 이름표. 씬이 여러 개일 때 구분하는 용도라 지금은 큰 의미 없음.
    super('MazeScene');
  }

  // preload(): 게임 시작 전에 이미지 등 리소스를 미리 불러오는 함수.
  // 벽 석벽 텍스처, 발자국 아이콘(둘 다 SVG data URI)을 로드해둔다.
  preload() {
    this.load.image(WALL_TILE_TEXTURE_KEY, WALL_TILE_TEXTURE_URI);
    this.load.image(FOOTPRINT_TEXTURE_KEY, FOOTPRINT_TEXTURE_URI);
  }

  // create(): 게임이 시작될 때 딱 한 번만 실행됨. 여기서 맵과 캐릭터를 화면에 배치합니다.
  create() {
    // 맵 크기만큼 타일 상태/도형 배열을 준비하고, 바닥 칸 중앙에 좁은 통로 사각형만 그림.
    // 통로와 맞닿은 벽 칸에는 석벽 텍스처 도형을 하나씩 배치(깊은 안쪽 벽 칸은 어차피
    // 안 보일 곳이라 만들지 않음). 벽 텍스처도 통로처럼 안개 상태에 따라 밝기가 바뀐다
    // (updateFog 참고) — 그래야 "탐험해야 벽도 보인다"는 안개 시스템 취지가 유지된다.
    for (let y = 0; y < MAP_HEIGHT; y++) {
      this.tileRects[y] = [];
      this.tileStates[y] = [];
      this.trapRects[y] = [];
      this.visited[y] = [];
      this.footprintRects[y] = [];

      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileStates[y]![x] = 'hidden'; // 시작할 땐 전부 안개로 덮인 상태
        this.visited[y]![x] = false;

        if (MAIN_MAP.grid[y]![x] === 'wall') {
          // 통로와 한 번이라도 맞닿아 있어야(=언젠가 보일 가능성이 있어야) 텍스처를 만든다.
          const touchesFloor =
            this.isWalkable(x, y - 1) || this.isWalkable(x, y + 1) || this.isWalkable(x - 1, y) || this.isWalkable(x + 1, y);
          if (touchesFloor) {
            const image = this.add
              .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, WALL_TILE_TEXTURE_KEY)
              .setDepth(-1)
              .setAlpha(0);
            this.wallTiles.push({ x, y, image });
          }
          continue; // 벽 칸은 통로 도형을 만들지 않고 건너뜀
        }

        // 칸 중앙에 좁은 통로 사각형을 그린다(단색 채움 — 지나온 길 표시는 발자국 아이콘이 맡음).
        const cx = x * TILE_SIZE + TILE_SIZE / 2;
        const cy = y * TILE_SIZE + TILE_SIZE / 2;
        this.tileRects[y]![x] = this.add.rectangle(cx, cy, PATH_WIDTH, PATH_WIDTH, PATH_BASE_COLOR);

        // 오른쪽/아래쪽 이웃이 통행 가능한 바닥이면, 이 칸과 이웃 칸의 중앙 통로 사각형
        // 사이 빈틈을 좁은 연결 통로로 메워서 두 칸이 하나로 이어진 길처럼 보이게 함.
        // (왼쪽/위쪽 이웃과의 연결은 그 이웃 칸을 처리할 때 오른쪽/아래쪽 방향으로 이미 그려짐
        //  — 양방향에서 각각 그리면 같은 연결이 중복되므로 한쪽 방향만 처리)
        if (this.isWalkable(x + 1, y)) {
          const rect = this.add.rectangle((x + 1) * TILE_SIZE, cy, TILE_SIZE, PATH_WIDTH, PATH_BASE_COLOR);
          this.pathConnectors.push({ ax: x, ay: y, bx: x + 1, by: y, rect });
        }
        if (this.isWalkable(x, y + 1)) {
          const rect = this.add.rectangle(cx, (y + 1) * TILE_SIZE, PATH_WIDTH, TILE_SIZE, PATH_BASE_COLOR);
          this.pathConnectors.push({ ax: x, ay: y, bx: x, by: y + 1, rect });
        }
      }
    }

    // 골인 지점 마커 배치 (초록색 사각형)
    this.goalRect = this.add.rectangle(
      GOAL_POSITION.x * TILE_SIZE + TILE_SIZE / 2,
      GOAL_POSITION.y * TILE_SIZE + TILE_SIZE / 2,
      PATH_WIDTH * 0.9,
      PATH_WIDTH * 0.9,
      0x33ff66
    );
    this.goalRect.setDepth(6);

    // 캐릭터를 맵 시작 칸(SPAWN_POSITION)에 배치.
    // 일단 노란 사각형으로 표현 (나중에 실제 캐릭터 이미지로 교체 예정)
    this.playerGridX = SPAWN_POSITION.x;
    this.playerGridY = SPAWN_POSITION.y;
    this.playerRect = this.add.rectangle(
      this.playerGridX * TILE_SIZE + TILE_SIZE / 2,
      this.playerGridY * TILE_SIZE + TILE_SIZE / 2,
      PATH_WIDTH * 0.7,
      PATH_WIDTH * 0.7,
      0xffd400
    );
    this.playerRect.setDepth(10); // depth(그리기 순서)를 높여서 타일 위에 캐릭터가 보이게 함

    // 시작 칸도 밟은 것으로 쳐서 발자국을 남긴다.
    this.markVisited(SPAWN_POSITION.x, SPAWN_POSITION.y);

    // 키보드의 방향키 입력을 받을 수 있도록 설정.
    // 이후 update()에서 this.cursors.left/right/up/down 으로 눌림 여부를 확인할 수 있음.
    this.cursors = this.input.keyboard!.createCursorKeys();

    // 게임 시작하자마자 시작 지점 기준으로 시야(안개)부터 계산해서 보여줌
    this.updateFog();

    // 서버에 위치 앵커를 초기화하고 내가 설치한 함정 목록을 받아온다 (fire-and-forget).
    void this.loadServerState();
  }

  // map.getState를 호출해 서버 쪽 위치 앵커를 시작 지점으로 초기화하고,
  // 내가 설치한 함정 목록을 받아와 마커로 표시한다.
  private async loadServerState() {
    try {
      const state = await trpc.map.getState.query({ mapId: MAP_ID });
      this.myTraps = state.myTraps;
    } catch (err) {
      // 정적 빌드만 단독으로 띄우는 로컬 프리뷰(백엔드 없음)에서도 함정 마커를 눈으로
      // 확인할 수 있도록 하는 개발용 폴백. 실제 서버(devvit playtest/배포 환경)가
      // 응답하면 위 try에서 이미 성공해 여기까지 오지 않는다.
      console.error('map.getState 실패 — 로컬 프리뷰용 임시 함정 데이터로 대체', err);
      this.myTraps = [
        { x: 5, y: 7, type: 'slow' },
        { x: 9, y: 3, type: 'respawn' },
        { x: 3, y: 5, type: 'blind' },
        { x: 7, y: 3, type: 'reverse' },
      ];
    }
    this.renderTrapMarkers();
  }

  // this.myTraps를 화면에 마커로 그린다. 안개 상태를 바로 반영하기 위해 마지막에 updateFog도 호출.
  private renderTrapMarkers() {
    for (const trap of this.myTraps) {
      const marker = this.add.circle(
        trap.x * TILE_SIZE + TILE_SIZE / 2,
        trap.y * TILE_SIZE + TILE_SIZE / 2,
        PATH_WIDTH * 0.35,
        TRAP_COLORS[trap.type]
      );
      marker.setDepth(6); // 타일(기본 depth 0)보다 위, 캐릭터(depth 10)보다 아래
      this.trapRects[trap.y]![trap.x] = marker;
    }
    this.updateFog();
  }

  // update(): 매 프레임(1초에 수십 번)마다 반복 실행되는 함수.
  // "지금 방향키가 눌렸는가?"를 확인해서 캐릭터를 움직이는 역할을 함.
  override update() {
    // 골인했으면 더 이상 입력을 받지 않음 (테스트용 종료 처리)
    if (this.hasFinished) return;

    // 이동 애니메이션이 재생 중이면 새 입력은 무시 (칸 단위로 딱딱 끊어 이동하게 하기 위함)
    if (this.isMoving) return;

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

  // 지금 눌려있는 방향키를 -1/0/1 형태의 방향값으로 바꿔주는 함수. 아무 키도 안 눌렸으면 null.
  // isDown = "지금 눌려있는 상태"면 계속 true (누르고 있는 동안 쭉 true).
  private getPressedDirection(): { dx: number; dy: number } | null {
    if (this.cursors.left.isDown) return { dx: -1, dy: 0 };
    if (this.cursors.right.isDown) return { dx: 1, dy: 0 };
    if (this.cursors.up.isDown) return { dx: 0, dy: -1 };
    if (this.cursors.down.isDown) return { dx: 0, dy: 1 };
    return null;
  }

  // 그 칸을 실제로 밟았음을 기록하고, 처음 밟는 칸이면 발자국 마커를 하나 남긴다.
  // (시야 반경 안에 "보이기만" 한 칸까지 발자국이 찍히면 안 되므로 tileStates가 아니라
  // 실제 이동 완료 시점에만 호출해야 함 — tryMove/slideStep 참고).
  private markVisited(x: number, y: number) {
    if (this.visited[y]?.[x]) return;
    this.visited[y]![x] = true;

    const marker = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, FOOTPRINT_TEXTURE_KEY);
    marker.setDisplaySize(PATH_WIDTH * 0.7, PATH_WIDTH * 0.7);
    marker.setDepth(2); // 통로(depth 0)보다 위, 함정/캐릭터(depth 6/10)보다 아래
    this.footprintRects[y]![x] = marker;
  }

  // 그리드 좌표(x, y)로 이동/통과 가능한지 확인하는 함수 (맵 범위 안 + 벽 아님).
  // 일반 이동(tryMove)과 슬라이드(slideStep) 둘 다 같은 기준으로 판정해야 해서 하나로 뽑아둠.
  private isWalkable(x: number, y: number): boolean {
    const isOutOfBounds = y < 0 || y >= MAP_HEIGHT || x < 0 || x >= MAP_WIDTH;
    if (isOutOfBounds) return false;

    return MAIN_MAP.grid[y]![x] !== 'wall';
  }

  // 한 칸 이동을 시도하는 함수.
  // dx, dy는 "어느 방향으로 한 칸 움직이려 하는지" (-1, 0, 1 중 하나씩)
  private tryMove(dx: number, dy: number) {
    const targetX = this.playerGridX + dx;
    const targetY = this.playerGridY + dy;

    // 맵 범위 밖이거나 벽이면 이동 취소
    if (!this.isWalkable(targetX, targetY)) return;

    this.isMoving = true;
    this.playerGridX = targetX;
    this.playerGridY = targetY;
    this.markVisited(targetX, targetY);

    // tween(트윈) = 값을 순간이동이 아니라 "서서히" 바꿔주는 Phaser 기능.
    // 여기서는 캐릭터의 실제 화면 좌표(x, y)를 목표 지점까지 BASE_MOVE_DURATION(ms) 동안 부드럽게 이동시킴.
    this.tweens.add({
      targets: this.playerRect,
      x: targetX * TILE_SIZE + TILE_SIZE / 2,
      y: targetY * TILE_SIZE + TILE_SIZE / 2,
      duration: BASE_MOVE_DURATION,
      onComplete: () => {
        this.isMoving = false; // 이동이 끝나야 다음 입력을 다시 받을 수 있게 풀어줌

        if (this.checkGoalReached(targetX, targetY)) return; // 골인했으면 함정 확인 없이 종료

        // 도착한 칸에 함정이 있는지 서버에 확인. dx, dy(눌렀던 방향)를 같이 넘겨서
        // 슬라이드 함정이 "어느 방향으로 미끄러질지" 알 수 있게 함.
        void this.checkTrapTrigger(targetX, targetY, dx, dy);
      },
    });

    // 위치가 바뀌었으니 시야(안개)도 다시 계산
    this.updateFog();
  }

  // trap.trigger를 호출해 서버 쪽 위치 앵커를 동기화하고, 함정에 걸렸는지 응답을 받는다.
  // 실패하면 콘솔에만 남기고 넘어간다(useLeaderboard와 동일한 수준의 처리 — 프로토타입 단계라
  // 재시도/오프라인 큐 같은 복구 로직은 아직 두지 않음).
  private async reportPosition(x: number, y: number) {
    try {
      return await trpc.trap.trigger.mutate({ mapId: MAP_ID, x, y });
    } catch (err) {
      console.error('trap.trigger 실패', err);
      return null;
    }
  }

  // 방금 도착한 칸에 함정이 있는지 서버에 확인하고, 있으면 종류에 맞는 효과를 적용하는 함수.
  // dx, dy는 지금 막 이동해온 방향 (슬라이드 함정이 미끄러질 방향을 정하는 데 사용).
  private async checkTrapTrigger(x: number, y: number, dx: number, dy: number) {
    const result = await this.reportPosition(x, y);
    if (!result?.hit || !result.type) return;

    if (result.type === 'slow') this.applySlideTrap(dx, dy);
    else if (result.type === 'respawn') this.applyRespawnTrap();
    else if (result.type === 'blind') this.applyBlindTrap();
    else this.applyReverseTrap();
  }

  // 함정을 밟았을 때 캐릭터 색을 잠깐 바꿔서 "뭔가 발동했다"는 걸 보여주는 간단한 이펙트.
  private flashPlayer(color: number) {
    this.playerRect.setFillStyle(color);
    this.time.delayedCall(200, () => {
      this.playerRect.setFillStyle(0xffd400); // 원래 색(노랑)으로 복귀
    });
  }

  // 1. 슬라이드 함정.
  // (배경: 랭킹을 클리어 시간이 아니라 발자국 개수로 매기기로 바뀌면서, 단순히 느려지는 효과보다
  //  "원치 않는 방향으로 계속 밀려나서 발자국이 늘어나는" 효과가 새 랭킹 룰과 더 잘 맞물림)
  // 효과: 밟으면 방금 누르고 있던 방향으로, 벽에 부딪힐 때까지 자동으로 한 칸씩 계속 미끄러짐.
  // 단, 미끄러지는 도중 "다른" 방향키를 누르면 그 자리에서 탈출 가능 (팀원 피드백 반영).
  private applySlideTrap(dx: number, dy: number) {
    this.flashPlayer(TRAP_COLORS.slow);
    this.isMoving = true; // 미끄러지는 동안은 방향키 입력을 무시하게 잠가둠
    this.slideStep(dx, dy);
  }

  // 슬라이드 함정 전용: 같은 방향(dx, dy)으로 한 칸 미끄러지고, 벽을 만날 때까지 스스로를 계속 호출함.
  private slideStep(dx: number, dy: number) {
    // 지금 누르고 있는 방향키가 미끄러지는 방향(dx, dy)과 다르면 탈출 — 그 자리에서 멈춤.
    // (같은 방향을 계속 누르거나 아무 키도 안 누르면 원래대로 벽까지 계속 미끄러짐)
    const pressed = this.getPressedDirection();
    if (pressed && (pressed.dx !== dx || pressed.dy !== dy)) {
      this.isMoving = false;
      return;
    }

    const targetX = this.playerGridX + dx;
    const targetY = this.playerGridY + dy;

    if (!this.isWalkable(targetX, targetY)) {
      // 벽(또는 맵 끝)에 부딪혀서 미끄러짐이 끝남 → 다시 방향키 입력을 받을 수 있게 풀어줌
      this.isMoving = false;
      return;
    }

    this.playerGridX = targetX;
    this.playerGridY = targetY;
    this.markVisited(targetX, targetY);
    this.updateFog();

    // 슬라이딩 도중 지나가는 칸에 다른 함정이 있어도 이번 구현에서는 이펙트를 재발동시키지 않음
    // (여러 함정 중첩 처리는 traps.md에도 "안 정해짐"으로 남아있어 임의로 정하지 않음).
    // 단, 서버의 위치 앵커(trap.trigger의 인접 타일 검증 기준)는 매 칸마다 갱신해줘야
    // 슬라이딩이 끝난 뒤 다음 이동이 "너무 멀리 떨어진 좌표"로 거부되지 않는다 —
    // 그래서 이펙트는 무시하되(result를 안 씀) 호출 자체는 매 칸마다 한다.
    void this.reportPosition(targetX, targetY);

    // 일반 이동(BASE_MOVE_DURATION)보다 짧은 시간으로 빠르게 미끄러지는 느낌을 냄.
    this.tweens.add({
      targets: this.playerRect,
      x: targetX * TILE_SIZE + TILE_SIZE / 2,
      y: targetY * TILE_SIZE + TILE_SIZE / 2,
      duration: SLIDE_STEP_DURATION,
      onComplete: () => {
        // 미끄러지는 도중에 골인 지점에 닿으면 거기서 바로 멈춤 (계속 미끄러지지 않음)
        if (this.checkGoalReached(targetX, targetY)) return;
        this.slideStep(dx, dy); // 같은 방향으로 다음 칸 미끄러짐 시도 (벽이면 위에서 멈춤)
      },
    });
  }

  // 2. 리스폰 함정 — traps.md: 즉시 시작점으로 순간이동.
  // + 플레이테스트 결과 반영: 위치뿐 아니라 지금까지 밝힌 길도 함께 초기화해서 페널티를 더 크게 함
  // (traps.md 원안은 "위치만" 리셋이었으나, 벌칙감이 부족해 시야차단 함정처럼 탐색 기록도 리셋하도록 조정).
  private applyRespawnTrap() {
    this.flashPlayer(TRAP_COLORS.respawn);

    this.playerGridX = SPAWN_POSITION.x;
    this.playerGridY = SPAWN_POSITION.y;
    this.playerRect.setPosition(
      SPAWN_POSITION.x * TILE_SIZE + TILE_SIZE / 2,
      SPAWN_POSITION.y * TILE_SIZE + TILE_SIZE / 2
    );

    // 지금까지 탐색해서 기억해둔 모든 타일을 다시 'hidden'으로 되돌림 (탐험 진행도 페널티)
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileStates[y]![x] = 'hidden';
      }
    }

    // 위치와 시야 상태가 둘 다 바뀌었으니 다시 계산
    this.updateFog();
  }

  // 3. 시야차단 함정 — traps.md/vision-system.md: 지금까지 밝힌 길이 다시 안개로 덮이고,
  // 5초간 시야 반경이 크게 줄어듦 (이 게임의 시그니처 함정, 블라인드 모드와 직접 시너지).
  private applyBlindTrap() {
    this.flashPlayer(TRAP_COLORS.blind);

    // 지금까지 탐색해서 기억해둔 모든 타일을 다시 'hidden'으로 되돌림 (탐험 진행도 페널티)
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.tileStates[y]![x] = 'hidden';
      }
    }

    // vision-system.md: 완전 암전 금지 — 최소 1칸은 항상 보이게 유지
    this.currentVisionRadius = 1;
    this.updateFog();

    this.time.delayedCall(5000, () => {
      this.currentVisionRadius = VISION_RADIUS;
      this.updateFog();
    });
  }

  // 4. 역방향 함정 — traps.md: 4초간 방향키 입력이 반대로 동작.
  private applyReverseTrap() {
    this.flashPlayer(TRAP_COLORS.reverse);
    this.isReversed = true;

    this.time.delayedCall(4000, () => {
      this.isReversed = false;
    });
  }

  // 골인 지점에 도착했는지 확인하는 함수. 도착했으면 true를 반환하고 게임을 "완료" 상태로 만듦.
  // (테스트용 — 실제 클리어 기록/랭킹 전송은 배영환님 백엔드 API 연동 필요)
  private checkGoalReached(x: number, y: number): boolean {
    if (x !== GOAL_POSITION.x || y !== GOAL_POSITION.y) return false;

    this.hasFinished = true;
    this.isMoving = false;

    this.add
      .text(
        (MAP_WIDTH * TILE_SIZE) / 2,
        (MAP_HEIGHT * TILE_SIZE) / 2,
        '🎉 GOAL!',
        { fontSize: '64px', color: '#ffffff', fontStyle: 'bold' }
      )
      .setOrigin(0.5)
      .setDepth(20);

    return true;
  }

  // 안개(시야) 상태를 다시 계산하는 함수.
  // vision-system.md 규칙: 기본 시야 2칸 안쪽은 밝게, 지나간 타일은 안개가 다시 덮이지 않고 유지.
  private updateFog() {
    // 1단계: 모든 칸의 상태(hidden/explored/visible)를 먼저 다 계산해둔다.
    // 연결 통로(pathConnectors)는 두 칸의 상태를 동시에 참조해야 하는데, 상태 계산과
    // 화면 반영(paintTile)을 한 루프에서 같이 하면 아직 계산 안 된 이웃 칸을 참조할 수
    // 있어서, 상태 계산을 먼저 전부 끝낸 뒤 화면 반영은 따로 2단계에서 처리한다.
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        // 체비셰프 거리(Chebyshev distance): 가로/세로/대각선 이동을 동일하게 1칸으로 치는 거리 계산 방식.
        // 원형보다 정사각형에 가깝게 시야가 퍼지지만, 그리드 게임에서 흔히 쓰는 단순한 방식.
        const distance = Math.max(Math.abs(x - this.playerGridX), Math.abs(y - this.playerGridY));

        if (distance <= this.currentVisionRadius) {
          // 지금 시야 범위 안 → 밝게 표시
          this.tileStates[y]![x] = 'visible';
        } else if (this.tileStates[y]![x] !== 'hidden') {
          // 시야 밖이지만 예전에 한 번이라도 밝혀진 적 있음 → "지나간 길"로 기억, 어둡게 유지
          this.tileStates[y]![x] = 'explored';
        }
        // 그 외의 경우(distance도 밖이고 한 번도 안 가봄)는 계속 'hidden' 그대로 둠
      }
    }

    // 2단계: 계산이 끝난 상태를 바탕으로 실제 도형 밝기를 반영한다.
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        this.paintTile(x, y);
      }
    }

    // 연결 통로는 두 칸 중 더 어두운(덜 밝혀진) 쪽 밝기를 따른다 — 한쪽만 밝혀졌다고
    // 그 사이 길까지 다 보이면 안 가본 칸의 존재가 미리 드러나 버리기 때문.
    for (const connector of this.pathConnectors) {
      const alphaA = this.alphaForState(this.tileStates[connector.ay]![connector.ax]!);
      const alphaB = this.alphaForState(this.tileStates[connector.by]![connector.bx]!);
      connector.rect.setAlpha(Math.min(alphaA, alphaB));
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

  // 타일 상태(hidden/explored/visible)를 실제 화면 밝기(alpha)로 변환하는 함수.
  private alphaForState(state: TileState): number {
    if (state === 'hidden') return 0; // 완전 투명 → 검은 배경만 보여서 "안개로 덮인 것"처럼 보임
    if (state === 'explored') return 0.35; // 지나간 적 있지만 지금 시야 밖 → 어둡게
    return 1; // 지금 시야 안 → 원래 밝기 그대로
  }

  // 타일 상태에 맞춰 실제 화면에 보이는 밝기를 반영하는 함수.
  // 그 타일에 함정이 있으면 함정 마커도 같은 밝기로 함께 맞춰줌
  // (함정도 안개에 덮인 곳에서는 안 보여야 자연스러움 — 함정 탐지기 아이템이 있어야 볼 수 있는 구조).
  private paintTile(x: number, y: number) {
    const rect = this.tileRects[y]![x];
    if (!rect) return; // 벽 칸은 그려둔 도형이 없으니 안개 계산에서 제외

    const alpha = this.alphaForState(this.tileStates[y]![x]!);
    const trap = this.trapRects[y]?.[x];
    const footprint = this.footprintRects[y]?.[x];

    rect.setAlpha(alpha);
    trap?.setAlpha(alpha);
    footprint?.setAlpha(alpha);

    if (x === GOAL_POSITION.x && y === GOAL_POSITION.y) {
      this.goalRect.setAlpha(alpha);
    }
  }
}

// Phaser 게임 전체 설정.
// parent는 아래 App 컴포넌트에서 만든 div의 id와 반드시 이름이 같아야 함.
const phaserConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // 브라우저가 WebGL을 지원하면 WebGL로, 아니면 자동으로 Canvas 방식으로 그림
  parent: 'phaser-container',
  width: MAP_WIDTH * TILE_SIZE,
  height: MAP_HEIGHT * TILE_SIZE,
  backgroundColor: '#000000', // hidden 타일은 투명해서 이 검은 배경이 그대로 "안개"처럼 보임
  scene: [MazeScene],
};

export const App = () => {
  // useEffect(콜백, [])는 "이 컴포넌트가 화면에 처음 나타났을 때 딱 한 번" 실행됨.
  // React가 화면을 그리는 시점과 Phaser 게임이 시작되는 시점을 여기서 이어주는 역할.
  useEffect(() => {
    const game = new Phaser.Game(phaserConfig);

    // 컴포넌트가 화면에서 사라질 때(정리 함수) Phaser 게임도 같이 정리해서 메모리 누수를 막음
    return () => {
      game.destroy(true);
    };
  }, []);

  return (
    <div className="flex justify-center items-center min-h-screen bg-black">
      <div id="phaser-container" />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
