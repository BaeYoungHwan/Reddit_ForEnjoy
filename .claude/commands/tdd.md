# /tdd — TDD 사이클 가이드

Red → Green → Refactor 사이클을 안내합니다.

## TDD 사이클

### 1. Red — 실패하는 테스트 먼저

구현 전에 테스트를 작성합니다:

1. 구현할 기능의 인터페이스(함수 시그니처, 입출력) 결정
2. 테스트 파일 작성 (`tests/` 또는 `__tests__/`)
3. 테스트 실행 → **실패 확인** (이게 정상)

### 2. Green — 최소한의 구현으로 통과

1. 테스트를 통과시키는 **최소** 코드만 작성
2. "작동하기만 하면 됨" — 품질은 나중에
3. 테스트 실행 → **통과 확인**

### 3. Refactor — 정리

1. 중복 제거, 명명 개선, 구조 정리
2. 테스트가 여전히 통과하는지 확인
3. `pass^3` 확인 — 3회 연속 통과로 안정성 검증 (`docs/ref/testing-patterns.md` 참조)
4. `/commit` 실행

## 실전 체크리스트

```
[ ] 테스트 파일 먼저 생성 (tdd-enforcer.sh가 강제함)
[ ] 실패하는 테스트 실행 확인
[ ] 구현 후 통과 확인
[ ] 리팩터링 후 pass^3 확인 (3회 연속 통과)
[ ] /commit 실행
```

## 테스트 파일 위치 규칙

```
src/user/service.py → tests/user/test_service.py
src/api/routes.py → tests/api/test_routes.py
```

## 경계값 테스트

- 정상 케이스 1개
- 엣지 케이스 (빈값, 최대값, 특수문자)
- 에러 케이스 (잘못된 입력, 권한 없음)

## 주의사항

- DB는 Mock 금지 — 테스트 DB 사용
- 비결정적 로직은 `pass@k` 전략 사용 (`docs/ref/testing-patterns.md`)
- `tdd-enforcer.sh`가 테스트 없는 구현 파일 작성을 차단함
