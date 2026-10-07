/**
 * เทส engine ไพ่ทิ้งสี — กติกาเฉพาะจุด + สุ่มเล่นหลายร้อยเกม (2–10 คน) แล้วตรวจ invariant ทุกจังหวะ
 * รัน: npm run smoke:colorcards
 */
const E = require('../games/colorcardsEngine');

let checks = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    checks += 1;
}
function throws(fn, pattern, msg) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error, msg + ' (ควร throw)');
    if (pattern) assert(pattern.test(error.message), `${msg}: ข้อความ "${error.message}"`);
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

function makeRoom(n, settings = {}, opts = {}) {
    const players = [];
    for (let i = 0; i < n; i += 1) {
        const bot = opts.bots ? true : (opts.botFrom != null && i >= opts.botFrom);
        const playerId = bot ? `bot_p${i}` : `p${i}`;
        players.push({ playerId, playerName: `ผู้เล่น${i}`, color: '#fff', socketId: `s${i}` });
    }
    const room = { roomId: 'r1', admin: players[0].playerId, players, settings: { gameMode: 'colorcards', ...settings } };
    room.gameState = E.resetRoomGame(room);
    return room;
}

const byKind = (kind, color) => E.CATALOG.filter(c => c.kind === kind && (color === undefined || c.color === color)).map(c => c.id);
const numCard = (color, value) => E.CATALOG.find(c => c.kind === 'num' && c.color === color && c.value === value).id;

/** กองที่ใบแรกที่เปิดคือ firstId (ท้าย array = บนกอง) */
function deckWithFirst(n, firstIds, rng) {
    const want = Array.isArray(firstIds) ? firstIds : [firstIds];
    const rest = E.shuffle(E.CATALOG.map(c => c.id).filter(id => !want.includes(id)), rng);
    const pos = rest.length - 7 * n; // หลังแจก 7n ใบ ใบถัดไปคือใบเปิด
    // want[0] เปิดก่อน — ถ้าเป็น +4 จะถูกสับกลับ
    rest.splice(pos, 0, ...want.slice().reverse());
    return rest;
}

function conservation(room, label) {
    const ids = E.allCardIds(room);
    assert(ids.length === 108, `${label}: ไพ่ต้องครบ 108 ใบ (ได้ ${ids.length})`);
    assert(new Set(ids).size === 108, `${label}: ไพ่ห้ามซ้ำ`);
}

function noLeak(room, label) {
    const state = room.gameState;
    const showdown = state.phase === 'roundEnd' || state.phase === 'finished'; // จบรอบเปิดไพ่ทุกมือโดยตั้งใจ
    state.seats.forEach(viewer => {
        const json = JSON.stringify(E.buildClientState(room, viewer.playerId));
        state.seats.forEach(other => {
            if (other.playerId === viewer.playerId) return;
            if (showdown) return;
            other.hand.forEach(cardId => {
                assert(!json.includes(`"${cardId}"`), `${label}: ${viewer.playerId} เห็นไพ่ ${cardId} ของ ${other.playerId}`);
            });
        });
        state.drawPile.forEach(cardId => {
            assert(!json.includes(`"${cardId}"`), `${label}: กองจั่วรั่ว (${cardId}) ${json.slice(Math.max(0, json.indexOf(cardId) - 300), json.indexOf(cardId) + 40)}`);
        });
        const payload = JSON.parse(json);
        payload.seats.forEach(seat => assert(seat.hand === undefined && seat.cards === undefined, `${label}: seat ต้องไม่มีไพ่`));
    });
    const spectator = JSON.stringify(E.buildClientState(room, 'nobody'));
    if (!showdown) state.seats.forEach(seat => seat.hand.forEach(cardId => assert(!spectator.includes(`"${cardId}"`), `${label}: คนดูเห็นไพ่`)));
}

// ---------- 1. กองไพ่ ----------
(function catalogTest() {
    assert(E.CATALOG.length === 108, 'กอง 108 ใบ');
    for (const color of E.COLORS) {
        assert(byKind('num', color).length === 19, `${color}: เลข 19 ใบ`);
        assert(E.CATALOG.filter(c => c.color === color && c.kind === 'num' && c.value === 0).length === 1, `${color}: 0 มีใบเดียว`);
        for (let v = 1; v <= 9; v += 1) assert(E.CATALOG.filter(c => c.color === color && c.value === v).length === 2, `${color} ${v} สองใบ`);
        ['skip', 'rev', 'd2'].forEach(k => assert(byKind(k, color).length === 2, `${color} ${k} สองใบ`));
    }
    assert(byKind('wild').length === 4 && byKind('d4').length === 4, 'เปลี่ยนสี 4 + +4 4');
    assert(E.cardPoints(numCard('r', 7)) === 7 && E.cardPoints(byKind('skip', 'g')[0]) === 20 && E.cardPoints(byKind('d4')[0]) === 50, 'แต้มไพ่');
    const total = E.CATALOG.reduce((s, c) => s + E.cardPoints(c.id), 0);
    assert(total === 4 * (45 * 2) + 4 * 6 * 20 + 8 * 50, 'แต้มรวมทั้งกอง');
    console.log('1. กอง 108 ใบ สี/ชนิด/แต้มถูก ✓');
})();

// ---------- 2. เริ่มรอบ + ใบแรก ----------
(function firstCardTest() {
    const zero = () => 0;
    // ใบแรกเลขธรรมดา
    let room = makeRoom(3);
    E.startGame(room, zero, { deck: deckWithFirst(3, numCard('g', 5), mulberry32(1)) });
    let s = room.gameState;
    assert(s.seats.every(seat => seat.hand.length === 7), 'แจกคนละ 7');
    assert(s.dealerIndex === 0 && s.turn.playerId === 'p1', 'คนถัดจากคนแจกเริ่ม');
    assert(s.currentColor === 'g', 'สีปัจจุบัน = สีใบแรก');
    conservation(room, 'เริ่ม');

    // ข้าม: คนแรกโดนข้าม
    room = makeRoom(3);
    E.startGame(room, zero, { deck: deckWithFirst(3, byKind('skip', 'r')[0], mulberry32(2)) });
    assert(room.gameState.turn.playerId === 'p2', 'ใบแรกข้าม → p1 โดนข้าม');

    // กลับทิศ 3 คน: คนแจกเริ่ม แล้ววนกลับ
    room = makeRoom(3);
    E.startGame(room, zero, { deck: deckWithFirst(3, byKind('rev', 'b')[0], mulberry32(3)) });
    s = room.gameState;
    assert(s.direction === -1 && s.turn.playerId === 'p0', 'ใบแรกกลับทิศ (3 คน) → คนแจกเริ่ม ทิศกลับ');

    // กลับทิศ 2 คน = ข้าม
    room = makeRoom(2);
    E.startGame(room, zero, { deck: deckWithFirst(2, byKind('rev', 'b')[0], mulberry32(4)) });
    s = room.gameState;
    assert(s.direction === 1 && s.turn.playerId === 'p0', 'ใบแรกกลับทิศ (2 คน) = ข้าม');

    // +2: คนแรกจั่ว 2 แล้วโดนข้าม
    room = makeRoom(4);
    E.startGame(room, zero, { deck: deckWithFirst(4, byKind('d2', 'y')[0], mulberry32(5)) });
    s = room.gameState;
    assert(s.seats[1].hand.length === 9 && s.turn.playerId === 'p2', 'ใบแรก +2 → p1 จั่ว 2 โดนข้าม');
    conservation(room, '+2 ใบแรก');

    // เปลี่ยนสี: ลงอะไรก็ได้
    room = makeRoom(3);
    E.startGame(room, zero, { deck: deckWithFirst(3, byKind('wild')[0], mulberry32(6)) });
    s = room.gameState;
    assert(s.currentColor === null && s.turn.playerId === 'p1', 'ใบแรกเปลี่ยนสี → สีว่าง');
    assert(s.seats[1].hand.every(id => E.isPlayable(s, id)), 'สีว่าง ลงได้ทุกใบ');

    // +4 สับกลับ
    room = makeRoom(3);
    E.startGame(room, mulberry32(7), { deck: deckWithFirst(3, [byKind('d4')[0], numCard('r', 3)], mulberry32(7)) });
    s = room.gameState;
    assert(E.getCard(s.discard[0]).kind !== 'd4' && s.discard.length === 1, 'ใบแรก +4 ต้องสับกลับแล้วเปิดใหม่');
    conservation(room, '+4 ใบแรก');
    console.log('2. ใบแรก เลข/ข้าม/กลับทิศ (2,3 คน)/+2/เปลี่ยนสี/+4 สับกลับ ✓');
})();

