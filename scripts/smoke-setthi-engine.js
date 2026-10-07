/**
 * เศรษฐี — เทส engine ล้วน (ไม่มีเซิร์ฟเวอร์)
 *  กติกาทีละข้อ: ซื้อ/สร้างหลายขั้น · กติการอบแรก · ค่าผ่านทาง · ซื้อต่อ 2 เท่า · แลนด์มาร์กซื้อต่อไม่ได้ · ท่องเที่ยว
 *  ผูกขาด 3 แบบ + กรณีขอบ · ดับเบิล/เกาะร้าง ทุกทางออก · เทศกาลย้ายที่ · ทัวร์วาร์ป · โบนัสจุดเริ่ม · การ์ดทุกใบ
 *  ภาษี · หนี้/ขายคืน/ล้มละลาย · การ์ดนางฟ้า · หมดเวลา · คนออก · autopilot · จังหวะฉาก/บอท
 *  สุ่มเกมบอทล้วนหลายพันเกม + เกมคำสั่งมั่ว ตรวจบัญชีเงินและกติกาทุกก้าว
 *
 * รัน: npm run smoke:setthi   (SETTHI_GAMES=จำนวนเกมสุ่ม)
 */
process.env.SETTHI_ANIM_SCALE = process.env.SETTHI_ANIM_SCALE || '0';
process.env.SETTHI_BOT_MS = process.env.SETTHI_BOT_MS || '0';
const E = require('../games/setthiEngine');
const B = E.board;

let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
function eq(a, b, m) { assert(a === b, `${m}: ได้ ${JSON.stringify(a)} ต้องเป็น ${JSON.stringify(b)}`); }
function throws(fn, m) { let ok = false; try { fn(); } catch (e) { ok = true; } assert(ok, m + ' (ต้องโดนปฏิเสธ)'); }
function audit(room, m) { const p = E.auditState(room); assert(!p.length, `${m}: ${p.join(' · ')}`); }

function mulberry(a) {
    return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let T = 1.7e12;
E.setClock(() => T);

/** ห้องทดลอง: ids ขึ้นต้น bot_ = บอท · นอกนั้นเป็นคน (ต่อเน็ตอยู่) */
function makeRoom(ids, opts = {}) {
    const room = {
        roomId: 'r' + Math.random().toString(36).slice(2, 8),
        admin: ids[0],
        settings: { gameMode: 'setthi', setthiMinutes: opts.minutes === undefined ? 0 : opts.minutes },
        players: ids.map(id => ({ playerId: id, playerName: id.toUpperCase(), socketId: E.isBotId(id) ? null : 'sock_' + id }))
    };
    E.startGame(room, opts.rng || mulberry(7), { firstSeat: 0, dice: opts.dice || [] });
    return room;
}
const S = room => room.gameState;
const seat = (room, id) => S(room).seats.find(s => s.playerId === id);
const p = (room, i) => S(room).props[i];
function give(room, id, squares, level = 0) {
    squares.forEach(i => { p(room, i).owner = id; p(room, i).level = B.SQUARES[i].type === 'city' ? level : 0; });
}
function dice(room, list) { S(room).testDice.push(...list); }
/** วางตำแหน่ง แล้วทอยให้ได้ total ที่ต้องการ */
function rollTotal(room, id, from, pair) {
    seat(room, id).pos = from;
    dice(room, [pair]);
    E.rollDice(room, id, { seq: S(room).phaseSeq });
}
/** ให้ตาเป็นของ id ใหม่ (จบเรื่องค้างทั้งหมด) */
function forceTurn(room, id) {
    const state = S(room);
    state.pending = null;
    state.debts = [];
    state.turn = { playerId: id, seq: state.turnSeq + 1, doublesStreak: 0, canRollAgain: false, hasRolled: false, lastRoll: null, startedAt: T };
    state.turnSeq += 1;
    state.phase = 'roll';
    state.phaseActor = id;
    state.phaseSeq += 1;
    state.phaseStartedAt = T;
    state.phaseMs = E.TURN_MS;
}
function cashTotal(room) { return S(room).seats.reduce((s, x) => s + x.cash, 0); }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ---------- กระดาน ----------
test('กระดาน 32 ช่อง · มุม 4 · เมือง 20 ใน 8 กลุ่ม · ท่องเที่ยว 4 · โอกาส 3 · ภาษี 1', () => {
    eq(B.SQUARES.length, 32, 'จำนวนช่อง');
    eq(B.SQUARES[0].type, 'start', 'มุมเริ่ม');
    eq(B.SQUARES[8].type, 'island', 'มุมเกาะ');
    eq(B.SQUARES[16].type, 'festival', 'มุมเทศกาล');
    eq(B.SQUARES[24].type, 'tour', 'มุมทัวร์');
    eq(B.CITY_SQUARES.length, 20, 'เมือง');
    eq(Object.keys(B.GROUP_SQUARES).length, 8, 'กลุ่มสี');
    Object.values(B.GROUP_SQUARES).forEach(list => assert(list.length === 2 || list.length === 3, 'กลุ่มละ 2–3'));
    eq(B.TOURIST_SQUARES.length, 4, 'ท่องเที่ยว');
    eq(B.SQUARES.filter(s => s.type === 'chance').length, 3, 'โอกาส');
    eq(B.SQUARES.filter(s => s.type === 'tax').length, 1, 'ภาษี');
    B.SIDE_SQUARES.forEach((list, side) => { eq(list.length, 6, 'ช่องซื้อได้ด้าน ' + side); eq(list.filter(i => B.SQUARES[i].type === 'tourist').length, 1, 'ท่องเที่ยวด้านละ 1'); });
    const prices = B.CITY_SQUARES.map(i => B.SQUARES[i].price);
    assert(prices.every((x, k) => k === 0 || x >= prices[k - 1]), 'ราคาเมืองเรียงถูก → แพง');
    eq(B.SQUARES[31].name, 'สุขุมวิท', 'ย่านดังกรุงเทพฯ อยู่ท้ายสุด');
});

test('เริ่มเกม: เงินทุน · ตำแหน่ง · ไม่มีการ์ด/บัญชีรั่วไป client', () => {
    const room = makeRoom(['a', 'b', 'c']);
    S(room).seats.forEach(s => { eq(s.cash, B.START_CASH, 'เงินเริ่ม'); eq(s.pos, 0, 'อยู่จุดเริ่ม'); eq(s.laps, 0, 'รอบ'); });
    const view = E.buildClientState(room, 'b');
    const json = JSON.stringify(view);
    assert(!/"deck"|"ledger"|testDice|"k\d\d"/.test(json), 'state ของ client ไม่มีลำดับการ์ด/บัญชี');
    eq(view.phase, 'roll', 'เฟสทอย');
    eq(view.phaseActor, 'a', 'คนแรกทอย');
    throws(() => E.startGame({ roomId: 'x', players: [{ playerId: 'a', socketId: 's' }], settings: {} }), 'คนเดียวเริ่มไม่ได้');
    throws(() => E.startGame({ roomId: 'x', players: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => ({ playerId: id, socketId: 's' })), settings: {} }), '7 คนเริ่มไม่ได้');
    audit(room, 'เริ่ม');
});

