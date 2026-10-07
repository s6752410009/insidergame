/**
 * เศรษฐี 🪙 — เทสสกิลใน engine (ไม่มีเซิร์ฟเวอร์) · สุ่มแบบกำหนดเอง (setRng) ทุกสกิลทั้งติด/ไม่ติด
 *  🎲 ดับเบิล · ✈️ บินทันที · 💰 Start ×2 · 🏝️ หนีเกาะ · 🛡️ ลดค่าผ่านทาง · 🏗️ ส่วนลดก่อสร้าง · 🃏 ดวงดี · 🎪 งานวัด
 *  ห้องปิดสกิล = ไม่มีผล · ล็อกสกิลตอนเริ่มเกม · ไม่มีสกิล = ไม่กินเลขสุ่ม · ป๊อปอัปทุกคนเห็น · เกมสุ่มที่มีสกิล บัญชีเงินลงทุกก้าว
 *
 * รัน: npm run smoke:setthi:skills
 */
process.env.SETTHI_ANIM_SCALE = process.env.SETTHI_ANIM_SCALE || '0';
process.env.SETTHI_BOT_MS = process.env.SETTHI_BOT_MS || '0';
const E = require('../games/setthiEngine');
const SK = require('../games/setthiSkills');
const B = E.board;

let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
function eq(a, b, m) { assert(a === b, `${m}: ได้ ${JSON.stringify(a)} ต้องเป็น ${JSON.stringify(b)}`); }
function audit(room, m) { const p = E.auditState(room); assert(!p.length, `${m}: ${p.join(' · ')}`); }
function mulberry(a) {
    return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let T = 1.7e12;
E.setClock(() => T);
const ALWAYS = () => 0; // < ทุกโอกาส → สกิลติด
const NEVER = () => 0.999999; // ≥ ทุกโอกาส (ยกเว้น 100%) → ไม่ติด

function makeRoom(ids, opts = {}) {
    const room = {
        roomId: 'r' + Math.random().toString(36).slice(2, 8),
        admin: ids[0],
        settings: { gameMode: 'setthi', setthiMinutes: 0, ...(opts.skillsOff ? { setthiSkills: false } : {}) },
        players: ids.map(id => ({ playerId: id, playerName: id.toUpperCase(), socketId: E.isBotId(id) ? null : 'sock_' + id }))
    };
    E.startGame(room, opts.rng || mulberry(7), { firstSeat: 0, skills: opts.skills || {} });
    return room;
}
const S = room => room.gameState;
const seat = (room, id) => S(room).seats.find(s => s.playerId === id);
const p = (room, i) => S(room).props[i];
function give(room, id, squares, level = 0) {
    squares.forEach(i => { p(room, i).owner = id; p(room, i).level = B.SQUARES[i].type === 'city' ? level : 0; });
}
function dice(room, list) { S(room).testDice.push(...list); }
function rollTotal(room, id, from, pair) {
    seat(room, id).pos = from;
    dice(room, [pair]);
    E.rollDice(room, id, { seq: S(room).phaseSeq });
}
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
function setCash(room, id, v) { const x = seat(room, id); S(room).ledger.bankOut += v - x.cash; x.cash = v; }
const skillFx = (room, id) => S(room).fx.filter(f => f.kind === 'skill' && f.skill === id);
function withRng(fn, rng) { E.setRng(rng); try { fn(); } finally { E.setRng(null); } }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('💰 Start ×2: ติด = เงินเดือน ×2 + ป๊อปอัป + บันทึก · ไม่ติด = ปกติ', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { start2x: 5 } } });
    const c0 = seat(room, 'a').cash;
    withRng(() => rollTotal(room, 'a', 30, [1, 2]), ALWAYS);
    eq(seat(room, 'a').cash - c0, 2 * B.SALARY, 'ได้ ×2');
    const fx = skillFx(room, 'start2x');
    eq(fx.length, 1, 'ป๊อปอัป 1 ครั้ง');
    eq(fx[0].playerId, 'a', 'ของ a');
    eq(fx[0].lv, 5, 'บอกเลเวล');
    assert(S(room).history.some(h => h.kind === 'skill' && h.text.includes('Start ×2')), 'มีบรรทัดในบันทึกเกม');
    eq(seat(room, 'a').skillProcs.start2x, 1, 'นับครั้ง');
    const r2 = makeRoom(['a', 'b'], { skills: { a: { start2x: 5 } } });
    const c1 = seat(r2, 'a').cash;
    withRng(() => rollTotal(r2, 'a', 30, [1, 2]), NEVER);
    eq(seat(r2, 'a').cash - c1, B.SALARY, 'ไม่ติด = ปกติ');
    eq(skillFx(r2, 'start2x').length, 0, 'ไม่ติด ไม่มีป๊อปอัป');
    audit(room, 'start2x'); audit(r2, 'start2x miss');
});

