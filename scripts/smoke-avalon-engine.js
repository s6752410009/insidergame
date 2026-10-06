/**
 * อวาลอน — ทดสอบ engine ล้วน (ไม่ต้องเปิดเซิร์ฟเวอร์)
 *
 * รัน: npm run smoke:avalon
 * ครอบคลุม: จำนวนฝ่าย/ขนาดทีม, ข้อมูลกลางคืนของทุกบท, กันข้อมูลลับรั่ว, คัดค้าน 5 ครั้ง,
 * ภารกิจ 4 ต้องล้ม 2 ใบ (7+ คน), ลอบสังหารถูก/พลาด, ท่าผิดกติกา, หมดเวลา, คนออกกลางเกม,
 * และสุ่มเล่นหลายร้อยเกมเช็ก invariant
 */
const engine = require('../games/avalonEngine');

let checks = 0;
function assert(condition, message) {
    checks += 1;
    if (!condition) throw new Error(message);
}
function throws(fn, pattern, message) {
    checks += 1;
    try {
        fn();
    } catch (error) {
        if (pattern && !pattern.test(error.message)) {
            throw new Error(`${message} — ได้ error อื่น: ${error.message}`);
        }
        return;
    }
    throw new Error(`${message} — ต้องโยน error`);
}

function makeRoom(count, avalonRoles = []) {
    const players = Array.from({ length: count }, (_, i) => ({
        playerId: `p${i + 1}`,
        playerName: `ผู้เล่น${i + 1}`,
        color: '#fff',
        socketId: `s${i + 1}`
    }));
    return { roomId: 'R1', name: 'ทดสอบ', admin: 'p1', players, settings: { gameMode: 'avalon', avalonRoles }, gameState: engine.createInitialState() };
}

function start(count, roles = []) {
    const room = makeRoom(count, roles);
    engine.startGame(room);
    return room;
}

const S = room => room.gameState;
const seatBy = (room, pred) => S(room).seats.find(pred);
const seatsBy = (room, pred) => S(room).seats.filter(pred);
const ctx = room => ({ step: S(room).step });

function skipNight(room) {
    S(room).seats.filter(seat => !seat.left).forEach(seat => engine.submitReady(room, seat.playerId, ctx(room)));
    assert(S(room).phase === 'team' || S(room).phase === 'finished', 'หลังทุกคนพร้อมต้องเข้าเลือกทีม');
}

function proposeTeam(room, ids) {
    const state = S(room);
    const size = state.quests[state.questIndex].size;
    const team = ids || state.seats.filter(seat => !seat.left).slice(0, size).map(seat => seat.playerId);
    engine.submitTeam(room, state.leaderId, team, ctx(room));
    return team;
}

function voteAll(room, decide) {
    const step = S(room).step;
    S(room).seats.filter(seat => !seat.left).forEach(seat => {
        if (S(room).phase !== 'vote' || S(room).step !== step || S(room).votes[seat.playerId]) return;
        engine.submitVote(room, seat.playerId, decide(seat), { step });
    });
}

function playQuest(room, decide) {
    const step = S(room).step;
    const team = [...S(room).proposal.teamIds];
    team.forEach(id => {
        if (S(room).phase !== 'quest' || S(room).step !== step) return;
        const seat = seatBy(room, entry => entry.playerId === id);
        if (seat.left) return;
        engine.submitQuestCard(room, id, decide(seat), { step });
    });
}

/** เล่นภารกิจหนึ่งรอบ: เสนอทีม → ทุกคนเห็นด้วย → ลงการ์ดตาม decide */
function runQuest(room, decide, teamIds) {
    proposeTeam(room, teamIds);
    voteAll(room, () => 'approve');
    assert(S(room).phase === 'quest', 'ทีมที่ทุกคนเห็นด้วยต้องออกภารกิจ');
    playQuest(room, decide);
}

/** สแกน payload ทั้งก้อน: ห้ามมีบท/ฝ่ายของคนอื่นก่อนจบเกม */
function assertNoLeak(room, viewerId, label) {
    const state = S(room);
    const view = engine.buildClientState(room, viewerId);
    const finished = state.phase === 'finished';
    const json = JSON.stringify(view);
    const viewerSeat = state.seats.find(seat => seat.playerId === viewerId);
    const allowedIds = new Set(viewerSeat ? engine.getKnowledge(state, viewerSeat).map(entry => entry.playerId) : []);

    view.players.forEach(player => {
        if (!finished) {
            assert(player.role === null && player.team === null, `${label}: players[] ห้ามมีบทของ ${player.playerId}`);
        }
        if (player.known) {
            assert(allowedIds.has(player.playerId), `${label}: ${viewerId} เห็น known ของ ${player.playerId} ที่ไม่ควรเห็น`);
        }
    });
    (view.self?.knowledge || []).forEach(entry => {
        assert(allowedIds.has(entry.playerId), `${label}: knowledge มีคนที่ไม่ควรรู้`);
        assert(Object.keys(entry).sort().join(',') === 'name,playerId,tag', `${label}: knowledge ห้ามแนบบท`);
    });
    if (view.self && viewerSeat) {
        assert(view.self.role.id === viewerSeat.role, `${label}: self.role ต้องเป็นบทตัวเอง`);
    }

    // โหวต/การ์ดภารกิจของคนอื่นก่อนเปิดห้ามหลุด
    if (state.phase === 'vote') {
        Object.entries(state.votes).forEach(([pid]) => {
            if (pid === viewerId) return;
            const player = view.players.find(entry => entry.playerId === pid);
            assert(player && player.hasVoted === true, `${label}: ต้องบอกแค่ว่าโหวตแล้ว`);
        });
        assert(!('votes' in view), `${label}: ห้ามส่ง votes ดิบ`);
        if (view.self) assert(view.self.myVote === (state.votes[viewerId] || null), `${label}: myVote ต้องเป็นของตัวเอง`);
    }
    if (state.phase === 'quest') {
        assert(!('questCards' in view), `${label}: ห้ามส่ง questCards ดิบ`);
        if (view.self) assert(view.self.myQuestCard === (state.questCards[viewerId] || null), `${label}: myQuestCard ต้องเป็นของตัวเอง`);
    }
    if (state.phase !== 'assassin' && !finished) {
        assert(view.assassinId === null, `${label}: ห้ามบอกว่าใครเป็นมือสังหารก่อนเฟสลอบสังหาร`);
    }
    if (!(viewerSeat && state.assassinId === viewerId)) {
        assert(view.assassinTargets.length === 0, `${label}: รายชื่อเป้าส่งให้มือสังหารเท่านั้น`);
    }
    assert(!json.includes('"seats"'), `${label}: ห้ามส่ง seats ดิบ`);
    // บทของคนอื่นต้องไม่อยู่ใน payload ในรูปของ role object ผูกกับ playerId
    if (!finished) {
        state.seats.forEach(seat => {
            if (seat.playerId === viewerId) return;
            const needle = `"playerId":"${seat.playerId}","role"`;
            assert(!json.includes(needle), `${label}: พบ role ผูกกับ ${seat.playerId}`);
        });
    }
    return view;
}

