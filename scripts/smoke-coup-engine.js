/**
 * เทสตรรกะ Coup ล้วนๆ (ไม่ต้องมีเซิร์ฟเวอร์/เบราว์เซอร์)
 *
 * ไล่ทุกเคสของ challenge/block ซึ่งเป็นหัวใจของเกมและพลาดง่ายที่สุด:
 *   - ท้าแล้วอีกฝ่ายมีการ์ดจริง → คนท้าเสียการ์ด, คนถูกท้าจั่วใบใหม่, แอ็กชันเดินต่อ
 *   - ท้าแล้วอีกฝ่ายโกหก → คนโกหกเสียการ์ด, แอ็กชันเป็นโมฆะ, ได้เหรียญคืน
 *   - โดนขวางแล้วยอม → แอ็กชันโมฆะ แต่ "ไม่ได้เหรียญคืน"
 *   - ท้าคนขวางแล้วชนะ → การขวางโมฆะ แอ็กชันเดินต่อ
 *
 * รัน: node scripts/smoke-coup-engine.js
 */

const engine = require('../games/coupEngine');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}

function makeRoom(playerCount = 3) {
    const players = Array.from({ length: playerCount }, (_, i) => ({
        playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '👤',
        permission: i === 0 ? 'admin' : null
    }));
    const room = { roomId: 'test', name: 'CoupTest', players, settings: { gameMode: 'coup' }, gameState: engine.createInitialState() };
    engine.startGame(room);
    return room;
}

// บังคับมือของผู้เล่นให้แน่นอน เพื่อทดสอบเคสเจาะจง
function setHand(room, playerId, cards) {
    const player = room.gameState.players.find(p => p.playerId === playerId);
    player.influence = [...cards];
    return player;
}
const handOf = (room, id) => room.gameState.players.find(p => p.playerId === id);

// ---------- 1. เริ่มเกม ----------
{
    const room = makeRoom(4);
    const s = room.gameState;
    assert(s.phase === 'action', 'เริ่มเกมต้องเข้าเฟส action');
    assert(s.players.every(p => p.influence.length === 2), 'ทุกคนต้องได้การ์ด 2 ใบ');
    assert(s.players.every(p => p.coins === 2), 'ทุกคนต้องได้ 2 เหรียญ');
    assert(s.deck.length === 15 - 8, `กองกลางต้องเหลือ 7 ใบ แต่ได้ ${s.deck.length}`);
    console.log('1. เริ่มเกม: แจกการ์ด/เหรียญ/กองกลางถูกต้อง ✓');
}

// ---------- 2. Income ทำได้เลย ไม่มีใครขวางได้ ----------
{
    const room = makeRoom(3);
    engine.submitAction(room, 'p0', 'income');
    assert(handOf(room, 'p0').coins === 3, 'Income ต้องได้ 1 เหรียญ');
    assert(room.gameState.currentPlayerId === 'p1', 'ต้องเปลี่ยนตาไปคนถัดไป');
    console.log('2. Income → +1 เหรียญ จบตาทันที ✓');
}

// ---------- 3. Tax ไม่มีใครท้า → ได้ 3 เหรียญ ----------
{
    const room = makeRoom(3);
    engine.submitAction(room, 'p0', 'tax');
    assert(room.gameState.phase === 'respond', 'Tax ต้องเปิดให้ตอบโต้ก่อน');
    engine.submitResponse(room, 'p1', 'pass');
    assert(room.gameState.phase === 'respond', 'ยังต้องรอคนที่เหลือ');
    engine.submitResponse(room, 'p2', 'pass');
    assert(handOf(room, 'p0').coins === 5, 'Tax ที่ไม่มีใครท้าต้องได้ 3 เหรียญ');
    console.log('3. Tax ทุกคนปล่อยผ่าน → +3 เหรียญ ✓');
}

