#!/usr/bin/env node
/**
 * วาดแล้วทาย — เทสต์กติกา (rules-fidelity) เทียบ skribbl.io / Gartic / Pictionary
 *
 * ส่วน A (engine ล้วน):
 *   A1 คำมีระดับ ง่าย/กลาง/ยาก · 3 ตัวเลือก = ง่าย+กลาง+ยาก เรียงง่าย→ยาก · โหมดรวมคนละหมวด · หมวดที่ไม่มีคำง่ายยังได้ 3 คำ
 *   A2 คำของห้อง: ตัด/กรอง/ไม่ซ้ำ/จำกัดจำนวน · ผสม = 1 ใน 3 เป็นคำของห้อง · เฉพาะคำของห้อง (≥ 10 คำ) · ทายคำของห้องถูกได้
 *   A3 คำใบ้: ช่องตามกลุ่มอักษร · เปิดพยัญชนะก่อนสระหน้า/หลัง · ปิดคำใบ้ = ไม่เปิดเลย · จำนวนตัวโชว์ให้คนทาย
 *   A4 🚩 เขียนตัวหนังสือ: เกินครึ่งของคนทาย = ตาโมฆะ คืนแต้ม คนวาดไม่ได้แต้ม · กดซ้ำ = ยกเลิก · คนวาด/คนมาสายกดไม่ได้
 *       · คนทายออกจนเสียงพอ → โมฆะตอน tick · ไม่บอกว่าใครกด
 *   A5 กติกาหลักที่ยังต้องอยู่: ทุกคนทายถูก = จบตา · คนวาดคุย = เห็นเฉพาะคนที่ถูก · "เกือบแล้ว" เห็นคนเดียว
 *       · "วาดเสร็จแล้ว" ตัดเวลาเหลือ ≤ 15 วิ แต้มไม่ลด · รอบ × ทุกคนวาดคนละครั้ง
 * ส่วน B (socket จริง, data ชั่วคราว, พอร์ตว่าง): ตั้งคำของห้อง/ปิดใบ้ผ่าน updateRoom · กลางเกมแก้ห้องไม่ได้ (กันคำรั่วถึงหัวห้อง)
 *   · 🚩 ผ่าน socket จนโมฆะ
 *
 * รัน: npm run smoke:drawguess:rules
 */
const assert = require('assert');
const { setupDataDir, assertPortFree, bootServer, stopServer } = require('./drawguess-test-env');
setupDataDir('rules');
const engine = require('../games/drawguessEngine');

let seed = Number(process.env.SEED) || 20261007;
function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
engine.setRandom(rng);

let checks = 0;
function ok(cond, message) { checks += 1; assert.ok(cond, message); }
function throwsMsg(fn, re, message) {
    checks += 1;
    let threw = false;
    try { fn(); } catch (error) { threw = true; if (re) assert.ok(re.test(error.message), `${message}: got "${error.message}"`); }
    assert.ok(threw, `${message}: should throw`);
}

function makeRoom(count, settings = {}) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        players.push({ playerId: `p${i}`, playerName: `ผู้เล่น${i}`, color: '#fff', avatar: '🙂', socketId: `s${i}`, disconnectedAt: null });
    }
    const room = { roomId: 'R1', name: 'ห้องทดสอบ', admin: 'p0', players, settings: { gameMode: 'drawguess', ...settings }, gameState: engine.createInitialState() };
    room.gameState.players = players.map(p => engine.createPlayerState(p));
    return room;
}
function leave(room, playerId, now) {
    room.players = room.players.filter(p => p.playerId !== playerId);
    room.gameState.players = room.gameState.players.filter(p => p.playerId !== playerId);
    engine.handlePlayerLeft(room, playerId, now);
}
const wordsByText = new Map(engine.WORDS.map(w => [w.word, w]));
function toDraw(room, now, index = 0) {
    const st = room.gameState;
    engine.chooseWord(room, st.drawerId, index, { turnNo: st.turnNo }, now);
    engine.applyStrokes(room, st.drawerId, { turnNo: st.turnNo, ops: [{ t: 's', id: st.turnNo, c: 0, w: 1, p: [0.1, 0.1, 0.4, 0.4] }] }, now);
    return st.word;
}

