# /init-project — 새 프로젝트 초기화

새 프로젝트를 시작할 때 실행하세요. Claude가 양식을 출력하면, 직접 작성해서 붙여넣으면 됩니다.

---

## 사전 확인 — 종료된 프로젝트 감지

`.project-closed` 파일이 프로젝트 루트에 존재하는지 확인한다.

**존재하는 경우**: 아래 경고를 출력하고 계속 진행 여부를 묻는다:

```
⚠️  이미 종료된 프로젝트입니다 (.project-closed 파일 존재).
   /close-project로 종료 처리된 레포지토리입니다.
   계속 진행하면 기존 종료 기록이 덮어쓰여질 수 있습니다.

   계속 진행하시겠습니까? (y/n):
```

- **n 선택 시**: 즉시 중단. 아무 파일도 변경하지 않는다.
- **y 선택 시**: Step 0으로 진행한다.

**존재하지 않는 경우**: Step 0으로 바로 진행한다.

---

## Step 0 — 신규/기존 프로젝트 감지 (A항목)

`.claude/` 폴더 존재 여부를 확인한다.

**신규 프로젝트** (`.claude/` 없음): Step 1로 바로 진행.

**기존 프로젝트** (`.claude/` 있음): 아래 메시지를 출력하고 선택을 받는다:

```
=== 기존 하네스 감지 ===
.claude/ 폴더가 이미 존재합니다.

충돌 처리 방법을 선택하세요:
  1. 병합 (권장) — 새 항목은 추가, 기존 설정은 유지
  2. 덮어쓰기    — 기존 설정을 모두 초기화
  3. 건너뜀     — .claude/ 변경 없이 문서(PRD/ARD/아키텍처)만 생성

번호를 입력하세요 (1 / 2 / 3):
```

답변을 내부 변수 `EXISTING_MODE`에 저장한다 (1=병합, 2=덮어쓰기, 3=건너뜀).

처리 방침:
- `EXISTING_MODE = 3`: Step 3의 3-6(훅 설정) 단계를 건너뛴다
- `EXISTING_MODE = 2`: Step 3의 3-6에서 settings.json을 하네스 기본값으로 교체한다
- `EXISTING_MODE = 1`: settings.json에 없는 항목만 추가한다 (기본 동작)

---

## Step 1 — 아래 양식을 사용자에게 출력한다

```
=== 프로젝트 초기화 양식 ===
(항목을 작성 후 전체를 붙여넣어 주세요)

1. 프로젝트명:
   예) my-saas-app

2. 한 줄 설명 (무엇을 위해 만드는가):
   예) 소규모 팀의 업무 일지를 자동으로 요약해 주는 슬랙 봇

3. 기술 스택:
   예) Python 3.12 + FastAPI + PostgreSQL 16 + React 18 + Docker

4. 배포 환경:
   예) AWS EC2 + Docker Compose / Vercel + Supabase / 온프레미스 / 미정

5. 타겟 유저 / 페르소나:
   예)
   - 주 사용자: 5~20인 스타트업의 개발팀 리드
   - 부 사용자: 경영진 (요약 보고서 수신)

6. 성공 지표 (KPI):
   예)
   - 일지 작성 시간 50% 단축
   - 주간 활성 사용자 100명 이상
   - 요약 만족도 평점 4.0 이상

7. MVP 핵심 기능 (반드시 구현할 것):
   예)
   - 사용자 로그인/회원가입
   - 대시보드 조회
   - 데이터 CSV 업로드

8. MVP 제외 사항 (이번 버전에 포함하지 않을 것):
   ※ AI가 알아서 추가 구현하는 것을 막는 범위 선언입니다.
   예)
   - 소셜 로그인 (Google, GitHub)
   - 이메일 알림 기능
   - 다국어(i18n) 지원

9. 비기능 요건 (성능 / 보안 / 가용성 목표):
   예)
   - 응답시간: p95 < 300ms
   - 동시 접속: 최대 200명
   - 가용성: 99.5% (월 다운타임 3.6시간 이하)
   - 보안: JWT 인증, HTTPS 강제, SQL 인젝션 방지

10. 팀 구성 / 일정:
    예)
    - 팀: 개인 프로젝트 (1인) / 2인 팀 (풀스택 1 + 디자이너 1)
    - MVP 마감: 2025-03-31
    - 런칭 목표: 2025-05-01

11. 제약사항 / 특이사항:
    예) 클라이언트 측 렌더링만 허용, 외부 API 의존 최소화, 예산 월 $50 이하

12. 이 프로젝트에서 Claude에게 특별히 지켜야 할 것:
    ※ 없으면 "없음"으로 작성하세요.
    예)
    - 테스트 없이 구현 파일 생성 금지
    - DB 스키마 변경 전 반드시 확인 요청
    - 외부 라이브러리 추가 시 항상 물어볼 것

==============================
```

