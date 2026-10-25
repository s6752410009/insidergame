# Slave staging

Primary local checkout: `/Users/nursego/Developer/insidergame-main`.
Feature branch: `staging-slave`. Production remains on `main`.

## Deployment

- Coolify resource: `insidergame-staging-slave` (`sggzxe4plp6pc5rcsqmtwci4`).
- URL: https://sggzxe4plp6pc5rcsqmtwci4.212.85.24.89.sslip.io/rooms
- Build file: `/Dockerfile.staging`, port 3000, one container.
- Entrypoint: `staging-server.js`. It clears MongoDB settings, disables Google/admin login, and uses isolated JSON files under `/data`. Never copy production database credentials into this app.
- The Coolify project currently groups this staging resource under the existing `production` environment. It is a separate application/container/domain, not the live `insidergame` resource (`om54lzgq0obvujd39rkenkmd`). Always verify the application UUID before deploying.
- Staging data is disposable. Session signing keys regenerate on restart unless `STAGING_SESSION_SECRET` is configured. Use a dedicated persistent volume and stable staging secret if long-lived test accounts are needed.
- Search indexing is blocked with the domain setting and `X-Robots-Tag`.
- Deploy only this resource for staging changes. Never deploy production while people are playing without explicit confirmation.

## Rules in this build

Exactly 4 seats, each gets 13 of the 52 cards; no jokers. Fill any empty seats with bots in the lobby. Ranks: 3 through 2; suits: clubs, diamonds, hearts, spades. The first play must include 3 clubs. Same-rank sets of 1–4 cards beat an equal-size set with a higher rank/suit. A triple may cut a single; a four-of-a-kind may cut a pair. No straights, revolution, or automatic king demotion in this build.

Passing excludes a seat for the rest of the pile. After everyone else passes, the last player to play leads again; if that player has finished, the next unfinished seat leads. Finish positions are King, Queen, Vice-Slave, Slave.

For subsequent rounds, King selects 2 original-hand cards to return for Slave's highest 2; Queen selects 1 original-hand card for Vice-Slave's highest 1. Transfers resolve together; Slave leads. This simultaneous original-hand selection convention is explicit in the table guide.

Turns time out after 30 seconds; exchanges after 60 seconds. Timeouts choose a legal move or pass, or return low cards. Disconnects preserve the seat and allow reconnect; explicit departure ends the table so remaining people can regroup in the lobby.

## Validation

```sh
npm run smoke:slave
npm run smoke:slave:play
npm run smoke:slave:ux
```

Engine tests simulate 300 tables and 900 rounds with card conservation, legal cuts, passing, rankings, tax exchange, serialized state, stale commands, privacy, timeout and departure cases. Integration tests boot an isolated local server and Chromium, test a human with three real runtime bots for two rounds, reject outsiders and excess seats, and inspect 320/390/1280px layouts, reduced motion, legal card selection, focus preservation, sound persistence and reload/reconnect. Undercover regression smoke tests also pass.

## Table UI and audio (2026-10-24)

- `views/slaveBoard.ejs` contains the table markup and safely serialized initial state. `public/css/slave.css` owns the felt table, relative seat placement (you at the bottom), concealed opponent cards, dealing/playing motion and round results. Desktop uses a fanned hand; phones use fully visible cards in rows, including at 320px. Reduced-motion users get immediate state changes.
- `public/js/slaveBoard.js` keeps socket commands server-authoritative. Selection alone does not replace the hand DOM or replay state-change cues. Submit is enabled only for server-provided legal moves or a complete exchange selection. Preserve same-step phase transitions: the final play can finish a round without incrementing `step`.
- `public/js/slaveAudio.js` synthesizes card/deal/pass/turn/countdown/exchange/result sounds and quiet background music with Web Audio. No remote sound files or library dependency. Audio starts only after a gesture; a turn arriving before unlock is retained and played after unlock. Retry resume on subsequent gestures after mobile interruptions. Hidden tabs pause audio/music and rebind current game state on return.
- `slaveSound` is the master sound preference and `slaveMusic` separately controls music; both persist in localStorage with storage-denial fallback. The main sound button displays an unlock action until the context is running, then toggles mute. Enabling sound plays a preview. Do not replace this with a one-shot gesture listener: that caused silent first turns.
- Audio integration checks attach an analyser to the real browser destination and measure nonzero PCM for unlock, sustained music, selection, play, unmute and interrupted-context recovery. They also verify actual silence for music/master mute and suppress duplicate turn cues on selection. The old substring check was invalid: Thai `เปิด` contains `ปิด`, so compare exact labels or `aria-pressed`.
- Chromium PCM confirms signal generation/routing, not a physical speaker's volume or iOS Safari audio-session behavior. Include one real iPhone/Android speaker playtest before promoting to production.

