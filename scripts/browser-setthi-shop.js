/**
 * เศรษฐี 🏪 ร้านในเบราว์เซอร์จริง (มือถือ 390×844 + เดสก์ท็อป 1280×900)
 *  - ยอด 🪙 · 8 การ์ดสกิล หลอด 5 ขั้น · ไม่มี scroll แนวนอน ไม่มีอะไรล้นจอ · ปุ่มสูง ≥ 44px
 *  - กดอัป: หลอดเพิ่ม 1 ขั้น ยอดลด · กดรัว 2 ครั้งติด = ได้ขั้นเดียว · เหรียญไม่พอ = ปุ่มปิด "ขาด 🪙"
 *  - ช่องติดตั้ง 3 ช่อง: ใส่/ถอด · เต็มแล้วปุ่มใส่ปิด
 * ตรวจ: ไม่มี page error / console error
 *
 * รัน: npm run smoke:setthi:shop   (SMOKE_PORT=8864, SHOTS_DIR=<โฟลเดอร์ภาพ>)
 */
const path = require('path');
const fs = require('fs');

require('./isolateTestData');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
const { io } = require('socket.io-client');

const PORT = Number(process.env.SMOKE_PORT) || 8864;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = process.env.GAME_DATA_DIR;
const SHOTS = process.env.SHOTS_DIR || path.join(DATA, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|sourcemap|net::ERR_INTERNET|autoplay|play\(\) failed|AudioContext|preload|\.mp3|fonts\.g|accounts\.google|gsi\//i;

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

function bootServer() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1', SETTHI_TEST_HOOKS: '1', SETTHI_BOT_MS: '200', WALLETS_FILE: path.join(DATA, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${PORT}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + logs.slice(-500))); });
    });
}
function stopServer(child) {
    return new Promise(res => {
        if (!child || child.exitCode !== null) { res(); return; }
        child.once('exit', () => res());
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } res(); }, 5000);
    });
}

async function openShop(browser, id, viewport) {
    const mobile = viewport.width < 600;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile });
    await context.route(CDN_RE, cdnRoute);
    context.setDefaultTimeout(30000);
    await context.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-setthi', '1'); localStorage.setItem('setthiSound', 'off'); } catch (e) { /* ignore */ } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text().slice(0, 120)); });
    await page.goto(`${BASE}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE}/setthi/shop`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sk[data-skill="double"]');
    await page.evaluate(() => { const b = document.getElementById('ppTermsBar'); if (b) b.remove(); });
    return { context, page, errors };
}

async function layoutProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push('scroll แนวนอน ' + document.documentElement.scrollWidth + ' > ' + vw);
        document.querySelectorAll('#shop *').forEach(e => {
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (r.right > vw + 1 || r.left < -1) out.push('ล้นจอ: ' + (e.id || e.className || e.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
        });
        document.querySelectorAll('#shop button, #shop a.sh-back').forEach(b => {
            const r = b.getBoundingClientRect();
            if (r.width && r.height < 43) out.push('ปุ่มเตี้ย: ' + (b.textContent || '').trim().slice(0, 20) + ' ' + Math.round(r.height));
        });
        // ชื่อสกิล/ข้อความไม่โดนตัด
        document.querySelectorAll('.sk-nm, .sk-ln, .sk-up, .sk-eq').forEach(e => { if (e.scrollWidth > e.clientWidth + 1) out.push('ข้อความล้น: ' + e.textContent.trim().slice(0, 20)); });
        return [...new Set(out)].slice(0, 10);
    });
}
const lv = (page, id) => page.evaluate(sid => document.querySelectorAll('.sk[data-skill="' + sid + '"] .sk-seg.is-on').length, id);
const gold = page => page.evaluate(() => Number(document.getElementById('shBalNum').textContent.replace(/,/g, '')));
async function waitGold(page, value) {
    for (let i = 0; i < 60; i += 1) { if (await gold(page) === value) return; await delay(50); }
    throw new Error('ยอดไม่เป็น ' + value + ' (ได้ ' + await gold(page) + ')');
}

