# 아키텍처 레이어

프로젝트의 레이어 구조와 허용/금지 의존성을 정의합니다.

> 이 파일은 템플릿입니다. 프로젝트 시작 후 실제 구조에 맞게 수정하세요.

---

## 표준 레이어 구조

```
┌─────────────────────────────┐
│  Presentation (API / UI)     │  ← 외부 요청 진입점
├─────────────────────────────┤
│  Application (Use Cases)     │  ← 비즈니스 흐름 조율
├─────────────────────────────┤
│  Domain (Core Logic)         │  ← 핵심 비즈니스 규칙
├─────────────────────────────┤
│  Infrastructure (DB / API)   │  ← 외부 시스템 연동
└─────────────────────────────┘
```

---

## 의존성 방향 규칙

**허용**: 위 → 아래 (Presentation → Application → Domain → Infrastructure)

**금지**: 아래 → 위 (Domain이 Presentation을 참조하는 것 등)

```
✅ API 레이어가 UseCase를 호출
✅ UseCase가 Domain 엔티티를 사용
✅ Infrastructure가 Domain 인터페이스를 구현

❌ Domain이 API 응답 형식에 의존
❌ Infrastructure가 Use Case 로직 포함
❌ Presentation이 DB를 직접 조회
```

---

## 레이어별 책임

| 레이어 | 책임 | 금지 사항 |
|--------|------|-----------|
| Presentation | 요청 파싱, 응답 직렬화, 인증 | 비즈니스 로직 포함 |
| Application | 흐름 제어, 트랜잭션 경계 | 외부 시스템 직접 호출 |
| Domain | 엔티티, 규칙, 인터페이스 | 프레임워크 의존 |
| Infrastructure | DB, 외부 API, 메시지큐 | 비즈니스 규칙 포함 |

---

## 프로젝트별 커스터마이즈

아래 섹션을 프로젝트 실제 구조로 대체하세요:

```
src/
├── api/           # Presentation
├── services/      # Application  
├── domain/        # Domain
└── repositories/  # Infrastructure
```

---

## 위반 감지

`architecture-guard.sh` (PostToolUse 훅)가 레이어 경계 위반을 감지합니다.
위반 시 수정 지침과 함께 에러 메시지 출력.
