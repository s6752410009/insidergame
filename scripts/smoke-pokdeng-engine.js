/**
 * เทสตรรกะป๊อกเด้ง (ไม่ต้องมีเซิร์ฟเวอร์)
 * รัน: node scripts/smoke-pokdeng-engine.js
 */

const engine = require('../games/pokdengEngine');
const createRuntime = require('../games/pokdengRuntime');

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed += 1;
}
function throws(fn, pattern, msg) {
    let error = null;
    try { fn(); } catch (e) { error = e; }
    assert(error, msg + ' (ต้อง throw)');
    if (pattern) assert(pattern.test(error.message), `${msg} — ข้อความ "${error.message}"`);
}

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const DECK = engine.buildDeck();
const ev = cards => engine.evaluateHand(cards);

// ================= 1) วัดมือ: เคสระบุชัด =================
{
    const e = ev(['9S', 'KH']);
    assert(e.pok && e.points === 9 && e.deng === 1 && e.label === 'ป๊อก 9', 'ป๊อก 9 ธรรมดา');
    const e2 = ev(['4H', '4D']);
    assert(e2.pok && e2.points === 8 && e2.deng === 2, 'คู่ 4 = ป๊อก 8 สองเด้ง');
    const e3 = ev(['3C', '5C']);
    assert(e3.pok && e3.points === 8 && e3.deng === 2 && /สองเด้ง/.test(e3.label), 'ดอกเดียวกัน ป๊อก 8 สองเด้ง');
    const e4 = ev(['KS', 'QS']);
    assert(!e4.pok && e4.points === 0 && e4.deng === 2 && e4.name === 'บอด', 'บอดสองเด้ง');
    const e5 = ev(['AS', '6D']);
    assert(!e5.pok && e5.points === 7 && e5.deng === 1, '7 แต้มธรรมดา');
    const e6 = ev(['10H', '10S']);
    assert(e6.points === 0 && e6.deng === 2 && !e6.pok, 'คู่ 10 = 0 แต้ม สองเด้ง');
    const t = ev(['7S', '7H', '7D']);
    assert(t.tier === engine.TIER.TONG && t.deng === 5 && t.special, 'ตอง = 5 เด้ง');
    const s1 = ev(['AS', '2H', '3D']);
    assert(s1.tier === engine.TIER.STRAIGHT && s1.deng === 3 && s1.tierValue === 3, 'A-2-3 เรียง (A ต่ำ)');
    const s2 = ev(['QS', 'KH', 'AD']);
    assert(s2.tier === engine.TIER.STRAIGHT && s2.tierValue === 14, 'Q-K-A เรียง (A สูง)');
    const s3 = ev(['KS', 'AH', '2D']);
    assert(s3.tier === engine.TIER.NORMAL, 'K-A-2 ไม่ใช่เรียง (ไม่วน)');
    const s4 = ev(['JS', 'QS', 'KS']);
    assert(s4.tier === engine.TIER.STRAIGHT && s4.deng === 3, 'J-Q-K ดอกเดียว = เรียง (สูงกว่าเซียน)');
    const s5 = ev(['JS', 'QH', 'KD']);
    assert(s5.tier === engine.TIER.STRAIGHT, 'J-Q-K ดอกผสม = เรียง');
    const sian = ev(['JS', 'JH', 'QD']);
    assert(sian.tier === engine.TIER.SIAN && sian.deng === 3 && sian.name === 'เซียน', 'J-J-Q = เซียน');
    const sian2 = ev(['KS', 'QH', 'KD']);
    assert(sian2.tier === engine.TIER.SIAN, 'K-Q-K = เซียน');
    const jjj = ev(['JS', 'JH', 'JD']);
    assert(jjj.tier === engine.TIER.TONG, 'J-J-J = ตอง ไม่ใช่เซียน');
    const flush3 = ev(['2H', '5H', '9H']);
    assert(flush3.tier === engine.TIER.NORMAL && flush3.points === 6 && flush3.deng === 3, '3 ใบดอกเดียว 6 แต้ม สามเด้ง');
    const pair3 = ev(['2H', '2S', '9D']);
    assert(pair3.deng === 1 && pair3.points === 3, '3 ใบมีคู่ ไม่มีเด้ง');
    const three8 = ev(['2H', '3S', '3D']);
    assert(!three8.pok && three8.points === 8, '3 ใบได้ 8 ไม่ใช่ป๊อก');
    throws(() => ev(['AS']), /2–3/, 'ไพ่ใบเดียวต้องผิด');
    throws(() => ev(['AS', '2S', '3S', '4S']), /2–3/, 'ไพ่ 4 ใบต้องผิด');
    throws(() => ev(['XS', '2S']), /ไพ่ไม่รู้จัก/, 'ไพ่มั่วต้องผิด');
}

