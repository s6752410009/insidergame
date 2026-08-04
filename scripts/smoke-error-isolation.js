/**
 * error ใน handler ต้องกระทบแค่ "คนที่กด" เท่านั้น
 *
 * เดิม socket handler ที่ throw จะฆ่าโปรเซสทั้งตัว (ทุกห้องหลุด)
 * ตอนนี้ห่อด้วย safeOn แล้ว ตัวนี้ยืนยันสามข้อ:
 *   1. คนกดได้ ack กลับ ไม่ค้างรอตลอดกาล
 *   2. คนอื่นในห้องเดียวกันยังแชท/เล่นต่อได้ทันที
 *   3. ห้องอื่นไม่รู้สึกอะไรเลย
 *
 * รัน: node scripts/smoke-error-isolation.js
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }

async function getFreePort() {
    return new Promise(res => {
        const srv = require('net').createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
    });
}
function emitAck(s, e, p, ms = 8000) {
    return new Promise(res => { const t = setTimeout(() => res({ __timeout: true }), ms); s.emit(e, p, r => { clearTimeout(t); res(r); }); });
}
function connect(base) {
    return new Promise((res, rej) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        const t = setTimeout(() => rej(new Error('connect timeout')), 15000);
        s.once('connect', () => { clearTimeout(t); res(s); });
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

    try {
        // ห้อง A: victim (คนที่จะยิง payload พัง) + bystander (คนในห้องเดียวกัน)
        const victim = { socket: await connect(base), id: randomUUID() };
        const bystander = { socket: await connect(base), id: randomUUID(), chats: [] };
        bystander.socket.on('newMessage', m => bystander.chats.push(m));
        victim.socket.emit('initPlayer', victim.id);
        bystander.socket.emit('initPlayer', bystander.id);
        await delay(400);

        const roomA = await emitAck(victim.socket, 'createRoom', {
            playerId: victim.id, name: 'IsolationA', gameMode: 'insider', maxPlayers: 8, roundTime: 5
        });
        assert(roomA?.success, 'สร้างห้อง A ไม่ได้');
        victim.socket.emit('setRoom', { roomId: roomA.roomId, playerId: victim.id });
        assert((await emitAck(bystander.socket, 'joinRoom', { roomId: roomA.roomId, playerId: bystander.id }))?.success, 'join ห้อง A ไม่ได้');
        bystander.socket.emit('setRoom', { roomId: roomA.roomId, playerId: bystander.id });

        // ห้อง B: คนละห้องไปเลย
        const outsider = { socket: await connect(base), id: randomUUID() };
        outsider.socket.emit('initPlayer', outsider.id);
        await delay(400);
        const roomB = await emitAck(outsider.socket, 'createRoom', {
            playerId: outsider.id, name: 'IsolationB', gameMode: 'insider', maxPlayers: 8, roundTime: 5
        });
        assert(roomB?.success, 'สร้างห้อง B ไม่ได้');
        outsider.socket.emit('setRoom', { roomId: roomB.roomId, playerId: outsider.id });
        await delay(800);

        // 1. victim ยิง payload พังใส่ handler ที่มี callback — ต้องได้ ack กลับ ไม่ค้าง
        const junkEvents = ['setWord', 'getWordSuggestions', 'leaveRoom', 'werewolf_admin_request_roles'];
        const acks = [];
        for (const ev of junkEvents) acks.push([ev, await emitAck(victim.socket, ev, null, 6000)]);
        const stuck = acks.filter(([, r]) => r && r.__timeout).map(([e]) => e);
        assert(stuck.length === 0, `client ค้างรอ ack: ${stuck.join(', ')}`);
        console.log(`1. ยิง payload พัง ${junkEvents.length} events → ได้ ack กลับครบ ไม่ค้าง ✓`);

        // ยิงชุดใหญ่ใส่ handler ที่ไม่มี callback ด้วย
        for (const ev of ['initPlayer', 'setRoom', 'checkRoomStatus', 'vote1', 'vote2', 'sendMessage', 'startGame', 'resetGame', 'gmReaction'])
            for (const junk of [null, 0, '', [], { roomId: {} }]) victim.socket.emit(ev, junk);
        await delay(2000);

        // 2. คนในห้องเดียวกันยังใช้งานได้
        bystander.chats.length = 0;
        bystander.socket.emit('sendMessage', { message: 'ยังเล่นได้อยู่ไหม' });
        await delay(1500);
        assert(bystander.chats.some(m => m.message === 'ยังเล่นได้อยู่ไหม'),
            'คนในห้องเดียวกันแชทไม่ได้แล้ว — error ลามออกนอกคนกด');
        console.log('2. คนอื่นในห้องเดียวกันยังแชทได้ปกติ ✓');

        // 3. ห้องอื่นไม่กระทบ
        // getRoomList รับ callback เป็นอาร์กิวเมนต์แรก (ไม่มี payload)
        const listB = await new Promise(res => {
            const t = setTimeout(() => res({ __timeout: true }), 6000);
            outsider.socket.emit('getRoomList', r => { clearTimeout(t); res(r); });
        });
        assert(listB && !listB.__timeout && listB.success, 'ห้องอื่นใช้งานไม่ได้');
        // และส่งแชทในห้อง B ได้จริง
        const outsiderChats = [];
        outsider.socket.on('newMessage', m => outsiderChats.push(m));
        outsider.socket.emit('sendMessage', { message: 'ห้องบียังโอเค' });
        await delay(1200);
        assert(outsiderChats.some(m => m.message === 'ห้องบียังโอเค'), 'ห้องอื่นแชทไม่ได้');
        console.log('3. ห้องอื่นทำงานปกติ ✓');

        // 4. เซิร์ฟเวอร์ยังอยู่
        const status = (await fetch(base + '/rooms', { redirect: 'manual' })).status;
        assert(status === 200 || status === 302, 'เซิร์ฟเวอร์ไม่ตอบแล้ว');
        console.log(`4. เซิร์ฟเวอร์ยังตอบ HTTP ${status} ✓`);

        [victim, bystander, outsider].forEach(p => p.socket.close());
        console.log('\n✅ ERROR ISOLATION PASSED — error อยู่ในกรอบคนที่กดเท่านั้น');
        process.exit(0);
    } finally {
        child.kill('SIGTERM');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
