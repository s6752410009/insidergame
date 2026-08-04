/**
 * เปิดทุกหน้าเกมด้วยเบราว์เซอร์จริง แล้วดักว่ามี JS error หรือรูปโหลดไม่ขึ้นไหม
 *
 * static analysis จับได้แค่ชื่อฟังก์ชันหาย แต่จับ runtime error อย่าง
 * "x is not a function" / "undefined is not an object" ไม่ได้
 * สคริปต์นี้เล่นจนถึงกระดานเกมของทุกโหมด แล้วอ่าน console + network จริง
 *
 * รัน: node scripts/smoke-boards-console.js
 */

const { DATA_DIR: TEST_DATA_DIR } = require('./isolateTestData');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const SERVER_TIMEOUT_MS = 30000;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function request(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function getFreePort() {
    return new Promise(resolve => {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function spawnServer() {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server startup timeout')), SERVER_TIMEOUT_MS);
        child.stdout.on('data', chunk => {
            if (String(chunk).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(); }
        });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    });
    const deadline = Date.now() + SERVER_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try { await request(`http://127.0.0.1:${port}/rooms`); break; } catch { await delay(200); }
    }
    return { port, baseUrl: `http://127.0.0.1:${port}`, child };
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ack timeout ' + event)), 20000);
        socket.emit(event, payload, response => { clearTimeout(timer); resolve(response); });
    });
}

function connect(baseUrl) {
    return new Promise((resolve, reject) => {
        const socket = io(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
        const timer = setTimeout(() => reject(new Error('connect timeout')), 20000);
        socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    });
}

// เริ่มเกมโหมดที่กำหนด แล้วคืน roomId + playerId ของหัวห้อง
async function startGameRoom(baseUrl, gameMode, playerCount) {
    const players = [];
    for (let i = 0; i < playerCount; i++) {
        const socket = await connect(baseUrl);
        const playerId = randomUUID();
        socket.emit('initPlayer', playerId);
        players.push({ socket, playerId });
    }
    await delay(600);

    const created = await emitAck(players[0].socket, 'createRoom', {
        playerId: players[0].playerId,
        name: `ConsoleCheck-${gameMode}-${Date.now()}`,
        gameMode,
        maxPlayers: 10,
        roundTime: 5
    });
    assert(created?.success, `createRoom ${gameMode} failed: ${JSON.stringify(created)}`);
    const roomId = created.roomId;

    players.forEach(p => p.socket.emit('setRoom', { roomId, playerId: p.playerId }));
    for (const p of players.slice(1)) {
        const joined = await emitAck(p.socket, 'joinRoom', { roomId, playerId: p.playerId });
        assert(joined?.success, `joinRoom ${gameMode} failed`);
    }
    await delay(900);

    const started = await emitAck(players[0].socket, 'startGameFromLobby', { roomId });
    assert(started?.success, `startGame ${gameMode} failed: ${JSON.stringify(started)}`);
    await delay(3000);

    return { roomId, playerId: players[0].playerId, players };
}

// ข้อความ console ที่ไม่เกี่ยวกับโค้ดเรา
// bgm.mp3 ขึ้น ERR_ABORTED ทุกหน้าเพราะเบราว์เซอร์บล็อก autoplay แล้วยกเลิกก่อนโหลด
// วัดแล้วโหลดจริง 0 ไบต์ ไม่ใช่ปัญหา band-width
const IGNORE = /favicon|manifest|service-worker|Download the React|sourcemap|net::ERR_INTERNET|autoplay|play\(\) failed|AudioContext|preload|\.mp3/i;

async function inspectPage(browser, url, label) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const badRequests = [];

    page.on('pageerror', error => errors.push(`[pageerror] ${error.message}`));
    page.on('console', message => {
        if (message.type() === 'error' && !IGNORE.test(message.text())) {
            errors.push(`[console] ${message.text()}`);
        }
    });
    page.on('requestfailed', req => {
        if (!IGNORE.test(req.url())) badRequests.push(`${req.url()} (${req.failure()?.errorText})`);
    });
    page.on('response', res => {
        if (res.status() >= 400 && !IGNORE.test(res.url())) badRequests.push(`${res.url()} -> HTTP ${res.status()}`);
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await delay(2500);

    // รูปที่ใส่ src แล้วแต่โหลดไม่ขึ้น
    const brokenImages = await page.evaluate(() =>
        Array.from(document.images)
            .filter(img => img.getAttribute('src') && !img.complete === false && img.naturalWidth === 0)
            .map(img => img.getAttribute('src'))
    );

    await context.close();
    return { label, errors, badRequests, brokenImages };
}

async function main() {
    const server = await spawnServer();
    console.log(`server: ${server.baseUrl} (data: ${TEST_DATA_DIR})`);
    const browser = await chromium.launch();
    const results = [];
    const openSockets = [];

    try {
        const guestId = randomUUID();
        results.push(await inspectPage(browser, `${server.baseUrl}/rooms?playerId=${guestId}`, 'rooms (lobby)'));
        results.push(await inspectPage(browser, `${server.baseUrl}/?playerId=${guestId}`, 'home'));
        results.push(await inspectPage(browser, `${server.baseUrl}/profile?playerId=${guestId}`, 'profile'));
        results.push(await inspectPage(browser, `${server.baseUrl}/support?playerId=${guestId}`, 'support'));

        for (const [mode, count] of [['insider', 4], ['spyfall', 4], ['werewolf', 5], ['blackmarket', 5]]) {
            const room = await startGameRoom(server.baseUrl, mode, count);
            room.players.forEach(p => openSockets.push(p.socket));
            results.push(await inspectPage(
                browser,
                `${server.baseUrl}/game/${room.roomId}?playerId=${room.playerId}`,
                `board: ${mode}`
            ));
        }
    } finally {
        await browser.close();
        openSockets.forEach(socket => socket.close());
        server.child.kill('SIGTERM');
    }

    let failed = 0;
    results.forEach(result => {
        const problems = result.errors.length + result.badRequests.length + result.brokenImages.length;
        if (problems === 0) {
            console.log(`  ✓ ${result.label}`);
            return;
        }
        failed += 1;
        console.log(`  ✗ ${result.label}`);
        result.errors.slice(0, 5).forEach(e => console.log(`      JS  ${e}`));
        [...new Set(result.badRequests)].slice(0, 5).forEach(r => console.log(`      NET ${r}`));
        [...new Set(result.brokenImages)].slice(0, 5).forEach(i => console.log(`      IMG ${i}`));
    });

    if (failed > 0) {
        console.error(`\n❌ ${failed}/${results.length} หน้ามีปัญหา`);
        process.exit(1);
    }
    console.log(`\n✅ ทุกหน้าไม่มี JS error / asset พัง (${results.length} หน้า)`);
    process.exit(0);
}

main().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
