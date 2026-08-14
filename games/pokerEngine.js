/**
 * ห้าใบเก / สี่ใบเก — กติกาเก้าเก
 * ห้าใบ: แจก 5 ทิ้ง 2 → เดิมพันไม้เดียว → วัด 3 ใบ
 * สี่ใบ: แจก 4 ทิ้ง 2 → เดิมพันไม้เดียว → แจกใบ 3 หงายฟรี → วัดทันที
 */

const walletManager = require('../managers/walletManager');
const {
    CARD_BACK,
    CATEGORY,
    describeCard,
    buildDeck,
    shuffle,
    parseCardId,
    evaluateHand,
    bestThreeFrom,
    rankGuideForClient
} = require('./pokerHands');

const SELECT_MS = Number(process.env.POKER_SELECT_MS) || 30000;
const BET_MS = Number(process.env.POKER_BET_MS) || 10000;
const DEAL3_MS = Number(process.env.POKER_DEAL3_MS) || 1800;
const REVEAL_MS = Number(process.env.POKER_REVEAL_MS) || 4000;
const BETWEEN_MS = Number(process.env.POKER_BETWEEN_MS) || 8000;
const FUN_STACK = 10000;
const DEFAULT_ANTE = 500;

const VARIANT_META = {
    poker5: {
        id: 'poker5',
        kind: 'three',
        label: 'ไพ่ 5 ใบ',
        description: 'ได้ 5 ทิ้ง 2 ลงชิปรอบนึง แล้วเปิด 3 ใบเทียบ — 2–10 คน',
        dealCount: 5,
        selectCount: 2,
        selectMode: 'discard',
        keepCount: 3,
        hasThird: false,
        minPlayers: 2,
        maxPlayers: 10
    },
    poker4: {
        id: 'poker4',
        kind: 'three',
        label: 'สี่ใบเก',
        description: 'ได้ 4 ทิ้ง 2 ลงชิปรอบนึง แล้วได้ใบที่ 3 หงายให้ดู — 2–10 คน',
        dealCount: 4,
        selectCount: 2,
        selectMode: 'discard',
        keepCount: 2,
        hasThird: true,
        minPlayers: 2,
        maxPlayers: 10
    }
};

function variantOf(room) {
    const mode = room?.settings?.gameMode || room?.gameState?.mode;
    return VARIANT_META[mode] || VARIANT_META.poker5;
}

function createInitialState(variantId = 'poker5') {
    const meta = VARIANT_META[variantId] || VARIANT_META.poker5;
    return {
        mode: meta.id,
        status: 'waiting',
        phase: 'lobby',
        tableType: 'fun',
        ante: DEFAULT_ANTE,
        players: [],
        deck: [],
        board: [],
        pot: 0,
        currentBet: 0,
        raiseCount: 0,
        toActPlayerId: null,
        dealerIndex: 0,
        handNumber: 0,
        history: [],
        lastResult: null,
        winner: null,
        phaseEndsAt: null,
        statsRecordedAt: null,
        adminPeekIds: [],
        fxSeq: 0,
        fx: []
    };
}

const SAY_TEXT = {
    fold: 'หมอบ',
    check: 'ผ่าน',
    call: 'ตาม',
    bet: 'สู้',
    raise: 'เกทับ',
    allin: 'หมดหน้าตัก'
};

function pushSay(room, player, verb, extra) {
    const base = SAY_TEXT[verb] || verb;
    const text = extra ? `${base} ${extra}` : base;
    player.lastSay = text;
    pushFx(room, { kind: 'say', fromId: player.playerId, text });
    player.lastSaySeq = room.gameState.fxSeq || 0;
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (state.fxSeq || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, ...event }].slice(-16);
}

function pushHistory(room, icon, text, kind = null) {
    room.gameState.history = [
        { icon, text, kind, at: new Date().toISOString() },
        ...(room.gameState.history || [])
    ].slice(0, 40);
}

function setPhase(room, phase, durationMs) {
    room.gameState.phase = phase;
    room.gameState.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
}

function createPlayerState(player) {
    return {
        playerId: player.playerId,
        name: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        hand: [],
        kept: [],
        ready: false,
        discarded: [],
        sittingOut: false,
        folded: false,
        allIn: false,
        acted: false,
        streetBet: 0,
        committed: 0,
        lastSay: null,
        lastSaySeq: 0,
        upCard: null,
        stack: FUN_STACK,
        bestName: null
    };
}

function getPlayer(room, playerId) {
    return room.gameState.players.find(p => p.playerId === playerId) || null;
}

function seatedPlayers(room) {
    return room.gameState.players.filter(p => !p.sittingOut);
}

function livePlayers(room) {
    return seatedPlayers(room).filter(p => !p.folded);
}

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function liveRoomIds(room) {
    return new Set((room.players || []).map(player => player.playerId).filter(Boolean));
}

function pruneAbsentPlayers(room) {
    const state = room.gameState;
    const liveIds = liveRoomIds(room);
    state.players = (state.players || []).filter(player => liveIds.has(player.playerId));
    if (state.players.length) {
        state.dealerIndex = ((state.dealerIndex % state.players.length) + state.players.length) % state.players.length;
    } else {
        state.dealerIndex = 0;
    }
}

function syncSeats(room) {
    pruneAbsentPlayers(room);
    const state = room.gameState;
    const seatedIds = new Set(state.players.map(player => player.playerId));
    (room.players || []).forEach(roomPlayer => {
        if (roomPlayer.playerId && !seatedIds.has(roomPlayer.playerId)) {
            state.players.push(createPlayerState(roomPlayer));
        }
    });
}

