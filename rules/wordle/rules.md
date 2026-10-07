# ทายคำรายวัน (Thai Wordle) — rules check

The game is a **Thai** adaptation (4 cells, 1 cell = base letter + its upper/lower vowel + tone mark).
Reference: Wordle (Josh Wardle / NYT) — 6 guesses, one shared word per day, guess must be a real
word, green/yellow/grey feedback, duplicate letters counted, optional Hard Mode, share grid ("3/6*" in hard mode).

| Rule | Before | Gap | Decision |
|---|---|---|---|
| 6 guesses, one word per day for everyone, new word at midnight | yes (Bangkok midnight) | — | kept |
| Guess must be a valid word | yes, server-side list (PyThaiNLP words + answers) | — | kept, re-tested |
| Duplicate-letter colouring: greens first, then left→right yellows only while that letter is still unused in the answer | implemented | needed proof | verified: fixed cases (ABBEY/BABES/KEBAB…) + 20,000 random words compared with the original algorithm, identical |
| Thai extension: base letter right but vowel/tone wrong = yellow with green dot ("near"), counts like a green for the base | own rule | n/a in English | kept (needed for Thai) |
| **Hard Mode**: revealed hints must be used in later guesses (green stays in place, yellow must appear) | missing | missing | added as an in-game option (⚙️, saved per device), default OFF like the original. Can only be switched on before the first guess of the day, can be switched off any time (original behaviour). Enforced on the server. Thai extension: a "near" cell must keep its base letter in that cell. Grey letters may be reused (the original allows it). |
| Share text marks hard mode with `*` | missing | missing | added |

## Exit
Fixed footer "← เกมเดี่ยว" visible while playing; guesses are stored on the server, so leaving loses nothing
(tested: leave mid-game, come back, both guesses still there).
