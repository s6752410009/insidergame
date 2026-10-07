/**
 * คลื่นความคิด — เทส engine โหมดแข่งทีม + ร่วมมือ (กติกาบอร์ดเกมจริง) ไม่มีเซิร์ฟเวอร์
 * รัน: npm run smoke:wavelength:teams   (WL_GAMES=600 สุ่มเยอะขึ้น · WL_SEED=7 เล่นซ้ำ)
 */
const engine = require('../games/wavelengthEngine');

let checks = 0;
function assert(cond, message) {
    if (!cond) throw new Error(message);
    checks += 1;
}
function throwsLike(fn, pattern, message) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error && (!pattern || pattern.test(error.message)), `${message} (ได้: ${error ? error.message : 'ไม่ throw'})`);
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
function makeEnv(seed) {
    let now = 1_700_000_000_000;
    return { rng: mulberry32(seed), now: () => now, tick: ms => { now += ms; } };
}
function makeRoom(count, variant = 'teams') {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        players.push({ playerId: 'p' + i, playerName: 'ผู้เล่น' + i, color: '#fff', avatar: '🙂', socketId: 's' + i });
    }
    return { roomId: 'R1', admin: 'p0', settings: { gameMode: 'wavelength', wavelengthMode: variant }, players, gameState: engine.createInitialState() };
}
function lateJoin(room, id) {
    const entry = { playerId: id, playerName: 'มาสาย' + id, color: '#0ff', avatar: '🐢', socketId: 'sock-' + id };
    room.players.push(entry);
    room.gameState.players.push(engine.createPlayerState(entry));
}
function leave(room, id) {
    room.players = room.players.filter(p => p.playerId !== id);
    room.gameState.players = room.gameState.players.filter(p => p.playerId !== id);
    if (room.admin === id && room.players.length) room.admin = room.players[0].playerId;
    engine.handlePlayerLeft(room, id);
}
function setOnline(room, id, online) {
    const entry = room.players.find(p => p.playerId === id);
    if (entry) entry.socketId = online ? 'sock-' + id : null;
}
const S = room => room.gameState;
const ctx = room => ({ round: S(room).round, phase: S(room).phase });
const teamOf = (room, id) => S(room).players.find(p => p.playerId === id).team;
const score = (room, t) => S(room).teams[t].score;

function giveClue(room, env) {
    const s = S(room);
    engine.pickCard(room, s.giverId, 0, ctx(room));
    const word = ['ทะเลสาบ', 'แมวส้ม', 'ข้าวมันไก่', 'รถเมล์', 'คุณครู', 'ตุ๊กตา'].find(w => engine.validateClue(w, s.card).ok) || 'สิ่งนี้';
    engine.submitClue(room, s.giverId, word, ctx(room), env);
}
/** เล่นตาเดียวของทีม: ใบ้ → หมุนเข็มไป dial → ทุกคนตกลง → ทีมโน้นโหวต side → เปิด */
function playTeamTurn(room, env, { target, dial, side }) {
    giveClue(room, env);
    const s = S(room);
    s.target = target;
    const [first, ...rest] = s.guesserIds;
    engine.movePin(room, first, dial, ctx(room));
    engine.lockPin(room, first, dial, ctx(room), env);
    rest.forEach(id => { if (S(room).phase === 'guess') engine.lockPin(room, id, null, ctx(room), env); });
    if (S(room).phase === 'leftright') {
        S(room).opponentIds.forEach(id => { if (S(room).phase === 'leftright') engine.voteSide(room, id, side, ctx(room), env); });
    }
    assert(S(room).phase === 'reveal', 'ตาจบที่เปิดเป้า');
    return S(room).lastRound;
}
function advance(room, env) {
    engine.nextRound(room, room.admin, ctx(room), env);
}

