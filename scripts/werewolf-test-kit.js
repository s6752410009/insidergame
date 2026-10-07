// Shared helpers for engine-level Werewolf tests (new roles, fidelity, random sims).
// Builds a room with an exact role per seat so every scenario is deterministic.
const E = require('../games/werewolfEngine');

const SKIP = E.SKIP_TARGET_ID;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function setup(roles, settings = {}) {
    const room = {
        roomId: `t-${Math.random().toString(16).slice(2, 8)}`,
        name: 'werewolf test',
        admin: 'p1',
        settings: { gameMode: 'werewolf', werewolfRoles: [...new Set(roles.filter(r => r !== 'villager'))], ...settings },
        players: roles.map((role, index) => ({
            playerId: `p${index + 1}`,
            playerName: `P${index + 1}-${role}`,
            socketId: `s${index + 1}`,
            color: '#3498db',
            avatar: '👤',
            avatarFrame: 'none'
        }))
    };
    E.startGame(room);
    room.gameState.players.forEach((player, index) => {
        player.role = roles[index];
        player.roleInfo = E.ROLE_DEFINITIONS[roles[index]];
    });
    room.gameState.rolePlan = roles.map(role => E.ROLE_DEFINITIONS[role]);
    return room;
}

function P(room, role, index = 0) {
    const player = room.gameState.players.filter(p => p.role === role)[index];
    assert(player, `missing role ${role}#${index}`);
    return player;
}

function act(room, actor, target, type = null) {
    const actorId = typeof actor === 'string' ? actor : actor.playerId;
    const targetId = target === SKIP ? SKIP : (typeof target === 'string' ? target : target.playerId);
    return E.submitNightAction(room, actorId, targetId, type);
}

// all living wolves vote the same target
function wolvesKill(room, target) {
    room.gameState.players
        .filter(p => p.alive !== false && (p.role === 'werewolf' || p.role === 'alphaWolf'))
        .forEach(wolf => act(room, wolf, target));
}

function endNight(room) {
    assert(room.gameState.phase === 'night', `expected night, got ${room.gameState.phase}`);
    return E.autoResolvePhase(room);
}

function toVote(room) {
    if (room.gameState.phase === 'day-discussion') {
        E.autoResolvePhase(room);
    }
    assert(room.gameState.phase === 'day-vote', `expected day-vote, got ${room.gameState.phase}`);
}

// skip a whole day (nobody lynched) → next night
function skipDay(room) {
    toVote(room);
    E.autoResolvePhase(room);
}

// every living player except the target votes target; target votes skip
function lynch(room, target, options = {}) {
    toVote(room);
    const voters = room.gameState.players.filter(p => p.alive !== false && p.playerId !== target.playerId);
    let result = null;
    voters.forEach(voter => {
        if (room.gameState.phase !== 'day-vote') return;
        if (options.exclude && options.exclude.includes(voter.playerId)) return;
        result = E.submitDayVote(room, voter.playerId, target.playerId);
    });
    if (room.gameState.phase === 'day-vote') {
        result = E.autoResolvePhase(room);
    }
    return result;
}

// advance from night 1 to the start of night `n` with nobody dying
function toNight(room, n) {
    while (room.gameState.phase !== 'finished' && !(room.gameState.phase === 'night' && room.gameState.dayNumber === n)) {
        if (room.gameState.phase === 'night') {
            endNight(room);
        } else {
            E.autoResolvePhase(room);
        }
    }
}

function state(room, player) {
    return E.buildClientState(room, typeof player === 'string' ? player : player.playerId);
}

function nightOptions(room, player) {
    return state(room, player).actionState.nightActions;
}

function expectThrow(fn, pattern, message) {
    let threw = false;
    try {
        fn();
    } catch (error) {
        threw = true;
        if (pattern) {
            assert(pattern.test(error.message), `${message}: wrong error "${error.message}"`);
        }
    }
    assert(threw, `${message}: expected an error`);
}

module.exports = { E, SKIP, assert, setup, P, act, wolvesKill, endNight, toVote, skipDay, lynch, toNight, state, nightOptions, expectThrow };
