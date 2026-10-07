# ไพ่โซลิแทร์ (Klondike) — rules check

Sources: Wikipedia "Klondike (solitaire)" (Microsoft standard scoring table);
Windows 7 Solitaire scoring (Dummies, "Game cheats for Solitaire in Windows 7"):
draw-one flips through once free then −100 per extra pass, draw-three three passes free then −20,
Vegas = draw-one 1 pass / draw-three 3 passes, then the game is over.

| Rule | Before | Gap | Decision |
|---|---|---|---|
| Deal 7 piles (1..7, top card up), 24-card stock | yes | — | kept |
| Draw 1 or draw 3 | yes (new-game dialog, saved per device) | — | kept, default draw 1 |
| Foundations A→K by suit; cards may come back down from a foundation | yes | — | kept |
| Tableau: down by one, alternating colour; empty column takes only a K | yes | — | kept (tested) |
| Redeals: unlimited (Standard) vs limited (Vegas) | unlimited only | no limit option | **added "นับคะแนน: ปกติ / เวกัส"** in the new-game dialog (saved per device). ปกติ = unlimited (default, like Windows). เวกัส = 1 pass (draw 1) / 3 passes (draw 3); the stock dims and a tap explains why; hint/stuck detection respect the limit |
| Standard scoring | none (time + moves only) | missing | **added**: waste→tableau +5, to foundation +10, turn over tableau card +5, foundation→tableau −15, recycle −100 (draw 1, after the first pass) / −20 (draw 3, after 3 passes), never below 0. Computed from the move log, so undo also undoes points |
| Vegas scoring | none | missing | **added**: start −52, +5 per card to a foundation, −5 back down (can be negative) |
| Server check of a win | replay of the log | — | now replays with the chosen scoring (a Vegas win that recycled too often is rejected) and stores the server-computed score (`lastWin.score`, best standard score per draw mode) |

Not added (owner question): the Windows timed-game parts (−2 every 10 s and the 700,000 ÷ seconds win bonus).
Our board already shows time and the leaderboard is fastest draw-1 win, so time is not mixed into the score.

"ชนะได้แน่นอน" seeds were checked with unlimited passes; in Vegas the dialog says they may not be winnable.

## Exit
Fixed footer "← เกมเดี่ยว" visible while playing. The game is saved on the device and restored on
return (tested with a Vegas game), so leaving loses nothing. Starting a new deal mid-game already warns
that it counts as a loss.
