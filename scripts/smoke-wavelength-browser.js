/**
 * คลื่นความคิด — เล่นจริงในเบราว์เซอร์ 3 จอ (390×844) + บอท socket 1 ตัว + เดสก์ท็อป 1280×900
 * ลากเข็มบนหน้าปัดจริง พิมพ์คำใบ้จริง จบเกมเห็นโพเดียม
 * เช็ก: ไม่มี page/console error · ไม่เลื่อนแนวนอน · ข้อความไม่ล้น · ปุ่ม ≥ 44px · เป้าไม่อยู่ใน DOM ของคนทาย
 * ไฟล์นี้เล่นโหมดแข่งเดี่ยว — แข่งทีมอยู่ที่ smoke-wavelength-teams-browser.js
 * รัน: npm run smoke:wavelength:browser   (ภาพไปที่ WAVELENGTH_SHOT_DIR)
 */
const path = require('path');
const fs = require('fs');

const TMP_ROOT = path.join(__dirname, '..', '..', '..', 'tmpdata-wavelength');
const TMP = path.join(TMP_ROOT, `browser-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
process.env.GAME_DATA_DIR = TMP;
process.env.WALLETS_FILE = path.join(TMP, 'wallets.json');
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
require('./isolateTestData');

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const SHOT_DIR = process.env.WAVELENGTH_SHOT_DIR || path.join(TMP_ROOT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

function bootServer(port) {
    const long = '600000';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), MONGO_URL: '', WAVELENGTH_CLUE_MS: long, WAVELENGTH_GUESS_MS: long, WAVELENGTH_REVEAL_MS: long },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
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
    while (Date.now() < until) {
        // หน้ากำลังรีโหลด (เทสรีเฟรชกลางรอบ) = context หาย ชั่วคราว — ลองใหม่
        const v = await Promise.resolve().then(fn).catch(e => { if (/context was destroyed|navigat/i.test(e.message)) return null; throw e; });
        if (v) return v;
        await delay(80);
    }
    throw new Error('รอไม่ถึง: ' + label);
}
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|ERR_QUIC_PROTOCOL_ERROR/i; // QUIC = ฟอนต์ Google ผ่าน HTTP/3 เน็ตสะดุด ไม่ใช่บั๊กของเรา

async function layoutProblems(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const problems = [];
        if (document.documentElement.scrollWidth > vw + 1) problems.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + vw);
        const root = document.getElementById('wlRoot');
        root.querySelectorAll('*').forEach(el => {
            if (!(el instanceof HTMLElement)) return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden') return;
            if (r.right > vw + 1 || r.left < -1) problems.push('offscreen ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
            const clipped = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis';
            if (!clipped && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline') {
                problems.push('text overflow ' + el.tagName + '.' + el.className + ' "' + (el.textContent || '').slice(0, 20) + '"');
            }
            if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && cs.display !== 'none' && r.height < 43.5) {
                problems.push('small target ' + el.tagName + '#' + el.id + '.' + el.className + ' h=' + Math.round(r.height));
            }
        });
        // แชท/ปุ่มลอยต้องไม่ทับปุ่มหลักใน dock
        const dock = document.getElementById('wlDock');
        const chat = document.getElementById('toggleChat');
        if (dock && chat && dock.innerHTML) {
            const a = chat.getBoundingClientRect();
            dock.querySelectorAll('button, input').forEach(b => {
                const q = b.getBoundingClientRect();
                if (q.width && a.width && !(a.right < q.left || a.left > q.right || a.bottom < q.top || a.top > q.bottom)) problems.push('chat covers ' + b.id);
            });
        }
        return problems.slice(0, 8);
    });
}

(async () => {
    const port = Number(process.env.SMOKE_PORT) || 8832;
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(launchOptions());
    const shots = [];
    const sockets = [];
    try {
        // 4 ผู้เล่น: 3 จอ + บอท socket 1 (ที่นั่งสุดท้าย)
        const names = ['แพรวพราวเจริญสุขศรี', 'ต้น', 'มายด์', 'บอทโต้ง'];
        const ps = [];
        for (let i = 0; i < 4; i += 1) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('wavelengthState', s => states.push(s));
            ps.push({ socket, id, states, name: names[i] });
            sockets.push(socket);
        }
        await delay(400);
        for (const p of ps) {
            const res = await fetch(`${base}/profile/updateName?playerId=${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name }) });
            const body = await res.json().catch(() => ({}));
            assert(body.success, 'ตั้งชื่อไม่ได้: ' + JSON.stringify(body));
        }
        const created = await ack(ps[0].socket, 'createRoom', { playerId: ps[0].id, name: 'คลื่นความคิด', gameMode: 'wavelength', maxPlayers: 8, wavelengthMode: 'solo' });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        ps[0].socket.emit('setRoom', { roomId, playerId: ps[0].id });
        for (const p of ps.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join failed');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(400);

        async function newPage(id, viewport, label) {
            const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
            await ctx.addInitScript(() => {
                try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-wavelength', '1'); } catch (e) { /* ignore */ }
            });
            const page = await ctx.newPage();
            const v = { page, ctx, id, label, errors: [] };
            page.on('pageerror', e => v.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) v.errors.push('console: ' + m.text().slice(0, 200)); });
            await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
            // คนที่อยู่ในห้องที่กำลังเล่นถูกพาไป /game เอง — ไม่ต้อง goto ซ้ำ (beforeunload ของกระดาน)
            v.goto = async url => {
                if (new URL(page.url()).pathname === new URL(url).pathname) return;
                await page.goto(url, { waitUntil: 'domcontentloaded' });
            };
            return v;
        }

        // ห้องรอของหัวห้อง — หน้าเว็บกด "เริ่มเกม" เองแล้วถูกพาไปกระดาน (ปิดแท็บห้องรอ = ออกจากห้อง เลยไม่ปิด)
        const bot = ps[3];
        const view = p => p.states[p.states.length - 1];
        const viewers = [];
        {
            ps[0].socket.close();
            const v = await newPage(ps[0].id, { width: 390, height: 844 }, 'host');
            await v.goto(`${base}/room/${roomId}?playerId=${ps[0].id}`);
            await delay(1500);
            const txt = await v.page.textContent('body');
            assert(/คลื่นความคิด/.test(txt) && /ใบ้คนละ 1 ครั้ง/.test(txt), 'ห้องรอแสดงโหมด + ตัวเลือกจำนวนรอบ');
            await v.page.click('.wl-laps-btn[data-laps="2"]');
            await waitFor(() => v.page.$('.wl-laps-btn[data-laps="2"][aria-pressed="true"]'), 4000, 'laps toggle');
            await v.page.click('.wl-laps-btn[data-laps="1"]');
            await waitFor(() => v.page.$('.wl-laps-btn[data-laps="1"][aria-pressed="true"]'), 4000, 'laps toggle back');
            await delay(8200);
            const file = path.join(SHOT_DIR, '00-lobby-390.png');
            await v.page.screenshot({ path: file });
            shots.push(file);
            assert(v.errors.length === 0, 'lobby errors: ' + v.errors.join(' | '));
            await waitFor(async () => !(await v.page.$eval('#btnStartGameLobby', b => b.disabled)), 5000, 'start enabled');
            await v.page.click('#btnStartGameLobby');
            const confirmBtn = await v.page.waitForSelector('.swal2-confirm', { timeout: 1500 }).catch(() => null);
            if (confirmBtn) await confirmBtn.click().catch(() => {});
            await v.page.waitForURL(/\/game\//, { timeout: 10000 });
            v.errors = v.errors.filter(e => !/beforeunload/.test(e));
            viewers.push(v);
        }
        await waitFor(() => view(bot) && view(bot).phase === 'clue', 8000, 'clue');

        // เปิดจอ p1/p2 (ปิด socket ของเขา — หน้าเว็บต่อเอง)
        for (let i = 1; i < 3; i += 1) {
            ps[i].socket.close();
            const v = await newPage(ps[i].id, { width: 390, height: 844 }, ['host', 'p1', 'p2'][i]);
            await v.goto(`${base}/game/${roomId}?playerId=${ps[i].id}`);
            viewers.push(v);
        }
        await delay(2000);
        const [host, p1, p2] = viewers;
        globalThis.__wlViewers = viewers;

        async function snap(label, list = viewers) {
            await delay(350);
            for (const v of list) {
                const problems = await layoutProblems(v.page);
                assert(problems.length === 0, `${label}/${v.label}: layout ${problems.join(' | ')}`);
                assert(v.errors.length === 0, `${label}/${v.label}: ${v.errors.join(' | ')}`);
                const file = path.join(SHOT_DIR, `${label}-${v.label}-390.png`);
                await v.page.screenshot({ path: file, fullPage: true });
                shots.push(file);
            }
        }
        async function dialPoint(page, value) {
            const box = await page.locator('#wlDial').boundingBox();
            const a = (180 - value * 1.8) * Math.PI / 180;
            return { x: box.x + (200 + 150 * Math.cos(a)) / 400 * box.width, y: box.y + (200 - 150 * Math.sin(a)) / 214 * box.height };
        }
        async function drag(page, from, to) {
            const a = await dialPoint(page, from);
            const b = await dialPoint(page, to);
            await page.mouse.move(a.x, a.y);
            await page.mouse.down();
            for (let i = 1; i <= 12; i += 1) await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12);
            await page.mouse.up();
        }
        const bandsVisible = page => page.evaluate(() => document.getElementById('wlBands').style.display !== 'none');
        async function nowCopy(page) { return (await page.textContent('#wlNowCopy')) || ''; }

        // ---------- รอบ 1: หัวห้องใบ้ (จอ) ----------
        await waitFor(() => host.page.$('.wl-option'), 5000, 'options');
        assert(await bandsVisible(host.page), 'ผู้ใบ้เห็นแถบเป้า');
        assert(!(await bandsVisible(p1.page)), 'คนทายไม่เห็นแถบเป้า');
        assert((await p1.page.$$('#wlBands path')).length === 0 || !(await bandsVisible(p1.page)), 'แถบเป้าของคนทายซ่อน');
        assert(/ตาคุณใบ้/.test(await nowCopy(host.page)), 'ผู้ใบ้รู้ว่าถึงตาตัวเอง');
        assert(await host.page.$('#wlPassBtn'), 'ผู้ใบ้มีปุ่ม "คิดไม่ออก ข้ามตา"');
        assert(!(await p1.page.$('#wlPassBtn')), 'คนอื่นไม่มีปุ่มข้ามตา');
        assert(await host.page.$eval('#wlSkipBtn', b => b.hidden), 'หัวห้องที่เป็นผู้ใบ้ ใช้ปุ่มข้ามตาในช่องคำใบ้ (ไม่ซ้อนปุ่ม)');
        assert(/กำลังคิดคำใบ้/.test(await nowCopy(p1.page)), 'คนทายรู้ว่ารอใคร');
        await delay(8200); // ให้แถบข้อตกลงด้านบนหายก่อนถ่าย
        await snap('01-clue-pick');
        await host.page.click('.wl-option[data-index="0"]');
        await waitFor(() => host.page.$('.wl-option.is-picked'), 3000, 'picked');
        const card = await host.page.evaluate(() => ({ left: document.getElementById('wlLeft').textContent, right: document.getElementById('wlRight').textContent }));
        await host.page.fill('#wlClueInput', card.left + 'จัด');
        await waitFor(async () => /คำบนการ์ด/.test(await host.page.textContent('#wlClueMsg')), 2000, 'client-side card word warning');
        assert(await host.page.$eval('#wlClueBtn', b => b.disabled), 'ปุ่มส่งถูกปิดเมื่อคำใบ้ผิด');
        await host.page.fill('#wlClueInput', 'ตลาดน้ำตอนเช้า');
        await snap('02-clue-typing', [host]);
        await host.page.click('#wlClueBtn');
        await waitFor(() => p1.page.$('#wlLockBtn'), 5000, 'guess on p1');
        assert(/ตลาดน้ำตอนเช้า/.test(await p1.page.textContent('#wlClue')), 'คนทายเห็นคำใบ้');
        assert(!(await bandsVisible(p1.page)), 'ตอนทาย คนทายยังไม่เห็นเป้า');

        // ทายด้วยการลากเข็มจริง
        await drag(p1.page, 50, 22);
        await drag(p2.page, 50, 71);
        await delay(400);
        await snap('03-guess-dragging');
        const v1 = Number(await p1.page.getAttribute('#wlKnobHit', 'aria-valuenow'));
        assert(Math.abs(v1 - 22) <= 3, `เข็ม p1 ตามที่ลาก (${v1})`);
        // ปุ่ม ‹ › ขยับทีละ 1 (นิ้วโป้งบังเข็ม ลากละเอียดยาก)
        await p1.page.click('.wl-nudge[data-step="1"]');
        await p1.page.click('.wl-nudge[data-step="1"]');
        await delay(500);
        const v1b = Number(await p1.page.getAttribute('#wlKnobHit', 'aria-valuenow'));
        assert(v1b === Math.round(v1) + 2 || v1b === Math.round(v1) + 1, `ปุ่ม › ขยับเข็มทีละ 1 (${v1} → ${v1b})`);
        // หัวห้อง (ผู้ใบ้) ไม่มีปุ่ม "เปิดเป้าเลย" ของหัวห้องซ้อน — มีแค่ตอนหัวห้องเป็นคนทาย · คนอื่นไม่เห็นเลย
        assert(await p1.page.$eval('#wlSkipBtn', b => b.hidden), 'คนทั่วไปไม่เห็นปุ่มข้าม/เปิดเป้า');
        assert(!(await host.page.$eval('#wlSkipBtn', b => b.hidden)) && /เปิดเป้าเลย/.test(await host.page.textContent('#wlSkipBtn')), 'หัวห้องเห็นปุ่มเปิดเป้าเลยตอนเพื่อนทาย');
        await p1.page.click('#wlLockBtn');
        await waitFor(async () => /ล็อกแล้ว/.test(await p1.page.textContent('#wlDock')), 3000, 'locked p1');
        await waitFor(async () => !!(await p2.page.$('.wl-lock.is-locked')), 3000, 'p2 sees p1 locked');
        await snap('04-guess-locked', [p1, p2]);
        await p2.page.click('#wlLockBtn');
        await waitFor(() => view(bot).phase === 'guess' && view(bot).self.isGuesser, 3000, 'bot guess');
        await ack(bot.socket, 'wavelength_lock', { value: 55, round: view(bot).round, phase: 'guess' });
        await waitFor(async () => !!(await p1.page.$('.wl-pin')), 4000, 'pins');
        await delay(2600);
        assert(await bandsVisible(p1.page), 'เปิดแล้วทุกคนเห็นเป้า');
        assert((await p1.page.$$('.wl-pin')).length === 3, 'เข็มทุกคนพร้อมชื่อบนหน้าปัด');
        await snap('05-reveal');

        // ---------- รอบ 2: p1 ใบ้ · p2 กดพร้อม หัวห้องกดรอบต่อไป ----------
        assert(/พร้อมไปรอบต่อไป/.test(await p2.page.textContent('#wlReadyBtn')), 'ปุ่มของคนทั่วไปบอกว่าเป็น "พร้อม"');
        await p2.page.click('#wlReadyBtn');
        await waitFor(async () => /พร้อมแล้ว ✓/.test(await p2.page.textContent('#wlDock')), 3000, 'p2 ready');
        await waitFor(async () => /เพื่อนพร้อม 1\/3/.test(await host.page.textContent('#wlDock')), 3000, 'host sees ready count (ไม่นับหัวห้อง)');
        await host.page.click('#wlNextBtn');
        await waitFor(() => p1.page.$('.wl-option'), 5000, 'r2 options');
        // พิมพ์ร่างได้ก่อนเลือกการ์ด · รีเฟรชแล้วร่างยังอยู่
        await p1.page.fill('#wlClueInput', 'แมวส้ม');
        await waitFor(async () => /เลือกการ์ด/.test(await p1.page.textContent('#wlClueMsg')), 2000, 'pick-first hint');
        assert(await p1.page.$eval('#wlClueBtn', b => b.disabled), 'ยังไม่เลือกการ์ด = ส่งไม่ได้ พร้อมบอกเหตุผล');
        p1.page.once('dialog', d => d.accept().catch(() => {}));
        await p1.page.reload({ waitUntil: 'domcontentloaded' });
        await waitFor(() => p1.page.$('.wl-option'), 8000, 'r2 options after reload');
        assert((await p1.page.inputValue('#wlClueInput')) === 'แมวส้ม', 'รีเฟรชแล้วร่างคำใบ้ยังอยู่');
        await p1.page.click('#wlRerollBtn');
        await waitFor(async () => /สุ่มใหม่ไปแล้ว/.test(await p1.page.textContent('#wlOptions')), 3000, 'reroll');
        await p1.page.click('.wl-option[data-index="1"]');
        await waitFor(() => p1.page.$('.wl-option.is-picked'), 3000, 'r2 picked');
        await p1.page.fill('#wlClueInput', 'แมวส้ม');
        await p1.page.press('#wlClueInput', 'Enter');
        await waitFor(() => host.page.$('#wlLockBtn'), 5000, 'r2 guess');
        // เดสก์ท็อปของหัวห้อง (แท็บที่สอง)
        const desk = await newPage(ps[0].id, { width: 1280, height: 900 }, 'desktop');
        await desk.goto(`${base}/game/${roomId}?playerId=${ps[0].id}`);
        await delay(8400); // แถบข้อตกลงด้านบนหายก่อนถ่าย
        await drag(desk.page, 50, 64);
        await delay(400);
        {
            const problems = await layoutProblems(desk.page);
            assert(problems.length === 0, 'desktop layout: ' + problems.join(' | '));
            assert(desk.errors.length === 0, 'desktop errors: ' + desk.errors.join(' | '));
            const file = path.join(SHOT_DIR, '06-guess-desktop-1280.png');
            await desk.page.screenshot({ path: file, fullPage: true });
            shots.push(file);
        }
        await desk.ctx.close();
        await drag(host.page, 50, 40);
        await host.page.click('#wlLockBtn');
        await drag(p2.page, 50, 90);
        await p2.page.click('#wlLockBtn');
        await waitFor(() => view(bot).phase === 'guess', 3000, 'bot r2');
        await ack(bot.socket, 'wavelength_lock', { value: 12, round: view(bot).round, phase: 'guess' });
        await waitFor(() => p1.page.$('.wl-pin'), 4000, 'r2 pins');
        await delay(2600);
        await snap('07-reveal-giver', [p1]);
        await host.page.click('#wlNextBtn');

        // ---------- รอบ 3: p2 ใบ้ · รอบ 4: บอทใบ้ ----------
        await waitFor(() => p2.page.$('.wl-option'), 5000, 'r3 options');
        await p2.page.click('.wl-option[data-index="0"]');
        await waitFor(() => p2.page.$('.wl-option.is-picked'), 3000, 'r3 picked');
        await p2.page.fill('#wlClueInput', 'ร่มกันแดด');
        await p2.page.click('#wlClueBtn');
        for (const v of [host, p1]) {
            await waitFor(() => v.page.$('#wlLockBtn'), 5000, 'r3 lock btn');
            await v.page.click('#wlLockBtn'); // ไม่ขยับเลย = ถามก่อน
            await waitFor(async () => /ล็อกตรงกลางเลย/.test(await v.page.textContent('#wlLockBtn')), 2000, 'center warn');
            assert(/ยังไม่ได้ขยับเข็ม/.test(await v.page.textContent('#wlDock')), 'บอกว่ายังไม่ได้ขยับเข็ม');
            assert(!(await v.page.$('.wl-lock.is-locked')) || v === p1, 'กดครั้งแรกยังไม่ล็อก');
            if (v === host) { const f = path.join(SHOT_DIR, '08a-lock-center-warn-host-390.png'); await v.page.screenshot({ path: f }); shots.push(f); }
            await v.page.click('#wlLockBtn'); // กดซ้ำ = ล็อกตรงกลาง
            await waitFor(async () => /ล็อกแล้ว ✓/.test(await v.page.textContent('#wlDock')), 3000, 'center locked');
        }
        await waitFor(() => view(bot).phase === 'guess', 3000, 'bot r3');
        await ack(bot.socket, 'wavelength_lock', { value: 50, round: view(bot).round, phase: 'guess' });
        await waitFor(() => host.page.$('#wlNextBtn'), 5000, 'r3 reveal');
        await delay(2200);
        await host.page.click('#wlNextBtn');
        await waitFor(() => view(bot).phase === 'clue' && view(bot).giverId === bot.id, 5000, 'bot giver');
        await snap('08-waiting-for-bot', [p2]);
        await ack(bot.socket, 'wavelength_pickCard', { index: 0, round: view(bot).round, phase: 'clue' });
        await waitFor(() => view(bot).card, 3000, 'bot card');
        await ack(bot.socket, 'wavelength_clue', { text: 'ผ้าห่มผืนใหญ่', round: view(bot).round, phase: 'clue' });
        for (const [v, val] of [[host, 80], [p1, 35], [p2, 61]]) {
            await waitFor(() => v.page.$('#wlLockBtn'), 5000, 'r4 lock btn');
            await drag(v.page, 50, val);
            await v.page.click('#wlLockBtn');
        }
        await waitFor(() => host.page.$('#wlNextBtn'), 5000, 'r4 reveal');
        await delay(2400);
        await host.page.click('#wlNextBtn');

        // ---------- จบเกม ----------
        await waitFor(async () => !!(await p1.page.$('.wl-podium')), 6000, 'podium');
        await delay(1500);
        await snap('09-finished');
        for (const v of viewers) {
            const txt = await v.page.textContent('#wlFinal');
            assert(/แต้ม/.test(txt), `${v.label}: หน้าจบมีคะแนน`);
            assert(await v.page.$('#wlBackBtn'), `${v.label}: มีปุ่มกลับห้องรอ`);
            assert(/ย้อนดูทีละรอบ \(4\)/.test(txt), `${v.label}: มีสรุปทีละรอบ`);
        }
        const broken = await host.page.evaluate(() => Array.from(document.images).filter(i => i.getAttribute('src') && i.naturalWidth === 0).map(i => i.getAttribute('src')));
        assert(broken.length === 0, 'รูปแตก: ' + broken.join(', '));

        // กลับห้องรอพร้อมกัน
        await host.page.click('#wlBackBtn');
        await waitFor(async () => /\/room\//.test(p1.page.url()), 6000, 'p1 back to lobby');
        await delay(800);
        for (const v of viewers) assert(v.errors.length === 0, `${v.label}: ${v.errors.join(' | ')}`);

        // ---------- วงใหญ่ 12 คน ทายกระจุกกัน: ป้ายชื่อบนหน้าปัดต้องไม่ซ้อนกัน (รวมเป็น +N) ----------
        {
            const big = [];
            for (let i = 0; i < 12; i += 1) {
                const socket = await conn(base);
                const id = randomUUID();
                socket.emit('initPlayer', id);
                const states = [];
                socket.on('wavelengthState', st => states.push(st));
                big.push({ socket, id, states });
                sockets.push(socket);
            }
            await delay(300);
            const made = await ack(big[0].socket, 'createRoom', { playerId: big[0].id, name: 'วงใหญ่', gameMode: 'wavelength', maxPlayers: 12, wavelengthMode: 'solo' });
            assert(made?.success, 'create big room');
            big[0].socket.emit('setRoom', { roomId: made.roomId, playerId: big[0].id });
            for (const p of big.slice(1)) {
                assert((await ack(p.socket, 'joinRoom', { roomId: made.roomId, playerId: p.id }))?.success, 'join big');
                p.socket.emit('setRoom', { roomId: made.roomId, playerId: p.id });
            }
            await delay(300);
            assert((await ack(big[0].socket, 'startGameFromLobby', { roomId: made.roomId }))?.success, 'start big');
            await waitFor(() => view(big[0]) && view(big[0]).phase === 'clue', 8000, 'big clue');
            const me = big[1];
            me.socket.close();
            const v = await newPage(me.id, { width: 390, height: 844 }, 'big12');
            // จำลองคีย์บอร์ด iOS: visualViewport หดแต่ layout viewport ไม่หด
            await v.ctx.addInitScript(() => {
                const fake = new EventTarget();
                fake.offsetTop = 0;
                Object.defineProperty(fake, 'height', { get() { return window.__vvH || window.innerHeight; } });
                Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
            });
            await v.goto(`${base}/game/${made.roomId}?playerId=${me.id}`);
            await v.page.waitForURL(/\/game\//, { timeout: 10000 });
            v.page.once('dialog', d => d.accept().catch(() => {}));
            await v.page.reload({ waitUntil: 'domcontentloaded' }); // ให้ visualViewport ปลอมมีผล
            await delay(300);
            v.errors = v.errors.filter(e => !/beforeunload/.test(e));
            const target = view(big[0]).target;
            // มือถือแนวนอน: พอเริ่มทาย หน้าปัดต้องอยู่ในจอเหนือ dock เอง · ปุ่มแชทไม่ทับปุ่มเครื่องมือ
            await v.page.setViewportSize({ width: 844, height: 390 });
            await delay(300);
            await ack(big[0].socket, 'wavelength_pickCard', { index: 0, round: 1, phase: 'clue' });
            await waitFor(() => view(big[0]).card, 3000, 'big card');
            await ack(big[0].socket, 'wavelength_clue', { text: 'ลมหนาว', round: 1, phase: 'clue' });
            await waitFor(() => v.page.$('#wlLockBtn'), 8000, 'big lock btn');
            await delay(1200);
            const land = await v.page.evaluate(() => {
                const d = document.getElementById('wlDial').getBoundingClientRect();
                const dock = document.getElementById('wlDock').getBoundingClientRect();
                const clue = document.getElementById('wlClue').getBoundingClientRect();
                const chat = document.getElementById('toggleChat').getBoundingClientRect();
                const hits = Array.from(document.querySelectorAll('.wl-tools .wl-pill')).filter(b => !b.hidden).filter(b => {
                    const q = b.getBoundingClientRect();
                    return !(chat.right < q.left || chat.left > q.right || chat.bottom < q.top || chat.top > q.bottom);
                }).map(b => b.textContent);
                return { top: Math.round(d.top), bottom: Math.round(d.bottom), clueTop: Math.round(clue.top), dockTop: Math.round(dock.top), hits };
            });
            assert(land.top >= -2 && land.bottom <= land.dockTop + 2, 'แนวนอน: หน้าปัดอยู่ในจอเหนือ dock ' + JSON.stringify(land));
            assert(land.clueTop >= -2, 'แนวนอน: เห็นคำใบ้พร้อมหน้าปัด ' + JSON.stringify(land));
            assert(land.hits.length === 0, 'แนวนอน: ปุ่มแชททับ ' + land.hits.join(','));
            { const f = path.join(SHOT_DIR, '11-guess-landscape-844.png'); await v.page.screenshot({ path: f }); shots.push(f); }
            await v.page.setViewportSize({ width: 390, height: 844 });
            await v.page.evaluate(() => window.scrollTo(0, 0));
            await delay(300);
            for (let i = 2; i < 12; i += 1) {
                await ack(big[i].socket, 'wavelength_lock', { value: Math.max(0, Math.min(100, target + (i - 7) * 1.5)), round: 1, phase: 'guess' });
            }
            await drag(v.page, 50, target > 50 ? target - 3 : target + 3);
            await v.page.click('#wlLockBtn');
            await waitFor(async () => !!(await v.page.$('.wl-pin')), 5000, 'big pins');
            await delay(2600);
            const pins = await v.page.$$eval('.wl-pin', els => els.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, text: e.textContent }; }));
            const overlaps = [];
            for (let i = 0; i < pins.length; i += 1) for (let j = i + 1; j < pins.length; j += 1) {
                const a = pins[i], c = pins[j];
                const w = Math.min(a.r, c.r) - Math.max(a.l, c.l), h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
                if (w > 6 && h > 6) overlaps.push(a.text + '×' + c.text);
            }
            assert(overlaps.length === 0, 'ป้ายชื่อบนหน้าปัดซ้อนกัน: ' + overlaps.join(', '));
            assert(pins.some(x => /คุณ/.test(x.text)), 'ป้ายของเราอยู่บนหน้าปัดเสมอ');
            assert(pins.some(x => /\+\d/.test(x.text)), 'คนกระจุกกันรวมเป็น +N');
            assert(await v.page.$('.wl-row.is-me'), 'แถวของเราในผลรอบถูกไฮไลต์');
            const problems = await layoutProblems(v.page);
            assert(problems.length === 0, 'big12 layout: ' + problems.join(' | '));
            const f1 = path.join(SHOT_DIR, '11-reveal-12-dial-390.png');
            await v.page.locator('#wlDialWrap').screenshot({ path: f1 });
            const f2 = path.join(SHOT_DIR, '11-reveal-12-390.png');
            await v.page.screenshot({ path: f2, fullPage: true });
            shots.push(f1, f2);
            // คีย์บอร์ดขึ้น 300px → dock ยกตาม ไม่จมใต้คีย์บอร์ด · คีย์บอร์ดลง → กลับที่เดิม
            const dockShift = await v.page.evaluate(async () => {
                window.__vvH = window.innerHeight - 300;
                window.visualViewport.dispatchEvent(new Event('resize'));
                const up = document.getElementById('wlDock').style.transform;
                window.__vvH = 0;
                window.visualViewport.dispatchEvent(new Event('resize'));
                return { up, down: document.getElementById('wlDock').style.transform };
            });
            assert(/translateY\(-300px\)/.test(dockShift.up) && !dockShift.down, 'dock ยกหนีคีย์บอร์ด: ' + JSON.stringify(dockShift));
            assert(v.errors.length === 0, 'big12 errors: ' + v.errors.join(' | '));
            await v.ctx.close();
        }

        // หน้าวิธีเล่น + รายการห้อง (มีโหมดใหม่)
        {
            const v = await newPage(randomUUID(), { width: 390, height: 844 }, 'howto');
            await v.page.goto(`${base}/how-to-play#wavelength`, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await delay(800);
            const ok = await v.page.$('#wavelength');
            if (ok) {
                await ok.scrollIntoViewIfNeeded();
                const file = path.join(SHOT_DIR, '10-howto-390.png');
                await ok.screenshot({ path: file });
                shots.push(file);
            }
            await v.page.goto(`${base}/rooms`, { waitUntil: 'domcontentloaded' });
            await delay(1200);
            assert(/คลื่นความคิด/.test(await v.page.textContent('body')), 'รายการห้องแสดงห้องคลื่นความคิด');
            assert(v.errors.length === 0, 'howto/rooms errors: ' + v.errors.join(' | '));
            await v.ctx.close();
        }

        assert(!/\[wavelength\].*failed|\[socket:wavelength/.test(server.logs()), 'server errors:\n' + server.logs().split('\n').filter(l => /wavelength/.test(l)).slice(-5).join('\n'));
        console.log(`✅ smoke-wavelength-browser: ${checks} checks · ${shots.length} ภาพ → ${SHOT_DIR}`);
    } catch (error) {
        console.error('❌', error.stack || error.message);
        for (const v of (globalThis.__wlViewers || [])) {
            try {
                const info = await v.page.evaluate(() => ({ url: location.href, now: document.getElementById('wlNowCopy')?.textContent, dock: document.getElementById('wlDock')?.textContent }));
                console.error('   ·', v.label, JSON.stringify(info), v.errors.join(' | '));
                await v.page.screenshot({ path: path.join(SHOT_DIR, `zz-fail-${v.label}.png`), fullPage: true });
            } catch (e) { /* ignore */ }
        }
        process.exitCode = 1;
    } finally {
        sockets.forEach(s => { try { s.close(); } catch (e) { /* ignore */ } });
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await delay(300);
        try { server.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }
    process.exit(process.exitCode || 0);
})();
