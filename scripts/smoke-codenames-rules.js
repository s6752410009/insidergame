/**
 * สายลับคำใบ้ — ทดสอบกติกาตามคู่มือ (rules/codenames/rules.md) ระดับ engine
 * กระดาน 9/8/7/1 · คำใบ้ 0/∞/ตัวเลข+1 · คำประสม · ทักท้วงคำใบ้ + โบนัสปิดคำ
 * โหมดร่วมมือ 2–3 คน (ตาฝ่ายตรงข้าม หัวหน้าเลือกปิด, หมดเวลาสุ่มปิด, ชนะ/แพ้/คะแนน) · หัวหน้าห้ามแชท
 * รัน: npm run smoke:codenames:rules
 */
const engine = require('../games/codenamesEngine');
const createRuntime = require('../games/codenamesRuntime');

let checks = 0;
function assert(condition, message) {
    if (!condition) throw new Error(message);
    checks += 1;
}
function throws(fn, pattern, message) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error, message + ' (ควร error)');
    if (pattern) assert(pattern.test(error.message), `${message}: ข้อความ "${error.message}" ไม่ตรง ${pattern}`);
    return error;
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
function makeRoom(count, settings = {}) {
    const players = [];
    for (let i = 0; i < count; i += 1) players.push({ playerId: 'p' + i, playerName: 'ผู้เล่น' + i, socketId: 's' + i });
    return {
        roomId: 'R', name: 'ทดสอบ', admin: 'p0', players,
        settings: { gameMode: 'codenames', codenamesTeams: {}, codenamesClueSeconds: 0, codenamesGuessSeconds: 0, ...settings },
        gameState: engine.createInitialState()
    };
}
function pick(room, layout) {
    const picks = {};
    ['red', 'blue'].forEach(team => (layout[team] || []).forEach((idx, i) => { picks['p' + idx] = { team, role: i === 0 ? 'spymaster' : 'operative' }; }));
    room.settings.codenamesTeams = picks;
}
const S = room => room.gameState;
const ctx = room => ({ step: S(room).step });
const sm = (room, team) => S(room).roster.find(p => p.team === team && p.role === 'spymaster' && !p.left);
const ops = (room, team) => S(room).roster.filter(p => p.team === team && p.role === 'operative' && !p.left);
const cardsOf = (room, color) => S(room).board.map((c, i) => ({ c, i })).filter(x => x.c.color === color && !x.c.revealed).map(x => x.i);
// ลูกทีมคนเดียว: เลือกแล้วกดเปิด
function guess(room, opId, index, now = 2000) {
    if ((S(room).votes || {})[opId] !== index) engine.proposeCard(room, opId, index, ctx(room), now);
    if (!S(room).board[index].revealed) engine.confirmReveal(room, opId, index, ctx(room), now);
}
function clue(room, team, word = 'ทดสอบ', number = 1, now = 1500) {
    engine.submitClue(room, sm(room, team).playerId, { word, number }, ctx(room), now);
}
function versus(seed = 1, settings = {}) {
    const room = makeRoom(4, settings);
    pick(room, { red: [0, 1], blue: [2, 3] });
    engine.startGame(room, mulberry32(seed), 1000);
    return room;
}

// ---------- 1. กระดาน + ทีมเริ่ม ----------
(function board() {
    const starts = { red: 0, blue: 0 };
    for (let seed = 1; seed <= 200; seed += 1) {
        const room = versus(seed);
        const state = S(room);
        const count = color => state.board.filter(c => c.color === color).length;
        assert(state.board.length === 25, '25 คำ');
        assert(count(state.startingTeam) === 9 && count(engine.otherTeam(state.startingTeam)) === 8, 'ทีมเริ่มก่อน 9 อีกทีม 8');
        assert(count('neutral') === 7 && count('assassin') === 1, 'คนเดินถนน 7 มือสังหาร 1');
        assert(state.currentTeam === state.startingTeam && state.phase === 'clue', 'ทีมที่มี 9 คำได้เริ่มก่อน');
        starts[state.startingTeam] += 1;
    }
    assert(starts.red > 60 && starts.blue > 60, 'ทีมเริ่มสุ่มทั้งสองฝั่ง ' + JSON.stringify(starts));
    console.log('1. กระดาน 9/8/7/1 · ทีม 9 คำเริ่มก่อน · สุ่มทีมเริ่ม ✓', starts);
})();

