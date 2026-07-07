#!/usr/bin/env bash
# test_circuit_breaker.sh — circuit-breaker.sh 단위 테스트
# circuit-breaker.sh는 PostToolUse(Bash) 훅
# exit_code 필드와 tool_response.stderr 필드를 기반으로 동작
PASS=0; FAIL=0
cd "$(dirname "$0")/../.."

assert() {
  local expected="$1" actual="$2" name="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1)); echo "  PASS $name"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name (expected=$expected, got=$actual)"
  fi
}

run_hook() {
  local hook="$1" input="$2"
  echo "$input" | bash ".claude/hooks/$hook" > /dev/null 2>&1
  echo $?
}

echo "=== circuit-breaker.sh 테스트 ==="

# logs/ 디렉토리 확보, 에러 히스토리 초기화
mkdir -p logs
CB_ERROR_HISTORY="logs/.cb-error-history"

# --- 케이스 1: 에러 없는 경우 → exit 0 ---
rm -f "$CB_ERROR_HISTORY"
result=$(run_hook "circuit-breaker.sh" '{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"exit_code":0,"stderr":""}}')
assert "0" "$result" "exit_code=0, 에러 없음 → exit 0"

# --- 케이스 2: 에러 1회 → exit 0 (차단 안 함) ---
rm -f "$CB_ERROR_HISTORY"
result=$(run_hook "circuit-breaker.sh" '{"tool_name":"Bash","tool_input":{"command":"ls /bad"},"tool_response":{"exit_code":1,"stderr":"No such file or directory"}}')
assert "0" "$result" "동일 에러 1회 → exit 0"

# --- 케이스 3: 같은 에러 3회 반복 → 마지막에 exit 1 ---
rm -f "$CB_ERROR_HISTORY"
ERROR_INPUT='{"tool_name":"Bash","tool_input":{"command":"ls /missing"},"tool_response":{"exit_code":1,"stderr":"ls: /missing: No such file or directory"}}'

# 1회
run_hook "circuit-breaker.sh" "$ERROR_INPUT" > /dev/null 2>&1
# 2회
run_hook "circuit-breaker.sh" "$ERROR_INPUT" > /dev/null 2>&1
# 3회 — MAX_REPEATS(3) 도달, 차단 기대
result=$(run_hook "circuit-breaker.sh" "$ERROR_INPUT")
assert "1" "$result" "동일 에러 3회 반복 → exit 1 (차단)"

# 정리
rm -f "$CB_ERROR_HISTORY"

echo ""
echo "  결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
