/**
 * ไพ่โกหก (Liar) — 3-8 คน
 *
 * แต่ละรอบสุ่มชนิดไพ่ (A / K / Q) ถึงตาลง 1–3 ใบคว่ำ แล้วบอกว่าเป็นชนิดนั้น
 * คนถัดไปเลือก ท้า (โกหก!) หรือลงต่อ
 * โจ๊กเกอร์ใช้แทนชนิดรอบนั้นได้
 * หมดชีวิต = ตกรอบ เหลือคนเดียวชนะ
 */

const { gameAssetImage } = require('./gameAssets');

const LIAR_IMAGE = id => gameAssetImage('liar', id);
const CARD_BACK = LIAR_IMAGE('back');

const RANKS = ['A', 'K', 'Q'];
const JOKER = 'JOKER';
const HAND_SIZE = 5;
const STARTING_LIVES = 3;
const MIN_PLAY = 1;
const MAX_PLAY = 3;

const CARD_DEFINITIONS = {
    A: { id: 'A', name: 'Ace', thaiName: 'เอซ', icon: 'A', suit: '♠', image: LIAR_IMAGE('ace'), back: CARD_BACK },
    K: { id: 'K', name: 'King', thaiName: 'คิง', icon: 'K', suit: '♥', image: LIAR_IMAGE('king'), back: CARD_BACK },
    Q: { id: 'Q', name: 'Queen', thaiName: 'ควีน', icon: 'Q', suit: '♦', image: LIAR_IMAGE('queen'), back: CARD_BACK },
    JOKER: { id: 'JOKER', name: 'Joker', thaiName: 'โจ๊กเกอร์', icon: '🃏', suit: '', image: LIAR_IMAGE('joker'), back: CARD_BACK }
};

const PLAY_MS = Number(process.env.LIAR_PLAY_MS) || 45000;
const REACT_MS = Number(process.env.LIAR_REACT_MS) || 20000;

function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function describeCard(cardId) {
    return CARD_DEFINITIONS[cardId] || { id: cardId, name: cardId, thaiName: cardId, icon: '?', suit: '' };
}

function isWildOrRank(cardId, rank) {
    return cardId === JOKER || cardId === rank;
}

function buildDeck(playerCount) {
    const seats = Math.max(3, Math.min(8, Number(playerCount) || 4));
    const jokers = seats <= 5 ? 2 : 4;
    const needed = seats * HAND_SIZE;
    const perRank = Math.max(4, Math.ceil((needed - jokers) / RANKS.length));
    const deck = [];
    RANKS.forEach(rank => {
        for (let i = 0; i < perRank; i += 1) deck.push(rank);
    });
    for (let i = 0; i < jokers; i += 1) deck.push(JOKER);
    return shuffle(deck);
}

function createInitialState() {
    return {
        mode: 'liar',
        status: 'waiting',
        phase: 'lobby',
        players: [],
        deck: [],
        discard: [],
        currentPlayerId: null,
        targetRank: null,
        lastPlay: null,
        lastReveal: null,
        roundNumber: 0,
        turnNumber: 0,
        history: [],
        winner: null,
        phaseEndsAt: null,
        statsRecordedAt: null,
        fxSeq: 0,
        fx: []
    };
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (state.fxSeq || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, ...event }].slice(-8);
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        name: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        permission: context.isAdmin ? 'admin' : null,
        hand: [],
        lives: STARTING_LIVES,
        alive: true
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: room.players.map(player => createPlayerState({
            playerId: player.playerId,
            playerName: player.playerName,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame
        }, { isAdmin: player.permission === 'admin' }))
    };
}

function getPlayer(room, playerId) {
    return room.gameState.players.find(p => p.playerId === playerId) || null;
}

