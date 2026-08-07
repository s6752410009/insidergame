/**
 * แดชบอร์ดแอดมินต้องเห็น Coup เหมือนโหมดอื่น
 *
 * เดิม Coup ถูกเพิ่มเป็นโหมดที่ 5 แต่ admin.ejs ไม่เคยรู้จัก —
 * ตัวกรองห้อง/ตัวกรองผู้เล่น/สถิติรายโหมด ไม่มี Coup เลยสักที่
 * (statsManager บันทึก modeStats.coup ให้อยู่แล้ว ข้อมูลมีแต่ไม่ถูกแสดง)
 *
 * เทสนี้เล่น Coup จนจบจริง แล้วเปิดแดชบอร์ดดูว่าตัวเลขขึ้นครบ
 *
 * รัน: node scripts/smoke-admin-coup.js
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

// อ่านรหัสตอนรัน — ห้าม hardcode ลงไฟล์ที่ commit ขึ้น repo
const ADMIN_PASSWORD = (() => {
    try { return require('../settings.json').adminPassword || 'admin123'; }
    catch (e) { return 'admin123'; }
})();
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
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 12000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const errors = [];

    try {
        // ---------- เล่น Coup จนจบ ----------
        const players = [];
        for (let i = 0; i < 2; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('coupState', s => states.push(s));
            players.push({ socket, id, states });
        }
        await delay(600);

        for (const [i, p] of players.entries()) {
            await fetch(`${base}/profile/updateName?playerId=${p.id}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: `นักโค่น${i + 1}` })
            }).catch(() => {});
        }

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'วงโค่นอำนาจ', gameMode: 'coup', maxPlayers: 6
        });
        assert(created?.success, 'สร้างห้อง Coup ไม่ได้');
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        assert((await ack(players[1].socket, 'joinRoom', { roomId, playerId: players[1].id }))?.success, 'join ไม่ได้');
        players[1].socket.emit('setRoom', { roomId, playerId: players[1].id });
        await delay(700);
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await delay(4300);

        const shared = () => players.map(p => p.states[p.states.length - 1]).filter(Boolean).pop();
        players.forEach(p => p.socket.emit('coup_requestState', { roomId, playerId: p.id }));
        await delay(800);

        // เดินเกมจนมีผู้ชนะ
        for (let step = 0; step < 60; step++) {
            const s = shared();
            if (!s || s.phase === 'finished') break;

            if (s.phase === 'lose-influence' && s.pendingLoss) {
                const loser = players.find(p => p.id === s.pendingLoss.playerId);
                if (loser) {
                    loser.socket.emit('coup_requestState', { roomId, playerId: loser.id });
                    await delay(250);
                    const card = loser.states[loser.states.length - 1]?.self?.influence?.[0];
                    if (card) await ack(loser.socket, 'coup_loseInfluence', { cardId: card.id });
                }
            } else if (s.phase === 'exchange' && s.pendingExchange?.playerId) {
                const who = players.find(p => p.id === s.pendingExchange.playerId);
                if (who) {
                    who.socket.emit('coup_requestState', { roomId, playerId: who.id });
                    await delay(250);
                    const pe = who.states[who.states.length - 1]?.pendingExchange;
                    if (pe?.options?.length) {
                        await ack(who.socket, 'coup_exchange', { keepCardIds: pe.options.slice(0, pe.keepCount).map(c => c.id) });
                    }
                }
            } else if (s.phase === 'respond' || s.phase === 'block-respond') {
                for (const p of players) {
                    if (p.id !== s.currentPlayerId) await ack(p.socket, 'coup_respond', { response: 'pass' });
                }
            } else if (s.phase === 'action') {
                const cur = players.find(p => p.id === s.currentPlayerId);
                if (cur) {
                    cur.socket.emit('coup_requestState', { roomId, playerId: cur.id });
                    await delay(250);
                    const coins = cur.states[cur.states.length - 1]?.self?.coins || 0;
                    const victim = (s.players || []).find(p => p.alive && p.playerId !== s.currentPlayerId);
                    await ack(cur.socket, 'coup_submitAction', coins >= 7 && victim
                        ? { actionId: 'coup', targetPlayerId: victim.playerId }
                        : { actionId: 'tax' });
                }
            }
            await delay(400);
        }

        const finished = shared();
        assert(finished?.phase === 'finished', `เกมยังไม่จบ (เฟส ${finished?.phase})`);
        console.log(`1. เล่น Coup จนจบ — ผู้ชนะ "${finished.winner?.name}" ✓`);
        await delay(1500);

        // ---------- เปิดแดชบอร์ดแอดมิน ----------
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push('admin: ' + e.message));
        // ERR_ABORTED = คำขอถูกยกเลิกตอนเอกสารถูกแทนที่ ไม่ใช่ของพัง
        // (ฟอนต์ Google ก็โดนแบบเดียวกัน) กล่องข้อความมี smoke-admin-inbox-browser.js ดูแลอยู่แล้ว
        const IGNORE = /Failed to fetch|ERR_ABORTED|fonts\.gstatic\.com/;
        page.on('console', m => {
            if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text());
        });
        page.on('response', r => {
            if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
        });

        // ลำดับเดียวกับ smoke-admin-inbox-browser.js — รอ navigation ให้จบก่อน
        // ไม่งั้น fetch ที่ค้างจากเอกสารเก่าโดนยกเลิกแล้วโผล่เป็น "Failed to fetch"
        await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
        await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
        await Promise.all([
            page.waitForURL(url => url.pathname === '/admin', { timeout: 20000 }),
            page.locator('.login-form button[type="submit"]').click()
        ]);
        await page.locator('#adminInboxBadge').waitFor({ state: 'attached', timeout: 20000 });
        await delay(2500);
        assert(!page.url().includes('/admin/login'),
            'ล็อกอินแอดมินไม่ผ่าน — รหัสใน settings.json ไม่ตรงกับที่ server ใช้');

        // 2. ตัวเลือก Coup ในตัวกรองต่างๆ
        const options = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('select option'));
            return {
                mode: all.filter(o => o.value === 'coup').length,
                hasCoup: all.filter(o => o.value === 'has-coup').length,
                totalSelects: document.querySelectorAll('select').length,
                totalOptions: all.length,
                sampleValues: all.slice(0, 12).map(o => o.value),
                url: location.pathname,
                title: (document.title || '').slice(0, 40)
            };
        });
        assert(options.mode >= 2,
            `ตัวเลือกโหมด Coup ควรมีในหลายตัวกรอง เจอ ${options.mode} · ` +
            `หน้า=${options.url} "${options.title}" select=${options.totalSelects} option=${options.totalOptions} ` +
            `ตัวอย่าง=[${options.sampleValues.join(',')}]`);
        assert(options.hasCoup === 1, `ตัวกรองผู้เล่น "มี Coup" หายไป (เจอ ${options.hasCoup})`);
        console.log(`2. ตัวกรองมี Coup แล้ว — โหมด ${options.mode} จุด, "มี Coup" ${options.hasCoup} จุด ✓`);

        // 3. สถิติรายโหมดของผู้เล่นต้องมีแถว Coup พร้อมตัวเลขจริง
        // คลิกแท็บให้ตรงปุ่มจริง — เดิมกวาดหา element ที่มีคำว่า "สถิติ" แล้วเผลอไปโดนลิงก์
        await page.click('.tab-btn[data-tab="stats"]');
        await delay(2500);

        const stats = await page.evaluate(() => {
            const body = document.body.textContent || '';
            const m = body.match(/👑 Coup (\d+) เกม/);
            return { found: !!m, games: m ? Number(m[1]) : 0, hasSpyfallRow: /🕵️ Spyfall \d+ เกม/.test(body) };
        });
        assert(stats.hasSpyfallRow || stats.found, 'ไม่เจอแถวสถิติรายโหมดเลย (แท็บอาจไม่เปิด)');
        assert(stats.found, 'ตารางสถิติผู้เล่นไม่มีแถว Coup');
        assert(stats.games >= 1, `แถว Coup ขึ้นแต่จำนวนเกมเป็น ${stats.games} (ควร >= 1 เพราะเพิ่งเล่นจบ)`);
        console.log(`3. สถิติผู้เล่นมีแถว "👑 Coup ${stats.games} เกม" ✓`);

        assert(errors.length === 0, 'มี JS error ในแดชบอร์ด:\n' + errors.join('\n'));
        console.log('\n✅ แดชบอร์ดแอดมินเห็น Coup ครบแล้ว (ไม่มี JS error)');
    } finally {
        await browser.close();
        server.kill('SIGKILL');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
