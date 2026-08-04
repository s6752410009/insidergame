/**
 * ทดสอบว่ากระดาน Insider ฟื้นตัวหลังเน็ตหลุด (มือถือสลับแอปไป LINE แล้วกลับมา)
 *
 * บัคที่กันไว้: board.ejs ผูก logic กู้เกม (initPlayer/setRoom) ไว้กับ
 * socket.on('reconnect') ซึ่ง socket.io v4 ไม่ยิงบนตัว socket แล้ว —
 * เน็ตสะดุดครั้งเดียว socket ฝั่ง server ไม่รู้จักผู้เล่น/ห้องอีกเลย
 * แชทส่งไม่ออก (server เงียบทิ้ง) และไม่ได้รับอะไรจากห้องอีก จนกว่าจะ refresh
 *
 * วิธีทดสอบ: เปิดกระดานในเบราว์เซอร์จริง → ตัดเน็ตด้วย context.setOffline →
 * ต่อกลับ → แชทต้องไหลทั้งสองทิศ (เบราว์เซอร์→เพื่อน และ เพื่อน→เบราว์เซอร์)
 *
 * รัน: node scripts/smoke-insider-reconnect.js
 */

require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getFreePort() {
    return new Promise(resolve => {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
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
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server startup timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', chunk => {
            logs += String(chunk);
            if (String(chunk).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', chunk => { logs += String(chunk); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ack timeout ' + event)), 20000);
        socket.emit(event, payload, response => { clearTimeout(timer); resolve(response); });
    });
}

function connectSocket(baseUrl) {
    return new Promise((resolve, reject) => {
        const socket = io(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
        const timer = setTimeout(() => reject(new Error('socket connect timeout')), 20000);
        socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    });
}

async function waitForChat(messages, text, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (messages.some(m => m.message === text)) return true;
        await delay(250);
    }
    return false;
}

async function sendChatFromBrowser(page, text) {
    // เปิดกล่องแชทถ้ายังไม่เปิด แล้วส่งผ่าน UI จริง
    await page.evaluate(msg => {
        const $ = window.jQuery;
        if (!$('#chatBox').is(':visible')) $('#toggleChat').trigger('click');
        $('#chatInput').val(msg);
        $('#sendChat').trigger('click');
    }, text);
}

async function main() {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();

    try {
        // ตั้งห้อง insider 3 คน: hero (เบราว์เซอร์) + เพื่อน 2 คน (raw socket)
        const heroId = randomUUID();
        const friends = [];
        for (let i = 0; i < 2; i++) {
            const socket = await connectSocket(base);
            const playerId = randomUUID();
            socket.emit('initPlayer', playerId);
            const chats = [];
            socket.on('newMessage', m => chats.push(m));
            friends.push({ socket, playerId, chats });
        }
        const heroSocket = await connectSocket(base);
        heroSocket.emit('initPlayer', heroId);
        await delay(500);

        const created = await emitAck(heroSocket, 'createRoom', {
            playerId: heroId, name: `ReconnectSmoke ${Date.now()}`,
            gameMode: 'insider', maxPlayers: 8, roundTime: 5
        });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        heroSocket.emit('setRoom', { roomId, playerId: heroId });
        for (const f of friends) {
            assert((await emitAck(f.socket, 'joinRoom', { roomId, playerId: f.playerId })).success, 'join failed');
            f.socket.emit('setRoom', { roomId, playerId: f.playerId });
        }
        await delay(800);
        assert((await emitAck(heroSocket, 'startGameFromLobby', { roomId })).success, 'start failed');
        await delay(2500);
        // เบราว์เซอร์จะเข้ามาแทน hero — ปิด socket ดิบทิ้งกัน id ชนกัน
        heroSocket.close();
        console.log('1. ห้อง insider เริ่มเกมแล้ว:', roomId);

        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${base}/game/${roomId}?playerId=${heroId}`, { waitUntil: 'networkidle' });
        await delay(2500);

        // แชทก่อนหลุดต้องถึงเพื่อน
        await sendChatFromBrowser(page, 'ก่อนหลุด');
        assert(await waitForChat(friends[0].chats, 'ก่อนหลุด'), 'แชทปกติ (ก่อนหลุด) ไม่ถึงเพื่อน — setup พัง');
        console.log('2. แชทก่อนหลุดถึงเพื่อน ✓');

        // ตัดเน็ต → รอ socket ตาย → ต่อกลับ → รอ reconnect
        await context.setOffline(true);
        await delay(3500);
        await context.setOffline(false);
        await delay(5000);
        console.log('3. ตัดเน็ตแล้วต่อกลับ (จำลองสลับแอปมือถือ)');

        // ทิศ 1: เบราว์เซอร์ → เพื่อน (บนโค้ดเก่า server ทิ้งเงียบเพราะ socket ไม่มี roomId)
        await sendChatFromBrowser(page, 'หลังต่อใหม่');
        assert(await waitForChat(friends[0].chats, 'หลังต่อใหม่'),
            'แชทหลัง reconnect หายเงียบ — กระดานไม่ re-bind ห้องหลังเน็ตหลุด');
        console.log('4. แชท เบราว์เซอร์→เพื่อน หลัง reconnect ✓');

        // ทิศ 2: เพื่อน → เบราว์เซอร์ (พิสูจน์ว่ากลับเข้า room channel จริง)
        friends[1].socket.emit('sendMessage', { message: 'เพื่อนทักหลังหลุด' });
        const received = await page.waitForFunction(
            () => document.body.innerText.includes('เพื่อนทักหลังหลุด'),
            { timeout: 12000 }
        ).then(() => true).catch(() => false);
        assert(received, 'เบราว์เซอร์ไม่ได้รับแชทจากเพื่อนหลัง reconnect — ไม่ได้กลับเข้า room channel');
        console.log('5. แชท เพื่อน→เบราว์เซอร์ หลัง reconnect ✓');

        friends.forEach(f => f.socket.close());
        console.log('\n✅ INSIDER RECONNECT CHECKS PASSED');
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
}

main().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