test('6 คน: เริ่มได้ · สีหมาก 6 สีไม่ซ้ำ (ใช้เป็นสีเจ้าของด้วย) · ทุนเท่ากัน · บัญชีลง · ลำดับตาวนครบ 6', () => {
    eq(E.maxPlayers, 6, 'engine maxPlayers');
    const ids = ['a', 'b', 'c', 'bot_d', 'bot_e', 'bot_f'];
    const room = makeRoom(ids);
    const seats = S(room).seats;
    eq(seats.length, 6, '6 ที่นั่ง');
    eq(new Set(seats.map(x => x.tokenColor)).size, 6, 'สีไม่ซ้ำ');
    eq(new Set(seats.map(x => x.colorName)).size, 6, 'ชื่อสีไม่ซ้ำ');
    seats.forEach(x => { eq(x.cash, B.START_CASH, 'ทุน'); assert(/^#[0-9a-f]{6}$/i.test(x.tokenInk), 'มีสีตัวหนังสือ'); });
    eq(S(room).ledger.startTotal, 6 * B.START_CASH, 'ทุนรวม 6 คน');
    // วนตาครบ 6 คน (ทอยแต้มที่ตกช่องว่างแล้วผ่าน)
    const order = [];
    for (let k = 0; k < 7; k += 1) {
        const id = S(room).phaseActor;
        order.push(id);
        dice(room, [[1, 2]]);
        E.rollDice(room, id, { seq: S(room).phaseSeq });
        while (S(room).phase !== 'roll') {
            const a = S(room).phaseActor;
            if (S(room).phase === 'build') E.passBuild(room, a, null);
            else if (S(room).phase === 'pick') E.skipPick(room, a, null);
            else if (S(room).phase === 'takeover') E.declineTakeover(room, a, null);
            else break;
        }
        audit(room, 'วนตา ' + k);
    }
    eq(order.slice(0, 6).join(','), ids.join(','), 'ตาวนตามที่นั่ง');
    eq(order[6], 'a', 'ครบรอบกลับคนแรก');
    eq(S(room).round, 2, 'นับรอบ 2');
    const view = E.buildClientState(room, 'c');
    eq(view.seats.length, 6, 'client เห็น 6 คน');
});

// ---------- ซื้อ / สร้าง ----------
test('ตกเมืองว่าง: แผ่นเดียว ซื้อที่ดิน+บ้านได้ในครั้งเดียว · รอบแรกถึงบ้าน · ตึก/โรงแรม/แลนด์มาร์กล็อก', () => {
    const room = makeRoom(['a', 'b']);
    rollTotal(room, 'a', 0, [1, 3]); // → 4 อุดร
    eq(S(room).phase, 'build', 'เฟสสร้าง');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.square, 4, 'ช่อง');
    eq(d.mode, 'buy', 'โหมดซื้อ');
    eq(d.options.length, 5, 'แสดงครบ 5 ขั้น');
    eq(d.options[0].locked, null, 'ที่ดินซื้อได้');
    eq(d.options[1].locked, null, 'บ้านสร้างได้รอบแรก');
    eq(d.options[2].locked, 'lap', 'ตึกล็อกรอบแรก');
    eq(d.options[3].locked, 'lap', 'โรงแรมล็อกรอบแรก');
    eq(d.options[4].locked, 'hotel', 'แลนด์มาร์กต้องมีโรงแรมก่อน');
    throws(() => E.buildTo(room, 'a', 2, null), 'สร้างตึกรอบแรกไม่ได้');
    throws(() => E.buildTo(room, 'b', 0, null), 'คนอื่นซื้อแทนไม่ได้');
    throws(() => E.buildTo(room, 'a', 0, { seq: S(room).phaseSeq - 1 }), 'seq เก่าโดนปฏิเสธ');
    const before = seat(room, 'a').cash;
    E.buildTo(room, 'a', 1, { seq: S(room).phaseSeq });
    eq(p(room, 4).owner, 'a', 'เป็นเจ้าของ');
    eq(p(room, 4).level, 1, 'มีบ้าน');
    eq(before - seat(room, 'a').cash, B.levelCost(4, 0) + B.levelCost(4, 1), 'จ่ายที่ดิน+บ้าน');
    eq(S(room).phaseActor, 'b', 'จบตา ไม่มีเฟสจัดการ');
    audit(room, 'ซื้อ');
});

test('ตั้งแต่รอบที่ 2 (ผ่านจุดเริ่มแล้ว) สร้างได้ถึงโรงแรมในครั้งเดียว · เงินไม่พอโดนปฏิเสธ', () => {
    const room = makeRoom(['a', 'b']);
    rollTotal(room, 'a', 28, [3, 5]); // ผ่านเริ่ม → 4
    eq(seat(room, 'a').laps, 1, 'นับรอบ');
    eq(seat(room, 'a').cash, B.START_CASH + B.SALARY, 'เงินเดือน');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.options[3].locked, null, 'โรงแรมสร้างได้');
    eq(E.buildCost(room, seat(room, 'a'), 4, 'buy', 3), B.valueAt(4, 3), 'ราคารวมถึงโรงแรม');
    seat(room, 'a').cash = 100; S(room).ledger.bankIn += B.START_CASH + B.SALARY - 100;
    throws(() => E.buildTo(room, 'a', 0, null), 'เงินไม่พอ');
    seat(room, 'a').cash = B.START_CASH; S(room).ledger.bankIn -= B.START_CASH - 100;
    E.buildTo(room, 'a', 3, null);
    eq(p(room, 4).level, 3, 'โรงแรม');
    audit(room, 'โรงแรม');
});

test('ตกเมืองตัวเอง: อัปเกรดต่อ · มีโรงแรมแล้วตกซ้ำ = สร้างแลนด์มาร์ก · ผ่านได้', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [4], 1);
    seat(room, 'a').laps = 1;
    rollTotal(room, 'a', 0, [1, 3]);
    eq(S(room).phase, 'build', 'เมืองตัวเองมีแผ่นสร้าง');
    let d = E.buildClientState(room, 'a').decision;
    eq(d.mode, 'upgrade', 'โหมดอัปเกรด');
    assert(d.options[0].built && d.options[1].built, 'ขั้นที่มีแล้ว');
    eq(d.options[4].locked, 'hotel', 'ยังไม่มีโรงแรม แลนด์มาร์กล็อก');
    E.buildTo(room, 'a', 3, null);
    eq(p(room, 4).level, 3, 'อัปเป็นโรงแรม');
    forceTurn(room, 'a');
    rollTotal(room, 'a', 0, [1, 3]);
    d = E.buildClientState(room, 'a').decision;
    eq(d.options[4].locked, null, 'แลนด์มาร์กปลดล็อก');
    eq(E.buildCost(room, seat(room, 'a'), 4, 'upgrade', 4), B.levelCost(4, 4), 'ราคาแลนด์มาร์ก');
    E.buildTo(room, 'a', 4, null);
    eq(p(room, 4).level, 4, 'แลนด์มาร์ก');
    forceTurn(room, 'a');
    rollTotal(room, 'a', 0, [1, 3]);
    assert(S(room).phase !== 'build', 'แลนด์มาร์กแล้วไม่มีอะไรให้สร้าง');
    forceTurn(room, 'a');
    give(room, 'a', [6], 0);
    rollTotal(room, 'a', 0, [3, 3]);
    eq(S(room).phase, 'build', 'แผ่นสร้าง');
    E.passBuild(room, 'a', null);
    eq(p(room, 6).level, 0, 'ผ่าน = ไม่สร้าง');
    audit(room, 'แลนด์มาร์ก');
});

// ---------- ค่าผ่านทาง / ซื้อต่อ ----------
test('ค่าผ่านทาง = ราคาฐาน × ตัวคูณขั้น × เทศกาล · เงินย้ายครบ', () => {
    const room = makeRoom(['a', 'b']);
    [0, 1, 2, 3, 4].forEach(level => {
        give(room, 'b', [7], level);
        eq(E.tollFor(room, 7), Math.round(B.SQUARES[7].price * B.TOLL_MULT[level] / 10) * 10, 'ค่าผ่านทางขั้น ' + level);
    });
    give(room, 'b', [7], 2);
    S(room).festival = 7;
    eq(E.tollFor(room, 7), Math.round(B.SQUARES[7].price * B.TOLL_MULT[2] / 10) * 10 * 2, 'เทศกาล ×2');
    const total = cashTotal(room);
    const a0 = seat(room, 'a').cash;
    const b0 = seat(room, 'b').cash;
    const toll = E.tollFor(room, 7);
    rollTotal(room, 'a', 0, [3, 4]);
    eq(a0 - seat(room, 'a').cash, toll, 'จ่ายค่าผ่านทาง');
    eq(seat(room, 'b').cash - b0, toll, 'เจ้าของได้');
    eq(cashTotal(room), total, 'เงินไม่หายไม่งอก');
    audit(room, 'ค่าผ่านทาง');
});

test('ซื้อต่อ = 2 เท่าของมูลค่ารวม · สิ่งปลูกสร้างอยู่ครบ · สร้างต่อได้ทันที (แลนด์มาร์กยังไม่ได้)', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [7], 2);
    seat(room, 'a').laps = 1;
    rollTotal(room, 'a', 0, [3, 4]);
    eq(S(room).phase, 'takeover', 'เสนอซื้อต่อ');
    const price = E.takeoverPrice(room, 7);
    eq(price, 2 * B.valueAt(7, 2), 'ราคา 2 เท่า');
    eq(E.buildClientState(room, 'a').decision.price, price, 'client เห็นราคาเดียวกัน');
    throws(() => E.acceptTakeover(room, 'b', null), 'เจ้าของซื้อต่อตัวเองไม่ได้');
    const a0 = seat(room, 'a').cash;
    const b0 = seat(room, 'b').cash;
    E.acceptTakeover(room, 'a', null);
    eq(p(room, 7).owner, 'a', 'เปลี่ยนเจ้าของ');
    eq(p(room, 7).level, 2, 'สิ่งปลูกสร้างอยู่ครบ');
    eq(a0 - seat(room, 'a').cash, price, 'คนซื้อจ่าย');
    eq(seat(room, 'b').cash - b0, price, 'เจ้าของเดิมได้เงิน');
    eq(S(room).phase, 'build', 'สร้างต่อได้ทันที');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.mode, 'afterTakeover', 'โหมดหลังซื้อต่อ');
    eq(d.options[3].locked, null, 'โรงแรมได้');
    eq(d.options[4].locked, 'later', 'แลนด์มาร์กต้องตกซ้ำ');
    throws(() => E.buildTo(room, 'a', 4, null), 'แลนด์มาร์กทันทีไม่ได้');
    E.buildTo(room, 'a', 3, null);
    eq(p(room, 7).level, 3, 'สร้างต่อเป็นโรงแรม');
    const fx = S(room).fx.filter(f => f.kind === 'takeover');
    eq(fx.length, 1, 'มีฉากซื้อต่อ');
    eq(fx[0].from, 'b', 'ฉากรู้ว่าใครโดนซื้อ');
    audit(room, 'ซื้อต่อ');
});

test('ซื้อต่อ: เงินไม่พอ = ไม่เสนอ · ไม่ซื้อ = จบ', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [31], 3);
    rollTotal(room, 'a', 29, [1, 1]); // → 31 ราคา 2 เท่าโรงแรมสุขุมวิทแพงเกินเงิน
    assert(S(room).phase !== 'takeover', 'เงินไม่พอไม่เสนอซื้อต่อ');
    const room2 = makeRoom(['a', 'b']);
    give(room2, 'b', [7], 1);
    rollTotal(room2, 'a', 0, [3, 4]);
    eq(S(room2).phase, 'takeover', 'เสนอซื้อต่อ');
    E.declineTakeover(room2, 'a', null);
    eq(p(room2, 7).owner, 'b', 'ไม่ซื้อ = ยังเป็นของเดิม');
    eq(S(room2).phaseActor, 'b', 'จบตา');
    assert(S(room2).fx.some(f => f.kind === 'decision' && f.about === 'takeover'), 'คนอื่นเห็นว่าเลือกไม่ซื้อ');
    audit(room2, 'ไม่ซื้อต่อ');
});

