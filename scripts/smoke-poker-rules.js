/**
 * เทสกติกาเก้าเกตามวงไทย (rules-fidelity) — ไม่ต้องมีเซิร์ฟเวอร์
 * - A-2-3 เป็นเรียงเล็กสุด, Q-K-A ใหญ่สุด, K-A-2 ไม่ใช่เรียง
 * - ตอง 3 > ตอง A > ตอง K > … > ตอง 4 > ตอง 2
 * - เซียนเท่ากัน: ดูใบใหญ่สุด แล้วดูดอกของใบนั้น · ไม่มีเสมอ (ไพ่คนละใบ)
 * - สี่ใบเก: ลงชิป 2 รอบ (ก่อน/หลังใบที่ 3) · ใบที่ 3 คว่ำไม่รั่วให้คนอื่น · ตั้งหงายได้
 * - หมดเวลา: ผ่านให้ถ้าผ่านได้ฟรี · ต้องตามถึงหมอบ
 * - เล่นสุ่มหลายมือ (คน+บอท) ชิปรวมต้องคงที่
 * รัน: node scripts/smoke-poker-rules.js
 */

const { poker5, poker4 } = require('../games/pokerEngine');
const hands = require('../games/pokerHands');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error(msg);
    passed += 1;
}
const ev = ids => hands.evaluateThree(ids);
// state ที่ส่งให้คน — ตัดตัวอย่างแผงแรงก์ (รูปไพ่ตัวอย่างคงที่) ออกก่อนหาไพ่รั่ว
const secretScan = view => JSON.stringify({ ...view, rankGuide: null });

// ---------- เรียง ----------
const wheel = ev(['AS', '2H', '3D']);
const low234 = ev(['2S', '3H', '4D']);
const qka = ev(['QS', 'KH', 'AD']);
const kA2 = ev(['KS', 'AH', '2D']);
const wheelFlush = ev(['AH', '2H', '3H']);
const sf234 = ev(['2C', '3C', '4C']);
const flushHigh = ev(['AS', 'KS', '9S']);
const point9 = ev(['AS', '8D', 'KC']);
assert(wheel.categoryName === 'เรียง', 'A-2-3 ต้องเป็นเรียง');
assert(wheel.title === 'เรียง เอซ-2-3', 'ชื่อมือ A-2-3 เรียงเอซขึ้นก่อน ได้ ' + wheel.title);
assert(low234.score > wheel.score, 'A-2-3 เป็นเรียงเล็กสุด แพ้ 2-3-4');
assert(qka.score > low234.score, 'Q-K-A ใหญ่สุด');
assert(wheel.score > flushHigh.score, 'A-2-3 (เรียง) ยังชนะสี');
assert(kA2.categoryName === 'แต้ม', 'K-A-2 ไม่วน ไม่ใช่เรียง');
assert(wheelFlush.categoryName === 'เรียงสี', 'A-2-3 ดอกเดียวกัน = เรียงสี');
assert(sf234.score > wheelFlush.score, 'เรียงสี A-2-3 เล็กสุดในเรียงสี');
assert(wheelFlush.score > ev(['JH', 'QS', 'KD']).score, 'เรียงสีเล็กสุดยังชนะเซียน');
assert(wheel.score > point9.score, 'เรียงชนะแต้ม 9');
assert(hands.bestThreeFrom(['AS', '2H', '3D', '9C', 'KH']).categoryName === 'เรียง', 'ห้าใบเลือก A-2-3 เป็นเรียงได้');
// เรียงเท่ากัน: ดูดอกของใบคุม (ใบ 3 ใน A-2-3)
assert(ev(['AC', '2C', '3S']).score > ev(['AS', '2S', '3H']).score, 'A-2-3 เท่ากัน ดูดอกใบ 3 (♠ ชนะ ♥)');

// ---------- ตอง ----------
const tripsOrder = ['3', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '2'];
for (let i = 0; i < tripsOrder.length - 1; i += 1) {
    const hi = ev([tripsOrder[i] + 'S', tripsOrder[i] + 'H', tripsOrder[i] + 'D']);
    const lo = ev([tripsOrder[i + 1] + 'S', tripsOrder[i + 1] + 'H', tripsOrder[i + 1] + 'D']);
    assert(hi.score > lo.score, `ตอง ${tripsOrder[i]} ต้องชนะตอง ${tripsOrder[i + 1]}`);
}
assert(ev(['2S', '2H', '2D']).score > ev(['QS', 'KS', 'AS']).score, 'ตอง 2 (เล็กสุด) ยังชนะเรียงสีใหญ่สุด');

