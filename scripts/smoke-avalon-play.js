/**
 * อวาลอน — เล่นจริงผ่าน socket จนจบหลายเกม (เปิดเซิร์ฟเวอร์เอง)
 *
 * รัน: npm run smoke:avalon:play
 *  - 5 คน: ฝ่ายดีชนะ (มือสังหารแทงพลาด) · ฝ่ายร้ายชนะ (แทงถูกเมอร์ลิน) · ฝ่ายร้ายชนะ (คัดค้าน 5 ครั้ง)
 *  - 7 คน (+เพอร์ซิวัล/มอร์กานา): ฝ่ายดีชนะ (ภารกิจ 4 ล้ม 1 ใบยังสำเร็จ) · ฝ่ายร้ายชนะ (ภารกิจ 4 ล้ม 2 ใบ)
 *  - 6 คน: หัวหน้าออกกลางเกม → ส่งต่อ · เหลือ 4 คน → ยกเลิกไม่นับสถิติ
 *  - ตรวจทุก state ที่ส่งถึงแต่ละคน: ห้ามมีบทของคนอื่นก่อนจบ · สถิติบันทึกครั้งเดียวต่อเกม
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { checks += 1; if (!c) throw new Error(m); }

async function getFreePort() {
    if (process.env.AVALON_PORT) return Number(process.env.AVALON_PORT);
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.on('exit', code => { if (code) rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

const latest = p => p.states[p.states.length - 1];

/** ทุก state ที่ส่งถึงผู้เล่นคนนี้: ห้ามเห็นบทคนอื่นก่อนจบ */
function checkLeaks(p) {
    p.states.slice(p.checked || 0).forEach(state => {
        if (!state || state.mode !== 'avalon' || !Array.isArray(state.players)) return;
        if (state.phase !== 'finished') {
            state.players.forEach(other => {
                assert(other.role === null && other.team === null, `${p.name}: เห็นบทของ ${other.name} ก่อนจบ (phase=${state.phase})`);
            });
            assert(!('votes' in state) && !('questCards' in state) && !('seats' in state), `${p.name}: state มีข้อมูลดิบหลุด`);
        }
        if (state.self) {
            (state.self.knowledge || []).forEach(k => {
                assert(Object.keys(k).sort().join(',') === 'name,playerId,tag', 'knowledge ต้องไม่แนบบท');
            });
        }
    });
    p.checked = p.states.length;
}

async function makeTable(base, count, label) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        const socket = await conn(base);
        const id = randomUUID();
        socket.emit('initPlayer', id);
        const entry = { socket, id, name: `${label}${i + 1}`, states: [], returnEvents: [] };
        socket.on('avalonState', s => entry.states.push(s));
        socket.on('returnToLobby', d => entry.returnEvents.push(d));
        players.push(entry);
    }
    await delay(400);
    const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name: `อวาลอน ${label}`, gameMode: 'avalon', maxPlayers: 10 });
    assert(created?.success, 'สร้างห้องอวาลอนไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        const joined = await ack(p.socket, 'joinRoom', { roomId, playerId: p.id });
        assert(joined?.success, 'join ไม่ได้: ' + JSON.stringify(joined));
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(500);
    return { roomId, players };
}

async function startGame(table, roles) {
    if (roles) {
        const updated = await ack(table.players[0].socket, 'updateRoom', { avalonRoles: roles });
        assert(updated?.success, 'ตั้งบทเสริมไม่ได้: ' + JSON.stringify(updated));
    }
    table.players.forEach(p => { p.states.length = 0; p.checked = 0; });
    const started = await ack(table.players[0].socket, 'startGameFromLobby', { roomId: table.roomId });
    assert(started?.success, 'เริ่มเกมไม่ได้: ' + JSON.stringify(started));
    await waitFor(() => table.players.every(p => latest(p)?.phase === 'night'), 'ทุกคนต้องได้ state กลางคืน', 8000);
    const roleOf = {};
    table.players.forEach(p => { roleOf[p.id] = latest(p).self.role.id; p.role = latest(p).self.role.id; p.team = latest(p).self.team; });
    return roleOf;
}

async function waitFor(pred, message, ms = 6000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pred()) return;
        await delay(40);
    }
    throw new Error('รอไม่ไหว: ' + message);
}

const byId = (table, id) => table.players.find(p => p.id === id);

