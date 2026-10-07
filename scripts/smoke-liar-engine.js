/**
 * เทสตรรกะโกหก (ไม่ต้องมีเซิร์ฟเวอร์)
 * รัน: node scripts/smoke-liar-engine.js
 */

const engine = require('../games/liarEngine');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}

// เทสชุดเดิมเขียนตอนยังใช้หัวใจ 3 ดวง — ตั้งห้องเป็นโหมดหัวใจ (ปืนลูกโม่อยู่ใน smoke-liar-rules.js)
function makeRoom(playerCount = 4, settings = { liarPunishment: 'lives' }) {
    const players = Array.from({ length: playerCount }, (_, i) => ({
        playerId: 'p' + i,
        playerName: 'ผู้เล่น' + i,
        color: '#fff',
        avatar: '👤',
        permission: i === 0 ? 'admin' : null
    }));
    const room = {
        roomId: 'test',
        name: 'LiarTest',
        players,
        settings: { gameMode: 'liar', ...settings },
        gameState: engine.createInitialState()
    };
    engine.startGame(room);
    return room;
}

function setTurn(room, playerId) {
    room.gameState.currentPlayerId = playerId;
    room.gameState.phase = 'turn';
    room.gameState.phaseEndsAt = Date.now() + 60000;
}

const room = makeRoom(4);
assert(room.gameState.status === 'playing', 'ต้องเริ่ม playing');
assert(room.gameState.players.length === 4, 'ต้องมี 4 คน');
assert(room.gameState.players.every(p => p.hand.length === 5), 'คนละ 5 ใบ');
assert(room.gameState.players.every(p => p.lives === 3), 'คนละ 3 ชีวิต');
assert(engine.RANKS.includes(room.gameState.targetRank), 'ต้องมีไพ่รอบนี้');
const startView = engine.buildClientState(room, room.gameState.players[0].playerId);
assert(startView.self.hand[0].image, 'ไพ่ในมือต้องมีรูป');
assert(startView.cardBack, 'ต้องมีรูปหลังไพ่');
assert((startView.fx || []).some(item => item.kind === 'deal'), 'เริ่มเกมต้องมีแอนิเมชันแจกไพ่');

const first = room.gameState.players[0];
setTurn(room, first.playerId);
engine.submitPlay(room, first.playerId, [first.hand[0]]);
assert(room.gameState.lastPlay?.count === 1, 'ลง 1 ใบแล้วต้องมี lastPlay');
assert(room.gameState.currentPlayerId !== first.playerId, 'ตาต้องไปคนถัดไป');

const truthRoom = makeRoom(3);
const target = truthRoom.gameState.targetRank;
const actor = truthRoom.gameState.players[0];
const challenger = truthRoom.gameState.players[1];
actor.hand = [target, target, 'JOKER', 'A', 'K'];
setTurn(truthRoom, actor.playerId);
engine.submitPlay(truthRoom, actor.playerId, [target, 'JOKER']);
setTurn(truthRoom, challenger.playerId);
engine.submitChallenge(truthRoom, challenger.playerId);
assert(challenger.lives === 2, 'ท้าของจริงต้องเสียชีวิตเอง');
assert(actor.lives === 3, 'คนลงของจริงไม่เสียชีวิต');
assert(truthRoom.gameState.lastPlay === null, 'ท้าแล้วต้องเปิดรอบใหม่');
assert(truthRoom.gameState.lastReveal?.truthful === true, 'lastReveal ต้องบอกว่าของจริง');

const lieRoom = makeRoom(3);
const lieTarget = lieRoom.gameState.targetRank;
const fake = engine.RANKS.find(rank => rank !== lieTarget);
const liar = lieRoom.gameState.players[0];
const caller = lieRoom.gameState.players[1];
liar.hand = [fake, fake, fake, fake, fake];
setTurn(lieRoom, liar.playerId);
engine.submitPlay(lieRoom, liar.playerId, [fake, fake]);
setTurn(lieRoom, caller.playerId);
engine.submitChallenge(lieRoom, caller.playerId);
assert(liar.lives === 2, 'โกหกแล้วโดนท้าต้องเสียชีวิต');
assert(caller.lives === 3, 'คนท้าถูกไม่เสียชีวิต');
assert(lieRoom.gameState.lastReveal?.truthful === false, 'lastReveal ต้องบอกว่าโกหก');

