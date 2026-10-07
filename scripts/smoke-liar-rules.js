/**
 * กติกาไพ่โกหกตาม Liar's Deck (Liar's Bar) — เทส engine ไม่ต้องมีเซิร์ฟเวอร์
 * สำรับ 20 ใบ · ไพ่บนโต๊ะสุ่มซ้ำได้ · ปืนลูกโม่ 6 ช่อง · มือว่างข้ามตา · คนสุดท้ายที่มีไพ่ต้องท้า
 * คนเริ่มรอบใหม่ · ไพ่ปีศาจ · คนออกกลางเกม (ผ่านลำดับเดียวกับ roomManager.leaveRoom)
 *
 * รัน: node scripts/smoke-liar-rules.js
 */

const engine = require('../games/liarEngine');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}
function expectThrow(fn, pattern, msg) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error && (!pattern || pattern.test(error.message)), msg + (error ? ` (${error.message})` : ' (ไม่ throw)'));
}

function makeRoom(count = 4, settings = {}) {
    const players = Array.from({ length: count }, (_, i) => ({
        playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '👤', permission: i === 0 ? 'admin' : null
    }));
    const room = {
        roomId: 'rules', name: 'Rules', players,
        settings: { gameMode: 'liar', ...settings },
        gameState: engine.createInitialState(),
        rejoinableGamePlayers: new Map()
    };
    engine.startGame(room);
    return room;
}
const P = (room, id) => room.gameState.players.find(p => p.playerId === id);
const fakeOf = rank => engine.RANKS.find(r => r !== rank);
function setTurn(room, id) {
    const s = room.gameState;
    s.currentPlayerId = id;
    s.phase = 'turn';
    s.phaseEndsAt = Date.now() + 60000;
    s.forcedCall = false;
}
function allCards(room) {
    const s = room.gameState;
    return [...s.deck, ...(s.discard || []), ...s.players.flatMap(p => p.hand), ...((s.lastPlay && s.lastPlay.cards) || [])];
}
const count = (cards, id) => cards.filter(c => c === id).length;
// จำลองลำดับเดียวกับ roomManager.leaveRoom: เก็บ snapshot แล้วลบออกจาก gameState.players ก่อน engine เห็น
function leaveLikeRoomManager(room, id) {
    const s = room.gameState;
    const idx = s.players.findIndex(p => p.playerId === id);
    room.rejoinableGamePlayers.set(id, { ...s.players[idx], socketId: null });
    s.players.splice(idx, 1);
    room.players = room.players.filter(p => p.playerId !== id);
    return engine.handlePlayerLeft(room, id);
}

// ---------- 1. สำรับ ----------
for (const n of [3, 4]) {
    const room = makeRoom(n);
    const cards = allCards(room);
    assert(cards.length === 20, `1 (${n} คน): สำรับต้อง 20 ใบ (ได้ ${cards.length})`);
    engine.RANKS.forEach(r => assert(count(cards, r) === 6, `1 (${n} คน): ${r} ต้อง 6 ใบ`));
    assert(count(cards, 'JOKER') === 2, `1 (${n} คน): โจ๊กเกอร์ต้อง 2 ใบ`);
    assert(room.gameState.players.every(p => p.hand.length === 5), `1 (${n} คน): คนละ 5 ใบ`);
}
for (const n of [5, 6, 7, 8]) {
    const room = makeRoom(n);
    const cards = allCards(room);
    assert(cards.length === 40, `1 (${n} คน): 2 สำรับ = 40 ใบ`);
    engine.RANKS.forEach(r => assert(count(cards, r) === 12, `1 (${n} คน): ${r} ต้อง 12 ใบ`));
    assert(count(cards, 'JOKER') === 4, `1 (${n} คน): โจ๊กเกอร์ 4 ใบ`);
    assert(room.gameState.players.every(p => p.hand.length === 5), `1 (${n} คน): คนละ 5 ใบ`);
}
console.log('1. สำรับ 20 ใบ (6/6/6 + โจ๊กเกอร์ 2) · 5–8 คนใช้ 2 สำรับ · คนละ 5 ใบ ✓');

