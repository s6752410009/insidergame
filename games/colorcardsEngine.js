/**
 * ไพ่ทิ้งสี — เกมไพ่สีแบบทิ้งให้หมดมือ 2–10 คน (ใส่บอทได้)
 *
 * กอง 108 ใบ: 4 สี (แดง เหลือง เขียว น้ำเงิน) สีละ 0 หนึ่งใบ, 1–9 อย่างละ 2,
 * ข้าม/กลับทิศ/+2 อย่างละ 2 · เปลี่ยนสี 4 · +4 อีก 4
 *
 * ตาหนึ่ง: ลงไพ่ที่สีตรงหรือเลข/สัญลักษณ์ตรง หรือไพ่เปลี่ยนสี/+4 ก็ได้
 *   ไม่ลง = จั่ว 1 ใบ ถ้าใบที่จั่วลงได้ ลงทันทีได้ ไม่งั้นผ่าน
 * เหลือ 1 ใบต้องกด "เหลือใบเดียว!" ไม่งั้นคนอื่นกด "จับได้!" ภายในเวลาสั้น ๆ → จั่ว 2
 * หมดมือก่อนชนะรอบ ได้แต้ม = ผลรวมไพ่ในมือคนอื่น (เลข = ตามหน้า, ข้าม/กลับทิศ/+2 = 20, เปลี่ยนสี/+4 = 50)
 *
 * engine ล้วน: ไม่มี socket/IO · ทุกฟังก์ชันที่สุ่มรับ rng ได้ (ค่าเริ่ม Math.random)
 * ไพ่ในมืออยู่ที่ state.seats[].hand เท่านั้น — buildClientState ส่งให้เจ้าของมือคนเดียว
 * state.players ใช้แค่ทำบัญชีของ roomManager (ไม่มีไพ่) เพราะ roomManager ตัด/เติมเองตอนคนเข้าออก
 */

const MODE = 'colorcards';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const HAND_SIZE = 7;

const TURN_CHOICES = [15, 20, 30];
const TARGET_CHOICES = [0, 300, 500];
const DEFAULT_TURN_SECONDS = 20;

const ENV_TURN_MS = Number(process.env.COLORCARDS_TURN_MS) || 0; // ใช้ในเทสเท่านั้น
const OFFLINE_TURN_MS = Number(process.env.COLORCARDS_OFFLINE_TURN_MS) || 6000;
const OFFLINE_GRACE_MS = 8000;
const DRAWN_MIN_MS = Number(process.env.COLORCARDS_DRAWN_MIN_MS) || 7000;
const ROUND_END_MS = Number(process.env.COLORCARDS_ROUND_END_MS) || 12000;
const CATCH_MS = Number(process.env.COLORCARDS_CATCH_MS) || 4000;
const BOT_TURN_MS = Number(process.env.COLORCARDS_BOT_MS) || 1100;
const IDLE_TURNS = 2; // หมดเวลาติดกันกี่ตา ถึงนับว่าไม่อยู่ (ตาถัดไปสั้นลงเหมือนคนหลุด)

const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAME = { r: 'แดง', y: 'เหลือง', g: 'เขียว', b: 'น้ำเงิน' };
const KIND_NAME = { num: '', skip: 'ข้าม', rev: 'กลับทิศ', d2: '+2', wild: 'เปลี่ยนสี', d4: '+4' };
const ACTION_KINDS = new Set(['skip', 'rev', 'd2']);
const WILD_KINDS = new Set(['wild', 'd4']);

// ---------- ไพ่ ----------

function buildCatalog() {
    const cards = [];
    const push = (color, kind, value = null) => {
        cards.push({ id: 'k' + String(cards.length).padStart(3, '0'), color, kind, value });
    };
    COLORS.forEach(color => {
        push(color, 'num', 0);
        for (let n = 1; n <= 9; n += 1) {
            push(color, 'num', n);
            push(color, 'num', n);
        }
        ['skip', 'rev', 'd2'].forEach(kind => {
            push(color, kind);
            push(color, kind);
        });
    });
    for (let i = 0; i < 4; i += 1) push(null, 'wild');
    for (let i = 0; i < 4; i += 1) push(null, 'd4');
    return cards;
}

const CATALOG = Object.freeze(buildCatalog().map(card => Object.freeze(card)));
const CARD_BY_ID = new Map(CATALOG.map(card => [card.id, card]));

function getCard(cardId) {
    return CARD_BY_ID.get(cardId) || null;
}

function cardPoints(cardId) {
    const card = getCard(cardId);
    if (!card) return 0;
    if (card.kind === 'num') return card.value;
    if (WILD_KINDS.has(card.kind)) return 50;
    return 20;
}

function cardLabel(card) {
    if (!card) return '';
    if (card.kind === 'num') return `${COLOR_NAME[card.color]} ${card.value}`;
    if (WILD_KINDS.has(card.kind)) return KIND_NAME[card.kind];
    return `${COLOR_NAME[card.color]} ${KIND_NAME[card.kind]}`;
}

/** ข้อมูลไพ่ที่ client ใช้วาด — ส่งเฉพาะไพ่ที่ผู้ชมมีสิทธิ์เห็น */
function describeCard(cardId) {
    const card = getCard(cardId);
    if (!card) return null;
    return {
        id: card.id,
        color: card.color,
        kind: card.kind,
        value: card.value,
        points: cardPoints(card.id),
        label: cardLabel(card)
    };
}

function shuffle(items, rng = Math.random) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function buildDeck(rng = Math.random) {
    return shuffle(CATALOG.map(card => card.id), rng);
}

// ---------- state ----------

