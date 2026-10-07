/**
 * Insider — เล่นตามกติกาจริงผ่าน socket (spawn เซิร์ฟเวอร์เอง ใช้ data ชั่วคราว)
 * rules/insider/rules.md
 *
 *  A. โหวตรอบ 1 เกินครึ่งว่า "ใช่" + คนทายถูกเป็นจอมบงการ → ผู้ดำเนินเกม/พลเมืองชนะ (สถิติถูก)
 *  B. โหวตรอบ 1 เกินครึ่งว่า "ใช่" แต่คนทายถูกเป็นพลเมือง → จอมบงการชนะ
 *  C. โหวตรอบ 1 ไม่ผ่าน → ชี้ตัว (ผู้ดำเนินเกมโหวตด้วย) → เสมอ → คนทายถูกตัดสิน
 *  D. ปิด "โหวตคนทายถูกก่อน" → คุยจบแล้วไปชี้ตัวเลย
 *  E. ผู้ดำเนินเกมประกาศตัวในแชท / newRole บอกชื่อทุกคน
 *  F. รีสตาร์ต server กลางช่วงถาม–ตอบ → นาฬิกาเดินต่อ แล้วหมดเวลา = ทุกคนแพ้ (เดิมค้างตลอด)
 *  G. เปิด 2 แท็บแล้วปิดแท็บใหม่ → แท็บเดิมยังได้ข้อความส่วนตัว (คำลับ/บท)
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-insider-flow.js
 */
require('./isolateTestData');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const GM = 'ผู้ดำเนินเกม';
const INSIDER = 'จอมบงการ';
const DATA_DIR = process.env.GAME_DATA_DIR;
let PORT = 0;
let BASE = '';

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function freePort() {
    return new Promise(resolve => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

function readStats() {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'playerStats.json'), 'utf8')); } catch (error) { return {}; }
}

function bootServer() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), ALLOW_LEGACY_SOCKET_IDENTITY: '1' },
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

function stopServer(child) {
    return new Promise(resolve => {
        if (!child || child.exitCode !== null) return resolve();
        child.removeAllListeners('exit');
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} resolve(); }, 8000);
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
        await delay(80);
    }
    throw new Error(`timeout waiting for ${eventName}`);
}
const seen = (client, eventName, since) => client.events.some(e => e.at >= since && e.eventName === eventName);

async function setupGame(count, roomData = {}) {
    const clients = [];
    for (let i = 0; i < count; i++) clients.push(await makeClient());
    const [host, ...others] = clients;
    await delay(300);
    const created = await emitAck(host.socket, 'createRoom', {
        playerId: host.playerId, maxPlayers: 8, name: `Flow ${Date.now()}`, gameMode: 'insider', roundTime: 5, ...roomData
    });
    assert(created?.success, 'createRoom failed: ' + JSON.stringify(created));
    const roomId = created.roomId;
    host.socket.emit('setRoom', { roomId, playerId: host.playerId });
    for (const c of others) {
        const joined = await emitAck(c.socket, 'joinRoom', { roomId, playerId: c.playerId });
        assert(joined?.success, 'join failed');
        c.socket.emit('setRoom', { roomId, playerId: c.playerId });
    }
    await delay(600);
    const started = await emitAck(host.socket, 'startGameFromLobby', { roomId });
    assert(started?.success, 'start failed: ' + JSON.stringify(started));
    for (const c of clients) {
        const role = await waitFor(c, 'newRole');
        c.role = role.role;
        c.isGhost = !!role.isGhost;
        c.newRole = role;
    }
    const gm = clients.find(c => c.role === GM);
    const insider = clients.find(c => c.role === INSIDER);
    const commons = clients.filter(c => c !== gm && c !== insider);
    assert(gm && insider, 'roles not dealt (gm/insider)');
    return { clients, host, gm, insider, commons, roomId };
}

async function toQuestionPhase(game) {
    const { host, gm } = game;
    gm.socket.emit('revealWord');
    await waitFor(host, 'revealWord');
    await delay(2100); // cooldown ร่วมกับ startGame
    host.socket.emit('startGame');
    await waitFor(host, 'startGame');
}

async function guessAndEndDiscussion(game, guesser) {
    const { host, gm } = game;
    const mark = Date.now();
    gm.socket.emit('wordFound', { guesserId: guesser.playerId });
    const disc = await waitFor(host, 'insiderDiscussion', null, 5000, mark);
    assert(disc.guesserId === guesser.playerId, 'discussion guesser mismatch');
    gm.socket.emit('insiderEndDiscussion');
    return mark;
}

