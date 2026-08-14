/**
 * เทสตรรกะเก้าเก 3 ใบ + สองโหมด (ไม่ต้องมีเซิร์ฟเวอร์)
 * รัน: node scripts/smoke-poker-engine.js
 */

const { poker5, poker4 } = require('../games/pokerEngine');
const hands = require('../games/pokerHands');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}

assert(hands.buildDeck().length === 52, 'เด็คต้องมี 52 ใบ');
assert(hands.describeCard('AS').image.includes('/assets/games/poker/as.svg'), 'เอซโพดำต้องชี้รูป as.svg');
assert(hands.describeCard('10H').image.includes('10h.svg'), '10 โพแดงต้องชี้รูป 10h.svg');

const trips3 = hands.evaluateThree(['3S', '3H', '3D']);
const tripsA = hands.evaluateThree(['AS', 'AH', 'AD']);
const sf = hands.evaluateThree(['9H', '10H', 'JH']);
const sean = hands.evaluateThree(['JH', 'QS', 'KD']);
const jqkFlush = hands.evaluateThree(['JH', 'QH', 'KH']);
const straight = hands.evaluateThree(['5S', '6H', '7D']);
const qka = hands.evaluateThree(['QS', 'KH', 'AD']);
const wheel = hands.evaluateThree(['AS', '2H', '3D']);
const flush = hands.evaluateThree(['2H', '9H', 'KH']);
const point9 = hands.evaluateThree(['AS', '8D', 'KC']);
const point8 = hands.evaluateThree(['AS', '7D', 'KC']);
const tenJQ = hands.evaluateThree(['10S', 'JH', 'QD']);

assert(trips3.categoryName === 'ตอง', 'ตอง 3');
assert(tripsA.categoryName === 'ตอง', 'ตอง A');
assert(trips3.score > tripsA.score, 'ตอง 3 ต้องชนะตอง A');
assert(sf.categoryName === 'เรียงสี', 'เรียงสี');
assert(sean.categoryName === 'เซียน', 'เซียน JQK ดอกปน');
assert(jqkFlush.categoryName === 'เรียงสี', 'J-Q-K ดอกเดียวกันเป็นเรียงสี');
assert(straight.categoryName === 'เรียง', 'เรียง');
assert(qka.categoryName === 'เรียง', 'Q-K-A เป็นเรียงสูงสุด');
assert(wheel.categoryName === 'แต้ม', 'A-2-3 ไม่ใช่เรียง');
assert(flush.categoryName === 'สี', 'สี');
assert(point9.categoryName === 'แต้ม', 'แต้ม');
assert(point9.point === 9, 'A+8+K = แต้ม 9');
assert(tenJQ.categoryName === 'เรียง', '10-J-Q เป็นเรียง ไม่ใช่เซียน');
assert(tripsA.score > sf.score, 'ตองชนะเรียงสี');
assert(sf.score > sean.score, 'เรียงสีชนะเซียน');
assert(sean.score > straight.score, 'เซียนชนะเรียง');
assert(sean.score > qka.score, 'เซียนชนะเรียง QKA');
assert(qka.score > straight.score, 'QKA ชนะเรียง 5-6-7');
assert(straight.score > flush.score, 'เรียงชนะสี');
assert(flush.score > point9.score, 'สีชนะแต้ม');
assert(point9.score > point8.score, 'แต้ม 9 ชนะแต้ม 8');
assert(trips3.title.indexOf('ตอง') === 0, 'ชื่อมือตอง');
assert(hands.rankGuideForClient().length === 6, 'แรงก์ 6 แถว');
assert(hands.rankGuideForClient().map(row => row.name).join('|') === 'ตอง|เรียงสี|เซียน|เรียง|สี|แต้ม', 'ชื่อแรงก์เก้าเก');

const two = hands.evaluateHand(['AS', '8H']);
assert(two.pending, 'สองใบยังไม่วัดจริง');
assert(two.point === 9, 'A+8 = แต้ม 9 รอใบที่ 3');

const spadeFlush = hands.evaluateThree(['2S', '5S', '9S']);
const heartFlush = hands.evaluateThree(['AH', 'KH', '9H']);
assert(spadeFlush.score > heartFlush.score, 'สีเทียบดอกก่อน ♠ ชนะ ♥');

