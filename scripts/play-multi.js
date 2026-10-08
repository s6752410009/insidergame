#!/usr/bin/env node
/**
 * เปิดหลายจอเล่นคนเดียว: เปิดเบราว์เซอร์ N หน้าต่าง (คนละผู้เล่น) เรียงเต็มจอ เข้าห้องเดียวกัน แล้วเริ่มเกมให้
 *
 *   npm run play:multi -- coup 4            → Coup 4 คน บน http://localhost:3000
 *   npm run play:multi -- werewolf 5 --no-start   (เข้าห้องรอ ยังไม่เริ่ม — ตั้งค่าห้องเองได้)
 *   BASE_URL=http://localhost:3001 npm run play:multi -- avalon 5
 *
 * หน้าต่างแรก = หัวห้อง · ปิดหน้าต่างไหนก็ได้ · Ctrl+C ในเทอร์มินัล = ปิดทั้งหมด
 */
const { execSync } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const mode = args.find(a => !a.startsWith('--') && isNaN(Number(a))) || 'insider';
const count = Math.max(2, Math.min(8, Number(args.find(a => /^\d+$/.test(a))) || 4));
const autoStart = !args.includes('--no-start');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const delay = ms => new Promise(r => setTimeout(r, ms));

function screenBounds() {
    try {
        const out = execSync(`osascript -e 'tell application "Finder" to get bounds of window of desktop'`, { encoding: 'utf8' });
        const [x, y, w, h] = out.trim().split(/,\s*/).map(Number);
        if (w > 0 && h > 0) return { x, y: Math.max(y, 25), w, h };
    } catch (e) { /* not macOS / no permission */ }
    return { x: 0, y: 25, w: 1440, h: 900 };
}

(async () => {
    const scr = screenBounds();
    const cols = count <= 4 ? count : Math.ceil(count / 2);
    const rows = count <= 4 ? 1 : 2;
    const winW = Math.floor(scr.w / cols);
    const winH = Math.floor((scr.h - scr.y) / rows);
    const browsers = [];
    const pages = [];
    const shutdown = async () => { await Promise.all(browsers.map(b => b.close().catch(() => {}))); process.exit(0); };
    process.on('SIGINT', shutdown);

    console.log(`เปิด ${count} หน้าต่าง · ${mode} · ${BASE}`);
    for (let i = 0; i < count; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const browser = await chromium.launch({
            headless: !!process.env.HEADLESS,
            args: [`--window-position=${scr.x + col * winW},${scr.y + row * winH}`, `--window-size=${winW},${winH}`]
        });
        browsers.push(browser);
        browser.on('disconnected', () => { if (browsers.every(b => !b.isConnected())) process.exit(0); });
        const context = await browser.newContext({ viewport: null, locale: 'th-TH' });
        await context.addInitScript(() => {
            try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ }
        });
        const page = await context.newPage();
        const playerId = randomUUID();
        await page.goto(`${BASE}/?playerId=${playerId}`, { waitUntil: 'domcontentloaded' });
        pages.push({ page, playerId });
    }

    // หัวห้องสร้างห้องผ่าน socket ของหน้าเว็บเอง (ตัวตนเดียวกับหน้าต่างนั้น)
    const host = pages[0];
    await host.page.waitForFunction(() => window.appSocket && window.appSocket.connected, null, { timeout: 15000 });
    const created = await host.page.evaluate(({ mode, count }) => new Promise(resolve => {
        const pid = localStorage.getItem('insiderGamePlayerId');
        window.appSocket.emit('createRoom', { playerId: pid, name: `ทดสอบ ${mode} ${count} จอ`, gameMode: mode, maxPlayers: Math.max(count, 8) }, resolve);
    }), { mode, count });
    if (!created || !created.success) {
        console.error('สร้างห้องไม่ได้:', created && created.error);
        return shutdown();
    }
    const roomId = created.roomId;
    console.log(`ห้อง ${roomId} — ${BASE}/room/${roomId}`);

    // ทุกหน้าต่างเข้าห้อง (เปิด /room/:id = เข้าห้องอัตโนมัติ)
    for (const p of pages) {
        await p.page.goto(`${BASE}/room/${roomId}?playerId=${p.playerId}`, { waitUntil: 'domcontentloaded' });
        await delay(300);
    }

    if (autoStart) {
        await delay(1500);
        const started = await host.page.evaluate(roomId => new Promise(resolve => {
            window.appSocket.emit('startGameFromLobby', { roomId }, resolve);
        }), roomId);
        if (started && started.success) console.log('เริ่มเกมแล้ว ✓ (หน้าต่างซ้ายสุด = หัวห้อง)');
        else console.log('ยังเริ่มไม่ได้:', started && started.error, '— กดเริ่มเองในหน้าต่างหัวห้อง');
    } else {
        console.log('อยู่ห้องรอ — ตั้งค่าแล้วกดเริ่มในหน้าต่างซ้ายสุด (หัวห้อง)');
    }
    console.log('Ctrl+C = ปิดทุกหน้าต่าง');
    await new Promise(() => {});
})().catch(error => {
    console.error(error);
    process.exit(1);
});