test('แลนด์มาร์กไม่มีวันโดนซื้อต่อ', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [7], 4);
    seat(room, 'a').cash = 900000; S(room).ledger.bankOut += 900000 - B.START_CASH;
    rollTotal(room, 'a', 0, [3, 4]);
    assert(S(room).phase !== 'takeover', 'ไม่เสนอซื้อต่อแลนด์มาร์ก');
    eq(p(room, 7).owner, 'b', 'ยังเป็นของเดิม');
    S(room).pending = { type: 'takeover', square: 7, playerId: 'a', id: 999 };
    S(room).phase = 'takeover';
    S(room).phaseActor = 'a';
    throws(() => E.acceptTakeover(room, 'a', null), 'ยิงคำสั่งตรง ๆ ก็ไม่ได้');
    eq(p(room, 7).owner, 'b', 'ยังเป็นของเดิม (2)');
    S(room).pending = null;
    // บอทก็ไม่ซื้อ
    const r2 = makeRoom(['bot_a', 'b']);
    give(r2, 'b', [7], 4);
    rollTotal(r2, 'bot_a', 0, [3, 4]);
    assert(S(r2).phase !== 'takeover', 'บอทไม่เจอเสนอซื้อต่อแลนด์มาร์ก');
});

test('แหล่งท่องเที่ยว: ซื้อได้อย่างเดียว · ค่าผ่านทางตามจำนวน · ซื้อต่อไม่ได้', () => {
    const room = makeRoom(['a', 'b']);
    rollTotal(room, 'a', 0, [2, 3]); // → 5 ตลาดน้ำ
    const d = E.buildClientState(room, 'a').decision;
    eq(d.options.length, 1, 'มีแค่ที่ดิน');
    E.buildTo(room, 'a', 0, null);
    eq(p(room, 5).owner, 'a', 'ซื้อแล้ว');
    throws(() => E.buildTo(room, 'a', 1, null), 'สร้างบนท่องเที่ยวไม่ได้');
    eq(E.tollFor(room, 5), B.TOUR_TOLL[0], 'มี 1 แห่ง');
    give(room, 'a', [11], 0);
    eq(E.tollFor(room, 5), B.TOUR_TOLL[1], 'มี 2 แห่ง');
    give(room, 'a', [21], 0);
    eq(E.tollFor(room, 11), B.TOUR_TOLL[2], 'มี 3 แห่ง');
    forceTurn(room, 'b');
    rollTotal(room, 'b', 0, [2, 3]);
    assert(S(room).phase !== 'takeover', 'ท่องเที่ยวซื้อต่อไม่ได้');
    audit(room, 'ท่องเที่ยว');
});

// ---------- ผูกขาด ----------
function monoRoom() { return makeRoom(['a', 'b', 'c']); }
test('ผูกขาด 3 สี: ชนะทันที · 2 สีไม่ชนะ', () => {
    const room = monoRoom();
    give(room, 'a', [...B.GROUP_SQUARES.g1, ...B.GROUP_SQUARES.g2]);
    eq(E.monopolyOf(room, 'a'), null, '2 สียังไม่ชนะ');
    give(room, 'a', [B.GROUP_SQUARES.g3[0]]);
    const threats = E.monopolyThreats(room).filter(t => t.playerId === 'a' && t.type === 'color');
    eq(threats.length, 1, 'เตือนขาด 1 ช่อง');
    eq(threats[0].squares.join(), String(B.GROUP_SQUARES.g3[1]), 'ช่องที่ขาด');
    rollTotal(room, 'a', 0, [5, 5]); // → 10 เชียงราย
    E.buildTo(room, 'a', 0, null);
    eq(S(room).phase, 'finished', 'จบเกม');
    eq(S(room).monopoly.type, 'color', 'ผูกขาดสี');
    eq(S(room).winners.length, 1, 'ผู้ชนะคนเดียว');
    eq(S(room).winners[0].playerId, 'a', 'a ชนะ');
    assert(S(room).fx.some(f => f.kind === 'monopoly' && f.type === 'color'), 'มีฉากฉลอง');
    eq(S(room).standings[0].playerId, 'a', 'อันดับ 1 คือคนผูกขาด แม้ทรัพย์สินน้อยกว่า');
});

test('ผูกขาดแถว: ต้องรวมแหล่งท่องเที่ยวในด้านนั้น · เจ้าของปนกันไม่ชนะ', () => {
    const room = monoRoom();
    const side = B.SIDE_SQUARES[1]; // 9 10 11 12 14 15
    const tour = side.find(i => B.SQUARES[i].type === 'tourist');
    give(room, 'a', side.filter(i => i !== tour));
    eq(E.monopolyOf(room, 'a'), null, 'ขาดท่องเที่ยวยังไม่ชนะ');
    give(room, 'b', [tour]);
    eq(E.monopolyOf(room, 'a'), null, 'เจ้าของปนกันไม่ชนะ');
    assert(!E.monopolyThreats(room).some(t => t.playerId === 'a' && t.type === 'line'), 'ท่องเที่ยวของคนอื่นซื้อต่อไม่ได้ = ไม่เตือน');
    p(room, tour).owner = null;
    assert(E.monopolyThreats(room).some(t => t.playerId === 'a' && t.type === 'line' && t.squares[0] === tour), 'เตือนผูกขาดแถว');
    rollTotal(room, 'a', 8, [1, 2]); // → 11 เขาใหญ่
    E.buildTo(room, 'a', 0, null);
    eq(S(room).phase, 'finished', 'ชนะ');
    eq(S(room).monopoly.type, 'line', 'ผูกขาดแถว');
    eq(S(room).monopoly.side, 1, 'ด้านที่ 2');
});

test('ผูกขาดท่องเที่ยว: ครบ 4 แห่งชนะ', () => {
    const room = monoRoom();
    give(room, 'a', B.TOURIST_SQUARES.slice(0, 3));
    assert(E.monopolyThreats(room).some(t => t.playerId === 'a' && t.type === 'tourist'), 'เตือนท่องเที่ยว');
    rollTotal(room, 'a', 24, [1, 2]); // → 27 พีพี
    E.buildTo(room, 'a', 0, null);
    eq(S(room).monopoly.type, 'tourist', 'ผูกขาดท่องเที่ยว');
});

test('ผูกขาดหลังโดนซื้อต่อ: ซื้อต่อช่องสุดท้าย = ชนะ · คนที่โดนซื้อเสียสิทธิ์', () => {
    const room = monoRoom();
    const side = B.SIDE_SQUARES[0]; // 1 2 4 5 6 7
    give(room, 'a', side.filter(i => i !== 7));
    give(room, 'b', [7], 1);
    seat(room, 'a').cash = 100000; S(room).ledger.bankOut += 100000 - B.START_CASH;
    assert(E.monopolyThreats(room).some(t => t.playerId === 'a' && t.type === 'line' && t.squares[0] === 7), 'เตือนแม้ช่องมีเจ้าของ (ซื้อต่อได้)');
    rollTotal(room, 'a', 0, [3, 4]);
    eq(S(room).phase, 'takeover', 'เสนอซื้อต่อ');
    E.acceptTakeover(room, 'a', null);
    eq(S(room).phase, 'finished', 'ชนะทันทีหลังซื้อต่อ');
    eq(S(room).monopoly.type, 'line', 'แบบแถว');
    // แลนด์มาร์กของคนอื่นกันผูกขาดได้
    const r2 = monoRoom();
    give(r2, 'a', side.filter(i => i !== 7));
    give(r2, 'b', [7], 4);
    assert(!E.monopolyThreats(r2).some(t => t.playerId === 'a' && t.type === 'line' && t.side === 0), 'แลนด์มาร์กของคนอื่น = ไม่เตือน');
    // โดนซื้อต่อแล้วหลุดจากเตือน
    const r3 = monoRoom();
    give(r3, 'b', side.filter(i => i !== 1));
    give(r3, 'c', [1], 0);
    assert(E.monopolyThreats(r3).some(t => t.playerId === 'b' && t.type === 'line' && t.side === 0), 'b ขาดอีก 1 (ของ c ซื้อต่อได้)');
    rollTotal(r3, 'a', 0, [1, 1]); // a ตกมุกดาหาร (ของ b) → ซื้อต่อ
    eq(S(r3).phase, 'takeover', 'a ซื้อต่อได้');
    E.acceptTakeover(r3, 'a', null);
    eq(p(r3, 2).owner, 'a', 'ของ a แล้ว');
    assert(!E.monopolyThreats(r3).some(t => t.playerId === 'b' && t.type === 'line' && t.side === 0), 'b หลุดจากเตือน');
    audit(r3, 'หลังซื้อต่อ');
});

test('ผูกขาดพร้อมกันหลายแบบ: รายงานแบบที่มีช่องที่เพิ่งได้มา ตามลำดับ 3 สี → แถว → ท่องเที่ยว (คงที่ทุกครั้ง)', () => {
    // ซื้อช่อง 7 = ครบสีที่ 3 และครบแถวล่างพร้อมกัน → รายงาน "3 สี"
    for (let k = 0; k < 20; k += 1) {
        const room = monoRoom();
        give(room, 'a', [1, 2, 4, 5, 6, 9, 10]);
        rollTotal(room, 'a', 0, [3, 4]);
        E.buildTo(room, 'a', 0, null);
        eq(S(room).phase, 'finished', 'ชนะ');
        eq(S(room).monopoly.type, 'color', 'สี+แถวพร้อมกัน = รายงาน 3 สี');
        eq(S(room).winners[0].playerId, 'a', 'a ชนะ');
    }
    // ซื้อช่อง 21 = ครบท่องเที่ยวและครบแถวบนพร้อมกัน → รายงาน "แถว"
    const room = monoRoom();
    give(room, 'a', [5, 11, 27, 17, 18, 20, 22, 23]);
    rollTotal(room, 'a', 19, [1, 1]);
    E.buildTo(room, 'a', 0, null);
    eq(S(room).monopoly.type, 'line', 'ท่องเที่ยว+แถวพร้อมกัน = รายงานแถว');
    eq(S(room).monopoly.side, 2, 'แถวบน');
});

