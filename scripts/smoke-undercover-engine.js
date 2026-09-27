/**
 * เทสตรรกะคำใครไม่เหมือน (ไม่ต้องมีเซิร์ฟเวอร์)
 * รัน: node scripts/smoke-undercover-engine.js
 *
 * ครอบคลุม: คู่คำ, จำนวนบท, แจกเฉพาะคนออนไลน์, จบเกมทุกแบบ, ปัดคำสั่งผิด,
 * ไม่รั่วความลับ, หมดเวลา, คนออกกลางเกม, บันทึกสถิติ, และสุ่มเล่นหลายร้อยเกมเช็ก invariant
 */

const { DATA_DIR } = require('./isolateTestData');
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

function makeRoom(playerCount, options = {}) {
    const players = Array.from({ length: playerCount }, (_, i) => ({
        playerId: 'p' + i,
        playerName: 'ผู้เล่น' + i,
        color: '#fff',
        avatar: '👤',
        socketId: options.offline && options.offline.includes(i) ? null : 'sock' + i,
        permission: i === 0 ? 'admin' : null
    }));
    return {
        roomId: 'test',
        name: 'UndercoverTest',
        admin: 'p0',
        players,
        settings: { gameMode: 'undercover', undercoverMrWhite: !!options.mrWhite },
        gameState: engine.createInitialState()
    };
}

function started(playerCount, options = {}) {
    const room = makeRoom(playerCount, options);
    engine.startGame(room);
    return room;
}

const S = room => ({ step: room.gameState.step });
const byRole = (room, role) => room.gameState.players.filter(p => p.role === role);
const alive = room => room.gameState.players.filter(p => p.alive);
const speaker = room => room.gameState.speakerOrder[room.gameState.speakerIndex];

function readyAll(room) {
    room.gameState.players.filter(p => p.alive && !p.ready).forEach(p => engine.submitReady(room, p.playerId, S(room)));
}
function speakAll(room) {
    let guard = 0;
    while (room.gameState.phase === 'clue' && guard++ < 20) {
        engine.submitClueDone(room, speaker(room), S(room));
    }
}
/** ทุกคนที่ยังรอดโหวต target (ตัว target เองโหวตคนอื่น) */
function voteOut(room, targetId) {
    const voters = alive(room).map(p => p.playerId);
    const fallback = voters.find(id => id !== targetId);
    voters.forEach(voterId => {
        if (room.gameState.phase !== 'vote') return;
        const target = voterId === targetId ? fallback : targetId;
        const other = voters.find(id => id !== voterId && id !== targetId) || fallback;
        engine.submitVote(room, voterId, voterId === targetId ? other : target, S(room));
    });
}
function toNextRound(room) {
    if (room.gameState.phase === 'elimination') engine.continueAfterResult(room, 'p0', S(room));
}

// ---------------------------------------------------------------- word list
assert(engine.WORD_PAIRS.length >= 150, `ต้องมีคู่คำ ≥150 (มี ${engine.WORD_PAIRS.length})`);
const pairIds = new Set(engine.WORD_PAIRS.map(p => p.id));
assert(pairIds.size === engine.WORD_PAIRS.length, 'คู่คำห้ามซ้ำ');
assert(engine.WORD_PAIRS.every(p => p.a && p.b && p.a !== p.b && p.category), 'ทุกคู่ต้องมีหมวดและสองคำต่างกัน');
assert(engine.normalizeWord('  กา แฟ ') === engine.normalizeWord('กาแฟ'), 'เทียบคำต้องไม่สนช่องว่าง');
assert(engine.normalizeWord('Pizza') === engine.normalizeWord('pizza'), 'เทียบคำต้องไม่สนตัวพิมพ์');
console.log(`✓ คู่คำ ${engine.WORD_PAIRS.length} คู่ ไม่ซ้ำ`);

// ไม่ใช้คู่ซ้ำในห้องเดียวจนกว่าจะครบ + สลับฝั่งคำแบบสุ่ม
{
    const room = makeRoom(4);
    const seen = new Set();
    let swapped = 0;
    for (let i = 0; i < engine.WORD_PAIRS.length; i += 1) {
        const pick = engine.pickWordPair(room);
        assert(!seen.has(pick.id), 'ห้ามใช้คู่คำซ้ำก่อนครบทุกคู่');
        seen.add(pick.id);
        const source = engine.WORD_PAIRS.find(p => p.id === pick.id);
        if (pick.civilian === source.b) swapped += 1;
    }
    assert(seen.size === engine.WORD_PAIRS.length, 'ต้องวนครบทุกคู่');
    assert(swapped > 20 && swapped < engine.WORD_PAIRS.length - 20, 'ต้องสลับว่าคำไหนเป็นคำพลเมืองแบบสุ่ม');
    const again = engine.pickWordPair(room);
    assert(pairIds.has(again.id), 'ครบแล้วต้องวนใหม่ได้');
    console.log('✓ ไม่ซ้ำคู่คำในห้องเดียวจนครบ และสลับฝั่งคำ');
}

