/**
 * เทสกติกาจริงของ Undercover (แอป Yanstar) ที่เปลี่ยนในรอบ rules-fidelity — ไม่ต้องมีเซิร์ฟเวอร์
 * รัน: node scripts/smoke-undercover-rules.js
 *
 * ครอบคลุม: 3 คนเล่นได้ · จำนวนบทแนะนำ + ตั้งเอง (ลดเองถ้าเกิน) · Mr. White เปิดเป็นค่าเริ่ม (5 คนขึ้นไป)
 * ฝ่ายแฝงชนะเมื่อเหลือพลเมือง 1 คน · โหวตเสมอ 3 แบบ (speak / revote / none) · แต้มต่อบท + คะแนนสะสมในห้อง
 * ค่าตั้งห้องผ่าน roomManager (create + updateRoom)
 */

require('./isolateTestData');
const engine = require('../games/undercoverEngine');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}
function throwsWith(fn, pattern, msg) {
    try {
        fn();
    } catch (error) {
        assert(pattern.test(error.message), `${msg} (ได้ error: ${error.message})`);
        return;
    }
    throw new Error(`${msg} — ควร throw แต่ไม่ throw`);
}

function makeRoom(playerCount, settings = {}) {
    return {
        roomId: 'rules',
        name: 'UndercoverRules',
        admin: 'p0',
        players: Array.from({ length: playerCount }, (_, i) => ({
            playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '👤', socketId: 'sock' + i
        })),
        settings: { gameMode: 'undercover', ...settings },
        gameState: engine.createInitialState()
    };
}
function started(playerCount, settings) {
    const room = makeRoom(playerCount, settings);
    engine.startGame(room);
    return room;
}
const S = room => ({ step: room.gameState.step });
const byRole = (room, role) => room.gameState.players.filter(p => p.role === role);
const alive = room => room.gameState.players.filter(p => p.alive);
const speaker = room => room.gameState.speakerOrder[room.gameState.speakerIndex];
function readyAll(room) {
    alive(room).filter(p => !p.ready).forEach(p => engine.submitReady(room, p.playerId, S(room)));
}
function speakAll(room) {
    let guard = 0;
    while (room.gameState.phase === 'clue' && guard++ < 20) engine.submitClueDone(room, speaker(room), S(room));
}
/** ทุกคนที่โหวตได้โหวต target (ตัว target โหวตคนอื่น) */
function voteOut(room, targetId) {
    const voters = alive(room).map(p => p.playerId);
    voters.forEach(voterId => {
        if (room.gameState.phase !== 'vote') return;
        const other = voters.find(id => id !== voterId && id !== targetId);
        engine.submitVote(room, voterId, voterId === targetId ? other : targetId, S(room));
    });
}
function nextRound(room) {
    if (room.gameState.phase === 'elimination') engine.continueAfterResult(room, 'p0', S(room));
}
/** โหวตพลเมืองออกทีละคนจนเกมจบ */
function voteCiviliansUntilEnd(room) {
    let guard = 0;
    while (room.gameState.phase !== 'finished' && guard++ < 12) {
        if (room.gameState.phase === 'reveal') readyAll(room);
        speakAll(room);
        const civ = alive(room).find(p => p.role === 'civilian');
        voteOut(room, civ.playerId);
        nextRound(room);
    }
}