// ---------- 4. ท้าแล้วคนสั่ง "มีจริง" → คนท้าเสียการ์ด + แอ็กชันเดินต่อ ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['duke', 'captain']);
    setHand(room, 'p1', ['assassin', 'contessa']);
    engine.submitAction(room, 'p0', 'tax');
    engine.submitResponse(room, 'p1', 'challenge');

    assert(room.gameState.phase === 'lose-influence', 'คนท้าที่แพ้ต้องเลือกหงายการ์ด');
    assert(room.gameState.pendingLoss.playerId === 'p1', 'คนที่ต้องหงายคือคนท้า');
    engine.submitInfluenceLoss(room, 'p1', 'assassin');

    assert(handOf(room, 'p1').revealed.includes('assassin'), 'การ์ดที่หงายต้องถูกบันทึก');
    assert(handOf(room, 'p1').influence.length === 1, 'คนท้าเหลือการ์ด 1 ใบ');
    assert(handOf(room, 'p0').coins === 5, 'คนพูดจริงต้องได้ 3 เหรียญตามแอ็กชัน');
    assert(handOf(room, 'p0').influence.length === 2, 'คนพูดจริงต้องยังมี 2 ใบ (คืนแล้วจั่วใหม่)');
    console.log('4. ท้าแล้วเขามีจริง → คนท้าเสียการ์ด, แอ็กชันเดินต่อ, คนถูกท้าจั่วใหม่ ✓');
}

// ---------- 5. ท้าแล้วคนสั่ง "โกหก" → คนโกหกเสียการ์ด + คืนเหรียญ ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['captain', 'contessa']);  // ไม่มี assassin
    setHand(room, 'p1', ['duke', 'duke']);
    handOf(room, 'p0').coins = 5;                  // ลอบสังหารต้องมีอย่างน้อย 3
    const before = handOf(room, 'p0').coins;

    engine.submitAction(room, 'p0', 'assassinate', 'p1');
    assert(handOf(room, 'p0').coins === before - 3, 'ลอบสังหารต้องจ่าย 3 เหรียญก่อน');
    engine.submitResponse(room, 'p1', 'challenge');

    assert(room.gameState.pendingLoss.playerId === 'p0', 'คนโกหกต้องเป็นฝ่ายหงายการ์ด');
    engine.submitInfluenceLoss(room, 'p0', 'captain');

    assert(handOf(room, 'p0').coins === before, 'แอ็กชันล้มเพราะโดนจับโกหก ต้องได้เหรียญคืน');
    assert(handOf(room, 'p1').influence.length === 2, 'เป้าหมายต้องไม่เสียการ์ด');
    console.log('5. ท้าแล้วโกหก → คนโกหกเสียการ์ด, แอ็กชันโมฆะ, คืนเหรียญ ✓');
}

// ---------- 6. โดนขวางแล้วยอม → แอ็กชันโมฆะ และ "ไม่ได้เหรียญคืน" ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['assassin', 'duke']);
    setHand(room, 'p1', ['contessa', 'captain']);
    handOf(room, 'p0').coins = 5;
    const before = handOf(room, 'p0').coins;

    engine.submitAction(room, 'p0', 'assassinate', 'p1');
    engine.submitResponse(room, 'p1', 'block', 'contessa');
    assert(room.gameState.phase === 'block-respond', 'ต้องรอคนสั่งตัดสินใจเรื่องการขวาง');

    engine.submitResponse(room, 'p0', 'pass');
    assert(handOf(room, 'p1').influence.length === 2, 'ขวางสำเร็จ เป้าหมายไม่เสียการ์ด');
    assert(handOf(room, 'p0').coins === before - 3, 'โดนขวางแล้วไม่ได้เหรียญคืน (ตามกติกา)');
    console.log('6. Contessa ขวางลอบสังหาร แล้วยอม → ไม่เสียการ์ด แต่เหรียญไม่คืน ✓');
}

// ---------- 7. ท้าคนขวาง แล้วคนขวางโกหก → ขวางโมฆะ แอ็กชันเดินต่อ ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['assassin', 'duke']);
    setHand(room, 'p1', ['captain', 'captain']);  // ไม่มี contessa แต่แกล้งขวาง
    handOf(room, 'p0').coins = 5;

    engine.submitAction(room, 'p0', 'assassinate', 'p1');
    engine.submitResponse(room, 'p1', 'block', 'contessa');
    engine.submitResponse(room, 'p0', 'challenge');

    // p1 โกหกเรื่องขวาง → เสียการ์ด 1 ใบ แล้วโดนลอบสังหารต่อ = เสียอีกใบ = ตกรอบ
    assert(room.gameState.pendingLoss?.playerId === 'p1' || !handOf(room, 'p1').alive,
        'คนขวางที่โกหกต้องเสียการ์ด');
    if (room.gameState.pendingLoss) engine.submitInfluenceLoss(room, 'p1', 'captain');
    if (room.gameState.pendingLoss?.playerId === 'p1') engine.submitInfluenceLoss(room, 'p1', 'captain');

    assert(!handOf(room, 'p1').alive, 'โกหกเรื่องขวาง + โดนลอบสังหารต่อ = ตกรอบ');
    console.log('7. ท้าคนขวางแล้วเขาโกหก → ขวางโมฆะ แอ็กชันเดินต่อจนสำเร็จ ✓');
}

