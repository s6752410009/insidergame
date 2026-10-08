/**
 * เบราว์เซอร์จริง 390×844 — หัวห้องคนเดียวเติมบอทแล้วเล่นจนจบ
 *   ห้องรอ: ปุ่ม "🤖 เพิ่มบอท" (เห็นเฉพาะหัวห้อง) · กดแล้วรายชื่อมีบอท + อวาตาร์
 *   กระดาน: ชื่อ/อวาตาร์บอทขึ้น · บอทเล่นเอง (ประวัติเดิน) · จบเกมได้ · ไม่มี JS error / รูปแตก
 *
 * รัน: node scripts/browser-bots-mobile.js coup|werewolf   (SHOTS_DIR=… เก็บภาพหน้าจอ)
 */
require('./isolateTestData');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const MODE = process.argv[2] || 'coup';
if (!['coup', 'werewolf'].includes(MODE)) throw new Error('ใช้: browser-bots-mobile.js coup|werewolf');
const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), `bots-${MODE}-`));
fs.mkdirSync(SHOTS, { recursive: true });
const IGNORE = /mp3|favicon|autoplay|vibrate|ERR_|Failed to load resource|google|gsi|accounts/i;

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

async function getFreePort() {
    if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            // เร่งให้จบไวแต่ยังเห็นทีละจังหวะ
            COUP_BOT_MS: '350',
            COUP_ACTION_MS: '2500',
            COUP_RESPOND_MS: '2500',
            COUP_DECIDE_MS: '2500',
            WEREWOLF_BOT_MS: '300'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); });
    });
}

async function openHostLobby(browser, base, hostId) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await context.addInitScript(() => {
        try {
            sessionStorage.setItem('insiderPromoSeen', '1');
            localStorage.setItem('ig-firstplay-coup', '1');
            localStorage.setItem('ig-firstplay-werewolf', '1');
        } catch (e) { /* ignore */ }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text().slice(0, 160)); });
    // สร้างห้องด้วย socket แยกในชื่อหัวห้อง แล้วให้หน้าเว็บเข้าห้องรอแทน (แบบเดียวกับ browser-colorcards)
    const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise(r => socket.once('connect', r));
    socket.emit('initPlayer', hostId);
    await delay(250);
    const created = await new Promise(resolve => socket.emit('createRoom', {
        playerId: hostId,
        name: MODE === 'coup' ? 'ห้องบอท Coup' : 'ห้องบอทหมาป่า',
        gameMode: MODE,
        maxPlayers: MODE === 'coup' ? 6 : 12
    }, resolve));
    assert(created && created.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    await page.goto(`${base}/?playerId=${hostId}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/room/${created.roomId}?playerId=${hostId}`, { waitUntil: 'networkidle' });
    socket.close();
    return { context, page, errors, roomId: created.roomId };
}

async function lobbyBots(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('#lobbyPlayers > *'))
        .map(el => el.textContent.replace(/\s+/g, ' ').trim())
        .filter(text => /บอท/.test(text)));
}