function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ success: false, error: 'timeout ' + e }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x || {}); }); }); }

/** คนจริง 1 + บอท 1: ผูกขาดแถวจบเกม → หน้าจบเกมโชว์ +110 🪙 (เกมบอท = ครึ่ง) พร้อมรายละเอียด แล้วยอดในร้านเพิ่ม */
async function endScreen(browser, X) {
    const sock = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise(r => sock.once('connect', r));
    sock.emit('initPlayer', X);
    await delay(200);
    const room = await ack(sock, 'createRoom', { playerId: X, name: 'จบเกม', gameMode: 'setthi', maxPlayers: 6, setthiMinutes: 0 });
    assert(room.success, 'สร้างห้อง');
    sock.emit('setRoom', { roomId: room.roomId, playerId: X });
    assert((await ack(sock, 'setthi_addBots', { roomId: room.roomId, count: 1 })).success, 'เพิ่มบอท');
    assert((await ack(sock, 'startGameFromLobby', { roomId: room.roomId })).success, 'เริ่มเกม');
    const p = await openShop(browser, X, { width: 390, height: 844 });
    await p.page.goto(`${BASE}/game/${room.roomId}?playerId=${X}`, { waitUntil: 'domcontentloaded' });
    await p.page.waitForSelector('#stBoard .st-cell');
    await p.page.waitForFunction(() => window.__setthi && window.__setthi.state());

    // หน้าเว็บเป็น socket หลักของ X แล้ว — สั่ง/อ่าน state ผ่านหน้าเว็บ
    const PS = async () => { try { return await p.page.evaluate(() => window.__setthi && window.__setthi.state()); } catch (e) { await delay(200); return null; } };
    const emit = (ev, payload) => p.page.evaluate(([e, d]) => window.__setthi.emit(e, d), [ev, payload]);
    let st = null;
    for (let k = 0; k < 50; k += 1) { st = await PS(); if (st && st.status === 'playing') break; await delay(100); }
    const i = st.seats.findIndex(x => x.playerId === X);
    // แถบผู้เล่น: ไอคอนสกิล + Lv ของคนที่ติดสกิล · บอทไม่มี
    await p.page.waitForSelector('.st-chip[data-id="' + X + '"] .st-chip-sk');
    assert(await p.page.locator('.st-chip[data-id="' + X + '"] .st-sk').count() === 3, 'แถบผู้เล่นโชว์ 3 สกิล');
    assert((await p.page.locator('.st-chip[data-id="' + X + '"] .st-chip-sk').textContent()).includes('5'), 'โชว์ Lv');
    assert(await p.page.locator('.st-chip-sk').count() === 1, 'บอทไม่มีสกิล');
    await p.page.evaluate(id => window.__setthi.demo({ kind: 'skill', playerId: id, skill: 'start2x', lv: 5, text: 'Start ×2!', amount: 6000 }), X);
    await p.page.waitForSelector('.st-banner.is-skill');
    await p.page.screenshot({ path: path.join(SHOTS, 'skill-popup-mobile.png') });
    await p.page.evaluate(() => window.__setthi.skip());
    const props = { 1: { owner: i, level: 1 }, 2: { owner: i, level: 1 }, 4: { owner: i, level: 1 }, 6: { owner: i, level: 1 }, 7: { owner: i, level: 1 } };
    assert((await emit('setthi_testSetup', { spec: { resetProps: true, props, seats: { [i]: { pos: 0, cash: 20000 } }, dice: [[2, 3]], turnSeat: i } })).success, 'จัดฉาก');
    for (let k = 0; k < 30; k += 1) { st = await PS(); if (st && st.phase === 'roll' && st.phaseActor === X && st.seats[i].pos === 0) break; await delay(100); }
    const rolled = await emit('setthi_roll', { seq: st.phaseSeq });
    assert(rolled.success, 'ทอย ' + rolled.error);
    for (let k = 0; k < 50; k += 1) { st = await PS(); if (st && st.phase === 'build' && st.phaseActor === X) break; await delay(100); }
    assert((await emit('setthi_build', { seq: st.phaseSeq, level: 0 })).success, 'ซื้อตลาดน้ำ');
    for (let k = 0; k < 50; k += 1) { st = await PS(); if (st && st.phase === 'finished' && st.reward) break; await delay(100); }
    assert(st.reward && st.reward.total === 110 && st.reward.botGame, 'เกมบอท: (20+200)/2 = 110');
    // ข้ามฉากจนหน้าจบเกมขึ้น (ห้องกลับห้องรอเองใน 10 วิ — ต้องตรวจให้ทัน)
    for (let k = 0; k < 60; k += 1) {
        const shown = await p.page.evaluate(() => { if (window.__setthi) window.__setthi.skip(); return !!document.getElementById('stEndGold'); }).catch(() => false);
        if (shown) break;
        await delay(100);
    }
    const lines = await p.page.locator('.st-end-gold-list li').count();
    assert(lines === 3, 'รายละเอียด 3 บรรทัด (จบเกม · ชนะ · หักครึ่งเกมบอท) ได้ ' + lines);
    assert((await p.page.locator('.st-end-gold-bal').textContent()).includes('110'), 'บอกยอดรวม');
    await p.page.waitForSelector('#stEndGold.is-done', { timeout: 6000 });
    await delay(150);
    const txt = await p.page.locator('#stEndGoldN').textContent();
    assert(txt.trim() === '+110', 'หน้าจบเกมนับถึง +110 (ได้ ' + txt + ')');
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert(!overflow, 'หน้าจบเกมไม่มี scroll แนวนอน');
    await p.page.screenshot({ path: path.join(SHOTS, 'end-gold-mobile.png') });
    const href = await p.page.locator('.st-end-gold-shop').getAttribute('href');
    assert(href === '/setthi/shop?room=' + room.roomId, 'ปุ่มร้านพากลับห้องได้');
    const shopPage = await p.context.newPage();
    await shopPage.goto(BASE + href, { waitUntil: 'domcontentloaded' });
    await shopPage.waitForSelector('.sk[data-skill="double"]');
    assert(await gold(shopPage) === 110, 'กดไปร้าน ยอด 110');
    assert(!p.errors.length, 'จบเกมไม่มี error: ' + p.errors.join(' | '));
    console.log('✓ หน้าจบเกม: +110 🪙 นับขึ้น · รายละเอียด · ไปร้านแล้วยอดตรง');
    sock.close();
    await p.context.close();
}

