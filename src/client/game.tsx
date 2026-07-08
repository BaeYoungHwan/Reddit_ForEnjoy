import './index.css';

import Phaser from 'phaser';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// ── 임시 테스트용 맵 데이터 ──────────────────────────────
// 실제 맵(송원호님 담당)이 아직 안 나와서, 손으로 만든 15x15 배열로 먼저 테스트합니다.
// 나중에 진짜 맵 데이터가 나오면 이 배열만 통째로 교체하면 됩니다.
// (좌표 표현 방식 자체는 src/shared/game-types.ts 의 Position 타입과 맞춰뒀어서
//  로직을 다시 짤 필요 없이 데이터만 바꿔 끼우면 됩니다.)
// 중앙(x=7, y=7)에 상하좌우로 뚫린 십자 교차로를 일부러 만들어둠 — 슬라이드 함정이
// 위/아래/좌/우 어느 방향으로 진입해도 길게 미끄러질 수 있게 하기 위함.
//
// 0 = 바닥(이동 가능) / 1 = 벽(이동 불가)
const TEMP_MAP: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1],
  [1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1],
  [1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1],
  [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const TILE_SIZE = 64; // 타일 한 칸의 픽셀 크기 (정사각형 한 변의 길이)

// vision-system.md 스펙: 기본 시야 반경 2칸.
// 나중에 손전등(4칸)/시야차단 함정(0.5~1칸)을 만들 때 이 값을 상황에 맞게 바꿔주면 됨.
const VISION_RADIUS = 2;

// 한 칸 이동에 걸리는 기본 시간(ms).
const BASE_MOVE_DURATION = 150;

// 슬라이드 함정에 걸려 미끄러질 때, 한 칸당 걸리는 시간(ms).
// 기본 이동보다 짧게 줘서 "제어권을 잃고 빠르게 밀려나는" 느낌을 냄.
const SLIDE_STEP_DURATION = 80;

// 캐릭터 시작 위치 (테두리가 벽이라 그 안쪽 첫 바닥 칸). 리스폰 함정이 여길 기준으로 되돌림.
const SPAWN_POSITION = { x: 1, y: 1 };

// 골인 지점. 테스트용으로 시작점에서 먼 반대쪽 구석에 둠.
const GOAL_POSITION = { x: 13, y: 13 };

// 타일 하나가 지금 어떤 상태인지 3가지로 구분합니다.
// hidden   → 한 번도 안 가본 곳 (완전히 안 보임)
// explored → 예전에 가봤지만 지금은 시야 밖 (안개는 안 덮이지만 어둡게 표시 — "지나간 길" 기억)
// visible  → 지금 캐릭터 시야 범위 안 (원래 밝기로 표시)
type TileState = 'hidden' | 'explored' | 'visible';

// traps.md 기준 함정 4종. (slow → slide로 이름 변경: 이제 "느려지는" 효과가 아니라
// "미끄러지는" 효과라서, 이름이 효과와 안 맞아 팀원이 헷갈릴 수 있다는 의견 반영)
type TrapType = 'slide' | 'respawn' | 'blind' | 'reverse';
type TrapDef = { x: number; y: number; type: TrapType };

// 함정 종류별 마커 색 (진짜 아트 나오기 전 임시 표시)
const TRAP_COLORS: Record<TrapType, number> = {
  slide: 0x3399ff, // 파랑
  respawn: 0xaa00ff, // 보라
  blind: 0x888888, // 회색
  reverse: 0xff8800, // 주황
};

// 임시 테스트용 함정 배치.
// 실제로는 배영환님의 서버 데이터(src/shared/game-types.ts의 TrapInstance[])로 대체될 예정.
// 지금은 "함정을 밟았을 때 어떤 이펙트가 나오는지"만 확인하는 용도라 좌표를 직접 박아둠.
// 슬라이드 함정은 십자 교차로 정중앙(7,7)에 둠 — 위/아래/좌/우 어느 방향으로 밟아도
// 그 방향으로 길게 뚫린 통로가 있어서 자연스럽게 미끄러지는 걸 확인할 수 있음.
const TEMP_TRAPS: TrapDef[] = [
  { x: 7, y: 7, type: 'slide' },
  { x: 11, y: 10, type: 'respawn' },
  { x: 11, y: 3, type: 'blind' },
  { x: 3, y: 11, type: 'reverse' },
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

  // Phaser가 제공하는 "방향키 입력 감지" 객체 (매 프레임 자동으로 눌림 상태를 갱신해줌)
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // 캐릭터를 표시할 도형. 지금은 진짜 캐릭터 이미지가 없어서 노란 네모로 대체.
  // 나중에 아트가 나오면 이 부분만 스프라이트 이미지로 교체하면 됨.
  private playerRect!: Phaser.GameObjects.Rectangle;

  // 타일마다 그려둔 사각형들을 [y][x] 좌표로 저장해둠.
  // 안개 상태가 바뀔 때마다 "다시 그리기"가 아니라 "이미 그려둔 도형의 밝기만 조정"하는 방식으로 처리.
  private tileRects: Phaser.GameObjects.Rectangle[][] = [];

  // 각 타일의 현재 상태(hidden/explored/visible)를 기억해두는 표
  private tileStates: TileState[][] = [];

  // 함정 마커 도형. TEMP_TRAPS에 있는 좌표에만 존재. 안개 상태에 맞춰 같이 밝기 조정됨
  // (함정 탐지기 아이템 없이는 안개에 덮인 함정이 안 보이게 하기 위함).
  private trapRects: (Phaser.GameObjects.Arc | undefined)[][] = [];

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
  // 지금은 이미지 없이 색깔 사각형만 쓰기 때문에 비워둡니다.
  preload() {}

  // create(): 게임이 시작될 때 딱 한 번만 실행됨. 여기서 맵과 캐릭터를 화면에 배치합니다.
  create() {
    // 맵 크기만큼 타일 상태/도형 배열을 준비하고, 타일을 하나씩 그림
    for (let y = 0; y < TEMP_MAP.length; y++) {
      this.tileRects[y] = [];
      this.tileStates[y] = [];
      this.trapRects[y] = [];

      for (let x = 0; x < TEMP_MAP[y]!.length; x++) {
        const isWall = TEMP_MAP[y]![x] === 1;

        // this.add.rectangle(중심x, 중심y, 너비, 높이, 색상) → 사각형 하나를 화면에 그려줌
        // TILE_SIZE - 2로 살짝 여백을 둬서 타일 사이에 격자 선처럼 보이게 함
        const rect = this.add.rectangle(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          TILE_SIZE - 2,
          TILE_SIZE - 2,
          isWall ? 0x3a2a1a : 0x555555 // 벽=짙은 갈색, 바닥=회색 (진짜 아트 나오기 전 임시 색)
        );

        this.tileRects[y]![x] = rect;
        this.tileStates[y]![x] = 'hidden'; // 시작할 땐 전부 안개로 덮인 상태
      }
    }

    // 함정 마커를 배치 (테스트용 고정 좌표 — TEMP_TRAPS 참고)
    for (const trap of TEMP_TRAPS) {
      const marker = this.add.circle(
        trap.x * TILE_SIZE + TILE_SIZE / 2,
        trap.y * TILE_SIZE + TILE_SIZE / 2,
        TILE_SIZE * 0.22,
        TRAP_COLORS[trap.type]
      );
      marker.setDepth(6); // 타일(기본 depth 0)보다 위, 캐릭터(depth 10)보다 아래
      this.trapRects[trap.y]![trap.x] = marker;
    }

    // 골인 지점 마커 배치 (초록색 사각형)
    this.goalRect = this.add.rectangle(
      GOAL_POSITION.x * TILE_SIZE + TILE_SIZE / 2,
      GOAL_POSITION.y * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE * 0.8,
      TILE_SIZE * 0.8,
      0x33ff66
    );
    this.goalRect.setDepth(6);

    // 캐릭터를 맵 (1,1) 칸(SPAWN_POSITION)에 배치 (테두리는 벽이라 그 안쪽 첫 바닥 칸부터 시작).
    // 일단 노란 사각형으로 표현 (나중에 실제 캐릭터 이미지로 교체 예정)
    this.playerGridX = SPAWN_POSITION.x;
    this.playerGridY = SPAWN_POSITION.y;
    this.playerRect = this.add.rectangle(
      this.playerGridX * TILE_SIZE + TILE_SIZE / 2,
      this.playerGridY * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE * 0.6,
      TILE_SIZE * 0.6,
      0xffd400
    );
    this.playerRect.setDepth(10); // depth(그리기 순서)를 높여서 타일 위에 캐릭터가 보이게 함

    // 키보드의 방향키 입력을 받을 수 있도록 설정.
    // 이후 update()에서 this.cursors.left/right/up/down 으로 눌림 여부를 확인할 수 있음.
    this.cursors = this.input.keyboard!.createCursorKeys();

    // 게임 시작하자마자 시작 지점 기준으로 시야(안개)부터 계산해서 보여줌
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

  // 그리드 좌표(x, y)로 이동/통과 가능한지 확인하는 함수 (맵 범위 안 + 벽 아님).
  // 일반 이동(tryMove)과 슬라이드(slideStep) 둘 다 같은 기준으로 판정해야 해서 하나로 뽑아둠.
  private isWalkable(x: number, y: number): boolean {
    const isOutOfBounds =
      y < 0 || y >= TEMP_MAP.length || x < 0 || x >= TEMP_MAP[0]!.length;
    if (isOutOfBounds) return false;

    return TEMP_MAP[y]![x] === 0;
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

        // 도착한 칸에 함정이 있는지 확인. dx, dy(눌렀던 방향)를 같이 넘겨서
        // 슬라이드 함정이 "어느 방향으로 미끄러질지" 알 수 있게 함.
        this.checkTrapTrigger(targetX, targetY, dx, dy);
      },
    });

    // 위치가 바뀌었으니 시야(안개)도 다시 계산
    this.updateFog();
  }

  // 방금 도착한 칸에 함정이 있는지 확인하고, 있으면 종류에 맞는 효과를 적용하는 함수.
  // dx, dy는 지금 막 이동해온 방향 (슬라이드 함정이 미끄러질 방향을 정하는 데 사용).
  private checkTrapTrigger(x: number, y: number, dx: number, dy: number) {
    const trap = TEMP_TRAPS.find((t) => t.x === x && t.y === y);
    if (!trap) return;

    if (trap.type === 'slide') this.applySlideTrap(dx, dy);
    else if (trap.type === 'respawn') this.applyRespawnTrap();
    else if (trap.type === 'blind') this.applyBlindTrap();
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
    this.flashPlayer(TRAP_COLORS.slide);
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
    this.updateFog();

    // 일반 이동(BASE_MOVE_DURATION)보다 짧은 시간으로 빠르게 미끄러지는 느낌을 냄.
    // 슬라이딩 도중 지나가는 칸에 다른 함정이 있어도 이번 구현에서는 재발동시키지 않음
    // (여러 함정 중첩 처리는 traps.md에도 "안 정해짐"으로 남아있어 임의로 정하지 않음).
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
    for (let y = 0; y < TEMP_MAP.length; y++) {
      for (let x = 0; x < TEMP_MAP[y]!.length; x++) {
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
    for (let y = 0; y < TEMP_MAP.length; y++) {
      for (let x = 0; x < TEMP_MAP[y]!.length; x++) {
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
        (TEMP_MAP[0]!.length * TILE_SIZE) / 2,
        (TEMP_MAP.length * TILE_SIZE) / 2,
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
    for (let y = 0; y < TEMP_MAP.length; y++) {
      for (let x = 0; x < TEMP_MAP[y]!.length; x++) {
        // 체비셰프 거리(Chebyshev distance): 가로/세로/대각선 이동을 동일하게 1칸으로 치는 거리 계산 방식.
        // 원형보다 정사각형에 가깝게 시야가 퍼지지만, 그리드 게임에서 흔히 쓰는 단순한 방식.
        const distance = Math.max(
          Math.abs(x - this.playerGridX),
          Math.abs(y - this.playerGridY)
        );

        if (distance <= this.currentVisionRadius) {
          // 지금 시야 범위 안 → 밝게 표시
          this.tileStates[y]![x] = 'visible';
        } else if (this.tileStates[y]![x] !== 'hidden') {
          // 시야 밖이지만 예전에 한 번이라도 밝혀진 적 있음 → "지나간 길"로 기억, 어둡게 유지
          this.tileStates[y]![x] = 'explored';
        }
        // 그 외의 경우(distance도 밖이고 한 번도 안 가봄)는 계속 'hidden' 그대로 둠

        this.paintTile(x, y);
      }
    }
  }

  // 타일 상태(hidden/explored/visible)에 맞춰 실제 화면에 보이는 밝기를 반영하는 함수.
  // 그 타일에 함정이 있으면 함정 마커도 같은 밝기로 함께 맞춰줌
  // (함정도 안개에 덮인 곳에서는 안 보여야 자연스러움 — 함정 탐지기 아이템이 있어야 볼 수 있는 구조).
  private paintTile(x: number, y: number) {
    const rect = this.tileRects[y]![x]!;
    const state = this.tileStates[y]![x]!;
    const trap = this.trapRects[y]?.[x];

    let alpha: number;
    if (state === 'hidden') {
      alpha = 0; // 완전 투명 → 검은 배경만 보여서 "안개로 덮인 것"처럼 보임
    } else if (state === 'explored') {
      alpha = 0.35; // 지나간 적 있지만 지금 시야 밖 → 어둡게
    } else {
      alpha = 1; // 지금 시야 안 → 원래 밝기 그대로
    }

    rect.setAlpha(alpha);
    trap?.setAlpha(alpha);

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
  width: TEMP_MAP[0]!.length * TILE_SIZE,
  height: TEMP_MAP.length * TILE_SIZE,
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
