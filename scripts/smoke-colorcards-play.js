/**
 * เล่นไพ่ทิ้งสีผ่าน socket จริงจนจบเกม
 *  A) 2 คน (ขั้นต่ำ): คำสั่งผิดโดนปฏิเสธ · ลืมกดเหลือใบเดียวแล้วโดนจับ · รีเฟรชกลางเกมได้ state เต็ม · สถิติ
 *  B) 10 คน (สูงสุด): คนออกกลางเกม ไพ่กลับใต้กอง ตาเดินต่อ · ล่า 300 แต้มหลายรอบ
 *  C) คน 1 + บอท 3: บอทเล่นถูกกติกา จบเกมเอง · คนสุดท้ายออก = ปิดห้อง
 * ทุก payload ที่ทุก socket ได้รับถูกตรวจว่าไม่มี id ไพ่ที่ผู้รับไม่มีสิทธิ์เห็น
 *
 * รัน: npm run smoke:colorcards:play   (SMOKE_PORT=8841 เพื่อกำหนดพอร์ต)
 */
const path = require('path');
const fs = require('fs');

// ข้อมูลเทสอยู่ในโฟลเดอร์ชั่วคราวของเราเอง ไม่แตะ data/ จริง
if (!process.env.GAME_DATA_DIR) {
    const dir = path.join(__dirname, '..', '..', '..', 'tmpdata-colorcards', `play-${process.pid}-${Date.now()}`);
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

const PORT = Number(process.env.SMOKE_PORT) || 8841;
const CARD_RE = /"(k\d{3})"/g;

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            COLORCARDS_TURN_MS: '6000',
            COLORCARDS_BOT_MS: '90',
            COLORCARDS_ROUND_END_MS: '1500',
            COLORCARDS_CATCH_MS: '3000'
        },
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
function allowedIds(state) {
    const ok = new Set();
    if (state.self) (state.self.hand || []).forEach(c => ok.add(c.id));
    (state.pile || []).forEach(c => c && ok.add(c.id));
    if (state.top) ok.add(state.top.id);
    (state.fx || []).forEach(e => { if (e.card) ok.add(e.card.id); if (e.top) ok.add(e.top.id); });
    if (state.roundResult) state.roundResult.hands.forEach(h => h.cards.forEach(c => ok.add(c.id)));
    return ok;
}
function inspectPayload(client, event, payload) {
    const json = JSON.stringify(payload === undefined ? null : payload);
    const ids = [...json.matchAll(CARD_RE)].map(m => m[1]);
    leakChecks += 1;
    if (event === 'colorcardsState') {
        assert(payload.self ? payload.self.playerId === client.id : true, `${client.name} ได้ state ของคนอื่น`);
        (payload.seats || []).forEach(seat => assert(seat.hand === undefined && seat.cards === undefined, 'seat ต้องมีแค่จำนวนไพ่'));
        const ok = allowedIds(payload);
        ids.forEach(id => assert(ok.has(id), `รั่ว: ${client.name} เห็นไพ่ ${id} ที่ไม่ใช่ของตัวเอง/ไม่ได้เปิด`));
        if (payload.phase === 'turn') {
            const total = payload.drawCount + payload.discardCount + payload.seats.reduce((s, x) => s + x.count, 0);
            assert(total === 108, `ไพ่รวมต้อง 108 (${total})`);
        }
    } else {
        assert(ids.length === 0, `รั่ว: event ${event} ที่ ${client.name} ได้รับมี id ไพ่ ${ids.join(',')}`);
    }
}

async function makeClient(base, name, id = randomUUID()) {
    const socket = await conn(base);
    const client = { socket, id, name, states: [], events: 0 };
    socket.onAny((event, payload) => {
        client.events += 1;
        inspectPayload(client, event, payload);
        if (event === 'colorcardsState') client.states.push(payload);
    });
    socket.emit('initPlayer', id);
    return client;
}
const last = c => c.states[c.states.length - 1];

