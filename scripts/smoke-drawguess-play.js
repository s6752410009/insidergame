/**
 * เล่นวาดแล้วทายจนจบผ่าน socket จริง (เซิร์ฟเวอร์ของตัวเอง, data ชั่วคราว)
 *
 * เกม 1 (3 คน = น้อยสุด): เลือกคำ · วาด · ทายผิด/เกือบ/ถูก · คุยหลังทายถูก · คำสั่งผิดกติกาถูกปัด
 *        · หลุดแล้วต่อใหม่ได้ state + ภาพเดิม · แชทห้องถูกปิดระหว่างเกม · จบ → สถิติครั้งเดียว → กลับห้องรอ
 * เกม 2 (12 คน = มากสุด): คนออกกลางเกม · หัวห้องออก (สิทธิ์ย้าย เกมไม่ค้าง) · คนวาดหลุด → ข้ามตา
 *        · คนที่ออกกลับเข้ามา = ทายได้ตาถัดไป · เล่นจนจบ
 * เกม 3 (พร้อมกับเกม 2): ไม่มีใครกดอะไร → ทุกเฟสหมดเวลาเอง เกมจบไม่ค้าง
 * เกม 4: รีสตาร์ตเซิร์ฟเวอร์กลางตา → ต่อกลับได้ ภาพยังอยู่ เล่นต่อได้ · หัวห้องจบเกม (ไม่นับสถิติ)
 * ทุกข้อความที่ส่งถึงคนที่ยังไม่ควรรู้คำ ต้องไม่มีคำ/ตัวเลือก
 *
 * รัน: npm run smoke:drawguess:play
 */
const { setupDataDir, assertPortFree, bootServer, stopServer } = require('./drawguess-test-env');
const DATA_DIR = setupDataDir('play');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const PORT = Number(process.env.DRAWGUESS_PLAY_PORT) || 8811;
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

const TIMERS = {
    DRAWGUESS_CHOOSE_MS: '1500',
    DRAWGUESS_DRAW_MS: '3200',
    DRAWGUESS_REVEAL_MS: '600',
    DRAWGUESS_GRACE_MS: '2200'
};

function ack(s, e, p) {
    return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); });
}
function conn(base) {
    return new Promise((r, j) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        s.once('connect', () => r(s));
        s.once('connect_error', j);
    });
}

const ROOM_WORDS = new Map(); // roomId -> Map(turnNo -> { word, choices })

function wire(p) {
    p.socket.on('drawguessState', s => { p.states.push(s); noteSecrets(p, s); });
    p.socket.onAny((event, payload) => { p.events.push([event, payload]); });
}
async function makePlayer(base, label) {
    const socket = await conn(base);
    const id = randomUUID();
    socket.emit('initPlayer', id);
    const p = { socket, id, label, states: [], events: [], roomId: null };
    wire(p);
    return p;
}
async function reconnect(base, p) {
    try { p.socket.close(); } catch (e) { /* */ }
    p.socket = await conn(base);
    wire(p);
    p.socket.emit('initPlayer', p.id);
    p.socket.emit('setRoom', { roomId: p.roomId, playerId: p.id });
}
const last = p => p.states[p.states.length - 1];
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const v = fn();
        if (v) return v;
        await delay(40);
    }
    throw new Error('รอไม่ถึง: ' + label);
}

/** จดคำของแต่ละตาจาก state ของคนวาด (ใช้ตรวจย้อนหลังว่าไม่รั่ว) */
function noteSecrets(p, s) {
    if (!p.roomId || !s || !s.self || !s.self.isDrawer) return;
    if (!ROOM_WORDS.has(p.roomId)) ROOM_WORDS.set(p.roomId, new Map());
    const map = ROOM_WORDS.get(p.roomId);
    const entry = map.get(s.turnNo) || { word: null, choices: [] };
    if (s.word) entry.word = s.word;
    if (s.choices && s.choices.length) entry.choices = s.choices.map(c => c.word);
    map.set(s.turnNo, entry);
}