// ---------------------------------------------------------------- A1 levels
(function levels() {
    const counts = { 1: 0, 2: 0, 3: 0 };
    engine.WORDS.forEach(w => { counts[w.level] = (counts[w.level] || 0) + 1; });
    ok(counts[1] >= 80 && counts[2] >= 80 && counts[3] >= 80, `ทุกระดับมีคำพอ ${JSON.stringify(counts)}`);
    ok(engine.WORDS.every(w => [1, 2, 3].includes(w.level)), 'ทุกคำมีระดับ 1–3');
    ok(engine.parseWordList('category,word,aliases,level\nสัตว์,แมว,,1\nสัตว์,หมา,สุนัข\nสัตว์,ม้า,,9')
        .map(w => w.level).join() === '1,2,2', 'parse: ไม่มี/ผิด = กลาง');

    // โหมดรวม: ง่าย+กลาง+ยาก คนละหมวด เรียงง่าย→ยาก · ไม่มีคำซ้ำในเกม
    const room = makeRoom(4, { drawguessRounds: 4 });
    let now = 1_000_000;
    engine.startGame(room, now);
    const seen = new Set();
    for (let turn = 0; turn < 16; turn += 1) {
        const st = room.gameState;
        ok(st.phase === 'choose', 'ช่วงเลือกคำ');
        const levelsOf = st.choices.map(c => c.level);
        ok(levelsOf.join() === '1,2,3', `ตัวเลือก ง่าย/กลาง/ยาก เรียง: ${levelsOf}`);
        ok(new Set(st.choices.map(c => c.category)).size === 3, 'โหมดรวม: คนละหมวด');
        st.choices.forEach(c => { ok(!seen.has(c.word), `คำไม่ซ้ำในเกม ${c.word}`); seen.add(c.word); });
        const view = engine.buildClientState(room, st.drawerId, now);
        ok(view.choices.map(c => c.levelName).join() === 'ง่าย,กลาง,ยาก', 'คนวาดเห็นป้ายระดับ');
        engine.skipTurn(room, 'p0', { turnNo: st.turnNo }, now);
        now += 10_000;
        engine.tick(room, now);
        if (st.phase === 'finished') break;
    }

    // หมวดอาชีพไม่มีคำง่าย → ยังได้ 3 คำในหมวด
    const jobs = makeRoom(3, { drawguessCategory: 'jobs' });
    engine.startGame(jobs, 5_000_000);
    ok(jobs.gameState.choices.length === 3 && jobs.gameState.choices.every(c => c.category === 'jobs'), 'หมวดเดียว: 3 คำในหมวด');
    ok(jobs.gameState.choices.some(c => c.level === 3) && jobs.gameState.choices.some(c => c.level === 2), 'หมวดที่ไม่มีคำง่าย: ยังคละกลาง/ยาก');
})();

