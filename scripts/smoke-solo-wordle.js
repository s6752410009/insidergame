/**
 * ทดสอบตรรกะล้วนของ "ทายคำรายวัน" (แบ่งช่องภาษาไทย, ให้สี, ตัวซ้ำ, วันที่, สตรีค, คลังคำ)
 * รัน: npm run smoke:solo:wordle
 */
const assert = require('assert');
const W = require('../public/js/solo/wordle-logic');
const game = require('../games/solo/wordle');
const { applyGuess, answerFor, buildState, ANSWERS, ALLOWED, GuessError } = game._internal;

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
    } catch (error) {
        console.error(`✗ ${name}\n  ${error.stack}`);
        process.exitCode = 1;
    }
}
const S = (guess, answer) => W.scoreGuess(W.toCells(guess), W.toCells(answer));

// ---------- แบ่งช่อง ----------
test('cells: marks attach to base consonant', () => {
    assert.deepStrictEqual(W.toCells('ต้นไม้'), ['ต้', 'น', 'ไ', 'ม้']);
    assert.deepStrictEqual(W.toCells('ทะเล'), ['ท', 'ะ', 'เ', 'ล']);
    assert.deepStrictEqual(W.toCells('น้ำผึ้ง'), ['น้', 'ำ', 'ผึ้', 'ง']);
    assert.deepStrictEqual(W.toCells('ผีเสื้อ'), ['ผี', 'เ', 'สื้', 'อ']);
    assert.deepStrictEqual(W.toCells('ตุ๊กตา'), ['ตุ๊', 'ก', 'ต', 'า']);
    assert.deepStrictEqual(W.toCells('ศิลปิน'), ['ศิ', 'ล', 'ปิ', 'น']);
});
test('cells: tone-before-vowel typing order is canonicalised', () => {
    assert.strictEqual(W.canonical('ตุ้'), W.canonical('ตุ้'));
    assert.strictEqual(W.canonical('ม่ัน'), 'มั่น');
});
test('cells: split sara am (ํ + า) is normalised', () => {
    assert.deepStrictEqual(W.toCells('น้ําตาล'), ['น้', 'ำ', 'ต', 'า', 'ล']);
});
test('cells: malformed input rejected', () => {
    assert.strictEqual(W.toCells('้กขค'), null, 'tone first');
    assert.strictEqual(W.toCells('เ้ลา'), null, 'tone on lead vowel');
    assert.strictEqual(W.toCells('กิีข'), null, 'two upper vowels');
    assert.strictEqual(W.toCells('ก่้ข'), null, 'two tones');
    assert.strictEqual(W.toCells('abcd'), null, 'latin');
    assert.strictEqual(W.toCells(''), null, 'empty');
    assert.deepStrictEqual(W.toCells(' ทะ เล​'), ['ท', 'ะ', 'เ', 'ล'], 'whitespace stripped');
});

