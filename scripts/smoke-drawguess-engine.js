#!/usr/bin/env node
/**
 * วาดแล้วทาย — เทสต์ engine ล้วน (ไม่มีเซิร์ฟเวอร์)
 * ตัวช่วยตัวอักษรไทย · คำใบ้ · คำซ้ำ · แต้ม · เส้นวาด · หลุด/ออก/กลับมา · เกมสุ่มหลายร้อยเกม + invariants
 */

const assert = require('assert');
const engine = require('../games/drawguessEngine');

let seed = Number(process.env.SEED) || 20261003;
function rng() {
    // mulberry32 — สุ่มแบบกำหนดได้ เทสต์ซ้ำได้ผลเดิม
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
engine.setRandom(rng);
const rand = n => Math.floor(rng() * n);

let checks = 0;
function ok(cond, message) {
    checks += 1;
    assert.ok(cond, message);
}
function throwsMsg(fn, re, message) {
    checks += 1;
    let threw = false;
    try { fn(); } catch (error) { threw = true; if (re) assert.ok(re.test(error.message), `${message}: got "${error.message}"`); }
    assert.ok(threw, `${message}: should throw`);
}

// ---------------------------------------------------------------- helpers

function makeRoom(count, settings = {}) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        players.push({ playerId: `p${i}`, playerName: `ผู้เล่น${i}`, color: '#fff', avatar: '🙂', socketId: `s${i}`, disconnectedAt: null });
    }
    const room = {
        roomId: 'R1',
        name: 'ห้องทดสอบ',
        admin: 'p0',
        players,
        settings: { gameMode: 'drawguess', ...settings },
        gameState: engine.createInitialState()
    };
    room.gameState.players = players.map(p => engine.createPlayerState(p));
    return room;
}

function leave(room, playerId, now) {
    room.players = room.players.filter(p => p.playerId !== playerId);
    const idx = room.gameState.players.findIndex(p => p.playerId === playerId);
    let stored = null;
    if (idx >= 0) stored = room.gameState.players.splice(idx, 1)[0];
    engine.handlePlayerLeft(room, playerId, now);
    return stored;
}

function rejoin(room, stored, now) {
    room.players.push({ playerId: stored.playerId, playerName: stored.name, socketId: `s-${stored.playerId}-${now}`, disconnectedAt: null });
    room.gameState.players.push({ ...stored });
    engine.syncRoster(room, now);
}

function guessedWordOf(room) { return room.gameState.word; }

function stateJson(room, viewer, now) {
    return JSON.stringify(engine.buildClientState(room, viewer, now));
}

// ---------------------------------------------------------------- text utilities

(function textTests() {
    ok(engine.graphemes('น้ำแข็ง').join('|') === 'น้ำ|แ|ข็|ง', 'graphemes น้ำแข็ง');
    ok(engine.graphemes('ผีเสื้อ').length === 4, 'graphemes ผีเสื้อ');
    ok(engine.normalizeGuess('  ช้าง ') === 'ช้าง', 'trim');
    ok(engine.normalizeGuess('ช​ช้าง'.replace('ช​', '')) === 'ช้าง', 'zero width');
    ok(engine.normalizeGuess('ไอศ กรีม!') === 'ไอศกรีม', 'spaces/punct');
    ok(engine.normalizeGuess('PiZZa') === 'pizza', 'case fold');
    ok(engine.normalizeGuess('ช้‍าง') === 'ช้าง', 'zero width joiner');
    // NFC: สระอำแยกเป็น ํ + า ต้องรวมเป็นตัวเดียวกัน
    ok(engine.normalizeGuess('น้ํา') === engine.normalizeGuess('น้ํา'.normalize('NFC')), 'nfc');
    ok(engine.levenshtein(['a', 'b'], ['a', 'c']) === 1, 'lev');
    const n = engine.normalizeGuess;
    ok(engine.isCloseGuess(n('ไข่'), n('ไก่')), 'ไข่ ~ ไก่ (1 grapheme)');
    ok(engine.isCloseGuess(n('ไก่ทอด'), n('ไก่')), 'guess contains answer = close (never shown publicly)');
    ok(engine.isCloseGuess(n('ดอกกุหลา'), n('ดอกกุหลาบ')), 'missing last letter');
    ok(engine.isCloseGuess(n('กุหลาบ'), n('ดอกกุหลาบ')), 'contained >=3 graphemes');
    ok(!engine.isCloseGuess(n('นก'), n('นกฮูก')), 'short contained (2 graphemes) is not close');
    ok(engine.isCloseGuess(n('ปลา'), n('ปลาวาฬ')), 'contained 3 graphemes is close');
    ok(!engine.isCloseGuess(n('ช้าง'), n('ช้าง')), 'exact is not close');
    ok(!engine.isCloseGuess(n('ปู'), n('งู')), '1-grapheme answers: only exact');
    ok(!engine.isCloseGuess(n('รถไฟ'), n('ดวงจันทร์')), 'unrelated');
})();

