# Devpost Submission — Footprints of the Maze

> Draft answers for the Reddit "Games with a Hook" Hackathon submission form.
> Source context: `docs/product-specs/PRD-v1.md`, `docs/concept-shortlist.md`

---

## Elevator pitch

A foggy maze where yesterday's footprints and traps decide today's race.
(어제 남겨진 발자국과 함정이 오늘의 경주를 좌우하는 안개 속 미로.)

---

## About the project

### Inspiration

Most Reddit games are solo experiences: you open a post, play, and leave, and nothing you do touches anyone else. That felt like a waste of what makes Reddit Reddit: people drop into the same thread at completely different times, and their traces still matter to whoever shows up next, whether that's a comment, an upvote, or an edit. We wanted a game where that async pattern is the hook, not an afterthought.

We considered a few other concepts too: a daily "verdict" voting game, a community garden, a word-chain relay, and a Hot & Cold guessing game. All of them either leaned on plain Reddit-native features such as votes and comments without adding much of our own, or risked feeling too close to existing subreddit games. The maze idea won because it let us build genuine indirect interaction: you never see another player in real time, but you constantly feel them through the footprints they left and the traps they set.

> (한국어 번역)
> 대부분의 Reddit 게임은 "혼자 들어와서 혼자 풀고 나가는" 구조라, Reddit을 Reddit답게 만드는 특성, 즉 서로 다른 시간에 같은 스레드에 들어온 사람들의 흔적(댓글, 추천, 수정)이 다음 사람에게 의미를 갖는다는 점을 살리지 못한다고 생각했습니다. 저희는 이 비동기적 패턴 자체가 게임의 훅이 되는 게임을 만들고 싶었습니다.
>
> 데일리 판결 투표, 커뮤니티 정원, 끝말잇기 릴레이, Hot & Cold 추측 게임 등 다른 컨셉도 검토했지만, 대부분 Reddit 네이티브 기능(투표/댓글)에만 의존해 저희만의 것을 더하기 어렵거나 기존 서브레딧 게임과 너무 비슷해 보일 위험이 있었습니다. 미로 아이디어가 선택된 이유는 진짜 간접적 상호작용을 만들 수 있었기 때문입니다. 다른 플레이어를 실시간으로 보진 못하지만, 그들이 남긴 발자국과 설치한 함정을 통해 계속 그 존재를 느끼게 됩니다.

### What it does

Maze Footprints is a top-down grid maze covered in fog of war. Your own screen only stays lit where you've personally walked, and that's local, client-side state, not shared with anyone. What is shared is the footprints you leave behind, though only a random subset of the tiles you walked ever get shown to later visitors, so your full path is never fully given away, only soft hints about where it goes.

Scattered across the maze are mystery boxes. You don't know if a box holds a helpful item (flashlight, shield, trap detector, or trap-install) or an environmental trap (slide, respawn, blind, or reverse) until the moment you step on it. Players can also actively install traps of their own, and anyone who isn't the installer can trigger them. Once fog reveals the tile, a trap's position is always visible as an unmarked box indistinguishable from an unopened mystery box, and a trap detector item lets you scan the tiles around you to briefly reveal what type each nearby trap actually is. Before each run, players also pick one item as a starting loadout.

Clearing the maze is scored by step count, where the fewest successful moves wins and clear time is used only as a tiebreaker. The leaderboard, footprints, traps, and mystery box spawns all reset daily at midnight. Which of our two hand-built maps shows up on a given day is picked deterministically from a hash of the date, so the whole community races the same maze on the same day.

> (한국어 번역)
> Maze Footprints는 안개(블라인드)로 덮인 탑다운 그리드 미로 게임입니다. 자기 화면은 본인이 실제로 지나간 칸만 밝아지며, 이는 서버에 저장되지 않는 개인 클라이언트 로컬 상태입니다. 반대로 공유되는 것은 남긴 발자국이지만, 실제로 지나간 칸 중 무작위로 고른 일부만 이후 방문자에게 표시되어 전체 경로가 그대로 드러나지는 않고 길에 대한 은근한 힌트만 남습니다.
>
> 미로 곳곳에는 미스터리 박스가 있어, 밟기 전까지는 유용한 아이템(손전등, 쉴드, 함정 탐지기, 함정 설치)인지 환경 함정(슬라이드, 리스폰, 시야차단, 역방향)인지 알 수 없습니다. 플레이어는 직접 함정을 설치할 수도 있으며, 설치자 본인을 제외한 누구나 밟으면 발동됩니다. 안개가 걷힌 칸이라면 함정의 위치 자체는 항상 보이지만, 미확인 미스터리 박스와 똑같이 생긴 표식이라 구분이 안 되고, 함정 탐지기 아이템을 쓰면 주변 칸의 함정이 실제로 어떤 종류인지 잠깐 드러납니다. 게임 시작 전에는 시작 아이템(로드아웃)을 하나 고를 수 있습니다.
>
> 클리어 기준은 걸음 수(성공 이동 칸 수)이며, 동점일 때만 클리어 시간으로 순위를 가립니다. 리더보드, 발자국, 함정, 미스터리 박스 스폰은 매일 자정 초기화되고, 그날 등장할 맵은 팀이 미리 만든 두 맵 중 날짜 해시로 결정론적으로 선택되어 같은 날엔 모두가 같은 미로를 마주하게 됩니다.