/* ------------------------------------------------------------------ 1. setup */
(function testSetup() {
    const expected = { 5: [3, 2], 6: [4, 2], 7: [4, 3], 8: [5, 3], 9: [6, 3], 10: [6, 4] };
    const sizes = { 5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5] };
    for (let n = 5; n <= 10; n += 1) {
        const room = start(n);
        const state = S(room);
        const good = state.seats.filter(seat => seat.team === 'good').length;
        const evil = state.seats.filter(seat => seat.team === 'evil').length;
        assert(good === expected[n][0] && evil === expected[n][1], `${n} คน: ดี/ร้ายต้องเป็น ${expected[n]}`);
        assert(state.seats.filter(seat => seat.role === 'merlin').length === 1, `${n} คน: ต้องมีเมอร์ลิน 1`);
        assert(state.seats.filter(seat => seat.role === 'assassin').length === 1, `${n} คน: ต้องมีมือสังหาร 1`);
        assert(JSON.stringify(state.quests.map(q => q.size)) === JSON.stringify(sizes[n]), `${n} คน: ขนาดทีมผิด`);
        assert(state.quests[3].failsNeeded === (n >= 7 ? 2 : 1), `${n} คน: ภารกิจ 4 ต้องใช้การ์ดล้ม ${n >= 7 ? 2 : 1}`);
        assert(state.quests.filter((q, i) => i !== 3).every(q => q.failsNeeded === 1), `${n} คน: ภารกิจอื่นล้ม 1 ใบพอ`);
        assert(state.phase === 'night' && state.phaseEndsAt > Date.now(), `${n} คน: เริ่มที่กลางคืนพร้อมเวลา`);
    }
    throws(() => start(4), /5–10/, '4 คนต้องเริ่มไม่ได้');
    throws(() => start(11), /5–10/, '11 คนต้องเริ่มไม่ได้');
    throws(() => start(5, ['morgana', 'mordred']), /ไม่เกิน 1/, '5 คน + บทร้ายเสริม 2 ต้องไม่ผ่าน');
    throws(() => start(7, ['morgana', 'mordred', 'oberon']), /ไม่เกิน 2/, '7 คน + บทร้ายเสริม 3 ต้องไม่ผ่าน');
    const full = start(10, ['percival', 'morgana', 'mordred', 'oberon']);
    const counts = {};
    S(full).seats.forEach(seat => { counts[seat.role] = (counts[seat.role] || 0) + 1; });
    assert(counts.loyal === 4 && counts.percival === 1 && counts.oberon === 1 && !counts.minion, '10 คนเปิดทุกบท: loyal 4 ไม่มีสมุน');
    assert(engine.sanitizeRoleSelection(['PERCIVAL', 'merlin', 'hacker', 'oberon']).join(',') === 'percival,oberon', 'sanitize ต้องกรองบทที่เลือกไม่ได้');

    // แจกเฉพาะคนที่ออนไลน์
    const room = makeRoom(7);
    room.players[6].socketId = null;
    room.players[5].socketId = null;
    engine.startGame(room);
    assert(S(room).seats.length === 5 && !S(room).seats.some(seat => seat.playerId === 'p7'), 'แจกเฉพาะคนที่เชื่อมต่ออยู่');
    const tooFew = makeRoom(5);
    tooFew.players[0].socketId = null;
    throws(() => engine.startGame(tooFew), /ออนไลน์/, 'ออนไลน์ไม่ครบ 5 ต้องเริ่มไม่ได้');
    console.log('1. จำนวนฝ่าย/ขนาดทีม/บทเสริม/แจกเฉพาะคนออนไลน์ ✓');
})();

