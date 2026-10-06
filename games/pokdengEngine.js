/**
 * ป๊อกเด้ง (Pok Deng) — 2–10 คน (รวมเจ้ามือ)
 *
 * ชิปในโต๊ะเท่านั้น (ไม่ผูกกระเป๋า ไม่มีมูลค่าจริง): ทุกคนเริ่ม 1,000
 * เจ้ามือแบบคงที่ (หัวห้อง) เริ่ม 5,000 · ถ้าหมุนเจ้ามือตั้งแต่เริ่มโต๊ะ ทุกคนเริ่ม 1,000 เท่ากัน
 *
 * มือหนึ่ง: ลงเดิมพัน → แจก 2 ใบ (เจ้ามือป๊อก = เปิดวัดทันที) → ขาไพ่จั่ว/อยู่ทีละคน
 * → เจ้ามือจั่ว/อยู่ → วัดกับทุกขาพร้อมกัน → สรุปผล → มือต่อไป
 *
 * แต้ม = ผลรวม mod 10 (A=1, 2–9 ตามหน้า, 10/J/Q/K = 0)
 * ลำดับ: ป๊อก (2 ใบ 8/9) > ตอง > เรียง > เซียน > แต้มปกติ
 * เด้ง (ตัวคูณของฝั่งที่ชนะ): 2 ใบดอกเดียวกัน/คู่ = 2 · 3 ใบดอกเดียวกัน = 3
 *   ตอง = 5 · เรียง = 3 · เซียน = 3
 */

const { gameAssetImage } = require('./gameAssets');

const START_CHIPS = 1000;
const DEALER_BANK = 5000;
const REBUY_CHIPS = 1000;
const MIN_BET = 10;
const TABLE_MAX_BET = 500;
const MAX_EMPTY_HANDS = 3;

const BET_MS = Number(process.env.POKDENG_BET_MS) || 20000;
const DEAL_MS = Number(process.env.POKDENG_DEAL_MS) || 2600;
const DRAW_MS = Number(process.env.POKDENG_DRAW_MS) || 15000;
const DEALER_MS = Number(process.env.POKDENG_DEALER_MS) || 15000;
const RESULT_MS = Number(process.env.POKDENG_RESULT_MS) || 9000;

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_META = {
    S: { icon: '♠', thaiName: 'โพดำ', color: 'black' },
    H: { icon: '♥', thaiName: 'โพแดง', color: 'red' },
    D: { icon: '♦', thaiName: 'ข้าวหลามตัด', color: 'red' },
    C: { icon: '♣', thaiName: 'ดอกจิก', color: 'black' }
};
const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 };
const RANK_ORDER_LOW = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };
const FACES = new Set(['J', 'Q', 'K']);
const CARD_BACK = gameAssetImage('poker', 'back');

const TIER = { NORMAL: 0, SIAN: 1, STRAIGHT: 2, TONG: 3, POK: 4 };
const DENG_WORD = { 1: '', 2: 'สองเด้ง', 3: 'สามเด้ง', 5: 'ห้าเด้ง' };

// ---------- ไพ่ ----------

function parseCard(cardId) {
    const raw = String(cardId || '');
    const suit = raw.slice(-1);
    const rank = raw.slice(0, -1);
    if (!SUIT_META[suit] || RANK_VALUE[rank] === undefined) {
        throw new Error('ไพ่ไม่รู้จัก: ' + raw);
    }
    return { id: raw, rank, suit };
}

function cardPoint(rank) {
    if (rank === 'A') return 1;
    if (rank === '10' || FACES.has(rank)) return 0;
    return Number(rank);
}

function describeCard(cardId) {
    const card = parseCard(cardId);
    const suit = SUIT_META[card.suit];
    return {
        id: card.id,
        rank: card.rank,
        suit: card.suit,
        icon: suit.icon,
        color: suit.color,
        point: cardPoint(card.rank),
        thaiName: `${card.rank}${suit.icon}`,
        image: gameAssetImage('poker', `${card.rank.toLowerCase()}${card.suit.toLowerCase()}`)
    };
}

function buildDeck() {
    const deck = [];
    SUITS.forEach(suit => RANKS.forEach(rank => deck.push(rank + suit)));
    return deck;
}

function shuffle(items, rng = Math.random) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

// ---------- วัดมือ ----------

function straightTop(cards) {
    const ranks = cards.map(c => c.rank);
    if (new Set(ranks).size !== 3) return 0;
    const low = ranks.map(r => RANK_ORDER_LOW[r]).sort((a, b) => a - b);
    if (low[1] === low[0] + 1 && low[2] === low[1] + 1) return low[2]; // A-2-3 … J-Q-K
    const high = ranks.map(r => (r === 'A' ? 14 : RANK_ORDER_LOW[r])).sort((a, b) => a - b);
    if (high[1] === high[0] + 1 && high[2] === high[1] + 1) return high[2]; // Q-K-A
    return 0;
}

/**
 * วัดมือ 2–3 ใบ
 * @returns {{points, tier, tierValue, deng, pok, name, label, cardCount, special}}
 */