// ---------------------------------------------------------------- จำนวนบท
{
    // แนะนำ: 3–6 คน สายแฝง 1 · 7–9 คน 2 · 10 คน 3 · Mr. White 1 ตั้งแต่ 5 คน
    const table = { 3: [1, 0], 4: [1, 0], 5: [1, 1], 6: [1, 1], 7: [2, 1], 8: [2, 1], 9: [2, 1], 10: [3, 1] };
    Object.entries(table).forEach(([n, [uc, mw]]) => {
        const counts = engine.getRoleCounts(Number(n), true, 'auto');
        assert(counts.undercover === uc && counts.mrWhite === mw, `${n} คน ต้อง สายแฝง ${uc} + Mr. White ${mw} (ได้ ${JSON.stringify(counts)})`);
        const civ = Number(n) - counts.undercover - counts.mrWhite;
        assert(civ > counts.undercover + counts.mrWhite, `${n} คน พลเมืองต้องมากกว่าฝ่ายแฝง`);
    });
    // ตั้งเองเกินไป → ลดลงเอง ให้พลเมืองยังมากกว่าเสมอ
    assert(engine.getRoleCounts(5, true, 3).undercover === 1 && engine.getRoleCounts(5, true, 3).mrWhite === 1, '5 คนขอสายแฝง 3 → เหลือ 1 + Mr. White');
    assert(engine.getRoleCounts(7, true, 3).undercover === 2, '7 คนขอ 3 → ลดเหลือ 2');
    assert(engine.getRoleCounts(4, false, 2).undercover === 1, '4 คนขอ 2 → ลดเหลือ 1');
    assert(engine.getRoleCounts(6, false, 2).undercover === 2, '6 คนขอ 2 ได้ (พลเมือง 4)');
    assert(engine.getRoleCounts(10, false, 1).undercover === 1, 'ตั้ง 1 คนได้ 1 จริง');
    for (let n = 3; n <= 10; n += 1) {
        engine.UNDERCOVER_COUNT_OPTIONS.forEach(opt => [true, false].forEach(mwOn => {
            const c = engine.getRoleCounts(n, mwOn, opt);
            assert(c.undercover >= 1, 'ต้องมีสายแฝงอย่างน้อย 1');
            assert(n - c.undercover - c.mrWhite > c.undercover + c.mrWhite, `${n} คน (${opt}) พลเมืองต้องมากกว่าฝ่ายแฝง`);
        }));
    }
    // sanitize
    assert(engine.sanitizeUndercoverCount('2') === 2 && engine.sanitizeUndercoverCount('9') === 'auto' && engine.sanitizeUndercoverCount(undefined) === 'auto', 'sanitize จำนวนสายแฝง');
    assert(engine.sanitizeTieRule('none') === 'none' && engine.sanitizeTieRule('x') === 'speak' && engine.sanitizeTieRule() === 'speak', 'sanitize กติกาเสมอ');
    // Mr. White เปิดเป็นค่าเริ่ม (ตั้งค่าว่าง) · ปิดได้
    assert(engine.isMrWhiteEnabled({}) && engine.isMrWhiteEnabled(undefined) && !engine.isMrWhiteEnabled({ undercoverMrWhite: false }), 'Mr. White ค่าเริ่ม = เปิด');
    const room = started(5);
    assert(byRole(room, 'mrwhite').length === 1, 'ห้องไม่ได้ตั้งค่า 5 คน ต้องมี Mr. White');
    const off = started(5, { undercoverMrWhite: false });
    assert(byRole(off, 'mrwhite').length === 0, 'ปิด Mr. White แล้วต้องไม่มี');
    const manual = started(8, { undercoverCount: 3, undercoverMrWhite: false });
    assert(byRole(manual, 'undercover').length === 3, '8 คนตั้งสายแฝง 3 ต้องได้ 3');
    console.log('✓ จำนวนบทแนะนำ / ตั้งเอง / ลดเองเมื่อเกิน / Mr. White ค่าเริ่มเปิด');
}

// ---------------------------------------------------------------- 3 คนเล่นได้
{
    const room = started(3);
    assert(byRole(room, 'undercover').length === 1 && byRole(room, 'civilian').length === 2, '3 คน = พลเมือง 2 สายแฝง 1');
    readyAll(room);
    speakAll(room);
    voteOut(room, byRole(room, 'civilian')[0].playerId);
    assert(room.gameState.phase === 'finished' && room.gameState.winner.team === 'undercover', '3 คน โหวตพลเมืองออก = เหลือพลเมือง 1 ฝ่ายแฝงชนะ');
    const room2 = started(3);
    readyAll(room2);
    speakAll(room2);
    voteOut(room2, byRole(room2, 'undercover')[0].playerId);
    assert(room2.gameState.winner.team === 'civilians', '3 คน โหวตสายแฝงออก = พลเมืองชนะ');
    console.log('✓ 3 คนเล่นได้');
}