// ---------------------------------------------------------------- setup
for (let n = 4; n <= 10; n += 1) {
    const counts = engine.getRoleCounts(n, true);
    assert(counts.undercover === (n >= 7 ? 2 : 1), `${n} คน ต้องมีสายแฝง ${n >= 7 ? 2 : 1}`);
    assert(counts.mrWhite === (n >= 6 ? 1 : 0), `${n} คน Mr. White ต้อง ${n >= 6 ? 1 : 0}`);
    assert(engine.getRoleCounts(n, false).mrWhite === 0, 'ปิด Mr. White ต้องไม่มี');
    const room = started(n, { mrWhite: true });
    assert(byRole(room, 'undercover').length === counts.undercover, 'จำนวนสายแฝงตอนแจกไม่ตรง');
    assert(byRole(room, 'mrwhite').length === counts.mrWhite, 'จำนวน Mr. White ตอนแจกไม่ตรง');
    const civWords = new Set(byRole(room, 'civilian').map(p => p.word));
    const ucWords = new Set(byRole(room, 'undercover').map(p => p.word));
    assert(civWords.size === 1 && ucWords.size === 1, 'พลเมืองได้คำเดียวกันหมด สายแฝงได้คำเดียวกันหมด');
    assert([...civWords][0] !== [...ucWords][0], 'คำพลเมืองกับสายแฝงต้องต่างกัน');
    assert(byRole(room, 'mrwhite').every(p => p.word === null), 'Mr. White ต้องไม่มีคำ');
    assert(room.gameState.phase === 'reveal' && room.gameState.phaseEndsAt > Date.now(), 'เริ่มที่ช่วงดูคำพร้อมเวลา');
}
throwsWith(() => started(3), /4–10/, 'ต่ำกว่า 4 คนต้องเริ่มไม่ได้');
throwsWith(() => started(11), /4–10/, 'เกิน 10 คนต้องเริ่มไม่ได้');
{
    const room = started(6, { offline: [5] });
    assert(room.gameState.players.length === 5, 'แจกเฉพาะคนที่ออนไลน์');
    assert(!room.gameState.players.some(p => p.playerId === 'p5'), 'คนออฟไลน์ต้องไม่ได้บท');
    assert(byRole(room, 'mrwhite').length === 0, '5 คนออนไลน์ Mr. White ต้องไม่มีแม้เปิดตั้งค่า');
    throwsWith(() => started(5, { offline: [3, 4] }), /4–10/, 'ออนไลน์ไม่ถึง 4 ต้องเริ่มไม่ได้');
}
console.log('✓ จำนวนบท / แจกเฉพาะคนออนไลน์ / คำพลเมือง-สายแฝง');

// ---------------------------------------------------------------- secrets
function assertNoLeak(room, label) {
    const state = room.gameState;
    const pair = state.pair;
    state.players.forEach(viewer => {
        const view = engine.buildClientState(room, viewer.playerId);
        const json = JSON.stringify(view);
        if (state.phase !== 'finished') {
            const hidden = [pair.civilian, pair.undercover].filter(word => word !== viewer.word);
            hidden.forEach(word => {
                assert(!json.includes(`"${word}"`) && !json.includes(`“${word}”`),
                    `${label}: ${viewer.playerId} (${viewer.role}) เห็นคำที่ไม่ใช่ของตัวเอง "${word}"`);
            });
            assert(view.pair === null, `${label}: คู่คำห้ามส่งก่อนจบเกม`);
            view.players.forEach(p => {
                const real = state.players.find(x => x.playerId === p.playerId);
                if (real.alive) assert(p.role === null, `${label}: บทของคนที่ยังรอดต้องไม่ถูกส่ง`);
                assert(p.word === null, `${label}: คำของผู้เล่นต้องไม่ถูกส่งก่อนจบ`);
            });
            if (viewer.role !== 'mrwhite' && viewer.alive) {
                assert(view.self.role === null, `${label}: ผู้เล่นทั่วไปต้องไม่รู้ว่าตัวเองฝั่งไหน`);
            }
            if (viewer.role === 'mrwhite') assert(view.self.isMrWhite === true, `${label}: Mr. White ต้องรู้ตัว`);
            if (state.phase === 'vote') {
                Object.entries(state.votes).forEach(([voterId, targetId]) => {
                    if (voterId === viewer.playerId) return;
                    assert(view.self.voteTargetId !== targetId || state.votes[viewer.playerId] === targetId,
                        `${label}: ห้ามเห็นโหวตของคนอื่น`);
                });
                assert(!('votes' in (view.vote || {})), `${label}: ห้ามส่งแผนที่โหวตระหว่างโหวต`);
            }
        }
    });
}
{
    const room = started(8, { mrWhite: true });
    assertNoLeak(room, 'reveal');
    readyAll(room);
    assertNoLeak(room, 'clue');
    speakAll(room);
    const [first, second] = alive(room);
    engine.submitVote(room, first.playerId, second.playerId, S(room));
    assertNoLeak(room, 'vote');
    const firstView = engine.buildClientState(room, first.playerId);
    const secondView = engine.buildClientState(room, second.playerId);
    assert(firstView.self.voteTargetId === second.playerId, 'ต้องเห็นโหวตของตัวเอง');
    assert(secondView.self.voteTargetId === null, 'คนอื่นต้องไม่เห็นว่าเราโหวตใคร');
    assert(secondView.players.find(p => p.playerId === first.playerId).hasVoted === true, 'บอกได้แค่ว่าโหวตแล้ว');
    console.log('✓ ไม่รั่วคำ / บท / โหวต ของคนอื่น');
}

