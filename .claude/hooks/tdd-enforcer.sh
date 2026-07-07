#!/usr/bin/env bash
# tdd-enforcer.sh — 구현 코드 작성 전 테스트 파일 존재 여부 확인
# PreToolUse(Write/Edit) 훅

source "$(dirname "$0")/lib/parse-json.sh"

INPUT=$(cat)
FILE_PATH=$(get_tool_input_field "$INPUT" "file_path")

[ -z "$FILE_PATH" ] && exit 0

# 구현 파일인지 판단 (테스트/설정/문서 파일은 제외)
is_impl_file() {
  local path="$1"
  # 제외 패턴: 테스트, 문서, 설정, 마이그레이션, 훅, 스킬
  echo "$path" | grep -qiE '(test_|_test\.|\.test\.|spec\.|\.spec\.|/tests?/|__tests__|\.md$|\.json$|\.yaml$|\.yml$|\.toml$|\.cfg$|\.ini$|hooks/|commands/|migrations?/|\.env|\.gitignore|requirements)' && return 1
  # 구현 파일 패턴: .py .ts .tsx .js .jsx .go .rs
  echo "$path" | grep -qiE '\.(py|ts|tsx|js|jsx|go|rs|java|rb|php)$' && return 0
  return 1
}

if ! is_impl_file "$FILE_PATH"; then
  exit 0
fi

# 파일명에서 테스트 파일 경로 추론
BASENAME=$(basename "$FILE_PATH")
DIRNAME=$(dirname "$FILE_PATH")
STEM="${BASENAME%.*}"
EXT="${BASENAME##*.}"

STRICT_FLAG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/hooks-strict.flag"

# 엄격 모드가 아니면 기존 파일 수정은 패스 (신규 생성만 체크)
if [ -f "$FILE_PATH" ] && [ ! -f "$STRICT_FLAG" ]; then
  exit 0
fi

# 테스트 파일 존재 여부 확인 (여러 위치 검색)
TEST_EXISTS=false
EXPECTED_PATHS=()

# Python 패턴
if [ "$EXT" = "py" ]; then
  for pattern in \
    "$(dirname "$DIRNAME")/tests/test_${STEM}.py" \
    "${DIRNAME}/test_${STEM}.py" \
    "tests/test_${STEM}.py" \
    "tests/${STEM}/test_${STEM}.py" \
    "$(dirname "$(dirname "$DIRNAME")")/tests/test_${STEM}.py" \
    "$(dirname "$(dirname "$DIRNAME")")/tests/${STEM}/test_${STEM}.py"
  do
    if [ -f "$pattern" ]; then
      TEST_EXISTS=true
      break
    fi
    EXPECTED_PATHS+=("$pattern")
  done
fi

# TypeScript/JavaScript 패턴
if echo "$EXT" | grep -qE '^(ts|tsx|js|jsx)$'; then
  for pattern in \
    "${DIRNAME}/${STEM}.test.${EXT}" \
    "${DIRNAME}/${STEM}.spec.${EXT}" \
    "__tests__/${STEM}.test.${EXT}" \
    "tests/${STEM}.test.${EXT}" \
    "$(dirname "$DIRNAME")/__tests__/${STEM}.test.${EXT}" \
    "packages/$(basename "$DIRNAME")/tests/${STEM}.test.${EXT}"
  do
    if [ -f "$pattern" ]; then
      TEST_EXISTS=true
      break
    fi
    EXPECTED_PATHS+=("$pattern")
  done
fi

# Go 패턴 (*_test.go 규약)
if [ "$EXT" = "go" ]; then
  for pattern in \
    "${DIRNAME}/${STEM}_test.go" \
    "tests/${STEM}_test.go"
  do
    if [ -f "$pattern" ]; then
      TEST_EXISTS=true
      break
    fi
    EXPECTED_PATHS+=("$pattern")
  done
fi

# Rust 패턴 (tests/ 디렉토리 또는 *_test.rs)
if [ "$EXT" = "rs" ]; then
  echo "$FILE_PATH" | grep -qE '/tests?/' && TEST_EXISTS=true
  if [ "$TEST_EXISTS" = "false" ]; then
    for pattern in \
      "${DIRNAME}/${STEM}_test.rs" \
      "tests/${STEM}.rs"
    do
      if [ -f "$pattern" ]; then
        TEST_EXISTS=true
        break
      fi
      EXPECTED_PATHS+=("$pattern")
    done
  fi
fi

# Java 패턴 (JUnit: StemTest.java)
if [ "$EXT" = "java" ]; then
  for pattern in \
    "${DIRNAME}/${STEM}Test.java" \
    "src/test/java/${STEM}Test.java" \
    "tests/${STEM}Test.java"
  do
    if [ -f "$pattern" ]; then
      TEST_EXISTS=true
      break
    fi
    EXPECTED_PATHS+=("$pattern")
  done
fi

# Ruby 패턴 (RSpec: stem_spec.rb)
if [ "$EXT" = "rb" ]; then
  for pattern in \
    "${DIRNAME}/${STEM}_spec.rb" \
    "spec/${STEM}_spec.rb" \
    "${DIRNAME}/test_${STEM}.rb"
  do
    if [ -f "$pattern" ]; then
      TEST_EXISTS=true
      break
    fi
    EXPECTED_PATHS+=("$pattern")
  done
fi

# PHP 패턴 (PHPUnit: StemTest.php)
if [ "$EXT" = "php" ]; then
  for pattern in \
    "${DIRNAME}/${STEM}Test.php" \
    "tests/${STEM}Test.php"
  do
    if [ -f "$pattern" ]; then
      TEST_EXISTS=true
      break
    fi
    EXPECTED_PATHS+=("$pattern")
  done
fi

if [ "$TEST_EXISTS" = "false" ]; then
  echo "⚠️  [TDD 강제] 테스트 파일이 없습니다." >&2
  echo "   구현 파일: $FILE_PATH" >&2
  echo "   예상 테스트 경로 (아래 중 하나 생성):" >&2
  for p in "${EXPECTED_PATHS[@]}"; do
    echo "     - $p" >&2
  done
  echo "   먼저 테스트 파일을 작성하세요. (/tdd 스킬 참조)" >&2
  echo "   테스트 없이 진행하려면 Not-done: 이유를 커밋 메시지에 명시하세요." >&2
  echo "" >&2
  echo "   비활성화 방법: .claude/hooks-strict.flag 삭제 후 settings.json에서 tdd-enforcer.sh 항목 제거" >&2
  exit 1
fi

exit 0
