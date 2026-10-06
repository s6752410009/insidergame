/**
 * เศรษฐี — เทส engine ล้วน (ไม่มีเซิร์ฟเวอร์)
 *  1) กติกาทีละข้อ: ซื้อ/ค่าเช่า/ครบชุด/ขนส่ง/สาธารณูปโภค · ประมูล · สร้างบ้านเท่ากัน/โรงแรม/ขายคืนครึ่ง
 *     จำนอง/ไถ่ถอน +10% · ดับเบิล/ดับเบิล 3 ครั้ง · คุก 4 ทาง · การ์ดทุกแบบ · หนี้/ล้มละลาย · เทรด/โต้กลับ/หมดอายุ
 *     นาฬิกาเกม (จบรอบแล้วนับทรัพย์สิน เสมอกันชนะร่วม) · คนออก · autopilot · คำสั่งผิดโดนปฏิเสธ · payload ไม่รั่ว
 *  2) สุ่มเล่นหลายพันเกม (บอท + ผู้เล่นสุ่ม) ตรวจ invariant ทุกขั้น: เงินรวมตรงบัญชี · ไม่ติดลบ · บ้าน ≤ 4+โรงแรม
 *     สร้างเท่ากัน · จำนองไม่เก็บค่าเช่า · คนล้มละลายไม่มีอะไรเหลือ
 *
 * รัน: npm run smoke:setthi   (SETTHI_GAMES=จำนวนเกมสุ่ม)
 */
process.env.SETTHI_BOT_MS = process.env.SETTHI_BOT_MS || '1';
process.env.SETTHI_MINUTE_MS = process.env.SETTHI_MINUTE_MS || '2000';

const E = require('../games/setthiEngine');
const B = require('../games/setthiBoard');

let checks = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    checks += 1;
}
function eq(a, b, msg) { assert(a === b, `${msg} (ได้ ${JSON.stringify(a)} คาด ${JSON.stringify(b)})`); }
function throws(fn, pattern, msg) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error, `${msg}: ต้อง error`);
    if (pattern) assert(pattern.test(error.message), `${msg}: ข้อความ "${error.message}" ไม่ตรง ${pattern}`);
}

let T = 1_000_000;
E.setClock(() => T);

function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeRoom(ids, settings = {}) {
    return {
        roomId: 'T1',
        admin: ids[0],
        settings: { gameMode: 'setthi', setthiMinutes: 0, ...settings },
        players: ids.map(id => ({ playerId: id, playerName: id.toUpperCase(), socketId: 'sock-' + id, color: '#fff', avatar: '🙂' })),
        gameState: E.createInitialState()
    };
}

function start(ids, opts = {}, settings = {}) {
    const room = makeRoom(ids, settings);
    E.startGame(room, mulberry32(opts.seed || 7), { firstSeat: 0, dice: opts.dice || [] });
    return room;
}
const S = room => room.gameState;
const seat = (room, id) => S(room).seats.find(s => s.playerId === id);
const P = (room, i) => S(room).props[i];
const audit = (room, label) => {
    const problems = E.auditState(room);
    assert(problems.length === 0, `${label}: ${problems.join(' | ')}`);
};
function seq(room) { return { seq: S(room).phaseSeq }; }
/** เดินเกมแบบไม่ซื้ออะไรจนถึงตา target ทอย */
function driveUntil(room, target) {
    for (let guard = 0; guard < 200; guard += 1) {
        const s = S(room);
        if (s.phase === 'roll' && s.phaseActor === target) return;
        if (s.phase === 'auction') { T = s.auction.endsAt; E.tick(room); continue; }
        if (s.phase === 'debt') { T = s.phaseEndsAt; E.tick(room); continue; }
        const id = s.phaseActor;
        if (s.phase === 'buy') E.declineBuy(room, id, seq(room));
        else if (s.phase === 'roll') E.rollDice(room, id, seq(room));
        else if (s.phase === 'manage') E.endTurn(room, id, seq(room));
        else throw new Error('driveUntil ติดที่ ' + s.phase);
    }
    throw new Error('driveUntil ไม่ถึงตา ' + target);
}
/** ตั้งเงินสดแบบลงบัญชีธนาคารด้วย (ให้ audit ยังตรง) */
function setCash(room, id, value) {
    const x = seat(room, id);
    const diff = value - x.cash;
    if (diff > 0) S(room).ledger.bankOut += diff; else S(room).ledger.bankIn += -diff;
    x.cash = value;
}
function give(room, id, squares) { squares.forEach(i => { P(room, i).owner = id; }); }

// ================= กติกาทีละข้อ =================

function testStart() {
    const room = start(['a', 'b', 'c']);
    const s = S(room);
    eq(s.seats.length, 3, 'ที่นั่ง');
    s.seats.forEach(x => eq(x.cash, 1500, 'ทุนตั้งต้น'));
    eq(s.decks.chance.length, 16, 'กองโอกาส');
    eq(s.decks.fortune.length, 16, 'กองดวงชะตา');
    eq(Object.keys(s.props).length, 28, 'ที่ดินซื้อได้ 28 แปลง');
    eq(s.phase, 'roll', 'เริ่มที่เฟสทอย');
    eq(s.phaseActor, 'a', 'คนแรกทอย');
    eq(B.SQUARES.filter(x => x.type === 'property').length, 22, 'จังหวัด 22');
    eq(Object.keys(B.GROUPS).length, 8, '8 ชุดสี');
    const landDir = require('path').join(__dirname, '..', 'public', 'assets', 'games', 'setthi', 'land');
    B.SQUARES.forEach(sq => assert(sq.art && require('fs').existsSync(require('path').join(landDir, sq.art + '.svg')), 'มีภาพแลนด์มาร์กของ ' + sq.name));
    audit(room, 'เริ่มเกม');
    throws(() => E.startGame(makeRoom(['solo'])), /2–6/, 'คนเดียวเริ่มไม่ได้');
    throws(() => E.startGame(makeRoom(['a', 'b', 'c', 'd', 'e', 'f', 'g'])), /2–6/, '7 คนเริ่มไม่ได้');
}