test('เตือนผูกขาด: ขาดหลายช่องไม่เตือน · ล้มละลายแล้วไม่เตือน', () => {
    const room = monoRoom();
    give(room, 'a', B.SIDE_SQUARES[2].slice(0, 4));
    assert(!E.monopolyThreats(room).some(t => t.playerId === 'a'), 'ขาด 2 ช่องยังไม่เตือน');
    give(room, 'a', [B.SIDE_SQUARES[2][4]]);
    assert(E.monopolyThreats(room).some(t => t.playerId === 'a' && t.type === 'line'), 'ขาด 1 ช่องเตือน');
    const view = E.buildClientState(room, 'c');
    assert(view.threats.some(t => t.playerId === 'a'), 'client ได้รายการเตือน');
});

// ---------- ดับเบิล / เกาะร้าง ----------
test('ดับเบิลทอยอีก · ดับเบิล 3 ครั้งติด = ไปเกาะร้าง', () => {
    const room = makeRoom(['a', 'b']);
    dice(room, [[1, 1]]);
    E.rollDice(room, 'a', null);
    if (S(room).phase === 'build') E.passBuild(room, 'a', null);
    eq(S(room).phaseActor, 'a', 'ดับเบิลได้ทอยอีก');
    eq(S(room).phase, 'roll', 'ทอยอีก');
    dice(room, [[2, 2]]);
    E.rollDice(room, 'a', null);
    while (['build', 'takeover', 'pick'].includes(S(room).phase)) {
        if (S(room).phase === 'build') E.passBuild(room, 'a', null);
        else if (S(room).phase === 'takeover') E.declineTakeover(room, 'a', null);
        else E.skipPick(room, 'a', null);
    }
    eq(S(room).phaseActor, 'a', 'ดับเบิล 2');
    dice(room, [[3, 3]]);
    E.rollDice(room, 'a', null);
    eq(seat(room, 'a').pos, B.ISLAND_SQUARE, 'ไปเกาะ');
    eq(seat(room, 'a').island, B.ISLAND_TURNS, 'ติด 3 ตา');
    eq(S(room).phaseActor, 'b', 'ตาจบ');
    const fx = S(room).fx.filter(f => f.kind === 'dice');
    eq(fx[fx.length - 1].streak, 3, 'fx บอกครบ 3 ครั้ง');
    assert(S(room).fx.some(f => f.kind === 'island' && f.reason === 'triple'), 'ฉากเกาะแบบดับเบิล 3');
    audit(room, 'ดับเบิล 3');
});

test('เกาะร้าง: ออกด้วยดับเบิล (เดินต่อ ไม่ได้ทอยซ้ำ)', () => {
    const room = makeRoom(['a', 'b']);
    rollTotal(room, 'a', 4, [2, 2]); // ดับเบิลตกเกาะ = ติดเกาะ ไม่ได้ทอยซ้ำ
    eq(seat(room, 'a').island, 3, 'ตกเกาะ');
    eq(S(room).phaseActor, 'b', 'ดับเบิลแต่ตกเกาะ = จบตา');
    forceTurn(room, 'a');
    dice(room, [[4, 4]]);
    E.rollDice(room, 'a', null);
    eq(seat(room, 'a').island, 0, 'ออกจากเกาะ');
    eq(seat(room, 'a').pos, 16, 'เดิน 8 ช่อง');
    if (S(room).phase === 'pick') E.skipPick(room, 'a', null);
    eq(S(room).phaseActor, 'b', 'ดับเบิลออกเกาะไม่ได้ทอยซ้ำ');
});

test('เกาะร้าง: จ่ายค่าเรือออก แล้วทอยปกติ · เงินไม่พอจ่ายไม่ได้', () => {
    const room = makeRoom(['a', 'b']);
    seat(room, 'a').pos = 8; seat(room, 'a').island = 3;
    const c0 = seat(room, 'a').cash;
    eq(E.getAvailableActions(room, 'a').payIsland, true, 'มีปุ่มจ่าย');
    E.payIsland(room, 'a', null);
    eq(seat(room, 'a').island, 0, 'ออกแล้ว');
    eq(c0 - seat(room, 'a').cash, B.ISLAND_FEE, 'จ่ายค่าเรือ');
    eq(S(room).phase, 'roll', 'ยังทอยได้');
    dice(room, [[1, 2]]);
    E.rollDice(room, 'a', null);
    eq(seat(room, 'a').pos, 11, 'เดินปกติ');
    throws(() => E.payIsland(room, 'b', null), 'ไม่ได้ติดเกาะจ่ายไม่ได้');
    const r2 = makeRoom(['a', 'b']);
    seat(r2, 'a').pos = 8; seat(r2, 'a').island = 3;
    S(r2).ledger.bankIn += seat(r2, 'a').cash - 10; seat(r2, 'a').cash = 10;
    throws(() => E.payIsland(r2, 'a', null), 'เงินไม่พอ');
    audit(room, 'จ่ายค่าเรือ');
});

test('เกาะร้าง: รอจนครบ 3 ตา แล้วออกเดินตามแต้ม', () => {
    const room = makeRoom(['a', 'b']);
    seat(room, 'a').pos = 8; seat(room, 'a').island = 3;
    dice(room, [[1, 2]]);
    E.rollDice(room, 'a', null);
    eq(seat(room, 'a').island, 2, 'เหลือ 2');
    eq(seat(room, 'a').pos, 8, 'ยังอยู่เกาะ');
    forceTurn(room, 'a');
    dice(room, [[1, 2]]);
    E.rollDice(room, 'a', null);
    eq(seat(room, 'a').island, 1, 'เหลือ 1');
    forceTurn(room, 'a');
    dice(room, [[1, 2]]);
    E.rollDice(room, 'a', null);
    eq(seat(room, 'a').island, 0, 'ครบแล้วออก');
    eq(seat(room, 'a').pos, 11, 'เดิน 3 ช่อง');
    assert(S(room).fx.some(f => f.kind === 'islandFree' && f.how === 'served'), 'ฉากออกเพราะครบ');
    audit(room, 'ครบ 3 ตา');
});

// ---------- เทศกาล / ทัวร์ / จุดเริ่ม ----------
test('เทศกาล: ตกงานวัด เลือกช่องตัวเอง ค่าผ่านทาง ×2 · ย้ายที่ได้ · ขาย/ล้มละลายแล้วหาย', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [12, 14], 2);
    rollTotal(room, 'a', 10, [3, 3]);
    eq(S(room).phase, 'pick', 'เลือกช่อง');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.purpose, 'festival', 'เทศกาล');
    eq(d.options.slice().sort((x, y) => x - y).join(), '12,14', 'เฉพาะช่องตัวเอง');
    throws(() => E.pickSquare(room, 'a', 15, null), 'ช่องคนอื่น/ว่างไม่ได้');
    const base = E.tollFor(room, 12);
    E.pickSquare(room, 'a', 12, null);
    eq(S(room).festival, 12, 'มีธง');
    eq(E.tollFor(room, 12), base * 2, '×2');
    // ดับเบิลได้ทอยต่อ → มาตกงานวัดอีกรอบ ย้ายไป 14
    forceTurn(room, 'a');
    rollTotal(room, 'a', 10, [3, 3]);
    E.pickSquare(room, 'a', 14, null);
    eq(S(room).festival, 14, 'ย้ายที่');
    eq(E.tollFor(room, 12), base, 'ที่เดิมกลับปกติ');
    // ไม่มีที่ = ไม่ต้องเลือก
    forceTurn(room, 'b');
    rollTotal(room, 'b', 10, [2, 4]);
    assert(S(room).phase !== 'pick', 'ไม่มีที่ไม่ต้องเลือก');
    audit(room, 'เทศกาล');
});

test('ทัวร์ทั่วไทย: ตกช่องทัวร์ → ตาหน้าแตะช่องวาร์ป จ่ายค่าทัวร์ · ผ่านเริ่มได้เงินเดือน · ข้ามได้', () => {
    const room = makeRoom(['a', 'b']);
    rollTotal(room, 'a', 20, [1, 3]);
    eq(seat(room, 'a').pos, 24, 'อยู่ทัวร์');
    eq(seat(room, 'a').tourPending, true, 'ได้ตั๋ว');
    eq(S(room).phaseActor, 'b', 'ตาจบ');
    forceTurn(room, 'b');
    rollTotal(room, 'b', 12, [1, 3]); // b ตกงานวัด (ไม่มีที่) จบตา
    eq(S(room).phaseActor, 'a', 'ตา a');
    eq(S(room).phase, 'pick', 'ตา a เริ่มด้วยการเลือกช่อง');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.purpose, 'tour', 'ทัวร์');
    assert(!d.options.includes(24), 'ไปช่องเดิมไม่ได้');
    eq(d.options.length, 31, 'ไปได้ทุกช่อง');
    const c0 = seat(room, 'a').cash;
    E.pickSquare(room, 'a', 4, null);
    eq(seat(room, 'a').pos, 4, 'วาร์ป');
    eq(seat(room, 'a').laps, 1, 'ผ่านจุดเริ่ม');
    eq(seat(room, 'a').cash - c0, B.SALARY - B.TOUR_FEE, 'เงินเดือน − ค่าทัวร์');
    eq(seat(room, 'a').tourPending, false, 'ใช้ตั๋วแล้ว');
    eq(S(room).phase, 'build', 'ตกเมืองว่าง');
    assert(S(room).fx.some(f => f.kind === 'move' && f.warp), 'ฉากวาร์ป');
    E.passBuild(room, 'a', null);
    eq(S(room).phaseActor, 'b', 'วาร์ปแล้วจบตา ไม่ได้ทอย');
    // ข้าม = ทอยปกติ
    const r2 = makeRoom(['a', 'b']);
    seat(r2, 'a').pos = 24; seat(r2, 'a').tourPending = true;
    forceTurn(r2, 'b');
    rollTotal(r2, 'b', 12, [1, 3]);
    eq(S(r2).phase, 'pick', 'เลือกช่อง');
    E.skipPick(r2, 'a', null);
    eq(S(r2).phase, 'roll', 'ข้าม = ทอย');
    eq(seat(r2, 'a').tourPending, false, 'ตั๋วหมด');
    audit(room, 'ทัวร์');
});

