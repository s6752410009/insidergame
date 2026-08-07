/**
 * ยิงคำสั่งซ้อน/แข่งกัน — บัคประเภทนี้ fuzz ทีละครั้งจับไม่ได้
 *
 * ครอบ:
 *   - กดแอ็กชันเดิมรัวๆ (ดับเบิลคลิก / เน็ตกระตุกแล้วส่งซ้ำ)
 *   - หลายคนตอบโต้พร้อมกันในเสี้ยววินาทีเดียว
 *   - สั่งต่อหลังเกมจบแล้ว
 *   - ออกจากห้องกลางจังหวะที่ระบบรอเราอยู่
 *   - เข้าห้องพร้อมกันจนเกินจำนวนที่ตั้งไว้
 *
 * เกณฑ์ตัดสิน: server ต้องไม่ตาย, ไม่มีเหรียญ/การ์ดงอกเกินกติกา, เกมต้องไม่ค้าง
 *
 * รัน: node scripts/smoke-race-conditions.js
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
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.stdout.on('data', c => { logs += c; });
    child.stderr.on('data', c => { logs += c; });
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        const check = setInterval(() => {
            if (logs.includes(`Server started on port ${port}`)) {
                clearTimeout(t); clearInterval(check); res({ child, getLogs: () => logs });
            }
        }, 100);
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 12000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function alive(base) {
    const res = await fetch(base + '/how-to-play').catch(() => null);
    return !!res && res.ok;
}

(async () => {
    const port = await getFreePort();
    const { child: server, getLogs } = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;

    try {
        // ================= 1. Coup: กดแอ็กชันเดิมรัว 20 ครั้ง =================
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('coupState', s => states.push(s));
            players.push({ socket, id, states });
        }
        await delay(500);

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'Race', gameMode: 'coup', maxPlayers: 6
        });
        assert(created?.success, 'สร้างห้องไม่ได้');
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(700);
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await delay(4200);
        players.forEach(p => p.socket.emit('coup_requestState', { roomId, playerId: p.id }));
        await delay(900);

        const shared = () => players.map(p => p.states[p.states.length - 1]).filter(Boolean).pop();
        const turnId = shared()?.currentPlayerId;
        assert(turnId, 'ไม่รู้ว่าถึงตาใคร');
        const actor = players.find(p => p.id === turnId);

        // ยิงพร้อมกัน 20 ครั้ง ไม่รอผลทีละอัน
        const burst = await Promise.all(Array.from({ length: 20 }, () =>
            ack(actor.socket, 'coup_submitAction', { actionId: 'tax' })));
        const okCount = burst.filter(r => r?.success).length;
        assert(okCount === 1, `กด "เก็บภาษี" รัว 20 ครั้ง ระบบรับ ${okCount} ครั้ง (ต้องรับแค่ 1)`);
        console.log(`1. Coup: กดแอ็กชันรัว 20 ครั้ง → ระบบรับแค่ครั้งเดียว ✓`);

        // ================= 2. ทุกคนตอบโต้พร้อมกัน =================
        const responders = players.filter(p => p.id !== turnId);
        await Promise.all(responders.flatMap(p => [
            ack(p.socket, 'coup_respond', { response: 'pass' }),
            ack(p.socket, 'coup_respond', { response: 'challenge' }),
            ack(p.socket, 'coup_respond', { response: 'pass' })
        ]));
        await delay(900);
        players.forEach(p => p.socket.emit('coup_requestState', { roomId, playerId: p.id }));
        await delay(700);

        const afterRace = shared();
        assert(afterRace, 'ไม่ได้ state กลับมาหลังยิงตอบโต้ซ้อน');
        const totalCoins = afterRace.players.reduce((sum, p) => sum + p.coins, 0);
        const totalCards = afterRace.players.reduce((sum, p) => sum + p.influenceCount + p.revealed.length, 0)
            + afterRace.deckCount;
        assert(totalCards === 15, `การ์ดในระบบเพี้ยนหลังยิงซ้อน: ${totalCards} ใบ (ต้อง 15)`);
        assert(totalCoins >= 0 && totalCoins <= 60, `เหรียญเพี้ยน: ${totalCoins}`);
        console.log(`2. ตอบโต้ซ้อนกัน 6 คำสั่งพร้อมกัน → การ์ดยังครบ 15 ใบ เหรียญรวม ${totalCoins} ✓`);

        // ================= 3. ออกกลางจังหวะที่ระบบรอเราอยู่ =================
        const victim = responders[0];
        victim.socket.disconnect();
        await delay(2500);
        players.filter(p => p !== victim).forEach(p =>
            p.socket.emit('coup_requestState', { roomId, playerId: p.id }));
        await delay(900);
        const afterLeave = players.filter(p => p !== victim)
            .map(p => p.states[p.states.length - 1]).filter(Boolean).pop();
        assert(afterLeave, 'คนออกแล้ว state หยุดส่ง');
        assert(afterLeave.phase !== 'lobby', 'เกมหลุดกลับ lobby เพราะคนออก');
        console.log(`3. คนออกกลางเกม → เกมเดินต่อได้ (เฟส "${afterLeave.phase}") ✓`);

        // ================= 4. สั่งต่อหลังเกมจบ =================
        // จบเกมด้วยคำสั่งแอดมิน แล้วยิงคำสั่งเกมต่อ
        await ack(players[0].socket, 'endTableSession', {});
        await delay(1200);
        const afterEnd = await Promise.all([
            ack(players[0].socket, 'coup_submitAction', { actionId: 'tax' }),
            ack(players[0].socket, 'coup_respond', { response: 'challenge' }),
            ack(players[0].socket, 'coup_loseInfluence', { cardId: 'duke' }),
            ack(players[0].socket, 'coup_exchange', { keepCardIds: ['duke', 'duke'] })
        ]);
        const leaked = afterEnd.filter(r => r?.success).length;
        assert(leaked === 0, `จบเกมแล้วยังสั่งเกมได้อีก ${leaked} คำสั่ง`);
        console.log('4. จบเกมแล้ว คำสั่งเกมทุกตัวถูกปฏิเสธ ✓');

        // ================= 5. เข้าห้องพร้อมกันจนเกินโควตา =================
        const small = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'Cap', gameMode: 'insider', maxPlayers: 4
        });
        assert(small?.success, 'สร้างห้องเล็กไม่ได้');
        const crowd = [];
        for (let i = 0; i < 10; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            crowd.push({ socket, id });
        }
        await delay(500);
        const joins = await Promise.all(crowd.map(c =>
            ack(c.socket, 'joinRoom', { roomId: small.roomId, playerId: c.id })));
        const joined = joins.filter(r => r?.success).length;
        // เจ้าของห้องนับเป็น 1 คนแล้ว เหลือที่ว่าง 3
        assert(joined <= 3, `ห้องจำกัด 4 คน (มีเจ้าของแล้ว 1) แต่เข้าพร้อมกันได้ ${joined} คน`);
        console.log(`5. 10 คนแย่งเข้าห้อง 4 ที่นั่งพร้อมกัน → เข้าได้ ${joined} คน ไม่ล้น ✓`);
        crowd.forEach(c => c.socket.disconnect());

        // ================= 6. server ยังอยู่ดีไหม =================
        await delay(1000);
        assert(await alive(base), 'server ตายหลังโดนยิงซ้อน');
        const logs = getLogs();
        const crashed = /uncaughtException|unhandledRejection|FATAL/i.test(logs);
        assert(!crashed, 'log มีสัญญาณ crash:\n' + logs.split('\n').filter(l => /uncaught|unhandled|FATAL/i.test(l)).join('\n'));
        console.log('6. server ยังตอบปกติ ไม่มี uncaughtException ✓');

        console.log('\n✅ ยิงซ้อน/แข่งกัน ไม่ทำให้สถานะเกมเพี้ยนหรือ server ตาย');
    } finally {
        server.kill('SIGKILL');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
