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

// ---------- 18. UX: เมนูแอ็กชันบอกเหตุผลที่กดไม่ได้ ----------
{
    const room = makeRoom(3);
    let view = engine.buildClientState(room, 'p0');
    assert(view.actionMenu.length === 7, `เมนูต้องมีครบ 7 แอ็กชัน (ได้ ${view.actionMenu.length})`);
    const coup = view.actionMenu.find(a => a.id === 'coup');
    const assassinate = view.actionMenu.find(a => a.id === 'assassinate');
    assert(!coup.enabled && /ต้องมี 7 เหรียญ/.test(coup.reason) && /ขาดอีก 5/.test(coup.reason), 'รัฐประหารต้องล็อกพร้อมเหตุผล: ' + coup.reason);
    assert(!assassinate.enabled && /ขาดอีก 1/.test(assassinate.reason), 'ลอบสังหารต้องบอกว่าขาดอีก 1');
    assert(view.actionMenu.filter(a => a.enabled).length === 5, '2 เหรียญต้องกดได้ 5 แอ็กชัน');
    assert(view.actionMenu.filter(a => a.enabled).map(a => a.id).join() === view.availableActions.map(a => a.id).join(),
        'แอ็กชันที่กดได้ในเมนูต้องตรงกับ availableActions');
    assert(engine.buildClientState(room, 'p1').actionMenu.length === 0, 'คนที่ยังไม่ถึงตาต้องไม่มีเมนู');

    handOf(room, 'p0').coins = 10;
    view = engine.buildClientState(room, 'p0');
    const enabled = view.actionMenu.filter(a => a.enabled).map(a => a.id);
    assert(enabled.length === 1 && enabled[0] === 'coup', '10 เหรียญต้องกดได้แค่รัฐประหาร');
    assert(/ต้องรัฐประหารเท่านั้น/.test(view.actionMenu.find(a => a.id === 'income').reason), 'ปุ่มอื่นต้องบอกว่าต้องรัฐประหาร');
    assert(typeof view.serverNow === 'number' && Math.abs(view.serverNow - Date.now()) < 5000, 'state ต้องมี serverNow ไว้ชดเชยนาฬิกา');
    console.log('18. เมนูแอ็กชันครบ 7 ปุ่ม + เหตุผลที่ล็อก (เหรียญไม่พอ / ต้องรัฐประหาร) + serverNow ✓');
}

// ---------- 19. UX: ระหว่างแลกการ์ด ทูตไม่ดูเหมือนตกรอบ / จบเกมเปิดมือทุกคน ----------
{
    const room = makeRoom(3);
    setHand(room, 'p0', ['ambassador', 'duke']);
    engine.submitAction(room, 'p0', 'exchange');
    engine.submitResponse(room, 'p1', 'pass');
    engine.submitResponse(room, 'p2', 'pass');
    assert(room.gameState.phase === 'exchange', 'ทุกคนผ่านต้องเข้าเฟสแลกทันที');
    const other = engine.buildClientState(room, 'p1');
    assert(other.players.find(p => p.playerId === 'p0').influenceCount === 2, 'คนอื่นต้องเห็นทูตยังมีการ์ด 2 ใบระหว่างแลก');
    assert(other.players.every(p => p.finalHand === null), 'ระหว่างเกมห้ามเปิดมือใคร');
    const mine = engine.buildClientState(room, 'p0');
    assert(mine.pendingExchange.options.slice(0, 2).map(c => c.id).join() === 'ambassador,duke', 'ตัวเลือกสองใบแรกต้องเป็นการ์ดเดิม (UI ติดป้าย "ใบเดิม")');

    const fin = makeRoom(2);
    handOf(fin, 'p1').influence = ['duke'];
    handOf(fin, 'p0').coins = 7;
    setHand(fin, 'p0', ['captain', 'contessa']);
    engine.submitAction(fin, 'p0', 'coup', 'p1');
    assert(fin.gameState.phase === 'finished', 'รัฐประหารใบสุดท้ายต้องจบเกม');
    const end = engine.buildClientState(fin, 'p1');
    const winnerRow = end.players.find(p => p.playerId === 'p0');
    assert(winnerRow.finalHand.map(c => c.id).join() === 'captain,contessa', 'จบเกมต้องเปิดการ์ดที่เหลือของผู้ชนะ');
    console.log('19. แลกการ์ดยังนับ 2 ใบ · จบเกมเปิดมือที่เหลือให้ดูย้อนหลัง ✓');
}