// ---------------------------------------------------------------- A2 custom words
(function customWords() {
    const clean = engine.sanitizeCustomWords('ครูสมศรี, ร้านป้าแดง\nหมาบ้านเรา,,ครูสมศรี ,  !!! ,' + 'ก'.repeat(25) + ', ครู สมศรี');
    ok(clean.join('|') === 'ครูสมศรี|ร้านป้าแดง|หมาบ้านเรา', `ตัด/กรอง/ไม่ซ้ำ: ${clean.join('|')}`);
    ok(engine.sanitizeCustomWords(Array.from({ length: 300 }, (_, i) => `คำ${i}`)).length === engine.CUSTOM_MAX_WORDS, 'สูงสุด 200 คำ');
    ok(engine.sanitizeCustomWords([{ x: 1 }, null, 'แมว']).join() === 'แมว', 'อาร์เรย์ขยะถูกตัด');
    const few = engine.sanitizeSettings({ drawguessCustomWords: 'ก1,ก2,ก3', drawguessCustomOnly: true });
    ok(few.customWords.length === 3 && few.customOnly === false, 'เฉพาะคำของห้อง ต้องมี ≥ 10 คำ');
    const tenWords = Array.from({ length: 10 }, (_, i) => `ของห้อง${i + 1}`);
    ok(engine.sanitizeSettings({ drawguessCustomWords: tenWords, drawguessCustomOnly: 1 }).customOnly === true, '10 คำ → ใช้เฉพาะได้');
    ok(engine.sanitizeSettings({}).hints === true && engine.sanitizeSettings({ drawguessHints: 0 }).hints === false, 'คำใบ้ ค่าเริ่ม เปิด · 0 = ปิด');

    // ผสม: ทุกตา 1 ใน 3 เป็นคำของห้อง (จนกว่าจะหมด) + มีคำง่ายเสมอ
    const custom = ['ครูสมศรี', 'ร้านป้าแดง', 'หมาบ้านเรา', 'แมว'];
    const room = makeRoom(3, { drawguessCustomWords: custom, drawguessRounds: 2 });
    let now = 2_000_000;
    engine.startGame(room, now);
    const st = room.gameState;
    const customSeen = new Set();
    for (let turn = 0; turn < 4; turn += 1) {
        const picks = st.choices;
        ok(picks.length === 3, 'ผสม: 3 คำ');
        const fromCustom = picks.filter(c => c.category === 'custom');
        ok(fromCustom.length === 1, `ผสม: คำของห้อง 1 คำ (ตา ${turn + 1})`);
        fromCustom.forEach(c => customSeen.add(c.word));
        ok(picks.some(c => c.level === 1), 'ผสม: มีคำง่าย');
        ok(picks[picks.length - 1].category === 'custom', 'คำของห้องอยู่ท้าย');
        const view = engine.buildClientState(room, st.drawerId, now);
        ok(view.choices.some(c => c.category === 'คำของห้อง' && c.levelName === ''), 'ป้าย "คำของห้อง" ไม่มีระดับ');
        engine.skipTurn(room, 'p0', { turnNo: st.turnNo }, now);
        now += 10_000;
        engine.tick(room, now);
    }
    ok(customSeen.size === 4, 'คำของห้องวนครบไม่ซ้ำ');

    // เฉพาะคำของห้อง: ทุกตัวเลือกมาจากคำของห้อง · ทายถูกได้ · คำของห้องที่ตรงกับคำในเว็บ ใช้คำพ้องของเว็บด้วย
    const only = makeRoom(3, { drawguessCustomWords: [...tenWords, 'หมา'], drawguessCustomOnly: true });
    now = 3_000_000;
    engine.startGame(only, now);
    const os = only.gameState;
    ok(os.choices.every(c => c.category === 'custom'), 'เฉพาะคำของห้อง: ทุกตัวเลือกเป็นคำของห้อง');
    const idx = os.choices.findIndex(c => c.word !== 'หมา');
    engine.chooseWord(only, os.drawerId, idx, { turnNo: os.turnNo }, now);
    const guesser = only.players.find(p => p.playerId !== os.drawerId).playerId;
    ok(engine.submitGuess(only, guesser, os.word, {}, now + 1000).result === 'correct', 'ทายคำของห้องถูก');
    const g2 = engine.buildClientState(only, os.drawerId, now + 1000);
    ok(g2.wordCategory === 'คำของห้อง', 'หมวดที่โชว์ = คำของห้อง');

    const alias = makeRoom(3, { drawguessCustomWords: ['หมา', ...tenWords], drawguessCustomOnly: true });
    now = 3_500_000;
    engine.startGame(alias, now);
    let guard = 0;
    while (!alias.gameState.choices.some(c => c.word === 'หมา') && guard < 20) {
        guard += 1;
        engine.skipTurn(alias, 'p0', { turnNo: alias.gameState.turnNo }, now);
        now += 10_000;
        engine.tick(alias, now);
    }
    const as = alias.gameState;
    if (as.phase === 'choose') {
        engine.chooseWord(alias, as.drawerId, as.choices.findIndex(c => c.word === 'หมา'), { turnNo: as.turnNo }, now);
        const g = alias.players.find(p => p.playerId !== as.drawerId).playerId;
        ok(engine.submitGuess(alias, g, 'สุนัข', {}, now + 500).result === 'correct', 'คำของห้องที่ตรงคำเว็บ รับคำพ้อง (สุนัข)');
    }
})();

