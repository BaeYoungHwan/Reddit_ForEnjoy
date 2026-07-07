# Spec-driven 개발 워크플로우

기획 → AI 검토 → Phase 분할 → 실행 → 하네스 고도화의 순환 구조입니다.

---

## 전체 순환

```
┌─────────────┐
│   기획      │ ← /deep-interview 또는 /init-project
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  AI 검토    │ ← Claude가 PRD 검토, 누락/모순 지적
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Phase 분할  │ ← Plan 모드(Opus)로 실행 계획 작성
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   실행      │ ← 에이전트 병렬 실행 또는 순차 실행
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  가비지     │ ← 드리프트 검사 → 품질 등급 → 리팩터링
│  컬렉션     │
└──────┬──────┘
       │
       └──────────────────────────────────────────────┐
                                                      │
                                             다음 Phase 또는
                                             하네스 고도화
```

---

## 단계별 상세

### 1. 기획

- `/init-project` — 새 프로젝트 시작
- `/deep-interview` — 막연한 아이디어 → 명확한 Spec
- 산출물: `docs/product-specs/PRD-v1.md`

### 2. AI 검토

Claude가 PRD를 읽고 검토:
- MVP 제외 사항 누락 여부
- 모호한 요구사항
- 기술 선택 리스크
- Phase 분할 제안

### 3. Phase 분할

Plan 모드(Opus)로:
- 독립적으로 분리 가능한 작업 단위로 분할
- `docs/exec-plans/active/phase-N-이름.md` 생성
- 에이전트로 병렬 처리 가능한 작업 식별

### 4. 실행

- TDD 사이클 (`/tdd`)
- 에이전트 병렬 실행 (독립 서브태스크)
- `executor.py`로 자동 순차 실행 (P3)
- 진행 상태: `[ ]` → `[🔄]` → `[x]`

### 5. 가비지 컬렉션

Phase 완료 후:
1. **드리프트 검사**: `doc-gardener` 에이전트 실행 → 문서 불일치 감지
2. **품질 등급 업데이트**: `docs/QUALITY_SCORE.md` 갱신
3. **기술 부채 처리**: `docs/exec-plans/tech-debt-tracker.md` 검토
4. **리팩터링**: 드리프트/부채 해소 후 다음 Phase

---

## executor.py 사용 (P3)

```bash
python executor.py --plan docs/exec-plans/active/phase-1-auth.md
```

- 각 Phase 항목을 `claude -p` 헤드리스 모드로 순차 실행
- 상태: pending → running → done/failed
- 실패 시 해당 항목만 재실행

---

## MVP 과잉 구현 방지

PRD의 "MVP 제외 사항"을 Claude가 읽으면:
- `/init-project` 완료 후 자동 인식
- `Directive:` Trailer로 커밋에 명시
- `architecture-guard.sh`가 레이어 의존성 위반 감지 (경고)
