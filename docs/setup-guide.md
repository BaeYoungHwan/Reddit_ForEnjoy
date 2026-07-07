# 개발 환경 셋업 가이드

> 팀원 3인 공용. 컨셉 확정 전에도 미리 진행 가능한 단계입니다.

## 1. 사전 준비물
- Node.js >= 22.2.0
- Reddit 계정 (개발자 모드 활성화)
- Reddit 테스트용 서브레딧 1개 (팀 공용 dev 서브레딧 권장, 예: `r/<프로젝트명>_dev`)

## 2. Devvit CLI 로그인
```bash
npx devvit login
```
팀원 각자 자신의 Reddit 계정으로 로그인합니다.

## 3. 프로젝트 생성 (컨셉/이름 확정 후)
```bash
npx devvit new <project-name>
```
- 템플릿 선택 시 React 기반(Devvit Web 기본) 또는 Phaser 템플릿 중 선택
- 프로젝트 코드 규칙(폴더 배치, 프론트/백엔드 제약 등)은 `docs/ref/devvit-conventions.md` 참고 — 새 프로젝트 생성 후 동일 규칙을 새 프로젝트의 `AGENTS.md`에도 반영할 것

## 4. 로컬 개발 서버 실행
```bash
npm install
npm run dev      # devvit playtest r/<서브레딧>
```

## 5. 배포/제출 전 체크
```bash
npm run type-check
npm run lint
npm run deploy    # devvit upload
npm run launch    # devvit publish (최종 제출 시)
```

## 6. 참고 문서
- Devvit 공식 문서: https://developers.reddit.com/docs/llms.txt
- 프로젝트 코드 규칙: `docs/ref/devvit-conventions.md`
