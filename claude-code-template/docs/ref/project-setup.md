# 프로젝트 시작 가이드

이 템플릿을 새 프로젝트에 적용하는 방법을 설명합니다.

---

## 1. 템플릿 복사

```bash
# 새 프로젝트 폴더에 템플릿 복사
cp -r claude-code-template/ my-new-project/
cd my-new-project/
git init
```

## 2. global-setup 설치 (최초 1회)

```bash
# PC 토스트 알림 등 전역 훅 설치
cd global-setup/
# 설치 방법은 global-setup/README.md 참조
```

## 3. /init-project 실행

Claude Code를 열고 다음을 입력합니다:

```
/init-project
```

Claude가 양식을 출력합니다. **양식을 직접 작성해서 붙여넣으세요.**

---

## 양식 항목 설명

### 1. 프로젝트명
- 영문 소문자, 하이픈 구분 권장
- 예) `my-saas-app`, `data-pipeline-v2`

### 2. 기술 스택
- 언어, 프레임워크, DB, 인프라를 구체적으로 작성
- 버전까지 명시하면 Claude가 정확한 코드를 생성합니다
- 예) `Python 3.12 + FastAPI + PostgreSQL 16 + React 18 + Docker`

### 3. MVP 핵심 기능
- 이번 버전에서 **반드시** 구현할 기능 목록
- 기능 단위로 작성 (너무 세분화하지 않아도 됨)
- 예) "사용자 로그인", "대시보드 조회", "CSV 업로드"

### 4. MVP 제외 사항 ⚠️ 중요
> **MVP 제외 사항이란?**
> Claude(AI)가 "있으면 좋겠다"고 판단해서 **알아서 추가 구현하는 것을 막는 범위 선언**입니다.
>
> AI는 종종 요청하지 않은 기능(소셜 로그인, 이메일 알림, 국제화 등)을 추가합니다.
> 제외 사항을 명시하면 "이건 나중에 할 것이니 지금은 구현하지 마라"는 명확한 지시가 됩니다.

- 예) 소셜 로그인, 이메일 알림, i18n, 관리자 페이지, 결제 연동

### 5. 제약사항 / 특이사항
- 기술적 제약, 클라이언트 요구사항, 보안 요건 등
- 예) "외부 API 의존 최소화", "SSR 금지", "온프레미스 배포"

---

## 4. 작업 시작

`/init-project` 완료 후:

1. `docs/product-specs/PRD-v1.md` 확인
2. Plan 모드로 Phase 분할
3. `docs/exec-plans/active/`에 실행 계획 생성
4. `docs/ref/todo-workflow.md` 참조하여 작업 진행

---

## 체크리스트

- [ ] 템플릿 복사 완료
- [ ] `global-setup/` 설치 완료
- [ ] `/init-project` 실행 및 양식 작성
- [ ] PRD 초안 확인 (`docs/product-specs/PRD-v1.md`)
- [ ] 실행 계획 생성 (`docs/exec-plans/active/`)
- [ ] `.env` 파일 생성 (`.env.example` 참조)
- [ ] `.gitignore`에 `logs/`, `.env` 확인
