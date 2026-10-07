/**
 * สายลับคำใบ้ — ทดสอบ engine ล้วน (ไม่มีเซิร์ฟเวอร์)
 * คลังคำ · กระดาน · เลือกทีม · ตรวจคำใบ้ · ความลับของกุญแจ · โหวต · นาฬิกา/หลุด/ออก · สุ่มเล่นหลายร้อยเกม
 * รัน: npm run smoke:codenames
 */
const engine = require('../games/codenamesEngine');
const { CATEGORIES, WORDS } = require('../games/codenamesWords');

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

function makeRoom(count, opts = {}) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        players.push({ playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', socketId: 's' + i });
    }
    return {
        roomId: 'R1',
        name: 'ทดสอบ',
        admin: 'p0',
        players,
        settings: { gameMode: 'codenames', codenamesTeams: {}, codenamesClueSeconds: opts.clue ?? 120, codenamesGuessSeconds: opts.guess ?? 0 },
        gameState: engine.createInitialState()
    };
}
function setTeams(room, layout) {
    // layout: { red: [spymasterIdx, ...ops], blue: [...] }
    const picks = {};
    ['red', 'blue'].forEach(team => (layout[team] || []).forEach((idx, i) => {
        picks['p' + idx] = { team, role: i === 0 ? 'spymaster' : 'operative' };
    }));
    (layout.spectators || []).forEach(idx => { picks['p' + idx] = { team: null, role: 'spectator' }; });
    room.settings.codenamesTeams = picks;
}
function startDefault(count, seed = 1, opts = {}) {
    const room = makeRoom(count, opts);
    engine.shuffleTeams(room, mulberry32(seed));
    engine.startGame(room, mulberry32(seed + 99), 1000);
    return room;
}
const S = room => room.gameState;
const ctx = room => ({ step: S(room).step });
const spymaster = (room, team) => S(room).roster.find(p => p.team === team && p.role === 'spymaster' && !p.left);
const operatives = (room, team) => S(room).roster.filter(p => p.team === team && p.role === 'operative' && !p.left);
// เปิดการ์ดแบบที่ UI ทำ: เสนอใบนั้นก่อน (ถ้ายังไม่ได้เสนอ) แล้วค่อยกดเปิด — เสนอแล้วอาจครบเสียงเปิดเองไปแล้ว
function reveal(room, opId, index, now) {
    const state = S(room);
    if ((state.votes || {})[opId] !== index) engine.proposeCard(room, opId, index, ctx(room), now);
    if (!state.board[index].revealed) engine.confirmReveal(room, opId, index, ctx(room), now);
}
const setOnline = (room, id, online) => { room.players.find(p => p.playerId === id).socketId = online ? 's-' + id : null; };

// ---------- 1. คลังคำ ----------
(function wordList() {
    assert(WORDS.length >= 400, `ต้องมีคำอย่างน้อย 400 (มี ${WORDS.length})`);
    assert(new Set(WORDS).size === WORDS.length, 'คำในคลังห้ามซ้ำ');
    assert(Object.keys(CATEGORIES).length >= 8, 'แบ่งหมวดอย่างน้อย 8 หมวด');
    WORDS.forEach(word => {
        assert(!/\s/.test(word), `คำ "${word}" ห้ามมีช่องว่าง`);
        assert(/^[฀-๿]+$/.test(word), `คำ "${word}" ต้องเป็นภาษาไทยล้วน`);
        assert(word === word.normalize('NFC'), `คำ "${word}" ต้องเป็น NFC`);
        assert(word.length >= 2, `คำ "${word}" สั้นเกินไป`);
    });
    for (const a of WORDS) {
        for (const b of WORDS) {
            if (a !== b && engine.containsWord(a, b)) throw new Error(`คำ "${a}" มี "${b}" อยู่ข้างใน — คำใบ้จะชนกัน`);
        }
    }
    checks += 1;
    const banned = ['เบียร์', 'เหล้า', 'บุหรี่', 'ระเบิด', 'ปืน '];
    banned.forEach(word => assert(!WORDS.includes(word.trim()), `คลังคำห้ามมี "${word}"`));
    console.log(`1. คลังคำ ${WORDS.length} คำ ไม่ซ้ำ ไม่ซ้อนกัน ✓`);
})();

// ---------- 2. กระดาน ----------
(function boards() {
    for (let seed = 1; seed <= 1500; seed += 1) {
        const rng = mulberry32(seed);
        const startTeam = seed % 2 ? 'red' : 'blue';
        const board = engine.buildBoard(rng, startTeam);
        assert(board.length === 25, 'กระดาน 25 ใบ');
        const words = board.map(c => c.word);
        assert(new Set(words).size === 25, 'คำบนกระดานห้ามซ้ำ');
        const count = color => board.filter(c => c.color === color).length;
        assert(count(startTeam) === 9 && count(engine.otherTeam(startTeam)) === 8, 'ทีมเริ่ม 9 อีกทีม 8');
        assert(count('neutral') === 7 && count('assassin') === 1, 'คนเดินถนน 7 มือสังหาร 1');
        assert(board.every(c => !c.revealed), 'เริ่มมาไม่มีการ์ดเปิด');
    }
    // สุ่มทีมเริ่มได้ทั้งสองฝั่ง
    const starts = new Set();
    for (let seed = 1; seed <= 40; seed += 1) starts.add(startDefault(4, seed).gameState.startingTeam);
    assert(starts.size === 2, 'ทีมเริ่มต้องสุ่มได้ทั้งแดงและน้ำเงิน');
    console.log('2. กระดาน 1,500 แบบ: 9/8/7/1 คำไม่ซ้ำ ✓');
})();

