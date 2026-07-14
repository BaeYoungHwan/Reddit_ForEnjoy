import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import {
  StrictMode,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { useLeaderboard } from './hooks/useLeaderboard';
import { useMyUserId } from './hooks/useMyUserId';
import { angleBetween, buildMazeBackground, findPath, tileToPercent } from './mazePattern';
import { formatClearTime } from './format';
import { MAZE_MAPS, getMazeMap, pickDailyMapId } from '../shared/maps';
import { getKstDateString } from '../shared/kstDate';
import type { LeaderboardEntry } from '../shared/game-types';
import { LOADOUT_STORAGE_KEY, type LoadoutId } from './loadout';

// 공용 버튼 클릭음(public/sounds/ui-click.mp3) — 로드아웃 화면의 아이템 선택/확정 버튼은
// 이번 스코프에서 제외(사용자 지시)라 일부러 안 붙임. Phaser가 아니라 순수 React 화면이라
// game.tsx의 Phaser Sound Manager 대신 가벼운 HTMLAudioElement로 재생한다.
function playUiClickSound() {
  try {
    void new Audio('/sounds/ui-click.mp3').play();
  } catch {
    // 자동재생 정책 등으로 재생이 막혀도 화면 전환 자체는 계속 진행돼야 한다.
  }
}

// 2026-07-13 데일리 맵 로테이션 — game.tsx와 동일한 함수로 오늘의 맵을 고른다(같은 날엔
// 항상 같은 맵을 보도록, 스플래시 미리보기와 실제 게임 화면이 어긋나지 않게). game.tsx와
// 동일하게 로컬 프리뷰 한정 ?map= 오버라이드도 지원(QA 편의용, 실배포 영향 없음).
const IS_LOCAL_PREVIEW = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// 등록 안 된 값이면 무시(폴백) — game.tsx와 동일한 이유(2026-07-13 리뷰에서 발견).
const rawMapOverride = IS_LOCAL_PREVIEW ? new URLSearchParams(window.location.search).get('map') : null;
const MAP_ID_OVERRIDE = rawMapOverride && rawMapOverride in MAZE_MAPS ? rawMapOverride : null;
const DEFAULT_MAP_ID = MAP_ID_OVERRIDE ?? pickDailyMapId(getKstDateString());
const MAIN_MAP = getMazeMap(DEFAULT_MAP_ID);
const MAIN_MAP_BACKGROUND = buildMazeBackground(MAIN_MAP);

const WALK_STRIDE = 2;
const STEP_INTERVAL_SEC = 0.45;
const WALK_ICON_SIZES = ['w-5 h-5', 'w-6 h-6'];

const FULL_WALK_PATH = findPath(MAIN_MAP);
const WALK_TILES = FULL_WALK_PATH.filter(
  (_, i) => i % WALK_STRIDE === 0 || i === FULL_WALK_PATH.length - 1
);

// 전체 발자국이 한 바퀴 도는 데 걸리는 시간 — 이 값을 모든 발자국이 animation-duration으로 공유하고,
// 각자 delay만 다르게 줘서 순서대로 나타나는 것처럼 보이게 한다(무한 반복, JS 타이머 없이 CSS만으로 동작).
const WALK_CYCLE_SEC = Math.max(FULL_WALK_PATH.length * (STEP_INTERVAL_SEC / WALK_STRIDE), 3);

const FOOTPRINTS = WALK_TILES.map((tile, i) => {
  const next = WALK_TILES[i + 1];
  const prev = WALK_TILES[i - 1];
  // 다음 타일이 있으면 그쪽을 향하고, 마지막 타일이면 이전 타일→현재 방향(진행 방향 유지)을 그대로 쓴다.
  const rotateDeg = next ? angleBetween(tile, next) : prev ? angleBetween(prev, tile) : 0;
  return {
    ...tileToPercent(MAIN_MAP, tile),
    rotate: `${rotateDeg}deg`,
    delay: `${i * STEP_INTERVAL_SEC}s`,
    size: WALK_ICON_SIZES[i % WALK_ICON_SIZES.length]!,
  };
});

type View = 'menu' | 'howToPlay' | 'loadout' | 'leaderboard';

// LoadoutId/LOADOUT_STORAGE_KEY는 ./loadout.ts로 옮겨서 game.tsx와 공유한다(2026-07-10 —
// 처음엔 여기 로컬로 정의했었는데, game.tsx가 이 값을 전혀 안 읽어서 로드아웃 선택이 실제
// 게임에 반영 안 되는 문제가 있었음 — PR #33 리뷰에서 발견, applyLoadout으로 연결).

const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-400 border-amber-600 text-amber-950',
  2: 'bg-slate-300 border-slate-500 text-slate-900',
  3: 'bg-orange-300 border-orange-600 text-orange-950',
};

