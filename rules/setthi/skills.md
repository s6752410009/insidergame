# เศรษฐี: 🏪 shop, 🪙 gold coins, skills

Owner-approved design (2026-10-07): a separate currency 🪙 (not the poker/pokdeng chip wallet),
8 upgradable skills Lv 0–5, 3 equipped slots per game, and a room switch to turn skills off.
Code: `games/setthiSkills.js` (tables), `managers/setthiGoldManager.js` (store),
`games/setthiEngine.js` (procs), `views/setthiShop.ejs` (shop).

## Earning (end of game, server-side)

| result | 🪙 |
|---|---|
| finished (still seated at the end, any place) | 20 |
| win by time-up / host end (most assets) | +100 |
| win by everyone else bankrupt | +150 |
| line monopoly | +200 |
| triple (3-colour) monopoly | +250 |
| tourist monopoly | +300 |
| each landmark built / takeover done | +10 (cap +100) |

- The win amount is on top of the 20 for finishing.
- No other human still seated at the end = half, and those coins count toward a 600/day cap.
- Every game counts toward a 3,000/day cap (Bangkok day).
- 0 coins: left mid-game, bots, any /m debug use, host ended before round 3 (board wins still pay).
- Each player gets a game's reward once (game id stored next to the balance, restart-safe).

## Skills (Lv 1–5 cost 100 / 250 / 500 / 900 / 1500 = 3,250 to max one skill)

| id | skill | Lv1 → Lv5 | effect |
|---|---|---|---|
| double | 🎲 ดับเบิล | +2% → +10% doubles | a non-double roll may become doubles (never the 3rd double, never on the island, never over /m forced dice) |
| fly | ✈️ บินทันที | 15% → 75% | landing on World Tour opens the tour pick this turn (fee still paid; no roll if you cannot pay the fee) |
| start2x | 💰 Start ×2 | 3% → 12% | passing Start pays ฿6,000 instead of ฿3,000 |
| escape | 🏝️ หนีเกาะ | 10% → 50% | stuck on the island and no doubles: leave now and move |
| tollShield | 🛡️ ลดค่าผ่านทาง | 3% → 15% | the toll is halved |
| builder | 🏗️ ส่วนลดก่อสร้าง | 1% → 5% off | every buy/build price (property value, sale and takeover prices stay full) |
| luck | 🃏 ดวงดี | 10% → 50% | a bad card (island, charity, donate city, go to festival) is swapped for the next good card; the bad card goes to the deck bottom |
| festival | 🎪 งานวัด | +3% → +15% toll | toll bonus on your own festival city; Lv5 also opens new festivals at ×3 (×3 → ×6 → ×12 → ×16 cap) |

Values per level: double 2/4/6/8/10 · fly 15/30/45/60/75 · start2x 3/5/8/10/12 · escape 10/20/30/40/50 ·
tollShield 3/6/9/12/15 · builder 1/2/3/4/5 · luck 10/20/30/40/50 · festival 3/6/9/12/15 (+ ×3 at Lv5).

Fairness: max 3 equipped, snapshotted at game start; the host can turn skills off (create form and
lobby); everyone sees each player's skill icons + Lv; every proc shows a ✨ popup to the table and a
history line. Bots have no skills.

## Balance simulation

`node scripts/sim-setthi-skills.js [games] [top] [validate]` — 4 bots with the same brain, one
"hero" gets a loadout, seat rotated, win share counted (ties split). Baseline = 25%.

Pacing: bot pace = scene time + 1 s per decision (30-min games end on the board after ~31 rounds);
human pace = 4 s per decision (`SIM_THINK_MS=4000`, ~28 rounds, a quarter of games end on time).
± = 95% interval.

**Before tuning** (the brief's starting numbers, start2x 25%, builder 10%, festival +20%):
best loadout start2x+tollShield+builder **40.9% ±1.5%** (4,000 games) — too strong.

**As tuned** — baseline (no skills) 25.2% ±1.6% (3,000 games).

Single skill at Lv5 (1,000 games each, bot pace / human pace):

| skill | bot pace | human pace |
|---|---|---|
| 🎲 double | 25.2% | 25.4% |
| ✈️ fly | 26.1% | 25.9% |
| 💰 start2x | 29.2% | 29.0% |
| 🏝️ escape | 25.3% | 26.3% |
| 🛡️ tollShield | 27.1% | 26.6% |
| 🏗️ builder | 29.1% | 28.8% |
| 🃏 luck | 28.0% | 28.4% |
| 🎪 festival | 30.2% | 29.8% |

All 56 three-skill loadouts at Lv5 (500 games each): mean **30.2%** (bot pace) / **30.5%** (human
pace); weakest double+escape+luck 24.4%. The top 6 re-run with fresh seeds (3,000 games each):

| loadout (Lv5 ×3) | bot pace | human pace |
|---|---|---|
| double + start2x + tollShield | 34.4% | 34.5% |
| double + tollShield + builder | — | 34.8% |
| tollShield + builder + festival | 33.7% | — |
| tollShield + builder + luck | 33.2% | 32.7% |
| double + fly + tollShield | 33.3% | 33.4% |
| double + start2x + festival | 32.2% | 32.1% |
| fly + tollShield + luck | 30.2% | 30.1% |

No-time-limit games: same picture (best 34.5%, mean 30.3%).
So a maxed loadout is a modest edge: ~30% on average, ~34–35% for the strongest picks.
Weak on their own: escape, fly, double (mostly flavour; they help only in combination).
