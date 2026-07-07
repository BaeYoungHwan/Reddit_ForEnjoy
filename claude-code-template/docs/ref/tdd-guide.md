# TDD 가이드

> `.claude/hooks/tdd-enforcer.sh` 훅의 동작을 설명합니다.

---

## 동작 방식

### 일반 모드 (기본값)

`hooks-strict.flag` 없을 때:

- 신규 파일 생성 시: 테스트 파일 없으면 차단
- 기존 파일 수정 시: 체크 없음

### 엄격 모드

`hooks-strict.flag` 있을 때:

- 신규 파일 생성 시: 테스트 파일 없으면 차단
- 기존 파일 수정 시: 테스트 파일 없으면 차단

---

## 테스트 파일 경로 규칙

| 언어 | 구현 파일 예 | 예상 테스트 경로 |
|------|------------|----------------|
| Python | src/services/user.py | tests/test_user.py 또는 src/services/test_user.py |
| TypeScript | src/services/user.ts | src/services/user.test.ts 또는 \_\_tests\_\_/user.test.ts |
| JavaScript | src/utils/format.js | src/utils/format.test.js |
| Go | pkg/auth/handler.go | pkg/auth/handler_test.go |
| Rust | src/auth.rs | src/auth_test.rs 또는 tests/auth.rs |

---

## 모드 전환

### 엄격 모드 활성화

```bash
touch .claude/hooks-strict.flag
```

### 엄격 모드 비활성화

```bash
rm .claude/hooks-strict.flag
```

### 훅 완전 비활성화

`settings.json`에서 tdd-enforcer.sh 항목 제거:

```json
// PreToolUse > Write|Edit 아래의 아래 항목 삭제
{ "type": "command", "command": "bash .claude/hooks/tdd-enforcer.sh" }
```

---

## /init-project 연동

| SCALE | 동작 |
|-------|------|
| 1 (개인) | 일반 모드 (신규 파일만 체크) |
| 2 (스타트업) | 인터뷰 후 선택 (Y → hooks-strict.flag 생성) |
| 3 (회사) | 자동 엄격 모드 (hooks-strict.flag 자동 생성) |

---

## 검사 예외

- 테스트 파일 자체: `test_`, `_test.`, `.test.`, `spec.`, `/tests/` 경로 → 제외
- 설정/문서/마이그레이션 파일: `.md`, `.json`, `.yaml`, `.toml` 등 → 제외
- 훅/커맨드 파일: `.claude/hooks/`, `.claude/commands/` → 제외
