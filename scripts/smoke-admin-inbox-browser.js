#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);

function assert(condition, message) {
    if (!condition) throw new Error(message);
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

function ping(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, response => {
            response.resume();
            resolve(response.statusCode || 0);
        });
        request.on('error', reject);
    });
}

async function waitForServer(url, processHandle) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < TIMEOUT_MS) {
        if (processHandle.exitCode !== null) throw new Error(`Server exited with code ${processHandle.exitCode}`);
        try {
            const status = await ping(url);
            if (status >= 200 && status < 500) return;
        } catch (error) {
            // Server is still starting.
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for local server');
}

async function run() {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-inbox-browser-'));
    const messagesFile = path.join(tempDir, 'adminMessages.json');
    const screenshotFile = path.join(os.tmpdir(), 'insider-ai-assets-gallery.png');
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
    const playerId = randomUUID();
    let browser;

    const server = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: {
            ...process.env,
            PORT: String(port),
            MONGO_URL: '',
            ADMIN_MESSAGES_FILE: messagesFile
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverOutput = '';
    server.stdout.on('data', chunk => { serverOutput += String(chunk); });
    server.stderr.on('data', chunk => { serverOutput += String(chunk); });

    try {
        await waitForServer(`${baseUrl}/ping`, server);
        browser = await chromium.launch({ headless: true });

        const unauthenticatedContext = await browser.newContext();
        const blockedPlayerPost = await unauthenticatedContext.request.post(`${baseUrl}/api/admin-messages`, {
            data: { playerId, message: 'ต้องถูกปฏิเสธเพราะยังไม่ได้เปิดหน้าติดต่อ' }
        });
        assert(blockedPlayerPost.status() === 403, 'player message API must require a support-page session');
        const blockedAdminList = await unauthenticatedContext.request.get(`${baseUrl}/admin/api/messages`);
        assert(blockedAdminList.status() === 401, 'admin inbox API must require an admin session');
        await unauthenticatedContext.close();

        const playerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await playerContext.addInitScript(id => {
            localStorage.setItem('insiderGamePlayerId', id);
        }, playerId);
        const playerPage = await playerContext.newPage();
        await playerPage.goto(`${baseUrl}/support?playerId=${playerId}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
        await playerPage.locator('#support-message-input').fill('ห้องทดสอบค้าง ช่วยตรวจให้หน่อยครับ');
        await playerPage.locator('#support-send').click();
        await playerPage.getByText('ส่งถึงกล่องข้อความของแอดมินแล้ว', { exact: true }).waitFor({ timeout: TIMEOUT_MS });
        await playerPage.getByText('ส่งแล้ว ยังไม่ได้อ่าน', { exact: false }).waitFor({ timeout: TIMEOUT_MS });
        assert(await playerPage.locator('#support-fab').isHidden(), 'support shortcut must hide on the support page');

        const adminContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
        const adminPage = await adminContext.newPage();
        await adminPage.goto(`${baseUrl}/admin/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
        await adminPage.locator('input[name="password"]').fill(settings.adminPassword);
        await Promise.all([
            adminPage.waitForURL(url => url.pathname === '/admin', { timeout: TIMEOUT_MS }),
            adminPage.locator('.login-form button[type="submit"]').click()
        ]);
        await adminPage.locator('#adminInboxBadge').waitFor({ state: 'attached', timeout: TIMEOUT_MS });
        await adminPage.waitForFunction(() => document.getElementById('adminInboxBadge')?.textContent.trim() === '1');
        assert(await adminPage.locator('#adminInboxBell').isVisible(), 'admin bell must be visible');
        assert(await adminPage.locator('#support-fab').isHidden(), 'player support shortcut must hide on admin pages');

        await adminPage.locator('.tab-btn[data-tab="messages"]').click();
        const threadButton = adminPage.locator(`.admin-thread-item[data-player-id="${playerId}"]`);
        await threadButton.waitFor({ timeout: TIMEOUT_MS });
        await threadButton.click();
        await adminPage.getByText('ห้องทดสอบค้าง ช่วยตรวจให้หน่อยครับ', { exact: true }).waitFor({ timeout: TIMEOUT_MS });
        await adminPage.locator('#adminReplyInput').fill('รับเรื่องแล้วครับ กำลังตรวจให้');
        await adminPage.locator('#adminReplyButton').click();
        await adminPage.getByText('รับเรื่องแล้วครับ กำลังตรวจให้', { exact: true }).waitFor({ timeout: TIMEOUT_MS });

        await playerPage.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
        await playerPage.getByText('แอดมินอ่านแล้ว', { exact: false }).waitFor({ timeout: TIMEOUT_MS });
        await playerPage.getByText('รับเรื่องแล้วครับ กำลังตรวจให้', { exact: true }).waitFor({ timeout: TIMEOUT_MS });

        const assetContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        const assetPage = await assetContext.newPage();
        const gameDirectories = ['spyfall', 'werewolf', 'blackmarket'];
        const assets = gameDirectories.flatMap(game => {
            const directory = path.join(ROOT, 'public', 'assets', 'games', game);
            return fs.readdirSync(directory)
                .filter(file => file.endsWith('.jpg'))
                .sort()
                .map(file => ({ game, file }));
        });
        const cards = assets.map(asset => `
            <figure><img src="${baseUrl}/assets/games/${asset.game}/${asset.file}" alt="${asset.file}"><figcaption>${asset.game}/${asset.file}</figcaption></figure>
        `).join('');
        await assetPage.setContent(`<!doctype html><style>
            body{margin:0;padding:20px;background:#15131d;color:#eee;font:14px sans-serif}
            h1{margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}
            figure{margin:0;padding:7px;background:#272331;border:1px solid #454052;border-radius:9px}
            img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#09080d}
            figcaption{margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#c9c1d5}
        </style><h1>AI game assets (${assets.length})</h1><div class="grid">${cards}</div>`, { waitUntil: 'load' });
        const brokenAssets = await assetPage.locator('img').evaluateAll(images => images.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.alt));
        assert(brokenAssets.length === 0, `broken AI assets: ${brokenAssets.join(', ')}`);
        await assetPage.screenshot({ path: screenshotFile, fullPage: true });

        assert(fs.existsSync(messagesFile), 'offline inbox JSON was not created');
        console.log('✅ Admin inbox browser flow passed: user send → admin bell/read/reply → user status');
        console.log(`✅ AI asset gallery loaded ${assets.length} JPG files without broken images`);
        console.log(`Gallery screenshot: ${screenshotFile}`);
    } catch (error) {
        throw new Error(`${error.message}\n${serverOutput}`.trim());
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

run().catch(error => {
    console.error('❌ Admin inbox browser smoke failed:', error.message);
    process.exitCode = 1;
});