// ---------------------------------------------------------------- ending: civilians win
{
    const room = started(5);
    const uc = byRole(room, 'undercover')[0];
    readyAll(room);
    assert(room.gameState.phase === 'clue' && room.gameState.round === 1, 'ทุกคนพร้อมแล้วต้องเข้าช่วงใบ้รอบ 1');
    speakAll(room);
    assert(room.gameState.phase === 'vote', 'ใบ้ครบต้องเข้าโหวต');
    voteOut(room, uc.playerId);
    assert(room.gameState.phase === 'finished', 'โหวตสายแฝงคนเดียวออกต้องจบเกม');
    assert(room.gameState.winner.team === 'civilians', 'พลเมืองต้องชนะ');
    assert(room.gameState.winner.winnerIds.length === 4 && !room.gameState.winner.winnerIds.includes(uc.playerId), 'ผู้ชนะ = พลเมืองทุกคน');
    const view = engine.buildClientState(room, 'p1');
    assert(view.pair && view.players.every(p => p.role && (p.word || p.role.id === 'mrwhite')), 'จบเกมต้องเปิดคำและบททุกคน');
    console.log('✓ จบแบบพลเมืองชนะ');
}

// ---------------------------------------------------------------- ending: undercover wins (2 left)
{
    const room = started(4);
    const uc = byRole(room, 'undercover')[0];
    readyAll(room);
    let rounds = 0;
    while (room.gameState.phase !== 'finished' && rounds++ < 5) {
        speakAll(room);
        const civ = alive(room).find(p => p.role === 'civilian');
        voteOut(room, civ.playerId);
        toNextRound(room);
    }
    assert(room.gameState.winner.team === 'undercover', 'เหลือ 2 คนมีสายแฝงต้องชนะ');
    assert(alive(room).length === 2 && alive(room).some(p => p.playerId === uc.playerId), 'สายแฝงต้องรอดถึง 2 คนสุดท้าย');
    assert(room.gameState.winner.winnerIds.join() === uc.playerId, 'ผู้ชนะ = สายแฝง');
    console.log('✓ จบแบบสายแฝงรอดถึง 2 คนสุดท้าย');
}

// ---------------------------------------------------------------- Mr. White
function gameWithMrWhiteVotedOut(guessCorrect) {
    const room = started(6, { mrWhite: true });
    const mw = byRole(room, 'mrwhite')[0];
    readyAll(room);
    speakAll(room);
    voteOut(room, mw.playerId);
    assert(room.gameState.phase === 'mrwhite', 'โหวต Mr. White ออกต้องเข้าช่วงทายคำ');
    const view = engine.buildClientState(room, mw.playerId);
    assert(view.self.canGuess === true, 'Mr. White ต้องทายได้');
    assert(engine.buildClientState(room, 'p0').self.canGuess === (mw.playerId === 'p0'), 'คนอื่นทายไม่ได้');
    const other = room.gameState.players.find(p => p.playerId !== mw.playerId);
    throwsWith(() => engine.submitMrWhiteGuess(room, other.playerId, 'x', S(room)), /Mr\. White/, 'คนอื่นทายแทนไม่ได้');
    throwsWith(() => engine.submitMrWhiteGuess(room, mw.playerId, '   ', S(room)), /พิมพ์คำ/, 'ทายคำว่างไม่ได้');
    const word = room.gameState.pair.civilian;
    const guess = guessCorrect ? `  ${word.split('').join('')} `.toUpperCase() : 'ไม่ใช่แน่นอน';
    engine.submitMrWhiteGuess(room, mw.playerId, guess, S(room));
    return { room, mw };
}
{
    const { room, mw } = gameWithMrWhiteVotedOut(true);
    assert(room.gameState.phase === 'finished' && room.gameState.winner.team === 'mrwhite', 'ทายถูกต้องชนะทันที');
    assert(room.gameState.winner.winnerIds.join() === mw.playerId, 'Mr. White ชนะคนเดียว');
    assert(room.gameState.mrWhiteGuess.correct === true, 'บันทึกว่าทายถูก');
}
{
    const { room } = gameWithMrWhiteVotedOut(false);
    assert(room.gameState.phase === 'elimination', 'ทายผิดแล้วเกมเดินต่อ (สายแฝงยังอยู่)');
    assert(room.gameState.mrWhiteGuess.correct === false, 'บันทึกว่าทายผิด');
    throwsWith(() => engine.submitMrWhiteGuess(room, room.gameState.mrWhiteGuess.playerId, 'อีกที', S(room)), /ทายคำ/, 'ทายได้ครั้งเดียว');
}
{
    // Mr. White ห้ามพูดคนแรก ทุกรอบ
    for (let i = 0; i < 200; i += 1) {
        const room = started(6, { mrWhite: true });
        readyAll(room);
        const first = room.gameState.players.find(p => p.playerId === speaker(room));
        assert(first.role !== 'mrwhite', 'Mr. White ห้ามเป็นคนพูดคนแรก');
    }
    console.log('✓ Mr. White: ทายถูกชนะ / ทายผิดเล่นต่อ / ไม่พูดคนแรก');
}