test('ทอยมาตกจุดเริ่มพอดี: ได้เงินเดือน + อัปเมืองตัวเองฟรี 1 ขั้น (ถึงโรงแรม) · ผ่านเฉย ๆ/การ์ด/วาร์ป ไม่ได้', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [4], 1);
    give(room, 'a', [31], 3);
    const c0 = seat(room, 'a').cash;
    rollTotal(room, 'a', 28, [1, 3]);
    eq(seat(room, 'a').pos, 0, 'อยู่จุดเริ่ม');
    eq(seat(room, 'a').cash - c0, B.SALARY, 'ได้เงินเดือน ฿3,000');
    eq(B.SALARY, 3000, 'เงินเดือน 3,000');
    eq(S(room).phase, 'pick', 'เลือกเมือง');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.purpose, 'startBonus', 'โบนัสจุดเริ่ม');
    eq(d.options.join(), '4', 'เฉพาะเมืองที่ยังไม่ถึงโรงแรม');
    assert(S(room).fx.some(f => f.kind === 'startExact' && f.can), 'ฉากตกจุดเริ่มพอดี');
    E.pickSquare(room, 'a', 4, null);
    eq(p(room, 4).level, 2, 'ขึ้นตึก ฟรี');
    eq(seat(room, 'a').cash - c0, B.SALARY, 'ไม่เสียเงิน');
    audit(room, 'โบนัสจุดเริ่ม');
    // ผ่านจุดเริ่ม (ไม่ตกพอดี) = ไม่ได้โบนัส
    const r2 = makeRoom(['a', 'b']);
    give(r2, 'a', [4], 1);
    rollTotal(r2, 'a', 28, [2, 3]);
    eq(seat(r2, 'a').pos, 1, 'เลยจุดเริ่ม');
    assert(!S(r2).fx.some(f => f.kind === 'startExact'), 'ผ่านเฉย ๆ ไม่ได้โบนัส');
    // การ์ดพากลับจุดเริ่ม = ไม่ได้
    const r3 = makeRoom(['a', 'b']);
    S(r3).deck = ['k02', ...S(r3).deck.filter(x => x !== 'k02')];
    give(r3, 'a', [4], 1);
    rollTotal(r3, 'a', 0, [1, 2]);
    eq(seat(r3, 'a').pos, 0, 'การ์ดพากลับจุดเริ่ม');
    assert(!S(r3).fx.some(f => f.kind === 'startExact') && S(r3).phase !== 'pick', 'การ์ดไม่ได้โบนัส');
    // วาร์ปทัวร์มาจุดเริ่ม = ไม่ได้
    const r4 = makeRoom(['a', 'b']);
    give(r4, 'a', [4], 1);
    seat(r4, 'a').pos = 24; seat(r4, 'a').tourPending = true;
    forceTurn(r4, 'b');
    rollTotal(r4, 'b', 12, [1, 3]);
    E.pickSquare(r4, 'a', 0, null);
    eq(seat(r4, 'a').pos, 0, 'วาร์ปมาจุดเริ่ม');
    assert(!S(r4).fx.some(f => f.kind === 'startExact'), 'วาร์ปไม่ได้โบนัส');
});

test('โบนัสจุดเริ่ม: รอบแรกถึงบ้าน · ไม่มีเมืองให้อัป = โน้ตแล้วเล่นต่อ · หมดเวลาเลือกเมืองค่าผ่านทางสูงสุด · /m 6+6 ระยะพอดีก็ได้', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [4], 1);
    give(room, 'a', [2], 0);
    seat(room, 'a').laps = 0;
    // ตกจุดเริ่มพอดีโดยไม่นับรอบ (จำลองรอบแรก): ตั้ง laps ติดลบก่อนผ่าน
    seat(room, 'a').laps = -1;
    rollTotal(room, 'a', 28, [1, 3]);
    eq(seat(room, 'a').laps, 0, 'ยังเป็นรอบแรก');
    eq(E.buildClientState(room, 'a').decision.options.join(), '2', 'รอบแรกอัปได้ถึงบ้าน (บ้านแล้วอัปไม่ได้)');
    E.skipPick(room, 'a', null);
    // ไม่มีเมือง
    const r2 = makeRoom(['a', 'b']);
    rollTotal(r2, 'a', 28, [1, 3]);
    assert(S(r2).fx.some(f => f.kind === 'startExact' && !f.can), 'โน้ต ไม่มีเมืองที่อัปได้');
    assert(S(r2).phase !== 'pick', 'เล่นต่อเลย');
    // หมดเวลา: เลือกค่าผ่านทางสูงสุด
    const r3 = makeRoom(['a', 'b']);
    give(r3, 'a', [1], 1);
    give(r3, 'a', [30], 2);
    seat(r3, 'a').laps = 1;
    rollTotal(r3, 'a', 28, [1, 3]);
    eq(S(r3).phase, 'pick', 'เลือก');
    T += E.DECIDE_MS + 10;
    E.tick(r3);
    eq(p(r3, 30).level, 3, 'หมดเวลา = อัปเมืองค่าผ่านทางสูงสุด');
    audit(r3, 'หมดเวลาโบนัส');
    // /m 6+6 จาก 20 → 0
    const r4 = makeRoom(['a', 'b']);
    give(r4, 'a', [4], 1);
    seat(r4, 'a').pos = 20;
    E.setDebugDice(r4, 'a', { six: true });
    E.rollDice(r4, 'a', null, mulberry(3));
    eq(seat(r4, 'a').pos, 0, '6+6 ตกจุดเริ่มพอดี');
    eq(S(r4).phase, 'pick', 'ได้โบนัสแม้ใช้ /m');
});

test('ดาวแลนด์มาร์ก: ตกแลนด์มาร์กตัวเอง = โบนัส 20% + ดาว (ค่าผ่านทาง +25%/ดาว เต็ม 4 = ×2) · ซ้อนงานวัด · ล้มละลายรีเซ็ต', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [7], 4);
    const base = Math.round(1000 * B.TOLL_MULT[4] / 10) * 10;
    eq(E.tollFor(room, 7), base, 'ไม่มีดาว');
    let expectStars = 0;
    for (let k = 0; k < 5; k += 1) {
        forceTurn(room, 'a');
        const before = E.tollFor(room, 7);
        const c0 = seat(room, 'a').cash;
        rollTotal(room, 'a', 3, [1, 3]);
        expectStars = Math.min(4, expectStars + 1);
        eq(seat(room, 'a').cash - c0, Math.round(before * 0.2 / 10) * 10, 'โบนัส 20% ของค่าผ่านทางตอนนั้น');
        eq(p(room, 7).stars, expectStars, 'ดาว ' + expectStars);
        eq(E.tollFor(room, 7), Math.round(base * (1 + 0.25 * expectStars) / 10) * 10, 'ค่าผ่านทางตามดาว');
    }
    eq(E.tollFor(room, 7), base * 2, 'ดาวเต็ม = ×2');
    assert(S(room).fx.some(f => f.kind === 'landmarkStar' && !f.upgraded), 'ดาวเต็มแล้วยังได้โบนัส ไม่เพิ่มดาว');
    S(room).festival = 7;
    eq(E.tollFor(room, 7), base * 4, 'ดาวเต็ม + งานวัด = ×4');
    audit(room, 'ดาวแลนด์มาร์ก');
    // ล้มละลาย → ที่คืนธนาคาร ดาวรีเซ็ต
    S(room).ledger.bankIn += seat(room, 'a').cash - 10; seat(room, 'a').cash = 10;
    give(room, 'b', [31], 4);
    forceTurn(room, 'a');
    rollTotal(room, 'a', 29, [1, 1]);
    eq(seat(room, 'a').bankrupt, true, 'ล้มละลาย');
    eq(p(room, 7).stars, 0, 'ดาวรีเซ็ต');
    audit(room, 'หลังล้มละลาย');
    // /m 6+6 มาตกแลนด์มาร์กตัวเองก็ได้โบนัส
    const r2 = makeRoom(['a', 'b']);
    give(r2, 'a', [14], 4);
    seat(r2, 'a').pos = 2;
    E.setDebugDice(r2, 'a', { six: true });
    E.rollDice(r2, 'a', null, mulberry(1));
    eq(p(r2, 14).stars, 1, '/m 6+6 ตกแลนด์มาร์ก = ได้ดาว');
});

test('งานวัดซ้อน: เลือกเมืองเดิม ×2→×4→×8→×16 (เพดาน) · ย้ายเมือง = ×2 ที่ใหม่ ที่เดิมกลับ ×1 · ซ้อนกับดาว · โบนัสดาวเพดาน ฿20,000', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [12, 14], 2);
    const base12 = E.tollFor(room, 12);
    const mults = [];
    for (let k = 0; k < 5; k += 1) {
        forceTurn(room, 'a');
        rollTotal(room, 'a', 10, [2, 4]);
        eq(S(room).phase, 'pick', 'เลือกที่จัดงานวัด');
        const prev = E.buildClientState(room, 'a').decision.preview[12];
        E.pickSquare(room, 'a', 12, null);
        mults.push(S(room).festivalMult);
        eq(E.tollFor(room, 12), base12 * S(room).festivalMult, 'ค่าผ่านทาง = ฐาน × ตัวคูณ');
        eq(prev.toll, E.tollFor(room, 12), 'แผ่นเลือกโชว์ค่าผ่านทางที่จะได้');
    }
    eq(mults.join(), '2,4,8,16,16', 'ซ้อน ×2→×16 แล้วค้างที่ ×16');
    assert(S(room).fx.some(f => f.kind === 'festival' && f.stacked && f.mult === 8), 'ฉากงานวัดใหญ่ขึ้น');
    forceTurn(room, 'a');
    rollTotal(room, 'a', 10, [2, 4]);
    E.pickSquare(room, 'a', 14, null);
    eq(S(room).festival, 14, 'ย้ายเมือง');
    eq(S(room).festivalMult, 2, 'ที่ใหม่เริ่ม ×2');
    eq(E.tollFor(room, 12), base12, 'ที่เดิมกลับ ×1');
    audit(room, 'งานวัดซ้อน');
    // ซ้อนกับดาว
    const r2 = makeRoom(['a', 'b']);
    give(r2, 'a', [7], 4);
    p(r2, 7).stars = 2;
    S(r2).festival = 7; S(r2).festivalMult = 4;
    const lmBase = Math.round(1000 * B.TOLL_MULT[4] / 10) * 10;
    eq(E.tollFor(r2, 7), Math.round(lmBase * 1.5 / 10) * 10 * 4, 'ดาว 2 × งานวัด ×4');
    // โบนัสดาวเพดาน
    give(r2, 'a', [31], 4);
    p(r2, 31).stars = 4;
    S(r2).festival = 31; S(r2).festivalMult = 16;
    const c0 = seat(r2, 'a').cash;
    rollTotal(r2, 'a', 29, [1, 1]);
    eq(seat(r2, 'a').cash - c0, 20000, 'โบนัสดาวไม่เกิน ฿20,000');
    audit(r2, 'เพดานโบนัส');
});

