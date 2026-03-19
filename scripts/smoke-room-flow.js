const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function onceWithTimeout(socket, eventName, predicate = null, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(eventName, handler);
            reject(new Error(`Timeout waiting for ${eventName}`));
        }, timeoutMs);

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

function waitForClientEvent(client, eventName, predicate = null, timeoutMs = TIMEOUT_MS) {
    const existing = client.events.find(entry => entry.eventName === eventName && (!predicate || predicate(entry.payload)));
    if (existing) {
        return Promise.resolve(existing.payload);
    }

    return onceWithTimeout(client.socket, eventName, predicate, timeoutMs);
}

function emitAck(socket, eventName, payload, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${eventName}`)), timeoutMs);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function createClient(label, playerId = randomUUID()) {
    const socket = io(BASE_URL, {
        transports: ['websocket'],
        reconnection: true,
        forceNew: true,
        timeout: TIMEOUT_MS
    });

    const client = {
        label,
        playerId,
        socket,
        events: []
    };

    ['roomUpdate', 'adminTransferred', 'gameStarting', 'werewolfState', 'kickedFromRoom', 'roomClosed', 'newMessage'].forEach(eventName => {
        socket.on(eventName, payload => {
            client.events.push({ eventName, payload, at: Date.now() });
        });
    });

    return client;
}

async function connectClient(client) {
    await onceWithTimeout(client.socket, 'connect', null, TIMEOUT_MS);
    client.socket.emit('initPlayer', client.playerId);
    return client;
}

function bindRoom(client, roomId) {
    client.socket.emit('setRoom', { roomId, playerId: client.playerId });
    client.socket.emit('requestRoomUpdate', { roomId });
    client.socket.emit('checkRoomStatus', { roomId, playerId: client.playerId });
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
}

async function main() {
    const clients = [
        createClient('player-a'),
        createClient('player-b'),
        createClient('player-c')
    ];

    let roomId = null;

    try {
        console.log('1. Connect 3 clients');
        for (const client of clients) {
            await connectClient(client);
            console.log(`   - connected ${client.label} ${client.playerId}`);
        }

        const [creator, second, third] = clients;

        console.log('2. Create werewolf room');
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Smoke ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: 5,
            roundTime: 1,
            werewolfRoles: ['werewolf', 'seer', 'doctor']
        });
        assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
        roomId = createResponse.roomId;
        bindRoom(creator, roomId);
        const creatorRoomUpdate = await waitForClientEvent(creator, 'roomUpdate', payload => payload.roomId === roomId);
        assert(creatorRoomUpdate.admin === creator.playerId, 'creator not admin after room creation');

        console.log('3. Join player-b and player-c');
        for (const client of [second, third]) {
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joinResponse && joinResponse.success, `joinRoom failed for ${client.label}`);
            bindRoom(client, roomId);
        }

        const roomReadyPayload = await waitForClientEvent(creator, 'roomUpdate', payload => payload.roomId === roomId && Array.isArray(payload.players) && payload.players.length >= 3);
        assert(roomReadyPayload.players.length === 3, 'room does not have 3 players after joins');

        console.log('4. Transfer admin to player-b');
        const transferResponse = await emitAck(creator.socket, 'transferAdmin', { newAdminPlayerId: second.playerId });
        assert(transferResponse && transferResponse.success, 'transferAdmin failed');
        const adminTransferred = await waitForClientEvent(second, 'adminTransferred', payload => payload.newAdminId === second.playerId);
        assert(adminTransferred.newAdminId === second.playerId, 'player-b did not become admin');
        const postTransferRoomUpdate = await waitForClientEvent(second, 'roomUpdate', payload => payload.roomId === roomId && payload.admin === second.playerId);
        assert(postTransferRoomUpdate.admin === second.playerId, 'roomUpdate did not reflect new admin');

        console.log('5. Simulate reload for new admin');
        second.socket.disconnect();
        await delay(500);
        const reloadedAdmin = createClient('player-b-reloaded', second.playerId);
        await connectClient(reloadedAdmin);
        bindRoom(reloadedAdmin, roomId);
        const reloadedRoomUpdate = await waitForClientEvent(reloadedAdmin, 'roomUpdate', payload => payload.roomId === roomId && payload.admin === second.playerId);
        assert(reloadedRoomUpdate.admin === second.playerId, 'admin changed after reload');
        assert(reloadedRoomUpdate.players.some(player => player.playerId === second.playerId), 'reloaded admin missing from room');

        console.log('6. Start werewolf game from reloaded admin');
        const startResponse = await emitAck(reloadedAdmin.socket, 'startGameFromLobby', { roomId });
        assert(startResponse && startResponse.success, 'startGameFromLobby failed');
        await waitForClientEvent(reloadedAdmin, 'gameStarting', payload => payload.roomId === roomId, 20000);
        const werewolfState = await waitForClientEvent(
            reloadedAdmin,
            'werewolfState',
            payload => payload && payload.roomId === roomId && ['night', 'day-vote', 'finished'].includes(payload.phase) && payload.playerRole && payload.playerRole.id,
            20000
        );
        assert(['night', 'day-vote', 'finished'].includes(werewolfState.phase), 'werewolf state did not enter an active phase');
        assert(werewolfState.playerRole && werewolfState.playerRole.id, 'reloaded admin did not receive role after game start');

        console.log('7. Refresh-style reconnect for player-c during game');
        third.socket.disconnect();
        await delay(500);
        const thirdReloaded = createClient('player-c-reloaded', third.playerId);
        await connectClient(thirdReloaded);
        bindRoom(thirdReloaded, roomId);
        const thirdState = await waitForClientEvent(
            thirdReloaded,
            'werewolfState',
            payload => payload && payload.roomId === roomId && ['night', 'day-vote', 'finished'].includes(payload.phase) && payload.playerRole && payload.playerRole.id,
            20000
        );
        assert(thirdState.playerRole && thirdState.playerRole.id, 'player-c lost werewolf role after reconnect');

        console.log('8. Explicit leave and rejoin for player-c during game');
        const leaveResponse = await emitAck(thirdReloaded.socket, 'leaveRoom', { roomId, playerId: thirdReloaded.playerId });
        assert(leaveResponse && leaveResponse.success, 'leaveRoom failed for player-c');

        const rejoinClient = createClient('player-c-rejoin', third.playerId);
        await connectClient(rejoinClient);
        const rejoinResponse = await emitAck(rejoinClient.socket, 'joinRoom', { roomId, playerId: third.playerId });
        assert(rejoinResponse && rejoinResponse.success, 'joinRoom failed for player-c rejoin');
        bindRoom(rejoinClient, roomId);

        let rejoinStateError = null;
        try {
            const rejoinState = await waitForClientEvent(rejoinClient, 'werewolfState', payload => payload && payload.roomId === roomId, 5000);
            assert(rejoinState.playerRole && rejoinState.playerRole.id, 'player-c rejoined but did not recover a role');
            console.log('   - explicit leave/rejoin recovered role successfully');
        } catch (error) {
            rejoinStateError = error;
            console.log(`   - explicit leave/rejoin issue detected: ${error.message}`);
        }

        const summary = {
            roomId,
            transferAdmin: 'passed',
            reloadAdmin: 'passed',
            startGame: 'passed',
            reconnectDuringGame: 'passed',
            leaveRejoinDuringGame: rejoinStateError ? `failed: ${rejoinStateError.message}` : 'passed'
        };

        console.log('SMOKE_RESULT ' + JSON.stringify(summary));

        if (rejoinStateError) {
            process.exitCode = 2;
        }
    } finally {
        clients.forEach(client => {
            if (client.socket.connected) {
                client.socket.disconnect();
            }
        });
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});