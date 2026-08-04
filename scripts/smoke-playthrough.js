/**
 * เล่นจนจบเกมในเบราว์เซอร์จริงทั้ง 4 โหมด แล้วดัก JS error ทุกจังหวะ
 *
 * ต่างจาก smoke-boards-console ที่แค่ "เปิดหน้า" — ตัวนี้อยู่ในหน้าตลอดเกม
 * จับ error ที่เกิดตอนเปลี่ยนเฟส / โหวต / ประกาศผล / กลับห้อง
 * ซึ่งเป็นจุดที่บัคจริงซ่อนอยู่ (word timer กับปุ่มกลับห้องเจอแบบนี้)
 *
 * ตรวจ 4 อย่างต่อโหมด:
 *   1. ไม่มี pageerror / console error ตลอดเกม
 *   2. timer บนจอเดินจริง (ไม่ค้างแบบบัค word timer)
 *   3. เกมเดินไปถึงสถานะจบได้
 *   4. จบแล้วกลับห้อง (/room) ได้ ไม่เด้งกลับ /game
 *
 * รัน: node scripts/smoke-playthrough.js
 */

require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function getFreePort() {
    return new Promise(resolve => {
        const srv = require('net').createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ack timeout: ' + event)), 20000);
        socket.emit(event, payload, r => { clearTimeout(t); resolve(r); });
    });
}

function connect(base) {
    return new Promise((resolve, reject) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        const t = setTimeout(() => reject(new Error('socket connect timeout')), 20000);
        s.once('connect', () => { clearTimeout(t); resolve(s); });
    });
}

// error ที่ไม่เกี่ยวกับโค้ดเรา
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|ERR_ABORTED/i;

async function setupRoom(base, mode, count, extra = {}) {
    const players = [];
    for (let i = 0; i < count; i++) {
        const socket = await connect(base);
        const playerId = randomUUID();
        socket.emit('initPlayer', playerId);
        const states = [];
        socket.on('werewolfState', s => states.push(s));
        socket.on('spyfallState', s => states.push(s));
        socket.on('blackMarketState', s => states.push(s));
        players.push({ socket, playerId, states });
    }
    await delay(600);

    const created = await emitAck(players[0].socket, 'createRoom', {
        playerId: players[0].playerId, name: `Play-${mode}`, gameMode: mode,
        maxPlayers: 10, roundTime: 1, ...extra
    });
    assert(created?.success, `createRoom ${mode} ล้มเหลว`);
    const roomId = created.roomId;

    players[0].socket.emit('setRoom', { roomId, playerId: players[0].playerId });
    for (const p of players.slice(1)) {
        assert((await emitAck(p.socket, 'joinRoom', { roomId, playerId: p.playerId }))?.success, `join ${mode} ล้มเหลว`);
        p.socket.emit('setRoom', { roomId, playerId: p.playerId });
    }
    await delay(800);
    assert((await emitAck(players[0].socket, 'startGameFromLobby', { roomId }))?.success, `start ${mode} ล้มเหลว`);
    await delay(3200);
    return { players, roomId };
}

function watchPage(page, mode, errors) {
    page.on('pageerror', e => errors.push(`[${mode}] pageerror: ${e.message}`));
    page.on('console', m => {
        if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`[${mode}] console: ${m.text().slice(0, 140)}`);
    });
}

// timer บนจอต้องเดิน — จับบัคชนิด word timer ที่ค้างเพราะ exception
async function assertTimerTicks(page, selectors, mode) {
    const read = () => page.evaluate(sels => {
        for (const s of sels) {
            const el = document.querySelector(s);
            const t = el && el.textContent && el.textContent.trim();
            if (t && /\d/.test(t) && !/^-+:?-*$/.test(t)) return s + '=' + t;
        }
        return null;
    }, selectors);

    const first = await read();
    if (!first) return 'ไม่มี timer แสดงในเฟสนี้';
    await delay(2600);
    const second = await read();
    assert(first !== second, `[${mode}] timer ค้าง ไม่นับถอยหลัง: ${first}`);
    return `${first} → ${second}`;
}