// ---------- ให้สี ----------
test('score: exact win', () => {
    const r = S('ทะเล', 'ทะเล');
    assert.deepStrictEqual(r.states, ['correct', 'correct', 'correct', 'correct']);
    assert.ok(W.isWin(r.states));
});
test('score: same base, different tone → present + near', () => {
    const r = S('ตนไม', 'ต้นไม้'); // ไม่ใช่คำจริง ใช้ทดสอบกลไก
    assert.deepStrictEqual(r.states, ['present', 'correct', 'correct', 'present']);
    assert.deepStrictEqual(r.near, [true, false, false, true]);
    assert.strictEqual(r.keys['ต'], 'correct', 'base key counts as correct position');
});
test('score: base in another position → present, not near', () => {
    const r = S('ลเะท', 'ทะเล');
    assert.deepStrictEqual(r.states, ['present', 'present', 'present', 'present']);
    assert.deepStrictEqual(r.near, [false, false, false, false]);
});
test('score: duplicate guess letters only colour as many as the answer has', () => {
    // คำตอบมี ก ตัวเดียว (กล่อง: ก ล่ อ ง) ทาย ก สี่ตัว → เขียวช่องแรกช่องเดียว
    assert.deepStrictEqual(S('กกกก', 'กล่อง').states, ['correct', 'absent', 'absent', 'absent']);
    // ก อยู่ผิดที่สองตัว → เหลือง 1 เทา 1
    assert.deepStrictEqual(S('ลกกล', 'กล่อง').states, ['present', 'present', 'absent', 'absent']);
});
test('score: duplicates — exact match wins over earlier present', () => {
    // answer กาแก? ใช้ "กำไล" เทียบไม่ได้ — สร้างกรณีเอง
    const answer = ['ก', 'า', 'ก', 'า'];
    const r = W.scoreGuess(['า', 'า', 'า', 'ก'], answer);
    // ช่อง 2 (า) ตรงเป๊ะ, ช่อง 4 (ก) มีในคำ (ช่อง 1/3), ช่อง 1 (า) ใช้ า ช่อง 4 → present, ช่อง 3 (า) ไม่มี า เหลือแล้ว → absent
    assert.deepStrictEqual(r.states, ['present', 'correct', 'absent', 'present']);
});
test('score: duplicates — answer has 2, guess has 3', () => {
    const r = W.scoreGuess(['ม', 'ม', 'ม', 'ข'], ['ข', 'ม', 'ะ', 'ม']);
    assert.deepStrictEqual(r.states, ['present', 'correct', 'absent', 'present']);
});
test('score: exact cluster elsewhere preferred over bare base', () => {
    // guess ช่อง 1 = น้ ; คำตอบมี น (ช่อง 2) และ น้ (ช่อง 3) → ใช้ น้ ช่อง 3 ก่อน ให้ช่อง 4 (น) ได้ present จาก น ช่อง 2
    const r = W.scoreGuess(['น้', 'ก', 'ข', 'น'], ['ค', 'น', 'น้', 'ง']);
    assert.deepStrictEqual(r.states, ['present', 'absent', 'absent', 'present']);
});
test('score: mark keys', () => {
    const r = S('มั่นคง', 'มั่นคง');
    assert.strictEqual(r.keys['\u0E31'], 'correct');
    assert.strictEqual(r.keys['\u0E48'], 'correct');
    const r2 = W.scoreGuess(['กิ', 'ข', 'ค', 'ง'], ['จ', 'ฉ', 'ชิ', 'ซ']);
    assert.strictEqual(r2.keys['\u0E34'], 'present');
    assert.strictEqual(r2.keys['ก'], 'absent');
    const r3 = W.scoreGuess(['กี', 'ข', 'ค', 'ง'], ['จ', 'ฉ', 'ชิ', 'ซ']);
    assert.strictEqual(r3.keys['\u0E35'], 'absent');
});
test('mergeKeys keeps the best state', () => {
    const k = W.mergeKeys({ ก: 'correct', ข: 'absent' }, { ก: 'present', ข: 'present', ค: 'absent' });
    assert.deepStrictEqual(k, { ก: 'correct', ข: 'present', ค: 'absent' });
});

// ---------- วันที่ ----------
test('bangkok day boundary', () => {
    const midnightBkk = Date.UTC(2026, 8, 29, 17, 0, 0); // 00:00 30 ก.ย. เวลาไทย
    assert.strictEqual(W.puzzleNumber(Date.UTC(2026, 8, 29, 0, 0, 0)), 1);
    assert.strictEqual(W.puzzleNumber(midnightBkk - 1), 1);
    assert.strictEqual(W.puzzleNumber(midnightBkk), 2);
    assert.strictEqual(W.msUntilNext(midnightBkk - 1000), 1000);
    assert.strictEqual(W.msUntilNext(midnightBkk), 24 * 3600 * 1000);
    assert.strictEqual(W.puzzleNumber(0), 1, 'before epoch clamps to #1');
});

