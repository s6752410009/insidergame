#!/usr/bin/env node
'use strict';

const assert = require('assert');
const spyfallEngine = require('../games/spyfallEngine');

function createMockRoom(playerCount = 4) {
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
            roundTime: 60 // seconds in mock (lobby stores minutes * 60)
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

    console.log('smoke-spyfall: OK');
}

run();
