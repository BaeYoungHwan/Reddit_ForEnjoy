# Plan 모드 워크플로우 상세 규칙

> CLAUDE.md "Plan 모드 실행 규칙" 항목의 세부 정의.
> Plan 모드 진입 시 이 문서를 참조한다.

---

## 1. ExitPlanMode 후 bypass 실행

ExitPlanMode 사용자 승인은 **플랜 전체에 대한 일괄 승인**이다.

- 실행 단계에서 Write / Edit / Bash 호출 시 파일별·명령별 재확인을 요청하지 않는다
- tdd-enforcer 경고가 표시되어도 실행을 멈추지 않는다 (Not-done 사유 자동 적용)
- 단, `pre-bash-guard.sh`가 차단하는 명령 (`rm -rf`, `--no-verify` 등)은 예외

```
ExitPlanMode 승인
    ↓
Write / Edit / Bash 즉시 실행 (재확인 없음)
    ↓
PostToolUse 훅 정상 작동 (audit-log, circuit-breaker 등)
```

---

## 2. exec-plans 문서 자동 생성

ExitPlanMode 직후, 아래 절차로 Phase 문서를 확인하고 없으면 자동 생성한다.

### 판단 기준

```
docs/exec-plans/active/ 에 phase-*.md 가 존재하는가?
  YES → 기존 문서에 현재 작업 태스크 추가 (해당 Phase가 있으면)
  NO  → phase-1-[slug].md 신규 생성
```

Phase 번호(N): `active/` 내 `phase-*.md` glob 후 최대 번호 + 1 (없으면 1)
slug: 플랜 제목을 소문자+하이픈으로 변환 (예: `auth-refactor`)

### 생성 문서 구조

```markdown
# Phase [N] — [플랜 제목]

> 출처: .claude/plans/[파일명].md
> 생성: [YYYY-MM-DD]

## 목표
[플랜 Context 섹션 요약 — 1~2줄]

## 태스크
- [ ] [태스크 1]
- [ ] [태스크 2]
- [ ] [태스크 N]

## 검증 기준
[플랜 검증 섹션 내용]
```

### 상태 마커

| 마커 | 의미 |
|------|------|
| `[ ]` | 대기 |
| `[🔄]` | 진행 중 (세션 중단 지점) |
| `[x]` | 완료 |

### Phase 완료 처리

모든 태스크 `[x]` 완료 후:
```
docs/exec-plans/active/phase-N-[slug].md
    → docs/exec-plans/completed/phase-N-[slug].md 이동
```

---

## 3. Phase 2 설계 에이전트 출력 형식

Plan 에이전트(Opus) 호출 시 프롬프트에 아래 형식 요건을 포함한다.
에이전트 출력을 코드 블록으로 감싸지 않고 리포트 형식 그대로 사용자에게 노출한다.

### 필수 섹션 (순서 유지)

```
## 설계 요약
[3줄 이내. 무엇을, 왜, 어떻게]

## 아키텍처 구조
[계층도 또는 컴포넌트 관계도 — 텍스트 다이어그램 가능]

## 주요 컴포넌트 및 역할
[컴포넌트명: 역할 설명, 관련 파일 경로]

## 데이터 흐름
[입력 → 처리 → 출력 순서로 서술]

## 트레이드오프 및 결정 근거
[선택한 접근법의 장단점, 대안 비교]

## 구현 순서 (Phase별)
[Phase 1: ..., Phase 2: ..., 의존성 명시]
```

### Plan 에이전트 프롬프트 템플릿

```
배경: [Phase 1 탐색 결과 요약, 관련 파일 경로 포함]
요건: [구현 요건 및 제약]
출력 형식:
  ## 설계 요약
  ## 아키텍처 구조
  ## 주요 컴포넌트 및 역할
  ## 데이터 흐름
  ## 트레이드오프 및 결정 근거
  ## 구현 순서 (Phase별)
```

---

## 4. Phase 완료 후 step-validator 호출

모든 태스크 [x] 완료 → active/ → completed/ 이동 전에 step-validator를 실행한다.

### BASE_COMMIT 캡처 시점

ExitPlanMode 승인 직후, 첫 번째 태스크 실행 전:
  BASE_COMMIT = git rev-parse HEAD

이 값을 Plan 실행 내내 유지하고 step-validator 호출 시 전달한다.

### 호출 흐름

```
모든 태스크 [x] 완료 감지
  ↓
step-validator 호출:
  BASE_COMMIT    = ExitPlanMode 직후 캡처한 커밋 해시
  CALLER_CONTEXT = plan
  PHASE_N        = 현재 Phase 번호
  PLAN_NAME      = exec-plans slug
  TASK_TOTAL     = 전체 태스크 수
  TASK_DONE      = 완료된 태스크 수
  ↓
verdict 판정
  pass: Phase N 검증 완료 → active/phase-N-[slug].md → completed/ 이동
  fail: 검증 실패 상세 리포트 → 수동 개입 요청 (active 이동 보류)
```

### 이메일 알림

SMTP 설정 시 (SMTP_HOST in .env): step-validator 5단계에서 1회 리포트 발송
SMTP 미설정 시: 이메일 건너뜀 출력 후 오류 없이 계속