// ---------------------------------------------------------------- A3 hints
(function hints() {
    ok(engine.graphemes('แมว').join('|') === 'แ|ม|ว', 'แมว = 3 ช่อง');
    // แมว: เปิด 1 ช่อง ต้องเป็นพยัญชนะ (ม/ว) ไม่ใช่สระหน้า แ
    for (let i = 0; i < 60; i += 1) {
        const plan = engine.hintPlanFor('แมว', 80000);
        ok(plan.length === 1 && plan[0].index !== 0, 'แมว: ใบ้พยัญชนะ ไม่ใบ้ แ');
        const plan2 = engine.hintPlanFor('ไอศกรีม', 80000);
        ok(plan2.every(h => h.index !== 0), 'ไอศกรีม: ไม่เปิด ไ ก่อนพยัญชนะ');
    }
    ok(engine.hintPlanFor('ดวงอาทิตย์', 80000, false).length === 0, 'ปิดคำใบ้ = ไม่มีแผนเปิด');

    // ปิดคำใบ้ทั้งห้อง: ถึง 99% ของเวลาก็ไม่เปิด · จำนวนตัวยังโชว์
    const room = makeRoom(3, { drawguessHints: 0 });
    let now = 4_000_000;
    engine.startGame(room, now);
    const word = toDraw(room, now);
    const guesser = room.players.find(p => p.playerId !== room.gameState.drawerId).playerId;
    const late = now + room.gameState.drawMs * 0.99;
    engine.tick(room, late);
    const view = engine.buildClientState(room, guesser, late);
    ok(view.mask.every(m => m.sp || m.ch === null), 'ปิดใบ้: ไม่เปิดสักตัว');
    ok(view.letterCount === engine.graphemes(word).length && view.settings.hints === false, 'คนทายเห็นจำนวนตัว + รู้ว่าปิดใบ้');

    // เปิดใบ้: ช่วงท้ายเปิด floor(40%) ตัว
    const on = makeRoom(3);
    now = 4_500_000;
    engine.startGame(on, now);
    const w2 = toDraw(on, now);
    const g = on.players.find(p => p.playerId !== on.gameState.drawerId).playerId;
    const v2 = engine.buildClientState(on, g, now + on.gameState.drawMs * 0.97);
    ok(v2.mask.filter(m => m.ch).length === Math.floor(engine.graphemes(w2).length * engine.HINT_MAX_RATIO), 'เปิดใบ้ครบ 40% ช่วงท้าย');
    ok(!JSON.stringify(v2).includes(`"${w2}"`), 'คำไม่รั่วถึงคนทาย');
})();

