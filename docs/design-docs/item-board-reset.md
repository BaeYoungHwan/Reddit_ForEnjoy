# run.finish 성공 시 유저별 아이템 보드 리셋 기획안

> 담당: 배영환 (백엔드/비동기 데이터) | 상태: ⚠️ 기획 초안 — 확인 필요 항목 있음, 구현 착수 전
> 관련: `server-request-trap-latency-run-reset.txt`(임소리, 2026-07-14 요청 2), `src/server/trpc.ts`, `docs/design-docs/items.md`

## 1. 배경 및 문제

리더보드 기록 갱신을 위해 같은 유저가 같은 날 여러 번 재도전(골인 후 재시작)하는 경우가 있다. 미스터리 박스 보드가 `itemBoardKey(mapId, date, userId)` 키로 "유저+날짜" 단위로만 존재해(`trpc.ts` `ensureMysteryBoxesSeeded`), 하루 안에서는 몇 번을 재시작해도 같은(이미 고갈된) 보드를 계속 공유한다. 첫 판에서 아이템을 다 소진하면 그 이후 재도전은 텅 빈 맵으로 진행된다.

지금 있는 리셋은 자정 정기 리셋(`dailyReset`)뿐이고, "한 판이 끝났을 때"를 기준으로 한 리셋은 없다. `run.finish`(`trpc.ts`)는 이미 골인 시 위치 앵커(`positionAnchorKey`)를 지우는 처리를 하고 있으므로, 그 옆에 아이템 보드도 같이 지우는 처리를 추가한다.

**⚠️ 핵심 주의사항**: `ensureMysteryBoxesSeeded`는 `itemSeededKey`를 SET NX 마커로 써서 "하루 최초 1회만 시딩"을 보장한다. **`itemBoardKey`만 지우고 `itemSeededKey`를 안 지우면**, 다음 `map.getState` 호출 시 `firstSeed`가 항상 `false`가 되어 재시딩이 스킵되고 보드가 영구히 빈 채로 남는 버그가 생긴다. 반드시 두 키를 함께 지워야 한다.

## 2. 해결 방향 비교 — 즉시 재시딩 vs 지연 재시딩

**(A) 즉시 재시딩**: `run.finish` 안에서 바로 `itemBoardKey`를 새 스폰 좌표로 채우고 `itemSeededKey`를 재설정.
- 장점: `run.finish` 완료 시점에 데이터가 즉시 정합성을 갖춤.
- 단점: `run.finish` 응답에 Redis 왕복(hSet+expire 등)이 추가돼 지연이 소폭 늘어남. 시딩 로직을 `ensureMysteryBoxesSeeded`와 공유하는 별도 함수로 추출해야 함(안 하면 로직 중복).

**(B) 지연 재시딩**: `run.finish`는 `itemBoardKey`+`itemSeededKey`를 **삭제만** 하고, 다음 `map.getState`의 `ensureMysteryBoxesSeeded`가 SET NX 성공(마커가 지워졌으므로)으로 자연히 재시딩하게 둔다.
- 장점: 코드 변경 최소(`del` 2개 추가), 기존 시딩 로직 재사용, `run.finish` 응답 지연 없음.
- 단점: `del` 이후 ~ 다음 `map.getState` 호출 전까지 이론상 "빈 보드" 상태가 존재. 다만 이 구간에는 클라이언트가 보드를 조회할 방법이 없다(골인 화면 → 재도전 버튼을 눌러야 `map.getState`가 재호출되므로, 관측 가능한 부작용이 실질적으로 없음).

**제안: (B) 지연 재시딩.** 재시딩 시점 차이가 사용자에게 관측되지 않는 반면, 기존 시딩 로직을 그대로 재사용해 1절의 재생성 버그 표면을 최소화한다. 최종 선택은 팀 판단 필요.

## 3. 구현 예시 (지연 재시딩안)

```ts
// run.finish 마지막 부분 — 기존 positionAnchorKey del과 함께 병렬 처리
const rank = await redis.zRank(key, ctx.userId);

// 런 종료 — 위치 앵커뿐 아니라 유저별 아이템 보드도 함께 리셋해 다음 map.getState가
// (itemSeededKey NX 재통과로) 미스터리 박스를 재시딩할 수 있게 한다.
// ⚠️ itemBoardKey만 지우고 itemSeededKey를 빠뜨리면, ensureMysteryBoxesSeeded의
// firstSeed가 항상 false가 되어 보드가 영구히 빈 채로 남는다(재생성 버그) — 반드시 두 키를 함께 지운다.
await Promise.all([
  redis.del(positionAnchorKey(mapId, date, ctx.userId)),
  redis.del(itemBoardKey(mapId, date, ctx.userId)),
  redis.del(itemSeededKey(mapId, date, ctx.userId)),
  // detectorChargeKey 리셋 여부는 미확정 — 4절 참고
]);
return { rank: (rank ?? 0) + 1, isNewRecord };
```