/* ------------------------------------------------------------------ 2. night info */
(function testNightInfo() {
    const room = start(10, ['percival', 'morgana', 'mordred', 'oberon']);
    const state = S(room);
    const id = role => seatBy(room, seat => seat.role === role).playerId;
    const ids = role => seatsBy(room, seat => seat.role === role).map(seat => seat.playerId).sort();
    const knownIds = role => engine.buildClientState(room, id(role)).self.knowledge.map(entry => entry.playerId).sort();
    const tags = role => new Set(engine.buildClientState(room, id(role)).self.knowledge.map(entry => entry.tag));

    // เมอร์ลิน: เห็นฝ่ายร้ายทุกคนยกเว้นมอร์เดรด (โอเบรอนเห็น)
    assert(JSON.stringify(knownIds('merlin')) === JSON.stringify([id('assassin'), id('morgana'), id('oberon')].sort()), 'เมอร์ลินเห็น มือสังหาร/มอร์กานา/โอเบรอน ไม่เห็นมอร์เดรด');
    assert(!knownIds('merlin').includes(id('mordred')), 'เมอร์ลินต้องไม่เห็นมอร์เดรด');
    assert([...tags('merlin')].join() === 'evil', 'เมอร์ลินเห็นเป็นป้าย evil');
    // เพอร์ซิวัล: เห็นเมอร์ลิน + มอร์กานา ป้ายเดียวกัน
    assert(JSON.stringify(knownIds('percival')) === JSON.stringify([id('merlin'), id('morgana')].sort()), 'เพอร์ซิวัลเห็นเมอร์ลินกับมอร์กานา');
    assert([...tags('percival')].join() === 'merlin', 'เพอร์ซิวัลแยกไม่ออก (ป้ายเดียวกัน)');
    // ฝ่ายร้าย (ยกเว้นโอเบรอน): เห็นกันเอง ไม่เห็นโอเบรอน
    ['assassin', 'morgana', 'mordred'].forEach(role => {
        const expected = ['assassin', 'morgana', 'mordred'].filter(r => r !== role).map(id).sort();
        assert(JSON.stringify(knownIds(role)) === JSON.stringify(expected), `${role} ต้องเห็นพวกเดียวกันยกเว้นโอเบรอน`);
    });
    // โอเบรอน / อัศวินผู้ภักดี: ไม่รู้อะไร
    assert(knownIds('oberon').length === 0, 'โอเบรอนไม่รู้จักใคร');
    ids('loyal').forEach(pid => {
        assert(engine.buildClientState(room, pid).self.knowledge.length === 0, 'อัศวินผู้ภักดีไม่รู้อะไร');
    });

    // โต๊ะ 5 คนแบบ default: สมุนเห็นมือสังหาร
    const small = start(5);
    const minion = seatBy(small, seat => seat.role === 'minion');
    const assassin = seatBy(small, seat => seat.role === 'assassin');
    const merlin = seatBy(small, seat => seat.role === 'merlin');
    assert(engine.buildClientState(small, minion.playerId).self.knowledge.map(e => e.playerId).join() === assassin.playerId, 'สมุนเห็นมือสังหาร');
    assert(engine.buildClientState(small, assassin.playerId).self.knowledge.map(e => e.playerId).join() === minion.playerId, 'มือสังหารเห็นสมุน');
    assert(engine.buildClientState(small, merlin.playerId).self.knowledge.map(e => e.playerId).sort().join() === [minion.playerId, assassin.playerId].sort().join(), 'เมอร์ลินเห็นฝ่ายร้าย 2 คน');

    // เพอร์ซิวัลโดยไม่มีมอร์กานา: เห็นแค่เมอร์ลิน
    const noMorgana = start(6, ['percival']);
    const perc = seatBy(noMorgana, seat => seat.role === 'percival');
    const merl = seatBy(noMorgana, seat => seat.role === 'merlin');
    assert(engine.buildClientState(noMorgana, perc.playerId).self.knowledge.map(e => e.playerId).join() === merl.playerId, 'ไม่มีมอร์กานา เพอร์ซิวัลเห็นเมอร์ลินคนเดียว');

    // leak check ทุกคนทุกบท
    state.seats.forEach(seat => assertNoLeak(room, seat.playerId, `night:${seat.role}`));
    assertNoLeak(room, 'spectator', 'night:spectator');
    console.log('2. ข้อมูลกลางคืนของทุกบทถูกต้อง + ไม่มีใครเห็นบทที่ไม่ควรเห็น ✓');
})();

/* ------------------------------------------------------------------ 3. invalid moves */
(function testInvalidMoves() {
    const room = start(5);
    const state = S(room);
    const good = seatBy(room, seat => seat.team === 'good');
    throws(() => engine.submitTeam(room, state.leaderId, [], ctx(room)), /เลือกทีม/, 'กลางคืนเลือกทีมไม่ได้');
    throws(() => engine.submitVote(room, good.playerId, 'approve', ctx(room)), /โหวต/, 'กลางคืนโหวตไม่ได้');
    throws(() => engine.submitReady(room, 'ghost', ctx(room)), /ไม่ได้อยู่ในเกม/, 'คนนอกกดพร้อมไม่ได้');
    throws(() => engine.submitReady(room, good.playerId, { step: state.step - 1 }), /ผ่านไปแล้ว/, 'step เก่าต้องถูกปฏิเสธ');
    skipNight(room);

    const leader = state.leaderId;
    const notLeader = state.seats.find(seat => seat.playerId !== leader).playerId;
    const size = state.quests[0].size;
    const ids = state.seats.map(seat => seat.playerId);
    throws(() => engine.submitTeam(room, notLeader, ids.slice(0, size), ctx(room)), /หัวหน้า/, 'คนที่ไม่ใช่หัวหน้าเลือกทีมไม่ได้');
    throws(() => engine.submitTeam(room, leader, ids.slice(0, size + 1), ctx(room)), /พอดี/, 'ทีมเกินขนาดไม่ได้');
    throws(() => engine.submitTeam(room, leader, ids.slice(0, size - 1), ctx(room)), /พอดี/, 'ทีมขาดไม่ได้');
    throws(() => engine.submitTeam(room, leader, [ids[0], ids[0]], ctx(room)), /ซ้ำ/, 'คนซ้ำในทีมไม่ได้');
    throws(() => engine.submitTeam(room, leader, [ids[0], 'ghost'], ctx(room)), /ไม่ได้อยู่ในเกม/, 'คนนอกเข้าทีมไม่ได้');
    throws(() => engine.submitTeam(room, leader, 'p1,p2', ctx(room)), /เลือกทีม/, 'teamIds ต้องเป็น array');
    throws(() => engine.submitTeam(room, leader, ids.slice(0, size), { step: 0 }), /ผ่านไปแล้ว/, 'step เก่าเลือกทีมไม่ได้');
    const team = proposeTeam(room);
    throws(() => engine.submitTeam(room, leader, ids.slice(0, size), ctx(room)), /เลือกทีม/, 'เสนอทีมซ้ำไม่ได้');
    throws(() => engine.submitVote(room, good.playerId, 'maybe', ctx(room)), /เห็นด้วย/, 'โหวตค่าแปลกไม่ได้');
    engine.submitVote(room, good.playerId, 'approve', ctx(room));
    throws(() => engine.submitVote(room, good.playerId, 'reject', ctx(room)), /โหวตไปแล้ว/, 'โหวตซ้ำไม่ได้');
    voteAll(room, () => 'approve');
    assert(state.phase === 'quest', 'โหวตผ่านต้องไปภารกิจ');
    const outsider = state.seats.find(seat => !team.includes(seat.playerId));
    throws(() => engine.submitQuestCard(room, outsider.playerId, 'success', ctx(room)), /ไม่ได้อยู่ในทีม/, 'คนนอกทีมลงการ์ดไม่ได้');
    const goodMember = state.seats.find(seat => team.includes(seat.playerId) && seat.team === 'good');
    if (goodMember) {
        throws(() => engine.submitQuestCard(room, goodMember.playerId, 'fail', ctx(room)), /ฝ่ายดี/, 'ฝ่ายดีลงการ์ดล้มไม่ได้ (บังคับที่เซิร์ฟเวอร์)');
        engine.submitQuestCard(room, goodMember.playerId, 'success', ctx(room));
        throws(() => engine.submitQuestCard(room, goodMember.playerId, 'success', ctx(room)), /ลงการ์ดไปแล้ว/, 'ลงการ์ดซ้ำไม่ได้');
    }
    const member = state.seats.find(seat => team.includes(seat.playerId) && !state.questCards[seat.playerId]);
    throws(() => engine.submitQuestCard(room, member.playerId, 'boom', ctx(room)), /สำเร็จ/, 'การ์ดแปลกไม่ได้');
    throws(() => engine.submitAssassination(room, member.playerId, good.playerId, ctx(room)), /ลอบสังหาร/, 'ยังไม่ถึงลอบสังหาร');
    console.log('3. ท่าผิดกติกา/step เก่า/ฝ่ายดีลงล้ม ถูกปฏิเสธครบ ✓');
})();

