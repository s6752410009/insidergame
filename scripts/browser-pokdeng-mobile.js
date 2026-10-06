/**
 * ป๊อกเด้งบนมือถือ 390×844 (Playwright headless) — หัวห้อง + ขาไพ่ 1 คน + บอท 2
 * เช็กจุดที่ผู้เล่นจริงเจอ: แตะชิปพลาดแล้วย้อนได้ · ปุ่มสูงสุด/เท่าเดิม · ลงก้อนใหญ่ต้องยืนยัน
 * จั่ว/อยู่มีคำแนะนำ · สรุปผลบอกเหตุผลชนะ/แพ้ + เด้งมาจากฝั่งไหน · ปุ่มพร้อมมือต่อไป
 * หมุนเจ้ามือแล้วบอกล่วงหน้าว่าใครเป็นเจ้ามือ · จบโต๊ะ: คนที่ไม่ใช่หัวห้องกลับห้องเฉพาะตัวเอง
 * ทุกจังหวะ: ไม่มี JS error · ไม่เลื่อนแนวนอน · ปุ่มสูง ≥ 44px
 *
 * รัน: npm run smoke:pokdeng:mobile   (POKDENG_MOBILE_PORT=9031 · POKDENG_SHOT_DIR=<โฟลเดอร์ภาพ>)
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const PORT = Number(process.env.POKDENG_MOBILE_PORT) || 9031;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = process.env.POKDENG_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'pokdeng-shots-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error('FAIL: ' + m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|accounts\.google|cdn\.jsdelivr|cdnjs|ERR_INTERNET|ERR_NAME/i;

function assertPortFree() {
    return new Promise((resolve, reject) => {
        const sock = require('net').connect(PORT, '127.0.0.1');
        sock.once('connect', () => { sock.destroy(); reject(new Error(`port ${PORT} ถูกใช้อยู่`)); });
        sock.once('error', () => resolve());
    });
}

async function bootServer() {
    await assertPortFree();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(PORT),
            MONGO_URL: '',
            WALLETS_FILE: path.join(process.env.GAME_DATA_DIR, 'wallets.json'),
            POKDENG_BET_MS: '25000',
            POKDENG_DEAL_MS: '1200',
            POKDENG_DRAW_MS: '20000',
            POKDENG_DEALER_MS: '20000',
            POKDENG_RESULT_MS: '30000'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('startup timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += String(c); if (logs.includes(`Server started on port ${PORT}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += String(c); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}

async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await delay(100); }
    throw new Error('รอไม่ถึง: ' + label);
}

async function layoutProblems(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const out = [];
        if (document.documentElement.scrollWidth > vw + 1) out.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + vw);
        document.querySelectorAll('#pdRoot button').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || el.closest('[hidden]')) return;
            if (r.height < 43.5) out.push('small target #' + el.id + '.' + el.className + ' h=' + Math.round(r.height));
            if (r.right > vw + 1 || r.left < -1) out.push('offscreen #' + el.id + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
        });
        return out.slice(0, 6);
    });
}

const phaseOf = p => p.page.$eval('#pdRoot', el => el.dataset.phase).catch(() => '');
const has = (p, sel) => p.page.$(sel).then(Boolean).catch(() => false);
const text = (p, sel) => p.page.$eval(sel, el => el.textContent.trim()).catch(() => '');

(async () => {
    const server = await bootServer();
    const browser = await chromium.launch({ headless: true });
    const ps = [];
    try {
        for (const [tag, name] of [['host', 'หัวห้องสมศักดิ์ศรีสวัสดิ์'], ['p1', 'น้องมะปรางหวานใจมาก']]) {
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
            await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-pokdeng', '1'); } catch (e) { /* */ } });
            const page = await ctx.newPage();
            const p = { tag, name, id: randomUUID(), page, errors: [] };
            page.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) p.errors.push('console: ' + m.text().slice(0, 200)); });
            await page.goto(`${BASE}/?playerId=${p.id}`, { waitUntil: 'domcontentloaded' });
            ps.push(p);
        }
        const [host, p1] = ps;
        const emitOnRooms = (p, ev, payload) => p.page.evaluate(([e, d]) => new Promise(res => {
            const s = window.appSocket;
            const go = () => s.emit(e, d, r => res(r));
            if (s.connected) go(); else s.once('connect', go);
        }), [ev, payload]);

        await host.page.goto(`${BASE}/rooms?playerId=${host.id}`, { waitUntil: 'domcontentloaded' });
        const created = await emitOnRooms(host, 'createRoom', { name: 'โต๊ะป๊อกเด้งวันศุกร์', gameMode: 'pokdeng', maxPlayers: 6 });
        assert(created && created.success, 'สร้างห้อง: ' + JSON.stringify(created));
        const roomId = created.roomId;
        await host.page.goto(`${BASE}/room/${roomId}?playerId=${host.id}`, { waitUntil: 'domcontentloaded' });
        await p1.page.goto(`${BASE}/rooms?playerId=${p1.id}`, { waitUntil: 'domcontentloaded' });
        assert((await emitOnRooms(p1, 'joinRoom', { roomId }))?.success, 'p1 เข้าห้อง');
        await p1.page.goto(`${BASE}/room/${roomId}?playerId=${p1.id}`, { waitUntil: 'domcontentloaded' });
        await delay(1200);
        for (let i = 0; i < 2; i += 1) { await host.page.click('#btnPokDengAddBots'); await delay(900); }
        await waitFor(async () => host.page.$eval('#btnStartGameLobby', el => !el.disabled).catch(() => false), 10000, 'ปุ่มเริ่ม');
        await host.page.click('#btnStartGameLobby');
        for (const p of ps) await p.page.waitForURL(/\/game\//, { timeout: 20000 });
        console.log('1. ห้อง หัวห้อง + p1 + บอท 2 เริ่มโต๊ะ ✓');

        async function snap(label, who = ps) {
            await delay(500);
            for (const p of who) {
                const problems = await layoutProblems(p.page);
                assert(problems.length === 0, `${label}/${p.tag}: layout ${problems.join(' | ')}`);
                assert(p.errors.length === 0, `${label}/${p.tag}: ${p.errors.join(' | ')}`);
                await p.page.screenshot({ path: path.join(SHOT_DIR, `${label}-${p.tag}.png`) });
            }
        }

        // ---------- มือ 1: ลงเดิมพัน
        await waitFor(async () => (await phaseOf(p1)) === 'bet' && (await has(p1, '#pdBetBtn')), 15000, 'p1 ลงเดิมพันได้');
        assert(!(await has(host, '#pdBetBtn')), 'เจ้ามือไม่มีปุ่มลงเดิมพัน');
        assert(await p1.page.$eval('#pdUndoBtn', el => el.disabled), 'ยังไม่แตะชิป ปุ่มย้อนกดไม่ได้');
        assert(/สูงสุด 500/.test(await text(p1, '[data-set="max"]')), 'มีปุ่มสูงสุด 500');
        assert(!(await has(p1, '[data-set="last"]')), 'มือแรกยังไม่มีปุ่มเท่าเดิม');
        await p1.page.tap('.pd-chipbtn[data-chip="50"]');
        await p1.page.tap('.pd-chipbtn[data-chip="500"]'); // นิ้วพลาด
        assert(await text(p1, '#pdBetValue') === '500', 'ชิป 50 + 500 ชนเพดาน 500');
        await p1.page.tap('#pdUndoBtn');
        assert(await text(p1, '#pdBetValue') === '50', 'ย้อนแล้วกลับเป็น 50');
        await p1.page.tap('.pd-chipbtn[data-chip="100"]');
        assert(await text(p1, '#pdBetValue') === '150', 'แตะ 100 ต่อ = 150');
        await p1.page.tap('[data-set="max"]');
        assert(await text(p1, '#pdBetValue') === '500', 'ปุ่มสูงสุด = 500');
        await snap('10-bet-chips');
        await p1.page.tap('#pdBetBtn');
        assert(/แตะอีกครั้ง/.test(await text(p1, '#pdBetBtn')), 'ลงครึ่งหนึ่งของชิป ต้องแตะยืนยันอีกครั้ง');
        await p1.page.screenshot({ path: path.join(SHOT_DIR, '11-bet-confirm-p1.png') });
        assert((await phaseOf(p1)) === 'bet' && await has(p1, '#pdBetBtn'), 'แตะครั้งแรกยังไม่ลง');
        await p1.page.tap('#pdUndoBtn');
        assert(await text(p1, '#pdBetValue') === '150' && !/แตะอีกครั้ง/.test(await text(p1, '#pdBetBtn')), 'ย้อนแล้วยกเลิกการยืนยัน');
        await p1.page.tap('#pdBetBtn');
        await waitFor(async () => !(await has(p1, '#pdBetBtn')), 5000, 'ลง 150 (ไม่ต้องยืนยัน)');
        console.log('2. ลงเดิมพัน: แตะชิป · ย้อน · สูงสุด · ก้อนใหญ่ต้องยืนยัน ✓');

        // ---------- มือ 1: จั่ว/อยู่ (p1 อาจป๊อก) แล้วเจ้ามือ
        let sawP1Draw = false;
        let sawDealer = false;
        await waitFor(async () => {
            const ph = await phaseOf(p1);
            if (ph === 'result') return true;
            if (await has(p1, '#pdDrawBtn')) {
                const hint = await text(p1, '#pdActions .pd-hint');
                assert(/จั่ว|อยู่|เสี่ยง/.test(hint), 'มีคำแนะนำจั่ว/อยู่: ' + hint);
                assert(/แต้ม|ป๊อก|บอด|เซียน|ตอง|เรียง/.test(await text(p1, '.pd-me-label')), 'เห็นแต้มมือตัวเองตอนตัดสินใจ');
                if (!sawP1Draw) await snap('20-draw', [p1]);
                sawP1Draw = true;
                await p1.page.tap('#pdStayBtn');
            }
            if (await has(host, '#pdDrawBtn')) {
                assert(/เปิดวัด \d+ ขา/.test(await text(host, '#pdActions .pd-hint')), 'เจ้ามือเห็นว่าจะเปิดวัดกี่ขา');
                if (!sawDealer) await snap('21-dealer', [host]);
                sawDealer = true;
                await host.page.tap('#pdStayBtn');
            }
            return false;
        }, 60000, 'มือ 1 สรุปผล');
        console.log(`3. จั่ว/อยู่ (p1 ${sawP1Draw ? 'ตัดสินใจเอง' : 'ป๊อก/ข้าม'} · เจ้ามือ ${sawDealer ? 'ตัดสินใจเอง' : 'ป๊อก/ข้าม'}) ✓`);

        // ---------- มือ 1: สรุปผล
        await delay(900);
        const why = await text(p1, '#pdWhy');
        assert(/เจ้ามือ/.test(why) && /(ได้|เสีย) 150 ×|คืนเดิมพัน/.test(why), 'บอกเหตุผลชนะ/แพ้เทียบเจ้ามือ: ' + why);
        assert(/(ชนะ|แพ้|เสมอ)/.test(await text(p1, '.pd-seat .pd-outcome')), 'ป้ายผลที่นั่งมีคำ ชนะ/แพ้ ไม่ใช่แค่สี');
        assert(await has(p1, '#pdReadyBtn') && !(await has(p1, '#pdNextBtn')), 'ขาไพ่เห็นปุ่มพร้อมมือต่อไป');
        assert(await has(host, '#pdNextBtn'), 'หัวห้องเห็นปุ่มมือต่อไป');
        assert(/\(0\/2\)/.test(await text(p1, '#pdReadyBtn')), 'ปุ่มพร้อมบอกจำนวน 0/2');
        await snap('30-result');
        await p1.page.tap('#pdReadyBtn');
        await waitFor(async () => /รออีก 1 คน/.test(await text(p1, '#pdActions .pd-wait')), 5000, 'p1 พร้อมแล้ว รออีก 1');
        await waitFor(async () => /พร้อมแล้ว 1\/2/.test(await text(host, '#pdActions .pd-hint')), 5000, 'หัวห้องเห็น 1/2 พร้อม');
        // หัวห้องเปิดหมุนเจ้ามือ (มีผลมือหน้า) แล้วกดมือต่อไป
        assert(await p1.page.$eval('#pdRotateBtn', el => el.getAttribute('aria-disabled') === 'true'), 'ปุ่มเจ้ามือของคนอื่นกดเปลี่ยนไม่ได้');
        assert(await p1.page.$eval('#pdEndBtn', el => el.hidden), 'คนอื่นไม่เห็นปุ่มจบโต๊ะ');
        await host.page.tap('#pdRotateBtn');
        await waitFor(async () => /หมุนทุกตา/.test(await text(p1, '#pdRotateBtn')), 5000, 'ทุกคนเห็นว่าหมุนเจ้ามือ');
        await host.page.tap('#pdNextBtn');
        console.log('4. สรุปผล: เหตุผล + เด้ง · ปุ่มพร้อม 1/2 · หัวห้องเปิดหมุนเจ้ามือ ✓');

        // ---------- มือ 2: p1 เป็นเจ้ามือ (หมุนจากหัวห้อง)
        await waitFor(async () => (await phaseOf(p1)) === 'bet' && /มือที่ 2/.test(await text(p1, '#pdHandNo')), 15000, 'มือ 2');
        assert(/คุณเป็นเจ้ามือ/.test(await text(p1, '#pdNowCopy')), 'หมุนแล้ว p1 เป็นเจ้ามือ และหน้าจอบอกชัด');
        assert(!(await has(host, '[data-set="last"]')), 'มือก่อนเป็นเจ้ามือ (ไม่เคยลง) ไม่มีปุ่มเท่าเดิม');
        await host.page.tap('[data-set="min"]');
        await host.page.tap('#pdBetBtn');
        await waitFor(async () => {
            const ph = await phaseOf(p1);
            if (ph === 'result') return true;
            if (await has(host, '#pdDrawBtn')) await host.page.tap('#pdDrawBtn');
            if (await has(p1, '#pdDrawBtn')) await p1.page.tap('#pdStayBtn');
            return false;
        }, 60000, 'มือ 2 สรุปผล');
        await delay(900);
        assert(/มือหน้า: .+ เป็นเจ้ามือ|มือหน้า: คุณเป็นเจ้ามือ/.test(await text(p1, '.pd-next-dealer')), 'หมุนเจ้ามือ: บอกล่วงหน้าว่าใครเจ้ามือมือหน้า');
        assert(/กินขา \d+ · จ่ายขา \d+/.test(await text(p1, '#pdWhy')), 'เจ้ามือเห็นสรุป กิน/จ่าย กี่ขา');
        await snap('40-result-rotate');
        console.log('5. มือ 2: p1 เป็นเจ้ามือ · บอกเจ้ามือมือหน้า ✓');

        // ---------- แนวนอน
        await p1.page.setViewportSize({ width: 844, height: 390 });
        await delay(500);
        assert((await layoutProblems(p1.page)).length === 0, 'แนวนอนไม่ล้น');
        await p1.page.screenshot({ path: path.join(SHOT_DIR, '45-landscape-p1.png') });
        await p1.page.setViewportSize({ width: 390, height: 844 });

        // ---------- จบโต๊ะ
        await host.page.tap('#pdEndBtn');
        await host.page.waitForSelector('.swal2-confirm', { timeout: 5000 });
        await host.page.click('.swal2-confirm');
        await waitFor(async () => (await phaseOf(p1)) === 'finished', 10000, 'จบโต๊ะ');
        await delay(800);
        assert(await has(host, '#pdBackBtn') && !(await has(host, '#pdBackSelfBtn')), 'หัวห้อง: ปุ่มพาทุกคนกลับ');
        assert(await has(p1, '#pdBackSelfBtn') && !(await has(p1, '#pdBackBtn')), 'คนอื่น: ปุ่มกลับห้องเฉพาะตัวเอง');
        assert((await p1.page.$$('#pdMeCards .pd-card')).length === 0, 'จบโต๊ะ: ไม่โชว์ไพ่มือเก่าค้าง');
        await snap('50-finished');
        await p1.page.tap('#pdBackSelfBtn');
        await p1.page.waitForURL(/\/room\//, { timeout: 10000 });
        await delay(1500);
        assert(/\/game\//.test(host.page.url()), 'p1 กลับเอง หัวห้องยังอยู่หน้าสรุป (ไม่ลากทั้งวง)');
        console.log('6. จบโต๊ะ: หัวห้องพาทุกคน · คนอื่นกลับเฉพาะตัวเอง ✓');

        ps.forEach(p => assert(p.errors.length === 0, `${p.tag}: ${p.errors.join(' | ')}`));
        assert(!/\[pokdeng\].*failed/.test(server.logs()), 'server log มี error ของป๊อกเด้ง');
        console.log(`\n✅ browser-pokdeng-mobile: ${checks} checks passed (ภาพ: ${SHOT_DIR})`);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