function testRollBuyRent() {
    const room = start(['a', 'b'], { dice: [[1, 2], [3, 4], [2, 1]] });
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').pos, 3, 'เดิน 3 ช่อง');
    eq(S(room).phase, 'buy', 'ตกที่ว่าง = เฟสซื้อ');
    throws(() => E.buyProperty(room, 'b', seq(room)), /ยังไม่ถึงตา/, 'คนอื่นซื้อแทนไม่ได้');
    throws(() => E.buyProperty(room, 'a', { seq: 1 }), /สถานะเปลี่ยน/, 'seq เก่าโดนปฏิเสธ');
    E.buyProperty(room, 'a', seq(room));
    eq(P(room, 3).owner, 'a', 'เป็นเจ้าของ');
    eq(seat(room, 'a').cash, 1500 - 70, 'จ่ายราคา');
    eq(S(room).phase, 'manage', 'ไม่ดับเบิล → จัดการ/จบเทิร์น');
    throws(() => E.rollDice(room, 'a', seq(room)), /ทำแบบนี้ไม่ได้/, 'ทอยซ้ำไม่ได้');
    E.endTurn(room, 'a', seq(room));
    eq(S(room).phaseActor, 'b', 'ตา b');
    E.rollDice(room, 'b', seq(room)); // 3+4 = 7 → ขอนแก่น
    eq(seat(room, 'b').pos, 7, 'b เดิน 7');
    E.buyProperty(room, 'b', seq(room));
    E.endTurn(room, 'b', seq(room));
    E.rollDice(room, 'a', seq(room)); // 2+1 → 6 อุดร
    E.declineBuy(room, 'a', seq(room));
    eq(S(room).phase, 'auction', 'ไม่ซื้อ = ประมูล');
    audit(room, 'ซื้อ/ประมูล');

    // ค่าเช่า
    const r2 = start(['a', 'b'], { dice: [[1, 2]] });
    give(r2, 'b', [3]);
    E.rollDice(r2, 'a', seq(r2));
    eq(seat(r2, 'a').cash, 1500 - 5, 'ค่าเช่าพื้นฐาน');
    eq(seat(r2, 'b').cash, 1500 + 5, 'เจ้าของได้ค่าเช่า');
    const r3 = start(['a', 'b'], { dice: [[1, 2]] });
    give(r3, 'b', [1, 3]);
    E.rollDice(r3, 'a', seq(r3));
    eq(seat(r3, 'a').cash, 1500 - 10, 'ครบชุด = ค่าเช่า 2 เท่า');
    const r4 = start(['a', 'b'], { dice: [[1, 2]] });
    give(r4, 'b', [1, 3]);
    P(r4, 3).mortgaged = true;
    S(r4).seats[1].cash += 0;
    E.rollDice(r4, 'a', seq(r4));
    eq(seat(r4, 'a').cash, 1500, 'จำนองอยู่ไม่เก็บค่าเช่า');
    eq(E.rentFor(r4, 3, 7), 0, 'rentFor จำนอง = 0');
    // ขนส่ง
    const r5 = start(['a', 'b'], { dice: [[2, 3]] });
    give(r5, 'b', [5, 15, 25]);
    E.rollDice(r5, 'a', seq(r5));
    eq(seat(r5, 'a').cash, 1500 - 100, 'ขนส่ง 3 แห่ง = 100');
    // สาธารณูปโภค
    const r6 = start(['a', 'b'], { dice: [[6, 6], [6, 1]] });
    give(r6, 'b', [13]);
    seat(r6, 'a').pos = 1;
    E.rollDice(r6, 'a', seq(r6));
    eq(seat(r6, 'a').cash, 1500 - 12 * 4, 'ไฟฟ้า 1 แห่ง = เต๋า × 4');
    const r7 = start(['a', 'b'], { dice: [[6, 6]] });
    give(r7, 'b', [13, 27]);
    seat(r7, 'a').pos = 1;
    E.rollDice(r7, 'a', seq(r7));
    eq(seat(r7, 'a').cash, 1500 - 12 * 10, 'ครบ 2 แห่ง = เต๋า × 10');
    audit(r7, 'ค่าเช่า');
}

function testSalaryAndDoubles() {
    const room = start(['a', 'b'], { dice: [[1, 1], [3, 3], [4, 4]] });
    seat(room, 'a').pos = 38;
    E.rollDice(room, 'a', seq(room)); // 38+2 = 40 → ตกช่องเริ่มพอดี
    eq(seat(room, 'a').pos, 0, 'วนรอบ');
    eq(seat(room, 'a').cash, 1700, 'ได้เงินเดือน');
    assert(S(room).fx.some(f => f.kind === 'salary'), 'มี fx เงินเดือน');
    // ทอยต่อจากดับเบิลจนครั้งที่ 3 → คุก
    while (S(room).phase !== 'roll') {
        if (S(room).phase === 'buy') E.declineBuy(room, 'a', seq(room));
        if (S(room).phase === 'auction') { T = S(room).auction.endsAt; E.tick(room); }
        if (S(room).phase === 'debt') { T = S(room).phaseEndsAt; E.tick(room); }
    }
    eq(S(room).phaseActor, 'a', 'ดับเบิลได้ทอยอีก');
    E.rollDice(room, 'a', seq(room));
    while (S(room).phase !== 'roll') {
        if (S(room).phase === 'buy') E.declineBuy(room, 'a', seq(room));
        else if (S(room).phase === 'auction') { T = S(room).auction.endsAt; E.tick(room); } else break;
    }
    eq(S(room).phaseActor, 'a', 'ดับเบิลครั้งที่ 2 ทอยอีก');
    E.rollDice(room, 'a', seq(room));
    assert(seat(room, 'a').inJail, 'ดับเบิล 3 ครั้งติด = เข้าคุก');
    eq(seat(room, 'a').pos, 10, 'อยู่ช่องคุก');
    eq(S(room).phase, 'manage', 'หลังเข้าคุก ตาจบ (จัดการ/จบเทิร์นได้)');
    audit(room, 'ดับเบิล');
}

function jailRoom(dice) {
    const room = start(['a', 'b'], { dice });
    seat(room, 'a').inJail = true;
    seat(room, 'a').pos = 10;
    return room;
}

function testJail() {
    // ไปคุกจากช่อง 30
    const r0 = start(['a', 'b'], { dice: [[4, 3]] });
    seat(r0, 'a').pos = 23;
    E.rollDice(r0, 'a', seq(r0));
    assert(seat(r0, 'a').inJail && seat(r0, 'a').pos === 10, 'ตกช่องไปคุก');
    eq(seat(r0, 'a').cash, 1500, 'ไม่ได้เงินเดือนตอนไปคุก');
    // จ่ายค่าปรับ
    const r1 = jailRoom([[1, 2]]);
    E.payJailFine(r1, 'a', seq(r1));
    eq(seat(r1, 'a').cash, 1450, 'ค่าปรับ 50');
    assert(!seat(r1, 'a').inJail, 'ออกคุก');
    E.rollDice(r1, 'a', seq(r1));
    eq(seat(r1, 'a').pos, 13, 'ทอยเดินปกติหลังจ่าย');
    // ใช้บัตร
    const r2 = jailRoom([[1, 2]]);
    seat(r2, 'a').jailCards = [S(r2).decks.chance.splice(S(r2).decks.chance.indexOf('c11'), 1)[0]];
    throws(() => E.useJailCard(r2, 'b', seq(r2)), /ยังไม่ถึงตา/, 'คนอื่นใช้บัตรแทนไม่ได้');
    E.useJailCard(r2, 'a', seq(r2));
    assert(!seat(r2, 'a').inJail, 'ใช้บัตรออกคุก');
    eq(S(r2).decks.chance.length, 16, 'บัตรกลับเข้ากอง');
    audit(r2, 'บัตรอภัยโทษ');
    // ทอยได้ดับเบิล
    const r3 = jailRoom([[5, 5]]);
    E.rollDice(r3, 'a', seq(r3));
    assert(!seat(r3, 'a').inJail, 'ดับเบิลออกคุก');
    eq(seat(r3, 'a').pos, 20, 'เดินตามแต้ม');
    assert(S(r3).phase === 'manage', 'ออกคุกด้วยดับเบิลไม่ได้ทอยซ้ำ');
    // ไม่ได้ดับเบิล 3 ครั้ง → จ่ายแล้วเดิน
    const r4 = jailRoom([[1, 2], [6, 6], [1, 3], [6, 5], [1, 2], [2, 4]]);
    E.rollDice(r4, 'a', seq(r4));
    assert(seat(r4, 'a').inJail && seat(r4, 'a').jailTurns === 1, 'ยังติดคุก 1');
    E.endTurn(r4, 'a', seq(r4));
    driveUntil(r4, 'a');
    E.rollDice(r4, 'a', seq(r4));
    eq(seat(r4, 'a').jailTurns, 2, 'ติดคุก 2');
    E.endTurn(r4, 'a', seq(r4));
    driveUntil(r4, 'a');
    const before = seat(r4, 'a').cash;
    E.rollDice(r4, 'a', seq(r4)); // 2+4 ครั้งที่ 3
    assert(!seat(r4, 'a').inJail, 'ครบ 3 ตาออกคุก');
    eq(seat(r4, 'a').pos, 16, 'เดิน 6 ช่องจากคุก');
    assert(seat(r4, 'a').cash <= before - 50, 'จ่ายค่าปรับ 50');
    audit(r4, 'คุก 3 ตา');
    // จ่ายค่าปรับไม่ได้ถ้าไม่ได้ติดคุก
    const r5 = start(['a', 'b']);
    throws(() => E.payJailFine(r5, 'a', seq(r5)), /ไม่ได้ติดคุก/, 'ไม่ติดคุกจ่ายไม่ได้');
}