/** ทุกคนที่ยังต่ออยู่เห็นไพ่ของตัวเองไม่ทับใคร (ตรวจข้าม client ณ step เดียวกัน) */
function crossCheck(clients) {
    const live = clients.filter(c => c.socket.connected && last(c) && last(c).phase === 'turn');
    if (live.length < 2) return;
    const step = last(live[0]).step;
    if (!live.every(c => last(c).step === step)) return;
    live.forEach(a => {
        const json = JSON.stringify(last(a));
        live.forEach(b => {
            if (a === b) return;
            (last(b).self.hand || []).forEach(card => {
                assert(!json.includes(`"${card.id}"`), `รั่วข้ามคน: ${a.name} เห็น ${card.id} ของ ${b.name}`);
            });
        });
    });
}

async function createRoom(host, opts) {
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: opts.name || 'ไพ่ทิ้งสี', gameMode: 'colorcards', maxPlayers: opts.maxPlayers || 10, ...opts.settings });
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    host.socket.emit('setRoom', { roomId: created.roomId, playerId: host.id });
    return created.roomId;
}
async function joinAll(roomId, clients) {
    for (const c of clients) {
        const r = await ack(c.socket, 'joinRoom', { roomId, playerId: c.id });
        assert(r?.success, `${c.name} join ไม่ได้: ${JSON.stringify(r)}`);
        c.socket.emit('setRoom', { roomId, playerId: c.id });
    }
    await delay(300);
}
async function start(host, clients, roomId) {
    const r = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(r?.success, 'เริ่มเกมไม่ได้: ' + JSON.stringify(r));
    await waitFor(() => clients.every(c => last(c) && last(c).phase === 'turn'), 15000, 'turn phase');
}

