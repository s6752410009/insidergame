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

        // ---------- เมนูทดสอบ /m (มือถือ 390×844) ----------
        // แขกพิมพ์ /m โดนปฏิเสธ
        assert(await desk.page.evaluate(() => window.__setthi.openDebug()), 'แขกเรียก /m');
        await desk.page.waitForSelector('.swal2-popup', { timeout: 8000 });
        assert(/แอดมินหรือหัวห้อง/.test(await desk.page.textContent('.swal2-popup')), 'แขกใช้ /m ไม่ได้');
        await desk.page.click('.swal2-confirm');
        assert(await desk.page.isHidden('#stDebug'), 'เมนูไม่เปิดให้แขก');
        // หัวห้องเปิดเมนู
        await phone.page.evaluate(() => window.__setthi.openDebug());
        await phone.page.waitForSelector('#stDebug:not([hidden])');
        const panelFits = await phone.page.evaluate(() => { const r = document.getElementById('stDebug').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight + 1; });
        assert(panelFits, 'เมนูอยู่ในจอ 390×844');
        const tgtCount = await phone.page.locator('#stDbgTargets .st-dbg-tgt').count();
        assert(tgtCount === 6, 'เลือกเป้าหมายได้ 6 คน (' + tgtCount + ')');
        assert((await phone.page.textContent('#stDbgTargetName')).trim() === 'คุณ', 'เป้าหมายเริ่มต้น = ตัวเอง');
        await shot(phone, 'debug-menu-open');
        // เลือกบอทที่นั่ง 4 เป็นเป้าหมาย
        const S1 = await state(phone);
        const botSeat = S1.seats[4];
        await phone.page.click(`#stDbgTargets [data-tgt="${botSeat.playerId}"]`);
        assert((await phone.page.textContent('#stDbgTargetName')).trim() === botSeat.name, 'เห็นชัดว่าทำกับใคร');
        // เงิน: ตั้งเป็น 4,321
        await phone.page.click('#stDebug details:has(#stDbgAmt) > summary');
        await phone.page.fill('#stDbgAmt', '4321');
        await phone.page.click('#stDebug [data-dbg="setCash"]');
        await phone.page.waitForFunction(id => window.__setthi.state().seats.find(s => s.playerId === id).cash === 4321, botSeat.playerId, { timeout: 8000 });
        await phone.page.waitForSelector('#stDbgStatus.is-on', { timeout: 5000 });
        assert(/4,321/.test(await phone.page.textContent('#stDbgStatus')), 'ยืนยันในเมนูของคนกด');
        // ช่อง: แตะเลือกบนกระดาน (เมนูย่อให้เห็นกระดาน) → ให้เป็นโรงแรม
        await phone.page.click('#stDebug details:has(#stDbgPickSq) > summary');
        await phone.page.click('#stDbgPickSq');
        const coversBoard = await phone.page.evaluate(() => {
            const d = document.getElementById('stDebug').getBoundingClientRect();
            const c = document.querySelector('.st-cell[data-i="14"]').getBoundingClientRect();
            return d.bottom > c.top && d.top < c.bottom && d.left < c.right && d.right > c.left;
        });
        assert(!coversBoard, 'ตอนเลือกช่อง เมนูไม่บังช่องบนกระดาน');
        await shot(phone, 'debug-menu-picking');
        await phone.page.click('.st-cell[data-i="14"]');
        assert(/ลพบุรี/.test(await phone.page.textContent('#stDbgSqName')), 'เลือกลพบุรี');
        assert(await phone.page.isVisible('#stDbgLevel'), 'เมนูกลับมาหลังเลือกช่อง');
        await phone.page.selectOption('#stDbgLevel', '3');
        await phone.page.click('#stDebug [data-dbg="propGive"]');
        await phone.page.waitForFunction(id => { const p = window.__setthi.state().props[14]; return p && p.owner === id && p.level === 3; }, botSeat.playerId, { timeout: 8000 });
        await desk.page.waitForFunction(id => { const p = window.__setthi.state().props[14]; return p && p.owner === id; }, botSeat.playerId, { timeout: 8000 });
        // งานวัด ×4 ช่องเดียวกัน
        await phone.page.selectOption('#stDbgMult', '4');
        await phone.page.click('#stDebug [data-dbg="festival"]');
        await phone.page.waitForFunction(() => window.__setthi.state().festival === 14 && window.__setthi.state().festivalMult === 4, null, { timeout: 8000 });
        // เวลา +5 นาที
        const endsBefore = (await state(phone)).clock.endsAt;
        await phone.page.click('#stDebug details:has([data-min="5"]) > summary');
        await phone.page.click('#stDebug [data-dbg="clock"][data-min="5"]');
        await phone.page.waitForFunction(e => window.__setthi.state().clock.endsAt >= e + 5 * 60000 - 10, endsBefore, { timeout: 8000 });
        // เกาะ: ส่งบอทไปเกาะ
        await phone.page.click('#stDebug details:has([data-dbg="islandOn"]) > summary');
        await phone.page.click('#stDebug [data-dbg="islandOn"]');
        await phone.page.waitForFunction(id => window.__setthi.state().seats.find(s => s.playerId === id).island > 0, botSeat.playerId, { timeout: 8000 });
        const lp = await layoutProblems(phone.page);
        assert(!lp.length, 'เมนูเปิดอยู่ ไม่ล้นจอ: ' + lp.join(' | '));
        await shot(phone, 'debug-menu-sections');
        await settle(players);
        // แขกไม่เห็นอะไรแจ้งเลย นอกจากป้าย 🛠 เล็กที่แถบหัวห้อง
        await desk.page.waitForSelector(`#stStrip .st-chip[data-id="${S1.seats[0].playerId}"] .st-dbg-mark`, { timeout: 8000 });
        const deskNoise = await desk.page.evaluate(() => ({
            toast: [...document.querySelectorAll('.st-toast')].some(t => /🛠|เมนูทดสอบ|ตั้งเงิน/.test(t.textContent)),
            chat: /เมนูทดสอบ|ตั้งเงิน/.test((document.getElementById('chatMessages') || {}).textContent || ''),
            log: window.__setthi.state().history.some(h => /เมนูทดสอบ|ตั้งเงิน/.test(h.text))
        }));
        assert(!deskNoise.toast && !deskNoise.chat && !deskNoise.log, 'แขกไม่เห็นแจ้งเตือน /m: ' + JSON.stringify(deskNoise));
        // ปิดเมนูได้
        await phone.page.click('#stDebugClose');
        assert(await phone.page.isHidden('#stDebug'), 'ปิดเมนูได้');
        console.log('4. /m มือถือ: แขกโดนปฏิเสธ · เลือกเป้าหมาย 6 คน · ตั้งเงิน · แตะช่องบนกระดาน → ให้โรงแรม · งานวัด ×4 · +5 นาที · ส่งเกาะ · ไม่ล้นจอ · แขกไม่เห็นแจ้งเตือน · ปิดได้ ✓');

        // ---------- กติกาแนว LGR ผ่าน UI ----------
        const emit = (p, ev, payload) => p.page.evaluate(([e, pl]) => window.__setthi.emit(e, pl), [ev, payload]);
        const waitState = (p, fn, arg, label) => p.page.waitForFunction(fn, arg, { timeout: 15000 }).catch(() => { throw new Error('timeout: ' + label); });
        // ครบสี ×2: ป้าย ×2 บนช่อง + ค่าผ่านทางสองเท่า
        await setup({ resetProps: true, resetSeats: true, props: { 1: { owner: 1, level: 1 }, 2: { owner: 1, level: 1 } }, seats: all(0), turnSeat: 0 });
        for (const p of players) {
            const set = await p.page.evaluate(() => ({ cls: document.querySelector('.st-cell[data-i="1"]').classList.contains('is-set'), x2: getComputedStyle(document.querySelector('.st-cell[data-i="1"] .st-setx')).display !== 'none', val: document.querySelector('.st-cell[data-i="1"] .st-val').textContent, toll: window.__setthi.state().tolls[1] }));
            assert(set.cls && set.x2, p.label + ' ช่องครบสีมีป้าย ×2');
            assert(set.toll === 2 * 500, p.label + ' ค่าผ่านทางยโสธรครบสี = ฿1,000: ' + set.toll);
            assert(/1k|1,000|1000/.test(set.val), p.label + ' ช่องโชว์ค่าผ่านทาง ×2: ' + set.val);
        }
        await shot(phone, 'lgr-colorset');
        console.log('5. ครบสี: ป้าย ×2 บนช่อง · ค่าผ่านทางสองเท่า ✓');

        // การ์ดหนีเกาะ: ปุ่มบนแผงตา → ออกฟรี
        await setup({ resetSeats: true, seats: { ...all(0), 0: { pos: 8, island: 3, escape: true } }, turnSeat: 0 });
        await phone.page.waitForSelector('#stUseEscape:not([disabled])', { timeout: 10000 });
        await shot(phone, 'lgr-escape-button');
        const badge = await desk.page.textContent(`#stStrip .st-chip[data-id="${S0.seats[0].playerId}"] .st-badge`);
        assert(/🏝️/.test(badge), 'แขกเห็นว่าหัวห้องติดเกาะ');
        await phone.page.click('#stUseEscape');
        await waitState(phone, () => { const S = window.__setthi.state(); return S.seats[0].island === 0 && !S.seats[0].escape && S.phase === 'roll'; }, null, 'ใช้การ์ดหนีเกาะ');
        await settle(players);
        console.log('6. การ์ดหนีเกาะ: ปุ่ม "⛵ ใช้การ์ดหนีเกาะ" → ออกจากเกาะฟรีแล้วทอยต่อ ✓');

        // การ์ดบังคับขาย: ทอยตกโอกาส → การ์ดพลิก → แตะเมืองคนอื่น → คืนธนาคาร
        await setup({ resetProps: true, resetSeats: true, props: { 9: { owner: 2, level: 2 }, 10: { owner: 3, level: 4 } }, seats: all(0), dice: [[1, 2]], nextCard: 'k13', turnSeat: 0 });
        const rr = await emit(phone, 'setthi_roll', { seq: (await state(phone)).phaseSeq });
        assert(rr.success, 'ทอย: ' + rr.error);
        await waitState(desk, () => window.__setthi.state().fx.some(f => f.kind === 'card' && f.card.id === 'k13'), null, 'แขกเห็นการ์ดบังคับขาย');
        await settle(players);
        await phone.page.waitForSelector('#stPickbar.is-on', { timeout: 10000 });
        const pickable = await phone.page.evaluate(() => [...document.querySelectorAll('.st-cell.is-pickable')].map(c => Number(c.dataset.i)));
        assert(pickable.join() === '9', 'แตะได้เฉพาะเมืองคนอื่นที่ไม่ใช่แลนด์มาร์ก: ' + pickable);
        await shot(phone, 'lgr-forced-sale-pick');
        await phone.page.click('.st-cell[data-i="9"]');
        await waitState(desk, () => window.__setthi.state().fx.some(f => f.kind === 'attack' && f.attack === 'forcedSale'), null, 'ฉากบังคับขาย');
        await desk.page.waitForSelector('#stFx .st-attack-stamp, #stFx .st-banner', { timeout: 8000 });
        await delay(500);
        await shot(desk, 'lgr-forced-sale-cut');
        await settle(players);
        assert((await state(desk)).props[9].owner === null, 'น่านคืนธนาคาร');
        console.log('7. การ์ดบังคับขาย: การ์ดพลิก → แตะเมืองคนอื่น (แลนด์มาร์กแตะไม่ได้) → ฉากค้อน → คืนธนาคาร ✓');

        // ชนะผูกขาดท่องเที่ยวด้วยเมนูทดสอบ → หน้าสรุปบอกแบบชนะ
        await setup({ resetProps: true, resetSeats: true, seats: all(0), turnSeat: 0 });
        const nm = await emit(phone, 'setthi_debug', { action: 'nearMonopoly', target: S0.seats[0].playerId, type: 'tourist' });
        assert(nm.success, 'จัดเกือบผูกขาด: ' + nm.error);
        await settle(players);
        await waitState(desk, () => window.__setthi.state().fx.some(f => f.kind === 'threat' && f.type === 'tourist'), null, 'ฉากเตือนผูกขาด');
        const r2 = await emit(phone, 'setthi_roll', { seq: (await state(phone)).phaseSeq });
        assert(r2.success, 'ทอย 2: ' + r2.error);
        await settle(players);
        await phone.page.waitForSelector('.st-sheet.is-open #stBuildBtn:not([disabled])', { timeout: 15000 });
        await phone.page.click('#stBuildBtn');
        for (const p of players) await p.page.waitForSelector('#stEnd.is-on .st-end-mono', { timeout: 30000 });
        const fin = await state(phone);
        assert(fin.winType === 'tourist' && fin.endCause === 'monopoly', 'winType tourist: ' + fin.winType);
        assert(/ผูกขาดท่องเที่ยว/.test(await desk.page.textContent('#stEnd .st-end-mono')), 'หน้าสรุปบอกแบบชนะ');
        await delay(800);
        await shot(phone, 'lgr-end-tourist');
        const endProbs = await layoutProblems(phone.page);
        assert(!endProbs.length, 'หน้าสรุป 6 คนไม่ล้น: ' + endProbs.join(' | '));
        console.log('8. เตือนผูกขาด → ชนะผูกขาดท่องเที่ยว → หน้าสรุปบอก "👑 ผูกขาดท่องเที่ยว" (winType=tourist) ✓');

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
