/**
 * เศรษฐี 🪙 ผ่านเซิร์ฟเวอร์จริง (socket.io + HTTP)
 *  K) ห้องเปิดสกิล: สกิลที่ติดตั้งเข้าเกม (ล็อก) · คนอื่นเห็นไอคอน+Lv · บอทไม่มี · สกิลติด = ป๊อปอัปทุกคน + บันทึก
 *     เปลี่ยนช่องติดตั้งกลางเกม = ไม่มีผลเกมนี้ · /m เสกเหรียญ: หัวห้องที่ไม่ใช่แอดมินเว็บ = ไม่ได้
 *  L) สวิตช์สกิลของห้อง: ค่าเริ่มเปิด · สร้างห้องแบบปิดได้ · หัวห้องสลับได้ในห้องรอ · คนอื่นสลับไม่ได้ · ปิด = ไม่มีใครมีสกิล
 *  M) รางวัลจบเกม: ผูกขาดแถว = +220 (คนชนะ) / +20 (คนแพ้) · state บอก "+N 🪙" พร้อมรายละเอียด เห็นแค่ของตัวเอง
 *     ยอดในร้านเพิ่มจริง · รีสตาร์ตแล้วยอดยังอยู่ ไม่เพิ่มซ้ำ
 *
 * รัน: npm run smoke:setthi:gold:play   (SMOKE_PORT=8866)
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
const PORT = Number(process.env.SMOKE_PORT) || 8866;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = process.env.GAME_DATA_DIR;
const ENV = {
    SETTHI_TEST_HOOKS: '1', SETTHI_ANIM_SCALE: '0', SETTHI_TURN_MS: '20000', SETTHI_DECIDE_MS: '20000', SETTHI_DEBT_MS: '20000',
    SETTHI_BOT_MS: '60', ALLOW_LEGACY_SOCKET_IDENTITY: '1', MONGO_URL: ''
};

function bootServer() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...ENV, PORT: String(PORT), WALLETS_FILE: path.join(DATA, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${PORT}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}
function stopServer(child, signal = 'SIGTERM') {
    return new Promise(res => {
        if (!child || child.exitCode !== null) { res(); return; }
        child.once('exit', () => res());
        child.kill(signal);
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } res(); }, 5000);
    });
}
function ack(s, e, p) {
    return new Promise(r => {
        const t = setTimeout(() => r({ success: false, error: '__timeout ' + e }), 15000);
        s.emit(e, p, x => { clearTimeout(t); r(x || {}); });
    });
}
async function waitFor(pred, ms = 15000, label = 'condition') {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (pred()) return true; await delay(40); }
    throw new Error('timeout waiting for ' + label);
}

/** cookie ของ id นี้ (เรียก API ร้านแบบคนจริง) */
async function cookieFor(id) {
    const res = await fetch(`${BASE}/?playerId=${id}`, { redirect: 'manual' });
    await res.text();
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    return list.map(line => line.split(';')[0]).join('; ');
}
async function api(id, method, url, body) {
    const cookie = await cookieFor(id);
    const res = await fetch(BASE + url, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
}

async function makeClient(name, id = randomUUID()) {
    const socket = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((r, j) => { const t = setTimeout(() => j(new Error('connect timeout')), 15000); socket.once('connect', () => { clearTimeout(t); r(); }); });
    const c = { socket, id, name, states: [], rooms: [] };
    socket.on('setthiState', s => {
        // รางวัลของคนอื่นต้องไม่รั่วมา
        if (s.reward) assert(s.self && s.self.playerId === id, 'reward ส่งให้เจ้าของเท่านั้น');
        c.states.push(s);
    });
    socket.on('roomUpdate', r => c.rooms.push(r));
    socket.emit('initPlayer', id);
    await delay(150);
    return c;
}
const last = c => c.states[c.states.length - 1];
async function createRoom(host, settings = {}) {
    const r = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'เศรษฐี 🪙', gameMode: 'setthi', maxPlayers: 6, setthiMinutes: 0, ...settings });
    assert(r && r.success, 'สร้างห้องไม่ได้ ' + JSON.stringify(r));
    host.socket.emit('setRoom', { roomId: r.roomId, playerId: host.id });
    host.roomId = r.roomId;
    return r.roomId;
}
async function join(roomId, c) {
    const r = await ack(c.socket, 'joinRoom', { roomId, playerId: c.id });
    assert(r && r.success, c.name + ' join ไม่ได้');
    c.socket.emit('setRoom', { roomId, playerId: c.id });
    c.roomId = roomId;
    await delay(200);
}
async function start(host, clients, roomId) {
    const r = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(r && r.success, 'เริ่มเกมไม่ได้ ' + JSON.stringify(r));
    await waitFor(() => clients.every(c => last(c) && last(c).status === 'playing'), 15000, 'เกมเริ่ม');
}
async function setup(c, spec) {
    const before = last(c).step;
    const r = await ack(c.socket, 'setthi_testSetup', { spec });
    assert(r.success, 'setup: ' + r.error);
    await waitFor(() => last(c).step > before, 5000, 'state หลัง setup');
    return last(c);
}
const seatOf = (S, id) => S.seats.find(s => s.playerId === id);
const idx = (S, id) => S.seats.findIndex(s => s.playerId === id);
const lastRoomSettings = c => { const r = c.rooms[c.rooms.length - 1]; return r && (r.settings || (r.room && r.room.settings)) || {}; };

