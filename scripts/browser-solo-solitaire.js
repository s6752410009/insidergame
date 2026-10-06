/**
 * เทสหน้าเล่นโซลิแทร์ในเบราว์เซอร์จริง (Playwright)
 *   - เล่นจนชนะ 1 ตาที่ 390×844: แตะ (touch) + ลากวาง (pointer) + ย้อน + รีเฟรชกลางเกม + เก็บไพ่อัตโนมัติ
 *   - ผลชนะต้องบันทึกขึ้น server และขึ้นตารางอันดับ
 *   - ไม่มี error, ไม่มี scroll แนวนอน, ข้อความไม่ล้นกรอบ, ภาพหน้าจอมือถือ + เดสก์ท็อป
 *
 * รัน: node scripts/browser-solo-solitaire.js
 *   BASE_URL=http://localhost:8485   ใช้เซิร์ฟเวอร์ที่รันอยู่แล้ว (ไม่งั้นจะเปิดเองบน PORT หรือ 8487)
 *   SHOTS_DIR=/path                  ที่เก็บภาพหน้าจอ
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const E = require('../public/js/solo/solitaire-engine');
const SEEDS = require('../public/js/solo/solitaire-seeds');
const { solve } = require('./solitaire-solver');

const SHOTS = process.env.SHOTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'solitaire-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

async function bootServer() {
    if (process.env.BASE_URL) return { base: process.env.BASE_URL, stop() {} };
    const port = Number(process.env.PORT) || 8487;
    const dataDir = process.env.GAME_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'solitaire-data-'));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), GAME_DATA_DIR: dataDir, WALLETS_FILE: path.join(dataDir, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
    return { base: `http://localhost:${port}`, stop() { child.kill('SIGTERM'); } };
}

async function layoutChecks(page, label) {
    const res = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflow = [];
        document.querySelectorAll('.sol *, dialog[open] *, .ui-footer-bar *').forEach(el => {
            if (el.children.length || !el.textContent.trim()) return;
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && getComputedStyle(el).textOverflow !== 'ellipsis') overflow.push(el.className + ':' + el.textContent.trim().slice(0, 20));
            if (r.right > window.innerWidth + 1 || r.left < -1) overflow.push('offscreen ' + el.className + ':' + el.textContent.trim().slice(0, 20));
        });
        const small = [];
        document.querySelectorAll('.sol button, dialog[open] button, .ui-footer-bar a').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width && (r.width < 44 || r.height < 44)) small.push(el.id || el.textContent.trim().slice(0, 12));
        });
        return { hScroll: doc.scrollWidth > window.innerWidth, overflow, small };
    });
    assert(!res.hScroll, `${label}: horizontal scroll`);
    assert(!res.overflow.length, `${label}: text overflow ${res.overflow.join(', ')}`);
    assert(!res.small.length, `${label}: touch target < 44px ${res.small.join(', ')}`);
}

/** จุดบนจอของไพ่ใบหนึ่ง (แถบบนสุดที่มองเห็นเสมอ) */
async function cardPoint(page, c, dy) {
    return page.evaluate(([c, dy]) => {
        const p = window.__solitaire.pos(c);
        const b = document.getElementById('solBoard').getBoundingClientRect();
        const cw = parseFloat(getComputedStyle(document.getElementById('solBoard')).getPropertyValue('--cw'));
        return { x: b.left + p.x + cw / 2, y: b.top + p.y + (dy == null ? 8 : dy) };
    }, [c, dy]);
}

async function pileDropPoint(page, to) {
    return page.evaluate(to => {
        const s = window.__solitaire.state;
        const b = document.getElementById('solBoard').getBoundingClientRect();
        const cw = parseFloat(getComputedStyle(document.getElementById('solBoard')).getPropertyValue('--cw'));
        const ch = cw * 1.4;
        const p = s.t[to];
        if (p.length) {
            const pos = window.__solitaire.pos(p[p.length - 1]);
            return { x: b.left + pos.x + cw / 2, y: b.top + pos.y + ch * 0.5 };
        }
        const slot = document.querySelectorAll('.sol-t')[to].getBoundingClientRect();
        return { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2 };
    }, to);
}

async function tap(page, pt) { await page.touchscreen.tap(pt.x, pt.y); }

async function drag(page, from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 4, from.y + 6, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
}

async function logLen(page) { return page.evaluate(() => window.__solitaire.game.log.length / 3); }

/** ทำการเดิน 1 ครั้งผ่าน UI จริง แล้วตรวจว่า log ตรงกับที่ตั้งใจ */
async function perform(page, mv, stats) {
    const code = E.encodeMove(mv);
    const before = await logLen(page);
    const s = await page.evaluate(() => window.__solitaire.state);
    if (mv.draw) {
        const box = await page.locator('.sol-stock').boundingBox();
        await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        stats.taps++;
    } else {
        let src;
        if (mv.from === 'w') src = s.waste[s.waste.length - 1];
        else if (typeof mv.from === 'number') src = s.t[mv.from][s.t[mv.from].length - mv.n];
        else { const suit = E.FOUNDATION_CODES.indexOf(mv.from); src = suit * 13 + s.f[suit] - 1; }
        if (mv.to === 'F') {
            await tap(page, await cardPoint(page, src, 12));
            stats.taps++;
        } else {
            await drag(page, await cardPoint(page, src, 8), await pileDropPoint(page, mv.to));
            stats.drags++;
        }
    }
    await page.waitForFunction(n => window.__solitaire.game.log.length / 3 > n, before, { timeout: 3000 })
        .catch(() => { throw new Error(`move ${code} did not register (log ${before})`); });
    const last = await page.evaluate(() => window.__solitaire.game.log.slice(-3));
    assert(last === code, `expected ${code}, UI made ${last}`);
}

