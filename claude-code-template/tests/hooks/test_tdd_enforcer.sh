#!/usr/bin/env bash
# test_tdd_enforcer.sh — tdd-enforcer.sh 단위 테스트
# tdd-enforcer.sh는 file_path 필드를 사용하는 Write/Edit 훅
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

echo "=== tdd-enforcer.sh 테스트 ==="

# 1. src/utils.py 신규 파일 (테스트 없음) → exit 1 (차단)
# 실제 파일이 존재하지 않아야 신규 파일로 처리됨
result=$(run_hook "tdd-enforcer.sh" '{"tool_name":"Write","tool_input":{"file_path":"src/utils.py"}}')
assert "1" "$result" "src/utils.py 신규 파일, 테스트 없음 → 차단"

# 2. README.md 수정 → exit 0 (문서 제외)
result=$(run_hook "tdd-enforcer.sh" '{"tool_name":"Write","tool_input":{"file_path":"README.md"}}')
assert "0" "$result" "README.md → 허용 (문서 제외)"

# 3. .claude/hooks/test.sh 수정 → exit 0 (훅 경로 제외)
result=$(run_hook "tdd-enforcer.sh" '{"tool_name":"Write","tool_input":{"file_path":".claude/hooks/test.sh"}}')
assert "0" "$result" ".claude/hooks/test.sh → 허용 (훅 경로 제외)"

# 4. 설정 파일 → exit 0 (json 제외)
result=$(run_hook "tdd-enforcer.sh" '{"tool_name":"Write","tool_input":{"file_path":"config.json"}}')
assert "0" "$result" "config.json → 허용 (설정 파일 제외)"

# 5. 빈 file_path → exit 0
result=$(run_hook "tdd-enforcer.sh" '{"tool_name":"Write","tool_input":{"file_path":""}}')
assert "0" "$result" "빈 file_path → 허용"

echo ""
echo "  결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
