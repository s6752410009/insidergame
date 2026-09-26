/**
 * เล่นคำใครไม่เหมือนจนจบผ่าน socket จริง (เซิร์ฟเวอร์ของตัวเอง, data ชั่วคราว)
 *
 * เกม 1: 5 คน พิมพ์คำใบ้ → โหวตสายแฝงออก → พลเมืองชนะ → สถิติ 1 ครั้ง → กลับห้องรอเอง
 * เกม 2: เปิด Mr. White 6 คน → คนหนึ่งหลุด/ออกกลางเกม → โหวต Mr. White → ทายถูก → Mr. White ชนะ
 * เกม 3: ไม่มีใครกดอะไรเลย → ทุกเฟสหมดเวลาเอง → เกมจบได้ไม่ค้าง
 * ทุกจังหวะเช็กว่า state ที่ส่งถึงแต่ละคนไม่มีคำ/บท/โหวตของคนอื่น
 *
 * รัน: npm run smoke:undercover:play
 */
const { DATA_DIR } = require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

const TIMERS = {
    UNDERCOVER_REVEAL_MS: '6000',
    UNDERCOVER_CLUE_MS: '2500',
    UNDERCOVER_VOTE_MS: '5000',
    UNDERCOVER_MRWHITE_MS: '5000',
    UNDERCOVER_RESULT_MS: '1500',
    UNDERCOVER_RETURN_MS: '3000'
};

async function getPort() {
    const preferred = Number(process.env.UNDERCOVER_PLAY_PORT) || 8451;
    return new Promise(res => {
        const s = require('net').createServer();
        s.once('error', () => {
            const t = require('net').createServer();
            t.listen(0, '127.0.0.1', () => { const { port } = t.address(); t.close(() => res(port)); });
        });
        s.listen(preferred, '127.0.0.1', () => s.close(() => res(preferred)));
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...TIMERS, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.getLogs = () => logs;
    });
}
function ack(s, e, p) {
    return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); });
}
function conn(base) {
    return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.once('connect', () => r(s)); });
}

async function makePlayer(base) {
    const socket = await conn(base);
    const id = randomUUID();
    socket.emit('initPlayer', id);
    const p = { socket, id, states: [], events: [] };
    socket.on('undercoverState', s => p.states.push(s));
    socket.on('redirectToLobby', () => p.events.push('redirectToLobby'));
    return p;
}
const last = p => p.states[p.states.length - 1];
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const v = fn();
        if (v) return v;
        await delay(60);
    }
    throw new Error('รอไม่ถึง: ' + label);
}

/** ความลับ: state ของแต่ละคนต้องไม่มีคำของอีกฝั่ง/บทของคนที่ยังรอด */
function checkSecrets(players, label) {
    const views = players.map(p => last(p)).filter(Boolean);
    if (!views.length || views[0].phase === 'finished') return;
    const words = new Set(views.map(v => v.self && v.self.word).filter(Boolean));
    views.forEach(view => {
        if (view.phase === 'finished') return;
        const json = JSON.stringify(view);
        words.forEach(word => {
            if (word === view.self.word) return;
            assert(!json.includes(`"${word}"`), `${label}: state ของผู้เล่นรั่วคำ "${word}" ที่ไม่ใช่ของตัวเอง`);
        });
        view.players.forEach(p => { if (p.alive) assert(p.role === null && p.word === null, `${label}: รั่วบท/คำของคนที่ยังรอด`); });
        assert(view.pair === null, `${label}: รั่วคู่คำก่อนจบ`);
        if (!view.self.isMrWhite && view.self.alive) assert(view.self.role === null, `${label}: บอกฝั่งให้ผู้เล่นรู้`);
    });
}

async function setupRoom(base, players, name, extra = {}) {
    const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name, gameMode: 'undercover', maxPlayers: 10, ...extra });
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(600);
    return roomId;
}

async function startAndWaitReveal(players, roomId) {
    players.forEach(p => { p.states.length = 0; });
    const started = await ack(players[0].socket, 'startGameFromLobby', { roomId });
    assert(started?.success, 'เริ่มเกมไม่ได้: ' + JSON.stringify(started));
    await waitFor(() => players.every(p => last(p)?.phase === 'reveal'), 8000, 'ทุกคนได้ state ช่วงดูคำ');
}

async function readyAll(players) {
    for (const p of players) {
        const v = last(p);
        if (v.phase !== 'reveal' || v.self.ready || !v.self.alive) continue;
        const res = await ack(p.socket, 'undercover_ready', { step: v.step });
        assert(res?.success, 'กดพร้อมไม่ได้: ' + JSON.stringify(res));
    }
    await waitFor(() => last(players[0])?.phase === 'clue', 4000, 'เข้าช่วงใบ้');
}