// ================= 2) วัดมือ: ไล่ทุก combination =================
{
    let pok = 0; let pok9 = 0; let two2deng = 0;
    for (let i = 0; i < DECK.length; i += 1) {
        for (let j = i + 1; j < DECK.length; j += 1) {
            const e = ev([DECK[i], DECK[j]]);
            const a = DECK[i]; const b = DECK[j];
            const pair = a.slice(0, -1) === b.slice(0, -1);
            const suited = a.slice(-1) === b.slice(-1);
            assert(e.deng === ((pair || suited) ? 2 : 1), `deng 2 ใบ ${a} ${b}`);
            assert(e.pok === (e.points >= 8), `ป๊อก = 8/9 (${a} ${b})`);
            if (e.pok) pok += 1;
            if (e.pok && e.points === 9) pok9 += 1;
            if (e.deng === 2) two2deng += 1;
        }
    }
    // นับอิสระ: จำนวนคู่ที่แต้มรวม mod 10 = 8 หรือ 9
    const pointOf = r => (r === 'A' ? 1 : (['10', 'J', 'Q', 'K'].includes(r) ? 0 : Number(r)));
    let expectPok = 0; let expectPok9 = 0;
    for (let i = 0; i < DECK.length; i += 1) {
        for (let j = i + 1; j < DECK.length; j += 1) {
            const p = (pointOf(DECK[i].slice(0, -1)) + pointOf(DECK[j].slice(0, -1))) % 10;
            if (p >= 8) expectPok += 1;
            if (p === 9) expectPok9 += 1;
        }
    }
    assert(pok === expectPok && pok9 === expectPok9, `นับป๊อกตรง (${pok}/${expectPok})`);
    assert(two2deng === 13 * 6 + 4 * 78, `2 ใบสองเด้ง = คู่ 78 + ดอกเดียว 312 (${two2deng})`);

    const counts = { tong: 0, straight: 0, sian: 0, flush3: 0, normal: 0 };
    for (let i = 0; i < DECK.length; i += 1) {
        for (let j = i + 1; j < DECK.length; j += 1) {
            for (let k = j + 1; k < DECK.length; k += 1) {
                const cards = [DECK[i], DECK[j], DECK[k]];
                const e = ev(cards);
                assert(e.points === cards.reduce((s, c) => s + pointOf(c.slice(0, -1)), 0) % 10, 'แต้ม 3 ใบ');
                assert(!e.pok, '3 ใบไม่มีป๊อก');
                if (e.tier === engine.TIER.TONG) { counts.tong += 1; assert(e.deng === 5, 'ตอง 5 เด้ง'); }
                else if (e.tier === engine.TIER.STRAIGHT) { counts.straight += 1; assert(e.deng === 3, 'เรียง 3 เด้ง'); }
                else if (e.tier === engine.TIER.SIAN) { counts.sian += 1; assert(e.deng === 3, 'เซียน 3 เด้ง'); }
                else if (e.deng === 3) counts.flush3 += 1;
                else { counts.normal += 1; assert(e.deng === 1, 'ธรรมดา 1 เด้ง'); }
            }
        }
    }
    assert(counts.tong === 52, `ตอง 52 แบบ (${counts.tong})`);
    assert(counts.straight === 12 * 64, `เรียง 12 ชุด × 64 = 768 (${counts.straight})`);
    assert(counts.sian === 220 - 12 - 64, `เซียน = C(12,3) − ตอง JQK 12 − เรียง JQK 64 = 144 (${counts.sian})`);
    // 3 ใบดอกเดียว (ที่ไม่ใช่เรียง): 4 × C(13,3) − เรียงดอกเดียว 12×4
    assert(counts.flush3 === 4 * 286 - 48, `สามเด้งธรรมดา 1096 (${counts.flush3})`);
    assert(Object.values(counts).reduce((a, b) => a + b, 0) === 22100, 'รวม C(52,3)');
}

// ================= 3) เทียบมือ / ตัวคูณ =================
{
    const J = (p, d) => engine.judge(ev(p), ev(d));
    let r = J(['9S', 'KH'], ['4H', '4D']);
    assert(r.outcome === 'win' && r.multiplier === 1, 'ป๊อก 9 ชนะ ป๊อก 8 (จ่ายตามเด้งคนชนะ = 1)');
    r = J(['4H', '4D'], ['9S', 'KH']);
    assert(r.outcome === 'lose' && r.multiplier === 1, 'ป๊อก 8 สองเด้งแพ้ป๊อก 9 จ่าย 1 เท่า');
    r = J(['9S', 'KS'], ['9H', 'QD']);
    assert(r.outcome === 'push', 'ป๊อก 9 เจอป๊อก 9 = เสมอ');
    r = J(['8S', 'KS'], ['7S', '7H', '7D']);
    assert(r.outcome === 'win' && r.multiplier === 2, 'ป๊อกชนะตอง (ป๊อกดอกเดียว 2 เด้ง)');
    r = J(['2S', '2H', '2D'], ['AS', '2C', '3D']);
    assert(r.outcome === 'win' && r.multiplier === 5, 'ตองชนะเรียง 5 เด้ง');
    r = J(['AS', '2C', '3D'], ['JS', 'JH', 'QD']);
    assert(r.outcome === 'win' && r.multiplier === 3, 'เรียงชนะเซียน 3 เด้ง');
    r = J(['JS', 'JH', 'QD'], ['9S', '10H', 'KD']);
    assert(r.outcome === 'win' && r.multiplier === 3, 'เซียนชนะ 9 แต้ม 3 ใบ');
    r = J(['9S', '10H', 'KD'], ['JS', 'JH', 'QD']);
    assert(r.outcome === 'lose' && r.multiplier === 3, '9 แต้มแพ้เซียน จ่าย 3 เท่า');
    r = J(['5S', '2S'], ['3H', '4D']);
    assert(r.outcome === 'push', '7 เท่ากัน = เสมอ');
    r = J(['5S', '2S', '9S'], ['3H', '2D']);
    assert(r.outcome === 'win' && r.multiplier === 3, '6 แต้มสามเด้งชนะ 5 แต้ม ได้ 3 เท่า');
    r = J(['3H', '2D'], ['5S', '2S', '9S']);
    assert(r.outcome === 'lose' && r.multiplier === 3, '5 แต้มแพ้ 6 สามเด้งของเจ้ามือ จ่าย 3 เท่า');
    // สมมาตร: ทุกคู่สุ่ม judge(a,b) กับ judge(b,a) ต้องตรงข้ามกัน
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 4000; i += 1) {
        const pool = DECK.slice().sort(() => rnd() - 0.5);
        const a = pool.slice(0, 2 + (rnd() < 0.5 ? 1 : 0));
        const b = pool.slice(3, 5 + (rnd() < 0.5 ? 1 : 0));
        const x = engine.judge(ev(a), ev(b));
        const y = engine.judge(ev(b), ev(a));
        const flip = { win: 'lose', lose: 'win', push: 'push' };
        assert(flip[x.outcome] === y.outcome && x.multiplier === y.multiplier, 'judge ต้องสมมาตร');
        const ea = ev(a); const eb = ev(b);
        if (ea.pok && !eb.pok) assert(x.outcome === 'win', 'ป๊อกชนะทุกอย่างที่ไม่ใช่ป๊อก');
        if (x.outcome === 'win') assert(x.multiplier === ea.deng, 'จ่ายตามเด้งคนชนะ');
    }
}

