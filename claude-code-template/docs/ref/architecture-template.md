# 아키텍처 문서 템플릿

새 프로젝트의 아키텍처를 문서화할 때 사용합니다.

---

# [프로젝트명] 아키텍처

> 작성일: YYYY-MM-DD | 버전: v1

## 1. 시스템 개요

[시스템이 무엇을 하는지 한 단락으로]

## 2. 컴포넌트 다이어그램

```
[외부 사용자]
    │
    ▼
[API Gateway / Nginx]
    │
    ├──▶ [Auth Service]
    │
    ├──▶ [Core Service]
    │         │
    │         ├──▶ [PostgreSQL]
    │         └──▶ [Redis Cache]
    │
    └──▶ [Worker Service]
              │
              └──▶ [Message Queue]
```

## 3. 레이어 구조

자세한 규칙 → [`docs/design-docs/architecture-layers.md`](../design-docs/architecture-layers.md)

```
src/
├── api/           # Presentation — 라우터, 미들웨어, 직렬화
├── services/      # Application — 유즈케이스, 트랜잭션
├── domain/        # Domain — 엔티티, 규칙, 인터페이스
├── repositories/  # Infrastructure — DB, 외부 API
└── core/          # 공통 유틸, 설정, 예외
```

## 4. 데이터 흐름

```
Request → API Layer → Service Layer → Domain → Repository → DB
Response ← API Layer ← Service Layer ← Domain ← Repository ←
```

## 5. 주요 설계 결정

| 결정 | 선택 | 이유 | ADR |
|------|------|------|-----|
| ORM | SQLAlchemy | 타입 안전성, 마이그레이션 | [ADR-001] |
| 인증 | JWT | 무상태, 수평 확장 | [ADR-002] |

## 6. 비기능 요건

| 항목 | 목표 |
|------|------|
| 응답시간 | p95 < 200ms |
| 가용성 | 99.9% |
| 처리량 | 1000 RPS |

## 7. 보안 고려사항

- [인증/인가 방식]
- [데이터 암호화]
- [API 보안]

## 8. 확장 전략

[수평/수직 확장 계획]
