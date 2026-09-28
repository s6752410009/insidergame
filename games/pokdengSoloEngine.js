/**
 * ป๊อกเด้งท้าเจ้ามือ (เล่นคนเดียว) — ตรรกะล้วน ไม่แตะ I/O
 *
 * กติกา/การวัดมือ/เด้ง ใช้ของโต๊ะหลายคน (games/pokdengEngine.js) ตรงๆ:
 *   evaluateHand · judge · shouldBotDraw · describeCard · buildDeck
 *
 * หนึ่ง "รอบ" (run): เริ่ม 1,000 ชิป (ชิปเล่นๆ ไม่ผูกกระเป๋า ไม่มีมูลค่าจริง)
 *   ลง 10–500 ต่อมือ → แจก 2 ใบ (สลับ ผู้เล่น/เจ้ามือ) → ป๊อกฝั่งไหน เปิดวัดทันที
 *   → ผู้เล่นจั่ว/อยู่ → เจ้ามือบอทจั่วถ้า 0–3 แต้ม (4 แต้ม = ครึ่งๆ) → วัด → มือต่อไป
 *   ชิปเหลือไม่ถึง 10 = หมดตัว จบรอบ
 *
 * เจ้ามือเป็นบ้าน (กองไม่จำกัด) — แพ้ได้เดิมพัน × เด้งของผู้เล่นเสมอ
 * ผู้เล่นแพ้เสีย เดิมพัน × เด้งเจ้ามือ แต่ไม่เกินชิปที่มี (เหมือนโต๊ะหลายคน)
 *
 * สำรับ + ไพ่เจ้ามือ อยู่ใน run (ฝั่งเซิร์ฟเวอร์เท่านั้น) — ส่งให้ client ผ่าน publicView() เท่านั้น
 */

const pd = require('./pokdengEngine');

const START_CHIPS = 1000;
const MIN_BET = 10;
const MAX_BET = 500;
const MAX_HANDS_PER_RUN = 100000; // กันตัวเลขบวม ไม่มีใครเล่นถึง

function uniformRng(rng) {
    return typeof rng === 'function' ? rng : Math.random;
}

