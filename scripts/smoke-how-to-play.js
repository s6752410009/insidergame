/**
 * หน้าวิธีเล่น (/how-to-play) — เปิดด้วยเบราว์เซอร์จริง 3 ขนาดจอ แล้วเช็กว่า
 *  - ทุกเกมเปิดได้จากแถบสลับเกม แสดงทีละเกม และมีการ์ด/รูปของเกมนั้น
 *  - รูปโหลดได้ครบ (ไม่มี 404) · ไม่มี page error · ไม่มีเลื่อนข้างที่ 390px
 *  - จอกว้าง คอลัมน์ตัวหนังสือไม่เกิน ~760px
 *  - ลิงก์ตรง /how-to-play#coup (และ anchor เดิมอย่าง #poker5 #getting-started) เปิดถูกเกม
 *  - แตะการ์ดแล้วเปิดภาพใหญ่ ปิดได้
 *  - ปิด JS ก็ยังอ่านได้ครบ (ทุกเกมเรียงลงมา)
 *
 * รัน: node scripts/smoke-how-to-play.js
 *   BASE_URL=http://127.0.0.1:3917  ใช้เซิร์ฟเวอร์ที่รันอยู่แล้ว (ไม่ spawn เอง)
 *   SHOT_DIR=/path                    เก็บภาพหน้าจอตัวอย่างไว้ที่นี่ (ค่าเริ่ม: โฟลเดอร์ชั่วคราว)
 */

require('./isolateTestData');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const VIEWPORTS = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 }
];
const SHOT_GAMES = ['coup', 'werewolf', 'colorcards', 'setthi', 'pokdeng'];
const MAX_PROSE_PX = 760;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const failures = [];
function check(condition, message) {
    if (!condition) failures.push(message);
    return condition;
}

function request(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

async function getFreePort() {
    return new Promise(resolve => {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function spawnServer() {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server startup timeout')), 30000);
        child.stdout.on('data', chunk => {
            if (String(chunk).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(); }
        });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        try { await request(`http://127.0.0.1:${port}/how-to-play`); break; } catch { await delay(200); }
    }
    return { baseUrl: `http://127.0.0.1:${port}`, child };
}

async function newPage(browser, viewport, opts = {}) {
    const ctx = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.width < 600,
        hasTouch: viewport.width < 600,
        javaScriptEnabled: opts.javaScriptEnabled !== false
    });
    await ctx.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; } catch (e) { /* ignore */ } });
    const page = await ctx.newPage();
    const errors = [];
    const bytes = { total: 0 };
    page.on('pageerror', err => errors.push('pageerror: ' + err.message));
    page.on('response', res => {
        const len = Number(res.headers()['content-length'] || 0);
        bytes.total += len;
        if (res.status() >= 400 && !/socket\.io|favicon/.test(res.url())) errors.push(res.status() + ' ' + res.url());
    });
    page.on('requestfailed', req => {
        if (req.resourceType() === 'image') errors.push('image failed ' + req.url());
    });
    return { ctx, page, errors, bytes };
}

// เลื่อนผ่านทั้งเกมให้รูป lazy โหลด แล้วรอจนทุกรูปในเกมนั้นโหลดเสร็จ
async function loadAllImages(page, id) {
    await page.evaluate(async sectionId => {
        const el = document.getElementById(sectionId);
        const top = el.getBoundingClientRect().top + window.scrollY;
        for (let y = top; y < top + el.offsetHeight; y += Math.max(300, window.innerHeight * 0.8)) {
            window.scrollTo(0, y);
            await new Promise(r => setTimeout(r, 40));
        }
    }, id);
    await page.waitForFunction(sectionId => Array.from(document.querySelectorAll('#' + sectionId + ' img')).every(img => img.complete), id, { timeout: 15000 }).catch(() => {});
    return page.evaluate(sectionId => Array.from(document.querySelectorAll('#' + sectionId + ' img'))
        .filter(img => !(img.complete && img.naturalWidth > 0))
        .map(img => img.getAttribute('src')), id);
}

