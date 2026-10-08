/**
 * บอท Coup ผ่าน socket จริง (เซิร์ฟเวอร์เต็ม) — หัวห้องคนเดียวกับบอท
 *  A) หัวห้องเติมบอทในห้องรอ (ทีละตัว + หลายตัว) · คนอื่นเติมไม่ได้ · ห้องเต็ม 6 ที่แล้วเติมไม่ได้
 *  B) เริ่มเกม 1 คน + บอท 5 · หัวห้อง "ไม่กดอะไรเลย" → เกมต้องจบเอง
 *  C) เริ่มเกม 1 คน + บอท 2 · หัวห้องกดเล่นสุ่มตามที่กติกาให้ → เกมต้องจบ
 *  D) ระหว่างเกมเติมบอทไม่ได้ · state ที่หัวห้องได้ไม่มีการ์ดคว่ำของบอท · บอทไม่เข้าสถิติ
 *  E) หัวห้องออก (เหลือแต่บอท) → ห้องปิด
 *
 * รัน: npm run smoke:coup:bots   (SMOKE_PORT=xxxx เพื่อกำหนดพอร์ต)
 */
require('./isolateTestData');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

async function getFreePort() {
    if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            COUP_BOT_MS: '60',
            COUP_ACTION_MS: '900',
            COUP_RESPOND_MS: '900',
            COUP_DECIDE_MS: '900'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}
function ack(s, e, p) {
    return new Promise(r => {
        const t = setTimeout(() => r({ success: false, error: '__timeout ' + e }), 15000);
        s.emit(e, p, x => { clearTimeout(t); r(x || {}); });
    });
}
function conn(base) {
    return new Promise((r, j) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        const t = setTimeout(() => j(new Error('connect timeout')), 15000);
        s.once('connect', () => { clearTimeout(t); r(s); });
    });
}
async function waitFor(pred, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pred()) return true;
        await delay(50);
    }
    throw new Error('timeout waiting for ' + label);
}

async function makeClient(base, name) {
    const socket = await conn(base);
    const client = { socket, id: randomUUID(), name, states: [], roomUpdates: [] };
    socket.on('coupState', s => {
        // การ์ดคว่ำของคนอื่นต้องไม่หลุดมา (เห็นแค่จำนวน) จนกว่าจะจบเกม
        (s.players || []).forEach(p => {
            assert(p.influence === undefined, `${name}: รั่ว influence ของ ${p.name}`);
            if (s.phase !== 'finished') assert(p.finalHand === null, `${name}: รั่ว finalHand ก่อนจบเกม`);
        });
        assert(!s.botMemory, 'ความจำบอทต้องไม่ถูกส่งไปหน้าเว็บ');
        client.states.push(s);
    });
    socket.on('roomUpdate', p => client.roomUpdates.push(p));
    socket.emit('initPlayer', client.id);
    await delay(150);
    return client;
}
const last = c => c.states[c.states.length - 1];

async function createRoom(host, name) {
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name, gameMode: 'coup', maxPlayers: 6 });
    assert(created?.success, 'สร้างห้อง coup ไม่ได้: ' + JSON.stringify(created));
    host.socket.emit('setRoom', { roomId: created.roomId, playerId: host.id });
    await delay(200);
    return created.roomId;
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/** หัวห้องเล่นสุ่มทุกอย่างที่หน้าเว็บให้กด */
async function playRandom(host) {
    const s = last(host);
    if (!s || s.phase === 'finished') return;
    const ctx = { step: s.step, phase: s.phase, turnNumber: s.turnNumber };
    if (s.phase === 'action' && s.isMyTurn && s.availableActions.length) {
        const action = pick(s.availableActions);
        const targets = s.players.filter(p => p.alive && !p.isSelf);
        await ack(host.socket, 'coup_submitAction', { actionId: action.id, targetPlayerId: action.needsTarget ? pick(targets).playerId : null });
    } else if (s.availableResponses) {
        const r = s.availableResponses;
        const options = ['pass'];
        if (r.canChallenge) options.push('challenge');
        (r.blockOptions || []).forEach(b => options.push('block:' + b.id));
        const choice = pick(options);
        await ack(host.socket, 'coup_respond', choice.startsWith('block:')
            ? { response: 'block', claimCard: choice.slice(6), ...ctx }
            : { response: choice, ...ctx });
    } else if (s.pendingLoss && s.pendingLoss.isMe && s.self.influence.length) {
        await ack(host.socket, 'coup_loseInfluence', { cardId: pick(s.self.influence).id });
    } else if (s.pendingExchange && s.pendingExchange.options) {
        await ack(host.socket, 'coup_exchange', { keepCardIds: s.pendingExchange.options.slice(0, s.pendingExchange.keepCount).map(c => c.id) });
    }
}

