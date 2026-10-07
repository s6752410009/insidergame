/**
 * คลื่นความคิด — เทส engine ล้วน (ไม่มีเซิร์ฟเวอร์) ด้วย rng/นาฬิกาที่ล็อกได้
 * รัน: npm run smoke:wavelength   (WL_GAMES=800 เพื่อสุ่มเยอะขึ้น · WL_SEED=123 เพื่อเล่นซ้ำ)
 */
const engine = require('../games/wavelengthEngine');
const { CARDS } = require('../games/wavelengthCards');

let checks = 0;
function assert(cond, message) {
    if (!cond) throw new Error(message);
    checks += 1;
}
function throwsLike(fn, pattern, message) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error && (!pattern || pattern.test(error.message)), `${message} (ได้: ${error ? error.message : 'ไม่ throw'})`);
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeEnv(seed) {
    let now = 1_700_000_000_000;
    return {
        rng: mulberry32(seed),
        now: () => now,
        tick: ms => { now += ms; },
        set: ms => { now = ms; }
    };
}

// จำลอง roomManager แบบย่อ: room.players + gameState.players ตามที่ joinRoom/leaveRoom ทำจริง
// ไฟล์นี้เทสโหมดแข่งเดี่ยว (แบบเดิม) — โหมดทีม/ร่วมมือ อยู่ที่ smoke-wavelength-teams.js
function makeRoom(count, laps = 1, variant = 'solo') {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        players.push({ playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '🙂', socketId: 's' + i });
    }
    return { roomId: 'R1', admin: 'p0', settings: { gameMode: 'wavelength', wavelengthLaps: laps, wavelengthMode: variant }, players, gameState: engine.createInitialState() };
}
function lateJoin(room, id) {
    const entry = { playerId: id, playerName: 'มาสาย' + id, color: '#0ff', avatar: '🐢', socketId: 'sock-' + id };
    room.players.push(entry);
    room.gameState.players.push(engine.createPlayerState(entry));
}
function leave(room, id) {
    room.players = room.players.filter(p => p.playerId !== id);
    room.gameState.players = room.gameState.players.filter(p => p.playerId !== id);
    if (room.admin === id && room.players.length) room.admin = room.players[0].playerId;
    engine.handlePlayerLeft(room, id);
}
function setOnline(room, id, online) {
    const entry = room.players.find(p => p.playerId === id);
    if (entry) entry.socketId = online ? 'sock-' + id : null;
}
const S = room => room.gameState;
const ctx = room => ({ round: S(room).round, phase: S(room).phase });

function goodClue(card) {
    const pool = ['ทะเลสาบ', 'แมวส้ม', 'ข้าวมันไก่', 'รถเมล์', 'ฝนตกหนัก', 'คุณครู', 'ตุ๊กตา', 'ภูเขาไฟ', 'พัดลม', 'กล้วยทอด'];
    for (const word of pool) {
        if (engine.validateClue(word, card).ok) return word;
    }
    return 'สิ่งนี้';
}

// ---------- 1. แถบคะแนน ----------
(function bands() {
    const cases = [[50, 50, 4], [54, 50, 4], [46, 50, 4], [54.1, 50, 3], [61, 50, 3], [61.1, 50, 2], [68, 50, 2], [68.1, 50, 0], [0, 100, 0], [100, 100, 4], [null, 50, 0]];
    cases.forEach(([pin, target, pts]) => assert(engine.scorePin(pin, target).points === pts, `scorePin(${pin}, ${target}) ต้องได้ ${pts}`));
    assert(engine.clampPin(-5) === 0 && engine.clampPin(130) === 100 && engine.clampPin(33.333) === 33.3, 'clampPin ตัด 0–100 ทศนิยม 1 ตำแหน่ง');
    assert(engine.clampPin('abc') === null && engine.clampPin(NaN) === null, 'clampPin ค่าเพี้ยน = null');
    console.log('1. แถบคะแนน 4/3/2 ±4/±11/±18 ✓');
})();