/* ------------------------------------------------------------------ 4. five rejects */
(function testFiveRejects() {
    const room = start(6);
    skipNight(room);
    const leaders = [];
    for (let i = 1; i <= 5; i += 1) {
        leaders.push(S(room).leaderId);
        proposeTeam(room);
        voteAll(room, () => 'reject');
        if (i < 5) {
            assert(S(room).rejectCount === i && S(room).phase === 'team', `คัดค้านครั้งที่ ${i} ต้องนับและกลับไปเลือกทีม`);
            assertNoLeak(room, S(room).seats[0].playerId, 'reject');
        }
    }
    assert(new Set(leaders).size === 5, 'หัวหน้าต้องเวียนทุกครั้งที่เสนอทีม');
    const seatOrder = S(room).seats.map(seat => seat.playerId);
    for (let i = 1; i < leaders.length; i += 1) {
        assert(seatOrder.indexOf(leaders[i]) === (seatOrder.indexOf(leaders[i - 1]) + 1) % seatOrder.length, 'หัวหน้าเวียนตามเข็มนาฬิกา');
    }
    assert(S(room).phase === 'finished' && S(room).winner.team === 'evil' && S(room).winner.reason === 'rejects', 'คัดค้าน 5 ครั้งติด = ฝ่ายร้ายชนะทันที');
    const view = engine.buildClientState(room, 'p1');
    assert(view.players.every(p => p.role && p.team), 'จบเกมแล้วเปิดบททุกคน');
    throws(() => engine.submitVote(room, 'p1', 'approve', {}), /จบแล้ว/, 'จบเกมแล้วโหวตไม่ได้');

    // ผ่านทีมแล้ว rejectCount รีเซ็ต + โหวตเสมอ = ไม่ผ่าน (ต้องเกินครึ่ง)
    const room2 = start(6);
    skipNight(room2);
    proposeTeam(room2);
    voteAll(room2, () => 'reject');
    assert(S(room2).rejectCount === 1, 'นับคัดค้าน');
    proposeTeam(room2);
    let n = 0;
    voteAll(room2, () => (n++ < 3 ? 'approve' : 'reject'));
    assert(S(room2).phase === 'team' && S(room2).rejectCount === 2, '3:3 เสมอ = ไม่ผ่าน');
    proposeTeam(room2);
    n = 0;
    voteAll(room2, () => (n++ < 4 ? 'approve' : 'reject'));
    assert(S(room2).phase === 'quest' && S(room2).rejectCount === 0, '4:2 ผ่าน และรีเซ็ตตัวนับ');
    assert(S(room2).lastVote.votes.length === 6 && S(room2).lastVote.approved, 'เปิดผลโหวตทุกคนหลังนับ');
    console.log('4. คัดค้าน 5 ครั้งติด = ฝ่ายร้ายชนะ · เสียงต้องเกินครึ่ง · หัวหน้าเวียน ✓');
})();

/* ------------------------------------------------------------------ 5. two-fail rule */
(function testTwoFailRule() {
    function toQuestFour(count) {
        const room = start(count);
        skipNight(room);
        // ภารกิจ 1–3: สำเร็จ, ล้ม, ล้ม? ให้ได้ 2 สำเร็จ 1 ล้ม เพื่อยังไม่จบ
        const evilIds = seatsBy(room, seat => seat.team === 'evil').map(seat => seat.playerId);
        const goodIds = seatsBy(room, seat => seat.team === 'good').map(seat => seat.playerId);
        const pickTeam = (withEvil) => {
            const size = S(room).quests[S(room).questIndex].size;
            return withEvil ? [...evilIds.slice(0, 1), ...goodIds].slice(0, size) : goodIds.slice(0, size);
        };
        runQuest(room, () => 'success', pickTeam(false));
        runQuest(room, seat => (seat.team === 'evil' ? 'fail' : 'success'), pickTeam(true));
        runQuest(room, () => 'success', pickTeam(false));
        assert(S(room).questIndex === 3 && S(room).phase === 'team', 'ถึงภารกิจ 4');
        return { room, evilIds, goodIds };
    }
    // 7 คน: ล้ม 1 ใบยังสำเร็จ
    {
        const { room, evilIds, goodIds } = toQuestFour(7);
        const size = S(room).quests[3].size;
        const team = [evilIds[0], ...goodIds].slice(0, size);
        runQuest(room, seat => (seat.team === 'evil' ? 'fail' : 'success'), team);
        assert(S(room).quests[3].result === 'success' && S(room).quests[3].failCount === 1, '7 คน ภารกิจ 4 ล้ม 1 ใบ = ยังสำเร็จ');
        assert(S(room).lastQuest.cards.filter(c => c === 'fail').length === 1, 'เปิดการ์ดล้ม 1 ใบ');
        assert(S(room).phase === 'assassin', 'สำเร็จครบ 3 → ลอบสังหาร');
    }
    // 7 คน: ล้ม 2 ใบ = ล้มเหลว
    {
        const { room, evilIds, goodIds } = toQuestFour(7);
        const size = S(room).quests[3].size;
        const team = [evilIds[0], evilIds[1], ...goodIds].slice(0, size);
        runQuest(room, seat => (seat.team === 'evil' ? 'fail' : 'success'), team);
        assert(S(room).quests[3].result === 'fail' && S(room).quests[3].failCount === 2, '7 คน ภารกิจ 4 ล้ม 2 ใบ = ล้มเหลว');
    }
    // 6 คน: ภารกิจ 4 ล้ม 1 ใบก็ล้มเหลว
    {
        const { room, evilIds, goodIds } = toQuestFour(6);
        const size = S(room).quests[3].size;
        runQuest(room, seat => (seat.team === 'evil' ? 'fail' : 'success'), [evilIds[0], ...goodIds].slice(0, size));
        assert(S(room).quests[3].result === 'fail', '6 คน ภารกิจ 4 ล้ม 1 ใบ = ล้มเหลว');
    }
    console.log('5. ภารกิจ 4 (7+ คน) ต้องล้ม 2 ใบ · โต๊ะเล็กล้ม 1 ใบพอ ✓');
})();

