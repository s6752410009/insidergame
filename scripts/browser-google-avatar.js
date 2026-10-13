/**
 * รูปโปรไฟล์จาก Google — เทสด้วยเบราว์เซอร์จริง (มือถือ 390×844 + เดสก์ท็อป)
 *
 *   - ผูก Google ผ่าน /api/auth/google ตัวจริง (ID token เซ็นด้วยกุญแจเทส ดู googleAuthTestKit)
 *   - คนเปิดใช้รูป → คนอื่นเห็นรูป + กรอบ ใน room lobby และกระดาน setthi / werewolf / coup / codenames
 *   - ลิงก์รูปเสีย → กลับเป็น emoji
 *   - ปิดสวิตช์ในหน้าโปรไฟล์ → emoji กลับมาในห้องทันที (broadcast ถัดไป)
 *   - บอท/คนที่ไม่เปิดใช้ ไม่มี avatarImage ใน payload
 *
 * รูปจริงของ Google ไม่โหลดจากเน็ต — page.route ดัก *.googleusercontent.com แล้วตอบ SVG เอง
 * (ลิงก์ที่มีคำว่า BROKEN ตอบ 404)
 *
 * รัน: node scripts/browser-google-avatar.js   (ภาพหน้าจอ → screenshots/google-avatar/)
 */
require('./isolateTestData');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');
const { createKit } = require('./googleAuthTestKit');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'screenshots', 'google-avatar');
const TIMEOUT = 20000;
const FRAME = 'gold';
const PHOTO_URL = 'https://lh3.googleusercontent.com/a/PHOTO_OK=s400-c';
const BROKEN_URL = 'https://lh3.googleusercontent.com/a/BROKEN_PIC=s96-c';
const VIEWPORTS = [
    { tag: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
    { tag: 'desktop', width: 1280, height: 900 }
];

let passed = 0;
function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
    console.log('  ok -', message);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function bootServer(kit) {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, ...kit.serverEnv(), PORT: String(port), ALLOW_LEGACY_SOCKET_IDENTITY: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server startup timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', chunk => {
            logs += String(chunk);
            if (logs.includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(); }
        });
        child.stderr.on('data', chunk => { logs += String(chunk); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
    return { child, baseUrl: `http://127.0.0.1:${port}` };
}

function emitAck(socket, event, payload, timeout = TIMEOUT) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ack timeout ' + event)), timeout);
        socket.emit(event, payload, response => { clearTimeout(timer); resolve(response); });
    });
}

function connect(baseUrl) {
    return new Promise((resolve, reject) => {
        const socket = io(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });
        const timer = setTimeout(() => reject(new Error('connect timeout')), TIMEOUT);
        socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    });
}

// เปิดหน้าเว็บด้วย playerId ครั้งแรก → ได้ identity cookie ของคนนั้น
async function identityCookie(baseUrl, playerId) {
    const res = await fetch(`${baseUrl}/rooms?playerId=${playerId}`, { redirect: 'manual' });
    const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')]).filter(Boolean);
    const header = cookies.map(c => c.split(';')[0]).join('; ');
    if (!header) throw new Error('no identity cookie for ' + playerId);
    return header;
}

async function postJson(baseUrl, url, body, cookie) {
    const res = await fetch(baseUrl + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body)
    });
    return res.json();
}

// แปลงคุกกี้ "a=b; c=d" เป็นรูปแบบของ Playwright
function toPlaywrightCookies(header, baseUrl) {
    return header.split('; ').map(pair => {
        const index = pair.indexOf('=');
        return { name: pair.slice(0, index), value: pair.slice(index + 1), url: baseUrl };
    });
}

const PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
<rect width="96" height="96" fill="#2563eb"/><circle cx="48" cy="38" r="18" fill="#fde68a"/>
<rect x="20" y="60" width="56" height="30" rx="15" fill="#fde68a"/></svg>`;

async function newViewerPage(browser, viewport, baseUrl, cookie, imageHits) {
    const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: Boolean(viewport.isMobile),
        hasTouch: Boolean(viewport.hasTouch),
        deviceScaleFactor: 2
    });
    if (cookie) await context.addCookies(toPlaywrightCookies(cookie, baseUrl));
    await context.route('https://*.googleusercontent.com/**', route => {
        const url = route.request().url();
        imageHits.push(url);
        if (url.includes('BROKEN')) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO_SVG });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return { context, page, errors };
}

// รูปของคนเปิดใช้ต้องขึ้นจริง (โหลดสำเร็จ) และกรอบยังอยู่
async function expectPhotoIn(page, containerSelector, label, frameCheck) {
    const img = page.locator(`${containerSelector} img.pa-img[src*="PHOTO_OK"]`).first();
    await img.waitFor({ state: 'attached', timeout: TIMEOUT });
    await img.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForFunction(selector => {
        const el = document.querySelector(selector);
        return el && el.complete && el.naturalWidth > 0;
    }, `${containerSelector} img.pa-img[src*="PHOTO_OK"]`, { timeout: TIMEOUT });
    const attrs = await img.evaluate(el => ({
        src: el.getAttribute('src'),
        referrer: el.getAttribute('referrerpolicy'),
        loading: el.getAttribute('loading'),
        width: el.getAttribute('width'),
        height: el.getAttribute('height')
    }));
    assert(attrs.src.endsWith('=s96-c') && attrs.referrer === 'no-referrer' && attrs.loading === 'lazy' && attrs.width && attrs.height,
        `${label}: photo shown (=s96-c, no-referrer, lazy, fixed size)`);
    if (frameCheck) {
        const ok = await frameCheck(img);
        const debug = ok ? '' : ' — ' + await img.evaluate(el => (el.closest('.st-token,.player-avatar,.player-avatar-stage') || el.parentElement).outerHTML.slice(0, 400));
        assert(ok, `${label}: frame drawn around the photo${debug}`);
    }
}

const frameLayerCheck = img => img.evaluate(el => {
    const avatar = el.closest('.player-avatar');
    return Boolean(avatar && avatar.getAttribute('data-frame') === 'gold' && avatar.querySelector('.pa-frame'));
});

async function expectBrokenFallback(page, containerSelector, label) {
    await page.waitForFunction(selector => !document.querySelector(selector + ' img.pa-img[src*="BROKEN"]'),
        containerSelector, { timeout: TIMEOUT });
    const emojiVisible = await page.evaluate(selector => {
        return Array.from(document.querySelectorAll(selector + ' .pa-emoji')).some(span => {
            const host = span.parentElement;
            return host && !host.classList.contains('pa-has-img') && getComputedStyle(span).visibility !== 'hidden';
        });
    }, containerSelector);
    assert(emojiVisible, `${label}: broken photo falls back to the emoji`);
}

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const kit = createKit();
    const { child, baseUrl } = await bootServer(kit);
    const browser = await chromium.launch();
    const sockets = [];

    try {
        // ---------- ตัวละคร ----------
        const photoId = randomUUID();   // เปิดใช้รูป Google + กรอบทอง
        const brokenId = randomUUID();  // เปิดใช้รูป แต่ลิงก์รูปเสีย
        const viewerId = randomUUID();  // คนดู (ไม่ผูก Google)
        const fillerIds = [randomUUID(), randomUUID()];

        // สร้างผู้เล่นทุกคนผ่าน socket ก่อน (ให้มีตัวตนในระบบ)
        for (const id of [photoId, brokenId, viewerId, ...fillerIds]) {
            const s = await connect(baseUrl);
            s.emit('initPlayer', id);
            sockets.push(s);
        }
        await delay(600);

        const cookies = {};
        for (const id of [photoId, brokenId, viewerId]) cookies[id] = await identityCookie(baseUrl, id);

        console.log('link Google (verified token) + opt in');
        const linkPhoto = await postJson(baseUrl, '/api/auth/google',
            { credential: kit.signIdToken({ sub: 'sub-photo-' + photoId, email: 'photo@example.com', picture: PHOTO_URL }) }, cookies[photoId]);
        assert(linkPhoto.success && linkPhoto.action === 'linked' && linkPhoto.hasPicture === true && linkPhoto.useGooglePhoto === false,
            'linking returns hasPicture and leaves the photo off by default');
        const before = await postJson(baseUrl, '/profile/updateAvatarFrame', { frameId: FRAME }, cookies[photoId]);
        assert(before.success, 'photo player picks the gold frame');
        const optIn = await postJson(baseUrl, '/profile/useGooglePhoto', { enabled: true }, cookies[photoId]);
        assert(optIn.success && optIn.avatarImage === 'https://lh3.googleusercontent.com/a/PHOTO_OK=s96-c', 'opt-in returns normalized avatarImage');

        const linkBroken = await postJson(baseUrl, '/api/auth/google',
            { credential: kit.signIdToken({ sub: 'sub-broken-' + brokenId, email: 'broken@example.com', picture: BROKEN_URL }) }, cookies[brokenId]);
        assert(linkBroken.success, 'second player links Google');
        assert((await postJson(baseUrl, '/profile/useGooglePhoto', { enabled: true }, cookies[brokenId])).success, 'second player opts in');

        const viewerOptIn = await postJson(baseUrl, '/profile/useGooglePhoto', { enabled: true }, cookies[viewerId]);
        assert(viewerOptIn.success === false && /Google/.test(viewerOptIn.error), 'unlinked player cannot turn the photo on ' + JSON.stringify(viewerOptIn));

        // ---------- room lobby (ยังไม่เริ่มเกม) ----------
        const hostSocket = sockets[0];
        const lobbyRoom = await emitAck(hostSocket, 'createRoom', { playerId: photoId, name: `GAvatar lobby ${Date.now()}`, gameMode: 'werewolf', maxPlayers: 10 });
        assert(lobbyRoom.success, 'create lobby room');
        const lobbyRoomId = lobbyRoom.roomId;
        hostSocket.emit('setRoom', { roomId: lobbyRoomId, playerId: photoId });
        for (const [index, id] of [[1, brokenId], [2, viewerId]]) {
            const joined = await emitAck(sockets[index], 'joinRoom', { roomId: lobbyRoomId, playerId: id });
            assert(joined.success, `join lobby (${index})`);
            sockets[index].emit('setRoom', { roomId: lobbyRoomId, playerId: id });
        }
        await delay(900);

        const updates = [];
        sockets[2].on('roomUpdate', payload => updates.push(payload));
        hostSocket.emit('sendMessage', { message: 'สวัสดีจากรูป Google' });
        await delay(700);

        for (const viewport of VIEWPORTS) {
            console.log(`room lobby @ ${viewport.tag}`);
            const imageHits = [];
            const { context, page, errors } = await newViewerPage(browser, viewport, baseUrl, cookies[viewerId], imageHits);
            await page.goto(`${baseUrl}/room/${lobbyRoomId}?playerId=${viewerId}`, { waitUntil: 'domcontentloaded' });
            await expectPhotoIn(page, '.lobby-player-avatar', `${viewport.tag} lobby list`, frameLayerCheck);
            await expectBrokenFallback(page, '.lobby-player-avatar', `${viewport.tag} lobby list`);
            assert(imageHits.some(url => url.includes('BROKEN')), `${viewport.tag}: broken image was actually requested`);
            await page.screenshot({ path: path.join(SHOT_DIR, `room-lobby-${viewport.tag}.png`), fullPage: false });
            assert(errors.length === 0, `${viewport.tag} lobby: no page errors ${errors.join(' | ')}`);
            await context.close();
        }

        // ---------- กระดานเกม ----------
        const boards = [
            {
                mode: 'setthi', count: 3, maxPlayers: 6,
                selector: '.st-token',
                frameCheck: img => img.evaluate(el => {
                    const token = el.closest('.st-token');
                    return Boolean(token && token.getAttribute('data-frame') === 'gold' && /gradient/.test(getComputedStyle(token).backgroundImage));
                })
            },
            {
                mode: 'werewolf', count: 5, maxPlayers: 10,
                selector: '.player-avatar-stage',
                frameCheck: img => img.evaluate(el => {
                    const stage = el.closest('.player-avatar-stage');
                    return Boolean(stage && /gradient/.test(getComputedStyle(stage).backgroundImage));
                })
            },
            { mode: 'coup', count: 3, maxPlayers: 6, selector: '.player-avatar', frameCheck: frameLayerCheck },
            { mode: 'codenames', count: 4, maxPlayers: 10, selector: '.cn-member-avatar', frameCheck: frameLayerCheck }
        ];

        for (const board of boards) {
            const ids = [photoId, brokenId, viewerId, ...fillerIds].slice(0, board.count);
            const created = await emitAck(sockets[0], 'createRoom', { playerId: photoId, name: `GAvatar ${board.mode} ${Date.now()}`, gameMode: board.mode, maxPlayers: board.maxPlayers, roundTime: 5 });
            assert(created.success, `create ${board.mode} room`);
            const roomId = created.roomId;
            sockets[0].emit('setRoom', { roomId, playerId: photoId });
            for (let i = 1; i < ids.length; i++) {
                const joined = await emitAck(sockets[i], 'joinRoom', { roomId, playerId: ids[i] });
                if (!joined.success) throw new Error(`join ${board.mode} failed: ${JSON.stringify(joined)}`);
                sockets[i].emit('setRoom', { roomId, playerId: ids[i] });
            }
            await delay(900);
            if (board.mode === 'codenames') await emitAck(sockets[0], 'codenames_shuffleTeams', {});
            const started = await emitAck(sockets[0], 'startGameFromLobby', { roomId }, 30000);
            assert(started && started.success, `start ${board.mode}: ${JSON.stringify(started)}`);
            await delay(2500);

            for (const viewport of VIEWPORTS) {
                console.log(`${board.mode} board @ ${viewport.tag}`);
                const imageHits = [];
                const { context, page, errors } = await newViewerPage(browser, viewport, baseUrl, cookies[viewerId], imageHits);
                await page.goto(`${baseUrl}/game/${roomId}?playerId=${viewerId}`, { waitUntil: 'domcontentloaded' });
                await expectPhotoIn(page, board.selector, `${viewport.tag} ${board.mode}`, board.frameCheck);
                await expectBrokenFallback(page, board.selector, `${viewport.tag} ${board.mode}`);
                // ปิดป๊อปอัป "วิธีเล่นแบบสั้น" ก่อนถ่ายภาพ จะได้เห็นกระดาน
                const skip = page.getByRole('button', { name: 'ข้าม', exact: true });
                if (await skip.count()) await skip.first().click({ timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(600);
                await page.locator(`${board.selector} img.pa-img[src*="PHOTO_OK"]`).first().scrollIntoViewIfNeeded().catch(() => {});
                await page.screenshot({ path: path.join(SHOT_DIR, `${board.mode}-${viewport.tag}.png`), fullPage: false });
                assert(errors.length === 0, `${viewport.tag} ${board.mode}: no page errors ${errors.join(' | ')}`);
                await context.close();
            }
        }

        // ---------- payload: บอท/คนไม่เปิดใช้ ไม่มี avatarImage ----------
        console.log('payloads');
        const lastUpdate = updates[updates.length - 1];
        if (lastUpdate && Array.isArray(lastUpdate.players)) {
            const bots = lastUpdate.players.filter(p => String(p.playerId).startsWith('bot_'));
            const viewerRow = lastUpdate.players.find(p => p.playerId === viewerId);
            assert(bots.every(p => !('avatarImage' in p)), `bots carry no avatarImage (${bots.length} bots)`);
            assert(!viewerRow || !('avatarImage' in viewerRow), 'non-opted-in player carries no avatarImage');
        }

        // ---------- ปิดสวิตช์ในหน้าโปรไฟล์ → emoji กลับในห้องทันที ----------
        console.log('profile toggle → live room update');
        const liveRoom = await emitAck(sockets[0], 'createRoom', { playerId: photoId, name: `GAvatar live ${Date.now()}`, gameMode: 'werewolf', maxPlayers: 10 });
        sockets[0].emit('setRoom', { roomId: liveRoom.roomId, playerId: photoId });
        assert((await emitAck(sockets[2], 'joinRoom', { roomId: liveRoom.roomId, playerId: viewerId })).success, 'viewer joins live room');
        sockets[2].emit('setRoom', { roomId: liveRoom.roomId, playerId: viewerId });
        await delay(700);

        const viewerSide = await newViewerPage(browser, VIEWPORTS[0], baseUrl, cookies[viewerId], []);
        await viewerSide.page.goto(`${baseUrl}/room/${liveRoom.roomId}?playerId=${viewerId}`, { waitUntil: 'domcontentloaded' });
        await expectPhotoIn(viewerSide.page, '.lobby-player-avatar', 'live room before toggle', frameLayerCheck);

        const owner = await newViewerPage(browser, VIEWPORTS[0], baseUrl, cookies[photoId], []);
        await owner.page.goto(`${baseUrl}/profile`, { waitUntil: 'domcontentloaded' });
        await owner.page.locator('#tab-style').click();
        const toggle = owner.page.locator('#googlePhotoToggle');
        await toggle.waitFor({ state: 'visible', timeout: TIMEOUT });
        assert(await toggle.getAttribute('aria-checked') === 'true', 'profile switch shows ON');
        assert(await owner.page.locator('#pfAvatar img.pa-img[src*="PHOTO_OK"]').count() === 1, 'profile pass shows the Google photo');
        await toggle.scrollIntoViewIfNeeded();
        await owner.page.screenshot({ path: path.join(SHOT_DIR, 'profile-toggle-on-mobile.png') });
        await toggle.click();
        await owner.page.waitForFunction(() => document.querySelector('#googlePhotoToggle').getAttribute('aria-checked') === 'false' && !document.querySelector('#googlePhotoToggle').disabled, null, { timeout: TIMEOUT });
        assert(await owner.page.locator('#pfAvatar img.pa-img').count() === 0, 'profile pass back to emoji after switching off');
        await owner.page.screenshot({ path: path.join(SHOT_DIR, 'profile-toggle-off-mobile.png') });

        await viewerSide.page.waitForFunction(() => !document.querySelector('.lobby-player-avatar img.pa-img[src*="PHOTO_OK"]'), null, { timeout: TIMEOUT });
        assert(true, 'other players see the emoji again without reloading');
        await viewerSide.page.screenshot({ path: path.join(SHOT_DIR, 'live-room-after-off-mobile.png') });
        assert(viewerSide.errors.length === 0 && owner.errors.length === 0, 'no page errors on profile / live room');
        await viewerSide.context.close();
        await owner.context.close();

        // ---------- คนผูก Google แต่ยังไม่มีรูป → เห็น hint ----------
        console.log('linked without picture → hint');
        const noPicId = randomUUID();
        const s = await connect(baseUrl);
        s.emit('initPlayer', noPicId);
        sockets.push(s);
        await delay(400);
        const noPicCookie = await identityCookie(baseUrl, noPicId);
        assert((await postJson(baseUrl, '/api/auth/google', { credential: kit.signIdToken({ sub: 'sub-nopic-' + noPicId, email: 'nopic@example.com' }) }, noPicCookie)).success, 'link without picture');
        const hintSide = await newViewerPage(browser, VIEWPORTS[1], baseUrl, noPicCookie, []);
        await hintSide.page.goto(`${baseUrl}/profile`, { waitUntil: 'domcontentloaded' });
        await hintSide.page.locator('#tab-style').click();
        const hint = hintSide.page.locator('#googlePhotoHint');
        await hint.waitFor({ state: 'visible', timeout: TIMEOUT });
        assert(/เข้าด้วย Google อีกครั้งเพื่อดึงรูป/.test(await hint.innerText()), 'hint tells the player to sign in with Google again');
        assert(await hintSide.page.locator('#googlePhotoToggle').count() === 0, 'no switch until a picture exists');
        await hint.scrollIntoViewIfNeeded();
        await hintSide.page.screenshot({ path: path.join(SHOT_DIR, 'profile-hint-desktop.png') });
        await hintSide.context.close();

        console.log(`\n✅ browser-google-avatar: ${passed} assertions passed · screenshots in ${path.relative(ROOT, SHOT_DIR)}/`);
    } finally {
        sockets.forEach(socket => socket.close());
        await browser.close().catch(() => {});
        child.kill('SIGTERM');
    }
}

main().then(() => process.exit(0)).catch(error => {
    console.error('❌', error.stack || error.message);
    process.exit(1);
});