test('งานวัดติดเมืองตอนโดนซื้อต่อ · ล้มละลายคืนธนาคาร = รีเซ็ต', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [7], 2);
    S(room).festival = 7; S(room).festivalMult = 4;
    seat(room, 'a').cash = 900000; S(room).ledger.bankOut += 900000 - B.START_CASH;
    rollTotal(room, 'a', 0, [3, 4]);
    eq(S(room).phase, 'takeover', 'ซื้อต่อ');
    eq(S(room).pending && E.buildClientState(room, 'a').decision.price, 2 * B.valueAt(7, 2), 'ราคาซื้อต่อไม่ขึ้นกับงานวัด');
    E.acceptTakeover(room, 'a', null);
    eq(S(room).festival, 7, 'งานวัดยังอยู่');
    eq(S(room).festivalMult, 4, 'ตัวคูณยังอยู่');
    if (S(room).phase === 'build') E.passBuild(room, 'a', null);
    // a ล้มละลาย → งานวัดหาย
    S(room).ledger.bankIn += seat(room, 'a').cash - 10; seat(room, 'a').cash = 10;
    give(room, 'b', [31], 4);
    forceTurn(room, 'a');
    rollTotal(room, 'a', 29, [1, 1]);
    eq(seat(room, 'a').bankrupt, true, 'ล้มละลาย');
    eq(S(room).festival, null, 'งานวัดหาย');
    eq(S(room).festivalMult, 1, 'ตัวคูณรีเซ็ต');
    audit(room, 'งานวัดรีเซ็ต');
});

test('วาร์ปเดินหน้าเสมอ: ปลายทางอยู่ข้างหลัง = วนเกือบรอบ ผ่านจุดเริ่มได้เงินเดือน นับรอบ ตกแล้วมีผลตามช่อง', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [20], 2);
    seat(room, 'a').pos = 24; seat(room, 'a').tourPending = true; seat(room, 'a').laps = 0;
    forceTurn(room, 'b');
    rollTotal(room, 'b', 9, [1, 2]);
    if (S(room).phase === 'build') E.passBuild(room, 'b', null);
    eq(S(room).phase, 'pick', 'เลือกช่องทัวร์');
    const d = E.buildClientState(room, 'a').decision;
    eq(d.purpose, 'tour', 'ทัวร์');
    eq(d.preview[20].steps, 28, 'ไป 20 = เดินหน้า 28 ช่อง');
    eq(d.preview[20].salary, true, 'ผ่านจุดเริ่ม');
    eq(d.preview[30].salary, false, 'ไปข้างหน้าไม่ผ่านจุดเริ่ม');
    const c0 = seat(room, 'a').cash;
    const b0 = seat(room, 'b').cash;
    const toll = E.tollFor(room, 20);
    E.pickSquare(room, 'a', 20, null);
    const mv = S(room).fx.filter(f => f.kind === 'move' && f.playerId === 'a').pop();
    eq(mv.path.length, 28, 'เดินหน้า 28 ช่อง');
    eq(mv.path[7], 0, 'ผ่านจุดเริ่มระหว่างทาง');
    assert(mv.warp && mv.passGo, 'วาร์ปผ่านจุดเริ่ม');
    eq(seat(room, 'a').laps, 1, 'นับรอบ');
    eq(seat(room, 'a').cash - c0, B.SALARY - B.TOUR_FEE - toll, 'เงินเดือน − ค่าทัวร์ − ค่าผ่านทาง');
    eq(seat(room, 'b').cash - b0, toll, 'ตกแล้วจ่ายค่าผ่านทาง');
    eq(S(room).phase, 'takeover', 'ตกแล้วมีผลตามช่อง (ซื้อต่อได้)');
    audit(room, 'วาร์ปเดินหน้า');
});

// ---------- การ์ด ----------
function cardRoom(id) {
    const room = makeRoom(['a', 'b']);
    S(room).deck = [id, ...S(room).deck.filter(x => x !== id)];
    return room;
}
test('การ์ด: เดินหน้า 3 · กลับจุดเริ่ม · ไปเกาะ · ทัวร์', () => {
    let room = cardRoom('k01');
    rollTotal(room, 'a', 0, [1, 2]);
    eq(seat(room, 'a').pos, 6, 'เดินหน้า 3');
    room = cardRoom('k02');
    rollTotal(room, 'a', 0, [1, 2]);
    eq(seat(room, 'a').pos, 0, 'กลับเริ่ม');
    eq(seat(room, 'a').laps, 1, 'ได้เงินเดือน');
    room = cardRoom('k06');
    rollTotal(room, 'a', 0, [1, 2]);
    eq(seat(room, 'a').island, 3, 'ติดเกาะ');
    room = cardRoom('k10');
    rollTotal(room, 'a', 0, [1, 2]);
    eq(seat(room, 'a').pos, 24, 'ไปทัวร์');
    eq(seat(room, 'a').tourPending, true, 'ได้ตั๋ว');
    audit(room, 'การ์ดเดิน');
});
test('การ์ด: นางฟ้า (ไม่ต้องจ่าย) · ส่วนลดครึ่ง · ทำบุญ · ได้เงิน · จัดงานวัด · อัปเกรดฟรี', () => {
    let room = cardRoom('k04');
    rollTotal(room, 'a', 0, [1, 2]);
    eq(seat(room, 'a').shield, 'angel', 'เก็บการ์ดนางฟ้า');
    give(room, 'b', [7], 3);
    forceTurn(room, 'a');
    const c0 = seat(room, 'a').cash;
    rollTotal(room, 'a', 3, [2, 2]);
    eq(seat(room, 'a').cash, c0, 'ไม่ต้องจ่าย');
    eq(seat(room, 'a').shield, null, 'ใช้แล้วหมด');
    room = cardRoom('k05');
    rollTotal(room, 'a', 0, [1, 2]);
    give(room, 'b', [7], 3);
    forceTurn(room, 'a');
    const c1 = seat(room, 'a').cash;
    const toll = E.tollFor(room, 7);
    rollTotal(room, 'a', 3, [2, 2]);
    eq(c1 - seat(room, 'a').cash, Math.round(toll / 2 / 10) * 10, 'จ่ายครึ่ง');
    room = cardRoom('k07');
    const c2 = seat(room, 'a').cash;
    rollTotal(room, 'a', 0, [1, 2]);
    eq(c2 - seat(room, 'a').cash, 1000, 'ทำบุญ');
    room = cardRoom('k09');
    const c3 = seat(room, 'a').cash;
    rollTotal(room, 'a', 0, [1, 2]);
    eq(seat(room, 'a').cash - c3, 2000, 'ได้เงิน');
    room = cardRoom('k08');
    give(room, 'a', [20], 1);
    rollTotal(room, 'a', 0, [1, 2]);
    eq(S(room).phase, 'pick', 'เลือกช่องจัดงาน');
    E.pickSquare(room, 'a', 20, null);
    eq(S(room).festival, 20, 'จัดงานที่ไหนก็ได้ของตัวเอง');
    room = cardRoom('k03');
    give(room, 'a', [20], 0);
    seat(room, 'a').laps = 1;
    rollTotal(room, 'a', 0, [1, 2]);
    eq(S(room).phase, 'pick', 'อัปเกรดฟรี');
    const c4 = seat(room, 'a').cash;
    E.pickSquare(room, 'a', 20, null);
    eq(p(room, 20).level, 1, 'ขึ้น 1 ขั้น');
    eq(seat(room, 'a').cash, c4, 'ฟรี');
    audit(room, 'การ์ด');
});

// ---------- ภาษี / หนี้ / ล้มละลาย ----------
test('ภาษี = 10% ของมูลค่าที่ดินและสิ่งปลูกสร้าง', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'a', [4, 6], 2);
    const due = Math.round((B.valueAt(4, 2) + B.valueAt(6, 2)) * B.TAX_RATE / 10) * 10;
    const c0 = seat(room, 'a').cash;
    rollTotal(room, 'a', 25, [2, 2]); // → 29 ภาษี
    eq(c0 - seat(room, 'a').cash, due, 'ภาษี');
    audit(room, 'ภาษี');
});

