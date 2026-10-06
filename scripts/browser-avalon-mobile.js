/**
 * อวาลอน — เปิดหน้าเกมจริงในเบราว์เซอร์ (390×844 + desktop 1280×900) แล้วเล่นผ่าน UI
 * ถ่ายภาพทุกเฟสของผู้เล่น 2 บท (ฝ่ายดี 1 · ฝ่ายร้าย 1) ตรวจ JS error / เลื่อนแนวนอน / ข้อความล้น
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/browser-avalon-mobile.js [โฟลเดอร์ภาพ]
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(process.env.GAME_DATA_DIR, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }

async function getFreePort() {
    if (process.env.AVALON_PORT) return Number(process.env.AVALON_PORT);
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
function launchOptions() {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH };
    if (fs.existsSync(chrome)) return { executablePath: chrome };
    return {};
}
const latest = p => p.states[p.states.length - 1];

async function waitFor(pred, message, ms = 8000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (await pred()) return;
        await delay(60);
    }
    throw new Error('รอไม่ไหว: ' + message);
}

async function layoutProblems(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const bad = [];
        if (document.documentElement.scrollWidth > vw + 1) bad.push('page scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
        document.querySelectorAll('.av *, #avOverlay.is-on .av-sheet *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (el.closest('.av-rolecard-face, .av-coin-face, .av-qcard-inner')) return;
            if (r.right > vw + 1 || r.left < -1) bad.push('หลุดจอ: ' + (el.className || el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 24));
            const ownText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
            if (ownText && cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') {
                bad.push('ข้อความล้น: ' + (el.className || el.tagName) + ' ' + (el.textContent || '').trim().slice(0, 24));
            }
        });
        return bad.slice(0, 8);
    });
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(launchOptions());
    const shots = [];
    try {
        const players = [];
        for (let i = 0; i < 5; i += 1) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const entry = { socket, id, name: `P${i + 1}`, states: [] };
            socket.on('avalonState', s => entry.states.push(s));
            players.push(entry);
        }
        await delay(400);
        const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name: 'โต๊ะกลมคืนนี้', gameMode: 'avalon', maxPlayers: 10 });
        assert(created?.success, 'สร้างห้องไม่ได้');
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(400);
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มไม่ได้');
        await waitFor(() => players.every(p => latest(p)?.phase === 'night'), 'night');
        players.forEach(p => { p.role = latest(p).self.role.id; p.team = latest(p).self.team; });

        // เลือกผู้เล่นที่เปิดในเบราว์เซอร์: ฝ่ายดี 1 (ถ้ามีเมอร์ลินเอาเมอร์ลิน) + ฝ่ายร้าย 1 (ถ้ามีมือสังหารเอามือสังหาร)
        const goodP = players.find(p => p.role === 'merlin') || players.find(p => p.team === 'good');
        const evilP = players.find(p => p.role === 'assassin') || players.find(p => p.team === 'evil');
        const pagePlayers = [goodP, evilP];
        for (const p of pagePlayers) {
            p.socket.close();
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
            await ctx.addInitScript(() => { try { localStorage.setItem('ig-firstplay-avalon', '1'); } catch (e) { /* ignore */ } });
            const page = await ctx.newPage();
            p.errors = [];
            page.on('pageerror', e => p.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !/mp3|favicon|autoplay|vibrate|fonts\.g|ERR_/i.test(m.text())) p.errors.push('console: ' + m.text().slice(0, 140)); });
            await page.goto(`${base}/game/${roomId}?playerId=${p.id}`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#avSeats .av-seat');
            p.page = page;
        }
        const socketPlayers = players.filter(p => !pagePlayers.includes(p));
        const any = () => latest(socketPlayers[0]);

        async function shot(p, name, { full = false } = {}) {
            await delay(250);
            const problems = await layoutProblems(p.page);
            assert(problems.length === 0, `${name} (${p.role}): ${problems.join(' | ')}`);
            const file = path.join(OUT, `${String(shots.length + 1).padStart(2, '0')}-${name}-${p.role}.png`);
            await p.page.screenshot({ path: file, fullPage: full });
            shots.push(file);
        }
        async function both(name, opts) {
            for (const p of pagePlayers) await shot(p, name, opts);
        }
        async function uiState(p) { return p.page.evaluate(() => ({ phase: document.getElementById('avPhase').textContent, now: document.getElementById('avNow').textContent })); }

        /* ---- night ---- */
        await both('night-closed');
        for (const p of pagePlayers) {
            const disabled = await p.page.getAttribute('#avReadyBtn', 'disabled');
            assert(disabled !== null, 'ต้องเปิดการ์ดก่อนถึงกดพร้อมได้');
            await p.page.click('#avAction [data-rolecard]');
            await delay(700);
        }
        await both('night-open', { full: true });
        for (const p of pagePlayers) {
            const text = await p.page.textContent('#avAction');
            assert(text.includes(p.role === 'merlin' ? 'ฝ่ายร้ายที่คุณเห็น' : (p.team === 'evil' ? 'พวกเดียวกัน' : 'คุณไม่รู้')), `${p.role}: ต้องแสดงข้อมูลลับของบท`);
            await p.page.click('#avReadyBtn');
        }
        for (const p of socketPlayers) await ack(p.socket, 'avalon_ready', { step: latest(p).step });
        await waitFor(() => any()?.phase === 'team', 'team');

        /* ---- rounds ---- */
        const pageById = id => pagePlayers.find(p => p.id === id);
        const goods = players.filter(p => p.team === 'good').map(p => p.id);
        let round = 0;
        let sawLeaderUi = false;
        let sawQuestUi = false;
        while (any().phase !== 'assassin' && any().phase !== 'finished' && round < 12) {
            round += 1;
            const st = any();
            const size = st.currentQuest.size;
            // ทีม: ใส่คนที่เปิดเบราว์เซอร์ไว้ด้วยเสมอ (ฝ่ายดีก่อน) จะได้เห็นหน้าลงการ์ด
            const wantEvil = st.questIndex === 1;
            const team = [goodP.id, ...(wantEvil ? [evilP.id] : []), ...goods.filter(id => id !== goodP.id)].slice(0, size);
            const leaderPage = pageById(st.leaderId);
            if (round === 1) await both('team-wait');
            if (leaderPage) {
                await waitFor(async () => (await leaderPage.page.$$('button.av-seat')).length > 0, 'leader seats');
                for (const id of team) {
                    await leaderPage.page.click(`button.av-seat[data-seat="${id}"]`);
                    await delay(120);
                }
                if (!sawLeaderUi) { await shot(leaderPage, 'team-leader-picking', { full: true }); sawLeaderUi = true; }
                await leaderPage.page.click('#avTeamBtn');
            } else {
                const leader = players.find(p => p.id === st.leaderId);
                const res = await ack(leader.socket, 'avalon_team', { teamIds: team, step: latest(leader).step });
                assert(res?.success, 'socket leader ส่งทีมไม่ได้ ' + JSON.stringify(res));
            }
            await waitFor(() => any().phase === 'vote', 'vote');
            await delay(300);
            if (round === 1) await both('vote');
            for (const p of pagePlayers) await p.page.click('[data-vote="approve"]');
            await delay(200);
            if (round === 1) await shot(goodP, 'vote-waiting');
            for (const p of socketPlayers) await ack(p.socket, 'avalon_vote', { vote: 'approve', step: latest(p).step });
            await waitFor(() => any().phase === 'quest', 'quest');
            await pagePlayers[0].page.waitForSelector('#avOverlay.is-on .av-coin');
            await delay(1500);
            if (round === 1) await both('vote-reveal');
            for (const p of pagePlayers) await p.page.click('#avOverlay [data-close]');
            // ลงการ์ด
            for (const id of any().proposal.teamIds) {
                const pp = pageById(id);
                if (pp) {
                    await pp.page.waitForSelector('[data-card="success"]');
                    if (!sawQuestUi || (pp.team === 'evil' && wantEvil)) await shot(pp, `quest-choose-q${st.questIndex + 1}`);
                    sawQuestUi = true;
                    await pp.page.click(pp.team === 'evil' && wantEvil ? '[data-card="fail"]' : '[data-card="success"]');
                } else {
                    const sp = players.find(p => p.id === id);
                    await ack(sp.socket, 'avalon_quest', { card: 'success', step: latest(sp).step });
                }
            }
            await waitFor(() => any().phase !== 'quest', 'quest resolved');
            await pagePlayers[0].page.waitForSelector('#avOverlay.is-on .av-qcard');
            await delay(700 + size * 600);
            if (st.questIndex <= 1) await both(`quest-reveal-q${st.questIndex + 1}`);
            for (const p of pagePlayers) await p.page.click('#avOverlay [data-close]').catch(() => {});
        }
        assert(any().phase === 'assassin', 'ต้องถึงเฟสลอบสังหาร ได้ ' + any().phase);
        await delay(400);
        await both('assassin', { full: true });

        // บทของฉัน (sheet)
        await goodP.page.click('#avRoleBtn');
        await goodP.page.click('#avSheet [data-rolecard]');
        await delay(700);
        await shot(goodP, 'my-role-sheet');
        await goodP.page.click('#avOverlay [data-close]');

        const assassinId = any().assassinId;
        const assassinPage = pageById(assassinId);
        const target = players.find(p => p.team === 'good' && p.role !== 'merlin');
        if (assassinPage) {
            await assassinPage.page.click(`button.av-seat[data-seat="${target.id}"]`);
            await shot(assassinPage, 'assassin-aiming');
            await assassinPage.page.click('#avStabBtn');
            await assassinPage.page.click('.swal2-confirm');
        } else {
            const sp = players.find(p => p.id === assassinId);
            await ack(sp.socket, 'avalon_assassinate', { targetId: target.id, step: latest(sp).step });
        }
        await waitFor(() => any().phase === 'finished', 'finished');
        await delay(900);
        await both('stab-reveal');
        for (const p of pagePlayers) await p.page.click('#avOverlay [data-close]').catch(() => {});
        await delay(300);
        await both('finished', { full: true });
        for (const p of pagePlayers) {
            const text = await p.page.textContent('#avAction');
            assert(/ฝ่ายดีชนะ/.test(text), 'หน้าจบต้องประกาศฝ่ายชนะ');
            const roleImgs = await p.page.$$eval('.av-seat-role', els => els.length);
            assert(roleImgs === 5, 'จบเกมต้องเปิดการ์ดบททุกคนบนโต๊ะ');
        }

        // desktop
        const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await dctx.addInitScript(() => { try { localStorage.setItem('ig-firstplay-avalon', '1'); } catch (e) { /* ignore */ } });
        const dpage = await dctx.newPage();
        const derrors = [];
        dpage.on('pageerror', e => derrors.push(e.message));
        await dpage.goto(`${base}/game/${roomId}?playerId=${goodP.id}`, { waitUntil: 'domcontentloaded' });
        await dpage.waitForSelector('#avSeats .av-seat');
        await delay(600);
        const dp = { page: dpage, role: 'desktop' };
        await shot(dp, 'finished-desktop', { full: true });
        // ux: กฎกลาง .content ul li { font-size: 20px } ต้องไม่ทำให้สรุปภารกิจ/บันทึกเกมตัวใหญ่กว่าส่วนอื่นบนเดสก์ท็อป
        const recapSizes = await dpage.$$eval('.av-recap li, .av-log-list li', els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
        assert(recapSizes.length > 0 && recapSizes.every(px => px <= 15), 'สรุปภารกิจ/บันทึกบนเดสก์ท็อปตัวใหญ่ผิด: ' + recapSizes.join(','));
        assert(derrors.length === 0, 'desktop JS error: ' + derrors.join(' | '));

        // รูปไม่แตก + ไม่มี JS error
        for (const p of pagePlayers) {
            const broken = await p.page.evaluate(() => Array.from(document.images).filter(img => img.getAttribute('src') && img.complete && img.naturalWidth === 0).map(img => img.getAttribute('src')));
            assert(broken.length === 0, 'รูปแตก: ' + broken.join(', '));
            assert(p.errors.length === 0, `${p.role} JS error: ${p.errors.slice(0, 3).join(' | ')}`);
        }
        console.log(`✅ avalon browser: ${shots.length} ภาพ · ไม่มี JS error / เลื่อนแนวนอน / ข้อความล้น`);
        console.log('   บทที่ถ่าย: ' + pagePlayers.map(p => p.role).join(', '));
        console.log('   โฟลเดอร์: ' + OUT);
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
