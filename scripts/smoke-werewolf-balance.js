const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 25000);
const ROOM_SIZE = Number(process.env.SMOKE_WEREWOLF_CASE || 5);
const ROUND_TIME_MINUTES = Number(process.env.SMOKE_ROUND_TIME_MINUTES || 0.25);

// อ้างอิงจำนวนหมาป่าตาม base role plan ของ engine: 3-6 คน = 1 ตัว, 7+ = 2 ตัว
// (assertion จะตรวจ "จำนวนหมาป่า" + "ทุกบทมาจาก pool" ไม่ใช่ set ตายตัว เพราะบทถูกสุ่ม)
const EXPECTED_ROLES = {
    5: ['werewolf', 'seer', 'doctor', 'bodyguard', 'villager'],
    6: ['werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'villager']
};

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

async function waitForOpeningRole(client, roomId) {
    return onceWithTimeout(
        client.socket,
        'werewolfState',
        payload => payload && payload.roomId === roomId && payload.phase === 'night' && payload.playerRole && payload.playerRole.id,
        EVENT_TIMEOUT_MS
    );
}

async function main() {
    const expectedRoles = EXPECTED_ROLES[ROOM_SIZE];
    assert(Array.isArray(expectedRoles), `Unsupported balance smoke case: ${ROOM_SIZE}`);

    const spawnedServer = await spawnServer();
    const clients = Array.from({ length: ROOM_SIZE }, (_, index) => createClient(`player-${index + 1}`, spawnedServer.baseUrl));
    let roomId = null;

    try {
        console.log(`1. Connect ${ROOM_SIZE} clients`);
        for (const client of clients) {
            await connectClient(client);
            console.log(`   - connected ${client.label} ${client.playerId}`);
        }

        const [creator, ...others] = clients;

        console.log(`2. Create ${ROOM_SIZE}-player werewolf balance room`);
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Werewolf Balance ${ROOM_SIZE} ${Date.now()}`,
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

        console.log('4. Start game and capture assigned roles');
        const startResponse = await emitAck(creator.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(startResponse && startResponse.success, 'startGameFromLobby failed');

        const openingStates = await Promise.all(clients.map(client => waitForOpeningRole(client, roomId)));
        const assignedRoles = openingStates.map(state => state.playerRole.id).sort();

        // บทบาทถูกสุ่มจาก pool ที่ตั้ง จึงไม่ตรวจ set ตายตัว แต่ตรวจ invariant ของบาลานซ์แทน:
        const WOLF_ROLE_IDS = ['werewolf', 'alphaWolf'];
        const configuredPool = ['werewolf', 'alphaWolf', 'seer', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'revealer'];
        const validRoleSet = new Set([...configuredPool, 'villager']);
        const expectedWolfCount = expectedRoles.filter(role => WOLF_ROLE_IDS.includes(role)).length;
        const actualWolfCount = assignedRoles.filter(role => WOLF_ROLE_IDS.includes(role)).length;

        assert(assignedRoles.length === ROOM_SIZE, `Expected ${ROOM_SIZE} roles but got ${assignedRoles.length}`);
        assert(actualWolfCount === expectedWolfCount, `Expected ${expectedWolfCount} werewolf-team role(s) but got ${actualWolfCount} (${assignedRoles.join(', ')})`);
        const strayRole = assignedRoles.find(role => !validRoleSet.has(role));
        assert(!strayRole, `Unexpected role outside configured pool: ${strayRole} (${assignedRoles.join(', ')})`);

        const summary = {
            roomId,
            case: ROOM_SIZE,
            roles: assignedRoles,
            wolves: actualWolfCount
        };

        console.log('SMOKE_RESULT ' + JSON.stringify(summary));
    } finally {
        await Promise.all(clients.map(async client => {
            if (client.socket.connected) {
                client.socket.disconnect();
            }
        }));

        if (spawnedServer.child && !spawnedServer.child.killed) {
            spawnedServer.child.kill('SIGTERM');
        }
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});