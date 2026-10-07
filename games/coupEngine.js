/**
 * Coup — เกมโค่นอำนาจ (2-6 คน)
 *
 * แก่นของเกมคือ "โกหกได้" — ประกาศแอ็กชันของตัวละครที่ตัวเองไม่มีก็ได้
 * คนอื่นเลือกได้ว่าจะเชื่อ, Challenge (ไม่เชื่อว่ามีการ์ด) หรือ Block (ขวางด้วยการ์ดอื่น)
 *
 * เฟสของเกม:
 *   action        → ถึงตาใคร คนนั้นเลือกแอ็กชัน 1 อย่าง
 *   respond       → คนอื่นมีสิทธิ์ challenge / block / ผ่าน
 *   block-respond → คนที่โดน block เลือกว่าจะ challenge การ block นั้นไหม
 *   lose-influence→ คนที่แพ้ต้องเลือกหงายการ์ด 1 ใบ
 *   exchange      → Ambassador เลือกการ์ดที่จะเก็บ
 *   finished      → เหลือคนเดียว
 */

const { gameAssetImage } = require('./gameAssets');

const COUP_IMAGE = id => gameAssetImage('coup', id);

const CARD_DEFINITIONS = {
    duke: {
        id: 'duke', icon: '👑', image: COUP_IMAGE('duke'),
        name: 'Duke', thaiName: 'ดยุค',
        power: 'เก็บภาษี — หยิบ 3 เหรียญ',
        counter: 'ขวาง Foreign Aid ของคนอื่นได้'
    },
    assassin: {
        id: 'assassin', icon: '🗡️', image: COUP_IMAGE('assassin'),
        name: 'Assassin', thaiName: 'นักฆ่า',
        power: 'ลอบสังหาร — จ่าย 3 เหรียญ บังคับเป้าหมายหงายการ์ด',
        counter: ''
    },
    captain: {
        id: 'captain', icon: '⚓', image: COUP_IMAGE('captain'),
        name: 'Captain', thaiName: 'กัปตัน',
        power: 'ขโมย — หยิบ 2 เหรียญจากคนอื่น',
        counter: 'ขวางการโดนขโมยได้'
    },
    ambassador: {
        id: 'ambassador', icon: '🕊️', image: COUP_IMAGE('ambassador'),
        name: 'Ambassador', thaiName: 'ทูต',
        power: 'แลกเปลี่ยน — จั่ว 2 ใบ แล้วเลือกเก็บ',
        counter: 'ขวางการโดนขโมยได้'
    },
    contessa: {
        id: 'contessa', icon: '🛡️', image: COUP_IMAGE('contessa'),
        name: 'Contessa', thaiName: 'ท่านหญิง',
        power: '',
        counter: 'ขวางการลอบสังหารได้'
    }
};

const CARD_IDS = Object.keys(CARD_DEFINITIONS);
const COPIES_PER_CARD = 3;
const STARTING_COINS = 2;
const TWO_PLAYER_STARTER_COINS = 1;
const FORCED_COUP_AT = 10;
const COUP_COST = 7;
const ASSASSINATE_COST = 3;

/**
 * claim = การ์ดที่ต้องอ้างว่ามี (null = แอ็กชันทั่วไป ใครก็ทำได้ challenge ไม่ได้)
 * blockedBy = การ์ดที่ขวางแอ็กชันนี้ได้
 */
const ACTIONS = {
    income: {
        id: 'income', label: 'Income', thaiLabel: 'รับรายได้', icon: '🪙',
        detail: 'หยิบ 1 เหรียญ', cost: 0, claim: null, blockedBy: [], needsTarget: false
    },
    foreign_aid: {
        id: 'foreign_aid', label: 'Foreign Aid', thaiLabel: 'เงินช่วยเหลือ', icon: '💶',
        detail: 'หยิบ 2 เหรียญ (Duke ขวางได้)', cost: 0, claim: null, blockedBy: ['duke'], needsTarget: false
    },
    coup: {
        id: 'coup', label: 'Coup', thaiLabel: 'รัฐประหาร', icon: '💥',
        detail: 'จ่าย 7 เหรียญ บังคับหงายการ์ด — ขวางไม่ได้',
        cost: COUP_COST, claim: null, blockedBy: [], needsTarget: true
    },
    tax: {
        id: 'tax', label: 'Tax', thaiLabel: 'เก็บภาษี', icon: '👑',
        detail: 'หยิบ 3 เหรียญ', cost: 0, claim: 'duke', blockedBy: [], needsTarget: false
    },
    assassinate: {
        id: 'assassinate', label: 'Assassinate', thaiLabel: 'ลอบสังหาร', icon: '🗡️',
        detail: 'จ่าย 3 เหรียญ บังคับเป้าหมายหงายการ์ด (Contessa ขวางได้)',
        cost: ASSASSINATE_COST, claim: 'assassin', blockedBy: ['contessa'], needsTarget: true
    },
    steal: {
        id: 'steal', label: 'Steal', thaiLabel: 'ขโมย', icon: '⚓',
        detail: 'หยิบ 2 เหรียญจากเป้าหมาย (Captain/Ambassador ขวางได้)',
        cost: 0, claim: 'captain', blockedBy: ['captain', 'ambassador'], needsTarget: true
    },
    exchange: {
        id: 'exchange', label: 'Exchange', thaiLabel: 'แลกเปลี่ยน', icon: '🕊️',
        detail: 'จั่ว 2 ใบ เลือกเก็บ แล้วคืน 2 ใบ', cost: 0, claim: 'ambassador', blockedBy: [], needsTarget: false
    }
};

// เวลาเลือกแอ็กชันต่อตา — หัวห้องตั้งได้ (settings.coupActionSeconds) · env ใช้เร่งเทส
const ACTION_SECONDS_OPTIONS = [30, 60, 90];
const DEFAULT_ACTION_SECONDS = 60;
const ENV_ACTION_MS = Number(process.env.COUP_ACTION_MS) || 0;
const RESPOND_MS = Number(process.env.COUP_RESPOND_MS) || 20000;
const DECIDE_MS = Number(process.env.COUP_DECIDE_MS) || 30000;

function sanitizeActionSeconds(value) {
    const n = Number(value);
    return ACTION_SECONDS_OPTIONS.includes(n) ? n : DEFAULT_ACTION_SECONDS;
}

