/**
 * เศรษฐี — เล่นผ่าน socket จริง (เซิร์ฟเวอร์จริง + socket.io-client)
 *  A) 2 คน: คำสั่งผิด/ข้อมูลขยะโดนปฏิเสธ · ประมูล · ดับเบิล 3 ครั้ง = คุก · จ่ายค่าปรับออก · จำนอง/ไถ่ถอน
 *     เทรด → โต้กลับ → รับ · ข้อเสนอหมดอายุ · หลุดแล้วต่อใหม่ได้ state เต็ม · หัวห้องจบเกม · สถิติบันทึก
 *  B) 6 คน (คน 4 + บอท 2): ดีลเห็นเฉพาะคู่ดีล · คนออกกลางเกม (ทรัพย์สินคืนธนาคาร) · หัวห้องออก เกมไม่ค้าง
 *  C) คน 1 + บอท 3: คนไม่กด = autopilot · คนหลุด = ตาสั้นลง เกมไม่ค้าง · คนสุดท้ายออก = ปิดห้อง
 *  D) จำกัดเวลา (นาฬิกาเร่ง): หมดเวลา → เล่นครบรอบ → จัดอันดับตามทรัพย์สินรวม
 *  F) กดค้างทอย: ปล่อยโดยไม่กด/ตาคนอื่น = ปฏิเสธ · เวลาปลอมถูกหนีบ · พารามิเตอร์เข็มเห็นแค่คนทอย · หลุด = ยกเลิก · แตะ = ปกติ
 *  E) เซิร์ฟเวอร์รีสตาร์ตกลางเกม: กู้ state ได้ เล่นต่อได้ timer กลับมาทำงาน
 * ทุก payload ที่ client ได้รับถูกตรวจว่าไม่มีลำดับกองการ์ด/แผนบอท/ดีลของคนอื่น
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
    SETTHI_TURN_MS: '4000',
    SETTHI_DEBT_MS: '3000',
    SETTHI_BOT_MS: '60',
    SETTHI_AUCTION_START_MS: '1500',
    SETTHI_AUCTION_MS: '1000',
    SETTHI_TRADE_MS: '4000',
    SETTHI_TRADE_GRACE_MS: '3000',
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
const DECK_RE = /"[cf]\d\d"/g;
function inspectPayload(client, event, payload) {
    const json = JSON.stringify(payload === undefined ? null : payload);
    leakChecks += 1;
    assert(!/"decks"|botMemo|testDice|"ledger"|lastLoggedHistoryAt/.test(json), `รั่ว: ${client.name} ได้ field ภายใน (${event})`);
    if (event === 'setthiState') {
        assert(!payload.self || payload.self.playerId === client.id, `${client.name} ได้ state ของคนอื่น`);
        (payload.trades || []).forEach(t => assert(t.from === client.id || t.to === client.id, `รั่ว: ${client.name} เห็นดีลของคนอื่น`));
        // id การ์ดโผล่ได้แค่ใน fx การ์ดที่เปิดแล้ว
        const allowed = new Set((payload.fx || []).filter(f => f.kind === 'card').map(f => f.card.id));
        [...json.matchAll(DECK_RE)].map(m => m[0].slice(1, -1)).forEach(id => assert(allowed.has(id), `รั่ว: ${client.name} เห็นการ์ด ${id} ที่ยังไม่เปิด`));
        assert(payload.seats.every(s => s.cash >= 0), 'เงินติดลบ');
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

/** ขับเกมด้วยนโยบายง่าย ๆ จนกว่า stop() จะจริงหรือเกมจบ */
async function drive(clients, opts = {}) {
    const stats = { actions: 0, rolls: 0, buys: 0, auctions: 0, bids: 0, builds: 0, trades: 0, ends: 0 };
    const deadline = Date.now() + (opts.timeoutMs || 90000);
    while (Date.now() < deadline) {
        const top = newest(clients);
        if (!top) throw new Error('ไม่มี client');
        const S = last(top);
        if (S.phase === 'finished') return stats;
        if (opts.stop && opts.stop(S, stats)) return stats;

        // ตอบดีลที่ส่งถึงคน
        for (const c of clients) {
            const v = last(c);
            const offer = v && (v.trades || []).find(t => t.to === c.id);
            if (offer && v.phase !== 'auction' && c.socket.connected) {
                const r = await ack(c.socket, 'setthi_tradeRespond', { tradeId: offer.id, accept: Math.random() < 0.5 });
                if (r.success) stats.trades += 1;
            }
        }
        if (S.phase === 'auction' && S.auction) {
            const bidder = clients.find(c => {
                const v = last(c);
                return c.socket.connected && v && v.availableActions.bid && v.availableActions.bid.can && v.availableActions.bid.min <= 140 && Math.random() < 0.5;
            });
            if (bidder) {
                const r = await ack(bidder.socket, 'setthi_bid', { amount: last(bidder).availableActions.bid.min });
                if (r.success) stats.bids += 1;
            }
            await delay(120);
            continue;
        }
        const actor = clients.find(c => c.socket.connected && S.phaseActor === c.id);
        if (!actor || !opts.act) { await delay(60); continue; }
        const view = last(actor);
        if (view.phaseSeq !== S.phaseSeq) { await delay(30); continue; }
        const a = view.availableActions;
        let ev = null;
        let payload = { seq: view.phaseSeq };
        const manage = view.self && view.self.manage;
        if (view.phase === 'debt' && manage) {
            const sq = Object.keys(manage).find(k => manage[k].sell) || Object.keys(manage).find(k => manage[k].mortgage);
            if (sq !== undefined) { ev = manage[sq].sell ? 'setthi_sell' : 'setthi_mortgage'; payload = { square: Number(sq) }; }
        } else if (a.roll) { ev = 'setthi_roll'; stats.rolls += 1; }
        else if (a.decline) {
            const cash = seatOf(view, actor.id).cash;
            ev = a.buy && cash > 350 && Math.random() < 0.75 ? 'setthi_buy' : 'setthi_decline';
            if (ev === 'setthi_buy') stats.buys += 1; else stats.auctions += 1;
        } else if (a.endTurn) {
            const build = manage && Object.keys(manage).find(k => manage[k].build && seatOf(view, actor.id).cash > 500);
            if (build !== undefined) { ev = 'setthi_build'; payload = { square: Number(build) }; stats.builds += 1; }
            else { ev = 'setthi_endTurn'; stats.ends += 1; }
        }
        if (!ev) { await delay(50); continue; }
        await ack(actor.socket, ev, payload);
        stats.actions += 1;
        await delay(25);
    }
    throw new Error('drive timeout ' + JSON.stringify(stats) + ' phase=' + last(newest(clients)).phase);
}