// ================= rules-fidelity pass (กติกา Indie Boards & Cards) =================
function makeRoomWith(playerCount, extra = {}) {
    const players = Array.from({ length: playerCount }, (_, i) => ({
        playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '👤'
    }));
    const room = { roomId: 'r', name: 'R', players, settings: { gameMode: 'coup', ...(extra.settings || {}) }, gameState: engine.createInitialState() };
    if (extra.lastWinner) room.coupLastWinnerId = extra.lastWinner;
    engine.startGame(room);
    return room;
}
function expectThrow(fn, msg) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    assert(threw, msg);
}

// ---------- 20. เล่น 2 คน: คนเริ่มได้ 1 เหรียญ · 3 คนขึ้นไปได้ 2 ทุกคน ----------
{
    const duo = makeRoomWith(2);
    assert(duo.gameState.currentPlayerId === 'p0', '2 คน: เกมแรกคนแรกเริ่ม');
    assert(handOf(duo, 'p0').coins === 1, `2 คน: คนเริ่มต้องได้ 1 เหรียญ (ได้ ${handOf(duo, 'p0').coins})`);
    assert(handOf(duo, 'p1').coins === 2, '2 คน: อีกคนได้ 2 เหรียญ');
    assert(/1 เหรียญ/.test(duo.gameState.history[0].text), 'บันทึกเกมต้องบอกกติกา 2 คน');
    const trio = makeRoomWith(3);
    assert(trio.gameState.players.every(p => p.coins === 2), '3 คน: ทุกคนได้ 2 เหรียญ');
    // 2 คนเริ่มด้วย 1 เหรียญ → ยังไม่พอลอบสังหาร
    expectThrow(() => engine.submitAction(duo, 'p0', 'assassinate', 'p1'), '2 คน: 1 เหรียญลอบสังหารไม่ได้');
    console.log('20. เล่น 2 คน คนเริ่มได้ 1 เหรียญ · 3 คนขึ้นไปได้ 2 ✓');
}

// ---------- 21. ผู้ชนะเกมที่แล้วเริ่มก่อน ----------
{
    const room = makeRoomWith(3);
    handOf(room, 'p1').influence = ['duke'];
    handOf(room, 'p2').influence = ['duke'];
    handOf(room, 'p0').coins = 7;
    engine.submitAction(room, 'p0', 'coup', 'p1');
    // p1 ตก → ตา p2
    handOf(room, 'p2').coins = 7;
    engine.submitAction(room, 'p2', 'coup', 'p0');
    engine.submitInfluenceLoss(room, 'p0', handOf(room, 'p0').influence[0]);
    // ตา p0 อีกรอบ
    engine.submitAction(room, 'p0', 'income');
    handOf(room, 'p2').coins = 7;
    engine.submitAction(room, 'p2', 'coup', 'p0');
    assert(room.gameState.phase === 'finished' && room.gameState.winner.playerId === 'p2', 'p2 ต้องชนะ');
    assert(room.coupLastWinnerId === 'p2', 'ห้องต้องจำผู้ชนะไว้');
    engine.startGame(room);
    assert(room.gameState.currentPlayerId === 'p2', 'เกมต่อไปผู้ชนะต้องเริ่มก่อน');
    assert(room.gameState.players.every(p => p.coins === 2), '3 คนทุกคน 2 เหรียญแม้ผู้ชนะเริ่ม');
    // ผู้ชนะออกจากห้องไปแล้ว → กลับไปคนแรก
    const gone = makeRoomWith(3, { lastWinner: 'ghost' });
    assert(gone.gameState.currentPlayerId === 'p0', 'ผู้ชนะไม่อยู่แล้ว → คนแรกเริ่ม');
    const duo = makeRoomWith(2, { lastWinner: 'p1' });
    assert(duo.gameState.currentPlayerId === 'p1' && handOf(duo, 'p1').coins === 1 && handOf(duo, 'p0').coins === 2,
        '2 คน: ผู้ชนะเริ่มก่อนและได้ 1 เหรียญ');
    console.log('21. ผู้ชนะเกมที่แล้วเริ่มก่อน (ไม่อยู่แล้ว → คนแรก) ✓');
}