// ---------- 2. ไพ่บนโต๊ะสุ่มทุกรอบ ซ้ำได้ ----------
{
    const room = makeRoom(4, { liarPunishment: 'lives' });
    const seen = new Set();
    let repeats = 0;
    let prev = room.gameState.targetRank;
    for (let i = 0; i < 120; i += 1) {
        room.gameState.players.forEach(p => { p.lives = 99; });
        const actor = P(room, room.gameState.currentPlayerId);
        engine.submitPlay(room, actor.playerId, [actor.hand[0]]);
        engine.submitChallenge(room, room.gameState.currentPlayerId);
        const t = room.gameState.targetRank;
        seen.add(t);
        if (t === prev) repeats += 1;
        prev = t;
        assert(room.gameState.players.every(p => p.hand.length === 5), '2: ทุกรอบแจกใหม่ครบ 5 ใบ');
        assert(allCards(room).length === 20, '2: ทุกรอบสับใหม่ทั้งสำรับ 20 ใบ');
    }
    assert(seen.size === 3, '2: ต้องเจอทั้ง A K Q');
    assert(repeats > 0, '2: เกมจริงสับกองไพ่บนโต๊ะใหม่ทุกรอบ — ต้องได้ชนิดเดิมซ้ำได้');
}
console.log('2. ไพ่บนโต๊ะสุ่มใหม่ทุกรอบ (ซ้ำได้) · สับแจกใหม่ทุกรอบ ✓');

// ---------- 3. ปืนลูกโม่ (ค่าเริ่มต้น) ----------
{
    const room = makeRoom(4);
    const s = room.gameState;
    assert(s.punishment === 'revolver', '3: ไม่ตั้งค่า = ปืนลูกโม่ (กติกาจริง)');
    assert(s.players.every(p => p.shots === 0 && p.bullet >= 1 && p.bullet <= 6), '3: ทุกคนมีปืน 6 ช่อง กระสุน 1 นัด');
    const view = engine.buildClientState(room, 'p1');
    assert(view.punishment === 'revolver' && view.chambers === 6, '3: client รู้ว่าเป็นโหมดปืน 6 ช่อง');
    assert(!/bullet/.test(JSON.stringify(view)), '3: ห้ามส่งช่องกระสุนให้ client');
    assert(view.players.every(p => p.shots === 0), '3: client เห็นจำนวนนัดที่ยิงไปแล้ว');

    // คนโกหกโดนจับ 2 ครั้งรอด ครั้งที่ 3 ตาย (กระสุนอยู่ช่อง 3) · นัดสะสมข้ามรอบ
    const liar = P(room, 'p0');
    liar.bullet = 3;
    for (let shot = 1; shot <= 3; shot += 1) {
        const t = s.targetRank;
        liar.hand = [fakeOf(t), fakeOf(t), fakeOf(t), fakeOf(t), fakeOf(t)];
        setTurn(room, 'p0');
        engine.submitPlay(room, 'p0', [fakeOf(t)]);
        assert(s.currentPlayerId === 'p1', '3: คนถัดไปได้ตาท้า');
        engine.submitChallenge(room, 'p1');
        assert(liar.shots === shot, `3: ยิงไปแล้ว ${shot} นัด`);
        if (shot < 3) {
            assert(liar.alive, `3: นัดที่ ${shot} ยังรอด`);
            const text = s.history.map(h => h.text).join('\n');
            assert(/แชะ/.test(text) && new RegExp(`1 ใน ${6 - shot}`).test(text), `3: ประวัติบอกว่ารอดและโอกาสนัดหน้า 1/${6 - shot}`);
            const fx = s.fx.filter(f => f.kind === 'reveal' && f.results).pop();
            assert(fx.results[0].playerId === 'p0' && fx.results[0].died === false && fx.results[0].shots === shot, '3: fx บอกผลลั่นไก');
        } else {
            assert(!liar.alive, '3: นัดที่ 3 = กระสุน → ตกรอบ');
            assert(/ปัง/.test(s.history.map(h => h.text).join('\n')), '3: ประวัติบอก ปัง!');
            assert(s.eliminations.some(e => e.playerId === 'p0' && e.reason === 'caught'), '3: ตกรอบเพราะโดนจับโกหก');
        }
    }
    // ช่องกระสุนสุ่ม 1–6 เท่า ๆ กัน (ไม่หมุนใหม่ระหว่างเกม)
    const hits = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 1200; i += 1) hits[makeRoom(3).gameState.players[0].bullet] += 1;
    for (let c = 1; c <= 6; c += 1) assert(hits[c] > 120, `3: ช่อง ${c} ต้องสุ่มได้ (${hits[c]}/1200)`);
}
{
    const room = makeRoom(3, { liarPunishment: 'lives' });
    assert(room.gameState.punishment === 'lives', '3b: ตั้งห้อง = หัวใจ 3 ดวง');
    assert(room.gameState.players.every(p => p.lives === 3), '3b: คนละ 3 ดวง');
    assert(engine.buildClientState(room, 'p0').maxLives === 3, '3b: client วาดหัวใจ 3 ดวง');
    assert(engine.sanitizePunishment('xx') === 'revolver' && engine.sanitizePunishment('lives') === 'lives', '3b: sanitize punishment');
    assert(engine.sanitizeDevil(true) === true && engine.sanitizeDevil('true') === false && engine.sanitizeDevil(undefined) === false, '3b: sanitize devil');
}
console.log('3. ปืนลูกโม่ 6 ช่อง กระสุน 1 นัด ช่องเลื่อนทุกนัด (ค่าเริ่มต้น) · หัวใจ 3 ดวงเป็นตัวเลือก ✓');

