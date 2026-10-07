/**
 * เทสเบราว์เซอร์ ป๊อกเด้งท้าเจ้ามือ (Playwright) — เล่นจริงบนจอมือถือ 390×844 จนหมดตัว + ภาพเดสก์ท็อป
 * รัน: node scripts/browser-solo-pokdengsolo.js
 *   SOLO_TEST_PORT=8491 · SOLO_SHOTS=<โฟลเดอร์เก็บภาพ> (ไม่ตั้ง = ไม่เซฟภาพ)
 */

require('./isolateTestData');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const PORT = Number(process.env.SOLO_TEST_PORT) || 8491;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SOLO_SHOTS || '';
const MAX_HANDS = Number(process.env.SOLO_MAX_HANDS) || 25; // 80 มือบางทีเกิน 5 นาที (ชนะติดไม่หมดตัว)

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed += 1;
}

// server ค้างจากรอบก่อนที่ยังจองพอร์ตอยู่ = เทสต์จะไปคุยกับ server เก่า (คนละคุกกี้ → 403 มั่วๆ) — ให้พังชัดๆ แทน
function assertPortFree() {
    return new Promise((resolve, reject) => {
        const sock = require('net').connect(PORT, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); reject(new Error(`port ${PORT} ถูกใช้อยู่ — ปิด server ค้างก่อน (lsof -ti:${PORT} | xargs kill)`)); });
        sock.once('error', () => resolve());
    });
}

async function bootServer() {
    await assertPortFree();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), MONGO_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('startup timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => {
            logs += String(c);
            if (logs.includes(`Server started on port ${PORT}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', c => { logs += String(c); process.stderr.write('[server] ' + c); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}

async function shot(page, name) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

/** รอจนปุ่มหลักพร้อมกด (ไม่ busy) — คืนชื่อปุ่ม: deal | draw | newrun */
async function waitReady(page, timeout = 20000) {
    const handle = await page.waitForFunction(() => {
        const btn = document.querySelector('#pdsActions [data-act="draw"], #pdsActions [data-act="deal"], #pdsActions [data-act="newrun"]');
        if (!btn) return null;
        const chipsLive = document.querySelector('#pdsActions [data-act="clear"]');
        const ready = btn.dataset.act === 'deal' ? (chipsLive && !chipsLive.disabled) : !btn.disabled;
        return ready ? btn.dataset.act : null;
    }, null, { timeout });
    return handle.jsonValue();
}

async function layoutProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth + 1) out.push(`horizontal scroll ${doc.scrollWidth} > ${doc.clientWidth}`);
        const vw = doc.clientWidth;
        document.querySelectorAll('.pds *, .ui-footer-bar *').forEach(el => {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]') || el.closest('.pds-fx')) return;
            if (el.closest('.pds-outcome') || el.closest('.pds-burst')) return; // ป้ายเอฟเฟกต์ชั่วคราว
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            if (r.right > vw + 1 || r.left < -1) out.push(`off-screen: ${el.className || el.tagName} (${Math.round(r.left)}–${Math.round(r.right)})`);
            const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
            if (hasText && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible') {
                out.push(`truncated: ${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}"`);
            }
        });
        return out;
    });
}

