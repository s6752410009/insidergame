#!/usr/bin/env node
/**
 * แชทโลกบนเบราว์เซอร์จริง — มือถือ 390×844 และเดสก์ท็อป 1280×860
 *   ปุ่ม 💬 + ตัวเลขยังไม่อ่าน · เปิดแผง ส่งข้อความ · คำหยาบ: คำเตือนเห็นแค่คนส่ง (คนอื่นไม่ได้รับ)
 *   คนใหม่อ่านได้แต่พิมพ์ไม่ได้ · ข้อความหน้าตา HTML แสดงเป็นตัวอักษร · 🚩 รายงาน
 *   การ์ด "เชิญมาเล่น" → เข้าห้อง (จากหน้าแรก และจากหน้ารายชื่อห้อง)
 * ภาพหน้าจอ: screenshots/world-chat/
 * รัน: node scripts/browser-world-chat.js
 */

const { DATA_DIR } = require('./isolateTestData');
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { io: connect } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots', 'world-chat');
const SECRET = 'browser-world-chat-secret';
let passed = 0;

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

const VIEWPORTS = [
    { tag: 'mobile', viewport: { width: 390, height: 844 }, joinFrom: '/' },
    { tag: 'desktop', viewport: { width: 1280, height: 860 }, joinFrom: '/rooms' }
];
const people = {};
VIEWPORTS.forEach(({ tag }) => {
    people[tag] = {
        veteran: { id: crypto.randomUUID(), name: `ผู้เล่นเก๋า ${tag}`, games: 3, avatar: '🐱', frame: 'gold', color: '#e67e22' },
        host: { id: crypto.randomUUID(), name: `หัวห้อง ${tag}`, games: 2, avatar: '🐺', frame: 'neon', color: '#3498db' },
        newcomer: { id: crypto.randomUUID(), name: `มือใหม่ ${tag}`, games: 0, avatar: '🐣', frame: 'none', color: '#2ecc71' }
    };
});

function seed() {
    const players = {};
    const stats = {};
    Object.values(people).forEach(group => Object.values(group).forEach(p => {
        players[p.id] = { playerId: p.id, playerName: p.name, color: p.color, avatar: p.avatar, avatarFrame: p.frame, approved: true, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
        stats[p.id] = { playerId: p.id, playerName: p.name, totalGames: p.games, wins: 0, losses: p.games };
    }));
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(players));
    fs.writeFileSync(path.join(DATA_DIR, 'playerStats.json'), JSON.stringify(stats));
}

function cookieValue(playerId) {
    const signature = crypto.createHmac('sha256', SECRET).update(playerId).digest('base64').replace(/=+$/, '');
    return encodeURIComponent(`s:${playerId}.${signature}`);
}

function boot(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), MONGO_URL: '', SESSION_SECRET: SECRET, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.stdout.on('data', chunk => { logs += String(chunk); });
    child.stderr.on('data', chunk => { logs += String(chunk); });
    child.logs = () => logs;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('startup timeout\n' + logs.slice(-1500))); }, 40000);
        const check = setInterval(() => {
            if (logs.includes(`Server started on port ${port}`)) { clearInterval(check); clearTimeout(timer); resolve(child); }
        }, 100);
        child.once('exit', code => { clearInterval(check); clearTimeout(timer); reject(new Error(`server exited ${code}\n${logs.slice(-1500)}`)); });
    });
}

function socketFor(base, playerId) {
    const socket = connect(base, {
        transports: ['websocket'],
        extraHeaders: { Cookie: `insider_pid=${cookieValue(playerId)}` },
        reconnection: false,
        forceNew: true
    });
    socket.received = [];
    socket.on('worldChat:message', message => socket.received.push(message));
    return new Promise((resolve, reject) => {
        socket.once('connect', () => {
            socket.emit('worldChat:subscribe', {}, () => resolve(socket));
        });
        socket.once('connect_error', reject);
    });
}

function emit(socket, event, data) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 8000);
        socket.emit(event, data, response => { clearTimeout(timer); resolve(response); });
    });
}

async function newPage(browser, base, viewport, person) {
    const context = await browser.newContext({ viewport, locale: 'th-TH' });
    await context.addCookies([{ name: 'insider_pid', value: cookieValue(person.id), url: base }]);
    await context.addInitScript(id => {
        try {
            sessionStorage.setItem('insiderPromoSeen', '1');
            localStorage.setItem('insiderGamePlayerId', id);
        } catch (e) { /* ignore */ }
    }, person.id);
    const page = await context.newPage();
    page.errors = [];
    page.on('pageerror', error => page.errors.push(error.message));
    return { context, page };
}

