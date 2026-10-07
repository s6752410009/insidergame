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

/** ปุ่ม "🚪 ออก" เห็นได้ทันที ไม่ต้องเปิดอะไร: มีป้าย สูง ≥ 44 อยู่ในจอ ไม่มีอะไรบัง */
async function exitVisible(p) {
    return p.page.evaluate(() => {
        const el = document.getElementById('pdExitBtn');
        if (!el) return 'ไม่มีปุ่ม';
        const r = el.getBoundingClientRect();
        if (!/🚪\s*ออก/.test(el.textContent)) return 'ป้ายไม่ใช่ 🚪 ออก: ' + el.textContent;
        if (r.height < 43.5 || r.width < 44) return 'เล็กไป ' + Math.round(r.width) + '×' + Math.round(r.height);
        if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return 'ล้นจอ';
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || (hit !== el && !el.contains(hit))) return 'โดนบังโดย ' + (hit ? hit.id || hit.className : 'null');
        return 'ok';
    }).catch(e => 'error ' + e.message);
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
        // หัวห้องเลือกหมุนเจ้ามือได้ก่อนแจกมือแรกเท่านั้น
        assert(await p1.page.$eval('#pdRotateBtn', el => el.getAttribute('aria-disabled') === 'true'), 'ปุ่มเจ้ามือของคนอื่นกดเปลี่ยนไม่ได้');
        assert(await host.page.$eval('#pdRotateBtn', el => el.getAttribute('aria-disabled') === 'false'), 'หัวห้องสลับได้ก่อนแจกมือแรก');
        await host.page.tap('#pdRotateBtn');
        await waitFor(async () => /หมุนทุกตา/.test(await text(p1, '#pdRotateBtn')), 5000, 'ทุกคนเห็นว่าหมุนเจ้ามือ');
        await waitFor(async () => /กองเจ้ามือ 1,000/.test(await text(p1, '#pdDealer')), 5000, 'หมุนเจ้ามือ: กองหัวห้องเหลือ 1,000');
        // อันดับไพ่ (ค่าเริ่ม นับเรียง): มีสเตรทฟลัช · A-2-3 ไม่นับ
        await delay(2500); // ให้ toast สลับเจ้ามือหายก่อน
        for (const p of ps) {
            await p.page.evaluate(() => window.scrollTo(0, 0));
            assert((await exitVisible(p)) === 'ok', `ปุ่มออกตอนลงเดิมพัน (${p.tag}): ${await exitVisible(p)}`);
        }
        await host.page.screenshot({ path: path.join(SHOT_DIR, '04-exit-button-host.png') });
        await p1.page.tap('#pdRankBtn');
        await p1.page.waitForSelector('.swal2-popup .pd-guide', { timeout: 5000 });
        const rankText = await text(p1, '.swal2-popup .pd-guide');
        assert(/สเตรทฟลัช/.test(rankText) && /A-2-3 กับ K-A-2 ไม่นับ/.test(rankText), 'อันดับไพ่มีสเตรทฟลัช และบอกว่า A-2-3 ไม่นับ');
        await p1.page.screenshot({ path: path.join(SHOT_DIR, '05-rank-guide-p1.png') });
        await p1.page.click('.swal2-confirm');
        await delay(400);
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
        for (const p of ps) {
            await p.page.evaluate(() => window.scrollTo(0, 0));
            assert((await exitVisible(p)) === 'ok', `ปุ่มออกตอนสรุปผล (${p.tag}): ${await exitVisible(p)}`);
        }
        // แตะออกแล้วกด "อยู่ต่อ" = ยังอยู่โต๊ะเดิม
        await p1.page.tap('#pdExitBtn');
        await p1.page.waitForSelector('.swal2-popup .pd-exit-list', { timeout: 5000 });
        assert(/โต๊ะเล่นต่อโดยไม่มีคุณ/.test(await text(p1, '.pd-exit-list')), 'ยืนยันออกบอกว่าโต๊ะเล่นต่อ');
        await p1.page.click('.swal2-cancel');
        await delay(500);
        assert(/\/game\//.test(p1.page.url()) && (await phaseOf(p1)) === 'result', 'กดอยู่ต่อ ยังอยู่โต๊ะ');
        await snap('30-result');
        await p1.page.tap('#pdReadyBtn');
        await waitFor(async () => /รออีก 1 คน/.test(await text(p1, '#pdActions .pd-wait')), 5000, 'p1 พร้อมแล้ว รออีก 1');
        await waitFor(async () => /พร้อมแล้ว 1\/2/.test(await text(host, '#pdActions .pd-hint')), 5000, 'หัวห้องเห็น 1/2 พร้อม');
        // แจกมือแรกแล้ว แบบเจ้ามือล็อก
        assert(await p1.page.$eval('#pdEndBtn', el => el.hidden), 'คนอื่นไม่เห็นปุ่มจบโต๊ะ');
        assert(await host.page.$eval('#pdRotateBtn', el => el.getAttribute('aria-disabled') === 'true'), 'หลังแจกมือแรก ปุ่มแบบเจ้ามือล็อก');
        await host.page.tap('#pdRotateBtn', { force: true }); // aria-disabled แต่ยังแตะได้ (ขึ้นบอกว่าล็อก)
        await host.page.waitForSelector('.swal2-toast', { timeout: 3000 });
        assert(/ล็อก/.test(await text(host, '.swal2-toast')), 'แตะตอนล็อก บอกว่าล็อกแล้ว');
        assert(/หมุนทุกตา/.test(await text(p1, '#pdRotateBtn')), 'ยังหมุนเจ้ามืออยู่');
        await host.page.tap('#pdNextBtn');
        console.log('4. สรุปผล: เหตุผล + เด้ง · ปุ่มพร้อม 1/2 · แบบเจ้ามือล็อกหลังแจกมือแรก ✓');

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
        assert((await exitVisible(p1)) === 'ok' && (await exitVisible(host)) === 'ok', 'ปุ่มออกตอนจบโต๊ะ');
        await snap('50-finished');
        await p1.page.tap('#pdBackSelfBtn');
        await p1.page.waitForURL(/\/room\//, { timeout: 10000 });
        await delay(1500);
        assert(/\/game\//.test(host.page.url()), 'p1 กลับเอง หัวห้องยังอยู่หน้าสรุป (ไม่ลากทั้งวง)');
        console.log('6. จบโต๊ะ: หัวห้องพาทุกคน · คนอื่นกลับเฉพาะตัวเอง ✓');

        // ---------- 7. ห้องรอ: ตั้งกติกาห้อง แล้วเปิดโต๊ะใหม่ ----------
        await host.page.tap('#pdBackBtn');
        await host.page.waitForURL(/\/room\//, { timeout: 15000 });
        await waitFor(async () => has(host, '#pdLobbyMaxBet'), 10000, 'ตัวเลือกกติกาในห้องรอ');
        assert(await p1.page.$eval('#pdLobbyMaxBet', el => el.disabled).catch(() => false), 'คนอื่นแก้กติกาห้องไม่ได้');
        await host.page.selectOption('#pdLobbyMaxBet', '100');
        await waitFor(async () => (await host.page.$eval('#pdLobbyMaxBet', el => el.value).catch(() => '')) === '100', 5000, 'อั้น 100');
        const pressed = sel => host.page.$eval(sel, el => el.getAttribute('aria-pressed')).catch(() => '');
        async function setToggle(sel, want) {
            if ((await pressed(sel)) === want) return;
            await host.page.tap(sel);
            await waitFor(async () => (await pressed(sel)) === want, 5000, sel + ' = ' + want);
        }
        await setToggle('#pdLobbyMustDraw', 'true');
        await setToggle('#pdLobbyStraights', 'false');
        await setToggle('#pdLobbyRotate', 'false');
        await waitFor(async () => /ต่ำกว่า 4 ต้องจั่ว: ใช่/.test(await text(p1, '#pdLobbyMustDraw')), 5000, 'p1 เห็นกติกาใหม่');
        await snap('60-lobby-rules');
        await host.page.click('#btnStartGameLobby');
        for (const p of ps) await p.page.waitForURL(/\/game\//, { timeout: 20000 });
        console.log('7. ห้องรอ: อั้น 100 · ต่ำกว่า 4 ต้องจั่ว · ไม่นับเรียง · เจ้ามือคงที่ → เปิดโต๊ะใหม่ ✓');

        // ---------- 8. โต๊ะใหม่: พักโต๊ะ · ต่ำกว่า 4 ต้องจั่ว · เจ้ามือจับ ----------
        await waitFor(async () => (await phaseOf(p1)) === 'bet', 15000, 'โต๊ะใหม่ลงเดิมพัน');
        await p1.page.tap('#pdRankBtn');
        await p1.page.waitForSelector('.swal2-popup .pd-guide', { timeout: 5000 });
        assert(/ไม่นับไพ่เรียง/.test(await text(p1, '.swal2-popup .pd-guide')) && !/สเตรทฟลัช/.test(await text(p1, '.swal2-popup .pd-guide')), 'ปิดไพ่เรียง: อันดับไพ่บอกว่าโต๊ะนี้ไม่นับเรียง');
        await p1.page.click('.swal2-confirm');
        await delay(300);
        assert(/สูงสุด 100/.test(await text(p1, '[data-set="max"]')), 'อั้น 100: ปุ่มสูงสุด 100');
        let sawSitOut = false; let sawMustDraw = false; let sawCatch = false; let sawCaughtSeat = false;
        let lastHand = 0;
        const handNo = async p => Number(((await text(p, '#pdHandNo')).match(/\d+/) || [0])[0]);
        await waitFor(async () => {
            const ph = await phaseOf(p1);
            const hn = await handNo(p1);
            if (hn !== lastHand) lastHand = hn;
            if (await has(p1, '#pdSitInBtn')) {
                if (!sawSitOut) {
                    assert(/พักโต๊ะ/.test(await text(p1, '#pdNowCopy')), 'บอกว่าพักโต๊ะอยู่');
                    await snap('61-sitout', [p1]);
                }
                sawSitOut = true;
                await p1.page.tap('#pdSitInBtn');
                await waitFor(async () => !(await has(p1, '#pdSitInBtn')), 5000, 'กลับมาเล่นแล้ว');
            }
            // มือ 1–2 p1 ไม่แตะหน้าจอตอนลงเดิมพัน (หมดเวลา 2 ครั้ง) · มือถัดไปลงขั้นต่ำเอง
            if (ph === 'bet' && sawSitOut && await has(p1, '#pdBetBtn')) {
                await p1.page.tap('[data-set="min"]');
                await p1.page.tap('#pdBetBtn');
                await delay(300);
            }
            if (await has(p1, '#pdDrawBtn')) {
                const stayDisabled = await p1.page.$eval('#pdStayBtn', el => el.disabled).catch(() => false);
                if (stayDisabled && !sawMustDraw) {
                    assert(/ต้องจั่ว/.test(await text(p1, '#pdActions .pd-hint')), 'บอกว่าต่ำกว่า 4 ต้องจั่ว');
                    await snap('62-mustdraw', [p1]);
                    sawMustDraw = true;
                }
                await p1.page.tap('#pdDrawBtn');
                await delay(300);
            }
            if (await has(host, '#pdCatch3Btn')) {
                assert(/จับ 3 ใบ \(\d+ ขา\)/.test(await text(host, '#pdCatch3Btn')), 'ปุ่มจับบอกจำนวนขา');
                if (!sawCatch) await snap('63-catch', [host]);
                sawCatch = true;
                await host.page.tap('#pdCatch3Btn');
                await delay(900);
                if ((await phaseOf(p1)) === 'dealer') {
                    if (await has(p1, '.pd-seat .pd-outcome') || /เจ้ามือจับคุณแล้ว/.test(await text(p1, '#pdNowCopy'))) {
                        sawCaughtSeat = true;
                        await snap('64-caught', [p1]);
                    }
                }
            } else if (await has(host, '#pdDrawBtn')) {
                const hostStayOff = await host.page.$eval('#pdStayBtn', el => el.disabled).catch(() => false);
                await host.page.tap(hostStayOff ? '#pdDrawBtn' : '#pdStayBtn');
                await delay(300);
            }
            if (ph === 'result' && await has(host, '#pdNextBtn')) {
                if (sawCatch && sawSitOut) return true;
                if (hn >= 9) return true;
                await host.page.tap('#pdNextBtn');
                await delay(600);
            }
            return false;
        }, 420000, 'เล่นโต๊ะกติกาห้อง');
        assert(sawSitOut, 'หมดเวลา 2 มือติด → เห็นปุ่มกลับมาเล่น');
        assert(sawCatch, 'เจ้ามือเห็นปุ่มจับและกดได้');
        console.log(`8. พักโต๊ะ → กลับมาเล่น ✓ · เจ้ามือจับ ✓ (ผลขาที่โดนจับ ${sawCaughtSeat ? 'เห็น' : 'จบมือทันที'}) · ต่ำกว่า 4 ต้องจั่ว ${sawMustDraw ? '✓' : '(ไม่เจอมือต่ำกว่า 4)'} · ${lastHand} มือ`);

        // ---------- 9. ออกจากห้องกลางเกม: ยืนยัน → /rooms · ไม่โดนดึงกลับ · โต๊ะเล่นต่อ ----------
        await host.page.tap('#pdNextBtn').catch(() => {});
        await waitFor(async () => (await phaseOf(p1)) === 'bet' && await has(p1, '#pdBetBtn'), 30000, 'มือใหม่ให้ p1 ลง');
        await p1.page.tap('[data-set="min"]');
        await p1.page.tap('#pdBetBtn');
        await waitFor(async () => ['deal', 'draw', 'dealer'].includes(await phaseOf(p1)), 30000, 'แจกไพ่แล้ว (กลางมือ)');
        await p1.page.evaluate(() => window.scrollTo(0, 0));
        assert((await exitVisible(p1)) === 'ok', 'ปุ่มออกกลางมือ: ' + await exitVisible(p1));
        await p1.page.tap('#pdExitBtn');
        await p1.page.waitForSelector('.swal2-popup .pd-exit-list', { timeout: 5000 });
        const exitText = await text(p1, '.pd-exit-list');
        assert(/มือนี้คุณลง 10 แล้ว/.test(exitText) && /ยังวัดกับเจ้ามือ/.test(exitText) && /โต๊ะเล่นต่อโดยไม่มีคุณ/.test(exitText), 'บอกผลของการออกกลางมือ: ' + exitText);
        assert(/ออกจากห้อง/.test(await text(p1, '.swal2-confirm')) && /อยู่ต่อ/.test(await text(p1, '.swal2-cancel')), 'ปุ่ม ออกจากห้อง / อยู่ต่อ');
        await delay(500); // รอ popup เฟดเข้าเต็มก่อนถ่ายภาพ
        await p1.page.screenshot({ path: path.join(SHOT_DIR, '70-exit-confirm-p1.png') });
        const rosterCount = () => host.page.$$eval('#onlinePlayerList li', els => els.length).catch(() => -1);
        const before = await rosterCount();
        await p1.page.click('.swal2-confirm');
        await p1.page.waitForURL(/\/rooms/, { timeout: 8000 });
        await waitFor(async () => /ออกจากโต๊ะ/.test(await text(host, '#pdFeed')), 8000, 'บันทึกโต๊ะบอกว่า p1 ออก');
        await delay(15000);
        assert(/\/rooms/.test(p1.page.url()) && !/\/game\/|\/room\//.test(p1.page.url()), 'ออกแล้ว 15 วิ ยังอยู่หน้ารวมห้อง: ' + p1.page.url());
        await p1.page.screenshot({ path: path.join(SHOT_DIR, '71-after-exit-p1.png') });
        const after = await rosterCount();
        assert(before === 4 && after === 3, `รายชื่อผู้เล่นในห้องเหลือ 3 (หัวห้อง + บอท 2): ${before} → ${after}`);
        assert(/\/game\//.test(host.page.url()) && (await phaseOf(host)) !== 'finished', 'โต๊ะเล่นต่อ (หัวห้อง + บอท 2)');
        console.log('9. ปุ่ม 🚪 ออก เห็นทุกจังหวะ · ยืนยัน → /rooms · 15 วิ ไม่โดนดึงกลับ · โต๊ะเล่นต่อ ✓');

        ps.forEach(p => assert(p.errors.length === 0, `${p.tag}: ${p.errors.join(' | ')}`));
        assert(!/\[pokdeng\].*failed/.test(server.logs()), 'server log มี error ของป๊อกเด้ง');
        console.log(`\n✅ browser-pokdeng-mobile: ${checks} checks passed (ภาพ: ${SHOT_DIR})`);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