// ---------- helpers สำหรับจัดมือ ----------
function setup(n, settings = {}) {
    const room = makeRoom(n, settings);
    E.startGame(room, () => 0, { deck: deckWithFirst(n, numCard('r', 5), mulberry32(99)) });
    return room;
}
/** แจกมือใหม่ให้ seat (คืนไพ่เก่าเข้ากอง) */
function giveHand(room, idx, ids) {
    const s = room.gameState;
    const seat = s.seats[idx];
    s.drawPile.unshift(...seat.hand);
    seat.hand = [];
    ids.forEach(id => {
        let at = s.drawPile.indexOf(id);
        if (at >= 0) { s.drawPile.splice(at, 1); seat.hand.push(id); return; }
        for (const other of s.seats) {
            const i = other.hand.indexOf(id);
            if (i >= 0) { other.hand.splice(i, 1); other.hand.push(s.drawPile.pop()); seat.hand.push(id); return; }
        }
        at = s.discard.indexOf(id);
        if (at >= 0 && at < s.discard.length - 1) { s.discard.splice(at, 1); seat.hand.push(id); return; }
        throw new Error('หาไพ่ไม่เจอ ' + id);
    });
}
function setTop(room, id, color) {
    const s = room.gameState;
    const at = s.drawPile.indexOf(id);
    if (at >= 0) s.drawPile.splice(at, 1);
    else {
        for (const seat of s.seats) { const i = seat.hand.indexOf(id); if (i >= 0) { seat.hand.splice(i, 1); break; } }
    }
    s.discard.push(id);
    s.currentColor = color || E.getCard(id).color;
}
function ctxOf(room) { return { turnSeq: room.gameState.turnSeq }; }

// ---------- 3. ลงไพ่ / ผิดกติกา ----------
(function playRulesTest() {
    const room = setup(3);
    const s = room.gameState;
    assert(s.turn.playerId === 'p1', 'p1 เริ่ม');
    const r9 = numCard('r', 9); const g5 = numCard('g', 5); const b2 = numCard('b', 2); const y7 = numCard('y', 7);
    const wild = byKind('wild')[0]; const bSkip = byKind('skip', 'b')[0];
    giveHand(room, 1, [r9, g5, b2, y7, wild, bSkip, numCard('y', 1)]);
    conservation(room, 'จัดมือ');
    assert(E.isPlayable(s, r9) && E.isPlayable(s, g5) && !E.isPlayable(s, b2) && E.isPlayable(s, wild) && !E.isPlayable(s, bSkip), 'สีตรง/เลขตรง/ไวลด์ลงได้ อื่นไม่ได้');

    throws(() => E.playCard(room, 'p2', { cardId: s.seats[2].hand[0] }, null), /ยังไม่ถึงตา/, 'ลงนอกตา');
    throws(() => E.playCard(room, 'p1', { cardId: b2 }), /ลงใบนี้ไม่ได้/, 'ลงไพ่ไม่ตรง');
    throws(() => E.playCard(room, 'p1', { cardId: s.seats[2].hand[0] }), /ไม่มีไพ่/, 'ลงไพ่คนอื่น');
    throws(() => E.playCard(room, 'p1', { cardId: wild }), /เลือกสี/, 'ไวลด์ไม่เลือกสี');
    throws(() => E.playCard(room, 'p1', { cardId: wild, color: 'purple' }), /เลือกสี/, 'ไวลด์สีมั่ว');
    throws(() => E.playCard(room, 'p1', { cardId: r9 }, { turnSeq: s.turnSeq - 1 }), /จังหวะ/, 'turnSeq เก่า');
    throws(() => E.passTurn(room, 'p1'), /ต้องจั่วก่อน/, 'ผ่านโดยไม่จั่ว');
    throws(() => E.catchPlayer(room, 'p2', 'p1'), /ไม่มีใคร/, 'จับมั่ว');
    assert(s.seats[1].hand.length === 7 && s.turn.playerId === 'p1', 'คำสั่งผิดไม่เปลี่ยน state');

    E.playCard(room, 'p1', { cardId: g5 }, ctxOf(room));
    assert(s.currentColor === 'g' && s.turn.playerId === 'p2', 'ลงเลขตรง เปลี่ยนสี เดินตา');
    // ไวลด์เปลี่ยนสี
    s.turn.playerId = 'p1'; // บังคับให้เทส (ไม่ผ่าน API)
    E.playCard(room, 'p1', { cardId: wild, color: 'b' });
    assert(s.currentColor === 'b' && E.isPlayable(s, b2) && !E.isPlayable(s, r9), 'ไวลด์เปลี่ยนเป็นน้ำเงิน');
    conservation(room, 'ไวลด์');
    console.log('3. ลงไพ่ตามสี/เลข/ไวลด์ · ปฏิเสธนอกตา/ไม่ตรง/ไม่เลือกสี/turnSeq เก่า ✓');
})();

// ---------- 4. ข้าม / กลับทิศ / +2 (ไม่ซ้อน) ----------
(function actionTest() {
    let room = setup(4);
    let s = room.gameState;
    giveHand(room, 1, [byKind('skip', 'r')[0], numCard('b', 1), numCard('b', 2)]);
    E.playCard(room, 'p1', { cardId: byKind('skip', 'r')[0] });
    assert(s.turn.playerId === 'p3', 'ข้าม → p2 โดนข้าม');

    room = setup(4); s = room.gameState;
    giveHand(room, 1, [byKind('rev', 'r')[0], numCard('b', 1), numCard('b', 2)]);
    E.playCard(room, 'p1', { cardId: byKind('rev', 'r')[0] });
    assert(s.direction === -1 && s.turn.playerId === 'p0', 'กลับทิศ (4 คน) → p0');

    room = setup(2); s = room.gameState;
    giveHand(room, 1, [byKind('rev', 'r')[0], numCard('b', 1), numCard('b', 2)]);
    E.playCard(room, 'p1', { cardId: byKind('rev', 'r')[0] });
    assert(s.turn.playerId === 'p1', 'กลับทิศ (2 คน) = ข้าม ได้เล่นต่อ');

    room = setup(3); s = room.gameState;
    giveHand(room, 1, [byKind('d2', 'r')[0], numCard('b', 1), numCard('b', 2)]);
    const before = s.seats[2].hand.length;
    E.playCard(room, 'p1', { cardId: byKind('d2', 'r')[0] });
    assert(s.seats[2].hand.length === before + 2 && s.turn.playerId === 'p0', '+2 (ไม่ซ้อน) → p2 จั่ว 2 โดนข้าม');

    room = setup(3); s = room.gameState;
    giveHand(room, 1, [byKind('d4')[0], numCard('b', 1), numCard('b', 2)]);
    const b4 = s.seats[2].hand.length;
    E.playCard(room, 'p1', { cardId: byKind('d4')[0], color: 'y' });
    assert(s.seats[2].hand.length === b4 + 4 && s.turn.playerId === 'p0' && s.currentColor === 'y', '+4 → p2 จั่ว 4 โดนข้าม สีเหลือง');
    conservation(room, '+4');
    console.log('4. ข้าม / กลับทิศ (4 คน, 2 คน = ข้าม) / +2 / +4 ✓');
})();

// ---------- 5. ซ้อน +2/+4 ----------
(function stackingTest() {
    const room = setup(3, { colorcardsStacking: true });
    const s = room.gameState;
    assert(s.config.stacking === true, 'เปิดซ้อน');
    const [d2a, d2b] = byKind('d2', 'r');
    const d2g = byKind('d2', 'g')[0];
    giveHand(room, 1, [d2a, numCard('b', 1), numCard('b', 2)]);
    giveHand(room, 2, [d2g, numCard('y', 1), byKind('d4')[1]]);
    giveHand(room, 0, [d2b, numCard('g', 3), numCard('g', 4)]);
    E.playCard(room, 'p1', { cardId: d2a });
    assert(s.pendingDraw === 2 && s.turn.playerId === 'p2', 'ซ้อน: +2 ค้าง 2');
    throws(() => E.playCard(room, 'p2', { cardId: numCard('y', 1) }), /ต้องซ้อน/, 'มี +2 ค้าง ลงเลขไม่ได้');
    E.playCard(room, 'p2', { cardId: d2g });
    assert(s.pendingDraw === 4 && s.turn.playerId === 'p0', '+2 ซ้อน +2 = 4 (ต่างสีก็ได้)');
    const h0 = s.seats[0].hand.length;
    E.drawCard(room, 'p0');
    assert(s.seats[0].hand.length === h0 + 4 && s.pendingDraw === 0 && s.turn.playerId === 'p1', 'จั่วรับทั้งหมด 4 แล้วผ่าน');
    conservation(room, 'ซ้อน');

    // +4 ทับ +2 ได้ แต่ +2 ทับ +4 ไม่ได้
    const room2 = setup(3, { colorcardsStacking: true });
    const t = room2.gameState;
    giveHand(room2, 1, [byKind('d2', 'r')[0], numCard('b', 1), numCard('b', 2)]);
    giveHand(room2, 2, [byKind('d4')[0], numCard('y', 1), numCard('y', 2)]);
    giveHand(room2, 0, [byKind('d2', 'b')[1], numCard('g', 3), numCard('g', 4)]);
    E.playCard(room2, 'p1', { cardId: byKind('d2', 'r')[0] });
    E.playCard(room2, 'p2', { cardId: byKind('d4')[0], color: 'b' });
    assert(t.pendingDraw === 6 && t.pendingKind === 'd4', '+4 ทับ +2 = 6');
    throws(() => E.playCard(room2, 'p0', { cardId: byKind('d2', 'b')[1] }), /ต้องซ้อน/, '+2 ทับ +4 ไม่ได้');
    E.autoResolvePhase(Object.assign(room2, {}), Math.random); // ยังไม่หมดเวลา — ไม่เกิดอะไร
    assert(t.turn.playerId === 'p0' && t.pendingDraw === 6, 'ยังไม่หมดเวลา autoResolve ไม่ทำอะไร');
    t.phaseEndsAt = Date.now() - 1;
    const h = t.seats[0].hand.length;
    E.autoResolvePhase(room2);
    assert(t.seats[0].hand.length === h + 6 && t.pendingDraw === 0 && t.turn.playerId === 'p1', 'หมดเวลา = รับทั้งกองแล้วผ่าน');
    conservation(room2, 'ซ้อน +4');
    console.log('5. ซ้อน +2/+4 (เปิดในห้อง) · +4 ทับ +2 ได้ · +2 ทับ +4 ไม่ได้ ✓');
})();

