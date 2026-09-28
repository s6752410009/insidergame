/**
 * เทสตรรกะ ป๊อกเด้งท้าเจ้ามือ (ไม่ต้องมีเซิร์ฟเวอร์)
 * รัน: node scripts/smoke-solo-pokdengsolo.js
 */

const engine = require('../games/pokdengSoloEngine');
const pd = require('../games/pokdengEngine');
const game = require('../games/solo/pokdengsolo');

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

/**
 * สำรับเรียงไว้: แจก ผู้เล่น, เจ้ามือ, ผู้เล่น, เจ้ามือ แล้วใบถัดไปตามลำดับ (จั่วผู้เล่น → จั่วเจ้ามือ)
 * engine pop จากท้าย → กลับด้านแล้วเติมใบที่เหลือไว้ข้างหน้า
 */
function rig(p1, d1, p2, d2, ...rest) {
    const order = [p1, d1, p2, d2, ...rest];
    const filler = pd.buildDeck().filter(c => !order.includes(c));
    return [...filler, ...order.reverse()];
}
const always = v => () => v;
function freshRun(chips) {
    const run = engine.createRun({ now: 1700000000000, runId: 'test' });
    if (chips != null) { run.chips = chips; run.peak = Math.max(run.peak, chips); }
    return run;
}

// ================= 1) เริ่มรอบ =================
{
    const run = freshRun();
    assert(run.chips === 1000 && run.phase === 'bet' && run.handNo === 0, 'เริ่ม 1,000 ชิป รอลงเดิมพัน');
    assert(engine.maxBetFor(run) === 500, 'ลงได้สูงสุด 500');
    assert(engine.maxBetFor(freshRun(120)) === 120, 'ลงได้ไม่เกินชิปที่มี');
}

// ================= 2) ตรวจยอดเดิมพัน =================
{
    const run = freshRun();
    throws(() => engine.placeBet(run, 9), /ขั้นต่ำ/, 'ต่ำกว่า 10');
    throws(() => engine.placeBet(run, 501), /สูงสุด/, 'เกิน 500');
    throws(() => engine.placeBet(run, 12.5), /จำนวนเต็ม/, 'ทศนิยม');
    throws(() => engine.placeBet(run, 'abc'), /จำนวนเต็ม/, 'ไม่ใช่ตัวเลข');
    throws(() => engine.placeBet(run, null), /ขั้นต่ำ|จำนวนเต็ม/, 'ไม่ส่งยอด');
    throws(() => engine.placeBet(freshRun(40), 50), /ไม่พอ/, 'เกินชิปที่มี');
    assert(run.chips === 1000 && run.phase === 'bet' && run.handNo === 0, 'ยอดผิดไม่แตะสถานะ');
    throws(() => engine.playerAct(run, true), /ยังไม่ถึง/, 'จั่วก่อนลงเดิมพันไม่ได้');
}

// ================= 3) ผู้เล่นป๊อก — เปิดวัดทันที =================
{
    const run = freshRun();
    engine.placeBet(run, 100, { deck: rig('9S', '5H', 'KD', 'AC') }); // ป๊อก 9 vs เจ้ามือ 6
    assert(run.phase === 'bet' && !run.hand, 'ป๊อกแล้ววัดเลย กลับไปรอลงมือต่อไป');
    const r = run.lastResult;
    assert(r.outcome === 'win' && r.multiplier === 1 && r.delta === 100, 'ป๊อก 9 ชนะ ได้ 100');
    assert(run.chips === 1100 && run.peak === 1100, 'ชิป 1,100 และจุดสูงสุดขยับ');
    assert(run.poks === 1 && run.hands === 1 && run.wins === 1, 'นับป๊อก/มือ/ชนะ');
    assert(r.dealer.cards.length === 2 && !r.dealerDrew, 'เจ้ามือไม่จั่วแก้เมื่อผู้เล่นป๊อก');
}
{
    const run = freshRun();
    engine.placeBet(run, 50, { deck: rig('3C', '2H', '5C', '4D') }); // ป๊อก 8 ดอกเดียวกัน = สองเด้ง
    assert(run.lastResult.outcome === 'win' && run.lastResult.multiplier === 2 && run.chips === 1100, 'ป๊อก 8 สองเด้ง ได้ 100');
}

