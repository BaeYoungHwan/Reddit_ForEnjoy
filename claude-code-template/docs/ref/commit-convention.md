# 커밋 컨벤션

한국어 커밋 메시지 작성 규칙입니다.

---

## 기본 형식

```
<type>: <한국어 설명>

[본문 — 선택, 왜 변경했는지]

[Trailers — 선택]
```

---

## 타입

| 타입 | 설명 |
|------|------|
| `feat` | 새 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 동작 변경 없는 코드 개선 |
| `docs` | 문서 변경 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, 설정, 의존성 변경 |
| `perf` | 성능 개선 |
| `style` | 포맷팅, 세미콜론 등 (기능 변경 없음) |

---

## Trailers 패턴

작업의 맥락과 의사결정을 기록합니다. Claude가 커밋할 때 적극 활용합니다.

| Trailer | 용도 | 예시 |
|---------|------|------|
| `Constraint:` | 왜 이 방식을 선택했는지 (제약) | `Constraint: ORM 미사용 — 성능 요건` |
| `Rejected:` | 검토했지만 채택하지 않은 대안 | `Rejected: Redis 캐싱 — 인프라 복잡도 증가` |
| `Directive:` | 사용자 명시 지시 | `Directive: 소셜 로그인 제외 (MVP 범위)` |
| `Confidence:` | 구현 확신도 | `Confidence: high / medium / low` |
| `Scope-risk:` | 영향 범위 위험도 | `Scope-risk: auth 미들웨어 전체 영향` |
| `Not-done:` | 의도적으로 구현하지 않은 것 | `Not-done: 이메일 알림 (MVP 제외)` |

---

## 예시

```
feat: JWT 로그인 API 구현

액세스 토큰(1h) + 리프레시 토큰(7d) 발급.
비밀번호는 bcrypt(rounds=12)로 해시.

Constraint: 세션 방식 미채택 — 수평 확장 대응
Rejected: OAuth2 패스워드 플로우 — 보안 취약점
Not-done: 소셜 로그인 (MVP 제외 사항)
Confidence: high
```

```
fix: 토큰 만료 시 무한 루프 수정

리프레시 요청 실패 시 재귀 호출이 발생하는 문제.
axios 인터셉터에서 재시도 횟수 제한(max 1회) 추가.

Scope-risk: 인증 흐름 전체에 영향
Confidence: medium
```

---

## `/commit` 스킬 사용

```
/commit
```

Claude가 변경사항을 분석해서 위 컨벤션에 맞는 커밋 메시지를 자동 생성합니다.