// ---------- 6. จั่ว ----------
(function drawTest() {
    const room = setup(3);
    const s = room.gameState;
    giveHand(room, 1, [numCard('b', 1), numCard('b', 2)]);
    // ใบบนกองลงได้
    const r8 = numCard('r', 8);
    s.drawPile.splice(s.drawPile.indexOf(r8), 1); s.drawPile.push(r8);
    E.drawCard(room, 'p1', ctxOf(room));
    assert(s.turn.playerId === 'p1' && s.turn.drawnCardId === r8, 'จั่วได้ใบที่ลงได้ → ยังเป็นตาเดิม');
    throws(() => E.drawCard(room, 'p1'), /จั่วไปแล้ว/, 'จั่วซ้ำ');
    throws(() => E.playCard(room, 'p1', { cardId: numCard('b', 1) }), /ลงใบนี้ไม่ได้|ใบที่เพิ่งจั่ว/, 'จั่วแล้วลงใบอื่นไม่ได้');
    E.passTurn(room, 'p1');
    assert(s.turn.playerId === 'p2' && s.seats[1].hand.length === 3, 'ผ่านหลังจั่ว');

    // ใบที่จั่วลงไม่ได้ → ผ่านเอง
    const g1 = numCard('g', 1);
    giveHand(room, 2, [numCard('b', 3), numCard('b', 4)]);
    s.drawPile.splice(s.drawPile.indexOf(g1), 1); s.drawPile.push(g1);
    E.drawCard(room, 'p2');
    assert(s.turn.playerId === 'p0' && s.seats[2].hand.length === 3, 'จั่วได้ใบลงไม่ได้ → ผ่านเอง');

    // หมดเวลา = จั่ว 1 แล้วผ่าน
    const h0 = s.seats[0].hand.length;
    s.phaseEndsAt = Date.now() - 1;
    E.autoResolvePhase(room);
    assert(s.seats[0].hand.length === h0 + 1 && s.turn.playerId === 'p1', 'หมดเวลา: จั่ว 1 แล้วผ่าน');

    // กองจั่วหมด → สับกองทิ้ง (เว้นใบบน)
    giveHand(room, 1, [numCard('b', 1), numCard('b', 2)]);
    const top = s.discard[s.discard.length - 1];
    s.discard.unshift(...s.drawPile.splice(0, s.drawPile.length));
    s.discard = s.discard.filter(id => id !== top).concat([top]);
    assert(s.drawPile.length === 0, 'ทำให้กองจั่วหมด');
    E.drawCard(room, 'p1');
    assert(s.discard.length === 1 && s.discard[0] === top && s.drawPile.length > 80, 'สับกองทิ้งกลับ เหลือใบบนสุด');
    conservation(room, 'สับกอง');
    console.log('6. จั่ว: ลงใบที่จั่วได้/ผ่าน · ลงไม่ได้ผ่านเอง · หมดเวลา · สับกองทิ้ง ✓');
})();

// ---------- 7. เหลือใบเดียว / จับได้ ----------
(function lastCardTest() {
    const room = setup(3);
    const s = room.gameState;
    giveHand(room, 1, [numCard('r', 1), numCard('b', 2)]);
    E.playCard(room, 'p1', { cardId: numCard('r', 1) });
    assert(s.catchWindow && s.catchWindow.playerId === 'p1', 'ลืมกด → เปิดหน้าต่างจับ');
    let view = E.buildClientState(room, 'p2');
    assert(view.availableActions.canCatch === 'p1' && view.catchWindow.playerId === 'p1', 'คนอื่นเห็นปุ่มจับได้');
    assert(E.buildClientState(room, 'p1').availableActions.canCatch === null, 'ตัวเองจับตัวเองไม่ได้');
    assert(E.buildClientState(room, 'p1').availableActions.canCall === true, 'ยังกดเหลือใบเดียวทัน');
    throws(() => E.catchPlayer(room, 'p1', 'p1'), /ตัวเอง/, 'จับตัวเอง');
    E.catchPlayer(room, 'p2', 'p1');
    assert(s.seats[1].hand.length === 3 && !s.catchWindow, 'จับได้ → จั่ว 2');
    throws(() => E.catchPlayer(room, 'p0', 'p1'), /ไม่มีใคร/, 'จับซ้ำไม่ได้');

    // กดล่วงหน้าตอนลง → จับไม่ได้
    const room2 = setup(3);
    const t = room2.gameState;
    giveHand(room2, 1, [numCard('r', 1), numCard('b', 2)]);
    assert(E.buildClientState(room2, 'p1').availableActions.canCall === true, 'ถึงตาเหลือ 2 ใบกดได้');
    E.playCard(room2, 'p1', { cardId: numCard('r', 1), callLast: true });
    assert(t.seats[1].called && !t.catchWindow, 'กดพร้อมลง → ปลอดภัย');
    // กดก่อน (toggle) แล้วลง
    const room3 = setup(3);
    const u = room3.gameState;
    giveHand(room3, 1, [numCard('r', 1), numCard('b', 2)]);
    E.callLast(room3, 'p1');
    E.playCard(room3, 'p1', { cardId: numCard('r', 1) });
    assert(u.seats[1].called && !u.catchWindow, 'กดล่วงหน้าแล้วลง → ปลอดภัย');
    // กดเองทีหลังภายในหน้าต่าง
    const room4 = setup(3);
    const v = room4.gameState;
    giveHand(room4, 1, [numCard('r', 1), numCard('b', 2)]);
    E.playCard(room4, 'p1', { cardId: numCard('r', 1) });
    E.callLast(room4, 'p1');
    throws(() => E.catchPlayer(room4, 'p2', 'p1'), /ไม่มีใคร|ทัน/, 'กดทันแล้วจับไม่ได้');
    // หมดเวลาจับ
    const room5 = setup(3);
    const w = room5.gameState;
    giveHand(room5, 1, [numCard('r', 1), numCard('b', 2)]);
    E.playCard(room5, 'p1', { cardId: numCard('r', 1) });
    w.catchWindow.until = Date.now() - 1;
    view = E.buildClientState(room5, 'p2');
    assert(view.availableActions.canCatch === null && view.catchWindow === null, 'หมดเวลาไม่โชว์ปุ่มจับ');
    throws(() => E.catchPlayer(room5, 'p2', 'p1'), /ช้าไป|ไม่มีใคร/, 'จับหลังหมดเวลา');
    throws(() => E.callLast(room5, 'p2'), /กดได้ตอน/, 'มีหลายใบกดเหลือใบเดียวไม่ได้');
    console.log('7. เหลือใบเดียว: ลืม → จับได้ +2 · กดพร้อมลง/ล่วงหน้า/ทีหลัง ปลอดภัย · หมดเวลาจับไม่ได้ ✓');
})();