`del`은 서로 다른 키를 대상으로 하고 순서에 의존하지 않으므로 `Promise.all`로 병렬 처리해 왕복 1회로 묶는다. 요청 조건대로 `isNewRecord` 여부와 무관하게 항상 실행한다(중간에 새로고침만 하고 `run.finish`가 호출 안 된 경우는 애초에 이 코드 자체가 안 도는 것으로 조건이 자연히 만족된다).

## 4. 확인 필요

- **`detectorChargeKey`/`loadoutClaimedKey`도 같이 리셋할지**: 밸런스 판단이며 PRD·`items.md`에 명시된 기준이 없다.
  - 리셋 안 함 → 재도전을 반복해 탐지기 충전을 무한정 누적시킬 위험(밸런스 붕괴 우려).
  - 리셋함 → 다른 유저별 상태(아이템 보드)와 일관성은 있으나, 로드아웃으로 받은 탐지기 충전(`loadoutClaimedKey`, "하루 1회 클레임" 마커)까지 같이 지우면 재도전마다 탐지기를 다시 못 쓰게 되는 것 아닌지 검토 필요.
  - 이 문서는 결론 내지 않음 — 팀(배영환/임소리) 논의 또는 PRD 갱신으로 확정할 것.
- **골인 화면 "재도전" 버튼이 `run.finish` 응답 완료 전까지 비활성화되는지**: 현재 UI 흐름상 그럴 가능성이 높지만 클라이언트 쪽 실제 로직 확인 안 됨. 비활성화가 안 되어 있으면, `del` 이전에 새 `map.getState`가 먼저 실행돼 옛(빈) 보드를 그대로 스킵 시딩하고, 뒤늦게 `run.finish`의 `del`이 그 보드를 지워버려 순서 역전이 발생할 수 있다.
- **`del` 실패 시 응답 처리 방식**: `run.finish`는 원자적 트랜잭션이 아니다(기존 리더보드 갱신도 zAdd/detail 쓰기가 best-effort 수준). 이번 아이템 리셋 `del`이 실패했을 때 mutation 전체를 에러로 reject해 `rank`/`isNewRecord`까지 유실시킬지, try/catch로 감싸 리셋 실패는 로그만 남기고 리더보드 결과는 정상 반환할지 — WATCH/MULTI 도입은 오버엔지니어링으로 판단해 제안하지 않되, 실패 처리 방식은 확인 필요.

## 5. 클라이언트 영향 — 임소리 담당 후속 확인

현재 `game.tsx`에는 `run.finish` 성공 후 `remainingItems` 등 로컬 아이템 상태를 리셋하는 로직이 없다. 서버가 아이템 보드를 리셋해도 클라이언트는 다음 `map.getState` 응답(보통 재도전 버튼 클릭 시)을 받기 전까지 그 사실을 알 방법이 없다. 이 기획 자체는 서버만으로 완결되지만(다음 `map.getState`가 새 `mysteryBoxes` 좌표를 내려주므로), 다음 사항은 클라이언트 쪽 확인이 필요하다:
- 재도전 시 `map.getState` 응답을 받으면 `remainingItems`/`itemRects`를 diff가 아니라 **완전히 새로 교체**하는지(안 하면 이전 판에서 이미 주운 빈 자리가 새 판에도 남을 위험).
- 4절의 재도전 버튼 비활성화 여부.

## 6. 테스트 계획

`src/server/trpc.test.ts`에 "run.finish 후 itemBoard/itemSeeded가 지워져 다음 map.getState가 미스터리 박스를 재시딩한다" 회귀 테스트를 추가한다: 픽업으로 빈 보드를 만든 뒤 `run.finish` 호출 → 이어서 `map.getState` 호출 시 `mysteryBoxes`가 원래 스폰 좌표로 다시 채워지는지 확인. 기존 `positionAnchorKey` 삭제 검증 테스트("run.finish 후에는 앵커가 지워져 다음 getState가 시작 좌표로 다시 초기화한다", `trpc.test.ts:265`) 인접 위치에 추가한다.
