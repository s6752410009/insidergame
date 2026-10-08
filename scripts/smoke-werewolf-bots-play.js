/**
 * บอทหมาป่าผ่าน socket จริง (เซิร์ฟเวอร์เต็ม) — หัวห้องคนเดียวกับบอท
 *  A) เติมบอทในห้องรอ: เฉพาะหัวห้อง · เต็มห้องแล้วเติมไม่ได้ · ระหว่างเกมเติมไม่ได้
 *  B) 1 คน + บอท 5 · หัวห้องกดแค่ "พร้อม/ข้าม/โหวต" → เกมจบ
 *  C) 1 คน + บอท 7 · หัวห้องไม่กดอะไรเลย (นาฬิกาเดินแทน) → เกมจบ
 *  D) 1 คน + บอท 19 (โต๊ะ 20) · หัวห้องกดเล่น → เกมจบ
 *  ทุกเกม: แชทบอทมาจากบอทที่ยังมีชีวิต ในช่วงประชุม เป็นประโยคกลาง · ไม่มีบทบอทหลุดใน state
 *  E) สถิติ: เกมที่มีบอทไม่นับให้ใครเลย · เกมคนล้วน 3 คนยังนับ · หัวห้องออก → ห้องบอทล้วนปิด
 *
 * รัน: npm run smoke:werewolf:bots
 */
require('./isolateTestData');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { CHAT_LINES } = require('../games/werewolfBots');

const SKIP = '__skip__';
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
        env: { ...process.env, PORT: String(port), WEREWOLF_BOT_MS: '90', WEREWOLF_PHASE_MS: '2500' },
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
    const client = { socket, id: randomUUID(), name, states: [], roomUpdates: [], botChats: [] };
    socket.on('werewolfState', s => {
        assert(!JSON.stringify(s).includes('botBrain'), 'ความจำบอทต้องไม่ถูกส่งไปหน้าเว็บ');
        const self = (s.players || []).find(p => p.isSelf);
        if (self && self.alive && s.phase !== 'finished') {
            s.players.filter(p => !p.isSelf && p.alive && !p.princeRevealed).forEach(p => {
                assert(p.roleId === null, `${name}: บทของ ${p.name} หลุดมาตอนยังเล่นอยู่`);
            });
        }
        client.states.push(s);
    });
    socket.on('roomUpdate', p => client.roomUpdates.push(p));
    socket.on('newMessage', m => {
        if (!m || !String(m.playerId || '').startsWith('bot_')) return;
        const s = client.states[client.states.length - 1];
        client.botChats.push({ ...m, phase: s && s.phase });
        assert(!m.channel || m.channel === 'public', 'บอทต้องไม่พูดในแชทหมาป่า/ผี: ' + m.channel);
        assert(CHAT_LINES.includes(m.message), 'บอทพูดประโยคนอกชุดกลาง: ' + m.message);
        if (s) {
            const speaker = s.players.find(p => p.playerId === m.playerId);
            assert(speaker && speaker.alive, 'บอทที่ตายแล้วต้องเงียบ');
        }
    });
    socket.emit('initPlayer', client.id);
    await delay(150);
    return client;
}
const last = c => c.states[c.states.length - 1];

async function createRoom(host, name, maxPlayers) {
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name, gameMode: 'werewolf', maxPlayers });
    assert(created?.success, 'สร้างห้อง werewolf ไม่ได้: ' + JSON.stringify(created));
    host.socket.emit('setRoom', { roomId: created.roomId, playerId: host.id });
    await delay(200);
    return created.roomId;
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/** หัวห้องกดแค่สิ่งที่ต้องกด: ไม่ใช้สกิล+พร้อม (คืน) · ข้ามประชุม · โหวต */
async function hostAct(host, done) {
    const s = last(host);
    if (!s || s.phase === 'finished') return;
    const self = s.players.find(p => p.isSelf);
    if (!self || !self.alive) return;
    const key = `${s.phase}:${s.dayNumber}`;
    if (done.has(key)) return;
    done.add(key);
    if (s.phase === 'night') {
        for (const option of (s.actionState?.nightActions || [])) {
            if (option.locked || !option.allowSkip || option.selectedTargetId) continue;
            await ack(host.socket, 'werewolf_submitNightAction', { targetPlayerId: SKIP, actionType: option.type && option.type.startsWith('witch') ? option.type : null });
        }
        await ack(host.socket, 'werewolf_skipNight', {});
    } else if (s.phase === 'day-discussion') {
        await ack(host.socket, 'werewolf_skipDiscussion', {});
    } else if (s.phase === 'day-vote') {
        const others = s.players.filter(p => p.alive && !p.isSelf);
        await ack(host.socket, 'werewolf_submitDayVote', { targetPlayerId: Math.random() < 0.7 ? pick(others).playerId : SKIP });
    }
}

