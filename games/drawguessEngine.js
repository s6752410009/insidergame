/**
 * วาดแล้วทาย (Draw & Guess) — 3–12 คน แนว skribbl
 *
 * ทุกรอบ ทุกคนได้วาดคนละ 1 ตา ตามลำดับที่นั่ง (ตั้งได้ 2/3/4 รอบ)
 * ตาหนึ่ง: คนวาดเลือก 1 ใน 3 คำ (choose, 12 วิ ไม่เลือก = สุ่มให้) → วาด (draw, 60/80/100 วิ)
 *          คนอื่นพิมพ์ทาย · ทายถูกไม่โชว์คำ แค่ "✅ ชื่อ ทายถูก!" · ใกล้แล้วได้ "เกือบแล้ว!" เฉพาะตัว
 *          → เฉลย (reveal) พร้อมแต้มที่ได้ตานี้ → ตาถัดไป
 * แต้ม: ทายถูกเร็วได้มาก + โบนัสลำดับ (คนแรก/สอง/...) · คนวาดได้ต่อคนที่ทายถูก
 * ชนะ: แต้มรวมสูงสุดตอนจบ (เสมอ = ชนะร่วม)
 *
 * engine นี้บริสุทธิ์ — ไม่มี socket/timer · เวลาส่งเข้ามาเป็น now · สุ่มผ่าน setRandom() ได้ (เทสต์)
 * เส้นที่วาดเก็บใน gameState.canvas เฉพาะตาปัจจุบัน (จำกัดขนาด) ให้คนต่อใหม่/เข้ามาดูทีหลัง replay ได้
 */

const fs = require('fs');
const path = require('path');

const MODE = 'drawguess';
const LABEL = 'วาดแล้วทาย';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;

const ROUND_OPTIONS = [2, 3, 4];
const DEFAULT_ROUNDS = 3;
const DRAW_SECONDS_OPTIONS = [60, 80, 100];
const DEFAULT_DRAW_SECONDS = 80;

const CATEGORY_LIST = [
    { id: 'animals', name: 'สัตว์', icon: '🐘' },
    { id: 'food', name: 'อาหาร', icon: '🍜' },
    { id: 'objects', name: 'สิ่งของ', icon: '🎒' },
    { id: 'places', name: 'สถานที่', icon: '🏝️' },
    { id: 'jobs', name: 'อาชีพ', icon: '👩‍🍳' },
    { id: 'activities', name: 'กิจกรรม', icon: '🏸' },
    { id: 'nature', name: 'ธรรมชาติ', icon: '🌈' },
    { id: 'vehicles', name: 'ยานพาหนะ', icon: '🚲' }
];
const CATEGORY_BY_NAME = Object.fromEntries(CATEGORY_LIST.map(c => [c.name, c]));
const CATEGORY_BY_ID = Object.fromEntries(CATEGORY_LIST.map(c => [c.id, c]));

const CHOOSE_MS = Number(process.env.DRAWGUESS_CHOOSE_MS) || 12000;
const REVEAL_MS = Number(process.env.DRAWGUESS_REVEAL_MS) || 6000;
const SKIP_REVEAL_MS = Math.min(REVEAL_MS, 3500);
// คนวาดหลุด: รอกลับมาได้กี่วิก่อนข้ามตา (รีเฟรช/สลับแอปสั้น ๆ ไม่โดนข้าม)
const GRACE_MS = Number(process.env.DRAWGUESS_GRACE_MS) || 12000;
// ทดสอบเท่านั้น — บังคับเวลาวาด (มิลลิวินาที) แทนค่าที่ห้องตั้ง
const DRAW_MS_OVERRIDE = Number(process.env.DRAWGUESS_DRAW_MS) || 0;

const CHOICE_COUNT = 3;
const GUESS_MAX_LENGTH = 40;
const GUESS_COOLDOWN_MS = 350;
const FEED_LIMIT = 80;
const FEED_CLIENT_LIMIT = 50;
const HINT_MAX_RATIO = 0.4;
const HINT_START_RATIO = 0.3;
const ROOM_WORD_MEMORY = 300;

// แต้ม
const GUESS_MIN_POINTS = 60;
const GUESS_TIME_POINTS = 240;
const ORDER_BONUS = [50, 35, 20, 10];
const ORDER_BONUS_REST = 5;
const DRAWER_POINTS_PER_GUESS = 40;

// ผืนผ้าใบ
const COLOR_COUNT = 12;
const SIZE_COUNT = 4;
const MAX_OPS_PER_BATCH = 48;
const MAX_POINTS_PER_BATCH = 480;
const MAX_POINTS_PER_TURN = 15000;
const MAX_STROKES_PER_TURN = 1500;

// ---------------------------------------------------------------- rng

let random = Math.random;
function setRandom(fn) {
    random = typeof fn === 'function' ? fn : Math.random;
}
function randInt(n) {
    return Math.floor(random() * n);
}
function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = randInt(i + 1);
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

// ---------------------------------------------------------------- text

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'grapheme' })
    : null;