// ================= helpers โต๊ะ =================
function makeRoom(n = 4, opts = {}) {
    const players = Array.from({ length: n }, (_, i) => ({
        playerId: (opts.bots && i > 0 ? 'bot_' : 'p') + i,
        playerName: 'ผู้เล่น' + i,
        color: '#fff',
        avatar: '👤',
        socketId: 's' + i
    }));
    const room = {
        roomId: 'pd-test',
        name: 'PokTest',
        admin: players[0].playerId,
        players,
        settings: { gameMode: 'pokdeng', pokdengRotateDealer: !!opts.rotate },
        gameState: engine.createInitialState()
    };
    engine.startGame(room);
    return room;
}
const gs = room => room.gameState;
const P = (room, id) => gs(room).players.find(p => p.playerId === id);
const ctx = room => ({ step: gs(room).step, phase: gs(room).phase, handNumber: gs(room).handNumber });

function conservation(room, label) {
    const total = engine.totalChips(room);
    const buyIn = engine.totalBuyIn(room);
    assert(total === buyIn, `${label}: ชิปรวม ${total} ต้องเท่าทุน ${buyIn}`);
    gs(room).players.forEach(p => assert(p.chips >= 0 && p.bet >= 0, `${label}: ชิปติดลบ ${p.name}`));
}

/** เรียงสำรับให้แจกตามต้องการ: hands = { id: [c1,c2] } (ต้องมีทุกคนที่อยู่ในมือ + เจ้ามือ), draws = [card ตามลำดับจั่ว] */
function rig(room, hands, draws = []) {
    const state = gs(room);
    const dealerId = state.dealerId;
    const order = [];
    const idx = state.players.findIndex(p => p.playerId === dealerId);
    for (let i = 1; i <= state.players.length; i += 1) {
        const p = state.players[(idx + i) % state.players.length];
        if (p.playerId !== dealerId && hands[p.playerId]) order.push(p.playerId);
    }
    order.push(dealerId);
    const seq = [];
    for (let round = 0; round < 2; round += 1) order.forEach(id => seq.push(hands[id][round]));
    seq.push(...draws);
    const used = new Set(seq);
    assert(used.size === seq.length, 'rig: ไพ่ซ้ำ');
    const rest = DECK.filter(c => !used.has(c));
    room.riggedDeck = [...rest, ...seq.reverse()];
}

// ================= 4) เจ้ามือป๊อก → เปิดวัดทันที =================
{
    const room = makeRoom(3);
    const s = gs(room);
    assert(s.phase === 'bet' && s.dealerId === 'p0', 'มือแรกหัวห้องเป็นเจ้ามือ อยู่ช่วงลงเดิมพัน');
    assert(P(room, 'p0').chips === engine.DEALER_BANK && P(room, 'p1').chips === engine.START_CHIPS, 'เจ้ามือคงที่ถือ 5,000 ขาไพ่ 1,000');
    rig(room, { p1: ['9H', 'KD'], p2: ['2S', '3S'], p0: ['4C', '4D'] });
    engine.submitBet(room, 'p1', 100, ctx(room));
    engine.submitBet(room, 'p2', 50, ctx(room));
    assert(s.phase === 'result', 'เจ้ามือป๊อก → สรุปผลทันทีไม่มีจั่ว');
    const rows = s.lastResult.rows;
    const r1 = rows.find(r => r.playerId === 'p1');
    const r2 = rows.find(r => r.playerId === 'p2');
    assert(r1.outcome === 'win' && r1.delta === 100, 'ขาป๊อก 9 ชนะเจ้ามือป๊อก 8 ได้ 1 เท่า');
    assert(r2.outcome === 'lose' && r2.delta === -100, 'ขา 5 แต้มแพ้เจ้ามือป๊อกคู่ จ่าย 2 เด้ง = 100');
    assert(P(room, 'p1').chips === 1100 && P(room, 'p2').chips === 900 && P(room, 'p0').chips === 5000, 'ชิปหลังจ่ายถูก');
    assert(s.lastResult.dealer.pok && s.lastResult.dealer.deng === 2, 'ผลเจ้ามือป๊อกสองเด้ง');
    conservation(room, 'dealer-pok');
    const view = engine.buildClientState(room, 'p2');
    assert(view.players.find(p => p.playerId === 'p0').cards.length === 2, 'สรุปผลแล้วเห็นไพ่เจ้ามือ');
}