async function scenarioK(H, G) {
    const roomId = await createRoom(H);
    await join(roomId, G);
    assert((await ack(H.socket, 'setthi_addBots', { roomId, count: 1 })).success, 'เพิ่มบอท');
    await start(H, [H, G], roomId);
    let S = last(G);
    assert(S.config.skills === true, 'ห้องเปิดสกิล (ค่าเริ่ม)');
    const h = seatOf(S, H.id);
    assert(h.skills.map(k => k.id + k.lv).join(',') === 'start2x5,builder3,luck2', 'G เห็นสกิลของ H ตามช่องติดตั้ง: ' + JSON.stringify(h.skills));
    assert(seatOf(S, G.id).skills.length === 0, 'G ไม่มีสกิล');
    assert(S.seats.filter(s => s.isBot).every(s => s.skills.length === 0), 'บอทไม่มีสกิล');
    assert(last(H).canGoldDebug === false, 'หัวห้องธรรมดาไม่มีเมนูเสกเหรียญ');
    const dbg = await ack(H.socket, 'setthi_debug_gold', { action: 'grant', amount: 5000 });
    assert(!dbg.success, 'หัวห้องที่ไม่ใช่แอดมินเว็บ เสกเหรียญไม่ได้');
    assert(!last(H).debugUsed, 'ลองเสกแล้วไม่ตีตราเกม');

    // เปลี่ยนช่องติดตั้งกลางเกม = ไม่มีผลเกมนี้
    const lo = await api(H.id, 'POST', '/api/setthi/shop/loadout', { loadout: ['fly'] });
    assert(lo.status === 200 && lo.json.profile.loadout.join(',') === 'fly', 'ตั้งช่องใหม่ได้ (ไว้เกมหน้า)');
    // สกิลติดแน่ (เทส): ผ่านจุดเริ่ม = ×2 · ทุกคนเห็นป๊อปอัป
    const i = idx(S, H.id);
    S = await setup(H, { forceProcs: true, seats: { [i]: { pos: 30, cash: 20000 } }, dice: [[1, 2]], turnSeat: i });
    const before = seatOf(S, H.id).cash;
    const r = await ack(H.socket, 'setthi_roll', { seq: S.phaseSeq });
    assert(r.success, 'ทอย: ' + r.error);
    await waitFor(() => (last(G).fx || []).some(f => f.kind === 'skill' && f.skill === 'start2x'), 5000, 'G เห็นป๊อปอัป Start ×2');
    S = last(G);
    assert(seatOf(S, H.id).skills.map(k => k.id).join(',') === 'start2x,builder,luck', 'สกิลในเกมยังเหมือนตอนเริ่ม');
    const fx = S.fx.find(f => f.kind === 'skill' && f.skill === 'start2x');
    assert(fx.playerId === H.id && fx.lv === 5, 'ป๊อปอัปบอกใคร/เลเวล');
    assert(S.history.some(x => x.kind === 'skill' && x.text.includes('Start ×2')), 'บันทึกเกมมีบรรทัด ✨');
    const sal = S.fx.find(f => f.kind === 'salary' && f.playerId === H.id);
    assert(sal && sal.amount === 6000 && sal.double, 'เงินเดือน ×2');
    assert(seatOf(S, H.id).cash >= before + 6000 - 1000, 'เงินเพิ่ม');
    console.log('K. สกิลเข้าเกมตามช่อง (ล็อก) · คนอื่นเห็น · บอทไม่มี · ติดแล้วป๊อปอัปทุกคน · หัวห้องเสกเหรียญไม่ได้ ✓');
    await ack(H.socket, 'leaveRoom', { playerId: H.id });
    await ack(G.socket, 'leaveRoom', { playerId: G.id });
    await delay(300);
    // คืนช่องติดตั้งเดิม
    await api(H.id, 'POST', '/api/setthi/shop/loadout', { loadout: ['start2x', 'builder', 'luck'] });
}