function bestColor(hand, exclude) {
    const counts = { r: 0, y: 0, g: 0, b: 0 };
    hand.forEach(c => { if (c.color && c.id !== exclude) counts[c.color] += 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

/**
 * ขับเกมจนกว่า stop() จะจริงหรือเกมจบ · คืนสถิติการเล่น
 * hooks.forgetCall(client) = true → ลงใบรองสุดท้ายโดยไม่กดบอก
 */
async function drive(clients, admin, opts = {}) {
    const stats = { actions: 0, plays: 0, draws: 0, passes: 0, rounds: new Set(), catches: 0, stale: 0 };
    const deadline = Date.now() + (opts.timeoutMs || 240000);
    while (Date.now() < deadline) {
        const live = clients.filter(c => c.socket.connected && last(c));
        if (!live.length) throw new Error('ไม่มี client');
        const newest = live.reduce((a, c) => (last(c).step > last(a).step ? c : a), live[0]);
        const S = last(newest);
        if (S.phase === 'finished') return stats;
        if (opts.stop && opts.stop(S, stats)) return stats;
        crossCheck(clients);

        if (S.phase === 'roundEnd') {
            stats.rounds.add(S.round);
            if (admin.socket.connected && opts.adminNext && last(admin).availableActions.canNextRound) {
                await ack(admin.socket, 'colorcards_nextRound', {});
            }
            await waitFor(() => last(newest).phase !== 'roundEnd', 8000, 'next round');
            continue;
        }

        // คนอื่นจับได้
        const catcher = live.find(c => last(c).availableActions.canCatch && last(c).step === S.step);
        if (catcher && opts.catchIt !== false) {
            const r = await ack(catcher.socket, 'colorcards_catch', { targetId: last(catcher).availableActions.canCatch });
            if (r.success) stats.catches += 1;
            await delay(60);
            continue;
        }

        const actor = live.find(c => S.turn && S.turn.playerId === c.id);
        if (!actor) { await delay(50); continue; } // ตาบอทหรือคนที่หลุด
        const view = last(actor);
        if (view.turnSeq !== S.turnSeq || view.phase !== 'turn') { await delay(30); continue; }
        const self = view.self;
        const a = view.availableActions;
        let event; let payload;
        const playable = self.playable || [];
        // 2 คน: ข้าม/กลับทิศ = ได้เล่นต่อทันที จับไม่ทัน จึงลืมบอกเฉพาะไพ่เลข · 3 คนขึ้นไปลืมได้ทุกใบ
        const mayForget = card => self.hand.length === 2 && (view.seats.filter(x => !x.left).length > 2 || card.kind === 'num')
            && opts.forgetCall && opts.forgetCall(actor, view);
        if (a.canPass) {
            if (playable.includes(self.drawnCardId)) {
                const card = self.hand.find(c => c.id === self.drawnCardId);
                const forget = mayForget(card);
                event = 'colorcards_play';
                payload = { cardId: card.id, color: card.color ? undefined : bestColor(self.hand, card.id), callLast: self.hand.length === 2 && !forget };
            } else { event = 'colorcards_pass'; payload = {}; }
        } else if (a.canPlay && playable.length) {
            const pickId = playable.find(id => { const c = self.hand.find(x => x.id === id); return c && c.color; }) || playable[0];
            const card = self.hand.find(c => c.id === pickId);
            const forget = mayForget(card);
            event = 'colorcards_play';
            payload = { cardId: card.id, color: card.color ? undefined : bestColor(self.hand, card.id), callLast: self.hand.length === 2 && !forget };
        } else {
            event = 'colorcards_draw'; payload = {};
        }
        const before = view.step;
        const r = await ack(actor.socket, event, { ...payload, turnSeq: view.turnSeq });
        if (!r.success) {
            // แข่งกับนาฬิกาหมดเวลา/คนออก — ยอมรับได้เฉพาะ error เรื่องจังหวะ
            assert(/จังหวะ|ยังไม่ถึง|ยังไม่ถึงจังหวะ/.test(r.error || ''), `${actor.name} ${event} ล้มเหลว: ${r.error}`);
            stats.stale += 1;
        } else {
            stats.actions += 1;
            if (event === 'colorcards_play') stats.plays += 1;
            else if (event === 'colorcards_draw') stats.draws += 1;
            else stats.passes += 1;
        }
        await waitFor(() => !actor.socket.connected || (last(actor) && last(actor).step !== before), 5000, 'state after action');
        if (opts.after) await opts.after(last(actor), stats);
    }
    throw new Error('เกมไม่จบภายในเวลา');
}

function readStats() {
    const file = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
    if (!fs.existsSync(file)) return [];
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : Object.values(raw);
}

(async () => {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const everyone = [];
    try {
        // ================= A) 2 คน =================
        const A = [await makeClient(base, 'A0'), await makeClient(base, 'A1')];
        everyone.push(...A);
        await delay(300);
        const [aHost, aGuest] = A;
        let roomA = await createRoom(aHost, { settings: { colorcardsTurnSeconds: 30, colorcardsStacking: false } });
        await joinAll(roomA, [aGuest]);
        const denied = await ack(aGuest.socket, 'colorcards_addBots', { roomId: roomA, count: 1 });
        assert(denied.success === false, 'คนที่ไม่ใช่หัวห้องเพิ่มบอทไม่ได้');
        const early = await ack(aHost.socket, 'colorcards_draw', {});
        assert(early.success === false, 'ก่อนเริ่มเกมสั่งไม่ได้');
        await start(aHost, A, roomA);
        let s = last(aHost);
        const firstD2 = s.top.kind === 'd2' && s.discardCount === 1;
        assert(s.seats.length === 2 && s.seats.filter(x => x.count === 7).length >= (firstD2 ? 1 : 2) && s.seats.every(x => x.count === 7 || (firstD2 && x.count === 9)), 'แจกคนละ 7 (ใบแรก +2 = คนแรก 9)');
        assert(s.config.turnSeconds === 30 && s.config.target === 0 && s.config.stacking === false, 'ตั้งค่าห้องไปถึงเกม');
        const html = await (await fetch(`${base}/game/${roomA}?playerId=${aGuest.id}`)).text();
        assert(/cc-hand|colorcardsState|ccRoot/.test(html), 'หน้า /game แสดงกระดานไพ่ทิ้งสี');
        const embedded = [...html.matchAll(/"(k\d{3})"/g)].map(m => m[1]);
        const guestHand = new Set(last(aGuest).self.hand.map(c => c.id));
        const pub = allowedIds(last(aGuest));
        embedded.forEach(id => assert(pub.has(id) || guestHand.has(id), `หน้า /game ฝัง id ไพ่ ${id} ที่ไม่ควรเห็น`));
        assert(!last(aHost).self.hand.some(c => html.includes(`"${c.id}"`)), 'หน้า /game ของ A1 ไม่มีไพ่ของ A0');
        console.log('1. ห้อง 2 คน เริ่มเกม แจก 7 ใบ หน้า /game ไม่ฝังไพ่คนอื่น ✓');

        // คำสั่งผิด
        s = last(aHost);
        const turnC = A.find(c => c.id === s.turn.playerId);
        const otherC = A.find(c => c !== turnC);
        let r = await ack(otherC.socket, 'colorcards_play', { cardId: last(otherC).self.hand[0].id, color: 'r', turnSeq: s.turnSeq });
        assert(!r.success && /ยังไม่ถึงตา/.test(r.error), 'ลงนอกตาโดนปฏิเสธ');
        r = await ack(otherC.socket, 'colorcards_draw', { turnSeq: s.turnSeq });
        assert(!r.success, 'จั่วนอกตาโดนปฏิเสธ');
        r = await ack(turnC.socket, 'colorcards_play', { cardId: last(otherC).self.hand[0].id, color: 'r', turnSeq: s.turnSeq });
        assert(!r.success && /ไม่มีไพ่/.test(r.error), 'ลงไพ่ของคนอื่นโดนปฏิเสธ');
        r = await ack(turnC.socket, 'colorcards_play', { cardId: 'k999', turnSeq: s.turnSeq });
        assert(!r.success, 'ลงไพ่มั่วโดนปฏิเสธ');
        const bad = last(turnC).self.hand.find(c => !last(turnC).self.playable.includes(c.id));
        if (bad) {
            r = await ack(turnC.socket, 'colorcards_play', { cardId: bad.id, color: 'g', turnSeq: s.turnSeq });
            assert(!r.success && /ไม่ได้/.test(r.error), 'ลงไพ่ไม่ตรงสี/เลขโดนปฏิเสธ');
        }
        r = await ack(turnC.socket, 'colorcards_pass', { turnSeq: s.turnSeq });
        assert(!r.success && /จั่วก่อน/.test(r.error), 'ผ่านโดยไม่จั่วโดนปฏิเสธ');
        r = await ack(turnC.socket, 'colorcards_draw', { turnSeq: s.turnSeq - 1 });
        assert(!r.success && /จังหวะ/.test(r.error), 'turnSeq เก่าโดนปฏิเสธ');
        r = await ack(otherC.socket, 'colorcards_catch', { targetId: turnC.id });
        assert(!r.success, 'จับมั่วโดนปฏิเสธ');
        r = await ack(otherC.socket, 'colorcards_nextRound', {});
        assert(!r.success, 'คนอื่นกดรอบต่อไปไม่ได้');
        r = await ack(aGuest.socket, 'colorcards_end', {});
        assert(!r.success, 'คนอื่นจบเกมไม่ได้');
        r = await ack(turnC.socket, 'colorcards_call', {});
        assert(!r.success, 'มี 7 ใบกดเหลือใบเดียวไม่ได้');
        const wild = last(turnC).self.hand.find(c => !c.color);
        if (wild) {
            r = await ack(turnC.socket, 'colorcards_play', { cardId: wild.id, turnSeq: s.turnSeq });
            assert(!r.success && /เลือกสี/.test(r.error), 'ไวลด์ไม่เลือกสีโดนปฏิเสธ');
        }
        assert(last(aHost).step === s.step, 'คำสั่งผิดไม่เปลี่ยน state');
        console.log('2. ปฏิเสธ: นอกตา/ไพ่คนอื่น/ไพ่มั่ว/ไม่ตรง/ผ่านก่อนจั่ว/turnSeq เก่า/จับมั่ว/สิทธิ์หัวห้อง ✓');

        // เล่น ~ จนถึงตาที่ 6 แล้วรีเฟรช aGuest (ปิด socket แล้วต่อใหม่ด้วย id เดิม)
        await drive(A, aHost, { stop: (S, st) => st.actions >= 6 });
        const handBefore = last(aGuest).self.hand.map(c => c.id).sort().join();
        aGuest.socket.close();
        await delay(400);
        const aGuest2 = await makeClient(base, 'A1-reconnect', aGuest.id);
        everyone.push(aGuest2);
        aGuest2.socket.emit('setRoom', { roomId: roomA, playerId: aGuest.id });
        aGuest2.socket.emit('colorcards_requestState', { roomId: roomA, playerId: aGuest.id });
        await waitFor(() => last(aGuest2), 5000, 'resync');
        const re = last(aGuest2);
        assert(re.self && re.self.playerId === aGuest.id && re.phase === 'turn', 'ต่อใหม่ได้ state เต็ม');
        const handAfter = re.self.hand.map(c => c.id).sort().join();
        assert(handAfter === handBefore, 'ต่อใหม่ได้ไพ่ในมือเดิม');
        assert(re.top && re.seats.length === 2 && typeof re.drawCount === 'number', 'resync มีกอง/ที่นั่ง');
        console.log('3. รีเฟรชกลางเกม → resync เต็ม (ไพ่ในมือเดิม) ✓');

        // เล่นต่อจนจบ · ลืมกดเหลือใบเดียว 1 ครั้งแล้วให้อีกคนจับ
        const A2 = [aHost, aGuest2];
        let forgot = 0;
        const statsA = await drive(A2, aHost, {
            forgetCall: () => { if (forgot === 0) { forgot += 1; return true; } return false; }
        });
        const finA = last(aHost);
        assert(finA.phase === 'finished' && finA.winner && finA.standings.length === 2, 'เกม 2 คนจบ มีผู้ชนะ');
        assert(finA.standings[0].playerId === finA.winner.playerId && finA.standings[0].cardsLeft === 0, 'ผู้ชนะหมดมือ อยู่บนสุด');
        if (forgot) assert(statsA.catches >= 1, 'ลืมกดแล้วโดนจับได้');
        console.log(`4. เกม 2 คนจบ (${statsA.plays} ลง · ${statsA.draws} จั่ว · จับได้ ${statsA.catches}) ✓`);

        await delay(1200);
        let rows = readStats();
        const wRow = rows.find(x => x.playerId === finA.winner.playerId);
        const lRow = rows.find(x => x.playerId === A.find(c => c.id !== finA.winner.playerId).id);
        assert(wRow && wRow.modeStats.colorcards.wins === 1 && wRow.modeStats.colorcards.games === 1, 'ผู้ชนะได้ 1 ชนะ');
        assert(lRow && lRow.modeStats.colorcards.losses === 1 && lRow.modeStats.colorcards.wins === 0, 'อีกคนได้ 1 แพ้');
        // กลับห้องรอ แล้วเริ่มใหม่ได้ สถิติไม่ซ้ำ
        const back = new Promise(res => aHost.socket.once('redirectToLobby', () => res(true)));
        r = await ack(aHost.socket, 'returnFinishedToLobby', { roomId: roomA });
        assert(r.success, 'กลับห้องรอได้');
        assert(await Promise.race([back, delay(4000).then(() => false)]), 'ทุกคนถูกพากลับห้องรอ');
        await delay(400);
        aHost.states.length = 0; aGuest2.states.length = 0;
        await start(aHost, A2, roomA);
        await delay(600);
        rows = readStats();
        assert(rows.find(x => x.playerId === finA.winner.playerId).modeStats.colorcards.games === 1, 'สถิติไม่บันทึกซ้ำ');
        // หัวห้องออกกลางเกม → อีกคนชนะ เกมไม่ค้าง
        r = await ack(aHost.socket, 'leaveRoom', {});
        await waitFor(() => last(aGuest2).phase === 'finished', 8000, 'admin left → finished');
        assert(last(aGuest2).winner.playerId === aGuest.id, 'หัวห้องออก เหลือคนเดียว = ชนะ');
        console.log('5. สถิติ ชนะ/แพ้ ถูก · กลับห้องรอ → เล่นใหม่ · หัวห้องออกกลางเกม เกมจบไม่ค้าง ✓');
        aGuest2.socket.close();
        aHost.socket.close();

        // ================= B) 10 คน =================
        const B = [];
        for (let i = 0; i < 10; i += 1) B.push(await makeClient(base, 'B' + i));
        everyone.push(...B);
        await delay(400);
        const roomB = await createRoom(B[0], { settings: { colorcardsTarget: 300, colorcardsStacking: true, colorcardsTurnSeconds: 15 } });
        await joinAll(roomB, B.slice(1));
        await start(B[0], B, roomB);
        s = last(B[0]);
        const dealt = s.seats.reduce((sum, x) => sum + x.count, 0);
        const firstPenalty = s.top.kind === 'd2' && s.discardCount === 1 ? 2 : 0; // ใบแรก +2 = คนแรกจั่ว 2
        assert(s.seats.length === 10 && dealt === 70 + firstPenalty && s.drawCount + s.discardCount + dealt === 108, `10 คน แจก 70 ใบ เปิด 1 (มือรวม ${dealt} · กอง ${s.drawCount})`);
        assert(s.config.target === 300 && s.config.stacking === true, 'ตั้งค่า 300 แต้ม + ซ้อน');
        let leaver = null;
        let leaverCards = 0;
        let forgotB = 0;
        const statsB = await drive(B, B[0], {
            adminNext: true,
            forgetCall: () => { if (forgotB < 2) { forgotB += 1; return true; } return false; },
            timeoutMs: 400000,
            after: async (S, st) => {
                if (!leaver && st.actions === 12) {
                    const view = last(B[0]);
                    leaver = B.find(c => c !== B[0] && view.turn && c.id !== view.turn.playerId);
                    leaverCards = view.seats.find(x => x.playerId === leaver.id).count;
                    const drawBefore = view.drawCount;
                    const turnBefore = view.turn.playerId;
                    const res = await ack(leaver.socket, 'leaveRoom', {});
                    assert(res && res.success !== false, 'ออกจากห้องได้');
                    leaver.socket.close();
                    await waitFor(() => last(B[0]).seats.find(x => x.playerId === leaver.id).left, 5000, 'leaver marked');
                    const after = last(B[0]);
                    assert(after.seats.find(x => x.playerId === leaver.id).count === 0, 'คนออกไม่มีไพ่เหลือ');
                    assert(after.drawCount === drawBefore + leaverCards || after.turn.playerId !== turnBefore, 'ไพ่คนออกกลับเข้ากองจั่ว');
                    assert(after.turn.playerId !== leaver.id, 'ตาไม่ค้างที่คนออก');
                }
            }
        });
        const finB = last(B[0]);
        assert(finB.phase === 'finished' && finB.winner && finB.winner.score >= 300, `10 คน ล่า 300 แต้มจบ (ผู้ชนะ ${finB.winner && finB.winner.score})`);
        assert(forgotB > 0 && statsB.catches >= 1, `ลืมกดเหลือใบเดียวแล้วโดนจับ (ลืม ${forgotB} · จับ ${statsB.catches})`);
        assert(finB.standings.find(x => x.playerId === leaver.id).left, 'ตารางสรุปมีคนออกด้วย');
        console.log(`6. 10 คน · ซ้อน +2/+4 · ล่า 300 แต้ม ${statsB.rounds.size + 1} รอบ · ลืมบอกแล้วโดนจับ ${statsB.catches} · คนออกกลางเกม ไพ่ ${leaverCards} ใบกลับใต้กอง ✓`);
        await delay(1000);
        rows = readStats();
        const winRows = B.filter(c => c !== leaver).map(c => rows.find(x => x.playerId === c.id));
        assert(winRows.every(Boolean), 'บันทึกสถิติทุกคนที่เล่นจบ');
        assert(winRows.filter(x => x.modeStats.colorcards.wins === 1).length === 1, 'มีผู้ชนะคนเดียว');
        B.forEach(c => c.socket.connected && c.socket.close());

        // ================= C) คน 1 + บอท 3 =================
        const human = await makeClient(base, 'C0');
        everyone.push(human);
        await delay(300);
        const roomC = await createRoom(human, { maxPlayers: 4, settings: { colorcardsTurnSeconds: 20 } });
        r = await ack(human.socket, 'colorcards_addBots', { roomId: roomC, count: 5 });
        assert(r.success && r.added === 3, 'เพิ่มบอทได้ถึงเต็มห้อง: ' + JSON.stringify(r));
        r = await ack(human.socket, 'colorcards_addBots', { roomId: roomC, count: 1 });
        assert(!r.success, 'ห้องเต็มเพิ่มบอทไม่ได้');
        await start(human, [human], roomC);
        const statsC = await drive([human], human, { timeoutMs: 120000 });
        const finC = last(human);
        assert(finC.phase === 'finished' && finC.winner, 'เกมกับบอทจบ');
        const botTurns = finC.history.filter(h => /บอท/.test(h.text)).length;
        assert(botTurns > 0, 'บอทได้เล่นจริง');
        assert(!finC.history.some(h => /บอท/.test(h.text) && /หมดเวลา/.test(h.text)), 'บอทไม่ปล่อยให้หมดเวลา');
        console.log(`7. คน 1 + บอท 3 จบเกม (คนลง ${statsC.plays} · บอทมีบันทึก ${botTurns} รายการ · ผู้ชนะ ${finC.winner.name}) ✓`);
        await delay(800);
        rows = readStats();
        assert(!rows.some(x => String(x.playerId).startsWith('bot_')), 'ไม่บันทึกสถิติบอท');
        // เล่นใหม่แล้วคนเดียวออก → ห้องบอทล้วนถูกปิด
        await ack(human.socket, 'returnFinishedToLobby', { roomId: roomC });
        await delay(500);
        human.states.length = 0;
        await start(human, [human], roomC);
        await ack(human.socket, 'leaveRoom', {});
        await delay(500);
        const list = await new Promise(res => human.socket.emit('getRoomList', x => res(x)));
        assert(!(list.rooms || []).some(x => x.roomId === roomC), 'คนสุดท้ายออก ห้องบอทล้วนถูกปิด');
        console.log('8. ไม่บันทึกสถิติบอท · คนสุดท้ายออก ปิดห้องบอทล้วน ✓');

        assert(!/\[colorcards\].*failed/.test(server.logs()), 'server log มี error ของไพ่ทิ้งสี:\n' + server.logs().split('\n').filter(l => /colorcards/.test(l)).slice(-5).join('\n'));
        assert(leakChecks > 500, 'ตรวจ payload มากพอ');
        console.log(`9. ตรวจความลับ ${leakChecks} payload (ทุก event ทุก socket) — ไม่มีไพ่รั่ว ✓`);
        console.log(`\n✅ smoke-colorcards-play: ${checks} checks passed`);
    } finally {
        everyone.forEach(c => { try { c.socket.close(); } catch (e) { /* ignore */ } });
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
