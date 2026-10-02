/**
 * คลื่นความคิด — เล่นจริงในเบราว์เซอร์ 3 จอ (390×844) + บอท socket 1 ตัว + เดสก์ท็อป 1280×900
 * ลากเข็มบนหน้าปัดจริง พิมพ์คำใบ้จริง จบเกมเห็นโพเดียม
 * เช็ก: ไม่มี page/console error · ไม่เลื่อนแนวนอน · ข้อความไม่ล้น · ปุ่ม ≥ 44px · เป้าไม่อยู่ใน DOM ของคนทาย
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
    while (Date.now() < until) { const v = await fn(); if (v) return v; await delay(80); }
    throw new Error('รอไม่ถึง: ' + label);
}
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic/i;

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
        const created = await ack(ps[0].socket, 'createRoom', { playerId: ps[0].id, name: 'คลื่นความคิด', gameMode: 'wavelength', maxPlayers: 8 });
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
        await p2.page.click('#wlReadyBtn');
        await waitFor(async () => /พร้อมแล้ว/.test(await p2.page.textContent('#wlDock')), 3000, 'p2 ready');
        await host.page.click('#wlNextBtn');
        await waitFor(() => p1.page.$('.wl-option'), 5000, 'r2 options');
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
            await v.page.click('#wlLockBtn'); // ไม่ขยับเลย = กลางหน้าปัด
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
        }
        const broken = await host.page.evaluate(() => Array.from(document.images).filter(i => i.getAttribute('src') && i.naturalWidth === 0).map(i => i.getAttribute('src')));
        assert(broken.length === 0, 'รูปแตก: ' + broken.join(', '));

        // กลับห้องรอพร้อมกัน
        await host.page.click('#wlBackBtn');
        await waitFor(async () => /\/room\//.test(p1.page.url()), 6000, 'p1 back to lobby');
        await delay(800);
        for (const v of viewers) assert(v.errors.length === 0, `${v.label}: ${v.errors.join(' | ')}`);

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