liar.lives = 1;
liar.alive = true;
liar.hand = [fake, fake, fake, fake, fake];
setTurn(lieRoom, liar.playerId);
lieRoom.gameState.targetRank = lieTarget;
lieRoom.gameState.lastPlay = null;
engine.submitPlay(lieRoom, liar.playerId, [fake]);
setTurn(lieRoom, caller.playerId);
engine.submitChallenge(lieRoom, caller.playerId);
assert(liar.alive === false, 'ชีวิตหมดต้องตกรอบ');
assert(liar.hand.length === 0, 'ตกรอบแล้วไพ่ต้องทิ้ง');

const winRoom = makeRoom(3);
winRoom.gameState.players[1].alive = false;
winRoom.gameState.players[1].lives = 0;
winRoom.gameState.players[2].alive = false;
winRoom.gameState.players[2].lives = 0;
winRoom.gameState.players[0].hand = ['A'];
setTurn(winRoom, winRoom.gameState.players[0].playerId);
engine.submitPlay(winRoom, winRoom.gameState.players[0].playerId, ['A']);
assert(winRoom.gameState.phase === 'finished' || winRoom.gameState.players.filter(p => p.alive).length === 1,
    'เหลือคนเดียวต้องจบได้');
engine.handlePlayerLeft(winRoom, winRoom.gameState.players[0].playerId);
assert(winRoom.gameState.status === 'liar_finished', 'คนสุดท้ายออก = จบเกม');
assert(winRoom.gameState.winner, 'ต้องมีผู้ชนะตอนจบ');

const autoRoom = makeRoom(3);
const autoActor = autoRoom.gameState.players.find(p => p.playerId === autoRoom.gameState.currentPlayerId);
autoRoom.gameState.phaseEndsAt = Date.now() - 1;
const beforeHand = autoActor.hand.length;
engine.autoResolvePhase(autoRoom);
assert(autoActor.hand.length === beforeHand - 1, 'หมดเวลาต้องลง 1 ใบให้');
assert(autoRoom.gameState.lastPlay?.count === 1, 'หมดเวลาแล้วต้องมีไพ่บนโต๊ะ');

const leftRoom = makeRoom(4);
const leaver = leftRoom.gameState.players[0];
setTurn(leftRoom, leaver.playerId);
engine.submitPlay(leftRoom, leaver.playerId, [leaver.hand[0]]);
engine.handlePlayerLeft(leftRoom, leaver.playerId);
assert(leaver.alive === false, 'ออกกลางเกมต้องตกรอบ');
assert(leftRoom.gameState.lastPlay === null, 'คนลงออกไป รอบต้องเริ่มใหม่');
assert(leftRoom.gameState.phase === 'turn', 'คนเหลือต้องเล่นต่อได้');

function countCards(room) {
    const state = room.gameState;
    let total = (state.deck || []).length + (state.discard || []).length;
    state.players.forEach(player => { total += player.hand.length; });
    if (state.lastPlay?.cards) total += state.lastPlay.cards.length;
    return total;
}

const conserveRoom = makeRoom(4);
const startCount = countCards(conserveRoom);
for (let i = 0; i < 12 && conserveRoom.gameState.phase !== 'finished'; i += 1) {
    const actor = conserveRoom.gameState.players.find(p => p.playerId === conserveRoom.gameState.currentPlayerId);
    if (!actor) break;
    if (conserveRoom.gameState.lastPlay && i % 3 === 2) {
        engine.submitChallenge(conserveRoom, actor.playerId);
    } else if (actor.hand.length) {
        engine.submitPlay(conserveRoom, actor.playerId, [actor.hand[0]]);
    } else if (conserveRoom.gameState.lastPlay) {
        engine.submitChallenge(conserveRoom, actor.playerId);
    } else {
        break;
    }
    assert(countCards(conserveRoom) === startCount, 'ไพ่ต้องไม่หายตอนลงต่อโดยไม่ท้า');
}

