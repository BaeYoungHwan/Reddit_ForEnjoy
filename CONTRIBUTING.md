# 기여 가이드

## 브랜치 전략
- `main`: 배포/제출 브랜치 (직접 푸시 금지)
- `feature/<이름>-<작업내용>`: 팀원별 작업 브랜치 (예: `feature/hong-daily-challenge`)

## 작업 흐름
1. `git checkout -b feature/<이름>-<작업내용>`
2. 작업 후 커밋 (`/commit` 스킬 사용 권장)
3. PR 생성 (`/PR` 스킬 사용) → `main`으로
4. 리뷰 후 머지
   - 자기 담당 영역(`docs/team-roles.md` 기준)만 건드린 PR: 팀원 1인 이상 리뷰
   - **다른 사람 담당 영역을 건드린 PR: 그 영역 담당자가 반드시 리뷰어로 포함되어야 머지 가능** — 영역 침범 자체는 막지 않되, 담당자 확인은 반드시 거친다
5. 해커톤 특성상 리뷰 지연 시 24시간 내 셀프 머지 허용 (단, 코어 로직 변경 및 담당자 확인이 필요한 영역 침범 PR은 예외 — 반드시 확인 후 머지)

## 커밋 컨벤션
`.claude/commands/commit.md` 참조

## 개발 환경
- Node.js >= 22.2.0
- Devvit CLI (`npm install -g devvit` 또는 로컬 devDependency)
- 상세 셋업: `docs/setup-guide.md` 참조

## 충돌 방지 팁 (3인 동시 작업)
- `src/client`, `src/server`, `src/shared` 디렉터리 단위로 작업 영역을 나누어 충돌 최소화
- Redis 키 네이밍 규칙은 사전에 팀과 합의 후 `src/shared`에 상수로 정의
- devvit.json (메뉴/폼/트리거 등록)은 공용 파일이므로 수정 전 팀 채널에 공지

## Claude Code 설정 구조 (팀 규칙 vs 개인 설정)

이 프로젝트는 팀 전체가 각자 Claude Code로 개발합니다. 팀 규칙과 개인 취향이 섞이지 않도록 설정을 2단으로 분리합니다.

| 파일 | 용도 | git 추적 | 우선순위 |
|------|------|----------|----------|
| `.claude/settings.json` | **팀 규칙** — git 전략 강제, 공용 훅 등 | 커밋됨 (배포 대상) | 개인 설정이 절대 무력화 불가 |
| `.claude/settings.local.json` | **개인 설정** — 각자 취향껏 permissions/훅 추가 | `.gitignore` 처리됨 | 팀 규칙 위에 얹힘 |

### 왜 이렇게 나누는가
Claude Code 공식 문서 기준으로 `permissions.deny`는 **모든 설정 파일에 걸쳐 합집합(union)으로 강제**되며, 낮은 우선순위 파일(개인 `settings.local.json`)의 `allow`가 높은 우선순위 파일(팀 `settings.json`)의 `deny`를 절대 덮어쓸 수 없습니다. 즉 팀장이 `.claude/settings.json`에 넣은 git 전략 규칙(예: `main` 직접 푸시 금지)은 팀원이 개인 설정에서 아무리 허용해도 계속 차단됩니다.

반면 `hooks`는 이런 병합 보장이 없습니다(우선순위가 높은 파일이 낮은 파일을 덮어쓸 수 있음). 그래서:
- **반드시 지켜야 할 규칙은 `permissions.deny`로 작성** (팀 공통 `.claude/settings.json`에만 정의)
- **개인 `settings.local.json`에는 자기만의 `permissions.allow` 추가나 개인 알림 훅 정도만** 추가하고, 팀 훅과 같은 matcher(`PreToolUse`/`PostToolUse`의 `Bash`, `Write|Edit` 등)를 재정의하지 않기

### 개인 설정 만들기
```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```
이후 자유롭게 수정하세요. 이 파일은 git에 올라가지 않습니다.

### 현재 팀 규칙 (`.claude/settings.json`에 강제됨)
- `main`/`master` 직접 push 금지 (반드시 PR)
- `git push --force`, `git reset --hard`, `git checkout --`, `git clean`, `rm -rf` 금지
- `git checkout -b` / `git switch -c` 금지 — 브랜치 생성은 Claude가 아니라 직접 터미널에서 수행
- 신규 파일 작성 시 테스트 파일 존재 확인 (`tdd-enforcer.sh`)