// ================= 4) เจ้ามือป๊อก — ผู้เล่นไม่ได้จั่ว =================
{
    const run = freshRun();
    engine.placeBet(run, 200, { deck: rig('2S', '4H', '3D', '4D') }); // คู่ 4 = ป๊อก 8 สองเด้ง
    const r = run.lastResult;
    assert(r.outcome === 'lose' && r.multiplier === 2 && r.delta === -400, 'แพ้ป๊อกสองเด้ง เสีย 400');
    assert(run.chips === 600 && run.phase === 'bet', 'เหลือ 600');
    assert(run.poks === 0, 'ป๊อกของเจ้ามือไม่นับเป็นของผู้เล่น');
}
{
    const run = freshRun();
    engine.placeBet(run, 9 * 10, { deck: rig('9H', '8S', 'KH', 'QS') }); // ป๊อก 9 vs ป๊อก 8
    assert(run.lastResult.outcome === 'win', 'ป๊อก 9 ชนะป๊อก 8');
    const run2 = freshRun();
    engine.placeBet(run2, 100, { deck: rig('9H', '9S', 'KH', 'QS') }); // ป๊อก 9 ทั้งคู่
    assert(run2.lastResult.outcome === 'push' && run2.chips === 1000 && run2.pushes === 1, 'ป๊อกเท่ากัน เสมอ คืนเดิมพัน');
}

// ================= 5) จั่ว/อยู่ + เจ้ามือบอท =================
{
    // ผู้เล่น 2 แต้ม จั่ว 5 → 7 · เจ้ามือ 3 แต้ม (ต้องจั่ว) ได้ K → 3
    const run = freshRun();
    engine.placeBet(run, 100, { deck: rig('AS', 'AH', 'AD', '2C', '5H', 'KS') });
    assert(run.phase === 'draw' && run.hand.bet === 100 && run.chips === 900, 'หักเดิมพันตอนแจก');
    const view = engine.publicView(run);
    const json = JSON.stringify(view);
    assert(view.hand.dealer.cardCount === 2 && !view.hand.dealer.cards, 'ไม่เห็นไพ่เจ้ามือก่อนเปิด');
    assert(!/deck/.test(json) && !json.includes('"AH"') && !json.includes('"2C"'), 'publicView ไม่หลุดสำรับ/ไพ่เจ้ามือ');
    assert(view.hand.player.cards.length === 2 && view.hand.player.eval.points === 2, 'เห็นไพ่ตัวเอง 2 แต้ม');
    engine.playerAct(run, true, { rng: always(0.99) });
    const r = run.lastResult;
    assert(r.playerDrew && r.dealerDrew, 'ทั้งคู่จั่ว (เจ้ามือ 3 แต้มจั่วเสมอ)');
    assert(r.player.eval.points === 7 && r.dealer.eval.points === 3, 'ผู้เล่น 7 เจ้ามือ 3');
    assert(r.outcome === 'win' && run.chips === 1100, 'ชนะ 100');
    throws(() => engine.playerAct(run, false), /ยังไม่ถึง/, 'จั่วซ้ำหลังจบมือไม่ได้');
}
{
    // เจ้ามือ 4 แต้ม: rng < 0.5 จั่ว, ≥ 0.5 อยู่
    const a = freshRun();
    engine.placeBet(a, 10, { deck: rig('2S', '2H', '3D', '2C', '9D') });
    engine.playerAct(a, false, { rng: always(0.2) });
    assert(a.lastResult.dealerDrew && a.lastResult.dealer.cards.length === 3, 'เจ้ามือ 4 แต้ม + rng 0.2 = จั่ว');
    const b = freshRun();
    engine.placeBet(b, 10, { deck: rig('2S', '2H', '3D', '2C', '9D') });
    engine.playerAct(b, false, { rng: always(0.8) });
    assert(!b.lastResult.dealerDrew && b.lastResult.outcome === 'win', 'เจ้ามือ 4 แต้ม + rng 0.8 = อยู่ · 5 ชนะ 4');
    const c = freshRun();
    engine.placeBet(c, 10, { deck: rig('2S', '3H', '3D', '2C') });
    engine.playerAct(c, false, { rng: always(0) });
    assert(!c.lastResult.dealerDrew && c.lastResult.outcome === 'push', 'เจ้ามือ 5 แต้มไม่จั่ว · 5 เสมอ 5');
}

