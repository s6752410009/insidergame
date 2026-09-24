/**
 * กติกา Insider/Spyfall ฝั่ง server (spawn เซิร์ฟเวอร์เอง ใช้ data ชั่วคราว)
 *
 * - /m (admin_request_word_roles): หัวห้องธรรมดาโดนปฏิเสธ · site admin ได้
 * - wordFound ก่อนเปิดคำ = ไม่มีผล · หลังจบเกม replay ไม่ได้ · สถิติบันทึกครั้งเดียว
 * - หมดเวลาคุยโดยยังทายคำไม่ได้ = ทุกคนแพ้ (สถิติแพ้ทุกคน)
 * - Spyfall: สายลับทายสถานที่ผิด = แพ้ทันที (บันทึกสถิติ)
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-insider-spyfall-rules.js
 */

require('./isolateTestData');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const PORT = Number(process.env.PORT || 8411);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.GAME_DATA_DIR;
const GM = 'ผู้ดำเนินเกม';

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function seedSiteAdmin(playerId) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, 'players.json');
    let players = {};
    try { players = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { players = {}; }
    const now = new Date().toISOString();
    players[playerId] = {
        playerId, playerName: 'SmokeAdmin', color: '#e74c3c', avatar: '👤', avatarFrame: 'none',
        isSiteAdmin: true, createdAt: now, lastSeen: now
    };
    fs.writeFileSync(file, JSON.stringify(players, null, 2));
}

function readStats() {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'playerStats.json'), 'utf8')); } catch (error) { return {}; }
}

