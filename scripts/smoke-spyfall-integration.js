#!/usr/bin/env node
'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000);

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
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const startedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for app startup on port ${port}`));
        }, SERVER_TIMEOUT_MS);

        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`App exited before startup with code ${code}`));
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

    return { port, baseUrl: `http://127.0.0.1:${port}`, child };
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
        const timer = setTimeout(() => reject(new Error(`Timeout ack for ${eventName}`)), timeoutMs);
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
        timeout: 15000
    });
    const states = [];
    socket.on('spyfallState', payload => {
        states.push(payload);
    });
    return { label, playerId, socket, states };
}

async function connectClient(client) {
    await onceWithTimeout(client.socket, 'connect', null, 15000);
    client.socket.emit('initPlayer', client.playerId);
}

function bindRoom(client, roomId) {
    client.socket.emit('setRoom', { roomId, playerId: client.playerId });
    client.socket.emit('requestRoomUpdate', { roomId });
    client.socket.emit('spyfall_requestState', { roomId, playerId: client.playerId });
}

function waitSpyfallState(client, roomId, predicate, timeoutMs = EVENT_TIMEOUT_MS) {
    const existing = client.states.find(payload =>
        payload?.roomId === roomId && (!predicate || predicate(payload))
    );
    if (existing) {
        return Promise.resolve(existing);
    }
    return onceWithTimeout(
        client.socket,
        'spyfallState',
        payload => payload?.roomId === roomId && (!predicate || predicate(payload)),
        timeoutMs
    );
}

async function main() {
    const server = await spawnServer();
    const clients = ['a', 'b', 'c', 'd'].map(label => createClient(`player-${label}`, server.baseUrl));
    let roomId = null;

    try {
        console.log(`1. Server ready → ${server.baseUrl}`);
        for (const client of clients) {
            await connectClient(client);
        }

        const [admin, p2, p3, p4] = clients;

        console.log('2. Create Spyfall room');
        const createResponse = await emitAck(admin.socket, 'createRoom', {
            playerId: admin.playerId,
            name: `Spyfall Smoke ${Date.now()}`,
            gameMode: 'spyfall',
            maxPlayers: 8,
            roundTime: 1
        });
        assert(createResponse?.success && createResponse.roomId, JSON.stringify(createResponse));
        roomId = createResponse.roomId;
        bindRoom(admin, roomId);

        console.log('3. Join players');
        for (const client of [p2, p3, p4]) {
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joinResponse?.success, `join failed: ${client.label}`);
            bindRoom(client, roomId);
        }

        console.log('4. Start game');
        const startResponse = await emitAck(admin.socket, 'startGameFromLobby', { roomId });
        assert(startResponse?.success, JSON.stringify(startResponse));

        await Promise.all(clients.map(c =>
            onceWithTimeout(c.socket, 'gameStarting', payload => payload?.roomId === roomId, 20000)
        ));

        await delay(500);
        clients.forEach(c => bindRoom(c, roomId));

        console.log('5. Reveal phase + role views');
        const revealStates = await Promise.all(clients.map(c =>
            waitSpyfallState(c, roomId, payload => payload.phase === 'reveal', 25000)
        ));

        const spies = revealStates.filter(state => state.self?.isSpy);
        const citizens = revealStates.filter(state => !state.self?.isSpy);
        assert(spies.length === 1, `expected 1 spy, got ${spies.length}`);
        assert(citizens.length === 3, `expected 3 citizens, got ${citizens.length}`);
        assert(spies[0].location === null, 'spy must not see location');
        assert(citizens[0].location?.name, 'citizen must see location');
        assert(spies[0].locationPool?.length >= 18, 'spy needs location pool');

        console.log('6. Vote phase (~65s: reveal 5s + discussion 60s)');
        await waitSpyfallState(admin, roomId, payload => payload.phase === 'vote', 90000);

        const spyId = spies[0].self.playerId;
        const citizenId = citizens[0].self.playerId;

        console.log('7. Vote to catch spy');
        for (const client of clients) {
            const targetId = client.playerId === spyId ? citizenId : spyId;
            const voteResponse = await emitAck(client.socket, 'spyfall_vote', {
                roomId,
                playerId: client.playerId,
                targetPlayerId: targetId
            });
            assert(voteResponse?.success !== false, `vote failed: ${client.label}`);
        }

        console.log('8. Finished — citizens win');
        const finishedState = await waitSpyfallState(
            admin,
            roomId,
            payload => payload.phase === 'finished' && payload.winner?.team === 'citizens',
            15000
        );
        assert(finishedState.location?.name, 'location revealed');
        assert(finishedState.players.some(player => player.isSpy === true), 'roles revealed');

        console.log('smoke-spyfall-integration: OK');
    } finally {
        clients.forEach(client => client.socket.disconnect());
        server.child.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error('smoke-spyfall-integration: FAIL', error.message);
    process.exit(1);
});
