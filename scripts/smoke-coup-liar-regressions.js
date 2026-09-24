/**
 * Regression ของบั๊ก Coup / ไพ่โกหก ที่เคยยืนยันแล้ว (ไม่ต้องมีเซิร์ฟเวอร์)
 *   1. ท้าแอ็กชันแล้วแพ้ (คนสั่งมีการ์ดจริง) → เป้าหมายยังต้องได้สิทธิ์ขวาง
 *   2. คำตอบที่ส่งมาช้าข้ามเฟส (step เก่า) ต้องถูกปัดตก
 *   4. คนสั่งออกระหว่างเป้าหมายเลือกการ์ดที่จะหงาย → หนี้การ์ดยังอยู่
 *   5. ปล่อยผ่านไปแล้ว → กลับมาขวาง/ท้าทีหลังไม่ได้
 *   6. หมดเวลาตอนมี 10+ เหรียญ → ประวัติบอกว่ารัฐประหารอัตโนมัติ
 *   7. ไพ่โกหก: ทุกคนที่รอดได้ไพ่ใหม่ครบมือทุกต้นรอบ
 *
 * รัน: node scripts/smoke-coup-liar-regressions.js
 */

const coup = require('../games/coupEngine');
const liar = require('../games/liarEngine');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}
function expectThrow(fn, msg) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    assert(threw, msg);
}

function makeRoom(engine, mode, count) {
    const players = Array.from({ length: count }, (_, i) => ({
        playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '👤', permission: null
    }));
    const room = { roomId: 't', name: 'T', players, settings: { gameMode: mode }, gameState: engine.createInitialState() };
    engine.startGame(room);
    return room;
}
const P = (room, id) => room.gameState.players.find(p => p.playerId === id);
const setHand = (room, id, cards) => { P(room, id).influence = [...cards]; };

// ---------- 1a. steal: ท้าแพ้ → เป้าหมายขวางด้วย Ambassador ได้ ----------
{
    const room = makeRoom(coup, 'coup', 3);
    setHand(room, 'p0', ['captain', 'duke']);
    setHand(room, 'p1', ['contessa', 'assassin']);
    coup.submitAction(room, 'p0', 'steal', 'p1');
    coup.submitResponse(room, 'p2', 'challenge');               // p2 ท้าแล้วแพ้
    assert(room.gameState.phase === 'lose-influence', '1a: คนท้าต้องเสียการ์ดก่อน');
    coup.submitInfluenceLoss(room, 'p2', P(room, 'p2').influence[0]);
    const s = room.gameState;
    assert(s.phase === 'respond' && s.pendingAction?.blockOnly, '1a: ต้องเปิดช่วงขวางหลังท้าแพ้ ไม่ใช่ resolve ทันที');
    assert(P(room, 'p1').coins === 2 && P(room, 'p0').coins === 2, '1a: ยังไม่ควรขโมยสำเร็จ');
    const opts = coup.buildClientState(room, 'p1').availableResponses;
    assert(opts && !opts.canChallenge && opts.blockOptions.length === 2, '1a: เป้าหมายขวางได้ ท้าไม่ได้');
    assert(coup.buildClientState(room, 'p2').availableResponses === null, '1a: คนอื่นไม่มีสิทธิ์ในช่วงขวาง');
    expectThrow(() => coup.submitResponse(room, 'p1', 'challenge'), '1a: ท้าซ้ำในช่วงขวางต้องไม่ได้');
    coup.submitResponse(room, 'p1', 'block', 'ambassador');
    assert(room.gameState.phase === 'block-respond', '1a: ขวางแล้วต้องเข้า block-respond');
    coup.submitResponse(room, 'p0', 'pass');
    coup.submitResponse(room, 'p2', 'pass');
    assert(P(room, 'p1').coins === 2 && P(room, 'p0').coins === 2, '1a: ขวางสำเร็จ ต้องไม่เสียเหรียญ');
    console.log('1a. steal: ท้าแพ้แล้วเป้าหมายยังขวางได้ ✓');
}