/** แยกตัวอักษรไทยเป็นกลุ่มที่เห็นเป็น 1 ตัว (พยัญชนะ+สระบน/ล่าง+วรรณยุกต์) */
function graphemes(text) {
    const value = String(text == null ? '' : text).normalize('NFC');
    if (segmenter) return Array.from(segmenter.segment(value), part => part.segment);
    return Array.from(value);
}

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const PUNCT_SPACE = /[\s\-_.,·'"!?()[\]{}~:;/\\|*+=<>@#$%^&`]+/g;

/** ทำคำทายให้เทียบได้: NFC · ตัดอักขระมองไม่เห็น ช่องว่าง เครื่องหมาย · ตัวเล็ก */
function normalizeGuess(text) {
    return String(text == null ? '' : text)
        .normalize('NFC')
        .replace(ZERO_WIDTH, '')
        .toLowerCase()
        .replace(PUNCT_SPACE, '');
}

function cleanText(text, maxLength) {
    return String(text == null ? '' : text)
        .normalize('NFC')
        .replace(ZERO_WIDTH, '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        for (let j = 1; j <= b.length; j += 1) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = cur;
    }
    return prev[b.length];
}

/**
 * ใกล้ถูก: ต่างกัน 1 ตัว (นับเป็นกลุ่มอักษร) หรือคำหนึ่งอยู่ในอีกคำ (ทั้งคู่ ≥ 3 ตัว)
 * คำทายที่มีคำตอบอยู่ข้างในนับว่าใกล้เสมอ — ไม่งั้นโชว์ให้ทั้งวงเห็นเท่ากับเฉลย
 */
function isCloseGuess(guessNorm, answerNorm) {
    if (!guessNorm || !answerNorm || guessNorm === answerNorm) return false;
    if (guessNorm.includes(answerNorm)) return true;
    const g = graphemes(guessNorm);
    const a = graphemes(answerNorm);
    if (a.length >= 2 && levenshtein(g, a) === 1) return true;
    if (Math.min(g.length, a.length) >= 3 && answerNorm.includes(guessNorm)) return true;
    return false;
}

// ---------------------------------------------------------------- words

function parseWordList(text) {
    const seen = new Set();
    return String(text || '')
        .split(/\r?\n/)
        .slice(1)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(',').map(cell => cell.trim()))
        .filter(cells => cells.length >= 2 && CATEGORY_BY_NAME[cells[0]] && cells[1])
        .map(([category, word, aliases]) => ({
            category: CATEGORY_BY_NAME[category].id,
            word: word.normalize('NFC'),
            aliases: String(aliases || '').split('|').map(a => a.trim().normalize('NFC')).filter(Boolean)
        }))
        .filter(entry => {
            if (seen.has(entry.word)) return false;
            seen.add(entry.word);
            return true;
        });
}

let WORDS = [];
try {
    WORDS = parseWordList(fs.readFileSync(path.join(__dirname, '..', 'words', 'drawguess-th.csv'), 'utf8'));
} catch (error) {
    WORDS = [];
}
if (WORDS.length < CHOICE_COUNT) {
    WORDS = [
        { category: 'animals', word: 'แมว', aliases: [] },
        { category: 'food', word: 'ไข่ดาว', aliases: [] },
        { category: 'objects', word: 'ร่ม', aliases: [] },
        { category: 'nature', word: 'ดวงอาทิตย์', aliases: ['พระอาทิตย์'] }
    ];
}
const WORD_BY_TEXT = new Map(WORDS.map(entry => [entry.word, entry]));

function sanitizeSettings(raw = {}) {
    const rounds = Number(raw.drawguessRounds);
    const seconds = Number(raw.drawguessSeconds);
    const category = String(raw.drawguessCategory || 'mixed');
    return {
        rounds: ROUND_OPTIONS.includes(rounds) ? rounds : DEFAULT_ROUNDS,
        drawSeconds: DRAW_SECONDS_OPTIONS.includes(seconds) ? seconds : DEFAULT_DRAW_SECONDS,
        category: CATEGORY_BY_ID[category] ? category : 'mixed'
    };
}

function wordPool(category) {
    return category && category !== 'mixed'
        ? WORDS.filter(entry => entry.category === category)
        : WORDS;
}

/** สุ่ม 3 คำที่เกมนี้ (และห้องนี้ ล่าสุด) ยังไม่เคยเสนอ — โหมดรวมพยายามให้คนละหมวด */
function pickChoices(room) {
    const state = room.gameState;
    const pool = wordPool(state.settings?.category);
    const usedInGame = new Set(state.usedWords || []);
    const roomRecent = new Set(Array.isArray(room.drawguessUsedWords) ? room.drawguessUsedWords : []);
    let candidates = pool.filter(entry => !usedInGame.has(entry.word) && !roomRecent.has(entry.word));
    if (candidates.length < CHOICE_COUNT) {
        candidates = pool.filter(entry => !usedInGame.has(entry.word));
    }
    if (candidates.length < CHOICE_COUNT) {
        candidates = pool;
    }
    const shuffled = shuffle(candidates);
    let picks = [];
    if (state.settings?.category === 'mixed') {
        const usedCategories = new Set();
        shuffled.forEach(entry => {
            if (picks.length < CHOICE_COUNT && !usedCategories.has(entry.category)) {
                picks.push(entry);
                usedCategories.add(entry.category);
            }
        });
    }
    shuffled.forEach(entry => {
        if (picks.length < CHOICE_COUNT && !picks.includes(entry)) picks.push(entry);
    });
    picks = picks.slice(0, CHOICE_COUNT);
    state.usedWords = [...(state.usedWords || []), ...picks.map(entry => entry.word)];
    const recent = [...(Array.isArray(room.drawguessUsedWords) ? room.drawguessUsedWords : []), ...picks.map(entry => entry.word)];
    room.drawguessUsedWords = recent.slice(-ROOM_WORD_MEMORY);
    return picks.map(entry => ({ word: entry.word, category: entry.category }));
}

// ---------------------------------------------------------------- state

function createInitialState() {
    return {
        mode: MODE,
        status: 'waiting',
        phase: 'lobby',
        step: 0,
        players: [],
        settings: sanitizeSettings(),
        order: [],
        roster: {},
        scores: {},
        departed: {},
        round: 0,
        turnIndex: -1,
        turnNo: 0,
        turnsPlayed: 0,
        startCount: 0,
        drawerId: null,
        choices: [],
        word: null,
        wordCategory: null,
        hintPlan: [],
        guessed: {},
        turnScores: {},
        lastTurn: null,
        waiting: false,
        phaseStartedAt: null,
        phaseEndsAt: null,
        drawMs: 0,
        usedWords: [],
        canvas: { turnNo: 0, strokes: [], points: 0, strokeCount: 0 },
        feed: [],
        feedSeq: 0,
        standings: [],
        winnerIds: [],
        countsForStats: false,
        endReason: null,
        recoveredAt: 0,
        history: [],
        fx: [],
        fxSeq: 0,
        statsRecordedAt: null,
        returnLobbyEndsAt: null
    };
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        name: player.playerName || player.name || 'ผู้เล่น',
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        permission: context.isAdmin ? 'admin' : null,
        socketId: context.socketId || null
    };
}