function finishTable(room, reason) {
    const state = room.gameState;
    const leftover = livePlayers(room);
    if (state.pot && leftover.length) {
        payPot(room, leftover);
    } else {
        state.pot = 0;
    }
    state.phase = 'finished';
    state.status = 'poker_finished';
    state.phaseEndsAt = null;
    state.toActPlayerId = null;
    pushHistory(room, '🏁', reason || 'จบโต๊ะ');
    return state;
}

function pickDealerIndex(state, rotate) {
    const bots = state.players
        .map((player, index) => ({ player, index }))
        .filter(row => isBotId(row.player.playerId) && !row.player.sittingOut);
    if (!bots.length) {
        if (!rotate) return 0;
        return (state.dealerIndex + 1) % Math.max(1, state.players.length);
    }
    if (!rotate) return bots[0].index;
    const at = bots.findIndex(row => row.index === state.dealerIndex);
    return bots[((at < 0 ? 0 : at) + 1) % bots.length].index;
}

function resetRoomGame(room) {
    const meta = variantOf(room);
    const tableType = room.settings?.pokerTableType === 'cash' ? 'cash' : 'fun';
    const ante = Math.max(10, Number(room.settings?.pokerAnte) || DEFAULT_ANTE);
    return {
        ...createInitialState(meta.id),
        tableType,
        ante,
        players: room.players.map(createPlayerState),
        adminPeekIds: Array.isArray(room.gameState?.adminPeekIds) ? [...room.gameState.adminPeekIds] : []
    };
}

function setDiscarded(player, discardedIds) {
    player.discarded = discardedIds.slice();
    const dump = new Set(discardedIds);
    player.kept = player.hand.filter(id => !dump.has(id));
}

function twoCardKeepScore(leftId, rightId) {
    const left = parseCardId(leftId);
    const right = parseCardId(rightId);
    if (left.rank === right.rank) return 8000 + left.trips;
    const suited = left.suit === right.suit;
    const gap = Math.abs(left.straight - right.straight);
    const faces = (left.value >= 11 ? 1 : 0) + (right.value >= 11 ? 1 : 0);
    if (suited && gap === 1) return 5000 + Math.max(left.straight, right.straight);
    if (faces === 2) return 4200 + left.value + right.value;
    if (suited && gap === 2) return 3600 + Math.max(left.straight, right.straight);
    if (suited) return 2400 + Math.max(left.value, right.value);
    if (left.rank === 'A' || right.rank === 'A') return 1800 + Math.max(left.value, right.value);
    return left.value + right.value;
}

function bestTwoKeep(hand) {
    const cards = hand || [];
    let keepIds = cards.slice(0, 2);
    let best = -1;
    for (let i = 0; i < cards.length; i += 1) {
        for (let j = i + 1; j < cards.length; j += 1) {
            const score = twoCardKeepScore(cards[i], cards[j]);
            if (score > best) {
                best = score;
                keepIds = [cards[i], cards[j]];
            }
        }
    }
    return keepIds;
}

function keepHintIds(player, meta, phase) {
    if (!player) return [];
    if (player.kept && player.kept.length) return player.kept.slice();
    const hand = player.hand || [];
    if (phase === 'select' && hand.length && meta.keepCount === 2) return bestTwoKeep(hand);
    if (phase === 'select' && hand.length >= 3 && meta.keepCount === 3) {
        return (bestThreeFrom(hand).cards || []).slice();
    }
    return hand.slice();
}

function autoPick(player, meta) {
    if (meta.keepCount === 3) {
        const best = bestThreeFrom(player.hand);
        const keep = new Set(best.cards);
        setDiscarded(player, player.hand.filter(id => !keep.has(id)));
        player.kept = best.cards;
        return;
    }
    const keepIds = bestTwoKeep(player.hand || []);
    const keep = new Set(keepIds);
    setDiscarded(player, (player.hand || []).filter(id => !keep.has(id)));
}

function botSelectCards(player, meta) {
    autoPick(player, meta);
    return player.discarded.slice();
}

function walletStack(playerId) {
    return walletManager.publicWallet(playerId).balance;
}

function takeChips(room, player, amount) {
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    if (want <= 0) return 0;
    const state = room.gameState;
    if (state.tableType === 'cash') {
        const have = walletStack(player.playerId);
        const take = Math.min(have, want);
        if (take) {
            walletManager.debit(player.playerId, take, 'poker-bet', { roomId: room.roomId });
        }
        player.stack = walletStack(player.playerId);
        return take;
    }
    const take = Math.min(player.stack, want);
    player.stack -= take;
    return take;
}

function collectAnte(room) {
    const state = room.gameState;
    seatedPlayers(room).forEach(player => {
        if (state.tableType === 'cash' && !walletManager.canAfford(player.playerId, state.ante)) {
            player.sittingOut = true;
        }
    });
    const paying = seatedPlayers(room);
    if (paying.length < 2) return false;

    if (state.tableType !== 'cash') {
        paying.forEach(player => {
            if (Number(player.stack) < state.ante) player.stack = FUN_STACK;
        });
    } else {
        paying.forEach(player => { player.stack = walletStack(player.playerId); });
    }

    state.pot = 0;
    paying.forEach(player => {
        const taken = takeChips(room, player, state.ante);
        player.committed = (Number(player.committed) || 0) + taken;
        state.pot += taken;
        if (player.stack <= 0) player.allIn = true;
    });
    return paying.length >= 2;
}