// ---------- 3. ห้องรอ: เลือกทีม/บท ----------
(function lobby() {
    const room = makeRoom(5);
    assert(/ยังไม่ได้เลือกทีม/.test(engine.getStartBlockReason(room)), 'ยังไม่เลือกทีม = เริ่มไม่ได้');
    engine.pickTeam(room, 'p0', { team: 'red', role: 'spymaster' });
    throws(() => engine.pickTeam(room, 'p1', { team: 'red', role: 'spymaster' }), /มีหัวหน้าแล้ว/, 'ทีมมีหัวหน้าแล้วห้ามแย่ง');
    throws(() => engine.pickTeam(room, 'p1', { team: 'green', role: 'operative' }), /ทีมแดงหรือทีมน้ำเงิน/, 'ทีมแปลก ๆ');
    throws(() => engine.pickTeam(room, 'p1', { team: 'red', role: 'boss' }), /หัวหน้าหรือลูกทีม/, 'บทแปลก ๆ');
    throws(() => engine.pickTeam(room, 'nobody', { team: 'red', role: 'operative' }), /ไม่พบผู้เล่น/, 'คนนอกห้อง');
    engine.pickTeam(room, 'p1', { team: 'red', role: 'operative' });
    engine.pickTeam(room, 'p2', { team: 'blue', role: 'operative' });
    engine.pickTeam(room, 'p3', { team: 'blue', role: 'operative' });
    engine.pickTeam(room, 'p4', { role: 'spectator' });
    assert(engine.getStartBlockReason(room) === 'ทีมน้ำเงินยังไม่มีหัวหน้า', 'ไม่มีหัวหน้า: ' + engine.getStartBlockReason(room));
    engine.pickTeam(room, 'p3', { team: 'blue', role: 'spymaster' });
    assert(engine.getStartBlockReason(room) === null, 'ทีมครบแล้วต้องเริ่มได้: ' + engine.getStartBlockReason(room));
    engine.pickTeam(room, 'p1', { team: 'blue', role: 'operative' });
    assert(engine.getStartBlockReason(room) === 'ทีมแดงต้องมีลูกทีมอย่างน้อย 1 คน', 'ไม่มีลูกทีม: ' + engine.getStartBlockReason(room));
    // หัวหน้าเดิมหลุด — คนใหม่รับแทนได้ คนเดิมกลายเป็นลูกทีม
    setOnline(room, 'p0', false);
    engine.pickTeam(room, 'p1', { team: 'red', role: 'spymaster' });
    assert(room.settings.codenamesTeams.p0.role === 'operative', 'หัวหน้าที่หลุดถูกย้ายเป็นลูกทีม');
    setOnline(room, 'p0', true);
    engine.pickTeam(room, 'p4', { role: 'none' });
    assert(!room.settings.codenamesTeams.p4, 'ยกเลิกการเลือกได้');
    // คนออกจากห้องแล้ว ไม่ค้างในรายการ
    room.players = room.players.filter(p => p.playerId !== 'p2');
    engine.pickTeam(room, 'p3', { team: 'blue', role: 'spymaster' });
    assert(!room.settings.codenamesTeams.p2, 'คนที่ออกจากห้องถูกล้างออก');

    // ไม่ถึง 4 คน: สุ่มทีม = ทุกคนอยู่ทีมเดียว (โหมดร่วมมือ ตามคู่มือ) เริ่มได้
    const few = makeRoom(3);
    engine.shuffleTeams(few, mulberry32(3));
    const fewTeams = new Set(Object.values(few.settings.codenamesTeams).map(p => p.team));
    assert(fewTeams.size === 1 && engine.getStartBlockReason(few) === null, '3 คนสุ่มแล้วอยู่ทีมเดียว เริ่มได้: ' + engine.getStartBlockReason(few));
    const solo = makeRoom(1);
    assert(/อย่างน้อย 2 คน/.test(engine.getStartBlockReason(solo)), 'คนเดียวเริ่มไม่ได้');

    for (let n = 4; n <= 12; n += 1) {
        for (let seed = 1; seed <= 30; seed += 1) {
            const r = makeRoom(n);
            engine.shuffleTeams(r, mulberry32(seed * 31 + n));
            const picks = Object.values(r.settings.codenamesTeams);
            const red = picks.filter(p => p.team === 'red');
            const blue = picks.filter(p => p.team === 'blue');
            assert(Math.abs(red.length - blue.length) <= 1, 'สุ่มทีมต้องสมดุล');
            assert(red.filter(p => p.role === 'spymaster').length === 1 && blue.filter(p => p.role === 'spymaster').length === 1, 'สุ่มแล้วมีหัวหน้าทีมละคน');
            assert(engine.getStartBlockReason(r) === null, `สุ่ม ${n} คนแล้วต้องเริ่มได้`);
        }
    }
    const thirteen = makeRoom(13);
    engine.shuffleTeams(thirteen, mulberry32(1));
    assert(/สูงสุด 12/.test(engine.getStartBlockReason(thirteen)), '13 คนในทีมเริ่มไม่ได้');
    // ผู้ชมไม่ถูกสุ่มเข้าทีม
    const withSpec = makeRoom(6);
    engine.pickTeam(withSpec, 'p5', { role: 'spectator' });
    engine.shuffleTeams(withSpec, mulberry32(7));
    assert(withSpec.settings.codenamesTeams.p5.role === 'spectator', 'ผู้ชมไม่ถูกสุ่ม');
    // เกมเริ่มแล้วเปลี่ยนทีมไม่ได้
    const started = startDefault(4, 2);
    throws(() => engine.pickTeam(started, 'p1', { team: 'red', role: 'operative' }), /เริ่มไปแล้ว/, 'กลางเกมเปลี่ยนทีมไม่ได้');
    throws(() => engine.shuffleTeams(started, mulberry32(1)), /เริ่มไปแล้ว/, 'กลางเกมสุ่มทีมไม่ได้');
    console.log('3. เลือกทีม/บท/สุ่มทีม/เหตุผลที่เริ่มไม่ได้ ✓');
})();

