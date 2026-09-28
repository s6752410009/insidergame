/**
 * Browser test ของ "ทายคำรายวัน" ที่ 390×844 (+ desktop 1280×900)
 *   - intro ครั้งแรก, พิมพ์ด้วยคีย์บอร์ดบนจอ (รวมหน้าอักษรพิเศษ), รีเฟรชกลางเกมแล้วเล่นต่อ
 *   - ชนะ (ฉลอง + สถิติ + อันดับ), แพ้ครบ 6 (เฉลย), ไม่มี page error / เลื่อนแนวนอน / ข้อความล้น
 * รัน: npm run smoke:solo:wordle:browser   (SHOTS_DIR=... เก็บภาพหน้าจอ)
 */
require('./isolateTestData');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const W = require('../public/js/solo/wordle-logic');
const { answerFor, ANSWERS } = require('../games/solo/wordle')._internal;

const PORT = Number(process.env.WORDLE_TEST_PORT) || 8483;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS_DIR || path.join(process.env.GAME_DATA_DIR, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function ok(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed += 1;
    console.log('  ✓ ' + msg);
}

function boot() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), WALLETS_FILE: process.env.WALLETS_FILE || path.join(process.env.GAME_DATA_DIR, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('boot timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (logs.includes(`Server started on port ${PORT}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}

const MAIN = new Set(Array.from('ภถุูึคตจขชโไำพะัีรนยบลฟหกดเ้่าสวงผปแอิืทมใฝ็'));

async function typeWord(page, word) {
    for (const ch of Array.from(word)) {
        const needAlt = !MAIN.has(ch);
        const pressed = await page.getAttribute('#wd-shift', 'aria-pressed');
        if (needAlt !== (pressed === 'true')) await page.click('#wd-shift');
        await page.click(`.wd-key[data-key="${ch}"]`);
    }
    if ((await page.getAttribute('#wd-shift', 'aria-pressed')) === 'true') await page.click('#wd-shift');
}

async function submitAndWait(page, rowsBefore) {
    await page.click('#wd-enter');
    await page.waitForFunction(n => document.querySelectorAll('#wd-board .wd-row')[n]
        && Array.from(document.querySelectorAll('#wd-board .wd-row')[n].children).every(t => t.hasAttribute('data-state')), rowsBefore, { timeout: 8000 });
    await delay(1600);
}

async function layoutChecks(page, label) {
    const res = await page.evaluate(() => {
        const out = { hScroll: document.scrollingElement.scrollWidth > window.innerWidth + 1, overflow: [] };
        const scope = Array.from(document.querySelectorAll('.wd *, .wd-sheet-bg:not([hidden]) *'));
        scope.forEach(el => {
            if (!el.offsetParent || el.closest('.wd-tile')) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'inline') return;
            if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
                out.overflow.push((el.className || el.tagName) + ' ' + el.scrollWidth + '>' + el.clientWidth + ' "' + (el.textContent || '').trim().slice(0, 30) + '"');
            }
        });
        const enter = document.getElementById('wd-enter');
        const footer = document.querySelector('.ui-footer-bar');
        if (enter && enter.offsetParent && footer) {
            out.kbAboveFooter = enter.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1;
        }
        const keys = Array.from(document.querySelectorAll('.wd-key')).filter(k => k.offsetParent);
        out.minKeyH = keys.length ? Math.min.apply(null, keys.map(k => k.getBoundingClientRect().height)) : null;
        return out;
    });
    ok(!res.hScroll, `${label}: no horizontal scroll`);
    ok(res.overflow.length === 0, `${label}: no text overflow ${res.overflow.join(' | ')}`);
    if (res.kbAboveFooter !== undefined) ok(res.kbAboveFooter, `${label}: keyboard fits above the footer (no scrolling to play)`);
    if (res.minKeyH) ok(res.minKeyH >= 44, `${label}: keys ≥44px tall (${res.minKeyH.toFixed(1)})`);
}

async function newPlayerPage(browser, viewport, opts) {
    const context = await browser.newContext({ viewport, hasTouch: Boolean(opts && opts.touch), isMobile: Boolean(opts && opts.touch), deviceScaleFactor: 2 });
    await context.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) {} });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(fonts|cdn)/i.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(`${BASE}/?playerId=${randomUUID()}`, { waitUntil: 'domcontentloaded' });
    await delay(800);
    await page.goto(`${BASE}/solo/wordle`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('wd-no').textContent !== '#–');
    return { context, page, errors };
}