function payPot(room, winners) {
    const state = room.gameState;
    if (!winners.length || !state.pot) return 0;
    const share = Math.floor(state.pot / winners.length);
    const leftover = state.pot - (share * winners.length);
    const leftoverIndex = leftover ? ((Number(state.handNumber) || 1) - 1) % winners.length : -1;
    winners.forEach((player, index) => {
        const amount = share + (index === leftoverIndex ? leftover : 0);
        if (state.tableType === 'cash') {
            walletManager.credit(player.playerId, amount, 'poker-pot', { roomId: room.roomId, bypassCap: true });
            player.stack = walletStack(player.playerId);
        } else {
            player.stack += amount;
        }
    });
    const paid = state.pot;
    state.pot = 0;
    return paid;
}

function resetHandFlags(player) {
    player.hand = [];
    player.kept = [];
    player.discarded = [];
    player.ready = false;
    player.folded = false;
    player.allIn = false;
    player.acted = false;
    player.streetBet = 0;
    player.committed = 0;
    player.lastSay = null;
    player.lastSaySeq = 0;
    player.upCard = null;
    player.bestName = null;
}

function dealHands(room) {
    const meta = variantOf(room);
    const state = room.gameState;
    state.deck = shuffle(buildDeck());
    state.board = [];
    seatedPlayers(room).forEach(player => {
        resetHandFlags(player);
        for (let i = 0; i < meta.dealCount; i += 1) {
            player.hand.push(state.deck.pop());
        }
    });
}

function startHand(room) {
    const meta = variantOf(room);
    const state = room.gameState;
    syncSeats(room);
    state.players.forEach(player => {
        player.sittingOut = false;
        resetHandFlags(player);
    });
    if (state.players.length < 2 || !collectAnte(room)) {
        return finishTable(room, 'เหลือผู้เล่นหรือชิปไม่พอเริ่มมือนี้ — จบโต๊ะ');
    }
    state.handNumber += 1;
    state.lastResult = null;
    state.winner = null;
    state.statsRecordedAt = null;
    state.board = [];
    state.currentBet = 0;
    state.raiseCount = 0;
    state.toActPlayerId = null;
    dealHands(room);
    setPhase(room, 'select', SELECT_MS);
    pushHistory(room, '🃏', `มือที่ ${state.handNumber} — วางกองก่อนแจก ${state.ante} รวม ${state.pot}`, 'deal');
    pushFx(room, { kind: 'deal', count: meta.dealCount });
    return state;
}

function startGame(room) {
    const meta = variantOf(room);
    const seated = (room.players || []).filter(p => p.socketId || p.playerId);
    if (seated.length < meta.minPlayers || seated.length > meta.maxPlayers) {
        throw new Error(`${meta.label}เล่นได้ ${meta.minPlayers}–${meta.maxPlayers} คน`);
    }
    const state = resetRoomGame(room);
    state.status = 'playing';
    state.dealerIndex = pickDealerIndex(state, false);
    room.gameState = state;
    startHand(room);
    return state;
}

function submitSelect(room, playerId, cardIds) {
    const meta = variantOf(room);
    const state = room.gameState;
    if (state.phase !== 'select') throw new Error('ยังไม่ถึงตาเลือกไพ่');
    const player = getPlayer(room, playerId);
    if (!player || player.sittingOut) throw new Error('คุณไม่ได้ลงมือนี้');

    const chosen = Array.isArray(cardIds) ? cardIds.map(String) : [];
    if (chosen.length !== meta.selectCount) {
        throw new Error('เลือก 2 ใบที่จะทิ้งคืนกลาง');
    }
    const hand = [...player.hand];
    chosen.forEach(cardId => {
        const index = hand.indexOf(cardId);
        if (index < 0) throw new Error('ไม่มีไพ่ใบนั้นในมือ');
        hand.splice(index, 1);
    });

    setDiscarded(player, chosen);
    player.ready = true;
    if (seatedPlayers(room).every(p => p.ready)) {
        return afterSelect(room);
    }
    return state;
}

function actorsLeft(room) {
    return livePlayers(room).filter(player => !player.allIn && player.stack > 0);
}

function streetComplete(room) {
    const live = livePlayers(room);
    if (live.length <= 1) return true;
    const actors = actorsLeft(room);
    if (!actors.length) return true;
    const currentBet = Number(room.gameState.currentBet) || 0;
    return actors.every(player => player.acted && player.streetBet === currentBet);
}

function nextActorAfter(room, fromIndex) {
    const state = room.gameState;
    const n = state.players.length;
    for (let i = 1; i <= n; i += 1) {
        const player = state.players[(fromIndex + i) % n];
        if (!player || player.sittingOut || player.folded || player.allIn || player.stack <= 0) continue;
        return player;
    }
    return null;
}

function playerIndex(room, playerId) {
    return room.gameState.players.findIndex(player => player.playerId === playerId);
}

function beginBetStreet(room) {
    const state = room.gameState;
    state.currentBet = 0;
    state.raiseCount = 0;
    state.toActPlayerId = null;
    seatedPlayers(room).forEach(player => {
        player.acted = false;
        player.streetBet = 0;
        if (player.stack <= 0) player.allIn = true;
    });
    const first = nextActorAfter(room, state.dealerIndex);
    if (!first || streetComplete(room)) {
        return afterBet(room);
    }
    state.toActPlayerId = first.playerId;
    setPhase(room, 'bet', BET_MS);
    pushHistory(room, '🪙', 'ลงชิปรอบนึง — สู้ ตาม เกทับ หมอบได้', 'bet');
    return state;
}

