# 보안 정책

이 프로젝트의 보안 원칙과 훅 동작 방식을 설명합니다.

---

## 자동 차단 항목 (pre-bash-guard.sh)

| 패턴 | 이유 |
|------|------|
| `--no-verify` | git 훅 우회 금지 |
| `password=`, `api_key=`, `secret=`, `token=` | 자격증명 직접 노출 금지 |
| `curl ... \| sh` | 원격 스크립트 직접 실행 금지 |
| `git push --force` | 히스토리 강제 덮어쓰기 금지 |
| `rm -rf` | 재귀 강제 삭제 금지 |

---

## 감사 로그 (post-bash-audit.sh)

- 모든 Bash 명령이 `logs/claude-audit.log`에 기록됨
- 형식: `[YYYY-MM-DD HH:MM:SS] <명령어>`
- `logs/`는 `.gitignore` 대상 (보안 정보 포함 가능)

---

## 민감정보 관리 규칙

```
✅ API 키, DB 비밀번호 → .env 파일
✅ .env는 .gitignore에 포함
✅ .env.example로 필요한 변수 목록 관리
✅ CI/CD → 환경변수 주입 (Secrets)

❌ 소스코드에 하드코딩
❌ 커밋 메시지에 포함
❌ 로그에 출력
❌ 공개 채널(Slack, GitHub Issues)에 공유
```

---

## OWASP Top 10 대응

| 취약점 | 대응 방법 |
|--------|-----------|
| Injection | 파라미터화 쿼리, ORM 사용 |
| Broken Authentication | JWT 서명 검증, 토큰 만료 설정 |
| XSS | 출력 이스케이프, CSP 헤더 |
| IDOR | 리소스 소유권 검증 |
| Security Misconfiguration | .env 분리, 기본 설정 변경 |

---

## 보안 검토

```
/security-review
```

Claude Code 내장 보안 리뷰 실행. 릴리즈 전 필수.

---

## 취약점 발견 시

1. `docs/exec-plans/tech-debt-tracker.md`에 `security` 유형으로 기록
2. 우선순위 High 설정
3. 다음 커밋 전 수정