// ---------- 4. ตรวจคำใบ้ ----------
(function clueValidation() {
    const room = startDefault(4, 5);
    const state = S(room);
    const w0 = state.board[0].word;
    const w1 = state.board[1].word;
    const v = word => engine.validateClueWord(state, word);
    assert(v('') === 'พิมพ์คำใบ้ก่อน', 'ว่าง');
    assert(v('   ') === 'พิมพ์คำใบ้ก่อน', 'ช่องว่างล้วน');
    assert(v('ทะเล สีฟ้า') === 'ใบ้ได้คำเดียว ห้ามเว้นวรรค', 'สองคำ');
    assert(/สัญลักษณ์/.test(v('ทะเล!')), 'สัญลักษณ์');
    assert(/อยู่บนกระดาน/.test(v(w0)), 'คำบนกระดาน');
    assert(/อยู่บนกระดาน/.test(v(' ' + w0 + ' ')), 'คำบนกระดาน + ช่องว่างหัวท้าย');
    assert(/อยู่บนกระดาน/.test(v(w0.split('').join('​'))), 'คำบนกระดานแทรก zero-width');
    assert(/มีคำว่า/.test(v('ซุปเปอร์' + w1)), 'คำใบ้ที่มีคำบนกระดานอยู่ข้างใน');
    assert(/มีคำว่า/.test(v(w1 + 'ยักษ์')), 'คำใบ้ที่ขึ้นต้นด้วยคำบนกระดาน');
    assert(v('ฮัลโหลโลก') === null || /มีคำว่า/.test(v('ฮัลโหลโลก')), 'คำปกติ');
    assert(engine.normalizeWord('น้ํา') === engine.normalizeWord('น้ำ'), 'นิคหิต+สระอา = สระอำ');
    assert(engine.normalizeWord('ABC') === 'abc', 'ตัวพิมพ์เล็ก');
    assert(engine.containsWord('กาแฟเย็น', 'กาแฟ') && !engine.containsWord('กาแฟ', 'กาแฟเย็น'), 'containsWord');
    assert(!engine.containsWord('ก้อน', 'ก'), 'ไม่จับกลาง grapheme');
    // เปิดแล้วใช้เป็นคำใบ้ได้
    state.board[0].revealed = true;
    assert(v(w0) === null, 'คำที่เปิดแล้วใช้เป็นคำใบ้ได้');
    state.board[0].revealed = false;
    assert(engine.parseClueNumber(0) === 0 && engine.parseClueNumber('9') === 9 && engine.parseClueNumber('inf') === 'inf' && engine.parseClueNumber('∞') === 'inf', 'ตัวเลขที่ใช้ได้');
    [10, -1, 1.5, 'x', '12', null, undefined, ''].forEach(n => assert(engine.parseClueNumber(n) === null, 'ตัวเลขผิด: ' + n));
    console.log('4. ตรวจคำใบ้ (เว้นวรรค/คำบนกระดาน/ซ้อน/normalize) ✓');
})();

// ---------- 5. ความลับของกุญแจ ----------
(function secrecy() {
    const room = makeRoom(7);
    setTeams(room, { red: [0, 1, 2], blue: [3, 4, 5], spectators: [6] });
    engine.startGame(room, mulberry32(11), 1000);
    const keyOf = view => view.board.map(c => c.color);
    const master = engine.buildClientState(room, 'p0');
    assert(master.keyVisible && keyOf(master).every(Boolean), 'หัวหน้าเห็นกุญแจทั้งกระดาน');
    ['p1', 'p2', 'p4', 'p5', 'p6', 'stranger'].forEach(id => {
        const view = engine.buildClientState(room, id);
        assert(!view.keyVisible, `${id} ต้องไม่เห็นกุญแจ`);
        assert(keyOf(view).every(c => c === null), `${id} ต้องไม่ได้สีของการ์ดที่ยังไม่เปิด`);
        const json = JSON.stringify(view);
        assert(!/"color":"(red|blue|neutral|assassin)"/.test(json.replace(/"teams":.*$/, '')), `${id} payload ต้องไม่มีสีกุญแจ`);
        assert(!/assassin/.test(json), `${id} payload ต้องไม่มีคำว่า assassin เลย`);
    });
    // เปิดแล้วทุกคนเห็นสีใบนั้น
    const state = S(room);
    const team = state.currentTeam;
    const sm = spymaster(room, team);
    engine.submitClue(room, sm.playerId, { word: 'ทดสอบ', number: 9 }, ctx(room), 2000);
    const neutralIndex = state.board.findIndex(c => c.color === 'neutral');
    const op = operatives(room, team)[0];
    reveal(room, op.playerId, neutralIndex, 2100);
    const opView = engine.buildClientState(room, 'p6');
    assert(opView.board[neutralIndex].color === 'neutral', 'การ์ดที่เปิดแล้วทุกคนเห็นสี');
    assert(opView.board.filter(c => c.color).length === 1, 'ผู้ชมเห็นแค่สีที่เปิดแล้ว');
    // จบเกมแล้วเปิดเผยทั้งกระดาน
    engine.handlePlayerLeft(room, 'p3', 2200);
    engine.handlePlayerLeft(room, 'p4', 2200);
    engine.handlePlayerLeft(room, 'p5', 2200);
    assert(S(room).phase === 'finished' && S(room).winner === 'red', 'อีกทีมออกหมด = ทีมแดงชนะ');
    assert(keyOf(engine.buildClientState(room, 'p6')).every(Boolean), 'จบเกมแล้วทุกคนเห็นกุญแจ');
    console.log('5. กุญแจถึงเฉพาะหัวหน้า ลูกทีม/ผู้ชม/คนนอกไม่ได้ ✓');
})();

