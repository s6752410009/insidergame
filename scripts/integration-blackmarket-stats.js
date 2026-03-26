const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const STATS_FILE = path.join(__dirname, '..', 'data', 'playerStats.json');
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
const ADMIN_PASSWORD = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).adminPassword || 'admin123';

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

function requestJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                raw += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(raw || '{}'));
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
    });
}

function httpRequest(baseUrl, requestPath, options = {}, body = '') {
    const url = new URL(requestPath, baseUrl);
    return new Promise((resolve, reject) => {
        const req = http.request(url, {
            method: options.method || 'GET',
            headers: options.headers || {}
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                raw += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode || 0,
                    headers: res.headers,
                    body: raw
                });
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

async function loginAdminAndGetToken(baseUrl) {
    const loginBody = `password=${encodeURIComponent(ADMIN_PASSWORD)}`;
    const loginResponse = await httpRequest(baseUrl, '/admin/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(loginBody)
        }
    }, loginBody);

    assert(loginResponse.statusCode === 302, 'admin login did not redirect');
    const rawCookies = loginResponse.headers['set-cookie'] || [];
    const cookieHeader = rawCookies.map(cookie => String(cookie).split(';')[0]).join('; ');
    assert(cookieHeader, 'admin login did not return session cookie');

    const dashboardResponse = await httpRequest(baseUrl, '/admin', {
        headers: {
            Cookie: cookieHeader
        }
    });
    assert(dashboardResponse.statusCode === 200, 'admin dashboard not reachable after login');
    assert(dashboardResponse.body.includes('Black Market'), 'admin html missing Black Market text');
    assert(dashboardResponse.body.includes('🎩 Black Market') || dashboardResponse.body.includes('Black Market ${blackmarket.games'), 'admin html missing Black Market badge/render text');

    const tokenMatch = dashboardResponse.body.match(/const adminToken = '([^']+)'/);
    assert(tokenMatch && tokenMatch[1], 'admin token not found in dashboard html');

    return {
        adminToken: tokenMatch[1],
        cookieHeader,
        dashboardHtml: dashboardResponse.body
    };
}

async function fetchAdminStats(baseUrl) {
    const { adminToken, dashboardHtml } = await loginAdminAndGetToken(baseUrl);
    const adminSocket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
        forceNew: true,
        timeout: EVENT_TIMEOUT_MS,
        autoConnect: false
    });

    try {
        adminSocket.connect();
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout waiting for admin socket connect')), EVENT_TIMEOUT_MS);
            adminSocket.once('connect', () => {
                clearTimeout(timer);
                resolve();
            });
            adminSocket.once('connect_error', error => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });

        const authResponse = await emitAck(adminSocket, 'admin_authenticate', { token: adminToken });
        assert(authResponse && authResponse.success, 'admin socket authentication failed');

        const adminData = await emitAckNoPayload(adminSocket, 'admin_getData');
        assert(adminData && adminData.success, 'admin_getData failed');
        return { adminData, dashboardHtml };
    } finally {
        if (adminSocket.connected) {
            adminSocket.disconnect();
        }
    }
}

