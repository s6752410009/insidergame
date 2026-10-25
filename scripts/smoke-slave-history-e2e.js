#!/usr/bin/env node
/** Real four-human Slave rounds -> public profiles/leaderboard + authenticated admin stats/logs.
 * Defaults to production feature gates; SLAVE_HISTORY_ENV=staging also exercises the staging configuration.
 * NODE_ENV=test and legacy socket identity are limited to this isolated localhost server.
 */
require('./isolateTestData');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const ROOT = process.env.SLAVE_HISTORY_APP_ROOT || path.join(__dirname, '..');
const HISTORY_ENV = process.env.SLAVE_HISTORY_ENV || 'production';
if (!['production', 'staging'].includes(HISTORY_ENV)) throw new Error('SLAVE_HISTORY_ENV must be production or staging');
const { io } = createRequire(path.join(ROOT, 'package.json'))('socket.io-client');
const ADMIN_PASSWORD = 'local-slave-history-' + randomUUID();
let checks = 0, child, base, output = '';
const sockets = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function ok(value, message) { assert.ok(value, message); checks += 1; }
async function wait(predicate, label, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) return; await delay(25); }
    throw new Error('Timeout: ' + label);
}
function request(method, route, body = '', headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(new URL(route, base), { method, headers }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status:res.statusCode, headers:res.headers, body:text }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}
async function json(route) {
    const response = await request('GET', route);
    ok(response.status === 200, 'public JSON endpoint responds');
    return JSON.parse(response.body);
}
function ack(socket, event, data = {}) {
    return new Promise((resolve, reject) => socket.timeout(12000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));
}
async function port() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const number = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return number;
}
async function boot(number) {
    output = '';
    base = 'http://127.0.0.1:' + number;
    child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd:ROOT, env:{ ...process.env, PORT:String(number), NODE_ENV:'test', APP_ENV:HISTORY_ENV, MONGO_URL:'', MONGODB_URI:'',
            ADMIN_PASSWORD, ALLOW_LEGACY_SOCKET_IDENTITY:'1', SLAVE_BOT_MS:'60000', INSIDER_DEV_FAST:'0' },
        stdio:['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    await wait(() => output.includes('Server started on port ' + number), 'application startup');
}
async function stop() {
    if (!child || child.exitCode !== null) return;
    const current = child;
    await new Promise(resolve => {
        const timer = setTimeout(() => { current.kill('SIGKILL'); resolve(); }, 6000);
        current.once('exit', () => { clearTimeout(timer); resolve(); });
        current.kill('SIGTERM');
    });
    child = null;
}
async function connect(id) {
    const socket = io(base, { transports:['websocket'], forceNew:true, reconnection:false });
    sockets.add(socket);
    const client = { id, socket, state:null, states:[] };
    socket.on('slaveState', state => { client.state = state; client.states.push(state); });
    await wait(() => socket.connected, 'socket connection');
    if (id) { socket.emit('initPlayer', id); await delay(100); }
    return client;
}
async function admin() {
    const login = await request('POST', '/admin/login', 'password=' + encodeURIComponent(ADMIN_PASSWORD), { 'content-type':'application/x-www-form-urlencoded' });
    ok(login.status === 302, 'local test admin login succeeds');
    const cookie = (login.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
    const page = await request('GET', '/admin', '', { cookie });
    ok(page.status === 200, 'authenticated admin dashboard renders');
    const token = (/const adminToken = '([^']+)'/.exec(page.body) || [])[1];
    ok(Boolean(token), 'dashboard issues temporary socket token');
    const client = await connect();
    ok((await ack(client.socket, 'admin_authenticate', { token })).success, 'admin socket authentication succeeds');
    return client.socket;
}
function bind(client, roomId) { client.socket.emit('setRoom', { roomId, playerId:client.id }); client.socket.emit('slave_requestState', { roomId }); }
async function logs(adminSocket, roomId) {
    const response = await ack(adminSocket, 'admin_getLogs', { cat:'all', mode:'slave', roomId, limit:500 });
    ok(response.success, 'authenticated admin reads Slave logs');
    return response.logs;
}
function privateKeys(value) {
    if (!value || typeof value !== 'object') return [];
    const forbidden = new Set(['hand', 'hands', 'cards', 'recoveryCode', 'googleSub', 'googleEmail', 'password', 'returns', 'deck', 'slaveLatestResult']);
    return Object.entries(value).flatMap(([key, item]) => (forbidden.has(key) ? [key] : []).concat(privateKeys(item)));
}
async function checkEnvironment(players, roomId) {
    const page = await request('GET', '/game/' + roomId + '?playerId=' + encodeURIComponent(players[0].id));
    ok(page.status === 200 && page.body.includes('id="slHand"'), HISTORY_ENV + ' serves the actual four-human Slave board');
    const meta = (/<div class="sl-meta">([\s\S]*?)<\/div>/.exec(page.body) || [])[1];
    ok(typeof meta === 'string', 'rendered table metadata is available for environment checks');
    ok(/id="slDebug"[^>]*\bhidden\b/.test(page.body) && /id="slDebugDock"[^>]*\bhidden\b/.test(page.body), 'debug controls start hidden on the rendered board');
    if (HISTORY_ENV === 'staging') {
        ok(meta.includes('STAGING'), 'staging table identifies the test environment');
        ok(/canDebug:true\s*\}\)/.test(page.body), 'staging host receives the authorized debug boot flag');
        ok(/noindex/i.test(page.headers['x-robots-tag'] || ''), 'staging response remains excluded from search indexing');
        return;
    }
    ok(!meta.includes('STAGING'), 'production table does not display the staging label');
    ok(/canDebug:false\s*\}\)/.test(page.body), 'production host receives no debug authorization in the rendered board');
    ok(!/noindex/i.test(page.headers['x-robots-tag'] || ''), 'production board has no staging noindex response header');
    const publicPage = await request('GET', '/how-to-play#slave');
    ok(publicPage.status === 200 && !/noindex/i.test(publicPage.headers['x-robots-tag'] || ''), 'production public manual has no staging noindex response header');
    const before = structuredClone(players[0].state);
    const inspect = await ack(players[0].socket, 'slave_debug', { roomId, action:'inspect' });
    ok(inspect.success === false && !inspect.hands && privateKeys(inspect).length === 0, 'production denies host inspection and reveals no private cards');
    const mutate = await ack(players[0].socket, 'slave_debug', { roomId, action:'finish', step:before.step });
    ok(mutate.success === false, 'production denies host mutating debug requests');
    players.forEach(player => player.socket.emit('slave_requestState', { roomId }));
    await delay(100);
    ok(players.every(player => player.state?.phase === before.phase && player.state?.step === before.step && !player.state?.debugUsed), 'denied production debug leaves the four-human game ranked and unchanged');
}
async function finishRound(players, roomId) {
    for (let n = 0; n < 1000; n += 1) {
        const state = players[0].state;
        if (state?.phase === 'round-end') return structuredClone(state);
        ok(Boolean(state), 'live round state is available');
        let actor, event, payload;
        if (state.phase === 'exchange') {
            actor = players.find(player => player.state?.self?.exchangeCount > 0);
            ok(Boolean(actor), 'exchange is chosen using only the actor own hand');
            event = 'slave_exchange';
            payload = { cardIds:actor.state.self.hand.slice(0, actor.state.self.exchangeCount).map(card => card.id) };
        } else {
            actor = players.find(player => player.id === state.turnId);
            ok(Boolean(actor), 'server turn belongs to one of the four humans');
            const moves = actor.state.legalMoves || [];
            event = moves.length ? 'slave_play' : 'slave_pass';
            payload = moves.length ? { cardIds:moves[0] } : {};
        }
        const previous = state.step;
        const response = await ack(actor.socket, event, { roomId, step:actor.state.step, ...payload });
        ok(response.success, 'legal human socket action succeeds: ' + event);
        await wait(() => players.every(player => player.state?.phase === 'round-end' || player.state?.step > previous), 'all humans receive next step');
        // No successful /m request, engine mutation, or private opponent hands are used to finish the round.
        ok(players.every(player => !privateKeys(player.state.seats).length), 'opponents stay concealed during actual play');
    }
    throw new Error('Slave round did not finish');
}
async function checkProfiles(players, results, expectedGames) {
    for (const player of players) {
        const profile = await json('/api/player/' + player.id + '/profile');
        ok(profile.stats?.totalGames === expectedGames && profile.stats.modeStats?.slave?.games === expectedGames, 'other-user profile exposes Slave counts');
        const expectedWins = results.filter(result => result.standings[0].playerId === player.id).length;
        ok(profile.stats.modeStats.slave.wins === expectedWins && profile.stats.modeStats.slave.losses === expectedGames - expectedWins, 'only each round King receives the win');
        const history = profile.stats.gameHistory;
        ok(history.length === expectedGames && history.every(entry => entry.mode === 'slave'), 'other-user profile keeps completed-round history');
        ok(history.every(entry => entry.place >= 1 && entry.place <= 4 && entry.role && entry.round && entry.resultText && entry.startedAt && entry.endedAt), 'history shows placement, title, round, and times');
        ok(privateKeys(profile).length === 0, 'public profile has no private cards, auth data, or exchange choices');
    }
}
async function main() {
    const number = await port();
    await boot(number);
    let adminSocket = await admin();
    let players = [];
    for (let index = 0; index < 4; index += 1) players.push(await connect(randomUUID()));
    const created = await ack(players[0].socket, 'createRoom', { playerId:players[0].id, name:'Slave history integration', gameMode:'slave', maxPlayers:4, password:'test-room-secret' });
    ok(created.success && created.roomId, 'create real four-human Slave room');
    const roomId = created.roomId;
    bind(players[0], roomId);
    for (const player of players.slice(1)) {
        ok((await ack(player.socket, 'joinRoom', { roomId, playerId:player.id, password:'test-room-secret' })).success, 'human joins room');
        bind(player, roomId);
    }
    await delay(150);
    ok(!(await ack(players[1].socket, 'admin_getLogs', { roomId, mode:'slave' })).success, 'ordinary user cannot read admin logs');
    ok(!(await ack(players[1].socket, 'admin_getStats', { modeFilter:'has-slave' })).success, 'ordinary user cannot read admin stats');
    ok((await ack(players[0].socket, 'startGameFromLobby', { roomId })).success, 'start four-human game');
    await wait(() => players.every(player => player.state?.phase === 'turn'), 'four private initial states');
    await checkEnvironment(players, roomId);
    const results = [await finishRound(players, roomId)];
    await checkProfiles(players, results, 1);
    ok((await ack(players[0].socket, 'slave_nextRound', { roomId })).success, 'host begins next round');
    await wait(() => players.every(player => player.state?.phase === 'exchange'), 'exchange starts without leaving the table');
    results.push(await finishRound(players, roomId));
    await checkProfiles(players, results, 2);
    const board = await json('/api/leaderboard?mode=slave');
    ok(board.length === 4 && board.every(row => row.mode === 'slave' && row.totalGames === 2), 'public Slave leaderboard contains four humans and both rounds');
    const statRows = await ack(adminSocket, 'admin_getStats', { modeFilter:'has-slave', pageSize:20 });
    ok(statRows.success && statRows.rows.length === 4 && statRows.rows.every(row => row.modeStats?.slave?.games === 2), 'admin mode filter finds Slave player totals');
    const insiderRows = await ack(adminSocket, 'admin_getStats', { modeFilter:'has-insider', pageSize:20 });
    ok(insiderRows.success && insiderRows.rows.length === 0, 'admin game filter separates Slave from Insider');
    let roomLogs = await logs(adminSocket, roomId);
    ok(roomLogs.filter(log => log.meta?.event === 'game_start').length === 1, 'one game start audit');
    const ends = roomLogs.filter(log => log.meta?.event === 'game_end');
    ok(ends.length === 2 && ends.every(log => log.important && log.gameMode === 'slave' && log.roomName === 'Slave history integration'), 'two completed rounds have important room-specific admin logs');
    ok(ends.every(log => log.meta.ranked === true && log.meta.debugUsed === false && Array.isArray(log.meta.standings) && log.meta.standings.length === 4), 'ranked round summary retains all four places');
    ok(roomLogs.some(log => log.meta?.event === 'slave_history' && log.meta.kind === 'play') && roomLogs.some(log => log.meta?.kind === 'exchange'), 'admin has public play and exchange progress history');
    ok(privateKeys(roomLogs).length === 0 && !JSON.stringify(roomLogs).includes('test-room-secret'), 'logs omit room passwords and private hands');
    for (let n = 0; n < 3; n += 1) players.forEach(player => player.socket.emit('slave_requestState', { roomId }));
    await delay(100);
    ok((await logs(adminSocket, roomId)).filter(log => log.meta?.event === 'game_end').length === 2, 'state refresh does not duplicate completed-round logs');
    await checkProfiles(players, results, 2);
    const ids = players.map(player => player.id);
    // Graceful restart exercises the same JSON persistence path used by recovery after deployment.
    await stop();
    for (const socket of sockets) socket.disconnect();
    sockets.clear();
    await boot(number);
    adminSocket = await admin();
    await checkProfiles(ids.map(id => ({ id })), results, 2);
    roomLogs = await logs(adminSocket, roomId);
    ok(roomLogs.filter(log => log.meta?.event === 'game_end').length === 2, 'completed-round logs survive JSON restart without duplication');
    players = [];
    for (const id of ids) { const player = await connect(id); players.push(player); bind(player, roomId); }
    await wait(() => players.every(player => player.state?.phase === 'round-end'), 'completed table recovers for all four humans');
    ok((await ack(players[0].socket, 'slave_nextRound', { roomId })).success, 'recovered table starts another round');
    await wait(() => players.every(player => player.state?.phase === 'exchange'), 'recovered exchange');
    ok((await ack(players[1].socket, 'slave_returnLobby', { roomId })).success, 'human leaves during exchange');
    await wait(() => players[0].state?.phase === 'finished', 'table stops on abandonment');
    players[0].socket.emit('slave_requestState', { roomId });
    roomLogs = await logs(adminSocket, roomId);
    const aborts = roomLogs.filter(log => log.meta?.event === 'game_abort');
    ok(aborts.length === 1 && aborts[0].meta.ranked === false, 'early exit creates one unranked abandonment record');
    ok(roomLogs.filter(log => log.meta?.event === 'game_end').length === 2, 'abandoned third round creates no winner result');
    await checkProfiles(players, results, 2);
    console.log(JSON.stringify({ ok:true, environment:HISTORY_ENV, checks, humanPlayers:4, completedRounds:2, abortedRounds:1, profile:true, leaderboard:true, adminStats:true, adminLogs:true, restart:true, isolatedData:true, productionGuards:HISTORY_ENV === 'production' }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
    for (const socket of sockets) socket.disconnect();
    await stop();
});