function isConnectedRoomPlayer(player) {
    return !!(player && player.playerId && player.socketId);
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: (room.players || []).filter(isConnectedRoomPlayer).map(player => createPlayerState(player, {
            isAdmin: player.permission === 'admin' || player.playerId === room.admin
        }))
    };
}

function getGamePlayer(room, playerId) {
    return (room.gameState?.players || []).find(player => player.playerId === playerId) || null;
}

function isActive(state, playerId) {
    return !!(state.roster[playerId] && !state.departed[playerId]
        && (state.players || []).some(player => player.playerId === playerId));
}

function activeIds(state) {
    return (state.players || [])
        .map(player => player.playerId)
        .filter(id => state.roster[id] && !state.departed[id]);
}

/** ออนไลน์ หรือเพิ่งหลุดไม่เกิน GRACE_MS (หรือเพิ่งรีสตาร์ตเซิร์ฟเวอร์) */
function isPresent(room, playerId, now) {
    const roomPlayer = (room.players || []).find(player => player.playerId === playerId);
    if (!roomPlayer) return false;
    if (roomPlayer.socketId) return true;
    const state = room.gameState || {};
    if (state.recoveredAt && now - state.recoveredAt < GRACE_MS) return true;
    const since = roomPlayer.disconnectedAt ? new Date(roomPlayer.disconnectedAt).getTime() : 0;
    return Number.isFinite(since) && since > 0 && now - since < GRACE_MS;
}

function bumpStep(state) {
    state.step = (Number(state.step) || 0) + 1;
}

function setPhase(state, phase, durationMs, now) {
    state.phase = phase;
    state.phaseStartedAt = now;
    state.phaseEndsAt = durationMs ? now + durationMs : null;
    bumpStep(state);
}

function pushFeed(state, entry, now) {
    state.feedSeq = (Number(state.feedSeq) || 0) + 1;
    state.feed = [...(state.feed || []), { seq: state.feedSeq, turnNo: state.turnNo, aud: 'all', at: now, ...entry }]
        .slice(-FEED_LIMIT);
}

function pushHistory(state, icon, text, kind, now) {
    state.history = [{ icon, text, kind, at: new Date(now).toISOString() }, ...(state.history || [])].slice(0, 40);
}

function pushFx(state, event) {
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, ...event }].slice(-8);
}

function nameOf(state, playerId) {
    return state.roster?.[playerId]?.name || 'ผู้เล่น';
}

/**
 * roomManager ถอด/ใส่ผู้เล่นใน gameState.players เอง (ออกห้อง/กลับเข้าห้อง)
 * ตรงนี้ไล่ให้ roster/order/departed ตรงกับความจริง: คนกลับมาหรือเข้ามาใหม่ = ทายได้ตั้งแต่ตาถัดไป
 */
function syncRoster(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || !Array.isArray(state.players)) return;
    const seen = new Set();
    state.players = state.players.filter(player => {
        if (!player || !player.playerId || seen.has(player.playerId)) return false;
        seen.add(player.playerId);
        return true;
    });
    if (state.phase === 'lobby') return;
    state.players.forEach(player => {
        const id = player.playerId;
        const known = state.roster[id];
        if (!known) {
            state.roster[id] = {
                name: player.name || player.playerName || 'ผู้เล่น',
                color: player.color,
                avatar: player.avatar || '👤',
                avatarFrame: player.avatarFrame || 'none',
                joinedTurn: state.turnNo
            };
            if (!(id in state.scores)) state.scores[id] = 0;
            if (!state.order.includes(id)) state.order.push(id);
            if (state.phase !== 'finished') {
                pushFeed(state, { kind: 'system', icon: '👋', text: `${state.roster[id].name} เข้าร่วม — ทายได้ตั้งแต่ตาถัดไป` }, now);
            }
            return;
        }
        known.name = player.name || player.playerName || known.name;
        known.color = player.color || known.color;
        known.avatar = player.avatar || known.avatar;
        known.avatarFrame = player.avatarFrame || known.avatarFrame;
        if (state.departed[id]) {
            delete state.departed[id];
            known.joinedTurn = state.turnNo;
            if (!state.order.includes(id)) state.order.push(id);
            if (state.phase !== 'finished') {
                pushFeed(state, { kind: 'system', icon: '👋', text: `${known.name} กลับมาแล้ว — ทายได้ตั้งแต่ตาถัดไป` }, now);
            }
        }
    });
}

// ---------------------------------------------------------------- start

function startGame(room, now = Date.now()) {
    const base = resetRoomGame(room);
    const count = base.players.length;
    if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
        throw new Error(`วาดแล้วทายเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน (ออนไลน์ตอนนี้ ${count} คน)`);
    }
    const state = {
        ...base,
        status: 'playing',
        phase: 'starting',
        settings: sanitizeSettings(room.settings || {}),
        order: base.players.map(player => player.playerId),
        startCount: count,
        round: 1,
        turnIndex: -1,
        recoveredAt: now
    };
    base.players.forEach(player => {
        state.roster[player.playerId] = {
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
            joinedTurn: 0
        };
        state.scores[player.playerId] = 0;
    });
    room.gameState = state;
    const cat = CATEGORY_BY_ID[state.settings.category];
    pushFeed(state, {
        kind: 'system',
        icon: '🎨',
        text: `เริ่มเกม! ${state.settings.rounds} รอบ · วาดตาละ ${state.settings.drawSeconds} วิ · หมวด${cat ? cat.name : 'รวมทุกหมวด'}`
    }, now);
    pushHistory(state, '🎨', `เริ่มเกม ${count} คน · ${state.settings.rounds} รอบ`, 'start', now);
    startNextTurn(room, now);
    return room.gameState;
}

function drawMsFor(state) {
    return DRAW_MS_OVERRIDE || state.settings.drawSeconds * 1000;
}