// ---------- 1. แบ่งทีม · แต้มตั้งต้น · ค่าเริ่มต้น ----------
(function setup() {
    for (let seed = 1; seed <= 40; seed += 1) {
        for (let n = 4; n <= 12; n += 1) {
            const env = makeEnv(seed * 31 + n);
            const room = makeRoom(n);
            delete room.settings.wavelengthMode; // ไม่ตั้ง = แข่งทีม
            engine.startGame(room, env);
            const s = S(room);
            assert(s.variant === 'teams', 'ไม่ตั้งโหมด = แข่งทีม');
            const a = s.players.filter(p => p.team === 'A').length;
            const b = s.players.filter(p => p.team === 'B').length;
            assert(a + b === n && Math.abs(a - b) <= 1, `แบ่งทีมเท่ากัน (${a}/${b})`);
            assert(s.teams[s.startTeam].score === 0 && s.teams[s.startTeam === 'A' ? 'B' : 'A'].score === 1, 'ทีมแรก 0 อีกทีม 1');
            assert(s.activeTeam === s.startTeam && teamOf(room, s.giverId) === s.startTeam, 'ผู้ใบ้คนแรกอยู่ทีมที่เริ่ม');
        }
    }
    const env = makeEnv(5);
    const three = makeRoom(3, 'teams');
    engine.startGame(three, env);
    assert(S(three).variant === 'coop' && S(three).coop.total === engine.COOP_CARDS, '3 คนเลือกทีม = เล่นร่วมมือแทน');
    assert(engine.clampVariant('x') === 'teams' && engine.clampVariant('solo') === 'solo', 'clampVariant');
    console.log('1. แบ่งทีมสุ่มเท่ากัน · ทีมแรก 0 อีกทีม 1 · 3 คน = ร่วมมือ ✓');
})();

// ---------- 2. ผู้ใบ้วนในทีม ทีมผลัดกัน ----------
(function rotation() {
    const env = makeEnv(11);
    const room = makeRoom(6);
    engine.startGame(room, env);
    const s = S(room);
    const seen = { A: [], B: [] };
    for (let turn = 0; turn < 12 && s.phase !== 'finished'; turn += 1) {
        const t = s.activeTeam;
        seen[t].push(s.giverId);
        assert(teamOf(room, s.giverId) === t, 'ผู้ใบ้อยู่ทีมที่ถึงตา');
        // พลาดตลอด ไม่มีใครถึง 10 ไม่มีตาพิเศษ
        playTeamTurn(room, env, { target: 10, dial: 90, side: 'right' });
        const prev = t;
        advance(room, env);
        if (s.phase === 'finished') break;
        assert(s.activeTeam !== prev, 'ทีมผลัดกันเล่น');
    }
    ['A', 'B'].forEach(t => {
        const members = s.order.filter(id => teamOf(room, id) === t);
        const firstLap = seen[t].slice(0, members.length);
        assert(new Set(firstLap).size === members.length, `ทีม ${t}: ทุกคนได้ใบ้ก่อนวนซ้ำ`);
        assert(seen[t][members.length] === seen[t][0], `ทีม ${t}: วนกลับคนแรก`);
    });
    console.log('2. ทีมผลัดกัน · ผู้ใบ้วนครบทุกคนในทีม ✓');
})();

