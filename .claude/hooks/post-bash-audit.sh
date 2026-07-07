#!/usr/bin/env bash
# post-bash-audit.sh — 실행된 Bash 명령을 감사 로그에 기록
# PostToolUse(Bash) 훅: async 실행 (비동기, 실패해도 무시)

source "$(dirname "$0")/lib/parse-json.sh"

LOG_DIR="$(cd "$(dirname "$0")/../.." && pwd)/logs"
LOG_FILE="$LOG_DIR/claude-audit.log"

INPUT=$(cat)
COMMAND=$(get_tool_input_field "$INPUT" "command")

# 빈 명령이면 건너뜀
[ -z "$COMMAND" ] && exit 0

# logs/ 디렉토리 생성 (없으면)
mkdir -p "$LOG_DIR"

# 로그 로테이션: 5MB 초과 시 최대 5세대 회전
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 5242880 ]; then
  rm -f "${LOG_FILE}.5"
  for i in 4 3 2 1; do
    [ -f "${LOG_FILE}.${i}" ] && mv "${LOG_FILE}.${i}" "${LOG_FILE}.$((i+1))"
  done
  mv "$LOG_FILE" "${LOG_FILE}.1"
fi

# 타임스탬프 + 명령어 기록
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] $COMMAND" >> "$LOG_FILE"

exit 0
