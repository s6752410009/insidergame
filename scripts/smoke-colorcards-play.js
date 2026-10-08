/**
 * เล่นไพ่ทิ้งสีผ่าน socket จริงจนจบเกม
 *  A) 2 คน (ขั้นต่ำ): คำสั่งผิดโดนปฏิเสธ · ลืมกดเหลือใบเดียวแล้วโดนจับ · รีเฟรชกลางเกมได้ state เต็ม · สถิติ
 *  B) 10 คน (สูงสุด): คนออกกลางเกม ไพ่กลับใต้กอง ตาเดินต่อ · ล่า 300 แต้มหลายรอบ
 *  C) คน 1 + บอท 3: บอทเล่นถูกกติกา จบเกมเอง · คนสุดท้ายออก = ปิดห้อง
 *  D) ลงหลายใบ: กลุ่มเลข/สัญลักษณ์เดียวกันผ่าน socket · กลุ่มผิดโดนปฏิเสธ · คนอื่นเห็น · ห้องปิดกติกานี้ (ตั้งในห้องรอ)
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
            COLORCARDS_ROUND_END_MS: '5000', // ยาวพอให้ทุกคนกดพร้อมก่อนนาฬิกา (เครื่องช้า) — ทุกฉากใช้ "พร้อม" จึงไม่ต้องรอจริง
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
    (state.fx || []).forEach(e => { if (e.card) ok.add(e.card.id); if (e.top) ok.add(e.top.id); (e.cards || []).forEach(c => ok.add(c.id)); });
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

const isWildCard = c => c.kind === 'wild' || c.kind === 'd4';
const sameValue = (a, b) => !!a && !!b && !isWildCard(a) && !isWildCard(b) && a.kind === b.kind && (a.kind !== 'num' || a.value === b.value);
/** กลุ่มที่ใหญ่ที่สุดที่ลงได้ตอนนี้ (ใบแรกลงได้เอง ที่เหลือค่าเดียวกัน) หรือ null */
function bestGroup(view) {
    const self = view.self;
    if (!self || !view.config.multi || view.turn.drawn) return null;
    let best = null;
    (self.playable || []).forEach(id => {
        const lead = self.hand.find(c => c.id === id);
        if (!lead || isWildCard(lead)) return;
        const mates = self.hand.filter(c => c.id !== id && sameValue(c, lead));
        if (mates.length && (!best || mates.length + 1 > best.length)) best = [lead, ...mates];
    });
    return best;
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
    const stats = { actions: 0, plays: 0, multiPlays: 0, draws: 0, passes: 0, rounds: new Set(), catches: 0, stale: 0, readyStarts: 0 };
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
            if (opts.readyAll) {
                // ทุกคนกด "พร้อมรอบต่อไป" → รอบใหม่ต้องเริ่มทันทีไม่รอนาฬิกา
                const voters = live.filter(c => last(c).availableActions.canReady);
                let lastRes = null;
                let lastVoter = null;
                for (const c of voters) { lastRes = await ack(c.socket, 'colorcards_ready', {}); lastVoter = c; }
                // state ถูกส่งก่อน ack บน socket เดียวกัน → ดู state ล่าสุดของคนกดคนสุดท้าย
                if (lastVoter && lastRes && lastRes.success && last(lastVoter).phase === 'turn' && last(lastVoter).round === S.round + 1) stats.readyStarts += 1;
            }
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
        const mayForget = (card, n = 1) => self.hand.length - n === 1 && (view.seats.filter(x => !x.left).length > 2 || card.kind === 'num')
            && opts.forgetCall && opts.forgetCall(actor, view);
        const group = opts.multi === false ? null : bestGroup(view);
        if (a.canPass) {
            if (playable.includes(self.drawnCardId)) {
                const card = self.hand.find(c => c.id === self.drawnCardId);
                const forget = mayForget(card);
                event = 'colorcards_play';
                payload = { cardId: card.id, color: card.color ? undefined : bestColor(self.hand, card.id), callLast: self.hand.length === 2 && !forget };
            } else { event = 'colorcards_pass'; payload = {}; }
        } else if (a.canPlay && group) {
            const forget = mayForget(group[0], group.length);
            event = 'colorcards_play';
            payload = { cardId: group[0].id, cardIds: group.map(c => c.id), callLast: self.hand.length - group.length === 1 && !forget };
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
            if (payload.cardIds) stats.multiPlays += 1;
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
            readyAll: true,
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

        // ================= B2) 3 คน ล่า 500: จบรอบแล้วทุกคนกดพร้อม → รอบใหม่เริ่มทันที =================
        const R = [];
        for (let i = 0; i < 3; i += 1) R.push(await makeClient(base, 'R' + i));
        everyone.push(...R);
        await delay(300);
        const roomR = await createRoom(R[0], { settings: { colorcardsTarget: 500 } });
        await joinAll(roomR, R.slice(1));
        await start(R[0], R, roomR);
        const statsR = await drive(R, R[0], { readyAll: true, timeoutMs: 200000, stop: (S, st) => st.readyStarts >= 1 });
        assert(statsR.readyStarts >= 1, 'ทุกคนกดพร้อม → รอบใหม่เริ่มทันที');
        const endR = await ack(R[0].socket, 'colorcards_end', {});
        assert(endR.success, 'หัวห้องจบเกมได้');
        console.log(`6a. 3 คน ล่า 500 · จบรอบแล้วทุกคนกดพร้อม → รอบ ${last(R[0]).round} เริ่มทันที ✓`);
        R.forEach(c => c.socket.close());

        // ================= C0) เติมบอทจนเต็ม 10 ที่ (สี/อวตารบอทต้องผ่าน validation ทุกช่อง) =================
        const filler = await makeClient(base, 'F0');
        everyone.push(filler);
        await delay(300);
        const roomF = await createRoom(filler, { maxPlayers: 10, settings: {} });
        r = await ack(filler.socket, 'colorcards_addBots', { roomId: roomF, count: 9 });
        assert(r.success && r.added === 9, 'เพิ่มบอท 9 ตัวเต็ม 10 ที่ได้: ' + JSON.stringify(r));
        await ack(filler.socket, 'leaveRoom', {});
        filler.socket.close();
        console.log('6b. เพิ่มบอทจนเต็ม 10 ที่ ✓');

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
        console.log(`7. คน 1 + บอท 3 จบเกม (คนลง ${statsC.plays} · คนลงหลายใบ ${statsC.multiPlays} · บอทมีบันทึก ${botTurns} รายการ · ผู้ชนะ ${finC.winner.name}) ✓`);
        await delay(800);
        rows = readStats();
        assert(!rows.some(x => String(x.playerId).startsWith('bot_')), 'ไม่บันทึกสถิติบอท');
        // เกมที่มีบอทร่วมโต๊ะไม่นับสถิติให้ใครเลย (เกมคนล้วน A/B ด้านบนยังนับตามปกติ)
        const humanRow = rows.find(x => x.playerId === human.id);
        assert(!(humanRow && humanRow.modeStats?.colorcards?.games), 'เกมที่มีบอทต้องไม่นับสถิติให้คน: ' + JSON.stringify(humanRow?.modeStats?.colorcards));
        // เล่นใหม่แล้วคนเดียวออก → ห้องบอทล้วนถูกปิด
        await ack(human.socket, 'returnFinishedToLobby', { roomId: roomC });
        await delay(500);
        human.states.length = 0;
        await start(human, [human], roomC);
        await ack(human.socket, 'leaveRoom', {});
        await delay(500);
        const list = await new Promise(res => human.socket.emit('getRoomList', x => res(x)));
        assert(!(list.rooms || []).some(x => x.roomId === roomC), 'คนสุดท้ายออก ห้องบอทล้วนถูกปิด');
        console.log('8. เกมมีบอทไม่นับสถิติให้ใคร (บอทก็ไม่ถูกบันทึก) · คนสุดท้ายออก ปิดห้องบอทล้วน ✓');

        // ================= D) ลงหลายใบผ่าน socket =================
        const D = [];
        for (let i = 0; i < 3; i += 1) D.push(await makeClient(base, 'D' + i));
        everyone.push(...D);
        await delay(300);
        const roomD = await createRoom(D[0], { settings: { colorcardsTurnSeconds: 30 } });
        await joinAll(roomD, D.slice(1));
        await start(D[0], D, roomD);
        assert(last(D[0]).config.multi === true, 'ลงหลายใบเปิดเป็นค่าเริ่มของห้อง');
        /** จั่วอย่างเดียวจนคนที่ถึงตามีกลุ่มที่ลงได้ (มี pred เพิ่มได้) */
        async function hoardUntil(clients, pred, label) {
            for (let guard = 0; guard < 160; guard += 1) {
                const S = last(clients[0]);
                const actor = clients.find(c => S.turn && c.id === S.turn.playerId);
                if (!actor) { await delay(60); continue; }
                await waitFor(() => last(actor).turnSeq === last(clients[0]).turnSeq, 3000, 'actor sync');
                const view = last(actor);
                if (view.phase !== 'turn') throw new Error('เกมจบก่อนเจอกลุ่ม');
                if (!view.turn.drawn && pred(view)) return actor;
                const before = view.step;
                const res = await ack(actor.socket, view.availableActions.canPass ? 'colorcards_pass' : 'colorcards_draw', { turnSeq: view.turnSeq });
                if (res.success) await waitFor(() => last(actor).step !== before, 5000, 'hoard step');
            }
            throw new Error('หากลุ่มไม่เจอ: ' + label);
        }
        const dActor = await hoardUntil(D, v => {
            const g = bestGroup(v);
            return !!g && v.self.hand.length >= 4 && v.self.hand.some(c => !isWildCard(c) && !sameValue(c, g[0]));
        }, 'D');
        const dView = last(dActor);
        const grp = bestGroup(dView);
        const lead = grp[0];
        const odd = dView.self.hand.find(c => c.id !== lead.id && !sameValue(c, lead) && !isWildCard(c));
        const others = D.filter(c => c !== dActor);
        const stepBefore = dView.step;
        const seq = dView.turnSeq;
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: [lead.id, odd.id], turnSeq: seq });
        assert(!r.success && /เฉพาะเลขเดียวกัน/.test(r.error), 'กลุ่มค่าไม่เหมือนกันโดนปฏิเสธ: ' + r.error);
        const dWild = dView.self.hand.find(isWildCard);
        if (dWild) {
            r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: [lead.id, dWild.id], color: 'r', turnSeq: seq });
            assert(!r.success && /ทีละใบ/.test(r.error), 'ไวลด์ในกลุ่มโดนปฏิเสธ: ' + r.error);
        }
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: [lead.id, last(others[0]).self.hand[0].id], turnSeq: seq });
        assert(!r.success && /ไม่มีไพ่/.test(r.error), 'ใส่ไพ่คนอื่นในกลุ่มโดนปฏิเสธ');
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: [lead.id, lead.id], turnSeq: seq });
        assert(!r.success && /ซ้ำ/.test(r.error), 'ใบซ้ำในกลุ่มโดนปฏิเสธ');
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: [lead.id, 42, { id: 'k000' }], turnSeq: seq });
        assert(!r.success && /ไม่มีไพ่/.test(r.error), 'id ไม่ใช่ string โดนปฏิเสธ');
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: Array(40).fill(lead.id), turnSeq: seq });
        assert(!r.success && /ไม่เกิน/.test(r.error), 'กลุ่มยาวผิดปกติโดนปฏิเสธ');
        const illegalFirst = dView.self.hand.find(c => !dView.self.playable.includes(c.id) && !isWildCard(c)
            && dView.self.hand.some(m => m.id !== c.id && sameValue(m, c) && dView.self.playable.includes(m.id)));
        if (illegalFirst) {
            const mate = dView.self.hand.find(m => m.id !== illegalFirst.id && sameValue(m, illegalFirst) && dView.self.playable.includes(m.id));
            r = await ack(dActor.socket, 'colorcards_play', { cardId: illegalFirst.id, cardIds: [illegalFirst.id, mate.id], turnSeq: seq });
            assert(!r.success && /ใบแรก/.test(r.error), 'ใบแรกลงไม่ได้โดนปฏิเสธ: ' + r.error);
        }
        r = await ack(others[0].socket, 'colorcards_play', { cardId: lead.id, cardIds: grp.map(c => c.id), turnSeq: seq });
        assert(!r.success && /ยังไม่ถึงตา/.test(r.error), 'ลงหลายใบนอกตาโดนปฏิเสธ');
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: grp.map(c => c.id), turnSeq: seq - 1 });
        assert(!r.success && /จังหวะ/.test(r.error), 'ลงหลายใบด้วย turnSeq เก่าโดนปฏิเสธ');
        assert(last(D[0]).step === stepBefore && last(dActor).self.hand.length === dView.self.hand.length, 'กลุ่มผิดไม่เปลี่ยน state');
        // ลงจริง — เรียงให้ใบแรกลงได้ ใบสุดท้ายต่างสีจากใบแรกถ้ามี
        const tail = grp.slice(1).sort((x, y) => Number(x.color === lead.color) - Number(y.color === lead.color)).reverse();
        const order = [lead, ...tail];
        const topCard = order[order.length - 1];
        const countBefore = dView.self.hand.length;
        r = await ack(dActor.socket, 'colorcards_play', { cardId: lead.id, cardIds: order.map(c => c.id), callLast: countBefore - order.length === 1, turnSeq: seq });
        assert(r.success, 'ลงหลายใบผ่าน socket ได้: ' + r.error);
        await waitFor(() => D.every(c => last(c).step !== stepBefore), 5000, 'others see multi');
        const mine = last(dActor);
        assert(mine.self.hand.length === countBefore - order.length, `มือลด ${order.length} ใบ`);
        assert(order.every(c => !mine.self.hand.some(h => h.id === c.id)), 'ไพ่ทั้งกลุ่มออกจากมือ');
        for (const o of others) {
            const v = last(o);
            assert(v.top.id === topCard.id, `${o.name} เห็นใบบนสุด = ใบสุดท้ายของกลุ่ม`);
            if (topCard.color) assert(v.currentColor === topCard.color, `${o.name} เห็นสีต่อไป = สีใบสุดท้าย`);
            assert(v.seats.find(x => x.playerId === dActor.id).count === countBefore - order.length, `${o.name} เห็นจำนวนไพ่ลดลง`);
            const playFx = v.fx.filter(e => e.kind === 'play').pop();
            assert(playFx && playFx.count === order.length && playFx.cards.map(c => c.id).join() === order.map(c => c.id).join(), `${o.name} ได้ fx ลงหลายใบตามลำดับ`);
            const word = ['', '', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด'][order.length];
            const val = topCard.kind === 'num' ? String(topCard.value) : ({ skip: 'ข้าม', rev: 'กลับทิศ', d2: '+2' })[topCard.kind];
            assert(v.history.some(h => h.text.includes(`ลง ${val} ${word}ใบ!`)), `${o.name} เห็นบันทึก "ลง ${val} ${word}ใบ!"`);
        }
        console.log(`8b. ลงหลายใบผ่าน socket: ${order.length} ใบ (${order.map(c => c.color || 'w').join('→')} ${topCard.kind === 'num' ? topCard.value : topCard.kind}) · กลุ่มผิด/ไวลด์/ไพ่คนอื่น/ซ้ำ/ยาว/นอกตา/turnSeq เก่า โดนปฏิเสธ · คนอื่นเห็นใบบน+บันทึก ✓`);
        // เล่นต่อจนจบด้วยกลุ่มเสมอเมื่อลงได้
        const statsD = await drive(D, D[0], { timeoutMs: 200000 });
        assert(last(D[0]).phase === 'finished', 'เกมที่ลงหลายใบจบได้');
        console.log(`8c. เล่นต่อจนจบ (ลงหลายใบอีก ${statsD.multiPlays} ครั้ง · ลง ${statsD.plays}) ✓`);
        D.forEach(c => c.socket.close());

        // ห้องปิดกติกา (หัวห้องสลับในห้องรอ) → ลงหลายใบไม่ได้
        const O = [await makeClient(base, 'O0'), await makeClient(base, 'O1')];
        everyone.push(...O);
        await delay(300);
        const roomO = await createRoom(O[0], { settings: {} });
        await joinAll(roomO, [O[1]]);
        r = await ack(O[1].socket, 'updateRoom', { colorcardsMulti: false });
        r = await ack(O[0].socket, 'updateRoom', { colorcardsMulti: false });
        assert(r.success && r.room.settings.colorcardsMulti === false, 'หัวห้องปิดลงหลายใบในห้องรอได้');
        await start(O[0], O, roomO);
        assert(last(O[0]).config.multi === false, 'ปิดแล้วไปถึงเกม');
        const oActor = await hoardUntil(O, v => (v.self.playable || []).some(id => {
            const c = v.self.hand.find(x => x.id === id);
            return c && !isWildCard(c) && v.self.hand.some(m => m.id !== id && sameValue(m, c));
        }), 'O');
        const oView = last(oActor);
        const oLead = oView.self.hand.find(c => oView.self.playable.includes(c.id) && !isWildCard(c) && oView.self.hand.some(m => m.id !== c.id && sameValue(m, c)));
        const oMate = oView.self.hand.find(m => m.id !== oLead.id && sameValue(m, oLead));
        r = await ack(oActor.socket, 'colorcards_play', { cardId: oLead.id, cardIds: [oLead.id, oMate.id], turnSeq: oView.turnSeq });
        assert(!r.success && /ทีละใบ/.test(r.error), 'ห้องปิด: ลงหลายใบโดนปฏิเสธ: ' + r.error);
        r = await ack(oActor.socket, 'colorcards_play', { cardId: oLead.id, cardIds: [oLead.id], turnSeq: oView.turnSeq });
        assert(r.success, 'ห้องปิด: ลงใบเดียวผ่าน cardIds ได้');
        r = await ack(O[0].socket, 'colorcards_end', {});
        assert(r.success, 'จบเกมห้องปิดกติกา');
        console.log('8d. หัวห้องปิด "ลงไพ่เหมือนกันหลายใบพร้อมกัน" ในห้องรอ → เกมรับแค่ใบเดียว ✓');
        O.forEach(c => c.socket.close());

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
