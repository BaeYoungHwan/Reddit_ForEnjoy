# 자정 리셋 실측 검증 계획

> 담당: 배영환 (백엔드/비동기 데이터) | 상태: ✅ 검증 완료(2026-07-13) — 7절 참조
> 관련: `src/server/core/dailyReset.ts`, `src/server/core/redisKeys.ts`, `devvit.json`, `docs/design-docs/async-delivery.md`, `docs/wbs.md`, `docs/product-specs/PRD-v1.md`

## 1. 배경 및 목적

`docs/wbs.md`상 자정 리셋 트리거·로직 자체는 커밋 `c0f78f8`로 완료(✅)되어 있으나, "실제 발동 시각이 KST 자정과 정확히 일치하는가"는 아직 실측 전(⏳)이다. 코드 주석(`dailyReset.ts:7-9`)에 명시된 대로, `devvit.json`의 scheduler cron이 UTC 기준으로 해석된다는 가정에 근거해 `0 15 * * *`(UTC 15:00 = KST 00:00)로 설정했지만, 이 UTC 가정 자체가 devvit 공식 문서에 명문화되어 있지 않다. 즉 **로직 결함이 아니라 플랫폼 동작에 대한 미검증 가정**이 유일한 리스크이며, 이를 실제 배포 환경에서 관찰로 확인하는 것이 이 문서의 목적이다.

PR #18/#19가 병합되면서 그리드 이동·안개·함정이 서버와 실연동된 플레이 가능한 클라이언트가 갖춰졌고(`48af739`), 이제 `r/maze_footprints_dev`에서 실제 플레이 흐름 위에 자정 리셋을 관찰할 여건이 마련됐다.

## 2. 현재 구현 요약

| 항목 | 구현 방식 | 근거 |
|---|---|---|
| 트리거 | Redis TTL이 아니라 `devvit.json` scheduler cron. `"daily-reset": { "endpoint": "/internal/scheduler/daily-reset", "cron": "0 15 * * *" }` | `devvit.json:44-51` |
| 리셋 대상 | 삭제 로직 없음 — 발자국/함정/랭킹/위치앵커 키 이름에 날짜(`{mapId}:{date}`)가 포함되어 자정이 지나면 자연히 새 키에서 시작 | `redisKeys.ts:19-29`, `async-delivery.md` 2절 |
| 날짜 계산 | 서버 인스턴스 타임존에 의존하지 않도록 UTC 시각에 9시간을 직접 더해 KST 날짜 문자열 계산 | `redisKeys.ts:4-10` (`getKstDateString`) |
| 관측 마커 | `system:last-daily-reset` — 게임 로직이 참조하지 않는 순수 관측용 | `redisKeys.ts:31-36` |
| 멱등성 | `runDailyReset`은 같은 날짜에 중복 호출돼도 안전(`alreadyRanToday`로 판별만 하고 부작용 없음) | `dailyReset.ts:16-21` |

```ts
// dailyReset.ts
export async function runDailyReset(now: Date = new Date()): Promise<DailyResetResult> {
  const date = getKstDateString(now);
  const alreadyRan = await redis.get(DAILY_RESET_MARKER_KEY);
  await redis.set(DAILY_RESET_MARKER_KEY, date);
  return { date, alreadyRanToday: alreadyRan === date };
}
```

**검증 범위가 아닌 것**: 아이템 스폰 초기화, 데일리 맵 전환은 각각 아이템 리빌딩(임소리)·맵 로테이션 정책(3인 공동) 미확정으로 `dailyReset.ts` 구현 범위 밖이다(코드 주석에 명시). 이 문서는 어디까지나 "현재 구현된 리셋이 정확한 시각에 발동하는가"만 다룬다.

## 3. 검증 방법

0. **코드 확인 결과(2026-07-09)**: `src/server/routes/scheduler.ts`에 이미 관측용 로그가 있다 — 정상 발동 시 `console.log('Daily reset ran for ${date}')`, 중복 발동 시 `console.warn('Daily reset already ran for ${date}, skipping duplicate run')`. 추가 코드 변경 없이 아래 절차로 바로 관찰 가능.
1. `npm run dev`로 `r/maze_footprints_dev`에 배포한다.
2. KST 자정(00:00) 전후로 걸쳐 서버 로그를 관찰한다 — `/internal/scheduler/daily-reset` 엔드포인트 호출 시각을 로그 타임스탬프로 확인.
3. 호출 직후 Redis에서 `system:last-daily-reset` 값을 조회해, 값이 실제 관찰 시각의 KST 날짜(`getKstDateString` 결과)와 일치하는지 확인한다.
4. 같은 날 자정 전/후로 `footprint.record` 등을 호출해, 날짜 키(`footprint:{mapId}:{date}`)가 실제로 자정을 기점으로 새 키로 바뀌는지 대조한다(리셋이 "체감상" 발동했는지의 최종 확인).
5. 자정 전후 30분씩, 최소 1회는 자정을 넘겨서 관찰해 정확한 오차(있다면 몇 분/초 단위인지)를 기록한다.