// state ถูกส่งให้ทีละ socket — ก่อนอ่านข้อมูลของ "คนอื่น" (หัวหน้า/มือสังหาร) ต้องรอให้ทุกคนได้ step ล่าสุดก่อน
// ไม่งั้นเทสจะอ่าน state เก่าของคนที่ข้อความยังมาไม่ถึง (พังแบบสุ่มเมื่อเซิร์ฟเวอร์ช้า)
async function settle(table) {
    await waitFor(() => {
        const live = table.players.filter(p => !p.gone && latest(p));
        const top = Math.max(...live.map(p => Number(latest(p).step) || 0));
        return live.every(p => Number(latest(p).step) === top);
    }, 'ทุกคนต้องได้ state รอบเดียวกัน');
}
const view = table => latest(table.players.find(p => latest(p) && !p.gone) || table.players[0]);

/** ส่งคำสั่งแล้วรอจน step เปลี่ยน/ทุกคนได้ state ใหม่ */
async function act(p, event, payload) {
    const res = await ack(p.socket, event, { ...payload, step: latest(p).step });
    assert(res && res.success, `${p.name} ${event} ไม่ผ่าน: ${JSON.stringify(res)}`);
    return res;
}

async function nightAll(table) {
    for (const p of table.players) {
        if (p.gone) continue;
        await act(p, 'avalon_ready', {});
    }
    await waitFor(() => view(table).phase === 'team', 'หลังกลางคืนต้องเข้าเลือกทีม');
}

/**
 * เล่นภารกิจหนึ่งรอบ
 * teamPicker(state) → teamIds · voter(p) → 'approve'|'reject' · carder(p) → 'success'|'fail'
 */
async function playRound(table, { teamPicker, voter = () => 'approve', carder = () => 'success' }) {
    await settle(table);
    const st = view(table);
    assert(st.phase === 'team', 'ต้องอยู่ช่วงเลือกทีม ได้ ' + st.phase);
    const leader = byId(table, st.leaderId);
    assert(latest(leader).self.canPickTeam, 'หัวหน้าต้องเห็นว่าเลือกทีมได้');
    const others = table.players.filter(p => p.id !== leader.id && !p.gone);
    assert(others.every(p => !latest(p).self.canPickTeam), 'คนอื่นต้องเลือกทีมไม่ได้');
    // คนที่ไม่ใช่หัวหน้าส่งทีม = ถูกปฏิเสธ
    const bad = await ack(others[0].socket, 'avalon_team', { teamIds: [others[0].id], step: latest(others[0]).step });
    assert(bad && !bad.success, 'ไม่ใช่หัวหน้าต้องส่งทีมไม่ได้');
    const teamIds = teamPicker(st);
    await act(leader, 'avalon_team', { teamIds });
    await waitFor(() => view(table).phase === 'vote', 'ส่งทีมแล้วต้องเข้าโหวต');

    const voteStep = view(table).step;
    for (const p of table.players) {
        if (p.gone) continue;
        await act(p, 'avalon_vote', { vote: voter(p) });
    }
    await waitFor(() => view(table).step !== voteStep, 'โหวตครบต้องเปิดผล');
    const after = view(table);
    assert(after.lastVote && after.lastVote.votes.length === table.players.filter(p => !p.gone).length, 'เปิดผลโหวตทุกคน');
    if (after.phase !== 'quest') return after;

    const questStep = after.step;
    for (const id of after.proposal.teamIds) {
        const p = byId(table, id);
        if (!p || p.gone) continue;
        const card = carder(p);
        if (p.team === 'good') {
            const denied = await ack(p.socket, 'avalon_quest', { card: 'fail', step: latest(p).step });
            assert(denied && !denied.success && /ฝ่ายดี/.test(denied.error), 'ฝ่ายดีต้องลงล้มไม่ได้ (เซิร์ฟเวอร์บังคับ)');
        }
        await act(p, 'avalon_quest', { card });
    }
    await waitFor(() => view(table).step !== questStep, 'ลงการ์ดครบต้องสรุปภารกิจ');
    // ux: ทีมของภารกิจที่จบแล้วเป็นข้อมูลสาธารณะ ทุกคนย้อนดูได้ (สรุปภารกิจ)
    await settle(table);
    const doneQuest = view(table).quests[after.questIndex];
    assert(doneQuest.result && JSON.stringify(doneQuest.teamIds) === JSON.stringify(after.proposal.teamIds), 'สรุปภารกิจต้องบอกทีมที่ออก');
    assert(doneQuest.leaderId === after.proposal.leaderId, 'สรุปภารกิจต้องบอกหัวหน้าที่เสนอ');
    assert(view(table).quests.filter(q => !q.result).every(q => q.teamIds.length === 0 && q.leaderId === null), 'ภารกิจที่ยังไม่จบต้องไม่มีทีม');
    return view(table);
}