// ---------- 2. คำใบ้: ตัวเลข / 0 / ∞ / ตัวเลข+1 / ต้องทายอย่างน้อย 1 ----------
(function clueNumbers() {
    assert(engine.parseClueNumber(0) === 0 && engine.parseClueNumber('9') === 9 && engine.parseClueNumber('∞') === engine.INFINITE, 'รับ 0–9 และ ∞');
    assert(engine.parseClueNumber(10) === null && engine.parseClueNumber(-1) === null && engine.parseClueNumber('1.5') === null, 'ไม่รับเลขนอกช่วง');

    // ตัวเลข 2 → เปิดได้ 3 ใบ (ตัวเลข + 1) แล้วจบเทิร์นเอง
    let room = versus(3);
    let team = S(room).currentTeam;
    clue(room, team, 'ทดสอบ', 2);
    assert(S(room).clue.maxGuesses === 3, 'ตัวเลข 2 = เปิดได้ 3 ใบ');
    const op = ops(room, team)[0].playerId;
    throws(() => engine.endTurn(room, op, ctx(room)), /อย่างน้อย 1 ใบ/, 'ต้องทายอย่างน้อย 1 ใบ');
    const mine = cardsOf(room, team);
    guess(room, op, mine[0]); guess(room, op, mine[1]);
    assert(S(room).currentTeam === team && S(room).phase === 'guess', 'ถูก 2 ใบ ยังทายต่อได้');
    guess(room, op, mine[2]);
    assert(S(room).currentTeam !== team && S(room).clueLog[0].endedBy === 'limit', 'ใบที่ 3 (ตัวเลข+1) แล้วหมดสิทธิ์');

    // 0 และ ∞ = ไม่จำกัด จนกว่าจะพลาด/กดจบ
    [0, 'inf'].forEach(number => {
        room = versus(5);
        team = S(room).currentTeam;
        clue(room, team, 'ทดสอบ', number);
        assert(S(room).clue.maxGuesses === null, `${number} = เปิดได้ไม่จำกัด`);
        const o = ops(room, team)[0].playerId;
        cardsOf(room, team).slice(0, 5).forEach(i => guess(room, o, i));
        assert(S(room).currentTeam === team && S(room).guessesMade === 5, `${number}: เปิด 5 ใบยังเป็นตาเดิม`);
        engine.endTurn(room, o, ctx(room), 3000);
        assert(S(room).currentTeam !== team, `${number}: กดจบเทิร์นได้`);
    });

    // พลาด: คนเดินถนน / สายลับอีกทีม = จบเทิร์น · มือสังหาร = แพ้ทันที
    room = versus(7);
    team = S(room).currentTeam;
    clue(room, team, 'ทดสอบ', 3);
    guess(room, ops(room, team)[0].playerId, cardsOf(room, 'neutral')[0]);
    assert(S(room).currentTeam !== team && S(room).clueLog[0].endedBy === 'neutral', 'คนเดินถนน = จบเทิร์น');
    const t2 = S(room).currentTeam;
    clue(room, t2, 'ทดสอบ', 3);
    guess(room, ops(room, t2)[0].playerId, cardsOf(room, team)[0]);
    assert(S(room).currentTeam === team && S(room).clueLog[1].endedBy === 'wrong', 'เปิดสายลับอีกทีม = จบเทิร์น');
    clue(room, team, 'ทดสอบ', 3);
    guess(room, ops(room, team)[0].playerId, cardsOf(room, 'assassin')[0]);
    assert(S(room).phase === 'finished' && S(room).winner === engine.otherTeam(team) && S(room).winReason === 'assassin', 'มือสังหาร = แพ้ทันที');

    // เปิดสายลับใบสุดท้ายของอีกทีมให้ = อีกทีมชนะทันที (แม้เป็นตาเรา)
    room = versus(9);
    team = S(room).currentTeam;
    const enemy = engine.otherTeam(team);
    cardsOf(room, enemy).slice(1).forEach(i => { S(room).board[i].revealed = true; });
    clue(room, team, 'ทดสอบ', 2);
    guess(room, ops(room, team)[0].playerId, cardsOf(room, enemy)[0]);
    assert(S(room).winner === enemy && S(room).winReason === 'gift', 'เปิดคำสุดท้ายของอีกทีมให้ = อีกทีมชนะ');
    console.log('2. ตัวเลข+1 · 0/∞ ไม่จำกัด · ทายอย่างน้อย 1 · พลาดจบเทิร์น · มือสังหาร · เปิดคำสุดท้ายให้อีกทีม ✓');
})();