// ---------- ลำดับคำตอบ ----------
test('answers: no repeat until list exhausted, then new cycle', () => {
    const n = ANSWERS.length;
    const firstCycle = new Set();
    for (let p = 1; p <= n; p++) firstCycle.add(W.answerIndex(p, n, 12345));
    assert.strictEqual(firstCycle.size, n);
    const second = new Set();
    for (let p = n + 1; p <= 2 * n; p++) second.add(W.answerIndex(p, n, 12345));
    assert.strictEqual(second.size, n);
    for (let c = 1; c < 5; c++) {
        assert.notStrictEqual(W.answerIndex(c * n, n, 12345), W.answerIndex(c * n + 1, n, 12345), 'no back-to-back repeat across cycles');
    }
    assert.strictEqual(W.answerIndex(7, n, 1), W.answerIndex(7, n, 1), 'deterministic');
});
test('answers: ≥400, unique, all 4 cells, all allowed', () => {
    assert.ok(ANSWERS.length >= 400, `only ${ANSWERS.length}`);
    assert.strictEqual(new Set(ANSWERS).size, ANSWERS.length);
    ANSWERS.forEach(w => {
        assert.strictEqual(W.toCells(w).length, 4, w);
        assert.strictEqual(W.canonical(w), w, `not canonical: ${w}`);
        assert.ok(ALLOWED.has(w), w);
    });
    assert.ok(ALLOWED.size > 8000, `allowed ${ALLOWED.size}`);
    ALLOWED.forEach(w => {
        const c = W.toCells(w);
        if (!c || c.length !== 4) throw new Error(`bad allowed ${w}`);
    });
});

// ---------- สถิติ ----------
test('stats: streak, max, distribution, idempotent close', () => {
    let s = W.emptyStats();
    s = W.finishStats(s, 1, true, 3);
    s = W.finishStats(s, 2, true, 4);
    assert.strictEqual(s.streak, 2);
    s = W.finishStats(s, 2, true, 4); // ซ้ำวันเดิม ไม่นับเพิ่ม
    assert.strictEqual(s.played, 2);
    s = W.finishStats(s, 4, true, 1); // ข้ามวัน 3 → เริ่มใหม่
    assert.strictEqual(s.streak, 1);
    assert.strictEqual(s.maxStreak, 2);
    s = W.finishStats(s, 5, false, 6);
    assert.strictEqual(s.streak, 0);
    assert.deepStrictEqual(s.dist, [1, 0, 1, 1, 0, 0]);
    assert.strictEqual(s.played, 4);
    assert.strictEqual(s.wins, 3);
});
test('stats: current streak expires after a missed day', () => {
    const s = W.finishStats(W.finishStats(W.emptyStats(), 10, true, 2), 11, true, 2);
    assert.strictEqual(W.currentStreak(s, 11), 2);
    assert.strictEqual(W.currentStreak(s, 12), 2, 'still alive today until played');
    assert.strictEqual(W.currentStreak(s, 13), 0);
});

// ---------- แชร์ ----------
test('share text is spoiler-free', () => {
    const t = W.shareText(12, [['absent', 'present', 'absent', 'correct'], ['correct', 'correct', 'correct', 'correct']], true);
    assert.strictEqual(t, 'ทายคำรายวัน #12 2/6\n\n⬛🟨⬛🟩\n🟩🟩🟩🟩\ninsider-th.me/solo/wordle');
    assert.ok(W.shareText(3, [['absent', 'absent', 'absent', 'absent']], false).startsWith('ทายคำรายวัน #3 X/6'));
});

// ---------- คีย์บอร์ด ----------
test('typing: marks attach, replace, and respect bases', () => {
    let c = [];
    const type = k => { const r = W.typeKey(c, k, 4); c = r.cells; return r.ok; };
    assert.strictEqual(type('\u0E49'), false, 'mark with no base');
    type('ต'); type('\u0E49'); type('น'); type('ไ');
    assert.strictEqual(type('\u0E49'), false, 'no tone on ไ');
    type('ม'); type('\u0E48'); type('\u0E49'); // เปลี่ยนวรรณยุกต์
    assert.deepStrictEqual(c, ['ต้', 'น', 'ไ', 'ม้']);
    assert.strictEqual(type('ก'), false, 'full');
    c = W.backspace(c);
    assert.deepStrictEqual(c, ['ต้', 'น', 'ไ', 'ม']);
    c = W.backspace(W.backspace(c));
    assert.deepStrictEqual(c, ['ต้', 'น']);
    type('\u0E34'); type('\u0E48');
    assert.deepStrictEqual(c, ['ต้', 'นิ่']);
    c = W.backspace(c);
    assert.deepStrictEqual(c, ['ต้', 'นิ']);
});

