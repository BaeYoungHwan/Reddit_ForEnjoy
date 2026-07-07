# Claude Code 하네스 템플릿

> Claude Code를 프로덕션 수준으로 바로 쓸 수 있는 범용 템플릿.
> 보안 훅, 자동화 스킬, 에이전트, 테스트 인프라, 문서 구조가 사전 구성되어 있습니다.

---

## 요구사항

- **Bash 4+** — Linux/macOS 기본 제공. Windows는 [Git Bash](https://git-scm.com/downloads) 또는 WSL2 권장.
- **Python 3.8+** — 훅 JSON 파싱 및 분석 스크립트용 (없으면 훅이 빈 값으로 폴백)
- **git** — 버전 관리
- **gh CLI** — PR 자동화 (`/PR` 스킬 사용 시)

> Windows PowerShell 단독 환경은 현재 미지원입니다. Git Bash 또는 WSL2에서 실행하세요.

---

## 무엇이 포함되나

### 보안 & 감사 훅 (`.claude/hooks/`)

| 훅 | 동작 시점 | 역할 |
|----|-----------|------|
| `pre-bash-guard.sh` | Bash 실행 전 | `rm -rf`, `--no-verify`, `curl\|sh`, 자격증명 패턴 차단 |
| `post-bash-audit.sh` | Bash 실행 후 | 모든 명령을 `logs/claude-audit.log`에 기록 |
| `tdd-enforcer.sh` | Write/Edit 전 | 구현 파일 생성 시 테스트 파일 존재 여부 강제 확인 |
| `architecture-guard.sh` | Write/Edit 후 | 레이어 의존성 위반 감지 (경고) |
| `circuit-breaker.sh` | Bash 실행 후 | 동일 에러 3회 반복 시 자동 중단 |
| `lint-test-build.sh` | Write/Edit 후 | lint / test / build 결과 자동 검증 |
| `sub-agent-review.sh` | 에이전트 결과 수신 후 | 서브에이전트 출력 품질 검토 |
| `session-replay.sh` | Bash/Write/Edit 실행 후 | tool call 이벤트를 JSONL로 기록 (성능 분석) |
| `session-persist.sh` | 세션 종료 시 | git 상태를 `docs/ref/session-state.md`에 저장 |

### 슬래시 스킬 (`.claude/commands/`)

| 스킬 | 역할 |
|------|------|
| `/init-project` | 프로젝트 정보 양식 → CLAUDE.md 완성 + PRD 초안 |
| `/commit` | 한국어 커밋 컨벤션 + Trailers 패턴 |
| `/PR` | GitHub PR 자동 생성 (브랜치 비교 → 제목/본문 작성 → 제출) |
| `/tdd` | Red → Green → Refactor 사이클 (pass^3) |
| `/deep-interview` | 소크라테스식 질문으로 스펙 구체화 |
| `/ralph` | plan → exec → verify → fix 완료 보장 루프 |
| `/ultrawork` | 독립 작업 병렬화 (에이전트 서브태스크) |
| `/close-project` | 프로젝트 종료 체크리스트 (문서 정리, 아카이브) |
| `/ai-readiness-cartography` | AI-readiness 점수 + HTML 대시보드 시각화 |
| `/improve-token-efficiency` | Claude Code 세션 JSONL 분석 → 토큰 효율 리포트 |
| `/update-config` | `settings.json` 훅·권한 구성 자동화 |
| `/simplify` | 변경 코드 재사용·품질·효율 검토 후 개선 |
| `/security-review` | 현재 브랜치 변경사항 보안 리뷰 |
| `/review` | PR 코드 리뷰 |

### 에이전트 (`agents/`)

| 에이전트 | 역할 |
|----------|------|
| `code-reviewer.md` | 코드 품질 리뷰 (Sonnet) |
| `doc-gardener.md` | 문서-코드 불일치 감지 (Haiku) |
| `security-reviewer.md` | 보안 취약점 정적 분석 (Opus) |
| `step-validator.md` | Plan 모드 단계별 결과 검증 |
| `_templates/` | 도메인 에이전트 템플릿 (auth, order, payment 예시 포함) |

### 마켓플레이스 스킬 (`skills/`)

다른 프로젝트에 설치 가능한 독립 스킬 패키지:

| 스킬 | 역할 |
|------|------|
| `karpathy-guidelines/` | Karpathy 코딩 원칙을 기반으로 한 코드 리뷰 가이드라인 |

### 문서 구조 (`docs/`)

```
docs/
├── ref/              # 필요할 때만 로드하는 참조 문서
│   ├── session-state.md       # 세션 재시작 기준점 (자동 갱신)
│   ├── todo-workflow.md       # [ ]→[🔄]→[x] 워크플로우
│   ├── commit-convention.md   # 한국어 커밋 + Trailers
│   ├── testing-patterns.md    # pass@k / pass^k
│   ├── agent-model-routing.md # Haiku/Sonnet/Opus 라우팅
│   ├── project-setup.md       # 새 프로젝트 시작 가이드
│   ├── hooks-overview.md      # 훅 동작 원리 및 커스터마이징
│   ├── plan-mode-workflow.md  # Plan 모드 실행 흐름
│   ├── tdd-guide.md           # TDD 사이클 가이드
│   ├── verification-protocol.md
│   ├── PRD-template.md
│   ├── architecture-template.md
│   ├── ADR-template.md
│   └── spec-driven-workflow.md
├── design-docs/      # 설계 문서 (core-beliefs, golden-principles 등)
├── exec-plans/       # 실행 계획 (active/ / completed/)
└── product-specs/    # PRD / 기획 문서
```

### 자동화 도구

- `.claude/skills/executor.py` — exec-plans의 `[ ]` 항목을 `claude -p` 헤드리스 모드로 순차 실행

### 테스트 인프라 (`tests/`)

훅 전체를 자동 검증하는 셸 테스트 스위트:

```bash
bash tests/run-all.sh
```

개별 훅 테스트도 독립 실행 가능 (`tests/hooks/test_*.sh`).

---

## 빠른 시작

### 1단계 — 템플릿으로 새 레포 생성

GitHub **"Use this template"** 버튼 클릭 → 새 레포 생성

또는 gh CLI:
```bash
gh repo create my-project --template <owner>/claude-code-template --private --clone
cd my-project
```

### 2단계 — 전역 설정 설치 (최초 1회)

원라이너 설치 (상태바 + Windows 토스트 알림):

```bash
bash global-setup/install.sh
```

또는 수동 설치:

```bash
mkdir -p ~/.claude/hooks

cp global-setup/settings.json ~/.claude/settings.json
cp global-setup/hooks/context-bar.sh ~/.claude/hooks/
cp global-setup/hooks/notify.ps1 ~/.claude/hooks/
cp global-setup/hooks/session_start.ps1 ~/.claude/hooks/

# Mac/Linux
chmod +x ~/.claude/hooks/context-bar.sh
```

> `~/.claude/settings.json`이 이미 있다면 기존 내용 백업 후 병합하세요.

### 3단계 — 프로젝트 초기화

Claude Code를 열고 실행:
```
/init-project
```

양식을 작성하면 Claude가 `CLAUDE.md` 플레이스홀더를 완성하고 PRD 초안을 생성합니다.

---

## 상태바 (context-bar)

```
claude-sonnet-4-6 | 📁 my-project | 🔀 main (0 uncommitted) | ████░░░░░░ ~12%
💬 마지막 메시지...
```

색상 변경: `global-setup/hooks/context-bar.sh` 상단의 `COLOR` 값 수정
`orange | blue | teal | green | lavender | rose | gold | slate | cyan`

---

## Windows 토스트 알림

작업 완료 시 알림 + 효과음. 세션 3분 이상일 때만 발동 (짧은 작업 노이즈 방지).

> Mac/Linux: `global-setup/settings.json`의 훅 커맨드를 OS에 맞게 수정

---

## executor.py 사용법

exec-plans의 마크다운에 `- [ ] 작업설명` 형식으로 작업을 나열하면 자동 순차 실행:

```bash
python .claude/skills/executor.py --plan docs/exec-plans/active/phase-1.md
python .claude/skills/executor.py --plan docs/exec-plans/active/phase-1.md --dry-run
python .claude/skills/executor.py --plan docs/exec-plans/active/phase-1.md --retry-failed
```