// ---------- เซียน ----------
const seanKhQJ = ev(['KH', 'QC', 'JD']);
const seanKsJJ = ev(['KS', 'JH', 'JC']);
assert(seanKhQJ.categoryName === 'เซียน' && seanKsJJ.categoryName === 'เซียน', 'J/Q/K ล้วน (ซ้ำได้) = เซียน');
assert(seanKsJJ.score > seanKhQJ.score, 'เซียนเท่ากันที่ K → ดูดอก K (♠ ชนะ ♥) ไม่ดูใบรอง');
assert(ev(['KD', 'JH', 'JC']).score > ev(['QS', 'QH', 'JD']).score, 'เซียน: ใบใหญ่สุด K ชนะ Q ก่อนดูดอก');
assert(ev(['QS', 'QH', 'KD']).categoryName === 'เซียน', 'Q Q K = เซียน');

// ---------- สี / แต้ม เทียบดอก ----------
assert(ev(['2S', '5S', '9S']).score > ev(['AH', 'KH', '9H']).score, 'สี: ดูดอกก่อน ♠ ชนะ ♥');
assert(ev(['9S', '3S', '2S']).score > ev(['8S', '7S', '4S']).score, 'สีดอกเดียวกัน ดูใบใหญ่สุด');
assert(ev(['KS', '5H', '4D']).score > ev(['KH', '6C', '3D']).score, 'แต้ม 9 เท่ากัน ใบใหญ่ K เท่ากัน → ดูดอก K');

// ---------- ไม่มีเสมอ: ไพ่คนละใบ คะแนนต้องไม่เท่ากัน ----------
let ties = 0;
for (let i = 0; i < 20000; i += 1) {
    const deck = hands.shuffle(hands.buildDeck());
    if (ev(deck.slice(0, 3)).score === ev(deck.slice(3, 6)).score) ties += 1;
}
assert(ties === 0, 'สุ่ม 20,000 คู่ต้องไม่เสมอเลย ได้ ' + ties);

// ---------- ห้องทดสอบ ----------
function makeRoom(engine, count, opts) {
    const options = opts || {};
    const players = Array.from({ length: count }, (_, i) => ({
        playerId: (options.bots ? 'bot_' : 'p') + i,
        playerName: 'ผู้เล่น' + i,
        color: '#fff',
        avatar: '👤',
        socketId: 's' + i
    }));
    const room = {
        roomId: 'rules',
        name: 'Rules',
        players,
        settings: { gameMode: engine.id, pokerTableType: 'fun', pokerAnte: 500, pokerThirdCard: options.thirdCard },
        gameState: engine.createInitialState()
    };
    engine.startGame(room);
    return room;
}
const actor = room => room.gameState.players.find(p => p.playerId === room.gameState.toActPlayerId);
function discardAll(engine, room) {
    room.gameState.players.forEach(p => engine.submitSelect(room, p.playerId, p.hand.slice(0, 2)));
}

