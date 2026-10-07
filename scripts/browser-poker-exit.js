/**
 * มาตรฐานออกจากเกม (ไพ่ 5 ใบ / สี่ใบเก) ที่จอ 390×844
 * 1. ปุ่ม "🚪 ออก" เห็นทุกช่วง (เลือกไพ่ / ลงชิป / เปิดไพ่-รอมือถัดไป) ไม่ถูกบัง ≥44px
 * 2. กดแล้วถามยืนยัน บอกผลเฉพาะโป๊กเกอร์ (กลางมือ = หมอบ ชิปที่ลงอยู่ในกองต่อ) · "อยู่ต่อ" ต้องไม่ออก
 * 3. ยืนยัน → leaveRoom → /rooms · รอ 15 วิ ไม่ถูกดึงกลับ ไม่อยู่ในรายชื่อห้อง · คนที่เหลือเล่นต่อ
 * 4. โต๊ะเก็บชิป: ข้อความบอกชัดว่าชิปหักจากบัญชีจริง · ออกกลางมือแล้วค่าต๋งไปที่ผู้ชนะ ยอดรวมคงที่
 * รัน: npm run smoke:poker:exit
 */
require('./isolateTestData');
'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');
const { spawnServer, stopServer, delay } = require('./mobile-e2e-utils');

const SHOT_DIR = process.env.POKER_SHOT_DIR || '';
const START = 1000; // STARTING_CHIPS ใน walletManager

function assert(condition, message) {
    if (!condition) throw new Error(message);
}
function ack(socket, eventName, payload) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 15000);
        socket.emit(eventName, payload, response => { clearTimeout(timer); resolve(response); });
    });
}
function connect(baseUrl) {
    return new Promise(resolve => {
        const socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
        socket.once('connect', () => resolve(socket));
    });
}
function launchOptions() {
    const configured = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (configured) return { headless: true, executablePath: configured };
    if (fs.existsSync(systemChrome)) return { headless: true, executablePath: systemChrome };
    return { headless: true };
}

// ผู้เล่นอีกคนผ่าน socket: ทิ้งไพ่/ผ่าน/ตาม อัตโนมัติ และเก็บ state ล่าสุดไว้ตรวจ
async function socketPlayer(baseUrl, autoPlay = true) {
    const socket = await connect(baseUrl);
    const id = randomUUID();
    const bot = { socket, id, state: null, roomPlayers: null, roomId: null, autoPlay };
    socket.emit('initPlayer', id);
    socket.on('roomUpdate', data => { if (data && data.players) bot.roomPlayers = data.players.map(p => p.playerId); });
    socket.on('pokerState', state => {
        bot.state = state;
        if (!bot.autoPlay || !bot.roomId) return;
        const actions = state.availableActions || {};
        if (state.phase === 'select' && actions.canSelect) {
            socket.emit('poker_select', { roomId: bot.roomId, cardIds: state.self.hand.slice(0, 2).map(c => c.id) }, () => {});
        } else if (state.phase === 'bet' && actions.toAct) {
            socket.emit('poker_bet', { roomId: bot.roomId, action: actions.canCheck ? 'check' : 'call' }, () => {});
        }
    });
    await delay(250);
    return bot;
}

