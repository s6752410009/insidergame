/**
 * ไพ่โกหก (Liar) — 3-8 คน · กติกาตาม Liar's Deck (เกม Liar's Bar)
 *
 * สำรับ A/K/Q อย่างละ 6 + โจ๊กเกอร์ 2 (20 ใบ) · 5 คนขึ้นไปใช้ 2 สำรับ
 * ทุกรอบสุ่มไพ่บนโต๊ะ (A / K / Q) สับใหม่ แจกคนละ 5 ใบ
 * ถึงตาลง 1–3 ใบคว่ำ อ้างว่าเป็นไพ่บนโต๊ะ · คนถัดไปลงต่อ หรือกด "โกหก!"
 * โจ๊กเกอร์ = ของจริงเสมอ · มือว่าง = ข้ามตา · เหลือคนเดียวที่มีไพ่ = ต้องท้า
 * แพ้ = ยิงปืนลูกโม่ (6 ช่อง กระสุน 1 นัด ช่องเลื่อนทุกนัด) หรือเสียหัวใจ (ตั้งในห้อง)
 * เหลือคนรอดคนเดียวชนะ
 */

const { gameAssetImage } = require('./gameAssets');

const LIAR_IMAGE = id => gameAssetImage('liar', id);
const CARD_BACK = LIAR_IMAGE('back');

const RANKS = ['A', 'K', 'Q'];
const JOKER = 'JOKER';
const DEVIL = 'DEVIL';
const HAND_SIZE = 5;
const STARTING_LIVES = 3;
const CHAMBERS = 6;
const MIN_PLAY = 1;
const MAX_PLAY = 3;
// สำรับจริงของ Liar's Deck — 1 ชุดพอแจก 4 คน (20 ใบ) · 5–8 คนใช้ 2 ชุด (40 ใบ)
const PER_RANK_PER_DECK = 6;
const JOKERS_PER_DECK = 2;
const SEATS_PER_DECK = 4;
// ไพ่ปีศาจมีผลเมื่อยังรอด 3 คนขึ้นไป (เหลือ 2 คน "ทุกคนยกเว้นคนลง" = คนท้าคนเดียว ไม่ต่างจากปกติ)
const DEVIL_MIN_ALIVE = 3;

const PUNISHMENTS = ['revolver', 'lives'];
const DEFAULT_PUNISHMENT = 'revolver';

const CARD_DEFINITIONS = {
    A: { id: 'A', name: 'Ace', thaiName: 'เอซ', icon: 'A', suit: '♠', image: LIAR_IMAGE('ace'), back: CARD_BACK },
    K: { id: 'K', name: 'King', thaiName: 'คิง', icon: 'K', suit: '♥', image: LIAR_IMAGE('king'), back: CARD_BACK },
    Q: { id: 'Q', name: 'Queen', thaiName: 'ควีน', icon: 'Q', suit: '♦', image: LIAR_IMAGE('queen'), back: CARD_BACK },
    JOKER: { id: 'JOKER', name: 'Joker', thaiName: 'โจ๊กเกอร์', icon: '🃏', suit: '', image: LIAR_IMAGE('joker'), back: CARD_BACK },
    DEVIL: { id: 'DEVIL', name: 'Devil', thaiName: 'ไพ่ปีศาจ', icon: '😈', suit: '', image: LIAR_IMAGE('devil'), back: CARD_BACK }
};

// เกมจริงให้ตาละ 30 วิ ทั้งตอนลงและตอนเลือกท้า
const PLAY_MS = Number(process.env.LIAR_PLAY_MS) || 30000;
const REACT_MS = Number(process.env.LIAR_REACT_MS) || 30000;
// คนที่หมดเวลาตาก่อน (AFK) ได้เวลาสั้นลง — วงไม่ต้องรอเต็มเวลาซ้ำทุกตา · กดเองครั้งเดียวก็กลับเป็นเวลาปกติ
const AFK_MS = Number(process.env.LIAR_AFK_MS) || 12000;
// บอทคิดพอให้คนอ่านทัน · หลังหงายไพ่รอนานขึ้นให้ทุกคนเห็นว่าใครโดนยิง
const BOT_THINK_MS = Number(process.env.LIAR_BOT_MS) || 1600;
const BOT_AFTER_REVEAL_MS = Number(process.env.LIAR_BOT_REVEAL_MS) || 2600;

