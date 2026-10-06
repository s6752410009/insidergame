/**
 * สายลับคำใบ้ — เล่นผ่าน socket จริงกับเซิร์ฟเวอร์จริง
 *   A) 4 คน (ขั้นต่ำ): เลือกทีม/บล็อกเริ่ม · ผิดกติกา · reconnect · เล่นจนจบ · สถิติ · กลับห้องรอแล้วเล่นใหม่
 *   B) 12 คน (สูงสุด, 1 ผู้ชม): โหวตเสียงข้างมาก · หัวหน้าหลุด → ตั้งใหม่ · คนออกกลางเกม · ทีมไม่มีลูกทีมออนไลน์ข้ามเทิร์น · มือสังหาร
 * ทุก payload ที่ลูกทีม/ผู้ชมได้รับถูกตรวจว่าไม่มีกุญแจ
 * รัน: npm run smoke:codenames:play   (SMOKE_PORT=8821 เพื่อกำหนดพอร์ต)
 */
const path = require('path');
const fs = require('fs');
if (!process.env.GAME_DATA_DIR) {
    const base = path.join(__dirname, '..', '..', '..', 'tmpdata-codenames');
    fs.mkdirSync(base, { recursive: true });
    process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(base, 'play-'));
    process.on('exit', () => { try { fs.rmSync(process.env.GAME_DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
if (!process.env.WALLETS_FILE) process.env.WALLETS_FILE = path.join(process.env.GAME_DATA_DIR, 'wallets.json');
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const engine = require('../games/codenamesEngine');

const PORT = Number(process.env.SMOKE_PORT) || 8821;
const GRACE_MS = 1500;
const HOST_SKIP_MS = 1500;
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            CODENAMES_SPYMASTER_GRACE_MS: String(GRACE_MS),
            CODENAMES_NO_OPERATIVE_GRACE_MS: String(GRACE_MS),
            CODENAMES_TICK_MS: '200',
            CODENAMES_HOST_SKIP_MS: String(HOST_SKIP_MS)
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
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) {
    return new Promise((r, j) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        const t = setTimeout(() => j(new Error('connect timeout')), 10000);
        s.once('connect', () => { clearTimeout(t); r(s); });
    });
}
async function waitFor(pred, ms = 15000, label = 'condition') {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pred()) return true;
        await delay(40);
    }
    throw new Error('timeout waiting for ' + label);
}

