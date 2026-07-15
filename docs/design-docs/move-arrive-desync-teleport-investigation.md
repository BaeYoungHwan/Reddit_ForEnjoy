# move.arrive 데스싱크·순간이동 조사 — 시도 후 롤백 기록

> 담당: 배영환(원인 분석·시도), 이후 임소리·원호에게 인계(`docs/wbs.md` 상단 권한 위임 공지 참고)
> 상태: ⚠️ 원인 분석은 유효, 수정 시도는 실측 회귀 2건으로 전부 롤백됨(`docs/wbs.md` 95행)
> 관련: `docs/wbs.md` 95행, `docs/design-docs/position-anchor-permanent-lock.md`

## 1. 원래 문제 (2026-07-15 원호 QA)

재플레이 중 (a) 아이템이 전혀 발동하지 않거나 (b) 아이템이 없는 위치에서 갑자기 리스폰 함정이
발동하는 현상이 보고됐다.

## 2. 원인 분석 (코드 추적으로 확인, 여전히 유효함)

2026-07-13 PR #41(조작감 개선)이 `tryMove`의 트윈 완료 즉시 `isMoving=false`로 바꿔(`game.tsx`
onComplete 콜백), 서버의 `move.arrive` 응답을 기다리지 않고 다음 이동을 허용하게 됐다. 여기서
두 가지 문제가 파생된다:

1. **아이템 미발동(연쇄 소실)**: `move.arrive` 요청이 한 번이라도 실패하면 서버 위치 앵커가
   그 자리에 멈추는데, 클라이언트는 계속 낙관적으로 좌표를 전진시켜 그 뒤 모든 칸이 연쇄적으로
   `INVALID_MOVE`로 실패한다. `reportArrival`의 catch가 이 실패를 조용히
   `{trap:{hit:false}, item:{picked:false}}`로 삼켜서, 그 뒤로 밟는 모든 아이템이 "전혀 발동
   안 한 것"처럼 보인다. `run.finish`의 "얼어붙은 세션" 리셋(실패 3회 이상)이 걸릴 때까지 계속됨
   — `docs/design-docs/position-anchor-permanent-lock.md` 6절이 "이번 수정 범위 밖"으로 명시
   미뤄둔 리스크.
2. **의도치 않은 위치에서 리스폰 발동**: `applyRespawnTrap()`이 응답이 도착한 시점의 화면 위치를
   무조건 텔레포트시킨다. 그 응답이 몇 칸 전에 밟은 함정에 대한, 네트워크 지연으로 늦게 도착한
   응답일 수 있어 시각적으로 "함정 없는 칸에서 갑자기 리스폰"으로 보인다.

이 분석 자체는 코드 추적으로 확인된 것이라 여전히 유효하다. 문제는 아래 "시도한 수정"이다.

## 3. 시도한 수정과 실측 회귀 2건 (전부 롤백됨)

### 3.1 1차 시도 (커밋 `e6c2df5`, 롤백됨)

- 서버: `move.resync` 조회 신설(`readPositionAnchor` 재사용) — 클라이언트가 `move.arrive` 실패
  시 서버의 진짜 앵커로 즉시 재동기화.
- 클라이언트: `reportArrival` 실패 시 `resyncPositionFromServer()` 호출.
- 클라이언트: `SequentialDispatcher.pendingCount` + `tryMove`의 `MAX_INFLIGHT_ARRIVALS=2`
  백프레셔 가드 — 미확정 요청이 무한정 쌓이지 않게 상한.

**실측 회귀 1 (사용자 발견)**: 방향키를 꾹 누르고 있으면 캐릭터가 툭툭 멈칫댐. 원인: devvit
플레이테스트 환경도 순수 localhost가 아니라 실제 Reddit 인프라까지 왕복하는 터널이라 RTT가
0이 아니고, `update()`가 매 프레임 `tryMove`를 호출하는 구조상 `MAX_INFLIGHT_ARRIVALS` 상한에
자주 걸렸는데 걸릴 때마다 피드백 없이 조용히 입력이 씹혔음.

### 3.2 2차 시도 (커밋 `17bd1d0`, 롤백됨)

- `MAX_INFLIGHT_ARRIVALS` 2→3, 막히면 `bumpIntoWall`로 피드백, `reportArrival`의 `move.arrive`
  호출에 `ARRIVAL_IDLE_TIMEOUT_MS`(2000ms) 타임아웃 추가(영영 안 끝나는 요청 대비).

