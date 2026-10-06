/**
 * Insider UX regression — กันบัคที่เจอตอนไล่ use case บนมือถือ (390×844)
 *
 *  1. ผู้ดำเนินเกม (ไม่ใช่หัวห้อง) กด "มีคนทายถูกแล้ว" ได้เอง → ไปโหวตทันที
 *     คนอื่นที่ไม่ใช่ผู้ดำเนินเกม/หัวห้อง กดไม่ได้ และได้ข้อความบอกเหตุผล
 *  2. ปุ่มตอบด่วน ใช่/ไม่ใช่ ถูกจำในประวัติแชท + ชื่อผู้ตอบมาจาก server (ไม่เชื่อ client)
 *  3. refresh กลางเกม: ประวัติแชท (พร้อมคำตอบของผู้ดำเนินเกม) กลับมาครบ
 *  4. หน้าเว็บของพลเมืองไม่มีคำลับอยู่ใน HTML เลย / จอมบงการ-ผู้ดำเนินเกมมี (ปุ่มดูบทของฉัน)
 *  5. CSS ของกระดานถูก render จริง (เดิมอยู่ใต้ contentFor('style') ที่ layout ไม่มี)
 *  6. โหวต: แตะการ์ด = แค่เลือก (ยังไม่ส่ง) ต้องกดยืนยัน / ผู้ดำเนินเกมกดการ์ดไม่ได้
 *  7. จบเกม: ไม่มี modal ทึบบังผล ปุ่มเล่นอีกรอบ/กลับห้องกดได้จริง + บอกว่า "คุณชนะ/แพ้ เพราะ…"
 *  8. เล่นอีกรอบบนหน้าเดิม: ผู้ดำเนินเกมคนใหม่ (ที่โหลดหน้ามาตอนเป็นบทอื่น) มีปุ่มเปิดเผยคำ
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-insider-ux.js
 */

require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const GM = 'ผู้ดำเนินเกม';
const TRAITOR = 'จอมบงการ';
const SECRET = 'ช้างเผือกทดสอบ';
const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function getFreePort() {
    if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
    return new Promise(resolve => {
        const srv = require('net').createServer();
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

let serverLogs = '';
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; serverLogs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; serverLogs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-600))); });
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ack timeout: ' + event)), 15000);
        socket.emit(event, payload, r => { clearTimeout(t); resolve(r); });
    });
}

function connect(base) {
    return new Promise((resolve, reject) => {
        const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        const t = setTimeout(() => reject(new Error('socket connect timeout')), 15000);
        s.once('connect', () => { clearTimeout(t); resolve(s); });
    });
}

function waitFor(list, predicate, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    return (async () => {
        while (Date.now() < deadline) {
            const hit = list.find(predicate);
            if (hit) return hit;
            await delay(100);
        }
        return null;
    })();
}

function track(player) {
    const s = player.socket;
    player.events = [];
    ['newRole', 'revealWord', 'startGame', 'displayVote2', 'vote2Progress', 'vote2Ended', 'notAuthorized',
        'newMessage', 'gmReactionReceived', 'chatHistory'].forEach(name => {
        s.on(name, payload => player.events.push({ name, payload }));
    });
}