function makeRoom(engine, count = 3, ante = 500) {
    const players = Array.from({ length: count }, (_, i) => ({
        playerId: 'p' + i,
        playerName: 'ผู้เล่น' + i,
        color: '#fff',
        avatar: '👤',
        socketId: 's' + i
    }));
    const room = {
        roomId: 'ptest',
        name: 'PokerTest',
        players,
        settings: { gameMode: engine.id, pokerTableType: 'fun', pokerAnte: ante },
        gameState: engine.createInitialState()
    };
    engine.startGame(room);
    return room;
}

function discardTwo(player) {
    return player.hand.slice(0, 2);
}

const five = makeRoom(poker5, 3);
assert(five.gameState.phase === 'select', 'ไพ่ 5 ใบต้องเริ่มที่ทิ้งไพ่');
assert(five.gameState.players.every(p => p.hand.length === 5), 'คนละ 5 ใบ');
const fiveHint = poker5.buildClientState(five, five.gameState.players[0].playerId);
assert(fiveHint.liveHand && fiveHint.liveHand.cards.length === 3, 'ห้าใบเกตอนเลือกต้องใบ้ใบที่จะเก็บ 3 ใบ');
assert(five.gameState.pot === 1500, 'แอนเต 500 x 3');
assert(five.gameState.players[0].stack === 9500, 'เริ่ม 10,000 แล้ววางกอง 500');
const p0 = five.gameState.players[0];
const keep = hands.bestThreeFrom(p0.hand).cards;
const dump = p0.hand.filter(id => !keep.includes(id));
poker5.submitSelect(five, p0.playerId, dump);
assert(p0.ready, 'ทิ้งแล้วต้อง ready');
assert(p0.kept.length === 3, 'เหลือ 3 ใบ');
assert(p0.discarded.length === 2, 'ทิ้ง 2 ใบ');
assert(five.gameState.phase === 'select', 'รอคนอื่นทิ้ง');

five.gameState.phaseEndsAt = Date.now() - 1;
poker5.autoResolvePhase(five);
assert(five.gameState.phase === 'bet', 'ทิ้งครบต้องเข้าเดิมพัน ไม่เปิดวัดทันที');
assert(five.gameState.players.every(p => p.kept.length === 3), 'ทุกคนเหลือ 3 ใบ');
const fiveBetView = poker5.buildClientState(five, p0.playerId);
assert(fiveBetView.players.every(p => p.folded || p.handCount === 3), 'ทิ้งแล้วมือคนอื่นต้องเหลือ 3 ใบ');

const betFive = five.gameState.players.find(p => p.playerId === five.gameState.toActPlayerId);
poker5.submitBet(five, betFive.playerId, 'check');
let guard = 0;
while (five.gameState.phase === 'bet' && guard < 20) {
    const actor = five.gameState.players.find(p => p.playerId === five.gameState.toActPlayerId);
    poker5.submitBet(five, actor.playerId, 'check');
    guard += 1;
}
assert(five.gameState.phase === 'reveal' || five.gameState.phase === 'between', 'ผ่านครบต้องเปิดวัด');
assert(five.gameState.lastResult?.show?.length === 3, 'ต้องเปิดมือทุกคน');
assert(five.gameState.lastResult.show.every(row => row.cards.length === 3), 'ห้าใบวัด 3 ใบ ไม่แจกเพิ่ม');
assert(five.gameState.lastResult.show.every(row => row.cards[0].image), 'ไพ่ที่เปิดต้องมีรูป');

const four = makeRoom(poker4, 2);
assert(four.gameState.players.every(p => p.hand.length === 4), 'คนละ 4 ใบ');
const fourHint = poker4.buildClientState(four, four.gameState.players[0].playerId);
assert(fourHint.liveHand && fourHint.liveHand.cards.length === 2, 'สี่ใบเกตอนเลือกต้องใบ้ใบที่จะเก็บ 2 ใบ');
const a = four.gameState.players[0];
const b = four.gameState.players[1];
poker4.submitSelect(four, a.playerId, discardTwo(a));
poker4.submitSelect(four, b.playerId, discardTwo(b));
assert(four.gameState.phase === 'bet', 'ทิ้งครบต้องเข้าเดิมพัน ไม่ใช่จั่วจ่าย');
assert(a.kept.length === 2, 'เหลือ 2 ใบก่อนได้ใบที่ 3');
assert(!a.upCard, 'ยังไม่แจกใบที่ 3 ตอนเดิมพัน');