function startNextTurn(room, now) {
    const state = room.gameState;
    state.waiting = false;
    if (activeIds(state).length < 2) {
        return finishGame(room, now, 'notenough');
    }
    const order = state.order || [];
    const anyPresent = order.some(id => isActive(state, id) && isPresent(room, id, now));
    if (!anyPresent) {
        // ไม่มีใครอยู่เลย (เน็ตหลุดทั้งวง) — พักไว้ก่อน ไม่เผาตาของทุกคนทิ้ง
        state.waiting = true;
        state.drawerId = null;
        state.word = null;
        state.choices = [];
        setPhase(state, 'reveal', REVEAL_MS, now);
        return state;
    }
    let guard = order.length * (ROUND_OPTIONS[ROUND_OPTIONS.length - 1] + 2) + 4;
    let drawerId = null;
    while (guard > 0) {
        guard -= 1;
        state.turnIndex += 1;
        if (state.turnIndex >= order.length) {
            if (state.round >= state.settings.rounds) {
                return finishGame(room, now, 'complete');
            }
            state.round += 1;
            state.turnIndex = 0;
            pushFeed(state, { kind: 'round', icon: '🔔', text: `รอบที่ ${state.round} / ${state.settings.rounds}` }, now);
            pushFx(state, { kind: 'round', round: state.round });
        }
        const candidate = order[state.turnIndex];
        if (!isActive(state, candidate)) continue;
        if (!isPresent(room, candidate, now)) {
            pushFeed(state, { kind: 'system', icon: '📴', text: `ข้ามตา ${nameOf(state, candidate)} (ออฟไลน์)` }, now);
            continue;
        }
        drawerId = candidate;
        break;
    }
    if (!drawerId) return finishGame(room, now, 'complete');

    state.turnNo += 1;
    state.drawerId = drawerId;
    state.word = null;
    state.wordCategory = null;
    state.hintPlan = [];
    state.guessed = {};
    state.turnScores = {};
    state.canvas = { turnNo: state.turnNo, strokes: [], points: 0, strokeCount: 0 };
    state.choices = pickChoices(room);
    state.drawMs = drawMsFor(state);
    setPhase(state, 'choose', CHOOSE_MS, now);
    pushFeed(state, { kind: 'turn', icon: '🎨', playerId: drawerId, text: `ตา ${nameOf(state, drawerId)} วาด` }, now);
    pushFx(state, { kind: 'turn', drawerId, turnNo: state.turnNo });
    return state;
}

// ---------------------------------------------------------------- guards

function assertPlaying(room) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || state.phase === 'lobby' || state.status !== 'playing') {
        if (state && state.phase === 'finished') throw new Error('เกมจบแล้ว');
        throw new Error('เกมยังไม่เริ่ม');
    }
    return state;
}

function assertTurn(state, context) {
    const turnNo = context && context.turnNo;
    if (turnNo === undefined || turnNo === null || Number(turnNo) !== Number(state.turnNo)) {
        throw new Error('ตานี้จบไปแล้ว — ดูหน้าจออีกครั้ง');
    }
}

// ---------------------------------------------------------------- choose / draw

function chooseWord(room, playerId, index, context = {}, now = Date.now()) {
    const state = assertPlaying(room);
    syncRoster(room, now);
    if (state.phase !== 'choose') throw new Error('ตอนนี้ไม่ใช่ช่วงเลือกคำ');
    assertTurn(state, context);
    if (state.drawerId !== playerId) throw new Error('ยังไม่ถึงตาคุณวาด');
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= state.choices.length) throw new Error('เลือกคำไม่ถูกต้อง');
    return startDrawing(room, state.choices[i], now);
}

function hintPlanFor(word, drawMs) {
    const letters = graphemes(word);
    const slots = letters.map((ch, i) => (/^\s+$/.test(ch) ? -1 : i)).filter(i => i >= 0);
    const count = Math.floor(slots.length * HINT_MAX_RATIO);
    const picks = shuffle(slots).slice(0, count);
    return picks.map((index, k) => ({
        index,
        offset: Math.round(drawMs * (HINT_START_RATIO + 0.6 * (k + 1) / (count + 1)))
    }));
}

function startDrawing(room, choice, now) {
    const state = room.gameState;
    state.word = choice.word;
    state.wordCategory = choice.category;
    state.choices = [];
    state.drawMs = drawMsFor(state);
    setPhase(state, 'draw', state.drawMs, now);
    state.hintPlan = hintPlanFor(choice.word, state.drawMs).map(h => ({ index: h.index, at: now + h.offset }));
    pushFeed(state, { kind: 'system', icon: '✏️', text: `${nameOf(state, state.drawerId)} เริ่มวาดแล้ว — พิมพ์ทายได้เลย` }, now);
    pushFx(state, { kind: 'draw', turnNo: state.turnNo });
    return state;
}

function revealedIndexes(state, now) {
    return (state.hintPlan || []).filter(h => h.at <= now).map(h => h.index);
}

function buildMask(word, revealed) {
    const set = new Set(revealed || []);
    return graphemes(word).map((ch, i) => (/^\s+$/.test(ch)
        ? { sp: true }
        : { ch: set.has(i) ? ch : null }));
}

// ---------------------------------------------------------------- guesses

function roundTo5(n) {
    return Math.round(n / 5) * 5;
}

function guessPoints(state, order, now) {
    const span = Math.max(1, Number(state.drawMs) || 1);
    const frac = Math.max(0, Math.min(1, ((state.phaseEndsAt || now) - now) / span));
    const bonus = ORDER_BONUS[order - 1] != null ? ORDER_BONUS[order - 1] : ORDER_BONUS_REST;
    return roundTo5(GUESS_MIN_POINTS + GUESS_TIME_POINTS * frac) + bonus;
}

function answerForms(state) {
    const entry = WORD_BY_TEXT.get(state.word);
    return [state.word, ...((entry && entry.aliases) || [])].map(normalizeGuess).filter(Boolean);
}