async function scenarioL(H, G) {
    H.rooms = []; G.rooms = []; H.states = []; G.states = [];
    const roomId = await createRoom(H, { setthiSkills: false });
    await join(roomId, G);
    await waitFor(() => lastRoomSettings(G).setthiSkills === false, 5000, 'ห้องปิดสกิล');
    const no = await ack(G.socket, 'updateRoom', { setthiSkills: true });
    await delay(200);
    assert(!no.success || lastRoomSettings(G).setthiSkills === false, 'คนอื่นสลับไม่ได้');
    let r = await ack(H.socket, 'updateRoom', { setthiSkills: true });
    assert(r.success, 'หัวห้องเปิดได้');
    await waitFor(() => lastRoomSettings(G).setthiSkills === true, 5000, 'ทุกคนเห็นว่าเปิด');
    r = await ack(H.socket, 'updateRoom', { setthiSkills: 'yes' });
    await delay(150);
    assert(lastRoomSettings(G).setthiSkills === true, 'ค่ามั่วไม่เปลี่ยน');
    r = await ack(H.socket, 'updateRoom', { setthiSkills: false });
    await waitFor(() => lastRoomSettings(G).setthiSkills === false, 5000, 'ปิดอีกครั้ง');
    await start(H, [H, G], roomId);
    const S = last(G);
    assert(S.config.skills === false, 'state บอกว่าปิด');
    assert(S.seats.every(s => s.skills.length === 0), 'ปิด = ไม่มีใครมีสกิล');
    const i = idx(S, H.id);
    const S2 = await setup(H, { forceProcs: true, seats: { [i]: { pos: 30, cash: 20000 } }, dice: [[1, 2]], turnSeat: i });
    await ack(H.socket, 'setthi_roll', { seq: S2.phaseSeq });
    await waitFor(() => (last(G).fx || []).some(f => f.kind === 'salary' && f.playerId === H.id), 5000, 'ผ่านจุดเริ่ม');
    assert(!(last(G).fx || []).some(f => f.kind === 'skill'), 'ห้องปิดสกิล ไม่มีสกิลติด');
    assert(last(G).fx.find(f => f.kind === 'salary' && f.playerId === H.id).amount === 3000, 'เงินเดือนปกติ');
    console.log('L. สวิตช์สกิลของห้อง: สร้างแบบปิด · หัวห้องสลับ · คนอื่นสลับไม่ได้ · ปิด = ไม่มีสกิล ✓');
    await ack(H.socket, 'leaveRoom', { playerId: H.id });
    await ack(G.socket, 'leaveRoom', { playerId: G.id });
    await delay(300);
}

