const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const TIMEOUT_MS = 15000;

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function emitAck(socket, eventName, payload) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('ack timeout ' + eventName)), TIMEOUT_MS);
        socket.emit(eventName, payload, res => { clearTimeout(t); resolve(res); });
    });
}

function once(socket, eventName, predicate) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout ' + eventName)), TIMEOUT_MS);
        socket.on(eventName, function h(p) {
            if (predicate && !predicate(p)) return;
            clearTimeout(t); socket.off(eventName, h); resolve(p);
        });
    });
}

async function connect() {
    const s = io(BASE_URL, { transports: ['websocket'], forceNew: true, timeout: TIMEOUT_MS });
    await once(s, 'connect');
    return s;
}

async function main() {
    // 1. admin login -> get token from /admin page html
    const loginRes = await fetch(`${BASE_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=supersecret',
        redirect: 'manual'
    });
    const cookie = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert(cookie, 'no session cookie from login');

    const adminPage = await fetch(`${BASE_URL}/admin`, { headers: { cookie } });
    const html = await adminPage.text();
    const m = html.match(/adminToken\s*=\s*['"]([a-f0-9]{64})['"]/);
    assert(m, 'admin token not found in page');
    const adminToken = m[1];
    console.log('1. admin token acquired');

    // 2. admin socket
    const adminSocket = await connect();
    const auth = await emitAck(adminSocket, 'admin_authenticate', { token: adminToken });
    assert(auth && auth.success, 'admin_authenticate failed: ' + JSON.stringify(auth));
    console.log('2. admin socket authenticated');

    const liveChats = [];
    adminSocket.on('adminRoomChat', p => liveChats.push(p));

    // 3. two players create/join a room
    const pa = { id: randomUUID(), socket: await connect() };
    const pb = { id: randomUUID(), socket: await connect() };
    pa.socket.emit('initPlayer', pa.id);
    pb.socket.emit('initPlayer', pb.id);

    const created = await emitAck(pa.socket, 'createRoom', {
        playerId: pa.id, name: `AdminChatSmoke ${Date.now()}`,
        gameMode: 'insider', maxPlayers: 8, roundTime: 60
    });
    assert(created && created.success, 'createRoom failed: ' + JSON.stringify(created));
    const roomId = created.roomId;
    pa.socket.emit('setRoom', { roomId, playerId: pa.id });

    const joined = await emitAck(pb.socket, 'joinRoom', { roomId, playerId: pb.id });
    assert(joined && joined.success, 'joinRoom failed');
    pb.socket.emit('setRoom', { roomId, playerId: pb.id });
    await new Promise(r => setTimeout(r, 600));
    console.log('3. room created + joined:', roomId);

    // 4. players chat (including an XSS-ish payload)
    pa.socket.emit('sendMessage', { message: 'สวัสดีทุกคน' });
    await new Promise(r => setTimeout(r, 200));
    pb.socket.emit('sendMessage', { message: 'ระวัง <script>alert(1)</script> & "quotes"' });
    await new Promise(r => setTimeout(r, 800));

    // 5. live feed check
    const liveForRoom = liveChats.filter(c => c.roomId === roomId);
    console.log('4. live adminRoomChat events for room:', liveForRoom.length);
    assert(liveForRoom.some(c => c.message === 'สวัสดีทุกคน'), 'live feed missing player-a message');
    const xssLive = liveForRoom.find(c => c.messageType === 'player' && c.playerId === pb.id);
    assert(xssLive, 'live feed missing player-b message');
    console.log('   player-b stored as:', JSON.stringify(xssLive.message));
    assert(!xssLive.message.includes('<script>'), 'raw <script> reached admin feed');
    assert(liveForRoom.every(c => c.channel === 'public'), 'unexpected channel on insider room');
    await emitAck(pa.socket, 'updateRoom', { roundTime: 90 });
    await new Promise(r => setTimeout(r, 500));
    assert(liveChats.some(c => c.roomId === roomId && c.playerName === 'System'), 'system messages not mirrored to admin');

    // 6. history via admin_getRoomDetails
    const details = await emitAck(adminSocket, 'admin_getRoomDetails', { roomId });
    assert(details && details.success, 'admin_getRoomDetails failed');
    const history = details.room.chatHistory;
    assert(Array.isArray(history) && history.length > 0, 'chatHistory missing/empty');
    assert(details.room.gameMode === 'insider', 'gameMode missing: ' + details.room.gameMode);
    assert(history.every(h => h.channel), 'entry missing channel tag');
    assert(history.some(h => h.message === 'สวัสดีทุกคน'), 'history missing player-a message');
    const ids = history.map(h => Number(String(h.messageId).replace(/\D/g, '')));
    assert(ids.every((v, i) => i === 0 || ids[i - 1] <= v), 'history not sorted by messageId');
    console.log('5. chatHistory entries:', history.length, '| sorted ✓ | channel-tagged ✓');
    history.slice(-4).forEach(h => console.log(`   [${h.channel}/${h.messageType}] ${h.displayName}: ${h.message}`));

    // 7. non-admin socket must not receive the feed
    const outsider = await connect();
    let leaked = false;
    outsider.on('adminRoomChat', () => { leaked = true; });
    pa.socket.emit('sendMessage', { message: 'ทดสอบรั่ว' });
    await new Promise(r => setTimeout(r, 600));
    assert(!leaked, 'adminRoomChat leaked to non-admin socket');
    console.log('6. non-admin socket received no adminRoomChat ✓');

    [adminSocket, pa.socket, pb.socket, outsider].forEach(s => s.close());
    console.log('\n✅ ALL CHECKS PASSED');
    process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