function forceCard(room, deck, id) {
    const d = S(room).decks[deck];
    d.splice(d.indexOf(id), 1);
    d.unshift(id);
}

function testCards() {
    // ไปจุดเริ่ม
    let room = start(['a', 'b', 'c'], { dice: [[1, 1]] });
    forceCard(room, 'chance', 'c01');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').pos, 0, 'การ์ดไปจุดเริ่ม');
    eq(seat(room, 'a').cash, 1700, 'ได้เงินเดือน');
    assert(S(room).fx.some(f => f.kind === 'card' && f.card.id === 'c01'), 'fx การ์ดมีข้อความ');
    audit(room, 'การ์ดไปเริ่ม');
    // ถอยหลัง 3
    room = start(['a', 'b'], { dice: [[1, 1]] });
    forceCard(room, 'chance', 'c09');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').pos, 39, 'ถอยหลังจาก 2 ไป 39');
    eq(S(room).phase, 'buy', 'ตกสุขุมวิทซื้อได้');
    // สถานีใกล้สุด ×2
    room = start(['a', 'b'], { dice: [[1, 1]] });
    give(room, 'b', [5]);
    forceCard(room, 'chance', 'c06');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').pos, 5, 'ไปขนส่งใกล้สุด');
    eq(seat(room, 'a').cash, 1500 - 50, 'ค่าเช่า 2 เท่า');
    // สาธารณูปโภคใกล้สุด ×10 (ทอยใหม่)
    room = start(['a', 'b'], { dice: [[1, 1], [3, 4]] });
    give(room, 'b', [13]);
    forceCard(room, 'chance', 'c08');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').pos, 13, 'ไปการไฟฟ้า');
    eq(seat(room, 'a').cash, 1500 - 70, 'ทอยใหม่ 7 × 10');
    // ไปคุก
    room = start(['a', 'b'], { dice: [[1, 1]] });
    forceCard(room, 'chance', 'c10');
    E.rollDice(room, 'a', seq(room));
    assert(seat(room, 'a').inJail, 'การ์ดไปคุก');
    eq(S(room).phase, 'manage', 'การ์ดไปคุกตัดสิทธิ์ทอยซ้ำจากดับเบิล');
    // บัตรอภัยโทษถือไว้
    room = start(['a', 'b'], { dice: [[1, 1]] });
    forceCard(room, 'chance', 'c11');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').jailCards.length, 1, 'ได้บัตร');
    eq(S(room).decks.chance.length, 15, 'บัตรออกจากกอง');
    audit(room, 'ถือบัตร');
    // ซ่อมบ้าน
    room = start(['a', 'b'], { dice: [[1, 1]] });
    give(room, 'a', [11, 12, 14]);
    P(room, 11).houses = 5; P(room, 12).houses = 4; P(room, 14).houses = 4;
    forceCard(room, 'chance', 'c12');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').cash, 1500 - (8 * 25 + 100), 'ค่าซ่อมตามบ้าน/โรงแรม');
    // จ่ายทุกคน
    room = start(['a', 'b', 'c'], { dice: [[1, 1]] });
    forceCard(room, 'chance', 'c16');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').cash, 1400, 'จ่ายคนละ 50');
    eq(seat(room, 'b').cash, 1550, 'b ได้ 50');
    // เก็บจากทุกคน
    room = start(['a', 'b', 'c'], { dice: [[4, 4]] });
    forceCard(room, 'fortune', 'f07');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').cash, 1520, 'เก็บคนละ 10');
    eq(seat(room, 'c').cash, 1490, 'c จ่าย 10');
    audit(room, 'การ์ดเงิน');
    // ได้/เสียเงิน
    room = start(['a', 'b'], { dice: [[4, 4]] });
    forceCard(room, 'fortune', 'f11');
    E.rollDice(room, 'a', seq(room));
    eq(seat(room, 'a').cash, 1400, 'ค่าโรงพยาบาล');
    // ทุกใบมีข้อความไทย
    [...B.CHANCE, ...B.FORTUNE].forEach(card => assert(/[ก-๙]/.test(card.title + card.text), 'การ์ดเป็นภาษาไทย ' + card.id));
}

function testAuction() {
    const room = start(['a', 'b', 'c'], { dice: [[1, 2]] });
    E.rollDice(room, 'a', seq(room));
    E.declineBuy(room, 'a', seq(room));
    const a = () => S(room).auction;
    throws(() => E.placeBid(room, 'b', 5), /อย่างน้อย/, 'ต่ำกว่าขั้นต่ำ');
    E.placeBid(room, 'b', 10);
    throws(() => E.placeBid(room, 'b', 50), /สูงสุดอยู่แล้ว/, 'คนนำเสนอซ้ำไม่ได้');
    throws(() => E.placeBid(room, 'c', 15), /อย่างน้อย/, 'ต้องสูงกว่าเดิม 10');
    throws(() => E.placeBid(room, 'c', 99999), /ไม่พอ/, 'เกินเงินสด');
    const endsBefore = a().endsAt;
    T += 5000;
    E.placeBid(room, 'c', 60);
    assert(a().endsAt >= T + 8000 - 1 && a().endsAt >= endsBefore, 'นับถอยหลังรีเซ็ตเมื่อมีคนเสนอ');
    E.placeBid(room, 'a', 80); // คนที่ไม่ซื้อก็ประมูลได้
    T = a().endsAt - 1;
    E.tick(room);
    eq(S(room).phase, 'auction', 'ยังไม่หมดเวลา');
    T = a().endsAt;
    E.tick(room);
    eq(P(room, 3).owner, 'a', 'คนเสนอสูงสุดชนะ');
    eq(seat(room, 'a').cash, 1500 - 80, 'จ่ายราคาประมูล');
    eq(S(room).phase, 'manage', 'จบประมูลกลับไปจัดการตา');
    audit(room, 'ประมูล');
    // ไม่มีใครเสนอ
    const r2 = start(['a', 'b'], { dice: [[1, 2]] });
    E.rollDice(r2, 'a', seq(r2));
    E.declineBuy(r2, 'a', seq(r2));
    T = S(r2).auction.endsAt;
    E.tick(r2);
    eq(P(r2, 3).owner, null, 'ไม่มีคนประมูล = ยังเป็นของธนาคาร');
    // ประมูลไม่ได้นอกเวลา
    throws(() => E.placeBid(r2, 'b', 10), /ไม่มีการประมูล/, 'ไม่มีประมูล');
}

