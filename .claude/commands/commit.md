# /commit — 커밋 자동화

변경사항을 분석해서 한국어 커밋 메시지를 생성하고 커밋합니다.

## 실행 절차

1. `git status`와 `git diff --staged` 실행해서 변경사항 파악
2. `docs/ref/commit-convention.md` 규칙에 따라 메시지 초안 작성
3. 사용자에게 메시지 확인 요청
4. 승인 시 커밋 실행

## 커밋 메시지 규칙

- 타입: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`
- 설명: 한국어, 명확하게
- 필요 시 Trailers 추가:
  - `Constraint:` — 이 방식을 선택한 제약
  - `Rejected:` — 검토했지만 채택 안 한 대안
  - `Directive:` — 사용자 명시 지시
  - `Not-done:` — 의도적으로 구현하지 않은 것
  - `Confidence:` — 확신도 (high/medium/low)
  - `Scope-risk:` — 영향 범위 위험도

## 예시

```
feat: JWT 로그인 API 구현

액세스 토큰(1h) + 리프레시 토큰(7d) 발급.

Constraint: 세션 방식 미채택 — 수평 확장 대응
Not-done: 소셜 로그인 (MVP 제외)
Confidence: high

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

## 주의사항

- `.env` 파일, 자격증명은 절대 커밋하지 않음
- 스테이징되지 않은 파일은 목록 보여주고 포함 여부 확인
- `logs/` 디렉토리는 커밋 제외