function afterSelect(room) {
    const meta = variantOf(room);
    seatedPlayers(room).forEach(player => {
        if (!player.ready) autoPick(player, meta);
        player.ready = true;
    });
    dumpDiscardsToBoard(room);
    pushFx(room, { kind: 'discard', fromIds: seatedPlayers(room).map(player => player.playerId) });
    pushHistory(room, '🂠', meta.hasThird ? 'ทิ้ง 2 ใบแล้ว — ลงชิปก่อนได้ใบที่ 3' : 'ทิ้ง 2 ใบแล้ว — ลงชิปก่อนเปิดเทียบ', 'discard');
    return beginBetStreet(room);
}

function reopenStreet(room, actor) {
    seatedPlayers(room).forEach(player => {
        player.acted = player.playerId === actor.playerId;
    });
}

function putStreetBet(room, player, amount) {
    const taken = takeChips(room, player, amount);
    player.streetBet += taken;
    player.committed = (Number(player.committed) || 0) + taken;
    room.gameState.pot += taken;
    if (taken > 0) {
        pushFx(room, { kind: 'chips', fromId: player.playerId, amount: taken });
    }
    if (player.stack <= 0) player.allIn = true;
    return taken;
}

function submitBet(room, playerId, action, amount) {
    const state = room.gameState;
    if (state.phase !== 'bet') throw new Error('ยังไม่ถึงตาเดิมพัน');
    const player = getPlayer(room, playerId);
    if (!player || player.sittingOut || player.folded) throw new Error('คุณไม่ได้ลงมือนี้');
    if (state.toActPlayerId && state.toActPlayerId !== playerId) throw new Error('ยังไม่ถึงตาคุณ');
    if (player.allIn) throw new Error('หมดหน้าตักไปแล้ว');

    const verb = String(action || '').toLowerCase();
    const currentBet = Number(state.currentBet) || 0;
    const toCall = Math.max(0, currentBet - player.streetBet);
    const minRaiseTo = currentBet + state.ante;
    const want = Math.max(0, Math.floor(Number(amount) || 0));

    if (verb === 'fold') {
        player.folded = true;
        player.acted = true;
        pushSay(room, player, 'fold');
        pushHistory(room, '🏳️', `${player.name} หมอบ`);
    } else if (verb === 'check') {
        if (toCall > 0) throw new Error('มีคนสู้แล้ว ผ่านไม่ได้');
        player.acted = true;
        pushSay(room, player, 'check');
        pushHistory(room, '✓', `${player.name} ผ่าน`);
    } else if (verb === 'call') {
        if (toCall <= 0) {
            player.acted = true;
            pushSay(room, player, 'check');
        } else {
            const taken = putStreetBet(room, player, toCall);
            player.acted = true;
            if (taken < toCall) player.allIn = true;
            pushSay(room, player, taken < toCall ? 'allin' : 'call', taken);
            pushHistory(room, '🪙', `${player.name} ตาม ${taken}`);
        }
    } else if (verb === 'bet') {
        if (currentBet > 0) throw new Error('มีคนสู้แล้ว ใช้ตามหรือเกทับ');
        const betAmt = want || state.ante;
        if (betAmt < state.ante && betAmt < player.stack) throw new Error(`สู้ขั้นต่ำ ${state.ante}`);
        const taken = putStreetBet(room, player, betAmt);
        if (taken <= 0) throw new Error('ชิปไม่พอ');
        state.currentBet = player.streetBet;
        state.raiseCount = (Number(state.raiseCount) || 0) + 1;
        reopenStreet(room, player);
        player.acted = true;
        pushSay(room, player, player.allIn ? 'allin' : 'bet', taken);
        pushHistory(room, '🔥', `${player.name} สู้ ${taken}`);
    } else if (verb === 'raise') {
        if (currentBet <= 0) throw new Error('ยังไม่มีคนสู้ ใช้สู้ก่อน');
        const raiseTo = want || minRaiseTo;
        const need = raiseTo - player.streetBet;
        if (raiseTo < minRaiseTo && player.stack > need) throw new Error(`เกทับอย่างน้อยถึง ${minRaiseTo}`);
        if (need <= 0) throw new Error('ยอดเกทับต้องสูงกว่าของโต๊ะ');
        const taken = putStreetBet(room, player, need);
        if (player.streetBet <= currentBet && !player.allIn) throw new Error('เกทับไม่ถึง');
        if (player.streetBet > currentBet) {
            state.currentBet = player.streetBet;
            state.raiseCount = (Number(state.raiseCount) || 0) + 1;
            reopenStreet(room, player);
        }
        player.acted = true;
        pushSay(room, player, player.allIn ? 'allin' : 'raise', player.streetBet);
        pushHistory(room, '🔥', `${player.name} เกทับเป็น ${player.streetBet}`);
        void taken;
    } else if (verb === 'allin') {
        const taken = putStreetBet(room, player, player.stack);
        player.allIn = true;
        player.acted = true;
        if (player.streetBet > currentBet) {
            state.currentBet = player.streetBet;
            state.raiseCount = (Number(state.raiseCount) || 0) + 1;
            reopenStreet(room, player);
        }
        pushSay(room, player, 'allin', taken);
        pushHistory(room, '💀', `${player.name} หมดหน้าตัก ${taken}`);
    } else {
        throw new Error('แอ็กชันไม่รู้จัก');
    }

    return continueBet(room, player);
}

function continueBet(room, lastActor) {
    const state = room.gameState;
    const live = livePlayers(room);
    if (live.length <= 1) {
        return awardFoldWin(room, live[0]);
    }
    if (streetComplete(room)) {
        return afterBet(room);
    }
    const from = lastActor ? playerIndex(room, lastActor.playerId) : state.dealerIndex;
    const next = nextActorAfter(room, from);
    if (!next) return afterBet(room);
    state.toActPlayerId = next.playerId;
    setPhase(room, 'bet', BET_MS);
    return state;
}