const RankBadge = ({ rank }: { rank: number }) => (
  <span
    className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-black border-2 shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_-1px_2px_rgba(0,0,0,0.35)] ${
      RANK_STYLES[rank] ?? 'bg-slate-800 border-slate-700 text-slate-400'
    }`}
  >
    {rank}
  </span>
);

const Rivet = ({ className }: { className: string }) => (
  <span
    aria-hidden
    className={`absolute w-3 h-3 rounded-full bg-gradient-to-br from-slate-500 to-slate-800 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),inset_0_-1px_1px_rgba(0,0,0,0.6)] ${className}`}
  />
);

const RivetPanel = ({ children }: { children: ReactNode }) => (
  <div className="relative rounded-[28px] bg-gradient-to-b from-slate-700 to-slate-800 p-[3px] shadow-2xl">
    <Rivet className="left-2 top-2" />
    <Rivet className="right-2 top-2" />
    <Rivet className="left-2 bottom-2" />
    <Rivet className="right-2 bottom-2" />
    <div className="relative flex flex-col items-center gap-5 w-full rounded-[25px] bg-slate-900/95 border border-slate-950 px-6 py-8 shadow-[inset_0_2px_4px_rgba(0,0,0,0.5)] overflow-hidden">
      {children}
    </div>
  </div>
);

const RankIcon = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <rect x="2.5" y="12.5" width="5" height="9" rx="1.5" />
    <rect x="9.5" y="6" width="5" height="15.5" rx="1.5" />
    <rect x="16.5" y="9.5" width="5" height="12" rx="1.5" />
  </svg>
);

const HudButton = ({ onClick, label, icon }: { onClick: () => void; label: string; icon: ReactNode }) => (
  <button
    className="absolute top-4 right-4 z-20 flex items-center justify-center w-11 h-11 rounded-full bg-slate-800/90 border-2 border-slate-950 text-slate-200 shadow-lg cursor-pointer select-none transition active:translate-y-[1px] hover:brightness-110 hover:text-white"
    onClick={onClick}
    aria-label={label}
  >
    {icon}
  </button>
);

const PlayButton = ({ onClick }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void }) => (
  <button
    className="relative flex flex-col items-center justify-center gap-0.5 w-24 h-24 rounded-full bg-gradient-to-b from-[#ff7a4d] to-[#d93900] border-b-[5px] border-[#7a2400] text-white animate-glow-pulse cursor-pointer select-none transition active:translate-y-[3px] active:border-b-[2px] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
    onClick={onClick}
  >
    <span
      aria-hidden
      className="absolute inset-x-3 top-2.5 h-1/4 rounded-full bg-white/25 blur-[3px] pointer-events-none"
    />
    <span className="relative text-2xl drop-shadow-[1px_1px_0_rgba(0,0,0,0.25)]">▶</span>
    <span className="relative font-display text-xs tracking-wide drop-shadow-[1px_1px_0_rgba(0,0,0,0.25)]">
      Play
    </span>
  </button>
);

type StepIconStyle = CSSProperties & { '--step-rotate'?: string };

const FootprintIcon = ({
  className,
  style,
}: {
  className?: string;
  style?: StepIconStyle;
}) => (
  <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden>
    {/* 발바닥(발볼+뒤꿈치) */}
    <ellipse cx="12" cy="8" rx="5" ry="4.2" />
    <ellipse cx="12" cy="17" rx="3.8" ry="4.8" />
    {/* 발가락 5개 */}
    <ellipse cx="6.6" cy="4.6" rx="1.6" ry="2.1" />
    <ellipse cx="9.6" cy="2.7" rx="1.4" ry="1.9" />
    <ellipse cx="12.7" cy="2.3" rx="1.4" ry="1.9" />
    <ellipse cx="15.5" cy="2.9" rx="1.3" ry="1.7" />
    <ellipse cx="17.8" cy="4.7" rx="1.1" ry="1.4" />
  </svg>
);

// 로드아웃 3종 아이콘 — RankIcon처럼 currentColor 기반 단순 도형으로 통일.
const TrapDetectorIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="11" cy="11" r="6.5" />
    <line x1="15.7" y1="15.7" x2="21" y2="21" strokeLinecap="round" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor" aria-hidden>
    <path d="M12 2.5 4.5 5.5v6c0 5 3.2 8.6 7.5 10 4.3-1.4 7.5-5 7.5-10v-6L12 2.5Z" />
  </svg>
);

const FlashlightIcon = () => (
  <svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden>
    <path d="M8.2 11 9 6.5h6l0.8 4.5H8.2Z" fill="currentColor" />
    <rect x="9" y="11" width="6" height="10" rx="1.5" fill="currentColor" />
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="12" y1="3.5" x2="12" y2="1.3" />
      <line x1="7.8" y1="4.7" x2="6.3" y2="3.1" />
      <line x1="16.2" y1="4.7" x2="17.7" y2="3.1" />
    </g>
  </svg>
);

// 로드아웃 카드가 선택됐을 때 오른쪽에 뜨는 작은 체크 배지. 배지 배경(bg-current)이
// 카드의 accent 색을 그대로 물려받으므로, 체크 표시 자체는 그 반대색(어두운 배경)으로 그려야
// 잘 보인다 — 부모(button)의 currentColor가 아니라 슬레이트 950 고정색을 씀.
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="#020617" strokeWidth="3" aria-hidden>
    <path d="M4 12.5 9.5 18 20 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// 3종 로드아웃 정의 — 색은 게임 화면(game.tsx ITEM_COLORS)의 손전등/쉴드 색과 맞추고,
// 함정 탐지기는 기존 함정 4색(파랑/보라/회색/주황)과 안 겹치는 에메랄드로 새로 지정.
// iconAccent는 선택 여부와 무관하게 항상 적용 — 처음부터 아이콘이 각자 색을 띠어야
// 글자를 안 읽어도 세 옵션이 한눈에 구분된다(accent는 카드가 "선택됐을 때"만 적용).
const LOADOUT_OPTIONS: {
  id: LoadoutId;
  label: string;
  description: string;
  icon: ReactNode;
  accent: string;
  iconAccent: string;
}[] = [
  {
    id: 'trapDetector',
    label: 'Trap Detector',
    description: 'Briefly reveals nearby traps',
    icon: <TrapDetectorIcon />,
    accent: 'text-emerald-300 border-emerald-500/60 bg-emerald-500/10',
    iconAccent: 'text-emerald-400 bg-emerald-500/15',
  },
  {
    id: 'shield',
    label: 'Trap Shield',
    description: 'Blocks the next trap you hit',
    icon: <ShieldIcon />,
    accent: 'text-cyan-300 border-cyan-500/60 bg-cyan-500/10',
    iconAccent: 'text-cyan-400 bg-cyan-500/15',
  },
  {
    id: 'flashlight',
    label: 'Flashlight',
    description: 'See farther for a short while',
    icon: <FlashlightIcon />,
    accent: 'text-amber-300 border-amber-500/60 bg-amber-500/10',
    iconAccent: 'text-amber-400 bg-amber-500/15',
  },
];

const MazeBackdrop = () => (
  <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
    <div
      className="absolute inset-0 opacity-[0.22]"
      style={{
        ...MAIN_MAP_BACKGROUND,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
      }}
    />
    <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/80" />
    <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-orange-600/25 blur-3xl" />
    {FOOTPRINTS.map((step, i) => (
      <span
        key={i}
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: step.left, top: step.top }}
      >
        <FootprintIcon
          className={`${step.size} text-orange-300`}
          style={{
            animationName: 'step-in',
            animationDuration: `${WALK_CYCLE_SEC}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDelay: step.delay,
            animationFillMode: 'backwards',
            '--step-rotate': step.rotate,
          }}
        />
      </span>
    ))}
    <div
      className="absolute inset-0 opacity-[0.05]"
      style={{ backgroundImage: 'repeating-linear-gradient(0deg, #fff 0, #fff 1px, transparent 1px, transparent 3px)' }}
    />
    <div className="absolute inset-0 shadow-[inset_0_0_120px_60px_rgba(2,6,23,0.9)]" />
  </div>
);