---

## Step 2 — 사용자가 양식을 제출하면

### [필수] 프로젝트 규모 선택

아래 표를 출력하고 번호를 입력받는다. **이 항목은 건너뛸 수 없다.**

```
=== 프로젝트 규모 선택 ===
규모에 따라 Claude 훅(자동화 제약)이 설정됩니다.

  1. 개인 (1인)       — 현재 기본 설정 유지
  2. 스타트업 (2~10인) — + Lint·Test·Build·Sub-Agent Review 선택 설정 [H] + 아키텍처 엄격 모드 선택 [I]
  3. 회사 (10인+)     — + Lint·Test·Build + PR Sub-Agent 리뷰 자동 활성 + 아키텍처 엄격 모드 자동 설정

번호를 입력하세요 (1 / 2 / 3):
```

사용자가 번호를 입력하면 내부 변수 `SCALE`에 저장한다 (1=개인, 2=스타트업, 3=회사).

### [H] Lint·Test·Build 훅 및 Sub-Agent Review 설정

**SCALE = 1 (개인):** 두 훅 비활성. 인터뷰 생략.

**SCALE = 2 (스타트업):** 아래 질문을 출력한다:

```
=== [H-1] Lint·Test·Build 훅 설정 ===
커밋 직전 lint·테스트·빌드를 자동으로 실행할까요?
실패 시 커밋이 차단됩니다 (오류 수정 후 재시도 필요).

1. 활성화 (권장)
2. 비활성화 (나중에 /init-project 재실행 또는 settings.json 직접 수정으로 활성화 가능)

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `HOOK_LINT_ACTIVE`에 저장한다 (1=활성, 2=비활성).

**H-2. Sub-Agent PR Review 설정:**

```
=== [H-2] Sub-Agent PR Review 설정 ===
PR 생성 직전 AI가 diff를 자동으로 리뷰할까요?
이슈 발견 시 PR 생성이 차단됩니다.

1. 활성화 (PR 품질 게이트 강화)
2. 비활성화 (CI/CD가 별도로 있거나 경량 운영 시)

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `HOOK_SUBREVIEW_ACTIVE`에 저장한다 (1=활성, 2=비활성).

**SCALE = 3 (회사):** lint-test-build.sh + sub-agent-review.sh 자동 활성화. 인터뷰 생략.

---

### [I] 아키텍처 엄격 모드 설정

**SCALE = 1 (개인):** 경고 모드 유지 (`.claude/hooks-strict.flag` 생성 안 함). 인터뷰 생략.

**SCALE = 2 (스타트업):** 아래 질문을 출력한다:

```
=== [I] 아키텍처 엄격 모드 설정 ===
레이어 의존성 위반 시 파일 저장을 차단할까요?
자세한 설명: docs/ref/architecture-guide.md

1. 경고만 출력 (기본) — 위반 감지 시 경고, 저장은 허용
2. 엄격 모드 활성화 — 위반 감지 시 저장 차단 (.claude/hooks-strict.flag)

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `ARCH_STRICT`에 저장한다 (1=경고, 2=엄격).

**SCALE = 3 (회사):** 자동으로 엄격 모드 설정. 인터뷰 생략.

---

### [스킬1-A] git 브랜치 전략

**SCALE = 1 (개인):** main 브랜치만 사용. 인터뷰 생략.
- 에이전트: `code-reviewer`, `step-validator` 자동 생성 (모든 SCALE 공통 — `agents/LANES.md` 참조)
- `.gitignore` 하네스 파일 항목 자동 추가 (3-11에서 처리)

**SCALE = 2 (스타트업):** feature/* 브랜치 전략.
- `main` 직접 커밋 차단 (이미 deny에 추가됨)
- 작업은 `feature/<작업명>` 브랜치에서 진행 후 PR
- `.gitignore` 하네스 파일 항목 자동 추가 (3-11에서 처리)

**SCALE = 3 (회사):** 3단계 브랜치 전략 + ADR 강제.
- `main` (릴리즈) / `develop` (통합) / `feature/<작업명>` (개발)
- 주요 아키텍처 결정 시 `docs/design-docs/adr/` 에 ADR 파일 작성 필수
- `.gitignore` 하네스 파일 항목 자동 추가 (3-11에서 처리)

**원격 저장소 (선택, 모든 SCALE):**
아래 질문을 출력한다:

```
원격 저장소 URL이 있으면 입력하세요 (없으면 엔터):
예) https://github.com/username/repo.git
```

URL이 입력된 경우 Step 4 완료 메시지에 초기 push 명령을 안내한다:
```bash
git remote add origin <URL>
git push -u origin main
```

---

### [B] CONTRIBUTING.md 생성

아래 질문을 출력한다:

```
=== [B] 기여 가이드 생성 ===
팀 기여 가이드(CONTRIBUTING.md)를 생성할까요?

1. 생성 (권장)
2. 건너뜀

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `GEN_CONTRIBUTING`에 저장한다 (1=생성, 2=건너뜀).

---

### [D] 보안 에이전트 설정

아래 질문을 출력한다:

```
=== [D] 보안 에이전트 설정 ===
배포 예정이거나 결제·개인정보를 처리하는 경우 security-reviewer 에이전트를 활성화합니다.

1. 활성화 — 배포 예정이거나 민감 데이터(결제·개인정보)를 처리합니다
2. 건너뜀 — 내부 도구 또는 실험적 프로젝트입니다

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `GEN_SECURITY`에 저장한다 (1=활성화, 2=건너뜀).

---

### [E] 도메인 에이전트 생성

아래 질문을 출력한다:

```
=== [E] 도메인 에이전트 생성 ===
특정 비즈니스 도메인 전담 에이전트를 생성할까요?
복잡한 도메인 규칙이 있는 경우(결제, 주문, 인증 등) 유용합니다.

1. 생성
2. 건너뜀

번호를 입력하세요 (1 / 2):
```

`1` 선택 시 추가 입력을 받는다:

```
도메인명 (예: auth, payment, order):
도메인 핵심 규칙 2~3줄 (예: "주문은 결제 완료 후에만 확정"):
관련 파일 경로 패턴 (예: src/order/, src/payment/):
```

답변을 내부 변수 `GEN_DOMAIN`, `DOMAIN_NAME`, `DOMAIN_DESC`, `DOMAIN_RULES`, `DOMAIN_FILES`에 저장한다 (GEN_DOMAIN: 1=생성, 2=건너뜀).

---

### [F] 이메일 알림 설정

아래 질문을 출력한다:

```
=== [F] 이메일 알림 설정 ===
step-validator 알림(Plan 모드 Phase 완료 리포트 + 최종 실패 알림)을 설정할까요?

1. 설정 — .env에 SMTP 플레이스홀더를 추가합니다
2. 건너뜀

번호를 입력하세요 (1 / 2):
```

`1` 선택 시 추가 입력을 받는다:

```
SMTP 호스트 (예: smtp.gmail.com):
SMTP 포트 (예: 587):
발신 이메일:
수신 이메일:
```

답변을 내부 변수 `GEN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_TO`에 저장한다.
비밀번호(SMTP_PASSWORD)는 .env에 플레이스홀더(`your-smtp-password`)로만 추가하고 실제 입력은 사용자에게 맡긴다.

---

### 스킬1-B — 소크라테스식 보완 인터뷰

양식 내용을 검토해 **비어있거나 모호한 항목을 자동 감지**하고, 순차적으로 질문한다.

**감지 우선순위:**

| 순위 | 항목 | 감지 조건 | 질문 방향 |
|------|------|----------|----------|
| 1 | 8번(MVP 제외) | 비어있음 | "이번 버전에서 의도적으로 제외할 기능이 있나요?" |
| 2 | 9번(비기능 요건) | "없음"/"미정" | "p95 응답시간과 동시 접속 목표가 있나요?" |
| 3 | 10번(일정) | 없음 | "MVP를 언제까지 완성하고 싶으신가요?" |
| 4 | 3번(스택) | 버전 없음 | "사용 버전을 알려주실 수 있나요?" |
| 5 | 5번(타겟 유저) | "개발자"처럼 모호 | "주 사용자의 역할과 주요 시나리오를 구체적으로 설명해 주세요" |

**실행 규칙:**
- 한 번에 최대 2개 항목만 질문한다 (사용자 피로 방지)
- 답변 후 남은 미결 항목이 있으면 다음 질문으로 이어간다
- 모든 필수 항목이 채워지면 Step 3으로 진행한다

---

### [AI-Readiness] AI 활용도 측정 설정

아래 질문을 출력한다:

```
=== [AI-Readiness] AI 활용도 측정 ===
이 프로젝트에서 AI 활용도(AI-Readiness)를 주기적으로 측정하시겠습니까?
/ai-readiness-cartography 스킬로 점수화·시각화합니다.