// ---------------------------------------------------------------- ฝ่ายแฝงชนะเมื่อเหลือพลเมือง 1 คน
{
    // 6 คน สายแฝง 2 ไม่มี Mr. White: พลเมือง 4 → โหวตพลเมืองออก 3 คน = เหลือ 3 คน (สายแฝง 2 + พลเมือง 1) จบเลย
    const room = started(6, { undercoverCount: 2, undercoverMrWhite: false });
    voteCiviliansUntilEnd(room);
    assert(room.gameState.winner.team === 'undercover', 'เหลือพลเมือง 1 คน = ฝ่ายแฝงชนะ');
    assert(alive(room).length === 3, 'จบตอนเหลือ 3 คน (กติกาเดิม "2 คนสุดท้าย" จะเล่นต่อ)');
    assert(/พลเมืองแค่ 1/.test(room.gameState.winner.reason), 'เหตุผลบอกว่าเหลือพลเมือง 1 คน');
}
{
    // 7 คน: สายแฝง 2 + Mr. White 1 + พลเมือง 4 → ชนะด้วยกัน (Mr. White อยู่ในผู้ชนะด้วย)
    const room = started(7);
    const mw = byRole(room, 'mrwhite')[0];
    voteCiviliansUntilEnd(room);
    assert(room.gameState.winner.team === 'undercover' && alive(room).length === 4, '7 คน เหลือพลเมือง 1 = ฝ่ายแฝงชนะตอนเหลือ 4 คน');
    assert(room.gameState.winner.winnerIds.includes(mw.playerId), 'สายแฝงกับ Mr. White ชนะด้วยกัน');
    assert(room.gameState.points[mw.playerId] === 6, 'Mr. White ฝั่งชนะได้ 6 แต้ม');
    byRole(room, 'undercover').forEach(p => assert(room.gameState.points[p.playerId] === 10, 'สายแฝงชนะได้ 10 แต้ม'));
    byRole(room, 'civilian').forEach(p => assert(room.gameState.points[p.playerId] === 0, 'พลเมืองแพ้ได้ 0'));
    console.log('✓ ฝ่ายแฝงชนะเมื่อเหลือพลเมือง 1 คน · ชนะด้วยกัน · แต้ม 10/6');
}