const PawTrail = () => (
  <div className="flex gap-1.5 text-xl" aria-hidden>
    <span className="inline-block animate-bounce [animation-delay:-0.3s]">🐾</span>
    <span className="inline-block animate-bounce [animation-delay:-0.15s]">🐾</span>
    <span className="inline-block animate-bounce">🐾</span>
  </div>
);

const LogoTitle = ({ size = 'text-4xl' }: { size?: string }) => (
  <h1
    className={`font-display ${size} tracking-wide bg-gradient-to-b from-orange-100 to-orange-300 bg-clip-text text-transparent [-webkit-text-stroke:1.5px_#7a2400] drop-shadow-[3px_3px_0_rgba(0,0,0,0.4)]`}
  >
    Maze Footprints
  </h1>
);

const Menu = ({
  onShowLeaderboard,
  onPlay,
}: {
  onShowLeaderboard: () => void;
  onPlay: () => void;
}) => (
  <>
    <HudButton
      onClick={() => {
        playUiClickSound();
        onShowLeaderboard();
      }}
      label="Leaderboard"
      icon={<RankIcon />}
    />
    <PawTrail />
    <div className="flex flex-col items-center gap-2">
      <LogoTitle />
      <p className="text-sm text-slate-400 text-center leading-relaxed">
        Walk the foggy maze and leave your footprints,
        <br />
        then cross paths with other explorers&apos; traces and traps.
      </p>
    </div>
    <PlayButton
      onClick={() => {
        playUiClickSound();
        onPlay();
      }}
    />
    {context?.username ? (
      <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 rounded-full pl-1 pr-3 py-1">
        <span className="w-4 h-4 rounded-full bg-orange-500" aria-hidden />
        <span className="text-xs text-slate-300">
          <span className="text-slate-100 font-medium">{context.username}</span>, today&apos;s maze awaits
        </span>
      </div>
    ) : null}
  </>
);