async function exitButtonCheck(page, label) {
    // ป้าย "ตาคุณ" เป็นฉากมืดเต็มจอแค่ 1.4 วิ (กดทะลุได้) — รอให้หายก่อนวัดแบบปกติ
    await page.waitForFunction(() => !document.querySelector('#ppTurnPing.is-on'), null, { timeout: 4000 }).catch(() => {});
    const box = await page.evaluate(() => {
        const button = document.querySelector('#pkLeaveRoomBtn');
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
            text: button.textContent.trim(),
            width: rect.width,
            height: rect.height,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            vw: innerWidth,
            vh: innerHeight,
            visible: getComputedStyle(button).visibility !== 'hidden' && getComputedStyle(button).display !== 'none',
            onTop: !!(top && (top === button || button.contains(top))),
            // แถบที่ pointer-events:none (elementFromPoint มองไม่เห็น) แต่บังสายตา
            coveredBy: ['#ppTermsBar', '.swal2-container'].filter(selector => {
                const node = document.querySelector(selector);
                if (!node || getComputedStyle(node).display === 'none') return false;
                const r = node.getBoundingClientRect();
                return r.left < rect.right && rect.left < r.right && r.top < rect.bottom && rect.top < r.bottom &&
                    !(selector === '.swal2-container');
            })
        };
    });
    assert(box, `${label}: ไม่มีปุ่มออก`);
    assert(/ออก/.test(box.text) && /🚪/.test(box.text), `${label}: ปุ่มต้องมีคำว่า "🚪 ออก" ได้ "${box.text}"`);
    assert(box.visible && box.width >= 44 && box.height >= 44, `${label}: ปุ่มออกต้องเห็นและ ≥44px ${JSON.stringify(box)}`);
    assert(box.top >= 0 && box.left >= 0 && box.bottom <= box.vh && box.right <= box.vw, `${label}: ปุ่มออกหลุดจอ ${JSON.stringify(box)}`);
    assert(box.onTop, `${label}: ปุ่มออกถูกอย่างอื่นบัง`);
    assert(!box.coveredBy.length, `${label}: ปุ่มออกถูกแถบบังสายตา ${box.coveredBy.join(',')}`);
}

// อ่านช่วงเกมจากแถบสถานะบนจอ (ตัวแปรในหน้าไม่ได้เปิดเป็น global)
function phaseFromNow(text) {
    const t = String(text || '');
    if (/ชนะ|ได้กอง|แบ่งกอง|รอแจกมือถัดไป/.test(t)) return 'reveal';
    if (/ใบที่ 3/.test(t)) return 'deal3';
    if (/ลงชิป/.test(t)) return 'bet';
    if (/ใบทิ้ง|ทิ้งแล้ว รอ/.test(t)) return 'select';
    return '';
}

async function waitPhase(page, phases, ms = 45000, act = true) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const phase = phaseFromNow(await page.textContent('#pkNowCopy').catch(() => ''));
        if (phases.includes(phase)) return phase;
        if (act) {
            const select = await page.$('#pkSelectBtn:not([disabled])');
            if (select && phase === 'select') await select.click().catch(() => {});
            const move = await page.$('[data-pk-bet="check"], [data-pk-bet="call"]');
            if (move) await move.click().catch(() => {});
        }
        await delay(250);
    }
    const seen = await page.textContent('#pkNowCopy').catch(e => 'err ' + e.message);
    throw new Error('รอเฟส ' + phases.join('/') + ' ไม่ทัน (อยู่ ' + seen + ' ที่ ' + page.url() + ')');
}

async function openConfirm(page) {
    await page.click('#pkLeaveRoomBtn');
    await page.waitForSelector('.swal2-popup', { timeout: 5000 });
    const text = await page.textContent('.swal2-popup');
    const z = await page.$eval('.swal2-container', node => Number(getComputedStyle(node).zIndex) || 0);
    assert(z > 12050, 'กล่องยืนยันต้องอยู่เหนือป้าย "ตาคุณ" (z 12050) ได้ ' + z);
    assert(/ออกจากห้อง/.test(await page.textContent('.swal2-confirm')), 'ปุ่มยืนยันต้องเขียนว่า "ออกจากห้อง"');
    assert(/อยู่ต่อ/.test(await page.textContent('.swal2-cancel')), 'ปุ่มยกเลิกต้องเขียนว่า "อยู่ต่อ"');
    return text;
}