async function settleHome(page, base, pathname = '/') {
    await page.goto(base + pathname, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#wcFab', { state: 'visible' });
    await page.waitForFunction(() => window.appSocket && window.appSocket.connected);
    // ป๊อปอัปประกาศเวอร์ชันของหน้าแรก (ไม่เกี่ยวกับแชท) ปิดก่อน
    await page.evaluate(() => { try { if (window.Swal && window.Swal.isVisible()) window.Swal.close(); } catch (e) { /* ignore */ } });
    await delay(300);
}

async function runViewport(browser, base, { tag, viewport, joinFrom }) {
    const p = people[tag];
    const host = await socketFor(base, p.host.id);
    const vet = await newPage(browser, base, viewport, p.veteran);
    const fresh = await newPage(browser, base, viewport, p.newcomer);
    try {
        const page = vet.page;
        await settleHome(page, base, '/');

        // ---- หน้าแรกยังอยู่ครบ (H1 + ตารางเกม SEO) ----
        assert(await page.locator('h1').count() >= 1, `[${tag}] หน้าแรกยังมี H1`);

        // ---- ตัวเลขยังไม่อ่าน ----
        assert(await page.locator('#wcBadge').isHidden(), `[${tag}] เข้าครั้งแรกไม่มีตัวเลข`);
        const hello = await emit(host, 'worldChat:send', { text: `หวัดดีจาก ${p.host.name}` });
        assert(hello.success, `[${tag}] หัวห้องส่งข้อความ (socket)`);
        await page.waitForFunction(() => document.getElementById('wcBadge').textContent === '1' && !document.getElementById('wcBadge').hidden);
        assert(true, `[${tag}] ตัวเลขยังไม่อ่านขึ้น 1`);
        const fab = await page.locator('#wcFab').boundingBox();
        assert(fab && fab.x >= 0 && fab.x + fab.width <= viewport.width && fab.y + fab.height <= viewport.height, `[${tag}] ปุ่ม 💬 อยู่ในจอ`);
        await page.screenshot({ path: path.join(SHOTS, `${tag}-1-badge.png`) });

        // ---- เปิดแผง ส่งข้อความ ----
        await page.click('#wcFab');
        await page.waitForSelector('#wcPanel:not([hidden]) .wc-msg');
        assert(await page.locator('.wc-msg', { hasText: `หวัดดีจาก ${p.host.name}` }).count() === 1, `[${tag}] เห็นข้อความในแผง`);
        assert(await page.locator('#wcBadge').isHidden(), `[${tag}] เปิดแล้วตัวเลขหาย`);
        const panelBox = await page.locator('#wcPanel').boundingBox();
        assert(panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width + 1 && panelBox.y >= 0, `[${tag}] แผงอยู่ในจอ`);
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(scrollWidth <= viewport.width, `[${tag}] ไม่มีเลื่อนแนวนอน (${scrollWidth})`);

        const mine = `สวัสดีจากเบราว์เซอร์ ${tag}`;
        await page.fill('#wcInput', mine);
        await page.click('#wcSend');
        await page.waitForSelector(`.wc-msg.is-mine >> text=${mine}`);
        assert(true, `[${tag}] ข้อความตัวเองขึ้นในแผง`);
        const deadline = Date.now() + 5000;
        while (!host.received.some(m => m.text === mine) && Date.now() < deadline) await delay(50);
        assert(host.received.some(m => m.text === mine), `[${tag}] คนอื่นได้รับข้อความ`);
        assert(await page.inputValue('#wcInput') === '', `[${tag}] ส่งแล้วช่องพิมพ์ว่าง`);
        assert(/รอ/.test(await page.locator('#wcSend').innerText()), `[${tag}] ปุ่มส่งนับถอยหลัง 5 วิ`);
        await page.screenshot({ path: path.join(SHOTS, `${tag}-2-panel.png`) });

        // ---- คำหยาบ: เตือนเฉพาะคนส่ง ----
        await page.waitForFunction(() => !document.getElementById('wcSend').disabled, null, { timeout: 8000 });
        const receivedBefore = host.received.length;
        await page.fill('#wcInput', 'ค ว ย');
        await page.click('#wcSend');
        await page.waitForSelector('#wcWarn:not([hidden])');
        assert(/ไม่สุภาพ/.test(await page.locator('#wcWarn').innerText()), `[${tag}] เห็นคำเตือนภาษาไทย`);
        assert(await page.inputValue('#wcInput') === 'ค ว ย', `[${tag}] ข้อความยังอยู่ให้แก้`);
        assert(await page.locator('.wc-msg', { hasText: 'ค ว ย' }).count() === 0, `[${tag}] ข้อความหยาบไม่ขึ้นในแผง`);
        await delay(500);
        assert(host.received.length === receivedBefore, `[${tag}] คนอื่นไม่ได้รับข้อความหยาบ`);
        await page.screenshot({ path: path.join(SHOTS, `${tag}-3-blocked.png`) });
        await page.fill('#wcInput', '');

        // ---- ข้อความหน้าตา HTML = ตัวอักษรธรรมดา ----
        await delay(5100);
        const xss = '<img src=x onerror="window.__wcXss=1"><b>หนา</b>';
        const xssSend = await emit(host, 'worldChat:send', { text: xss });
        assert(xssSend.success, `[${tag}] ส่งข้อความ HTML (socket)`);
        await page.waitForFunction(text => Array.from(document.querySelectorAll('.wc-text')).some(el => el.textContent === text), xss);
        assert(await page.evaluate(() => window.__wcXss === undefined && !document.querySelector('.wc-list img[src="x"]') && !document.querySelector('.wc-text b')), `[${tag}] ไม่มี HTML ทำงาน`);

        // ---- 🚩 รายงาน ----
        const reportButton = page.locator('.wc-msg', { hasText: `หวัดดีจาก ${p.host.name}` }).locator('.wc-report');
        await reportButton.click();
        await page.locator('.swal2-confirm').click();
        await page.waitForSelector('.wc-toast:not([hidden])');
        assert(/รายงานแล้ว/.test(await page.locator('.wc-toast').innerText()), `[${tag}] รายงานแล้วมีข้อความยืนยัน`);
        assert(await page.locator('.wc-msg.is-mine .wc-report').count() === 0, `[${tag}] ข้อความตัวเองไม่มีปุ่มรายงาน`);

        // ---- คนใหม่: อ่านได้ พิมพ์ไม่ได้ ----
        await settleHome(fresh.page, base, '/');
        await fresh.page.click('#wcFab');
        await fresh.page.waitForSelector('#wcPanel:not([hidden]) .wc-msg');
        assert(await fresh.page.locator('.wc-msg', { hasText: mine }).count() === 1, `[${tag}] คนใหม่อ่านข้อความได้`);
        assert(await fresh.page.locator('#wcForm').isHidden(), `[${tag}] คนใหม่ไม่มีช่องพิมพ์`);
        assert(/เล่นจบ 1 เกม/.test(await fresh.page.locator('#wcLock').innerText()), `[${tag}] คนใหม่เห็นว่าต้องทำอะไรถึงจะพิมพ์ได้`);
        assert(await fresh.page.locator('.wc-report').first().isHidden(), `[${tag}] คนใหม่ไม่มีปุ่มรายงาน`);
        assert(await fresh.page.locator('.wc-msg', { hasText: 'ค ว ย' }).count() === 0, `[${tag}] คนใหม่ไม่เห็นข้อความหยาบ`);
        await fresh.page.screenshot({ path: path.join(SHOTS, `${tag}-4-newcomer.png`) });

        // ---- การ์ดเชิญมาเล่น → เข้าห้อง ----
        const created = await emit(host, 'createRoom', { name: `ห้องชวน ${tag}`, gameMode: 'werewolf', maxPlayers: 8 });
        assert(created.success, `[${tag}] หัวห้องสร้างห้อง`);
        await delay(5100);
        const invite = await emit(host, 'worldChat:invite', {});
        assert(invite.success, `[${tag}] ส่งการ์ดเชิญ`);
        if (joinFrom !== '/') {
            await page.keyboard.press('Escape');
            await settleHome(page, base, joinFrom);
            await page.click('#wcFab');
        }
        const card = page.locator(`.wc-card-join[data-room-id="${created.roomId}"]`);
        await card.waitFor({ state: 'visible' });
        assert(/ว่าง/.test(await page.locator('.wc-msg.is-invite').last().locator('.wc-card-status').innerText()), `[${tag}] การ์ดบอกว่าห้องว่าง`);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `${tag}-5-invite.png`) });
        await card.click();
        await page.waitForURL(url => url.pathname === `/room/${created.roomId}`, { timeout: 15000 });
        assert(true, `[${tag}] กดเข้าห้องจากการ์ด (เริ่มที่ ${joinFrom}) แล้วเข้าห้องสำเร็จ`);
        assert(await page.locator('#btnWorldChatInvite').isVisible(), `[${tag}] ในห้องมีปุ่มชวนในแชทโลก`);
        assert(await page.locator('#wcFab').count() === 0, `[${tag}] หน้าห้องไม่มีแผงแชทโลก`);

        assert(vet.page.errors.length === 0, `[${tag}] ไม่มี error ในหน้า (${vet.page.errors.join(' | ')})`);
        assert(fresh.page.errors.length === 0, `[${tag}] ไม่มี error ในหน้าคนใหม่ (${fresh.page.errors.join(' | ')})`);
    } finally {
        host.close();
        await vet.context.close();
        await fresh.context.close();
    }
}

async function run() {
    fs.mkdirSync(SHOTS, { recursive: true });
    seed();
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const server = await boot(port);
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        for (const config of VIEWPORTS) await runViewport(browser, base, config);
    } catch (error) {
        console.error(server.logs().slice(-2000));
        throw error;
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
    }
    console.log(`✅ browser world chat: ${passed} checks passed · screenshots in ${path.relative(ROOT, SHOTS)}/`);
}

run().catch(error => {
    console.error(error.message);
    process.exit(1);
});
