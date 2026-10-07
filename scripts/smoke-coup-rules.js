/**
 * Coup ตามกติกาจริง (Indie Boards & Cards) — ทดสอบผ่าน socket + เบราว์เซอร์มือถือ 390×844
 *
 * ครอบ:
 *   - ตั้งเวลาเลือกแอ็กชัน (coupActionSeconds) ตอนสร้างห้อง/ในห้องรอ · ค่าผิด → 60 · คนไม่ใช่หัวห้องแก้ไม่ได้ · ระหว่างเกมแก้ไม่ได้
 *   - เล่น 2 คน คนเริ่มได้ 1 เหรียญ · การ์ดคว่ำของคนอื่นไม่หลุดไปกับ state
 *   - ท่าผิดกติกาโดนปฏิเสธ (นอกตา / เหรียญไม่พอ / ขวางแทนคนอื่น)
 *   - คนหลุดออฟไลน์ช่วงท้า/ขวาง = ปล่อยผ่านหลังช่วงผ่อนผัน (ปิด: คนออนไลน์ยังต้องรอ)
 *   - ออกจากห้องกลางเกมยังทำงาน: เกมเล่นต่อ คนออกไม่อยู่ในรายชื่อ
 *   - หน้าสร้างห้อง/ห้องรอบนมือถือมีตัวเลือกเวลา (ภาพหน้าจอ)
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-coup-rules.js   (SMOKE_PORT เลือกพอร์ตได้)
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function assert(c, m) { if (!c) throw new Error(m); passed += 1; }

const SHOTS = process.env.SHOTS_DIR || path.join(require('os').tmpdir(), 'coup-rules-shots');
fs.mkdirSync(SHOTS, { recursive: true });

async function getFreePort() {
    if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env, PORT: String(port), COUP_OFFLINE_GRACE_MS: '1500',
            WALLETS_FILE: path.join(process.env.GAME_DATA_DIR || '', 'wallets.json')
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function makePlayers(base, n) {
    const players = [];
    for (let i = 0; i < n; i++) {
        const socket = await conn(base);
        const id = randomUUID();
        socket.emit('initPlayer', id);
        const states = [];
        const rooms = [];
        socket.on('coupState', s => states.push(s));
        socket.on('roomUpdate', r => rooms.push(r));
        players.push({ socket, id, states, rooms, last: () => states[states.length - 1] });
    }
    await delay(400);
    return players;
}
async function seat(players, extra = {}) {
    const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name: 'CoupRules', gameMode: 'coup', maxPlayers: 6, ...extra });
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(500);
    return roomId;
}
async function waitStarted(p) {
    for (let i = 0; i < 40; i++) {
        if (p.last()?.phase === 'action') return;
        await delay(200);
    }
    throw new Error('เกมไม่เริ่ม (phase=' + p.last()?.phase + ')');
}
const settingsOf = p => {
    const r = p.rooms[p.rooms.length - 1];
    return r?.settings || r?.room?.settings || null;
};

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({ headless: true });
    const sockets = [];

    try {
        // ===== 1. ตั้งเวลาเลือกแอ็กชัน =====
        const duo = await makePlayers(base, 2);
        sockets.push(...duo);
        const duoRoom = await seat(duo, { coupActionSeconds: 30 });
        await ack(duo[0].socket, 'updateRoom', { maxPlayers: 6 });   // ให้มี roomUpdate ที่มี settings
        await delay(300);
        assert(settingsOf(duo[0])?.coupActionSeconds === 30, 'สร้างห้องพร้อม 30 วิ ต้องเก็บไว้: ' + JSON.stringify(settingsOf(duo[0])));
        const denied = await ack(duo[1].socket, 'updateRoom', { coupActionSeconds: 90 });
        assert(!denied?.success, 'คนที่ไม่ใช่หัวห้องต้องแก้เวลาไม่ได้');
        await ack(duo[0].socket, 'updateRoom', { coupActionSeconds: 7 });
        await delay(200);
        assert(settingsOf(duo[0])?.coupActionSeconds === 60, 'ค่าผิด (7) ต้องกลายเป็น 60');
        await ack(duo[0].socket, 'updateRoom', { coupActionSeconds: 30 });
        await delay(200);
        assert(settingsOf(duo[0])?.coupActionSeconds === 30, 'หัวห้องตั้ง 30 ได้');
        console.log('1. ตั้งเวลาเลือกแอ็กชัน: สร้างห้อง/แก้ในห้องรอ · ค่าผิด→60 · คนอื่นแก้ไม่ได้ ✓');

        // ===== 2. เริ่มเกม 2 คน: เวลา 30 วิ · คนเริ่ม 1 เหรียญ · ไม่มีความลับหลุด =====
        assert((await ack(duo[0].socket, 'startGameFromLobby', { roomId: duoRoom }))?.success, 'เริ่มเกมไม่ได้');
        await waitStarted(duo[0]); await waitStarted(duo[1]);
        const v0 = duo[0].last();
        const v1 = duo[1].last();
        const left = v0.phaseEndsAt - v0.serverNow;
        assert(left > 27000 && left <= 30000, `เวลาเลือกแอ็กชันต้อง ~30 วิ (เหลือ ${left})`);
        assert(v0.isMyTurn && v0.self.coins === 1, 'เล่น 2 คน: คนเริ่ม (หัวห้อง) ได้ 1 เหรียญ: ' + v0.self.coins);
        assert(v1.self.coins === 2, 'อีกคนได้ 2 เหรียญ');
        const leak = JSON.stringify(v1.players.find(p => p.playerId === duo[0].id));
        assert(!/"influence"/.test(leak) && v1.players.every(p => p.finalHand === null), 'ห้ามส่งการ์ดคว่ำของคนอื่น: ' + leak);
        assert(!JSON.stringify(v1).includes('"deck"'), 'ห้ามส่งกองการ์ดไปให้ client');
        const midUpdate = await ack(duo[0].socket, 'updateRoom', { coupActionSeconds: 90 });
        await delay(200);
        assert(settingsOf(duo[0])?.coupActionSeconds === 30 || !midUpdate?.success, 'ระหว่างเกมต้องเปลี่ยนเวลาไม่ได้');
        console.log('2. เกม 2 คน: เวลา 30 วิ · คนเริ่ม 1 เหรียญ · การ์ดคนอื่นไม่หลุด · ระหว่างเกมแก้เวลาไม่ได้ ✓');

        // ===== 3. ท่าผิดกติกา =====
        let r = await ack(duo[1].socket, 'coup_submitAction', { actionId: 'income' });
        assert(r && r.success === false, 'นอกตาต้องโดนปฏิเสธ');
        r = await ack(duo[0].socket, 'coup_submitAction', { actionId: 'assassinate', targetPlayerId: duo[1].id });
        assert(r && r.success === false && /เหรียญไม่พอ/.test(r.error || ''), '1 เหรียญลอบสังหารไม่ได้: ' + JSON.stringify(r));
        r = await ack(duo[0].socket, 'coup_submitAction', { actionId: 'coup', targetPlayerId: duo[1].id });
        assert(r && r.success === false, '1 เหรียญรัฐประหารไม่ได้');
        console.log('3. ท่าผิดกติกาโดนปฏิเสธ (นอกตา / เหรียญไม่พอ) ✓');

        // หน้ากระดานของคนเริ่ม (มือถือ) — เห็น 1 เหรียญ + บันทึกกติกา 2 คน
        const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await ctxA.addInitScript(`try { sessionStorage.insiderPromoSeen = '1'; localStorage.setItem('ig-firstplay-coup', '1'); } catch (e) {}`);
        const board = await ctxA.newPage();
        const boardErrors = [];
        board.on('pageerror', e => boardErrors.push(e.message));
        duo[0].socket.close();
        await board.goto(`${base}/?playerId=${duo[0].id}`, { waitUntil: 'domcontentloaded' });
        await board.goto(`${base}/game/${duoRoom}?playerId=${duo[0].id}`, { waitUntil: 'networkidle' });
        await delay(1200);
        assert((await board.textContent('#myCoins')).trim() === '1', 'กระดานต้องโชว์ 1 เหรียญ');
        await board.screenshot({ path: path.join(SHOTS, 'coup-2p-start.png') });
        assert(boardErrors.length === 0, 'JS error บนกระดาน: ' + boardErrors.join(' | '));
        console.log('4. กระดานมือถือ: คนเริ่มเห็น 1 เหรียญ ✓');
        await ctxA.close();

        // ===== 5. ออฟไลน์ช่วงท้า/ขวาง =====
        const trio = await makePlayers(base, 3);
        sockets.push(...trio);
        const trioRoom = await seat(trio);
        assert((await ack(trio[0].socket, 'startGameFromLobby', { roomId: trioRoom }))?.success, 'เริ่มเกม 3 คนไม่ได้');
        await waitStarted(trio[0]); await waitStarted(trio[2]);
        assert(trio[0].last().isMyTurn, 'หัวห้องเริ่มก่อน');
        assert((await ack(trio[0].socket, 'coup_submitAction', { actionId: 'tax' }))?.success, 'ประกาศเก็บภาษีไม่ได้');
        await delay(300);
        // OFF: ทุกคนออนไลน์ → ยังต้องรอ (ไม่มีใครถูกนับผ่านเอง)
        await delay(2200);
        assert(trio[0].last().phase === 'respond' && trio[0].last().pendingAction.waitingFor.length === 2, 'ทุกคนออนไลน์ ต้องรอทุกคนตอบ');
        // ON: p2 หลุด → หลังผ่อนผัน 1.5 วิ ถือว่าผ่าน
        trio[2].socket.close();
        await delay(600);
        assert(trio[0].last().pendingAction?.waitingFor?.includes(trio[2].id), 'ยังอยู่ในช่วงผ่อนผัน — ต้องยังรอ p2');
        await delay(1800);
        const afterOffline = trio[0].last();
        assert(afterOffline.phase === 'respond' && !afterOffline.pendingAction.waitingFor.includes(trio[2].id), 'หลุดเกินช่วงผ่อนผัน ต้องถูกนับว่าผ่าน');
        assert(afterOffline.history.some(h => /ออฟไลน์ — ถือว่าปล่อยผ่าน/.test(h.text)), 'บันทึกเกมต้องบอกว่าออฟไลน์ถือว่าผ่าน');
        const t0 = Date.now();
        await ack(trio[1].socket, 'coup_respond', { response: 'pass' });
        await delay(400);
        const resolved = trio[0].last();
        assert(resolved.phase === 'action' && resolved.self.coins === 5 && Date.now() - t0 < 2000, 'คนออนไลน์ผ่านครบ → ไปต่อทันที ไม่รอ 20 วิ');
        console.log('5. ออฟไลน์ช่วงท้า/ขวาง: ผ่อนผัน 1.5 วิแล้วถือว่าผ่าน · คนออนไลน์ยังต้องตอบเอง ✓');

        // ออฟไลน์ช่วง block-respond: p1 (ตานี้) ขอเงินช่วยเหลือ, p0 ขวางด้วยดยุค, p2 ออฟไลน์อยู่แล้ว
        assert((await ack(trio[1].socket, 'coup_submitAction', { actionId: 'foreign_aid' }))?.success, 'p1 ขอเงินช่วยเหลือไม่ได้');
        await delay(300);
        const fa = trio[0].last();
        assert(fa.phase === 'respond' && !fa.pendingAction.waitingFor.includes(trio[2].id), 'คนที่ออฟไลน์อยู่แล้วต้องถูกนับผ่านทันทีเมื่อเปิดช่วงตอบใหม่');
        r = await ack(trio[0].socket, 'coup_respond', { response: 'block', claimCard: 'contessa', step: fa.step, phase: fa.phase, turnNumber: fa.turnNumber });
        assert(r && r.success === false, 'ขวางเงินช่วยเหลือด้วยท่านหญิงต้องไม่ได้');
        r = await ack(trio[0].socket, 'coup_respond', { response: 'block', claimCard: 'duke', step: fa.step, phase: fa.phase, turnNumber: fa.turnNumber });
        assert(r?.success, 'ขวางด้วยดยุคไม่ได้: ' + JSON.stringify(r));
        await delay(300);
        const br = trio[1].last();
        assert(br.phase === 'block-respond' && br.pendingBlock.waitingFor.length === 1 && br.pendingBlock.waitingFor[0] === trio[1].id,
            'ช่วงท้าการขวาง: p2 ออฟไลน์ถูกนับผ่าน เหลือรอ p1 คนเดียว');
        await ack(trio[1].socket, 'coup_respond', { response: 'pass' });
        await delay(300);
        assert(trio[1].last().phase === 'action' && trio[1].last().self.coins === 2, 'ยอมรับการขวาง → ไม่ได้เงิน');
        console.log('6. ช่วงท้าการขวางก็ข้ามคนออฟไลน์ · ขวางผิดการ์ดโดนปฏิเสธ ✓');

        // ===== 7. ออกจากห้องกลางเกมยังทำงานกับกติกาใหม่ =====
        // ตอนนี้ตา p2 (ออฟไลน์) — p0 (หัวห้อง) ออกจากห้องจริงกลางเกม
        const left0 = await ack(trio[0].socket, 'leaveRoom', { roomId: trioRoom, playerId: trio[0].id });
        assert(left0?.success, 'leaveRoom ต้อง ack สำเร็จ');
        await delay(800);
        const v = trio[1].last();
        const gone = v.players.find(p => p.playerId === trio[0].id);
        assert(!gone || (!gone.alive && gone.coins === 0), 'คนออกต้องไม่อยู่ในเกม (หรือตกรอบ เหรียญคืนคลัง): ' + JSON.stringify(gone));
        assert(v.history.some(h => /ออกจากเกม/.test(h.text)), 'บันทึกเกมต้องบอกว่ามีคนออก');
        const roomNow = trio[1].rooms[trio[1].rooms.length - 1];
        const ids = (roomNow?.players || roomNow?.room?.players || []).map(p => p.playerId);
        assert(ids.length && !ids.includes(trio[0].id), 'คนออกต้องไม่อยู่ในรายชื่อห้อง: ' + ids.join(','));
        assert(v.phase !== 'finished' && v.players.filter(p => p.alive).length === 2, 'เกมเล่นต่อได้ 2 คน');
        console.log('7. ออกจากห้องกลางเกม: ตกรอบ · หายจากรายชื่อ · เกมเล่นต่อ ✓');

        // ===== 8. หน้าสร้างห้อง + ห้องรอบนมือถือ =====
        const host = (await makePlayers(base, 1))[0];
        sockets.push(host);
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await ctx.addInitScript(`try { sessionStorage.insiderPromoSeen = '1'; } catch (e) {}`);
        const page = await ctx.newPage();
        const jsErrors = [];
        page.on('pageerror', e => jsErrors.push(e.message));
        host.socket.close();
        await page.goto(`${base}/?playerId=${host.id}`, { waitUntil: 'domcontentloaded' });
        await page.goto(`${base}/rooms?playerId=${host.id}`, { waitUntil: 'networkidle' });
        await delay(800);
        await page.click('#createRoomBtn');
        await page.waitForSelector('.mode-quick-card[data-mode-id="coup"]', { timeout: 8000 });
        await page.click('.mode-quick-card[data-mode-id="coup"]');
        await delay(700);
        assert(await page.isVisible('#coupActionSeconds'), 'ฟอร์มสร้างห้อง Coup ต้องมีตัวเลือกเวลาเลือกแอ็กชัน');
        assert(!(await page.isVisible('#createRoundTimeGroup')), 'สไลเดอร์เวลา (นาที) ที่ไม่มีผลกับ Coup ต้องซ่อน');
        const opts = await page.$$eval('#coupActionSeconds option', els => els.map(e => e.value + (e.selected ? '*' : '')));
        assert(opts.join() === '30,60*,90', 'ตัวเลือก 30/60/90 ค่าเริ่ม 60: ' + opts.join());
        await page.selectOption('#coupActionSeconds', '90');
        await page.$eval('#coupActionSeconds', el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: path.join(SHOTS, 'coup-create-form.png') });
        await page.click('.swal2-confirm');
        await page.waitForURL(/\/room\//, { timeout: 10000 });
        await delay(1500);
        assert(await page.isVisible('#cpLobbyActionSeconds'), 'ห้องรอต้องมีตัวเลือกเวลา');
        assert(await page.$eval('#cpLobbyActionSeconds', el => el.value) === '90', 'ห้องที่สร้างด้วย 90 วิ ต้องแสดง 90');
        assert(!(await page.$eval('#cpLobbyActionSeconds', el => el.disabled)), 'หัวห้องต้องแก้ได้');
        await page.selectOption('#cpLobbyActionSeconds', '30');
        await delay(900);
        assert(await page.$eval('#cpLobbyActionSeconds', el => el.value) === '30', 'เปลี่ยนเป็น 30 แล้วต้องค้างที่ 30 หลัง roomUpdate');
        const box = await page.$eval('#cpLobbyActionSeconds', el => { const r = el.getBoundingClientRect(); return { h: r.height, right: r.right }; });
        assert(box.h >= 44 && box.right <= 390, 'ตัวเลือกต้องแตะง่าย (≥44px) และไม่ล้นจอ: ' + JSON.stringify(box));
        await page.$eval('#cpLobbyActionSeconds', el => el.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: path.join(SHOTS, 'coup-lobby-setting.png') });
        const roomUrl = page.url();
        const lobbyRoomId = (roomUrl.match(/\/room\/([^/?#]+)/) || [])[1];

        // คนที่ไม่ใช่หัวห้องเห็นแต่แก้ไม่ได้
        const guest = (await makePlayers(base, 1))[0];
        sockets.push(guest);
        assert((await ack(guest.socket, 'joinRoom', { roomId: lobbyRoomId, playerId: guest.id }))?.success, 'guest join ไม่ได้');
        guest.socket.close();
        const gctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await gctx.addInitScript(`try { sessionStorage.insiderPromoSeen = '1'; } catch (e) {}`);
        const gpage = await gctx.newPage();
        gpage.on('pageerror', e => jsErrors.push('guest: ' + e.message));
        await gpage.goto(`${base}/?playerId=${guest.id}`, { waitUntil: 'domcontentloaded' });
        await gpage.goto(`${base}/room/${lobbyRoomId}?playerId=${guest.id}`, { waitUntil: 'networkidle' });
        await delay(1200);
        assert(await gpage.$eval('#cpLobbyActionSeconds', el => el.disabled && el.value === '30'), 'คนอื่นเห็นค่า 30 แต่แก้ไม่ได้');
        await gpage.$eval('#cpLobbyActionSeconds', el => el.scrollIntoView({ block: 'center' }));
        await gpage.screenshot({ path: path.join(SHOTS, 'coup-lobby-guest.png') });
        assert(jsErrors.length === 0, 'JS error: ' + jsErrors.join(' | '));
        console.log('8. มือถือ: ฟอร์มสร้างห้องมีเวลา 30/60/90 (ซ่อนสไลเดอร์นาที) · ห้องรอหัวห้องแก้ได้ คนอื่นแก้ไม่ได้ ✓');
        await ctx.close(); await gctx.close();

        console.log(`\n✅ COUP RULES ผ่านทั้งหมด (${passed} assertions) · ภาพหน้าจอ: ${SHOTS}`);
    } finally {
        sockets.forEach(p => { try { p.socket.close(); } catch {} });
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