// ---------------------------------------------------------------- A4 report
(function report() {
    ok(engine.reportNeedFor(1) === 1 && engine.reportNeedFor(2) === 2 && engine.reportNeedFor(3) === 2
        && engine.reportNeedFor(4) === 3 && engine.reportNeedFor(5) === 3 && engine.reportNeedFor(11) === 6, 'เกินครึ่ง');

    const room = makeRoom(4);
    let now = 6_000_000;
    engine.startGame(room, now);
    const st = room.gameState;
    const drawer = st.drawerId;
    const [g1, g2, g3] = room.players.map(p => p.playerId).filter(id => id !== drawer);
    throwsMsg(() => engine.reportDrawing(room, g1, { turnNo: st.turnNo }, now), /ตอนกำลังวาด/, 'ช่วงเลือกคำแจ้งไม่ได้');
    const word = toDraw(room, now);
    const before = { ...st.scores };
    // g1 ทายถูกก่อน (ได้แต้ม) แล้วค่อยมีคนแจ้ง
    const hit = engine.submitGuess(room, g1, word, {}, now + 2000);
    ok(hit.result === 'correct' && st.scores[g1] > 0, 'g1 ทายถูกได้แต้ม');
    throwsMsg(() => engine.reportDrawing(room, drawer, { turnNo: st.turnNo }, now + 2100), /คนวาด/, 'คนวาดแจ้งตัวเองไม่ได้');
    throwsMsg(() => engine.reportDrawing(room, g2, { turnNo: st.turnNo - 1 }, now + 2100), /ตานี้จบไปแล้ว/, 'ตาเก่าแจ้งไม่ได้');

    const r1 = engine.reportDrawing(room, g2, { turnNo: st.turnNo }, now + 3000);
    ok(r1.result === 'reported' && r1.votes === 1 && r1.need === 2, `แจ้ง 1/2 ${JSON.stringify(r1)}`);
    const vDrawer = engine.buildClientState(room, drawer, now + 3000);
    ok(vDrawer.reportVotes === 1 && vDrawer.reportNeed === 2 && vDrawer.self.canReport === false, 'คนวาดเห็นจำนวนแจ้ง แต่กดไม่ได้');
    ok(vDrawer.feed.some(f => f.kind === 'report' && /เขียนตัวหนังสือ \(1\/2\)/.test(f.text)), 'ประกาศในแชท');
    ok(!JSON.stringify(vDrawer.feed.filter(f => f.kind === 'report')).includes(g2), 'ไม่บอกว่าใครแจ้ง');
    const vG2 = engine.buildClientState(room, g2, now + 3000);
    ok(vG2.self.reported === true && vG2.self.canReport === true, 'คนแจ้งเห็นว่าตัวเองแจ้งแล้ว');

    // กดซ้ำ = ยกเลิก · กดใหม่ไม่ประกาศซ้ำ
    ok(engine.reportDrawing(room, g2, { turnNo: st.turnNo }, now + 3500).result === 'unreported', 'กดซ้ำ = ยกเลิก');
    ok(engine.buildClientState(room, g2, now + 3500).reportVotes === 0, 'ยกเลิกแล้วนับ 0');
    engine.reportDrawing(room, g2, { turnNo: st.turnNo }, now + 3600);
    ok(st.feed.filter(f => f.kind === 'report').length === 1, 'กดใหม่ไม่สแปมแชท');

    const r2 = engine.reportDrawing(room, g3, { turnNo: st.turnNo }, now + 4000);
    ok(r2.result === 'voided', 'แจ้งครบ 2/3 → โมฆะ');
    ok(st.phase === 'reveal' && st.lastTurn.reason === 'reported' && st.lastTurn.voided === true, 'ตาจบ เหตุผล reported');
    ok(Object.keys(before).every(id => st.scores[id] === before[id]), `คืนแต้มทุกคน ${JSON.stringify(st.scores)}`);
    ok(st.lastTurn.deltas.length === 0, 'ไม่มีใครได้แต้มตานี้');
    ok((st.tally[drawer]?.drew || 0) === 0 && (st.tally[g1]?.hits || 0) === 0, 'ไม่นับในสรุปรายคน');
    const vEnd = engine.buildClientState(room, g1, now + 4000);
    ok(vEnd.lastTurn.voided === true && vEnd.feed.some(f => f.kind === 'reveal' && /ไม่นับแต้ม/.test(f.text)), 'ทุกคนเห็นว่าโมฆะ + เฉลย');

    // คนมาสายแจ้งไม่ได้ · คนทายออกจนเสียงพอ → tick โมฆะ
    now += 20_000;
    engine.tick(room, now);
    const st2 = room.gameState;
    ok(st2.phase === 'choose', 'ตาถัดไป');
    room.players.push({ playerId: 'late', playerName: 'มาสาย', socketId: 'sl', disconnectedAt: null });
    room.gameState.players.push(engine.createPlayerState({ playerId: 'late', playerName: 'มาสาย', socketId: 'sl' }));
    engine.syncRoster(room, now);
    toDraw(room, now);
    throwsMsg(() => engine.reportDrawing(room, 'late', { turnNo: st2.turnNo }, now + 100), /เพิ่งเข้ามา/, 'คนมาสายแจ้งไม่ได้');
    const voters = room.players.map(p => p.playerId).filter(id => id !== st2.drawerId && id !== 'late');
    ok(voters.length === 3, '3 คนทาย');
    engine.reportDrawing(room, voters[0], { turnNo: st2.turnNo }, now + 200);
    ok(st2.phase === 'draw', '1/2 ยังวาดต่อ');
    leave(room, voters[1], now + 300);
    leave(room, voters[2], now + 300);
    // เหลือคนทาย 1 คน (ที่แจ้งแล้ว) → 1/1 → โมฆะทันทีที่ออก (handlePlayerLeft) หรือ tick
    engine.tick(room, now + 800);
    ok(['reveal', 'finished'].includes(st2.phase), `คนทายออกจนเสียงพอ → จบตา (${st2.phase})`);
    if (st2.phase === 'reveal') ok(st2.lastTurn.reason === 'reported', 'เหตุผล reported');
})();