// ---------- 6. กติกาเทิร์น ----------
(function turnRules() {
    const room = makeRoom(6);
    setTeams(room, { red: [0, 1, 2], blue: [3, 4, 5] });
    engine.startGame(room, mulberry32(21), 1000);
    const state = S(room);
    const team = state.currentTeam;
    const other = engine.otherTeam(team);
    const sm = spymaster(room, team);
    const [opA, opB] = operatives(room, team);
    const otherSm = spymaster(room, other);
    const otherOp = operatives(room, other)[0];

    throws(() => engine.submitClue(room, otherSm.playerId, { word: 'ลอง', number: 1 }, ctx(room)), /ยังไม่ถึงตา/, 'หัวหน้าอีกทีมใบ้ไม่ได้');
    throws(() => engine.submitClue(room, opA.playerId, { word: 'ลอง', number: 1 }, ctx(room)), /เฉพาะหัวหน้า/, 'ลูกทีมใบ้ไม่ได้');
    throws(() => engine.submitClue(room, sm.playerId, { word: 'ลอง', number: 12 }, ctx(room)), /0–9/, 'ตัวเลขเกิน');
    throws(() => engine.submitClue(room, sm.playerId, { word: 'ลอง', number: 1 }, { step: state.step - 1 }), /จังหวะ/, 'step เก่า');
    throws(() => engine.proposeCard(room, opA.playerId, 0, ctx(room)), /รอหัวหน้า/, 'ยังไม่ใบ้ห้ามแตะ');
    throws(() => engine.endTurn(room, opA.playerId, ctx(room)), /รอหัวหน้า/, 'ยังไม่ใบ้ห้ามจบเทิร์น');

    engine.submitClue(room, sm.playerId, { word: 'ลอง', number: 1 }, ctx(room), 1500);
    assert(state.phase === 'guess' && state.clue.maxGuesses === 2, 'ใบ้ 1 = เปิดได้ 2 ใบ');
    throws(() => engine.submitClue(room, sm.playerId, { word: 'ซ้ำ', number: 1 }, ctx(room)), /ไม่ใช่ช่วงใบ้/, 'ใบ้ซ้ำในเทิร์นเดียว');
    throws(() => engine.proposeCard(room, sm.playerId, 0, ctx(room)), /หัวหน้าเปิด/, 'หัวหน้าเปิดเองไม่ได้');
    throws(() => engine.proposeCard(room, otherOp.playerId, 0, ctx(room)), /ยังไม่ถึงตา/, 'อีกทีมแตะไม่ได้');
    throws(() => engine.proposeCard(room, opA.playerId, 25, ctx(room)), /ไม่พบการ์ด/, 'การ์ดนอกกระดาน');
    throws(() => engine.proposeCard(room, opA.playerId, -1, ctx(room)), /ไม่พบการ์ด/, 'การ์ดติดลบ');
    throws(() => engine.proposeCard(room, opA.playerId, 'abc', ctx(room)), /ไม่พบการ์ด/, 'index มั่ว');
    throws(() => engine.endTurn(room, opA.playerId, ctx(room)), /อย่างน้อย 1 ใบ/, 'ยังไม่เปิดสักใบ ห้ามจบเทิร์น');

    // โหวต 2 คน: ต้องตรงกันทั้งสองคน
    const own = state.board.map((c, i) => ({ c, i })).filter(x => x.c.color === team).map(x => x.i);
    engine.proposeCard(room, opA.playerId, own[0], ctx(room), 1600);
    assert(!state.board[own[0]].revealed, 'เสนอคนเดียวจาก 2 ยังไม่เปิด');
    const viewB = engine.buildClientState(room, opB.playerId);
    assert(viewB.board[own[0]].votes.length === 1 && viewB.votesNeeded === 2, 'เห็นว่ามีคนเสนอ 1 ต้องการ 2');
    engine.proposeCard(room, opA.playerId, own[0], ctx(room), 1600);
    assert(engine.buildClientState(room, opB.playerId).board[own[0]].votes.length === 0, 'แตะซ้ำ = ยกเลิกเสนอ');
    engine.proposeCard(room, opA.playerId, own[0], ctx(room), 1600);
    engine.proposeCard(room, opB.playerId, own[0], ctx(room), 1600);
    assert(state.board[own[0]].revealed && state.guessesMade === 1 && state.phase === 'guess', 'เสียงข้างมากเปิด ถูกสีทาย');
    throws(() => engine.confirmReveal(room, opA.playerId, own[0], ctx(room)), /เปิดไปแล้ว/, 'เปิดซ้ำไม่ได้');
    reveal(room, opB.playerId, own[1], 1700);
    assert(state.currentTeam === other && state.phase === 'clue', 'ครบ number+1 = จบเทิร์น');
    assert(state.clueLog.length === 1 && state.clueLog[0].picks.length === 2 && state.clueLog[0].endedBy === 'limit', 'บันทึกคำใบ้เก็บการ์ดที่เปิด');

    // อีกทีม: เปิดผิดสี = จบเทิร์นทันที
    engine.submitClue(room, otherSm.playerId, { word: 'อีกคำ', number: 'inf' }, ctx(room), 1800);
    assert(state.clue.maxGuesses === null, '∞ = ไม่จำกัด');
    const wrong = state.board.findIndex(c => c.color === team && !c.revealed);
    reveal(room, otherOp.playerId, wrong, 1900);
    assert(state.currentTeam === team && state.phase === 'clue', 'เปิดสีอีกทีม = จบเทิร์น');

    // ใบ้ 0 = ไม่จำกัด
    engine.submitClue(room, sm.playerId, { word: 'ศูนย์', number: 0 }, ctx(room), 2000);
    assert(state.clue.maxGuesses === null, 'ใบ้ 0 = ไม่จำกัดจำนวน');
    const own2 = state.board.findIndex(c => c.color === team && !c.revealed);
    reveal(room, opA.playerId, own2, 2100);
    engine.endTurn(room, opA.playerId, ctx(room), 2200);
    assert(state.currentTeam === other, 'กดจบเทิร์นหลังเปิด 1 ใบได้');

    // มือสังหาร = แพ้ทันที
    engine.submitClue(room, otherSm.playerId, { word: 'เสี่ยง', number: 3 }, ctx(room), 2300);
    const assassin = state.board.findIndex(c => c.color === 'assassin');
    reveal(room, otherOp.playerId, assassin, 2400);
    assert(state.phase === 'finished' && state.winner === team && state.winReason === 'assassin', 'เปิดมือสังหาร = อีกทีมชนะ');
    throws(() => engine.submitClue(room, sm.playerId, { word: 'จบ', number: 1 }, ctx(room)), /จบไปแล้ว/, 'จบแล้วเล่นต่อไม่ได้');
    console.log('6. ตาใคร/บทไหน/โหวต/จำนวนครั้ง/ผิดสี/มือสังหาร ✓');
})();