1. 활성화 (권장)
2. 건너뜀

번호를 입력하세요 (1 / 2):
```

`1` 선택 시 측정 주기를 추가로 입력받는다:

```
측정 주기를 선택하세요:
1. 주 1회 (매주 월요일)
2. 월 1회 (매월 1일)

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `AI_READINESS_ACTIVE`, `AI_READINESS_CYCLE`에 저장한다 (1=주 1회, 2=월 1회).

> **참고:** 비활성 프로젝트가 되면 `/schedule cancel [ID]` 로 스케줄을 수동 중단하세요.
> Step 4 완료 메시지에서 `/schedule` 등록 방법을 안내합니다.

---

## Step 3 — 산출물 5종 생성

### 3-1. CLAUDE.md 갱신

`CLAUDE.md` 상단 플레이스홀더를 채운다:
- `[프로젝트명]` → 양식 1번
- `[프로젝트 한 줄 설명]` → 양식 2번

`CLAUDE.md` 하단에 **프로젝트 맞춤 규칙** 섹션을 추가한다:

```markdown
## 프로젝트 맞춤 규칙

> /init-project 에서 자동 생성됨. 이 프로젝트에만 적용됩니다.

### Claude 행동 지침
[양식 12번 내용 — 없음이면 이 항목 생략]

### MVP 범위 제한
> 아래 항목은 명시적 요청 없이 절대 구현하지 않습니다.
[양식 8번 제외 목록]

### 기술 스택 고정
[양식 3번 스택 — 다른 라이브러리/프레임워크 임의 도입 금지]
```

---

### 3-2. TODO.md 채우기

`TODO.md`의 플레이스홀더를 아래 구조로 교체한다:

```markdown
# TODO — [프로젝트명]

> 워크플로우: `[ ]` 대기 → `[🔄]` 진행 중 → `[x]` 완료
> 재시작 시: `docs/ref/session-state.md` 확인 후 `[🔄]` 항목부터 재개

---

## 시작 전

- [x] `/init-project` 실행 완료
- [ ] `docs/design-docs/architecture-v1.md` 검토 및 확정
- [ ] `docs/design-docs/ARD-v1.md` 비기능 요건 확정
- [ ] Phase 분할 후 `docs/exec-plans/active/`에 실행 계획 생성

---

## P0 — 기반 구축

- [ ] 레포 초기화 및 폴더 구조 생성
- [ ] 기술 스택 설치 및 Hello World 확인
- [ ] CI/CD 파이프라인 초안 구성

---

## P1 — MVP 핵심 기능

[양식 7번 기능 목록을 항목으로 변환]

---

## P2 — 검증 및 배포

- [ ] E2E 테스트 작성
- [ ] [양식 4번 배포 환경]에 배포
- [ ] KPI 측정 기준 설정
```

---

### 3-3. PRD 생성

`docs/product-specs/PRD-v1.md` 생성:

