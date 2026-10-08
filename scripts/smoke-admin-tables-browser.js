#!/usr/bin/env node
/**
 * หลังบ้านกับข้อมูลชุดใหญ่: โหลดทีละแท็บ, แบ่งหน้า/ค้นหา/กรอง/เรียงฝั่ง server, ไม่ดึงก้อนใหญ่ตอนเปิดหน้า
 * ข้อมูลสร้างด้วย gen-admin-perf-data.js ลง GAME_DATA_DIR ชั่วคราวก่อนบูต
 */

require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const PLAYERS = 1200;
const STATS = 700;
const ROOMS = 30;
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
    while (Date.now() - startedAt < 60000) {
        if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
        const ok = await new Promise(resolve => {
            http.get(url, res => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
        });
        if (ok) return;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for local server');
}

function parseFrame(payload) {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const match = /^4([23])(\d*)(\[.*)$/s.exec(text);
    if (!match) return null;
    const nameMatch = match[1] === '2' ? /^\["([^"]+)"/.exec(match[3]) : null;
    return { kind: match[1] === '2' ? 'event' : 'ack', name: nameMatch ? nameMatch[1] : null, bytes: Buffer.byteLength(text) };
}

async function run() {
    const dataDir = process.env.GAME_DATA_DIR;
    const generated = spawnSync(process.execPath, [path.join(__dirname, 'gen-admin-perf-data.js'), dataDir,
        '--players', String(PLAYERS), '--stats', String(STATS), '--rooms', String(ROOMS), '--logs', '3000', '--banned', '25'], { encoding: 'utf8' });
    if (generated.status !== 0) throw new Error('generate failed: ' + generated.stderr);

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

        // socket ที่ไม่ได้ยืนยันตัวเป็นแอดมิน ขออะไรไม่ได้เลย
        const stranger = io(base, { transports: ['websocket'], forceNew: true });
        await new Promise(resolve => stranger.once('connect', resolve));
        for (const event of ['admin_getSummary', 'admin_getPlayers', 'admin_getRooms', 'admin_getStats', 'admin_getBanned', 'admin_getSiteAdmins', 'admin_getPlayerStat', 'admin_searchPlayers']) {
            const result = await new Promise(resolve => stranger.emit(event, {}, resolve));
            assert(result && result.success === false && /Unauthorized/.test(result.error), `${event} ต้องเป็นแอดมิน`);
        }
        stranger.close();
        const exportDenied = await new Promise(resolve => http.get(`${base}/admin/api/export/all`, res => { res.resume(); resolve(res.statusCode); }));
        assert(exportDenied === 401, `export ต้อง login (${exportDenied})`);

        browser = await chromium.launch({ headless: true });
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
            const tag = `[${viewport.width}]`;
            const ctx = await browser.newContext({ viewport, locale: 'th-TH', acceptDownloads: true });
            await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
            const page = await ctx.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            const sentEvents = [];
            let receivedBytes = 0;
            const navigations = [];
            page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
            page.on('websocket', ws => {
                ws.on('framesent', frame => { const parsed = parseFrame(frame.payload); if (parsed?.name) sentEvents.push(parsed.name); });
                ws.on('framereceived', frame => { const parsed = parseFrame(frame.payload); if (parsed) receivedBytes += parsed.bytes; });
            });

            await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
            await page.locator('input[name="password"]').fill(settings.adminPassword || 'admin123');
            await Promise.all([
                page.waitForURL(url => url.pathname === '/admin', { timeout: TIMEOUT_MS }),
                page.locator('input[name="password"]').press('Enter')
            ]);
            await page.waitForFunction(() => /แสดง/.test(document.querySelector('#playersTableMeta')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            await page.waitForTimeout(800);

            // เปิดหน้าครั้งเดียว ไม่ reload ซ้ำ (เดิม playerIdentity พา /admin → /admin?playerId=... ทุกครั้ง)
            assert(navigations.filter(url => new URL(url).pathname === '/admin').length === 1, `${tag} เปิด /admin ครั้งเดียว: ${navigations.join(' → ')}`);
            assert(!sentEvents.includes('admin_getData'), `${tag} ไม่ดึงก้อนใหญ่ admin_getData`);
            assert(!sentEvents.includes('admin_getStats') && !sentEvents.includes('admin_getRooms') && !sentEvents.includes('admin_getLogs'), `${tag} แท็บที่ยังไม่เปิดยังไม่โหลด: ${sentEvents.join(',')}`);
            assert(receivedBytes < 150 * 1024, `${tag} ข้อมูลตอนเปิดหน้า < 150KB (ได้ ${(receivedBytes / 1024).toFixed(1)}KB)`);

            // ผู้เล่น: หน้าละ 50 + ตัวแบ่งหน้า (รอบมือถือมีคนถูกลบไปแล้ว 1 คนจากรอบแรก)
            const expectedPlayers = viewport.width === 1280 ? PLAYERS : PLAYERS - 1;
            const meta = await page.locator('#playersTableMeta').innerText();
            assert(meta.includes(`แสดง 1–50 จาก ${expectedPlayers.toLocaleString('th-TH')}`), `${tag} meta ผู้เล่น: ${meta}`);
            assert(await page.locator('#playersTable tr[data-player-id]').count() === 50, `${tag} ผู้เล่นหน้าแรก 50 แถว`);
            assert(await page.locator('#playersPager').isVisible(), `${tag} มีตัวแบ่งหน้า`);
            assert(await page.locator('#totalPlayers').innerText() === String(expectedPlayers), `${tag} ตัวเลขสรุปผู้เล่น`);
            const firstPageIds = await page.locator('#playersTable tr[data-player-id]').evaluateAll(list => list.map(el => el.dataset.playerId));
            await page.locator('#playersPager button', { hasText: 'ถัดไป' }).click();
            await page.waitForFunction(() => /แสดง 51–100/.test(document.querySelector('#playersTableMeta')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            const secondPageIds = await page.locator('#playersTable tr[data-player-id]').evaluateAll(list => list.map(el => el.dataset.playerId));
            assert(secondPageIds.length === 50 && !secondPageIds.some(id => firstPageIds.includes(id)), `${tag} หน้า 2 ไม่ซ้ำหน้าแรก`);
            assert((await page.locator('#playersPager .table-pager-info').innerText()).includes(`2 / ${Math.ceil(expectedPlayers / 50)}`), `${tag} บอกหน้าปัจจุบัน`);

            // ค้นหาฝั่ง server (ข้ามหน้าได้ — คนที่อยู่หน้า 20 ก็เจอ)
            const target = await page.evaluate(() => new Promise(resolve => window.appSocket.emit('admin_getPlayers', { page: 20, pageSize: 50 }, resolve)));
            const needle = target.rows[7].playerId;
            await page.locator('#searchPlayers').fill(needle);
            await page.waitForFunction(id => document.querySelectorAll('#playersTable tr[data-player-id]').length === 1
                && document.querySelector('#playersTable tr[data-player-id]').dataset.playerId === id, needle, { timeout: TIMEOUT_MS });
            assert(await page.locator('#playersPager').isHidden(), `${tag} ผลค้นหาหน้าเดียวไม่มีตัวแบ่งหน้า`);
            await page.locator('#searchPlayers').fill('');
            await page.waitForFunction(() => document.querySelectorAll('#playersTable tr[data-player-id]').length === 50, null, { timeout: TIMEOUT_MS });

            // กรองสถานะ "ถูกแบน" = 25 คน · เรียงชื่อ
            await page.locator('#playerStatusFilter').selectOption('banned');
            await page.waitForFunction(() => /จาก 25 คน/.test(document.querySelector('#playersTableMeta')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            assert(await page.locator('#playersTable tr[data-player-id]').count() === 25, `${tag} กรองแบน 25 คน`);
            await page.locator('#playerStatusFilter').selectOption('all');
            await page.locator('th[data-sort="name"]').first().click();
            await page.waitForTimeout(600);
            const sortedPage = await page.evaluate(() => new Promise(resolve => window.appSocket.emit('admin_getPlayers', { sortCol: 'name', sortDir: 'asc', pageSize: 50 }, resolve)));
            const shownIds = await page.locator('#playersTable tr[data-player-id]').evaluateAll(list => list.map(el => el.dataset.playerId));
            assert(JSON.stringify(shownIds) === JSON.stringify(sortedPage.rows.map(row => row.playerId)), `${tag} คลิกหัวคอลัมน์ = เรียงชื่อฝั่ง server`);

            // สถิติ: โหลดตอนกดแท็บ หน้าละ 50 ไม่มี gameHistory
            await page.locator('.tab-btn[data-tab="stats"]').click();
            await page.waitForFunction(() => /แสดง 1–50 จาก (700|699) /.test(document.querySelector('#statsTableMeta')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            assert(sentEvents.includes('admin_getStats'), `${tag} แท็บสถิติโหลดตอนเปิด`);
            const statsPage = await page.evaluate(() => new Promise(resolve => window.appSocket.emit('admin_getStats', { page: 1, pageSize: 50 }, resolve)));
            assert(statsPage.rows.length === 50 && statsPage.rows.every(row => !('gameHistory' in row)), `${tag} สถิติไม่ส่ง gameHistory`);
            await page.locator('#statsModeFilter').selectOption('has-coup');
            await page.waitForTimeout(600);
            const coupMeta = await page.locator('#statsTableMeta').innerText();
            assert(/ทั้งหมด (700|699)\)/.test(coupMeta), `${tag} กรองโหมด: ${coupMeta}`);
            await page.locator('#statsModeFilter').selectOption('all');
            await page.waitForTimeout(400);
            await page.locator('#statsTable .action-btn.edit').first().click();
            await page.waitForSelector('.swal2-popup', { timeout: TIMEOUT_MS });
            assert(await page.locator('.swal2-popup').isVisible(), `${tag} แก้สถิติรายคนดึงข้อมูลคนนั้นมาแสดง`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);

            // ห้อง + แบน
            await page.locator('.tab-btn[data-tab="rooms"]').click();
            await page.waitForFunction(() => /แสดง 1–30 จาก 30 ห้อง/.test(document.querySelector('#roomsTableMeta')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            assert(await page.locator('#roomsPager').isHidden(), `${tag} ห้อง 30 ห้องหน้าเดียว`);
            await page.locator('#searchRooms').fill('ห้องทดสอบ 7');
            await page.waitForFunction(() => document.querySelectorAll('#roomsTable tr').length >= 1
                && [...document.querySelectorAll('#roomsTable tr')].every(tr => tr.textContent.includes('ห้องทดสอบ 7')), null, { timeout: TIMEOUT_MS });
            await page.locator('#searchRooms').fill('');
            await page.locator('.tab-btn[data-tab="banned"]').click();
            await page.waitForFunction(() => document.querySelectorAll('#bannedTable tr').length === 25, null, { timeout: TIMEOUT_MS });
            assert(true, `${tag} แท็บแบนโหลดตอนเปิด`);

            if (viewport.width === 1280) {
                // ดาวน์โหลดสถิติ: ดึงจาก server ตอนกด (ครบทุกคน ไม่ใช่แค่หน้าที่เห็น)
                await page.locator('.tab-btn[data-tab="stats"]').click();
                const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.exportStats())]);
                const csv = fs.readFileSync(await download.path(), 'utf8').trim().split('\n');
                assert(csv.length === STATS + 1, `${tag} CSV สถิติครบ ${csv.length - 1}/${STATS}`);

                // ลบผู้เล่น → ตัวเลข/ตารางเปลี่ยนทันที (ไม่ติด cache)
                await page.locator('.tab-btn[data-tab="players"]').click();
                await page.waitForTimeout(500);
                const victim = await page.locator('#playersTable tr[data-player-id]').first().getAttribute('data-player-id');
                await page.locator(`#playersTable tr[data-player-id="${victim}"] .action-btn.delete`).click();
                await page.locator('.swal2-confirm').click();
                await page.waitForFunction(n => document.querySelector('#totalPlayers')?.textContent === String(n), PLAYERS - 1, { timeout: TIMEOUT_MS });
                assert(await page.locator(`#playersTable tr[data-player-id="${victim}"]`).count() === 0, `${tag} คนที่ลบหายจากตาราง`);
                const audit = await page.evaluate(() => new Promise(resolve => window.appSocket.emit('admin_getLogs', { cat: 'admin', limit: 5 }, resolve)));
                assert(audit.logs.some(log => log.message.includes('ลบผู้เล่น')), `${tag} การลบถูกจดใน log แอดมิน`);
            }

            // ไม่มีเลื่อนแนวนอนทั้งหน้า
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
            assert(!overflow, `${tag} ไม่มีเลื่อนแนวนอน`);
            assert(errors.length === 0, `${tag} ไม่มี error ในหน้า: ${errors.join(' | ')}`);
            await ctx.close();
        }
        console.log(`✅ admin-tables-browser: ${passed} assertions passed`);
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