// ---------------------------------------------------------------- word list

(function wordTests() {
    ok(engine.WORDS.length >= 400, `400+ words (${engine.WORDS.length})`);
    const cats = new Set(engine.WORDS.map(w => w.category));
    ok(cats.size === 8, '8 categories');
    engine.CATEGORY_LIST.forEach(c => ok(engine.WORDS.filter(w => w.category === c.id).length >= 40, `category ${c.name} >= 40`));
    const all = new Set();
    engine.WORDS.forEach(w => {
        ok(!all.has(w.word), `duplicate ${w.word}`);
        all.add(w.word);
        ok(/^[฀-๿ ]+$/.test(w.word), `thai only: ${w.word}`);
        ok(engine.graphemes(w.word).length >= 1 && w.word.length <= 30, `length ${w.word}`);
    });
    // alias ห้ามซ้ำกับคำอื่น (ไม่งั้นทายคำหนึ่งแล้วไปถูกอีกคำ)
    engine.WORDS.forEach(w => w.aliases.forEach(a => ok(!all.has(a), `alias ${a} collides with a word`)));
    ok(engine.sanitizeSettings({ drawguessRounds: 9, drawguessSeconds: 5, drawguessCategory: 'x' }).rounds === 3, 'bad settings fall back');
    const s = engine.sanitizeSettings({ drawguessRounds: '4', drawguessSeconds: '100', drawguessCategory: 'food' });
    ok(s.rounds === 4 && s.drawSeconds === 100 && s.category === 'food', 'string settings');
})();

// ---------------------------------------------------------------- hints

(function hintTests() {
    engine.WORDS.forEach(w => {
        const drawMs = 80000;
        const plan = engine.hintPlanFor(w.word, drawMs);
        const letters = engine.graphemes(w.word).filter(ch => !/^\s+$/.test(ch));
        ok(plan.length <= Math.floor(letters.length * engine.HINT_MAX_RATIO), `hint cap ${w.word}`);
        plan.forEach(h => ok(h.offset >= drawMs * engine.HINT_START_RATIO, `no hint in first 30% (${w.word})`));
        ok(new Set(plan.map(h => h.index)).size === plan.length, 'distinct hint slots');
        const all = engine.buildMask(w.word, plan.map(h => h.index));
        ok(all.filter(c => c.ch).length === plan.length, 'mask reveals only planned');
    });
    const spaced = engine.buildMask('ไก่ ทอด', []);
    ok(spaced.some(c => c.sp), 'spaces kept in mask');
})();

// ---------------------------------------------------------------- deterministic flow

