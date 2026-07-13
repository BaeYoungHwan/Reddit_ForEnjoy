import { useEffect, useState } from 'react';
import { trpc } from '../trpcClient';

// 리더보드에서 "내 순위"를 강조하기 위해 필요 — 실패해도(로컬 프리뷰 등) 그냥 강조를
// 안 하면 그만이라 다른 화면을 막지 않고 조용히 null로 둔다.
export const useMyUserId = () => {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    trpc.user.me
      .query()
      .then((result) => {
        if (!cancelled) setUserId(result.userId);
      })
      .catch(() => {
        // 로컬 프리뷰 등 백엔드가 없는 환경에서는 실패가 정상 — 강조 기능만 비활성화됨.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return userId;
};