async function speakRound(players, withText) {
    let guard = 0;
    while (last(players[0]).phase === 'clue' && guard++ < 12) {
        const view = last(players[0]);
        const speaker = players.find(p => p.id === view.speakerId);
        await waitFor(() => last(speaker)?.step === view.step, 3000, 'state ของคนพูดมาถึง');
        const sv = last(speaker);
        const text = withText ? 'ใบ้ ' + guard : '';
        const res = await ack(speaker.socket, 'undercover_clueDone', { step: sv.step, text });
        assert(res?.success, 'พูดเสร็จไม่ได้: ' + JSON.stringify(res));
        await waitFor(() => last(players[0]).step !== view.step, 3000, 'คิวพูดขยับ');
    }
    await waitFor(() => last(players[0]).phase === 'vote', 3000, 'เข้าช่วงโหวต');
}

async function voteOut(players, targetId) {
    const alive = players.filter(p => last(p).self.alive);
    const step = last(players[0]).step;
    for (const p of alive) {
        await waitFor(() => last(p)?.step >= step, 3000, 'state โหวตมาถึง');
        const v = last(p);
        if (v.phase !== 'vote') break;
        const target = p.id === targetId ? alive.find(x => x.id !== targetId).id : targetId;
        const res = await ack(p.socket, 'undercover_vote', { step: v.step, targetPlayerId: target });
        assert(res?.success, 'โหวตไม่ได้: ' + JSON.stringify(res));
    }
}

function statsOf(id) {
    const file = path.join(DATA_DIR, 'playerStats.json');
    if (!fs.existsSync(file)) return null;
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    return all[id]?.modeStats?.undercover || null;
}

