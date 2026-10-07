/**
 * เศรษฐี — เล่นผ่าน socket จริง (เซิร์ฟเวอร์จริง + socket.io-client)
 *  A) 2 คน: คำสั่งผิด/ขยะโดนปฏิเสธ · ซื้อหลายขั้นในแผ่นเดียว (รอบแรกถึงบ้าน) · ซื้อต่อ 2 เท่า · แลนด์มาร์ก (ซื้อต่อไม่ได้)
 *     เกาะร้างทุกทางออก · งานวัด ×2 ย้ายที่ · ทัวร์วาร์ป · หลุดแล้วต่อใหม่ · เงินไม่พอขายที่ · ล้มละลาย
 *  B) 4/3/2 คน (มีบอท): คนออกกลางเกม · เตือนผูกขาด · ผูกขาด 3 สี / แถว / ท่องเที่ยว ชนะทันที
 *  C) คน 1 + บอท 3: autopilot · หลุดแล้วเกมไม่ค้าง · คนสุดท้ายออก = ปิดห้อง
 *  F) กดค้างทอย: เข็มกวาด 1.6–2.0 วิ · ช่องเขียวค้างจนปล่อย · เวลาปลอมถูกหนีบ · พารามิเตอร์เห็นแค่คนทอย
 *  E) เซิร์ฟเวอร์รีสตาร์ตกลางเกม · D) จำกัดเวลา
 * ทุก payload ถูกตรวจว่าไม่มีลำดับกองการ์ด/บัญชีภายใน · จัดฉากด้วย setthi_testSetup (เปิดเฉพาะ SETTHI_TEST_HOOKS=1)
 *
 * รัน: npm run smoke:setthi:play   (SMOKE_PORT=8850 · พอร์ตที่สองใช้ +1)
 */
const path = require('path');
const fs = require('fs');

if (!process.env.GAME_DATA_DIR) {
    const dir = path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', `play-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.env.GAME_DATA_DIR = dir;
    process.env.WALLETS_FILE = path.join(dir, 'wallets.json');
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

const PORT = Number(process.env.SMOKE_PORT) || 8850;
const BASE_ENV = {
    SETTHI_TEST_HOOKS: '1',
    SETTHI_ANIM_SCALE: '0',
    SETTHI_TURN_MS: '4000',
    SETTHI_DECIDE_MS: '3000',
    SETTHI_DEBT_MS: '3000',
    SETTHI_BOT_MS: '60',
    SETTHI_OFFLINE_GRACE_MS: '1500',
    SETTHI_OFFLINE_TURN_MS: '700'
};

function bootServer(port, extraEnv = {}, dataDir = process.env.GAME_DATA_DIR) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...BASE_ENV, ...extraEnv, GAME_DATA_DIR: dataDir, WALLETS_FILE: path.join(dataDir, 'wallets.json'), PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}
function stopServer(child, signal = 'SIGTERM') {
    return new Promise(res => {
        if (!child || child.exitCode !== null) { res(); return; }
        child.once('exit', () => res());
        child.kill(signal);
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } res(); }, 4000);
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
async function waitFor(pred, ms = 20000, label = 'condition') {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pred()) return true;
        await delay(40);
    }
    throw new Error('timeout waiting for ' + label);
}

// ---------- ตรวจความลับ ----------
let leakChecks = 0;
const CARD_RE = /"k\d\d"/g;
function inspectPayload(client, event, payload) {
    const json = JSON.stringify(payload === undefined ? null : payload);
    leakChecks += 1;
    assert(!/"deck"|testDice|"ledger"|lastLoggedHistoryAt|rollHold/.test(json), `รั่ว: ${client.name} ได้ field ภายใน (${event})`);
    if (event === 'setthiState') {
        assert(!payload.self || payload.self.playerId === client.id, `${client.name} ได้ state ของคนอื่น`);
        // id การ์ดโผล่ได้แค่ใน fx การ์ดที่เปิดแล้ว (ลำดับกองไม่รั่ว)
        const allowed = new Set((payload.fx || []).filter(f => f.kind === 'card').map(f => f.card.id));
        [...json.matchAll(CARD_RE)].map(m => m[0].slice(1, -1)).forEach(id => assert(allowed.has(id), `รั่ว: ${client.name} เห็นการ์ด ${id} ที่ยังไม่เปิด`));
        assert(payload.seats.every(s => s.cash >= 0), 'เงินติดลบ');
        if (payload.self && payload.self.sell) assert(payload.phaseActor === client.id, 'ราคาขายส่งให้เฉพาะคนที่ติดหนี้');
    }
}

async function makeClient(base, name, id = randomUUID()) {
    const socket = await conn(base);
    const client = { socket, id, name, states: [], seen: new Set() };
    socket.onAny((event, payload) => {
        inspectPayload(client, event, payload);
        if (event === 'setthiState') {
            client.states.push(payload);
            (payload.history || []).forEach(h => client.seen.add(h.text));
        }
    });
    socket.emit('initPlayer', id);
    return client;
}
const last = c => c.states[c.states.length - 1];
async function reattach(base, client) {
    const fresh = await makeClient(base, client.name, client.id);
    await delay(150);
    fresh.socket.emit('setRoom', { roomId: client.roomId, playerId: client.id });
    fresh.socket.emit('setthi_requestState', { roomId: client.roomId, playerId: client.id });
    fresh.roomId = client.roomId;
    return fresh;
}

async function createRoom(host, opts = {}) {
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: opts.name || 'เศรษฐี', gameMode: 'setthi', maxPlayers: 6, ...(opts.settings || {}) });
    assert(created && created.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    host.socket.emit('setRoom', { roomId: created.roomId, playerId: host.id });
    host.roomId = created.roomId;
    return created.roomId;
}
async function joinAll(roomId, clients) {
    for (const c of clients) {
        const r = await ack(c.socket, 'joinRoom', { roomId, playerId: c.id });
        assert(r && r.success, `${c.name} join ไม่ได้: ${JSON.stringify(r)}`);
        c.socket.emit('setRoom', { roomId, playerId: c.id });
        c.roomId = roomId;
    }
    await delay(250);
}
async function start(host, clients, roomId) {
    const r = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(r && r.success, 'เริ่มเกมไม่ได้: ' + JSON.stringify(r));
    await waitFor(() => clients.every(c => last(c) && last(c).status === 'playing'), 15000, 'เกมเริ่ม');
}
function newest(clients) {
    const live = clients.filter(c => c.socket.connected && last(c));
    return live.reduce((a, c) => (!a || last(c).step > last(a).step ? c : a), null);
}
const seatOf = (state, id) => state.seats.find(s => s.playerId === id);