function awardFoldWin(room, winner) {
    const state = room.gameState;
    if (!winner) return finishTable(room, 'เหลือผู้เล่นไม่พอ — จบโต๊ะ');
    const pot = payPot(room, [winner]);
    winner.bestName = 'คนอื่นหมอบ';
    state.lastResult = {
        winners: [{ playerId: winner.playerId, name: winner.name }],
        pot,
        handName: 'คนอื่นหมอบ',
        handTitle: 'คนอื่นหมอบ',
        show: []
    };
    state.winner = { playerId: winner.playerId, name: winner.name };
    state.toActPlayerId = null;
    pushHistory(room, '🏆', `${winner.name} กินกอง ${pot} เพราะคนอื่นหมอบ`, 'winner');
    pushFx(room, { kind: 'reveal', foldWin: true, winnerIds: [winner.playerId] });
    setPhase(room, 'reveal', REVEAL_MS);
    return state;
}

function dealThirdFaceUp(room) {
    const state = room.gameState;
    livePlayers(room).forEach(player => {
        if (player.upCard || (player.kept || []).length >= 3) return;
        const card = state.deck.length ? state.deck.pop() : null;
        if (!card) return;
        player.kept = [...(player.kept || []), card];
        player.upCard = card;
        player.hand = [...(player.kept || [])];
    });
    pushFx(room, {
        kind: 'deal3',
        playerIds: livePlayers(room).map(player => player.playerId),
        ups: livePlayers(room).map(player => ({
            playerId: player.playerId,
            card: player.upCard ? describeCard(player.upCard) : null
        }))
    });
    pushHistory(room, '🂡', 'แจกใบที่ 3 หงาย — เปิดเทียบเลย', 'deal');
}

function afterBet(room) {
    const meta = variantOf(room);
    const state = room.gameState;
    state.toActPlayerId = null;
    const live = livePlayers(room);
    if (live.length <= 1) {
        return awardFoldWin(room, live[0]);
    }
    if (meta.hasThird) {
        dealThirdFaceUp(room);
        setPhase(room, 'deal3', DEAL3_MS);
        return state;
    }
    return revealHands(room);
}

function dumpDiscardsToBoard(room) {
    const state = room.gameState;
    const dumped = new Set(state.board || []);
    seatedPlayers(room).forEach(player => {
        (player.discarded || []).forEach(cardId => {
            if (!dumped.has(cardId)) {
                state.board = [...(state.board || []), cardId];
                dumped.add(cardId);
            }
        });
    });
}

function revealHands(room) {
    const meta = variantOf(room);
    const state = room.gameState;
    dumpDiscardsToBoard(room);
    const live = livePlayers(room);
    if (live.length < 2) {
        return awardFoldWin(room, live[0]);
    }
    const results = live.map(player => {
        if (!player.kept?.length) autoPick(player, meta);
        const evaluated = evaluateHand(player.kept);
        player.bestName = evaluated.title || evaluated.categoryName;
        return { player, evaluated };
    });
    const best = Math.max(...results.map(row => row.evaluated.score));
    const winners = results.filter(row => row.evaluated.score === best).map(row => row.player);
    const pot = payPot(room, winners);
    const names = winners.map(p => p.name).join(', ');
    const top = results.find(row => row.evaluated.score === best);
    const handName = top?.evaluated.title || top?.evaluated.categoryName;
    state.lastResult = {
        winners: winners.map(p => ({ playerId: p.playerId, name: p.name })),
        pot,
        handName,
        handTitle: top?.evaluated.title || handName,
        show: results.map(row => ({
            playerId: row.player.playerId,
            name: row.player.name,
            hole: (row.player.hand || []).map(describeCard),
            cards: row.player.kept.map(describeCard),
            categoryName: row.evaluated.categoryName,
            title: row.evaluated.title || row.evaluated.categoryName,
            score: row.evaluated.score,
            won: row.evaluated.score === best
        }))
    };
    state.winner = winners.length === 1
        ? { playerId: winners[0].playerId, name: winners[0].name }
        : { playerId: null, name: names };
    pushHistory(room, '🏆', `${names} ชนะด้วย${handName} กอง ${pot}`, 'winner');
    pushFx(room, {
        kind: 'reveal',
        winnerIds: winners.map(player => player.playerId),
        handTitle: handName
    });
    setPhase(room, 'reveal', REVEAL_MS);
    return state;
}

function finishReveal(room) {
    const state = room.gameState;
    if (state.phase !== 'reveal') return state;
    setPhase(room, 'between', BETWEEN_MS);
    return state;
}

function nextHand(room) {
    const state = room.gameState;
    if (state.phase !== 'between' && state.phase !== 'reveal') {
        throw new Error('ยังไม่จบมือ');
    }
    state.dealerIndex = pickDealerIndex(state, true);
    return startHand(room);
}

function autoCheckOrFold(room, player) {
    if (!player || player.folded || player.allIn) return room.gameState;
    try {
        return submitBet(room, player.playerId, 'fold');
    } catch (error) {
        player.folded = true;
        player.acted = true;
        pushSay(room, player, 'fold');
        return continueBet(room, player);
    }
}

