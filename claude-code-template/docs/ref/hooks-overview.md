# 훅 전체 현황

> `.claude/hooks/` 아래 9개 훅의 단계·역할·등록 상태를 한눈에 확인합니다.

---

## 훅 실행 매트릭스

| 훅 파일 | 단계 | matcher | sync/async | 기본 등록 | 차단 조건 |
|--------|------|---------|-----------|----------|---------|
| `pre-bash-guard.sh` | PreToolUse | Bash | sync | ✅ | 위험 패턴 10종 (--no-verify, 자격증명, curl\|sh, git push --force, rm -rf, SELECT \* FROM, DROP, TRUNCATE, chmod 777, eval) |
| `tdd-enforcer.sh` | PreToolUse | Write\|Edit | sync | ✅ | 신규 파일 테스트 없음 / strict 모드에서는 기존 파일도 체크 |
| `post-bash-audit.sh` | PostToolUse | Bash | async | ✅ | 차단 없음 — `logs/claude-audit.log`에 기록만 |
| `circuit-breaker.sh` | PostToolUse | Bash | async | ✅ | 동일 에러 3회 반복 시 작업 중단 |
| `session-replay.sh` | PostToolUse | Bash\|Write\|Edit | async | ✅ | 차단 없음 — `logs/agent-replay.jsonl`에 기록만 |
| `architecture-guard.sh` | PostToolUse | Write\|Edit | async (strict 모드에서 sync) | ✅ | 레이어 위반 + `.claude/hooks-strict.flag` 존재 시 차단 |
| `session-persist.sh` | Stop | — | async | ✅ | 차단 없음 — git 상태를 `docs/ref/session-state.md`에 저장 |
| `lint-test-build.sh` | PreToolUse | Bash | sync | ❌ (init-project에서 등록) | lint/test/build 실패 시 commit 차단 |
| `sub-agent-review.sh` | PreToolUse | Bash | sync | ❌ (init-project에서 등록) | Sub-Agent가 보안/성능 ISSUE 보고 시 PR 생성 차단 |

---

## 기본 비활성 훅 활성화 방법

아래 두 훅은 기본으로 `settings.json`에 등록되지 않습니다. `/init-project` 인터뷰에서 선택해야 활성화됩니다.

| 훅 | 활성화 조건 |
|----|------------|
| `lint-test-build.sh` | `/init-project` SCALE 2 (스타트업) — H-1 항목 활성 선택 / SCALE 3 (회사) 자동 활성 |
| `sub-agent-review.sh` | `/init-project` SCALE 2 — H-2 항목 활성 선택 / SCALE 3 자동 활성 |

수동 활성화 시 `.claude/settings.json`의 `hooks.PreToolUse` 배열에 추가:
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

---

## 엄격 모드 플래그

`.claude/hooks-strict.flag` 파일이 존재하면 두 훅의 동작이 변경됩니다:

| 훅 | 일반 모드 | 엄격 모드 |
|----|---------|---------|
| `architecture-guard.sh` | 레이어 위반 시 경고 출력, 저장 허용 | 레이어 위반 시 저장 차단 (async → sync 변경 필요) |
| `tdd-enforcer.sh` | 신규 파일 생성 시만 테스트 확인 | 기존 파일 수정 시에도 테스트 확인 |

엄격 모드 활성화: `touch .claude/hooks-strict.flag`
엄격 모드 비활성화: `rm .claude/hooks-strict.flag`

> ⚠️ `architecture-guard.sh`는 엄격 모드 활성화 시 `settings.json`에서 `"async": true`를 제거해야 실제로 차단이 동작합니다.
> 자세한 내용: `docs/ref/architecture-guide.md`

---

## 로그 파일 위치

| 훅 | 로그 파일 |
|----|---------|
| `post-bash-audit.sh` | `logs/claude-audit.log` (5세대 로테이션, 5MB 초과 시) |
| `circuit-breaker.sh` | `logs/circuit-breaker.log` (차단 이벤트 영구 기록) / `logs/.cb-error-history` (에러 추적 임시 파일, 성공 시 초기화) |
| `session-replay.sh` | `logs/agent-replay.jsonl` (5세대 로테이션) |
| `session-persist.sh` | `docs/ref/session-state.md` |

`logs/` 디렉토리는 `.gitignore` 대상입니다.