(function flowTest() {
    let now = 1000000;
    const room = makeRoom(4, { drawguessRounds: 2, drawguessSeconds: 60, drawguessCategory: 'animals' });
    engine.startGame(room, now);
    const st = room.gameState;
    ok(st.phase === 'choose' && st.drawerId === 'p0', 'first drawer p0 (seat order)');
    ok(st.choices.length === 3, '3 choices');
    ok(st.choices.every(c => c.category === 'animals'), 'category respected');
    // คนอื่นไม่เห็นตัวเลือก
    const other = engine.buildClientState(room, 'p1', now);
    ok(other.choices.length === 0, 'choices hidden from guessers');
    st.choices.forEach(c => ok(!stateJson(room, 'p1', now).includes(`"${c.word}"`), 'choice word not leaked'));
    ok(engine.buildClientState(room, 'p0', now).choices.length === 3, 'drawer sees choices');

    throwsMsg(() => engine.chooseWord(room, 'p1', 0, { turnNo: st.turnNo }, now), /ยังไม่ถึงตา/, 'non-drawer choose');
    throwsMsg(() => engine.chooseWord(room, 'p0', 5, { turnNo: st.turnNo }, now), /ไม่ถูกต้อง/, 'bad index');
    throwsMsg(() => engine.chooseWord(room, 'p0', 0, { turnNo: 99 }, now), /จบไปแล้ว/, 'stale turn');
    throwsMsg(() => engine.submitGuess(room, 'p0', 'แมว', {}, now), /เลือกคำก่อน/, 'drawer chat before choosing');

    engine.chooseWord(room, 'p0', 1, { turnNo: st.turnNo }, now);
    ok(st.phase === 'draw' && st.word, 'drawing');
    const word = st.word;
    ok(!stateJson(room, 'p1', now).includes(`"${word}"`), 'word hidden from guesser');
    ok(engine.buildClientState(room, 'p0', now).word === word, 'drawer sees word');
    ok(engine.buildClientState(room, 'p1', now).mask.every(c => c.sp || c.ch === null), 'no hint at start');

    // ทายผิด (สาธารณะ) · ใกล้ (ส่วนตัว) · ถูก
    now += 1000;
    let res = engine.submitGuess(room, 'p1', 'ไม่ใช่แน่ ๆ', {}, now);
    ok(res.result === 'wrong', 'wrong guess');
    ok(engine.buildClientState(room, 'p2', now).feed.some(f => f.text === 'ไม่ใช่แน่ ๆ'), 'wrong guess public');
    now += 1000;
    res = engine.submitGuess(room, 'p1', `${word}จ๋า`, {}, now);
    ok(res.result === 'close', 'contains-answer is close');
    ok(!engine.buildClientState(room, 'p2', now).feed.some(f => f.text === `${word}จ๋า`), 'close hidden from others');
    ok(engine.buildClientState(room, 'p1', now).feed.some(f => f.kind === 'close'), 'close visible to self');
    ok(engine.buildClientState(room, 'p0', now).feed.some(f => f.kind === 'close'), 'close visible to drawer');
    throwsMsg(() => engine.submitGuess(room, 'p1', 'x', {}, now + 10), /ช้าลง/, 'cooldown');
    now += 1000;
    res = engine.submitGuess(room, 'p1', ` ${word} `, {}, now);
    ok(res.result === 'correct' && res.order === 1, 'correct first');
    const p1Points = res.points;
    ok(p1Points > 0, 'points');
    ok(!stateJson(room, 'p2', now).includes(`"${word}"`), 'correct guess does not leak word to others');
    ok(engine.buildClientState(room, 'p2', now).feed.some(f => f.kind === 'correct' && f.playerId === 'p1'), 'others see ✅');
    ok(engine.buildClientState(room, 'p1', now).word === word, 'solved guesser sees word');
    // คนทายถูกแล้วพิมพ์อีก = คุยกับคนถูก/คนวาดเท่านั้น
    now += 1000;
    res = engine.submitGuess(room, 'p1', `${word} ง่ายมาก`, {}, now);
    ok(res.result === 'chat', 'solved chat');
    ok(!engine.buildClientState(room, 'p2', now).feed.some(f => f.text === `${word} ง่ายมาก`), 'solved chat hidden from unsolved');
    ok(engine.buildClientState(room, 'p0', now).feed.some(f => f.text === `${word} ง่ายมาก`), 'solved chat visible to drawer');
    // คำใบ้ออกตามเวลา
    const later = st.phaseStartedAt + Math.round(st.drawMs * 0.95);
    const masked = engine.buildClientState(room, 'p2', later).mask;
    const letters = engine.graphemes(word).filter(ch => !/^\s+$/.test(ch)).length;
    ok(masked.filter(c => c.ch).length === Math.floor(letters * engine.HINT_MAX_RATIO), 'hints revealed by 95%');

    now += 2000;
    res = engine.submitGuess(room, 'p2', word, {}, now);
    ok(res.result === 'correct' && res.order === 2 && res.points < p1Points, 'second is worth less');
    now += 2000;
    res = engine.submitGuess(room, 'p3', word, {}, now);
    ok(res.result === 'correct', 'third correct');
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'all', 'everyone guessed ends the turn');
    ok(st.scores.p0 === 3 * engine.DRAWER_POINTS_PER_GUESS, 'drawer gets per correct guesser');
    ok(engine.buildClientState(room, 'p2', now).lastTurn.word === word, 'reveal shows word');
    ok(st.lastTurn.deltas.length === 4, 'deltas for all scorers');

    // ตาต่อไป
    now = st.phaseEndsAt;
    engine.tick(room, now);
    ok(st.phase === 'choose' && st.drawerId === 'p1', 'next drawer p1');
    ok(st.canvas.strokes.length === 0 && st.canvas.turnNo === st.turnNo, 'canvas reset per turn');
    const turnWord = st.choices.map(c => c.word);
    ok(!turnWord.includes(word), 'no repeat of a used word');

    // หมดเวลาเลือก → สุ่มให้
    now = st.phaseEndsAt;
    engine.tick(room, now);
    ok(st.phase === 'draw' && turnWord.includes(st.word), 'auto pick on timeout');

    // เส้น: ตรวจทุกแบบ
    const T = st.turnNo;
    throwsMsg(() => engine.applyStrokes(room, 'p0', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 0, p: [0.1, 0.1] }] }, now), /ไม่ใช่ตาคุณ/, 'non-drawer stroke');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T - 1, ops: [{ t: 's', id: 1, c: 0, w: 0, p: [0.1, 0.1] }] }, now), /จบไปแล้ว/, 'stale turn stroke');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 99, w: 0, p: [0.1, 0.1] }] }, now), /ไม่ถูกต้อง/, 'bad color');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 9, p: [0.1, 0.1] }] }, now), /ไม่ถูกต้อง/, 'bad size');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 0, p: [0.1, NaN] }] }, now), /ไม่ถูกต้อง/, 'NaN');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 0, p: [0.1, 7] }] }, now), /ไม่ถูกต้อง/, 'out of range');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 0, p: [0.1] }] }, now), /ไม่ถูกต้อง/, 'odd points');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 'x' }] }, now), /ไม่ถูกต้อง/, 'bad op');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [] }, now), /ไม่ถูกต้อง/, 'empty');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: 'nope' }, now), /ไม่ถูกต้อง/, 'not array');
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: new Array(engine.MAX_OPS_PER_BATCH + 1).fill({ t: 'u' }) }, now), /ไม่ถูกต้อง/, 'too many ops');
    const bigPts = new Array((engine.MAX_POINTS_PER_BATCH + 1) * 2).fill(0.5);
    throwsMsg(() => engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 0, p: bigPts }] }, now), /ไม่ถูกต้อง|เยอะ/, 'oversized batch');
    ok(st.canvas.strokes.length === 0, 'rejected batches change nothing');
    let applied = engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 1, c: 3, w: 2, p: [0.1, 0.2, 0.3, 0.4] }, { t: 'p', id: 1, p: [0.5, 0.5] }] }, now);
    ok(applied.length === 2 && st.canvas.strokes[0].p.length === 6, 'stroke + continue');
    applied = engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 'p', id: 77, p: [0.5, 0.5] }] }, now);
    ok(applied.length === 0, 'continue for unknown stroke ignored');
    engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 2, c: 0, w: 0, e: 1, p: [1.01, -0.01] }] }, now);
    ok(st.canvas.strokes[1].p[0] === 1 && st.canvas.strokes[1].p[1] === 0 && st.canvas.strokes[1].e === 1, 'clamped slight overshoot, eraser');
    engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 'u' }] }, now);
    ok(st.canvas.strokes.length === 1, 'undo');
    engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 'c' }] }, now);
    ok(st.canvas.strokes.length === 0, 'clear');
    ok(engine.getCanvas(room).turnNo === T, 'getCanvas turn');
    // เพดานต่อเทิร์น
    let capped = false;
    for (let i = 0; i < 100 && !capped; i += 1) {
        const pts = new Array(engine.MAX_POINTS_PER_BATCH * 2).fill(0.5);
        try { engine.applyStrokes(room, 'p1', { turnNo: T, ops: [{ t: 's', id: 100 + i, c: 0, w: 0, p: pts }] }, now); } catch (error) { capped = /ละเอียดเกินไป/.test(error.message); }
    }
    ok(capped && st.canvas.points <= engine.MAX_POINTS_PER_TURN, 'points per turn capped');

    // หัวห้องข้ามตา
    throwsMsg(() => engine.skipTurn(room, 'p2', { turnNo: T }, now), /หัวหน้าห้อง/, 'non-host skip');
    engine.skipTurn(room, 'p0', { turnNo: T }, now);
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'skipped', 'host skip');
})();