// ---------- 8. Steal ย้ายเหรียญถูกต้อง และหยิบได้เท่าที่เหลือ ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['captain', 'duke']);
    handOf(room, 'p1').coins = 1;   // เหลือเหรียญเดียว

    engine.submitAction(room, 'p0', 'steal', 'p1');
    engine.submitResponse(room, 'p1', 'pass');
    engine.submitResponse(room, 'p2', 'pass');

    assert(handOf(room, 'p1').coins === 0, 'เป้าหมายต้องเหลือ 0');
    assert(handOf(room, 'p0').coins === 3, 'ขโมยได้แค่ 1 เพราะเป้ามีเหรียญเดียว');
    console.log('8. Steal เป้าหมายมีเหรียญเดียว → ขโมยได้ 1 เท่านั้น ✓');
}

// ---------- 9. บังคับรัฐประหารเมื่อมี 10 เหรียญ ----------
{
    const room = makeRoom(3);
    handOf(room, 'p0').coins = 10;
    let blocked = false;
    try { engine.submitAction(room, 'p0', 'income'); } catch { blocked = true; }
    assert(blocked, 'มี 10 เหรียญต้องห้ามทำอย่างอื่นนอกจากรัฐประหาร');

    const actions = engine.getAvailableActions(room, 'p0');
    assert(actions.length === 1 && actions[0].id === 'coup', 'ปุ่มที่เลือกได้ต้องเหลือแค่ Coup');

    engine.submitAction(room, 'p0', 'coup', 'p1');
    assert(room.gameState.pendingLoss?.playerId === 'p1', 'รัฐประหารต้องบังคับเป้าหมายหงายการ์ดทันที');
    assert(handOf(room, 'p0').coins === 3, 'รัฐประหารต้องจ่าย 7 เหรียญ');
    console.log('9. มี 10 เหรียญ → บังคับรัฐประหาร ขวางไม่ได้ ✓');
}

// ---------- 10. Exchange เก็บการ์ดถูกจำนวน และกันเลือกการ์ดมั่ว ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['ambassador', 'duke']);
    engine.submitAction(room, 'p0', 'exchange');
    engine.submitResponse(room, 'p1', 'pass');
    engine.submitResponse(room, 'p2', 'pass');

    assert(room.gameState.phase === 'exchange', 'ต้องเข้าเฟสแลกเปลี่ยน');
    const options = room.gameState.pendingExchange.options;
    assert(options.length === 4, 'ต้องมีตัวเลือก 4 ใบ (มือ 2 + จั่ว 2)');

    let rejected = false;
    try { engine.submitExchange(room, 'p0', [options[0]]); } catch { rejected = true; }
    assert(rejected, 'เลือกไม่ครบจำนวนต้องถูกปฏิเสธ');

    // 3 คน: กองเริ่ม 15-6=9 → จั่ว 2 เหลือ 7 → คืน 2 กลับเป็น 9
    engine.submitExchange(room, 'p0', [options[0], options[1]]);
    assert(handOf(room, 'p0').influence.length === 2, 'หลังแลกเปลี่ยนต้องเหลือ 2 ใบ');
    assert(room.gameState.deck.length === 9, `ต้องคืนการ์ด 2 ใบเข้ากอง (ได้ ${room.gameState.deck.length})`);
    console.log('10. Exchange เลือกเก็บ 2 ใบ คืน 2 ใบ กันเลือกมั่ว ✓');
}

