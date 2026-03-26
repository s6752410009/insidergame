const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function request(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            res.resume();
            resolve(res.statusCode || 0);
        });

        req.on('error', reject);
    });
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = require('net').createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForHttpReady(baseUrl, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const status = await request(baseUrl);
            if (status >= 200 && status < 500) {
                return;
            }
        } catch (error) {
            await delay(250);
            continue;
        }
        await delay(250);
    }

    throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function spawnServer() {
    const port = await getFreePort();
    const appPath = path.join(__dirname, '..', 'app.js');
    const child = spawn(process.execPath, [appPath], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const startedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for app startup log on port ${port}`));
        }, SERVER_TIMEOUT_MS);

        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`App exited before startup completed with code ${code}`));
        });

        child.stdout.on('data', chunk => {
            const text = String(chunk);
            stdout += text;
            if (text.includes(`Server started on port ${port}`)) {
                clearTimeout(timer);
                resolve();
            }
        });
    });

    child.stderr.on('data', chunk => {
        stderr += String(chunk);
    });

    try {
        await startedPromise;
        await waitForHttpReady(`http://127.0.0.1:${port}`, SERVER_TIMEOUT_MS);
    } catch (error) {
        child.kill('SIGTERM');
        throw new Error(`${error.message}\n${stdout}\n${stderr}`.trim());
    }

    return {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        child
    };
}

function onceWithTimeout(socket, eventName, predicate = null, timeoutMs = EVENT_TIMEOUT_MS) {
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

function emitAck(socket, eventName, payload, timeoutMs = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${eventName}`)), timeoutMs);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function createClient(label, baseUrl) {
    const playerId = randomUUID();
    const socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
        forceNew: true,
        timeout: EVENT_TIMEOUT_MS
    });

    const client = {
        label,
        playerId,
        socket,
        states: []
    };

    socket.on('blackmarketState', payload => {
        client.states.push(payload);
        client.lastState = payload;
    });

    return client;
}

async function connectClient(client) {
    if (!client.socket.connected) {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout waiting for connect (${client.label})`)), EVENT_TIMEOUT_MS);

            function cleanup() {
                clearTimeout(timer);
                client.socket.off('connect', onConnect);
                client.socket.off('connect_error', onError);
            }

            function onConnect() {
                cleanup();
                resolve();
            }

            function onError(error) {
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }

            client.socket.once('connect', onConnect);
            client.socket.once('connect_error', onError);
        });
    }

    client.socket.emit('initPlayer', client.playerId);
    return client;
}

function bindRoom(client, roomId) {
    client.socket.emit('setRoom', { roomId, playerId: client.playerId });
    client.socket.emit('requestRoomUpdate', { roomId });
    client.socket.emit('checkRoomStatus', { roomId, playerId: client.playerId });
    client.socket.emit('blackmarket_requestState', { roomId, playerId: client.playerId });
}

function waitForStateAfter(client, afterIndex, predicate, timeoutMs = EVENT_TIMEOUT_MS) {
    const nextStates = (client.states || []).slice(afterIndex);
    const existing = nextStates.find(predicate);
    if (existing) {
        return Promise.resolve(existing);
    }

    return onceWithTimeout(client.socket, 'blackmarketState', predicate, timeoutMs);
}

function checkpointStates(clients) {
    return new Map(clients.map(client => [client.playerId, (client.states || []).length]));
}

async function waitForPhase(clients, roomId, phase, checkpoint) {
    return Promise.all(clients.map(client => waitForStateAfter(
        client,
        checkpoint.get(client.playerId) || 0,
        payload => payload && payload.roomId === roomId && payload.phase === phase,
        EVENT_TIMEOUT_MS
    )));
}

function chooseActionPayload(state) {
    const self = state.self || {};
    const targets = (state.players || []).filter(player => player.alive && !player.isSelf);
    const cargoItems = state.actionHelp?.cargoItems || [];

    if (cargoItems.length > 0) {
        return { actionType: 'deliver', itemId: cargoItems[0].id };
    }

    if (state.actionHelp?.canHit && targets.length > 0) {
        return { actionType: 'hit', targetPlayerId: targets[0].playerId };
    }

    if (targets.length > 0) {
        return { actionType: 'intel', targetPlayerId: targets[0].playerId };
    }

    if (self.heat > 0) {
        return { actionType: 'laylow' };
    }

    return { actionType: 'guard' };
}

async function main() {
    const server = await spawnServer();
    const clients = [
        createClient('boss-seat', server.baseUrl),
        createClient('market-seat', server.baseUrl),
        createClient('street-seat', server.baseUrl),
        createClient('shadow-seat', server.baseUrl)
    ];

    try {
        for (const client of clients) {
            await connectClient(client);
        }

        const [creator, ...others] = clients;

        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Black Market ${Date.now()}`,
            gameMode: 'blackmarket',
            maxPlayers: 7,
            roundTime: 1
        });
        assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
        const roomId = createResponse.roomId;
        bindRoom(creator, roomId);

        for (const client of others) {
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joinResponse && joinResponse.success, `joinRoom failed for ${client.label}`);
            bindRoom(client, roomId);
        }

        const startResponse = await emitAck(creator.socket, 'startGameFromLobby', { roomId });
        assert(startResponse && startResponse.success, 'startGameFromLobby failed');

        await Promise.all(clients.map(client => onceWithTimeout(
            client.socket,
            'blackmarketState',
            payload => payload && payload.roomId === roomId && payload.phase === 'market' && payload.playerRole && payload.playerRole.id,
            25000
        )));

        const marketCheckpoint = checkpointStates(clients);
        for (const client of clients) {
            const state = client.lastState;
            const affordableOffer = (state.marketOffers || []).find(item => item.affordable);
            const response = await emitAck(client.socket, 'blackmarket_buyOffer', {
                roomId,
                playerId: client.playerId,
                itemId: affordableOffer ? affordableOffer.id : state.passChoice
            });
            assert(response && response.success, `market choice failed for ${client.label}`);
        }

        const actionStates = await waitForPhase(clients, roomId, 'action', marketCheckpoint);
        assert(actionStates.every(state => state.phase === 'action'), 'room did not advance to action phase');

        const actionCheckpoint = checkpointStates(clients);
        for (const client of clients) {
            const state = client.lastState;
            const actionPayload = chooseActionPayload(state);
            const response = await emitAck(client.socket, 'blackmarket_submitAction', {
                roomId,
                playerId: client.playerId,
                ...actionPayload
            });
            assert(response && response.success, `action submit failed for ${client.label}`);
        }

        const nextStates = await Promise.all(clients.map(client => waitForStateAfter(
            client,
            actionCheckpoint.get(client.playerId) || 0,
            payload => payload && payload.roomId === roomId && ['market', 'finished'].includes(payload.phase),
            25000
        )));

        assert(nextStates.every(state => ['market', 'finished'].includes(state.phase)), 'room did not resolve the first action round');
        assert(nextStates.some(state => Number(state.roundNumber || 0) >= 2 || state.phase === 'finished'), 'game did not move past the first round');

        console.log('SMOKE_RESULT ' + JSON.stringify({
            roomId,
            players: clients.length,
            finalPhase: nextStates[0].phase,
            roundNumber: nextStates[0].roundNumber
        }));
    } finally {
        clients.forEach(client => {
            if (client.socket.connected) {
                client.socket.disconnect();
            }
        });

        server.child.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});