async function fetchRoomsPageHtml(baseUrl) {
    const browserPlayerId = randomUUID();
    const roomsResponse = await httpRequest(baseUrl, `/rooms?playerId=${encodeURIComponent(browserPlayerId)}`);
    assert(roomsResponse.statusCode === 200, 'rooms page did not render');
    assert(roomsResponse.body.includes('Black Market'), 'rooms html missing Black Market text');
    assert(roomsResponse.body.includes('🎩 แนะนำตอนนี้'), 'rooms html missing Black Market featured badge');
    assert(roomsResponse.body.includes('modeQuickPickGrid'), 'rooms html missing mode quick pick render block');
    return roomsResponse.body;
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

function emitAckNoPayload(socket, eventName, timeoutMs = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${eventName}`)), timeoutMs);
        socket.emit(eventName, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function createClient(label, baseUrl, seatIndex) {
    const playerId = randomUUID();
    const socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
        forceNew: true,
        timeout: EVENT_TIMEOUT_MS,
        autoConnect: false
    });

    const client = {
        label,
        seatIndex,
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

async function waitForPhases(clients, roomId, phases, checkpoint) {
    return Promise.all(clients.map(client => waitForStateAfter(
        client,
        checkpoint.get(client.playerId) || 0,
        payload => payload && payload.roomId === roomId && phases.includes(payload.phase),
        EVENT_TIMEOUT_MS
    )));
}

function snapshotFiles(filePaths) {
    return filePaths.map(filePath => ({
        filePath,
        exists: fs.existsSync(filePath),
        content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
    }));
}

function restoreFiles(snapshot) {
    snapshot.forEach(entry => {
        if (entry.exists) {
            fs.writeFileSync(entry.filePath, entry.content, 'utf8');
            return;
        }

        if (fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
        }
    });
}

async function stopServer(server) {
    if (!server || !server.child) {
        return;
    }

    await new Promise(resolve => {
        server.child.once('exit', () => resolve());
        server.child.kill('SIGTERM');
        setTimeout(() => resolve(), 4000);
    });
}

function chooseActionPayload(client, clients) {
    const state = client.lastState || {};
    const self = state.self || {};
    const targets = (state.players || []).filter(player => player.alive && !player.isSelf);
    const cargoItems = state.actionHelp?.cargoItems || [];
    const roundNumber = Number(state.roundNumber || 0);

    const creator = clients.find(candidate => candidate.seatIndex === 0);
    const partner = clients.find(candidate => candidate.seatIndex === 1);
    const betrayer = clients.find(candidate => candidate.seatIndex === 2);

    if (roundNumber === 1 && creator && partner && client.playerId === creator.playerId) {
        const target = targets.find(player => player.playerId === partner.playerId);
        if (target) {
            return { actionType: 'deal', targetPlayerId: target.playerId };
        }
    }

    if (roundNumber === 1 && creator && partner && client.playerId === partner.playerId) {
        const target = targets.find(player => player.playerId === creator.playerId);
        if (target) {
            return { actionType: 'deal', targetPlayerId: target.playerId };
        }
    }

    if (roundNumber === 2 && creator && betrayer && client.playerId === creator.playerId) {
        const target = targets.find(player => player.playerId === betrayer.playerId);
        if (target) {
            return { actionType: 'deal', targetPlayerId: target.playerId };
        }
    }

    if (roundNumber === 2 && creator && betrayer && client.playerId === betrayer.playerId) {
        const target = targets.find(player => player.playerId === creator.playerId);
        if (target) {
            return { actionType: 'betray', targetPlayerId: target.playerId };
        }
    }

    if (cargoItems.length > 0) {
        return { actionType: 'deliver', itemId: cargoItems[0].id };
    }

    if (state.actionHelp?.canHit && targets.length > 0) {
        return { actionType: 'hit', targetPlayerId: targets[0].playerId };
    }

    if (targets.length > 0 && self.heat <= 1) {
        return { actionType: 'intel', targetPlayerId: targets[0].playerId };
    }

    if (self.heat > 0) {
        return { actionType: 'laylow' };
    }

    return { actionType: 'guard' };
}

function readStatsFile() {
    if (!fs.existsSync(STATS_FILE)) {
        return {};
    }

    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8') || '{}');
}

async function main() {
    const backup = snapshotFiles([PLAYERS_FILE, STATS_FILE]);
    let server = null;
    const clients = [];

    try {
        server = await spawnServer();

        clients.push(
            createClient('boss-seat', server.baseUrl, 0),
            createClient('market-seat', server.baseUrl, 1),
            createClient('street-seat', server.baseUrl, 2),
            createClient('shadow-seat', server.baseUrl, 3)
        );

        for (const client of clients) {
            client.socket.connect();
            await connectClient(client);
        }

        const [creator, ...others] = clients;
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Black Market Finish ${Date.now()}`,
            gameMode: 'blackmarket',
            maxPlayers: 7,
            roundTime: 1
        });
        assert(createResponse && createResponse.success && createResponse.roomId, 'createRoom failed');
        const roomId = createResponse.roomId;
        bindRoom(creator, roomId);

        const lobbyResponse = await httpRequest(server.baseUrl, `/room/${roomId}?playerId=${encodeURIComponent(creator.playerId)}`);
        assert(lobbyResponse.statusCode === 200, 'room lobby not reachable after createRoom');
        assert(lobbyResponse.body.includes('Black Market'), 'room lobby html missing Black Market label after createRoom');
        assert(lobbyResponse.body.includes('data-game-mode="blackmarket"'), 'room lobby html missing blackmarket badge data hook after createRoom');

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

        for (let guard = 0; guard < 12; guard += 1) {
            const phase = creator.lastState?.phase;
            if (phase === 'finished') {
                break;
            }

            if (phase === 'market') {
                const checkpoint = checkpointStates(clients);
                for (const client of clients) {
                    if (client.lastState?.phase !== 'market' || client.lastState?.self?.alive === false) {
                        continue;
                    }

                    const state = client.lastState;
                    const affordableOffer = (state.marketOffers || []).find(item => item.affordable);
                    const response = await emitAck(client.socket, 'blackmarket_buyOffer', {
                        roomId,
                        playerId: client.playerId,
                        itemId: affordableOffer ? affordableOffer.id : state.passChoice
                    });
                    assert(response && response.success, `market choice failed for ${client.label}`);
                }

                await waitForPhases(clients, roomId, ['action', 'finished'], checkpoint);
                continue;
            }

            if (phase === 'action') {
                const checkpoint = checkpointStates(clients);
                for (const client of clients) {
                    if (client.lastState?.phase !== 'action' || client.lastState?.self?.alive === false) {
                        continue;
                    }

                    const response = await emitAck(client.socket, 'blackmarket_submitAction', {
                        roomId,
                        playerId: client.playerId,
                        ...chooseActionPayload(client, clients)
                    });
                    assert(response && response.success, `action submit failed for ${client.label}`);
                }

                await waitForPhases(clients, roomId, ['market', 'finished'], checkpoint);
                continue;
            }

            throw new Error(`Unexpected phase ${phase}`);
        }

        assert(creator.lastState?.phase === 'finished', 'Black Market did not finish within expected rounds');
        await delay(300);

        const statsByPlayerId = readStatsFile();
        clients.forEach(client => {
            const stat = statsByPlayerId[client.playerId];
            const roleId = client.lastState?.playerRole?.id;
            assert(stat, `missing stats for ${client.label}`);
            assert(Number(stat.totalGames || 0) === 1, `unexpected totalGames for ${client.label}`);
            assert(Number(stat.modeStats?.blackmarket?.games || 0) === 1, `missing Black Market game count for ${client.label}`);
            assert(Number(stat.roleStats?.blackmarket?.[roleId] || 0) === 1, `missing Black Market role count for ${client.label}`);
            assert(Number(stat.winByRole?.blackmarket?.[roleId] || 0) <= 1, `unexpected Black Market win counter for ${client.label}`);
            assert(Array.isArray(stat.gameHistory) && stat.gameHistory[0]?.mode === 'blackmarket', `missing Black Market history entry for ${client.label}`);
            assert(typeof stat.gameHistory[0]?.resultText === 'string', `missing resultText in history for ${client.label}`);
        });

        const profile = await requestJson(`${server.baseUrl}/api/player/${clients[0].playerId}/profile`);
        const firstRoleId = clients[0].lastState?.playerRole?.id;
        assert(Number(profile?.stats?.modeStats?.blackmarket?.games || 0) === 1, 'profile API missing Black Market mode stats');
        assert(Number(profile?.stats?.roleStats?.blackmarket?.[firstRoleId] || 0) === 1, 'profile API missing Black Market role breakdown');
        assert(Number(profile?.stats?.winByRole?.blackmarket?.[firstRoleId] || 0) >= 0, 'profile API missing Black Market win-by-role breakdown');
        assert(profile?.stats?.gameHistory?.[0]?.mode === 'blackmarket', 'profile API missing Black Market history mode');
        assert(typeof profile?.stats?.gameHistory?.[0]?.winnerLabel === 'string', 'profile API missing winner label');

        const roomsHtml = await fetchRoomsPageHtml(server.baseUrl);
        const { adminData, dashboardHtml } = await fetchAdminStats(server.baseUrl);
        const adminStat = (adminData.playerStats || []).find(entry => entry.playerId === clients[0].playerId);
        assert(adminStat, 'admin data missing Black Market player stat entry');
        assert(Number(adminStat.modeStats?.blackmarket?.games || 0) === 1, 'admin data missing Black Market mode games');
        assert(Number(adminStat.roleStats?.blackmarket?.[firstRoleId] || 0) === 1, 'admin data missing Black Market role breakdown');
        assert(typeof adminStat.playerName === 'string' && adminStat.playerName.length > 0, 'admin data missing resolved player name');
        assert(dashboardHtml.includes('Black Market'), 'admin dashboard html missing Black Market marker');
        assert(roomsHtml.includes('ตลาดมืด 4-7 คน กวาดของเถื่อน เปิดดีล และหักหลัง'), 'rooms html missing Black Market description');

        console.log('INTEGRATION_RESULT ' + JSON.stringify({
            roomId,
            winner: creator.lastState?.winner?.name || null,
            rounds: creator.lastState?.roundNumber || 0,
            checkedPlayers: clients.length,
            profileVerified: true,
            adminVerified: true,
            htmlVerified: true
        }));
    } finally {
        clients.forEach(client => {
            if (client.socket.connected) {
                client.socket.disconnect();
            }
        });

        await stopServer(server);
        restoreFiles(backup);
    }
}

main().catch(error => {
    console.error('INTEGRATION_FATAL', error.stack || error.message);
    process.exitCode = 1;
});