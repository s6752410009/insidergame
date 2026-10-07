/**
 * คลื่นความคิด — engine ล้วน (ไม่มี socket/IO) ทดสอบได้ด้วย rng/นาฬิกาที่ส่งเข้ามาเอง
 *
 * 3 โหมด (room.settings.wavelengthMode) — กติกาเทียบบอร์ดเกมจริงดู rules/wavelength/rules.md
 *   teams (ค่าเริ่มต้น) 2 ทีมผลัดกัน · ทีมผู้ใบ้หมุนเข็มเดียวกัน กด ✅ ตกลงครบ = ล็อก
 *          → ทีมตรงข้ามทาย ⬅️/➡️ ถูกได้ 1 (ทีมผู้ใบ้เป๊ะ = ไม่ได้) · เป๊ะแต่ยังตามหลัง = เล่นต่ออีกตา
 *          · ทีมแรกเริ่ม 0 อีกทีมเริ่ม 1 · ถึง 10 ก่อนชนะ (เสมอที่ 10+ = ต่อตายทีมละตา)
 *   coop   ทุกคนทีมเดียว 7 การ์ด · เป๊ะได้ 3 + การ์ดโบนัส 1 ใบ · จบแล้วดูตารางคะแนน
 *   solo   (แบบเดิม) ทุกคนเข็มของตัวเอง 4/3/2 ผู้ใบ้ได้ค่าเฉลี่ย · ผู้ใบ้วน 1 หรือ 2 รอบโต๊ะ
 *
 * รอบหนึ่ง: clue (60 วิ) → guess (เดี่ยว 45 วิ · ทีม/ร่วมมือ 90 วิ) → [teams: leftright 25 วิ] → reveal
 *
 * ความลับ: state.target อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น buildClientState ส่งให้ผู้ใบ้คนเดียวจนกว่าจะเปิด
 * env (ไม่บังคับ) = { rng: () => [0,1), now: () => ms } ใช้ตอนเทส
 */

const { CARDS } = require('./wavelengthCards');

const MODE = 'wavelength';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;

const CLUE_MS = Number(process.env.WAVELENGTH_CLUE_MS) || 60000;
const GUESS_MS = Number(process.env.WAVELENGTH_GUESS_MS) || 45000;
const REVEAL_MS = Number(process.env.WAVELENGTH_REVEAL_MS) || 30000;
const SKIP_MS = Number(process.env.WAVELENGTH_SKIP_MS) || 7000;
const GRACE_MS = Number(process.env.WAVELENGTH_GRACE_MS) || 15000;
const TEAM_GUESS_MS = Number(process.env.WAVELENGTH_TEAM_GUESS_MS) || 90000;
const LR_MS = Number(process.env.WAVELENGTH_LR_MS) || 25000;

const VARIANTS = ['teams', 'coop', 'solo'];
const DEFAULT_VARIANT = 'teams';
const TEAM_MIN_PLAYERS = 4;
const WIN_SCORE = 10;
const COOP_CARDS = 7;
const TEAM_IDS = ['A', 'B'];
const TEAM_META = {
    A: { name: 'ทีมฟ้า', icon: '🔵', color: '#5eead4' },
    B: { name: 'ทีมส้ม', icon: '🟠', color: '#fb8a6b' }
};
// ตารางคะแนนโหมดร่วมมือ (แปลจากคู่มือ) — 16+ = ชนะ
const COOP_CHART = [
    { min: 0, max: 3, text: 'เสียบปลั๊กหรือยัง?' },
    { min: 4, max: 6, text: 'ลองปิดแล้วเปิดใหม่' },
    { min: 7, max: 9, text: 'เป่าใต้เครื่องดูหน่อย' },
    { min: 10, max: 12, text: 'ไม่เลว! ไม่ดี แต่ไม่เลว' },
    { min: 13, max: 15, text: 'อีกนิดเดียว!' },
    { min: 16, max: 18, text: 'ชนะแล้ว!' },
    { min: 19, max: 21, text: 'คลื่นตรงกันเป๊ะ' },
    { min: 22, max: 24, text: 'สมองระดับจักรวาล' },
    { min: 25, max: null, text: '?!?!?!?!' }
];
const COOP_WIN_SCORE = 16;

const MAX_CLUE_LENGTH = 40;
// แถบคะแนนตามบอร์ดเกม (ระยะห่างจากเป้า บนสเกล 0–100)
const BANDS = [
    { points: 4, halfWidth: 4, label: 'เป๊ะ!' },
    { points: 3, halfWidth: 11, label: 'ใกล้มาก' },
    { points: 2, halfWidth: 18, label: 'เฉียด' }
];
const MISS_LABEL = 'พลาด';
const PIN_CENTER = 50;

// ---------- utils ----------

function clockOf(env) {
    return env && typeof env.now === 'function' ? env.now() : Date.now();
}

function rngOf(env) {
    return env && typeof env.rng === 'function' ? env.rng : Math.random;
}

const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'grapheme' })
    : null;

function graphemeLength(text) {
    if (!graphemeSegmenter) return Array.from(String(text)).length;
    let count = 0;
    for (const _ of graphemeSegmenter.segment(String(text))) count += 1; // eslint-disable-line no-unused-vars
    return count;
}

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

