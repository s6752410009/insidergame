# จับคู่การ์ดความจำ (Memory / Concentration, solo) — rules check

Reference: Concentration / Memory (pairs) — every face appears exactly twice, cards face down in a grid,
turn two cards per turn; a match stays face up, a miss turns back down; the solo goal is to clear the
board in as few turns (and as little time) as possible.

| Rule | Current | Gap | Decision |
|---|---|---|---|
| Each face exactly twice, grid = pairs × 2 | yes (all levels/decks, tested) | — | kept |
| Turn = flip two cards; turns counted per pair flipped | yes | — | kept |
| Match stays face up; miss shows both then flips back | yes (tap next card flips the miss back at once) | — | kept |
| Can't flip a matched card or the same card twice | yes (also enforced in server replay) | — | kept |
| Win = all pairs found; score = fewest turns / time | yes (+ combo points and stars as a house extra) | — | kept |
| Server-checked result | replay of the flip log from the seed; seed reuse and too-fast times rejected | — | kept |

No rule changes needed. No real-world variant worth a setting (difficulty/grid size and decks already exist).

## Exit
Fixed footer "← เกมเดี่ยว" visible while playing (≥ 44 px, inside the viewport); the game is saved on
the device and offered as "เล่นต่อ" on return (tested: back to /solo mid-game, return, moves and matches intact).
The in-game pause → "ออก" path already existed.