function evaluateHand(cardIds) {
    const cards = (cardIds || []).map(parseCard);
    if (cards.length < 2 || cards.length > 3) {
        throw new Error('ต้องมีไพ่ 2–3 ใบ');
    }
    const points = cards.reduce((sum, c) => sum + cardPoint(c.rank), 0) % 10;
    const sameSuit = cards.every(c => c.suit === cards[0].suit);
    let tier = TIER.NORMAL;
    let tierValue = points;
    let deng = 1;
    let name = null;

    if (cards.length === 2) {
        const pair = cards[0].rank === cards[1].rank;
        deng = (pair || sameSuit) ? 2 : 1;
        if (points >= 8) {
            tier = TIER.POK;
            tierValue = points;
            name = `ป๊อก ${points}`;
        }
    } else {
        const tong = cards.every(c => c.rank === cards[0].rank);
        const top = straightTop(cards);
        const sian = cards.every(c => FACES.has(c.rank));
        if (tong) {
            tier = TIER.TONG;
            tierValue = RANK_VALUE[cards[0].rank];
            deng = 5;
            name = 'ตอง';
        } else if (top) {
            tier = TIER.STRAIGHT;
            tierValue = top;
            deng = 3;
            name = sameSuit ? 'เรียง (ดอกเดียวกัน)' : 'เรียง';
        } else if (sian) {
            tier = TIER.SIAN;
            tierValue = 0;
            deng = 3;
            name = 'เซียน';
        } else {
            deng = sameSuit ? 3 : 1;
        }
    }

    if (!name) name = points === 0 ? 'บอด' : `${points} แต้ม`;
    const dengWord = DENG_WORD[deng] || '';
    const special = tier === TIER.TONG || tier === TIER.STRAIGHT || tier === TIER.SIAN;
    const label = special ? `${name} · ${deng} เด้ง` : (dengWord ? `${name} ${dengWord}` : name);
    return {
        points,
        tier,
        tierValue,
        deng,
        pok: tier === TIER.POK,
        special,
        name,
        label,
        cardCount: cards.length
    };
}

/** >0 = a ชนะ, <0 = b ชนะ, 0 = เสมอ */
function compareHands(a, b) {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.tierValue - b.tierValue;
}

/**
 * ผลของขาไพ่เทียบเจ้ามือ
 * @returns {{outcome: 'win'|'lose'|'push', multiplier: number}}
 */
function judge(playerEval, dealerEval) {
    const cmp = compareHands(playerEval, dealerEval);
    if (cmp > 0) return { outcome: 'win', multiplier: playerEval.deng };
    if (cmp < 0) return { outcome: 'lose', multiplier: dealerEval.deng };
    return { outcome: 'push', multiplier: 0 };
}

function shouldBotDraw(points, rng = Math.random) {
    if (points <= 3) return true;
    if (points >= 5) return false;
    return rng() < 0.5;
}

// ---------- state ----------

function createInitialState() {
    return {
        mode: 'pokdeng',
        status: 'waiting',
        phase: 'lobby',
        players: [],
        deck: [],
        dealerId: null,
        rotateDealer: false,
        handNumber: 0,
        step: 0,
        turnNumber: 0,
        toActPlayerId: null,
        drawOrder: [],
        emptyHands: 0,
        lastResult: null,
        readyIds: [],
        standings: null,
        winner: null,
        history: [],
        phaseEndsAt: null,
        statsRecordedAt: null,
        fxSeq: 0,
        fx: []
    };
}

function createPlayerState(player) {
    return {
        playerId: player.playerId,
        name: player.playerName || player.name || 'ผู้เล่น',
        color: player.color || '#f5c86b',
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        chips: START_CHIPS,
        buyIn: START_CHIPS,
        rebuyUsed: false,
        bet: 0,
        lastBet: 0,
        decided: false,
        skipped: false,
        inHand: false,
        hand: [],
        revealed: false,
        done: false,
        drew: false,
        handsPlayed: 0,
        handsDealt: 0,
        left: false
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        rotateDealer: !!room?.settings?.pokdengRotateDealer,
        players: (room.players || []).map(createPlayerState)
    };
}

function getPlayer(room, playerId) {
    return (room.gameState.players || []).find(p => p.playerId === playerId) || null;
}

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function roomEntry(room, playerId) {
    return (room.players || []).find(p => p.playerId === playerId) || null;
}

/** ต่ออยู่จริง: มี socket หรือเป็นบอท และยังไม่ออกจากโต๊ะ */
function isConnected(room, player) {
    if (!player || player.left) return false;
    if (isBotId(player.playerId)) return !!roomEntry(room, player.playerId);
    const entry = roomEntry(room, player.playerId);
    return !!(entry && entry.socketId);
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, ...event }].slice(-16);
}

function pushHistory(room, icon, text, kind = null) {
    room.gameState.history = [
        { icon, text, kind, at: new Date().toISOString() },
        ...(room.gameState.history || [])
    ].slice(0, 40);
}

function bumpStep(room) {
    room.gameState.step = (Number(room.gameState.step) || 0) + 1;
}

function setPhase(room, phase, durationMs) {
    room.gameState.phase = phase;
    room.gameState.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
    bumpStep(room);
}

function assertContext(state, context) {
    if (!context) return;
    const stale = new Error('จังหวะเปลี่ยนไปแล้ว — ดูหน้าจออีกครั้ง');
    if (context.step !== undefined && context.step !== null && Number(context.step) !== Number(state.step)) throw stale;
    if (context.phase && context.phase !== state.phase) throw stale;
    if (context.handNumber !== undefined && context.handNumber !== null
        && Number(context.handNumber) !== Number(state.handNumber)) throw stale;
}

function seatOrderFrom(room, fromId) {
    const order = room.gameState.players;
    const n = order.length;
    const start = order.findIndex(p => p.playerId === fromId);
    const rows = [];
    for (let i = 1; i <= n; i += 1) {
        rows.push(order[((start < 0 ? -1 : start) + i + n) % n]);
    }
    return rows;
}

function maxBetFor(player) {
    return Math.max(0, Math.min(Number(player.chips) || 0, TABLE_MAX_BET));
}

function canRebuy(player) {
    return !!player && !player.left && !player.rebuyUsed && !(Number(player.bet) > 0) && (Number(player.chips) || 0) < MIN_BET;
}

function applyRebuy(room, player, auto = false) {
    player.chips += REBUY_CHIPS;
    player.buyIn += REBUY_CHIPS;
    player.rebuyUsed = true;
    pushHistory(room, '🪙', `${player.name} ขอชิปใหม่ +${REBUY_CHIPS}${auto ? ' (อัตโนมัติ)' : ''}`);
    pushFx(room, { kind: 'rebuy', playerId: player.playerId, amount: REBUY_CHIPS });
}

