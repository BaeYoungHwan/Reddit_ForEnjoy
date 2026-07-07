# 비동기 힌트/함정 전달 메커니즘 — 설계안

> 담당: 배영환 (백엔드/비동기 데이터) | 상태: 초안 — 함정 비노출/슬롯 반환 정책은 임소리 확인 필요
> 관련: `docs/design-docs/traps.md`, `docs/product-specs/PRD-v1.md`

## 1. 전달 모델: 로드 시 스냅샷 조회 (세션 중 폴링 없음)

플레이어가 맵에 진입할 때 그 시점까지의 발자국/내 함정 슬롯을 한 번에 조회해서 클라이언트에 내려주고, 세션 중에는 재조회하지 않는다.

**근거**: PRD 핵심 문장이 "서로 다른 시간에 접속한 유저끼리 간접 상호작용"이므로, 같은 시간대에 겹쳐 플레이하는 유저끼리 실시간으로 영향을 주는 것은 설계 의도가 아니다. 재시작/재진입 시 자연스럽게 최신 스냅샷을 받는 것으로 "다음 접속자에게 힌트/함정 전달"이라는 훅은 충분히 성립한다. Devvit 서버리스 호출 비용도 아낀다.

## 2. Redis 데이터 구조

날짜는 KST 자정 기준 `YYYY-MM-DD`로 서버에서 계산(클라이언트 신뢰 금지). **키 이름에 날짜를 포함하는 것을 리셋의 기준으로 삼고, TTL(3일)은 메모리 정리용 안전장치로만 사용한다** — TTL만으로 자정 리셋을 구현하면 세션 도중 만료되는 레이스가 생길 수 있다.

### 발자국 — Sorted Set

```
키: footprint:{mapId}:{date}
멤버: "{x}:{y}"
스코어: 마지막 방문 timestamp(ms)
```

List+LTRIM 대신 ZSET을 쓰는 이유: 미로는 같은 타일을 여러 번 밟는 경우가 많은데, `ZADD`는 기존 멤버면 스코어만 갱신(자동 dedup)하므로 상한이 항상 "서로 다른 타일 N개"를 보장한다.

- 기록: `ZADD footprint:{mapId}:{date} {now} "{x}:{y}"` (여러 개는 파이프라인)
- 상한 집행: write 직후 `ZREMRANGEBYRANK footprint:{mapId}:{date} 0 -(CAP+1)` — 가장 오래 전 방문부터 제거
- 조회: `ZRANGE footprint:{mapId}:{date} 0 -1`

### 함정 — Hash 2종 (보드 인덱스 + 설치자 인덱스)

```
trap:{mapId}:{date}                        Hash, 필드 "{x}:{y}" → {type, installerId, installedAt}
trap:installer:{mapId}:{date}:{userId}     Hash, 필드 "{x}:{y}" → type
```

보드 키만으로는 "이 유저가 몇 개 설치했나"를 알려면 전체 스캔이 필요한데, 설치자별 보조 인덱스를 두면 개수 제한 체크가 항상 O(1)~O(3)로 끝난다(최대 3개 제한이므로 스캔 비용도 무시 가능).

### 리더보드

```
leaderboard:{mapId}:{date}   Sorted Set, 멤버 userId, 스코어 clearTimeMs
```

동일한 date-key 규칙을 따르므로 별도 리셋 로직 불필요 — 새 날짜가 되면 새 빈 키에서 시작.

### 위치 앵커 (이동 판정 권위, 보안 목적)

```
pos:{mapId}:{date}:{userId}   String, 값 "{x}:{y}"   TTL 2시간(세션 안전장치)
```

`trap.trigger`가 클라이언트가 보낸 좌표를 그대로 신뢰하면, 실제로 가본 적 없는 좌표를 무작위로 호출해 맵 전체의 함정 위치를 오라클처럼 알아낼 수 있다(4절 "타인 함정 비노출" 정책이 API 레벨에서 무력화됨). 이를 막기 위해 서버가 유저별 "마지막 확인된 위치"를 별도 키로 추적하고, 다음 요청이 인접 타일인지 검증한다. 발자국(ZSET)이나 리더보드처럼 게임의 영속 데이터가 아니라 순수 세션 방어용 앵커이므로 짧은 TTL로 자동 정리한다.

