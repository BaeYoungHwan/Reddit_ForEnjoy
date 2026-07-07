#!/usr/bin/env bash
# session-replay.sh — tool call 이벤트를 JSONL로 기록 (성능 분석용)
# PostToolUse 훅: audit.sh(보안)와 역할 분리
# audit.sh → 보안/감사 목적, replay.sh → 에이전트 성능 분석 목적

source "$(dirname "$0")/lib/parse-json.sh"

LOG_DIR="$(cd "$(dirname "$0")/../.." && pwd)/logs"
REPLAY_LOG="$LOG_DIR/agent-replay.jsonl"

mkdir -p "$LOG_DIR"

# 로그 로테이션: 5MB 초과 시 최대 5세대 회전
if [ -f "$REPLAY_LOG" ] && [ "$(wc -c < "$REPLAY_LOG")" -gt 5242880 ]; then
  rm -f "${REPLAY_LOG}.5"
  for i in 4 3 2 1; do
    [ -f "${REPLAY_LOG}.${i}" ] && mv "${REPLAY_LOG}.${i}" "${REPLAY_LOG}.$((i+1))"
  done
  mv "$REPLAY_LOG" "${REPLAY_LOG}.1"
fi

INPUT=$(cat)
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# 이벤트 파싱 후 JSONL 기록
echo "$INPUT" | "$PYTHON_CMD" -c "
import sys, json
try:
    data = json.load(sys.stdin)
    tool_name = data.get('tool_name', 'unknown')
    tool_input = data.get('tool_input', {})
    tool_response = data.get('tool_response', {})
    exit_code = tool_response.get('exit_code', None)

    # 민감정보 마스킹 (자격증명 패턴)
    import re
    def mask(s):
        if not isinstance(s, str):
            return s
        return re.sub(r'(password|api_key|secret|token)\s*=\s*\S+', r'\1=***', s, flags=re.IGNORECASE)

    record = {
        'timestamp': '$TIMESTAMP',
        'tool': tool_name,
        'exit_code': exit_code,
        'input_summary': mask(str(tool_input)[:200]),
    }
    print(json.dumps(record, ensure_ascii=False))
except Exception as e:
    pass
" >> "$REPLAY_LOG" 2>/dev/null

exit 0