function syncSeats(room) {
    const state = room.gameState;
    const ids = new Set(state.players.map(p => p.playerId));
    (room.players || []).forEach(entry => {
        if (entry.playerId && !ids.has(entry.playerId)) {
            state.players.push(createPlayerState(entry));
        }
    });
    state.players.forEach(p => {
        if (!roomEntry(room, p.playerId)) p.left = true;
    });
}

function isDealerEligible(room, player) {
    return !!player && isConnected(room, player) && (Number(player.chips) || 0) >= MIN_BET;
}

function nextEligibleDealer(room, fromId) {
    return seatOrderFrom(room, fromId).find(p => isDealerEligible(room, p)) || null;
}

function pickDealer(room) {
    const state = room.gameState;
    const current = getPlayer(room, state.dealerId);
    // เจ้ามือหมดตัว: ใช้สิทธิ์ขอชิปใหม่ให้อัตโนมัติ (ถ้ายังมี) ก่อนเปลี่ยนมือ
    if (!state.rotateDealer && current && isConnected(room, current) && current.chips < MIN_BET && canRebuy(current)) {
        applyRebuy(room, current, true);
    }
    if (state.handNumber === 0 || !current) {
        const host = getPlayer(room, room.admin);
        if (!current && isDealerEligible(room, host)) return host;
        if (current && isDealerEligible(room, current)) return current;
        return nextEligibleDealer(room, room.admin || state.players[0]?.playerId);
    }
    if (state.rotateDealer) {
        return nextEligibleDealer(room, current.playerId);
    }
    if (isDealerEligible(room, current)) return current;
    return nextEligibleDealer(room, current.playerId);
}

function couldBet(room, player) {
    if (!player || player.left || player.playerId === room.gameState.dealerId) return false;
    if (!isConnected(room, player)) return false;
    return player.chips >= MIN_BET || !player.rebuyUsed;
}

function resetHandFlags(player) {
    player.bet = 0;
    player.decided = false;
    player.skipped = false;
    player.inHand = false;
    player.hand = [];
    player.revealed = false;
    player.done = false;
    player.drew = false;
}

function startHand(room) {
    const state = room.gameState;
    syncSeats(room);
    state.players.forEach(resetHandFlags);
    state.toActPlayerId = null;
    state.drawOrder = [];
    state.deck = [];
    state.lastResult = null;
    state.readyIds = [];

    const previousDealer = state.dealerId;
    const dealer = pickDealer(room);
    if (!dealer) {
        return finishTable(room, 'ไม่มีใครเป็นเจ้ามือต่อได้ — จบโต๊ะ');
    }
    state.dealerId = dealer.playerId;
    if (!state.players.some(p => couldBet(room, p))) {
        return finishTable(room, 'เหลือแค่เจ้ามือ — จบโต๊ะ');
    }

    state.handNumber += 1;
    state.turnNumber = 0;
    dealer.handsDealt += 1;
    if (previousDealer && previousDealer !== dealer.playerId) {
        pushHistory(room, '🎩', `${dealer.name} เป็นเจ้ามือ`, 'dealer');
        pushFx(room, { kind: 'dealer', playerId: dealer.playerId });
    }
    setPhase(room, 'bet', BET_MS);
    pushHistory(room, '🪙', `มือที่ ${state.handNumber} — ลงเดิมพัน (${MIN_BET}–${TABLE_MAX_BET})`, 'bet');
    pushFx(room, { kind: 'bet-open', handNumber: state.handNumber });
    return state;
}

function startGame(room) {
    const connected = (room.players || []).filter(p => p.socketId || isBotId(p.playerId));
    if (connected.length < 2 || connected.length > 10) {
        throw new Error('ป๊อกเด้งเล่นได้ 2–10 คน (รวมเจ้ามือ)');
    }
    const state = resetRoomGame(room);
    state.status = 'playing';
    room.gameState = state;
    // เจ้ามือคงที่ = หัวห้องถือกองเจ้ามือ 5,000 · หมุนเจ้ามือ = ทุกคนเริ่มเท่ากัน
    if (!state.rotateDealer) {
        const host = getPlayer(room, room.admin);
        if (host) {
            host.chips = DEALER_BANK;
            host.buyIn = DEALER_BANK;
        }
    }
    pushHistory(room, '🎬', `เปิดโต๊ะป๊อกเด้ง — ชิปในโต๊ะคนละ ${START_CHIPS}${state.rotateDealer ? ' · หมุนเจ้ามือทุกตา' : ` · เจ้ามือถือ ${DEALER_BANK}`}`);
    startHand(room);
    return room.gameState;
}

// ---------- เดิมพัน ----------

function assertCanAct(room) {
    const state = room.gameState;
    if (!state || state.status !== 'playing' || state.phase === 'finished' || state.phase === 'lobby') {
        throw new Error('โต๊ะยังไม่เปิดหรือจบแล้ว');
    }
    return state;
}

function pendingBettors(room) {
    return room.gameState.players.filter(p =>
        p.playerId !== room.gameState.dealerId
        && !p.left
        && !p.decided
        && isConnected(room, p)
        && (p.chips >= MIN_BET || !p.rebuyUsed));
}

function afterBetChange(room) {
    if (room.gameState.phase === 'bet' && pendingBettors(room).length === 0) {
        return dealHand(room);
    }
    return room.gameState;
}

function submitBet(room, playerId, amount, context = null) {
    const state = assertCanAct(room);
    if (state.phase !== 'bet') throw new Error('ยังไม่ถึงช่วงลงเดิมพัน');
    assertContext(state, context);
    const player = getPlayer(room, playerId);
    if (!player || player.left) throw new Error('คุณไม่ได้นั่งโต๊ะนี้');
    if (playerId === state.dealerId) throw new Error('เจ้ามือไม่ต้องลงเดิมพัน');
    if (player.decided) throw new Error('ลงเดิมพันมือนี้ไปแล้ว');
    if (player.chips < MIN_BET) throw new Error('ชิปไม่พอ — กดขอชิปใหม่ก่อน');
    const value = Number(amount);
    if (!Number.isFinite(value) || Math.floor(value) !== value) throw new Error('ยอดเดิมพันไม่ถูกต้อง');
    const max = maxBetFor(player);
    if (value < MIN_BET) throw new Error(`ลงขั้นต่ำ ${MIN_BET}`);
    if (value > max) throw new Error(`ลงได้สูงสุด ${max}`);

    player.chips -= value;
    player.bet = value;
    player.lastBet = value;
    player.decided = true;
    player.inHand = true;
    pushFx(room, { kind: 'chips', playerId, amount: value });
    return afterBetChange(room);
}

