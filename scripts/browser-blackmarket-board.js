const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const BROWSER_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');
const STATS_FILE = path.join(__dirname, '..', 'data', 'playerStats.json');

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

function emitAck(socket, eventName, payload, timeoutMs = BROWSER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${eventName}`)), timeoutMs);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function createClient(baseUrl, label) {
    const playerId = randomUUID();
    const socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
        forceNew: true,
        timeout: BROWSER_TIMEOUT_MS,
        autoConnect: false
    });

    return {
        label,
        playerId,
        socket
    };
}

async function connectClient(client) {
    client.socket.connect();
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for connect (${client.label})`)), BROWSER_TIMEOUT_MS);

        function cleanup() {
            clearTimeout(timer);
            client.socket.off('connect', onConnect);
            client.socket.off('connect_error', onError);
        }

        function onConnect() {
            cleanup();
            resolve();
        }

        function onError(error) {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
        }

        client.socket.once('connect', onConnect);
        client.socket.once('connect_error', onError);
    });

    client.socket.emit('initPlayer', client.playerId);
}

async function main() {
    const backup = snapshotFiles([PLAYERS_FILE, STATS_FILE]);
    let server = null;
    let browser = null;
    const clients = [];

    try {
        server = await spawnServer();
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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

        await Promise.all([
            page.waitForURL(/\/room\/[A-Za-z0-9-]+\?playerId=/, { timeout: BROWSER_TIMEOUT_MS }),
            page.click('.swal2-confirm')
        ]);

        const url = new URL(page.url());
        const roomId = url.pathname.split('/').pop();
        assert(roomId, 'room id missing after create room redirect');

        for (let index = 0; index < 3; index += 1) {
            const client = createClient(server.baseUrl, `seat-${index + 2}`);
            await connectClient(client);
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joinResponse && joinResponse.success, `joinRoom failed for ${client.label}`);
            client.socket.emit('setRoom', { roomId, playerId: client.playerId });
            client.socket.emit('requestRoomUpdate', { roomId });
            clients.push(client);
        }

        await page.waitForFunction(() => {
            const count = document.getElementById('lobbyPlayerCount');
            const startButton = document.getElementById('btnStartGameLobby');
            return count && Number(count.textContent || '0') >= 4 && startButton && !startButton.disabled;
        }, null, { timeout: BROWSER_TIMEOUT_MS });

        await page.click('#btnStartGameLobby');
        await page.waitForURL(/\/game\/[A-Za-z0-9-]+\?playerId=/, { timeout: BROWSER_TIMEOUT_MS });
        await page.waitForSelector('.bm-shell', { timeout: BROWSER_TIMEOUT_MS });
        await page.waitForSelector('#guidePanel .bm-guide-step', { timeout: BROWSER_TIMEOUT_MS, state: 'attached' });
        await page.waitForSelector('#bmTourOverlay.active', { timeout: BROWSER_TIMEOUT_MS });

        assert(await page.locator('#bmTourHole').count() === 0, 'spotlight hole element should not render');
        await page.waitForSelector('.bm-tour-focus', { timeout: BROWSER_TIMEOUT_MS });

        const initialTourTitle = await page.locator('#bmTourTitle').textContent();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(previousTitle => {
            const currentTitle = document.getElementById('bmTourTitle')?.textContent?.trim() || '';
            return currentTitle.length > 0 && currentTitle !== previousTitle;
        }, initialTourTitle?.trim() || '', { timeout: BROWSER_TIMEOUT_MS });

        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(previousTitle => {
            const currentTitle = document.getElementById('bmTourTitle')?.textContent?.trim() || '';
            return currentTitle === previousTitle;
        }, initialTourTitle?.trim() || '', { timeout: BROWSER_TIMEOUT_MS });

        const boardMetrics = await page.evaluate(() => ({
            phaseText: document.getElementById('phaseChip')?.textContent?.trim() || '',
            roundText: document.getElementById('roundChip')?.textContent?.trim() || '',
            roleTitle: document.querySelector('.bm-card-role .bm-card-title')?.textContent?.trim() || '',
            guideTitle: document.querySelector('.bm-card-guide .bm-card-title')?.textContent?.trim() || '',
            stageTitle: document.querySelector('.bm-card-stage .bm-card-title')?.textContent?.trim() || '',
            playersTitle: document.querySelector('.bm-card-roster .bm-card-title')?.textContent?.trim() || '',
            announcerTitle: document.querySelector('#bmAnnouncerBar .bm-announcer-title')?.textContent?.trim() || '',
            announcerNoteCount: document.querySelectorAll('#bmAnnouncerBar .bm-announcer-note').length,
            tourTitle: document.getElementById('bmTourTitle')?.textContent?.trim() || '',
            guideSteps: document.querySelectorAll('#guidePanel .bm-guide-step').length,
            topbarTitle: document.querySelector('.bm-title')?.textContent?.trim() || '',
            hasHowToButton: Boolean(document.getElementById('bmHowToOpen')),
            hasPrevButton: Boolean(document.getElementById('bmTourPrev')),
            focusedTourTargetCount: document.querySelectorAll('.bm-tour-focus').length
        }));

        assert(/เปิดตลาด|ลงมือ|ปิดโต๊ะ/.test(boardMetrics.phaseText), `unexpected phase chip text: ${boardMetrics.phaseText}`);
        assert(boardMetrics.guideSteps >= 5, `expected guide steps to render, received ${boardMetrics.guideSteps}`);
        assert(/บทของคุณ/.test(boardMetrics.roleTitle), `missing role panel title: ${boardMetrics.roleTitle}`);
        assert(/พาเล่นโต๊ะนี้/.test(boardMetrics.guideTitle), `missing guide panel title: ${boardMetrics.guideTitle}`);
        assert(/ตลาดมืด|ลงมือ/.test(boardMetrics.stageTitle), `missing phase-specific stage title: ${boardMetrics.stageTitle}`);
        assert(/คนบนโต๊ะ/.test(boardMetrics.playersTitle), `missing players panel title: ${boardMetrics.playersTitle}`);
        assert(/ผู้ดำเนินเกมประกาศ/.test(boardMetrics.announcerTitle), `missing announcer title: ${boardMetrics.announcerTitle}`);
        assert(boardMetrics.announcerNoteCount >= 1, `expected announcer notes, received ${boardMetrics.announcerNoteCount}`);
        assert(boardMetrics.tourTitle.length > 0, 'spotlight tour title did not render');
        assert(boardMetrics.hasHowToButton, 'how to play button did not render');
        assert(boardMetrics.hasPrevButton, 'spotlight previous button did not render');
        assert(boardMetrics.focusedTourTargetCount === 1, `expected exactly one highlighted tour target, received ${boardMetrics.focusedTourTargetCount}`);

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('bmTourOverlay')?.classList.contains('active'), null, { timeout: BROWSER_TIMEOUT_MS });

        await page.click('#bmHowToOpen');
        await page.waitForSelector('#bmHowToOverlay.active', { timeout: BROWSER_TIMEOUT_MS });

        const manualMetrics = await page.evaluate(() => ({
            title: document.getElementById('bmHowToTitle')?.textContent?.trim() || '',
            overviewHeading: document.querySelector('#bmHowToOverview .bm-manual-section h3')?.textContent?.trim() || '',
            roleHeading: document.querySelector('#bmHowToRole .bm-manual-role-name')?.textContent?.trim() || '',
            roleChip: document.querySelector('#bmHowToRole .bm-manual-role-chip')?.textContent?.trim() || '',
            actionCount: document.querySelectorAll('#bmHowToOverview .bm-manual-action').length,
            liveAdviceHeading: document.querySelector('#bmHowToOverview .bm-manual-section:last-child h3')?.textContent?.trim() || '',
            liveAdviceCount: document.querySelectorAll('#bmHowToOverview .bm-manual-state-card').length,
            openingCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(2) .bm-manual-line').length,
            earlyHeading: document.querySelector('#bmHowToRole .bm-manual-section:nth-child(3) h3')?.textContent?.trim() || '',
            midHeading: document.querySelector('#bmHowToRole .bm-manual-section:nth-child(5) h3')?.textContent?.trim() || '',
            endHeading: document.querySelector('#bmHowToRole .bm-manual-section:nth-child(6) h3')?.textContent?.trim() || '',
            partnerHeading: document.querySelector('#bmHowToRole .bm-manual-section:nth-child(7) h3')?.textContent?.trim() || '',
            threatsHeading: document.querySelector('#bmHowToRole .bm-manual-section:nth-child(8) h3')?.textContent?.trim() || '',
            earlyCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(3) .bm-manual-line').length,
            midCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(5) .bm-manual-line').length,
            endCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(6) .bm-manual-line').length,
            partnerCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(7) .bm-manual-line').length,
            threatsCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(8) .bm-manual-line').length,
            warningCount: document.querySelectorAll('#bmHowToRole .bm-manual-section:nth-child(9) .bm-manual-line').length
        }));

        assert(/วิธีเดินเกมคืนนี้/.test(manualMetrics.title), `unexpected manual title: ${manualMetrics.title}`);
        assert(/ภาพรวมทั้งโต๊ะ/.test(manualMetrics.overviewHeading), `missing overview heading: ${manualMetrics.overviewHeading}`);
        assert(/วิธีเล่นของบท/.test(manualMetrics.roleHeading), `missing role guide heading: ${manualMetrics.roleHeading}`);
        assert(manualMetrics.roleChip.length > 0, 'role summary chip did not render in manual');
        assert(manualMetrics.actionCount >= 5, `expected manual action entries, received ${manualMetrics.actionCount}`);
        assert(/สถานะตอนนี้บอกอะไร/.test(manualMetrics.liveAdviceHeading), `missing live advice heading: ${manualMetrics.liveAdviceHeading}`);
        assert(manualMetrics.liveAdviceCount >= 2, `expected live advice cards, received ${manualMetrics.liveAdviceCount}`);
        assert(manualMetrics.openingCount >= 1, `expected role opening guidance, received ${manualMetrics.openingCount}`);
        assert(/ต้นโต๊ะควรเดินยังไง/.test(manualMetrics.earlyHeading), `missing early-game heading: ${manualMetrics.earlyHeading}`);
        assert(/กลางโต๊ะควรเดินยังไง/.test(manualMetrics.midHeading), `missing mid-game heading: ${manualMetrics.midHeading}`);
        assert(/ปิดโต๊ะต้องคิดอะไร/.test(manualMetrics.endHeading), `missing end-game heading: ${manualMetrics.endHeading}`);
        assert(/บทนี้ชอบจับมือกับใคร/.test(manualMetrics.partnerHeading), `missing partner heading: ${manualMetrics.partnerHeading}`);
        assert(/ใครควรระวังเป็นพิเศษ/.test(manualMetrics.threatsHeading), `missing threats heading: ${manualMetrics.threatsHeading}`);
        assert(manualMetrics.earlyCount >= 1, `expected early-game guidance, received ${manualMetrics.earlyCount}`);
        assert(manualMetrics.midCount >= 1, `expected mid-game guidance, received ${manualMetrics.midCount}`);
        assert(manualMetrics.endCount >= 1, `expected end-game guidance, received ${manualMetrics.endCount}`);
        assert(manualMetrics.partnerCount >= 1, `expected partner guidance, received ${manualMetrics.partnerCount}`);
        assert(manualMetrics.threatsCount >= 1, `expected threat guidance, received ${manualMetrics.threatsCount}`);
        assert(manualMetrics.warningCount >= 1, `expected role warning guidance, received ${manualMetrics.warningCount}`);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(150);

        const mobileMetrics = await page.evaluate(() => {
            const bodyOverflow = document.documentElement.scrollWidth - window.innerWidth;
            const card = document.getElementById('bmHowToCard');
            const shell = document.querySelector('.bm-shell');
            const topMeta = document.querySelector('.bm-top-meta');
            const manualGrid = document.querySelector('.bm-manual-grid');
            return {
                bodyOverflow,
                cardOverflow: card ? Math.max(0, Math.ceil(card.getBoundingClientRect().right - window.innerWidth)) : 0,
                shellOverflow: shell ? Math.max(0, Math.ceil(shell.getBoundingClientRect().right - window.innerWidth)) : 0,
                topMetaOverflow: topMeta ? Math.max(0, Math.ceil(topMeta.scrollWidth - topMeta.clientWidth)) : 0,
                manualGridOverflow: manualGrid ? Math.max(0, Math.ceil(manualGrid.scrollWidth - manualGrid.clientWidth)) : 0,
                topMetaChipCount: document.querySelectorAll('.bm-top-meta .bm-chip').length,
                liveAdviceCards: document.querySelectorAll('#bmHowToOverview .bm-manual-state-card').length
            };
        });

        assert(mobileMetrics.bodyOverflow <= 1, `document overflowed mobile viewport by ${mobileMetrics.bodyOverflow}px`);
        assert(mobileMetrics.cardOverflow <= 1, `manual card overflowed mobile viewport by ${mobileMetrics.cardOverflow}px`);
        assert(mobileMetrics.shellOverflow <= 1, `board shell overflowed mobile viewport by ${mobileMetrics.shellOverflow}px`);
        assert(mobileMetrics.topMetaOverflow <= 1, `top meta overflowed mobile viewport by ${mobileMetrics.topMetaOverflow}px`);
        assert(mobileMetrics.manualGridOverflow <= 1, `manual grid overflowed mobile viewport by ${mobileMetrics.manualGridOverflow}px`);
        assert(mobileMetrics.topMetaChipCount >= 5, `expected top meta chips on mobile, received ${mobileMetrics.topMetaChipCount}`);
        assert(mobileMetrics.liveAdviceCards >= 2, `expected live advice cards on mobile, received ${mobileMetrics.liveAdviceCards}`);

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('bmHowToOverlay')?.classList.contains('active'), null, { timeout: BROWSER_TIMEOUT_MS });

        console.log('BROWSER_RESULT ' + JSON.stringify({
            roomId,
            url: page.url(),
            phaseText: boardMetrics.phaseText,
            roundText: boardMetrics.roundText,
            guideSteps: boardMetrics.guideSteps,
            tourTitle: boardMetrics.tourTitle,
            boardTitle: boardMetrics.topbarTitle,
            manualTitle: manualMetrics.title,
            roleHeading: manualMetrics.roleHeading
        }));
    } finally {
        clients.forEach(client => {
            if (client.socket && client.socket.connected) {
                client.socket.disconnect();
            }
        });

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
