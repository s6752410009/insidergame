/**
 * จับคู่การ์ดความจำ — ตรรกะล้วน (ไม่มี DOM) ใช้ร่วมกันทั้ง browser และ server
 *
 * server ใช้ replay() ตรวจผลที่ client ส่งมา: สร้างกระดานจาก seed เดิม แล้วเล่นตาม log
 * ว่าจบเกมจริงด้วยจำนวนครั้งที่อ้างไว้ — แก้ตัวเลขเฉยๆ ไม่ผ่าน
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MemoryCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const LEVELS = {
        easy: { id: 'easy', label: 'ง่าย', cols: 3, rows: 4, pairs: 6 },
        medium: { id: 'medium', label: 'กลาง', cols: 4, rows: 4, pairs: 8 },
        hard: { id: 'hard', label: 'ยาก', cols: 4, rows: 6, pairs: 12 },
        daily: { id: 'daily', label: 'ประจำวัน', cols: 4, rows: 5, pairs: 10 }
    };
    const LEVEL_IDS = ['easy', 'medium', 'hard', 'daily'];

    // ทุกสำรับมี 12 ใบ (พอสำหรับระดับยาก) — ไฟล์รูปอยู่ที่ /assets/games/solo/memory/faces/<deck>/<key>.webp
    const DECKS = {
        wolf: {
            id: 'wolf', label: 'หมาป่า',
            cards: [
                ['werewolf', 'มนุษย์หมาป่า'], ['alphaWolf', 'จ่าฝูง'], ['seer', 'ผู้หยั่งรู้'], ['witch', 'แม่มด'],
                ['cleric', 'นักบวช'], ['fool', 'ตัวตลก'], ['oracle', 'ผู้พยากรณ์'], ['revealer', 'ผู้เปิดโปง'],
                ['hunter', 'นักล่า'], ['doctor', 'หมอ'], ['vigilante', 'ศาลเตี้ย'], ['villager', 'ชาวบ้าน']
            ]
        },
        knight: {
            id: 'knight', label: 'อัศวิน',
            cards: [
                ['merlin', 'เมอร์ลิน'], ['assassin', 'มือสังหาร'], ['loyal', 'อัศวินภักดี'], ['minion', 'สมุนมอร์เดรด'],
                ['mordred', 'มอร์เดรด'], ['morgana', 'มอร์กานา'], ['oberon', 'โอเบรอน'], ['percival', 'เพอร์ซิวัล'],
                ['quest-success', 'ภารกิจสำเร็จ'], ['quest-fail', 'ภารกิจล้มเหลว'], ['crown', 'มงกุฎ'], ['token-fail', 'ดาบทรยศ']
            ]
        },
        market: {
            id: 'market', label: 'ตลาดมืด',
            cards: [
                ['boss', 'เจ้าพ่อ'], ['broker', 'นายหน้า'], ['doubleAgent', 'สายลับสองหน้า'], ['fixer', 'คนจัดการ'],
                ['hitman', 'มือปืน'], ['mole', 'หนอนบ่อนไส้'], ['smuggler', 'ขาขน'], ['armor', 'เสื้อเกราะ'],
                ['cashbag', 'ถุงเงิน'], ['crate', 'ลังสินค้า'], ['gun', 'ปืน'], ['ledger', 'บัญชีดำ']
            ]
        },
        city: {
            id: 'city', label: 'สายลับ',
            cards: [
                ['airport', 'สนามบิน'], ['bank', 'ธนาคาร'], ['beach', 'ชายหาด'], ['casino', 'คาสิโน'],
                ['circus', 'ละครสัตว์'], ['hospital', 'โรงพยาบาล'], ['space', 'สถานีอวกาศ'], ['submarine', 'เรือดำน้ำ'],
                ['sushi', 'ร้านซูชิ'], ['temple', 'วัด'], ['theater', 'โรงละคร'], ['wedding', 'งานแต่ง']
            ]
        }
    };
    const DECK_IDS = ['wolf', 'knight', 'market', 'city'];

    // ---------- สุ่มแบบกำหนด seed (ทุกเครื่องได้กระดานเดียวกัน) ----------
    function hashString(text) {
        let h = 2166136261 >>> 0;
        const s = String(text);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }
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
    function shuffle(list, rand) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
    }

    // ---------- วันที่เวลาไทย ----------
    const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
    function bangkokDate(now) {
        const t = now instanceof Date ? now.getTime() : (Number.isFinite(now) ? now : Date.now());
        return new Date(t + BKK_OFFSET_MS).toISOString().slice(0, 10);
    }
    function shiftDate(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    }
    function dailySeed(dateStr) { return 'daily-' + dateStr; }
    function dateFromDailySeed(seed) {
        const m = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(String(seed || ''));
        return m ? m[1] : null;
    }
    function dailyDeck(dateStr) { return DECK_IDS[hashString('deck:' + dateStr) % DECK_IDS.length]; }

    function isValidSeed(seed) { return typeof seed === 'string' && /^[a-z0-9-]{1,40}$/.test(seed); }

    // ---------- กระดาน ----------
    function makeBoard(levelId, seed, deckId) {
        const level = LEVELS[levelId];
        const deck = DECKS[deckId];
        if (!level || !deck) throw new Error('bad level/deck');
        const rand = mulberry32(hashString(levelId + '|' + deckId + '|' + seed));
        const picked = shuffle(deck.cards.map(c => c[0]), rand).slice(0, level.pairs);
        return shuffle(picked.concat(picked), rand);
    }

    function starsFor(levelId, moves) {
        const level = LEVELS[levelId];
        if (!level) return 0;
        if (moves <= Math.ceil(level.pairs * 1.6)) return 3;
        if (moves <= Math.ceil(level.pairs * 2.2)) return 2;
        return 1;
    }
    function starThresholds(levelId) {
        const level = LEVELS[levelId];
        return { three: Math.ceil(level.pairs * 1.6), two: Math.ceil(level.pairs * 2.2) };
    }

    // คะแนน: จับคู่ได้ 100 + คอมโบต่อเนื่องได้เพิ่มทีละ 50
    function matchPoints(combo) { return 100 + Math.max(0, combo - 1) * 50; }

    // เวลาน้อยที่สุดที่คนจริงทำได้ (แตะสองใบต่อครั้ง)
    function minTimeMs(levelId, moves) {
        const level = LEVELS[levelId];
        return Math.max(level.pairs * 900, moves * 400);
    }

    // ---------- สถานะเกม ----------
    function newGame(levelId, seed, deckId) {
        const cards = makeBoard(levelId, seed, deckId);
        return {
            level: levelId, seed: seed, deck: deckId,
            cards: cards,
            matched: cards.map(() => false),
            open: [],          // ใบที่เปิดรอจับคู่ (0–1 ใบ) หรือคู่ที่ผิด (2 ใบ ยังไม่คว่ำ)
            log: [],           // [[a,b], ...] ทุกครั้งที่เปิดครบสองใบ
            moves: 0, combo: 0, bestCombo: 0, score: 0, found: 0,
            done: false
        };
    }

    /**
     * เปิดการ์ดใบที่ index — คืน { state, event }
     * event: 'ignored' | 'open' | 'match' | 'miss' (miss = คู่ผิด ค้างไว้จนกว่าจะเรียก hideMiss หรือเปิดใบต่อไป)
     */
    function flip(state, index) {
        const s = state;
        if (s.done || !Number.isInteger(index) || index < 0 || index >= s.cards.length) return { state: s, event: 'ignored' };
        if (s.matched[index]) return { state: s, event: 'ignored' };
        if (s.open.length === 2) s.open = []; // คู่ผิดยังเปิดค้าง — แตะใบใหม่ = คว่ำทันทีแล้วเปิดต่อ
        if (s.open.indexOf(index) !== -1) return { state: s, event: 'ignored' };
        s.open.push(index);
        if (s.open.length === 1) return { state: s, event: 'open' };
        const a = s.open[0], b = s.open[1];
        s.moves += 1;
        s.log.push([a, b]);
        if (s.cards[a] === s.cards[b]) {
            s.matched[a] = true; s.matched[b] = true;
            s.combo += 1;
            s.bestCombo = Math.max(s.bestCombo, s.combo);
            s.score += matchPoints(s.combo);
            s.found += 1;
            s.open = [];
            if (s.found * 2 === s.cards.length) s.done = true;
            return { state: s, event: 'match', pair: [a, b] };
        }
        s.combo = 0;
        return { state: s, event: 'miss', pair: [a, b] };
    }
    function hideMiss(state) {
        if (state.open.length === 2) state.open = [];
        return state;
    }

    /** เล่นซ้ำจาก log — ใช้ทั้งตรวจฝั่ง server และกู้เกมหลังรีเฟรช */
    function replay(levelId, seed, deckId, log) {
        if (!LEVELS[levelId] || !DECKS[deckId] || !isValidSeed(seed)) return { ok: false, reason: 'bad-input' };
        if (!Array.isArray(log)) return { ok: false, reason: 'bad-log' };
        const s = newGame(levelId, seed, deckId);
        for (let i = 0; i < log.length; i++) {
            const pair = log[i];
            if (s.done) return { ok: false, reason: 'after-done' };
            if (!Array.isArray(pair) || pair.length !== 2) return { ok: false, reason: 'bad-pair' };
            const a = pair[0], b = pair[1];
            if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return { ok: false, reason: 'bad-pair' };
            if (a < 0 || b < 0 || a >= s.cards.length || b >= s.cards.length) return { ok: false, reason: 'bad-pair' };
            if (s.matched[a] || s.matched[b]) return { ok: false, reason: 'bad-pair' };
            s.open = [];
            flip(s, a);
            flip(s, b);
        }
        if (s.open.length === 2) s.open = [];
        return { ok: true, state: s };
    }


    // ---------- สถิติผู้เล่น (ใช้ทั้ง server ตอนบันทึก และ client ตอนแสดงผลทันทีก่อนบันทึกเสร็จ) ----------
    const RECENT_KEEP = 40;
    function emptyLevelStats() {
        return { plays: 0, bestTimeMs: null, bestMoves: null, bestStars: 0, bestScore: 0 };
    }
    function normalizeStats(prev) {
        const data = prev && typeof prev === 'object' ? JSON.parse(JSON.stringify(prev)) : {};
        data.v = 1;
        data.plays = Number(data.plays) || 0;
        data.totalStars = Number(data.totalStars) || 0;
        data.levels = data.levels && typeof data.levels === 'object' ? data.levels : {};
        LEVEL_IDS.forEach(function (id) {
            const cur = data.levels[id] || {};
            const base = emptyLevelStats();
            Object.keys(cur).forEach(function (k) { base[k] = cur[k]; });
            data.levels[id] = base;
        });
        const d = data.daily || {};
        data.daily = { lastDate: d.lastDate || null, streak: Number(d.streak) || 0, bestStreak: Number(d.bestStreak) || 0, last: d.last || null };
        data.recent = Array.isArray(data.recent) ? data.recent.slice(-RECENT_KEEP) : [];
        return data;
    }
    /** r = { runId, level, seed, deck, timeMs, moves, score, bestCombo, dailyDate|null } */
    function mergeStats(prev, r, nowIso) {
        const data = normalizeStats(prev);
        const stars = starsFor(r.level, r.moves);
        const lv = data.levels[r.level];
        const isBestTime = lv.bestTimeMs === null || r.timeMs < lv.bestTimeMs;
        const isBestMoves = lv.bestMoves === null || r.moves < lv.bestMoves;
        lv.plays += 1;
        if (isBestTime) lv.bestTimeMs = r.timeMs;
        if (isBestMoves) lv.bestMoves = r.moves;
        lv.bestStars = Math.max(lv.bestStars, stars);
        lv.bestScore = Math.max(lv.bestScore, r.score || 0);
        data.plays += 1;
        data.totalStars += stars;
        if (r.dailyDate) {
            const d = data.daily;
            d.streak = d.lastDate === shiftDate(r.dailyDate, -1) ? d.streak + 1 : (d.lastDate === r.dailyDate ? d.streak : 1);
            d.bestStreak = Math.max(d.bestStreak, d.streak);
            d.lastDate = r.dailyDate;
            d.last = { date: r.dailyDate, timeMs: r.timeMs, moves: r.moves, stars: stars, score: r.score || 0, deck: r.deck };
        }
        data.recent.push({ runId: r.runId, seed: r.seed, level: r.level, deck: r.deck });
        data.recent = data.recent.slice(-RECENT_KEEP);
        data.lastResult = {
            runId: r.runId, level: r.level, timeMs: r.timeMs, moves: r.moves, stars: stars, score: r.score || 0,
            bestCombo: r.bestCombo || 0, isBestTime: isBestTime, isBestMoves: isBestMoves, at: nowIso || new Date().toISOString()
        };
        return data;
    }
    /** สตรีครายวันที่ยังไม่ขาด (เล่นล่าสุดวันนี้หรือเมื่อวาน) */
    function liveStreak(data, now) {
        const d = data && data.daily;
        if (!d || !d.lastDate) return 0;
        const today = bangkokDate(now);
        return d.lastDate === today || d.lastDate === shiftDate(today, -1) ? d.streak : 0;
    }

    function formatTime(ms) {
        const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const m = Math.floor(total / 60), sec = total % 60;
        return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function formatTimePrecise(ms) {
        const v = Math.max(0, Number(ms) || 0);
        const m = Math.floor(v / 60000);
        const s = ((v % 60000) / 1000).toFixed(1);
        return m + ':' + (Number(s) < 10 ? '0' : '') + s;
    }

    function cardName(deckId, key) {
        const deck = DECKS[deckId];
        const hit = deck && deck.cards.find(c => c[0] === key);
        return hit ? hit[1] : key;
    }

    return {
        LEVELS, LEVEL_IDS, DECKS, DECK_IDS,
        hashString, mulberry32, shuffle,
        bangkokDate, shiftDate, dailySeed, dateFromDailySeed, dailyDeck, isValidSeed,
        makeBoard, starsFor, starThresholds, matchPoints, minTimeMs,
        newGame, flip, hideMiss, replay,
        formatTime, formatTimePrecise, cardName,
        normalizeStats, mergeStats, liveStreak
    };
});
