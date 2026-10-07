/**
 * เล่นวาดแล้วทายในเบราว์เซอร์จริง: มือถือ 390×844 สามเครื่อง + เดสก์ท็อป 1280×900 หนึ่งเครื่อง
 * สร้างห้องผ่านฟอร์มจริง → ห้องรอ → เริ่มเกม → เลือกคำ/วาดด้วยเมาส์/พิมพ์ทาย ครบทุกตา → โพเดียม → เล่นอีกรอบ
 * คนวาดกด "✅ วาดเสร็จแล้ว" (แตะ 2 ครั้ง) → ทุกคนเห็นเวลาเหลือ ≤ 15 วิ · ตัวนับทายถูก · เฉลยบอกคนวาดต่อไป · สรุปรายคนตอนจบ
 * กติกา: หัวห้องใส่ 📝 คำของห้อง (ผสม = 1 ใน 3 ตัวเลือก) · การ์ดคำมีป้าย ง่าย/กลาง/ยาก · คนทายกด 🚩 เขียนตัวหนังสือ → นับ 1/2 → กดซ้ำยกเลิก
 * ทุกจังหวะเช็ก: ไม่มี JS/console error · ไม่เลื่อนแนวนอน · ข้อความไม่ล้น · ปุ่มแตะได้ ≥ 44px · ช่องทายอยู่ในจอ
 *
 * รัน: npm run smoke:drawguess:mobile   (ภาพ: DRAWGUESS_SHOT_DIR หรือโฟลเดอร์ชั่วคราว)
 */
const { setupDataDir, assertPortFree, bootServer, stopServer } = require('./drawguess-test-env');
setupDataDir('browser');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const PORT = Number(process.env.DRAWGUESS_MOBILE_PORT) || 8812;
const SHOT_DIR = process.env.DRAWGUESS_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'drawguess-shots-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|accounts\.google|cdn\.jsdelivr|cdnjs|ERR_INTERNET|ERR_NAME/i;
const NAMES = ['สมศักดิ์ศรีสวัสดิ์มห', 'น้องมะปรางหวานใจ', 'พี่บอล', 'ลุงเดสก์ท็อป'];

function launchOptions() {
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH };
    if (fs.existsSync(sys)) return { executablePath: sys };
    return {};
}
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await delay(80); }
    throw new Error('รอไม่ถึง: ' + label);
}

async function layoutProblems(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const problems = [];
        if (document.documentElement.scrollWidth > vw + 1) problems.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + vw);
        const root = document.getElementById('dgRoot');
        if (!root) return ['no #dgRoot'];
        root.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || el.closest('[hidden]')) return;
            if (el.closest('.dg-players')) {
                // แถบผู้เล่นเลื่อนแนวนอนได้ตั้งใจ — เช็กแค่ไม่ล้นข้อความ
            } else if (r.right > vw + 1 || r.left < -1) {
                problems.push('offscreen ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
            }
            const clipped = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflowX === 'auto';
            if (!clipped && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline' && el.tagName !== 'CANVAS') {
                problems.push('text overflow ' + el.tagName + '.' + el.className + ' "' + (el.textContent || '').slice(0, 20) + '"');
            }
            if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT') && r.height < 43.5) {
                problems.push('small target ' + el.tagName + '#' + el.id + '.' + el.className + ' h=' + Math.round(r.height));
            }
        });
        const form = document.getElementById('dgGuessForm');
        if (form && !form.hidden && form.offsetParent) {
            const fr = form.getBoundingClientRect();
            if (fr.bottom > vh + 1) problems.push('guess box below the fold ' + Math.round(fr.bottom) + '>' + vh);
        }
        const stage = document.getElementById('dgStage');
        if (stage && stage.offsetParent) {
            const sr = stage.getBoundingClientRect();
            if (Math.abs(sr.width / sr.height - 4 / 3) > 0.02) problems.push('canvas not 4:3 ' + Math.round(sr.width) + 'x' + Math.round(sr.height));
            const c = document.getElementById('dgCanvas');
            if (c.width < sr.width * Math.min(2, window.devicePixelRatio) - 2) problems.push('canvas not retina ' + c.width + ' for ' + Math.round(sr.width));
        }
        // ปุ่มแชท/footer ของเว็บต้องไม่บังช่องทาย
        const chatBtn = document.getElementById('toggleChat');
        if (chatBtn && chatBtn.offsetParent && form && form.offsetParent) {
            const a = chatBtn.getBoundingClientRect();
            const b = form.getBoundingClientRect();
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) problems.push('chat button covers guess box');
        }
        return problems.slice(0, 8);
    });
}