// คนเริ่มพูดวนทุกรอบ
{
    const room = started(7);
    readyAll(room);
    const firsts = [speaker(room)];
    for (let r = 0; r < 2; r += 1) {
        speakAll(room);
        // โหวตเสมอสองรอบ = ไม่มีใครออก → คนในวงเท่าเดิม
        const ids = alive(room).map(p => p.playerId);
        ids.forEach((id, idx) => engine.submitVote(room, id, ids[(idx + 1) % ids.length], S(room)));
        assert(room.gameState.isRevote, 'เสมอต้องโหวตใหม่');
        const cands = room.gameState.voteCandidates;
        alive(room).forEach((p, idx) => {
            const targets = cands.filter(c => c !== p.playerId);
            engine.submitVote(room, p.playerId, targets[idx % targets.length], S(room));
        });
        toNextRound(room);
        firsts.push(speaker(room));
    }
    assert(new Set(firsts).size === 3, 'คนพูดคนแรกต้องเปลี่ยนทุกรอบ: ' + firsts.join(','));
    console.log('✓ คนเริ่มพูดเปลี่ยนทุกรอบ');
}

// ---------------------------------------------------------------- ties
{
    const room = started(4);
    readyAll(room);
    speakAll(room);
    const [a, b, c, d] = room.gameState.players.map(p => p.playerId);
    engine.submitVote(room, a, b, S(room));
    engine.submitVote(room, b, a, S(room));
    engine.submitVote(room, c, a, S(room));
    engine.submitVote(room, d, b, S(room));
    assert(room.gameState.phase === 'vote' && room.gameState.isRevote, 'เสมอครั้งแรก = โหวตใหม่');
    assert(room.gameState.voteCandidates.sort().join() === [a, b].sort().join(), 'โหวตใหม่เฉพาะคนที่เสมอ');
    throwsWith(() => engine.submitVote(room, c, d, S(room)), /เฉพาะคนที่เสมอ/, 'โหวตใหม่เลือกคนนอกไม่ได้');
    engine.submitVote(room, a, b, S(room));
    engine.submitVote(room, b, a, S(room));
    engine.submitVote(room, c, a, S(room));
    engine.submitVote(room, d, b, S(room));
    assert(room.gameState.phase === 'elimination' && room.gameState.lastElimination.playerId === null, 'เสมอซ้ำ = ไม่มีใครออก');
    assert(alive(room).length === 4, 'ไม่มีใครถูกคัดออก');
    console.log('✓ เสมอ → โหวตใหม่ → เสมออีก ไม่มีใครออก');
}
{
    // เสมอ/ไม่มีใครโหวตติดกัน MAX_STALE_ROUNDS รอบ → ฝ่ายแฝงรอด (กันเกมไม่จบ)
    const room = started(5);
    readyAll(room);
    for (let r = 0; r < engine.MAX_STALE_ROUNDS && room.gameState.phase !== 'finished'; r += 1) {
        speakAll(room);
        engine.autoResolvePhase(room, room.gameState.phaseEndsAt + 1);
        toNextRound(room);
    }
    assert(room.gameState.phase === 'finished' && room.gameState.winner.team === 'undercover', 'โหวตไม่ลงหลายรอบต้องจบให้ฝ่ายแฝง');
    console.log('✓ โหวตไม่ลงติดกัน → จบเกม ไม่วนไม่รู้จบ');
}

