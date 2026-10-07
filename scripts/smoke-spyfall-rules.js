#!/usr/bin/env node
'use strict';

/**
 * กติกา Spyfall ตามคู่มือ (engine ล้วน ไม่ต้องเปิดเซิร์ฟเวอร์)
 * - 3–8 คน · เจ้ามือถามก่อน · ห้ามถามกลับคนที่เพิ่งถามเรา
 * - หยุดเวลากล่าวหา คนละครั้ง/รอบ · ต้องเห็นด้วยทุกคนยกเว้นคนถูกกล่าวหา
 * - สายลับทายได้เฉพาะตอนเวลาเดิน · หมดเวลา = ไล่กล่าวหาเริ่มจากเจ้ามือ
 * - คะแนน: สายลับ 2 / 4 · พลเมือง 1 (+1 คนเริ่มกล่าวหา) · หลายรอบ เจ้ามือ = สายลับรอบก่อน
 *
 * รัน: node scripts/smoke-spyfall-rules.js
 */

const assert = require('assert');
const engine = require('../games/spyfallEngine');

let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

function makeRoom(count = 5, settings = {}) {
    const players = Array.from({ length: count }, (_, index) => ({
        playerId: `p${index + 1}`,
        playerName: `P${index + 1}`,
        color: '#fff',
        avatar: '👤',
        avatarFrame: 'none',
        socketId: `s${index + 1}`,
        permission: index === 0 ? 'admin' : null
    }));
    return {
        roomId: 'rules-room',
        name: 'Rules',
        players,
        settings: { gameMode: 'spyfall', maxPlayers: 8, roundTime: 480, spyfallRounds: 1, ...settings },
        gameState: null
    };
}

function toDiscussion(room) {
    engine.startGame(room);
    engine.advancePhase(room);
    assert.strictEqual(room.gameState.phase, 'discussion');
    return room;
}

const spyOf = room => room.gameState.spyPlayerId;
const citizensOf = room => room.gameState.players.filter(p => p.playerId !== spyOf(room)).map(p => p.playerId);
function expire(room) {
    room.gameState.phaseEndsAt = Date.now() - 1;
    return engine.autoResolvePhase(room);
}
function removePlayer(room, playerId) {
    room.players = room.players.filter(p => p.playerId !== playerId);
    room.gameState.players = room.gameState.players.filter(p => p.playerId !== playerId);
    engine.handlePlayerLeft(room, playerId);
}
// ทุกคน (ยกเว้นคนถูกกล่าวหา และคนกล่าวหาที่นับเห็นด้วยแล้ว) กดเห็นด้วย
function allAgree(room) {
    const acc = room.gameState.accusation;
    room.gameState.players
        .filter(p => p.playerId !== acc.suspectId && p.playerId !== acc.accuserId)
        .forEach(p => {
            if (room.gameState.accusation) engine.voteAccusation(room, p.playerId, true);
        });
}

console.log('smoke-spyfall-rules');

test('settings: rounds 1/3/5 (default 5), vote mode unanimous by default', () => {
    assert.strictEqual(engine.sanitizeRounds(undefined), 5);
    assert.strictEqual(engine.sanitizeRounds('3'), 3);
    assert.strictEqual(engine.sanitizeRounds(7), 5);
    assert.strictEqual(engine.sanitizeVoteMode(undefined), 'unanimous');
    assert.strictEqual(engine.sanitizeVoteMode('majority'), 'majority');
    assert.strictEqual(engine.sanitizeVoteMode('x'), 'unanimous');
    assert.strictEqual(engine.getDiscussionMs({ settings: {} }), 8 * 60 * 1000, 'rulebook round = 8 minutes');
});

test('3 players can start (rulebook 3–8), 2 cannot', () => {
    assert.strictEqual(engine.minPlayers, 3);
    const three = makeRoom(3);
    engine.startGame(three);
    assert.strictEqual(three.gameState.phase, 'reveal');
    assert.throws(() => engine.startGame(makeRoom(2)), /อย่างน้อย 3/);
});

test('dealer asks the first question', () => {
    for (let i = 0; i < 10; i += 1) {
        const room = toDiscussion(makeRoom(5));
        assert.ok(room.gameState.match.dealerId);
        assert.strictEqual(room.gameState.askerId, room.gameState.match.dealerId);
        assert.strictEqual(engine.buildClientState(room, room.gameState.match.dealerId).self.isDealer, true);
    }
});

test('the answerer cannot ask back the one who just asked (server-side)', () => {
    const room = toDiscussion(makeRoom(4));
    const first = room.gameState.askerId;
    const target = room.gameState.players.find(p => p.playerId !== first).playerId;
    engine.passQuestion(room, first, target);
    assert.throws(() => engine.passQuestion(room, target, first), /ถามกลับ/);
    const other = room.gameState.players.find(p => ![first, target].includes(p.playerId)).playerId;
    engine.passQuestion(room, target, other);
    assert.strictEqual(room.gameState.askerId, other);
});