function pickTeam(table, st, { evil = 0 } = {}) {
    const size = st.currentQuest.size;
    const evils = table.players.filter(p => p.team === 'evil' && !p.gone).map(p => p.id);
    const goods = table.players.filter(p => p.team === 'good' && !p.gone).map(p => p.id);
    return [...evils.slice(0, evil), ...goods].slice(0, size);
}

async function assassinate(table, targetPred) {
    await waitFor(() => view(table).phase === 'assassin', 'ต้องเข้าเฟสลอบสังหาร');
    await settle(table);
    const st = view(table);
    const assassin = byId(table, st.assassinId);
    assert(assassin && assassin.role === 'assassin', 'มือสังหารตัวจริงเป็นคนเลือก');
    assert(table.players.filter(p => p.id !== assassin.id).every(p => latest(p).assassinTargets.length === 0), 'รายชื่อเป้าไปถึงมือสังหารเท่านั้น');
    const targets = latest(assassin).assassinTargets;
    const target = table.players.find(p => targets.includes(p.id) && targetPred(p));
    assert(target, 'หาเป้าไม่เจอ');
    const nonAssassin = table.players.find(p => p.id !== assassin.id);
    const denied = await ack(nonAssassin.socket, 'avalon_assassinate', { targetId: target.id, step: latest(nonAssassin).step });
    assert(denied && !denied.success, 'คนอื่นแทงแทนไม่ได้');
    await act(assassin, 'avalon_assassinate', { targetId: target.id });
    await waitFor(() => view(table).phase === 'finished', 'แทงแล้วต้องจบเกม');
    return view(table);
}

