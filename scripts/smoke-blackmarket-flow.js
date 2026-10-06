require('./isolateTestData');
// หัวห้องข้ามคนที่ยังไม่เลือกได้หลังพ้นเวลากัน — เทสย่อเหลือ 4 วิ (ของจริง 15 วิ)
process.env.BLACKMARKET_FORCE_ADVANCE_MIN_MS = process.env.BLACKMARKET_FORCE_ADVANCE_MIN_MS || '4000';
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
    const port = Number(process.env.SMOKE_PORT) || await getFreePort();
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

        // bug 4: restart mid-game must be refused
        const restartMidGame = await emitAck(creator.socket, 'blackmarket_restartGame', { roomId });
        assert(restartMidGame && restartMidGame.success === false, 'restart during an active game must be refused');

        // bug 2: other players' cash/heat/inventory are hidden
        {
            const view = creator.lastState;
            const others = (view.players || []).filter(player => !player.isSelf);
            assert(others.length === 3 && others.every(player => player.cash === null && player.heat === null && player.inventoryCount === null),
                'opponent cash/heat/inventory must be hidden in client state');
            assert(typeof view.self.cash === 'number', 'self cash visible');
        }

        // UX: เปลี่ยนใจก่อนเฉลย + หัวห้องข้ามคนที่ยังไม่เลือก (มีเวลากันกดเร็ว)
        {
            const others = clients.slice(1);
            let mark = creator.states.length;
            const passAck = await emitAck(creator.socket, 'blackmarket_buyOffer', { roomId, playerId: creator.playerId, itemId: creator.lastState.passChoice });
            assert(passAck && passAck.success, 'creator pass should succeed');
            const lockedState = await waitForStateAfter(creator, mark,
                payload => payload && payload.lockProgress && payload.lockProgress.locked === 1, 5000);
            assert(lockedState.lockProgress && Array.isArray(lockedState.lockProgress.waitingOn), 'lockProgress.waitingOn should list who is still choosing');
            assert(lockedState.lockProgress.waitingOn.length === 3 && !lockedState.lockProgress.waitingOn.some(entry => entry.playerId === creator.playerId),
                'waitingOn should name the 3 players who have not chosen yet');
            const staleUndo = await emitAck(creator.socket, 'blackmarket_cancelChoice', { roomId, phase: 'action', roundNumber: 1 });
            assert(staleUndo && staleUndo.success === false, 'cancel for a phase that is not current must be refused');
            mark = creator.states.length;
            const undoAck = await emitAck(creator.socket, 'blackmarket_cancelChoice', { roomId, phase: 'market', roundNumber: 1 });
            assert(undoAck && undoAck.success, 'cancelChoice should succeed before the market resolves: ' + JSON.stringify(undoAck));
            const undone = await waitForStateAfter(creator, mark,
                payload => payload && payload.phase === 'market' && !payload.self.pendingMarketChoice, 5000);
            assert(undone.lockProgress.locked === 0, 'lock count drops after undo');
            const guestSkip = await emitAck(others[0].socket, 'blackmarket_forceAdvance', { roomId });
            assert(guestSkip && guestSkip.success === false, 'non-host must not force-advance');
            const earlySkip = await emitAck(creator.socket, 'blackmarket_forceAdvance', { roomId });
            assert(earlySkip && earlySkip.success === false && /วินาที/.test(earlySkip.error || ''), 'host skip right at phase start must be refused with a wait hint');
        }

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

        // bug 6: the last player disconnects instead of acting — the rest must not wait for the timer
        const stayers = clients.slice(0, -1);
        const leaver = clients[clients.length - 1];
        const actionCheckpoint = checkpointStates(clients);
        for (const client of stayers) {
            const state = client.lastState;
            const actionPayload = chooseActionPayload(state);
            const response = await emitAck(client.socket, 'blackmarket_submitAction', {
                roomId,
                playerId: client.playerId,
                ...actionPayload
            });
            assert(response && response.success, `action submit failed for ${client.label}`);
        }
        leaver.socket.disconnect();

        const nextStates = await Promise.all(stayers.map(client => waitForStateAfter(
            client,
            actionCheckpoint.get(client.playerId) || 0,
            payload => payload && payload.roomId === roomId && ['market', 'finished'].includes(payload.phase),
            8000
        )));

        assert(nextStates.every(state => ['market', 'finished'].includes(state.phase)), 'room did not resolve the first action round');
        assert(nextStates.some(state => Number(state.roundNumber || 0) >= 2 || state.phase === 'finished'), 'game did not move past the first round');

        // UX: ผลยกที่แล้ว (รวมโน้ตลับ) ต้องยังอยู่ระหว่างตลาดยกถัดไป
        const marketRound2 = nextStates.find(state => state.phase === 'market');
        if (marketRound2) {
            assert(marketRound2.actionReport && marketRound2.actionReport.roundNumber === 1 && marketRound2.actionReport.entries.length > 0,
                'actionReport for round 1 should be visible during round 2 market');
            // หัวห้องข้ามคนที่ยังไม่เลือก หลังพ้นเวลากัน (เทสตั้งไว้ 4 วิ)
            await delay(4200);
            const skipCheckpoint = checkpointStates(stayers);
            const skipAck = await emitAck(creator.socket, 'blackmarket_forceAdvance', { roomId, phase: 'market', roundNumber: marketRound2.roundNumber });
            assert(skipAck && skipAck.success, 'host force-advance should succeed after the guard time: ' + JSON.stringify(skipAck));
            const afterSkip = await waitForStateAfter(creator, skipCheckpoint.get(creator.playerId) || 0,
                payload => payload && payload.roomId === roomId && payload.phase === 'action', 5000);
            assert(afterSkip.phase === 'action', 'force-advance moves market to action');
            assert(afterSkip.actionReport && afterSkip.actionReport.roundNumber === 1, 'round-1 action report still available in round-2 action phase');
        }

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