// ---------- 4. มือว่างข้ามตา · คนสุดท้ายที่มีไพ่ต้องท้า ----------
{
    const room = makeRoom(4);
    const s = room.gameState;
    P(room, 'p1').hand = [];
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [P(room, 'p0').hand[0]]);
    assert(s.currentPlayerId === 'p2', '4: มือว่างถูกข้าม — ตาไป p2 ไม่ใช่ p1');
    assert(!s.forcedCall, '4: ยังมีคนอื่นมีไพ่ — ไม่บังคับท้า');
    const a = engine.buildClientState(room, 'p2').availableActions;
    assert(a.canPlay && a.canChallenge, '4: ลงต่อหรือท้าได้');
}
{
    const room = makeRoom(3);
    const s = room.gameState;
    const t = s.targetRank;
    P(room, 'p0').hand = [t];
    P(room, 'p1').hand = [];
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [t]);
    assert(s.currentPlayerId === 'p2', '4b: ข้าม p1 ที่มือว่าง');
    assert(s.forcedCall === true, '4b: เหลือ p2 คนเดียวที่มีไพ่ = ต้องท้า');
    const a = engine.buildClientState(room, 'p2').availableActions;
    assert(!a.canPlay && a.canChallenge && a.forcedCall, '4b: client ซ่อนปุ่มลงไพ่ เหลือแต่โกหก!');
    expectThrow(() => engine.submitPlay(room, 'p2', [P(room, 'p2').hand[0]]), /ต้องกดโกหก/, '4b: ส่งลงไพ่มาก็ไม่รับ');
    s.phaseEndsAt = Date.now() - 1;
    const round = s.roundNumber;
    engine.autoResolvePhase(room);
    assert(s.roundNumber === round + 1 && s.lastReveal && s.lastReveal.challengerId === 'p2', '4b: หมดเวลา = ท้าให้อัตโนมัติ');
}
{
    // ลงจนมือว่างทั้งวง: ไม่มีใครค้าง ไม่มีการแจกกลางรอบ
    const room = makeRoom(4);
    const s = room.gameState;
    const round = s.roundNumber;
    let guard = 0;
    while (s.roundNumber === round && guard < 40) {
        const actor = P(room, s.currentPlayerId);
        assert(actor.hand.length > 0 || s.forcedCall, '4c: คนที่ได้ตาต้องมีไพ่ หรือถูกบังคับท้า');
        if (s.forcedCall) engine.submitChallenge(room, actor.playerId);
        else engine.submitPlay(room, actor.playerId, actor.hand.slice(0, 3));
        guard += 1;
    }
    assert(s.roundNumber === round + 1, '4c: ลงจนเหลือคนเดียวที่มีไพ่ → ต้องจบด้วยการท้า แล้วขึ้นรอบใหม่');
    assert(s.lastReveal, '4c: รอบจบด้วยการหงายไพ่');
}
console.log('4. มือว่างข้ามตา · เหลือคนเดียวที่มีไพ่ต้องท้า (หมดเวลา = ท้าให้) ✓');

