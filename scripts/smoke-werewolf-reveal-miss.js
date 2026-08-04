require('./isolateTestData');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 25000);
const PHASE_TIMEOUT_MS = Number(process.env.SMOKE_PHASE_TIMEOUT_MS || 30000);
const ROUND_TIME_MINUTES = Number(process.env.SMOKE_ROUND_TIME_MINUTES || 0.25);
const ROOM_SIZE = 3;

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

async function waitForStateAfter(client, afterIndex, predicate, timeoutMs = EVENT_TIMEOUT_MS) {
    const nextStates = (client.states || []).slice(afterIndex);
    const existing = nextStates.find(predicate);
    if (existing) {
        return existing;
    }

    return onceWithTimeout(client.socket, 'werewolfState', predicate, timeoutMs);
}

function createStateCheckpoint(clients) {
    return new Map(clients.map(client => [client.playerId, (client.states || []).length]));
}

async function waitForPhaseAfter(clients, roomId, phase, checkpoint, extraPredicate = null, timeoutMs = PHASE_TIMEOUT_MS) {
    return Promise.all(clients.map(client => waitForStateAfter(
        client,
        checkpoint.get(client.playerId) || 0,
        payload => payload
            && payload.roomId === roomId
            && payload.phase === phase
            && (!extraPredicate || extraPredicate(payload, client)),
        timeoutMs
    )));
}

function getPlayerView(state, playerId) {
    return (state.players || []).find(player => player.playerId === playerId) || null;
}

async function submitDiscussionSkip(client, roomId) {
    const response = await emitAck(client.socket, 'werewolf_skipDiscussion', {
        roomId,
        playerId: client.playerId
    }, EVENT_TIMEOUT_MS);

    if (response && !response.success && /ยังไม่ใช่ช่วงพูดคุย/.test(response.error || '')) {
        return response;
    }

    assert(response && response.success, `${client.label} discussion skip failed: ${response?.error || 'unknown error'}`);
    return response;
}

async function submitNightSkip(client, roomId) {
    const response = await emitAck(client.socket, 'werewolf_skipNight', {
        roomId,
        playerId: client.playerId
    }, EVENT_TIMEOUT_MS);

    if (response && !response.success && /ยังไม่ใช่ช่วงกลางคืน/.test(response.error || '')) {
        return response;
    }

    assert(response && response.success, `${client.label} night skip failed: ${response?.error || 'unknown error'}`);
    return response;
}

async function submitDayVote(client, roomId, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_submitDayVote', {
        roomId,
        playerId: client.playerId,
        targetPlayerId
    }, EVENT_TIMEOUT_MS);

    assert(response && response.success, `${client.label} day vote failed: ${response?.error || 'unknown error'}`);
    return response;
}

async function submitRevealAction(client, roomId, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_useRevealAction', {
        roomId,
        playerId: client.playerId,
        targetPlayerId
    }, EVENT_TIMEOUT_MS);

    assert(response && response.success, `${client.label} reveal action failed: ${response?.error || 'unknown error'}`);
    return response;
}

async function skipNightForAlive(clients, roomId) {
    for (const client of clients) {
        const player = getPlayerView(client.lastState, client.playerId);
        if (!player || !player.alive) {
            continue;
        }
        await submitNightSkip(client, roomId);
    }
}

async function skipDiscussionForAlive(clients, roomId) {
    for (const client of clients) {
        const player = getPlayerView(client.lastState, client.playerId);
        if (!player || !player.alive) {
            continue;
        }
        await submitDiscussionSkip(client, roomId);
    }
}