const idx = c => last(c).seats.findIndex(s => s.playerId === c.id);

/** จัดฉากกลางเกม (เซิร์ฟเวอร์เปิด SETTHI_TEST_HOOKS เท่านั้น) แล้วรอ state ใหม่ */
async function setup(c, spec) {
    const before = last(c) ? last(c).step : 0;
    const r = await ack(c.socket, 'setthi_testSetup', { spec });
    assert(r.success, 'setup: ' + r.error);
    await waitFor(() => last(c).step > before, 5000, 'state หลัง setup');
    return last(c);
}
async function act(c, ev, payload = {}, ok = true) {
    const step = last(c).step;
    const r = await ack(c.socket, ev, { seq: last(c).phaseSeq, ...payload });
    if (ok) assert(r.success, `${c.name} ${ev}: ${r.error}`);
    else assert(!r.success, `${c.name} ${ev} ต้องโดนปฏิเสธ`);
    return step;
}
async function until(c, pred, label, ms = 8000) {
    await waitFor(() => last(c) && pred(last(c)), ms, label);
    return last(c);
}
const turnOf = (c, phase) => S => S.phaseActor === c.id && S.phase === phase;

/** ขับเกมด้วยนโยบายง่าย ๆ จนกว่า stop() จะจริงหรือเกมจบ */
async function drive(clients, opts = {}) {
    const stats = { actions: 0, rolls: 0, builds: 0, takeovers: 0, picks: 0, sells: 0 };
    const deadline = Date.now() + (opts.timeoutMs || 90000);
    while (Date.now() < deadline) {
        const top = newest(clients);
        if (!top) throw new Error('ไม่มี client');
        const S = last(top);
        if (S.phase === 'finished') return stats;
        if (opts.stop && opts.stop(S, stats)) return stats;
        const actor = clients.find(c => c.socket.connected && S.phaseActor === c.id);
        if (!actor || !opts.act) { await delay(50); continue; }
        const view = last(actor);
        if (view.phaseSeq !== S.phaseSeq) { await delay(30); continue; }
        const a = view.availableActions;
        const d = view.decision;
        let ev = null;
        const payload = { seq: view.phaseSeq };
        if (view.phase === 'debt' && view.self && view.self.sell) {
            const sq = Object.keys(view.self.sell)[0];
            if (sq !== undefined) { ev = 'setthi_sell'; payload.square = Number(sq); stats.sells += 1; }
        } else if (a.roll) { ev = 'setthi_roll'; stats.rolls += 1; }
        else if (a.build && d) {
            const open = d.options.filter(o => !o.built && !o.locked);
            const cash = seatOf(view, actor.id).cash;
            if (open.length && cash > 6000 && Math.random() < 0.8) { ev = 'setthi_build'; payload.level = open[Math.floor(Math.random() * Math.min(2, open.length))].level; stats.builds += 1; }
            else ev = 'setthi_pass';
        } else if (view.phase === 'takeover') { ev = a.takeover && Math.random() < 0.4 ? 'setthi_takeover' : 'setthi_declineTakeover'; if (ev === 'setthi_takeover') stats.takeovers += 1; }
        else if (a.pick && d) {
            if (Math.random() < 0.7 && d.options.length) { ev = 'setthi_pick'; payload.square = d.options[Math.floor(Math.random() * d.options.length)]; stats.picks += 1; }
            else ev = 'setthi_skipPick';
        }
        if (!ev) { await delay(40); continue; }
        await ack(actor.socket, ev, payload);
        stats.actions += 1;
        await delay(20);
    }
    return stats;
}

