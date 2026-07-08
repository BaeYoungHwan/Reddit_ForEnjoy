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
import { buildMazeBackground, findPath, tileToPercent } from './mazePattern';
import { formatClearTime } from './format';
import { getMazeMap } from '../shared/maps';
import type { LeaderboardEntry, Position } from '../shared/game-types';

const DEFAULT_MAP_ID = 'map-1';
const MAIN_MAP = getMazeMap(DEFAULT_MAP_ID);
const MAIN_MAP_BACKGROUND = buildMazeBackground(MAIN_MAP);

const WALK_STRIDE = 2;
const STEP_INTERVAL_SEC = 0.45;
const WALK_CYCLE_PAUSE_SEC = 1.2;
const WALK_ICON_SIZES = ['w-9 h-9', 'w-10 h-10'];

function angleBetween(a: Position, b: Position): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
}

const FULL_WALK_PATH = findPath(MAIN_MAP);
const WALK_TILES = FULL_WALK_PATH.filter(
  (_, i) => i % WALK_STRIDE === 0 || i === FULL_WALK_PATH.length - 1
);

const FOOTPRINTS = WALK_TILES.map((tile, i) => {
  const facing = WALK_TILES[i + 1] ?? WALK_TILES[i - 1] ?? tile;
  return {
    ...tileToPercent(MAIN_MAP, tile),
    rotate: `${angleBetween(tile, facing)}deg`,
    delay: `${i * STEP_INTERVAL_SEC}s`,
    size: WALK_ICON_SIZES[i % WALK_ICON_SIZES.length]!,
  };
});

const WALK_CYCLE_MS = (FOOTPRINTS.length * STEP_INTERVAL_SEC + WALK_CYCLE_PAUSE_SEC) * 1000;

type View = 'menu' | 'leaderboard';

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
    className="relative flex flex-col items-center justify-center gap-0.5 w-32 h-32 rounded-full bg-gradient-to-b from-[#ff7a4d] to-[#d93900] border-b-[7px] border-[#7a2400] text-white animate-glow-pulse cursor-pointer select-none transition active:translate-y-[4px] active:border-b-[2px] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
    onClick={onClick}
  >
    <span
      aria-hidden
      className="absolute inset-x-4 top-3 h-1/4 rounded-full bg-white/25 blur-[3px] pointer-events-none"
    />
    <span className="relative text-4xl drop-shadow-[1px_1px_0_rgba(0,0,0,0.25)]">▶</span>
    <span className="relative font-display text-sm tracking-wide drop-shadow-[1px_1px_0_rgba(0,0,0,0.25)]">
      Play
    </span>
  </button>
);

const FootprintIcon = ({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
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

const MazeBackdrop = ({ cycleKey }: { cycleKey: number }) => (
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
    <div key={cycleKey}>
      {FOOTPRINTS.map((step, i) => (
        <span
          key={i}
          className="absolute"
          style={{ left: step.left, top: step.top }}
        >
          <FootprintIcon
            className={`${step.size} text-orange-300 animate-step-in`}
            style={{ animationDelay: step.delay, '--step-rotate': step.rotate } as CSSProperties}
          />
        </span>
      ))}
    </div>
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

const Menu = ({ onShowLeaderboard }: { onShowLeaderboard: () => void }) => (
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
    <PlayButton onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')} />
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

const PODIUM_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const PODIUM_HEIGHT: Record<number, string> = { 1: 'h-24', 2: 'h-16', 3: 'h-12' };
const PODIUM_ORDER = [2, 1, 3];

const PodiumSlot = ({ place, entry }: { place: number; entry: LeaderboardEntry | undefined }) => (
  <div className="flex flex-col items-center gap-1 w-20">
    <span className="text-xl">{PODIUM_MEDAL[place]}</span>
    <span className="text-xs text-slate-300 truncate w-full text-center">{entry?.userId ?? '-'}</span>
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
                <span className="text-slate-200 text-sm font-medium truncate flex-1">{entry.userId}</span>
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
  const [walkCycle, setWalkCycle] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setWalkCycle((cycle) => cycle + 1), WALK_CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex flex-col justify-center items-center min-h-screen bg-slate-950 text-white px-4 overflow-hidden">
      <MazeBackdrop cycleKey={walkCycle} />
      <div className="relative z-10 w-full max-w-sm">
        <RivetPanel>
          {view === 'menu' ? (
            <Menu onShowLeaderboard={() => setView('leaderboard')} />
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
