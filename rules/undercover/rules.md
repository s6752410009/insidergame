# Undercover (คำใครไม่เหมือน) — กติกาจริง vs ของเรา

Sources
- Yanstar Studio, *Undercover — Game Rules*: https://www.yanstarstudio.com/undercover-how-to-play
- Yanstar Studio, *Undercover — FAQ and tips*: https://www.yanstarstudio.com/undercover-faq
- App store listing (3–20 players, app suggests role counts): https://apps.apple.com/app/id946882449
- 谁是卧底 house rules (tie = tied players describe again, the others re-vote; common counts 4–6 → 1 spy, 7–9 → 2, 10+ → 3)

## Real rules (Yanstar app)
- Civilians share one word, Undercover(s) get a similar word, Mr. White gets no word. Nobody but Mr. White knows their side.
- 3–20 players. The app suggests how many of each role; the host can change them.
- Each round: a random player starts, everyone gives one short description in turn (Mr. White improvises), discuss, then everyone votes. Most votes is out, and the app shows the role of the player who is out.
- Mr. White voted out → one guess at the civilian word. Right = Mr. White wins straight away (alone).
- Civilians win when every Undercover and Mr. White is out.
- Undercover + Mr. White win together when they survive until only 1 civilian is left.
- Ties: the FAQ gives 3 options — rock-paper-scissors, *voted players give 1 more description each and the remaining players re-vote*, or the Goddess of Justice role.
- Points: Civilian 2 · Mr. White 6 · Undercover 10 (for the winning side).

## Gap table

| Rule | Real | Ours before | Decision |
|---|---|---|---|
| Player count | 3–20 | 4–10 | **Fix**: 3–10 (10 = room cap the site uses) |
| Undercover count | app suggests by size, host can change | fixed: 1, or 2 at 7+ | **Setting** `undercoverCount` = `auto` (default) / 1 / 2 / 3. Auto: 3–6 → 1 · 7–9 → 2 · 10 → 3. Too many for the table is lowered so civilians still outnumber the infiltrators |
| Mr. White | part of the suggested set-up (5+ players) | off by default, only 6+ | **Fix + setting**: `undercoverMrWhite` default **on**, shows at 5+ players, host can turn it off |
| Mr. White never first | app never gives Mr. White the first description | already | keep (also applied to the tie-break speakers) |
| Elimination reveals role | yes | yes | keep |
| Mr. White guess | 1 guess, right = wins alone | yes | keep |
| Civilians win | all Undercover + Mr. White out | yes | keep |
| Infiltrators win | **only 1 civilian left** | "2 players left" (alive ≤ 2) | **Fix**: civilians alive ≤ 1. E.g. 2 Undercover + 1 civilian now ends the game (before it went on) |
| Tie vote | 3 house options; the one the app can run is "tied players describe once more, the others re-vote" | straight re-vote among tied, everyone votes | **Fix + setting** `undercoverTieRule` = `speak` (default: tied players give 1 more clue, then the *other* players re-vote among the tied) / `revote` (re-vote at once, others vote) / `none` (nobody out). Still tied after the re-vote = nobody out. If everyone alive is tied, everyone votes |
| Points | 2 / 6 / 10 to the winning side | none (win/loss only) | **Add**: points per game shown on the end screen + running room scoreboard (`room.undercoverScores`); stored in game history (`points`) |
| AFK guard | — | 3 rounds in a row with no elimination → infiltrators win | keep (prevents endless rooms; a tied player who leaves doesn't count as a stale round) |

## Edge cases handled
- A tied player leaves during the extra clues or the re-vote → no one else is voted out that round (the leaver is already gone); the round ends and doesn't count as stale.
- Tied players can't vote in the tie-break re-vote; the "voted x/y" count only counts the people who can vote.
- Leaving mid-game: seat is marked out, role revealed, win check runs, turn/vote moves on (engine `handlePlayerLeft` + `restoreDepartedSeat`).