// ================= 5) ขาไพ่ป๊อก ไม่ได้จั่ว / ลำดับจั่ว / เจ้ามือจั่ว =================
{
    const room = makeRoom(4);
    const s = gs(room);
    rig(room, { p1: ['8S', 'QS'], p2: ['AH', '2D'], p3: ['5C', '5H'], p0: ['2C', 'KH'] }, ['6D', '4S', '3H']);
    ['p1', 'p2', 'p3'].forEach(id => engine.submitBet(room, id, 100, ctx(room)));
    assert(s.phase === 'deal', 'แจกแล้วอยู่ช่วงดูไพ่');
    assert(P(room, 'p1').revealed && P(room, 'p1').done, 'ขาป๊อกเปิดไพ่และไม่ต้องจั่ว');
    // ความลับ: p2 เห็นไพ่ p1 (ป๊อก) แต่ไม่เห็นไพ่ p3 และเจ้ามือ
    const v2 = engine.buildClientState(room, 'p2');
    assert(v2.players.find(p => p.playerId === 'p1').cards.length === 2, 'ป๊อกคนอื่นเห็นได้');
    assert(v2.players.find(p => p.playerId === 'p3').cards === null, 'ไพ่ p3 ต้องซ่อน');
    assert(v2.players.find(p => p.playerId === 'p0').cards === null, 'ไพ่เจ้ามือต้องซ่อน');
    assert(v2.self.cards.length === 2, 'เห็นไพ่ตัวเอง');
    const raw = JSON.stringify(v2);
    ['5C', '5H', '2C', 'KH'].forEach(c => assert(!raw.includes(`"${c}"`), `payload p2 ห้ามมีไพ่ลับ ${c}`));
    assert(!('deck' in v2) && !raw.includes('riggedDeck'), 'ไม่ส่งสำรับ');
    assert(v2.lastResult === null, 'ยังไม่ส่งผลก่อนวัด');

    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(s.phase === 'draw' && s.toActPlayerId === 'p2', 'ข้ามขาป๊อก ไปจั่วคนถัดไป');
    throws(() => engine.submitDraw(room, 'p3', true, ctx(room)), /ยังไม่ถึงตา/, 'จั่วข้ามตาไม่ได้');
    const stale = { ...ctx(room), step: s.step - 1 };
    throws(() => engine.submitDraw(room, 'p2', true, stale), /จังหวะเปลี่ยน/, 'step เก่าต้องโดนปฏิเสธ');
    engine.submitDraw(room, 'p2', true, ctx(room)); // AH 2D + 6D = 9
    assert(P(room, 'p2').hand.length === 3, 'จั่วแล้วมี 3 ใบ');
    const v3 = engine.buildClientState(room, 'p3');
    assert(v3.players.find(p => p.playerId === 'p2').cards === null && v3.players.find(p => p.playerId === 'p2').cardCount === 3, 'ใบที่จั่วของคนอื่นยังซ่อน เห็นแค่จำนวน');
    engine.submitDraw(room, 'p3', false, ctx(room)); // คู่ 5 = 0 สองเด้ง
    assert(s.phase === 'dealer' && s.toActPlayerId === 'p0', 'ถึงตาเจ้ามือ');
    throws(() => engine.submitDealerDecision(room, 'p1', true, ctx(room)), /ไม่ใช่เจ้ามือ/, 'คนอื่นตัดสินใจแทนเจ้ามือไม่ได้');
    engine.submitDealerDecision(room, 'p0', true, ctx(room)); // 2C KH + 4S = 6
    assert(s.phase === 'result', 'เจ้ามือตัดสินใจแล้ววัดทันที');
    const by = id => s.lastResult.rows.find(r => r.playerId === id);
    assert(by('p1').outcome === 'win' && by('p1').delta === 200, 'ป๊อก 8 ดอกเดียว ชนะ 2 เด้ง = 200');
    assert(by('p2').outcome === 'win' && by('p2').delta === 100, '9 แต้ม 3 ใบ ชนะ 1 เท่า');
    assert(by('p3').outcome === 'lose' && by('p3').delta === -100, 'บอดแพ้ 6 แต้มเจ้ามือ จ่าย 1 เท่า');
    assert(s.lastResult.dealer.delta === -200, 'เจ้ามือ -200');
    conservation(room, 'draw-flow');
    // มือต่อไป
    throws(() => engine.nextHand(room, 'p1'), /หัวห้อง/, 'คนอื่นกดมือต่อไปไม่ได้');
    engine.nextHand(room, 'p0');
    assert(s.phase === 'bet' && s.handNumber === 2, 'หัวห้องเริ่มมือต่อไปได้');
    const v1 = engine.buildClientState(room, 'p1');
    assert(v1.availableActions.defaultBet === 100, 'ค่าเริ่มต้น = เดิมพันล่าสุด');
}

// ================= 6) ตอง/เรียง/เซียน จ่ายตามเด้ง + ตัดที่ชิปคนแพ้ =================
{
    const room = makeRoom(3);
    const s = gs(room);
    rig(room, { p1: ['7S', '7H'], p2: ['2D', '3H'], p0: ['JS', 'JH'] }, ['7D', '4C', 'QD']);
    engine.submitBet(room, 'p1', 200, ctx(room));
    engine.submitBet(room, 'p2', 300, ctx(room));
    engine.autoResolvePhase(room); // ยังไม่หมดเวลา = ไม่ทำอะไร
    assert(s.phase === 'deal', 'ยังไม่หมดเวลาต้องไม่ข้ามเฟส');
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    engine.submitDraw(room, 'p1', true, ctx(room)); // ตอง 7
    engine.submitDraw(room, 'p2', true, ctx(room)); // 2 3 4 เรียง
    engine.submitDealerDecision(room, 'p0', true, ctx(room)); // J J Q เซียน
    const by = id => s.lastResult.rows.find(r => r.playerId === id);
    assert(by('p1').outcome === 'win' && by('p1').delta === 1000 && by('p1').multiplier === 5, 'ตองชนะเซียน 5 เด้ง = 1000');
    assert(by('p2').outcome === 'win' && by('p2').delta === 900, 'เรียงชนะเซียน 3 เด้ง = 900');
    // ตัดชิปคนแพ้: เจ้ามือเซียน 3 เด้ง vs ขา 0 แต้มที่เหลือชิปน้อย
    conservation(room, 'special-hands');
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room); // result → มือใหม่
    rig(room, { p1: ['2S', '3H'], p2: ['10S', 'KC'], p0: ['4H', '4D'] }, ['9C', 'JD', 'KH']);
    // ให้ p2 เหลือชิป 150 (ปรับทุนตามเพื่อให้สมดุลชิปยังถูก)
    P(room, 'p2').buyIn += 150 - P(room, 'p2').chips;
    P(room, 'p2').chips = 150;
    const beforeTotal = engine.totalChips(room);
    engine.submitBet(room, 'p1', 50, ctx(room));
    engine.submitBet(room, 'p2', 100, ctx(room));
    // เจ้ามือ 4 4 = ป๊อก 8 สองเด้ง → วัดทันที, p2 ต้องจ่าย 200 แต่เหลือชิป 50 + เดิมพัน 100 = 150
    const r2 = s.lastResult.rows.find(r => r.playerId === 'p2');
    assert(r2.outcome === 'lose' && r2.delta === -150 && r2.short, 'คนแพ้จ่ายไม่เกินชิปที่มี (150 จาก 200)');
    assert(P(room, 'p2').chips === 0, 'หมดตัว');
    assert(engine.totalChips(room) === beforeTotal, 'ชิปรวมไม่เปลี่ยนในมือที่ตัดชิป');
    const view = engine.buildClientState(room, 'p2');
    assert(view.availableActions.canRebuy === true, 'หมดตัวแล้วขอชิปใหม่ได้');
    engine.submitRebuy(room, 'p2');
    assert(P(room, 'p2').chips === 1000 && P(room, 'p2').rebuyUsed, 'ขอชิปใหม่ +1000');
    throws(() => engine.submitRebuy(room, 'p2'), /ครั้งเดียว/, 'ขอชิปใหม่ได้ครั้งเดียว');
    throws(() => engine.submitRebuy(room, 'p1'), /ยังมีชิป/, 'ยังมีชิปพอ ขอไม่ได้');
}

