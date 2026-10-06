/**
 * เทสเบราว์เซอร์ของเกมจับคู่ความจำ (390×844 + desktop 1280×900)
 * - เล่นจนจบ 1 เกม (มีเปิดผิด), รีเฟรชกลางเกมแล้วเล่นต่อได้, พักเกม, กระดานประจำวัน + ตารางอันดับ
 * - ทุกระดับกระดานต้องพอดีจอโดยไม่ต้องเลื่อน, ไม่มี horizontal scroll, ไม่มีข้อความล้น, ไม่มี page error
 *
 * รัน: npm run smoke:solo:memory:browser   (SHOTS_DIR=<โฟลเดอร์> เพื่อเก็บภาพหน้าจอ)
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const SHOTS = process.env.SHOTS_DIR || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(cond, message) { if (!cond) throw new Error('FAIL: ' + message); checks += 1; }

function freePort() {
    return new Promise(resolve => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    });
}
function boot(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), WALLETS_FILE: path.join(process.env.GAME_DATA_DIR, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('boot timeout\n' + logs)); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs)); });
    });
}

async function shot(page, name) {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function layoutCheck(page, label) {
    const r = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowX = doc.scrollWidth > window.innerWidth + 1;
        const bad = [];
        document.querySelectorAll('.mm *').forEach(el => {
            if (el.closest('[hidden]') || !el.getClientRects().length) return;
            const cs = getComputedStyle(el);
            if (cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis') return; // ตั้งใจตัดคำ
            if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'auto') {
                bad.push(`${el.className || el.tagName}: ${el.textContent.trim().slice(0, 30)}`);
            }
        });
        return { overflowX, bad };
    });
    assert(!r.overflowX, `${label}: no horizontal scroll`);
    assert(r.bad.length === 0, `${label}: no text overflow (${r.bad.join(' | ')})`);
}

async function boardFits(page, label) {
    const r = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.mm-card'));
        const footer = document.querySelector('footer.footer');
        const footerTop = footer ? footer.getBoundingClientRect().top : window.innerHeight;
        const maxBottom = Math.max(...cards.map(c => c.getBoundingClientRect().bottom));
        const minTop = Math.min(...cards.map(c => c.getBoundingClientRect().top));
        const w = cards[0].getBoundingClientRect().width;
        return {
            count: cards.length, maxBottom, minTop, footerTop, cardW: w,
            docScroll: document.documentElement.scrollHeight - window.innerHeight
        };
    });
    assert(r.maxBottom <= r.footerTop + 0.5, `${label}: cards clear the footer (${r.maxBottom} <= ${r.footerTop})`);
    assert(r.minTop >= 0, `${label}: cards below top`);
    assert(r.docScroll <= 1, `${label}: page does not scroll while playing (${r.docScroll})`);
    assert(r.cardW >= 44, `${label}: card touch target ≥44px (${r.cardW})`);
    return r;
}

// อ่านคำตอบจาก DOM (ในเทสเท่านั้น) — จับกลุ่มการ์ดตามรูป
async function pairsOnBoard(page) {
    return page.evaluate(() => {
        const groups = {};
        document.querySelectorAll('.mm-card').forEach(c => {
            if (c.classList.contains('is-matched')) return;
            const src = c.querySelector('img').getAttribute('src');
            (groups[src] = groups[src] || []).push(Number(c.dataset.i));
        });
        return Object.values(groups);
    });
}
async function tap(page, i) {
    await page.click(`.mm-card[data-i="${i}"]`);
    await delay(260);
}

(async () => {
    const port = Number(process.env.PORT_OVERRIDE) || await freePort();
    const server = await boot(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const errors = [];
    try {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        // ป๊อปอัปโปรโมตของเว็บ (ขึ้นครั้งเดียวต่อ session) ไม่ใช่สิ่งที่เทสนี้ตรวจ
        await context.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) {} });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        // ช่วงเทสออฟไลน์ เบราว์เซอร์รายงาน ERR_INTERNET_DISCONNECTED เอง (socket.io/fetch) — ตั้งใจให้เกิด
        page.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push('console: ' + m.text()); });

        const playerId = randomUUID();
        await page.goto(`${base}/?playerId=${playerId}`);
        await delay(400);
        await page.goto(`${base}/solo/memory`);
        await page.waitForSelector('#mmHow:not([hidden])');
        await delay(600);
        await shot(page, 'm01-howto');
        await page.click('#mmHowOk');
        await page.waitForSelector('#mmHow', { state: 'hidden' });
        await delay(300);
        await layoutCheck(page, 'menu');
        await shot(page, 'm02-menu');
        await page.screenshot({ path: SHOTS ? path.join(SHOTS, 'm02-menu-full.png') : '/dev/null', fullPage: true }).catch(() => {});

        assert(/เที่ยงคืน/.test(await page.textContent('#mmDailyMeta')), 'daily card says when the board changes');
        // ---- เข้าแล้วออกโดยยังไม่แตะการ์ด = ไม่มี "เกมค้าง" ----
        await page.click('#mmStart');
        await page.waitForSelector('#mmPlay:not([hidden]) .mm-card');
        await page.click('#mmPauseBtn');
        await page.click('#mmQuitBtn');
        await page.waitForSelector('#mmMenu:not([hidden])');
        assert(!(await page.isVisible('#mmResume')), 'untouched board is not kept as a paused game');

        // ---- ทุกระดับต้องพอดีจอ ----
        for (const level of ['medium', 'hard']) {
            await page.click(`[data-level="${level}"]`);
            await page.click('#mmStart');
            await page.waitForSelector('#mmPlay:not([hidden]) .mm-card');
            await delay(700);
            const r = await boardFits(page, level);
            await layoutCheck(page, level);
            await shot(page, `m03-${level}`);
            console.log(`  ${level}: ${r.count} cards, card ${Math.round(r.cardW)}px, bottom ${Math.round(r.maxBottom)} / footer ${Math.round(r.footerTop)}`);
            // เปิดไว้สองใบก่อนออก เพื่อให้มีเกมค้าง
            await tap(page, 0); await tap(page, 1);
            await page.click('#mmPauseBtn');
            await page.waitForSelector('#mmPause:not([hidden])');
            await page.click('#mmQuitBtn');
            await page.waitForSelector('#mmMenu:not([hidden])');
        }
        assert(await page.isVisible('#mmResume'), 'practice game kept → resume banner');
        assert(/ทิ้งเกมที่ค้าง/.test(await page.textContent('#mmStart')), 'start button warns it discards the paused game');
        await page.click('#mmResumeDrop');
        assert(!(await page.isVisible('#mmResume')), 'drop saved game');
        assert((await page.textContent('#mmStart')).trim() === 'เริ่มเกม', 'start button back to normal');

        // ---- เล่นเกมง่ายจนจบ พร้อมรีเฟรชกลางเกม ----
        await page.click('[data-level="easy"]');
        await page.click('[data-deck="city"]');
        await page.click('#mmStart');
        await page.waitForSelector('#mmPlay:not([hidden]) .mm-card');
        await delay(600);
        await boardFits(page, 'easy');
        let groups = await pairsOnBoard(page);
        // เปิดผิดหนึ่งครั้ง
        await tap(page, groups[0][0]); await tap(page, groups[1][0]);
        await delay(120);
        assert(await page.$eval(`.mm-card[data-i="${groups[0][0]}"]`, el => el.classList.contains('is-miss')), 'miss feedback shown');
        await shot(page, 'm04-miss');
        await delay(1200);
        assert(!(await page.$eval(`.mm-card[data-i="${groups[0][0]}"]`, el => el.classList.contains('is-up'))), 'miss flips back');
        // จับได้สองคู่ติดกัน → คอมโบ
        await tap(page, groups[0][0]); await tap(page, groups[0][1]);
        await tap(page, groups[1][0]); await tap(page, groups[1][1]);
        await delay(150);
        const toast = await page.textContent('#mmToast');
        assert(/คอมโบ ×2/.test(toast), 'combo toast shown: ' + toast);
        await shot(page, 'm05-combo');
        const movesBefore = await page.textContent('#mmMoves');
        assert(movesBefore === '3', 'moves counter = 3');
        await delay(1200);

        // รีเฟรชกลางเกม
        await page.reload();
        await page.waitForSelector('#mmPause:not([hidden])');
        assert(/เล่นต่อ/.test(await page.textContent('#mmPauseTitle')), 'resume dialog after refresh');
        await delay(400);
        await shot(page, 'm06-resume');
        await page.click('#mmResumeBtn');
        assert((await page.textContent('#mmMoves')) === '3', 'moves restored after refresh');
        assert((await page.$$('.mm-card.is-matched')).length === 4, 'matched cards restored');

        // พักเกม: ซ่อนกระดาน เวลาไม่เดิน
        await tap(page, (await pairsOnBoard(page))[0][0]);
        await page.click('#mmPauseBtn');
        const t1 = await page.textContent('#mmPauseInfo');
        await delay(1500);
        const t2 = await page.textContent('#mmPauseInfo');
        assert(t1 === t2, 'paused');
        await delay(400);
        await shot(page, 'm07-pause');
        await page.click('#mmResumeBtn');

        groups = await pairsOnBoard(page);
        for (const [a, b] of groups) { await tap(page, a); await tap(page, b); }
        await page.waitForSelector('#mmResult:not([hidden])');
        await page.waitForFunction(() => /บันทึก/.test(document.getElementById('mmSave').textContent) && !/กำลัง/.test(document.getElementById('mmSave').textContent), null, { timeout: 8000 });
        const saveText = await page.textContent('#mmSave');
        assert(/บันทึกผลแล้ว/.test(saveText), 'result saved: ' + saveText);
        await delay(900);
        await layoutCheck(page, 'result');
        await shot(page, 'm08-result');
        const stats = await page.evaluate(() => fetch('/api/solo/memory/stats').then(r => r.json()));
        assert(stats.data && stats.data.levels.easy.plays === 1 && stats.data.levels.easy.bestMoves === 7, 'server stats updated (7 moves)');

        // ---- กระดานประจำวัน ----
        await page.click('#mmMenuBtn');
        await page.waitForSelector('#mmMenu:not([hidden])');
        await page.click('#mmDailyBtn');
        await page.waitForSelector('#mmPlay:not([hidden]) .mm-card');
        await delay(600);
        await boardFits(page, 'daily');
        await shot(page, 'm09-daily');
        assert(await page.isHidden('#mmRestartBtn'), 'daily has no restart');
        groups = await pairsOnBoard(page);
        for (const [a, b] of groups) { await tap(page, a); await tap(page, b); await delay(600); }
        await page.waitForSelector('#mmResult:not([hidden])');
        await page.waitForFunction(() => /อันดับ 1/.test(document.getElementById('mmSave').textContent), null, { timeout: 8000 });
        await page.click('#mmMenuBtn');
        await page.waitForSelector('#mmDailyDone:not([hidden])');
        await page.waitForSelector('.mm-lb-row.is-me');
        assert(/อันดับ 1/.test(await page.textContent('#mmDailyDone')), 'daily card shows rank');
        const next1 = await page.textContent('#mmDailyNext');
        assert(/^\d\d:\d\d:\d\d$/.test(next1), 'daily card counts down to the next board: ' + next1);
        await delay(1300);
        assert((await page.textContent('#mmDailyNext')) !== next1, 'countdown ticks');
        await delay(300);
        await layoutCheck(page, 'menu after daily');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(200);
        await shot(page, 'm10-menu-leaderboard');
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, 'm11-menu-done');

        // ---- ออฟไลน์: ผลค้างคิว แล้วส่งเมื่อกลับมาออนไลน์ ----
        await page.click('[data-level="easy"]');
        await page.click('#mmStart');
        await page.waitForSelector('#mmPlay:not([hidden]) .mm-card');
        await delay(500);
        await context.setOffline(true);
        groups = await pairsOnBoard(page);
        for (const [a, b] of groups) { await tap(page, a); await tap(page, b); await delay(500); }
        await page.waitForSelector('#mmResult:not([hidden])');
        await page.waitForFunction(() => /ออฟไลน์/.test(document.getElementById('mmSave').textContent), null, { timeout: 8000 });
        assert((await page.evaluate(() => JSON.parse(localStorage.getItem('memory:queue:v1') || '[]').length)) === 1, 'result queued offline');
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('memory:queue:v1') || '[]').length === 0, null, { timeout: 10000 });
        const stats2 = await page.evaluate(() => fetch('/api/solo/memory/stats').then(r => r.json()));
        assert(stats2.data.levels.easy.plays === 2, 'queued result delivered after reconnect');

        // ---- desktop ----
        const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await desk.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) {} });
        const dp = await desk.newPage();
        dp.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
        dp.on('console', m => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
        await dp.goto(`${base}/?playerId=${randomUUID()}`);
        await delay(300);
        await dp.goto(`${base}/solo/memory`);
        await dp.waitForSelector('#mmHow:not([hidden])');
        await dp.click('#mmHowSkip');
        await delay(300);
        await layoutCheck(dp, 'desktop menu');
        await shot(dp, 'm12-desktop-menu');
        await dp.click('[data-level="hard"]');
        await dp.click('[data-deck="knight"]');
        await dp.click('#mmStart');
        await dp.waitForSelector('#mmPlay:not([hidden]) .mm-card');
        await delay(800);
        await boardFits(dp, 'desktop hard');
        const g = await pairsOnBoard(dp);
        await dp.click(`.mm-card[data-i="${g[0][0]}"]`); await delay(200);
        await dp.click(`.mm-card[data-i="${g[0][1]}"]`); await delay(200);
        await dp.click(`.mm-card[data-i="${g[1][0]}"]`); await delay(700);
        await shot(dp, 'm13-desktop-hard');

        // hub card
        await page.goto(`${base}/solo`);
        await delay(500);
        assert(/รายวันติดกัน 1 วัน/.test(await page.textContent('.solo-grid')), 'hub card shows summary');
        assert(/วันนี้เล่นแล้ว/.test(await page.textContent('.solo-grid')), 'hub card says today\'s board is done');
        await shot(page, 'm14-hub');

        assert(errors.length === 0, 'no page/console errors:\n' + errors.join('\n'));
        console.log(`browser-solo-memory: ${checks} checks passed${SHOTS ? ` — screenshots in ${SHOTS}` : ''}`);
    } finally {
        await browser.close();
        server.kill();
    }
})().catch(error => { console.error(error); process.exit(1); });