/* ------------------------------------------------------------------ 6. endings */
function goodSweep(count, roles = []) {
    const room = start(count, roles);
    skipNight(room);
    const goodIds = seatsBy(room, seat => seat.team === 'good').map(seat => seat.playerId);
    for (let q = 0; q < 3; q += 1) {
        const size = S(room).quests[S(room).questIndex].size;
        runQuest(room, () => 'success', goodIds.slice(0, size));
    }
    assert(S(room).phase === 'assassin', 'ฝ่ายดีสำเร็จ 3 → เฟสลอบสังหาร');
    return room;
}

(function testEndings() {
    // ลอบสังหารถูก → ฝ่ายร้ายชนะ
    {
        const room = goodSweep(5);
        const assassin = seatBy(room, seat => seat.role === 'assassin');
        const merlin = seatBy(room, seat => seat.role === 'merlin');
        assert(S(room).assassinId === assassin.playerId, 'มือสังหารเป็นคนเลือก');
        const assassinView = assertNoLeak(room, assassin.playerId, 'assassin');
        assert(assassinView.self.canAssassinate && assassinView.assassinTargets.includes(merlin.playerId), 'มือสังหารเห็นรายชื่อเป้า');
        const minion = seatBy(room, seat => seat.role === 'minion');
        assert(!assassinView.assassinTargets.includes(minion.playerId), 'เป้าต้องไม่รวมพวกเดียวกันที่รู้จัก');
        const otherView = engine.buildClientState(room, merlin.playerId);
        assert(otherView.assassinId === assassin.playerId && otherView.assassinTargets.length === 0, 'ทุกคนรู้ว่าใครคือมือสังหาร แต่ไม่ได้รายชื่อเป้า');
        throws(() => engine.submitAssassination(room, merlin.playerId, assassin.playerId, ctx(room)), /มือสังหารเท่านั้น/, 'คนอื่นแทงไม่ได้');
        throws(() => engine.submitAssassination(room, assassin.playerId, assassin.playerId, ctx(room)), /เลือกคนนี้ไม่ได้/, 'แทงตัวเองไม่ได้');
        throws(() => engine.submitAssassination(room, assassin.playerId, minion.playerId, ctx(room)), /เลือกคนนี้ไม่ได้/, 'แทงพวกเดียวกันที่รู้จักไม่ได้');
        engine.submitAssassination(room, assassin.playerId, merlin.playerId, ctx(room));
        assert(S(room).winner.team === 'evil' && S(room).winner.reason === 'assassin', 'แทงถูกเมอร์ลิน = ฝ่ายร้ายชนะ');
        const final = engine.buildClientState(room, merlin.playerId);
        assert(final.assassinTargetId === merlin.playerId && final.players.every(p => p.role), 'จบแล้วเปิดเป้าและบททุกคน');
    }
    // ลอบสังหารพลาด → ฝ่ายดีชนะ
    {
        const room = goodSweep(8, ['percival', 'morgana']);
        const assassin = seatBy(room, seat => seat.role === 'assassin');
        const wrong = seatBy(room, seat => seat.team === 'good' && seat.role !== 'merlin');
        engine.submitAssassination(room, assassin.playerId, wrong.playerId, ctx(room));
        assert(S(room).winner.team === 'good' && S(room).winner.reason === 'assassin-miss', 'แทงพลาด = ฝ่ายดีชนะ');
    }
    // ล้ม 3 ภารกิจ → ฝ่ายร้ายชนะ
    {
        const room = start(5);
        skipNight(room);
        const evil = seatBy(room, seat => seat.team === 'evil').playerId;
        const goodIds = seatsBy(room, seat => seat.team === 'good').map(seat => seat.playerId);
        for (let q = 0; q < 3; q += 1) {
            const size = S(room).quests[S(room).questIndex].size;
            runQuest(room, seat => (seat.team === 'evil' ? 'fail' : 'success'), [evil, ...goodIds].slice(0, size));
        }
        assert(S(room).winner.team === 'evil' && S(room).winner.reason === 'quests', 'ล้ม 3 ภารกิจ = ฝ่ายร้ายชนะ');
    }
    // ฝ่ายร้ายเลือกลงสำเร็จได้
    {
        const room = start(5);
        skipNight(room);
        const evil = seatBy(room, seat => seat.team === 'evil').playerId;
        const goodIds = seatsBy(room, seat => seat.team === 'good').map(seat => seat.playerId);
        runQuest(room, () => 'success', [evil, goodIds[0]]);
        assert(S(room).quests[0].result === 'success', 'ฝ่ายร้ายลงสำเร็จได้');
    }
    console.log('6. จบเกมครบทุกแบบ: แทงถูก / แทงพลาด / ล้ม 3 / คัดค้าน 5 ✓');
})();

