/**
 * เศรษฐี ในเบราว์เซอร์จริง: มือถือ 3 เครื่อง (390×844) + เดสก์ท็อป (1280×900) เล่นผ่าน UI
 *  - ทอย/ซื้อ/สร้าง/ผ่าน ด้วยปุ่มจริง · จัดฉากด้วย setthi_testSetup (เปิดเฉพาะ SETTHI_TEST_HOOKS=1) แล้วกดผ่าน UI:
 *    แผ่นซื้อหลายขั้น · แผ่นแวบบนเครื่องอื่น · ซื้อต่อ (คนโดนซื้อเห็นฉาก) · แลนด์มาร์ก · ทัวร์แตะช่อง · งานวัดซ้อน
 *    ตกจุดเริ่มอัปฟรี · ขายที่ตอนเงินไม่พอ · เกาะร้าง · /m · ผูกขาดชนะจริง → หน้าสรุป
 *  - ถ่ายภาพทุกฉากไว้ดูด้วยตา · ตรวจ 6 ขนาดจอ (กระดานไม่ทับแผงข้าง/หัว)
 * ตรวจ: ไม่มี page error / console error · ไม่มี scroll แนวนอน · ไม่มีข้อความล้น · หมากทุกตัวอยู่ในกรอบช่องของตัวเอง
 *
 * รัน: npm run smoke:setthi:browser   (SMOKE_PORT=8851, SHOTS_DIR=<โฟลเดอร์ภาพ>)
 */
const path = require('path');
const fs = require('fs');

if (!process.env.GAME_DATA_DIR) {
    const dir = path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', `browser-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.env.GAME_DATA_DIR = dir;
    process.env.WALLETS_FILE = path.join(dir, 'wallets.json');
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const PORT = Number(process.env.SMOKE_PORT) || 8851;
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, '..', '..', '..', 'newgames', 'setthi-v2');
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|sourcemap|net::ERR_INTERNET|autoplay|play\(\) failed|AudioContext|preload|\.mp3|fonts\.g/i;

// ไฟล์จาก CDN (ฟอนต์ Google, Font Awesome, SweetAlert2) โหลดครั้งเดียวแล้วเก็บไว้ในเครื่อง — เทสไม่ขึ้นกับเน็ตภายนอก
const crypto = require('crypto');
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
        env: {
            ...process.env,
            PORT: String(port),
            SETTHI_TEST_HOOKS: '1',
            SETTHI_TURN_MS: '120000',
            SETTHI_DECIDE_MS: '120000',
            SETTHI_DEBT_MS: '120000'
        },
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
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function layoutProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push('scroll แนวนอน ' + document.documentElement.scrollWidth + ' > ' + vw);
        const skip = e => e.closest('.st-cam, .st-board, .st-tokens, #stFx, .st-sidebar:not(.open), #chatBox, .swal2-container, #ppTermsBar, .st-sheet:not(.is-open), .st-toast, #stDebug');
        document.querySelectorAll('#stRoot *, #stDock *, #stSheet.is-open *, #stEnd.is-on *').forEach(e => {
            if (skip(e)) return;
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const st = getComputedStyle(e);
            if (st.visibility === 'hidden' || st.display === 'none') return;
            if (r.right > vw + 1 || r.left < -1) out.push('ล้นจอ: ' + (e.id || e.className || e.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
            if (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1
                && st.overflow !== 'hidden' && st.textOverflow !== 'ellipsis' && st.overflowX !== 'auto') {
                const p = e.parentElement;
                const ps = p && getComputedStyle(p);
                if (!(ps && (ps.textOverflow === 'ellipsis' || ps.overflow === 'hidden'))) out.push('ข้อความล้น: ' + (e.className || e.tagName) + ' "' + e.textContent.trim().slice(0, 24) + '"');
            }
        });
        return [...new Set(out)].slice(0, 8);
    });
}