// ================= A) 2 คน: ทุกกติกาหลักผ่าน socket =================
async function scenarioA(base) {
    const P = await makeClient(base, 'A-host');
    const Q = await makeClient(base, 'A-guest');
    await delay(300);
    const roomId = await createRoom(P, { name: 'วงเศรษฐี A', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, [Q]);
    await start(P, [P, Q], roomId);
    const A = last(P).phaseActor === P.id ? P : Q;
    const O = A === P ? Q : P;
    const iA = idx(A);
    const iO = idx(O);

    // คำสั่งผิด/ขยะ
    await act(O, 'setthi_roll', {}, false);
    await act(O, 'setthi_build', { level: 2 }, false);
    await act(A, 'setthi_sell', { square: 1 }, false);
    await act(A, 'setthi_pick', { square: 4 }, false);
    await act(A, 'setthi_takeover', {}, false);
    let r = await ack(A.socket, 'setthi_roll', { seq: last(A).phaseSeq - 1 });
    assert(!r.success, 'seq เก่าโดนปฏิเสธ');
    r = await ack(A.socket, 'setthi_build', null);
    assert(!r.success, 'payload ขยะโดนปฏิเสธ');
    r = await ack(O.socket, 'setthi_fast', { on: true });
    assert(r.success, 'ใครก็กดเร่งได้');
    await until(A, S => S.fast === true, 'ทุกคนเห็นว่าเร่ง');
    await ack(O.socket, 'setthi_fast', { on: false });
    console.log('1. คำสั่งผิดตา/ผิดเฟส/seq เก่า/ข้อมูลขยะ โดนปฏิเสธ · ปุ่มเร่งเห็นทั้งโต๊ะ ✓');

    // ซื้อหลายขั้นในแผ่นเดียว · รอบแรกถึงบ้าน
    await setup(A, { seats: { [iA]: { pos: 0, laps: 0, cash: 20000 } }, dice: [[1, 3]], turnSeat: iA });
    await act(A, 'setthi_roll');
    let S = await until(A, turnOf(A, 'build'), 'แผ่นซื้อ');
    assert(S.decision.square === 4 && S.decision.mode === 'buy', 'ตกอุดร');
    assert(S.decision.options[2].locked === 'lap' && S.decision.options[1].locked === null, 'รอบแรกถึงบ้าน');
    await until(O, S2 => S2.decision && S2.decision.square === 4 && S2.decision.playerId === A.id, 'อีกคนเห็นว่ากำลังตัดสินใจอะไร');
    await act(A, 'setthi_build', { level: 3 }, false);
    await act(A, 'setthi_build', { level: 1 });
    S = await until(A, S2 => S2.props[4].owner === A.id, 'เป็นเจ้าของ');
    assert(S.props[4].level === 1 && S.tolls[4] > 0, 'มีบ้าน + ค่าผ่านทาง');
    console.log('2. ตกที่ว่าง: ซื้อที่ดิน+บ้านในแผ่นเดียว · รอบแรกสร้างเกินบ้านไม่ได้ ✓');

    // ซื้อต่อ 2 เท่า
    await setup(A, { props: { 7: { owner: iO, level: 2 } }, seats: { [iA]: { pos: 0, laps: 1, cash: 20000 } }, dice: [[3, 4]], turnSeat: iA });
    const oCash = seatOf(last(O), O.id).cash;
    await act(A, 'setthi_roll');
    S = await until(A, turnOf(A, 'takeover'), 'เสนอซื้อต่อ');
    assert(S.decision.price === 2 * (1000 + 500 + 1000), 'ราคาซื้อต่อ = 2 เท่าของมูลค่า: ' + S.decision.price);
    await act(A, 'setthi_takeover');
    S = await until(A, S2 => S2.props[7].owner === A.id && S2.phase === 'build', 'ซื้อต่อแล้ว สร้างต่อได้');
    assert(S.props[7].level === 2, 'สิ่งปลูกสร้างอยู่ครบ');
    assert(S.decision.mode === 'afterTakeover' && S.decision.options[4].locked === 'later', 'แลนด์มาร์กต้องตกซ้ำ');
    await until(O, S2 => S2.fx.some(f => f.kind === 'takeover' && f.from === O.id && f.price === 5000), 'เจ้าของเดิมได้ฉากถูกซื้อต่อ');
    assert(seatOf(last(O), O.id).cash === oCash + 2200 + 5000, 'เจ้าของเดิมได้ค่าผ่านทาง + ค่าซื้อต่อ');
    await act(A, 'setthi_pass');
    console.log('3. ซื้อต่อ 2 เท่า: เงินถึงเจ้าของเดิม · สิ่งปลูกสร้างอยู่ครบ · สร้างต่อได้ทันที ✓');

    // แลนด์มาร์ก: มีโรงแรม + ตกซ้ำ · ซื้อต่อไม่ได้
    await setup(A, { props: { 12: { owner: iA, level: 3 } }, seats: { [iA]: { pos: 8, laps: 1, cash: 20000 } }, dice: [[1, 3]], turnSeat: iA });
    await act(A, 'setthi_roll');
    S = await until(A, turnOf(A, 'build'), 'แผ่นสร้าง');
    assert(S.decision.options[4].locked === null, 'สร้างแลนด์มาร์กได้');
    await act(A, 'setthi_build', { level: 4 });
    await until(A, S2 => S2.props[12].level === 4, 'แลนด์มาร์ก');
    await setup(O, { seats: { [iO]: { pos: 8, cash: 60000 } }, dice: [[1, 3]], turnSeat: iO });
    await act(O, 'setthi_roll');
    S = await until(O, S2 => S2.phaseActor === A.id, 'ตกแลนด์มาร์กแล้วจบตา');
    assert(S.props[12].owner === A.id, 'แลนด์มาร์กยังเป็นของเดิม');
    assert(S.fx.some(f => f.kind === 'toll' && f.square === 12 && f.amount === 1400 * 6), 'จ่ายค่าผ่านทางแลนด์มาร์ก');
    assert(!S.fx.some(f => f.kind === 'takeover' && f.square === 12), 'ไม่มีการซื้อต่อแลนด์มาร์ก');
    await act(O, 'setthi_takeover', {}, false);
    console.log('4. แลนด์มาร์ก: มีโรงแรม + ตกซ้ำ → สร้างได้ · ตกแล้วจ่าย ×6 · ซื้อต่อไม่ได้ ✓');
    await setup(A, { seats: { [iA]: { pos: 8, cash: 20000 } }, dice: [[1, 3]], turnSeat: iA });
    const aCash = seatOf(last(A), A.id).cash;
    await act(A, 'setthi_roll');
    S = await until(A, S2 => S2.props[12].stars === 1, 'ตกแลนด์มาร์กตัวเองได้ดาว');
    assert(seatOf(S, A.id).cash === aCash + Math.round(1400 * 6 * 0.2 / 10) * 10, 'โบนัส 20% ของค่าผ่านทาง');
    assert(S.tolls[12] === Math.round(8400 * 1.25 / 10) * 10, 'ค่าผ่านทาง +25%');
    await setup(A, { props: { 4: { owner: iA, level: 1 } }, seats: { [iA]: { pos: 28, laps: 2 } }, dice: [[1, 3]], turnSeat: iA });
    await act(A, 'setthi_roll');
    S = await until(A, turnOf(A, 'pick'), 'ตกจุดเริ่มพอดี เลือกอัปฟรี');
    assert(S.decision.purpose === 'startBonus' && S.decision.options.includes(4) && !S.decision.options.includes(12), 'เลือกได้เฉพาะเมืองที่ยังไม่ถึงโรงแรม');
    await act(A, 'setthi_pick', { square: 4 });
    await until(A, S2 => S2.props[4].level === 2, 'อัปฟรี 1 ขั้น');
    console.log('4b. ดาวแลนด์มาร์ก (+โบนัส) · ทอยตกจุดเริ่มพอดี = อัปเมืองฟรี 1 ขั้น ✓');

    // เกาะร้าง: ดับเบิล 3 ครั้ง · จ่ายออก · ครบ 3 ตา · ดับเบิลออก
    await setup(A, { seats: { [iA]: { pos: 0, island: 0, cash: 20000 } }, dice: [[1, 1], [2, 2], [3, 3]], turnSeat: iA });
    for (let k = 0; k < 6 && !seatOf(last(A), A.id).island; k += 1) {
        S = last(A);
        if (S.phaseActor !== A.id) break;
        if (S.phase === 'roll') await act(A, 'setthi_roll');
        else if (S.phase === 'build') await act(A, 'setthi_pass');
        else if (S.phase === 'takeover') await act(A, 'setthi_declineTakeover');
        else if (S.phase === 'pick') await act(A, 'setthi_skipPick');
        await delay(120);
    }
    S = await until(A, S2 => seatOf(S2, A.id).island === 3, 'ติดเกาะ');
    assert(seatOf(S, A.id).pos === 8 && S.fx.some(f => f.kind === 'dice' && f.streak === 3) && S.fx.some(f => f.kind === 'island' && f.reason === 'triple'), 'ดับเบิล 3 ครั้ง = เกาะ');
    await setup(A, { dice: [[1, 2]], turnSeat: iA });
    assert(last(A).availableActions.payIsland, 'มีปุ่มจ่ายออก');
    await act(A, 'setthi_payIsland');
    await until(A, S2 => seatOf(S2, A.id).island === 0 && S2.phase === 'roll', 'จ่ายแล้วออก');
    await act(A, 'setthi_roll');
    await until(A, S2 => seatOf(S2, A.id).pos === 11, 'เดินปกติ');
    await setup(A, { seats: { [iA]: { pos: 8, island: 1 } }, dice: [[1, 2]], turnSeat: iA });
    await act(A, 'setthi_roll');
    S = await until(A, S2 => seatOf(S2, A.id).pos === 11, 'ครบ 3 ตาออก');
    assert(S.fx.some(f => f.kind === 'islandFree' && f.how === 'served'), 'ออกเพราะครบ');
    console.log('5. เกาะร้าง: ดับเบิล 3 ครั้งไปเกาะ · จ่ายค่าเรือ · ครบ 3 ตา ✓');

    // ดับเบิลออกเกาะ → ตกงานวัด → เลือกที่ตัวเอง ×2
    await setup(A, { props: { 12: { owner: iA, level: 3 } }, seats: { [iA]: { pos: 8, island: 3 } }, dice: [[4, 4]], turnSeat: iA, festival: null });
    const base12 = last(A).tolls[12];
    await act(A, 'setthi_roll');
    S = await until(A, turnOf(A, 'pick'), 'เลือกที่จัดงานวัด');
    assert(S.decision.purpose === 'festival' && S.decision.options.includes(12) && !S.decision.options.includes(15), 'เลือกได้เฉพาะที่ตัวเอง');
    await act(A, 'setthi_pick', { square: 15 }, false);
    await act(A, 'setthi_pick', { square: 12 });
    S = await until(A, S2 => S2.festival === 12, 'มีธงงานวัด');
    assert(S.tolls[12] === base12 * 2, 'ค่าผ่านทาง ×2');
    await setup(A, { props: { 4: { owner: iA, level: 1 } }, seats: { [iA]: { pos: 14, island: 0 } }, dice: [[1, 1]], turnSeat: iA });
    await act(A, 'setthi_roll');
    S = await until(A, turnOf(A, 'pick'), 'งานวัดรอบสอง');
    await act(A, 'setthi_pick', { square: 4 });
    S = await until(A, S2 => S2.festival === 4, 'ย้ายงานวัด');
    assert(S.tolls[12] === base12, 'ที่เดิมกลับปกติ');
    console.log('6. ดับเบิลออกเกาะ · งานวัด ×2 · ย้ายที่ได้ ✓');

    // ทัวร์ทั่วไทย: แตะช่องวาร์ป
    await setup(A, { seats: { [iA]: { pos: 24, tourPending: true, cash: 20000 } }, turnSeat: iA });
    S = await until(A, turnOf(A, 'pick'), 'เลือกช่องทัวร์');
    assert(S.decision.purpose === 'tour' && S.decision.options.length === 31, 'ไปได้ทุกช่อง');
    const laps = seatOf(S, A.id).laps;
    await act(A, 'setthi_pick', { square: 24 }, false);
    await act(A, 'setthi_pick', { square: 9 });
    S = await until(A, S2 => seatOf(S2, A.id).pos === 9, 'วาร์ปแล้ว');
    assert(seatOf(S, A.id).laps === laps + 1 && !seatOf(S, A.id).tourPending, 'ผ่านจุดเริ่ม ใช้ตั๋วแล้ว');
    assert(S.fx.some(f => f.kind === 'move' && f.warp), 'ฉากวาร์ป');
    if (S.phase === 'build') await act(A, 'setthi_pass');
    console.log('7. ทัวร์ทั่วไทย: แตะช่อง → จ่ายค่าทัวร์ วาร์ป ผ่านจุดเริ่มได้เงินเดือน ✓');

    // หลุดแล้วต่อใหม่ = state เต็ม
    const snap = last(O);
    O.socket.close();
    const O2 = await reattach(base, O);
    await waitFor(() => last(O2), 6000, 'state หลังต่อใหม่');
    const fresh = last(O2);
    Object.keys(snap.props).forEach(k => assert(fresh.props[k].owner === snap.props[k].owner && fresh.props[k].level === snap.props[k].level, 'กระดานเหมือนเดิม ' + k));
    assert(fresh.board === undefined && fresh.seats.length === 2, 'ได้ state เต็ม');
    console.log('8. หลุดแล้วต่อใหม่ได้กระดานเต็ม ✓');

    // เงินไม่พอ → ขายที่ → จ่ายอัตโนมัติ
    await setup(O2, { props: { 31: { owner: iA, level: 3 }, 20: { owner: iO, level: 3 }, 22: { owner: iO, level: 3 }, 23: { owner: iO, level: 3 } }, seats: { [iO]: { pos: 29, cash: 500 } }, dice: [[1, 1]], turnSeat: iO });
    await act(O2, 'setthi_roll');
    S = await until(O2, turnOf(O2, 'debt'), 'เฟสหนี้');
    assert(S.debt.total === 3200 * 3.5 && S.self.sell[20] === Math.floor(2100 * 4 / 2), 'ยอดหนี้/ราคาขายคืนครึ่ง');
    assert(!last(A).self.sell, 'คนอื่นไม่เห็นปุ่มขาย');
    await act(A, 'setthi_sell', { square: 20 }, false);
    for (const sq of [20, 22, 23]) if (last(O2).phase === 'debt') { await act(O2, 'setthi_sell', { square: sq }); await delay(150); }
    await until(O2, S2 => S2.phase !== 'debt', 'จ่ายครบ');
    console.log('9. เงินไม่พอ: ขายที่คืนครึ่งราคา → จ่ายอัตโนมัติ · คนอื่นขายแทนไม่ได้ ✓');

    // ล้มละลาย → ที่ดินคืนธนาคาร → เหลือคนเดียวชนะ
    await setup(O2, { props: { 31: { owner: iA, level: 4 }, 1: { owner: iO, level: 0 } }, seats: { [iO]: { pos: 29, cash: 100 } }, dice: [[1, 1]], turnSeat: iO });
    await act(O2, 'setthi_roll');
    S = await until(A, S2 => S2.phase === 'finished', 'จบเกม');
    assert(seatOf(S, O.id).bankrupt && S.props[1].owner === null, 'ล้มละลาย ที่ดินคืนธนาคาร');
    assert(S.winners.length === 1 && S.winners[0].playerId === A.id, 'คนที่เหลือชนะ');
    assert(S.standings[0].playerId === A.id, 'อันดับ 1');
    await waitFor(() => { const st = readStats(); return st[A.id] && st[A.id].modeStats && st[A.id].modeStats.setthi && st[A.id].modeStats.setthi.wins === 1; }, 6000, 'สถิติเศรษฐีถูกบันทึก');
    console.log('10. ล้มละลาย: ที่ดินกลับเป็นว่าง · เหลือคนเดียวชนะ · สถิติบันทึก ✓');
    [A, O2].forEach(c => c.socket.close());
}

function readStats() {
    const file = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const list = Array.isArray(raw) ? raw : (raw.players || Object.values(raw));
        const out = {};
        (Array.isArray(list) ? list : []).forEach(x => { if (x && x.playerId) out[x.playerId] = x; });
        if (!Object.keys(out).length && raw && typeof raw === 'object') Object.assign(out, raw);
        return out;
    } catch (e) { return {}; }
}

