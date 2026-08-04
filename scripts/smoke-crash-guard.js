/**
 * เซิร์ฟเวอร์ต้องไม่ล้มทั้งตัวเพราะ handler เดียว throw
 *
 * socket.io ไม่ห่อ handler ด้วย try/catch — error ลอยขึ้นเป็น uncaughtException
 * แล้ว Node ปิดโปรเซส = ผู้เล่นทุกห้องหลุดพร้อมกัน (มี 22 handler ที่ไม่มี try/catch)
 * ตัวนี้ยิง payload พิลึกใส่ handler เหล่านั้นแล้วเช็คว่าเว็บยังตอบอยู่
 *
 * รัน: node scripts/smoke-crash-guard.js
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
    return new Promise(resolve => {
        const srv = require('net').createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

(async () => {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('server timeout')), 30000);
        child.stdout.on('data', c => { if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(); } });
    });
    const base = `http://127.0.0.1:${port}`;
    const alive = async () => { try { return (await fetch(base + '/rooms', { redirect: 'manual' })).status; } catch { return 0; } };

    try {
        const before = await alive();
        if (before !== 200 && before !== 302) throw new Error('เซิร์ฟเวอร์ไม่พร้อมตั้งแต่แรก: ' + before);

        const socket = io(base, { transports: ['websocket'], forceNew: true });
        await new Promise(r => socket.once('connect', r));

        // payload พิลึกใส่ handler ที่ไม่มี try/catch
        const junk = [null, undefined, 0, '', [], 'string', { roomId: {} }, { playerId: [] }];
        const events = ['initPlayer', 'setRoom', 'checkRoomStatus', 'requestRoomUpdate', 'getRoomList',
            'leaveRoom', 'sendMessage', 'vote1', 'vote2', 'setWord', 'getWordSuggestions', 'wordFound',
            'displayVote2', 'revealWord', 'resetGame', 'startGame', 'gmReaction',
            'werewolf_requestState', 'spyfall_requestState', 'blackmarket_requestState',
            'werewolf_admin_request_roles', 'admin_request_word_roles'];
        for (const event of events) for (const payload of junk) socket.emit(event, payload);
        await delay(3000);

        const after = await alive();
        socket.close();
        if (after !== 200 && after !== 302) {
            console.error(`❌ เซิร์ฟเวอร์ล้มหลังยิง ${events.length} events (HTTP ${after}) — ผู้เล่นทุกห้องจะหลุดพร้อมกัน`);
            process.exit(1);
        }
        console.log(`✅ ยิง ${events.length} events × ${junk.length} payload พิลึก แล้วเซิร์ฟเวอร์ยังตอบปกติ (HTTP ${after})`);
        process.exit(0);
    } finally {
        child.kill('SIGTERM');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
