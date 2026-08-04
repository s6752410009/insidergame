require('./isolateTestData');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 25000);
const ROOM_SIZE = 3;
const ROUND_TIME_MINUTES = Number(process.env.SMOKE_ROUND_TIME_MINUTES || 0.25);

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
    let resolvedStarted = false;

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
            process.stdout.write(`[app] ${text}`);
            if (!resolvedStarted && text.includes(`Server started on port ${port}`)) {
                resolvedStarted = true;
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

    socket.on('werewolfState', payload => {
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
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
}

function createStateCheckpoint(clients) {
    return new Map(clients.map(client => [client.playerId, (client.states || []).length]));
}

async function waitForOpeningRoleAfter(client, roomId, afterIndex) {
    const existing = (client.states || []).slice(afterIndex).find(payload => payload && payload.roomId === roomId && payload.phase === 'night' && payload.playerRole && payload.playerRole.id);
    if (existing) {
        return existing;
    }

    return onceWithTimeout(
        client.socket,
        'werewolfState',
        payload => payload && payload.roomId === roomId && payload.phase === 'night' && payload.playerRole && payload.playerRole.id,
        EVENT_TIMEOUT_MS
    );
}

async function collectOpeningStates(clients, roomId, checkpoint) {
    return Promise.all(clients.map(client => waitForOpeningRoleAfter(client, roomId, checkpoint.get(client.playerId) || 0)));
}

function sortRoleIds(states) {
    return states.map(state => state.playerRole.id).sort();
}

function getRoleMapByPlayerId(states, clients) {
    return clients.reduce((result, client, index) => {
        result[client.playerId] = states[index].playerRole.id;
        return result;
    }, {});
}

async function createRoomAndJoin(clients, selectedRoles) {
    const [creator, ...others] = clients;
    const createResponse = await emitAck(creator.socket, 'createRoom', {
        playerId: creator.playerId,
        name: `Werewolf Selection ${Date.now()}`,
        gameMode: 'werewolf',
        maxPlayers: ROOM_SIZE,
        roundTime: ROUND_TIME_MINUTES,
        werewolfRoles: selectedRoles
    });
    assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
    const roomId = createResponse.roomId;
    bindRoom(creator, roomId);

    for (const client of others) {
        const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
        assert(joinResponse && joinResponse.success, `joinRoom failed for ${client.label}`);
        bindRoom(client, roomId);
    }

    return roomId;
}

async function startRound(clients, roomId) {
    const checkpoint = createStateCheckpoint(clients);
    const startResponse = await emitAck(clients[0].socket, 'startGameFromLobby', { roomId }, 30000);
    assert(startResponse && startResponse.success, 'startGameFromLobby failed');
    return collectOpeningStates(clients, roomId, checkpoint);
}

async function restartToLobby(clients, roomId) {
    const restartWaiters = clients.map(client => onceWithTimeout(client.socket, 'restartGame', null, 10000));
    const response = await emitAck(clients[0].socket, 'werewolf_restartGame', { roomId }, 10000);
    assert(response && response.success, `werewolf_restartGame failed: ${response?.error || 'unknown error'}`);
    await Promise.all(restartWaiters);
}

async function runScenario(baseUrl, selectedRoles, expectedRoles, options = {}) {
    const clients = Array.from({ length: ROOM_SIZE }, (_, index) => createClient(`player-${index + 1}`, baseUrl));
    try {
        for (const client of clients) {
            await connectClient(client);
        }

        const roomId = await createRoomAndJoin(clients, selectedRoles);
        const roundOneStates = await startRound(clients, roomId);
        const assignedRoles = sortRoleIds(roundOneStates);
        if (typeof options.validateRoles === 'function') {
            options.validateRoles(assignedRoles);
        } else {
            const expectedSorted = [...expectedRoles].sort();
            assert(JSON.stringify(assignedRoles) === JSON.stringify(expectedSorted), `Expected roles ${expectedSorted.join(', ')} but got ${assignedRoles.join(', ')}`);
        }

        if (options.expectRoleChangeOnRestart) {
            const roundOneRolesByPlayerId = getRoleMapByPlayerId(roundOneStates, clients);
            await restartToLobby(clients, roomId);
            const roundTwoStates = await startRound(clients, roomId);
            const roundTwoRolesByPlayerId = getRoleMapByPlayerId(roundTwoStates, clients);

            clients.forEach(client => {
                assert(
                    roundOneRolesByPlayerId[client.playerId] !== roundTwoRolesByPlayerId[client.playerId],
                    `${client.label} received the same role in consecutive rounds: ${roundTwoRolesByPlayerId[client.playerId]}`
                );
            });
        }

        return { roomId, assignedRoles };
    } finally {
        await Promise.all(clients.map(async client => {
            if (client.socket.connected) {
                client.socket.disconnect();
            }
        }));
    }
}

async function main() {
    const spawnedServer = await spawnServer();

    try {
        console.log('1. Verify exact selected roles are used when they fit the room');
        const exactSelection = await runScenario(
            spawnedServer.baseUrl,
            ['alphaWolf', 'seer', 'doctor'],
            ['alphaWolf', 'seer', 'doctor'],
            { expectRoleChangeOnRestart: true }
        );

        console.log('2. Verify 3-player invalid Fool selection is replaced by a valid support role');
        const fallbackSelection = await runScenario(
            spawnedServer.baseUrl,
            ['seer', 'fool'],
            null,
            {
                validateRoles(assignedRoles) {
                    assert(assignedRoles.includes('werewolf'), `Expected fallback roles to include werewolf but got ${assignedRoles.join(', ')}`);
                    assert(assignedRoles.includes('seer'), `Expected fallback roles to include seer but got ${assignedRoles.join(', ')}`);
                    assert(!assignedRoles.includes('fool'), `Expected 3-player fallback to filter Fool out but got ${assignedRoles.join(', ')}`);
                    assert(assignedRoles.length === 3, `Expected exactly 3 roles but got ${assignedRoles.join(', ')}`);
                }
            }
        );

        console.log('SMOKE_RESULT ' + JSON.stringify({
            exactSelection,
            fallbackSelection,
            rerollAvoidedSameRole: true
        }));
    } finally {
        if (spawnedServer.child && !spawnedServer.child.killed) {
            spawnedServer.child.kill('SIGTERM');
        }
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});