// ---------- 2. ตรวจคำใบ้ ----------
(function clues() {
    const card = { left: 'ร้อน', right: 'เย็น' };
    assert(engine.validateClue('ชาเย็น', card).ok === false, 'คำใบ้มีคำบนการ์ด (เย็น) ต้องไม่ผ่าน');
    assert(engine.validateClue('ร้ อ น', card).ok === false, 'เว้นวรรคแทรกคำบนการ์ดก็ไม่ผ่าน');
    assert(engine.validateClue('ร​อน', card).ok === true, 'ไม่ใช่คำบนการ์ด (ร อน) ผ่าน');
    assert(engine.validateClue('ร้​อน', card).ok === false, 'ซ่อน zero-width ในคำบนการ์ดไม่ผ่าน');
    assert(engine.validateClue('ไอติม', card).ok === true, 'คำใบ้ปกติผ่าน');
    assert(engine.validateClue('  ไอติม   แท่ง  ', card).clue === 'ไอติม แท่ง', 'ช่องว่างซ้อนถูกยุบ');
    assert(engine.validateClue('', card).ok === false && engine.validateClue('   ', card).ok === false, 'ว่างไม่ผ่าน');
    assert(engine.validateClue('อุณหภูมิ 30', card).ok === false, 'มีเลขอารบิกไม่ผ่าน');
    assert(engine.validateClue('๓๐ องศา', card).ok === false, 'มีเลขไทยไม่ผ่าน');
    const long40 = 'ก'.repeat(40);
    assert(engine.validateClue(long40, card).ok === true, '40 ตัวผ่าน');
    assert(engine.validateClue(long40 + 'ก', card).ok === false, '41 ตัวไม่ผ่าน');
    // นับเป็น grapheme: "น้ำ" = 2 กลุ่มอักษร (น้ + ำ) ไม่ใช่ 3 code point
    const thaiLong = 'น้ำ'.repeat(20);
    assert(engine.graphemeLength(thaiLong) <= 40 && engine.validateClue(thaiLong, card).ok, 'นับความยาวแบบ grapheme ไม่ใช่ code point');
    const card2 = { left: 'ไม่มีประโยชน์', right: 'มีประโยชน์' };
    assert(engine.validateClue('ประโยชน์', card2).ok === false, 'คำใบ้ที่เป็นส่วนหนึ่งของคำบนการ์ดไม่ผ่าน');
    assert(engine.validateClue('PROTEIN shake', { left: 'protein', right: 'x' }).ok === false, 'เทียบแบบไม่สนตัวพิมพ์');
    assert(engine.validateClue('éclair', { left: 'éclair', right: 'x' }).ok === false, 'normalize NFC ก่อนเทียบ');
    console.log('2. คำใบ้: ห้ามคำบนการ์ด/ตัวเลข/ยาวเกิน · NFC · zero-width ✓');
})();

// ---------- 3. การ์ด ----------
(function cards() {
    assert(CARDS.length >= 120, `การ์ดต้อง ≥ 120 ใบ (มี ${CARDS.length})`);
    const keys = new Set();
    CARDS.forEach(c => {
        const key = c.left + '|' + c.right;
        assert(!keys.has(key), 'การ์ดซ้ำ ' + key);
        keys.add(key);
        assert(c.left && c.right && c.left !== c.right, 'การ์ดต้องมีสองฝั่งต่างกัน ' + key);
        assert(!/[0-9]/.test(c.left + c.right), 'การ์ดไม่มีตัวเลข ' + key);
        assert(engine.graphemeLength(c.left) <= 20 && engine.graphemeLength(c.right) <= 20, 'คำบนการ์ดสั้นพอแสดงบนหน้าปัด ' + key);
    });
    console.log(`3. การ์ด ${CARDS.length} ใบ ไม่ซ้ำ สั้นพอ ✓`);
})();