// ---------- สี่ใบเก: ใบที่ 3 คว่ำ (ค่าเริ่มต้น) ----------
{
    const room = makeRoom(poker4, 3);
    assert(room.gameState.thirdCard === 'down', 'ค่าเริ่มต้นใบที่ 3 = คว่ำ');
    discardAll(poker4, room);
    assert(room.gameState.street === 1, 'รอบแรก');
    poker4.submitBet(room, actor(room).playerId, 'bet', 500);
    poker4.submitBet(room, actor(room).playerId, 'call');
    poker4.submitBet(room, actor(room).playerId, 'fold');
    assert(room.gameState.phase === 'deal3', 'รอบแรกจบ → แจกใบที่ 3');
    const folded = room.gameState.players.find(p => p.folded);
    assert(!folded.upCard, 'คนหมอบไม่ได้ใบที่ 3');
    const [x, y] = room.gameState.players.filter(p => !p.folded);
    const view = poker4.buildClientState(room, x.playerId);
    const seatY = view.players.find(p => p.playerId === y.playerId);
    assert(!seatY.upCard, 'ใบที่ 3 คว่ำ: คนอื่นต้องไม่เห็นใบที่ 3 ของ y');
    assert(view.self.upCard && view.self.upCard.id === x.upCard, 'ตัวเองเห็นใบที่ 3 ของตัวเอง');
    const fx3 = view.fx.find(f => f.kind === 'deal3');
    assert(fx3 && fx3.ups.find(r => r.playerId === y.playerId).card === null, 'fx แจกใบ 3 ห้ามมีรูปไพ่คนอื่น');
    assert(fx3.ups.find(r => r.playerId === x.playerId).card.id === x.upCard, 'fx แจกใบ 3 มีรูปใบตัวเอง');
    assert(!secretScan(view).includes('"id":"' + y.upCard + '"'), 'ทั้ง state ของ x ต้องไม่มีใบที่ 3 ของ y');
    assert(view.players.find(p => p.playerId === folded.playerId).handCount === 0, 'คนหมอบไม่มีไพ่บนโต๊ะ');
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    assert(room.gameState.phase === 'bet' && room.gameState.street === 2, 'แจกใบ 3 แล้วลงชิปรอบสอง');
    const v2 = poker4.buildClientState(room, x.playerId);
    assert(!v2.players.find(p => p.playerId === y.playerId).upCard, 'รอบสอง (คว่ำ) ยังไม่เห็นใบ 3 คนอื่น');
    assert(v2.players.find(p => p.playerId === y.playerId).handCount === 3, 'รอบสองบนโต๊ะโชว์ 3 ใบคว่ำ');
    assert(v2.liveHand && v2.liveHand.cards.length === 3 && v2.liveHand.categoryName !== 'รอใบที่ 3', 'รอบสองมือตัวเองครบ 3 ใบ');
    assert(v2.betRounds === 2 && v2.street === 2, 'ส่ง street/betRounds ให้หน้าจอ');
    const potBefore = room.gameState.pot;
    const first = actor(room);
    poker4.submitBet(room, first.playerId, 'bet', 1000);
    assert(room.gameState.pot === potBefore + 1000, 'รอบสองสู้เข้ากองได้');
    const second = actor(room);
    assert(second && second !== first, 'ตาถัดไป');
    poker4.submitBet(room, second.playerId, 'fold');
    assert(room.gameState.lastResult.winners[0].playerId === first.playerId, 'รอบสองหมอบ → คนสู้กินกอง');
    const foldedView = poker4.buildClientState(room, first.playerId);
    assert(!foldedView.players.find(p => p.playerId === second.playerId).upCard, 'คนหมอบรอบสอง: ใบที่ 3 คว่ำของเขาต้องไม่ถูกเปิด');
    assert(!secretScan(foldedView).includes('"id":"' + second.upCard + '"'), 'คนหมอบรอบสอง: ห้ามมีใบที่ 3 ใน state ของคนอื่น');
    assert(room.gameState.lastResult.pot === 1500 + 1000, 'สู้รอบสอง 1000 ไม่มีใครตามต้องคืน กอง = ค่าต๋ง 1500 + รอบแรก 1000');
}

// ---------- สี่ใบเก: ใบที่ 3 หงาย (ตั้งค่าห้อง) ----------
{
    const room = makeRoom(poker4, 2, { thirdCard: 'up' });
    assert(room.gameState.thirdCard === 'up', 'ตั้งห้องหงายใบที่ 3');
    discardAll(poker4, room);
    poker4.submitBet(room, actor(room).playerId, 'check');
    poker4.submitBet(room, actor(room).playerId, 'check');
    const [x, y] = room.gameState.players;
    const view = poker4.buildClientState(room, x.playerId);
    assert(view.players.find(p => p.playerId === y.playerId).upCard.id === y.upCard, 'หงาย: เห็นใบที่ 3 คนอื่นตอนแจก');
    assert(view.fx.find(f => f.kind === 'deal3').ups.every(r => r.card), 'หงาย: fx มีรูปทุกใบ');
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    const v2 = poker4.buildClientState(room, x.playerId);
    assert(v2.players.find(p => p.playerId === y.playerId).upCard.id === y.upCard, 'หงาย: รอบสองยังเห็นใบที่ 3');
    const hole = y.kept.filter(id => id !== y.upCard);
    hole.forEach(id => assert(!secretScan(v2).includes('"id":"' + id + '"'), 'หงาย: ไพ่ 2 ใบแรกของคนอื่นยังเป็นความลับ'));
}

// ---------- หมดหน้าตักรอบแรก: ข้ามรอบสอง แจกใบ 3 แล้วเปิดเลย ----------
{
    const room = makeRoom(poker4, 2);
    discardAll(poker4, room);
    const a = actor(room);
    poker4.submitBet(room, a.playerId, 'allin');
    poker4.submitBet(room, actor(room).playerId, 'call');
    assert(room.gameState.phase === 'deal3', 'หมดหน้าตักแล้วยังได้ใบที่ 3');
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    assert(room.gameState.lastResult && room.gameState.lastResult.show.length === 2, 'ไม่มีใครลงชิปได้ → เปิดวัดเลย ไม่ค้างรอบสอง');
    assert(room.gameState.lastResult.show.every(r => r.cards.length === 3), 'วัด 3 ใบ');
    assert(room.gameState.players.reduce((s, p) => s + p.stack, 0) === 20000, 'หมดหน้าตักแล้วชิปรวมยังครบ 20,000');
}