// ---------------------------------------------------------------- โหวตเสมอ
function tieAB(room) {
    // a,b ได้คนละ 2 เสียง (6 คน ไม่มี Mr. White → ไม่ต้องลุ้นช่วงทาย)
    const [a, b, c, d, e, f] = alive(room).map(p => p.playerId);
    [[a, b], [b, a], [c, a], [d, b], [e, a], [f, b]].forEach(([v, t]) => engine.submitVote(room, v, t, S(room)));
    return { a, b, c, d, e, f };
}
{
    // speak (ค่าเริ่ม): คนที่เสมอใบ้เพิ่ม → คนที่เหลือโหวตใหม่เฉพาะคนที่เสมอ → ชนะขาดออก
    const room = started(6, { undercoverMrWhite: false });
    readyAll(room);
    speakAll(room);
    const { a, b, c, d, e, f } = tieAB(room);
    const st = room.gameState;
    assert(st.phase === 'clue' && st.tieBreak && st.round === 1, 'เสมอ = ใบ้เพิ่มในรอบเดิม');
    assert(st.speakerOrder.length === 2 && st.speakerOrder.every(id => [a, b].includes(id)), 'คิวใบ้เพิ่มมีแค่คนที่เสมอ');
    const view = engine.buildClientState(room, c);
    assert(view.tieBreak && view.tieBreak.candidates.length === 2, 'client เห็นว่ากำลังใบ้เพิ่มเพราะเสมอ');
    engine.submitClueDone(room, speaker(room), { ...S(room), text: 'ใบ้เพิ่มหนึ่ง' });
    assert(room.gameState.clues.slice(-1)[0].tiebreak === true, 'คำใบ้เพิ่มติดป้ายว่าเป็นช่วงเสมอ');
    speakAll(room);
    assert(room.gameState.phase === 'vote' && room.gameState.isRevote, 'ใบ้เพิ่มครบ = โหวตใหม่');
    const tiedView = engine.buildClientState(room, a);
    assert(tiedView.self.canVote === false && tiedView.self.isTied === true, 'คนที่เสมอโหวตรอบนี้ไม่ได้');
    assert(engine.buildClientState(room, c).self.canVote === true, 'คนที่ไม่เสมอโหวตได้');
    assert(tiedView.vote.voterCount === 4, 'นับคนโหวตเฉพาะคนที่ไม่เสมอ');
    throwsWith(() => engine.submitVote(room, a, b, S(room)), /เสมออยู่/, 'คนที่เสมอโหวตไม่ได้');
    engine.submitVote(room, c, a, S(room));
    engine.submitVote(room, d, a, S(room));
    engine.submitVote(room, e, a, S(room));
    assert(room.gameState.phase === 'vote', 'ยังรอคนที่ไม่เสมอโหวตให้ครบ');
    engine.submitVote(room, f, b, S(room));
    const st2 = room.gameState;
    assert(st2.lastElimination && st2.lastElimination.playerId === a || st2.phase === 'finished', 'โหวตใหม่ชนะขาด = คนนั้นออก');
    assert(!room.gameState.players.find(p => p.playerId === a).alive, 'a ถูกโหวตออก');
}
{
    // speak: ทุกคนในวงเสมอกันหมด → ทุกคนใบ้เพิ่ม และทุกคนโหวตได้ (ไม่มี "คนที่เหลือ")
    const room = started(4, { undercoverMrWhite: false });
    readyAll(room);
    speakAll(room);
    const ids = alive(room).map(p => p.playerId);
    ids.forEach((id, i) => engine.submitVote(room, id, ids[(i + 1) % ids.length], S(room)));
    assert(room.gameState.tieBreak && room.gameState.speakerOrder.length === 4, 'เสมอทั้งวง = ทุกคนใบ้เพิ่ม');
    speakAll(room);
    assert(room.gameState.isRevote && engine.buildClientState(room, ids[0]).self.canVote, 'เสมอทั้งวง = ทุกคนโหวตใหม่ได้');
    ids.forEach((id, i) => engine.submitVote(room, id, ids[(i + 1) % ids.length], S(room)));
    assert(room.gameState.phase === 'elimination' && room.gameState.lastElimination.playerId === null, 'เสมออีก = ไม่มีใครออก');
    assert(room.gameState.lastElimination.reason === 'tie', 'บันทึกเหตุผลว่าเสมอ');
}
{
    // speak: Mr. White อยู่ในคนที่เสมอ ก็ยังห้ามใบ้เพิ่มเป็นคนแรก
    for (let i = 0; i < 60; i += 1) {
        const room = started(6);
        readyAll(room);
        speakAll(room);
        const mw = byRole(room, 'mrwhite')[0];
        const other = alive(room).find(p => p.playerId !== mw.playerId);
        const rest = alive(room).filter(p => p.playerId !== mw.playerId && p.playerId !== other.playerId);
        // mw และ other ได้คนละ 3 เสียง
        engine.submitVote(room, mw.playerId, other.playerId, S(room));
        engine.submitVote(room, other.playerId, mw.playerId, S(room));
        rest.forEach((p, idx) => engine.submitVote(room, p.playerId, idx % 2 ? other.playerId : mw.playerId, S(room)));
        assert(room.gameState.tieBreak, 'ต้องเสมอ');
        assert(room.gameState.speakerOrder[0] !== mw.playerId, 'Mr. White ห้ามใบ้เพิ่มเป็นคนแรก');
    }
    console.log('✓ เสมอแบบ speak: ใบ้เพิ่ม → คนที่เหลือโหวต · เสมอทั้งวง · Mr. White ไม่เริ่มก่อน');
}
{
    // revote: ไม่ใบ้เพิ่ม โหวตใหม่ทันที (คนที่เหลือโหวต)
    const room = started(6, { undercoverMrWhite: false, undercoverTieRule: 'revote' });
    readyAll(room);
    speakAll(room);
    const { a, c } = tieAB(room);
    assert(room.gameState.phase === 'vote' && room.gameState.isRevote && !room.gameState.tieBreak, 'revote = โหวตใหม่ทันที');
    throwsWith(() => engine.submitVote(room, a, c, S(room)), /เสมออยู่/, 'revote: คนที่เสมอโหวตไม่ได้');
}
{
    // none: เสมอ = ไม่มีใครออกเลย
    const room = started(6, { undercoverMrWhite: false, undercoverTieRule: 'none' });
    readyAll(room);
    speakAll(room);
    tieAB(room);
    assert(room.gameState.phase === 'elimination' && room.gameState.lastElimination.playerId === null, 'none = ไม่มีใครออก');
    assert(alive(room).length === 6, 'none: ทุกคนยังอยู่');
    nextRound(room);
    assert(room.gameState.phase === 'clue' && room.gameState.round === 2 && !room.gameState.tieBreak, 'รอบใหม่ไม่ค้างสถานะเสมอ');
    console.log('✓ เสมอแบบ revote / none');
}
{
    // คนที่เสมอออกจากห้องระหว่างใบ้เพิ่ม / ระหว่างโหวตใหม่ → อีกคนไม่ถูกคัดออกแทน เกมไม่ค้าง
    ['clue', 'vote'].forEach(when => {
        const room = started(6, { undercoverMrWhite: false });
        readyAll(room);
        speakAll(room);
        const { a, b } = tieAB(room);
        if (when === 'vote') speakAll(room);
        assert(room.gameState.phase === when, `ต้องอยู่ช่วง ${when}`);
        const leaver = room.gameState.players.find(p => p.playerId === a);
        const leaverWasLastSide = leaver.role === 'undercover' && byRole(room, 'undercover').filter(p => p.alive).length === 1;
        engine.handlePlayerLeft(room, a);
        if (leaverWasLastSide) {
            assert(room.gameState.phase === 'finished' && room.gameState.winner.team === 'civilians', 'สายแฝงคนเดียวออก = พลเมืองชนะ');
        } else {
            assert(room.gameState.phase === 'elimination' && room.gameState.lastElimination.reason === 'left', `ออกตอน ${when} = รอบนี้ไม่โหวตต่อ`);
            assert(room.gameState.players.find(p => p.playerId === b).alive, 'อีกคนที่เสมอต้องยังอยู่');
            assert(room.gameState.staleRounds === 0, 'มีคนออกไม่นับเป็นรอบโหวตไม่ลง');
        }
    });
    console.log('✓ คนที่เสมอออกกลางคัน: ไม่ค้าง ไม่คัดอีกคนออกแทน');
}