function closeAll(game) { game.clients.forEach(c => { try { c.socket.close(); } catch (e) {} }); }

async function scenarioA() {
    const game = await setupGame(5);
    await toQuestionPhase(game);
    const mark = await guessAndEndDiscussion(game, game.insider);
    const v1 = await waitFor(game.host, 'displayVote1', null, 5000, mark);
    assert(v1.progress.totalEligibleVoters === 4, 'vote1 voters = everyone but the guesser (Master included): ' + v1.progress.totalEligibleVoters);
    // ผู้ดำเนินเกม + 2 คน ว่า ใช่ (3/4), 1 คน ว่า ไม่ใช่
    const voters = game.clients.filter(c => c !== game.insider);
    voters.forEach((c, i) => c.socket.emit('vote1', { vote: i < 3 ? 'yes' : 'no' }));
    const result = await waitFor(game.host, 'vote2Ended', null, 8000, mark);
    assert(result.decidedBy === 'vote1' && result.hasWon === true, 'A: caught insider on vote 1: ' + JSON.stringify(result));
    assert(!seen(game.host, 'displayVote2', mark), 'A: no pointing vote after a successful vote 1');
    assert(result.guesserVote && result.guesserVote.yes === 3, 'A: vote 1 tally in result');
    await delay(400);
    const stats = readStats();
    assert(stats[game.gm.playerId].modeStats.insider.wins === 1, 'A: Master wins with the Commons');
    assert(stats[game.insider.playerId].modeStats.insider.losses === 1, 'A: Insider loses');
    console.log('A. vote 1 majority on the Insider-guesser → Master + Commons win ✓');
    closeAll(game);
}

async function scenarioB() {
    const game = await setupGame(4);
    await toQuestionPhase(game);
    const guesser = game.commons[0];
    const mark = await guessAndEndDiscussion(game, guesser);
    await waitFor(game.host, 'displayVote1', null, 5000, mark);
    game.clients.filter(c => c !== guesser).forEach(c => c.socket.emit('vote1', { vote: 'yes' }));
    const result = await waitFor(game.host, 'vote2Ended', null, 8000, mark);
    assert(result.decidedBy === 'vote1' && result.hasWon === false, 'B: wrong guesser accused → Insider wins: ' + JSON.stringify(result));
    console.log('B. vote 1 majority on a Common-guesser → Insider wins ✓');
    closeAll(game);
}

async function scenarioC() {
    const game = await setupGame(5);
    const { gm, insider, commons, host } = game;
    await toQuestionPhase(game);
    const [g, c1, c2] = commons;
    const mark = await guessAndEndDiscussion(game, g);
    await waitFor(host, 'displayVote1', null, 5000, mark);
    // 2 ใช่ จาก 4 = เสมอ ไม่ใช่เสียงข้างมาก
    gm.socket.emit('vote1', { vote: 'yes' });
    c1.socket.emit('vote1', { vote: 'yes' });
    insider.socket.emit('vote1', { vote: 'no' });
    c2.socket.emit('vote1', { vote: 'no' });
    const v1 = await waitFor(host, 'vote1Ended', null, 8000, mark);
    assert(v1.yes === 2 && v1.majority === false, 'C: 2 of 4 is not a majority');
    const v2 = await waitFor(host, 'displayVote2', d => !d.tiebreak, 5000, mark);
    assert(!v2.players.some(p => p.playerId === gm.playerId), 'C: Master not a suspect');
    // เสมอ I 2 – c2 2 · คนทายถูก (g) โหวต c1 (นอกคู่เสมอ) → ต้องถามคนทายถูก
    gm.socket.emit('vote2', { vote: insider.playerId });
    const prog = await waitFor(host, 'vote2Progress', p => p.voterChoices.some(v => v.voterId === gm.playerId), 5000, mark);
    assert(prog.totalEligibleVoters === 5, 'C: Master counts as a voter (5 voters)');
    c2.socket.emit('vote2', { vote: insider.playerId });
    insider.socket.emit('vote2', { vote: c2.playerId });
    c1.socket.emit('vote2', { vote: c2.playerId });
    g.socket.emit('vote2', { vote: c1.playerId });
    const tb = await waitFor(host, 'displayVote2', d => d.tiebreak, 8000, mark);
    assert(tb.players.length === 2 && tb.guesserId === g.playerId, 'C: tiebreak between the 2 tied, decided by the guesser');
    const errMark = Date.now();
    c1.socket.emit('vote2', { vote: insider.playerId });
    await waitFor(c1, 'voteError', null, 5000, errMark);
    g.socket.emit('vote2', { vote: insider.playerId });
    const result = await waitFor(host, 'vote2Ended', null, 8000, mark);
    assert(result.decidedBy === 'tiebreak' && result.hasWon === true && result.pickedName, 'C: guesser broke the tie: ' + JSON.stringify(result));
    console.log('C. vote 1 tie fails → point (Master votes) → tie → guesser decides ✓');
    closeAll(game);
}

