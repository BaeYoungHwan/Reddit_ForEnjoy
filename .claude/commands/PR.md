# /PR — PR 자동화

Staged 변경사항을 커밋하고 GitHub PR을 자동으로 생성합니다.
**push 전 반드시 사용자 확인을 받습니다.**

---

## 실행 흐름

### 1단계 — 브랜치 및 staged 변경사항 확인

```bash
git branch --show-current
git status
git diff --staged --stat
```

현재 브랜치가 `main` 또는 `master`이면 즉시 중단:
```
⛔ main/master 브랜치에서는 PR을 생성할 수 없습니다.
작업 브랜치로 전환 후 다시 시도하세요:
  git checkout -b feature/[작업명]
```

staged 변경사항이 없으면 중단:
```
⚠️  staged 변경사항이 없습니다.
git add <파일> 로 스테이징 후 다시 시도하세요.
```

### 2단계 — 커밋 (자동 실행, 확인 없음)

docs/ref/commit-convention.md 규칙에 따라 커밋 메시지를 생성하고 **사용자 확인 없이 즉시 커밋**한다.




### 3단계 — push (자동 실행, 확인 없음)

```bash
git push origin [현재 브랜치]
# 업스트림 없는 경우:
git push -u origin [현재 브랜치]
```

push 실패 시 안내:
- 권한 거부 (Permission denied) → `gh auth status` 확인 후 `gh auth login`
- non-fast-forward → `git pull --rebase origin <브랜치>` 후 재시도
- 업스트림 없음 → 자동으로 `-u` 옵션 추가하여 재시도
- 그 외 오류 → 오류 메시지를 출력하고 PR 생성 중단 (커밋은 로컬에 유지됨)

### 4단계 — PR 생성

```bash
# Claude가 실행 시 아래 플레이스홀더를 실제 값으로 채운다:
#   [자동 생성된 제목]          → git log -1 --pretty=%s 첫 줄
#   [커밋 메시지 요약]          → git log -1 --pretty=%B 전체
#   [git diff --name-only 목록] → git diff HEAD~1 --name-only 출력
gh pr create \
  --title "[자동 생성된 제목]" \
  --body "$(cat <<'PREOF'
## 변경 내용
[커밋 메시지 요약]

## 변경 파일
[git diff --name-only 목록]

## 테스트 방법
[변경 타입에 따른 검증 제안]

🤖 /PR 스킬로 자동 생성
PREOF
)"
```

`gh` CLI가 없으면 이 단계에서 중단하고 수동 PR 생성 안내 출력.

### 5단계 — 완료 안내

```
✅ PR 생성 완료
URL: [PR URL]
```

---

## 주의사항

- main/master 브랜치에서 실행 불가 (settings.json deny 규칙)
- `sub-agent-review.sh` 훅 활성화 시 push 전 자동 diff 리뷰 실행
