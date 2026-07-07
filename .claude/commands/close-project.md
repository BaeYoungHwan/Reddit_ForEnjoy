# /close-project — 프로젝트 종료

프로젝트를 깔끔하게 닫습니다. 11단계 종료 흐름을 순서대로 실행합니다.

---

## 실행 전 확인

`.project-closed` 파일이 프로젝트 루트에 이미 존재하면 아래 경고를 출력하고 계속 진행 여부를 묻는다:

```
⚠️  이 프로젝트는 이미 종료된 상태입니다 (.project-closed 존재).
   재실행하면 일부 파일이 덮어쓰여질 수 있습니다. 계속하시겠습니까? (y/n):
```

n 선택 시 종료. y 선택 시 계속 진행.

---

## 1단계 — 미커밋 파일 확인 + 최종 커밋

`git status --short` 명령을 실행한다.

출력 결과가 비어 있지 않으면 (변경사항이 존재하면):

```
미커밋 변경사항이 있습니다. 최종 커밋을 만들까요? (y/n):
```

- **y** 선택 시: `/commit` 스킬을 호출한다.
- **n** 선택 시: 아래 경고를 출력하고 다음 단계로 진행한다.
  ```
  ⚠️  미커밋 변경사항이 있는 상태로 프로젝트가 종료됩니다.
  ```

변경사항이 없으면: `✅ 미커밋 변경사항 없음` 출력 후 다음 단계로 진행.

---

## 2단계 — 최종 AI-Readiness 점수 측정

`.claude/skills/score.py` 또는 `scripts/score.py` 파일 존재 여부를 확인한다.

- 존재하면: `/ai-readiness-cartography` 스킬을 실행하고, 결과를 `docs/exec-plans/completed/ai-readiness-final.json`에 저장하도록 안내한다.
- 존재하지 않으면:
  ```
  ⏭️  [2단계] 건너뜀 — score.py 없음
  ```

---

## 3단계 — 토큰/비용 효율 최종 분석

`/improve-token-efficiency` 스킬을 실행한다.

결과 요약(총 토큰 수, 예상 비용, 효율 점수 등)을 터미널에 출력한다.

세션 로그 파일이 없어 분석 불가한 경우:
```
⏭️  [3단계] 건너뜀 — 세션 로그 파일 없음
```

---

## 4단계 — TODO.md 미완료 항목 집계

`TODO.md` 파일에서 `[ ]` 패턴을 grep하여 미완료 항목 개수와 목록을 출력한다.

출력 형식:
```
📋 미완료 항목: N개
  - [ ] 항목1
  - [ ] 항목2
```

`TODO.md`가 없으면:
```
⏭️  [4단계] 건너뜀 — TODO.md 없음
```

미완료 항목이 없으면: `✅ 모든 TODO 완료` 출력.

---

## 5단계 — exec-plans/active/ → exec-plans/completed/ 이동

`docs/exec-plans/active/` 디렉토리 아래에 파일이 있으면 다음을 실행한다:

1. `docs/exec-plans/completed/` 디렉토리가 없으면 먼저 생성.
2. `docs/exec-plans/active/` 아래 모든 파일을 `docs/exec-plans/completed/`로 이동:
   ```
   mv docs/exec-plans/active/* docs/exec-plans/completed/
   ```

`docs/exec-plans/active/`가 비어 있거나 존재하지 않으면:
```
⏭️  [5단계] 건너뜀 — active 플랜 없음
```

---

## 6단계 — README 정리

`README.md` 존재 여부를 확인한다.

- **없으면**: 아래 질문을 출력한다:
  ```
  README.md가 없습니다. 기본 README를 생성할까요? (y/n):
  ```
  - y 선택 시: 프로젝트명, 설명, 시작 방법 3항목을 포함한 최소 README를 생성한다.
  - n 선택 시: 건너뜀.

- **있으면**: 아래 안내를 출력하고 다음 단계로 진행한다:
  ```
  ℹ️  현재 README.md가 최신 상태인지 검토하세요.
  ```

---

## 7단계 — HTML 종료 보고서 생성

`docs/exec-plans/completed/` 아래 파일 목록을 수집하고, 아래 항목을 포함하는 종료 보고서를 생성한다:

- 프로젝트명 (`CLAUDE.md`에서 추출)
- 종료일 (오늘 날짜)
- AI-Readiness 최종 점수 (2단계 결과, 없으면 "측정 안 됨")
- 완료된 Phase 목록 (`docs/exec-plans/completed/` 파일 목록)
- 미완료 TODO 개수 (4단계 결과)

**Python이 사용 가능한 경우**: f-string 템플릿을 이용해 `docs/project-close-report.html`을 생성한다.

> **주의:** 스크립트 상단 `ai_score`, `todo_count` 두 변수만 실제 값으로 치환한 후 실행합니다.
> 기본값(`None`, `-1`)이 그대로 남아 있으면 치환이 안 된 것입니다.

