/**
 * Insider — กติกาจริง (Oink Games) ระดับ engine ไม่ต้องเปิด server
 * ดู rules/insider/rules.md
 *
 * รัน: node scripts/smoke-insider-rules.js
 */
const engine = require('../games/insiderEngine');

const M = engine.MASTER_ROLE;
const I = engine.INSIDER_ROLE;
const C = engine.DEFAULT_ROLE;

let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('  ✓ ' + name);
    } catch (error) {
        console.error('  ✗ ' + name + '\n    ' + error.message);
        process.exitCode = 1;
    }
}
function eq(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label || 'value'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// โต๊ะ 6 คน: m=ผู้ดำเนินเกม, i=จอมบงการ, a..d=พลเมือง
function table(overrides = {}) {
    const roles = overrides.roles || { m: M, i: I, a: C, b: C, c: C, d: C };
    const players = Object.keys(roles).map(id => ({
        playerId: id, name: id.toUpperCase(), role: roles[id], socketId: 's-' + id,
        vote1: null, vote2: null, nbVote2: 0, isGhost: false
    }));
    const gs = { players, word: 'ช้าง', guesserId: overrides.guesserId || 'a', guesserName: (overrides.guesserId || 'a').toUpperCase() };
    gs.rosterSnapshot = players.map(p => ({ playerId: p.playerId, name: p.name, role: p.role, isGhost: false }));
    return gs;
}
function setVotes(gs, field, votes) {
    Object.entries(votes).forEach(([id, v]) => { gs.players.find(p => p.playerId === id)[field] = v; });
}

console.log('R1 players');
check('4–10 players (3 is broken: the lone Common knows the Insider)', () => {
    eq(engine.minPlayers, 4, 'minPlayers');
    eq(engine.maxPlayers, 10, 'maxPlayers');
});

console.log('R4 Q&A time / settings');
check('round time defaults to 5 min, clamps garbage and huge values', () => {
    eq(engine.sanitizeRoundMinutes(undefined), 5);
    eq(engine.sanitizeRoundMinutes('abc'), 5);
    eq(engine.sanitizeRoundMinutes(-3), 5);
    eq(engine.sanitizeRoundMinutes(999), 10);
    eq(engine.sanitizeRoundMinutes(3), 3);
});
check('guesser vote setting defaults on (rulebook), off only when false', () => {
    eq(engine.sanitizeGuesserVote(undefined), true);
    eq(engine.sanitizeGuesserVote(true), true);
    eq(engine.sanitizeGuesserVote(false), false);
    eq(engine.sanitizeGuesserVote('false'), false);
});

console.log('R6 discussion = time used to find the word (hourglass flipped)');
check('guessed after 3:20 of 5:00 → 200 s discussion', () => eq(engine.discussionSeconds(300, 100), 200));
check('guessed with 4:30 left → 30 s (floor for chat typing)', () => eq(engine.discussionSeconds(300, 270), 30));
check('guessed with 0:01 left → 299 s', () => eq(engine.discussionSeconds(300, 1), 299));
check('remaining bigger than total is clamped', () => eq(engine.discussionSeconds(300, 999), 30));
check('Master cannot be the guesser; Commons and Insider can', () => {
    const gs = table();
    eq(engine.canBeGuesser(gs.players.find(p => p.playerId === 'm')), false, 'master');
    eq(engine.canBeGuesser(gs.players.find(p => p.playerId === 'i')), true, 'insider');
    eq(engine.canBeGuesser(gs.players.find(p => p.playerId === 'a')), true, 'common');
});

console.log('R7 vote #1 — is the Guesser the Insider?');
check('everyone except the Guesser votes, Master included', () => {
    const gs = table({ guesserId: 'a' });
    eq(engine.vote1Voters(gs).map(p => p.playerId).sort(), ['b', 'c', 'd', 'i', 'm']);
});
check('Guesser is refused with a reason', () => {
    const gs = table({ guesserId: 'a' });
    if (!engine.voteDenyReason(gs, gs.players.find(p => p.playerId === 'a'), 'vote1')) throw new Error('guesser allowed');
    eq(engine.voteDenyReason(gs, gs.players.find(p => p.playerId === 'm'), 'vote1'), null, 'master allowed');
});
check('3 of 5 yes = majority', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote1', { m: 'yes', i: 'no', b: 'yes', c: 'yes', d: 'no' });
    eq(engine.resolveVote1(gs), { yes: 3, no: 2, total: 5, majority: true });
});
check('tie is not a majority (2 yes of 4)', () => {
    const gs = table({ roles: { m: M, i: I, a: C, b: C, c: C }, guesserId: 'a' });
    setVotes(gs, 'vote1', { m: 'yes', i: 'no', b: 'yes', c: 'no' });
    eq(engine.resolveVote1(gs).majority, false);
});
check('no answer counts as not raising a hand (2 yes of 5, 3 silent)', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote1', { m: 'yes', b: 'yes' });
    eq(engine.resolveVote1(gs), { yes: 2, no: 3, total: 5, majority: false });
});
check('majority yes and Guesser IS the Insider → Master + Commons win', () => {
    const gs = table({ guesserId: 'i' });
    setVotes(gs, 'vote1', { m: 'yes', a: 'yes', b: 'yes', c: 'no', d: 'no' });
    gs.resultVote1 = engine.resolveVote1(gs);
    const r = engine.buildVote1Result(gs);
    eq([r.hasWon, r.decidedBy, r.pickedName, r.finalTraitorName], [true, 'vote1', 'I', 'I']);
});
check('majority yes but Guesser is NOT the Insider → Insider wins', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote1', { m: 'yes', i: 'yes', b: 'yes', c: 'no', d: 'no' });
    gs.resultVote1 = engine.resolveVote1(gs);
    const r = engine.buildVote1Result(gs);
    eq([r.hasWon, r.decidedBy, r.pickedName], [false, 'vote1', 'A']);
});