// ---------------------------------------------------------------- A5 core rules still hold
(function core() {
    const room = makeRoom(3, { drawguessRounds: 2 });
    let now = 8_000_000;
    engine.startGame(room, now);
    const st = room.gameState;
    const drawers = [];
    let guard = 0;
    while (st.phase !== 'finished' && guard < 20) {
        guard += 1;
        if (st.phase === 'choose') {
            drawers.push(st.drawerId);
            const word = toDraw(room, now);
            const drawer = st.drawerId;
            const guessers = room.players.map(p => p.playerId).filter(id => id !== drawer);
            // คนวาดคุย → เห็นเฉพาะคนที่ทายถูกแล้ว
            engine.submitGuess(room, drawer, 'ใบ้ให้หน่อย', {}, now + 100);
            const unsolved = engine.buildClientState(room, guessers[1], now + 100);
            ok(!unsolved.feed.some(f => f.text === 'ใบ้ให้หน่อย' && f.turnNo === st.turnNo), 'แชทคนวาดไม่ถึงคนที่ยังไม่ถูก');
            // วาดเสร็จแล้ว → เหลือ ≤ 15 วิ แต้มยังคิดจากนาฬิกาเดิม
            const done = engine.finishDrawing(room, drawer, { turnNo: st.turnNo }, now + 1000);
            ok(done.result === 'done' && st.phaseEndsAt - (now + 1000) <= engine.DONE_GUESS_MS, 'วาดเสร็จ: ตัดเวลา');
            const fast = engine.submitGuess(room, guessers[0], word, {}, now + 1500);
            ok(fast.result === 'correct' && fast.points >= 280, `ทายเร็วยังได้แต้มเต็ม (${fast.points})`);
            // เกือบ (เห็นคนเดียว)
            const near = engine.graphemes(word).length >= 2 ? word + 'ๆ' : null;
            if (near) {
                const r = engine.submitGuess(room, guessers[1], near, {}, now + 1800);
                ok(r.result === 'close', 'เกือบแล้ว');
                const other = engine.buildClientState(room, guessers[0], now + 1800);
                ok(other.feed.filter(f => f.kind === 'close' && f.privateTo === guessers[1]).length === 0 || other.self.guessed, '"เกือบ" ไม่ถึงคนอื่นที่ยังไม่ถูก');
            }
            const slow = engine.submitGuess(room, guessers[1], word, {}, now + 2500);
            ok(slow.result === 'correct' && slow.points < fast.points, 'ทายทีหลังได้น้อยกว่า');
            ok(st.phase === 'reveal' && st.lastTurn.reason === 'all', 'ทุกคนถูก → จบตาทันที');
            ok(st.lastTurn.deltas.find(d => d.isDrawer).delta === engine.DRAWER_POINTS_PER_GUESS * 2, 'คนวาดได้ต่อคนที่ทายถูก');
        }
        now += 20_000;
        engine.tick(room, now);
    }
    ok(st.phase === 'finished' && drawers.length === 6, `2 รอบ × 3 คน = 6 ตา (${drawers.length})`);
    ok(['p0', 'p1', 'p2'].every(id => drawers.filter(d => d === id).length === 2), 'ทุกคนวาดรอบละครั้ง');
})();

console.log(`A. engine rules ✓ (${checks} checks)`);

// ---------------------------------------------------------------- B socket
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const PORT = Number(process.env.DRAWGUESS_RULES_PORT) || 8863;
const delay = ms => new Promise(r => setTimeout(r, ms));
function ack(s, e, p) {
    return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); });
}
function conn(base) {
    return new Promise((r, j) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        s.once('connect', () => r(s));
        s.once('connect_error', j);
    });
}
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = fn(); if (v) return v; await delay(40); }
    throw new Error('รอไม่ถึง: ' + label);
}