function readStats() {
    const file = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function expectStats(table, expected, label) {
    const stats = readStats();
    table.players.forEach(p => {
        const row = stats[p.id]?.modeStats?.avalon || { games: 0, wins: 0, losses: 0 };
        const exp = expected[p.id];
        assert(row.games === exp.games && row.wins === exp.wins, `${label}: สถิติ ${p.name} ต้องเป็น ${JSON.stringify(exp)} ได้ ${JSON.stringify(row)}`);
    });
}

async function finishAndReturn(table, tally, winnerTeam) {
    const st = view(table);
    assert(st.phase === 'finished' && st.winner && st.winner.team === winnerTeam, `ต้องจบด้วย ${winnerTeam} ชนะ ได้ ${JSON.stringify(st.winner)}`);
    table.players.forEach(p => checkLeaks(p));
    const finalView = latest(table.players[0]);
    assert(finalView.players.every(x => x.role && x.team), 'จบเกมต้องเปิดบททุกคน');
    if (tally) {
        table.players.forEach(p => {
            tally[p.id] = tally[p.id] || { games: 0, wins: 0 };
            tally[p.id].games += 1;
            if (p.team === winnerTeam) tally[p.id].wins += 1;
        });
    }
    // ขอ state ซ้ำหลายครั้ง — สถิติต้องไม่ถูกบันทึกซ้ำ
    for (const p of table.players) p.socket.emit('avalon_requestState', {});
    await delay(900);
    if (tally) expectStats(table, tally, 'หลังจบเกม');
    // หน้าจบเกมค้าง ~30 วิ (engine.finishedReturnMs) ไม่ใช่ 10 วิแบบเดิม
    const ret = table.players[0].returnEvents[table.players[0].returnEvents.length - 1];
    assert(ret && ret.countdown === 30 && ret.endsAt - Date.now() > 20000, 'returnToLobby ต้องนับ 30 วิ: ' + JSON.stringify(ret));
    table.players.forEach(p => { p.returnEvents.length = 0; });
    // คนที่ไม่ใช่หัวห้องพาทั้งวงกลับไม่ได้ (ได้ canReturnSelf ให้กลับคนเดียว) — หัวห้องทำได้
    const denied = await ack(table.players[1].socket, 'returnFinishedToLobby', { roomId: table.roomId });
    assert(denied && !denied.success && denied.canReturnSelf, 'ผู้เล่นทั่วไปพาทุกคนกลับห้องได้: ' + JSON.stringify(denied));
    const back = await ack(table.players[0].socket, 'returnFinishedToLobby', { roomId: table.roomId });
    assert(back?.success, 'กลับห้องรอไม่ได้: ' + JSON.stringify(back));
    await delay(600);
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    try {
        /* ---------------- 5 คน ---------------- */
        const t5 = await makeTable(base, 5, 'ห้า');
        const tally5 = {};

        // เกม 1: ฝ่ายดีทำครบ 3 → มือสังหารแทงพลาด → ฝ่ายดีชนะ
        let roles = await startGame(t5);
        assert(Object.values(roles).filter(r => r === 'merlin').length === 1 && Object.values(roles).filter(r => r === 'assassin').length === 1, '5 คนต้องมีเมอร์ลิน+มือสังหาร');
        const merlin5 = t5.players.find(p => p.role === 'merlin');
        const merlinKnow = latest(merlin5).self.knowledge.map(k => k.playerId).sort();
        const evil5 = t5.players.filter(p => p.team === 'evil').map(p => p.id).sort();
        assert(JSON.stringify(merlinKnow) === JSON.stringify(evil5), 'เมอร์ลินผ่าน socket เห็นฝ่ายร้ายครบ');
        t5.players.filter(p => p.role === 'loyal').forEach(p => assert(latest(p).self.knowledge.length === 0, 'อัศวินผู้ภักดีไม่รู้อะไร'));
        await nightAll(t5);
        for (let q = 0; q < 3; q += 1) {
            const st = await playRound(t5, { teamPicker: s => pickTeam(t5, s) });
            if (q < 2) assert(st.phase === 'team' && st.successCount === q + 1, 'ภารกิจสำเร็จนับถูก');
        }
        await assassinate(t5, p => p.team === 'good' && p.role !== 'merlin');
        await finishAndReturn(t5, tally5, 'good');
        console.log('1. 5 คน: ฝ่ายดีสำเร็จ 3 + มือสังหารแทงพลาด → ฝ่ายดีชนะ ✓');

        // เกม 2: ฝ่ายดีทำครบ 3 แต่มือสังหารแทงถูก → ฝ่ายร้ายชนะ
        roles = await startGame(t5);
        await nightAll(t5);
        await playRound(t5, { teamPicker: s => pickTeam(t5, s) });
        // ภารกิจ 2: ฝ่ายร้ายเข้าทีมแล้วลงล้ม
        let st = await playRound(t5, { teamPicker: s => pickTeam(t5, s, { evil: 1 }), carder: p => (p.team === 'evil' ? 'fail' : 'success') });
        assert(st.quests[1].result === 'fail' && st.lastQuest.failCount === 1, 'ภารกิจ 2 ล้ม 1 ใบ');
        await playRound(t5, { teamPicker: s => pickTeam(t5, s) });
        await playRound(t5, { teamPicker: s => pickTeam(t5, s) });
        await assassinate(t5, p => p.role === 'merlin');
        await finishAndReturn(t5, tally5, 'evil');
        console.log('2. 5 คน: มือสังหารแทงถูกเมอร์ลิน → ฝ่ายร้ายชนะ ✓');

        // เกม 3: คัดค้าน 5 ครั้งติด → ฝ่ายร้ายชนะ
        await startGame(t5);
        await nightAll(t5);
        const leaders = [];
        for (let i = 0; i < 5; i += 1) {
            leaders.push(view(t5).leaderId);
            await playRound(t5, { teamPicker: s => pickTeam(t5, s), voter: () => 'reject' });
        }
        assert(new Set(leaders).size === 5, 'หัวหน้าเวียนครบ 5 คน');
        assert(view(t5).winner?.reason === 'rejects', 'จบเพราะคัดค้าน 5 ครั้ง');
        await finishAndReturn(t5, tally5, 'evil');
        console.log('3. 5 คน: คัดค้าน 5 ครั้งติด → ฝ่ายร้ายชนะทันที ✓');

        /* ---------------- 7 คน + เพอร์ซิวัล/มอร์กานา ---------------- */
        const t7 = await makeTable(base, 7, 'เจ็ด');
        const tally7 = {};
        roles = await startGame(t7, ['percival', 'morgana']);
        const perc = t7.players.find(p => p.role === 'percival');
        const percKnow = latest(perc).self.knowledge.map(k => k.playerId).sort();
        const expectedPerc = t7.players.filter(p => p.role === 'merlin' || p.role === 'morgana').map(p => p.id).sort();
        assert(JSON.stringify(percKnow) === JSON.stringify(expectedPerc), 'เพอร์ซิวัลเห็นเมอร์ลิน+มอร์กานา');
        const morgana = t7.players.find(p => p.role === 'morgana');
        assert(latest(morgana).self.knowledge.length === 2, 'ฝ่ายร้าย 3 คนเห็นกันเอง 2 คน');
        assert(latest(t7.players[0]).quests[3].failsNeeded === 2, '7 คน ภารกิจ 4 ต้องล้ม 2 ใบ');
        assert(latest(t7.players[0]).lady === null, 'ค่าเริ่มต้น: ไม่มีนางแห่งทะเลสาบ');

        // เกม 4: ฝ่ายดีชนะ — ภารกิจ 4 มีการ์ดล้ม 1 ใบแต่ยังสำเร็จ
        await nightAll(t7);
        await playRound(t7, { teamPicker: s => pickTeam(t7, s) });
        await playRound(t7, { teamPicker: s => pickTeam(t7, s) });
        st = await playRound(t7, { teamPicker: s => pickTeam(t7, s, { evil: 1 }), carder: p => (p.team === 'evil' ? 'fail' : 'success') });
        assert(st.quests[2].result === 'fail', 'ภารกิจ 3 ล้ม');
        st = await playRound(t7, { teamPicker: s => pickTeam(t7, s, { evil: 1 }), carder: p => (p.team === 'evil' ? 'fail' : 'success') });
        assert(st.quests[3].result === 'success' && st.quests[3].failCount === 1, 'ภารกิจ 4 ล้ม 1 ใบ = ยังสำเร็จ (7 คน)');
        await assassinate(t7, p => p.team === 'good' && p.role !== 'merlin');
        await finishAndReturn(t7, tally7, 'good');
        console.log('4. 7 คน: ภารกิจ 4 ล้ม 1 ใบยังสำเร็จ + แทงพลาด → ฝ่ายดีชนะ ✓');

        // เกม 5: ฝ่ายร้ายชนะ — ภารกิจ 4 ล้ม 2 ใบ
        await startGame(t7, ['percival', 'morgana']);
        await nightAll(t7);
        await playRound(t7, { teamPicker: s => pickTeam(t7, s, { evil: 1 }), carder: p => (p.team === 'evil' ? 'fail' : 'success') });
        await playRound(t7, { teamPicker: s => pickTeam(t7, s) });
        await playRound(t7, { teamPicker: s => pickTeam(t7, s, { evil: 1 }), carder: p => (p.team === 'evil' ? 'fail' : 'success') });
        st = await playRound(t7, { teamPicker: s => pickTeam(t7, s, { evil: 2 }), carder: p => (p.team === 'evil' ? 'fail' : 'success') });
        assert(st.phase === 'finished' && st.quests[3].result === 'fail' && st.quests[3].failCount === 2, 'ภารกิจ 4 ล้ม 2 ใบ = ล้มเหลว');
        assert(st.winner.reason === 'quests', 'ฝ่ายร้ายชนะด้วยภารกิจล้ม 3');
        await finishAndReturn(t7, tally7, 'evil');
        console.log('5. 7 คน: ภารกิจ 4 ล้ม 2 ใบ → ล้มครบ 3 → ฝ่ายร้ายชนะ ✓');

        /* ---------------- 7 คน + นางแห่งทะเลสาบ ---------------- */
        const tL = await makeTable(base, 7, 'ทะเลสาบ');
        const notHost = await ack(tL.players[1].socket, 'updateRoom', { avalonLady: true });
        assert(notHost && !notHost.success, 'คนที่ไม่ใช่หัวห้องเปิดนางแห่งทะเลสาบไม่ได้');
        const ladyOn = await ack(tL.players[0].socket, 'updateRoom', { avalonLady: 'yes-please' });
        assert(ladyOn?.success && ladyOn.room.settings.avalonLady === false, 'ค่าแปลก ๆ ถูก sanitize เป็นปิด');
        const ladyOn2 = await ack(tL.players[0].socket, 'updateRoom', { avalonLady: true });
        assert(ladyOn2?.success && ladyOn2.room.settings.avalonLady === true, 'หัวห้องเปิดนางแห่งทะเลสาบได้');
        await startGame(tL);
        let lv = latest(tL.players[0]);
        assert(lv.lady && lv.lady.holderId && lv.lady.checks.length === 0, 'เริ่มเกมมีคนถือนางแห่งทะเลสาบ');
        const seatIds = lv.players.map(p => p.playerId);
        await nightAll(tL);
        const firstLeader = view(tL).leaderId;
        assert(seatIds[(seatIds.indexOf(firstLeader) - 1 + seatIds.length) % seatIds.length] === lv.lady.holderId, 'คนถือคนแรก = ทางขวาของหัวหน้าคนแรก');
        await playRound(tL, { teamPicker: s => pickTeam(tL, s) });
        assert(view(tL).phase === 'team', 'หลังภารกิจ 1 ยังไม่ส่อง');
        await playRound(tL, { teamPicker: s => pickTeam(tL, s) });
        await waitFor(() => view(tL).phase === 'lady', 'หลังภารกิจ 2 ต้องเข้าเฟสนางแห่งทะเลสาบ');
        await settle(tL);
        const holderL = byId(tL, view(tL).lady.holderId);
        assert(latest(holderL).self.canUseLady && latest(holderL).ladyTargets.length === 6, 'คนถือเห็นรายชื่อ 6 คน');
        assert(tL.players.filter(p => p !== holderL).every(p => latest(p).ladyTargets.length === 0 && !latest(p).self.canUseLady), 'รายชื่อส่องไปถึงคนถือคนเดียว');
        const victim = tL.players.find(p => p !== holderL && p.team === 'evil') || tL.players.find(p => p !== holderL);
        const notHolder = tL.players.find(p => p !== holderL && p !== victim);
        const deniedLady = await ack(notHolder.socket, 'avalon_lady', { targetId: victim.id, step: latest(notHolder).step });
        assert(deniedLady && !deniedLady.success, 'คนไม่ถือส่องไม่ได้');
        const selfLady = await ack(holderL.socket, 'avalon_lady', { targetId: holderL.id, step: latest(holderL).step });
        assert(selfLady && !selfLady.success, 'ส่องตัวเองไม่ได้');
        const staleLady = await ack(holderL.socket, 'avalon_lady', { targetId: victim.id, step: latest(holderL).step - 1 });
        assert(staleLady && !staleLady.success, 'step เก่าส่องไม่ได้ (anti-replay)');
        await act(holderL, 'avalon_lady', { targetId: victim.id });
        await waitFor(() => view(tL).phase === 'team', 'ส่องแล้วไปเลือกทีม');
        await settle(tL);
        const hv = latest(holderL);
        assert(hv.self.ladyResults.length === 1 && hv.self.ladyResults[0].team === victim.team, 'คนส่องเห็นฝ่ายจริงของเป้า');
        assert(hv.players.find(p => p.playerId === victim.id).ladySeen === victim.team, 'ที่นั่งเป้าติดผลส่อง (เฉพาะคนส่อง)');
        tL.players.filter(p => p !== holderL).forEach(p => {
            const v = latest(p);
            assert(v.self.ladyResults.length === 0 && v.players.every(x => x.ladySeen === null), `${p.name} ต้องไม่เห็นผลส่อง`);
            assert(v.lady.holderId === victim.id && v.lady.checks.length === 1 && !('team' in v.lady.checks[0]), 'ทุกคนรู้แค่ว่าใครส่องใคร');
            const raw = JSON.stringify(v);
            assert(!raw.includes('"team":"' + victim.team + '","targetId"') && !/"checks":\[[^\]]*"team"/.test(raw), 'ฝ่ายของเป้าไม่หลุดใน payload คนอื่น');
        });
        tL.players.forEach(p => checkLeaks(p));
        // ภารกิจ 3 สำเร็จ → ฝ่ายดีครบ 3 → ลอบสังหาร (ไม่ส่องอีกเพราะเกมตัดสินแล้ว)
        await playRound(tL, { teamPicker: s => pickTeam(tL, s) });
        await waitFor(() => view(tL).phase === 'assassin', 'สำเร็จครบ 3 → ลอบสังหาร ไม่ส่องอีก');
        await settle(tL);
        const assassinL = byId(tL, view(tL).assassinId);
        const targetsL = latest(assassinL).assassinTargets;
        assert(targetsL.length === 4 && targetsL.every(id => byId(tL, id).team === 'good'), 'มือสังหารแทงได้เฉพาะฝ่ายดี 4 คน');
        assert(latest(assassinL).self.knowledge.length === 2, 'ช่วงลอบสังหาร ฝ่ายร้ายเห็นกันครบ');
        await assassinate(tL, p => p.team === 'good' && p.role !== 'merlin');
        await finishAndReturn(tL, null, 'good');
        console.log('5b. 7 คน + นางแห่งทะเลสาบ: เปิด/ปิดได้เฉพาะหัวห้อง · ส่องหลังภารกิจ 2 · ผลลับถึงคนส่องคนเดียว · ท่าผิดถูกปฏิเสธ · ส่งต่อ ✓');

        /* ---------------- 6 คน: ออกกลางเกม ---------------- */
        const t6 = await makeTable(base, 6, 'หก');
        await startGame(t6);
        await nightAll(t6);
        const leaderId = view(t6).leaderId;
        const leader = byId(t6, leaderId);
        const seatOrder = latest(t6.players[0]).players.map(p => p.playerId);
        const nextLeader = seatOrder[(seatOrder.indexOf(leaderId) + 1) % seatOrder.length];
        const left = await ack(leader.socket, 'leaveRoom', {});
        assert(left?.success !== false, 'ออกห้องไม่ได้');
        leader.gone = true;
        await waitFor(() => view(t6).leaderId === nextLeader, 'หัวหน้าออก → ส่งต่อคนถัดไป');
        assert(view(t6).phase === 'team' && view(t6).players.find(p => p.playerId === leaderId).left, 'คนที่ออกถูกทำเครื่องหมาย');
        const second = t6.players.find(p => !p.gone && p.id !== view(t6).leaderId);
        await ack(second.socket, 'leaveRoom', {});
        second.gone = true;
        await waitFor(() => view(t6).phase === 'finished', 'เหลือ 4 คน → ยกเลิกเกม');
        assert(view(t6).winner.abandoned && view(t6).winner.team === null, 'ยกเลิก ไม่มีฝ่ายชนะ');
        await delay(800);
        const stats = readStats();
        t6.players.forEach(p => assert(!(stats[p.id]?.modeStats?.avalon?.games), 'เกมที่ยกเลิกต้องไม่นับสถิติ'));
        t6.players.filter(p => !p.gone).forEach(p => checkLeaks(p));
        console.log('6. 6 คน: หัวหน้าออก → ส่งต่อ · เหลือ 4 → ยกเลิก ไม่นับสถิติ ✓');

        // สรุปสถิติรวมอีกรอบ (ไม่ซ้ำหลังหลายเกม)
        expectStats(t5, tally5, 'สรุป 5 คน');
        expectStats(t7, tally7, 'สรุป 7 คน');
        console.log('7. สถิติ ชนะ/แพ้ตามฝ่าย บันทึกครั้งเดียวต่อเกม ✓');

        // หน้าเกมเรนเดอร์ได้ (ไม่มี error ฝั่งเซิร์ฟเวอร์)
        await startGame(t5);
        const page = await fetch(`${base}/game/${t5.roomId}?playerId=${t5.players[2].id}`);
        const html = await page.text();
        assert(page.status === 200 && html.includes('id="avSeats"'), 'หน้าเกมอวาลอนต้องเรนเดอร์ได้ (HTTP ' + page.status + ' ' + page.url + ')');
        const otherRoles = t5.players.filter(p => p.id !== t5.players[2].id).map(p => p.role);
        const selfRole = t5.players[2].role;
        // HTML ของผู้เล่น 3 ต้องไม่มี role object ผูกกับ playerId คนอื่น
        t5.players.filter(p => p.id !== t5.players[2].id).forEach(p => {
            assert(!html.includes(`"playerId":"${p.id}","role"`), 'HTML หน้าเกมห้ามฝังบทคนอื่น');
        });
        assert(selfRole && otherRoles.length === 4, 'บทครบ');
        console.log('8. หน้าเกมเรนเดอร์ได้ และไม่ฝังบทของคนอื่นใน HTML ✓');

        [t5, t7, t6, tL].forEach(t => t.players.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } }));
        console.log(`\n✅ avalon socket playthrough: ผ่าน ${checks} เช็ก`);
    } finally {
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