### How we built it

The stack is Devvit Web with React for the splash screen, menu, loadout picker, and leaderboard; Phaser for the actual maze gameplay screen (`game.html`), handling grid movement, fog rendering, and trap and item effects; and Devvit server with Redis for everything that has to be shared, such as footprints, trap boards, mystery box outcomes, and rankings, all reached through tRPC and Hono API routes.

We were a team of three with clearly split ownership across gameplay and Phaser, backend and async data, and UI, content, and integration. We spent the first few days aligning on the shared Redis data schema and `shared/` types together before splitting off, and kept footprint rendering on the client and footprint storage on the server moving in lockstep throughout, since a mismatch between the two breaks the whole hook. Cross-boundary edits were allowed when someone needed to unblock themselves quickly, as long as the area's owner was looped in as a reviewer.

> (한국어 번역)
> 기술 스택은 스플래시, 메뉴, 로드아웃 선택, 리더보드용 Devvit Web과 React, 실제 미로 플레이 화면(`game.html`)을 담당하는 Phaser(그리드 이동, 안개 렌더링, 함정 및 아이템 이펙트), 그리고 발자국, 함정 보드, 미스터리 박스 결과, 랭킹처럼 공유되어야 하는 모든 데이터를 위한 Devvit 서버와 Redis(tRPC, Hono API 경유)입니다.
>
> 3인 팀으로 게임플레이 및 Phaser, 백엔드 및 비동기 데이터, UI·콘텐츠·통합으로 역할을 명확히 나눴지만, 각자 흩어지기 전 초반 며칠은 공유 Redis 데이터 스키마와 `shared/` 타입을 함께 맞추는 데 썼습니다. 이후에도 발자국 렌더링(클라이언트)과 발자국 저장(서버)은 둘이 어긋나면 게임의 핵심 훅 자체가 깨지기 때문에 항상 짝으로 움직였습니다. 담당 영역을 넘어야 급한 문제를 풀 수 있을 땐 침범을 허용하되, 해당 영역 담당자를 반드시 리뷰어로 포함시켰습니다.

### Challenges we ran into

The first challenge was keeping trap information fair to discover without turning the reveal mechanism into a map-scanning oracle. If players could freely query what's near them at any time, they could script a full map reveal. We settled on two separate layers: a trap's position becomes visible to everyone once fog uncovers that tile, shown as the same unmarked box used for mystery boxes, while its actual type stays hidden until someone steps on it or scans it with a trap detector item, and the detector itself is only allowed to scan off an event the server already validates for position, such as a real movement or a real pickup, rather than a free-standing scan endpoint. We arrived at this split only after playtesting exposed real frustration from players getting hit by installed traps whose positions were never shown at all; the design started out with trap positions fully hidden and opened up to always-visible positions, with types still hidden, in response.

The second was a same-day merge collision between two branches that had redesigned the same system differently. One branch reworked random spawns into mystery boxes with a new response contract, while another branch redesigned the map layout with new coordinates. Reconciling meant picking the validated post-redesign coordinates and patching the client to the new contract, verified by the full regression suite before merging.

The third was a TOCTOU race in the trap detector's charge counter, found during our own PR self-review. Two near-simultaneous detector uses could both pass a "do I have a charge" check before either decrement landed, letting one charge power two reveals. We fixed it by making the decrement atomic first and rolling back on failure, with dedicated regression tests that reproduced the race against the old code.

The fourth was fog of war that behaved like a flashlight. The vision radius itself was correct, but distance was computed as straight-line Chebyshev distance, so light leaked through walls into adjacent corridors. Swapping to a wall-aware BFS made the fog respect the maze's actual walls.

