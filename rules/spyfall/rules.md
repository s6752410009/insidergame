# Spyfall — real rules vs. our game

Sources (checked 2026-10):
- Spyfall rulebook (Hobby World / Cryptozoic), text via https://rulespal.com/spyfall/rulebook
- https://ultraboardgames.com/spyfall/game-rules.php (same rulebook text)
- https://officialgamerules.org/game-rules/spyfall/ (scoring summary)

## Real rules (rulebook)

| # | Rule |
|---|------|
| R1 | 3–8 players. Every location deck: same location for everyone + one Spy card. Each non-spy also has a role in that location. |
| R2 | A round lasts **8 minutes**. |
| R3 | The **dealer asks first**. The player who answers asks the next question to anyone, but **cannot ask back** the player who just asked them. |
| R4 | **Stop the clock / accusation**: each player may stop the clock **once per round** to accuse one player and call a vote. If **all players agree (the suspect does not vote)** the round ends and the suspect's card is revealed. If not unanimous, the clock restarts and play goes on. |
| R5 | **Spy reveal**: the spy may stop the clock **any time while it is running** (not while another player has it stopped for a vote, and **not after time ran out**) to reveal and guess the location. Right = spy wins, wrong = non-spies win. |
| R6 | **Time out**: each player in turn, **starting with the dealer**, accuses one player; same unanimous vote. Continue until a vote passes. If nobody is convicted, the spy wins. |
| R7 | Convicting a non-spy = the spy wins (and is revealed). |
| R8 | **Scoring per round** — spy wins: 2 pts; spy gets **4** if an innocent was convicted or if the spy guessed the location. Non-spies win: 1 pt each, **+1 for the player who started the successful accusation**. |
| R9 | Play an agreed number of rounds (rulebook: "we recommend five rounds"). **The spy of the last round deals the next round.** Most points wins. |

## Our game before this pass vs. gap → decision

| Rule | Before | Gap | Decision |
|------|--------|-----|----------|
| R1 players | 4–8 | min 3 in real game | **Fix**: 3–8 |
| R1 roles | each citizen gets a distinct role per location (8 roles) | none | keep |
| R2 timer | room roundTime, default 8 min in mode defaults, but engine fallback 5 min | engine fallback wrong | **Fix** fallback to 8 min; keep the slider (1–10 min) |
| R3 chain | asker picks who to ask, cannot ask back (UI); first asker random | first asker should be the dealer | **Fix**: dealer asks first |
| R4 accusation | none. Instead "ready to vote" (majority) → one secret **plurality** vote at the end | no stop-the-clock accusation, no unanimity | **Fix**: add "🛑 กล่าวหา" (once per round, clock pauses, everyone but the suspect votes ✅/❌, unanimous needed). Old plurality vote kept as a **room setting** "โหวตแบบเสียงข้างมาก" (casual Thai groups often just point at once) |
| R5 spy guess | allowed in discussion **and vote** | must not be allowed during a vote / after time | **Fix**: discussion only (clock running) |
| R6 time out | plurality vote | should be dealer-first accusations in turn | **Fix** (unanimous mode): final round of accusations, dealer first; nobody convicted = spy wins |
| R7 | majority on innocent = spy wins | none | keep |
| R8 scoring | no points, just win/lose | missing | **Fix**: points per round + scoreboard |
| R9 rounds | single round, host "rematch" | missing | **Fix**: room setting **rounds 1 / 3 / 5 (default 5)**, dealer = last spy (round 1 random) |

## Our house details (kept, with reason)
- "พร้อมโหวต" (majority of online players ready) and host "จบคุย" skip the rest of the clock → go straight to the time-out accusations (unanimous mode) or the plurality vote (majority mode). Convenience for online play; does not change who wins.
- Vote timers (accusation vote 60 s, pick-a-suspect 30 s): online play needs a deadline. Not answering = not agreeing (unanimity fails).
- Offline (disconnected) players do not block a unanimous vote.
- Spy leaves mid-round = non-spies win (1 pt each).
- Stats are recorded per round (each round is one win/loss), the match total is shown on the board.

## Settings
| Setting | Values | Default |
|---------|--------|---------|
| `roundTime` (existing) | 1–10 min | 8 min |
| `spyfallRounds` | 1, 3, 5 | 5 (rulebook recommendation) |
| `spyfallVoteMode` | `unanimous` (rulebook) / `majority` (old quick vote) | `unanimous` |