const first = four.gameState.players.find(p => p.playerId === four.gameState.toActPlayerId);
const second = four.gameState.players.find(p => p.playerId !== first.playerId);
poker4.submitBet(four, first.playerId, 'check');
poker4.submitBet(four, second.playerId, 'check');
assert(four.gameState.phase === 'deal3' || four.gameState.phase === 'reveal' || four.gameState.phase === 'between', 'เดิมพันจบต้องแจกใบ 3 หรือเปิดวัด');
if (four.gameState.phase === 'deal3') {
    assert(a.upCard && b.upCard, 'ใบที่ 3 ต้องหงายให้คนที่ไม่หมอบ');
    assert(a.kept.length === 3 && b.kept.length === 3, 'ได้ใบที่ 3 ฟรีจนครบ 3 ใบ');
    four.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(four);
}
assert(four.gameState.lastResult, 'ต้องเปิดวัดหลังใบที่ 3');
const fourView = poker4.buildClientState(four, a.playerId);
assert(fourView.fx.some(f => f.kind === 'deal3'), 'สี่ใบเกต้องมีแอนิเมชันจั่วใบ 3');
assert(fourView.fx.some(f => f.kind === 'deal3' && Array.isArray(f.ups) && f.ups.length === 2), 'แอนิเมชันใบ 3 ต้องมีรูปไพ่หงาย');
assert(fourView.players.every(p => p.revealed && p.revealed.length === 3), 'สี่ใบเกเปิดไพ่คนละ 3 ใบ');
const aShow = four.gameState.lastResult.show.find(row => row.playerId === a.playerId);
const bShow = four.gameState.lastResult.show.find(row => row.playerId === b.playerId);
assert(aShow.cards.length === 3, 'สี่ใบเปิด 3 ใบ');
assert(bShow.cards.length === 3, 'คนที่ไม่หมอบได้ใบที่ 3 ด้วย');
assert(a.kept.length === 3 && b.kept.length === 3, 'ไม่มีใบที่ 4');

const foldRoom = makeRoom(poker4, 2);
const fa = foldRoom.gameState.players[0];
const fb = foldRoom.gameState.players[1];
poker4.submitSelect(foldRoom, fa.playerId, discardTwo(fa));
poker4.submitSelect(foldRoom, fb.playerId, discardTwo(fb));
const folder = foldRoom.gameState.players.find(p => p.playerId === foldRoom.gameState.toActPlayerId);
const survivor = foldRoom.gameState.players.find(p => p.playerId !== folder.playerId);
poker4.submitBet(foldRoom, folder.playerId, 'fold');
assert(folder.folded, 'หมอบแล้ว');
assert(!folder.upCard, 'คนหมอบไม่ได้ใบที่ 3');
assert(survivor.kept.length === 2, 'คนหมอบชนะทันที ไม่ต้องแจกใบ 3');
assert(foldRoom.gameState.lastResult.winners[0].playerId === survivor.playerId, 'คนไม่หมอบกินกอง');

const afk = makeRoom(poker5, 2);
const afkA = afk.gameState.players[0];
const afkB = afk.gameState.players[1];
poker5.submitSelect(afk, afkA.playerId, discardTwo(afkA));
poker5.submitSelect(afk, afkB.playerId, discardTwo(afkB));
assert(afkA.kept.length === 3 && afkB.kept.length === 3, 'ทิ้งแล้วต้องเหลือ 3 ใบ');
const afkView = poker5.buildClientState(afk, afkA.playerId);
assert(afkView.self.kept.length === 3, 'มือตัวเองหลังทิ้งต้องเป็นใบที่เก็บ');
assert(afkView.players.find(p => p.isSelf).handCount === 3, 'บนโต๊ะต้องโชว์ 3 ใบหลังทิ้ง');
const sleeper = afk.gameState.players.find(p => p.playerId === afk.gameState.toActPlayerId);
afk.gameState.phaseEndsAt = Date.now() - 1;
poker5.autoResolvePhase(afk);
assert(sleeper.folded, 'หมดเวลา 10 วิต้องหมอบ');