/** ผู้ทายที่ยังต้องรอ: อยู่ในเกม ไม่ใช่คนวาด เข้ามาก่อนตานี้ และยังอยู่ (ไม่หลุดนาน) */
function eligibleGuessers(room, now) {
    const state = room.gameState;
    return activeIds(state).filter(id => id !== state.drawerId
        && (state.roster[id]?.joinedTurn || 0) < state.turnNo
        && isPresent(room, id, now));
}

function everyoneGuessed(room, now) {
    const state = room.gameState;
    const guessedCount = Object.keys(state.guessed || {}).length;
    if (!guessedCount) return false;
    return eligibleGuessers(room, now).every(id => state.guessed[id]);
}

/**
 * ทาย/พิมพ์ในช่องทาย — คืนผลให้ฝั่งเซิร์ฟเวอร์ตอบกลับคนพิมพ์
 * context.displayFilter (ถ้ามี) ใช้กรองคำหยาบเฉพาะข้อความที่โชว์ ไม่ใช้ตอนเทียบคำตอบ
 */
function submitGuess(room, playerId, text, context = {}, now = Date.now()) {
    const state = assertPlaying(room);
    syncRoster(room, now);
    const player = getGamePlayer(room, playerId);
    if (!player || !state.roster[playerId] || state.departed[playerId]) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    const clean = cleanText(text, GUESS_MAX_LENGTH);
    if (!clean) throw new Error('พิมพ์คำที่จะทายก่อน');
    const roster = state.roster[playerId];
    if (roster.lastGuessAt && now - roster.lastGuessAt < GUESS_COOLDOWN_MS) {
        throw new Error('พิมพ์ช้าลงนิดนึง');
    }
    roster.lastGuessAt = now;
    const display = typeof context.displayFilter === 'function' ? context.displayFilter(clean) : clean;
    const name = nameOf(state, playerId);

    // คนวาด/คนที่ทายถูกแล้ว — คุยกันเองได้ คนที่ยังไม่ถูกไม่เห็น
    if (state.phase === 'draw' && (playerId === state.drawerId || state.guessed[playerId])) {
        pushFeed(state, { kind: 'chat', aud: 'solved', playerId, name, text: display }, now);
        return { result: 'chat' };
    }
    if (state.phase !== 'draw') {
        // ช่วงเลือกคำ/เฉลย — เป็นแชทธรรมดา (ยังไม่มีคำให้ทาย หรือเฉลยแล้ว)
        if (state.phase === 'choose' && playerId === state.drawerId) throw new Error('เลือกคำก่อน แล้วค่อยคุย');
        pushFeed(state, { kind: 'chat', playerId, name, text: display }, now);
        return { result: 'chat' };
    }
    if ((roster.joinedTurn || 0) >= state.turnNo) {
        throw new Error('เพิ่งเข้ามา — ทายได้ตั้งแต่ตาถัดไปนะ');
    }

    const guessNorm = normalizeGuess(clean);
    const forms = answerForms(state);
    if (guessNorm && forms.includes(guessNorm)) {
        const order = Object.keys(state.guessed).length + 1;
        const points = guessPoints(state, order, now);
        state.guessed[playerId] = { order, at: now, points };
        state.turnScores[playerId] = points;
        state.scores[playerId] = (state.scores[playerId] || 0) + points;
        pushFeed(state, { kind: 'correct', playerId, name, text: `${name} ทายถูก!`, points, order }, now);
        pushFx(state, { kind: 'correct', playerId, order });
        bumpStep(state);
        if (everyoneGuessed(room, now)) endTurn(room, 'all', now);
        return { result: 'correct', points, order };
    }
    if (forms.some(form => isCloseGuess(guessNorm, form))) {
        pushFeed(state, { kind: 'close', aud: 'close', to: playerId, playerId, name, text: display }, now);
        return { result: 'close' };
    }
    pushFeed(state, { kind: 'guess', playerId, name, text: display }, now);
    return { result: 'wrong' };
}

// ---------------------------------------------------------------- turn end

function endTurn(room, reason, now) {
    const state = room.gameState;
    const drawerId = state.drawerId;
    const guessedIds = Object.keys(state.guessed || {});
    const drew = !!state.word;
    if (drew && drawerId && guessedIds.length) {
        const drawerPoints = DRAWER_POINTS_PER_GUESS * guessedIds.length;
        state.turnScores[drawerId] = (state.turnScores[drawerId] || 0) + drawerPoints;
        state.scores[drawerId] = (state.scores[drawerId] || 0) + drawerPoints;
    }
    const deltas = Object.keys(state.roster)
        .filter(id => (state.turnScores[id] || 0) > 0)
        .map(id => ({
            playerId: id,
            name: nameOf(state, id),
            delta: state.turnScores[id] || 0,
            order: state.guessed[id]?.order || null,
            isDrawer: id === drawerId
        }))
        .sort((a, b) => b.delta - a.delta);
    state.lastTurn = {
        turnNo: state.turnNo,
        round: state.round,
        word: state.word,
        category: state.wordCategory,
        drawerId,
        drawerName: nameOf(state, drawerId),
        reason,
        guessedCount: guessedIds.length,
        deltas
    };
    if (drew) {
        state.turnsPlayed = (Number(state.turnsPlayed) || 0) + 1;
        pushFeed(state, { kind: 'reveal', icon: '💡', text: `คำนี้คือ “${state.word}”` }, now);
        pushHistory(state, '🎨', `${nameOf(state, drawerId)} วาด “${state.word}” — ทายถูก ${guessedIds.length} คน`, 'turn', now);
    } else {
        pushFeed(state, { kind: 'system', icon: '⏭️', text: `ข้ามตา ${nameOf(state, drawerId)}` }, now);
    }
    state.choices = [];
    setPhase(state, 'reveal', drew ? REVEAL_MS : SKIP_REVEAL_MS, now);
    pushFx(state, { kind: 'reveal', reason, turnNo: state.turnNo });
    return state;
}