function testBuildMortgage() {
    const room = start(['a', 'b']);
    give(room, 'a', [11, 12]);
    throws(() => E.build(room, 'a', 11), /ครบทั้งชุด/, 'ไม่ครบชุดสร้างไม่ได้');
    give(room, 'a', [14]);
    throws(() => E.build(room, 'b', 11), /เฉพาะตาของคุณ/, 'ไม่ใช่ตาสร้างไม่ได้');
    E.build(room, 'a', 11);
    eq(P(room, 11).houses, 1, 'สร้างบ้าน');
    eq(seat(room, 'a').cash, 1400, 'จ่ายค่าบ้าน 100');
    throws(() => E.build(room, 'a', 11), /เท่ากัน/, 'ต้องสร้างเท่ากัน');
    E.build(room, 'a', 12); E.build(room, 'a', 14);
    for (let level = 2; level <= 4; level += 1) [11, 12, 14].forEach(i => E.build(room, 'a', i));
    [11, 12, 14].forEach(i => eq(P(room, i).houses, 4, 'บ้าน 4 หลัง'));
    E.build(room, 'a', 14);
    eq(P(room, 14).houses, 5, 'โรงแรม');
    throws(() => E.build(room, 'a', 14), /เท่ากัน|โรงแรมแล้ว/, 'เกินโรงแรมไม่ได้');
    throws(() => E.sellBuilding(room, 'a', 11), /มากที่สุด/, 'ต้องขายจากแปลงที่มากสุด');
    const cash = seat(room, 'a').cash;
    E.sellBuilding(room, 'a', 14);
    eq(seat(room, 'a').cash, cash + 50, 'ขายคืนครึ่งราคา');
    eq(P(room, 14).houses, 4, 'โรงแรมกลับเป็น 4 หลัง');
    throws(() => E.mortgage(room, 'a', 11), /ขายบ้าน/, 'มีบ้านในชุดจำนองไม่ได้');
    audit(room, 'สร้างบ้าน');
    // จำนอง
    const r2 = start(['a', 'b']);
    give(r2, 'a', [11, 12, 14, 5]);
    E.mortgage(r2, 'a', 5);
    eq(seat(r2, 'a').cash, 1600, 'จำนองได้ครึ่ง');
    throws(() => E.mortgage(r2, 'a', 5), /อยู่แล้ว/, 'จำนองซ้ำไม่ได้');
    E.mortgage(r2, 'a', 12);
    throws(() => E.build(r2, 'a', 11), /ไถ่ถอน/, 'ชุดมีแปลงจำนองสร้างไม่ได้');
    E.unmortgage(r2, 'a', 12);
    eq(seat(r2, 'a').cash, 1600 + 70 - 77, 'ไถ่ถอน +10%');
    eq(E.unmortgageCost(39), 220, 'ไถ่ถอนสุขุมวิท 220');
    throws(() => E.unmortgage(r2, 'a', 11), /ไม่ได้จำนอง/, 'ไถ่ที่ไม่ได้จำนองไม่ได้');
    throws(() => E.mortgage(r2, 'a', 39), /ไม่ใช่ที่ดิน/, 'จำนองของคนอื่นไม่ได้');
    throws(() => E.build(r2, 'a', 5), /ไม่ใช่ที่ดิน|ครบ/, 'สร้างบนขนส่งไม่ได้');
    audit(r2, 'จำนอง');
}

function testDebtAndBankruptcy() {
    // ค่าเช่าเกินเงินสด แต่จำนองพอ → เฟสหนี้ → จำนองแล้วจ่ายอัตโนมัติ
    let room = start(['a', 'b'], { dice: [[1, 2]] });
    give(room, 'b', [1, 3]);
    P(room, 3).houses = 5; P(room, 1).houses = 4;
    give(room, 'a', [37, 39]);
    setCash(room, 'a', 100);
    E.rollDice(room, 'a', seq(room));
    eq(S(room).phase, 'debt', 'เข้าเฟสหนี้');
    eq(S(room).phaseActor, 'a', 'คนติดหนี้เป็นคนทำ');
    throws(() => E.build(room, 'a', 37), /ขายบ้านหรือจำนอง|ครบ/, 'ติดหนี้สร้างบ้านไม่ได้');
    throws(() => E.endTurn(room, 'a', seq(room)), /ทำแบบนี้ไม่ได้/, 'ติดหนี้จบเทิร์นไม่ได้');
    E.mortgage(room, 'a', 39);
    eq(S(room).phase, 'debt', 'ยังไม่พอ');
    E.mortgage(room, 'a', 37);
    eq(S(room).phase, 'manage', 'พอแล้วจ่ายอัตโนมัติ');
    eq(seat(room, 'b').cash, 1500 + 460, 'เจ้าหนี้ได้ครบ');
    audit(room, 'หนี้');
    // หมดเวลาในเฟสหนี้ → autopilot ขาย/จำนองให้
    room = start(['a', 'b'], { dice: [[1, 2]] });
    give(room, 'b', [3]);
    P(room, 3).houses = 0;
    give(room, 'a', [11, 12, 14]);
    P(room, 11).houses = 1; P(room, 12).houses = 1; P(room, 14).houses = 1;
    setCash(room, 'a', 2);
    E.rollDice(room, 'a', seq(room));
    eq(S(room).phase, 'debt', 'หนี้ 5 บาท');
    T = S(room).phaseEndsAt;
    E.tick(room);
    assert(S(room).phase !== 'debt', 'autopilot จ่ายหนี้แล้ว');
    eq(seat(room, 'b').cash, 1505, 'เจ้าหนี้ได้เงิน');
    audit(room, 'autopilot หนี้');
    // ล้มละลายให้ผู้เล่น: ทรัพย์สินทั้งหมดไปที่เจ้าหนี้
    room = start(['a', 'b', 'c'], { dice: [[1, 2]] });
    give(room, 'b', [3, 1]);
    P(room, 1).houses = 5; P(room, 3).houses = 5;
    give(room, 'a', [5]);
    P(room, 5).mortgaged = true;
    setCash(room, 'a', 30);
    seat(room, 'a').jailCards = [S(room).decks.fortune.splice(S(room).decks.fortune.indexOf('f05'), 1)[0]];
    E.rollDice(room, 'a', seq(room));
    assert(seat(room, 'a').bankrupt, 'ล้มละลาย');
    eq(P(room, 5).owner, 'b', 'ที่ดินไปที่เจ้าหนี้');
    assert(P(room, 5).mortgaged, 'ยังจำนองอยู่');
    eq(seat(room, 'b').jailCards.length, 1, 'บัตรอภัยโทษไปที่เจ้าหนี้');
    eq(seat(room, 'b').cash, 1530, 'เงินสดที่เหลือไปที่เจ้าหนี้');
    eq(S(room).phaseActor, 'b', 'ตาเดินต่อคนถัดไป');
    audit(room, 'ล้มละลายให้ผู้เล่น');
    // ล้มละลายให้ธนาคาร: ที่ดินคืนธนาคาร ไม่มีเจ้าของ บ้านหาย
    room = start(['a', 'b', 'c'], { dice: [[2, 2]] });
    give(room, 'a', [11, 12, 14]);
    P(room, 11).mortgaged = true; P(room, 12).mortgaged = true; P(room, 14).mortgaged = true;
    setCash(room, 'a', 100);
    E.rollDice(room, 'a', seq(room)); // 4 = ภาษี 200
    assert(seat(room, 'a').bankrupt, 'ล้มละลายให้ธนาคาร');
    [11, 12, 14].forEach(i => { eq(P(room, i).owner, null, 'คืนธนาคาร'); eq(P(room, i).mortgaged, false, 'ล้างจำนอง'); });
    audit(room, 'ล้มละลายให้ธนาคาร');
    // เหลือคนเดียว = จบเกม
    room = start(['a', 'b'], { dice: [[2, 2]] });
    setCash(room, 'a', 100);
    E.rollDice(room, 'a', seq(room));
    eq(S(room).phase, 'finished', 'เหลือคนเดียวจบเกม');
    eq(S(room).winners.length, 1, 'ผู้ชนะ 1 คน');
    eq(S(room).winners[0].playerId, 'b', 'b ชนะ');
    eq(S(room).status, 'setthi_finished', 'status จบ');
    audit(room, 'จบด้วยล้มละลาย');
}