function createInitialState() {
    return {
        mode: MODE,
        status: 'waiting',
        phase: 'lobby',
        players: [],
        seats: [],
        config: null,
        round: 0,
        dealerIndex: -1,
        direction: 1,
        drawPile: [],
        discard: [],
        currentColor: null,
        turn: null,
        turnSeq: 0,
        pendingDraw: 0,
        pendingKind: null,
        catchWindow: null,
        roundResult: null,
        standings: null,
        winner: null,
        finishReason: null,
        history: [],
        phaseEndsAt: null,
        statsRecordedAt: null,
        step: 0,
        fxSeq: 0,
        fx: []
    };
}

/** roomManager ใช้ตอนคนเข้าห้อง — แค่ข้อมูลโปรไฟล์ ไม่มีไพ่ */
function createPlayerState(player) {
    return {
        playerId: player.playerId,
        name: player.playerName || player.name || 'ผู้เล่น',
        color: player.color || '#f5c86b',
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none'
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: (room.players || []).map(createPlayerState)
    };
}

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function roomEntry(room, playerId) {
    return (room.players || []).find(p => p.playerId === playerId) || null;
}

function isConnected(room, seat) {
    if (!seat || seat.left) return false;
    const entry = roomEntry(room, seat.playerId);
    if (!entry) return false;
    return isBotId(seat.playerId) || !!entry.socketId;
}

/** หลุดนานแล้วจริง ๆ (ไม่ใช่แค่กำลังเปลี่ยนหน้า/รีเฟรช) — ตาของคนนี้ใช้เวลาสั้นลง */
function isLongOffline(room, seat, now = Date.now()) {
    if (!seat || isBotId(seat.playerId)) return false;
    const entry = roomEntry(room, seat.playerId);
    if (!entry) return true;
    if (entry.socketId) return false;
    const since = Date.parse(entry.disconnectedAt || '') || 0;
    return !since || now - since > OFFLINE_GRACE_MS;
}

function normalizeConfig(settings = {}) {
    const turnSeconds = TURN_CHOICES.includes(Number(settings.colorcardsTurnSeconds))
        ? Number(settings.colorcardsTurnSeconds)
        : DEFAULT_TURN_SECONDS;
    const target = TARGET_CHOICES.includes(Number(settings.colorcardsTarget)) ? Number(settings.colorcardsTarget) : 0;
    return {
        turnSeconds,
        turnMs: ENV_TURN_MS || turnSeconds * 1000,
        target,
        stacking: settings.colorcardsStacking === true
    };
}

function getSeat(room, playerId) {
    return (room.gameState.seats || []).find(seat => seat.playerId === playerId) || null;
}

function seatIndex(room, playerId) {
    return (room.gameState.seats || []).findIndex(seat => seat.playerId === playerId);
}

function activeSeats(room) {
    return (room.gameState.seats || []).filter(seat => !seat.left);
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, at: Date.now(), ...event }].slice(-24);
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

function topCardId(state) {
    return state.discard.length ? state.discard[state.discard.length - 1] : null;
}

// ---------- กองจั่ว ----------

/** fx เก่าอ้างไพ่ที่กลับเข้ากองจั่วแล้ว (สับกอง/รอบใหม่) — ตัดออก ไม่ให้ id ของไพ่ในกองหรือในมือคนอื่นค้างใน payload */
function stripFxCards(state) {
    state.fx = (state.fx || []).map(event => {
        const { card, top, ...rest } = event;
        return rest;
    });
}

function reshuffleDiscard(room, rng) {
    const state = room.gameState;
    if (state.discard.length <= 1) return false;
    const top = state.discard.pop();
    state.drawPile = shuffle(state.discard, rng).concat(state.drawPile);
    state.discard = [top];
    stripFxCards(state);
    pushHistory(room, '🔀', 'กองจั่วหมด — สับกองทิ้งกลับมาเป็นกองจั่ว', 'reshuffle');
    pushFx(room, { kind: 'reshuffle' });
    return true;
}

/** จั่วจากบนกอง (ท้าย array) · หมดกองสับกองทิ้งใหม่ (เว้นใบบนสุด) · คืนรายการ id ที่ได้จริง */
function drawCards(room, seat, count, rng) {
    const state = room.gameState;
    const got = [];
    for (let i = 0; i < count; i += 1) {
        if (!state.drawPile.length && !reshuffleDiscard(room, rng)) break;
        const cardId = state.drawPile.pop();
        if (!cardId) break;
        seat.hand.push(cardId);
        got.push(cardId);
    }
    if (seat.hand.length > 1) seat.called = false;
    if (state.catchWindow && state.catchWindow.playerId === seat.playerId && seat.hand.length !== 1) {
        state.catchWindow = null;
    }
    return got;
}

// ---------- ลำดับตา ----------

function nextActiveIndex(room, fromIndex, direction = room.gameState.direction) {
    const seats = room.gameState.seats;
    const n = seats.length;
    if (!n) return -1;
    for (let j = 1; j <= n; j += 1) {
        const k = (((fromIndex + direction * j) % n) + n) % n;
        if (!seats[k].left) return k;
    }
    return -1;
}

function setTurn(room, index) {
    const state = room.gameState;
    const seat = state.seats[index];
    if (!seat) return;
    const now = Date.now();
    const away = isLongOffline(room, seat, now) || (Number(seat.idle) || 0) >= IDLE_TURNS;
    state.turnSeq = (Number(state.turnSeq) || 0) + 1;
    state.turn = { playerId: seat.playerId, drawnCardId: null, startedAt: now, seq: state.turnSeq };
    state.phaseEndsAt = now + (away ? Math.min(OFFLINE_TURN_MS, state.config.turnMs) : state.config.turnMs);
    bumpStep(room);
}

/** เดินตาต่อจากคนปัจจุบัน steps ที่นั่ง (ข้ามคนที่ออกแล้ว) */
function advance(room, steps = 1) {
    const state = room.gameState;
    let index = seatIndex(room, state.turn?.playerId);
    if (index < 0) index = Math.max(0, state.dealerIndex);
    for (let i = 0; i < steps; i += 1) {
        const next = nextActiveIndex(room, index);
        if (next < 0) break;
        index = next;
    }
    setTurn(room, index);
}

