import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useState, type MouseEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useLeaderboard } from './hooks/useLeaderboard';
import { generateDecorativeMazeBackground } from './mazePattern';
import { formatClearTime } from './format';
import type { LeaderboardEntry } from '../shared/game-types';

const DEFAULT_MAP_ID = 'map-1';
const DECORATIVE_MAZE_BACKGROUND = generateDecorativeMazeBackground(14, 20);

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
    className="relative flex flex-col items-center justify-center gap-0.5 w-32 h-32 rounded-full bg-gradient-to-b from-[#ff7a4d] to-[#d93900] border-b-[7px] border-[#7a2400] text-white shadow-[0_0_32px_rgba(255,92,51,0.5)] cursor-pointer select-none transition active:translate-y-[4px] active:border-b-[2px] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
    onClick={onClick}
  >
    <span
      aria-hidden
      className="absolute inset-x-4 top-3 h-1/4 rounded-full bg-white/25 blur-[3px] pointer-events-none"
    />
    <span className="relative text-4xl drop-shadow-[1px_1px_0_rgba(0,0,0,0.25)]">▶</span>
    <span className="relative font-display text-sm tracking-wide drop-shadow-[1px_1px_0_rgba(0,0,0,0.25)]">
      입장하기
    </span>
  </button>
);

const MazeBackdrop = () => (
  <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
    <div
      className="absolute inset-0 opacity-[0.12]"
      style={{
        ...DECORATIVE_MAZE_BACKGROUND,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
    <div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950/80" />
    <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full bg-orange-600/25 blur-3xl" />
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
    미로의 발자국
  </h1>
);

const Menu = ({ onShowLeaderboard }: { onShowLeaderboard: () => void }) => (
  <>
    <HudButton onClick={onShowLeaderboard} label="리더보드" icon={<RankIcon />} />
    <PawTrail />
    <div className="flex flex-col items-center gap-2">
      <LogoTitle />
      <p className="text-sm text-slate-400 text-center leading-relaxed">
        안개 속 미로를 걸으며 발자국을 남기고,
        <br />
        다른 탐험가의 흔적과 함정을 마주하세요.
      </p>
    </div>
    <PlayButton onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')} />
    {context?.username ? (
      <div className="flex items-center gap-1.5 bg-slate-800/80 border border-slate-700 rounded-full pl-1 pr-3 py-1">
        <span className="w-4 h-4 rounded-full bg-orange-500" aria-hidden />
        <span className="text-xs text-slate-300">
          <span className="text-slate-100 font-medium">{context.username}</span>님, 오늘의 미로가 기다리고 있어요
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
          aria-label="뒤로"
        >
          ←
        </button>
        <h1 className="font-display text-lg tracking-wide text-white">오늘의 리더보드</h1>
      </div>

      <div className="flex flex-col gap-3 min-h-[160px] justify-center">
        {loading ? <p className="text-sm text-slate-500 text-center">불러오는 중...</p> : null}
        {error ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-400 text-center">{error}</p>
            <button
              className="text-slate-300 hover:text-white transition text-xs cursor-pointer underline underline-offset-4"
              onClick={reload}
            >
              다시 시도
            </button>
          </div>
        ) : null}
        {!loading && !error && entries.length === 0 ? (
          <p className="text-sm text-slate-500 text-center">
            아직 기록이 없어요.
            <br />첫 기록의 주인공이 되어보세요!
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

  return (
    <div className="relative flex flex-col justify-center items-center min-h-screen bg-slate-950 text-white px-4 overflow-hidden">
      <MazeBackdrop />
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
