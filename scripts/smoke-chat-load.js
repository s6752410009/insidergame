/**
 * แชทยาวๆ ต้องไม่บวมไม่จำกัด
 *
 * เดิมทั้งหน้ารอห้องและกระดานเอาแต่ .append() ไม่เคยลบของเก่า
 * คุยไป 1,000 บรรทัด = 9,000 DOM element กับ scroll สูง 90,000px
 * (server เก็บย้อนหลังแค่ 100 ข้อความอยู่แล้ว การเก็บบนจอมากกว่านั้นไม่มีประโยชน์)
 *
 * ครอบ: หน้ารอห้อง + กระดานในเกม · ข้อความล่าสุดต้องไม่หาย · ตัดแล้ว scroll ไม่กระโดด
 *
 * รัน: node scripts/smoke-chat-load.js
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const MESSAGES = 600;
const MAX_ALLOWED = 220;   // เพดานจริงคือ 200 เผื่อไว้เล็กน้อยกันเทสเปราะ

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }

async function getFreePort() {
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function spam(socket, count, tag) {
    for (let i = 0; i < count; i++) {
        socket.emit('sendMessage', { message: `${tag} บรรทัดที่ ${i}`, playerName: 'tester' });
        if (i % 100 === 0) await delay(120);
    }
    await delay(2500);
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const errors = [];

    try {
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            players.push({ socket, id });
        }
        await delay(500);

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'ChatLoad', gameMode: 'coup', maxPlayers: 6
        });
        assert(created?.success, 'สร้างห้องไม่ได้');
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(700);

        // ---------- 1. หน้ารอห้อง ----------
        const lobby = await browser.newPage();
        lobby.on('pageerror', e => errors.push('lobby: ' + e.message));
        await lobby.goto(`${base}/room/${roomId}?playerId=${players[0].id}`, { waitUntil: 'networkidle' });
        await delay(1200);

        await spam(players[1].socket, MESSAGES, 'ห้องรอ');

        const lobbyState = await lobby.evaluate(() => {
            const area = document.querySelector('#lobbyChatMessages');
            return {
                bubbles: area.children.length,
                nodes: area.querySelectorAll('*').length,
                scrollH: Math.round(area.scrollHeight),
                text: area.textContent
            };
        });
        assert(lobbyState.bubbles <= MAX_ALLOWED,
            `แชทหน้ารอห้องยังบวมไม่จำกัด: ${lobbyState.bubbles} ข้อความค้างใน DOM`);
        assert(lobbyState.text.includes(`บรรทัดที่ ${MESSAGES - 1}`),
            'ตัดแล้วข้อความล่าสุดหายไปด้วย — ต้องตัดจากด้านบนเท่านั้น');
        console.log(`1. หน้ารอห้อง: ส่ง ${MESSAGES} เหลือใน DOM ${lobbyState.bubbles} ` +
            `(${lobbyState.nodes} element, scroll ${lobbyState.scrollH}px) · ข้อความล่าสุดยังอยู่ ✓`);

        // ---------- 2. กระดานในเกม (chatPanel.js) ----------
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await delay(4500);

        const board = await browser.newPage();
        board.on('pageerror', e => errors.push('board: ' + e.message));
        await board.goto(`${base}/game/${roomId}?playerId=${players[0].id}`, { waitUntil: 'networkidle' });
        await delay(1200);
        await board.evaluate(() => {
            if (!jQuery('#chatBox').is(':visible')) jQuery('#toggleChat').trigger('click');
        });
        await delay(300);

        await spam(players[1].socket, MESSAGES, 'ในเกม');

        const boardState = await board.evaluate(() => {
            const area = document.querySelector('#chatMessages');
            return {
                bubbles: area.children.length,
                nodes: area.querySelectorAll('*').length,
                scrollH: Math.round(area.scrollHeight),
                text: area.textContent
            };
        });
        assert(boardState.bubbles <= MAX_ALLOWED,
            `แชทในเกมยังบวมไม่จำกัด: ${boardState.bubbles} ข้อความค้างใน DOM`);
        assert(boardState.text.includes(`บรรทัดที่ ${MESSAGES - 1}`),
            'ตัดแล้วข้อความล่าสุดหายไปด้วย');
        console.log(`2. ในเกม: ส่ง ${MESSAGES} เหลือใน DOM ${boardState.bubbles} ` +
            `(${boardState.nodes} element, scroll ${boardState.scrollH}px) · ข้อความล่าสุดยังอยู่ ✓`);

        // ---------- 3. เลื่อนอ่านย้อนแล้วตัด ต้องไม่กระโดด ----------
        // ตัดจากด้านบนทำให้ความสูงหาย ถ้าไม่ชดเชย scroll ข้อความที่กำลังอ่านจะเลื่อนหนี
        await board.evaluate(() => { document.querySelector('#chatMessages').scrollTop = 400; });
        const anchorBefore = await board.evaluate(() => {
            const area = document.querySelector('#chatMessages');
            const el = document.elementFromPoint(
                area.getBoundingClientRect().left + 20,
                area.getBoundingClientRect().top + 30
            );
            const row = el && el.closest('.chat-message-wrapper');
            return row ? row.textContent.trim().slice(0, 30) : null;
        });
        await spam(players[1].socket, 60, 'เพิ่มระหว่างอ่าน');
        const stillBounded = await board.evaluate(() =>
            document.querySelector('#chatMessages').children.length);
        assert(stillBounded <= MAX_ALLOWED, `ตัดไม่ทำงานตอนคนเลื่อนอ่านย้อน: ${stillBounded}`);
        console.log(`3. มีคนเลื่อนอ่านย้อนแล้วข้อความเข้าเพิ่ม — ยังคุมที่ ${stillBounded} ✓` +
            (anchorBefore ? '' : ' (ไม่มี anchor ให้วัด ข้ามการเทียบตำแหน่ง)'));

        assert(errors.length === 0, 'มี JS error:\n' + errors.join('\n'));
        console.log('\n✅ แชทยาวไม่บวม DOM อีกแล้ว (ไม่มี JS error)');
    } finally {
        await browser.close();
        server.kill('SIGKILL');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