// ---------- เริ่มเกม / รอบ ----------

/** options.deck (เทสเท่านั้น): กำหนดกองไพ่รอบแรกเอง — ท้าย array = บนกอง */
function startGame(room, rng = Math.random, options = {}) {
    const roster = (room.players || []).filter(p => p.socketId || isBotId(p.playerId));
    if (roster.length < MIN_PLAYERS || roster.length > MAX_PLAYERS) {
        throw new Error(`ไพ่ทิ้งสีเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน`);
    }
    const state = resetRoomGame(room);
    state.status = 'playing';
    state.config = normalizeConfig(room.settings || {});
    state.seats = roster.map(p => ({
        playerId: p.playerId,
        name: p.playerName || p.name || 'ผู้เล่น',
        color: p.color || '#f5c86b',
        avatar: p.avatar || '👤',
        avatarFrame: p.avatarFrame || 'none',
        hand: [],
        score: 0,
        roundsWon: 0,
        called: false,
        left: false,
        idle: 0
    }));
    state.dealerIndex = Math.floor(rng() * state.seats.length);
    room.gameState = state;
    const goal = state.config.target ? `เก็บให้ถึง ${state.config.target} แต้ม` : 'เล่น 1 รอบ';
    pushHistory(room, '🃏', `เริ่มไพ่ทิ้งสี — ${goal}${state.config.stacking ? ' · ซ้อน +2/+4 ได้' : ''}`);
    startRound(room, rng, options.deck);
    return room.gameState;
}

function startRound(room, rng = Math.random, presetDeck = null) {
    const state = room.gameState;
    const seats = state.seats;
    if (activeSeats(room).length < 2) return finishGame(room, null, 'ผู้เล่นไม่พอ — จบเกม');

    state.round += 1;
    state.phase = 'turn';
    state.direction = 1;
    state.pendingDraw = 0;
    state.pendingKind = null;
    state.catchWindow = null;
    state.roundResult = null;
    state.roundReady = [];
    state.currentColor = null;
    state.discard = [];
    stripFxCards(state);
    state.drawPile = Array.isArray(presetDeck) ? presetDeck.slice() : buildDeck(rng);
    seats.forEach(seat => { seat.hand = []; seat.called = false; });

    // คนแจกวนทีละที่นั่งทุกรอบ (รอบแรกสุ่มไว้ตอนเริ่มเกม)
    if (state.round > 1 || !seats[state.dealerIndex] || seats[state.dealerIndex].left) {
        state.dealerIndex = nextActiveIndex(room, Math.max(0, state.dealerIndex), 1);
    }
    const dealer = state.dealerIndex;

    // แจกทีละใบวนจากคนถัดจากคนแจก
    let idx = dealer;
    for (let c = 0; c < HAND_SIZE; c += 1) {
        for (let s = 0; s < activeSeats(room).length; s += 1) {
            idx = nextActiveIndex(room, idx, 1);
            seats[idx].hand.push(state.drawPile.pop());
        }
    }

    // เปิดใบแรก: +4 สับกลับเข้ากองแล้วเปิดใหม่
    let first = state.drawPile.pop();
    let guard = 0;
    while (getCard(first).kind === 'd4' && guard < 50) {
        state.drawPile.push(first);
        state.drawPile = shuffle(state.drawPile, rng);
        first = state.drawPile.pop();
        guard += 1;
    }
    state.discard.push(first);
    const card = getCard(first);
    state.currentColor = card.color;

    pushHistory(room, '🎴', `รอบที่ ${state.round} — แจกคนละ ${HAND_SIZE} ใบ ใบแรก ${cardLabel(card)}`, 'round');
    pushFx(room, { kind: 'deal', round: state.round, top: describeCard(first), dealerId: seats[dealer].playerId });

    const firstIdx = nextActiveIndex(room, dealer, 1);
    const firstSeat = seats[firstIdx];
    state.turn = { playerId: seats[dealer].playerId, drawnCardId: null, startedAt: Date.now(), seq: state.turnSeq };
    if (card.kind === 'skip') {
        pushHistory(room, '⛔', `ใบแรกเป็นข้าม — ${firstSeat.name} โดนข้าม`);
        pushFx(room, { kind: 'skip', playerId: firstSeat.playerId });
        state.turn.playerId = firstSeat.playerId;
        advance(room, 1);
    } else if (card.kind === 'rev') {
        if (activeSeats(room).length > 2) {
            state.direction = -1;
            pushFx(room, { kind: 'reverse', direction: -1 });
            pushHistory(room, '🔁', `ใบแรกเป็นกลับทิศ — ${seats[dealer].name} (คนแจก) เริ่มก่อน แล้ววนทางซ้าย`);
        } else {
            pushFx(room, { kind: 'skip', playerId: firstSeat.playerId });
            pushHistory(room, '🔁', `ใบแรกเป็นกลับทิศ (2 คน = ข้าม) — ${seats[dealer].name} เริ่มก่อน`);
        }
        setTurn(room, dealer);
    } else if (card.kind === 'd2') {
        drawCards(room, firstSeat, 2, rng);
        pushHistory(room, '➕', `ใบแรกเป็น +2 — ${firstSeat.name} จั่ว 2 แล้วโดนข้าม`);
        pushFx(room, { kind: 'penalty', playerId: firstSeat.playerId, count: 2, reason: 'd2' });
        state.turn.playerId = firstSeat.playerId;
        advance(room, 1);
    } else {
        if (card.kind === 'wild') {
            pushHistory(room, '🌈', `ใบแรกเป็นเปลี่ยนสี — ${firstSeat.name} ลงสีไหนก็ได้`);
        }
        setTurn(room, firstIdx);
    }
    return state;
}

// ---------- ตรวจ ----------

function assertPlaying(room) {
    const state = room.gameState;
    if (!state || state.status !== 'playing' || state.phase !== 'turn') {
        throw new Error('ยังไม่ถึงจังหวะเล่น');
    }
    return state;
}