// ---------------------------------------------------------------- invalid moves
{
    const room = started(5);
    const [p0, p1] = ['p0', 'p1'];
    throwsWith(() => engine.submitReady(room, p0, { step: room.gameState.step - 1 }), /จังหวะเกมเปลี่ยน/, 'step เก่าต้องถูกปัด');
    throwsWith(() => engine.submitReady(room, p0, {}), /จังหวะเกมเปลี่ยน/, 'ไม่แนบ step ต้องถูกปัด');
    throwsWith(() => engine.submitReady(room, 'ghost', S(room)), /ไม่ได้อยู่ในเกม/, 'คนนอกเกมกดไม่ได้');
    engine.submitReady(room, p0, S(room));
    throwsWith(() => engine.submitReady(room, p0, S(room)), /พร้อมไปแล้ว/, 'กดพร้อมซ้ำไม่ได้');
    throwsWith(() => engine.submitVote(room, p0, p1, S(room)), /ไม่ใช่ช่วงโหวต/, 'ยังไม่ถึงโหวต');
    throwsWith(() => engine.submitClueDone(room, p0, S(room)), /ไม่ใช่ช่วงใบ้/, 'ยังไม่ถึงช่วงใบ้');
    readyAll(room);
    const staleStep = room.gameState.step - 1;
    const sp = speaker(room);
    const notSpeaker = room.gameState.players.find(p => p.playerId !== sp).playerId;
    throwsWith(() => engine.submitClueDone(room, notSpeaker, S(room)), /ยังไม่ถึงตาคุณ/, 'พูดแซงคิวไม่ได้');
    throwsWith(() => engine.submitClueDone(room, sp, { step: staleStep }), /จังหวะเกมเปลี่ยน/, 'กดพูดเสร็จจากจอเก่าไม่ได้');
    const spWord = room.gameState.players.find(p => p.playerId === sp).word;
    throwsWith(() => engine.submitClueDone(room, sp, { ...S(room), text: `มัน ${spWord} นะ` }), /ห้ามพิมพ์คำ/, 'พิมพ์คำตัวเองตรง ๆ ไม่ได้');
    const nonHost = room.gameState.players.find(p => p.playerId !== 'p0').playerId;
    throwsWith(() => engine.skipSpeaker(room, nonHost, S(room)), /หัวหน้าห้อง/, 'คนที่ไม่ใช่หัวห้องข้ามตาไม่ได้');
    const before = room.gameState.speakerIndex;
    engine.submitClueDone(room, sp, { ...S(room), text: '  ใช้   ตอนเช้า   ' + 'ยาวมาก'.repeat(20) });
    const clue = room.gameState.clues[room.gameState.clues.length - 1];
    assert(clue.text.length <= 40 && clue.text.startsWith('ใช้ ตอนเช้า'), 'คำใบ้ต้องตัดช่องว่างและความยาว');
    assert(room.gameState.speakerIndex === before + 1, 'พูดเสร็จแล้วไปคนถัดไป');
    engine.skipSpeaker(room, 'p0', S(room));
    assert(room.gameState.speakerIndex === before + 2, 'หัวห้องข้ามคน AFK ได้');
    speakAll(room);
    throwsWith(() => engine.submitVote(room, p0, p0, S(room)), /ตัวเอง/, 'โหวตตัวเองไม่ได้');
    throwsWith(() => engine.submitVote(room, p0, 'ghost', S(room)), /ผู้เล่นที่ยังอยู่/, 'โหวตคนนอกเกมไม่ได้');
    engine.submitVote(room, p0, p1, S(room));
    throwsWith(() => engine.submitVote(room, p0, 'p2', S(room)), /โหวตไปแล้ว/, 'โหวตซ้ำไม่ได้');
    throwsWith(() => engine.continueAfterResult(room, 'p0', S(room)), /ยังไปรอบต่อไม่ได้/, 'ยังไม่ถึงหน้าผล');
    // ทำให้มีคนตกรอบ แล้วคนตกรอบกดอะไรไม่ได้
    alive(room).filter(p => !(p.playerId in room.gameState.votes)).forEach(p => {
        engine.submitVote(room, p.playerId, p.playerId === p1 ? 'p2' : p1, S(room));
    });
    if (room.gameState.phase === 'elimination') {
        throwsWith(() => engine.continueAfterResult(room, nonHost === 'p0' ? 'p1' : nonHost, S(room)), /หัวหน้าห้อง/, 'ไปต่อได้เฉพาะหัวห้อง');
        engine.continueAfterResult(room, 'p0', S(room));
        const out = room.gameState.players.find(p => !p.alive);
        if (out && room.gameState.phase === 'clue') {
            throwsWith(() => engine.submitClueDone(room, out.playerId, S(room)), /ถูกโหวตออก/, 'คนตกรอบพูดไม่ได้');
        }
    }
    console.log('✓ ปัดคำสั่งผิด: step เก่า / แซงคิว / ซ้ำ / โหวตตัวเอง / ไม่ใช่หัวห้อง / พิมพ์คำตัวเอง');
}

// ---------------------------------------------------------------- timeouts
{
    const room = started(6, { mrWhite: true });
    const t = () => room.gameState.phaseEndsAt + 1;
    const early = engine.autoResolvePhase(room, room.gameState.phaseEndsAt - 1000);
    assert(early.phase === 'reveal', 'ยังไม่หมดเวลาต้องไม่ข้ามเฟส');
    engine.autoResolvePhase(room, t());
    assert(room.gameState.phase === 'clue' && room.gameState.players.every(p => p.ready), 'หมดเวลาดูคำ = พร้อมอัตโนมัติ');
    const firstSpeaker = speaker(room);
    engine.autoResolvePhase(room, t());
    assert(speaker(room) !== firstSpeaker, 'หมดเวลาพูด = ไปคนถัดไป');
    let guard = 0;
    while (room.gameState.phase === 'clue' && guard++ < 10) engine.autoResolvePhase(room, t());
    assert(room.gameState.phase === 'vote', 'หมดเวลาพูดครบทุกคน = เข้าโหวต');
    const mw = byRole(room, 'mrwhite')[0];
    alive(room).filter(p => p.playerId !== mw.playerId).slice(0, 3).forEach(p => engine.submitVote(room, p.playerId, mw.playerId, S(room)));
    engine.autoResolvePhase(room, t());
    assert(room.gameState.phase === 'mrwhite', 'หมดเวลาโหวต = นับเสียงที่มี คนไม่โหวต = งดออกเสียง');
    engine.autoResolvePhase(room, t());
    assert(room.gameState.mrWhiteGuess.correct === false && room.gameState.phase === 'elimination', 'Mr. White หมดเวลาทาย = ทายผิด');
    engine.autoResolvePhase(room, t());
    assert(room.gameState.phase === 'clue' && room.gameState.round === 2, 'หน้าผลหมดเวลา = รอบถัดไป');
    console.log('✓ หมดเวลาทุกเฟส resolve เองได้');
}

