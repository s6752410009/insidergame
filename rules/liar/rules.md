# ไพ่โกหก (Liar) — rules fidelity

Reference game: **Liar's Deck**, the card mode of *Liar's Bar* (Curve Animation, 2024).

Sources:
- debigare.com, "How to Play Liar's Deck (From Liar's Bar) - Full Rules and Variants"
  https://www.debigare.com/how-to-play-liars-deck-from-liars-bar-full-rules-and-variants/
- Wikipedia, "Liar's Bar" https://en.wikipedia.org/wiki/Liar%27s_Bar
- Automaton (JP), Devil rule update, 2024-10-21
  https://automaton-media.com/articles/newsjp/20241021-315251/

## Rule by rule

| Topic | Real rule | Before this pass | Decision |
|---|---|---|---|
| Deck | 6 A, 6 K, 6 Q, 2 Jokers (20). 2–4 players. | 3–5 seats: 4–5 of each rank + 2 Jokers (17 cards at 3 players). 6–8 seats: 4 Jokers + scaled ranks. | **Fix.** 3–4 players use the real 20-card deck. 5–8 players use two decks (12/12/12 + 4 Jokers = 40), so the ratio of true cards stays the same. |
| Hand | 5 cards each. Every round the whole deck is shuffled and dealt again. | 5 each, re-dealt each round. | Keep. The deck is now rebuilt fresh each round, so no card can get lost. |
| Table card | A table deck (A, K, Q) is shuffled each round, and its top card is the table card. The same card can come up again. | Random, but never the same as last round. | **Fix.** Plain random, repeats allowed. |
| Turn | Play 1–3 cards face down, or call LIAR on the previous player (not on the first turn of a round). 30 s per turn. | 1–3 cards. 45 s to play, 20 s to answer. | **Fix.** One 30 s timer per turn, as in the game. AFK shortcut (12 s) kept. |
| Truth | Cards matching the table card and Jokers are truths. Anything else is a lie. | Same. | Keep. |
| Call | Reveal the previous play. Any lie means the accused is punished, otherwise the caller is. | Same. | Keep. |
| Punishment | Russian roulette. Every player has their **own** revolver: 6 chambers, 1 bullet, no re-spin. Each pull uses up a chamber, so the odds go 1/6 → 1/5 → … → 1/1. The bullet kills. | 3 hearts. | **Fix + room setting.** Default `liarPunishment = 'revolver'` (real rule). `'lives'` keeps the old 3 hearts for groups who want a slower, safer game. |
| Empty hand | A player with no cards is skipped for the rest of the round. If only one player still has cards, they **must** call LIAR. | The empty-handed player still got a turn and could only call. If everyone ran out, cards were re-dealt. | **Fix.** Empty hands are skipped. The last player holding cards is forced to call (play button hidden). |
| Next round | New table card, fresh deal. The first player is the one caught lying, otherwise the next player in turn order. | The player after the loser started. | **Fix.** Caught liar starts (if alive). After a wrong call, the player after the caller starts. |
| Winner | Last player alive. | Same. | Keep. |
| Players | 2–4. | 3–8. | Keep 3–8 (party site). Deck scaling covers 5–8. |
| Devil card | Optional mode. With 3+ players alive, one card of the table rank is the Devil. It must be played alone. If it is revealed by a LIAR call, everyone except the person who played it takes the punishment. | Not present. | **Room setting** `liarDevil` (default off, as in the game where Devil is a separate mode). |
| Chaos / Liar's Deck 2 variants | Later modes (Master/Chaos cards, Devil's Deal, shoot-opponent). | — | Not added. Too many extra rules for a casual Thai party table. |

## Bugs fixed along the way

- **Leaving mid-game was not seen by the engine.** `roomManager.leaveRoom` takes the player out of
  `gameState.players` before `handlePlayerLeft` runs, so the engine returned early. The turn
  stalled until the timer ran out, a pending play by the leaver could be called with nobody punished,
  and the win check did not run. The leaver's snapshot also let them rejoin later as *alive* with their old hand.
  The engine now keeps the seat as an eliminated ghost (in its saved seat order), marks it `left`, hands the turn on,
  re-checks the forced call and the winner, and drops the rejoin snapshot so leaving counts as out.
- The room creation form showed a "time per turn" slider that the game never read. It is hidden for this game now.

## Settings

| Setting | Values | Default | Where |
|---|---|---|---|
| `liarPunishment` | `revolver`, `lives` | `revolver` | create form (`#liarPunishment`), lobby (`#lrLobbyPunish`) |
| `liarDevil` | `true`, `false` | `false` | create form (`#liarDevil`), lobby (`#lrLobbyDevil`) |

Both can be changed only while the room is in the lobby. The game reads them at start.

## UI

- Every seat shows its own revolver: 6 pips (fired ones filled) and the odds of the next pull (1/6 … 1/1).
- On a LIAR call: verdict banner, then "🔫 … ลั่นไก…", then "แชะ… รอด" or "💥 ปัง! ตกรอบ" with a short red flash.
  A Devil reveal shows everyone's pull in one banner.
- A forced call hides the play button and says why. Empty-handed players see that they are skipped.
- The table card shows a "😈 มีปีศาจ" tag in Devil rounds. The Devil card must be played alone (enforced in the hand).

## Tests

- `npm run smoke:liar:rules`: engine use cases for every rule above (deck, table card, revolver odds and persistence,
  lives mode, empty-hand skip, forced call, next-round starter, Devil card, leaving mid-game, 30 s timer, full AFK/bot games).
- `npm run browser:liar:rules`: settings over sockets and lobby UI, board at 390×844 (revolver, Devil tag, no horizontal scroll),
  the shot banners, the create form, and a real-server mid-game leave.
- Existing: `smoke:liar` (now in lives mode), `smoke:liar:play`, `smoke:coup-liar:regressions`, `smoke:boards:console`.
</content>
</invoke>