test('🛡️ ลดค่าผ่านทาง: ติด = จ่ายครึ่ง (ป๊อปอัป) · ไม่ติด = เต็ม · คนไม่มีสกิลไม่ได้', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { tollShield: 5 } } });
    give(room, 'b', [9], 2);
    const full = E.tollFor(room, 9);
    const before = seat(room, 'a').cash;
    withRng(() => rollTotal(room, 'a', 7, [1, 1]), ALWAYS);
    eq(before - seat(room, 'a').cash, Math.round(full / 2 / 10) * 10, 'ครึ่ง');
    eq(skillFx(room, 'tollShield').length, 1, 'ป๊อปอัป');
    eq(skillFx(room, 'tollShield')[0].saved, full - Math.round(full / 2 / 10) * 10, 'บอกที่ประหยัด');
    const r2 = makeRoom(['a', 'b'], { skills: { b: { tollShield: 5 } } });
    give(r2, 'b', [9], 2);
    const b2 = seat(r2, 'a').cash;
    withRng(() => rollTotal(r2, 'a', 7, [1, 1]), ALWAYS);
    eq(b2 - seat(r2, 'a').cash, E.tollFor(r2, 9), 'a ไม่มีสกิล = เต็ม (สกิลของเจ้าของไม่ช่วยคนจ่าย)');
    audit(room, 'toll'); audit(r2, 'toll none');
});

test('🏝️ หนีเกาะ: ติด = ออกเลยเดินตามแต้ม · ไม่ติด = ยังติด', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { escape: 3 } } });
    seat(room, 'a').pos = 8; seat(room, 'a').island = 3;
    dice(room, [[1, 2]]);
    withRng(() => E.rollDice(room, 'a', null), ALWAYS);
    eq(seat(room, 'a').pos, 11, 'ออกแล้วเดิน 3');
    eq(seat(room, 'a').island, 0, 'ไม่ติดเกาะ');
    eq(skillFx(room, 'escape').length, 1, 'ป๊อปอัป');
    const r2 = makeRoom(['a', 'b'], { skills: { a: { escape: 3 } } });
    seat(r2, 'a').pos = 8; seat(r2, 'a').island = 3;
    dice(r2, [[1, 2]]);
    withRng(() => E.rollDice(r2, 'a', null), NEVER);
    eq(seat(r2, 'a').pos, 8, 'ยังอยู่เกาะ');
    eq(seat(r2, 'a').island, 2, 'เหลือ 2 ตา');
    audit(room, 'escape'); audit(r2, 'escape miss');
});