function getAlivePlayers(room) {
    return room.gameState.players.filter(p => p.alive);
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

function nextAlive(room, fromId, predicate) {
    const order = room.gameState.players;
    if (!order.length) return null;
    const start = Math.max(0, order.findIndex(p => p.playerId === fromId));
    const match = typeof predicate === 'function' ? predicate : (p => p.alive);
    for (let step = 1; step <= order.length; step += 1) {
        const candidate = order[(start + step) % order.length];
        if (match(candidate)) return candidate;
    }
    return null;
}

function pickTargetRank(previous) {
    const pool = RANKS.filter(rank => rank !== previous);
    const choices = pool.length ? pool : RANKS;
    return choices[Math.floor(Math.random() * choices.length)];
}

function takeCardsFromHand(player, cardIds) {
    if (!Array.isArray(cardIds) || !cardIds.length) {
        throw new Error('เลือกไพ่ 1–3 ใบ');
    }
    if (cardIds.length < MIN_PLAY || cardIds.length > MAX_PLAY) {
        throw new Error('ลงได้ครั้งละ 1–3 ใบ');
    }

    const hand = [...player.hand];
    const taken = [];
    cardIds.forEach(cardId => {
        const index = hand.indexOf(cardId);
        if (index < 0) {
            throw new Error('ไม่มีไพ่ใบนั้นในมือ');
        }
        taken.push(hand.splice(index, 1)[0]);
    });
    player.hand = hand;
    return taken;
}

function discardCards(room, cardIds) {
    room.gameState.discard = [...(room.gameState.discard || []), ...cardIds];
}

function collectLooseCards(room) {
    const state = room.gameState;
    const cards = [...(state.deck || []), ...(state.discard || [])];
    state.players.forEach(player => {
        cards.push(...player.hand);
        player.hand = [];
    });
    if (state.lastPlay?.cards?.length) {
        cards.push(...state.lastPlay.cards);
        state.lastPlay = null;
    }
    state.deck = [];
    state.discard = [];
    return shuffle(cards);
}

function dealHands(room) {
    const alive = getAlivePlayers(room);
    let deck = room.gameState.deck || [];
    const needed = alive.length * HAND_SIZE;
    if (deck.length < needed) {
        deck = collectLooseCards(room);
    }
    alive.forEach(player => {
        player.hand = [];
        for (let i = 0; i < HAND_SIZE && deck.length; i += 1) {
            player.hand.push(deck.pop());
        }
    });
    room.gameState.deck = deck;
}

function ensureCardsInPlay(room) {
    if (room.gameState.lastPlay) return;
    const alive = getAlivePlayers(room);
    if (!alive.length) return;
    if (alive.every(player => player.hand.length === 0)) {
        dealHands(room);
        pushHistory(room, '🃏', 'ไพ่หมดมือ — แจกใหม่');
        pushFx(room, { kind: 'draw' });
    }
}

function turnDuration(room) {
    return room.gameState.lastPlay ? REACT_MS : PLAY_MS;
}

function beginTurn(room, playerId) {
    const state = room.gameState;
    ensureCardsInPlay(room);
    if (checkWinner(room)) return state;

    let actor = getPlayer(room, playerId);
    if (!actor || !actor.alive) {
        actor = nextAlive(room, playerId);
    }

    if (state.lastPlay) {
        if (!actor || actor.playerId === state.lastPlay.playerId) {
            actor = nextAlive(room, state.lastPlay.playerId);
        }
    } else if (actor && actor.hand.length === 0) {
        actor = nextAlive(room, actor.playerId, p => p.alive && p.hand.length > 0) || actor;
    }

    if (!actor) return state;

    state.currentPlayerId = actor.playerId;
    state.turnNumber += 1;
    setPhase(room, 'turn', turnDuration(room));
    return state;
}

function startRound(room, starterId) {
    const state = room.gameState;
    state.roundNumber += 1;
    state.lastPlay = null;
    state.targetRank = pickTargetRank(state.targetRank);
    const rank = describeCard(state.targetRank);
    pushHistory(room, rank.icon, `รอบที่ ${state.roundNumber} — ต้องบอกว่าเป็น${rank.thaiName}`, 'round');
    pushFx(room, { kind: 'round', targetRank: rank, roundNumber: state.roundNumber });
    return beginTurn(room, starterId);
}

function checkWinner(room) {
    const alive = getAlivePlayers(room);
    if (alive.length > 1) return false;

    room.gameState.winner = alive[0]
        ? { playerId: alive[0].playerId, name: alive[0].name }
        : { playerId: null, name: 'ไม่มีผู้รอด' };
    room.gameState.phase = 'finished';
    room.gameState.status = 'liar_finished';
    room.gameState.phaseEndsAt = null;
    room.gameState.currentPlayerId = null;
    room.gameState.lastPlay = null;
    pushHistory(room, '🏆', `${room.gameState.winner.name} เป็นผู้รอดคนสุดท้าย!`, 'winner');
    return true;
}

function loseLife(room, playerId, reason) {
    const player = getPlayer(room, playerId);
    if (!player || !player.alive) return player;

    player.lives = Math.max(0, player.lives - 1);
    if (player.lives > 0) {
        pushHistory(room, '💔', `${player.name} เสียชีวิต เหลือ ${player.lives}`, reason || 'life');
        return player;
    }

    player.alive = false;
    player.lives = 0;
    discardCards(room, player.hand);
    player.hand = [];
    pushHistory(room, '💀', `${player.name} หมดชีวิต — ตกรอบแล้ว`, 'eliminated');
    return player;
}

function startGame(room) {
    const state = resetRoomGame(room);
    if (state.players.length < 3 || state.players.length > 8) {
        throw new Error('โกหกเล่นได้ 3–8 คน');
    }
    state.status = 'playing';
    state.deck = buildDeck(state.players.length);
    room.gameState = state;
    dealHands(room);

    pushHistory(room, '🎬', `เริ่มเกม — คนละ ${HAND_SIZE} ใบ ชีวิต ${STARTING_LIVES}`);
    pushFx(room, { kind: 'deal' });
    startRound(room, state.players[0]?.playerId || null);
    return room.gameState;
}

function assertCurrentTurn(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase === 'finished' || state.phase === 'lobby') {
        throw new Error('เกมยังไม่เริ่มหรือจบแล้ว');
    }
    if (state.phase !== 'turn') {
        throw new Error('ยังไม่ถึงตาลงไพ่');
    }
    if (state.currentPlayerId !== playerId) {
        throw new Error('ยังไม่ถึงตาคุณ');
    }
    const player = getPlayer(room, playerId);
    if (!player || !player.alive) {
        throw new Error('คุณตกรอบแล้ว');
    }
    return player;
}