function testTrades() {
    const room = start(['a', 'b', 'c']);
    give(room, 'a', [1]);
    give(room, 'b', [3, 5]);
    throws(() => E.proposeTrade(room, 'a', { to: 'a', give: { cash: 10 } }), /ตัวเอง/, 'เทรดกับตัวเองไม่ได้');
    throws(() => E.proposeTrade(room, 'a', { to: 'b' }), /อย่างน้อย/, 'ข้อเสนอว่าง');
    throws(() => E.proposeTrade(room, 'a', { to: 'b', give: { props: [3] } }), /ไม่ใช่ของ/, 'ให้ของคนอื่นไม่ได้');
    throws(() => E.proposeTrade(room, 'a', { to: 'b', give: { cash: 99999 } }), /ไม่พอ/, 'เงินไม่พอ');
    const t = E.proposeTrade(room, 'a', { to: 'b', give: { cash: 100, props: [1] }, get: { props: [3] } });
    throws(() => E.proposeTrade(room, 'a', { to: 'c', give: { cash: 10 } }), /ค้างอยู่/, 'ข้อเสนอค้างได้ทีละอัน');
    throws(() => E.respondTrade(room, 'c', t.id, true), /ไม่ได้ส่งถึงคุณ/, 'คนอื่นตอบแทนไม่ได้');
    const view = E.buildClientState(room, 'c');
    eq(view.trades.length, 0, 'คนนอกไม่เห็นรายละเอียดดีล');
    eq(E.buildClientState(room, 'b').trades.length, 1, 'คู่ดีลเห็น');
    E.respondTrade(room, 'b', t.id, true);
    eq(P(room, 3).owner, 'a', 'ได้ที่ดิน');
    eq(P(room, 1).owner, 'b', 'ให้ที่ดิน');
    eq(seat(room, 'b').cash, 1600, 'ได้เงิน');
    assert(S(room).fx.some(f => f.kind === 'trade'), 'fx จับมือ');
    audit(room, 'เทรด');
    // โต้กลับ
    const t2 = E.proposeTrade(room, 'c', { to: 'b', give: { cash: 50 }, get: { props: [5] } });
    const counter = E.counterTrade(room, 'b', t2.id, { give: { props: [5] }, get: { cash: 300 } });
    eq(S(room).trades.length, 1, 'ข้อเสนอเดิมถูกแทนที่');
    eq(counter.from, 'b', 'ผู้โต้กลับเป็นคนเสนอ');
    eq(counter.counterOf, t2.id, 'อ้างข้อเสนอเดิม');
    E.respondTrade(room, 'c', counter.id, false);
    eq(S(room).trades.length, 0, 'ปฏิเสธแล้วปิด');
    // หมดอายุ
    E.proposeTrade(room, 'c', { to: 'b', give: { cash: 50 }, get: { props: [5] } });
    T += E.TRADE_MS + 1;
    E.tick(room);
    eq(S(room).trades.length, 0, 'ข้อเสนอหมดอายุ');
    // มีบ้านในชุด แลกไม่ได้
    give(room, 'b', [16, 18, 19]);
    P(room, 16).houses = 1;
    throws(() => E.proposeTrade(room, 'a', { to: 'b', get: { props: [18] } }), /มีบ้าน/, 'ชุดมีบ้านแลกไม่ได้');
    // ยกเลิกเอง
    E.proposeTrade(room, 'a', { to: 'c', give: { cash: 1 } });
    E.cancelTrade(room, 'a');
    eq(S(room).trades.length, 0, 'ยกเลิกแล้ว');
    // บัตรอภัยโทษแลกได้
    seat(room, 'a').jailCards = [S(room).decks.chance.splice(S(room).decks.chance.indexOf('c11'), 1)[0]];
    const t3 = E.proposeTrade(room, 'a', { to: 'c', give: { jailCards: 1 }, get: { cash: 40 } });
    E.respondTrade(room, 'c', t3.id, true);
    eq(seat(room, 'c').jailCards.length, 1, 'บัตรย้ายเจ้าของ');
    audit(room, 'เทรดบัตร');
    // ข้อเสนอที่ใช้ไม่ได้แล้วตอนกดรับ
    const t4 = E.proposeTrade(room, 'c', { to: 'a', give: { cash: 500 } });
    setCash(room, 'c', 10);
    throws(() => E.respondTrade(room, 'a', t4.id, true), /ใช้ไม่ได้/, 'ดีลที่เงินไม่พอแล้วรับไม่ได้');
    audit(room, 'ดีลล้ม');
    // ระหว่างประมูลรับดีลไม่ได้
    const r2 = start(['a', 'b'], { dice: [[1, 2]] });
    E.rollDice(r2, 'a', seq(r2));
    E.declineBuy(r2, 'a', seq(r2));
    const t5 = E.proposeTrade(r2, 'a', { to: 'b', give: { cash: 10 } });
    throws(() => E.respondTrade(r2, 'b', t5.id, true), /ประมูล/, 'รอประมูลจบ');
}

function testBotTradeEval() {
    const room = start(['bot_x', 'a']);
    give(room, 'bot_x', [11, 12]);
    give(room, 'a', [14, 1]);
    // ขายแปลงที่ทำให้บอทครบชุดในราคาดี → รับ
    const good = { from: 'a', to: 'bot_x', give: { cash: 0, props: [14], jailCards: 0 }, get: { cash: 250, props: [], jailCards: 0 } };
    assert(E.botWantsTrade(room, 'bot_x', good), 'บอทรับดีลที่ทำให้ครบชุด');
    // ขอแปลงที่ทำให้อีกฝ่ายครบชุดฟรี ๆ → ไม่รับ
    give(room, 'a', [16, 18]);
    give(room, 'bot_x', [19]);
    const bad = { from: 'a', to: 'bot_x', give: { cash: 10, props: [], jailCards: 0 }, get: { cash: 0, props: [19], jailCards: 0 } };
    assert(!E.botWantsTrade(room, 'bot_x', bad), 'บอทไม่ให้คนอื่นครบชุดถูก ๆ');
    const silly = { from: 'a', to: 'bot_x', give: { cash: 0, props: [], jailCards: 0 }, get: { cash: 500, props: [], jailCards: 0 } };
    assert(!E.botWantsTrade(room, 'bot_x', silly), 'บอทไม่ให้เงินฟรี');
}