**실측 회귀 2 (사용자 발견)**: "일정 걸음 이동하면 순간이동" + 방향키 홀드 시 브레이크 현상은
여전함. 원인: 타임아웃이 실제 `move.arrive` fetch를 취소하지 않고 "기다리길 포기"만 해서,
`SequentialDispatcher`가 아직 서버로 가고 있는 요청을 "끝났다"고 착각하고 다음 요청을 먼저
내보냄 — 이 큐의 존재 이유 자체가 "요청이 dispatch 순서대로 하나씩만 in-flight"라는 걸 보장해
위치 앵커 정합성을 지키는 것이었는데, 이 보장이 깨지며 나중에 도착한 "버려진" 요청이 앵커를
예상 밖 시점에 옮기고 `resyncPositionFromServer`를 연쇄 발동시킴.

### 3.3 3차: 타임아웃 제거 시도 (커밋 `7138dc3`, 롤백됨)

타임아웃만 제거하고 `move.resync`/`pendingCount` 백프레셔는 유지했으나, 사용자 재확인 결과
순간이동과 브레이크 현상이 **둘 다 여전히 발생** — `MAX_INFLIGHT_ARRIVALS` 백프레셔 가드 자체
(임계값이 얼마든)가 이 환경의 실제 RTT 특성과 맞지 않아 보이며, `move.resync` 재동기화 자체도
(가정보다 자주 발생하는) `move.arrive` 실패마다 눈에 띄는 "위치 스냅"을 만들어내는 것으로
추정된다(확증까지는 못함 — 아래 4절 참고).

## 4. 롤백 결정 및 근거

세 차례 수정 시도가 매번 실측에서 새로운/지속되는 회귀를 냈고, 제출 마감(2026-07-15 18:00
PT)이 임박한 상황에서 라이브 코드에 반복적으로 회귀를 만드는 리스크가 원래 버그(아이템
미발동/리스폰 위치 이상, 비교적 드물게 재현되는 문제)보다 크다고 판단해 **관련 코드 전부를
세션 시작 시점(`4099264`)으로 롤백**했다(`src/server/trpc.ts`, `src/server/trpc.test.ts`,
`src/client/game.tsx`, `src/client/sequentialDispatcher.ts`, `src/client/sequentialDispatcher.test.ts`).
`docs/wbs.md` 상단의 권한 위임 공지에 따라 배영환은 이 시점부로 개발에서 손을 뗐으므로, 이
이슈의 재조사·수정은 임소리·원호에게 인계한다.

## 5. 다음에 시도해볼 만한 방향 (미검증, 제안일 뿐)

- **`move.resync` 자체는 재검토 여지가 있다** — 서버 API(`readPositionAnchor` 재사용만 하는
  순수 조회)는 그 자체로는 무해해 보이므로, 클라이언트에서 "언제/어떻게" 호출하고 위치를
  스냅하는지의 타이밍·조건을 더 보수적으로(예: 연속 N회 실패 후에만, 또는 시각적 스냅 대신
  부드러운 보정) 설계하면 회귀 없이 살릴 수 있을지 검토 가치가 있다.
- **`MAX_INFLIGHT_ARRIVALS` 백프레셔는 이 환경(devvit 터널 RTT)에 근본적으로 안 맞을 가능성**
  — "몇 개까지 허용"이 아니라 "요청이 실제로 몇 ms 걸리는지" 실측(Chrome DevTools Network나
  실기기 로그)부터 먼저 하고, 그 실측치에 맞춰 설계를 다시 하는 게 값(2, 3, ...)을 추측으로
  튜닝하는 것보다 나을 것으로 보인다.
- **순간이동이 3차(타임아웃 제거) 이후에도 지속됐다는 건, 애초에 `move.arrive`가 이 환경에서
  가정보다 훨씬 자주 실패(`INVALID_MOVE` 등)하고 있을 가능성**을 시사한다 — `move.resync`
  도입 이전엔 이 실패가 조용히 삼켜져서 안 보였을 뿐, 실제 실패율 자체는 이미 높았을 수 있다.
  실패 원인(왜 `assertAdjacent`가 자주 걸리는지)을 서버 로그/`moveFailureStreakKey` 값으로
  직접 관측하는 게 다음 조사의 출발점으로 적절해 보인다.
- 원본 버그(3.1절 원인 분석) 자체는 여전히 실재하므로, 완전히 손 놓기보다는 위 실측을 먼저
  하고 재설계하는 쪽을 권장한다.