// ---------- 22. ตกรอบแล้วเหรียญคืนคลัง · นักฆ่าโกหกที่ตกรอบไม่ได้เหรียญคืน ----------
{
    const room = makeRoomWith(3);
    handOf(room, 'p1').influence = ['duke'];
    handOf(room, 'p1').coins = 6;
    handOf(room, 'p0').coins = 7;
    engine.submitAction(room, 'p0', 'coup', 'p1');
    assert(!handOf(room, 'p1').alive && handOf(room, 'p1').coins === 0, 'ตกรอบแล้วเหรียญต้องคืนคลัง (0)');

    const liar = makeRoomWith(3);
    setHand(liar, 'p0', ['duke']);                    // เหลือใบเดียว และไม่มีนักฆ่า
    handOf(liar, 'p0').coins = 5;
    engine.submitAction(liar, 'p0', 'assassinate', 'p1');
    engine.submitResponse(liar, 'p1', 'challenge');
    assert(!handOf(liar, 'p0').alive, 'นักฆ่าโกหกใบสุดท้ายต้องตกรอบ');
    assert(handOf(liar, 'p0').coins === 0, `คนตกรอบต้องไม่ได้เหรียญคืนค้างไว้ (ได้ ${handOf(liar, 'p0').coins})`);
    assert(liar.gameState.currentPlayerId === 'p1' && liar.gameState.phase === 'action', 'เกมเดินต่อไปตาถัดไป');

    const refund = makeRoomWith(3);
    setHand(refund, 'p0', ['duke', 'captain']);
    handOf(refund, 'p0').coins = 5;
    engine.submitAction(refund, 'p0', 'assassinate', 'p1');
    assert(handOf(refund, 'p0').coins === 2, 'ประกาศลอบสังหาร จ่าย 3 ทันที');
    engine.submitResponse(refund, 'p2', 'challenge');      // คนที่ไม่ใช่เป้าก็ท้าได้
    engine.submitInfluenceLoss(refund, 'p0', 'captain');
    assert(handOf(refund, 'p0').coins === 5, 'นักฆ่าโกหกแล้วโดนจับ (ยังรอด) ได้ 3 เหรียญคืน');
    assert(handOf(refund, 'p1').influence.length === 2, 'เป้าหมายไม่เสียการ์ด');
    console.log('22. ตกรอบเหรียญคืนคลัง · โดนจับโกหกได้เหรียญคืน (ถ้ายังรอด) ✓');
}

// ---------- 23. ขโมยจากคนที่มี 0 เหรียญ ----------
{
    const room = makeRoomWith(3);
    handOf(room, 'p1').coins = 0;
    engine.submitAction(room, 'p0', 'steal', 'p1');
    engine.submitResponse(room, 'p1', 'pass');
    engine.submitResponse(room, 'p2', 'pass');
    assert(handOf(room, 'p0').coins === 2 && handOf(room, 'p1').coins === 0, 'ขโมยจากคน 0 เหรียญ = ได้ 0 ไม่ติดลบ');
    assert(room.gameState.currentPlayerId === 'p1', 'จบตาตามปกติ');
    console.log('23. ขโมยจากคน 0 เหรียญ ได้ 0 ไม่ติดลบ ✓');
}