```python
# 예시 생성 명령 (Python 3)
python -c "
import datetime, os, pathlib

ai_score = None            # 2단계 AI-Readiness 결과로 Claude가 이 값을 치환 (None = 미치환 센티넬)
todo_count = -1           # 4단계 미완료 TODO 개수로 Claude가 이 값을 치환 (-1은 미치환 센티넬)

# 치환 검증 — 둘 다 기본값이면 실행 중단
if ai_score is None or todo_count == -1:
    import sys
    print('ERROR: ai_score 또는 todo_count가 치환되지 않았습니다. 실제 값으로 치환 후 실행하세요.', file=sys.stderr)
    sys.exit(2)

try:
    import re as _re
    _claude_text = pathlib.Path('CLAUDE.md').read_text(encoding='utf-8')
    _m = _re.search(r'^#\s+(.+)', _claude_text, _re.MULTILINE)
    project_name = _m.group(1).strip() if _m else '(프로젝트명 미설정)'
except FileNotFoundError:
    project_name = '(CLAUDE.md 없음)'
close_date = datetime.date.today().isoformat()
completed = list(pathlib.Path('docs/exec-plans/completed').glob('*')) if pathlib.Path('docs/exec-plans/completed').exists() else []
phase_list = ''.join(f'<li>{p.name}</li>' for p in completed)

html = f\"\"\"<!DOCTYPE html>
<html lang='ko'>
<head><meta charset='UTF-8'><title>종료 보고서 — {project_name}</title>
<style>body{{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px}}
h1{{color:#1a1a2e}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:8px}}th{{background:#f4f4f4}}</style>
</head>
<body>
<h1>프로젝트 종료 보고서</h1>
<table>
  <tr><th>프로젝트명</th><td>{project_name}</td></tr>
  <tr><th>종료일</th><td>{close_date}</td></tr>
  <tr><th>AI-Readiness 점수</th><td>{ai_score if ai_score is not None else '측정 안 됨'}</td></tr>
  <tr><th>미완료 TODO</th><td>{todo_count}개</td></tr>
</table>
<h2>완료된 Phase</h2>
<ul>{phase_list}</ul>
</body></html>\"\"\"

pathlib.Path('docs/project-close-report.html').write_text(html, encoding='utf-8')
print('✅ docs/project-close-report.html 생성 완료')
"
```

**Python이 없는 경우**: `docs/project-close-report.md` 마크다운 파일로 대체 생성한다.

---

## 8단계 — 이메일 + 토스트 알림 발송

`.env` 파일에서 `SMTP_HOST` 설정 존재 여부를 확인한다.

- **`SMTP_HOST` 설정이 있으면**:
  ```
  이메일 알림을 발송할까요? (y/n):
  ```
  - y 선택 시:
    - `.claude/skills/send_notification.py`가 존재하면:
      ```
      python .claude/skills/send_notification.py "프로젝트 종료: [프로젝트명]"
      ```
    - 파일이 없으면:
      ```
      ⚠️  send_notification.py가 없어 이메일 발송을 건너뜁니다.
      ```
  - n 선택 시: 건너뜀.

- **`SMTP_HOST` 설정이 없으면**:
  ```
  ⏭️  [8단계] 건너뜀 — .env에 SMTP 설정 없음
  ```

---

## 9단계 — `.project-closed` 플래그 생성

프로젝트 루트에 `.project-closed` 파일을 생성한다:

```
closed: YYYY-MM-DD
project: [CLAUDE.md에서 추출한 프로젝트명]
```

날짜는 오늘 날짜를 `YYYY-MM-DD` 형식으로 기입한다.

> 이 파일이 존재하면 `/init-project` 실행 시 "이미 종료된 프로젝트입니다" 경고가 표시되어야 합니다.

---

## 10단계 — 회고 인터뷰 (선택)

아래 질문을 출력한다:

```
회고 인터뷰를 진행할까요? (y/n):
```

**y 선택 시** 아래 3가지 질문을 순서대로 묻고 답변을 기록한다:

1. 이 프로젝트에서 가장 잘 된 점은?
2. 다음 프로젝트에서 개선할 점은?
3. Claude Code 활용에서 효과적이었던 패턴은?

답변을 `docs/retrospective-[날짜].md` 파일로 저장한다 (예: `docs/retrospective-2025-05-16.md`).

**n 선택 시**: 건너뜀.

---

## 11단계 — AI-Readiness 스케줄 중단 안내

`CronList` 또는 `/schedule` 등록된 AI-Readiness 주기 측정 작업 여부를 확인한다.

- **등록된 작업이 있으면**:
  ```
  ℹ️  AI-Readiness 주기 측정이 등록되어 있습니다.
     더 이상 측정이 필요 없으면 '/schedule cancel [ID]'로 중단하세요.
  ```

- **없으면**:
  ```
  ⏭️  [11단계] 건너뜀 — 등록된 스케줄 없음
  ```

---

## 최종 완료 메시지

모든 단계 완료 후 아래 메시지를 출력한다:

```
✅ 프로젝트 종료 완료

  종료일: [오늘 날짜]
  미완료 TODO: N개
  최종 AI-Readiness: [점수 또는 "측정 안 됨"]
  종료 보고서: docs/project-close-report.html

  수고하셨습니다! 🎉
```

---

## 주의사항

- `.project-closed` 플래그가 이미 존재하면 재실행 시 경고를 출력한다 (위 "실행 전 확인" 참조).
- 각 단계는 실패해도 다음 단계로 계속 진행한다 (중단 없음).
- 단계를 건너뛸 때는 반드시 아래 형식으로 표시한다:
  ```
  ⏭️  [N단계] 건너뜀 — [이유]
  ```