// ---------------------------------------------------------------- leave / offline
{
    const room = started(5);
    readyAll(room);
    const sp = speaker(room);
    room.players.find(p => p.playerId === sp).socketId = null;
    engine.handlePlayerLeft(room, sp);
    const leaver = (room.gameState.players || []).find(p => p.playerId === sp);
    const undercoverLeft = (room.gameState.players || []).filter(p => p.playerId !== sp && p.alive !== false && !p.left && p.role !== 'civilian').length;
    if (leaver && leaver.role !== 'civilian' && undercoverLeft === 0) {
        // คนที่ออกเป็นฝ่ายแฝงคนสุดท้าย — ถูกกติกาแล้วที่เกมจบให้พลเมืองชนะทันที (บทสุ่ม เคสนี้โผล่เป็นบางรอบ)
        assert(room.gameState.phase === 'finished' && room.gameState.winner && room.gameState.winner.team === 'civilians',
            'ฝ่ายแฝงคนสุดท้ายออก = พลเมืองชนะ');
    } else {
        assert(speaker(room) !== sp && room.gameState.phase === 'clue', 'คนพูดออก = ข้ามไปคนถัดไป');
    }
    const uc = byRole(room, 'undercover')[0];
    if (uc.alive) {
        engine.handlePlayerLeft(room, uc.playerId);
        assert(room.gameState.phase === 'finished' && room.gameState.winner.team === 'civilians', 'สายแฝงคนเดียวออก = พลเมืองชนะ จบสะอาด');
        const scoring = engine.getScoringPlayers(room).map(p => p.playerId);
        assert(scoring.includes(uc.playerId), 'คนที่ออกกลางเกมยังนับสถิติ');
    }
}
{
    // คนออฟไลน์เกิน grace ถูกข้ามตาพูด และไม่ต้องรอโหวต
    const room = started(6);
    readyAll(room);
    const order = room.gameState.speakerOrder;
    const target = room.players.find(p => p.playerId === order[1]);
    target.socketId = null;
    target.disconnectedAt = new Date(Date.now() - 60000).toISOString();
    engine.submitClueDone(room, speaker(room), S(room));
    assert(speaker(room) === order[2], 'คนออฟไลน์ต้องถูกข้ามตาพูด');
    speakAll(room);
    const voters = alive(room).filter(p => p.playerId !== target.playerId);
    voters.forEach((p, i) => engine.submitVote(room, p.playerId, voters[(i + 1) % voters.length].playerId === p.playerId ? voters[0].playerId : target.playerId, S(room)));
    assert(room.gameState.phase !== 'vote', 'ทุกคนที่ออนไลน์โหวตครบแล้วต้องสรุปผลทันที');
}
{
    // รีเฟรชหน้าสั้น ๆ ยังไม่ถูกข้าม
    const room = started(5);
    readyAll(room);
    const next = room.gameState.speakerOrder[1];
    const rp = room.players.find(p => p.playerId === next);
    rp.socketId = null;
    rp.disconnectedAt = new Date().toISOString();
    engine.submitClueDone(room, speaker(room), S(room));
    assert(speaker(room) === next, 'หลุดแป๊บเดียว (รีเฟรช) ต้องยังได้ตาพูด');
}
{
    // เหลือ 2 คนเพราะคนออก → จบ
    const room = started(4);
    readyAll(room);
    const civs = byRole(room, 'civilian');
    engine.handlePlayerLeft(room, civs[0].playerId);
    assert(room.gameState.phase !== 'finished', 'เหลือ 3 คนยังเล่นต่อ');
    engine.handlePlayerLeft(room, civs[1].playerId);
    assert(room.gameState.phase === 'finished' && room.gameState.winner.team === 'undercover', 'เหลือ 2 คน (มีสายแฝง) = ฝ่ายแฝงชนะ');
}
{
    // Mr. White ออกระหว่างทาย = ทายผิด เกมเดินต่อ
    const room = started(7, { mrWhite: true });
    const mw = byRole(room, 'mrwhite')[0];
    readyAll(room);
    speakAll(room);
    voteOut(room, mw.playerId);
    engine.handlePlayerLeft(room, mw.playerId);
    assert(room.gameState.phase === 'elimination' && room.gameState.mrWhiteGuess.correct === false, 'Mr. White ออกตอนทาย = ถือว่าทายผิด');
}
{
    // คนออกตอนโหวตซ้ำ เหลือผู้เข้าชิงคนเดียว → สรุปผลได้
    const room = started(4);
    readyAll(room);
    speakAll(room);
    const [a, b, c, d] = room.gameState.players.map(p => p.playerId);
    engine.submitVote(room, a, b, S(room));
    engine.submitVote(room, b, a, S(room));
    engine.submitVote(room, c, a, S(room));
    engine.submitVote(room, d, b, S(room));
    assert(room.gameState.isRevote, 'ต้องโหวตซ้ำ');
    engine.handlePlayerLeft(room, a);
    assert(room.gameState.phase !== 'vote', 'ผู้เข้าชิงเหลือคนเดียว ต้องไม่ค้างที่โหวต');
}
{
    // เหมือน roomManager.leaveRoom: ตัดคนออกจาก players ก่อน แล้วค่อยเรียก handlePlayerLeft
    const room = started(6);
    readyAll(room);
    const civ = byRole(room, 'civilian')[1];
    const idx = room.gameState.players.findIndex(p => p.playerId === civ.playerId);
    const [removed] = room.gameState.players.splice(idx, 1);
    room.rejoinableGamePlayers = new Map([[civ.playerId, { ...removed }]]);
    room.players = room.players.filter(p => p.playerId !== civ.playerId);
    engine.handlePlayerLeft(room, civ.playerId);
    const seat = room.gameState.players.find(p => p.playerId === civ.playerId);
    assert(seat && seat.alive === false && seat.left && seat.role === 'civilian', 'คนที่ถูกตัดออกต้องกลับมาเป็นที่นั่ง "ออกจากเกม"');
    assert(room.gameState.players.findIndex(p => p.playerId === civ.playerId) === idx, 'ที่นั่งคนออกอยู่ตำแหน่งเดิม');
    assert(!room.gameState.speakerOrder.slice(room.gameState.speakerIndex).includes(civ.playerId) || speaker(room) !== civ.playerId, 'คนออกต้องไม่ได้ตาพูด');
    // กลับเข้าห้อง: roomManager ดันสำเนาเก่า (alive) กลับมา → ต้องไม่ซ้ำและไม่ฟื้น
    room.gameState.players.push({ ...removed, alive: true });
    room.players.push({ playerId: civ.playerId, socketId: 'sockX' });
    const view = engine.buildClientState(room, civ.playerId);
    assert(room.gameState.players.filter(p => p.playerId === civ.playerId).length === 1, 'กลับเข้าห้องแล้วต้องไม่มีที่นั่งซ้ำ');
    assert(view.self.alive === false, 'ออกแล้วกลับมา ต้องยังเป็นคนที่ออก (ไม่ฟื้น)');
    engine.handlePlayerLeft(room, civ.playerId);
    assert(alive(room).length === 5, 'เรียกออกซ้ำต้องไม่กระทบ');
    console.log('✓ คนออก/หลุดกลางเกม: ข้ามตา, จบสะอาด, นับสถิติคนที่ออก, กลับเข้ามาไม่ฟื้น');
}