function shuffle(items, rng = Math.random) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function sanitizePunishment(value) {
    return PUNISHMENTS.includes(value) ? value : DEFAULT_PUNISHMENT;
}

function sanitizeDevil(value) {
    return value === true;
}

function describeCard(cardId) {
    return CARD_DEFINITIONS[cardId] || { id: cardId, name: cardId, thaiName: cardId, icon: '?', suit: '' };
}

/** ของจริง = ตรงไพ่บนโต๊ะ / โจ๊กเกอร์ / ไพ่ปีศาจ (ปีศาจคือไพ่ชนิดบนโต๊ะใบหนึ่ง) */
function isWildOrRank(cardId, rank) {
    return cardId === JOKER || cardId === DEVIL || cardId === rank;
}

function deckCopies(playerCount) {
    const seats = Math.max(3, Math.min(8, Number(playerCount) || 4));
    return Math.ceil(seats / SEATS_PER_DECK);
}

function buildDeck(playerCount, rng = Math.random) {
    const copies = deckCopies(playerCount);
    const deck = [];
    RANKS.forEach(rank => {
        for (let i = 0; i < PER_RANK_PER_DECK * copies; i += 1) deck.push(rank);
    });
    for (let i = 0; i < JOKERS_PER_DECK * copies; i += 1) deck.push(JOKER);
    return shuffle(deck, rng);
}

function createInitialState() {
    return {
        mode: 'liar',
        status: 'waiting',
        phase: 'lobby',
        punishment: DEFAULT_PUNISHMENT,
        devilMode: false,
        devilActive: false,
        players: [],
        seats: [],
        deckSeats: 0,
        deck: [],
        discard: [],
        currentPlayerId: null,
        forcedCall: false,
        targetRank: null,
        lastPlay: null,
        lastReveal: null,
        roundNumber: 0,
        turnNumber: 0,
        history: [],
        winner: null,
        eliminations: [],
        turnStartedAt: null,
        phaseEndsAt: null,
        statsRecordedAt: null,
        fxSeq: 0,
        fx: []
    };
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (state.fxSeq || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, at: Date.now(), ...event }].slice(-8);
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
        // ปืนลูกโม่ของตัวเอง: shots = ยิงไปแล้วกี่นัด · bullet = ช่องที่มีกระสุน (ลับ ไม่ส่งให้ client)
        shots: 0,
        bullet: null,
        alive: true,
        idleStrikes: 0
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