// ================= 7) เจ้ามือจ่ายไม่ครบ → แบ่งตามสัดส่วน =================
{
    const room = makeRoom(4);
    const s = gs(room);
    P(room, 'p0').chips = 300;
    P(room, 'p0').buyIn = 300;
    rig(room, { p1: ['9S', '10S'], p2: ['8H', 'KH'], p3: ['9D', 'QD'], p0: ['2C', '3D'] });
    ['p1', 'p2', 'p3'].forEach(id => engine.submitBet(room, id, 200, ctx(room)));
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room); // deal → draw แต่ทุกคนป๊อก → ถึงเจ้ามือ? ทุกขาป๊อก → วัดเลย
    assert(s.phase === 'result', 'ทุกขาป๊อก ไม่ต้องรอเจ้ามือ');
    assert(s.lastResult.shortfall === true, 'ต้องแจ้งเจ้ามือจ่ายไม่ครบ');
    const paid = s.lastResult.rows.reduce((sum, r) => sum + r.delta, 0);
    assert(paid === 300, `แบ่งจ่ายรวม = กองเจ้ามือ 300 (${paid})`);
    assert(P(room, 'p0').chips === 0, 'เจ้ามือเหลือ 0');
    const d = s.lastResult.rows.map(r => r.delta).sort((a, b) => a - b);
    assert(d[2] - d[0] <= 1 && d.every(x => x < 400), `สัดส่วนต้องใกล้เคียงกัน ${d}`);
    conservation(room, 'shortfall');
    // มือต่อไป: เจ้ามือคงที่หมดตัว → ใช้สิทธิ์ขอชิปใหม่อัตโนมัติ
    engine.nextHand(room, 'p0');
    assert(s.dealerId === 'p0' && P(room, 'p0').chips === 1000 && P(room, 'p0').rebuyUsed, 'เจ้ามือหมดตัวขอชิปใหม่อัตโนมัติ');
    conservation(room, 'dealer-rebuy');
}

// ================= 8) การลงเดิมพันผิด =================
{
    const room = makeRoom(3);
    throws(() => engine.submitBet(room, 'p0', 50), /เจ้ามือ/, 'เจ้ามือลงเดิมพันไม่ได้');
    throws(() => engine.submitBet(room, 'p1', 5), /ขั้นต่ำ/, 'ต่ำกว่าขั้นต่ำ');
    throws(() => engine.submitBet(room, 'p1', 501), /สูงสุด/, 'เกินเพดานโต๊ะ');
    throws(() => engine.submitBet(room, 'p1', 12.5), /ไม่ถูกต้อง/, 'ทศนิยม');
    throws(() => engine.submitBet(room, 'p1', 'abc'), /ไม่ถูกต้อง/, 'ไม่ใช่ตัวเลข');
    throws(() => engine.submitBet(room, 'nobody', 50), /ไม่ได้นั่ง/, 'คนนอกโต๊ะ');
    throws(() => engine.submitDraw(room, 'p1', true), /ยังไม่ถึงช่วงจั่ว/, 'จั่วตอนลงเดิมพัน');
    throws(() => engine.submitBet(room, 'p1', 50, { step: 999 }), /จังหวะเปลี่ยน/, 'step ผิด');
    P(room, 'p1').chips = 40;
    throws(() => engine.submitBet(room, 'p1', 50), /สูงสุด 40/, 'ลงเกินชิปตัวเอง');
    P(room, 'p1').chips = 1000;
    engine.submitBet(room, 'p1', 50);
    throws(() => engine.submitBet(room, 'p1', 50), /ไปแล้ว/, 'ลงซ้ำ');
    throws(() => engine.submitSkip(room, 'p1'), /ไปแล้ว/, 'ลงแล้วข้ามไม่ได้');
    throws(() => engine.endTable(room, 'p1'), /หัวห้อง/, 'คนอื่นจบโต๊ะไม่ได้');
    throws(() => engine.setRotateDealer(room, 'p2', true), /หัวห้อง/, 'คนอื่นตั้งหมุนเจ้ามือไม่ได้');
    engine.submitSkip(room, 'p2');
    assert(gs(room).phase === 'deal' || gs(room).phase === 'result', 'ครบแล้วแจก');
    assert(!P(room, 'p2').inHand && P(room, 'p2').hand.length === 0, 'คนข้ามไม่ได้ไพ่');
}

// ================= 9) หมดเวลาทุกเฟส =================
{
    const room = makeRoom(3);
    const s = gs(room);
    rig(room, { p1: ['2S', '3H'], p2: ['4S', '5H'], p0: ['AD', 'AC'] });
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(P(room, 'p1').bet === 10 && P(room, 'p2').bet === 10, 'หมดเวลาลงเดิมพัน = ลงขั้นต่ำ');
    assert(s.phase === 'deal', 'แล้วแจกไพ่');
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(s.phase === 'draw' && s.toActPlayerId === 'p1', 'เข้าช่วงจั่ว');
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(P(room, 'p1').hand.length === 2 && P(room, 'p1').done, 'หมดเวลาจั่ว = อยู่');
    assert(s.phase === 'dealer', 'ขา p2 ป๊อกแล้ว ถึงเจ้ามือ');
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(P(room, 'p0').hand.length === 3, 'เจ้ามือหมดเวลา 2 แต้ม → จั่วให้');
    assert(s.phase === 'result', 'สรุปผล');
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(s.phase === 'bet' && s.handNumber === 2, 'หมดเวลาสรุปผล = มือต่อไป');
    conservation(room, 'timeouts');

    // ไม่มีใครลง 3 มือติด → จบโต๊ะ
    const idle = makeRoom(2);
    for (let i = 0; i < 3; i += 1) {
        engine.submitSkip(idle, 'p1');
        if (gs(idle).phase === 'finished') break;
        gs(idle).phaseEndsAt = Date.now() - 1;
        engine.autoResolvePhase(idle);
    }
    assert(gs(idle).phase === 'finished', 'ข้าม 3 มือติดต้องจบโต๊ะ ไม่ค้าง');
}