// ---------------------------------------------------------------- แต้ม + คะแนนสะสมในห้อง
{
    const room = makeRoom(5, { undercoverMrWhite: false });
    engine.startGame(room);
    readyAll(room);
    speakAll(room);
    const uc = byRole(room, 'undercover')[0];
    voteOut(room, uc.playerId);
    assert(room.gameState.winner.team === 'civilians', 'เกมแรกพลเมืองชนะ');
    byRole(room, 'civilian').forEach(p => assert(room.gameState.points[p.playerId] === 2, 'พลเมืองชนะได้ 2'));
    assert(room.gameState.points[uc.playerId] === 0, 'สายแฝงแพ้ได้ 0');
    const before = engine.buildClientState(room, 'p1');
    assert(before.points && before.roomScores.length === 5, 'จบเกมแล้วส่งแต้มและคะแนนสะสม');
    // เกมที่สองในห้องเดิม — สายแฝงชนะ → คะแนนสะสมบวกต่อ
    engine.startGame(room);
    assert(engine.buildClientState(room, 'p1').roomScores === null && engine.buildClientState(room, 'p1').points === null, 'ระหว่างเล่นไม่ส่งคะแนน');
    const uc2 = byRole(room, 'undercover')[0];
    const civ1 = byRole(room, 'civilian')[0];
    const civ1PrevPoints = room.undercoverScores[civ1.playerId].points;
    voteCiviliansUntilEnd(room);
    assert(room.gameState.winner.team === 'undercover', 'เกมสองสายแฝงชนะ');
    const board = engine.roomScoreboard(room);
    const ucRow = board.find(r => r.playerId === uc2.playerId);
    const prevUc = uc2.playerId === uc.playerId ? 0 : 2;
    assert(ucRow.points === prevUc + 10 && ucRow.games === 2, 'คะแนนสะสม = เกมก่อน + 10');
    assert(room.undercoverScores[civ1.playerId].points === civ1PrevPoints, 'คนแพ้ไม่ได้แต้มเพิ่ม');
    assert(board[0].points >= board[board.length - 1].points, 'เรียงมากไปน้อย');
    // finishGame ซ้ำไม่บวกแต้มซ้ำ
    const snapshot = JSON.stringify(room.undercoverScores);
    engine.autoResolvePhase(room, Date.now() + 999999);
    assert(JSON.stringify(room.undercoverScores) === snapshot, 'จบแล้วไม่บวกแต้มซ้ำ');
}
{
    // Mr. White ทายถูก ชนะคนเดียว 6 แต้ม
    const room = started(6);
    readyAll(room);
    speakAll(room);
    const mw = byRole(room, 'mrwhite')[0];
    voteOut(room, mw.playerId);
    engine.submitMrWhiteGuess(room, mw.playerId, room.gameState.pair.civilian, S(room));
    assert(room.gameState.winner.team === 'mrwhite', 'Mr. White ทายถูกชนะ');
    room.gameState.players.forEach(p => assert(room.gameState.points[p.playerId] === (p.playerId === mw.playerId ? 6 : 0), 'แต้ม Mr. White ชนะคนเดียว'));
    console.log('✓ แต้มต่อบท 2/6/10 + คะแนนสะสมในห้อง ไม่บวกซ้ำ');
}

