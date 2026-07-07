#!/usr/bin/env bash
# test_parse_json.sh — lib/parse-json.sh 단위 테스트
# parse-json.sh는 source로 로드하여 사용하는 공통 JSON 파싱 라이브러리
PASS=0; FAIL=0
cd "$(dirname "$0")/../.."

assert() {
  local expected="$1" actual="$2" name="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1)); echo "  PASS $name"
  else
    FAIL=$((FAIL+1)); echo "  FAIL $name (expected='$expected', got='$actual')"
  fi
}

echo "=== lib/parse-json.sh 테스트 ==="

# parse-json.sh를 source로 로드
source ".claude/hooks/lib/parse-json.sh"

# 1. 정상 JSON에서 command 필드 추출
INPUT='{"tool_name":"Bash","tool_input":{"command":"ls"}}'
result=$(get_tool_input_field "$INPUT" "command")
assert "ls" "$result" "정상 JSON에서 command 필드 추출"

# 2. 없는 필드는 빈 문자열 반환
INPUT='{"tool_name":"Bash","tool_input":{}}'
result=$(get_tool_input_field "$INPUT" "nonexistent")
assert "" "$result" "없는 필드는 빈 문자열 반환"

# 3. file_path 필드 추출
INPUT='{"tool_name":"Write","tool_input":{"file_path":"src/utils.py","content":"def hello(): pass"}}'
result=$(get_tool_input_field "$INPUT" "file_path")
assert "src/utils.py" "$result" "file_path 필드 추출"

# 4. tool_response에서 exit_code 추출
INPUT='{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"exit_code":0,"output":"file.txt"}}'
result=$(get_response_field "$INPUT" "exit_code")
assert "0" "$result" "tool_response.exit_code 추출"

# 5. tool_response에서 없는 필드 → 빈 문자열
INPUT='{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{}}'
result=$(get_response_field "$INPUT" "stderr")
assert "" "$result" "tool_response 없는 필드 → 빈 문자열"

# 6. 중첩 JSON 값 (공백 포함 command)
INPUT='{"tool_name":"Bash","tool_input":{"command":"git status"}}'
result=$(get_tool_input_field "$INPUT" "command")
assert "git status" "$result" "공백 포함 command 필드 추출"

echo ""
echo "  결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