(async () => {
    const server = await bootServer();
    const browser = await chromium.launch();
    const errors = [];
    try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
        // ป๊อปอัปประชาสัมพันธ์ของทั้งเว็บ (ขึ้นครั้งเดียวต่อ session) ไม่เกี่ยวกับเกมนี้ — ปิดไว้ไม่ให้บังการกด
        const noPromo = () => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } };
        await ctx.addInitScript(noPromo);
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        // console บอกแค่สถานะ ไม่บอก URL — เก็บ URL ของคำขอที่พังไว้ให้ไล่ต่อได้
        page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const text = m.text();
            if (/fonts\.g|Failed to load resource.*(fonts|gstatic)|sweetalert|jsdelivr|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(text)) return;
            // เทสจำลองเน็ตหลุด/รีสตาร์ตเซิร์ฟเวอร์เอง — เบราว์เซอร์จะบ่นว่าต่อ socket/โหลดไม่ได้ช่วงนั้น ไม่ใช่บัคของหน้า
            if (/WebSocket connection to .* failed|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|net::ERR_EMPTY_RESPONSE/i.test(text)) return;
            errors.push('console: ' + text);
        });

        const id = randomUUID();
        await page.goto(`${BASE}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(800);
        await page.goto(`${BASE}/solo/pokdengsolo`, { waitUntil: 'domcontentloaded' });

        // ---------- intro ครั้งแรก ----------
        await page.waitForSelector('#pdsSheet:not([hidden])', { timeout: 10000 });
        await page.waitForTimeout(400);
        await shot(page, '01-intro-390');
        await page.click('#pdsSheetClose');
        assert(await page.isHidden('#pdsSheet'), 'ปิด intro ได้');

        let act = await waitReady(page);
        assert(act === 'deal', 'เริ่มรอบ พร้อมลงเดิมพัน');
        assert((await page.textContent('#pdsChips')).trim() === '1,000', 'เริ่ม 1,000 ชิป');
        let probs = await layoutProblems(page);
        assert(probs.length === 0, 'layout หน้าลงเดิมพัน: ' + probs.join(' | '));
        await shot(page, '02-bet-390');

        // ---------- อันดับไพ่ ----------
        await page.click('#pdsRankBtn');
        await page.waitForSelector('#pdsSheet:not([hidden])');
        await page.waitForTimeout(400);
        await shot(page, '03-ranks-390');
        probs = await layoutProblems(page);
        assert(probs.length === 0, 'layout ตารางอันดับไพ่: ' + probs.join(' | '));
        await page.keyboard.press('Escape');

        // ---------- ปุ่มชิป ----------
        await page.click('[data-act="clear"]');
        assert(await page.isDisabled('[data-act="deal"]'), 'ล้างแล้วแจกไม่ได้');
        await page.click('[data-chip="100"]');
        await page.click('[data-chip="50"]');
        assert((await page.textContent('#pdsBetAmt')).trim() === '150', 'ชิป 100 + 50 = 150');
        await page.click('[data-act="double"]');
        assert((await page.textContent('#pdsBetAmt')).trim() === '300', '×2 = 300');

        // ---------- เน็ตหลุดตอนลงเดิมพัน → มีปุ่มลองใหม่ ไม่ค้าง ไม่หักซ้ำ ----------
        await ctx.setOffline(true);
        await page.click('[data-act="deal"]');
        await page.waitForSelector('#pdsError:not([hidden])', { timeout: 10000 });
        assert((await page.textContent('#pdsChips')).trim() === '1,000', 'เน็ตหลุด ชิปกลับเป็นเดิม');
        await ctx.setOffline(false);
        await page.click('#pdsRetry');
        act = await waitReady(page);
        assert(act === 'draw' || act === 'deal' || act === 'newrun', 'กดลองใหม่แล้วเล่นต่อได้');
        assert(await page.isHidden('#pdsError'), 'ข้อความ error หายไป');

        // ---------- เน็ตหลุดอีกรอบ → พอเน็ตกลับมา ส่งต่อให้เองโดยไม่ต้องกดลองใหม่ ----------
        const tableKey = () => page.evaluate(() => fetch('/api/solo/pokdengsolo/state', { cache: 'no-store' }).then(r => r.json()).then(j => j.state.handNo + ':' + j.state.phase));
        const keyBefore = await tableKey();
        await ctx.setOffline(true);
        await page.click(act === 'draw' ? '[data-act="stay"]' : '[data-act="deal"]');
        await page.waitForSelector('#pdsError:not([hidden])', { timeout: 10000 });
        await ctx.setOffline(false);
        await page.waitForSelector('#pdsError', { state: 'hidden', timeout: 10000 });
        act = await waitReady(page);
        assert((await tableKey()) !== keyBefore, 'ต่อเน็ตแล้วส่งคำสั่งที่ค้างให้เอง (ไม่ต้องกดลองใหม่)');
        if (act === 'draw') {
            await page.click('[data-act="stay"]');
            act = await waitReady(page);
        }

        // ---------- เล่นจนหมดตัว ----------
        let hands = 0;
        let drawShot = false;
        let resultShot = false;
        let refreshed = false;
        while (hands < MAX_HANDS) {
            if (hands === 1) await page.click('[data-act="max"]'); // ลงสุดทุกมือ จะได้หมดตัวไว
            const before = await page.textContent('#pdsChips');
            await page.click('[data-act="deal"]');
            act = await waitReady(page);
            if (act === 'draw') {
                assert(await page.locator('#pdsDealerCards .pc').count() === 2, 'เจ้ามือ 2 ใบคว่ำ');
                assert(await page.locator('#pdsDealerCards .pc-face').count() === 0, 'ไพ่เจ้ามือยังไม่มีหน้าใน DOM');
                if (!drawShot) {
                    await shot(page, '04-draw-390');
                    probs = await layoutProblems(page);
                    assert(probs.length === 0, 'layout ตาจั่ว: ' + probs.join(' | '));
                    drawShot = true;
                }
                if (!refreshed) {
                    const cards = await page.locator('#pdsPlayerCards .pc').count();
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    act = await waitReady(page);
                    assert(act === 'draw', 'รีเฟรชกลางมือ กลับมาตาจั่วเหมือนเดิม');
                    assert(await page.locator('#pdsPlayerCards .pc').count() === cards, 'ไพ่ในมือกลับมาครบ');
                    assert(await page.isHidden('#pdsSheet'), 'intro ไม่เด้งซ้ำ');
                    refreshed = true;
                }
                const pts = await page.textContent('#pdsPlayerLabel');
                const low = /^(บอด|[0-4] แต้ม)/.test(pts.trim());
                await page.click(low ? '[data-act="draw"]' : '[data-act="stay"]');
                if (!resultShot) {
                    await page.waitForSelector('.pds-outcome.is-on', { timeout: 15000 });
                    await page.waitForTimeout(350);
                    await shot(page, '05-result-390');
                    resultShot = true;
                }
                act = await waitReady(page);
            }
            hands += 1;
            const after = await page.textContent('#pdsChips');
            assert(before !== null && after !== null, 'มีชิปแสดง');
            if (act === 'newrun') break;
        }
        assert(hands >= 1, `เล่นไป ${hands} มือ`);
        if (act === 'newrun') {
            await page.waitForTimeout(400);
            await shot(page, '06-busted-390');
            probs = await layoutProblems(page);
            assert(probs.length === 0, 'layout หมดตัว: ' + probs.join(' | '));
            await page.click('[data-act="newrun"]');
            act = await waitReady(page);
            assert(act === 'deal' && (await page.textContent('#pdsChips')).trim() === '1,000', 'เริ่มรอบใหม่ 1,000 ชิป');
        }
        const hasBoard = await page.locator('#pdsBoard li:not(.pds-board-empty)').count();
        assert(hasBoard >= 1, 'ตารางอันดับมีชื่อเรา');
        await page.evaluate(() => document.getElementById('pdsStats').scrollIntoView());
        await page.waitForTimeout(300);
        await shot(page, '07-stats-390');
        probs = await layoutProblems(page);
        assert(probs.length === 0, 'layout สถิติ/อันดับ: ' + probs.join(' | '));

        // ---------- หน้า /solo ----------
        await page.goto(`${BASE}/solo`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        const card = page.locator('a.solo-card[href^="/solo/pokdengsolo"]');
        assert(await card.count() === 1, 'การ์ดบนหน้า /solo');
        assert(/สูงสุด/.test(await card.textContent()), 'การ์ดโชว์สถิติสูงสุด');
        await card.scrollIntoViewIfNeeded();
        await shot(page, '08-hub-390');

        // ---------- เดสก์ท็อป ----------
        const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await desk.addInitScript(noPromo);
        const dp = await desk.newPage();
        dp.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
        await dp.goto(`${BASE}/?playerId=${randomUUID()}`, { waitUntil: 'domcontentloaded' });
        await dp.waitForTimeout(800);
        await dp.goto(`${BASE}/solo/pokdengsolo`, { waitUntil: 'domcontentloaded' });
        await dp.waitForSelector('#pdsSheet:not([hidden])');
        await dp.click('#pdsSheetClose');
        await waitReady(dp);
        await dp.click('[data-act="deal"]');
        const dAct = await waitReady(dp);
        await dp.waitForTimeout(dAct === 'draw' ? 200 : 900);
        await shot(dp, '09-desktop-1280');
        probs = await layoutProblems(dp);
        assert(probs.length === 0, 'layout เดสก์ท็อป: ' + probs.join(' | '));

        // ---------- ฉากฉลองป๊อก (ปลอม response ฝั่ง browser เพื่อดูเอฟเฟกต์ — เซิร์ฟเวอร์ไม่เกี่ยว) ----------
        {
            const pd = require('../games/pokdengEngine');
            const pc = await ctx.newPage();
            pc.on('pageerror', e => errors.push('pok pageerror: ' + e.message));
            await pc.goto(`${BASE}/solo/pokdengsolo`, { waitUntil: 'domcontentloaded' });
            await waitReady(pc);
            await pc.route('**/api/solo/pokdengsolo/bet', async route => {
                const body = JSON.parse(route.request().postData() || '{}');
                const real = await (await route.fetch()).json(); // ให้เซิร์ฟเวอร์เดินจริง แล้วแต่งผลที่โชว์
                const ev = cards => { const e = pd.evaluateHand(cards); return { points: e.points, deng: e.deng, pok: e.pok, special: e.special, tier: e.tier, name: e.name, label: e.label }; };
                const player = ['4H', '5H'];
                const dealer = ['KS', '3D'];
                const st = real.state;
                st.phase = 'bet';
                st.hand = null;
                st.handNo = body.hand;
                st.chips = 1000 - body.amount + body.amount * 3;
                st.lastResult = {
                    handNo: body.hand, bet: body.amount, outcome: 'win', multiplier: 2, delta: body.amount * 2, short: false,
                    chipsAfter: st.chips, playerDrew: false, dealerDrew: false,
                    player: { cards: player.map(pd.describeCard), eval: ev(player) },
                    dealer: { cards: dealer.map(pd.describeCard), eval: ev(dealer) }
                };
                await route.fulfill({ json: real });
            });
            await pc.click('[data-act="deal"]');
            await pc.waitForSelector('.pds-burst', { timeout: 15000 });
            await pc.waitForTimeout(250);
            await shot(pc, '10-pok-burst-390');
            await pc.waitForSelector('.pds-outcome.is-on', { timeout: 15000 });
            await pc.waitForTimeout(400);
            await shot(pc, '11-pok-win-390');
            await waitReady(pc);
            await pc.close();
        }

        // ---------- กติกาที่เลือกได้ (⚙️) + ทางกลับระหว่างเล่น ----------
        {
            const pr = await ctx.newPage();
            pr.on('pageerror', e => errors.push('rules pageerror: ' + e.message));
            await pr.goto(`${BASE}/solo/pokdengsolo`, { waitUntil: 'domcontentloaded' });
            let a2 = await waitReady(pr);
            if (a2 === 'newrun') { await pr.click('[data-act="newrun"]'); a2 = await waitReady(pr); }
            await pr.click('#pdsRulesBtn');
            await pr.waitForSelector('#pdsSheet:not([hidden]) [data-rule="mustDraw"]');
            assert(await pr.isChecked('[data-rule="straights"]') && !(await pr.isChecked('[data-rule="mustDraw"]')), 'ค่าเริ่ม: นับเรียง เปิด · ต่ำกว่า 4 ต้องจั่ว ปิด');
            await pr.click('[data-rule="mustDraw"]');
            await pr.waitForTimeout(300);
            await shot(pr, '12-rules-390');
            probs = await layoutProblems(pr);
            assert(probs.length === 0, 'layout กติกา: ' + probs.join(' | '));
            await pr.click('#pdsSheetClose');
            const saved = await pr.evaluate(() => JSON.parse(localStorage.getItem('pokdengsolo.rules.v1') || 'null'));
            assert(saved && saved.mustDraw === true && saved.straights === true, 'จำกติกาไว้ในเครื่อง');
            await pr.reload({ waitUntil: 'domcontentloaded' });
            a2 = await waitReady(pr);
            await pr.click('#pdsRulesBtn');
            assert(await pr.isChecked('[data-rule="mustDraw"]'), 'รีเฟรชแล้วกติกายังอยู่');
            await pr.keyboard.press('Escape');
            let forced = false;
            let drawSeen = false;
            let ours = false; // มือที่ค้างจากก่อนเปิดกติกา ใช้กติกาเดิม (ล็อกตอนแจก) — นับเฉพาะมือที่เราแจกหลังตั้งค่า
            for (let i = 0; i < 60 && !forced; i += 1) {
                if (a2 === 'newrun') { await pr.click('[data-act="newrun"]'); a2 = await waitReady(pr); }
                if (a2 === 'deal') {
                    ours = true;
                    await pr.click('[data-act="clear"]');
                    await pr.click('[data-chip="10"]');
                    await pr.click('[data-act="deal"]');
                    a2 = await waitReady(pr);
                }
                if (a2 !== 'draw') continue;
                if (!drawSeen) {
                    drawSeen = true;
                    // ทางกลับรายการเกมเห็นชัดตลอด (มือค้างไว้ที่เซิร์ฟเวอร์ ไม่เสียเดิมพัน)
                    const back = pr.locator('.ui-footer-bar a.ui-back[href^="/solo"]');
                    const where = await back.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, vis: getComputedStyle(el).visibility }; });
                    assert(await back.isVisible() && where.top >= 0 && where.bottom <= where.h + 1, 'ปุ่ม ← เกมเดี่ยว อยู่ในจอระหว่างจั่ว ' + JSON.stringify(where));
                }
                const pts = (await pr.textContent('#pdsPlayerLabel')).trim();
                const low = /^(บอด|[0-3] แต้ม)/.test(pts);
                if (low && ours) {
                    forced = true;
                    assert(await pr.isDisabled('[data-act="stay"]'), 'ต่ำกว่า 4 ปุ่มอยู่กดไม่ได้');
                    assert(/ต้องจั่ว/.test(await pr.textContent('#pdsActions .pds-hint')), 'บอกว่าต้องจั่ว');
                    await shot(pr, '13-must-draw-390');
                    await pr.click('[data-act="draw"]');
                } else {
                    await pr.click(low ? '[data-act="draw"]' : '[data-act="stay"]');
                }
                a2 = await waitReady(pr);
            }
            assert(forced, 'เจอมือต่ำกว่า 4 ที่ต้องจั่ว');
            if (a2 === 'draw') { await pr.click('[data-act="draw"]'); a2 = await waitReady(pr); }
            if (a2 === 'deal') {
                await pr.click('[data-act="clear"]');
                await pr.click('[data-chip="10"]');
                await pr.click('[data-act="deal"]');
                a2 = await waitReady(pr);
            }
            if (a2 === 'draw') {
                const chips = (await pr.textContent('#pdsChips')).trim();
                await pr.click('.ui-footer-bar a.ui-back');
                await pr.waitForURL(u => new URL(u).pathname === '/solo', { timeout: 10000 });
                assert(new URL(pr.url()).pathname === '/solo', 'กดกลับกลางมือ → หน้ารายการเกมเดี่ยว');
                await pr.goto(`${BASE}/solo/pokdengsolo`, { waitUntil: 'domcontentloaded' });
                assert((await waitReady(pr)) === 'draw' && (await pr.textContent('#pdsChips')).trim() === chips, 'กลับมาแล้วมือเดิมยังรออยู่ ชิปไม่หาย');
            }
            await pr.close();
        }

        assert(errors.length === 0, 'ไม่มี error ในหน้า: ' + errors.join(' | '));
        console.log(`✅ browser-solo-pokdengsolo: ${passed} assertions passed (${hands} hands on mobile)`);
    } finally {
        if (errors.length) console.error('errors seen:', errors.join(' | '));
        await browser.close();
        server.kill('SIGTERM');
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