/** ตรวจทุก payload ที่คนนี้ได้รับ: ตอนที่ยังไม่ควรรู้คำ ต้องไม่มีคำ/ตัวเลือกของตานั้น */
function auditLeaks(players, label) {
    let inspected = 0;
    players.forEach(p => {
        const map = ROOM_WORDS.get(p.roomId) || new Map();
        let currentTurn = 0;
        let entitled = false;
        p.events.forEach(([event, payload]) => {
            const json = JSON.stringify(payload || null);
            if (event === 'drawguessState') {
                currentTurn = payload.turnNo;
                entitled = !!(payload.self && (payload.self.isDrawer || payload.self.guessed)) || !['choose', 'draw'].includes(payload.phase);
                if (!entitled) {
                    assert(!payload.word && !(payload.choices || []).length, `${label}: state ของ ${p.label} มีคำ/ตัวเลือก`);
                    (payload.feed || []).forEach(f => {
                        if (f.turnNo !== payload.turnNo) return;
                        assert(!f.solvedOnly, `${label}: แชทคนทายถูกรั่วถึง ${p.label}`);
                        if (f.privateTo) assert(f.privateTo === p.id, `${label}: "เกือบ" ของคนอื่นรั่วถึง ${p.label}`);
                    });
                    if (payload.mask) {
                        const letters = payload.mask.filter(m => !m.sp).length;
                        assert(payload.mask.filter(m => m.ch).length <= Math.floor(letters * 0.4), `${label}: เปิดคำใบ้เกิน 40%`);
                    }
                }
            }
            if (entitled) return;
            const secrets = map.get(currentTurn);
            if (!secrets) return;
            [secrets.word, ...secrets.choices].filter(Boolean).forEach(word => {
                inspected += 1;
                assert(!json.includes(`"${word}"`), `${label}: ${event} ถึง ${p.label} มีคำ "${word}"`);
            });
        });
    });
    return inspected;
}

function statsOf(id) {
    const file = path.join(DATA_DIR, 'playerStats.json');
    if (!fs.existsSync(file)) return null;
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    return all[id]?.modeStats?.drawguess || null;
}

async function setupRoom(players, name, extra = {}) {
    const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name, gameMode: 'drawguess', maxPlayers: 12, ...extra });
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players.forEach(p => { p.roomId = roomId; });
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        const res = await ack(p.socket, 'joinRoom', { roomId, playerId: p.id });
        assert(res?.success, 'join ไม่ได้: ' + JSON.stringify(res));
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(500);
    return roomId;
}

async function start(players, roomId) {
    const started = await ack(players[0].socket, 'startGameFromLobby', { roomId });
    assert(started?.success, 'เริ่มเกมไม่ได้: ' + JSON.stringify(started));
    await waitFor(() => players.every(p => last(p)?.phase === 'choose'), 9000, 'ทุกคนได้ state ช่วงเลือกคำ');
}

function drawerOf(players) {
    return players.find(p => last(p)?.self?.isDrawer && ['choose', 'draw'].includes(last(p).phase)) || null;
}

/** เล่นหนึ่งตาแบบปกติ: คนวาดเลือกคำ วาดนิดนึง ทุกคนทายถูก — opts.hooks สำหรับแทรกเหตุการณ์ */
async function playTurn(active, opts = {}) {
    const drawer = await waitFor(() => {
        const d = drawerOf(active);
        return d && last(d).phase === 'choose' ? d : null;
    }, 6000, 'ถึงตาคนวาด');
    const turnNo = last(drawer).turnNo;
    if (opts.beforeChoose) await opts.beforeChoose(drawer, turnNo);
    const chosen = await ack(drawer.socket, 'drawguess_choose', { turnNo, index: opts.index ?? 0 });
    if (!chosen?.success) {
        // ช่วงเลือกหมดเวลาพอดี → ระบบสุ่มให้แล้ว ใช้ต่อได้
        assert(/ไม่ใช่ช่วงเลือกคำ/.test(chosen?.error || ''), 'เลือกคำไม่ได้: ' + JSON.stringify(chosen));
    }
    await waitFor(() => last(drawer).phase === 'draw' && last(drawer).turnNo === turnNo && last(drawer).word, 3000, 'คนวาดเห็นคำ');
    const word = last(drawer).word;
    const stroke = await ack(drawer.socket, 'drawguess_stroke', { turnNo, ops: [{ t: 's', id: turnNo * 10, c: 3, w: 1, p: [0.2, 0.2, 0.5, 0.6, 0.8, 0.3] }] });
    assert(stroke?.success && stroke.applied === 1, 'ส่งเส้นไม่ได้: ' + JSON.stringify(stroke));
    if (opts.during) await opts.during(drawer, turnNo, word);
    const guessers = active.filter(p => p !== drawer && !(opts.skipGuess || []).includes(p));
    for (const g of guessers) {
        if (last(g).phase !== 'draw' || last(g).turnNo !== turnNo) break;
        if (last(g).self.guessed || last(g).self.late) continue;
        const res = await ack(g.socket, 'drawguess_guess', { text: word });
        if (res?.success) assert(['correct'].includes(res.result?.result), 'ทายคำตรง ๆ ต้องถูก: ' + JSON.stringify(res));
    }
    await waitFor(() => last(active[active.length - 1])?.phase !== 'draw' || last(active[active.length - 1]).turnNo !== turnNo, 6000, 'ตาจบ');
    return { drawer, turnNo, word };
}

