/**
 * คลื่นความคิด — โหมดแข่งทีม + ร่วมมือ เล่นผ่าน socket จริงจนจบ
 *   A) ตั้งค่าห้อง: ค่าเริ่มต้น = แข่งทีม · หัวห้องเปลี่ยนโหมดได้ · คนอื่นแก้ไม่ได้ · ค่าเพี้ยน = แข่งทีม
 *   B) แข่งทีม 5 คน: เข็มร่วมกระจายสด (wavelengthDial) · ทีมโน้นหมุนไม่ได้ · ตกลงครบ = ล็อก ·
 *      ทาย ⬅️/➡️ · แต้มทีม · ตาพิเศษ · ถึง 10 จบ · สถิติทั้งทีม · ไม่มีเป้ารั่ว
 *   C) ร่วมมือ 3 คน (เลือกแข่งทีมแต่คนไม่พอ) 7 การ์ด + โบนัส จนจบ
 * รัน: npm run smoke:wavelength:teams:play   (SMOKE_PORT=8853 ค่าเริ่มต้น)
 */
const path = require('path');
const fs = require('fs');

const TMP_ROOT = path.join(__dirname, '..', '..', '..', 'tmpdata-wavelength');
const TMP = path.join(TMP_ROOT, `teams-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
process.env.GAME_DATA_DIR = TMP;
process.env.WALLETS_FILE = path.join(TMP, 'wallets.json');
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
require('./isolateTestData');

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const T = { CLUE: 6000, GUESS: 6000, TEAM_GUESS: 8000, LR: 5000, REVEAL: 4000, SKIP: 900, GRACE: 1500 };
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
            WAVELENGTH_GRACE_MS: String(T.GRACE),
            WAVELENGTH_TEAM_GUESS_MS: String(T.TEAM_GUESS),
            WAVELENGTH_LR_MS: String(T.LR)
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
        if (s.phase === 'clue' || s.phase === 'guess' || s.phase === 'leftright') {
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
    const p = { socket, id, name, states: [], dials: [], room: null, roomId: null };
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
        if (ev === 'wavelengthDial') p.dials.push(payload);
        if (ev === 'roomUpdate') p.room = payload;
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
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'คลื่นความคิด', gameMode: 'wavelength', maxPlayers: opts.maxPlayers || 12, ...(opts.mode ? { wavelengthMode: opts.mode } : {}) });
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


function readStats() {
    const file = path.join(TMP, 'playerStats.json');
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    return Array.isArray(raw) ? raw : Object.values(raw);
}
const live = players => players.filter(p => p.socket.connected);
async function waitPhase(players, phases, ms, label) {
    await waitFor(() => live(players).every(p => last(p) && phases.includes(last(p).phase)), ms, label);
}

/** ตาเดียว (แข่งทีม/ร่วมมือ) · aim: 'bull' = หมุนตรงเป้า · ตัวเลข = ห่างเป้าเท่านั้น · side: ทีมโน้นโหวต */
async function playSharedTurn(players, { aim = 'bull', side = 'auto', checkDial = false } = {}) {
    await waitPhase(players, ['clue'], 8000, 'clue');
    const s0 = last(live(players)[0]);
    const giver = players.find(p => p.id === s0.giverId);
    let r = await ack(giver.socket, 'wavelength_pickCard', { index: 0, ...ctx(last(giver)) });
    assert(r.success, 'เลือกการ์ด ' + JSON.stringify(r));
    await waitFor(() => last(giver).card, 3000, 'card');
    r = await ack(giver.socket, 'wavelength_clue', { text: 'ทะเลสาบหน้าหนาว', ...ctx(last(giver)) });
    if (!r.success) r = await ack(giver.socket, 'wavelength_clue', { text: 'แมวส้ม', ...ctx(last(giver)) });
    assert(r.success, 'คำใบ้ ' + JSON.stringify(r));
    await waitPhase(players, ['guess'], 4000, 'guess');
    const target = knownTargets.get(`${giver.roomId}:${s0.round}`);
    assert(typeof target === 'number', 'รู้เป้าจากจอผู้ใบ้');
    const gs = last(giver);
    const guessers = players.filter(p => last(p).self && last(p).self.isGuesser);
    const opponents = players.filter(p => (gs.opponentIds || []).includes(p.id));
    assert(guessers.length >= 1 && guessers.every(p => p.id !== giver.id), 'มีคนหมุนเข็ม ไม่ใช่ผู้ใบ้');
    assert(guessers.every(p => last(p).availableActions.canDial && !last(p).availableActions.canGuess), 'คนในทีม: หมุนเข็มร่วม');
    const off = aim === 'bull' ? 2 : aim; // เป๊ะ = ห่าง 2 (ยังอยู่แถบ 4 · ทีมโน้นทายซ้าย/ขวาถูกได้)
    const dial = target < 50 ? target + off : target - off;
    const mover = guessers[0];
    if (checkDial) {
        // ทีมโน้นหมุนไม่ได้ · ผู้ใบ้หมุนไม่ได้
        if (opponents[0]) {
            r = await ack(opponents[0].socket, 'wavelength_pin', { value: 3, ...ctx(last(opponents[0])) });
            assert(!r.success && /ทีมโน้น/.test(r.error), 'ทีมโน้นหมุนไม่ได้');
        }
        r = await ack(giver.socket, 'wavelength_pin', { value: 3, ...ctx(last(giver)) });
        assert(!r.success, 'ผู้ใบ้หมุนไม่ได้');
        const watchers = players.filter(p => p !== mover);
        watchers.forEach(p => { p.dials = []; });
        r = await ack(mover.socket, 'wavelength_pin', { value: 12.5, ...ctx(last(mover)) });
        assert(r.success, 'หมุนเข็ม');
        await waitFor(() => watchers.every(p => p.dials.some(d => d.value === 12.5 && d.by === mover.id)), 3000, 'dial broadcast');
        if (guessers[1]) {
            r = await ack(guessers[1].socket, 'wavelength_lock', { value: 12.5, ...ctx(last(guessers[1])) });
            assert(r.success, 'ตกลง');
            await waitFor(() => last(mover).agreeIds.includes(guessers[1].id), 3000, 'agree visible');
            r = await ack(mover.socket, 'wavelength_pin', { value: 40, ...ctx(last(mover)) });
            await waitFor(() => last(guessers[1]).agreeIds.length === 0 && last(guessers[1]).dial === 40, 3000, 'move clears agree');
        }
    }
    r = await ack(mover.socket, 'wavelength_pin', { value: dial, ...ctx(last(mover)) });
    assert(r.success, 'หมุนไปที่เล็ง');
    for (const p of guessers) {
        const res = await ack(p.socket, 'wavelength_lock', { value: dial, ...ctx(last(p)) });
        if (!res.success && !['guess'].includes(last(p).phase)) break;
        assert(res.success, 'ตกลง ' + JSON.stringify(res));
    }
    if (last(giver).variant === 'teams') {
        await waitPhase(players, ['leftright'], 4000, 'leftright');
        assert(Math.abs(last(opponents[0]).dial - dial) < 0.051 && last(opponents[0]).target === null, 'ทีมโน้นเห็นเข็มที่ล็อก ไม่เห็นเป้า');
        const correct = target < dial ? 'left' : 'right';
        const choice = side === 'auto' ? correct : side;
        for (const p of opponents) {
            if (last(p).phase !== 'leftright') break;
            const res = await ack(p.socket, 'wavelength_vote', { side: choice, ...ctx(last(p)) });
            assert(res.success || last(p).phase !== 'leftright', 'โหวต ' + JSON.stringify(res));
        }
    }
    await waitPhase(players, ['reveal'], 6000, 'reveal');
    const lr = last(live(players)[0]).lastRound;
    assert(lr.target === target && Math.abs(lr.dial - dial) < 0.051, 'ผลเปิดตรงเป้า/เข็ม');
    return { lr, giver, target, dial };
}
async function next(admin, players) {
    const s = last(admin);
    const r = await ack(admin.socket, 'wavelength_next', ctx(s));
    assert(r.success, 'ต่อ ' + JSON.stringify(r));
    await waitFor(() => live(players).every(p => ['clue', 'finished'].includes(last(p).phase) && last(p).round >= s.round), 5000, 'next');
}

(async () => {
    const port = Number(process.env.SMOKE_PORT) || 8853;
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const everyone = [];
    try {
        // ================= A: ตั้งค่าห้อง =================
        const B = await setupRoom(base, 5, { maxPlayers: 8 });
        everyone.push(...B.players);
        const [host, b1] = B.players;
        await waitFor(() => host.room && host.room.settings, 3000, 'room payload');
        assert(host.room.settings.wavelengthMode === 'teams', 'ค่าเริ่มต้น = แข่งทีม');
        let r = await ack(b1.socket, 'updateRoom', { wavelengthMode: 'solo' });
        assert(!r.success, 'คนอื่นเปลี่ยนโหมดไม่ได้');
        r = await ack(host.socket, 'updateRoom', { wavelengthMode: 'coop' });
        assert(r.success, 'หัวห้องเปลี่ยนเป็นร่วมมือ');
        await waitFor(() => b1.room && b1.room.settings.wavelengthMode === 'coop', 3000, 'mode coop');
        r = await ack(host.socket, 'updateRoom', { wavelengthMode: 'hack' });
        await waitFor(() => b1.room.settings.wavelengthMode === 'teams', 3000, 'mode sanitized');
        console.log('1. ตั้งค่าห้อง: ค่าเริ่มต้นแข่งทีม · หัวห้องเปลี่ยนได้ · คนอื่นไม่ได้ · ค่าเพี้ยน = แข่งทีม ✓');

        // ================= B: แข่งทีม 5 คน =================
        assert((await ack(host.socket, 'startGameFromLobby', { roomId: B.roomId }))?.success, 'start B');
        await waitPhase(B.players, ['clue'], 8000, 'B clue');
        let s = last(host);
        assert(s.variant === 'teams' && s.teams.length === 2, 'เริ่มแข่งทีม');
        const sizes = s.teams.map(t => t.members.length).sort();
        assert(sizes.join() === '2,3', `แบ่งทีม 2/3 (${sizes})`);
        const start = s.activeTeam;
        assert(s.teams.find(t => t.id === start).score === 0 && s.teams.find(t => t.id !== start).score === 1, 'ทีมแรก 0 · อีกทีม 1');
        assert(B.players.every(p => last(p).self.team), 'ทุกคนรู้ทีมตัวเอง');

        // ตาแรก: เช็กเข็มร่วม + ทีมโน้นทายถูก
        let t1 = await playSharedTurn(B.players, { aim: 9, side: 'auto', checkDial: true });
        assert(t1.lr.points === 3 && t1.lr.lr.points === 1, `ใกล้มาก 3 + ทีมโน้นทายถูก 1 (ได้ ${t1.lr.points}/${t1.lr.lr.points})`);
        s = last(host);
        assert(s.teams.find(t => t.id === start).score === 3 && s.teams.find(t => t.id !== start).score === 2, 'แต้มทีมตรง');
        console.log('2. เข็มร่วมกระจายสด · ทีมโน้น/ผู้ใบ้หมุนไม่ได้ · หมุน = ล้าง ✅ · ตกลงครบ = ล็อก · ทาย ⬅️/➡️ +1 ✓');

        // เล่นจนจบ: ทีมโน้นเป๊ะทุกตา (ทีมโน้นทายผิดตลอด) — ระหว่างทางเจอตาพิเศษ
        let turns = 1;
        let sawCatchUp = false;
        let sawBlocked = false;
        while (last(host).phase !== 'finished' && turns < 30) {
            await next(host, B.players);
            if (last(host).phase === 'finished') break;
            const st = last(host);
            const behind = st.teams.find(t => t.id === st.activeTeam).score < st.teams.find(t => t.id !== st.activeTeam).score;
            const aim = st.activeTeam === start ? 25 : 'bull';
            const turn = await playSharedTurn(B.players, { aim });
            if (aim === 'bull') {
                assert(turn.lr.points === 4 && turn.lr.lr.points === 0, 'เป๊ะ 4 · ทีมโน้นได้ 0');
                if (turn.lr.lr.correct) sawBlocked = true;
                const after = last(host).lastRound.scores;
                const me = after[st.activeTeam];
                const them = after[st.activeTeam === 'A' ? 'B' : 'A'];
                if (me < them && !turn.lr.end) {
                    assert(turn.lr.catchUpNext, 'เป๊ะแต่ยังตามหลัง = ตาพิเศษ');
                    sawCatchUp = true;
                }
                if (behind && me >= them) assert(!turn.lr.catchUpNext, 'แซงแล้วไม่ได้ตาพิเศษ');
            }
            turns += 1;
        }
        await next(host, B.players).catch(() => {});
        await waitPhase(B.players, ['finished'], 6000, 'B finished');
        const fin = last(b1);
        const other = start === 'A' ? 'B' : 'A';
        assert(fin.winnerTeam === other, 'ทีมที่เป๊ะทุกตาชนะ');
        assert(fin.teams.find(t => t.id === other).score >= 10, 'ทีมชนะ 10+');
        assert(sawBlocked, 'เจอเคสเป๊ะแล้วทีมโน้นทายถูกแต่ไม่ได้แต้ม');
        assert(fin.standings.every(row => row.won === (row.team === other)), 'อันดับ: ทั้งทีมชนะ');
        await delay(800);
        const stats = readStats();
        fin.standings.forEach(row => {
            const st = stats.find(x => x.playerId === row.playerId);
            assert(st && st.modeStats?.wavelength?.games === 1, `สถิติ ${row.name}`);
            assert((st.modeStats.wavelength.wins === 1) === row.won, 'ชนะ/แพ้ตามทีม');
        });
        console.log(`3. เล่น ${turns} ตา · ทีมชนะถึง 10 · เป๊ะ = ทีมโน้น 0 · ตาพิเศษ ${sawCatchUp ? 'เจอ' : 'ไม่เจอ'} · สถิติทั้งทีม ✓`);

        // ================= C: 3 คนเลือกแข่งทีม = ร่วมมือ =================
        const C = await setupRoom(base, 3, { maxPlayers: 3 });
        everyone.push(...C.players);
        assert((await ack(C.host.socket, 'startGameFromLobby', { roomId: C.roomId }))?.success, 'start C');
        await waitPhase(C.players, ['clue'], 8000, 'C clue');
        assert(last(C.host).variant === 'coop' && last(C.host).coop.total === 7, '3 คน = ร่วมมือ 7 การ์ด');
        let rounds = 0;
        let bonus = 0;
        while (last(C.host).phase !== 'finished' && rounds < 12) {
            const aim = rounds < 2 ? 'bull' : 30;
            const t = await playSharedTurn(C.players, { aim });
            if (aim === 'bull') { assert(t.lr.gained === 3 && t.lr.coop.bonusNow, 'เป๊ะ = 3 + โบนัส'); bonus += 1; }
            rounds += 1;
            await next(C.host, C.players);
        }
        await waitPhase(C.players, ['finished'], 6000, 'C finished');
        const cf = last(C.players[2]);
        assert(rounds === 7 + bonus && cf.coop.score === 6, `ร่วมมือ ${rounds} รอบ ได้ ${cf.coop.score}`);
        assert(cf.coopRank === 'ลองปิดแล้วเปิดใหม่' && cf.standings.every(x => !x.won), 'ตารางคะแนน 4–6 · ยังไม่ชนะ');
        console.log(`4. 3 คน = ร่วมมือ · ${rounds} รอบ (7 + โบนัส ${bonus}) · ${cf.coop.score} แต้ม “${cf.coopRank}” ✓`);

        checkLeaks(everyone);
        assert(leakChecks > 40, `ตรวจความลับพอ (${leakChecks})`);
        assert(!/\[wavelength\].*failed/.test(server.logs()), 'server log error:\n' + server.logs().split('\n').filter(l => /wavelength/.test(l)).slice(-5).join('\n'));
        assert(!/\[socket:wavelength/.test(server.logs()), 'socket handler พัง');
        console.log(`5. ตรวจ payload ${leakChecks} ครั้ง (รวมช่วงซ้าย/ขวา) — ไม่มีเป้ารั่ว ✓`);
        everyone.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });
        console.log(`\n✅ smoke-wavelength-teams-play: ${checks} checks passed`);
    } finally {
        server.kill('SIGTERM');
        await delay(300);
        try { server.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