async function scenarioM(H, G) {
    H.states = []; G.states = [];
    const roomId = await createRoom(H);
    await join(roomId, G);
    assert((await ack(H.socket, 'setthi_addBots', { roomId, count: 1 })).success, 'เพิ่มบอท');
    await start(H, [H, G], roomId);
    let S = last(H);
    const i = idx(S, H.id);
    // H ถือด้านแรกเกือบครบ (ขาดตลาดน้ำ ช่อง 5) แล้วทอยไปตกพอดี
    const props = { 1: { owner: i, level: 1 }, 2: { owner: i, level: 1 }, 4: { owner: i, level: 1 }, 6: { owner: i, level: 1 }, 7: { owner: i, level: 1 } };
    S = await setup(H, { resetProps: true, forceProcs: false, props, seats: { [i]: { pos: 0, cash: 20000 } }, dice: [[2, 3]], turnSeat: i });
    let r = await ack(H.socket, 'setthi_roll', { seq: S.phaseSeq });
    assert(r.success, 'ทอย');
    await waitFor(() => last(H).phase === 'build' && last(H).phaseActor === H.id, 5000, 'แผ่นซื้อตลาดน้ำ');
    r = await ack(H.socket, 'setthi_build', { seq: last(H).phaseSeq, level: 0 });
    assert(r.success, 'ซื้อ: ' + r.error);
    await waitFor(() => last(H).phase === 'finished' && last(H).reward && last(G).reward, 8000, 'จบเกม + รางวัล');
    const fh = last(H);
    const fg = last(G);
    assert(fh.winType === 'line', 'ผูกขาดแถว');
    assert(fh.reward.total === 220 && fh.reward.requested === 220, 'ผู้ชนะได้ 20 + 200 = 220 (ได้ ' + fh.reward.total + ')');
    assert(fh.reward.parts.map(p => p.key).join(',') === 'finished,win', 'รายละเอียด: จบเกม + ชนะ');
    assert(fh.reward.gold === 270, 'ยอดหลังได้ = 270');
    assert(fg.reward.total === 20 && fg.reward.gold === 20, 'คนแพ้ได้ 20');
    assert(!fh.debugUsed, 'เกมปกติ');
    let p = await api(H.id, 'GET', '/api/setthi/gold');
    assert(p.json.profile.gold === 270 && p.json.profile.earnedToday === 220, 'ร้านเห็นยอดใหม่');
    // ขอ state ซ้ำ/finalize ซ้ำไม่เพิ่ม
    H.socket.emit('setthi_requestState', { roomId, playerId: H.id });
    await delay(400);
    p = await api(H.id, 'GET', '/api/setthi/gold');
    assert(p.json.profile.gold === 270, 'ขอ state ซ้ำ ยอดไม่เพิ่ม');
    console.log('M. จบเกม: ผู้ชนะ +220 🪙 · คนแพ้ +20 🪙 · รายละเอียดเห็นแค่ของตัวเอง · ร้านเห็นยอดใหม่ ✓');
}

async function main() {
    const started = Date.now();
    const H = randomUUID();
    const G = randomUUID();
    fs.writeFileSync(path.join(DATA, 'setthiGold.json'), JSON.stringify({
        [H]: { gold: 50, skills: { start2x: 5, builder: 3, luck: 2, fly: 1 }, loadout: ['start2x', 'builder', 'luck'] }
    }));
    let server = await bootServer();
    try {
        const h = await makeClient('H', H);
        const g = await makeClient('G', G);
        await scenarioK(h, g);
        await scenarioL(h, g);
        await scenarioM(h, g);
        h.socket.close(); g.socket.close();
        await delay(600);
        await stopServer(server);
        server = await bootServer();
        const p = await api(H, 'GET', '/api/setthi/gold');
        assert(p.json.profile.gold === 270 && p.json.profile.skills.start2x === 5, 'รีสตาร์ตแล้วยอด/สกิลยังอยู่ ไม่เพิ่มซ้ำ');
        const pg = await api(G, 'GET', '/api/setthi/gold');
        assert(pg.json.profile.gold === 20, 'G ยังได้ 20');
        console.log('N. รีสตาร์ตแล้วยอดเท่าเดิม ✓');
        assert(!/gold award failed|\[setthi\] (tick|bots|recover) failed/.test(server.logs()), 'ไม่มี error ฝั่งเซิร์ฟเวอร์');
    } finally {
        await stopServer(server);
    }
    console.log(`✅ setthi gold play: ${checks} checks (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

main().then(() => process.exit(0)).catch(error => { console.error('❌', error.stack || error.message); process.exit(1); });
