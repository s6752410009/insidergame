/**
 * Regression: ไพ่ตัวเองต้องเห็นทุกช่วง และ action dock ต้องไม่หลุดจอมือถือแนวนอน
 * รัน: npm run smoke:poker:layout
 */
require('./isolateTestData');
'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');
const { spawnServer, stopServer, delay } = require('./mobile-e2e-utils');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function ack(socket, eventName, payload) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ __timeout: true }), 15000);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
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

async function assertOwnCardsVisible(page, expected, label) {
    let cards = [];
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            cards = await page.$$eval('#myHand .pk-playing', nodes => nodes.map(node => {
                const rect = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                const image = node.querySelector('img');
                return {
                    width: rect.width,
                    height: rect.height,
                    opacity: Number(style.opacity),
                    visibility: style.visibility,
                    imageWidth: image ? image.naturalWidth : 0
                };
            }));
            if (cards.length === expected && cards.every(card => card.imageWidth > 0)) break;
        } catch (error) {
            if (!/Execution context was destroyed/.test(error.message)) throw error;
        }
        await delay(200);
    }
    assert(cards.length === expected, `${label}: ต้องมีไพ่ ${expected} ใบ ได้ ${cards.length}`);
    assert(cards.every(card => card.width >= 30 && card.height >= 40 && card.opacity > 0.9 && card.visibility !== 'hidden'), `${label}: ไพ่ถูกซ่อนหรือกลับตั้งฉาก ${JSON.stringify(cards)}`);
    assert(cards.every(card => card.imageWidth > 0), `${label}: รูปไพ่โหลดไม่ครบ`);
}

async function assertCriticalUiInViewport(page, label) {
    const geometry = await page.evaluate(() => {
        const ids = ['.pk-hud', '#pkNowBar', '.pk-stage', '.pk-hand-dock', '#actionArea'];
        return {
            width: innerWidth,
            height: innerHeight,
            scrollHeight: document.documentElement.scrollHeight,
            boxes: ids.map(selector => {
                const node = document.querySelector(selector);
                const rect = node && node.getBoundingClientRect();
                return { selector, top: rect?.top, bottom: rect?.bottom, left: rect?.left, right: rect?.right };
            })
        };
    });
    for (const box of geometry.boxes) {
        assert(box.top >= -2 && box.bottom <= geometry.height + 2, `${label}: ${box.selector} หลุดแนวตั้ง ${JSON.stringify(box)}`);
        assert(box.left >= -2 && box.right <= geometry.width + 2, `${label}: ${box.selector} หลุดแนวนอน ${JSON.stringify(box)}`);
    }
    assert(geometry.scrollHeight <= geometry.height + 2, `${label}: หน้าเกิด scroll ที่ซ่อนไว้ ${geometry.scrollHeight}/${geometry.height}`);
}