async function openPlayer(browser, base, id, viewport, label, roomId, extra = {}) {
    const mobile = viewport.width < 600;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile, ...extra });
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
    let prevUrl = '';
    let curUrl = '';
    page.on('framenavigated', f => { if (f === page.mainFrame()) { prevUrl = curUrl; curUrl = f.url(); } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
        if (m.type() !== 'error' || IGNORE.test(m.text())) return;
        if (/beforeunload/.test(m.text()) && /\/room\//.test(prevUrl)) return;
        errors.push('console: ' + m.text().slice(0, 80) + ' @ ' + page.url());
    });
    // ยกเลิกเพราะเปลี่ยนหน้า/ปิดหน้า (ERR_ABORTED) ไม่ใช่ error · 404 จริงจะโผล่เป็น console error
    page.on('requestfailed', r => { const why = (r.failure() && r.failure().errorText) || ''; if (!IGNORE.test(r.url()) && !/ERR_ABORTED/.test(why)) errors.push('requestfailed: ' + r.url() + ' ' + why); });
    await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/game/${roomId}?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#stBoard .st-cell', { timeout: 15000 });
    await page.waitForTimeout(400);
    return { context, page, errors, label, id };
}

const state = p => p.page.evaluate(() => window.__setthi.state());
const busy = p => p.page.evaluate(() => window.__setthi.queueLength());
async function skipAll(players) {
    for (let i = 0; i < 60; i += 1) {
        let total = 0;
        for (const p of players) {
            await p.page.evaluate(() => window.__setthi.skip());
            total += await busy(p);
        }
        if (!total) return;
        await delay(120);
    }
}
/** คลิกถ้าปุ่มอยู่ เห็นได้ และกดได้ · ใช้ locator (หาใหม่ทุกครั้ง) เพราะแผงล่างวาดใหม่ทุกครั้งที่ state เปลี่ยน */
async function clickIf(p, sel) {
    const loc = p.page.locator(sel).first();
    try {
        if (!(await loc.count())) return false;
        if (!(await loc.isVisible()) || (await loc.isDisabled())) return false;
        await loc.click({ timeout: 3000 });
        return true;
    } catch (error) {
        // ปุ่มถูกวาดใหม่/หายไประหว่างทาง = รอบนี้ยังกดไม่ได้ ลองใหม่รอบหน้า
        if (process.env.DEBUG_SETTHI) console.log('   click skip', sel, p.label, error.message.split('\n')[0]);
        return false;
    }
}
async function shot(p, name) {
    await p.page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 60000 });
}

/** หมากทุกตัวต้องอยู่ "ในกรอบช่อง" ของตัวเอง (จุดกึ่งกลางหมากอยู่ในกรอบช่อง) */
async function tokenProblems(page) {
    return page.evaluate(() => {
        const S = window.__setthi.state();
        const out = [];
        const pieces = [...document.querySelectorAll('#stTokens .st-piece')];
        (S.seats || []).forEach((s, k) => {
            if (s.bankrupt || s.left) return;
            const t = pieces[k];
            const cell = document.querySelector('.st-cell[data-i="' + s.pos + '"]');
            if (!t || !cell) return;
            const r = t.getBoundingClientRect();
            const c = cell.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            if (!(cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom)) out.push(`${s.name}@${s.pos}`);
        });
        return out;
    });
}
/** กระดานต้องไม่ทับแผงข้าง/หัว */
async function overlapProblems(page) {
    return page.evaluate(() => {
        const rect = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? b : null; };
        const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const board = rect('#stFrame');
        const out = [];
        [['.st-strip', 'แถบผู้เล่น'], ['#stDock', 'แผงตา'], ['.st-top', 'หัว'], ['#stAlerts', 'เตือน']].forEach(([s, n]) => { if (hit(board, rect(s))) out.push('กระดานทับ' + n); });
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push('scroll แนวนอน');
        if (board && innerWidth >= 1000 && board.bottom > innerHeight + 1) out.push('กระดานล้นจอล่าง');
        return out;
    });
}