// ---------- 7. โหวต: คนเดียวต้องกดยืนยัน · 3 คนต้องได้ 2 ----------
(function voting() {
    const solo = makeRoom(4);
    setTeams(solo, { red: [0, 1], blue: [2, 3] });
    engine.startGame(solo, mulberry32(31), 1000);
    const team = S(solo).currentTeam;
    engine.submitClue(solo, spymaster(solo, team).playerId, { word: 'เดี่ยว', number: 2 }, ctx(solo));
    const op = operatives(solo, team)[0];
    // เปิดใบที่ยังไม่ได้เลือกไม่ได้ (กดค้าง/กดเปิดเลยใบอื่น = ไม่มีผล)
    throws(() => engine.confirmReveal(solo, op.playerId, 3, ctx(solo)), /เลือกการ์ดใบนี้ก่อน/, 'เปิดใบที่ยังไม่ได้เสนอไม่ได้');
    assert(!S(solo).board[3].revealed, 'ยังไม่เปิด');
    engine.proposeCard(solo, op.playerId, 3, ctx(solo));
    assert(!S(solo).board[3].revealed, 'ลูกทีมคนเดียว: แตะแล้วยังไม่เปิด');
    throws(() => engine.confirmReveal(solo, op.playerId, 4, ctx(solo)), /เลือกการ์ดใบนี้ก่อน/, 'เลือกใบหนึ่ง แต่สั่งเปิดอีกใบไม่ได้');
    assert(engine.buildClientState(solo, op.playerId).board[3].mine, 'เห็นการ์ดที่ตัวเองเสนอ');
    assert(engine.buildClientState(solo, op.playerId).votesNeeded === null, 'คนเดียว = ต้องกดเปิดเลย');
    reveal(solo, op.playerId, 3);
    assert(S(solo).board[3].revealed, 'กดเปิดเลยแล้วเปิด');

    const trio = makeRoom(8);
    setTeams(trio, { red: [0, 1, 2, 3], blue: [4, 5, 6, 7] });
    engine.startGame(trio, mulberry32(41), 1000);
    const t = S(trio).currentTeam;
    engine.submitClue(trio, spymaster(trio, t).playerId, { word: 'สาม', number: 3 }, ctx(trio));
    const ops = operatives(trio, t);
    const target = S(trio).board.findIndex(c => c.color === t);
    engine.proposeCard(trio, ops[0].playerId, target, ctx(trio));
    engine.proposeCard(trio, ops[1].playerId, (target + 1) % 25 === target ? 0 : (S(trio).board.findIndex((c, i) => i !== target && !c.revealed)), ctx(trio));
    assert(!S(trio).board[target].revealed, '1 จาก 3 ยังไม่พอ');
    // คนที่เสนอคนละใบหลุดไป → เหลือ 2 ออนไลน์ ต้องได้ 2 · คนที่ 3 เสนอตรง = เปิด
    engine.proposeCard(trio, ops[2].playerId, target, ctx(trio));
    assert(S(trio).board[target].revealed, '2 จาก 3 = เสียงข้างมากเปิด');
    assert(Object.keys(S(trio).votes).length === 0, 'เปิดแล้วล้างโหวต');
    console.log('7. โหวตเสียงข้างมาก / คนเดียวกดยืนยัน ✓');
})();