// ---------------------------------------------------------------- stats (once, by team)
{
    const statsManager = require('../managers/statsManager');
    const room = started(6, { mrWhite: true });
    const uc = byRole(room, 'undercover')[0];
    const mw = byRole(room, 'mrwhite')[0];
    readyAll(room);
    speakAll(room);
    voteOut(room, uc.playerId);
    if (room.gameState.phase === 'elimination') {
        engine.continueAfterResult(room, 'p0', S(room));
        speakAll(room);
        voteOut(room, mw.playerId);
        engine.submitMrWhiteGuess(room, mw.playerId, 'ผิดแน่ ๆ', S(room));
    }
    assert(room.gameState.winner?.team === 'civilians', 'ต้องจบแบบพลเมืองชนะ');
    // จำลอง finalize ของ app.js: statsRecordedAt กันบันทึกซ้ำ
    let recorded = 0;
    const finalize = () => {
        if (room.gameState.statsRecordedAt) return;
        room.gameState.statsRecordedAt = new Date().toISOString();
        recorded += 1;
        statsManager.recordGameEnd(room.roomId, {
            mode: 'undercover', winner: room.gameState.winner, players: engine.getScoringPlayers(room), pair: room.gameState.pair, roomName: room.name
        });
    };
    finalize(); finalize(); finalize();
    assert(recorded === 1, 'บันทึกสถิติครั้งเดียว');
    const civ = byRole(room, 'civilian')[0];
    const civStat = statsManager.getStats(civ.playerId);
    const ucStat = statsManager.getStats(uc.playerId);
    const mwStat = statsManager.getStats(mw.playerId);
    assert(civStat.modeStats.undercover.games === 1 && civStat.modeStats.undercover.wins === 1, 'พลเมืองได้ชนะ 1');
    assert(ucStat.modeStats.undercover.losses === 1 && mwStat.modeStats.undercover.losses === 1, 'ฝ่ายแฝงแพ้ 1');
    assert(civStat.gameHistory[0].mode === 'undercover' && civStat.gameHistory[0].role === 'พลเมือง', 'ประวัติเกมบันทึกบท');
    console.log(`✓ สถิติบันทึกครั้งเดียว แยกชนะ/แพ้ตามฝั่ง (data: ${DATA_DIR})`);
}