// ---------- 3. คำใบ้ห้ามเป็นคำ/ส่วนของคำบนกระดาน ----------
(function clueWords() {
    const board = words => ({ board: words.map(word => ({ word, revealed: false })) });
    assert(/อยู่บนกระดาน/.test(engine.validateClueWord(board(['รถไฟ']), 'รถไฟ')), 'คำบนกระดานตรง ๆ ไม่ได้');
    assert(/มีคำว่า "รถไฟ"/.test(engine.validateClueWord(board(['รถไฟ']), 'รถไฟฟ้า')), 'คำใบ้ที่มีคำบนกระดานอยู่ข้างในไม่ได้');
    assert(/ส่วนหนึ่งของ "รถไฟ"/.test(engine.validateClueWord(board(['รถไฟ']), 'รถ') || ''), 'ส่วนของคำประสม (รถ ใน รถไฟ) ไม่ได้');
    assert(/ส่วนหนึ่งของ "ข้าวเหนียว"/.test(engine.validateClueWord(board(['ข้าวเหนียว']), 'เหนียว') || ''), 'ท้ายคำประสมก็ไม่ได้');
    assert(/ส่วนหนึ่งของ "เรือดำน้ำ"/.test(engine.validateClueWord(board(['เรือดำน้ำ']), 'ดำน้ำ') || ''), 'กลางคำประสม (ดำน้ำ) ไม่ได้');
    assert(engine.validateClueWord(board(['หมากรุก']), 'หมา') === null, 'หมา ไม่ใช่ส่วนของ หมากรุก (ตัดคำได้ หมาก|รุก) — ใช้ได้');
    assert(engine.validateClueWord(board(['หมา']), 'มา') === null, 'ตัวอักษรบังเอิญซ้ำ (มา ใน หมา) ไม่ใช่คำประสม — ใช้ได้');
    const opened = { board: [{ word: 'รถไฟ', revealed: true }] };
    assert(engine.validateClueWord(opened, 'รถ') === null && engine.validateClueWord(opened, 'รถไฟ') === null, 'การ์ดที่เปิดแล้วไม่อยู่บนกระดาน — ใช้ได้');
    assert(engine.validateClueWord(board(['แมว']), '7') === null, 'ตัวเลขเป็นคำใบ้ได้ถ้าหมายถึงความหมาย');
    assert(/คำเดียว/.test(engine.validateClueWord(board(['แมว']), 'สอง คำ')), 'สองคำไม่ได้');
    // คำในคลังแยกส่วนไม่ล้นมือ: ส่วนคำประสมเป็นข้อความไทยทั้งหมด
    assert(/ส่วนหนึ่งของ "นกกระจอกเทศ"/.test(engine.validateClueWord(board(['นกกระจอกเทศ']), 'นก') || ''), 'ต้นคำประสม 3 ส่วน');
    assert(engine.validateClueWord(board(['สเก็ตบอร์ด']), 'ตบ') === null, 'คำทับศัพท์: "ตบ" ใน สเก็ตบอร์ด ไม่ใช่คำประสม');
    assert(engine.validateClueWord(board(['หมากฝรั่ง']), 'หมา') === null, 'หมา ใน หมากฝรั่ง ใช้ได้');
    assert(engine.isCompoundPart('ปลา', 'ปลากระเบน') && !engine.isCompoundPart('แม', 'แมว'), 'isCompoundPart');
    const vroom = versus(2);
    const vstate = S(vroom);
    vstate.board[0].word = 'รถไฟ';
    const vview = engine.buildClientState(vroom, ops(vroom, 'red')[0].playerId);
    assert(vview.board[0].parts.includes('รถ') && vview.board[0].color === null, 'client ได้ส่วนคำประสม (ไม่มีสี) ไว้เตือนทันที');
    console.log('3. ห้ามคำบนกระดาน · ห้ามมีคำบนกระดานข้างใน · ห้ามส่วนของคำประสม (ตัดคำไทย) ✓');
})();