function testClockAndLeave() {
    const room = start(['a', 'b', 'c'], { dice: [[1, 2], [1, 3], [2, 3], [1, 2]] }, { setthiMinutes: 20 });
    eq(S(room).clock.minutes, 20, 'นาทีตามห้อง');
    setCash(room, 'c', 2000);
    E.rollDice(room, 'a', seq(room));
    E.buyProperty(room, 'a', seq(room));
    assert(S(room).clock.endsAt === S(room).clock.startedAt + 20 * E.MINUTE_MS, 'นาฬิกาเกม 20 นาที');
    S(room).clock.endsAt = T - 1; // เลื่อนนาฬิกาเกมมาหมดตอนนี้ (ไม่ให้เวลาตาหมดไปด้วย)
    E.tick(room);
    assert(S(room).clock.timeUp, 'หมดเวลาแล้ว');
    assert(S(room).phase !== 'finished', 'ยังเล่นให้ครบรอบ');
    E.endTurn(room, 'a', seq(room));
    eq(S(room).phaseActor, 'b', 'b ยังได้เล่น');
    E.rollDice(room, 'b', seq(room));
    if (S(room).phase === 'buy') E.declineBuy(room, 'b', seq(room));
    if (S(room).phase === 'auction') { T = S(room).auction.endsAt; E.tick(room); }
    E.endTurn(room, 'b', seq(room));
    eq(S(room).phaseActor, 'c', 'c ยังได้เล่น');
    E.rollDice(room, 'c', seq(room));
    if (S(room).phase === 'buy') E.declineBuy(room, 'c', seq(room));
    if (S(room).phase === 'auction') { T = S(room).auction.endsAt; E.tick(room); }
    E.endTurn(room, 'c', seq(room));
    eq(S(room).phase, 'finished', 'ครบรอบแล้วจบ');
    eq(S(room).winners[0].playerId, 'c', 'ทรัพย์สินมากสุดชนะ');
    eq(S(room).standings[0].netWorth, E.netWorth(room, seat(room, 'c')), 'อันดับตามมูลค่าสุทธิ');
    audit(room, 'หมดเวลา');
    // เสมอกัน = ชนะร่วม
    const r2 = start(['a', 'b', 'c']);
    E.endGame(r2, 'a');
    eq(S(r2).winners.length, 3, 'เท่ากันชนะร่วม');
    S(r2).standings.forEach(row => eq(row.rank, 1, 'อันดับร่วม 1'));
    throws(() => E.endGame(start(['a', 'b']), 'b'), /หัวห้อง/, 'คนอื่นจบเกมไม่ได้');
    // คนออก: ทรัพย์สินคืนธนาคาร ตาเดินต่อ
    const r3 = start(['a', 'b', 'c']);
    give(r3, 'a', [1, 3]);
    P(r3, 1).houses = 1; P(r3, 3).houses = 1;
    E.proposeTrade(r3, 'b', { to: 'a', give: { cash: 10 } });
    E.handlePlayerLeft(r3, 'a');
    eq(P(r3, 1).owner, null, 'ที่ดินคืนธนาคาร');
    eq(P(r3, 1).houses, 0, 'บ้านหาย');
    eq(seat(r3, 'a').cash, 0, 'เงินคืนธนาคาร');
    eq(S(r3).phaseActor, 'b', 'ตาไปคนถัดไป');
    eq(S(r3).trades.length, 0, 'ดีลที่เกี่ยวข้องถูกยกเลิก');
    audit(r3, 'คนออก');
    E.handlePlayerLeft(r3, 'c');
    eq(S(r3).phase, 'finished', 'เหลือคนเดียวจบ');
    eq(S(r3).winners[0].playerId, 'b', 'คนสุดท้ายชนะ');
    audit(r3, 'คนออกจนจบ');
    // คนนำการประมูลออก → ราคาย้อนกลับไปคนก่อนหน้า
    const r4 = start(['a', 'b', 'c'], { dice: [[1, 2]] });
    E.rollDice(r4, 'a', seq(r4));
    E.declineBuy(r4, 'a', seq(r4));
    E.placeBid(r4, 'b', 20);
    E.placeBid(r4, 'c', 40);
    E.handlePlayerLeft(r4, 'c');
    eq(S(r4).auction.leader, 'b', 'คนก่อนหน้านำ');
    eq(S(r4).auction.high, 20, 'ราคาย้อนกลับ');
    T = S(r4).auction.endsAt;
    E.tick(r4);
    eq(P(r4, 3).owner, 'b', 'b ได้ไป');
    audit(r4, 'ออกระหว่างประมูล');
}

function testAutopilotAndOffline() {
    const room = start(['a', 'b'], { dice: [[1, 2], [3, 4]] });
    T = S(room).phaseEndsAt;
    E.tick(room);
    eq(seat(room, 'a').pos, 3, 'หมดเวลาทอยให้');
    eq(S(room).phase, 'buy', 'เข้าเฟสซื้อ');
    T = S(room).phaseEndsAt;
    E.tick(room);
    eq(S(room).phase, 'auction', 'หมดเวลาไม่ซื้อ → ประมูล');
    T = S(room).auction.endsAt;
    E.tick(room);
    eq(S(room).phase, 'manage', 'จบประมูล');
    T = S(room).phaseEndsAt;
    E.tick(room);
    eq(S(room).phaseActor, 'b', 'หมดเวลาจบเทิร์นให้');
    // หลุดนาน → ตาสั้นลง
    room.players.find(p => p.playerId === 'b').socketId = null;
    room.players.find(p => p.playerId === 'b').disconnectedAt = new Date(T - 60000).toISOString();
    const d = E.effectiveDeadline(room, T);
    assert(d < S(room).phaseEndsAt, 'คนหลุดได้เวลาสั้นกว่า');
    T = d;
    E.tick(room);
    eq(seat(room, 'b').pos, 7, 'คนหลุดถูกทอยให้');
    audit(room, 'autopilot');
}

function testPayloadPrivacy() {
    const room = start(['a', 'bot_b']);
    S(room).botMemo.bot_b = { asked: { x: 1 } };
    const json = JSON.stringify(E.buildClientState(room, 'a'));
    assert(!json.includes('"decks"'), 'ไม่ส่งลำดับกองการ์ด');
    assert(!json.includes('botMemo') && !json.includes('asked'), 'ไม่ส่งความคิดบอท');
    assert(!json.includes('testDice') && !json.includes('ledger'), 'ไม่ส่ง field ภายใน');
    const upcoming = S(room).decks.chance.slice(0, 3);
    upcoming.forEach(id => assert(!json.includes(`"${id}"`), 'ไม่มี id การ์ดในกอง ' + id));
}