// ---------- 5. คนเริ่มรอบใหม่ ----------
{
    // โกหกโดนจับแต่รอด → คนโกหกเริ่ม
    const room = makeRoom(4);
    const s = room.gameState;
    P(room, 'p0').bullet = 6;
    const t = s.targetRank;
    P(room, 'p0').hand = [fakeOf(t), t, t, t, t];
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [fakeOf(t)]);
    engine.submitChallenge(room, 'p1');
    assert(s.currentPlayerId === 'p0', '5: คนโดนจับโกหก (ยังรอด) เริ่มรอบใหม่');
    assert(!s.lastPlay && s.lastReveal.outcome === 'lie', '5: ผล = โกหก');
}
{
    // ท้าผิด (ของจริง) → คนถัดจากคนท้าเริ่ม
    const room = makeRoom(4);
    const s = room.gameState;
    P(room, 'p1').bullet = 6;
    const t = s.targetRank;
    P(room, 'p0').hand = [t, 'JOKER', t, t, t];
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [t, 'JOKER']);
    engine.submitChallenge(room, 'p1');
    assert(s.lastReveal.outcome === 'truth' && P(room, 'p1').shots === 1, '5b: ของจริง (โจ๊กเกอร์ = ของจริง) → คนท้าลั่นไก');
    assert(P(room, 'p0').shots === 0, '5b: คนลงของจริงไม่ต้องยิง');
    assert(s.currentPlayerId === 'p2', '5b: คนถัดจากคนท้าเริ่มรอบใหม่');
}
{
    // คนโกหกตาย → คนถัดจากเขาเริ่ม
    const room = makeRoom(4);
    const s = room.gameState;
    P(room, 'p0').bullet = 1;
    const t = s.targetRank;
    P(room, 'p0').hand = [fakeOf(t), t, t, t, t];
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [fakeOf(t), t]);
    engine.submitChallenge(room, 'p1');
    assert(!P(room, 'p0').alive, '5c: มีใบไม่ตรงแค่ใบเดียวก็นับว่าโกหก');
    assert(s.currentPlayerId === 'p1', '5c: คนโกหกตาย → คนถัดไปเริ่ม');
}
console.log('5. รอบใหม่: คนโดนจับเริ่ม (ถ้ารอด) · ท้าผิดคนถัดจากคนท้าเริ่ม ✓');

// ---------- 6. ไพ่ปีศาจ ----------
{
    const off = makeRoom(4);
    assert(!allCards(off).includes(engine.DEVIL) && !off.gameState.devilActive, '6: ไม่ตั้ง = ไม่มีไพ่ปีศาจ');

    const room = makeRoom(4, { liarDevil: true });
    const s = room.gameState;
    assert(s.devilMode && s.devilActive, '6: ตั้งห้อง = มีไพ่ปีศาจ');
    const cards = allCards(room);
    assert(count(cards, engine.DEVIL) === 1, '6: ไพ่ปีศาจ 1 ใบต่อรอบ');
    assert(count(cards, s.targetRank) === 5 && cards.length === 20, '6: ปีศาจคือไพ่ชนิดบนโต๊ะ 1 ใบในสำรับ');
    const view = engine.buildClientState(room, 'p0');
    assert(view.devilActive === true && view.cardCatalog.some(c => c.id === engine.DEVIL), '6: client รู้ว่ามีไพ่ปีศาจ');

    const t = s.targetRank;
    P(room, 'p0').hand = [engine.DEVIL, t, fakeOf(t), t, t];
    setTurn(room, 'p0');
    expectThrow(() => engine.submitPlay(room, 'p0', [engine.DEVIL, t]), /ใบเดียว/, '6: ไพ่ปีศาจต้องลงใบเดียว');
    assert(P(room, 'p0').hand.length === 5, '6: ลงไม่ผ่าน = ไพ่ยังอยู่ในมือ');
    engine.submitPlay(room, 'p0', [engine.DEVIL]);
    s.players.forEach(p => { p.bullet = 6; });
    engine.submitChallenge(room, 'p1');
    assert(s.lastReveal.outcome === 'devil', '6: หงายเจอปีศาจ');
    assert(P(room, 'p0').shots === 0, '6: คนลงปีศาจไม่ต้องยิง');
    assert(['p1', 'p2', 'p3'].every(id => P(room, id).shots === 1), '6: ทุกคนที่เหลือ (รวมคนท้า) ลั่นไกคนละนัด');
    assert(s.lastReveal.results.length === 3 && s.lastReveal.results[0].playerId === 'p1', '6: เริ่มยิงจากคนท้า');
    assert(s.currentPlayerId === 'p2', '6: รอบใหม่เริ่มคนถัดจากคนท้า');

    // ปีศาจหงายแล้วทุกคนตาย → คนลงปีศาจชนะ
    const wipe = makeRoom(3, { liarDevil: true });
    const ws = wipe.gameState;
    const wt = ws.targetRank;
    P(wipe, 'p2').hand = [engine.DEVIL, wt, wt, wt, wt];
    P(wipe, 'p0').bullet = 1;
    P(wipe, 'p1').bullet = 1;
    setTurn(wipe, 'p2');
    engine.submitPlay(wipe, 'p2', [engine.DEVIL]);
    engine.submitChallenge(wipe, 'p0');
    assert(ws.phase === 'finished' && ws.winner.playerId === 'p2', '6b: ปีศาจยิงทุกคนตาย → คนลงชนะ');

    // หัวใจ: ปีศาจ = ทุกคนยกเว้นคนลงเสีย 1 ดวง
    const lives = makeRoom(4, { liarDevil: true, liarPunishment: 'lives' });
    const lt = lives.gameState.targetRank;
    P(lives, 'p0').hand = [engine.DEVIL, lt, lt, lt, lt];
    setTurn(lives, 'p0');
    engine.submitPlay(lives, 'p0', [engine.DEVIL]);
    engine.submitChallenge(lives, 'p1');
    assert(P(lives, 'p0').lives === 3 && ['p1', 'p2', 'p3'].every(id => P(lives, id).lives === 2), '6c: โหมดหัวใจ ปีศาจ = ทุกคนยกเว้นคนลงเสีย 1 ดวง');

    // เหลือ 2 คน = ไม่มีไพ่ปีศาจ
    const two = makeRoom(3, { liarDevil: true, liarPunishment: 'lives' });
    P(two, 'p2').alive = false;
    P(two, 'p2').lives = 0;
    const tt = two.gameState.targetRank;
    P(two, 'p0').hand = [tt, tt, tt, tt, tt];
    setTurn(two, 'p0');
    engine.submitPlay(two, 'p0', [tt]);
    engine.submitChallenge(two, 'p1');
    assert(!two.gameState.devilActive && !allCards(two).includes(engine.DEVIL), '6d: เหลือ 2 คน รอบใหม่ไม่มีไพ่ปีศาจ');
}
console.log('6. ไพ่ปีศาจ (ตั้งห้อง): ลงใบเดียว · โดนท้า = ทุกคนยกเว้นคนลงรับโทษ · เหลือ 2 คนปิด ✓');

