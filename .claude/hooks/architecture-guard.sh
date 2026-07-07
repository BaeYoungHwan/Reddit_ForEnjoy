#!/usr/bin/env bash
# architecture-guard.sh — 레이어 의존성 위반 감지
# PostToolUse(Write/Edit) 훅: 구현 파일 작성 후 레이어 경계 위반 감지

source "$(dirname "$0")/lib/parse-json.sh"

INPUT=$(cat)
FILE_PATH=$(get_tool_input_field "$INPUT" "file_path")

[ -z "$FILE_PATH" ] && exit 0
[ ! -f "$FILE_PATH" ] && exit 0

STRICT_FLAG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks-strict.flag"

# 소스 파일만 체크 (Python, TypeScript, JavaScript)
if ! echo "$FILE_PATH" | grep -qiE '\.(py|ts|tsx|js|jsx)$'; then
  exit 0
fi

# 테스트 파일은 체크 제외
if echo "$FILE_PATH" | grep -qiE '(test_|_test\.|\.test\.|spec\.|/tests?/|__tests__)'; then
  exit 0
fi

# 레이어 감지 함수
detect_layer() {
  local path="$1"
  if echo "$path" | grep -qiE '/(api|routes?|controllers?|handlers?|views?)/'; then
    echo "presentation"
  elif echo "$path" | grep -qiE '/(services?|use.?cases?|application)/'; then
    echo "application"
  elif echo "$path" | grep -qiE '/(domain|entities?|models?|core)/'; then
    echo "domain"
  elif echo "$path" | grep -qiE '/(repositories?|infrastructure|adapters?|db|database)/'; then
    echo "infrastructure"
  else
    echo "unknown"
  fi
}

CURRENT_LAYER=$(detect_layer "$FILE_PATH")
[ "$CURRENT_LAYER" = "unknown" ] && exit 0

# 파일 내용에서 금지된 import 패턴 감지
FILE_CONTENT=$(cat "$FILE_PATH" 2>/dev/null)

warn() {
  local msg="$1"
  if [ -f "$STRICT_FLAG" ]; then
    echo "🚫 [아키텍처 차단] $msg" >&2
    echo "   파일: $FILE_PATH (레이어: $CURRENT_LAYER)" >&2
    echo "   규칙: docs/ref/architecture-guide.md 참조" >&2
    echo "   엄격 모드: 레이어 위반은 허용되지 않습니다. (.claude/hooks-strict.flag)" >&2
    exit 1
  fi
  echo "⚠️  [아키텍처 경고] $msg" >&2
  echo "   파일: $FILE_PATH (레이어: $CURRENT_LAYER)" >&2
  echo "   규칙: docs/ref/architecture-guide.md 참조" >&2
}

# Domain 레이어가 Presentation 또는 Infrastructure를 직접 참조하는지 검사
if [ "$CURRENT_LAYER" = "domain" ]; then
  if echo "$FILE_CONTENT" | grep -qiE 'from.*(api|routes?|controllers?|handlers?)|import.*(api|routes?|controllers?)'; then
    warn "Domain 레이어가 Presentation 레이어를 참조합니다. 의존성 방향 위반."
  fi
  if echo "$FILE_CONTENT" | grep -qiE 'from.*(repository|database|db\.|\.db)|import.*(repository|database)'; then
    warn "Domain 레이어가 Infrastructure를 직접 참조합니다. 인터페이스를 통해 접근하세요."
  fi
fi

# Presentation 레이어가 Infrastructure를 직접 참조하는지 검사
if [ "$CURRENT_LAYER" = "presentation" ]; then
  if echo "$FILE_CONTENT" | grep -qiE 'from.*(repository|database|\bdb\b)|import.*(repository|database)'; then
    warn "Presentation 레이어가 Infrastructure(DB)를 직접 참조합니다. Service 레이어를 통해 접근하세요."
  fi
fi

exit 0