function assertTurn(room, playerId, context) {
    const state = assertPlaying(room);
    const seat = getSeat(room, playerId);
    if (!seat || seat.left) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    if (state.turn?.playerId !== playerId) throw new Error('ยังไม่ถึงตาคุณ');
    if (context && context.turnSeq !== undefined && context.turnSeq !== null
        && Number(context.turnSeq) !== Number(state.turnSeq)) {
        throw new Error('จังหวะเปลี่ยนไปแล้ว ลองใหม่อีกครั้ง');
    }
    seat.idle = 0;
    return { state, seat };
}

function isPlayable(state, cardId) {
    const card = getCard(cardId);
    if (!card) return false;
    if (state.turn?.drawnCardId && state.turn.drawnCardId !== cardId) return false;
    if (state.pendingDraw > 0) {
        if (card.kind === 'd4') return true;
        return card.kind === 'd2' && state.pendingKind === 'd2';
    }
    if (WILD_KINDS.has(card.kind)) return true;
    if (!state.currentColor) return true;
    if (card.color === state.currentColor) return true;
    const top = getCard(topCardId(state));
    if (!top) return true;
    if (card.kind === 'num') return top.kind === 'num' && top.value === card.value;
    return card.kind === top.kind;
}

function playableIds(room, playerId) {
    const state = room.gameState;
    if (!state || state.phase !== 'turn' || state.turn?.playerId !== playerId) return [];
    const seat = getSeat(room, playerId);
    if (!seat || seat.left) return [];
    return seat.hand.filter(cardId => isPlayable(state, cardId));
}

// ---------- แอ็กชัน ----------

function openCatchWindow(room, seat, rng) {
    const state = room.gameState;
    const now = Date.now();
    const window = { playerId: seat.playerId, openedAt: now, until: now + CATCH_MS, botCatchAt: null, botId: null };
    const catchers = activeSeats(room).filter(s => s.playerId !== seat.playerId && isBotId(s.playerId));
    if (catchers.length && rng() < 0.6) {
        const bot = catchers[Math.floor(rng() * catchers.length)];
        window.botId = bot.playerId;
        window.botCatchAt = now + Math.round(CATCH_MS * (0.4 + rng() * 0.35));
    }
    state.catchWindow = window;
}

function applyPenaltyDraw(room, seat, count, reason, rng) {
    const got = drawCards(room, seat, count, rng);
    pushFx(room, { kind: 'penalty', playerId: seat.playerId, count: got.length, reason });
    return got;
}

function playCard(room, playerId, payload = {}, context = null, rng = Math.random) {
    const { state, seat } = assertTurn(room, playerId, context);
    const cardId = String(payload.cardId || '');
    const at = seat.hand.indexOf(cardId);
    if (at < 0) throw new Error('ไม่มีไพ่ใบนี้ในมือ');
    if (!isPlayable(state, cardId)) {
        if (state.pendingDraw > 0) throw new Error(`ต้องซ้อน +2/+4 หรือจั่ว ${state.pendingDraw} ใบ`);
        if (state.turn.drawnCardId) throw new Error('จั่วแล้ว ลงได้แค่ใบที่เพิ่งจั่ว');
        throw new Error('ลงใบนี้ไม่ได้ — สีหรือเลขไม่ตรง');
    }
    const card = getCard(cardId);
    let chosen = card.color;
    if (WILD_KINDS.has(card.kind)) {
        chosen = String(payload.color || '');
        if (!COLORS.includes(chosen)) throw new Error('เลือกสีก่อนลงไพ่เปลี่ยนสี');
    }

    seat.hand.splice(at, 1);
    state.discard.push(cardId);
    state.currentColor = chosen;
    if (state.catchWindow && state.catchWindow.playerId !== playerId) {
        // คนถัดไปลงมือแล้ว — หน้าต่างจับยังเปิดตามเวลา (กันบอทลงไวจนคนจับไม่ทัน)
    }

    const remaining = seat.hand.length;
    if (remaining === 1) {
        if (payload.callLast === true || seat.called) {
            seat.called = true;
            pushFx(room, { kind: 'call', playerId });
            pushHistory(room, '📣', `${seat.name}: เหลือใบเดียว!`, 'call');
        } else {
            seat.called = false;
            openCatchWindow(room, seat, rng);
        }
    } else {
        seat.called = false;
        if (state.catchWindow?.playerId === playerId) state.catchWindow = null;
    }

    const colorNote = WILD_KINDS.has(card.kind) ? ` → ${COLOR_NAME[chosen]}` : '';
    pushHistory(room, '🃏', `${seat.name} ลง ${cardLabel(card)}${colorNote}`, 'play');
    pushFx(room, { kind: 'play', playerId, card: describeCard(cardId), color: chosen, left: remaining });

    const activeCount = activeSeats(room).length;
    const curIndex = seatIndex(room, playerId);
    const nextIdx = nextActiveIndex(room, curIndex);
    const nextSeat = state.seats[nextIdx];

    if (card.kind === 'd2' || card.kind === 'd4') {
        const amount = card.kind === 'd2' ? 2 : 4;
        if (state.config.stacking) {
            state.pendingDraw += amount;
            state.pendingKind = card.kind;
            if (remaining === 0) {
                applyPenaltyDraw(room, nextSeat, state.pendingDraw, 'stack', rng);
                pushHistory(room, '➕', `${nextSeat.name} จั่ว ${state.pendingDraw} ใบ`);
                state.pendingDraw = 0;
                state.pendingKind = null;
            }
        } else {
            applyPenaltyDraw(room, nextSeat, amount, card.kind, rng);
            pushHistory(room, '➕', `${nextSeat.name} จั่ว ${amount} ใบ แล้วโดนข้าม`);
        }
    }

    if (remaining === 0) return endRound(room, seat);

    if (card.kind === 'skip') {
        pushFx(room, { kind: 'skip', playerId: nextSeat.playerId });
        advance(room, 2);
    } else if (card.kind === 'rev') {
        if (activeCount === 2) {
            pushFx(room, { kind: 'skip', playerId: nextSeat.playerId });
            advance(room, 2);
        } else {
            state.direction *= -1;
            pushFx(room, { kind: 'reverse', direction: state.direction });
            advance(room, 1);
        }
    } else if ((card.kind === 'd2' || card.kind === 'd4') && !state.config.stacking) {
        pushFx(room, { kind: 'skip', playerId: nextSeat.playerId });
        advance(room, 2);
    } else {
        advance(room, 1);
    }
    return state;
}

