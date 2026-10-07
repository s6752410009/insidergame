/**
 * ไพ่ทิ้งสีในเบราว์เซอร์จริง: 3 คน (390×844) เล่นผ่าน UI จนจบเกม + ภาพ 1280×900
 * ตรวจ: ไม่มี page error / console error · ไม่มี scroll แนวนอน · ไม่มีข้อความล้นจอ · แตะ/ปัดขึ้นลงไพ่ได้
 * ออกจากห้อง: ปุ่ม "🚪 ออก" เห็นทุกช่วง (เล่นอยู่/จบรอบ/จบเกม) · ยืนยันแล้วไป /rooms · รอ 15 วิ ไม่โดนดึงกลับ · เกมเล่นต่อ
 * ลงหลายใบ: เลือกเลขเดียวกัน 3 สี → ป้าย "เพิ่มได้" · เลขลำดับ 1 2 3 · แตะซ้ำเอาออก · ปุ่ม "ลง 3 ใบ" · ใบสุดท้ายอยู่บนกอง · คนอื่นเห็น
 *
 * รัน: npm run smoke:colorcards:browser   (SMOKE_PORT=8842, SHOTS_DIR=<โฟลเดอร์ภาพ>)
 */
const path = require('path');
const fs = require('fs');

if (!process.env.GAME_DATA_DIR) {
    const dir = path.join(__dirname, '..', '..', '..', 'tmpdata-colorcards', `browser-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.env.GAME_DATA_DIR = dir;
    process.env.WALLETS_FILE = path.join(dir, 'wallets.json');
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const PORT = Number(process.env.SMOKE_PORT) || 8842;
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, '..', '..', '..', 'newgames', 'colorcards');
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|sourcemap|net::ERR_INTERNET|autoplay|play\(\) failed|AudioContext|preload|\.mp3|fonts\.g/i;

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), COLORCARDS_TURN_MS: '20000' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + logs.slice(-500))); });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
async function waitForHost(pred, ms = 8000) {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (pred()) return; await delay(60); }
    throw new Error('timeout รอ state ฝั่งหัวห้อง');
}
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function layoutProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push('scroll แนวนอน ' + document.documentElement.scrollWidth + ' > ' + vw);
        const skip = el => el.closest('#ccHand, #ccFx, .cc-sidebar:not(.open), #chatBox, .swal2-container, #ppTermsBar, .cc-row-cards');
        document.querySelectorAll('#ccRoot *, #ccDock *, #ccSheet *, #ccPicker *, #ccCatch *').forEach(el => {
            if (skip(el)) return;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || style.position === 'fixed' && el.id === 'ccBanner') return;
            if (r.right > vw + 1 || r.left < -1) out.push('ล้นจอ: ' + (el.id || el.className || el.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
            // ข้อความล้นกล่องโดยไม่ตัด …
            if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1
                && style.overflow !== 'hidden' && style.textOverflow !== 'ellipsis' && style.overflowX !== 'auto') {
                const parent = el.parentElement;
                const ps = parent && getComputedStyle(parent);
                if (!(ps && (ps.textOverflow === 'ellipsis' || ps.overflow === 'hidden'))) out.push('ข้อความล้น: ' + (el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 20) + '"');
            }
        });
        return [...new Set(out)].slice(0, 8);
    });
}

async function openPlayer(browser, base, id, viewport, label, roomId) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
    await context.addInitScript(() => {
        try {
            sessionStorage.setItem('insiderPromoSeen', '1');
            localStorage.setItem('ig-firstplay-colorcards', '1');
            localStorage.setItem('ccSound', 'off');
        } catch (e) { /* ignore */ }
    });
    const page = await context.newPage();
    const errors = [];
    const aborted = [];
    let prevUrl = '';
    let curUrl = '';
    page.on('framenavigated', f => { if (f === page.mainFrame()) { prevUrl = curUrl; curUrl = f.url(); } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
        if (m.type() !== 'error' || IGNORE.test(m.text())) return;
        // หน้าห้องรอ (ไม่ใช่กระดานนี้) ตั้ง beforeunload ไว้ — Chrome บ่นตอนเกมใหม่พาไปหน้ากระดาน
        if (/beforeunload/.test(m.text()) && /\/room\//.test(prevUrl)) return;
        errors.push('console: ' + m.text().slice(0, 60) + ' @ ' + page.url() + ' prev=' + prevUrl + ' t=' + Date.now());
    });
    // ERR_ABORTED = เบราว์เซอร์ยกเลิกเองตอนเปลี่ยนหน้า (เช่นกดออกจากห้องระหว่างที่ fetch ค้าง) ไม่ใช่ของพัง
    page.on('requestfailed', r => {
        const why = (r.failure() && r.failure().errorText) || '';
        if (IGNORE.test(r.url())) return;
        if (/ERR_ABORTED/.test(why)) { aborted.push(r.url() + ' ' + why); return; }
        errors.push('requestfailed: ' + r.url() + ' ' + why);
    });
    await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/game/${roomId}?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ccHand .cc-card', { timeout: 15000 });
    await page.waitForTimeout(500);
    return { context, page, errors, aborted, label, id };
}

/** แตะไพ่ในมือตรงจุดที่มองเห็นจริง (ไพ่ซ้อนกัน ใบที่ยกขึ้นบังขอบใบข้าง ๆ) */
async function tapCard(page, id) {
    await page.evaluate(cardId => {
        const el = document.querySelector('#ccHand .cc-card[data-id="' + cardId + '"]');
        if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
    }, id);
    await delay(320);
    const pt = await page.evaluate(cardId => {
        const el = document.querySelector('#ccHand .cc-card[data-id="' + cardId + '"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        for (const fy of [0.72, 0.5, 0.25]) {
            for (let x = r.left + 6; x < r.right - 4; x += 3) {
                const y = r.top + r.height * fy;
                const hit = document.elementFromPoint(x, y);
                if (hit && hit.closest('.cc-card') === el) return { x, y };
            }
        }
        return null;
    }, id);
    assert(pt, 'แตะไพ่ไม่ได้ (ถูกบังหมด) ' + id);
    await page.mouse.click(pt.x, pt.y);
    await delay(260);
}
/** ตาเรา (ยังไม่จั่ว) มีเลขเดียวกัน 3 สีที่ลงได้อย่างน้อย 1 ใบไหม */
async function findTriple(page) {
    return page.evaluate(() => {
        if (!document.querySelector('#ccHand.is-myturn') || document.getElementById('ccPassBtn')) return null;
        const cards = [...document.querySelectorAll('#ccHand .cc-card[data-id]')].map(el => {
            const parts = (el.dataset.name || '').split(' ');
            return { id: el.dataset.id, col: parts[0], val: parts[1], name: el.dataset.name, playable: el.classList.contains('is-playable') };
        }).filter(c => /^\d$/.test(c.val || ''));
        const byVal = {};
        cards.forEach(c => { (byVal[c.val] = byVal[c.val] || []).push(c); });
        for (const v of Object.keys(byVal)) {
            const lead = byVal[v].find(c => c.playable);
            if (!lead) continue;
            const seen = new Set([lead.col]);
            const others = [];
            byVal[v].forEach(c => { if (c !== lead && !seen.has(c.col)) { seen.add(c.col); others.push(c); } });
            if (others.length >= 2) return { val: v, lead, a: others[0], b: others[1], count: document.querySelectorAll('#ccHand .cc-card[data-id]').length };
        }
        return null;
    });
}
async function badgeOf(page, id) {
    return page.evaluate(cardId => {
        const el = document.querySelector('#ccHand .cc-card[data-id="' + cardId + '"]');
        const b = el && el.querySelector('.cc-badge');
        return b ? b.textContent : '';
    }, id);
}
async function classOf(page, id) {
    return page.evaluate(cardId => (document.querySelector('#ccHand .cc-card[data-id="' + cardId + '"]') || {}).className || '', id);
}

/** ปุ่มออกมองเห็นจริง (ไม่โดนแชท/ชีตบัง) · สูง ≥ 44px · มีคำว่า ออก */
async function exitVisible(page, selector) {
    return page.evaluate(sel => {
        const el = [...document.querySelectorAll(sel)].find(x => x.offsetParent !== null);
        if (!el) return { ok: false, why: 'ไม่มีปุ่ม ' + sel };
        const r = el.getBoundingClientRect();
        if (r.height < 44 || r.width < 44) return { ok: false, why: 'ปุ่มเล็กไป ' + Math.round(r.width) + '×' + Math.round(r.height) };
        if (r.bottom < 0 || r.top > window.innerHeight || r.right > window.innerWidth || r.left < 0) return { ok: false, why: 'อยู่นอกจอ' };
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === el || el.contains(hit))) return { ok: false, why: 'ถูกบังโดย ' + (hit && (hit.id || hit.className)) };
        if (!/ออก/.test(el.textContent)) return { ok: false, why: 'ไม่มีคำว่า ออก' };
        return { ok: true };
    }, selector);
}

async function isMyTurn(page) { return page.evaluate(() => !!document.querySelector('#ccHand.is-myturn')); }
async function handCount(page) { return page.locator('#ccHand .cc-card').count(); }

/** ทำหนึ่งแอ็กชันผ่าน UI ถ้าถึงตา · mode: 'hoard' = จั่วอย่างเดียว */
async function act(p, mode, opts = {}) {
    const { page } = p;
    if (await page.locator('#ccPicker.is-on').isVisible().catch(() => false)) {
        await page.locator('#ccPickerGrid button.is-best').click({ timeout: 5000 });
        return 'pick';
    }
    if (await page.locator('#ccCatchBtn').isVisible().catch(() => false)) {
        await page.locator('#ccCatchBtn').click({ timeout: 5000 });
        return 'catch';
    }
    if (!(await isMyTurn(page))) return null;
    if (await page.locator('#ccPassBtn').isVisible().catch(() => false)) {
        if (mode === 'hoard') { await page.locator('#ccPassBtn').click({ timeout: 5000 }); return 'pass'; }
        await page.locator('#ccPlayDrawnBtn').click({ timeout: 5000 });
        await delay(80);
        if (await page.locator('#ccPicker.is-on').isVisible().catch(() => false)) await page.locator('#ccPickerGrid button.is-best').click({ timeout: 5000 });
        return 'play-drawn';
    }
    const playable = page.locator('#ccHand .cc-card.is-playable');
    if (opts.badTap && mode !== 'hoard' && await playable.count()) {
        const bad = page.locator('#ccHand .cc-card:not(.is-playable)').first();
        if (await bad.count()) {
            await bad.scrollIntoViewIfNeeded();
            await bad.click({ position: { x: 10, y: 40 }, timeout: 5000 });
            await delay(120);
            opts.badTap(await page.locator('#ccHint').textContent());
        }
    }
    if (mode !== 'hoard' && await playable.count()) {
        if (await page.locator('#ccCallBtn').isVisible().catch(() => false) && !opts.forgetCall) {
            await page.locator('#ccCallBtn').click({ timeout: 5000 });
            await delay(150);
        }
        const card = playable.first();
        await card.scrollIntoViewIfNeeded();
        if (opts.swipe) {
            const box = await card.boundingBox();
            const x = box.x + 12; const y = box.y + box.height / 2;
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x, y - 30, { steps: 3 });
            await page.mouse.move(x, y - 70, { steps: 3 });
            await page.mouse.up();
        } else {
            // ไพ่ซ้อนกัน แตะที่แถบซ้ายที่มองเห็น (เหมือนนิ้วจริง)
            await card.click({ position: { x: 12, y: 40 }, timeout: 5000 });
            await delay(60);
            const selected = page.locator('#ccHand .cc-card.is-selected');
            if (await selected.count()) await selected.click({ position: { x: 12, y: 40 }, timeout: 5000 });
        }
        await delay(80);
        if (opts.onPicker && await page.locator('#ccPicker.is-on').isVisible().catch(() => false)) await opts.onPicker(page);
        if (await page.locator('#ccPicker.is-on').isVisible().catch(() => false)) await page.locator('#ccPickerGrid button.is-best').click({ timeout: 5000 });
        return opts.swipe ? 'swipe' : 'play';
    }
    if (await page.locator('#ccDrawBtn').isVisible().catch(() => false)) {
        await page.locator('#ccDrawBtn').click({ timeout: 5000 });
        return 'draw';
    }
    return null;
}

(async () => {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch();
    const sockets = [];
    const players = [];
    try {
        // ห้อง 3 คน (ผู้เล่นตั้งชื่อยาวเพื่อเช็กการตัดชื่อ)
        const ids = [randomUUID(), randomUUID(), randomUUID()];
        const names = ['มายด์', 'สมศักดิ์ทิ้งไพ่แดง', 'โอ๊ต'];
        for (let i = 0; i < 3; i += 1) {
            const s = await conn(base);
            s.emit('initPlayer', ids[i]);
            sockets.push(s);
        }
        await delay(300);
        for (let i = 0; i < 3; i += 1) {
            const res = await fetch(`${base}/profile/updateName?playerId=${ids[i]}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: names[i] }) });
            const body = await res.json().catch(() => ({}));
            if (!body.success) console.log('   · ตั้งชื่อไม่สำเร็จ (ใช้ชื่อสุ่ม):', JSON.stringify(body).slice(0, 80));
        }
        const created = await ack(sockets[0], 'createRoom', { playerId: ids[0], name: 'ไพ่ทิ้งสี', gameMode: 'colorcards', maxPlayers: 6, colorcardsTarget: 500 });
        assert(created?.success, 'สร้างห้องไม่ได้ ' + JSON.stringify(created));
        const roomId = created.roomId;
        sockets[0].emit('setRoom', { roomId, playerId: ids[0] });
        for (let i = 1; i < 3; i += 1) {
            assert((await ack(sockets[i], 'joinRoom', { roomId, playerId: ids[i] }))?.success, 'join ไม่ได้');
            sockets[i].emit('setRoom', { roomId, playerId: ids[i] });
        }
        await delay(300);

        // หน้าห้องรอ (ห้องแยก — ออกจากหน้าห้องรอ = ออกจากห้อง): ตั้งค่า/ปุ่มบอทต้องโชว์ ไม่ error
        const lobbyHost = randomUUID();
        const ls = await conn(base);
        ls.emit('initPlayer', lobbyHost);
        sockets.push(ls);
        await delay(200);
        const lobbyRoom = await ack(ls, 'createRoom', { playerId: lobbyHost, name: 'ไพ่ทิ้งสี', gameMode: 'colorcards', maxPlayers: 6 });
        assert(lobbyRoom?.success, 'สร้างห้องทดสอบห้องรอไม่ได้');
        const lobbyCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
        await lobbyCtx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
        const lobby = await lobbyCtx.newPage();
        const lobbyErrors = [];
        lobby.on('pageerror', e => lobbyErrors.push(e.message));
        lobby.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) lobbyErrors.push(m.text()); });
        await lobby.goto(`${base}/?playerId=${lobbyHost}`, { waitUntil: 'domcontentloaded' });
        await lobby.goto(`${base}/room/${lobbyRoom.roomId}?playerId=${lobbyHost}`, { waitUntil: 'networkidle' });
        await lobby.waitForSelector('#ccLobbyTarget', { timeout: 10000 });
        assert(await lobby.locator('#btnColorCardsAddBots').isVisible(), 'หัวห้องเห็นปุ่มเพิ่มบอท');
        assert(await lobby.locator('#btnColorCardsHowTo').isVisible(), 'มีปุ่มวิธีเล่น');
        await lobby.locator('#btnColorCardsAddBots').click();
        await lobby.waitForFunction(() => document.querySelectorAll('#lobbyPlayers *').length && /บอท/.test(document.getElementById('lobbyPlayers').textContent), null, { timeout: 8000 });
        await lobby.selectOption('#ccLobbyTurn', '30');
        await lobby.waitForFunction(() => document.getElementById('ccLobbyTurn') && document.getElementById('ccLobbyTurn').value === '30', null, { timeout: 5000 });
        assert(await lobby.locator('#ccLobbyMulti').isVisible(), 'ห้องรอมีสวิตช์ลงไพ่เหมือนกันหลายใบ');
        assert(await lobby.locator('#ccLobbyMulti').getAttribute('aria-pressed') === 'true', 'ลงหลายใบเปิดเป็นค่าเริ่ม');
        assert(/ลงไพ่เหมือนกันหลายใบพร้อมกัน/.test(await lobby.locator('#ccLobbyMulti').textContent()), 'ป้ายสวิตช์ลงหลายใบ');
        await lobby.locator('#ccLobbyMulti').click();
        await lobby.waitForFunction(() => document.getElementById('ccLobbyMulti') && document.getElementById('ccLobbyMulti').getAttribute('aria-pressed') === 'false', null, { timeout: 5000 });
        await lobby.locator('#ccLobbyMulti').click();
        await lobby.waitForFunction(() => document.getElementById('ccLobbyMulti') && document.getElementById('ccLobbyMulti').getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
        await delay(600);
        await lobby.screenshot({ path: path.join(SHOTS, 'lobby-390.png'), fullPage: true });
        assert(!lobbyErrors.length, 'ห้องรอมี error: ' + lobbyErrors.join(' | '));
        await lobby.goto(`${base}/rooms?playerId=${lobbyHost}`, { waitUntil: 'networkidle' });
        await lobby.screenshot({ path: path.join(SHOTS, 'rooms-390.png'), fullPage: false });
        await lobby.click('#createRoomBtn');
        await lobby.waitForSelector('#modeQuickPickGrid');
        await lobby.evaluate(() => { const d = document.querySelector('.mode-all-details'); if (d) d.open = true; });
        await lobby.click('.mode-quick-card[data-mode-id="colorcards"]');
        await lobby.waitForSelector('#colorcardsTableGroup', { state: 'visible' });
        assert(await lobby.locator('#colorcardsMulti').isVisible() && await lobby.locator('#colorcardsMulti').isChecked(), 'ฟอร์มสร้างห้องมีช่องลงหลายใบ ติ๊กไว้เป็นค่าเริ่ม');
        await lobby.evaluate(() => document.getElementById('colorcardsTableGroup').scrollIntoView({ block: 'center' }));
        await delay(300);
        await lobby.screenshot({ path: path.join(SHOTS, 'create-settings-390.png') });
        const multiLabel = await lobby.evaluate(() => document.getElementById('colorcardsMulti').closest('label').textContent);
        assert(/ลงไพ่เหมือนกันหลายใบพร้อมกัน/.test(multiLabel), 'ป้ายช่องลงหลายใบในฟอร์มสร้างห้อง');
        assert(!lobbyErrors.length, 'หน้ารายชื่อห้องมี error: ' + lobbyErrors.join(' | '));
        await lobbyCtx.close();
        console.log('1. ห้องรอ: ตั้งค่า/สวิตช์ลงหลายใบ/เพิ่มบอท/วิธีเล่น · ฟอร์มสร้างห้องมีช่องลงหลายใบ · หน้ารายชื่อห้องไม่มี error ✓');

        const st = await ack(sockets[0], 'startGameFromLobby', { roomId });
        assert(st?.success, 'เริ่มเกมไม่ได้ ' + JSON.stringify(st));
        await delay(3600);

        for (let i = 0; i < 3; i += 1) {
            players.push(await openPlayer(browser, base, ids[i], { width: 390, height: 844 }, 'p' + i, roomId));
        }
        await delay(800);
        const startCounts = await Promise.all(players.map(p => handCount(p.page)));
        const topLabel = await players[0].page.locator('#ccPile .cc-card.is-top').getAttribute('aria-label');
        const nines = startCounts.filter(c => c === 9).length;
        assert(startCounts.every(c => c === 7 || c === 9) && (nines === 0 || (nines === 1 && /\+2/.test(topLabel || ''))), `แจกคนละ 7 ใบ (ใบแรก +2 = คนแรก 9): ${startCounts.join(',')} top=${topLabel}`);
        const turnTextOk = await players[0].page.locator('#ccNowCopy').textContent();
        assert(turnTextOk && turnTextOk.length > 3, 'แถบสถานะบอกว่าตาใคร');
        await delay(8200); // รอแถบข้อตกลงด้านบนหายก่อนถ่ายภาพ
        const turnP = await (async () => { for (const p of players) if (await isMyTurn(p.page)) return p; return players[0]; })();
        await turnP.page.screenshot({ path: path.join(SHOTS, 'start-myturn-390.png') });
        const watcher = players.find(p => p !== turnP);
        await watcher.page.screenshot({ path: path.join(SHOTS, 'start-waiting-390.png') });
        for (const p of players) {
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} layout: ${probs.join(' | ')}`);
        }
        console.log('2. เปิดกระดาน 3 จอ ไพ่ 7 ใบ · ไม่มีล้นจอ ✓');

        // แตะกองจั่วตอนไม่ใช่ตาตัวเอง → บอกเหตุผล (ไม่เงียบ)
        // เช็กตา + แตะ + อ่านข้อความในจังหวะเดียว (ตาเปลี่ยนเร็วตอนเครื่องช้า)
        let deckHint = '';
        for (let tries = 0; tries < 6 && !deckHint; tries += 1) {
            for (const p of players) {
                deckHint = await p.page.evaluate(() => {
                    if (document.querySelector('#ccHand.is-myturn')) return '';
                    document.getElementById('ccDeck').click();
                    return document.getElementById('ccHint').textContent;
                });
                if (deckHint) break;
            }
            if (!deckHint) await delay(300);
        }
        assert(/ยังไม่ถึงตาคุณ/.test(deckHint), 'แตะกองจั่วนอกตา บอกว่ายังไม่ถึงตา: ' + deckHint);
        // เปิดแท็บที่สองของคนเดียวกันแล้วปิด → แท็บแรกกลับมา (visibilitychange) ต้องได้ state ต่อ ไม่ค้าง
        const dupCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await dupCtx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-colorcards', '1'); } catch (e) { /* ignore */ } });
        const dup = await dupCtx.newPage();
        await dup.goto(`${base}/?playerId=${ids[1]}`, { waitUntil: 'domcontentloaded' });
        await dup.goto(`${base}/game/${roomId}?playerId=${ids[1]}`, { waitUntil: 'domcontentloaded' });
        await dup.waitForSelector('#ccHand .cc-card', { timeout: 15000 });
        await delay(400);
        await dupCtx.close();
        await delay(600);
        await players[1].page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await delay(500);
        console.log('2b. แตะกองจั่วนอกตามีเหตุผล · เปิด/ปิดแท็บซ้ำแล้วแท็บเดิมกลับมาเล่นต่อได้ ✓');

        // ช่วงสะสมไพ่: ทุกคนจั่วอย่างเดียว ~10 รอบโต๊ะ จนมือใหญ่ (ทดสอบ 15+ ใบที่ 390px)
        let guard = 0;
        while (guard < 200) {
            guard += 1;
            const counts = await Promise.all(players.map(p => handCount(p.page)));
            if (Math.min(...counts) >= 15) break;
            let acted = false;
            for (const p of players) {
                const r = await act(p, 'hoard');
                if (r) { acted = true; await delay(220); }
            }
            if (!acted) await delay(120);
        }
        const big = await Promise.all(players.map(p => handCount(p.page)));
        assert(Math.min(...big) >= 15, 'ทุกคนมีไพ่ 15+ ใบ: ' + big.join(','));
        for (const p of players) {
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} (มือใหญ่) layout: ${probs.join(' | ')}`);
        }
        assert(/ล่าสุด/.test(await players[0].page.locator('#ccNowLast').textContent()), 'แถบสถานะบอกว่าเกิดอะไรล่าสุด');
        const bigTurn = await (async () => { for (const p of players) if (await isMyTurn(p.page)) return p; return players[0]; })();
        await bigTurn.page.screenshot({ path: path.join(SHOTS, 'bighand-myturn-390.png') });
        // ไพ่ที่ลงได้ถูกเลื่อนออกนอกจอ → ป้าย "ลงได้" ที่ขอบ แตะแล้วเลื่อนไปหา
        if (await isMyTurn(bigTurn.page) && !(await bigTurn.page.locator('#ccPassBtn').isVisible())) {
            // เลื่อนมือไปสุดขวา → ถ้าใบที่ลงได้ใบแรกหลุดจอซ้าย ต้องมีป้าย "‹ ลงได้" (หรือกลับกัน)
            const pill = await bigTurn.page.evaluate(async () => {
                const hand = document.getElementById('ccHand');
                const cards = [...hand.querySelectorAll('.cc-card.is-playable')];
                if (!cards.length) return { side: 'none' };
                const vis = el => { const box = hand.getBoundingClientRect(); const r = el.getBoundingClientRect(); return Math.min(r.right, box.right - 16) - Math.max(r.left, box.left + 16) >= 24; };
                for (const [edge, side, el] of [[hand.scrollWidth, 'L', cards[0]], [0, 'R', cards[cards.length - 1]]]) {
                    hand.scrollTo({ left: edge, behavior: 'instant' });
                    hand.dispatchEvent(new Event('scroll'));
                    await new Promise(r => setTimeout(r, 150));
                    if (!vis(el)) return { side, id: el.dataset.id };
                }
                return { side: 'visible' };
            });
            if (pill.side === 'L' || pill.side === 'R') {
                const btn = bigTurn.page.locator('#ccMore' + pill.side);
                assert(await btn.isVisible(), 'ไพ่ที่ลงได้อยู่นอกจอ → ป้ายลงได้ที่ขอบ ' + pill.side);
                await bigTurn.page.screenshot({ path: path.join(SHOTS, 'bighand-offscreen-390.png') });
                await btn.click();
                await delay(800);
                const seen = await bigTurn.page.evaluate(() => {
                    const hand = document.getElementById('ccHand');
                    const box = hand.getBoundingClientRect();
                    return [...hand.querySelectorAll('.cc-card.is-playable')].some(el => { const r = el.getBoundingClientRect(); return r.left >= box.left - 2 && r.right <= box.right + 2; });
                });
                assert(seen, 'แตะป้ายลงได้ → เลื่อนไพ่ที่ลงได้เข้าจอ');
                console.log('   · ป้าย "ลงได้" ' + pill.side + ' โชว์และเลื่อนถูก');
            } else console.log('   · ไพ่ที่ลงได้อยู่ในจอเสมอ (' + pill.side + ') ข้ามเช็กป้าย');
        }
        // เลือกไพ่ (ยกขึ้น) แล้วถ่าย
        const sel = bigTurn.page.locator('#ccHand .cc-card.is-playable').first();
        if (await sel.count()) {
            await sel.scrollIntoViewIfNeeded();
            await sel.click({ position: { x: 12, y: 40 } });
            await delay(300);
            await bigTurn.page.screenshot({ path: path.join(SHOTS, 'bighand-selected-390.png') });
        }
        console.log(`3. มือใหญ่ ${big.join('/')} ใบ เลื่อนได้ ไม่ล้นจอ ✓`);

        // 3b. ลงหลายใบ: เลข 3 สีเดียวกัน → เพิ่มได้ · ลำดับ 1 2 3 · แตะซ้ำเอาออก · ปุ่ม · ใบสุดท้ายบนกอง · คนอื่นเห็น
        let triple = null;
        let mp = null;
        for (let g2 = 0; g2 < 240 && !triple; g2 += 1) {
            for (const p of players) {
                const t = await findTriple(p.page);
                if (t) { triple = t; mp = p; break; }
            }
            if (triple) break;
            let acted = false;
            for (const p of players) {
                const r = await act(p, 'hoard');
                if (r) { acted = true; await delay(220); }
            }
            if (!acted) await delay(120);
        }
        assert(triple, 'หาเลขเดียวกัน 3 สีในมือไม่เจอ');
        const mpage = mp.page;
        const { lead, a: c2, b: c3 } = triple;
        if (!/is-selected/.test(await classOf(mpage, lead.id))) await tapCard(mpage, lead.id);
        assert(/is-selected/.test(await classOf(mpage, lead.id)), 'แตะใบแรก → ยกขึ้น (เลือก)');
        assert(/is-addable/.test(await classOf(mpage, c2.id)) && /is-addable/.test(await classOf(mpage, c3.id)), 'เลขเดียวกันสีอื่นเรือง "เพิ่มได้"');
        assert(await badgeOf(mpage, c2.id) === 'เพิ่มได้', 'ป้าย "เพิ่มได้" บนใบที่เพิ่มได้');
        assert((await mpage.locator('#ccPlayBtn').textContent()).trim() === 'ลงใบนี้', 'เลือกใบเดียว ปุ่ม "ลงใบนี้"');
        await mpage.screenshot({ path: path.join(SHOTS, 'multi-addable-390.png') });
        await tapCard(mpage, c2.id);
        await tapCard(mpage, c3.id);
        assert([await badgeOf(mpage, lead.id), await badgeOf(mpage, c2.id), await badgeOf(mpage, c3.id)].join() === '1,2,3', 'เลขลำดับ 1 2 3 ตามที่แตะ');
        assert((await mpage.locator('#ccPlayBtn').textContent()).trim() === 'ลง 3 ใบ', 'ปุ่ม "ลง 3 ใบ"');
        assert(/ลง 3 ใบ · บนสุด/.test(await mpage.locator('#ccHint').textContent()), 'คำใบ้บอกจำนวน + สีบนสุด');
        await mpage.screenshot({ path: path.join(SHOTS, 'multi-selected-390.png') });
        const mProbs = await layoutProblems(mpage);
        assert(!mProbs.length, 'เลือกหลายใบ layout: ' + mProbs.join(' | '));
        // แตะใบที่ 2 ซ้ำ = เอาออก · แตะอีกที = ต่อท้าย (ลำดับใหม่ ใบแรก → ใบที่ 3 → ใบที่ 2)
        await tapCard(mpage, c2.id);
        assert(!/is-selected/.test(await classOf(mpage, c2.id)) && /is-addable/.test(await classOf(mpage, c2.id)), 'แตะซ้ำ → เอาออกจากกลุ่ม (กลับเป็นเพิ่มได้)');
        assert(await badgeOf(mpage, c3.id) === '2' && (await mpage.locator('#ccPlayBtn').textContent()).trim() === 'ลง 2 ใบ', 'เอาออกแล้วลำดับ/ปุ่มอัปเดต');
        await tapCard(mpage, c2.id);
        assert([await badgeOf(mpage, lead.id), await badgeOf(mpage, c3.id), await badgeOf(mpage, c2.id)].join() === '1,2,3', 'ใส่กลับ → ไปอยู่ท้าย');
        const watcherM = players.find(p => p !== mp);
        await mpage.locator('#ccPlayBtn').click();
        await delay(200);
        await mpage.screenshot({ path: path.join(SHOTS, 'multi-flying-390.png') });
        await mpage.waitForFunction(id => { const t = document.querySelector('#ccPile .cc-card.is-top'); return t && t.dataset.id === id; }, c2.id, { timeout: 8000 });
        const pileIds = await mpage.evaluate(() => [...document.querySelectorAll('#ccPile .cc-card')].map(el => el.dataset.id).slice(-3));
        assert(pileIds.join() === [lead.id, c3.id, c2.id].join(), 'กองทิ้งเรียงตามลำดับที่เลือก ใบสุดท้ายบนสุด');
        assert(await handCount(mpage) === triple.count - 3, 'มือลด 3 ใบ');
        const topName = await mpage.locator('#ccPile .cc-card.is-top').getAttribute('aria-label');
        assert(topName === c2.name, `ใบบนสุด = ${c2.name} (ได้ ${topName})`);
        await watcherM.page.waitForFunction(v => /ลง \d สามใบ!/.test(document.getElementById('ccNowLast').textContent) && document.getElementById('ccNowLast').textContent.includes('ลง ' + v + ' สามใบ!'), triple.val, { timeout: 8000 });
        const watchLine = await watcherM.page.locator('#ccNowLast').textContent();
        const watchTop = await watcherM.page.locator('#ccPile .cc-card.is-top').getAttribute('aria-label');
        assert(watchTop === c2.name, 'คนอื่นเห็นใบบนสุดเดียวกัน');
        await delay(250);
        await watcherM.page.screenshot({ path: path.join(SHOTS, 'multi-watcher-390.png') });
        await delay(900);
        await mpage.screenshot({ path: path.join(SHOTS, 'multi-after-390.png') });
        console.log(`3b. ลงหลายใบผ่าน UI: ${lead.name} → ${c3.name} → ${c2.name} · เพิ่มได้/ลำดับ/เอาออก/ปุ่ม "ลง 3 ใบ" · คนอื่นเห็น "${watchLine.trim()}" ✓`);

        // เล่นจริงจนจบ: ปัดขึ้น 1 ครั้ง · ถ่ายตัวเลือกสี · ลืมบอกเหลือใบเดียวครั้งแรก (ให้คนอื่นจับ)
        let swiped = false;
        let pickerShot = false;
        let forgot = false;
        let catchShot = false;
        let actions = { play: 0, swipe: 0, draw: 0, pass: 0, catch: 0, 'play-drawn': 0 };
        let badHint = null;
        let pickerClosedChecked = false;
        guard = 0;
        while (guard < 900) {
            guard += 1;
            if (await players[0].page.locator('#ccSheet.is-on').isVisible().catch(() => false)) break;
            let acted = false;
            for (const p of players) {
                if (!catchShot && await p.page.locator('#ccCatchBtn').isVisible().catch(() => false)) {
                    await p.page.screenshot({ path: path.join(SHOTS, 'catch-390.png') });
                    catchShot = true;
                }
                const hand = await handCount(p.page);
                const forgetCall = !forgot && hand === 2;
                const r = await act(p, 'play', {
                    badTap: badHint === null ? (h => { badHint = h; }) : null,
                    swipe: !swiped,
                    forgetCall,
                    onPicker: pickerShot ? null : async page => {
                        await delay(250);
                        await page.screenshot({ path: path.join(SHOTS, 'picker-390.png') });
                        pickerShot = true;
                        // ชีตเลือกสีบังปุ่มเหลือใบเดียว → ต้องมีปุ่มเดียวกันในชีตเมื่อกดได้
                        const callInSheet = await page.locator('#ccPickerCall').isVisible();
                        const canCall = hand === 2 && !(await page.locator('#ccPickerCalled').isVisible());
                        assert(callInSheet === canCall, `ปุ่มเหลือใบเดียวในชีตเลือกสี (มือ ${hand} · โชว์ ${callInSheet})`);
                        // ระหว่างเลือกสี ตาเปลี่ยน (จั่วจากอีกเครื่อง) → ชีตต้องปิดเอง ไม่ค้างให้กดแล้ว error
                        if (!pickerClosedChecked) {
                            const sock = sockets[ids.indexOf(p.id)];
                            const res = await ack(sock, 'colorcards_draw', { roomId });
                            if (res && res.success) {
                                await page.waitForFunction(() => !document.getElementById('ccPicker').classList.contains('is-on'), null, { timeout: 5000 });
                                pickerClosedChecked = true;
                            }
                        }
                    }
                });
                if (r) {
                    acted = true;
                    actions[r] = (actions[r] || 0) + 1;
                    if (r === 'swipe') swiped = true;
                    if ((r === 'play' || r === 'swipe') && forgetCall) forgot = true;
                    await delay(240);
                }
            }
            if (!acted) await delay(150);
        }
        await players[0].page.waitForSelector('#ccSheet.is-on', { timeout: 30000 });
        assert(actions.swipe === 1, 'ปัดขึ้นลงไพ่ได้');
        assert(badHint === null || /ต้องเป็น|จั่วแล้ว|ต้องซ้อน/.test(badHint), 'แตะไพ่ที่ลงไม่ได้ → บอกว่าต้องสี/เลขอะไร: ' + badHint);
        let readyChecked = false;
        if (/จบรอบ/.test(await players[0].page.locator('#ccSheetCard .cc-sheet-kicker').first().textContent())) {
            await delay(700);
            await players[1].page.screenshot({ path: path.join(SHOTS, 'roundend-390.png') });
            const sheetText = await players[1].page.locator('#ccSheetCard').innerText();
            assert(/แต้ม/.test(sheetText) && /คะแนนรวม/.test(sheetText), 'สรุปจบรอบมีหน่วยแต้มและคะแนนรวม');
            assert(await players[0].page.locator('#ccNextBtn').isVisible(), 'หัวห้องเห็นปุ่มเริ่มรอบต่อไป');
            const exitRound = await exitVisible(players[1].page, '#ccSheetExitBtn');
            assert(exitRound.ok, 'จบรอบ: ปุ่มออกเห็นในชีตสรุป — ' + exitRound.why);
            for (const p of players.slice(1)) {
                assert(await p.page.locator('#ccReadyBtn').isVisible(), `${p.label} เห็นปุ่มพร้อมรอบต่อไป`);
                await p.page.locator('#ccReadyBtn').click();
            }
            await players[0].page.waitForFunction(() => /พร้อมแล้ว 2\/3/.test(document.getElementById('ccSheetNote').textContent), null, { timeout: 5000 });
            assert(await players[1].page.locator('#ccSheetCard .cc-called').isVisible(), 'กดพร้อมแล้วเห็นสถานะพร้อม');
            const rnd = await players[0].page.locator('#ccRoundNo').textContent();
            await players[0].page.locator('#ccNextBtn').click();
            await players[0].page.waitForFunction(r => !document.getElementById('ccSheet').classList.contains('is-on') && document.getElementById('ccRoundNo').textContent !== r, rnd, { timeout: 5000 });
            // หัวห้องจบเกมกลางรอบ 2 (มีกล่องยืนยัน) → สรุปผลจบเกม
            await players[0].page.locator('#ccEndBtn').click();
            await players[0].page.locator('.swal2-confirm').click();
            await players[0].page.waitForFunction(() => /จบเกม/.test((document.querySelector('#ccSheetCard .cc-sheet-kicker') || {}).textContent || ''), null, { timeout: 8000 });
            readyChecked = true;
            console.log('   · จบรอบ: คนอื่นกดพร้อม 2/3 → หัวห้องเริ่มรอบ 2 → หัวห้องจบเกม ✓');
        }
        assert(actions.play + actions.swipe + actions['play-drawn'] > 10, 'ลงไพ่ผ่าน UI ได้หลายใบ');
        await delay(700);
        for (const p of players) {
            assert(await p.page.locator('#ccSheet.is-on').isVisible(), `${p.label} เห็นสรุปผล`);
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} (สรุป) layout: ${probs.join(' | ')}`);
        }
        await players[0].page.screenshot({ path: path.join(SHOTS, 'finished-390.png') });
        const exitFin = await exitVisible(players[0].page, '#ccSheetExitBtn');
        assert(exitFin.ok, 'จบเกม: ปุ่มออกเห็นในชีตสรุป — ' + exitFin.why);
        const winnerTitle = await players[0].page.locator('#ccSheetTitle').textContent();
        assert(/ชนะ/.test(winnerTitle), 'สรุปผลบอกผู้ชนะ');
        assert(await players[0].page.locator('#ccBackBtn').isVisible(), 'มีปุ่มกลับห้องรอ/เล่นอีกตา');
        console.log(`   · ชีตเลือกสีปิดเองเมื่อตาเปลี่ยน ${pickerClosedChecked ? '✓' : '-'}`);
        console.log(`   · เหตุผลแตะไพ่ผิด: ${badHint || '-'} · จบรอบ/พร้อม ${readyChecked ? '✓' : 'ข้าม (จบในรอบเดียว)'}`);
        console.log(`4. เล่นผ่าน UI จนจบ (ลง ${actions.play} · ปัด ${actions.swipe} · จั่ว ${actions.draw} · ผ่าน ${actions.pass} · จับได้ ${actions.catch}) · ภาพ picker ${pickerShot ? '✓' : '-'} · catch ${catchShot ? '✓' : '-'} ✓`);

        // จอใหญ่ 1280×900 (เกมใหม่)
        await players[0].page.locator('#ccBackBtn').click();
        await players[0].page.waitForURL(/\/room\//, { timeout: 15000 });
        assert((await ack(sockets[0], 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมรอบสองไม่ได้');
        await delay(3600);
        const desk = await openPlayer(browser, base, ids[1], { width: 1280, height: 900 }, 'desk', roomId);
        players.push(desk);
        await delay(8500);
        await desk.page.screenshot({ path: path.join(SHOTS, 'desktop-1280.png') });
        // จอใหญ่: ถ้าถึงตาและมีไพ่ค่าเดียวกัน เลือกให้เห็นป้าย "เพิ่มได้" (ไม่ลง)
        const deskLead = await desk.page.evaluate(() => {
            const cards = [...document.querySelectorAll('#ccHand.is-myturn .cc-card[data-id]')];
            const key = el => (el.dataset.name || '').split(' ').slice(1).join(' ') || el.dataset.name;
            const lead = cards.find(el => el.classList.contains('is-playable') && cards.some(o => o !== el && key(o) === key(el) && /\d|ข้าม|กลับทิศ|\+2/.test(key(el)) && !/เปลี่ยนสี|\+4/.test(el.dataset.name)));
            return lead ? lead.dataset.id : null;
        });
        if (deskLead) {
            await tapCard(desk.page, deskLead);
            assert(await desk.page.locator('#ccHand .cc-card.is-addable').count() >= 1, 'จอใหญ่: เลือกใบแรกแล้วมีใบเพิ่มได้');
            await desk.page.screenshot({ path: path.join(SHOTS, 'desktop-multi-1280.png') });
        }
        const deskProbs = await layoutProblems(desk.page);
        assert(!deskProbs.length, 'desktop layout: ' + deskProbs.join(' | '));
        console.log('5. 1280×900 ไม่ล้นจอ ✓');
        const land = await openPlayer(browser, base, ids[0], { width: 844, height: 390 }, 'land', roomId);
        players.push(land);
        await delay(8500);
        await land.page.screenshot({ path: path.join(SHOTS, 'landscape-844.png') });
        const landProbs = await layoutProblems(land.page);
        assert(!landProbs.length, 'landscape layout: ' + landProbs.join(' | '));
        const overlap = await land.page.evaluate(() => {
            const chat = document.getElementById('toggleChat').getBoundingClientRect();
            return [...document.querySelectorAll('.cc-tools .cc-pill')].some(el => { const r = el.getBoundingClientRect(); return r.right > chat.left && r.left < chat.right && r.bottom > chat.top && r.top < chat.bottom; });
        });
        assert(!overlap, 'แนวนอน: ปุ่มแชทไม่ทับปุ่มเครื่องมือ (จบเกม)');
        const landFit = await land.page.evaluate(() => {
            const dock = document.getElementById('ccDock').getBoundingClientRect();
            const table = document.getElementById('ccTable').getBoundingClientRect();
            window.scrollTo({ top: window.scrollY + table.bottom - dock.top, behavior: 'instant' }); // เลื่อนให้ขอบล่างโต๊ะชนขอบบนแถบมือ
            const pile = document.getElementById('ccPile').getBoundingClientRect();
            return { dockTop: Math.round(dock.top), pileTop: Math.round(pile.top), pileBottom: Math.round(pile.bottom) };
        });
        await delay(300);
        assert(landFit.pileTop >= 0 && landFit.pileBottom <= landFit.dockTop + 2, 'แนวนอน: เห็นกองทิ้งพร้อมไพ่ในมือ ' + JSON.stringify(landFit));
        console.log('5b. แนวนอน 844×390: ไม่ล้นจอ · แชทไม่ทับปุ่ม · เห็นโต๊ะพร้อมมือ ✓');

        // 5c. ออกจากห้องกลางเกม (โต๊ะมีบอท): ปุ่มเห็นตลอด → ยืนยัน → /rooms · 15 วิไม่โดนดึงกลับ · เกมเล่นต่อ
        const exHost = randomUUID();
        const exGuest = randomUUID();
        const hs = await conn(base);
        const hostStates = [];
        hs.on('colorcardsState', st => hostStates.push(st));
        hs.emit('initPlayer', exHost);
        const gs = await conn(base);
        gs.emit('initPlayer', exGuest);
        sockets.push(hs, gs);
        await delay(300);
        const exRoom = await ack(hs, 'createRoom', { playerId: exHost, name: 'ไพ่ทิ้งสี', gameMode: 'colorcards', maxPlayers: 4 });
        assert(exRoom?.success, 'สร้างห้องทดสอบออกไม่ได้');
        hs.emit('setRoom', { roomId: exRoom.roomId, playerId: exHost });
        assert((await ack(gs, 'joinRoom', { roomId: exRoom.roomId, playerId: exGuest }))?.success, 'join ห้องทดสอบออกไม่ได้');
        gs.emit('setRoom', { roomId: exRoom.roomId, playerId: exGuest });
        assert((await ack(hs, 'colorcards_addBots', { roomId: exRoom.roomId, count: 1 }))?.success, 'เพิ่มบอทไม่ได้');
        assert((await ack(hs, 'startGameFromLobby', { roomId: exRoom.roomId }))?.success, 'เริ่มเกมทดสอบออกไม่ได้');
        // รอให้แจกไพ่จริง (เริ่มเกมมีนับถอยหลัง) ก่อนปิด socket — ไม่งั้นคนนี้ไม่ได้ที่นั่ง
        await waitForHost(() => {
            const st = hostStates[hostStates.length - 1];
            return st && st.phase === 'turn' && st.seats.some(x => x.playerId === exGuest);
        }, 15000);
        gs.close(); // เบราว์เซอร์เข้ามาแทน socket นี้
        const ex = await openPlayer(browser, base, exGuest, { width: 390, height: 844 }, 'exit', exRoom.roomId);
        players.push(ex);
        await delay(8500); // แถบข้อตกลงด้านบนหาย
        const exMid = await exitVisible(ex.page, '#ccExitBtn');
        assert(exMid.ok, 'กลางเกม: ปุ่ม "🚪 ออก" เห็นทันที — ' + exMid.why);
        assert(!(await ex.page.locator('#playerSidebar.open').count()), 'ไม่ต้องเปิดแถบผู้เล่นก่อน');
        await ex.page.screenshot({ path: path.join(SHOTS, 'exit-midplay-390.png') });
        await ex.page.locator('#ccExitBtn').click();
        await ex.page.waitForSelector('.swal2-popup', { timeout: 5000 });
        const confirmText = await ex.page.locator('.swal2-html-container').textContent();
        assert(/ไพ่ของคุณจะกลับเข้ากอง/.test(confirmText) && /เกมเล่นต่อ/.test(confirmText), 'ยืนยันบอกผลชัด: ' + confirmText);
        assert((await ex.page.locator('.swal2-confirm').textContent()).trim() === 'ออกจากห้อง' && (await ex.page.locator('.swal2-cancel').textContent()).trim() === 'อยู่ต่อ', 'ปุ่มยืนยัน ออกจากห้อง / อยู่ต่อ');
        await delay(300);
        await ex.page.screenshot({ path: path.join(SHOTS, 'exit-confirm-390.png') });
        // "อยู่ต่อ" = ไม่ออก
        await ex.page.locator('.swal2-cancel').click();
        await delay(400);
        assert(/\/game\//.test(ex.page.url()), 'กดอยู่ต่อแล้วยังอยู่ในเกม');
        await ex.page.locator('#ccExitBtn').click();
        await ex.page.locator('.swal2-confirm').click();
        await ex.page.waitForURL(/\/rooms/, { timeout: 8000 });
        const leftAt = Date.now();
        await waitForHost(() => {
            const st = hostStates[hostStates.length - 1];
            return st && st.seats.find(x => x.playerId === exGuest)?.left;
        });
        const hostView = hostStates[hostStates.length - 1];
        assert(hostView.phase === 'turn' && hostView.seats.filter(x => !x.left).length === 2, 'คนอื่นเห็นว่าออก เกมเล่นต่อ (หัวห้อง + บอท)');
        assert(hostView.history.some(h => /ออกจากเกม/.test(h.text)), 'บันทึกเกมบอกว่าออก');
        const stepAtLeave = hostView.step;
        await delay(Math.max(0, 15500 - (Date.now() - leftAt)));
        assert(/\/rooms/.test(ex.page.url()) && !/\/game\/|\/room\//.test(ex.page.url()), '15 วิแล้วยังอยู่หน้า /rooms ไม่โดนดึงกลับ: ' + ex.page.url());
        const list = await new Promise(res => { const t = setTimeout(() => res({}), 8000); hs.emit('getRoomList', x => { clearTimeout(t); res(x || {}); }); });
        const live = (list.rooms || []).find(x => x.roomId === exRoom.roomId);
        assert(live, 'ห้องยังอยู่ (หัวห้อง + บอท)');
        assert(!(live.players || []).some(x => x.playerId === exGuest) && live.playerCount === 2, `ไม่นับคนที่ออกเป็นผู้เล่นในห้องแล้ว (${live.playerCount})`);
        const hostNow = hostStates[hostStates.length - 1];
        assert(hostNow.step > stepAtLeave && hostNow.phase !== 'lobby', 'เกมเดินต่อหลังคนออก (บอท/นาฬิกายังทำงาน)');
        assert(hostNow.seats.find(x => x.playerId === exGuest).left, 'ที่นั่งคนออกยังเป็น "ออกแล้ว"');
        await ex.page.screenshot({ path: path.join(SHOTS, 'exit-rooms-after15s-390.png') });
        if (ex.aborted.length) console.log('   · คำขอที่ถูกยกเลิกตอนเปลี่ยนหน้า: ' + ex.aborted.map(x => x.replace(base, '')).join(' | '));
        console.log('5c. ออกจากห้อง: ปุ่ม "🚪 ออก" เห็นทุกช่วง · ยืนยัน/อยู่ต่อ · ไป /rooms · 15 วิไม่โดนดึงกลับ · ห้องไม่นับแล้ว · เกมกับบอทเดินต่อ ✓');
        await ack(hs, 'leaveRoom', {});

        for (const p of players) {
            assert(!p.errors.length, `${p.label} มี error: ${p.errors.slice(0, 4).join(' | ')}`);
        }
        assert(!/\[colorcards\].*failed/.test(server.logs()), 'server log มี error ของไพ่ทิ้งสี');
        console.log(`6. ไม่มี page/console error ทุกจอ · ภาพอยู่ที่ ${SHOTS} ✓`);
        console.log(`\n✅ browser-colorcards: ${checks} checks passed`);
    } finally {
        for (const p of players) await p.context.close().catch(() => {});
        await browser.close().catch(() => {});
        sockets.forEach(s => s.close());
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