// ---------- 8. นาฬิกา หลุด ออก ----------
(function timersAndPresence() {
    const G = engine.SPYMASTER_GRACE_MS;
    const N = engine.NO_OPERATIVE_GRACE_MS;

    // หมดเวลาคิดคำใบ้ → เทิร์นข้าม
    let room = makeRoom(4, { clue: 90, guess: 60 });
    setTeams(room, { red: [0, 1], blue: [2, 3] });
    engine.startGame(room, mulberry32(51), 1000);
    let state = S(room);
    const first = state.currentTeam;
    assert(state.phaseEndsAt === 1000 + 90000, 'นาฬิกาใบ้ 90 วิ');
    assert(engine.tick(room, 1000 + 89000) === false || state.currentTeam === first, 'ยังไม่หมดเวลา');
    assert(state.currentTeam === first, 'ยังเป็นทีมเดิม');
    engine.tick(room, 1000 + 90001);
    assert(state.currentTeam === engine.otherTeam(first) && state.phase === 'clue', 'หมดเวลาใบ้ = ข้ามเทิร์น');
    assert(state.history.some(h => /หมดเวลาคิดคำใบ้/.test(h.text)), 'บอกทุกคนว่าหมดเวลา');
    // หมดเวลาทาย
    const t2 = state.currentTeam;
    const now2 = 200000;
    engine.submitClue(room, spymaster(room, t2).playerId, { word: 'ช้าๆ', number: 1 }, ctx(room), now2);
    assert(state.phaseEndsAt === now2 + 60000, 'นาฬิกาทาย 60 วิ');
    engine.tick(room, now2 + 60001);
    assert(state.currentTeam === first && state.phase === 'clue', 'หมดเวลาทาย = ข้ามเทิร์น');

    // ปิดนาฬิกา = ไม่มีเวลา
    room = makeRoom(4, { clue: 0, guess: 0 });
    setTeams(room, { red: [0, 1], blue: [2, 3] });
    engine.startGame(room, mulberry32(52), 1000);
    assert(S(room).phaseEndsAt === null, 'ปิดนาฬิกาใบ้');
    engine.tick(room, 10 ** 9);
    assert(S(room).turnNumber === 1, 'ไม่มีนาฬิกา = ไม่ข้ามเอง');

    // หัวหน้าหลุดเกินเวลาผ่อนผัน → ลูกทีมออนไลน์ขึ้นแทน
    room = makeRoom(6);
    setTeams(room, { red: [0, 1, 2], blue: [3, 4, 5] });
    engine.startGame(room, mulberry32(53), 1000);
    state = S(room);
    setOnline(room, 'p0', false);
    engine.tick(room, 2000);
    engine.tick(room, 2000 + G - 10);
    assert(spymaster(room, 'red').playerId === 'p0', 'ยังอยู่ในเวลาผ่อนผัน');
    setOnline(room, 'p1', false);
    engine.tick(room, 2000 + G + 10);
    const newMaster = spymaster(room, 'red');
    assert(newMaster.playerId === 'p2', 'ตั้งลูกทีมที่ออนไลน์เป็นหัวหน้า: ' + newMaster.playerId);
    assert(state.roster.find(p => p.playerId === 'p0').role === 'retired', 'หัวหน้าเดิมเป็นอดีตหัวหน้า');
    assert(state.history.some(h => /หลุดการเชื่อมต่อ/.test(h.text) && /เป็นหัวหน้า/.test(h.text)), 'แจ้งทุกคน');
    assert(engine.buildClientState(room, 'p2').keyVisible, 'หัวหน้าใหม่เห็นกุญแจ');
    setOnline(room, 'p0', true);
    engine.tick(room, 2000 + G + 20);
    assert(engine.buildClientState(room, 'p0').keyVisible && !engine.buildClientState(room, 'p0').self.canGuess, 'อดีตหัวหน้ากลับมา: ดูได้ เปิดไม่ได้');
    // reconnect ก่อนหมดเวลา = ไม่เปลี่ยน
    setOnline(room, 'p3', false);
    engine.tick(room, 50000);
    setOnline(room, 'p3', true);
    engine.tick(room, 50000 + G + 1000);
    assert(spymaster(room, 'blue').playerId === 'p3', 'กลับมาทันเวลา = ยังเป็นหัวหน้า');

    // ทีมไม่มีลูกทีมออนไลน์ → ข้ามเทิร์นเอง
    room = makeRoom(4, { clue: 0 });
    setTeams(room, { red: [0, 1], blue: [2, 3] });
    engine.startGame(room, mulberry32(54), 1000);
    state = S(room);
    const cur = state.currentTeam;
    const curOp = operatives(room, cur)[0];
    setOnline(room, curOp.playerId, false);
    engine.tick(room, 1000);
    engine.tick(room, 1000 + N - 5);
    assert(state.currentTeam === cur, 'ยังอยู่ในเวลาผ่อนผัน (ทีมไม่มีลูกทีม)');
    engine.tick(room, 1000 + N + 5);
    assert(state.currentTeam === engine.otherTeam(cur), 'ไม่มีลูกทีมออนไลน์ = ข้ามเทิร์น');
    // ทั้งสองทีมไม่มีลูกทีม = ไม่ปิงปอง
    const otherOp = operatives(room, state.currentTeam)[0];
    setOnline(room, otherOp.playerId, false);
    const turnBefore = state.turnNumber;
    for (let t = 0; t < 10; t += 1) engine.tick(room, 100000 + t * N * 2);
    assert(state.turnNumber === turnBefore, 'ไม่มีใครเล่นได้ทั้งคู่ = ไม่ข้ามไปมา');

    // ออกจากเกม: หัวหน้าออก → ตั้งใหม่ทันที · ทีมว่าง → แพ้
    room = makeRoom(6);
    setTeams(room, { red: [0, 1, 2], blue: [3, 4, 5] });
    engine.startGame(room, mulberry32(55), 1000);
    state = S(room);
    room.players = room.players.filter(p => p.playerId !== 'p0');
    engine.handlePlayerLeft(room, 'p0', 1500);
    assert(spymaster(room, 'red') && spymaster(room, 'red').playerId === 'p1', 'หัวหน้าออก = ตั้งคนใหม่ทันที');
    assert(state.status === 'playing', 'ยังเล่นต่อได้');
    engine.handlePlayerLeft(room, 'p0', 1500);
    assert(state.roster.filter(p => p.left).length === 1, 'ออกซ้ำไม่นับซ้ำ');
    ['p3', 'p4'].forEach(id => engine.handlePlayerLeft(room, id, 1600));
    assert(state.status === 'playing' && spymaster(room, 'blue').playerId === 'p5', 'ทีมน้ำเงินเหลือคนเดียว เป็นหัวหน้า');
    engine.handlePlayerLeft(room, 'p5', 1700);
    assert(state.phase === 'finished' && state.winner === 'red' && state.winReason === 'forfeit', 'ทีมว่าง = อีกทีมชนะ');
    const result = engine.buildResult(room);
    assert(result.players.every(p => p.team === 'red'), 'สถิติไม่นับคนที่ออกไปแล้ว');

    // syncRoster: roomManager เอาผู้เล่นออกโดยไม่เรียก handlePlayerLeft ก็ยังจับได้ใน tick
    room = makeRoom(5);
    setTeams(room, { red: [0, 1], blue: [2, 3, 4] });
    engine.startGame(room, mulberry32(56), 1000);
    room.players = room.players.filter(p => p.playerId !== 'p4');
    assert(engine.tick(room, 1100) === true && S(room).roster.find(p => p.playerId === 'p4').left, 'tick จับคนที่หายจากห้อง');
    room.players.push({ playerId: 'p4', playerName: 'ผู้เล่น4', socketId: 's4' });
    engine.tick(room, 1200);
    assert(!S(room).roster.find(p => p.playerId === 'p4').left, 'กลับเข้าห้องกลางเกม = กลับทีมเดิม');
    console.log('8. นาฬิกาใบ้/ทาย · หัวหน้าหลุด → ตั้งใหม่ · ทีมไม่มีคนข้ามเทิร์น · ออกกลางเกม ✓');
})();

