#!/usr/bin/env bash
# sub-agent-review.sh — PR 생성 직전 Sub-Agent diff 리뷰
# PreToolUse(Bash) 훅: gh pr create 명령 감지 시 Claude CLI로 diff 리뷰

source "$(dirname "$0")/lib/parse-json.sh"

INPUT=$(cat)
COMMAND=$(get_tool_input_field "$INPUT" "command")

# gh pr create 명령이 아니면 통과
echo "$COMMAND" | grep -q "gh pr create" || exit 0

# claude CLI 없으면 경고 후 통과
CLAUDE_CMD=$(command -v claude)
if [ -z "$CLAUDE_CMD" ]; then
  echo "⚠️  [Sub-Agent Review] claude CLI를 찾을 수 없어 리뷰를 건너뜁니다." >&2
  exit 0
fi

echo "🤖 [Sub-Agent Review] PR diff 리뷰 중..." >&2

# main 브랜치 기준 diff 수집 (main 없으면 master 시도)
BASE_BRANCH="main"
git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1 || BASE_BRANCH="master"
MERGE_BASE=$(git merge-base HEAD "$BASE_BRANCH" 2>/dev/null)

if [ -z "$MERGE_BASE" ]; then
  echo "⚠️  [Sub-Agent Review] merge-base를 찾을 수 없어 리뷰를 건너뜁니다." >&2
  exit 0
fi

DIFF=$(git diff "$MERGE_BASE"..HEAD 2>/dev/null)

if [ -z "$DIFF" ]; then
  echo "⚠️  [Sub-Agent Review] diff가 없습니다. 리뷰를 건너뜁니다." >&2
  exit 0
fi

# diff가 너무 크면 잘라냄 (토큰 절약)
DIFF_TRUNCATED=$(echo "$DIFF" | head -500)

REVIEW_PROMPT="당신은 시니어 엔지니어입니다. 아래 git diff를 보안/성능/컨벤션 위반 관점으로만 리뷰하세요.

규칙:
- 문제가 없으면 반드시 'LGTM'만 출력하세요.
- 문제가 있으면 'ISSUE: ' 접두사로 각 항목을 출력하세요.
- 사소한 스타일 지적은 하지 마세요. 심각한 문제만 잡으세요.

diff:
${DIFF_TRUNCATED}"

REVIEW=$(echo "$REVIEW_PROMPT" | "$CLAUDE_CMD" -p 2>/dev/null)

if echo "$REVIEW" | grep -qi "^LGTM"; then
  echo "✅ [Sub-Agent Review] 리뷰 통과 — PR 생성을 허용합니다." >&2
  exit 0
fi

if echo "$REVIEW" | grep -q "ISSUE:"; then
  echo "🔴 [Sub-Agent Review] 리뷰에서 이슈가 발견되었습니다:" >&2
  echo "$REVIEW" | grep "ISSUE:" | while IFS= read -r line; do
    echo "   $line" >&2
  done
  echo "" >&2
  echo "   PR 생성이 차단되었습니다. 이슈를 수정 후 다시 시도하세요." >&2
  echo "   무시하려면: gh pr create 명령을 직접 터미널에서 실행하세요." >&2
  exit 1
fi

# 응답이 LGTM도 ISSUE도 아닌 경우 경고 후 통과
echo "⚠️  [Sub-Agent Review] 리뷰 응답을 파싱할 수 없습니다. 통과합니다." >&2
exit 0
