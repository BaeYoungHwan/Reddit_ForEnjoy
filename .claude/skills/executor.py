#!/usr/bin/env python3
"""
executor.py — Phase별 순차 자동 실행 엔진

사용법:
    python executor.py --plan docs/exec-plans/active/phase-1-auth.md
    python executor.py --plan docs/exec-plans/active/phase-1-auth.md --dry-run
"""

import argparse
import json
import subprocess
import sys
import re
from pathlib import Path
from datetime import datetime

# 상태 파일 경로 (스크립트 위치 기준 절대 경로)
STATE_DIR = Path(__file__).parent / "logs"


def parse_plan(plan_path: str) -> list[dict]:
    """실행 계획 파일에서 미완료 작업 목록 파싱."""
    path = Path(plan_path)
    if not path.exists():
        print(f"❌ 계획 파일 없음: {plan_path}", file=sys.stderr)
        sys.exit(1)

    tasks = []
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            # [ ] 또는 [🔄] 항목 추출 (완료된 [x]는 건너뜀)
            match = re.match(r"^- \[([ 🔄])\] (.+)", line.strip())
            if match:
                status_char = match.group(1)
                description = match.group(2)
                tasks.append({
                    "line": i,
                    "description": description,
                    "status": "running" if status_char == "🔄" else "pending",
                })

    return tasks


def get_state_file(plan_path: str) -> Path:
    """계획 파일에 대응하는 상태 JSON 파일 경로."""
    plan_name = Path(plan_path).stem
    return STATE_DIR / f"executor-{plan_name}.json"


def load_state(state_file: Path) -> dict:
    """이전 실행 상태 로드."""
    if not state_file.exists():
        return {"tasks": {}}
    try:
        with open(state_file, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        print(f"⚠️  상태 파일 손상 감지: {state_file} — 초기화합니다.", file=sys.stderr)
        return {"tasks": {}}


def save_state(state_file: Path, state: dict) -> None:
    """현재 실행 상태 저장."""
    with open(state_file, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def run_task(task: dict, dry_run: bool = False) -> bool:
    """단일 태스크를 claude -p 헤드리스 모드로 실행."""
    description = task["description"]
    prompt = f"다음 작업을 완료하세요:\n\n{description}\n\n완료 후 결과를 간략히 요약해주세요."

    print(f"\n🔄 실행 중: {description}")
    print(f"   시작: {datetime.now().strftime('%H:%M:%S')}")

    if dry_run:
        print(f"   [DRY-RUN] claude -p '{prompt[:50]}...'")
        return True

    try:
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=args.timeout,
            encoding="utf-8",
        )

        if result.returncode == 0:
            print(f"   ✅ 완료: {datetime.now().strftime('%H:%M:%S')}")
            if result.stdout:
                # 출력 첫 3줄만 표시
                lines = result.stdout.strip().split("\n")[:3]
                for line in lines:
                    print(f"   {line}")
            return True
        else:
            print(f"   ❌ 실패 (exit {result.returncode}): {datetime.now().strftime('%H:%M:%S')}")
            if result.stderr:
                print(f"   에러: {result.stderr[:200]}")
            return False

    except subprocess.TimeoutExpired:
        print(f"   ⏰ 타임아웃 (5분 초과)")
        return False
    except FileNotFoundError:
        print(f"   ❌ claude CLI를 찾을 수 없습니다. Claude Code가 설치되어 있는지 확인하세요.")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Phase 실행 자동화 엔진")
    parser.add_argument("--plan", required=True, help="실행 계획 파일 경로")
    parser.add_argument("--dry-run", action="store_true", help="실제 실행 없이 계획만 출력")
    parser.add_argument("--retry-failed", action="store_true", help="실패한 태스크만 재실행")
    parser.add_argument("--timeout", type=int, default=300, help="태스크당 타임아웃 초 (기본값: 300)")
    args = parser.parse_args()

    # 상태 디렉토리 초기화
    try:
        STATE_DIR.mkdir(exist_ok=True)
    except OSError as e:
        print(f"❌ 상태 디렉토리 생성 실패: {e}", file=sys.stderr)
        sys.exit(1)

    # 계획 파싱
    tasks = parse_plan(args.plan)
    if not tasks:
        print("✅ 미완료 작업이 없습니다.")
        return

    state_file = get_state_file(args.plan)
    state = load_state(state_file)

    print(f"\n📋 실행 계획: {args.plan}")
    print(f"   미완료 작업 수: {len(tasks)}")
    if args.dry_run:
        print("   [DRY-RUN 모드]")

    results = {"done": 0, "failed": 0, "skipped": 0}

    for task in tasks:
        task_key = f"line_{task['line']}"
        prev_status = state["tasks"].get(task_key, {}).get("status")

        # 완료된 것은 항상 건너뜀
        if prev_status == "done":
            results["skipped"] += 1
            continue

        # retry-failed 모드: 실패한 태스크만 재실행 (미실행 pending은 건너뜀)
        if args.retry_failed and prev_status != "failed":
            results["skipped"] += 1
            continue

        success = run_task(task, dry_run=args.dry_run)

        state["tasks"][task_key] = {
            "description": task["description"],
            "status": "done" if success else "failed",
            "timestamp": datetime.now().isoformat(),
        }
        try:
            save_state(state_file, state)
        except OSError as e:
            print(f"   ⚠️  상태 저장 실패: {e}", file=sys.stderr)

        if success:
            results["done"] += 1
        else:
            results["failed"] += 1
            print(f"\n⚠️  실패한 태스크가 있습니다. 계속 진행합니까? (y/N): ", end="")
            if not args.dry_run:
                try:
                    answer = input().strip().lower()
                except EOFError:
                    print("중단됩니다.")
                    break
                if answer != "y":
                    print("중단됩니다.")
                    break

    # 최종 보고
    print(f"\n{'='*40}")
    print(f"실행 완료: ✅ {results['done']} | ❌ {results['failed']} | ⏭️ {results['skipped']}")
    print(f"상태 저장: {state_file}")

    if results["failed"] > 0:
        print(f"\n실패 태스크 재실행:")
        print(f"  python executor.py --plan {args.plan} --retry-failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