## Guided play and compact screens (2026-10-24)

- `public/js/slaveGuide.js` explains only the legal move arrays supplied by the server. It marks cards that can complete the current selection, names valid submissions (for example `ลงคู่ 5`), distinguishes incomplete sets from illegal selections, and explains the 3♣ opening, mixed ranks, cuts and no-move/pass state. The first opening highlights 3♣ before optional additional 3s. Do not implement a second rules engine or treat guidance as authorization.
- `buildClientState` adds public `openingRequired` and `exchangeProgress: {done,total}`. Progress contains counts only; it must never expose another player's selected returns or hand. Own `exchangeCount` remains authoritative for whether a return selection is required.
- `.sl-screen` contains one turn inside the available dynamic viewport. Rules/history remain below it. Short portrait phones compact the table and use two readable rows of 13 cards; landscape phones place the table beside the hand. The grid hand extends through 820px to avoid the former 701–800px overflow. Preserve at least 44px touch targets and keep the hand, current instruction, timer and play/pass controls visible together.
- Results lead with the current player's rank and the next round's receive/return amounts. Exchange help explains original-hand selection to King/Queen and automatic tribute to Vice-Slave/Slave. Submitted players see a waiting message and progress; controls that cannot apply are hidden. This does not add a ready-state protocol: the host starts the next round when friends are ready.
- `smoke:slave:ux` renders the actual EJS/CSS/client with deterministic engine-generated fixtures. It verifies guide agreement through a full engine round, opening/pair/triple-cut/no-move selection, same-step round endings, all four rank consequences, exchange submission/privacy, and no-scroll turn geometry with 44px targets across 13 portrait/landscape viewports. The socket is a fixture; keep `smoke:slave:play` for real server/bot/audio coverage and real-font short-screen checks.

Staging does not yet write Slave win/loss records to the global leaderboard. Add scoring and optional house-rule switches after playtesting this ruleset.

## Illustrated game skin (2026-10-24)

`public/css/slave-game.css` adds the warm wood/emerald cloth theme, character frames, countdown rings, raised action controls and medal-style results over the existing responsive layout. The local portrait atlas and exact generation prompt are documented in [slave-art.md](slave-art.md). Keep the art local; never depend on a Codex generated-images path at runtime. Cached seat rendering prevents selection clicks from restarting portrait animations or replacing countdown elements. The UX fixtures also verify image decoding, preserved custom avatars and reduced motion, alongside the existing 13 viewport and gameplay checks.

Rule references: https://thaiplayingcard.com/how-to-play-8/ and https://dronkapp.com/th/slave-card-game/ . House rules differ between sources; the table guide documents the exact implemented behavior.

## Rank insignia and opponent hands (2026-10-24)

- `slaveBoard.js` owns code-native SVG insignia: King crown, Queen tiara, commoner portrait for rank 3 (รองสลาฟ), and Slave cuffs. Rank 3 retains its existing one-card exchange; the art does not change the rules. First-round seats stay unranked until a result/title is available. Assigned insignia persist beside avatars while the status text shows turn/pass/exchange. The result headline uses the local player's actual rank emblem.
- Each opponent has exactly one decorative card back per public `count` (0–13), plus the numeric badge. Zero clears the fan and shows หมดมือ. No opponent card identities or faces enter this markup. The top seat places its hand beside the avatar/name so short portrait and landscape screens can keep it visible. Do not restore the old max-eight cap or hide `.sl-backs` in compact media queries.
- The v5 game skin overrides the legacy top-seat/short-screen hiding rules. Keep skin and client cache queries in `slaveBoard.ejs` in sync when changing them.
- `smoke:slave:ux` now checks all three visible opponent hands across 13 viewports, exact 13/7/1/0 card counts, no private face markup, unique SVGs for all four ranks, assigned/first-round roles, correct personal result insignia, award bounds, and prior game controls/selection checks (3,899 assertions at this change). `smoke:slave:play` remains the real socket/bot/audio integration check.