/** หัวห้องข้ามตา (คนวาดไม่ยอมวาด/ไม่อยู่หน้าจอ) */
function skipTurn(room, actorId, context = {}, now = Date.now()) {
    const state = assertPlaying(room);
    syncRoster(room, now);
    if (room.admin !== actorId) throw new Error('มีแค่หัวหน้าห้องที่ข้ามตาได้');
    if (state.phase !== 'choose' && state.phase !== 'draw') throw new Error('ตอนนี้ข้ามตาไม่ได้');
    assertTurn(state, context);
    return endTurn(room, 'skipped', now);
}

// ---------------------------------------------------------------- finish

function computeStandings(state) {
    const rows = Object.keys(state.roster || {}).map(id => ({
        playerId: id,
        name: nameOf(state, id),
        avatar: state.roster[id].avatar,
        color: state.roster[id].color,
        avatarFrame: state.roster[id].avatarFrame,
        score: state.scores[id] || 0,
        left: !!state.departed[id]
    }));
    rows.sort((a, b) => b.score - a.score || (a.left === b.left ? 0 : (a.left ? 1 : -1)));
    let rank = 0;
    rows.forEach((row, i) => {
        if (i === 0 || row.score !== rows[i - 1].score) rank = i + 1;
        row.rank = rank;
    });
    return rows;
}

function finishGame(room, now, reason) {
    const state = room.gameState;
    const standings = computeStandings(state);
    const top = standings.length ? standings[0].score : 0;
    state.standings = standings;
    state.winnerIds = top > 0 ? standings.filter(row => row.score === top && !row.left).map(row => row.playerId) : [];
    if (!state.winnerIds.length && top > 0) {
        state.winnerIds = standings.filter(row => row.score === top).map(row => row.playerId);
    }
    state.endReason = reason;
    // เกมที่จบเพราะคนไม่พอ นับสถิติเมื่อเล่นครบอย่างน้อย 1 รอบแล้วเท่านั้น
    state.countsForStats = reason === 'complete' || (state.turnsPlayed || 0) >= (state.startCount || MIN_PLAYERS);
    state.status = 'drawguess_finished';
    state.drawerId = null;
    state.choices = [];
    state.waiting = false;
    setPhase(state, 'finished', 0, now);
    const winners = state.winnerIds.map(id => nameOf(state, id)).join(', ');
    pushFeed(state, {
        kind: 'system',
        icon: '🏆',
        text: reason === 'notenough'
            ? 'ผู้เล่นเหลือไม่พอ — จบเกมก่อนกำหนด'
            : (winners ? `จบเกม! ${winners} ชนะ` : 'จบเกม!')
    }, now);
    pushHistory(state, '🏆', winners ? `จบเกม — ${winners} ชนะ (${top} แต้ม)` : 'จบเกม', 'finished', now);
    pushFx(state, { kind: 'finish' });
    return state;
}

// ---------------------------------------------------------------- timers

/**
 * เรียกเป็นระยะ (เช่นทุก 500ms) — คืน true ถ้า state เปลี่ยนและควรส่งให้ทุกคน
 * จัดการ: หมดเวลาเลือก/วาด/เฉลย · คนวาดหลุดเกิน GRACE_MS · เปิดคำใบ้ตามเวลา · ทุกคนทายถูกแล้ว
 */
function tick(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || state.status !== 'playing') return false;
    syncRoster(room, now);
    if (activeIds(state).length < 2) {
        finishGame(room, now, 'notenough');
        return true;
    }
    if (state.phase === 'choose' || state.phase === 'draw') {
        const drawerGone = !isActive(state, state.drawerId) || !isPresent(room, state.drawerId, now);
        if (drawerGone) {
            endTurn(room, 'away', now);
            return true;
        }
    }
    if (state.phase === 'choose') {
        if (now >= state.phaseEndsAt) {
            startDrawing(room, state.choices[randInt(state.choices.length)] || state.choices[0], now);
            pushFeed(state, { kind: 'system', icon: '🎲', text: 'หมดเวลาเลือก — สุ่มคำให้แล้ว' }, now);
            return true;
        }
        return false;
    }
    if (state.phase === 'draw') {
        if (now >= state.phaseEndsAt) {
            endTurn(room, 'timeout', now);
            return true;
        }
        if (everyoneGuessed(room, now)) {
            endTurn(room, 'all', now);
            return true;
        }
        const shown = revealedIndexes(state, now).length;
        if (shown !== (state.hintsShown || 0)) {
            state.hintsShown = shown;
            pushFx(state, { kind: 'hint', count: shown });
            return true;
        }
        return false;
    }
    if (state.phase === 'reveal' || state.phase === 'starting') {
        if (!state.phaseEndsAt || now >= state.phaseEndsAt) {
            startNextTurn(room, now);
            return true;
        }
    }
    return false;
}

function autoResolvePhase(room, now = Date.now()) {
    return tick(room, now);
}

/** เซิร์ฟเวอร์เพิ่งบูต/เพิ่งเริ่มนับเวลาห้องนี้ — ให้ทุกคนมีเวลากลับมาก่อนถือว่าหลุด */
function markRecovered(room, now = Date.now()) {
    const state = room?.gameState;
    if (state && state.mode === MODE && state.status === 'playing') state.recoveredAt = now;
}

// ---------------------------------------------------------------- leave

function handlePlayerLeft(room, playerId, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || state.status !== 'playing') return state;
    if (!state.roster[playerId] || state.departed[playerId]) return state;
    state.departed[playerId] = { turnNo: state.turnNo, at: now };
    state.players = (state.players || []).filter(player => player.playerId !== playerId);
    pushFeed(state, { kind: 'system', icon: '🚪', text: `${nameOf(state, playerId)} ออกจากเกม` }, now);
    syncRoster(room, now);
    if (activeIds(state).length < 2) {
        return finishGame(room, now, 'notenough');
    }
    if (state.drawerId === playerId && (state.phase === 'choose' || state.phase === 'draw')) {
        return endTurn(room, 'left', now);
    }
    if (state.phase === 'draw' && everyoneGuessed(room, now)) {
        return endTurn(room, 'all', now);
    }
    return state;
}