(async () => {
    const started = Date.now();
    const mobileId = randomUUID();
    const deskId = randomUUID();
    const endId = randomUUID();
    fs.writeFileSync(path.join(DATA, 'setthiGold.json'), JSON.stringify({
        [mobileId]: { gold: 1000, skills: {}, loadout: [] },
        [deskId]: { gold: 9000, skills: { double: 2, luck: 5 }, loadout: ['luck'] },
        [endId]: { gold: 0, skills: { start2x: 5, festival: 5, double: 3 }, loadout: ['start2x', 'festival', 'double'] }
    }));
    const server = await bootServer();
    const browser = await chromium.launch();
    try {
        // ---- มือถือ ----
        const m = await openShop(browser, mobileId, { width: 390, height: 844 });
        assert(await gold(m.page) === 1000, 'มือถือ: ยอด 1000');
        assert(await m.page.locator('.sk').count() === 8, '8 การ์ดสกิล');
        assert(await m.page.locator('.sk[data-skill="double"] .sk-seg').count() === 5, 'หลอด 5 ขั้น');
        assert(await m.page.locator('.sh-slot.is-empty').count() === 3, 'ช่องว่าง 3 ช่อง');
        let probs = await layoutProblems(m.page);
        assert(!probs.length, 'มือถือ layout: ' + probs.join(' · '));
        await m.page.screenshot({ path: path.join(SHOTS, 'shop-mobile.png'), fullPage: true });

        await m.page.click('[data-up="start2x"]');
        await waitGold(m.page, 900);
        assert(await lv(m.page, 'start2x') === 1, 'อัปแล้วหลอด 1 ขั้น');
        assert(await m.page.locator('.sh-slot:not(.is-empty)').count() === 1, 'สกิลแรกเข้าช่องให้เอง');
        assert((await m.page.locator('.sk[data-skill="start2x"] .sk-now').textContent()).includes('3%'), 'โชว์ % ตอนนี้');
        assert((await m.page.locator('.sk[data-skill="start2x"] .sk-next').textContent()).includes('5%'), 'โชว์ % ถัดไป');

        // กดรัว 2 ครั้งติด (dblclick) = ได้ขั้นเดียว
        await m.page.dblclick('[data-up="start2x"]');
        await waitGold(m.page, 650);
        await delay(400);
        assert(await lv(m.page, 'start2x') === 2, 'กดรัวได้ขั้นเดียว');
        // ยิงคำขอซ้ำพร้อมกันจากหน้าเว็บ (เหมือนสองแท็บ)
        const both = await m.page.evaluate(() => Promise.all([0, 1].map(() => fetch('/api/setthi/shop/upgrade', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skill: 'start2x', expectLv: 2 }) }).then(r => r.status))));
        assert(both.filter(s => s === 200).length === 1, 'สองคำขอพร้อมกันผ่าน 1');
        await delay(200);
        // 409 ของคำขอที่แพ้ เป็นสิ่งที่ตั้งใจยิงเอง
        for (let k = m.errors.length - 1; k >= 0; k -= 1) if (/status of 409/.test(m.errors[k])) m.errors.splice(k, 1);
        await m.page.reload({ waitUntil: 'domcontentloaded' });
        await m.page.waitForSelector('.sk[data-skill="double"]');
        assert(await gold(m.page) === 150 && await lv(m.page, 'start2x') === 3, 'โหลดใหม่ยอด 150 Lv3');
        const upText = await m.page.locator('[data-up="start2x"]').textContent();
        assert(await m.page.locator('[data-up="start2x"]').isDisabled() && upText.includes('ขาด'), 'เหรียญไม่พอ ปุ่มปิด บอกที่ขาด');
        // ถอด/ใส่
        await m.page.click('.sh-slot[data-unequip="start2x"]');
        await m.page.waitForSelector('.sh-slot.is-empty >> nth=2');
        assert(await m.page.locator('.sh-slot.is-empty').count() === 3, 'ถอดแล้วช่องว่าง');
        await m.page.click('[data-eq="start2x"]');
        await m.page.waitForSelector('.sh-slot[data-unequip="start2x"]');
        assert(await m.page.locator('[data-eq="start2x"][aria-pressed="true"]').count() === 1, 'ใส่ช่องแล้ว');
        assert(await m.page.locator('[data-eq="fly"]').isDisabled(), 'ยังไม่มีเลเวล ใส่ไม่ได้');
        await m.page.click('#shEarn summary');
        probs = await layoutProblems(m.page);
        assert(!probs.length, 'มือถือหลังใช้งาน: ' + probs.join(' · '));
        await m.page.screenshot({ path: path.join(SHOTS, 'shop-mobile-after.png'), fullPage: true });
        assert(!m.errors.length, 'มือถือไม่มี error: ' + m.errors.join(' | '));
        console.log('✓ มือถือ 390×844: อัป/กดรัว/ช่องติดตั้ง/ยอด');

        // ---- ห้องรอ: สวิตช์สกิล + สกิลติดตัว ----
        const created = await m.page.evaluate(() => fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ร้านเทส', gameMode: 'setthi', maxPlayers: 6, setthiMinutes: 30 }) }).then(r => r.json()));
        assert(created.success, 'สร้างห้อง: ' + JSON.stringify(created));
        await m.page.goto(`${BASE}/room/${created.roomId}`, { waitUntil: 'domcontentloaded' });
        await m.page.waitForSelector('#stLobbyLoadout [data-lo="start2x"]');
        assert(await m.page.locator('#stLobbySkills[aria-pressed="true"]').count() === 1, 'ห้องรอ: สกิลเปิด (ค่าเริ่ม)');
        assert(await m.page.locator('#stLobbyLoadout [data-lo="start2x"][aria-pressed="true"]').count() === 1, 'ห้องรอ: เห็นสกิลที่ติดตัว');
        await m.page.click('#stLobbyLoadout [data-lo="start2x"]');
        await m.page.waitForSelector('#stLobbyLoadout [data-lo="start2x"][aria-pressed="false"]');
        await m.page.click('#stLobbyLoadout [data-lo="start2x"]');
        await m.page.waitForSelector('#stLobbyLoadout [data-lo="start2x"][aria-pressed="true"]');
        await m.page.click('#stLobbySkills');
        await m.page.waitForSelector('#stLobbySkills[aria-pressed="false"]');
        assert((await m.page.locator('#stLobbyLoadout').textContent()).includes('ปิดสกิล'), 'ห้องรอ: บอกว่าห้องปิดสกิล');
        assert((await m.page.locator('#stLobbyShop').getAttribute('href')).includes('room=' + created.roomId), 'ปุ่มร้านพากลับห้องได้');
        probs = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 ? ['scroll แนวนอน'] : []);
        assert(!probs.length, 'ห้องรอ: ' + probs.join(''));
        await m.page.locator('#stLobbyLoadout').screenshot({ path: path.join(SHOTS, 'lobby-loadout.png') });
        assert(!m.errors.length, 'ห้องรอไม่มี error: ' + m.errors.join(' | '));
        console.log('✓ ห้องรอ: สวิตช์สกิลของห้อง + สกิลติดตัว');

        // ---- เดสก์ท็อป ----
        const d = await openShop(browser, deskId, { width: 1280, height: 900 });
        assert(await gold(d.page) === 9000, 'เดสก์ท็อป: ยอด 9000');
        assert(await lv(d.page, 'luck') === 5 && (await d.page.locator('[data-up="luck"]').textContent()).includes('เต็ม'), 'Lv5 เต็ม');
        await d.page.click('[data-eq="double"]');
        await d.page.waitForSelector('.sh-slot[data-unequip="double"]');
        await d.page.click('[data-up="escape"]');
        await waitGold(d.page, 8900);
        const full = await d.page.locator('.sh-slot:not(.is-empty)').count();
        assert(full === 3, 'ช่องเต็ม 3');
        await d.page.click('[data-up="fly"]');
        await waitGold(d.page, 8800);
        assert(await d.page.locator('[data-eq="fly"]').isDisabled(), 'ช่องเต็ม ใส่เพิ่มไม่ได้');
        probs = await layoutProblems(d.page);
        assert(!probs.length, 'เดสก์ท็อป layout: ' + probs.join(' · '));
        await d.page.screenshot({ path: path.join(SHOTS, 'shop-desktop.png'), fullPage: true });
        assert(!d.errors.length, 'เดสก์ท็อปไม่มี error: ' + d.errors.join(' | '));
        console.log('✓ เดสก์ท็อป 1280×900: Lv5 · ช่องเต็ม');

        // ---- หน้าจบเกม: +N 🪙 ----
        await endScreen(browser, endId);
        await m.context.close();
        await d.context.close();
    } finally {
        await browser.close();
        await stopServer(server);
    }
    console.log(`✅ setthi shop browser: ${checks} checks (${((Date.now() - started) / 1000).toFixed(1)}s) · ภาพ ${SHOTS}`);
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });

