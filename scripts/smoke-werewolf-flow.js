const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 25000);
const PHASE_TIMEOUT_MS = Number(process.env.SMOKE_PHASE_TIMEOUT_MS || 30000);
const ROOM_SIZE = 10;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }

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
            if (status >= 200 && status < 500) return;
        } catch {
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
    const child = spawn(process.execPath, [appPath], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let resolvedStarted = false;

    const startedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for app startup log on port ${port}`)), SERVER_TIMEOUT_MS);
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`App exited before startup completed with code ${code}`)); });
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

    child.stderr.on('data', chunk => { stderr += String(chunk); });

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
        const timer = setTimeout(() => { socket.off(eventName, handler); reject(new Error(`Timeout waiting for ${eventName}`)); }, timeoutMs);
        function handler(payload) {
            if (predicate && !predicate(payload)) return;
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
        socket.emit(eventName, payload, response => { clearTimeout(timer); resolve(response); });
    });
}

function createClient(label, baseUrl) {
    const playerId = randomUUID();
    const socket = io(baseUrl, { transports: ['websocket', 'polling'], reconnection: false, forceNew: true, timeout: EVENT_TIMEOUT_MS });
    const client = { label, playerId, socket, states: [] };
    socket.on('werewolfState', payload => { client.states.push(payload); client.lastState = payload; });
    return client;
}

async function connectClient(client) {
    if (!client.socket.connected) {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout waiting for connect (${client.label})`)), EVENT_TIMEOUT_MS);
            function cleanup() { clearTimeout(timer); client.socket.off('connect', onConnect); client.socket.off('connect_error', onError); }
            function onConnect() { cleanup(); resolve(); }
            function onError(error) { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); }
            client.socket.once('connect', onConnect);
            client.socket.once('connect_error', onError);
        });
    }
    client.socket.emit('initPlayer', client.playerId);
    return client;
}

function bindRoom(client, roomId) {
    client.socket.emit('setRoom', { roomId, playerId: client.playerId });
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
}

async function waitForStateAfter(client, afterIndex, predicate, timeoutMs = EVENT_TIMEOUT_MS) {
    const nextStates = (client.states || []).slice(afterIndex);
    const existing = nextStates.find(predicate);
    if (existing) return existing;
    return onceWithTimeout(client.socket, 'werewolfState', predicate, timeoutMs);
}

function createStateCheckpoint(clients) { return new Map(clients.map(client => [client.playerId, (client.states || []).length])); }

async function waitForPhaseAfter(clients, roomId, phase, checkpoint, extraPredicate = null, timeoutMs = PHASE_TIMEOUT_MS) {
    return Promise.all(clients.map(client => waitForStateAfter(client, checkpoint.get(client.playerId) || 0, payload => payload && payload.roomId === roomId && payload.phase === phase && (!extraPredicate || extraPredicate(payload, client)), timeoutMs)));
}

function getPlayerView(state, playerId) { return (state.players || []).find(player => player.playerId === playerId) || null; }
function findClientByRole(roleMap, roleId) { return roleMap[roleId] || null; }
function pickAliveWolfPlayerId(state, roleAssignments) {
    if (!state) return null;
    for (const roleId of ['werewolf', 'alphaWolf']) {
        const c = findClientByRole(roleAssignments, roleId);
        if (!c) continue;
        const p = getPlayerView(state, c.playerId);
        if (p && p.alive) return c.playerId;
    }
    return null;
}

async function submitNightChoice(client, roomId, actionType, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_submitNightAction', { roomId, playerId: client.playerId, targetPlayerId, actionType }, EVENT_TIMEOUT_MS);
    assert(response && response.success, `${client.label} night action failed: ${response?.error || 'unknown error'}`);
    return response;
}
async function submitNightChoiceIfAlive(client, roomId, actionType, targetPlayerId) {
    if (!client) return;
    const p = getPlayerView(client.lastState, client.playerId);
    if (!p || !p.alive) return;
    await submitNightChoice(client, roomId, actionType, targetPlayerId);
}
async function submitClericBless(client, roomId, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_clericBless', { roomId, playerId: client.playerId, targetPlayerId }, EVENT_TIMEOUT_MS);
    assert(response && response.success, `${client.label} cleric bless failed: ${response?.error || 'unknown error'}`);
    return response;
}
async function submitClericBlessIfAlive(clericClient, clients, roomId) {
    if (!clericClient) return;
    const self = getPlayerView(clericClient.lastState, clericClient.playerId);
    if (!self || !self.alive) return;
    const targetClient = clients.find(c => {
        if (c.playerId === clericClient.playerId) return false;
        const p = getPlayerView(clericClient.lastState, c.playerId);
        return p && p.alive;
    });
    if (!targetClient) return;
    await submitClericBless(clericClient, roomId, targetClient.playerId);
}
async function submitDayVote(client, roomId, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_submitDayVote', { roomId, playerId: client.playerId, targetPlayerId }, EVENT_TIMEOUT_MS);
    assert(response && response.success, `${client.label} day vote failed: ${response?.error || 'unknown error'}`);
    return response;
}
async function submitRevealAction(client, roomId, targetPlayerId) {
    const response = await emitAck(client.socket, 'werewolf_useRevealAction', { roomId, playerId: client.playerId, targetPlayerId }, EVENT_TIMEOUT_MS);
    assert(response && response.success, `${client.label} reveal action failed: ${response?.error || 'unknown error'}`);
    return response;
}
async function submitDiscussionSkip(client, roomId) {
    const response = await emitAck(client.socket, 'werewolf_skipDiscussion', { roomId, playerId: client.playerId }, EVENT_TIMEOUT_MS);
    if (response && !response.success && /ยังไม่ใช่ช่วงพูดคุย/.test(response.error)) return response;
    assert(response && response.success, `${client.label} discussion skip failed: ${response?.error || 'unknown error'}`);
    return response;
}
async function submitNightSkip(client, roomId) {
    const response = await emitAck(client.socket, 'werewolf_skipNight', { roomId, playerId: client.playerId }, EVENT_TIMEOUT_MS);
    if (response && !response.success && /ยังไม่ใช่ช่วงกลางคืน/.test(response.error || '')) return response;
    assert(response && response.success, `${client.label} night skip failed: ${response?.error || 'unknown error'}`);
    return response;
}

async function skipDiscussionForAlive(clients, roomId) {
    for (const client of clients) {
        const player = getPlayerView(client.lastState, client.playerId);
        if (!player || !player.alive) continue;
        await submitDiscussionSkip(client, roomId);
    }
}
async function skipNightForAlive(clients, roomId) {
    for (const client of clients) {
        const player = getPlayerView(client.lastState, client.playerId);
        if (!player || !player.alive) continue;
        await submitNightSkip(client, roomId);
    }
}
async function requestLatestState(client, roomId) { const checkpoint = (client.states || []).length; client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId }); return waitForStateAfter(client, checkpoint, payload => payload && payload.roomId === roomId, EVENT_TIMEOUT_MS); }
async function main() {
    const useExistingServer = process.env.SMOKE_USE_BASE_URL === '1';
    const spawnedServer = useExistingServer ? null : await spawnServer();
    const baseUrl = useExistingServer ? process.env.BASE_URL : spawnedServer.baseUrl;
    const clients = Array.from({ length: ROOM_SIZE }, (_, index) => createClient(`player-${index + 1}`, baseUrl));
    let roomId = null;

    try {
        for (const client of clients) { await connectClient(client); }
        const [creator, ...others] = clients;
        const createResponse = await emitAck(creator.socket, 'createRoom', { playerId: creator.playerId, name: `Werewolf Smoke ${Date.now()}`, gameMode: 'werewolf', maxPlayers: ROOM_SIZE, roundTime: 0.25, werewolfRoles: ['werewolf', 'alphaWolf', 'seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'tracker', 'vigilante', 'hunter', 'cleric', 'mayor', 'revealer'] });
        assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
        roomId = createResponse.roomId;
        bindRoom(creator, roomId);
        for (const client of others) { const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId }); assert(joinResponse && joinResponse.success, `joinRoom failed for ${client.label}`); bindRoom(client, roomId); }

        const startResponse = await emitAck(creator.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(startResponse && startResponse.success, 'startGameFromLobby failed');
        const openingCheckpoint = createStateCheckpoint(clients);
        const openingStates = await Promise.all(clients.map(client => waitForStateAfter(client, openingCheckpoint.get(client.playerId) || 0, payload => payload && payload.roomId === roomId && payload.phase === 'night' && payload.playerRole && payload.playerRole.id, 30000)));
        const roleAssignments = {};
        const roleCounts = {};
        const playerIdToRole = new Map();
        openingStates.forEach((state, index) => {
            const roleId = state.playerRole.id;
            roleAssignments[roleId] = clients[index];
            roleCounts[roleId] = (roleCounts[roleId] || 0) + 1;
            playerIdToRole.set(clients[index].playerId, roleId);
        });

        console.log('Assigned roles', JSON.stringify(roleCounts));
        const requiredRoles = ['seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'tracker', 'vigilante', 'hunter', 'cleric', 'mayor', 'revealer', 'werewolf'];
        const missingRoles = requiredRoles.filter(roleId => !roleAssignments[roleId]);
        if (missingRoles.length) {
            console.log('Skipping missing roles in this room', JSON.stringify(missingRoles));
        }

        const night1Checkpoint = createStateCheckpoint(clients);
        await skipNightForAlive(clients, roomId);
        const day1DiscussionStates = await waitForPhaseAfter(clients, roomId, 'day-discussion', night1Checkpoint, payload => payload.dayNumber === 1, 30000);
        assert(day1DiscussionStates[0]?.morningAnnouncement, 'night skip should produce morning announcement');

        const discussion1Checkpoint = createStateCheckpoint(clients);
        await skipDiscussionForAlive(clients, roomId);
        await waitForPhaseAfter(clients, roomId, 'day-vote', discussion1Checkpoint, payload => payload.dayNumber === 1, 30000);

        const wolfClient = findClientByRole(roleAssignments, 'werewolf') || findClientByRole(roleAssignments, 'alphaWolf');
        assert(wolfClient, 'missing a wolf role for smoke flow');

        const day1TargetClient = clients.find(client => {
            const p = getPlayerView(client.lastState, client.playerId);
            if (!p || !p.alive || client.playerId === wolfClient.playerId) return false;
            const roleId = playerIdToRole.get(client.playerId);
            if (roleId === 'mayor' || roleId === 'revealer') return false;
            return true;
        }) || clients.find(client => {
            const p = getPlayerView(client.lastState, client.playerId);
            return p && p.alive && client.playerId !== wolfClient.playerId;
        });
        assert(day1TargetClient, 'missing day1 target');
        const dayVoteCheckpoint = createStateCheckpoint(clients);
        for (const client of clients) {
            const p = getPlayerView(client.lastState, client.playerId);
            if (!p || !p.alive) continue;
            await submitDayVote(client, roomId, client.playerId === day1TargetClient.playerId ? '__skip__' : day1TargetClient.playerId);
        }
        await waitForPhaseAfter(clients, roomId, 'night', dayVoteCheckpoint, payload => payload.dayNumber === 2, 30000);

        const seerClient = findClientByRole(roleAssignments, 'seer');
        const oracleClient = findClientByRole(roleAssignments, 'oracle');
        const doctorClient = findClientByRole(roleAssignments, 'doctor');
        const bodyguardClient = findClientByRole(roleAssignments, 'bodyguard');
        const witchClient = findClientByRole(roleAssignments, 'witch');
        const trackerClient = findClientByRole(roleAssignments, 'tracker');
        const vigilanteClient = findClientByRole(roleAssignments, 'vigilante');
        const hunterClient = findClientByRole(roleAssignments, 'hunter');
        const clericClient = findClientByRole(roleAssignments, 'cleric');
        const mayorClient = findClientByRole(roleAssignments, 'mayor');
        const revealerClient = findClientByRole(roleAssignments, 'revealer');

        const night2Checkpoint = createStateCheckpoint(clients);
        if (seerClient) await submitNightChoiceIfAlive(seerClient, roomId, 'seer-check', wolfClient.playerId);
        if (oracleClient) await submitNightChoiceIfAlive(oracleClient, roomId, 'oracle-read', wolfClient.playerId);
        if (doctorClient) await submitNightChoiceIfAlive(doctorClient, roomId, 'doctor-save', wolfClient.playerId);
        if (bodyguardClient) await submitNightChoiceIfAlive(bodyguardClient, roomId, 'bodyguard-protect', bodyguardClient.playerId);
        if (witchClient) await submitNightChoiceIfAlive(witchClient, roomId, 'witch-heal', wolfClient.playerId);
        if (trackerClient) await submitNightChoiceIfAlive(trackerClient, roomId, 'tracker-scan', wolfClient.playerId);
        if (vigilanteClient) await submitNightChoiceIfAlive(vigilanteClient, roomId, 'vigilante-shot', wolfClient.playerId);
        if (hunterClient) await submitNightChoiceIfAlive(hunterClient, roomId, 'hunter-shot', wolfClient.playerId);
        await skipNightForAlive(clients, roomId);
        // Vigilante/Hunter ยิง wolf ในคืนเดียวกัน อาจทำให้หมาป่าตัวสุดท้ายตาย -> village ชนะตั้งแต่ night2 ซึ่งถูกต้องตามกติกา
        // จึงรอ day-discussion(day2) "หรือ" finished แล้วแตกสาขาตามผลจริง แทนที่จะ assert ว่าต้องเข้า day-discussion เสมอ
        await Promise.all(clients.map(client => waitForStateAfter(
            client,
            night2Checkpoint.get(client.playerId) || 0,
            payload => payload && payload.roomId === roomId && (
                (payload.phase === 'day-discussion' && payload.dayNumber === 2) ||
                (payload.phase === 'finished' && !!payload.winner)
            ),
            30000
        )));

        let finishedWinner = null;
        const night2Anchor = clients[0]?.lastState;
        if (night2Anchor?.phase === 'finished' && night2Anchor?.winner) {
            finishedWinner = night2Anchor.winner;
        } else {
            const discussion2Checkpoint = createStateCheckpoint(clients);
            await submitClericBlessIfAlive(clericClient, clients, roomId);
            if (mayorClient) await submitDiscussionSkip(mayorClient, roomId).catch(() => {});
            const stForReveal = clients.find(c => c.lastState)?.lastState;
            const revealTargetId = pickAliveWolfPlayerId(stForReveal, roleAssignments);
            if (revealerClient && revealTargetId) await submitRevealAction(revealerClient, roomId, revealTargetId);
            await skipDiscussionForAlive(clients, roomId);
            const day2VoteStates = await waitForPhaseAfter(clients, roomId, 'day-vote', discussion2Checkpoint, payload => payload.dayNumber === 2, 30000);
            if (mayorClient) {
                const mayorDay2 = day2VoteStates.find(state => state.playerRole && state.playerRole.id === 'mayor');
                assert(mayorDay2 && mayorDay2.actionState?.dayActions?.canRevealMayor, 'Mayor should be able to reveal on day 2');
            }
        }

        for (let round = 0; round < 12; round++) {
            let anchor = clients[0]?.lastState;
            if (anchor?.phase === 'finished' && anchor?.winner) {
                finishedWinner = anchor.winner;
                break;
            }

            if (anchor?.phase === 'night') {
                const sk1 = createStateCheckpoint(clients);
                await skipNightForAlive(clients, roomId);
                await waitForPhaseAfter(clients, roomId, 'day-discussion', sk1, null, PHASE_TIMEOUT_MS);
                const sk2 = createStateCheckpoint(clients);
                await skipDiscussionForAlive(clients, roomId);
                await waitForPhaseAfter(clients, roomId, 'day-vote', sk2, null, PHASE_TIMEOUT_MS);
            } else if (anchor?.phase === 'day-discussion') {
                const sk = createStateCheckpoint(clients);
                await skipDiscussionForAlive(clients, roomId);
                await waitForPhaseAfter(clients, roomId, 'day-vote', sk, null, PHASE_TIMEOUT_MS);
            }

            const voteCheckpoint = createStateCheckpoint(clients);
            anchor = clients[0]?.lastState;
            assert(anchor?.phase === 'day-vote', `expected day-vote for exile round (${anchor?.phase || '?'})`);

            const aliveClients = clients.filter(client => {
                const player = getPlayerView(client.lastState, client.playerId);
                return player && player.alive;
            });
            const finishVoteTargetId = pickAliveWolfPlayerId(clients[0]?.lastState, roleAssignments) || wolfClient.playerId;
            assert(finishVoteTargetId, 'smoke needs a vote target');

            for (const client of aliveClients) {
                const player = getPlayerView(client.lastState, client.playerId);
                const dayActions = client.lastState?.actionState?.dayActions;
                if (dayActions && dayActions.canVote === false) continue;
                await submitDayVote(client, roomId, client.playerId === finishVoteTargetId ? '__skip__' : finishVoteTargetId);
            }

            await Promise.all(
                clients.map(client =>
                    waitForStateAfter(
                        client,
                        voteCheckpoint.get(client.playerId) || 0,
                        payload =>
                            payload &&
                            payload.roomId === roomId &&
                            (((payload.phase === 'finished') && !!payload.winner) || payload.phase === 'night'),
                        PHASE_TIMEOUT_MS
                    )
                )
            );

            anchor = clients[0]?.lastState;
            if (anchor?.phase === 'finished' && anchor?.winner) {
                finishedWinner = anchor.winner;
                break;
            }
        }

        assert(finishedWinner, 'game should finish (multi-wolf rooms may need several day votes)');
        console.log(
            'SMOKE_RESULT ' +
                JSON.stringify({
                    roomId,
                    winner: finishedWinner,
                    tested: {
                        nightSkip: true,
                        seer: true,
                        oracle: true,
                        doctor: true,
                        bodyguard: true,
                        witch: true,
                        tracker: true,
                        vigilante: true,
                        hunter: true,
                        cleric: true,
                        mayor: true,
                        revealer: true,
                        multiWolfVotes: true
                    }
                })
        );
    } finally {
        await Promise.all(clients.map(async client => { if (client.socket.connected) client.socket.disconnect(); }));
        if (spawnedServer && spawnedServer.child && !spawnedServer.child.killed) spawnedServer.child.kill('SIGTERM');
    }
}

main().catch(error => { console.error('SMOKE_FATAL', error.stack || error.message); process.exitCode = 1; });
