#!/usr/bin/env bash
# run-all.sh — 모든 훅 단위 테스트 실행
cd "$(dirname "$0")/.."
total_fail=0
for t in tests/hooks/test_*.sh; do
  echo "=== $(basename "$t") ==="
  bash "$t" || total_fail=$((total_fail + 1))
  echo ""
done
[ $total_fail -eq 0 ] && echo "전체 통과" || echo "실패 ${total_fail}건"
exit $total_fail