// ---------- ไพ่ 5 ใบ ยังลงชิปรอบเดียว ----------
{
    const room = makeRoom(poker5, 2);
    discardAll(poker5, room);
    poker5.submitBet(room, actor(room).playerId, 'check');
    poker5.submitBet(room, actor(room).playerId, 'check');
    assert(room.gameState.lastResult, 'ไพ่ 5 ใบผ่านครบรอบเดียวเปิดเลย');
    assert(poker5.buildClientState(room, 'p0').betRounds === 1, 'ไพ่ 5 ใบ betRounds = 1');
}

// ---------- หมดเวลา: ผ่านได้ฟรี = ผ่าน · ต้องตาม = หมอบ (ทั้งสองโหมด รวมรอบสอง) ----------
{
    const room = makeRoom(poker4, 2);
    discardAll(poker4, room);
    const sleeper = actor(room);
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    assert(!sleeper.folded && sleeper.lastSay === 'ผ่าน', 'หมดเวลารอบแรกผ่านได้ฟรี = ผ่าน');
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    assert(room.gameState.phase === 'deal3', 'หมดเวลาทั้งคู่ = ผ่านทั้งคู่ ไปใบที่ 3');
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    const bettor = actor(room);
    poker4.submitBet(room, bettor.playerId, 'bet', 500);
    const facing = actor(room);
    room.gameState.phaseEndsAt = Date.now() - 1;
    poker4.autoResolvePhase(room);
    assert(facing.folded, 'หมดเวลารอบสองตอนต้องตาม = หมอบ');
    assert(room.gameState.lastResult.winners[0].playerId === bettor.playerId, 'คนสู้กินกอง');
}

// ---------- บอทเล่นกันเองหลายมือ: ไม่ error, ชิปรวมคงที่, ทุกมือจบ ----------
function botMarathon(engine, seats, handsToPlay, thirdCard) {
    const room = makeRoom(engine, seats, { bots: true, thirdCard });
    const total = () => room.gameState.players.reduce((s, p) => s + p.stack, 0) + (Number(room.gameState.pot) || 0);
    let finished = 0;
    let streetTwoBets = 0;
    let guard = 0;
    while (finished < handsToPlay && guard < handsToPlay * 200) {
        guard += 1;
        const state = room.gameState;
        if (state.phase === 'finished') break;
        // เล่นสนุก: ชิปไม่พอจะเติม 10,000 ตอนเริ่มมือ — วัดยอดคงที่ภายในมือ
        const before = total();
        if (state.phase === 'select' || state.phase === 'bet') {
            if (state.phase === 'bet' && state.street === 2 && state.currentBet > 0) streetTwoBets += 1;
            const acted = engine.playBotTurns(room);
            if (!acted) {
                state.phaseEndsAt = Date.now() - 1;
                engine.autoResolvePhase(room);
            }
        } else if (state.phase === 'deal3' || state.phase === 'reveal') {
            state.phaseEndsAt = Date.now() - 1;
            engine.autoResolvePhase(room);
        } else if (state.phase === 'between') {
            finished += 1;
            engine.nextHand(room);
            continue;
        }
        const after = total();
        assert(after === before, `${engine.id}: ชิปรวมต้องคงที่ในมือ ${before} → ${after} (เฟส ${state.phase})`);
        if (room.gameState.phase === 'reveal' && room.gameState.lastResult) {
            assert(room.gameState.pot === 0, 'จ่ายกองแล้ว pot = 0');
            room.gameState.players.forEach(p => assert(p.stack >= 0, 'ชิปติดลบไม่ได้'));
        }
    }
    assert(finished >= handsToPlay, `${engine.id}: บอทต้องเล่นจบ ${handsToPlay} มือ ได้ ${finished}`);
    return { streetTwoBets };
}
botMarathon(poker5, 6, 150);
const down = botMarathon(poker4, 5, 150, 'down');
botMarathon(poker4, 4, 80, 'up');
assert(down.streetTwoBets > 0, 'บอทต้องสู้ในรอบสองบ้าง');

console.log(`OK ${passed} asserts (poker rules)`);