// ---------- 4. ทักท้วงคำใบ้ (หัวหน้าอีกทีมตัดสิน) ----------
(function flags() {
    const room = versus(11);
    const team = S(room).currentTeam;
    const enemy = engine.otherTeam(team);
    throws(() => engine.flagClue(room, sm(room, enemy).playerId, ctx(room), 1200), /กำลังทาย/, 'ยังไม่ได้ใบ้ ทักไม่ได้');
    clue(room, team, 'ทดสอบ', 2);
    throws(() => engine.flagClue(room, sm(room, team).playerId, ctx(room), 1600), /ทีมตัวเอง/, 'ทักคำใบ้ทีมตัวเองไม่ได้');
    throws(() => engine.flagClue(room, ops(room, enemy)[0].playerId, ctx(room), 1600), /เฉพาะหัวหน้า/, 'ลูกทีมทักไม่ได้');
    let view = engine.buildClientState(room, sm(room, enemy).playerId, 1600);
    assert(view.self.canFlag === true && view.flagsLeft[enemy] === 1, 'หัวหน้าอีกทีมเห็นปุ่มทักท้วง');
    assert(engine.buildClientState(room, sm(room, team).playerId, 1600).self.canFlag === false, 'หัวหน้าทีมที่ใบ้ไม่เห็นปุ่มทัก');
    const before = engine.remainingFor(S(room), enemy);
    engine.flagClue(room, sm(room, enemy).playerId, ctx(room), 1700);
    assert(S(room).currentTeam === enemy && S(room).phase === 'clue', 'ทักแล้วจบเทิร์นทันที ไปตาอีกทีม');
    assert(S(room).clueLog[0].endedBy === 'flag', 'บันทึกว่าจบเพราะโดนทัก');
    assert(S(room).bonusCover === enemy, 'ทีมที่ทักได้โบนัสปิดคำ');
    view = engine.buildClientState(room, sm(room, enemy).playerId, 1700);
    assert(view.self.canCover && view.self.coverColor === enemy && view.self.canGiveClue, 'หัวหน้าที่ทักปิดคำทีมตัวเองได้ก่อนใบ้');
    assert(!engine.buildClientState(room, ops(room, enemy)[0].playerId, 1700).self.canCover, 'ลูกทีมปิดคำไม่ได้');
    throws(() => engine.coverCard(room, sm(room, enemy).playerId, cardsOf(room, team)[0], ctx(room), 1800), /ทีมคุณเท่านั้น/, 'ปิดได้เฉพาะคำของทีมตัวเอง');
    throws(() => engine.coverCard(room, ops(room, enemy)[0].playerId, cardsOf(room, enemy)[0], ctx(room), 1800), /เฉพาะหัวหน้า/, 'ลูกทีมปิดไม่ได้');
    const target = cardsOf(room, enemy)[0];
    engine.coverCard(room, sm(room, enemy).playerId, target, ctx(room), 1800);
    assert(S(room).board[target].revealed && S(room).board[target].covered === 'flag', 'ปิดคำของตัวเองแล้ว');
    assert(engine.remainingFor(S(room), enemy) === before - 1 && S(room).phase === 'clue' && S(room).currentTeam === enemy, 'ยังเป็นช่วงใบ้ของทีมที่ทัก');
    throws(() => engine.coverCard(room, sm(room, enemy).playerId, cardsOf(room, enemy)[0], ctx(room), 1810), /ปิดคำไม่ได้/, 'โบนัสใช้ได้ครั้งเดียว');
    // ทักได้ทีมละ 1 ครั้งต่อเกม
    clue(room, enemy, 'ทดสอบ', 1, 1900);
    engine.flagClue(room, sm(room, team).playerId, ctx(room), 1950);
    assert(S(room).currentTeam === team && S(room).bonusCover === team, 'อีกทีมก็ทักได้ 1 ครั้ง');
    clue(room, team, 'ทดสอบ', 1, 2000); // ใบ้เลย = สละสิทธิ์ปิด
    assert(S(room).bonusCover === null, 'ใบ้แล้วโบนัสหาย');
    throws(() => engine.flagClue(room, sm(room, enemy).playerId, ctx(room), 2100), /ใช้สิทธิ์ทักท้วงไปแล้ว/, 'ทักครั้งที่สองไม่ได้');
    // โบนัสปิดคำสุดท้าย = ชนะ
    const r2 = versus(13);
    const t = S(r2).currentTeam;
    const e = engine.otherTeam(t);
    cardsOf(r2, e).slice(1).forEach(i => { S(r2).board[i].revealed = true; });
    clue(r2, t, 'ทดสอบ', 1);
    engine.flagClue(r2, sm(r2, e).playerId, ctx(r2), 1700);
    engine.coverCard(r2, sm(r2, e).playerId, cardsOf(r2, e)[0], ctx(r2), 1800);
    assert(S(r2).winner === e && S(r2).winReason === 'words', 'โบนัสปิดใบสุดท้าย = ชนะ');
    // ห้องปิดการทักท้วง
    const off = versus(15, { codenamesClueFlag: false });
    assert(S(off).settings.clueFlag === false, 'อ่านค่า codenamesClueFlag ตอนเริ่ม');
    clue(off, S(off).currentTeam, 'ทดสอบ', 1);
    throws(() => engine.flagClue(off, sm(off, engine.otherTeam(S(off).currentTeam)).playerId, ctx(off), 1600), /ปิดการทักท้วง/, 'ห้องปิดการทัก');
    assert(engine.sanitizeClueFlag(undefined) === true && engine.sanitizeClueFlag('false') === false, 'ค่าเริ่ม = เปิด');
    console.log('4. ทักท้วงคำใบ้: หัวหน้าอีกทีม · จบเทิร์น · โบนัสปิดคำ 1 ใบ · ทีมละครั้ง · ปิดได้ในห้อง ✓');
})();

