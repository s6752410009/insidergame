#!/usr/bin/env node
'use strict';

const assert = require('assert');
const spyfallEngine = require('../games/spyfallEngine');

// โหมดเสียงข้างมาก (ค่าตั้งห้อง) — ไฟล์นี้ทดสอบโหวตลับแบบเดิม · กติกาเอกฉันท์อยู่ใน smoke-spyfall-rules.js
function createMockRoom(playerCount = 4, settings = { spyfallVoteMode: 'majority' }) {
    const players = Array.from({ length: playerCount }, (_, index) => ({
        playerId: `p${index + 1}`,
        playerName: `Player ${index + 1}`,
        color: '#fff',
        avatar: '👤',
        avatarFrame: 'none',
        socketId: `socket-${index + 1}`,
        permission: index === 0 ? 'admin' : null
    }));

    return {
        roomId: 'test-room',
        name: 'Smoke Spyfall',
        players,
        settings: {
            gameMode: 'spyfall',
            maxPlayers: 8,
            roundTime: 60, // seconds in mock (lobby stores minutes * 60)
            spyfallRounds: 1,
            ...settings
        },
        gameState: null
    };
}

function run() {
    const room = createMockRoom(5);
    spyfallEngine.startGame(room);

    assert.strictEqual(room.gameState.mode, 'spyfall');
    assert.strictEqual(room.gameState.phase, 'reveal');
    assert.ok(room.gameState.spyPlayerId);
    assert.ok(room.gameState.locationName);

    const spyId = room.gameState.spyPlayerId;
    const citizen = room.gameState.players.find(player => player.playerId !== spyId);
    assert.ok(citizen);

    const spyView = spyfallEngine.buildClientState(room, spyId);
    const citizenView = spyfallEngine.buildClientState(room, citizen.playerId);

    assert.strictEqual(spyView.self.isSpy, true);
    assert.strictEqual(citizenView.self.isSpy, false);
    assert.strictEqual(spyView.location, null);
    assert.ok(citizenView.location && citizenView.location.name);
    assert.ok(citizenView.self.locationRoleTitle, 'citizen should have a location role');
    assert.strictEqual(spyView.self.locationRoleTitle, null);

    const allJobs = new Set(
        room.gameState.players
            .filter(p => p.playerId !== spyId)
            .map(p => p.locationRoleTitle)
    );
    assert.strictEqual(allJobs.size, room.gameState.players.length - 1, 'each citizen should get a distinct location role');

    spyfallEngine.advancePhase(room);
    assert.strictEqual(room.gameState.phase, 'discussion');

    spyfallEngine.endDiscussionEarly(room);
    assert.strictEqual(room.gameState.phase, 'vote');

    const citizenId = citizen.playerId;
    room.gameState.players.forEach(player => {
        const targetId = player.playerId === spyId ? citizenId : spyId;
        const result = spyfallEngine.submitVote(room, player.playerId, targetId);
        if (result.resolved) {
            return;
        }
    });

    assert.strictEqual(room.gameState.phase, 'finished');
    assert.strictEqual(room.gameState.winner.team, 'citizens');

    const tieRoom = createMockRoom(4);
    spyfallEngine.startGame(tieRoom);
    spyfallEngine.advancePhase(tieRoom);
    spyfallEngine.endDiscussionEarly(tieRoom);
    const tieSpyId = tieRoom.gameState.spyPlayerId;
    const tieCitizens = tieRoom.gameState.players.filter(p => p.playerId !== tieSpyId);
    const tieTargetA = tieCitizens[0].playerId;
    const tieTargetB = tieCitizens[1].playerId;
    const tieSpy = tieRoom.gameState.players.find(p => p.playerId === tieSpyId);
    spyfallEngine.submitVote(tieRoom, tieSpy.playerId, tieTargetA);
    spyfallEngine.submitVote(tieRoom, tieCitizens[0].playerId, tieTargetB);
    spyfallEngine.submitVote(tieRoom, tieCitizens[1].playerId, tieTargetA);
    spyfallEngine.submitVote(tieRoom, tieCitizens[2].playerId, tieTargetB);
    assert.strictEqual(tieRoom.gameState.phase, 'finished');
    assert.strictEqual(tieRoom.gameState.winner.team, 'spy');
    assert.strictEqual(tieRoom.gameState.winner.wasTie, true);

    // สายลับต้องเป็นคนออนไลน์เท่านั้น (คนหลุดช่วง grace ห้ามได้บทสายลับ)
    for (let i = 0; i < 40; i += 1) {
        const offlineRoom = createMockRoom(5);
        offlineRoom.players[1].socketId = null;
        offlineRoom.players[3].socketId = null;
        spyfallEngine.startGame(offlineRoom);
        assert.ok(!['p2', 'p4'].includes(offlineRoom.gameState.spyPlayerId), 'offline player must never be the spy');
    }

    // สายลับทายสถานที่ถูก → สายลับชนะทันที
    const guessRoom = createMockRoom(4);
    spyfallEngine.startGame(guessRoom);
    const guessSpy = guessRoom.gameState.spyPlayerId;
    const guessCitizen = guessRoom.gameState.players.find(p => p.playerId !== guessSpy).playerId;
    assert.throws(() => spyfallEngine.guessLocation(guessRoom, guessSpy, guessRoom.gameState.locationId), /ช่วงคุย/, 'no guessing during reveal');
    spyfallEngine.advancePhase(guessRoom);
    assert.strictEqual(spyfallEngine.buildClientState(guessRoom, guessSpy).canGuessLocation, true);
    assert.strictEqual(spyfallEngine.buildClientState(guessRoom, guessCitizen).canGuessLocation, false);
    assert.throws(() => spyfallEngine.guessLocation(guessRoom, guessCitizen, guessRoom.gameState.locationId), /สายลับ/, 'citizen cannot guess');
    assert.throws(() => spyfallEngine.guessLocation(guessRoom, guessSpy, 'not-a-place'), /ไม่ถูกต้อง/);
    const correct = spyfallEngine.guessLocation(guessRoom, guessSpy, guessRoom.gameState.locationId);
    assert.strictEqual(correct.correct, true);
    assert.strictEqual(guessRoom.gameState.phase, 'finished');
    assert.strictEqual(guessRoom.gameState.winner.team, 'spy');
    assert.strictEqual(guessRoom.gameState.winner.spyGuess.correct, true);
    assert.throws(() => spyfallEngine.guessLocation(guessRoom, guessSpy, guessRoom.gameState.locationId), /ช่วงคุย|แล้ว/, 'guess only once');

    // ทายผิด (ช่วงคุย) → สายลับแพ้ทันที · ช่วงโหวตทายไม่ได้ (นาฬิกาหยุดแล้ว)
    const wrongRoom = createMockRoom(4);
    spyfallEngine.startGame(wrongRoom);
    spyfallEngine.advancePhase(wrongRoom);
    const voteGuessRoom = createMockRoom(4);
    spyfallEngine.startGame(voteGuessRoom);
    spyfallEngine.advancePhase(voteGuessRoom);
    spyfallEngine.endDiscussionEarly(voteGuessRoom);
    assert.throws(() => spyfallEngine.guessLocation(voteGuessRoom, voteGuessRoom.gameState.spyPlayerId, voteGuessRoom.gameState.locationId), /ช่วงคุย/, 'no guessing during the vote');
    assert.strictEqual(spyfallEngine.buildClientState(voteGuessRoom, voteGuessRoom.gameState.spyPlayerId).canGuessLocation, false);
    const wrongSpy = wrongRoom.gameState.spyPlayerId;
    const wrongLocation = spyfallEngine.getAllLocations().find(loc => loc.id !== wrongRoom.gameState.locationId);
    const wrong = spyfallEngine.guessLocation(wrongRoom, wrongSpy, wrongLocation.id);
    assert.strictEqual(wrong.correct, false);
    assert.strictEqual(wrongRoom.gameState.winner.team, 'citizens');

    // สายลับออกกลางเกม → ยังถูกนับใน scoring roster (แพ้)
    const leaveRoom = createMockRoom(4);
    spyfallEngine.startGame(leaveRoom);
    spyfallEngine.advancePhase(leaveRoom);
    const leaverId = leaveRoom.gameState.spyPlayerId;
    leaveRoom.gameState.players = leaveRoom.gameState.players.filter(p => p.playerId !== leaverId);
    spyfallEngine.handlePlayerLeft(leaveRoom, leaverId);
    assert.strictEqual(leaveRoom.gameState.winner.team, 'citizens');
    const scoring = spyfallEngine.getScoringPlayers(leaveRoom);
    assert.strictEqual(scoring.length, 4, 'leaver stays in scoring roster');
    assert.strictEqual(scoring.find(p => p.playerId === leaverId).role, 'spy');

    // ===== UX: ลำดับถาม–ตอบ =====
    const turnRoom = createMockRoom(5);
    spyfallEngine.startGame(turnRoom);
    spyfallEngine.advancePhase(turnRoom);
    const firstAsker = turnRoom.gameState.askerId;
    assert.ok(firstAsker, 'discussion should pick a first asker');
    assert.ok(turnRoom.gameState.history.some(h => h.icon === '🎤'), 'first asker announced in history');
    const askerView = spyfallEngine.buildClientState(turnRoom, firstAsker);
    assert.strictEqual(askerView.turn.isMyTurn, true);
    assert.strictEqual(askerView.turn.askerId, firstAsker);
    const notAsker = turnRoom.gameState.players.find(p => p.playerId !== firstAsker && p.permission !== 'admin').playerId;
    assert.strictEqual(spyfallEngine.buildClientState(turnRoom, notAsker).turn.isMyTurn, false);
    assert.throws(() => spyfallEngine.passQuestion(turnRoom, notAsker, firstAsker), /ตาของ/, 'only the asker passes the turn');
    assert.throws(() => spyfallEngine.passQuestion(turnRoom, firstAsker, firstAsker), /ตัวเอง/);
    spyfallEngine.passQuestion(turnRoom, firstAsker, notAsker);
    assert.strictEqual(turnRoom.gameState.askerId, notAsker, 'the person asked asks next');
    assert.strictEqual(turnRoom.gameState.lastAskerId, firstAsker);
    const turnView = spyfallEngine.buildClientState(turnRoom, notAsker);
    assert.strictEqual(turnView.turn.isMyTurn, true);
    assert.strictEqual(turnView.turn.lastAskerId, firstAsker, 'UI needs to know who just asked (no asking back)');
    assert.strictEqual(turnView.turn.timesAsked[notAsker], 1);
    // หัวหน้าห้องกดแทนคนถามได้
    const third = turnRoom.gameState.players.find(p => ![notAsker, firstAsker, turnRoom.gameState.spyPlayerId].includes(p.playerId)).playerId;
    spyfallEngine.passQuestion(turnRoom, 'p1', third, { isHost: true });
    assert.strictEqual(turnRoom.gameState.askerId, third);
    // คนถามออกจากเกม → ตาไปคนอื่น
    turnRoom.gameState.players = turnRoom.gameState.players.filter(p => p.playerId !== third);
    turnRoom.players = turnRoom.players.filter(p => p.playerId !== third);
    spyfallEngine.handlePlayerLeft(turnRoom, third);
    assert.strictEqual(turnRoom.gameState.phase, 'discussion');
    assert.ok(turnRoom.gameState.askerId && turnRoom.gameState.askerId !== third, 'asker who left hands the turn on');

    // ===== UX: พร้อมโหวต (เกินครึ่ง = ไปโหวตเลย) =====
    const readyRoom = createMockRoom(5);
    spyfallEngine.startGame(readyRoom);
    spyfallEngine.advancePhase(readyRoom);
    let res = spyfallEngine.toggleReadyToVote(readyRoom, 'p1');
    assert.strictEqual(res.ready, true);
    assert.strictEqual(res.needed, 3, '5 online players → need 3');
    res = spyfallEngine.toggleReadyToVote(readyRoom, 'p1');
    assert.strictEqual(res.ready, false, 'tap again to cancel');
    spyfallEngine.toggleReadyToVote(readyRoom, 'p1');
    spyfallEngine.toggleReadyToVote(readyRoom, 'p2');
    assert.strictEqual(readyRoom.gameState.phase, 'discussion');
    assert.strictEqual(spyfallEngine.buildClientState(readyRoom, 'p2').readyVote.count, 2);
    res = spyfallEngine.toggleReadyToVote(readyRoom, 'p3');
    assert.strictEqual(res.advanced, true);
    assert.strictEqual(readyRoom.gameState.phase, 'vote');
    assert.ok(/เกินครึ่ง/.test(readyRoom.gameState.history[0].text), 'history says why the vote started');
    assert.throws(() => spyfallEngine.toggleReadyToVote(readyRoom, 'p4'), /ช่วงคุย/);
    // ผู้เล่นออฟไลน์ไม่นับในเกณฑ์
    const offRoom = createMockRoom(4);
    offRoom.players[3].socketId = null;
    spyfallEngine.startGame(offRoom);
    spyfallEngine.advancePhase(offRoom);
    assert.strictEqual(spyfallEngine.buildClientState(offRoom, 'p1').readyVote.needed, 2, '3 online → need 2');

    // ประวัติไม่บอก "หมดเวลาคุย" ตอนหัวหน้าห้องกดข้าม
    const hostSkip = createMockRoom(4);
    spyfallEngine.startGame(hostSkip);
    spyfallEngine.advancePhase(hostSkip);
    spyfallEngine.endDiscussionEarly(hostSkip);
    assert.ok(!hostSkip.gameState.history.some(h => /หมดเวลาคุย/.test(h.text)), 'host skip must not claim the time ran out');
    assert.strictEqual(spyfallEngine.buildClientState(hostSkip, 'p1').turn, null, 'no turn info outside discussion');

    // everyoneVoted ใช้ตอนคนที่ยังไม่โหวตหลุด — นับเฉพาะคนออนไลน์
    const voteOff = createMockRoom(4);
    spyfallEngine.startGame(voteOff);
    spyfallEngine.advancePhase(voteOff);
    spyfallEngine.endDiscussionEarly(voteOff);
    const vSpy = voteOff.gameState.spyPlayerId;
    const vOthers = voteOff.gameState.players.filter(p => p.playerId !== vSpy).map(p => p.playerId);
    spyfallEngine.submitVote(voteOff, vSpy, vOthers[0]);
    spyfallEngine.submitVote(voteOff, vOthers[0], vSpy);
    spyfallEngine.submitVote(voteOff, vOthers[1], vSpy);
    assert.strictEqual(spyfallEngine.everyoneVoted(voteOff), false);
    voteOff.players.find(p => p.playerId === vOthers[2]).socketId = null;
    assert.strictEqual(spyfallEngine.everyoneVoted(voteOff), true, 'offline non-voter should not block the result');

    console.log('smoke-spyfall: OK');
}

run();