function submitSkip(room, playerId, context = null) {
    const state = assertCanAct(room);
    if (state.phase !== 'bet') throw new Error('ยังไม่ถึงช่วงลงเดิมพัน');
    assertContext(state, context);
    const player = getPlayer(room, playerId);
    if (!player || player.left) throw new Error('คุณไม่ได้นั่งโต๊ะนี้');
    if (playerId === state.dealerId) throw new Error('เจ้ามือข้ามมือไม่ได้');
    if (player.decided) throw new Error('ตัดสินใจมือนี้ไปแล้ว');
    player.decided = true;
    player.skipped = true;
    pushHistory(room, '💤', `${player.name} ข้ามมือนี้`);
    return afterBetChange(room);
}

function submitRebuy(room, playerId) {
    const state = assertCanAct(room);
    const player = getPlayer(room, playerId);
    if (!player || player.left) throw new Error('คุณไม่ได้นั่งโต๊ะนี้');
    if (player.rebuyUsed) throw new Error('ขอชิปใหม่ได้ครั้งเดียวต่อโต๊ะ');
    if (Number(player.bet) > 0) throw new Error('รอจบมือนี้ก่อน');
    if (player.chips >= MIN_BET) throw new Error('ยังมีชิปพอเล่น');
    applyRebuy(room, player);
    return state;
}

// ---------- แจก / จั่ว ----------

function handPlayers(room) {
    return room.gameState.players.filter(p => p.inHand);
}

function dealHand(room) {
    const state = room.gameState;
    const bettors = handPlayers(room);
    const dealer = getPlayer(room, state.dealerId);
    state.toActPlayerId = null;
    if (!bettors.length || !dealer) {
        state.emptyHands = (Number(state.emptyHands) || 0) + 1;
        pushHistory(room, '💤', 'ไม่มีใครลงเดิมพันมือนี้');
        if (state.emptyHands >= MAX_EMPTY_HANDS) {
            return finishTable(room, `ไม่มีใครลงเดิมพัน ${MAX_EMPTY_HANDS} มือติด — จบโต๊ะ`);
        }
        state.lastResult = { empty: true, rows: [], dealer: null, shortfall: false };
        state.readyIds = [];
        setPhase(room, 'result', Math.min(RESULT_MS, 4000));
        return state;
    }
    state.emptyHands = 0;
    // riggedDeck: ใช้ในเทสต์เท่านั้น (ตั้งได้จากฝั่งเซิร์ฟเวอร์ ไม่มีทางมาจาก client) — pop จากท้าย
    state.deck = Array.isArray(room.riggedDeck) && room.riggedDeck.length
        ? room.riggedDeck.splice(0)
        : shuffle(buildDeck());
    const order = [...seatOrderFrom(room, dealer.playerId).filter(p => p.inHand), dealer];
    dealer.hand = [];
    dealer.done = false;
    dealer.revealed = false;
    for (let round = 0; round < 2; round += 1) {
        order.forEach(p => p.hand.push(state.deck.pop()));
    }
    bettors.forEach(p => { p.handsPlayed += 1; });

    const dealerEval = evaluateHand(dealer.hand);
    pushFx(room, { kind: 'deal', order: order.map(p => p.playerId), handNumber: state.handNumber });
    pushHistory(room, '🃏', `แจกไพ่คนละ 2 ใบ (${bettors.length} ขา)`, 'deal');

    if (dealerEval.pok) {
        dealer.revealed = true;
        bettors.forEach(p => { p.revealed = true; p.done = true; });
        pushHistory(room, '💥', `เจ้ามือ ${dealer.name} ป๊อก ${dealerEval.points}! เปิดวัดทันที`, 'pok');
        pushFx(room, { kind: 'pok', playerId: dealer.playerId, points: dealerEval.points, dealer: true });
        return settleHand(room);
    }

    bettors.forEach(p => {
        const ev = evaluateHand(p.hand);
        if (ev.pok) {
            p.revealed = true;
            p.done = true;
            pushHistory(room, '✨', `${p.name} ป๊อก ${ev.points}${ev.deng > 1 ? ' สองเด้ง' : ''}`, 'pok');
            pushFx(room, { kind: 'pok', playerId: p.playerId, points: ev.points });
        }
    });
    state.drawOrder = order.filter(p => p.playerId !== dealer.playerId).map(p => p.playerId);
    setPhase(room, 'deal', DEAL_MS);
    return state;
}

function nextDrawer(room) {
    const state = room.gameState;
    return (state.drawOrder || [])
        .map(id => getPlayer(room, id))
        .find(p => p && p.inHand && !p.done) || null;
}

function drawCard(room, player) {
    const card = room.gameState.deck.pop();
    player.hand.push(card);
    player.drew = true;
    return card;
}

function advanceDraw(room) {
    const state = room.gameState;
    // ขาที่หลุด/ออกไป = อยู่ (ไม่จั่ว) ทันที ไม่ต้องรอเวลา
    let next = nextDrawer(room);
    while (next && !isConnected(room, next)) {
        next.done = true;
        pushHistory(room, '⏭️', `${next.name} ไม่อยู่ — อยู่อัตโนมัติ`);
        next = nextDrawer(room);
    }
    if (next) {
        state.toActPlayerId = next.playerId;
        state.turnNumber += 1;
        setPhase(room, 'draw', DRAW_MS);
        return state;
    }
    return beginDealerTurn(room);
}

