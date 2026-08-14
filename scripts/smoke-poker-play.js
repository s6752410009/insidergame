/**
 * เล่นเก้าเกทั้งตาผ่าน socket — ไพ่ 5 ใบ / สี่ใบเก / โต๊ะเงิน / เกทับเลือกยอด
 *
 * รัน: npm run smoke:poker:play
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }

async function getFreePort() {
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) {
    return new Promise(r => {
        const t = setTimeout(() => r({ __timeout: true }), 12000);
        s.emit(e, p, x => { clearTimeout(t); r(x); });
    });
}
function conn(base) {
    return new Promise(r => {
        const s = io(base, { transports: ['websocket'], forceNew: true });
        s.once('connect', () => r(s));
    });
}
function latest(player) {
    return player.states[player.states.length - 1] || null;
}
async function waitFor(players, pred, ms = 10000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        for (const player of players) {
            const state = latest(player);
            if (state && pred(state)) return state;
        }
        await delay(40);
    }
    throw new Error('timeout รอ state');
}

async function seatPlayers(base, gameMode, count, extra = {}) {
    const players = [];
    for (let i = 0; i < count; i += 1) {
        const socket = await conn(base);
        const id = randomUUID();
        socket.emit('initPlayer', id);
        const states = [];
        socket.on('pokerState', s => states.push(s));
        players.push({ socket, id, states });
    }
    await delay(400);
    const created = await ack(players[0].socket, 'createRoom', Object.assign({
        playerId: players[0].id,
        name: gameMode === 'poker4' ? 'สี่ใบเก' : 'ไพ่ 5 ใบ',
        gameMode,
        maxPlayers: 10,
        pokerAnte: 500,
        pokerTableType: 'fun'
    }, extra));
    assert(created?.success, 'สร้างห้องไม่ได้: ' + JSON.stringify(created));
    const roomId = created.roomId;
    players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
    for (const player of players.slice(1)) {
        assert((await ack(player.socket, 'joinRoom', { roomId, playerId: player.id }))?.success, 'join ไม่ได้');
        player.socket.emit('setRoom', { roomId, playerId: player.id });
    }
    await delay(400);
    return { players, roomId };
}

async function startTable(players, roomId, label) {
    const started = await ack(players[0].socket, 'startGameFromLobby', { roomId });
    assert(started?.success, (label || 'เริ่มเกม') + 'ไม่ได้: ' + JSON.stringify(started));
    players.forEach(player => player.socket.emit('poker_requestState', { roomId }));
}

function dumpTwo(state) {
    return (state.self.hand || []).slice(0, 2).map(card => card.id);
}

async function discardAll(players, roomId) {
    await waitFor(players, s => s.phase === 'select' && s.self && s.self.hand && s.self.hand.length);
    for (const player of players) {
        const state = latest(player);
        if (!state || state.self.ready) continue;
        const res = await ack(player.socket, 'poker_select', { roomId, cardIds: dumpTwo(state) });
        assert(res?.success, 'ทิ้งไพ่ไม่ได้: ' + JSON.stringify(res));
    }
}

async function playStreet(players, roomId, script) {
    const moves = script.slice();
    for (let guard = 0; guard < 30; guard += 1) {
        const snapshot = players.map(latest);
        const done = snapshot.find(state => state && (state.lastResult || state.phase === 'reveal' || state.phase === 'between' || state.phase === 'deal3'));
        if (done) return done;
        const actor = players.find(player => {
            const state = latest(player);
            return state && state.phase === 'bet' && state.toActPlayerId === player.id;
        });
        if (!actor) {
            await delay(50);
            continue;
        }
        const move = moves.shift() || { action: 'check' };
        const res = await ack(actor.socket, 'poker_bet', { roomId, action: move.action, amount: move.amount || 0 });
        assert(res?.success !== false && !res?.__timeout, 'ลงชิปไม่ได้: ' + JSON.stringify(res));
    }
    throw new Error('ลงชิปไม่จบ');
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    try {
        const five = await seatPlayers(base, 'poker5', 2);
        await startTable(five.players, five.roomId, 'เริ่มไพ่ 5 ใบ');
        await discardAll(five.players, five.roomId);
        const fiveEnd = await playStreet(five.players, five.roomId, [
            { action: 'bet', amount: 500 },
            { action: 'raise', amount: 2000 },
            { action: 'call' }
        ]);
        await waitFor(five.players, s => s.lastResult);
        const fiveResult = latest(five.players[0]).lastResult;
        assert(fiveResult.pot === 5000, 'กองไพ่ 5 ใบต้อง 5000 ได้ ' + fiveResult.pot);
        assert(fiveResult.show.every(row => row.cards.length === 3), 'ห้าใบต้องเปิด 3 ใบ');
        console.log('1. ไพ่ 5 ใบ ทั้งตา + เกทับ 2000 ✓');
        five.players.forEach(p => p.socket.close());

        const four = await seatPlayers(base, 'poker4', 2);
        await startTable(four.players, four.roomId, 'เริ่มสี่ใบเก');
        await discardAll(four.players, four.roomId);
        await playStreet(four.players, four.roomId, [
            { action: 'check' },
            { action: 'check' }
        ]);
        const fourDone = await waitFor(four.players, s => s.lastResult);
        const fourShow = fourDone.lastResult.show;
        assert(fourShow.every(row => row.cards.length === 3), 'สี่ใบเกต้องได้ใบ 3 แล้วเปิด 3');
        assert(fourShow.every(row => row.cards.length < 4), 'ห้ามมีใบที่ 4');
        console.log('2. สี่ใบเก ทั้งตา ใบ 3 หงายฟรี ไม่มีใบ 4 ✓');
        four.players.forEach(p => p.socket.close());

        const cash = await seatPlayers(base, 'poker5', 1, { pokerTableType: 'cash' });
        const added = await ack(cash.players[0].socket, 'poker_addBots', { roomId: cash.roomId, count: 1 });
        assert(added?.success && added.added === 1, 'เพิ่มบอทโต๊ะเงินไม่ได้: ' + JSON.stringify(added));
        assert((await ack(cash.players[0].socket, 'startGameFromLobby', { roomId: cash.roomId }))?.success, 'เริ่มโต๊ะเงินไม่ได้');
        cash.players.forEach(player => player.socket.emit('poker_requestState', { roomId: cash.roomId }));
        const cashState = await waitFor(cash.players, s => s.phase === 'select' && s.players && s.players.length === 2);
        const stacks = cashState.players.map(p => p.stack);
        assert(stacks[0] === stacks[1], 'ชิปบอทต้องเท่าคน หลังวางกอง ได้ ' + stacks.join(','));
        assert(stacks[0] === 500, 'หลังวางกอง 500 ต้องเหลือ 500 ได้ ' + stacks[0]);
        console.log('3. โต๊ะเงิน บอทซื้อเข้าเท่าหัวห้อง ✓');
        cash.players.forEach(p => p.socket.close());

        const bots = await seatPlayers(base, 'poker5', 1);
        assert((await ack(bots.players[0].socket, 'poker_addBots', { roomId: bots.roomId, count: 1 }))?.success, 'เพิ่มบอทไม่ได้');
        await startTable(bots.players, bots.roomId, 'เริ่มกับบอท');
        await waitFor(bots.players, s => s.phase === 'select' && s.self && s.self.hand && s.self.hand.length === 5);
        const human = bots.players[0];
        const dumped = await ack(human.socket, 'poker_select', { roomId: bots.roomId, cardIds: dumpTwo(latest(human)) });
        assert(dumped?.success, 'คนทิ้งไพ่ไม่ได้');
        for (let guard = 0; guard < 40; guard += 1) {
            const state = latest(human);
            if (state && state.lastResult) break;
            if (state && state.phase === 'bet' && state.toActPlayerId === human.id) {
                const actions = state.availableActions || {};
                const action = actions.canCheck ? 'check' : (actions.canCall ? 'call' : 'fold');
                await ack(human.socket, 'poker_bet', { roomId: bots.roomId, action });
            }
            await delay(250);
        }
        const botDone = latest(human);
        assert(botDone && botDone.lastResult, 'เล่นกับบอทต้องมีผลมือ');
        console.log('4. คน + บอท เล่นจนเปิดเทียบ ✓');
        bots.players.forEach(p => p.socket.close());

        const cycle = await seatPlayers(base, 'poker5', 2);
        const deniedEnd = await ack(cycle.players[1].socket, 'endTableSession', { roomId: cycle.roomId });
        assert(deniedEnd?.success === false, 'ลูกห้องจบเกมไม่ได้: ' + JSON.stringify(deniedEnd));
        await startTable(cycle.players, cycle.roomId, 'เริ่มรอบจบเกม');
        await waitFor(cycle.players, s => s.phase === 'select');
        const ended = await ack(cycle.players[0].socket, 'endTableSession', { roomId: cycle.roomId, playerId: cycle.players[0].id });
        assert(ended?.success !== false && !ended?.__timeout, 'หัวห้องจบเกมไม่ได้: ' + JSON.stringify(ended));
        await delay(400);
        await startTable(cycle.players, cycle.roomId, 'เริ่มใหม่หลังจบเกม');
        const restarted = await waitFor(cycle.players, s => s.phase === 'select' && s.self && s.self.hand && s.self.hand.length === 5);
        assert(restarted.handNumber === 1 || restarted.handNumber >= 1, 'เริ่มใหม่ต้องแจกมือใหม่');
        console.log('5. จบเกมแล้วเริ่มใหม่ได้ ลูกห้องจบไม่ได้ ✓');
        cycle.players.forEach(p => p.socket.close());

        const trio = await seatPlayers(base, 'poker4', 3);
        await startTable(trio.players, trio.roomId, 'เริ่มสามคนสี่ใบเก');
        await waitFor(trio.players, s => s.phase === 'select');
        const leaver = trio.players[2];
        const left = await ack(leaver.socket, 'leaveRoom', { roomId: trio.roomId });
        assert(left?.success !== false, 'ออกห้องไม่ได้: ' + JSON.stringify(left));
        leaver.socket.close();
        await delay(400);
        const stay = trio.players.slice(0, 2);
        stay.forEach(p => p.socket.emit('poker_requestState', { roomId: trio.roomId }));
        const afterLeave = await waitFor(stay, s => s.players && s.players.filter(row => !row.sittingOut).length === 2);
        assert(!afterLeave.players.some(row => row.playerId === leaver.id && !row.sittingOut), 'คนออกต้องไม่นั่งมือต่อ');
        await discardAll(stay, trio.roomId);
        await playStreet(stay, trio.roomId, [{ action: 'check' }, { action: 'check' }]);
        await waitFor(stay, s => s.lastResult);
        console.log('6. ออกกลางมือ สี่ใบเกที่เหลือเล่นจบได้ ✓');
        stay.forEach(p => p.socket.close());

        const race = await seatPlayers(base, 'poker5', 2);
        await startTable(race.players, race.roomId, 'เริ่มแข่งลงชิป');
        await discardAll(race.players, race.roomId);
        await waitFor(race.players, s => s.phase === 'bet' && s.toActPlayerId);
        const actor = race.players.find(p => latest(p).toActPlayerId === p.id);
        const other = race.players.find(p => p !== actor);
        const stealTurn = await ack(other.socket, 'poker_bet', { roomId: race.roomId, action: 'bet', amount: 500 });
        assert(stealTurn?.success === false, 'คนไม่ถึงตาต้องลงชิปไม่ได้: ' + JSON.stringify(stealTurn));
        const [first, second] = await Promise.all([
            ack(actor.socket, 'poker_bet', { roomId: race.roomId, action: 'check' }),
            ack(actor.socket, 'poker_bet', { roomId: race.roomId, action: 'check' })
        ]);
        const okCount = [first, second].filter(res => res && res.success && !res.__timeout).length;
        assert(okCount === 1, 'กดผ่านซ้ำพร้อมกันต้องสำเร็จแค่ครั้งเดียว ได้ ' + okCount + ' ' + JSON.stringify([first, second]));
        console.log('7. คนไม่ถึงตาลงชิปไม่ได้ และกดซ้ำพร้อมกันเข้าได้ครั้งเดียว ✓');
        race.players.forEach(p => p.socket.close());

        const closed = await seatPlayers(base, 'poker5', 2);
        await startTable(closed.players, closed.roomId, 'เริ่มกันเข้ากลางมือ');
        await waitFor(closed.players, s => s.phase === 'select');
        const walker = await conn(base);
        const walkerId = randomUUID();
        walker.emit('initPlayer', walkerId);
        await delay(200);
        const joinedMid = await ack(walker, 'joinRoom', { roomId: closed.roomId, playerId: walkerId });
        assert(joinedMid?.success === false, 'กำลังเล่นต้องเข้าห้องใหม่ไม่ได้: ' + JSON.stringify(joinedMid));
        walker.close();
        console.log('8. เข้าห้องกลางมือไม่ได้ ✓');
        closed.players.forEach(p => p.socket.close());

        const peek = await seatPlayers(base, 'poker5', 2);
        await startTable(peek.players, peek.roomId, 'เริ่มดูไพ่');
        await waitFor(peek.players, s => s.phase === 'select');
        const peekOn = await ack(peek.players[0].socket, 'poker_debug_peek', { roomId: peek.roomId, enabled: true });
        assert(peekOn?.success !== false, 'หัวห้องเปิด /m ไม่ได้: ' + JSON.stringify(peekOn));
        peek.players.forEach(p => p.socket.emit('poker_requestState', { roomId: peek.roomId }));
        await delay(300);
        const hostView = latest(peek.players[0]);
        const guestView = latest(peek.players[1]);
        const otherSeat = (hostView.players || []).find(row => !row.isSelf);
        const guestOther = (guestView.players || []).find(row => !row.isSelf);
        assert(hostView.debugPeek && otherSeat && otherSeat.peekCards && otherSeat.peekCards.length, 'หัวห้อง /m ต้องเห็นไพ่คนอื่น');
        assert(!guestView.debugPeek && guestOther && !guestOther.peekCards && !guestOther.peekRank, 'ลูกห้องต้องไม่เห็นไพ่คนอื่น');
        console.log('9. /m เห็นไพ่เฉพาะหัวห้อง ✓');
        peek.players.forEach(p => p.socket.close());

        const dualA = await seatPlayers(base, 'poker5', 2);
        const dualB = await seatPlayers(base, 'poker4', 2);
        await Promise.all([
            startTable(dualA.players, dualA.roomId, 'โต๊ะ A'),
            startTable(dualB.players, dualB.roomId, 'โต๊ะ B')
        ]);
        await Promise.all([
            waitFor(dualA.players, s => s.phase === 'select' && s.mode === 'poker5'),
            waitFor(dualB.players, s => s.phase === 'select' && s.mode === 'poker4')
        ]);
        await Promise.all([
            discardAll(dualA.players, dualA.roomId),
            discardAll(dualB.players, dualB.roomId)
        ]);
        await Promise.all([
            playStreet(dualA.players, dualA.roomId, [{ action: 'check' }, { action: 'check' }]),
            playStreet(dualB.players, dualB.roomId, [{ action: 'check' }, { action: 'check' }])
        ]);
        await Promise.all([
            waitFor(dualA.players, s => s.lastResult && s.lastResult.show.every(row => row.cards.length === 3)),
            waitFor(dualB.players, s => s.lastResult && s.lastResult.show.every(row => row.cards.length === 3))
        ]);
        console.log('10. สองโต๊ะ 5 ใบ + สี่ใบเก เล่นพร้อมกันจบ ✓');
        dualA.players.concat(dualB.players).forEach(p => p.socket.close());

        console.log('OK poker playthrough + audit');
    } finally {
        server.kill('SIGTERM');
    }
})().catch(err => {
    console.error('FAIL', err.message);
    process.exit(1);
});