function autoResolvePhase(room) {
    const state = room.gameState;
    if (!state || state.phase === 'finished' || state.phase === 'lobby') return state;
    if (state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;

    if (state.phase === 'select') return afterSelect(room);
    if (state.phase === 'bet') {
        const actor = getPlayer(room, state.toActPlayerId);
        return autoCheckOrFold(room, actor);
    }
    if (state.phase === 'deal3') return revealHands(room);
    if (state.phase === 'reveal') return finishReveal(room);
    if (state.phase === 'between') return startHand(room);
    return state;
}

function botStyle(playerId) {
    let hash = 2166136261;
    const text = String(playerId || '');
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const n = hash >>> 0;
    return {
        tight: 0.94 + (n % 19) / 90,
        aggro: 0.78 + ((n >>> 8) % 23) / 55
    };
}

function twoCardScore(cardIds) {
    const cards = (cardIds || []).map(parseCardId);
    if (cards.length < 2) return 4;
    const left = cards[0];
    const right = cards[1];
    const suited = left.suit === right.suit;
    const pair = left.rank === right.rank;
    const gap = Math.abs(left.straight - right.straight);
    const faces = (left.value >= 11 ? 1 : 0) + (right.value >= 11 ? 1 : 0);
    const point = (left.point + right.point) % 10;
    let score = 10 + point * 3;
    if (pair) {
        const tripsHigh = left.rank === '3' ? 14 : Math.max(left.point, 4);
        score = Math.max(score, 56 + tripsHigh);
    }
    if (faces === 2) score = Math.max(score, suited ? 58 : 46);
    if (suited && gap === 1) score = Math.max(score, 54);
    if (suited && gap === 2) score = Math.max(score, 44);
    if (suited) score = Math.max(score, 28 + Math.max(left.value, right.value) * 0.5);
    if (point >= 8) score = Math.max(score, 36 + point * 2);
    if (point === 9) score = Math.max(score, 52);
    return Math.max(4, Math.min(90, Math.round(score)));
}

function threeCardScore(ev) {
    if (!ev) return 4;
    if (ev.category === CATEGORY.TRIPS) {
        const rank = ev.parsed && ev.parsed[0] ? ev.parsed[0].rank : '';
        return rank === '3' ? 100 : 94;
    }
    if (ev.category === CATEGORY.STRAIGHT_FLUSH) return 90;
    if (ev.category === CATEGORY.SEAN) return 84;
    if (ev.category === CATEGORY.STRAIGHT) return 74;
    if (ev.category === CATEGORY.FLUSH) return 64;
    const point = Math.max(0, Math.min(9, Number(ev.point) || 0));
    return [4, 8, 12, 16, 20, 26, 34, 44, 52, 58][point];
}

function botHandScore(player) {
    const cards = (player.kept && player.kept.length) ? player.kept : (player.hand || []);
    if (cards.length >= 3) {
        const ev = cards.length === 3 ? evaluateHand(cards) : bestThreeFrom(cards);
        return threeCardScore(ev);
    }
    if (cards.length >= 2) return twoCardScore(cards.slice(0, 2));
    return 4;
}

function botEquity(score, liveCount) {
    const raw = Math.max(0.02, Math.min(0.99, Number(score) / 100));
    const others = Math.max(0, Number(liveCount) || 1) - 1;
    return Math.max(0.015, raw / (1 + others * (1 - raw) * 0.62));
}

function botRaiseTo(state, player, score) {
    const currentBet = Number(state.currentBet) || 0;
    const minRaiseTo = currentBet + state.ante;
    const cap = player.streetBet + player.stack;
    const extra = score >= 88 ? state.ante * 4 : (score >= 74 ? state.ante * 2 : state.ante);
    return Math.max(minRaiseTo, Math.min(cap, currentBet + extra));
}

function botBetAction(room, player) {
    const state = room.gameState;
    const toCall = Math.max(0, (Number(state.currentBet) || 0) - player.streetBet);
    const minBet = state.ante;
    const minRaiseTo = (Number(state.currentBet) || 0) + minBet;
    const maxRaiseTo = player.streetBet + player.stack;
    const live = livePlayers(room).length;
    const raises = Number(state.raiseCount) || 0;
    const style = botStyle(player.playerId);
    const score = botHandScore(player);
    const equity = botEquity(score, live) / style.tight;
    const pot = Math.max(1, Number(state.pot) || minBet);
    const required = toCall > 0 ? toCall / (pot + toCall) : 0;
    const multiway = Math.max(0, live - 2);
    const margin = 1.06 + multiway * 0.05 + raises * 0.16;
    const canRaise = maxRaiseTo >= minRaiseTo && player.stack > toCall + minBet;
    const monster = score >= 74;
    const premium = score >= 84;

    if (toCall <= 0) {
        const openLine = 46 + multiway * 3.2 - style.aggro * 6;
        if (score >= openLine && player.stack >= minBet) {
            const amount = score >= 74
                ? Math.min(player.stack, minBet * (premium ? 3 : 2))
                : minBet;
            return { action: 'bet', amount };
        }
        if (live <= 3 && score <= 18 && player.stack >= minBet && Math.random() < 0.07 * style.aggro) {
            return { action: 'bet', amount: minBet };
        }
        return { action: 'check' };
    }

    if (equity < required * margin) {
        return { action: 'fold' };
    }
    if (toCall >= player.stack) {
        return equity >= 0.34 || monster ? { action: 'allin' } : { action: 'fold' };
    }

    const wantRaise = (premium && raises < 3)
        || (monster && raises < 2 && live <= 6)
        || (score >= 64 && raises === 0 && live <= 4 && style.aggro > 1 && Math.random() < 0.35);
    if (wantRaise && canRaise) {
        return { action: 'raise', amount: botRaiseTo(state, player, score) };
    }
    return { action: 'call' };
}

function playBotTurns(room) {
    const state = room.gameState;
    const meta = variantOf(room);
    if (!state || state.status !== 'playing') return false;
    const bots = seatedPlayers(room).filter(player => isBotId(player.playerId));
    let acted = false;

    if (state.phase === 'select') {
        bots.filter(player => !player.ready).forEach(player => {
            try {
                submitSelect(room, player.playerId, botSelectCards(player, meta));
                acted = true;
            } catch (error) {
                // เฟสเปลี่ยนระหว่างลูปได้
            }
        });
        return acted;
    }

    if (state.phase === 'bet') {
        const actor = getPlayer(room, state.toActPlayerId);
        if (!actor || !isBotId(actor.playerId) || actor.folded || actor.allIn) return false;
        try {
            const choice = botBetAction(room, actor);
            submitBet(room, actor.playerId, choice.action, choice.amount);
            acted = true;
        } catch (error) {
            try {
                autoCheckOrFold(room, actor);
                acted = true;
            } catch (standError) {
                // เฟสจบแล้ว
            }
        }
    }

    return acted;
}

function handlePlayerLeft(room, playerId) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    if (player) {
        player.sittingOut = true;
        player.folded = true;
        player.ready = true;
        player.acted = true;
        pushHistory(room, '🚪', `${player.name} ออกจากมือนี้`);
    }

    const inHand = ['select', 'bet', 'deal3', 'reveal'].includes(state.phase);
    const alive = livePlayers(room);

    if (inHand && alive.length < 2) {
        if (alive[0]) awardFoldWin(room, alive[0]);
        pruneAbsentPlayers(room);
        if (state.players.length < 2) {
            return finishTable(room, 'เหลือผู้เล่นไม่พอ — จบโต๊ะ');
        }
        if (state.phase !== 'finished') setPhase(room, 'between', BETWEEN_MS);
        return state;
    }

    pruneAbsentPlayers(room);

    if (state.players.length < 2) {
        return finishTable(room, 'เหลือผู้เล่นไม่พอ — จบโต๊ะ');
    }
    if (state.phase === 'select' && seatedPlayers(room).every(p => p.ready)) return afterSelect(room);
    if (state.phase === 'bet' && (streetComplete(room) || livePlayers(room).length <= 1)) {
        return continueBet(room, player);
    }
    if (state.phase === 'bet' && state.toActPlayerId === playerId) {
        return continueBet(room, player);
    }
    return state;
}