function drawCard(room, playerId, context = null, rng = Math.random) {
    const { state, seat } = assertTurn(room, playerId, context);
    if (state.turn.drawnCardId) throw new Error('จั่วไปแล้ว — ลงใบที่จั่วหรือผ่าน');

    if (state.pendingDraw > 0) {
        const count = state.pendingDraw;
        const got = drawCards(room, seat, count, rng);
        state.pendingDraw = 0;
        state.pendingKind = null;
        pushFx(room, { kind: 'penalty', playerId, count: got.length, reason: 'stack' });
        pushHistory(room, '➕', `${seat.name} รับ ${got.length} ใบ`);
        advance(room, 1);
        return state;
    }

    const got = drawCards(room, seat, 1, rng);
    pushFx(room, { kind: 'draw', playerId, count: got.length });
    if (!got.length) {
        pushHistory(room, '🫙', `${seat.name} จั่วไม่ได้ (ไพ่หมดกอง) — ผ่าน`);
        advance(room, 1);
        return state;
    }
    if (isPlayable(state, got[0])) {
        state.turn.drawnCardId = got[0];
        state.turn.drawnAt = Date.now();
        state.turnSeq = (Number(state.turnSeq) || 0) + 1;
        state.turn.seq = state.turnSeq;
        state.phaseEndsAt = Math.max(state.phaseEndsAt || 0, Date.now() + Math.min(DRAWN_MIN_MS, state.config.turnMs));
        pushHistory(room, '📥', `${seat.name} จั่ว 1 ใบ`);
        bumpStep(room);
        return state;
    }
    pushHistory(room, '📥', `${seat.name} จั่ว 1 ใบ แล้วผ่าน`);
    advance(room, 1);
    return state;
}

function passTurn(room, playerId, context = null) {
    const { state, seat } = assertTurn(room, playerId, context);
    if (!state.turn.drawnCardId) throw new Error('ต้องจั่วก่อนถึงจะผ่านได้');
    pushHistory(room, '⏭️', `${seat.name} เก็บใบที่จั่วไว้ — ผ่าน`);
    pushFx(room, { kind: 'pass', playerId });
    advance(room, 1);
    return state;
}

/** กด "เหลือใบเดียว!" — ตอนเหลือ 1 ใบ (ก่อนโดนจับ) หรือกดล่วงหน้าตอนถึงตาและเหลือ 2 ใบ */
function callLast(room, playerId) {
    const state = assertPlaying(room);
    const seat = getSeat(room, playerId);
    if (!seat || seat.left) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    if (seat.called) return state;
    if (seat.hand.length === 1) {
        seat.called = true;
        if (state.catchWindow?.playerId === playerId) state.catchWindow = null;
    } else if (seat.hand.length === 2 && state.turn?.playerId === playerId && playableIds(room, playerId).length) {
        seat.called = true;
    } else {
        throw new Error('กดได้ตอนกำลังจะเหลือไพ่ใบเดียว');
    }
    pushFx(room, { kind: 'call', playerId });
    pushHistory(room, '📣', `${seat.name}: เหลือใบเดียว!`, 'call');
    bumpStep(room);
    return state;
}

function catchWindowOpen(state, now = Date.now()) {
    const win = state.catchWindow;
    return !!(win && now <= win.until);
}

function catchPlayer(room, catcherId, targetId, rng = Math.random) {
    const state = assertPlaying(room);
    const catcher = getSeat(room, catcherId);
    if (!catcher || catcher.left) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    const win = state.catchWindow;
    const target = getSeat(room, targetId || win?.playerId);
    if (!target || target.left || !win || win.playerId !== target.playerId) throw new Error('ไม่มีใครให้จับตอนนี้');
    if (target.playerId === catcherId) throw new Error('จับตัวเองไม่ได้ — กดเหลือใบเดียวแทน');
    if (!catchWindowOpen(state)) {
        state.catchWindow = null;
        throw new Error('ช้าไป — หมดเวลาจับแล้ว');
    }
    if (target.hand.length !== 1 || target.called) {
        state.catchWindow = null;
        throw new Error('เขากดเหลือใบเดียวทันแล้ว');
    }
    state.catchWindow = null;
    applyPenaltyDraw(room, target, 2, 'caught', rng);
    pushFx(room, { kind: 'caught', playerId: target.playerId, by: catcherId });
    pushHistory(room, '🚨', `${catcher.name} จับได้! ${target.name} ลืมกดเหลือใบเดียว — จั่ว 2`, 'caught');
    bumpStep(room);
    return state;
}

// ---------- จบรอบ / จบเกม ----------

function handValue(seat) {
    return seat.hand.reduce((sum, cardId) => sum + cardPoints(cardId), 0);
}