// ---------- server (pure) ----------
test('server applyGuess: validation, progress, finish, stats', () => {
    const t0 = Date.UTC(2026, 9, 5, 3, 0, 0);
    const puzzle = W.puzzleNumber(t0);
    const answer = answerFor(puzzle);
    const wrong = ANSWERS.find(w => w !== answer);
    const expectCode = (fn, code) => {
        try { fn(); } catch (e) { assert.ok(e instanceof GuessError, e.message); assert.strictEqual(e.code, code); return; }
        throw new Error(`expected ${code}`);
    };
    expectCode(() => applyGuess(null, 'กข', puzzle, t0), 'bad_length');
    expectCode(() => applyGuess(null, 'ก่้ขคง', puzzle, t0), 'malformed');
    expectCode(() => applyGuess(null, 'กขคง', puzzle, t0), 'not_word');
    expectCode(() => applyGuess(null, wrong, puzzle - 1, t0), 'stale_puzzle');
    expectCode(() => applyGuess(null, 123, puzzle, t0), 'bad_input');

    let d = applyGuess(null, wrong, puzzle, t0);
    assert.strictEqual(d.today.guesses.length, 1);
    assert.strictEqual(d.played, 0);
    expectCode(() => applyGuess(d, wrong, puzzle, t0), 'repeat');
    const st = buildState(d, t0);
    assert.strictEqual(st.answer, null, 'answer hidden while playing');
    assert.strictEqual(st.guesses[0].states.length, 4);
    d = applyGuess(d, answer, puzzle, t0);
    assert.ok(d.today.done && d.today.won);
    assert.strictEqual(d.played, 1);
    assert.strictEqual(d.streak, 1);
    assert.deepStrictEqual(d.dist, [0, 1, 0, 0, 0, 0]);
    assert.strictEqual(buildState(d, t0).answer, answer, 'answer revealed when done');
    expectCode(() => applyGuess(d, ANSWERS.find(w => w !== answer && w !== wrong), puzzle, t0), 'done');

    // วันถัดไป: แพ้ครบ 6 ครั้ง
    const t1 = t0 + 86400000;
    const ans2 = answerFor(puzzle + 1);
    const wrongs = ANSWERS.filter(w => w !== ans2).slice(0, 6);
    wrongs.forEach(w => { d = applyGuess(d, w, puzzle + 1, t1); });
    assert.ok(d.today.done && !d.today.won);
    assert.strictEqual(d.streak, 0);
    assert.strictEqual(d.played, 2);
    assert.strictEqual(game.leaderboardEntry(d), null);
});
test('hub summary says whether today\'s word is done', () => {
    const now = Date.now();
    const puzzle = W.puzzleNumber(now);
    const answer = answerFor(puzzle);
    // เมื่อวานชนะ วันนี้ยังไม่ทาย → สตรีคยังอยู่ แต่เตือนว่ายังไม่ได้ทาย
    let d = applyGuess(null, answerFor(puzzle - 1), puzzle - 1, now - 86400000);
    assert.match(game.summary(d), /ติดกัน 1 วัน · วันนี้ยังไม่ได้ทาย/);
    d = applyGuess(d, answer, puzzle, now);
    assert.match(game.summary(d), /ติดกัน 2 วัน · วันนี้ทายแล้ว ✓/);
});
test('recordResult rejects client-submitted results', () => {
    assert.throws(() => game.recordResult(null, { won: true }), /บันทึกผลอัตโนมัติ/);
});

console.log(`${process.exitCode ? 'FAIL' : 'OK'} — ${passed} tests passed (answers ${ANSWERS.length}, allowed ${ALLOWED.size})`);
