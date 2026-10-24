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

Rule references: https://thaiplayingcard.com/how-to-play-8/ and https://dronkapp.com/th/slave-card-game/ . House rules differ between sources; the table guide documents the exact implemented behavior.