## 4. 검증 체크리스트

| 확인 항목 | 방법 | 통과 기준 | 결과(2026-07-13) |
|---|---|---|---|
| cron이 실제로 매일 발동하는가 | 서버 로그에서 `/internal/scheduler/daily-reset` 호출 이력 확인 | 하루 1회 호출 확인 | ✅ 통과 |
| 발동 시각이 KST 00:00과 일치하는가 | 로그 타임스탬프와 실제 KST 00:00 대조 | 오차 ±5분 이내(스케줄러 지연 감안) | ✅ 통과(오차 약 +57초) |
| 날짜 키 롤오버가 발동 시각과 동기화되는가 | 자정 전/후 `footprint`/`leaderboard` 키 조회 | 발동 시각 이후 새 date suffix 키 생성 확인 | ⬜ 이번 회차 검증 범위 밖(후속 필요 시 별도 진행) |
| 중복 발동 방지 | 같은 날 두 번째 호출(수동 트리거 등)로 `alreadyRanToday` 값 확인 | 두 번째 호출 시 `alreadyRanToday: true` | ⬜ 이번 회차 검증 범위 밖(로직 자체는 `dailyReset.test.ts` 단위 테스트로 커버됨) |

## 5. 실패 시 대응 방안

- **cron이 KST 00:00보다 앞/뒤로 벗어난 경우**: `devvit.json`의 cron 표현식(`0 15 * * *`)에서 시(hour) 값만 오차만큼 보정 — DST 없는 고정 오프셋이므로 로직 변경 없이 설정값 조정만으로 해결 가능.
- **cron 자체가 UTC가 아닌 다른 기준으로 해석되는 경우**: `getKstDateString`의 오프셋 계산 방식은 그대로 두고, cron 표현식만 실제 플랫폼 기준 시간대에 맞게 재계산.
- **cron이 아예 발동하지 않는 경우**: `devvit.json` 등록 형식 자체를 devvit 최신 문서와 재대조(스펙 변경 가능성).

## 6. 일정

오늘(2026-07-09, D-6, "코어 게임 루프 완성" 목표일) 배포 후 관찰 시작, 늦어도 익일(2026-07-10) 자정까지 1회 관찰 완료를 목표로 했으나, 실제 관찰은 2026-07-13로 지연되었다(관찰 착수가 늦어진 것일 뿐 구현 자체의 문제는 아님).

## 7. 검증 결과(2026-07-13)

`r/maze_footprints_dev`에서 `npm run dev`(devvit playtest, 배포 상태 유지)로 실행 중인 상태에서, KST 자정(00:00) 전후로 `devvit logs maze_footprints_dev --since 1h --json` 명령으로 실측했다.

```json
{"message":"Daily reset ran for 2026-07-13","timestamp":"2026-07-12T15:00:56.825Z","tags":["Console"]}
```

- **실제 발동 시각**: UTC `2026-07-12T15:00:56.825Z` = KST `2026-07-13 00:00:56.825`
- **목표(KST 00:00:00) 대비 오차**: 약 **+57초**
- **결론**: `devvit.json`의 `"0 15 * * *"`(UTC 15:00) cron이 devvit 스케줄러에서 실제로 UTC 기준으로 해석된다는 가정이 실측으로 확인됨 — `dailyReset.ts:7-9` 주석에 남아있던 미검증 리스크 해소. 3절 검증 체크리스트 1·2번 항목 통과(오차 ±5분 이내). 3·4번 항목(날짜 키 롤오버, 중복 발동 방지)은 이번 회차 범위 밖으로 남겨둠 — 4번은 `dailyReset.test.ts` 단위 테스트로 이미 로직 커버 중이라 실측 우선순위는 낮음.
- **참고**: 같은 로그 스트림에서 `daily-reset`과 무관한 경고(`Warning: connection server error undefined: listen EADDRINUSE: address already in use :::5678`)가 관측됨 — 로컬 포트 충돌로 추정되며 이번 검증 결론에는 영향 없음, 별도 확인 필요.
