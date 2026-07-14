import type { Position } from './game-types';

export type TileType = 'wall' | 'floor' | 'exit';

export type MazeMap = {
  id: string;
  name: string;
  grid: TileType[][];
  start: Position;
  exit: Position;
};

const LEGEND: Record<string, TileType> = {
  '#': 'wall',
  '.': 'floor',
  S: 'floor',
  E: 'exit',
};

function parseLayout(id: string, name: string, rows: string[]): MazeMap {
  const grid = rows.map((row) => row.split('').map((ch) => LEGEND[ch] ?? 'wall'));
  let start: Position = { x: 0, y: 0 };
  let exit: Position = { x: 0, y: 0 };

  rows.forEach((row, y) => {
    row.split('').forEach((ch, x) => {
      if (ch === 'S') start = { x, y };
      if (ch === 'E') exit = { x, y };
    });
  });

  return { id, name, grid, start, exit };
}

// 2026-07-10 1차 재설계: 기존 레이아웃은 골인 지점이 시작점의 정반대 모서리(우측 하단
// 코너)에 있어서 "그냥 대각선으로 쭉 가면 된다"는 게 너무 뻔히 보였음(예측 가능성 문제).
// 2026-07-10 2차 재설계: 1차 결과물이 여전히 직선 통로 위주였고 실제 갈림길(3방향 이상
// 열린 교차로)이 적었음 → 크기를 키우고 루프(순환 경로) 개방 비율을 늘려 교차로 수를
// 10개 안팎에서 40~49개로 늘렸음.
// 2026-07-10 3차 재설계(핵심 인사이트 반영): "지나간 타일은 안개가 안 다시 덮이고 계속
// 보인다"는 설계(vision-system.md, 시야차단 함정 페널티의 전제조건이라 유지하기로 결정)를
// 감안하면, 체감 복잡도는 "교차로가 몇 개인가"가 아니라 "잘못된 갈래로 들어갔을 때 되돌아
// 나오는 대가가 얼마나 큰가"로 결정된다는 걸 뒤늦게 확인함 — 루프를 늘리면 오히려 우회로가
// 많아져서 막다른 길에서 쉽게 빠져나올 수 있게 돼 체감 난이도가 낮아짐(2차 재설계는 방향이
// 틀렸었음). 그래서 루프 개방 비율을 오히려 2차보다 크게 낮춰(약 20% -> 3%) 순수 트리형
// 미로에 가깝게 만들어 막다른 길 개수/깊이를 극대화함(측정치: 교차로 40~49개 -> 13개,
// 막다른 길 10개, 골인까지 최단거리 62칸 -> 90칸으로 오히려 늘어남 — 우회로가 없어져서
// "최단 경로 자체"가 길어진 것도 난이도 상승에 기여). 크기는 25x21 그대로 유지, 슬라이드
// 함정용 긴 직선 구간은 "직전 방향을 확률적으로 이어가는" 생성 편향으로 여전히 확보(러너웨이
// 6칸 이상인 칸이 160곳). 골인 지점은 여전히 모서리가 아닌 미로 내부. 생성/검증 스크립트는
// 시드 고정 recursive-backtracker(방향 유지 편향 포함) + 소량 루프 + BFS 도달성/러너웨이
// 계산 방식(재현 가능) — 함정/아이템 스폰 좌표도 전부 이 레이아웃 기준으로 다시 확인해
// 갱신함(server/core/items.ts, game.tsx의 TEMP_ITEMS/myTraps 폴백도 같이 확인할 것).
// 2026-07-10 4차 재설계(피드백 반영): 3차도 실제 플레이해보니 "안개 걷힌 곳도 아닌데
// 시야가 뚫려 보인다"는 별도 버그(체비셰프 거리 기반 시야 판정이 벽을 무시함 — game.tsx
// updateFog, 1️⃣ 임소리와 별도 논의 예정)로 인해 조기에 골인 지점이 보여버리는 문제가
// 있었고, 그와 별개로 "실제로 걸어가는 경로상의 갈림길"이 여전히 적다는 피드백 → 원인은
// loopRatio가 아니라 continueBias(0.55)가 recursive-backtracker의 자연스러운 분기 자체를
// 억누르고 있었기 때문으로 재진단, continueBias를 0.55 -> 0.15로 낮춤(loopRatio 3%는 유지).
// 측정 지표를 "맵 전체 교차로 수"에서 "실제 시작→골인 최단경로가 지나는 교차로 수"로
// 바꿔서 비교(더 정확한 체감 난이도 지표) — 이전 레이아웃 기준 경로 91칸에 교차로 7개
// (약 13칸당 1개)였던 게, 이번 레이아웃은 경로 124칸에 교차로 12개(약 10칸당 1개)로 밀도
// 개선. 골인 지점은 여전히 모서리가 아닌 미로 내부. 아이템 스폰도 "각 아이템 기능에 맞는
// 위치"로 재배치(손전등=중반 미로 밀집 구간 진입 직전, 쉴드=초반 보호용, 함정 탐지기=후반
// 구간 진입 직전 — 아래 server/core/items.ts 참고).
const MAP_1_LAYOUT = [
  '#########################',
  '#S..#.....#...#...#.....#',
  '###.###.#.#.###.#.#.###.#',
  '#.#.....#.#.....#...#...#',
  '#.#######.#####.###.#.###',
  '#.......#.#...#.#...#...#',
  '#####.#.#.#.#.#.#.#.###.#',
  '#.....#.#...#.#E#.#.#...#',
  '#.###########.#.###.#.#.#',
  '#.#.........#.#.....#.#.#',
  '#.#.#.#.###.#.#####.#.#.#',
  '#...#.#.#.#...#...#.#.#.#',
  '#####.#.#.#####.#.###.#.#',
  '#.....#.....#...#...#.#.#',
  '#.#########.#.#####.#.#.#',
  '#...#.......#...#.....#.#',
  '#.#.#.#######.#.#######.#',
  '#.#...#.......#...#...#.#',
  '#.###########.###.#.###.#',
  '#.................#.....#',
  '#########################',
];

