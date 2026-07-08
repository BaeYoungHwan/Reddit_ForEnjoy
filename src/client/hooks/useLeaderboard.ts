import { useEffect, useState } from 'react';
import { trpc } from '../trpcClient';
import type { LeaderboardEntry } from '../../shared/game-types';

type LeaderboardState = {
  entries: LeaderboardEntry[];
  loading: boolean;
  error: string | null;
};

export const useLeaderboard = (mapId: string) => {
  const [state, setState] = useState<LeaderboardState>({
    entries: [],
    loading: true,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { entries } = await trpc.leaderboard.get.query({ mapId });
        if (!cancelled) setState({ entries, loading: false, error: null });
      } catch {
        if (!cancelled) setState({ entries: [], loading: false, error: '리더보드를 불러오지 못했어요' });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [mapId, reloadKey]);

  const reload = () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    setReloadKey((key) => key + 1);
  };

  return { ...state, reload };
};