// ---------------------------------------------------------------- canvas

function finiteCoord(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < -0.05 || n > 1.05) return null;
    return Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000;
}

function sanitizePoints(raw) {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length % 2 !== 0 || raw.length > MAX_POINTS_PER_BATCH * 2) return null;
    const out = new Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        const v = finiteCoord(raw[i]);
        if (v === null) return null;
        out[i] = v;
    }
    return out;
}

function sanitizeOp(op) {
    if (!op || typeof op !== 'object') return null;
    if (op.t === 'u' || op.t === 'c') return { t: op.t };
    const id = Number(op.id);
    if (!Number.isInteger(id) || id < 0 || id > 1e9) return null;
    const p = sanitizePoints(op.p);
    if (!p) return null;
    if (op.t === 'p') return { t: 'p', id, p };
    if (op.t === 's') {
        const c = Number(op.c);
        const w = Number(op.w);
        if (!Number.isInteger(c) || c < 0 || c >= COLOR_COUNT) return null;
        if (!Number.isInteger(w) || w < 0 || w >= SIZE_COUNT) return null;
        return { t: 's', id, c, w, e: op.e === 1 || op.e === true ? 1 : 0, p };
    }
    return null;
}

/**
 * รับเส้นจากคนวาด — ตรวจทุกอย่าง (ตา/คน/รูปแบบ/ช่วงค่า/ขนาด) แล้วเก็บไว้ให้ replay
 * คืน ops ที่ผ่านการกรองแล้ว (ให้ส่งต่อคนอื่น) · ไม่ผ่าน = throw ทั้งชุด
 */
function applyStrokes(room, playerId, batch, now = Date.now()) {
    const state = assertPlaying(room);
    if (state.phase !== 'draw') throw new Error('ตอนนี้ยังวาดไม่ได้');
    if (state.drawerId !== playerId) throw new Error('ไม่ใช่ตาคุณวาด');
    if (!batch || typeof batch !== 'object') throw new Error('ข้อมูลเส้นไม่ถูกต้อง');
    assertTurn(state, batch);
    const ops = batch.ops;
    if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS_PER_BATCH) throw new Error('ข้อมูลเส้นไม่ถูกต้อง');
    const clean = [];
    let points = 0;
    let newStrokes = 0;
    for (const raw of ops) {
        const op = sanitizeOp(raw);
        if (!op) throw new Error('ข้อมูลเส้นไม่ถูกต้อง');
        if (op.p) points += op.p.length / 2;
        if (op.t === 's') newStrokes += 1;
        clean.push(op);
    }
    if (points > MAX_POINTS_PER_BATCH) throw new Error('ส่งเส้นทีละเยอะเกินไป');
    const canvas = state.canvas && state.canvas.turnNo === state.turnNo
        ? state.canvas
        : (state.canvas = { turnNo: state.turnNo, strokes: [], points: 0, strokeCount: 0 });
    if (canvas.points + points > MAX_POINTS_PER_TURN || canvas.strokeCount + newStrokes > MAX_STROKES_PER_TURN) {
        throw new Error('ภาพนี้ละเอียดเกินไปแล้ว — ลบบางส่วนก่อน');
    }
    const applied = [];
    clean.forEach(op => {
        if (op.t === 's') {
            canvas.strokes.push({ id: op.id, c: op.c, w: op.w, e: op.e, p: op.p });
            canvas.strokeCount += 1;
            canvas.points += op.p.length / 2;
            applied.push(op);
        } else if (op.t === 'p') {
            const last = canvas.strokes[canvas.strokes.length - 1];
            if (!last || last.id !== op.id) return;
            last.p = last.p.concat(op.p);
            canvas.points += op.p.length / 2;
            applied.push(op);
        } else if (op.t === 'u') {
            if (canvas.strokes.length) {
                canvas.strokes.pop();
                applied.push(op);
            }
        } else if (op.t === 'c') {
            canvas.strokes = [];
            applied.push(op);
        }
    });
    return applied;
}

function getCanvas(room) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || !state.canvas) return { turnNo: 0, strokes: [] };
    return { turnNo: state.canvas.turnNo, strokes: state.canvas.strokes || [] };
}

// ---------------------------------------------------------------- client view

function feedVisibleTo(state, entry, viewerId) {
    if (entry.aud === 'all' || !entry.aud) return true;
    const turnOver = entry.turnNo !== state.turnNo || state.phase === 'reveal' || state.phase === 'finished';
    if (turnOver) return true;
    if (viewerId && viewerId === state.drawerId) return true;
    if (viewerId && state.guessed && state.guessed[viewerId]) return true;
    if (entry.aud === 'close') return entry.to === viewerId;
    return false;
}

