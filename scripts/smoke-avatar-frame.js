/**
 * ตรวจว่า avatarFrame เดินทางไปครบทุกช่องทางที่แสดงรูปผู้เล่น:
 * chat payload, roomUpdate, spyfall/werewolf state และตัว render กลางถูกโหลดในหน้าเว็บ
 */
const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
function assert(c, m) { if (!c) throw new Error(m); }
function emitAck(s, e, p, t = 20000) {
    return new Promise((res, rej) => { const id = setTimeout(() => rej(new Error('ack timeout ' + e)), t); s.emit(e, p, r => { clearTimeout(id); res(r); }); });
}
function once(s, e) { return new Promise((res, rej) => { const id = setTimeout(() => rej(new Error('timeout ' + e)), 20000); s.once(e, p => { clearTimeout(id); res(p); }); }); }
async function connect() { const s = io(BASE_URL, { transports: ['websocket'], forceNew: true, reconnection: false }); await once(s, 'connect'); return s; }

const FRAME = 'rainbow';

async function main() {
    const players = [];
    for (let i = 0; i < 4; i++) {
        const s = await connect();
        const id = randomUUID();
        s.emit('initPlayer', id);
        players.push({ id, socket: s, updates: [], chats: [], states: [] });
        s.on('roomUpdate', p => players[i].updates.push(p));
        s.on('newMessage', p => players[i].chats.push(p));
        s.on('spyfallState', p => players[i].states.push(p));
    }
    await new Promise(r => setTimeout(r, 600));

    // ตั้งกรอบให้ผู้เล่นคนแรก
    const setFrame = await fetch(`${BASE_URL}/profile/updateAvatarFrame?playerId=${players[0].id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameId: FRAME })
    });
    const frameBody = await setFrame.json().catch(() => ({}));
    assert(setFrame.ok && frameBody.success !== false, 'updateFrame failed: ' + JSON.stringify(frameBody));
    console.log('1. set frame =', FRAME);

    const created = await emitAck(players[0].socket, 'createRoom', {
        playerId: players[0].id, name: `FrameSmoke ${Date.now()}`,
        gameMode: 'spyfall', maxPlayers: 8, roundTime: 5
    });
    assert(created.success, 'createRoom failed');
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const p of players.slice(1)) {
        assert((await emitAck(p.socket, 'joinRoom', { roomId, playerId: p.id })).success, 'join failed');
        p.socket.emit('setRoom', { roomId, playerId: p.id });
    }
    await new Promise(r => setTimeout(r, 1000));

    // 2. roomUpdate ต้องมี avatarFrame
    const ru = players[1].updates[players[1].updates.length - 1];
    const me = ru.players.find(x => x.playerId === players[0].id);
    assert(me, 'player missing from roomUpdate');
    assert(me.avatarFrame === FRAME, `roomUpdate avatarFrame = ${me.avatarFrame}`);
    console.log('2. roomUpdate carries avatarFrame ✓');

    // 3. chat payload ต้องมี avatarFrame
    players[0].socket.emit('sendMessage', { message: 'กรอบมาไหม' });
    await new Promise(r => setTimeout(r, 700));
    const chat = players[1].chats.find(c => c.playerId === players[0].id);
    assert(chat, 'chat message not received');
    assert(chat.avatarFrame === FRAME, `chat avatarFrame = ${chat.avatarFrame}`);
    console.log('3. chat payload carries avatarFrame ✓');

    // 4. spyfall state ต้องมี avatarFrame ทั้ง players[] และ self
    assert((await emitAck(players[0].socket, 'startGameFromLobby', { roomId }, 30000)).success, 'start failed');
    await new Promise(r => setTimeout(r, 2500));
    for (const p of players) p.socket.emit('spyfall_requestState', { roomId, playerId: p.id });
    await new Promise(r => setTimeout(r, 1200));

    const st = players[1].states[players[1].states.length - 1];
    const target = (st.players || []).find(x => x.playerId === players[0].id);
    assert(target, 'player missing from spyfall state');
    assert(target.avatarFrame === FRAME, `spyfall players[].avatarFrame = ${target.avatarFrame}`);
    const selfState = players[0].states[players[0].states.length - 1];
    assert(selfState.self.avatarFrame !== undefined, 'spyfall self.avatarFrame missing');
    console.log('4. spyfall state carries avatarFrame (players[] + self) ✓');

    // 5. หน้าเว็บโหลดตัว render กลาง
    const boardResponse = await fetch(`${BASE_URL}/game/${roomId}?playerId=${players[0].id}`);
    const html = await boardResponse.text();
    assert(/\/static\/js\/playerAvatar\.js/.test(html), `playerAvatar.js not loaded on board (${boardResponse.status} ${boardResponse.url})`);
    assert(/\/static\/css\/playerAvatar\.css/.test(html), 'playerAvatar.css not loaded on board');
    // ใช้ playerId ที่ไม่ได้อยู่ในเกม ไม่งั้นหน้า /rooms จะพากลับเข้ากระดานแทน
    const lobbyHtml = await (await fetch(`${BASE_URL}/rooms?playerId=${randomUUID()}`)).text();
    assert(/\/static\/js\/playerAvatar\.js/.test(lobbyHtml), 'playerAvatar.js not loaded on lobby');
    console.log('5. shared avatar renderer loaded on board + lobby ✓');

    // 6. ไม่มีตาราง gradient ซ้ำหลงเหลือในหน้า
    const dupes = (lobbyHtml.match(/cd7f32 0%, #8b4513/g) || []).length;
    assert(dupes === 0, `lobby still hardcodes frame gradients (${dupes})`);
    console.log('6. no duplicated frame tables in lobby markup ✓');

    players.forEach(p => p.socket.close());
    console.log('\n✅ AVATAR FRAME CHECKS PASSED');
    process.exit(0);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