The fifth was a leaderboard-forging bug found one day before the deadline. While self-grading against the judging criteria, we noticed the finish-line endpoint never actually validated that a player's reported position matched a real exit tile, meaning a crafted request could claim any step count. Fixing it correctly, and then discovering our first fix accidentally rejected every legitimate finish, was a scramble we caught only because we reviewed our own pull request before merging it.

> (한국어 번역)
> 첫 번째 어려움은 함정 정보를 공정하게 알 수 있도록 하면서도, 그 공개 방식 자체가 맵 전체를 스캔하는 오라클이 되지 않게 만드는 것이었습니다. "내 주변에 뭐가 있나"를 아무 때나 자유롭게 질의할 수 있으면 맵 전체를 스크립트로 훑어볼 수 있게 됩니다. 결국 두 개의 층으로 나눠 해결했습니다 — 함정의 위치는 안개가 걷힌 칸이라면 누구에게나 항상 보이며(미스터리 박스와 똑같이 생긴 미확인 표식으로), 실제 종류는 직접 밟거나 함정 탐지기 아이템으로 스캔하기 전까진 비공개로 남습니다. 탐지기 자체도 별도의 스캔 엔드포인트를 열지 않고, 서버가 이미 위치를 검증하는 이벤트(실제 이동, 실제 픽업)에만 얹어 동작하도록 제한했습니다. 이 구조는 플레이테스트에서 "위치조차 전혀 안 보여준 설치형 함정에 당했다"는 불만이 나온 뒤에야 정해졌습니다 — 원래는 함정 위치까지 완전 비공개였다가, 그 피드백을 반영해 위치는 항상 공개하되 종류만 비공개로 유지하는 지금 구조로 바뀌었습니다.
>
> 두 번째는 같은 날 벌어진, 같은 시스템을 서로 다르게 재설계한 두 브랜치의 병합 충돌이었습니다. 한 브랜치는 랜덤 스폰을 새로운 응답 계약을 가진 미스터리 박스로 재설계했고, 다른 브랜치는 새 좌표로 맵 레이아웃을 다시 짰습니다. 재설계 이후 검증된 좌표를 채택하고 클라이언트를 새 계약에 맞게 수정한 뒤, 전체 회귀 테스트로 확인하고서야 병합할 수 있었습니다.
>
> 세 번째는 함정 탐지기 충전 카운터의 TOCTOU 레이스 컨디션으로, 자체 PR 리뷰 중 발견했습니다. 거의 동시에 두 번 탐지기를 사용하면 차감이 반영되기 전에 둘 다 "충전이 있다" 체크를 통과해 충전 1개로 2번 발동될 수 있었습니다. 차감을 먼저 원자적으로 실행하고 실패 시 롤백하는 방식으로 고쳤고, 기존 코드로 레이스를 실제 재현하는 회귀 테스트를 추가했습니다.
>
> 네 번째는 손전등처럼 동작하던 안개(블라인드) 시야였습니다. 시야 반경 수치 자체는 맞았지만 거리 계산이 직선(체비셰프) 거리라 벽 너머 옆 통로까지 빛이 새어 들어갔습니다. 벽을 반영하는 BFS로 교체해 해결했습니다.
>
> 다섯 번째는 마감 하루 전 발견한 리더보드 위조 버그였습니다. 심사 기준에 맞춰 자체 채점을 하던 중, 골인 엔드포인트가 플레이어가 보고한 위치가 실제 출구 타일인지 전혀 검증하지 않는다는 걸 발견했습니다. 즉 조작된 요청으로 아무 걸음 수나 주장할 수 있었습니다. 이를 제대로 고치는 과정에서 첫 수정이 정상적인 골인을 전부 거부해버리는 회귀를 만들었고, 병합 전 자체 PR 리뷰를 하지 않았다면 그대로 제출될 뻔했습니다.

### Accomplishments that we're proud of

We're proud of building a real, working example of async-first design, where footprints and traps let players who are never online at the same time genuinely affect each other's runs, which is the exact hook we set out to build. We're also proud of the deterministic daily map rotation, a small piece of infrastructure that hashes the KST date to pick between two maps and makes sure the whole subreddit is racing the same maze on the same day, every day. We're proud that we were willing to redesign the trap-detection system several times mid-hackathon based on real playtesting feedback rather than shipping the first version that technically worked. And we're proud of catching a leaderboard-forgery vulnerability the day before submission through our own review process, instead of after launch.