// ---------- leak audit ----------
let leakChecks = 0;
function auditPayload(client, event, payload) {
    const json = JSON.stringify(payload === undefined ? null : payload);
    if (event === 'codenamesState') {
        if (!payload || payload.mode !== 'codenames') return;
        const finished = payload.phase === 'finished';
        const role = payload.self && payload.self.role;
        const entitled = role === 'spymaster' || role === 'retired';
        if (!finished && !entitled) {
            assert(!payload.keyVisible, `${client.name} (${role}) ได้ keyVisible`);
            payload.board.forEach(card => {
                assert(card.revealed || card.color === null, `รั่ว: ${client.name} (${role}) เห็นสีการ์ด "${card.word}"`);
            });
            const assassinOpen = payload.board.some(c => c.revealed && c.color === 'assassin');
            if (!assassinOpen) assert(!/"assassin"/.test(json), `รั่ว: ${client.name} payload มี assassin`);
            leakChecks += 1;
        }
        return;
    }
    // ช่องทางอื่น (roomUpdate, แชท, ...) ห้ามมีกุญแจเลยระหว่างเล่น
    if (!client.finishedSeen) {
        assert(!/"assassin"/.test(json) && !/"board"\s*:\s*\[\s*\{/.test(json), `รั่วทาง ${event} ถึง ${client.name}: ${json.slice(0, 200)}`);
        leakChecks += 1;
    }
}

async function makeClient(base, name, id = randomUUID()) {
    const socket = await conn(base);
    const client = { socket, id, name, states: [], room: null, finishedSeen: false };
    attach(client, socket);
    socket.emit('initPlayer', id);
    return client;
}
function attach(client, socket) {
    client.socket = socket;
    socket.onAny((event, payload) => {
        if (event === 'codenamesState') {
            client.states.push(payload);
            if (payload && payload.phase === 'finished') client.finishedSeen = true;
            if (payload && payload.phase !== 'finished') client.finishedSeen = false;
        }
        if (event === 'roomUpdate') client.room = payload;
        auditPayload(client, event, payload);
    });
}
async function reconnect(base, client, roomId) {
    try { client.socket.close(); } catch (e) { /* ignore */ }
    const socket = await conn(base);
    const before = client.states.length;
    attach(client, socket);
    socket.emit('initPlayer', client.id);
    socket.emit('setRoom', { roomId, playerId: client.id });
    await waitFor(() => client.states.length > before, 8000, `resync ${client.name}`);
    return client.states[client.states.length - 1];
}
const last = c => c.states[c.states.length - 1];
const ctx = s => ({ step: s.step });

async function setupRoom(base, count, label) {
    const clients = [];
    for (let i = 0; i < count; i += 1) clients.push(await makeClient(base, `${label}${i}`));
    await delay(300);
    const host = clients[0];
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'สายลับคำใบ้', gameMode: 'codenames', maxPlayers: 12, codenamesClueSeconds: 45, codenamesGuessSeconds: 60 });
    assert(created && created.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    host.socket.emit('setRoom', { roomId, playerId: host.id });
    for (const c of clients.slice(1)) {
        const joined = await ack(c.socket, 'joinRoom', { roomId, playerId: c.id });
        assert(joined && joined.success, `${c.name} เข้าห้องไม่ได้: ` + JSON.stringify(joined));
        c.socket.emit('setRoom', { roomId, playerId: c.id });
    }
    await waitFor(() => host.room && host.room.players && host.room.players.filter(p => p.online).length === count, 8000, 'everyone online');
    return { clients, host, roomId };
}

function byRole(clients, team, role) {
    return clients.filter(c => { const s = last(c); return s && s.self && s.self.team === team && s.self.role === role; });
}
function pickClue(board, n) {
    const fake = { board: board.map(c => ({ word: c.word, revealed: c.revealed })) };
    const pool = ['ปริศนา', 'ความลับ', 'สวัสดี', 'ฮัลโหล', 'มหาสมุทร', 'วิเศษ', 'ลึกลับ', 'อลังการ', 'ตื่นเต้น', 'ขยัน', 'สนุกสนาน', 'เก่งมาก'];
    for (let i = 0; i < pool.length; i += 1) {
        const word = pool[(i + n) % pool.length];
        if (!engine.validateClueWord(fake, word)) return word;
    }
    throw new Error('หาคำใบ้ไม่ได้');
}
// เปิดการ์ดแบบที่ UI ทำ: เสนอก่อน (ถ้ายังไม่ได้เสนอ) แล้วค่อยกดเปิด
async function revealAs(c, index) {
    let s = last(c);
    if (!s.board[index].mine) {
        const p = await ack(c.socket, 'codenames_propose', { index, step: s.step });
        if (!p.success) return p;
        await waitFor(() => last(c).board[index].mine || last(c).board[index].revealed, 4000, 'propose ' + index);
    }
    s = last(c);
    if (s.board[index].revealed) return { success: true };
    return ack(c.socket, 'codenames_reveal', { index, step: s.step });
}
async function waitAllStep(clients, minStep, label) {
    await waitFor(() => clients.every(c => c.socket.disconnected || (last(c) && last(c).step >= minStep)), 8000, label);
}
function readStats() {
    const file = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    return Array.isArray(raw) ? raw : Object.values(raw);
}

(async () => {
    let server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const allClients = [];
    try {
        // ================= A: 4 คน =================
        const A = await setupRoom(base, 4, 'A');
        allClients.push(...A.clients);
        const [h, a1, a2, a3] = A.clients;
        assert(h.room.settings.codenamesClueSeconds === 120 && h.room.settings.codenamesGuessSeconds === 60, 'ตั้งเวลาแปลก ๆ ถูกปรับเป็นค่าที่อนุญาต: ' + JSON.stringify(h.room.settings));

        let r = await ack(h.socket, 'startGameFromLobby', { roomId: A.roomId });
        assert(r.success === false && /ยังไม่ได้เลือกทีม/.test(r.error), 'ยังไม่เลือกทีมต้องเริ่มไม่ได้: ' + JSON.stringify(r));
        r = await ack(a1.socket, 'codenames_shuffleTeams', {});
        assert(r.success === false && /หัวหน้าห้อง/.test(r.error), 'คนที่ไม่ใช่หัวห้องสุ่มทีมไม่ได้');
        assert((await ack(h.socket, 'codenames_pickTeam', { team: 'red', role: 'spymaster' })).success, 'หัวห้องเป็นหัวหน้าแดง');
        assert((await ack(a1.socket, 'codenames_pickTeam', { team: 'red', role: 'operative' })).success, 'a1 ลูกทีมแดง');
        assert((await ack(a2.socket, 'codenames_pickTeam', { team: 'blue', role: 'spymaster' })).success, 'a2 หัวหน้าน้ำเงิน');
        r = await ack(a3.socket, 'codenames_pickTeam', { team: 'blue', role: 'spymaster' });
        assert(r.success === false && /มีหัวหน้าแล้ว/.test(r.error), 'แย่งหัวหน้าไม่ได้');
        r = await ack(h.socket, 'startGameFromLobby', { roomId: A.roomId });
        assert(r.success === false && /ยังไม่ได้เลือกทีม: [^,]+ — /.test(r.error), 'ยังมีคนไม่เลือกทีม: ' + JSON.stringify(r));
        assert((await ack(a3.socket, 'codenames_pickTeam', { team: 'red', role: 'operative' })).success, 'a3 ลูกทีมแดง');
        r = await ack(h.socket, 'startGameFromLobby', { roomId: A.roomId });
        assert(r.success === false && r.error === 'ทีมน้ำเงินต้องมีลูกทีมอย่างน้อย 1 คน', 'ทีมไม่มีลูกทีม: ' + JSON.stringify(r));
        assert((await ack(a3.socket, 'codenames_pickTeam', { team: 'blue', role: 'operative' })).success, 'a3 ย้ายไปน้ำเงิน');
        r = await ack(h.socket, 'updateRoom', { codenamesClueSeconds: 90, codenamesGuessSeconds: 0 });
        assert(r.success, 'หัวห้องเปลี่ยนเวลาได้');
        r = await ack(h.socket, 'startGameFromLobby', { roomId: A.roomId });
        assert(r.success, 'ทีมครบแล้วเริ่มได้: ' + JSON.stringify(r));
        console.log('A1. เลือกทีม · บล็อกเริ่มพร้อมเหตุผลไทย · สิทธิ์สุ่มทีม · ตั้งเวลา ✓');

        await waitFor(() => A.clients.every(c => last(c) && last(c).status === 'playing'), 15000, 'A playing');
        let s = last(h);
        assert(s.self.role === 'spymaster' && s.keyVisible && s.board.every(c => c.color), 'หัวหน้าเห็นกุญแจทั้งกระดาน');
        assert(s.settings.clueSeconds === 90 && s.settings.guessSeconds === 0 && s.phaseEndsAt, 'นาฬิกาใบ้ตามที่ตั้ง');
        const counts = { red: s.board.filter(c => c.color === 'red').length, blue: s.board.filter(c => c.color === 'blue').length };
        assert(counts[s.startingTeam] === 9 && counts[s.startingTeam === 'red' ? 'blue' : 'red'] === 8, 'ทีมเริ่ม 9 อีกทีม 8');
        assert(!last(a1).keyVisible && last(a1).board.every(c => c.color === null), 'ลูกทีมไม่เห็นกุญแจ');
        const html = await (await fetch(`${base}/game/${A.roomId}?playerId=${a1.id}`)).text();
        assert(/cnBoard/.test(html) && !/"assassin"/.test(html) && !/"color":"(red|blue|neutral)"/.test(html), 'หน้า /game ของลูกทีมไม่ฝังกุญแจ');
        const htmlSm = await (await fetch(`${base}/game/${A.roomId}?playerId=${h.id}`)).text();
        assert(/"assassin"/.test(htmlSm), 'หน้า /game ของหัวหน้ามีกุญแจ');
        console.log('A2. เริ่มเกม 9/8 · กุญแจถึงหัวหน้าเท่านั้น (socket + HTML) ✓');

        const team1 = s.startingTeam;
        const team2 = team1 === 'red' ? 'blue' : 'red';
        const sm1 = byRole(A.clients, team1, 'spymaster')[0];
        const op1 = byRole(A.clients, team1, 'operative')[0];
        const sm2 = byRole(A.clients, team2, 'spymaster')[0];
        const op2 = byRole(A.clients, team2, 'operative')[0];
        s = last(sm1);
        // ผิดกติกา
        r = await ack(op1.socket, 'codenames_clue', { word: 'ลอง', number: 1, ...ctx(s) });
        assert(r.success === false && /เฉพาะหัวหน้า/.test(r.error), 'ลูกทีมใบ้ไม่ได้');
        r = await ack(sm2.socket, 'codenames_clue', { word: 'ลอง', number: 1, ...ctx(s) });
        assert(r.success === false && /ยังไม่ถึงตา/.test(r.error), 'หัวหน้าอีกทีมใบ้ไม่ได้');
        r = await ack(sm1.socket, 'codenames_clue', { word: s.board[0].word, number: 1, ...ctx(s) });
        assert(r.success === false && /อยู่บนกระดาน/.test(r.error), 'ใบ้คำบนกระดานไม่ได้');
        r = await ack(sm1.socket, 'codenames_clue', { word: 'สอง คำ', number: 1, ...ctx(s) });
        assert(r.success === false && /คำเดียว/.test(r.error), 'ใบ้สองคำไม่ได้');
        r = await ack(sm1.socket, 'codenames_clue', { word: 'ดี', number: 10, ...ctx(s) });
        assert(r.success === false && /0–9/.test(r.error), 'เลขเกิน 9 ไม่ได้');
        r = await ack(op1.socket, 'codenames_propose', { index: 0, ...ctx(s) });
        assert(r.success === false && /รอหัวหน้า/.test(r.error), 'ยังไม่ใบ้ห้ามแตะ');
        r = await ack(sm1.socket, 'codenames_clue', { word: 'ดี', number: 1, step: s.step - 1 });
        assert(r.success === false && /จังหวะ/.test(r.error), 'step เก่าโดนปฏิเสธ');

        const clue1 = pickClue(s.board, 0);
        r = await ack(sm1.socket, 'codenames_clue', { word: clue1, number: 1, ...ctx(s) });
        assert(r.success, 'ใบ้คำแรก: ' + JSON.stringify(r));
        await waitFor(() => last(op1).phase === 'guess' && last(op2).phase === 'guess', 5000, 'guess phase');
        s = last(op1);
        assert(s.clue.word === clue1 && s.clue.maxGuesses === 2 && s.self.canGuess && !last(op2).self.canGuess, 'ทุกคนเห็นคำใบ้ ลูกทีมตานั้นทายได้');
        r = await ack(sm1.socket, 'codenames_reveal', { index: 0, ...ctx(s) });
        assert(r.success === false && /หัวหน้าเปิด/.test(r.error), 'หัวหน้าเปิดเองไม่ได้');
        r = await ack(op2.socket, 'codenames_reveal', { index: 0, ...ctx(s) });
        assert(r.success === false && /ยังไม่ถึงตา/.test(r.error), 'อีกทีมเปิดไม่ได้');
        r = await ack(op1.socket, 'codenames_reveal', { index: 99, ...ctx(s) });
        assert(r.success === false && /ไม่พบการ์ด/.test(r.error), 'การ์ดนอกกระดาน');
        r = await ack(op1.socket, 'codenames_endTurn', ctx(s));
        assert(r.success === false && /อย่างน้อย 1 ใบ/.test(r.error), 'ยังไม่เปิดห้ามจบเทิร์น');
        console.log('A3. ผิดกติกา/ผิดสิทธิ์/ผิดตา/step เก่า ถูกปฏิเสธ ✓');

        // reconnect กลางเกม: ลูกทีม + หัวหน้า
        const opResync = await reconnect(base, op1, A.roomId);
        assert(opResync.status === 'playing' && opResync.phase === 'guess' && opResync.clue.word === clue1 && !opResync.keyVisible && opResync.self.canGuess, 'ลูกทีม reconnect ได้ state ครบ ไม่มีกุญแจ');
        const smResync = await reconnect(base, sm2, A.roomId);
        assert(smResync.keyVisible && smResync.board.every(c => c.color), 'หัวหน้า reconnect ได้กุญแจคืน');
        console.log('A4. รีเฟรช/หลุดแล้วกลับมา ได้ state ครบตามสิทธิ์ ✓');

        // เทิร์น 1: เปิดถูก 1 ใบ แล้วเปิดคนเดินถนน → จบเทิร์น
        const key = last(sm1).board;
        const own = key.filter(c => c.color === team1 && !c.revealed).map(c => c.index);
        const neutral = key.find(c => c.color === 'neutral').index;
        s = last(op1);
        r = await ack(op1.socket, 'codenames_propose', { index: own[0], ...ctx(s) });
        assert(r.success, 'ลูกทีมคนเดียวแตะเสนอได้');
        await waitFor(() => last(op1).board[own[0]].mine, 4000, 'propose state');
        s = last(op1);
        assert(s.board[own[0]].mine && !s.board[own[0]].revealed && s.votesNeeded === null, 'คนเดียว: แตะแล้วยังไม่เปิด ต้องกดยืนยัน');
        r = await ack(op1.socket, 'codenames_reveal', { index: own[0], ...ctx(s) });
        assert(r.success, 'กดเปิดเลยได้');
        await waitFor(() => last(op2).board[own[0]].revealed, 4000, 'reveal reaches everyone');
        assert(last(op2).board[own[0]].color === team1, 'ทุกคนเห็นสีการ์ดที่เปิดแล้ว');
        s = last(op1);
        r = await ack(op1.socket, 'codenames_reveal', { index: neutral, ...ctx(s) });
        assert(r.success === false && /เลือกการ์ดใบนี้ก่อน/.test(r.error) && !last(op1).board[neutral].revealed, 'เปิดใบที่ยังไม่ได้เสนอไม่ได้ (กันมือลั่น): ' + JSON.stringify(r));
        r = await revealAs(op1, neutral);
        assert(r.success, 'เปิดใบที่สอง');
        await waitFor(() => last(op2).currentTeam === team2 && last(op2).phase === 'clue', 4000, 'turn passes');
        assert(last(op2).clueLog.length === 1 && last(op2).clueLog[0].picks.length === 2 && last(op2).clueLog[0].endedBy === 'neutral', 'ประวัติคำใบ้ต่อทีม');

        // เทิร์น 2: อีกทีมใบ้ 9 แล้วเปิดครบ 8 → ชนะ
        s = last(sm2);
        r = await ack(sm2.socket, 'codenames_clue', { word: pickClue(s.board, 3), number: 9, ...ctx(s) });
        assert(r.success, 'ใบ้เทิร์น 2');
        const own2 = last(sm2).board.filter(c => c.color === team2 && !c.revealed).map(c => c.index);
        assert(own2.length === 8, 'ทีมที่สองมี 8 คำ');
        for (const index of own2) {
            await waitFor(() => last(op2).phase === 'guess' || last(op2).phase === 'finished', 4000, 'can guess');
            s = last(op2);
            r = await revealAs(op2, index);
            assert(r.success, 'เปิดการ์ดทีมตัวเอง: ' + JSON.stringify(r));
            await waitFor(() => last(op2).step > s.step, 4000, 'reveal state');
        }
        await waitFor(() => A.clients.every(c => last(c).phase === 'finished'), 6000, 'A finished');
        s = last(op1);
        assert(s.winner === team2 && s.winReason === 'words', 'ทีมที่เปิดครบชนะ');
        // หน้าจบของสายลับคำใบ้ค้าง ~30 วิ (เกมอื่น 10 วิ) · รีเฟรช/หลุดแล้วนับต่อจากเดิม ไม่เริ่มใหม่
        await waitFor(() => last(op1).returnLobbyEndsAt, 4000, 'return countdown');
        const endsAt = last(op1).returnLobbyEndsAt;
        const leftMs = endsAt - last(op1).serverNow;
        assert(leftMs > 25000 && leftMs <= 30000, 'สายลับคำใบ้: กลับห้องรอใน ~30 วิ (เหลือ ' + leftMs + ')');
        const finishedBack = await reconnect(base, op1, A.roomId);
        assert(finishedBack.phase === 'finished' && finishedBack.returnLobbyEndsAt === endsAt, 'รีเฟรชหน้าจบ: นับถอยหลังเดิม');
        assert(s.keyVisible && s.board.every(c => c.color), 'จบเกมเปิดกุญแจให้ทุกคน');
        console.log('A5. เล่นจนจบ: ผิดสีจบเทิร์น · เปิดครบ 8 ชนะ · จบแล้วเปิดกุญแจ ✓');

        // สถิติเซฟลงไฟล์แบบหน่วงเวลา — รอจนเขียนจริง (เครื่องช้าเกิน 1.2s ได้)
        await waitFor(() => readStats().some(x => x.playerId === sm2.id && x.modeStats?.codenames?.games >= 1), 15000, 'stats A saved');
        let rows = readStats();
        [sm2, op2].forEach(c => {
            const st = rows.find(x => x.playerId === c.id);
            assert(st && st.modeStats.codenames.games === 1 && st.modeStats.codenames.wins === 1, `${c.name} ได้ชนะ 1: ` + JSON.stringify(st && st.modeStats.codenames));
        });
        [sm1, op1].forEach(c => {
            const st = rows.find(x => x.playerId === c.id);
            assert(st && st.modeStats.codenames.losses === 1 && st.modeStats.codenames.wins === 0, `${c.name} แพ้ 1`);
        });
        assert(rows.find(x => x.playerId === sm2.id).gameHistory[0].mode === 'codenames', 'ประวัติเกมเป็นสายลับคำใบ้');
        console.log('A6. สถิติ: ทีมชนะได้ win ทุกคน ทีมแพ้ได้ loss ✓');

        const back = new Promise(res => h.socket.once('redirectToLobby', () => res(true)));
        r = await ack(h.socket, 'returnFinishedToLobby', { roomId: A.roomId });
        assert(r.success, 'หัวห้องพาทุกคนกลับห้องรอได้ทันที');
        assert(await Promise.race([back, delay(4000).then(() => false)]), 'ทุกคนถูกพากลับห้องรอ');
        await delay(400);
        assert(Object.keys(h.room.settings.codenamesTeams || {}).length === 4, 'ทีมเดิมยังอยู่หลังจบเกม');
        const beforeAgain = h.states.length;
        r = await ack(h.socket, 'startGameFromLobby', { roomId: A.roomId });
        assert(r.success, 'เล่นอีกตาได้: ' + JSON.stringify(r));
        await waitFor(() => h.states.length > beforeAgain && last(h).status === 'playing' && last(h).turnNumber === 1, 15000, 'new game');
        await delay(800);
        rows = readStats();
        assert(rows.find(x => x.playerId === sm2.id).modeStats.codenames.games === 1, 'สถิติไม่บันทึกซ้ำ');
        r = await ack(a1.socket, 'endTableSession', {});
        assert(r.success === false, 'คนที่ไม่ใช่หัวห้องจบเกมไม่ได้');
        r = await ack(h.socket, 'endTableSession', {});
        assert(r.success, 'หัวห้องจบเกมกลางคันได้');
        await delay(500);
        rows = readStats();
        assert(rows.find(x => x.playerId === sm2.id).modeStats.codenames.games === 1, 'จบกลางคันไม่นับสถิติ');
        console.log('A7. กลับห้องรอ → เล่นอีกตา (ทีมเดิม) · หัวห้องจบกลางคันไม่นับผล ✓');
        A.clients.forEach(c => { try { c.socket.close(); } catch (e) { /* ignore */ } });
        await delay(300);

        // ================= B: 12 คน =================
        const B = await setupRoom(base, 12, 'B');
        allClients.push(...B.clients);
        const spectator = B.clients[11];
        assert((await ack(spectator.socket, 'codenames_pickTeam', { role: 'spectator' })).success, 'เลือกเป็นผู้ชม');
        assert((await ack(B.host.socket, 'codenames_shuffleTeams', {})).success, 'หัวห้องสุ่มทีม');
        await delay(200);
        const picks = B.host.room.settings.codenamesTeams;
        assert(picks[spectator.id].role === 'spectator', 'ผู้ชมไม่ถูกสุ่มเข้าทีม');
        const redCount = Object.values(picks).filter(p => p.team === 'red').length;
        const blueCount = Object.values(picks).filter(p => p.team === 'blue').length;
        assert(Math.abs(redCount - blueCount) <= 1 && redCount + blueCount === 11, `สุ่มทีมสมดุล ${redCount}/${blueCount}`);
        r = await ack(B.host.socket, 'startGameFromLobby', { roomId: B.roomId });
        assert(r.success, 'เริ่ม 12 คน: ' + JSON.stringify(r));
        await waitFor(() => B.clients.every(c => last(c) && last(c).status === 'playing'), 15000, 'B playing');
        assert(last(spectator).self.role === 'spectator' && !last(spectator).keyVisible && !last(spectator).self.canGuess, 'ผู้ชมไม่เห็นกุญแจ ทายไม่ได้');
        console.log(`B1. 12 คน (${redCount}/${blueCount} + ผู้ชม 1) สุ่มทีม เริ่มเกม ✓`);

        let t1 = last(B.host).currentTeam;
        let t2 = t1 === 'red' ? 'blue' : 'red';
        let smB = byRole(B.clients, t1, 'spymaster')[0];
        let opsB = byRole(B.clients, t1, 'operative');
        s = last(smB);
        r = await ack(smB.socket, 'codenames_clue', { word: pickClue(s.board, 5), number: 2, ...ctx(s) });
        assert(r.success, 'ใบ้ทีมใหญ่');
        await waitFor(() => last(opsB[0]).phase === 'guess', 4000, 'B guess');
        const need = last(opsB[0]).votesNeeded;
        assert(need === Math.floor(opsB.length / 2) + 1, `ต้องได้เสียงข้างมาก ${need} จาก ${opsB.length}`);
        const target = last(smB).board.find(c => c.color === t1 && !c.revealed).index;
        for (let i = 0; i < need; i += 1) {
            s = last(opsB[i]);
            r = await ack(opsB[i].socket, 'codenames_propose', { index: target, ...ctx(s) });
            assert(r.success, 'เสนอการ์ด: ' + JSON.stringify(r));
            await waitFor(() => last(opsB[0]).board[target].revealed || last(opsB[0]).board[target].votes.length === i + 1, 4000, 'vote state');
            if (i < need - 1) {
                assert(!last(opsB[0]).board[target].revealed && last(opsB[0]).board[target].votes.length === i + 1, `${i + 1} เสียงยังไม่เปิด`);
            }
        }
        await waitFor(() => last(spectator).board[target].revealed, 4000, 'majority reveal');
        assert(last(spectator).board[target].color === t1, 'เสียงข้างมากเปิดการ์ด');
        console.log(`B2. โหวตเสียงข้างมาก ${need}/${opsB.length} เปิดเอง ✓`);

        // หัวหน้าทีมตาปัจจุบันหลุด → ตั้งคนใหม่หลังเวลาผ่อนผัน
        s = last(opsB[0]);
        r = await ack(opsB[0].socket, 'codenames_endTurn', ctx(s));
        assert(r.success, 'จบเทิร์นหลังเปิด 1 ใบ');
        await waitFor(() => last(spectator).currentTeam === t2, 4000, 'turn to t2');
        const smOld = byRole(B.clients, t2, 'spymaster')[0];
        smOld.socket.disconnect();
        await waitFor(() => {
            const v = last(spectator);
            return v.teams[t2].spymaster && v.teams[t2].spymaster.playerId !== smOld.id;
        }, GRACE_MS + 6000, 'promotion');
        const promotedId = last(spectator).teams[t2].spymaster.playerId;
        const promoted = B.clients.find(c => c.id === promotedId);
        await waitFor(() => last(promoted).keyVisible, 4000, 'promoted gets key');
        assert(last(spectator).history.some(h2 => /หลุดการเชื่อมต่อ/.test(h2.text) && /เป็นหัวหน้า/.test(h2.text)), 'แจ้งทุกคนว่าตั้งหัวหน้าใหม่');
        assert(!last(spectator).keyVisible, 'ผู้ชมยังไม่เห็นกุญแจหลังโปรโมต');
        const oldBack = await reconnect(base, smOld, B.roomId);
        assert(oldBack.self.role === 'retired' && oldBack.keyVisible && !oldBack.self.canGuess && !oldBack.self.canGiveClue, 'หัวหน้าเดิมกลับมา: ดูกุญแจได้ เล่นไม่ได้');
        console.log('B3. หัวหน้าหลุด → ลูกทีมออนไลน์เป็นหัวหน้าแทนอัตโนมัติ + แจ้งทุกคน ✓');

        // คนออกกลางเกม → เกมเดินต่อ
        const leaver = byRole(B.clients, t1, 'operative').slice(-1)[0];
        r = await ack(leaver.socket, 'leaveRoom', {});
        await waitFor(() => (last(spectator).teams[t1].members.find(m => m.playerId === leaver.id) || {}).left === true, 5000, 'leaver marked');
        assert(last(spectator).status === 'playing', 'คนออกแล้วเกมเดินต่อ');
        if (B.host !== leaver) {
            const hostWasAdmin = spectator.room.admin === B.host.id;
            r = await ack(B.host.socket, 'leaveRoom', {});
            await waitFor(() => spectator.room && spectator.room.admin !== B.host.id, 5000, 'admin transferred');
            assert(hostWasAdmin && last(spectator).status === 'playing', 'หัวห้องออกกลางเกม: โอนหัวห้อง เกมเดินต่อ');
            await delay(300);
        }
        console.log('B4. ผู้เล่น/หัวห้องออกกลางเกม เกมเดินต่อ ✓');

        // ทีมตาปัจจุบัน (t2) ไม่มีลูกทีมออนไลน์ → ข้ามเทิร์นเอง
        const t2ops = byRole(B.clients, t2, 'operative');
        t2ops.forEach(c => c.socket.disconnect());
        await waitFor(() => last(spectator).currentTeam === t1, GRACE_MS + 6000, 'auto pass');
        assert(last(spectator).history.some(h2 => /ไม่มีลูกทีมออนไลน์/.test(h2.text)), 'แจ้งว่าข้ามเพราะไม่มีลูกทีม');
        console.log('B5. ทีมไม่มีลูกทีมออนไลน์ → ข้ามเทิร์นเอง ✓');

        // t1 เปิดมือสังหาร → t2 ชนะ
        const gone = c => c.socket.disconnected || c === leaver || c === B.host;
        smB = B.clients.find(c => !gone(c) && last(c).teams[t1].spymaster && last(c).teams[t1].spymaster.playerId === c.id);
        opsB = byRole(B.clients, t1, 'operative').filter(c => !gone(c));
        s = last(smB);
        r = await ack(smB.socket, 'codenames_clue', { word: pickClue(s.board, 7), number: 'inf', ...ctx(s) });
        assert(r.success, 'ใบ้ ∞');
        await waitFor(() => last(opsB[0]).phase === 'guess', 4000, 'guess inf');
        assert(last(opsB[0]).clue.maxGuesses === null, '∞ ไม่จำกัด');
        const assassin = last(smB).board.find(c => c.color === 'assassin').index;
        r = await revealAs(opsB[0], assassin);
        assert(r.success, 'เปิดมือสังหาร');
        await waitFor(() => last(spectator).phase === 'finished', 5000, 'B finished');
        assert(last(spectator).winner === t2 && last(spectator).winReason === 'assassin', 'เปิดมือสังหาร = อีกทีมชนะ');
        // หัวหน้าที่ถูกตั้งใหม่อาจเป็นหัวห้องที่ออกไปใน B4 (ทีมสุ่ม) — คนที่ออกแล้วไม่นับสถิติ เลยเช็คคนในทีมที่ยังอยู่แทน
        const promotedLeft = promoted === B.host || promoted === leaver;
        const winnerToCheck = promotedLeft
            ? (last(spectator).teams[t2].members.find(m => !m.left && m.playerId !== B.host.id) || {}).playerId
            : promotedId;
        assert(winnerToCheck, 'มีคนในทีมชนะที่ยังอยู่ในห้อง');
        await waitFor(() => readStats().some(x => x.playerId === winnerToCheck && x.modeStats?.codenames?.wins >= 1), 15000, 'stats B saved');
        rows = readStats();
        assert(!rows.find(x => x.playerId === spectator.id && x.modeStats.codenames.games > 0), 'ผู้ชมไม่นับสถิติ');
        assert(!rows.find(x => x.playerId === leaver.id && x.modeStats.codenames.games > 0), 'คนที่ออกไปแล้วไม่นับสถิติ');
        const winnerStat = rows.find(x => x.playerId === winnerToCheck);
        assert(winnerStat && winnerStat.modeStats.codenames.wins === 1, 'ทีมชนะได้ win (รวมหัวหน้าที่ถูกตั้งใหม่)');
        if (promotedLeft) {
            assert(!rows.find(x => x.playerId === promotedId && x.modeStats.codenames.games > 0), 'หัวหน้าที่ออกไปแล้วไม่นับสถิติ');
        }
        console.log('B6. มือสังหาร = แพ้ทันที · สถิติไม่นับผู้ชม/คนที่ออก ✓');

        B.clients.forEach(c => { try { c.socket.close(); } catch (e) { /* ignore */ } });
        await delay(300);

        // ================= C: เซิร์ฟเวอร์รีสตาร์ตกลางเกม =================
        const C = await setupRoom(base, 4, 'C');
        allClients.push(...C.clients);
        assert((await ack(C.host.socket, 'codenames_shuffleTeams', {})).success, 'C สุ่มทีม');
        assert((await ack(C.host.socket, 'startGameFromLobby', { roomId: C.roomId })).success, 'C เริ่ม');
        await waitFor(() => C.clients.every(c => last(c) && last(c).status === 'playing'), 15000, 'C playing');
        const ct = last(C.host).currentTeam;
        const csm = byRole(C.clients, ct, 'spymaster')[0];
        const cop = byRole(C.clients, ct, 'operative')[0];
        s = last(csm);
        const cClue = pickClue(s.board, 9);
        assert((await ack(csm.socket, 'codenames_clue', { word: cClue, number: 2, ...ctx(s) })).success, 'C ใบ้');
        const boardBefore = last(csm).board.map(c => c.word + ':' + c.color).join(',');
        await delay(900);
        server.kill('SIGTERM');
        await new Promise(res => server.once('exit', res));
        server = await bootServer(PORT);
        const copBack = await reconnect(base, cop, C.roomId);
        const csmBack = await reconnect(base, csm, C.roomId);
        assert(copBack.status === 'playing' && copBack.phase === 'guess' && copBack.clue.word === cClue && copBack.self.canGuess && !copBack.keyVisible, 'รีสตาร์ตแล้วลูกทีมเล่นต่อได้ ไม่มีกุญแจ');
        assert(csmBack.keyVisible && csmBack.board.map(c => c.word + ':' + c.color).join(',') === boardBefore, 'รีสตาร์ตแล้วกระดาน/กุญแจเดิม');
        console.log('C1. เซิร์ฟเวอร์รีสตาร์ตกลางเกม กลับมาเล่นต่อได้ กระดานเดิม ✓');

        // C2: หัวห้องข้ามเทิร์นที่ค้าง (ลูกทีม AFK) — คนอื่นข้ามไม่ได้
        const cHost = (C.host === cop || C.host === csm) ? C.host : (await reconnect(base, C.host, C.roomId), C.host);
        const notHost = cop === cHost ? csm : cop;
        s = last(cHost);
        assert(s.isHost && s.hostSkipAfterMs === HOST_SKIP_MS && s.phaseStartedAt, 'หัวห้องได้ข้อมูลปุ่มข้ามเทิร์น');
        r = await ack(notHost.socket, 'codenames_hostSkip', ctx(last(notHost)));
        assert(r.success === false && /หัวหน้าห้อง/.test(r.error), 'คนที่ไม่ใช่หัวห้องข้ามเทิร์นไม่ได้: ' + JSON.stringify(r));
        await delay(HOST_SKIP_MS + 200);
        r = await ack(cHost.socket, 'codenames_hostSkip', ctx(last(cHost)));
        assert(r.success, 'หัวห้องข้ามเทิร์นที่ค้างได้: ' + JSON.stringify(r));
        await waitFor(() => last(cop).currentTeam !== ct && last(cop).phase === 'clue', 4000, 'skip passes turn');
        assert(last(cop).clueLog.slice(-1)[0].endedBy === 'host-skip' && last(cop).history.some(h2 => /ข้ามเทิร์น/.test(h2.text)), 'ทุกคนเห็นว่าหัวห้องข้าม');
        r = await ack(cHost.socket, 'codenames_hostSkip', ctx(last(cHost)));
        assert(r.success === false && /ค้างนานเกิน/.test(r.error), 'เพิ่งเปลี่ยนตา ข้ามทันทีไม่ได้');
        console.log('C2. หัวห้องข้ามเทิร์นที่ค้างได้ (หลังรอ) · คนอื่นข้ามไม่ได้ ✓');

        // โหมดอื่นยังกลับห้องใน 10 วิเหมือนเดิม — มีแค่สายลับคำใบ้ที่ประกาศ finishedReturnMs
        const { getGameEngine, getAvailableGameModes } = require('../games/engineRegistry');
        const modes = (getAvailableGameModes() || []).map(m => (typeof m === 'string' ? m : m.id || m.value || m.mode)).filter(Boolean);
        assert(modes.length >= 5 && modes.includes('codenames'), 'อ่านรายชื่อโหมดได้: ' + JSON.stringify(modes));
        modes.forEach(m => {
            const ms = (getGameEngine(m) || {}).finishedReturnMs;
            assert(m === 'codenames' ? ms === 30000 : ms === undefined, `โหมด ${m} finishedReturnMs = ${ms}`);
        });
        assert(/const FINISHED_RETURN_MS = 10000;/.test(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')), 'ค่ากลับห้องปกติยัง 10 วิ');
        console.log('C3. หน้าจบสายลับคำใบ้ 30 วิ · โหมดอื่น 10 วิเหมือนเดิม ✓');

        assert(leakChecks > 100, `ตรวจความลับ ${leakChecks} payload`);
        assert(!/\[codenames\].*failed/.test(server.logs()), 'server log มี error:\n' + server.logs().split('\n').filter(l => /codenames/.test(l)).slice(-5).join('\n'));
        console.log(`\n✅ smoke-codenames-play: ${checks} checks · ตรวจกุญแจรั่ว ${leakChecks} payload`);
    } finally {
        allClients.forEach(c => { try { c.socket.close(); } catch (e) { /* ignore */ } });
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
