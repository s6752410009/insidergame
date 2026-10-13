#!/usr/bin/env node
/**
 * แชทโลก ผ่าน socket จริง (ตัวตนจากคุกกี้ที่เซ็นแล้ว ไม่ใช่ id ที่ client ส่ง)
 *   คนใหม่อ่านได้พิมพ์ไม่ได้ · Google/เล่นจบ 1 เกม พิมพ์ได้ · 1 ข้อความ/5 วิ · ห้ามซ้ำ · ห้ามลิงก์/LINE/เบอร์
 *   คำหยาบไม่ถูกส่ง (คำเตือนเห็นแค่คนส่ง) · รายงานครบ 3 ซ่อนเอง · แอดมินลบ/ห้ามพิมพ์/แบน/แก้คำ (ต้อง login)
 *   การ์ดชวนเล่น · log หมวดแชท · รีสตาร์ตแล้วข้อมูลอยู่
 * รัน: node scripts/smoke-world-chat-socket.js
 */

const { DATA_DIR } = require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { io: connect } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const SECRET = 'world-chat-test-secret';
const ADMIN_PASSWORD = 'world-chat-admin-pass';
let passed = 0;

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
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

// ---------- ข้อมูลตั้งต้น ----------
const ids = {};
['veteran', 'second', 'google', 'newcomer', 'third', 'fourth'].forEach(key => { ids[key] = crypto.randomUUID(); });

function seed() {
    const players = {};
    const stats = {};
    const add = (key, name, games, extra = {}) => {
        players[ids[key]] = {
            playerId: ids[key], playerName: name, color: '#3498db', avatar: '😀', avatarFrame: 'gold',
            createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), approved: true, ...extra
        };
        stats[ids[key]] = { playerId: ids[key], playerName: name, totalGames: games, wins: 0, losses: games };
    };
    add('veteran', 'ทหารผ่านศึก', 3);
    add('second', 'คนที่สอง', 1);
    add('google', 'กูเกิล', 0, { googleSub: 'sub-123', googleEmail: 'g@example.com' });
    add('newcomer', 'มือใหม่', 0);
    add('third', 'คนที่สาม', 2);
    add('fourth', 'คนที่สี่', 5);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(players));
    fs.writeFileSync(path.join(DATA_DIR, 'playerStats.json'), JSON.stringify(stats));
}

function signedCookie(playerId) {
    const signature = crypto.createHmac('sha256', SECRET).update(playerId).digest('base64').replace(/=+$/, '');
    return `insider_pid=${encodeURIComponent(`s:${playerId}.${signature}`)}`;
}

// ---------- เซิร์ฟเวอร์ ----------
function boot(port) {
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), MONGO_URL: '', SESSION_SECRET: SECRET, ADMIN_PASSWORD, NODE_ENV: 'test' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.stdout.on('data', chunk => { logs += String(chunk); });
    child.stderr.on('data', chunk => { logs += String(chunk); });
    child.logs = () => logs;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('startup timeout\n' + logs.slice(-1500))); }, 40000);
        const check = setInterval(() => {
            if (logs.includes(`Server started on port ${port}`)) {
                clearInterval(check); clearTimeout(timer); resolve(child);
            }
        }, 100);
        child.once('exit', code => { clearInterval(check); clearTimeout(timer); reject(new Error(`server exited ${code}\n${logs.slice(-1500)}`)); });
    });
}

function stop(child) {
    return new Promise(resolve => {
        if (!child || child.exitCode !== null) return resolve();
        child.removeAllListeners('exit');
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 8000);
    });
}

const sockets = [];
function client(base, playerId) {
    const socket = connect(base, {
        transports: ['websocket'],
        extraHeaders: playerId ? { Cookie: signedCookie(playerId) } : {},
        reconnection: false,
        forceNew: true
    });
    sockets.push(socket);
    socket.received = [];
    socket.removed = [];
    socket.statusUpdates = [];
    socket.on('worldChat:message', message => socket.received.push(message));
    socket.on('worldChat:removed', data => socket.removed.push(...data.ids));
    socket.on('worldChat:me', status => socket.statusUpdates.push(status));
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

function emit(socket, event, data) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 8000);
        socket.emit(event, data, response => { clearTimeout(timer); resolve(response); });
    });
}

async function waitFor(check, label, timeout = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
        if (check()) return;
        await delay(40);
    }
    throw new Error('FAIL (timeout): ' + label);
}