// ---------- 5. โหมดร่วมมือ 2–3 คน ----------
(function coop() {
    // เริ่ม: ทีมเดียว · ทีมผู้เล่นเริ่มก่อน 9 คำ
    [2, 3].forEach(n => {
        for (let seed = 1; seed <= 20; seed += 1) {
            const room = makeRoom(n);
            engine.shuffleTeams(room, mulberry32(seed));
            assert(engine.getStartBlockReason(room) === null, `${n} คนเริ่มโหมดร่วมมือได้`);
            engine.startGame(room, mulberry32(seed + 1), 1000);
            const state = S(room);
            assert(state.coop && state.startingTeam === state.coop.team && state.currentTeam === state.coop.team, 'ทีมผู้เล่นเริ่มก่อน');
            assert(state.board.filter(c => c.color === state.coop.team).length === 9, 'ทีมผู้เล่น 9 คำ');
        }
    });
    // 2 คนแยกสองทีม = บอกให้รวมทีม
    const split = makeRoom(2);
    pick(split, { red: [0], blue: [1] });
    assert(/อยู่ทีมเดียวกัน/.test(engine.getStartBlockReason(split) || ''), '2 คนแยกทีม บอกให้อยู่ทีมเดียว');
    const noOp = makeRoom(2);
    noOp.settings.codenamesTeams = { p0: { team: 'red', role: 'spymaster' }, p1: { team: null, role: 'spectator' } };
    assert(/อย่างน้อย 2 คน/.test(engine.getStartBlockReason(noOp) || ''), 'คนเดียวในทีมเริ่มไม่ได้');
    // 4+ คนอยู่ทีมเดียวก็ได้ (คู่มือ: ใช้กับวงที่ไม่อยากแข่งกัน)
    const big = makeRoom(5);
    pick(big, { blue: [0, 1, 2, 3, 4] });
    assert(engine.getStartBlockReason(big) === null, '5 คนทีมเดียว = ร่วมมือ');

    // คนที่หลุดแต่เลือกอีกทีมไว้ ไม่ทำให้ฝ่ายตรงข้ามมีคนเล่น
    const ghost = makeRoom(3);
    pick(ghost, { red: [0, 1], blue: [2] });
    ghost.players[2].socketId = null;
    assert(engine.getStartBlockReason(ghost) === null, 'คนออนไลน์อยู่ทีมเดียว = ร่วมมือ');
    engine.startGame(ghost, mulberry32(5), 1000);
    assert(S(ghost).coop.team === 'red' && S(ghost).roster.find(p => p.playerId === 'p2').role === 'spectator', 'คนหลุดที่เลือกอีกทีม = ผู้ชม');

    const room = makeRoom(3, { codenamesClueSeconds: 90 });
    pick(room, { red: [0, 1, 2] });
    engine.startGame(room, mulberry32(21), 1000);
    const state = S(room);
    const master = sm(room, 'red').playerId;
    const op = ops(room, 'red')[0].playerId;
    // ไม่มีปุ่มทักท้วงในโหมดร่วมมือ
    clue(room, 'red', 'ทดสอบ', 1);
    throws(() => engine.flagClue(room, master, ctx(room), 1600), /ร่วมมือ/, 'ร่วมมือไม่มีทักท้วง');
    guess(room, op, cardsOf(room, 'neutral')[0]);
    assert(state.phase === 'cover' && state.currentTeam === 'blue', 'พลาดแล้ว = ตาฝ่ายตรงข้าม (หัวหน้าเลือกปิด)');
    let view = engine.buildClientState(room, master, 2100);
    assert(view.coop.team === 'red' && view.self.canCover && view.self.coverColor === 'blue', 'หัวหน้าเลือกปิดสายลับฝ่ายตรงข้าม');
    const opView = engine.buildClientState(room, op, 2100);
    assert(!opView.self.canCover && opView.board.every(c => c.revealed || c.color === null), 'ลูกทีมไม่เห็นกุญแจ ปิดไม่ได้');
    throws(() => engine.coverCard(room, master, cardsOf(room, 'red')[0], ctx(room), 2200), /ทีมน้ำเงินเท่านั้น/, 'ปิดได้เฉพาะสายลับฝ่ายตรงข้าม');
    throws(() => engine.coverCard(room, op, cardsOf(room, 'blue')[0], ctx(room), 2200), /เฉพาะหัวหน้า/, 'ลูกทีมปิดไม่ได้');
    const blueBefore = engine.remainingFor(state, 'blue');
    engine.coverCard(room, master, cardsOf(room, 'blue')[0], ctx(room), 2300);
    assert(engine.remainingFor(state, 'blue') === blueBefore - 1, 'ปิดสายลับฝ่ายตรงข้าม 1 ใบ');
    assert(state.phase === 'clue' && state.currentTeam === 'red', 'ปิดแล้วกลับมาตาทีมเรา');
    // ช่วงปิดหมดเวลา = สุ่มปิดให้
    clue(room, 'red', 'ทดสอบ', 1, 2400);
    guess(room, op, cardsOf(room, 'red')[0], 2500);
    guess(room, op, cardsOf(room, 'neutral')[0], 2600);
    assert(state.phase === 'cover' && state.phaseEndsAt === 2600 + 90000, 'ช่วงปิดใช้เวลาใบ้ของห้อง');
    assert(engine.tick(room, 2600 + 89000) === false || state.phase === 'cover', 'ยังไม่หมดเวลา');
    const blueMid = engine.remainingFor(state, 'blue');
    engine.tick(room, 2600 + 90001);
    assert(engine.remainingFor(state, 'blue') === blueMid - 1 && state.phase === 'clue' && state.currentTeam === 'red', 'หมดเวลา = สุ่มปิด 1 ใบ แล้วกลับมาตาเรา');
    // หัวห้องข้ามช่วงปิดได้ (สุ่มปิด)
    clue(room, 'red', 'ทดสอบ', 1, 200000);
    guess(room, op, cardsOf(room, 'neutral')[0], 200100);
    const t0 = state.phaseStartedAt;
    throws(() => engine.hostSkipTurn(room, 'p0', true, ctx(room), t0 + 1000), /ค้างนานเกิน/, 'ข้ามเร็วไม่ได้');
    const b2 = engine.remainingFor(state, 'blue');
    engine.hostSkipTurn(room, 'p0', true, ctx(room), t0 + engine.HOST_SKIP_AFTER_MS);
    assert(engine.remainingFor(state, 'blue') === b2 - 1 && state.phase === 'clue', 'หัวห้องข้าม = สุ่มปิดให้');
    // ระหว่างเกม ทีมฝ่ายตรงข้ามไม่มีคน — tick ห้ามข้ามเทิร์นทีมเรา
    const t1 = state.phaseStartedAt;
    for (let t = 1; t <= 60; t += 1) engine.tick(room, t1 + t * 1000);
    assert(state.phase === 'clue' && state.currentTeam === 'red', 'tick ไม่ข้ามตาทีมเดียว');

    // ชนะ: เจอครบ → คะแนน = สายลับฝ่ายตรงข้ามที่เหลือ
    const win = makeRoom(2);
    pick(win, { red: [0, 1] });
    engine.startGame(win, mulberry32(31), 1000);
    clue(win, 'red', 'ทดสอบ', 'inf');
    const wop = ops(win, 'red')[0].playerId;
    cardsOf(win, 'red').forEach(i => guess(win, wop, i));
    assert(S(win).phase === 'finished' && S(win).winner === 'red' && S(win).winReason === 'words', 'เจอครบ = ชนะ');
    assert(S(win).coopScore === 8, 'คะแนน = สายลับฝ่ายตรงข้ามที่เหลือ (8)');
    assert(engine.buildClientState(win, 'p1').coop.score === 8, 'client เห็นคะแนน');
    assert(engine.buildResult(win).coop === true, 'ผลบอกว่าเป็นโหมดร่วมมือ');

    // แพ้: ฝ่ายตรงข้ามถูกปิดครบ
    const lose = makeRoom(2);
    pick(lose, { red: [0, 1] });
    engine.startGame(lose, mulberry32(33), 1000);
    cardsOf(lose, 'blue').slice(1).forEach(i => { S(lose).board[i].revealed = true; });
    clue(lose, 'red', 'ทดสอบ', 1);
    guess(lose, ops(lose, 'red')[0].playerId, cardsOf(lose, 'neutral')[0]);
    engine.coverCard(lose, sm(lose, 'red').playerId, cardsOf(lose, 'blue')[0], ctx(lose), 3000);
    assert(S(lose).phase === 'finished' && S(lose).winner === 'blue' && S(lose).winReason === 'covered', 'ฝ่ายตรงข้ามถูกปิดครบ = แพ้');
    // แพ้: เปิดสายลับฝ่ายตรงข้ามใบสุดท้ายเอง
    const gift = makeRoom(2);
    pick(gift, { red: [0, 1] });
    engine.startGame(gift, mulberry32(35), 1000);
    cardsOf(gift, 'blue').slice(1).forEach(i => { S(gift).board[i].revealed = true; });
    clue(gift, 'red', 'ทดสอบ', 1);
    guess(gift, ops(gift, 'red')[0].playerId, cardsOf(gift, 'blue')[0]);
    assert(S(gift).winner === 'blue' && S(gift).winReason === 'gift', 'เปิดใบสุดท้ายของฝ่ายตรงข้าม = แพ้');
    // แพ้: มือสังหาร
    const kill = makeRoom(2);
    pick(kill, { red: [0, 1] });
    engine.startGame(kill, mulberry32(37), 1000);
    clue(kill, 'red', 'ทดสอบ', 1);
    guess(kill, ops(kill, 'red')[0].playerId, cardsOf(kill, 'assassin')[0]);
    assert(S(kill).winner === 'blue' && S(kill).winReason === 'assassin', 'มือสังหาร = แพ้');
    // ลูกทีมออก = ไม่มีคนทาย จบไม่นับผล
    const quit = makeRoom(2);
    pick(quit, { red: [0, 1] });
    engine.startGame(quit, mulberry32(39), 1000);
    engine.handlePlayerLeft(quit, 'p1', 1500);
    assert(S(quit).phase === 'finished' && S(quit).winner === null && S(quit).winReason === 'abandoned', 'ลูกทีมออก = จบไม่นับผล');

    // ไม่บันทึกสถิติโหมดร่วมมือ แต่ยังพากลับห้องรอ
    const recorded = [];
    let scheduled = 0;
    const runtime = createRuntime(() => ({
        io: { to: () => ({ emit() {} }) },
        roomManager: { getRoom: () => null },
        statsManager: { recordGameEnd: (id, result) => recorded.push(result) },
        addServerLog() {},
        buildRoomUpdatePayload: () => ({}),
        notifyGameEndAfterRecord() {},
        scheduleFinishedGameReturnToLobby() { scheduled += 1; }
    }));
    runtime.finalizeIfNeeded(win);
    assert(recorded.length === 0 && scheduled === 1, 'ร่วมมือไม่นับสถิติ แต่กลับห้องรอ');
    assert(/ชนะ! คะแนน 8/.test(runtime.gameEndNotification(win).chatMessage), 'แจ้งผลร่วมมือในแชท');
    const vs = versus(41);
    clue(vs, S(vs).currentTeam, 'ทดสอบ', 1);
    guess(vs, ops(vs, S(vs).currentTeam)[0].playerId, cardsOf(vs, 'assassin')[0]);
    runtime.finalizeIfNeeded(vs);
    assert(recorded.length === 1 && recorded[0].coop === false, 'โหมดสองทีมยังบันทึกสถิติ');
    console.log('5. โหมดร่วมมือ: ทีมเดียวเริ่มก่อน · ตาฝ่ายตรงข้ามหัวหน้าเลือกปิด · หมดเวลาสุ่มปิด · ชนะ+คะแนน · แพ้ 3 แบบ · ไม่นับสถิติ ✓');
})();