async function scenarioD() {
    const game = await setupGame(4, { insiderGuesserVote: false });
    await toQuestionPhase(game);
    const mark = await guessAndEndDiscussion(game, game.commons[0]);
    await waitFor(game.host, 'displayVote2', null, 5000, mark);
    assert(!seen(game.host, 'displayVote1', mark), 'D: guesser vote is off → straight to the pointing vote');
    console.log('D. setting "vote on the guesser first" off → straight to vote 2 ✓');
    closeAll(game);
}

async function scenarioE() {
    const game = await setupGame(4);
    const masterName = game.gm.newRole.masterName;
    assert(masterName && game.clients.every(c => c.newRole.masterName === masterName), 'E: everyone learns who the Master is');
    const msg = await waitFor(game.commons[0], 'newMessage', m => m && /ผู้ดำเนินเกมรอบนี้/.test(m.message || ''), 5000);
    assert(msg.message.includes(masterName), 'E: chat announces the Master');
    assert(game.clients.every(c => c.newRole.role === GM || c.newRole.role === INSIDER || !c.newRole.insiderName), 'E: Insider stays secret');
    console.log('E. Master is public (newRole + chat), Insider secret ✓');
    closeAll(game);
}

async function scenarioF(serverRef) {
    // ถาม–ตอบ 12 วิ → ปิด server หลังเริ่ม 1 วิ → เปิดใหม่ → ต่อกลับ → นาฬิกาต้องเดินต่อจนหมดเวลา
    const game = await setupGame(4, { roundTime: 0.2 });
    await toQuestionPhase(game);
    await delay(800);
    closeAll(game);
    await stopServer(serverRef.child);
    serverRef.child = await bootServer();
    const back = [];
    for (const c of game.clients) back.push(await makeClient(c.playerId));
    back.forEach(c => c.socket.emit('setRoom', { roomId: game.roomId, playerId: c.playerId }));
    const ticks = [];
    const mark = Date.now();
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        back[0].events.filter(e => e.at >= mark && e.eventName === 'countdownUpdate').forEach(e => { if (!ticks.includes(e.payload)) ticks.push(e.payload); });
        if (seen(back[0], 'vote2Ended', mark)) break;
        await delay(200);
    }
    const ended = await waitFor(back[0], 'vote2Ended', null, 1000, mark);
    assert(ended.everyoneLoses && ended.timedOut, 'F: time ran out after restart → everyone loses: ' + JSON.stringify(ended));
    assert(ticks.length >= 2, 'F: countdown kept ticking after restart: ' + JSON.stringify(ticks));
    console.log(`F. restart mid-Q&A → clock resumed (${ticks.length} ticks) → time out = everyone loses ✓`);
    back.forEach(c => { try { c.socket.close(); } catch (e) {} });
}

async function scenarioG() {
    const game = await setupGame(4);
    const c = game.commons[0];
    const tab2 = await makeClient(c.playerId);
    tab2.socket.emit('setRoom', { roomId: game.roomId, playerId: c.playerId });
    await delay(600);
    tab2.socket.close();
    await delay(600);
    const mark = Date.now();
    game.gm.socket.emit('revealWord');
    await waitFor(c, 'revealWord', null, 5000, mark).catch(() => { throw new Error('G: first tab lost private events after the second tab closed'); });
    console.log('G. closing a second tab keeps private events on the first tab ✓');
    closeAll(game);
}

async function main() {
    PORT = Number(process.env.SMOKE_PORT) || await freePort();
    BASE = `http://127.0.0.1:${PORT}`;
    const serverRef = { child: await bootServer() };
    try {
        await scenarioE();
        await scenarioA();
        await scenarioB();
        await scenarioC();
        await scenarioD();
        await scenarioG();
        await scenarioF(serverRef);
        console.log('\n✅ INSIDER FLOW CHECKS PASSED (7 scenarios)');
    } finally {
        await stopServer(serverRef.child);
    }
    process.exit(0);
}

main().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