async function main() {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch();
    const started = Date.now();
    try {
        const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const sockets = [];
        for (const id of ids) { const s = await conn(base); s.emit('initPlayer', id); sockets.push(s); }
        await delay(500);
        const created = await ack(sockets[0], 'createRoom', { playerId: ids[0], name: 'วงเศรษฐี', gameMode: 'setthi', maxPlayers: 4, setthiMinutes: 30 });
        assert(created && created.success, 'สร้างห้องได้');
        const roomId = created.roomId;
        sockets[0].emit('setRoom', { roomId, playerId: ids[0] });
        for (let i = 1; i < 4; i += 1) {
            const r = await ack(sockets[i], 'joinRoom', { roomId, playerId: ids[i] });
            assert(r && r.success, 'join ได้');
            sockets[i].emit('setRoom', { roomId, playerId: ids[i] });
        }
        await delay(300);
        assert((await ack(sockets[0], 'startGameFromLobby', { roomId })).success, 'เริ่มเกมได้');
        await delay(3600);
        const phones = [];
        for (let i = 0; i < 3; i += 1) phones.push(await openPlayer(browser, base, ids[i], { width: 390, height: 844 }, 'phone' + (i + 1), roomId));
        const desk = await openPlayer(browser, base, ids[3], { width: 1280, height: 900 }, 'desktop', roomId);
        const players = [...phones, desk];
        sockets.forEach(s => s.close());
        await delay(900);
        await skipAll(players);
        for (const p of players) await p.page.evaluate(() => { const b = document.getElementById('ppTermsBar'); if (b) b.remove(); });
        const host = phones[0];
        const seatIdx = async p => (await state(p)).seats.findIndex(s => s.playerId === p.id);
        const idx = {};
        for (const p of players) idx[p.label] = await seatIdx(p);
        async function setup(spec) {
            const r = await host.page.evaluate(sp => window.__setthi.emit('setthi_testSetup', { spec: sp }), spec);
            assert(r && r.success, 'setup: ' + JSON.stringify(r));
            await delay(700);
            await skipAll(players);
            await delay(250);
        }
        async function waitPhase(p, phase, ms = 15000) {
            try {
                await p.page.waitForFunction(ph => { const S = window.__setthi.state(); return S && S.phase === ph && S.phaseActor === window.SETTHI_BOOT.playerId && !window.__setthi.running(); }, phase, { timeout: ms });
            } catch (error) {
                const info = await p.page.evaluate(() => { const S = window.__setthi.state(); return { phase: S.phase, actor: S.phaseActor, me: window.SETTHI_BOOT.playerId, running: window.__setthi.running(), q: window.__setthi.queueLength(), last: (S.history || []).slice(0, 4).map(h => h.text) }; });
                throw new Error(`${p.label} รอเฟส ${phase} ไม่มา: ${JSON.stringify(info)}`);
            }
        }
        /** กดทอยจริง (แตะ = pointerdown/up) · แผงล่างวาดใหม่ระหว่างทางได้ — กดซ้ำจนเซิร์ฟเวอร์รับ */
        async function roll(p) {
            for (let k = 0; k < 5; k += 1) {
                await p.page.waitForSelector('#stRollBtn:not([disabled])', { timeout: 15000 });
                const seq = (await state(p)).turn.seq;
                await p.page.click('#stRollBtn').catch(() => {});
                const ok = await p.page.waitForFunction(q => { const S = window.__setthi.state(); return S.turn && (S.turn.seq !== q || S.turn.hasRolled); }, seq, { timeout: 3000 }).then(() => true, () => false);
                if (ok) return;
            }
            throw new Error(p.label + ' ทอยไม่ได้');
        }
        async function check(p, label) {
            const lay = await layoutProblems(p.page);
            assert(!lay.length, `${p.label} ${label} layout: ${lay.join(' | ')}`);
            const tok = await tokenProblems(p.page);
            assert(!tok.length, `${p.label} ${label} หมากไม่อยู่ในช่อง: ${tok.join(', ')}`);
            const ov = await overlapProblems(p.page);
            assert(!ov.length, `${p.label} ${label}: ${ov.join(', ')}`);
        }
        for (const p of players) await check(p, 'ตอนเริ่ม');
        console.log('1. 4 คน (3 มือถือ + เดสก์ท็อป) เปิดกระดาน · ไม่ล้น ไม่ทับ หมากอยู่ในช่อง ✓');

        // ---------- เล่นจริงผ่าน UI ----------
        let actions = 0;
        const until = Date.now() + 90000;
        while (actions < 14 && Date.now() < until) {
            const S = await state(host);
            if (S.phase === 'finished') break;
            const actor = players.find(p => p.id === S.phaseActor);
            if (!actor) { await delay(200); continue; }
            if (await busy(actor)) { await actor.page.evaluate(() => window.__setthi.skip()); await delay(150); continue; }
            let did = false;
            if (S.phase === 'roll') did = await clickIf(actor, '#stRollBtn');
            else if (S.phase === 'build') did = (await clickIf(actor, '.st-sheet.is-open .st-tile.is-open')) && (await clickIf(actor, '#stBuildBtn')) || await clickIf(actor, '#stBuildBtn') || await clickIf(actor, '#stPassBtn') || await clickIf(actor, '#stOpenDecision');
            else if (S.phase === 'takeover') did = await clickIf(actor, '#stNoTakeBtn') || await clickIf(actor, '#stOpenDecision');
            else if (S.phase === 'pick') did = await clickIf(actor, '#stSkipPick');
            else if (S.phase === 'debt') did = await clickIf(actor, '.st-sheet.is-open .st-sell') || await clickIf(actor, '#stOpenSell');
            if (did) actions += 1;
            await delay(350);
        }
        assert(actions >= 10, 'เล่นผ่าน UI ได้หลายจังหวะ: ' + actions);
        await skipAll(players);
        console.log(`2. เล่นจริงผ่านปุ่ม (ทอย · ซื้อ/สร้าง · ผ่าน) ${actions} จังหวะ ✓`);

        // ---------- กระดานกลางเกม: เจ้าของ ขั้น ค่าผ่านทาง แลนด์มาร์ก หมาก ----------
        const P = idx.phone1, Q = idx.phone2, R = idx.phone3, D = idx.desktop;
        const midProps = {
            1: { owner: P, level: 1 }, 2: { owner: P, level: 2 }, 5: { owner: P }, 14: { owner: P, level: 3 }, 15: { owner: P, level: 0 },
            4: { owner: Q, level: 3 }, 6: { owner: Q, level: 4 }, 7: { owner: Q, level: 1 }, 21: { owner: Q },
            9: { owner: R, level: 2 }, 10: { owner: R, level: 1 }, 11: { owner: R }, 12: { owner: R, level: 0 },
            17: { owner: D, level: 3 }, 18: { owner: D, level: 2 }, 22: { owner: D, level: 1 }, 28: { owner: D, level: 4, stars: 2 }, 30: { owner: D, level: 0 }
        };
        await setup({ props: midProps, festival: 14, festivalMult: 4, seats: { [P]: { pos: 6, laps: 1 }, [Q]: { pos: 6 }, [R]: { pos: 6 }, [D]: { pos: 8, island: 2 } }, turnSeat: P });
        await shot(host, 'board-mobile');
        await shot(desk, 'board-desktop');
        for (const p of players) await check(p, 'กลางเกม');
        const own = await host.page.evaluate(() => {
            const S = window.__setthi.state();
            const want = Object.keys(S.props).filter(k => S.props[k].owner).sort().join();
            const got = [...document.querySelectorAll('.st-cell.is-owned')].map(c => c.dataset.i).sort().join();
            const colors = [...document.querySelectorAll('.st-cell.is-owned')].every(c => {
                const seat = S.seats.find(x => x.playerId === S.props[c.dataset.i].owner);
                return seat && c.style.getPropertyValue('--own') === seat.tokenColor;
            });
            return { ok: want === got && colors, want, got };
        });
        assert(own.ok, 'ทุกช่องที่มีเจ้าของระบายสีเจ้าของตรงคน: ' + JSON.stringify(own));
        assert(await host.page.evaluate(() => !!document.querySelector('.st-cell[data-i="6"] .st-lm') && !!document.querySelector('.st-cell.is-fest[data-i="14"]')), 'แลนด์มาร์กเด้ง + ธงงานวัด');
        console.log('3. กระดานกลางเกม: 4 สีเจ้าของ · ขั้นสิ่งปลูกสร้าง · ค่าผ่านทาง · แลนด์มาร์ก · หมาก 3 ตัวช่องเดียว + มุม ✓');

        // ---------- เตือนผูกขาด ----------
        await setup({ props: { 9: { owner: P }, 10: { owner: P }, 11: { owner: null }, 12: { owner: P }, 14: { owner: P }, 15: { owner: P } } });
        await host.page.waitForSelector('#stAlerts.is-on .st-alert', { timeout: 8000 });
        assert(await phones[1].page.evaluate(() => !!document.querySelector('.st-cell.is-threat[data-i="11"]')), 'ช่องที่ขาดกระพริบ');
        await shot(phones[1], 'warn-monopoly-mobile');
        await shot(desk, 'warn-monopoly-desktop');
        console.log('4. เตือน "อีก 1 ช่อง ผูกขาดแถว" + วงกระพริบช่องที่ขาด ✓');

        // ---------- แผ่นซื้อ + สร้างหลายขั้น (แผ่นแวบบนเครื่องอื่น) ----------
        const buyer = phones[1];
        await setup({ props: { 20: { owner: null } }, seats: { [Q]: { pos: 17, laps: 1, cash: 30000 } }, dice: [[1, 2]], turnSeat: Q });
        await roll(buyer);
        await waitPhase(buyer, 'build');
        await buyer.page.waitForSelector('.st-sheet.is-open .st-tile', { timeout: 10000 });
        await delay(400);
        await shot(buyer, 'sheet-buy-mobile');
        await buyer.page.click('.st-sheet.is-open .st-tile[data-level="2"]');
        await delay(150);
        await buyer.page.click('#stBuildBtn');
        await phones[2].page.waitForSelector('#stFx .st-flash', { timeout: 8000 });
        await delay(250);
        await shot(phones[2], 'flash-spectator-buy');
        await skipAll(players);
        assert((await state(host)).props[20].level === 2, 'ซื้อถึงตึกในแผ่นเดียว');
        console.log('5. แผ่นซื้อ (ภาพแต่ละขั้น + ราคา) → ซื้อถึงตึก · เครื่องอื่นเห็นแผ่นแวบ "ซื้อ ✔" ✓');

        // ---------- ซื้อต่อ (คนโดนซื้อเห็นฉากใหญ่) ----------
        await setup({ props: { 7: { owner: P, level: 3 } }, seats: { [Q]: { pos: 0, cash: 90000 } }, dice: [[3, 4]], turnSeat: Q });
        await roll(buyer);
        await waitPhase(buyer, 'takeover');
        await buyer.page.waitForSelector('.st-sheet.is-open #stTakeBtn', { timeout: 10000 });
        await delay(350);
        await shot(buyer, 'sheet-takeover-mobile');
        await buyer.page.click('#stTakeBtn');
        await host.page.waitForSelector('#stFx .st-take-scene.is-lost', { timeout: 10000 });
        await delay(900);
        await shot(host, 'cut-takeover-victim');
        await skipAll(players);
        assert((await state(host)).props[7].owner === buyer.id, 'ซื้อต่อแล้วเปลี่ยนเจ้าของ');
        if ((await state(buyer)).phase === 'build') { await buyer.page.click('#stPassBtn').catch(() => {}); }
        console.log('6. ซื้อต่อ 2 เท่า: แผ่นซื้อต่อ → เจ้าของเดิมเห็น "ถูกซื้อต่อ!" ✓');

        // ---------- แลนด์มาร์ก ----------
        await skipAll(players);
        await setup({ props: { 12: { owner: Q, level: 3 } }, seats: { [Q]: { pos: 8, island: 0, cash: 90000 } }, dice: [[1, 3]], turnSeat: Q });
        await roll(buyer);
        await waitPhase(buyer, 'build');
        await buyer.page.waitForSelector('.st-sheet.is-open .st-tile[data-level="4"]', { timeout: 10000 });
        await delay(300);
        await shot(buyer, 'sheet-landmark-mobile');
        await buyer.page.click('.st-sheet.is-open .st-tile[data-level="4"]');
        await buyer.page.click('#stBuildBtn');
        await host.page.waitForSelector('#stFx .st-lm-rise', { timeout: 10000 });
        await delay(900);
        await shot(host, 'cut-landmark');
        await skipAll(players);
        assert((await state(host)).props[12].level === 4, 'สร้างแลนด์มาร์ก');
        console.log('7. แลนด์มาร์ก: แผ่นสร้าง → ฉากแลนด์มาร์ก ✓');

        // ---------- ทัวร์: แตะช่องบนกระดาน (เดินหน้า ผ่านเริ่ม) ----------
        const tourer = phones[2];
        await setup({ props: { 23: { owner: null } }, seats: { [R]: { pos: 24, tourPending: true, cash: 30000 } }, turnSeat: R });
        await waitPhase(tourer, 'pick');
        await tourer.page.waitForSelector('#stPickbar.is-on', { timeout: 8000 });
        await delay(300);
        await shot(tourer, 'pick-tour-mobile');
        await tourer.page.click('.st-cell.is-pickable[data-i="23"]');
        await delay(1300);
        await shot(tourer, 'cut-warp');
        await skipAll(players);
        const afterTour = await state(host);
        assert(afterTour.seats[R].pos === 23 && afterTour.fx.some(f => f.kind === 'move' && f.warp && f.passGo && f.path.length === 31), 'วาร์ปเดินหน้า 31 ช่อง ผ่านจุดเริ่ม');
        if (afterTour.phase === 'build') { await tourer.page.waitForSelector('.st-sheet.is-open #stPassBtn', { timeout: 8000 }); await tourer.page.click('#stPassBtn'); await delay(400); await skipAll(players); }
        console.log('8. ทัวร์: แตะช่อง (บอกจำนวนก้าว · สีเขียว = ผ่านเริ่ม) → เดินหน้าเร็ว ✓');

        // ---------- งานวัดซ้อน ----------
        await setup({ props: { 14: { owner: P, level: 2 } }, festival: 14, festivalMult: 4, seats: { [P]: { pos: 10, cash: 30000 } }, dice: [[2, 4]], turnSeat: P });
        await roll(host);
        await waitPhase(host, 'pick');
        await delay(300);
        await shot(host, 'pick-festival-mobile');
        await host.page.click('.st-cell.is-pickable[data-i="14"]');
        await host.page.waitForSelector('#stFx .st-banner.is-fest', { timeout: 10000 });
        await delay(500);
        await shot(host, 'cut-festival-x8');
        await skipAll(players);
        assert((await state(host)).festivalMult === 8, 'งานวัดซ้อนเป็น ×8');
        console.log('9. งานวัดซ้อน ×4 → ×8 ✓');

        // ---------- ตกจุดเริ่มพอดี: อัปฟรี ----------
        await setup({ props: { 4: { owner: D, level: 1 } }, seats: { [D]: { pos: 28, laps: 1, island: 0, cash: 30000 } }, dice: [[1, 3]], turnSeat: D });
        await roll(desk);
        await waitPhase(desk, 'pick');
        await delay(300);
        await shot(desk, 'pick-startbonus-desktop');
        await desk.page.click('.st-cell.is-pickable[data-i="4"]');
        await delay(500);
        await skipAll(players);
        assert((await state(host)).props[4].level === 2, 'อัปฟรี 1 ขั้น');
        console.log('10. ทอยตกจุดเริ่มพอดี → แตะเมืองอัปฟรี ✓');

        // ---------- เงินไม่พอ: แผ่นขายที่ ----------
        await setup({ props: { 31: { owner: D, level: 3 }, 20: { owner: Q, level: 3 }, 22: { owner: Q, level: 3 }, 23: { owner: Q, level: 3 } }, seats: { [Q]: { pos: 29, cash: 500 } }, dice: [[1, 1]], turnSeat: Q });
        await roll(buyer);
        await waitPhase(buyer, 'debt');
        await buyer.page.waitForSelector('.st-sheet.is-open .st-sell', { timeout: 10000 });
        await delay(300);
        await shot(buyer, 'sheet-sell-mobile');
        for (let k = 0; k < 14 && (await state(buyer)).phase === 'debt'; k += 1) {
            await clickIf(buyer, '.st-sheet.is-open .st-sell') || await clickIf(buyer, '#stOpenSell');
            await delay(600);
            await skipAll(players);
        }
        assert((await state(buyer)).phase !== 'debt', 'ขายที่จนจ่ายครบ');
        console.log('11. เงินไม่พอ → แผ่นขายที่ → จ่ายครบ ✓');

        // ---------- เกาะร้าง ----------
        await setup({ seats: { [R]: { pos: 8, island: 2, cash: 30000 } }, turnSeat: R });
        await tourer.page.waitForSelector('#stPayIsland', { timeout: 8000 });
        await shot(tourer, 'dock-island-mobile');
        console.log('12. ติดเกาะ: ปุ่มจ่ายค่าเรือ + ทอยลุ้นดับเบิล ✓');

        // ---------- ฉากตัวอย่าง (ผลเต๋า/ผูกขาด/เกาะ) ----------
        const demo = async (p, name, fx, ms) => {
            await p.page.evaluate(f => window.__setthi.demo(f), fx);
            await delay(ms);
            await shot(p, name);
            await p.page.evaluate(() => window.__setthi.skip());
            await delay(400);
            await p.page.evaluate(() => window.__setthi.skip());
            await delay(300);
        };
        await demo(host, 'cut-dice-double', { kind: 'dice', playerId: host.id, d: [6, 6], doubles: true, streak: 2, power: 0.92 }, 1500);
        await demo(host, 'cut-dice-slow', { kind: 'dice', playerId: host.id, d: [1, 2], doubles: false, streak: 0, power: 0.1 }, 1100);
        await demo(host, 'cut-dice-triple', { kind: 'dice', playerId: host.id, d: [3, 3], doubles: true, streak: 3 }, 1700);
        await demo(host, 'cut-island', { kind: 'island', playerId: host.id, from: 3, reason: 'triple' }, 1200);
        await demo(desk, 'cut-monopoly-color', { kind: 'monopoly', playerId: desk.id, type: 'color', squares: [1, 2, 4, 6, 7, 9, 10] }, 1400);
        await demo(desk, 'cut-monopoly-line', { kind: 'monopoly', playerId: phones[1].id, type: 'line', side: 1, squares: [9, 10, 11, 12, 14, 15] }, 1400);
        await demo(host, 'cut-monopoly-tourist', { kind: 'monopoly', playerId: phones[2].id, type: 'tourist', squares: [5, 11, 21, 27] }, 1400);
        await demo(host, 'cut-landmark-star', { kind: 'landmarkStar', playerId: host.id, square: 14, stars: 2, bonus: 1500, upgraded: true, toll: 12000, cash: {} }, 900);
        await skipAll(players);
        console.log('13. ฉาก: ผลเต๋า (ดับเบิล/เดินช้าๆ/3 ครั้ง) · เกาะร้าง · ผูกขาด 3 แบบ · ดาวแลนด์มาร์ก ✓');

        // ---------- แผ่นข้อมูลช่อง + วิธีเล่น/เครดิต ----------
        await host.page.click('.st-cell[data-i="28"]');
        await host.page.waitForSelector('.st-sheet.is-open .st-ownerbar', { timeout: 8000 });
        await delay(300);
        await shot(host, 'sheet-deed-mobile');
        await host.page.click('.st-sheet.is-open .st-sheet-close');
        await host.page.click('#stHowBtn');
        await host.page.waitForSelector('.st-sheet.is-open .st-credits', { timeout: 8000 });
        await host.page.click('.st-sheet.is-open .st-credits summary');
        await host.page.waitForFunction(() => document.querySelectorAll('#stCredits .st-credit').length >= 20, null, { timeout: 8000 });
        await shot(host, 'sheet-help-credits');
        await check(host, 'แผ่นวิธีเล่น');
        await host.page.click('.st-sheet.is-open .st-sheet-close');
        console.log('14. แตะช่อง = เจ้าของ + ค่าผ่านทาง + ดาว · วิธีเล่น + เครดิตรูปภาพ ✓');

        // ---------- /m: เฉพาะหัวห้อง ----------
        const typeChat = async (p, text) => {
            if (!(await p.page.isVisible('#chatBox'))) await p.page.click('#toggleChat');
            await p.page.fill('#chatInput', text);
            await p.page.click('#sendChat');
        };
        await typeChat(phones[1], '/m');
        await phones[1].page.waitForSelector('.swal2-popup', { timeout: 8000 });
        assert(/แอดมินหรือหัวห้อง/.test(await phones[1].page.textContent('.swal2-popup')), 'คนอื่นใช้ /m ไม่ได้');
        await phones[1].page.click('.swal2-confirm');
        await typeChat(host, '/m');
        await host.page.waitForSelector('#stDebug:not([hidden])', { timeout: 8000 });
        await host.page.click('#closeChat').catch(() => {});
        await host.page.click('#stDbgMint');
        await phones[1].page.waitForSelector('#stStrip .st-chip[data-id="' + host.id + '"] .st-dbg-mark', { timeout: 8000 });
        assert(!(await phones[1].page.locator('#chatMessages').innerText().catch(() => '')).includes('เมนูทดสอบ'), 'ไม่มีข้อความ /m ในแชท');
        assert(!(await phones[1].page.evaluate(() => [...document.querySelectorAll('.st-toast')].some(t => /🛠|เมนูทดสอบ|เสกเงิน/.test(t.textContent)))), 'ไม่มีป้ายแจ้งเตือน /m บนเครื่องอื่น');
        await shot(host, 'debug-panel');
        await shot(phones[1], 'debug-badge-other');
        await host.page.click('#stDebugToggle');
        console.log('15. /m: หัวห้องเปิดเมนูทดสอบ · คนอื่นโดนปฏิเสธ · ไม่สแปมแชท · ป้าย 🛠 เล็กที่แถบหัวห้อง ✓');

        // ---------- ขนาดจอหลายแบบ ----------
        const sizes = [[1280, 900], [1440, 800], [1920, 1080], [2000, 700], [390, 844], [844, 390]];
        for (const [w, h] of sizes) {
            const v = await openPlayer(browser, base, ids[3], { width: w, height: h }, `view-${w}x${h}`, roomId);
            await delay(700);
            await v.page.evaluate(() => { const b = document.getElementById('ppTermsBar'); if (b) b.remove(); window.__setthi.skip(); });
            await delay(400);
            await check(v, `${w}x${h}`);
            await shot(v, `viewport-${w}x${h}`);
            assert(!v.errors.length, `${v.label} error: ${v.errors.join(' | ')}`);
            await v.context.close();
        }
        console.log('16. 1280×900 · 1440×800 · 1920×1080 · 2000×700 · 390×844 · 844×390: กระดานไม่ทับแผง/หัว ไม่ล้น หมากอยู่ในช่อง ✓');

        // ---------- ชนะจริง: ผูกขาดท่องเที่ยวผ่าน UI ----------
        await setup({ props: { 5: { owner: P }, 11: { owner: P }, 21: { owner: P }, 27: { owner: null } }, seats: { [P]: { pos: 24, cash: 30000, island: 0, tourPending: false } }, dice: [[1, 2]], turnSeat: P });
        await roll(host);
        await waitPhase(host, 'build');
        await host.page.waitForSelector('.st-sheet.is-open #stBuildBtn:not([disabled])', { timeout: 8000 });
        await host.page.click('#stBuildBtn');
        await phones[1].page.waitForSelector('#stFx .st-banner.is-huge', { timeout: 10000 });
        await delay(1200);
        await shot(phones[1], 'cut-monopoly-live');
        for (const p of phones) await p.page.waitForSelector('#stEnd.is-on .st-podium', { timeout: 20000 });
        await delay(1300);
        await shot(host, 'end-mobile');
        const fin = await state(host);
        assert(fin.phase === 'finished' && fin.monopoly && fin.monopoly.type === 'tourist' && fin.winners[0].playerId === host.id, 'ชนะผูกขาดท่องเที่ยว');
        for (const p of phones) {
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} layout ตอนจบ: ${probs.join(' | ')}`);
        }
        console.log('17. ผูกขาดท่องเที่ยวผ่าน UI → ฉากฉลอง → หน้าสรุปบนทุกเครื่อง ✓');

        for (const p of players) assert(!p.errors.length, `${p.label} มี error: ${p.errors.slice(0, 3).join(' | ')}`);
        assert(!/\[setthi\][^\n]*failed/.test(server.logs()), 'เซิร์ฟเวอร์ไม่มี error ของเศรษฐี');
        console.log(`✅ setthi browser: ${checks} checks · ภาพที่ ${SHOTS} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await delay(300);
    }
}

main().then(() => process.exit(0)).catch(error => {
    console.error('❌ setthi browser:', error.stack || error.message);
    process.exit(1);
});