const emptyHand = makeRoom(3);
const emptyActor = emptyHand.gameState.players[0];
const emptyNext = emptyHand.gameState.players[1];
emptyActor.hand = [emptyHand.gameState.targetRank];
setTurn(emptyHand, emptyActor.playerId);
engine.submitPlay(emptyHand, emptyActor.playerId, [emptyActor.hand[0]]);
emptyNext.hand = [];
setTurn(emptyHand, emptyNext.playerId);
const emptyActions = engine.buildClientState(emptyHand, emptyNext.playerId).availableActions;
assert(emptyActions.canPlay === false, 'มือว่างห้ามลงต่อ');
assert(emptyActions.canChallenge === true, 'มือว่างต้องท้าได้');
assert(emptyHand.gameState.lastPlay?.count === 1, 'ไพ่บนโต๊ะต้องยังอยู่ตอนมือว่าง');

const afkRoom = makeRoom(4);
const afkStart = countCards(afkRoom);
let afkSteps = 0;
while (afkRoom.gameState.phase !== 'finished' && afkSteps < 250) {
    afkRoom.gameState.phaseEndsAt = Date.now() - 1;
    const beforeTurn = afkRoom.gameState.turnNumber;
    engine.autoResolvePhase(afkRoom);
    if (afkRoom.gameState.turnNumber === beforeTurn && afkRoom.gameState.phase !== 'finished') {
        throw new Error('AFK ค้างที่ตาเดิม');
    }
    afkSteps += 1;
}
assert(afkRoom.gameState.phase === 'finished', 'AFK ทั้งวงต้องจบเกมได้');
assert(!!afkRoom.gameState.winner, 'AFK จบแล้วต้องมีผู้ชนะ');
assert(countCards(afkRoom) === afkStart, 'AFK แล้วไพ่ต้องไม่หาย');