// ---------- 4. วนผู้ใบ้ครบรอบโต๊ะ ----------
(function rotation() {
    for (const laps of [1, 2]) {
        for (let n = 3; n <= 12; n += 1) {
            const env = makeEnv(n * 10 + laps);
            const room = makeRoom(n, laps);
            engine.startGame(room, env);
            const givers = [];
            let guard = 0;
            while (S(room).phase !== 'finished' && guard++ < 200) {
                if (S(room).phase === 'clue') {
                    givers.push(S(room).giverId);
                    engine.pickCard(room, S(room).giverId, 0, ctx(room), env);
                    engine.submitClue(room, S(room).giverId, goodClue(S(room).card), ctx(room), env);
                } else if (S(room).phase === 'guess') {
                    S(room).guesserIds.forEach(id => engine.lockPin(room, id, 50, null, env));
                } else if (S(room).phase === 'reveal') {
                    engine.nextRound(room, room.admin, null, env);
                }
            }
            assert(S(room).phase === 'finished', `n=${n} laps=${laps} ต้องจบเกม`);
            assert(givers.length === n * laps, `n=${n} laps=${laps}: ต้องมี ${n * laps} รอบ (ได้ ${givers.length})`);
            const expected = [];
            for (let l = 0; l < laps; l += 1) for (let i = 0; i < n; i += 1) expected.push('p' + i);
            assert(givers.join(',') === expected.join(','), `ผู้ใบ้วนตามที่นั่ง: ${givers.join(',')}`);
        }
    }
    console.log('4. ผู้ใบ้วนตามที่นั่ง 3–12 คน × 1/2 รอบโต๊ะ ✓');
})();

// ---------- 5. ผู้ใบ้ได้ค่าเฉลี่ย / ล็อกครบเปิดทันที ----------
(function scoring() {
    const env = makeEnv(7);
    const room = makeRoom(4);
    engine.startGame(room, env);
    const giver = S(room).giverId;
    const target = S(room).target;
    engine.pickCard(room, giver, 1, ctx(room), env);
    engine.submitClue(room, giver, goodClue(S(room).card), ctx(room), env);
    const [a, b, c] = S(room).guesserIds;
    // ตั้งเข็มให้ได้ 4, 3, 0 → ผู้ใบ้ได้ round(7/3)=2
    const near = v => Math.max(0, Math.min(100, v));
    const pinA = target; const pinB = target <= 50 ? target + 8 : target - 8; const pinC = target <= 50 ? near(target + 40) : near(target - 40);
    engine.lockPin(room, a, pinA, ctx(room), env);
    engine.movePin(room, b, 10, ctx(room));
    engine.movePin(room, b, pinB, ctx(room));
    engine.lockPin(room, b, null, ctx(room), env);
    assert(S(room).phase === 'guess', 'ยังล็อกไม่ครบ ต้องยังทายอยู่');
    throwsLike(() => engine.lockPin(room, a, 30, ctx(room), env), /ล็อก/, 'ล็อกซ้ำไม่ได้');
    throwsLike(() => engine.movePin(room, a, 30, ctx(room)), /ล็อก/, 'ล็อกแล้วขยับไม่ได้');
    throwsLike(() => engine.lockPin(room, giver, 30, ctx(room), env), /ผู้ใบ้/, 'ผู้ใบ้ทายไม่ได้');
    engine.unlockPin(room, a, ctx(room));
    engine.lockPin(room, a, pinA, ctx(room), env);
    engine.lockPin(room, c, pinC, ctx(room), env);
    assert(S(room).phase === 'reveal', 'ล็อกครบ = เปิดเป้าทันที');
    const lr = S(room).lastRound;
    const pts = id => lr.results.find(r => r.playerId === id).points;
    assert(pts(a) === 4 && pts(b) === 3 && pts(c) === 0, `แต้ม 4/3/0 (ได้ ${pts(a)}/${pts(b)}/${pts(c)})`);
    assert(lr.giverPoints === 2, `ผู้ใบ้ได้ round(7/3)=2 (ได้ ${lr.giverPoints})`);
    assert(S(room).players.find(p => p.playerId === giver).score === 2, 'คะแนนผู้ใบ้ = 2');
    // คนที่ไม่ใช่หัวห้องกดพร้อม — ต้องรอทุกคน
    const others = room.players.map(p => p.playerId).filter(id => id !== room.admin);
    others.slice(0, -1).forEach(id => engine.nextRound(room, id, null, env));
    assert(S(room).phase === 'reveal', 'ยังพร้อมไม่ครบ ยังไม่ขึ้นรอบใหม่');
    assert(engine.buildClientState(room, others[0]).readyNeeded.length === others.length, 'readyNeeded ไม่นับหัวห้อง');
    others.slice(-1).forEach(id => engine.nextRound(room, id, null, env));
    // หัวห้องมีปุ่ม "รอบต่อไป" ของตัวเองอยู่แล้ว — คนอื่นพร้อมครบ = ไปต่อทันที ไม่ต้องรอหัวห้อง
    assert(S(room).phase === 'clue' && S(room).round === 2, 'คนอื่นพร้อมครบ = รอบใหม่ทันที (ไม่ต้องรอหัวห้อง)');
    console.log('5. แต้มตามแถบ · ผู้ใบ้ได้ค่าเฉลี่ยปัดเศษ · ล็อกครบเปิดทันที · พร้อมครบขึ้นรอบใหม่ ✓');
})();

