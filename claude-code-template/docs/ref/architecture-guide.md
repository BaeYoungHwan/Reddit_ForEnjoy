# 아키텍처 가드 가이드

> `.claude/hooks/architecture-guard.sh` 훅의 동작과 레이어 구조 규칙을 설명합니다.

---

## 레이어 구조

```
[Presentation]   — /api/, /routes/, /controllers/, /handlers/, /views/
      ↓ 허용
[Application]    — /services/, /use-cases/, /application/
      ↓ 허용
[Domain]         — /domain/, /entities/, /models/, /core/
      ↓ 인터페이스 통해서만
[Infrastructure] — /repositories/, /infrastructure/, /adapters/, /db/, /database/
```

### 금지 의존성

| 위반 패턴 | 설명 |
|----------|------|
| Domain → Presentation | Domain이 Controller/View를 직접 참조 |
| Domain → Infrastructure | Domain이 Repository/DB를 직접 참조 (인터페이스 우회) |
| Presentation → Infrastructure | Controller가 DB를 직접 참조 (Service 우회) |

---

## 동작 모드

### 경고 모드 (기본값)

`.claude/hooks-strict.flag` 파일이 없으면 경고 모드:

```
⚠️  [아키텍처 경고] Domain 레이어가 Presentation 레이어를 참조합니다.
   파일: src/domain/user.py (레이어: domain)
   규칙: docs/ref/architecture-guide.md 참조
```

작업은 계속 진행됩니다 (차단 없음).

### 엄격 모드

`.claude/hooks-strict.flag` 파일이 존재하면 엄격 모드:

```
🚫 [아키텍처 차단] Domain 레이어가 Presentation 레이어를 참조합니다.
   파일: src/domain/user.py (레이어: domain)
   엄격 모드: 레이어 위반은 허용되지 않습니다. (.claude/hooks-strict.flag)
```

**파일 저장이 차단됩니다.**

---

## 모드 전환

```bash
# 엄격 모드 활성화 — 2단계 필요

# 1단계: 플래그 파일 생성
touch .claude/hooks-strict.flag

# 2단계: settings.json에서 async 제거 (exit code 반영을 위해 필수)
# .claude/settings.json → architecture-guard.sh 훅 항목 수정
# 변경 전: { "type": "command", "command": "bash .claude/hooks/architecture-guard.sh", "async": true }
# 변경 후: { "type": "command", "command": "bash .claude/hooks/architecture-guard.sh" }
```

> ⚠️  1단계만 하면 플래그 파일은 존재하지만 async 훅은 exit code가 무시되므로 **실제로 저장이 차단되지 않습니다**.
> 2단계(async 제거)까지 완료해야 엄격 모드가 작동합니다.
> `/init-project` SCALE=3 선택 시 두 단계가 자동으로 처리됩니다.

```bash
# 엄격 모드 비활성화

# 1단계: 플래그 파일 제거
rm .claude/hooks-strict.flag

# 2단계: settings.json에서 async 복원 (선택사항 — 경고 모드에선 async여도 동작함)
# { "type": "command", "command": "bash .claude/hooks/architecture-guard.sh", "async": true }

# 현재 모드 확인
test -f .claude/hooks-strict.flag && echo "엄격 모드" || echo "경고 모드"
```

---

## /init-project 연동 (I항목)

`/init-project` SCALE에 따라 자동 설정:

| SCALE | 설정 |
|-------|------|
| 1 (개인) | 경고 모드 (기본값 유지) |
| 2 (스타트업) | 인터뷰 후 선택 |
| 3 (회사) | 자동 엄격 모드 (`hooks-strict.flag` 생성, `async` 제거) |

---

## 감지 예외

- 테스트 파일: `test_`, `_test.`, `.test.`, `spec.`, `/tests/` 경로 → 검사 제외
- 비-소스 파일: `.py`, `.ts`, `.tsx`, `.js`, `.jsx` 이외 → 검사 제외
- 경로 불일치: 레이어 패턴 해당 없으면 검사 건너뜀
