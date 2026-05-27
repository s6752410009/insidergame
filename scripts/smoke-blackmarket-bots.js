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
    console.log('Starting Black Market Bots integration test...');
    const server = await spawnServer();
    const human = createClient('human-player', server.baseUrl);

    try {
        await connectClient(human);

        // 1. Create a room
        const createResponse = await emitAck(human.socket, 'createRoom', {
            playerId: human.playerId,
            name: `Black Market Practice ${Date.now()}`,
            gameMode: 'blackmarket',
            maxPlayers: 4,
            roundTime: 1
        });
        assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
        const roomId = createResponse.roomId;
        bindRoom(human, roomId);
        console.log(`Room created: ${roomId}`);

        // 2. Add Bots
        console.log('Adding bots...');
        const addBotsRes = await emitAck(human.socket, 'blackmarket_addBots', { roomId });
        assert(addBotsRes && addBotsRes.success, 'Adding bots failed: ' + (addBotsRes ? addBotsRes.error : 'unknown error'));
        console.log('Bots added successfully!');

        // Wait to verify roomUpdate broadcasted with players
        await delay(500);

        // 3. Start Game
        console.log('Starting game...');
        const startResponse = await emitAck(human.socket, 'startGameFromLobby', { roomId });
        assert(startResponse && startResponse.success, 'startGameFromLobby failed');
        console.log('Game started!');

        // Wait for first state update (Market phase)
        console.log('Waiting for market phase state...');
        let state = await onceWithTimeout(
            human.socket,
            'blackmarketState',
            payload => payload && payload.roomId === roomId && payload.phase === 'market',
            25000
        );
        console.log(`Entered Market Phase (Round ${state.roundNumber})`);

        // Play the game until finished
        while (state && state.phase !== 'finished') {
            if (state.phase === 'market') {
                console.log(`[Round ${state.roundNumber}] Playing Market Phase...`);
                // Make a choice for human player
                const affordableOffer = (state.marketOffers || []).find(item => item.affordable);
                const choice = affordableOffer ? affordableOffer.id : state.passChoice;
                
                console.log(`Human player purchasing item: ${choice}`);
                const response = await emitAck(human.socket, 'blackmarket_buyOffer', {
                    roomId,
                    playerId: human.playerId,
                    itemId: choice
                });
                assert(response && response.success, 'Market purchase failed');

                // Wait for phase transition
                state = await onceWithTimeout(
                    human.socket,
                    'blackmarketState',
                    payload => payload && payload.roomId === roomId && payload.phase !== 'market',
                    25000
                );
            } else if (state.phase === 'action') {
                console.log(`[Round ${state.roundNumber}] Playing Action Phase...`);
                // Choose an action for human player
                const actionPayload = chooseActionPayload(state);
                console.log(`Human player submitting action: ${JSON.stringify(actionPayload)}`);
                const response = await emitAck(human.socket, 'blackmarket_submitAction', {
                    roomId,
                    playerId: human.playerId,
                    ...actionPayload
                });
                assert(response && response.success, 'Action submit failed');

                // Wait for phase transition to next market or finished
                state = await onceWithTimeout(
                    human.socket,
                    'blackmarketState',
                    payload => payload && payload.roomId === roomId && payload.phase !== 'action',
                    25000
                );
            } else {
                console.log(`Unknown phase: ${state.phase}`);
                break;
            }
        }

        console.log(`Game over! Final Phase: ${state.phase}`);
        console.log(`Winner info: ${JSON.stringify(state.winner || {})}`);
        console.log('All rounds played successfully with bots!');

        console.log('SMOKE_BOTS_RESULT ' + JSON.stringify({
            success: true,
            roomId,
            finalPhase: state.phase,
            roundNumber: state.roundNumber,
            winner: state.winner
        }));
    } finally {
        if (human.socket.connected) {
            human.socket.disconnect();
        }
        server.child.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error('SMOKE_BOTS_FATAL', error.stack || error.message);
    process.exitCode = 1;
});
