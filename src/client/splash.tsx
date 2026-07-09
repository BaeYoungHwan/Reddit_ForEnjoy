import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import {
  StrictMode,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { useLeaderboard } from './hooks/useLeaderboard';
import { angleBetween, buildMazeBackground, findPath, tileToPercent } from './mazePattern';
import { formatClearTime } from './format';
import { getMazeMap } from '../shared/maps';
import type { LeaderboardEntry } from '../shared/game-types';

const DEFAULT_MAP_ID = 'map-1';
const MAIN_MAP = getMazeMap(DEFAULT_MAP_ID);
const MAIN_MAP_BACKGROUND = buildMazeBackground(MAIN_MAP);

const WALK_STRIDE = 2;
const STEP_INTERVAL_SEC = 0.45;
const WALK_ICON_SIZES = ['w-9 h-9', 'w-10 h-10'];

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

type View = 'menu' | 'loadout' | 'leaderboard';

// items.md 2026-07-09 확정: 로드아웃에서 고를 수 있는 건 4종 중 "함정 설치"를 뺀 3종뿐
// (함정 설치는 상시 보유가 아니라 맵에서 랜덤 스폰된 걸 주워야 쓸 수 있음 — 다른 아이템과 동일 방식).
// 함정 탐지기는 아직 서버 API가 없어(game-types.ts의 ItemType은 flashlight/shield뿐)
// 클라이언트 전용 id로 취급한다 — 서버 연동은 이 화면의 스코프 밖(1️⃣ "아이템 로드아웃 UI 연동" 담당).
type LoadoutId = 'trapDetector' | 'shield' | 'flashlight';

// game.tsx가 별도 웹뷰(entrypoint)로 뜨기 때문에 React state로는 선택값을 못 넘긴다 — 같은
// origin의 localStorage로 넘긴다(TEMP_MAP/TEMP_ITEMS처럼, 실제 서버 연동 전 임시 다리 역할).
const LOADOUT_STORAGE_KEY = 'maze-footprints:loadout';

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

// 3종 로드아웃 정의 — 색은 게임 화면(game.tsx ITEM_COLORS)의 손전등/쉴드 색과 맞추고,
// 함정 탐지기는 기존 함정 4색(파랑/보라/회색/주황)과 안 겹치는 에메랄드로 새로 지정.
const LOADOUT_OPTIONS: {
  id: LoadoutId;
  label: string;
  description: string;
  icon: ReactNode;
  accent: string;
}[] = [
  {
    id: 'trapDetector',
    label: '함정 탐지기',
    description: '반경 안의 함정 위치를 잠깐 보여줘요',
    icon: <TrapDetectorIcon />,
    accent: 'text-emerald-300 border-emerald-500/60 bg-emerald-500/10',
  },
  {
    id: 'shield',
    label: '함정 무효화',
    description: '다음 함정 한 번을 완전히 막아줘요',
    icon: <ShieldIcon />,
    accent: 'text-cyan-300 border-cyan-500/60 bg-cyan-500/10',
  },
  {
    id: 'flashlight',
    label: '손전등',
    description: '잠깐 동안 더 멀리까지 보여요',
    icon: <FlashlightIcon />,
    accent: 'text-amber-300 border-amber-500/60 bg-amber-500/10',
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
  onShowLoadout,
}: {
  onShowLeaderboard: () => void;
  onShowLoadout: () => void;
}) => (
  <>
    <HudButton onClick={onShowLeaderboard} label="Leaderboard" icon={<RankIcon />} />
    <PawTrail />
    <div className="flex flex-col items-center gap-2">
      <LogoTitle />
      <p className="text-sm text-slate-400 text-center leading-relaxed">
        Walk the foggy maze and leave your footprints,
        <br />
        then cross paths with other explorers&apos; traces and traps.
      </p>
    </div>
    <PlayButton onClick={onShowLoadout} />
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

// 게임 시작 전 아이템 로드아웃(3종 중 1개) 선택 화면. PLAY를 누르면 바로 게임으로 가지 않고
// 여기를 먼저 거친다 — 선택 결과는 localStorage에 저장해뒀다가 game.tsx가 읽어간다(별도
// 웹뷰라 React state로는 못 넘김). 확인 버튼을 눌러야 실제로 게임을 시작하도록 해서, 선택
// 안 하고 실수로 넘어가는 일이 없게 함(기본 선택값 없음).
const Loadout = ({ onBack }: { onBack: () => void }) => {
  const [selected, setSelected] = useState<LoadoutId | null>(() => {
    const saved = localStorage.getItem(LOADOUT_STORAGE_KEY);
    return LOADOUT_OPTIONS.some((opt) => opt.id === saved) ? (saved as LoadoutId) : null;
  });

  const handleConfirm = (e: MouseEvent<HTMLButtonElement>) => {
    if (!selected) return;
    localStorage.setItem(LOADOUT_STORAGE_KEY, selected);
    requestExpandedMode(e.nativeEvent, 'game');
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-xl border-2 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition cursor-pointer"
          onClick={onBack}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="font-display text-lg tracking-wide text-white">Choose Your Item</h1>
      </div>

      <div className="flex flex-col gap-2.5">
        {LOADOUT_OPTIONS.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setSelected(opt.id)}
              className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition cursor-pointer ${
                isSelected
                  ? opt.accent
                  : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
              }`}
            >
              <span className={isSelected ? '' : 'text-slate-400'}>{opt.icon}</span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className="text-xs opacity-80">{opt.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        className="mt-1 w-full rounded-full bg-gradient-to-b from-[#ff7a4d] to-[#d93900] border-b-[4px] border-[#7a2400] py-2.5 font-display text-sm tracking-wide text-white transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale active:translate-y-[2px] active:border-b-[2px] hover:brightness-110"
        onClick={handleConfirm}
        disabled={!selected}
      >
        Start
      </button>
    </div>
  );
};

const PODIUM_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const PODIUM_HEIGHT: Record<number, string> = { 1: 'h-24', 2: 'h-16', 3: 'h-12' };
const PODIUM_ORDER = [2, 1, 3];

const PodiumSlot = ({ place, entry }: { place: number; entry: LeaderboardEntry | undefined }) => (
  <div className="flex flex-col items-center gap-1 w-20">
    <span className="text-xl">{PODIUM_MEDAL[place]}</span>
    <span className="text-xs text-slate-300 truncate w-full text-center">{entry?.username ?? '-'}</span>
    <span className="font-mono text-[10px] text-amber-300 [text-shadow:0_0_6px_rgba(252,211,77,0.5)]">
      {entry ? formatClearTime(entry.clearTimeMs) : '--:--'}
    </span>
    <div
      className={`w-full ${PODIUM_HEIGHT[place]} bg-gradient-to-b from-slate-700 to-slate-800 rounded-t-lg border-t-2 border-slate-600 shadow-[inset_0_2px_2px_rgba(255,255,255,0.08)] flex items-start justify-center pt-1`}
    >
      <span className="font-display text-lg text-slate-300">{place}</span>
    </div>
  </div>
);

const Leaderboard = ({ onBack }: { onBack: () => void }) => {
  const { entries, loading, error, reload } = useLeaderboard(DEFAULT_MAP_ID);
  const podiumEntries = entries.slice(0, 3);
  const restEntries = entries.slice(3);

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-xl border-2 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition cursor-pointer"
          onClick={onBack}
          aria-label="Back"
        >
          ←
        </button>
        <h1 className="font-display text-lg tracking-wide text-white">Today&apos;s Leaderboard</h1>
      </div>

      <div className="flex flex-col gap-3 min-h-[160px] justify-center">
        {loading ? <p className="text-sm text-slate-500 text-center">Loading...</p> : null}
        {error ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-400 text-center">{error}</p>
            <button
              className="text-slate-300 hover:text-white transition text-xs cursor-pointer underline underline-offset-4"
              onClick={reload}
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
              <PodiumSlot key={place} place={place} entry={podiumEntries[place - 1]} />
            ))}
          </div>
        ) : null}

        {restEntries.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {restEntries.map((entry) => (
              <div key={entry.userId} className="flex items-center gap-3 bg-slate-800/50 rounded-xl px-3 py-2">
                <RankBadge rank={entry.rank} />
                <span className="text-slate-200 text-sm font-medium truncate flex-1">{entry.username}</span>
                <span className="font-mono text-xs text-amber-300 bg-black/40 border border-slate-700 rounded-md px-2 py-1 [text-shadow:0_0_6px_rgba(252,211,77,0.5)]">
                  {formatClearTime(entry.clearTimeMs)}
                </span>
              </div>
            ))}
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
            <Menu onShowLeaderboard={() => setView('leaderboard')} onShowLoadout={() => setView('loadout')} />
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