function getActionMs(room) {
    if (ENV_ACTION_MS) return ENV_ACTION_MS;
    return sanitizeActionSeconds(room?.settings?.coupActionSeconds) * 1000;
}

function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function buildDeck() {
    const deck = [];
    CARD_IDS.forEach(id => {
        for (let i = 0; i < COPIES_PER_CARD; i += 1) deck.push(id);
    });
    return shuffle(deck);
}

function createInitialState() {
    return {
        mode: 'coup',
        status: 'waiting',
        phase: 'lobby',
        players: [],
        deck: [],
        treasury: 50,
        currentPlayerId: null,
        turnNumber: 0,
        pendingAction: null,   // { actionId, actorId, targetId, claim, coinsPaid }
        pendingBlock: null,    // { blockerId, claim }
        responses: {},         // playerId -> 'pass'
        pendingLoss: null,     // { playerId, reason, resumeAfter }
        pendingExchange: null, // { playerId, options: [cardIds], keepCount }
        history: [],
        winner: null,
        phaseEndsAt: null,
        step: 0,               // เพิ่มทุกครั้งที่เปลี่ยนเฟส — client ส่งกลับมาเพื่อกันคำตอบค้างข้ามเฟส
        statsRecordedAt: null
    };
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        name: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        permission: context.isAdmin ? 'admin' : null,
        influence: [],   // การ์ดที่ยังคว่ำอยู่ (ความลับ)
        revealed: [],    // การ์ดที่หงายแล้ว (เปิดเผย)
        coins: 0,
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

/**
 * kind บอกชนิดของเหตุการณ์ให้หน้าเว็บรู้ว่าควรเล่นอนิเมชันแบบไหน
 * (เดาจากข้อความไม่ได้ เพราะข้อความเปลี่ยนได้ตลอด)
 */
function pushHistory(room, icon, text, kind = null) {
    room.gameState.history = [
        { icon, text, kind, at: new Date().toISOString() },
        ...(room.gameState.history || [])
    ].slice(0, 40);
}

function setPhase(room, phase, durationMs) {
    room.gameState.step = (Number(room.gameState.step) || 0) + 1;
    room.gameState.phase = phase;
    room.gameState.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
}

/** การ์ดที่ไม่ได้อยู่ในมือใคร ไม่ได้หงาย และไม่ได้ค้างอยู่ในการแลกเปลี่ยน */
function unaccountedCards(room) {
    const state = room.gameState;
    const inPlay = [];
    state.players.forEach(player => inPlay.push(...player.influence, ...player.revealed));
    if (state.pendingExchange) inPlay.push(...state.pendingExchange.options);

    const remaining = [];
    CARD_IDS.forEach(id => {
        const used = inPlay.filter(card => card === id).length;
        for (let i = 0; i < COPIES_PER_CARD - used; i += 1) remaining.push(id);
    });
    return remaining;
}

/**
 * เดิมกองหมดแล้วสร้างสำรับใหม่ทั้ง 15 ใบ ทำให้เกิดการ์ดซ้ำกับใบที่อยู่ในมือคน
 * (เทสวัดได้ว่าการ์ดในระบบพุ่งเป็น 25 ใบ) — ตอนนี้เติมจากใบที่ยังไม่มีใครถือเท่านั้น
 */
function drawCard(room) {
    const state = room.gameState;
    if (!state.deck.length) {
        state.deck = shuffle(unaccountedCards(room));
    }
    return state.deck.pop() || null;
}

function returnCardToDeck(room, cardId) {
    room.gameState.deck.push(cardId);
    room.gameState.deck = shuffle(room.gameState.deck);
}

function startGame(room) {
    const state = resetRoomGame(room);
    state.status = 'playing';
    state.deck = buildDeck();

    state.players.forEach(player => {
        player.influence = [state.deck.pop(), state.deck.pop()];
        player.coins = STARTING_COINS;
        player.alive = true;
    });

    // กติกา: "คนที่ชนะเกมที่แล้วเริ่มก่อน" — เกมแรกของห้องให้หัวห้อง/คนแรกเริ่ม
    const starter = state.players.find(p => p.playerId === room.coupLastWinnerId) || state.players[0] || null;
    state.currentPlayerId = starter ? starter.playerId : null;
    // กติกา 2 คน: คนเริ่มได้แค่ 1 เหรียญ (ชดเชยความได้เปรียบของการได้เล่นก่อน)
    const twoPlayer = state.players.length === 2;
    if (twoPlayer && starter) starter.coins = TWO_PLAYER_STARTER_COINS;
    // ลำดับที่นั่งตอนเริ่ม — คนออกกลางเกมถูกตัดจาก players ไปแล้ว ตายังต้องวนต่อจากที่นั่งเดิม
    state.seatOrder = state.players.map(p => p.playerId);
    state.turnNumber = 1;
    room.gameState = state;
    setPhase(room, 'action', getActionMs(room));
    pushHistory(room, '🎬', twoPlayer && starter
        ? `เริ่มเกม 2 คน — ${starter.name} เริ่มก่อนได้ ${TWO_PLAYER_STARTER_COINS} เหรียญ อีกคนได้ 2 · การ์ดคนละ 2 ใบ`
        : `เริ่มเกม — การ์ดคนละ 2 ใบ เหรียญคนละ 2${starter ? ` · ${starter.name} เริ่มก่อน` : ''}`);
    return room.gameState;
}

// ---------- จบตา / หาผู้ชนะ ----------

function checkWinner(room) {
    const alive = getAlivePlayers(room);
    if (alive.length <= 1) {
        room.gameState.winner = alive[0]
            ? { playerId: alive[0].playerId, name: alive[0].name }
            : { playerId: null, name: 'ไม่มีผู้รอด' };
        // เกมหน้าในห้องเดิม ผู้ชนะได้เริ่มก่อน (ตามกติกา)
        room.coupLastWinnerId = room.gameState.winner.playerId || null;
        room.gameState.phase = 'finished';
        room.gameState.status = 'coup_finished';
        room.gameState.phaseEndsAt = null;
        pushHistory(room, '🏆', `${room.gameState.winner.name} เป็นผู้รอดคนสุดท้าย!`, 'winner');
        return true;
    }
    return false;
}

function advanceTurn(room) {
    if (checkWinner(room)) return;

    const state = room.gameState;
    state.pendingAction = null;
    state.pendingBlock = null;
    state.pendingLoss = null;
    state.pendingExchange = null;
    state.responses = {};

    const order = Array.isArray(state.seatOrder) && state.seatOrder.length
        ? state.seatOrder
        : state.players.map(p => p.playerId);
    const startIndex = order.indexOf(state.currentPlayerId);
    for (let step = 1; step <= order.length; step += 1) {
        const candidate = getPlayer(room, order[(startIndex + step + order.length) % order.length]);
        if (candidate && candidate.alive) {
            state.currentPlayerId = candidate.playerId;
            break;
        }
    }
    state.turnNumber += 1;
    setPhase(room, 'action', getActionMs(room));
}

/** ตกรอบ — กติกา: "คืนเหรียญทั้งหมดเข้าคลัง" (คนตกรอบไม่ถือเหรียญค้างไว้) */
function eliminate(player) {
    player.alive = false;
    player.coins = 0;
}

/** บังคับให้ผู้เล่นหงายการ์ด 1 ใบ — ถ้าเหลือใบเดียวหงายให้เลย */
function requireInfluenceLoss(room, playerId, reason, resumeAfter) {
    const player = getPlayer(room, playerId);
    if (!player || !player.alive || !player.influence.length) {
        return finishLoss(room, resumeAfter);
    }

    if (player.influence.length === 1) {
        const [card] = player.influence.splice(0, 1);
        player.revealed.push(card);
        eliminate(player);
        pushHistory(room, '💀', `${player.name} หงาย ${CARD_DEFINITIONS[card].thaiName} — ตกรอบแล้ว`, 'eliminated');
        return finishLoss(room, resumeAfter);
    }

    room.gameState.pendingLoss = { playerId, reason, resumeAfter };
    setPhase(room, 'lose-influence', DECIDE_MS);
    return room.gameState;
}

function finishLoss(room, resumeAfter) {
    room.gameState.pendingLoss = null;
    if (checkWinner(room)) return room.gameState;

    if (resumeAfter === 'resolve-action') return resolvePendingAction(room);
    if (resumeAfter === 'block-window') return openBlockWindow(room);
    if (resumeAfter === 'cancel-action') {
        refundPendingAction(room);
        advanceTurn(room);
        return room.gameState;
    }
    advanceTurn(room);
    return room.gameState;
}

/** ใครขวางแอ็กชันที่ค้างอยู่ได้บ้าง (แอ็กชันมีเป้าหมาย = เฉพาะเป้าหมาย) */
function getEligibleBlockers(room) {
    const pending = room.gameState.pendingAction;
    if (!pending) return [];
    const action = ACTIONS[pending.actionId];
    if (!action || !action.blockedBy.length) return [];
    return getAlivePlayers(room)
        .filter(p => p.playerId !== pending.actorId)
        .filter(p => !pending.targetId || p.playerId === pending.targetId)
        .map(p => p.playerId);
}

/**
 * คนสั่งชนะ challenge (มีการ์ดจริง) — แอ็กชันยังขวางได้อยู่ตามกติกา
 * เปิดช่วงตอบโต้รอบใหม่ที่ "ขวางได้อย่างเดียว" ให้คนที่มีสิทธิ์ขวาง
 * (เดิม resolve ทันที ทำให้เป้าหมายขโมย/ลอบสังหารหมดสิทธิ์ขวาง)
 */
function openBlockWindow(room) {
    const state = room.gameState;
    const pending = state.pendingAction;
    const actor = pending ? getPlayer(room, pending.actorId) : null;
    if (!pending || !actor || !actor.alive) {
        advanceTurn(room);
        return state;
    }
    if (!getEligibleBlockers(room).length) return resolvePendingAction(room);

    pending.blockOnly = true;
    state.pendingBlock = null;
    state.responses = {};
    setPhase(room, 'respond', RESPOND_MS);
    return state;
}

function refundPendingAction(room) {
    const pending = room.gameState.pendingAction;
    if (pending?.coinsPaid) {
        // กติกา: แอ็กชันโดนท้าสำเร็จ = เหรียญที่จ่ายได้คืน · แต่ถ้าคนสั่งตกรอบไปแล้ว เหรียญกลับคลัง
        const actor = getPlayer(room, pending.actorId);
        if (actor && actor.alive) actor.coins += pending.coinsPaid;
        pending.coinsPaid = 0;
    }
}

// ---------- ลงมือทำแอ็กชันจริง ----------

function resolvePendingAction(room) {
    const state = room.gameState;
    const pending = state.pendingAction;
    if (!pending) {
        advanceTurn(room);
        return state;
    }

    const actor = getPlayer(room, pending.actorId);
    const target = pending.targetId ? getPlayer(room, pending.targetId) : null;
    const action = ACTIONS[pending.actionId];

    // คนสั่งตกรอบไปแล้วระหว่างทาง (เช่นแพ้ challenge) — แอ็กชันเป็นโมฆะ
    if (!actor || !actor.alive) {
        advanceTurn(room);
        return state;
    }

    switch (pending.actionId) {
        case 'income':
            actor.coins += 1;
            pushHistory(room, '🪙', `${actor.name} รับรายได้ 1 เหรียญ`);
            break;
        case 'foreign_aid':
            actor.coins += 2;
            pushHistory(room, '💶', `${actor.name} รับเงินช่วยเหลือ 2 เหรียญ`);
            break;
        case 'tax':
            actor.coins += 3;
            pushHistory(room, '👑', `${actor.name} เก็บภาษี 3 เหรียญ`);
            break;
        case 'steal': {
            if (target && target.alive) {
                const amount = Math.min(2, target.coins);
                target.coins -= amount;
                actor.coins += amount;
                pushHistory(room, '⚓', `${actor.name} ขโมย ${amount} เหรียญจาก ${target.name}`);
            }
            break;
        }
        case 'coup':
            pushHistory(room, '💥', `${actor.name} ทำรัฐประหารใส่ ${target?.name || '-'}`, 'coup');
            return requireInfluenceLoss(room, pending.targetId, 'coup', 'end-turn');
        case 'assassinate':
            pushHistory(room, '🗡️', `${actor.name} ลอบสังหาร ${target?.name || '-'}`, 'assassinate');
            return requireInfluenceLoss(room, pending.targetId, 'assassinate', 'end-turn');
        case 'exchange': {
            const drawn = [drawCard(room), drawCard(room)].filter(Boolean);
            // ย้ายการ์ดในมือเข้า options แล้วเคลียร์มือ — ไม่งั้นการ์ดถูกนับสองที่
            // (อยู่ทั้ง influence และ options) ทำให้ unaccountedCards คำนวณผิด
            // แล้วแจกใบซ้ำออกมาเมื่อกองใกล้หมด
            state.pendingExchange = {
                playerId: actor.playerId,
                options: [...actor.influence, ...drawn],
                keepCount: actor.influence.length
            };
            actor.influence = [];
            pushHistory(room, '🕊️', `${actor.name} แลกเปลี่ยนการ์ดกับกองกลาง`);
            setPhase(room, 'exchange', DECIDE_MS);
            return state;
        }
        default:
            break;
    }

    advanceTurn(room);
    return state;
}

// ---------- ผู้เล่นสั่งแอ็กชัน ----------

function submitAction(room, playerId, actionId, targetPlayerId = null) {
    const state = room.gameState;
    if (state.phase !== 'action') throw new Error('ยังไม่ถึงช่วงเลือกแอ็กชัน');
    if (state.currentPlayerId !== playerId) throw new Error('ยังไม่ถึงตาของคุณ');

    const actor = getPlayer(room, playerId);
    if (!actor || !actor.alive) throw new Error('คุณตกรอบไปแล้ว');

    const action = ACTIONS[actionId];
    if (!action) throw new Error('ไม่รู้จักแอ็กชันนี้');

    // มี 10 เหรียญขึ้นไปถูกบังคับให้ทำรัฐประหารเท่านั้น
    if (actor.coins >= FORCED_COUP_AT && actionId !== 'coup') {
        throw new Error(`มี ${actor.coins} เหรียญแล้ว ต้องทำรัฐประหารเท่านั้น`);
    }
    if (actor.coins < action.cost) throw new Error(`เหรียญไม่พอ (ต้องมี ${action.cost})`);

    let target = null;
    if (action.needsTarget) {
        target = getPlayer(room, targetPlayerId);
        if (!target || !target.alive) throw new Error('เลือกเป้าหมายไม่ถูกต้อง');
        if (target.playerId === playerId) throw new Error('เลือกตัวเองไม่ได้');
    }

    actor.coins -= action.cost;
    state.pendingAction = {
        actionId,
        actorId: playerId,
        targetId: target ? target.playerId : null,
        claim: action.claim,
        coinsPaid: action.cost
    };
    state.pendingBlock = null;
    state.responses = {};

    pushHistory(room, action.icon,
        `${actor.name} ประกาศ ${action.thaiLabel}${target ? ' ใส่ ' + target.name : ''}`);

    // แอ็กชันที่ challenge ไม่ได้และ block ไม่ได้ → ทำเลย
    if (!action.claim && action.blockedBy.length === 0) {
        return resolvePendingAction(room);
    }

    setPhase(room, 'respond', RESPOND_MS);
    return state;
}

/** ใครบ้างที่ยังต้องตอบในเฟส respond */
function getPendingResponders(room) {
    const state = room.gameState;
    const pending = state.pendingAction;
    if (!pending) return [];

    if (pending.blockOnly) {
        return getEligibleBlockers(room).filter(id => !state.responses[id]);
    }
    return getAlivePlayers(room)
        .filter(p => p.playerId !== pending.actorId)
        // foreign_aid ใครขวางก็ได้ ส่วนแอ็กชันมีเป้าหมาย เฉพาะเป้าหมายที่ block ได้
        // แต่ challenge ทำได้ทุกคน จึงให้ทุกคนที่ไม่ใช่ผู้สั่งต้องตอบ
        .filter(p => !state.responses[p.playerId])
        .map(p => p.playerId);
}

function everyoneResponded(room) {
    return getPendingResponders(room).length === 0;
}

/**
 * คำตอบที่ส่งมาตอนเฟสก่อนหน้า (เช่นกด "ท้า" แอ็กชัน แต่มาถึงหลังมีคนขวางแล้ว)
 * ต้องไม่ถูกเอาไปใช้กับเฟสใหม่ — client แนบ step/phase/turnNumber ที่เห็นตอนกดมาด้วย
 */
function assertResponseContext(state, context) {
    if (!context) return;
    const stale = new Error('สถานการณ์เปลี่ยนไปแล้ว — คำตอบนี้ไม่ถูกนับ ลองดูหน้าจออีกครั้ง');
    if (context.step !== undefined && context.step !== null && Number(context.step) !== Number(state.step)) throw stale;
    if (context.phase && context.phase !== state.phase) throw stale;
    if (context.turnNumber !== undefined && context.turnNumber !== null
        && Number(context.turnNumber) !== Number(state.turnNumber)) throw stale;
}

function submitResponse(room, playerId, response, claimCard = null, context = null) {
    const state = room.gameState;
    const pending = state.pendingAction;

    assertResponseContext(state, context);
    // ตอบไปแล้วในเฟสนี้ (เช่นปล่อยผ่าน) — จะกลับมาขวาง/ท้าทีหลังไม่ได้
    if ((state.phase === 'respond' || state.phase === 'block-respond') && state.responses?.[playerId]) {
        throw new Error('คุณตอบไปแล้วในรอบนี้');
    }

    if (state.phase === 'block-respond') return submitBlockResponse(room, playerId, response);
    if (state.phase !== 'respond') throw new Error('ตอนนี้ยังไม่ถึงช่วงตอบโต้');
    if (!pending) throw new Error('ไม่มีแอ็กชันให้ตอบโต้');
    if (playerId === pending.actorId) throw new Error('คนสั่งตอบโต้ตัวเองไม่ได้');

    const responder = getPlayer(room, playerId);
    if (!responder || !responder.alive) throw new Error('คุณตกรอบไปแล้ว');

    const action = ACTIONS[pending.actionId];

    if (response === 'pass') {
        state.responses[playerId] = 'pass';
        if (everyoneResponded(room)) return resolvePendingAction(room);
        return state;
    }

    if (pending.blockOnly && !getEligibleBlockers(room).includes(playerId)) {
        throw new Error('ตอนนี้เป็นช่วงให้เป้าหมายตัดสินใจขวางเท่านั้น');
    }

    if (response === 'challenge') {
        if (pending.blockOnly) throw new Error('แอ็กชันนี้ถูกท้าไปแล้ว — เหลือแค่ขวางหรือปล่อยผ่าน');
        if (!action.claim) throw new Error('แอ็กชันนี้ challenge ไม่ได้');
        return resolveChallenge(room, playerId, pending.actorId, action.claim, 'action');
    }

    if (response === 'block') {
        if (!action.blockedBy.length) throw new Error('แอ็กชันนี้ขวางไม่ได้');
        if (!action.blockedBy.includes(claimCard)) throw new Error('การ์ดนี้ขวางแอ็กชันนี้ไม่ได้');
        // แอ็กชันที่เจาะจงเป้าหมาย ให้เฉพาะเป้าหมายขวางได้
        if (pending.targetId && pending.targetId !== playerId) {
            throw new Error('ขวางแทนคนอื่นไม่ได้');
        }
        state.pendingBlock = { blockerId: playerId, claim: claimCard };
        state.responses = {};
        pushHistory(room, '🛡️',
            `${responder.name} ขวางด้วย ${CARD_DEFINITIONS[claimCard].thaiName}`, 'block');
        setPhase(room, 'block-respond', RESPOND_MS);
        return state;
    }

    throw new Error('คำสั่งตอบโต้ไม่ถูกต้อง');
}

/**
 * ตอบโต้ "การขวาง" — กติกาข้อ Challenges บอกว่า "ใครก็สามารถขอ Challenge ได้"
 * ทั้งกับแอ็กชันและ Counteraction จึงเปิดให้ทุกคนที่ยังไม่ตกรอบ (ยกเว้นคนขวางเอง)
 * ท้าได้ ไม่ใช่เฉพาะคนที่โดนขวาง
 * ถ้าทุกคนปล่อยผ่านหมด = การขวางสำเร็จ แอ็กชันเป็นโมฆะ
 */
function submitBlockResponse(room, playerId, response) {
    const state = room.gameState;
    const pending = state.pendingAction;
    const block = state.pendingBlock;
    if (!pending || !block) throw new Error('ไม่มีการขวางให้ตอบ');
    if (playerId === block.blockerId) throw new Error('คนขวางท้าตัวเองไม่ได้');

    const responder = getPlayer(room, playerId);
    if (!responder || !responder.alive) throw new Error('คุณตกรอบไปแล้ว');

    if (response === 'challenge') {
        return resolveChallenge(room, playerId, block.blockerId, block.claim, 'block');
    }

    if (response === 'pass') {
        state.responses[playerId] = 'pass';
        if (getPendingBlockResponders(room).length === 0) acceptBlock(room);
        return state;
    }

    throw new Error('คำสั่งไม่ถูกต้อง');
}

function acceptBlock(room) {
    const block = room.gameState.pendingBlock;
    const blocker = block ? getPlayer(room, block.blockerId) : null;
    pushHistory(room, '✋', `ไม่มีใครท้า — การขวางของ ${blocker?.name || '-'} สำเร็จ`);
    // โดนขวางสำเร็จ = แอ็กชันโมฆะ แต่เหรียญที่จ่ายไปแล้วไม่ได้คืน (ตามกติกา)
    advanceTurn(room);
}

/**
 * คนที่หลุดออฟไลน์ระหว่างช่วงท้า/ขวาง — ถือว่าปล่อยผ่านเลย ไม่ต้องรอครบ 20 วิ
 * (ผลเหมือนหมดเวลาทุกอย่าง แค่เร็วกว่า) · app เป็นคนตัดสินว่าใครออฟไลน์นานพอ
 * @returns true ถ้ามีการเปลี่ยน state
 */
function autoPassOffline(room, offlinePlayerIds) {
    const state = room?.gameState;
    if (!state || !Array.isArray(offlinePlayerIds) || !offlinePlayerIds.length) return false;
    const offline = new Set(offlinePlayerIds);

    let pending;
    if (state.phase === 'respond' && state.pendingAction) pending = getPendingResponders(room);
    else if (state.phase === 'block-respond' && state.pendingBlock) pending = getPendingBlockResponders(room);
    else return false;

    const toPass = pending.filter(id => offline.has(id));
    if (!toPass.length) return false;
    toPass.forEach(id => { state.responses[id] = 'pass'; });
    const names = toPass.map(id => getPlayer(room, id)?.name).filter(Boolean).join(', ');
    pushHistory(room, '📴', `${names} ออฟไลน์ — ถือว่าปล่อยผ่าน`);

    if (state.phase === 'respond') {
        if (everyoneResponded(room)) resolvePendingAction(room);
    } else if (getPendingBlockResponders(room).length === 0) {
        acceptBlock(room);
    }
    return true;
}

/** ใครยังต้องตอบในเฟส block-respond (ทุกคนที่ยังอยู่ ยกเว้นคนขวาง) */
function getPendingBlockResponders(room) {
    const state = room.gameState;
    const block = state.pendingBlock;
    if (!block) return [];
    return getAlivePlayers(room)
        .filter(p => p.playerId !== block.blockerId && !state.responses[p.playerId])
        .map(p => p.playerId);
}

/**
 * ตัดสิน Challenge
 * @param scope 'action' = ท้าคนสั่ง | 'block' = ท้าคนขวาง
 */
function resolveChallenge(room, challengerId, defenderId, claimCard, scope) {
    const state = room.gameState;
    const challenger = getPlayer(room, challengerId);
    const defender = getPlayer(room, defenderId);
    if (!challenger || !defender) throw new Error('ผู้เล่นไม่ถูกต้อง');

    const cardIndex = defender.influence.indexOf(claimCard);
    const defenderTellsTruth = cardIndex >= 0;
    const cardName = CARD_DEFINITIONS[claimCard].thaiName;

    if (defenderTellsTruth) {
        // มีจริง — คนท้าแพ้ ส่วนคนถูกท้าคืนการ์ดเข้ากองแล้วจั่วใหม่
        defender.influence.splice(cardIndex, 1);
        returnCardToDeck(room, claimCard);
        const replacement = drawCard(room);
        // กองไม่มีทางหมดจริงในเกมปกติ แต่ถ้าหมดก็ต้องไม่ยัด null เข้ามือ
        if (replacement) defender.influence.push(replacement);
        else defender.influence.push(claimCard);
        pushHistory(room, '✅',
            `${challenger.name} ท้า ${defender.name} แล้วแพ้ — ${defender.name} มี ${cardName} จริง`, 'challenge');

        // คนท้าเสียการ์ด แล้วเดินเรื่องต่อตามผลของ challenge
        // คนสั่งพูดจริง → แอ็กชันเดินต่อ แต่ถ้าแอ็กชันขวางได้ ต้องเปิดโอกาสให้ขวางก่อน
        const actionBlockable = ACTIONS[state.pendingAction?.actionId]?.blockedBy?.length > 0;
        const resumeAfter = scope === 'action'
            ? (actionBlockable ? 'block-window' : 'resolve-action')
            : 'end-turn';        // คนขวางพูดจริง → แอ็กชันถูกขวางสำเร็จ จบตา
        return requireInfluenceLoss(room, challengerId, 'challenge-lost', resumeAfter);
    }

    // ไม่มีจริง — คนถูกท้าแพ้
    pushHistory(room, '❌',
        `${challenger.name} ท้า ${defender.name} แล้วชนะ — ไม่มี ${cardName} จริง`, 'challenge');

    if (scope === 'action') {
        // คนสั่งโกหก → แอ็กชันเป็นโมฆะ คืนเหรียญ
        return requireInfluenceLoss(room, defenderId, 'bluff-caught', 'cancel-action');
    }

    // คนขวางโกหก → การขวางเป็นโมฆะ แอ็กชันเดินต่อ
    state.pendingBlock = null;
    return requireInfluenceLoss(room, defenderId, 'bluff-caught', 'resolve-action');
}

/** เลือกการ์ดที่จะหงายตอนเสีย influence */
function submitInfluenceLoss(room, playerId, cardId) {
    const state = room.gameState;
    const pendingLoss = state.pendingLoss;
    if (state.phase !== 'lose-influence' || !pendingLoss) throw new Error('ตอนนี้ยังไม่ต้องหงายการ์ด');
    if (pendingLoss.playerId !== playerId) throw new Error('ยังไม่ถึงตาคุณหงายการ์ด');

    const player = getPlayer(room, playerId);
    const index = player.influence.indexOf(cardId);
    if (index < 0) throw new Error('คุณไม่มีการ์ดใบนี้');

    player.influence.splice(index, 1);
    player.revealed.push(cardId);
    if (!player.influence.length) eliminate(player);

    pushHistory(room, '🃏',
        `${player.name} หงาย ${CARD_DEFINITIONS[cardId].thaiName}${player.alive ? '' : ' — ตกรอบแล้ว'}`);

    return finishLoss(room, pendingLoss.resumeAfter);
}

/** Ambassador เลือกการ์ดที่จะเก็บ */
function submitExchange(room, playerId, keepCardIds) {
    const state = room.gameState;
    const pending = state.pendingExchange;
    if (state.phase !== 'exchange' || !pending) throw new Error('ตอนนี้ไม่ใช่ช่วงแลกเปลี่ยน');
    if (pending.playerId !== playerId) throw new Error('ไม่ใช่ตาแลกเปลี่ยนของคุณ');

    const keep = Array.isArray(keepCardIds) ? [...keepCardIds] : [];
    if (keep.length !== pending.keepCount) {
        throw new Error(`ต้องเลือกเก็บ ${pending.keepCount} ใบ`);
    }

    // ตรวจว่าเลือกจากตัวเลือกที่มีจริง (กันส่งการ์ดมั่ว)
    const pool = [...pending.options];
    keep.forEach(cardId => {
        const index = pool.indexOf(cardId);
        if (index < 0) throw new Error('เลือกการ์ดที่ไม่มีในตัวเลือก');
        pool.splice(index, 1);
    });

    const player = getPlayer(room, playerId);
    if (!player) throw new Error('ไม่พบผู้เล่น');
    player.influence = keep;
    pool.forEach(cardId => returnCardToDeck(room, cardId));

    state.pendingExchange = null;
    pushHistory(room, '🔄', `${player.name} แลกเปลี่ยนการ์ดเสร็จแล้ว`);
    advanceTurn(room);
    return state;
}

/** หมดเวลาในเฟสไหนก็ตาม — ตัดสินใจแทนให้เกมเดินต่อ */
function autoResolvePhase(room) {
    const state = room.gameState;
    if (!state || state.phase === 'finished' || state.phase === 'lobby') return state;
    if (state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;

    switch (state.phase) {
        case 'action': {
            const actor = getPlayer(room, state.currentPlayerId);
            if (!actor || !actor.alive) { advanceTurn(room); return state; }
            const forcedCoup = actor.coins >= FORCED_COUP_AT;
            const coupTarget = forcedCoup
                ? getAlivePlayers(room).find(p => p.playerId !== actor.playerId)
                : null;
            pushHistory(room, '⏰', forcedCoup
                ? `${actor.name} หมดเวลา — มี ${actor.coins} เหรียญ จึงทำรัฐประหารใส่ ${coupTarget?.name || '-'} อัตโนมัติ`
                : `${actor.name} หมดเวลา — รับรายได้อัตโนมัติ`);
            try {
                return submitAction(room, state.currentPlayerId,
                    forcedCoup ? 'coup' : 'income',
                    coupTarget ? coupTarget.playerId : null);
            } catch (error) {
                advanceTurn(room);
                return state;
            }
        }
        case 'respond':
            pushHistory(room, '⏰', 'หมดเวลาตอบโต้ — ถือว่าทุกคนปล่อยผ่าน');
            return resolvePendingAction(room);
        case 'block-respond':
            pushHistory(room, '⏰', 'หมดเวลา — ยอมรับการขวาง');
            advanceTurn(room);
            return state;
        case 'lose-influence': {
            const player = getPlayer(room, state.pendingLoss?.playerId);
            if (player?.influence?.length) {
                return submitInfluenceLoss(room, player.playerId, player.influence[0]);
            }
            return finishLoss(room, state.pendingLoss?.resumeAfter);
        }
        case 'exchange': {
            const pending = state.pendingExchange;
            if (pending && getPlayer(room, pending.playerId)) {
                return submitExchange(room, pending.playerId, pending.options.slice(0, pending.keepCount));
            }
            if (pending) pending.options.forEach(cardId => returnCardToDeck(room, cardId));
            state.pendingExchange = null;
            advanceTurn(room);
            return state;
        }
        default:
            return state;
    }
}

/**
 * roomManager.leaveRoom ตัดผู้เล่นออกจาก gameState.players ก่อนเรียกเรา — ตามหาไม่เจอแล้ว
 * เดิม return เฉยๆ เกมเลยค้างรอคนที่ออกไปแล้วจนหมดเวลา (ถ้าค้างตอนแลกการ์ด timer พังทั้งห้อง)
 * ตอนนี้ปลดทุกอย่างที่รอคนนั้นอยู่ แล้วเดินเกมต่อ
 */
function handleRemovedPlayer(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase === 'finished' || state.phase === 'lobby') return state;
    const snapshot = room.rejoinableGamePlayers instanceof Map ? room.rejoinableGamePlayers.get(playerId) : null;
    const involved = state.currentPlayerId === playerId
        || state.pendingAction?.actorId === playerId
        || state.pendingAction?.targetId === playerId
        || state.pendingBlock?.blockerId === playerId
        || state.pendingLoss?.playerId === playerId
        || state.pendingExchange?.playerId === playerId
        || (state.seatOrder || []).includes(playerId);
    if (!involved) return state;
    // ออก = ยอมแพ้ (เหมือนกรณีที่ยังหาเจอ) — ถ้ากลับเข้าห้องมาด้วย snapshot นี้ จะเป็นคนที่ตกรอบแล้ว
    if (snapshot && snapshot.alive !== false) {
        snapshot.revealed = [...(snapshot.revealed || []), ...(snapshot.influence || [])];
        snapshot.influence = [];
        eliminate(snapshot);
    }
    pushHistory(room, '🚪', `${snapshot?.name || 'ผู้เล่น'} ออกจากเกม`);

    if (checkWinner(room)) return state;
    if (state.pendingLoss?.playerId === playerId) return finishLoss(room, state.pendingLoss.resumeAfter);
    if (state.phase === 'lose-influence' && state.pendingLoss) return state;
    if (state.pendingExchange?.playerId === playerId) {
        // การ์ดในมือเขาอยู่ใน options หมดแล้ว — คนออกไปแล้ว คืนกองทั้งหมด
        state.pendingExchange.options.forEach(cardId => returnCardToDeck(room, cardId));
        state.pendingExchange = null;
        advanceTurn(room);
        return state;
    }
    if (state.pendingAction?.actorId === playerId || state.currentPlayerId === playerId) { advanceTurn(room); return state; }
    if (state.phase === 'block-respond' && state.pendingBlock?.blockerId === playerId) {
        // คนขวางออกไปแล้ว การขวางเป็นโมฆะ แอ็กชันเดินต่อ
        state.pendingBlock = null;
        return resolvePendingAction(room);
    }
    if (state.phase === 'block-respond' && getPendingBlockResponders(room).length === 0) { acceptBlock(room); return state; }
    if (state.phase === 'respond' && everyoneResponded(room)) return resolvePendingAction(room);
    return state;
}

function handlePlayerLeft(room, playerId) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    if (!player) return handleRemovedPlayer(room, playerId);
    if (!player.alive) return state;

    player.revealed.push(...player.influence);
    player.influence = [];
    eliminate(player);
    pushHistory(room, '🚪', `${player.name} ออกจากเกม`);

    if (checkWinner(room)) return state;

    // ถ้าคนออกกำลังค้างคิวอยู่ ต้องปลดล็อกเกมให้เดินต่อ
    if (state.pendingLoss?.playerId === playerId) return finishLoss(room, state.pendingLoss.resumeAfter);
    // คนอื่นยังติดหนี้ต้องหงายการ์ดอยู่ (เช่นโดนรัฐประหาร/ลอบสังหารที่จ่ายเงินไปแล้ว)
    // ห้าม advanceTurn ล้าง pendingLoss ทิ้ง — ปล่อยให้ finishLoss เดินเรื่องต่อเอง
    if (state.phase === 'lose-influence' && state.pendingLoss) return state;
    if (state.pendingExchange?.playerId === playerId) {
        // การ์ดของเขาอยู่ใน options ทั้งหมด — หงายเท่าที่เคยถือ ที่เหลือคืนกอง
        const { options, keepCount } = state.pendingExchange;
        options.slice(0, keepCount).forEach(cardId => player.revealed.push(cardId));
        options.slice(keepCount).forEach(cardId => returnCardToDeck(room, cardId));
        state.pendingExchange = null;
        advanceTurn(room);
        return state;
    }
    if (state.pendingAction?.actorId === playerId) { advanceTurn(room); return state; }
    if (state.currentPlayerId === playerId) { advanceTurn(room); return state; }
    if (state.phase === 'respond' && everyoneResponded(room)) return resolvePendingAction(room);
    return state;
}