// ---------- 1b. assassinate: เป้าหมายท้าแพ้ → ยังอ้าง Contessa ได้ ----------
{
    const room = makeRoom(coup, 'coup', 3);
    P(room, 'p0').coins = 3;
    setHand(room, 'p0', ['assassin', 'duke']);
    setHand(room, 'p1', ['contessa', 'captain']);
    coup.submitAction(room, 'p0', 'assassinate', 'p1');
    coup.submitResponse(room, 'p1', 'challenge');
    coup.submitInfluenceLoss(room, 'p1', 'captain');
    assert(room.gameState.phase === 'respond' && room.gameState.pendingAction?.blockOnly, '1b: ต้องเปิดช่วงขวาง');
    coup.submitResponse(room, 'p1', 'block', 'contessa');
    coup.submitResponse(room, 'p0', 'pass');
    coup.submitResponse(room, 'p2', 'pass');
    assert(P(room, 'p1').alive && P(room, 'p1').influence.includes('contessa'), '1b: Contessa ต้องรอด');
    console.log('1b. assassinate: ท้าแพ้แล้วยังขวางด้วย Contessa ได้ ✓');
}

// ---------- 1c. ท้าแพ้แล้วเป้าหมายตกรอบ → resolve ตามเดิม, tax ไม่มีช่วงขวาง ----------
{
    const room = makeRoom(coup, 'coup', 3);
    setHand(room, 'p0', ['duke', 'duke']);
    coup.submitAction(room, 'p0', 'tax');
    coup.submitResponse(room, 'p1', 'challenge');
    coup.submitInfluenceLoss(room, 'p1', P(room, 'p1').influence[0]);
    assert(P(room, 'p0').coins === 5 && room.gameState.currentPlayerId === 'p1', '1c: tax ไม่มีช่วงขวาง ต้องจบตาเลย');
    console.log('1c. tax (ขวางไม่ได้) ยัง resolve ทันทีหลังท้าแพ้ ✓');
}

// ---------- 2. คำตอบค้างข้ามเฟส ----------
{
    const room = makeRoom(coup, 'coup', 3);
    setHand(room, 'p0', ['captain', 'duke']);
    setHand(room, 'p1', ['captain', 'duke']);
    coup.submitAction(room, 'p0', 'steal', 'p1');
    const respondStep = room.gameState.step;
    assert(coup.buildClientState(room, 'p2').step === respondStep, '2: client ต้องเห็น step');
    coup.submitResponse(room, 'p1', 'block', 'captain', { step: respondStep, phase: 'respond', turnNumber: 1 });
    assert(room.gameState.phase === 'block-respond', '2: ต้องเข้า block-respond');
    // p2 กด "ท้า" ตอนยังเห็นแอ็กชัน — มาถึงช้า ต้องไม่ไปท้าการขวาง
    expectThrow(() => coup.submitResponse(room, 'p2', 'challenge', null,
        { step: respondStep, phase: 'respond', turnNumber: 1 }), '2: challenge ค้างเฟสต้องถูกปัด');
    expectThrow(() => coup.submitResponse(room, 'p2', 'pass', null,
        { step: respondStep, phase: 'respond', turnNumber: 1 }), '2: pass ค้างเฟสต้องถูกปัด');
    assert(room.gameState.phase === 'block-respond' && !room.gameState.responses.p2, '2: state ต้องไม่เปลี่ยน');
    coup.submitResponse(room, 'p2', 'pass', null, { step: room.gameState.step, phase: 'block-respond', turnNumber: 1 });
    assert(room.gameState.responses.p2 === 'pass', '2: คำตอบที่ step ตรงต้องผ่าน');
    console.log('2. คำตอบที่ส่งมาช้าข้ามเฟสถูกปัดตก ✓');
}

// ---------- 4. คนสั่งออกระหว่างเป้าหมายเลือกการ์ดหงาย ----------
for (const actionId of ['coup', 'assassinate']) {
    const room = makeRoom(coup, 'coup', 3);
    P(room, 'p0').coins = 7;
    setHand(room, 'p0', ['assassin', 'duke']);
    setHand(room, 'p1', ['contessa', 'captain']);
    coup.submitAction(room, 'p0', actionId, 'p1');
    if (actionId === 'assassinate') {
        coup.submitResponse(room, 'p1', 'pass');
        coup.submitResponse(room, 'p2', 'pass');
    }
    assert(room.gameState.phase === 'lose-influence' && room.gameState.pendingLoss?.playerId === 'p1', `4 ${actionId}: ต้องรอ p1 หงาย`);
    coup.handlePlayerLeft(room, 'p0');
    assert(room.gameState.phase === 'lose-influence' && room.gameState.pendingLoss?.playerId === 'p1',
        `4 ${actionId}: หนี้การ์ดต้องยังอยู่หลังคนสั่งออก`);
    coup.submitInfluenceLoss(room, 'p1', 'captain');
    assert(P(room, 'p1').influence.length === 1 && P(room, 'p1').revealed.includes('captain'), `4 ${actionId}: p1 ต้องเสียการ์ด`);
    assert(room.gameState.phase === 'action' && room.gameState.currentPlayerId === 'p1', `4 ${actionId}: เกมต้องเดินต่อ`);
}
console.log('4. คนสั่งออกกลางคัน → เป้าหมายยังต้องหงายการ์ด ✓');

