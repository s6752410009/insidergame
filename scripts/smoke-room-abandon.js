/**
 * Smoke: ห้องไม่มีคนออนไลน์ → ระบบรีเซ็ตเกม (abandon sweep)
 * รันพร้อม server และ SMOKE_FAST_CLEANUP=1
 *   SMOKE_FAST_CLEANUP=1 node scripts/smoke-room-abandon.js
 */
const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const SWEEP_WAIT_MS = Number(process.env.SMOKE_SWEEP_WAIT_MS || 8000);

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
    if (process.env.SMOKE_FAST_CLEANUP !== '1') {
        console.warn('Tip: run with SMOKE_FAST_CLEANUP=1 for faster abandon timing');
    }

    const playerId = randomUUID();
    const socket = io(BASE_URL, { transports: ['websocket'], forceNew: true });
    let roomId = null;

    try {
        await once(socket, 'connect');
        socket.emit('initPlayer', playerId);

        const createResponse = await emitAck(socket, 'createRoom', {
            playerId,
            name: `Abandon smoke ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: 5,
            tableMode: 'inPerson',
            werewolfRoles: ['werewolf', 'seer', 'doctor']
        });
        assert(createResponse?.success && createResponse.roomId, 'createRoom failed');
        roomId = createResponse.roomId;

        socket.emit('setRoom', { roomId, playerId });
        const startResponse = await emitAck(socket, 'startGameFromLobby', { roomId });
        assert(startResponse?.success, 'startGameFromLobby failed');
        await once(socket, 'werewolfState', payload => payload?.roomId === roomId && payload.phase === 'night', 20000);

        console.log('Disconnecting sole player…');
        socket.disconnect();
        await delay(SWEEP_WAIT_MS);

        const probe = io(BASE_URL, { transports: ['websocket'], forceNew: true });
        await once(probe, 'connect');
        const listPayload = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('roomListUpdate timeout')), TIMEOUT_MS);
            probe.on('roomListUpdate', rooms => {
                clearTimeout(timer);
                resolve(rooms);
            });
            probe.emit('initPlayer', randomUUID());
        });

        const entry = Array.isArray(listPayload) ? listPayload.find(room => room.roomId === roomId) : null;
        const ok = !entry || entry.gameStatus === 'waiting' || entry.isJoinable !== false;
        assert(ok, `room still stuck playing: ${JSON.stringify(entry)}`);

        console.log('SMOKE_RESULT ' + JSON.stringify({ roomId, abandon: 'passed', listEntry: entry || 'removed' }));
        probe.disconnect();
    } finally {
        if (socket.connected) {
            socket.disconnect();
        }
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});
