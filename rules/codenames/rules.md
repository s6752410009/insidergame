# สายลับคำใบ้ (Codenames) — rules fidelity

Sources: Codenames rulebook (Vlaada Chvátil, Czech Games Edition), text via
https://rulespal.com/codenames/rulebook · https://officialgamerules.org/game-rules/codenames/

| # | Real rule (rulebook) | Before this pass | Gap | Decision |
|---|---|---|---|---|
| 1 | 25 words; starting team 9 agents, other 8, 7 bystanders, 1 assassin. The key card's lights show who starts. | Same. Starting team random. Only the history said who starts. | Nobody saw who starts. | **Fix (UI)**: opening banner "ทีมX เริ่มก่อน · 9 คำ". |
| 2 | Clue = one word + one number. `0` = no limit on guesses; `unlimited` = no limit. Operatives must always make at least one guess. | 0–9 or ∞; 0/∞ = unlimited; "end turn" needs ≥1 reveal. | None. | Keep (tests added). |
| 3 | Up to number + 1 guesses. The turn ends on a bystander or the other team's agent, or when operatives stop. | Same. | None. | Keep (tests added). |
| 4 | Touching the assassin = that team loses at once. | Same. | None. | Keep. |
| 5 | Revealing the other team's last agent makes them win, even on your turn. | Same (`gift`). | None. | Keep. |
| 6 | Clue can't be a visible word, any form of it, or **part of a compound word on the table** ("horse" while "horseshoe" is uncovered). Covered words are fine. No clues about spelling or position. | Blocked: exact board word, and clue that *contains* a board word. | Compound parts not checked ("รถ" with "รถไฟ" was allowed). | **Fix**: block parts of compound board words. Thai has no spaces, so the word list has a hand-made split table (`COMPOUND_SPLITS`, 203 words). New words fall back to ICU word segmentation (skipped when it cuts loanwords into one-letter scraps). "หมา" with "หมากรุก" and "มา" with "หมา" stay allowed. |
| 7 | Invalid clue: turn ends at once, and the other spymaster may cover one of their own words. "If the opposing spymaster allows it, the clue is valid." | Nothing. Only server blocks. | No way to call out spelling, sound-alike or translation hints. | **Fix + room setting** `codenamesClueFlag` (default **on**): the opposing spymaster taps "🚩 ทักคำใบ้" while the clue is being guessed. The turn ends, and they may cover one of their own words before their next clue (giving the clue = skip the bonus). **Online limit: once per team per game** so strangers can't flag every clue. |
| 8 | Spymasters keep a straight face and say nothing beyond the clue. | Spymasters could type in room chat during play. Operatives never get key colours (server builds per-socket state). | Chat was an extra hint channel. | **Fix**: anyone who sees the key (spymaster, or ex-spymaster after a hand-over) can't send room chat while the game runs (`chatError`). Chat opens again at game end. |
| 9 | 2–3 players (also "larger groups who don't feel like competing"): one team; the other team has no players. Your team goes first. On the enemy's turn the spymaster covers one enemy agent of their choice. Lose on assassin or when all enemy agents are covered. Score = enemy agents left. 3 players can also be 2 spymasters + 1 shared operative. | Needed 4+ players and two full teams. | No game for 2–3. | **Fix**: co-op mode starts automatically when only one team has players (min 2). Shuffle with fewer than 4 people puts everyone on one team. Enemy turn = phase `cover`: the spymaster taps an enemy agent (clue timer applies; timeout or host skip = random cover). Win shows score X/8. Co-op is **not recorded** in win/loss stats. The 2-spymasters + 1 shared operative variant is **not** done (open question). |
| 10 | Sand timer is optional: any player may flip it when someone thinks too long. | Room setting: clue 120 s (default) / 90 / off, guess off (default) / 60 / 90 / 120. Host skip after 60 s when stuck. | Default clue timer is not in the base rules. | **Keep**: online needs an AFK guard. Guess untimed by default, close to the real game. The clue timer also covers the co-op cover phase. |
| 11 | — | End screen 30 s (`finishedReturnMs`), host-only "พาทุกคนกลับห้อง". | — | Preserved. |

## Not checkable automatically (left to the 🚩 flag)
Forms of a word, rhymes or sound-alikes, foreign-language translations, letter count or position hints.

## Open questions for the owner
- Allow more than one 🚩 per team per game? Allow a flag only before the first reveal?
- Should co-op count in stats (games played only? a separate co-op best score)?
- Add the competitive 3-player variant (2 spymasters + 1 shared operative)?
- Should co-op also need fewer than 4 players, or stay open to any size (rulebook allows any size)?