// ---------- 24. แลกเปลี่ยนจั่ว 2 ใบเสมอ (มี 1 ใบ → เลือก 1 จาก 3) ----------
{
    const room = makeRoomWith(3);
    setHand(room, 'p0', ['ambassador']);
    handOf(room, 'p0').revealed = ['duke'];
    // ให้สำรับนับครบ 15: เอา duke 1 ใบออกจากกอง (หงายแล้ว)
    const di = room.gameState.deck.indexOf('duke');
    if (di >= 0) room.gameState.deck.splice(di, 1);
    engine.submitAction(room, 'p0', 'exchange');
    engine.submitResponse(room, 'p1', 'pass');
    engine.submitResponse(room, 'p2', 'pass');
    const ex = room.gameState.pendingExchange;
    assert(ex && ex.options.length === 3 && ex.keepCount === 1, `มี 1 ใบต้องเห็น 3 ตัวเลือก เก็บ 1 (ได้ ${ex && ex.options.length}/${ex && ex.keepCount})`);
    expectThrow(() => engine.submitExchange(room, 'p0', ex.options.slice(0, 2)), 'เก็บเกินจำนวนต้องไม่ได้');
    engine.submitExchange(room, 'p0', [ex.options[2]]);
    assert(handOf(room, 'p0').influence.length === 1, 'หลังแลกยังมี 1 ใบ');
    console.log('24. แลกเปลี่ยน: จั่ว 2 ใบ · มี 1 ใบเลือกเก็บ 1 จาก 3 ✓');
}

// ---------- 25. เสีย 2 ใบในตาเดียว (ท้านักฆ่าแล้วแพ้ / อ้างท่านหญิงแล้วโดนจับ) ----------
{
    const a = makeRoomWith(3);
    setHand(a, 'p0', ['assassin', 'duke']);
    setHand(a, 'p1', ['captain', 'duke']);
    handOf(a, 'p0').coins = 3;
    engine.submitAction(a, 'p0', 'assassinate', 'p1');
    engine.submitResponse(a, 'p1', 'challenge');             // แพ้ — นักฆ่ามีจริง
    engine.submitInfluenceLoss(a, 'p1', 'captain');
    assert(a.gameState.phase === 'respond' && a.gameState.pendingAction.blockOnly, 'ท้าแพ้แล้วเป้ายังขวางได้');
    engine.submitResponse(a, 'p1', 'pass');                  // ไม่ขวาง
    assert(!handOf(a, 'p1').alive && handOf(a, 'p1').revealed.length === 2, 'ท้านักฆ่าแพ้ + โดนลอบสังหาร = เสีย 2 ใบในตาเดียว');
    assert(handOf(a, 'p0').coins === 0, 'นักฆ่าพูดจริง เหรียญไม่คืน');

    const b = makeRoomWith(3);
    setHand(b, 'p0', ['assassin', 'duke']);
    setHand(b, 'p1', ['captain', 'duke']);
    handOf(b, 'p0').coins = 3;
    engine.submitAction(b, 'p0', 'assassinate', 'p1');
    engine.submitResponse(b, 'p1', 'block', 'contessa');     // บลัฟท่านหญิง
    engine.submitResponse(b, 'p2', 'challenge');             // คนนอกท้าการขวาง
    engine.submitInfluenceLoss(b, 'p1', 'captain');
    assert(!handOf(b, 'p1').alive, 'อ้างท่านหญิงแล้วโดนจับ + โดนลอบสังหาร = ตกรอบ');
    assert(b.gameState.currentPlayerId === 'p2', 'จบตาไปคนถัดไปที่ยังอยู่');
    console.log('25. เสีย 2 ใบในตาเดียวได้ทั้งสองทาง ✓');
}