// ================= 10) หมุนเจ้ามือ =================
{
    const room = makeRoom(4, { rotate: true });
    const s = gs(room);
    assert(s.players.every(p => p.chips === 1000), 'หมุนเจ้ามือ: ทุกคนเริ่ม 1,000 เท่ากัน');
    assert(s.dealerId === 'p0', 'มือแรกหัวห้อง');
    const seen = [s.dealerId];
    room.players[2].socketId = null; // p2 หลุด → ข้ามตอนหมุน
    for (let h = 0; h < 3; h += 1) {
        s.phaseEndsAt = Date.now() - 1;
        let guard = 0;
        while (s.phase !== 'result' && guard < 20) { s.phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(room); guard += 1; }
        engine.nextHand(room, 'p0');
        seen.push(s.dealerId);
    }
    assert(seen.join(',') === 'p0,p1,p3,p0', `ลำดับเจ้ามือข้ามคนหลุด ${seen}`);
    assert(P(room, 'p2').hand.length === 0, 'คนหลุดไม่ได้ไพ่');
    conservation(room, 'rotate');
    engine.setRotateDealer(room, 'p0', false);
    let guard = 0;
    while (s.phase !== 'result' && guard < 20) { s.phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(room); guard += 1; }
    const before = s.dealerId;
    engine.nextHand(room, 'p0');
    assert(s.dealerId === before, 'ปิดหมุน = เจ้ามือเดิม');
}

// ================= 11) ออกกลางเกม =================
{
    // ขาไพ่ออกตอนถึงตาจั่ว
    const room = makeRoom(4);
    const s = gs(room);
    rig(room, { p1: ['2S', '3H'], p2: ['4S', '2H'], p3: ['6S', '10H'], p0: ['AD', '3C'] });
    ['p1', 'p2', 'p3'].forEach(id => engine.submitBet(room, id, 100, ctx(room)));
    s.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
    assert(s.toActPlayerId === 'p1', 'ตา p1');
    room.players = room.players.filter(p => p.playerId !== 'p1');
    engine.handlePlayerLeft(room, 'p1');
    assert(s.toActPlayerId === 'p2', 'คนออกตอนถึงตา → ข้ามไปคนถัดไป');
    room.players.find(p => p.playerId === 'p3').socketId = null; // p3 หลุด → ข้ามตอนถึงตา
    engine.submitDraw(room, 'p2', false, ctx(room));
    assert(s.phase === 'dealer', 'คนหลุดโดนข้าม ไปถึงเจ้ามือ');
    engine.submitDealerDecision(room, 'p0', false, ctx(room));
    assert(s.lastResult.rows.some(r => r.playerId === 'p1'), 'คนที่ออกหลังแจกยังถูกวัดตามปกติ');
    conservation(room, 'leave-draw');

    // เจ้ามือออกกลางมือ → คืนเดิมพัน เปลี่ยนเจ้ามือ
    const room2 = makeRoom(4);
    const s2 = gs(room2);
    engine.submitBet(room2, 'p2', 100);
    engine.submitBet(room2, 'p3', 100);
    room2.players = room2.players.filter(p => p.playerId !== 'p0');
    room2.admin = 'p1';
    engine.handlePlayerLeft(room2, 'p0');
    assert(s2.phase === 'bet' && s2.dealerId === 'p1', 'เจ้ามือออก → มือใหม่ เจ้ามือคนถัดไป');
    assert(P(room2, 'p2').chips === 1000 && P(room2, 'p3').chips === 1000, 'คืนเดิมพันครบ');
    conservation(room2, 'dealer-left');

    // ออกจนเหลือคนเดียว → จบโต๊ะ
    room2.players = room2.players.filter(p => p.playerId === 'p1' || p.playerId === 'p2');
    engine.handlePlayerLeft(room2, 'p3');
    assert(s2.phase === 'bet', 'เหลือ 2 คนยังเล่นต่อ');
    rig(room2, { p2: ['2S', '3H'], p1: ['4C', '2D'] });
    engine.submitBet(room2, 'p2', 70);
    assert(s2.phase === 'deal', 'แจกแล้ว');
    room2.players = room2.players.filter(p => p.playerId === 'p1');
    engine.handlePlayerLeft(room2, 'p2');
    assert(s2.phase === 'finished' && s2.status === 'pokdeng_finished', 'เหลือแค่เจ้ามือ → จบโต๊ะ');
    assert(P(room2, 'p2').chips === 1000 && P(room2, 'p2').bet === 0, 'จบกลางมือ คืนเดิมพัน');
    conservation(room2, 'finish-left');
}

// ================= 12) จบโต๊ะ + สถิติครั้งเดียว =================
{
    const room = makeRoom(3);
    const s = gs(room);
    rig(room, { p1: ['9S', 'KD'], p2: ['2S', '3H'], p0: ['4C', '2D'] });
    engine.submitBet(room, 'p1', 100);
    engine.submitBet(room, 'p2', 100);
    let guard = 0;
    while (s.phase !== 'result' && guard < 20) { s.phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(room); guard += 1; }
    engine.endTable(room, 'p0');
    assert(s.phase === 'finished' && s.standings.length === 3, 'จบโต๊ะมีตารางสรุป');
    const top = s.standings[0];
    assert(top.playerId === 'p1' && top.net === 100 && top.won, 'p1 กำไร 100 = ชนะ');
    assert(s.standings.find(r => r.playerId === 'p2').won === false, 'p2 ขาดทุน = แพ้');
    throws(() => engine.submitBet(room, 'p1', 10), /จบแล้ว/, 'จบแล้วลงไม่ได้');

    let recorded = 0;
    const events = [];
    const fakeIo = { to: () => ({ emit: (name) => events.push(name) }) };
    const runtime = createRuntime(() => ({
        io: fakeIo,
        roomManager: { getRoom: () => room },
        statsManager: { recordGameEnd: (id, res) => { recorded += 1; assert(res.mode === 'pokdeng' && res.standings.length === 3, 'ส่ง standings ไปบันทึก'); } },
        addServerLog: () => {},
        buildRoomUpdatePayload: () => ({}),
        notifyGameEndAfterRecord: () => {},
        scheduleFinishedGameReturnToLobby: () => {}
    }));
    runtime.emitRoomState(room);
    runtime.emitRoomState(room);
    runtime.finalizeIfNeeded(room);
    assert(recorded === 1, `บันทึกสถิติครั้งเดียว (${recorded})`);
    const fv = engine.buildClientState(room, 'p2');
    assert(fv.standings && fv.winner.playerId === 'p1', 'client เห็นสรุปตอนจบ');
    runtime.clearTimers(room.roomId);
}