/** แอ็กชันที่ผู้เล่นคนนี้กดได้ตอนนี้ (ให้ UI ใช้ตรงๆ) */
function getAvailableActions(room, playerId) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    if (!player || !player.alive || state.phase !== 'action' || state.currentPlayerId !== playerId) {
        return [];
    }

    return Object.values(ACTIONS)
        .filter(action => {
            if (player.coins >= FORCED_COUP_AT) return action.id === 'coup';
            return player.coins >= action.cost;
        })
        .map(action => ({
            id: action.id,
            label: action.label,
            thaiLabel: action.thaiLabel,
            icon: action.icon,
            detail: action.detail,
            cost: action.cost,
            claim: action.claim,
            claimCard: action.claim ? CARD_DEFINITIONS[action.claim] : null,
            needsTarget: action.needsTarget
        }));
}

/**
 * เมนูแอ็กชันครบทุกปุ่ม พร้อมเหตุผลว่าทำไมกดไม่ได้ (เหรียญไม่พอ / ต้องรัฐประหาร)
 * availableActions ซ่อนปุ่มที่กดไม่ได้ไปเลย คนเล่นครั้งแรกเลยไม่รู้ว่ามีลอบสังหาร/รัฐประหาร
 */
function getActionMenu(room, playerId) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    if (!player || !player.alive || state.phase !== 'action' || state.currentPlayerId !== playerId) {
        return [];
    }
    const mustCoup = player.coins >= FORCED_COUP_AT;
    return Object.values(ACTIONS).map(action => {
        let reason = '';
        if (mustCoup && action.id !== 'coup') {
            reason = `มี ${player.coins} เหรียญ (ครบ ${FORCED_COUP_AT}) ต้องรัฐประหารเท่านั้น`;
        } else if (player.coins < action.cost) {
            reason = `ต้องมี ${action.cost} เหรียญ · ขาดอีก ${action.cost - player.coins}`;
        }
        return {
            id: action.id,
            thaiLabel: action.thaiLabel,
            icon: action.icon,
            detail: action.detail,
            cost: action.cost,
            claimCard: action.claim ? CARD_DEFINITIONS[action.claim] : null,
            needsTarget: action.needsTarget,
            enabled: !reason,
            reason
        };
    });
}

