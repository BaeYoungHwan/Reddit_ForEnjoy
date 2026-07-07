#!/usr/bin/env bash
# circuit-breaker.sh — 동일 에러 반복 시 작업 중단
# PostToolUse(Bash) 훅: audit과 역할 분리 (audit=보안, circuit-breaker=무한루프 방지)

source "$(dirname "$0")/lib/parse-json.sh"

LOG_DIR="$(cd "$(dirname "$0")/../.." && pwd)/logs"
CB_LOG="$LOG_DIR/circuit-breaker.log"
ERROR_HISTORY="$LOG_DIR/.cb-error-history"
MAX_REPEATS=3

mkdir -p "$LOG_DIR"

INPUT=$(cat)
EXIT_CODE=$(get_response_field "$INPUT" "exit_code")
EXIT_CODE="${EXIT_CODE:-0}"

# 성공이면 에러 히스토리 초기화 후 종료
if [ "$EXIT_CODE" = "0" ]; then
  rm -f "$ERROR_HISTORY"
  exit 0
fi

# 에러 메시지 정규화 (타임스탬프, PID, 임시 경로 제거)
normalize_error() {
  echo "$1" \
    | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:]+Z?//g' \
    | sed -E 's/\b[0-9]{5,}\b/<pid>/g' \
    | sed -E 's|/tmp/[^ ]+|/tmp/<x>|g' \
    | tr -s ' '
}

# 에러 출력 추출 (stderr, 첫 3줄만)
ERROR_OUTPUT=$(echo "$INPUT" | "$PYTHON_CMD" -c "
import sys, json
try:
    data = json.load(sys.stdin)
    stderr = data.get('tool_response', {}).get('stderr', '')
    lines = stderr.strip().split('\n')[:3]
    print(' | '.join(lines))
except:
    print('')
" 2>/dev/null)

[ -z "$ERROR_OUTPUT" ] && exit 0

# 에러 정규화 후 히스토리에 추가
ERROR_OUTPUT=$(normalize_error "$ERROR_OUTPUT")
echo "$ERROR_OUTPUT" >> "$ERROR_HISTORY"

# 동일 에러 반복 횟수 계산
REPEAT_COUNT=$(sort "$ERROR_HISTORY" 2>/dev/null | uniq -c | sort -rn | head -1 | awk '{print $1}')

if [ "${REPEAT_COUNT:-0}" -ge "$MAX_REPEATS" ]; then
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$TIMESTAMP] 동일 에러 ${REPEAT_COUNT}회 반복 감지. 작업 중단." >> "$CB_LOG"
  echo "에러 패턴: $ERROR_OUTPUT" >> "$CB_LOG"
  echo "---" >> "$CB_LOG"

  echo "🔴 [Circuit Breaker] 동일 에러가 ${REPEAT_COUNT}회 반복되었습니다." >&2
  echo "   에러: $ERROR_OUTPUT" >&2
  echo "   자동 중단. 접근법을 바꾸거나 사용자에게 확인하세요." >&2
  echo "   로그: $CB_LOG" >&2

  # 에러 히스토리 초기화 (다음 시도를 위해)
  rm -f "$ERROR_HISTORY"

  exit 1
fi

exit 0
