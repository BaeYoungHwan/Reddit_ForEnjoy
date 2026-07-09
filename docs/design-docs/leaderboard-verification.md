# 리더보드 API-클라이언트 정합성 점검

> 담당: 배영환 (서버 API) + 송원호 (리더보드 UI 훅, 확인 필요) | 상태: 점검 중 — userId→username 매핑 조치 완료(2026-07-09), 실환경 검증·PRD 문서화는 남음
> 관련: `src/server/trpc.ts`, `src/shared/game-types.ts`, `src/client/hooks/useLeaderboard.ts`, `src/client/splash.tsx`, `docs/wbs.md`, `docs/product-specs/PRD-v1.md`

## 1. 배경 및 목적

송원호가 담당하는 "리더보드 UI 훅"이 `docs/wbs.md`상 진행 중(🔄)이다. 서버 쪽 `run.finish`/`leaderboard.get`은 이미 구현이 끝난 상태이므로, 이 시점에 서버 스펙과 클라이언트 소비 코드를 먼저 대조해 갭이 있다면 송원호의 남은 작업 전에 선제적으로 조율하는 것이 목적이다.

## 2. 서버 스펙 요약

| 프로시저 | 입력 | 출력 | 비고 |
|---|---|---|---|
| `run.finish` (mutation, 인증 필요) | `{ mapId: string, clearTimeMs: number(양수) }` | `{ rank: number, isNewRecord: boolean }` | 클리어 시간이 기존 기록보다 **작을 때만** 갱신(낮을수록 우수) |
| `leaderboard.get` (query, 비인증) | `{ mapId: string }` | `{ entries: { userId, clearTimeMs, rank }[] }` | 오름차순 전체 조회 |

```ts
// trpc.ts:195-213 — run.finish
const prevScore = await redis.zScore(key, ctx.userId);
const isNewRecord = prevScore === undefined || clearTimeMs < prevScore;
if (isNewRecord) {
  await redis.zAdd(key, { member: ctx.userId, score: clearTimeMs });
  await redis.expire(key, DATA_SAFETY_TTL_SECONDS);
}
const rank = await redis.zRank(key, ctx.userId);
await redis.del(positionAnchorKey(mapId, date, ctx.userId));
return { rank: (rank ?? 0) + 1, isNewRecord };
```

```ts
// trpc.ts:216-224 — leaderboard.get
const entries = await redis.zRange(leaderboardKey(input.mapId, date), 0, -1, { by: 'rank' });
return {
  entries: entries.map((entry, index) => ({
    userId: entry.member,
    clearTimeMs: entry.score,
    rank: index + 1,
  })),
};
```

**Redis 구조**: `leaderboard:{mapId}:{date}` (sorted set, member=`userId`, score=`clearTimeMs`). 날짜가 키에 포함되어 자정마다 자동으로 새 키에서 시작 — 별도 리셋 로직 불필요(`docs/design-docs/daily-reset-verification.md` 참조).

**공유 타입** (`src/shared/game-types.ts`): `LeaderboardEntry { userId, clearTimeMs, rank }`, `RunFinishInput { mapId, clearTimeMs }`, `RunFinishOutput { rank, isNewRecord }` — zod 스키마와 필드명이 완전히 일치한다.

## 3. 클라이언트 소비 현황

- `src/client/hooks/useLeaderboard.ts`: `trpc.leaderboard.get.query({ mapId })` 호출, `LeaderboardEntry[]` 상태와 `loading`/`error`/`reload`를 함께 관리.
- `src/client/splash.tsx`의 `Leaderboard` 컴포넌트: `entries`를 1~3위(`podiumEntries`)와 4위 이하(`restEntries`)로 나눠 렌더링. 사용 필드는 `entry.userId`, `entry.clearTimeMs`(→ `formatClearTime`으로 가공), `entry.rank`.

**결론**: 필드명·타입 모두 서버 응답과 정확히 일치 — **코드 레벨 정합성 문제는 없음**. `game.tsx`(Phaser) 쪽에는 아직 리더보드 UI 자체가 없고 관련 주석만 있는 상태이나, 리더보드 화면은 `splash.tsx`에 위치하므로 이는 갭이 아니라 역할 분리로 이해된다.

