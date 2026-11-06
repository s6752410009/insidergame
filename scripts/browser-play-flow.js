/** เส้นทางเล่นแบบอ่านน้อย: หน้าแรก → สร้างห้อง → ห้องรอ → กระดานทุกโหมด
 * ใช้ข้อมูลชั่วคราวและ MongoDB ปิดเสมอ ไม่แตะ production
 * รัน: node scripts/browser-play-flow.js (ใช้ Chrome หรือ PLAYWRIGHT_CHANNEL)
 */
require('./isolateTestData');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const { getAvailableGameModes } = require('../games/engineRegistry');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const artifacts = require('./testArtifacts')('play-flow');

async function boot() {
    const port = await new Promise(resolve => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', () => {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
    const server = spawn(process.execPath, ['app.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { server.kill(); reject(new Error('Server startup: ' + logs.slice(-1000))); }, 30000);
        server.stdout.on('data', data => {
            logs += data;
            if (logs.includes(`Server started on port ${port}`)) { clearTimeout(timeout); resolve(); }
        });
        server.stderr.on('data', data => { logs += data; });
        server.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exited ' + code)); });
    });
    return { server, base: `http://127.0.0.1:${port}` };
}
function ack(socket, event, payload) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ack timeout: ' + event)), 10000);
        socket.emit(event, payload, result => { clearTimeout(timer); resolve(result); });
    });
}
async function guest(base, roomId) {
    const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const playerId = randomUUID();
    socket.emit('initPlayer', playerId);
    const joined = await ack(socket, 'joinRoom', { roomId, playerId });
    if (!joined?.success) { socket.disconnect(); throw new Error('Join: ' + JSON.stringify(joined)); }
    socket.emit('setRoom', { roomId, playerId });
    return socket;
}
async function pageAck(page, event, payload) {
    return page.evaluate(({ event, payload }) => new Promise(resolve => window.appSocket.emit(event, payload, resolve)), { event, payload });
}
async function noOverflow(page, label) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': horizontal overflow');
}
async function main() {
    const { server, base } = await boot();
    let browser;
    const sockets = [];
    const errors = [];
    try {
        browser = await chromium.launch(require('./browserOptions')());
        const home = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await home.newPage();
        page.on('pageerror', e => errors.push('home: ' + e.message));
        await page.goto(base, { waitUntil: 'networkidle' });
        await delay(1500);
        assert.equal(await page.locator('.swal2-container,.promo-overlay').count(), 0, 'Fresh home should be ready to play without dismissing popups');
        assert.equal(await page.locator('.home-picker,.home-game,.home-catalog').count(), 0, 'Home has no game catalog');
        assert.equal(await page.locator('.home-play').textContent(), '🎮 เริ่มเกม');
        assert.equal(new URL(await page.locator('.home-play').getAttribute('href'), base).pathname, '/rooms');
        assert.equal(new URL(await page.locator('.home-solo').getAttribute('href'), base).pathname, '/solo');
        assert(await page.locator('.home-nav a[href^="/profile"]').isVisible());
        assert(await page.locator('.home-nav a[href^="/settings"]').isVisible());
        const desktop = await page.evaluate(() => ({ side: document.querySelector('.home-side').getBoundingClientRect().toJSON(), board: document.querySelector('.home-board').getBoundingClientRect().toJSON() }));
        assert(desktop.board.left > desktop.side.right && Math.abs(desktop.board.top - desktop.side.top) < 4, 'Leaderboard beside profile at the top');
        await noOverflow(page, 'home desktop');
        await page.screenshot({ path: path.join(artifacts, 'home-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await noOverflow(page, 'home mobile');
        assert(await page.locator('.home-tally').isVisible(), 'Player stats visible on mobile');
        assert(await page.locator('.home-board').evaluate(el => el.getBoundingClientRect().top > document.querySelector('.home-side').getBoundingClientRect().bottom), 'Leaderboard below profile on mobile');
        await page.screenshot({ path: path.join(artifacts, 'home-mobile.png') });
        await page.locator('#homeUpdates').click();
        await page.waitForSelector('.patch-notes-popup');
        await page.locator('.swal2-confirm').click();
        await home.close();
        console.log('PASS home: classic profile/start/settings + leaderboard, no catalog, mobile stats, updates on demand');

        const modes = getAvailableGameModes().filter(mode => !process.env.PLAY_FLOW_MODES || process.env.PLAY_FLOW_MODES.split(',').includes(mode.id));
        for (const mode of modes) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
            const page = await context.newPage();
            page.on('pageerror', e => errors.push(mode.id + ': ' + e.message));
            const id = randomUUID();
            await page.goto(`${base}/rooms?playerId=${id}&mode=${mode.id}`, { waitUntil: 'networkidle' });
            await page.waitForSelector('#roomSetupStep:not([hidden])');
            assert.equal(await page.locator('#selectedGameMode').inputValue(), mode.id);
            assert.equal(await page.locator('#roomCustomSettings').getAttribute('open'), null, mode.id + ': optional settings closed');
            await noOverflow(page, mode.id + ' create');
            if (mode.id === 'slave') await page.screenshot({ path: path.join(artifacts, 'create-mobile.png') });
            // Optional settings remain editable; creating with defaults needs no field input.
            await page.locator('#roomCustomSettings > summary').click();
            assert(await page.locator('#roomName').isVisible(), 'Name remains editable');
            assert(await page.locator('#maxPlayers').isVisible(), 'Capacity remains editable');
            await page.locator('#roomCustomSettings > summary').click();
            await page.locator('.swal2-confirm').click();
            await page.waitForURL(/\/room\//);
            const roomId = new URL(page.url()).pathname.split('/').pop();
            await page.waitForFunction(() => /รออีก/.test(document.getElementById('lobbyStatusText').textContent));
            assert(await page.locator('#btnStartGameLobby').isDisabled(), mode.id + ': cannot start without enough players');
            assert(await page.locator('#lobbyStatusText').textContent().then(t => t.includes(String(mode.minPlayers - 1))), mode.id + ': exact missing player count');
            assert.equal(await page.locator('#lobbySettings').getAttribute('open') !== null, mode.id === 'codenames', mode.id + ': team assignment visible when needed');
            await page.locator('#btnCopyRoomLink').click();
            await page.waitForFunction(() => document.getElementById('btnCopyRoomLink').textContent.includes('คัดลอกลิงก์แล้ว'));
            const link = await page.evaluate(() => navigator.clipboard.readText());
            assert.equal(new URL(link).searchParams.get('join'), roomId);
            assert.equal(new URL(link).searchParams.has('playerId'), false, 'Invite does not share identity');
            assert(await page.locator('#btnStartGameLobby').evaluate(el => el.getBoundingClientRect().top < innerHeight - 80), mode.id + ': start visible above the footer');
            await noOverflow(page, mode.id + ' lobby');
            if (mode.id === 'slave') await page.screenshot({ path: path.join(artifacts, 'lobby-mobile.png') });
            const count = Math.max(mode.minPlayers, Math.min(4, mode.maxPlayers));
            for (let i = 1; i < count; i++) sockets.push(await guest(base, roomId));
            if (mode.id === 'codenames') assert((await pageAck(page, 'codenames_shuffleTeams', {})).success);
            await page.waitForFunction(() => !document.getElementById('btnStartGameLobby').disabled);
            await page.locator('#btnStartGameLobby').click();
            await page.waitForURL(/\/game\//, { timeout: 15000 });
            await page.waitForLoadState('networkidle');
            await delay(900);
            assert.equal(await page.locator('#ppFirstPlay,#ppTermsBar,.promo-overlay,#bmTourOverlay.active').count(), 0, mode.id + ': no unsolicited instructions on the board');
            if (mode.id === 'blackmarket') {
                assert.equal(await page.locator('#bmCeremonyOverlay.active').count(), 0, 'No tutorial between choosing phases');
                await page.locator('.bm-table-menu > summary').click();
                await page.locator('#bmHowToOpen').click();
                await page.waitForSelector('#bmHowToOverlay.active');
                await page.locator('#bmTourReplay').click();
                await page.waitForSelector('#bmTourOverlay.active');
                assert.equal(await page.locator('#bmHowToOverlay.active').count(), 0, 'Manual and tour do not stack');
                await page.locator('#bmTourSkip').click();
                assert(await page.locator('.bm-card-stage').evaluate(el => el.getBoundingClientRect().top < innerHeight - 220), 'Market actions are visible without scrolling through instructions');
            }
            const controls = await page.locator('button[data-control-icon]').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => ({
                id:el.id, name:el.getAttribute('aria-label'), size:getComputedStyle(el).fontSize,
                icon:getComputedStyle(el,'::before').maskImage, width:el.getBoundingClientRect().width
            })));
            assert(controls.length > 0 && controls.every(control => control.name && control.size === '0px' && control.icon !== 'none' && control.width >= 44), mode.id + ': visible, named icon controls with 44px touch targets: ' + JSON.stringify(controls));
            await noOverflow(page, mode.id + ' board mobile');
            if (['slave', 'werewolf', 'blackmarket', 'pokdeng'].includes(mode.id)) await page.screenshot({ path: path.join(artifacts, mode.id + '-mobile.png') });
            await page.setViewportSize({ width: 1280, height: 900 });
            await noOverflow(page, mode.id + ' board desktop');
            await context.close();
            console.log('PASS ' + mode.id + ': default create → invite → live player count → start → board (mobile/desktop)');
        }
        for (const game of require('../games/seoContent').listSeoGames().filter(game => game.solo)) {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
            const page = await context.newPage();
            page.on('pageerror', e => errors.push(game.id + ': ' + e.message));
            await page.goto(base + game.playUrl, { waitUntil: 'networkidle' });
            assert.equal(await page.locator('#ppFirstPlay,.promo-overlay').count(), 0);
            await noOverflow(page, game.id + ' solo mobile');
            await page.setViewportSize({ width: 1280, height: 900 });
            await noOverflow(page, game.id + ' solo desktop');
            await context.close();
            console.log('PASS solo ' + game.id + ': opens directly, mobile/desktop');
        }
        assert.deepEqual(errors, [], 'No browser JavaScript errors');
        console.log('PASS all game flows; screenshots: ' + artifacts);
    } finally {
        sockets.forEach(socket => socket.disconnect());
        if (browser) await browser.close();
        server.kill('SIGTERM');
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