// 2026-07-13 데일리 맵 로테이션 착수: map-1의 4차 재설계에서 확정된 생성 파라미터
// (recursive-backtracker, continueBias=0.15, loopRatio=0.03, 25x21)를 그대로 재사용해
// map-2를 생성 — 이번엔 수작업 시행착오 대신 자동 스코어링으로 시드를 선정(스크립트:
// gen-map2.mjs, 세션 스크래치패드). 선정 기준(map-1 실측치와 동일선상): 시작→골인 최단거리
// 100~145칸, 최단경로상 교차로 밀도 10칸당 1개에 최대한 근접, 슬라이드 함정용 러너웨이(6칸
// 이상, 진입 가능 방향 한정) 후보 3곳 이상. 시드 389 선정 결과: 최단거리 140칸, 교차로
// 밀도 10.0칸당 1개(map-1과 동일), 러너웨이 후보 36곳.
const MAP_2_LAYOUT = [
  '#########################',
  '#S#...................#.#',
  '#.#.#.#######.###.#.#.#.#',
  '#.#.#.#.....#...#.#.#...#',
  '#.###.#####.#.#.#.#.###.#',
  '#...#.#.....#...#...#.#.#',
  '###.#.#.#####.#####.#.#.#',
  '#.#...#.....#.......#...#',
  '#.#####.###.#########.###',
  '#.#...#.#.#.......#.#...#',
  '#.#.#.#.#.#####.#.#.###.#',
  '#...#...#.....#.#...#...#',
  '#.#######.#.###.#####.###',
  '#.....#...#...#.....#.#.#',
  '#####.###.###.#####.#.#.#',
  '#...#...#.#E#.....#...#.#',
  '#.#####.#.#.###.#.#####.#',
  '#...#...#...#...#.#.....#',
  '#.#.#.#######.###.###.#.#',
  '#.#...........#.......#.#',
  '#########################',
];