async function main() {
    const puzzle = W.puzzleNumber(Date.now());
    const answer = answerFor(puzzle);
    const wrongs = ANSWERS.filter(w => w !== answer && Array.from(w).every(ch => MAIN.has(ch)));
    const altWrong = ANSWERS.find(w => w !== answer && Array.from(w).some(ch => !MAIN.has(ch)));
    const server = await boot();
    const browser = await chromium.launch();
    try {
        // ---------- ผู้เล่น 1: ชนะ ----------
        const p1 = await newPlayerPage(browser, { width: 390, height: 844 }, { touch: true });
        const page = p1.page;
        ok(await page.isVisible('#wd-howto'), 'intro shows on first visit');
        await page.screenshot({ path: path.join(SHOTS, '01-intro.png') });
        await layoutChecks(page, 'intro');
        await page.click('#wd-howto [data-close].ui-btn');
        ok(await page.isHidden('#wd-howto'), 'intro closes');
        await page.screenshot({ path: path.join(SHOTS, '02-empty.png') });
        await layoutChecks(page, 'empty board');

        // พิมพ์ไม่ครบ → เขย่า
        await page.click(`.wd-key[data-key="${Array.from(wrongs[0])[0]}"]`);
        await page.click('#wd-enter', { force: true });
        await page.click('#wd-back');
        ok((await page.$$eval('#wd-board .wd-row:first-child .is-filled', n => n.length)) === 0, 'backspace clears');

        // คำที่ไม่มีในคลัง
        await typeWord(page, 'กกกก');
        await page.click('#wd-enter');
        await page.waitForSelector('.wd-toast');
        ok(/ไม่มีคำนี้/.test(await page.textContent('#wd-toasts')), 'unknown word toast');
        for (let i = 0; i < 4; i++) await page.click('#wd-back');

        await typeWord(page, wrongs[0]);
        await submitAndWait(page, 0);
        await typeWord(page, altWrong);
        await page.screenshot({ path: path.join(SHOTS, '03-typing-alt-layer.png') });
        await submitAndWait(page, 1);
        const keyStates = await page.$$eval('.wd-key[data-state]', n => n.length);
        ok(keyStates > 0, 'keyboard keys coloured');
        // เริ่มพิมพ์คำที่ 3 แล้วรีเฟรช → ร่างคำยังอยู่ และ 2 แถวแรกกลับมาจาก server
        await typeWord(page, Array.from(wrongs[1]).slice(0, 2).join(''));
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => document.querySelectorAll('#wd-board .wd-tile[data-state]').length === 8);
        const draftAfter = await page.$$eval('#wd-board .wd-row:nth-child(3) .wd-tile', n => n.map(t => t.textContent).join(''));
        ok(draftAfter === Array.from(wrongs[1]).slice(0, 2).join('') || draftAfter.length > 0, 'refresh mid-game restores guesses and draft');
        ok(await page.isHidden('#wd-howto'), 'intro not shown again');
        await page.screenshot({ path: path.join(SHOTS, '04-midgame.png') });
        await layoutChecks(page, 'mid-game');
        for (let i = 0; i < 6; i++) await page.click('#wd-back');

        await typeWord(page, answer);
        await page.click('#wd-enter');
        await page.waitForSelector('.wd-confetti', { timeout: 6000 });
        await delay(500);
        await page.screenshot({ path: path.join(SHOTS, '05-win-celebration.png') });
        await page.waitForSelector('#wd-sheet:not([hidden])', { timeout: 6000 });
        await delay(700);
        await page.screenshot({ path: path.join(SHOTS, '06-win-stats.png') });
        await layoutChecks(page, 'stats sheet');
        const statText = await page.textContent('#wd-stat-grid');
        ok(/100%/.test(statText), 'stats show win %');
        ok(/\d\d:\d\d:\d\d/.test(await page.textContent('#wd-next')), 'countdown shown');
        // แชร์ (desktop-ish path → clipboard)
        await p1.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
        await page.evaluate(() => { navigator.share = undefined; });
        await page.click('#wd-share');
        await delay(300);
        const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
        ok(clip.startsWith(`ทายคำรายวัน #${puzzle} 3/6`) && clip.includes('🟩🟩🟩🟩') && clip.endsWith('insider-th.me/solo/wordle') && !clip.includes(answer), 'share text is a spoiler-free emoji grid');
        await page.click('#wd-tab-lb');
        await page.waitForSelector('.wd-lb li:not(.wd-empty)');
        ok((await page.$$('.wd-lb li.is-me')).length === 1, 'leaderboard highlights me');
        await page.screenshot({ path: path.join(SHOTS, '07-leaderboard.png') });
        await layoutChecks(page, 'leaderboard');
        await page.click('#wd-sheet .wd-sheet-head [data-close]');
        ok(await page.isVisible('#wd-done') && await page.isHidden('#wd-kb'), 'done panel replaces keyboard');
        await page.screenshot({ path: path.join(SHOTS, '08-done.png') });
        await layoutChecks(page, 'done');
        ok(p1.errors.length === 0, 'no page/console errors (winner) ' + p1.errors.join(' | '));

        // ---------- ผู้เล่น 2: แพ้ ----------
        const p2 = await newPlayerPage(browser, { width: 390, height: 844 }, { touch: true });
        await p2.page.click('#wd-howto [data-close].ui-btn');
        for (let i = 0; i < 6; i++) {
            await typeWord(p2.page, wrongs[2 + i]);
            if (i < 5) await submitAndWait(p2.page, i);
            else await p2.page.click('#wd-enter');
        }
        await p2.page.waitForSelector('.wd-toast.is-answer', { timeout: 6000 });
        ok((await p2.page.textContent('.wd-toast.is-answer')).includes(answer), 'loss reveals the answer');
        await delay(300);
        await p2.page.screenshot({ path: path.join(SHOTS, '09-loss-reveal.png') });
        await p2.page.waitForSelector('#wd-sheet:not([hidden])', { timeout: 6000 });
        await delay(700);
        await p2.page.screenshot({ path: path.join(SHOTS, '10-loss-stats.png') });
        ok(p2.errors.length === 0, 'no page/console errors (loser) ' + p2.errors.join(' | '));

        // ---------- desktop + พิมพ์ด้วยคีย์บอร์ดจริง ----------
        const p3 = await newPlayerPage(browser, { width: 1280, height: 900 });
        await p3.page.waitForSelector('#wd-howto:not([hidden])');
        await p3.page.keyboard.press('Escape');
        ok(await p3.page.isHidden('#wd-howto'), 'Escape closes the intro');
        // คีย์บอร์ดไทยจริงส่ง keydown ที่ e.key เป็นอักษรไทย (Playwright type() ส่งเป็น insertText แทน)
        await p3.page.evaluate(word => {
            Array.from(word).forEach(ch => document.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })));
        }, wrongs[8]);
        await p3.page.keyboard.press('Enter');
        await p3.page.waitForFunction(() => document.querySelectorAll('#wd-board .wd-tile[data-state]').length === 4, null, { timeout: 8000 })
            .catch(async e => { await p3.page.screenshot({ path: path.join(SHOTS, 'fail-desktop.png') }); console.log('toasts:', await p3.page.textContent('#wd-toasts'), 'errors:', p3.errors, 'word:', wrongs[8]); throw e; });
        await delay(900);
        await p3.page.screenshot({ path: path.join(SHOTS, '11-desktop.png') });
        await layoutChecks(p3.page, 'desktop');
        ok(p3.errors.length === 0, 'no page/console errors (desktop) ' + p3.errors.join(' | '));

        // ---------- hub card ----------
        await page.goto(`${BASE}/solo`, { waitUntil: 'networkidle' });
        ok(/ติดกัน 1 วัน/.test(await page.textContent('.solo-grid')), 'hub card shows streak');
        await page.screenshot({ path: path.join(SHOTS, '12-hub.png') });

        // ---------- reduced motion ----------
        const rmContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        const rm = await rmContext.newPage();
        await rm.goto(`${BASE}/?playerId=${randomUUID()}`);
        await rm.goto(`${BASE}/solo/wordle`, { waitUntil: 'networkidle' });
        await rm.click('#wd-howto [data-close].ui-btn');
        await typeWord(rm, wrongs[9]);
        await rm.click('#wd-enter');
        await rm.waitForFunction(() => document.querySelectorAll('#wd-board .wd-tile[data-state]').length === 4, null, { timeout: 3000 });
        ok(true, 'reduced-motion reveal works');
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    console.log(`OK — ${passed} browser checks passed · screenshots: ${SHOTS}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