function getAvailableResponses(room, playerId) {
    const state = room.gameState;
    const pending = state.pendingAction;
    const viewer = getPlayer(room, playerId);
    if (!pending || !viewer || !viewer.alive) return null;

    if (state.phase === 'respond') {
        if (playerId === pending.actorId || state.responses[playerId]) return null;
        const action = ACTIONS[pending.actionId];
        const canBlock = action.blockedBy.length > 0
            && (!pending.targetId || pending.targetId === playerId);
        if (pending.blockOnly && !canBlock) return null;
        return {
            canPass: true,
            canChallenge: !!action.claim && !pending.blockOnly,
            blockOnly: !!pending.blockOnly,
            blockOptions: canBlock
                ? action.blockedBy.map(id => ({ id, thaiName: CARD_DEFINITIONS[id].thaiName, icon: CARD_DEFINITIONS[id].icon }))
                : []
        };
    }

    // กติกา: ใครก็ท้า Counteraction ได้ ไม่ใช่แค่คนที่โดนขวาง
    if (state.phase === 'block-respond' && state.pendingBlock) {
        if (playerId === state.pendingBlock.blockerId || state.responses[playerId]) return null;
        return { canPass: true, canChallenge: true, blockOptions: [], challengingBlock: true };
    }

    return null;
}

