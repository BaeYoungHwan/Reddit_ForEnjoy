# 코드베이스 일관성 황금 원칙

이 원칙을 지키면 AI가 코드를 수정해도 일관성이 유지됩니다.

---

## 원칙 목록

### 1. 하나의 진실 원천 (Single Source of Truth)
- 설정값은 한 곳에만 정의
- `.env`로 관리, 코드에 하드코딩 금지
- 동일 로직의 중복 구현 금지

### 2. 레이어 경계 준수
- 레이어 간 의존성 방향을 반드시 지킬 것
- 자세한 규칙 → [`architecture-layers.md`](architecture-layers.md)
- 위반 시 `architecture-guard.sh` 훅이 경고 출력 (차단하지 않음)

### 3. 명명 일관성
- 변수명, 함수명, 파일명: 영어 (camelCase / snake_case / kebab-case 프로젝트별 통일)
- DB 컬럼명: snake_case
- 약어 사용 시 팀 전체 동의 필요

### 4. 에러 처리 일관성
- 에러 메시지 형식 통일 (예: `{"error": "...", "code": "..."}`)
- 예외를 무시하는 빈 catch 블록 금지
- 에러 로깅은 지정된 로거만 사용

### 5. 테스트 커버리지 유지
- 새 기능 추가 시 테스트 파일 동반
- `tdd-enforcer.sh`가 테스트 없는 구현 차단
- 테스트 없이 구현하면 `Not-done:` Trailer에 명시

### 6. 문서와 코드의 동기화
- 함수 시그니처 변경 시 관련 문서 업데이트
- `doc-gardener` 에이전트가 불일치 감지 → `tech-debt-tracker.md` 기록

### 7. 의존성 최소화
- 새 라이브러리 도입 시 ADR 작성
- 유사 기능 라이브러리 중복 사용 금지
- 외부 API 의존은 추상화 레이어로 격리

---

## 위반 시 처리

1. `architecture-guard.sh` 또는 `tdd-enforcer.sh`가 차단
2. 차단 메시지에 수정 지침 포함
3. 에이전트가 지침을 읽고 자가수정
