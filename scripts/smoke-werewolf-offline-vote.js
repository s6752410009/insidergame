/**
 * Unit-style smoke: โหวตกลางวันข้ามผู้เล่น offline
 */
const werewolfEngine = require('../games/werewolfEngine');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createPlayers(count) {
    return Array.from({ length: count }, (_, index) => ({
        playerId: `p${index + 1}`,
        playerName: `Player ${index + 1}`,
        color: '#fff',
        avatar: '👤',
        avatarFrame: 'none',
        socketId: `sock-${index + 1}`
    }));
}

function main() {
    const room = {
        roomId: 'offline-vote-smoke',
        name: 'Offline vote',
        settings: { gameMode: 'werewolf', werewolfRoles: ['werewolf', 'seer', 'doctor', 'villager'] },
        players: createPlayers(4)
    };

    werewolfEngine.startGame(room);
    room.gameState.phase = 'day-vote';
    room.gameState.status = 'werewolf_day_vote';
    room.gameState.dayVotes = {
        p1: 'SKIP',
        p2: 'SKIP'
    };
    room.players[2].socketId = null;
    room.gameState.players[2].socketId = null;
    room.gameState.dayVotes.p3 = undefined;
    room.gameState.dayVotes.p4 = 'SKIP';

    const resolution = werewolfEngine.autoResolvePhase(room);
    assert(resolution.resolved !== false, 'autoResolvePhase should advance from day-vote');

    console.log('SMOKE_RESULT ' + JSON.stringify({
        offlineVote: 'passed',
        phaseAfter: room.gameState.phase,
        statusAfter: room.gameState.status
    }));
}

try {
    main();
} catch (error) {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
}