(async () => {
    await assertPortFree(PORT);
    let server = await bootServer(PORT, TIMERS);
    const base = `http://127.0.0.1:${PORT}`;
    const all = [];
    try {
        // ------------------------------------------------ game 1 (3 คน)
        const g1 = [];
        for (let i = 0; i < 3; i++) g1.push(await makePlayer(base, `g1-${i}`));
        all.push(...g1);
        const room1 = await setupRoom(g1, 'DG-Play-3', { drawguessRounds: 2, drawguessSeconds: 60, drawguessCategory: 'animals' });

        // ตั้งค่าห้อง: ค่าแปลก ๆ ถูกปัดกลับเป็นค่าที่อนุญาต
        const bad = await ack(g1[0].socket, 'updateRoom', { drawguessRounds: 99, drawguessSeconds: 7, drawguessCategory: 'zzz' });
        assert(bad?.success && bad.room.settings.drawguessRounds === 3 && bad.room.settings.drawguessSeconds === 80 && bad.room.settings.drawguessCategory === 'mixed', 'ค่าตั้งห้องผิดต้องถูกปัด: ' + JSON.stringify(bad?.room?.settings));
        const good = await ack(g1[0].socket, 'updateRoom', { drawguessRounds: 2, drawguessSeconds: 60, drawguessCategory: 'animals' });
        assert(good?.success && good.room.settings.drawguessRounds === 2 && good.room.settings.drawguessCategory === 'animals', 'ตั้งค่าห้องไม่ได้');
        const notAdmin = await ack(g1[1].socket, 'updateRoom', { drawguessRounds: 4 });
        assert(notAdmin?.success === false, 'คนที่ไม่ใช่หัวห้องแก้ค่าไม่ได้');
        const early = await ack(g1[1].socket, 'drawguess_guess', { text: 'แมว' });
        assert(early?.success === false, 'ยังไม่เริ่มเกม ทายไม่ได้');
        await delay(300);

        await start(g1, room1);
        const v0 = last(g1[0]);
        assert(v0.settings.rounds === 2 && v0.settings.category === 'animals' && v0.round === 1, 'เกมใช้ค่าตั้งห้อง');
        assert(v0.players.length === 3, 'มีผู้เล่น 3 คน');
        console.log('1. ตั้งค่าห้อง (ปัดค่าผิด) · เริ่มเกม 3 คน ✓');

        // ---- ตาแรก: ตรวจคำสั่งผิดกติกาให้ครบ
        const d1 = await waitFor(() => drawerOf(g1), 4000, 'มีคนวาด');
        assert(d1 === g1[0], 'คนแรกตามลำดับที่นั่งเป็นคนวาด');
        const others1 = g1.filter(p => p !== d1);
        assert(last(d1).choices.length === 3 && last(d1).choices.every(c => c.category === 'สัตว์'), 'คนวาดได้ 3 คำในหมวด');
        others1.forEach(p => assert(last(p).choices.length === 0, 'คนอื่นไม่เห็นตัวเลือก'));
        const T1 = last(d1).turnNo;
        let r = await ack(others1[0].socket, 'drawguess_choose', { turnNo: T1, index: 0 });
        assert(r?.success === false, 'คนที่ไม่ใช่คนวาดเลือกคำไม่ได้');
        r = await ack(d1.socket, 'drawguess_choose', { turnNo: T1 + 5, index: 0 });
        assert(r?.success === false, 'turnNo เก่า/มั่วถูกปัด');
        r = await ack(d1.socket, 'drawguess_choose', { turnNo: T1, index: 9 });
        assert(r?.success === false, 'index เกินถูกปัด');
        r = await ack(d1.socket, 'drawguess_stroke', { turnNo: T1, ops: [{ t: 's', id: 1, c: 0, w: 0, p: [0.1, 0.1] }] });
        assert(r?.success === false, 'ยังไม่เลือกคำ วาดไม่ได้');
        r = await ack(d1.socket, 'drawguess_choose', { turnNo: T1, index: 2 });
        assert(r?.success, 'คนวาดเลือกคำได้');
        await waitFor(() => last(d1).phase === 'draw' && last(d1).word, 2000, 'เริ่มวาด');
        const word1 = last(d1).word;
        await waitFor(() => others1.every(p => last(p).phase === 'draw'), 2000, 'คนทายเข้าช่วงวาด');
        others1.forEach(p => {
            assert(last(p).word === null && Array.isArray(last(p).mask) && last(p).mask.length > 0, 'คนทายเห็นแค่ช่องว่าง');
            assert(last(p).self.canGuess, 'คนทายทายได้');
        });

        // เส้น: คนวาดส่งได้ คนอื่นได้รับ · คนทาย/ข้อมูลเพี้ยน/ก้อนใหญ่ ถูกปัด
        r = await ack(d1.socket, 'drawguess_stroke', { turnNo: T1, ops: [{ t: 's', id: 11, c: 3, w: 2, p: [0.1, 0.1, 0.2, 0.25] }, { t: 'p', id: 11, p: [0.3, 0.3, 0.4, 0.42] }] });
        assert(r?.success && r.applied === 2, 'ส่งเส้นได้');
        await waitFor(() => others1.every(p => p.events.some(([e, x]) => e === 'drawguess_draw' && x.turnNo === T1 && x.ops.length === 2)), 2000, 'คนอื่นได้เส้น');
        assert(!d1.events.some(([e]) => e === 'drawguess_draw'), 'คนวาดไม่ได้เส้นตัวเองกลับมา');
        const badBatches = [
            { turnNo: T1, ops: [{ t: 's', id: 2, c: 12, w: 0, p: [0.1, 0.1] }] },
            { turnNo: T1, ops: [{ t: 's', id: 2, c: 0, w: 4, p: [0.1, 0.1] }] },
            { turnNo: T1, ops: [{ t: 's', id: 2, c: 0, w: 0, p: [0.1, 'x'] }] },
            { turnNo: T1, ops: [{ t: 's', id: 2, c: 0, w: 0, p: [0.1, 3] }] },
            { turnNo: T1, ops: [{ t: 's', id: 2, c: 0, w: 0, p: [0.1] }] },
            { turnNo: T1, ops: [{ t: 'zz' }] },
            { turnNo: T1, ops: [] },
            { turnNo: T1, ops: new Array(60).fill({ t: 'u' }) },
            { turnNo: T1, ops: [{ t: 's', id: 2, c: 0, w: 0, p: new Array(1200).fill(0.5) }] },
            { turnNo: T1 - 1, ops: [{ t: 's', id: 2, c: 0, w: 0, p: [0.1, 0.1] }] },
            null
        ];
        for (const b of badBatches) {
            r = await ack(d1.socket, 'drawguess_stroke', b);
            assert(r?.success === false, 'ก้อนเส้นผิดรูปต้องถูกปัด: ' + JSON.stringify(b)?.slice(0, 80));
        }
        r = await ack(others1[0].socket, 'drawguess_stroke', { turnNo: T1, ops: [{ t: 's', id: 3, c: 0, w: 0, p: [0.5, 0.5] }] });
        assert(r?.success === false, 'คนที่ไม่ใช่คนวาดส่งเส้นไม่ได้');
        others1[0].socket.emit('drawguess_stroke', { turnNo: T1, ops: [{ t: 's', id: 3, c: 0, w: 0, p: [0.5, 0.5] }] });
        await waitFor(() => others1[0].events.some(([e]) => e === 'drawguess_strokeRejected'), 2000, 'ส่งเส้นไม่มี callback ก็ได้รับแจ้งปัด');
        console.log('2. เลือกคำ/ส่งเส้น: คนวาดเท่านั้น · ข้อมูลเพี้ยน/ก้อนใหญ่/ตาเก่าถูกปัด ✓');

        // แชทห้องถูกปิดระหว่างเกม (กันพิมพ์คำตอบลงแชท)
        others1[0].socket.emit('sendMessage', { message: 'สวัสดี' });
        await waitFor(() => others1[0].events.some(([e]) => e === 'chatError'), 2000, 'แชทห้องถูกปิดระหว่างเกม');

        // ทายผิด (ทุกคนเห็น) · เกือบ (เห็นคนเดียว) · ถูก
        const [ga, gb] = others1;
        r = await ack(ga.socket, 'drawguess_guess', { text: 'ทายมั่วจ้า' });
        assert(r?.success && r.result.result === 'wrong', 'ทายผิด');
        await delay(400);
        r = await ack(ga.socket, 'drawguess_guess', { text: word1 + 'จ๋า' });
        assert(r?.success && r.result.result === 'close', 'คำที่มีคำตอบอยู่ข้างใน = เกือบ: ' + JSON.stringify(r));
        await delay(400);
        r = await ack(ga.socket, 'drawguess_guess', { text: 'x'.repeat(80) });
        assert(r?.success, 'ข้อความยาวถูกตัด ไม่พัง');
        await delay(400);
        r = await ack(ga.socket, 'drawguess_guess', { text: '   ' });
        assert(r?.success === false, 'ข้อความว่างถูกปัด');
        r = await ack(ga.socket, 'drawguess_guess', { text: ' ' + word1 + '​ ' });
        assert(r?.success && r.result.result === 'correct' && r.result.order === 1 && r.result.points > 0, 'ทายถูก (ตัดช่องว่าง/อักขระมองไม่เห็น): ' + JSON.stringify(r));
        await waitFor(() => last(gb).feed.some(f => f.kind === 'correct' && f.playerId === ga.id), 2000, 'คนอื่นเห็น ✅');
        assert(last(gb).word === null, 'คนที่ยังไม่ถูกยังไม่เห็นคำ');
        assert(last(ga).word === word1 && !last(ga).self.canGuess, 'คนที่ถูกแล้วเห็นคำ ทายซ้ำไม่ได้');
        await delay(400);
        r = await ack(ga.socket, 'drawguess_guess', { text: word1 });
        assert(r?.success && r.result.result === 'chat', 'คนที่ถูกแล้วพิมพ์ = คุยเฉพาะคนที่ถูก');
        await delay(250);
        assert(!last(gb).feed.some(f => f.solvedOnly), 'คนที่ยังไม่ถูกไม่เห็นแชทของคนที่ถูก');
        assert(last(d1).feed.some(f => f.solvedOnly), 'คนวาดเห็นแชทของคนที่ถูก');
        assert(last(gb).feed.some(f => f.kind === 'guess' && f.text === 'ทายมั่วจ้า'), 'คำทายผิดโชว์ให้ทุกคน');
        assert(!last(gb).feed.some(f => f.kind === 'close'), '"เกือบ" ของคนอื่นไม่โชว์');
        const scoreBefore = last(d1).players.find(p => p.playerId === d1.id).score;
        r = await ack(gb.socket, 'drawguess_guess', { text: word1 });
        assert(r?.success && r.result.result === 'correct' && r.result.order === 2, 'คนที่สองทายถูก');
        await waitFor(() => last(d1).phase === 'reveal', 2000, 'ทุกคนถูก = จบตาทันที');
        const reveal = last(gb);
        assert(reveal.lastTurn && reveal.lastTurn.word === word1 && reveal.lastTurn.reason === 'all', 'เฉลยคำ');
        const deltaDrawer = reveal.lastTurn.deltas.find(d => d.playerId === d1.id);
        assert(deltaDrawer && deltaDrawer.delta === 80, 'คนวาดได้ 40 ต่อคนที่ทายถูก');
        const da = reveal.lastTurn.deltas.find(d => d.playerId === ga.id).delta;
        const db = reveal.lastTurn.deltas.find(d => d.playerId === gb.id).delta;
        assert(da > db, 'ทายก่อนได้มากกว่า');
        assert(last(d1).players.find(p => p.playerId === d1.id).score === scoreBefore + 80, 'แต้มรวมคนวาด');
        console.log('3. ทายผิด/เกือบ (ส่วนตัว)/ถูก · คุยหลังทายถูกเห็นเฉพาะกลุ่ม · ทุกคนถูกจบตา · แต้มตามลำดับ ✓');

        // ---- ตาสอง: รีคอนเนกต์กลางตา (ได้ state + ภาพเดิม)
        await playTurn(g1, {
            during: async (drawer, turnNo) => {
                const victim = g1.find(p => p !== drawer);
                victim.states.length = 0;
                await reconnect(base, victim);
                await waitFor(() => last(victim)?.turnNo === turnNo && last(victim).phase === 'draw', 3000, 'ต่อใหม่ได้ state');
                const canvas = await waitFor(() => victim.events.find(([e, x]) => e === 'drawguess_canvas' && x.turnNo === turnNo), 3000, 'ต่อใหม่ได้ภาพเดิม');
                assert(canvas[1].strokes.length === 1 && canvas[1].strokes[0].p.length === 6, 'ภาพเดิมครบ');
                assert(last(victim).self.canGuess, 'ต่อใหม่แล้วยังทายได้');
            }
        });
        console.log('4. หลุดแล้วต่อใหม่กลางตา: ได้ state + เส้นทั้งหมดคืน ✓');

        // ---- ตาสาม: ปล่อยหมดเวลาเลือก (สุ่มให้) + หมดเวลาวาด (ไม่มีใครทาย)
        const d3 = await waitFor(() => { const d = drawerOf(g1); return d && last(d).phase === 'choose' ? d : null; }, 5000, 'ตาสาม');
        const choices3 = last(d3).choices.map(c => c.word);
        await waitFor(() => last(d3).phase === 'draw', 4000, 'หมดเวลาเลือก = สุ่มให้');
        assert(choices3.includes(last(d3).word), 'คำที่สุ่มมาจากตัวเลือก');
        await waitFor(() => last(d3).phase === 'reveal', 6000, 'หมดเวลาวาด');
        assert(last(d3).lastTurn.reason === 'timeout' && !last(d3).lastTurn.deltas.length, 'หมดเวลา ไม่มีใครได้แต้ม');
        console.log('5. ไม่เลือกคำ → สุ่มให้ · ไม่มีใครทาย → หมดเวลาจบตา ✓');

        // ตาที่เหลือ (2 รอบ × 3 คน = 6 ตา)
        let guard = 0;
        while (last(g1[0]).phase !== 'finished' && guard++ < 8) {
            await waitFor(() => ['choose', 'finished'].includes(last(g1[0]).phase), 4000, 'ตาถัดไป');
            if (last(g1[0]).phase === 'finished') break;
            await playTurn(g1);
        }
        await waitFor(() => g1.every(p => last(p).phase === 'finished'), 4000, 'เกม 1 จบ');
        const f1 = last(g1[1]);
        assert(f1.standings.length === 3 && f1.winnerIds.length >= 1, 'มีอันดับและผู้ชนะ');
        const top = f1.standings[0].score;
        f1.winnerIds.forEach(id => assert(f1.standings.find(s => s.playerId === id).score === top, 'ผู้ชนะแต้มสูงสุด'));
        assert(f1.countsForStats, 'เล่นครบนับสถิติ');
        const turns1 = (ROOM_WORDS.get(room1) || new Map()).size;
        assert(turns1 === 6, 'ทุกคนได้วาดครบ 2 รอบ (6 ตา) ได้ ' + turns1);
        const words1 = Array.from(ROOM_WORDS.get(room1).values()).flatMap(e => e.choices);
        assert(new Set(words1).size === words1.length, 'ไม่มีคำซ้ำในเกม');
        r = await ack(g1[1].socket, 'drawguess_guess', { text: 'x' });
        assert(r?.success === false, 'จบแล้วทายไม่ได้');
        await delay(800);
        g1.forEach(p => {
            const s = statsOf(p.id);
            assert(s && s.games === 1 && s.wins === (f1.winnerIds.includes(p.id) ? 1 : 0), 'สถิติบันทึกครั้งเดียว ชนะตามแต้ม: ' + JSON.stringify(s));
        });
        for (let i = 0; i < 3; i++) g1.forEach(p => p.socket.emit('drawguess_requestState', { roomId: room1, playerId: p.id }));
        await delay(600);
        g1.forEach(p => assert(statsOf(p.id).games === 1, 'ขอ state ซ้ำไม่บันทึกสถิติซ้ำ'));
        assert(g1.some(p => p.events.some(([e]) => e === 'returnToLobby')), 'มีนับถอยหลังกลับห้องรอ');
        r = await ack(g1[2].socket, 'returnFinishedToLobby', { roomId: room1 });
        assert(r?.success, 'กลับห้องรอได้');
        await waitFor(() => g1.every(p => p.events.some(([e]) => e === 'redirectToLobby')), 3000, 'ทุกคนกลับห้องรอ');
        const leaks1 = auditLeaks(g1, 'เกม 1');
        console.log(`6. เกม 1 จบ: ครบ 6 ตา ไม่มีคำซ้ำ · อันดับ/ผู้ชนะ · สถิติครั้งเดียว · กลับห้องรอ · ไม่รั่ว (${leaks1} จุดตรวจ) ✓`);

        // ------------------------------------------------ game 2 (12 คน) + game 3 (AFK) พร้อมกัน
        const g2 = [];
        for (let i = 0; i < 12; i++) g2.push(await makePlayer(base, `g2-${i}`));
        all.push(...g2);
        const room2 = await setupRoom(g2, 'DG-Play-12', { drawguessRounds: 2 });
        const extraJoin = await makePlayer(base, 'g2-13');
        all.push(extraJoin);
        r = await ack(extraJoin.socket, 'joinRoom', { roomId: room2, playerId: extraJoin.id });
        assert(r?.success === false, 'ห้องเต็ม 12 คน เข้าเพิ่มไม่ได้');

        const g3 = [];
        for (let i = 0; i < 3; i++) g3.push(await makePlayer(base, `g3-${i}`));
        all.push(...g3);
        const room3 = await setupRoom(g3, 'DG-Play-AFK', { drawguessRounds: 2 });

        await Promise.all([start(g2, room2), start(g3, room3)]);
        assert(last(g2[0]).players.length === 12, '12 คนในเกม');

        const afk = (async () => {
            const seen = new Set();
            const until = Date.now() + 70000;
            while (Date.now() < until && last(g3[0]).phase !== 'finished') {
                seen.add(last(g3[0]).phase + ':' + (last(g3[0]).lastTurn?.reason || ''));
                await delay(100);
            }
            assert(last(g3[0]).phase === 'finished', 'โต๊ะ AFK ต้องจบเอง');
            assert([...seen].some(s => s.startsWith('draw')) && [...seen].some(s => s === 'reveal:timeout'), 'ผ่านเฟสวาดและหมดเวลา');
            const f3 = last(g3[0]);
            assert(f3.standings.every(s => s.score === 0) && f3.winnerIds.length === 0, 'AFK ไม่มีใครได้แต้ม ไม่มีผู้ชนะ');
            return true;
        })();

        let active = g2.slice();
        let leaver = null;
        let turnCount = 0;
        let sawAway = false;
        let sawLateReject = false;
        let adminLeft = false;
        guard = 0;
        while (last(active[0]).phase !== 'finished' && guard++ < 40) {
            await waitFor(() => ['choose', 'finished'].includes(last(active[0]).phase), 6000, 'ตาถัดไป (เกม 2)');
            if (last(active[0]).phase === 'finished') break;
            turnCount += 1;
            if (turnCount === 2) {
                // คนทายออกจากห้องกลางตา
                await playTurn(active, {
                    during: async drawer => {
                        leaver = active.find(p => p !== drawer && p !== active[0]);
                        const res = await ack(leaver.socket, 'leaveRoom', {});
                        assert(res?.success !== false, 'ออกห้องได้');
                        active = active.filter(p => p !== leaver);
                        await waitFor(() => last(active[0]).players.find(p => p.playerId === leaver.id) === undefined
                            || last(active[0]).players.find(p => p.playerId === leaver.id)?.left, 3000, 'คนออกหายจากวง');
                    }
                });
            } else if (turnCount === 3) {
                // หัวห้องออก (ไม่ใช่ตาเขาวาด) → สิทธิ์ย้าย เกมไม่ค้าง หัวห้องใหม่ข้ามตาได้
                const oldAdmin = g2[0];
                await playTurn(active, {
                    during: async (drawer, turnNo) => {
                        if (drawer === oldAdmin) return;
                        await ack(oldAdmin.socket, 'leaveRoom', {});
                        active = active.filter(p => p !== oldAdmin);
                        adminLeft = true;
                        const newHost = await waitFor(() => {
                            const hostId = last(active[0]).hostId;
                            return hostId && hostId !== oldAdmin.id ? active.find(p => p.id === hostId) : null;
                        }, 3000, 'หัวห้องใหม่');
                        const notHost = active.find(p => p !== newHost && p !== drawer);
                        const deny = await ack(notHost.socket, 'drawguess_skip', { turnNo });
                        assert(deny?.success === false, 'คนที่ไม่ใช่หัวห้องข้ามตาไม่ได้');
                        const skip = await ack(newHost.socket, 'drawguess_skip', { turnNo });
                        assert(skip?.success, 'หัวห้องใหม่ข้ามตาได้: ' + JSON.stringify(skip));
                        await waitFor(() => last(newHost).phase === 'reveal' && last(newHost).lastTurn.reason === 'skipped', 2000, 'ข้ามตาแล้ว');
                    },
                    skipGuess: active
                });
            } else if (turnCount === 5) {
                // คนวาดหลุด → รอ grace แล้วข้ามตา → ต่อกลับมาเล่นต่อ · คนที่ออกไปกลับเข้าห้อง = ทายได้ตาถัดไป
                const drawer = await waitFor(() => { const d = drawerOf(active); return d && last(d).phase === 'choose' ? d : null; }, 5000, 'คนวาดตา 5');
                const turnNo = last(drawer).turnNo;
                await ack(drawer.socket, 'drawguess_choose', { turnNo, index: 0 });
                await waitFor(() => last(drawer).phase === 'draw', 2000, 'เริ่มวาดตา 5');
                drawer.socket.close();
                const watcher = active.find(p => p !== drawer);
                // คนที่ออกไปกลับเข้าห้องตอนกำลังวาด
                if (leaver) {
                    leaver.states.length = 0;
                    leaver.events.length = 0;
                    const back = await ack(leaver.socket, 'joinRoom', { roomId: room2, playerId: leaver.id });
                    assert(back?.success, 'คนที่ออกกลางเกมกลับเข้าห้องได้: ' + JSON.stringify(back));
                    leaver.socket.emit('setRoom', { roomId: room2, playerId: leaver.id });
                    await waitFor(() => last(leaver)?.turnNo === turnNo && last(leaver).phase === 'draw', 3000, 'คนกลับมาได้ state');
                    assert(last(leaver).self.late && !last(leaver).self.canGuess, 'กลับมากลางตา = ทายได้ตาถัดไป');
                    const lateTry = await ack(leaver.socket, 'drawguess_guess', { text: 'อะไรนะ' });
                    assert(lateTry?.success === false && /ตาถัดไป/.test(lateTry.error), 'กลับมากลางตาทายไม่ได้');
                    sawLateReject = true;
                }
                await waitFor(() => last(watcher).phase === 'reveal' && last(watcher).turnNo === turnNo, 6000, 'คนวาดหลุด → ข้ามตา');
                assert(last(watcher).lastTurn.reason === 'away', 'จบตาเพราะคนวาดหลุด: ' + last(watcher).lastTurn.reason);
                sawAway = true;
                drawer.states.length = 0;
                await reconnect(base, drawer);
                await waitFor(() => last(drawer)?.self?.inGame, 3000, 'คนวาดต่อกลับมา');
                if (leaver) active.push(leaver);
            } else {
                await playTurn(active);
            }
        }
        await waitFor(() => active.every(p => last(p).phase === 'finished'), 6000, 'เกม 2 จบ');
        const f2 = last(active[0]);
        assert(adminLeft && sawAway && sawLateReject, 'เกิดเหตุการณ์ครบ (หัวห้องออก/คนวาดหลุด/กลับเข้ามา)');
        assert(f2.standings.length === 12, 'อันดับมีทุกคนที่เคยเล่น');
        assert(f2.standings.find(s => s.playerId === g2[0].id).left, 'หัวห้องที่ออกถูกนับว่าออก');
        assert(f2.countsForStats && f2.endReason === 'complete', 'เกม 2 เล่นครบ');
        // จำนวนตา: 12 คน × 2 รอบ − ตาที่คนออกถูกข้าม
        const turns2 = (ROOM_WORDS.get(room2) || new Map()).size;
        assert(turns2 >= 20 && turns2 <= 24, 'จำนวนตาเกม 2 สมเหตุสมผล: ' + turns2);
        await afk;
        const leaks2 = auditLeaks(active, 'เกม 2') + auditLeaks(g3, 'เกม 3');
        console.log(`7. เกม 12 คน: คนออก · หัวห้องออก (สิทธิ์ย้าย ข้ามตาได้) · คนวาดหลุดถูกข้าม · คนกลับมาทายได้ตาถัดไป · จบ ${turns2} ตา ✓`);
        console.log(`8. โต๊ะ AFK จบเองไม่ค้าง · ไม่รั่ว (${leaks2} จุดตรวจ) ✓`);

        // ------------------------------------------------ game 4: รีสตาร์ตเซิร์ฟเวอร์กลางตา
        await stopServer(server);
        server = await bootServer(PORT, { ...TIMERS, DRAWGUESS_DRAW_MS: '20000', DRAWGUESS_GRACE_MS: '6000' });
        const g4 = [];
        for (let i = 0; i < 3; i++) g4.push(await makePlayer(base, `g4-${i}`));
        all.push(...g4);
        const room4 = await setupRoom(g4, 'DG-Play-Restart', { drawguessRounds: 2 });
        await start(g4, room4);
        const d4 = drawerOf(g4);
        const T4 = last(d4).turnNo;
        await ack(d4.socket, 'drawguess_choose', { turnNo: T4, index: 0 });
        await waitFor(() => last(d4).phase === 'draw', 2000, 'เริ่มวาด (เกม 4)');
        const word4 = last(d4).word;
        await ack(d4.socket, 'drawguess_stroke', { turnNo: T4, ops: [{ t: 's', id: 1, c: 6, w: 3, p: [0.1, 0.9, 0.9, 0.1] }] });
        // หลุด 1 คน → ห้องถูกเซฟลงไฟล์ แล้วเซิร์ฟเวอร์ตายแบบไม่ทันตั้งตัว
        g4[2].socket.close();
        await delay(900);
        server.kill('SIGKILL');
        await new Promise(res => server.once('exit', res));
        server = await bootServer(PORT, { ...TIMERS, DRAWGUESS_DRAW_MS: '20000', DRAWGUESS_GRACE_MS: '6000' });
        for (const p of g4) { p.states.length = 0; await reconnect(base, p); }
        await waitFor(() => g4.every(p => last(p)?.turnNo === T4 && last(p).phase === 'draw'), 5000, 'รีสตาร์ตแล้วกลับมาตาเดิม');
        assert(last(d4).word === word4 && last(d4).self.canDraw, 'คนวาดยังวาดคำเดิมได้');
        const canvas4 = await waitFor(() => g4[1].events.find(([e, x]) => e === 'drawguess_canvas' && x.turnNo === T4 && x.strokes.length), 3000, 'ภาพยังอยู่หลังรีสตาร์ต');
        assert(canvas4[1].strokes[0].c === 6, 'เส้นเดิมครบ');
        for (const g of g4.filter(p => p !== d4)) {
            const res = await ack(g.socket, 'drawguess_guess', { text: word4 });
            assert(res?.success && res.result.result === 'correct', 'ทายต่อได้หลังรีสตาร์ต');
        }
        await waitFor(() => last(g4[0]).phase === 'reveal', 3000, 'ตาจบหลังรีสตาร์ต');
        await waitFor(() => last(g4[0]).phase === 'choose', 3000, 'เดินต่อตาถัดไป');
        const notHost = await ack(g4[1].socket, 'endTableSession', { roomId: room4 });
        assert(notHost?.success === false, 'คนที่ไม่ใช่หัวห้องจบเกมไม่ได้');
        const ended = await ack(g4[0].socket, 'endTableSession', { roomId: room4 });
        assert(ended?.success, 'หัวห้องจบเกมได้');
        await waitFor(() => g4[1].events.some(([e]) => e === 'restartGame'), 3000, 'ทุกคนกลับห้องรอ');
        await delay(500);
        g4.forEach(p => assert(!statsOf(p.id), 'จบเกมเองไม่นับสถิติ'));
        auditLeaks(g4, 'เกม 4');
        console.log('9. รีสตาร์ตเซิร์ฟเวอร์กลางตา: กลับมาตาเดิม คำเดิม ภาพเดิม เล่นต่อได้ · หัวห้องจบเกม ไม่นับสถิติ ✓');

        assert(!/\[drawguess\].*failed/.test(server.getLogs()), 'เซิร์ฟเวอร์ต้องไม่มี error ของโหมดนี้');
        console.log(`\n✅ วาดแล้วทายเล่นผ่าน socket ครบ 4 เกม (${checks} checks)`);
    } finally {
        all.forEach(p => { try { p.socket.close(); } catch (e) { /* */ } });
        await stopServer(server);
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
