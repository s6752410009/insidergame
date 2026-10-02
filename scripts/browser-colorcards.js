/**
 * ไพ่ทิ้งสีในเบราว์เซอร์จริง: 3 คน (390×844) เล่นผ่าน UI จนจบเกม + ภาพ 1280×900
 * ตรวจ: ไม่มี page error / console error · ไม่มี scroll แนวนอน · ไม่มีข้อความล้นจอ · แตะ/ปัดขึ้นลงไพ่ได้
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
    page.on('requestfailed', r => { if (!IGNORE.test(r.url())) errors.push('requestfailed: ' + r.url()); });
    await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/game/${roomId}?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ccHand .cc-card', { timeout: 15000 });
    await page.waitForTimeout(500);
    return { context, page, errors, label, id };
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
        const created = await ack(sockets[0], 'createRoom', { playerId: ids[0], name: 'ไพ่ทิ้งสี', gameMode: 'colorcards', maxPlayers: 6, colorcardsTarget: 0 });
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
        await delay(600);
        await lobby.screenshot({ path: path.join(SHOTS, 'lobby-390.png'), fullPage: true });
        assert(!lobbyErrors.length, 'ห้องรอมี error: ' + lobbyErrors.join(' | '));
        await lobby.goto(`${base}/rooms?playerId=${lobbyHost}`, { waitUntil: 'networkidle' });
        await lobby.screenshot({ path: path.join(SHOTS, 'rooms-390.png'), fullPage: false });
        assert(!lobbyErrors.length, 'หน้ารายชื่อห้องมี error: ' + lobbyErrors.join(' | '));
        await lobbyCtx.close();
        console.log('1. ห้องรอ: ตั้งค่า/เพิ่มบอท/วิธีเล่น · หน้ารายชื่อห้องไม่มี error ✓');

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
        const bigTurn = await (async () => { for (const p of players) if (await isMyTurn(p.page)) return p; return players[0]; })();
        await bigTurn.page.screenshot({ path: path.join(SHOTS, 'bighand-myturn-390.png') });
        // เลือกไพ่ (ยกขึ้น) แล้วถ่าย
        const sel = bigTurn.page.locator('#ccHand .cc-card.is-playable').first();
        if (await sel.count()) {
            await sel.scrollIntoViewIfNeeded();
            await sel.click({ position: { x: 12, y: 40 } });
            await delay(300);
            await bigTurn.page.screenshot({ path: path.join(SHOTS, 'bighand-selected-390.png') });
        }
        console.log(`3. มือใหญ่ ${big.join('/')} ใบ เลื่อนได้ ไม่ล้นจอ ✓`);

        // เล่นจริงจนจบ: ปัดขึ้น 1 ครั้ง · ถ่ายตัวเลือกสี · ลืมบอกเหลือใบเดียวครั้งแรก (ให้คนอื่นจับ)
        let swiped = false;
        let pickerShot = false;
        let forgot = false;
        let catchShot = false;
        let actions = { play: 0, swipe: 0, draw: 0, pass: 0, catch: 0, 'play-drawn': 0 };
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
                    swipe: !swiped,
                    forgetCall,
                    onPicker: pickerShot ? null : async page => {
                        await delay(250);
                        await page.screenshot({ path: path.join(SHOTS, 'picker-390.png') });
                        pickerShot = true;
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
        assert(actions.play + actions.swipe + actions['play-drawn'] > 10, 'ลงไพ่ผ่าน UI ได้หลายใบ');
        await delay(700);
        for (const p of players) {
            assert(await p.page.locator('#ccSheet.is-on').isVisible(), `${p.label} เห็นสรุปผล`);
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} (สรุป) layout: ${probs.join(' | ')}`);
        }
        await players[0].page.screenshot({ path: path.join(SHOTS, 'finished-390.png') });
        const winnerTitle = await players[0].page.locator('#ccSheetTitle').textContent();
        assert(/ชนะ/.test(winnerTitle), 'สรุปผลบอกผู้ชนะ');
        assert(await players[0].page.locator('#ccBackBtn').isVisible(), 'มีปุ่มกลับห้องรอ/เล่นอีกตา');
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
        const deskProbs = await layoutProblems(desk.page);
        assert(!deskProbs.length, 'desktop layout: ' + deskProbs.join(' | '));
        console.log('5. 1280×900 ไม่ล้นจอ ✓');

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
