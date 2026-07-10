// 게임 시작 전 아이템 로드아웃(3종 중 1개) 선택값을 splash.tsx(선택 화면)와 game.tsx(실제
// 지급 로직)가 공유하기 위한 타입/상수. game.tsx가 별도 웹뷰(entrypoint)로 뜨기 때문에 React
// state로는 선택값을 못 넘기고, 같은 origin의 localStorage로 넘긴다(TEMP_MAP/TEMP_ITEMS처럼
// 실제 서버 연동 전 임시 다리 역할) — 이 파일이 그 규격을 양쪽에 동일하게 제공한다.
//
// items.md 2026-07-09 확정: 로드아웃에서 고를 수 있는 건 4종 중 "함정 설치"를 뺀 3종뿐
// (함정 설치는 상시 보유가 아니라 맵에서 랜덤 스폰된 걸 주워야 쓸 수 있음 — 다른 아이템과 동일 방식).
// 함정 탐지기는 아직 서버 API가 없어(game-types.ts의 ItemType은 flashlight/shield뿐) 클라이언트
// 전용 id로 취급한다.
export type LoadoutId = 'trapDetector' | 'shield' | 'flashlight';

export const LOADOUT_STORAGE_KEY = 'maze-footprints:loadout';