```markdown
# [프로젝트명] PRD v1

> 버전: v1 | 작성일: [오늘 날짜] | 상태: Draft

---

## 1. 개요

[양식 2번 — 한 줄 설명]

## 2. 문제 정의

[양식 내용을 바탕으로 Claude가 추론하여 작성 — "현재 어떤 불편이 있고, 왜 지금 해결해야 하는가"]

## 3. 타겟 유저

| 페르소나 | 설명 | 주요 시나리오 |
|----------|------|---------------|
[양식 5번 내용을 표 형식으로 변환]

## 4. 성공 지표 (KPI)

[양식 6번 목록]

## 5. 기술 스택

[양식 3번]

## 6. 배포 환경

[양식 4번]

## 7. MVP 핵심 기능

> 이번 버전에서 반드시 구현할 기능

[양식 7번 목록을 `- [ ]` 형식으로]

## 8. MVP 제외 사항 ⚠️

> Claude는 아래 항목을 임의로 구현하지 않습니다.

[양식 8번 목록]

## 9. 제약사항

[양식 11번]

## 10. 팀 / 일정

[양식 10번]

## 11. Phase 분할 (초안)

| Phase | 목표 | 예상 산출물 |
|-------|------|-------------|
| P0 | 기반 구축 | 레포 초기화, CI/CD |
| P1 | MVP 핵심 기능 | [양식 7번 기능들] |
| P2 | 검증 및 배포 | E2E 테스트, 배포 |

## 12. 미결 사항

| 질문 | 결정권자 | 기한 |
|------|----------|------|
| [보완 질문에서 미결된 항목이 있으면 여기에] | - | - |
```

---

### 3-4. ARD 생성

`docs/design-docs/ARD-v1.md` 생성:

> **ARD(Architecture Requirements Document)** — 아키텍처가 만족해야 하는 품질 속성과 제약을 명세합니다.
> ADR(결정 기록)과 다릅니다: ARD는 "무엇을 달성해야 하나", ADR은 "어떻게 결정했나"입니다.

```markdown
# [프로젝트명] ARD v1

> 버전: v1 | 작성일: [오늘 날짜] | 상태: Draft
> 참조 PRD: `docs/product-specs/PRD-v1.md`

---

## 1. 품질 속성 목표 (Quality Attributes)

| 속성 | 목표 | 측정 방법 | 우선순위 |
|------|------|-----------|----------|
| 성능 | [양식 9번에서 추출] | [예: p95 응답시간 측정] | High |
| 가용성 | [양식 9번에서 추출] | [예: 월간 업타임 모니터링] | High |
| 보안 | [양식 9번에서 추출] | [예: OWASP Top 10 점검] | High |
| 확장성 | [동시 접속 수 기반 추론] | [예: 부하 테스트] | Medium |
| 유지보수성 | 테스트 커버리지 70%+ | 커버리지 리포트 | Medium |

---

## 2. 아키텍처 제약사항

### 기술적 제약
[양식 11번에서 기술적 항목 추출]

### 조직적 제약
[양식 10번 팀 구성 기반 — 예: "1인 개발이므로 운영 복잡도 최소화"]

### 예산/인프라 제약
[양식 11번에서 예산/인프라 항목 추출]

---

## 3. 주요 아키텍처 결정 (초안)

> 상세 결정 기록은 `docs/design-docs/adr/` 에 ADR로 작성합니다.

| 결정 영역 | 선택 | 근거 |
|-----------|------|------|
| 레이어 구조 | [스택 기반 추론] | [이유] |
| 인증 방식 | [스택/요건 기반 추론] | [이유] |
| 데이터 저장 | [스택 기반] | [이유] |
| 배포 전략 | [양식 4번 기반] | [이유] |

---

## 4. 리스크

| 리스크 | 영향도 | 발생 가능성 | 완화 전략 |
|--------|--------|-------------|-----------|
[스택/요건/팀 규모를 바탕으로 Claude가 3~5개 추론하여 작성]

---

## 5. 검증 기준

아키텍처가 이 ARD를 만족하는지 확인하는 방법:

- [ ] 품질 속성 목표 달성 여부 — 부하 테스트 / 모니터링 지표
- [ ] 제약사항 위반 없음 — `architecture-guard.sh` 훅 통과
- [ ] 주요 결정사항 ADR 작성 완료 (`docs/design-docs/adr/`)
```

---

### 3-5. 아키텍처 초안 생성

`docs/design-docs/architecture-v1.md` 생성:

> 기술 스택, 배포 환경, 비기능 요건을 바탕으로 Claude가 초안을 작성합니다.
> `docs/ref/architecture-template.md` 구조를 따릅니다.