function beginDealerTurn(room) {
    const state = room.gameState;
    const dealer = getPlayer(room, state.dealerId);
    state.toActPlayerId = dealer ? dealer.playerId : null;
    if (!dealer) return settleHand(room);
    // ทุกขาป๊อกหมด — เจ้ามือจั่วไปก็ไม่เปลี่ยนผล วัดเลย
    if (handPlayers(room).every(p => evaluateHand(p.hand.slice(0, 2)).pok)) return settleHand(room);
    if (!isConnected(room, dealer)) {
        const ev = evaluateHand(dealer.hand);
        if (ev.points <= 3) drawCard(room, dealer);
        pushHistory(room, '⏭️', `เจ้ามือไม่อยู่ — ${dealer.hand.length === 3 ? 'จั่วให้' : 'อยู่ให้'}อัตโนมัติ`);
        return settleHand(room);
    }
    state.turnNumber += 1;
    setPhase(room, 'dealer', DEALER_MS);
    return state;
}

function submitDraw(room, playerId, wantDraw, context = null) {
    const state = assertCanAct(room);
    if (state.phase !== 'draw') throw new Error('ยังไม่ถึงช่วงจั่ว');
    assertContext(state, context);
    if (state.toActPlayerId !== playerId) throw new Error('ยังไม่ถึงตาคุณ');
    const player = getPlayer(room, playerId);
    if (!player || !player.inHand || player.done) throw new Error('คุณไม่ได้อยู่ในมือนี้');
    if (wantDraw) {
        drawCard(room, player);
        pushHistory(room, '🂠', `${player.name} จั่ว`);
        pushFx(room, { kind: 'draw', playerId });
    } else {
        pushHistory(room, '✋', `${player.name} อยู่`);
        pushFx(room, { kind: 'stay', playerId });
    }
    player.done = true;
    return advanceDraw(room);
}

function submitDealerDecision(room, playerId, wantDraw, context = null) {
    const state = assertCanAct(room);
    if (state.phase !== 'dealer') throw new Error('ยังไม่ถึงตาเจ้ามือ');
    assertContext(state, context);
    if (state.dealerId !== playerId) throw new Error('คุณไม่ใช่เจ้ามือ');
    const dealer = getPlayer(room, playerId);
    if (wantDraw) {
        drawCard(room, dealer);
        pushHistory(room, '🂠', `เจ้ามือ ${dealer.name} จั่ว`);
        pushFx(room, { kind: 'draw', playerId, dealer: true });
    } else {
        pushHistory(room, '✋', `เจ้ามือ ${dealer.name} อยู่`);
    }
    return settleHand(room);
}

// ---------- วัดและจ่าย ----------

function settleHand(room) {
    const state = room.gameState;
    const dealer = getPlayer(room, state.dealerId);
    const players = handPlayers(room);
    const dealerEval = evaluateHand(dealer.hand);
    const dealerStart = dealer.chips;
    dealer.revealed = true;
    dealer.done = true;

    const rows = players.map(p => {
        p.revealed = true;
        p.done = true;
        const ev = evaluateHand(p.hand);
        const verdict = judge(ev, dealerEval);
        return { player: p, ev, ...verdict, bet: p.bet, owed: verdict.outcome === 'win' ? p.bet * verdict.multiplier : 0, paid: 0, delta: 0 };
    });

    // ขาที่แพ้จ่ายเข้าเจ้ามือก่อน (เงินเดิมพันที่วางไว้ + ส่วนเด้ง ไม่เกินชิปที่มี)
    let pool = dealer.chips;
    rows.filter(r => r.outcome === 'lose').forEach(r => {
        const want = r.bet * r.multiplier;
        const extra = Math.min(Math.max(0, want - r.bet), r.player.chips);
        r.player.chips -= extra;
        r.paid = r.bet + extra;
        r.delta = -r.paid;
        r.short = r.paid < want;
        pool += r.paid;
    });

    // เสมอ = คืนเดิมพัน
    rows.filter(r => r.outcome === 'push').forEach(r => {
        r.player.chips += r.bet;
        r.delta = 0;
    });

    // ขาที่ชนะ: คืนเดิมพัน + ได้ bet × เด้ง จากกองเจ้ามือ (ไม่พอ = แบ่งตามสัดส่วน)
    const winners = rows.filter(r => r.outcome === 'win');
    const owedTotal = winners.reduce((sum, r) => sum + r.owed, 0);
    let shortfall = false;
    if (owedTotal <= pool) {
        winners.forEach(r => { r.won = r.owed; });
        pool -= owedTotal;
    } else {
        shortfall = true;
        let handed = 0;
        winners.forEach(r => {
            r.won = Math.floor((r.owed * pool) / owedTotal);
            handed += r.won;
        });
        let leftover = pool - handed;
        for (let i = 0; leftover > 0 && winners.length; i = (i + 1) % winners.length) {
            if (winners[i].won < winners[i].owed) {
                winners[i].won += 1;
                leftover -= 1;
            } else if (winners.every(r => r.won >= r.owed)) {
                break;
            }
        }
        pool = leftover;
        pushHistory(room, '⚠️', `เจ้ามือ ${dealer.name} จ่ายไม่ครบ — แบ่งจ่ายตามสัดส่วน`, 'shortfall');
    }
    winners.forEach(r => {
        r.player.chips += r.bet + r.won;
        r.delta = r.won;
        r.short = r.won < r.owed;
    });
    dealer.chips = pool;
    const dealerDelta = dealer.chips - dealerStart;

    players.forEach(p => { p.bet = 0; });
    const describe = r => ({
        playerId: r.player.playerId,
        name: r.player.name,
        cards: r.player.hand.map(describeCard),
        points: r.ev.points,
        deng: r.ev.deng,
        label: r.ev.label,
        pok: r.ev.pok,
        special: r.ev.special,
        outcome: r.outcome,
        multiplier: r.multiplier,
        bet: r.bet,
        delta: r.delta,
        short: !!r.short,
        chips: r.player.chips
    });
    state.lastResult = {
        handNumber: state.handNumber,
        empty: false,
        shortfall,
        dealer: {
            playerId: dealer.playerId,
            name: dealer.name,
            cards: dealer.hand.map(describeCard),
            points: dealerEval.points,
            deng: dealerEval.deng,
            label: dealerEval.label,
            pok: dealerEval.pok,
            special: dealerEval.special,
            delta: dealerDelta,
            chips: dealer.chips
        },
        rows: rows.map(describe)
    };
    state.toActPlayerId = null;
    const wins = rows.filter(r => r.outcome === 'win').length;
    const losses = rows.filter(r => r.outcome === 'lose').length;
    pushHistory(room, '🏁', `มือที่ ${state.handNumber}: เจ้ามือ${dealerEval.label} · ขาชนะ ${wins} แพ้ ${losses} · เจ้ามือ ${dealerDelta >= 0 ? '+' : ''}${dealerDelta}`, 'result');
    pushFx(room, { kind: 'reveal', handNumber: state.handNumber });
    state.readyIds = [];
    setPhase(room, 'result', RESULT_MS);
    // บอทหมดตัวใช้สิทธิ์ขอชิปใหม่เอง โต๊ะจะได้ไม่เงียบ
    state.players.forEach(p => {
        if (isBotId(p.playerId) && canRebuy(p)) applyRebuy(room, p, true);
    });
    return state;
}