async function main() {
    const useExistingServer = process.env.SMOKE_USE_BASE_URL === '1';
    const spawnedServer = useExistingServer ? null : await spawnServer();
    const baseUrl = useExistingServer ? process.env.BASE_URL : spawnedServer.baseUrl;
    const clients = Array.from({ length: ROOM_SIZE }, (_, index) => createClient(`player-${index + 1}`, baseUrl));
    let roomId = null;

    try {
        console.log(`1. Connect ${ROOM_SIZE} clients`);
        for (const client of clients) {
            await connectClient(client);
            console.log(`   - connected ${client.label} ${client.playerId}`);
        }

        const [creator, ...others] = clients;

        console.log('2. Create 3-player werewolf room for reveal-miss ending');
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Werewolf Reveal Miss ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: ROOM_SIZE,
            roundTime: ROUND_TIME_MINUTES,
            werewolfRoles: ['werewolf', 'revealer', 'mayor']
        });
        assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
        roomId = createResponse.roomId;
        bindRoom(creator, roomId);

        console.log('3. Join remaining players');
        for (const client of others) {
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joinResponse && joinResponse.success, `joinRoom failed for ${client.label}`);
            bindRoom(client, roomId);
        }

        console.log('4. Start werewolf game');
        const startResponse = await emitAck(creator.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(startResponse && startResponse.success, 'startGameFromLobby failed');

        const openingCheckpoint = createStateCheckpoint(clients);
        const openingStates = await Promise.all(clients.map(client => waitForStateAfter(
            client,
            openingCheckpoint.get(client.playerId) || 0,
            payload => payload && payload.roomId === roomId && payload.phase === 'night' && payload.playerRole && payload.playerRole.id,
            30000
        )));

        const roleAssignments = {};
        openingStates.forEach((state, index) => {
            roleAssignments[state.playerRole.id] = clients[index];
        });

        const werewolfClient = roleAssignments.werewolf;
        const revealerClient = roleAssignments.revealer;
        const mayorClient = roleAssignments.mayor;

        assert(werewolfClient, '3-player reveal-miss flow did not assign a Werewolf');
        assert(revealerClient, '3-player reveal-miss flow did not assign a Revealer');
        assert(mayorClient, '3-player reveal-miss flow did not assign a Mayor');

        console.log('5. First night: let the table explicitly skip to morning');
        let checkpoint = createStateCheckpoint(clients);
        await skipNightForAlive(clients, roomId);
        await waitForPhaseAfter(clients, roomId, 'day-discussion', checkpoint, payload => payload.dayNumber === 1, 30000);

        console.log('6. Discussion: everyone skips straight to vote');
        checkpoint = createStateCheckpoint(clients);
        await skipDiscussionForAlive(clients, roomId);
        await waitForPhaseAfter(clients, roomId, 'day-vote', checkpoint, payload => payload.dayNumber === 1, 30000);

        console.log('7. Day vote: Revealer locks the wrong target and dies at day-end');
        checkpoint = createStateCheckpoint(clients);
        const revealResponse = await submitRevealAction(revealerClient, roomId, mayorClient.playerId);
        assert(revealResponse && revealResponse.queued, 'Reveal miss flow should queue the reveal target');

        const queuedRevealState = revealerClient.lastState;
        assert(queuedRevealState?.actionState?.dayActions?.pendingRevealTargetId === mayorClient.playerId, 'Queued reveal target should be visible before resolution');

        await submitDayVote(mayorClient, roomId, werewolfClient.playerId);
        await submitDayVote(werewolfClient, roomId, mayorClient.playerId);

        const finishedStates = await waitForPhaseAfter(clients, roomId, 'finished', checkpoint, null, 30000);
        assert(finishedStates.some(state => state.winner === 'werewolf'), 'Reveal miss endgame should hand victory to the werewolf team');
        assert(finishedStates.some(state => state.dayResolutionAnnouncement?.outcomeType === 'reveal-miss'), 'Final announcement should report a reveal-miss');
        assert(finishedStates.some(state => /ล้มลงแทน|พลาด/.test(state.dayResolutionAnnouncement?.detail || '')), 'Reveal miss announcement should explain why the revealer died');

        const summary = {
            roomId,
            winner: 'werewolf',
            tested: {
                revealMissQueued: true,
                revealMissEndgame: true,
                revealMissAnnouncement: true
            }
        };

        console.log('SMOKE_RESULT ' + JSON.stringify(summary));
    } finally {
        await Promise.all(clients.map(async client => {
            if (client.socket.connected) {
                client.socket.disconnect();
            }
        }));

        if (spawnedServer && spawnedServer.child && !spawnedServer.child.killed) {
            spawnedServer.child.kill('SIGTERM');
        }
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
});