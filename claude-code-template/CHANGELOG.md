# Changelog

형식: [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)
버전 관리: [Semantic Versioning](https://semver.org/lang/ko/)

---

## [미출시]

### 추가 예정
- Phase 2 진행 중

---

## [0.3.0] — 2026-05-16

### 추가
- `tests/hooks/` 단위 테스트 7종 + GitHub Actions CI (`hooks-test.yml`)
- `docs/ref/hooks-overview.md` — 훅 9개 전체 현황 표
- `agents/LANES.md` Verification Lane 신설, `step-validator` 이동
- `agents/_templates/` 도메인 에이전트 샘플 3종 (auth, payment, order)
- `step-validator.md` 출력 JSON 스키마 정형화

### 수정
- `lib/parse-json.sh`: Python 부재 stub 함수, 정수 0 처리 버그 수정
- `post-bash-audit.sh` / `session-replay.sh`: 5세대 로그 로테이션
- `circuit-breaker.sh`: 에러 정규화 함수 추가
- `README.md`: 요구사항 섹션 추가

---

## [0.2.1] — 2026-05-16

### 수정 (PR #1 코드 리뷰 후속)
- `step-validator.md`: 모델 표기 `claude-sonnet-4-6` → `sonnet` 통일
- `lint-test-build.sh` / `step-validator.md`: `cargo clippy -- -D warnings` 완화
- `pre-bash-guard.sh`: rm 분리 플래그 grep 옵션 `-qE` → `-iqE` 통일
- `close-project.md`: Step 7 Python 치환 검증 게이트 추가
- `init-project.md`: security-reviewer 활성화 메시지 명확화
- `domain-agent.tpl.md`: 다중 줄 플레이스홀더 치환 규칙 추가

---

## [0.2.0] — 2026-05-16

### 추가 (PR #1 — P0/P1 하네스 고도화)
- `/init-project` 전면 고도화: Step 0 기존설치 감지, 브랜치 전략, CONTRIBUTING.md, 보안/도메인/이메일 에이전트 설정, AI-Readiness 주기 측정
- `/close-project` 신규: 11단계 종료 흐름
- `/PR` 신규: staged → commit → push → gh pr create 자동화
- `agents/security-reviewer.md`, `step-validator.md`, `_templates/domain-agent.tpl.md` 신규
- `docs/ref/tdd-guide.md`, `architecture-guide.md`, `quality-guide.md` 신규
- `tdd-enforcer.sh`: Java/Ruby/PHP 지원, EXPECTED_PATHS 출력
- `pre-bash-guard.sh`: DROP/TRUNCATE/chmod 777/eval()/SELECT * FROM 패턴 추가 (deny-patterns.json 전체 마이그레이션)
- `deny-list-guard.sh` + `deny-patterns.json` 폐지 → `pre-bash-guard.sh` 통합

### 수정
- `architecture-guard.sh`: 참조 문서 경로 갱신

---

## [0.1.0] — 최초 출시

### 추가
- Claude Code 하네스 기본 구조: hooks, agents, commands, skills
- 훅 7종: pre-bash-guard, tdd-enforcer, architecture-guard, post-bash-audit, circuit-breaker, session-replay, session-persist
- 에이전트 2종: code-reviewer, doc-gardener
- 커맨드: commit, tdd, ralph, ultrawork, deep-interview, ai-readiness-cartography, improve-token-efficiency
- `lib/parse-json.sh` 공통 JSON 파싱 유틸리티