// How to Play 화면의 방향키/아이템 데모가 공유하는 4분할 순환 애니메이션(index.css htp-q1~q4).
// ITEM_DEMO 등 임의 길이의 목록에 걸 때는 배열을 직접 인덱싱하지 않고 quarterAnim()을 거친다 —
// 4개보다 항목이 늘어나도 (예전처럼 QUARTER_ANIMS[4] === undefined로 애니메이션이 조용히
// 사라지는 대신) 나머지 연산으로 앞의 4개 구간을 순환 재사용한다.
const QUARTER_ANIMS = ['htp-q1', 'htp-q2', 'htp-q3', 'htp-q4'] as const;
type QuarterAnim = (typeof QUARTER_ANIMS)[number];
const quarterAnim = (i: number): QuarterAnim => QUARTER_ANIMS[i % QUARTER_ANIMS.length]!;

// 캡션 텍스트처럼 같은 자리에 여러 개가 절대 위치로 겹쳐 있는 요소는 쉬는 동안 흐림(0.35)이
// 아니라 완전히 꺼져야(0) 안 보여야 할 글자까지 겹쳐 뭉개지는 걸 막을 수 있다(2026-07-13
// 발견) — 키프레임을 따로 두지 않고 --htp-rest-opacity 커스텀 프로퍼티로만 오버라이드한다.
type RestOpacityStyle = CSSProperties & { '--htp-rest-opacity'?: number };

const ArrowKey = ({ label, anim }: { label: string; anim: QuarterAnim }) => (
  <span
    className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800 border-2 border-slate-600 text-slate-200 font-mono text-sm"
    style={{ animation: `${anim} 4s steps(1) infinite` }}
    aria-hidden
  >
    {label}
  </span>
);

