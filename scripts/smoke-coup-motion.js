/**
 * อนิเมชันของกระดาน Coup
 *
 * อนิเมชันโผล่แค่เสี้ยววินาที ถ้าไปเช็คทีหลังจะไม่เจอ
 * เลยติด MutationObserver ไว้ตั้งแต่ก่อนเกมเดิน แล้วค่อยมาอ่านสิ่งที่มันบันทึกไว้
 *
 * ครอบ:
 *   - แจกการ์ดเข้ามือ / จั่วใบใหม่
 *   - การ์ดโดนหงาย
 *   - เหรียญขึ้นลง (ตัวเลขลอย)
 *   - ป้ายประกาศ ⚔️ ท้า! และต้องไม่บังปุ่ม (pointer-events: none)
 *   - บรรทัดใหม่ในบันทึกเกม
 *   - ผู้เล่นตกรอบ / เปลี่ยนตา
 *   - prefers-reduced-motion ปิดอนิเมชันได้จริง
 *
 * รัน: node scripts/smoke-coup-motion.js
 */
require('./isolateTestData');
const path = require('path');
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

// บันทึกทุกคลาสอนิเมชันที่เคยถูกติด และทุก element ที่เคยถูกเพิ่ม
const OBSERVER = `
window.__motion = { classes: {}, flashPointerEvents: null, flashLabels: [] };
(function () {
    const track = cls => { window.__motion.classes[cls] = (window.__motion.classes[cls] || 0) + 1; };
    const WATCH = ['cp-anim-deal', 'cp-anim-reveal', 'cp-anim-out', 'cp-anim-turn',
                   'cp-anim-coin', 'cp-anim-new', 'cp-anim-swap', 'is-urgent', 'is-on'];

    const scan = node => {
        if (!node || node.nodeType !== 1) return;
        WATCH.forEach(c => { if (node.classList && node.classList.contains(c)) track(c); });
        if (node.classList && node.classList.contains('cp-coin-delta')) {
            track('cp-coin-delta:' + (node.textContent || '').trim());
        }
        if (node.id === 'cpFlash' && node.classList.contains('is-on')) {
            window.__motion.flashPointerEvents = getComputedStyle(node).pointerEvents;
            window.__motion.flashLabels.push((node.textContent || '').trim().slice(0, 24));
        }
        if (node.querySelectorAll) node.querySelectorAll('*').forEach(scan);
    };

    const observer = new MutationObserver(records => {
        records.forEach(r => {
            if (r.type === 'childList') r.addedNodes.forEach(scan);
            if (r.type === 'attributes') scan(r.target);
        });
    });

    // สคริปต์นี้ถูกฉีดตั้งแต่ก่อนมี document.body — ต้องรอ body ก่อนถึงจะ observe ได้
    const start = () => observer.observe(document.body,
        { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
`;

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const errors = [];

    try {
        // เฟส/ตา เหมือนกันทุกคน เก็บไว้ตัวกลางเพื่อขับเกม
        // (ของใครของมันดูจาก states ของคนนั้น เพราะการ์ดในมือเห็นเฉพาะเจ้าตัว)
        let shared = null;
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('coupState', s => { states.push(s); shared = s; });
            players.push({ socket, id, states });
        }
        await delay(500);

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'CoupMotion', gameMode: 'coup', maxPlayers: 6
        });
        assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(700);
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        // เริ่มเกมมี countdown 3 วิก่อนแจกการ์ดจริง
        await delay(4200);
        // ปกติหน้ากระดานเป็นคนขอ state ตอนโหลด — socket เทสต้องขอเอง
        players.forEach(p => p.socket.emit('coup_requestState', { roomId, playerId: p.id }));
        await delay(900);

        const latest = () => shared;
        const turnId = latest()?.currentPlayerId;
        assert(turnId, `ไม่รู้ว่าถึงตาใคร (ได้ state ${players.map(p => p.states.length).join('/')} ครั้ง, ` +
            `phase=${latest()?.phase}, keys=${latest() ? Object.keys(latest()).slice(0, 8).join(',') : 'none'})`);
        // ดูจากตาของคนที่ "ไม่ได้" ถึงตา จะได้เห็นทั้งของตัวเองและของคนอื่น
        const viewer = players.find(p => p.id !== turnId);
        const actor = players.find(p => p.id === turnId);
        const challenger = players.find(p => p.id !== turnId && p.id !== viewer.id) || viewer;

        const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 } });
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push('board: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        await page.addInitScript(OBSERVER);
        await page.goto(`${base}/game/${roomId}?playerId=${viewer.id}`, { waitUntil: 'networkidle' });
        await delay(1500);

        // ---------- 1. แจกการ์ด ----------
        const dealt = await page.evaluate(() => window.__motion.classes['cp-anim-deal'] || 0);
        assert(dealt >= 2, `การ์ดควรเล่นอนิเมชันแจกอย่างน้อย 2 ใบ ได้ ${dealt}`);
        console.log(`1. แจกการ์ดเข้ามือมีอนิเมชัน ✓  (${dealt} ใบ)`);

        // ---------- 2. เก็บภาษี → เหรียญ + บันทึกเกม + เปลี่ยนข้อความ ----------
        assert((await ack(actor.socket, 'coup_submitAction', { actionId: 'tax' }))?.success, 'ประกาศเก็บภาษีไม่ได้');
        await delay(900);

        const afterTax = await page.evaluate(() => window.__motion.classes);
        assert((afterTax['cp-anim-new'] || 0) > 0, 'บรรทัดใหม่ในบันทึกเกมไม่มีอนิเมชัน');
        assert((afterTax['cp-anim-swap'] || 0) > 0, 'แถบ "ตอนนี้" เปลี่ยนข้อความแบบไม่มีอนิเมชัน');
        console.log('2. บันทึกเกม + แถบ "ตอนนี้" มีอนิเมชันตอนอัปเดต ✓');

        // ---------- 3. ท้า → ป้ายประกาศ ----------
        assert((await ack(challenger.socket, 'coup_respond', { response: 'challenge' }))?.success, 'ท้าไม่ได้');
        await delay(1000);

        const flash = await page.evaluate(() => ({
            labels: window.__motion.flashLabels,
            pe: window.__motion.flashPointerEvents,
            classes: window.__motion.classes
        }));
        assert(flash.labels.length > 0, 'ไม่มีป้ายประกาศตอนมีคนท้า');
        assert(/ท้า/.test(flash.labels.join(' ')), `ป้ายประกาศไม่ใช่เรื่องท้า: ${JSON.stringify(flash.labels)}`);
        // ป้ายคลุมกลางจอ ถ้ากินคลิกจะเล่นต่อไม่ได้เลย
        assert(flash.pe === 'none', `ป้ายประกาศบังการกด (pointer-events: ${flash.pe})`);
        console.log(`3. ป้ายประกาศ "${flash.labels[0]}" ขึ้น และไม่บังการกด ✓`);

        // ---------- 5. เดินเกมต่อจนมีคนหงายการ์ด/ตกรอบ ----------
        for (let step = 0; step < 24; step++) {
            const s = latest();
            if (!s || s.phase === 'finished') break;

            if (s.phase === 'lose-influence' && s.pendingLoss) {
                const loser = players.find(p => p.id === s.pendingLoss.playerId);
                if (loser) { loser.socket.emit('coup_requestState', { roomId, playerId: loser.id }); await delay(200); }
                const own = loser?.states[loser.states.length - 1]?.self?.influence?.[0];
                if (loser && own) await ack(loser.socket, 'coup_loseInfluence', { cardId: own.id });
            } else if (s.phase === 'exchange' && s.pendingExchange?.playerId) {
                const who = players.find(p => p.id === s.pendingExchange.playerId);
                if (who) { who.socket.emit('coup_requestState', { roomId, playerId: who.id }); await delay(200); }
                const opts = who?.states[who.states.length - 1]?.pendingExchange?.options || [];
                const keep = who?.states[who.states.length - 1]?.pendingExchange?.keepCount || 1;
                if (who && opts.length) {
                    await ack(who.socket, 'coup_exchange', { keepCardIds: opts.slice(0, keep).map(c => c.id) });
                }
            } else if (s.phase === 'respond' || s.phase === 'block-respond') {
                for (const p of players) {
                    if (p.id !== s.currentPlayerId) await ack(p.socket, 'coup_respond', { response: 'pass' });
                }
            } else if (s.phase === 'action') {
                const cur = players.find(p => p.id === s.currentPlayerId);
                if (cur) { cur.socket.emit('coup_requestState', { roomId, playerId: cur.id }); await delay(200); }
                const mine = cur?.states[cur.states.length - 1];
                const canCoup = (mine?.self?.coins || 0) >= 7;
                const victim = (s.players || []).find(p => p.alive && p.playerId !== s.currentPlayerId);
                if (cur) {
                    await ack(cur.socket, 'coup_submitAction', canCoup && victim
                        ? { actionId: 'coup', targetPlayerId: victim.playerId }
                        : { actionId: 'tax' });
                }
            }
            await delay(450);
        }

        const final = await page.evaluate(() => window.__motion.classes);

        // ---------- 4. เหรียญขยับ ----------
        // เช็คหลังเล่นไปหลายตา เพราะตาแรกอาจโดนท้าจนแอ็กชันเป็นโมฆะ เหรียญไม่ขยับ
        const coinKeys = Object.keys(final).filter(k => k.startsWith('cp-coin-delta:'));
        assert(coinKeys.length > 0,
            'เหรียญเปลี่ยนแล้วแต่ไม่มีตัวเลขลอยขึ้น — คลาสที่บันทึกได้: ' + JSON.stringify(final));
        assert(coinKeys.some(k => /[+-]\d/.test(k)), `ตัวเลขลอยไม่มีเครื่องหมาย +/-: ${coinKeys.join(', ')}`);
        console.log(`4. เหรียญเปลี่ยนแล้วมีตัวเลขลอย ✓  (${coinKeys.map(k => k.split(':')[1]).join(' ')})`);

        assert((final['cp-anim-reveal'] || 0) > 0 || (final['cp-anim-out'] || 0) > 0,
            'เล่นจนมีคนเสียการ์ดแล้วแต่ไม่มีอนิเมชันหงายการ์ด/ตกรอบเลย');
        assert((final['cp-anim-turn'] || 0) > 0, 'เปลี่ยนตาแล้วแต่ไม่มีอนิเมชันไฮไลต์คนที่ถึงตา');
        console.log(`5. หงายการ์ด/ตกรอบ + เปลี่ยนตา มีอนิเมชัน ✓  ` +
            `(reveal=${final['cp-anim-reveal'] || 0} out=${final['cp-anim-out'] || 0} turn=${final['cp-anim-turn'] || 0})`);

        assert(errors.length === 0, 'มี JS error:\n' + errors.join('\n'));

        // ---------- 6. เคารพ prefers-reduced-motion ----------
        const quietCtx = await browser.newContext({ viewport: { width: 1100, height: 950 }, reducedMotion: 'reduce' });
        const quiet = await quietCtx.newPage();
        const quietErrors = [];
        quiet.on('pageerror', e => quietErrors.push(e.message));
        await quiet.addInitScript(OBSERVER);
        await quiet.goto(`${base}/game/${roomId}?playerId=${viewer.id}`, { waitUntil: 'networkidle' });
        await delay(1500);

        const quietState = await quiet.evaluate(() => ({
            classes: window.__motion.classes,
            flashDisplay: getComputedStyle(document.getElementById('cpFlash')).display,
            handAnim: Array.from(document.querySelectorAll('#myHand .cp-influence'))
                .map(el => getComputedStyle(el).animationName)
        }));
        assert((quietState.classes['cp-anim-deal'] || 0) === 0,
            'โหมดลดการเคลื่อนไหวยังติดคลาสอนิเมชันแจกการ์ดอยู่');
        assert(quietState.handAnim.every(n => n === 'none'),
            `โหมดลดการเคลื่อนไหวยังเล่นอนิเมชันการ์ด: ${quietState.handAnim.join(', ')}`);
        assert(quietErrors.length === 0, 'โหมดลดการเคลื่อนไหวมี JS error: ' + quietErrors.join('\n'));
        console.log('6. prefers-reduced-motion ปิดอนิเมชันได้จริง ✓');

        console.log('\n✅ อนิเมชัน Coup ผ่านทั้งหมด (ไม่มี JS error)');
    } finally {
        await browser.close();
        server.kill('SIGKILL');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
