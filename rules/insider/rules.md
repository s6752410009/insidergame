# Insider (Oink Games) — real rules vs. our game

Sources (checked 2026-10):
- Oink Games product page — 4–8 players, 15 min, "5 minutes to discover the answer": https://oinkgames.com/en/games/analog/insider
- Rulebook text (English, Oink): https://rulespal.com/insider/rulebook
- Rulebook text (translated edition): https://www.ultraboardgames.com/insider/game-rules.php
- Reviews that quote the hourglass rule: https://whatsericplaying.com/2017/07/17/insider/ ("flip the timer back over, and that's the amount of time you have"),
  iSlaytheDragon review https://boardgamegeek.com/thread/1719189 ("the conversation is limited to the amount of time the group used to find the answer")

## Real rules (rulebook)

| # | Rule |
|---|------|
| R1 | **4–8 players.** One tile each: 1 **Master**, 1 **Insider**, the rest **Commons**. |
| R2 | The **Master shows their tile** (Master is public). Insider and Commons stay secret. The Master is never the Insider. |
| R3 | The Master picks the theme (word). Everyone closes eyes; the **Insider opens eyes and sees the word** secretly. So Master + Insider know it. |
| R4 | **Q&A**: the Master flips the ~**5-minute** hourglass. Anyone asks the Master questions; the Master may only answer **"Yes", "No" or "I don't know"**. |
| R5 | Hourglass runs out before anyone says the word → **everyone loses** (Insider too). |
| R6 | A player (Common or Insider) says the word → they are **the Guesser**. The Master **flips the hourglass**: the discussion lasts **as long as the Q&A took** (sand that already fell). Discussion may end early when everyone is done. Everyone, the Master too, discusses. |
| R7 | **Vote #1**: everyone **except the Guesser** (Master included) votes whether the Guesser is the Insider. **A tie is not a majority.** Majority yes → the Guesser reveals: Insider → Master + Commons win; not the Insider → **Insider wins**. Otherwise → Vote #2. |
| R8 | **Vote #2**: the Master counts to 3, **everyone points** (Master and Guesser too). Most votes: Insider → Master + Commons win; otherwise the Insider wins. **Tie → the Guesser casts the deciding vote.** |
| R9 | No points — a single round is win/lose. Advanced variant: a round may have **no Insider** (uses a removed tile). |

## Our game before this pass vs. gap → decision

| Rule | Before | Gap | Decision |
|------|--------|-----|----------|
| R1 players | 3–10 | **3 players is broken**: the only Common knows the other player is the Insider | **Fix**: min 4. Max stays 10 (more Commons work fine; owner can cut to 8) |
| R2 Master public | Master was secret (only guessable from who answers) | Master should be public | **Fix**: system message + waiting screen say who the Master is |
| R2/R3 roles, word | random Master among online players, 1 Insider, Master/Insider see the word, Master can type a word or pick from 5 | none | keep |
| R4 Q&A | room `roundTime` (default 5 min), quick answers ✅ ใช่ / ❌ ไม่ใช่ / 🤔 อาจจะ | "maybe" is not a rulebook answer | **Fix** label: 🤷 ไม่รู้ ("I don't know"); key `maybe` kept for old chat history |
| R5 time out | everyone loses | none | keep. **Bug fixed**: after a server restart the Q&A clock was never re-armed → round stuck forever |
| R6 guesser + discussion | "ทายถูกแล้ว" went **straight to the vote** (no guesser, no discussion) | no Guesser, no discussion phase | **Fix**: Master/host picks the Guesser → word shown to all → discussion = Q&A time used (min 30 s for chat typing), Master/host can end it early |
| R7 vote #1 | **removed** | missing | **Fix**: ✅/❌ vote on the Guesser, everyone except the Guesser incl. Master, needs **more than half of the voters** (no answer = not a yes, like not raising a hand). Room setting **"โหวตคนทายถูกก่อน"** (default **on** = rulebook); off = old one-vote style |
| R8 who votes | **Master could not vote** in vote #2 | Master votes | **Fix**: Master votes |
| R8 tie | tie at the top = nobody caught = Insider wins | Guesser should break the tie | **Fix**: if the Guesser's own vote is one of the tied players it decides; else the Guesser gets 15 s to pick among the tied. Guesser offline / no pick = nobody caught = Insider wins |
| R9 scoring | win/lose stats, no points | none | keep |
| R9 no-Insider variant | "อาจไม่มีจอมบงการ" (`traitorOptional`, 1 % ghost round) **on by default** | base game always has an Insider | **Fix**: default **off**, toggle in lobby |

## House variants kept (with reason)
- **2 Insiders** (`dualTraitorMode`, 5+ players, default off): popular for big online groups. Vote #1 is skipped (it is about one Insider); vote #2 picks 2 and must catch both. No Guesser tie-break in this mode.
- **Insider leaves mid-game** = Master + Commons win (anti rage-quit). **Master leaves before the word is guessed** = round cancelled, no stats.
- Vote timers 15 s each (online play needs a deadline). Offline players do not block a vote.
- Stats: Master wins with the Commons (rulebook: "Master and Commons win").

## Room settings (Insider)
| Setting | Values | Default |
|---|---|---|
| `roundTime` — Q&A time | 3 / 4 / 5 / 6 / 8 / 10 min (create slider 1–10) | **5 min** (rulebook) |
| `insiderGuesserVote` — vote on the Guesser first | on / off | **on** (rulebook) |
| `traitorOptional` — rounds without an Insider may happen | on / off | **off** (base game) |
| `dualTraitorMode` — 2 Insiders (5+ players) | on / off | off |