async function openBoard(browser, base, roomId, player) {
    // ปิด socket ดิบก่อน ให้เบราว์เซอร์เป็นตัวแทนผู้เล่นคนนี้แทน
    try { player.socket.close(); } catch {}
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => {
        try {
            sessionStorage.insiderPromoSeen = '1';
            localStorage.setItem('ig-firstplay-insider', '1');
            localStorage.setItem('gameSettings', JSON.stringify({ confirmLeave: false }));
        } catch (e) {}
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => { throw new Error('pageerror: ' + e.message); });
    await page.goto(`${base}/game/${roomId}?playerId=${player.playerId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.jQuery && document.querySelector('#chatMessages'), null, { timeout: 15000 });
    await delay(1500); // socket ต่อ + setRoom + ประวัติแชท/สถานะเฟสเข้ามา
    return page;
}

async function main() {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const results = [];

    try {
        const players = [];
        for (let i = 0; i < 4; i++) {
            const socket = await connect(base);
            const playerId = randomUUID();
            socket.emit('initPlayer', playerId);
            const player = { socket, playerId };
            track(player);
            players.push(player);
        }
        await delay(500);
        const created = await emitAck(players[0].socket, 'createRoom', {
            playerId: players[0].playerId, name: 'InsiderUX', gameMode: 'insider', maxPlayers: 8, roundTime: 5
        });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].playerId });
        for (const p of players.slice(1)) {
            assert((await emitAck(p.socket, 'joinRoom', { roomId, playerId: p.playerId }))?.success, 'join failed');
            p.socket.emit('setRoom', { roomId, playerId: p.playerId });
        }
        await delay(600);
        assert((await emitAck(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'start failed');
        for (const p of players) {
            const ev = await waitFor(p.events, e => e.name === 'newRole', 10000);
            assert(ev, 'no newRole');
            p.role = ev.payload.role;
        }
        const host = players[0];
        let gm = players.find(p => p.role === GM);
        // ต้องการผู้ดำเนินเกมที่ไม่ใช่หัวห้อง (เคสที่เดิมกดจบไม่ได้) — สุ่มใหม่จนได้
        for (let tries = 0; gm === host && tries < 12; tries++) {
            players.forEach(p => { p.events = p.events.filter(e => e.name !== 'newRole'); });
            await delay(2100);
            host.socket.emit('resetGame');
            for (const p of players) {
                const ev = await waitFor(p.events, e => e.name === 'newRole', 6000);
                if (ev) p.role = ev.payload.role;
            }
            gm = players.find(p => p.role === GM);
        }
        assert(gm && gm !== host, 'หา GM ที่ไม่ใช่หัวห้องไม่ได้');
        const traitor = players.find(p => p.role === TRAITOR);
        const citizen = players.find(p => p !== host && p.role !== GM && p.role !== TRAITOR)
            || players.find(p => p !== host && p !== gm);
        const bystander = players.find(p => p !== host && p !== gm);

        // ตั้งคำ → เปิดคำ → เริ่มจับเวลา
        assert((await emitAck(gm.socket, 'setWord', { word: SECRET }))?.ok, 'setWord failed');
        gm.socket.emit('revealWord');
        await delay(2200); // startGame/resetGame ใช้ cooldown 2 วิร่วมกัน
        host.socket.emit('startGame');
        assert(await waitFor(gm.events, e => e.name === 'startGame'), 'ไม่เข้าช่วงจับเวลา');

        // 1. คนที่ไม่ใช่ GM/หัวห้อง กดทายถูกไม่ได้ + มีเหตุผล
        bystander.socket.emit('wordFound');
        const denied = await waitFor(bystander.events, e => e.name === 'notAuthorized', 3000);
        assert(denied && /ผู้ดำเนินเกม/.test(denied.payload.message), 'คนทั่วไปกด wordFound แล้วไม่มีข้อความบอกเหตุผล');
        await delay(500);
        assert(!host.events.some(e => e.name === 'displayVote2'), 'คนทั่วไปกด wordFound แล้วเกมไปโหวต');
        results.push('wordFound: คนทั่วไปกดไม่ได้ + บอกเหตุผล');

        // 2. คำถาม + ปุ่มตอบด่วนของ GM
        citizen.socket.emit('sendMessage', { message: 'เป็นสัตว์ไหม' });
        const question = await waitFor(gm.events, e => e.name === 'newMessage' && e.payload.message === 'เป็นสัตว์ไหม');
        assert(question, 'คำถามไม่ถึง GM');
        gm.socket.emit('gmReaction', { targetMessageId: question.payload.messageId, reactionType: 'yes', playerName: 'ปลอมชื่อ' });
        const reaction = await waitFor(citizen.events, e => e.name === 'gmReactionReceived');
        assert(reaction && reaction.payload.reactionType === 'yes', 'ไม่ได้รับคำตอบ ใช่');
        assert(reaction.payload.gmName !== 'ปลอมชื่อ', 'ชื่อผู้ตอบมาจาก client (ปลอมได้)');
        citizen.events = citizen.events.filter(e => e.name !== 'chatHistory');
        citizen.socket.emit('setRoom', { roomId, playerId: citizen.playerId });
        const hist = await waitFor(citizen.events, e => e.name === 'chatHistory');
        const entry = hist && hist.payload.find(m => m.messageId === question.payload.messageId);
        assert(entry && entry.gmReaction === 'yes', 'คำตอบของ GM ไม่ถูกจำในประวัติแชท');
        results.push('ตอบด่วน: จำในประวัติแชท + ชื่อจาก server');

        // 4+5. หน้าเว็บ: พลเมืองไม่มีคำลับใน HTML, จอมบงการมี, CSS กระดาน render
        const citizenPage = await openBoard(browser, base, roomId, citizen);
        const citizenHtml = await citizenPage.content();
        assert(!citizenHtml.includes(SECRET), 'คำลับหลุดอยู่ใน HTML ของพลเมือง');
        const restored = await citizenPage.evaluate(() => ({
            question: document.querySelector('#chatMessages').textContent.includes('เป็นสัตว์ไหม'),
            answered: !!document.querySelector('#chatMessages .gm-reaction.yes'),
            timerVisible: !!document.querySelector('#countdown') && getComputedStyle(document.querySelector('#countdown')).display !== 'none',
            foundBtnHidden: document.querySelector('#wordFoundBtn').hidden
        }));
        assert(restored.question && restored.answered, 'refresh แล้วประวัติถาม–ตอบหาย ' + JSON.stringify(restored));
        assert(restored.timerVisible, 'refresh กลางช่วงทายคำแล้วไม่เห็นนาฬิกา');
        if (citizen !== host) assert(restored.foundBtnHidden, 'พลเมืองเห็นปุ่มทายถูกแล้ว');
        await citizenPage.click('#insRoleToggle');
        const chip = await citizenPage.evaluate(() => ({
            role: document.querySelector('#insRoleName').textContent,
            wordHidden: document.querySelector('#insRoleWord').hidden
        }));
        assert(chip.role === citizen.role && chip.wordHidden, 'ปุ่มดูบทของพลเมืองผิด ' + JSON.stringify(chip));
        results.push('refresh: แชท+คำตอบกลับมา, พลเมืองไม่เห็นคำลับ, ดูบทได้');

        let traitorPage = null;
        if (traitor && traitor !== host) {
            traitorPage = await openBoard(browser, base, roomId, traitor);
            await traitorPage.click('#insRoleToggle');
            const word = await traitorPage.evaluate(() => document.querySelector('#insRoleWordText').textContent);
            assert(word === SECRET, 'จอมบงการ refresh แล้วดูคำลับซ้ำไม่ได้');
            results.push('จอมบงการ refresh แล้วกดดูคำลับได้');
        }

        // 0. ช่วงทายคำต้อง persist ห้องได้ (เดิมเก็บ Timeout ไว้ใน gameState → JSON circular ทุกครั้ง)
        // (เปิดหน้าเว็บ = setRoom/reconnect → server persist ห้อง)
        await delay(800);
        assert(!/Failed to persist rooms/.test(serverLogs), 'persist ห้องพังช่วงทายคำ (Timeout อยู่ใน gameState)');
        results.push('ช่วงทายคำ: persist ห้องได้ ไม่ circular');

        // 1b. GM (ไม่ใช่หัวห้อง) refresh กลางช่วงทายคำ แล้วกดปุ่ม "มีคนทายถูกแล้ว" บนจอ → ทุกคนไปโหวต
        const gmPage = await openBoard(browser, base, roomId, gm);
        await gmPage.waitForSelector('#wordFoundBtn', { state: 'visible', timeout: 5000 })
            .catch(() => { throw new Error('ผู้ดำเนินเกม refresh แล้วไม่มีปุ่ม "มีคนทายถูกแล้ว"'); });
        await gmPage.click('#wordFoundBtn');
        await gmPage.click('.swal2-confirm');
        assert(await waitFor(host.events, e => e.name === 'displayVote2'), 'GM กดทายถูกแล้วไม่ไปโหวต');
        await citizenPage.waitForSelector('.btn-vote2-player', { timeout: 5000 });
        results.push('wordFound: ผู้ดำเนินเกมกดเองได้ → โหวตทันที');

        // 5. CSS กระดานถูก render (เครื่องหมายถูกซ่อนจนกว่าจะเลือก)
        const checkOpacity = await citizenPage.evaluate(() => getComputedStyle(document.querySelector('.btn-vote2-player .checkmark')).opacity);
        assert(checkOpacity === '0', 'CSS กระดานไม่ถูก render (✓ โผล่ทุกการ์ด) opacity=' + checkOpacity);

        // 6. แตะการ์ด = เลือกเฉยๆ ต้องกดยืนยัน
        const progressBefore = host.events.filter(e => e.name === 'vote2Progress').length;
        await citizenPage.click('.btn-vote2-player >> nth=0');
        await delay(700);
        assert(host.events.filter(e => e.name === 'vote2Progress').length === progressBefore, 'แตะการ์ดครั้งเดียวส่งโหวตเลย (แตะพลาดแก้ไม่ได้)');
        await citizenPage.click('.btn-vote2-player >> nth=1');
        const confirmText = await citizenPage.evaluate(() => document.querySelector('#confirmVote2Btn').textContent);
        assert(/ยืนยัน/.test(confirmText), 'ไม่มีปุ่มยืนยันโหวต');
        await citizenPage.click('#confirmVote2Btn');
        const prog = await waitFor(host.events, e => e.name === 'vote2Progress'
            && e.payload.voterChoices.some(c => c.voterId === citizen.playerId), 5000);
        assert(prog, 'กดยืนยันแล้วโหวตไม่ถึง server');
        results.push('โหวต: แตะ=เลือก เปลี่ยนใจได้ กดยืนยันถึงส่ง');

        // GM: การ์ดกดไม่ได้ + มีคำอธิบาย
        const gmVote = await gmPage.evaluate(() => ({
            note: !document.querySelector('#vote2GmNote').hidden,
            disabled: [...document.querySelectorAll('.btn-vote2-player')].every(b => b.disabled)
        }));
        assert(gmVote.note && gmVote.disabled, 'ผู้ดำเนินเกมกดโหวตได้/ไม่มีคำอธิบาย ' + JSON.stringify(gmVote));
        results.push('ผู้ดำเนินเกม: การ์ดโหวตล็อก + บอกว่าไม่ต้องโหวต');

        // ที่เหลือโหวตผ่าน socket → จบเกม (vote2 ต้องส่งชื่อตัวเองมาด้วย — เอาจาก progress.targets)
        const vote = (await waitFor(host.events, e => e.name === 'displayVote2')).payload;
        const candidates = vote.players;
        const nameOf = id => (vote.progress.targets.find(t => t.playerId === id) || {}).name;
        if (traitorPage) {
            await traitorPage.click('.btn-vote2-player >> nth=0');
            await traitorPage.click('#confirmVote2Btn');
        }
        for (const p of players) {
            if (p === gm || p === citizen || (traitorPage && p === traitor)) continue;
            p.socket.emit('vote2', { player: nameOf(p.playerId), vote: candidates[0].playerId });
        }
        await citizenPage.waitForSelector('#vote2Result', { state: 'visible', timeout: 20000 });
        await delay(1200);

        // 7. ผลเกม: ไม่มี modal บัง ปุ่มกดได้ + บอกผลของฉัน
        const end = await citizenPage.evaluate(() => {
            const modal = document.querySelector('#returnToLobbyModal');
            const back = document.querySelector('#insiderBackRoomBtn');
            back.scrollIntoView({ block: 'center' });
            const r = back.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
                modalShown: getComputedStyle(modal).display !== 'none',
                backClickable: !!hit && (hit === back || back.contains(hit)),
                outcome: document.querySelector('#insMyOutcome').innerText
            };
        });
        assert(!end.modalShown, 'modal "กำลังพากลับ Lobby" บังการ์ดผล');
        assert(end.backClickable, 'ปุ่มกลับห้องโดนบัง กดไม่ได้');
        assert(/คุณ(ชนะ|แพ้)/.test(end.outcome) && /คุณเป็น/.test(end.outcome), 'ไม่บอกว่าฉันชนะ/แพ้เพราะอะไร: ' + end.outcome);
        results.push('จบเกม: ไม่มี modal บัง, ปุ่มกดได้, บอกผลของฉัน+เหตุผล');

        // 8. เล่นอีกรอบบนหน้าเดิม — ทำจนกว่าคนที่เปิดเบราว์เซอร์ (citizen) ได้เป็นผู้ดำเนินเกม
        let becameGm = false;
        for (let tries = 0; tries < 15 && !becameGm; tries++) {
            await delay(2100);
            host.socket.emit('resetGame');
            await delay(700);
            becameGm = await citizenPage.evaluate(() => document.querySelector('#reset .role strong').textContent === 'ผู้ดำเนินเกม');
        }
        assert(becameGm, 'สุ่มหลายรอบแล้วพลเมืองไม่ได้เป็นผู้ดำเนินเกมสักที');
        await citizenPage.waitForSelector('#wordInput', { state: 'visible', timeout: 9000 });
        await citizenPage.fill('#wordInput', 'แมวทดสอบ');
        await citizenPage.click('#wordForm button[type=submit]');
        await citizenPage.waitForSelector('#reveal button', { state: 'visible', timeout: 5000 });
        host.events = host.events.filter(e => e.name !== 'revealWord');
        await citizenPage.click('#reveal button');
        assert(await waitFor(host.events, e => e.name === 'revealWord', 5000), 'ผู้ดำเนินเกมคนใหม่กดเปิดเผยคำไม่ได้');
        const quick = await citizenPage.evaluate(() => document.body.classList.contains('gm-role'));
        assert(quick, 'ผู้ดำเนินเกมคนใหม่ไม่มีปุ่มตอบด่วน');
        results.push('เล่นอีกรอบ: ผู้ดำเนินเกมคนใหม่เปิดคำได้ + มีปุ่มตอบด่วน');

        players.forEach(p => { try { p.socket.close(); } catch {} });
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    results.forEach(r => console.log('  ✓ ' + r));
    console.log('\n✅ INSIDER UX CHECKS PASSED');
    process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