function refundBets(room) {
    room.gameState.players.forEach(p => {
        if (p.bet > 0) {
            p.chips += p.bet;
            p.bet = 0;
        }
        p.inHand = false;
    });
}

function computeStandings(room) {
    return room.gameState.players
        .filter(p => p.handsPlayed > 0 || p.handsDealt > 0)
        .map(p => ({
            playerId: p.playerId,
            name: p.name,
            chips: p.chips,
            buyIn: p.buyIn,
            net: p.chips - p.buyIn,
            won: p.chips > p.buyIn,
            left: !!p.left
        }))
        .sort((a, b) => b.net - a.net);
}

function finishTable(room, reason) {
    const state = room.gameState;
    if (['bet', 'deal', 'draw', 'dealer'].includes(state.phase)) refundBets(room);
    state.players.forEach(p => { p.inHand = false; p.bet = 0; });
    state.phase = 'finished';
    state.status = 'pokdeng_finished';
    state.phaseEndsAt = null;
    state.toActPlayerId = null;
    state.standings = computeStandings(room);
    const top = state.standings[0];
    state.winner = top && top.net > 0
        ? { playerId: top.playerId, name: top.name, net: top.net }
        : { playerId: null, name: 'ไม่มีใครได้กำไร', net: 0 };
    bumpStep(room);
    pushHistory(room, '🏁', reason || 'จบโต๊ะ', 'finished');
    pushFx(room, { kind: 'finished' });
    return state;
}

function endTable(room, playerId) {
    const state = assertCanAct(room);
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่จบโต๊ะได้');
    return finishTable(room, 'หัวห้องจบโต๊ะ');
}

function nextHand(room, playerId) {
    const state = assertCanAct(room);
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่เริ่มมือต่อไปได้');
    if (state.phase !== 'result') throw new Error('ยังไม่จบมือ');
    return startHand(room);
}

/** คนจริงที่ยังต่ออยู่ (ไม่นับบอท) — ใช้ตัดสินว่า "พร้อมครบ" */
function connectedHumans(room) {
    return room.gameState.players.filter(p => !isBotId(p.playerId) && isConnected(room, p));
}

function allHumansReady(room) {
    const ready = new Set(room.gameState.readyIds || []);
    const humans = connectedHumans(room);
    return humans.length > 0 && humans.every(p => ready.has(p.playerId));
}

/**
 * ดูผลจบแล้ว กด "พร้อม" — คนจริงที่ต่ออยู่พร้อมครบ = เริ่มมือต่อไปเลย ไม่ต้องรอนาฬิกา
 * (หัวห้องยังกด "มือต่อไป" ข้ามได้ทันทีเหมือนเดิม)
 */
function submitReady(room, playerId) {
    const state = assertCanAct(room);
    if (state.phase !== 'result') throw new Error('ยังไม่จบมือ');
    const player = getPlayer(room, playerId);
    if (!player || player.left) throw new Error('คุณไม่ได้นั่งโต๊ะนี้');
    const ready = new Set(state.readyIds || []);
    ready.add(playerId);
    state.readyIds = [...ready];
    if (allHumansReady(room)) return startHand(room);
    return state;
}

/** มือหน้าใครเป็นเจ้ามือ (ดูอย่างเดียว ไม่แตะ state) — แสดงให้รู้ล่วงหน้าตอนหมุนเจ้ามือ */
function previewNextDealer(room) {
    const state = room.gameState;
    if (!state.rotateDealer || !state.dealerId) return null;
    return nextEligibleDealer(room, state.dealerId);
}

function setRotateDealer(room, playerId, enabled) {
    const state = assertCanAct(room);
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่ตั้งค่าเจ้ามือได้');
    state.rotateDealer = !!enabled;
    if (room.settings) room.settings.pokdengRotateDealer = !!enabled;
    pushHistory(room, '🔁', enabled ? 'หมุนเจ้ามือทุกตา (เริ่มมือหน้า)' : 'เจ้ามือคงที่ (เริ่มมือหน้า)');
    return state;
}

// ---------- หมดเวลา / บอท / คนออก ----------