## Chat, return to lobby and `/m` tools (2026-10-24)

- `public/js/slaveTools.js` owns native dialogs for room chat/exit confirmation and the inline live staging debug strip. `slaveBoard.js` shares its existing socket with these tools; do not open a second socket. Room chat uses `sendMessage`, `newMessage`, `chatHistory` and `requestChatHistory`, retains at most 100 visible messages, renders server-escaped text as text (never live message HTML), and clears the unread badge when opened. `/m` is intercepted locally and never sent to room chat.
- The former plain `/room/:id` link bounced into `/game/:id` while a round was active. The explicit ออกจากเกม button now confirms the consequence first. Hosts use the existing `endTableSession` flow to reset the table and return everyone to the same lobby. Non-hosts use authenticated `slave_returnLobby`, which finishes the four-player round, clears its timers and keeps their room membership before navigating to the same lobby. Other players see the stopped table and can return; nobody is silently removed from the room. Cancel leaves the game untouched. Never replace this with a raw lobby link or `leaveRoom` (which goes to the room list and blocks immediate rejoin).
- `/m` is server-gated to `APP_ENV=staging` AND a current room member who is host/site admin. The shortcut and boot flag are convenience only; spoofing them cannot authorize the socket. Inspection returns all hands only in that caller's acknowledgement. Never add private debug hands to `slaveState` or `roomUpdate`. Production refuses inspection and mutations, even for a host.
- `games/slaveDebug.js` drives the existing legal engine for current-turn auto play, finishing a round, completing exchange, next round, and confirmed redeal to round one. It retains all 52 unique cards, rejects stale steps and preserves monotonic steps after redeal. Mutation sets a public `debugUsed` marker; debug operations log privately to admin logs. No user-facing update announcement/version bump is needed. Sound preview buttons remain local.
- `npm run smoke:slave:tools` checks engine invariants, real two-human room chat/history/unread/XSS, private slash command, all debug actions, redeal confirmation, non-host and host return to the same lobby, staging authorization and production rejection. Keep `smoke:slave:ux` (13 viewports, dialogs and reachable tool buttons) and `smoke:slave:play` (real bots/audio) as complementary checks.

## Live `/m` inspection UX (2026-10-24)

- `/m` now toggles `#slDebugDock`, a single compact strip in `.sl-screen` normal flow. It is an aside, never a modal, never sets the board inert, and has no backdrop. Commands scroll horizontally on narrow screens. The minus button folds tools without disabling inspection; the header `/m · ดูไพ่` button reopens them. Keep gameplay controls available while the strip is open.
- Opening หน้าไพ่ renders authorized private faces into each opponent's `.sl-backs.is-revealed` at their existing `data-player-id` seat. The local hand remains the normal selectable hand. Desktop/landscape retain table positions; portrait phones through 480px use three compact seat rows with the pile below. All 13 opponent cards are visible without opening a separate list.
- Private snapshots still come only from `slave_debug` acknowledgements after existing server-side staging/member/host checks. Refresh on phase+step changes even when tools are folded. A final round state can reuse the prior step, so comparing only step leaves stale cards. Ignore stale acknowledgements; never put debug hands into public room/state broadcasts or browser storage. Unchecking inspection restores current backs immediately. Disconnect/offline clears cached faces; reconnect/online fetches a fresh snapshot.
- `smoke:slave:ux` tests no modal/backdrop, selecting legal cards with tools open, every revealed card within 13 viewports, folded live count updates, and immediate restoration of backs. `smoke:slave:tools` tests an actual human play/pass with the strip open, live opponent updates while folded, offline clearing/reconnect, alongside prior chat/exit and authorization coverage.