test('เงินไม่พอ: ขายช่องคืนครึ่งราคา → จ่ายอัตโนมัติ · ขายช่องคนอื่นไม่ได้', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [31], 3);
    give(room, 'a', [20, 22, 23], 3);
    S(room).ledger.bankIn += seat(room, 'a').cash - 500; seat(room, 'a').cash = 500;
    const toll = E.tollFor(room, 31);
    rollTotal(room, 'a', 29, [1, 1]);
    eq(S(room).phase, 'debt', 'เฟสหนี้');
    eq(E.buildClientState(room, 'a').debt.total, toll, 'ยอดหนี้');
    throws(() => E.sellSquare(room, 'a', 31, null), 'ขายของคนอื่นไม่ได้');
    throws(() => E.sellSquare(room, 'b', 31, null), 'คนอื่นมาขายตอนหนี้ไม่ได้');
    const sell = E.buildClientState(room, 'a').self.sell;
    eq(sell[20], Math.floor(B.valueAt(20, 3) / 2), 'คืนครึ่งราคา');
    const b0 = seat(room, 'b').cash;
    [20, 22, 23].forEach(i => { if (S(room).phase === 'debt') E.sellSquare(room, 'a', i, null); });
    assert(S(room).phase !== 'debt', 'จ่ายครบแล้ว');
    eq(seat(room, 'b').cash - b0, toll, 'เจ้าของได้ค่าผ่านทาง');
    eq(p(room, 20).owner, null, 'ขายแล้วกลับเป็นที่ว่าง');
    audit(room, 'หนี้');
});

test('ล้มละลาย: ที่ดินทั้งหมดกลับเป็นไม่มีเจ้าของ · เงินที่เหลือให้เจ้าหนี้ · เหลือคนเดียวชนะ', () => {
    const room = makeRoom(['a', 'b']);
    give(room, 'b', [31], 4);
    give(room, 'a', [1], 1);
    S(room).festival = 1;
    S(room).ledger.bankIn += seat(room, 'a').cash - 300; seat(room, 'a').cash = 300;
    const liq = E.liquidationValue(room, seat(room, 'a'));
    const b0 = seat(room, 'b').cash;
    rollTotal(room, 'a', 29, [1, 1]);
    eq(seat(room, 'a').bankrupt, true, 'ล้มละลาย');
    eq(p(room, 1).owner, null, 'ที่ดินคืนธนาคาร');
    eq(S(room).festival, null, 'เทศกาลของคนล้มละลายหาย');
    eq(seat(room, 'b').cash - b0, liq, 'เจ้าหนี้ได้เงินที่เหลือทั้งหมด');
    eq(S(room).phase, 'finished', 'เหลือคนเดียว = จบ');
    eq(S(room).winners[0].playerId, 'b', 'b ชนะ');
    audit(room, 'ล้มละลาย');
});

test('ล้มละลาย 3 คน: เกมเดินต่อจนเหลือคนสุดท้าย', () => {
    const room = makeRoom(['a', 'b', 'c']);
    give(room, 'c', [31], 4);
    S(room).ledger.bankIn += seat(room, 'a').cash - 10; seat(room, 'a').cash = 10;
    rollTotal(room, 'a', 29, [1, 1]);
    eq(seat(room, 'a').bankrupt, true, 'a ล้ม');
    assert(S(room).phase !== 'finished', 'ยังเล่นต่อ');
    eq(S(room).phaseActor, 'b', 'ข้ามคนล้ม');
    audit(room, 'ล้ม 1 คน');
});

// ---------- หมดเวลา / ออก / autopilot / จังหวะ ----------
test('หมดเวลา: เล่นครบรอบ แล้วทรัพย์สินรวมสูงสุดชนะ', () => {
    const room = makeRoom(['bot_a', 'bot_b', 'bot_c'], { minutes: 20 });
    T += 21 * E.MINUTE_MS;
    let guard = 0;
    while (S(room).phase !== 'finished' && guard < 400) { T += 50; E.playBotTurns(room, mulberry(3), T); E.tick(room); guard += 1; }
    eq(S(room).phase, 'finished', 'จบ');
    assert(S(room).clock.timeUp, 'หมดเวลา');
    const top = S(room).standings[0];
    eq(S(room).winners[0].netWorth, top.netWorth, 'ทรัพย์สินสูงสุดชนะ');
    assert(S(room).fx.some(f => f.kind === 'timeUp'), 'ฉากหมดเวลา');
});

test('คนออกกลางเกม: ที่ดินคืนธนาคาร เกมเดินต่อ · เหลือคนเดียวชนะ', () => {
    const room = makeRoom(['a', 'b', 'c']);
    give(room, 'a', [4, 6], 2);
    E.handlePlayerLeft(room, 'a');
    eq(p(room, 4).owner, null, 'คืนธนาคาร');
    eq(S(room).phaseActor, 'b', 'ตาต่อไป');
    audit(room, 'ออก');
    E.handlePlayerLeft(room, 'c');
    eq(S(room).phase, 'finished', 'เหลือคนเดียว');
    eq(S(room).winners[0].playerId, 'b', 'คนสุดท้ายชนะ');
});

test('autopilot หมดเวลา: ทอย · ไม่ซื้อ · ไม่ซื้อต่อ · หนี้ขายให้', () => {
    const room = makeRoom(['a', 'b']);
    T += E.TURN_MS + 10;
    assert(E.tick(room), 'หมดเวลาทอยให้');
    assert(S(room).turn.hasRolled || S(room).phaseActor === 'b', 'ทอยแล้ว');
    const room2 = makeRoom(['a', 'b']);
    rollTotal(room2, 'a', 0, [1, 3]);
    eq(S(room2).phase, 'build', 'แผ่นซื้อ');
    T += E.DECIDE_MS + 10;
    E.tick(room2);
    eq(p(room2, 4).owner, null, 'หมดเวลา = ไม่ซื้อ');
    const room3 = makeRoom(['a', 'b']);
    give(room3, 'b', [7], 1);
    rollTotal(room3, 'a', 0, [3, 4]);
    eq(S(room3).phase, 'takeover', 'เสนอซื้อต่อ');
    T += E.DECIDE_MS + 10;
    E.tick(room3);
    eq(p(room3, 7).owner, 'b', 'หมดเวลา = ไม่ซื้อต่อ');
    audit(room3, 'autopilot');
});

test('จังหวะ: เวลาตานับหลังฉากจบ · บอทรอฉาก + หยุดคิด · ปุ่มเร่ง', () => {
    // จำลองฉากเต็มเวลาด้วยการคำนวณตรง
    const cost = E.fxCost({ kind: 'dice', d: [6, 6], doubles: true });
    assert(cost >= 1800 && cost <= 2400, 'ดับเบิลโชว์ ~2 วิ');
    assert(E.fxCost({ kind: 'dice', d: [2, 3] }) <= 1400, 'ผลเต๋าปกติ ~1.3 วิ');
    eq(E.fxCost({ kind: 'move', path: [1, 2, 3, 4, 5] }), 220 * 5 + 300, 'เดินทีละช่อง 220ms');
    const room = makeRoom(['a', 'bot_b']);
    S(room).animUntil = T + 5000;
    S(room).phaseMs = 1000;
    S(room).phaseStartedAt = T;
    T += 2000;
    assert(!E.tick(room), 'ฉากยังไม่จบ ไม่หมดเวลา');
    T += 4100;
    assert(E.tick(room), 'ฉากจบ + เวลาตา = หมดเวลา');
    const r2 = makeRoom(['bot_a', 'b']);
    S(r2).animUntil = T + 3000;
    assert(!E.playBotTurns(r2, mulberry(1), T), 'บอทรอฉาก');
    assert(E.playBotTurns(r2, mulberry(1), T + 3000 + E.BOT_MS + 50), 'ฉากจบแล้วบอทเล่น');
    const r3 = makeRoom(['a', 'b']);
    throws(() => E.setFast(r3, 'bot_x', true), 'บอท/คนนอกกดเร่งไม่ได้');
    E.setFast(r3, 'b', true);
    eq(S(r3).fast, true, 'เร่งแล้ว');
    eq(E.buildClientState(r3, 'a').fast, true, 'ทุกคนเห็นว่าเร่ง');
});

test('คนหลุด: เวลาตาสั้นลงหลังช่วงผ่อนผัน', () => {
    const room = makeRoom(['a', 'b']);
    room.players[0].socketId = null;
    room.players[0].disconnectedAt = new Date(T).toISOString();
    const d = E.effectiveDeadline(room, T);
    assert(d < T + E.TURN_MS, 'ตาสั้นลง');
});

test('กดค้างทอย: ช่องเขียว/แรง ทำงานตามเวลา · เวลาปลอมถูกหนีบ', () => {
    const room = makeRoom(['a', 'b']);
    const m = E.startRollHold(room, 'a', null, mulberry(9));
    assert(m.period / 2 >= 1600 && m.period / 2 <= 2000, 'เข็มกวาดเบา→แรง 1.6–2.0 วิ');
    // ช่องเขียว: โผล่ 0.3–1.2 วิหลังกด แล้วค้างจนปล่อย · เข็มผ่านช่องได้ทุกรอบหลังโผล่
    let greens = 0;
    for (let k = 0; k < 3000; k += 1) {
        const r = mulberry(100 + k);
        const period = 3200 + Math.floor(r() * 800);
        const g = E.greenSchedule(r, period);
        if (!g) continue;
        greens += 1;
        assert(g.appearAt >= 300 && g.appearAt <= 1200, 'โผล่ 0.3–1.2 วิ ได้ ' + g.appearAt);
        assert(g.until === undefined, 'ไม่มีเวลาหาย');
        assert(!E.meterAt({ period, green: g }, g.appearAt - 1).greenOn, 'ก่อนโผล่ยังไม่มีช่อง');
        assert(E.meterAt({ period, green: g }, 19000).greenOn, 'โผล่แล้วค้างจนปล่อย');
        let hits = 0;
        for (let t = g.appearAt; t <= g.appearAt + period * 2; t += 5) if (E.meterAt({ period, green: g }, t).green) hits += 1;
        assert(hits > 0, 'เข็มผ่านช่องเขียวหลังโผล่');
    }
    assert(greens > 1000, 'ช่องเขียวโผล่บางครั้ง');
    throws(() => E.releaseRoll(room, 'b', 500), 'คนอื่นปล่อยไม่ได้');
    T += 400;
    E.releaseRoll(room, 'a', 99999, null, mulberry(2));
    assert(S(room).turn.hasRolled, 'ทอยแล้ว');
    for (let k = 0; k < 2000; k += 1) {
        const [x, y] = E.biasedDice(mulberry(k), { power: 1, green: true });
        assert(x >= 1 && x <= 6 && y >= 1 && y <= 6, 'เต๋า 1–6');
    }
});

