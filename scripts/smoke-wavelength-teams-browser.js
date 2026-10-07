/**
 * คลื่นความคิด — แข่งทีมในเบราว์เซอร์ 3 จอ (390×844) + บอท socket 1 ตัว
 * ห้องรอเลือกโหมด · เข็มร่วมขยับตามกันสด · ✅ ตกลง · ⬅️/➡️ · ผลรอบ · จบเกมแบบทีม
 * เช็ก: ไม่มี page/console error · ไม่เลื่อนแนวนอน · ข้อความไม่ล้น · ปุ่ม ≥ 44px · เป้าไม่อยู่ใน DOM ของคนทาย
 * รัน: npm run smoke:wavelength:teams:browser   (ภาพไปที่ WAVELENGTH_SHOT_DIR)
 */
const path = require('path');
const fs = require('fs');

const TMP_ROOT = path.join(__dirname, '..', '..', '..', 'tmpdata-wavelength');
const TMP = path.join(TMP_ROOT, `tbrowser-${process.pid}-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
process.env.GAME_DATA_DIR = TMP;
process.env.WALLETS_FILE = path.join(TMP, 'wallets.json');
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
require('./isolateTestData');

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const SHOT_DIR = process.env.WAVELENGTH_SHOT_DIR || path.join(TMP_ROOT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

function bootServer(port) {
    const long = '600000';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), MONGO_URL: '', WAVELENGTH_CLUE_MS: long, WAVELENGTH_GUESS_MS: long, WAVELENGTH_REVEAL_MS: long, WAVELENGTH_TEAM_GUESS_MS: long, WAVELENGTH_LR_MS: long },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.once('connect', () => r(s)); }); }
function launchOptions() {
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH };
    if (fs.existsSync(sys)) return { executablePath: sys };
    return {};
}
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        // หน้ากำลังรีโหลด (เทสรีเฟรชกลางรอบ) = context หาย ชั่วคราว — ลองใหม่
        const v = await Promise.resolve().then(fn).catch(e => { if (/context was destroyed|navigat/i.test(e.message)) return null; throw e; });
        if (v) return v;
        await delay(80);
    }
    throw new Error('รอไม่ถึง: ' + label);
}
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|ERR_QUIC_PROTOCOL_ERROR/i; // QUIC = ฟอนต์ Google ผ่าน HTTP/3 เน็ตสะดุด ไม่ใช่บั๊กของเรา

async function layoutProblems(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const problems = [];
        if (document.documentElement.scrollWidth > vw + 1) problems.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + vw);
        const root = document.getElementById('wlRoot');
        root.querySelectorAll('*').forEach(el => {
            if (!(el instanceof HTMLElement)) return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden') return;
            if (r.right > vw + 1 || r.left < -1) problems.push('offscreen ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
            const clipped = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis';
            if (!clipped && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline') {
                problems.push('text overflow ' + el.tagName + '.' + el.className + ' "' + (el.textContent || '').slice(0, 20) + '"');
            }
            if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && cs.display !== 'none' && r.height < 43.5) {
                problems.push('small target ' + el.tagName + '#' + el.id + '.' + el.className + ' h=' + Math.round(r.height));
            }
        });
        // แชท/ปุ่มลอยต้องไม่ทับปุ่มหลักใน dock
        const dock = document.getElementById('wlDock');
        const chat = document.getElementById('toggleChat');
        if (dock && chat && dock.innerHTML) {
            const a = chat.getBoundingClientRect();
            dock.querySelectorAll('button, input').forEach(b => {
                const q = b.getBoundingClientRect();
                if (q.width && a.width && !(a.right < q.left || a.left > q.right || a.bottom < q.top || a.top > q.bottom)) problems.push('chat covers ' + b.id);
            });
        }
        return problems.slice(0, 8);
    });
}

(async () => {
    const port = Number(process.env.SMOKE_PORT) || 8854;
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(launchOptions());
    const shots = [];
    const sockets = [];
    try {
        const names = ['แพรวพราวเจริญสุขศรี', 'ต้น', 'มายด์', 'บอทโต้ง'];
        const ps = [];
        for (let i = 0; i < 4; i += 1) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('wavelengthState', s => states.push(s));
            ps.push({ socket, id, states, name: names[i] });
            sockets.push(socket);
        }
        await delay(400);
        for (const p of ps) {
            const res = await fetch(`${base}/profile/updateName?playerId=${p.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: p.name }) });
            assert((await res.json().catch(() => ({}))).success, 'ตั้งชื่อไม่ได้');
        }
        const created = await ack(ps[0].socket, 'createRoom', { playerId: ps[0].id, name: 'คลื่นทีม', gameMode: 'wavelength', maxPlayers: 8 });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        ps[0].socket.emit('setRoom', { roomId, playerId: ps[0].id });
        for (const p of ps.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join failed');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(400);

        async function newPage(id, viewport, label) {
            const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
            await ctx.addInitScript(() => {
                try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-wavelength', '1'); } catch (e) { /* ignore */ }
            });
            const page = await ctx.newPage();
            const v = { page, ctx, id, label, errors: [] };
            page.on('pageerror', e => v.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) v.errors.push('console: ' + m.text().slice(0, 200)); });
            await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
            v.goto = async url => {
                if (new URL(page.url()).pathname === new URL(url).pathname) return;
                await page.goto(url, { waitUntil: 'domcontentloaded' });
            };
            return v;
        }
        const bot = ps[3];
        const view = p => p.states[p.states.length - 1];
        const viewers = [];
        // ---------- ห้องรอ: ปุ่มโหมด ----------
        {
            ps[0].socket.close();
            const v = await newPage(ps[0].id, { width: 390, height: 844 }, 'host');
            await v.goto(`${base}/room/${roomId}?playerId=${ps[0].id}`);
            await waitFor(() => v.page.$('.wl-mode-btn[data-wl-mode="teams"][aria-pressed="true"]'), 6000, 'teams default in lobby');
            assert(!(await v.page.$('.wl-laps-btn')), 'แข่งทีม: ไม่มีปุ่มรอบโต๊ะ');
            await v.page.click('.wl-mode-btn[data-wl-mode="solo"]');
            await waitFor(() => v.page.$('.wl-laps-btn'), 4000, 'solo shows laps');
            await v.page.click('.wl-mode-btn[data-wl-mode="teams"]');
            await waitFor(() => v.page.$('.wl-mode-btn[data-wl-mode="teams"][aria-pressed="true"]'), 4000, 'back to teams');
            await delay(8200);
            const sw = await v.page.evaluate(() => document.documentElement.scrollWidth);
            assert(sw <= 391, 'ห้องรอไม่เลื่อนแนวนอน ' + sw);
            const btnH = await v.page.$$eval('.wl-mode-btn', bs => bs.map(b => b.getBoundingClientRect().height));
            assert(btnH.every(h => h >= 43.5), 'ปุ่มโหมด ≥ 44px ' + btnH);
            const file = path.join(SHOT_DIR, 't00-lobby-390.png');
            await v.page.locator('#lobbySpotlight').screenshot({ path: file }).catch(() => v.page.screenshot({ path: file }));
            shots.push(file);
            assert(v.errors.length === 0, 'lobby errors: ' + v.errors.join(' | '));
            await waitFor(async () => !(await v.page.$eval('#btnStartGameLobby', b => b.disabled)), 5000, 'start enabled');
            await v.page.click('#btnStartGameLobby');
            const confirmBtn = await v.page.waitForSelector('.swal2-confirm', { timeout: 1500 }).catch(() => null);
            if (confirmBtn) await confirmBtn.click().catch(() => {});
            await v.page.waitForURL(/\/game\//, { timeout: 10000 });
            v.errors = v.errors.filter(e => !/beforeunload/.test(e));
            viewers.push(v);
        }
        await waitFor(() => view(bot) && view(bot).phase === 'clue', 8000, 'clue');
        for (let i = 1; i < 3; i += 1) {
            ps[i].socket.close();
            const v = await newPage(ps[i].id, { width: 390, height: 844 }, ['host', 'p1', 'p2'][i]);
            await v.goto(`${base}/game/${roomId}?playerId=${ps[i].id}`);
            viewers.push(v);
        }
        await delay(2000);
        const pageOf = id => viewers.find(v => v.id === id) || null;

        async function snap(label, list = viewers) {
            await delay(350);
            for (const v of list) {
                const problems = await layoutProblems(v.page);
                assert(problems.length === 0, `${label}/${v.label}: layout ${problems.join(' | ')}`);
                assert(v.errors.length === 0, `${label}/${v.label}: ${v.errors.join(' | ')}`);
                const file = path.join(SHOT_DIR, `${label}-${v.label}-390.png`);
                await v.page.screenshot({ path: file });
                shots.push(file);
            }
        }
        async function dialPoint(page, value) {
            const box = await page.locator('#wlDial').boundingBox();
            const a = (180 - value * 1.8) * Math.PI / 180;
            return { x: box.x + (200 + 150 * Math.cos(a)) / 400 * box.width, y: box.y + (200 - 150 * Math.sin(a)) / 214 * box.height };
        }
        async function drag(page, from, to) {
            const a = await dialPoint(page, from);
            const b = await dialPoint(page, to);
            await page.mouse.move(a.x, a.y);
            await page.mouse.down();
            for (let i = 1; i <= 12; i += 1) await page.mouse.move(a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12);
            await page.mouse.up();
        }
        const bandsVisible = page => page.evaluate(() => document.getElementById('wlBands').style.display !== 'none');
        const knob = async page => Number(await page.getAttribute('#wlKnobHit', 'aria-valuenow'));

        // ---------- ใบ้ ----------
        let s = view(bot);
        assert(s.variant === 'teams', 'เกมแข่งทีม');
        const teamOf = id => s.players.find(p => p.playerId === id).team;
        const giverId = s.giverId;
        const active = s.activeTeam;
        await waitFor(async () => /ทีม/.test(await viewers[0].page.textContent('#wlTeams')), 4000, 'team strip');
        for (const v of viewers) {
            const strip = await v.page.textContent('#wlTeams');
            assert(/ทีมฟ้า/.test(strip) && /ทีมส้ม/.test(strip) && /10/.test(strip), 'แถบทีม + เป้า 10');
        }
        await delay(8200);
        await snap('t01-clue');
        const gp = pageOf(giverId);
        if (gp) {
            await gp.page.click('.wl-option[data-index="0"]');
            await waitFor(() => gp.page.$('.wl-option.is-picked'), 3000, 'picked');
            await gp.page.fill('#wlClueInput', 'ตลาดน้ำตอนเช้า');
            await gp.page.click('#wlClueBtn');
        } else {
            await ack(bot.socket, 'wavelength_pickCard', { index: 0, round: s.round, phase: 'clue' });
            await waitFor(() => view(bot).card, 3000, 'bot card');
            assert((await ack(bot.socket, 'wavelength_clue', { text: 'ตลาดน้ำตอนเช้า', round: s.round, phase: 'clue' })).success, 'bot clue');
        }
        await waitFor(() => view(bot).phase === 'guess', 5000, 'guess');
        s = view(bot);
        const guesserId = s.players.find(p => p.isGuesser).playerId;
        const opponents = s.opponentIds;
        for (const v of viewers) {
            if (v.id === giverId) continue;
            assert(!(await bandsVisible(v.page)), `${v.label}: ไม่เห็นเป้าตอนทาย`);
        }
        // ---------- หมุนเข็มร่วม ----------
        const gv = pageOf(guesserId);
        const watchers = viewers.filter(v => v.id !== guesserId);
        if (gv) {
            await waitFor(() => gv.page.$('#wlLockBtn'), 5000, 'agree button');
            assert(/ตกลง/.test(await gv.page.textContent('#wlLockBtn')), 'ปุ่ม ✅ ตกลง');
            await drag(gv.page, 50, 24);
            await delay(800);
            const v0 = await knob(gv.page);
            assert(Math.abs(v0 - 24) <= 3, 'เข็มตามที่ลาก ' + v0);
            await waitFor(async () => { for (const w of watchers) { if (Math.abs((await knob(w.page)) - v0) > 1.5) return false; } return true; }, 4000, 'needle synced on other screens');
            await snap('t02-guess');
            await gv.page.click('#wlLockBtn');
        } else {
            await ack(bot.socket, 'wavelength_pin', { value: 24, round: s.round, phase: 'guess' });
            await waitFor(async () => { for (const w of watchers) { if (Math.abs((await knob(w.page)) - 24) > 1.5) return false; } return true; }, 4000, 'needle synced from bot');
            await snap('t02-guess');
            assert((await ack(bot.socket, 'wavelength_lock', { value: 24, round: s.round, phase: 'guess' })).success, 'bot agree');
        }
        for (const v of watchers) assert(!(await v.page.$('#wlLockBtn')) || v.id === guesserId, `${v.label}: ทีมโน้นไม่มีปุ่มตกลง`);
        // ---------- ซ้าย/ขวา ----------
        await waitFor(() => view(bot).phase === 'leftright', 5000, 'leftright');
        const voters = viewers.filter(v => opponents.includes(v.id));
        for (const v of voters) await waitFor(() => v.page.$('.wl-vote[data-side="left"]'), 4000, 'vote buttons');
        for (const v of viewers) {
            if (v.id === giverId) continue;
            assert(!(await bandsVisible(v.page)), `${v.label}: ไม่เห็นเป้าตอนทายซ้าย/ขวา`);
        }
        await snap('t03-leftright');
        if (voters[0]) {
            await voters[0].page.click('.wl-vote[data-side="right"]');
            await waitFor(() => voters[0].page.$('.wl-vote[data-side="right"][aria-pressed="true"]'), 3000, 'vote pressed');
        }
        for (const v of voters.slice(1)) await v.page.click('.wl-vote[data-side="right"]');
        if (opponents.includes(bot.id)) await ack(bot.socket, 'wavelength_vote', { side: 'right', round: s.round, phase: 'leftright' });
        // ---------- ผลรอบ ----------
        await waitFor(() => view(bot).phase === 'reveal', 6000, 'reveal');
        await delay(2600);
        for (const v of viewers) {
            const txt = await v.page.textContent('#wlResults');
            assert(/ผลรอบ/.test(txt) && /ทาย/.test(txt), `${v.label}: ผลรอบมีแต้มทีม + ซ้าย/ขวา`);
            assert(await bandsVisible(v.page), `${v.label}: เปิดเป้าแล้วเห็นแถบ`);
        }
        await snap('t04-reveal');
        const team = await viewers[0].page.textContent('#wlBoard');
        assert(/ถึง 10/.test(team), 'ตารางทีม');
        // ---------- จบเกม (หัวห้อง) ----------
        const hostPage = viewers[0];
        if (await hostPage.page.$('#wlEndBtn:not([hidden])')) {
            await hostPage.page.click('#wlEndBtn');
            const ok = await hostPage.page.waitForSelector('.swal2-confirm', { timeout: 3000 }).catch(() => null);
            if (ok) await ok.click();
            await waitFor(() => view(bot).phase === 'finished', 6000, 'finished');
            await delay(1500);
            for (const v of viewers) {
                const txt = await v.page.textContent('#wlFinal');
                assert(/ชนะ|เสมอ/.test(txt), `${v.label}: จอจบบอกทีมชนะ`);
            }
            await snap('t05-final');

            // ---------- ร่วมมือ: กลับห้องรอ → เปลี่ยนโหมด → เล่น 1 ตา ----------
            for (const v of viewers) await v.page.waitForURL(/\/room\//, { timeout: 25000 });
            await waitFor(() => hostPage.page.$('.wl-mode-btn[data-wl-mode="coop"]'), 6000, 'lobby again');
            await hostPage.page.click('.wl-mode-btn[data-wl-mode="coop"]');
            await waitFor(() => hostPage.page.$('.wl-mode-btn[data-wl-mode="coop"][aria-pressed="true"]'), 4000, 'coop picked');
            await waitFor(async () => !(await hostPage.page.$eval('#btnStartGameLobby', b => b.disabled)), 8000, 'start enabled 2');
            await hostPage.page.click('#btnStartGameLobby');
            const c2 = await hostPage.page.waitForSelector('.swal2-confirm', { timeout: 1500 }).catch(() => null);
            if (c2) await c2.click().catch(() => {});
            for (const v of viewers) await v.page.waitForURL(/\/game\//, { timeout: 15000 });
            viewers.forEach(v => { v.errors = v.errors.filter(e => !/beforeunload/.test(e)); });
            await waitFor(() => view(bot) && view(bot).variant === 'coop' && view(bot).phase === 'clue', 8000, 'coop clue');
            let cs = view(bot);
            await delay(1500);
            for (const v of viewers) assert(/เหลือ 7 ใบ/.test(await v.page.textContent('#wlTeams')), `${v.label}: แถบร่วมมือ 7 ใบ`);
            const cg = pageOf(cs.giverId);
            if (cg) {
                await cg.page.click('.wl-option[data-index="0"]');
                await waitFor(() => cg.page.$('.wl-option.is-picked'), 3000, 'coop picked card');
                await cg.page.fill('#wlClueInput', 'ข้าวมันไก่');
                await cg.page.click('#wlClueBtn');
            } else {
                await ack(bot.socket, 'wavelength_pickCard', { index: 0, round: cs.round, phase: 'clue' });
                await waitFor(() => view(bot).card, 3000, 'bot card 2');
                await ack(bot.socket, 'wavelength_clue', { text: 'ข้าวมันไก่', round: cs.round, phase: 'clue' });
            }
            await waitFor(() => view(bot).phase === 'guess', 5000, 'coop guess');
            cs = view(bot);
            await delay(1200);
            await snap('t06-coop-guess');
            const coopGuessers = cs.players.filter(p => p.isGuesser).map(p => p.playerId);
            for (const id of coopGuessers) {
                const pv = pageOf(id);
                if (pv) { await waitFor(() => pv.page.$('#wlLockBtn'), 4000, 'coop agree btn'); await pv.page.click('#wlLockBtn'); await delay(400); }
                else await ack(bot.socket, 'wavelength_lock', { value: 50, round: cs.round, phase: 'guess' });
            }
            await waitFor(() => view(bot).phase === 'reveal', 6000, 'coop reveal');
            assert(!view(bot).lastRound.lr, 'ร่วมมือ: ไม่มีซ้าย/ขวา');
            await delay(2600);
            await snap('t07-coop-reveal');
        }
        console.log(`✅ smoke-wavelength-teams-browser: ${checks} checks · ${shots.length} ภาพ → ${SHOT_DIR}`);
    } finally {
        sockets.forEach(s => { try { s.close(); } catch (e) { /* ignore */ } });
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await delay(300);
        try { server.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