// ---------- 26. คนออฟไลน์ช่วงท้า/ขวาง = ปล่อยผ่านทันที ----------
{
    const room = makeRoomWith(3);
    engine.submitAction(room, 'p0', 'tax');
    assert(engine.autoPassOffline(room, []) === false, 'ไม่มีคนออฟไลน์ = ไม่เปลี่ยนอะไร');
    assert(engine.autoPassOffline(room, ['p0']) === false, 'คนสั่งออฟไลน์ไม่ใช่คนที่ต้องตอบ');
    assert(engine.autoPassOffline(room, ['p2']) === true, 'p2 ออฟไลน์ต้องถูกนับว่าผ่าน');
    assert(room.gameState.phase === 'respond' && room.gameState.responses.p2 === 'pass', 'ยังรอ p1 อยู่');
    assert(/ออฟไลน์/.test(room.gameState.history[0].text), 'บันทึกเกมต้องบอกว่าออฟไลน์ถือว่าผ่าน');
    expectThrow(() => engine.submitResponse(room, 'p2', 'challenge'), 'ถูกนับผ่านแล้วกลับมาท้าไม่ได้');
    engine.submitResponse(room, 'p1', 'pass');
    assert(handOf(room, 'p0').coins === 5 && room.gameState.currentPlayerId === 'p1', 'ทุกคนผ่าน → เก็บภาษีสำเร็จ');

    // ทุกคนที่ต้องตอบออฟไลน์ → resolve เลย
    const all = makeRoomWith(3);
    engine.submitAction(all, 'p0', 'foreign_aid');
    engine.autoPassOffline(all, ['p1', 'p2']);
    assert(handOf(all, 'p0').coins === 4 && all.gameState.phase === 'action', 'ออฟไลน์หมด → เงินช่วยเหลือสำเร็จทันที');

    // ช่วง block-respond: คนโดนขวางออฟไลน์ = ยอมรับการขวาง
    const blk = makeRoomWith(3);
    engine.submitAction(blk, 'p0', 'foreign_aid');
    engine.submitResponse(blk, 'p1', 'block', 'duke');
    engine.autoPassOffline(blk, ['p0']);
    assert(blk.gameState.phase === 'block-respond', 'ยังรอ p2 ตัดสินใจท้าการขวาง');
    engine.autoPassOffline(blk, ['p2']);
    assert(blk.gameState.phase === 'action' && handOf(blk, 'p0').coins === 2 && blk.gameState.currentPlayerId === 'p1',
        'ออฟไลน์หมด → ขวางสำเร็จ ไม่ได้เงิน');

    // ช่วงอื่นไม่ยุ่ง
    const act = makeRoomWith(3);
    assert(engine.autoPassOffline(act, ['p0', 'p1', 'p2']) === false && act.gameState.phase === 'action', 'ช่วงเลือกแอ็กชันไม่ auto-pass');
    console.log('26. ออฟไลน์ช่วงท้า/ขวาง = ปล่อยผ่านทันที (respond / block-respond) ✓');
}

// ---------- 27. หัวห้องตั้งเวลาเลือกแอ็กชันได้ ----------
{
    assert(engine.sanitizeActionSeconds(30) === 30 && engine.sanitizeActionSeconds('90') === 90, 'รับค่า 30/90');
    assert(engine.sanitizeActionSeconds(5) === 60 && engine.sanitizeActionSeconds('x') === 60 && engine.sanitizeActionSeconds(undefined) === 60, 'ค่าแปลก → 60');
    if (!process.env.COUP_ACTION_MS) {
        const fast = makeRoomWith(3, { settings: { coupActionSeconds: 30 } });
        const left = fast.gameState.phaseEndsAt - Date.now();
        assert(left > 28000 && left <= 30000, `ตั้ง 30 วิ ต้องหมดใน ~30 วิ (เหลือ ${left})`);
        engine.submitAction(fast, 'p0', 'income');
        const left2 = fast.gameState.phaseEndsAt - Date.now();
        assert(left2 > 28000 && left2 <= 30000, 'ตาถัดไปก็ใช้ 30 วิ');
        const def = makeRoomWith(3);
        const left3 = def.gameState.phaseEndsAt - Date.now();
        assert(left3 > 58000 && left3 <= 60000, 'ค่าเริ่มต้น 60 วิ');
        const bad = makeRoomWith(3, { settings: { coupActionSeconds: 3 } });
        assert(bad.gameState.phaseEndsAt - Date.now() > 58000, 'ค่าผิดใน settings → 60 วิ');
    }
    console.log('27. เวลาเลือกแอ็กชัน 30/60/90 วิ ตั้งได้ ค่าเริ่ม 60 ✓');
}