function buildClientState(room, viewerPlayerId) {
    const state = room.gameState;
    const viewer = getPlayer(room, viewerPlayerId);
    const isFinished = state.phase === 'finished';

    return {
        mode: 'coup',
        roomId: room.roomId,
        roomName: room.name,
        phase: state.phase,
        status: state.status,
        turnNumber: state.turnNumber,
        step: Number(state.step) || 0,
        currentPlayerId: state.currentPlayerId,
        isMyTurn: state.currentPlayerId === viewerPlayerId,
        phaseEndsAt: state.phaseEndsAt,
        // เวลาเครื่องมือถือกับ server ไม่ตรงกันบ่อย — client ใช้ค่านี้ชดเชยนาฬิกานับถอยหลัง
        serverNow: Date.now(),
        deckCount: state.deck.length,
        winner: state.winner,
        history: state.history || [],
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,

        // ข้อมูลของตัวเองเท่านั้นที่เห็นการ์ดคว่ำ
        self: viewer ? {
            playerId: viewer.playerId,
            coins: viewer.coins,
            alive: viewer.alive,
            influence: viewer.influence.map(id => CARD_DEFINITIONS[id]),
            revealed: viewer.revealed.map(id => CARD_DEFINITIONS[id]),
            mustCoup: viewer.coins >= FORCED_COUP_AT
        } : null,

        players: state.players.map(player => ({
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
            coins: player.coins,
            alive: player.alive,
            // ระหว่างแลกการ์ด การ์ดในมือถูกย้ายไปกองตัวเลือกชั่วคราว — นับเท่าที่จะได้เก็บคืน
            // ไม่งั้นคนอื่นเห็นทูตเหลือ 0 ใบเหมือนตกรอบไปแล้ว
            influenceCount: state.pendingExchange?.playerId === player.playerId
                ? state.pendingExchange.keepCount
                : player.influence.length,
            // จบเกมแล้วเปิดการ์ดที่เหลือของทุกคน ให้ดูย้อนได้ว่าใครถืออะไร/ใครโกหก
            finalHand: isFinished ? player.influence.map(id => CARD_DEFINITIONS[id]) : null,
            // การ์ดที่หงายแล้วทุกคนเห็นได้ ส่วนคว่ำอยู่เห็นแค่จำนวน
            revealed: player.revealed.map(id => CARD_DEFINITIONS[id]),
            isSelf: player.playerId === viewerPlayerId,
            isCurrent: player.playerId === state.currentPlayerId
        })),

        pendingAction: state.pendingAction ? {
            ...state.pendingAction,
            action: ACTIONS[state.pendingAction.actionId],
            claimCard: state.pendingAction.claim ? CARD_DEFINITIONS[state.pendingAction.claim] : null,
            actorName: getPlayer(room, state.pendingAction.actorId)?.name || '',
            targetName: state.pendingAction.targetId ? getPlayer(room, state.pendingAction.targetId)?.name : null,
            waitingFor: getPendingResponders(room)
        } : null,

        pendingBlock: state.pendingBlock ? {
            ...state.pendingBlock,
            blockerName: getPlayer(room, state.pendingBlock.blockerId)?.name || '',
            card: CARD_DEFINITIONS[state.pendingBlock.claim],
            waitingFor: getPendingBlockResponders(room)
        } : null,

        pendingLoss: state.pendingLoss ? {
            playerId: state.pendingLoss.playerId,
            playerName: getPlayer(room, state.pendingLoss.playerId)?.name || '',
            isMe: state.pendingLoss.playerId === viewerPlayerId,
            reason: state.pendingLoss.reason
        } : null,

        pendingExchange: (state.pendingExchange && state.pendingExchange.playerId === viewerPlayerId) ? {
            keepCount: state.pendingExchange.keepCount,
            options: state.pendingExchange.options.map(id => CARD_DEFINITIONS[id])
        } : (state.pendingExchange ? { waitingFor: getPlayer(room, state.pendingExchange.playerId)?.name } : null),

        availableActions: getAvailableActions(room, viewerPlayerId),
        actionMenu: getActionMenu(room, viewerPlayerId),
        availableResponses: getAvailableResponses(room, viewerPlayerId),
        cardCatalog: isFinished || true ? Object.values(CARD_DEFINITIONS) : []
    };
}

module.exports = {
    id: 'coup',
    label: 'Coup',
    description: 'เกมโค่นอำนาจ — โกหกได้ ท้าได้ ใครรอดคนสุดท้ายชนะ',
    minPlayers: 2,
    maxPlayers: 6,
    CARD_DEFINITIONS,
    ACTIONS,
    FORCED_COUP_AT,
    ACTION_SECONDS_OPTIONS,
    DEFAULT_ACTION_SECONDS,
    TWO_PLAYER_STARTER_COINS,
    sanitizeActionSeconds,
    autoPassOffline,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    submitAction,
    submitResponse,
    submitInfluenceLoss,
    submitExchange,
    autoResolvePhase,
    handlePlayerLeft,
    getAvailableActions,
    getActionMenu,
    buildClientState
};
