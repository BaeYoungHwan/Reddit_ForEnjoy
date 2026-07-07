#!/usr/bin/env bash
# test_post_bash_audit.sh — post-bash-audit.sh 단위 테스트
# post-bash-audit.sh는 PostToolUse(Bash) 훅 — 감사 로그 기록 전용
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

echo "=== post-bash-audit.sh 테스트 ==="

# logs/ 디렉토리 확보
mkdir -p logs

# 1. 일반 명령 → exit 0 (차단 없음, 로그에 기록)
result=$(run_hook "post-bash-audit.sh" '{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"output":"file.txt"}}')
assert "0" "$result" "일반 명령 ls → exit 0"

# 2. 빈 command → exit 0 (빈 명령은 로그 기록 건너뜀)
result=$(run_hook "post-bash-audit.sh" '{"tool_name":"Bash","tool_input":{"command":""},"tool_response":{"output":""}}')
assert "0" "$result" "빈 command → exit 0"

# 3. 에러 응답이 있어도 → exit 0 (audit 훅은 항상 통과)
result=$(run_hook "post-bash-audit.sh" '{"tool_name":"Bash","tool_input":{"command":"ls /nonexistent"},"tool_response":{"error":"No such file"}}')
assert "0" "$result" "에러 응답 포함 명령 → exit 0"

# 4. 로그 파일 생성 확인
run_hook "post-bash-audit.sh" '{"tool_name":"Bash","tool_input":{"command":"echo audit_test_marker"},"tool_response":{"output":""}}' > /dev/null 2>&1
if [ -f "logs/claude-audit.log" ]; then
  PASS=$((PASS+1)); echo "  PASS logs/claude-audit.log 파일 생성 확인"
else
  FAIL=$((FAIL+1)); echo "  FAIL logs/claude-audit.log 파일이 생성되지 않음"
fi

echo ""
echo "  결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
