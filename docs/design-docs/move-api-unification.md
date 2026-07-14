# trap.trigger + item.pickup → 단일 API 통합 기획안

> 담당: 배영환 (백엔드/비동기 데이터) | 상태: ⚠️ 기획 초안 — 확인 필요 항목 있음, 구현 착수 전
> 관련: `server-request-trap-latency-run-reset.txt`(임소리, 2026-07-14 요청 1), `src/server/trpc.ts`, `src/shared/game-types.ts`, `docs/design-docs/traps.md`, `docs/design-docs/items.md`

## 1. 배경 및 문제

Reddit 실서버 플레이테스트 중, 방향키를 연타해 연속으로 이동하면 함정 발동/아이템 픽업 판정이 실제로 그 칸을 밟은 시점보다 한참 뒤에야 반영되거나 반영 안 된 것처럼 보이는 문제가 보고됐다(로컬 환경에선 RTT가 사실상 0이라 재현 안 됨).

원인 체인:
1. 한 칸 이동마다 클라이언트(`game.tsx`의 `resolveArrival()`)가 `trap.trigger`와 `item.pickup` 두 개의 독립 mutation을 `Promise.all`로 병렬 호출한다.
2. 두 API 모두 `readPositionAnchor` → `assertAdjacent` → `commitPosition`(`trpc.ts`) 패턴으로 "직전 위치에서 한 칸 이내로만 이동했는지"를 검증한다. 이 검증은 요청 도착 순서에 의존하므로, 응답 순서가 뒤바뀌면 위치 앵커가 아직 안 옮겨진 상태에서 정상 이동이 `INVALID_MOVE`로 오판정될 수 있다.
3. 클라이언트는 이를 막기 위해 각 API별로 `SequentialDispatcher` 큐(`trapDispatcher`, `itemDispatcher`)를 둬서 같은 종류 요청끼리 순서를 보장한다.
4. 이 직렬화가 정확성 문제는 해결했지만, 실서버처럼 RTT가 0이 아닌 환경에서 연속 이동 시 요청이 큐에 밀려 쌓이는 부작용이 생겼다. 2026-07-13 PR #41에서 `isMoving` 잠금을 트윈 완료 즉시 해제하도록 고쳐 이동 자체는 빨라졌는데, 그 결과 여러 개의 `trap.trigger`/`item.pickup` 요청이 동시에 in-flight일 수 있게 되면서 큐 적체가 새로 드러났다.

근본 원인은 **한 칸 이동당 서버 왕복이 2회**라는 점이다. 두 API가 수행하는 위치 앵커 검증/커밋 로직이 완전히 동일하므로, 하나로 합쳐 왕복을 1회로 줄인다.

**⚠️ 참고**: 임소리님 메모에서 언급된 "박스 없는 칸이면 `item.pickup` 요청 자체를 생략하는 early-exit" 최적화(`fetchItemEncounter` 맨 앞)는 **현재 develop 브랜치 코드에는 존재하지 않는다**(별도 미병합 브랜치로 추정). 이 문서는 현재 코드베이스 기준으로 작성됐다. 함정은 오라클 방지 설계상 이 최적화를 적용할 수 없어(모든 칸에서 서버에 물어봐야 함) 애초에 API 통합의 핵심 동기이며, 만약 그 아이템 쪽 early-exit이 이 통합보다 먼저 병합되면 "함정만 있고 아이템 없는 칸에서 아이템 조회를 생략"하는 이점이 있었을 텐데, 통합 API로 가면 한 번의 호출에 두 판정이 항상 같이 실리므로 그 이점 자체가 사라진다 — 두 작업 병합 순서를 임소리님과 조율할 것.

## 2. 라우터 네이밍 및 위치

신설 `move` 네임스페이스에 프로시저 `arrive`(안 — `move.arrive`)를 둔다.

- 이 이벤트는 "함정 판정"도 "아이템 판정"도 아니라 **"한 칸에 도착했다"**는 단일 사건이고, 함정/아이템은 그 결과로 파생되는 두 가지 정보일 뿐이다. `trap`이나 `item` 라우터 밑에 두면 다른 도메인의 응답 필드를 억지로 얹는 모양이 된다.
- `trap.install`, `item.claimLoadout`, `item.useDetector`는 이번 통합과 무관 — 그대로 유지한다. `move` 라우터는 이 프로시저 하나만 갖는다.
- ⚠️ **확인 필요**: 프로시저명을 `arrive`/`report`/`step` 중 무엇으로 할지는 팀 네이밍 컨벤션 논의로 최종 확정.