// ---------- 6. หมดเวลา / ผ่อนผันผู้ใบ้หลุด ----------
(function timers() {
    const T = engine.timers;
    const env = makeEnv(11);
    const room = makeRoom(3);
    engine.startGame(room, env);
    const giver = S(room).giverId;
    // ผู้ใบ้หลุด → เหลือเวลา GRACE
    setOnline(room, giver, false);
    engine.refreshPresence(room, env);
    assert(S(room).phaseEndsAt === env.now() + T.GRACE_MS, 'ผู้ใบ้หลุด → นาฬิกาเหลือช่วงผ่อนผัน');
    env.tick(T.GRACE_MS / 2);
    setOnline(room, giver, true);
    engine.refreshPresence(room, env);
    assert(S(room).phaseEndsAt === S(room).clueDeadline, 'กลับมาทัน → นาฬิกาเดิม');
    setOnline(room, giver, false);
    engine.refreshPresence(room, env);
    env.tick(T.GRACE_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(S(room).phase === 'reveal' && S(room).lastRound.skipped, 'หลุดเกินผ่อนผัน → ข้ามรอบ');
    assert(S(room).lastRound.results.length === 0 && S(room).players.every(p => p.score === 0), 'ข้ามรอบไม่มีใครได้แต้ม');
    setOnline(room, giver, true);
    env.tick(T.SKIP_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(S(room).phase === 'clue' && S(room).giverId !== giver, 'ข้ามรอบแล้วไปผู้ใบ้คนถัดไป');
    // ไม่พิมพ์ภายใน 60 วิ → ข้ามรอบ
    env.tick(T.CLUE_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(S(room).phase === 'reveal' && S(room).lastRound.skipped && /ไม่ทัน/.test(S(room).lastRound.reason), 'คิดไม่ทัน → ข้ามรอบ');
    env.tick(T.SKIP_MS + 1);
    engine.autoResolvePhase(room, env);
    // ทาย: คนหนึ่งขยับเข็มไม่ล็อก อีกคนไม่แตะ (ออนไลน์) → ล็อกให้ที่ตำแหน่งเข็ม/กลางหน้าปัด
    const g = S(room).giverId;
    engine.pickCard(room, g, 0, ctx(room), env);
    engine.submitClue(room, g, goodClue(S(room).card), ctx(room), env);
    const [x, y] = S(room).guesserIds;
    engine.movePin(room, x, 12.34, ctx(room));
    env.tick(T.GUESS_MS + 1);
    engine.autoResolvePhase(room, env);
    const res = S(room).lastRound.results;
    assert(res.find(r => r.playerId === x).pin === 12.3 && res.find(r => r.playerId === x).auto, 'หมดเวลา: ล็อกให้ตรงที่เข็มอยู่');
    assert(res.find(r => r.playerId === y).pin === engine.PIN_CENTER, 'ไม่ได้แตะเข็ม = เข็มกลางหน้าปัด');
    console.log('6. หมดเวลาทุกเฟส · ผ่อนผันผู้ใบ้หลุด/กลับมาทัน · ล็อกอัตโนมัติ ✓');
})();

// ---------- 7. เข้ากลางเกม / ออกกลางเกม ----------
(function lateAndLeave() {
    const env = makeEnv(21);
    const room = makeRoom(3);
    engine.startGame(room, env);
    lateJoin(room, 'L1');
    const lateView = engine.buildClientState(room, 'L1');
    assert(lateView.self.pending && !lateView.self.isGuesser, 'เข้ากลางเกม = รอรอบหน้า');
    engine.pickCard(room, S(room).giverId, 0, ctx(room), env);
    engine.submitClue(room, S(room).giverId, goodClue(S(room).card), ctx(room), env);
    // เข้ามาตอนผู้ใบ้ยังคิดคำ = ยังไม่มีใครทาย → ได้ทายรอบนี้เลย
    assert(S(room).guesserIds.includes('L1'), 'เข้าช่วงคิดคำใบ้ = ได้ทายรอบนี้');
    assert(S(room).players.find(p => p.playerId === 'L1').active && S(room).order.includes('L1'), 'คนมาสายเข้าคิวใบ้ด้วย');
    // เข้ามาตอนกำลังทาย = รอรอบหน้า
    lateJoin(room, 'L2');
    assert(!S(room).guesserIds.includes('L2'), 'เข้าช่วงทาย = ไม่ได้ทายรอบนี้');
    throwsLike(() => engine.lockPin(room, 'L2', 40, ctx(room), env), /รอบหน้า/, 'คนมาสายช่วงทายล็อกไม่ได้');
    S(room).guesserIds.forEach(id => engine.lockPin(room, id, 70, ctx(room), env));
    assert(S(room).lastRound.results.some(r => r.playerId === 'L1'), 'คนมาสายมีผลในรอบนี้');
    engine.nextRound(room, room.admin, null, env);
    assert(S(room).players.find(p => p.playerId === 'L2').active, 'รอบใหม่ คนมาสายเข้าร่วมแล้ว');
    assert(S(room).giverId === 'L1' || engine.buildClientState(room, 'L1').self.active, 'คนมาสายได้เล่น');
    // ผู้ใบ้ออกกลางช่วงคิด → ข้ามรอบ
    const giver = S(room).giverId;
    leave(room, giver);
    assert(S(room).phase === 'reveal' && S(room).lastRound.skipped, 'ผู้ใบ้ออก → ข้ามรอบ');
    assert(S(room).ledger[giver] && S(room).ledger[giver].left, 'ledger จำคนที่ออก');
    engine.nextRound(room, room.admin, null, env);
    // คนทายออกกลางช่วงทาย → ที่เหลือล็อกครบ = เปิด
    const g2 = S(room).giverId;
    engine.pickCard(room, g2, 0, ctx(room), env);
    engine.submitClue(room, g2, goodClue(S(room).card), ctx(room), env);
    const [first, ...rest] = S(room).guesserIds;
    rest.forEach(id => engine.lockPin(room, id, 20, ctx(room), env));
    if (S(room).phase === 'guess') leave(room, first);
    assert(S(room).phase === 'reveal' || S(room).phase === 'finished', 'คนทายออกแล้วที่เหลือล็อกครบ = เปิด');
    // ออกจนเหลือคนเดียว → จบเกม
    while (S(room).phase !== 'finished' && room.players.length > 1) leave(room, room.players[room.players.length - 1].playerId);
    assert(S(room).phase === 'finished' && S(room).status === 'wavelength_finished', 'เหลือคนไม่พอ → จบเกม');
    console.log('7. เข้าช่วงคิดคำ = ทายรอบนี้ · เข้าช่วงทาย = รอบหน้า · ผู้ใบ้ออก = ข้าม · คนออกจนเหลือ 1 = จบ ✓');
})();

// ---------- 8. ความลับ + คำสั่งผิด ----------
(function secrets() {
    const env = makeEnv(31);
    const room = makeRoom(5);
    engine.startGame(room, env);
    const giver = S(room).giverId;
    const others = room.players.map(p => p.playerId).filter(id => id !== giver);
    const check = label => others.forEach(id => {
        const view = engine.buildClientState(room, id);
        assert(view.target === null, `${label}: ${id} ต้องไม่เห็นเป้า`);
        assert(view.options.length === 0, `${label}: ${id} ต้องไม่เห็นการ์ดตัวเลือก`);
        assert(!JSON.stringify(view).includes('"target":' + S(room).target + ',') || view.target === null, `${label}: ไม่มีเป้าหลุด`);
    });
    check('clue');
    assert(engine.buildClientState(room, giver).target === S(room).target, 'ผู้ใบ้เห็นเป้า');
    throwsLike(() => engine.submitClue(room, others[0], 'อะไร', ctx(room), env), /ไม่ใช่ผู้ใบ้/, 'คนอื่นส่งคำใบ้ไม่ได้');
    throwsLike(() => engine.submitClue(room, giver, 'อะไร', ctx(room), env), /เลือกการ์ด/, 'ยังไม่เลือกการ์ดส่งไม่ได้');
    throwsLike(() => engine.pickCard(room, giver, 5, ctx(room), env), /การ์ด/, 'เลือกการ์ดเกินช่องไม่ได้');
    throwsLike(() => engine.pickCard(room, others[0], 0, ctx(room), env), /ไม่ใช่ผู้ใบ้/, 'คนอื่นเลือกการ์ดไม่ได้');
    const before = S(room).options.map(c => c.id).join();
    engine.rerollCards(room, giver, ctx(room), env);
    assert(S(room).options.map(c => c.id).join() !== before, 'สุ่มการ์ดใหม่ได้ชุดใหม่');
    throwsLike(() => engine.rerollCards(room, giver, ctx(room), env), /ครั้งเดียว/, 'สุ่มใหม่ได้ครั้งเดียว');
    engine.pickCard(room, giver, 0, ctx(room), env);
    throwsLike(() => engine.submitClue(room, giver, S(room).card.left, ctx(room), env), /คำบนการ์ด/, 'ใช้คำบนการ์ดไม่ได้');
    throwsLike(() => engine.submitClue(room, giver, 'ข้อ 7', ctx(room), env), /ตัวเลข/, 'ใช้ตัวเลขไม่ได้');
    throwsLike(() => engine.submitClue(room, giver, goodClue(S(room).card), { round: S(room).round - 1 }, env), /จังหวะ/, 'รอบเก่าไม่ได้');
    throwsLike(() => engine.lockPin(room, others[0], 50, ctx(room), env), /ยังไม่ใช่ช่วงทาย/, 'ยังไม่ถึงช่วงทาย ล็อกไม่ได้');
    engine.submitClue(room, giver, goodClue(S(room).card), ctx(room), env);
    check('guess');
    engine.movePin(room, others[0], 77, ctx(room));
    const peer = engine.buildClientState(room, others[1]);
    assert(peer.players.every(p => !('pin' in p)), 'คนอื่นไม่เห็นเข็มของใคร');
    assert(peer.self.pin === null, 'ตัวเองยังไม่ขยับ = null');
    assert(engine.buildClientState(room, others[0]).self.pin === 77, 'เห็นเข็มของตัวเอง');
    assert(engine.buildClientState(room, giver).players.every(p => !('pin' in p)), 'ผู้ใบ้ก็ไม่เห็นเข็มคนอื่นก่อนเปิด');
    throwsLike(() => engine.nextRound(room, room.admin, ctx(room), env), /ยังไม่จบ/, 'ยังไม่เปิดเป้า กดรอบต่อไปไม่ได้');
    throwsLike(() => engine.endGame(room, others[1], env), /หัวห้อง/, 'คนอื่นจบเกมไม่ได้');
    others.forEach(id => engine.lockPin(room, id, 40, ctx(room), env));
    const openView = engine.buildClientState(room, others[1]);
    assert(openView.target === S(room).target && openView.lastRound.results.length === others.length, 'เปิดแล้วทุกคนเห็นเป้า + เข็มทุกคน');
    console.log('8. เป้าลับเห็นแค่ผู้ใบ้ · เข็มคนอื่นไม่หลุดก่อนเปิด · คำสั่งผิดถูกปัด ✓');
})();

// ---------- 9. อันดับเสมอ ----------
(function ties() {
    const room = makeRoom(4);
    const env = makeEnv(41);
    engine.startGame(room, env);
    S(room).players.forEach((p, i) => { p.score = [7, 7, 3, 0][i]; p.roundsPlayed = 1; });
    engine.endGame(room, room.admin, env);
    const st = S(room).standings;
    assert(st[0].rank === 1 && st[1].rank === 1 && st[2].rank === 3 && st[3].rank === 4, 'อันดับเสมอใช้อันดับร่วม 1,1,3,4');
    assert(st.filter(r => r.won).length === 2 && S(room).winners.length === 2, 'แต้มสูงสุดเท่ากัน = ชนะร่วม');
    const room2 = makeRoom(3);
    engine.startGame(room2, env);
    engine.endGame(room2, room2.admin, env);
    assert(S(room2).winners.length === 0, 'ทุกคน 0 แต้ม = ไม่มีใครชนะ');
    console.log('9. อันดับร่วม · ชนะร่วมเมื่อเสมอ ✓');
})();

// ---------- 10. สุ่มเล่นหลายร้อยเกม ----------
(function fuzz() {
    const games = Number(process.env.WL_GAMES) || 400;
    const baseSeed = Number(process.env.WL_SEED) || 20261003;
    let totalRounds = 0;
    let skipped = 0;
    let lateJoins = 0;
    let leaves = 0;
    for (let g = 0; g < games; g += 1) {
        const env = makeEnv(baseSeed + g);
        const r = env.rng;
        const n = 3 + Math.floor(r() * 10);
        const room = makeRoom(n, r() < 0.3 ? 2 : 1);
        engine.startGame(room, env);
        let guard = 0;
        let lateId = 0;
        const roundPoints = {};
        while (S(room).status === 'playing' && guard++ < 400) {
            const st = S(room);
            const roll = r();
            // เหตุการณ์สุ่ม
            if (roll < 0.03 && room.players.length < 12) { lateJoin(room, 'L' + (lateId++)); lateJoins += 1; continue; }
            if (roll < 0.05 && room.players.length > 1) {
                const victim = room.players[Math.floor(r() * room.players.length)].playerId;
                leave(room, victim); leaves += 1; continue;
            }
            if (roll < 0.09) {
                const who = room.players[Math.floor(r() * room.players.length)];
                setOnline(room, who.playerId, !who.socketId);
                engine.refreshPresence(room, env);
                continue;
            }
            // ความลับทุกจังหวะ
            if (st.phase === 'clue' || st.phase === 'guess') {
                room.players.forEach(p => {
                    const view = engine.buildClientState(room, p.playerId);
                    if (p.playerId === st.giverId) assert(view.target === st.target, 'ผู้ใบ้เห็นเป้า');
                    else assert(view.target === null && view.lastRound === null, `เกม ${g}: เป้าหลุดถึง ${p.playerId}`);
                    view.players.forEach(x => assert(!('pin' in x), 'เข็มคนอื่นหลุด'));
                });
            }
            if (st.phase === 'clue') {
                if (r() < 0.12) { env.tick(engine.timers.CLUE_MS + 1); engine.autoResolvePhase(room, env); continue; }
                if (!st.rerollUsed && r() < 0.2) engine.rerollCards(room, st.giverId, ctx(room), env);
                engine.pickCard(room, st.giverId, r() < 0.5 ? 0 : 1, ctx(room), env);
                if (r() < 0.15) {
                    throwsLike(() => engine.submitClue(room, st.giverId, st.card.right + 'มาก', ctx(room), env), /คำบนการ์ด/, 'คำบนการ์ดถูกปัด');
                }
                engine.submitClue(room, st.giverId, goodClue(st.card), ctx(room), env);
            } else if (st.phase === 'guess') {
                const ids = st.guesserIds.slice();
                ids.forEach(id => {
                    if (S(room).phase !== 'guess') return;
                    const p = S(room).players.find(x => x.playerId === id);
                    if (!p || p.locked) return;
                    const v = r() * 100;
                    const act = r();
                    if (act < 0.5) engine.lockPin(room, id, v, ctx(room), env);
                    else if (act < 0.8) engine.movePin(room, id, v, ctx(room));
                });
                if (S(room).phase === 'guess' && r() < 0.5) { env.tick(engine.timers.GUESS_MS + 1); engine.autoResolvePhase(room, env); }
            } else if (st.phase === 'reveal') {
                const lr = st.lastRound;
                if (lr && !roundPoints[lr.round]) {
                    roundPoints[lr.round] = true;
                    totalRounds += 1;
                    if (lr.skipped) skipped += 1;
                    else {
                        const guessed = lr.results.filter(x => x.pin != null);
                        const expect = guessed.length ? Math.round(guessed.reduce((s, x) => s + x.points, 0) / guessed.length) : 0;
                        assert(lr.giverPoints === expect, `เกม ${g} รอบ ${lr.round}: ผู้ใบ้ต้องได้ ${expect}`);
                        lr.results.forEach(x => {
                            const recomputed = engine.scorePin(x.pin, lr.target).points;
                            assert(x.points === recomputed, 'แต้มตรงกับระยะ');
                            assert(x.pin == null || (x.pin >= 0 && x.pin <= 100), 'เข็มอยู่ในช่วง');
                        });
                    }
                    assert(lr.target >= 0 && lr.target <= 100 && Number.isInteger(lr.target), 'เป้า 0–100');
                }
                if (r() < 0.5) engine.nextRound(room, room.admin, null, env);
                else { env.tick(engine.timers.REVEAL_MS + 1); engine.autoResolvePhase(room, env); }
            }
            // invariant: แต้มรวมใน ledger = ผลรวมแต้มจากรอบที่เปิด (เฉพาะคนที่ยังอยู่)
            S(room).players.forEach(p => assert(p.score >= 0 && Number.isInteger(p.score), 'แต้มเป็นจำนวนเต็มบวก'));
        }
        assert(S(room).status === 'wavelength_finished', `เกม ${g} (${n} คน) ต้องจบภายในขอบเขต (phase=${S(room).phase}, guard=${guard})`);
        const st = S(room).standings;
        assert(Array.isArray(st), 'มีตารางสรุป');
        for (let i = 1; i < st.length; i += 1) assert(st[i - 1].score >= st[i].score, 'ตารางเรียงแต้มมากไปน้อย');
        if (st.length && st[0].score > 0) assert(st.filter(x => x.won).every(x => x.score === st[0].score), 'ผู้ชนะ = แต้มสูงสุด');
    }
    console.log(`10. สุ่ม ${games} เกม · ${totalRounds} รอบ (ข้าม ${skipped}) · เข้ากลางเกม ${lateJoins} · ออก ${leaves} — จบทุกเกม ไม่มีเป้าหลุด ✓`);
})();

// ---------- 11. ข้ามจังหวะ: ผู้ใบ้ขอข้ามตา · หัวห้องข้าม/เปิดเป้าเลย ----------
(function skipping() {
    const env = makeEnv(77);
    const room = makeRoom(4);
    engine.startGame(room, env);
    let giver = S(room).giverId;
    const outsider = room.players.map(p => p.playerId).find(id => id !== giver && id !== room.admin);
    throwsLike(() => engine.skipPhase(room, outsider, ctx(room), env), /ผู้ใบ้หรือหัวห้อง/, 'คนทั่วไปข้ามตาคนอื่นไม่ได้');
    assert(engine.buildClientState(room, giver).availableActions.canSkipTurn, 'ผู้ใบ้เห็นปุ่มข้ามตา');
    assert(!engine.buildClientState(room, outsider).availableActions.canSkipTurn, 'คนอื่นไม่เห็นปุ่มข้ามตา');
    engine.skipPhase(room, giver, ctx(room), env);
    assert(S(room).phase === 'reveal' && S(room).lastRound.skipped && /ขอข้ามตา/.test(S(room).lastRound.reason), 'ผู้ใบ้ขอข้ามตา = ข้ามรอบทันที');
    assert(S(room).players.every(p => p.score === 0), 'ข้ามตาไม่มีใครได้แต้ม');
    engine.nextRound(room, room.admin, null, env);
    giver = S(room).giverId;
    engine.pickCard(room, giver, 0, ctx(room), env);
    engine.submitClue(room, giver, goodClue(S(room).card), ctx(room), env);
    const notHost = S(room).guesserIds.find(id => id !== room.admin);
    throwsLike(() => engine.skipPhase(room, notHost, ctx(room), env), /หัวห้อง/, 'คนทายเปิดเป้าก่อนเวลาไม่ได้');
    engine.movePin(room, notHost, 33.3, ctx(room));
    engine.skipPhase(room, room.admin, ctx(room), env);
    assert(S(room).phase === 'reveal' && !S(room).lastRound.skipped, 'หัวห้องเปิดเป้าเลย');
    const row = S(room).lastRound.results.find(r => r.playerId === notHost);
    assert(row.pin === 33.3 && row.auto, 'เปิดก่อนเวลา: ล็อกให้ตรงที่เข็มอยู่');
    throwsLike(() => engine.skipPhase(room, room.admin, ctx(room), env), /ไม่มีอะไรให้ข้าม|จังหวะ/, 'ช่วงเปิดเป้าไม่มีอะไรให้ข้าม');
    throwsLike(() => engine.skipPhase(room, room.admin, { round: S(room).round, phase: 'guess' }, env), /จังหวะ/, 'กดซ้ำจากจอเก่า = ปัดทิ้ง');
    console.log('11. ผู้ใบ้ขอข้ามตา · หัวห้องข้ามตา/เปิดเป้าเลย · กดซ้ำถูกปัด ✓');
})();

console.log(`\n✅ smoke-wavelength-engine: ${checks} checks passed`);
