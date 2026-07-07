#!/usr/bin/env bash
# lint-test-build.sh — git commit 직전 Lint·Test·Build 자동 실행
# PreToolUse(Bash) 훅: git commit 명령 감지 시 실행, 실패하면 commit 차단

source "$(dirname "$0")/lib/parse-json.sh"

INPUT=$(cat)
COMMAND=$(get_tool_input_field "$INPUT" "command")

# git commit 명령이 아니면 통과
echo "$COMMAND" | grep -q "git commit" || exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

run_check() {
  local label="$1"
  shift
  echo "  ▶ $label..." >&2
  if ! "$@" > /dev/null 2>&1; then
    echo "❌ [Lint-Test-Build] $label 실패" >&2
    echo "   커밋이 차단되었습니다. 오류를 수정 후 다시 시도하세요." >&2
    exit 1
  fi
  echo "  ✅ $label 통과" >&2
}

echo "🔍 [Lint-Test-Build] commit 전 검사 시작..." >&2

# Node.js
if [ -f "$PROJECT_ROOT/package.json" ]; then
  PKG="$PROJECT_ROOT/package.json"
  grep -q '"lint"' "$PKG" && run_check "ESLint" npm run lint --prefix "$PROJECT_ROOT"
  grep -q '"test"' "$PKG" && run_check "Jest/테스트" npm test --prefix "$PROJECT_ROOT" -- --passWithNoTests
  grep -q '"build"' "$PKG" && run_check "Build" npm run build --prefix "$PROJECT_ROOT"
  echo "✅ [Lint-Test-Build] 모든 검사 통과 — commit 허용" >&2
  exit 0
fi

# Python
if [ -f "$PROJECT_ROOT/pyproject.toml" ] || [ -f "$PROJECT_ROOT/setup.py" ] || [ -f "$PROJECT_ROOT/setup.cfg" ]; then
  command -v flake8 >/dev/null 2>&1 && run_check "flake8" flake8 "$PROJECT_ROOT"
  command -v pytest >/dev/null 2>&1 && run_check "pytest" pytest "$PROJECT_ROOT" -q
  echo "✅ [Lint-Test-Build] 모든 검사 통과 — commit 허용" >&2
  exit 0
fi

# Go
if [ -f "$PROJECT_ROOT/go.mod" ]; then
  command -v go >/dev/null 2>&1 && run_check "go vet" go vet "$PROJECT_ROOT/..."
  command -v go >/dev/null 2>&1 && run_check "go test" go test "$PROJECT_ROOT/..."
  echo "✅ [Lint-Test-Build] 모든 검사 통과 — commit 허용" >&2
  exit 0
fi

# Rust
if [ -f "$PROJECT_ROOT/Cargo.toml" ]; then
  # -- -D warnings 미사용: 외부 의존성 경고에 의한 차단 방지 목적으로 의도적으로 완화
  command -v cargo >/dev/null 2>&1 && run_check "cargo clippy" cargo clippy --manifest-path "$PROJECT_ROOT/Cargo.toml"
  command -v cargo >/dev/null 2>&1 && run_check "cargo test" cargo test --manifest-path "$PROJECT_ROOT/Cargo.toml"
  echo "✅ [Lint-Test-Build] 모든 검사 통과 — commit 허용" >&2
  exit 0
fi

# Makefile (폴백)
if [ -f "$PROJECT_ROOT/Makefile" ]; then
  make -n lint >/dev/null 2>&1 && run_check "make lint" make lint -C "$PROJECT_ROOT"
  make -n test >/dev/null 2>&1 && run_check "make test" make test -C "$PROJECT_ROOT"
  echo "✅ [Lint-Test-Build] 모든 검사 통과 — commit 허용" >&2
  exit 0
fi

# 프로젝트 타입 감지 불가 — 통과
echo "⚠️  [Lint-Test-Build] 프로젝트 타입을 감지할 수 없어 검사를 건너뜁니다." >&2
exit 0