/* ------------------------------------------------------------------ 7. timeouts */
(function testTimeouts() {
    const room = start(7);
    const expire = () => { S(room).phaseEndsAt = Date.now() - 1; };
    // ยังไม่หมดเวลา = ไม่ทำอะไร
    const before = S(room).step;
    engine.autoResolvePhase(room);
    assert(S(room).step === before && S(room).phase === 'night', 'ยังไม่หมดเวลาห้าม resolve');
    engine.submitReady(room, 'p1', ctx(room));
    expire();
    engine.autoResolvePhase(room);
    assert(S(room).phase === 'team', 'กลางคืนหมดเวลา = พร้อมให้ทุกคน');

    const leaderIdx = S(room).seats.findIndex(seat => seat.playerId === S(room).leaderId);
    expire();
    engine.autoResolvePhase(room);
    const size = S(room).quests[0].size;
    const expected = Array.from({ length: size }, (_, i) => S(room).seats[(leaderIdx + i) % 7].playerId);
    assert(S(room).phase === 'vote' && JSON.stringify(S(room).proposal.teamIds) === JSON.stringify(expected), 'เลือกทีมไม่ทัน = หัวหน้า + คนถัดไป');

    engine.submitVote(room, S(room).seats[0].playerId, 'reject', ctx(room));
    engine.submitVote(room, S(room).seats[1].playerId, 'reject', ctx(room));
    expire();
    engine.autoResolvePhase(room);
    assert(S(room).lastVote.approveCount === 5 && S(room).lastVote.rejectCount === 2, 'ไม่โหวต = นับเป็นเห็นด้วย');
    assert(S(room).phase === 'quest', 'ผ่านไปภารกิจ');
    expire();
    engine.autoResolvePhase(room);
    assert(S(room).quests[0].result === 'success' && S(room).quests[0].failCount === 0, 'ภารกิจหมดเวลา = การ์ดสำเร็จ');

    // เฟสลอบสังหารหมดเวลา = สุ่มฝ่ายดี
    for (let i = 0; i < 20; i += 1) {
        const r = goodSweep(6);
        r.gameState.phaseEndsAt = Date.now() - 1;
        engine.autoResolvePhase(r);
        const target = r.gameState.seats.find(seat => seat.playerId === r.gameState.assassinTargetId);
        assert(target && target.team === 'good', 'หมดเวลาลอบสังหาร = สุ่มเป้าฝ่ายดี');
        assert(r.gameState.phase === 'finished', 'แล้วจบเกม');
    }
    // force ใช้กับทุกเฟสได้ ไม่ค้าง
    const r2 = start(10, ['percival', 'morgana', 'mordred', 'oberon']);
    let guard = 0;
    while (r2.gameState.phase !== 'finished' && guard < 200) {
        engine.autoResolvePhase(r2, { force: true });
        guard += 1;
    }
    assert(r2.gameState.phase === 'finished', 'หมดเวลาทุกเฟสติดกัน เกมต้องจบได้เอง');
    console.log('7. หมดเวลาทุกเฟส resolve ตามค่าเริ่มต้น เกมไม่ค้าง ✓');
})();

/* ------------------------------------------------------------------ 8. leaving mid-game */
function leave(room, playerId) {
    room.players = room.players.filter(p => p.playerId !== playerId);
    room.gameState.players = room.gameState.players.filter(p => p.playerId !== playerId);
    engine.handlePlayerLeft(room, playerId);
}

(function testLeaving() {
    // หัวหน้าออกตอนเลือกทีม → ส่งต่อ
    {
        const room = start(7);
        skipNight(room);
        const leader = S(room).leaderId;
        const idx = S(room).seats.findIndex(seat => seat.playerId === leader);
        const stepBefore = S(room).step;
        leave(room, leader);
        assert(S(room).leaderId === S(room).seats[(idx + 1) % 7].playerId, 'หัวหน้าออก → คนถัดไปเป็นหัวหน้า');
        assert(S(room).phase === 'team' && S(room).step > stepBefore, 'เริ่มเลือกทีมใหม่ (step ใหม่)');
        throws(() => engine.submitTeam(room, S(room).leaderId, [leader, ...S(room).seats.filter(s => !s.left).map(s => s.playerId)].slice(0, S(room).quests[0].size), ctx(room)), /ออกจากเกม/, 'เลือกคนที่ออกไปแล้วเข้าทีมไม่ได้');
        // หัวหน้าต่อ ๆ ไปข้ามคนที่ออก
        for (let i = 0; i < 6; i += 1) {
            proposeTeam(room);
            voteAll(room, () => (i < 4 ? 'reject' : 'approve'));
            assert(S(room).leaderId !== leader, 'คนที่ออกต้องไม่ได้เป็นหัวหน้าอีก');
            if (S(room).phase !== 'team') break;
        }
        // ออกตอนโหวต: นับเฉพาะคนที่อยู่
    }
    // ออกระหว่างภารกิจ → นับเป็นสำเร็จ
    {
        const room = start(6);
        skipNight(room);
        const team = proposeTeam(room);
        voteAll(room, () => 'approve');
        const [first, second] = team;
        const firstSeat = seatBy(room, seat => seat.playerId === first);
        engine.submitQuestCard(room, first, firstSeat.team === 'evil' ? 'fail' : 'success', ctx(room));
        leave(room, second);
        assert(S(room).phase === 'team' && S(room).questIndex === 1, 'สมาชิกทีมคนสุดท้ายออก → สรุปภารกิจทันที');
        assert(S(room).lastQuest.cards.length === 2, 'ยังมีการ์ดครบขนาดทีม');
    }
    // ออกระหว่างโหวต: ครบคนที่เหลือแล้วสรุปทันที
    {
        const room = start(6);
        skipNight(room);
        proposeTeam(room);
        const seats = S(room).seats;
        seats.slice(0, 5).forEach(seat => engine.submitVote(room, seat.playerId, 'approve', ctx(room)));
        leave(room, seats[5].playerId);
        assert(S(room).phase === 'quest' && S(room).lastVote.votes.length === 5, 'คนที่ยังไม่โหวตออก → สรุปจากคนที่เหลือ');
    }
    // เหลือไม่ถึง 5 → ยกเลิก (ไม่มีผู้ชนะ)
    {
        const room = start(5);
        skipNight(room);
        leave(room, 'p3');
        assert(S(room).phase === 'finished' && S(room).winner.abandoned && S(room).winner.team === null, 'เหลือ 4 คน = ยกเลิกเกม ไม่มีทีมชนะ');
        assert(S(room).status === 'avalon_finished', 'status จบ');
        engine.handlePlayerLeft(room, 'p4');
        assert(S(room).winner.abandoned, 'ออกซ้ำหลังจบไม่พัง');
    }
    // มือสังหารออกตอนลอบสังหาร → ฝ่ายร้ายคนอื่นรับช่วง
    {
        const room = goodSweep(7);
        const assassin = S(room).assassinId;
        leave(room, assassin);
        const replacement = seatBy(room, seat => seat.playerId === S(room).assassinId);
        assert(S(room).phase === 'assassin' && replacement && replacement.team === 'evil' && !replacement.left, 'ฝ่ายร้ายคนอื่นรับหน้าที่มือสังหาร');
        const merlin = seatBy(room, seat => seat.role === 'merlin');
        engine.submitAssassination(room, replacement.playerId, merlin.playerId, ctx(room));
        assert(S(room).winner.team === 'evil', 'คนรับช่วงแทงถูกก็ชนะ');
    }
    // กลับเข้าห้องแล้วเล่นต่อได้
    {
        const room = start(6);
        skipNight(room);
        const snapshot = room.gameState.players.find(p => p.playerId === 'p2');
        leave(room, 'p2');
        assert(seatBy(room, seat => seat.playerId === 'p2').left, 'ออกแล้ว left=true');
        room.gameState.players.push({ ...snapshot });
        const view = engine.buildClientState(room, 'p2');
        assert(!seatBy(room, seat => seat.playerId === 'p2').left && view.self && view.self.role, 'กลับมาแล้วได้บทเดิม เล่นต่อ');
    }
    console.log('8. คนออกกลางเกม: ส่งต่อหัวหน้า / สรุปโหวต-ภารกิจ / ยกเลิกเมื่อไม่ถึง 5 / รับช่วงมือสังหาร / กลับเข้าได้ ✓');
})();

