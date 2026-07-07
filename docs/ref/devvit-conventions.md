# Devvit Web 개발 규칙

> `hellowordlgg`(튜토리얼 참고용 프로젝트) 삭제 전 `AGENTS.md`에서 보존한 규칙.
> 실제 프로젝트(P0: Devvit 프로젝트 생성) 착수 시 새 프로젝트의 `AGENTS.md`에도 동일하게 반영할 것.

## 기술 스택 (튜토리얼 기준, 본 프로젝트는 여기에 Phaser 추가)
- Frontend: React 19, Tailwind CSS 4, Vite
- Backend: Node.js v22 서버리스 환경(Devvit), Hono, tRPC
- 통신: tRPC v11로 클라이언트-서버 타입 안전성 확보

## 레이아웃 / 아키텍처
- `/src/server`: 백엔드 코드. 보안 서버리스 환경에서 실행.
  - `trpc.ts`: API 라우터/프로시저 정의
  - `index.ts`: 메인 서버 엔트리포인트 (Hono 앱)
  - `redis`, `reddit`, `context`는 `@devvit/web/server`를 통해 접근
- `/src/client`: 프론트엔드 코드. reddit.com의 iFrame 내에서 실행.
  - 엔트리포인트 추가 시 HTML 파일 생성 + `devvit.json`에 매핑 필요
  - `game.html`: 메인 React 엔트리(Expanded View, 본 프로젝트는 Phaser 게임 화면)
  - `splash.html`: 초기 React 엔트리(Inline View, 피드에 노출됨) — 가볍게 유지, 무거운 의존성은 `game.html`에만
- `/src/shared`: 클라이언트-서버 공유 코드

## 프론트엔드 규칙
- `window.location`/`window.assign` 대신 `@devvit/web/client`의 `navigateTo` 사용

## 제약사항
- `window.alert` 사용 불가 → `@devvit/web/client`의 `showToast`/`showForm` 사용
- 파일 다운로드 불가 → 클립보드 API + `showToast`로 확인
- geolocation/카메라/마이크/notifications 웹 API 대안 없음(사용 불가)
- HTML 파일 내 인라인 `<script>` 태그 불가 → 별도 js/ts 파일 분리

## 커맨드
- `npm run type-check`: TypeScript 타입 체크
- `npm run lint`: 린트 체크
- `npm run test -- <파일명>`: 특정 파일만 테스트

## 코드 스타일
- TypeScript에서 interface보다 type alias 선호
- default export보다 named export 선호
- 타입 캐스팅(`as`) 금지

## 전역 규칙
- `@devvit/public-api`나 blocks 관련 코드 참고 금지 — 본 프로젝트는 **Devvit Web 전용**으로 구성됨
- 새 메뉴 아이템에 엔드포인트를 추가할 때는 반드시 `devvit.json`에도 대응 매핑을 등록할 것

Docs: https://developers.reddit.com/docs/llms.txt
