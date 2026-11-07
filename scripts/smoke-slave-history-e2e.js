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
            ADMIN_PASSWORD, ALLOW_LEGACY_SOCKET_IDENTITY:'1', SLAVE_BOT_MS:'60000', SLAVE_ROUND_BREAK_MS:'200', SLAVE_RESULT_MS:'2000', INSIDER_DEV_FAST:'0' },
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
    socket.on('redirectToLobby', () => { client.returned = true; });
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
        if (['round-end','finished'].includes(state?.phase)) return structuredClone(state);
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
        await wait(() => players.every(player => ['round-end','finished'].includes(player.state?.phase) || player.state?.step > previous), 'all humans receive next step');
        // No successful /m request, engine mutation, or private opponent hands are used to finish the round.
        ok(players.every(player => !privateKeys(player.state.seats).length), 'opponents stay concealed during actual play');
    }
    throw new Error('Slave round did not finish');
}
async function checkProfiles(players, results, expectedGames) {
    for (const player of players) {
        const profile = await json('/api/player/' + player.id + '/profile');
        if (!expectedGames) { ok(!profile.stats?.totalGames && !(profile.stats?.gameHistory || []).length, 'first round has not recorded a game'); continue; }
        ok(profile.stats?.totalGames === expectedGames && profile.stats.modeStats?.slave?.games === expectedGames, 'other-user profile exposes Slave counts');
        const expectedWins = results.filter(result => result.matchComplete && result.matchStandings.find(row => row.playerId === player.id)?.place === 1).length;
        ok(profile.stats.modeStats.slave.wins === expectedWins && profile.stats.modeStats.slave.losses === expectedGames - expectedWins, 'only each round King receives the win');
        const history = profile.stats.gameHistory;
        ok(history.length === expectedGames && history.every(entry => entry.mode === 'slave'), 'other-user profile keeps completed-round history');
        ok(history.every(entry => entry.place >= 1 && entry.place <= 4 && entry.role && entry.round && entry.resultText && entry.startedAt && entry.endedAt), 'history shows placement, title, round, and times');
        ok(privateKeys(profile).length === 0, 'public profile has no private cards, auth data, or exchange choices');
    }
}
async function continuousPlay(number, adminSocket) {
    let players=[];
    for(let i=0;i<4;i++)players.push(await connect(randomUUID()));
    const created=await ack(players[0].socket,'createRoom',{playerId:players[0].id,name:'สลาฟเล่นวน',gameMode:'slave',maxPlayers:4});
    ok(created.success,'continuous fixture room created');const roomId=created.roomId;
    bind(players[0],roomId);
    for(const player of players.slice(1)){
        ok((await ack(player.socket,'joinRoom',{roomId,playerId:player.id})).success,'continuous human joins');bind(player,roomId);
    }
    await delay(100);
    ok(!(await ack(players[1].socket,'updateRoom',{slavePlayMode:'continuous'})).success,'non-host cannot change play mode');
    const setting=await ack(players[0].socket,'updateRoom',{slavePlayMode:'continuous'});
    ok(setting.success && setting.room.settings.slavePlayMode==='continuous','host enables continuous room setting');
    ok((await ack(players[0].socket,'startGameFromLobby',{roomId})).success,'continuous game starts');
    await wait(()=>players.every(p=>p.state?.continuous&&p.state.phase==='turn'),'continuous setting reaches every player');
    ok(!(await ack(players[0].socket,'updateRoom',{slavePlayMode:'two-rounds'})).success,'mode is locked during play');
    const results=[];
    for(let round=1;round<=2;round++){
        results.push(await finishRound(players,roomId));
        ok(!results.at(-1).matchComplete && results.at(-1).phase==='round-end','continuous round has no game over');
        await wait(()=>players.every(p=>p.state?.round===round+1&&p.state.phase==='exchange'),'next continuous exchange');
    }
    const checkContinuousProfiles = async count => {
        for (const player of players) {
            const profile = await json('/api/player/' + player.id + '/profile');
            ok(profile.stats?.modeStats?.slave?.games === count && profile.stats.gameHistory.length === Math.min(count, 5), 'public profile counts every round and limits its preview to five');
            const detail = await ack(adminSocket, 'admin_getPlayerStat', { playerId:player.id });
            const history = detail.stat?.gameHistory || [];
            ok(detail.success && history.length === count && new Set(history.map(row => row.resultId)).size === count, 'admin history retains every distinct continuous result');
            ok(history.every(row => row.round >= 1 && !row.totalRounds), 'continuous history contains round placements rather than two-round aggregates');
        }
    };
    await checkContinuousProfiles(2);
    ok(players.every(p=>!p.returned && p.state.sessionRound===3),'all players remain on the same board at round three');
    const ids=players.map(p=>p.id),roundThree=players[0].state;
    await stop();for(const socket of sockets)socket.disconnect();sockets.clear();
    await boot(number);adminSocket=await admin();players=[];
    for(const id of ids){const player=await connect(id);players.push(player);bind(player,roomId);}
    await wait(()=>players.every(p=>p.state?.continuous&&p.state.round===3&&p.state.phase==='exchange'),'endless exchange restored after restart');
    ok(players[0].state.seats.every((seat,i)=>seat.title===roundThree.seats[i].title),'restart preserves king/queen positions');
    for(let round=3;round<=6;round++){
        results.push(await finishRound(players,roomId));
        ok(!results.at(-1).matchComplete && !results.at(-1).returnLobbyAt && !results.at(-1).nextMatchAt,'continuous result never schedules a new game');
        await wait(()=>players.every(p=>p.state?.round===round+1&&p.state.phase==='exchange'),'continuous round '+(round+1));
    }
    await checkContinuousProfiles(6);
    const history=await logs(adminSocket,roomId),ends=history.filter(row=>row.meta?.event==='round_end');
    ok(ends.length===6 && new Set(ends.map(row=>row.meta.gameId)).size===1,'six round results share one stable continuous session');
    ok(history.filter(row=>row.meta?.event==='game_start').length===1 && !history.some(row=>row.meta?.event==='game_end'),'continuous session has no repeated game start/end');
    const board=await json('/api/leaderboard?mode=slave');ok(ids.every(id=>board.some(row=>row.playerId===id&&row.totalGames===6)),'endless human rounds appear in leaderboard');
    ok(players.every(p=>!p.returned),'continuous play never forces a lobby redirect');

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
    ok(!(await ack(players[1].socket, 'admin_observeRoom', { roomId })).success, 'ordinary member cannot use ghost observer');
    ok(!(await ack(players[1].socket, 'admin_observerMessage', { roomId, message:'forged ghost' })).success, 'ordinary member cannot forge ghost messages');
    const observed = await ack(adminSocket, 'admin_observeRoom', { roomId });
    ok(observed.success && observed.room.totalPlayerCount === 4 && observed.slave.self === null, 'admin watches full active table with no seat or private hand');
    const stepBeforeGhostChat = players[0].state.step;
    ok((await ack(adminSocket, 'admin_observerMessage', { roomId, message:'Ghost test <script>' })).success, 'ghost admin sends public chat without membership');
    const ghostChat = await ack(adminSocket, 'admin_observeRoom', { roomId });
    ok(ghostChat.chat.at(-1).message.includes('&lt;script&gt;') && ghostChat.room.totalPlayerCount === 4, 'ghost chat is escaped and never increases player count');
    ok(players[0].state.step === stepBeforeGhostChat, 'ghost chat does not advance turn');
    const results = [await finishRound(players, roomId)];
    await checkProfiles(players, results, 0);
    await wait(() => players.every(player => player.state?.round === 2 && player.state.phase === 'exchange'), 'round two starts automatically with private exchanges');
    results.push(await finishRound(players, roomId));
    ok(results[1].matchComplete && results[1].matchStandings.reduce((sum,row) => sum+row.score,0) === 20, 'two-round score total is 20');
    await checkProfiles(players, results, 1);
    const board = await json('/api/leaderboard?mode=slave');
    ok(board.length === 4 && board.every(row => row.mode === 'slave' && row.totalGames === 1), 'public leaderboard counts one complete two-round game');
    const statRows = await ack(adminSocket,'admin_getStats',{modeFilter:'has-slave',pageSize:20});
    ok(statRows.success && statRows.rows.length === 4 && statRows.rows.every(row => row.modeStats.slave.games === 1), 'admin sees one game per player');
    let roomLogs = await logs(adminSocket,roomId);
    ok(roomLogs.filter(log => log.meta?.event === 'game_end').length === 1, 'one completed-match admin log');
    ok(privateKeys(roomLogs).length === 0 && !JSON.stringify(roomLogs).includes('test-room-secret'), 'logs omit private hands and room password');
    for (let n=0;n<3;n++) players.forEach(player => player.socket.emit('slave_requestState',{roomId}));
    await checkProfiles(players,results,1);
    await wait(() => players.every(player => player.returned), 'all four clients automatically return to lobby');
    const ids = players.map(player => player.id);
    await stop(); for (const socket of sockets) socket.disconnect(); sockets.clear();
    await boot(number); adminSocket = await admin();
    await checkProfiles(ids.map(id => ({id})),results,1);
    ok((await logs(adminSocket,roomId)).filter(log => log.meta?.event === 'game_end').length === 1, 'JSON restart never duplicates completed match');
    players = [];
    for (const id of ids) { const player = await connect(id); players.push(player); bind(player,roomId); }
    const lobby = await request('GET','/room/'+roomId+'?playerId='+encodeURIComponent(ids[0]));
    ok(lobby.status === 200 && lobby.body.includes('btnStartGameLobby'), 'lobby reset survives restart');
    ok((await ack(players[0].socket,'startGameFromLobby',{roomId})).success, 'new game starts from lobby');
    await wait(() => players.every(player => player.state?.phase === 'turn' && player.state.round === 1), 'fresh match starts at round one');
    ok((await ack(players[1].socket,'slave_returnLobby',{roomId})).success, 'human leaves an unfinished match');
    await wait(() => players[0].state?.phase === 'finished','abandoned game stops');
    roomLogs = await logs(adminSocket,roomId);
    ok(roomLogs.filter(log => log.meta?.event === 'game_abort').length === 1, 'one unranked abandonment record');
    ok(roomLogs.filter(log => log.meta?.event === 'game_end').length === 1, 'abandoned match does not create another win');
    await checkProfiles(players,results,1);
    ok((await ack(adminSocket, 'admin_setSiteAdmin', { playerId:players[0].id, isSiteAdmin:true })).success, 'grant site admin in isolated data');
    const siteAdminPage = await request('GET', '/game/' + roomId + '?playerId=' + encodeURIComponent(players[0].id));
    const siteAdminCookie = (siteAdminPage.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
    ok(Boolean(siteAdminCookie), 'site admin browser receives authenticated identity cookie');
    const ghostPage = await request('GET', '/admin/observe/' + roomId, '', { cookie:siteAdminCookie });
    ok(ghostPage.status === 200 && ghostPage.body.includes('observerForm'), 'site-admin cookie opens Ghost HTTP page without dashboard login');
    const forgedGhostPage = await request('GET', '/admin/observe/' + roomId + '?playerId=' + encodeURIComponent(players[0].id));
    ok(forgedGhostPage.status === 403, 'public player ID cannot forge Ghost HTTP access');
    const inspection = await ack(players[0].socket, 'slave_debug', { roomId, action:'inspect' });
    ok(inspection.success && inspection.hands.length === 4, 'site admin can use /m on production');
    ok(!(await ack(players[2].socket, 'slave_debug', { roomId, action:'inspect' })).success, 'ordinary players remain unable to inspect hands');
    let watcher = await connect(randomUUID());
    ok((await ack(watcher.socket, 'createRoom', { playerId:watcher.id, name:'Other room', gameMode:'insider' })).success, 'persist separate observer identity');
    const watcherId = watcher.id;
    watcher.socket.disconnect();
    watcher = await connect(watcherId);
    ok((await ack(adminSocket, 'admin_setSiteAdmin', { playerId:watcher.id, isSiteAdmin:true })).success, 'grant separate ghost admin identity');
    const ghostJoin = await ack(watcher.socket, 'joinRoom', { roomId, playerId:watcher.id });
    ok(ghostJoin.success && ghostJoin.observer, 'site admin room entry uses ghost mode');
    const watched = await ack(watcher.socket, 'admin_observeRoom', { roomId });
    ok(watched.success && watched.room.totalPlayerCount === 4 && !watched.room.players.some(p=>p.playerId===watcher.id), 'ghost identity never becomes a fifth player');
    const ghostInspect = await ack(watcher.socket, 'admin_observerMessage', { roomId, message:'/m' });
    ok(ghostInspect.success && ghostInspect.debug.hands.length === 4, 'ghost admin can inspect Slave without a seat');
    ok((await ack(adminSocket, 'admin_setSiteAdmin', { playerId:watcher.id, isSiteAdmin:false })).success, 'revoke ghost admin for authorization check');
    ok(!(await ack(watcher.socket, 'admin_observeRoom', { roomId })).success, 'revoked admin cannot keep observing');
    await continuousPlay(number,adminSocket);
    console.log(JSON.stringify({ ok:true, environment:HISTORY_ENV, checks, humanPlayers:4, completedRounds:8, continuous:true, abortedRounds:1, profile:true, leaderboard:true, adminStats:true, adminLogs:true, ghost:true, restart:true, isolatedData:true, productionGuards:HISTORY_ENV === 'production' }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
    for (const socket of sockets) socket.disconnect();
    await stop();
});