function endRound(room, winnerSeat) {
    const state = room.gameState;
    const points = state.seats
        .filter(seat => seat !== winnerSeat && !seat.left)
        .reduce((sum, seat) => sum + handValue(seat), 0);
    winnerSeat.score += points;
    winnerSeat.roundsWon += 1;
    state.catchWindow = null;
    state.pendingDraw = 0;
    state.pendingKind = null;
    state.turn = null;
    state.roundResult = {
        round: state.round,
        winnerId: winnerSeat.playerId,
        winnerName: winnerSeat.name,
        points,
        hands: state.seats
            .filter(seat => !seat.left)
            .map(seat => ({
                playerId: seat.playerId,
                name: seat.name,
                value: handValue(seat),
                cards: seat.hand.map(describeCard),
                score: seat.score
            }))
            .sort((a, b) => a.value - b.value)
    };
    pushHistory(room, '🏆', `${winnerSeat.name} ทิ้งหมดมือ! ชนะรอบ ${state.round} ได้ ${points} แต้ม`, 'round-win');
    pushFx(room, { kind: 'roundEnd', winnerId: winnerSeat.playerId, points });

    const target = state.config.target;
    if (!target || winnerSeat.score >= target) {
        return finishGame(room, winnerSeat, target ? `${winnerSeat.name} ถึง ${target} แต้มก่อน` : `ทิ้งหมดมือก่อน · เก็บ ${points} แต้มจากมือคนอื่น`);
    }
    state.phase = 'roundEnd';
    state.phaseEndsAt = Date.now() + ROUND_END_MS;
    bumpStep(room);
    return state;
}

function computeStandings(room, winnerId) {
    const state = room.gameState;
    return state.seats
        .map(seat => ({
            playerId: seat.playerId,
            name: seat.name,
            score: seat.score,
            roundsWon: seat.roundsWon,
            cardsLeft: seat.hand.length,
            handValue: handValue(seat),
            left: !!seat.left,
            won: seat.playerId === winnerId
        }))
        .sort((a, b) => (Number(b.won) - Number(a.won))
            || (Number(a.left) - Number(b.left))
            || (b.score - a.score)
            || (a.handValue - b.handValue));
}

function finishGame(room, winnerSeat, reason) {
    const state = room.gameState;
    state.phase = 'finished';
    state.status = 'colorcards_finished';
    state.phaseEndsAt = null;
    state.turn = null;
    state.catchWindow = null;
    state.finishReason = reason || null;
    state.standings = computeStandings(room, winnerSeat ? winnerSeat.playerId : null);
    state.winner = winnerSeat
        ? { playerId: winnerSeat.playerId, name: winnerSeat.name, score: winnerSeat.score }
        : null;
    pushHistory(room, '🏁', reason || 'จบเกม', 'finished');
    pushFx(room, { kind: 'finished', winnerId: winnerSeat ? winnerSeat.playerId : null });
    bumpStep(room);
    return state;
}

function nextRound(room, playerId, rng = Math.random) {
    const state = room.gameState;
    if (!state || state.status !== 'playing' || state.phase !== 'roundEnd') throw new Error('ยังไม่จบรอบ');
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่เริ่มรอบต่อไปได้');
    return startRound(room, rng);
}

/** ทุกคน (คนจริงที่ยังต่ออยู่) กดพร้อม → เริ่มรอบต่อไปทันที ไม่ต้องรอนาฬิกา/หัวห้อง */
function readyNextRound(room, playerId, rng = Math.random) {
    const state = room.gameState;
    if (!state || state.status !== 'playing' || state.phase !== 'roundEnd') throw new Error('ยังไม่จบรอบ');
    const seat = getSeat(room, playerId);
    if (!seat || seat.left) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    seat.idle = 0;
    const ready = Array.isArray(state.roundReady) ? state.roundReady : [];
    if (!ready.includes(playerId)) ready.push(playerId);
    state.roundReady = ready;
    const humans = activeSeats(room).filter(s => !isBotId(s.playerId) && isConnected(room, s));
    if (humans.every(s => ready.includes(s.playerId))) return startRound(room, rng);
    bumpStep(room);
    return state;
}

function endGame(room, playerId) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') throw new Error('เกมยังไม่เริ่มหรือจบแล้ว');
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่จบเกมได้');
    const ranked = activeSeats(room).slice().sort((a, b) => b.score - a.score);
    const leader = ranked[0] && ranked[0].score > 0 && (!ranked[1] || ranked[1].score < ranked[0].score) ? ranked[0] : null;
    return finishGame(room, leader, leader ? `หัวห้องจบเกม — ${leader.name} แต้มนำ` : 'หัวห้องจบเกม');
}

// ---------- หมดเวลา / บอท / คนออก ----------

function autoResolvePhase(room, rng = Math.random) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return state;
    if (state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;
    if (state.phase === 'roundEnd') return startRound(room, rng);
    if (state.phase !== 'turn' || !state.turn) return state;

    const seat = getSeat(room, state.turn.playerId);
    if (!seat || seat.left) {
        advance(room, 1);
        return state;
    }
    if (!isBotId(seat.playerId)) seat.idle = (Number(seat.idle) || 0) + 1;
    if (state.turn.drawnCardId) {
        pushHistory(room, '⏰', `${seat.name} หมดเวลา — ผ่าน`);
        pushFx(room, { kind: 'timeout', playerId: seat.playerId });
        advance(room, 1);
        return state;
    }
    const count = state.pendingDraw > 0 ? state.pendingDraw : 1;
    const got = drawCards(room, seat, count, rng);
    state.pendingDraw = 0;
    state.pendingKind = null;
    pushFx(room, { kind: count > 1 ? 'penalty' : 'draw', playerId: seat.playerId, count: got.length, reason: 'stack' });
    pushFx(room, { kind: 'timeout', playerId: seat.playerId });
    pushHistory(room, '⏰', `${seat.name} หมดเวลา — จั่ว ${got.length} ใบแล้วผ่าน`);
    advance(room, 1);
    return state;
}

function colorCounts(hand) {
    const counts = { r: 0, y: 0, g: 0, b: 0 };
    hand.forEach(cardId => {
        const card = getCard(cardId);
        if (card && card.color) counts[card.color] += 1;
    });
    return counts;
}

function botPickColor(hand, rng) {
    const counts = colorCounts(hand);
    const best = Math.max(...COLORS.map(c => counts[c]));
    const options = COLORS.filter(c => counts[c] === best);
    return options[Math.floor(rng() * options.length)] || 'r';
}