export const MAZE_MAPS: Record<string, MazeMap> = {
  'map-1': parseLayout('map-1', '첫 번째 미로', MAP_1_LAYOUT),
  'map-2': parseLayout('map-2', '두 번째 미로', MAP_2_LAYOUT),
};

// 스플래시(메인) 화면 배경 전용 장식 미로 — 오늘 실제로 플레이할 맵과 완전히 무관하다(배경만
// 봐도 오늘의 미로 구조가 스포일러되는 문제, 2026-07-14 피드백으로 분리). 의도적으로
// MAZE_MAPS엔 등록하지 않는다 — pickDailyMapId/getMazeMap이 절대 이 맵을 실제 플레이 맵으로
// 고르면 안 되기 때문. 생성 방식은 실제 플레이 맵들과 동일(recursive-backtracker,
// continueBias=0.15, loopRatio=0.03, 25x21, map-2와 같은 자동 스코어링 스크립트)이라 시각적
// 스타일은 유지하면서 내용만 다르다. map-1/map-2와 마찬가지로 maps.test.ts에서 무결성(그리드
// 크기, S/E 파싱, 도달 가능성)을 검증한다.
const SPLASH_BACKGROUND_LAYOUT = [
  '#########################',
  '#S....#.......#...#...#.#',
  '#####.#.#####.#.#.#.#.#.#',
  '#...#.#.#..E#...#.#.#...#',
  '#.###.#.#.#######.#.###.#',
  '#.....#.#...#...#.#.....#',
  '#.#####.###.#.#.#.#.#.#.#',
  '#.........#...#.#...#.#.#',
  '#.#.#####.###.#.###.#.#.#',
  '#.#...#.#...#.#...#.#.#.#',
  '#.###.#.###.###.#.#.#.#.#',
  '#...#.....#...#.#.#.#.#.#',
  '###.#########.###.#.###.#',
  '#.#.#.........#...#.....#',
  '#.#.#.#########.#######.#',
  '#...#.#.#.....#.......#.#',
  '#.###.#.#.###.#.###.###.#',
  '#...#.#.#.#.#...#.#.....#',
  '###.#.#.#.#.#####.#######',
  '#.....#.................#',
  '#########################',
];
export const SPLASH_DECORATIVE_MAP: MazeMap = parseLayout(
  'splash-decorative',
  '스플래시 장식용 미로',
  SPLASH_BACKGROUND_LAYOUT
);