// ---------- 6. หัวหน้าห้ามแชทระหว่างเกม ----------
(function chat() {
    const room = versus(43);
    const team = S(room).currentTeam;
    assert(/พิมพ์แชทไม่ได้/.test(engine.chatBlockReason(room, sm(room, team).playerId) || ''), 'หัวหน้าแชทไม่ได้');
    assert(engine.chatBlockReason(room, ops(room, team)[0].playerId) === null, 'ลูกทีมแชทได้');
    // หัวหน้าที่ถูกแทน (อดีตหัวหน้า เห็นกุญแจ) ก็ห้าม
    const old = sm(room, team);
    old.role = 'retired';
    assert(engine.chatBlockReason(room, old.playerId) !== null, 'อดีตหัวหน้าเห็นกุญแจ แชทไม่ได้');
    S(room).status = engine.FINISHED_STATUS;
    S(room).phase = 'finished';
    assert(engine.chatBlockReason(room, old.playerId) === null, 'จบเกมแล้วคุยได้');
    const lobby = makeRoom(4);
    assert(engine.chatBlockReason(lobby, 'p0') === null, 'ห้องรอคุยได้');
    console.log('6. หัวหน้า/อดีตหัวหน้าห้ามแชทระหว่างเกม · จบแล้วคุยได้ ✓');
})();