test('stop the clock: pauses time, suspect cannot vote, one "no" fails and clock resumes', () => {
    const room = toDiscussion(makeRoom(5));
    const [a, b, c] = citizensOf(room);
    room.gameState.phaseEndsAt = Date.now() + 200000;
    engine.stopClockAccuse(room, a, b);
    assert.strictEqual(room.gameState.phase, 'accuse');
    const paused = room.gameState.pausedRemainingMs;
    assert.ok(paused > 190000 && paused <= 200000, 'remaining time remembered');
    const view = engine.buildClientState(room, b);
    assert.strictEqual(view.accusation.isSuspect, true);
    assert.strictEqual(view.accusation.canVote, false);
    assert.throws(() => engine.voteAccusation(room, b, true), /ถูกกล่าวหาไม่ได้โหวต/);
    assert.throws(() => engine.voteAccusation(room, a, true), /โหวตไปแล้ว/, 'accuser already counts as yes');
    assert.throws(() => engine.guessLocation(room, spyOf(room), room.gameState.locationId), /หยุดเวลา/, 'spy cannot reveal while the clock is stopped');
    assert.strictEqual(engine.buildClientState(room, spyOf(room)).canGuessLocation, false);
    engine.voteAccusation(room, c, false);
    assert.strictEqual(room.gameState.phase, 'discussion', 'not unanimous → play on');
    assert.ok(Math.abs((room.gameState.phaseEndsAt - Date.now()) - paused) < 1500, 'clock resumes with the time that was left');
    assert.ok(room.gameState.history.some(h => /ไม่ผ่าน/.test(h.text)));
});

test('each player may stop the clock only once per round', () => {
    const room = toDiscussion(makeRoom(5));
    const [a, b, c] = citizensOf(room);
    engine.stopClockAccuse(room, a, b);
    engine.voteAccusation(room, c, false);
    assert.strictEqual(engine.buildClientState(room, a).canAccuse, false);
    assert.throws(() => engine.stopClockAccuse(room, a, c), /ครั้งต่อรอบ/);
    engine.stopClockAccuse(room, b, c);
    assert.strictEqual(room.gameState.phase, 'accuse', 'someone else still can');
});

test('unanimous on the spy: non-spies 1 each, accuser +1, spy 0', () => {
    const room = toDiscussion(makeRoom(5));
    const spy = spyOf(room);
    const [accuser, ...rest] = citizensOf(room);
    engine.stopClockAccuse(room, accuser, spy);
    rest.slice(0, -1).forEach(id => engine.voteAccusation(room, id, true));
    assert.strictEqual(room.gameState.phase, 'accuse', 'one voter still missing');
    engine.voteAccusation(room, rest[rest.length - 1], true);
    assert.strictEqual(room.gameState.phase, 'finished', 'all but the suspect agreed');
    const w = room.gameState.winner;
    assert.strictEqual(w.team, 'citizens');
    assert.strictEqual(w.reason, 'convicted_spy');
    assert.strictEqual(w.points[accuser], 2, 'accuser who started the vote +1');
    rest.forEach(id => assert.strictEqual(w.points[id], 1));
    assert.strictEqual(w.points[spy], undefined);
});

test('unanimous needs every non-suspect — including the spy when an innocent is accused', () => {
    const room = toDiscussion(makeRoom(5));
    const spy = spyOf(room);
    const [accuser, suspect, x, y] = citizensOf(room);
    engine.stopClockAccuse(room, accuser, suspect);
    engine.voteAccusation(room, x, true);
    engine.voteAccusation(room, y, true);
    assert.strictEqual(room.gameState.phase, 'accuse', 'still waiting for the spy vote');
    engine.voteAccusation(room, spy, true);
    assert.strictEqual(room.gameState.phase, 'finished');
    const w = room.gameState.winner;
    assert.strictEqual(w.team, 'spy');
    assert.strictEqual(w.reason, 'convicted_innocent');
    assert.deepStrictEqual(w.points, { [spy]: 4 }, 'innocent convicted → spy 4');
});

test('spy guesses right while the clock runs → spy 4', () => {
    const room = toDiscussion(makeRoom(4));
    const spy = spyOf(room);
    engine.guessLocation(room, spy, room.gameState.locationId);
    assert.strictEqual(room.gameState.winner.reason, 'spy_guess_right');
    assert.deepStrictEqual(room.gameState.winner.points, { [spy]: 4 });
});

