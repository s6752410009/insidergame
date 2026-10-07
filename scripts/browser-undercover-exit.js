/**
 * ปุ่ม 🚪 ออก ของกระดานคำใครไม่เหมือน (exit standard) — เบราว์เซอร์จริง 390×844
 * - ออกตอนตาตัวเองพูด: เห็นคำเตือนตามเฟส → ไปหน้า /rooms → ตาพูดย้ายไปคนถัดไป
 * - ออกตอนโหวต: วงที่เหลือโหวตครบแล้วเปิดผลได้ ไม่ค้างรอคนที่ออก
 * - รอ 15 วิ ต้องยังอยู่ /rooms (ไม่ถูกดึงกลับเข้าห้อง/เกม)
 *
 * รัน: npm run smoke:undercover:exit
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const SHOT_DIR = process.env.UNDERCOVER_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'undercover-exit-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

async function getPort() {
    const preferred = Number(process.env.UNDERCOVER_EXIT_PORT) || 8453;
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
    const long = '600000';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env, PORT: String(port), MONGO_URL: '',
            UNDERCOVER_REVEAL_MS: long, UNDERCOVER_CLUE_MS: long, UNDERCOVER_VOTE_MS: long,
            UNDERCOVER_MRWHITE_MS: long, UNDERCOVER_RESULT_MS: long, UNDERCOVER_RETURN_MS: long
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.once('connect', () => r(s)); }); }
function launchOptions() {
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH };
    if (fs.existsSync(sys)) return { executablePath: sys };
    return {};
}
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await delay(80); }
    throw new Error('รอไม่ถึง: ' + label);
}
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|ERR_SOCKET_NOT_CONNECTED/i;

(async () => {
    const port = await getPort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(launchOptions());
    const sockets = [];
    try {
        const bots = [];
        for (let i = 0; i < 6; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('undercoverState', s => states.push(s));
            bots.push({ socket, id, states });
            sockets.push(socket);
        }
        await delay(500);
        // ปิด Mr. White ให้บทง่าย: สายแฝง 1 + พลเมือง 5 → พลเมือง 2 คนออก เกมยังเดินต่อ
        const created = await ack(bots[0].socket, 'createRoom', { playerId: bots[0].id, name: 'ทดสอบปุ่มออก', gameMode: 'undercover', maxPlayers: 10, undercoverMrWhite: false });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        bots[0].socket.emit('setRoom', { roomId, playerId: bots[0].id });
        for (const b of bots.slice(1)) {
            assert((await ack(b.socket, 'joinRoom', { roomId, playerId: b.id }))?.success, 'join failed');
            b.socket.emit('setRoom', { roomId, playerId: b.id });
        }
        await delay(500);
        assert((await ack(bots[0].socket, 'startGameFromLobby', { roomId }))?.success, 'start failed');
        await waitFor(() => bots.every(b => b.states.length && b.states[b.states.length - 1].phase === 'reveal'), 8000, 'reveal');
        const view = b => b.states[b.states.length - 1];
        const words = bots.map(b => view(b).self.word);
        const isCiv = b => words.filter(w => w === view(b).self.word).length > 1;
        const host = bots[0];
        const [A, B] = bots.filter(b => b !== host && isCiv(b));
        assert(A && B, 'ต้องมีพลเมืองที่ไม่ใช่หัวห้อง 2 คน');

        const pages = {};
        for (const p of [A, B]) {
            p.socket.close();
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            await ctx.addInitScript(() => { try { localStorage.setItem('ig-firstplay-undercover', '1'); } catch (e) {} });
            const page = await ctx.newPage();
            p.errors = [];
            page.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) p.errors.push('console: ' + m.text().slice(0, 160)); });
            await page.goto(`${base}/game/${roomId}?playerId=${p.id}`, { waitUntil: 'domcontentloaded' });
            pages[p.id] = page;
        }
        await delay(1800);
        const live = bots.filter(b => b !== A && b !== B);
        const hostView = () => view(host);
        for (const p of [A, B]) {
            assert(await pages[p.id].isVisible('#ucExitBtn'), 'ปุ่ม 🚪 ออก ต้องเห็นตอนดูคำ');
            assert(/ออก/.test(await pages[p.id].textContent('#ucExitBtn')), 'ปุ่มต้องเขียนว่า ออก');
        }

        // reveal → clue
        for (const p of [A, B]) await pages[p.id].click('#ucReadyBtn');
        for (const b of live) await ack(b.socket, 'undercover_ready', { step: view(b).step });
        await waitFor(() => hostView().phase === 'clue', 5000, 'clue');

        async function speak(id) {
            if (pages[id]) { await pages[id].click('#ucClueDoneBtn'); return; }
            const b = bots.find(x => x.id === id);
            await waitFor(() => view(b).speakerId === id, 4000, 'state คนพูดมาถึง');
            const res = await ack(b.socket, 'undercover_clueDone', { step: view(b).step });
            assert(res?.success, 'บอทพูดไม่ได้ ' + JSON.stringify(res));
        }
        // พูดไปจนถึงตา A
        let guard = 0;
        while (hostView().speakerId !== A.id && guard++ < 8) {
            const sp = hostView().speakerId;
            await speak(sp);
            await waitFor(() => hostView().speakerId !== sp, 4000, 'next speaker');
        }
        assert(hostView().phase === 'clue' && hostView().speakerId === A.id, 'ต้องถึงตา A พูด');
        const pageA = pages[A.id];
        await waitFor(async () => (await pageA.$('#ucClueDoneBtn')) !== null, 4000, 'หน้า A เห็นว่าตาตัวเอง');

        // ---------- ออกตอนตาตัวเองพูด: กด "อยู่ต่อ" ก่อน → ไม่ออก
        await pageA.click('#ucExitBtn');
        await pageA.waitForSelector('.swal2-popup');
        assert((await pageA.textContent('.swal2-title')).trim() === 'ออกจากห้อง?', 'หัวข้อยืนยันต้องเป็น "ออกจากห้อง?"');
        assert((await pageA.textContent('.swal2-confirm')).trim() === 'ออกจากห้อง', 'ปุ่มยืนยัน "ออกจากห้อง"');
        assert((await pageA.textContent('.swal2-cancel')).trim() === 'อยู่ต่อ', 'ปุ่มยกเลิก "อยู่ต่อ"');
        const body = await pageA.textContent('.swal2-html-container');
        assert(/ตาคุณพูด/.test(body) && /ตกรอบ/.test(body), 'คำเตือนต้องบอกว่าตาจะข้าม และคุณจะตกรอบ: ' + body);
        await delay(1600); // ป้าย "ตาคุณ" ของ partyPlay หายเองใน 1.4 วิ
        await pageA.screenshot({ path: path.join(SHOT_DIR, 'exit-confirm-speaker-390.png') });
        await pageA.click('.swal2-cancel');
        await delay(600);
        assert(new URL(pageA.url()).pathname.startsWith('/game/'), 'กดอยู่ต่อ = ยังอยู่ในเกม');
        assert(hostView().speakerId === A.id, 'กดอยู่ต่อ = ตาพูดยังเป็นของ A');

        // ---------- ยืนยันออก
        await pageA.click('#ucExitBtn');
        await pageA.waitForSelector('.swal2-confirm');
        await pageA.click('.swal2-confirm');
        await pageA.waitForURL(u => new URL(u).pathname === '/rooms', { timeout: 8000 });
        await waitFor(() => hostView().speakerId !== A.id, 4000, 'ตาพูดย้ายจาก A');
        const seatA = hostView().players.find(p => p.playerId === A.id);
        assert(seatA && seatA.left && !seatA.alive && seatA.role, 'A ถูกนับว่าออก ตกรอบ และเปิดบท');
        // A เป็นคนพูดคนสุดท้ายของรอบ = เข้าโหวตเลย ก็ถือว่าเกมเดินต่อ
        assert(['clue', 'vote'].includes(hostView().phase), 'ตาพูดไปคนถัดไป เกมเดินต่อ (phase=' + hostView().phase + ')');
        console.log('1. ออกตอนตาตัวเองพูด → /rooms · ตาพูดย้ายไปคนถัดไป ✓');

        // ---------- พูดให้ครบแล้วเข้าโหวต (B อาจต้องพูดผ่านหน้าเว็บ)
        guard = 0;
        while (hostView().phase === 'clue' && guard++ < 8) {
            const sp = hostView().speakerId;
            await speak(sp);
            await waitFor(() => hostView().speakerId !== sp || hostView().phase !== 'clue', 4000, 'next speaker 2');
        }
        assert(hostView().phase === 'vote', 'ต้องเข้าโหวต');
        const pageB = pages[B.id];
        await waitFor(async () => (await pageB.$('.uc-vote-tile')) !== null, 4000, 'หน้า B เห็นโหวต');
        await pageB.click('#ucExitBtn');
        await pageB.waitForSelector('.swal2-popup');
        const bodyB = await pageB.textContent('.swal2-html-container');
        assert(/โหวตของคุณจะไม่นับ/.test(bodyB), 'ออกตอนโหวตต้องบอกว่าโหวตไม่นับ: ' + bodyB);
        await delay(1600);
        await pageB.screenshot({ path: path.join(SHOT_DIR, 'exit-confirm-vote-390.png') });
        await pageB.click('.swal2-confirm');
        await pageB.waitForURL(u => new URL(u).pathname === '/rooms', { timeout: 8000 });
        await waitFor(() => hostView().players.find(p => p.playerId === B.id)?.left, 4000, 'B ถูกนับว่าออก');

        // ที่เหลือ 4 คนโหวตครบ → ต้องเปิดผลทันที ไม่รอคนที่ออก
        const uc = live.find(b => !isCiv(b));
        const voters = live.filter(b => view(b).self.alive);
        for (const b of voters) {
            if (view(b).phase !== 'vote') break;
            const target = b === uc ? live.find(x => x !== uc).id : uc.id;
            const res = await ack(b.socket, 'undercover_vote', { step: view(b).step, targetPlayerId: target });
            assert(res?.success, 'โหวตไม่ได้ ' + JSON.stringify(res));
        }
        await waitFor(() => hostView().phase === 'finished' || hostView().phase === 'elimination', 4000, 'เปิดผลโหวต');
        assert(hostView().phase === 'finished' && hostView().winner.team === 'civilians', 'โหวตสายแฝงออก → พลเมืองชนะ (เกมจบปกติ)');
        assert(hostView().winner.winnerIds.includes(A.id), 'คนที่ออกยังนับผลตามฝั่ง (พลเมือง)');
        console.log('2. ออกตอนโหวต → /rooms · ที่เหลือโหวตครบแล้วเปิดผลได้ทันที ✓');

        // ---------- รอ 15 วิ ต้องไม่ถูกดึงกลับ
        await delay(15000);
        for (const p of [A, B]) {
            assert(new URL(pages[p.id].url()).pathname === '/rooms', 'ผ่านไป 15 วิ ต้องยังอยู่ /rooms: ' + pages[p.id].url());
            assert(p.errors.length === 0, 'JS error: ' + p.errors.join(' | '));
        }
        const scroll = await pages[A.id].evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        assert(scroll, '/rooms ไม่เลื่อนแนวนอน');
        await pages[A.id].screenshot({ path: path.join(SHOT_DIR, 'exit-rooms-after-15s-390.png') });
        console.log('3. รอ 15 วิ ยังอยู่ /rooms ไม่ถูกดึงกลับ ✓');

        console.log(`\n✅ ปุ่มออกคำใครไม่เหมือน ผ่าน ${checks} checks → ${SHOT_DIR}`);
    } finally {
        sockets.forEach(s => { try { s.close(); } catch {} });
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