/* ------------------------------------------------------------------ 9. randomized invariants */
(function testRandomized() {
    const optionalSets = [[], ['percival'], ['percival', 'morgana'], ['mordred'], ['oberon'], ['percival', 'morgana', 'mordred'], ['percival', 'morgana', 'mordred', 'oberon']];
    const endings = {};
    const GAMES = Number(process.env.AVALON_RANDOM_GAMES) || 600;
    for (let g = 0; g < GAMES; g += 1) {
        const count = 5 + Math.floor(Math.random() * 6);
        const evil = engine.TEAM_COUNTS[count].evil;
        const choices = optionalSets.filter(set => set.filter(id => ['morgana', 'mordred', 'oberon'].includes(id)).length <= evil - 1);
        const roles = choices[Math.floor(Math.random() * choices.length)];
        const room = start(count, roles);
        const state = () => room.gameState;
        const fails = new Map();
        let steps = 0;
        let lastQuestIndex = 0;
        while (state().phase !== 'finished') {
            steps += 1;
            if (steps > 400) throw new Error('เกมสุ่มไม่จบใน 400 ก้าว');
            const st = state();
            const active = st.seats.filter(seat => !st.seats.find(s => s.playerId === seat.playerId).left);

            // invariants ระหว่างเกม
            assert(st.rejectCount >= 0 && st.rejectCount < 5, 'rejectCount 0–4 ระหว่างเกม');
            assert(st.quests.filter(q => q.result === 'success').length <= 3 && st.quests.filter(q => q.result === 'fail').length < 3, 'ยังไม่ถึงเงื่อนไขจบ');
            assert(st.questIndex >= lastQuestIndex && st.questIndex < 5, 'questIndex เดินหน้าอย่างเดียว');
            lastQuestIndex = st.questIndex;
            if (st.phase === 'team' || st.phase === 'vote') {
                const leader = st.seats.find(seat => seat.playerId === st.leaderId);
                if (st.phase === 'team') assert(leader && !leader.left, 'หัวหน้าต้องเป็นคนที่ยังอยู่');
            }
            if (st.phase === 'vote' || st.phase === 'quest') {
                assert(st.proposal.teamIds.length === st.quests[st.questIndex].size, 'ขนาดทีมตรงภารกิจ');
                assert(new Set(st.proposal.teamIds).size === st.proposal.teamIds.length, 'ทีมไม่มีคนซ้ำ');
            }
            if (Math.random() < 0.08) {
                const viewer = st.seats[Math.floor(Math.random() * st.seats.length)].playerId;
                assertNoLeak(room, viewer, `random:${st.phase}`);
            }

            const roll = Math.random();
            if (roll < 0.05) {
                engine.autoResolvePhase(room, { force: true });
                continue;
            }
            if (roll < 0.06 && active.length > 5) {
                const victim = active[Math.floor(Math.random() * active.length)].playerId;
                leave(room, victim);
                continue;
            }
            // stale step ต้องถูกปฏิเสธเสมอ
            if (roll < 0.08 && st.phase !== 'night') {
                const actor = active[0].playerId;
                try {
                    engine.submitVote(room, actor, 'approve', { step: st.step - 1 });
                    throw new Error('STALE_ACCEPTED');
                } catch (error) {
                    assert(error.message !== 'STALE_ACCEPTED', 'step เก่าต้องไม่ผ่าน');
                }
                continue;
            }

            if (st.phase === 'night') {
                active.forEach(seat => {
                    if (state().phase === 'night') engine.submitReady(room, seat.playerId, { step: state().step });
                });
            } else if (st.phase === 'team') {
                const size = st.quests[st.questIndex].size;
                const pool = [...active].sort(() => Math.random() - 0.5).slice(0, size).map(seat => seat.playerId);
                engine.submitTeam(room, st.leaderId, pool, { step: st.step });
            } else if (st.phase === 'vote') {
                const step = st.step;
                active.forEach(seat => {
                    if (state().phase === 'vote' && state().step === step && Math.random() < 0.95) {
                        engine.submitVote(room, seat.playerId, Math.random() < 0.6 ? 'approve' : 'reject', { step });
                    }
                });
                if (state().phase === 'vote' && state().step === step) engine.autoResolvePhase(room, { force: true });
            } else if (st.phase === 'quest') {
                const step = st.step;
                st.proposal.teamIds.forEach(id => {
                    const seat = st.seats.find(s => s.playerId === id);
                    if (seat.left || state().phase !== 'quest' || state().step !== step) return;
                    const card = seat.team === 'evil' && Math.random() < 0.6 ? 'fail' : 'success';
                    if (seat.team === 'good') {
                        try {
                            engine.submitQuestCard(room, id, 'fail', { step });
                            throw new Error('GOOD_FAIL_ACCEPTED');
                        } catch (error) {
                            assert(error.message !== 'GOOD_FAIL_ACCEPTED', 'ฝ่ายดีต้องลงล้มไม่ได้');
                        }
                    }
                    engine.submitQuestCard(room, id, card, { step });
                    if (card === 'fail') fails.set(id, (fails.get(id) || 0) + 1);
                });
            } else if (st.phase === 'assassin') {
                const targets = engine.buildClientState(room, st.assassinId).assassinTargets;
                assert(targets.length > 0, 'มือสังหารต้องมีเป้าให้เลือก');
                engine.submitAssassination(room, st.assassinId, targets[Math.floor(Math.random() * targets.length)], { step: st.step });
            }
        }

        const st = state();
        // invariants ตอนจบ
        const successes = st.quests.filter(q => q.result === 'success').length;
        const failed = st.quests.filter(q => q.result === 'fail').length;
        fails.forEach((n, id) => {
            assert(st.seats.find(seat => seat.playerId === id).team === 'evil', 'การ์ดล้มมาจากฝ่ายร้ายเท่านั้น');
        });
        st.quests.forEach(q => {
            if (q.result) assert((q.failCount >= q.failsNeeded) === (q.result === 'fail'), 'ผลภารกิจตรงกับจำนวนการ์ดล้ม');
        });
        const w = st.winner;
        assert(w && st.status === 'avalon_finished', 'จบแล้วต้องมี winner');
        if (w.abandoned) {
            assert(st.seats.filter(seat => !seat.left).length < 5, 'ยกเลิกได้เฉพาะคนเหลือไม่ถึง 5');
        } else if (w.reason === 'quests' && w.team === 'evil') {
            assert(failed === 3, 'ฝ่ายร้ายชนะด้วยภารกิจ = ล้ม 3');
        } else if (w.reason === 'rejects') {
            assert(st.rejectCount === 5 && w.team === 'evil', 'คัดค้านครบ 5');
        } else if (w.reason === 'assassin') {
            const target = st.seats.find(seat => seat.playerId === st.assassinTargetId);
            assert(successes === 3 && w.team === 'evil' && target.role === 'merlin', 'แทงถูก = เมอร์ลิน');
        } else if (w.reason === 'assassin-miss') {
            const target = st.seats.find(seat => seat.playerId === st.assassinTargetId);
            assert(successes === 3 && w.team === 'good' && target.role !== 'merlin', 'แทงพลาด');
        } else if (w.reason === 'quests' && w.team === 'good') {
            assert(successes === 3, 'ฝ่ายดีชนะโดยไม่มีมือสังหาร');
        } else {
            throw new Error('ผลจบเกมไม่รู้จัก: ' + JSON.stringify(w));
        }
        assert(successes <= 3 && failed <= 3, 'ภารกิจไม่เกิน 3');
        const view = engine.buildClientState(room, st.seats[0].playerId);
        assert(view.players.every(p => p.role && p.team), 'จบแล้วเปิดบททุกคน');
        JSON.parse(JSON.stringify(st));
        const key = w.abandoned ? 'abandoned' : `${w.team}:${w.reason}`;
        endings[key] = (endings[key] || 0) + 1;
    }
    ['evil:quests', 'evil:rejects', 'evil:assassin', 'good:assassin-miss'].forEach(key => {
        assert(endings[key] > 0, `เกมสุ่มต้องเจอผลจบแบบ ${key}`);
    });
    console.log(`9. สุ่มเล่น ${GAMES} เกม invariant ผ่านทั้งหมด · ผลจบ ${JSON.stringify(endings)} ✓`);
})();