## Playing-area UX and turn clarity (2026-10-25)

- The UX section at the end of `public/css/slave-game.css` keeps arena and hand tray in a single centered group, with a small explicit gap instead of the former independent auto margins. Desktop uses a wider table and larger own/opponent cards; 821–1100px has its own fan size to prevent overflow. The green tray and quieter background/rims put the cards and turn state first.
- Player plaques now place names above status/count rows, with inline card counts instead of badges overlapping names. Names are at least 15px on desktop and 10px in ordinary compact layouts. Phone debug rows allocate wider names while preserving all 13 revealed cards and the original privacy behavior.
- `tick()` updates `.sl-seat-clock` at the current opponent's seat without replacing seat/hand DOM. Own hand time says เหลือ N วิ; waiting time says ตานี้ N วิ; submitted exchange says แลกไพ่ N วิ. Only an active human's own final five seconds set `.sl-status-row.is-urgent` and play the warning cue. Opponent urgency stays at their seat. Expired clocks say รอระบบ; untimed phases do not pretend to have a countdown.
- During exchange, the decorative empty pile is hidden so the public exchange progress caption and timer have room on short phones. The return selection still uses only server-provided exchangeCount and legal commands.
- `smoke:slave:ux` now covers 14 viewports including 2137×1011, table/tray proximity, minimum name typography, unclipped status/help/captions, pointer hit tests on enabled actions with `/m` open, and deterministic own/opponent/untimed five-second clock states. Real bot/audio and real-font checks remain in `smoke:slave:play`; chat/exit/private debug coverage remains in `smoke:slave:tools`.

## Automatic in-hand guidance (2026-10-25)

- The separate `slHint` / เลือกชุดที่ลงได้ button and its automatic selection handler are removed. On an active connected turn, server-authorized candidate cards show a green border and ↑ marker. Selected cards stay gold with ✓; incompatible cards dim. Waiting, pending commands and disconnects show no candidate arrows. Guidance never selects or submits a move automatically.
- `slaveGuide.analyze` filters legal-move supersets after each selection. Partial pairs/triples/quad cuts highlight compatible continuations and state how many cards remain; complete selections name the set on the submit button. Mixed ranks, weaker sets and stale cards remain unsubmitable with a concrete correction. An opening 3♦ can be repaired by adding required 3♣, rather than clearing it unnecessarily.
- King/Queen exchange uses the same guide to show eligible original-hand returns and progress. Once the required count is reached, extra cards lose their arrows; undoing a selected card restores eligibility. Pass is hidden while choosing returns. The primary confirm remains a separate explicit action.
- `slaveBoard.js` updates classes/markers and ARIA labels in place, preserving keyboard focus and existing hand DOM. Selected cards retain the natural fan layer so they do not cover the next candidate’s rank/suit. Candidate arrows are non-interactive and hidden from accessibility APIs; the hand references its live instruction. Compact screens keep one row of play/pass/clear actions, with a labeled 44px clear icon. Preserve these semantics when changing the art or UI.
- Focused engine-derived guide checks cover fresh piles, opening repair, mixed/stale selection, suit ties, triple/quad cuts and unavailable moves. Browser fixtures test the actual in-hand selection flow across 14 viewports; real server smoke tests now follow highlighted cards instead of using a client auto-select shortcut.

## Private `/m` entry (2026-10-25)

- Every page load starts with both the `/m` header control and dock hidden. Only an authorized staging host/site admin typing `/m` in their room chat unlocks the inline dock and its header toggle for that page. Folding keeps the toggle available; reloading resets it. There is no localStorage unlock or `/m` hint in ordinary chat copy.
- The command is intercepted locally and never broadcast as chat. Unauthorized users stay in chat with a private error and no tool panel or inspection request. Server authorization still independently requires staging, current membership, and host/site-admin identity; hiding UI is not an access control. Other users do not see the caller's menu or inspected private cards. Debug mutations still affect the shared test table and preserve its public debug-used marker.
