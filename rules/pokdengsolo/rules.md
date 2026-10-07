# ป๊อกเด้งท้าเจ้ามือ (solo) — rules check

Reference: the Thai rules decided on branch `rules/pokdeng` (multiplayer table, commit 2e404ed).
The solo game must score hands exactly like the table, so it reuses `games/pokdengEngine.js`
(`evaluateHand(cards, rules)`, `judge`, `shouldBotDraw`). This branch carries the identical
`games/pokdengEngine.js` + `scripts/smoke-pokdeng-engine.js` from `rules/pokdeng` so both merge cleanly.

| Rule (Thai house rules) | Before | Gap | Decision |
|---|---|---|---|
| Ranking ป๊อก > ตอง > สเตรทฟลัช > เรียง > เซียน > แต้ม | สเตรทฟลัช was "เรียง (ดอกเดียวกัน)" ×3 | wrong tier/pay | fixed (shared engine): own tier, pays 5 เด้ง |
| A-2-3 is not a straight, Q-K-A is | A-2-3 counted | wrong | fixed (shared engine) |
| เด้ง: 2 ใบดอก/คู่ ×2 · 3 ใบดอก ×3 · ตอง/สเตรทฟลัช ×5 · เรียง/เซียน ×3 | same except SF | — | via shared engine |
| ป๊อก 8/9 ends the hand at once (no draws either side) | already | — | kept, tested |
| Dealer "จับ": 2 cards ≥ 4 points may settle against 3-card hands without drawing | missing | missing | added: bot dealer catches with 4–5 when the player drew (same bot rule as the table); shown as "จับ!" |
| Loser pays bet × winner's เด้ง | already (capped at chips, like the table) | — | kept |
| Straights on/off (table setting `pokdengStraights`) | n/a | groups differ | **in-game option ⚙️, saved per device**, default ON |
| ต่ำกว่า 4 ต้องจั่ว (table setting `pokdengMustDraw`) | n/a | groups differ | **in-game option ⚙️**, default OFF; server rejects "อยู่" when forced |
| Max bet (table setting) | fixed 10–500 | — | kept (solo has no table limit choice) |

Rules are sent with each bet, sanitised on the server, locked into that hand (survive refresh/restart).

## Wallet / stats
Chips are play chips (not the wallet). Server deals, keeps the deck and dealer cards secret, settles
every hand; `POST /result` is always rejected; bet/act carry the hand number so retries never double-charge.
A forced-draw "stay" is rejected before any state change. No exploit found.

## Exit
Fixed footer "← เกมเดี่ยว" is visible in every phase. Nothing is lost on leaving: the hand stays on the
server and resumes on return (tested), so no confirm is needed.