(async () => {
    const port = await getPort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const sockets = [];
    try {
        // ------------------------------------------------ game 1
        const g1 = [];
        for (let i = 0; i < 5; i++) g1.push(await makePlayer(base));
        g1.forEach(p => sockets.push(p.socket));
        await delay(400);
        const room1 = await setupRoom(base, g1, 'UC-Play-1');
        await startAndWaitReveal(g1, room1);
        const v0 = last(g1[0]);
        assert(v0.roleCounts.undercover === 1 && v0.roleCounts.mrWhite === 0, '5 คน = สายแฝง 1 ไม่มี Mr. White');
        const words = g1.map(p => last(p).self.word);
        const counts = words.reduce((m, w) => ({ ...m, [w]: (m[w] || 0) + 1 }), {});
        assert(Object.keys(counts).length === 2 && Object.values(counts).sort().join() === '1,4', 'คำต้องแบ่ง 4:1 ' + JSON.stringify(counts));
        checkSecrets(g1, 'reveal');
        console.log('1. เริ่มเกม 5 คน แจกคำ 4:1 ไม่รั่ว ✓');

        const stale = await ack(g1[1].socket, 'undercover_ready', { step: v0.step - 1 });
        assert(stale?.success === false && /จังหวะ/.test(stale.error), 'กดจากจอเก่าต้องถูกปัด');
        const noStep = await ack(g1[1].socket, 'undercover_ready', {});
        assert(noStep?.success === false, 'ไม่แนบ step ต้องถูกปัด');
        await readyAll(g1);
        checkSecrets(g1, 'clue');
        const clueView = last(g1[0]);
        const notSpeaker = g1.find(p => p.id !== clueView.speakerId);
        const cheat = await ack(notSpeaker.socket, 'undercover_clueDone', { step: last(notSpeaker).step });
        assert(cheat?.success === false, 'พูดแซงคิวต้องถูกปัด');
        const nonHost = g1.slice(1).find(p => p.id !== clueView.speakerId);
        const skipDenied = await ack(nonHost.socket, 'undercover_skipSpeaker', { step: last(nonHost).step });
        assert(skipDenied?.success === false, 'คนที่ไม่ใช่หัวห้องข้ามตาไม่ได้');
        console.log('2. ปัดคำสั่งเก่า / แซงคิว / ข้ามตาโดยไม่ใช่หัวห้อง ✓');

        await speakRound(g1, true);
        assert(last(g1[3]).clues.length >= 4, 'คำใบ้ที่พิมพ์ต้องเห็นทุกคน');
        const ucWord = Object.keys(counts).find(w => counts[w] === 1);
        const uc = g1.find(p => last(p).self.word === ucWord);
        const selfVote = await ack(g1[0].socket, 'undercover_vote', { step: last(g1[0]).step, targetPlayerId: g1[0].id });
        assert(selfVote?.success === false, 'โหวตตัวเองต้องไม่ได้');
        const voter = g1.find(p => p.id !== uc.id);
        await ack(voter.socket, 'undercover_vote', { step: last(voter).step, targetPlayerId: uc.id });
        await delay(250);
        checkSecrets(g1, 'vote');
        const peer = g1.find(p => p.id !== voter.id);
        assert(last(peer).self.voteTargetId === null && last(voter).self.voteTargetId === uc.id, 'เห็นโหวตแค่ของตัวเอง');
        const dup = await ack(voter.socket, 'undercover_vote', { step: last(voter).step, targetPlayerId: uc.id });
        assert(dup?.success === false, 'โหวตซ้ำไม่ได้');
        await voteOut(g1.filter(p => p.id !== voter.id), uc.id);
        await waitFor(() => last(g1[0]).phase === 'finished', 4000, 'เกม 1 จบ');
        const f1 = last(g1[2]);
        assert(f1.winner.team === 'civilians', 'พลเมืองต้องชนะ');
        assert(f1.pair && f1.players.every(p => p.role), 'จบแล้วเปิดคำและบททุกคน');
        console.log('3. ใบ้ครบ → โหวตสายแฝงออก → พลเมืองชนะ ✓');

        for (let i = 0; i < 4; i++) g1.forEach(p => p.socket.emit('undercover_requestState', { roomId: room1, playerId: p.id }));
        await delay(900);
        g1.forEach(p => {
            const s = statsOf(p.id);
            assert(s && s.games === 1, 'สถิติต้องบันทึกครั้งเดียว: ' + JSON.stringify(s));
            assert(s.wins === (p.id === uc.id ? 0 : 1), 'ชนะ/แพ้ตามฝั่ง');
        });
        console.log('4. สถิติบันทึกครั้งเดียว ชนะ/แพ้ตามฝั่ง ✓');

        await waitFor(() => g1.every(p => p.events.includes('redirectToLobby')), 6000, 'พากลับห้องรอหลังจบ');
        const lobbyRes = await fetch(`${base}/room/${room1}?playerId=${g1[1].id}`, { redirect: 'manual' });
        assert(!((lobbyRes.headers.get('location') || '').includes('/game/')), 'จบแล้วต้องกลับห้องรอได้');
        console.log('5. จบเกมแล้วพาทุกคนกลับห้องรอเอง ✓');

        // ------------------------------------------------ game 2 (Mr. White, leave, reconnect)
        const extra = [];
        for (let i = 0; i < 2; i++) extra.push(await makePlayer(base));
        extra.forEach(p => sockets.push(p.socket));
        for (const p of extra) {
            assert((await ack(p.socket, 'joinRoom', { roomId: room1, playerId: p.id }))?.success, 'join เกม 2 ไม่ได้');
            p.socket.emit('setRoom', { roomId: room1, playerId: p.id });
        }
        const g2 = g1.concat(extra); // 7 คน
        const before = {};
        g2.forEach(p => { before[p.id] = statsOf(p.id) || { games: 0, wins: 0, losses: 0 }; });
        const toggled = await ack(g2[0].socket, 'updateRoom', { undercoverMrWhite: true });
        assert(toggled?.success && toggled.room.settings.undercoverMrWhite === true, 'หัวห้องเปิด Mr. White ได้');
        await delay(400);
        await startAndWaitReveal(g2, room1);
        const v2 = last(g2[0]);
        assert(v2.roleCounts.undercover === 2 && v2.roleCounts.mrWhite === 1, '7 คน = สายแฝง 2 + Mr. White');
        const mw = g2.find(p => last(p).self.isMrWhite);
        assert(mw && last(mw).self.word === null && last(mw).self.role?.id === 'mrwhite', 'Mr. White รู้ตัวและไม่มีคำ');
        checkSecrets(g2, 'reveal-2');

        // คนหนึ่ง (ไม่ใช่ Mr. White/หัวห้อง) ออกจากห้องกลางเกม
        const leaver = g2.find(p => p !== mw && p !== g2[0] && last(p).self.word === last(g2[0]).self.word) || g2.find(p => p !== mw && p !== g2[0]);
        await ack(leaver.socket, 'leaveRoom', {});
        const g2in = g2.filter(p => p !== leaver);
        await waitFor(() => last(g2[0]).players.find(p => p.playerId === leaver.id)?.left, 3000, 'คนออกถูกนับว่าออก');
        console.log('6. เกม 2: 7 คน สายแฝง 2 + Mr. White · คนออกกลางเกมถูกตัดออก ✓');

        // รีคอนเนกต์: ต่อ socket ใหม่แล้วได้คำเดิมคืน
        const recon = g2in.find(p => p !== mw && p !== g2[0]);
        const oldWord = last(recon).self.word;
        recon.socket.close();
        const fresh = await conn(base);
        sockets.push(fresh);
        recon.socket = fresh;
        recon.states.length = 0;
        fresh.on('undercoverState', s => recon.states.push(s));
        fresh.on('redirectToLobby', () => recon.events.push('redirectToLobby'));
        fresh.emit('initPlayer', recon.id);
        fresh.emit('setRoom', { roomId: room1, playerId: recon.id });
        fresh.emit('undercover_requestState', { roomId: room1, playerId: recon.id });
        await waitFor(() => last(recon)?.self, 3000, 'รีคอนเนกต์แล้วได้ state');
        assert(last(recon).self.word === oldWord, 'รีคอนเนกต์แล้วต้องได้คำเดิม');
        console.log('7. หลุดแล้วต่อใหม่ได้คำเดิมคืน ✓');

        await readyAll(g2in);
        await speakRound(g2in, false);
        assert(last(g2in[0]).speakerOrder.length === 0, 'พูดครบแล้ว');
        await voteOut(g2in, mw.id);
        await waitFor(() => last(mw).phase === 'mrwhite' && last(mw).self.canGuess, 4000, 'Mr. White ได้ทาย');
        const bystander = g2in.find(p => p !== mw);
        const steal = await ack(bystander.socket, 'undercover_mrWhiteGuess', { step: last(bystander).step, guess: 'x' });
        assert(steal?.success === false, 'คนอื่นทายแทน Mr. White ไม่ได้');
        const civWord = last(g2in.find(p => p !== mw && !last(p).self.isMrWhite)).self.word;
        // หาคำพลเมืองจากคำที่คนส่วนใหญ่ได้
        const tally = {};
        g2in.forEach(p => { const w = last(p).self.word; if (w) tally[w] = (tally[w] || 0) + 1; });
        const majority = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || civWord;
        const guessRes = await ack(mw.socket, 'undercover_mrWhiteGuess', { step: last(mw).step, guess: '  ' + majority.toUpperCase() + ' ' });
        assert(guessRes?.success, 'Mr. White ทายไม่ได้: ' + JSON.stringify(guessRes));
        await waitFor(() => last(g2in[0]).phase === 'finished', 3000, 'เกม 2 จบ');
        assert(last(g2in[0]).winner.team === 'mrwhite' && last(g2in[0]).winner.winnerIds.join() === mw.id, 'Mr. White ทายถูกชนะคนเดียว');
        await delay(700);
        const delta = id => { const a = statsOf(id) || {}; const b = before[id]; return { games: a.games - b.games, wins: a.wins - b.wins }; };
        assert(delta(leaver.id).games === 1 && delta(leaver.id).wins === 0, 'คนออกกลางเกมยังถูกนับเป็นแพ้: ' + JSON.stringify(delta(leaver.id)));
        assert(delta(mw.id).games === 1 && delta(mw.id).wins === 1, 'Mr. White ได้ชนะ');
        g2in.filter(p => p !== mw).forEach(p => assert(delta(p.id).games === 1 && delta(p.id).wins === 0, 'คนอื่นแพ้หมด (บันทึกครั้งเดียว)'));
        console.log('8. โหวต Mr. White → ทายถูก (ไม่สนช่องว่าง/ตัวพิมพ์) → Mr. White ชนะ · คนออกนับแพ้ ✓');

        // ------------------------------------------------ game 3 (timeouts only)
        const g3 = [];
        for (let i = 0; i < 4; i++) g3.push(await makePlayer(base));
        g3.forEach(p => sockets.push(p.socket));
        await delay(300);
        const room3 = await setupRoom(base, g3, 'UC-Play-AFK');
        await startAndWaitReveal(g3, room3);
        const seen = new Set();
        const endAt = Date.now() + 90000;
        while (Date.now() < endAt && last(g3[0]).phase !== 'finished') {
            seen.add(last(g3[0]).phase);
            await delay(150);
        }
        const f3 = last(g3[0]);
        assert(f3.phase === 'finished', 'ไม่มีใครกดอะไรเลย เกมต้องจบเองได้ (phase=' + f3.phase + ')');
        ['reveal', 'clue', 'vote', 'elimination'].forEach(ph => assert(seen.has(ph), 'หมดเวลาต้องผ่านเฟส ' + ph));
        assert(f3.winner.team === 'undercover', 'โต๊ะ AFK จบให้ฝ่ายแฝงรอด');
        console.log('9. โต๊ะ AFK: ทุกเฟสหมดเวลาเอง เกมจบไม่ค้าง ✓');

        assert(!/\[undercover\].*failed/.test(server.getLogs()), 'เซิร์ฟเวอร์ต้องไม่มี error ของโหมดนี้');
        console.log(`\n✅ คำใครไม่เหมือนเล่นผ่าน socket ครบ 3 เกม (${checks} checks)`);
    } finally {
        sockets.forEach(s => { try { s.close(); } catch {} });
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