// ---------- 7. ตั้งค่าห้อง + หน้าจบ ----------
(function settings() {
    assert(engine.minPlayers === 2 && engine.MIN_VERSUS_PLAYERS === 4, 'ขั้นต่ำ 2 คน (ร่วมมือ) · สองทีม 4 คน');
    assert(engine.finishedReturnMs >= 30000, 'หน้าจบค้าง 30 วิ (finishedReturnMs)');
    const room = versus(45, { codenamesClueSeconds: 90, codenamesGuessSeconds: 60 });
    assert(S(room).settings.clueSeconds === 90 && S(room).settings.guessSeconds === 60 && S(room).settings.clueFlag === true, 'อ่านเวลา + ทักท้วงตอนเริ่ม');
    console.log('7. ค่าห้อง: เวลาใบ้/ทาย · ทักท้วง (ค่าเริ่มเปิด) · หน้าจบ 30 วิ ✓');
})();

// ---------- 8. สุ่มเล่นโหมดร่วมมือ + ทักท้วง หลายร้อยเกม — ต้องจบทุกเกม ----------
(function fuzz() {
    const tally = {};
    for (let seed = 1; seed <= 300; seed += 1) {
        const rng = mulberry32(seed * 7 + 3);
        const coop = seed % 2 === 0;
        const room = makeRoom(coop ? 2 + (Math.floor(seed / 2) % 2) : 4 + (seed % 5));
        engine.shuffleTeams(room, rng);
        engine.startGame(room, rng, 1000);
        const state = S(room);
        assert(!!state.coop === coop, 'สุ่มทีมได้โหมดตามจำนวนคน');
        let now = 2000;
        let guard = 0;
        while (state.status === 'playing' && guard < 400) {
            guard += 1;
            now += 1000;
            const team = state.currentTeam;
            const unrevealed = state.board.map((c, i) => ({ c, i })).filter(x => !x.c.revealed);
            if (state.phase === 'cover') {
                const options = unrevealed.filter(x => x.c.color === engine.otherTeam(state.coop.team));
                engine.coverCard(room, sm(room, state.coop.team).playerId, options[Math.floor(rng() * options.length)].i, ctx(room), now);
                continue;
            }
            if (state.phase === 'clue') {
                if (state.bonusCover === team && rng() < 0.7) {
                    const own = unrevealed.filter(x => x.c.color === team);
                    engine.coverCard(room, sm(room, team).playerId, own[0].i, ctx(room), now);
                    continue;
                }
                const n = rng() < 0.1 ? 'inf' : Math.floor(rng() * 4);
                engine.submitClue(room, sm(room, team).playerId, { word: 'ทดสอบ', number: n }, ctx(room), now);
                continue;
            }
            // guess
            const enemyMaster = !state.coop && sm(room, engine.otherTeam(team));
            if (enemyMaster && engine.flagsLeft(state, enemyMaster.team) > 0 && rng() < 0.05) {
                engine.flagClue(room, enemyMaster.playerId, ctx(room), now);
                continue;
            }
            const op = ops(room, team)[0];
            if (state.guessesMade > 0 && rng() < 0.3) { engine.endTurn(room, op.playerId, ctx(room), now); continue; }
            const pickCard = unrevealed[Math.floor(rng() * unrevealed.length)];
            guess(room, op.playerId, pickCard.i, now);
        }
        assert(state.status === engine.FINISHED_STATUS, `เกม seed ${seed} ต้องจบ`);
        const key = (coop ? 'coop:' : 'vs:') + state.winReason;
        tally[key] = (tally[key] || 0) + 1;
        if (coop && state.winner === state.coop.team) assert(state.coopScore === engine.remainingFor(state, engine.otherTeam(state.coop.team)), 'คะแนน = ที่เหลือ');
        const flags = state.flagsUsed || {};
        assert((flags.red || 0) <= 1 && (flags.blue || 0) <= 1, 'ทักได้ทีมละครั้ง');
    }
    console.log('8. สุ่มเล่น 300 เกม (ร่วมมือ + สองทีมมีทักท้วง) จบทุกเกม ✓', JSON.stringify(tally));
})();

console.log(`\n✅ smoke:codenames:rules ผ่าน ${checks} เช็ก`);