## 3. 응답 스키마

함정 필드(`hit`, `type`)와 아이템 필드(`picked`, `outcome`, `type`)를 한 레벨에 평평하게 섞으면, 클라이언트가 매번 다른 필드 조합으로 "이 `type`이 함정인지 아이템인지"를 구분해야 해 타입 처리가 복잡해진다. 대신 **기존 `TrapTriggerOutput`/`ItemPickupOutput`을 그대로 재사용해 두 개의 하위 객체로 중첩**한다.

```ts
// src/shared/game-types.ts
export type MoveArriveInput = Position & { mapId: string };

export type MoveArriveOutput = {
  trap: TrapTriggerOutput;  // 기존 타입 재사용 — { hit: false } | { hit: true; type: TrapType }
  item: ItemPickupOutput;   // 기존 타입 재사용 — { picked: false } | { picked: true; outcome; type }
};
```

기존 `TrapTriggerOutput`/`ItemPickupOutput`을 폐기하지 않고 재사용하므로, 5절 마이그레이션 마지막 단계에서 구 프로시저를 지워도 이 타입들은 살아남아 타입 중복이 생기지 않는다. 클라이언트의 기존 판정 로직(`result.hit && result.type`, `result.outcome`)도 `result.trap`/`result.item`에 거의 그대로 재사용 가능해 마이그레이션 난이도가 낮다.

## 4. Redis 왕복 최소화 — 구현 예시

현재(2 API 합산 최악 케이스): `trap.trigger`가 [위치+함정보드 병렬 조회 1회] → [위치 커밋 1회] → [hDel 보드 1회] → [hDel 설치자키 1회] → [respawn 시 위치 재커밋 1회] 최대 5회, `item.pickup`이 [위치+아이템보드 병렬 조회 1회] → [위치 커밋 1회] → [hDel 아이템보드 1회] → [respawn 재커밋 또는 detector incrBy 1회] 최대 4회. 게다가 두 API가 별개 HTTP 요청이라 위치 앵커를 각자 GET/SET해서 중복 왕복도 생긴다.

```ts
move: t.router({
  arrive: protectedProcedure
    .input(z.object({ mapId: z.string().min(1), x: z.number().int(), y: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const { mapId, x, y } = input;
      const date = getKstDateString();
      const posKey = positionAnchorKey(mapId, date, ctx.userId);
      const trapBoard = trapBoardKey(mapId, date);
      const itemBoard = itemBoardKey(mapId, date, ctx.userId);
      const field = tileMember({ x, y });

      // RT1: 위치 앵커 + 함정보드 + 아이템보드 — 서로 의존 없이 3방향 병렬
      const [last, rawTrap, rawItem] = await Promise.all([
        readPositionAnchor(posKey),
        redis.hGet(trapBoard, field),
        redis.hGet(itemBoard, field),
      ]);
      assertAdjacent(last, { x, y }); // 오라클 방지, 인메모리라 왕복 없음

      // RT2: 위치 커밋 — 기존엔 trap/item 각각 1회씩 총 2회였던 것을 1회로
      await commitPosition(posKey, x, y);

      let trapType: TrapType | undefined;
      let trapInstallerId: string | undefined;
      if (rawTrap) {
        const parsed = JSON.parse(rawTrap) as { type: TrapType; installerId: string };
        if (parsed.installerId !== ctx.userId) {
          trapType = parsed.type;
          trapInstallerId = parsed.installerId;
        }
      }
      const rolled = rawItem ? rollMysteryOutcome() : null;

      // RT3: 소모 처리(hDel) 병렬 발사 — 기존 순차 3회를 1회 병렬 왕복으로
      const [, , itemDeleted] = await Promise.all([
        trapType ? redis.hDel(trapBoard, [field]) : Promise.resolve(0),
        trapType ? redis.hDel(trapInstallerKey(mapId, date, trapInstallerId!), [field]) : Promise.resolve(0),
        rawItem ? redis.hDel(itemBoard, [field]) : Promise.resolve(0),
      ]);

      const trap: TrapTriggerOutput = trapType ? { hit: true, type: trapType } : { hit: false };
      const item: ItemPickupOutput =
        rawItem && itemDeleted > 0 && rolled
          ? rolled.outcome === 'trap'
            ? { picked: true, outcome: 'trap', type: rolled.type }
            : { picked: true, outcome: 'item', type: rolled.type }
          : { picked: false };

      // RT4(조건부): respawn 위치 재커밋 + 탐지기 충전 — 서로 다른 키라 병렬 가능.
      // 설치형 respawn과 스폰형 respawn이 같은 칸에서 동시에 터질 수 있어 dedupe 필요.
      const needsRespawn =
        (trap.hit && trap.type === 'respawn') || (item.picked && item.outcome === 'trap' && item.type === 'respawn');
      const needsDetectorCharge = item.picked && item.outcome === 'item' && item.type === 'detector';

      if (needsRespawn || needsDetectorCharge) {
        const start = getMapStartPosition(mapId);
        await Promise.all([
          needsRespawn ? commitPosition(posKey, start.x, start.y) : Promise.resolve(),
          needsDetectorCharge ? redis.incrBy(detectorChargeKey(mapId, date, ctx.userId), 1) : Promise.resolve(),
        ]);
      }

      return { trap, item };
    }),
}),
```