test('🎲 ดับเบิล: ติด = ลูกที่สองเท่าลูกแรก ทอยอีก · ไม่ใช่ครั้งที่ 3 · ไม่ใช่ตอนติดเกาะ · ไม่แก้เต๋าที่ /m บังคับ', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { double: 5 } } });
    withRng(() => rollTotal(room, 'a', 0, [2, 5]), ALWAYS);
    eq(S(room).turn.lastRoll.join('+'), '2+2', 'กลายเป็นดับเบิล');
    eq(seat(room, 'a').pos, 4, 'เดินตามแต้มใหม่');
    eq(S(room).turn.canRollAgain, true, 'ทอยอีก');
    eq(skillFx(room, 'double').length, 1, 'ป๊อปอัป');
    eq(S(room).fx.filter(f => f.kind === 'dice').pop().skill, 'double', 'เต๋าบอกว่ามาจากสกิล');
    // ครั้งที่ 3 ห้ามติด (ไม่ส่งไปเกาะเพราะสกิล)
    const r2 = makeRoom(['a', 'b'], { skills: { a: { double: 5 } } });
    S(r2).turn.doublesStreak = 2;
    withRng(() => rollTotal(r2, 'a', 0, [2, 5]), ALWAYS);
    eq(S(r2).turn.lastRoll.join('+'), '2+5', 'ครั้งที่ 3 ไม่เปลี่ยน');
    eq(seat(r2, 'a').island, 0, 'ไม่ติดเกาะ');
    // ติดเกาะ: ไม่ใช้ดับเบิล (สกิลหนีเกาะแยก)
    const r3 = makeRoom(['a', 'b'], { skills: { a: { double: 5 } } });
    seat(r3, 'a').pos = 8; seat(r3, 'a').island = 3;
    dice(r3, [[2, 5]]);
    withRng(() => E.rollDice(r3, 'a', null), ALWAYS);
    eq(seat(r3, 'a').island, 2, 'ติดเกาะต่อ');
    eq(skillFx(r3, 'double').length, 0, 'ไม่ใช้สกิลบนเกาะ');
    // /m เต๋าถัดไป = ไม่แตะ
    const r4 = makeRoom(['a', 'b'], { skills: { a: { double: 5 } } });
    S(r4).debugNext = { a: [2, 5] };
    withRng(() => E.rollDice(r4, 'a', null), ALWAYS);
    eq(S(r4).turn.lastRoll.join('+'), '2+5', 'เต๋าบังคับไม่เปลี่ยน');
    // โอกาสจริงใกล้ตาราง: Lv5 = +5% ดับเบิล
    const room5 = makeRoom(['a', 'b'], { skills: { a: { double: 5 } } });
    let hits = 0;
    const rng = mulberry(99);
    const N = 40000;
    for (let k = 0; k < N; k += 1) if (E.proc(room5, seat(room5, 'a'), 'double', rng)) hits += 1;
    const rate = hits / N * 5 / 6;
    assert(Math.abs(rate - SK.valueOf('double', 5) / 100) < 0.006, `ดับเบิลเพิ่ม ~${SK.valueOf('double', 5)}% (ได้ ${(rate * 100).toFixed(2)}%)`);
    audit(room, 'double'); audit(r2, 'double 3rd'); audit(r3, 'double island'); audit(r4, 'double forced');
});

test('✈️ บินทันที: ตกทัวร์ ติด = เลือกที่บินได้ตานี้เลย (จ่ายค่าทัวร์) · เงินไม่พอ = ไม่ลุ้น ตั๋วยังอยู่ · ไม่ติด = รอตาหน้า', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { fly: 5 } } });
    withRng(() => rollTotal(room, 'a', 20, [1, 3]), ALWAYS);
    eq(seat(room, 'a').pos, 24, 'ตกทัวร์');
    eq(S(room).phase, 'pick', 'เลือกที่บินได้เลย');
    eq(S(room).phaseActor, 'a', 'ตาเดิม');
    eq(S(room).pending.purpose, 'tour', 'เลือกทัวร์');
    eq(skillFx(room, 'fly').length, 1, 'ป๊อปอัป');
    const cash = seat(room, 'a').cash;
    E.pickSquare(room, 'a', 26, { seq: S(room).phaseSeq });
    eq(seat(room, 'a').pos, 26, 'บินไปแล้ว');
    eq(seat(room, 'a').tourPending, false, 'ใช้ตั๋วแล้ว');
    assert(seat(room, 'a').cash <= cash - B.TOUR_FEE, 'จ่ายค่าทัวร์');
    // ไม่ติด
    const r2 = makeRoom(['a', 'b'], { skills: { a: { fly: 5 } } });
    withRng(() => rollTotal(r2, 'a', 20, [1, 3]), NEVER);
    eq(seat(r2, 'a').tourPending, true, 'ได้ตั๋วรอตาหน้า');
    assert(S(r2).phaseActor === 'b', 'ตาต่อไปเป็นของ b');
    // เงินไม่พอ
    const r3 = makeRoom(['a', 'b'], { skills: { a: { fly: 5 } } });
    setCash(r3, 'a', 100);
    withRng(() => rollTotal(r3, 'a', 20, [1, 3]), ALWAYS);
    eq(skillFx(r3, 'fly').length, 0, 'เงินไม่พอไม่ลุ้น');
    eq(seat(r3, 'a').tourPending, true, 'ตั๋วยังอยู่');
    audit(room, 'fly'); audit(r2, 'fly miss'); audit(r3, 'fly poor');
});

