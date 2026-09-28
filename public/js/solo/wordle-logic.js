/**
 * ทายคำรายวัน — ตรรกะล้วน (ไม่มี DOM / network) ใช้ร่วมกันทั้ง server และ browser
 *
 * การแบ่งช่อง (ช่อง = "cell"):
 *   ภาษาไทยมีสระบน/ล่างและวรรณยุกต์ที่ไม่กินที่ในแนวนอน จึงนับ 1 ช่อง = ตัวอักษรหลัก 1 ตัว
 *   (พยัญชนะ หรือสระหน้า/หลัง เ แ โ ใ ไ ะ า ำ ฤ) + เครื่องหมายที่เกาะอยู่บนตัวนั้น
 *   ลำดับเครื่องหมายในช่องทำให้เป็นแบบเดียวเสมอ: ตัวหลัก + สระบน/ล่าง + วรรณยุกต์/การันต์
 *   เช่น "ต้นไม้" = [ต้][น][ไ][ม้]  "น้ำผึ้ง" = [น้][ำ][ผึ้][ง]
 *
 * การให้สี (ดู scoreGuess):
 *   correct  = ช่องตรงเป๊ะ (ตัวหลัก + สระบน/ล่าง + วรรณยุกต์)
 *   present  = ตัวหลักนี้มีในคำ แต่อยู่ที่อื่น หรืออยู่ตรงนี้แต่สระ/วรรณยุกต์ไม่ตรง (near = true)
 *   absent   = ไม่มีตัวหลักนี้เหลือในคำแล้ว
 *   นับตัวซ้ำแบบ Wordle: ตัวในคำตอบแต่ละตัวถูก "ใช้" ได้ครั้งเดียว
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WordleLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const LENGTH = 4;
    const MAX_GUESSES = 6;
    const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // เวลาไทย UTC+7 ไม่มี DST
    const DAY_MS = 24 * 60 * 60 * 1000;
    const EPOCH_DAY = Math.floor(Date.UTC(2026, 8, 29) / DAY_MS); // #1 = 29 ก.ย. 2026 (เวลาไทย)

    const CONSONANTS = 'กขคฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ';
    const LEAD_VOWELS = 'เแโใไ';
    const TAIL_VOWELS = 'ะาำ';
    const OTHER_BASES = 'ฤ';
    const VOWEL_MARKS = '\u0E31\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E47'; // ั ิ ี ึ ื ุ ู ็ (สระบน/ล่าง + ไม้ไต่คู้)
    const TONE_MARKS = '\u0E48\u0E49\u0E4A\u0E4B\u0E4C'; // ไม้เอก โท ตรี จัตวา + การันต์
    const BASES = CONSONANTS + LEAD_VOWELS + TAIL_VOWELS + OTHER_BASES;
    const MARKS = VOWEL_MARKS + TONE_MARKS;

    const isConsonant = ch => CONSONANTS.indexOf(ch) !== -1;
    const isBase = ch => typeof ch === 'string' && ch.length === 1 && BASES.indexOf(ch) !== -1;
    const isVowelMark = ch => typeof ch === 'string' && ch.length === 1 && VOWEL_MARKS.indexOf(ch) !== -1;
    const isToneMark = ch => typeof ch === 'string' && ch.length === 1 && TONE_MARKS.indexOf(ch) !== -1;
    const isMark = ch => isVowelMark(ch) || isToneMark(ch);

    /** ล้างช่องว่าง/อักขระล่องหน และรวม ํ+า ที่พิมพ์แยกให้เป็น ำ */
    function normalize(input) {
        return String(input == null ? '' : input)
            .replace(/[\s​-‍﻿]/g, '')
            .replace(/ํ([่-๋]?)า/g, '$1ำ');
    }

    /** ประกอบช่องให้อยู่ในรูปมาตรฐาน: ตัวหลัก + สระบน/ล่าง + วรรณยุกต์ */
    function makeCell(base, vowel, tone) {
        return base + (vowel || '') + (tone || '');
    }

    function splitCell(cell) {
        const out = { base: cell.charAt(0), vowel: '', tone: '' };
        for (let i = 1; i < cell.length; i++) {
            const ch = cell.charAt(i);
            if (isVowelMark(ch)) out.vowel = ch;
            else if (isToneMark(ch)) out.tone = ch;
        }
        return out;
    }

    /**
     * แยกคำเป็นช่อง — คืน null ถ้ามีอักขระที่ไม่รองรับ หรือเครื่องหมายเกาะผิดที่
     * (เช่น วรรณยุกต์นำหน้าคำ, สระบนซ้อน 2 ตัว, วรรณยุกต์บนสระหน้า)
     */
    function toCells(input) {
        const text = normalize(input);
        if (!text) return null;
        const cells = [];
        let cur = null;
        for (const ch of text) {
            if (isBase(ch)) {
                if (cur) cells.push(makeCell(cur.base, cur.vowel, cur.tone));
                cur = { base: ch, vowel: '', tone: '' };
            } else if (isMark(ch)) {
                if (!cur || !isConsonant(cur.base)) return null;
                if (isVowelMark(ch)) {
                    if (cur.vowel) return null;
                    cur.vowel = ch;
                } else {
                    if (cur.tone) return null;
                    cur.tone = ch;
                }
            } else {
                return null;
            }
        }
        if (cur) cells.push(makeCell(cur.base, cur.vowel, cur.tone));
        return cells;
    }

    function canonical(input) {
        const cells = toCells(input);
        return cells ? cells.join('') : null;
    }

    const RANK = { absent: 1, present: 2, correct: 3 };

    function better(a, b) {
        return (RANK[a] || 0) >= (RANK[b] || 0) ? a : b;
    }

    /**
     * ให้สีคำทาย
     * @returns {{ states: string[], near: boolean[], keys: Object<string,string> }}
     *   keys = สถานะปุ่มคีย์บอร์ดจากคำนี้ (ตัวหลัก + เครื่องหมาย)
     */
    function scoreGuess(guessCells, answerCells) {
        const n = answerCells.length;
        if (!Array.isArray(guessCells) || guessCells.length !== n) throw new Error('length mismatch');
        const states = new Array(n).fill(null);
        const near = new Array(n).fill(false);
        const used = new Array(n).fill(false);
        const g = guessCells.map(splitCell);
        const a = answerCells.map(splitCell);

        // 1) ตรงเป๊ะ
        for (let i = 0; i < n; i++) {
            if (guessCells[i] === answerCells[i]) {
                states[i] = 'correct';
                used[i] = true;
            }
        }
        // 2) ตัวหลักถูกที่ แต่สระ/วรรณยุกต์ไม่ตรง
        for (let i = 0; i < n; i++) {
            if (states[i] || used[i]) continue;
            if (g[i].base === a[i].base) {
                states[i] = 'present';
                near[i] = true;
                used[i] = true;
            }
        }
        // 3) มีตัวหลักนี้ในช่องอื่นที่ยังไม่ถูกใช้ (ช่องที่ตรงทั้งช่องได้ก่อน)
        for (let i = 0; i < n; i++) {
            if (states[i]) continue;
            let j = -1;
            for (let k = 0; k < n; k++) {
                if (!used[k] && answerCells[k] === guessCells[i]) { j = k; break; }
            }
            if (j === -1) {
                for (let k = 0; k < n; k++) {
                    if (!used[k] && a[k].base === g[i].base) { j = k; break; }
                }
            }
            if (j === -1) {
                states[i] = 'absent';
            } else {
                states[i] = 'present';
                used[j] = true;
            }
        }

        // ปุ่มคีย์บอร์ด
        const keys = {};
        for (let i = 0; i < n; i++) {
            const base = g[i].base;
            const baseState = near[i] ? 'correct' : states[i];
            keys[base] = better(keys[base], baseState);
            [g[i].vowel, g[i].tone].forEach(mark => {
                if (!mark) return;
                let s = 'absent';
                if (a.some(cell => cell.vowel === mark || cell.tone === mark)) s = 'present';
                if (a[i].vowel === mark || a[i].tone === mark) s = 'correct';
                keys[mark] = better(keys[mark], s);
            });
        }
        return { states, near, keys };
    }

    function mergeKeys(into, keys) {
        const out = Object.assign({}, into || {});
        Object.keys(keys || {}).forEach(k => { out[k] = better(out[k], keys[k]); });
        return out;
    }

    function isWin(states) {
        return Array.isArray(states) && states.length > 0 && states.every(s => s === 'correct');
    }

    // ---------- วันที่ (เวลาไทย) ----------
    function bangkokDay(nowMs) {
        return Math.floor((Number(nowMs) + TZ_OFFSET_MS) / DAY_MS);
    }
    /** เลขข้อประจำวัน เริ่ม #1 */
    function puzzleNumber(nowMs) {
        return Math.max(1, bangkokDay(nowMs) - EPOCH_DAY + 1);
    }
    /** มิลลิวินาทีจนถึงเที่ยงคืนเวลาไทยถัดไป */
    function msUntilNext(nowMs) {
        const local = Number(nowMs) + TZ_OFFSET_MS;
        return DAY_MS - (((local % DAY_MS) + DAY_MS) % DAY_MS);
    }

    // ---------- คำตอบรายวัน ----------
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
    function permutation(size, seed) {
        const order = Array.from({ length: size }, (_, i) => i);
        const rand = mulberry32(seed);
        for (let i = size - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        }
        return order;
    }
    /**
     * index ของคำตอบข้อที่ puzzle — ใช้ครบทั้งรายการก่อนค่อยวนรอบใหม่ (สลับลำดับใหม่ทุกรอบ)
     * รอยต่อระหว่างรอบ: ถ้าคำแรกของรอบใหม่ซ้ำกับคำสุดท้ายของรอบก่อน สลับไปใช้คำถัดไปแทน
     */
    function answerIndex(puzzle, size, seed) {
        const p = Math.max(1, Math.floor(puzzle)) - 1;
        const cycle = Math.floor(p / size);
        const pos = p % size;
        const order = permutation(size, (seed + cycle * 7919) >>> 0);
        if (cycle > 0 && size > 1) {
            const prevLast = permutation(size, (seed + (cycle - 1) * 7919) >>> 0)[size - 1];
            if (order[0] === prevLast) {
                const tmp = order[0]; order[0] = order[1]; order[1] = tmp;
            }
        }
        return order[pos];
    }

    // ---------- สถิติ ----------
    function emptyStats() {
        return { played: 0, wins: 0, streak: 0, maxStreak: 0, lastWinDay: 0, lastPlayedDay: 0, dist: [0, 0, 0, 0, 0, 0] };
    }
    /** ปิดเกมของวัน puzzle — คืนสถิติใหม่ (ไม่แก้ของเดิม) */
    function finishStats(prev, puzzle, won, guessCount) {
        const s = Object.assign(emptyStats(), prev || {});
        s.dist = (Array.isArray(s.dist) && s.dist.length === MAX_GUESSES ? s.dist : emptyStats().dist).slice();
        if (s.lastPlayedDay >= puzzle) return s; // ปิดไปแล้ว
        s.played += 1;
        s.lastPlayedDay = puzzle;
        if (won) {
            s.wins += 1;
            s.streak = s.lastWinDay === puzzle - 1 ? s.streak + 1 : 1;
            s.lastWinDay = puzzle;
            s.maxStreak = Math.max(s.maxStreak, s.streak);
            const idx = Math.min(MAX_GUESSES, Math.max(1, guessCount)) - 1;
            s.dist[idx] += 1;
        } else {
            s.streak = 0;
        }
        return s;
    }
    /** สตรีคที่ยังนับอยู่ ณ วันนี้ (ถ้าเมื่อวานไม่ได้ชนะและวันนี้ก็ยังไม่ชนะ = 0) */
    function currentStreak(stats, todayPuzzle) {
        if (!stats || !stats.streak) return 0;
        return stats.lastWinDay >= todayPuzzle - 1 ? stats.streak : 0;
    }

    // ---------- แชร์ ----------
    const EMOJI = { correct: '🟩', present: '🟨', absent: '⬛' };
    function shareText(puzzle, rows, won) {
        const grid = rows.map(states => states.map(s => EMOJI[s] || '⬛').join('')).join('\n');
        const score = won ? rows.length : 'X';
        return `ทายคำรายวัน #${puzzle} ${score}/${MAX_GUESSES}\n\n${grid}\ninsider-th.me/solo/wordle`;
    }

    // ---------- การพิมพ์บนคีย์บอร์ด ----------
    /**
     * กดปุ่มตัวอักษร: ตัวหลักเปิดช่องใหม่ (ถ้ายังไม่เต็ม), เครื่องหมายเกาะช่องล่าสุด
     * สระบน/ล่างหรือวรรณยุกต์ที่กดซ้ำประเภทเดิมจะแทนที่ของเดิม
     * @returns {{ cells: string[], ok: boolean }}
     */
    function typeKey(cells, key, length) {
        const max = length || LENGTH;
        const list = Array.isArray(cells) ? cells.slice() : [];
        if (isBase(key)) {
            if (list.length >= max) return { cells: list, ok: false };
            list.push(key);
            return { cells: list, ok: true };
        }
        if (isMark(key)) {
            if (!list.length) return { cells: list, ok: false };
            const last = splitCell(list[list.length - 1]);
            if (!isConsonant(last.base)) return { cells: list, ok: false };
            if (isVowelMark(key)) last.vowel = key; else last.tone = key;
            list[list.length - 1] = makeCell(last.base, last.vowel, last.tone);
            return { cells: list, ok: true };
        }
        return { cells: list, ok: false };
    }
    /** ลบทีละอักขระ: เอาวรรณยุกต์ออกก่อน แล้วสระบน/ล่าง แล้วค่อยตัวหลัก */
    function backspace(cells) {
        const list = Array.isArray(cells) ? cells.slice() : [];
        if (!list.length) return list;
        const last = splitCell(list[list.length - 1]);
        if (last.tone) last.tone = '';
        else if (last.vowel) last.vowel = '';
        else { list.pop(); return list; }
        list[list.length - 1] = makeCell(last.base, last.vowel, last.tone);
        return list;
    }

    return {
        LENGTH,
        MAX_GUESSES,
        CONSONANTS,
        LEAD_VOWELS,
        TAIL_VOWELS,
        VOWEL_MARKS,
        TONE_MARKS,
        isBase,
        isMark,
        isConsonant,
        normalize,
        toCells,
        canonical,
        splitCell,
        scoreGuess,
        mergeKeys,
        isWin,
        bangkokDay,
        puzzleNumber,
        msUntilNext,
        permutation,
        answerIndex,
        emptyStats,
        finishStats,
        currentStreak,
        shareText,
        typeKey,
        backspace
    };
}));