// ================= 13) บอท =================
{
    const room = makeRoom(5, { bots: true });
    const s = gs(room);
    let rng = 0.37;
    const rand = () => { rng = (rng * 9301 + 49297) % 233280 / 233280; return rng; };
    for (let step = 0; step < 400 && s.phase !== 'finished'; step += 1) {
        if (engine.botNeedsTurn(room)) {
            engine.playBotTurns(room, rand);
        } else if (s.phase === 'result' && s.handNumber >= 6) {
            engine.endTable(room, 'p0');
        } else if (s.phase === 'dealer' && s.dealerId === 'p0') {
            engine.submitDealerDecision(room, 'p0', rand() < 0.5, ctx(room));
        } else {
            s.phaseEndsAt = Date.now() - 1;
            engine.autoResolvePhase(room);
        }
        conservation(room, 'bots');
    }
    assert(s.phase === 'finished' && s.handNumber >= 6, `บอทเล่นครบ 6 มือ (${s.handNumber})`);
    assert(engine.shouldBotDraw(3, () => 0.9) && !engine.shouldBotDraw(5, () => 0) && engine.shouldBotDraw(4, () => 0.1) && !engine.shouldBotDraw(4, () => 0.9), 'กติกาจั่วของบอท');
}

// ================= 13b) UX: พร้อมครบไปต่อเลย · ชิปหมดข้ามได้ · บอกเจ้ามือมือหน้า · ลำดับจั่ว =================
{
    const room = makeRoom(4, { rotate: true });
    const s = gs(room);
    const toResult = () => { let g = 0; while (s.phase !== 'result' && g < 20) { s.phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(room); g += 1; } };
    toResult();
    const hand = s.handNumber;
    let v = engine.buildClientState(room, 'p1');
    assert(v.availableActions.canReady && !v.availableActions.canNext, 'สรุปผล: คนที่ไม่ใช่หัวห้องกดพร้อมได้');
    assert(v.readyNeeded === 4 && v.readyIds.length === 0, 'ต้องพร้อม 4 คน');
    assert(v.nextDealer && v.nextDealer.playerId === 'p1', 'หมุนเจ้ามือ: บอกล่วงหน้าว่ามือหน้า p1 เป็นเจ้ามือ');
    ['p1', 'p2'].forEach(id => engine.submitReady(room, id));
    engine.submitReady(room, 'p2'); // กดซ้ำไม่นับซ้ำ
    assert(s.phase === 'result' && s.readyIds.length === 2, 'พร้อม 2/4 ยังไม่ไปต่อ');
    assert(!engine.buildClientState(room, 'p2').availableActions.canReady, 'กดพร้อมแล้ว ปุ่มหาย');
    room.players.find(p => p.playerId === 'p3').socketId = null; // p3 หลุด → ไม่ต้องรอ
    engine.submitReady(room, 'p0');
    assert(s.phase === 'bet' && s.handNumber === hand + 1, 'คนที่ต่ออยู่พร้อมครบ → มือต่อไปทันที');
    assert(s.dealerId === 'p1', 'เจ้ามือตรงกับที่บอกล่วงหน้า');
    assert(s.readyIds.length === 0, 'มือใหม่ล้างรายการพร้อม');
    throws(() => engine.submitReady(room, 'p2'), /ยังไม่จบมือ/, 'กดพร้อมนอกช่วงสรุปผลไม่ได้');
    // คนสุดท้ายที่ยังไม่พร้อมออกจากห้อง → ที่เหลือพร้อมครบ ไปต่อเลย
    room.players.find(p => p.playerId === 'p3').socketId = 's3';
    toResult();
    const hand2 = s.handNumber;
    ['p0', 'p1', 'p2'].forEach(id => engine.submitReady(room, id));
    assert(s.phase === 'result', 'p3 ยังไม่พร้อม ต้องรอ');
    room.players = room.players.filter(p => p.playerId !== 'p3');
    engine.handlePlayerLeft(room, 'p3');
    assert(s.phase === 'bet' && s.handNumber === hand2 + 1, 'คนที่ค้างออกไป → ไปมือต่อไปเลย');
    conservation(room, 'ready');

    // ลำดับจั่วส่งให้ client (ใช้บอก "อีก N คนถึงตาคุณ")
    const r2 = makeRoom(4);
    rig(r2, { p1: ['2S', '3D'], p2: ['2H', '3C'], p3: ['2D', '4S'], p0: ['AS', '5D'] });
    ['p1', 'p2', 'p3'].forEach(id => engine.submitBet(r2, id, 50, ctx(r2)));
    gs(r2).phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(r2);
    const dv = engine.buildClientState(r2, 'p3');
    assert(dv.phase === 'draw' && dv.drawOrder.join(',') === 'p1,p2,p3' && dv.toActPlayerId === 'p1', 'ส่งลำดับจั่วให้ client: ' + dv.drawOrder);
    assert(dv.nextDealer === null, 'เจ้ามือคงที่/ระหว่างเล่น ไม่ต้องบอกเจ้ามือมือหน้า');

    // ชิปหมด ยังขอชิปใหม่ได้ → ข้ามมือได้ ไม่ต้องรอนาฬิกา
    const r3 = makeRoom(3);
    const broke = P(r3, 'p1');
    P(r3, 'p0').chips += broke.chips; // ย้ายชิปไปเจ้ามือ = ชิปรวมยังเท่าทุน
    broke.chips = 0;
    const bv = engine.buildClientState(r3, 'p1').availableActions;
    assert(!bv.canBet && bv.canRebuy && bv.canSkip, 'ชิปหมด: ขอชิปใหม่หรือข้ามมือได้');
    engine.submitSkip(r3, 'p1', ctx(r3));
    engine.submitBet(r3, 'p2', 20, ctx(r3));
    assert(gs(r3).phase !== 'bet', 'คนชิปหมดกดข้าม → แจกไพ่เลย ไม่ต้องรอหมดเวลา');
    conservation(r3, 'broke-skip');
}

