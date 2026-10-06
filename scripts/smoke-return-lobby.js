/**
 * "กลับห้องรอ" หลังจบเกม (returnFinishedToLobby — ใช้ร่วมกันหลายโหมด)
 *
 * บัคเดิม: ใครกดก็ได้ ดึงทั้งวงออกจากหน้าผลกลับห้องรอ
 * ตอนนี้:
 *   1. คนที่ไม่ใช่หัวห้องพาทั้งวงกลับไม่ได้ — ได้เหตุผลภาษาไทย + canReturnSelf (client พากลับคนเดียว)
 *      และไม่มีใครโดน redirect
 *   2. หัวห้องพาทุกคนกลับได้
 *   3. ไม่มีใครกดอะไร → นับถอยหลังกลับห้องอัตโนมัติยังทำงาน
 *
 * ใช้ป๊อกเด้งเพราะหัวห้องจบโต๊ะได้ทันที (pokdeng_end)
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-return-lobby.js
 */

require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function getFreePort() {
    if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
    return new Promise(resolve => {
        const srv = require('net').createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    });
}

function ack(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ack timeout: ' + event)), 15000);
        socket.emit(event, payload, r => { clearTimeout(t); resolve(r); });
    });
}

function connect(base) {
    return new Promise((resolve, reject) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        const t = setTimeout(() => reject(new Error('socket connect timeout')), 15000);
        s.once('connect', () => { clearTimeout(t); resolve(s); });
    });
}

async function waitFor(fn, ms, label) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await delay(100);
    }
    throw new Error('timeout: ' + label);
}

async function main() {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const players = [];
    try {
        for (let i = 0; i < 3; i++) {
            const socket = await connect(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const p = { socket, id, states: [], redirects: 0, countdowns: 0 };
            socket.on('pokdengState', s => p.states.push(s));
            socket.on('redirectToLobby', () => { p.redirects += 1; });
            socket.on('returnToLobby', () => { p.countdowns += 1; });
            players.push(p);
        }
        await delay(400);
        const [host, p1, p2] = players;
        const last = p => p.states[p.states.length - 1];
        const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'กลับห้องรอ', gameMode: 'pokdeng', maxPlayers: 6 });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        host.socket.emit('setRoom', { roomId, playerId: host.id });
        for (const p of [p1, p2]) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join failed');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(400);

        async function playAndEnd() {
            players.forEach(p => { p.states.length = 0; });
            assert((await ack(host.socket, 'startGameFromLobby', { roomId }))?.success, 'start failed');
            await waitFor(() => last(p1)?.phase === 'bet', 15000, 'bet phase');
            assert((await ack(host.socket, 'pokdeng_end', {}))?.success, 'หัวห้องจบโต๊ะไม่ได้');
            await waitFor(() => last(p1)?.phase === 'finished', 8000, 'finished');
        }

        // 1. คนทั่วไปพาทั้งวงกลับไม่ได้
        await playAndEnd();
        const denied = await ack(p1.socket, 'returnFinishedToLobby', { roomId });
        assert(denied && denied.success === false, 'คนที่ไม่ใช่หัวห้องพาทุกคนกลับห้องได้: ' + JSON.stringify(denied));
        assert(denied.canReturnSelf === true, 'ไม่บอก client ให้กลับห้องเฉพาะตัวเอง');
        assert(/หัวห้อง/.test(denied.error || ''), 'ไม่มีเหตุผลภาษาไทย: ' + denied.error);
        await delay(1500);
        assert(players.every(p => p.redirects === 0), 'คนที่ไม่ใช่หัวห้องกดแล้วมีคนโดนพากลับห้อง');
        console.log('1. คนทั่วไปกด → ปฏิเสธพร้อมเหตุผล + canReturnSelf, ไม่มีใครโดนดึง ✓');

        // 2. หัวห้องพาทุกคนกลับได้
        const ok = await ack(host.socket, 'returnFinishedToLobby', { roomId });
        assert(ok?.success, 'หัวห้องพาทุกคนกลับไม่ได้: ' + JSON.stringify(ok));
        await waitFor(() => players.every(p => p.redirects === 1), 4000, 'ทุกคนกลับห้อง');
        console.log('2. หัวห้องกด → ทุกคนกลับห้องรอ ✓');

        // 3. ไม่มีใครกด → กลับห้องอัตโนมัติ
        await delay(600);
        players.forEach(p => { p.countdowns = 0; });
        await playAndEnd();
        await waitFor(() => players.every(p => p.countdowns >= 1), 5000, 'มีนับถอยหลังกลับห้อง');
        await waitFor(() => players.every(p => p.redirects === 2), 15000, 'กลับห้องอัตโนมัติ');
        console.log('3. ไม่มีใครกด → นับถอยหลังแล้วกลับห้องเอง ✓');

        players.forEach(p => { try { p.socket.close(); } catch {} });
    } finally {
        server.kill('SIGTERM');
    }
    console.log('\n✅ RETURN-TO-LOBBY CHECKS PASSED');
    process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