// ux: คนในห้องที่หลุดตอนเริ่ม ต้องอยู่ใน gameState.players (ไม่งั้น /game ↔ /room เด้งวน) แต่ไม่ได้นั่งโต๊ะ
(function lateWatcher() {
    const room = makeRoom(6);
    room.players[5].socketId = null;
    engine.startGame(room);
    const st = S(room);
    assert(st.seats.length === 5 && !st.seats.some(seat => seat.playerId === 'p6'), 'คนที่หลุดตอนเริ่มต้องไม่ได้นั่งโต๊ะ');
    assert(st.players.some(player => player.playerId === 'p6'), 'คนที่หลุดตอนเริ่มต้องยังเปิดหน้าเกมได้ (อยู่ใน gameState.players)');
    const view = engine.buildClientState(room, 'p6');
    assert(view.self === null && view.players.length === 5 && view.players.every(p => p.role === null), 'คนดูไม่มีบทและไม่เห็นบทใคร');
    skipNight(room);
    // ช่วงลอบสังหารไม่มีหัวหน้า (มงกุฎไม่ค้าง)
    const r2 = start(5);
    skipNight(r2);
    for (let q = 0; q < 3; q += 1) {
        const goods = seatsBy(r2, seat => seat.team === 'good').map(seat => seat.playerId);
        runQuest(r2, () => 'success', goods.slice(0, S(r2).quests[S(r2).questIndex].size));
    }
    assert(S(r2).phase === 'assassin', 'สำเร็จ 3 ต้องเข้าลอบสังหาร');
    assert(engine.buildClientState(r2, 'p1').players.every(p => !p.isLeader), 'ช่วงลอบสังหารไม่มีหัวหน้า');
    console.log('10. คนหลุดตอนเริ่มเปิดหน้าเกมได้แบบคนดู · ช่วงลอบสังหารไม่มีมงกุฎค้าง ✓');
})();

console.log(`\n✅ avalon engine: ผ่าน ${checks} เช็ก`);