// ---------- 7. คนออกกลางเกม (roomManager ลบออกก่อน engine เห็น) ----------
{
    // คนที่ถึงตาออก → ตาไปคนถัดไปทันที ไม่ต้องรอหมดเวลา
    const room = makeRoom(4);
    const s = room.gameState;
    setTurn(room, 'p1');
    const turn = s.turnNumber;
    leaveLikeRoomManager(room, 'p1');
    assert(s.players.map(p => p.playerId).join() === 'p0,p1,p2,p3', '7: ที่นั่งคนออกกลับมาอยู่ที่เดิม');
    assert(!P(room, 'p1').alive && P(room, 'p1').hand.length === 0, '7: คนออก = ตกรอบ ไพ่ทิ้ง');
    assert(s.eliminations.some(e => e.playerId === 'p1' && e.reason === 'left'), '7: บันทึกว่าออกจากเกม');
    assert(s.currentPlayerId === 'p2' && s.turnNumber === turn + 1, '7: ตาไป p2 ทันที');
    assert(!room.rejoinableGamePlayers.has('p1'), '7: ลบ snapshot — กลับมาไม่ได้ฟื้นพร้อมไพ่เดิม');
    assert(engine.buildClientState(room, 'p0').players.find(p => p.playerId === 'p1').name === 'ผู้เล่น1', '7: คนอื่นยังเห็นชื่อคนที่ออก');
}
{
    // คนที่ไพ่รอให้ท้าออก → เปิดรอบใหม่
    const room = makeRoom(4);
    const s = room.gameState;
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [P(room, 'p0').hand[0]]);
    const round = s.roundNumber;
    leaveLikeRoomManager(room, 'p0');
    assert(s.roundNumber === round + 1 && !s.lastPlay, '7b: คนลงออก = เปิดรอบใหม่');
    assert(s.currentPlayerId === 'p1', '7b: เริ่มที่คนถัดไป');
}
{
    // คนออกเป็นอีกคนเดียวที่มีไพ่ → คนที่ถึงตาต้องท้า
    const room = makeRoom(4);
    const s = room.gameState;
    const t = s.targetRank;
    P(room, 'p0').hand = [t];
    P(room, 'p2').hand = [];
    setTurn(room, 'p0');
    engine.submitPlay(room, 'p0', [t]);
    assert(s.currentPlayerId === 'p1' && !s.forcedCall, '7c: p1 กับ p3 ยังมีไพ่');
    leaveLikeRoomManager(room, 'p3');
    assert(s.currentPlayerId === 'p1' && s.forcedCall, '7c: p3 ออก → p1 เหลือคนเดียวที่มีไพ่ ต้องท้า');
}
{
    // ออกจนเหลือคนเดียว → จบเกมทันที
    const room = makeRoom(3);
    const s = room.gameState;
    leaveLikeRoomManager(room, 'p1');
    assert(s.phase === 'turn', '7d: เหลือ 2 คน เล่นต่อ');
    leaveLikeRoomManager(room, 'p0');
    assert(s.phase === 'finished' && s.winner.playerId === 'p2', '7d: เหลือคนเดียว = ชนะทันที');
    assert(s.eliminations.length === 2, '7d: ลำดับตกรอบครบ');
}
{
    // เตะออก (ไม่มี snapshot) ก็ต้องส่งตาต่อได้
    const room = makeRoom(4);
    const s = room.gameState;
    setTurn(room, 'p2');
    s.players.splice(2, 1);
    engine.handlePlayerLeft(room, 'p2');
    assert(s.currentPlayerId === 'p3' && P(room, 'p2') && !P(room, 'p2').alive, '7e: เตะคนที่ถึงตา → ตาไปคนถัดไป');
}
console.log('7. ออกกลางเกม: ที่นั่งเดิมเป็น "ตกรอบ" · ส่งตาทันที · เช็คต้องท้า/ผู้ชนะ · ไม่ฟื้นกลับ ✓');