function request(base, method, pathname, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathname, base);
        const req = http.request(url, {
            method,
            headers: {
                ...(cookie ? { Cookie: cookie } : {}),
                ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {})
            }
        }, res => {
            let text = '';
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function adminSocket(base) {
    const login = await request(base, 'POST', '/admin/login', { body: `password=${encodeURIComponent(ADMIN_PASSWORD)}` });
    const cookie = (login.headers['set-cookie'] || []).map(line => line.split(';')[0]).join('; ');
    assert(login.status === 302 && cookie, 'แอดมิน login ได้');
    const page = await request(base, 'GET', '/admin', { cookie });
    const token = (page.text.match(/const adminToken = '([0-9a-f]+)'/) || [])[1];
    assert(token, 'หน้าแอดมินมี token');
    const socket = await client(base, null);
    const auth = await emit(socket, 'admin_authenticate', { token });
    assert(auth.success, 'socket แอดมินยืนยันตัวตน');
    return socket;
}

async function run() {
    seed();
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    let server = await boot(port);
    try {
        const veteran = await client(base, ids.veteran);
        const second = await client(base, ids.second);
        const google = await client(base, ids.google);
        const newcomer = await client(base, ids.newcomer);
        const third = await client(base, ids.third);
        const fourth = await client(base, ids.fourth);
        const anonymous = await client(base, null);

        // ---- สิทธิ์พิมพ์ ----
        const hist = {};
        for (const [key, socket] of Object.entries({ veteran, second, google, newcomer, third, fourth, anonymous })) {
            hist[key] = await emit(socket, 'worldChat:history', {});
            assert(hist[key].success && Array.isArray(hist[key].messages), `${key}: โหลดประวัติได้ (อ่านได้ทุกคน)`);
        }
        assert(hist.veteran.me.canSend === true, 'เล่นจบ 3 เกม พิมพ์ได้');
        assert(hist.second.me.canSend === true, 'เล่นจบ 1 เกม พิมพ์ได้');
        assert(hist.google.me.canSend === true, 'ผูก Google (0 เกม) พิมพ์ได้');
        assert(hist.newcomer.me.canSend === false && hist.newcomer.me.reason === 'newcomer', 'คนใหม่ 0 เกม พิมพ์ไม่ได้');
        assert(hist.anonymous.me.canSend === false && hist.anonymous.me.reason === 'no_player', 'ไม่มีคุกกี้ พิมพ์ไม่ได้');
        assert(hist.veteran.me.playerId === ids.veteran, 'ตัวตนมาจากคุกกี้');

        const blockedNew = await emit(newcomer, 'worldChat:send', { text: 'สวัสดี' });
        assert(!blockedNew.success && blockedNew.code === 'newcomer', 'คนใหม่ส่งไม่ได้');
        // ส่ง playerId ของคนอื่นมาเองก็ไม่ช่วย
        const spoof = await emit(newcomer, 'worldChat:send', { text: 'สวัสดี', playerId: ids.veteran });
        assert(!spoof.success && spoof.code === 'newcomer', 'แอบอ้าง playerId ใน payload ไม่ได้ผล');
        const spoofAnon = await emit(anonymous, 'worldChat:send', { text: 'สวัสดี', playerId: ids.veteran });
        assert(!spoofAnon.success && spoofAnon.code === 'no_player', 'ไม่มีคุกกี้ + แอบอ้าง id ไม่ได้ผล');

        // ---- ส่งข้อความ ----
        const sent = await emit(veteran, 'worldChat:send', { text: '  สวัสดีทุกคน   มาเล่นกัน  ' });
        assert(sent.success && sent.id, 'ส่งได้');
        await waitFor(() => newcomer.received.some(m => m.id === sent.id), 'คนใหม่ได้รับข้อความสด');
        await waitFor(() => anonymous.received.some(m => m.id === sent.id), 'คนไม่มีบัญชีก็อ่านได้');
        const live = newcomer.received.find(m => m.id === sent.id);
        assert(live.text === 'สวัสดีทุกคน มาเล่นกัน', 'ตัดช่องว่างเกิน');
        assert(live.playerName === 'ทหารผ่านศึก' && live.avatarFrame === 'gold' && live.avatar === '😀', 'มีชื่อ + รูป + กรอบ');
        assert(live.reports === undefined && live.reporters === undefined, 'ไม่ส่งรายชื่อคนรายงานให้ผู้เล่น');

        const fast = await emit(veteran, 'worldChat:send', { text: 'อีกข้อความ' });
        assert(!fast.success && fast.code === 'rate' && fast.retryInMs > 0, 'ส่งติดกันภายใน 5 วิไม่ได้');

        const html = await emit(google, 'worldChat:send', { text: '<img src=x onerror=alert(1)>' });
        assert(html.success, 'ข้อความที่หน้าตาเป็น HTML ส่งได้ (หน้าเว็บ escape เอง)');
        await waitFor(() => veteran.received.some(m => m.id === html.id), 'ได้รับข้อความ HTML');
        assert(veteran.received.find(m => m.id === html.id).text === '<img src=x onerror=alert(1)>', 'เก็บเป็นข้อความดิบ ไม่แปลง');

        // ---- คำหยาบ: คนส่งเห็นคำเตือน คนอื่นไม่เห็นอะไรเลย ----
        const before = veteran.received.length;
        const rude = await emit(second, 'worldChat:send', { text: 'ค ว ย' });
        assert(!rude.success && rude.code === 'profanity' && /ไม่สุภาพ/.test(rude.error), 'คำหยาบถูกบล็อก + คำเตือนภาษาไทย');
        await delay(400);
        assert(veteran.received.length === before, 'คนอื่นไม่ได้รับข้อความหยาบ');
        const rudeAgain = await emit(second, 'worldChat:send', { text: 'สวัสดีครับ' });
        assert(!rudeAgain.success && rudeAgain.code === 'rate', 'โดนบล็อกแล้วต้องรอ 5 วิ (กันลองคำหลบรัวๆ)');

        const link = await emit(third, 'worldChat:send', { text: 'เข้าเว็บ free-coin.xyz ได้เงิน' });
        assert(!link.success && link.code === 'link', 'ลิงก์ถูกบล็อก');
        const line = await emit(fourth, 'worldChat:send', { text: 'แอดไลน์ @promo99 นะ' });
        assert(!line.success && line.code === 'line', 'LINE ถูกบล็อก');
        const tooLong = await emit(google, 'worldChat:send', { text: 'ก'.repeat(201) });
        assert(!tooLong.success && (tooLong.code === 'too_long' || tooLong.code === 'rate'), 'ยาวเกิน 200 ไม่รับ');

        // ---- ซ้ำ ----
        await delay(5100);
        const repeat = await emit(veteran, 'worldChat:send', { text: 'สวัสดีทุกคน มาเล่นกัน!!' });
        assert(!repeat.success && repeat.code === 'repeat', 'ส่งข้อความเดิมซ้ำไม่ได้ (เติม ! ก็นับว่าซ้ำ)');
        const phone = await emit(fourth, 'worldChat:send', { text: 'โทรมา 081-234-5678' });
        assert(!phone.success && phone.code === 'phone', 'เบอร์โทรถูกบล็อก');
        const fresh = await emit(veteran, 'worldChat:send', { text: 'ใครว่างบ้าง' });
        assert(fresh.success, 'ข้อความใหม่ส่งได้หลังรอ');

        // ---- รายงาน ----
        const own = await emit(veteran, 'worldChat:report', { messageId: fresh.id });
        assert(!own.success && own.code === 'own', 'รายงานตัวเองไม่ได้');
        const fromNewcomer = await emit(newcomer, 'worldChat:report', { messageId: fresh.id });
        assert(!fromNewcomer.success && fromNewcomer.code === 'newcomer', 'คนใหม่รายงานไม่ได้');
        const r1 = await emit(second, 'worldChat:report', { messageId: fresh.id });
        assert(r1.success && r1.status === 'reported' && !r1.hidden, 'รายงานคนที่ 1');
        const r1again = await emit(second, 'worldChat:report', { messageId: fresh.id });
        assert(r1again.success && r1again.status === 'already', 'คนเดิมรายงานซ้ำไม่นับ');
        const r2 = await emit(google, 'worldChat:report', { messageId: fresh.id });
        assert(r2.success && !r2.hidden, 'รายงานคนที่ 2 ยังไม่ซ่อน');
        const r3 = await emit(third, 'worldChat:report', { messageId: fresh.id });
        assert(r3.success && r3.hidden, 'รายงานครบ 3 → ซ่อน');
        await waitFor(() => newcomer.removed.includes(fresh.id), 'ทุกคนได้รับสัญญาณลบข้อความที่ถูกซ่อน');
        const afterHide = await emit(newcomer, 'worldChat:history', {});
        assert(!afterHide.messages.some(m => m.id === fresh.id), 'ประวัติไม่มีข้อความที่ถูกซ่อน');
        const missing = await emit(second, 'worldChat:report', { messageId: 'nope' });
        assert(!missing.success && missing.code === 'not_found', 'รายงานข้อความที่ไม่มี');

        // ---- unread (subscribe) ----
        const sub = await emit(anonymous, 'worldChat:subscribe', { since: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
        assert(sub.success && sub.unread >= 2 && sub.latestAt, `นับยังไม่อ่าน (${sub.unread})`);
        const subNone = await emit(anonymous, 'worldChat:subscribe', { since: new Date(Date.now() + 1000).toISOString() });
        assert(subNone.unread === 0, 'อ่านแล้ว = 0');

        // ---- แอดมิน ----
        const notAdmin = await emit(veteran, 'admin_worldChatGet', {});
        assert(!notAdmin.success && notAdmin.error === 'Unauthorized', 'ผู้เล่นเรียกคำสั่งแอดมินไม่ได้');
        const notAdminMute = await emit(veteran, 'admin_worldChatAction', { action: 'mute', playerId: ids.second, minutes: 10 });
        assert(!notAdminMute.success, 'ผู้เล่นห้ามพิมพ์คนอื่นไม่ได้');
        const admin = await adminSocket(base);
        const snap = await emit(admin, 'admin_worldChatGet', {});
        assert(snap.success && snap.messages.some(m => m.id === fresh.id && m.hidden && m.reports === 3), 'แอดมินเห็นข้อความที่ถูกซ่อน + จำนวนรายงาน');
        assert(snap.messages.find(m => m.id === fresh.id).reporters.length === 3, 'แอดมินเห็นชื่อคนรายงาน');
        assert(snap.words.block.some(w => w.word === 'ควย') && snap.words.allow.some(w => w.word === 'หีบ'), 'แอดมินเห็นรายการคำ');

        const restored = await emit(admin, 'admin_worldChatAction', { action: 'restore', messageId: fresh.id });
        assert(restored.success, 'แอดมินคืนข้อความ');
        await waitFor(() => newcomer.received.filter(m => m.id === fresh.id).length >= 2, 'ข้อความที่คืนส่งกลับไปให้ทุกคน');
        const deleted = await emit(admin, 'admin_worldChatAction', { action: 'delete', messageId: html.id });
        assert(deleted.success && !deleted.messages.some(m => m.id === html.id), 'แอดมินลบข้อความ');
        await waitFor(() => veteran.removed.includes(html.id), 'ข้อความที่ลบหายจากหน้าทุกคน');

        const muted = await emit(admin, 'admin_worldChatAction', { action: 'mute', playerId: ids.fourth, minutes: 10 });
        assert(muted.success && muted.mutes.some(m => m.playerId === ids.fourth), 'ห้ามพิมพ์ 10 นาที');
        await waitFor(() => fourth.statusUpdates.some(s => s.reason === 'muted' && !s.canSend), 'คนที่โดนห้ามรู้ทันที');
        await delay(5100 - 0);
        const mutedSend = await emit(fourth, 'worldChat:send', { text: 'ทดสอบ' });
        assert(!mutedSend.success && mutedSend.code === 'muted', 'โดนห้ามพิมพ์ ส่งไม่ได้');
        await emit(admin, 'admin_worldChatAction', { action: 'unmute', playerId: ids.fourth });
        await waitFor(() => fourth.statusUpdates.some(s => s.canSend), 'ปลดแล้วรู้ทันที');
        const muteDay = await emit(admin, 'admin_worldChatAction', { action: 'mute', playerId: ids.third, minutes: 1440 });
        assert(muteDay.mutes.find(m => m.playerId === ids.third && Date.parse(m.until) - Date.now() > 23 * 3600 * 1000), 'ห้ามพิมพ์ 1 วัน');

        const ban = await emit(admin, 'admin_banPlayer', { playerId: ids.second, reason: 'ด่า', durationHours: 1 });
        assert(ban.success, 'แบน (ระบบเดิม)');
        await waitFor(() => second.statusUpdates.some(s => s.reason === 'banned'), 'คนที่โดนแบนรู้ทันที');
        const bannedSend = await emit(second, 'worldChat:send', { text: 'ยังอยู่ไหม' });
        assert(!bannedSend.success && bannedSend.code === 'banned', 'โดนแบน ส่งไม่ได้');

        const addWord = await emit(admin, 'admin_worldChatWord', { list: 'block', op: 'add', word: 'ตอแหล' });
        assert(addWord.success && addWord.words.block.some(w => w.word === 'ตอแหล' && !w.builtin), 'เพิ่มคำต้องห้าม');
        const test = await emit(admin, 'admin_worldChatTest', { text: 'ต.อ.แ.ห.ล' });
        assert(test.success && test.verdict.ok === false, 'ปุ่มทดสอบคำ');
        const newWord = await emit(google, 'worldChat:send', { text: 'ตอ แหล' });
        assert(!newWord.success && newWord.code === 'profanity', 'คำที่แอดมินเพิ่ม มีผลทันที');
        const allowWord = await emit(admin, 'admin_worldChatWord', { list: 'allow', op: 'add', word: 'ตอแหลนา' });
        assert(allowWord.success && allowWord.words.allow.some(w => w.word === 'ตอแหลนา'), 'เพิ่มคำที่อนุญาต');
        const threshold = await emit(admin, 'admin_worldChatSettings', { reportThreshold: 4 });
        assert(threshold.success && threshold.words.reportThreshold === 4, 'ตั้งจำนวนรายงาน');
        const badThreshold = await emit(admin, 'admin_worldChatSettings', { reportThreshold: 0 });
        assert(!badThreshold.success, 'จำนวนรายงานต้อง ≥1');

        // ---- การ์ดชวนเล่น ----
        const noRoom = await emit(fourth, 'worldChat:invite', {});
        assert(!noRoom.success && noRoom.code === 'no_room', 'ไม่ได้อยู่ในห้อง ชวนไม่ได้');
        const created = await emit(fourth, 'createRoom', { name: 'ห้องทดสอบ', gameMode: 'werewolf', maxPlayers: 8 });
        assert(created.success && created.roomId, 'สร้างห้อง');
        const invite = await emit(fourth, 'worldChat:invite', {});
        assert(invite.success, 'ส่งการ์ดชวนเล่น');
        await waitFor(() => newcomer.received.some(m => m.id === invite.id), 'ทุกคนเห็นการ์ด');
        const card = newcomer.received.find(m => m.id === invite.id);
        assert(card.kind === 'invite' && card.invite.roomId === created.roomId && card.invite.status === 'open', 'การ์ดมีห้อง + สถานะเปิด');
        assert(card.invite.count >= 1 && card.invite.max >= 2 && card.invite.gameLabel, 'การ์ดมีจำนวนที่นั่ง + ชื่อเกม');
        const inviteAgain = await emit(fourth, 'worldChat:invite', {});
        assert(!inviteAgain.success && inviteAgain.code === 'rate', 'ชวนซ้ำภายใน 60 วิไม่ได้');

        // ---- log หมวดแชทโลก ----
        const logs = await emit(admin, 'admin_getLogs', { view: 'chat', limit: 200 });
        assert(logs.success && logs.counts && logs.counts.chat > 0, 'Logs มีหมวดแชทโลก');
        const events = new Set((logs.logs || logs.entries || []).map(entry => entry.meta && entry.meta.event));
        ['world_chat_message', 'world_chat_blocked', 'world_chat_report', 'world_chat_auto_hidden', 'world_chat_invite']
            .forEach(event => assert(events.has(event), `log มี ${event}`));
        const adminLogs = await emit(admin, 'admin_getLogs', { view: 'admin', limit: 200 });
        const adminEvents = new Set((adminLogs.logs || adminLogs.entries || []).map(entry => entry.meta && entry.meta.event));
        ['world_chat_delete', 'world_chat_mute', 'world_chat_unmute', 'world_chat_word'].forEach(event => assert(adminEvents.has(event), `log แอดมินมี ${event}`));

        // ---- รีสตาร์ต ----
        sockets.forEach(socket => socket.close());
        sockets.length = 0;
        await stop(server);
        server = await boot(port);
        const reader = await client(base, ids.newcomer);
        const after = await emit(reader, 'worldChat:history', {});
        assert(after.messages.some(m => m.id === fresh.id) && after.messages.some(m => m.id === invite.id), 'รีสตาร์ตแล้วประวัติอยู่');
        assert(!after.messages.some(m => m.id === html.id), 'ข้อความที่ลบไม่กลับมา');
        const vet2 = await client(base, ids.third);
        const thirdStatus = await emit(vet2, 'worldChat:history', {});
        assert(thirdStatus.me.reason === 'muted', 'ห้ามพิมพ์ 1 วัน อยู่หลังรีสตาร์ต');
        const g2 = await client(base, ids.google);
        const wordAfter = await emit(g2, 'worldChat:send', { text: 'ตอแหล' });
        assert(!wordAfter.success && wordAfter.code === 'profanity', 'คำที่แอดมินเพิ่ม อยู่หลังรีสตาร์ต');
    } catch (error) {
        console.error(server && server.logs ? server.logs().slice(-2500) : '');
        throw error;
    } finally {
        sockets.forEach(socket => socket.close());
        await stop(server);
    }
    console.log(`✅ world chat socket: ${passed} checks passed`);
}

run().catch(error => {
    console.error(error.message);
    process.exit(1);
});