// ---------- 3. เข็มร่วม · ตกลงครบ = ล็อก · ความลับ ----------
(function sharedDial() {
    const env = makeEnv(21);
    const room = makeRoom(6);
    engine.startGame(room, env);
    const s = S(room);
    giveClue(room, env);
    const [g1, g2] = s.guesserIds;
    const opp = s.opponentIds[0];
    assert(s.guesserIds.length === 2 && s.opponentIds.length === 3, 'ทีมละ 3: ทาย 2 · ฝ่ายตรงข้าม 3');
    assert(s.guesserIds.every(id => teamOf(room, id) === s.activeTeam) && !s.guesserIds.includes(s.giverId), 'คนหมุนเข็ม = เพื่อนร่วมทีมผู้ใบ้');
    throwsLike(() => engine.movePin(room, opp, 30, ctx(room)), /ทีมโน้น/, 'ทีมตรงข้ามหมุนเข็มไม่ได้');
    throwsLike(() => engine.movePin(room, s.giverId, 30, ctx(room)), /ผู้ใบ้/, 'ผู้ใบ้หมุนไม่ได้');
    throwsLike(() => engine.voteSide(room, opp, 'left', ctx(room)), /ยังไม่ใช่/, 'โหวตก่อนล็อกเข็มไม่ได้');
    engine.movePin(room, g1, 30, ctx(room));
    let view = engine.buildClientState(room, opp);
    assert(view.dial === 30 && view.target == null, 'ทุกคนเห็นเข็มร่วม แต่ไม่เห็นเป้า');
    assert(engine.buildClientState(room, s.giverId).target === s.target, 'ผู้ใบ้เห็นเป้า');
    assert(view.availableActions.canDial === false && engine.buildClientState(room, g1).availableActions.canDial, 'canDial เฉพาะทีมที่ทาย');
    engine.lockPin(room, g1, 30, ctx(room), env);
    assert(s.agreeIds.length === 1 && s.phase === 'guess', 'ตกลงคนเดียว ยังไม่ล็อก');
    const moved = engine.movePin(room, g2, 40, ctx(room));
    assert(moved.cleared && s.agreeIds.length === 0, 'หมุนเข็ม = ✅ ทุกคนหาย');
    engine.lockPin(room, g2, 40, ctx(room), env);
    engine.lockPin(room, g1, 30, ctx(room), env); // จอค้างที่ 30 = หมุนกลับแล้วตกลง ล้างของ g2
    assert(s.dial === 30 && s.agreeIds.length === 1 && s.agreeIds[0] === g1, 'ตกลงพร้อมค่าที่ต่าง = หมุนไปตรงนั้น');
    engine.unlockPin(room, g1, ctx(room));
    assert(s.agreeIds.length === 0, 'ยกเลิกตกลงได้');
    throwsLike(() => engine.unlockPin(room, g1, ctx(room)), /ยังไม่ได้/, 'ยกเลิกซ้ำถูกปัด');
    // คนหลุด ไม่ต้องรอ
    setOnline(room, g2, false);
    engine.lockPin(room, g1, null, ctx(room), env);
    assert(s.phase === 'leftright', 'คนออนไลน์ตกลงครบ = ล็อก → ทีมโน้นทายซ้าย/ขวา');
    view = engine.buildClientState(room, opp);
    assert(view.target == null && view.dial === 30 && view.availableActions.canVote, 'ช่วงซ้าย/ขวา: ไม่เห็นเป้า เห็นเข็ม โหวตได้');
    throwsLike(() => engine.movePin(room, g1, 50, ctx(room)), /ยังไม่ใช่/, 'ล็อกแล้วหมุนไม่ได้');
    throwsLike(() => engine.voteSide(room, g1, 'left', ctx(room)), /ทีมโน้น/, 'ทีมที่ทายโหวตเองไม่ได้');
    throwsLike(() => engine.voteSide(room, opp, 'up', ctx(room)), /เลือก/, 'ทิศเพี้ยนถูกปัด');
    setOnline(room, g2, true);
    console.log('3. เข็มร่วม: ทีมเดียวหมุน ทุกคนเห็น · หมุน = ล้าง ✅ · ตกลงครบ = ล็อก · เป้ายังลับ ✓');
})();

// ---------- 4. แต้มทีม + ซ้าย/ขวา ----------
(function scoring() {
    const cases = [
        // dial, target, side, team pts, opp pts
        [50, 50, 'left', 4, 0],   // เป๊ะ: ทีมโน้นได้ 0 แม้ทายถูกไม่ได้ (เท่ากันพอดี)
        [52, 50, 'left', 4, 0],   // เป๊ะ + ทีมโน้นทายถูก = ไม่ได้ (บล็อก)
        [58, 50, 'left', 3, 1],
        [42, 50, 'left', 3, 0],
        [66, 50, 'left', 2, 1],
        [80, 50, 'right', 0, 0],
        [20, 50, 'right', 0, 1]
    ];
    cases.forEach(([dial, target, side, tp, op], i) => {
        const env = makeEnv(100 + i);
        const room = makeRoom(4);
        engine.startGame(room, env);
        const t = S(room).activeTeam;
        const o = t === 'A' ? 'B' : 'A';
        const before = { t: score(room, t), o: score(room, o) };
        const lr = playTeamTurn(room, env, { target, dial, side });
        assert(lr.points === tp && score(room, t) - before.t === tp, `เข็ม ${dial} เป้า ${target}: ทีมได้ ${tp} (ได้ ${lr.points})`);
        assert(score(room, o) - before.o === op && lr.lr.points === op, `เข็ม ${dial} เป้า ${target} ทาย ${side}: ทีมโน้นได้ ${op}`);
        if (dial === 52) assert(lr.lr.blocked, 'บันทึกว่าโดนบล็อกเพราะเป๊ะ');
    });
    // เสียงข้างมาก · เสมอ = เสียงแรก
    const env = makeEnv(7);
    const room = makeRoom(7);
    engine.startGame(room, env);
    giveClue(room, env);
    const s = S(room);
    s.target = 70;
    s.guesserIds.forEach((id, i) => { if (i === 0) engine.movePin(room, id, 40, ctx(room)); engine.lockPin(room, id, null, ctx(room), env); });
    const opp = s.opponentIds;
    assert(s.phase === 'leftright' && opp.length >= 3, 'ฝ่ายโหวต 3 คนขึ้นไป');
    engine.voteSide(room, opp[0], 'left', ctx(room), env);
    engine.voteSide(room, opp[1], 'right', ctx(room), env);
    engine.voteSide(room, opp[0], 'right', ctx(room), env); // เปลี่ยนใจได้
    assert(s.phase === 'leftright', 'ยังโหวตไม่ครบ ไม่เปิด');
    const rest = opp.slice(2);
    rest.forEach(id => { if (s.phase === 'leftright') engine.voteSide(room, id, 'left', ctx(room), env); });
    assert(s.lastRound.lr.choice === (rest.length >= 3 ? 'left' : 'right'), 'เสียงข้างมากชนะ');
    // เสมอ 1–1
    const env2 = makeEnv(8);
    const r2 = makeRoom(4);
    engine.startGame(r2, env2);
    giveClue(r2, env2);
    assert(S(r2).opponentIds.length === 2, '2 ต่อ 2: ฝ่ายโหวต 2 คน');
    S(r2).target = 90;
    S(r2).guesserIds.forEach(id => engine.lockPin(r2, id, 50, ctx(r2), env2));
    const [v1, v2] = S(r2).opponentIds;
    engine.voteSide(r2, v1, 'right', ctx(r2), env2);
    engine.voteSide(r2, v2, 'left', ctx(r2), env2);
    assert(S(r2).lastRound.lr.choice === 'right' && S(r2).lastRound.lr.points === 1, 'เสมอ = ใช้เสียงแรก');
    console.log('4. ทีมได้ 4/3/2 · ทีมโน้นทายซ้าย/ขวาถูก +1 · เป๊ะ = ทีมโน้นได้ 0 · เสียงข้างมาก/เสมอใช้เสียงแรก ✓');
})();