// ---------------------------------------------------------------- "วาดเสร็จแล้ว" (คนวาดจบก่อนเวลา)

(function doneTests() {
    const DONE = engine.DONE_GUESS_MS;
    ok(DONE === 15000, 'done window 15s by default');
    let now = 7000000;
    const room = makeRoom(4, { drawguessRounds: 2, drawguessSeconds: 80 });
    const twin = makeRoom(4, { drawguessRounds: 2, drawguessSeconds: 80 });
    engine.startGame(room, now);
    engine.startGame(twin, now);
    const st = room.gameState;
    throwsMsg(() => engine.finishDrawing(room, 'p0', { turnNo: st.turnNo }, now), /ไม่ใช่ช่วงวาด/, 'done during choose');
    engine.chooseWord(room, 'p0', 0, { turnNo: st.turnNo }, now);
    engine.chooseWord(twin, 'p0', 0, { turnNo: twin.gameState.turnNo }, now);
    const originalEnd = st.phaseEndsAt;
    const T = st.turnNo;
    throwsMsg(() => engine.finishDrawing(room, 'p1', { turnNo: T }, now), /ไม่ใช่ตาคุณ/, 'only the drawer can finish');
    throwsMsg(() => engine.finishDrawing(room, 'p0', { turnNo: T - 1 }, now), /จบไปแล้ว/, 'stale turn finish');
    throwsMsg(() => engine.finishDrawing(room, 'p0', {}, now), /จบไปแล้ว/, 'missing turnNo finish');
    throwsMsg(() => engine.finishDrawing(room, 'p0', { turnNo: T }, now), /ยังไม่ได้วาด/, 'cannot finish an empty canvas');
    engine.applyStrokes(room, 'p0', { turnNo: T, ops: [{ t: 's', id: 1, c: 0, w: 1, p: [0.1, 0.1, 0.5, 0.5] }] }, now);
    engine.applyStrokes(room, 'p0', { turnNo: T, ops: [{ t: 'c' }] }, now);
    throwsMsg(() => engine.finishDrawing(room, 'p0', { turnNo: T }, now), /ยังไม่ได้วาด/, 'cleared canvas counts as empty');
    engine.applyStrokes(room, 'p0', { turnNo: T, ops: [{ t: 's', id: 2, c: 0, w: 1, p: [0.1, 0.1, 0.5, 0.5] }] }, now);
    ok(engine.buildClientState(room, 'p0', now).self.canFinish, 'drawer sees the done button');
    ok(!engine.buildClientState(room, 'p1', now).self.canFinish, 'guesser has no done button');

    // p1 ทายถูกก่อนกด (แต้มเหมือนกันทั้งสองห้อง)
    now += 10000;
    const a1 = engine.submitGuess(room, 'p1', st.word, {}, now);
    const b1 = engine.submitGuess(twin, 'p1', twin.gameState.word, {}, now);
    ok(a1.points === b1.points, 'same points before done');
    const stepBefore = st.step;
    const res = engine.finishDrawing(room, 'p0', { turnNo: T }, now);
    ok(res.result === 'done' && res.secs === 15, 'done result');
    ok(st.phaseEndsAt === now + DONE, 'time cut to the guessing window');
    ok(st.scoreEndsAt === originalEnd, 'score clock keeps the original deadline');
    ok(st.step > stepBefore, 'step bumped so clients re-render');
    const viewG = engine.buildClientState(room, 'p2', now);
    ok(viewG.drawDone && viewG.drawDoneAt === now && viewG.phaseEndsAt === now + DONE, 'guessers see done + new deadline');
    ok(viewG.feed.some(f => f.kind === 'done' && /วาดเสร็จแล้ว! เหลือ 15 วินาที/.test(f.text)), 'announced to everyone');
    ok(st.fx.some(f => f.kind === 'done' && f.secs === 15 && f.turnNo === T), 'done fx');
    ok(!engine.buildClientState(room, 'p0', now).self.canFinish, 'button gone after pressing');
    ok(engine.buildClientState(room, 'p0', now).self.canDraw, 'drawer can still add details');
    throwsMsg(() => engine.finishDrawing(room, 'p0', { turnNo: T }, now + 10), /ไปแล้ว/, 'once per turn');
    // แต้มหลังกด = แต้มถ้าไม่ได้กด (นาฬิกาเดิม)
    now += 4000;
    const a2 = engine.submitGuess(room, 'p2', st.word, {}, now);
    const b2 = engine.submitGuess(twin, 'p2', twin.gameState.word, {}, now);
    ok(a2.result === 'correct' && a2.points === b2.points, `points unaffected by done (${a2.points} vs ${b2.points})`);
    ok(st.phase === 'draw', 'still drawing within the window');
    // หมดช่วงทาย → จบตา (timeout)
    engine.tick(room, st.phaseEndsAt - 1);
    ok(st.phase === 'draw', 'not before the window ends');
    engine.tick(room, st.phaseEndsAt);
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'timeout', 'window ends the turn');
    ok(st.lastTurn.deltas.find(d => d.playerId === 'p0').delta === 2 * engine.DRAWER_POINTS_PER_GUESS, 'drawer points unchanged');
    ok(engine.buildClientState(room, 'p1', st.phaseStartedAt).nextDrawerId === 'p1', 'reveal previews next drawer');
    // ตาใหม่: drawDone ล้างแล้ว
    engine.tick(room, st.phaseEndsAt);
    ok(st.phase === 'choose' && !st.drawDoneAt && !engine.buildClientState(room, 'p1', st.phaseStartedAt).drawDone, 'done flag reset next turn');

    // เหลือเวลาน้อยกว่าช่วงทาย → ไม่ยืดเวลา ประกาศตามที่เหลือจริง
    engine.chooseWord(room, 'p1', 0, { turnNo: st.turnNo }, st.phaseStartedAt);
    engine.applyStrokes(room, 'p1', { turnNo: st.turnNo, ops: [{ t: 's', id: 3, c: 0, w: 1, p: [0.2, 0.2, 0.4, 0.4] }] }, st.phaseStartedAt);
    const end2 = st.phaseEndsAt;
    const late = end2 - 6200;
    const r2 = engine.finishDrawing(room, 'p1', { turnNo: st.turnNo }, late);
    ok(st.phaseEndsAt === end2 && r2.secs === 7, 'never extends time; announces what is left');
    // ทุกคนทายถูกหลังกดเสร็จ → จบทันที
    ['p0', 'p2', 'p3'].forEach((id, i) => engine.submitGuess(room, id, st.word, {}, late + 500 + i * 400));
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'all', 'everyone guessed after done → ends now');

    // สรุปรายคนตอนจบ + ตาสุดท้ายไม่มีคนวาดต่อ
    const room4 = makeRoom(3, { drawguessRounds: 2 });
    let t4 = 9000000;
    engine.startGame(room4, t4);
    const s4 = room4.gameState;
    let lastRevealView = null;
    while (s4.phase !== 'finished') {
        if (s4.phase === 'choose') engine.chooseWord(room4, s4.drawerId, 0, { turnNo: s4.turnNo }, t4);
        else if (s4.phase === 'draw') {
            const g = Object.keys(s4.roster).find(id => id !== s4.drawerId && !s4.guessed[id]);
            engine.submitGuess(room4, g, s4.word, {}, t4);
            t4 = s4.phaseEndsAt;
            engine.tick(room4, t4);
        } else {
            lastRevealView = engine.buildClientState(room4, 'p0', t4);
            t4 = s4.phaseEndsAt;
            engine.tick(room4, t4);
        }
        t4 += 1;
    }
    ok(lastRevealView && lastRevealView.lastTurnOfGame && !lastRevealView.nextDrawerId, 'last reveal says the game is ending');
    const rows = engine.buildClientState(room4, 'p0', t4).standings;
    // 3 คน × 2 รอบ = 6 ตา · ตาละ 1 คนทายถูก (คนแรกที่ยังไม่ถูก)
    ok(rows.every(r => r.chances === 4 && r.drew === 2 && r.drawHits === 2) && rows.reduce((n, r) => n + r.hits, 0) === 6, 'tally per player: ' + JSON.stringify(rows.map(r => [r.hits, r.chances, r.drew, r.drawHits])));
})();