/** กลยุทธ์บอทแบบง่าย: เก็บไพ่ไวลด์ไว้ท้าย, คนถัดไปใกล้หมดมือ = ใส่ไพ่โจมตี, เลือกสีที่ถือเยอะสุด */
function chooseBotMove(room, seat, rng) {
    const state = room.gameState;
    const playable = seat.hand.filter(cardId => isPlayable(state, cardId));
    if (!playable.length) return { type: state.turn.drawnCardId ? 'pass' : 'draw' };

    const nextSeat = state.seats[nextActiveIndex(room, seatIndex(room, seat.playerId))];
    const threat = nextSeat && nextSeat.hand.length <= 2;
    const counts = colorCounts(seat.hand);
    const scored = playable.map(cardId => {
        const card = getCard(cardId);
        let score = 0;
        if (card.kind === 'num') score = 10 + card.value * 0.3;
        else if (ACTION_KINDS.has(card.kind)) score = threat ? 30 : 8;
        else if (card.kind === 'wild') score = 2;
        else score = threat ? 26 : 1;
        if (card.color) score += counts[card.color] * 1.5;
        if (seat.hand.length <= 2 && WILD_KINDS.has(card.kind)) score += 5;
        return { cardId, card, score: score + rng() * 0.5 };
    }).sort((a, b) => b.score - a.score);

    const pick = scored[0];
    const rest = seat.hand.filter(id => id !== pick.cardId);
    return {
        type: 'play',
        cardId: pick.cardId,
        color: WILD_KINDS.has(pick.card.kind) ? botPickColor(rest, rng) : undefined,
        callLast: seat.hand.length === 2 ? rng() < 0.85 : false
    };
}

function botTurnPending(room) {
    const state = room.gameState;
    return !!(state && state.status === 'playing' && state.phase === 'turn' && state.turn && isBotId(state.turn.playerId));
}

function botCatchPending(room, now = Date.now()) {
    const state = room.gameState;
    const win = state && state.catchWindow;
    if (!win || !win.botId || !win.botCatchAt || now > win.until) return false;
    const bot = getSeat(room, win.botId);
    return !!(bot && !bot.left && state.phase === 'turn');
}

function botNeedsTurn(room) {
    return botTurnPending(room) || botCatchPending(room);
}

/** บอทขยับเมื่อไร: ต้นตา + 1.1 วิ · จั่วแล้วได้ใบลงได้ = นับจากตอนจั่วอีก 0.66 วิ (ให้คนเห็นว่าจั่วก่อนค่อยลง) */
function botDueAt(state, now = Date.now()) {
    if (state.turn.drawnCardId) return (state.turn.drawnAt || state.turn.startedAt || now) + BOT_TURN_MS * 0.6;
    return (state.turn.startedAt || now) + BOT_TURN_MS;
}

/** เวลา (ms นับจากตอนนี้) ที่บอทควรขยับครั้งถัดไป หรือ null */
function botDelay(room, now = Date.now()) {
    const state = room.gameState;
    const waits = [];
    if (botCatchPending(room, now)) waits.push(Math.max(0, state.catchWindow.botCatchAt - now));
    if (botTurnPending(room)) {
        const due = botDueAt(state, now);
        waits.push(Math.max(250, due - now));
    }
    return waits.length ? Math.min(...waits) : null;
}

function playBotTurns(room, rng = Math.random, now = Date.now()) {
    const state = room.gameState;
    if (!state || state.status !== 'playing' || state.phase !== 'turn') return false;
    let acted = false;

    if (botCatchPending(room, now) && now >= state.catchWindow.botCatchAt) {
        const win = state.catchWindow;
        try {
            catchPlayer(room, win.botId, win.playerId, rng);
            acted = true;
        } catch (error) {
            state.catchWindow = state.catchWindow === win ? { ...win, botId: null, botCatchAt: null } : state.catchWindow;
        }
    }

    if (botTurnPending(room)) {
        const seat = getSeat(room, state.turn.playerId);
        const due = botDueAt(state, now) - 50;
        if (seat && now >= due) {
            const move = chooseBotMove(room, seat, rng);
            const ctx = { turnSeq: state.turnSeq };
            if (move.type === 'play') playCard(room, seat.playerId, move, ctx, rng);
            else if (move.type === 'pass') passTurn(room, seat.playerId, ctx);
            else drawCard(room, seat.playerId, ctx, rng);
            acted = true;
        }
    }
    return acted;
}

function handlePlayerLeft(room, playerId, rng = Math.random) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return state;
    const seat = getSeat(room, playerId);
    if (!seat || seat.left) return state;
    const wasTurn = state.phase === 'turn' && state.turn?.playerId === playerId;

    seat.left = true;
    seat.called = false;
    const returned = seat.hand.length;
    state.drawPile = seat.hand.concat(state.drawPile); // ใส่ใต้กองจั่ว
    seat.hand = [];
    if (state.catchWindow && (state.catchWindow.playerId === playerId || state.catchWindow.botId === playerId)) {
        state.catchWindow = null;
    }
    pushHistory(room, '🚪', `${seat.name} ออกจากเกม — ไพ่ ${returned} ใบกลับใต้กองจั่ว`, 'left');
    pushFx(room, { kind: 'left', playerId });

    const remaining = activeSeats(room);
    if (remaining.length < 2) {
        const last = remaining[0] || null;
        return finishGame(room, last, last ? `คนอื่นออกหมด — ${last.name} ชนะ` : 'ทุกคนออกจากเกม');
    }
    if (wasTurn) {
        // คนออกยังอยู่ใน seats (left) จึงเดินต่อจากที่นั่งเขาได้ตรงทิศ
        advance(room, 1);
    } else {
        bumpStep(room);
    }
    return state;
}

// ---------- ส่งให้ client ----------

