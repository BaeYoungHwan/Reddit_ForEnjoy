#!/usr/bin/env bash
# session-persist.sh — 세션 종료 시 git 상태를 docs/ref/session-state.md에 저장
# Stop 훅: 대화 맥락은 Auto Memory가 담당 → git 상태만 저장

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="$REPO_DIR/docs/ref/session-state.md"

# docs/ref/ 디렉토리 생성 (없으면)
mkdir -p "$(dirname "$OUTPUT")"

cd "$REPO_DIR" || exit 0

# git 상태 수집
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "N/A")
LAST_COMMIT=$(git log -1 --pretty=format:"%h %s" 2>/dev/null || echo "N/A")
UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

cat > "$OUTPUT" << EOF
# 세션 상태 (마지막 업데이트: $TIMESTAMP)

> Auto Memory가 대화 맥락을 담당합니다. 이 파일은 git 상태만 기록합니다.
> "다음 작업 하자" → \`docs/exec-plans/active/\` 확인 후 \`[🔄]\` 항목부터 재개

## Git 상태

| 항목 | 값 |
|------|----|
| 브랜치 | \`$BRANCH\` |
| 마지막 커밋 | \`$LAST_COMMIT\` |
| 미커밋 파일 수 | $UNCOMMITTED |

## 재시작 절차

1. 이 파일 읽기 (git 상태 파악)
2. \`docs/exec-plans/active/\` 읽기 (현재 작업 목록 + 진행 상태)
3. \`[🔄]\` 항목부터 이어서 진행
EOF

exit 0