test('spy guesses wrong → non-spies 1 each, no accuser bonus', () => {
    const room = toDiscussion(makeRoom(4));
    const spy = spyOf(room);
    const wrong = engine.getAllLocations().find(l => l.id !== room.gameState.locationId);
    engine.guessLocation(room, spy, wrong.id);
    const w = room.gameState.winner;
    assert.strictEqual(w.team, 'citizens');
    citizensOf(room).forEach(id => assert.strictEqual(w.points[id], 1));
    assert.strictEqual(w.points[spy], undefined);
});

test('time out → final accusations start with the dealer; spy cannot reveal any more', () => {
    const room = toDiscussion(makeRoom(5));
    const dealer = room.gameState.match.dealerId;
    expire(room);
    assert.strictEqual(room.gameState.phase, 'final');
    assert.strictEqual(room.gameState.finalRound.order[0], dealer, 'dealer accuses first');
    assert.strictEqual(engine.buildClientState(room, dealer).finalTurn.isMyTurn, true);
    assert.throws(() => engine.guessLocation(room, spyOf(room), room.gameState.locationId), /เวลายังเดิน/);
    const notTurn = room.gameState.finalRound.order[1];
    assert.throws(() => engine.finalAccuse(room, notTurn, dealer), /ตาของ/);
});

test('final round: failed votes pass the turn on; nobody convicted → spy 2', () => {
    const room = toDiscussion(makeRoom(4));
    const spy = spyOf(room);
    expire(room);
    const order = room.gameState.finalRound.order;
    order.forEach((accuserId, index) => {
        assert.strictEqual(room.gameState.finalRound.index, index);
        const suspect = order.find(id => id !== accuserId);
        engine.finalAccuse(room, accuserId, suspect);
        const voter = room.gameState.players.find(p => p.playerId !== suspect && p.playerId !== accuserId).playerId;
        engine.voteAccusation(room, voter, false);
    });
    assert.strictEqual(room.gameState.phase, 'finished');
    assert.strictEqual(room.gameState.winner.reason, 'no_conviction');
    assert.deepStrictEqual(room.gameState.winner.points, { [spy]: 2 });
});

test('final round: unanimous on the spy wins for the town, accuser gets the bonus', () => {
    const room = toDiscussion(makeRoom(4));
    const spy = spyOf(room);
    expire(room);
    // ข้ามจนถึงตาพลเมือง (หมดเวลาเลือก = ข้าม)
    while (room.gameState.finalRound.order[room.gameState.finalRound.index] === spy) expire(room);
    const accuser = room.gameState.finalRound.order[room.gameState.finalRound.index];
    engine.finalAccuse(room, accuser, spy);
    allAgree(room);
    const w = room.gameState.winner;
    assert.strictEqual(w.reason, 'convicted_spy');
    assert.strictEqual(w.points[accuser], 2);
    citizensOf(room).filter(id => id !== accuser).forEach(id => assert.strictEqual(w.points[id], 1));
});

test('pick timeout skips the player; vote timeout = not agreeing', () => {
    const room = toDiscussion(makeRoom(4));
    expire(room);
    const first = room.gameState.finalRound.order[0];
    expire(room);
    assert.strictEqual(room.gameState.finalRound.index, 1, 'no pick in time → next accuser');
    assert.ok(room.gameState.history.some(h => h.text.includes('ไม่ได้เลือกใคร')));
    const second = room.gameState.finalRound.order[1];
    engine.finalAccuse(room, second, first);
    expire(room);
    assert.strictEqual(room.gameState.accusation, null);
    assert.strictEqual(room.gameState.finalRound.index, 2, 'vote timed out → failed, turn moves on');
});

test('an offline voter does not block a unanimous vote', () => {
    const room = toDiscussion(makeRoom(5));
    const spy = spyOf(room);
    const [a, b, c, d] = citizensOf(room);
    room.players.find(p => p.playerId === d).socketId = null;
    engine.stopClockAccuse(room, a, spy);
    engine.voteAccusation(room, b, true);
    engine.voteAccusation(room, c, true);
    assert.strictEqual(room.gameState.winner.reason, 'convicted_spy');
});

test('leaving: voter leaves → vote resolves; suspect leaves → accusation cancelled and refunded', () => {
    const room = toDiscussion(makeRoom(5));
    const spy = spyOf(room);
    const [a, b, c, d] = citizensOf(room);
    engine.stopClockAccuse(room, a, b);
    removePlayer(room, b);
    assert.strictEqual(room.gameState.phase, 'discussion', 'suspect left → clock resumes');
    assert.strictEqual(engine.buildClientState(room, a).canAccuse, true, 'accuser gets the accusation back');
    engine.stopClockAccuse(room, a, spy);
    engine.voteAccusation(room, c, true);
    removePlayer(room, d);
    assert.strictEqual(room.gameState.winner && room.gameState.winner.reason, 'convicted_spy', 'last missing voter left → unanimous');
});