async function horizontalOverflow(page) {
    return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function runViewport(browser, baseUrl, vp, shotDir) {
    const tag = `[${vp.name} ${vp.width}]`;
    const { ctx, page, errors, bytes } = await newPage(browser, vp);
    await page.goto(baseUrl + '/how-to-play', { waitUntil: 'networkidle' });
    const overviewKb = Math.round(bytes.total / 1024);

    const ids = await page.$$eval('#hp-switch [data-jump]', els => els.map(el => el.getAttribute('data-jump')));
    const games = ids.filter(id => id !== 'top' && id !== 'faq');
    check(games.length >= 17, `${tag} expected 17+ game tabs, got ${games.length}`);
    check(await page.isVisible('#top'), `${tag} overview hero not visible`);
    check((await page.$$('.hp-tile')).length === games.length, `${tag} picker tiles do not match game tabs`);
    check(await horizontalOverflow(page) <= 0, `${tag} horizontal scroll on overview`);

    for (const id of games) {
        await page.click(`#hp-switch [data-jump="${id}"]`);
        await page.waitForTimeout(80);
        const state = await page.evaluate(gameId => {
            const el = document.getElementById(gameId);
            const open = Array.from(document.querySelectorAll('.hp-game')).filter(g => !g.hidden && g.offsetHeight > 0).map(g => g.id);
            const prose = el.querySelector(':scope > p');
            const barH = document.getElementById('hp-switch').getBoundingClientRect().height;
            return {
                open,
                height: el.offsetHeight,
                cards: el.querySelectorAll('.hp-card').length,
                hash: location.hash,
                proseWidth: prose ? prose.getBoundingClientRect().width : 0,
                top: el.getBoundingClientRect().top,
                barH,
                activeChip: (document.querySelector('#hp-switch .is-active') || {}).getAttribute ? document.querySelector('#hp-switch .is-active').getAttribute('data-jump') : null
            };
        }, id);
        check(state.open.length === 1 && state.open[0] === id, `${tag} #${id}: expected only this game open, got ${state.open.join(',')}`);
        check(state.height > 300, `${tag} #${id}: section looks empty (${state.height}px)`);
        check(state.cards >= 2, `${tag} #${id}: expected card gallery, found ${state.cards} cards`);
        check(state.hash === '#' + id, `${tag} #${id}: hash not updated (${state.hash})`);
        check(state.activeChip === id, `${tag} #${id}: active chip is ${state.activeChip}`);
        check(state.top >= state.barH - 2 && state.top < state.barH + 80, `${tag} #${id}: not scrolled under the switcher (top ${Math.round(state.top)})`);
        if (vp.width >= 1024) check(state.proseWidth > 0 && state.proseWidth <= MAX_PROSE_PX, `${tag} #${id}: text column ${Math.round(state.proseWidth)}px`);
        const broken = await loadAllImages(page, id);
        check(broken.length === 0, `${tag} #${id}: images not loaded: ${broken.join(', ')}`);
        check(await horizontalOverflow(page) <= 0, `${tag} #${id}: horizontal scroll`);
        if (shotDir && SHOT_GAMES.includes(id) && vp.name !== 'tablet') {
            await page.evaluate(gameId => {
                const el = document.getElementById(gameId);
                const gallery = el.querySelector('.hp-cards');
                const bar = document.getElementById('hp-switch').getBoundingClientRect().height;
                window.scrollTo(0, gallery.getBoundingClientRect().top + window.scrollY - bar - 60);
            }, id);
            await page.waitForTimeout(250);
            await page.screenshot({ path: path.join(shotDir, `howto-${id}-${vp.name}.png`) });
        }
    }

    // คำถามบ่อย + ปุ่ม back กลับไปเกมก่อนหน้า
    await page.click('#hp-switch [data-jump="faq"]');
    check(await page.isVisible('#faq') && await page.isVisible('#getting-started'), `${tag} #faq not visible`);
    await page.goBack();
    await page.waitForTimeout(150);
    check(await page.evaluate(last => !document.getElementById(last).hidden, games[games.length - 1]), `${tag} back button did not return to the last game`);

    // แตะการ์ดเปิดภาพใหญ่
    await page.click('#hp-switch [data-jump="coup"]');
    const card = page.locator('#coup .hp-card').first();
    await card.scrollIntoViewIfNeeded();
    if (vp.width < 600) await card.tap(); else await card.click();
    await page.waitForTimeout(200);
    const zoom = await page.evaluate(() => {
        const dlg = document.getElementById('hp-zoom');
        const img = dlg.querySelector('img');
        return { open: dlg.open, img: !!img, width: img ? img.getBoundingClientRect().width : 0 };
    });
    check(zoom.open && zoom.img && zoom.width > 150, `${tag} card tap did not open a large view (${JSON.stringify(zoom)})`);
    if (shotDir && vp.name === 'phone') await page.screenshot({ path: path.join(shotDir, 'howto-zoom-phone.png') });
    await page.click('#hp-zoom-close');
    await page.waitForTimeout(100);
    check(!(await page.evaluate(() => document.getElementById('hp-zoom').open)), `${tag} zoom did not close`);

    check(errors.length === 0, `${tag} errors: ${errors.join(' | ')}`);
    await ctx.close();
    return overviewKb;
}

async function runDeepLinks(browser, baseUrl) {
    const vp = VIEWPORTS[0];
    const cases = [
        ['coup', 'coup', 'coup'],
        ['poker5', 'poker5', 'poker5'],
        ['memory', 'solo', 'memory'],
        ['getting-started', null, 'getting-started']
    ];
    for (const [hash, gameId, targetId] of cases) {
        const { ctx, page, errors } = await newPage(browser, vp);
        await page.goto(`${baseUrl}/how-to-play#${hash}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(300);
        const state = await page.evaluate(([g, t]) => {
            const open = Array.from(document.querySelectorAll('.hp-game')).filter(x => !x.hidden).map(x => x.id);
            const target = document.getElementById(t);
            const r = target.getBoundingClientRect();
            return { open, targetTop: r.top, targetVisible: r.height > 0, hash: location.hash, gameOk: g ? open.length === 1 && open[0] === g : open.length === 0 };
        }, [gameId, targetId]);
        check(state.gameOk, `deep link #${hash}: open games ${state.open.join(',')}`);
        check(state.targetVisible && state.targetTop >= 0 && state.targetTop < vp.height * 0.5, `deep link #${hash}: target not in view (top ${Math.round(state.targetTop)})`);
        check(state.hash === '#' + hash, `deep link #${hash}: hash changed to ${state.hash}`);
        check(errors.length === 0, `deep link #${hash} errors: ${errors.join(' | ')}`);
        await ctx.close();
    }
}

async function runNoJs(browser, baseUrl) {
    const { ctx, page } = await newPage(browser, VIEWPORTS[0], { javaScriptEnabled: false });
    await page.goto(baseUrl + '/how-to-play', { waitUntil: 'domcontentloaded' });
    const visible = await page.$$eval('.hp-game', els => els.filter(el => el.offsetHeight > 200).length);
    const total = await page.$$eval('.hp-game', els => els.length);
    check(visible === total, `no-JS: only ${visible}/${total} games visible`);
    check(await horizontalOverflow(page) <= 0, 'no-JS: horizontal scroll');
    await ctx.close();
}

(async () => {
    const shotDir = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'howto-shots-'));
    fs.mkdirSync(shotDir, { recursive: true });
    let server = null;
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
        server = await spawnServer();
        baseUrl = server.baseUrl;
    }
    const browser = await chromium.launch();
    try {
        for (const vp of VIEWPORTS) {
            const kb = await runViewport(browser, baseUrl, vp, shotDir);
            console.log(`  ${vp.name} ${vp.width}x${vp.height}: all games ok · overview ~${kb}KB (content-length)`);
        }
        await runDeepLinks(browser, baseUrl);
        console.log('  deep links ok');
        await runNoJs(browser, baseUrl);
        console.log('  no-JS fallback ok');
    } catch (err) {
        failures.push('crash: ' + (err && err.stack || err));
    } finally {
        await browser.close();
        if (server) server.child.kill();
    }
    console.log('  screenshots: ' + shotDir);
    if (failures.length) {
        console.error('\nFAIL how-to-play smoke:\n - ' + failures.join('\n - '));
        process.exit(1);
    }
    console.log('PASS how-to-play smoke');
    process.exit(0);
})();