// ---------- 5. ตาพิเศษ (catch-up) ----------
(function catchUp() {
    const env = makeEnv(31);
    const room = makeRoom(6);
    engine.startGame(room, env);
    const s = S(room);
    const t = s.activeTeam;
    const o = t === 'A' ? 'B' : 'A';
    s.teams[o].score = 7; s.teams[t].score = 0;
    const firstGiver = s.giverId;
    let lr = playTeamTurn(room, env, { target: 50, dial: 50, side: 'left' });
    assert(lr.catchUpNext && score(room, t) === 4, 'เป๊ะ 4 แต่ยังตามหลัง 4–7 = ตาพิเศษ');
    advance(room, env);
    assert(s.activeTeam === t && s.catchUp && s.giverId !== firstGiver && teamOf(room, s.giverId) === t, 'ทีมเดิมเล่นต่อ ผู้ใบ้คนใหม่');
    const secondGiver = s.giverId;
    lr = playTeamTurn(room, env, { target: 50, dial: 50, side: 'left' });
    assert(!lr.catchUpNext && score(room, t) === 8, 'เป๊ะจนนำ 8–7 = ไม่มีตาพิเศษ');
    advance(room, env);
    assert(s.activeTeam === o && !s.catchUp, 'กลับไปทีมโน้น');
    assert(secondGiver !== firstGiver, 'ตาพิเศษใช้ผู้ใบ้คนอื่น');
    // เป๊ะแล้วเสมอ = ไม่ตามหลัง ไม่ได้ตาพิเศษ
    s.teams[o].score = 4; s.teams[t].score = 8;
    playTeamTurn(room, env, { target: 50, dial: 50, side: 'left' });
    assert(score(room, o) === 8 && !s.lastRound.catchUpNext, 'เป๊ะจนเสมอ = ไม่มีตาพิเศษ');
    console.log('5. ตาพิเศษ: เป๊ะแต่ยังตามหลัง = เล่นต่อ (ผู้ใบ้คนถัดไป) · นำ/เสมอ = ไม่ได้ ✓');
})();

