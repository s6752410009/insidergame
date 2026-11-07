#!/usr/bin/env node
/**
 * หลังบ้านกับข้อมูลชุดใหญ่: โหลดทีละแท็บ, แบ่งหน้า/ค้นหา/กรอง/เรียงฝั่ง server, ไม่ดึงก้อนใหญ่ตอนเปิดหน้า
 * ข้อมูลสร้างด้วย gen-admin-perf-data.js ลง GAME_DATA_DIR ชั่วคราวก่อนบูต
 */

const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const os = require('os');
const { randomBytes } = require('crypto');
const browserOptions = require('./browserOptions');
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
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-admin-tables-data-'));
    const artifacts = fs.mkdtempSync(path.join(process.env.SMOKE_ARTIFACT_DIR || os.tmpdir(), 'insider-admin-tables-browser-'));
    console.log(`admin-tables-browser artifacts: ${artifacts}`);
    const generated = spawnSync(process.execPath, [path.join(__dirname, 'gen-admin-perf-data.js'), dataDir,
        '--players', String(PLAYERS), '--stats', String(STATS), '--rooms', String(ROOMS), '--logs', '3000', '--banned', '25'], { encoding: 'utf8' });
    if (generated.status !== 0) throw new Error('generate failed: ' + generated.stderr);

    const statsFile = path.join(dataDir, 'playerStats.json');
    const fixtureStats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    const [denseId, sparseId] = Object.keys(fixtureStats);
    const modes = ['insider', 'werewolf', 'blackmarket', 'spyfall', 'undercover', 'coup', 'avalon', 'liar', 'poker5', 'poker4', 'pokdeng', 'codenames', 'wavelength', 'drawguess', 'colorcards', 'setthi', 'slave'];
    const denseName = 'ผู้เล่นชื่อยาว อ่านง่าย \' <img src=x onerror="window.adminUnsafeName=true">';
    Object.assign(fixtureStats[denseId], { playerName: denseName, totalGames: 1836, wins: 850, losses: 986,
        modeStats: Object.fromEntries(modes.map((mode, index) => [mode, { games: 100 + index, wins: 50, losses: 50 + index }])),
        roleStats: { gameMasterCount: 3, traitorCount: 2, citizenCount: 5, werewolf: { villager: 4, werewolf: 2 }, blackmarket: { boss: 1 } } });
    Object.assign(fixtureStats[sparseId], { totalGames: 3, wins: 1, losses: 2,
        modeStats: Object.fromEntries(modes.map(mode => [mode, { games: mode === 'coup' ? 3 : 0, wins: mode === 'coup' ? 1 : 0, losses: mode === 'coup' ? 2 : 0 }])) });
    fs.writeFileSync(statsFile, JSON.stringify(fixtureStats));
    const playersFile = path.join(dataDir, 'players.json');
    const fixturePlayers = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
    fixturePlayers[denseId].playerName = denseName;
    fs.writeFileSync(playersFile, JSON.stringify(fixturePlayers));

    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
    const server = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), GAME_DATA_DIR: dataDir, MONGO_URL: '', MONGODB_URI: '', NODE_ENV: 'test', APP_ENV: 'staging', ADMIN_PASSWORD: settings.adminPassword || 'admin123', SESSION_SECRET: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: base },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverOutput = '';
    server.stdout.on('data', c => { serverOutput += String(c); });
    server.stderr.on('data', c => { serverOutput += String(c); });
    let browser;
    let currentPage;
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

        browser = await chromium.launch(browserOptions());
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 780 }]) {
            const tag = `[${viewport.width}]`;
            const ctx = await browser.newContext({ viewport, locale: 'th-TH', acceptDownloads: true });
            await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
            const page = await ctx.newPage();
            currentPage = page;
            page.setDefaultTimeout(TIMEOUT_MS);
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            const sentEvents = [];
            let receivedBytes = 0;
            let receivedHistory = false;
            let insightsRequests = 0;
            page.on('request', request => { if (new URL(request.url()).pathname === '/admin/api/insights') insightsRequests += 1; });
            const navigations = [];
            let adminDocumentLoads = 0;
            page.on('request', request => { if (request.isNavigationRequest() && request.resourceType() === 'document' && new URL(request.url()).pathname === '/admin') adminDocumentLoads += 1; });
            page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
            page.on('websocket', ws => {
                ws.on('framesent', frame => { const parsed = parseFrame(frame.payload); if (parsed?.name) sentEvents.push(parsed.name); });
                ws.on('framereceived', frame => { const parsed = parseFrame(frame.payload); if (parsed) receivedBytes += parsed.bytes; if (String(frame.payload).includes('gameHistory')) receivedHistory = true; });
            });

            await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
            await page.locator('input[name="password"]').fill(settings.adminPassword || 'admin123');
            await Promise.all([
                page.waitForURL(url => url.pathname === '/admin', { timeout: TIMEOUT_MS }),
                page.locator('input[name="password"]').press('Enter')
            ]);
            await page.waitForFunction(() => Number(document.querySelector('#totalPlayers')?.textContent) > 0, null, { timeout: TIMEOUT_MS });
            await page.waitForFunction(() => document.querySelector('#adminInsights')?.getAttribute('aria-busy') === 'false'
                && !document.querySelector('#insightContent')?.hidden && document.querySelector('#insightError')?.hidden, null, { timeout: TIMEOUT_MS });
            await page.evaluate(() => document.fonts.ready);
            assert(await page.locator('.tab-btn.active').getAttribute('data-tab') === 'overview', `${tag} ภาพรวมเป็นแท็บเริ่มต้น`);
            assert(await page.locator('#adminInsights').count() === 1 && await page.locator('#tab-overview h1').innerText() === 'ภาพรวม', `${tag} ฝังภาพรวมเพียงครั้งเดียว`);
            assert(await page.locator('.tab-btn[href*="insights"]').count() === 0, `${tag} เมนูภาพรวมไม่มีลิงก์ซ้ำ`);
            assert(insightsRequests === 1, `${tag} ภาพรวมโหลดครั้งแรกครั้งเดียว (${insightsRequests})`);
            assert(!sentEvents.includes('admin_getPlayers') && !sentEvents.includes('admin_getPlayerStat'), `${tag} ยังไม่โหลดผู้เล่นหรือรายละเอียด`);
            assert(!receivedHistory, `${tag} payload ตอนเปิดไม่มี gameHistory`);
            assert(await page.locator('header.app-header').isHidden(), `${tag} ซ่อนโลโก้แอพเดิม`);
            if (viewport.width < 760) {
                const header = await page.locator('.admin-header').boundingBox();
                assert(header.height <= 60, `${tag} หัวมือถือแถวเดียวไม่เกิน 60px (${header.height}px)`);
                assert(await page.locator('.admin-header-actions').evaluate(el => [...el.children].every(item => item.getBoundingClientRect().width === 44 && item.getBoundingClientRect().height === 44)), `${tag} ปุ่มหัวมือถือ 44px`);
            }
            assert(await page.locator('.stats-grid').isHidden(), `${tag} ซ่อนสรุปเก่าแต่เก็บ IDs`);
            assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1), `${tag} ภาพรวมไม่ล้นหน้าจอ`);
            assert(await page.locator('.admin-container').evaluate(el => getComputedStyle(el).fontFamily.includes('Bai') || getComputedStyle(el).fontFamily.includes('Kanit') || getComputedStyle(el).fontFamily.includes('system-ui')), `${tag} shell ใช้ฟอนต์ไทย`);
            await page.screenshot({ path: path.join(artifacts, `admin-overview-${viewport.width}.png`), animations: 'disabled' });
            await page.locator('.tab-btn[data-tab="players"]').click();
            await page.waitForFunction(() => /แสดง/.test(document.querySelector('#playersTableMeta')?.textContent || ''), null, { timeout: TIMEOUT_MS });
            await page.waitForTimeout(400);

            // เปิดหน้าครั้งเดียว ไม่ reload ซ้ำ (เดิม playerIdentity พา /admin → /admin?playerId=... ทุกครั้ง)
            assert(adminDocumentLoads === 1, `${tag} เปิด /admin ครั้งเดียว: ${navigations.join(' → ')}`);
            assert(!sentEvents.includes('admin_getData'), `${tag} ไม่ดึงก้อนใหญ่ admin_getData`);
            assert(!sentEvents.includes('admin_getStats') && !sentEvents.includes('admin_getRooms') && !sentEvents.includes('admin_getLogs'), `${tag} แท็บที่ยังไม่เปิดยังไม่โหลด: ${sentEvents.join(',')}`);
            assert(receivedBytes < 150 * 1024, `${tag} ข้อมูลตอนเปิดหน้า < 150KB (ได้ ${(receivedBytes / 1024).toFixed(1)}KB)`);

            // ผู้เล่น: หน้าละ 50 + ตัวแบ่งหน้า (รอบมือถือมีคนถูกลบไปแล้ว 1 คนจากรอบแรก)
            const expectedPlayers = viewport.width === 1280 ? PLAYERS : PLAYERS - 1;
            assert(await page.locator('#tab-players .admin-more-actions').getAttribute('open') === null, `${tag} เมนูลบผู้เล่นปิดเริ่มต้น`);
            await page.screenshot({ path: path.join(artifacts, `admin-players-${viewport.width}.png`), animations: 'disabled' });
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

            // ผูก Google: ตัวเลขสรุป + กรอง linked/unlinked + ป้าย/รูป/อีเมลในแถว
            // ตัวสร้างข้อมูลผูก Google ให้ทุกคนที่ index ลงท้าย 5 (120 คน) — รอบมือถือคนหนึ่งอาจถูกลบไปแล้ว
            const linkedProbe = await page.evaluate(() => new Promise(resolve => window.appSocket.emit('admin_getPlayers', { googleFilter: 'linked', pageSize: 1 }, resolve)));
            const expectedLinked = linkedProbe.filtered;
            assert(expectedLinked === 120 || (expectedPlayers < PLAYERS && expectedLinked === 119), `${tag} server กรองผูก Google ได้ ${expectedLinked}`);
            assert(await page.locator('#summaryGoogleLinked').innerText() === String(expectedLinked), `${tag} สรุปผูก Google ${expectedLinked}`);
            await page.locator('#playerGoogleFilter').selectOption('linked');
            await page.waitForFunction(n => new RegExp('จาก ' + n.toLocaleString('th-TH') + ' คน').test(document.querySelector('#playersTableMeta')?.textContent || ''), expectedLinked, { timeout: TIMEOUT_MS });
            const linkedRows = page.locator('#playersTable tr[data-player-id]');
            assert(await linkedRows.count() === 50, `${tag} กรองผูก Google หน้าแรก 50 แถว`);
            assert(await page.locator('#playersTable .admin-google-badge').count() === 50, `${tag} ทุกแถวมีป้าย Google`);
            const thumb = page.locator('#playersTable .admin-google-thumb img').first();
            assert(await thumb.getAttribute('referrerpolicy') === 'no-referrer', `${tag} รูป Google ไม่ส่ง referrer`);
            assert(/@example\.com/.test(await page.locator('#playersTable [data-google-email]').first().innerText()), `${tag} โชว์อีเมล Google ให้แอดมิน`);
            await page.locator('#playerGoogleFilter').selectOption('unlinked');
            await page.waitForFunction(n => new RegExp('จาก ' + n.toLocaleString('th-TH') + ' คน').test(document.querySelector('#playersTableMeta')?.textContent || ''), expectedPlayers - expectedLinked, { timeout: TIMEOUT_MS });
            assert(await page.locator('#playersTable .admin-google-badge').count() === 0, `${tag} ยังไม่ผูก = ไม่มีป้าย Google`);
            await page.locator('#playerGoogleFilter').selectOption('all');
            await page.waitForFunction(() => document.querySelectorAll('#playersTable tr[data-player-id]').length === 50, null, { timeout: TIMEOUT_MS });
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
            assert(statsPage.rows[0].playerId === denseId, `${tag} fixture 17 เกมเรียงตามจำนวนรอบรวม`);
            assert(!sentEvents.includes('admin_getPlayerStat'), `${tag} ตารางสถิติไม่โหลดรายละเอียดอัตโนมัติ`);
            const tableLayout = await page.locator('#statsTable tr').evaluateAll(rows => rows.map(row => ({
                columns: row.cells.length, height: row.getBoundingClientRect().height,
                nameWidth: row.cells[1].getBoundingClientRect().width,
                actionsWidth: row.cells[6].getBoundingClientRect().width,
                actions: [...row.querySelectorAll('.action-btn')].map(button => {
                    const style = getComputedStyle(button), box = button.getBoundingClientRect();
                    return { width: box.width, height: box.height, nowrap: style.whiteSpace === 'nowrap', font: parseFloat(style.fontSize) };
                })
            })));
            const maxRowHeight = viewport.width < 760 ? 180 : 80;
            assert(tableLayout.every(row => row.columns === 7 && row.height <= maxRowHeight), `${tag} ทุก record มีข้อมูล 7 ช่องและสูงไม่เกิน ${maxRowHeight}px (${Math.max(...tableLayout.map(row => row.height))}px)`);
            assert(tableLayout.every(row => row.nameWidth >= 140 && row.actionsWidth >= 132 && row.actions.length === 3 && row.actions.every(button => button.width >= 44 && button.height >= 44 && button.nowrap && button.font >= 14)), `${tag} ชื่อและปุ่มไม่บีบหรือแยกอักษร`);
            assert(await page.locator('#statsTable .status-badge').count() === 0, `${tag} ไม่มี badge 17 เกมในตารางเริ่มต้น`);
            assert(await page.locator('#statsTable tr').first().locator('td').nth(1).innerText() === denseName && !await page.evaluate(() => Boolean(window.adminUnsafeName)), `${tag} ชื่อผู้เล่นแสดงเป็นข้อความปลอดภัย`);
            assert(await page.locator('#tab-stats .admin-more-actions').getAttribute('open') === null, `${tag} เมนูรีเซ็ตและนำเข้าปิดเริ่มต้น`);
            assert(await page.locator('#playerStatsDetail').isHidden(), `${tag} รายละเอียดไม่เปิดเอง`);
            assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1), `${tag} ตารางสถิติเลื่อนภายใน ไม่ล้นทั้งหน้า`);
            await page.locator('#tab-stats').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(artifacts, `admin-stats-${viewport.width}.png`), animations: 'disabled' });
            if (viewport.width < 760) {
                const mobileLayout = await page.locator('#statsTable tr').evaluateAll(rows => rows.every(row => {
                    return [...row.querySelectorAll('td:nth-child(n+2):nth-child(-n+6), .action-btn')].every(element => {
                        const box = element.getBoundingClientRect();
                        return box.width > 0 && box.left >= -1 && box.right <= innerWidth + 1;
                    });
                }));
                assert(mobileLayout, `${tag} ชื่อ รอบ ชนะ แพ้ เปอร์เซ็นต์และปุ่มทุกใบอยู่ในหน้าจอโดยไม่เลื่อนแนวนอน`);
                assert(await page.locator('#tab-stats .compact-table').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${tag} cards ไม่ต้องเลื่อนแนวนอน`);
                assert(await page.locator('#tab-stats .table-scroll-hint').isHidden(), `${tag} ไม่แสดงคำแนะนำเลื่อนตาราง`);
                assert(await page.locator('#tab-stats th.stats-sortable').evaluateAll(elements => elements.length === 5 && elements.every(element => element.getBoundingClientRect().height >= 44 && element.getBoundingClientRect().right <= innerWidth + 1)), `${tag} ปุ่มเรียงลำดับครบและสูง 44px`);
                await page.locator('#statsTable tr').first().scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(artifacts, `admin-stats-cards-${viewport.width}.png`), animations: 'disabled' });
                await page.locator('#statsTable tr').first().screenshot({ path: path.join(artifacts, `admin-stat-card-${viewport.width}.png`), animations: 'disabled' });
            }
            await page.locator('#statsTable .action-btn.info').first().click();
            await page.waitForFunction(() => document.querySelectorAll('#playerStatsDetail .admin-mode-table tbody tr').length === 17);
            assert(await page.locator('#playerStatsDetail .admin-mode-table tbody tr').count() === 17, `${tag} กดรายละเอียดจึงแสดงจำนวนรอบครบ 17 เกม`);
            assert(JSON.stringify(await page.locator('#playerStatsDetail .admin-mode-table tbody tr').first().locator('th,td').allTextContents()) === JSON.stringify(['Insider', '100', '50', '50']), `${tag} รายละเอียดแสดงจำนวนครั้งที่เล่น ชนะ แพ้`);
            assert(await page.locator('#playerStatsDetail .admin-stat-total').innerText() === 'เล่นทั้งหมด 1,836 ครั้ง', `${tag} สถิติรวมใช้หน่วยครั้ง`);
            const roleFold = page.locator('#playerStatsDetail .admin-stat-roles');
            assert(await roleFold.getAttribute('open') === null, `${tag} รายละเอียดบทบาทพับเริ่มต้น`);
            await roleFold.locator('summary').click();
            assert(await roleFold.locator('tbody tr').count() === 6, `${tag} เปิดดูบทบาทที่เคยเล่นได้`);
            await page.screenshot({ path: path.join(artifacts, `admin-details-${viewport.width}.png`), animations: 'disabled' });
            await page.locator('#playerStatsDetail').screenshot({ path: path.join(artifacts, `admin-details-full-${viewport.width}.png`), animations: 'disabled' });
            const beforeReload = sentEvents.filter(event => event === 'admin_getStats').length;
            await page.evaluate(() => window.loadData());
            await page.waitForFunction(id => document.querySelector(`#statsTable tr[data-player-id="${id}"] .info`)?.getAttribute('aria-expanded') === 'true', denseId);
            assert(await page.locator('#playerStatsDetail').isVisible() && await roleFold.getAttribute('open') !== null, `${tag} รีเฟรชแล้วอ่านรายละเอียดต่อได้`);
            assert(sentEvents.filter(event => event === 'admin_getStats').length > beforeReload, `${tag} ตรวจหลังโหลดตารางใหม่จริง`);
            await page.locator('#closePlayerStatsDetail').click();
            assert(await page.locator('#statsTable .info').first().evaluate(el => el === document.activeElement), `${tag} ปิดรายละเอียดคืน focus ปุ่มแถวใหม่`);
            await page.locator('#statsTable .info').first().click();
            await page.locator('#searchStats').fill(sparseId);
            await page.waitForFunction(() => document.querySelectorAll('#statsTable tr[data-player-id]').length === 1);
            assert(await page.locator('#playerStatsDetail').isHidden(), `${tag} กรองผู้เล่นที่เปิดอยู่ออกแล้วปิดรายละเอียด`);
            await page.locator('#statsTable .info').click();
            await page.waitForFunction(() => document.querySelectorAll('#playerStatsDetail .admin-mode-table tbody tr').length === 1);
            assert(JSON.stringify(await page.locator('#playerStatsDetail .admin-mode-table tbody tr').locator('th,td').allTextContents()) === JSON.stringify(['Coup', '3', '1', '2']), `${tag} รายละเอียดไม่แสดง 16 เกมที่ยังไม่เล่น`);
            await page.locator('#closePlayerStatsDetail').click();
            await page.locator('#searchStats').fill('admin-no-such-player');
            await page.waitForFunction(() => document.querySelector('#statsTable .empty-message')?.getAttribute('colspan') === '7');
            assert(await page.locator('#statsTable .empty-message').getAttribute('colspan') === '7', `${tag} แถวว่างขยายครบ 7 คอลัมน์`);
            await page.locator('#searchStats').fill('');
            await page.waitForFunction(() => document.querySelectorAll('#statsTable tr[data-player-id]').length === 50);
            await page.locator('#statsModeFilter').selectOption('has-coup');
            await page.waitForTimeout(600);
            const coupMeta = await page.locator('#statsTableMeta').innerText();
            assert(/ทั้งหมด (700|699)\)/.test(coupMeta), `${tag} กรองโหมด: ${coupMeta}`);
            await page.locator('#statsModeFilter').selectOption('all');
            await page.waitForTimeout(400);
            await page.locator('#statsTable .action-btn.kick').first().click();
            await page.waitForSelector('.swal2-popup');
            assert(await page.locator('.swal2-html-container strong').innerText() === denseName && await page.locator('.swal2-html-container img').count() === 0 && !await page.evaluate(() => Boolean(window.adminUnsafeName)), `${tag} ยืนยันลบแสดงชื่อปลอดภัย`);
            await page.locator('.swal2-cancel').click();
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
                const victim = await page.locator('#playersTable tr[data-player-id]').evaluateAll((rows, protectedIds) => rows.find(row => !protectedIds.includes(row.dataset.playerId)).dataset.playerId, [denseId, sparseId]);
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
            console.log(`admin-tables-browser: ${viewport.width}px passed`);
            await ctx.close();
            currentPage = null;
        }
        console.log(`✅ admin-tables-browser: ${passed} assertions passed`);
    } catch (error) {
        if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
        console.error(serverOutput.slice(-1500));
        throw error;
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
        await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