// ---------- 11. เหลือคนเดียว → จบเกม ----------
{
    const room = makeRoom(2);
    setHand(room, 'p0', ['duke', 'duke']);
    setHand(room, 'p1', ['captain']);      // เหลือใบเดียว
    handOf(room, 'p0').coins = 7;

    engine.submitAction(room, 'p0', 'coup', 'p1');
    assert(room.gameState.phase === 'finished', 'เหลือคนเดียวต้องจบเกม');
    assert(room.gameState.winner.playerId === 'p0', 'ผู้ชนะต้องเป็นคนที่รอด');
    assert(room.gameState.status === 'coup_finished', 'status ต้องเป็น coup_finished');
    console.log('11. เหลือผู้รอดคนเดียว → ประกาศผู้ชนะ ✓');
}

// ---------- 12. หมดเวลาแต่ละเฟสแล้วเกมต้องไม่ค้าง ----------
{
    const room = makeRoom(3);
    room.gameState.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(room.gameState.currentPlayerId === 'p1', 'หมดเวลาเฟส action → รับรายได้แล้วไปตาถัดไป');

    engine.submitAction(room, 'p1', 'tax');
    room.gameState.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(handOf(room, 'p1').coins === 5, 'หมดเวลาเฟส respond → ถือว่าปล่อยผ่าน');
    console.log('12. หมดเวลาทุกเฟส → เกมเดินต่อไม่ค้าง ✓');
}

// ---------- 13. คนออกกลางเกมแล้วเกมต้องไม่ค้าง ----------
{
    const room = makeRoom(3);
    engine.submitAction(room, 'p0', 'tax');   // ค้างรออยู่ที่เฟส respond
    engine.handlePlayerLeft(room, 'p1');
    assert(!handOf(room, 'p1').alive, 'คนที่ออกต้องถือว่าตกรอบ');
    assert(room.gameState.phase !== 'respond' || !room.gameState.pendingAction?.waitingFor?.includes('p1'),
        'เกมต้องไม่ค้างรอคนที่ออกไปแล้ว');
    console.log('13. คนออกกลางเกม → ไม่ค้างคิว ✓');
}

// ---------- 14. buildClientState ไม่รั่วการ์ดของคนอื่น ----------
{
    const room = makeRoom(3);
    setHand(room, 'p1', ['duke', 'assassin']);
    const view = engine.buildClientState(room, 'p0');

    assert(view.self.influence.length === 2, 'ตัวเองต้องเห็นการ์ดตัวเอง');
    const other = view.players.find(p => p.playerId === 'p1');
    assert(other.influenceCount === 2, 'ต้องเห็นแค่จำนวนการ์ดของคนอื่น');
    assert(!('influence' in other), 'ห้ามส่งการ์ดคว่ำของคนอื่นไปให้ client');

    const raw = JSON.stringify(view);
    // p1 ถือ assassin แต่ p0 ไม่ควรรู้ (ยกเว้นชื่อการ์ดใน catalog/แอ็กชันซึ่งเป็นข้อมูลสาธารณะ)
    const otherJson = JSON.stringify(other);
    assert(!otherJson.includes('assassin') && !otherJson.includes('duke'),
        'ข้อมูลผู้เล่นคนอื่นต้องไม่มีชื่อการ์ดที่ยังคว่ำอยู่');
    console.log('14. buildClientState ไม่รั่วการ์ดคว่ำของคนอื่น ✓');
}


// ---------- 15. กติกา "ใครก็ขอ Challenge ได้" — คนที่ 3 ท้าการขวางได้ ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['assassin', 'duke']);
    setHand(room, 'p1', ['captain', 'captain']);   // โกหกว่ามี contessa
    setHand(room, 'p2', ['duke', 'duke']);
    handOf(room, 'p0').coins = 5;

    engine.submitAction(room, 'p0', 'assassinate', 'p1');
    engine.submitResponse(room, 'p1', 'block', 'contessa');

    // p2 ไม่ใช่ทั้งคนสั่งและคนขวาง แต่กติกาบอกว่าท้าได้
    engine.submitResponse(room, 'p2', 'challenge');
    assert(room.gameState.pendingLoss?.playerId === 'p1' || !handOf(room, 'p1').alive,
        'คนที่ 3 ท้าการขวางแล้วคนขวางโกหก ต้องเสียการ์ด');
    console.log('15. คนที่ 3 (ไม่ใช่คนสั่ง) ท้าการขวางได้ตามกติกา ✓');
}