왕복 횟수: 빈 칸(대부분의 이동) = RT1+RT2 **2회**. 함정만 있는 칸 = RT1+RT2+RT3 **3회**. 함정(respawn)+아이템 동시 = RT1+RT2+RT3+RT4 **4회**. 기존엔 두 API 합산 최대 9회 + HTTP 요청 자체가 2회였던 것과 비교하면 큰 폭의 축소다. 부수 효과로, 기존 `trap.trigger`가 `hDel(boardKey)`/`hDel(installerKey)`를 순차 호출하던 것도 병렬화된다. 에러 케이스(`NO_SESSION`, `INVALID_MOVE`)는 `readPositionAnchor`/`assertAdjacent`를 그대로 재사용하므로 동일하게 유지된다.

## 5. 기존 API 유지/폐기 정책 — 4단계 마이그레이션

devvit 앱은 클라이언트+서버가 하나의 번들로 원자적으로 배포되므로(`package.json`의 `devvit upload`/`devvit playtest`), 전통적인 "서버 먼저, 클라이언트 나중" 롤링 배포 윈도우는 원칙적으로 없다. 다만 **이미 열려 있던 게임 세션**은 브라우저 메모리에 구버전 클라이언트 JS를 들고 있어 배포 후에도 한동안 구 엔드포인트(`trap.trigger`/`item.pickup`)를 계속 호출한다. 이 세션들이 자연 종료(탭 닫기/재진입)될 때까지 구 엔드포인트가 응답 가능해야 한다.

1. **서버 PR**(배영환): `move.arrive` 신설 + `MoveArriveInput`/`MoveArriveOutput` 타입 추가. 기존 `trap.trigger`/`item.pickup`은 그대로 둔다. `trpc.test.ts`에 회귀 테스트 추가(6절). `createCaller`로 클라이언트 변경 없이 단독 검증·배포 가능.
2. **클라이언트 PR**(임소리, cross-lane 리뷰로 배영환 포함): `resolveArrival`이 `move.arrive` 단일 호출로 전환. `trapDispatcher`/`itemDispatcher` 2개를 1개로 통합(세부 설계는 임소리 담당 — 이 문서는 "1개로 합칠 수 있다"는 결론까지만 제시). `IS_LOCAL_PREVIEW` 폴백도 새 응답 형태로 재작성.
3. **안정화 관찰 기간**: 배포 직후 남아있는 구버전 세션을 위해 `trap.trigger`/`item.pickup`을 "deprecated, 신규 클라이언트는 호출 안 함" 주석과 함께 유지. 기간은 ⚠️ **확인 필요**(예: 1~2일).
4. **정리 PR**: 안정화 확인 후 `trap.trigger`/`item.pickup` 프로시저와 `TrapTriggerInput`/`ItemPickupInput`(Output 타입은 3절에서 재사용 중이므로 유지) 제거.

## 6. 테스트 계획

`src/server/trpc.test.ts`의 `FakeRedis` + `createCaller` 하네스를 그대로 활용해 `move.arrive`에 대해 다음을 회귀 테스트로 추가한다: 빈 칸(둘 다 없음), 함정만 있는 칸(설치자 본인/타인), 아이템만 있는 칸(8종 outcome), 함정+아이템 동시 존재(특히 respawn+detector 동시 발생 케이스), `INVALID_MOVE`/`NO_SESSION` 에러 케이스.

## 7. 확인 필요 (요약)

- `move.arrive` 프로시저명 최종 확정.
- 5절 안정화 관찰 기간의 구체적 길이.
- 임소리님 쪽 아이템 early-exit 로직과의 병합 순서 조율(1절 참고).
- 클라이언트 `SequentialDispatcher` 통합 세부 설계는 임소리 담당 영역 — 이 문서는 API 계약까지만 책임진다.
