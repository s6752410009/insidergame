#!/usr/bin/env node
/**
 * แท็บ Logs ของแอดมิน: กรองประเภท/เกม, ค้นหา, หยุดรายการสดระหว่างอ่าน, แสดงเพิ่ม, ล้าง, ดาวน์โหลด, ดูทั้งห้อง
 * log ตัวอย่างเขียนลงที่เก็บ (serverLogs.ndjson ใน GAME_DATA_DIR) ก่อนบูต → หน้าเว็บต้องดึงจาก server ทีละหน้า
 * log สดฉีดผ่าน listener 'adminLog' ของหน้าเอง (ทางเดียวกับที่ server ส่งมา)
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
    const seeded = sampleLogs();
    fs.mkdirSync(process.env.GAME_DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.GAME_DATA_DIR, 'serverLogs.ndjson'),
        seeded.slice().reverse().map(entry => JSON.stringify(entry)).join('\n') + '\n');
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
            const settle = () => page.waitForFunction(() => !document.querySelector('#lgMore')?.disabled
                && !/กำลังโหลด/.test(document.querySelector('#logsContainer')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            await page.locator('.lg-cat[data-cat="important"]').click();
            await settle();
            await page.waitForSelector('#logsContainer .lg-row');

            // ค่าเริ่มต้น = สำคัญ: error + admin + เริ่มเกม (+ log ระบบของ server เอง เช่นตอนบูต) ไม่เอา log ระหว่างเล่น
            const ownSystem = Number(await count('system'));
            assert(ownSystem >= 1, `${tag} มี log ระบบตอนบูต`);
            assert(await rows() === 3 + ownSystem, `${tag} สำคัญ = 3 + ระบบ ${ownSystem} (ได้ ${await rows()})`);
            assert(await count('important') === String(3 + ownSystem), `${tag} ตัวเลขสำคัญตรงกับแถว`);
            assert(await count('error') === '1', `${tag} Error นับ 1`);
            assert(await page.locator('.lg-cat[data-cat="error"]').evaluate(el => el.classList.contains('is-alert')), `${tag} ปุ่ม Error เด่นเมื่อมี error`);
            assert(await page.locator('.lg-row--error').count() === 1, `${tag} แถว error มีสีเตือน`);
            assert(await page.locator('.lg-row', { hasText: 'เริ่มเกม (5 คน)' }).locator('.lg-msg').innerText() === 'Coup เริ่มเกม (5 คน)', `${tag} ตัดอีโมจิเกมที่ซ้ำกับป้ายออก`);
            assert(await page.locator('.lg-row', { hasText: 'item_' }).count() === 0, `${tag} สำคัญไม่มีบรรทัดระหว่างเล่น`);

            // ทั้งหมด: หน้าแรก 200 จาก server + ปุ่มแสดงเพิ่ม ดึงหน้าถัดไปจากที่เก็บ
            await page.locator('.lg-cat[data-cat="all"]').click();
            await settle();
            const totalAll = Number((await count('all')).replace(/,/g, ''));
            assert(totalAll === 264 + ownSystem, `${tag} ทั้งหมด = log ที่เก็บไว้ 264 + ของ server (${totalAll})`);
            assert(await rows() === 200, `${tag} หน้าแรก 200 แถว`);
            assert(await page.locator('#lgMore').isVisible(), `${tag} มีปุ่มแสดงเพิ่ม`);
            assert((await page.locator('#lgMore').innerText()).includes(String(totalAll - 200)), `${tag} ปุ่มบอกจำนวนที่เหลือ`);
            await page.locator('#lgMore').click();
            await settle();
            assert(await rows() === totalAll, `${tag} แสดงเพิ่มครบ`);
            assert(await page.locator('#lgMore').isHidden(), `${tag} ครบแล้วปุ่มแสดงเพิ่มหาย`);
            const oldest = await page.locator('.lg-row .lg-msg').last().innerText();
            assert(oldest.includes('item_259'), `${tag} แถวสุดท้ายคือ log เก่าสุดจากที่เก็บ: ${oldest}`);

            // ตัดป้าย [BlackMarket] ที่ซ้ำกับป้ายเกม
            const bmText = await page.locator('.lg-row', { hasText: 'item_0 ' }).locator('.lg-msg').innerText();
            assert(bmText.startsWith('เจ ซื้อของ'), `${tag} ไม่มี [BlackMarket] ซ้ำ: ${bmText}`);

            // ค้นหา + กรองเกม (ฝั่ง server)
            await page.locator('#lgSearch').fill('โอ๊ต');
            await page.waitForFunction(() => document.querySelectorAll('#logsContainer .lg-row').length === 1, null, { timeout: TIMEOUT_MS });
            assert(await rows() === 1, `${tag} ค้นหาชื่อผู้เล่นเจอ 1 แถว`);
            assert(await count('all') === '1', `${tag} ตัวเลขนับตามคำค้น`);
            await page.locator('#lgSearch').fill('');
            await page.waitForFunction(() => document.querySelectorAll('#logsContainer .lg-row').length === 200, null, { timeout: TIMEOUT_MS });
            const modes = await page.locator('#lgMode option').allInnerTexts();
            assert(modes.some(t => t.includes('Coup')) && modes.some(t => t.includes('Black Market')), `${tag} ตัวเลือกเกมมาจาก log จริง: ${modes.join(',')}`);
            await page.locator('#lgMode').selectOption('coup');
            await page.waitForFunction(() => document.querySelectorAll('#logsContainer .lg-row').length === 2, null, { timeout: TIMEOUT_MS });
            assert(await rows() === 2, `${tag} กรองเกม Coup = 2 แถว`);

            // ดาวน์โหลด: ได้ทุกแถวตามตัวกรอง (ดึงจากที่เก็บ ไม่ใช่แค่ที่โชว์)
            if (viewport.width === 1280) {
                const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.lg-tools .btn-success').click()]);
                const text = fs.readFileSync(await download.path(), 'utf8').trim().split('\n');
                assert(text.length === 2 && text.every(line => line.includes('Coup')), `${tag} ดาวน์โหลดตามตัวกรอง Coup: ${text.length} บรรทัด`);
                await page.locator('#lgMode').selectOption('all');
                await settle();
                const [allDownload] = await Promise.all([page.waitForEvent('download'), page.locator('.lg-tools .btn-success').click()]);
                const allLines = fs.readFileSync(await allDownload.path(), 'utf8').trim().split('\n');
                assert(allLines.length === totalAll, `${tag} ดาวน์โหลดทั้งหมดครบ ${allLines.length}/${totalAll} (เกินหน้าที่โหลดไว้)`);
            }
            await page.locator('#lgMode').selectOption('all');
            await settle();

            // ดูทั้งห้อง: กดชื่อห้อง → เหลือแต่ห้องนั้น (ดึงจาก server) · กดชิปเพื่อยกเลิก
            await page.locator('.lg-row', { hasText: 'โอ๊ต' }).locator('.lg-room').click();
            await settle();
            assert(await page.locator('#lgRoomChip').isVisible(), `${tag} มีชิปห้องที่เลือก`);
            assert(await count('all') === '261', `${tag} ห้องแก๊งเพื่อน 261 บรรทัด (ได้ ${await count('all')})`);
            assert(await page.locator('.lg-row', { hasText: 'Coup' }).count() === 0, `${tag} ไม่มีห้องอื่นปน`);
            await page.locator('#lgRoomChip').click();
            await settle();
            assert(await page.locator('#lgRoomChip').isHidden(), `${tag} ยกเลิกห้องแล้วชิปหาย`);

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
                // ล้างจากที่เก็บจริง: ไฟล์บนดิสก์เหลือแค่บันทึกการล้าง
                await page.waitForTimeout(1500);
                const onDisk = fs.readFileSync(path.join(process.env.GAME_DATA_DIR, 'serverLogs.ndjson'), 'utf8').trim().split('\n').filter(Boolean);
                assert(onDisk.length === 1 && onDisk[0].includes('ถูกล้าง'), `${tag} ไฟล์ log บนดิสก์ถูกล้างด้วย (${onDisk.length} บรรทัด)`);
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