// ---------- 28. สุ่มเล่นยาว 2–6 คน: invariant ของเหรียญ/การ์ด/ตกรอบ ----------
{
    for (let game = 0; game < 120; game += 1) {
        const n = 2 + (game % 5);
        const room = makeRoomWith(n);
        const s0 = room.gameState;
        assert(s0.players.filter(p => p.coins === 1).length === (n === 2 ? 1 : 0), 'เหรียญเริ่มต้นตามจำนวนคน');
        for (let step = 0; step < 600 && room.gameState.phase !== 'finished'; step += 1) {
            const s = room.gameState;
            try {
                if (s.phase === 'lose-influence') {
                    const p = handOf(room, s.pendingLoss.playerId);
                    engine.submitInfluenceLoss(room, p.playerId, p.influence[Math.floor(Math.random() * p.influence.length)]);
                } else if (s.phase === 'exchange') {
                    const ex = s.pendingExchange;
                    engine.submitExchange(room, ex.playerId, ex.options.slice(-ex.keepCount));
                } else if (s.phase === 'respond' || s.phase === 'block-respond') {
                    const waiting = s.phase === 'respond' ? s.pendingAction && engine.buildClientState(room, 'x').pendingAction.waitingFor
                        : engine.buildClientState(room, 'x').pendingBlock.waitingFor;
                    const who = waiting[0];
                    const r = Math.random();
                    if (Math.random() < 0.15) { engine.autoPassOffline(room, [who]); continue; }
                    const opts = engine.buildClientState(room, who).availableResponses;
                    if (opts?.blockOptions?.length && r < 0.3) engine.submitResponse(room, who, 'block', opts.blockOptions[0].id);
                    else if (opts?.canChallenge && r < 0.55) engine.submitResponse(room, who, 'challenge');
                    else engine.submitResponse(room, who, 'pass');
                } else if (s.phase === 'action') {
                    const acts = engine.getAvailableActions(room, s.currentPlayerId);
                    const a = acts[Math.floor(Math.random() * acts.length)];
                    const targets = s.players.filter(p => p.alive && p.playerId !== s.currentPlayerId);
                    const t = targets[Math.floor(Math.random() * targets.length)];
                    engine.submitAction(room, s.currentPlayerId, a.id, a.needsTarget ? t.playerId : null);
                }
            } catch (error) {
                throw new Error(`game ${game} step ${step} phase ${s.phase}: ${error.message}`);
            }
            const st = room.gameState;
            st.players.forEach(p => {
                if (p.coins < 0) throw new Error('เหรียญติดลบ');
                if (!p.alive && p.coins !== 0) throw new Error('คนตกรอบยังถือเหรียญ');
                if (p.alive && p.influence.length === 0 && st.pendingExchange?.playerId !== p.playerId) throw new Error('ยังรอดแต่ไม่มีการ์ด');
                if (p.influence.length + p.revealed.length > 2 && st.pendingExchange?.playerId !== p.playerId) throw new Error('การ์ดเกิน 2 ใบ');
            });
            if (st.phase === 'action') {
                const cur = handOf(room, st.currentPlayerId);
                if (!cur.alive) throw new Error('ตาของคนที่ตกรอบไปแล้ว');
            }
        }
        assert(room.gameState.phase === 'finished', `เกมสุ่ม ${n} คนต้องจบได้ (phase=${room.gameState.phase})`);
        assert(room.gameState.players.filter(p => p.alive).length === 1, 'จบเกมเหลือผู้รอด 1 คน');
    }
    console.log('28. สุ่มเล่น 120 เกม (2–6 คน) — เหรียญไม่ติดลบ คนตกรอบไม่มีเหรียญ จบเกมได้ ✓');
}