function getAvailableActions(room, viewerPlayerId) {
    const meta = variantOf(room);
    const state = room.gameState;
    const player = getPlayer(room, viewerPlayerId);
    const currentBet = Number(state.currentBet) || 0;
    const streetBet = player ? Number(player.streetBet) || 0 : 0;
    const toCall = player ? Math.max(0, currentBet - streetBet) : 0;
    const isTurn = !!(player && state.phase === 'bet' && state.toActPlayerId === viewerPlayerId && !player.folded && !player.allIn);
    const base = {
        canSelect: false,
        canCheck: false,
        canBet: false,
        canCall: false,
        canRaise: false,
        canFold: false,
        canAllIn: false,
        canNext: false,
        selectCount: meta.selectCount || 0,
        selectMode: meta.selectMode || 'discard',
        callAmount: toCall,
        minBet: state.ante,
        maxBet: player ? player.stack : 0,
        minRaiseTo: currentBet + state.ante,
        maxRaiseTo: player ? player.streetBet + player.stack : 0,
        currentBet,
        streetBet,
        toAct: isTurn,
        kind: meta.kind
    };
    if (!player || player.sittingOut) return base;
    if (state.phase === 'between') return { ...base, canNext: true };
    if (state.phase === 'select') {
        return { ...base, canSelect: !player.ready };
    }
    if (!isTurn) return base;
    const canPay = player.stack > 0;
    const minRaiseTo = currentBet + state.ante;
    return {
        ...base,
        maxBet: player.stack,
        maxRaiseTo: player.streetBet + player.stack,
        canCheck: toCall === 0,
        canBet: toCall === 0 && player.stack >= state.ante,
        canCall: toCall > 0 && player.stack > 0,
        canRaise: currentBet > 0 && player.stack > toCall && (player.streetBet + player.stack) >= minRaiseTo,
        canFold: true,
        canAllIn: canPay
    };
}

function peekHandInfoFrom(source, folded) {
    if (folded) return { title: 'หมอบ', categoryName: 'หมอบ', rank: 'หมอบ' };
    if (!Array.isArray(source) || source.length < 2) return { title: null, categoryName: null, rank: null };
    try {
        const evaluated = evaluateHand(source);
        const categoryName = evaluated.categoryName || null;
        const title = evaluated.title || categoryName || null;
        let rank = categoryName;
        if (categoryName === 'ตอง' || categoryName === 'เรียงสี' || categoryName === 'เซียน' || categoryName === 'เรียง' || categoryName === 'สี') {
            rank = categoryName;
        } else if (categoryName === 'รอใบที่ 3' || categoryName === 'แต้ม') {
            const m = String(title || '').match(/(\d+)/);
            rank = m ? `${m[1]} แต้ม` : 'แต้ม';
        } else if (categoryName === 'หมอบ') {
            rank = 'หมอบ';
        } else {
            rank = title || categoryName;
        }
        return { title, categoryName, rank };
    } catch (err) {
        return { title: null, categoryName: null, rank: null };
    }
}