// ---------------------------------------------------------------- ค่าตั้งห้องผ่าน roomManager
(async () => {
    const { randomUUID } = require('crypto');
    const roomManager = require('../managers/roomManager');
    const playerManager = require('../managers/playerManager');
    await playerManager.initPlayerManager();
    const hosts = {};
    for (const key of ['host-rules-1', 'host-rules-2', 'host-rules-3', 'host-rules-4']) {
        hosts[key] = (await playerManager.createOrGetPlayer(randomUUID(), key)).playerId;
    }
    const created = roomManager.createRoom({ name: 'UC rules', gameMode: 'undercover', maxPlayers: 8 }, hosts['host-rules-1']);
    assert(created.settings.undercoverMrWhite === true, 'สร้างห้องไม่ระบุ = Mr. White เปิด');
    assert(created.settings.undercoverCount === 'auto' && created.settings.undercoverTieRule === 'speak', 'ค่าเริ่ม: สายแฝงตามจำนวนคน · เสมอใบ้เพิ่ม');
    const custom = roomManager.createRoom({
        name: 'UC custom', gameMode: 'undercover', maxPlayers: 8,
        undercoverMrWhite: false, undercoverCount: '2', undercoverTieRule: 'none'
    }, hosts['host-rules-2']);
    assert(custom.settings.undercoverMrWhite === false && custom.settings.undercoverCount === 2 && custom.settings.undercoverTieRule === 'none', 'สร้างห้องตามที่เลือก');
    const junk = roomManager.createRoom({ name: 'UC junk', gameMode: 'undercover', undercoverCount: 'lots', undercoverTieRule: '<x>' }, hosts['host-rules-3']);
    assert(junk.settings.undercoverCount === 'auto' && junk.settings.undercoverTieRule === 'speak', 'ค่าแปลกถูกปัดเป็นค่าเริ่ม');
    roomManager.updateRoom(created.roomId, hosts['host-rules-1'], { undercoverCount: 3, undercoverTieRule: 'revote', undercoverMrWhite: false });
    const updated = roomManager.getRoom(created.roomId);
    assert(updated.settings.undercoverCount === 3 && updated.settings.undercoverTieRule === 'revote' && updated.settings.undercoverMrWhite === false, 'updateRoom เปลี่ยนค่าได้');
    roomManager.updateRoom(created.roomId, hosts['host-rules-1'], { undercoverCount: 99, undercoverTieRule: 'bogus' });
    assert(updated.settings.undercoverCount === 'auto' && updated.settings.undercoverTieRule === 'speak', 'updateRoom ปัดค่าแปลก');
    const insider = roomManager.createRoom({ name: 'Insider', gameMode: 'insider', undercoverCount: 2 }, hosts['host-rules-4']);
    assert(insider.settings.undercoverCount === undefined && insider.settings.undercoverMrWhite === false, 'ห้องเกมอื่นไม่มีค่าของ undercover');
    console.log('✓ roomManager: ค่าเริ่ม / สร้างตามเลือก / updateRoom / ปัดค่าแปลก');
    console.log(`\n✅ undercover rules: ${passed} assertions ผ่าน`);
    process.exit(0);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