// ---------- 16. ทุกคนปล่อยผ่านการขวาง → การขวางสำเร็จ ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['assassin', 'duke']);
    setHand(room, 'p1', ['contessa', 'captain']);
    handOf(room, 'p0').coins = 5;
    const before = handOf(room, 'p0').coins;

    engine.submitAction(room, 'p0', 'assassinate', 'p1');
    engine.submitResponse(room, 'p1', 'block', 'contessa');
    engine.submitResponse(room, 'p0', 'pass');
    assert(room.gameState.phase === 'block-respond', 'ยังต้องรอ p2 ตอบด้วย');
    engine.submitResponse(room, 'p2', 'pass');

    assert(handOf(room, 'p1').influence.length === 2, 'ขวางสำเร็จ เป้าหมายต้องไม่เสียการ์ด');
    assert(handOf(room, 'p0').coins === before - 3, 'โดนขวางแล้วเหรียญไม่คืน');
    console.log('16. ทุกคนปล่อยผ่าน → การขวางสำเร็จ, เหรียญไม่คืน ✓');
}

// ---------- 17. เล่นสุ่มยาวๆ — การ์ดต้องคงที่ 15 ใบ และไม่มีชนิดไหนเกิน 3 ใบ ----------
{
    // ตรวจ invariant ของสำรับระหว่างเล่นจริง ไม่ยัดค่าเข้าไปเอง
    // (เดิม drawCard สร้างสำรับใหม่ทั้งชุดเมื่อกองหมด ทำให้การ์ดซ้ำกับใบที่อยู่ในมือ)
    const room = makeRoom(6);
    const census = () => {
        const s = room.gameState;
        const all = [...s.deck];
        s.players.forEach(p => all.push(...p.influence, ...p.revealed));
        if (s.pendingExchange) all.push(...s.pendingExchange.options);
        return all;
    };

    const checkDeck = where => {
        const all = census();
        assert(all.length === 15, `${where}: การ์ดรวม ${all.length} ใบ (ต้อง 15)`);
        Object.entries(all.reduce((acc, id) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {}))
            .forEach(([id, n]) => assert(n <= 3, `${where}: ${id} มี ${n} ใบ (ห้ามเกิน 3)`));
    };

    checkDeck('เริ่มเกม');

    for (let step = 0; step < 400 && room.gameState.phase !== 'finished'; step += 1) {
        const s = room.gameState;
        try {
            if (s.phase === 'lose-influence' && s.pendingLoss) {
                const p = handOf(room, s.pendingLoss.playerId);
                engine.submitInfluenceLoss(room, p.playerId, p.influence[0]);
            } else if (s.phase === 'exchange' && s.pendingExchange) {
                const ex = s.pendingExchange;
                engine.submitExchange(room, ex.playerId, ex.options.slice(0, ex.keepCount));
            } else if (s.phase === 'respond' || s.phase === 'block-respond') {
                const waiting = s.players.find(p => p.alive && !s.responses[p.playerId]
                    && p.playerId !== s.pendingAction?.actorId
                    && p.playerId !== s.pendingBlock?.blockerId);
                if (!waiting) break;
                // สลับท้า/ผ่าน เพื่อให้เจอทั้งสองกิ่งของ challenge
                engine.submitResponse(room, waiting.playerId, step % 3 === 0 ? 'challenge' : 'pass');
            } else if (s.phase === 'action') {
                const actor = handOf(room, s.currentPlayerId);
                const actions = engine.getAvailableActions(room, actor.playerId);
                const action = actions.find(a => a.id === 'exchange') || actions.find(a => a.id === 'coup') || actions[0];
                const target = s.players.find(p => p.alive && p.playerId !== actor.playerId);
                engine.submitAction(room, actor.playerId, action.id, action.needsTarget ? target?.playerId : null);
            } else {
                break;
            }
        } catch (error) {
            break;   // ท่าที่กติกาไม่ให้ทำ — ข้ามไป ไม่ใช่ความผิดของสำรับ
        }
        checkDeck('ระหว่างเล่น step ' + step);
    }

    checkDeck('จบลูป');
    console.log('17. เล่นสุ่มยาว — การ์ดคงที่ 15 ใบ ไม่มีชนิดไหนเกิน 3 ใบ ✓');
}

console.log(`\n✅ COUP ENGINE ผ่านทั้งหมด (${passed} assertions)`);
process.exit(0);