// ---------------------------------------------------------------- disconnect / leave / late join

(function presenceTests() {
    let now = 5000000;
    const room = makeRoom(3, { drawguessRounds: 2 });
    engine.startGame(room, now);
    const st = room.gameState;
    now += engine.GRACE_MS + 10; // พ้นช่วงเผื่อเริ่มเกม
    engine.chooseWord(room, 'p0', 0, { turnNo: st.turnNo }, now);
    // คนวาดหลุดสั้น ๆ — ยังไม่ข้าม
    room.players[0].socketId = null;
    room.players[0].disconnectedAt = new Date(now).toISOString();
    ok(!engine.tick(room, now + 2000) || st.phase === 'draw', 'short drop keeps drawer');
    ok(st.phase === 'draw', 'still drawing within grace');
    engine.tick(room, now + engine.GRACE_MS + 1);
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'away', 'drawer away beyond grace → skipped');
    room.players[0].socketId = 's0';
    room.players[0].disconnectedAt = null;

    // ออกกลางเกม (คนวาด) → จบตานั้น
    now += engine.GRACE_MS + 5000;
    engine.tick(room, st.phaseEndsAt);
    ok(st.phase === 'choose' && st.drawerId === 'p1', 'next drawer');
    const stored = leave(room, 'p1', st.phaseStartedAt + 100);
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'left', 'drawer left → turn ends');
    ok(stateJson(room, 'p0', now).includes('ออกจากเกม'), 'leave in feed');
    // กลับมา → ทายได้ตาถัดไป
    rejoin(room, stored, st.phaseEndsAt - 10);
    ok(!st.departed.p1, 'rejoin clears departed');
    engine.tick(room, st.phaseEndsAt);
    ok(st.phase === 'choose', 'next turn after reveal');
    // คนเข้ามาใหม่ตอนวาด → ทายตานี้ไม่ได้
    const drawer = st.drawerId;
    engine.chooseWord(room, drawer, 0, { turnNo: st.turnNo }, st.phaseStartedAt + 50);
    const t = st.phaseStartedAt + 100;
    room.players.push({ playerId: 'late', playerName: 'มาสาย', socketId: 'sl' });
    room.gameState.players.push(engine.createPlayerState({ playerId: 'late', playerName: 'มาสาย' }));
    engine.syncRoster(room, t);
    throwsMsg(() => engine.submitGuess(room, 'late', st.word, {}, t), /ตาถัดไป/, 'late joiner waits a turn');
    ok(!stateJson(room, 'late', t).includes(`"${st.word}"`), 'late joiner cannot see word');
    ok(engine.buildClientState(room, 'late', t).self.late, 'late flag');
    // คนเหลือ < 2 → จบเกม
    const room2 = makeRoom(3);
    engine.startGame(room2, 1);
    leave(room2, 'p1', 2);
    ok(room2.gameState.status === 'playing', '2 left still playing');
    leave(room2, 'p2', 3);
    ok(room2.gameState.phase === 'finished' && room2.gameState.endReason === 'notenough', '1 left → finished');
    ok(room2.gameState.countsForStats === false, 'early end before a full round is not counted');

    // ทุกคนหลุดหมด → พักรอ ไม่เผาตาทิ้ง
    const room3 = makeRoom(3);
    engine.startGame(room3, 1);
    const g = room3.gameState;
    engine.chooseWord(room3, 'p0', 0, { turnNo: g.turnNo }, 2);
    const allGone = engine.GRACE_MS * 3;
    room3.players.forEach(p => { p.socketId = null; p.disconnectedAt = new Date(3).toISOString(); });
    engine.tick(room3, allGone);
    ok(g.phase === 'reveal', 'drawer skipped');
    const turnBefore = g.turnNo;
    engine.tick(room3, g.phaseEndsAt);
    ok(g.waiting && g.turnNo === turnBefore && g.status === 'playing', 'everyone away → waiting, no turns burned');
    // ข้อมูลหลังรีสตาร์ต: markRecovered ให้เวลาทุกคนกลับมา
    engine.markRecovered(room3, g.phaseEndsAt + 1);
    engine.tick(room3, g.phaseEndsAt + 2);
    ok(g.phase === 'choose' && !g.waiting, 'after recovery the game resumes');
})();

