/**
 * เศรษฐี 6 คน ในเบราว์เซอร์จริง: มือถือ 390×844 (หัวห้อง) + เดสก์ท็อป 1280×900 (แขก) + บอท 4
 *  - แถบผู้เล่น 6 ใบไม่ทับกัน ไม่ล้นจอ ชื่อ/เงินไม่โดนตัด · ไม่มี scroll แนวนอน
 *  - หมาก 6 ตัวในช่องเดียวกัน (ทุกด้าน + มุม) อยู่ในกรอบช่อง ไม่ซ้อนทับกันจนมองไม่เห็น
 *  - สีเจ้าของบนช่อง = สีหมาก 6 สีไม่ซ้ำกัน
 *  - เมนูทดสอบ /m: เปิด/ปิดได้ ไม่ล้นจอ · เลือกคนเป้าหมายได้ · ไม่ส่งข้อความเข้าแชท
 * ตรวจ: ไม่มี page error / console error
 *
 * รัน: npm run smoke:setthi:6p   (SMOKE_PORT=8862, SHOTS_DIR=<โฟลเดอร์ภาพ>)
 */
const path = require('path');
const fs = require('fs');

if (!process.env.GAME_DATA_DIR) {
    const dir = path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', `browser6-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.env.GAME_DATA_DIR = dir;
    process.env.WALLETS_FILE = path.join(dir, 'wallets.json');
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
require('./isolateTestData');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const PORT = Number(process.env.SMOKE_PORT) || 8862;
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', 'shots-6p');
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|sourcemap|net::ERR_INTERNET|autoplay|play\(\) failed|AudioContext|preload|\.mp3|fonts\.g/i;

const CDN_RE = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;
const CDN_CACHE = process.env.CDN_CACHE_DIR || path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', 'cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
async function cdnRoute(route) {
    const url = route.request().url();
    const key = crypto.createHash('sha1').update(url).digest('hex');
    const bodyFile = path.join(CDN_CACHE, key + '.bin');
    const metaFile = path.join(CDN_CACHE, key + '.json');
    if (fs.existsSync(bodyFile) && fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        await route.fulfill({ status: 200, contentType: meta.contentType, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(bodyFile) });
        return;
    }
    try {
        const resp = await route.fetch({ timeout: 20000 });
        const body = await resp.body();
        if (resp.status() === 200) {
            fs.writeFileSync(bodyFile, body);
            fs.writeFileSync(metaFile, JSON.stringify({ url, contentType: resp.headers()['content-type'] || 'application/octet-stream' }));
        }
        await route.fulfill({ response: resp, body });
    } catch (error) {
        await route.abort().catch(() => {});
    }
}

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), MONGO_URL: '', SETTHI_TEST_HOOKS: '1', SETTHI_TURN_MS: '120000', SETTHI_DECIDE_MS: '120000', SETTHI_DEBT_MS: '120000' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + logs.slice(-500))); });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x || {}); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function openPlayer(browser, base, id, viewport, label, roomId) {
    const mobile = viewport.width < 600;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
    await context.route(CDN_RE, cdnRoute);
    context.setDefaultTimeout(45000);
    context.setDefaultNavigationTimeout(60000);
    await context.addInitScript(() => {
        try {
            sessionStorage.setItem('insiderPromoSeen', '1');
            localStorage.setItem('ig-firstplay-setthi', '1');
            localStorage.setItem('setthiSound', 'off');
        } catch (e) { /* ignore */ }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text().slice(0, 100)); });
    page.on('requestfailed', r => { const why = (r.failure() && r.failure().errorText) || ''; if (!IGNORE.test(r.url()) && !/ERR_ABORTED/.test(why)) errors.push('requestfailed: ' + r.url() + ' ' + why); });
    await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/game/${roomId}?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#stBoard .st-cell', { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = document.getElementById('ppTermsBar'); if (b) b.remove(); });
    return { context, page, errors, label, id };
}
const state = p => p.page.evaluate(() => window.__setthi.state());
async function settle(players) {
    for (let i = 0; i < 80; i += 1) {
        let total = 0;
        for (const p of players) {
            await p.page.evaluate(() => window.__setthi.skip());
            total += await p.page.evaluate(() => window.__setthi.queueLength());
        }
        if (!total) return;
        await delay(120);
    }
}
async function shot(p, name) { await p.page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 60000 }); }