function getAvailableActions(room, viewerId) {
    const state = room.gameState;
    const seat = getSeat(room, viewerId);
    const isHost = room.admin === viewerId;
    const playing = state.status === 'playing';
    const base = {
        canPlay: false,
        canDraw: false,
        canPass: false,
        canCall: false,
        canCatch: null,
        canNextRound: isHost && playing && state.phase === 'roundEnd',
        canReady: false,
        canEnd: isHost && playing
    };
    if (!seat || seat.left || !playing) return base;
    if (state.phase === 'roundEnd') {
        return { ...base, canReady: !(state.roundReady || []).includes(viewerId) };
    }
    const myTurn = state.phase === 'turn' && state.turn?.playerId === viewerId;
    const playable = myTurn ? playableIds(room, viewerId) : [];
    const actions = { ...base };
    if (myTurn) {
        actions.canPlay = playable.length > 0;
        actions.canDraw = !state.turn.drawnCardId;
        actions.canPass = !!state.turn.drawnCardId;
    }
    if (state.phase === 'turn' && !seat.called) {
        actions.canCall = seat.hand.length === 1 || (myTurn && seat.hand.length === 2 && playable.length > 0);
    }
    const win = state.catchWindow;
    if (state.phase === 'turn' && win && win.playerId !== viewerId && catchWindowOpen(state)) {
        const target = getSeat(room, win.playerId);
        if (target && !target.left && target.hand.length === 1 && !target.called) actions.canCatch = win.playerId;
    }
    return actions;
}

function buildClientState(room, viewerId) {
    const state = room.gameState || createInitialState();
    const seats = state.seats || [];
    const viewer = seats.find(seat => seat.playerId === viewerId) || null;
    const showdown = state.phase === 'roundEnd' || state.phase === 'finished';
    const now = Date.now();
    const turnSeat = state.turn ? seats.find(seat => seat.playerId === state.turn.playerId) : null;
    const win = state.catchWindow && catchWindowOpen(state, now) ? state.catchWindow : null;
    const dealer = seats[state.dealerIndex] || null;

    return {
        mode: MODE,
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        turnSeq: Number(state.turnSeq) || 0,
        serverNow: now,
        round: state.round,
        config: state.config || normalizeConfig(room.settings || {}),
        direction: state.direction,
        currentColor: state.currentColor,
        top: describeCard(topCardId(state)),
        pile: (state.discard || []).slice(-5).map(describeCard),
        drawCount: (state.drawPile || []).length,
        discardCount: (state.discard || []).length,
        turn: state.turn ? {
            playerId: state.turn.playerId,
            name: turnSeat ? turnSeat.name : null,
            drawn: !!state.turn.drawnCardId,
            startedAt: state.turn.startedAt
        } : null,
        phaseEndsAt: state.phaseEndsAt,
        pendingDraw: state.pendingDraw || 0,
        pendingKind: state.pendingKind || null,
        catchWindow: win ? { playerId: win.playerId, until: win.until, ms: CATCH_MS } : null,
        roundReady: state.phase === 'roundEnd' ? (state.roundReady || []).slice() : [],
        dealerId: dealer ? dealer.playerId : null,
        isHost: room.admin === viewerId,
        seats: seats.map(seat => ({
            playerId: seat.playerId,
            name: seat.name,
            color: seat.color,
            avatar: seat.avatar,
            avatarFrame: seat.avatarFrame,
            count: seat.hand.length,
            score: seat.score,
            roundsWon: seat.roundsWon,
            called: !!seat.called,
            left: !!seat.left,
            idle: (Number(seat.idle) || 0) >= IDLE_TURNS,
            online: isConnected(room, seat),
            isBot: isBotId(seat.playerId),
            isSelf: seat.playerId === viewerId,
            isTurn: !!(state.turn && state.turn.playerId === seat.playerId)
        })),
        self: viewer ? {
            playerId: viewer.playerId,
            left: !!viewer.left,
            called: !!viewer.called,
            score: viewer.score,
            hand: viewer.hand.map(describeCard),
            playable: playableIds(room, viewerId),
            drawnCardId: state.turn && state.turn.playerId === viewerId ? state.turn.drawnCardId : null
        } : null,
        availableActions: getAvailableActions(room, viewerId),
        roundResult: showdown ? state.roundResult : null,
        standings: state.phase === 'finished' ? state.standings : null,
        winner: state.phase === 'finished' ? state.winner : null,
        finishReason: state.phase === 'finished' ? state.finishReason : null,
        history: state.history || [],
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        fx: state.fx || []
    };
}

/** นับไพ่ทั้งระบบ (ใช้ในเทส): มือ + กองจั่ว + กองทิ้ง ต้องได้ 108 ใบไม่ซ้ำ */
function allCardIds(room) {
    const state = room.gameState;
    return [
        ...state.drawPile,
        ...state.discard,
        ...state.seats.flatMap(seat => seat.hand)
    ];
}

module.exports = {
    id: MODE,
    label: 'ไพ่ทิ้งสี',
    description: 'ลงไพ่ให้สีหรือเลขตรงกัน ทิ้งให้หมดมือก่อนชนะ เหลือใบเดียวต้องกดบอก — 2–10 คน',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    HAND_SIZE,
    COLORS,
    COLOR_NAME,
    CATALOG,
    CATCH_MS,
    ROUND_END_MS,
    TURN_CHOICES,
    TARGET_CHOICES,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    normalizeConfig,
    startGame,
    startRound,
    playCard,
    drawCard,
    passTurn,
    callLast,
    catchPlayer,
    nextRound,
    readyNextRound,
    endGame,
    autoResolvePhase,
    playBotTurns,
    botNeedsTurn,
    botDelay,
    chooseBotMove,
    handlePlayerLeft,
    buildClientState,
    getAvailableActions,
    isPlayable,
    playableIds,
    cardPoints,
    describeCard,
    getCard,
    buildDeck,
    shuffle,
    isBotId,
    allCardIds
};