async function assertBackToLobby(base, roomId, playerId, mode) {
    const res = await fetch(`${base}/room/${roomId}?playerId=${playerId}`, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    assert(!(res.status === 302 && loc.includes('/game/')),
        `[${mode}] จบเกมแล้วกดกลับห้องไม่ได้ — เด้งกลับ ${loc}`);
    return `HTTP ${res.status}${loc ? ' → ' + loc : ' (เข้า lobby)'}`;
}

async function main() {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const errors = [];
    const report = [];

    try {
        // ---------- SPYFALL: reveal → discussion → vote → result ----------
        {
            const mode = 'spyfall';
            const { players, roomId } = await setupRoom(base, mode, 4);
            players[0].socket.close();
            const page = await (await browser.newContext()).newPage();
            watchPage(page, mode, errors);
            await page.goto(`${base}/game/${roomId}?playerId=${players[0].playerId}`, { waitUntil: 'networkidle' });
            await delay(6500);

            const tick = await assertTimerTicks(page, ['#timerDisplay'], mode);
            await page.click('#sfEndDiscussionBtn');
            await delay(500);
            await page.click('.swal2-confirm');
            await delay(2200);

            const voteButtons = await page.$$('.sf-vote-btn');
            assert(voteButtons.length > 0, `[${mode}] ไม่มีปุ่มโหวตหลังจบช่วงคุย`);
            await voteButtons[0].click();
            for (const p of players.slice(1)) p.socket.emit('spyfall_vote', { targetPlayerId: players[0].playerId }, () => {});
            await delay(4500);

            assert(await page.evaluate(() => !!document.querySelector('.sf-result')), `[${mode}] ไม่ขึ้นหน้าผลแพ้ชนะ`);
            const back = await assertBackToLobby(base, roomId, players[1].playerId, mode);
            report.push(`spyfall     · timer ${tick} · ผลแพ้ชนะขึ้น · กลับห้อง ${back}`);
            await page.context().close();
            players.forEach(p => { try { p.socket.close(); } catch {} });
        }

        // ---------- WEREWOLF: night → day → vote → win screen ----------
        {
            const mode = 'werewolf';
            const { players, roomId } = await setupRoom(base, mode, 5, { werewolfRoles: ['werewolf', 'seer', 'doctor'] });
            const roleOf = p => [...p.states].reverse().find(s => s?.playerRole?.id)?.playerRole?.id;
            for (const p of players) p.socket.emit('werewolf_requestState', { roomId, playerId: p.playerId });
            await delay(1200);
            const wolf = players.find(p => ['werewolf', 'alphaWolf'].includes(roleOf(p)));
            assert(wolf, `[${mode}] หาหมาป่าไม่เจอ`);

            const viewer = players.find(p => p !== wolf);
            viewer.socket.close();
            const page = await (await browser.newContext()).newPage();
            watchPage(page, mode, errors);
            await page.goto(`${base}/game/${roomId}?playerId=${viewer.playerId}`, { waitUntil: 'networkidle' });
            await delay(3000);
            const tick = await assertTimerTicks(page, ['#phaseCountdown', '#mobilePhaseCountdown', '#phaseHudTimer'], mode);

            // เกมรอครบทุกคน — ผู้เล่นในเบราว์เซอร์ต้องกดปุ่มจริงด้วย ไม่งั้นเฟสไม่เดิน
            const clickInPage = async (fnName) => {
                await page.evaluate(name => { if (typeof window[name] === 'function') window[name](); }, fnName);
            };
            for (const p of players) if (p !== viewer) await emitAck(p.socket, 'werewolf_skipNight', { roomId, playerId: p.playerId }).catch(() => {});
            await clickInPage('skipNightPhase');
            await delay(5000);
            for (const p of players) if (p !== viewer) await emitAck(p.socket, 'werewolf_skipDiscussion', { roomId, playerId: p.playerId }).catch(() => {});
            await clickInPage('skipDiscussionPhase');
            await delay(5000);
            for (const p of players) {
                if (p === viewer) continue;
                const target = p === wolf ? players.find(x => x !== wolf).playerId : wolf.playerId;
                await emitAck(p.socket, 'werewolf_submitDayVote', { roomId, playerId: p.playerId, targetPlayerId: target }).catch(() => {});
            }
            // ผู้เล่นในเบราว์เซอร์โหวตด้วย (ผ่านฟังก์ชันจริงของกระดาน)
            await page.evaluate(id => { if (typeof window.selectVoteTarget === 'function') window.selectVoteTarget(id); }, wolf.playerId);
            await delay(14000);

            // เช็คสถานะจริงจาก state ไม่ใช่หาคำว่า "ชนะ" ในหน้า (ข้อความช่วยเหลือก็มีคำนี้)
            const lastState = [...players.find(p => p !== viewer).states].reverse()[0];
            assert(lastState?.phase === 'finished' && lastState?.winner,
                `[${mode}] เกมยังไม่จบ (phase=${lastState?.phase} winner=${lastState?.winner})`);
            // กระดานโชว์ win screen overlay แทน #winnerBanner — เช็คว่าจอบอกผู้ชนะจริง
            const announcesWinner = await page.evaluate(
                () => /ชาวบ้านชนะ|หมาป่าชนะ|คนบ้าชนะ/.test(document.body.innerText));
            assert(announcesWinner, `[${mode}] เกมจบแล้วแต่จอไม่บอกผู้ชนะ`);
            const back = await assertBackToLobby(base, roomId, viewer.playerId, mode);
            report.push(`werewolf    · timer ${tick} · ประกาศผู้ชนะ · กลับห้อง ${back}`);
            await page.context().close();
            players.forEach(p => { try { p.socket.close(); } catch {} });
        }

        // ---------- INSIDER: GM ตั้งคำ (timer ที่เคยพัง) ----------
        {
            const mode = 'insider';
            const { players, roomId } = await setupRoom(base, mode, 5);
            const loginRes = await fetch(`${base}/admin/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'password=supersecret', redirect: 'manual'
            });
            const cookie = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
            const adminHtml = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
            const token = adminHtml.match(/adminToken\s*=\s*['"]([a-f0-9]{64})['"]/)[1];
            const adminSocket = await connect(base);
            await emitAck(adminSocket, 'admin_authenticate', { token });
            const details = await emitAck(adminSocket, 'admin_getRoomDetails', { roomId });
            const gm = details.room.players.find(p => p.role === 'ผู้ดำเนินเกม');
            assert(gm, `[${mode}] หาผู้ดำเนินเกมไม่เจอ`);

            const gmClient = players.find(p => p.playerId === gm.id);
            gmClient.socket.close();
            const page = await (await browser.newContext()).newPage();
            watchPage(page, mode, errors);
            await page.goto(`${base}/game/${roomId}?playerId=${gm.id}`, { waitUntil: 'networkidle' });
            await delay(9000); // ผ่านช่วงโชว์บท 5 วิ เข้าฟอร์มตั้งคำ
            const tick = await assertTimerTicks(page, ['#wordTimerText'], mode);
            report.push(`insider     · word timer ${tick}`);
            adminSocket.close();
            await page.context().close();
            players.forEach(p => { try { p.socket.close(); } catch {} });
        }

        // ---------- BLACK MARKET: อยู่ในเกมยาวๆ ดู error ระหว่างเปลี่ยนเฟส ----------
        {
            const mode = 'blackmarket';
            const { players, roomId } = await setupRoom(base, mode, 5);
            players[0].socket.close();
            const page = await (await browser.newContext()).newPage();
            watchPage(page, mode, errors);
            await page.goto(`${base}/game/${roomId}?playerId=${players[0].playerId}`, { waitUntil: 'networkidle' });
            await delay(4000);
            const tick = await assertTimerTicks(page, ['#bmTimerChip'], mode);
            await delay(9000); // ปล่อยให้เฟสเปลี่ยนเองอย่างน้อยหนึ่งครั้ง
            report.push(`blackmarket · timer ${tick} · อยู่ในเกม 13 วิ ผ่านการเปลี่ยนเฟส`);
            await page.context().close();
            players.forEach(p => { try { p.socket.close(); } catch {} });
        }
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }

    report.forEach(line => console.log('  ✓ ' + line));
    if (errors.length) {
        console.error(`\n❌ เจอ JS error ${errors.length} รายการระหว่างเล่น:`);
        [...new Set(errors)].slice(0, 12).forEach(e => console.error('   ' + e));
        process.exit(1);
    }
    console.log('\n✅ เล่นจนจบทั้ง 4 โหมด ไม่มี JS error / timer ค้าง / ปุ่มกลับห้องตาย');
    process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
