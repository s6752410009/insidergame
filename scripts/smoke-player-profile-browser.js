#!/usr/bin/env node
/* Actual public-profile clicks from the home leaderboard and room lobby against a local app. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const ROOT = process.env.PROFILE_APP_ROOT || path.join(__dirname, '..');
const appRequire = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = appRequire('playwright');
const { io } = appRequire('socket.io-client');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-browser-data-'));
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-browser-shots-'));
const ids = Array.from({ length: 4 }, () => randomUUID());
const targetId = ids[0], viewerId = ids[3];
const sockets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0, base, child, browser, logs = '';
function check(value, message) { if (!value) throw new Error(message); checks += 1; }
async function wait(predicate, message, timeout = 30000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await predicate()) return; await delay(50); }
    throw new Error('Timeout: ' + message + '\n' + logs.slice(-1500));
}
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
function seed() {
    const date = new Date().toISOString();
    const players = Object.fromEntries(ids.map((id, index) => [id, { playerId: id, playerName: index === 0 ? 'ผู้เล่นคิงและควีน' : 'เพื่อนทดสอบ ' + index, color: '#3498db', avatar: index === 0 ? '👑' : '🙂', avatarFrame: index === 0 ? 'gold' : 'none', approved: true, createdAt: date, lastSeen: date }]));
    const history = [
        { mode: 'slave', resultId: 'profile-fixture-queen', gameId: 'profile-fixture', date, startedAt: date, endedAt: date, roomName: 'สลาฟกับเพื่อน', roomId: 'profile-fixture', round: 2, place: 2, title: 'ควีน', role: 'ควีน', playerCount: 4, won: false, winnerName: 'เพื่อน', resultText: 'รอบ 2 · อันดับ 2/4 · ควีน' },
        { mode: 'slave', resultId: 'profile-fixture-king', gameId: 'profile-fixture', date, startedAt: date, endedAt: date, roomName: 'สลาฟกับเพื่อน', roomId: 'profile-fixture', round: 1, place: 1, title: 'คิง', role: 'คิง', playerCount: 4, won: true, winnerName: players[targetId].playerName, resultText: 'รอบ 1 · อันดับ 1/4 · คิง' },
        { mode: 'coup', date, roomName: 'Coup กับเพื่อน', playerCount: 4, role: 'ผู้เล่น', won: true, winnerName: players[targetId].playerName, resultText: 'ชนะเกม Coup' }
    ];
    const stats = { [targetId]: { playerId: targetId, playerName: players[targetId].playerName, totalGames: 3, wins: 2, losses: 1, lastPlayedAt: date, modeStats: { slave: { games: 2, wins: 1, losses: 1 }, coup: { games: 1, wins: 1, losses: 0 } }, gameHistory: history } };
    for (const [file, data] of Object.entries({ 'players.json': players, 'playerStats.json': stats, 'rooms.json': {}, 'bannedPlayers.json': {} })) fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data));
}
async function boot() {
    base = 'http://127.0.0.1:' + await freePort();
    child = spawn(process.execPath, [path.join(ROOT, 'app.js')], { cwd: ROOT, env: { ...process.env, PORT: new URL(base).port, GAME_DATA_DIR: DATA_DIR, MONGO_URL: '', NODE_ENV: 'test', APP_ENV: 'staging', ALLOW_LEGACY_SOCKET_IDENTITY: '1', INSIDER_DEV_FAST: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    await wait(() => logs.includes('Server started on port ' + new URL(base).port), 'local server starts');
}
const ack = (socket, event, data) => new Promise((resolve, reject) => socket.timeout(10000).emit(event, data, (err, response) => err ? reject(err) : resolve(response)));
async function room() {
    for (const id of ids) {
        const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(socket);
        await wait(() => socket.connected, 'four local sockets connect');
        socket.emit('initPlayer', id);
        await delay(75);
    }
    const created = await ack(sockets[0], 'createRoom', { playerId: targetId, name: 'ห้องทดสอบโปรไฟล์', gameMode: 'slave', maxPlayers: 4 });
    check(created.success && created.roomId, 'real host creates local room');
    for (let index = 0; index < ids.length; index += 1) {
        if (index) check((await ack(sockets[index], 'joinRoom', { roomId: created.roomId, playerId: ids[index] })).success, 'real friend joins room ' + index);
        sockets[index].emit('setRoom', { roomId: created.roomId, playerId: ids[index] });
    }
    return created.roomId;
}
async function assertModal(page, tag, responses) {
    await page.locator('.swal2-popup.pp-popup .pp-public').waitFor({ state: 'visible' });
    await page.waitForFunction(() => { const popup = document.querySelector('.pp-popup'); return popup && popup.getAnimations().every(animation => animation.playState === 'finished'); });
    check(await page.locator('.pp-header h2').innerText() === 'ผู้เล่นคิงและควีน', tag + ': click opens the other player');
    const modes = await page.locator('[data-profile-mode]').evaluateAll(els => els.map(el => el.dataset.profileMode).sort());
    check(modes.join(',') === 'coup,slave', tag + ': only the two played game modes appear');
    check(await page.locator('[data-profile-mode="slave"]').innerText().then(text => text.includes('2 รอบ') && text.includes('คิง 1')), tag + ': Slave rounds and king count render from API');
    check(await page.locator('.pp-game').count() === 3, tag + ': all completed fixture history entries render');
    const results = await page.locator('.pp-history').innerText();
    check(results.includes('อันดับ 1/4') && results.includes('คิง') && results.includes('อันดับ 2/4') && results.includes('ควีน') && results.includes('Coup'), tag + ': king and queen place details and other game history visible');
    check(await page.locator('.pp-roles').count() === 0, tag + ': irrelevant empty Insider role stats absent');
    check(responses.some(item => item.status === 200 && item.url.endsWith('/api/player/' + targetId + '/profile')), tag + ': modal actually fetched public profile from local server');
    const overflow = await page.locator('.pp-public').evaluate(el => ({ content: el.scrollWidth > el.clientWidth + 1, popup: el.closest('.swal2-popup').getBoundingClientRect().right > innerWidth + 1 }));
    check(!overflow.content && !overflow.popup, tag + ': actual SweetAlert modal stays within viewport');
    check(await page.locator('.pp-header').evaluate(el => getComputedStyle(el).backgroundImage === 'none' && el.getBoundingClientRect().height < 120), tag + ': profile heading does not inherit the site-logo banner styles');
    await page.screenshot({ path: path.join(SHOTS, tag + '.png'), fullPage: false, animations: 'disabled' });
    await page.getByRole('button', { name: 'ปิด', exact: true }).click();
    await page.locator('.pp-popup').waitFor({ state: 'hidden' });
}
async function main() {
    seed();
    await boot();
    const roomId = await room();
    browser = await chromium.launch({ headless: true });
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [], responses = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.url().includes('/api/player/')) responses.push({ url: response.url(), status: response.status() }); });
        await page.goto(`${base}/?playerId=${viewerId}`, { waitUntil: 'domcontentloaded' });
        await page.locator(`#leaderboardList .leaderboard-item[data-player-id="${targetId}"]`).waitFor();
        // Dismiss the real introductory announcement if shown; profile controls are not mocked.
        const intro = page.locator('.swal2-popup:not(.pp-popup) .swal2-confirm');
        if (await intro.isVisible()) await intro.click();
        await page.locator(`#leaderboardList .leaderboard-item[data-player-id="${targetId}"]`).click();
        await assertModal(page, 'home-' + viewport.width, responses);
        check(await page.locator('#leaderboardModes button[data-mode="slave"]').count() === 1, 'home-' + viewport.width + ': real leaderboard exposes Slave filter');
        await page.goto(`${base}/room/${roomId}?playerId=${viewerId}`, { waitUntil: 'domcontentloaded' });
        await page.locator(`.lobby-player-avatar.clickable-avatar[data-player-id="${targetId}"]`).waitFor();
        await page.locator(`.lobby-player-avatar.clickable-avatar[data-player-id="${targetId}"]`).click();
        await assertModal(page, 'room-' + viewport.width, responses);
        check(errors.length === 0, viewport.width + ': home and lobby have no page JavaScript errors: ' + errors.join(' | '));
        await context.close();
    }
    console.log(JSON.stringify({ ok: true, checks, screenshots: SHOTS, viewports: [390, 1440], entrypoints: ['home leaderboard', 'room lobby'], realServer: true, isolatedData: true }));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
    if (browser) await browser.close();
    for (const socket of sockets) socket.disconnect();
    if (child && child.exitCode === null) await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