// ---------------------------------------------------------------- randomized property test
{
    const GAMES = Number(process.env.UNDERCOVER_FUZZ_GAMES) || 600;
    const endings = { civilians: 0, undercover: 0, mrwhite: 0 };
    const validPhases = new Set(['reveal', 'clue', 'vote', 'mrwhite', 'elimination', 'finished']);
    const rand = n => Math.floor(Math.random() * n);

    for (let g = 0; g < GAMES; g += 1) {
        const n = 4 + rand(7);
        const room = started(n, { mrWhite: Math.random() < 0.6 });
        const roster = room.gameState.players.map(p => ({ id: p.playerId, role: p.role }));
        let lastStep = room.gameState.step;
        let actions = 0;

        while (room.gameState.phase !== 'finished') {
            actions += 1;
            if (actions > 800) throw new Error(`เกมที่ ${g} ไม่จบใน 800 action`);
            const state = room.gameState;
            const pick = rand(100);
            const players = state.players;
            const actor = players[rand(players.length)];
            const stale = rand(10) === 0;
            const ctx = { step: stale ? state.step - 1 : state.step };
            try {
                if (pick < 4) {
                    engine.handlePlayerLeft(room, actor.playerId);
                } else if (pick < 16) {
                    engine.autoResolvePhase(room, (state.phaseEndsAt || Date.now()) + 1);
                } else if (state.phase === 'reveal') {
                    engine.submitReady(room, actor.playerId, ctx);
                } else if (state.phase === 'clue') {
                    const who = rand(3) === 0 ? actor.playerId : speaker(room);
                    if (rand(8) === 0) engine.skipSpeaker(room, rand(2) ? 'p0' : actor.playerId, ctx);
                    else engine.submitClueDone(room, who, { ...ctx, text: rand(2) ? 'ใบ้ ' + rand(99) : '' });
                } else if (state.phase === 'vote') {
                    const targets = state.voteCandidates;
                    const target = rand(6) === 0 ? actor.playerId : targets[rand(targets.length)];
                    engine.submitVote(room, actor.playerId, target, ctx);
                } else if (state.phase === 'mrwhite') {
                    const mwId = state.mrWhiteGuess.playerId;
                    const correct = rand(4) === 0;
                    engine.submitMrWhiteGuess(room, rand(4) ? mwId : actor.playerId, correct ? state.pair.civilian : 'มั่ว', ctx);
                } else if (state.phase === 'elimination') {
                    engine.continueAfterResult(room, rand(2) ? 'p0' : actor.playerId, ctx);
                }
            } catch (error) {
                assert(/[฀-๿]/.test(error.message), `error ต้องเป็นข้อความไทย: ${error.message}`);
            }

            const s = room.gameState;
            assert(validPhases.has(s.phase), `phase แปลก: ${s.phase}`);
            assert(s.step >= lastStep, 'step ต้องไม่ถอยหลัง');
            lastStep = s.step;
            const aliveNow = s.players.filter(p => p.alive);
            const side = aliveNow.filter(p => p.role !== 'civilian').length;
            if (s.phase !== 'finished') {
                assert(side >= 1 || s.phase === 'mrwhite', 'ฝ่ายแฝงหมดแล้วเกมต้องจบ (ยกเว้นรอ Mr. White ทาย)');
                assert(aliveNow.length >= 2, 'เหลือน้อยกว่า 2 คนเกมต้องจบ');
                assert(s.phaseEndsAt, 'ทุกเฟสต้องมีเวลาหมด (กันค้าง)');
            }
            if (s.phase === 'clue') {
                const sp = players.find(p => p.playerId === speaker(room));
                assert(sp && sp.alive, 'คนพูดต้องยังรอด');
                assert(s.speakerOrder.length && players.find(p => p.playerId === s.speakerOrder[0]).role !== 'mrwhite' || roster.every(r => r.role === 'mrwhite' || !players.find(p => p.playerId === r.id)?.alive),
                    'Mr. White ห้ามพูดคนแรก');
            }
            if (s.phase === 'vote') {
                Object.entries(s.votes).forEach(([voter, target]) => assert(voter !== target, 'ห้ามมีโหวตตัวเอง'));
            }
            if (rand(6) === 0 && s.phase !== 'finished') assertNoLeak(room, `fuzz#${g}`);
        }

        const w = room.gameState.winner;
        endings[w.team] += 1;
        assert(w.winnerIds.length > 0, 'ต้องมีผู้ชนะอย่างน้อย 1 คน');
        const winnerRoles = w.winnerIds.map(id => roster.find(r => r.id === id).role);
        if (w.team === 'civilians') assert(winnerRoles.every(r => r === 'civilian'), 'ผู้ชนะฝั่งพลเมืองต้องเป็นพลเมือง');
        if (w.team === 'undercover') assert(winnerRoles.every(r => r !== 'civilian'), 'ผู้ชนะฝั่งแฝงต้องไม่ใช่พลเมือง');
        if (w.team === 'mrwhite') assert(winnerRoles.join() === 'mrwhite', 'Mr. White ชนะคนเดียว');
        assert(engine.getScoringPlayers(room).length === roster.length, 'นับสถิติทุกคนที่ได้บท');
        const finalView = engine.buildClientState(room, roster[0].id);
        assert(finalView.pair && finalView.winner, 'จบแล้วต้องเปิดคู่คำและผู้ชนะ');
    }
    assert(endings.civilians > 0 && endings.undercover > 0 && endings.mrwhite > 0, 'สุ่มเล่นต้องเจอครบทุกแบบการจบ: ' + JSON.stringify(endings));
    console.log(`✓ สุ่มเล่น ${GAMES} เกม invariant ผ่าน — จบแบบ ${JSON.stringify(endings)}`);
}

console.log(`\n✅ undercover engine: ${passed} assertions ผ่าน`);
process.exit(0);
