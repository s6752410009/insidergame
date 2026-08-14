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

function makeRoom(playerCount = 4) {
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
        settings: { gameMode: 'liar' },
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

console.log(`smoke-liar-engine: ${passed} asserts passed`);
