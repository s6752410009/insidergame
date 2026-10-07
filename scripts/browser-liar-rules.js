/**
 * ไพ่โกหก — ตั้งกติกาในห้องรอ + จอเกมโหมดปืน/ปีศาจ บนมือถือ 390×844
 *   1. สร้างห้องพร้อมกติกา (หัวใจ + ปีศาจ) · ค่าแปลก ๆ ถูกปรับ · หัวห้องเปลี่ยนในห้องรอได้ คนอื่นไม่ได้
 *   2. ห้องรอ: เห็นตัวเลือกกติกา หัวห้องเปลี่ยนผ่าน UI ได้
 *   3. จอเกม (ปืน + ปีศาจ): ทุกที่นั่งมีปืน 6 ช่อง · ไม่เลื่อนแนวนอน · ป้ายมีปีศาจ
 *   4. โดนท้า → ป้าย "ลั่นไก…" แล้ว "แชะ/ปัง" · นัดที่ยิงขึ้นบนที่นั่ง · ห้ามเปลี่ยนกติกากลางเกม
 *   5. ฟอร์มสร้างห้องมีตัวเลือกกติกา
 *   6. ออกกลางเกมผ่านเซิร์ฟเวอร์จริง: ตาเดินทันที · คนออก = ตกรอบ · กลับเข้าไม่ได้ · เหลือคนเดียวชนะ
 *
 * รัน: node scripts/browser-liar-rules.js
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

async function getFreePort() {
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
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
function browserLaunchOptions() {
    const configured = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (configured) return { executablePath: configured };
    if (fs.existsSync(systemChrome)) return { executablePath: systemChrome };
    return {};
}
const last = list => list[list.length - 1];
async function waitFor(fn, ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = await fn();
        if (v) return v;
        await delay(80);
    }
    throw new Error('รอไม่ถึง: ' + label);
}

(async () => {
    const port = Number(process.env.SMOKE_PORT) || await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(browserLaunchOptions());
    const shots = process.env.LIAR_SHOT_DIR || null;

    try {
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            const rooms = [];
            socket.on('liarState', s => states.push(s));
            socket.on('roomUpdate', r => rooms.push(r));
            players.push({ socket, id, states, rooms });
        }
        await delay(500);
        const [host, guest, third] = players;

        // ---------- 1. สร้างห้อง + ตั้งค่า ----------
        const created = await ack(host.socket, 'createRoom', {
            playerId: host.id, name: 'LiarRules', gameMode: 'liar', maxPlayers: 6, liarPunishment: 'lives', liarDevil: true
        });
        assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        host.socket.emit('setRoom', { roomId, playerId: host.id });
        for (const p of [guest, third]) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(500);
        const settingsOf = async () => {
            const res = await fetch(`${base}/api/rooms`);
            const body = await res.json().catch(() => null);
            const list = Array.isArray(body) ? body : (body && (body.rooms || body.data)) || [];
            return (list.find(r => r.roomId === roomId) || {}).settings || null;
        };
        let st = last(guest.rooms)?.settings || await settingsOf();
        assert(st && st.liarPunishment === 'lives' && st.liarDevil === true, '1: สร้างห้องพร้อมกติกา หัวใจ + ปีศาจ: ' + JSON.stringify(st));
        let r = await ack(host.socket, 'updateRoom', { liarPunishment: 'banana', liarDevil: 'yes' });
        assert(r?.success, '1: หัวห้องอัปเดตได้');
        await delay(250);
        st = last(guest.rooms)?.settings;
        assert(st.liarPunishment === 'revolver' && st.liarDevil === false, '1: ค่าแปลก ๆ ถูกปรับเป็นค่าเริ่มต้น (ปืน / ไม่มีปีศาจ): ' + JSON.stringify(st));
        r = await ack(guest.socket, 'updateRoom', { liarPunishment: 'lives' });
        await delay(250);
        assert(last(host.rooms)?.settings?.liarPunishment === 'revolver', '1: คนที่ไม่ใช่หัวห้องเปลี่ยนกติกาไม่ได้');
        console.log('1. สร้างห้องพร้อมกติกา · ค่าแปลกถูกปรับ · เฉพาะหัวห้องเปลี่ยนได้ ✓');

        // ---------- 2. ห้องรอ UI ----------
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        await ctx.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; localStorage.setItem('ig-firstplay-liar', '1'); } catch (e) {} });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !/mp3|favicon|autoplay|vibrate|ERR_|404/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 140)); });
        host.socket.close();
        await page.goto(`${base}/room/${roomId}?playerId=${host.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#lrLobbyPunish', { timeout: 8000 });
        assert(await page.$eval('#lrLobbyPunish', el => el.value) === 'revolver', '2: ห้องรอโชว์กติกาปัจจุบัน (ปืน)');
        await page.selectOption('#lrLobbyPunish', 'lives');
        await waitFor(() => last(guest.rooms)?.settings?.liarPunishment === 'lives', 4000, 'เปลี่ยนเป็นหัวใจผ่าน UI');
        await page.selectOption('#lrLobbyPunish', 'revolver');
        await waitFor(() => last(guest.rooms)?.settings?.liarPunishment === 'revolver', 4000, 'เปลี่ยนกลับเป็นปืน');
        await page.waitForSelector('#lrLobbyDevil:not([disabled])', { timeout: 4000 });
        await page.click('#lrLobbyDevil');
        await waitFor(() => last(guest.rooms)?.settings?.liarDevil === true, 4000, 'เปิดไพ่ปีศาจผ่าน UI');
        await page.waitForFunction(() => document.getElementById('lrLobbyDevil')?.getAttribute('aria-pressed') === 'true', null, { timeout: 4000 });
        const lobbyGeo = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth }));
        assert(lobbyGeo.sw <= lobbyGeo.w + 1, '2: ห้องรอห้ามเลื่อนแนวนอน ' + JSON.stringify(lobbyGeo));
        if (shots) await page.screenshot({ path: path.join(shots, 'liar-lobby.png'), fullPage: false });
        console.log('2. ห้องรอ: เห็น/เปลี่ยนกติกา (ปืน↔หัวใจ, ปีศาจ) ผ่าน UI ✓');

        // ---------- 3. จอเกม ----------
        const guestStart = await ack(guest.socket, 'startGameFromLobby', { roomId });
        assert(guestStart && guestStart.success === false, '3: คนที่ไม่ใช่หัวห้องเริ่มเกมไม่ได้');
        await page.waitForSelector('#btnStartGameLobby:not([disabled])', { timeout: 6000 });
        await page.click('#btnStartGameLobby');
        await waitFor(() => last(guest.states)?.phase === 'turn', 8000, 'หัวห้องกดเปิดเกมในห้องรอ');
        await page.waitForURL(new RegExp(`/game/${roomId}`), { timeout: 10000 }).catch(() => page.goto(`${base}/game/${roomId}?playerId=${host.id}`, { waitUntil: 'networkidle' }));
        await page.waitForSelector('#myHand .lr-playing', { timeout: 10000 });
        await delay(600);
        const view = last(guest.states);
        assert(view.punishment === 'revolver' && view.devilMode === true && view.devilActive === true, '3: เกมใช้กติกาจากห้องรอ (ปืน + ปีศาจ)');
        const ui = await page.evaluate(() => ({
            guns: document.querySelectorAll('#lrOpponents .lr-gun').length,
            pips: document.querySelectorAll('#lrOpponents .lr-seat:first-child .lr-gun-pip').length,
            mine: !!document.querySelector('#myLives .lr-gun'),
            hearts: document.querySelectorAll('.lr-hearts').length,
            kicker: document.querySelector('.lr-kicker')?.textContent || '',
            devilTag: !!document.querySelector('#targetRank .lr-devil-tag'),
            w: innerWidth, sw: document.documentElement.scrollWidth,
            felt: document.querySelector('.lr-felt').getBoundingClientRect().right
        }));
        assert(ui.guns === 2 && ui.pips === 6 && ui.mine, '3: ทุกที่นั่ง + ตัวเองมีปืน 6 ช่อง ' + JSON.stringify(ui));
        assert(ui.hearts === 0, '3: โหมดปืนไม่โชว์หัวใจ');
        assert(/🔫/.test(ui.kicker) && /รอดคนสุดท้าย/.test(ui.kicker), '3: หัวจอบอกว่ารอดคนสุดท้ายชนะ (ปืน): ' + ui.kicker);
        assert(ui.devilTag, '3: ไพ่บนโต๊ะมีป้าย 😈 มีปีศาจ');
        assert(ui.sw <= ui.w + 1 && ui.felt <= ui.w + 1, '3: จอเกมห้ามเลื่อนแนวนอน ' + JSON.stringify(ui));
        const midGame = await ack(guest.socket, 'updateRoom', { liarPunishment: 'lives' });
        await delay(200);
        const helperView = last(guest.rooms)?.settings;
        assert(!helperView || helperView.liarPunishment === 'revolver' || midGame?.success === false, '3: เปลี่ยนกติกากลางเกมไม่ได้');
        if (shots) await page.screenshot({ path: path.join(shots, 'liar-board-gun.png') });
        console.log('3. จอเกม: ปืน 6 ช่องทุกที่นั่ง · ป้ายปีศาจ · ไม่เลื่อนแนวนอนที่ 390px ✓');

        // ---------- 4. ท้า → ลั่นไก ----------
        const sockets = { [guest.id]: guest, [third.id]: third };
        const banners = [];
        await page.exposeFunction('__lrBanner', t => banners.push(t));
        await page.evaluate(() => {
            const node = document.getElementById('lrBanner');
            new MutationObserver(() => window.__lrBanner(node.textContent)).observe(node, { childList: true, characterData: true, subtree: true });
        });
        let revealSeen = null;
        for (let guard = 0; guard < 30 && !revealSeen; guard += 1) {
            const s = last(guest.states);
            if (s.phase === 'finished') break;
            if (s.currentPlayerId === host.id) {
                const btn = await page.$('#lrPlayBtn:not([disabled])');
                if (btn) await btn.click();
                else { const c = await page.$('#lrChallengeBtn'); if (c) await c.click(); }
            } else {
                const actor = sockets[s.currentPlayerId];
                const v = last(actor.states);
                if (v.availableActions?.canChallenge) await ack(actor.socket, 'liar_challenge', {});
                else await ack(actor.socket, 'liar_play', { cardIds: [v.self.hand.find(c => c.id !== 'DEVIL')?.id || v.self.hand[0].id] });
            }
            await delay(500);
            const after = last(guest.states);
            if (after.lastReveal && after.lastReveal.results && after.lastReveal.results.length) revealSeen = after;
        }
        assert(revealSeen, '4: ต้องมีการท้าแล้วหงายไพ่');
        await waitFor(() => banners.some(t => /ลั่นไก/.test(t)), 5000, 'ป้ายลั่นไก');
        await waitFor(() => banners.some(t => /แชะ|ปัง/.test(t)), 6000, 'ป้ายแชะ/ปัง');
        const result = revealSeen.lastReveal.results[0];
        assert(result.shots === 1, '4: ยิงนัดแรก');
        await delay(400);
        const seatInfo = await page.evaluate(id => {
            if (!document.querySelector('[data-seat-id="' + id + '"]')) return { self: true, used: document.querySelectorAll('#myLives .lr-gun-pip.is-used').length, dead: !!document.querySelector('#myLives .lr-gun.is-dead') };
            const seat = document.querySelector('[data-seat-id="' + id + '"]');
            return { used: seat.querySelectorAll('.lr-gun-pip.is-used').length, dead: !!seat.querySelector('.lr-gun.is-dead') };
        }, result.playerId);
        assert(result.died ? seatInfo.dead : seatInfo.used === 1, '4: ที่นั่งคนโดนยิงขึ้นนัดที่ยิง/ตกรอบ ' + JSON.stringify({ seatInfo, result }));
        const verdict = await page.textContent('#lrPileCaption');
        assert(/แชะ|ปัง|ปีศาจ/.test(verdict), '4: ผลบนโต๊ะบอกผลลั่นไก: ' + verdict);
        if (shots) await page.screenshot({ path: path.join(shots, 'liar-board-reveal.png') });
        assert(errors.length === 0, 'มี JS error: ' + errors.slice(0, 3).join(' | '));
        console.log('4. ท้า → "ลั่นไก…" → "แชะ/ปัง" · ที่นั่งขึ้นนัดที่ยิง · ผลบนโต๊ะ ✓');

        // ---------- 5. หน้าสร้างห้องมีตัวเลือกกติกา ----------
        // คนนอกห้อง (คนในเกมถูกพาเข้าเกมแทน)
        const outsider = await conn(base);
        const outsiderId = randomUUID();
        outsider.emit('initPlayer', outsiderId);
        await delay(400);
        const outCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const outPage = await outCtx.newPage();
        await outPage.goto(`${base}/rooms?playerId=${outsiderId}`, { waitUntil: 'domcontentloaded' });
        await delay(800);
        const html = await outPage.content();
        const formUrl = outPage.url();
        await outCtx.close();
        outsider.close();
        assert(/liarSettingsGroup/.test(html) && /liarPunishment/.test(html) && /liarDevil/.test(html), '5: ฟอร์มสร้างห้องมีกติกาไพ่โกหก (' + formUrl + ' setthi=' + /setthiSettingsGroup/.test(html) + ')');
        console.log('5. ฟอร์มสร้างห้องมีตัวเลือก ปืน/หัวใจ + ไพ่ปีศาจ ✓');

        // ---------- 6. ออกกลางเกมผ่านเซิร์ฟเวอร์จริง ----------
        {
            const crew = [];
            for (let i = 0; i < 3; i++) {
                const socket = await conn(base);
                const id = randomUUID();
                socket.emit('initPlayer', id);
                const states = [];
                socket.on('liarState', s => states.push(s));
                crew.push({ socket, id, states });
            }
            await delay(400);
            const made = await ack(crew[0].socket, 'createRoom', { playerId: crew[0].id, name: 'LiarLeave', gameMode: 'liar', maxPlayers: 4 });
            assert(made?.success, '6: สร้างห้องไม่ได้');
            crew[0].socket.emit('setRoom', { roomId: made.roomId, playerId: crew[0].id });
            for (const p of crew.slice(1)) {
                assert((await ack(p.socket, 'joinRoom', { roomId: made.roomId, playerId: p.id }))?.success, '6: join ไม่ได้');
                p.socket.emit('setRoom', { roomId: made.roomId, playerId: p.id });
            }
            await delay(400);
            assert((await ack(crew[0].socket, 'startGameFromLobby', { roomId: made.roomId }))?.success, '6: เริ่มเกมไม่ได้');
            await waitFor(() => last(crew[1].states)?.phase === 'turn', 6000, 'เกมออกเริ่ม');
            const before = last(crew[1].states);
            const leaver = crew.find(p => p.id === before.currentPlayerId);
            const stayers = crew.filter(p => p !== leaver);
            await ack(leaver.socket, 'leaveRoom', { roomId: made.roomId, playerId: leaver.id });
            const after = await waitFor(() => {
                const s = last(stayers[0].states);
                return s && s.turnNumber > before.turnNumber ? s : null;
            }, 4000, 'คนที่ถึงตาออก → ตาเดินทันที (ไม่ต้องรอหมดเวลา)');
            assert(after.currentPlayerId !== leaver.id, '6: ตาไม่ค้างที่คนออก');
            const ghost = after.players.find(p => p.playerId === leaver.id);
            assert(ghost && ghost.alive === false, '6: คนอื่นเห็นคนออกเป็นตกรอบ');
            assert(after.eliminations.some(e => e.playerId === leaver.id && e.reason === 'left'), '6: บันทึกเหตุผล ออกจากเกม');
            const back = await ack(leaver.socket, 'joinRoom', { roomId: made.roomId, playerId: leaver.id });
            assert(!back || back.success === false, '6: ออกแล้วกลับเข้าเกมเดิมไม่ได้ (ไม่ฟื้นพร้อมไพ่เดิม)');
            await ack(stayers[1].socket, 'leaveRoom', { roomId: made.roomId, playerId: stayers[1].id });
            const done = await waitFor(() => last(stayers[0].states)?.phase === 'finished' ? last(stayers[0].states) : null, 4000, 'เหลือคนเดียว = จบเกม');
            assert(done.winner.playerId === stayers[0].id, '6: คนที่เหลือชนะทันที');
            crew.forEach(p => { try { p.socket.close(); } catch {} });
            console.log('6. ออกกลางเกม (เซิร์ฟเวอร์จริง): ตาเดินทันที · คนออก = ตกรอบ · กลับเข้าไม่ได้ · เหลือคนเดียวชนะ ✓');
        }

        await ctx.close();
        players.forEach(p => { try { p.socket.close(); } catch {} });
        console.log(`\n✅ browser-liar-rules: ${passed} asserts passed`);
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
