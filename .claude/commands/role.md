# /role — 팀원 역할 인식

`/role <이름>`으로 실행하면, 이 프로젝트에서 지금 사용자가 어떤 팀원이고 어떤 역할을 맡고 있는지 Claude가 인식하도록 설정합니다.

## 인자
$ARGUMENTS

## 실행 절차

1. 인자로 받은 이름(또는 별칭)을 `.claude/team-roster.json`의 `members[].name` / `aliases`와 대조한다.

2. **일치하는 팀원을 찾으면:**
   - `.claude/current-role.local.json` 파일을 아래 형식으로 생성/덮어쓴다:
     ```json
     {
       "name": "<매칭된 이름>",
       "role": "<role>",
       "lane": "<lane>",
       "ownedPaths": [ "<ownedPaths>" ],
       "responsibilities": [ "<responsibilities>" ],
       "branchPrefix": "<branchPrefix>",
       "setAt": "<현재 ISO 타임스탬프>"
     }
     ```
   - 사용자에게 아래 형식으로 확인 메시지를 출력한다:
     ```
     ✅ [이름]님으로 설정되었습니다
     담당: [role]
     담당 경로: [ownedPaths]
     브랜치 prefix: feature/[branchPrefix]-*
     ```

3. **일치하는 팀원이 없으면:**
   - `.claude/team-roster.json`에 등록된 이름 목록을 보여준다.
   - 오타인지 확인을 요청한다. 로스터에 없는 신규 팀원이면 팀장에게 `.claude/team-roster.json` 추가를 요청하도록 안내한다 — Claude가 임의로 공용 로스터 파일에 새 인원을 추가하지 않는다.

4. **인자 없이 `/role`만 실행된 경우:**
   - `.claude/current-role.local.json`이 있으면 현재 설정된 역할을 보여준다.
   - 없으면 사용법(`/role <이름>`)과 로스터에 등록된 이름 목록을 안내한다.

## 역할 설정 이후 행동 원칙

- 이후 세션에서 이 팀원의 `ownedPaths`/`responsibilities`에 맞는 작업을 우선적으로 돕는다.
- 사용자가 자기 `ownedPaths` 밖의 파일을 수정하려 하면 막지 않되, `docs/team-roles.md`의 "담당 영역 침범 시 확인 절차" 규칙(해당 영역 담당자가 PR 리뷰어로 포함되어야 함)을 상기시킨다.

## 주의

- `.claude/current-role.local.json`은 개인 로컬 상태 파일이며 git에 커밋되지 않는다 (`.gitignore` 처리됨).
- 로스터 자체(`.claude/team-roster.json`)는 팀 공용 파일이므로 이 커맨드에서 임의로 수정하지 않는다.