console.log('R8 vote #2 — point at the Insider');
check('everyone votes (Master and Guesser too); candidates exclude the Master', () => {
    const gs = table();
    eq(engine.vote2Voters(gs).length, 6, 'voters');
    eq(engine.vote2Candidates(gs).map(p => p.playerId).includes('m'), false, 'master is not a suspect');
    eq(engine.voteDenyReason(gs, gs.players.find(p => p.playerId === 'm'), 'vote2'), null, 'master may vote');
});
check('most votes on the Insider → Master + Commons win', () => {
    const gs = table();
    setVotes(gs, 'vote2', { m: 'i', a: 'i', b: 'i', c: 'b', d: 'c', i: 'b' });
    const out = engine.processVote2Result(gs, { allowTiebreak: true });
    eq(out.needsTiebreak, false);
    eq([gs.resultVote2.hasWon, gs.resultVote2.pickedName, gs.resultVote2.decidedBy], [true, 'I', 'vote2']);
});
check('most votes on a Common → Insider wins', () => {
    const gs = table();
    setVotes(gs, 'vote2', { m: 'b', a: 'b', b: 'i', c: 'b', d: 'c', i: 'b' });
    engine.processVote2Result(gs, { allowTiebreak: true });
    eq([gs.resultVote2.hasWon, gs.resultVote2.pickedName], [false, 'B']);
});
check('the Master\'s vote counts', () => {
    const gs = table();
    // 2–2 without the Master; Master breaks it toward the Insider
    setVotes(gs, 'vote2', { a: 'i', b: 'i', c: 'b', d: 'b', m: 'i', i: 'c' });
    engine.processVote2Result(gs, { allowTiebreak: true });
    eq([gs.resultVote2.hasWon, gs.resultVote2.tie], [true, false]);
});
check('tie: the Guesser\'s own vote decides when it is one of the tied', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote2', { a: 'i', b: 'i', c: 'b', d: 'b', m: 'c', i: 'c' }); // I 2, B 2, C 2
    const out = engine.processVote2Result(gs, { allowTiebreak: true });
    eq(out.needsTiebreak, false);
    eq([gs.resultVote2.tie, gs.resultVote2.decidedBy, gs.resultVote2.pickedName, gs.resultVote2.hasWon], [true, 'guesser-vote', 'I', true]);
});
check('tie: Guesser voted outside the tie → ask the Guesser', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote2', { a: 'd', b: 'i', c: 'i', d: 'b', m: 'b', i: 'c' }); // I 2, B 2
    const out = engine.processVote2Result(gs, { allowTiebreak: true });
    eq(out.needsTiebreak, true);
    eq(out.tied.slice().sort(), ['b', 'i']);
    // Guesser picks the Insider
    gs.tiebreakAsked = true;
    gs.tiebreakPick = 'i';
    engine.processVote2Result(gs, { allowTiebreak: false });
    eq([gs.resultVote2.decidedBy, gs.resultVote2.pickedName, gs.resultVote2.hasWon], ['tiebreak', 'I', true]);
});
check('tie re-count does not double the votes', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote2', { a: 'd', b: 'i', c: 'i', d: 'b', m: 'b', i: 'c' });
    engine.processVote2Result(gs, { allowTiebreak: true });
    gs.tiebreakAsked = true;
    engine.processVote2Result(gs, { allowTiebreak: false });
    const top = gs.resultVote2.voteDetail[0];
    eq(top.nbVote2, 2, 'count after second tally');
});
check('tie and the Guesser does not pick → nobody caught → Insider wins', () => {
    const gs = table({ guesserId: 'a' });
    setVotes(gs, 'vote2', { a: 'd', b: 'i', c: 'i', d: 'b', m: 'b', i: 'c' });
    gs.tiebreakAsked = true;
    engine.processVote2Result(gs, { allowTiebreak: false });
    eq([gs.resultVote2.decidedBy, gs.resultVote2.pickedName, gs.resultVote2.hasWon], ['tie-unresolved', null, false]);
});
check('tie and the Guesser is offline → no tiebreak prompt, Insider wins', () => {
    const gs = table({ guesserId: 'a' });
    gs.players.find(p => p.playerId === 'a').socketId = null;
    setVotes(gs, 'vote2', { b: 'i', c: 'i', d: 'b', m: 'b', i: 'c' });
    const out = engine.processVote2Result(gs, { allowTiebreak: true });
    eq(out.needsTiebreak, false);
    eq(gs.resultVote2.hasWon, false);
});
check('a Guesser who is the Insider breaks a tie in their own favour', () => {
    const gs = table({ guesserId: 'i' });
    setVotes(gs, 'vote2', { a: 'i', b: 'i', c: 'b', d: 'b', m: 'c', i: 'd' }); // I 2, B 2
    const out = engine.processVote2Result(gs, { allowTiebreak: true });
    eq(out.needsTiebreak, true);
    gs.tiebreakAsked = true;
    gs.tiebreakPick = 'b';
    engine.processVote2Result(gs, { allowTiebreak: false });
    eq(gs.resultVote2.hasWon, false);
});
check('nobody voted → Insider wins', () => {
    const gs = table();
    engine.processVote2Result(gs, { allowTiebreak: true });
    eq([gs.resultVote2.hasWon, gs.resultVote2.pickedName], [false, null]);
});
check('Insider left mid-game → Master + Commons win', () => {
    const gs = table();
    gs.players = gs.players.filter(p => p.playerId !== 'i');
    setVotes(gs, 'vote2', { a: 'b', b: 'c' });
    engine.processVote2Result(gs, { allowTiebreak: true });
    eq(gs.resultVote2.hasWon, true);
    if (!/ออกจากเกม/.test(gs.resultVote2.finalTraitorName)) throw new Error('should say the Insider left');
});
check('result payload has no internal player fields', () => {
    const gs = table();
    setVotes(gs, 'vote2', { a: 'i' });
    engine.processVote2Result(gs, {});
    const json = JSON.stringify(gs.resultVote2);
    if (/socketId|permission|"vote[12]":|_voting/.test(json)) throw new Error('leaks: ' + json.slice(0, 200));
    gs.resultVote2.voteDetail.forEach(v => eq(Object.keys(v).sort(), ['isGhost', 'name', 'nbVote2', 'role']));
});