async function runGame(base, label, botCount, hostMode) {
    const host = await makeClient(base, 'หัวห้อง-' + label);
    const roomId = await createRoom(host, 'WolfBots ' + label, Math.max(8, botCount + 1));
    const res = await ack(host.socket, 'werewolf_addBots', { roomId, count: botCount });
    assert(res.success && res.added === botCount, `${label}: เติมบอทไม่ได้ ${JSON.stringify(res)}`);
    await waitFor(() => (host.roomUpdates.at(-1)?.players || []).length === botCount + 1, 5000, 'roomUpdate with bots');
    const lobbyBots = host.roomUpdates.at(-1).players.filter(p => p.playerId.startsWith('bot_'));
    assert(lobbyBots.every(p => /^บอท/.test(p.playerName) && p.avatar && p.avatar !== '👤' && p.online), `${label}: บอทในห้องรอต้องมีชื่อ/อวาตาร์/ออนไลน์`);
    assert(new Set(lobbyBots.map(p => p.playerName.split(' ')[0])).size === botCount, `${label}: ชื่อบอทซ้ำ`);

    const started = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(started.success, `${label}: เริ่มเกมไม่ได้ ${JSON.stringify(started)}`);
    await waitFor(() => last(host) && last(host).phase === 'night', 15000, 'night 1');
    const midAdd = await ack(host.socket, 'werewolf_addBots', { roomId, count: 1 });
    assert(!midAdd.success, `${label}: ระหว่างเกมต้องเติมบอทไม่ได้`);

    const startedAt = Date.now();
    const done = new Set();
    const phases = new Set();
    while (last(host).phase !== 'finished') {
        if (Date.now() - startedAt > 240000) throw new Error(`${label}: เกมไม่จบใน 4 นาที phase=${last(host).phase} day=${last(host).dayNumber}`);
        phases.add(last(host).phase);
        if (hostMode === 'act') await hostAct(host, done);
        await delay(150);
    }
    const final = last(host);
    assert(['village', 'werewolf', 'fool', 'serialKiller'].includes(final.winner), `${label}: ผู้ชนะไม่ถูกต้อง ${final.winner}`);
    assert(final.players.every(p => p.roleId), `${label}: จบเกมแล้วต้องเปิดบททุกคน`);
    const myRole = final.players.find(p => p.isSelf).roleThaiName;
    console.log(`  ${label}: จบใน ${((Date.now() - startedAt) / 1000).toFixed(1)}s · วันที่ ${final.dayNumber} · ผู้ชนะ ${final.winner} · หัวห้องเป็น${myRole} · บอทแชท ${host.botChats.length} ข้อความ`);
    host.botChats.forEach(m => assert(m.phase === 'day-discussion' || m.phase === 'day-vote', `บอทแชทนอกช่วงเช้า (${m.phase})`));
    return { host, roomId, final };
}