## 4. 갭 분석

| 갭 | 내용 | 영향 | 상태 |
|---|---|---|---|
| PRD 세부 스펙 부재 | `docs/product-specs/PRD-v1.md`에는 "클리어 시간 기록 + 리더보드"만 명시되고, 표시 항목(닉네임 포함 여부)·정렬 기준(오름차순)·갱신 시점 등 세부 스펙이 문서화되어 있지 않음 — 현재는 코드에만 기준이 존재 | 향후 사양 변경 시 기준 문서 부재로 논의 비용 발생 가능 | 미해결 |
| 실환경 렌더링 미검증 | `docs/wbs.md`: "서버 `leaderboard.get`과 연동 코드는 존재하고 메뉴 화면은 실제 Reddit에서 렌더링 확인됨 — 리더보드 뷰 자체(HUD 아이콘 클릭 후 화면)는 아직 실환경 스크린샷 미확인" | 코드는 맞지만 실제 Reddit iframe 환경에서 레이아웃/깨짐 여부 미확인 | 미해결 (송원호 담당) |
| `userId` 표시 형태 미정 | 서버가 Reddit `userId`(`t2_xxx`)를 그대로 반환하고, 클라이언트(`splash.tsx`)도 이를 그대로 표시하고 있었음 | 리더보드에 사람이 읽을 수 없는 ID가 그대로 노출 | **해결(2026-07-09)** — 아래 참조 |

### 4.1 `userId` → username 매핑 조치 완료

`leaderboard.get`에서 `reddit.getUserById(entry.member as T2)`로 각 엔트리의 username을 조회해 응답에 포함하도록 변경했다(`src/server/trpc.ts`). 탈퇴/정지 등으로 조회가 안 되는 계정은 `userId`로 폴백한다. 공유 타입 `LeaderboardEntry`(`src/shared/game-types.ts`)에 `username: string` 필드를 추가했고, 클라이언트 `splash.tsx`의 `Leaderboard`/`PodiumSlot` 표시를 `entry.userId` → `entry.username`으로 교체했다(React key는 여전히 `userId` 유지, 표시 텍스트만 변경). `src/server/trpc.test.ts`에 정상 조회·폴백 두 케이스 회귀 테스트를 추가했다.

**클라이언트 영역(`src/client`) 침범**: `splash.tsx` 수정은 송원호 담당 영역이므로, 이 변경을 포함한 PR에는 송원호를 리뷰어로 포함해야 한다(`docs/team-roles.md` 규칙 5).

## 5. 액션 아이템

| 항목 | 우선순위 | 담당(제안) | 선행조건 | 상태 |
|---|---|---|---|---|
| `userId` → 표시용 username 매핑 | High | 배영환+송원호(리뷰) | 없음 | ✅ 완료 (`src/server/trpc.ts`, `src/client/splash.tsx`) |
| PRD에 리더보드 표시 항목·정렬 기준 명문화 | Medium | 배영환 (문서화) | 없음 | 미착수 |
| 실제 Reddit 환경에서 리더보드 뷰(HUD 진입) 스크린샷 검증 | High | 송원호 | 리더보드 훅 완료 후 | 미착수 |
| `leaderboard.get` 응답 대량(엔트리 다수) 시 클라이언트 렌더링 성능 확인 | Low | 송원호 | 실데이터 축적 후 | 미착수 |

## 6. Verification

- 서버 스키마는 `src/server/trpc.ts:195-224`, 공유 타입은 `src/shared/game-types.ts`와 대조 완료.
- 클라이언트 소비 코드는 `src/client/hooks/useLeaderboard.ts`, `src/client/splash.tsx`의 `Leaderboard` 컴포넌트로 확인 완료.
- username 매핑 조치: `npx vitest run`(전체 33개 통과, `leaderboard.get username 매핑` 2건 포함) + `npx tsc --build`(server/shared/client 전체) 타입 체크 통과 확인(2026-07-09).
- 위 액션 아이템 중 "실제 Reddit 환경 스크린샷 검증"은 송원호의 리더보드 훅 작업 완료 후 별도로 수행.
