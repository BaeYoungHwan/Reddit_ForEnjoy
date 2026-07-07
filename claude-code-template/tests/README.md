# 훅 단위 테스트

`.claude/hooks/` 디렉토리의 훅 스크립트를 검증하는 단위 테스트 모음입니다.

## 빠른 시작

```bash
# 전체 테스트 실행
bash tests/run-all.sh

# 개별 테스트 실행
bash tests/hooks/test_pre_bash_guard.sh
```

## 구조

```
tests/
├── README.md              # 이 파일
├── run-all.sh             # 전체 테스트 실행 스크립트
├── fixtures/              # 공통 테스트 입력 데이터 (JSON)
│   ├── tool-input-bash.json
│   ├── tool-input-write.json
│   ├── tool-response-success.json
│   └── tool-response-error.json
└── hooks/                 # 훅별 테스트 파일
    ├── test_pre_bash_guard.sh
    ├── test_tdd_enforcer.sh
    ├── test_architecture_guard.sh
    ├── test_post_bash_audit.sh
    ├── test_circuit_breaker.sh
    ├── test_session_replay.sh
    └── test_parse_json.sh
```

## 테스트 파일 설명

| 파일 | 대상 훅 | 검증 내용 |
|------|---------|-----------|
| `test_pre_bash_guard.sh` | `pre-bash-guard.sh` | rm -rf, --force push, curl\|sh, eval() 차단; 일반 명령 허용 |
| `test_tdd_enforcer.sh` | `tdd-enforcer.sh` | 신규 구현 파일에 테스트 없으면 차단; 문서·훅 경로 허용 |
| `test_architecture_guard.sh` | `architecture-guard.sh` | 레이어 경계 위반 경고(비strict 모드); 비소스 파일 허용 |
| `test_post_bash_audit.sh` | `post-bash-audit.sh` | 모든 명령 exit 0; 감사 로그 파일 생성 확인 |
| `test_circuit_breaker.sh` | `circuit-breaker.sh` | 에러 1회 허용, 동일 에러 3회 반복 시 차단 |
| `test_session_replay.sh` | `session-replay.sh` | exit 0; agent-replay.jsonl 기록 확인 |
| `test_parse_json.sh` | `lib/parse-json.sh` | tool_input/tool_response 필드 추출, 없는 필드 빈 문자열 |

## 공통 패턴

모든 테스트는 다음 패턴을 따릅니다:

```bash
run_hook() {
  local hook="$1" input="$2"
  echo "$input" | bash ".claude/hooks/$hook" > /dev/null 2>&1
  echo $?
}
```

- 훅에 JSON을 stdin으로 전달하고 exit code를 확인합니다.
- `assert` 함수로 expected/actual을 비교하며 PASS/FAIL을 집계합니다.
- 각 테스트는 독립 실행 가능하며, 다른 테스트 결과에 의존하지 않습니다.

## 주의사항

- `circuit-breaker.sh` 테스트는 `logs/.cb-error-history` 파일을 읽고 씁니다.
  테스트 전후 자동 초기화하므로 실행 순서에 영향 없습니다.
- `architecture-guard.sh` 테스트는 임시 파일(`mktemp -d`)을 생성하며 종료 시 자동 삭제합니다.
- `logs/` 디렉토리가 없으면 각 테스트에서 `mkdir -p logs`로 자동 생성합니다.

## CI

GitHub Actions에서 push/PR 시 자동 실행됩니다. → `.github/workflows/hooks-test.yml`