console.log('House variant — 2 Insiders');
check('must catch both, each with a clear lead', () => {
    const gs = table({ roles: { m: M, i: I, j: I, a: C, b: C, c: C } });
    setVotes(gs, 'vote2', { m: ['i', 'j'], a: ['i', 'j'], b: ['i', 'j'], c: ['a', 'b'], i: ['a', 'c'], j: ['b', 'c'] });
    engine.processVote2Result(gs, { allowTiebreak: true });
    eq(gs.resultVote2.hasWon, true);
});
check('catching one of two = Insiders win', () => {
    const gs = table({ roles: { m: M, i: I, j: I, a: C, b: C, c: C } });
    setVotes(gs, 'vote2', { m: ['i', 'a'], a: ['i', 'b'], b: ['i', 'a'], c: ['a', 'b'], i: ['a', 'b'], j: ['a', 'c'] });
    engine.processVote2Result(gs, { allowTiebreak: true });
    eq(gs.resultVote2.hasWon, false);
});

console.log('Ghost round (optional variant, no Insider)');
check('ghost cannot vote and is not a suspect', () => {
    const gs = table({ roles: { m: M, a: C, b: C, c: C, d: C } });
    gs.players.find(p => p.playerId === 'd').isGhost = true;
    eq(engine.vote2Candidates(gs).some(p => p.playerId === 'd'), false);
    if (!engine.voteDenyReason(gs, gs.players.find(p => p.playerId === 'd'), 'vote2')) throw new Error('ghost allowed');
});
check('vote #1 yes on a Guesser in a no-Insider round = voted wrong', () => {
    const gs = table({ roles: { m: M, a: C, b: C, c: C, d: C }, guesserId: 'a' });
    setVotes(gs, 'vote1', { m: 'yes', b: 'yes', c: 'yes', d: 'yes' });
    gs.resultVote1 = engine.resolveVote1(gs);
    eq(engine.buildVote1Result(gs).hasWon, false);
});

console.log(process.exitCode ? '\n❌ INSIDER RULES FAILED' : `\n✅ INSIDER RULES PASSED (${passed} checks)`);