// 데일리 맵 로테이션 — KST 날짜 문자열(YYYY-MM-DD)을 해시해 등록된 맵 중 하나를 결정론적으로
// 고른다(매일 같은 날짜엔 항상 같은 맵, 팀원 전체가 항상 같은 맵을 봄). 등록된 맵이 1개뿐이면
// 항상 그 맵 하나만 나오므로, map-3 이상을 추가해도 이 함수는 그대로 재사용 가능하다.
export function pickDailyMapId(kstDateString: string): string {
  const ids = Object.keys(MAZE_MAPS).sort();
  if (ids.length === 0) throw new Error('MAZE_MAPS가 비어있음');
  let hash = 0;
  for (let i = 0; i < kstDateString.length; i++) {
    hash = (hash * 31 + kstDateString.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % ids.length;
  return ids[index]!;
}

// isRegisteredMapId로 폴백 여부를 판정한다 — `MAZE_MAPS[mapId] ?? MAZE_MAPS['map-1']!` 형태로
// 직접 접근하면 mapId==='constructor' 같은 값이 Object.prototype 체인을 타고 truthy를 반환해
// 폴백이 발동하지 않는다. server/trpc.ts가 클라이언트 입력(mapId: z.string().min(1), 화이트리스트
// 검증 없음)을 그대로 이 함수에 넘기므로(getMapStartPosition 경유) 서버까지 뚫리는 취약점이었다
// (2026-07-14 PR#60 리뷰에서 발견 — 처음엔 클라이언트 ?map= 오버라이드만 고쳤다가, getMazeMap
// 자체가 여전히 취약해 서버 map.getState가 mapId='constructor' 한 번으로 크래시하는 걸 재확인).
export function getMazeMap(mapId: string): MazeMap {
  return isRegisteredMapId(mapId) ? MAZE_MAPS[mapId]! : MAZE_MAPS['map-1']!;
}

// mapId 문자열이 실제로 등록된 맵인지 검증한다. `mapId in MAZE_MAPS`로 직접 검사하면 MAZE_MAPS가
// 일반 객체 리터럴이라 Object.prototype까지 검사 대상에 들어가 'constructor'/'toString' 같은
// 값도 통과해버린다(2026-07-14 PR#60 리뷰에서 발견) — hasOwnProperty로 프로토타입 체인을 배제한다.
export function isRegisteredMapId(mapId: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAZE_MAPS, mapId);
}

const ADJACENT_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// 시작(start)에서 골인(exit)까지 실제로 도달 가능한지, 특정 한 칸(excludedKey)을 지나갈 수
// 없다고 가정하고 BFS로 확인한다. computeMandatoryPathTiles 전용 내부 헬퍼.
function canReachExitWithout(map: MazeMap, excludedKey: string): boolean {
  const { grid, start, exit } = map;
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const startKey = `${start.x},${start.y}`;
  if (startKey === excludedKey) return false;

  const visited = new Set<string>([startKey]);
  const queue: Position[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur.x === exit.x && cur.y === exit.y) return true;
    for (const [dx, dy] of ADJACENT_DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid[ny]![nx] === 'wall') continue;
      const key = `${nx},${ny}`;
      if (key === excludedKey || visited.has(key)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

// 2026-07-14 임소리 요청(미스터리 박스 랜덤 스폰 도입에 맞춰 신설): 시작→골인 사이에서
// "이 칸을 지나가지 않고는 골인에 도달할 방법이 없는" 칸들의 집합을 계산한다(각 후보 칸을
// 하나씩 그래프에서 제거해보고 그래도 골인 도달이 가능한지 BFS로 확인 — 트리형 미로라
// loopRatio가 낮아 이런 칸이 많다, maps.ts 상단 4차 재설계 주석 참고). 미스터리 박스(아이템/
// 함정 공용 스폰)가 이런 칸에 떨어지면, 함정 탐지기로 미리 알아내도 피해갈 방법 자체가 없어
// "탐지"라는 아이템의 의미가 없어진다 — 랜덤 스폰 후보에서 이 칸들을 제외하기 위한 함수.
// 시작/골인 칸 자체는 스폰 후보 판정에서 별도로 걸러지므로 이 집합에 포함하지 않는다.
// 맵 크기가 작아(25x21 안팎) 후보 칸마다 BFS를 새로 도는 O(V*(V+E)) 방식도 충분히 빠르다
// (실측 약 30ms/맵). 다만 이 계산은 미스터리 박스를 새로 심을 때마다(하루 첫 판/재도전마다)
// 매번 처음부터 다시 도는데, 결과는 맵 레이아웃(고정 상수)에만 의존해 절대 안 바뀌므로 —
// 2026-07-14 임소리: 유저가 늘어날 경우를 대비해 mapId 기준으로 한 번만 계산하고 재사용하도록
// 메모이즈. 캐시는 프로세스 생존 기간 동안만 유지(서버 재시작 시 그냥 다시 계산될 뿐 — 별도
// 무효화 로직 불필요, 맵 데이터가 코드 배포 없이는 안 바뀌므로 stale 걱정 없음).
const mandatoryPathTilesCache = new Map<string, Set<string>>();

export function computeMandatoryPathTiles(map: MazeMap): Set<string> {
  const cached = mandatoryPathTilesCache.get(map.id);
  if (cached) return cached;

  const { grid, start, exit } = map;
  const mandatory = new Set<string>();

  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y]!.length; x++) {
      if (grid[y]![x] !== 'floor') continue;
      if (x === start.x && y === start.y) continue;
      if (x === exit.x && y === exit.y) continue;
      if (!canReachExitWithout(map, `${x},${y}`)) {
        mandatory.add(`${x},${y}`);
      }
    }
  }

  mandatoryPathTilesCache.set(map.id, mandatory);
  return mandatory;
}
