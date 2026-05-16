/**
 * Smoke: disconnect ชั่วคราวแล้ว reconnect ยังได้ role เดิม (ต้องมี server)
 *   node scripts/smoke-rejoin-role.js
 */
const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function emitAck(socket, eventName, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout ack ${eventName}`)), TIMEOUT_MS);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function once(socket, eventName, predicate, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout ${eventName}`)), timeoutMs);
        function handler(payload) {
            if (predicate && !predicate(payload)) {
                return;
            }
            clearTimeout(timer);
            socket.off(eventName, handler);
            resolve(payload);
        }
        socket.on(eventName, handler);
    });
}

async function main() {
    const players = ['a', 'b', 'c'].map(label => ({
        label,
        playerId: randomUUID(),
        socket: null
    }));

    let roomId = null;
    let targetRoleId = null;

    try {
        for (const entry of players) {
            entry.socket = io(BASE_URL, { transports: ['websocket'], forceNew: true });
            await once(entry.socket, 'connect');
            entry.socket.emit('initPlayer', entry.playerId);
        }

        const creator = players[0];
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Rejoin ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: 5,
            tableMode: 'inPerson',
            werewolfRoles: ['werewolf', 'seer', 'doctor']
        });
        assert(createResponse?.success, 'createRoom failed');
        roomId = createResponse.roomId;

        for (const entry of players) {
            if (entry === creator) {
                entry.socket.emit('setRoom', { roomId, playerId: entry.playerId });
                continue;
            }
            const join = await emitAck(entry.socket, 'joinRoom', { roomId, playerId: entry.playerId });
            assert(join?.success, `join failed ${entry.label}`);
            entry.socket.emit('setRoom', { roomId, playerId: entry.playerId });
        }

        const start = await emitAck(creator.socket, 'startGameFromLobby', { roomId });
        assert(start?.success, 'start failed');

        const subject = players[2];
        const firstState = await once(
            subject.socket,
            'werewolfState',
            payload => payload?.roomId === roomId && payload.playerRole?.id,
            20000
        );
        targetRoleId = firstState.playerRole.id;

        subject.socket.disconnect();
        await delay(800);

        const reloaded = io(BASE_URL, { transports: ['websocket'], forceNew: true });
        await once(reloaded, 'connect');
        reloaded.emit('initPlayer', subject.playerId);
        reloaded.emit('checkRoomStatus', { roomId, playerId: subject.playerId });
        reloaded.emit('setRoom', { roomId, playerId: subject.playerId });
        reloaded.emit('werewolf_requestState', { roomId, playerId: subject.playerId });

        const secondState = await once(
            reloaded,
            'werewolfState',
            payload => payload?.roomId === roomId && payload.playerRole?.id,
            20000
        );
        assert(secondState.playerRole.id === targetRoleId, `role changed ${targetRoleId} -> ${secondState.playerRole.id}`);

        console.log('SMOKE_RESULT ' + JSON.stringify({ roomId, role: targetRoleId, rejoin: 'passed' }));
        reloaded.disconnect();
    } finally {
        players.forEach(entry => {
            if (entry.socket?.connected) {
                entry.socket.disconnect();
            }
        });
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});