(async () => {
    await assertPortFree(PORT);
    const server = await bootServer(PORT, {
        DRAWGUESS_CHOOSE_MS: '60000',
        DRAWGUESS_DRAW_MS: '26000',
        DRAWGUESS_REVEAL_MS: '2600',
        DRAWGUESS_GRACE_MS: '15000'
    });
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch(launchOptions());
    const players = [];
    const shots = [];
    try {
        for (let i = 0; i < 4; i++) {
            const desktop = i === 3;
            const ctx = await browser.newContext(desktop
                ? { viewport: { width: 1280, height: 900 } }
                : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
            await ctx.addInitScript(() => {
                try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-drawguess', '1'); } catch (e) { /* */ }
            });
            const page = await ctx.newPage();
            const p = { id: randomUUID(), name: NAMES[i], page, ctx, desktop, errors: [], tag: desktop ? 'desktop' : `m${i + 1}` };
            page.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) p.errors.push('console: ' + m.text().slice(0, 200)); });
            await page.goto(`${base}/?playerId=${p.id}`, { waitUntil: 'domcontentloaded' });
            const renamed = await page.evaluate(async name => {
                const res = await fetch('/profile/updateName', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
                return res.json();
            }, p.name);
            assert(renamed && renamed.success !== false, 'ตั้งชื่อไม่ได้: ' + JSON.stringify(renamed));
            players.push(p);
        }
        const [host, b, c, desk] = players;

        // ---------- สร้างห้องผ่านฟอร์มจริง
        await host.page.goto(`${base}/rooms?playerId=${host.id}`, { waitUntil: 'domcontentloaded' });
        await host.page.click('#createRoomBtn');
        await host.page.waitForSelector('#modeQuickPickGrid');
        const details = await host.page.$('.mode-all-details');
        if (details) await host.page.evaluate(() => { const d = document.querySelector('.mode-all-details'); if (d) d.open = true; });
        await host.page.click('.mode-quick-card[data-mode-id="drawguess"]');
        await host.page.waitForSelector('#drawguessSettingsGroup', { state: 'visible' });
        await host.page.check('input[name="drawguessRounds"][value="2"]');
        await host.page.check('input[name="drawguessSeconds"][value="60"]');
        await host.page.selectOption('#drawguessCategory', 'animals');
        await delay(300);
        const pickerShot = path.join(SHOT_DIR, '00-create-room-390.png');
        await host.page.screenshot({ path: pickerShot, fullPage: false });
        shots.push(pickerShot);
        await host.page.evaluate(() => { const g = document.getElementById('drawguessSettingsGroup'); if (g) g.scrollIntoView({ block: 'center' }); });
        await delay(200);
        const settingsShot = path.join(SHOT_DIR, '00b-create-settings-390.png');
        await host.page.screenshot({ path: settingsShot, fullPage: false });
        shots.push(settingsShot);
        await Promise.all([
            host.page.waitForURL(/\/room\//, { timeout: 15000 }),
            host.page.click('.room-btn-confirm')
        ]);
        const roomId = host.page.url().match(/\/room\/([^/?#]+)/)[1];
        assert(roomId, 'ได้ห้อง');

        for (const p of [b, c, desk]) {
            await p.page.goto(`${base}/rooms?playerId=${p.id}`, { waitUntil: 'domcontentloaded' });
            const joined = await p.page.evaluate(rid => new Promise(res => {
                const s = window.appSocket;
                const go = () => s.emit('joinRoom', { roomId: rid }, r => res(r));
                if (s.connected) go(); else s.once('connect', go);
            }), roomId);
            assert(joined && joined.success, 'join ไม่ได้: ' + JSON.stringify(joined));
            await p.page.goto(`${base}/room/${roomId}?playerId=${p.id}`, { waitUntil: 'domcontentloaded' });
        }
        await delay(1500);
        const lobbyText = await host.page.textContent('body');
        assert(/วาดแล้วทาย/.test(lobbyText) && /2 รอบ/.test(lobbyText), 'ห้องรอแสดงโหมดและค่าที่ตั้ง');
        const pressed = await host.page.$$eval('.dg-lobby-opt[aria-pressed="true"]', els => els.map(e => e.textContent.trim()));
        assert(pressed.includes('2 รอบ') && pressed.includes('60 วิ'), 'ค่าที่เลือกตอนสร้างห้องถูกบันทึก: ' + pressed.join(','));
        assert(await host.page.$eval('#dgLobbyCategory', el => el.value) === 'animals', 'หมวดที่เลือกถูกบันทึก');
        const lobbyShot = path.join(SHOT_DIR, '01-room-lobby-390.png');
        await host.page.evaluate(() => { const el = document.querySelector('.dg-lobby-set'); if (el) el.scrollIntoView({ block: 'center' }); });
        await host.page.screenshot({ path: lobbyShot, fullPage: false });
        shots.push(lobbyShot);
        // 📝 คำของห้อง: หัวห้องพิมพ์ในกล่อง → ปุ่มบอกจำนวน · คนอื่นเห็นแค่จำนวน กดไม่ได้
        await host.page.click('#dgLobbyCustom');
        await host.page.waitForSelector('.swal2-textarea', { state: 'visible' });
        await host.page.fill('.swal2-textarea', 'ครูสมศรี, ร้านป้าแดง\nหมาบ้านเรา, ครูสมศรี');
        await delay(200);
        const customShot = path.join(SHOT_DIR, '01b-custom-words-390.png');
        await host.page.screenshot({ path: customShot, fullPage: false });
        shots.push(customShot);
        await host.page.click('.swal2-confirm');
        await waitFor(async () => /3 คำ/.test(await host.page.$eval('#dgLobbyCustom', el => el.textContent).catch(() => '')), 5000, 'ปุ่มคำของห้องบอก 3 คำ');
        await waitFor(async () => /3 คำ/.test(await b.page.$eval('#dgLobbyCustom', el => el.textContent).catch(() => '')), 5000, 'คนอื่นเห็นจำนวนคำของห้อง');
        assert(!/ร้านป้าแดง/.test(await b.page.textContent('.dg-lobby-set')), 'คนอื่นไม่เห็นรายการคำของห้องบนจอ');
        const hintPressed = await host.page.$$eval('.dg-lobby-opt[data-dg-key="drawguessHints"][aria-pressed="true"]', els => els.map(e => e.textContent.trim()));
        assert(hintPressed.join() === '💡 เปิด', 'คำใบ้ค่าเริ่ม = เปิด');
        await host.page.evaluate(() => { const el = document.querySelector('.dg-lobby-set'); if (el) el.scrollIntoView({ block: 'center' }); });
        const lobbyShot2 = path.join(SHOT_DIR, '01c-room-lobby-custom-390.png');
        await host.page.screenshot({ path: lobbyShot2, fullPage: false });
        shots.push(lobbyShot2);
        const lobbyProblems = await host.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 ? ['horizontal scroll'] : []);
        assert(lobbyProblems.length === 0, 'ห้องรอ: ' + lobbyProblems.join());
        const notAdminDisabled = await b.page.$$eval('.dg-lobby-opt', els => els.every(e => e.disabled));
        assert(notAdminDisabled, 'คนที่ไม่ใช่หัวห้องแก้ค่าไม่ได้');

        // ---------- เริ่มเกม
        await waitFor(async () => host.page.$eval('#btnStartGameLobby', el => !el.disabled).catch(() => false), 10000, 'ปุ่มเริ่มเกมพร้อม');
        await host.page.click('#btnStartGameLobby');
        for (const p of players) await p.page.waitForURL(/\/game\//, { timeout: 20000 });
        for (const p of players) await p.page.waitForSelector('#dgRoot[data-phase="choose"]', { timeout: 15000 });

        async function snap(label, who = players, opts = {}) {
            await delay(opts.wait ?? 450);
            for (const p of who) {
                const problems = await layoutProblems(p.page);
                assert(problems.length === 0, `${label}/${p.tag}: layout ${problems.join(' | ')}`);
                assert(p.errors.length === 0, `${label}/${p.tag}: ${p.errors.join(' | ')}`);
                const file = path.join(SHOT_DIR, `${label}-${p.tag}.png`);
                await p.page.screenshot({ path: file, fullPage: false });
                shots.push(file);
            }
        }
        const phaseOf = p => p.page.$eval('#dgRoot', el => el.dataset.phase);
        const roleOf = p => p.page.$eval('#dgRoot', el => el.dataset.role);
        const turnOf = p => p.page.$eval('#dgRoot', el => Number(el.dataset.turn));
        async function findDrawer() {
            return waitFor(async () => {
                for (const p of players) {
                    if (await phaseOf(p) === 'choose' && await p.page.$('.dg-choice')) return p;
                }
                return null;
            }, 15000, 'หาคนวาด');
        }

        async function drawPicture(p, variant) {
            const box = await p.page.$eval('#dgCanvas', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
            const at = (fx, fy) => [box.x + box.w * fx, box.y + box.h * fy];
            async function stroke(points) {
                const [x0, y0] = at(points[0][0], points[0][1]);
                await p.page.mouse.move(x0, y0);
                await p.page.mouse.down();
                for (const [fx, fy] of points.slice(1)) {
                    const [x, y] = at(fx, fy);
                    await p.page.mouse.move(x, y, { steps: 4 });
                }
                await p.page.mouse.up();
            }
            const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(i / n * Math.PI * 2), cy + r * 1.33 * Math.sin(i / n * Math.PI * 2)]);
            await p.page.click('.dg-swatch[data-color="5"]');
            await p.page.click('.dg-size[data-size="2"]');
            await stroke(circle(0.2, 0.25, 0.08));
            await p.page.click('.dg-swatch[data-color="8"]');
            await stroke(circle(0.55, 0.55, 0.22, 32));
            await p.page.click('.dg-size[data-size="1"]');
            await p.page.click('.dg-swatch[data-color="0"]');
            await stroke([[0.48, 0.48], [0.5, 0.5]]);
            await stroke([[0.62, 0.48], [0.64, 0.5]]);
            await stroke([[0.46, 0.64], [0.55, 0.7], [0.64, 0.64]]);
            await p.page.click('.dg-swatch[data-color="6"]');
            await p.page.click('.dg-size[data-size="3"]');
            await stroke([[0.05, 0.92], [0.35, 0.88], [0.7, 0.93], [0.95, 0.9]]);
            if (variant === 'undo') {
                await p.page.click('.dg-swatch[data-color="3"]');
                await stroke([[0.1, 0.1], [0.9, 0.9]]);
                await p.page.click('#dgUndo');
            }
            await delay(300);
        }
        async function readWord(p) {
            return p.page.$eval('#dgWord .dg-word-main', el => el.childNodes[0].textContent.trim());
        }
        async function guess(p, text) {
            await p.page.fill('#dgGuessInput', text);
            await p.page.press('#dgGuessInput', 'Enter');
            await delay(450);
        }
        async function canvasInk(p) {
            return p.page.evaluate(() => {
                const cv = document.getElementById('dgCanvas');
                const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
                let ink = 0;
                for (let i = 0; i < data.length; i += 4 * 97) if (data[i] < 200 || data[i + 2] < 200) ink += 1;
                return ink;
            });
        }

        // ---------- ตาแรก: ภาพทุกจังหวะ
        const d1 = await findDrawer();
        const guessers1 = players.filter(p => p !== d1);
        await snap('10-choose', [d1, guessers1[0], desk === d1 ? guessers1[1] : desk]);
        const cards = await d1.page.$$eval('.dg-choice', els => els.map(e => e.textContent));
        assert(cards.length === 3 && /ง่าย/.test(cards[0]) && cards.some(t => /คำของห้อง/.test(t)), 'การ์ดคำ: ป้ายระดับ + 1 ใบเป็นคำของห้อง ' + cards.join(' | '));
        await d1.page.click('.dg-choice[data-index="0"]');
        await waitFor(async () => (await phaseOf(d1)) === 'draw', 5000, 'เข้าช่วงวาด');
        const word1 = await readWord(d1);
        assert(word1 && word1.length > 0, 'คนวาดเห็นคำ');
        for (const g of guessers1) {
            await waitFor(async () => (await phaseOf(g)) === 'draw', 5000, 'คนทายเข้าช่วงวาด');
            const html = await g.page.content();
            assert(!html.includes(word1) || (await readWord(g).catch(() => '')) !== word1, 'คนทายไม่เห็นคำ');
            assert(await g.page.$$eval('.dg-mask .slot', els => els.length) > 0, 'คนทายเห็นช่องคำใบ้');
        }
        assert(await d1.page.$eval('#dgDoneBar', el => !el.hidden && el.offsetParent !== null), 'คนวาดเห็นแถบวาดเสร็จแล้ว');
        for (const g of guessers1) assert(await g.page.$eval('#dgDoneBar', el => el.hidden), 'คนทายไม่เห็นแถบวาดเสร็จแล้ว');
        await d1.page.click('#dgDoneBtn');
        await waitFor(async () => d1.page.$eval('#dgToast', el => el.classList.contains('is-on') && /วาด/.test(el.textContent)), 3000, 'ยังไม่วาด กดเสร็จ = เตือน');
        assert(await d1.page.$eval('#dgDoneBtn', el => !el.classList.contains('is-armed')), 'ยังไม่วาด ไม่ถามยืนยัน');
        await drawPicture(d1, 'undo');
        await waitFor(async () => (await canvasInk(guessers1[0])) > 30, 5000, 'ภาพไปถึงคนทาย');
        assert(Math.abs((await canvasInk(guessers1[0])) - (await canvasInk(d1))) < (await canvasInk(d1)) * 0.25 + 30, 'ภาพของคนทายตรงกับคนวาด (undo ส่งถึงด้วย)');
        await guess(guessers1[0], 'บ้านริมทะเล');
        await guess(guessers1[1], word1 + 'จ๋า');
        await waitFor(async () => guessers1[1].page.$eval('#dgToast', el => el.classList.contains('is-on') && /เกือบ/.test(el.textContent)), 3000, 'ขึ้นเกือบแล้ว');
        await snap('11-draw', [d1, guessers1[1]], { wait: 150 });
        // 🚩 เขียนตัวหนังสือ: คนทายเห็นปุ่มบนภาพ · คนวาดไม่เห็นจนมีคนแจ้ง · แจ้ง → 1/2 · กดซ้ำยกเลิก
        const reporter = guessers1.find(p => !p.desktop) || guessers1[1];
        assert(await reporter.page.$eval('#dgReportBtn', el => !el.hidden && el.getBoundingClientRect().height >= 44), 'คนทายเห็นปุ่ม 🚩');
        assert(await d1.page.$eval('#dgReportBtn', el => el.hidden), 'คนวาดไม่เห็น 🚩 ตอนยังไม่มีคนแจ้ง');
        await reporter.page.click('#dgReportBtn');
        await reporter.page.waitForSelector('.swal2-confirm', { state: 'visible' });
        assert(/เขียนตัวหนังสือ/.test(await reporter.page.textContent('.swal2-popup')), 'ถามยืนยันก่อนแจ้ง');
        await reporter.page.click('.swal2-confirm');
        await waitFor(async () => /1\/2/.test(await d1.page.$eval('#dgReportBtn', el => el.hidden ? '' : el.textContent)), 4000, 'คนวาดเห็น 🚩 1/2');
        await waitFor(async () => reporter.page.$eval('#dgReportBtn', el => el.classList.contains('is-on')), 3000, 'ปุ่มคนแจ้งเป็นสีแดง');
        assert(/แจ้งว่าเขียนตัวหนังสือ/.test(await d1.page.textContent('#dgFeed')), 'แชทบอกว่ามีคนแจ้ง');
        await snap('11b-report', [d1, reporter], { wait: 300 });
        await reporter.page.click('#dgReportBtn');
        await waitFor(async () => d1.page.$eval('#dgReportBtn', el => el.hidden), 4000, 'ยกเลิกแจ้ง → คนวาดไม่เห็น 🚩');
        assert(await phaseOf(d1) === 'draw', 'ยังวาดต่อ (ไม่ครบเสียง)');
        // รอคำใบ้เปิดอย่างน้อย 1 ตัว (คำ 1 ตัวอักษรไม่มีคำใบ้)
        const letters = await guessers1[0].page.$$eval('.dg-mask .slot', els => els.length);
        if (letters >= 3) {
            await waitFor(async () => (await guessers1[0].page.$$('.dg-mask .slot.is-open')).length > 0, 24000, 'คำใบ้เปิด');
        }
        await guess(guessers1[0], word1);
        await waitFor(async () => (await roleOf(guessers1[0])) === 'solved', 3000, 'ทายถูก');
        await waitFor(async () => /1\/3/.test(await guessers1[1].page.$eval('.dg-count', el => el.textContent).catch(() => '')), 3000, 'ตัวนับทายถูก 1/3');
        await guess(guessers1[0], 'ง่ายมากเลย');
        await snap('12-solved', [guessers1[0], desk === d1 ? guessers1[2] : desk], { wait: 300 });
        const unsolvedFeed = await guessers1[1].page.textContent('#dgFeed');
        assert(/ทายถูก/.test(unsolvedFeed) && !/ง่ายมากเลย/.test(unsolvedFeed), 'คนยังไม่ถูกเห็น ✅ แต่ไม่เห็นแชทคนที่ถูก');
        // คีย์บอร์ดเปิด (จอเตี้ย) — ภาพกับช่องทายต้องยังอยู่ครบ
        const kb = guessers1.find(p => !p.desktop && p !== guessers1[0]) || guessers1[1];
        await kb.page.setViewportSize({ width: 390, height: 480 });
        await kb.page.focus('#dgGuessInput');
        await snap('13-keyboard', [kb]);
        await kb.page.setViewportSize({ width: 390, height: 844 });
        for (const g of guessers1.slice(1)) await guess(g, word1);
        await waitFor(async () => (await phaseOf(guessers1[0])) === 'reveal', 5000, 'เฉลย');
        await snap('14-reveal', [d1, guessers1[0]], { wait: 700 });
        const revealText = await guessers1[0].page.textContent('#dgOverlay');
        assert(revealText.includes(word1) && /\+\d+/.test(revealText), 'เฉลยคำ + แต้มตานี้');
        assert(/ต่อไป/.test(revealText), 'เฉลยบอกคนวาดตาถัดไป');

        // ---------- ตาที่เหลือ
        let guard = 0;
        let deskDrawShot = false;
        let doneTested = false;
        while (guard++ < 12) {
            await waitFor(async () => ['choose', 'finished'].includes(await phaseOf(host)), 12000, 'ตาถัดไป');
            if (await phaseOf(host) === 'finished') break;
            const d = await findDrawer();
            const turn = await turnOf(d);
            await d.page.click('.dg-choice[data-index="1"]');
            await waitFor(async () => (await phaseOf(d)) === 'draw', 5000, 'วาด');
            const word = await readWord(d);
            await drawPicture(d);
            if (d.desktop && !deskDrawShot) { deskDrawShot = true; await snap('20-desktop-drawing', [d]); }
            if (!doneTested && !d.desktop) {
                // ✅ วาดเสร็จแล้ว: แตะแรกถามยืนยัน · แตะสองส่ง → ทุกคนเหลือ ≤ 15 วิ
                doneTested = true;
                const watcher = players.find(p => p !== d && !p.desktop);
                const before = await watcher.page.$eval('#dgTimerNum', el => Number(el.textContent));
                // มือถือแนวนอน: เครื่องมือวาด + ปุ่มวาดเสร็จต้องอยู่ในจอครบ (เดิมหลุดล่างจอ)
                await d.page.setViewportSize({ width: 844, height: 390 });
                await delay(400);
                const fits = await d.page.evaluate(() => ['dgDoneBar', 'dgToolbar', 'dgStage'].map(id => {
                    const r = document.getElementById(id).getBoundingClientRect();
                    return r.height > 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1;
                }));
                assert(fits.every(Boolean), 'แนวนอน: เครื่องมือ/ปุ่มวาดเสร็จ/ภาพอยู่ในจอ ' + JSON.stringify(fits));
                await d.page.click('#dgDoneBtn');
                assert(await d.page.$eval('#dgDoneBtn', el => el.classList.contains('is-armed') && /ยืนยัน/.test(el.textContent)), 'แตะแรกถามยืนยัน');
                await snap('15-done-armed-landscape', [d], { wait: 150 });
                await d.page.click('#dgDoneBtn');
                await d.page.setViewportSize({ width: 390, height: 844 });
                await waitFor(async () => /วาดเสร็จแล้ว/.test(await watcher.page.textContent('#dgWord')), 3000, 'คนทายเห็นว่าวาดเสร็จ');
                const after = await watcher.page.$eval('#dgTimerNum', el => Number(el.textContent));
                assert(after <= 15 && after < before, `เวลาเหลือถูกตัด (${before} → ${after})`);
                assert(/วาดเสร็จแล้ว! เหลือ \d+ วินาที/.test(await watcher.page.textContent('#dgFeed')), 'ประกาศในแถบข้อความ');
                assert(await d.page.$eval('#dgDoneBtn', el => el.disabled), 'กดแล้วปุ่มล็อก (ครั้งเดียว)');
                await snap('16-done', [d, watcher], { wait: 300 });
            }
            if (!d.desktop && guard <= 2) {
                const guesserDesk = players.find(p => p.desktop && p !== d);
                if (guesserDesk) await snap('21-desktop-guessing', [guesserDesk]);
            }
            const gs = players.filter(p => p !== d);
            for (const g of gs) await guess(g, word);
            await waitFor(async () => (await phaseOf(host)) !== 'draw' || (await turnOf(host)) !== turn, 6000, 'ตาจบ');
        }
        for (const p of players) await waitFor(async () => (await phaseOf(p)) === 'finished', 12000, 'จบเกม');
        await snap('30-finished', players, { wait: 1300 });
        const finalText = await host.page.textContent('#dgResults');
        assert(/ชนะ/.test(finalText), 'สรุปผลมีผู้ชนะ');
        assert(doneTested, 'ได้ทดสอบปุ่มวาดเสร็จแล้ว');
        assert((await host.page.$$('.dg-final .tl')).length === players.length && /ทายถูก \d+\/\d+ ตา/.test(finalText), 'สรุปรายคน: ทายถูกกี่ตา · วาดแล้วมีคนถูกกี่ครั้ง');
        assert(await host.page.$('#dgAgainBtn') && !(await b.page.$('#dgAgainBtn')), 'ปุ่มเล่นอีกรอบเฉพาะหัวห้อง');

        // ---------- เล่นอีกรอบ
        await host.page.click('#dgAgainBtn');
        for (const p of players) await p.page.waitForSelector('#dgRoot[data-phase="choose"]', { timeout: 20000 });
        await snap('40-again', [host], { wait: 600 });
        for (const p of players) assert(p.errors.length === 0, `${p.tag}: ${p.errors.join(' | ')}`);
        console.log(`✅ วาดแล้วทายในเบราว์เซอร์ (3 มือถือ + เดสก์ท็อป): ${checks} checks · ${shots.length} ภาพ → ${SHOT_DIR}`);
    } finally {
        await browser.close().catch(() => {});
        await stopServer(server);
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