// ---------- 5. ปล่อยผ่านแล้วห้ามขวาง/ท้า ----------
{
    const room = makeRoom(coup, 'coup', 3);
    setHand(room, 'p0', ['captain', 'duke']);
    coup.submitAction(room, 'p0', 'steal', 'p1');
    coup.submitResponse(room, 'p1', 'pass');
    expectThrow(() => coup.submitResponse(room, 'p1', 'block', 'captain'), '5: ผ่านแล้วขวางไม่ได้');
    expectThrow(() => coup.submitResponse(room, 'p1', 'challenge'), '5: ผ่านแล้วท้าไม่ได้');
    assert(room.gameState.phase === 'respond', '5: state ต้องไม่เปลี่ยน');

    const room2 = makeRoom(coup, 'coup', 3);
    setHand(room2, 'p0', ['captain', 'duke']);
    setHand(room2, 'p1', ['contessa', 'duke']);
    coup.submitAction(room2, 'p0', 'steal', 'p1');
    coup.submitResponse(room2, 'p1', 'block', 'captain');
    coup.submitResponse(room2, 'p2', 'pass');
    expectThrow(() => coup.submitResponse(room2, 'p2', 'challenge'), '5: ผ่านการขวางแล้วท้าทีหลังไม่ได้');
    console.log('5. ตอบไปแล้วกลับมาขวาง/ท้าไม่ได้ ✓');
}

// ---------- 6. หมดเวลาตอนมี 10+ เหรียญ ----------
{
    const room = makeRoom(coup, 'coup', 3);
    P(room, 'p0').coins = 10;
    room.gameState.phaseEndsAt = Date.now() - 1;
    coup.autoResolvePhase(room);
    const texts = room.gameState.history.map(h => h.text).join('\n');
    assert(!/รับรายได้อัตโนมัติ/.test(texts), '6: ต้องไม่บอกว่ารับรายได้');
    assert(/รัฐประหารใส่ ผู้เล่น1 อัตโนมัติ/.test(texts), '6: ต้องบอกรัฐประหารอัตโนมัติพร้อมเป้าหมาย');
    console.log('6. หมดเวลา 10+ เหรียญ → ประวัติบอกรัฐประหารอัตโนมัติ ✓');
}

// ---------- 7. ไพ่โกหก: แจกใหม่ทุกต้นรอบ ----------
for (const count of [3, 4, 5, 6, 8]) {
    const room = makeRoom(liar, 'liar', count);
    const s = room.gameState;
    const total = s.deck.length + s.players.reduce((n, p) => n + p.hand.length, 0);
    assert(s.players.every(p => p.hand.length === 5), `7 (${count}): เริ่มเกมทุกคนต้องได้ 5 ใบ`);
    const jokers = [...s.deck, ...s.players.flatMap(p => p.hand)].filter(c => c === 'JOKER').length;
    assert(jokers === (count <= 5 ? 2 : 4), `7 (${count}): จำนวนโจ๊กเกอร์ผิด`);

    for (let round = 0; round < 6 && s.phase !== 'finished'; round += 1) {
        // คนแรกลงหมดมือเท่าที่ลงได้ (สูงสุด 3 ใบ) แล้วคนถัดไปท้า
        const actor = P(room, s.currentPlayerId);
        liar.submitPlay(room, actor.playerId, actor.hand.slice(0, 3));
        if (s.phase === 'finished') break;
        liar.submitChallenge(room, s.currentPlayerId);
        if (s.phase === 'finished') break;
        const alive = s.players.filter(p => p.alive);
        assert(alive.every(p => p.hand.length === 5), `7 (${count}): ต้นรอบใหม่ทุกคนที่รอดต้องมี 5 ใบ`);
        const now = s.deck.length + (s.discard || []).length + s.players.reduce((n, p) => n + p.hand.length, 0);
        assert(now === total, `7 (${count}): จำนวนไพ่ในระบบต้องคงที่ (${now} vs ${total})`);
    }
}
console.log('7. ไพ่โกหกแจกใหม่ครบมือทุกต้นรอบ, สำรับ/โจ๊กเกอร์ถูกต้อง ✓');

console.log(`\n✅ COUP/LIAR REGRESSIONS ผ่านทั้งหมด (${passed} assertions)`);
