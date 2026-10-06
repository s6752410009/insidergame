/**
 * เล่นโกหกจนจบในเบราว์เซอร์จริง — ตรวจ UI / รูปไพ่ / socket
 *
 * รัน: node scripts/smoke-liar-play.js
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }

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

(async () => {
    const port = Number(process.env.SMOKE_PORT) || await getFreePort();
    // บอทเร็วขึ้นเฉพาะในเทส (ของจริง 1.6–2.6 วิ)
    process.env.LIAR_BOT_MS = process.env.LIAR_BOT_MS || '120';
    process.env.LIAR_BOT_REVEAL_MS = process.env.LIAR_BOT_REVEAL_MS || '200';
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(browserLaunchOptions());

    try {
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('liarState', s => states.push(s));
            players.push({ socket, id, states });
        }
        await delay(500);

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'LiarPlay', gameMode: 'liar', maxPlayers: 8
        });
        assert(created?.success, 'สร้างห้องโกหกไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(700);
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await delay(3500);
        console.log('1. ตั้งห้องโกหก 3 คน เริ่มเกมแล้ว ✓');

        players[0].socket.close();
        const hostContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        await hostContext.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; localStorage.setItem('ig-firstplay-liar', '1'); } catch (e) {} });
        const page = await hostContext.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !/mp3|favicon|autoplay|vibrate/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 120)); });
        await page.goto(`${base}/game/${roomId}?playerId=${players[0].id}`, { waitUntil: 'networkidle' });
        await delay(2500);

        const nowText = await page.textContent('#lrNowCopy');
        assert(/ตาคุณ|ลงไพ่|ไพ่รอบนี้/.test(nowText), 'แถบสถานะต้องบอกตาเล่น (ได้: ' + nowText + ')');
        const handCount = await page.$$eval('#myHand .lr-playing', els => els.length);
        assert(handCount === 5, `ต้องเห็นไพ่ในมือ 5 ใบ (ได้ ${handCount})`);
        const playBtn = await page.$('#lrPlayBtn');
        assert(playBtn, 'ต้องมีปุ่มลงไพ่');
        const disabled = await playBtn.getAttribute('disabled');
        assert(!disabled, 'ปุ่มลงไพ่ต้องกดได้ทันที (เลือกไพ่ใบแรกให้อัตโนมัติ)');
        const mobileGeometry = await page.evaluate(() => ({
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            felt: (() => { const r = document.querySelector('.lr-felt').getBoundingClientRect(); return { left: r.left, right: r.right }; })(),
            dock: (() => { const r = document.querySelector('.lr-hand-dock').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; })()
        }));
        assert(mobileGeometry.scrollWidth <= mobileGeometry.width + 1, 'จอมือถือห้ามเลื่อนแนวนอน: ' + JSON.stringify(mobileGeometry));
        assert(mobileGeometry.felt.left >= -1 && mobileGeometry.felt.right <= mobileGeometry.width + 1, 'โต๊ะไพ่หลุดจอมือถือ');
        assert(mobileGeometry.dock.left >= -1 && mobileGeometry.dock.right <= mobileGeometry.width + 1, 'ไพ่ในมือหลุดจอมือถือ');
        console.log('2. เห็นไพ่ 5 ใบ และปุ่มลงไพ่พร้อมกด ✓');

        // UX: มือ + ปุ่มลงไพ่ต้องอยู่ในจอโดยไม่ต้องเลื่อน (เดิมอยู่ใต้ขอบจอ 390×844)
        const fold = await page.evaluate(() => {
            const btn = document.getElementById('lrPlayBtn').getBoundingClientRect();
            const card = document.querySelector('#myHand .lr-playing').getBoundingClientRect();
            const chat = document.getElementById('toggleChat').getBoundingClientRect();
            return { h: innerHeight, btnBottom: btn.bottom, cardTop: card.top, chatBottom: chat.bottom, chatOverBtn: !(chat.bottom <= btn.top || chat.top >= btn.bottom || chat.right <= btn.left || chat.left >= btn.right) };
        });
        assert(fold.btnBottom <= fold.h && fold.cardTop >= 0, 'ไพ่ในมือ/ปุ่มลงไพ่ต้องอยู่ในจอไม่ต้องเลื่อน: ' + JSON.stringify(fold));
        assert(!fold.chatOverBtn && fold.chatBottom <= fold.cardTop + 4, 'ปุ่มแชทห้ามทับไพ่ในมือ/ปุ่มลงไพ่: ' + JSON.stringify(fold));
        // UX: แตะใบที่ 3 ครั้งแรก = เลือกใบนั้นแทนใบที่ระบบเลือกให้ (เดิมกลายเป็น 2 ใบ)
        await page.click('#myHand .lr-playing:nth-child(3)');
        await delay(200);
        const picked = await page.$$eval('#myHand .lr-playing.is-selected', els => els.map(el => el.getAttribute('data-hand-key')));
        assert(picked.length === 1 && /:2$/.test(picked[0]), 'แตะใบที่ 3 ต้องเลือกแค่ใบนั้น: ' + JSON.stringify(picked));
        const target = players[1].states[players[1].states.length - 1].targetRank.thaiName;
        const claimText = await page.textContent('.lr-claim');
        const playText = await page.textContent('#lrPlayBtn');
        assert(claimText.includes(target) && playText.includes(target) && /1 ใบ/.test(playText), 'ปุ่ม/บรรทัดอ้างต้องบอกจำนวนและไพ่ที่อ้าง: ' + claimText + ' | ' + playText);
        assert(/ของจริง|โกหก/.test(claimText), 'ต้องบอกว่าที่เลือกเป็นของจริงหรือโกหก: ' + claimText);
        console.log('2b. มือ+ปุ่มอยู่ในจอ · แตะใบที่ 3 แทนใบที่เลือกให้ · ปุ่มบอก "ลง 1 ใบ · บอกว่า' + target + '" ✓');

        await page.click('#lrPlayBtn');
        await delay(1500);
        const afterPlay = players[1].states[players[1].states.length - 1];
        assert(afterPlay?.lastPlay?.count >= 1, 'กดลงไพ่แล้วต้องมีไพ่บนโต๊ะ');
        assert(afterPlay.lastPlay.count === 1, 'ต้องลง 1 ใบตามที่เลือก (ได้ ' + afterPlay.lastPlay.count + ')');
        const caption = await page.textContent('#lrPileCaption');
        assert(/คุณ ลง 1 ใบ/.test(caption) && caption.includes(target), 'ใต้กองไพ่ต้องบอกใครลง/อ้างว่าอะไร: ' + caption);
        console.log('3. กดลงไพ่ผ่าน UI → มีไพ่คว่ำบนโต๊ะ + บอกว่าใครลงอ้างอะไร ✓');

        const challengeView = players[1].states[players[1].states.length - 1];
        if (challengeView?.availableActions?.canChallenge && challengeView.currentPlayerId === players[1].id) {
            const challenged = await ack(players[1].socket, 'liar_challenge', {});
            assert(challenged?.success !== false, 'ท้าผ่าน socket ไม่ได้');
            await delay(1600);
            console.log('4. คนถัดไปท้าผ่าน socket ✓');
        } else {
            console.log('4. ยังไม่ถึงตาท้า — ข้ามไปเล่นต่อ');
        }

        let doubleTapChecked = false;
        for (let guard = 0; guard < 160; guard++) {
            const state = players[1].states[players[1].states.length - 1];
            if (!state || state.phase === 'finished') break;

            for (const p of players.slice(1)) {
                const view = p.states[p.states.length - 1];
                if (!view || view.currentPlayerId !== p.id) continue;
                try {
                    if (view.availableActions?.canChallenge && (!view.availableActions.canPlay || guard % 3 === 0)) {
                        await ack(p.socket, 'liar_challenge', {});
                    } else if (view.availableActions?.canPlay && view.self?.hand?.length) {
                        await ack(p.socket, 'liar_play', { cardIds: [view.self.hand[0].id] });
                    }
                } catch {}
            }

            const challengeBtn = await page.$('#lrChallengeBtn');
            if (challengeBtn && !doubleTapChecked) {
                // UX: แตะ "โกหก!" สองครั้งติด ห้ามเด้ง error ครั้งที่สอง
                await page.evaluate(() => { document.getElementById('lrChallengeBtn').click(); const again = document.getElementById('lrChallengeBtn'); if (again) again.click(); });
                await delay(500);
                const errorPopup = await page.$('.swal2-icon-error');
                assert(!errorPopup, 'แตะโกหก! ซ้ำต้องไม่เด้ง error');
                const verdict = await page.$('#lrPileCaption .lr-verdict');
                const meView = players[1].states[players[1].states.length - 1];
                if (!meView.lastPlay) assert(verdict, 'หลังท้าต้องเห็นผลหงายไพ่ค้างบนโต๊ะ');
                doubleTapChecked = true;
                console.log('4b. แตะโกหก! ซ้ำไม่เด้ง error · ผลหงายไพ่ค้างบนโต๊ะ ✓');
            } else if (challengeBtn) await challengeBtn.click().catch(() => {});
            else {
                const play = await page.$('#lrPlayBtn:not([disabled])');
                if (play) await play.click().catch(() => {});
            }
            await delay(450);
        }

        const finalState = players[1].states[players[1].states.length - 1];
        assert(finalState?.phase === 'finished', `เกมต้องจบได้ (phase=${finalState?.phase})`);
        console.log(`5. เล่นจนจบเกม — ผู้ชนะ: ${finalState.winner?.name} ✓`);

        await delay(1200);
        const bodyText = await page.textContent('body');
        assert(/ชนะ/.test(bodyText), 'จอต้องประกาศผู้ชนะ');

        const broken = await page.evaluate(() => Array.from(document.images)
            .filter(img => img.getAttribute('src') && img.naturalWidth === 0)
            .map(img => img.getAttribute('src')));
        assert(broken.length === 0, 'รูปไพ่แตก: ' + broken.join(', '));
        assert(errors.length === 0, 'มี JS error: ' + errors.slice(0, 3).join(' | '));
        console.log('6. จอประกาศผู้ชนะ · รูปไพ่ไม่แตก · ไม่มี JS error ✓');

        // UX: สรุปอันดับ + ปุ่มพาทุกคนกลับเฉพาะหัวห้อง
        const rows = await page.$$eval('.lr-standings li', els => els.length);
        assert(rows === 3, 'หน้าสรุปต้องมีอันดับครบ 3 คน (ได้ ' + rows + ')');
        assert(await page.$('#lrBackLobbyBtn'), 'หัวห้องต้องเห็นปุ่มกลับห้องรอ');
        const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        await guestContext.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; localStorage.setItem('ig-firstplay-liar', '1'); } catch (e) {} });
        const guestPage = await guestContext.newPage();
        await guestPage.goto(`${base}/?playerId=${players[1].id}`, { waitUntil: 'domcontentloaded' });
        await guestPage.goto(`${base}/game/${roomId}?playerId=${players[1].id}`, { waitUntil: 'domcontentloaded' });
        await guestPage.waitForSelector('.lr-standings li', { timeout: 5000 });
        assert(!(await guestPage.$('#lrBackLobbyBtn')) && !(await guestPage.$('#lrRestartBtn')), 'คนที่ไม่ใช่หัวห้องห้ามเห็นปุ่มพาทุกคนกลับ/เริ่มใหม่');
        const guestHint = await guestPage.textContent('#lrBackRemain');
        assert(/หัวห้อง|อัตโนมัติ|กลับห้องรอ/.test(guestHint), 'คนที่ไม่ใช่หัวห้องต้องเห็นว่ารออะไร: ' + guestHint);
        await guestContext.close();
        console.log('6b. สรุปอันดับครบ · ปุ่มพาทุกคนกลับเห็นเฉพาะหัวห้อง ✓');

        const res = await fetch(`${base}/room/${roomId}?playerId=${players[1].id}`, { redirect: 'manual' });
        const loc = res.headers.get('location') || '';
        assert(!(res.status === 302 && loc.includes('/game/')), 'จบเกมแล้วกลับห้องไม่ได้');
        console.log(`7. จบเกมแล้วกลับห้องได้ (HTTP ${res.status}) ✓`);

        players.forEach(p => { try { p.socket.close(); } catch {} });

        // บอท: หัวห้องเพิ่มบอทได้ คนอื่นเพิ่มไม่ได้ · บอทเล่นจนจบเกม
        const host = await conn(base);
        const hostId = randomUUID();
        host.emit('initPlayer', hostId);
        const hostStates = [];
        host.on('liarState', st => hostStates.push(st));
        const stranger = await conn(base);
        stranger.emit('initPlayer', randomUUID());
        await delay(300);
        const botRoom = await ack(host, 'createRoom', { playerId: hostId, name: 'LiarBots', gameMode: 'liar', maxPlayers: 4 });
        assert(botRoom?.success, 'สร้างห้องบอทไม่ได้');
        host.emit('setRoom', { roomId: botRoom.roomId, playerId: hostId });
        const denied = await ack(stranger, 'liar_addBots', { roomId: botRoom.roomId, count: 1 });
        assert(denied && denied.success === false, 'คนที่ไม่ใช่หัวห้องต้องเพิ่มบอทไม่ได้');
        const addedBots = await ack(host, 'liar_addBots', { roomId: botRoom.roomId, count: 2 });
        assert(addedBots?.success && addedBots.added === 2, 'หัวห้องเพิ่มบอท 2 ตัวได้: ' + JSON.stringify(addedBots));
        await delay(300);
        assert((await ack(host, 'startGameFromLobby', { roomId: botRoom.roomId }))?.success, 'เริ่มเกมกับบอทไม่ได้');
        const botDeadline = Date.now() + 60000;
        let lastActed = -1;
        while (Date.now() < botDeadline) {
            const st = hostStates[hostStates.length - 1];
            if (st?.phase === 'finished') break;
            if (st && st.currentPlayerId === hostId && st.turnNumber !== lastActed) {
                lastActed = st.turnNumber;
                if (st.availableActions?.canChallenge && !st.availableActions.canPlay) await ack(host, 'liar_challenge', {});
                else if (st.availableActions?.canPlay) await ack(host, 'liar_play', { cardIds: [st.self.hand[0].id] });
            }
            await delay(60);
        }
        const botFinal = hostStates[hostStates.length - 1];
        assert(botFinal?.phase === 'finished', 'เกมกับบอทต้องจบเองได้ (phase=' + botFinal?.phase + ')');
        assert(botFinal.players.filter(p => p.isBot).length === 2, 'client ต้องรู้ว่าใครเป็นบอท');
        assert(botFinal.history.some(h => /บอท/.test(h.text) && /ลง|ท้า|จับได้/.test(h.text)), 'บอทต้องลงไพ่/ท้าเอง');
        host.close();
        stranger.close();
        console.log('8. หัวห้องเพิ่มบอทได้ (คนอื่นไม่ได้) · บอทเล่นจนจบเกม ✓');
        console.log('\n✅ โกหกเล่นได้จริงครบวงจร');
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
