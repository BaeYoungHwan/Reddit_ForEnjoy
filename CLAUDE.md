# CLAUDE.md — 미로의 발자국 (가제) 프로젝트 지침

> Reddit's Games with a Hook Hackathon 제출작. 상세 스펙: `docs/product-specs/PRD-v1.md`

---

## 팀원 역할 인식 (세션 시작 시 항상 먼저 확인)

1. `.claude/current-role.local.json` 존재 여부를 확인한다.
2. **있으면**: `name`, `role`, `ownedPaths`, `responsibilities`, `branchPrefix`를 읽고, 이후 모든 작업에서 이 팀원의 담당 영역에 맞게 우선 조언한다. 다른 담당자 영역 파일을 수정하려 하면 막지 말고 `docs/team-roles.md`의 "담당 영역 침범 시 확인 절차"(해당 영역 담당자가 PR 리뷰어로 포함되어야 함)를 상기시킨다.
3. **없으면**: 작업 시작 전 사용자에게 `/role <이름>` 실행을 안내한다 (`.claude/team-roster.json`에 등록된 이름: 임소리, 배영환, 송원호).

---

## 핵심 문서 지도

| 상황 | 참조 문서 |
|------|-----------|
| 게임 기획/스펙 | `docs/product-specs/PRD-v1.md` |
| 팀 역할 구조 | `docs/team-roles.md` |
| 팀 진행 상황(WBS) | `docs/wbs.md` |
| 일정 | `docs/schedule.md` |
| 개발환경 셋업 | `docs/setup-guide.md` |
| Git/기여 규칙 | `CONTRIBUTING.md` |
| 컨셉 검토 이력 | `docs/concept-shortlist.md` |
| Devvit Web 코드 규칙 | `docs/ref/devvit-conventions.md` |
| 시야(안개) 밸런스 상세 | `docs/design-docs/vision-system.md` |
| 함정 상세 스펙 | `docs/design-docs/traps.md` |
| 아이템 후보/확정 (⚠️ 미확정) | `docs/design-docs/items.md` |

---

## 핵심 규칙

- 코드·변수명: 영어 / 주석·커밋·소통: 한국어
- `main` 직접 푸시 금지 — 반드시 PR (`.claude/settings.json`에 강제, 개인 설정으로 무력화 불가)
- 담당 영역 침범은 허용하되, PR에 해당 영역 담당자를 리뷰어로 포함 (`docs/team-roles.md` 규칙 5, `CONTRIBUTING.md` 참조)
- 자기 담당 작업을 완료해 커밋/PR을 만들 때는 **같은 커밋/PR에 `docs/wbs.md`의 해당 행 상태도 함께 갱신**한다 (근거 열에 커밋 해시 또는 PR 번호 기재). 개인 `TODO.local.md`는 gitignore 대상이라 팀원 간 공유되지 않으므로, 팀 전체 진행상황의 유일한 기준은 `docs/wbs.md`다
- `PRD-v1.md` 8절(MVP 제외 사항)은 명시적 요청 없이 구현하지 않는다
- Devvit Web 규칙 준수 — `@devvit/public-api`/blocks 코드 사용 금지, `@devvit/web` 전용