async function funTable(browser, baseUrl, mode) {
    const host = await connect(baseUrl);
    const hostId = randomUUID();
    host.emit('initPlayer', hostId);
    await delay(250);
    const other = await socketPlayer(baseUrl);
    let context;
    try {
        const created = await ack(host, 'createRoom', { playerId: hostId, name: 'Exit ' + mode, gameMode: mode, maxPlayers: 10, pokerAnte: 200, pokerTableType: 'fun' });
        assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        other.roomId = roomId;
        host.emit('setRoom', { roomId, playerId: hostId });
        assert((await ack(other.socket, 'joinRoom', { roomId, playerId: other.id }))?.success, 'อีกคนเข้าห้องไม่ได้');
        other.socket.emit('setRoom', { roomId, playerId: other.id });
        assert((await ack(host, 'poker_addBots', { roomId, count: 1 }))?.success, 'เพิ่มบอทไม่ได้');
        assert((await ack(host, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        host.close();
        other.socket.emit('poker_requestState', { roomId });

        context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-poker5', '1'); localStorage.setItem('ig-firstplay-poker4', '1'); } catch (error) { /* ignore */ }
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${baseUrl}/?playerId=${hostId}`);
        await page.goto(`${baseUrl}/game/${roomId}?playerId=${hostId}`, { waitUntil: 'networkidle' });

        await waitPhase(page, ['select'], 15000, false);
        await exitButtonCheck(page, `${mode} เลือกไพ่`);
        await waitPhase(page, ['bet']);
        await exitButtonCheck(page, `${mode} ลงชิป`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `exit-${mode}-bet.png`) });
        await waitPhase(page, ['reveal'], 60000);
        await exitButtonCheck(page, `${mode} เปิดไพ่/รอมือถัดไป`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `exit-${mode}-result.png`) });
        const betweenText = await openConfirm(page);
        assert(/เกมเล่นต่อโดยไม่มีคุณ/.test(betweenText), `${mode}: ยืนยันต้องบอกว่าเกมเล่นต่อ ได้ "${betweenText}"`);
        assert(/หัวห้องจะย้าย/.test(betweenText), `${mode}: หัวห้องต้องรู้ว่าหัวห้องจะย้าย`);
        await page.click('.swal2-cancel');
        await delay(500);
        assert(/\/game\//.test(page.url()), `${mode}: กด "อยู่ต่อ" ต้องยังอยู่ในเกม`);
        console.log(`${mode}: ปุ่ม "🚪 ออก" เห็นทุกช่วง · "อยู่ต่อ" ไม่ออก ✓`);

        // มือถัดไป ออกกลางมือ (วางกองแล้ว) → ต้องบอกว่าหมอบ ชิปอยู่ในกองต่อ
        await waitPhase(page, ['bet'], 60000, false);
        await exitButtonCheck(page, `${mode} มือสอง`);
        const midText = await openConfirm(page);
        assert(/มือนี้ถือว่าหมอบ/.test(midText), `${mode}: กลางมือต้องบอกว่าหมอบ ได้ "${midText}"`);
        assert(/ชิปที่ลงกองไปแล้ว 200 ชิป อยู่ในกองต่อ/.test(midText), `${mode}: ต้องบอกชิปที่ลงแล้วอยู่ในกอง ได้ "${midText}"`);
        if (SHOT_DIR) { await delay(800); await page.screenshot({ path: path.join(SHOT_DIR, `exit-${mode}-confirm.png`) }); }
        await Promise.all([
            page.waitForURL(/\/rooms/, { timeout: 8000 }),
            page.click('.swal2-confirm')
        ]);
        console.log(`${mode}: ยืนยันออกกลางมือ → /rooms ✓`);

        await delay(15000);
        assert(/\/rooms/.test(page.url()), `${mode}: 15 วิแล้วต้องยังอยู่ /rooms ได้ ${page.url()}`);
        other.socket.emit('poker_requestState', { roomId });
        await delay(500);
        assert(other.roomPlayers && !other.roomPlayers.includes(hostId), `${mode}: คนออกต้องไม่อยู่ในรายชื่อห้อง`);
        const seen = other.state;
        assert(seen && seen.phase !== 'finished', `${mode}: คนที่เหลือ (คน + บอท) ต้องเล่นต่อ ได้ ${seen && seen.phase}`);
        assert(!(seen.players || []).some(p => p.playerId === hostId && !p.sittingOut), `${mode}: คนออกต้องไม่นั่งในมือ`);
        assert((seen.history || []).some(h => /ออกจากมือนี้|หมอบ/.test(h.text || '')) || seen.handNumber >= 3, `${mode}: คนที่เหลือต้องเห็นว่ามีคนออก`);
        // getRoomList รับ callback เป็นอาร์กิวเมนต์แรก (ไม่มี payload)
        const probe = await connect(baseUrl);
        probe.emit('initPlayer', randomUUID());
        await delay(300);
        const list = await new Promise(resolve => {
            const timer = setTimeout(() => resolve(null), 8000);
            probe.emit('getRoomList', res => { clearTimeout(timer); resolve(res); });
        });
        probe.close();
        assert(list && Array.isArray(list.rooms), `${mode}: ดึงรายการห้องไม่ได้`);
        const row = list.rooms.find(r => r.roomId === roomId);
        assert(row && row.playerCount === 2, `${mode}: รายการห้องต้องไม่นับคนออก (เหลือคน + บอท = 2) ได้ ${row && row.playerCount}`);
        assert(errors.length === 0, 'มี JavaScript error: ' + errors.join(' | '));
        console.log(`${mode}: รอ 15 วิ ไม่ถูกดึงกลับ ไม่อยู่ในห้อง คนที่เหลือเล่นต่อ ✓`);
    } finally {
        try { host.close(); } catch {}
        try { other.socket.close(); } catch {}
        if (context) await context.close();
    }
}

async function cashTable(browser, baseUrl) {
    const host = await connect(baseUrl);
    const hostId = randomUUID();
    host.emit('initPlayer', hostId);
    await delay(250);
    const other = await socketPlayer(baseUrl, false);
    let context;
    try {
        const created = await ack(host, 'createRoom', { playerId: hostId, name: 'Exit cash', gameMode: 'poker5', maxPlayers: 10, pokerAnte: 50, pokerTableType: 'cash' });
        assert(created?.success, 'สร้างโต๊ะเงินไม่ได้');
        const roomId = created.roomId;
        other.roomId = roomId;
        host.emit('setRoom', { roomId, playerId: hostId });
        assert((await ack(other.socket, 'joinRoom', { roomId, playerId: other.id }))?.success, 'อีกคนเข้าโต๊ะเงินไม่ได้');
        other.socket.emit('setRoom', { roomId, playerId: other.id });
        assert((await ack(host, 'startGameFromLobby', { roomId }))?.success, 'เริ่มโต๊ะเงินไม่ได้');
        // เริ่มจริงหลังนับถอยหลัง 3 วิ — โต๊ะเงินมีแค่คน 2 คน ถ้าหัวห้องหลุดตอนนับถอยหลังเกมจะไม่เริ่ม (ไม่มีบอทช่วยนับ)
        for (let i = 0; i < 60 && !(other.state && other.state.phase === 'select'); i += 1) {
            other.socket.emit('poker_requestState', { roomId });
            await delay(200);
        }
        assert(other.state && other.state.phase === 'select', 'โต๊ะเงินต้องเริ่มแจกไพ่');
        host.close();

        context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        await context.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-poker5', '1'); } catch (error) { /* ignore */ } });
        const page = await context.newPage();
        await page.goto(`${baseUrl}/?playerId=${hostId}`);
        await page.goto(`${baseUrl}/game/${roomId}?playerId=${hostId}`, { waitUntil: 'networkidle' });
        try {
            await waitPhase(page, ['select'], 15000, false);
        } catch (error) {
            const st = other.state;
            throw new Error(error.message + ' · อีกคนเห็น ' + JSON.stringify(st && { phase: st.phase, players: (st.players || []).map(p => [p.playerId === hostId ? 'host' : 'other', p.sittingOut, p.stack]), hist: (st.history || []).slice(0, 3).map(h => h.text) }));
        }
        await exitButtonCheck(page, 'โต๊ะเงิน เลือกไพ่');
        const text = await openConfirm(page);
        assert(/มือนี้ถือว่าหมอบ/.test(text) && /ชิปที่ลงกองไปแล้ว 50 ชิป/.test(text), 'โต๊ะเงิน: บอกหมอบ + ค่าต๋ง ได้ "' + text + '"');
        assert(/โต๊ะเก็บชิป: ชิปนี้หักจากบัญชีคุณไปแล้วจริง/.test(text), 'โต๊ะเงิน: ต้องบอกชัดว่าหักจากบัญชีจริง ได้ "' + text + '"');
        if (SHOT_DIR) { await delay(800); await page.screenshot({ path: path.join(SHOT_DIR, 'exit-cash-confirm.png') }); }
        await Promise.all([page.waitForURL(/\/rooms/, { timeout: 8000 }), page.click('.swal2-confirm')]);
        // รอจนอีกคนเห็นผลมือ (หมอบเพราะคนออก) และกระเป๋าอัปเดต — เครื่องช้าอาจใช้หลายวิ
        let seen = null;
        for (let i = 0; i < 40; i += 1) {
            other.socket.emit('poker_requestState', { roomId });
            await delay(250);
            seen = other.state;
            if (seen && seen.lastResult && seen.wallet && seen.wallet.balance === START + 50) break;
        }
        const result = seen.lastResult;
        assert(result && result.winners[0].playerId === other.id, 'โต๊ะเงิน: คนออกกลางมือ = หมอบ อีกคนกินกอง');
        assert(seen.wallet && seen.wallet.balance === START + 50, 'โต๊ะเงิน: ผู้ชนะได้ค่าต๋งของคนออก ได้ ' + (seen.wallet && seen.wallet.balance));
        // กระเป๋าเซฟแบบหน่วง — อ่านไฟล์จนกว่าจะเห็นยอดคนออก
        const walletsFile = path.join(process.env.GAME_DATA_DIR, 'wallets.json');
        let mine = null;
        for (let i = 0; i < 40 && !(mine && mine.balance === START - 50); i += 1) {
            try { mine = JSON.parse(fs.readFileSync(walletsFile, 'utf8'))[hostId] || null; } catch (error) { /* ยังไม่มีไฟล์ */ }
            await delay(150);
        }
        assert(mine && mine.balance === START - 50, 'โต๊ะเงิน: คนออกเสียแค่ค่าต๋ง ได้ ' + (mine && mine.balance));
        assert(!mine.pokerEscrow || Object.keys(mine.pokerEscrow).length === 0, 'โต๊ะเงิน: ไม่มีเงินพักค้างของคนออก');
        console.log('โต๊ะเงิน: ยืนยันบอกชัดว่าหักจากบัญชีจริง · ออกกลางมือ ค่าต๋งไปที่ผู้ชนะ ยอดรวมคงที่ ✓');
    } finally {
        try { host.close(); } catch {}
        try { other.socket.close(); } catch {}
        if (context) await context.close();
    }
}

(async () => {
    const server = await spawnServer({ POKER_REVEAL_MS: '2500', POKER_BETWEEN_MS: '2500', POKER_DEAL3_MS: '1200' });
    let browser;
    try {
        browser = await chromium.launch(launchOptions());
        await funTable(browser, server.baseUrl, 'poker5');
        await funTable(browser, server.baseUrl, 'poker4');
        await cashTable(browser, server.baseUrl);
        console.log('\n✅ Poker exit standard ผ่าน');
    } finally {
        if (browser) await browser.close();
        await stopServer(server);
    }
})().then(() => process.exit(process.exitCode || 0)).catch(error => {
    console.error('❌', error.stack || error.message);
    process.exit(1);
});
