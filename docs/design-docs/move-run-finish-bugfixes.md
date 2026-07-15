# move.arrive / run.finish 코드리뷰 후속 — 버그 수정 기획안

> 담당: 배영환 (백엔드/비동기 데이터) | 상태: ⚠️ 기획 초안 — 8절(PR #67 리뷰 후속)은 구현 착수 전, 나머지는 커밋 `9268fb0` 반영 완료
> 관련: `/code-review high HEAD~2..HEAD`(2026-07-14, 커밋 `ae48204`/`8a749f7` 리뷰), `docs/design-docs/move-api-unification.md`, `docs/design-docs/item-board-reset.md`, `src/server/trpc.ts`, PR #67(GitHub 리뷰, 2026-07-15)

## 0. 배경

`move.arrive` 통합 API(`ae48204`)와 `run.finish` 아이템 보드 리셋(`8a749f7`)을 8각도 코드리뷰(정확성 3 + 재사용/단순화/효율성/고도/컨벤션 5)로 검토한 결과 8건이 CONFIRMED/PLAUSIBLE로 확인됐다. 이 문서는 그 8건에 대한 수정 설계를 담는다. 세 건(발견 2·4·6)은 같은 근본 원인(위치를 너무 일찍 커밋 + 최종 판정을 `hGet` 스냅샷만으로 결정)에서 나와 하나의 재구성으로 함께 해결한다.

## 1. 아이템 보드를 "즉시·멱등 재시딩"으로 전환 (발견 1)

**문제**: `run.finish`가 `itemBoardKey`+`itemSeededKey`를 삭제만 하고 다음 `map.getState`가 재시딩하길 기다리는 지연 재시딩(`item-board-reset.md` (B)안)은, 같은 유저가 탭을 2개 이상 열어둔 상태에서 한 탭의 `run.finish`(del)와 다른 탭의 `map.getState`(`ensureMysteryBoxesSeeded`의 `SET NX`+`hSet`)가 인터리빙되면 "`itemSeededKey`는 존재(재시딩 영구 차단) + `itemBoardKey`는 빈 채"인 영구 빈 보드 상태를 만들 수 있다 — 바로 `item-board-reset.md`가 경계했던 재생성 버그가 삭제 누락이 아니라 요청 간 레이스로 재현되는 것.

**해결**: 삭제 후 대기가 아니라, `run.finish`가 직접 즉시 재시딩한다.

```ts
// src/server/core/items.ts 또는 trpc.ts 상단 — ensureMysteryBoxesSeeded와 공유
async function seedMysteryBoxes(mapId: string, date: string, userId: string): Promise<void> {
  const boardKey = itemBoardKey(mapId, date, userId);
  const seededKey = itemSeededKey(mapId, date, userId);
  // 보드 먼저 채우고 마커는 마지막에 — 중간에 끊겨도 "아직 시딩 안 됨"으로 남아 자연 복구된다.
  // (기존 순서는 SET NX 마커 → hSet이라, 마커 세팅 직후 hSet이 실패하면 "seeded=true인데
  // 보드는 빈" 상태가 자정까지 고착되는 잠재 버그가 있었다 — 이번에 순서를 바로잡는다)
  await redis.hSet(boardKey, Object.fromEntries(getMysteryBoxSpawns(mapId).map((pos) => [tileMember(pos), '1'])));
  await redis.expire(boardKey, DATA_SAFETY_TTL_SECONDS);
  await redis.set(seededKey, '1', { expiration: new Date(Date.now() + DATA_SAFETY_TTL_SECONDS * 1000) });
}

async function ensureMysteryBoxesSeeded(mapId: string, date: string, userId: string): Promise<void> {
  const firstSeed = await redis.set(itemSeededKey(mapId, date, userId), '1', { nx: true });
  if (!firstSeed) return;
  await seedMysteryBoxes(mapId, date, userId); // 마커를 다시 쓰지만 값은 이미 같은 '1' — 무해
}

// run.finish 마지막 부분
await Promise.all([
  redis.del(positionAnchorKey(mapId, date, ctx.userId)),
  seedMysteryBoxes(mapId, date, ctx.userId), // del 대신 즉시 재시딩
]);
```

**왜 트랜잭션 없이도 안전한가**: `getMysteryBoxSpawns(mapId)`는 순수함수라 `run.finish`의 재시딩과 `map.getState`의 최초 시딩이 항상 동일한 필드·동일한 값(`'1'`)을 쓴다. 보드에는 이 고정 스폰 좌표 필드만 존재하므로(`hDel`도 이 필드들만 지움), 두 경로가 어떤 순서로 인터리빙되든 최종 상태는 항상 "보드 = 신선한 스폰 좌표"로 수렴한다(멱등적 last-writer-wins). `HSET`은 여러 필드를 한 번에 써도 Redis에서 단일 원자적 커맨드라 찢어진 쓰기도 없다. WATCH/MULTI 같은 트랜잭션은 이 이상 필요 없다고 판단해 도입하지 않는다.

**잔여 리스크(문서화만, 코드 대응 없음)**: 다중 탭 시나리오에서, 탭A의 `run.finish` 재시딩이 탭B가 방금 정당하게 주운 칸을 다시 "주울 수 있는" 상태로 되돌릴 수 있다 — 데이터 손상은 아니고(멱등적으로 수렴) 시각적 이상 케이스 정도이며, 4절(마이그레이션 레이스)과 같은 "동시 다중 탭" 리스크 범주로 흡수한다.

**발견 7(가변인자 `del`) 자동 해소**: 이 수정 후 `run.finish`의 삭제 대상은 `positionAnchorKey` 하나뿐이라(아이템 보드는 삭제 대신 재시딩) 애초에 여러 키를 합칠 대상이 없다.

## 2. `move.arrive` 작업 순서 재구성 (발견 2·4·6)

**문제 3건의 공통 원인**:
- 발견 4: `trap` 결과가 `hDel`의 실제 반환값이 아니라 `hGet` 스냅샷(`trapType`)에만 의존해, 동시 요청 시 같은 함정을 두 유저가 동시에 발동시킬 수 있음(`trap.trigger`에도 동일하게 있던 문제).
- 발견 2: 함정 hDel과 아이템 hDel이 하나의 `Promise.all`로 묶여있어, 한쪽이 일시 실패하면 이미 성공한 다른 쪽 소모가 롤백 없이 유실됨.
- 발견 6: 위치 커밋이 `(x,y)`로 먼저 쓰이고 respawn이면 시작 좌표로 다시 덮어써져, 매 respawn 타일마다 왕복 1회가 낭비됨.

**해결**: 판정 순서를 재구성해 세 문제를 한 번에 없앤다.

```ts
arrive: protectedProcedure
  .input(z.object({ mapId: z.string().min(1), x: z.number().int(), y: z.number().int() }))
  .mutation(async ({ ctx, input }) => {
    const { mapId, x, y } = input;
    const date = getKstDateString();
    const posKey = positionAnchorKey(mapId, date, ctx.userId);
    const trapBoard = trapBoardKey(mapId, date);
    const itemBoard = itemBoardKey(mapId, date, ctx.userId);
    const field = tileMember({ x, y });

    // RT1: 위치+함정보드+아이템보드 병렬 조회. 위치 커밋은 아직 하지 않는다(최종 목적지를
    // 알기 전에 커밋하면 respawn 시 이중쓰기가 발생한다 — 발견 6).
    const [last, rawTrap, rawItem] = await Promise.all([
      readPositionAnchor(posKey),
      redis.hGet(trapBoard, field),
      redis.hGet(itemBoard, field),
    ]);
    assertAdjacent(last, { x, y }); // 오라클 방지 — 커밋 여부와 무관하게 앵커 검증은 여기서 끝난다.

    let trapType: TrapType | undefined;
    let trapInstallerId: string | undefined;
    if (rawTrap) {
      const parsed = JSON.parse(rawTrap) as { type: TrapType; installerId: string };
      if (parsed.installerId !== ctx.userId) {
        trapType = parsed.type;
        trapInstallerId = parsed.installerId;
      }
    }
    const rolled = rawItem ? rollMysteryOutcome() : null; // 순수 계산, 부수효과 없음

    // RT2(조건부): 소모할 게 있는 것만 개별 실행 — Promise.allSettled로 서로의 실패에 영향받지
    // 않게 격리한다(발견 2: 한쪽 hDel 실패가 다른 쪽의 이미 성공한 소모까지 무효화하지 않도록).
    const [trapBoardResult, , itemResult] = await Promise.allSettled([
      trapType ? redis.hDel(trapBoard, [field]) : Promise.resolve(0),
      // trapInstallerKey는 설치자 UI(myTraps)용 부기일 뿐이라 게이팅에 쓰지 않는다 — 실패해도
      // DATA_SAFETY_TTL_SECONDS로 자연 소멸하므로 감수한다.
      trapType ? redis.hDel(trapInstallerKey(mapId, date, trapInstallerId!), [field]) : Promise.resolve(0),
      rawItem ? redis.hDel(itemBoard, [field]) : Promise.resolve(0),
    ]);

    // 게이팅: hDel이 fulfilled && count>0일 때만 실제로 소모된 것으로 인정한다(발견 4 — 기존엔
    // hGet 존재만으로 hit:true를 반환해 동시 요청 시 이중발동이 가능했다).
    const trapDeleted = trapBoardResult.status === 'fulfilled' ? trapBoardResult.value : 0;
    const itemDeleted = itemResult.status === 'fulfilled' ? itemResult.value : 0;

    const trap = trapType && trapDeleted > 0 ? ({ hit: true, type: trapType } as const) : ({ hit: false } as const);
    const item =
      rawItem && itemDeleted > 0 && rolled
        ? rolled.outcome === 'trap'
          ? ({ picked: true, outcome: 'trap', type: rolled.type } as const)
          : ({ picked: true, outcome: 'item', type: rolled.type } as const)
        : ({ picked: false } as const);

    const needsRespawn =
      (trap.hit && trap.type === 'respawn') || (item.picked && item.outcome === 'trap' && item.type === 'respawn');
    const needsDetectorCharge = item.picked && item.outcome === 'item' && item.type === 'detector';

    // RT3: 위치 커밋을 이 시점에 단 1회만 — 목적지를 미리 정해서 쓰므로 이중쓰기가 없다(발견 6 해결).
    const destination = needsRespawn ? getMapStartPosition(mapId) : { x, y };
    await Promise.all([
      commitPosition(posKey, destination.x, destination.y),
      needsDetectorCharge ? redis.incrBy(detectorChargeKey(mapId, date, ctx.userId), 1) : Promise.resolve(),
    ]);

    return { trap, item };
  }),
```

**왕복 재계산**: 빈 칸 = RT1+RT3(커밋만) **2회**. 소모할 게 하나라도 있으면(함정만/아이템만/함정+아이템+respawn+detector 전부 동시) 예외 없이 RT1+RT2+RT3 **3회**로 수렴 — 기존 설계(최대 4회)보다 개선된다.

**`trap.trigger`(그대로 유지, 마이그레이션 기간 계속 라이브)에도 최소 패치**: `hDel(boardKey, [field])`의 반환값이 0이면 `{ hit: false }`로 응답하도록 게이팅만 추가(발견 4가 이 프로시저에도 그대로 있으므로).

**⚠️ 확인 필요**: 위치 커밋을 RT2 이후로 미루면서, 같은 유저가 매우 빠르게 연속 이동을 보낼 때 다음 요청의 앵커 반영이 한 왕복만큼 늦어지는 창이 이전보다 넓어진다. 클라이언트가 이전 `move.arrive` 응답을 기다린 뒤 다음 이동을 보내는 방식이면 무해하지만, 낙관적으로 연타를 그대로 쏘는 방식이면 `INVALID_MOVE` 오탐이 소폭 늘 수 있다 — 클라이언트 쪽 dispatcher 통합 설계(`move-api-unification.md` 5절 2단계, 임소리 담당, 미확정)가 정해지면 이 부분과 교차 확인이 필요하다.

## 3. `run.finish` 응답을 try/catch로 보호 (발견 3)

**문제**: 리더보드 쓰기(`zAdd`/`hSet`)가 이미 커밋된 뒤 실행되는 아이템 보드/위치 앵커 정리 블록이 실패하면 mutation 전체가 reject돼, 이미 세운 기록의 `rank`/`isNewRecord` 응답이 통째로 유실되고 재시도 시 `isNewRecord`가 잘못 `false`로 계산된다.

```ts
const rank = await redis.zRank(key, ctx.userId);
try {
  await Promise.all([
    redis.del(positionAnchorKey(mapId, date, ctx.userId)),
    seedMysteryBoxes(mapId, date, ctx.userId), // 1절 참고
  ]);
} catch (err) {
  // 리더보드 기록은 이미 확정됐으므로, 뒷정리 실패로 사용자에게 rank 응답 자체를 잃게 하지 않는다.
  console.error(`run.finish: 위치 앵커/아이템 보드 정리 실패 (userId=${ctx.userId}, mapId=${mapId})`, err);
}
return { rank: (rank ?? 0) + 1, isNewRecord };
```

두 실패의 사용자 체감은 다르다는 점을 기록해둔다: 아이템 보드 재시딩 실패는 다음 재도전 때 보드가 안 채워지는 정도지만(무해에 가까운 지연), `positionAnchorKey` del 실패는 다음 `map.getState`의 `SET NX`가 막혀 새 런의 시작 위치가 골인 지점 그대로 남는 문제로 이어질 수 있다 — 다만 코드 분기까지는 하지 않고 로그로만 구분한다(클라이언트에 부분 실패를 알리는 별도 응답 필드는 재시도 로직이 없어 받아도 조치 불가하므로 도입하지 않음).

## 4. 마이그레이션 기간 앵커 레이스는 문서화로 대응 (발견 5)

`trap.trigger`/`item.pickup`(구)과 `move.arrive`(신)가 같은 `positionAnchorKey`를 조율 없이 공유해, 같은 유저가 구/신 클라이언트 탭을 동시에 열어두면 두 엔드포인트 사이에서 앵커 순서 역전이 재현될 수 있다. 분산 락 등 코드 수정 없이 위험을 인지·문서화하는 것으로 대응한다(해커톤 프로젝트 성격에 맞음, 오버엔지니어링 회피).

`move-api-unification.md` 5절의 "안정화 관찰 기간: 확인 필요"를 다음으로 구체화한다: **배포 후 24~48시간 유지 → 구 엔드포인트(`trap.trigger`/`item.pickup`) 호출 로그/카운터가 0에 수렴한 것을 확인 → 정리 PR(구 프로시저 삭제) 진행.**

## 5. `docs/wbs.md` 근거 열 커밋 해시 보완 (발견 8)

53행(`move.arrive`)에 `ae48204`, 54행(`run.finish` 아이템 보드 리셋)에 `8a749f7`를 추가한다 — CLAUDE.md 규칙("근거 열에 커밋 해시 또는 PR 번호 기재")을 지금 지키지 못하고 있던 것을 바로잡는 순수 문서 작업.

## 6. 테스트 계획 (구현 턴에서 진행)

`trpc.test.ts`에 다음 회귀 테스트를 추가한다:
- **발견 4 회귀**: 동일 함정 타일에 두 유저가 `Promise.all`로 동시에 `move.arrive`(또는 `trap.trigger`)를 호출하면 한쪽만 `hit:true`를 받는지(FakeRedis가 동기 실행이라 재현 가능).
- **발견 1 "즉시성" 회귀**: `run.finish` 직후, 개입하는 `map.getState` 호출 없이도 아이템 보드가 이미 채워져 있는지(다른 caller의 `hGetAll` 또는 즉시 `map.getState` 호출로 확인) — 기존 두 테스트(`trpc.test.ts` "run.finish 아이템 보드 리셋" describe)는 지연/즉시 재시딩 어느 쪽이든 통과하므로 "즉시성" 자체를 고정하는 테스트가 아니었다.

기존 45개 테스트는 전부 경쟁자 없는 단일 요청 시나리오라 게이팅 로직 변경으로 결과가 달라지지 않는다 — 깨지지 않을 것으로 예상. WATCH/MULTI를 새로 쓰지 않으므로 FakeRedis의 `watch()` mock 확장은 불필요.

## 8. PR #67 리뷰 후속 — 시딩 마커 순서 갭 (2026-07-15)

`develop→main` PR #67 리뷰에서 이 문서 1절이 도입한 `seedMysteryBoxes`/`ensureMysteryBoxesSeeded`에 후속 결함 1건이 지적됐다.

**문제**: `seedMysteryBoxes`(`trpc.ts:134-144`)의 주석은 "보드 먼저 채우고 마커는 마지막에 세운다 — 중간에 끊겨도 자연 복구된다"고 주장하지만, 이 안전장치는 **`run.finish`가 `seedMysteryBoxes`를 직접 호출하는 경로에만** 실제로 성립한다. `ensureMysteryBoxesSeeded`(146-151행, `map.getState`가 매 호출마다 타는 더 빈번한 경로)는 `seedMysteryBoxes`를 부르기도 전에 이미 `SET NX`로 `itemSeededKey`를 먼저 세워버린다 — "마커 먼저, 보드 나중"인 역순. 그 상태에서 `seedMysteryBoxes` 내부의 `hSet`이 실패(네트워크 오류 등)하면, 마커는 이미 `'1'`이라 다음 `map.getState` 호출도 스킵되고 보드가 그날 계속 빈 채로 남는다 — 정확히 이 문서 1절이 "해소했다"고 주장하는 재생성 버그가 `map.getState` 경로에는 그대로 남아있었다(완전 영구 고착은 아니고, 해당 유저가 나중에 `run.finish`에 도달하면 그때 복구되긴 함).

**수정안**: `ensureMysteryBoxesSeeded`의 가드를 원자적 `SET NX` 선점에서 비원자적 `GET` 확인 + 멱등 재시딩으로 전환한다.

```ts
async function ensureMysteryBoxesSeeded(mapId: string, date: string, userId: string): Promise<void> {
  const alreadySeeded = await redis.get(itemSeededKey(mapId, date, userId));
  if (alreadySeeded) return;
  await seedMysteryBoxes(mapId, date, userId); // 보드 먼저, 마커 나중 — 두 경로 모두 동일하게 적용됨
}
```

두 호출 경로가 이제 `seedMysteryBoxes` 내부의 단일 순서(hSet → expire → set 마커)로 수렴한다. `itemSeededKey`가 유저별 독립 키라 타 유저와는 경쟁하지 않고, 같은 유저의 다중 탭 동시 호출도 `getMysteryBoxSpawns`가 순수함수라 항상 같은 데이터로 멱등 수렴한다(데이터 손상 없음). 잔여 리스크는 그날 최초 시딩이 진행 중인 극히 좁은 창(수백ms)에서 동시 픽업이 겹치면 "방금 주운 칸이 잠깐 부활"하는 이상 케이스인데, 이는 `run.finish`가 이미 감수 중인 다중 탭 리스크(1절 "잔여 리스크")의 **부분집합**(노출 창이 더 좁음)이라 별도 대응하지 않는다.

**기각한 대안**:
- WATCH/MULTI — 1절·4절과 같은 논리로 기각(오버엔지니어링, 해커톤 프로젝트 성격에 안 맞음).
- `SET NX` 유지 + 실패 시 마커 롤백(`redis.del`) — 기각. (1) `run.finish` 경로엔 NX 가드가 없어 `seedMysteryBoxes` 자체가 이미 "보드 먼저, 마커 나중"을 자력으로 지켜야 하는데, 그 위에 NX+롤백을 얹으면 "무엇이 진짜 마커 쓰기인지" 이중화된다. (2) 롤백 자체가 새 실패 지점이라 롤백이 실패하면 원래 버그로 되돌아가, GET 기반 안의 "실패해도 항상 자연 복구" 성질을 보장 못 한다.

**주석 정합성**: `trpc.ts` 122-125행, 147행의 `SET NX` 전제 주석을 "GET 기반 판정 + 원자성 트레이드오프(다중 탭 시 무해한 멱등적 중복 재시딩 가능)"로 갱신한다 — 안 그러면 코드가 스스로 주장하는 보장과 실제 동작이 다시 어긋난다.

**테스트 계획 — FakeRedis 실패 주입 훅 신설**: 지금까지 FakeRedis(`trpc.test.ts` 13-179행)는 어떤 호출도 실패시킬 수 없어 "부분 실패" 시나리오를 테스트할 방법이 없었다. 범용 실패 주입 훅을 추가한다.

```ts
private failNextCalls = new Map<string, number>();
failNext(method: string, times = 1): void { this.failNextCalls.set(method, times); }
private maybeFail(method: string): void {
  const remaining = this.failNextCalls.get(method);
  if (remaining && remaining > 0) {
    this.failNextCalls.set(method, remaining - 1);
    throw new Error(`FakeRedis: injected failure for ${method}`);
  }
}
// hSet 등 관련 메서드 시작부에 this.maybeFail('hSet') 추가, reset()에 failNextCalls.clear() 추가
```

회귀 테스트("map.getState 미스터리 박스 시딩" describe에 추가): `hSet`에 1회 실패를 주입한 뒤 `map.getState` 호출이 에러를 던지는지, 그 시점에 `itemSeededKey`가 세워지지 않았는지, 실패 주입 없이 재호출하면 보드가 정상적으로(스폰 3곳) 채워지는지 확인. **구현 전 검증 조건**: 이 테스트를 수정 전(`SET NX` 버전) 코드에 돌리면 반드시 실패해야 한다(마커가 먼저 세워져 재호출도 스킵되므로) — 실제로 이 버그를 잡아내는 테스트인지 전/후 비교로 확인할 것. 기존 두 테스트(374-386행, 388-404행)는 영향 없음.

## 9. 이번 문서 범위 밖

- `detectorChargeKey`/`loadoutClaimedKey` 리셋 여부 등 `item-board-reset.md`에 이미 열려있던 미결 항목 — 이번 발견들과 무관, 별도 논의 필요.
- 클라이언트(`game.tsx`) 쪽 dispatcher 통합, "재도전" 버튼/흐름 자체의 부재 — 임소리 담당, 이 문서는 서버 API 계약까지만 책임진다.
- ✅ 위치 커밋 지연으로 인한 `INVALID_MOVE` 오탐 가능성(2절에 이미 확인 필요로 기록) — 2026-07-15 실서버에서 실제로 재현됨(임소리 리포트, 다른 팀원들도 동일 증상). 원인 분석과 수정은 `docs/design-docs/position-anchor-permanent-lock.md` 참고.
