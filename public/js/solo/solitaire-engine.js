/**
 * ไพ่โซลิแทร์ (Klondike) — กติกาล้วน ไม่แตะ DOM ใช้ได้ทั้งเบราว์เซอร์และ Node
 *
 * สถานะเกมทั้งหมดได้มาจาก (seed, draw, log) เสมอ:
 *   - seed  : uint32 → สับไพ่แบบกำหนดผลได้ (mulberry32 + Fisher–Yates)
 *   - draw  : 1 หรือ 3 (เปิดทีละใบ / ทีละสามใบ)
 *   - log   : สตริงของการเดิน ตาละ 3 ตัวอักษร
 * ฝั่ง client ใช้ replay เพื่อ undo/กู้เกมหลังรีเฟรช ฝั่ง server ใช้ replay ตรวจว่าชนะจริง
 *
 * ไพ่ = เลข 0..51  suit = floor(c / 13)  rank = c % 13 + 1 (A=1 … K=13)
 * suit: 0 ♠  1 ♥  2 ♣  3 ♦  (ช่องเก็บไพ่บนสุดเรียงตามนี้ ช่องละดอก)
 *
 * รหัสการเดิน (3 ตัว):  [ต้นทาง][ปลายทาง][จำนวนใบ base36]
 *   ต้นทาง  w = กองเปิด, 0-6 = กองล่าง, A-D = ช่องเก็บของดอกนั้น
 *   ปลายทาง 0-6 = กองล่าง, F = ช่องเก็บ (ดอกของไพ่เอง)
 *   D-- = จั่วจากกองคว่ำ (หรือพลิกกองเปิดกลับเมื่อกองคว่ำหมด)
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SolitaireEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SUIT_KEYS = ['s', 'h', 'c', 'd'];
    const SUIT_SYMBOLS = ['♠', '♥', '♣', '♦'];
    const SUIT_THAI = ['โพดำ', 'โพแดง', 'ดอกจิก', 'ข้าวหลามตัด'];
    const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const RANK_FILES = ['', 'a', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k'];
    const FOUNDATION_CODES = ['A', 'B', 'C', 'D'];
    const MAX_LOG_MOVES = 3000;

    const rankOf = c => (c % 13) + 1;
    const suitOf = c => Math.floor(c / 13);
    const isRed = c => suitOf(c) === 1 || suitOf(c) === 3;

    function cardFile(c) { return RANK_FILES[rankOf(c)] + SUIT_KEYS[suitOf(c)] + '.svg'; }
    function cardLabel(c) { return RANK_LABELS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)]; }
    function cardThai(c) { return RANK_LABELS[rankOf(c)] + ' ' + SUIT_THAI[suitOf(c)]; }

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function shuffledDeck(seed) {
        const rand = mulberry32(seed);
        const deck = [];
        for (let i = 0; i < 52; i++) deck.push(i);
        for (let i = 51; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
        }
        return deck;
    }

    function isValidSeed(seed) { return Number.isInteger(seed) && seed >= 0 && seed <= 0xFFFFFFFF; }
    function isValidDraw(draw) { return draw === 1 || draw === 3; }

    /** แจกไพ่: กองล่างกองที่ i มี i+1 ใบ ใบบนสุดหงาย ที่เหลือ 24 ใบเป็นกองคว่ำ */
    function deal(seed, draw) {
        if (!isValidSeed(seed)) throw new Error('bad seed');
        if (!isValidDraw(draw)) throw new Error('bad draw');
        const deck = shuffledDeck(seed);
        const t = [[], [], [], [], [], [], []];
        let k = 0;
        for (let row = 0; row < 7; row++) {
            for (let col = row; col < 7; col++) t[col].push(deck[k++]);
        }
        return {
            draw,
            t,
            h: [0, 1, 2, 3, 4, 5, 6],      // จำนวนใบคว่ำก้นกองของแต่ละกองล่าง
            stock: deck.slice(k).reverse(), // ใบบนสุด = ท้าย array
            waste: [],                      // ใบบนสุด = ท้าย array
            f: [0, 0, 0, 0]                 // rank สูงสุดในช่องเก็บของแต่ละดอก
        };
    }

    function clone(s) {
        return { draw: s.draw, t: s.t.map(p => p.slice()), h: s.h.slice(), stock: s.stock.slice(), waste: s.waste.slice(), f: s.f.slice() };
    }

    function canStack(card, onto) { return isRed(card) !== isRed(onto) && rankOf(card) === rankOf(onto) - 1; }
    function canTableau(s, card, pile) {
        const p = s.t[pile];
        if (!p.length) return rankOf(card) === 13;
        return canStack(card, p[p.length - 1]);
    }
    function canFoundation(s, card) { return s.f[suitOf(card)] === rankOf(card) - 1; }
    function isWon(s) { return s.f[0] === 13 && s.f[1] === 13 && s.f[2] === 13 && s.f[3] === 13; }

    /** การ์ดที่อยู่ต้นทาง (ใบที่ถูกยกเป็นใบล่างสุดของชุด) */
    function sourceCard(s, move) {
        if (move.from === 'w') return s.waste.length ? s.waste[s.waste.length - 1] : -1;
        if (typeof move.from === 'number') {
            const p = s.t[move.from];
            return p[p.length - move.n];
        }
        const suit = FOUNDATION_CODES.indexOf(move.from);
        return suit >= 0 && s.f[suit] > 0 ? suit * 13 + s.f[suit] - 1 : -1;
    }

    function isLegal(s, move) {
        if (!move) return false;
        if (move.draw) return s.stock.length > 0 || s.waste.length > 0;
        const n = move.n;
        if (!Number.isInteger(n) || n < 1) return false;
        if (typeof move.from === 'number') {
            if (move.from < 0 || move.from > 6) return false;
            const p = s.t[move.from];
            if (n > p.length - s.h[move.from]) return false;
        } else if (move.from === 'w') {
            if (n !== 1 || !s.waste.length) return false;
        } else if (FOUNDATION_CODES.indexOf(move.from) >= 0) {
            if (n !== 1 || s.f[FOUNDATION_CODES.indexOf(move.from)] === 0 || move.to === 'F') return false;
        } else {
            return false;
        }
        const card = sourceCard(s, move);
        if (card < 0) return false;
        if (move.to === 'F') return n === 1 && canFoundation(s, card);
        if (typeof move.to === 'number' && move.to >= 0 && move.to <= 6 && move.to !== move.from) return canTableau(s, card, move.to);
        return false;
    }

    /** คืนสถานะใหม่ (ไม่แก้ของเดิม) หรือ null ถ้าเดินไม่ได้ */
    function applyMove(state, move) {
        if (!isLegal(state, move)) return null;
        const s = clone(state);
        if (move.draw) {
            if (s.stock.length) {
                const take = Math.min(s.draw, s.stock.length);
                for (let i = 0; i < take; i++) s.waste.push(s.stock.pop());
            } else {
                s.stock = s.waste.reverse();
                s.waste = [];
            }
            return s;
        }
        let cards;
        if (move.from === 'w') cards = [s.waste.pop()];
        else if (typeof move.from === 'number') {
            const p = s.t[move.from];
            cards = p.splice(p.length - move.n, move.n);
            if (p.length && s.h[move.from] >= p.length) s.h[move.from] = p.length - 1; // พลิกใบใต้ขึ้นมา
            if (!p.length) s.h[move.from] = 0;
        } else {
            const suit = FOUNDATION_CODES.indexOf(move.from);
            cards = [suit * 13 + s.f[suit] - 1];
            s.f[suit] -= 1;
        }
        if (move.to === 'F') s.f[suitOf(cards[0])] = rankOf(cards[0]);
        else Array.prototype.push.apply(s.t[move.to], cards);
        return s;
    }

    function encodeMove(move) {
        if (move.draw) return 'D--';
        const from = typeof move.from === 'number' ? String(move.from) : move.from;
        const to = typeof move.to === 'number' ? String(move.to) : move.to;
        return from + to + move.n.toString(36);
    }

    function decodeMove(code) {
        if (typeof code !== 'string' || code.length !== 3) return null;
        if (code === 'D--') return { draw: true };
        const a = code[0], b = code[1];
        const n = parseInt(code[2], 36);
        let from;
        if (a === 'w') from = 'w';
        else if (a >= '0' && a <= '6') from = Number(a);
        else if (FOUNDATION_CODES.indexOf(a) >= 0) from = a;
        else return null;
        let to;
        if (b === 'F') to = 'F';
        else if (b >= '0' && b <= '6') to = Number(b);
        else return null;
        if (!(n >= 1 && n <= 13)) return null;
        return { from, to, n };
    }

    function splitLog(log) {
        if (typeof log !== 'string' || log.length % 3 !== 0) return null;
        const out = [];
        for (let i = 0; i < log.length; i += 3) out.push(log.slice(i, i + 3));
        return out;
    }

    /** เล่นซ้ำจาก seed → { ok, state, moves, failedAt } */
    function replay(seed, draw, log) {
        const codes = splitLog(log || '');
        if (!codes || codes.length > MAX_LOG_MOVES) return { ok: false, state: null, moves: 0, failedAt: 0 };
        let s = deal(seed, draw);
        for (let i = 0; i < codes.length; i++) {
            const next = applyMove(s, decodeMove(codes[i]));
            if (!next) return { ok: false, state: s, moves: i, failedAt: i };
            s = next;
        }
        return { ok: true, state: s, moves: codes.length, failedAt: -1 };
    }

    // ---------------------------------------------------------------- ตัวช่วยเล่น

    function tableauMoves(s) {
        const out = [];
        for (let from = 0; from < 7; from++) {
            const p = s.t[from];
            const up = p.length - s.h[from];
            for (let n = up; n >= 1; n--) {
                const card = p[p.length - n];
                for (let to = 0; to < 7; to++) {
                    if (to !== from && canTableau(s, card, to)) out.push({ from, to, n });
                }
            }
        }
        return out;
    }

    /** ทุกการเดินที่ถูกกติกา (ไม่รวมการย้ายชุดไปมาที่ไร้ประโยชน์ออก — ใช้ usefulMoves สำหรับนั้น) */
    function legalMoves(s) {
        const out = [];
        if (s.waste.length) {
            const w = s.waste[s.waste.length - 1];
            if (canFoundation(s, w)) out.push({ from: 'w', to: 'F', n: 1 });
            for (let to = 0; to < 7; to++) if (canTableau(s, w, to)) out.push({ from: 'w', to, n: 1 });
        }
        for (let from = 0; from < 7; from++) {
            const p = s.t[from];
            if (p.length && canFoundation(s, p[p.length - 1])) out.push({ from, to: 'F', n: 1 });
        }
        Array.prototype.push.apply(out, tableauMoves(s));
        for (let suit = 0; suit < 4; suit++) {
            if (!s.f[suit]) continue;
            const card = suit * 13 + s.f[suit] - 1;
            for (let to = 0; to < 7; to++) if (canTableau(s, card, to)) out.push({ from: FOUNDATION_CODES[suit], to, n: 1 });
        }
        if (s.stock.length || s.waste.length) out.push({ draw: true });
        return out;
    }

    /** ย้ายกองล่าง→กองล่างมีประโยชน์ไหม (เปิดใบคว่ำ / ทำให้กองว่าง / ปลดใบใต้ขึ้นช่องเก็บ) */
    function isUsefulTableauMove(s, move) {
        const p = s.t[move.from];
        const start = p.length - move.n;
        if (start === s.h[move.from] && s.h[move.from] > 0) return true;           // เปิดใบคว่ำ
        if (start === 0) return rankOf(p[0]) !== 13 || s.t[move.to].length > 0;   // K ย้ายไปกองว่างอีกกอง = เปล่าประโยชน์
        const under = p[start - 1];
        return canFoundation(s, under);                                            // ปลดใบใต้ขึ้นช่องเก็บได้
    }

    /** ไพ่ใบนี้ขึ้นช่องเก็บได้โดยไม่ทำให้ติด (สีตรงข้ามขึ้นไปถึง rank-1 แล้ว) */
    function isSafeFoundation(s, card) {
        const r = rankOf(card);
        if (r <= 2) return true;
        const red = isRed(card);
        const opp = red ? [0, 2] : [1, 3];
        return s.f[opp[0]] >= r - 1 && s.f[opp[1]] >= r - 1;
    }

    /** ใบที่จะโผล่ขึ้นมาบนกองเปิดถ้าจั่วไปเรื่อย ๆ ครบหนึ่งรอบ (ไม่เล่นอะไรระหว่างทาง) */
    function reachableWasteCards(s) {
        const seen = [];
        let sim = clone(s);
        const total = sim.stock.length + sim.waste.length;
        const steps = Math.ceil(total / sim.draw) + 2;
        for (let i = 0; i < steps; i++) {
            if (sim.waste.length) seen.push(sim.waste[sim.waste.length - 1]);
            if (!sim.stock.length && !sim.waste.length) break;
            sim = applyMove(sim, { draw: true });
        }
        return seen;
    }

    /** ยังมีทางไปต่อไหม — false = ติดแล้ว (จั่ววนก็ไม่มีใบไหนลงได้) */
    function hasProgress(s) {
        if (isWon(s)) return true;
        const moves = legalMoves(s);
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (m.draw) continue;
            if (m.from === 'w' || m.to === 'F') return true;
            if (typeof m.from === 'number' && isUsefulTableauMove(s, m)) return true;
        }
        const reachable = reachableWasteCards(s);
        for (let i = 0; i < reachable.length; i++) {
            const c = reachable[i];
            if (canFoundation(s, c)) return true;
            for (let to = 0; to < 7; to++) if (canTableau(s, c, to)) return true;
        }
        return false;
    }

    /**
     * แตะไพ่แล้วให้ไปเอง: ขึ้นช่องเก็บก่อน แล้วค่อยหากองล่างที่ดีที่สุด
     * from = 'w' | 0..6 | 'A'..'D', index = ตำแหน่งในกองล่าง (ใบที่แตะ)
     */
    function autoMoveFor(s, from, index) {
        let n = 1;
        if (typeof from === 'number') {
            const p = s.t[from];
            if (index < s.h[from] || index >= p.length) return null;
            n = p.length - index;
        } else if (from === 'w') {
            if (!s.waste.length) return null;
        } else if (FOUNDATION_CODES.indexOf(from) < 0) return null;

        if (n === 1 && from !== 'w' && typeof from !== 'number') {
            // จากช่องเก็บกลับลงกองล่าง
        } else if (n === 1) {
            const mv = { from, to: 'F', n: 1 };
            if (isLegal(s, mv)) return mv;
        }
        const candidates = [];
        for (let k = 1; k <= 7; k++) {
            const to = typeof from === 'number' ? (from + k) % 7 : k - 1;
            if (to === from) continue;
            const mv = { from, to, n };
            if (!isLegal(s, mv)) continue;
            let score = 0;
            const destEmpty = s.t[to].length === 0;
            if (typeof from === 'number') {
                const start = s.t[from].length - n;
                if (start === 0 && destEmpty) continue; // ย้ายกองว่างไปกองว่าง
                if (start === s.h[from] && s.h[from] > 0) score += 30;
            }
            score += destEmpty ? 0 : 10;
            score -= k * 0.01; // เท่ากัน → เลือกกองถัดไปทางขวา (แตะซ้ำจะวนไปกองอื่น)
            candidates.push({ mv, score });
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].mv;
    }

    /** คำใบ้: การเดินที่น่าเล่นที่สุดตอนนี้ (หรือ {draw:true}) หรือ null = ไม่มีทางไป */
    function hint(s) {
        if (isWon(s)) return null;
        const moves = legalMoves(s);
        let best = null, bestScore = -Infinity;
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (m.draw) continue;
            let score = -1;
            if (typeof m.from === 'number' && m.to === 'F') {
                const p = s.t[m.from];
                score = 60 + (p.length - 1 === s.h[m.from] && s.h[m.from] > 0 ? 25 : 0);
            } else if (m.from === 'w' && m.to === 'F') score = 55;
            else if (typeof m.from === 'number' && typeof m.to === 'number') {
                if (!isUsefulTableauMove(s, m)) continue;
                const start = s.t[m.from].length - m.n;
                score = 40 + (start === s.h[m.from] ? s.h[m.from] * 2 : 0);
                if (s.t[m.to].length === 0) score -= 5;
            } else if (m.from === 'w') score = 35;
            else continue; // ช่องเก็บ → กองล่าง ไม่แนะนำ
            if (score > bestScore) { bestScore = score; best = m; }
        }
        if (best) return best;
        if (s.stock.length || s.waste.length) return hasProgress(s) ? { draw: true } : null;
        return null;
    }

    /** เปิดหมดแล้ว (ไม่มีใบคว่ำในกองล่าง) */
    function allRevealed(s) { return s.h.every(h => h === 0); }

    /**
     * แผนเก็บไพ่อัตโนมัติ: ใช้ได้เมื่อเปิดหมดแล้ว — คืน array การเดินจนชนะ หรือ null ถ้าจำลองแล้วไม่จบ
     */
    function autoCompletePlan(state) {
        if (!allRevealed(state) || isWon(state)) return null;
        let s = state;
        const plan = [];
        let idle = 0;
        for (let guard = 0; guard < 2000 && !isWon(s); guard++) {
            let mv = null;
            // ใบที่ต่ำที่สุดก่อน → ภาพดูเป็นระเบียบ
            let low = 99;
            for (let i = 0; i < 7; i++) {
                const p = s.t[i];
                if (p.length && canFoundation(s, p[p.length - 1]) && rankOf(p[p.length - 1]) < low) {
                    low = rankOf(p[p.length - 1]); mv = { from: i, to: 'F', n: 1 };
                }
            }
            if (s.waste.length && canFoundation(s, s.waste[s.waste.length - 1]) && rankOf(s.waste[s.waste.length - 1]) <= low) {
                mv = { from: 'w', to: 'F', n: 1 };
            }
            if (!mv) {
                if (!s.stock.length && !s.waste.length) return null;
                // วางใบจากกองเปิดลงกองล่างได้ก็วาง (กันวนไม่จบในโหมดสามใบ)
                if (s.waste.length && idle > (s.stock.length + s.waste.length) / s.draw + 2) {
                    const w = s.waste[s.waste.length - 1];
                    for (let to = 0; to < 7 && !mv; to++) if (canTableau(s, w, to)) mv = { from: 'w', to, n: 1 };
                }
                if (!mv) mv = { draw: true };
                idle++;
                if (idle > 200) return null;
            } else idle = 0;
            const next = applyMove(s, mv);
            if (!next) return null;
            plan.push(mv);
            s = next;
        }
        return isWon(s) ? plan : null;
    }

    /** เกณฑ์ขั้นต่ำฝั่ง server: ชนะเร็วกว่านี้ถือว่าไม่สมเหตุสมผล */
    function minPlausibleWinMs(moveCount) { return Math.max(15000, moveCount * 150); }

    return {
        SUIT_KEYS, SUIT_SYMBOLS, SUIT_THAI, RANK_LABELS, FOUNDATION_CODES, MAX_LOG_MOVES,
        rankOf, suitOf, isRed, cardFile, cardLabel, cardThai,
        mulberry32, shuffledDeck, isValidSeed, isValidDraw,
        deal, clone, canTableau, canFoundation, isWon, isLegal, applyMove,
        encodeMove, decodeMove, splitLog, replay,
        legalMoves, isUsefulTableauMove, isSafeFoundation, hasProgress,
        autoMoveFor, hint, allRevealed, autoCompletePlan, minPlausibleWinMs
    };
}));