function autoResolvePhase(room) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return state;
    if (state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;

    if (state.phase === 'bet') {
        pendingBettors(room).forEach(p => {
            if (isBotId(p.playerId) && canRebuy(p)) applyRebuy(room, p, true);
            if (p.chips >= MIN_BET && isConnected(room, p)) {
                p.chips -= MIN_BET;
                p.bet = MIN_BET;
                p.lastBet = p.lastBet || MIN_BET;
                p.decided = true;
                p.inHand = true;
                pushHistory(room, '⏰', `${p.name} หมดเวลา — ลงขั้นต่ำ ${MIN_BET}`);
                pushFx(room, { kind: 'chips', playerId: p.playerId, amount: MIN_BET });
            } else {
                p.decided = true;
                p.skipped = true;
            }
        });
        return dealHand(room);
    }
    if (state.phase === 'deal') return advanceDraw(room);
    if (state.phase === 'draw') {
        const actor = getPlayer(room, state.toActPlayerId);
        if (actor && !actor.done) {
            actor.done = true;
            pushHistory(room, '⏰', `${actor.name} หมดเวลา — อยู่`);
        }
        return advanceDraw(room);
    }
    if (state.phase === 'dealer') {
        const dealer = getPlayer(room, state.dealerId);
        if (dealer && dealer.hand.length === 2) {
            const ev = evaluateHand(dealer.hand);
            if (ev.points <= 3) {
                drawCard(room, dealer);
                pushHistory(room, '⏰', `เจ้ามือหมดเวลา — จั่วให้ (${ev.points} แต้ม)`);
            } else {
                pushHistory(room, '⏰', 'เจ้ามือหมดเวลา — อยู่');
            }
        }
        return settleHand(room);
    }
    if (state.phase === 'result') return startHand(room);
    return state;
}

function botBetAmount(player, rng = Math.random) {
    const choices = [20, 30, 50, 50, 100, 100, 150, 200];
    const pick = choices[Math.floor(rng() * choices.length)];
    const scaled = Math.max(MIN_BET, Math.round((player.chips * 0.08) / 10) * 10);
    const want = Math.min(pick, scaled);
    return Math.max(MIN_BET, Math.min(maxBetFor(player), want));
}

function playBotTurns(room, rng = Math.random) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return false;
    let acted = false;

    if (state.phase === 'bet') {
        state.players
            .filter(p => isBotId(p.playerId) && !p.left && !p.decided && p.playerId !== state.dealerId)
            .forEach(bot => {
                if (room.gameState.phase !== 'bet') return;
                try {
                    if (canRebuy(bot)) applyRebuy(room, bot, true);
                    if (bot.chips >= MIN_BET) submitBet(room, bot.playerId, botBetAmount(bot, rng));
                    else submitSkip(room, bot.playerId);
                    acted = true;
                } catch (error) {
                    // เฟสเปลี่ยนระหว่างลูปได้
                }
            });
        return acted;
    }

    if (state.phase === 'draw') {
        const actor = getPlayer(room, state.toActPlayerId);
        if (!actor || !isBotId(actor.playerId)) return false;
        const ev = evaluateHand(actor.hand);
        submitDraw(room, actor.playerId, shouldBotDraw(ev.points, rng));
        return true;
    }

    if (state.phase === 'dealer') {
        const dealer = getPlayer(room, state.dealerId);
        if (!dealer || !isBotId(dealer.playerId)) return false;
        const ev = evaluateHand(dealer.hand);
        submitDealerDecision(room, dealer.playerId, shouldBotDraw(ev.points, rng));
        return true;
    }
    return false;
}

function botNeedsTurn(room) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return false;
    if (state.phase === 'bet') {
        return state.players.some(p => isBotId(p.playerId) && !p.left && !p.decided && p.playerId !== state.dealerId);
    }
    if (state.phase === 'draw') return isBotId(state.toActPlayerId);
    if (state.phase === 'dealer') return isBotId(state.dealerId);
    return false;
}

function handlePlayerLeft(room, playerId) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return state;
    const player = getPlayer(room, playerId);
    if (!player || player.left) return state;
    player.left = true;
    pushHistory(room, '🚪', `${player.name} ออกจากโต๊ะ`);

    const others = state.players.filter(p => !p.left && roomEntry(room, p.playerId));
    const inHandPhase = ['bet', 'deal', 'draw', 'dealer'].includes(state.phase);

    if (others.length < 2) {
        return finishTable(room, 'เหลือผู้เล่นไม่พอ — จบโต๊ะ');
    }

    if (playerId === state.dealerId && inHandPhase) {
        refundBets(room);
        pushHistory(room, '↩️', 'เจ้ามือออกกลางมือ — ยกเลิกมือนี้ คืนเดิมพันทุกคน');
        return startHand(room);
    }

    if (state.phase === 'bet') {
        if (player.bet > 0) {
            player.chips += player.bet;
            player.bet = 0;
        }
        player.inHand = false;
        player.decided = true;
        return afterBetChange(room);
    }
    if (state.phase === 'draw' && state.toActPlayerId === playerId) {
        player.done = true;
        return advanceDraw(room);
    }
    // คนที่ยังไม่กดพร้อมออกไป — ที่เหลือพร้อมครบแล้วก็ไปมือต่อไปเลย
    if (state.phase === 'result' && (state.readyIds || []).length && allHumansReady(room)) {
        return startHand(room);
    }
    return state;
}

// ---------- ส่งให้ client ----------

function getAvailableActions(room, viewerId) {
    const state = room.gameState;
    const player = getPlayer(room, viewerId);
    const isHost = room.admin === viewerId;
    const playing = state.status === 'playing' && state.phase !== 'finished';
    const base = {
        canBet: false,
        canSkip: false,
        canDraw: false,
        canDealerDecide: false,
        canRebuy: false,
        canNext: false,
        canReady: false,
        canEnd: isHost && playing,
        canToggleRotate: isHost && playing,
        minBet: MIN_BET,
        maxBet: player ? maxBetFor(player) : 0,
        defaultBet: 0
    };
    if (!player || player.left || !playing) return base;
    const isDealer = state.dealerId === viewerId;
    const actions = { ...base, canRebuy: canRebuy(player) };
    if (state.phase === 'bet' && !isDealer && !player.decided && player.chips >= MIN_BET) {
        actions.canBet = true;
        actions.canSkip = true;
        actions.defaultBet = Math.max(MIN_BET, Math.min(maxBetFor(player), player.lastBet || MIN_BET));
    }
    // ชิปหมดแต่ยังขอชิปใหม่ได้: ให้ข้ามมือนี้ได้ด้วย ไม่งั้นทั้งโต๊ะต้องรอนาฬิกาเดิมพันหมด
    if (state.phase === 'bet' && !isDealer && !player.decided && actions.canRebuy) {
        actions.canSkip = true;
    }
    if (state.phase === 'draw' && state.toActPlayerId === viewerId && player.inHand && !player.done) {
        actions.canDraw = true;
    }
    if (state.phase === 'dealer' && isDealer) actions.canDealerDecide = true;
    if (state.phase === 'result' && isHost) actions.canNext = true;
    if (state.phase === 'result' && !isBotId(viewerId) && !(state.readyIds || []).includes(viewerId)) actions.canReady = true;
    return actions;
}