async function layoutProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push('scroll แนวนอน ' + document.documentElement.scrollWidth + ' > ' + vw);
        const skip = e => e.closest('.st-cam, .st-board, .st-tokens, #stFx, .st-sidebar:not(.open), #chatBox, .swal2-container, #ppTermsBar, .st-sheet:not(.is-open), .st-toast');
        document.querySelectorAll('#stRoot *, #stDock *, #stDebug:not([hidden]) *').forEach(e => {
            if (skip(e)) return;
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const st = getComputedStyle(e);
            if (st.visibility === 'hidden' || st.display === 'none') return;
            if (r.right > vw + 1 || r.left < -1) out.push('ล้นจอ: ' + (e.id || e.className || e.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
        });
        return [...new Set(out)].slice(0, 8);
    });
}
/** แถบผู้เล่น: ทุกใบเห็นครบ ไม่ทับกัน ชื่อ/เงินไม่ถูกตัด */
async function stripProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const chips = [...document.querySelectorAll('#stStrip .st-chip')];
        if (chips.length !== 6) out.push('มีแถบผู้เล่น ' + chips.length + ' ใบ');
        const rects = chips.map(c => c.getBoundingClientRect());
        rects.forEach((a, i) => {
            if (a.left < -1 || a.right > innerWidth + 1) out.push('ใบ ' + i + ' ล้นจอ');
            rects.forEach((b, j) => { if (j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push('ใบ ' + i + ' ทับใบ ' + j); });
        });
        chips.forEach((c, i) => {
            const cash = c.querySelector('.st-chip-cash');
            if (cash && cash.scrollWidth > cash.clientWidth + 1) out.push('เงินใบ ' + i + ' ถูกตัด "' + cash.textContent + '"');
            if (cash && cash.getBoundingClientRect().width < 30) out.push('เงินใบ ' + i + ' แคบเกิน');
        });
        const board = document.querySelector('#stFrame').getBoundingClientRect();
        const strip = document.querySelector('#stStrip').getBoundingClientRect();
        if (innerWidth < 1000 && strip.bottom > board.top + 1) out.push('แถบผู้เล่นทับกระดาน');
        return out;
    });
}
/** หมากทุกตัวอยู่ในกรอบช่อง (ทั้งตัว ไม่ใช่แค่จุดกลาง) และไม่ทับกันจนซ่อนกัน */
async function tokenProblems(page) {
    return page.evaluate(() => {
        const S = window.__setthi.state();
        const out = [];
        const pieces = [...document.querySelectorAll('#stTokens .st-piece')];
        const boxes = [];
        (S.seats || []).forEach((s, k) => {
            if (s.bankrupt || s.left) return;
            const t = pieces[k];
            const cell = document.querySelector('.st-cell[data-i="' + s.pos + '"]');
            if (!t || !cell) { out.push('ไม่มีหมาก ' + s.name); return; }
            const r = t.getBoundingClientRect();
            const c = cell.getBoundingClientRect();
            if (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1) out.push(`${s.name}@${s.pos} หลุดกรอบช่อง`);
            boxes.push({ name: s.name, pos: s.pos, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
        });
        boxes.forEach((a, i) => boxes.forEach((b, j) => {
            if (j <= i || a.pos !== b.pos) return;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < a.w * 0.7) out.push(`${a.name} ทับ ${b.name} @${a.pos} (${d.toFixed(1)}px)`);
        }));
        return out;
    });
}

async function main() {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch();
    const started = Date.now();
    try {
        const ids = [randomUUID(), randomUUID()];
        const sockets = [];
        for (const id of ids) { const s = await conn(base); s.emit('initPlayer', id); sockets.push(s); }
        await delay(500);
        const created = await ack(sockets[0], 'createRoom', { playerId: ids[0], name: 'เศรษฐี 6 คน', gameMode: 'setthi', maxPlayers: 6, setthiMinutes: 30 });
        assert(created && created.success, 'สร้างห้องได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        sockets[0].emit('setRoom', { roomId, playerId: ids[0] });
        const j = await ack(sockets[1], 'joinRoom', { roomId, playerId: ids[1] });
        assert(j && j.success, 'join ได้');
        sockets[1].emit('setRoom', { roomId, playerId: ids[1] });
        const bots = await ack(sockets[0], 'setthi_addBots', { roomId, count: 9 });
        assert(bots.success && bots.added === 4, 'เพิ่มบอทได้ 4 จนเต็ม 6: ' + JSON.stringify(bots));
        const full = await ack(sockets[0], 'setthi_addBots', { roomId, count: 1 });
        assert(!full.success, 'เต็ม 6 แล้วเพิ่มบอทไม่ได้');
        await delay(300);
        assert((await ack(sockets[0], 'startGameFromLobby', { roomId })).success, 'เริ่มเกม 6 คนได้');
        await delay(3600);
        const phone = await openPlayer(browser, base, ids[0], { width: 390, height: 844 }, 'phone', roomId);
        const desk = await openPlayer(browser, base, ids[1], { width: 1280, height: 900 }, 'desktop', roomId);
        const players = [phone, desk];
        sockets.forEach(s => s.close());
        await delay(800);
        await settle(players);
        const S0 = await state(phone);
        assert(S0.seats.length === 6, 'เกม 6 ที่นั่ง');
        assert(new Set(S0.seats.map(s => s.tokenColor)).size === 6, 'สีหมาก 6 สีไม่ซ้ำ');

        async function setup(spec) {
            const r = await phone.page.evaluate(sp => window.__setthi.emit('setthi_testSetup', { spec: sp }), spec);
            assert(r.success, 'testSetup: ' + r.error);
            await delay(500);
            await settle(players);
        }
        const all = pos => Object.fromEntries([0, 1, 2, 3, 4, 5].map(k => [k, { pos, island: 0, tourPending: false }]));

        // ---------- หมาก 6 ตัวช่องเดียวกัน ทุกด้าน + มุม ----------
        for (const pos of [0, 2, 8, 10, 16, 19, 24, 28, 31]) {
            await setup({ resetSeats: true, seats: all(pos), turnSeat: 0 });
            for (const p of players) {
                const probs = await tokenProblems(p.page);
                assert(!probs.length, `${p.label} หมาก 6 ตัว @${pos}: ${probs.join(' | ')}`);
            }
            if (pos === 2 || pos === 19) for (const p of players) await shot(p, `tokens6-${p.label}-sq${pos}`);
        }
        console.log('1. หมาก 6 ตัวในช่องเดียวกัน (มุม · ล่าง · ซ้าย · บน · ขวา): อยู่ในกรอบช่อง ไม่ทับกัน ✓');

        // ---------- แถบผู้เล่น 6 ใบ + layout ----------
        for (const p of players) {
            const sp = await stripProblems(p.page);
            assert(!sp.length, `${p.label} แถบผู้เล่น: ${sp.join(' | ')}`);
            const lp = await layoutProblems(p.page);
            assert(!lp.length, `${p.label} layout: ${lp.join(' | ')}`);
        }
        console.log('2. แถบผู้เล่น 6 ใบ (390×844 = 3×2 · เดสก์ท็อป = คอลัมน์ซ้าย) ไม่ทับ ไม่ล้น เงินไม่ถูกตัด ✓');

        // ---------- สีเจ้าของ 6 สี ----------
        const owned = { 1: { owner: 0, level: 1 }, 2: { owner: 1, level: 1 }, 4: { owner: 2, level: 1 }, 6: { owner: 3, level: 1 }, 7: { owner: 4, level: 1 }, 9: { owner: 5, level: 1 } };
        await setup({ resetProps: true, props: owned, seats: all(0), turnSeat: 0 });
        for (const p of players) {
            const colors = await p.page.evaluate(() => [1, 2, 4, 6, 7, 9].map(i => getComputedStyle(document.querySelector('.st-cell[data-i="' + i + '"]')).getPropertyValue('--own').trim().toLowerCase()));
            const seatColors = (await state(p)).seats.map(s => s.tokenColor.toLowerCase());
            assert(colors.join(',') === seatColors.join(','), `${p.label} สีเจ้าของบนช่องตรงกับสีหมาก: ${colors} vs ${seatColors}`);
            await shot(p, `owners6-${p.label}`);
        }
        console.log('3. สีเจ้าของบนช่อง = สีหมากของ 6 คน ไม่ซ้ำกัน ✓');

        for (const p of players) assert(!p.errors.length, `${p.label} มี error: ${p.errors.slice(0, 3).join(' | ')}`);
        assert(!/\[setthi\][^\n]*failed/.test(server.logs()), 'เซิร์ฟเวอร์ไม่มี error ของเศรษฐี');
        console.log(`✅ setthi 6p browser: ${checks} checks · ภาพที่ ${SHOTS} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await delay(300);
    }
}

main().then(() => process.exit(0)).catch(error => {
    console.error('❌ setthi 6p browser:', error.stack || error.message);
    process.exit(1);
});
