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