// ================= 6) เด้งใหญ่ + เพดานเสีย =================
{
    // ผู้เล่นจั่วเป็นตอง 7 = ห้าเด้ง
    const run = freshRun();
    engine.placeBet(run, 100, { deck: rig('7S', 'KH', '7H', 'QD', '7D', '5C') });
    engine.playerAct(run, true, { rng: always(0.99) });
    assert(run.lastResult.player.eval.name === 'ตอง' && run.lastResult.multiplier === 5, 'ตอง ห้าเด้ง');
    assert(run.chips === 1500 && run.biggestWin === 500, 'ได้ 500 · ชนะมากสุด 500');
}
{
    // เจ้ามือตอง ห้าเด้ง แต่ผู้เล่นเหลือแค่ 300 → เสียไม่เกินที่มี
    const run = freshRun(800);
    engine.placeBet(run, 500, { deck: rig('2S', '6H', '3D', '6C', 'KD', '6D') });
    engine.playerAct(run, true, { rng: always(0.99) });
    const r = run.lastResult;
    assert(r.dealer.eval.name === 'ตอง' && r.multiplier === 5, 'เจ้ามือตอง');
    assert(r.delta === -800 && r.short && run.chips === 0, 'เสียหมดตัว ไม่ติดลบ');
    assert(run.phase === 'busted' && engine.isBusted(run), 'หมดตัว = จบรอบ');
    throws(() => engine.placeBet(run, 10), /เริ่มรอบใหม่/, 'หมดตัวแล้วลงต่อไม่ได้');
}
{
    const run = freshRun(15);
    engine.placeBet(run, 10, { deck: rig('2S', '8H', '3D', 'AC') }); // เจ้ามือป๊อก 9
    assert(run.chips === 5 && run.phase === 'busted', 'เหลือไม่ถึง 10 = หมดตัว');
}

// ================= 7) สถิติตลอดกาล =================
{
    let stats = engine.normalizeStats(null);
    assert(stats.bestPeak === 0 && stats.handsPlayed === 0, 'สถิติว่าง');
    const run = freshRun();
    stats = engine.applyRunStartToStats(stats, run);
    assert(stats.runs === 1 && stats.bestPeak === 1000, 'เริ่มรอบ = นับรอบ');
    engine.placeBet(run, 500, { deck: rig('9S', '5H', 'KD', 'AC') });
    stats = engine.applyHandToStats(stats, run);
    assert(stats.handsPlayed === 1 && stats.pokCount === 1 && stats.biggestWin === 500 && stats.bestPeak === 1500, 'รวมผลมือเข้าสถิติ');
    engine.placeBet(run, 500, { deck: rig('2S', '8H', '3D', 'AC') });
    stats = engine.applyHandToStats(stats, run);
    assert(stats.bestPeak === 1500 && stats.chips === 1000 && stats.losses === 1 && stats.longestRun === 2, 'จุดสูงสุดไม่ลดเมื่อแพ้');
    const junk = engine.normalizeStats({ bestPeak: '-5', handsPlayed: 'x', runs: 2.7 });
    assert(junk.bestPeak === 0 && junk.handsPlayed === 0 && junk.runs === 2, 'ข้อมูลเพี้ยนถูกทำให้ปลอดภัย');
}