function submitPlay(room, playerId, cardIds) {
    const player = assertCurrentTurn(room, playerId);
    if (!player.hand.length) {
        throw new Error('ไพ่ในมือหมด ต้องท้าอย่างเดียว');
    }

    const taken = takeCardsFromHand(player, cardIds);
    const state = room.gameState;
    if (state.lastPlay?.cards?.length) {
        discardCards(room, state.lastPlay.cards);
    }
    const rank = describeCard(state.targetRank);
    state.lastPlay = {
        playerId,
        cards: taken,
        count: taken.length
    };
    state.lastReveal = null;
    pushHistory(room, '🂠', `${player.name} ลง ${taken.length} ใบ บอกว่าเป็น ${rank.thaiName}`, 'play');
    pushFx(room, { kind: 'play', fromId: playerId, count: taken.length });

    const next = nextAlive(room, playerId);
    return beginTurn(room, next?.playerId || playerId);
}

function submitChallenge(room, playerId) {
    const challenger = assertCurrentTurn(room, playerId);
    const state = room.gameState;
    const lastPlay = state.lastPlay;
    if (!lastPlay || !lastPlay.cards?.length) {
        throw new Error('ยังไม่มีไพ่ให้ท้า');
    }
    if (lastPlay.playerId === playerId) {
        throw new Error('ท้าตาตัวเองไม่ได้');
    }

    const actor = getPlayer(room, lastPlay.playerId);
    const truthful = lastPlay.cards.every(cardId => isWildOrRank(cardId, state.targetRank));
    const shown = lastPlay.cards.map(describeCard).map(card => card.thaiName).join(' ');
    const rank = describeCard(state.targetRank);

    state.lastReveal = {
        actorId: lastPlay.playerId,
        challengerId: playerId,
        cards: [...lastPlay.cards],
        truthful,
        targetRank: state.targetRank
    };
    discardCards(room, lastPlay.cards);
    state.lastPlay = null;

    if (truthful) {
        pushHistory(
            room,
            '✅',
            `${challenger.name} ท้าแล้วพลาด — ${actor?.name || 'คนลง'} ลง ${rank.thaiName} จริง (${shown})`,
            'reveal-truth'
        );
        loseLife(room, playerId, 'challenge-fail');
    } else {
        pushHistory(
            room,
            '🚨',
            `${challenger.name} จับได้! ${actor?.name || 'คนลง'} โกหก (${shown})`,
            'reveal-lie'
        );
        loseLife(room, lastPlay.playerId, 'caught');
    }

    pushFx(room, {
        kind: 'reveal',
        truthful,
        actorId: lastPlay.playerId,
        challengerId: playerId,
        cards: lastPlay.cards.map(describeCard)
    });

    if (checkWinner(room)) return state;

    const loserId = truthful ? playerId : lastPlay.playerId;
    const starter = nextAlive(room, loserId);
    return startRound(room, starter?.playerId || playerId);
}