function testHoldRoll() {
    // สถิติ: แรงเพิ่มแต้มรวม (ไม่เกิน ~+2) · ช่องเขียวดับเบิล ~1/3 · ทุกลูก 1..6
    const rng = mulberry32(99);
    const sample = (bias, n = 60000) => {
        let sum = 0; let dbl = 0;
        for (let i = 0; i < n; i += 1) {
            const [a, b] = E.biasedDice(rng, bias);
            assert(a >= 1 && a <= 6 && b >= 1 && b <= 6 && Number.isInteger(a) && Number.isInteger(b), 'เต๋าอยู่ใน 1..6');
            sum += a + b; if (a === b) dbl += 1;
        }
        return { mean: sum / n, doubles: dbl / n };
    };
    const base = sample(null);
    const tap = sample({ power: 0, green: false });
    const half = sample({ power: 0.5, green: false });
    const max = sample({ power: 1, green: false });
    const green = sample({ power: 0, green: true });
    assert(Math.abs(base.mean - 7) < 0.06 && Math.abs(base.doubles - 1 / 6) < 0.012, 'ทอยปกติยุติธรรม ' + JSON.stringify(base));
    assert(Math.abs(tap.mean - 7) < 0.06 && Math.abs(tap.doubles - 1 / 6) < 0.012, 'แรง 0 = ปกติ');
    assert(half.mean > base.mean + 0.6 && half.mean < max.mean, 'แรงครึ่งเพิ่มแต้ม ' + half.mean);
    assert(max.mean > 8.6 && max.mean < 9.15, 'แรงสุดเพิ่มไม่เกิน ~+2 ' + max.mean);
    assert(green.doubles > 0.29 && green.doubles < 0.37, 'ช่องเขียวดับเบิล ~1/3 ' + green.doubles);
    assert(Math.abs(green.mean - 7) < 0.1, 'ช่องเขียวไม่เปลี่ยนแต้มเฉลี่ยมาก');
    // สูตรเข็ม
    const hold = { period: 1200, green: { appearAt: 400, until: 1500, center: 0.5, width: 0.1 } };
    eq(E.meterAt(hold, 100).tap, true, 'ต่ำกว่า 150ms = แตะ');
    assert(Math.abs(E.meterAt(hold, 600).pos - 1) < 1e-9, 'ครึ่งคาบ = แรงสุด');
    assert(E.meterAt(hold, 1200).pos < 1e-9, 'ครบคาบกลับมาที่ 0');
    // ช่องเขียวนับเฉพาะช่วงที่โผล่: pos = 0.5 ที่ t = 300 (ก่อนโผล่), 900 (ระหว่าง), 1500+1200k (หลังหาย)
    eq(E.meterAt(hold, 300).green, false, 'ก่อนช่องเขียวโผล่ เข็มตรงช่องก็ไม่ได้โบนัส');
    eq(E.meterAt(hold, 900).green, true, 'ระหว่างโผล่ เข็มตรงช่อง = ได้');
    eq(E.meterAt(hold, 2700).green, false, 'ช่องเขียวหายแล้ว เข็มตรงตำแหน่งเดิมก็ไม่ได้');
    eq(E.meterAt({ period: 1200, green: null }, 900).green, false, 'ไม่มีช่องเขียว = ไม่มีโบนัส');
    // อัตราการเกิดช่องเขียว ~50% · ช่วงโผล่ยาวพอให้เข็มผ่านกลางช่อง
    const rr = mulberry32(7);
    let spawned = 0;
    const N = 6000;
    for (let i = 0; i < N; i += 1) {
        const period = 1000 + Math.floor(rr() * 500);
        const g = E.greenSchedule(rr, period);
        if (!g) continue;
        spawned += 1;
        assert(g.appearAt >= 300 && g.appearAt <= 1200 && g.width >= 0.09 && g.width <= 0.14 && g.center >= 0.3 && g.center <= 0.85, 'ช่องเขียวอยู่ในช่วงที่ตั้งไว้');
        let crossed = false;
        for (let t = g.appearAt; t <= g.until && !crossed; t += 4) crossed = Math.abs((1 - Math.cos(2 * Math.PI * t / period)) / 2 - g.center) <= g.width / 2;
        assert(crossed, 'เข็มผ่านช่องเขียวได้ระหว่างที่โผล่');
    }
    assert(Math.abs(spawned / N - E.GREEN_SPAWN) < 0.03, 'อัตราเกิดช่องเขียว ~' + E.GREEN_SPAWN + ' ได้ ' + (spawned / N).toFixed(3));
    // ผ่านคำสั่ง: เริ่ม/ปล่อย/หนีบเวลา
    const room = start(['a', 'b']);
    throws(() => E.startRollHold(room, 'b', seq(room)), /ยังไม่ถึงตา/, 'ไม่ใช่ตากดค้างไม่ได้');
    throws(() => E.releaseRoll(room, 'a', 500), /ยังไม่ได้กดค้าง/, 'ปล่อยโดยไม่ได้กดไม่ได้');
    const params = E.startRollHold(room, 'a', seq(room));
    assert(params.period >= 1000 && params.period <= 1500 && (params.green === null || params.green.width > 0.08), 'ได้พารามิเตอร์เข็ม');
    throws(() => E.releaseRoll(room, 'b', 500), /ยังไม่ถึงตา/, 'คนอื่นปล่อยแทนไม่ได้');
    T += 600;
    E.releaseRoll(room, 'a', 999999);
    let dice = S(room).fx.filter(f => f.kind === 'dice').pop();
    eq(dice.elapsed, 600, 'เวลาปลอมถูกหนีบเป็นเวลาฝั่งเซิร์ฟเวอร์');
    assert(Math.abs(dice.power - Math.round(E.meterAt(params, 600).power * 100) / 100) < 0.011, 'แรงคำนวณจากเวลาที่ใช้จริง');
    assert(!S(room).rollHold, 'ปล่อยแล้วล้างการกดค้าง');
    // เวลาจาก client ในช่วงเชื่อได้ถูกใช้ · แตะ = ทอยปกติ
    const r2 = start(['a', 'b']);
    E.startRollHold(r2, 'a', seq(r2));
    T += 700;
    E.releaseRoll(r2, 'a', 520);
    eq(S(r2).fx.filter(f => f.kind === 'dice').pop().elapsed, 520, 'เวลา client ช้ากว่าเซิร์ฟเวอร์ไม่เกิน 250ms ใช้ได้');
    const r3 = start(['a', 'b']);
    E.startRollHold(r3, 'a', seq(r3));
    T += 90;
    E.releaseRoll(r3, 'a', 90);
    const tapFx = S(r3).fx.filter(f => f.kind === 'dice').pop();
    eq(tapFx.power, undefined, 'แตะ = ไม่มีแรง (ทอยปกติ)');
    // ปล่อยหลังช่องเขียวหาย (เข็มอยู่ตำแหน่งช่องพอดี) = ไม่ได้โบนัส
    const r6 = start(['a', 'b']);
    E.startRollHold(r6, 'a', seq(r6));
    S(r6).rollHold.period = 1200;
    S(r6).rollHold.green = { appearAt: 400, until: 1500, center: 0.5, width: 0.1 };
    T += 2700;
    E.releaseRoll(r6, 'a', 2700);
    const late = S(r6).fx.filter(f => f.kind === 'dice').pop();
    eq(late.perfect, false, 'ปล่อยนอกเวลาโผล่ไม่ได้โบนัส');
    const r7 = start(['a', 'b']);
    E.startRollHold(r7, 'a', seq(r7));
    S(r7).rollHold.period = 1200;
    S(r7).rollHold.green = { appearAt: 400, until: 1500, center: 0.5, width: 0.1 };
    T += 900;
    E.releaseRoll(r7, 'a', 900);
    eq(S(r7).fx.filter(f => f.kind === 'dice').pop().perfect, true, 'ปล่อยในช่องเขียวระหว่างโผล่ = เป๊ะ');
    // ยกเลิก (นิ้วเลื่อนออก/หลุด)
    const r4 = start(['a', 'b']);
    E.startRollHold(r4, 'a', seq(r4));
    assert(E.cancelRollHold(r4, 'a'), 'ยกเลิกได้');
    throws(() => E.releaseRoll(r4, 'a', 300), /ยังไม่ได้กดค้าง/, 'ยกเลิกแล้วปล่อยไม่ได้');
    // หมดเวลา = autopilot ทอยปกติ แม้กดค้างค้างไว้
    const r5 = start(['a', 'b']);
    E.startRollHold(r5, 'a', seq(r5));
    T = S(r5).phaseEndsAt;
    E.tick(r5);
    const autoFx = S(r5).fx.filter(f => f.kind === 'dice').pop();
    assert(autoFx && autoFx.power === undefined, 'autopilot ทอยปกติ');
    audit(r5, 'กดค้างทอย');
}

// ================= สุ่มเล่นหลายพันเกม =================

function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }

/** ผู้เล่นสุ่ม: เลือกทำอะไรก็ได้ที่ถูกกติกา (บางทีปล่อยให้หมดเวลา) */
function randomAgentAct(room, id, rng) {
    const s = S(room);
    const view = E.buildClientState(room, id);
    const a = view.availableActions;
    const tries = [];
    if (s.phaseActor === id && rng() < 0.08) return false; // ปล่อยหมดเวลา
    if (view.self && view.self.manage && rng() < 0.3) {
        const opts = Object.entries(view.self.manage).flatMap(([sq, o]) => Object.keys(o).map(k => [k, Number(sq)]));
        if (opts.length) {
            const [kind, sq] = pick(rng, opts);
            tries.push(() => ({ build: E.build, sell: E.sellBuilding, mortgage: E.mortgage, unmortgage: E.unmortgage }[kind])(room, id, sq));
        }
    }
    if (view.trades.length && rng() < 0.5) {
        const t = view.trades.find(x => x.to === id);
        if (t) tries.push(() => (rng() < 0.2 ? E.counterTrade(room, id, t.id, { give: { cash: Math.floor(rng() * 50) }, get: { props: [] } }) : E.respondTrade(room, id, t.id, rng() < 0.5)));
        const mine = view.trades.find(x => x.from === id);
        if (mine && rng() < 0.3) tries.push(() => E.cancelTrade(room, id));
    }
    if (a.trade && rng() < 0.04 && !view.trades.some(x => x.from === id)) {
        const others = view.seats.filter(x => !x.isSelf && !x.bankrupt && !x.left);
        if (others.length) {
            const other = pick(rng, others);
            const mineProps = Object.keys(view.props).filter(k => view.props[k].owner === id).map(Number);
            const theirs = Object.keys(view.props).filter(k => view.props[k].owner === other.playerId).map(Number);
            tries.push(() => E.proposeTrade(room, id, {
                to: other.playerId,
                give: { cash: rng() < 0.5 ? Math.floor(rng() * 200) : 0, props: mineProps.length && rng() < 0.5 ? [pick(rng, mineProps)] : [] },
                get: { cash: rng() < 0.3 ? Math.floor(rng() * 100) : 0, props: theirs.length && rng() < 0.6 ? [pick(rng, theirs)] : [] }
            }));
        }
    }
    if (a.bid && a.bid.can && rng() < 0.5) tries.push(() => E.placeBid(room, id, Math.min(a.bid.max, a.bid.min + Math.floor(rng() * 3) * 10)));
    if (a.payJail && rng() < 0.4) tries.push(() => E.payJailFine(room, id, { seq: s.phaseSeq }));
    if (a.useJailCard && rng() < 0.6) tries.push(() => E.useJailCard(room, id, { seq: s.phaseSeq }));
    if (a.roll) tries.push(() => E.rollDice(room, id, { seq: s.phaseSeq }, rng));
    if (a.buy && rng() < 0.7) tries.push(() => E.buyProperty(room, id, { seq: s.phaseSeq }));
    if (a.decline) tries.push(() => E.declineBuy(room, id, { seq: s.phaseSeq }));
    if (a.endTurn) tries.push(() => E.endTurn(room, id, { seq: s.phaseSeq }));
    for (const fn of tries) {
        try { fn(); return true; } catch (error) {
            // บางคำสั่งพลาดได้ตามกติกา (เช่นข้อเสนอที่ใช้ไม่ได้) — ห้ามเป็น TypeError
            if (error instanceof TypeError || error instanceof RangeError) throw error;
        }
    }
    return false;
}

function runRandomGame(seed, stats) {
    const rng = mulberry32(seed);
    const n = 2 + Math.floor(rng() * 5);
    const humans = Math.floor(rng() * Math.min(3, n));
    const ids = [];
    for (let i = 0; i < n; i += 1) ids.push(i < humans ? `h${i}` : `bot_${i}`);
    const minutes = pick(rng, [0, 0, 20, 30]);
    const room = makeRoom(ids, { setthiMinutes: minutes });
    T += 1000;
    E.startGame(room, rng);
    audit(room, `เกม ${seed} เริ่ม`);
    let steps = 0;
    const maxSteps = 4000;
    while (S(room).phase !== 'finished' && steps < maxSteps) {
        steps += 1;
        let acted = false;
        // ผู้เล่นสุ่มลองทำอะไรสักอย่าง
        if (humans) {
            const human = pick(rng, ids.slice(0, humans));
            const h = S(room).seats.find(x => x.playerId === human);
            if (E.isActive(h) && rng() < 0.7) acted = randomAgentAct(room, human, rng);
        }
        if (!acted && E.botNeedsTurn(room)) {
            T += Math.max(1, E.botDelay(room, T) || 1);
            acted = E.playBotTurns(room, rng, T);
        }
        if (!acted) {
            const next = E.nextDeadline(room, T);
            if (next === null) throw new Error(`เกม ${seed} ค้าง: ไม่มี deadline ใน ${S(room).phase}`);
            T = Math.max(T + 1, next);
            E.tick(room, rng);
        }
        const problems = E.auditState(room);
        if (problems.length) throw new Error(`เกม ${seed} ขั้น ${steps} (${S(room).phase}): ${problems.join(' | ')}`);
        checks += 1;
        // payload ทุกคนต้องสร้างได้และไม่รั่ว
        if (steps % 25 === 0) {
            ids.forEach(id => {
                const json = JSON.stringify(E.buildClientState(room, id));
                if (json.includes('"decks"') || json.includes('botMemo')) throw new Error('payload รั่ว');
            });
        }
    }
    const s = S(room);
    stats.games += 1;
    stats.steps += steps;
    if (s.phase === 'finished') {
        if (/หมดเวลา/.test(s.finishReason)) stats.timeUp += 1;
        else stats.lastStanding += 1;
        assert(s.winners && s.winners.length >= 1, 'มีผู้ชนะ');
        s.winners.forEach(w => assert(!seatsOut(s, w.playerId), 'ผู้ชนะต้องยังอยู่'));
    } else stats.capped += 1;
    s.fx.forEach(f => { stats.fx[f.kind] = (stats.fx[f.kind] || 0) + 1; });
    return s;
}
function seatsOut(s, id) {
    const seat = s.seats.find(x => x.playerId === id);
    return !seat || seat.bankrupt || seat.left;
}

function testDeterminism() {
    const a = runRandomGame(424242, { games: 0, steps: 0, timeUp: 0, lastStanding: 0, capped: 0, fx: {} });
    const b = runRandomGame(424242, { games: 0, steps: 0, timeUp: 0, lastStanding: 0, capped: 0, fx: {} });
    const pickState = s => JSON.stringify({ seats: s.seats.map(x => [x.cash, x.pos, x.bankrupt]), props: s.props, phase: s.phase });
    eq(pickState(a), pickState(b), 'seed เดียวกันได้ผลเหมือนกัน');
}

function main() {
    const started = Date.now();
    testStart();
    testRollBuyRent();
    testSalaryAndDoubles();
    testJail();
    testCards();
    testAuction();
    testBuildMortgage();
    testDebtAndBankruptcy();
    testTrades();
    testBotTradeEval();
    testClockAndLeave();
    testAutopilotAndOffline();
    testPayloadPrivacy();
    testHoldRoll();
    testDeterminism();
    const unitChecks = checks;

    const games = Number(process.env.SETTHI_GAMES) || 2000;
    const stats = { games: 0, steps: 0, timeUp: 0, lastStanding: 0, capped: 0, fx: {} };
    const base = Number(process.env.SETTHI_SEED) || (Date.now() % 1000000);
    for (let g = 0; g < games; g += 1) runRandomGame(base + g * 7919, stats);
    const need = ['buy', 'rent', 'auctionStart', 'bid', 'auctionEnd', 'build', 'sell', 'mortgage', 'unmortgage', 'card', 'jail', 'jailFree', 'trade', 'bankrupt', 'set', 'salary', 'debt', 'timeUp', 'finished', 'tradeOffer', 'tradeClosed'];
    if (games >= 500) { // ครอบคลุมทุกเหตุการณ์ (ตรวจเมื่อรันจำนวนมากพอ)
        need.forEach(kind => assert(stats.fx[kind] > 0, `เกมสุ่มควรเจอเหตุการณ์ ${kind}`));
        assert(stats.lastStanding > 0 && stats.timeUp > 0, 'มีทั้งเกมจบด้วยล้มละลายและหมดเวลา');
    }
    console.log(`✅ setthi engine: ${unitChecks} unit checks · ${games} เกมสุ่ม (seed ${base}) ${stats.steps} ขั้น · จบด้วยหมดเวลา ${stats.timeUp} · เหลือคนสุดท้าย ${stats.lastStanding} · ตัดที่เพดาน ${stats.capped} · ${checks} checks · ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

try {
    main();
} catch (error) {
    console.error('❌ setthi engine:', error.stack || error.message);
    process.exit(1);
}
