/**
 * ตัวช่วยเทส "🚪 ออก" ทุกบอร์ด (Playwright + socket.io-client)
 *
 * ใช้คู่กับ scripts/browser-exit-everywhere.js — ตั้งห้องด้วย socket แล้วเปิดหน้าเกมจริงบนจอ 390×844
 * ให้คนหนึ่งกดออกกลางเกม: ยืนยัน → /rooms → รอ 15 วิ ยังอยู่ /rooms (ไม่โดนดึงกลับ)
 * แล้วกดย้อนกลับ ก็ต้องไม่ถูกพากลับเข้าห้อง
 */
require('./isolateTestData');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error('FAIL: ' + m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|accounts\.google|cdn\.jsdelivr|cdnjs|ERR_INTERNET|ERR_NAME|Failed to load resource/i;

function freePort() {
    if (process.env.EXIT_PORT) return Promise.resolve(Number(process.env.EXIT_PORT));
    return new Promise(res => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}

async function bootServer(extraEnv = {}) {
    const port = await freePort();
    if (port === 3000) throw new Error('ห้ามใช้พอร์ต 3000');
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1', ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += String(c); if (logs.includes(`Server started on port ${port}`)) { clearTimeout(t); resolve(); } });
        child.stderr.on('data', c => { logs += String(c); });
        child.once('exit', code => { clearTimeout(t); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
    return { child, base: `http://127.0.0.1:${port}`, port };
}

function stopServer(server) {
    if (!server?.child || server.child.exitCode != null) return Promise.resolve();
    return new Promise(resolve => {
        const t = setTimeout(() => { try { server.child.kill('SIGKILL'); } catch (e) { /* */ } resolve(); }, 3000);
        server.child.once('exit', () => { clearTimeout(t); resolve(); });
        server.child.kill('SIGTERM');
    });
}

function ack(socket, event, payload, ms = 15000) {
    return new Promise(r => {
        const t = setTimeout(() => r({ __timeout: true }), ms);
        socket.emit(event, payload, x => { clearTimeout(t); r(x); });
    });
}

/** ผู้เล่นฝั่ง socket — เก็บ state ของเกมไว้ใน p.states */
async function makePlayer(base, label, stateEvent) {
    const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((res, rej) => { socket.once('connect', res); socket.once('connect_error', rej); });
    const p = { label, id: randomUUID(), socket, states: [] };
    socket.emit('initPlayer', p.id);
    if (stateEvent) socket.on(stateEvent, s => p.states.push(s));
    p.last = () => p.states[p.states.length - 1] || null;
    return p;
}

async function setupRoom(base, { mode, count, stateEvent, roomOptions = {}, names = [] }) {
    const players = [];
    for (let i = 0; i < count; i += 1) players.push(await makePlayer(base, names[i] || `P${i + 1}`, stateEvent));
    await delay(400);
    const host = players[0];
    const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'ทดสอบปุ่มออก ' + mode, gameMode: mode, maxPlayers: Math.max(8, count), ...roomOptions });
    assert(created && created.success, 'สร้างห้อง ' + mode + ': ' + JSON.stringify(created));
    const roomId = created.roomId;
    host.socket.emit('setRoom', { roomId, playerId: host.id });
    for (const p of players.slice(1)) {
        const joined = await ack(p.socket, 'joinRoom', { roomId, playerId: p.id });
        assert(joined && joined.success, p.label + ' เข้าห้อง: ' + JSON.stringify(joined));
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(600);
    return { players, host, roomId };
}

async function startGame(host, roomId) {
    const res = await ack(host.socket, 'startGameFromLobby', { roomId });
    assert(res && res.success === true, 'เริ่มเกม: ' + JSON.stringify(res));
    await delay(4800); // นับถอยหลัง 3 วิก่อนเริ่มจริง
}

async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    let last;
    while (Date.now() < until) {
        try { last = await fn(); } catch (e) { last = null; }
        if (last) return last;
        await delay(150);
    }
    throw new Error('รอไม่ถึง: ' + label);
}

async function openGamePage(browser, base, roomId, p, rootSelector, initScript) {
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    });
    await ctx.addInitScript(() => {
        try {
            sessionStorage.setItem('insiderPromoSeen', '1');
            ['insider', 'coup', 'avalon', 'liar', 'blackmarket', 'codenames', 'wavelength', 'drawguess', 'setthi']
                .forEach(m => localStorage.setItem('ig-firstplay-' + m, '1'));
            const pid = new URLSearchParams(location.search).get('playerId');
            if (pid) localStorage.setItem('blackmarket-tour-v2:' + pid, 'done'); // ทัวร์โต๊ะครั้งแรก
        } catch (e) { /* */ }
    });
    if (initScript) await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(`${base}/game/${roomId}?playerId=${encodeURIComponent(p.id)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(rootSelector, { timeout: 30000 });
    p.page = page;
    p.ctx = ctx;
    p.errors = errors;
    return page;
}

/** ปุ่มออกเห็นได้ทันที (เลื่อนขึ้นบนสุด) ไม่โดนบัง สูง ≥ 44 ไม่ล้นจอ และหน้าไม่เลื่อนแนวนอน */
async function exitVisible(page, selector) {
    // ปิด popup ที่ค้าง (ถึงตาคุณ/วิธีเล่น) ก่อนเช็ค — ไม่ใช่ส่วนของปุ่มออก
    await page.evaluate(() => {
        const ping = document.getElementById('ppTurnPing'); if (ping) ping.classList.remove('is-on');
        window.scrollTo(0, 0);
    }).catch(() => {});
    await delay(250);
    return page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return 'ไม่มีปุ่ม ' + sel;
        const r = el.getBoundingClientRect();
        if (!/🚪\s*ออก/.test(el.textContent)) return 'ป้ายไม่ใช่ 🚪 ออก: ' + el.textContent.trim();
        if (r.height < 43.5 || r.width < 44) return 'เล็กไป ' + Math.round(r.width) + '×' + Math.round(r.height);
        if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return 'ล้นจอ ' + JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round));
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || (hit !== el && !el.contains(hit))) return 'โดนบังโดย ' + (hit ? (hit.id || hit.className || hit.tagName) : 'null');
        if (document.documentElement.scrollWidth > window.innerWidth + 1) return 'เลื่อนแนวนอนได้ ' + document.documentElement.scrollWidth;
        return 'ok';
    }, selector).catch(e => 'error ' + e.message);
}

async function swalText(page) {
    return page.evaluate(() => {
        const pop = document.querySelector('.swal2-popup.swal2-show, .swal2-popup');
        return pop ? pop.innerText : '';
    }).catch(() => '');
}

/**
 * กดออกจริง: เช็คปุ่ม → แตะ → popup ยืนยัน (ชื่อ/ปุ่ม/ผลที่ตามมา) → ยืนยัน → /rooms
 * → รอ 15 วิ ยังอยู่ /rooms → ย้อนกลับก็ไม่ถูกพาเข้าห้อง
 */
async function exitAndStayOut(p, { button, expect, label, holdMs = 15000, onLeft = null }) {
    const page = p.page;
    const vis = await exitVisible(page, button);
    assert(vis === 'ok', `${label}: ปุ่มออก ${vis}`);
    await page.tap(button);
    await page.waitForSelector('.swal2-popup .room-exit-list', { timeout: 6000 });
    const title = await page.$eval('.swal2-title', el => el.textContent.trim()).catch(() => '');
    assert(title === 'ออกจากห้อง?', `${label}: ชื่อ popup "${title}"`);
    assert(/ออกจากห้อง/.test(await page.$eval('.swal2-confirm', el => el.textContent)) && /อยู่ต่อ/.test(await page.$eval('.swal2-cancel', el => el.textContent)), `${label}: ปุ่ม ออกจากห้อง / อยู่ต่อ`);
    const body = await page.$eval('.room-exit-list', el => el.innerText);
    if (expect) assert(expect.test(body), `${label}: popup ต้องบอกผล ${expect} — ได้ "${body}"`);
    // อยู่ต่อก่อน 1 ครั้ง: ต้องยังอยู่หน้าเกม
    await page.click('.swal2-cancel');
    await delay(600);
    assert(/\/game\//.test(page.url()), `${label}: กดอยู่ต่อแล้วต้องยังอยู่ในเกม`);
    await page.tap(button);
    await page.waitForSelector('.swal2-popup .room-exit-list', { timeout: 6000 });
    await page.click('.swal2-confirm');
    await page.waitForURL(/\/rooms/, { timeout: 8000 });
    if (onLeft) await onLeft();
    const t0 = Date.now();
    while (Date.now() - t0 < holdMs) {
        await delay(1000);
        assert(/\/rooms/.test(page.url()) && !/\/game\/|\/room\//.test(page.url()), `${label}: ${Math.round((Date.now() - t0) / 1000)} วิหลังออก โดนดึงกลับไป ${page.url()}`);
    }
    // กดย้อนกลับ (มือถือปัดย้อน) → ต้องไม่ถูก auto-join กลับเข้าห้อง
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await delay(2500);
    assert(!/\/room\//.test(page.url()), `${label}: ย้อนกลับแล้วโดนพาเข้าห้อง ${page.url()}`);
    if (/\/game\//.test(page.url())) {
        await page.waitForURL(/\/rooms/, { timeout: 6000 }).catch(() => {});
    }
    assert(/\/rooms/.test(page.url()), `${label}: ย้อนกลับแล้วต้องอยู่หน้ารวมห้อง (ได้ ${page.url()})`);
    return body;
}

function report(name) {
    console.log(`\n✅ ${name}: ผ่าน ${checks} เช็ค`);
}

module.exports = {
    delay, assert, ack, bootServer, stopServer, makePlayer, setupRoom, startGame, waitFor,
    openGamePage, exitVisible, exitAndStayOut, swalText, report, getChecks: () => checks
};
