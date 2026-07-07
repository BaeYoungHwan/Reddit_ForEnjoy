#!/usr/bin/env bash
# test_architecture_guard.sh — architecture-guard.sh 단위 테스트
# architecture-guard.sh는 PostToolUse(Write/Edit) 훅
# 파일이 실제 존재하지 않으면 exit 0 (훅 내부에서 [ ! -f "$FILE_PATH" ] && exit 0)
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

echo "=== architecture-guard.sh 테스트 ==="

# 테스트용 임시 파일 생성 (훅은 실제 파일 존재 여부를 확인함)
TMPDIR_TEST=$(mktemp -d)
trap 'rm -rf "$TMPDIR_TEST"' EXIT

# 1. domain 레이어 파일이 controllers를 import → 경고(경고 모드, exit 0) 또는 차단(strict 모드, exit 1)
#    hooks-strict.flag가 없으면 경고 모드 → exit 0
DOMAIN_FILE="$TMPDIR_TEST/user.py"
echo "import controllers" > "$DOMAIN_FILE"
result=$(run_hook "architecture-guard.sh" "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$DOMAIN_FILE\"},\"tool_response\":{}}")
assert "0" "$result" "domain/user.py with import controllers → 경고 모드 허용"

# 2. presentation 레이어 파일 (DB import 없음) → exit 0
PRES_FILE="$TMPDIR_TEST/view.py"
# src/presentation 경로로 심볼릭 없이 직접 절대경로를 포함한 파일명 생성
PRES_DIR="$TMPDIR_TEST/presentation"
mkdir -p "$PRES_DIR"
PRES_FILE="$PRES_DIR/view.py"
echo "from services import user_service" > "$PRES_FILE"
result=$(run_hook "architecture-guard.sh" "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$PRES_FILE\"},\"tool_response\":{}}")
assert "0" "$result" "presentation/view.py (정상 import) → 허용"

# 3. README.md → exit 0 (비소스 파일)
result=$(run_hook "architecture-guard.sh" '{"tool_name":"Write","tool_input":{"file_path":"README.md"},"tool_response":{}}')
assert "0" "$result" "README.md → 허용 (비소스 파일)"

# 4. 실제로 존재하지 않는 경로 → exit 0 (훅이 파일 존재 체크 후 종료)
result=$(run_hook "architecture-guard.sh" '{"tool_name":"Write","tool_input":{"file_path":"src/domain/nonexistent.py"},"tool_response":{}}')
assert "0" "$result" "존재하지 않는 파일 → 허용 (파일 없음)"

echo ""
echo "  결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