(async () => {
    await assertPortFree(PORT);
    const server = await bootServer(PORT, { DRAWGUESS_CHOOSE_MS: '4000', DRAWGUESS_DRAW_MS: '20000', DRAWGUESS_REVEAL_MS: '800' });
    const base = `http://127.0.0.1:${PORT}`;
    const players = [];
    try {
        for (let i = 0; i < 4; i += 1) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const p = { socket, id, states: [] };
            socket.on('drawguessState', s => p.states.push(s));
            players.push(p);
        }
        const last = p => p.states[p.states.length - 1];
        const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name: 'DG-Rules', gameMode: 'drawguess', maxPlayers: 8, drawguessHints: 0 });
        ok(created?.success, 'สร้างห้อง: ' + JSON.stringify(created));
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            const res = await ack(p.socket, 'joinRoom', { roomId, playerId: p.id });
            ok(res?.success, 'join');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(400);
        const words = Array.from({ length: 12 }, (_, i) => `คำห้อง${i + 1}`);
        const set = await ack(players[0].socket, 'updateRoom', { drawguessCustomWords: words.join(', ') + ', คำห้อง1', drawguessCustomOnly: 1 });
        ok(set?.success && set.room.settings.drawguessCustomWords.length === 12 && set.room.settings.drawguessCustomOnly === true
            && set.room.settings.drawguessHints === false, 'ตั้งคำของห้อง + ปิดใบ้: ' + JSON.stringify(set?.room?.settings));
        const notHost = await ack(players[1].socket, 'updateRoom', { drawguessCustomWords: 'แฮ็ก' });
        ok(notHost?.success === false, 'คนอื่นแก้คำของห้องไม่ได้');

        const started = await ack(players[0].socket, 'startGameFromLobby', { roomId });
        ok(started?.success, 'เริ่มเกม');
        await waitFor(() => players.every(p => last(p)?.phase === 'choose'), 9000, 'choose');
        const drawer = players.find(p => last(p).self.isDrawer);
        ok(last(drawer).choices.every(c => words.includes(c.word) && c.category === 'คำของห้อง'), 'ตัวเลือกจากคำของห้อง');
        ok(last(drawer).settings.customOnly === true && last(drawer).settings.customCount === 12 && last(drawer).settings.hints === false, 'state บอกค่าห้อง');
        ok(!JSON.stringify(last(players.find(p => p !== drawer))).includes('คำห้อง'), 'คนทายไม่เห็นรายการคำของห้องใน state');

        // กลางเกม: หัวห้องแก้ห้องไม่ได้ (callback จะมี gameState.word)
        const mid = await ack(players[0].socket, 'updateRoom', { drawguessRounds: 2 });
        ok(mid?.success === false && !JSON.stringify(mid).includes('"word"'), 'กลางเกมแก้ห้องไม่ได้: ' + JSON.stringify(mid).slice(0, 120));

        const turnNo = last(drawer).turnNo;
        ok((await ack(drawer.socket, 'drawguess_choose', { turnNo, index: 0 }))?.success, 'เลือกคำ');
        await waitFor(() => last(drawer).phase === 'draw', 3000, 'draw');
        const guessers = players.filter(p => p !== drawer);
        const selfReport = await ack(drawer.socket, 'drawguess_report', { turnNo });
        ok(selfReport?.success === false, 'คนวาดแจ้งตัวเองไม่ได้');
        const a = await ack(guessers[0].socket, 'drawguess_report', { turnNo });
        ok(a?.success && a.result?.result === 'reported' && a.result.need === 2, 'socket แจ้ง 1/2: ' + JSON.stringify(a));
        await waitFor(() => last(drawer).reportVotes === 1, 3000, 'คนวาดเห็น 🚩 1');
        const b = await ack(guessers[1].socket, 'drawguess_report', { turnNo });
        ok(b?.success && b.result?.result === 'voided', 'socket แจ้งครบ → โมฆะ');
        await waitFor(() => guessers.every(p => last(p).phase === 'reveal' && last(p).lastTurn?.voided), 3000, 'ทุกคนเห็นโมฆะ');
        ok(guessers.every(p => last(p).players.every(pl => pl.score === 0)), 'ไม่มีใครได้แต้ม');
        console.log(`B. socket: คำของห้อง · ปิดใบ้ · กลางเกมแก้ห้องไม่ได้ · 🚩 โมฆะ ✓`);
    } finally {
        players.forEach(p => { try { p.socket.close(); } catch (e) { /* */ } });
        await stopServer(server);
    }
    console.log(`\n✅ drawguess rules: ${checks} checks`);
    process.exit(0);
})().catch(error => {
    console.error('❌', error && error.stack || error);
    process.exit(1);
});