function bootServer() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), ALLOW_LEGACY_SOCKET_IDENTITY: '1', SPYFALL_REVEAL_PHASE_MS: '1000' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server startup timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', chunk => {
            logs += String(chunk);
            if (String(chunk).includes(`Server started on port ${PORT}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', chunk => { logs += String(chunk); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ack timeout ' + event)), 15000);
        socket.emit(event, payload, response => { clearTimeout(timer); resolve(response); });
    });
}

async function makeClient(playerId = randomUUID()) {
    const socket = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect timeout')), 15000);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
    });
    const events = [];
    socket.onAny((eventName, payload) => events.push({ eventName, payload, at: Date.now() }));
    socket.emit('initPlayer', playerId);
    return { socket, playerId, events };
}

async function waitFor(client, eventName, predicate = null, timeoutMs = 15000, since = 0) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const hit = client.events.find(e => e.at >= since && e.eventName === eventName && (!predicate || predicate(e.payload)));
        if (hit) return hit.payload;
        await delay(100);
    }
    throw new Error(`timeout waiting for ${eventName}`);
}

function seen(client, eventName, since) {
    return client.events.some(e => e.at >= since && e.eventName === eventName);
}

async function setupRoom(clients, roomData) {
    const [host, ...others] = clients;
    await delay(300);
    const created = await emitAck(host.socket, 'createRoom', { playerId: host.playerId, maxPlayers: 8, ...roomData });
    assert(created?.success, 'createRoom failed: ' + JSON.stringify(created));
    const roomId = created.roomId;
    host.socket.emit('setRoom', { roomId, playerId: host.playerId });
    for (const c of others) {
        const joined = await emitAck(c.socket, 'joinRoom', { roomId, playerId: c.playerId });
        assert(joined?.success, 'join failed: ' + JSON.stringify(joined));
        c.socket.emit('setRoom', { roomId, playerId: c.playerId });
    }
    await delay(600);
    const started = await emitAck(host.socket, 'startGameFromLobby', { roomId });
    assert(started?.success, 'start failed: ' + JSON.stringify(started));
    return roomId;
}

async function insiderRoles(clients) {
    const roles = new Map();
    for (const c of clients) {
        const payload = await waitFor(c, 'newRole');
        roles.set(c.playerId, payload);
    }
    return roles;
}

async function testInsiderFlow(adminId) {
    // หัวห้อง = ผู้เล่นธรรมดา, site admin เป็นผู้เล่นคนหนึ่งในห้อง
    const clients = [await makeClient(), await makeClient(), await makeClient(), await makeClient(adminId)];
    const [host] = clients;
    const siteAdmin = clients[3];
    const roomId = await setupRoom(clients, { name: `RulesInsider ${Date.now()}`, gameMode: 'insider', roundTime: 5 });
    const roles = await insiderRoles(clients);
    console.log('1. Insider room started:', roomId);

    // /m จากหัวห้องธรรมดา → ปฏิเสธ
    let mark = Date.now();
    host.socket.emit('admin_request_word_roles');
    await waitFor(host, 'admin_word_roles_denied', null, 5000, mark);
    assert(!seen(host, 'admin_word_roles', mark), 'normal host must not receive word/roles');
    siteAdmin.socket.emit('admin_request_word_roles');
    const reveal = await waitFor(siteAdmin, 'admin_word_roles', null, 5000, mark);
    assert(reveal.word && Array.isArray(reveal.players), 'site admin should see word+roles');
    console.log('2. /m denied for host, allowed for site admin ✓');

    // wordFound ก่อนเปิดคำ → ไม่มีผล
    mark = Date.now();
    host.socket.emit('wordFound');
    host.socket.emit('displayVote2');
    await delay(1200);
    assert(!seen(host, 'displayVote2', mark), 'wordFound before reveal must not open the vote');
    console.log('3. wordFound rejected in role phase ✓');

    const gmClient = clients.find(c => roles.get(c.playerId).role === GM);
    assert(gmClient, 'no GM dealt');
    gmClient.socket.emit('revealWord');
    await waitFor(host, 'revealWord');
    host.socket.emit('startGame');
    await waitFor(host, 'startGame');
    mark = Date.now();
    host.socket.emit('wordFound');
    const vote = await waitFor(host, 'displayVote2', null, 5000, mark);
    const expected = Math.max(1, vote.numTraitors || 0);
    for (const c of clients) {
        const r = roles.get(c.playerId);
        if (r.role === GM || r.isGhost) continue;
        const me = vote.players.find(p => p.playerId === c.playerId);
        const choices = vote.players.filter(p => p.playerId !== c.playerId).slice(0, expected).map(p => p.playerId);
        const name = me ? me.name : null;
        c.socket.emit('vote2', { player: name, votes: choices });
    }
    const ended = await waitFor(host, 'vote2Ended', null, 20000, mark);
    assert(typeof ended.hasWon === 'boolean', 'vote2Ended missing result');
    await delay(500);
    const statsAfterFirst = readStats();
    clients.forEach(c => assert(statsAfterFirst[c.playerId]?.modeStats?.insider?.games === 1, 'each player should have exactly 1 insider game'));
    console.log('4. vote finished once, stats recorded ✓');

    // replay หลังจบ → ต้องไม่เปิดโหวตใหม่ และไม่บันทึกซ้ำ
    mark = Date.now();
    host.socket.emit('wordFound');
    host.socket.emit('displayVote2');
    host.socket.emit('startGame');
    await delay(1500);
    assert(!seen(host, 'displayVote2', mark), 'wordFound after end must not reopen the vote');
    assert(!seen(host, 'vote2Ended', mark), 'no second result after end');
    const statsReplay = readStats();
    clients.forEach(c => assert(statsReplay[c.playerId].modeStats.insider.games === 1, 'stats must not double-record'));
    console.log('5. wordFound/displayVote2 not replayable after end ✓');

    clients.forEach(c => c.socket.close());
}

async function testInsiderTimeout() {
    const clients = [await makeClient(), await makeClient(), await makeClient()];
    const [host] = clients;
    // roundTime เป็นนาที: 0.05 นาที = 3 วินาที
    const roomId = await setupRoom(clients, { name: `RulesTimeout ${Date.now()}`, gameMode: 'insider', roundTime: 0.05 });
    const roles = await insiderRoles(clients);
    const gmClient = clients.find(c => roles.get(c.playerId).role === GM);
    gmClient.socket.emit('revealWord');
    await waitFor(host, 'revealWord');
    const mark = Date.now();
    host.socket.emit('startGame');
    const ended = await waitFor(host, 'vote2Ended', null, 15000, mark);
    assert(ended.everyoneLoses === true && ended.hasWon === false, 'timeout must end as everyone loses: ' + JSON.stringify(ended));
    assert(!seen(host, 'displayVote2', mark), 'timeout must not open the traitor vote');
    await delay(500);
    const stats = readStats();
    clients.forEach(c => {
        const s = stats[c.playerId]?.modeStats?.insider;
        assert(s && s.games === 1 && s.losses === 1 && s.wins === 0, 'timeout must record a loss for ' + roles.get(c.playerId).role);
    });
    console.log('6. discussion timeout = everyone loses (stats: all losses) ✓', roomId);
    clients.forEach(c => c.socket.close());
}

async function testSpyfallGuess(correctGuess) {
    const clients = [await makeClient(), await makeClient(), await makeClient(), await makeClient()];
    const roomId = await setupRoom(clients, { name: `RulesSpy ${Date.now()}`, gameMode: 'spyfall', roundTime: 5 });
    await delay(300);
    clients.forEach(c => c.socket.emit('spyfall_requestState', { roomId, playerId: c.playerId }));
    const states = new Map();
    for (const c of clients) {
        states.set(c.playerId, await waitFor(c, 'spyfallState', s => s && s.phase === 'discussion', 15000));
    }
    const spy = clients.find(c => states.get(c.playerId).self.isSpy);
    const citizen = clients.find(c => c !== spy);
    const spyState = states.get(spy.playerId);
    assert(spyState.canGuessLocation === true, 'spy should be able to guess');
    const trueLocationId = states.get(citizen.playerId).location.id;

    const notSpy = await emitAck(citizen.socket, 'spyfall_guessLocation', { locationId: trueLocationId });
    assert(notSpy && notSpy.success === false, 'citizen guess must be rejected');

    const pick = correctGuess ? trueLocationId : spyState.locationPool.find(l => l.id !== trueLocationId).id;
    const res = await emitAck(spy.socket, 'spyfall_guessLocation', { locationId: pick });
    assert(res?.success && res.correct === correctGuess, 'guess ack wrong: ' + JSON.stringify(res));
    const final = await waitFor(citizen, 'spyfallState', s => s && s.phase === 'finished', 5000);
    assert(final.winner.team === (correctGuess ? 'spy' : 'citizens'), 'wrong winner after guess');
    const again = await emitAck(spy.socket, 'spyfall_guessLocation', { locationId: pick });
    assert(again && again.success === false, 'second guess must be rejected');
    await delay(500);
    const stats = readStats();
    const spyStat = stats[spy.playerId]?.modeStats?.spyfall;
    assert(spyStat && spyStat.games === 1 && spyStat.wins === (correctGuess ? 1 : 0), 'spy stats wrong');
    console.log(`${correctGuess ? 7 : 8}. spyfall spy ${correctGuess ? 'correct' : 'wrong'} guess → ${final.winner.team} win ✓`);
    clients.forEach(c => c.socket.close());
}

async function main() {
    // ต้อง seed site admin ก่อนบูต (server โหลด players.json ตอนเริ่ม)
    const adminId = randomUUID();
    seedSiteAdmin(adminId);
    const server = await bootServer();
    try {
        await testInsiderFlow(adminId);
        await testInsiderTimeout();
        await testSpyfallGuess(true);
        await testSpyfallGuess(false);
        console.log('\n✅ INSIDER/SPYFALL RULE CHECKS PASSED');
    } finally {
        server.kill('SIGTERM');
    }
    process.exit(0);
}

main().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