/** เกมคนล้วน 3 คน (ไม่มีบอท) — ทุกคนกดพร้อม/ข้าม/โหวตสุ่ม — ใช้เทียบว่าสถิติยังนับ */
async function runHumanGame(base, label) {
    const clients = [];
    for (let i = 0; i < 3; i += 1) clients.push(await makeClient(base, `คน${i}-${label}`));
    const [host, ...guests] = clients;
    const roomId = await createRoom(host, 'WolfHumans ' + label, 8);
    for (const guest of guests) {
        assert((await ack(guest.socket, 'joinRoom', { roomId, playerId: guest.id })).success, `${label}: แขก join ไม่ได้`);
        guest.socket.emit('setRoom', { roomId, playerId: guest.id });
    }
    await delay(300);
    const started = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(started.success, `${label}: เริ่มเกมไม่ได้ ${JSON.stringify(started)}`);
    await waitFor(() => clients.every(c => last(c) && last(c).phase === 'night'), 15000, 'night 1 (humans)');
    const done = clients.map(() => new Set());
    const startedAt = Date.now();
    while (last(host).phase !== 'finished') {
        if (Date.now() - startedAt > 240000) throw new Error(`${label}: เกมไม่จบใน 4 นาที`);
        for (let i = 0; i < clients.length; i += 1) await hostAct(clients[i], done[i]);
        await delay(150);
    }
    const final = last(host);
    assert(!final.players.some(p => String(p.playerId).startsWith('bot_')), `${label}: ต้องไม่มีบอท`);
    console.log(`  ${label}: จบใน ${((Date.now() - startedAt) / 1000).toFixed(1)}s · วันที่ ${final.dayNumber} · ผู้ชนะ ${final.winner}`);
    return clients;
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    try {
        {
            const host = await makeClient(base, 'หัวห้องA');
            const guest = await makeClient(base, 'แขกA');
            const roomId = await createRoom(host, 'WolfBots A', 8);
            assert((await ack(guest.socket, 'joinRoom', { roomId, playerId: guest.id })).success, 'แขก join ไม่ได้');
            guest.socket.emit('setRoom', { roomId, playerId: guest.id });
            await delay(200);
            const denied = await ack(guest.socket, 'werewolf_addBots', { roomId, count: 1 });
            assert(!denied.success && /หัวหน้าห้อง/.test(denied.error), 'คนที่ไม่ใช่หัวห้องต้องเติมบอทไม่ได้');
            const many = await ack(host.socket, 'werewolf_addBots', { roomId, count: 30 });
            assert(many.success && many.added === 6, 'เติมได้จนเต็มห้อง 8 ที่: ' + JSON.stringify(many));
            const full = await ack(host.socket, 'werewolf_addBots', { roomId, count: 1 });
            assert(!full.success && /เต็ม/.test(full.error), 'ห้องเต็มต้องเติมไม่ได้');
            host.socket.close();
            guest.socket.close();
            console.log('A) เติมบอท: เฉพาะหัวห้อง · เต็มห้องแล้วหยุด ✓');
        }

        const acted = await runGame(base, 'B 1+5 หัวห้องกดพร้อม/โหวต', 5, 'act');
        const idle = await runGame(base, 'C 1+7 หัวห้องนิ่ง', 7, 'idle');
        await runGame(base, 'D 1+19 โต๊ะ 20', 19, 'act');
        console.log('B/C/D) เกมจบเองทั้งหัวห้องกด/นิ่ง และโต๊ะ 20 คน ✓');

        await delay(800);
        const statsFile = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
        const readStats = () => (fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {});
        {
            const stats = readStats();
            assert(!Object.keys(stats).some(id => id.startsWith('bot_')), 'บอทต้องไม่เข้าไฟล์สถิติ');
            [acted, idle].forEach(game => {
                const games = stats[game.host.id]?.modeStats?.werewolf?.games || 0;
                assert(games === 0, `เกมที่มีบอทต้องไม่นับสถิติให้หัวห้อง (${games})`);
            });
        }
        const humans = await runHumanGame(base, 'E คนล้วน 3 คน');
        await waitFor(() => {
            const stats = readStats();
            return humans.every(c => (stats[c.id]?.modeStats?.werewolf?.games || 0) === 1);
        }, 6000, 'สถิติเกมคนล้วน');
        humans.forEach(c => c.socket.close());
        console.log('E1) สถิติ: เกมมีบอทไม่นับให้ใคร (บอทไม่ถูกบันทึก) · เกมคนล้วนนับครบ ✓');

        {
            const lister = await makeClient(base, 'ดูห้อง');
            assert((await ack(acted.host.socket, 'leaveRoom', { roomId: acted.roomId, playerId: acted.host.id })).success, 'ออกจากห้องไม่ได้');
            await delay(500);
            const listed = await new Promise(r => { lister.socket.emit('getRoomList', r); setTimeout(() => r(null), 3000); });
            const rooms = (listed && listed.rooms) || [];
            assert(!rooms.some(room => room.roomId === acted.roomId), 'ห้องที่เหลือแต่บอทต้องปิด');
            lister.socket.close();
            console.log('E2) หัวห้องออก → ห้องบอทล้วนปิด ✓');
        }
        assert(!/\[werewolf\] bots failed/.test(server.logs()), 'บอทหมาป่า error: ' + (server.logs().match(/\[werewolf\] bots failed.*/) || [''])[0]);
        console.log(`✅ smoke:werewolf:bots ผ่าน ${checks} checks`);
    } finally {
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