// 실제 인벤토리 슬롯에 들어가는 3종(함정 설치/탐지기/손전등)은 Z로 발동, 쉴드는 즉시 무장이라
// Z가 필요 없음 — 그래도 임소리 요청대로 데모 순환에는 4종 다 넣고, 쉴드 캡션에서 그 차이를
// 명확히 설명한다("no button needed"). 아이콘은 game.tsx 인벤토리 슬롯 UI와 완전히 같은
// png(public/sprites/ItemSlot-*.png)를 재사용 — 자체 SVG로 그리면 실제 게임 화면과 따로 놀아서
// "이 그림을 실제로 어디서 보게 되는지" 연결이 안 될 수 있다는 피드백(2026-07-13)으로 교체.
const ITEM_DEMO: { label: string; description: string; iconSrc: string; iconAccent: string }[] = [
  {
    label: 'Trap Kit',
    description: 'places a trap on your tile',
    iconSrc: '/sprites/ItemSlot-bomb.png',
    iconAccent: 'border-rose-400 bg-rose-500/10',
  },
  {
    label: 'Trap Detector',
    description: 'reveals nearby traps',
    iconSrc: '/sprites/ItemSlot-detector.png',
    iconAccent: 'border-emerald-400 bg-emerald-500/10',
  },
  {
    label: 'Flashlight',
    description: 'lets you see farther for a while',
    iconSrc: '/sprites/ItemSlot-flashlight.png',
    iconAccent: 'border-amber-400 bg-amber-500/10',
  },
  {
    label: 'Trap Shield',
    description: 'equips instantly — no button needed',
    iconSrc: '/sprites/ItemSlot-shield.png',
    iconAccent: 'border-cyan-400 bg-cyan-500/10',
  },
];