/** คนที่ยังรอดและยังมีไพ่ในมือ — มือว่างถูกข้ามจนจบรอบ */
function getHolders(room) {
    return room.gameState.players.filter(p => p.alive && p.hand.length > 0);
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

// เกมจริงสับกองไพ่บนโต๊ะ (A K Q) ทุกรอบ — ได้ชนิดเดิมซ้ำได้
function pickTargetRank(rng = Math.random) {
    return RANKS[Math.floor(rng() * RANKS.length)];
}

function takeCardsFromHand(player, cardIds) {
    if (!Array.isArray(cardIds) || !cardIds.length) {
        throw new Error('เลือกไพ่ 1–3 ใบ');
    }
    if (cardIds.length < MIN_PLAY || cardIds.length > MAX_PLAY) {
        throw new Error('ลงได้ครั้งละ 1–3 ใบ');
    }
    if (cardIds.length > 1 && cardIds.includes(DEVIL)) {
        throw new Error('ไพ่ปีศาจต้องลงใบเดียว');
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

/**
 * กติกาจริง: ทุกรอบสับไพ่ทั้งสำรับแล้วแจกใหม่คนละ 5 ใบ (คนตกรอบไม่ได้)
 * สร้างสำรับใหม่ทุกรอบ — ไพ่ไม่หายแม้มีคนออกกลางรอบ
 * โหมดปีศาจ: ไพ่ชนิดบนโต๊ะ 1 ใบในสำรับกลายเป็นไพ่ปีศาจ (อาจค้างในกองถ้าแจกไม่หมด)
 */
function dealRound(room, rng = Math.random) {
    const state = room.gameState;
    state.players.forEach(player => { player.hand = []; });
    state.discard = [];
    const deck = buildDeck(state.deckSeats || state.players.length, rng);
    state.devilActive = false;
    if (state.devilMode && getAlivePlayers(room).length >= DEVIL_MIN_ALIVE) {
        const spots = deck.map((card, index) => (card === state.targetRank ? index : -1)).filter(index => index >= 0);
        if (spots.length) {
            deck[spots[Math.floor(rng() * spots.length)]] = DEVIL;
            state.devilActive = true;
        }
    }
    getAlivePlayers(room).forEach(player => {
        for (let i = 0; i < HAND_SIZE && deck.length; i += 1) {
            player.hand.push(deck.pop());
        }
    });
    state.deck = deck;
}

function turnDuration(room, actor) {
    const base = room.gameState.lastPlay ? REACT_MS : PLAY_MS;
    if (actor && actor.idleStrikes > 0) return Math.min(base, AFK_MS);
    return base;
}

/** เหลือคนเดียวที่มีไพ่ (หรือคนตอบมือว่าง) = ต้องท้า ลงต่อไม่ได้ */
function computeForcedCall(room, actor) {
    const state = room.gameState;
    if (!state.lastPlay || !actor || actor.playerId === state.lastPlay.playerId) return false;
    if (!actor.hand.length) return true;
    return getHolders(room).every(p => p.playerId === actor.playerId);
}

function beginTurn(room, playerId) {
    const state = room.gameState;
    if (checkWinner(room)) return state;

    let actor = null;
    const lastPlay = state.lastPlay;
    if (lastPlay) {
        // คนถัดจากคนลงที่ยังมีไพ่ (มือว่างข้าม) · ไม่มีใครมีไพ่เลย = คนถัดไปต้องท้า
        actor = nextAlive(room, lastPlay.playerId, p => p.alive && p.hand.length > 0 && p.playerId !== lastPlay.playerId)
            || nextAlive(room, lastPlay.playerId, p => p.alive && p.playerId !== lastPlay.playerId);
    } else {
        const start = getPlayer(room, playerId);
        actor = start && start.alive && start.hand.length
            ? start
            : nextAlive(room, playerId, p => p.alive && p.hand.length > 0);
        if (!actor) {
            // ไม่มีไพ่บนโต๊ะและไม่มีใครมีไพ่ (เกิดได้หลังคนออกกลางรอบ) → เริ่มรอบใหม่
            const starter = start && start.alive ? start : nextAlive(room, playerId);
            return startRound(room, starter?.playerId || null);
        }
    }

    if (!actor) return state;

    state.currentPlayerId = actor.playerId;
    state.forcedCall = computeForcedCall(room, actor);
    state.turnNumber += 1;
    state.turnStartedAt = Date.now();
    setPhase(room, 'turn', turnDuration(room, actor));
    return state;
}

function startRound(room, starterId) {
    const state = room.gameState;
    state.lastPlay = null;
    state.forcedCall = false;
    state.roundNumber += 1;
    state.targetRank = pickTargetRank();
    dealRound(room);
    if (state.roundNumber > 1) pushFx(room, { kind: 'draw' });
    const rank = describeCard(state.targetRank);
    pushHistory(room, rank.icon, `รอบที่ ${state.roundNumber} — ไพ่บนโต๊ะคือ ${rank.thaiName}`, 'round');
    if (state.devilActive) {
        pushHistory(room, '😈', 'รอบนี้มีไพ่ปีศาจ 1 ใบ — ต้องลงใบเดียว ใครท้าโดน ทุกคนยกเว้นคนลงรับโทษ', 'devil');
    }
    pushFx(room, { kind: 'round', targetRank: rank, roundNumber: state.roundNumber, devil: !!state.devilActive });
    return beginTurn(room, starterId);
}

function checkWinner(room) {
    const state = room.gameState;
    if (state.phase === 'finished') return true;
    const alive = getAlivePlayers(room);
    if (alive.length > 1) return false;

    state.winner = alive[0]
        ? { playerId: alive[0].playerId, name: alive[0].name }
        : { playerId: null, name: 'ไม่มีผู้รอด' };
    state.phase = 'finished';
    state.status = 'liar_finished';
    state.phaseEndsAt = null;
    state.currentPlayerId = null;
    state.forcedCall = false;
    state.lastPlay = null;
    pushHistory(room, '🏆', `${state.winner.name} เป็นผู้รอดคนสุดท้าย!`, 'winner');
    return true;
}

function recordElimination(room, player, reason) {
    const state = room.gameState;
    state.eliminations = Array.isArray(state.eliminations) ? state.eliminations : [];
    if (state.eliminations.some(item => item.playerId === player.playerId)) return;
    state.eliminations.push({ playerId: player.playerId, roundNumber: state.roundNumber || 0, reason });
}

function eliminate(room, player, reason) {
    player.alive = false;
    player.lives = 0;
    discardCards(room, player.hand);
    player.hand = [];
    recordElimination(room, player, reason);
}

/** ช่องที่มีกระสุนของปืนแต่ละคน — สุ่มครั้งเดียวตอนเริ่มเกม (เกมจริงไม่หมุนลูกโม่ใหม่) */
function loadRevolver(player, rng = Math.random) {
    player.shots = 0;
    player.bullet = 1 + Math.floor(rng() * CHAMBERS);
}

/**
 * ลงโทษคนแพ้ — ยิงปืนลูกโม่ หรือเสียหัวใจ ตามที่ตั้งห้อง
 * คืน { playerId, died, shots, lives } ไว้ทำเอฟเฟกต์
 */
function punish(room, playerId, reason) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    if (!player || !player.alive) return null;

    if (state.punishment === 'revolver') {
        if (!Number.isInteger(player.bullet) || player.bullet < 1 || player.bullet > CHAMBERS) loadRevolver(player);
        player.shots = (Number(player.shots) || 0) + 1;
        const died = player.shots >= player.bullet;
        if (died) {
            eliminate(room, player, reason || 'shot');
            pushHistory(room, '💥', `${player.name} ลั่นไก — ปัง! ตกรอบ (นัดที่ ${player.shots})`, 'eliminated');
        } else {
            const left = CHAMBERS - player.shots;
            pushHistory(room, '🔫', `${player.name} ลั่นไก — แชะ… รอด (ยิงไป ${player.shots}/${CHAMBERS} · นัดหน้าโดน 1 ใน ${left})`, reason || 'shot');
        }
        return { playerId, died, shots: player.shots, lives: player.alive ? 1 : 0 };
    }

    player.lives = Math.max(0, player.lives - 1);
    if (player.lives > 0) {
        pushHistory(room, '💔', `${player.name} เสียหัวใจ 1 ดวง เหลือ ${player.lives}`, reason || 'life');
        return { playerId, died: false, shots: 0, lives: player.lives };
    }
    eliminate(room, player, reason || 'life');
    pushHistory(room, '💀', `${player.name} หัวใจหมด — ตกรอบแล้ว`, 'eliminated');
    return { playerId, died: true, shots: 0, lives: 0 };
}

function startGame(room) {
    const state = resetRoomGame(room);
    if (state.players.length < 3 || state.players.length > 8) {
        throw new Error('โกหกเล่นได้ 3–8 คน');
    }
    const settings = room.settings || {};
    state.status = 'playing';
    state.punishment = sanitizePunishment(settings.liarPunishment);
    state.devilMode = sanitizeDevil(settings.liarDevil);
    state.deckSeats = state.players.length;
    // ลำดับที่นั่งเดิม — ใช้ใส่ที่นั่งคืนตอนมีคนออก (roomManager ลบออกจาก players ก่อน engine เห็น)
    state.seats = state.players.map(p => ({
        playerId: p.playerId, name: p.name, color: p.color, avatar: p.avatar, avatarFrame: p.avatarFrame
    }));
    state.players.forEach(player => {
        player.lives = state.punishment === 'lives' ? STARTING_LIVES : 1;
        loadRevolver(player);
    });
    room.gameState = state;

    const how = state.punishment === 'revolver'
        ? `ปืนคนละกระบอก ${CHAMBERS} ช่อง กระสุน 1 นัด`
        : `หัวใจ ${STARTING_LIVES} ดวง`;
    pushHistory(room, '🎬', `เริ่มเกม — คนละ ${HAND_SIZE} ใบ · ${how}${state.devilMode ? ' · มีไพ่ปีศาจ' : ''}`);
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

function submitPlay(room, playerId, cardIds, options = {}) {
    const player = assertCurrentTurn(room, playerId);
    const state = room.gameState;
    if (!player.hand.length) {
        throw new Error('ไพ่ในมือหมด ต้องท้าอย่างเดียว');
    }
    if (state.forcedCall) {
        throw new Error('เหลือคุณคนเดียวที่มีไพ่ — ต้องกดโกหก!');
    }

    const taken = takeCardsFromHand(player, cardIds);
    if (!options.auto) player.idleStrikes = 0;
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
    const emptied = player.hand.length === 0 ? ' · ไพ่หมดมือ' : '';
    pushHistory(room, '🂠', `${player.name} ลง ${taken.length} ใบ บอกว่าเป็น ${rank.thaiName}${emptied}`, 'play');
    pushFx(room, { kind: 'play', fromId: playerId, count: taken.length });

    return beginTurn(room, playerId);
}

function submitChallenge(room, playerId, options = {}) {
    const challenger = assertCurrentTurn(room, playerId);
    if (!options.auto) challenger.idleStrikes = 0;
    const state = room.gameState;
    const lastPlay = state.lastPlay;
    if (!lastPlay || !lastPlay.cards?.length) {
        throw new Error('ยังไม่มีไพ่ให้ท้า');
    }
    if (lastPlay.playerId === playerId) {
        throw new Error('ท้าตาตัวเองไม่ได้');
    }

    const actor = getPlayer(room, lastPlay.playerId);
    const devil = lastPlay.cards.includes(DEVIL);
    const truthful = lastPlay.cards.every(cardId => isWildOrRank(cardId, state.targetRank));
    const outcome = devil ? 'devil' : (truthful ? 'truth' : 'lie');
    const shown = lastPlay.cards.map(describeCard).map(card => card.thaiName).join(' ');
    const rank = describeCard(state.targetRank);
    const actorName = actor?.name || 'คนลง';

    // ใครรับโทษ: โกหก = คนลง · ของจริง = คนท้า · ปีศาจ = ทุกคนที่รอด ยกเว้นคนลง (เริ่มจากคนท้า)
    let victims;
    if (outcome === 'lie') {
        victims = [lastPlay.playerId];
    } else if (outcome === 'truth') {
        victims = [playerId];
    } else {
        const order = state.players;
        const from = Math.max(0, order.findIndex(p => p.playerId === playerId));
        victims = [];
        for (let step = 0; step < order.length; step += 1) {
            const p = order[(from + step) % order.length];
            if (p.alive && p.playerId !== lastPlay.playerId) victims.push(p.playerId);
        }
    }

    discardCards(room, lastPlay.cards);
    state.lastPlay = null;
    state.forcedCall = false;

    if (outcome === 'truth') {
        pushHistory(room, '✅', `${challenger.name} ท้าแล้วพลาด — ${actorName} ลง ${rank.thaiName} จริง (${shown})`, 'reveal-truth');
    } else if (outcome === 'lie') {
        pushHistory(room, '🚨', `${challenger.name} จับได้! ${actorName} โกหก (${shown})`, 'reveal-lie');
    } else {
        pushHistory(room, '😈', `${challenger.name} ท้าโดนไพ่ปีศาจของ ${actorName} — ทุกคนยกเว้น ${actorName} รับโทษ`, 'reveal-devil');
    }

    const reason = outcome === 'lie' ? 'caught' : (outcome === 'truth' ? 'challenge-fail' : 'devil');
    const results = victims.map(id => punish(room, id, reason)).filter(Boolean);
    const loserId = victims[0] || null;
    const loser = getPlayer(room, loserId);

    state.lastReveal = {
        actorId: lastPlay.playerId,
        challengerId: playerId,
        cards: [...lastPlay.cards],
        truthful: outcome !== 'lie',
        outcome,
        targetRank: state.targetRank,
        loserId,
        results
    };

    pushFx(room, {
        kind: 'reveal',
        truthful: outcome !== 'lie',
        outcome,
        punishment: state.punishment,
        actorId: lastPlay.playerId,
        challengerId: playerId,
        loserId,
        loserLives: loser ? loser.lives : 0,
        results,
        cards: lastPlay.cards.map(describeCard)
    });

    if (checkWinner(room)) return state;

    // คนเริ่มรอบหน้า: คนที่โดนจับโกหก (ถ้ายังรอด) · ไม่งั้นคนถัดจากคนท้า
    let starter = null;
    if (outcome === 'lie') {
        starter = actor && actor.alive ? actor : nextAlive(room, lastPlay.playerId);
    } else {
        starter = nextAlive(room, playerId);
    }
    return startRound(room, starter?.playerId || playerId);
}

function autoResolvePhase(room) {
    const state = room.gameState;
    if (!state || state.phase === 'finished' || state.phase === 'lobby') return state;
    if (state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;
    if (state.phase !== 'turn') return state;

    const actor = getPlayer(room, state.currentPlayerId);
    if (!actor || !actor.alive) {
        return beginTurn(room, nextAlive(room, state.currentPlayerId)?.playerId);
    }

    try {
        // นับก่อนสั่ง — beginTurn ของตาถัดไปอ่านค่านี้ (กรณีวนกลับมาคนเดิม)
        actor.idleStrikes = (Number(actor.idleStrikes) || 0) + 1;
        if (state.lastPlay && (state.forcedCall || !actor.hand.length)) {
            pushHistory(room, '⏰', `${actor.name} หมดเวลา — ท้าอัตโนมัติ`);
            return submitChallenge(room, actor.playerId, { auto: true });
        }
        if (!actor.hand.length) {
            return beginTurn(room, nextAlive(room, actor.playerId, p => p.alive && p.hand.length > 0)?.playerId || actor.playerId);
        }
        pushHistory(room, '⏰', `${actor.name} หมดเวลา — ลง 1 ใบอัตโนมัติ`);
        return submitPlay(room, actor.playerId, [actor.hand[0]], { auto: true });
    } catch (error) {
        return beginTurn(room, nextAlive(room, actor.playerId)?.playerId || actor.playerId);
    }
}

/**
 * roomManager.leaveRoom/kick เอาคนออกจาก gameState.players ก่อนเรียก handlePlayerLeft
 * → ใส่ที่นั่งคืนเป็น "ออกแล้ว" ตามลำดับเดิม ให้ส่งตา/เช็คผู้ชนะได้ถูก
 * และลบ snapshot กลับเข้าเกม — ออกกลางเกม = ตกรอบ ไม่กลับมาพร้อมไพ่เดิม
 */
function restoreLeftSeat(room, playerId) {
    const state = room.gameState;
    const seats = Array.isArray(state.seats) ? state.seats : [];
    const seatIndex = seats.findIndex(seat => seat.playerId === playerId);
    if (seatIndex < 0) return null;
    const snapshot = room.rejoinableGamePlayers instanceof Map ? room.rejoinableGamePlayers.get(playerId) : null;
    if (room.rejoinableGamePlayers instanceof Map) room.rejoinableGamePlayers.delete(playerId);

    const seat = seats[seatIndex];
    const wasOut = (state.eliminations || []).some(item => item.playerId === playerId);
    const ghost = {
        ...createPlayerState({
            playerId,
            playerName: snapshot?.name || seat.name || 'ผู้เล่น',
            color: seat.color,
            avatar: seat.avatar,
            avatarFrame: seat.avatarFrame
        }),
        lives: snapshot ? snapshot.lives : 0,
        shots: snapshot ? snapshot.shots : 0,
        bullet: snapshot ? snapshot.bullet : null,
        alive: snapshot ? snapshot.alive !== false : !wasOut,
        hand: []
    };
    const seatOf = id => seats.findIndex(item => item.playerId === id);
    const insertAt = state.players.filter(p => {
        const at = seatOf(p.playerId);
        return at >= 0 && at < seatIndex;
    }).length;
    state.players.splice(insertAt, 0, ghost);
    return ghost;
}

function handlePlayerLeft(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase === 'lobby' || state.phase === 'finished') return state;
    const player = getPlayer(room, playerId) || restoreLeftSeat(room, playerId);
    if (!player || !player.alive) return state;

    eliminate(room, player, 'left');
    pushHistory(room, '🚪', `${player.name} ออกจากเกม — นับว่าตกรอบ`);

    if (checkWinner(room)) return state;

    if (state.lastPlay?.playerId === playerId) {
        // คนที่ไพ่รอให้ท้าออกไป — เปิดรอบใหม่ เริ่มที่คนถัดไป
        discardCards(room, state.lastPlay.cards || []);
        state.lastPlay = null;
        return startRound(room, nextAlive(room, playerId)?.playerId);
    }

    if (state.currentPlayerId === playerId) {
        return beginTurn(room, nextAlive(room, playerId)?.playerId);
    }

    if (!state.lastPlay && !getHolders(room).length) {
        return startRound(room, state.currentPlayerId);
    }
    // คนออกอาจเป็นอีกคนเดียวที่มีไพ่ → คนที่ถึงตาตอนนี้ต้องท้า
    const actor = getPlayer(room, state.currentPlayerId);
    if (actor) state.forcedCall = computeForcedCall(room, actor);
    return state;
}

// ---------- บอท ----------
function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function botNeedsTurn(room) {
    const state = room?.gameState;
    if (!state || state.status !== 'playing' || state.phase !== 'turn') return false;
    if (!isBotId(state.currentPlayerId)) return false;
    const bot = getPlayer(room, state.currentPlayerId);
    return !!(bot && bot.alive && (bot.hand.length || state.lastPlay));
}

/** ms ที่บอทควรรอก่อนเล่น — ตาแรกหลังหงายไพ่รอนานขึ้นให้คนอ่านผลทัน */
function botDelay(room, now = Date.now()) {
    if (!botNeedsTurn(room)) return null;
    const state = room.gameState;
    const afterReveal = !state.lastPlay && !!state.lastReveal;
    // โหมดปืน: หน้าจอเล่น "ลั่นไก… แชะ/ปัง" ต่อจากผลหงายไพ่ — บอทรอให้จบก่อน
    const revolverPause = afterReveal && state.punishment === 'revolver' ? Math.round(BOT_AFTER_REVEAL_MS * 0.6) : 0;
    const think = (afterReveal ? BOT_AFTER_REVEAL_MS + revolverPause : BOT_THINK_MS) + ((Number(state.turnNumber) || 0) % 3) * 250;
    const due = (Number(state.turnStartedAt) || now) + think;
    return Math.max(150, due - now);
}

/** ของจริงทั้งสำรับ (ไพ่ชนิดนั้น + โจ๊กเกอร์) — รู้ได้จากจำนวนคน ไม่ต้องแอบดูกอง */
function totalTruthCards(room) {
    const copies = deckCopies(room.gameState.deckSeats || room.gameState.players.length);
    return (PER_RANK_PER_DECK + JOKERS_PER_DECK) * copies;
}

function playBotTurn(room, rng = Math.random) {
    if (!botNeedsTurn(room)) return false;
    const state = room.gameState;
    const bot = getPlayer(room, state.currentPlayerId);
    const target = state.targetRank;
    const hasDevil = bot.hand.includes(DEVIL);
    const matching = bot.hand.filter(cardId => cardId !== DEVIL && isWildOrRank(cardId, target))
        .sort((a, b) => (a === JOKER) - (b === JOKER));
    const others = shuffle(bot.hand.filter(cardId => !isWildOrRank(cardId, target)), rng);

    if (state.lastPlay && state.lastPlay.playerId !== bot.playerId) {
        if (!bot.hand.length || state.forcedCall) {
            submitChallenge(room, bot.playerId);
            return true;
        }
        const claimed = Number(state.lastPlay.count) || 1;
        const unseen = totalTruthCards(room) - matching.length - (hasDevil ? 1 : 0);
        let chance = 0.16 + 0.14 * (claimed - 1);
        if (!matching.length) chance += 0.15;
        if (getPlayer(room, state.lastPlay.playerId)?.hand.length === 0) chance += 0.1;
        // ยิงไปหลายนัดแล้ว ปืนตัวเองเสี่ยงขึ้น — ท้าระวังขึ้น
        if (state.punishment === 'revolver') chance -= 0.03 * (Number(bot.shots) || 0);
        if (state.devilActive && claimed === 1) chance -= 0.08;
        if (claimed > unseen || rng() < chance) {
            submitChallenge(room, bot.playerId);
            return true;
        }
    }

    if (!bot.hand.length) return false;
    let cards;
    if (hasDevil && (bot.hand.length === 1 || rng() < 0.35)) {
        cards = [DEVIL];
    } else if (matching.length) {
        const count = Math.min(matching.length, MAX_PLAY, 1 + (rng() < 0.45 ? 1 : 0));
        cards = matching.slice(0, count);
        if (others.length && cards.length < MAX_PLAY && rng() < 0.12) cards.push(others[0]);
    } else if (others.length) {
        const count = Math.min(others.length, 1 + (others.length > 1 && rng() < 0.3 ? 1 : 0));
        cards = others.slice(0, count);
    } else {
        cards = [DEVIL];
    }
    submitPlay(room, bot.playerId, cards);
    return true;
}

function getAvailableActions(room, viewerPlayerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'turn' || state.currentPlayerId !== viewerPlayerId) {
        return { canPlay: false, canChallenge: false, forcedCall: false, minPlay: MIN_PLAY, maxPlay: MAX_PLAY };
    }
    const player = getPlayer(room, viewerPlayerId);
    if (!player || !player.alive) {
        return { canPlay: false, canChallenge: false, forcedCall: false, minPlay: MIN_PLAY, maxPlay: MAX_PLAY };
    }
    return {
        canPlay: player.hand.length > 0 && !state.forcedCall,
        canChallenge: !!(state.lastPlay && state.lastPlay.playerId !== viewerPlayerId),
        forcedCall: !!state.forcedCall,
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
    const punishment = sanitizePunishment(state.punishment);
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
            actorId: state.lastReveal.actorId,
            challengerId: state.lastReveal.challengerId,
            loserId: state.lastReveal.loserId || null,
            loserName: getPlayer(room, state.lastReveal.loserId)?.name || '',
            loserLives: getPlayer(room, state.lastReveal.loserId)?.lives ?? null,
            actorName: getPlayer(room, state.lastReveal.actorId)?.name || '',
            challengerName: getPlayer(room, state.lastReveal.challengerId)?.name || '',
            truthful: state.lastReveal.truthful,
            outcome: state.lastReveal.outcome || (state.lastReveal.truthful ? 'truth' : 'lie'),
            results: (state.lastReveal.results || []).map(item => ({
                ...item,
                name: getPlayer(room, item.playerId)?.name || ''
            })),
            targetRank: describeCard(state.lastReveal.targetRank),
            cards: state.lastReveal.cards.map(describeCard)
        }
        : null;

    return {
        mode: 'liar',
        status: state.status,
        phase: state.phase,
        isFinished,
        punishment,
        chambers: CHAMBERS,
        devilMode: !!state.devilMode,
        devilActive: !!state.devilActive,
        forcedCall: !!state.forcedCall,
        roundNumber: state.roundNumber,
        turnNumber: state.turnNumber,
        currentPlayerId: state.currentPlayerId,
        phaseEndsAt: state.phaseEndsAt,
        targetRank: target,
        lastPlay,
        lastReveal,
        winner: state.winner,
        eliminations: (state.eliminations || []).map(item => ({
            playerId: item.playerId,
            name: getPlayer(room, item.playerId)?.name || '',
            roundNumber: item.roundNumber,
            reason: item.reason
        })),
        maxLives: punishment === 'lives' ? STARTING_LIVES : 1,
        history: state.history || [],
        deckCount: Array.isArray(state.deck) ? state.deck.length : 0,
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        self: viewer ? {
            playerId: viewer.playerId,
            lives: viewer.lives,
            shots: Number(viewer.shots) || 0,
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
            // ยิงไปแล้วกี่นัด (ทุกคนเห็น) — ช่องที่มีกระสุน (bullet) ห้ามส่งออกไป
            shots: Number(player.shots) || 0,
            alive: player.alive,
            isBot: isBotId(player.playerId),
            afk: (Number(player.idleStrikes) || 0) > 0,
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
    description: 'รอดคนสุดท้ายชนะ — ลงไพ่คว่ำ อ้างว่าเป็นไพ่บนโต๊ะ ใครแพ้ต้องลั่นไกปืน · 3–8 คน',
    minPlayers: 3,
    maxPlayers: 8,
    CARD_DEFINITIONS,
    CARD_BACK,
    RANKS,
    JOKER,
    DEVIL,
    HAND_SIZE,
    STARTING_LIVES,
    CHAMBERS,
    PUNISHMENTS,
    DEFAULT_PUNISHMENT,
    sanitizePunishment,
    sanitizeDevil,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    submitPlay,
    submitChallenge,
    autoResolvePhase,
    handlePlayerLeft,
    buildClientState,
    buildDeck,
    deckCopies,
    isBotId,
    botNeedsTurn,
    botDelay,
    playBotTurn
};