```markdown
# [프로젝트명] 아키텍처 v1

> 작성일: [오늘 날짜] | 버전: v1 | 상태: Draft
> 참조 ARD: `docs/design-docs/ARD-v1.md`

---

## 1. 시스템 개요

[양식 2번 설명을 기반으로 시스템이 무엇을 하는지 한 단락으로]

## 2. 컴포넌트 다이어그램

[기술 스택과 배포 환경을 기반으로 ASCII 다이어그램 생성]

## 3. 레이어 구조

[스택에 맞는 폴더 구조 제안 — Python/FastAPI면 api/services/domain/repositories/core 등]

## 4. 데이터 흐름

[주요 기능 1~2개의 Request → Response 흐름]

## 5. 주요 설계 결정

| 결정 | 선택 | 이유 | ADR |
|------|------|------|-----|
[ARD 3번 내용 연동]

## 6. 비기능 요건 달성 전략

[ARD 품질 속성별로 어떻게 달성할지 설명]

## 7. 보안 고려사항

[양식 9번 보안 요건 기반]

## 8. 배포 구성

[양식 4번 배포 환경 기반으로 구체적인 구성 제안]
```

---

### 3-6. 규모별 훅 설정 (.claude/settings.json 업데이트)

> `EXISTING_MODE = 3`(건너뜀)이면 이 단계 전체를 건너뛴다.
> `EXISTING_MODE = 2`(덮어쓰기)이면 settings.json의 `hooks` 섹션을 초기화한 후 아래 항목을 처음부터 등록한다.

`SCALE` 값에 따라 `.claude/settings.json`의 `hooks.PreToolUse` 배열을 수정한다.
Read → Edit 방식으로 JSON을 직접 수정한다.

**SCALE = 1 (개인):** settings.json 변경 없음.

**SCALE = 2 (스타트업):** Step 2 [H]항목 `HOOK_LINT_ACTIVE = 1`인 경우에만 아래 항목 추가:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/lint-test-build.sh"
    }
  ]
}
```

**SCALE = 2 (스타트업) — H-2 `HOOK_SUBREVIEW_ACTIVE = 1`인 경우:** 아래 항목도 추가:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/sub-agent-review.sh"
    }
  ]
}
```

**SCALE = 3 (회사):** 아래 두 항목을 모두 추가한다 (인터뷰 생략, 자동 활성):

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/lint-test-build.sh"
    }
  ]
}
```

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "bash .claude/hooks/sub-agent-review.sh"
    }
  ]
}
```

**SCALE = 2, 3 공통 — permissions.deny에 main 직접 푸시 차단 추가:**

`settings.json`의 `permissions.deny` 배열에 아래 항목을 추가한다 (이미 있으면 스킵):

```json
"Bash(git push origin main)",
"Bash(git push origin master)"
```

**SCALE = 2 (스타트업) — Step 2 [I]항목 `ARCH_STRICT = 2`인 경우:** 아래 SCALE=3과 동일하게 `hooks-strict.flag` 생성 및 `architecture-guard.sh` async 제거 수행.

**SCALE = 3 — 엄격 모드 플래그 생성 및 architecture-guard 동기화:**

1. `.claude/hooks-strict.flag` 빈 파일 생성:
   - 이 파일이 존재하면 `architecture-guard.sh`가 위반 시 실제로 차단(exit 1)하고,
     `tdd-enforcer.sh`가 기존 파일 수정 시에도 테스트 파일 존재를 확인한다.

2. `settings.json`에서 `architecture-guard.sh` 훅 항목의 `"async": true`를 제거:
   - async 상태에서는 exit code가 무시되어 차단이 불가능하므로 동기로 전환한다.
   - 변경 전: `{ "type": "command", "command": "bash .claude/hooks/architecture-guard.sh", "async": true }`
   - 변경 후: `{ "type": "command", "command": "bash .claude/hooks/architecture-guard.sh" }`

추가 안내:
- SCALE 3 선택 시: 팀 고유 차단 패턴이 있으면 `.claude/hooks/pre-bash-guard.sh`에 섹션을 추가하도록 안내한다.
- 이미 동일한 훅이 등록되어 있으면 중복 추가하지 않는다.

