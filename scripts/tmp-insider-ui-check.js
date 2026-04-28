const http = require('http');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function once(socket, eventName, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeout);
        socket.once(eventName, payload => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

function emitAck(socket, eventName, payload, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${eventName}`)), timeout);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(() => resolve(address.port));
        });
    });
}

async function waitForHttpReady(url, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const status = await new Promise((resolve, reject) => {
                const req = http.get(url, res => {
                    res.resume();
                    resolve(res.statusCode || 0);
                });
                req.on('error', reject);
            });

            if (status >= 200 && status < 500) {
                return;
            }
        } catch (error) {
            // keep polling
        }
        await delay(250);
    }

    throw new Error(`Server not ready at ${url}`);
}

async function traceRedirects(url, maxHops = 5) {
    const hops = [];
    let currentUrl = url;

    for (let index = 0; index < maxHops; index += 1) {
        const result = await new Promise((resolve, reject) => {
            const req = http.get(currentUrl, res => {
                res.resume();
                resolve({
                    url: currentUrl,
                    statusCode: res.statusCode || 0,
                    location: res.headers.location || null
                });
            });
            req.on('error', reject);
        });

        hops.push(result);

        if (!result.location || result.statusCode < 300 || result.statusCode >= 400) {
            break;
        }

        currentUrl = new URL(result.location, currentUrl).toString();
    }

    return hops;
}

async function spawnServer() {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(process.cwd(), 'app.js')], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
        stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
        stderr += String(chunk);
    });

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Startup timeout\n${stdout}\n${stderr}`)), 30000);
        child.stdout.on('data', chunk => {
            if (String(chunk).includes(`Server started on port ${port}`)) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.once('exit', code => reject(new Error(`Server exited with code ${code}\n${stdout}\n${stderr}`)));
    });

    await waitForHttpReady(`http://127.0.0.1:${port}`);
    return {
        child,
        baseUrl: `http://127.0.0.1:${port}`
    };
}

async function createClient(baseUrl, label) {
    const playerId = randomUUID();
    const socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        forceNew: true,
        reconnection: false,
        timeout: 30000
    });

    await once(socket, 'connect');
    socket.emit('initPlayer', playerId);

    return {
        label,
        playerId,
        socket,
        lastRole: null
    };
}

async function main() {
    const server = await spawnServer();
    const clients = [];
    let browser;

    try {
        for (let index = 0; index < 8; index += 1) {
            const client = await createClient(server.baseUrl, `p${index + 1}`);
            client.socket.on('newRole', payload => {
                client.lastRole = payload;
            });
            clients.push(client);
        }

        const [creator, ...others] = clients;
        const createResponse = await emitAck(creator.socket, 'createRoom', {
            playerId: creator.playerId,
            name: `Insider UI Check ${Date.now()}`,
            gameMode: 'insider',
            maxPlayers: 9,
            roundTime: 1
        }, 30000);

        if (!createResponse?.success || !createResponse.roomId) {
            throw new Error(`createRoom failed: ${JSON.stringify(createResponse)}`);
        }

        const roomId = createResponse.roomId;

        for (const client of clients) {
            client.socket.emit('setRoom', { roomId, playerId: client.playerId });
        }

        for (const client of others) {
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId }, 30000);
            if (!joinResponse?.success) {
                throw new Error(`joinRoom failed for ${client.label}: ${JSON.stringify(joinResponse)}`);
            }
            client.socket.emit('setRoom', { roomId, playerId: client.playerId });
        }

        const startResponse = await emitAck(creator.socket, 'startGameFromLobby', { roomId }, 40000);
        if (!startResponse?.success) {
            throw new Error(`startGameFromLobby failed: ${JSON.stringify(startResponse)}`);
        }

        await delay(4500);

        const viewerClient = clients[clients.length - 1];
        viewerClient.socket.disconnect();
        await delay(800);

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2
        });

        const targetGameUrl = `${server.baseUrl}/game/${roomId}?playerId=${viewerClient.playerId}`;
        const redirectTrace = await traceRedirects(targetGameUrl);
        console.log('[debug] redirect trace:', JSON.stringify(redirectTrace));

        await page.goto(targetGameUrl, { waitUntil: 'networkidle' });
        console.log('[debug] game page url after goto:', page.url());
        try {
            await page.waitForSelector('.insider-shell', { timeout: 20000 });
        } catch (error) {
            const debugPath = path.join(process.cwd(), 'screenshots', 'insider-board-debug.png');
            await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
            const bodyText = await page.locator('body').innerText().catch(() => '');
            console.log('[debug] body preview:', bodyText.slice(0, 600));
            console.log('[debug] debug screenshot:', debugPath);
            throw error;
        }
        await page.waitForTimeout(1800);

        const gmClient = clients.find(client => client.lastRole?.role === 'ผู้ดำเนินเกม');
        if (!gmClient) {
            throw new Error('No GM client found after startGameFromLobby');
        }

        const setWordResponse = await emitAck(gmClient.socket, 'setWord', { word: 'พยาบาล' }, 30000);
        if (!setWordResponse?.ok) {
            throw new Error(`setWord failed: ${JSON.stringify(setWordResponse)}`);
        }

        gmClient.socket.emit('revealWord');
        await page.waitForTimeout(1500);
        creator.socket.emit('startGame');
        await page.waitForTimeout(1500);
        creator.socket.emit('wordFound');
        await page.waitForSelector('#vote2:not(.hidden), #vote2.current, .vote2-container', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2600);

        const mobilePath = path.join(process.cwd(), 'screenshots', 'insider-board-mobile-check.png');
        const desktopPath = path.join(process.cwd(), 'screenshots', 'insider-board-desktop-check.png');
        await page.screenshot({ path: mobilePath, fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: desktopPath, fullPage: true });

        console.log(JSON.stringify({
            roomId,
            viewerPlayerId: viewerClient.playerId,
            finalUrl: page.url(),
            screenshots: [mobilePath, desktopPath]
        }, null, 2));
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }

        await Promise.all(clients.map(async client => {
            client.socket.disconnect();
        }));

        server.child.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
});