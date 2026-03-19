const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 25000);
const PHASE_TIMEOUT_MS = Number(process.env.SMOKE_PHASE_TIMEOUT_MS || 30000);
const ROUND_TIME_MINUTES = Number(process.env.SMOKE_ROUND_TIME_MINUTES || 0.25);
const ROOM_SIZE = 7;

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

function findClientByRole(roleMap, roleId) {
    return roleMap[roleId] || null;
}

async function submitNightChoice(client, roomId, actionType, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_submitNightAction', {
        roomId,
        playerId: client.playerId,
        targetPlayerId,
        actionType
    }, EVENT_TIMEOUT_MS);

    assert(response && response.success, `${client.label} night action failed: ${response?.error || 'unknown error'}`);
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

async function submitDiscussionSkip(client, roomId) {
    const response = await emitAck(client.socket, 'werewolf_skipDiscussion', {
        roomId,
        playerId: client.playerId
    }, EVENT_TIMEOUT_MS);

    assert(response && response.success, `${client.label} discussion skip failed: ${response?.error || 'unknown error'}`);
    return response;
}

async function submitConsensusVote(clients, roomId, targetPlayerId) {
    for (const client of clients) {
        const voteTargetId = client.playerId === targetPlayerId ? '__skip__' : targetPlayerId;
        await submitDayVote(client, roomId, voteTargetId);
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

async function requestLatestState(client, roomId) {
    const checkpoint = (client.states || []).length;
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
    return waitForStateAfter(client, checkpoint, payload => payload && payload.roomId === roomId, EVENT_TIMEOUT_MS);
}

function pickDayOneElimination(roleAssignments) {
    const preferredRoles = ['villager', 'seer', 'doctor', 'bodyguard', 'mayor', 'revealer'];
    for (const roleId of preferredRoles) {
        if (roleAssignments[roleId]) {
            return roleAssignments[roleId];
        }
    }
    return null;
}

function pickClientByRoleOrder(roleAssignments, preferredRoles) {
    for (const roleId of preferredRoles) {
        if (roleAssignments[roleId]) {
            return roleAssignments[roleId];
        }
    }

    return null;
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

        console.log('2. Create 7-player werewolf room with full role set');
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Werewolf Smoke ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: ROOM_SIZE,
            roundTime: ROUND_TIME_MINUTES,
            werewolfRoles: ['werewolf', 'alphaWolf', 'seer', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'revealer']
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

        assert(findClientByRole(roleAssignments, 'witch'), '7-player flow did not assign a Witch');
        assert(findClientByRole(roleAssignments, 'fool'), '7-player flow did not assign a Fool');
        assert(findClientByRole(roleAssignments, 'villager'), '7-player flow should include a Villager after rebalance');

        const witchClient = findClientByRole(roleAssignments, 'witch');
        const foolClient = findClientByRole(roleAssignments, 'fool');
        const wolfClients = ['alphaWolf', 'werewolf'].map(roleId => roleAssignments[roleId]).filter(Boolean);
        assert(wolfClients.length === 2, '7-player plan should include 2 wolves');

        console.log('5. Resolve first night with non-lethal actions');
        let checkpoint = createStateCheckpoint(clients);
        for (const client of clients) {
            const state = client.lastState;
            const actions = state?.actionState?.nightActions || [];
            for (const action of actions) {
                if (!action.targets || action.targets.length === 0) {
                    continue;
                }

                const targetId = action.type === 'seer-check'
                    ? foolClient.playerId
                    : '__skip__';
                await submitNightChoice(client, roomId, action.type, targetId);
            }
        }

        await waitForPhaseAfter(clients, roomId, 'day-discussion', checkpoint, null, 30000);

        console.log('6. Discussion 1: everyone skips to open voting early');
        checkpoint = createStateCheckpoint(clients);
        await skipDiscussionForAlive(clients, roomId);
        await waitForPhaseAfter(clients, roomId, 'day-vote', checkpoint, payload => payload.dayNumber === 1, 30000);

        console.log('7. Day 1: vote out a regular villager to keep Witch and Fool alive');
        const dayOneTargetClient = pickDayOneElimination(roleAssignments);
        assert(dayOneTargetClient, 'Could not find a safe Day 1 elimination target');
        assert(dayOneTargetClient.playerId !== witchClient.playerId, 'Day 1 target should not be Witch');
        assert(dayOneTargetClient.playerId !== foolClient.playerId, 'Day 1 target should not be Fool');

        checkpoint = createStateCheckpoint(clients);
        await submitConsensusVote(clients, roomId, dayOneTargetClient.playerId);

        const tallyState = await requestLatestState(creator, roomId);
        const dayOneTargetView = getPlayerView(tallyState, dayOneTargetClient.playerId);
        assert(dayOneTargetView && dayOneTargetView.voteCount >= ROOM_SIZE - 1, 'Live vote tally did not update during day vote');

        await waitForPhaseAfter(clients, roomId, 'night', checkpoint, payload => payload.dayNumber === 2, 30000);

        console.log('8. Night 2: wolves target Fool and Witch spends heal');
        const foolInWolfTargets = wolfClients.some(client => {
            const actions = client.lastState?.actionState?.nightActions || [];
            const killAction = actions.find(action => action.type === 'night-kill');
            return !!killAction && killAction.targets.some(target => target.playerId === foolClient.playerId);
        });
        assert(foolInWolfTargets, 'Fool should remain a targetable bluff target for wolves');

        checkpoint = createStateCheckpoint(clients);
        const firstWolfResponse = await emitAck(wolfClients[0].socket, 'werewolf_submitNightAction', {
            roomId,
            playerId: wolfClients[0].playerId,
            targetPlayerId: foolClient.playerId,
            actionType: null
        }, EVENT_TIMEOUT_MS);
        assert(firstWolfResponse && firstWolfResponse.success, 'Wolf attack on Fool should be accepted and resolved by immunity, not rejected');

        if (wolfClients[1]) {
            const secondWolfResponse = await emitAck(wolfClients[1].socket, 'werewolf_submitNightAction', {
                roomId,
                playerId: wolfClients[1].playerId,
                targetPlayerId: foolClient.playerId,
                actionType: null
            }, EVENT_TIMEOUT_MS);
            assert(secondWolfResponse && secondWolfResponse.success, 'Second wolf failed to confirm Fool attack');
        }

        for (const client of clients) {
            if (wolfClients.includes(client)) {
                continue;
            }

            const state = client.lastState;
            const actions = state?.actionState?.nightActions || [];
            for (const action of actions) {
                let targetId = '__skip__';

                if (client.playerId === witchClient.playerId && action.type === 'witch-heal') {
                    targetId = foolClient.playerId;
                }

                await submitNightChoice(client, roomId, action.type, targetId);
            }
        }

        const dayTwoDiscussionStates = await waitForPhaseAfter(clients, roomId, 'day-discussion', checkpoint, payload => payload.dayNumber === 2, 30000);
        const dayTwoDiscussionState = dayTwoDiscussionStates[0];
        const discussionActions = dayTwoDiscussionState.actionState?.discussionActions || {};
        assert(discussionActions.skipCount === 0, 'Discussion skip count should reset at the start of a new morning');
        assert(discussionActions.totalAlive >= 1, 'Discussion state should report alive players');
        assert(dayTwoDiscussionState.morningAnnouncement && dayTwoDiscussionState.morningAnnouncement.outcomeType === 'immune', 'Night 2 should announce Fool immunity');
        assert(/คนบ้า/.test(dayTwoDiscussionState.morningAnnouncement.detail || ''), 'Morning announcement should explain Fool immunity');
        checkpoint = createStateCheckpoint(clients);
        await skipDiscussionForAlive(clients, roomId);
        const dayTwoStates = await waitForPhaseAfter(clients, roomId, 'day-vote', checkpoint, payload => payload.dayNumber === 2, 30000);
        const dayTwoState = dayTwoStates[0];
        const witchDayTwoState = dayTwoStates.find(state => state.playerRole && state.playerRole.id === 'witch');
        assert(witchDayTwoState && Array.isArray(witchDayTwoState.personalNotes?.roleNotes) && witchDayTwoState.personalNotes.roleNotes.some(note => /ใช้ยาฟื้นไปแล้ว/.test(note)), 'Witch heal usage should be reflected in personal notes');

        console.log('9. Day 2: vote out Doctor to keep Fool for final solo-win test');
        const dayTwoTargetClient = pickClientByRoleOrder(roleAssignments, ['doctor', 'seer', 'bodyguard', 'mayor', 'revealer']);
        assert(dayTwoTargetClient, 'Could not find a safe Day 2 elimination target');
        assert(dayTwoTargetClient.playerId !== foolClient.playerId, 'Day 2 target should not be Fool yet');

        const aliveClients = clients.filter(client => {
            const player = getPlayerView(client.lastState, client.playerId);
            return player && player.alive;
        });

        checkpoint = createStateCheckpoint(clients);
        await submitConsensusVote(aliveClients, roomId, dayTwoTargetClient.playerId);

        await waitForPhaseAfter(clients, roomId, 'night', checkpoint, payload => payload.dayNumber === 3, 30000);

        console.log('10. Night 3: wolves kill Seer, Witch poisons one wolf');
        const nightThreeTargetClient = pickClientByRoleOrder(roleAssignments, ['seer', 'doctor', 'bodyguard', 'mayor', 'revealer']);
        assert(nightThreeTargetClient && getPlayerView(creator.lastState, nightThreeTargetClient.playerId)?.alive, 'Need a living Night 3 target for wolves');
        const poisonWolfClient = wolfClients.find(client => client.playerId !== wolfClients[0].playerId) || wolfClients[0];

        checkpoint = createStateCheckpoint(clients);
        for (const client of wolfClients) {
            const response = await emitAck(client.socket, 'werewolf_submitNightAction', {
                roomId,
                playerId: client.playerId,
                targetPlayerId: nightThreeTargetClient.playerId,
                actionType: null
            }, EVENT_TIMEOUT_MS);
            assert(response && response.success, `${client.label} failed Night 3 attack`);
        }

        for (const client of clients) {
            if (wolfClients.includes(client)) {
                continue;
            }

            const playerView = getPlayerView(client.lastState, client.playerId);
            if (!playerView || !playerView.alive) {
                continue;
            }

            const actions = client.lastState?.actionState?.nightActions || [];
            for (const action of actions) {
                let targetId = '__skip__';

                if (client.playerId === witchClient.playerId && action.type === 'witch-poison') {
                    targetId = poisonWolfClient.playerId;
                }

                await submitNightChoice(client, roomId, action.type, targetId);
            }
        }

        const dayThreeDiscussionStates = await waitForPhaseAfter(clients, roomId, 'day-discussion', checkpoint, payload => payload.dayNumber === 3, 30000);
        checkpoint = createStateCheckpoint(clients);
        await skipDiscussionForAlive(clients, roomId);
        const dayThreeStates = await waitForPhaseAfter(clients, roomId, 'day-vote', checkpoint, payload => payload.dayNumber === 3, 30000);
        const dayThreeState = dayThreeStates[0];
        const deadWolves = (dayThreeState.players || []).filter(player => !player.alive && (player.revealedRole === 'หมาป่า' || player.revealedRole === 'อัลฟ่าหมาป่า'));
        assert(deadWolves.length >= 1, 'Night 3 should leave at least one revealed dead wolf from Witch poison');

        console.log('11. Day 3: vote out Fool and confirm solo win');
        const finalAliveClients = clients.filter(client => {
            const player = getPlayerView(client.lastState, client.playerId);
            return player && player.alive;
        });

        checkpoint = createStateCheckpoint(clients);
        await submitConsensusVote(finalAliveClients, roomId, foolClient.playerId);

        const finishedStates = await waitForPhaseAfter(clients, roomId, 'finished', checkpoint, null, 30000);
        assert(finishedStates.some(state => state.winner === 'fool'), 'Game should end with Fool solo victory');

        const summary = {
            roomId,
            winner: 'fool',
            tested: {
                witch: true,
                discussionPhase: true,
                unanimousDiscussionSkip: true,
                foolImmunity: true,
                foolSoloWin: true,
                liveVoteTallies: true,
                sevenPlayerRolePlan: true
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
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});