function readStats() {
    const file = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? Object.fromEntries(raw.map(s => [s.playerId, s])) : raw;
}

// ================= A) 2 คน =================
async function scenarioA(base) {
    const X0 = await makeClient(base, 'A-host');
    const Y0 = await makeClient(base, 'A-guest');
    await delay(300);
    const roomId = await createRoom(X0, { name: 'วงเศรษฐี A', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, [Y0]);
    // จำนวนคนขั้นต่ำ: คนเดียวเริ่มไม่ได้ (ตรวจหลังออกห้องก็ได้ แต่ทำง่ายกว่าคือ engine) — ไปเริ่มเลย
    await start(X0, [X0, Y0], roomId);
    const S0 = last(X0);
    const X = S0.phaseActor === X0.id ? X0 : Y0;
    const Y = X === X0 ? Y0 : X0;
    console.log('   เริ่ม: ' + X.name + ' ทอยก่อน');

    // คำสั่งผิด
    let r = await ack(Y.socket, 'setthi_roll', { seq: last(Y).phaseSeq });
    assert(!r.success && /ถึงตา/.test(r.error), 'คนที่ไม่ใช่ตาทอยไม่ได้: ' + r.error);
    r = await ack(X.socket, 'setthi_roll', { seq: last(X).phaseSeq - 1 });
    assert(!r.success && /สถานะเปลี่ยน/.test(r.error), 'seq เก่าโดนปฏิเสธ');
    r = await ack(X.socket, 'setthi_buy', { seq: last(X).phaseSeq });
    assert(!r.success, 'ยังไม่ถึงเฟสซื้อ');
    r = await ack(X.socket, 'setthi_bid', { amount: 50 });
    assert(!r.success && /ไม่มีการประมูล/.test(r.error), 'ไม่มีประมูล');
    r = await ack(X.socket, 'setthi_build', { square: 1 });
    assert(!r.success, 'สร้างบ้านโดยไม่มีที่ดินไม่ได้');
    r = await ack(X.socket, 'setthi_build', { square: 'abc' });
    assert(!r.success && /ไม่มีที่ดิน/.test(r.error), 'ช่องขยะโดนปฏิเสธ');
    r = await ack(X.socket, 'setthi_mortgage', { square: 99 });
    assert(!r.success, 'ช่องเกินกระดานโดนปฏิเสธ');
    r = await ack(X.socket, 'setthi_tradePropose', { to: X.id, give: { cash: 10 } });
    assert(!r.success, 'เทรดกับตัวเองไม่ได้');
    r = await ack(X.socket, 'setthi_tradePropose', { to: Y.id, give: { cash: 1e9 } });
    assert(!r.success && /ไม่พอ/.test(r.error), 'เสนอเงินเกินตัวไม่ได้');
    r = await ack(X.socket, 'setthi_tradePropose', { to: Y.id, give: { props: Array.from({ length: 500 }, (_, i) => i) } });
    assert(!r.success, 'ที่ดินขยะในดีลโดนปฏิเสธ');
    r = await ack(Y0.socket, 'setthi_end', {});
    assert(!r.success && /หัวห้อง/.test(r.error), 'คนที่ไม่ใช่หัวห้องจบเกมไม่ได้');
    console.log('1. คำสั่งผิด/ข้อมูลขยะโดนปฏิเสธ ✓');

    // ทอย 6+6 → ลำปาง → ไม่ซื้อ → ประมูล
    r = await ack(X.socket, 'setthi_roll', { seq: last(X).phaseSeq });
    assert(r.success, 'ทอยได้: ' + r.error);
    await waitFor(() => last(X).phase === 'buy', 5000, 'เฟสซื้อ');
    assert(seatOf(last(X), X.id).pos === 12 && last(X).pendingBuy === 12, 'ตกลำปาง');
    r = await ack(X.socket, 'setthi_decline', { seq: last(X).phaseSeq });
    assert(r.success, 'ส่งประมูลได้');
    await waitFor(() => last(Y).phase === 'auction', 5000, 'เปิดประมูล');
    assert(last(Y).availableActions.bid && last(Y).availableActions.bid.can, 'อีกคนประมูลได้');
    r = await ack(Y.socket, 'setthi_bid', { amount: 5 });
    assert(!r.success, 'ต่ำกว่าขั้นต่ำ');
    assert((await ack(Y.socket, 'setthi_bid', { amount: 10 })).success, 'Y เสนอ 10');
    r = await ack(Y.socket, 'setthi_bid', { amount: 30 });
    assert(!r.success && /สูงสุดอยู่แล้ว/.test(r.error), 'คนนำเสนอซ้ำไม่ได้');
    assert((await ack(X.socket, 'setthi_bid', { amount: 20 })).success, 'คนที่ไม่ซื้อก็ประมูลได้');
    assert((await ack(Y.socket, 'setthi_bid', { amount: 90 })).success, 'Y เสนอ 90');
    await waitFor(() => last(X).phase !== 'auction', 6000, 'ประมูลจบ');
    assert(last(X).props[12].owner === Y.id, 'Y ชนะประมูล');
    assert(seatOf(last(X), Y.id).cash === 1410, 'Y จ่าย 90');
    assert(last(X).phase === 'roll' && last(X).phaseActor === X.id, 'ดับเบิลได้ทอยอีก');
    console.log('2. ไม่ซื้อ → ประมูล 3 ราคา → คนเสนอสูงสุดได้ · ดับเบิลทอยต่อ ✓');

    // ทอย 6+6 → กระบี่ ซื้อ · ทอย 6+6 ครั้งที่ 3 → คุก
    assert((await ack(X.socket, 'setthi_roll', { seq: last(X).phaseSeq })).success, 'ทอยครั้งที่ 2');
    await waitFor(() => last(X).phase === 'buy', 5000, 'ซื้อกระบี่');
    assert(last(X).pendingBuy === 24, 'ตกกระบี่');
    assert((await ack(X.socket, 'setthi_buy', { seq: last(X).phaseSeq })).success, 'ซื้อกระบี่');
    assert(last(X).props[24].owner === X.id && seatOf(last(X), X.id).cash === 1260, 'เป็นเจ้าของกระบี่');
    assert((await ack(X.socket, 'setthi_roll', { seq: last(X).phaseSeq })).success, 'ทอยครั้งที่ 3');
    await waitFor(() => seatOf(last(X), X.id).inJail, 5000, 'เข้าคุก');
    assert(seatOf(last(X), X.id).pos === 10 && last(X).phase === 'manage', 'ดับเบิล 3 ครั้ง = คุก ตาจบ');
    // จำนอง/ไถ่ถอนตอนถึงตา
    assert((await ack(X.socket, 'setthi_mortgage', { square: 24 })).success, 'จำนองได้');
    assert(seatOf(last(X), X.id).cash === 1380 && last(X).props[24].mortgaged, 'ได้ครึ่งราคา');
    assert((await ack(X.socket, 'setthi_unmortgage', { square: 24 })).success, 'ไถ่ถอนได้');
    assert(seatOf(last(X), X.id).cash === 1380 - 132 && !last(X).props[24].mortgaged, 'ไถ่ถอน +10%');
    r = await ack(Y.socket, 'setthi_mortgage', { square: 12 });
    assert(!r.success && /ตาของคุณ/.test(r.error), 'ไม่ใช่ตาจำนองไม่ได้');
    assert((await ack(X.socket, 'setthi_endTurn', { seq: last(X).phaseSeq })).success, 'จบเทิร์น');
    console.log('3. ดับเบิล 3 ครั้งเข้าคุก · จำนองครึ่งราคา/ไถ่ถอน +10% ✓');

    // Y ทอย 3+4 → ขอนแก่น ซื้อ
    await waitFor(() => last(Y).phaseActor === Y.id && last(Y).phase === 'roll', 5000, 'ตา Y');
    assert((await ack(Y.socket, 'setthi_roll', { seq: last(Y).phaseSeq })).success, 'Y ทอย');
    await waitFor(() => last(Y).phase === 'buy', 5000, 'Y ซื้อขอนแก่น');
    assert((await ack(Y.socket, 'setthi_buy', { seq: last(Y).phaseSeq })).success, 'Y ซื้อ');
    assert((await ack(Y.socket, 'setthi_endTurn', { seq: last(Y).phaseSeq })).success, 'Y จบเทิร์น');
    // X ติดคุก: จ่ายค่าปรับออก
    await waitFor(() => last(X).phaseActor === X.id && last(X).phase === 'roll', 5000, 'ตา X ในคุก');
    assert(last(X).availableActions.payJail, 'มีปุ่มจ่ายค่าปรับ');
    assert((await ack(X.socket, 'setthi_payJail', { seq: last(X).phaseSeq })).success, 'จ่ายค่าปรับ');
    assert(!seatOf(last(X), X.id).inJail, 'ออกคุก');
    r = await ack(X.socket, 'setthi_useJailCard', { seq: last(X).phaseSeq });
    assert(!r.success, 'ไม่ติดคุกแล้วใช้บัตรไม่ได้');
    console.log('4. ติดคุก → จ่ายค่าปรับออก ✓');

    // เทรด → โต้กลับ → รับ
    r = await ack(X.socket, 'setthi_tradePropose', { to: Y.id, give: { cash: 100 }, get: { props: [7] } });
    assert(r.success, 'ส่งข้อเสนอได้: ' + r.error);
    await waitFor(() => (last(Y).trades || []).some(t => t.to === Y.id), 3000, 'Y เห็นข้อเสนอ');
    r = await ack(X.socket, 'setthi_tradePropose', { to: Y.id, give: { cash: 1 } });
    assert(!r.success && /ค้างอยู่/.test(r.error), 'ข้อเสนอค้างได้ทีละอัน');
    const offer = last(Y).trades.find(t => t.to === Y.id);
    r = await ack(Y.socket, 'setthi_tradeCounter', { tradeId: offer.id, to: X.id, give: { props: [7] }, get: { cash: 180 } });
    assert(r.success, 'โต้กลับได้: ' + r.error);
    await waitFor(() => (last(X).trades || []).some(t => t.to === X.id && t.counterOf === offer.id), 3000, 'X เห็นข้อเสนอโต้กลับ');
    const counter = last(X).trades.find(t => t.to === X.id);
    const cashX = seatOf(last(X), X.id).cash;
    assert((await ack(X.socket, 'setthi_tradeRespond', { tradeId: counter.id, accept: true })).success, 'รับข้อเสนอโต้กลับ');
    await waitFor(() => last(Y).props[7].owner === X.id, 3000, 'ขอนแก่นย้ายเจ้าของ');
    assert(seatOf(last(Y), X.id).cash === cashX - 180, 'X จ่าย 180');
    assert(last(Y).fx.some(f => f.kind === 'trade'), 'มี fx จับมือ');
    console.log('5. เทรด → โต้กลับ → รับ ✓');
    // ข้อเสนอหมดอายุ
    assert((await ack(Y.socket, 'setthi_tradePropose', { to: X.id, give: { cash: 10 } })).success, 'Y ส่งข้อเสนอ');
    await waitFor(() => !(last(X).trades || []).length, 8000, 'ข้อเสนอหมดอายุ');
    console.log('6. ข้อเสนอหมดอายุเอง ✓');

    // หลุดแล้วต่อใหม่
    Y.socket.close();
    await waitFor(() => { const s = seatOf(last(X), Y.id); return s && s.online === false; }, 9000, 'X เห็น Y หลุด');
    const Y2 = await reattach(base, Y);
    await waitFor(() => last(Y2) && last(Y2).status === 'playing', 5000, 'Y ได้ state หลังต่อใหม่');
    const full = last(Y2);
    assert(full.self && full.self.playerId === Y.id && full.props[12].owner === Y.id && full.seats.length === 2, 'state เต็มหลังรีเฟรช');
    console.log('7. หลุดแล้วต่อใหม่ได้ state เต็ม ✓');

    // หัวห้องจบเกม
    const hostClient = [X, Y2].find(c => c.id === X0.id);
    r = await ack(hostClient.socket, 'setthi_end', {});
    assert(r.success, 'หัวห้องจบเกมได้: ' + r.error);
    await waitFor(() => last(X).phase === 'finished' && last(Y2).phase === 'finished', 5000, 'จบเกม');
    const fin = last(X);
    assert(fin.winners.length >= 1 && fin.standings.length === 2, 'มีผู้ชนะ/อันดับ');
    assert(fin.standings[0].netWorth >= fin.standings[1].netWorth, 'เรียงตามทรัพย์สิน');
    await waitFor(() => { const st = readStats(); return st[X.id] && st[X.id].modeStats && st[X.id].modeStats.setthi && st[X.id].modeStats.setthi.games === 1; }, 6000, 'สถิติเศรษฐีถูกบันทึก');
    const st = readStats();
    const wins = [X.id, Y.id].filter(id => st[id].modeStats.setthi.wins === 1).length;
    assert(wins === fin.winners.length, 'นับชนะตามผู้ชนะ');
    console.log(`8. หัวห้องจบเกม → ${fin.winners.map(w => w.name).join(', ')} ชนะ · สถิติบันทึก ✓`);
    [X, Y2].forEach(c => c.socket.close());
}

// ================= B) 6 คน =================
async function scenarioB(base) {
    const H = [];
    for (let i = 0; i < 4; i += 1) H.push(await makeClient(base, 'B' + i));
    await delay(300);
    const roomId = await createRoom(H[0], { name: 'วงเศรษฐี B', settings: { setthiMinutes: 0 } });
    await joinAll(roomId, H.slice(1));
    let r = await ack(H[1].socket, 'setthi_addBots', { roomId, count: 2 });
    assert(!r.success, 'คนที่ไม่ใช่หัวห้องเพิ่มบอทไม่ได้');
    r = await ack(H[0].socket, 'setthi_addBots', { roomId, count: 5 });
    assert(r.success && r.added === 2, 'เติมบอทได้แค่ถึง 6 ที่นั่ง: ' + JSON.stringify(r));
    await start(H[0], H, roomId);
    assert(last(H[0]).seats.length === 6, '6 ที่นั่ง');
    r = await ack(H[0].socket, 'setthi_addBots', { roomId, count: 1 });
    assert(!r.success, 'เกมเริ่มแล้วเพิ่มบอทไม่ได้');

    await drive(H, { act: true, stop: (S, st) => st.actions > 40 });
    // ดีลส่วนตัว
    const S = last(H[1]);
    const propOf = id => Object.keys(S.props).find(k => S.props[k].owner === id);
    const giveCash = Math.min(50, seatOf(S, H[1].id).cash);
    r = await ack(H[1].socket, 'setthi_tradePropose', { to: H[2].id, give: { cash: giveCash }, get: { props: propOf(H[2].id) ? [Number(propOf(H[2].id))] : [] } });
    if (r.success) {
        await waitFor(() => (last(H[2]).trades || []).length > 0, 3000, 'H2 เห็นดีล');
        await delay(200);
        assert(!(last(H[3]).trades || []).length, 'H3 ไม่เห็นรายละเอียดดีลของคนอื่น');
        assert(seatOf(last(H[3]), H[1].id).hasOffer, 'แต่รู้ว่ามีดีลค้าง');
        await ack(H[2].socket, 'setthi_tradeRespond', { tradeId: last(H[2]).trades[0].id, accept: false });
    }
    // คนออกกลางเกม
    const leaver = H[3];
    const before = last(H[0]);
    const owned = Object.keys(before.props).filter(k => before.props[k].owner === leaver.id);
    r = await ack(leaver.socket, 'leaveRoom', {});
    await waitFor(() => { const s = seatOf(last(H[0]), leaver.id); return s && s.left; }, 5000, 'เห็นคนออก');
    owned.forEach(k => assert(last(H[0]).props[k].owner === null, 'ที่ดินคนออกคืนธนาคาร'));
    assert(seatOf(last(H[0]), leaver.id).cash === 0, 'เงินคนออกคืนธนาคาร');
    const live = H.slice(0, 3);
    await drive(live, { act: true, stop: (S2, st) => st.actions > 25 });
    // หัวห้องออก
    r = await ack(H[0].socket, 'leaveRoom', {});
    const rest = H.slice(1, 3);
    await waitFor(() => rest.some(c => last(c).isHost), 5000, 'มีหัวห้องใหม่');
    await drive(rest, { act: true, stop: (S2, st) => st.actions > 15 });
    const newHost = rest.find(c => last(c).isHost);
    r = await ack(newHost.socket, 'setthi_end', {});
    assert(r.success, 'หัวห้องใหม่จบเกมได้: ' + r.error);
    await waitFor(() => rest.every(c => last(c).phase === 'finished'), 5000, 'จบเกม B');
    const fin = last(rest[0]);
    assert(fin.standings.length === 6, 'อันดับครบ 6 ที่นั่ง');
    assert(fin.standings.filter(x => x.left).length === 2, 'คนออก 2 คนอยู่ท้ายตาราง');
    assert(fin.standings.slice(-2).every(x => x.left || x.bankrupt), 'คนออกอยู่ท้าย');
    console.log(`9. 6 คน (คน 4 + บอท 2): ดีลเห็นแค่คู่ดีล · คนออกทรัพย์สินคืนธนาคาร · หัวห้องออกแล้วเกมเดินต่อ · ${fin.winners.map(w => w.name).join(', ')} ชนะ ✓`);
    rest.forEach(c => c.socket.close());
}

// ================= C) คน 1 + บอท 3 · autopilot · หลุด =================
async function scenarioC(base) {
    const human = await makeClient(base, 'C-human');
    await delay(300);
    const roomId = await createRoom(human, { name: 'วงเศรษฐี C', settings: { setthiMinutes: 0 } });
    assert((await ack(human.socket, 'setthi_addBots', { roomId, count: 3 })).success, 'เพิ่มบอท');
    await start(human, [human], roomId);
    // คนไม่กดอะไรเลย → autopilot เล่นแทน · บอทเล่นเอง
    const round0 = last(human).round;
    const myTurns = () => last(human).fx.filter(f => f.kind === 'turn' && f.playerId === human.id).length;
    await waitFor(() => last(human).round >= round0 + 2 || last(human).phase === 'finished', 60000, 'เกมเดินด้วย autopilot');
    assert([...human.seen].some(t => /C-human|guest/.test(t) && /หมดเวลา/.test(t)), 'มี autopilot เล่นแทนคน');
    assert([...human.seen].some(t => /^บอท/.test(t)), 'บอทเล่น');
    void myTurns;
    // หลุด → ตาสั้นลง เกมไม่ค้าง
    const stepBefore = last(human).step;
    const roundBefore = last(human).round;
    const offAt = Date.now();
    human.socket.close();
    await delay(7000);
    const back = await reattach(base, human);
    const backAt = Date.now();
    await waitFor(() => last(back) && last(back).step > stepBefore, 5000, 'state หลังหลุด');
    const after = last(back);
    const during = (after.history || []).filter(h => { const t = Date.parse(h.at); return t > offAt && t < backAt; });
    assert(during.length >= 3 || after.phase === 'finished', `เกมเดินต่อระหว่างหลุด (${during.length} เหตุการณ์)`);
    assert([...back.seen].some(t => /หมดเวลา/.test(t)), 'ตาของคนหลุดถูกเล่นแทน');
    console.log(`10. คน 1 + บอท 3: ไม่กด = autopilot · หลุด 7 วิ เกมเดินต่อ (${during.length} เหตุการณ์ · รอบ ${roundBefore} → ${after.round}) ✓`);
    // คนสุดท้ายออก → ห้องปิด
    await ack(back.socket, 'leaveRoom', {});
    await delay(400);
    const probe = await makeClient(base, 'C-probe');
    await delay(200);
    const j = await ack(probe.socket, 'joinRoom', { roomId, playerId: probe.id });
    assert(!j.success, 'ห้องที่เหลือแต่บอทถูกปิด');
    console.log('11. คนสุดท้ายออก → ห้องปิด ✓');
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
    assert(!r.success && /ถึงตา/.test(r.error), 'คนที่ไม่ใช่ตากดค้างไม่ได้');
    const held = await ack(A.socket, 'setthi_rollHoldStart', { seq: last(A).phaseSeq });
    const t0 = Date.now();
    assert(held.success && held.meter && held.meter.period >= 1000 && (held.meter.green === null || held.meter.green.width > 0), 'ได้พารามิเตอร์เข็มผ่าน ack: ' + JSON.stringify(held));
    await waitFor(() => last(O).turn && last(O).turn.holding, 3000, 'อีกคนเห็นว่ากำลังชาร์จ');
    assert(!/appearAt|"period"/.test(JSON.stringify(O.states)), 'พารามิเตอร์เข็ม/ช่องเขียวไม่ส่งให้คนอื่น');
    r = await ack(O.socket, 'setthi_rollRelease', { elapsedMs: 500 });
    assert(!r.success && /ถึงตา/.test(r.error), 'คนอื่นปล่อยแทนไม่ได้');
    await delay(520);
    r = await ack(A.socket, 'setthi_rollRelease', { elapsedMs: 999999 });
    const realElapsed = Date.now() - t0;
    assert(r.success, 'ปล่อยได้: ' + r.error);
    await waitFor(() => last(O).fx.some(f => f.kind === 'dice' && f.playerId === A.id), 3000, 'เห็นลูกเต๋า');
    const dice = last(O).fx.filter(f => f.kind === 'dice' && f.playerId === A.id).pop();
    assert(dice.elapsed >= 450 && dice.elapsed <= realElapsed + 60, `เวลาปลอม 999999 ถูกหนีบเป็นเวลาเซิร์ฟเวอร์ (${dice.elapsed}ms จริง ~${realElapsed}ms)`);
    assert(dice.power >= 0 && dice.power <= 1 && dice.d.every(v => v >= 1 && v <= 6), 'แรง 0..1 เต๋า 1..6');
    console.log(`12. กดค้างทอย: ปล่อยไม่ได้ถ้าไม่ได้กด · ตาคนอื่นกด/ปล่อยไม่ได้ · เวลาปลอมถูกหนีบ (${dice.elapsed}ms) · พารามิเตอร์เข็มเห็นแค่คนทอย ✓`);
    // หลุดระหว่างกดค้าง = ยกเลิก · แตะ = ทอยปกติ
    await drive([P, Q], { act: true, stop: S => S.phase === 'roll' && S.phaseActor === O.id });
    const h2 = await ack(O.socket, 'setthi_rollHoldStart', { seq: last(O).phaseSeq });
    assert(h2.success, 'กดค้างได้');
    await waitFor(() => last(A).turn && last(A).turn.holding, 3000, 'เห็นกำลังชาร์จ');
    O.socket.close();
    await waitFor(() => last(A).turn && !last(A).turn.holding, 4000, 'หลุดแล้วยกเลิกการกดค้าง');
    const O2 = await reattach(base, O);
    await waitFor(() => last(O2) && last(O2).phaseActor === O.id && last(O2).phase === 'roll', 6000, 'ได้ตากลับมา');
    // อัตราเกิดช่องเขียวจากเซิร์ฟเวอร์จริง (กดค้าง-ยกเลิกหลายครั้ง) · ตั้งไว้ ~50%
    let greens = 0;
    const tries = 80;
    for (let i = 0; i < tries; i += 1) {
        const h = await ack(O2.socket, 'setthi_rollHoldStart', { seq: last(O2).phaseSeq });
        assert(h.success, 'กดค้างซ้ำได้: ' + h.error);
        if (h.meter.green) {
            greens += 1;
            const g = h.meter.green;
            assert(g.appearAt >= 300 && g.appearAt <= 1200 && g.until > g.appearAt && g.width >= 0.09 && g.width <= 0.14, 'ช่องเขียวอยู่ในช่วงที่ตั้งไว้');
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
    console.log(`13. หลุดระหว่างกดค้าง = ยกเลิก · แตะ = ทอยปกติ · ช่องเขียวเกิด ${greens}/${tries} ครั้ง ✓`);
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
    await drive([P, Q], { act: true, stop: (S, st) => st.actions >= 6 && S.phase === 'roll' });
    const snap = last(P);
    await delay(900); // ให้ roomManager เซฟ (debounce 250ms)
    await stopServer(server, 'SIGKILL');
    P.socket.close();
    Q.socket.close();
    const server2 = await bootServer(port);
    const P2 = await reattach(base, P);
    const Q2 = await reattach(base, Q);
    await waitFor(() => last(P2) && last(Q2), 8000, 'state หลังรีสตาร์ต');
    const s = last(P2);
    assert(s.status === 'playing', 'เกมยังเล่นอยู่หลังรีสตาร์ต');
    Object.keys(snap.props).forEach(k => assert(s.props[k].owner === snap.props[k].owner, 'เจ้าของที่ดินเหมือนเดิม ' + k));
    snap.seats.forEach(x => assert(seatOf(s, x.playerId).cash === x.cash, 'เงินเหมือนเดิม'));
    assert(s.clock && s.clock.endsAt === snap.clock.endsAt, 'นาฬิกาเกมเหมือนเดิม');
    // timer กลับมา: ไม่มีใครกด → autopilot เดินต่อ
    const seq0 = s.phaseSeq;
    await waitFor(() => last(P2).phaseSeq > seq0, 12000, 'timer ทำงานหลังรีสตาร์ต');
    await drive([P2, Q2], { act: true, stop: (S, st) => st.actions >= 6 });
    console.log('14. รีสตาร์ตเซิร์ฟเวอร์กลางเกม: กู้ state · timer/autopilot กลับมา · เล่นต่อได้ ✓');
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
        let sawFinal = false;
        await drive([P, Q], { act: true, timeoutMs: 60000, stop: S => { if (S.clock && S.clock.timeUp) sawFinal = true; return false; } });
        const fin = last(P);
        assert(fin.phase === 'finished' && /หมดเวลา/.test(fin.finishReason), 'จบเพราะหมดเวลา: ' + fin.finishReason);
        assert(sawFinal || fin.clock.timeUp, 'เห็นรอบสุดท้าย');
        const alive = fin.standings.filter(x => !x.bankrupt && !x.left);
        for (let i = 1; i < alive.length; i += 1) assert(alive[i - 1].netWorth >= alive[i].netWorth, 'เรียงตามทรัพย์สินรวม');
        const top = alive[0].netWorth;
        assert(fin.winners.every(w => w.netWorth === top) && fin.winners.length === alive.filter(x => x.netWorth === top).length, 'ผู้ชนะ = ทรัพย์สินสูงสุด (เสมอชนะร่วม)');
        assert(fin.fx.some(f => f.kind === 'finished'), 'มี fx จบเกม');
        console.log(`15. จำกัดเวลา: หมดเวลา → เล่นครบรอบ → ${fin.winners.map(w => w.name).join(', ')} ชนะ (${top}) ✓`);
        [P, Q].forEach(c => c.socket.close());
    } finally {
        await stopServer(server);
    }
}

async function main() {
    const started = Date.now();
    let server = await bootServer(PORT, { SETTHI_DICE: '66,66,66,34' });
    const base = `http://127.0.0.1:${PORT}`;
    try {
        await scenarioA(base);
        await scenarioB(base);
        await scenarioC(base);
        await scenarioF(base);
        server = await scenarioE(server, PORT);
        await scenarioD(PORT + 1);
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