function buildClientState(room, viewerPlayerId) {
    const meta = variantOf(room);
    const state = room.gameState || createInitialState(meta.id);
    const viewer = getPlayer(room, viewerPlayerId);
    const wallet = viewerPlayerId ? walletManager.publicWallet(viewerPlayerId) : null;
    const peekEnabled = Array.isArray(state.adminPeekIds) && state.adminPeekIds.includes(viewerPlayerId);
    const hintIds = keepHintIds(viewer, meta, state.phase);
    const liveEval = hintIds.length >= 2 ? evaluateHand(hintIds) : null;
    const discardCount = (state.players || []).reduce((sum, player) => sum + (player.discarded || []).length, 0);
    const toActName = getPlayer(room, state.toActPlayerId)?.name || null;
    const showing = state.phase === 'reveal' || state.phase === 'between';
    const showRows = (state.lastResult && state.lastResult.show) || [];
    const winnerIds = new Set((state.lastResult && state.lastResult.winners || []).map(row => row.playerId));
    return {
        mode: meta.id,
        kind: meta.kind,
        label: meta.label,
        keepCount: meta.keepCount,
        dealCount: meta.dealCount,
        phase: state.phase,
        tableType: state.tableType,
        ante: state.ante,
        pot: state.pot,
        displayPot: showing && state.lastResult ? state.lastResult.pot : state.pot,
        betMs: BET_MS,
        currentBet: state.currentBet,
        toActPlayerId: state.toActPlayerId,
        toActName,
        handNumber: state.handNumber,
        phaseEndsAt: state.phaseEndsAt,
        lastResult: state.lastResult,
        winner: state.winner,
        history: state.history || [],
        cardBack: CARD_BACK,
        rankGuide: rankGuideForClient(),
        discardCount,
        board: showing ? (state.board || []).map(describeCard) : [],
        boardCount: 0,
        liveHand: liveEval ? {
            category: liveEval.guideCategory || liveEval.category,
            categoryName: liveEval.categoryName,
            title: liveEval.title || liveEval.categoryName,
            cards: hintIds.map(describeCard)
        } : null,
        wallet,
        chipDisplay: state.tableType === 'cash'
            ? (wallet ? wallet.balance : 0)
            : (viewer ? viewer.stack : 0),
        self: viewer ? {
            playerId: viewer.playerId,
            stack: viewer.stack,
            sittingOut: viewer.sittingOut,
            ready: viewer.ready,
            folded: viewer.folded,
            allIn: viewer.allIn,
            streetBet: viewer.streetBet,
            committed: Number(viewer.committed) || 0,
            hand: (viewer.hand || []).map(describeCard),
            kept: (viewer.kept || []).map(describeCard),
            upCard: viewer.upCard ? describeCard(viewer.upCard) : null
        } : null,
        players: state.players.map(player => {
            const showRow = showRows.find(row => row.playerId === player.playerId) || null;
            const afterPick = player.ready || ['bet', 'deal3', 'reveal', 'between'].includes(state.phase);
            const holeIds = afterPick && (player.kept || []).length
                ? player.kept
                : (player.hand || []);
            const shownCount = player.folded
                ? 0
                : (afterPick
                    ? Math.min(holeIds.length || meta.keepCount, state.phase === 'bet' && meta.keepCount === 2 ? 2 : 3)
                    : (player.hand || []).length);
            const peekSource = holeIds.slice(0, shownCount || holeIds.length);
            const peekInfo = peekEnabled ? peekHandInfoFrom(peekSource, player.folded) : { title: null, categoryName: null, rank: null };
            const peekCards = peekEnabled ? peekSource.map(describeCard) : null;
            return {
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
            stack: player.stack,
            sittingOut: player.sittingOut,
            ready: player.ready,
            folded: player.folded,
            allIn: player.allIn,
            streetBet: player.streetBet,
            committed: Number(player.committed) || 0,
            lastSay: player.lastSay || null,
            lastSaySeq: Number(player.lastSaySeq) || 0,
            isTurn: state.toActPlayerId === player.playerId,
            handCount: player.folded ? 0 : shownCount,
            isSelf: player.playerId === viewerPlayerId,
            isBot: isBotId(player.playerId),
            isDealer: state.players[state.dealerIndex]?.playerId === player.playerId,
            isWinner: winnerIds.has(player.playerId),
            bestName: player.bestName || null,
            showCategory: showRow ? showRow.categoryName : null,
            showTitle: showRow ? (showRow.title || showRow.categoryName) : (player.bestName || null),
            upCard: player.upCard && (state.phase === 'deal3' || showing)
                ? describeCard(player.upCard)
                : null,
            peekHand: peekEnabled ? (player.hand || []).map(describeCard) : null,
            peekKept: peekEnabled ? (player.kept || []).map(describeCard) : null,
            peekCards,
            peekTitle: peekInfo.title,
            peekCategory: peekInfo.categoryName,
            peekRank: peekInfo.rank,
            revealed: showing && !player.folded
                ? (player.kept || []).map(describeCard)
                : null
        };
        }),
        availableActions: getAvailableActions(room, viewerPlayerId),
        fx: state.fx || []
    };
}

function createEngine(variantId) {
    const meta = VARIANT_META[variantId];
    return {
        id: meta.id,
        label: meta.label,
        description: meta.description,
        minPlayers: meta.minPlayers,
        maxPlayers: meta.maxPlayers,
        createInitialState: () => createInitialState(variantId),
        startGame,
        startHand,
        submitSelect,
        submitBet,
        nextHand,
        autoResolvePhase,
        handlePlayerLeft,
        playBotTurns,
        buildClientState,
        createPlayerState,
        resetRoomGame,
        VARIANT_META: meta
    };
}

module.exports = {
    poker5: createEngine('poker5'),
    poker4: createEngine('poker4'),
    VARIANT_META,
    createInitialState,
    startGame,
    startHand,
    submitSelect,
    submitBet,
    nextHand,
    autoResolvePhase,
    handlePlayerLeft,
    playBotTurns,
    isBotId,
    buildClientState,
    createPlayerState,
    resetRoomGame
};