// ---------- 8. เวลา 30 วิ ----------
{
    const room = makeRoom(3);
    const s = room.gameState;
    const left = s.phaseEndsAt - Date.now();
    assert(left > 28000 && left <= 30000, `8: ตาลงไพ่ 30 วิ (${left})`);
    engine.submitPlay(room, s.currentPlayerId, [P(room, s.currentPlayerId).hand[0]]);
    const react = s.phaseEndsAt - Date.now();
    assert(react > 28000 && react <= 30000, `8: ตาเชื่อ/ท้า 30 วิ (${react})`);
}
console.log('8. ตาละ 30 วิ ตามเกมจริง ✓');

// ---------- 9. เล่นทั้งเกม: AFK ทั้งวง / บอทล้วน (ปืน + ปีศาจ) ----------
for (const settings of [{}, { liarDevil: true }, { liarPunishment: 'lives', liarDevil: true }]) {
    const room = makeRoom(5, settings);
    const s = room.gameState;
    let steps = 0;
    while (s.phase !== 'finished' && steps < 400) {
        s.phaseEndsAt = Date.now() - 1;
        const before = s.turnNumber;
        engine.autoResolvePhase(room);
        assert(s.turnNumber !== before || s.phase === 'finished', '9: AFK ห้ามค้างตาเดิม');
        assert(allCards(room).length === 40, '9: ไพ่ไม่หาย');
        steps += 1;
    }
    assert(s.phase === 'finished' && s.winner, '9: AFK ทั้งวงต้องจบได้ ' + JSON.stringify(settings));
}
for (const settings of [{}, { liarDevil: true }]) {
    for (let game = 0; game < 30; game += 1) {
        const players = Array.from({ length: 4 }, (_, i) => ({ playerId: 'bot_' + i, playerName: 'บอท' + i, color: '#fff', avatar: '🤖' }));
        const room = { roomId: 'b', name: 'B', players, settings: { gameMode: 'liar', ...settings }, gameState: engine.createInitialState() };
        engine.startGame(room);
        const s = room.gameState;
        let steps = 0;
        while (s.phase !== 'finished' && steps < 500) {
            assert(engine.playBotTurn(room), '9: บอทต้องเล่นได้ทุกตา');
            assert(allCards(room).length === 20, '9: บอทเล่นแล้วไพ่ไม่หาย');
            steps += 1;
        }
        assert(s.phase === 'finished' && s.winner.playerId, '9: บอทล้วนต้องเล่นจนจบ');
        assert(s.players.filter(p => p.alive).length === 1, '9: เหลือรอดคนเดียว');
    }
}
console.log('9. เล่นทั้งเกม (AFK ทั้งวง / บอทล้วน · ปืน · ปีศาจ) จบได้ ไพ่ไม่หาย ✓');

console.log(`\n✅ smoke-liar-rules: ${passed} asserts passed`);