const raiseRoom = makeRoom(poker5, 2);
const ra = raiseRoom.gameState.players[0];
const rb = raiseRoom.gameState.players[1];
poker5.submitSelect(raiseRoom, ra.playerId, discardTwo(ra));
poker5.submitSelect(raiseRoom, rb.playerId, discardTwo(rb));
const opener = raiseRoom.gameState.players.find(p => p.playerId === raiseRoom.gameState.toActPlayerId);
const caller = raiseRoom.gameState.players.find(p => p.playerId !== opener.playerId);
poker5.submitBet(raiseRoom, opener.playerId, 'bet', 500);
assert(raiseRoom.gameState.currentBet === 500, 'สู้ 500');
poker5.submitBet(raiseRoom, caller.playerId, 'raise', 2000);
assert(raiseRoom.gameState.currentBet === 2000, 'เกทับเลือกยอด 2000 ได้');
poker5.submitBet(raiseRoom, opener.playerId, 'call');
assert(raiseRoom.gameState.phase === 'reveal' || raiseRoom.gameState.phase === 'between', 'ตามครบต้องเปิดวัด');
assert(raiseRoom.gameState.lastResult.pot === 5000, 'แอนเต 1000 + สู้ 500 + เกทับ 2000 + ตาม 1500');
const showView = poker5.buildClientState(raiseRoom, ra.playerId);
assert(showView.displayPot === 5000, 'เปิดไพ่ต้องโชว์กองที่กิน');
assert(showView.players.every(p => p.folded || (p.revealed && p.revealed.length === 3)), 'ทุกคนที่ไม่หมอบต้องหงาย 3 ใบ');
assert(showView.players.some(p => p.isWinner), 'ต้องมีคนชนะบนที่นั่ง');
assert(showView.players.some(p => p.showTitle), 'เปิดไพ่ต้องมีชื่อมือ');
assert(showView.fx.some(f => f.kind === 'deal'), 'ต้องมีแอนิเมชันแจกไพ่');
assert(showView.fx.some(f => f.kind === 'discard'), 'ต้องมีแอนิเมชันทิ้งไพ่');
assert(showView.fx.some(f => f.kind === 'chips'), 'ต้องมีแอนิเมชันลงชิป');
assert(showView.fx.some(f => f.kind === 'reveal'), 'ต้องมีแอนิเมชันหงายไพ่');
assert(showView.fx.some(f => f.kind === 'say'), 'ต้องมีฟองคำพูดแอ็กชัน');
assert(showView.players.some(p => p.lastSay), 'แอ็กชันต้องติดฟองที่โปรไฟล์');
assert(showView.betMs === 10000, 'ตาลงชิปมี 10 วิ');
assert((raiseRoom.gameState.players[0].committed || 0) > 0, 'ต้องนับชิปที่ลงบนโต๊ะ');

assert(poker5.maxPlayers === 10, 'สูงสุด 10 คน');
assert(poker5.minPlayers === 2, 'ต่ำสุด 2 คน');
assert(poker4.maxPlayers === 10, 'สี่ใบเกสูงสุด 10 คน');

const ten = makeRoom(poker5, 10);
assert(ten.gameState.players.length === 10, 'เริ่ม 10 คนได้');
assert(ten.gameState.players.every(p => p.hand.length === 5), '10 คนคนละ 5 ใบ');
assert(ten.gameState.pot === 5000, 'แอนเต 500 x 10');

const botRoom = makeRoom(poker5, 2);
botRoom.gameState.players[1].playerId = 'bot_smoke';
poker5.playBotTurns(botRoom);
assert(botRoom.gameState.players[1].ready, 'บอทต้องเลือกไพ่เอง');

botRoom.gameState.adminPeekIds = ['p0'];
const peeked = poker5.buildClientState(botRoom, 'p0');
assert(peeked.players[1].peekCards && peeked.players[1].peekCards.length === 3, 'บอททิ้งแล้ว /m ต้องเห็นเหลือ 3 ใบ');
assert(peeked.players[1].peekRank, 'peek ต้องมีป้ายสั้น เช่น ตอง เรียง เซียน');
assert(peeked.players[1].peekTitle, 'peek ต้องบอกมือ เช่น ตอง เรียง เซียน');
assert(peeked.players[1].peekCategory, 'peek ต้องบอกหมวดมือ เช่น ตอง สี เรียง');
const hidden = poker5.buildClientState(botRoom, 'bot_smoke');
assert(!hidden.players[0].peekHand, 'คนไม่มี peek ต้องไม่เห็นไพ่คนอื่น');
assert(!hidden.players[0].peekCards, 'คนไม่มี /m ต้องไม่เห็นไพ่คนอื่น');
assert(!hidden.players[0].peekRank, 'คนไม่มี /m ต้องไม่เห็นป้ายมือคนอื่น');

