const { DATA_DIR: TEST_DATA_DIR } = require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const BROWSER_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const PLAYERS_FILE = path.join(TEST_DATA_DIR || path.join(__dirname, '..', 'data'), 'players.json');
const STATS_FILE = path.join(TEST_DATA_DIR || path.join(__dirname, '..', 'data'), 'playerStats.json');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function request(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            res.resume();
            resolve(res.statusCode || 0);
        });

        req.on('error', reject);
    });
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = require('net').createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForHttpReady(baseUrl, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const status = await request(baseUrl);
            if (status >= 200 && status < 500) {
                return;
            }
        } catch (error) {
            await delay(250);
            continue;
        }

        await delay(250);
    }

    throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function spawnServer() {
    const port = await getFreePort();
    const appPath = path.join(__dirname, '..', 'app.js');
    const child = spawn(process.execPath, [appPath], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const startedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for app startup log on port ${port}`));
        }, SERVER_TIMEOUT_MS);

        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`App exited before startup completed with code ${code}`));
        });

        child.stdout.on('data', chunk => {
            const text = String(chunk);
            stdout += text;
            if (text.includes(`Server started on port ${port}`)) {
                clearTimeout(timer);
                resolve();
            }
        });
    });

    child.stderr.on('data', chunk => {
        stderr += String(chunk);
    });

    try {
        await startedPromise;
        await waitForHttpReady(`http://127.0.0.1:${port}`, SERVER_TIMEOUT_MS);
    } catch (error) {
        child.kill('SIGTERM');
        throw new Error(`${error.message}\n${stdout}\n${stderr}`.trim());
    }

    return {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        child
    };
}

function snapshotFiles(filePaths) {
    return filePaths.map(filePath => ({
        filePath,
        exists: fs.existsSync(filePath),
        content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
    }));
}

function restoreFiles(snapshot) {
    snapshot.forEach(entry => {
        if (entry.exists) {
            fs.writeFileSync(entry.filePath, entry.content, 'utf8');
            return;
        }

        if (fs.existsSync(entry.filePath)) {
            fs.unlinkSync(entry.filePath);
        }
    });
}

async function stopServer(server) {
    if (!server || !server.child) {
        return;
    }

    await new Promise(resolve => {
        server.child.once('exit', () => resolve());
        server.child.kill('SIGTERM');
        setTimeout(() => resolve(), 4000);
    });
}

async function main() {
    const backup = snapshotFiles([PLAYERS_FILE, STATS_FILE]);
    let server = null;
    let browser = null;

    try {
        server = await spawnServer();
        browser = await chromium.launch({ headless: true });

        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        const playerId = randomUUID();

        await page.goto(`${server.baseUrl}/rooms?playerId=${encodeURIComponent(playerId)}`, {
            waitUntil: 'networkidle',
            timeout: BROWSER_TIMEOUT_MS
        });

        await page.click('#createRoomBtn');
        await page.waitForSelector('.swal2-popup #modeQuickPickGrid', { timeout: BROWSER_TIMEOUT_MS });
        await page.click('.swal2-popup .mode-quick-card[data-mode-id="blackmarket"]');

        await page.waitForFunction(() => {
            const modeInput = document.getElementById('selectedGameMode');
            return modeInput && modeInput.value === 'blackmarket';
        }, null, { timeout: BROWSER_TIMEOUT_MS });

        const roomNameValue = await page.$eval('#roomName', input => input.value);
        assert(roomNameValue === 'ตลาดมืดคืนนี้', 'blackmarket quick pick did not apply expected room name preset');

        await Promise.all([
            page.waitForURL(/\/room\/[A-Za-z0-9-]+\?playerId=/, { timeout: BROWSER_TIMEOUT_MS }),
            page.click('.swal2-confirm')
        ]);

        await page.waitForSelector('#roomGameModeBadge', { timeout: BROWSER_TIMEOUT_MS });
        await page.waitForFunction(() => {
            const badge = document.getElementById('roomGameModeBadge');
            return badge && badge.dataset.gameMode === 'blackmarket' && /Black Market/i.test(badge.textContent || '');
        }, null, { timeout: BROWSER_TIMEOUT_MS });

        await page.waitForFunction(() => {
            const button = document.getElementById('btnStartGameLobby');
            return button && /เปิดตลาดมืด/.test(button.textContent || '');
        }, null, { timeout: BROWSER_TIMEOUT_MS });

        const badgeText = await page.$eval('#roomGameModeBadge', element => element.textContent.trim());
        const badgeMode = await page.$eval('#roomGameModeBadge', element => element.dataset.gameMode || '');
        const startMetrics = await page.$eval('#btnStartGameLobby', element => ({
            text: element.textContent.trim(),
            width: Math.round(element.getBoundingClientRect().width),
            display: getComputedStyle(element).display,
            overflowOkay: element.scrollWidth <= element.clientWidth + 2
        }));
        const editMetrics = await page.$eval('#btnEditRoom', element => ({
            text: element.textContent.trim(),
            width: Math.round(element.getBoundingClientRect().width),
            parentWidth: Math.round(element.parentElement.getBoundingClientRect().width)
        }));

        assert(badgeMode === 'blackmarket', `expected lobby badge game mode blackmarket, received ${badgeMode}`);
        assert(/Black Market/i.test(badgeText), `expected Black Market badge text, received ${badgeText}`);
        assert(startMetrics.display !== 'none', 'start game lobby button is hidden for room admin');
        assert(startMetrics.width >= 140 && startMetrics.width <= 240, `unexpected start button width ${startMetrics.width}`);
        assert(startMetrics.overflowOkay, 'start button text is overflowing its box');
        assert(editMetrics.width > 0 && editMetrics.width <= editMetrics.parentWidth + 2, 'edit room button overflowed its admin panel width');

        console.log('BROWSER_RESULT ' + JSON.stringify({
            badgeText,
            badgeMode,
            startButtonText: startMetrics.text,
            startButtonWidth: startMetrics.width,
            editButtonWidth: editMetrics.width,
            roomName: roomNameValue,
            url: page.url()
        }));
    } finally {
        if (browser) {
            await browser.close();
        }

        await stopServer(server);
        restoreFiles(backup);
    }
}

main().catch(error => {
    console.error('BROWSER_FATAL', error.stack || error.message);
    process.exitCode = 1;
});