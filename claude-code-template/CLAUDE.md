# Claude Code 하네스 템플릿 — 지침 지도

> 이 파일은 ~100줄 지도입니다. 세부 규칙은 `docs/`에 있습니다.

---

## 핵심 규칙 (항상 적용)

- 코드·변수명: **영어** / 주석·커밋·소통: **한국어**
- 민감정보(API 키 등): `.env` 관리, 절대 커밋 금지
- CLAUDE.md는 핵심 규칙만 유지 — 특정 상황 규칙은 `docs/ref/`에 배치
- AI 행동 원칙 (코딩 전 사고, 단순함, 수술적 변경, 목표 중심) → [`docs/ref/behavioral-principles.md`](docs/ref/behavioral-principles.md)
- 브랜치 생성 금지: 사용자 명시 지시 없이 `git checkout -b`, `git switch -c` 실행 불가

---

## 모델 사용 규칙

| 작업 유형 | 모델 |
|-----------|------|
| 탐색 / grep / 파일 검색 | Haiku |
| 개발 (코딩, 디버깅, 리팩터링) | Sonnet |
| 설계 / 계획 (Plan 모드) | Opus |

자세한 기준 → [`docs/ref/agent-model-routing.md`](docs/ref/agent-model-routing.md)

---

## 보안 규칙

- `--no-verify`, `curl | sh`, 자격증명 직접 입력 금지 (훅이 차단)
- 모든 Bash 명령은 `logs/claude-audit.log`에 자동 기록됨
- 자세한 보안 정책 → [`docs/SECURITY.md`](docs/SECURITY.md)

---

## 에이전트 사용 규칙

- `agents/` 폴더 에이전트: **병렬 처리 서브태스크** 전용
- Plan 모드로 설계 후 독립적으로 분리 가능한 작업은 반드시 에이전트로 병렬 실행
- 에이전트 분류 기준 → [`agents/LANES.md`](agents/LANES.md)

**Plan 모드 실행 흐름**:
- 독립 태스크 3개+ → `/ultrawork`
- 독립 태스크 1~2개 → `/ralph`
- 단순 작업 → 직접 실행

**Plan 모드 실행 규칙** → [`docs/ref/plan-mode-workflow.md`](docs/ref/plan-mode-workflow.md):
- ExitPlanMode 승인 = 플랜 전체 일괄 승인 → 실행 단계 파일별 재확인 없음
- ExitPlanMode 직후 `docs/exec-plans/active/` Phase 문서 없으면 자동 생성
- Phase 2 설계 출력: 섹션형 리포트 형식 (코드 블록 아님)

---

## 작업 흐름

| 상황 | 참조 문서 |
|------|-----------|
| 새 프로젝트 시작 | [`docs/ref/project-setup.md`](docs/ref/project-setup.md) → `/init-project` |
| TODO 작업 진행 | [`docs/ref/todo-workflow.md`](docs/ref/todo-workflow.md) |
| 커밋 작성 | [`docs/ref/commit-convention.md`](docs/ref/commit-convention.md) |
| 테스트 전략 | [`docs/ref/testing-patterns.md`](docs/ref/testing-patterns.md) |
| 검증 전략 | [`docs/ref/verification-protocol.md`](docs/ref/verification-protocol.md) |
| PRD / 설계 문서 | [`docs/ref/PRD-template.md`](docs/ref/PRD-template.md) |
| Spec-driven 개발 | [`docs/ref/spec-driven-workflow.md`](docs/ref/spec-driven-workflow.md) |

---

## 컨텍스트 재시작 시 ("다음 작업 하자")

1. `docs/ref/session-state.md` 읽기 (git 상태)
2. `docs/exec-plans/active/` 읽기 (진행 중 작업 목록)
3. `[🔄]` 항목부터 이어서 진행

---

## 알림

- 1차: PC 토스트 알림 (`global-setup/` 설치 시 자동 동작)
- 세션 종료 시 git 상태 자동 저장 → `docs/ref/session-state.md`

---

## 프로젝트 구조

```
[프로젝트명]/
├── CLAUDE.md                  # 이 파일 (지침 지도)
├── TODO.md                    # 작업 목록
├── .claude/
│   ├── settings.json          # 권한 + 훅 등록
│   ├── hooks/                 # 보안·감사·세션 훅
│   ├── commands/              # 슬래시 스킬
│   └── skills/                # 하네스 내부 실행 스크립트 (score.py, analyze_sessions.py 등)
├── .claude-plugin/            # 마켓플레이스 플러그인 메타데이터
├── skills/                    # 마켓플레이스 배포용 — 다른 프로젝트가 설치 가능한 SKILL.md
├── agents/                    # 병렬 에이전트
├── docs/
│   ├── ref/                   # 참조 문서 (필요할 때만 로드)
│   ├── design-docs/           # 설계 문서
│   ├── exec-plans/            # 실행 계획 (active/completed)
│   └── product-specs/         # PRD / 기획 문서
├── src/
├── tests/
├── logs/                      # gitignore 대상
└── .env                       # gitignore 대상
```