function publicEval(cards) {
    if (!cards || cards.length < 2) return null;
    const ev = evaluateHand(cards);
    return { points: ev.points, deng: ev.deng, label: ev.label, pok: ev.pok, special: ev.special, name: ev.name };
}

function buildClientState(room, viewerId) {
    const state = room.gameState || createInitialState();
    const viewer = getPlayer(room, viewerId);
    const dealer = getPlayer(room, state.dealerId);
    const finished = state.phase === 'finished';
    const showdown = state.phase === 'result' || finished;

    const seat = p => {
        const self = p.playerId === viewerId;
        const open = self || p.revealed;
        return {
            playerId: p.playerId,
            name: p.name,
            color: p.color,
            avatar: p.avatar,
            avatarFrame: p.avatarFrame,
            chips: p.chips,
            bet: p.bet,
            decided: p.decided,
            skipped: p.skipped,
            inHand: p.inHand,
            done: p.done,
            drew: p.drew,
            left: !!p.left,
            online: isConnected(room, p),
            isBot: isBotId(p.playerId),
            isSelf: self,
            isDealer: p.playerId === state.dealerId,
            isTurn: p.playerId === state.toActPlayerId,
            rebuyUsed: p.rebuyUsed,
            net: p.chips - p.buyIn + (p.bet || 0),
            cardCount: (p.hand || []).length,
            revealed: !!p.revealed,
            cards: open ? (p.hand || []).map(describeCard) : null,
            eval: open ? publicEval(p.hand) : null
        };
    };

    return {
        mode: 'pokdeng',
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        handNumber: state.handNumber,
        turnNumber: state.turnNumber,
        phaseEndsAt: state.phaseEndsAt,
        toActPlayerId: state.toActPlayerId,
        toActName: getPlayer(room, state.toActPlayerId)?.name || null,
        drawOrder: Array.isArray(state.drawOrder) ? [...state.drawOrder] : [],
        readyIds: Array.isArray(state.readyIds) ? [...state.readyIds] : [],
        readyNeeded: state.phase === 'result' ? connectedHumans(room).length : 0,
        nextDealer: (() => {
            const next = state.phase === 'result' ? previewNextDealer(room) : null;
            return next ? { playerId: next.playerId, name: next.name } : null;
        })(),
        dealerId: state.dealerId,
        dealerName: dealer ? dealer.name : null,
        rotateDealer: !!state.rotateDealer,
        isHost: room.admin === viewerId,
        limits: { minBet: MIN_BET, maxBet: TABLE_MAX_BET, startChips: START_CHIPS, dealerBank: DEALER_BANK, rebuy: REBUY_CHIPS },
        timers: { bet: BET_MS, draw: DRAW_MS, dealer: DEALER_MS, result: RESULT_MS },
        lastResult: showdown ? state.lastResult : null,
        standings: finished ? state.standings : null,
        winner: finished ? state.winner : null,
        history: state.history || [],
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        cardBack: CARD_BACK,
        self: viewer ? {
            playerId: viewer.playerId,
            chips: viewer.chips,
            buyIn: viewer.buyIn,
            bet: viewer.bet,
            lastBet: viewer.lastBet,
            decided: viewer.decided,
            skipped: viewer.skipped,
            inHand: viewer.inHand,
            done: viewer.done,
            rebuyUsed: viewer.rebuyUsed,
            isDealer: viewer.playerId === state.dealerId,
            left: !!viewer.left,
            cards: (viewer.hand || []).map(describeCard),
            eval: publicEval(viewer.hand)
        } : null,
        players: (state.players || []).map(seat),
        availableActions: getAvailableActions(room, viewerId),
        fx: state.fx || []
    };
}

function totalChips(room) {
    return (room.gameState.players || []).reduce((sum, p) => sum + (Number(p.chips) || 0) + (Number(p.bet) || 0), 0);
}

function totalBuyIn(room) {
    return (room.gameState.players || []).reduce((sum, p) => sum + (Number(p.buyIn) || 0), 0);
}

module.exports = {
    id: 'pokdeng',
    label: 'ป๊อกเด้ง',
    description: 'แจก 2 ใบ ป๊อก 8/9 เปิดเลย จั่วเพิ่มได้ 1 ใบ วัดกับเจ้ามือ ดอกเดียวกันได้เด้ง — 2–10 คน',
    minPlayers: 2,
    maxPlayers: 10,
    START_CHIPS,
    DEALER_BANK,
    REBUY_CHIPS,
    MIN_BET,
    TABLE_MAX_BET,
    TIER,
    CARD_BACK,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    startHand,
    submitBet,
    submitSkip,
    submitRebuy,
    submitDraw,
    submitDealerDecision,
    nextHand,
    submitReady,
    previewNextDealer,
    endTable,
    setRotateDealer,
    autoResolvePhase,
    playBotTurns,
    botNeedsTurn,
    handlePlayerLeft,
    buildClientState,
    evaluateHand,
    compareHands,
    judge,
    shouldBotDraw,
    describeCard,
    buildDeck,
    isBotId,
    totalChips,
    totalBuyIn
};
