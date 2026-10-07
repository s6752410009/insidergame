# วาดแล้วทาย (Draw & Guess): rules fidelity

References: how people play online drawing games and the board game they come from.

- **skribbl.io** is the online standard. The drawer picks 1 of 3 words (word count 1–5). Draw time is 15–240 s (default 80). Rounds are 2–10 (default 3). Hints are 0–5 letters (default 2), revealed over time, with the word shown as `_ _ _`. Guessers score more the faster they guess. The drawer scores by how many guessed and how fast. The turn ends when everyone has guessed. "'x' is close!" is shown only to the guesser. Once you have guessed, your chat is seen only by others who have guessed. The host can add custom words, with a "use custom words only" option. Sources: [AhaSlides: how to play skribbl](https://ahaslides.com/blog/how-to-play-skribblo), [Critical Play: skribbl.io](https://mechanicsofmagic.com/?p=17244).
- **Gartic.io**: hints reveal letters next to blanks, and faster guesses score more. Players can also report or skip a drawing. Source: [Critical Play: competitive analysis](https://mechanicsofmagic.com/?p=5593).
- **Pictionary** (the board game): the drawer may not use letters, numbers, gestures or talking. Turns last about 1 minute. Cards include a "Difficult" category. Sources: [rulespal Pictionary rulebook](https://rulespal.com/pictionary/rulebook), [Brightful: how to play Pictionary](https://www.brightful.me/blog/how-to-play-pictionary/).

## Rule by rule

| Rule | Real games | Before this pass | Decision |
|---|---|---|---|
| Drawer picks 1 of 3 words, timed | skribbl: 3 choices, ~15 s | 3 choices, 12 s, then a random pick | **keep** |
| Word difficulty spread | Pictionary has a "Difficult" category; skribbl has no levels | No levels. The 3 words came from 3 categories, so a drawer could get three hard words | **fix**: new `level` column in `words/drawguess-th.csv` (1 easy 117 words, 2 medium 213, 3 hard 117). The 3 choices are easy + medium + hard, ordered easy to hard and labelled ง่าย/กลาง/ยาก. Mixed mode still uses different categories. A category with no easy words (jobs) fills from what it has. Same points for every level (as in skribbl) |
| Hints: letters revealed progressively, word length shown | skribbl: `_ _ _` plus a letter count, 0–5 hints, default 2 | Grapheme-cluster slots, up to 40% revealed after 30% of the time, "N ตัว" count shown. No way to turn hints off. Lone vowels were as likely to be revealed as consonants | **fix + setting**. The Thai hint unit stays the **grapheme cluster** (consonant + above/below vowel + tone mark = 1 slot, e.g. ปลาดาว = 6, น้ำแข็ง = 4). A syllable is too big: 2-syllable words would give away half. Slots starting with a consonant are now revealed first. Leading/trailing vowels (เ แ โ ใ ไ า ะ ำ ๆ) give almost nothing away, so they come last. New room setting **คำใบ้ เปิด/ไม่ใบ้** (`drawguessHints`, default on) |
| Faster guess = more points; drawer scored by guessers | skribbl, Gartic | Guesser gets 60 + 240 × time left, plus an order bonus of 50/35/20/10/5. Drawer gets +40 per correct guesser | **keep**. Drawer points per guesser scale with table size the same way guesser points do |
| Turn ends early when all have guessed | skribbl | yes | **keep** |
| "Close" feedback is private | skribbl | yes (one grapheme off, or a part of the word) | **keep** |
| Solved players can't leak the word | skribbl: solved chat is visible only to solved players | yes (`aud: 'solved'`) | **keep** |
| Drawer can't type the word | skribbl hides it | Drawer chat during the draw goes only to solved players. The guess box is hidden for the drawer | **keep** |
| Drawer can't write letters/numbers on the canvas | Pictionary rule; online games use report/vote | Only the label "ห้ามเขียนตัวหนังสือ" | **fix**: guessers press 🚩 on the drawing (press again to undo). When **more than half** of the current guessers have pressed (2 guessers → 2, 3 → 2, 4 → 3, 11 → 6), the turn is **void**: the word is revealed, the guessers' points for that turn are taken back, the drawer gets nothing, and the turn is left out of the per-player summary. Everyone sees the count ("🚩 1/2"), including the drawer, so they can erase in time. Nobody sees who pressed. Each player is announced in chat only once per turn |
| Rounds × every player draws once | skribbl | yes, 2/3/4 rounds | **keep** |
| Settings: draw time, rounds | skribbl 15–240 s, 2–10 rounds | 60/80/100 s, 2/3/4 rounds, category | **keep** (defaults 80 s and 3 rounds match skribbl) |
| Custom word list | skribbl custom words + "custom only" | none | **add**: **📝 คำของห้อง** in the lobby (host only). Separate words with `,` or new lines. Up to 200 words, 20 letters each, no duplicates. Mixed mode puts 1 room word in each set of 3 choices. **เฉพาะของห้อง** (room words only) needs 10 or more words. A room word that is also a site word accepts that word's aliases. Other players see only the count on screen |
| Drawer finished early | site's own feature | "✅ วาดเสร็จแล้ว": once per turn, only after drawing something. Cuts the time left to ≤ 15 s; points still count on the original clock | **verified** by `smoke:drawguess:play` 5b, `smoke:drawguess:mobile` and `smoke:drawguess:rules` A5 |

## Bugs fixed
- The host could emit `updateRoom` mid-game. The callback returns the whole `room`, including `gameState.word`, so the host (also a guesser) could read the word. Now blocked while the game runs, like codenames. Settings are applied at game start anyway.
- `hintsShown` was not reset between turns, which fired one useless hint event per turn.

## Settings (room)
| key | values | default |
|---|---|---|
| `drawguessRounds` | 2 / 3 / 4 | 3 |
| `drawguessSeconds` | 60 / 80 / 100 | 80 |
| `drawguessCategory` | mixed / one category | mixed |
| `drawguessHints` | on / off | on (new) |
| `drawguessCustomWords` | up to 200 words | empty (new, lobby only) |
| `drawguessCustomOnly` | mixed / room words only (needs ≥ 10) | mixed (new) |

## Open questions for the owner
1. Should hard words give bonus points? Right now all levels score the same, as in skribbl, so drawers will often pick the easy word.
2. 🚩 vote: is "more than half" right? Should a void turn also cost the drawer points, not just score 0?
3. Room words are in `room.settings`, which every lobby client receives (as in skribbl, where everyone can see the list). The UI shows only the count, but a technical user could read the list. Hiding it fully means a host-only payload.
4. Should there be more choices: 1 round (big groups), 120 s draw time, hint amount (few/normal), or a word-count option (skribbl allows 1–5)?