test('leaving: final-round accuser leaves on their turn → next player; spy leaves → town wins 1 each', () => {
    const room = toDiscussion(makeRoom(5));
    const spy = spyOf(room);
    expire(room);
    let turn = room.gameState.finalRound.order[0];
    if (turn === spy) { expire(room); turn = room.gameState.finalRound.order[1]; }
    const before = room.gameState.finalRound.index;
    removePlayer(room, turn);
    assert.ok(room.gameState.finalRound.index > before, 'turn passed on');
    removePlayer(room, spy);
    assert.strictEqual(room.gameState.winner.reason, 'spy_left');
    citizensOf(room).forEach(id => assert.strictEqual(room.gameState.winner.points[id], 1));
});

test('multi-round: scores add up, last spy deals next round, match ends after N rounds', () => {
    const room = toDiscussion(makeRoom(4, { spyfallRounds: 3 }));
    const spy1 = spyOf(room);
    engine.guessLocation(room, spy1, room.gameState.locationId);
    assert.strictEqual(room.gameState.winner.matchOver, false);
    assert.strictEqual(engine.isMatchOver(room), false);
    engine.startNextRound(room);
    assert.strictEqual(room.gameState.match.round, 2);
    assert.strictEqual(room.gameState.match.dealerId, spy1, 'spy of the last round deals');
    assert.strictEqual(room.gameState.match.scores[spy1], 4, 'scores carry over');
    assert.strictEqual(room.gameState.statsRecordedAt, null, 'each round is recorded once');
    engine.advancePhase(room);
    assert.strictEqual(room.gameState.askerId, spy1, 'the new dealer asks first');
    const spy2 = spyOf(room);
    const wrong = engine.getAllLocations().find(l => l.id !== room.gameState.locationId);
    engine.guessLocation(room, spy2, wrong.id);
    engine.startNextRound(room);
    engine.advancePhase(room);
    expire(room);
    while (room.gameState.phase === 'final') expire(room);
    assert.strictEqual(room.gameState.winner.reason, 'no_conviction');
    assert.strictEqual(room.gameState.winner.matchOver, true);
    assert.ok(room.gameState.match.winnerIds.length >= 1);
    assert.throws(() => engine.startNextRound(room), /ครบทุกรอบ/);
    const view = engine.buildClientState(room, 'p1');
    assert.strictEqual(view.match.rounds.length, 3);
    const total = view.match.scoreboard.reduce((sum, row) => sum + row.score, 0);
    const fromRounds = view.match.rounds.reduce((sum, r) => sum + Object.values(r.points).reduce((x, y) => x + y, 0), 0);
    assert.strictEqual(total, fromRounds, 'scoreboard = sum of round points');
});

test('majority mode (room setting): plurality vote, innocent voted → spy 4, tie → spy 2', () => {
    const room = toDiscussion(makeRoom(4, { spyfallVoteMode: 'majority' }));
    assert.strictEqual(engine.buildClientState(room, 'p1').canAccuse, false);
    assert.throws(() => engine.stopClockAccuse(room, 'p1', 'p2'), /เสียงข้างมาก/);
    engine.endDiscussionEarly(room);
    assert.strictEqual(room.gameState.phase, 'vote');
    const spy = spyOf(room);
    const [a, b, c] = citizensOf(room);
    engine.submitVote(room, spy, a);
    engine.submitVote(room, b, a);
    engine.submitVote(room, c, a);
    engine.submitVote(room, a, b);
    assert.strictEqual(room.gameState.winner.reason, 'majority_innocent');
    assert.deepStrictEqual(room.gameState.winner.points, { [spy]: 4 });

    const tie = toDiscussion(makeRoom(4, { spyfallVoteMode: 'majority' }));
    engine.endDiscussionEarly(tie);
    const tSpy = spyOf(tie);
    const [ta, tb, tc] = citizensOf(tie);
    engine.submitVote(tie, tSpy, ta);
    engine.submitVote(tie, ta, tb);
    engine.submitVote(tie, tb, ta);
    engine.submitVote(tie, tc, tb);
    assert.strictEqual(tie.gameState.winner.reason, 'majority_none');
    assert.deepStrictEqual(tie.gameState.winner.points, { [tSpy]: 2 });
});

test('ready-to-vote majority / host skip go to the dealer-first accusations (unanimous mode)', () => {
    const room = toDiscussion(makeRoom(4));
    engine.toggleReadyToVote(room, 'p1');
    engine.toggleReadyToVote(room, 'p2');
    engine.toggleReadyToVote(room, 'p3');
    assert.strictEqual(room.gameState.phase, 'final');
    const host = toDiscussion(makeRoom(4));
    engine.endDiscussionEarly(host);
    assert.strictEqual(host.gameState.phase, 'final');
});

console.log(`smoke-spyfall-rules: OK (${passed} tests)`);
