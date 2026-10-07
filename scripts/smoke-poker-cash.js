/**
 * โต๊ะเงิน (กระเป๋าชิปจริงของเว็บ): มือที่ไม่ได้เล่นจนจบต้องคืนชิปทุกบาท
 *
 * 1. 3 คน ลงไม่เท่ากัน (มีคนหมอบ) → หัวห้องจบโต๊ะกลางมือ → ทุกกระเป๋ากลับเท่าเดิมเป๊ะ
 * 2. เซิร์ฟเวอร์รีสตาร์ตกลางมือ → บูตแล้วคืนครั้งเดียว · รีสตาร์ตซ้ำไม่คืนซ้ำ
 * 3. มือจบปกติ → ผู้ชนะได้กอง ยอดรวมทั้งโต๊ะไม่หายไม่งอก · จบโต๊ะหลังจากนั้นไม่คืนซ้ำ
 *
 * รัน: npm run smoke:poker:cash
 */
require('./isolateTestData');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const START = 1000; // STARTING_CHIPS ใน walletManager
const ANTE = 50;
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function assert(c, m) { if (!c) throw new Error('FAIL: ' + m); passed += 1; }

const dataDir = fs.mkdtempSync(path.join(process.env.GAME_DATA_DIR || os.tmpdir(), 'poker-cash-'));
const walletsFile = path.join(dataDir, 'wallets.json');

function getFreePort() {
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), MONGO_URL: '', GAME_DATA_DIR: dataDir, WALLETS_FILE: walletsFile, ALLOW_LEGACY_SOCKET_IDENTITY: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (logs.includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}
// SIGTERM = เซฟกระเป๋าแล้วออก (เหมือน Render ตอน deploy) — รอจนโปรเซสจบจริง
function stopServer(child) {
    return new Promise(res => {
        if (child.exitCode !== null) return res();
        const t = setTimeout(() => { child.kill('SIGKILL'); }, 8000);
        child.removeAllListeners('exit'); // ตัวที่ bootServer ผูกไว้ (reject ตอนบูต) ไม่ใช้แล้ว
        child.once('exit', () => { clearTimeout(t); res(); });
        child.kill('SIGTERM');
    });
}
function ack(s, e, p) {
    return new Promise(r => {
        const t = setTimeout(() => r({ __timeout: true }), 12000);
        s.emit(e, p, x => { clearTimeout(t); r(x); });
    });
}
function conn(base) {
    return new Promise(r => {
        const s = io(base, { transports: ['websocket'], forceNew: true });
        s.once('connect', () => r(s));
    });
}
const latest = p => p.states[p.states.length - 1] || null;
async function waitFor(players, pred, ms = 12000, label = 'state') {
    const start = Date.now();
    while (Date.now() - start < ms) {
        for (const p of players) { const s = latest(p); if (s && pred(s)) return s; }
        await delay(40);
    }
    throw new Error('timeout รอ ' + label);
}
async function balances(ids, ms = 4000) {
    // กระเป๋าเซฟแบบหน่วงเวลา — อ่านไฟล์จนกว่าจะมีครบทุกคน
    const start = Date.now();
    let last = {};
    while (Date.now() - start < ms) {
        try { last = JSON.parse(fs.readFileSync(walletsFile, 'utf8')); } catch (e) { /* ยังไม่มีไฟล์ */ }
        if (ids.every(id => last[id])) break;
        await delay(100);
    }
    return ids.map(id => (last[id] ? last[id].balance : null));
}
function escrowsOf(id) {
    try { return JSON.parse(fs.readFileSync(walletsFile, 'utf8'))[id]?.pokerEscrow || {}; } catch (e) { return {}; }
}

async function seatCashTable(base, count) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        const socket = await conn(base);
        const id = randomUUID();
        socket.emit('initPlayer', id);
        const states = [];
        socket.on('pokerState', s => states.push(s));
        players.push({ socket, id, states });
    }
    await delay(400);
    const created = await ack(players[0].socket, 'createRoom', {
        playerId: players[0].id, name: 'โต๊ะเงิน', gameMode: 'poker5', maxPlayers: 10, pokerAnte: ANTE, pokerTableType: 'cash'
    });
    assert(created && created.success, 'สร้างโต๊ะเงิน: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'เข้าโต๊ะ');
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(400);
    const started = await ack(players[0].socket, 'startGameFromLobby', { roomId });
    assert(started && started.success, 'เริ่มโต๊ะ: ' + JSON.stringify(started));
    players.forEach(p => p.socket.emit('poker_requestState', { roomId }));
    return { players, roomId };
}
async function discardAll(players, roomId) {
    await waitFor(players, s => s.phase === 'select' && s.self && s.self.hand && s.self.hand.length, 12000, 'ช่วงทิ้งไพ่');
    for (const p of players) {
        const s = latest(p);
        if (!s || s.self.ready) continue;
        const res = await ack(p.socket, 'poker_select', { roomId, cardIds: (s.self.hand || []).slice(0, 2).map(c => c.id) });
        assert(res && res.success, 'ทิ้งไพ่: ' + JSON.stringify(res));
    }
    await waitFor(players, s => s.phase === 'bet', 12000, 'ช่วงลงชิป');
}
// ลงชิปตามสคริปต์ทีละตาเท่าที่มี แล้วหยุด (มือยังไม่จบ)
async function betMoves(players, roomId, moves) {
    for (const move of moves) {
        let actor = null;
        for (let i = 0; i < 100 && !actor; i += 1) {
            actor = players.find(p => { const s = latest(p); return s && s.phase === 'bet' && s.toActPlayerId === p.id; });
            if (!actor) await delay(50);
        }
        assert(actor, 'มีคนถึงตาลงชิป');
        const res = await ack(actor.socket, 'poker_bet', { roomId, action: move.action, amount: move.amount || 0 });
        assert(res && res.success !== false && !res.__timeout, `${move.action}: ` + JSON.stringify(res));
        await delay(150);
    }
}
const close = players => players.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });

(async () => {
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    let server = await bootServer(port);
    try {
        // ---------- 1. หัวห้องจบโต๊ะกลางมือ ----------
        {
            const t = await seatCashTable(base, 3);
            const ids = t.players.map(p => p.id);
            await discardAll(t.players, t.roomId);
            await betMoves(t.players, t.roomId, [{ action: 'bet', amount: 100 }, { action: 'raise', amount: 300 }, { action: 'fold' }]);
            const mid = await balances(ids);
            assert(mid.reduce((a, b) => a + b, 0) < START * 3, 'กลางมือชิปถูกหักเข้ากองแล้ว: ' + mid.join(','));
            assert(new Set(mid).size > 1, 'แต่ละคนลงไม่เท่ากัน: ' + mid.join(','));
            const end = await ack(t.players[0].socket, 'endTableSession', { roomId: t.roomId, playerId: t.players[0].id });
            assert(end && end.success, 'หัวห้องจบโต๊ะ: ' + JSON.stringify(end));
            await delay(800);
            const after = await balances(ids);
            assert(after.every(b => b === START), 'จบโต๊ะกลางมือ → ทุกคนได้คืนเท่าเดิม (รวมคนหมอบ): ' + after.join(','));
            assert(ids.every(id => Object.keys(escrowsOf(id)).length === 0), 'ไม่มีเงินพักค้าง');
            close(t.players);
            console.log('1. จบโต๊ะกลางมือ 3 คน (ลงไม่เท่ากัน + หมอบ) → คืนครบทุกบาท ✓');
        }

        // ---------- 2. รีสตาร์ตกลางมือ ----------
        let restartIds;
        {
            const t = await seatCashTable(base, 2);
            restartIds = t.players.map(p => p.id);
            await discardAll(t.players, t.roomId);
            await betMoves(t.players, t.roomId, [{ action: 'bet', amount: 200 }]);
            await delay(600);
            const mid = await balances(restartIds);
            assert(mid[0] + mid[1] < START * 2, 'กลางมือก่อนรีสตาร์ต: ' + mid.join(','));
            close(t.players);
            await stopServer(server);
            server = await bootServer(port);
            await delay(1200);
            const after = await balances(restartIds);
            assert(after.every(b => b === START), 'บูตใหม่ → คืนชิปมือค้างครบ: ' + after.join(','));
            await stopServer(server);
            server = await bootServer(port);
            await delay(1200);
            const again = await balances(restartIds);
            assert(again.every(b => b === START), 'รีสตาร์ตซ้ำ → ไม่คืนซ้ำ: ' + again.join(','));
            console.log('2. รีสตาร์ตกลางมือ → คืนครั้งเดียว · รีสตาร์ตซ้ำไม่คืนซ้ำ ✓');
        }

        // ---------- 3. มือจบปกติ ----------
        {
            const t = await seatCashTable(base, 2);
            const ids = t.players.map(p => p.id);
            await discardAll(t.players, t.roomId);
            await betMoves(t.players, t.roomId, [{ action: 'check' }, { action: 'check' }]);
            await waitFor(t.players, s => s.phase === 'reveal' || s.phase === 'between' || s.lastResult, 15000, 'เปิดไพ่');
            await delay(800);
            const after = await balances(ids);
            assert(after[0] + after[1] === START * 2, 'มือจบปกติ ยอดรวมไม่หายไม่งอก: ' + after.join(','));
            assert(after.some(b => b > START) || after.every(b => b === START), 'ผู้ชนะได้กอง (หรือเสมอแบ่งกอง): ' + after.join(','));
            assert(ids.every(id => Object.keys(escrowsOf(id)).length === 0), 'มือจบแล้วล้างเงินพัก');
            const end = await ack(t.players[0].socket, 'endTableSession', { roomId: t.roomId, playerId: t.players[0].id });
            assert(end && end.success, 'จบโต๊ะหลังมือจบ');
            await delay(800);
            const final = await balances(ids);
            assert(final[0] === after[0] && final[1] === after[1], 'จบโต๊ะหลังมือจบ ไม่คืนซ้ำ: ' + final.join(','));
            close(t.players);
            console.log('3. มือจบปกติ จ่ายผู้ชนะถูก · ยอดรวมคงที่ · ไม่คืนซ้ำ ✓');
        }

        console.log(`✅ poker-cash: ${passed} checks passed`);
    } finally {
        await stopServer(server);
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
    process.exit(0);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
