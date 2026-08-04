const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
function assert(c, m) { if (!c) throw new Error(m); }
function emitAck(s, e, p, t = 15000) {
    return new Promise((res, rej) => { const id = setTimeout(() => rej(new Error('ack timeout ' + e)), t); s.emit(e, p, r => { clearTimeout(id); res(r); }); });
}
function once(s, e) { return new Promise((res, rej) => { const id = setTimeout(() => rej(new Error('timeout ' + e)), 15000); s.once(e, p => { clearTimeout(id); res(p); }); }); }
async function connect() { const s = io(BASE_URL, { transports: ['websocket'], forceNew: true, reconnection: false }); await once(s, 'connect'); return s; }

async function roomList(sock) {
    return new Promise(res => sock.emit('getRoomList', r => res(r.rooms || [])));
}

async function main() {
    const a = await connect();
    const idA = randomUUID();
    a.emit('initPlayer', idA);
    await new Promise(r => setTimeout(r, 400));

    const created = await emitAck(a.socket || a, 'createRoom', {
        playerId: idA, name: `CleanupSmoke ${Date.now()}`,
        gameMode: 'insider', maxPlayers: 8, roundTime: 60
    });
    assert(created.success, 'createRoom failed: ' + JSON.stringify(created));
    const roomId = created.roomId;

    // 1. Room ID format
    assert(/^\d{6}$/.test(roomId), `roomId is not 6 digits: ${roomId}`);
    console.log('1. roomId is 6 digits ✓ ->', roomId);

    a.emit('setRoom', { roomId, playerId: idA });
    await new Promise(r => setTimeout(r, 800));

    const probe = await connect();
    let rooms = await roomList(probe);
    assert(rooms.some(r => r.roomId === roomId), 'room not in list while occupied');
    console.log('2. room visible while occupied ✓');

    // 2. Everyone leaves (hard disconnect, no leaveRoom) -> room must be swept
    a.close();
    // grace ของห้องว่างคือ 5 นาที (local) / 10 นาที (remote) + กันห้องเพิ่งสร้างอีก 2 นาที
    // ต้องรันเซิร์ฟเวอร์ด้วย SMOKE_FAST_CLEANUP=1 ไม่งั้นเทสจะรอไม่ทัน
    if (process.env.SMOKE_FAST_CLEANUP !== '1') {
        console.warn('   ⚠️  ต้องสตาร์ท server ด้วย SMOKE_FAST_CLEANUP=1 ไม่งั้นจะ fail เพราะ grace ยาว');
    }
    console.log('3. creator disconnected, waiting for cleanup sweep (up to 130s)...');

    const deadline = Date.now() + 130000;
    let gone = false;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        rooms = await roomList(probe);
        if (!rooms.some(r => r.roomId === roomId)) { gone = true; break; }
    }
    assert(gone, 'empty waiting room was NOT cleaned up within 130s');
    console.log('4. empty waiting room removed ✓');

    probe.close();
    console.log('\n✅ ROOM CLEANUP + ID CHECKS PASSED');
    process.exit(0);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