**[TDD] TDD 엄격 모드 설정 (SCALE = 2):**

`tdd-enforcer.sh`는 기본적으로 신규 파일 생성 시 테스트 파일 존재를 확인한다.
엄격 모드(기존 파일 수정 시에도 확인)를 원하면 아래 질문을 출력한다:

```
=== [TDD] TDD 엄격 모드 설정 ===
기존 파일 수정 시에도 테스트 파일 존재를 확인할까요?
(신규 파일 생성 시 테스트 확인은 항상 동작합니다)

1. 엄격 모드 — 기존 파일 수정 시에도 테스트 없으면 차단 (.claude/hooks-strict.flag)
2. 일반 모드 — 신규 파일 생성 시만 확인 (기본)

번호를 입력하세요 (1 / 2):
```

답변을 내부 변수 `TDD_STRICT`에 저장한다 (1=엄격, 2=일반).
`TDD_STRICT = 1`이면 `.claude/hooks-strict.flag` 파일을 생성한다 (이미 있으면 스킵).

> 참고: `hooks-strict.flag`는 `architecture-guard.sh`(레이어 위반 차단)와 `tdd-enforcer.sh`(기존 파일 테스트 확인)가 공유합니다.
> 자세한 동작: `docs/ref/tdd-guide.md`

**SCALE = 3:** `hooks-strict.flag`가 I항목에서 이미 생성되므로 TDD 엄격 모드도 자동 활성화됨.

---

### 3-7. CONTRIBUTING.md 생성 (`GEN_CONTRIBUTING = 1`인 경우)

`CONTRIBUTING.md` 파일을 프로젝트 루트에 생성한다. SCALE에 따라 내용이 달라진다:

**SCALE = 1 (개인):**
````markdown
# 기여 가이드

이 프로젝트는 1인 프로젝트입니다.
main 브랜치에 직접 커밋하며, 커밋 컨벤션은 `.claude/commands/commit.md`를 따릅니다.
````

**SCALE = 2 (스타트업):**
````markdown
# 기여 가이드

## 브랜치 전략
- `main`: 배포 브랜치 (직접 푸시 금지)
- `feature/<작업명>`: 작업 브랜치

## 작업 흐름
1. `git checkout -b feature/<작업명>`
2. 작업 후 커밋 (`/commit` 스킬 사용)
3. PR 생성 (`/PR` 스킬 사용)
4. 코드 리뷰 1인 이상 후 머지

## 커밋 컨벤션
`.claude/commands/commit.md` 참조
````

**SCALE = 3 (회사):**
````markdown
# 기여 가이드

## 브랜치 전략
- `main`: 릴리즈 브랜치 (직접 푸시 금지)
- `develop`: 통합 브랜치
- `feature/<작업명>`: 개발 브랜치

## 작업 흐름
1. `git checkout -b feature/<작업명> develop`
2. 작업 후 커밋 (`/commit` 스킬 사용)
3. `develop`으로 PR 생성 (`/PR` 스킬 사용)
4. 코드 리뷰 2인 이상 후 머지
5. 릴리즈 시 `develop` → `main` PR

## 아키텍처 결정
주요 기술적 결정은 `docs/design-docs/adr/` 에 ADR로 기록합니다.

## 커밋 컨벤션
`.claude/commands/commit.md` 참조
````

---

### 3-8. 보안 에이전트 활성화 (`GEN_SECURITY = 1`인 경우)

`agents/security-reviewer.md`가 이미 하네스에 포함되어 있으므로 별도 파일 생성 없이 LANES.md 표에 행이 있는지만 확인한다.

`agents/LANES.md`의 현재 에이전트 목록에 `security-reviewer.md` 행이 있는지 확인하고, 없으면 추가:
```
| `security-reviewer.md` | Review Lane | sonnet | 활성 |
```

---

### 3-9. 도메인 에이전트 생성 (`GEN_DOMAIN = 1`인 경우)

`agents/_templates/domain-agent.tpl.md`를 복사해 `agents/[DOMAIN_NAME]-agent.md`로 생성한다.

플레이스홀더 치환:
- `{{DOMAIN_NAME}}` → `DOMAIN_NAME` 변수
- `{{DOMAIN_DESC}}` → `DOMAIN_DESC` 변수
- `{{DOMAIN_RULES}}` → `DOMAIN_RULES` 변수 (줄바꿈 보존)
- `{{DOMAIN_FILES}}` → `DOMAIN_FILES` 변수

