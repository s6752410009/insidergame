/**
 * อวาลอน — เทส UX บนมือถือ 390×844 โต๊ะเต็ม 10 คน (+ คนในห้องที่ไม่ได้นั่งโต๊ะ)
 *
 *  - หัวหน้าเลือกทีมจากปุ่มชื่อในแผงเดียวกับปุ่มส่ง (ไม่ต้องเลื่อนไปแตะโต๊ะ) · บอกว่าต้องเลือกอีกกี่คน
 *  - เพอร์ซิวัลที่เห็นคนเดียว (ไม่มีมอร์กานา) ได้ข้อความ "นี่คือเมอร์ลิน"
 *  - การ์ดภารกิจของฝ่ายดีหน้าตาเหมือนฝ่ายร้าย (คนข้าง ๆ เหลือบมองแล้วไม่รู้ฝ่าย) · แตะล้มแล้วไม่ส่ง แต่บอกเหตุผล
 *  - ลงการ์ดแล้วจอไม่โชว์ว่าลงใบไหน · สรุปภารกิจบอกทีม/หัวหน้า · ปุ่มปิดผลบอกว่าต้องทำอะไรต่อ
 *  - ช่วงลอบสังหาร: ไม่มีมงกุฎหัวหน้าค้าง · พวกเดียวกันมีป้ายบอกว่าทำไมแทงไม่ได้ · มีปุ่มชื่อเป้าในแผง
 *  - จบเกม: ปุ่ม "พาทุกคนกลับห้องรอ" เฉพาะหัวห้อง · คนอื่นมี "กลับห้องเลย" · นับถอยหลัง ~30 วิ · สรุปภารกิจเปิดค้าง
 *  - นางแห่งทะเลสาบ: ปุ่มเปิดในห้องรอ · คนถือเลือกจากแผง · ผลลับเห็นคนเดียว · คนที่ไม่ใช่คนถือเห็นแค่ว่ากำลังส่อง
 *  - ลอบสังหารมีโอเบรอน: โอเบรอนติดป้าย "พวกเดียวกัน" แทงไม่ได้
 *  - ออกจากห้องกลางเฟสส่อง: ไปหน้า /rooms แล้วค้างอยู่ 15 วิ ไม่ถูกดึงกลับ · เกมเดินต่อ
 *  - คนในห้องที่ไม่ได้นั่งโต๊ะ ไม่เห็นข้อความ "โหวตแล้ว"/ปุ่มพร้อม ที่ไม่ใช่ของเขา
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/browser-avalon-ux.js [โฟลเดอร์ภาพ]
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(process.env.GAME_DATA_DIR, 'shots-ux');
fs.mkdirSync(OUT, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { checks += 1; if (!c) throw new Error(m); }

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
        child.on('exit', code => { if (code) { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-800))); } });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }
function launchOptions() {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return { headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH };
    if (fs.existsSync(chrome)) return { headless: true, executablePath: chrome };
    return { headless: true };
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

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    let browser = null;
    let shotNo = 0;
    try {
        browser = await chromium.launch(launchOptions());
        async function makeRoom(count, name, roles) {
            const list = [];
            for (let i = 0; i < count; i += 1) {
                const socket = await conn(base);
                const id = randomUUID();
                socket.emit('initPlayer', id);
                const entry = { socket, id, name: `P${i + 1}`, states: [] };
                socket.on('avalonState', s => entry.states.push(s));
                socket.on('roomUpdate', d => { entry.lastRoom = d; });
                list.push(entry);
            }
            await delay(400);
            const created = await ack(list[0].socket, 'createRoom', { playerId: list[0].id, name, gameMode: 'avalon', maxPlayers: 10 });
            assert(created?.success, 'สร้างห้องไม่ได้ ' + JSON.stringify(created));
            list[0].socket.emit('setRoom', { roomId: created.roomId, playerId: list[0].id });
            for (const p of list.slice(1)) {
                const joined = await ack(p.socket, 'joinRoom', { roomId: created.roomId, playerId: p.id });
                assert(joined?.success, 'join ไม่ได้ ' + JSON.stringify(joined));
                p.socket.emit('setRoom', { roomId: created.roomId, playerId: p.id });
            }
            await delay(400);
            if (roles) assert((await ack(list[0].socket, 'updateRoom', { avalonRoles: roles }))?.success, 'ตั้งบทเสริมไม่ได้');
            return { roomId: created.roomId, players: list };
        }
        async function startRoom(room) {
            assert((await ack(room.players[0].socket, 'startGameFromLobby', { roomId: room.roomId }))?.success, 'เริ่มไม่ได้');
            await waitFor(() => room.players.every(p => latest(p)?.phase === 'night'), 'night');
            room.players.forEach(p => { p.role = latest(p).self.role.id; p.team = latest(p).self.team; });
        }
        async function openPage(id, rid) {
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
            await ctx.addInitScript(() => {
                try { localStorage.setItem('ig-firstplay-avalon', '1'); } catch (e) { /* ignore */ }
                try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ }
            });
            const page = await ctx.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push('pageerror: ' + e.message));
            await page.goto(`${base}/game/${rid}?playerId=${id}`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#avSeats .av-seat');
            return { ctx, page, errors };
        }
        async function shot(page, name) {
            shotNo += 1;
            await delay(200);
            await page.screenshot({ path: path.join(OUT, `${String(shotNo).padStart(2, '0')}-${name}.png`) });
        }

        /* ---- คนดู: อยู่ในห้องแต่หลุดก่อนเริ่ม เลยไม่ได้นั่งโต๊ะ ---- */
        const side = await makeRoom(6, 'ห้องมีคนดู');
        const watcher = side.players.pop();
        watcher.socket.close();
        await delay(300);
        await startRoom(side);
        const w = await openPage(watcher.id, side.roomId);
        const wNight = await w.page.evaluate(() => ({ now: document.getElementById('avNow').textContent, ready: !!document.getElementById('avReadyBtn') }));
        assert(!wNight.ready, 'คนดูต้องไม่มีปุ่มพร้อม');
        assert(!(await w.page.isVisible('#avRoleBtn')), 'คนดูต้องไม่มีปุ่ม "บทของฉัน" ที่กดแล้วไม่เกิดอะไร');
        assert(/ผู้เล่นกำลังดูบท/.test(wNight.now) && !/แตะการ์ดดูบทของคุณ/.test(wNight.now), 'คนดูต้องไม่ถูกบอกให้ดูบทตัวเอง: ' + wNight.now);
        await shot(w.page, 'watcher-night');
        for (const p of side.players) await ack(p.socket, 'avalon_ready', { step: latest(p).step });
        await waitFor(() => latest(side.players[0]).phase === 'team', 'side team');
        const sideLeader = side.players.find(p => p.id === latest(side.players[0]).leaderId);
        const sideTeam = side.players.slice(0, latest(sideLeader).currentQuest.size).map(p => p.id);
        assert((await ack(sideLeader.socket, 'avalon_team', { teamIds: sideTeam, step: latest(sideLeader).step }))?.success, 'side ส่งทีมไม่ได้');
        await ack(side.players[0].socket, 'avalon_vote', { vote: 'approve', step: latest(side.players[0]).step });
        await waitFor(async () => /โหวต/.test(await w.page.textContent('#avNow')), 'คนดูได้ state โหวต');
        await delay(300);
        const wVote = await w.page.evaluate(() => ({ now: document.getElementById('avNow').textContent, action: document.getElementById('avAction').textContent }));
        assert(!/^โหวตแล้ว/.test(wVote.now) && !/คุณโหวต/.test(wVote.action), 'คนดูต้องไม่ถูกบอกว่า "โหวตแล้ว": ' + wVote.now);
        assert(/1\/5/.test(wVote.now), 'คนดูต้องเห็นความคืบหน้าโหวต: ' + wVote.now);
        assert(w.errors.length === 0, 'watcher JS error: ' + w.errors.join(' | '));
        await w.ctx.close();
        side.players.forEach(p => p.socket.close());
        console.log('1. คนในห้องที่ไม่ได้นั่งโต๊ะ: ไม่มีปุ่มพร้อม · ไม่ถูกบอกว่า "โหวตแล้ว" · เห็นความคืบหน้า ✓');

        /* ---- โต๊ะเต็ม 10 คน (+เพอร์ซิวัล ไม่มีมอร์กานา) ---- */
        const table = await makeRoom(10, 'โต๊ะกลมสิบคน', ['percival']);
        const players = table.players;
        const roomId = table.roomId;
        const host = players[0];
        await startRoom(table);
        assert(latest(host).players.length === 10, 'ต้องนั่งโต๊ะ 10 คน');

        const firstLeaderId = latest(host).leaderId;
        const leaderP = players.find(p => p.id === firstLeaderId);
        const percival = players.find(p => p.role === 'percival');
        const assassin = players.find(p => p.role === 'assassin');
        const pagePlayers = [...new Set([host, leaderP, percival, assassin])];
        const socketPlayers = players.filter(p => !pagePlayers.includes(p));
        const any = () => latest(socketPlayers[0]);

        for (const p of pagePlayers) {
            p.socket.close();
            Object.assign(p, await openPage(p.id, roomId));
        }

        async function clearOverlay(p) {
            for (let i = 0; i < 3; i += 1) {
                const on = await p.page.$('#avOverlay.is-on [data-close]');
                if (!on) return;
                await on.click().catch(() => {});
                await delay(120);
            }
        }
        async function ready(p) {
            if (p.page) {
                await p.page.click('#avAction [data-rolecard]');
                await p.page.click('#avReadyBtn');
            } else {
                await ack(p.socket, 'avalon_ready', { step: latest(p).step });
            }
        }

        /* ---- เพอร์ซิวัลเห็นคนเดียว ---- */
        await percival.page.click('#avAction [data-rolecard]');
        await delay(400);
        const percText = await percival.page.textContent('#avAction');
        assert(/นี่คือเมอร์ลิน/.test(percText) && !/หนึ่งในนี้/.test(percText), 'เพอร์ซิวัลที่เห็นคนเดียวต้องได้ "นี่คือเมอร์ลิน"');
        const rolesLine = await percival.page.textContent('#avRolesLine');
        assert(/ฝ่ายดี 6 · ฝ่ายร้าย 4/.test(rolesLine) && /เพอร์ซิวัล/.test(rolesLine), 'ต้องบอกจำนวนฝ่ายและบทพิเศษในเกม: ' + rolesLine);
        await shot(percival.page, 'night-percival');
        await percival.page.click('#avAction [data-rolecard]');
        console.log('2. เพอร์ซิวัล (ไม่มีมอร์กานา) ได้ "นี่คือเมอร์ลิน" · โชว์ฝ่ายดี/ร้าย + บทพิเศษในเกม ✓');

        for (const p of players) {
            if (p === percival) { await percival.page.click('#avAction [data-rolecard]'); await percival.page.click('#avReadyBtn'); continue; }
            await ready(p);
        }
        await waitFor(() => any()?.phase === 'team', 'team');

        /* ---- หัวหน้าเลือกทีมบนมือถือ (โต๊ะ 10 คน) ---- */
        const size1 = any().currentQuest.size;
        assert(size1 === 3, '10 คน ภารกิจ 1 ใช้ 3 คน');
        const L = leaderP.page;
        await L.waitForSelector('#avAction .av-pickgrid button[data-pick]');
        await delay(500);
        const grid = await L.$$eval('#avAction .av-pickgrid button[data-pick]', els => els.map(e => ({ h: e.getBoundingClientRect().height, id: e.getAttribute('data-pick') })));
        assert(grid.length === 10, 'แผงเลือกทีมต้องมีชื่อครบ 10 คน ได้ ' + grid.length);
        assert(grid.every(g => g.h >= 44), 'ปุ่มชื่อต้องสูง ≥ 44px');
        assert(/เลือกอีก 3 คน/.test(await L.textContent('#avPickHint')), 'ต้องบอกว่าต้องเลือกอีกกี่คน');
        const goods = players.filter(p => p.team === 'good');
        const team1 = [percival.id, ...goods.filter(p => p !== percival).map(p => p.id)].slice(0, size1);
        for (const id of team1.slice(0, 2)) await L.click(`#avAction button[data-pick="${id}"]`);
        assert(/เลือกอีก 1 คน/.test(await L.textContent('#avPickHint')), 'เลือก 2/3 ต้องบอกเลือกอีก 1');
        assert(await L.$eval('#avTeamBtn', b => b.disabled), 'ยังไม่ครบต้องกดส่งไม่ได้');
        await L.click(`#avAction button[data-pick="${team1[2]}"]`);
        const after = await L.evaluate(() => {
            const btn = document.getElementById('avTeamBtn');
            const r = btn.getBoundingClientRect();
            return {
                enabled: !btn.disabled,
                disabledOthers: document.querySelectorAll('#avAction .av-pickgrid button[disabled]').length,
                pickedSeats: document.querySelectorAll('#avSeats .av-seat.is-picked').length,
                hint: document.getElementById('avPickHint').textContent,
                gridTop: document.querySelector('#avAction .av-pickgrid').getBoundingClientRect().top,
                btnBottom: r.bottom
            };
        });
        assert(after.enabled && after.disabledOthers === 7, 'ครบ 3 ต้องกดส่งได้และชื่ออื่นถูกปิด');
        assert(after.pickedSeats === 3, 'ปุ่มชื่อกับโต๊ะต้องตรงกัน');
        assert(/แตะชื่อที่เลือกเพื่อเอาออก/.test(after.hint), 'ครบแล้วต้องบอกวิธีเอาออก');
        assert(after.btnBottom - after.gridTop < 844 - 60, 'ชื่อทั้งหมดกับปุ่มส่งต้องอยู่ในจอเดียว');
        // เอาออกแล้วใส่ใหม่จากโต๊ะได้
        await L.click(`#avAction button[data-pick="${team1[2]}"]`);
        assert(await L.$eval('#avTeamBtn', b => b.disabled), 'เอาออกแล้วต้องกดส่งไม่ได้');
        await L.click(`#avSeats button.av-seat[data-seat="${team1[2]}"]`);
        assert(!(await L.$eval('#avTeamBtn', b => b.disabled)), 'แตะบนโต๊ะต้องใช้ได้เหมือนกัน');
        await L.evaluate(() => document.getElementById('avAction').scrollIntoView({ block: 'start' }));
        await shot(L, 'leader-picking-10p');
        await L.click('#avTeamBtn');
        await waitFor(() => any().phase === 'vote', 'vote');
        console.log('3. หัวหน้าโต๊ะ 10 คน: เลือกจากปุ่มชื่อในแผงเดียวกับปุ่มส่ง · บอก "เลือกอีก N คน" · ปุ่ม ≥ 44px ✓');

        for (const p of players) {
            if (p.page) { await clearOverlay(p); await p.page.click('[data-vote="approve"]'); }
            else await ack(p.socket, 'avalon_vote', { vote: 'approve', step: latest(p).step });
        }
        await waitFor(() => any().phase === 'quest', 'quest');

        /* ---- เปิดผลโหวต: ปุ่มบอกงานถัดไป ---- */
        await percival.page.waitForSelector('#avOverlay.is-on .av-coin');
        const closeText = await percival.page.textContent('#avOverlay [data-close]');
        assert(/ไปลงการ์ด/.test(closeText), 'คนในทีมต้องเห็นปุ่ม "ไปลงการ์ด" ได้ ' + closeText);
        const leaderMark = await percival.page.$$eval('#avSheet .av-reveal-vote', els => els.filter(e => /👑/.test(e.textContent)).length);
        const teamMarks = await percival.page.$$eval('#avSheet .av-reveal-vote em', els => els.length);
        assert(leaderMark === 1 && teamMarks === 3, 'ผลโหวตต้องบอกหัวหน้าและคนในทีม');
        await delay(1200);
        await shot(percival.page, 'vote-reveal');
        await clearOverlay(percival);

        /* ---- การ์ดภารกิจ: ฝ่ายดีหน้าตาเหมือนฝ่ายร้าย ---- */
        await percival.page.waitForSelector('[data-card="fail"]');
        const failState = await percival.page.$eval('[data-card="fail"]', b => ({ disabled: b.disabled, note: b.textContent }));
        assert(!failState.disabled && !/ฝ่ายดี/.test(failState.note), 'การ์ดล้มของฝ่ายดีต้องไม่ถูกปิดให้คนข้าง ๆ เห็น');
        await shot(percival.page, 'quest-choose-good');
        await percival.page.click('[data-card="fail"]');
        await delay(500);
        assert(/ฝ่ายดีลงได้แค่การ์ดสำเร็จ/.test(await percival.page.textContent('#avFailNote')), 'แตะล้มแล้วต้องบอกเหตุผล');
        assert(any().questPlayedCount === 0, 'ฝ่ายดีแตะล้มต้องไม่ส่งการ์ด');
        await percival.page.click('[data-card="success"]');
        await waitFor(() => any().questPlayedCount === 1, 'ส่งการ์ดสำเร็จ');
        await delay(300);
        const waitText = await percival.page.textContent('#avAction');
        assert(/คว่ำไว้แล้ว/.test(waitText) && !/คุณลง/.test(waitText), 'ลงแล้วต้องไม่โชว์ว่าลงใบไหน');
        for (const id of team1.filter(x => x !== percival.id)) {
            const p = players.find(x => x.id === id);
            if (p.page) { await clearOverlay(p); await p.page.click('[data-card="success"]'); }
            else await ack(p.socket, 'avalon_quest', { card: 'success', step: latest(p).step });
        }
        await waitFor(() => any().phase === 'team' && any().successCount === 1, 'quest 1 สำเร็จ');
        await percival.page.waitForSelector('#avOverlay.is-on .av-qcard');
        const qSub = await percival.page.textContent('#avSheet');
        const nameOnTable = id => latest(socketPlayers[0]).players.find(x => x.playerId === id).name;
        assert(team1.every(id => qSub.includes(nameOnTable(id))), 'ผลภารกิจต้องบอกชื่อทีม');
        assert(/ทีม:/.test(qSub) && /รวมภารกิจ สำเร็จ 1 · ล้ม 0/.test(qSub), 'ผลภารกิจต้องบอกทีมและยอดรวมชัด ๆ');
        await delay(2600);
        await shot(percival.page, 'quest-reveal');
        await clearOverlay(percival);
        const recap = await percival.page.evaluate(() => ({ hidden: document.getElementById('avRecapWrap').hidden, text: document.getElementById('avRecap').textContent }));
        assert(!recap.hidden && /ภารกิจ 1/.test(recap.text) && /ทีม:/.test(recap.text) && /หัวหน้า/.test(recap.text), 'สรุปภารกิจต้องโชว์ทีม+หัวหน้า');
        console.log('4. ผลโหวตบอกหัวหน้า/ทีม · ปุ่ม "ไปลงการ์ด" · การ์ดฝ่ายดีไม่ต่างจากฝ่ายร้าย · ลงแล้วไม่โชว์ใบ · สรุปภารกิจ ✓');

        /* ---- เล่นต่อจนถึงช่วงลอบสังหาร (ผ่าน socket/หน้าเว็บตามคน) ---- */
        let guard = 0;
        while (any().phase !== 'assassin' && guard < 10) {
            guard += 1;
            await waitFor(() => any().phase === 'team', 'team again');
            await delay(150);
            const st = any();
            const team = goods.map(p => p.id).slice(0, st.currentQuest.size);
            const leader = players.find(p => p.id === st.leaderId);
            if (leader.page) {
                await clearOverlay(leader);
                await leader.page.waitForSelector('#avAction .av-pickgrid');
                for (const id of team) await leader.page.click(`#avAction button[data-pick="${id}"]`);
                await leader.page.click('#avTeamBtn');
            } else {
                assert((await ack(leader.socket, 'avalon_team', { teamIds: team, step: latest(leader).step }))?.success, 'ส่งทีมไม่ได้');
            }
            await waitFor(() => any().phase === 'vote', 'vote');
            for (const p of players) {
                if (p.page) { await clearOverlay(p); await p.page.waitForSelector('[data-vote="approve"]'); await p.page.click('[data-vote="approve"]'); }
                else await ack(p.socket, 'avalon_vote', { vote: 'approve', step: latest(p).step });
            }
            await waitFor(() => any().phase === 'quest', 'quest');
            for (const id of any().proposal.teamIds) {
                const p = players.find(x => x.id === id);
                if (p.page) { await clearOverlay(p); await p.page.waitForSelector('[data-card="success"]'); await p.page.click('[data-card="success"]'); }
                else await ack(p.socket, 'avalon_quest', { card: 'success', step: latest(p).step });
            }
            await waitFor(() => any().phase !== 'quest', 'quest resolved');
        }
        assert(any().phase === 'assassin', 'ต้องถึงช่วงลอบสังหาร');

        /* ---- ช่วงลอบสังหาร ---- */
        const A = assassin.page;
        await clearOverlay(assassin);
        await delay(2500);
        await clearOverlay(assassin);
        await A.waitForSelector('#avAction .av-pickgrid button[data-pick]');
        const aView = await A.evaluate(() => ({
            crowns: document.querySelectorAll('#avSeats .av-seat-crown').length,
            mates: Array.from(document.querySelectorAll('#avSeats .av-seat.is-disabled .av-seat-tag')).map(e => e.textContent),
            targets: document.querySelectorAll('#avAction .av-pickgrid button[data-pick]').length
        }));
        const knownMates = latest(socketPlayers[0]) && players.filter(p => p.team === 'evil' && p.role !== 'oberon' && p !== assassin).length;
        assert(aView.crowns === 0, 'ช่วงลอบสังหารต้องไม่มีมงกุฎหัวหน้าค้าง');
        assert(aView.mates.filter(t => t === 'พวกเดียวกัน').length === knownMates, 'พวกเดียวกันต้องมีป้ายบอกว่าแทงไม่ได้เพราะอะไร ' + JSON.stringify(aView.mates));
        assert(aView.targets === 10 - 1 - knownMates, 'แผงเป้าต้องมีเฉพาะคนที่แทงได้');
        const victim = players.find(p => p.team === 'good' && p.role !== 'merlin');
        await A.click(`#avAction button[data-pick="${victim.id}"]`);
        assert(await A.$eval(`#avSeats .av-seat[data-seat="${victim.id}"]`, e => e.classList.contains('is-target')), 'เลือกจากแผงต้องไฮไลต์บนโต๊ะ');
        await A.evaluate(() => document.getElementById('avAction').scrollIntoView({ block: 'start' }));
        await shot(A, 'assassin-aiming');
        await A.click('#avStabBtn');
        await A.click('.swal2-confirm');
        await waitFor(() => any().phase === 'finished', 'finished');
        console.log('5. ลอบสังหาร: ไม่มีมงกุฎค้าง · ป้าย "พวกเดียวกัน" · แผงเป้าในจอเดียวกับปุ่มแทง ✓');

        /* ---- จบเกม ---- */
        await delay(800);
        for (const p of pagePlayers) await clearOverlay(p);
        const hostView = await host.page.evaluate(() => ({ back: !!document.getElementById('avBackBtn'), restart: !!document.getElementById('avRestartBtn'), recapOpen: document.getElementById('avRecapWrap').open }));
        assert(hostView.back && hostView.restart, 'หัวห้องต้องมีปุ่มเล่นอีกรอบ + พาทุกคนกลับ');
        assert(hostView.recapOpen, 'จบเกมต้องเปิดสรุปภารกิจ');
        const other = pagePlayers.find(p => p !== host);
        const otherView = await other.page.evaluate(() => ({
            back: !!document.getElementById('avBackBtn'),
            self: document.getElementById('avBackSelfBtn') && document.getElementById('avBackSelfBtn').textContent,
            selfH: document.getElementById('avBackSelfBtn') && document.getElementById('avBackSelfBtn').getBoundingClientRect().height,
            remain: document.getElementById('avBackRemain').textContent
        }));
        assert(!otherView.back && /กลับห้องรอ/.test(otherView.remain), 'คนที่ไม่ใช่หัวห้องต้องไม่มีปุ่มพาทุกคนกลับ');
        assert(/กลับห้องเลย/.test(otherView.self || '') && otherView.selfH >= 44, 'คนที่ไม่ใช่หัวห้องต้องมีปุ่ม "กลับห้องเลย" ≥ 44px');
        const remainSec = Number((otherView.remain.match(/(\d+) วิ/) || [])[1] || 0);
        assert(remainSec >= 20 && remainSec <= 30, 'หน้าจบเกมต้องนับถอยหลัง ~30 วิ ได้ ' + otherView.remain);
        await other.page.evaluate(() => document.getElementById('avAction').scrollIntoView({ block: 'start' }));
        await shot(other.page, 'finished-nonhost');
        await other.page.click('#avBackSelfBtn');
        await other.page.waitForURL(new RegExp('/room/' + roomId), { timeout: 8000 });
        await delay(800);
        assert(new RegExp('/room/' + roomId).test(other.page.url()), 'กด "กลับห้องเลย" ต้องไปห้องรอ ได้ ' + other.page.url());
        assert(latest(host).phase === 'finished' || latest(socketPlayers[0]).phase === 'finished', 'คนอื่นยังดูหน้าจบต่อได้');
        await shot(other.page, 'back-to-room-alone');
        console.log('6. จบเกม: พาทุกคนกลับเฉพาะหัวห้อง · คนอื่นกด "กลับห้องเลย" ไปห้องรอได้ทันที · นับ ~30 วิ · สรุปภารกิจเปิดค้าง ✓');

        for (const p of pagePlayers) assert(p.errors.length === 0, `${p.role} JS error: ${p.errors.join(' | ')}`);
        for (const p of pagePlayers) await p.ctx.close().catch(() => {});
        socketPlayers.forEach(p => p.socket.close());

        /* ---- 7 คน + โอเบรอน + นางแห่งทะเลสาบ ---- */
        const lt = await makeRoom(7, 'ทะเลสาบเจ็ดคน', ['oberon']);
        const lp = lt.players;
        const lHost = lp[0];
        // ห้องรอ: หัวห้องแตะเปิดนางแห่งทะเลสาบเอง
        const lobby = await (async () => {
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
            await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
            const page = await ctx.newPage();
            await page.goto(`${base}/room/${lt.roomId}?playerId=${lHost.id}`, { waitUntil: 'domcontentloaded' });
            return { ctx, page };
        })();
        await lobby.page.waitForSelector('[data-avalon-lady]');
        assert(await lobby.page.$eval('[data-avalon-lady]', b => b.getAttribute('aria-pressed')) === 'false', 'ค่าเริ่มต้น: นางแห่งทะเลสาบปิด');
        await lobby.page.click('[data-avalon-lady]');
        await waitFor(async () => (await lobby.page.$eval('[data-avalon-lady]', b => b.getAttribute('aria-pressed'))) === 'true', 'แตะแล้วต้องเปิด');
        const ladyBtn = await lobby.page.$eval('[data-avalon-lady]', b => ({ h: b.getBoundingClientRect().height, t: b.textContent }));
        assert(ladyBtn.h >= 44 && /แนะนำ 7\+ คน/.test(ladyBtn.t), 'ปุ่มนางแห่งทะเลสาบ ≥ 44px และมีคำอธิบาย');
        await lobby.page.$eval('[data-avalon-lady]', b => b.scrollIntoView({ block: 'center' }));
        await shot(lobby.page, 'lobby-lady-on');
        await lobby.ctx.close();
        lHost.socket.emit('setRoom', { roomId: lt.roomId, playerId: lHost.id });
        await delay(600);
        await startRoom(lt);
        const lAny = () => latest(lp.find(p => !p.page && !p.gone) || lp[0]);
        const holderP = lp.find(p => p.id === latest(lHost).lady.holderId);
        const assassinL = lp.find(p => p.role === 'assassin');
        // X = คนที่จะถูกส่องแล้วออกกลางเกม (ไม่ใช่โอเบรอน — ต้องเหลือไว้เช็กป้ายตอนลอบสังหาร)
        const xP = lp.find(p => p !== holderP && p !== assassinL && p !== lHost && p.role !== 'oberon') || lp.find(p => p !== holderP && p !== assassinL && p.role !== 'oberon');
        const lPages = [...new Set([holderP, xP, assassinL])];
        for (const p of lPages) { p.socket.close(); Object.assign(p, await openPage(p.id, lt.roomId)); }
        const lGoods = lp.filter(p => p.team === 'good');
        const lEvil = lp.filter(p => p.team === 'evil');

        async function lReady() {
            for (const p of lp) {
                if (p.page) { await p.page.click('#avAction [data-rolecard]'); await p.page.click('#avReadyBtn'); }
                else await ack(p.socket, 'avalon_ready', { step: latest(p).step });
            }
            await waitFor(() => lAny().phase === 'team', 'lady team');
        }
        async function lRound(team, cardOf) {
            await waitFor(() => lAny().phase === 'team', 'lady round team');
            await delay(200);
            const st = lAny();
            const leader = lp.find(p => p.id === st.leaderId);
            if (leader.page) {
                await clearOverlay(leader);
                await leader.page.waitForSelector('#avAction .av-pickgrid');
                for (const id of team) await leader.page.click(`#avAction button[data-pick="${id}"]`);
                await leader.page.click('#avTeamBtn');
            } else {
                assert((await ack(leader.socket, 'avalon_team', { teamIds: team, step: latest(leader).step }))?.success, 'lady ส่งทีมไม่ได้');
            }
            await waitFor(() => lAny().phase === 'vote', 'lady vote');
            for (const p of lp) {
                if (p.gone) continue;
                if (p.page) { await clearOverlay(p); await p.page.waitForSelector('[data-vote="approve"]'); await p.page.click('[data-vote="approve"]'); }
                else await ack(p.socket, 'avalon_vote', { vote: 'approve', step: latest(p).step });
            }
            await waitFor(() => lAny().phase === 'quest', 'lady quest');
            for (const id of lAny().proposal.teamIds) {
                const p = lp.find(x => x.id === id);
                const card = cardOf(p);
                if (p.page) { await clearOverlay(p); await p.page.waitForSelector(`[data-card="${card}"]`); await p.page.click(`[data-card="${card}"]`); }
                else await ack(p.socket, 'avalon_quest', { card, step: latest(p).step });
            }
            await waitFor(() => lAny().phase !== 'quest', 'lady quest resolved');
        }
        const sizeOf = i => lAny().quests[i].size;
        await lReady();
        await lRound(lGoods.map(p => p.id).slice(0, sizeOf(0)), () => 'success');
        assert(lAny().phase === 'team', 'หลังภารกิจ 1 ยังไม่ส่อง');
        await lRound(lGoods.map(p => p.id).slice(0, sizeOf(1)), () => 'success');
        await waitFor(() => lAny().phase === 'lady', 'หลังภารกิจ 2 ต้องเข้าเฟสนางแห่งทะเลสาบ');

        const H = holderP.page;
        await clearOverlay(holderP);
        await delay(2600);
        await clearOverlay(holderP);
        await H.waitForSelector('#avAction .av-pickgrid button[data-pick]');
        const hGrid = await H.$$eval('#avAction .av-pickgrid button[data-pick]', els => els.map(e => ({ id: e.getAttribute('data-pick'), h: e.getBoundingClientRect().height })));
        assert(hGrid.length === 6 && hGrid.every(g => g.h >= 44) && !hGrid.some(g => g.id === holderP.id), 'คนถือเห็นชื่อ 6 คน (ไม่รวมตัวเอง) ปุ่ม ≥ 44px');
        assert(/คุณถือนางแห่งทะเลสาบ/.test(await H.textContent('#avNow')), 'สถานะบอกคนถือว่าถึงตาส่อง');
        assert(await H.$eval('#avLadyBtn', b => b.disabled), 'ยังไม่เลือกต้องกดส่องไม่ได้');
        const X = xP.page;
        await clearOverlay(xP);
        const xText = await X.textContent('#avAction');
        assert(/กำลังเลือกส่อง/.test(xText) && !(await X.$('#avAction .av-pickgrid')), 'คนอื่นเห็นแค่ว่ากำลังส่อง ไม่มีแผงเลือก');
        await shot(X, 'lady-waiting-other');
        await H.click(`#avAction button[data-pick="${xP.id}"]`);
        assert(await H.$eval(`#avSeats .av-seat[data-seat="${xP.id}"]`, e => e.classList.contains('is-picked')), 'เลือกจากแผงต้องไฮไลต์บนโต๊ะ');
        await H.evaluate(() => document.getElementById('avAction').scrollIntoView({ block: 'start' }));
        await shot(H, 'lady-holder-picking');
        await H.click('#avLadyBtn');
        await H.click('.swal2-confirm');
        await waitFor(() => lAny().phase === 'team', 'ส่องแล้วไปเลือกทีม');
        await H.waitForSelector('#avOverlay.is-on');
        const res = await H.textContent('#avSheet');
        const teamWord = xP.team === 'good' ? 'ฝ่ายดี' : 'ฝ่ายร้าย';
        assert(/ผลส่อง/.test(res) && res.includes(teamWord) && /มีแค่คุณที่เห็น/.test(res), 'คนถือเห็นผลส่องตรงฝ่าย: ' + res);
        await shot(H, 'lady-result-private');
        await clearOverlay(holderP);
        const hTag = await H.$eval(`#avSeats .av-seat[data-seat="${xP.id}"] .av-seat-tag`, e => e.textContent);
        assert(/ส่องแล้ว/.test(hTag), 'ที่นั่งเป้าติดป้ายผลส่องให้คนถือ: ' + hTag);
        await delay(400);
        const xSeen = await X.evaluate(() => Array.from(document.querySelectorAll('#avSeats .av-seat-tag')).map(e => e.textContent).filter(t => /ส่องแล้ว/.test(t)).length);
        assert(xSeen === 0, 'คนอื่นต้องไม่เห็นผลส่อง');
        assert(await X.$(`#avSeats .av-seat[data-seat="${xP.id}"] .av-seat-lady`), 'นางแห่งทะเลสาบย้ายมาที่คนถูกส่อง (ไอคอน 🌊)');
        console.log('7. นางแห่งทะเลสาบ: หัวห้องเปิดในห้องรอ · คนถือเลือกจากแผง · ผลลับเห็นคนเดียว · ส่งต่อให้คนถูกส่อง ✓');

        // ภารกิจ 3 ล้ม (ฝ่ายร้ายลงล้ม) → ยังไม่จบ → ส่องรอบสอง คนถือคือ X → X ออกจากห้องกลางเฟสส่อง
        const evilOnTeam = lEvil.find(p => !p.page) || lEvil[0];
        await lRound([evilOnTeam.id, ...lGoods.map(p => p.id)].slice(0, sizeOf(2)), p => (p === evilOnTeam ? 'fail' : 'success'));
        await waitFor(() => lAny().phase === 'lady' && lAny().lady.holderId === xP.id, 'หลังภารกิจ 3 X ถือนางแห่งทะเลสาบ');
        await clearOverlay(xP);
        await delay(2600);
        await clearOverlay(xP);
        await X.waitForSelector('#avAction .av-pickgrid button[data-pick]');
        assert(!(await X.$(`#avAction button[data-pick="${holderP.id}"]`)), 'ส่องคนที่เคยถือไม่ได้ (ไม่มีในแผง)');
        await X.click('#avPlayersBtn');
        await X.waitForSelector('#leaveRoomBtn', { state: 'visible' });
        await X.click('#leaveRoomBtn');
        await X.waitForSelector('.swal2-confirm');
        await X.click('.swal2-confirm');
        await X.waitForURL(/\/rooms/, { timeout: 8000 });
        await waitFor(() => lAny().phase === 'lady' && lAny().lady.holderId !== xP.id, 'คนถือออก → ส่งต่อ');
        const newHolder = lp.find(p => p.id === lAny().lady.holderId);
        assert(newHolder && newHolder !== holderP, 'ส่งต่อให้คนที่ยังไม่เคยถือ');
        await delay(15000);
        assert(/\/rooms/.test(X.url()) && !/\/game\//.test(X.url()), 'ออกแล้วต้องค้างที่ /rooms 15 วิ ไม่ถูกดึงกลับ: ' + X.url());
        const seatX = lAny().players.find(p => p.playerId === xP.id);
        assert(seatX && seatX.left, 'X ถูกทำเครื่องหมายว่าออกจากโต๊ะ');
        const roomPlayers = (lp.find(p => !p.page).lastRoom || {}).players || [];
        assert(!roomPlayers.some(p => p.playerId === xP.id), 'X ไม่อยู่ในรายชื่อห้องแล้ว');
        await shot(X, 'left-stays-on-rooms');
        xP.gone = true;
        console.log('8. ออกจากห้องกลางเฟสส่อง: ไป /rooms ค้าง 15 วิ ไม่ถูกดึงกลับ · นางแห่งทะเลสาบส่งต่อ · เกมเดินต่อ ✓');

        // คนถือใหม่ส่อง (หมดเวลา/socket) → ภารกิจ 4 สำเร็จ → ลอบสังหาร
        if (newHolder.page) {
            await clearOverlay(newHolder);
            await newHolder.page.waitForSelector('#avAction .av-pickgrid button[data-pick]');
            await newHolder.page.click('#avAction .av-pickgrid button[data-pick]');
            await newHolder.page.click('#avLadyBtn');
            await newHolder.page.click('.swal2-confirm');
        } else {
            const t = latest(newHolder).ladyTargets[0];
            assert((await ack(newHolder.socket, 'avalon_lady', { targetId: t, step: latest(newHolder).step }))?.success, 'คนถือใหม่ส่องไม่ได้');
        }
        const liveGoods = lGoods.filter(p => !p.gone).map(p => p.id);
        await waitFor(() => lAny().phase === 'team', 'ส่องรอบสองเสร็จ');
        // ทีมภารกิจ 4: ฝ่ายดีที่ยังอยู่ก่อน ขาดเท่าไรเติมฝ่ายร้าย (ลงสำเร็จ)
        await lRound([...liveGoods, ...lEvil.filter(p => !p.gone).map(p => p.id)].slice(0, sizeOf(3)), () => 'success');
        await waitFor(() => lAny().phase === 'assassin', 'ฝ่ายดีสำเร็จ 3 → ลอบสังหาร');
        const AL = assassinL.page;
        await clearOverlay(assassinL);
        await delay(2600);
        await clearOverlay(assassinL);
        await AL.waitForSelector('#avAction .av-pickgrid button[data-pick]');
        const oberon = lp.find(p => p.role === 'oberon');
        const aInfo = await AL.evaluate(ob => ({
            obTag: (document.querySelector(`#avSeats .av-seat[data-seat="${ob}"] .av-seat-tag`) || {}).textContent,
            obInGrid: !!document.querySelector(`#avAction button[data-pick="${ob}"]`),
            grid: document.querySelectorAll('#avAction .av-pickgrid button[data-pick]').length
        }), oberon.id);
        assert(aInfo.obTag === 'พวกเดียวกัน' && !aInfo.obInGrid, 'โอเบรอนต้องติดป้าย "พวกเดียวกัน" แทงไม่ได้: ' + JSON.stringify(aInfo));
        assert(aInfo.grid === lGoods.length, 'แผงเป้า = ฝ่ายดีทุกคน ได้ ' + aInfo.grid);
        await AL.evaluate(() => document.getElementById('avAction').scrollIntoView({ block: 'start' }));
        await shot(AL, 'assassin-oberon-revealed');
        console.log('9. ลอบสังหาร + โอเบรอน: ฝ่ายร้ายเปิดตัวกัน โอเบรอนแทงไม่ได้ · แผงเป้า = ฝ่ายดี ✓');
        for (const p of lPages) assert(p.errors.length === 0, `lady ${p.role} JS error: ${p.errors.join(' | ')}`);
        for (const p of lPages) await p.ctx.close().catch(() => {});
        lp.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });
        console.log(`\n✅ avalon ux: ผ่าน ${checks} เช็ก · ภาพ ${shotNo} ใบ → ${OUT}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