// ================= 8) อ่าน run กลับจากไฟล์ =================
{
    assert(engine.reviveRun(null) === null, 'ไม่มี run');
    assert(engine.reviveRun({ v: 2, phase: 'bet', chips: 5 }) === null, 'เวอร์ชันผิด');
    assert(engine.reviveRun({ v: 1, phase: 'draw', chips: 5, hand: null }) === null, 'draw แต่ไม่มีมือ');
    assert(engine.reviveRun({ v: 1, phase: 'draw', chips: 5, hand: { deck: [], player: ['ZZ', 'AS'], dealer: ['AS', 'AH'] } }) === null, 'ไพ่เพี้ยน');
    const run = freshRun();
    engine.placeBet(run, 10, { deck: rig('AS', 'AH', 'AD', '2C') });
    const back = engine.reviveRun(JSON.parse(JSON.stringify(run)));
    assert(back && back.phase === 'draw' && back.hand.deck.length === 48, 'run กลางมือกลับมาเล่นต่อได้');
}

// ================= 9) สุ่มยาวๆ: ค่าคงที่ต้องไม่พัง =================
{
    let totalHands = 0;
    let busts = 0;
    for (let r = 0; r < 200; r += 1) {
        const run = freshRun();
        for (let i = 0; i < 400 && run.phase !== 'busted'; i += 1) {
            const bet = Math.min(engine.maxBetFor(run), 10 * (1 + Math.floor(Math.random() * 50)));
            const before = run.chips;
            engine.placeBet(run, bet);
            if (run.phase === 'draw') {
                const seen = [...run.hand.player, ...run.hand.dealer, ...run.hand.deck];
                if (new Set(seen).size !== 52) throw new Error('FAIL: สำรับไม่ครบ 52 ใบ');
                engine.playerAct(run, pd.evaluateHand(run.hand.player).points <= 4);
            }
            const res = run.lastResult;
            if (!Number.isInteger(run.chips) || run.chips < 0) throw new Error('FAIL: ชิปติดลบ/ไม่ใช่จำนวนเต็ม');
            if (run.chips !== before + res.delta) throw new Error('FAIL: ชิปไม่ตรงกับ delta');
            if (res.outcome === 'win' && res.delta !== res.bet * res.multiplier) throw new Error('FAIL: จ่ายชนะผิด');
            if (res.outcome === 'lose' && -res.delta > res.bet * res.multiplier) throw new Error('FAIL: เสียเกินเด้ง');
            if (run.peak < run.chips) throw new Error('FAIL: peak ต่ำกว่าชิป');
            totalHands += 1;
        }
        if (run.phase === 'busted') busts += 1;
    }
    assert(totalHands > 1000, `สุ่ม ${totalHands} มือ ค่าคงที่ครบ (หมดตัว ${busts} รอบ)`);
}

// ================= 10) โมดูลเกม (สัญญากับ games/solo) =================
{
    assert(game.meta.id === 'pokdengsolo' && game.meta.cover.endsWith('cover.svg'), 'meta');
    throws(() => game.recordResult(null, { chips: 999999 }, {}), /เซิร์ฟเวอร์/, 'POST /result ปลอมถูกปฏิเสธเสมอ');
    assert(game.summary(null) === null, 'ยังไม่เคยเล่น ไม่มีสรุป');
    assert(game.leaderboardEntry({ bestPeak: 1000, handsPlayed: 0 }) === null, 'ยังไม่เล่นสักมือ ไม่ติดอันดับ');
    const entry = game.leaderboardEntry({ bestPeak: 4250, handsPlayed: 12 });
    assert(entry.score === 4250 && entry.label === '4,250 ชิป', 'อันดับใช้จุดสูงสุด');
    assert(/4,250/.test(game.summary({ bestPeak: 4250, handsPlayed: 12, pokCount: 3 })), 'สรุปบนการ์ด');
    assert(game.leaderboardOrder === 'desc', 'มากก่อน');
}

console.log(`✅ smoke-solo-pokdengsolo: ${passed} assertions passed`);