// ---------- 9. สุ่มเล่นหลายร้อยเกม ----------
(function randomized() {
    let games = 0;
    const reasons = {};
    for (let seed = 1; seed <= 600; seed += 1) {
        const rng = mulberry32(seed * 7919);
        const n = 4 + (seed % 9);
        const room = makeRoom(n, { clue: [0, 90, 120][seed % 3], guess: [0, 60, 90, 120][seed % 4] });
        engine.shuffleTeams(room, rng);
        engine.startGame(room, rng, 1000);
        const state = S(room);
        let now = 1000;
        let guard = 0;
        while (state.status === 'playing') {
            guard += 1;
            if (guard > 2000) throw new Error('เกมไม่จบ seed ' + seed);
            now += 500;
            const team = state.currentTeam;
            const remainingBefore = { red: engine.remainingFor(state, 'red'), blue: engine.remainingFor(state, 'blue') };
            const roll = rng();
            // บางทีมีคนหลุด/กลับ
            if (roll < 0.03) {
                const p = room.players[Math.floor(rng() * room.players.length)];
                p.socketId = p.socketId ? null : 's-back';
            }
            // บางทีมีคนออก
            if (roll > 0.995 && room.players.length > 2) {
                const p = room.players[Math.floor(rng() * room.players.length)];
                room.players = room.players.filter(x => x !== p);
                engine.handlePlayerLeft(room, p.playerId, now);
                continue;
            }
            if (state.phase === 'clue') {
                const sm = spymaster(room, team);
                if (!sm || !room.players.find(p => p.playerId === sm.playerId && p.socketId) || rng() < 0.05) {
                    now += 30000;
                    engine.tick(room, now);
                    continue;
                }
                const number = rng() < 0.1 ? 'inf' : Math.floor(rng() * 4);
                const word = 'คำใบ้' + guard;
                if (engine.validateClueWord(state, word)) { engine.tick(room, now + 200000); continue; }
                engine.submitClue(room, sm.playerId, { word, number }, ctx(room), now);
                // ผิดกติกา: อีกทีมใบ้
                const otherSm = spymaster(room, engine.otherTeam(team));
                if (otherSm) throws(() => engine.submitClue(room, otherSm.playerId, { word: 'แทรก', number: 1 }, ctx(room), now), null, 'อีกทีมใบ้แทรก');
                continue;
            }
            // guess
            const ops = operatives(room, team).filter(p => room.players.find(x => x.playerId === p.playerId && x.socketId));
            if (!ops.length) { now += 20000; engine.tick(room, now); continue; }
            const op = ops[Math.floor(rng() * ops.length)];
            const hidden = state.board.map((c, i) => i).filter(i => !state.board[i].revealed);
            const r2 = rng();
            const madeBefore = state.guessesMade;
            const turnBefore = state.turnNumber;
            const maxG = state.clue.maxGuesses;
            if (r2 < 0.1 && state.guessesMade > 0) {
                engine.endTurn(room, op.playerId, ctx(room), now);
                assert(state.turnNumber === turnBefore + 1, 'จบเทิร์นแล้วเปลี่ยนตา');
                continue;
            }
            // ชอบเลือกสีตัวเองนิดหน่อย
            let pick = hidden[Math.floor(rng() * hidden.length)];
            if (rng() < 0.55) {
                const own = hidden.filter(i => state.board[i].color === team);
                if (own.length) pick = own[Math.floor(rng() * own.length)];
            }
            const color = state.board[pick].color;
            if (r2 < 0.5) reveal(room, op.playerId, pick, now);
            else {
                ops.forEach(o => { try { engine.proposeCard(room, o.playerId, pick, ctx(room), now); } catch (e) { /* อาจเปิดไปแล้ว */ } });
                if (!state.board[pick].revealed) reveal(room, op.playerId, pick, now);
            }
            assert(state.board[pick].revealed, 'การ์ดต้องเปิดแล้ว');
            // invariants หลังเปิด
            if (color === 'assassin') assert(state.winner === engine.otherTeam(team), 'มือสังหาร → อีกทีมชนะ');
            else if (color !== team) {
                if (state.status === 'playing') assert(state.turnNumber === turnBefore + 1 && state.currentTeam !== team, 'ผิดสี → เปลี่ยนตา');
            } else if (state.status === 'playing') {
                if (maxG && madeBefore + 1 >= maxG) assert(state.currentTeam !== team, 'ครบจำนวน → เปลี่ยนตา');
                else assert(state.currentTeam === team && state.phase === 'guess', 'ถูกสี ยังไม่ครบ → ทายต่อ');
            }
            const after = { red: engine.remainingFor(state, 'red'), blue: engine.remainingFor(state, 'blue') };
            assert(after.red + after.blue >= remainingBefore.red + remainingBefore.blue - 1, 'เปิดได้ครั้งละใบ');
            if (state.status !== 'playing' && state.winReason !== 'forfeit' && state.winReason !== 'assassin') {
                assert(after[state.winner] === 0, 'ทีมที่ชนะด้วยคำต้องเปิดครบ');
            }
            // secrecy ระหว่างเกม
            if (state.status === 'playing' && guard % 7 === 0) {
                state.roster.filter(p => p.role === 'operative' || p.role === 'spectator').forEach(p => {
                    const view = engine.buildClientState(room, p.playerId);
                    assert(view.board.every(c => c.revealed || c.color === null), 'ลูกทีมไม่เห็นสีที่ยังไม่เปิด');
                });
            }
        }
        assert(state.phase === 'finished', 'เกมต้องจบ');
        assert(state.winner === 'red' || state.winner === 'blue' || (state.winReason === 'abandoned' && state.winner === null), 'มีทีมชนะ (หรือไม่เหลือคนทายทั้งคู่)');
        assert(state.board.filter(c => c.color === 'assassin' && c.revealed).length <= 1, 'มือสังหารเปิดได้ครั้งเดียว');
        reasons[state.winReason] = (reasons[state.winReason] || 0) + 1;
        const result = engine.buildResult(room);
        assert(result.players.every(p => p.won === (p.team === state.winner)), 'ผลสถิติตรงทีม');
        games += 1;
    }
    assert(reasons.words > 0 && reasons.assassin > 0, 'สุ่มแล้วต้องเจอทั้งชนะด้วยคำและมือสังหาร: ' + JSON.stringify(reasons));
    console.log(`9. สุ่มเล่น ${games} เกม (4–12 คน) จบทุกเกม ✓ ${JSON.stringify(reasons)}`);
})();

