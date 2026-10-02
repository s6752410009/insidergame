/**
 * คลื่นความคิด — เล่นผ่าน socket จริงจนจบเกม
 *   A) 3 คน + คนเข้ากลางเกม: คำสั่งผิดถูกปัด, ต่อใหม่กลางรอบ (resync), ผู้ใบ้หลุด → ข้ามหลังผ่อนผัน,
 *      คิดไม่ทัน → ข้าม, หัวห้องออกกลางเกม, คนทายออก, สถิติ, กลับห้องรอแล้วเริ่มใหม่
 *   B) 12 คน เต็มเกม 1 รอบโต๊ะ   C) 3 คน 2 รอบโต๊ะ
 *   ทุก payload ที่คนไม่มีสิทธิ์ได้รับ ถูกสแกนหาเป้าลับ/เข็มคนอื่น/การ์ดตัวเลือก
 * รัน: npm run smoke:wavelength:play   (SMOKE_PORT=8831 ค่าเริ่มต้น)
 */
const path = require('path');
const fs = require('fs');

const TMP_ROOT = path.join(__dirname, '..', '..', '..', 'tmpdata-wavelength');
const TMP = path.join(TMP_ROOT, `play-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
process.env.GAME_DATA_DIR = TMP;
process.env.WALLETS_FILE = path.join(TMP, 'wallets.json');
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
require('./isolateTestData');

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const T = { CLUE: 4000, GUESS: 5000, REVEAL: 2500, SKIP: 900, GRACE: 1500 };
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
let leakChecks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            MONGO_URL: '',
            WAVELENGTH_CLUE_MS: String(T.CLUE),
            WAVELENGTH_GUESS_MS: String(T.GUESS),
            WAVELENGTH_REVEAL_MS: String(T.REVEAL),
            WAVELENGTH_SKIP_MS: String(T.SKIP),
            WAVELENGTH_GRACE_MS: String(T.GRACE)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.on('exit', code => { if (code && code !== 0) rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.once('connect', () => r(s)); }); }
async function waitFor(pred, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pred()) return true;
        await delay(40);
    }
    throw new Error('timeout waiting for ' + label);
}

// ---------- ตรวจความลับในทุก payload ----------
const knownTargets = new Map(); // `${roomId}:${round}` → target (จากจอผู้ใบ้)
function deepFind(obj, key, out = [], depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return out;
    if (Array.isArray(obj)) { obj.forEach(v => deepFind(v, key, out, depth + 1)); return out; }
    Object.keys(obj).forEach(k => {
        if (k === key) out.push(obj[k]);
        deepFind(obj[k], key, out, depth + 1);
    });
    return out;
}
function auditPayload(player, eventName, payload) {
    if (eventName === 'wavelengthState') {
        const s = payload;
        const mine = s.self && s.self.playerId === player.id;
        assert(mine || !s.self, 'state ต้องเป็นของคนรับเท่านั้น');
        const isGiver = s.giverId === player.id;
        if (s.phase === 'clue' || s.phase === 'guess') {
            if (isGiver) {
                assert(typeof s.target === 'number', 'ผู้ใบ้ต้องเห็นเป้า');
                knownTargets.set(`${player.roomId}:${s.round}`, s.target);
            } else {
                assert(s.target === null, `รั่ว: ${player.name} เห็นเป้าตอน ${s.phase}`);
                assert((s.options || []).length === 0, `รั่ว: ${player.name} เห็นการ์ดตัวเลือก`);
                assert(s.lastRound === null, `รั่ว: ${player.name} เห็นผลรอบก่อนเปิด`);
                // rounds = ประวัติรอบที่เปิดไปแล้ว (เป้าเก่าเปิดเผยได้) — ต้องไม่มีรอบปัจจุบัน
                assert((s.rounds || []).every(x => x.round < s.round), `รั่ว: ประวัติมีรอบปัจจุบัน (${player.name})`);
                assert(deepFind({ ...s, rounds: null }, 'target').every(v => v === null), `รั่ว: มี target ซ่อนใน payload ของ ${player.name}`);
                if (s.phase === 'clue') assert(s.card === null, `รั่ว: ${player.name} เห็นการ์ดก่อนผู้ใบ้ส่งคำใบ้`);
                leakChecks += 1;
            }
            // เข็มคนอื่นห้ามมีก่อนเปิด
            assert((s.players || []).every(p => !('pin' in p)), `รั่ว: ${player.name} เห็นเข็มคนอื่น`);
            assert(deepFind(s, 'pin').length <= 1, `รั่ว: pin มากกว่าของตัวเองใน payload ${player.name}`);
            assert(deepFind(s, 'results').length === 0, `รั่ว: results ก่อนเปิด (${player.name})`);
        }
        return;
    }
    // event อื่น ๆ (roomUpdate, chat, ...) ต้องไม่มีเป้า/ตัวเลือก/เข็มเลย
    const t = deepFind(payload, 'target').filter(v => v != null);
    assert(t.length === 0, `รั่ว: event ${eventName} มี target`);
    assert(deepFind(payload, 'options').filter(v => Array.isArray(v) && v.length).length === 0, `รั่ว: event ${eventName} มี options`);
    assert(deepFind(payload, 'pin').filter(v => v != null).length === 0, `รั่ว: event ${eventName} มี pin`);
}

async function makePlayer(base, name) {
    const socket = await conn(base);
    const id = randomUUID();
    const p = { socket, id, name, states: [], roomId: null };
    attach(p);
    socket.emit('initPlayer', id);
    return p;
}
function attach(p) {
    p.socket.onAny((ev, payload) => {
        try {
            auditPayload(p, ev, payload);
        } catch (e) {
            p.leak = p.leak || e;
        }
        if (ev === 'wavelengthState') p.states.push(payload);
    });
}
async function reconnect(base, p) {
    try { p.socket.close(); } catch (e) { /* ignore */ }
    p.socket = await conn(base);
    attach(p);
    p.socket.emit('initPlayer', p.id);
    p.socket.emit('setRoom', { roomId: p.roomId, playerId: p.id });
}
const last = p => p.states[p.states.length - 1];
const ctx = s => ({ round: s.round, phase: s.phase });
function checkLeaks(players) { players.forEach(p => { if (p.leak) throw p.leak; }); }

async function setupRoom(base, count, opts = {}) {
    const players = [];
    for (let i = 0; i < count; i += 1) players.push(await makePlayer(base, 'P' + i));
    await delay(300);
    const [host] = players;
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'คลื่นความคิด', gameMode: 'wavelength', maxPlayers: opts.maxPlayers || 12, wavelengthLaps: opts.laps || 1 });
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    host.roomId = roomId;
    host.socket.emit('setRoom', { roomId, playerId: host.id });
    for (const p of players.slice(1)) {
        const j = await ack(p.socket, 'joinRoom', { roomId, playerId: p.id });
        assert(j?.success, 'join ไม่ได้: ' + JSON.stringify(j));
        p.roomId = roomId;
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(300);
    return { roomId, players, host };
}

function giverOf(players) {
    const s = players.map(last).find(Boolean);
    return players.find(p => p.id === s.giverId);
}
async function playRound(players, admin, rng) {
    const live = players.filter(p => p.socket.connected);
    await waitFor(() => live.every(p => last(p) && last(p).phase === 'clue' && last(p).round === last(live[0]).round), 6000, 'clue state');
    const s0 = last(live[0]);
    const giver = live.find(p => p.id === s0.giverId);
    assert(giver, 'ผู้ใบ้ออนไลน์');
    const gs = last(giver);
    let r = await ack(giver.socket, 'wavelength_pickCard', { index: rng() < 0.5 ? 0 : 1, ...ctx(gs) });
    assert(r.success, 'เลือกการ์ด: ' + JSON.stringify(r));
    await waitFor(() => last(giver).card, 3000, 'card picked');
    r = await ack(giver.socket, 'wavelength_clue', { text: 'สิ่งที่คิดอยู่ ' + Math.floor(rng() * 1e6).toString(36).replace(/[0-9]/g, 'ก'), ...ctx(last(giver)) });
    assert(r.success, 'ส่งคำใบ้: ' + JSON.stringify(r));
    await waitFor(() => live.every(p => last(p).phase === 'guess'), 4000, 'guess');
    const target = knownTargets.get(`${giver.roomId}:${s0.round}`);
    const pins = {};
    for (const p of live) {
        if (p === giver || !last(p).self.isGuesser) continue;
        const v = Math.round(rng() * 1000) / 10;
        pins[p.id] = v;
        await ack(p.socket, 'wavelength_pin', { value: (v + 30) % 100, ...ctx(last(p)) });
        const lr = await ack(p.socket, 'wavelength_lock', { value: v, ...ctx(last(p)) });
        if (!lr.success && last(p).phase !== 'guess') break;
        assert(lr.success, 'ล็อก: ' + JSON.stringify(lr));
    }
    await waitFor(() => live.every(p => last(p).phase === 'reveal' || last(p).phase === 'finished'), 6000, 'reveal');
    const rv = last(live[0]);
    const lrnd = rv.lastRound;
    assert(lrnd && lrnd.target === target, `เป้าที่เปิด (${lrnd && lrnd.target}) ต้องตรงกับที่ผู้ใบ้เห็น (${target})`);
    const bands = d => (d <= 4 ? 4 : d <= 11 ? 3 : d <= 18 ? 2 : 0);
    lrnd.results.forEach(row => {
        if (pins[row.playerId] != null) {
            assert(Math.abs(row.pin - pins[row.playerId]) < 0.051, 'เข็มที่เปิดตรงกับที่ล็อก');
            assert(row.points === bands(Math.round(Math.abs(row.pin - target) * 10) / 10), 'แต้มตามแถบ');
        }
    });
    const guessed = lrnd.results.filter(x => x.pin != null);
    const avg = guessed.length ? Math.round(guessed.reduce((a, x) => a + x.points, 0) / guessed.length) : 0;
    assert(lrnd.giverPoints === avg, 'ผู้ใบ้ได้ค่าเฉลี่ยปัดเศษ');
    return { giver, round: s0.round };
}
async function nextRound(admin, players) {
    const s = last(admin);
    if (s.phase !== 'reveal') return;
    const r = await ack(admin.socket, 'wavelength_next', ctx(s));
    assert(r.success, 'รอบต่อไป: ' + JSON.stringify(r));
    await waitFor(() => players.filter(p => p.socket.connected).every(p => ['clue', 'finished'].includes(last(p).phase) && last(p).round >= s.round), 5000, 'next round');
}

function readStats() {
    const file = path.join(TMP, 'playerStats.json');
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    return Array.isArray(raw) ? raw : Object.values(raw);
}

(async () => {
    const port = Number(process.env.SMOKE_PORT) || 8831;
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    let rngSeed = 99;
    const rng = () => { rngSeed = (rngSeed * 16807) % 2147483647; return rngSeed / 2147483647; };
    const everyone = [];
    try {
        // ================= A =================
        const A = await setupRoom(base, 3, { maxPlayers: 6 });
        everyone.push(...A.players);
        const [host, p1, p2] = A.players;
        const tooFew = await ack(host.socket, 'wavelength_next', {});
        assert(tooFew.success === false, 'ก่อนเริ่มเกม คำสั่งเกมถูกปัด');
        assert((await ack(host.socket, 'startGameFromLobby', { roomId: A.roomId }))?.success, 'เริ่มเกมไม่ได้');
        await waitFor(() => A.players.every(p => last(p)?.phase === 'clue'), 8000, 'first clue');
        let s = last(p1);
        assert(s.giverId === host.id, 'ผู้ใบ้คนแรก = ที่นั่งแรก');
        assert(s.roundsTotal === 3, 'รอบทั้งหมด = 3');
        const html = await (await fetch(`${base}/game/${A.roomId}?playerId=${p1.id}`)).text();
        assert(/wlRoot/.test(html) && /คลื่นความคิด/.test(html), 'หน้า /game แสดงกระดานคลื่นความคิด');
        const target1 = last(host).target;
        assert(!html.includes(`"target":${target1}`) && /"target":null/.test(html), 'HTML ของคนทายไม่ฝังเป้าลับ');
        const hostHtml = await (await fetch(`${base}/game/${A.roomId}?playerId=${host.id}`)).text();
        assert(hostHtml.includes(`"target":${target1}`), 'HTML ของผู้ใบ้มีเป้า (เทียบ)');
        console.log('1. เริ่มเกม 3 คน · ผู้ใบ้ = ที่นั่งแรก · HTML ไม่ฝังเป้า ✓');

        // ---- คำสั่งผิด
        let r = await ack(p1.socket, 'wavelength_pickCard', { index: 0, ...ctx(s) });
        assert(!r.success && /ไม่ใช่ผู้ใบ้/.test(r.error), 'คนอื่นเลือกการ์ดไม่ได้');
        r = await ack(p1.socket, 'wavelength_clue', { text: 'อะไร', ...ctx(s) });
        assert(!r.success, 'คนอื่นส่งคำใบ้ไม่ได้');
        r = await ack(host.socket, 'wavelength_clue', { text: 'อะไร', ...ctx(s) });
        assert(!r.success && /เลือกการ์ด/.test(r.error), 'ยังไม่เลือกการ์ด ส่งคำใบ้ไม่ได้');
        r = await ack(host.socket, 'wavelength_pickCard', { index: 7, ...ctx(s) });
        assert(!r.success, 'เลือกการ์ดเกินช่องไม่ได้');
        const opts0 = last(host).options.map(c => c.id).join();
        r = await ack(host.socket, 'wavelength_reroll', ctx(s));
        assert(r.success, 'สุ่มการ์ดใหม่ได้');
        await waitFor(() => last(host).rerollUsed, 2000, 'reroll');
        assert(last(host).options.map(c => c.id).join() !== opts0, 'การ์ดชุดใหม่');
        r = await ack(host.socket, 'wavelength_reroll', ctx(s));
        assert(!r.success && /ครั้งเดียว/.test(r.error), 'สุ่มซ้ำไม่ได้');
        r = await ack(host.socket, 'wavelength_pickCard', { index: 1, ...ctx(s) });
        assert(r.success, 'ผู้ใบ้เลือกการ์ด');
        await waitFor(() => last(host).card, 2000, 'card');
        const card = last(host).card;
        assert(last(p1).card === null, 'คนทายยังไม่เห็นการ์ดก่อนคำใบ้');
        r = await ack(host.socket, 'wavelength_clue', { text: 'แบบ' + card.left, ...ctx(s) });
        assert(!r.success && /คำบนการ์ด/.test(r.error), 'ห้ามคำบนการ์ด');
        r = await ack(host.socket, 'wavelength_clue', { text: 'เลข 42', ...ctx(s) });
        assert(!r.success && /ตัวเลข/.test(r.error), 'ห้ามตัวเลข');
        r = await ack(host.socket, 'wavelength_clue', { text: 'ก'.repeat(41), ...ctx(s) });
        assert(!r.success && /40/.test(r.error), 'ห้ามยาวเกิน 40');
        r = await ack(host.socket, 'wavelength_clue', { text: { evil: true }, ...ctx(s) });
        assert(!r.success, 'คำใบ้ที่ไม่ใช่ข้อความถูกปัด');
        r = await ack(host.socket, 'wavelength_clue', { text: 'ต้นไม้', round: s.round - 1, phase: 'clue' });
        assert(!r.success && /จังหวะ/.test(r.error), 'รอบเก่าถูกปัด');
        r = await ack(p1.socket, 'wavelength_lock', { value: 50, ...ctx(s) });
        assert(!r.success, 'ยังไม่ถึงช่วงทาย ล็อกไม่ได้');
        r = await ack(p1.socket, 'wavelength_end', {});
        assert(!r.success && /หัวห้อง/.test(r.error), 'คนอื่นจบเกมไม่ได้');
        r = await ack(p1.socket, 'wavelength_next', ctx(s));
        assert(!r.success, 'ยังไม่เปิดเป้า กดรอบต่อไปไม่ได้');
        console.log('2. คำสั่งผิด/ผิดสิทธิ์/ผิดจังหวะ ถูกปัดทั้งหมด ✓');

        r = await ack(host.socket, 'wavelength_clue', { text: '  ทะเล  ตอนเที่ยง ', ...ctx(s) });
        assert(r.success, 'ส่งคำใบ้ได้');
        await waitFor(() => A.players.every(p => last(p).phase === 'guess'), 3000, 'guess');
        assert(last(p1).clue === 'ทะเล ตอนเที่ยง' && last(p1).card.id === card.id, 'ทุกคนเห็นคำใบ้ + การ์ด');
        r = await ack(host.socket, 'wavelength_lock', { value: 50, ...ctx(last(host)) });
        assert(!r.success && /ผู้ใบ้/.test(r.error), 'ผู้ใบ้ทายไม่ได้');
        r = await ack(p1.socket, 'wavelength_pin', { value: 'abc', ...ctx(last(p1)) });
        assert(!r.success, 'เข็มค่าเพี้ยนถูกปัด');

        // ---- คนเข้ากลางเกม
        const late = await makePlayer(base, 'Late');
        everyone.push(late);
        r = await ack(late.socket, 'joinRoom', { roomId: A.roomId, playerId: late.id });
        assert(r?.success, 'เข้ากลางเกมได้: ' + JSON.stringify(r));
        late.roomId = A.roomId;
        late.socket.emit('setRoom', { roomId: A.roomId, playerId: late.id });
        await waitFor(() => last(late)?.phase === 'guess', 3000, 'late state');
        assert(last(late).self.pending && !last(late).self.isGuesser, 'คนมาสายรอรอบหน้า');
        r = await ack(late.socket, 'wavelength_lock', { value: 30, ...ctx(last(late)) });
        assert(!r.success && /รอบหน้า/.test(r.error), 'คนมาสายล็อกไม่ได้');
        console.log('3. คนเข้ากลางเกม เห็นเกม แต่ได้ทายรอบหน้า ✓');

        // ---- ต่อใหม่กลางรอบ: ขยับเข็มไว้ แล้วหลุด ต่อกลับต้องได้ state เต็ม + เข็มเดิม
        r = await ack(p1.socket, 'wavelength_pin', { value: 33.3, ...ctx(last(p1)) });
        assert(r.success, 'ขยับเข็ม');
        const before = p1.states.length;
        await reconnect(base, p1);
        await waitFor(() => p1.states.length > before && last(p1).phase === 'guess', 4000, 'resync');
        const rs = last(p1);
        assert(rs.self.pin === 33.3 && rs.clue === 'ทะเล ตอนเที่ยง' && rs.card && rs.self.isGuesser && rs.target === null, 'resync เต็ม: เข็มเดิม + คำใบ้ + การ์ด ไม่มีเป้า');
        r = await ack(p1.socket, 'wavelength_lock', { ...ctx(rs) });
        assert(r.success, 'ล็อกที่ตำแหน่งเข็มเดิม');
        await waitFor(() => last(p2).players.find(x => x.playerId === p1.id).locked, 2000, 'lock visible');
        const p2view = last(p2);
        assert(p2view.players.find(x => x.playerId === p1.id).locked === true, 'คนอื่นเห็นว่าล็อกแล้ว');
        r = await ack(p1.socket, 'wavelength_unlock', ctx(last(p1)));
        assert(r.success, 'ปลดล็อกได้ก่อนหมดเวลา');
        r = await ack(p1.socket, 'wavelength_lock', { value: 33.3, ...ctx(last(p1)) });
        assert(r.success, 'ล็อกใหม่');
        r = await ack(p2.socket, 'wavelength_lock', { value: 80, ...ctx(last(p2)) });
        assert(r.success, 'p2 ล็อก');
        await waitFor(() => A.players.concat(late).every(p => last(p).phase === 'reveal'), 3000, 'reveal 1');
        const rev = last(late);
        assert(rev.target === target1 && rev.lastRound.results.length === 2, 'เปิดแล้วทุกคน (รวมคนมาสาย) เห็นเป้า + เข็ม');
        assert(rev.lastRound.results.find(x => x.playerId === p1.id).pin === 33.3, 'เข็ม p1 ตามที่ล็อก');
        console.log('4. หลุดกลางรอบ ต่อกลับได้ state เต็ม · ปลดล็อก/ล็อกใหม่ · ล็อกครบเปิดทันที ✓');

        // ---- พร้อม: คนที่ไม่ใช่หัวห้องกด = พร้อม · หัวห้องกด = ไป
        r = await ack(p2.socket, 'wavelength_next', ctx(last(p2)));
        assert(r.success && last(p2).phase === 'reveal', 'คนอื่นกด = พร้อม ยังไม่ข้าม');
        await waitFor(() => (last(host).readyIds || []).includes(p2.id), 2000, 'ready shown');
        await nextRound(host, A.players.concat(late));
        s = last(late);
        assert(s.round === 2 && s.self.active && !s.self.pending, 'รอบ 2 คนมาสายได้เล่นแล้ว');
        assert(s.giverId === p1.id, 'ผู้ใบ้รอบ 2 = ที่นั่งถัดไป');
        assert(s.roundsTotal === 4, 'รอบทั้งหมดเพิ่มเป็น 4 (มีคนมาเพิ่ม)');

        // ---- ผู้ใบ้หลุด → ผ่อนผัน → ข้ามรอบ
        const giverClosedAt = Date.now();
        p1.socket.close();
        await waitFor(() => last(p2).giverAway === true, 3000, 'giver away');
        assert(last(p2).phaseEndsAt - Date.now() <= T.GRACE + 200, 'นาฬิกาเหลือแค่ช่วงผ่อนผัน');
        await waitFor(() => last(p2).phase === 'reveal' && last(p2).lastRound && last(p2).lastRound.skipped, T.GRACE + 3000, 'skip after grace');
        assert(Date.now() - giverClosedAt >= T.GRACE - 100, 'ข้ามหลังช่วงผ่อนผัน');
        assert(/หลุด/.test(last(p2).lastRound.reason), 'เหตุผล: ผู้ใบ้หลุด');
        await reconnect(base, p1);
        await waitFor(() => last(p1) && last(p1).round >= 2, 3000, 'p1 back');
        await waitFor(() => last(p2).phase === 'clue' && last(p2).round === 3, T.SKIP + 3000, 'auto next after skip');
        assert(last(p2).giverId === p2.id, 'ข้ามแล้วไปผู้ใบ้คนถัดไป');
        console.log('5. ผู้ใบ้หลุด → เหลือเวลาผ่อนผัน → ข้ามรอบ → ไปคนถัดไปเอง ✓');

        // ---- คิดไม่ทัน → ข้าม
        await waitFor(() => last(p2).phase === 'reveal', T.CLUE + 3000, 'clue timeout');
        assert(last(p2).lastRound.skipped && /ไม่ทัน/.test(last(p2).lastRound.reason), 'คิดไม่ทัน = ข้ามรอบ');
        assert(A.players.every(p => (last(p).scoreboard || []).every(x => typeof x.score === 'number')), 'มีตารางคะแนน');
        console.log('6. หมดเวลาคิดคำใบ้ → ข้ามรอบ ไม่มีใครได้แต้ม ✓');

        // ---- หัวห้องออกกลางเกม
        await waitFor(() => last(p1).phase === 'clue' && last(p1).round === 4, T.SKIP + 3000, 'round 4');
        assert(last(p1).giverId === late.id, 'รอบ 4 ผู้ใบ้ = คนมาสาย');
        r = await ack(host.socket, 'leaveRoom', {});
        await waitFor(() => last(p1).isHost === true, 3000, 'admin transferred');
        assert(last(p1).availableActions.canEnd, 'หัวห้องใหม่จบเกมได้');
        const live = [p1, p2, late];
        await playRound(live, p1, rng);
        await waitFor(() => live.every(p => ['reveal', 'finished'].includes(last(p).phase)), 3000, 'r4 reveal');
        console.log('7. หัวห้องออกกลางเกม → โอนหัวห้อง เกมเดินต่อ ✓');

        // ---- ครบทุกคน (host ออกไปแล้ว ไม่นับ) → จบเกม
        await nextRound(p1, live);
        await waitFor(() => live.every(p => last(p).phase === 'finished'), 6000, 'finished');
        const fin = last(p2);
        assert(fin.status === 'wavelength_finished' && Array.isArray(fin.standings) && fin.standings.length >= 3, 'จบเกมมีตารางอันดับ');
        assert(fin.standings.some(x => x.playerId === host.id && x.left), 'คนที่ออกไปแล้วยังอยู่ในตาราง (ออกแล้ว)');
        const top = fin.standings[0].score;
        assert(fin.winners.every(w => w.score === top) && fin.winners.length === fin.standings.filter(x => x.score === top && top > 0).length, 'ผู้ชนะ = แต้มสูงสุด (เสมอชนะร่วม)');
        await delay(800);
        const stats = readStats();
        fin.standings.forEach(row => {
            const st = stats.find(x => x.playerId === row.playerId);
            assert(st && st.modeStats?.wavelength?.games === 1, `บันทึกสถิติ ${row.name} 1 เกม`);
            assert((st.modeStats.wavelength.wins === 1) === !!row.won, 'ชนะ/แพ้ตามแต้มสูงสุด');
        });
        console.log(`8. จบเกม · อันดับ ${fin.standings.map(x => x.name + '=' + x.score).join(', ')} · สถิติถูก ✓`);

        const back = new Promise(res => p1.socket.once('redirectToLobby', () => res(true)));
        r = await ack(p1.socket, 'returnFinishedToLobby', { roomId: A.roomId });
        assert(r.success, 'กลับห้องรอได้');
        assert(await Promise.race([back, delay(4000).then(() => false)]), 'ทุกคนกลับห้องรอ');
        await delay(400);
        r = await ack(p1.socket, 'startGameFromLobby', { roomId: A.roomId });
        assert(r.success, 'เริ่มเกมใหม่ได้: ' + JSON.stringify(r));
        await waitFor(() => last(p2).phase === 'clue' && last(p2).round === 1, 8000, 'new game');
        await delay(500);
        const st2 = readStats().find(x => x.playerId === p2.id);
        assert(st2.modeStats.wavelength.games === 1, 'สถิติไม่บันทึกซ้ำ');
        r = await ack(p1.socket, 'wavelength_end', {});
        assert(r.success, 'หัวห้องจบเกมได้');
        console.log('9. กลับห้องรอ → เริ่มใหม่ได้ · สถิติไม่ซ้ำ · หัวห้องจบเกม ✓');

        // ---- คนทายออกกลางช่วงทาย (เกมใหม่ 4 คน)
        const D = await setupRoom(base, 4);
        everyone.push(...D.players);
        assert((await ack(D.host.socket, 'startGameFromLobby', { roomId: D.roomId }))?.success, 'start D');
        await waitFor(() => D.players.every(p => last(p)?.phase === 'clue'), 8000, 'D clue');
        const dg = giverOf(D.players);
        await ack(dg.socket, 'wavelength_pickCard', { index: 0, ...ctx(last(dg)) });
        await ack(dg.socket, 'wavelength_clue', { text: 'ลูกแมว', ...ctx(last(dg)) });
        await waitFor(() => D.players.every(p => last(p).phase === 'guess'), 3000, 'D guess');
        const guessers = D.players.filter(p => p !== dg);
        await ack(guessers[0].socket, 'wavelength_lock', { value: 10, ...ctx(last(guessers[0])) });
        await ack(guessers[1].socket, 'wavelength_lock', { value: 90, ...ctx(last(guessers[1])) });
        await ack(guessers[2].socket, 'leaveRoom', {});
        await waitFor(() => last(guessers[0]).phase === 'reveal', 3000, 'reveal after guesser left');
        assert(last(guessers[0]).lastRound.results.length === 2, 'คนที่ออกไม่อยู่ในผล');
        console.log('10. คนทายออกกลางรอบ ที่เหลือล็อกครบ = เปิดเป้าทันที ✓');

        // ---- ผู้ใบ้ออก (ไม่ใช่หลุด) → ข้ามทันที · เหลือ 1 คน → จบ
        await nextRound(D.host, D.players.filter(p => p !== guessers[2]));
        const remain = D.players.filter(p => p !== guessers[2]);
        await waitFor(() => remain.every(p => last(p).phase === 'clue'), 3000, 'D r2');
        const dg2 = giverOf(remain);
        await ack(dg2.socket, 'leaveRoom', {});
        const rest = remain.filter(p => p !== dg2);
        await waitFor(() => rest.every(p => last(p).phase === 'reveal' && last(p).lastRound.skipped), 3000, 'skip after giver left');
        await ack(rest[0].socket, 'leaveRoom', {});
        await waitFor(() => last(rest[1]).phase === 'finished', 3000, 'finish when alone');
        console.log('11. ผู้ใบ้ออก = ข้ามทันที · เหลือคนเดียว = จบเกม ✓');

        // ================= B: 12 คน =================
        const B = await setupRoom(base, 12);
        everyone.push(...B.players);
        assert((await ack(B.host.socket, 'startGameFromLobby', { roomId: B.roomId }))?.success, 'start 12');
        const giversB = [];
        for (let i = 0; i < 12; i += 1) {
            const { giver } = await playRound(B.players, B.host, rng);
            giversB.push(giver.id);
            if (i < 11) await nextRound(B.host, B.players);
        }
        await nextRound(B.host, B.players);
        await waitFor(() => B.players.every(p => last(p).phase === 'finished'), 5000, 'B finished');
        assert(giversB.join() === B.players.map(p => p.id).join(), '12 คน ผู้ใบ้วนครบตามที่นั่ง');
        const finB = last(B.players[5]);
        assert(finB.standings.length === 12 && finB.round === 12, '12 คน 12 รอบ ตารางครบ');
        console.log(`12. 12 คน เล่นครบ 12 รอบ · ผู้ชนะ ${finB.winners.map(w => w.name).join(', ') || '-'} ✓`);

        // ================= C: 3 คน 2 รอบโต๊ะ =================
        const C = await setupRoom(base, 3, { laps: 1, maxPlayers: 3 });
        everyone.push(...C.players);
        r = await ack(C.players[1].socket, 'updateRoom', { wavelengthLaps: 2 });
        assert(!r.success, 'คนอื่นแก้ตั้งค่าห้องไม่ได้');
        r = await ack(C.host.socket, 'updateRoom', { wavelengthLaps: 2 });
        assert(r.success, 'หัวห้องตั้ง 2 รอบโต๊ะ');
        assert((await ack(C.host.socket, 'startGameFromLobby', { roomId: C.roomId }))?.success, 'start C');
        await waitFor(() => C.players.every(p => last(p)?.phase === 'clue'), 8000, 'C clue');
        assert(last(C.players[0]).roundsTotal === 6 && last(C.players[0]).laps === 2, '2 รอบโต๊ะ = 6 รอบ');
        for (let i = 0; i < 6; i += 1) {
            await playRound(C.players, C.host, rng);
            await nextRound(C.host, C.players);
        }
        await waitFor(() => C.players.every(p => last(p).phase === 'finished'), 5000, 'C finished');
        const sumScores = last(C.players[0]).standings.reduce((a, x) => a + x.score, 0);
        assert(sumScores >= 0, 'แต้มรวมถูกต้อง');
        console.log('13. 3 คน × 2 รอบโต๊ะ = 6 รอบ จบเกม ✓');

        checkLeaks(everyone);
        assert(leakChecks > 100, `ต้องตรวจความลับมากพอ (${leakChecks})`);
        assert(!/\[wavelength\].*failed/.test(server.logs()), 'server log มี error:\n' + server.logs().split('\n').filter(l => /wavelength/.test(l)).slice(-5).join('\n'));
        assert(!/\[socket:wavelength/.test(server.logs()), 'socket handler พัง');
        console.log(`14. ตรวจทุก payload ที่คนไม่มีสิทธิ์ได้รับ ${leakChecks} ครั้ง — ไม่มีเป้า/เข็ม/การ์ดรั่ว ✓`);
        everyone.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });
        console.log(`\n✅ smoke-wavelength-play: ${checks} checks passed`);
    } finally {
        server.kill('SIGTERM');
        await delay(300);
        try { server.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