async function runGame(base, label, botCount, hostMode) {
    const host = await makeClient(base, 'หัวห้อง-' + label);
    const roomId = await createRoom(host, 'CoupBots ' + label);

    // เติมทีละตัว เหมือนกดปุ่มในห้องรอ
    for (let i = 0; i < botCount; i += 1) {
        const res = await ack(host.socket, 'coup_addBots', { roomId, count: 1 });
        assert(res.success && res.added === 1, `${label}: เติมบอทไม่ได้ ${JSON.stringify(res)}`);
    }
    await waitFor(() => (host.roomUpdates.at(-1)?.players || []).length === botCount + 1, 5000, 'roomUpdate with bots');
    const lobbyPlayers = host.roomUpdates.at(-1).players;
    const botsInLobby = lobbyPlayers.filter(p => p.playerId.startsWith('bot_'));
    assert(botsInLobby.length === botCount, `${label}: ห้องรอต้องเห็นบอท ${botCount} ตัว`);
    botsInLobby.forEach(p => {
        assert(/^บอท/.test(p.playerName), 'ชื่อบอทต้องขึ้นต้นด้วย "บอท": ' + p.playerName);
        assert(p.avatar && p.avatar !== '👤', 'บอทต้องมีอวาตาร์ของตัวเอง');
        assert(p.online === true, 'บอทต้องนับว่าออนไลน์');
    });
    assert(new Set(botsInLobby.map(p => p.playerName.split(' ')[0])).size === botCount, `${label}: ชื่อบอทซ้ำกัน`);

    const started = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(started.success, `${label}: เริ่มเกมไม่ได้ ${JSON.stringify(started)}`);
    await waitFor(() => last(host) && last(host).phase !== 'lobby', 10000, 'coup start');

    const midAdd = await ack(host.socket, 'coup_addBots', { roomId, count: 1 });
    assert(!midAdd.success, `${label}: ระหว่างเกมต้องเติมบอทไม่ได้`);

    const startedAt = Date.now();
    let hostActions = 0;
    while (last(host).phase !== 'finished') {
        if (Date.now() - startedAt > 180000) throw new Error(`${label}: เกมไม่จบใน 3 นาที phase=${last(host).phase}`);
        if (hostMode === 'random') {
            const before = host.states.length;
            await playRandom(host);
            if (host.states.length !== before) hostActions += 1;
        }
        await delay(hostMode === 'random' ? 120 : 200);
    }
    const final = last(host);
    assert(final.winner && final.winner.playerId, `${label}: ต้องมีผู้ชนะ`);
    const alive = final.players.filter(p => p.alive);
    assert(alive.length === 1 && alive[0].playerId === final.winner.playerId, `${label}: ผู้ชนะต้องเป็นผู้รอดคนเดียว`);
    const kinds = new Set(final.history.map(h => h.kind).filter(Boolean));
    console.log(`  ${label}: จบใน ${((Date.now() - startedAt) / 1000).toFixed(1)}s · ${final.turnNumber} ตา · ผู้ชนะ ${final.winner.name} · หัวห้องกด ${hostActions} ครั้ง · เหตุการณ์ ${[...kinds].join(',')}`);
    return { host, roomId, final };
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    try {
        // ---- A) ใครเติมได้ / ห้องเต็ม ----
        {
            const host = await makeClient(base, 'หัวห้องA');
            const guest = await makeClient(base, 'แขกA');
            const roomId = await createRoom(host, 'CoupBots A');
            assert((await ack(guest.socket, 'joinRoom', { roomId, playerId: guest.id })).success, 'แขก join ไม่ได้');
            guest.socket.emit('setRoom', { roomId, playerId: guest.id });
            await delay(200);
            const denied = await ack(guest.socket, 'coup_addBots', { roomId, count: 1 });
            assert(!denied.success && /หัวหน้าห้อง/.test(denied.error), 'คนที่ไม่ใช่หัวห้องต้องเติมบอทไม่ได้: ' + JSON.stringify(denied));
            const many = await ack(host.socket, 'coup_addBots', { roomId, count: 9 });
            assert(many.success && many.added === 4, 'เติมได้จนเต็ม 6 ที่ (4 ตัว): ' + JSON.stringify(many));
            const full = await ack(host.socket, 'coup_addBots', { roomId, count: 1 });
            assert(!full.success && /เต็ม/.test(full.error), 'ห้องเต็มต้องเติมไม่ได้');
            const wrongMode = await ack(host.socket, 'liar_addBots', { roomId, count: 1 });
            assert(!wrongMode.success, 'เรียกคำสั่งบอทของเกมอื่นต้องไม่ได้');
            host.socket.close();
            guest.socket.close();
            console.log('A) เติมบอท: เฉพาะหัวห้อง · ห้องเต็ม 6 ที่ · ชื่อ/อวาตาร์บอท ✓');
        }

        // ---- B) หัวห้องไม่กดเลย + บอท 5 ----
        const idle = await runGame(base, 'B 1+5 หัวห้องนิ่ง', 5, 'idle');
        // ---- C) หัวห้องเล่นสุ่ม + บอท 2 ----
        const played = await runGame(base, 'C 1+2 หัวห้องเล่น', 2, 'random');
        await runGame(base, 'C2 1+3 หัวห้องเล่น', 3, 'random');
        console.log('B/C) เกมจบเองทั้งแบบหัวห้องนิ่งและเล่นเอง ✓');

        // ---- D) สถิติ: มีหัวห้อง ไม่มีบอท ----
        await delay(800);
        const statsFile = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
        if (fs.existsSync(statsFile)) {
            const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
            const ids = Object.keys(stats);
            assert(!ids.some(id => id.startsWith('bot_')), 'บอทต้องไม่เข้าไฟล์สถิติ');
            assert(ids.includes(idle.host.id) && ids.includes(played.host.id), 'หัวห้องต้องได้สถิติเกม');
            assert(stats[idle.host.id].modeStats.coup.games >= 1, 'สถิติ coup ของหัวห้องต้องนับ');
        } else {
            throw new Error('ไม่พบไฟล์สถิติหลังจบเกม');
        }
        const playersFile = path.join(process.env.GAME_DATA_DIR, 'players.json');
        if (fs.existsSync(playersFile)) {
            assert(!fs.readFileSync(playersFile, 'utf8').includes('"bot_'), 'บอทต้องไม่ถูกบันทึกลงไฟล์ผู้เล่น');
        }
        console.log('D) สถิติ: หัวห้องนับ บอทไม่ถูกบันทึก ✓');

        // ---- E) หัวห้องออก → ห้องที่เหลือแต่บอทปิด ----
        {
            const lister = await makeClient(base, 'ดูรายการห้อง');
            const leave = await ack(played.host.socket, 'leaveRoom', { roomId: played.roomId, playerId: played.host.id });
            assert(leave.success, 'ออกจากห้องไม่ได้');
            await delay(500);
            const listed = await new Promise(r => {
                lister.socket.emit('getRoomList', x => r(x));
                setTimeout(() => r(null), 3000);
            });
            const rooms = Array.isArray(listed) ? listed : (listed && (listed.rooms || listed.data)) || [];
            assert(!rooms.some(room => room.roomId === played.roomId), 'ห้องที่เหลือแต่บอทต้องปิด');
            // เข้าห้องเดิมไม่ได้แล้ว
            const rejoin = await ack(lister.socket, 'joinRoom', { roomId: played.roomId, playerId: lister.id });
            assert(!rejoin.success, 'ห้องบอทล้วนต้องปิดไปแล้ว');
            lister.socket.close();
            console.log('E) หัวห้องออก → ห้องบอทล้วนปิด ✓');
        }

        const logs = server.logs();
        assert(!/\[coup\] bot turn failed/.test(logs), 'บอทต้องไม่ error: ' + (logs.match(/\[coup\] bot turn failed.*/) || [''])[0]);
        console.log(`✅ smoke:coup:bots ผ่าน ${checks} checks`);
    } finally {
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