> (한국어 번역)
> 발자국과 함정 덕분에 한 번도 동시 접속한 적 없는 플레이어들이 서로의 플레이에 진짜 영향을 주는, 비동기 우선 설계의 실제 작동 사례를 만들어낸 것이 자랑스럽습니다. 이는 저희가 처음부터 목표했던 바로 그 훅입니다. KST 날짜를 해시해 두 맵 중 하나를 고르는 결정론적 데일리 맵 로테이션 덕분에 서브레딧 전체가 매일 같은 날엔 같은 미로에서 경쟁하게 만든 것도 자랑스럽습니다. 기술적으로 동작하는 첫 버전을 그대로 내놓는 대신, 실제 플레이테스트 피드백을 근거로 해커톤 기간 중 함정 탐지 시스템을 여러 차례 재설계할 만큼 신경 쓴 것도 자랑스럽습니다. 그리고 출시 이후가 아니라 제출 하루 전, 자체 리뷰 과정에서 리더보드 위조 취약점을 잡아낸 것 역시 자랑스럽습니다.

### What we learned

We learned that async social mechanics demand a very deliberate line between shared server state, such as footprints, trap boards, and mystery box outcomes, and personal client state, such as your own fog of war. Blurring that line either breaks privacy expectations or breaks the hook itself. We also learned that letting teammates cross into each other's owned code when blocked, with a mandatory reviewer from that area, kept us moving fast without losing accountability. And we learned that reviewing our own pull requests before merging, rather than relying solely on the other reviewer, caught two of our most serious bugs, the detector race condition and the leaderboard-forgery gap, that automated tests alone hadn't surfaced yet.

> (한국어 번역)
> 비동기 소셜 메커니즘은 공유 서버 상태(발자국, 함정 보드, 미스터리 박스 결과)와 개인 클라이언트 상태(자신의 안개 시야)를 아주 명확히 구분해야 한다는 것을 배웠습니다. 이 경계가 흐려지면 프라이버시 기대가 깨지거나 게임의 훅 자체가 무너집니다. 막혔을 때 다른 사람의 담당 코드를 넘어 수정하는 것을 허용하되 해당 영역 담당자를 리뷰어로 반드시 포함시키는 규칙 덕분에, 책임 소재를 잃지 않으면서도 속도를 낼 수 있었다는 것도 배웠습니다. 그리고 다른 사람의 리뷰에만 기대지 않고 자기 PR을 스스로 다시 리뷰하는 습관이, 자동화된 테스트만으로는 못 잡았을 가장 심각한 버그 두 가지(탐지기 레이스 컨디션, 리더보드 위조 허점)를 잡아냈다는 것도 배웠습니다.

### What's next for Maze Footprints

Next up is a user map editor so players can design and share their own mazes as new posts, which was deliberately scoped out of the MVP and is our top candidate for a post-hackathon stretch. We also want wider playtesting to tune the remaining assumed balance numbers, such as trap detector radius and duration, per-trap install caps, and mystery box outcome odds. Finally, we're interested in exploring lightweight social features, such as inviting a friend or simple team runs, if daily-reset retention data after launch suggests players want more direct connection on top of the async hook.

> (한국어 번역)
> 다음으로는 플레이어가 직접 미로를 디자인해 새 포스트로 공유할 수 있는 유저 맵 에디터를 계획하고 있습니다. MVP 범위에서 의도적으로 제외했으며, 해커톤 이후 가장 먼저 확장하고 싶은 부분입니다. 아직 가정치로 남아있는 밸런스 수치(함정 탐지기 반경 및 지속시간, 함정별 설치 개수 제한, 미스터리 박스 확률)를 더 넓은 플레이테스트로 다듬는 것도 원합니다. 마지막으로, 출시 후 데일리 리셋 리텐션 데이터를 보고 비동기 훅 위에 더 직접적인 연결(친구 초대, 간단한 팀 플레이 등)을 원하는 신호가 있으면 가벼운 소셜 기능도 검토할 계획입니다.

---

## Built with

typescript, react, phaser, devvit, devvit web, reddit, redis, trpc, hono, zod, vite, vitest, tailwindcss, nodejs, eslint, prettier

---

## Did you use Phaser to create your submission?

Yes. Phaser powers the entire maze gameplay screen (`game.html`/`game.tsx`), handling grid movement and tween-based animation, fog-of-war rendering, and every trap and item visual effect.

(한국어 번역)
네. Phaser가 미로 플레이 화면(`game.html`/`game.tsx`) 전체를 담당합니다. 그리드 이동과 트윈 기반 애니메이션, 안개(블라인드) 시야 렌더링, 함정과 아이템의 모든 시각 이펙트를 처리합니다.

---