const view = poker5.buildClientState(five, five.gameState.players[0].playerId);
assert(view.cardBack, 'ต้องมีหลังไพ่');
assert(view.wallet, 'ต้องโชว์กระเป๋า');
assert(view.liveHand && view.liveHand.title, 'ต้องบอกมือปัจจุบัน');
assert(view.rankGuide && view.rankGuide.length === 6, 'ต้องมีแผงแรงก์');
assert(!view.drawFee, 'ไม่มีค่าจั่ว');

const fiveRanks = view.rankGuide.map(row => row.name).join('|');
const fourRanks = poker4.buildClientState(four, four.gameState.players[0].playerId).rankGuide.map(row => row.name).join('|');
assert(fiveRanks === fourRanks, 'ไพ่ 5 ใบกับสี่ใบเกต้องใช้แรงก์ชุดเดียวกัน');
assert(four.gameState.board.length >= 4, 'สี่ใบเกต้องหงายใบทิ้งบนกองกลางตอนเปิดวัด');

const leaveRoom = makeRoom(poker5, 3);
leaveRoom.players = leaveRoom.players.filter(player => player.playerId !== 'p2');
poker5.handlePlayerLeft(leaveRoom, 'p2');
assert(!leaveRoom.gameState.players.some(player => player.playerId === 'p2'), 'คนออกห้องต้องถูกลบจากมือ');
assert(leaveRoom.gameState.phase !== 'finished', 'เหลือ 2 คนต้องเล่นต่อ');

const lastRoom = makeRoom(poker5, 2);
lastRoom.players = lastRoom.players.filter(player => player.playerId !== 'p1');
poker5.handlePlayerLeft(lastRoom, 'p1');
assert(lastRoom.gameState.phase === 'finished', 'เหลือคนเดียวต้องจบโต๊ะ');
assert(lastRoom.gameState.lastResult, 'คนออกแล้วเหลือคนเดียวต้องมีผลมือ');
assert(lastRoom.gameState.status === 'poker_finished', 'status ต้องเป็น poker_finished');

const nextRoom = makeRoom(poker5, 2);
nextRoom.players = nextRoom.players.filter(player => player.playerId !== 'p1');
nextRoom.gameState.phase = 'between';
nextRoom.gameState.phaseEndsAt = Date.now() - 1;
poker5.autoResolvePhase(nextRoom);
assert(nextRoom.gameState.phase === 'finished', 'มือถัดไปคนไม่พอต้องจบโต๊ะ ไม่ throw');

const roomManager = require('../managers/roomManager');
const playingReveal = { gameState: { status: 'playing', phase: 'reveal', winner: { playerId: 'p0', name: 'A' } } };
assert(roomManager.isRoomGameInProgress(playingReveal), 'เปิดไพ่เก้าเกยังถือว่ากำลังเล่น');
assert(!roomManager.isRoomGameFinished(playingReveal), 'winner ต่อมือห้ามถือว่าจบโต๊ะ');
assert(roomManager.getRoomGameStatusLabel(playingReveal) === 'playing', 'รายชื่อห้องต้องโชว์กำลังเล่น');
const doneTable = { gameState: { status: 'poker_finished', phase: 'finished', winner: { playerId: 'p0', name: 'A' } } };
assert(roomManager.isRoomGameFinished(doneTable), 'poker_finished ต้องจบโต๊ะ');
assert(!roomManager.isRoomGameInProgress(doneTable), 'จบโต๊ะแล้วไม่ใช่กำลังเล่น');
assert(!roomManager.isRoomJoinable({
    players: [],
    settings: { maxPlayers: 10 },
    gameState: { status: 'playing', phase: 'reveal', winner: { playerId: 'p0', name: 'A' } }
}), 'กำลังเล่นต้องเข้าห้องใหม่ไม่ได้');

console.log(`OK ${passed} asserts`);