test('🃏 ดวงดี: เปิดได้การ์ดร้าย ติด = ได้การ์ดดีใบถัดไป (ใบร้ายไปท้ายกอง) · ไม่ติด = การ์ดร้าย · การ์ดดีไม่ลุ้น', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { luck: 5 } } });
    S(room).deck = ['k06', 'k07', 'k09', 'k01'];
    withRng(() => rollTotal(room, 'a', 0, [1, 2]), ALWAYS);
    const card = S(room).fx.filter(f => f.kind === 'card').pop().card.id;
    eq(card, 'k09', 'ได้ขายของออนไลน์ปังแทนไปเกาะ');
    eq(seat(room, 'a').island, 0, 'ไม่ไปเกาะ');
    eq(S(room).deck.join(','), 'k07,k01,k06', 'ใบร้ายไปท้ายกอง ไม่หาย');
    eq(skillFx(room, 'luck').length, 1, 'ป๊อปอัป');
    const r2 = makeRoom(['a', 'b'], { skills: { a: { luck: 5 } } });
    S(r2).deck = ['k06', 'k09'];
    withRng(() => rollTotal(r2, 'a', 0, [1, 2]), NEVER);
    eq(seat(r2, 'a').island, 3, 'ไม่ติด = ไปเกาะ');
    const r3 = makeRoom(['a', 'b'], { skills: { a: { luck: 5 } } });
    S(r3).deck = ['k09', 'k06'];
    let calls = 0;
    withRng(() => rollTotal(r3, 'a', 0, [1, 2]), () => { calls += 1; return 0; });
    eq(skillFx(r3, 'luck').length, 0, 'การ์ดดีไม่ต้องลุ้น');
    eq(calls, 0, 'ไม่กินเลขสุ่ม');
    // กองเหลือแต่การ์ดร้าย = ไม่ลุ้น
    const r4 = makeRoom(['a', 'b'], { skills: { a: { luck: 5 } } });
    S(r4).deck = ['k07', 'k16'];
    withRng(() => rollTotal(r4, 'a', 0, [1, 2]), ALWAYS);
    eq(skillFx(r4, 'luck').length, 0, 'ไม่มีการ์ดดีให้สลับ');
    audit(room, 'luck'); audit(r2, 'luck miss'); audit(r3, 'luck good'); audit(r4, 'luck bad only');
});

test('🏗️ ส่วนลดก่อสร้าง: ราคาซื้อ/สร้างลด % ทุกครั้ง (ปัดสิบ) · มูลค่าที่ดินเท่าเดิม · บัญชีลง', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { builder: 5 } } });
    const off = SK.valueOf('builder', 5);
    rollTotal(room, 'a', 0, [1, 1]); // มุกดาหาร 600
    eq(S(room).phase, 'build', 'แผ่นซื้อ');
    const opts = E.getAvailableActions(room, 'a');
    assert(opts.build, 'สร้างได้');
    const sheet = E.buildClientState(room, 'a').decision;
    const land = sheet.options.find(o => o.level === 0);
    eq(land.full, 600, 'ราคาเต็ม');
    eq(land.cost, Math.round(600 * (100 - off) / 100 / 10) * 10, 'ราคาหลังลด');
    const cash = seat(room, 'a').cash;
    E.buildTo(room, 'a', 1, { seq: S(room).phaseSeq });
    const expect = Math.round(600 * (100 - off) / 100 / 10) * 10 + Math.round(300 * (100 - off) / 100 / 10) * 10;
    eq(cash - seat(room, 'a').cash, expect, 'จ่ายราคาลด');
    eq(E.squareValue(room, 2), B.valueAt(2, 1), 'มูลค่ายังเต็ม (ขาย/ซื้อต่อคิดจากราคาเต็ม)');
    assert(S(room).history.some(h => h.text.includes('🏗️ ลด')), 'บันทึกบอกส่วนลด');
    assert(S(room).fx.filter(f => f.kind === 'build').pop().saved > 0, 'fx บอกที่ประหยัด');
    // คนไม่มีสกิล = เต็ม
    const r2 = makeRoom(['a', 'b'], { skills: { b: { builder: 5 } } });
    rollTotal(r2, 'a', 0, [1, 1]);
    eq(E.buildClientState(r2, 'a').decision.options.find(o => o.level === 0).cost, 600, 'a เต็มราคา');
    audit(room, 'builder'); audit(r2, 'builder none');
});

