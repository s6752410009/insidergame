# คลื่นความคิด (Wavelength) — rules fidelity

Reference game: **Wavelength** (Wolfgang Warsch, Alex Hague, Justin Vickers · Palm Court / CMYK, 2019).

Sources:
- UltraBoardGames rules summary https://ultraboardgames.com/wavelength/game-rules.php
- GameRules.com https://gamerules.com/rules/wavelength/ (co-op score chart, catch-up, sudden death)
- RulesPal rulebook notes https://rulespal.com/wavelength/rulebook
- officialgamerules.org https://officialgamerules.org/game-rules/cmyk-wavelength/
- Longwave, an open-source online adaptation (scoring + co-op code)
  https://github.com/cynicaloptimist/longwave `src/state/ScoreRound.ts`

## Rule by rule

| Topic | Real rule | Before this pass | Decision |
|---|---|---|---|
| Teams | 2 teams of about the same size take turns. With 2–3 players you play the co-op mode. | No teams. Everyone guessed alone. | **Fix.** New default mode **แข่งทีม** (`wavelengthMode = 'teams'`): players are dealt at random into 🔵 ทีมฟ้า / 🟠 ทีมส้ม (sizes differ by 1 at most). With 3 players the game starts in co-op on its own, like the rulebook says. |
| Start score | The team that goes first starts at 0. The other team starts at 1. | — | **Fix.** The first team is picked at random. The other team starts with 1 point. |
| Psychic | Each turn a new player on the active team is the Psychic. | Seat order around the whole table, 1 or 2 laps. | **Fix (team).** Each team has its own Psychic order. In co-op the role goes around the whole table. Solo mode keeps the laps. |
| Card | Each card has 2 sides (normal / weird). The Psychic picks a side. | 2 cards from different groups, pick 1, one reroll. | Keep. Choosing from 2 is the real rule. The one reroll is a small online extra. |
| Clue | One thought on the spectrum. No card words, no numbers. The Psychic stays silent after the clue. | Max 40 letters, no digits, no card words. | Keep. |
| Team guess | Teammates talk and turn **one** dial together. They say when they are done. | Each guesser locked their own needle. | **Fix (team/co-op).** There is one shared dial. Any guesser on the team can drag it, and everyone sees it move live. Each guesser presses **✅ ตกลง**. When every online guesser has agreed, the dial locks. Moving the dial clears all ✅. If time runs out (90 s), the dial locks where it is. |
| Left/Right | The other team guesses if the target is left or right of the dial. They get 1 point if right. If the dial hits the 4-point bullseye, they get nothing. | — | **Fix.** New phase ⬅️ / ➡️ (25 s). Each player on the other team votes. The majority decides (on a tie, the first vote counts). When everyone online has voted, the target is revealed. |
| Scoring | Bullseye 4, the bands next to it 3, the outer bands 2. On a line, take the higher number. | 4/3/2 with distance ≤ half-width (an edge gets the higher band). | Keep. Band widths ±4 / ±11 / ±18 are unchanged. Real dial measurements were not found. Longwave uses a similar bullseye (±5 on 0–100). |
| Catch-up | If the Psychic's team scores 4 and is **still behind**, it takes another turn right away with a different Psychic. This can repeat. | — | **Fix.** "🔁 ตาพิเศษ" banner. It is not used in sudden death, so that each team still gets exactly one turn there. |
| Winning | The first team to 10 wins. If both teams have 10+ and are tied, play sudden-death turns (one per team) until one team is ahead. | Highest personal total after 1–2 laps. | **Fix.** The win is checked after every turn. If both are tied at 10+, sudden death starts: one turn per team, and repeat if still tied. |
| Co-op | 7 cards. Everyone except the Psychic guesses together. No left/right phase. The bullseye is worth **3** and adds a bonus card (one more round). Total score → fun chart (0–3 … 25+, "16–18 You won!"). | — | **Fix.** New mode **ร่วมมือ** (`'coop'`). The chart is translated to Thai. For stats, 16+ counts as a win for everyone. |
| Solo free-for-all | (not in the box) | Everyone has their own needle. 4/3/2 each. The Psychic gets the rounded average. 1 or 2 laps. | **Kept as room setting `'solo'` (โหมดแข่งเดี่ยว).** It plays well online when there is no voice chat. All of its old rules are the same. |
| Players | 2–12 (teams need 4+). | 3–12. | Keep 3–12. Teams mode needs 4+, otherwise co-op. |

## Settings

- `wavelengthMode`: `'teams'` (default) · `'coop'` · `'solo'`. Set in the lobby and on the create-room form.
- `wavelengthLaps`: 1 / 2, used only in solo mode.

## Online notes

- Shared dial moves go to the whole room through a light `wavelengthDial` event (the dial is public in the
  real game too). The target still goes only to the Psychic until the reveal.
- Late joiners are put on the smaller team, and they guess from the next clue. At the start of each turn the
  teams are rebalanced if one team has fewer than 2 people, or if one team is 3+ bigger than the other. If fewer
  than 4 people are left, the game ends and the leading team wins.

## Cards

The deck had 10 near-duplicate "ง่าย ↔ ยาก" cards. 6 were cut. 24 cards were added (163 → 181). Some follow the
official cards (overrated ↔ underrated, fantasy ↔ sci-fi, smells bad ↔ good, low ↔ high calorie, useless ↔
world-changing invention, underpaid ↔ overpaid, worst ↔ best day of the year, introvert ↔ extrovert). Others are
Thai (ชื่อเล่นผู้ชาย ↔ ผู้หญิง, ชื่อเล่นสมัยก่อน ↔ สมัยนี้, ใส่ในส้มตำได้ไหม, ข้าวสวย ↔ ข้าวเหนียว, ลูกทุ่ง ↔ สากล,
ของไหว้). Cards are still short, have no brand names, and use 2 options per turn, like the 2-sided real card.
