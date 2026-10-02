#!/usr/bin/env node
/**
 * แท็บ Logs ของแอดมิน: กรองประเภท/เกม, ค้นหา, หยุดรายการสดระหว่างอ่าน, แสดงเพิ่ม, ล้าง
 * log ตัวอย่างฉีดผ่าน listener 'adminLog' ของหน้าเอง (ทางเดียวกับที่ server ส่งมา)
 */

require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
let passed = 0;

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForServer(url, child) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < TIMEOUT_MS) {
        if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
        const ok = await new Promise(resolve => {
            http.get(url, res => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
        });
        if (ok) return;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for local server');
}

function sampleLogs() {
    const now = Date.now();
    const out = [];
    const room = (id, name, mode, label) => ({ roomId: id, roomName: name, gameMode: mode, gameModeLabel: label });
    const bm = room('r1', 'ห้องแก๊งเพื่อน', 'blackmarket', '🎩 Black Market');
    const coup = room('r2', 'Coup คืนวันศุกร์', 'coup', '👑 Coup');
    const add = (category, where, message, type, meta) => out.push({
        id: String(out.length), timestamp: new Date(now - out.length * 60000).toISOString(),
        category, roomId: null, roomName: 'ระบบ', gameMode: null, gameModeLabel: null, ...where, message, type, meta: meta || null
    });
    add('error', coup, 'event "coup_action" ล้มเหลว: boom', 'error', { playerId: 'p-err', event: 'x' });
    add('admin', {}, 'Admin บันทึกการตั้งค่าเกม (ทุกโหมด)', 'success');
    add('game', coup, '👑 Coup เริ่มเกม (5 คน)', 'success', { playerCount: 5, event: 'game_start' });
    add('join', bm, 'โอ๊ต เข้าห้อง', 'info');
    for (let i = 0; i < 260; i++) add('game', bm, `[BlackMarket] เจ ซื้อของ: item_${i} (ยกที่ 1)`, 'info', { event: 'bm_buy' });
    return out;
}

async function run() {
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
    const server = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), MONGO_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverOutput = '';
    server.stdout.on('data', c => { serverOutput += String(c); });
    server.stderr.on('data', c => { serverOutput += String(c); });
    let browser;
    try {
        await waitForServer(`${base}/ping`, server);
        browser = await chromium.launch({ headless: true });
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
            const ctx = await browser.newContext({ viewport, locale: 'th-TH' });
            await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
            const page = await ctx.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            const tag = `[${viewport.width}]`;

            await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
            await page.locator('input[name="password"]').fill(settings.adminPassword || 'admin123');
            await Promise.all([
                page.waitForURL(url => url.pathname === '/admin', { timeout: TIMEOUT_MS }),
                page.locator('input[name="password"]').press('Enter')
            ]);
            await page.locator('.tab-btn[data-tab="logs"]').click();
            await page.waitForFunction(() => window.appSocket && window.appSocket.connected);
            await page.waitForSelector('#lgCats .lg-cat');

            const count = cat => page.locator(`.lg-cat[data-cat="${cat}"] .lg-count`).innerText();
            const rows = () => page.locator('#logsContainer .lg-row').count();
            // server อาจมี log ของตัวเองอยู่แล้ว (เช่นตอนบูต) — นับเป็นฐานไว้ก่อน
            await page.locator('.lg-cat[data-cat="important"]').click();
            const baseImportant = await rows();
            const baseAll = Number(await count('all'));

            const logs = sampleLogs();
            await page.evaluate(list => {
                const s = window.appSocket;
                list.slice().reverse().forEach(e => s.listeners('adminLog').forEach(fn => fn(e)));
            }, logs);
            await page.waitForTimeout(200);

            // ค่าเริ่มต้น = สำคัญ: error + admin + เริ่มเกม ไม่เอา log ระหว่างเล่น
            await page.locator('.lg-cat[data-cat="important"]').click();
            assert(await rows() === baseImportant + 3, `${tag} สำคัญ +3 แถว (ได้ ${await rows()})`);
            assert(await count('error') === '1', `${tag} Error นับ 1`);
            assert(await page.locator('.lg-cat[data-cat="error"]').evaluate(el => el.classList.contains('is-alert')), `${tag} ปุ่ม Error เด่นเมื่อมี error`);
            assert(await page.locator('.lg-row--error').count() === 1, `${tag} แถว error มีสีเตือน`);
            assert(await page.locator('.lg-row', { hasText: 'เริ่มเกม (5 คน)' }).locator('.lg-msg').innerText() === 'Coup เริ่มเกม (5 คน)', `${tag} ตัดอีโมจิเกมที่ซ้ำกับป้ายออก`);

            // ทั้งหมด: แสดงทีละ 200 + ปุ่มแสดงเพิ่ม
            await page.locator('.lg-cat[data-cat="all"]').click();
            assert(await rows() === 200, `${tag} หน้าแรก 200 แถว`);
            assert(await page.locator('#lgMore').isVisible(), `${tag} มีปุ่มแสดงเพิ่ม`);
            await page.locator('#lgMore').click();
            assert(await rows() === baseAll + 264, `${tag} แสดงเพิ่มครบ`);
            assert(await page.locator('#lgMore').isHidden(), `${tag} ครบแล้วปุ่มแสดงเพิ่มหาย`);

            // ตัดป้าย [BlackMarket] ที่ซ้ำกับป้ายเกม
            const bmText = await page.locator('.lg-row', { hasText: 'item_0 ' }).locator('.lg-msg').innerText();
            assert(bmText.startsWith('เจ ซื้อของ'), `${tag} ไม่มี [BlackMarket] ซ้ำ: ${bmText}`);

            // ค้นหา + กรองเกม
            await page.locator('#lgSearch').fill('โอ๊ต');
            await page.waitForTimeout(300);
            assert(await rows() === 1, `${tag} ค้นหาชื่อผู้เล่นเจอ 1 แถว`);
            await page.locator('#lgSearch').fill('');
            await page.waitForTimeout(300);
            const modes = await page.locator('#lgMode option').allInnerTexts();
            assert(modes.some(t => t.includes('Coup')) && modes.some(t => t.includes('Black Market')), `${tag} ตัวเลือกเกมมาจาก log จริง: ${modes.join(',')}`);
            await page.locator('#lgMode').selectOption('coup');
            assert(await rows() === 2, `${tag} กรองเกม Coup = 2 แถว`);
            await page.locator('#lgMode').selectOption('all');

            // หยุดไว้ระหว่างอ่าน: log ใหม่ไม่ดันรายการ แต่ขึ้นปุ่ม "มีรายการใหม่"
            await page.locator('#lgLive').click();
            const firstBefore = await page.locator('.lg-row .lg-msg').first().innerText();
            await page.evaluate(() => window.appSocket.listeners('adminLog').forEach(fn => fn({
                id: 'n1', timestamp: new Date().toISOString(), category: 'error', roomName: 'ระบบ', message: 'error ใหม่ระหว่างอ่าน', type: 'error'
            })));
            await page.waitForTimeout(150);
            assert(await page.locator('.lg-row .lg-msg').first().innerText() === firstBefore, `${tag} หยุดไว้แล้วรายการไม่เด้ง`);
            assert(await page.locator('#lgNewPill').isVisible(), `${tag} มีปุ่มรายการใหม่`);
            assert(await count('error') === '2', `${tag} ตัวเลข Error อัปเดตแม้หยุดไว้`);
            await page.locator('#lgNewPill').click();
            assert((await page.locator('.lg-row .lg-msg').first().innerText()) === 'error ใหม่ระหว่างอ่าน', `${tag} กดแล้วเห็นรายการใหม่`);
            await page.locator('#lgLive').click();

            // ไม่มีเลื่อนแนวนอน / ข้อความไม่ล้นกรอบ
            const overflow = await page.evaluate(() => {
                const problems = [];
                if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push('page scrolls sideways');
                document.querySelectorAll('#tab-logs .lg-cat, #tab-logs .lg-tools > *, #tab-logs .lg-msg').forEach(el => {
                    if (el.scrollWidth > el.clientWidth + 2 && !el.closest('.lg-cats')) problems.push(el.className + ': ' + el.textContent.trim().slice(0, 30));
                });
                return problems;
            });
            assert(overflow.length === 0, `${tag} layout: ${overflow.join(' | ')}`);

            // ล้าง: server ลบจริง แล้วส่ง log "ถูกล้าง" กลับมาทาง socket
            if (viewport.width === 390) {
                await page.locator('.lg-tools .btn-danger').click();
                await page.locator('.swal2-confirm').click();
                await page.waitForFunction(() => document.querySelectorAll('#logsContainer .lg-row').length === 1, null, { timeout: TIMEOUT_MS });
                assert((await page.locator('.lg-row .lg-msg').first().innerText()).includes('ถูกล้าง'), `${tag} หลังล้างเหลือแค่บันทึกการล้าง`);
            }

            assert(errors.length === 0, `${tag} ไม่มี error ในหน้า: ${errors.join(' | ')}`);
            await ctx.close();
        }
        console.log(`✅ admin-logs-browser: ${passed} assertions passed`);
    } catch (error) {
        console.error(serverOutput.slice(-1500));
        throw error;
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
    }
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