// ---------- 10. UX: หัวห้องข้ามเทิร์นที่ค้าง · ข้อความคำใบ้ยาว ----------
(function hostSkip() {
    const room = makeRoom(4, { clue: 0, guess: 0 });
    setTeams(room, { red: [0, 1], blue: [2, 3] });
    engine.startGame(room, mulberry32(77), 1000);
    const state = S(room);
    const wait = engine.HOST_SKIP_AFTER_MS;
    assert(state.phaseStartedAt === 1000 && state.phaseEndsAt === null, 'ปิดนาฬิกา: จำเวลาเริ่มเฟสไว้');
    const view = engine.buildClientState(room, 'p1', 1000);
    assert(view.phaseStartedAt === 1000 && view.hostSkipAfterMs === wait, 'client รู้ว่าข้ามได้เมื่อไร');
    const team = state.currentTeam;
    throws(() => engine.hostSkipTurn(room, 'p1', false, ctx(room), 1000 + wait + 1), /เฉพาะหัวหน้าห้อง/, 'ไม่ใช่หัวห้องข้ามไม่ได้');
    throws(() => engine.hostSkipTurn(room, 'p0', true, ctx(room), 1000 + wait - 5000), /อีก 5 วิ/, 'ยังไม่ค้างนานพอ บอกว่าอีกกี่วิ');
    throws(() => engine.hostSkipTurn(room, 'p0', true, { step: state.step - 1 }, 1000 + wait), /จังหวะ/, 'step เก่า');
    engine.hostSkipTurn(room, 'p0', true, ctx(room), 1000 + wait);
    assert(state.currentTeam === engine.otherTeam(team) && state.phase === 'clue' && state.turnNumber === 2, 'ข้ามช่วงใบ้ไปอีกทีม');
    assert(state.phaseStartedAt === 1000 + wait, 'เฟสใหม่เริ่มนับใหม่');
    assert(/ข้ามเทิร์น/.test(state.history[state.history.length - 1].text), 'บันทึกว่าใครข้าม');
    // ช่วงทาย: ข้ามได้หลังค้างนาน · clueLog บอกว่าจบเพราะหัวห้องข้าม
    const t2 = state.currentTeam;
    const sm = spymaster(room, t2);
    engine.submitClue(room, sm.playerId, { word: 'ลองดู', number: 2 }, ctx(room), 1000 + wait + 10);
    assert(state.phaseStartedAt === 1000 + wait + 10, 'เริ่มช่วงทายนับใหม่');
    throws(() => engine.hostSkipTurn(room, 'p0', true, ctx(room), 1000 + wait + 20), /ค้างนานเกิน/, 'เพิ่งใบ้ ข้ามไม่ได้');
    engine.hostSkipTurn(room, 'p0', true, ctx(room), 1000 + 2 * wait + 10);
    assert(state.currentTeam === team && state.clueLog[state.clueLog.length - 1].endedBy === 'host-skip', 'ข้ามช่วงทาย บันทึกเหตุ');
    // state เก่า (ก่อนมี phaseStartedAt) ข้ามได้ทันที
    state.phaseStartedAt = null;
    assert(engine.hostSkipWaitMs(state, 5) === 0, 'state เก่าไม่ติดรอ');
    // จบเกมแล้วข้ามไม่ได้
    state.status = engine.FINISHED_STATUS;
    throws(() => engine.hostSkipTurn(room, 'p0', true, ctx(room), 9e9), /จบไปแล้ว/, 'จบแล้วข้ามไม่ได้');
    assert(/ไม่เกิน 24/.test(engine.validateClueWord({ board: [] }, 'ก'.repeat(25))), 'คำใบ้ยาวบอกขีดจำกัด');
    console.log('10. หัวห้องข้ามเทิร์นที่ค้าง (หลัง ' + wait / 1000 + ' วิ) · ข้อความคำใบ้ยาว ✓');
})();

console.log(`\n✅ smoke:codenames ผ่าน ${checks} เช็ก`);
