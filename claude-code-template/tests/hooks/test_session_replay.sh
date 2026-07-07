#!/usr/bin/env bash
# test_session_replay.sh — session-replay.sh 단위 테스트
# session-replay.sh는 PostToolUse 훅 — JSONL 형식으로 이벤트 기록
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

echo "=== session-replay.sh 테스트 ==="

# logs/ 디렉토리 확보
mkdir -p logs
REPLAY_LOG="logs/agent-replay.jsonl"

# 테스트 전 기존 로그의 줄 수 기록
BEFORE_COUNT=0
[ -f "$REPLAY_LOG" ] && BEFORE_COUNT=$(wc -l < "$REPLAY_LOG")

# 1. 일반 실행 → exit 0
result=$(run_hook "session-replay.sh" '{"tool_name":"Bash","tool_input":{"command":"ls"},"tool_response":{"exit_code":0,"output":"file.txt"}}')
assert "0" "$result" "일반 실행 → exit 0"

# 2. logs/agent-replay.jsonl에 기록됨 확인
if [ -f "$REPLAY_LOG" ]; then
  AFTER_COUNT=$(wc -l < "$REPLAY_LOG")
  if [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
    PASS=$((PASS+1)); echo "  PASS logs/agent-replay.jsonl에 새 항목 기록됨"
  else
    FAIL=$((FAIL+1)); echo "  FAIL logs/agent-replay.jsonl에 기록 안 됨 (before=$BEFORE_COUNT, after=$AFTER_COUNT)"
  fi
else
  FAIL=$((FAIL+1)); echo "  FAIL logs/agent-replay.jsonl 파일이 생성되지 않음"
fi

# 3. Write 툴 이벤트도 기록 → exit 0
result=$(run_hook "session-replay.sh" '{"tool_name":"Write","tool_input":{"file_path":"src/test.py"},"tool_response":{"exit_code":0}}')
assert "0" "$result" "Write 툴 이벤트 → exit 0"

echo ""
echo "  결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