// ---------- 8. จบรอบ / แต้ม / หลายรอบ ----------
(function scoringTest() {
    const room = setup(3);
    const s = room.gameState;
    giveHand(room, 1, [numCard('r', 1)]);
    s.seats[1].called = true;
    giveHand(room, 0, [numCard('b', 9), byKind('skip', 'g')[0]]);
    giveHand(room, 2, [byKind('wild')[0], numCard('y', 3)]);
    E.playCard(room, 'p1', { cardId: numCard('r', 1) });
    assert(s.phase === 'finished' && s.status === 'colorcards_finished', '1 รอบ: หมดมือ = จบเกม');
    assert(s.roundResult.points === 9 + 20 + 50 + 3, 'แต้ม = ผลรวมมือคนอื่น');
    assert(s.winner.playerId === 'p1' && s.standings[0].playerId === 'p1' && s.standings[0].won, 'ผู้ชนะอยู่บนสุด');

    // +2 ใบสุดท้าย: คนถัดไปยังต้องจั่ว และนับแต้มด้วย
    const room2 = setup(3);
    const t = room2.gameState;
    giveHand(room2, 1, [byKind('d2', 'r')[0]]);
    t.seats[1].called = true;
    giveHand(room2, 2, [numCard('b', 1)]);
    giveHand(room2, 0, [numCard('b', 2)]);
    E.playCard(room2, 'p1', { cardId: byKind('d2', 'r')[0] });
    assert(t.seats[2].hand.length === 3, '+2 ใบสุดท้าย คนถัดไปยังจั่ว');
    assert(t.roundResult.points === 1 + 2 + t.seats[2].hand.slice(1).reduce((a, id) => a + E.cardPoints(id), 0), 'แต้มรวมไพ่ที่จั่วเพิ่ม');
    conservation(room2, 'จบรอบ');

    // ล่า 300 แต้ม: จบรอบแล้วรอรอบใหม่ คนแจกวน
    const room3 = setup(3, { colorcardsTarget: 300 });
    const u = room3.gameState;
    const dealer1 = u.dealerIndex;
    giveHand(room3, 1, [numCard('r', 1)]);
    u.seats[1].called = true;
    E.playCard(room3, 'p1', { cardId: numCard('r', 1) });
    assert(u.phase === 'roundEnd' && u.status === 'playing', 'ยังไม่ถึง 300 → รอรอบต่อไป');
    noLeak(room3, 'จบรอบ');
    const shown = E.buildClientState(room3, 'p2').roundResult;
    assert(shown && shown.hands.length === 3, 'จบรอบเปิดไพ่ทุกมือให้ดูได้');
    throws(() => E.nextRound(room3, 'p2'), /หัวห้อง/, 'คนอื่นกดรอบต่อไปไม่ได้');
    E.nextRound(room3, 'p0');
    assert(u.phase === 'turn' && u.round === 2 && u.dealerIndex === (dealer1 + 1) % 3, 'รอบ 2 คนแจกวน');
    assert(u.seats.every(seat => seat.hand.length >= 7), 'รอบใหม่แจกใหม่');
    assert(u.seats[1].score > 0, 'แต้มสะสมข้ามรอบ');
    conservation(room3, 'รอบ 2');
    u.seats[2].score = 295;
    giveHand(room3, 2, [numCard('g', 2)]);
    u.turn.playerId = 'p2';
    u.currentColor = 'g';
    u.seats[2].called = true;
    E.playCard(room3, 'p2', { cardId: numCard('g', 2) });
    assert(u.phase === 'finished' && u.winner.playerId === 'p2', 'ถึง 300 → ชนะเกม');
    console.log('8. แต้มรอบ = มือคนอื่น · +2 ใบสุดท้ายยังจั่ว · ล่า 300 หลายรอบ คนแจกวน ✓');
})();

// ---------- 9. คนออก ----------
(function leaveTest() {
    const room = setup(4);
    const s = room.gameState;
    const handOf2 = s.seats[2].hand.slice();
    const bottom = s.drawPile.length;
    E.handlePlayerLeft(room, 'p2');
    assert(s.seats[2].left && s.seats[2].hand.length === 0, 'คนออก มือว่าง');
    assert(s.drawPile.slice(0, handOf2.length).join() === handOf2.join() && s.drawPile.length === bottom + handOf2.length, 'ไพ่กลับใต้กองจั่ว');
    conservation(room, 'คนออก');
    // ตาเดินข้ามคนออก
    giveHand(room, 1, [numCard('r', 2), numCard('b', 2)]);
    E.playCard(room, 'p1', { cardId: numCard('r', 2) });
    assert(s.turn.playerId === 'p3', 'ข้ามคนที่ออก');
    // คนที่กำลังถึงตาออก
    E.handlePlayerLeft(room, 'p3');
    assert(s.turn.playerId === 'p0', 'ตาคนออก → เลื่อนไปคนถัดไป');
    // เหลือ 2 คน: กลับทิศ = ข้าม
    giveHand(room, 0, [byKind('rev', 'r')[0], numCard('b', 7)]);
    s.currentColor = 'r';
    E.playCard(room, 'p0', { cardId: byKind('rev', 'r')[0] });
    assert(s.turn.playerId === 'p0', 'เหลือ 2 คน กลับทิศ = ข้าม');
    // เหลือคนเดียว → จบ คนที่เหลือชนะ
    E.handlePlayerLeft(room, 'p1');
    assert(s.phase === 'finished' && s.winner.playerId === 'p0', 'เหลือคนเดียว → ชนะ');
    conservation(room, 'จบเพราะคนออก');
    E.handlePlayerLeft(room, 'p0');
    assert(s.phase === 'finished', 'จบแล้วออกไม่พัง');

    // คนออกตอนกำลังมีหน้าต่างจับ
    const room2 = setup(3);
    giveHand(room2, 1, [numCard('r', 1), numCard('b', 2)]);
    E.playCard(room2, 'p1', { cardId: numCard('r', 1) });
    E.handlePlayerLeft(room2, 'p1');
    assert(!room2.gameState.catchWindow, 'คนออก ปิดหน้าต่างจับ');
    conservation(room2, 'ออกตอนจับ');
    console.log('9. คนออก: ไพ่ใต้กอง · ข้ามที่นั่ง · ออกตอนถึงตา · เหลือคนเดียวชนะ ✓');
})();

// ---------- 10. ความลับ ----------
(function secrecyTest() {
    const room = setup(5);
    noLeak(room, 'เริ่ม');
    const s = room.gameState;
    const view = E.buildClientState(room, 'p1');
    assert(view.self.hand.length === 7 && view.seats.every(seat => typeof seat.count === 'number'), 'มือตัวเองเต็ม คนอื่นแค่จำนวน');
    assert(view.self.playable.length === E.playableIds(room, 'p1').length, 'playable ส่งเฉพาะตัวเอง');
    assert(E.buildClientState(room, 'p2').self.playable.length === 0, 'ไม่ใช่ตาไม่มี playable');
    // ใบที่เพิ่งจั่ว เห็นแค่เจ้าของ
    const r8 = numCard('r', 8);
    giveHand(room, 1, [numCard('b', 1), numCard('b', 2)]);
    s.drawPile.splice(s.drawPile.indexOf(r8), 1); s.drawPile.push(r8);
    E.drawCard(room, 'p1');
    assert(E.buildClientState(room, 'p1').self.drawnCardId === r8, 'เจ้าของเห็นใบที่จั่ว');
    noLeak(room, 'หลังจั่ว');
    const fxJson = JSON.stringify(s.fx);
    assert(!fxJson.includes(r8), 'fx ของการจั่วไม่บอกไพ่');
    console.log('10. ความลับ: มือ/ใบที่จั่ว/กองจั่ว ไม่หลุดไปผู้เล่นอื่นหรือคนดู ✓');
})();