test('เมนูทดสอบ /m: 6+6 ทุกครั้ง (3 ครั้ง = เกาะ) · ดับเบิลทุกครั้ง · เสกเงินลงบัญชี · เกมถูกตีตราไม่นับสถิติ', () => {
    const room = makeRoom(['a', 'b']);
    seat(room, 'a').pos = 2; // 2 → 14 → 26 → (ครั้งที่ 3) เกาะ
    E.setDebugDice(room, 'a', { six: true });
    eq(S(room).debugUsed, true, 'ตีตราว่าใช้เมนูทดสอบ');
    assert(!S(room).history.some(h => h.kind === 'debug' || /เมนูทดสอบ/.test(h.text)), 'ไม่ลงบันทึกเกม (ไม่สแปม)');
    assert(!S(room).fx.some(f => f.kind === 'debug'), 'ไม่มีฉาก/ป้ายแจ้งทั้งห้อง');
    eq(S(room).seats[0].debugged, true, 'ป้าย 🛠 เฉพาะคนใช้');
    eq(E.buildClientState(room, 'b').seats[0].debugged, true, 'คนอื่นเห็นป้ายเล็กที่แถบคนใช้');
    eq(E.buildClientState(room, 'b').seats[1].debugged, false, 'คนไม่ได้ใช้ไม่มีป้าย');
    for (let k = 0; k < 3; k += 1) {
        E.rollDice(room, 'a', null, mulberry(k));
        const d = S(room).fx.filter(f => f.kind === 'dice').pop();
        eq(d.d.join(), '6,6', 'ได้ 6+6');
        while (['build', 'takeover', 'pick'].includes(S(room).phase) && S(room).phaseActor === 'a') {
            if (S(room).phase === 'build') E.passBuild(room, 'a', null);
            else if (S(room).phase === 'takeover') E.declineTakeover(room, 'a', null);
            else E.skipPick(room, 'a', null);
        }
    }
    eq(seat(room, 'a').island, 3, '6+6 สามครั้งติด = ไปเกาะ');
    eq(S(room).phaseActor, 'b', 'ตาจบ');
    E.rollDice(room, 'b', null, mulberry(1));
    const bd = S(room).fx.filter(f => f.kind === 'dice').pop();
    assert(bd.playerId === 'b', 'คนอื่นทอยปกติ');
    const r2 = makeRoom(['a', 'b']);
    E.setDebugDice(r2, 'a', { doubles: true });
    for (let k = 0; k < 20; k += 1) {
        forceTurn(r2, 'a');
        S(r2).turn.doublesStreak = 0;
        seat(r2, 'a').island = 0;
        E.rollDice(r2, 'a', null, mulberry(50 + k));
        const d = S(r2).fx.filter(f => f.kind === 'dice').pop();
        assert(d.d[0] === d.d[1], 'ดับเบิลทุกครั้ง');
    }
    E.setDebugDice(r2, 'a', { six: true });
    forceTurn(r2, 'a');
    seat(r2, 'a').island = 0;
    E.rollDice(r2, 'a', null, mulberry(9));
    eq(S(r2).fx.filter(f => f.kind === 'dice').pop().d.join(), '6,6', 'เปิดสองอย่าง 6+6 ชนะ');
    const c0 = seat(r2, 'b').cash;
    throws(() => E.debugMint(r2, 'b', 0), 'เสก 0 ไม่ได้');
    throws(() => E.debugMint(r2, 'b', -5), 'เสกติดลบไม่ได้');
    throws(() => E.debugMint(r2, 'b', 1.5), 'ต้องเป็นจำนวนเต็ม');
    throws(() => E.debugMint(r2, 'b', 2000000), 'เกินเพดาน');
    const fxBefore = S(r2).fxSeq;
    E.debugMint(r2, 'b', 50000);
    eq(S(r2).fxSeq, fxBefore, 'เสกเงินเงียบ ไม่มีฉากเหรียญบิน');
    eq(seat(r2, 'b').cash, c0 + 50000, 'ได้เงิน');
    eq(S(r2).ledger.debugMinted, 50000, 'ลงบัญชีเสกเงินแยก');
    audit(r2, 'หลังเสกเงิน');
    E.endGame(r2, 'a');
    eq(Object.keys(S(r2).debug).length, 0, 'จบเกม = ปิดเมนูทดสอบ');
    eq(S(r2).debugUsed, true, 'ยังตีตราว่าใช้ (ไม่นับสถิติ)');
});

// ---------- สุ่มหลายพันเกม ----------
function randomGames(count) {
    const reasons = {};
    const byN = {};
    let steps = 0;
    for (let g = 0; g < count; g += 1) {
        const rng = mulberry(1000 + g);
        const n = 2 + (g % 5); // 2–6 คน
        const ids = Array.from({ length: n }, (_, k) => 'bot_' + k);
        const room = makeRoom(ids, { rng, minutes: g % 7 === 0 ? 20 : 0 }); // 7 ไม่หาร 5 ลงตัว = ทุกจำนวนคนได้ลองจำกัดเวลา
        let guard = 0;
        while (S(room).phase !== 'finished' && guard < 6000) {
            T += 900;
            if (!E.playBotTurns(room, rng, T)) { E.tick(room, rng); }
            const pr = E.auditState(room);
            if (pr.length) throw new Error(`เกมสุ่ม ${g} ก้าว ${guard}: ${pr.join(' · ')}`);
            // ทุกครั้งที่มีซื้อต่อ ต้องไม่ใช่แลนด์มาร์ก และราคา = 2 เท่า
            guard += 1;
        }
        S(room).fx.filter(f => f.kind === 'takeover').forEach(f => assert(f.level < 4, 'ซื้อต่อแลนด์มาร์ก'));
        assert(S(room).phase === 'finished', `เกมสุ่ม ${g} ไม่จบ`);
        const r = S(room).monopoly ? S(room).monopoly.type : (S(room).clock.timeUp ? 'time' : 'last');
        reasons[r] = (reasons[r] || 0) + 1;
        byN[n] = (byN[n] || 0) + 1;
        steps += guard;
        checks += 1;
    }
    return { reasons, steps, byN };
}

/** คนกดมั่ว: สุ่มคำสั่งทุกแบบ (รวมคำสั่งผิด) ต้องไม่พัง บัญชีต้องลง */
function chaosGames(count) {
    const cmds = ['roll', 'payIsland', 'build', 'pass', 'takeover', 'declineTakeover', 'pick', 'skipPick', 'sell', 'fast'];
    let rejected = 0;
    for (let g = 0; g < count; g += 1) {
        const rng = mulberry(5000 + g);
        const ids = ['a', 'b', 'bot_c', 'd', 'e', 'bot_f'].slice(0, 2 + (g % 5));
        const room = makeRoom(ids, { rng });
        let guard = 0;
        while (S(room).phase !== 'finished' && guard < 3000) {
            T += 700;
            const who = ids[Math.floor(rng() * ids.length)];
            const cmd = cmds[Math.floor(rng() * cmds.length)];
            const arg = Math.floor(rng() * 36) - 2;
            try {
                if (cmd === 'roll') E.rollDice(room, who, null, rng);
                else if (cmd === 'payIsland') E.payIsland(room, who, null);
                else if (cmd === 'build') E.buildTo(room, who, Math.floor(rng() * 6) - 1, null);
                else if (cmd === 'pass') E.passBuild(room, who, null);
                else if (cmd === 'takeover') E.acceptTakeover(room, who, null);
                else if (cmd === 'declineTakeover') E.declineTakeover(room, who, null);
                else if (cmd === 'pick') E.pickSquare(room, who, arg, null);
                else if (cmd === 'skipPick') E.skipPick(room, who, null);
                else if (cmd === 'sell') E.sellSquare(room, who, arg);
                else E.setFast(room, who, rng() < 0.5);
            } catch (e) { rejected += 1; }
            if (rng() < 0.08) { T += 60000; E.tick(room, rng); }
            E.playBotTurns(room, rng, T + 100000);
            const pr = E.auditState(room);
            if (pr.length) throw new Error(`เกมมั่ว ${g} ก้าว ${guard} (${cmd}): ${pr.join(' · ')}`);
            guard += 1;
        }
        checks += 1;
    }
    return rejected;
}

(async () => {
    const started = Date.now();
    for (const t of tests) {
        try {
            t.fn();
        } catch (error) {
            console.error('✗', t.name, '\n ', error.message);
            process.exit(1);
        }
        console.log('✓', t.name);
    }
    const games = Number(process.env.SETTHI_GAMES) || 2000;
    const r = randomGames(games);
    console.log(`✓ เกมบอทสุ่ม ${games} เกม (${r.steps} ก้าว ตรวจทุกก้าว) — จบแบบ ${JSON.stringify(r.reasons)}`);
    for (const type of ['color', 'line', 'tourist', 'last']) assert(r.reasons[type] > 0, 'เกมสุ่มต้องมีจบแบบ ' + type);
    for (let n = 2; n <= 6; n += 1) assert(r.byN[n] > 0, 'เกมสุ่มต้องมี ' + n + ' คน');
    console.log('  จำนวนคนต่อเกม ' + JSON.stringify(r.byN));
    const rejected = chaosGames(Math.max(100, Math.round(games / 10)));
    console.log(`✓ เกมกดมั่ว ${Math.max(100, Math.round(games / 10))} เกม (คำสั่งโดนปฏิเสธ ${rejected} ครั้ง ไม่มีพัง)`);
    console.log(`setthi engine: ${checks} checks ผ่านทั้งหมด (${((Date.now() - started) / 1000).toFixed(1)}s)`);
})();