test('🎪 งานวัด: เมืองงานวัดของเรา +% · Lv5 เปิดงานใหม่ ×3 แล้วซ้อน ×6 → ×12 → ×16 · พรีวิวตรง', () => {
    const room = makeRoom(['a', 'b'], { skills: { a: { festival: 3 } } });
    give(room, 'a', [9], 2);
    give(room, 'b', [10], 2);
    const base9 = E.tollFor(room, 9);
    S(room).festival = 9; S(room).festivalMult = 2;
    eq(E.tollFor(room, 9), Math.round(base9 * 2 * (100 + SK.valueOf('festival', 3)) / 100 / 10) * 10, 'a ได้ +15%');
    const base10 = E.tollFor(room, 10);
    S(room).festival = 10;
    eq(E.tollFor(room, 10), base10 * 2, 'เมือง b ไม่ได้โบนัส');
    // Lv5 ×3
    const r2 = makeRoom(['a', 'b'], { skills: { a: { festival: 5 } } });
    give(r2, 'a', [9, 10], 2);
    eq(E.festivalStartMult(r2, seat(r2, 'a')), 3, 'Lv5 เริ่ม ×3');
    eq(E.festivalStartMult(r2, seat(r2, 'b')), 2, 'b เริ่ม ×2');
    const chain = [];
    for (let k = 0; k < 4; k += 1) {
        forceTurn(r2, 'a');
        rollTotal(r2, 'a', 14, [1, 1]); // ตกงานวัด (16)
        eq(S(r2).phase, 'pick', 'เลือกเมืองงานวัด');
        const preview = E.buildClientState(r2, 'a').decision.preview[9];
        E.pickSquare(r2, 'a', 9, { seq: S(r2).phaseSeq });
        chain.push(S(r2).festivalMult);
        eq(preview.mult, S(r2).festivalMult, 'พรีวิวตัวคูณตรง');
        eq(preview.toll, E.tollFor(r2, 9), 'พรีวิวค่าผ่านทางตรง');
        audit(r2, 'festival chain ' + k);
    }
    eq(chain.join(','), '3,6,12,16', 'ซ้อน ×3 → ×6 → ×12 → ×16');
    eq(skillFx(r2, 'festival').length, 1, 'ป๊อปอัป ×3 ตอนเปิดงานใหม่ครั้งเดียว');
    audit(room, 'festival');
});

test('ห้องปิดสกิล (setthiSkills=false): ไม่มีใครมีสกิล ไม่มีผล · ไม่โชว์ · ไม่ลุ้น', () => {
    const all = { double: 5, fly: 5, start2x: 5 };
    const room = makeRoom(['a', 'b'], { skillsOff: true, skills: { a: all } });
    eq(S(room).config.skills, false, 'config ปิด');
    eq(Object.keys(seat(room, 'a').skills).length, 0, 'ไม่ snapshot สกิล');
    eq(E.buildClientState(room, 'b').seats.find(s => s.playerId === 'a').skills.length, 0, 'ไม่โชว์');
    // ต่อให้ seat มีสกิล (เช่นข้อมูลเก่า) ห้องปิดก็ไม่มีผล
    seat(room, 'a').skills = { start2x: 5, builder: 5, festival: 5 };
    const c0 = seat(room, 'a').cash;
    let calls = 0;
    withRng(() => rollTotal(room, 'a', 30, [1, 2]), () => { calls += 1; return 0; });
    eq(seat(room, 'a').cash - c0, B.SALARY, 'ไม่ ×2');
    eq(calls, 0, 'ไม่กินเลขสุ่ม');
    eq(E.buildPrice(room, seat(room, 'a'), 9, 0), B.levelCost(9, 0), 'ไม่มีส่วนลด');
    eq(E.festivalStartMult(room, seat(room, 'a')), 2, 'งานวัด ×2');
    eq(S(room).fx.filter(f => f.kind === 'skill').length, 0, 'ไม่มีป๊อปอัป');
    audit(room, 'off');
});

