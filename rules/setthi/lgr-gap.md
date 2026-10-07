# เศรษฐี vs LINE Let's Get Rich (LGR): gap analysis

LGR is the LINE export of **모두의마블 for kakao** (Netmarble "Modoo Marble" mobile).
The research below was done on 2026-10-07. Sources are listed at the end. Where versions disagree,
we follow the mobile/kakao rules (LGR's base), not the older PC game.

Legend: ✅ have it and it matches LGR · 🟡 have it, but different on purpose (owner rule) · ❌ missing
· ➕ added in this branch · ⏭️ left out on purpose.

## Board and players

| LGR | เศรษฐี before | Now |
|---|---|---|
| 32 tiles; corners Start 0, Island 8, Olympics 16, World Tour 24 | same corner layout (งานวัด = Olympics) | ✅ |
| 2–4 players or 2v2 teams | 2–4 | ➕ **2–6** (owner request; more than LGR) · ⏭️ teams |
| 5 tourist spots, never buildable | 4 tourist spots, one per side, never buildable | 🟡 keep 4 (board symmetry) |
| 4 Fortune tiles + 1 casino "bonus game" tile | 3 โอกาส + no casino | 🟡 ⏭️ casino (gambling mini-game, not a fit for this site) |
| Tax tile: 10% of construction cost owned (kakao/LGR) | 10% of property value | ✅ |

## Building

| LGR | เศรษฐี before | Now |
|---|---|---|
| Land + villa/building/hotel bought in one landing | same (one sheet, pick the level) | ✅ |
| World map: lap 1 villa only, lap 2 + building, lap 3 + hotel (LGR wiki: "max 2 buildings before passing Start") | lap 1 up to house, lap 2+ up to hotel | 🟡 keep (simpler, owner-approved) |
| Landmark needs villa+building+hotel, then land on it again (or Start bonus) | needs hotel, land again | ✅ |
| Landmark blocks takeover, forced sale, swap, attacks | blocks takeover | ➕ now also blocks forced sale / earthquake / swap / donate |
| Landing on own landmark: no LGR equivalent | ⭐ star bonus (+20%, toll +25%/star) | 🟡 owner rule, keep |

## Toll and takeover

| LGR | เศรษฐี before | Now |
|---|---|---|
| Pay toll first, then may take over at **2× construction cost**; owner cannot refuse | same | ✅ |
| Landmarks and tourist spots cannot be taken over | same | ✅ |
| Takeover-discount 50% card / item | ❌ | ➕ keepable card "ส่วนลดซื้อต่อ 50%" |
| Takeover-refusal items (% chance) | ❌ | ⏭️ belongs to the 🪙 skills follow-up |
| **One colour set owned = that set's tolls ×2** | ❌ | ➕ **ครบสี ×2** (cutscene + tile glow) |

## Win conditions

| LGR | เศรษฐี before | Now |
|---|---|---|
| Triple monopoly (3 colour sets) | ✅ | ✅ + explicit `winType: 'triple'` |
| Line monopoly (one whole side, tourist spots count) | ✅ | ✅ + `winType: 'line'` |
| Tourist monopoly (all tourist spots) | ✅ (4) | ✅ + `winType: 'tourist'` |
| Last player standing (others bankrupt) | ✅ | ✅ + `winType: 'bankrupt'` |
| Turn or time limit, highest assets win (LGR 2015: 30 turns; kakao now: 12 turns / 20 min) | minutes 20–60 or unlimited, finish the round, highest assets | 🟡 minutes kept + `winType: 'time'` |
| Late-game toll escalation (kakao: ×1.5 per turn in the last 6 turns) | ❌ | ⏭️ open question for the owner |
| Reward multiplier per win type (2× / 3× / 5×) | ❌ | ⏭️ data exposed (`winType`, counters) for the 🪙 shop follow-up |

## Island, doubles, Start, World Tour, Olympics

| LGR | เศรษฐี before | Now |
|---|---|---|
| Island: stuck 3 turns; out by doubles, paying, or **Escape card** | doubles / pay / wait 3 | ➕ keepable **การ์ดหนีเกาะ** (button on the island, bots use it) |
| Doubles roll again; 3 doubles in a row = island | same | ✅ |
| Landing exactly on Start = build on one own property | free +1 level on own city | ✅ |
| Salary every pass of Start | ฿3,000 | ✅ (owner rule) |
| World Tour: pay a fee, choose any tile next turn; passing Start pays | same, always moves forward | ✅ |
| Olympics: 2× on a chosen city, grows on re-hosting, **capped at 5×** on kakao | งานวัด ×2 → ×4 → ×8 → ×16 | 🟡 owner rule (×16 cap), keep |
| Separate fixed "festival cities" (3 random cities 2× all game) | ❌ | ⏭️ would clash with our งานวัด naming; open question |
| Toll-free on doubles | — | ⏭️ **not a real LGR rule**, not added |

## Fortune / chance cards

| LGR card | before | Now |
|---|---|---|
| Angel (keep): cancels one toll **or one attack** | auto-cancels one toll | ➕ now also blocks attack cards aimed at your city |
| Toll discount 50% (keep) | ✅ | ✅ |
| Escape (keep) | ❌ | ➕ |
| Takeover discount 50% (keep) | ❌ | ➕ |
| Forced sale (attack): opponent city back to the bank, owner gets 50% | ❌ | ➕ **บังคับขาย** (tap an opponent city) |
| Earthquake (attack): one building level off an opponent city | ❌ | ➕ **แผ่นดินไหว** (tap an opponent city) |
| City swap: one of yours for one of theirs, not landmarks | ❌ | ➕ **แลกเมือง** (tap yours, then theirs) |
| Donate a city (forced): give one non-landmark city away, may hand them a monopoly | ❌ | ➕ **บริจาคเมือง** (yours → the poorest player) |
| Go to the Olympics/festival city and pay its toll | ❌ | ➕ **ไปเที่ยวงานวัด** |
| Host Olympics | ✅ จัดงานวัด | ✅ |
| World Tour invitation / go to Start / go to island | ✅ | ✅ |
| Charity, tax audit, disease/blackout (toll −50% for N turns), alien invasion, rip-off | ❌ | ⏭️ timed debuffs add a lot of UI; later |
| Big card flip animation | ✅ | ✅ (new texts/icons for new cards) |

## Feel / presentation

| LGR | before | Now |
|---|---|---|
| Hold-to-roll power gauge, "dice control" | hold-to-roll needle + green doubles zone | ✅ (our own take) |
| Odd/Even roll button (3 per game) | ❌ | ⏭️ open question |
| "Monopoly warning" when 1 tile short | alert row + blinking tile | ➕ plus a one-time big ⚠️ warning cutscene when a new threat appears |
| Landmark / takeover / monopoly cutscenes | ✅ | ✅ + ครบสี ×2, attack cards, Escape, win-type badge on the result screen |
| Toll coin burst | ✅ | ✅ |
| Character/dice skills with % procs | ❌ | ⏭️ 🪙 shop follow-up (engine has `setProcHook` / `setRng` ready) |
| Auctions or trades | none in standard LGR | ✅ none (correct) |
| Sell only when short of cash, 50% back | same | ✅ |

## What this branch adds (summary)

1. 2–6 players.
2. **ครบสี ×2:** owning a whole colour set doubles its tolls.
3. Keepable cards: **Escape** and **Takeover −50%**. Angel now also blocks attack cards.
4. Attack/command cards: **forced sale, earthquake, city swap, donate city, go to festival**. Landmarks are immune.
5. Explicit end-state result: `winType` ∈ `time | bankrupt | line | triple | tourist` (null when nobody won or everyone else left), `endCause`, and per-player counters `landmarksBuilt` and `takeovers`.
6. Cutscenes: colour-set complete, monopoly warning, attack cards, Escape card, win type on the result screen.

## Sources

- Namu wiki: kakao rules https://namu.wiki/w/모두의마블%20for%20kakao/규칙 · kakao map https://namu.wiki/w/모두의마블%20for%20kakao/맵 · PC rules https://namu.wiki/w/모두의마블%20온라인/규칙 · LGR https://namu.wiki/w/Let's%20Get%20Rich
- Netmarble official guide (PC): https://modoo.netmarble.net/guide/Contents.asp?id=gmm&depth1=324&depth2=1501&depth3=3079
- LGR fandom: https://letsgetrich.fandom.com/wiki/World · https://letsgetrich.fandom.com/wiki/Completion_Win · https://letsgetrich.fandom.com/wiki/List_of_all_skill
- Card list (Indonesian LGR): http://www.hotgamemagazine.com/2015/02/mengenal-jenis-kartu-dalam-game-line-LETS-GET-RICH.html
- Japanese guides: https://www.appbank.net/2015/01/06/iphone-application/952680.php · https://weekly.ascii.jp/elem/000/002/629/2629207/
- Thai guides: https://fiercebook.com/articles/322 · https://droidsans.com/line-lets-get-rich/ · https://line.kapook.com/view95826.html
- LINE press release: https://linepluscorp.com/pr/news/en/2014/795
