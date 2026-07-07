#!/usr/bin/env bash
# global-setup/install.sh
# Claude Code 전역 설정을 ~/.claude/에 설치합니다.
# 사용법: bash global-setup/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"

echo "=== Claude Code 전역 설정 설치 ==="
echo ""

# 1. hooks 디렉토리 생성
mkdir -p "$HOOKS_DIR"

# 2. hook 파일 복사
echo "[1/3] Hook 파일 복사 중..."
cp "$SCRIPT_DIR/hooks/context-bar.sh" "$HOOKS_DIR/context-bar.sh"
cp "$SCRIPT_DIR/hooks/notify.ps1"     "$HOOKS_DIR/notify.ps1"
cp "$SCRIPT_DIR/hooks/session_start.ps1" "$HOOKS_DIR/session_start.ps1"
chmod +x "$HOOKS_DIR/context-bar.sh"
echo "  ✓ context-bar.sh, notify.ps1, session_start.ps1 → $HOOKS_DIR/"

# 3. settings.json 안내
echo ""
echo "[2/3] settings.json 안내"
echo "  global-setup/settings.json 을 ~/.claude/settings.json 에 반영하세요."
echo "  기존 settings.json 이 있으면 직접 병합이 필요합니다 (덮어쓰면 기존 설정 유실)."
echo ""
echo "  기존 파일이 없는 경우 바로 복사:"
echo "    cp \"$SCRIPT_DIR/settings.json\" \"$CLAUDE_DIR/settings.json\""

# 4. 확인
echo ""
echo "[3/3] 설치 결과"
for f in context-bar.sh notify.ps1 session_start.ps1; do
    if [[ -f "$HOOKS_DIR/$f" ]]; then
        echo "  ✓ $HOOKS_DIR/$f"
    else
        echo "  ✗ $HOOKS_DIR/$f (실패)"
    fi
done

echo ""
echo "=== 설치 완료 ==="
echo "  상태바 활성화: Claude Code를 재시작하면 적용됩니다."
echo "  완료 알림: 세션 종료 시 Windows 토스트 알림이 표시됩니다."
echo ""