(async () => {
    const server = await bootServer();
    const browser = await chromium.launch();
    const errors = [];
    // ป๊อปอัปชวนแชร์ของเว็บ (ครั้งแรกของ session) ไม่เกี่ยวกับเกมนี้ — ปิดไว้ไม่ให้บังการทดสอบ
    const quietPromo = ctx => ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) {} });
    const watch = page => {
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    };
    try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
        await quietPromo(ctx);
        const page = await ctx.newPage();
        watch(page);
        await page.goto(`${server.base}/?playerId=${randomUUID()}`);
        await page.goto(`${server.base}/solo/solitaire`);
        await page.waitForSelector('#dlgHelp[open]');
        await delay(400);
        await page.screenshot({ path: path.join(SHOTS, '01-intro.png') });
        await layoutChecks(page, 'intro');
        await page.click('#dlgHelp button');
        await delay(900);
        await page.screenshot({ path: path.join(SHOTS, '02-deal.png') });
        await layoutChecks(page, 'board');
        // แตะไพ่คว่ำ → ต้องมีปฏิกิริยา + เหตุผล (ไม่เงียบ)
        const downBox = await page.evaluate(() => {
            const s = window.__solitaire.state;
            const c = s.t[6][0];
            const r = document.querySelector('.sol-card[data-card="' + c + '"]').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + 3 };
        });
        await tap(page, downBox);
        await page.waitForFunction(() => document.getElementById('solToast').classList.contains('is-on') && /ไพ่คว่ำ/.test(document.getElementById('solToast').textContent), null, { timeout: 2000 });
        assert((await page.evaluate(() => window.__solitaire.game.log)) === '', 'tapping a face-down card does not move anything');

        // วางสำรับที่รู้ผล (seed ชนะได้) แล้วรีโหลด — ทดสอบการกู้เกมจาก localStorage ไปในตัว
        const seed = SEEDS[1][3];
        const sol = solve(seed, 1);
        assert(sol.solved, 'solver solves test seed');
        await page.goto(`${server.base}/solo`); // ออกจากหน้าเกมก่อน (pagehide จะเซฟเกมเดิมทับ)
        await page.evaluate(seed => {
            localStorage.setItem('solitaire:v1:game', JSON.stringify({ id: 'browsertest' + Date.now().toString(36), seed, draw: 1, deal: 'winnable', log: '', elapsed: 95000, won: false }));
        }, seed);
        await page.goto(`${server.base}/solo/solitaire`);
        await page.waitForFunction(s => window.__solitaire && window.__solitaire.game.seed === s, seed);
        assert(!(await page.locator('#dlgHelp[open]').count()), 'intro not shown again');
        await delay(300);

        // คำใบ้
        await page.click('#solHint');
        await page.waitForSelector('.is-hint', { timeout: 2000 });

        const stats = { taps: 0, drags: 0, undo: 0, reload: 0 };
        let i = 0;
        for (; i < sol.moves.length; i++) {
            if (await page.locator('#solAuto.is-on').count()) break;
            await perform(page, sol.moves[i], stats);
            if (i === 15) {
                await delay(300);
                await page.click('#solUndo');
                await page.waitForFunction(n => window.__solitaire.game.log.length / 3 === n, i);
                stats.undo++;
                await perform(page, sol.moves[i], stats);
            }
            if (i === 40) {
                const logBefore = await page.evaluate(() => window.__solitaire.game.log);
                await delay(300);
                await page.screenshot({ path: path.join(SHOTS, '03-midgame.png') });
                await page.reload();
                await page.waitForFunction(l => window.__solitaire && window.__solitaire.game.log === l, logBefore);
                stats.reload++;
                await delay(300);
                await layoutChecks(page, 'midgame');
            }
            await delay(260); // ให้แอนิเมชันจบก่อนอ่านตำแหน่ง
        }
        assert(i < sol.moves.length, 'auto-complete offered before the end');
        await page.screenshot({ path: path.join(SHOTS, '04-autocomplete.png') });
        await page.click('#solAuto');
        await page.waitForSelector('#dlgWin[open]', { timeout: 20000 });
        await delay(500);
        await page.screenshot({ path: path.join(SHOTS, '05-win.png') });
        await page.waitForFunction(() => document.getElementById('winSave').textContent === 'บันทึกผลแล้ว', null, { timeout: 8000 })
            .catch(async () => { throw new Error('win not saved: ' + await page.textContent('#winSave')); });
        await layoutChecks(page, 'win');
        const moves = await page.textContent('#winMoves');
        await page.waitForSelector('#solLb .sol-time');
        const lb = await page.textContent('#solLb');
        assert(/\d+:\d\d/.test(lb), 'leaderboard lists the win');
        assert((await page.textContent('#stWins')).trim() === '1 / 1', 'stats show 1 / 1');
        const apiStats = await page.evaluate(() => fetch('/api/solo/solitaire/stats').then(r => r.json()));
        assert(apiStats.data && apiStats.data.wins === 1 && apiStats.data.modes[1].bestMs >= 95000, 'server stats updated');

        // เล่นอีกตา → โหมดจั่ว 3
        await page.click('#btnAgain');
        await page.waitForFunction(() => window.__solitaire.game.log === '' && !window.__solitaire.game.won);
        await page.click('#solNew');
        await page.waitForSelector('#dlgNew[open]');
        assert(await page.locator('#newWarn').isHidden(), 'no loss warning before any move');
        await page.click('#dlgNew [data-draw="3"]');
        await page.screenshot({ path: path.join(SHOTS, '06-newgame.png') });
        await layoutChecks(page, 'new game dialog');
        await page.click('#btnDeal');
        await page.waitForFunction(() => window.__solitaire.game.draw === 3);
        await delay(1200);
        for (let k = 0; k < 3; k++) {
            const box = await page.locator('.sol-stock').boundingBox();
            await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
            await delay(300);
        }
        assert((await page.evaluate(() => window.__solitaire.state.waste.length)) === 9, 'draw-3 turned 9 cards');
        await page.screenshot({ path: path.join(SHOTS, '07-draw3.png') });
        // แจกใหม่กลางเกม = แพ้
        await page.click('#solNew');
        assert(await page.locator('#newWarn').isVisible(), 'loss warning shown mid-game');
        await page.click('#btnDeal');
        await page.waitForFunction(() => fetch('/api/solo/solitaire/stats').then(r => r.json()).then(b => b.data && b.data.games === 2), null, { timeout: 8000, polling: 500 });
        await page.screenshot({ path: path.join(SHOTS, '08-full.png'), fullPage: true });
        await layoutChecks(page, 'after loss');
        await ctx.close();

        // เดสก์ท็อป
        const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await quietPromo(desk);
        const dp = await desk.newPage();
        watch(dp);
        await dp.goto(`${server.base}/?playerId=${randomUUID()}`);
        await dp.goto(`${server.base}/solo/solitaire`);
        await dp.waitForSelector('#dlgHelp[open]');
        await dp.click('#dlgHelp button');
        await delay(1200);
        await dp.screenshot({ path: path.join(SHOTS, '09-desktop.png') });
        await layoutChecks(dp, 'desktop');
        await desk.close();

        // ลดการเคลื่อนไหว: ชนะแล้วไม่มีไพ่เด้ง
        const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true });
        await quietPromo(rm);
        const rp = await rm.newPage();
        watch(rp);
        await rp.goto(`${server.base}/?playerId=${randomUUID()}`);
        const seed2 = SEEDS[1][5];
        const sol2 = solve(seed2, 1);
        await rp.evaluate(([seed, log]) => {
            localStorage.setItem('solitaire:v1:intro', '1');
            localStorage.setItem('solitaire:v1:game', JSON.stringify({ id: 'reducedmo' + Date.now().toString(36), seed, draw: 1, deal: 'winnable', log, elapsed: 120000, won: false }));
        }, [seed2, sol2.moves.slice(0, -1).map(E.encodeMove).join('')]);
        await rp.goto(`${server.base}/solo/solitaire`);
        await rp.waitForFunction(() => window.__solitaire);
        await rp.evaluate(code => window.__solitaire.move(code), E.encodeMove(sol2.moves[sol2.moves.length - 1]));
        await rp.waitForSelector('#dlgWin[open]');
        assert(!(await rp.locator('.sol-cascade img').count()), 'no cascade with reduced motion');
        // ปัดหน้าต่างชนะทิ้ง (Esc / ปุ่มย้อนกลับมือถือ) → ยังอยู่บนโต๊ะที่ชนะ ไม่แจกใหม่เอง
        const wonId = await rp.evaluate(() => window.__solitaire.game.id);
        await rp.keyboard.press('Escape');
        await delay(400);
        assert(!(await rp.locator('#dlgWin[open]').count()), 'win dialog closes on Escape');
        assert(await rp.evaluate(id => window.__solitaire.game.id === id && window.__solitaire.game.won, wonId), 'dismissing the win dialog keeps the won board');
        assert(/เกมใหม่/.test(await rp.textContent('#solToast')), 'tells how to start the next game');
        await rm.close();

        assert(!errors.length, 'page errors: ' + errors.join(' | '));
        console.log(`browser-solo-solitaire: won in ${moves} moves (${stats.taps} taps, ${stats.drags} drags, ${stats.undo} undo, ${stats.reload} reload, auto-complete from move ${i}); shots → ${SHOTS}`);
    } finally {
        await browser.close();
        server.stop();
    }
})().catch(error => { console.error(error); process.exit(1); });