// ---------- 6. ถึง 10 ชนะ · ต่อตาย ----------
(function winning() {
    const env = makeEnv(41);
    const room = makeRoom(4);
    engine.startGame(room, env);
    const s = S(room);
    const t = s.activeTeam;
    const o = t === 'A' ? 'B' : 'A';
    s.teams[t].score = 7; s.teams[o].score = 5;
    const lr = playTeamTurn(room, env, { target: 50, dial: 57, side: 'right' });
    assert(lr.end && lr.end.winner === t && score(room, t) === 10, 'ถึง 10 = ชนะ (โชว์ผลรอบก่อน)');
    assert(s.phase === 'reveal', 'ยังอยู่หน้าผลรอบ');
    advance(room, env);
    assert(s.phase === 'finished' && s.winnerTeam === t, 'กดต่อ = จบเกม ทีมนั้นชนะ');
    const view = engine.buildClientState(room, 'p1');
    assert(view.winnerTeam === t && view.standings.length === 4, 'จอจบเห็นทีมชนะ');
    s.standings.forEach(row => assert(row.won === (row.team === t) && row.score === score(room, row.team), 'อันดับ: สมาชิกทีมชนะ = won'));
    assert(s.winners.length === 2 && s.winners.every(w => w.team === t), 'ผู้ชนะ = ทั้งทีม');

    // ถึง 10 พร้อมกันจากซ้าย/ขวา แต่ไม่เท่ากัน = ทีมแต้มมากชนะ · เท่ากัน = ต่อตาย
    const env2 = makeEnv(42);
    const r2 = makeRoom(4);
    engine.startGame(r2, env2);
    const s2 = S(r2);
    const a = s2.activeTeam;
    const b = a === 'A' ? 'B' : 'A';
    s2.teams[a].score = 8; s2.teams[b].score = 9;
    playTeamTurn(r2, env2, { target: 50, dial: 62, side: 'left' }); // a +2 = 10 · b ทายซ้ายถูก +1 = 10
    assert(score(r2, a) === 10 && score(r2, b) === 10 && s2.suddenDeath && !s2.lastRound.end, 'เสมอ 10–10 = ต่อตาย');
    advance(r2, env2);
    assert(s2.activeTeam === b, 'ต่อตาย: ทีมโน้นเล่นก่อน');
    playTeamTurn(r2, env2, { target: 50, dial: 50, side: 'left' }); // b +4 = 14
    assert(!s2.lastRound.end && !s2.lastRound.catchUpNext, 'ต่อตาย: ต้องให้ทีมแรกเล่นครบก่อน · ไม่มีตาพิเศษ');
    advance(r2, env2);
    assert(s2.activeTeam === a, 'ต่อตาย: อีกทีมได้ตา');
    playTeamTurn(r2, env2, { target: 50, dial: 50, side: 'left' }); // a +4 = 14 → เสมออีก
    assert(!s2.lastRound.end && s2.suddenDeath, 'ต่อตายยังเสมอ = ต่ออีกรอบ');
    advance(r2, env2);
    playTeamTurn(r2, env2, { target: 50, dial: 90, side: 'left' }); // b 0 · a ทายซ้ายถูก +1 = 15
    advance(r2, env2);
    playTeamTurn(r2, env2, { target: 50, dial: 90, side: 'right' }); // a 0 · b ทายผิด
    assert(s2.lastRound.end && s2.lastRound.end.winner === a, 'ต่อตายจบเมื่อแต้มต่างกัน');
    advance(r2, env2);
    assert(s2.phase === 'finished' && s2.winnerTeam === a, 'ชนะต่อตาย');

    // หัวห้องจบกลางทาง: ทีมนำชนะ
    const env3 = makeEnv(43);
    const r3 = makeRoom(5);
    engine.startGame(r3, env3);
    const lead = S(r3).startTeam === 'A' ? 'B' : 'A';
    engine.endGame(r3, 'p0', env3);
    assert(S(r3).winnerTeam === lead && S(r3).standings.every(row => row.won === (row.team === lead)), 'จบกลางทาง: ทีมนำ (แต้มตั้งต้น 1) ชนะ');
    console.log('6. ถึง 10 ก่อนชนะ · เสมอที่ 10+ ต่อตายทีมละตาจนต่างกัน · หัวห้องจบ = ทีมนำชนะ ✓');
})();

