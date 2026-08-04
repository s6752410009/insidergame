require('./isolateTestData');
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const DATA_FILES = [
    path.join(ROOT, 'data', 'players.json'),
    path.join(ROOT, 'data', 'playerStats.json')
];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function snapshotDataFiles() {
    return DATA_FILES.map(filePath => ({
        filePath,
        exists: fs.existsSync(filePath),
        content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
    }));
}

function restoreDataFiles(snapshot) {
    snapshot.forEach(entry => {
        if (entry.exists) fs.writeFileSync(entry.filePath, entry.content);
        else if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
    });
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
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
        request.once('error', reject);
    });
}

async function spawnServer(extraEnv = {}) {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: {
            ...process.env,
            PORT: String(port),
            ALLOW_LEGACY_SOCKET_IDENTITY: '1',
            ...extraEnv
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (child.exitCode != null) throw new Error(`server exited early\n${output}`);
        try {
            const status = await ping(baseUrl);
            if (status >= 200 && status < 500) return { child, baseUrl, output: () => output };
        } catch (error) {
            // Server is still starting.
        }
        await delay(200);
    }
    child.kill('SIGTERM');
    throw new Error(`server startup timeout\n${output}`);
}

async function stopServer(server) {
    if (!server?.child || server.child.exitCode != null) return;
    await new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        server.child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
        server.child.kill('SIGTERM');
    });
}

function createClient(baseUrl, label, stateEvent) {
    const client = {
        label,
        playerId: randomUUID(),
        states: [],
        socket: io(baseUrl, {
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
            autoConnect: false,
            timeout: 20000
        })
    };
    client.socket.on(stateEvent, state => client.states.push(state));
    return client;
}

function once(socket, eventName, predicate = null, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(eventName, handler);
            reject(new Error(`timeout waiting for ${eventName}`));
        }, timeoutMs);
        function handler(payload) {
            if (predicate && !predicate(payload)) return;
            clearTimeout(timer);
            socket.off(eventName, handler);
            resolve(payload);
        }
        socket.on(eventName, handler);
    });
}

async function connectClient(client) {
    const connected = once(client.socket, 'connect', null, 20000);
    client.socket.connect();
    await connected;
    client.socket.emit('initPlayer', client.playerId);
}

function emitAck(socket, eventName, payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting ack for ${eventName}`)), timeoutMs);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function bindRoom(client, roomId, requestEvent) {
    client.socket.emit('setRoom', { roomId, playerId: client.playerId });
    client.socket.emit(requestEvent, { roomId, playerId: client.playerId });
}

async function waitState(client, roomId, predicate, timeoutMs = 30000) {
    const existing = [...client.states].reverse().find(state => state?.roomId === roomId && predicate(state));
    if (existing) return existing;
    return once(client.socket, client.stateEvent, state => state?.roomId === roomId && predicate(state), timeoutMs);
}

function attachStateEvent(client, stateEvent) {
    client.stateEvent = stateEvent;
    return client;
}

function createArtifactDir(game) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `insider-${game}-mobile-e2e-`));
}

async function createMobilePage(browser, baseUrl, roomId, client, rootSelector) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error.message || error)));
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`${baseUrl}/game/${roomId}?playerId=${encodeURIComponent(client.playerId)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await page.waitForSelector(rootSelector, { timeout: 30000 });
    return { context, page, errors, client };
}

async function assertMobileLayout(page, label) {
    const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth
    }));
    assert(metrics.documentWidth <= metrics.viewportWidth + 2, `${label}: document overflows horizontally (${metrics.documentWidth}/${metrics.viewportWidth})`);
    assert(metrics.bodyWidth <= metrics.viewportWidth + 2, `${label}: body overflows horizontally (${metrics.bodyWidth}/${metrics.viewportWidth})`);
}

async function screenshotPhase(sessions, game, phase, artifactDir) {
    const files = [];
    for (const session of sessions) {
        await assertMobileLayout(session.page, `${game}/${phase}/${session.client.label}`);
        const fileName = `${phase}-${session.client.label}.png`;
        const filePath = path.join(artifactDir, fileName);
        await session.page.screenshot({ path: filePath, fullPage: true });
        files.push(filePath);
    }
    return files;
}

async function closeSessions(sessions) {
    await Promise.all(sessions.map(session => session.context.close().catch(() => {})));
}

module.exports = {
    assert,
    attachStateEvent,
    bindRoom,
    closeSessions,
    connectClient,
    createArtifactDir,
    createClient,
    createMobilePage,
    delay,
    emitAck,
    restoreDataFiles,
    screenshotPhase,
    snapshotDataFiles,
    spawnServer,
    stopServer,
    waitState
};