// ---------------------------------------------------------------- randomized games

function randomGame(gameIndex) {
    const count = engine.MIN_PLAYERS !== undefined ? 3 + rand(10) : 3;
    const rounds = [2, 3, 4][rand(3)];
    const seconds = [60, 80, 100][rand(3)];
    const category = ['mixed', ...engine.CATEGORY_LIST.map(c => c.id)][rand(9)];
    const room = makeRoom(count, { drawguessRounds: rounds, drawguessSeconds: seconds, drawguessCategory: category });
    let now = 10000000 + gameIndex * 1000;
    engine.startGame(room, now);
    const st = room.gameState;
    const offered = new Set();
    const drawCounts = {};
    const storedLeavers = new Map();
    let lastTurnNo = 0;
    let steps = 0;
    const scoreAudit = {};
    const auditedTurns = new Set();
    function audit() {
        const lt = st.lastTurn;
        if (!lt || auditedTurns.has(lt.turnNo)) return;
        auditedTurns.add(lt.turnNo);
        lt.deltas.forEach(d => { scoreAudit[d.playerId] = (scoreAudit[d.playerId] || 0) + d.delta; });
        if (lt.drawerId && lt.word) {
            const drawerDelta = (lt.deltas.find(d => d.playerId === lt.drawerId) || {}).delta || 0;
            ok(drawerDelta === engine.DRAWER_POINTS_PER_GUESS * lt.guessedCount, 'drawer award = per correct guesser');
        }
    }

    while (st.phase !== 'finished') {
        steps += 1;
        audit();
        assert.ok(steps < 20000, `game ${gameIndex} did not terminate`);

        if (st.turnNo !== lastTurnNo && (st.phase === 'choose')) {
            lastTurnNo = st.turnNo;
            drawCounts[st.drawerId] = (drawCounts[st.drawerId] || 0) + 1;
            st.choices.forEach(c => {
                // ห้ามเสนอคำซ้ำในเกมเดียว (คลังพอเสมอสำหรับ ≤ 48 ตา × 3 คำ ยกเว้นหมวดเดียว)
                if (category === 'mixed') ok(!offered.has(c.word), `repeat offered ${c.word}`);
                offered.add(c.word);
            });
            ok(st.choices.length === 3, 'three choices');
            ok(!!st.drawerId && st.roster[st.drawerId] && !st.departed[st.drawerId], 'drawer is active');
        }

        // invariants ทุกจังหวะ
        if (st.phase === 'draw' || st.phase === 'choose') {
            room.gameState.players.forEach(p => {
                if (p.playerId === st.drawerId || st.guessed[p.playerId]) return;
                const json = stateJson(room, p.playerId, now);
                if (st.word) ok(!json.includes(`"${st.word}"`), 'word leaked to unsolved');
                st.choices.forEach(c => ok(!json.includes(`"${c.word}"`), 'choice leaked'));
                const view = engine.buildClientState(room, p.playerId, now);
                view.feed.filter(f => f.turnNo === st.turnNo).forEach(f => {
                    if (f.privateTo) ok(f.privateTo === p.playerId, 'someone else\'s close guess leaked');
                    ok(!f.solvedOnly, 'solved-only chat leaked');
                });
                if (view.mask) {
                    const letters = view.mask.filter(c => !c.sp).length;
                    ok(view.mask.filter(c => c.ch).length <= Math.floor(letters * engine.HINT_MAX_RATIO), 'too many hints');
                }
            });
        }
        Object.values(st.scores).forEach(v => ok(v >= 0 && Number.isFinite(v), 'score sane'));

        const r = rng();
        const active = room.gameState.players.map(p => p.playerId).filter(id => !st.departed[id]);
        if (st.phase === 'choose') {
            if (r < 0.75) engine.chooseWord(room, st.drawerId, rand(3), { turnNo: st.turnNo }, now);
            else now = st.phaseEndsAt;
        } else if (st.phase === 'draw') {
            const guessers = active.filter(id => id !== st.drawerId);
            if (r < 0.15) {
                try {
                    engine.applyStrokes(room, st.drawerId, { turnNo: st.turnNo, ops: [{ t: 's', id: steps, c: rand(12), w: rand(4), p: [rng(), rng(), rng(), rng()] }] }, now);
                } catch (error) { /* เพดาน */ }
            } else if (r < 0.5 && guessers.length) {
                const who = guessers[rand(guessers.length)];
                const roll = rng();
                const text = roll < 0.35 ? st.word : (roll < 0.5 ? `${st.word}${'ๆ'}x` : `มั่ว${rand(999)}`);
                const before = st.scores[who];
                try {
                    const res = engine.submitGuess(room, who, text, {}, now);
                    if (res.result === 'correct') {
                        ok(st.scores[who] - before === res.points, 'score delta = points');
                    }
                } catch (error) {
                    ok(/ช้าลง|ตาถัดไป|ไม่ได้อยู่/.test(error.message), `unexpected guess error ${error.message}`);
                }
            } else if (r < 0.53 && active.length > 2) {
                const who = active[rand(active.length)];
                storedLeavers.set(who, leave(room, who, now));
            } else if (r < 0.56 && storedLeavers.size) {
                const [id, stored] = storedLeavers.entries().next().value;
                storedLeavers.delete(id);
                if (stored) rejoin(room, stored, now);
            } else if (r < 0.575) {
                try {
                    const before = st.phaseEndsAt;
                    engine.finishDrawing(room, st.drawerId, { turnNo: st.turnNo }, now);
                    ok(st.phaseEndsAt <= before && st.phaseEndsAt - now <= engine.DONE_GUESS_MS, 'done only shortens, to <= window');
                } catch (error) {
                    ok(/ยังไม่ได้วาด|ไปแล้ว/.test(error.message), `unexpected done error ${error.message}`);
                }
            } else if (r < 0.58) {
                const p = room.players[rand(room.players.length)];
                if (p) { p.socketId = p.socketId ? null : `s-re-${steps}`; p.disconnectedAt = p.socketId ? null : new Date(now).toISOString(); }
            } else {
                now += 1000 + rand(15000);
            }
        } else {
            now = Math.max(now, st.phaseEndsAt || now);
        }
        now += 400;
        engine.tick(room, now);
        audit();
        // ถ้าทุกคนออฟไลน์แล้วรอ — ปลุกให้ออนไลน์ เกมต้องเดินต่อได้
        if (st.waiting) room.players.forEach(p => { p.socketId = p.socketId || `s-wake-${steps}`; p.disconnectedAt = null; });
    }

    // จบเกม
    const rows = st.standings;
    ok(rows.length >= count, 'standings include everyone who played');
    for (let i = 1; i < rows.length; i += 1) ok(rows[i - 1].score >= rows[i].score, 'standings sorted');
    rows.forEach((row, i) => {
        if (i > 0 && row.score === rows[i - 1].score) ok(row.rank === rows[i - 1].rank, 'ties share rank');
    });
    const top = rows[0].score;
    if (top > 0) {
        ok(st.winnerIds.length >= 1, 'has winner');
        st.winnerIds.forEach(id => ok(st.scores[id] === top, 'winner has top score'));
    }
    Object.keys(drawCounts).forEach(id => ok(drawCounts[id] <= rounds + 1, `draws per player bounded (${id}: ${drawCounts[id]})`));
    rows.forEach(row => ok(row.hits <= row.chances, 'tally hits <= chances'));
    ok(rows.reduce((n, row) => n + row.hits, 0) === rows.reduce((n, row) => n + row.drawHits, 0), 'tally: every correct guess credits one drawer');
    audit();
    if (st.endReason === 'complete') {
        Object.keys(scoreAudit).forEach(id => ok(scoreAudit[id] === (st.scores[id] || 0), `score audit ${id}`));
    }
    const view = engine.buildClientState(room, 'p0', now);
    ok(view.phase === 'finished' && view.standings.length === rows.length, 'finished view');
    throwsMsg(() => engine.submitGuess(room, 'p0', 'x', {}, now), /จบแล้ว/, 'no guesses after finish');
    return st.endReason;
}

const GAMES = Number(process.env.GAMES) || 400;
const reasons = {};
for (let i = 0; i < GAMES; i += 1) {
    const reason = randomGame(i);
    reasons[reason] = (reasons[reason] || 0) + 1;
}
ok(reasons.complete > GAMES * 0.3, 'most games complete normally');

console.log(`✅ drawguess engine: ${checks} checks · ${GAMES} random games ${JSON.stringify(reasons)}`);