/** ข้อความที่โชว์: NFC, ตัดอักขระล่องหน, ช่องว่างซ้อนเหลือช่องเดียว */
function cleanClue(text) {
    return String(text == null ? '' : text)
        .normalize('NFC')
        .replace(ZERO_WIDTH, '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** ใช้เทียบคำ: ตัดช่องว่าง/ไม้ยมก/เครื่องหมาย แล้ว case-fold */
function compactForCompare(text) {
    return cleanClue(text)
        .toLowerCase()
        .replace(/[\sๆ.,!?'"“”‘’()\-_/\\:;~*]+/g, '');
}

function clampPin(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}

function scoreDistance(distance) {
    for (const band of BANDS) {
        if (distance <= band.halfWidth) return band;
    }
    return null;
}

function scorePin(pin, target) {
    if (pin == null || target == null) return { points: 0, distance: null, label: 'ไม่ได้ทาย' };
    const distance = Math.round(Math.abs(Number(pin) - Number(target)) * 10) / 10;
    const band = scoreDistance(distance);
    return band
        ? { points: band.points, distance, label: band.label }
        : { points: 0, distance, label: MISS_LABEL };
}

function clampLaps(value) {
    return Number(value) === 2 ? 2 : 1;
}

function clampVariant(value) {
    return VARIANTS.includes(value) ? value : DEFAULT_VARIANT;
}

function otherTeam(team) {
    return team === 'A' ? 'B' : 'A';
}

function coopRank(score) {
    const n = Math.max(0, Number(score) || 0);
    return COOP_CHART.find(row => n >= row.min && (row.max == null || n <= row.max)) || COOP_CHART[0];
}

function isShared(state) {
    return state.variant === 'teams' || state.variant === 'coop';
}

// ---------- state ----------

function createInitialState() {
    return {
        mode: MODE,
        variant: DEFAULT_VARIANT,
        status: 'waiting',
        phase: 'lobby',
        players: [],
        order: [],
        laps: 1,
        round: 0,
        giverId: null,
        lastGiverId: null,
        options: [],
        rerollUsed: false,
        card: null,
        clue: null,
        target: null,
        clueDeadline: null,
        giverAwayAt: null,
        guesserIds: [],
        readyIds: [],
        lastRound: null,
        rounds: [],
        usedCards: [],
        ledger: {},
        phaseEndsAt: null,
        step: 0,
        fxSeq: 0,
        fx: [],
        history: [],
        standings: null,
        winners: null,
        statsRecordedAt: null,
        returnLobbyEndsAt: null,
        // แข่งทีม / ร่วมมือ
        teams: null,
        activeTeam: null,
        nextTeam: null,
        startTeam: null,
        catchUp: false,
        nextCatchUp: false,
        suddenDeath: null,
        pendingEnd: null,
        dial: null,
        dialBy: null,
        agreeIds: [],
        opponentIds: [],
        lrVotes: [],
        coop: null
    };
}

function createPlayerState(player) {
    return {
        playerId: player.playerId,
        name: player.playerName || player.name || 'ผู้เล่น',
        color: player.color || '#f5c86b',
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        score: 0,
        gives: 0,
        // false = เข้ามากลางเกม รอเข้าร่วมรอบหน้า
        active: false,
        pin: null,
        pinRound: 0,
        locked: false,
        autoLocked: false,
        roundsPlayed: 0,
        bullseyes: 0,
        team: null
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: (room.players || []).map(createPlayerState)
    };
}

function getPlayer(room, playerId) {
    return ((room.gameState && room.gameState.players) || []).find(p => p.playerId === playerId) || null;
}

function roomEntry(room, playerId) {
    return (room.players || []).find(p => p.playerId === playerId) || null;
}

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function isOnline(room, playerId) {
    const entry = roomEntry(room, playerId);
    if (!entry) return false;
    return isBotId(playerId) || !!entry.socketId;
}

function isPresent(room, player) {
    return !!(player && roomEntry(room, player.playerId));
}

function eligiblePlayers(room) {
    return (room.gameState.players || []).filter(p => p.active && isPresent(room, p));
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, ...event }].slice(-16);
}

function pushHistory(room, icon, text, kind = null, env = null) {
    room.gameState.history = [
        { icon, text, kind, at: new Date(clockOf(env)).toISOString() },
        ...(room.gameState.history || [])
    ].slice(0, 40);
}

function bumpStep(room) {
    room.gameState.step = (Number(room.gameState.step) || 0) + 1;
}

function syncLedger(room) {
    const state = room.gameState;
    state.ledger = state.ledger || {};
    (state.players || []).forEach(p => {
        if (!p.active) return;
        state.ledger[p.playerId] = {
            playerId: p.playerId,
            name: p.name,
            color: p.color,
            avatar: p.avatar,
            avatarFrame: p.avatarFrame,
            score: p.score,
            gives: p.gives,
            roundsPlayed: p.roundsPlayed,
            bullseyes: p.bullseyes || 0,
            team: p.team || null,
            left: !isPresent(room, p)
        };
    });
    Object.values(state.ledger).forEach(row => {
        if (!getPlayer(room, row.playerId)) row.left = true;
    });
}

function assertPlaying(room) {
    const state = room.gameState;
    if (!state || state.mode !== MODE || state.status !== 'playing') {
        throw new Error('เกมยังไม่เริ่มหรือจบไปแล้ว');
    }
    return state;
}

function assertRound(state, context) {
    if (!context) return;
    if (context.round != null && Number(context.round) !== Number(state.round)) {
        throw new Error('จังหวะเกมเปลี่ยนแล้ว ลองใหม่อีกครั้ง');
    }
    if (context.phase && context.phase !== state.phase) {
        throw new Error('จังหวะเกมเปลี่ยนแล้ว ลองใหม่อีกครั้ง');
    }
}

// ---------- การ์ด ----------

function drawOptions(room, env) {
    const state = room.gameState;
    const rng = rngOf(env);
    const exclude = new Set([...(state.options || []).map(c => c.id), ...(state.card ? [state.card.id] : [])]);
    let used = new Set(state.usedCards || []);
    let pool = CARDS.filter(c => !used.has(c.id) && !exclude.has(c.id));
    if (pool.length < 2) {
        used = new Set();
        state.usedCards = [];
        pool = CARDS.filter(c => !exclude.has(c.id));
    }
    const first = pool[Math.floor(rng() * pool.length)];
    // ใบที่สองพยายามมาจากคนละหมวด ให้มีตัวเลือกที่ต่างกันจริง
    const otherGroup = pool.filter(c => c.id !== first.id && c.group !== first.group);
    const rest = otherGroup.length ? otherGroup : pool.filter(c => c.id !== first.id);
    const second = rest[Math.floor(rng() * rest.length)];
    const picked = [first, second].map(c => ({ id: c.id, left: c.left, right: c.right }));
    state.usedCards = [...(state.usedCards || []), ...picked.map(c => c.id)];
    return picked;
}

// ---------- ทีม ----------

function presentTeamMembers(room, team) {
    const state = room.gameState;
    const byId = new Map(eligiblePlayers(room).map(p => [p.playerId, p]));
    return (state.order || []).map(id => byId.get(id)).filter(p => p && p.team === team);
}

/** ทีมที่คนน้อยกว่า (เท่ากัน = ทีมแต้มน้อยกว่า · เท่าอีก = ทีมฟ้า) */
function smallerTeam(room) {
    const state = room.gameState;
    const a = presentTeamMembers(room, 'A').length;
    const b = presentTeamMembers(room, 'B').length;
    if (a !== b) return a < b ? 'A' : 'B';
    const sa = state.teams ? state.teams.A.score : 0;
    const sb = state.teams ? state.teams.B.score : 0;
    if (sa !== sb) return sa < sb ? 'A' : 'B';
    return 'A';
}

/** ทีมไหนเหลือไม่ถึง 2 คน หรือต่างกัน 3+ คน — ย้ายคนท้ายแถวของทีมใหญ่มา (ไม่ย้ายผู้ใบ้ตาที่แล้ว) */
function rebalanceTeams(room, env) {
    const state = room.gameState;
    for (let guard = 0; guard < 12; guard += 1) {
        const a = presentTeamMembers(room, 'A');
        const b = presentTeamMembers(room, 'B');
        const [small, big] = a.length <= b.length ? [a, b] : [b, a];
        if (!(big.length >= 3 && (small.length < 2 || big.length - small.length >= 3))) return;
        const toTeam = small === a ? 'A' : 'B';
        const pool = big.filter(p => p.playerId !== state.lastGiverId);
        const mover = (pool.length ? pool : big)[(pool.length ? pool : big).length - 1];
        mover.team = toTeam;
        pushHistory(room, '🔀', `${mover.name} ย้ายไป${TEAM_META[toTeam].name} ให้ทีมสมดุล`, null, env);
    }
}

function teamsPlayable(room) {
    return presentTeamMembers(room, 'A').length >= 2 && presentTeamMembers(room, 'B').length >= 2;
}

// ---------- รอบ ----------

function activatePending(room) {
    const state = room.gameState;
    (state.players || []).forEach(p => {
        if (p.active || !isPresent(room, p)) return;
        p.active = true;
        if (!state.order.includes(p.playerId)) state.order.push(p.playerId);
        if (state.variant === 'teams' && !p.team) p.team = smallerTeam(room);
        const where = state.variant === 'teams' && p.team ? ` (${TEAM_META[p.team].name})` : '';
        pushHistory(room, '👋', `${p.name} เข้าร่วมตั้งแต่รอบนี้${where}`);
    });
}

function pickGiver(room) {
    const state = room.gameState;
    const order = state.order || [];
    let pool = eligiblePlayers(room);
    let lastId = state.lastGiverId;
    if (state.variant === 'solo') pool = pool.filter(p => p.gives < state.laps);
    if (state.variant === 'teams') {
        pool = pool.filter(p => p.team === state.activeTeam);
        lastId = state.teams[state.activeTeam].lastGiverId;
    }
    if (!pool.length) return null;
    const online = pool.filter(p => isOnline(room, p.playerId));
    let candidates = online.length ? online : pool;
    // เดี่ยว: ใบ้ครบเท่ากันก่อน · ทีม/ร่วมมือ: วนตามที่นั่งล้วน (ตาพิเศษก็ได้คนถัดไป)
    if (state.variant === 'solo') {
        const minGives = Math.min(...candidates.map(p => p.gives));
        candidates = candidates.filter(p => p.gives === minGives);
    }
    const n = Math.max(1, order.length);
    const lastIdx = order.indexOf(lastId);
    const distance = p => {
        const idx = order.indexOf(p.playerId);
        if (idx < 0) return n + 1;
        return (idx - lastIdx - 1 + n) % n;
    };
    return candidates.slice().sort((a, b) => distance(a) - distance(b))[0];
}

function remainingTurns(room) {
    const state = room.gameState;
    if (state.variant === 'coop') {
        const c = state.coop || { total: 0, bonus: 0, played: 0 };
        return Math.max(0, c.total + c.bonus - c.played - (state.phase === 'reveal' || state.phase === 'finished' ? 0 : 1));
    }
    if (state.variant === 'teams') return 0;
    return eligiblePlayers(room).reduce((sum, p) => sum + Math.max(0, state.laps - p.gives), 0);
}

function clueEndsAt(state) {
    if (state.giverAwayAt) return Math.min(state.clueDeadline, state.giverAwayAt + GRACE_MS);
    return state.clueDeadline;
}

function startRound(room, env = null) {
    const state = room.gameState;
    if (state.pendingEnd) return finishGame(room, state.pendingEnd.reason, env);
    activatePending(room);
    syncLedger(room);
    if (eligiblePlayers(room).length < 2) {
        return finishGame(room, 'ผู้เล่นเหลือไม่พอ — จบเกม', env);
    }
    if (state.variant === 'teams') {
        rebalanceTeams(room, env);
        if (!teamsPlayable(room)) return finishGame(room, 'คนเหลือไม่พอแข่งทีม — จบเกม', env);
        state.activeTeam = state.nextTeam || state.activeTeam || state.startTeam || 'A';
        state.catchUp = !!state.nextCatchUp;
        state.nextCatchUp = false;
    }
    const giver = pickGiver(room);
    if (!giver) return finishGame(room, null, env);

    const rng = rngOf(env);
    const now = clockOf(env);
    state.round += 1;
    state.giverId = giver.playerId;
    state.lastGiverId = giver.playerId;
    if (state.variant === 'teams') state.teams[state.activeTeam].lastGiverId = giver.playerId;
    giver.gives += 1;
    state.options = [];
    state.card = null;
    state.options = drawOptions(room, env);
    state.rerollUsed = false;
    state.clue = null;
    // 3–97: แถบเป๊ะไม่ตกขอบหน้าปัดครึ่งหนึ่ง (ยังให้เป้าชิดขอบได้)
    state.target = 3 + Math.floor(rng() * 95);
    state.guesserIds = [];
    state.opponentIds = [];
    state.readyIds = [];
    state.agreeIds = [];
    state.lrVotes = [];
    state.dial = null;
    state.dialBy = null;
    state.lastRound = null;
    state.players.forEach(p => {
        p.pin = null;
        p.pinRound = state.round;
        p.locked = false;
        p.autoLocked = false;
    });
    state.phase = 'clue';
    state.clueDeadline = now + CLUE_MS;
    state.giverAwayAt = isOnline(room, giver.playerId) ? null : now;
    state.phaseEndsAt = clueEndsAt(state);
    bumpStep(room);
    syncLedger(room);
    const teamTag = state.variant === 'teams' ? ` (${TEAM_META[state.activeTeam].name}${state.catchUp ? ' · ตาพิเศษ' : ''})` : '';
    pushHistory(room, '📡', `รอบ ${state.round} — ${giver.name} เป็นผู้ใบ้${teamTag}`, 'round', env);
    pushFx(room, { kind: 'round', round: state.round, giverId: giver.playerId, team: state.variant === 'teams' ? state.activeTeam : null, catchUp: !!state.catchUp });
    return state;
}

function shuffled(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function startGame(room, env = null) {
    const humans = (room.players || []).filter(p => p.socketId || isBotId(p.playerId));
    if (humans.length < MIN_PLAYERS || humans.length > MAX_PLAYERS) {
        throw new Error(`คลื่นความคิดเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน`);
    }
    const rng = rngOf(env);
    const state = createInitialState();
    state.status = 'playing';
    let variant = clampVariant(room.settings && room.settings.wavelengthMode);
    // คู่มือ: 2–3 คนเล่นแบบร่วมมือ
    const fellBack = variant === 'teams' && humans.length < TEAM_MIN_PLAYERS;
    if (fellBack) variant = 'coop';
    state.variant = variant;
    state.laps = clampLaps(room.settings && room.settings.wavelengthLaps);
    state.players = (room.players || []).map(rp => {
        const player = createPlayerState(rp);
        player.active = true;
        return player;
    });
    state.order = state.players.map(p => p.playerId);
    room.gameState = state;
    if (variant === 'teams') {
        // แบ่งทีมแบบสุ่ม คนเท่ากัน (ต่างกันไม่เกิน 1) · ทีมเริ่มก่อนสุ่ม อีกทีมได้ 1 แต้มตั้งต้น
        const present = state.players.filter(p => isPresent(room, p));
        const first = rng() < 0.5 ? 'A' : 'B';
        shuffled(present, rng).forEach((p, i) => { p.team = i % 2 === 0 ? first : otherTeam(first); });
        const startTeam = rng() < 0.5 ? 'A' : 'B';
        state.teams = {
            A: { score: startTeam === 'A' ? 0 : 1, lastGiverId: null },
            B: { score: startTeam === 'B' ? 0 : 1, lastGiverId: null }
        };
        state.startTeam = startTeam;
        state.activeTeam = startTeam;
        state.nextTeam = startTeam;
        pushHistory(room, '🎬', `เริ่มแข่งทีม — ${TEAM_META[startTeam].name}เริ่มก่อน · ${TEAM_META[otherTeam(startTeam)].name}ได้ 1 แต้มตั้งต้น · ถึง ${WIN_SCORE} ก่อนชนะ`, null, env);
    } else if (variant === 'coop') {
        state.coop = { total: COOP_CARDS, played: 0, bonus: 0, score: 0 };
        pushHistory(room, '🎬', `${fellBack ? `${humans.length} คน — ` : ''}เริ่มแบบร่วมมือ — ${COOP_CARDS} การ์ด ทุกคนช่วยกันทาย`, null, env);
    } else {
        pushHistory(room, '🎬', `เริ่มแข่งเดี่ยว — ผู้ใบ้วน ${state.laps === 2 ? '2 รอบโต๊ะ' : '1 รอบโต๊ะ'}`, null, env);
    }
    return startRound(room, env);
}

// ---------- ผู้ใบ้ ----------

function assertGiver(room, playerId, context) {
    const state = assertPlaying(room);
    assertRound(state, context);
    if (state.phase !== 'clue') throw new Error('ตอนนี้ไม่ใช่ช่วงคิดคำใบ้');
    if (state.giverId !== playerId) throw new Error('รอบนี้คุณไม่ใช่ผู้ใบ้');
    return state;
}

function pickCard(room, playerId, index, context = null) {
    const state = assertGiver(room, playerId, context);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= state.options.length) throw new Error('เลือกการ์ดไม่ถูกต้อง');
    state.card = { ...state.options[i] };
    return state;
}

function rerollCards(room, playerId, context = null, env = null) {
    const state = assertGiver(room, playerId, context);
    if (state.rerollUsed) throw new Error('สุ่มการ์ดใหม่ได้ครั้งเดียว');
    state.options = drawOptions(room, env);
    state.card = null;
    state.rerollUsed = true;
    pushFx(room, { kind: 'reroll', round: state.round });
    return state;
}

/** คืน { ok, clue } หรือ { ok:false, error } — ใช้ทั้งฝั่งเซิร์ฟเวอร์และเทส */
function validateClue(text, card) {
    const clue = cleanClue(text);
    if (!clue) return { ok: false, error: 'พิมพ์คำใบ้ก่อน' };
    if (graphemeLength(clue) > MAX_CLUE_LENGTH) return { ok: false, error: `คำใบ้ยาวได้ไม่เกิน ${MAX_CLUE_LENGTH} ตัวอักษร` };
    if (/[0-9๐-๙]/.test(clue)) return { ok: false, error: 'ห้ามใช้ตัวเลขในคำใบ้' };
    const compact = compactForCompare(clue);
    if (!compact) return { ok: false, error: 'คำใบ้ต้องมีตัวอักษร' };
    if (card) {
        const words = [card.left, card.right].map(compactForCompare).filter(Boolean);
        const hit = words.some(word => compact.includes(word) || (graphemeLength(compact) >= 2 && word.includes(compact)));
        if (hit) return { ok: false, error: 'ห้ามใช้คำบนการ์ดในคำใบ้' };
    }
    return { ok: true, clue };
}

function submitClue(room, playerId, text, context = null, env = null) {
    const state = assertGiver(room, playerId, context);
    if (!state.card) throw new Error('เลือกการ์ดก่อน');
    const check = validateClue(text, state.card);
    if (!check.ok) throw new Error(check.error);
    state.clue = check.clue;
    // คนที่เข้ามาระหว่างผู้ใบ้คิดคำ ยังไม่มีใครทาย — ให้ทายรอบนี้ได้เลย ไม่ต้องรอรอบหน้า
    activatePending(room);
    syncLedger(room);
    const others = eligiblePlayers(room).filter(p => p.playerId !== state.giverId);
    if (state.variant === 'teams') {
        state.guesserIds = others.filter(p => p.team === state.activeTeam).map(p => p.playerId);
        state.opponentIds = others.filter(p => p.team !== state.activeTeam).map(p => p.playerId);
    } else {
        state.guesserIds = others.map(p => p.playerId);
        state.opponentIds = [];
    }
    state.players.forEach(p => {
        p.pin = null;
        p.pinRound = state.round;
        p.locked = false;
        p.autoLocked = false;
    });
    state.dial = isShared(state) ? PIN_CENTER : null;
    state.dialBy = null;
    state.agreeIds = [];
    state.lrVotes = [];
    state.phase = 'guess';
    state.giverAwayAt = null;
    state.phaseEndsAt = clockOf(env) + (isShared(state) ? TEAM_GUESS_MS : GUESS_MS);
    bumpStep(room);
    const giver = getPlayer(room, playerId);
    pushHistory(room, '💬', `${giver ? giver.name : 'ผู้ใบ้'} ใบ้ว่า “${state.clue}” (${state.card.left} ↔ ${state.card.right})`, 'clue', env);
    pushFx(room, { kind: 'clue', round: state.round });
    return state;
}

// ---------- คนทาย ----------

function assertGuesser(room, playerId, context) {
    const state = assertPlaying(room);
    assertRound(state, context);
    if (state.phase !== 'guess') throw new Error('ตอนนี้ยังไม่ใช่ช่วงทาย');
    if (playerId === state.giverId) throw new Error('ผู้ใบ้ทายไม่ได้');
    if (!state.guesserIds.includes(playerId)) {
        if ((state.opponentIds || []).includes(playerId)) throw new Error('ตานี้ทีมโน้นหมุนเข็ม — รอทาย ⬅️/➡️');
        throw new Error('คุณเข้ามากลางรอบ รอบหน้าได้ทายนะ');
    }
    const player = getPlayer(room, playerId);
    if (!player) throw new Error('ไม่พบผู้เล่น');
    return { state, player };
}

/** เดี่ยว: ขยับเข็มตัวเอง (ลับ) · ทีม/ร่วมมือ: หมุนเข็มร่วม (ทุกคนเห็น) ขยับแล้ว ✅ ทุกคนหาย */
function movePin(room, playerId, value, context = null) {
    const { state, player } = assertGuesser(room, playerId, context);
    const pin = clampPin(value);
    if (isShared(state)) {
        if (pin == null) throw new Error('ตำแหน่งเข็มไม่ถูกต้อง');
        const changed = state.dial == null || Math.abs(pin - state.dial) >= 0.05;
        state.dial = pin;
        state.dialBy = playerId;
        const cleared = changed && state.agreeIds.length > 0;
        if (cleared) {
            state.agreeIds = [];
            bumpStep(room);
        }
        return { state, shared: true, changed, cleared };
    }
    if (player.locked) throw new Error('ล็อกคำตอบแล้ว');
    if (pin == null) throw new Error('ตำแหน่งเข็มไม่ถูกต้อง');
    player.pin = pin;
    player.pinRound = state.round;
    return state;
}

function onlineGuessers(room) {
    const state = room.gameState;
    return state.guesserIds
        .map(id => getPlayer(room, id))
        .filter(p => p && isOnline(room, p.playerId));
}

function everyoneLocked(room) {
    const state = room.gameState;
    const online = onlineGuessers(room);
    if (isShared(state)) return online.length > 0 && online.every(p => state.agreeIds.includes(p.playerId));
    return online.length > 0 && online.every(p => p.locked);
}

/** ทีม/ร่วมมือ: เข็มร่วมล็อกแล้ว → ทีมโน้นทาย ⬅️/➡️ (ถ้ามีใครออนไลน์) หรือเปิดเป้าเลย */
function lockDial(room, env = null) {
    const state = room.gameState;
    if (state.dial == null) state.dial = PIN_CENTER;
    if (state.variant === 'teams') {
        state.opponentIds = (state.opponentIds || []).filter(id => getPlayer(room, id) && isPresent(room, getPlayer(room, id)));
        const anyOnline = state.opponentIds.some(id => isOnline(room, id));
        if (anyOnline) {
            state.phase = 'leftright';
            state.lrVotes = [];
            state.phaseEndsAt = clockOf(env) + LR_MS;
            bumpStep(room);
            pushHistory(room, '🔒', `${TEAM_META[state.activeTeam].name}ล็อกเข็มที่ ${Math.round(state.dial)} — ${TEAM_META[otherTeam(state.activeTeam)].name}ทาย ⬅️/➡️`, null, env);
            pushFx(room, { kind: 'dialLock', round: state.round });
            return state;
        }
    }
    return revealRound(room, env);
}

function lockPin(room, playerId, value, context = null, env = null) {
    const { state, player } = assertGuesser(room, playerId, context);
    if (isShared(state)) {
        // ✅ ตกลง = เห็นด้วยกับตำแหน่งนี้ (ถ้าเข็มในจอตัวเองต่างจากเซิร์ฟเวอร์ = หมุนไปตรงนั้นแล้วตกลง)
        const pin = value == null ? null : clampPin(value);
        if (pin != null && (state.dial == null || Math.abs(pin - state.dial) >= 0.05)) {
            state.dial = pin;
            state.dialBy = playerId;
            state.agreeIds = [];
        }
        if (state.dial == null) state.dial = PIN_CENTER;
        if (!state.agreeIds.includes(playerId)) state.agreeIds = [...state.agreeIds, playerId];
        bumpStep(room);
        pushFx(room, { kind: 'lock', playerId });
        if (everyoneLocked(room)) return lockDial(room, env);
        return state;
    }
    if (player.locked) throw new Error('ล็อกคำตอบแล้ว');
    const pin = value == null ? player.pin : clampPin(value);
    player.pin = pin == null ? PIN_CENTER : pin;
    player.pinRound = state.round;
    player.locked = true;
    player.autoLocked = false;
    bumpStep(room);
    pushFx(room, { kind: 'lock', playerId });
    if (everyoneLocked(room)) return revealRound(room, env);
    return state;
}

function unlockPin(room, playerId, context = null) {
    const { state, player } = assertGuesser(room, playerId, context);
    if (isShared(state)) {
        if (!state.agreeIds.includes(playerId)) throw new Error('ยังไม่ได้กดตกลง');
        state.agreeIds = state.agreeIds.filter(id => id !== playerId);
        bumpStep(room);
        return state;
    }
    if (!player.locked) throw new Error('ยังไม่ได้ล็อก');
    player.locked = false;
    bumpStep(room);
    return state;
}

// ---------- ทีมโน้นทาย ซ้าย/ขวา ----------

function onlineOpponents(room) {
    const state = room.gameState;
    return (state.opponentIds || []).filter(id => getPlayer(room, id) && isOnline(room, id));
}

function everyoneVoted(room) {
    const state = room.gameState;
    const online = onlineOpponents(room);
    const voted = new Set((state.lrVotes || []).map(v => v.playerId));
    return online.length > 0 && online.every(id => voted.has(id));
}

/** เสียงข้างมาก · เสมอ = ข้างที่มีคนโหวตก่อน · ไม่มีใครโหวต = null */
function lrChoice(state) {
    const votes = state.lrVotes || [];
    if (!votes.length) return null;
    const left = votes.filter(v => v.side === 'left').length;
    const right = votes.length - left;
    if (left !== right) return left > right ? 'left' : 'right';
    return votes[0].side;
}

function voteSide(room, playerId, side, context = null, env = null) {
    const state = assertPlaying(room);
    assertRound(state, context);
    if (state.phase !== 'leftright') throw new Error('ตอนนี้ยังไม่ใช่ช่วงทายซ้าย/ขวา');
    if (!(state.opponentIds || []).includes(playerId)) throw new Error('ทีมโน้นเป็นคนทายซ้าย/ขวา');
    if (side !== 'left' && side !== 'right') throw new Error('เลือก ⬅️ หรือ ➡️');
    state.lrVotes = [...(state.lrVotes || []).filter(v => v.playerId !== playerId), { playerId, side }];
    bumpStep(room);
    pushFx(room, { kind: 'vote', playerId });
    if (everyoneVoted(room)) return revealRound(room, env);
    return state;
}

// ---------- เปิดเป้า ----------

function teamScores(state) {
    return state.teams ? { A: state.teams.A.score, B: state.teams.B.score } : null;
}

/** นับตาที่เพิ่งเล่น: ทีมถัดไป · ตาพิเศษ (เป๊ะแต่ยังตามหลัง) · ถึง 10 / ต่อตาย · ร่วมมือ: การ์ดหมด */
function settleTurn(room, points) {
    const state = room.gameState;
    if (state.variant === 'coop') {
        const c = state.coop;
        c.played += 1;
        if (c.played >= c.total + c.bonus) state.pendingEnd = { reason: 'การ์ดหมดแล้ว — จบเกม' };
        return { catchUp: false };
    }
    if (state.variant !== 'teams') return { catchUp: false };
    const t = state.activeTeam;
    const o = otherTeam(t);
    const a = state.teams.A.score;
    const b = state.teams.B.score;
    let catchUp = points === 4 && !state.suddenDeath && state.teams[t].score < state.teams[o].score;
    if (state.suddenDeath) {
        state.suddenDeath.turns += 1;
        if (state.suddenDeath.turns >= 2) {
            if (a !== b) state.pendingEnd = { winner: a > b ? 'A' : 'B', reason: `${TEAM_META[a > b ? 'A' : 'B'].name}ชนะต่อตาย!` };
            else state.suddenDeath = { turns: 0, rounds: (state.suddenDeath.rounds || 1) + 1 };
        }
    } else if (Math.max(a, b) >= WIN_SCORE) {
        if (a !== b) state.pendingEnd = { winner: a > b ? 'A' : 'B', reason: `${TEAM_META[a > b ? 'A' : 'B'].name}ถึง ${WIN_SCORE} แต้มก่อน — ชนะ!` };
        else state.suddenDeath = { turns: 0, rounds: 1 };
    }
    if (state.pendingEnd) catchUp = false;
    state.nextTeam = catchUp ? t : o;
    state.nextCatchUp = catchUp;
    return { catchUp, suddenDeathStarted: !!(state.suddenDeath && state.suddenDeath.turns === 0) };
}

function revealShared(room, env) {
    const state = room.gameState;
    if (state.dial == null) state.dial = PIN_CENTER;
    const dial = state.dial;
    const scored = scorePin(dial, state.target);
    const giver = getPlayer(room, state.giverId);
    const giverName = giver ? giver.name : (state.ledger[state.giverId] && state.ledger[state.giverId].name) || 'ผู้ใบ้';
    eligiblePlayers(room).forEach(p => { p.roundsPlayed += 1; });
    if (giver && scored.points === 4) giver.bullseyes = (giver.bullseyes || 0) + 1;
    let gained = scored.points;
    let lr = null;
    let teamMeta = null;
    if (state.variant === 'teams') {
        const t = state.activeTeam;
        const o = otherTeam(t);
        teamMeta = { id: t, ...TEAM_META[t] };
        state.teams[t].score += scored.points;
        const choice = lrChoice(state);
        const correct = !!choice && ((choice === 'left' && state.target < dial) || (choice === 'right' && state.target > dial));
        const lrPoints = correct && scored.points !== 4 ? 1 : 0;
        state.teams[o].score += lrPoints;
        lr = {
            team: o,
            choice,
            left: (state.lrVotes || []).filter(v => v.side === 'left').length,
            right: (state.lrVotes || []).filter(v => v.side === 'right').length,
            correct,
            blocked: correct && scored.points === 4,
            points: lrPoints
        };
    } else {
        // ร่วมมือ: เป๊ะได้ 3 + การ์ดโบนัส 1 ใบ
        gained = scored.points === 4 ? 3 : scored.points;
        state.coop.score += gained;
        if (scored.points === 4) state.coop.bonus += 1;
    }
    const settle = settleTurn(room, scored.points);
    const entry = state.variant === 'teams'
        ? { playerId: 'team:' + state.activeTeam, name: teamMeta.name, color: teamMeta.color, avatar: teamMeta.icon, avatarFrame: 'none' }
        : { playerId: 'team:all', name: 'ทุกคน', color: '#5eead4', avatar: '🤝', avatarFrame: 'none' };
    const results = [{ ...entry, pin: dial, distance: scored.distance, points: scored.points, label: scored.label, auto: false }];
    state.lastRound = {
        round: state.round,
        variant: state.variant,
        skipped: false,
        reason: null,
        giverId: state.giverId,
        giverName,
        card: state.card,
        clue: state.clue,
        target: state.target,
        dial,
        team: state.variant === 'teams' ? state.activeTeam : null,
        catchUpTurn: !!state.catchUp,
        points: scored.points,
        gained,
        label: scored.label,
        distance: scored.distance,
        lr,
        catchUpNext: settle.catchUp,
        suddenDeath: !!state.suddenDeath,
        end: state.pendingEnd ? { ...state.pendingEnd } : null,
        scores: teamScores(state),
        coop: state.coop ? { ...state.coop, bonusNow: scored.points === 4 } : null,
        giverPoints: 0,
        results
    };
    state.rounds = [...(state.rounds || []), {
        round: state.round,
        giverId: state.giverId,
        giverName,
        team: state.lastRound.team,
        card: state.card,
        clue: state.clue,
        target: state.target,
        dial,
        points: scored.points,
        gained,
        lrPoints: lr ? lr.points : 0,
        giverPoints: 0,
        best: null
    }].slice(-30);
    state.phase = 'reveal';
    state.readyIds = [];
    state.phaseEndsAt = clockOf(env) + REVEAL_MS;
    bumpStep(room);
    syncLedger(room);
    const who = state.variant === 'teams' ? TEAM_META[state.activeTeam].name : 'ทุกคน';
    const lrText = lr && lr.choice ? ` · ${TEAM_META[lr.team].name}ทาย${lr.choice === 'left' ? 'ซ้าย' : 'ขวา'} ${lr.points ? '+1' : (lr.blocked ? 'ถูกแต่เป๊ะ = 0' : 'ผิด')}` : '';
    pushHistory(room, '🎯', `เปิดเป้า ${state.target} — ${who} ${scored.label} +${gained}${lrText}${settle.catchUp ? ' · 🔁 ตาพิเศษ!' : ''}`, 'reveal', env);
    pushFx(room, { kind: 'reveal', round: state.round });
    return state;
}

function revealRound(room, env = null) {
    const state = room.gameState;
    if (isShared(state)) return revealShared(room, env);
    const results = [];
    state.guesserIds.forEach(id => {
        const p = getPlayer(room, id);
        if (!p) return; // ออกจากห้องไปแล้ว
        let auto = false;
        if (!p.locked) {
            auto = true;
            if (p.pin == null || p.pinRound !== state.round) {
                // ยังไม่ขยับเข็ม: ออนไลน์อยู่ = เข็มค้างกลางหน้าปัด · หลุด = ไม่ได้ทาย
                p.pin = isOnline(room, p.playerId) ? PIN_CENTER : null;
            }
            p.locked = p.pin != null;
            p.autoLocked = p.pin != null;
        }
        const scored = scorePin(p.pin, state.target);
        if (p.pin != null) {
            p.score += scored.points;
            p.roundsPlayed += 1;
            if (scored.points === 4) p.bullseyes = (p.bullseyes || 0) + 1;
        }
        results.push({
            playerId: p.playerId,
            name: p.name,
            color: p.color,
            avatar: p.avatar,
            avatarFrame: p.avatarFrame,
            pin: p.pin,
            distance: scored.distance,
            points: scored.points,
            label: scored.label,
            auto
        });
    });
    const guessed = results.filter(r => r.pin != null);
    const giverPoints = guessed.length
        ? Math.round(guessed.reduce((sum, r) => sum + r.points, 0) / guessed.length)
        : 0;
    const giver = getPlayer(room, state.giverId);
    if (giver) {
        giver.score += giverPoints;
        giver.roundsPlayed += 1;
    }
    results.sort((a, b) => b.points - a.points || (a.distance ?? 999) - (b.distance ?? 999));

    state.lastRound = {
        round: state.round,
        skipped: false,
        reason: null,
        giverId: state.giverId,
        giverName: giver ? giver.name : (state.ledger[state.giverId] && state.ledger[state.giverId].name) || 'ผู้ใบ้',
        card: state.card,
        clue: state.clue,
        target: state.target,
        giverPoints,
        results
    };
    state.rounds = [...(state.rounds || []), {
        round: state.round,
        giverId: state.giverId,
        giverName: state.lastRound.giverName,
        card: state.card,
        clue: state.clue,
        target: state.target,
        giverPoints,
        best: results[0] ? { name: results[0].name, points: results[0].points } : null
    }].slice(-30);
    state.phase = 'reveal';
    state.readyIds = [];
    state.phaseEndsAt = clockOf(env) + REVEAL_MS;
    bumpStep(room);
    syncLedger(room);
    const bulls = results.filter(r => r.points === 4).map(r => r.name);
    pushHistory(room, '🎯', `เปิดเป้า ${state.target} — ${bulls.length ? 'เป๊ะ: ' + bulls.join(', ') : 'ไม่มีใครเป๊ะ'} · ผู้ใบ้ได้ ${giverPoints}`, 'reveal', env);
    pushFx(room, { kind: 'reveal', round: state.round });
    return state;
}

function skipRound(room, reason, env = null) {
    const state = room.gameState;
    const giver = getPlayer(room, state.giverId);
    // ทีม: ข้ามตา = เสียตานั้น ส่งให้ทีมโน้น · ร่วมมือ: เสียการ์ด 1 ใบ
    if (isShared(state)) eligiblePlayers(room).forEach(p => { p.roundsPlayed += 1; });
    const settle = settleTurn(room, 0);
    state.lastRound = {
        round: state.round,
        variant: state.variant,
        team: state.variant === 'teams' ? state.activeTeam : null,
        catchUpNext: settle.catchUp,
        suddenDeath: !!state.suddenDeath,
        end: state.pendingEnd ? { ...state.pendingEnd } : null,
        scores: teamScores(state),
        coop: state.coop ? { ...state.coop, bonusNow: false } : null,
        skipped: true,
        reason,
        giverId: state.giverId,
        giverName: giver ? giver.name : (state.ledger[state.giverId] && state.ledger[state.giverId].name) || 'ผู้ใบ้',
        card: state.card,
        clue: null,
        target: state.target,
        giverPoints: 0,
        results: []
    };
    state.guesserIds = [];
    state.opponentIds = [];
    state.agreeIds = [];
    state.lrVotes = [];
    state.phase = 'reveal';
    state.readyIds = [];
    state.giverAwayAt = null;
    state.phaseEndsAt = clockOf(env) + SKIP_MS;
    bumpStep(room);
    syncLedger(room);
    pushHistory(room, '⏭️', `ข้ามรอบ ${state.round} — ${reason}`, 'skip', env);
    pushFx(room, { kind: 'skip', round: state.round });
    return state;
}

/** คนที่ต้องกดพร้อม — ไม่นับหัวห้อง (หัวห้องกด "รอบต่อไป" = ไปเลย) เว้นแต่หัวห้องอยู่คนเดียว */
function readyTargets(room) {
    const online = eligiblePlayers(room).filter(p => isOnline(room, p.playerId));
    const others = online.filter(p => p.playerId !== room.admin);
    return others.length ? others : online;
}

function maybeAdvanceReady(room, env) {
    const state = room.gameState;
    if (state.phase !== 'reveal' || !(state.readyIds || []).length) return state;
    const targets = readyTargets(room);
    if (targets.length && targets.every(p => state.readyIds.includes(p.playerId))) {
        return startRound(room, env);
    }
    return state;
}

function nextRound(room, playerId, context = null, env = null) {
    const state = assertPlaying(room);
    assertRound(state, context);
    if (state.phase !== 'reveal') throw new Error('ยังไม่จบรอบนี้');
    if (room.admin === playerId) return startRound(room, env);
    const player = getPlayer(room, playerId);
    if (!player || !player.active) throw new Error('รอบหน้าคุณได้เล่นด้วย รอสักครู่');
    if (!state.readyIds.includes(playerId)) state.readyIds = [...state.readyIds, playerId];
    bumpStep(room);
    return maybeAdvanceReady(room, env);
}

/**
 * ข้ามจังหวะที่รออยู่ (ไม่ต้องรอนาฬิกา):
 *   ผู้ใบ้ช่วงคิดคำ = ขอข้ามตาตัวเอง (ผลเหมือนคิดไม่ทัน)
 *   หัวห้อง ช่วงคิดคำ = ข้ามตาผู้ใบ้ · ช่วงทาย = เปิดเป้าเลย (คนที่ยังไม่ล็อก ล็อกตรงที่เข็มอยู่ เหมือนหมดเวลา)
 */
function skipPhase(room, playerId, context = null, env = null) {
    const state = assertPlaying(room);
    assertRound(state, context);
    const isHost = room.admin === playerId;
    const actor = getPlayer(room, playerId);
    if (state.phase === 'clue') {
        if (state.giverId === playerId) return skipRound(room, `${actor ? actor.name : 'ผู้ใบ้'} ขอข้ามตา`, env);
        if (isHost) return skipRound(room, 'หัวห้องข้ามตานี้', env);
        throw new Error('มีแค่ผู้ใบ้หรือหัวห้องที่ข้ามตาได้');
    }
    if (state.phase === 'guess') {
        if (!isHost) throw new Error('มีแค่หัวห้องที่เปิดเป้าก่อนเวลาได้');
        if (isShared(state)) {
            pushHistory(room, '⏩', 'หัวห้องล็อกเข็มก่อนหมดเวลา', null, env);
            return lockDial(room, env);
        }
        pushHistory(room, '⏩', 'หัวห้องเปิดเป้าก่อนหมดเวลา', null, env);
        return revealRound(room, env);
    }
    if (state.phase === 'leftright') {
        if (!isHost) throw new Error('มีแค่หัวห้องที่เปิดเป้าก่อนเวลาได้');
        pushHistory(room, '⏩', 'หัวห้องเปิดเป้าก่อนหมดเวลา', null, env);
        return revealRound(room, env);
    }
    throw new Error('ตอนนี้ไม่มีอะไรให้ข้าม');
}

// ---------- จบเกม ----------

function computeStandings(room, winnerTeam = null) {
    syncLedger(room);
    const state = room.gameState;
    if (isShared(state)) {
        const played = Object.values(state.ledger || {})
            .filter(row => row.roundsPlayed > 0 || row.gives > 0)
            .map(row => ({ ...row }));
        if (state.variant === 'coop') {
            const score = state.coop ? state.coop.score : 0;
            return played
                .map(row => ({ ...row, score, rank: 1, won: score >= COOP_WIN_SCORE }))
                .sort((a, b) => b.bullseyes - a.bullseyes || a.name.localeCompare(b.name, 'th'));
        }
        const scores = teamScores(state) || { A: 0, B: 0 };
        // หัวห้องจบเองกลางทาง: ทีมนำชนะ · เสมอ = ชนะร่วม
        const winners = winnerTeam ? [winnerTeam] : (scores.A === scores.B ? ['A', 'B'] : [scores.A > scores.B ? 'A' : 'B']);
        return played
            .filter(row => row.team)
            .map(row => {
                const won = winners.includes(row.team);
                return { ...row, score: scores[row.team] || 0, teamName: TEAM_META[row.team].name, won, rank: won ? 1 : 2 };
            })
            .sort((a, b) => a.rank - b.rank || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0) || b.bullseyes - a.bullseyes);
    }
    const rows = Object.values(room.gameState.ledger || {})
        .filter(row => row.roundsPlayed > 0 || row.gives > 0)
        .map(row => ({ ...row }))
        .sort((a, b) => b.score - a.score || b.bullseyes - a.bullseyes || a.name.localeCompare(b.name, 'th'));
    let rank = 0;
    let prevScore = null;
    rows.forEach((row, index) => {
        if (row.score !== prevScore) {
            rank = index + 1;
            prevScore = row.score;
        }
        row.rank = rank;
    });
    const top = rows.length ? rows[0].score : 0;
    rows.forEach(row => { row.won = top > 0 && row.score === top; });
    return rows;
}

function finishGame(room, reason = null, env = null) {
    const state = room.gameState;
    state.phase = 'finished';
    state.status = 'wavelength_finished';
    state.phaseEndsAt = null;
    state.guesserIds = [];
    state.readyIds = [];
    state.giverAwayAt = null;
    state.agreeIds = [];
    state.opponentIds = [];
    state.lrVotes = [];
    const winnerTeam = state.pendingEnd && state.pendingEnd.winner ? state.pendingEnd.winner : null;
    state.standings = computeStandings(room, winnerTeam);
    state.winners = state.standings.filter(row => row.won).map(row => ({ playerId: row.playerId, name: row.name, score: row.score, team: row.team || null }));
    if (state.variant === 'teams') {
        const scores = teamScores(state);
        state.winnerTeam = winnerTeam || (scores.A === scores.B ? null : (scores.A > scores.B ? 'A' : 'B'));
    }
    if (state.variant === 'coop') state.coopRank = coopRank(state.coop ? state.coop.score : 0).text;
    state.pendingEnd = null;
    bumpStep(room);
    pushHistory(room, '🏁', reason || 'ครบทุกคนแล้ว — จบเกม', 'finished', env);
    pushFx(room, { kind: 'finished' });
    return state;
}

function endGame(room, playerId, env = null) {
    assertPlaying(room);
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่จบเกมได้');
    return finishGame(room, 'หัวห้องจบเกม', env);
}

// ---------- เวลา / คนหลุด / คนออก ----------

/** เรียกเมื่อมีคนหลุด/ต่อกลับ — คุมเวลาผ่อนผันผู้ใบ้ และเปิดเป้าเมื่อคนที่ออนไลน์ล็อกครบ */
function refreshPresence(room, env = null) {
    const state = room.gameState;
    if (!state || state.mode !== MODE || state.status !== 'playing') return false;
    const now = clockOf(env);
    if (state.phase === 'clue') {
        const before = state.phaseEndsAt;
        if (isOnline(room, state.giverId)) state.giverAwayAt = null;
        else if (!state.giverAwayAt) state.giverAwayAt = now;
        state.phaseEndsAt = clueEndsAt(state);
        if (state.phaseEndsAt !== before) bumpStep(room);
        return state.phaseEndsAt !== before;
    }
    if (state.phase === 'guess' && everyoneLocked(room)) {
        if (isShared(state)) lockDial(room, env);
        else revealRound(room, env);
        return true;
    }
    if (state.phase === 'leftright' && everyoneVoted(room)) {
        revealRound(room, env);
        return true;
    }
    if (state.phase === 'reveal') {
        const round = state.round;
        maybeAdvanceReady(room, env);
        return state.round !== round || state.phase !== 'reveal';
    }
    return false;
}

function autoResolvePhase(room, env = null) {
    const state = room.gameState;
    if (!state || state.mode !== MODE || state.status !== 'playing') return state;
    const now = clockOf(env);
    if (state.phaseEndsAt && now < state.phaseEndsAt) return state;
    if (state.phase === 'clue') {
        if (isOnline(room, state.giverId) && now < state.clueDeadline) {
            // ผู้ใบ้กลับมาทันก่อนหมดเวลาจริง — เดินนาฬิกาเดิมต่อ
            state.giverAwayAt = null;
            state.phaseEndsAt = state.clueDeadline;
            bumpStep(room);
            return state;
        }
        const giver = getPlayer(room, state.giverId);
        const reason = now >= state.clueDeadline
            ? `${giver ? giver.name : 'ผู้ใบ้'} คิดคำใบ้ไม่ทัน`
            : `${giver ? giver.name : 'ผู้ใบ้'} หลุดการเชื่อมต่อ`;
        return skipRound(room, reason, env);
    }
    if (state.phase === 'guess') return isShared(state) ? lockDial(room, env) : revealRound(room, env);
    if (state.phase === 'leftright') return revealRound(room, env);
    if (state.phase === 'reveal') return startRound(room, env);
    return state;
}

/** เรียกหลัง roomManager.leaveRoom ตัดผู้เล่นออกจาก gameState.players แล้ว */
function handlePlayerLeft(room, playerId, env = null) {
    const state = room.gameState;
    if (!state || state.mode !== MODE || state.status !== 'playing') return state;
    syncLedger(room);
    const row = state.ledger[playerId];
    if (row) pushHistory(room, '🚪', `${row.name} ออกจากห้อง`, null, env);

    if (eligiblePlayers(room).length < 2) {
        return finishGame(room, 'ผู้เล่นเหลือไม่พอ — จบเกม', env);
    }
    if (state.phase === 'clue' && state.giverId === playerId) {
        return skipRound(room, `${row ? row.name : 'ผู้ใบ้'} ออกจากห้อง`, env);
    }
    if (state.phase === 'guess') {
        state.guesserIds = state.guesserIds.filter(id => id !== playerId);
        state.opponentIds = (state.opponentIds || []).filter(id => id !== playerId);
        state.agreeIds = (state.agreeIds || []).filter(id => id !== playerId);
        const done = isShared(state) ? lockDial : revealRound;
        if (!state.guesserIds.length) return done(room, env);
        if (everyoneLocked(room)) return done(room, env);
        bumpStep(room);
        return state;
    }
    if (state.phase === 'leftright') {
        state.guesserIds = state.guesserIds.filter(id => id !== playerId);
        state.opponentIds = (state.opponentIds || []).filter(id => id !== playerId);
        state.lrVotes = (state.lrVotes || []).filter(v => v.playerId !== playerId);
        if (!state.opponentIds.length || everyoneVoted(room)) return revealRound(room, env);
        bumpStep(room);
        return state;
    }
    if (state.phase === 'reveal') {
        state.readyIds = (state.readyIds || []).filter(id => id !== playerId);
        return maybeAdvanceReady(room, env);
    }
    return state;
}

// ---------- ส่งให้ client ----------

function getAvailableActions(room, viewerId) {
    const state = room.gameState;
    const playing = state.status === 'playing';
    const self = getPlayer(room, viewerId);
    const isGiver = playing && state.giverId === viewerId;
    const isGuesser = playing && state.phase === 'guess' && state.guesserIds.includes(viewerId);
    const shared = isShared(state);
    const agreed = (state.agreeIds || []).includes(viewerId);
    return {
        canPickCard: isGiver && state.phase === 'clue',
        canReroll: isGiver && state.phase === 'clue' && !state.rerollUsed,
        canSubmitClue: isGiver && state.phase === 'clue' && !!state.card,
        canGuess: !shared && isGuesser && !!self && !self.locked,
        canUnlock: !shared && isGuesser && !!self && self.locked,
        canDial: shared && isGuesser && !!self,
        canAgree: shared && isGuesser && !!self && !agreed,
        canUnagree: shared && isGuesser && !!self && agreed,
        canVote: playing && state.phase === 'leftright' && (state.opponentIds || []).includes(viewerId) && !!self,
        canNext: playing && state.phase === 'reveal' && room.admin === viewerId,
        canReady: playing && state.phase === 'reveal' && room.admin !== viewerId && !!self && self.active
            && !(state.readyIds || []).includes(viewerId),
        canEnd: playing && room.admin === viewerId,
        canSkipTurn: isGiver && state.phase === 'clue',
        canHostSkip: playing && room.admin === viewerId && (state.phase === 'clue' || state.phase === 'guess' || state.phase === 'leftright')
    };
}

function buildClientState(room, viewerId) {
    const state = room.gameState && room.gameState.mode === MODE ? room.gameState : createInitialState();
    const viewer = getPlayer(room, viewerId);
    const isGiver = state.giverId === viewerId && state.status === 'playing';
    const open = state.phase === 'reveal' || state.phase === 'finished';
    const giverSees = isGiver && (state.phase === 'clue' || state.phase === 'guess' || state.phase === 'leftright');
    const guessing = state.phase === 'guess';
    const midRound = state.phase === 'guess' || state.phase === 'leftright';
    const cardVisible = midRound || state.phase === 'reveal' || (isGiver && state.phase === 'clue');
    const shared = isShared(state);
    const votes = state.phase === 'leftright' || state.phase === 'reveal' ? (state.lrVotes || []) : [];
    const voteOf = id => { const v = votes.find(x => x.playerId === id); return v ? v.side : null; };

    const players = (state.players || []).map(p => ({
        playerId: p.playerId,
        name: p.name,
        color: p.color,
        avatar: p.avatar,
        avatarFrame: p.avatarFrame,
        score: p.score,
        gives: p.gives,
        active: !!p.active,
        online: isOnline(room, p.playerId),
        isSelf: p.playerId === viewerId,
        isGiver: p.playerId === state.giverId && state.status === 'playing',
        isGuesser: guessing && state.guesserIds.includes(p.playerId),
        locked: guessing && state.guesserIds.includes(p.playerId) ? (shared ? (state.agreeIds || []).includes(p.playerId) : !!p.locked) : false,
        isOpponent: state.phase === 'leftright' && (state.opponentIds || []).includes(p.playerId),
        vote: state.phase === 'leftright' && (state.opponentIds || []).includes(p.playerId) ? voteOf(p.playerId) : null,
        team: p.team || null,
        ready: state.phase === 'reveal' && (state.readyIds || []).includes(p.playerId)
    }));
    const teams = state.variant === 'teams' && state.teams ? TEAM_IDS.map(id => ({
        id,
        name: TEAM_META[id].name,
        icon: TEAM_META[id].icon,
        color: TEAM_META[id].color,
        score: state.teams[id].score,
        active: state.status === 'playing' && state.activeTeam === id,
        members: players.filter(p => p.team === id && p.active).map(p => p.playerId)
    })) : null;

    const ledgerRows = Object.values(state.ledger || {});
    const scoreboard = ledgerRows
        .map(row => {
            const live = getPlayer(room, row.playerId);
            return {
                playerId: row.playerId,
                name: live ? live.name : row.name,
                color: live ? live.color : row.color,
                avatar: live ? live.avatar : row.avatar,
                avatarFrame: live ? live.avatarFrame : row.avatarFrame,
                score: live ? live.score : row.score,
                left: !live
            };
        })
        .sort((a, b) => b.score - a.score);

    return {
        mode: MODE,
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        round: state.round,
        roundsTotal: state.variant === 'teams' ? null : (state.status === 'playing' ? state.round + remainingTurns(room) : state.round),
        laps: state.laps,
        variant: state.variant || DEFAULT_VARIANT,
        goal: WIN_SCORE,
        teams,
        activeTeam: state.variant === 'teams' ? state.activeTeam : null,
        catchUp: !!state.catchUp,
        suddenDeath: !!state.suddenDeath,
        winnerTeam: state.phase === 'finished' ? (state.winnerTeam || null) : null,
        // เข็มร่วม: ทุกคนเห็น (บอร์ดเกมจริงก็เห็น) · ไม่ใช่ความลับ
        dial: shared && (midRound || state.phase === 'reveal') ? state.dial : null,
        dialBy: shared && midRound ? state.dialBy : null,
        agreeIds: shared && guessing ? (state.agreeIds || []) : [],
        opponentIds: midRound ? (state.opponentIds || []) : [],
        lrVotes: votes.map(v => ({ playerId: v.playerId, side: v.side })),
        coop: state.coop ? { ...state.coop, rank: coopRank(state.coop.score).text, winScore: COOP_WIN_SCORE } : null,
        coopChart: state.variant === 'coop' ? COOP_CHART : null,
        coopRank: state.phase === 'finished' ? (state.coopRank || null) : null,
        phaseEndsAt: state.phaseEndsAt,
        clueDeadline: state.phase === 'clue' ? state.clueDeadline : null,
        giverAway: state.phase === 'clue' && !!state.giverAwayAt,
        giverId: state.status === 'playing' ? state.giverId : null,
        giverName: (getPlayer(room, state.giverId) || state.ledger[state.giverId] || {}).name || null,
        isHost: room.admin === viewerId,
        timers: { clue: CLUE_MS, guess: shared ? TEAM_GUESS_MS : GUESS_MS, leftright: LR_MS, reveal: REVEAL_MS, skip: SKIP_MS, grace: GRACE_MS },
        bands: BANDS.map(b => ({ points: b.points, halfWidth: b.halfWidth, label: b.label })),
        maxClueLength: MAX_CLUE_LENGTH,
        options: isGiver && state.phase === 'clue' ? state.options : [],
        rerollUsed: !!state.rerollUsed,
        card: cardVisible ? state.card : null,
        clue: midRound || state.phase === 'reveal' ? state.clue : null,
        // เป้าลับ — ผู้ใบ้เห็นคนเดียวจนกว่าจะเปิด
        target: giverSees ? state.target : (open && state.lastRound ? state.lastRound.target : null),
        lastRound: open ? state.lastRound : null,
        readyIds: state.phase === 'reveal' ? (state.readyIds || []) : [],
        readyNeeded: state.phase === 'reveal' && state.status === 'playing' ? readyTargets(room).map(p => p.playerId) : [],
        self: viewer ? {
            playerId: viewer.playerId,
            active: !!viewer.active,
            pending: !viewer.active && state.status === 'playing',
            isGiver,
            isGuesser: guessing && state.guesserIds.includes(viewerId),
            isOpponent: midRound && (state.opponentIds || []).includes(viewerId),
            team: viewer.team || null,
            vote: voteOf(viewerId),
            pin: shared ? null : (viewer.pinRound === state.round ? viewer.pin : null),
            locked: guessing ? (shared ? (state.agreeIds || []).includes(viewerId) : !!viewer.locked) : false,
            score: viewer.score,
            gives: viewer.gives
        } : null,
        players,
        scoreboard,
        rounds: (state.rounds || []).slice(-12),
        standings: state.phase === 'finished' ? state.standings : null,
        winners: state.phase === 'finished' ? state.winners : null,
        history: (state.history || []).slice(0, 20),
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        availableActions: getAvailableActions(room, viewerId),
        fx: state.fx || []
    };
}

module.exports = {
    id: MODE,
    label: 'คลื่นความคิด',
    description: 'ผู้ใบ้เห็นเป้าลับบนหน้าปัด ใบ้ 1 คำ แล้วทีมช่วยกันหมุนเข็มทายว่าอยู่ตรงไหน — 3–12 คน',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    allowsLateJoin: true,
    BANDS,
    MAX_CLUE_LENGTH,
    PIN_CENTER,
    CARDS,
    timers: { CLUE_MS, GUESS_MS, TEAM_GUESS_MS, LR_MS, REVEAL_MS, SKIP_MS, GRACE_MS },
    VARIANTS,
    DEFAULT_VARIANT,
    TEAM_MIN_PLAYERS,
    WIN_SCORE,
    COOP_CARDS,
    COOP_CHART,
    COOP_WIN_SCORE,
    TEAM_META,
    clampVariant,
    coopRank,
    voteSide,
    lockDial,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    startRound,
    pickCard,
    rerollCards,
    submitClue,
    validateClue,
    cleanClue,
    movePin,
    lockPin,
    unlockPin,
    revealRound,
    skipRound,
    nextRound,
    skipPhase,
    endGame,
    finishGame,
    computeStandings,
    refreshPresence,
    autoResolvePhase,
    handlePlayerLeft,
    buildClientState,
    getAvailableActions,
    scorePin,
    clampPin,
    clampLaps,
    graphemeLength,
    isOnline
};