test('ล็อกสกิลตอนเริ่มเกม: ตัดเกิน 3 · ตัด id มั่ว/เลเวลเกิน · แก้ของต้นทางหลังเริ่มไม่มีผล · ทุกคนเห็นสกิลคู่แข่ง', () => {
    const src = { a: { double: 9, fly: 2, nope: 5, luck: 1, escape: 3 } };
    const room = makeRoom(['a', 'b', 'bot_c'], { skills: src });
    const sk = seat(room, 'a').skills;
    eq(Object.keys(sk).length, 3, 'ไม่เกิน 3');
    eq(sk.double, 5, 'หนีบ Lv5');
    assert(!('nope' in sk), 'ตัด id มั่ว');
    src.a.double = 1; src.a.builder = 5;
    eq(seat(room, 'a').skills.double, 5, 'แก้ต้นทางแล้วในเกมไม่เปลี่ยน');
    assert(!('builder' in seat(room, 'a').skills), 'เพิ่มทีหลังไม่ได้');
    const view = E.buildClientState(room, 'b').seats.find(s => s.playerId === 'a');
    eq(view.skills.map(x => x.id + x.lv).join(','), 'double5,fly2,luck1', 'b เห็นสกิล a พร้อมเลเวล');
    eq(E.buildClientState(room, 'b').seats.find(s => s.playerId === 'bot_c').skills.length, 0, 'บอทไม่มีสกิล');
});

test('ไม่มีสกิล = ไม่กินเลขสุ่มทุกจุดลุ้น', () => {
    const room = makeRoom(['a', 'b']);
    let calls = 0;
    const counting = () => { calls += 1; return 0; };
    ['start2x', 'tollHalf', 'escape', 'double', 'fly', 'luck', 'unknown'].forEach(key => eq(E.proc(room, seat(room, 'a'), key, counting), false, key));
    eq(calls, 0, 'ไม่เรียก rng');
    const r2 = makeRoom(['a', 'b'], { skills: { a: { builder: 5, festival: 4 } } });
    ['start2x', 'tollHalf', 'escape', 'double', 'fly', 'luck'].forEach(key => E.proc(r2, seat(r2, 'a'), key, counting));
    eq(calls, 0, 'สกิลไม่สุ่ม (builder/festival) ไม่เรียก rng');
});

test('เกมสุ่ม 600 เกม (มีสกิลสุ่มบางที่นั่ง): บัญชีเงิน/กติกาถูกทุกก้าว · สกิลติดจริงทุกแบบ', () => {
    const seen = {};
    for (let g = 0; g < 600; g += 1) {
        const rng = mulberry(7000 + g);
        const n = 2 + (g % 5);
        const ids = Array.from({ length: n }, (_, k) => 'bot_' + k);
        const skills = {};
        ids.forEach((id, k) => {
            if ((g + k) % 2) return;
            const picks = SK.SKILL_IDS.slice().sort(() => rng() - 0.5).slice(0, 3);
            skills[id] = Object.fromEntries(picks.map(sid => [sid, 1 + Math.floor(rng() * 5)]));
        });
        const room = makeRoom(ids, { rng, skills });
        E.setRng(rng);
        let guard = 0;
        while (S(room).phase !== 'finished' && guard < 6000) {
            T += 900;
            if (!E.playBotTurns(room, rng, T)) E.tick(room, rng);
            const pr = E.auditState(room);
            if (pr.length) { E.setRng(null); throw new Error(`เกม ${g} ก้าว ${guard}: ${pr.join(' · ')}`); }
            guard += 1;
        }
        E.setRng(null);
        assert(S(room).phase === 'finished', `เกม ${g} ไม่จบ`);
        // fx เก็บแค่ 60 อันล่าสุด — นับจากตัวนับในที่นั่งแทน
        S(room).seats.forEach(x => Object.entries(x.skillProcs || {}).forEach(([sid, n]) => {
            seen[sid] = (seen[sid] || 0) + n;
            assert(skills[x.playerId] && skills[x.playerId][sid], 'สกิลติดเฉพาะคนที่มี');
        }));
        S(room).fx.filter(f => f.kind === 'skill').forEach(f => assert(skills[f.playerId] && skills[f.playerId][f.skill], 'ป๊อปอัปเฉพาะคนที่มีสกิล'));
    }
    ['double', 'fly', 'start2x', 'escape', 'tollShield', 'luck', 'festival'].forEach(id => assert(seen[id] > 0, 'เห็นสกิล ' + id + ' ติดในเกมสุ่ม'));
    console.log('  สกิลติดในเกมสุ่ม ' + JSON.stringify(seen));
});

(async () => {
    const started = Date.now();
    for (const t of tests) {
        try { t.fn(); } catch (error) { console.error('✗', t.name, '\n ', error.stack || error.message); process.exit(1); }
        console.log('✓', t.name);
    }
    console.log(`setthi skills: ${checks} checks ผ่านทั้งหมด (${((Date.now() - started) / 1000).toFixed(1)}s)`);
})();