function autoResolvePhase(room) {
    const state = room.gameState;
    if (!state || state.phase === 'finished' || state.phase === 'lobby') return state;
    if (state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;
    if (state.phase !== 'turn') return state;

    const actor = getPlayer(room, state.currentPlayerId);
    if (!actor || !actor.alive) {
        const next = nextAlive(room, state.currentPlayerId);
        return beginTurn(room, next?.playerId);
    }

    try {
        if (state.lastPlay) {
            if (!actor.hand.length) {
                pushHistory(room, '⏰', `${actor.name} หมดเวลา — ท้าอัตโนมัติ`);
                return submitChallenge(room, actor.playerId);
            }
            pushHistory(room, '⏰', `${actor.name} หมดเวลา — ลง 1 ใบอัตโนมัติ`);
            return submitPlay(room, actor.playerId, [actor.hand[0]]);
        }

        if (!actor.hand.length) {
            const next = nextAlive(room, actor.playerId, p => p.alive && p.hand.length > 0);
            return beginTurn(room, next?.playerId || actor.playerId);
        }

        pushHistory(room, '⏰', `${actor.name} หมดเวลา — ลง 1 ใบอัตโนมัติ`);
        return submitPlay(room, actor.playerId, [actor.hand[0]]);
    } catch (error) {
        const next = nextAlive(room, actor.playerId);
        return beginTurn(room, next?.playerId || actor.playerId);
    }
}

function handlePlayerLeft(room, playerId) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    if (!player || !player.alive) return state;

    discardCards(room, player.hand);
    player.hand = [];
    player.alive = false;
    player.lives = 0;
    pushHistory(room, '🚪', `${player.name} ออกจากเกม`);

    if (checkWinner(room)) return state;

    const wasActor = state.lastPlay?.playerId === playerId;
    if (wasActor) {
        discardCards(room, state.lastPlay.cards || []);
        state.lastPlay = null;
        const starter = nextAlive(room, playerId);
        return startRound(room, starter?.playerId);
    }

    if (state.currentPlayerId === playerId) {
        const next = nextAlive(room, playerId);
        return beginTurn(room, next?.playerId);
    }

    return state;
}

function getAvailableActions(room, viewerPlayerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'turn' || state.currentPlayerId !== viewerPlayerId) {
        return { canPlay: false, canChallenge: false, minPlay: MIN_PLAY, maxPlay: MAX_PLAY };
    }
    const player = getPlayer(room, viewerPlayerId);
    if (!player || !player.alive) {
        return { canPlay: false, canChallenge: false, minPlay: MIN_PLAY, maxPlay: MAX_PLAY };
    }
    return {
        canPlay: player.hand.length > 0,
        canChallenge: !!(state.lastPlay && state.lastPlay.playerId !== viewerPlayerId),
        minPlay: MIN_PLAY,
        maxPlay: Math.min(MAX_PLAY, player.hand.length)
    };
}

function buildClientState(room, viewerPlayerId) {
    const state = room.gameState || createInitialState();
    const viewer = getPlayer(room, viewerPlayerId);
    const isFinished = state.phase === 'finished';
    const target = state.targetRank ? describeCard(state.targetRank) : null;
    const actions = getAvailableActions(room, viewerPlayerId);
    const lastPlay = state.lastPlay
        ? {
            playerId: state.lastPlay.playerId,
            playerName: getPlayer(room, state.lastPlay.playerId)?.name || '',
            count: state.lastPlay.count,
            isMine: state.lastPlay.playerId === viewerPlayerId
        }
        : null;
    const lastReveal = state.lastReveal
        ? {
            actorName: getPlayer(room, state.lastReveal.actorId)?.name || '',
            challengerName: getPlayer(room, state.lastReveal.challengerId)?.name || '',
            truthful: state.lastReveal.truthful,
            targetRank: describeCard(state.lastReveal.targetRank),
            cards: state.lastReveal.cards.map(describeCard)
        }
        : null;

    return {
        mode: 'liar',
        status: state.status,
        phase: state.phase,
        isFinished,
        roundNumber: state.roundNumber,
        turnNumber: state.turnNumber,
        currentPlayerId: state.currentPlayerId,
        phaseEndsAt: state.phaseEndsAt,
        targetRank: target,
        lastPlay,
        lastReveal,
        winner: state.winner,
        history: state.history || [],
        deckCount: Array.isArray(state.deck) ? state.deck.length : 0,
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        self: viewer ? {
            playerId: viewer.playerId,
            lives: viewer.lives,
            alive: viewer.alive,
            hand: viewer.hand.map(describeCard),
            isCurrent: viewer.playerId === state.currentPlayerId
        } : null,
        players: state.players.map(player => ({
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
            lives: player.lives,
            alive: player.alive,
            handCount: player.hand.length,
            isSelf: player.playerId === viewerPlayerId,
            isCurrent: player.playerId === state.currentPlayerId
        })),
        availableActions: actions,
        cardCatalog: Object.values(CARD_DEFINITIONS),
        cardBack: CARD_BACK,
        fx: state.fx || []
    };
}

module.exports = {
    id: 'liar',
    label: 'ไพ่โกหก',
    description: 'เหลือหัวใจคนสุดท้ายชนะ — ลงไพ่คว่ำ แล้วบอกว่าเป็นไพ่รอบนี้ คนอื่นท้าได้ · 3–8 คน',
    minPlayers: 3,
    maxPlayers: 8,
    CARD_DEFINITIONS,
    CARD_BACK,
    RANKS,
    JOKER,
    HAND_SIZE,
    STARTING_LIVES,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    submitPlay,
    submitChallenge,
    autoResolvePhase,
    handlePlayerLeft,
    buildClientState,
    buildDeck
};