## 3. 함정 개수 제한 집행

```
function installTrap(mapId, date, userId, type, x, y):
  current = HGETALL(trap:installer:{mapId}:{date}:{userId})   // 최대 3개
  if len(current) >= TOTAL_TRAP_CAP: return FAIL("TOTAL_CAP_REACHED")
  if count(v == type for v in current.values()) >= PER_TYPE_CAP[type]: return FAIL("TYPE_CAP_REACHED")

  // 타일 점유 판정은 HSETNX로 원자적으로 처리 (필드가 없을 때만 성공) —
  // 두 유저가 같은 타일에 거의 동시에 설치를 시도해도 하나만 성공하도록 보장
  placed = HSETNX(boardKey, "{x}:{y}", JSON({type, installerId: userId, installedAt: now}))
  if not placed: return FAIL("TILE_OCCUPIED")

  WATCH installerKey
  MULTI
    HSET installerKey "{x}:{y}" type
    EXPIRE boardKey / installerKey TTL_SECONDS
  ok = EXEC
  if not ok:                          // 동일 유저의 동시 재설치 레이스 — 위에서 심은 보드 엔트리 롤백
    HDEL boardKey "{x}:{y}"
    return FAIL("RETRY")              // 클라이언트가 1회 재시도
```

```
function triggerTrap(mapId, date, stepperId, x, y):
  last = GET(pos:{mapId}:{date}:{stepperId})
  if last is null: return FAIL("NO_SESSION")            // map.getState 없이 호출 — 비정상
  if manhattanDistance(last, {x,y}) > 1: return FAIL("INVALID_MOVE")   // 인접 타일 아니면 거부(좌표 스캔 방지)
  SET pos:{mapId}:{date}:{stepperId} "{x}:{y}" EX 7200   // 이동이 유효할 때만 위치 갱신

  raw = HGET(trap:{mapId}:{date}, "{x}:{y}")
  if not raw: return { hit: false }
  {type, installerId} = parse(raw)
  if installerId == stepperId: return { hit: false }   // 자기 함정 회피, 소모되지 않음

  HDEL trap:{mapId}:{date} "{x}:{y}"
  HDEL trap:installer:{mapId}:{date}:{installerId} "{x}:{y}"   // 슬롯 즉시 반환
  if type == "respawn":
    SET pos:{mapId}:{date}:{stepperId} "{startX}:{startY}" EX 7200   // 순간이동 반영, 다음 인접 판정 기준점 갱신
  return { hit: true, type }
```

**함정 발동 시 설치자 슬롯 즉시 반환으로 확정.** `traps.md`의 "설치 쿨다운 없음 — 개수 제한으로만 통제"가 의미를 가지려면 개수 제한이 지속적으로 순환하는 자원이어야 한다. 발동돼도 슬롯이 안 열리면 초반에 다 쓴 유저는 하루 종일 재설치 불가로 "쿨다운 없음"과 모순되고, 슬롯이 안 닫히면 함정이 무한 누적된다.

**`trap.trigger`에 위치 인접성 검증을 추가한 이유(보안)**: 이 API는 4절 표에서 보듯 이동 중 새 타일에 진입할 때마다 이미 호출되므로, 별도의 전용 이동 엔드포인트를 새로 추가하지 않고 이 호출 안에서 위치 앵커를 함께 검증/갱신한다. 인접 타일 검증만으로 봇이 그리드 전체를 실제로 걸어서 훑는 것 자체를 막을 수는 없지만(그건 정상 플레이와 동일한 비용이 든다), 최소한 "한 번의 API 호출로 임의 좌표의 함정 유무를 즉시 조회"하는 오라클 공격은 차단된다 — "타인 함정 비노출" 정책이 API로 우회되지 않도록 하는 최소 방어선.

`TOTAL_TRAP_CAP`, `PER_TYPE_CAP` 등은 하드코딩하지 않고 설정값으로 분리한다 — `traps.md`의 ⚠️ 수치가 플레이테스트로 확정되면 설정값만 갱신.

## 4. tRPC 프로시저 (`src/server/trpc.ts`)