function buildClientState(room, viewerId, now = Date.now()) {
    syncRoster(room, now);
    const state = room?.gameState || createInitialState();
    const phase = state.phase;
    const inTurn = phase === 'choose' || phase === 'draw';
    const isDrawer = !!viewerId && viewerId === state.drawerId && inTurn;
    const viewerGuessed = !!(viewerId && state.guessed && state.guessed[viewerId]);
    const viewerRoster = viewerId ? state.roster?.[viewerId] : null;
    const isLate = !!(viewerRoster && phase === 'draw' && (viewerRoster.joinedTurn || 0) >= state.turnNo);
    const seesWord = phase === 'draw' && (isDrawer || viewerGuessed);
    const revealed = phase === 'draw' ? revealedIndexes(state, now) : [];
    const hostId = room?.admin || null;

    const seatIds = (state.order && state.order.length ? state.order : (state.players || []).map(p => p.playerId))
        .filter(id => state.roster?.[id] || (state.players || []).some(p => p.playerId === id));
    const players = seatIds.map(id => {
        const info = state.roster?.[id] || (state.players || []).find(p => p.playerId === id) || {};
        const roomPlayer = (room?.players || []).find(p => p.playerId === id);
        return {
            playerId: id,
            name: info.name || 'ผู้เล่น',
            color: info.color,
            avatar: info.avatar || '👤',
            avatarFrame: info.avatarFrame || 'none',
            score: state.scores?.[id] || 0,
            isDrawer: id === state.drawerId && inTurn,
            guessed: !!(state.guessed && state.guessed[id]) && phase !== 'lobby',
            guessOrder: state.guessed?.[id]?.order || null,
            turnDelta: phase === 'reveal' ? (state.turnScores?.[id] || 0) : 0,
            online: !!(roomPlayer && roomPlayer.socketId),
            left: !!state.departed?.[id],
            late: phase === 'draw' && (state.roster?.[id]?.joinedTurn || 0) >= state.turnNo,
            isHost: id === hostId,
            isSelf: id === viewerId
        };
    });

    const feed = (state.feed || [])
        .filter(entry => feedVisibleTo(state, entry, viewerId))
        .slice(-FEED_CLIENT_LIMIT)
        .map(entry => ({
            seq: entry.seq,
            turnNo: entry.turnNo || 0,
            kind: entry.kind,
            icon: entry.icon || null,
            playerId: entry.playerId || null,
            name: entry.name || null,
            text: entry.text || '',
            points: entry.points || null,
            mine: !!viewerId && entry.playerId === viewerId,
            privateTo: entry.aud === 'close' ? entry.to : null,
            solvedOnly: entry.aud === 'solved'
        }));

    let word = null;
    let mask = null;
    if (phase === 'draw' && state.word) {
        if (seesWord) word = state.word;
        mask = seesWord ? buildMask(state.word, graphemes(state.word).map((_, i) => i)) : buildMask(state.word, revealed);
    }

    const cat = CATEGORY_BY_ID[state.settings?.category];
    return {
        mode: MODE,
        status: state.status,
        phase,
        step: Number(state.step) || 0,
        serverNow: now,
        phaseStartedAt: state.phaseStartedAt || null,
        phaseEndsAt: state.phaseEndsAt || null,
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        drawMs: state.drawMs || drawMsFor({ settings: state.settings || sanitizeSettings() }),
        chooseMs: CHOOSE_MS,
        revealMs: REVEAL_MS,
        settings: {
            rounds: state.settings?.rounds || DEFAULT_ROUNDS,
            drawSeconds: state.settings?.drawSeconds || DEFAULT_DRAW_SECONDS,
            category: state.settings?.category || 'mixed',
            categoryName: cat ? cat.name : 'รวมทุกหมวด'
        },
        round: state.round || 0,
        turnNo: state.turnNo || 0,
        waiting: !!state.waiting,
        drawerId: inTurn ? state.drawerId : null,
        drawerName: inTurn ? nameOf(state, state.drawerId) : null,
        hostId,
        choices: isDrawer && phase === 'choose'
            ? (state.choices || []).map(choice => ({ word: choice.word, category: CATEGORY_BY_ID[choice.category]?.name || '' }))
            : [],
        word,
        wordCategory: (seesWord || phase === 'draw') && state.wordCategory ? (CATEGORY_BY_ID[state.wordCategory]?.name || null) : null,
        mask,
        hintsShown: revealed.length,
        guessedCount: Object.keys(state.guessed || {}).length,
        guesserCount: inTurn ? eligibleGuessers(room, now).length : 0,
        lastTurn: (phase === 'reveal' || phase === 'finished') && state.lastTurn ? {
            ...state.lastTurn,
            deltas: (state.lastTurn.deltas || []).map(d => ({ ...d }))
        } : null,
        standings: phase === 'finished' ? (state.standings || []).map(row => ({ ...row })) : [],
        winnerIds: phase === 'finished' ? [...(state.winnerIds || [])] : [],
        endReason: phase === 'finished' ? state.endReason : null,
        countsForStats: phase === 'finished' ? !!state.countsForStats : false,
        self: viewerId ? {
            playerId: viewerId,
            inGame: !!(viewerRoster && !state.departed?.[viewerId]),
            isDrawer,
            isHost: viewerId === hostId,
            guessed: viewerGuessed,
            late: isLate,
            canGuess: phase === 'draw' && !isDrawer && !viewerGuessed && !isLate && !!viewerRoster,
            canDraw: isDrawer && phase === 'draw',
            score: state.scores?.[viewerId] || 0
        } : null,
        players,
        feed,
        categories: CATEGORY_LIST.map(c => ({ ...c })),
        fx: state.fx || []
    };
}

function getScoringPlayers(room) {
    return (room?.gameState?.standings || []).filter(row => row && row.playerId);
}

module.exports = {
    id: MODE,
    label: LABEL,
    description: 'คนหนึ่งวาด ที่เหลือแข่งกันพิมพ์ทาย ทายเร็วได้แต้มเยอะ · 3–12 คน',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    MODE,
    ROUND_OPTIONS,
    DEFAULT_ROUNDS,
    DRAW_SECONDS_OPTIONS,
    DEFAULT_DRAW_SECONDS,
    CATEGORY_LIST,
    CHOOSE_MS,
    REVEAL_MS,
    GRACE_MS,
    COLOR_COUNT,
    SIZE_COUNT,
    MAX_OPS_PER_BATCH,
    MAX_POINTS_PER_BATCH,
    MAX_POINTS_PER_TURN,
    MAX_STROKES_PER_TURN,
    GUESS_COOLDOWN_MS,
    HINT_MAX_RATIO,
    HINT_START_RATIO,
    ORDER_BONUS,
    DRAWER_POINTS_PER_GUESS,
    WORDS,
    setRandom,
    graphemes,
    normalizeGuess,
    levenshtein,
    isCloseGuess,
    parseWordList,
    sanitizeSettings,
    pickChoices,
    hintPlanFor,
    buildMask,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    chooseWord,
    submitGuess,
    skipTurn,
    applyStrokes,
    getCanvas,
    tick,
    autoResolvePhase,
    markRecovered,
    handlePlayerLeft,
    syncRoster,
    buildClientState,
    getScoringPlayers
};