// ---------- 11. บอท + สุ่มเล่นหลายร้อยเกม ----------
(function randomGames() {
    const GAMES = Number(process.env.COLORCARDS_GAMES) || 400;
    let totalActions = 0;
    let illegalRejected = 0;
    let catches = 0;
    let rounds = 0;
    let multiPlays = 0;
    let maxGroup = 1;
    const winsBySeatCount = {};
    for (let g = 0; g < GAMES; g += 1) {
        const rng = mulberry32(1000 + g);
        const n = 2 + (g % 9);
        const settings = {
            colorcardsStacking: g % 3 === 0,
            colorcardsTarget: g % 5 === 0 ? 300 : (g % 7 === 0 ? 500 : 0),
            colorcardsTurnSeconds: [15, 20, 30][g % 3],
            ...(g % 4 === 3 ? { colorcardsMulti: false } : {})
        };
        const room = makeRoom(n, settings, { bots: true });
        E.startGame(room, rng);
        const s = room.gameState;
        let guard = 0;
        let leftOne = false;
        while (s.phase !== 'finished' && guard < 6000) {
            guard += 1;
            if (s.phase === 'roundEnd') {
                rounds += 1;
                noLeak(room, `เกม ${g} จบรอบ`);
                if (rng() < 0.5) E.nextRound(room, room.admin, rng);
                else { s.phaseEndsAt = Date.now() - 1; E.autoResolvePhase(room, rng); }
                continue;
            }
            const turnSeat = s.seats.find(seat => seat.playerId === s.turn.playerId);
            assert(turnSeat && !turnSeat.left, `เกม ${g}: ตาต้องเป็นคนที่ยังเล่น`);
            assert(s.currentColor === null || E.COLORS.includes(s.currentColor), `เกม ${g}: สีถูก`);

            // คำสั่งผิดต้องโดนปฏิเสธและไม่เปลี่ยนอะไร
            if (rng() < 0.15) {
                const other = s.seats.find(seat => !seat.left && seat.playerId !== s.turn.playerId);
                const snapshot = JSON.stringify(s);
                let rejected = false;
                try {
                    const pick = rng();
                    if (pick < 0.35) E.playCard(room, other.playerId, { cardId: other.hand[0], color: 'r' }, null, rng);
                    else if (pick < 0.6) E.drawCard(room, other.playerId, null, rng);
                    else if (pick < 0.8) {
                        const bad = turnSeat.hand.find(id => !E.isPlayable(s, id));
                        if (!bad) throw new Error('none');
                        E.playCard(room, turnSeat.playerId, { cardId: bad, color: 'g' }, null, rng);
                    } else if (pick < 0.9) {
                        // กลุ่มค่าไม่เหมือนกัน / มีไวลด์ปน / ห้องปิดลงหลายใบ
                        const first = turnSeat.hand.find(id => E.isPlayable(s, id) && E.getCard(id).kind !== 'wild' && E.getCard(id).kind !== 'd4');
                        const mate = first && (s.config.multi && !s.turn.drawnCardId
                            ? turnSeat.hand.find(id => id !== first && !E.sameValue(E.getCard(id), E.getCard(first)))
                            : turnSeat.hand.find(id => id !== first));
                        if (!mate) throw new Error('none');
                        E.playCard(room, turnSeat.playerId, { cardIds: [first, mate], color: 'r' }, null, rng);
                    } else E.passTurn(room, turnSeat.playerId, { turnSeq: s.turnSeq + 5 });
                } catch (e) { rejected = true; }
                assert(rejected, `เกม ${g}: คำสั่งผิดต้องโดนปฏิเสธ`);
                assert(JSON.stringify(s) === snapshot, `เกม ${g}: คำสั่งผิดห้ามเปลี่ยน state`);
                illegalRejected += 1;
            }

            // บางทีคนจับได้
            if (s.catchWindow && rng() < 0.5) {
                const catcher = s.seats.find(seat => !seat.left && seat.playerId !== s.catchWindow.playerId);
                try { E.catchPlayer(room, catcher.playerId, s.catchWindow.playerId, rng); catches += 1; } catch (e) { /* ปิดไปแล้ว */ }
            }
            // บางทีหมดเวลา
            if (rng() < 0.04) {
                s.phaseEndsAt = Date.now() - 1;
                E.autoResolvePhase(room, rng);
            } else {
                const move = E.chooseBotMove(room, turnSeat, rng);
                const ctx = { turnSeq: s.turnSeq };
                if (move.type === 'play') {
                    assert(E.isPlayable(s, move.cardId), `เกม ${g}: บอทต้องลงไพ่ถูกกติกา`);
                    const group = move.cardIds || [move.cardId];
                    assert(group[0] === move.cardId, `เกม ${g}: cardId = ใบแรกของกลุ่ม`);
                    if (group.length > 1) {
                        multiPlays += 1;
                        maxGroup = Math.max(maxGroup, group.length);
                        assert(s.config.multi && !s.turn.drawnCardId, `เกม ${g}: ลงหลายใบได้เฉพาะห้องที่เปิด และยังไม่จั่ว`);
                        assert(new Set(group).size === group.length && group.every(id => turnSeat.hand.includes(id)), `เกม ${g}: กลุ่มต้องเป็นไพ่ในมือไม่ซ้ำ`);
                        assert(group.every(id => E.sameValue(E.getCard(id), E.getCard(group[0]))), `เกม ${g}: กลุ่มต้องค่าเดียวกัน ไม่มีไวลด์`);
                    }
                    const before = turnSeat.hand.length;
                    E.playCard(room, turnSeat.playerId, move, ctx, rng);
                    assert(turnSeat.hand.length === before - group.length, `เกม ${g}: มือลดเท่าจำนวนที่ลง`);
                    if (s.phase === 'turn') {
                        assert(s.discard[s.discard.length - 1] === group[group.length - 1], `เกม ${g}: ใบสุดท้ายของกลุ่มอยู่บนกอง`);
                        const top = E.getCard(group[group.length - 1]);
                        if (top.color) assert(s.currentColor === top.color, `เกม ${g}: สีต่อไป = สีใบบนสุด`);
                    }
                } else if (move.type === 'pass') {
                    assert(s.turn.drawnCardId, 'บอทผ่านได้หลังจั่วเท่านั้น');
                    E.passTurn(room, turnSeat.playerId, ctx);
                } else {
                    assert(!turnSeat.hand.some(id => E.isPlayable(s, id)), 'บอทจั่วเมื่อไม่มีไพ่ลงเท่านั้น');
                    E.drawCard(room, turnSeat.playerId, ctx, rng);
                }
            }
            totalActions += 1;
            // บางเกมมีคนออกกลางเกม
            if (!leftOne && n >= 3 && guard === 30 && g % 4 === 1 && s.phase === 'turn') {
                const victim = s.seats.find(seat => !seat.left && seat.playerId !== room.admin);
                E.handlePlayerLeft(room, victim.playerId, rng);
                leftOne = true;
            }
            conservation(room, `เกม ${g} action ${guard}`);
            if (guard % 60 === 7) noLeak(room, `เกม ${g} action ${guard}`);
            s.seats.forEach(seat => {
                if (seat.left) assert(seat.hand.length === 0, 'คนออกต้องไม่มีไพ่');
                if (seat.called) assert(seat.hand.length <= 2, 'called ได้ตอนเหลือ ≤ 2');
            });
        }
        assert(s.phase === 'finished', `เกม ${g} (${n} คน) ต้องจบ (guard ${guard})`);
        assert(s.winner && s.standings[0].playerId === s.winner.playerId, `เกม ${g}: มีผู้ชนะอยู่บนสุด`);
        const w = s.seats.find(seat => seat.playerId === s.winner.playerId);
        if (settings.colorcardsTarget && !leftOne) assert(w.score >= settings.colorcardsTarget, `เกม ${g}: ชนะต้องถึงเป้า`);
        if (!settings.colorcardsTarget && !leftOne) assert(w.hand.length === 0, `เกม ${g}: 1 รอบ ผู้ชนะหมดมือ`);
        winsBySeatCount[n] = (winsBySeatCount[n] || 0) + 1;
    }
    console.log(`11. สุ่ม ${GAMES} เกม (2–10 คน, ซ้อน/ไม่ซ้อน, 1 รอบ/300/500) · ${totalActions} แอ็กชัน · ปฏิเสธคำสั่งผิด ${illegalRejected} · จับได้ ${catches} · จบรอบ ${rounds} · ลงหลายใบ ${multiPlays} ครั้ง (มากสุด ${maxGroup} ใบ) ✓`);
    assert(multiPlays > 200, 'บอทต้องใช้ลงหลายใบบ้าง');
})();

// ---------- 12. บอทผ่าน API ของ runtime ----------
(function botApiTest() {
    const room = makeRoom(4, {}, { botFrom: 1 });
    E.startGame(room, mulberry32(42));
    const s = room.gameState;
    let guard = 0;
    while (s.phase === 'turn' && guard < 4000) {
        guard += 1;
        if (s.turn.playerId === 'p0') {
            const playable = E.playableIds(room, 'p0');
            if (playable.length) E.playCard(room, 'p0', { cardId: playable[0], color: 'b', callLast: true });
            else E.drawCard(room, 'p0');
            continue;
        }
        assert(E.botNeedsTurn(room), 'ตาบอท → botNeedsTurn');
        const delay = E.botDelay(room);
        assert(delay !== null && delay >= 0, 'botDelay ต้องมีค่า');
        E.playBotTurns(room, mulberry32(guard), Date.now() + 60000);
    }
    assert(s.phase === 'finished', 'เกมบอท + คน จบได้');
    console.log(`12. playBotTurns/botDelay ใช้กับ runtime ได้ (${guard} ตา) ✓`);
})();

