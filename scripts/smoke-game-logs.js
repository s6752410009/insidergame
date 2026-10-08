#!/usr/bin/env node
/**
 * ทุกโหมดเกมต้องจด log หลังบ้านครบ: เริ่มเกม (รายชื่อ + ตั้งค่า), ออกกลางเกม, ถูกเตะ, จบโต๊ะ/จบกลางคัน
 * พร้อม roomId / roomName / gameMode ให้ตัวกรองหน้าแอดมินใช้ได้ — แล้วรีสตาร์ตเซิร์ฟเวอร์ log ต้องยังอยู่
 *
 *   ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-game-logs.js [mode ...]
 */

require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { getGameEngine } = require('../games/engineRegistry');

const ROOT = path.join(__dirname, '..');
const ALL_MODES = ['insider', 'werewolf', 'blackmarket', 'spyfall', 'undercover', 'coup', 'avalon', 'liar',
    'poker5', 'poker4', 'pokdeng', 'codenames', 'wavelength', 'drawguess', 'colorcards', 'setthi'];
const MODES = process.argv.slice(2).length ? process.argv.slice(2) : ALL_MODES;

let passed = 0;
const failures = [];
function check(condition, message) {
    if (condition) passed += 1;
    else failures.push(message);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.output = () => output;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + output.slice(-800))); }, 60000);
        child.stdout.on('data', chunk => {
            output += chunk;
            if (String(output).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}\n${output.slice(-800)}`)); });
    });
}

function stopServer(child) {
    return new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.removeAllListeners('exit');
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (error) { /* gone */ } resolve(); }, 8000);
    });
}

function request(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const req = http.request({ method, hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

function ack(socket, event, payload, timeoutMs = 15000) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
        const done = result => { clearTimeout(timer); resolve(result); };
        if (payload === undefined) socket.emit(event, done); else socket.emit(event, payload, done);
    });
}

function connect(base) {
    return new Promise(resolve => {
        const socket = io(base, { transports: ['websocket'], forceNew: true });
        socket.once('connect', () => resolve(socket));
    });
}

async function adminSocket(base) {
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
    const login = await request('POST', `${base}/admin/login`, `password=${encodeURIComponent(settings.adminPassword || 'admin123')}`,
        { 'content-type': 'application/x-www-form-urlencoded' });
    const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const page = await request('GET', `${base}/admin`, null, { cookie });
    const token = (/const adminToken = '([^']+)'/.exec(page.body) || [])[1];
    if (!token) throw new Error('admin token not found');
    const socket = await connect(base);
    const auth = await ack(socket, 'admin_authenticate', { token });
    if (!auth?.success) throw new Error('admin auth failed');
    return { socket, cookie };
}

async function roomLogs(admin, roomId, extra = {}) {
    const result = await ack(admin, 'admin_getLogs', { cat: 'all', roomId, limit: 500, ...extra });
    return result?.success ? result.logs : [];
}

async function waitForLog(admin, roomId, predicate, timeoutMs = 8000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const logs = await roomLogs(admin, roomId);
        const hit = logs.find(predicate);
        if (hit) return hit;
        await delay(300);
    }
    return null;
}

async function playMode(base, admin, mode, record) {
    const engine = getGameEngine(mode);
    const count = Math.min(Number(engine.maxPlayers) || 4, Math.max(Number(engine.minPlayers) || 3, 3) + 2);
    const players = [];
    for (let i = 0; i < count; i++) {
        const socket = await connect(base);
        const id = randomUUID();
        socket.emit('initPlayer', id);
        players.push({ socket, id });
    }
    await delay(400);
    const tag = `[${mode}]`;
    try {
        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: `Log ${mode}`, gameMode: mode, maxPlayers: Math.max(count, 6), password: 'secret-pass-123'
        });
        if (!created?.success) {
            check(false, `${tag} createRoom failed: ${JSON.stringify(created)}`);
            return;
        }
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const player of players.slice(1)) {
            const joined = await ack(player.socket, 'joinRoom', { roomId, playerId: player.id, password: 'secret-pass-123' });
            check(joined?.success, `${tag} join ok`);
            player.socket.emit('setRoom', { roomId, playerId: player.id });
        }
        await delay(600);
        if (mode === 'codenames') {
            const shuffled = await ack(players[0].socket, 'codenames_shuffleTeams', {});
            check(shuffled?.success, `${tag} สุ่มทีม`);
            await delay(300);
        }

        const started = await ack(players[0].socket, 'startGameFromLobby', { roomId });
        check(started?.success, `${tag} startGameFromLobby: ${JSON.stringify(started)}`);
        const start = await waitForLog(admin, roomId, log => log.meta?.event === 'game_start', 9000);
        check(Boolean(start), `${tag} มี log game_start`);
        if (start) {
            check(start.gameMode === mode && start.roomName === `Log ${mode}` && start.roomId === roomId, `${tag} start มี roomId/roomName/gameMode`);
            check(start.important === true && start.bucket === 'game', `${tag} start อยู่ถัง game + สำคัญ`);
            check(Number(start.meta.playerCount) === count, `${tag} start นับคน ${start.meta.playerCount}/${count}`);
            check(typeof start.meta.players === 'string' && start.meta.players.split(',').length === count, `${tag} start มีรายชื่อผู้เล่น`);
            check(typeof start.meta.settings === 'string' && start.meta.settings.length > 0, `${tag} start มีตั้งค่าห้อง`);
            check(!JSON.stringify(start).includes('secret-pass-123'), `${tag} ไม่จดรหัสผ่านห้อง`);
        }

        // คนสุดท้ายกดออกกลางเกม
        const leaver = players[players.length - 1];
        await ack(leaver.socket, 'leaveRoom', { roomId, playerId: leaver.id });
        const left = await waitForLog(admin, roomId, log => log.meta?.event === 'player_left_midgame' && log.meta.playerId === leaver.id);
        check(Boolean(left), `${tag} มี log ออกกลางเกม`);
        if (left) {
            check(left.category === 'leave' && left.gameMode === mode && left.important === true && left.meta.reason === 'leave', `${tag} ออกกลางเกม: leave/สำคัญ/เหตุผล`);
        }
        const dupLeave = (await roomLogs(admin, roomId)).filter(log => log.category === 'leave' && log.meta?.playerId === leaver.id);
        check(dupLeave.length === 1, `${tag} ออกครั้งเดียว log บรรทัดเดียว (${dupLeave.length})`);

        // หัวห้องเตะอีกคน
        const target = players[players.length - 2];
        const kicked = await ack(players[0].socket, 'kickPlayer', { targetPlayerId: target.id });
        if (kicked?.success) {
            const kick = await waitForLog(admin, roomId, log => log.meta?.event === 'player_kicked' && log.meta.playerId === target.id);
            check(Boolean(kick) && kick.important === true && kick.gameMode === mode, `${tag} มี log ถูกเตะ`);
        } else {
            check(false, `${tag} kickPlayer: ${JSON.stringify(kicked)}`);
        }

        // หัวห้องจบโต๊ะ — เกมจบกลางคัน หรือจบไปแล้วเพราะคนไม่พอ
        await ack(players[0].socket, 'endTableSession', { roomId });
        const terminal = await waitForLog(admin, roomId, log => ['game_end', 'game_abort', 'table_end'].includes(log.meta?.event)
            && log.meta?.event !== 'game_start');
        check(Boolean(terminal), `${tag} มี log จบเกม/จบโต๊ะ`);
        const all = await roomLogs(admin, roomId);
        check(all.every(log => log.roomId === roomId && log.roomName === `Log ${mode}` && (log.gameMode === mode || log.category === 'admin')),
            `${tag} ทุกบรรทัดของห้องมีชื่อห้อง + โหมดเกม`);
        check(all.filter(log => log.category === 'error').length === 0, `${tag} ไม่มี error: ${all.filter(log => log.category === 'error').map(log => log.message).join(' | ')}`);
        record.push({ mode, roomId, events: all.map(log => log.meta?.event).filter(Boolean) });
    } finally {
        players.forEach(player => player.socket.close());
    }
}

(async () => {
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    let server = await bootServer(port);
    const record = [];
    try {
        let admin = await adminSocket(base);
        for (const mode of MODES) {
            await playMode(base, admin.socket, mode, record);
            console.log(`  ${mode}: ${record.find(r => r.mode === mode)?.events.join(', ') || '(failed)'}`);
        }

        // ดาวน์โหลดผ่าน HTTP ต้องใช้ session แอดมิน
        const denied = await request('GET', `${base}/admin/api/logs/export?cat=all`);
        check(denied.status === 401, `export ต้อง login (${denied.status})`);
        const exported = await request('GET', `${base}/admin/api/logs/export?cat=important`, null, { cookie: admin.cookie });
        check(exported.status === 200 && exported.body.includes('เริ่มเกม'), 'export ของแอดมินได้ไฟล์');
        // socket ที่ไม่ได้ยืนยันตัวเป็นแอดมินขอ log ไม่ได้
        const stranger = await connect(base);
        const strangerLogs = await ack(stranger, 'admin_getLogs', { cat: 'all' });
        check(strangerLogs && strangerLogs.success === false, 'socket ทั่วไปขอ log ไม่ได้');
        const strangerClear = await ack(stranger, 'admin_clearLogs');
        check(strangerClear && strangerClear.success === false, 'socket ทั่วไปล้าง log ไม่ได้');
        stranger.close();
        admin.socket.close();

        // รีสตาร์ต: log ของทุกห้องต้องยังอยู่ (JSON fallback ใน GAME_DATA_DIR)
        await stopServer(server);
        server = await bootServer(port);
        admin = await adminSocket(base);
        for (const entry of record) {
            const logs = await roomLogs(admin.socket, entry.roomId);
            const events = logs.map(log => log.meta?.event).filter(Boolean);
            check(events.includes('game_start') && events.includes('player_left_midgame'), `[${entry.mode}] รีสตาร์ตแล้ว log ยังอยู่ (${events.length})`);
        }
        admin.socket.close();
    } finally {
        await stopServer(server);
    }

    if (failures.length) {
        console.error(`❌ game-logs: ${failures.length} failed, ${passed} passed`);
        failures.forEach(message => console.error('  - ' + message));
        process.exit(1);
    }
    console.log(`✅ game-logs: ${passed} assertions passed (${MODES.length} modes)`);
    process.exit(0);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