// ---------- UX regressions (ux/liar) ----------
{
    // หงายไพ่: client ต้องรู้ว่าใครเสียหัวใจ เหลือกี่ดวง (แผงผลค้างบนโต๊ะ + ป้าย)
    const r = makeRoom(3);
    const t = r.gameState.targetRank;
    const bad = engine.RANKS.find(rank => rank !== t);
    const [a, b] = r.gameState.players;
    a.hand = [bad, bad, bad, bad, bad];
    setTurn(r, a.playerId);
    engine.submitPlay(r, a.playerId, [bad]);
    setTurn(r, b.playerId);
    engine.submitChallenge(r, b.playerId);
    const view = engine.buildClientState(r, b.playerId);
    assert(view.lastReveal.loserId === a.playerId, 'lastReveal ต้องบอก loserId = คนโกหก');
    assert(view.lastReveal.loserLives === 2, 'lastReveal ต้องบอกหัวใจที่เหลือของคนเสีย');
    const fx = view.fx.find(item => item.kind === 'reveal');
    assert(fx && fx.loserId === a.playerId && fx.loserLives === 2, 'fx reveal ต้องมี loserId/loserLives');
    assert(fx.at > 0, 'fx ต้องมีเวลา (กันเล่นเอฟเฟกต์เก่าตอนรีเฟรช)');
    const order = view.fx.map(item => item.kind);
    assert(order.indexOf('reveal') < order.lastIndexOf('round'), 'fx: หงายไพ่ต้องมาก่อนรอบใหม่');
    assert(view.maxLives === 3, 'client ต้องรู้หัวใจเต็ม (วาด ♡ ที่เสียไป)');
    const texts = r.gameState.history.map(h => h.text).join('\n');
    assert(!/เสียชีวิต/.test(texts), 'ประวัติห้ามใช้คำว่า "เสียชีวิต" (แปลว่าตาย) — ใช้ "เสียหัวใจ"');
    assert(/เสียหัวใจ 1 ดวง เหลือ 2/.test(texts), 'ประวัติต้องบอกเสียหัวใจ เหลือกี่ดวง');
}
{
    // ลำดับตกรอบ + เหตุผล สำหรับหน้าสรุปผล
    const r = makeRoom(3);
    const t = r.gameState.targetRank;
    const bad = engine.RANKS.find(rank => rank !== t);
    const [a, b] = r.gameState.players;
    a.lives = 1;
    a.hand = [bad, bad, bad, bad, bad];
    setTurn(r, a.playerId);
    engine.submitPlay(r, a.playerId, [bad]);
    setTurn(r, b.playerId);
    engine.submitChallenge(r, b.playerId);
    const view = engine.buildClientState(r, b.playerId);
    assert(view.eliminations.length === 1 && view.eliminations[0].playerId === a.playerId, 'ต้องบันทึกคนตกรอบ');
    assert(view.eliminations[0].reason === 'caught', 'เหตุผลตกรอบต้องเป็น caught (โดนจับโกหก)');
    engine.handlePlayerLeft(r, r.gameState.players[2].playerId);
    const done = engine.buildClientState(r, b.playerId);
    assert(done.phase === 'finished' && done.eliminations.length === 2, 'ออกจากเกมก็ต้องนับในลำดับตกรอบ');
    assert(done.eliminations[1].reason === 'left', 'ออกจากเกมต้องมีเหตุผล left');
}
{
    // คนหมดเวลา (AFK) ได้เวลาสั้นลงตาถัดไป · กดเองแล้วกลับเป็นปกติ
    const r = makeRoom(3);
    const afk = r.gameState.players.find(p => p.playerId === r.gameState.currentPlayerId);
    r.gameState.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(r);
    assert(afk.idleStrikes === 1, 'หมดเวลาแล้วต้องนับ idleStrikes');
    assert(engine.buildClientState(r, afk.playerId).players.find(p => p.playerId === afk.playerId).afk === true, 'client ต้องเห็นป้าย AFK');
    // วนตาจนกลับมาที่คน AFK
    let guard = 0;
    while (r.gameState.currentPlayerId !== afk.playerId && guard < 10 && r.gameState.phase === 'turn') {
        const cur = r.gameState.players.find(p => p.playerId === r.gameState.currentPlayerId);
        engine.submitPlay(r, cur.playerId, [cur.hand[0]]);
        guard += 1;
    }
    assert(r.gameState.currentPlayerId === afk.playerId, 'ต้องวนกลับมาถึงตาคน AFK');
    {
        const left = r.gameState.phaseEndsAt - Date.now();
        assert(left <= 12500, `ตาคน AFK ต้องสั้นลง (เหลือ ${left}ms)`);
        engine.submitPlay(r, afk.playerId, [afk.hand[0]]);
        assert(afk.idleStrikes === 0, 'กดเองแล้วต้องล้าง idleStrikes');
    }
}
{
    // บอท: เล่นเองได้ · รอนานขึ้นหลังหงายไพ่ · เล่นทั้งวงจนจบ ไพ่ไม่หาย
    const players = Array.from({ length: 4 }, (_, i) => ({ playerId: 'bot_' + i, playerName: 'บอท' + i, color: '#fff', avatar: '🤖' }));
    const r = { roomId: 'bots', name: 'Bots', players, settings: { gameMode: 'liar', liarPunishment: 'lives' }, gameState: engine.createInitialState() };
    engine.startGame(r);
    assert(engine.botNeedsTurn(r), 'ตาบอทต้อง botNeedsTurn');
    const normal = engine.botDelay(r, r.gameState.turnStartedAt);
    assert(normal >= 1000 && normal <= 3000, `บอทคิด 1–3 วิ (ได้ ${normal})`);
    assert(engine.isBotId('bot_x') && !engine.isBotId('p1'), 'isBotId');
    const total = countCards(r);
    let steps = 0;
    let sawReveal = false;
    while (r.gameState.phase !== 'finished' && steps < 400) {
        if (!r.gameState.lastPlay && r.gameState.lastReveal && !sawReveal) {
            sawReveal = true;
            const after = engine.botDelay(r, r.gameState.turnStartedAt);
            assert(after > normal, `หลังหงายไพ่บอทต้องรอนานขึ้น (${after} vs ${normal})`);
        }
        assert(engine.playBotTurn(r), 'บอทต้องเล่นได้ทุกตา');
        assert(countCards(r) === total, 'บอทเล่นแล้วไพ่ต้องไม่หาย');
        steps += 1;
    }
    assert(r.gameState.phase === 'finished' && r.gameState.winner, 'บอทล้วนต้องเล่นจนจบ');
    assert(sawReveal, 'บอทต้องท้ากันบ้าง');
    const humanRoom = makeRoom(3);
    assert(!engine.botNeedsTurn(humanRoom), 'ตาคนจริง บอทห้ามเล่นแทน');
    assert(engine.playBotTurn(humanRoom) === false, 'playBotTurn ต้องไม่ทำอะไรในตาคนจริง');
}

console.log(`smoke-liar-engine: ${passed} asserts passed`);