function shuffleDeck(rng) {
    const r = uniformRng(rng);
    const deck = pd.buildDeck();
    for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(r() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function createRun({ now = Date.now(), runId = null } = {}) {
    return {
        v: 1,
        runId: runId || `r${now.toString(36)}`,
        startedAt: now,
        chips: START_CHIPS,
        phase: 'bet', // bet | draw | busted
        handNo: 0, // มือล่าสุดที่เริ่มไปแล้ว (มือแรก = 1)
        hand: null, // { no, bet, deck, player, dealer, playerDrew }
        lastResult: null,
        lastBet: 50,
        peak: START_CHIPS,
        hands: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        poks: 0,
        biggestWin: 0,
        endedAt: null
    };
}

function maxBetFor(run) {
    return Math.max(0, Math.min(MAX_BET, Math.floor(Number(run.chips) || 0)));
}

function isBusted(run) {
    return (Number(run.chips) || 0) < MIN_BET;
}

function validateBet(run, amount) {
    const bet = Number(amount);
    if (!Number.isInteger(bet)) throw new Error('ยอดเดิมพันต้องเป็นจำนวนเต็ม');
    if (bet < MIN_BET) throw new Error(`ลงขั้นต่ำ ${MIN_BET} ชิป`);
    if (bet > MAX_BET) throw new Error(`ลงได้สูงสุด ${MAX_BET} ชิปต่อมือ`);
    if (bet > run.chips) throw new Error('ชิปไม่พอ');
    return bet;
}

/**
 * ลงเดิมพัน + แจกไพ่ · ถ้ามีป๊อก (ฝั่งใดฝั่งหนึ่ง) วัดผลทันที
 * @param opts.rng     () => [0,1)
 * @param opts.deck    (เทสต์เท่านั้น) สำรับที่เรียงไว้ — pop จากท้าย
 * @returns run (mutated)
 */
function placeBet(run, amount, opts = {}) {
    if (run.phase === 'busted') throw new Error('ชิปหมดแล้ว — เริ่มรอบใหม่');
    if (run.phase !== 'bet') throw new Error('มือนี้ลงเดิมพันไปแล้ว');
    if (run.hands >= MAX_HANDS_PER_RUN) throw new Error('รอบนี้ยาวเกินไปแล้ว — เริ่มรอบใหม่');
    const bet = validateBet(run, amount);
    const deck = Array.isArray(opts.deck) ? [...opts.deck] : shuffleDeck(opts.rng);
    const player = [];
    const dealer = [];
    for (let round = 0; round < 2; round += 1) {
        player.push(deck.pop());
        dealer.push(deck.pop());
    }
    run.chips -= bet;
    run.lastBet = bet;
    run.handNo += 1;
    run.hand = { no: run.handNo, bet, deck, player, dealer, playerDrew: false, dealerDrew: false };
    run.phase = 'draw';

    const dealerEval = pd.evaluateHand(dealer);
    const playerEval = pd.evaluateHand(player);
    // ป๊อกฝั่งไหนก็เปิดวัดเลย (ผู้เล่นป๊อก = ไม่ต้องจั่ว และเจ้ามือไม่จั่วแก้ เหมือนโต๊ะหลายคน)
    if (dealerEval.pok || playerEval.pok) return settle(run);
    return run;
}

/** ผู้เล่นจั่ว/อยู่ → เจ้ามือบอทตัดสินใจ → วัดผล */
function playerAct(run, wantDraw, opts = {}) {
    if (run.phase !== 'draw' || !run.hand) throw new Error('ยังไม่ถึงตาจั่ว');
    const hand = run.hand;
    if (wantDraw) {
        hand.player.push(hand.deck.pop());
        hand.playerDrew = true;
    }
    const dealerPoints = pd.evaluateHand(hand.dealer).points;
    if (pd.shouldBotDraw(dealerPoints, uniformRng(opts.rng))) {
        hand.dealer.push(hand.deck.pop());
        hand.dealerDrew = true;
    }
    return settle(run);
}

function settle(run) {
    const hand = run.hand;
    const playerEval = pd.evaluateHand(hand.player);
    const dealerEval = pd.evaluateHand(hand.dealer);
    const verdict = pd.judge(playerEval, dealerEval);
    const bet = hand.bet;
    let delta = 0;
    let short = false;
    if (verdict.outcome === 'win') {
        delta = bet * verdict.multiplier;
        run.chips += bet + delta;
        run.wins += 1;
    } else if (verdict.outcome === 'lose') {
        const want = bet * verdict.multiplier;
        const extra = Math.min(Math.max(0, want - bet), run.chips);
        run.chips -= extra;
        delta = -(bet + extra);
        short = bet + extra < want;
        run.losses += 1;
    } else {
        run.chips += bet;
        run.pushes += 1;
    }
    run.hands += 1;
    if (playerEval.pok) run.poks += 1;
    if (delta > run.biggestWin) run.biggestWin = delta;
    if (run.chips > run.peak) run.peak = run.chips;

    run.lastResult = {
        handNo: hand.no,
        bet,
        outcome: verdict.outcome,
        multiplier: verdict.multiplier,
        delta,
        short,
        chipsAfter: run.chips,
        playerDrew: !!hand.playerDrew,
        dealerDrew: !!hand.dealerDrew,
        player: { cards: [...hand.player], eval: publicEval(playerEval) },
        dealer: { cards: [...hand.dealer], eval: publicEval(dealerEval) }
    };
    run.hand = null;
    if (isBusted(run)) {
        run.phase = 'busted';
        run.endedAt = Date.now();
    } else {
        run.phase = 'bet';
    }
    return run;
}

function publicEval(ev) {
    return {
        points: ev.points,
        deng: ev.deng,
        pok: ev.pok,
        special: ev.special,
        tier: ev.tier,
        name: ev.name,
        label: ev.label
    };
}

function describeAll(cards) {
    return (cards || []).map(pd.describeCard);
}

/**
 * สิ่งที่ client เห็นได้: ไม่มีสำรับ ไม่มีไพ่เจ้ามือก่อนเปิด
 */
function publicView(run) {
    if (!run) return null;
    const view = {
        runId: run.runId,
        phase: run.phase,
        chips: run.chips,
        handNo: run.handNo,
        nextHandNo: run.phase === 'bet' ? run.handNo + 1 : null,
        minBet: MIN_BET,
        maxBet: maxBetFor(run),
        lastBet: run.lastBet,
        startChips: START_CHIPS,
        run: {
            peak: run.peak,
            hands: run.hands,
            wins: run.wins,
            losses: run.losses,
            pushes: run.pushes,
            poks: run.poks,
            biggestWin: run.biggestWin,
            startedAt: run.startedAt,
            endedAt: run.endedAt
        },
        hand: null,
        lastResult: null
    };
    if (run.phase === 'draw' && run.hand) {
        const ev = pd.evaluateHand(run.hand.player);
        view.hand = {
            no: run.hand.no,
            bet: run.hand.bet,
            player: { cards: describeAll(run.hand.player), eval: publicEval(ev) },
            dealer: { cardCount: run.hand.dealer.length }
        };
    }
    if (run.lastResult) {
        const r = run.lastResult;
        view.lastResult = {
            ...r,
            player: { cards: describeAll(r.player.cards), eval: r.player.eval },
            dealer: { cards: describeAll(r.dealer.cards), eval: r.dealer.eval }
        };
    }
    return view;
}

// ---------- สถิติตลอดกาล (ข้อมูลสาธารณะ: หน้า /solo, โปรไฟล์, ตารางอันดับ) ----------

function emptyStats() {
    return {
        v: 1,
        bestPeak: 0,
        handsPlayed: 0,
        biggestWin: 0,
        pokCount: 0,
        runs: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        longestRun: 0,
        chips: 0,
        updatedAt: null
    };
}

function normalizeStats(data) {
    const base = emptyStats();
    if (!data || typeof data !== 'object') return base;
    Object.keys(base).forEach(key => {
        if (key === 'updatedAt') base[key] = data[key] || null;
        else base[key] = Math.max(0, Math.floor(Number(data[key]) || 0));
    });
    return base;
}

/** รวมผลมือล่าสุดของ run เข้าไปในสถิติตลอดกาล */
function applyHandToStats(prev, run, now = Date.now()) {
    const s = normalizeStats(prev);
    const r = run.lastResult;
    if (r) {
        s.handsPlayed += 1;
        if (r.outcome === 'win') s.wins += 1;
        else if (r.outcome === 'lose') s.losses += 1;
        else s.pushes += 1;
        if (r.player && r.player.eval && r.player.eval.pok) s.pokCount += 1;
        if (r.delta > s.biggestWin) s.biggestWin = r.delta;
    }
    if (run.peak > s.bestPeak) s.bestPeak = run.peak;
    if (run.hands > s.longestRun) s.longestRun = run.hands;
    s.chips = run.chips;
    s.updatedAt = new Date(now).toISOString();
    return s;
}

function applyRunStartToStats(prev, run, now = Date.now()) {
    const s = normalizeStats(prev);
    s.runs += 1;
    if (run.peak > s.bestPeak) s.bestPeak = run.peak;
    s.chips = run.chips;
    s.updatedAt = new Date(now).toISOString();
    return s;
}

/** run ที่อ่านกลับจากไฟล์/DB — ตรวจรูปร่างก่อนใช้ ถ้าพังถือว่าไม่มี */
function reviveRun(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
    if (!['bet', 'draw', 'busted'].includes(raw.phase)) return null;
    if (!Number.isFinite(raw.chips) || raw.chips < 0) return null;
    if (raw.phase === 'draw') {
        const h = raw.hand;
        if (!h || !Array.isArray(h.deck) || !Array.isArray(h.player) || !Array.isArray(h.dealer)) return null;
        try {
            pd.evaluateHand(h.player);
            pd.evaluateHand(h.dealer);
        } catch (error) {
            return null;
        }
    }
    return raw;
}

module.exports = {
    START_CHIPS,
    MIN_BET,
    MAX_BET,
    createRun,
    placeBet,
    playerAct,
    publicView,
    maxBetFor,
    isBusted,
    shuffleDeck,
    emptyStats,
    normalizeStats,
    applyHandToStats,
    applyRunStartToStats,
    reviveRun
};