// ================= G) เมนูทดสอบ /m =================
async function scenarioG(base) {
    const P = await makeClient(base, 'G-host');
    const Q = await makeClient(base, 'G-guest');
    await delay(300);
    const roomId = await createRoom(P, { name: 'วงเศรษฐี G', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, [Q]);
    await start(P, [P, Q], roomId);
    await until(P, S => S.canDebug === true, 'หัวห้องได้ canDebug');
    assert(last(Q).canDebug === false, 'คนอื่นไม่ได้ canDebug');
    let r = await ack(Q.socket, 'setthi_debug_dice', { six: true });
    assert(!r.success && /แอดมินหรือหัวห้อง/.test(r.error), 'คนที่ไม่ใช่หัวห้อง/แอดมินใช้ไม่ได้');
    r = await ack(Q.socket, 'setthi_debug_mint', { amount: 5000 });
    assert(!r.success, 'คนอื่นเสกเงินไม่ได้');
    r = await ack(P.socket, 'setthi_debug_mint', { amount: -100 });
    assert(!r.success, 'เสกติดลบไม่ได้');
    const pCash = seatOf(last(P), P.id).cash;
    r = await ack(P.socket, 'setthi_debug_mint', { amount: 5000 });
    assert(r.success, 'หัวห้องเสกเงินได้: ' + r.error);
    let S = await until(Q, S2 => S2.debugUsed && S2.history.some(h => h.kind === 'debug' && /เสกเงิน/.test(h.text)), 'คนอื่นเห็นโน้ตเสกเงิน + ป้ายโหมดทดสอบ');
    assert(seatOf(S, P.id).cash === pCash + 5000, 'เงินเข้า');
    r = await ack(P.socket, 'setthi_debug_dice', { six: true });
    assert(r.success, 'เปิด 6+6');
    await until(P, S2 => S2.debug && S2.debug.six, 'ตัวเองเห็นสวิตช์');
    assert(!last(Q).debug.six, 'สวิตช์ไม่ใช่ของคนอื่น');
    await drive([P, Q], { act: true, stop: S2 => S2.phase === 'roll' && S2.phaseActor === P.id && !S2.turn.hasRolled });
    await act(P, 'setthi_roll');
    S = await until(Q, S2 => S2.fx.some(f => f.kind === 'dice' && f.playerId === P.id), 'เห็นเต๋า');
    const d = S.fx.filter(f => f.kind === 'dice' && f.playerId === P.id).pop();
    assert(d.d[0] === 6 && d.d[1] === 6, 'ทอยได้ 6+6');
    // โอนหัวห้อง → คนเดิมใช้ไม่ได้ คนใหม่ใช้ได้
    r = await ack(P.socket, 'transferAdmin', { newAdminPlayerId: Q.id });
    assert(r && r.success !== false, 'โอนหัวห้องได้: ' + JSON.stringify(r));
    await until(Q, S2 => S2.canDebug === true, 'หัวห้องใหม่ได้ canDebug');
    r = await ack(P.socket, 'setthi_debug_mint', { amount: 100 });
    assert(!r.success, 'หัวห้องเดิมใช้ /m ไม่ได้แล้ว');
    r = await ack(Q.socket, 'setthi_debug_dice', { doubles: true });
    assert(r.success, 'หัวห้องใหม่ใช้ได้');
    // จบเกม → ไม่บันทึกสถิติ
    r = await ack(Q.socket, 'setthi_end', {});
    assert(r.success, 'หัวห้องจบเกม: ' + r.error);
    S = await until(P, S2 => S2.phase === 'finished', 'จบเกม');
    assert(Object.keys(S.debug || {}).every(k => !S.debug[k]) || (!S.debug.six && !S.debug.doubles), 'สวิตช์รีเซ็ตตอนจบ');
    await delay(1500);
    const st = readStats();
    [P.id, Q.id].forEach(id => assert(!(st[id] && st[id].modeStats && st[id].modeStats.setthi && st[id].modeStats.setthi.games), 'เกมที่ใช้ /m ไม่นับสถิติ'));
    console.log('20. /m: เฉพาะหัวห้อง/แอดมิน · เสกเงิน/6+6 ใช้ได้ · ทุกคนเห็นโน้ต · โอนหัวห้องแล้วคนเดิมใช้ไม่ได้ · ไม่บันทึกสถิติ ✓');
    [P, Q].forEach(c => c.socket.close());
}

// ================= B) ผูกขาดทุกแบบ (4 / 3 / 2 คน มีบอท) + คนออกกลางเกม =================
async function scenarioB(base) {
    // B1: 3 คน + บอท 1 · คนออกกลางเกม · ผูกขาด 3 สี
    const H1 = await makeClient(base, 'B-host');
    const H2 = await makeClient(base, 'B-two');
    const H3 = await makeClient(base, 'B-three');
    await delay(300);
    let roomId = await createRoom(H1, { name: 'วงเศรษฐี B', settings: { setthiMinutes: 0, maxPlayers: 4 } });
    await joinAll(roomId, [H2, H3]);
    assert((await ack(H1.socket, 'setthi_addBots', { roomId, count: 1 })).success, 'เพิ่มบอท');
    let r = await ack(H1.socket, 'setthi_addBots', { roomId, count: 3 });
    assert(r.success && r.added === 0 || !r.success, 'ห้องเต็ม 4 คน');
    await start(H1, [H1, H2, H3], roomId);
    assert(last(H1).seats.length === 4, '4 ที่นั่ง');
    await drive([H1, H2, H3], { act: true, timeoutMs: 60000, stop: (S, st) => st.actions >= 8 && S.phase === 'roll' && S.history.some(h => /^บอท/.test(h.text)) });
    assert(last(H1).history.some(h => /^บอท/.test(h.text)), 'บอทเล่นด้วย');
    const i3 = idx(H3);
    await setup(H1, { props: { 20: { owner: i3, level: 2 }, 22: { owner: i3, level: 1 } } });
    await ack(H3.socket, 'leaveRoom', {});
    let S = await until(H1, S2 => seatOf(S2, H3.id).left, 'คนออก');
    assert(S.props[20].owner === null && S.props[22].owner === null && S.phase !== 'finished', 'ที่ดินคืนธนาคาร เกมเดินต่อ');
    const i1 = idx(H1);
    const own = {};
    [1, 2, 4, 6, 7, 9].forEach(i => { own[i] = { owner: i1, level: 0 }; });
    own[10] = { owner: null, level: 0 };
    await setup(H1, { resetProps: true, resetSeats: true, props: own, seats: { [i1]: { pos: 8, cash: 30000, island: 0 } }, dice: [[1, 1]], turnSeat: i1 });
    await until(H2, S2 => S2.threats.some(t => t.playerId === H1.id && t.type === 'color' && t.squares.includes(10)), 'ทุกคนเห็นเตือน อีก 1 ช่องผูกขาด 3 สี');
    await act(H1, 'setthi_roll');
    await until(H1, turnOf(H1, 'build'), 'ซื้อช่องสุดท้าย');
    await act(H1, 'setthi_build', { level: 0 });
    S = await until(H2, S2 => S2.phase === 'finished', 'ชนะผูกขาด 3 สี');
    assert(S.monopoly && S.monopoly.type === 'color' && S.winners[0].playerId === H1.id, 'ผูกขาด 3 สี ชนะทันที: ' + JSON.stringify({ monopoly: S.monopoly, winners: S.winners, reason: S.finishReason, h1: H1.id }));
    assert(S.fx.some(f => f.kind === 'monopoly' && f.type === 'color'), 'ฉากฉลอง');
    console.log('11. 4 คน (บอท 1): คนออก ที่ดินคืนธนาคาร · เตือนผูกขาด · ผูกขาด 3 สี ชนะทันที ✓');
    [H1, H2].forEach(c => c.socket.close());

    // B2: 2 คน + บอท · ผูกขาดแถว (ต้องรวมท่องเที่ยว)
    const L1 = await makeClient(base, 'L-host');
    const L2 = await makeClient(base, 'L-two');
    await delay(300);
    roomId = await createRoom(L1, { name: 'วงเศรษฐี L', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, [L2]);
    assert((await ack(L1.socket, 'setthi_addBots', { roomId, count: 1 })).success, 'เพิ่มบอท');
    await start(L1, [L1, L2], roomId);
    const l1 = idx(L1);
    await setup(L1, { resetProps: true, resetSeats: true, props: { 9: { owner: l1 }, 10: { owner: l1 }, 12: { owner: l1 }, 14: { owner: l1 }, 15: { owner: l1 }, 11: { owner: null } }, seats: { [l1]: { pos: 8, cash: 30000, island: 0 } }, dice: [[1, 2]], turnSeat: l1 });
    await until(L2, S2 => S2.threats.some(t => t.playerId === L1.id && t.type === 'line' && t.squares[0] === 11), 'เตือนผูกขาดแถว');
    await act(L1, 'setthi_roll');
    await until(L1, turnOf(L1, 'build'), 'ซื้อเขาใหญ่');
    await act(L1, 'setthi_build', { level: 0 });
    S = await until(L2, S2 => S2.phase === 'finished', 'ชนะผูกขาดแถว');
    assert(S.monopoly && S.monopoly.type === 'line' && S.monopoly.side === 1 && S.winners[0].playerId === L1.id, 'ผูกขาดแถว: ' + JSON.stringify({ monopoly: S.monopoly, winners: S.winners }));
    console.log('12. 3 คน (บอท 1): ผูกขาดแถว (รวมแหล่งท่องเที่ยว) ชนะทันที ✓');
    [L1, L2].forEach(c => c.socket.close());

    // B3: 2 คน · ผูกขาดท่องเที่ยว
    const T1 = await makeClient(base, 'T-host');
    const T2 = await makeClient(base, 'T-two');
    await delay(300);
    roomId = await createRoom(T1, { name: 'วงเศรษฐี T', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, [T2]);
    await start(T1, [T1, T2], roomId);
    const t1 = idx(T1);
    await setup(T1, { resetProps: true, resetSeats: true, props: { 5: { owner: t1 }, 11: { owner: t1 }, 21: { owner: t1 } }, seats: { [t1]: { pos: 24, cash: 30000, island: 0, tourPending: false } }, dice: [[1, 2]], turnSeat: t1 });
    await act(T1, 'setthi_roll');
    await until(T1, turnOf(T1, 'build'), 'ซื้อพีพี');
    await act(T1, 'setthi_build', { level: 0 });
    S = await until(T2, S2 => S2.phase === 'finished', 'ชนะผูกขาดท่องเที่ยว');
    assert(S.monopoly && S.monopoly.type === 'tourist' && S.winners[0].playerId === T1.id, 'ผูกขาดท่องเที่ยว: ' + JSON.stringify({ monopoly: S.monopoly, winners: S.winners }));
    console.log('13. 2 คน: ผูกขาดท่องเที่ยว ชนะทันที ✓');
    [T1, T2].forEach(c => c.socket.close());
}

// ================= C) คน 1 + บอท 3 · autopilot · หลุด =================
async function scenarioC(base) {
    const human = await makeClient(base, 'C-human');
    await delay(300);
    const roomId = await createRoom(human, { name: 'วงเศรษฐี C', settings: { setthiMinutes: 0 } });
    assert((await ack(human.socket, 'setthi_addBots', { roomId, count: 3 })).success, 'เพิ่มบอท');
    await start(human, [human], roomId);
    const round0 = last(human).round;
    await waitFor(() => last(human).round >= round0 + 2 || last(human).phase === 'finished', 60000, 'เกมเดินด้วย autopilot');
    assert([...human.seen].some(t => /หมดเวลา/.test(t)) || last(human).phase === 'finished', 'มี autopilot เล่นแทนคน');
    assert([...human.seen].some(t => /^บอท/.test(t)), 'บอทเล่น');
    const stepBefore = last(human).step;
    const offAt = Date.now();
    human.socket.close();
    await delay(6000);
    const back = await reattach(base, human);
    const backAt = Date.now();
    await waitFor(() => last(back) && last(back).step > stepBefore, 5000, 'state หลังหลุด');
    const after = last(back);
    const during = (after.history || []).filter(h => { const t = Date.parse(h.at); return t > offAt && t < backAt; });
    assert(during.length >= 3 || after.phase === 'finished', `เกมเดินต่อระหว่างหลุด (${during.length} เหตุการณ์)`);
    console.log(`14. คน 1 + บอท 3: ไม่กด = autopilot · หลุด 6 วิ เกมเดินต่อ (${during.length} เหตุการณ์) ✓`);
    await ack(back.socket, 'leaveRoom', {});
    await delay(400);
    const probe = await makeClient(base, 'C-probe');
    await delay(200);
    const j = await ack(probe.socket, 'joinRoom', { roomId, playerId: probe.id });
    assert(!j.success, 'ห้องที่เหลือแต่บอทถูกปิด');
    console.log('15. คนสุดท้ายออก → ห้องปิด ✓');
    probe.socket.close();
}

// ================= F) กดค้างทอย =================
async function scenarioF(base) {
    const P = await makeClient(base, 'F-host');
    const Q = await makeClient(base, 'F-guest');
    await delay(300);
    const roomId = await createRoom(P, { name: 'วงเศรษฐี F', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, [Q]);
    await start(P, [P, Q], roomId);
    const A = last(P).phaseActor === P.id ? P : Q;
    const O = A === P ? Q : P;
    let r = await ack(A.socket, 'setthi_rollRelease', { elapsedMs: 500 });
    assert(!r.success && /ยังไม่ได้กดค้าง/.test(r.error), 'ปล่อยโดยไม่ได้กดค้างโดนปฏิเสธ');
    r = await ack(O.socket, 'setthi_rollHoldStart', { seq: last(O).phaseSeq });
    assert(!r.success, 'คนที่ไม่ใช่ตากดค้างไม่ได้');
    const held = await ack(A.socket, 'setthi_rollHoldStart', { seq: last(A).phaseSeq });
    assert(held.success && held.meter.period / 2 >= 1600 && held.meter.period / 2 <= 2000, 'เข็มกวาด 1.6–2.0 วิ: ' + JSON.stringify(held.meter));
    await waitFor(() => last(O).turn && last(O).turn.holding, 3000, 'อีกคนเห็นว่ากำลังชาร์จ');
    assert(!/appearAt|"period"/.test(JSON.stringify(O.states)), 'พารามิเตอร์เข็ม/ช่องเขียวไม่ส่งให้คนอื่น');
    r = await ack(O.socket, 'setthi_rollRelease', { elapsedMs: 500 });
    assert(!r.success, 'คนอื่นปล่อยแทนไม่ได้');
    await delay(400);
    r = await ack(A.socket, 'setthi_rollRelease', { elapsedMs: 999999 });
    assert(r.success, 'ปล่อยได้ (เวลาปลอมถูกหนีบ): ' + r.error);
    await waitFor(() => last(O).fx.some(f => f.kind === 'dice' && f.playerId === A.id), 3000, 'เห็นลูกเต๋า');
    const dice = last(O).fx.filter(f => f.kind === 'dice' && f.playerId === A.id).pop();
    assert(dice.power >= 0 && dice.power < 0.5 && dice.d.every(v => v >= 1 && v <= 6), `เวลาปลอม 999999 ใช้เวลาจริง ~0.4 วิ → แรงน้อย (${dice.power})`);
    console.log(`16. กดค้างทอย: ปล่อยไม่ได้ถ้าไม่ได้กด · คนอื่นกด/ปล่อยแทนไม่ได้ · เวลาปลอมถูกหนีบ (แรง ${dice.power}) · พารามิเตอร์เห็นแค่คนทอย ✓`);
    await drive([P, Q], { act: true, stop: S => S.phase === 'roll' && S.phaseActor === O.id });
    const h2 = await ack(O.socket, 'setthi_rollHoldStart', { seq: last(O).phaseSeq });
    assert(h2.success, 'กดค้างได้');
    await waitFor(() => last(A).turn && last(A).turn.holding, 3000, 'เห็นกำลังชาร์จ');
    O.socket.close();
    await waitFor(() => last(A).turn && !last(A).turn.holding, 4000, 'หลุดแล้วยกเลิกการกดค้าง');
    const O2 = await reattach(base, O);
    await waitFor(() => last(O2) && last(O2).phaseActor === O.id && last(O2).phase === 'roll', 6000, 'ได้ตากลับมา');
    let greens = 0;
    const tries = 80;
    for (let i = 0; i < tries; i += 1) {
        const h = await ack(O2.socket, 'setthi_rollHoldStart', { seq: last(O2).phaseSeq });
        assert(h.success, 'กดค้างซ้ำได้: ' + h.error);
        if (h.meter.green) {
            greens += 1;
            const g = h.meter.green;
            assert(g.appearAt >= 300 && g.appearAt <= 1200 && g.until === undefined && g.width >= 0.09 && g.width <= 0.14, 'ช่องเขียว 0.3–1.2 วิ ค้างจนปล่อย');
        }
        assert((await ack(O2.socket, 'setthi_rollHoldCancel', {})).success, 'ยกเลิกได้');
    }
    assert(greens / tries > 0.3 && greens / tries < 0.7, `ช่องเขียวเกิด ~50% (ได้ ${greens}/${tries})`);
    assert((await ack(O2.socket, 'setthi_rollHoldStart', { seq: last(O2).phaseSeq })).success, 'กดค้างใหม่ได้');
    r = await ack(O2.socket, 'setthi_rollRelease', { elapsedMs: 60 });
    assert(r.success, 'แตะปล่อยได้: ' + r.error);
    await waitFor(() => last(A).fx.some(f => f.kind === 'dice' && f.playerId === O.id), 3000, 'เห็นลูกเต๋าแตะ');
    const tapFx = last(A).fx.filter(f => f.kind === 'dice' && f.playerId === O.id).pop();
    assert(tapFx.power === undefined, 'แตะ (<150ms) = ทอยปกติไม่มีแรง');
    console.log(`17. หลุดระหว่างกดค้าง = ยกเลิก · แตะ = ทอยปกติ · ช่องเขียวเกิด ${greens}/${tries} ครั้ง ค้างจนปล่อย ✓`);
    [A, O2].forEach(c => c.socket.close());
}

// ================= E) รีสตาร์ต =================
async function scenarioE(server, port) {
    const base = `http://127.0.0.1:${port}`;
    const P = await makeClient(base, 'E-host');
    const Q = await makeClient(base, 'E-guest');
    await delay(300);
    const roomId = await createRoom(P, { name: 'วงเศรษฐี E', settings: { setthiMinutes: 30 } });
    await joinAll(roomId, [Q]);
    await start(P, [P, Q], roomId);
    await drive([P, Q], { act: true, stop: (S, st) => st.actions >= 8 && S.phase === 'roll' });
    const snap = last(P);
    await delay(900);
    await stopServer(server, 'SIGKILL');
    P.socket.close();
    Q.socket.close();
    const server2 = await bootServer(port);
    const P2 = await reattach(base, P);
    const Q2 = await reattach(base, Q);
    await waitFor(() => last(P2) && last(Q2), 8000, 'state หลังรีสตาร์ต');
    const s = last(P2);
    assert(s.status === 'playing', 'เกมยังเล่นอยู่หลังรีสตาร์ต');
    Object.keys(snap.props).forEach(k => assert(s.props[k].owner === snap.props[k].owner && s.props[k].level === snap.props[k].level, 'กระดานเหมือนเดิม ' + k));
    snap.seats.forEach(x => assert(seatOf(s, x.playerId).cash === x.cash, 'เงินเหมือนเดิม'));
    assert(s.clock && s.clock.endsAt === snap.clock.endsAt, 'นาฬิกาเกมเหมือนเดิม');
    const seq0 = s.phaseSeq;
    await waitFor(() => last(P2).phaseSeq > seq0, 12000, 'timer ทำงานหลังรีสตาร์ต');
    await drive([P2, Q2], { act: true, stop: (S, st) => st.actions >= 6 });
    console.log('18. รีสตาร์ตเซิร์ฟเวอร์กลางเกม: กู้ state · timer/autopilot กลับมา · เล่นต่อได้ ✓');
    [P2, Q2].forEach(c => c.socket.close());
    return server2;
}

// ================= D) จำกัดเวลา =================
async function scenarioD(port) {
    const dir = path.join(process.env.GAME_DATA_DIR, 'clock');
    fs.mkdirSync(dir, { recursive: true });
    const server = await bootServer(port, { SETTHI_MINUTE_MS: '200' }, dir);
    const base = `http://127.0.0.1:${port}`;
    try {
        const P = await makeClient(base, 'D-host');
        const Q = await makeClient(base, 'D-guest');
        await delay(300);
        const roomId = await createRoom(P, { name: 'วงเศรษฐี D', settings: { setthiMinutes: 20 } });
        await joinAll(roomId, [Q]);
        assert((await ack(P.socket, 'setthi_addBots', { roomId, count: 1 })).success, 'เพิ่มบอท');
        await start(P, [P, Q], roomId);
        assert(last(P).clock.minutes === 20 && last(P).clock.endsAt, 'นาฬิกา 20 นาที');
        await drive([P, Q], { act: true, timeoutMs: 60000 });
        const fin = last(P);
        assert(fin.phase === 'finished', 'จบเกม');
        if (!fin.monopoly && /หมดเวลา/.test(fin.finishReason)) {
            const alive = fin.standings.filter(x => !x.bankrupt && !x.left);
            for (let i = 1; i < alive.length; i += 1) assert(alive[i - 1].netWorth >= alive[i].netWorth, 'เรียงตามทรัพย์สินรวม');
            assert(fin.winners.every(w => w.netWorth === alive[0].netWorth), 'ผู้ชนะ = ทรัพย์สินสูงสุด');
            assert(fin.fx.some(f => f.kind === 'timeUp') || fin.clock.timeUp, 'เห็นรอบสุดท้าย');
        }
        console.log(`19. จำกัดเวลา: ${fin.finishReason} → ${fin.winners.map(w => w.name).join(', ')} ชนะ ✓`);
        [P, Q].forEach(c => c.socket.close());
    } finally {
        await stopServer(server);
    }
}

async function main() {
    const started = Date.now();
    let server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    try {
        const only = String(process.env.SETTHI_PLAY_ONLY || '').split(',').filter(Boolean);
        const run = k => !only.length || only.includes(k);
        if (run('A')) await scenarioA(base);
        if (run('B')) await scenarioB(base);
        if (run('C')) await scenarioC(base);
        if (run('F')) await scenarioF(base);
        if (run('G')) await scenarioG(base);
        if (run('E')) server = await scenarioE(server, PORT);
        if (run('D')) await scenarioD(PORT + 1);
        const logs = server.logs();
        assert(!/\[setthi\] (tick|bots|recover) failed/.test(logs), 'ไม่มี error ฝั่งเซิร์ฟเวอร์: ' + (logs.match(/\[setthi\][^\n]*/) || [''])[0]);
        console.log(`✅ setthi play: ${checks} checks · ตรวจ payload ${leakChecks} ชิ้น · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } finally {
        await stopServer(server);
    }
}

main().then(() => process.exit(0)).catch(error => {
    console.error('❌ setthi play:', error.stack || error.message);
    process.exit(1);
});