생성 후 `agents/LANES.md` 현재 에이전트 목록에 추가:
```
| `[DOMAIN_NAME]-agent.md` | Domain Lane | sonnet | 활성 |
```

---

### 3-10. 이메일 알림 설정 (`GEN_EMAIL = 1`인 경우)

`.env` 파일에 아래 항목을 추가한다 (파일 없으면 생성, 이미 있는 항목은 건너뜀):

```
# step-validator 실패 알림 (이메일)
SMTP_HOST=[SMTP_HOST 변수]
SMTP_PORT=[SMTP_PORT 변수]
SMTP_FROM=[SMTP_FROM 변수]
SMTP_TO=[SMTP_TO 변수]
SMTP_PASSWORD=your-smtp-password
```

> ⚠️  SMTP_PASSWORD는 플레이스홀더로 추가됩니다. 직접 값을 채워 넣으세요.
> `.env`는 .gitignore 대상입니다. 절대 커밋하지 마세요.

---

### 3-11. 하네스 파일 .gitignore 자동 적용 (C항목)

`.gitignore`에 아래 항목이 없으면 추가한다:

```
# Claude Code 하네스 (내부 실행 스크립트 / 민감 파일)
.claude/skills/
.env
logs/
*.log
docs/ref/session-state.md
.cache/
```

추가 후, 이미 git 추적 중인 파일이 있으면 `git rm --cached` 안내를 출력한다:
```
⚠️  아래 파일이 git 추적 중입니다. 필요시 추적에서 제거하세요:
    git rm --cached <파일경로>
```

---

## Step 4 — 생성 완료 후 안내

산출물 생성 후 아래 메시지를 출력한다:

```
✅ 초기화 완료

생성된 파일:
  - CLAUDE.md                                    (프로젝트 맞춤 규칙 추가됨)
  - TODO.md                                      (Phase 구조로 채워짐)
  - docs/product-specs/PRD-v1.md
  - docs/design-docs/ARD-v1.md
  - docs/design-docs/architecture-v1.md
  [GEN_CONTRIBUTING=1]
  - CONTRIBUTING.md
  [GEN_SECURITY=1]
  - agents/security-reviewer.md                  (하네스 기본 포함 — D항목 선택으로 LANES.md에 활성 등록됨)
  [GEN_DOMAIN=1]
  - agents/[도메인명]-agent.md
  [GEN_EMAIL=1]
  - .env                                         (SMTP 설정 추가됨)
  - .gitignore                                   (하네스 항목 추가됨)

활성화된 훅 (규모: [선택한 규모]):
  [SCALE=1] 기본 훅만 유지 (TDD 강제, 보안 가드 등)
  [SCALE=2] + Lint·Test·Build / main 직접 푸시 차단
  [SCALE=3] + Lint·Test·Build / main 직접 푸시 차단
           + Sub-Agent PR Review
           + 아키텍처 위반 차단 (엄격 모드)
           + TDD 엄격 모드 (기존 파일 수정 시에도 확인)

[SCALE=3인 경우에만 출력]
  ⚠️  팀 고유 차단 패턴이 있으면 아래 파일에 섹션을 추가하세요:
      .claude/hooks/pre-bash-guard.sh

[AI_READINESS_ACTIVE=1]
  AI-Readiness 주기 측정이 활성화되었습니다.
  /schedule 스킬로 등록하세요:
  [AI_READINESS_CYCLE=1]  → /schedule 명령으로 매주 월요일 /ai-readiness-cartography 실행 등록
  [AI_READINESS_CYCLE=2]  → /schedule 명령으로 매월 1일 /ai-readiness-cartography 실행 등록
  비활성 프로젝트가 되면 `/schedule cancel [ID]` 로 스케줄을 수동 중단하세요.

다음 단계:
  1. docs/design-docs/architecture-v1.md 검토 → 방향 수정이 있으면 알려주세요
  2. ARD의 품질 속성 목표 확정
  3. Phase 분할 계획: Plan 모드에서 /ralph 또는 /ultrawork 사용
  4. 실행 계획 생성: docs/exec-plans/active/phase-1.md
```