// ---------- 7. ร่วมมือ ----------
(function coop() {
    const env = makeEnv(51);
    const room = makeRoom(4, 'coop');
    engine.startGame(room, env);
    const s = S(room);
    assert(s.variant === 'coop' && s.coop.total === 7, 'ร่วมมือ 7 การ์ด');
    const givers = [];
    let rounds = 0;
    const plan = [[50, 50], [50, 58], [50, 66], [50, 90], [50, 50], [50, 0], [50, 10], [50, 55], [50, 30]];
    while (s.phase !== 'finished' && rounds < 20) {
        givers.push(s.giverId);
        giveClue(room, env);
        assert(s.guesserIds.length === 3 && s.opponentIds.length === 0, 'ทุกคนยกเว้นผู้ใบ้ช่วยกันทาย');
        const [target, dial] = plan[rounds] || [50, 90];
        s.target = target;
        engine.movePin(room, s.guesserIds[0], dial, ctx(room));
        s.guesserIds.forEach(id => { if (s.phase === 'guess') engine.lockPin(room, id, null, ctx(room), env); });
        assert(s.phase === 'reveal', 'ร่วมมือ: ไม่มีช่วงซ้าย/ขวา');
        rounds += 1;
        advance(room, env);
    }
    // 4→3+โบนัส, 3, 2, 0, 4→3+โบนัส, 0, 0, 3, 0  = 9 รอบ (7 + โบนัส 2)
    assert(rounds === 9, `เป๊ะ 2 ครั้ง = เล่น 9 รอบ (ได้ ${rounds})`);
    assert(s.coop.score === 3 + 3 + 2 + 3 + 3 && s.coop.bonus === 2, `แต้มร่วม 14 (ได้ ${s.coop.score})`);
    assert(new Set(givers.slice(0, 4)).size === 4, 'ผู้ใบ้วนครบทุกคน');
    assert(s.coopRank === engine.coopRank(14).text && s.coopRank === 'อีกนิดเดียว!', 'ตารางคะแนน 13–15');
    assert(s.standings.length === 4 && s.standings.every(r => r.won === false && r.score === 14), '14 < 16 = ยังไม่ชนะ');
    assert(engine.coopRank(16).text === 'ชนะแล้ว!' && engine.coopRank(0).text === 'เสียบปลั๊กหรือยัง?' && engine.coopRank(40).text === '?!?!?!?!', 'ช่วงตาราง');
    // ข้ามตาก็เสียการ์ด
    const r2 = makeRoom(3, 'coop');
    const env2 = makeEnv(52);
    engine.startGame(r2, env2);
    engine.skipPhase(r2, S(r2).giverId, ctx(r2), env2);
    assert(S(r2).coop.played === 1, 'ข้ามตา = เสียการ์ด 1 ใบ');
    console.log('7. ร่วมมือ 7 การ์ด · เป๊ะ = 3 + การ์ดโบนัส · ไม่มีซ้าย/ขวา · ตารางคะแนน · 16+ ชนะ ✓');
})();

// ---------- 8. หมดเวลา ----------
(function timers() {
    const env = makeEnv(61);
    const room = makeRoom(4);
    engine.startGame(room, env);
    const s = S(room);
    giveClue(room, env);
    engine.movePin(room, s.guesserIds[0], 77, ctx(room));
    assert(s.phaseEndsAt - env.now() === engine.timers.TEAM_GUESS_MS, 'แข่งทีมให้เวลาคุยกัน 90 วิ');
    env.tick(engine.timers.TEAM_GUESS_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(s.phase === 'leftright' && s.dial === 77, 'หมดเวลาทาย = ล็อกเข็มที่อยู่ → ซ้าย/ขวา');
    env.tick(engine.timers.LR_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(s.phase === 'reveal' && s.lastRound.lr.choice === null && s.lastRound.lr.points === 0, 'ไม่มีใครโหวต = ไม่ได้แต้ม');
    // ผู้ใบ้คิดไม่ทัน = เสียตา ส่งให้ทีมโน้น
    const t = s.nextTeam;
    env.tick(engine.timers.REVEAL_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(s.activeTeam === t && s.phase === 'clue', 'หมดเวลาดูผล = ตาถัดไป');
    env.tick(engine.timers.CLUE_MS + 1);
    engine.autoResolvePhase(room, env);
    assert(s.lastRound.skipped && s.nextTeam !== t, 'ข้ามตา = เสียตาให้ทีมโน้น');
    // หัวห้องข้ามช่วงซ้าย/ขวา
    engine.nextRound(room, 'p0', ctx(room), env);
    giveClue(room, env);
    s.guesserIds.forEach(id => engine.lockPin(room, id, 20, ctx(room), env));
    assert(s.phase === 'leftright', 'ล็อก → ซ้าย/ขวา');
    throwsLike(() => engine.skipPhase(room, s.opponentIds.find(id => id !== 'p0') || 'p3', ctx(room), env), /หัวห้อง/, 'คนอื่นเปิดก่อนไม่ได้');
    engine.skipPhase(room, 'p0', ctx(room), env);
    assert(s.phase === 'reveal', 'หัวห้องเปิดเป้าเลยได้');
    console.log('8. หมดเวลาทาย = ล็อกตรงที่อยู่ · หมดเวลาซ้าย/ขวา = ไม่ได้แต้ม · ผู้ใบ้ไม่ทัน = เสียตา ✓');
})();

// ---------- 9. เข้ากลางเกม · ออก · จัดทีมใหม่ ----------
(function joinLeave() {
    const env = makeEnv(71);
    const room = makeRoom(4);
    engine.startGame(room, env);
    const s = S(room);
    lateJoin(room, 'L1');
    giveClue(room, env); // เข้าช่วงคิดคำ = ได้ทีมแล้วทายรอบนี้
    const l1 = s.players.find(p => p.playerId === 'L1');
    assert(l1.active && l1.team, 'คนมาสายได้ทีม');
    assert(s.guesserIds.includes('L1') || s.opponentIds.includes('L1'), 'คนมาสายได้เล่นรอบนี้');
    const counts = () => ['A', 'B'].map(t => s.players.filter(p => p.team === t && room.players.some(r => r.playerId === p.playerId)).length);
    assert(Math.abs(counts()[0] - counts()[1]) <= 1, 'คนมาสายเข้าทีมที่คนน้อยกว่า');
    s.guesserIds.slice().forEach(id => { if (s.phase === 'guess') engine.lockPin(room, id, 50, ctx(room), env); });
    s.opponentIds.slice().forEach(id => { if (s.phase === 'leftright') engine.voteSide(room, id, 'left', ctx(room), env); });
    advance(room, env);
    // ทีมหนึ่งเหลือ 1 คน → ย้ายจากทีมใหญ่ (3 คน) มา 1
    const [big] = ['A', 'B'].map(t => ({ t, ids: s.players.filter(p => p.team === t).map(p => p.playerId) })).sort((x, y) => y.ids.length - x.ids.length);
    const small = big.t === 'A' ? 'B' : 'A';
    const smallIds = s.players.filter(p => p.team === small).map(p => p.playerId);
    if (s.phase === 'clue') engine.skipPhase(room, s.giverId, ctx(room), env);
    leave(room, smallIds.find(id => id !== room.admin) || smallIds[0]);
    advance(room, env);
    const c = counts();
    assert(c[0] >= 2 && c[1] >= 2, `จัดทีมใหม่ให้ทีมละ 2+ (${c})`);
    // เหลือ 3 คน = แข่งทีมไม่ได้ → จบ
    if (s.phase === 'clue') engine.skipPhase(room, s.giverId, ctx(room), env);
    leave(room, room.players.find(p => p.playerId !== room.admin).playerId);
    advance(room, env);
    assert(s.phase === 'finished', 'เหลือ 3 คน = จบเกม');
    // ผู้ใบ้ออกช่วงคิดคำ = เสียตา
    const r2 = makeRoom(5);
    const env2 = makeEnv(72);
    engine.startGame(r2, env2);
    const t2 = S(r2).activeTeam;
    leave(r2, S(r2).giverId === r2.admin ? (engine.endGame(r2, r2.admin, env2), null) : S(r2).giverId);
    if (S(r2).phase !== 'finished') assert(S(r2).lastRound.skipped && S(r2).nextTeam !== t2, 'ผู้ใบ้ออก = ข้าม ส่งตาให้ทีมโน้น');
    // ทีมโน้นออกหมดช่วงซ้าย/ขวา = เปิดเลย
    const r3 = makeRoom(6);
    const env3 = makeEnv(73);
    engine.startGame(r3, env3);
    giveClue(r3, env3);
    S(r3).guesserIds.forEach(id => engine.lockPin(r3, id, 50, ctx(r3), env3));
    assert(S(r3).phase === 'leftright', 'ซ้าย/ขวา');
    S(r3).opponentIds.slice(0, -1).forEach(id => setOnline(r3, id, false));
    engine.refreshPresence(r3, env3);
    assert(S(r3).phase === 'leftright', 'ยังมีคนออนไลน์ 1 คน รอ');
    engine.voteSide(r3, S(r3).opponentIds[S(r3).opponentIds.length - 1], 'right', ctx(r3), env3);
    assert(S(r3).phase === 'reveal', 'คนออนไลน์โหวตครบ = เปิด');
    console.log('9. มาสายเข้าทีมที่คนน้อย · ทีมเหลือ 1 = ย้ายคน · เหลือ 3 = จบ · ผู้ใบ้ออก = เสียตา · หลุด = ไม่ต้องรอ ✓');
})();

// ---------- 10. สุ่มเล่นยาว ----------
(function fuzz() {
    const games = Number(process.env.WL_GAMES) || 300;
    const seed0 = Number(process.env.WL_SEED) || 2024;
    let totalRounds = 0;
    let catchUps = 0;
    let sudden = 0;
    let joins = 0;
    let leaves = 0;
    for (let g = 0; g < games; g += 1) {
        const env = makeEnv(seed0 + g);
        const r = env.rng;
        const variant = r() < 0.7 ? 'teams' : 'coop';
        const n = 3 + Math.floor(r() * 10);
        const room = makeRoom(n, variant);
        engine.startGame(room, env);
        const s = S(room);
        let guard = 0;
        while (s.phase !== 'finished' && guard < 400) {
            guard += 1;
            const roll = r();
            if (roll < 0.03 && room.players.length < 12) { lateJoin(room, 'j' + g + '_' + guard); joins += 1; }
            else if (roll < 0.06 && room.players.length > 1) { leave(room, room.players[Math.floor(r() * room.players.length)].playerId); leaves += 1; }
            else if (roll < 0.09) { const p = room.players[Math.floor(r() * room.players.length)]; setOnline(room, p.playerId, r() < 0.5); engine.refreshPresence(room, env); }
            if (s.phase === 'finished') break;
            // ความลับ: คนที่ไม่ใช่ผู้ใบ้ไม่เห็นเป้าก่อนเปิด
            if (s.phase === 'clue' || s.phase === 'guess' || s.phase === 'leftright') {
                room.players.forEach(p => {
                    if (p.playerId === s.giverId) return;
                    assert(engine.buildClientState(room, p.playerId).target == null, `เกม ${g}: เป้าหลุดถึง ${p.playerId}`);
                });
            }
            if (s.variant === 'teams' && s.teams) {
                assert(s.teams.A.score >= 0 && s.teams.B.score >= 0, 'แต้มไม่ติดลบ');
                if (s.phase === 'clue' && s.status === 'playing') assert(teamOf(room, s.giverId) === s.activeTeam, `เกม ${g}: ผู้ใบ้อยู่ทีมที่ถึงตา`);
            }
            try {
                if (s.phase === 'clue') {
                    if (r() < 0.1) { env.tick(engine.timers.CLUE_MS + 1); engine.autoResolvePhase(room, env); } else giveClue(room, env);
                } else if (s.phase === 'guess') {
                    const id = s.guesserIds[Math.floor(r() * s.guesserIds.length)];
                    if (r() < 0.15) { env.tick(engine.timers.TEAM_GUESS_MS + 1); engine.autoResolvePhase(room, env); } else if (id) {
                        if (r() < 0.5) engine.movePin(room, id, Math.floor(r() * 101), ctx(room));
                        else engine.lockPin(room, id, r() < 0.5 ? null : Math.floor(r() * 101), ctx(room), env);
                    } else { env.tick(engine.timers.TEAM_GUESS_MS + 1); engine.autoResolvePhase(room, env); }
                } else if (s.phase === 'leftright') {
                    const id = s.opponentIds[Math.floor(r() * s.opponentIds.length)];
                    if (r() < 0.15 || !id) { env.tick(engine.timers.LR_MS + 1); engine.autoResolvePhase(room, env); } else engine.voteSide(room, id, r() < 0.5 ? 'left' : 'right', ctx(room), env);
                } else if (s.phase === 'reveal') {
                    const lr = s.lastRound;
                    if (lr && !lr.skipped) totalRounds += 1;
                    if (lr && lr.catchUpNext) catchUps += 1;
                    if (lr && lr.suddenDeath) sudden += 1;
                    if (lr && !lr.skipped && s.variant === 'teams') assert(!(lr.points === 4 && lr.lr && lr.lr.points), 'เป๊ะแล้วทีมโน้นต้องได้ 0');
                    engine.nextRound(room, room.admin, ctx(room), env);
                }
            } catch (error) {
                // คำสั่งที่ถูกปัดตามกติกา (เช่น คนออนไลน์เปลี่ยน) ไม่ใช่บั๊ก — แต่ห้ามเป็น TypeError
                assert(!(error instanceof TypeError) && !(error instanceof ReferenceError), `เกม ${g}: ${error.stack}`);
            }
        }
        assert(s.phase === 'finished', `เกม ${g} (${variant} ${n} คน) ต้องจบ (ค้างที่ ${s.phase} รอบ ${s.round})`);
        if (s.variant === 'teams' && s.winnerTeam) {
            assert(s.standings.every(row => row.won === (row.team === s.winnerTeam)), 'ผู้ชนะ = ทีมชนะ');
        }
        if (s.variant === 'coop') assert(s.coop.played <= s.coop.total + s.coop.bonus, 'ร่วมมือไม่เกินการ์ด');
    }
    console.log(`10. สุ่ม ${games} เกม · ${totalRounds} รอบ · ตาพิเศษ ${catchUps} · ต่อตาย ${sudden} · มาสาย ${joins} · ออก ${leaves} — จบทุกเกม ไม่มีเป้าหลุด ✓`);
})();

console.log(`\n✅ smoke-wavelength-teams: ${checks} checks passed`);