// ---------- 29. ออกกลางเกมแบบ roomManager (ตัดจาก players ก่อนเรียก handlePlayerLeft) ----------
{
    // เลียนแบบ roomManager.leaveRoom: เก็บ snapshot แล้ว splice ออกจาก gameState.players
    const removeLikeRoomManager = (room, id) => {
        const i = room.gameState.players.findIndex(p => p.playerId === id);
        room.rejoinableGamePlayers = room.rejoinableGamePlayers || new Map();
        room.rejoinableGamePlayers.set(id, { ...room.gameState.players[i] });
        room.gameState.players.splice(i, 1);
        engine.handlePlayerLeft(room, id);
    };
    // ก) คนที่ถึงตาออก → ตาไปที่นั่งถัดไป (ไม่ใช่กลับไปคนแรก)
    const a = makeRoomWith(4);
    engine.submitAction(a, 'p0', 'income');
    engine.submitAction(a, 'p1', 'income');                 // ตา p2
    removeLikeRoomManager(a, 'p2');
    assert(a.gameState.currentPlayerId === 'p3', `คนถึงตาออก → ต้องเป็นตา p3 (ได้ ${a.gameState.currentPlayerId})`);
    assert(/ออกจากเกม/.test(a.gameState.history[0].text), 'บันทึกเกมต้องบอกว่ามีคนออก');
    const snap = a.rejoinableGamePlayers.get('p2');
    assert(snap.alive === false && snap.influence.length === 0 && snap.coins === 0, 'snapshot ของคนออกต้องเป็นคนตกรอบ (กลับมาแล้วไม่ได้การ์ดคืน)');
    engine.submitAction(a, 'p3', 'income');
    assert(a.gameState.currentPlayerId === 'p0', 'วนต่อตามที่นั่งเดิม');

    // ข) ออกระหว่างแลกการ์ด → การ์ดคืนกอง เกมเดินต่อ ไม่ค้าง timer
    const b = makeRoomWith(3);
    engine.submitAction(b, 'p0', 'exchange');
    engine.submitResponse(b, 'p1', 'pass');
    engine.submitResponse(b, 'p2', 'pass');
    assert(b.gameState.phase === 'exchange', 'เข้าเฟสแลก');
    removeLikeRoomManager(b, 'p0');
    assert(b.gameState.phase === 'action' && b.gameState.currentPlayerId === 'p1' && !b.gameState.pendingExchange, 'ทูตออกระหว่างแลก → ไปตา p1');
    const census = [...b.gameState.deck]; b.gameState.players.forEach(p => census.push(...p.influence, ...p.revealed));
    assert(census.length === 15, `การ์ดต้องครบ 15 ใบ (ได้ ${census.length})`);

    // ค) คนที่ต้องตอบออก → ถ้าที่เหลือตอบครบแล้ว ไปต่อเลย
    const c = makeRoomWith(3);
    engine.submitAction(c, 'p0', 'tax');
    engine.submitResponse(c, 'p1', 'pass');
    removeLikeRoomManager(c, 'p2');
    assert(handOf(c, 'p0').coins === 5 && c.gameState.phase === 'action', 'คนสุดท้ายที่ต้องตอบออก → เก็บภาษีสำเร็จ');

    // ง) คนขวางออกระหว่างรอท้าการขวาง → การขวางเป็นโมฆะ แอ็กชันเดินต่อ
    const d = makeRoomWith(3);
    engine.submitAction(d, 'p0', 'foreign_aid');
    engine.submitResponse(d, 'p2', 'block', 'duke');
    removeLikeRoomManager(d, 'p2');
    assert(handOf(d, 'p0').coins === 4 && d.gameState.phase === 'action', 'คนขวางออก → เงินช่วยเหลือสำเร็จ');

    // จ) ต้องหงายการ์ดแล้วออก → เกมเดินต่อ · เหลือคนเดียว = จบ
    const e = makeRoomWith(2);
    handOf(e, 'p0').coins = 7;
    engine.submitAction(e, 'p0', 'coup', 'p1');
    assert(e.gameState.phase === 'lose-influence', 'p1 ต้องเลือกหงาย');
    removeLikeRoomManager(e, 'p1');
    assert(e.gameState.phase === 'finished' && e.gameState.winner.playerId === 'p0', 'เหลือคนเดียว → จบเกม p0 ชนะ');
    console.log('29. ออกกลางเกม (ถูกตัดจาก players ก่อน): ตาวนตามที่นั่ง · แลก/ตอบ/ขวาง/หงายไม่ค้าง ✓');
}

console.log(`\n✅ COUP ENGINE ผ่านทั้งหมด (${passed} assertions)`);
process.exit(0);