// ================= 14) สุ่มเล่นหลายโต๊ะ: ชิปไม่หาย ไม่ค้าง ไม่รั่ว =================
{
    let seed = 12345;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const origRandom = Math.random;
    Math.random = rand;
    let tables = 0; let hands = 0; let shortfalls = 0; let dealerPoks = 0;
    try {
        for (let t = 0; t < 250; t += 1) {
            const n = 2 + Math.floor(rand() * 9);
            const room = makeRoom(n, { rotate: rand() < 0.5, bots: rand() < 0.3 });
            const s = gs(room);
            tables += 1;
            for (let step = 0; step < 900 && s.phase !== 'finished'; step += 1) {
                const beforeStep = s.step;
                const r = rand();
                const humans = s.players.filter(p => !p.left && !engine.isBotId(p.playerId));
                if (s.status === 'playing') {
                    assert(s.phaseEndsAt, `เฟส ${s.phase} ต้องมีนาฬิกา (กันค้าง)`);
                }
                try {
                    if (r < 0.02 && room.players.length > 1) {
                        // มีคนออก
                        const leaver = room.players[1 + Math.floor(rand() * (room.players.length - 1))];
                        room.players = room.players.filter(p => p !== leaver);
                        if (leaver.playerId === room.admin) room.admin = room.players[0].playerId;
                        engine.handlePlayerLeft(room, leaver.playerId);
                    } else if (r < 0.04) {
                        const who = room.players[Math.floor(rand() * room.players.length)];
                        if (!engine.isBotId(who.playerId)) who.socketId = who.socketId ? null : 's-back';
                    } else if (r < 0.06) {
                        const p = humans[Math.floor(rand() * humans.length)];
                        if (p) engine.submitRebuy(room, p.playerId);
                    } else if (engine.botNeedsTurn(room) && r < 0.5) {
                        engine.playBotTurns(room, rand);
                    } else if (s.phase === 'bet') {
                        const p = humans[Math.floor(rand() * humans.length)];
                        if (p) {
                            if (rand() < 0.15) engine.submitSkip(room, p.playerId, ctx(room));
                            else engine.submitBet(room, p.playerId, 10 + Math.floor(rand() * 600), ctx(room));
                        }
                    } else if (s.phase === 'draw') {
                        engine.submitDraw(room, s.toActPlayerId, rand() < 0.5, rand() < 0.1 ? { step: s.step - 1 } : ctx(room));
                    } else if (s.phase === 'dealer') {
                        engine.submitDealerDecision(room, s.dealerId, rand() < 0.5, ctx(room));
                    } else if (s.phase === 'result') {
                        if (s.lastResult && s.lastResult.shortfall) shortfalls += 1;
                        if (s.lastResult && s.lastResult.dealer && s.lastResult.dealer.pok) dealerPoks += 1;
                        if (rand() < 0.03 || s.handNumber > 25) engine.endTable(room, room.admin);
                        else engine.nextHand(room, room.admin);
                        hands += 1;
                    } else {
                        s.phaseEndsAt = Date.now() - 1;
                        engine.autoResolvePhase(room);
                    }
                } catch (error) {
                    if (!/[฀-๿]/.test(error.message)) throw error; // ต้องเป็นข้อความไทยที่ตั้งใจ throw เท่านั้น
                }
                if (rand() < 0.1 && s.status === 'playing') {
                    s.phaseEndsAt = Date.now() - 1;
                    engine.autoResolvePhase(room);
                }
                conservation(room, `table ${t}`);
                // ไพ่ไม่ซ้ำกันในมือทุกคน
                const inPlay = s.players.flatMap(p => p.hand);
                assert(new Set(inPlay).size === inPlay.length, 'ไพ่ซ้ำบนโต๊ะ');
                s.players.forEach(p => assert(p.hand.length === 0 || p.hand.length === 2 || p.hand.length === 3, 'ไพ่ในมือ 0/2/3 ใบ'));
                // ความลับ: ทุกคนมองไม่เห็นไพ่ที่ยังไม่เปิดของคนอื่น
                if (['deal', 'draw', 'dealer'].includes(s.phase)) {
                    const viewer = s.players[Math.floor(rand() * s.players.length)];
                    const view = engine.buildClientState(room, viewer.playerId);
                    const text = JSON.stringify(view);
                    s.players.filter(p => p.playerId !== viewer.playerId && !p.revealed).forEach(p => {
                        p.hand.forEach(c => assert(!text.includes(`"id":"${c}"`), `รั่ว: ${viewer.playerId} เห็น ${c} ของ ${p.playerId}`));
                    });
                }
                if (s.phase === 'finished') break;
                void beforeStep;
            }
            if (s.phase !== 'finished') engine.endTable(room, room.admin);
            assert(s.phase === 'finished', 'จบโต๊ะได้เสมอ');
            conservation(room, `end ${t}`);
            const net = s.standings.reduce((sum, r) => sum + r.net, 0);
            const unplayed = s.players.filter(p => !(p.handsPlayed > 0 || p.handsDealt > 0)).reduce((sum, p) => sum + p.chips - p.buyIn, 0);
            assert(net + unplayed === 0, `ผลรวมกำไรขาดทุนทั้งโต๊ะ = 0 (${net})`);
        }
    } finally {
        Math.random = origRandom;
    }
    assert(hands > 500, `เล่นไปหลายมือ (${hands})`);
    console.log(`  randomized: ${tables} โต๊ะ ${hands} มือ · เจ้ามือป๊อก ${dealerPoks} · จ่ายไม่ครบ ${shortfalls}`);
}

console.log(`✅ smoke-pokdeng-engine: ${passed} checks passed`);