// PLAY를 누르면 로드아웃보다 먼저 뜨는 조작법 안내. 매번(첫 방문뿐 아니라 매판) 표시하기로
// 함(임소리 결정) — 대신 아무 키나 누르면 바로 넘어가게 해서 이미 아는 사람은 빠르게 스킵
// 가능. 방향키/아이템 데모는 전부 CSS 애니메이션(index.css htp-* 키프레임)이라 Phaser나 JS
// 타이머 없이 팝업이 떠 있는 동안 계속 반복 재생된다.
const HowToPlay = ({ onContinue }: { onContinue: () => void }) => {
  useEffect(() => {
    // keydown이 아니라 window 전역에 건다 — 팝업 안 특정 버튼에 포커스가 가 있을 필요 없이
    // 정말 "아무 키나" 눌러도 반응해야 하기 때문.
    const handleKeyDown = () => onContinue();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onContinue]);

  return (
    <div className="w-full flex flex-col gap-4">
      <h1 className="font-display text-lg tracking-wide text-white text-center">How to Play</h1>

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-slate-400">Move with the arrow keys</p>
        <div className="relative w-full h-20 rounded-2xl bg-slate-800/60 border border-slate-700 overflow-hidden flex items-center justify-center">
          <img
            src="/sprites/Character-normal.png"
            alt=""
            className="w-9 h-9 object-contain"
            style={{ animation: 'htp-character 4s steps(1) infinite' }}
          />
        </div>
        <div className="flex flex-col items-center gap-1">
          <ArrowKey label="↑" anim="htp-q1" />
          <div className="flex gap-1">
            <ArrowKey label="←" anim="htp-q3" />
            <ArrowKey label="↓" anim="htp-q2" />
            <ArrowKey label="→" anim="htp-q4" />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <span
            className="font-mono bg-slate-800 border-2 border-slate-600 rounded px-1.5"
            style={{ animation: 'htp-z-tap 8s steps(1) infinite' }}
          >
            Z
          </span>
          use item
          <span
            className="font-mono bg-slate-800 border-2 border-slate-600 rounded px-1.5 ml-2"
            style={{ animation: 'htp-x-tap 8s steps(1) infinite' }}
          >
            X
          </span>
          switch slot
        </p>
        <div className="flex gap-2">
          {ITEM_DEMO.map((it, i) => (
            <span
              key={it.label}
              className={`flex items-center justify-center w-10 h-10 rounded-xl border-2 p-1.5 ${it.iconAccent}`}
              style={{ animation: `${quarterAnim(i)} 8s steps(1) infinite` }}
              aria-hidden
            >
              <img src={it.iconSrc} alt="" className="w-full h-full object-contain" />
            </span>
          ))}
        </div>
        {/* 4개가 같은 자리에 절대 위치로 겹쳐 있어서, 아이콘처럼 쉬는 동안 0.35로 두면 안
            보여야 할 글자까지 겹쳐 보인다 — --htp-rest-opacity: 0으로 완전히 끈다. */}
        <div className="relative h-8 w-full">
          {ITEM_DEMO.map((it, i) => {
            const captionStyle: RestOpacityStyle = {
              animation: `${quarterAnim(i)} 8s steps(1) infinite`,
              '--htp-rest-opacity': 0,
            };
            return (
              <p
                key={it.label}
                className="absolute inset-0 text-xs text-slate-300 text-center"
                style={captionStyle}
              >
                <span className="font-semibold text-white">{it.label}:</span> {it.description}
              </p>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-slate-500 text-center border-t border-slate-800 pt-3">
        Ranked by fewest steps to the goal.
      </p>
      <p className="text-xs text-slate-400 text-center animate-pulse">Press any key to continue</p>
    </div>
  );
};

// 게임 시작 전 아이템 로드아웃(3종 중 1개) 선택 화면. PLAY를 누르면 바로 게임으로 가지 않고
// 여기를 먼저 거친다 — 선택 결과는 localStorage에 저장해뒀다가 game.tsx가 읽어간다(별도
// 웹뷰라 React state로는 못 넘김). 확인 버튼을 눌러야 실제로 게임을 시작하도록 해서, 선택
// 안 하고 실수로 넘어가는 일이 없게 함(기본 선택값 없음).
const Loadout = ({ onBack }: { onBack: () => void }) => {
  // game.tsx의 applyLoadout()과 마찬가지로, localStorage 접근이 막힌 환경(서드파티 iframe
  // 스토리지 정책 등)에서도 화면 자체는 렌더링/진행되게 try/catch로 방어한다 — PR #33 리뷰에서
  // game.tsx만 방어돼 있고 여기는 방어가 없어 그 환경에서 스플래시 전체가 깨질 수 있다는 점이
  // 지적됨(useState 초기화 함수 안 예외는 렌더링 중 처리 안 된 예외가 되어버림).
  const [selected, setSelected] = useState<LoadoutId | null>(() => {
    try {
      const saved = localStorage.getItem(LOADOUT_STORAGE_KEY);
      return LOADOUT_OPTIONS.some((opt) => opt.id === saved) ? (saved as LoadoutId) : null;
    } catch {
      return null;
    }
  });

  const handleConfirm = (e: MouseEvent<HTMLButtonElement>) => {
    if (!selected) return;
    try {
      localStorage.setItem(LOADOUT_STORAGE_KEY, selected);
    } catch {
      // 저장 실패해도(예: 저장공간 막힘) 이번 판은 진행은 시켜준다 — game.tsx의 applyLoadout()이
      // 값을 못 읽으면 그냥 빈손으로 시작하는 안전한 폴백을 이미 갖고 있음.
    }
    requestExpandedMode(e.nativeEvent, 'game');
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-xl border-2 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
          onClick={() => {
            playUiClickSound();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="font-display text-lg tracking-wide text-white">Choose Your Item</h1>
      </div>
      <p className="text-xs text-slate-400 -mt-3">Pick one item to carry into today&apos;s maze.</p>

      <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Choose your item">
        {LOADOUT_OPTIONS.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setSelected(opt.id)}
              role="radio"
              aria-checked={isSelected}
              className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                isSelected
                  ? opt.accent
                  : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${opt.iconAccent}`}>
                {opt.icon}
              </span>
              <span className="flex flex-col flex-1">
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className="text-xs opacity-80">{opt.description}</span>
              </span>
              <span
                aria-hidden
                className={`flex items-center justify-center w-5 h-5 rounded-full border-2 shrink-0 transition ${
                  isSelected ? 'bg-current border-current' : 'border-slate-600'
                }`}
              >
                {isSelected ? <CheckIcon /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <button
        className="mt-1 w-full rounded-full bg-gradient-to-b from-[#ff7a4d] to-[#d93900] border-b-[4px] border-[#7a2400] py-2.5 font-display text-sm tracking-wide text-white transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale active:translate-y-[2px] active:border-b-[2px] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
        onClick={handleConfirm}
        disabled={!selected}
      >
        Start
      </button>
    </div>
  );
};

const PODIUM_MEDAL: Record<number, string> = { 2: '🥈', 3: '🥉' };
const PODIUM_HEIGHT: Record<number, string> = { 1: 'h-24', 2: 'h-16', 3: 'h-12' };
const PODIUM_ORDER = [2, 1, 3];

const YouBadge = () => (
  <span className="absolute -top-2 px-1.5 py-0.5 rounded-full bg-sky-500 text-white text-[9px] font-black tracking-wide shadow-[0_0_8px_rgba(56,189,248,0.7)]">
    YOU
  </span>
);

const PodiumSlot = ({
  place,
  entry,
  isMe,
}: {
  place: number;
  entry: LeaderboardEntry | undefined;
  isMe: boolean;
}) => {
  const isFirst = place === 1;
  return (
    <div
      className={`relative flex flex-col items-center gap-1 w-20 animate-row-in ${isFirst ? 'z-10' : ''}`}
      style={{ animationDelay: `${(place - 1) * 90}ms` }}
    >
      {isMe && entry ? <YouBadge /> : null}
      {isFirst ? (
        <div className="flex items-center justify-center w-11 h-11 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 border-2 border-amber-200 text-2xl animate-glow-pulse-gold">
          🏆
        </div>
      ) : (
        <span className="text-xl">{PODIUM_MEDAL[place]}</span>
      )}
      <span
        className={`text-xs truncate w-full text-center ${isMe ? 'text-sky-300 font-bold' : 'text-slate-300'}`}
      >
        {entry?.username ?? '-'}
      </span>
      <span className="font-mono text-[10px] text-amber-300 [text-shadow:0_0_6px_rgba(252,211,77,0.5)]">
        {entry ? `${entry.steps} steps` : '--'}
      </span>
      <div
        className={`w-full ${PODIUM_HEIGHT[place]} rounded-t-lg border-t-2 shadow-[inset_0_2px_2px_rgba(255,255,255,0.08)] flex items-start justify-center pt-1 ${
          isMe
            ? 'bg-gradient-to-b from-sky-800 to-sky-900 border-sky-400'
            : 'bg-gradient-to-b from-slate-700 to-slate-800 border-slate-600'
        }`}
      >
        <span className="font-display text-lg text-slate-300">{place}</span>
      </div>
    </div>
  );
};

const LEADERBOARD_TOP_N = 5;

const LeaderboardRow = ({
  entry,
  isMe,
  delayMs,
}: {
  entry: LeaderboardEntry;
  isMe: boolean;
  delayMs: number;
}) => (
  <div
    className={`relative flex items-center gap-3 rounded-xl px-3 py-2 animate-row-in ${
      isMe ? 'bg-sky-900/50 border border-sky-500/60' : 'bg-slate-800/50'
    }`}
    style={{ animationDelay: `${delayMs}ms` }}
  >
    <RankBadge rank={entry.rank} />
    <span className={`text-sm font-medium truncate flex-1 ${isMe ? 'text-sky-300 font-bold' : 'text-slate-200'}`}>
      {entry.username}
    </span>
    {isMe ? (
      <span className="px-1.5 py-0.5 rounded-full bg-sky-500 text-white text-[9px] font-black tracking-wide shrink-0">
        YOU
      </span>
    ) : null}
    <div className="flex flex-col items-end">
      <span className="font-mono text-xs text-amber-300 bg-black/40 border border-slate-700 rounded-md px-2 py-1 [text-shadow:0_0_6px_rgba(252,211,77,0.5)]">
        {entry.steps} steps
      </span>
      <span className="font-mono text-[10px] text-slate-500 mt-0.5">{formatClearTime(entry.clearTimeMs)}</span>
    </div>
  </div>
);

const Leaderboard = ({ onBack }: { onBack: () => void }) => {
  const { entries, loading, error, reload } = useLeaderboard(DEFAULT_MAP_ID);
  const myUserId = useMyUserId();
  // 랭킹은 1~5위권만 보여준다. 내 기록이 5위 밖이면(=myEntryBelowTop) 구분선과 함께
  // 목록 맨 아래에 따로 붙여, 내가 몇 등인지는 순위가 안 잘려도 항상 볼 수 있게 한다.
  const topEntries = entries.slice(0, LEADERBOARD_TOP_N);
  const podiumEntries = topEntries.slice(0, 3);
  const restEntries = topEntries.slice(3);
  const myEntry = entries.find((entry) => entry.userId === myUserId);
  const myEntryBelowTop = myEntry && myEntry.rank > LEADERBOARD_TOP_N ? myEntry : null;

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-xl border-2 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition cursor-pointer"
          onClick={() => {
            playUiClickSound();
            onBack();
          }}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="font-display text-lg tracking-wide text-white">Today&apos;s Leaderboard</h1>
      </div>

      <div className="relative flex flex-col gap-3 min-h-[160px] justify-center">
        {/* 순위표 전체를 게임다운 느낌으로 — 시상대 위쪽엔 은은한 금빛 스포트라이트,
            패널 전체엔 아주 옅은 대각선 패턴을 깔아 단조로운 카드 UI를 탈피한다. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 140% 55% at 50% 0%, rgba(252,211,77,0.16), transparent 70%), repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 2px, transparent 2px, transparent 14px)',
          }}
        />

        {loading ? <p className="text-sm text-slate-500 text-center">Loading...</p> : null}
        {error ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-400 text-center">{error}</p>
            <button
              className="text-slate-300 hover:text-white transition text-xs cursor-pointer underline underline-offset-4"
              onClick={() => {
                playUiClickSound();
                reload();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!loading && !error && entries.length === 0 ? (
          <p className="text-sm text-slate-500 text-center">
            No records yet.
            <br />Be the first to set one!
          </p>
        ) : null}

        {!loading && !error && podiumEntries.length > 0 ? (
          <div className="flex items-end justify-center gap-2">
            {PODIUM_ORDER.map((place) => (
              <PodiumSlot
                key={place}
                place={place}
                entry={podiumEntries[place - 1]}
                isMe={podiumEntries[place - 1]?.userId === myUserId}
              />
            ))}
          </div>
        ) : null}

        {restEntries.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {restEntries.map((entry, i) => (
              <LeaderboardRow key={entry.userId} entry={entry} isMe={entry.userId === myUserId} delayMs={i * 60} />
            ))}
          </div>
        ) : null}

        {myEntryBelowTop ? (
          <div className="flex flex-col gap-1.5">
            <div aria-hidden className="flex items-center gap-2 px-1 text-slate-600">
              <span className="flex-1 border-t border-slate-700" />
              <span className="text-xs">⋯</span>
              <span className="flex-1 border-t border-slate-700" />
            </div>
            <LeaderboardRow entry={myEntryBelowTop} isMe delayMs={restEntries.length * 60} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const Splash = () => {
  const [view, setView] = useState<View>('menu');

  return (
    <div className="relative flex flex-col justify-center items-center min-h-screen bg-slate-950 text-white px-4 overflow-hidden">
      <MazeBackdrop />
      <div className="relative z-10 w-full max-w-sm">
        <RivetPanel>
          {view === 'menu' ? (
            <Menu onShowLeaderboard={() => setView('leaderboard')} onPlay={() => setView('howToPlay')} />
          ) : view === 'howToPlay' ? (
            <HowToPlay onContinue={() => setView('loadout')} />
          ) : view === 'loadout' ? (
            <Loadout onBack={() => setView('menu')} />
          ) : (
            <Leaderboard onBack={() => setView('menu')} />
          )}
        </RivetPanel>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