async function brokenImages(page) {
    return page.evaluate(() => Array.from(document.images).filter(img => img.complete && img.naturalWidth === 0 && img.src).map(img => img.src));
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    try {
        const hostId = randomUUID();
        const { page, errors } = await openHostLobby(browser, base, hostId);
        const btn = MODE === 'coup' ? '#btnCoupAddBots' : '#btnWerewolfAddBots';
        await page.waitForSelector(btn, { state: 'visible', timeout: 10000 });
        const label = (await page.locator(btn).textContent()).trim();
        assert(label === '🤖 เพิ่มบอท', 'ปุ่มต้องเขียนว่า 🤖 เพิ่มบอท: ' + label);
        const box = await page.locator(btn).boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= 390 && box.height >= 30, 'ปุ่มเพิ่มบอทต้องอยู่ในจอและกดง่าย: ' + JSON.stringify(box));

        const wanted = MODE === 'coup' ? 3 : 6;
        for (let i = 0; i < wanted; i += 1) {
            await page.locator(btn).click();
            await page.waitForFunction(n => Array.from(document.querySelectorAll('#lobbyPlayers > *')).filter(el => /บอท/.test(el.textContent)).length >= n, i + 1, { timeout: 8000 });
            await page.waitForFunction(sel => !/กำลัง/.test(document.querySelector(sel).textContent), btn, { timeout: 8000 });
        }
        const bots = await lobbyBots(page);
        assert(bots.length === wanted, `ห้องรอต้องมีบอท ${wanted} ตัว (${bots.length})`);
        const avatars = await page.evaluate(() => Array.from(document.querySelectorAll('#lobbyPlayers > *'))
            .filter(el => /บอท/.test(el.textContent))
            .map(el => (el.querySelector('.player-avatar, .avatar, [class*="avatar"]') || el).textContent.trim().slice(0, 4)));
        assert(avatars.every(a => a && !/^👤/.test(a)), 'บอทในห้องรอต้องมีอวาตาร์ของตัวเอง: ' + avatars.join(' '));
        const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        assert(noScroll, 'ห้องรอต้องไม่เลื่อนแนวนอนที่ 390px');
        await page.screenshot({ path: path.join(SHOTS, `${MODE}-lobby-bots-390.png`), fullPage: true });
        console.log(`1. ห้องรอ: ปุ่มเพิ่มบอท · บอท ${bots.length} ตัว (${bots.map(b => b.split(' ').find(w => /^บอท/.test(w))).join(', ')}) ✓`);

        await page.locator('#btnStartGameLobby').click();
        await page.waitForURL(/\/game\//, { timeout: 20000 });
        await page.waitForLoadState('networkidle');
        await delay(1500);
        console.log('2. เริ่มเกมแล้ว ไปหน้ากระดาน ✓');

        if (MODE === 'coup') {
            await page.waitForSelector('.cp-player-name', { timeout: 15000 });
            const names = await page.$$eval('.cp-player-name', els => els.map(e => e.textContent.trim()));
            assert(names.filter(n => /บอท/.test(n)).length === wanted, 'กระดานต้องมีชื่อบอทครบ: ' + names.join(','));
            await page.screenshot({ path: path.join(SHOTS, 'coup-board-start-390.png') });
            // หัวห้องไม่กดอะไร — บอทต้องเล่นต่อเองจนจบ (หัวห้องหมดเวลาเป็นรับรายได้)
            await page.waitForFunction(() => document.querySelectorAll('#historyFeed .cp-feed-item').length >= 6, null, { timeout: 60000 });
            await page.screenshot({ path: path.join(SHOTS, 'coup-board-mid-390.png') });
            console.log('3. กระดาน: ชื่อบอทครบ · ประวัติเดินเอง ✓');
            const finished = await page.waitForFunction(() => {
                const text = document.body.innerText;
                return /รอดคนสุดท้าย|ผู้ชนะ|ชนะ!|เป็นผู้รอด/.test(text) && /กลับห้อง|เล่นอีก|ห้องรอ/.test(text);
            }, null, { timeout: 240000 }).then(() => true, () => false);
            await page.screenshot({ path: path.join(SHOTS, 'coup-board-finished-390.png') });
            assert(finished, 'เกม Coup ต้องจบเองภายใน 4 นาที');
            console.log('4. จบเกม: ประกาศผู้ชนะ ✓');
        } else {
            await page.waitForSelector('#mobilePhaseLabel', { timeout: 20000 });
            await page.screenshot({ path: path.join(SHOTS, 'werewolf-board-night-390.png') });
            const text = await page.evaluate(() => document.body.innerText);
            assert((text.match(/บอท/g) || []).length >= wanted, 'กระดานต้องมีชื่อบอท');
            const seen = new Set();
            const until = Date.now() + 300000;
            let finished = false;
            while (Date.now() < until) {
                const phase = await page.evaluate(() => document.getElementById('mobilePhaseLabel')?.textContent?.trim() || '');
                if (phase && !seen.has(phase)) {
                    seen.add(phase);
                    await page.screenshot({ path: path.join(SHOTS, `werewolf-${seen.size}-390.png`) });
                }
                if (/จบ/.test(phase)) { finished = true; break; }
                await delay(700);
            }
            assert(finished, 'เกมหมาป่าต้องจบเองภายใน 5 นาที (เห็นเฟส ' + [...seen].join(' → ') + ')');
            console.log(`3. กระดาน: ชื่อบอทครบ · เฟสเดินเอง ${[...seen].join(' → ')} ✓`);
        }

        const broken = await brokenImages(page);
        assert(!broken.length, 'รูปแตก: ' + broken.join(', '));
        const noScrollBoard = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
        assert(noScrollBoard, 'กระดานต้องไม่เลื่อนแนวนอนที่ 390px');
        assert(!errors.length, 'JS error: ' + errors.join(' | '));
        assert(!/bot turn failed|bots failed/.test(server.logs()), 'บอท error ในเซิร์ฟเวอร์');
        console.log(`✅ browser bots ${MODE} ผ่าน ${checks} checks · ภาพ: ${SHOTS}`);
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