// ---------- 13. UX: คนไม่อยู่ตาสั้นลง · ทุกคนพร้อม = รอบต่อไป · บอทจั่วแล้วรอก่อนลง · ข้อมูลให้ UI ----------
(function uxPacingTest() {
    // หมดเวลาติดกัน 2 ตา → ตาถัดไปสั้นลง · เล่นเองแล้วกลับเป็นเวลาปกติ
    const room = setup(2, { colorcardsTurnSeconds: 30 });
    const s = room.gameState;
    const timeoutTurn = () => { s.phaseEndsAt = Date.now() - 1; E.autoResolvePhase(room, mulberry32(5)); };
    const turnLen = () => s.phaseEndsAt - s.turn.startedAt;
    assert(s.turn.playerId === 'p1', 'ตาแรก p1');
    timeoutTurn(); // p1 หมดเวลา 1
    assert(s.seats[1].idle === 1 && turnLen() > 20000, 'หมดเวลาครั้งเดียวยังไม่นับว่าไม่อยู่');
    timeoutTurn(); // p0 หมดเวลา 1
    timeoutTurn(); // p1 หมดเวลา 2
    assert(s.seats[1].idle === 2, 'นับหมดเวลาติดกัน');
    assert(E.buildClientState(room, 'p0').seats[1].idle === true, 'UI รู้ว่าคนนี้ไม่อยู่');
    timeoutTurn(); // p0 หมดเวลา 2 → ตา p1 ต้องสั้น
    assert(s.turn.playerId === 'p1' && turnLen() <= 6000, `คนไม่อยู่ได้ตาสั้น (${turnLen()}ms)`);
    E.drawCard(room, 'p1', { turnSeq: s.turnSeq });
    assert(s.seats[1].idle === 0, 'เล่นเองแล้วรีเซ็ต');
    if (s.turn.playerId === 'p1') E.passTurn(room, 'p1', { turnSeq: s.turnSeq });
    assert(s.turn.playerId === 'p0' && turnLen() <= 6000, 'p0 หมดเวลา 2 ตาก็สั้นเหมือนกัน');
    E.drawCard(room, 'p0', { turnSeq: s.turnSeq });
    if (s.turn.playerId === 'p0') E.passTurn(room, 'p0', { turnSeq: s.turnSeq });
    assert(s.turn.playerId === 'p1' && turnLen() > 20000, 'กลับมาเล่นแล้ว ตาเวลาปกติ');

    // บอทไม่นับไม่อยู่
    const rb = makeRoom(2, {}, { botFrom: 1 });
    E.startGame(rb, () => 0, { deck: deckWithFirst(2, numCard('r', 5), mulberry32(7)) });
    rb.gameState.turn.playerId = 'bot_p1';
    rb.gameState.phaseEndsAt = Date.now() - 1;
    E.autoResolvePhase(rb, mulberry32(1));
    assert(!rb.gameState.seats[1].idle, 'บอทไม่ถูกนับว่าไม่อยู่');

    // จบรอบ: ทุกคนจริงที่ต่ออยู่กดพร้อม → รอบต่อไปเริ่มทันที (บอท/คนหลุดไม่ต้องรอ)
    const r3 = makeRoom(4, { colorcardsTarget: 300 }, { botFrom: 3 });
    E.startGame(r3, () => 0, { deck: deckWithFirst(4, numCard('r', 5), mulberry32(11)) });
    const u = r3.gameState;
    giveHand(r3, 1, [numCard('r', 1)]);
    [0, 2, 3].forEach(i => giveHand(r3, i, [numCard('b', i + 1)])); // มือเล็ก ไม่ให้ถึงเป้าในรอบเดียว
    u.seats[1].called = true;
    u.turn.playerId = 'p1';
    E.playCard(r3, 'p1', { cardId: numCard('r', 1) });
    assert(u.phase === 'roundEnd', 'จบรอบ 1');
    throws(() => E.readyNextRound(makeRoom(2), 'p0'), /ยังไม่จบรอบ/, 'กดพร้อมนอกช่วงจบรอบไม่ได้');
    assert(E.getAvailableActions(r3, 'p1').canReady === true, 'ปุ่มพร้อมโชว์ตอนจบรอบ');
    E.readyNextRound(r3, 'p1');
    assert(u.phase === 'roundEnd' && E.getAvailableActions(r3, 'p1').canReady === false, 'กดแล้วปุ่มหาย ยังรอคนอื่น');
    assert(E.buildClientState(r3, 'p0').roundReady.includes('p1'), 'UI เห็นว่าใครพร้อม');
    E.readyNextRound(r3, 'p1'); // กดซ้ำไม่เป็นไร
    assert(u.roundReady.length === 1, 'กดซ้ำไม่นับซ้ำ');
    r3.players[2].socketId = null; // p2 หลุด — ไม่ต้องรอ
    E.readyNextRound(r3, 'p0');
    assert(u.phase === 'turn' && u.round === 2, 'คนจริงที่ต่ออยู่พร้อมครบ → เริ่มรอบ 2 ทันที');
    assert(Array.isArray(u.roundReady) && u.roundReady.length === 0, 'รอบใหม่ล้างรายชื่อพร้อม');
    assert(E.getAvailableActions(r3, 'p1').canReady === false, 'ระหว่างเล่นไม่มีปุ่มพร้อม');

    // บอทจั่วได้ใบที่ลงได้ → รออีกครู่ก่อนลง (คนดูทันว่าจั่วก่อน)
    const r4 = makeRoom(2, {}, { botFrom: 1 });
    E.startGame(r4, () => 0, { deck: deckWithFirst(2, numCard('r', 5), mulberry32(3)) });
    const v = r4.gameState;
    v.turn.playerId = 'bot_p1';
    giveHand(r4, 1, [numCard('b', 9)]);
    v.drawPile.push(numCard('r', 7)); // ใบบนกองลงได้
    E.drawCard(r4, 'bot_p1', { turnSeq: v.turnSeq });
    assert(v.turn.drawnCardId && v.turn.drawnAt, 'จั่วได้ใบลงได้ บันทึกเวลาจั่ว');
    v.turn.startedAt = Date.now() - 5000; // ต้นตานานแล้ว แต่เพิ่งจั่ว
    const wait = E.botDelay(r4);
    assert(wait >= 500, `บอทรอหลังจั่วอย่างน้อยครึ่งวิ (${wait}ms)`);
    assert(!E.playBotTurns(r4, mulberry32(2), Date.now()), 'ยังไม่ลงทันทีหลังจั่ว');
    assert(E.playBotTurns(r4, mulberry32(2), Date.now() + 2000), 'ครบเวลาแล้วลง');

    // หน้าต่างจับบอกระยะเวลาให้ UI วาดแถบนับถอยหลังได้ถูก
    const r5 = setup(2);
    const w = r5.gameState;
    giveHand(r5, 1, [numCard('r', 1), numCard('r', 2)]);
    E.playCard(r5, 'p1', { cardId: numCard('r', 1) });
    const cw = E.buildClientState(r5, 'p0').catchWindow;
    assert(cw && cw.ms === E.CATCH_MS && cw.until > Date.now(), 'catchWindow มี ms');
    assert(w.catchWindow, 'ลืมบอก → เปิดหน้าต่างจับ');
    console.log('13. UX: หมดเวลา 2 ตาติด = ตาสั้น · พร้อมครบ = รอบใหม่ทันที · บอทจั่วแล้วรอก่อนลง · catch ms ✓');
})();

// ---------- 14. ลงหลายใบ (เลข/สัญลักษณ์เดียวกัน) ----------
(function multiPlayTest() {
    const snap = room => JSON.stringify(room.gameState);
    const [rSkip, rSkip2] = byKind('skip', 'r');
    const bSkip = byKind('skip', 'b')[0]; const gSkip = byKind('skip', 'g')[0];
    const rRev = byKind('rev', 'r')[0]; const bRev = byKind('rev', 'b')[0]; const gRev = byKind('rev', 'g')[0];
    const rD2 = byKind('d2', 'r')[0]; const bD2 = byKind('d2', 'b')[0]; const gD2 = byKind('d2', 'g')[0]; const yD2 = byKind('d2', 'y')[0];
    const b5 = numCard('b', 5); const g5 = numCard('g', 5); const y5 = numCard('y', 5);

    // a. เลขเดียวกันคนละสี ลงพร้อมกัน · ใบสุดท้ายอยู่บน = สีต่อไป
    let room = setup(3);
    let s = room.gameState;
    assert(s.config.multi === true, 'ลงหลายใบเปิดเป็นค่าเริ่ม');
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2), numCard('b', 9)]);
    E.playCard(room, 'p1', { cardIds: [b5, g5, y5] }, ctxOf(room));
    assert(s.seats[1].hand.length === 2 && s.discard.slice(-3).join() === [b5, g5, y5].join(), 'ลง 3 ใบ เรียงตามที่เลือก');
    assert(s.currentColor === 'y' && E.getCard(s.discard[s.discard.length - 1]).color === 'y', 'ใบสุดท้าย (เหลือง) อยู่บน = สีต่อไป');
    assert(s.turn.playerId === 'p2', 'ลงเลขหลายใบ เดินตาปกติ');
    assert(/ผู้เล่น1 ลง 5 สามใบ!/.test(s.history[0].text), `บันทึก "ลง 5 สามใบ!" (${s.history[0].text})`);
    const fx = s.fx[s.fx.length - 1];
    assert(fx.kind === 'play' && fx.count === 3 && fx.cards.map(c => c.id).join() === [b5, g5, y5].join() && fx.card.id === y5, 'fx บอกทั้งกลุ่ม ใบบนสุดท้าย');
    noLeak(room, 'ลงหลายใบ');
    conservation(room, 'ลงหลายใบ');
    const view = E.buildClientState(room, 'p0');
    assert(view.top.id === y5 && view.pile.slice(-3).map(c => c.id).join() === [b5, g5, y5].join(), 'คนอื่นเห็นกองทิ้งทั้งกลุ่ม');

    // b. ลำดับต่างกัน → สีบนสุดต่างกัน · ใบแรกต้องลงได้เอง
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2)]);
    E.playCard(room, 'p1', { cardIds: [g5, y5, b5] });
    assert(s.currentColor === 'b', 'เรียงใหม่ ใบสุดท้ายน้ำเงิน → สีน้ำเงิน');
    room = setup(3); s = room.gameState;
    const r7 = numCard('r', 7); const b7 = numCard('b', 7); const g7 = numCard('g', 7);
    giveHand(room, 1, [r7, b7, g7, numCard('y', 1)]);
    let before = snap(room);
    throws(() => E.playCard(room, 'p1', { cardIds: [b7, r7] }), /ใบแรกไม่ได้/, 'ใบแรกลงไม่ได้ (น้ำเงิน 7 บนแดง 5)');
    assert(snap(room) === before, 'ปฏิเสธแล้ว state เดิม');
    E.playCard(room, 'p1', { cardIds: [r7, b7, g7] });
    assert(s.currentColor === 'g' && s.seats[1].hand.length === 1, 'ใบแรกแดงตรงสี ที่เหลือแค่เลขเดียวกัน');

    // c. กลุ่มผิดกติกา — ปฏิเสธพร้อมเหตุผล ไม่แตะ state
    room = setup(3); s = room.gameState;
    const wild = byKind('wild')[0]; const d4 = byKind('d4')[0];
    giveHand(room, 1, [b5, g5, numCard('r', 2), wild, d4, rSkip, rD2, numCard('b', 9)]);
    before = snap(room);
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, numCard('r', 2)] }), /เฉพาะเลขเดียวกัน/, 'เลขต่างกัน');
    throws(() => E.playCard(room, 'p1', { cardIds: [rSkip, rD2] }), /เฉพาะเลขเดียวกัน/, 'สัญลักษณ์ต่างกัน (ข้าม + +2)');
    throws(() => E.playCard(room, 'p1', { cardIds: [numCard('r', 2), b5] }), /เฉพาะเลขเดียวกัน/, 'สีเดียวกันแต่เลขต่าง');
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, wild], color: 'r' }), /ทีละใบ/, 'เปลี่ยนสีในกลุ่ม');
    throws(() => E.playCard(room, 'p1', { cardIds: [wild, d4], color: 'r' }), /ทีละใบ/, 'เปลี่ยนสี + +4');
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, y5] }), /ไม่มีไพ่/, 'ใบที่ไม่ได้อยู่ในมือ');
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, b5] }), /ซ้ำ/, 'ใบเดียวกันซ้ำ');
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, 42] }), /ไม่มีไพ่/, 'id ไม่ใช่ string');
    throws(() => E.playCard(room, 'p1', { cardIds: Array(9).fill(b5) }), /ไม่เกิน/, 'เกิน 8 ใบ');
    throws(() => E.playCard(room, 'p2', { cardIds: [b5, g5] }), /ยังไม่ถึงตา/, 'ลงหลายใบนอกตา');
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, g5] }, { turnSeq: s.turnSeq - 1 }), /จังหวะ/, 'turnSeq เก่า');
    assert(snap(room) === before, 'ปฏิเสธทุกแบบ state เดิม');

    // d. ปิดในห้อง → ลงได้ทีละใบ
    room = setup(3, { colorcardsMulti: false }); s = room.gameState;
    assert(s.config.multi === false, 'ปิดลงหลายใบ');
    giveHand(room, 1, [b5, g5, numCard('r', 2)]);
    before = snap(room);
    throws(() => E.playCard(room, 'p1', { cardIds: [b5, g5] }), /ทีละใบ/, 'ห้องปิด ลงหลายใบไม่ได้');
    assert(snap(room) === before, 'ห้องปิด ปฏิเสธแล้ว state เดิม');
    assert(E.groupMates(s, s.seats[1].hand, b5).length === 0, 'ห้องปิด ไม่มีใบที่เพิ่มได้');
    assert(!E.getAvailableActions(room, 'p1').canCall, 'ห้องปิด 3 ใบ ยังกดเหลือใบเดียวไม่ได้');
    E.playCard(room, 'p1', { cardIds: [b5] });
    assert(s.currentColor === 'b' && s.turn.playerId === 'p2', 'ห้องปิด ลงใบเดียวผ่าน cardIds ได้');

    // e. ข้าม ×N = ข้าม N คน
    room = setup(4); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, numCard('b', 1), numCard('b', 2)]);
    E.playCard(room, 'p1', { cardIds: [rSkip, bSkip] });
    assert(s.turn.playerId === 'p0' && s.currentColor === 'b', 'ข้าม ×2 (4 คน) → ข้าม p2 p3 ตกที่ p0');
    assert(s.fx.filter(e => e.kind === 'skip').slice(-2).map(e => e.playerId).join() === 'p2,p3', 'fx ข้ามทั้งสองคน');
    room = setup(4); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, gSkip, numCard('b', 2)]);
    E.playCard(room, 'p1', { cardIds: [rSkip, bSkip, gSkip] });
    assert(s.turn.playerId === 'p1', 'ข้าม ×3 (4 คน) → วนกลับมาตัวเอง');
    room = setup(5); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, numCard('b', 2)]);
    E.playCard(room, 'p1', { cardIds: [rSkip, bSkip] });
    assert(s.turn.playerId === 'p4', 'ข้าม ×2 (5 คน) → p4');
    room = setup(2); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, numCard('b', 2)]);
    E.playCard(room, 'p1', { cardIds: [rSkip, bSkip] });
    assert(s.turn.playerId === 'p0', 'ข้าม ×2 (2 คน) → ข้ามทั้งสองที่นั่ง ตกที่ p0');
    room = setup(2); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, gSkip, numCard('b', 2)]);
    E.playCard(room, 'p1', { cardIds: [rSkip, bSkip, gSkip] });
    assert(s.turn.playerId === 'p1', 'ข้าม ×3 (2 คน) → ได้เล่นต่อ');
    conservation(room, 'ข้ามหลายใบ');

    // f. กลับทิศ ×N
    room = setup(4); s = room.gameState;
    giveHand(room, 1, [rRev, bRev, numCard('b', 1)]);
    E.playCard(room, 'p1', { cardIds: [rRev, bRev] });
    assert(s.direction === 1 && s.turn.playerId === 'p2', 'กลับทิศ ×2 (4 คน) = ทิศเดิม → p2');
    assert(s.fx.some(e => e.kind === 'reverse' && e.times === 2), 'fx กลับทิศบอกจำนวนครั้ง');
    room = setup(4); s = room.gameState;
    giveHand(room, 1, [rRev, bRev, gRev, numCard('b', 1)]);
    E.playCard(room, 'p1', { cardIds: [rRev, bRev, gRev] });
    assert(s.direction === -1 && s.turn.playerId === 'p0', 'กลับทิศ ×3 (4 คน) = กลับ → p0');
    room = setup(2); s = room.gameState;
    giveHand(room, 1, [rRev, bRev, numCard('b', 1)]);
    E.playCard(room, 'p1', { cardIds: [rRev, bRev] });
    assert(s.turn.playerId === 'p0' && s.direction === 1, 'กลับทิศ ×2 (2 คน) = ข้าม 2 → p0');
    room = setup(2); s = room.gameState;
    giveHand(room, 1, [rRev, bRev, gRev, numCard('b', 1)]);
    E.playCard(room, 'p1', { cardIds: [rRev, bRev, gRev] });
    assert(s.turn.playerId === 'p1', 'กลับทิศ ×3 (2 คน) = ข้าม 3 → ได้เล่นต่อ');

    // g. +2 ×N (ไม่ซ้อน) = คนถัดไปจั่ว 2N แล้วโดนข้าม
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [rD2, bD2, numCard('b', 1)]);
    let h = s.seats[2].hand.length;
    E.playCard(room, 'p1', { cardIds: [rD2, bD2] });
    assert(s.seats[2].hand.length === h + 4 && s.turn.playerId === 'p0' && s.currentColor === 'b', '+2 ×2 → p2 จั่ว 4 โดนข้าม');
    room = setup(4); s = room.gameState;
    giveHand(room, 1, [rD2, bD2, gD2, numCard('b', 1)]);
    h = s.seats[2].hand.length;
    E.playCard(room, 'p1', { cardIds: [rD2, bD2, gD2] });
    assert(s.seats[2].hand.length === h + 6 && s.turn.playerId === 'p3', '+2 ×3 (4 คน) → p2 จั่ว 6 → p3');
    room = setup(2); s = room.gameState;
    giveHand(room, 1, [rD2, bD2, numCard('b', 1)]);
    h = s.seats[0].hand.length;
    E.playCard(room, 'p1', { cardIds: [rD2, bD2] });
    assert(s.seats[0].hand.length === h + 4 && s.turn.playerId === 'p1', '+2 ×2 (2 คน) → p0 จั่ว 4 ได้เล่นต่อ');
    conservation(room, '+2 หลายใบ');

    // h. ซ้อน: กลุ่ม +2 เปิดซ้อน / ตอบซ้อน / +2 ทับ +4 ไม่ได้
    room = setup(3, { colorcardsStacking: true }); s = room.gameState;
    giveHand(room, 1, [rD2, bD2, numCard('b', 1)]);
    giveHand(room, 2, [gD2, yD2, numCard('y', 1), numCard('y', 2)]);
    E.playCard(room, 'p1', { cardIds: [rD2, bD2] });
    assert(s.pendingDraw === 4 && s.pendingKind === 'd2' && s.turn.playerId === 'p2', 'ซ้อน: +2 ×2 ค้าง 4');
    before = snap(room);
    throws(() => E.playCard(room, 'p2', { cardIds: [gD2, numCard('y', 1)] }), /เฉพาะเลขเดียวกัน/, 'ตอบซ้อนด้วยกลุ่มปนเลข');
    throws(() => E.playCard(room, 'p2', { cardIds: [numCard('y', 1), numCard('y', 2)] }), /ต้องซ้อน|เฉพาะเลข/, 'มี +2 ค้าง ลงเลขไม่ได้');
    assert(snap(room) === before, 'ปฏิเสธตอบซ้อนผิด state เดิม');
    E.playCard(room, 'p2', { cardIds: [gD2, yD2] });
    assert(s.pendingDraw === 8 && s.turn.playerId === 'p0' && s.currentColor === 'y', 'ตอบซ้อนด้วย +2 ×2 → ค้าง 8');
    h = s.seats[0].hand.length;
    E.drawCard(room, 'p0');
    assert(s.seats[0].hand.length === h + 8 && s.pendingDraw === 0 && s.turn.playerId === 'p1', 'รับทั้ง 8');
    conservation(room, 'ซ้อนหลายใบ');
    room = setup(3, { colorcardsStacking: true }); s = room.gameState;
    giveHand(room, 1, [d4, numCard('b', 1), numCard('b', 2)]);
    giveHand(room, 2, [gD2, yD2, numCard('y', 1)]);
    E.playCard(room, 'p1', { cardId: d4, color: 'g' });
    throws(() => E.playCard(room, 'p2', { cardIds: [gD2, yD2] }), /ต้องซ้อน/, '+2 ×2 ทับ +4 ไม่ได้');

    // i. เหลือใบเดียวหลังลงหลายใบ
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2)]);
    assert(E.getAvailableActions(room, 'p1').canCall === true, '4 ใบ มีเลข 5 สามใบ → ลงแล้วเหลือ 1 → กดเหลือใบเดียวได้');
    E.playCard(room, 'p1', { cardIds: [b5, g5, y5] });
    assert(s.seats[1].hand.length === 1 && s.catchWindow && s.catchWindow.playerId === 'p1', 'ลืมกด → เปิดหน้าต่างจับ');
    assert(E.buildClientState(room, 'p2').availableActions.canCatch === 'p1', 'คนอื่นจับได้');
    E.catchPlayer(room, 'p2', 'p1');
    assert(s.seats[1].hand.length === 3, 'โดนจับ → จั่ว 2');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2)]);
    E.playCard(room, 'p1', { cardIds: [b5, g5, y5], callLast: true });
    assert(s.seats[1].called && !s.catchWindow, 'กดพร้อมลงหลายใบ → ปลอดภัย');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2)]);
    E.callLast(room, 'p1');
    assert(s.seats[1].called, 'กดล่วงหน้าตอนมี 4 ใบ (ลงได้ 3) ได้');
    E.playCard(room, 'p1', { cardIds: [b5, g5, y5] });
    assert(s.seats[1].called && !s.catchWindow, 'กดล่วงหน้าแล้วลงหลายใบ → ปลอดภัย');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, numCard('r', 2), numCard('b', 9)]);
    throws(() => E.callLast(room, 'p1'), /กดได้ตอน/, '4 ใบ ลงได้มากสุด 2 → ยังกดไม่ได้');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2)]);
    E.callLast(room, 'p1');
    E.playCard(room, 'p1', { cardIds: [b5] });
    assert(!s.seats[1].called && s.seats[1].hand.length === 3, 'กดล่วงหน้าแต่ลงใบเดียว → ล้างสถานะ');

    // j. ลงหมดมือทั้งกลุ่ม = ชนะรอบ (แต้มเหมือนเดิม)
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5]);
    giveHand(room, 0, [numCard('b', 9), rSkip2]);
    giveHand(room, 2, [wild, numCard('y', 3)]);
    E.playCard(room, 'p1', { cardIds: [b5, g5] });
    assert(s.phase === 'finished' && s.winner.playerId === 'p1', 'ลงหมดมือเป็นกลุ่ม → ชนะ');
    assert(s.roundResult.points === 9 + 20 + 50 + 3, 'แต้มคิดเหมือนเดิม');
    conservation(room, 'ชนะด้วยกลุ่ม');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [rD2, bD2]);
    h = s.seats[2].hand.length;
    E.playCard(room, 'p1', { cardIds: [rD2, bD2] });
    assert(s.phase === 'finished' && s.seats[2].hand.length === h + 4, '+2 ×2 ใบสุดท้าย คนถัดไปยังจั่ว 4');

    // k. จั่วแล้ว ลงได้แค่ใบที่จั่ว (ใบเดียว)
    room = setup(3); s = room.gameState;
    const r8 = numCard('r', 8); const b8 = numCard('b', 8);
    giveHand(room, 1, [b8, numCard('b', 1)]);
    s.drawPile.splice(s.drawPile.indexOf(r8), 1); s.drawPile.push(r8);
    E.drawCard(room, 'p1');
    assert(s.turn.drawnCardId === r8, 'จั่วได้ใบลงได้');
    throws(() => E.playCard(room, 'p1', { cardIds: [r8, b8] }), /จั่วแล้ว/, 'จั่วแล้วลงหลายใบไม่ได้');
    E.playCard(room, 'p1', { cardIds: [r8] });
    assert(s.turn.playerId === 'p2', 'ลงใบที่จั่วใบเดียวได้');

    // l. สับกองทิ้งหลังลงหลายใบ → fx ไม่อ้างไพ่ที่กลับเข้ากองจั่ว
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('r', 2)]);
    E.playCard(room, 'p1', { cardIds: [b5, g5, y5] });
    const top = s.discard[s.discard.length - 1];
    s.discard.unshift(...s.drawPile.splice(0, s.drawPile.length));
    s.discard = s.discard.filter(id => id !== top).concat([top]);
    E.drawCard(room, 'p2');
    assert(!s.fx.some(e => e.cards), 'สับกองแล้วล้าง fx.cards');
    noLeak(room, 'สับกองหลังลงหลายใบ');
    conservation(room, 'สับกองหลังลงหลายใบ');

    // m. บอท: ทิ้งเลขเดียวกันทั้งหมด จบด้วยสีที่ถือเยอะสุด · ข้ามเลือกจำนวนที่ได้ตากลับมา
    room = setup(3); s = room.gameState;
    setTop(room, r7);
    const y7 = numCard('y', 7);
    giveHand(room, 1, [b7, g7, y7, numCard('g', 1), numCard('g', 2), numCard('b', 9)]);
    let move = E.chooseBotMove(room, s.seats[1], mulberry32(3));
    assert(move.type === 'play' && move.cardIds.length === 3, `บอททิ้ง 7 ทั้งสามใบ (${move.cardIds})`);
    assert(E.getCard(move.cardIds[2]).color === 'g', 'บอทจบด้วยสีเขียว (เหลือเขียวเยอะสุด)');
    E.playCard(room, 'p1', move, ctxOf(room));
    assert(s.currentColor === 'g', 'บอทลงแล้วสีเขียว');
    room = setup(2); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, numCard('g', 1), numCard('g', 2)]);
    move = E.chooseBotMove(room, s.seats[1], () => 0.99);
    if (E.getCard(move.cardId).kind === 'skip') assert(move.cardIds.length === 1, '2 คน: บอทลงข้ามใบเดียว (ได้ตาต่อ) ไม่ลงสองใบ');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [rSkip, bSkip, numCard('g', 1)]);
    move = E.chooseBotMove(room, s.seats[1], () => 0.5);
    assert(move.cardIds.length === 2, '3 คน: บอทข้าม ×2 → ได้ตาต่อ');
    E.playCard(room, 'p1', move);
    assert(s.turn.playerId === 'p1', 'ข้าม ×2 (3 คน) ได้ตาต่อจริง');
    room = setup(3); s = room.gameState;
    giveHand(room, 1, [b5, g5]);
    move = E.chooseBotMove(room, s.seats[1], mulberry32(9));
    assert(move.cardIds.length === 2, 'บอทลงหมดมือได้ ลงเลย');
    room = setup(3, { colorcardsMulti: false }); s = room.gameState;
    giveHand(room, 1, [b5, g5, y5, numCard('g', 1)]);
    move = E.chooseBotMove(room, s.seats[1], mulberry32(9));
    assert(move.cardIds.length === 1, 'ห้องปิด บอทลงใบเดียว');
    console.log('14. ลงหลายใบ: เลข/สัญลักษณ์เดียวกัน · ลำดับ+สีบนสุด · ใบแรกต้องลงได้ · กลุ่มผิดโดนปฏิเสธ · ข้าม/กลับทิศ/+2 ×N (2–5 คน) · ซ้อน · เหลือใบเดียว · ชนะ · ห้องปิด · บอท ✓');
})();

console.log(`\n✅ smoke-colorcards-engine: ${checks} checks passed`);