| 프로시저 | 입력 | 출력 | 설명 |
|---|---|---|---|
| `map.getState` (query) | `{ mapId }` | `{ date, footprints: {x,y}[], myTraps: {x,y,type}[] }` | 맵 진입 시 1회. **타인 함정은 노출하지 않음** — 밟기 전까지 서프라이즈 유지. 위치 앵커(`pos:...`)를 시작 타일로 초기화 |
| `footprint.record` (mutation) | `{ mapId, tiles: {x,y}[] }` | `{ recorded: number }` | 배치 기록 → ZADD 파이프라인 + 1회 트림 |
| `trap.install` (mutation) | `{ mapId, type, x, y }` | `{ success, reason?, myTraps }` | 3절 로직. 성공 시 갱신된 내 슬롯 목록 반환 |
| `trap.trigger` (mutation) | `{ mapId, x, y }` | `{ hit, type? }` | 이동 중 새 타일 진입 시 호출. 위치 앵커로 인접성 검증 후 판정(3절) — 서버가 유일한 판정 권위자 |
| `run.finish` (mutation) | `{ mapId, clearTimeMs }` | `{ rank, isNewRecord }` | 골인 시 리더보드 반영 |
| `leaderboard.get` (query) | `{ mapId }` | `{ entries: {userId, clearTimeMs, rank}[] }` | 리더보드 조회 |

`devvit.json`에 각 프로시저 엔드포인트 매핑 + 자정 리셋 스케줄러 트리거(`0 0 * * *` KST) 등록 필요.

## 5. 발자국 쓰기 전략: 클라이언트 배치

이동 타일을 로컬에 누적하다가 다음 중 먼저 도달하는 시점에 flush:
- 이동 5타일마다 (설정값)
- 마지막 flush 후 3~4초 경과 (설정값, debounce)
- 함정 발동·골인·페이지 이탈 시 즉시

발자국은 비authoritative 힌트 데이터라 배치 지연이나 마지막 몇 초 유실이 게임 진행에 영향 없다 — 매 타일 즉시 쓰기로 서버리스 호출 비용을 늘릴 이유가 없다.

**의도적으로 다루지 않는 위험(accepted risk)**: `footprint.record`는 `trap.trigger`와 달리 위치 앵커 검증을 거치지 않으므로, 클라이언트가 가본 적 없는 좌표를 발자국으로 위조해 다른 유저를 잘못된 길로 유도할 수 있다. 발자국은 애초에 참고용 힌트일 뿐 진행에 필수가 아니고(위 문단), 검증을 추가하면 배치 처리 이점이 사라지므로 이번 설계에서는 의도적으로 방어하지 않는다. 어뷰징이 실제로 문제가 되면 위치 앵커와 대조해 앵커 경로에서 벗어난 좌표는 버리는 서버측 필터를 추가하는 것으로 확장 가능(7절).

## 6. 발자국 개수 상한: 맵당 최근 300개 서로 다른 타일

`FOOTPRINT_CAP_PER_MAP = 300` (설정 상수, 실제 맵 그리드 크기 확정 후 재검토).

- 렌더링 성능: 수백 개 수준은 모바일에서도 렌더링 안전권(PRD가 모바일 대응 명시)
- 네트워크: 300개 좌표는 JSON 수 KB 수준 — 맵 로드 1회성 조회에서 병목 아님
- 게임성: ZSET의 "최근 방문 시각" 기준 트림이 상한을 롤링 윈도우로 유지 — 시간이 지나도 미로 전체가 스포일러되지 않으면서 최근 활동이 우선 반영됨
- 집행: write 경로에서 `ZADD` 직후 트림 한 번이면 되므로 추가 인프라 불필요

## 7. 향후 확장 (스트레치, 이번 범위 아님)

- `visibilitychange`(탭 재포커스) 시점 1회 재조회 — 폴링 루프 없이 저비용 커버
- 폴링 도입 시 ZSET 스코어를 `since` 파라미터로 활용한 증분 조회
- "내 함정에 걸렸다" 알림(댓글/DM) — PRD의 재방문 훅 강화, P1 이후 검토
- 실시간 동시 플레이는 현재 요구사항 밖 — 필요해지면 Devvit Realtime/Pub-Sub이 필요한 별도 아키텍처이므로 지금 설계에 무리하게 끼워 넣지 않는다
