/**
 * UX ของกระดาน Coup บนจอมือถือ (390×844) — กันจุดกวนใจที่เคยเจอกลับมา
 *
 * ครอบ:
 *   - ปุ่มแอ็กชันที่กดไม่ได้ยังโชว์ พร้อมเหตุผล (🔒 ต้องมี 7 เหรียญ)
 *   - กดปล่อยผ่านแล้วขึ้น "✓ คุณปล่อยผ่านแล้ว" + รายชื่อคนที่ยังคิดอยู่ + ป้ายในรายชื่อ
 *   - กดปล่อยผ่านรัวๆ ไม่เด้ง error "ตอบไปแล้ว"
 *   - ทุกคนผ่านครบ = ไปต่อทันที ไม่รอหมดเวลา
 *   - แถบ "ตอนนี้" ติดขอบบนจอตอนเลื่อน + บรรทัด "ล่าสุด"
 *   - แลกการ์ด: มือไม่ขึ้น "ตกรอบแล้ว", ใบเดิมถูกเลือกไว้, ติดป้ายใบเดิม/ใบใหม่
 *   - หงายการ์ด: แตะแล้วยังไม่หงาย ต้องกดยืนยัน + บอกเหตุผลที่ต้องหงาย
 *   - รัฐประหาร/ลอบสังหาร: แตะชื่อเป้าหมายแล้วต้องกดยืนยัน
 *   - จบเกม: บอกผลของตัวเอง + เปิดการ์ดที่เหลือในมือทุกคน
 *
 * รัน: ALLOW_LEGACY_SOCKET_IDENTITY=1 node scripts/smoke-coup-ux.js
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function assert(c, m) { if (!c) throw new Error(m); passed += 1; }

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
        env: { ...process.env, PORT: String(port), WALLETS_FILE: path.join(process.env.GAME_DATA_DIR || '', 'wallets.json') },
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

// เก็บ state ล่าสุดที่หน้าเว็บได้รับ + นับ toast/popup error ที่เด้งขึ้น
const INIT = `
try { sessionStorage.insiderPromoSeen = '1'; localStorage.setItem('ig-firstplay-coup', '1'); } catch (e) {}
window.__errorsShown = 0;
(function () {
  let real;
  Object.defineProperty(window, 'io', { configurable: true, get() { return real; }, set(fn) {
    real = function () { const s = fn.apply(this, arguments); s.on('coupState', st => { window.__state = st; }); return s; };
    Object.assign(real, fn);
  } });
  const watch = () => new MutationObserver(() => {
    const t = document.querySelector('.swal2-title');
    if (t && t.textContent && !t.__seen) { t.__seen = true; window.__errorsShown += 1; window.__lastError = t.textContent; }
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
})();
`;

async function newRoom(base, n) {
    const players = [];
    for (let i = 0; i < n; i++) {
        const socket = await conn(base);
        const id = randomUUID();
        socket.emit('initPlayer', id);
        const states = [];
        socket.on('coupState', s => states.push(s));
        players.push({ socket, id, states, last: () => states[states.length - 1] });
    }
    await delay(400);
    const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name: 'CoupUX', gameMode: 'coup', maxPlayers: 6 });
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await delay(500);
    assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
    await delay(1500);
    return { players, roomId };
}

async function openPhone(browser, base, roomId, player) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    page.jsErrors = [];
    page.on('pageerror', e => page.jsErrors.push(e.message));
    await page.goto(`${base}/?playerId=${player.id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/game/${roomId}?playerId=${player.id}`, { waitUntil: 'networkidle' });
    await delay(1000);
    return page;
}
const stateOf = page => page.evaluate(() => window.__state);

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({ headless: true });

    try {
        // ===== ห้อง 3 คน: คนแรกและคนที่สองเล่นผ่านเบราว์เซอร์มือถือ =====
        const { players, roomId } = await newRoom(base, 3);
        players[0].socket.close(); players[1].socket.close();
        const p0 = await openPhone(browser, base, roomId, players[0]);
        const p1 = await openPhone(browser, base, roomId, players[1]);
        const P2 = players[2];

        // 1. เมนูแอ็กชัน — ปุ่มที่เหรียญไม่พอยังเห็น แต่ล็อกพร้อมเหตุผล
        const menu = await p0.$$eval('.cp-action', els => els.map(e => ({ id: e.dataset.action, disabled: e.disabled, text: e.textContent })));
        assert(menu.length === 7, `ต้องเห็นแอ็กชันครบ 7 ปุ่ม (ได้ ${menu.length})`);
        const coupBtn = menu.find(a => a.id === 'coup');
        assert(coupBtn.disabled && /ต้องมี 7 เหรียญ/.test(coupBtn.text), 'ปุ่มรัฐประหารต้องล็อกและบอกว่าต้องมี 7 เหรียญ');
        assert(!menu.find(a => a.id === 'tax').disabled, 'ปุ่มเก็บภาษีต้องกดได้');
        const hasDuke = (await stateOf(p0)).self.influence.some(c => c.id === 'duke');
        const taxText = menu.find(a => a.id === 'tax').text;
        assert(hasDuke ? /คุณมีจริง/.test(taxText) : /บลัฟ/.test(taxText), 'ปุ่มที่ต้องอ้างการ์ดต้องบอกว่ามีจริงหรือบลัฟ: ' + taxText);
        console.log('1. ปุ่มที่กดไม่ได้ยังโชว์พร้อมเหตุผล 🔒 ✓');

        // 2. ประกาศเก็บภาษี → คนตอบเห็นคำอธิบายผลของแต่ละปุ่ม
        await p0.click('.cp-action[data-action="tax"]');
        await delay(900);
        const hint = await p1.textContent('#actionArea');
        assert(/ถ้ามีจริง/.test(hint) && /เสียการ์ด 1 ใบ/.test(hint), 'ช่วงตอบโต้ต้องอธิบายว่าท้าแล้วเสี่ยงอะไร');
        console.log('2. ช่วงตอบโต้บอกผลของปุ่มท้า/ปล่อยผ่าน ✓');

        // 3. แถบ "ตอนนี้" ติดขอบบนจอแม้เลื่อนลงไปสุด + มีบรรทัดล่าสุด
        await p1.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(300);
        const barTop = await p1.evaluate(() => document.getElementById('cpNowBar').getBoundingClientRect().top);
        assert(Math.abs(barTop) < 2, `แถบตอนนี้ต้องติดขอบบนจอ (top=${barTop})`);
        const lastLine = await p1.textContent('#cpNowLast');
        assert(/ล่าสุด/.test(lastLine) && /เก็บภาษี/.test(lastLine), 'แถบบนต้องบอกเหตุการณ์ล่าสุด: ' + lastLine);
        console.log('3. แถบ "ตอนนี้" ติดขอบบน + บรรทัดล่าสุด ✓');

        // 4. กดปล่อยผ่านรัวๆ → ไม่มี error เด้ง, ขึ้นว่าปล่อยผ่านแล้ว + รอใคร
        await p1.evaluate(() => { const b = document.querySelector('[data-respond="pass"]'); b.click(); b.click(); b.click(); });
        await delay(900);
        assert(await p1.evaluate(() => window.__errorsShown) === 0, 'กดรัวแล้วไม่ควรเด้ง error: ' + await p1.evaluate(() => window.__lastError));
        const waitText = await p1.textContent('#actionArea');
        assert(/คุณปล่อยผ่านแล้ว/.test(waitText), 'กดแล้วต้องบอกว่าปล่อยผ่านแล้ว');
        const p2Name = (await stateOf(p1)).players.find(p => p.playerId === P2.id).name;
        assert(waitText.includes(p2Name), 'ต้องบอกชื่อคนที่ยังไม่ตัดสินใจ');
        const tags = await p0.$$eval('.cp-tag', els => els.map(e => e.textContent));
        assert(tags.some(t => /ผ่าน/.test(t)) && tags.some(t => /กำลังคิด/.test(t)), 'รายชื่อต้องมีป้าย ✓ผ่าน / ⏳กำลังคิด: ' + tags.join('|'));
        console.log('4. กดปล่อยผ่านรัวๆ ไม่ error · บอกว่าผ่านแล้ว · บอกว่ารอใคร ✓');

        // 5. คนสุดท้ายผ่าน → ไปต่อทันที (ไม่รอ 20 วิ)
        const t0 = Date.now();
        await ack(P2.socket, 'coup_respond', { response: 'pass' });
        await delay(400);
        const after = await stateOf(p0);
        assert(after.phase === 'action' && after.currentPlayerId === players[1].id && Date.now() - t0 < 3000, 'ทุกคนผ่านครบต้องไปตาถัดไปทันที');
        console.log('5. ทุกคนผ่านครบ → ไปต่อทันที ✓');

        // 6. แลกการ์ด (p1 ประกาศทูต ทุกคนผ่าน)
        await p1.click('.cp-action[data-action="exchange"]');
        await delay(700);
        await p0.click('[data-respond="pass"]');
        await ack(P2.socket, 'coup_respond', { response: 'pass' });
        await delay(900);
        assert((await stateOf(p1)).phase === 'exchange', 'ทุกคนผ่านต้องเข้าเฟสแลกการ์ด');
        const handText = await p1.textContent('#myHand');
        assert(!/ตกรอบแล้ว/.test(handText), 'ระหว่างแลกการ์ดห้ามขึ้นว่าตกรอบแล้ว');
        const ex = await p1.$$eval('[data-exchange-index]', els => els.map(e => ({ sel: e.classList.contains('is-selected'), tag: e.querySelector('.cp-card-tag')?.textContent })));
        assert(ex.length === 4 && ex[0].sel && ex[1].sel && !ex[2].sel && ex[0].tag === 'ใบเดิม' && ex[2].tag === 'ใบใหม่', 'ใบเดิมต้องถูกเลือกไว้และติดป้าย: ' + JSON.stringify(ex));
        const p0View = await stateOf(p0);
        assert(p0View.players.find(p => p.playerId === players[1].id).influenceCount === 2, 'คนอื่นต้องเห็นทูตยังมีการ์ด 2 ใบ');
        // แตะใบใหม่ตอนเลือกครบ = สลับ (เดิมแตะแล้วเงียบ)
        await p1.click('[data-exchange-index="2"]');
        const sel = await p1.$$eval('[data-exchange-index].is-selected', els => els.map(e => e.dataset.exchangeIndex));
        assert(sel.length === 2 && sel.includes('2'), 'แตะใบใหม่ตอนเลือกครบต้องสลับเข้าไป: ' + sel);
        await p1.click('#cpExchangeConfirm');
        await delay(900);
        assert((await stateOf(p1)).phase === 'action', 'ยืนยันแลกแล้วต้องจบตา');
        console.log('6. แลกการ์ด: ไม่ขึ้นตกรอบ · เลือกใบเดิมไว้ · ป้ายใบเดิม/ใบใหม่ · แตะสลับได้ ✓');

        // 7. หงายการ์ดต้องยืนยัน: P2 ประกาศเก็บภาษี, p0 ท้า → ใครสักคนต้องหงาย
        await ack(P2.socket, 'coup_submitAction', { actionId: 'tax' });
        await delay(800);
        await p0.click('[data-respond="challenge"]');
        await delay(1000);
        const s7 = await stateOf(p0);
        assert(s7.phase === 'lose-influence', 'ท้าแล้วต้องมีคนหงายการ์ด');
        if (s7.pendingLoss.isMe) {
            const why = await p0.textContent('#actionArea');
            assert(/ท้าแล้วแพ้/.test(why), 'ต้องบอกเหตุผลที่ต้องหงาย: ' + why);
            await p0.click('#myHand .cp-influence.is-pick');
            await delay(500);
            assert((await stateOf(p0)).phase === 'lose-influence', 'แตะการ์ดครั้งเดียวต้องยังไม่หงาย');
            const confirmText = await p0.textContent('#cpLossConfirm');
            assert(/ยืนยันหงาย/.test(confirmText), 'ต้องมีปุ่มยืนยันหงาย');
            await p0.click('#cpLossConfirm');
            await delay(900);
            assert((await stateOf(p0)).phase !== 'lose-influence', 'กดยืนยันแล้วต้องหงายจริง');
            console.log('7. หงายการ์ด: บอกเหตุผล · แตะเลือก → กดยืนยันถึงจะหงาย ✓');
        } else {
            const waiting = await p0.textContent('#actionArea');
            assert(/รอ/.test(waiting) && /โดนจับได้/.test(waiting), 'คนดูต้องเห็นว่ารอใครหงายและเพราะอะไร: ' + waiting);
            const view = P2.last();
            await ack(P2.socket, 'coup_loseInfluence', { cardId: view.self.influence[0].id });
            await delay(900);
            console.log('7. (P2 โกหก) คนดูเห็นว่ารอใครหงายการ์ดและเพราะอะไร ✓');
        }
        assert(p0.jsErrors.length === 0 && p1.jsErrors.length === 0, 'JS error: ' + [...p0.jsErrors, ...p1.jsErrors].join(' | '));
        await p0.context().close(); await p1.context().close();
        P2.socket.close();

        // ===== ห้อง 2 คน: รัฐประหารต้องยืนยันเป้าหมาย / จบเกมสรุปผล =====
        const duo = await newRoom(base, 2);
        duo.players[0].socket.close();
        const host = await openPhone(browser, base, duo.roomId, duo.players[0]);
        const foe = duo.players[1];
        for (let guard = 0; guard < 40; guard++) {
            const st = await stateOf(host);
            if (st.phase === 'finished') break;
            if (st.phase === 'lose-influence' && !st.pendingLoss.isMe) {
                await ack(foe.socket, 'coup_loseInfluence', { cardId: foe.last().self.influence[0].id });
            } else if (st.phase === 'respond' && st.pendingAction.actorId === duo.players[0].id) {
                await ack(foe.socket, 'coup_respond', { response: 'pass' });
            } else if (st.phase === 'action' && !st.isMyTurn) {
                await ack(foe.socket, 'coup_submitAction', { actionId: 'income' });
            } else if (st.phase === 'action' && st.isMyTurn) {
                if (st.self.coins >= 7) {
                    await host.click('.cp-action[data-action="coup"]');
                    await host.click(`[data-target="${foe.id}"]`);
                    await delay(500);
                    assert((await stateOf(host)).phase === 'action', 'แตะชื่อเป้าหมายรัฐประหารแล้วต้องยังไม่ยิง');
                    const confirm = await host.textContent('[data-confirm-target]');
                    assert(/ยืนยัน/.test(confirm) && /รัฐประหาร/.test(confirm), 'ต้องมีปุ่มยืนยันรัฐประหาร');
                    await host.click('[data-confirm-target]');
                } else {
                    await host.click('.cp-action[data-action="tax"]');
                }
            }
            await delay(600);
        }
        const fin = await stateOf(host);
        assert(fin.phase === 'finished', 'เกม 2 คนต้องจบได้');
        await delay(500);
        const result = await host.textContent('#actionArea');
        assert(/คุณชนะ/.test(result), 'จบเกมต้องบอกผลของตัวเอง');
        const finalHand = await host.$$eval('.cp-final-hand', els => els.map(e => e.textContent));
        assert(finalHand.length >= 1 && /ในมือ/.test(finalHand[0]), 'จบเกมต้องเปิดการ์ดที่เหลือในมือ');
        assert(host.jsErrors.length === 0, 'JS error: ' + host.jsErrors.join(' | '));
        console.log('8. รัฐประหาร: แตะเป้า → ยืนยัน · จบเกมบอกผลตัวเอง + เปิดมือที่เหลือ ✓');
        foe.socket.close();

        console.log(`\n✅ COUP UX ผ่านทั้งหมด (${passed} assertions)`);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