function rectsOverlap(a, b) {
    return !!(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
}

async function swalVisible(page) {
    return page.evaluate(() => {
        const node = document.querySelector('.swal2-popup');
        return !!(node && node.offsetParent !== null && getComputedStyle(node).display !== 'none');
    });
}

async function closeSwal(page, buttonSelector) {
    await page.click(buttonSelector);
    await page.waitForFunction(() => !document.querySelector('.swal2-container'), null, { timeout: 5000 });
}

// UX audit (มือถือแนวตั้ง 390×844, สี่ใบเก + บอท 1): เลือกทิ้ง/กันกดซ้ำ/ยืนยันก่อนหมอบ-หมดหน้าตัก/สรุปผลเปิดไพ่
async function portraitPapercuts(browser, baseUrl) {
    const socket = await connect(baseUrl);
    const playerId = randomUUID();
    let context;
    try {
        socket.emit('initPlayer', playerId);
        await delay(250);
        const created = await ack(socket, 'createRoom', {
            playerId, name: 'Poker portrait', gameMode: 'poker4', maxPlayers: 10, pokerAnte: 300, pokerTableType: 'fun'
        });
        assert(created?.success, 'สร้างห้องแนวตั้งไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        socket.emit('setRoom', { roomId, playerId });
        assert((await ack(socket, 'poker_addBots', { roomId, count: 1 }))?.success, 'เพิ่มบอทไม่ได้');
        assert((await ack(socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมแนวตั้งไม่ได้');
        socket.close();

        context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            try {
                sessionStorage.setItem('insiderPromoSeen', '1');
                localStorage.setItem('ig-firstplay-poker4', '1');
                localStorage.removeItem('pkBetMoreOpen');
            } catch (error) { /* ignore */ }
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${baseUrl}/?playerId=${playerId}`);
        await page.goto(`${baseUrl}/game/${roomId}?playerId=${playerId}`, { waitUntil: 'networkidle' });

        await assertOwnCardsVisible(page, 4, 'แนวตั้ง ช่วงเลือกไพ่');
        await assertCriticalUiInViewport(page, 'แนวตั้ง ช่วงเลือกไพ่');
        const hud = await page.evaluate(() => {
            const box = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; };
            return { wallet: box('#pkWallet'), chat: box('#toggleChat'), rankTab: getComputedStyle(document.querySelector('#pkRankTab')).visibility };
        });
        assert(!rectsOverlap(hud.wallet, hud.chat), 'ปุ่มแชทต้องไม่ทับกระเป๋าชิป ' + JSON.stringify(hud));
        assert(hud.rankTab === 'visible', 'ช่วงเลือกทิ้งต้องเปิดแรงก์ไพ่ได้');
        assert(await page.locator('#myHand .pk-card-tag').count() === 2, 'ไพ่ที่ระบบเลือกทิ้งต้องมีป้าย "ทิ้ง" 2 ใบ');
        assert(/ทิ้ง 2 ใบนี้/.test(await page.textContent('#pkSelectBtn')), 'ปุ่มยืนยันต้องบอกว่าทิ้ง 2 ใบ');
        console.log('4. แนวตั้ง: ป้าย "ทิ้ง" ชัด ปุ่มแชทไม่ทับชิป และเปิดแรงก์ไพ่ได้ตอนเลือก ✓');

        await page.click('#pkRankTab');
        await page.waitForSelector('#pkRankDrawer.open');
        assert(await page.locator('#pkRankList .pk-rank-item.is-you').count() === 1, 'แรงก์ไพ่ต้องไฮไลต์มือเรา 1 แถว');
        await delay(400);
        assert(await page.isVisible('#pkRankDrawer.open'), 'ลิ้นชักแรงก์ไพ่ต้องไม่ปิดเองระหว่างเลือกทิ้ง');
        await page.click('#pkRankClose');
        console.log('5. แรงก์ไพ่ไฮไลต์มือเรา และไม่เด้งปิดเองตอนเลือกทิ้ง ✓');

        // แตะใบที่ 3 ตอนเลือกครบแล้ว = สลับ ไม่ใช่เงียบ
        await page.click('#myHand .pk-playing.is-pick:not(.is-selected)');
        assert(await page.locator('#myHand .pk-playing.is-selected').count() === 2, 'แตะใบใหม่ตอนเลือกครบต้องสลับ ยังเลือก 2 ใบ');
        assert(await page.isEnabled('#pkSelectBtn'), 'สลับแล้วยังต้องกดยืนยันได้');
        assert(/ถ้าเก็บแบบนี้|มือคุณ/.test(await page.textContent('#pkHint')), 'คำใบ้ต้องบอกผลของใบที่เลือกอยู่');
        await page.click('#myHand .pk-playing.is-selected');
        assert(await page.isDisabled('#pkSelectBtn'), 'เลือกไม่ครบต้องกดยืนยันไม่ได้');
        assert(/อีก 1 ใบ/.test(await page.textContent('#pkSelectBtn')), 'ปุ่มที่กดไม่ได้ต้องบอกเหตุผล (เลือกอีก 1 ใบ)');
        await page.click('#myHand .pk-playing.is-pick:not(.is-selected)');
        // กดยืนยันรัว 2 ที — ต้องไม่เด้ง error
        await page.evaluate(() => { const button = document.querySelector('#pkSelectBtn'); button.click(); button.click(); });
        await delay(700);
        assert(!(await swalVisible(page)), 'กดยืนยันทิ้งซ้ำต้องไม่เด้ง error');
        console.log('6. แตะใบใหม่สลับได้ ปุ่มบอกเหตุผล และกดรัวไม่เด้ง error ✓');

        // คนนั่งต่อจากคนแจก (บอท) = ได้ลงชิปก่อน ยังไม่มีใครสู้
        await page.waitForSelector('[data-pk-bet="check"]', { timeout: 30000 });
        await assertCriticalUiInViewport(page, 'แนวตั้ง ตาลงชิป');
        const panelDisplay = await page.$eval('#pkMorePanel', node => getComputedStyle(node).display);
        assert(panelDisplay === 'none', 'แผงสู้/หมดหน้าตักต้องพับไว้ก่อน ได้ display=' + panelDisplay);
        await page.click('[data-pk-bet="fold"]');
        await page.waitForSelector('.swal2-popup');
        assert(/ผ่าน/.test(await page.textContent('.swal2-popup')), 'หมอบทั้งที่ผ่านได้ฟรีต้องถามก่อน');
        await closeSwal(page, '.swal2-cancel');
        await page.click('#pkBetMoreToggle');
        await page.waitForSelector('#pkMorePanel:not([hidden])');
        assert(/สู้ 300/.test(await page.textContent('#pkMorePanel [data-pk-bet="bet"]')), 'ปุ่มสู้ต้องบอกจำนวนชิป');
        await page.click('#pkChipPlus');
        assert(/สู้ 600/.test(await page.textContent('#pkMorePanel [data-pk-bet="bet"]')), 'กด + แล้วปุ่มสู้ต้องอัปเดตจำนวน');
        await page.click('#pkMorePanel [data-pk-bet="allin"]');
        await page.waitForSelector('.swal2-popup');
        assert(/หมดหน้าตัก/.test(await page.textContent('.swal2-popup')), 'หมดหน้าตักต้องถามยืนยัน');
        await closeSwal(page, '.swal2-cancel');
        assert(await page.isVisible('[data-pk-bet="check"]'), 'ยกเลิกหมดหน้าตักแล้วยังต้องเป็นตาเรา');
        await page.evaluate(() => { const button = document.querySelector('[data-pk-bet="check"]'); button.click(); button.click(); });
        await delay(700);
        assert(!(await swalVisible(page)), 'กดผ่านซ้ำต้องไม่เด้ง "ยังไม่ถึงตาคุณ"');
        console.log('7. ตาลงชิป: แผงพับได้ ปุ่มบอกยอด ถามก่อนหมอบฟรี/หมดหน้าตัก กดรัวไม่ error ✓');

        // เล่นต่อจนเปิดไพ่ (บอทสู้มา = ตาม)
        const deadline = Date.now() + 45000;
        let result = '';
        while (Date.now() < deadline) {
            result = await page.textContent('#pkNowCopy');
            if (/ชนะ|ได้กอง/.test(result)) break;
            const call = await page.$('[data-pk-bet="call"], [data-pk-bet="check"]');
            if (call) await call.click().catch(() => {});
            await delay(300);
        }
        assert(/ชนะด้วย .+ · ได้ \d+|ได้กอง \d+|แบ่งกอง \d+/.test(result), 'ตอนเปิดไพ่ต้องบอกว่าใครชนะด้วยมืออะไร ได้เท่าไร ได้ "' + result + '"');
        const hint = await page.textContent('#pkHint');
        assert(/คุณ(ชนะ|แพ้|หมอบ)/.test(hint), 'ต้องสรุปผลของเราเอง ได้ "' + hint + '"');
        assert(errors.length === 0, 'มี JavaScript error: ' + errors.join(' | '));
        console.log('8. เปิดไพ่บอกผู้ชนะ + มือ + ยอด และสรุปผลของเรา ✓');
    } finally {
        try { socket.close(); } catch {}
        if (context) await context.close();
    }
}

// สี่ใบเก ลงชิป 2 รอบ: รอบสองมือเราครบ 3 ใบ · ใบที่ 3 ของบอทคว่ำ (ค่าเริ่มต้น) หรือหงาย (ตั้งค่าห้อง)
const SHOT_DIR = process.env.POKER_SHOT_DIR || '';
async function thirdCardStreet(browser, baseUrl, thirdCard) {
    const socket = await connect(baseUrl);
    const playerId = randomUUID();
    let context;
    try {
        socket.emit('initPlayer', playerId);
        await delay(250);
        const created = await ack(socket, 'createRoom', {
            playerId, name: 'Poker third ' + thirdCard, gameMode: 'poker4', maxPlayers: 10, pokerAnte: 300, pokerTableType: 'fun', pokerThirdCard: thirdCard
        });
        assert(created?.success, 'สร้างห้องใบที่ 3 ไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        socket.emit('setRoom', { roomId, playerId });
        assert((await ack(socket, 'poker_addBots', { roomId, count: 1 }))?.success, 'เพิ่มบอทไม่ได้');
        assert((await ack(socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        socket.close();
        context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-poker4', '1'); } catch (error) { /* ignore */ }
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${baseUrl}/?playerId=${playerId}`);
        await page.goto(`${baseUrl}/game/${roomId}?playerId=${playerId}`, { waitUntil: 'networkidle' });
        await assertOwnCardsVisible(page, 4, `ใบที่ 3 ${thirdCard}: ช่วงเลือก`);
        await page.click('#pkSelectBtn');
        const deadline = Date.now() + 45000;
        let now = '';
        while (Date.now() < deadline) {
            now = await page.textContent('#pkNowCopy');
            if (/รอบสอง/.test(now)) break;
            const move = await page.$('[data-pk-bet="call"], [data-pk-bet="check"]');
            if (move) await move.click().catch(() => {});
            await delay(300);
        }
        assert(/รอบสอง/.test(now), `ใบที่ 3 ${thirdCard}: ต้องมีลงชิปรอบสอง ได้ "${now}"`);
        await delay(500);
        await assertOwnCardsVisible(page, 3, `ใบที่ 3 ${thirdCard}: รอบสอง`);
        await assertCriticalUiInViewport(page, `ใบที่ 3 ${thirdCard}: รอบสอง`);
        const seat = await page.$$eval('.pk-seat:not(.is-self) .pk-seat-cards img', nodes => nodes.map(node => node.getAttribute('alt')));
        assert(seat.length === 3, `ใบที่ 3 ${thirdCard}: ที่นั่งบอทต้องมี 3 ใบ ได้ ${seat.length}`);
        const faceUp = seat.filter(alt => alt !== 'ไพ่คว่ำ').length;
        assert(faceUp === (thirdCard === 'up' ? 1 : 0), `ใบที่ 3 ${thirdCard}: บอทต้องหงาย ${thirdCard === 'up' ? 1 : 0} ใบ ได้ ${faceUp}`);
        if (SHOT_DIR) {
            await page.waitForFunction(() => !document.querySelector('.pp-turn-ping.is-on, .party-turn-ping.is-on'), null, { timeout: 6000 }).catch(() => {});
            await delay(2500);
            await page.screenshot({ path: path.join(SHOT_DIR, `poker4-street2-${thirdCard}.png`) });
        }
        assert(errors.length === 0, 'มี JavaScript error: ' + errors.join(' | '));
        console.log(`9${thirdCard === 'up' ? 'b' : 'a'}. สี่ใบเก รอบสอง: มือเรา 3 ใบ บอท${thirdCard === 'up' ? 'หงายใบ 3' : 'คว่ำทั้ง 3 ใบ'} ✓`);
    } finally {
        try { socket.close(); } catch {}
        if (context) await context.close();
    }
}

(async () => {
    const server = await spawnServer();
    const socket = await connect(server.baseUrl);
    const playerId = randomUUID();
    let browser;
    try {
        socket.emit('initPlayer', playerId);
        await delay(250);
        const created = await ack(socket, 'createRoom', {
            playerId,
            name: 'Poker UI regression',
            gameMode: 'poker5',
            maxPlayers: 10,
            pokerAnte: 500,
            pokerTableType: 'fun'
        });
        assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        socket.emit('setRoom', { roomId, playerId });
        const bots = await ack(socket, 'poker_addBots', { roomId, count: 9 });
        assert(bots?.success && bots.added === 9, 'เพิ่มบอท 9 คนไม่ได้: ' + JSON.stringify(bots));
        assert((await ack(socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        socket.close();

        browser = await chromium.launch(launchOptions());
        const context = await browser.newContext({ viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${server.baseUrl}/game/${roomId}?playerId=${playerId}`, { waitUntil: 'networkidle' });

        await assertOwnCardsVisible(page, 5, 'ช่วงเลือกไพ่');
        await assertCriticalUiInViewport(page, 'ช่วงเลือกไพ่');
        assert(await page.isEnabled('#pkSelectBtn'), 'ระบบต้องเลือกไพ่ทิ้งเริ่มต้นให้และกดต่อได้');
        console.log('1. จอ 844×390 เห็นไพ่ตัวเอง 5 ใบ และปุ่มไม่หลุดจอ ✓');

        await page.click('#pkSelectBtn');
        await assertOwnCardsVisible(page, 3, 'ช่วงเลือกแล้ว/เดิมพัน');
        await assertCriticalUiInViewport(page, 'ช่วงเลือกแล้ว/เดิมพัน');
        console.log('2. เลือกเสร็จแล้วยังเห็นไพ่ตัวเอง 3 ใบ ไม่ถูกกลับคว่ำ ✓');

        await page.waitForSelector('#pkBetMoreToggle', { timeout: 30000 });
        await page.click('#pkBetMoreToggle');
        await page.waitForSelector('#pkMorePanel:not([hidden])');
        await assertCriticalUiInViewport(page, 'เปิดเพิ่มเดิมพัน');
        assert(await page.locator('#pkMorePanel [data-pk-bet]').count() >= 1, 'แผงเพิ่มเดิมพันต้องมีคำสั่งเดิมพัน');
        assert(errors.length === 0, 'มี JavaScript error: ' + errors.join(' | '));
        console.log('3. แผงเพิ่มเดิมพันเปิดได้ และยังอยู่ใน viewport ✓');
        await context.close();

        await portraitPapercuts(browser, server.baseUrl);
        await thirdCardStreet(browser, server.baseUrl, 'down');
        await thirdCardStreet(browser, server.baseUrl, 'up');
        console.log('\n✅ Poker UI regression ผ่าน');
    } finally {
        try { socket.close(); } catch {}
        if (browser) await browser.close();
        await stopServer(server);
    }
})().catch(error => {
    console.error('❌', error.stack || error.message);
    process.exitCode = 1;
});
