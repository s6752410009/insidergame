/**
 * คำใครไม่เหมือน (Undercover / 谁是卧底) — 4–10 คน เล่นหน้ากัน พูดใบ้ด้วยปาก
 *
 * พลเมืองทุกคนได้คำ A · สายแฝงได้คำ B ที่คล้ายกันแต่ไม่เหมือน (ไม่มีใครรู้ว่าตัวเองอยู่ฝั่งไหน)
 * Mr. White (ถ้าหัวห้องเปิด และมี 6 คนขึ้นไป) ไม่ได้คำ และรู้ตัวว่าเป็น Mr. White
 *
 * รอบ: ดูคำ (reveal) → ใบ้ทีละคน (clue) → โหวตออก 1 คน (vote) → เฉลยบท (elimination)
 *      ถ้าคนที่ออกเป็น Mr. White ได้ทายคำพลเมือง 1 ครั้ง (mrwhite) ทายถูก = Mr. White ชนะทันที
 * ชนะ: พลเมืองชนะเมื่อฝ่ายแฝง (สายแฝง + Mr. White) ออกหมด
 *      ฝ่ายแฝงชนะเมื่อเหลือคนรอด 2 คนและมีฝ่ายแฝงอย่างน้อย 1 คน (หรือพลเมืองหมด)
 *
 * ทุกคำสั่งจาก client ต้องแนบ step (เพิ่มทุกครั้งที่เฟส/คนพูดเปลี่ยน) — กดค้างจากจอเก่าจะถูกปัด
 */

const fs = require('fs');
const path = require('path');
const { gameAssetImage } = require('./gameAssets');

const MODE = 'undercover';
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const MR_WHITE_MIN_PLAYERS = 6;
const CLUE_MAX_LENGTH = 40;
const GUESS_MAX_LENGTH = 40;
// โหวตเสมอ/ไม่มีใครโหวตติดกันกี่รอบถึงถือว่าวงหาตัวไม่เจอ — ฝ่ายแฝงรอด (กันเกมวนไม่จบเมื่อโต๊ะ AFK)
const MAX_STALE_ROUNDS = 3;

const REVEAL_MS = Number(process.env.UNDERCOVER_REVEAL_MS) || 30000;
const CLUE_MS = Number(process.env.UNDERCOVER_CLUE_MS) || 45000;
const VOTE_MS = Number(process.env.UNDERCOVER_VOTE_MS) || 60000;
const MRWHITE_MS = Number(process.env.UNDERCOVER_MRWHITE_MS) || 30000;
const RESULT_MS = Number(process.env.UNDERCOVER_RESULT_MS) || 7000;

const IMAGE = id => gameAssetImage(MODE, id);

const ROLE_DEFINITIONS = {
    civilian: {
        id: 'civilian',
        name: 'พลเมือง',
        team: 'civilians',
        icon: '🙂',
        blurb: 'ได้คำเดียวกับคนส่วนใหญ่',
        image: IMAGE('civilian')
    },
    undercover: {
        id: 'undercover',
        name: 'สายแฝง',
        team: 'undercover',
        icon: '🕶️',
        blurb: 'ได้คำที่คล้ายแต่ไม่เหมือน',
        image: IMAGE('undercover')
    },
    mrwhite: {
        id: 'mrwhite',
        name: 'Mr. White',
        team: 'undercover',
        icon: '❔',
        blurb: 'ไม่มีคำ ต้องเนียนตามวง',
        image: IMAGE('mrwhite')
    }
};

const TEAM_LABELS = {
    civilians: 'พลเมือง',
    undercover: 'ฝ่ายแฝง',
    mrwhite: 'Mr. White'
};

// ---------------------------------------------------------------- word pairs

function parseWordPairs(text) {
    return String(text || '')
        .split(/\r?\n/)
        .slice(1)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(',').map(cell => cell.trim()))
        .filter(cells => cells.length >= 3 && cells[1] && cells[2] && cells[1] !== cells[2])
        .map(([category, a, b]) => ({ id: `${a}|${b}`, category, a, b }));
}

let WORD_PAIRS = [];
try {
    WORD_PAIRS = parseWordPairs(fs.readFileSync(path.join(__dirname, '..', 'words', 'undercover-th.csv'), 'utf8'));
} catch (error) {
    WORD_PAIRS = [];
}
if (!WORD_PAIRS.length) {
    WORD_PAIRS = [{ id: 'กาแฟ|ชา', category: 'เครื่องดื่ม', a: 'กาแฟ', b: 'ชา' }];
}

function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

/** เลือกคู่คำที่ห้องนี้ยังไม่เคยใช้ — ใช้ครบทุกคู่แล้วค่อยวนใหม่ */
function pickWordPair(room) {
    const previous = Array.isArray(room.undercoverUsedPairs)
        ? room.undercoverUsedPairs
        : (Array.isArray(room.gameState?.usedPairIds) ? room.gameState.usedPairIds : []);
    let used = new Set(previous);
    let pool = WORD_PAIRS.filter(pair => !used.has(pair.id));
    if (!pool.length) {
        used = new Set();
        pool = WORD_PAIRS;
    }
    const pair = pickRandom(pool);
    used.add(pair.id);
    room.undercoverUsedPairs = Array.from(used);
    const swap = Math.random() < 0.5;
    return {
        id: pair.id,
        category: pair.category,
        civilian: swap ? pair.b : pair.a,
        undercover: swap ? pair.a : pair.b,
        usedPairIds: room.undercoverUsedPairs
    };
}

/** เทียบคำแบบหลวม: ตัดช่องว่าง/ตัวพิมพ์/อักขระมองไม่เห็น */
function normalizeWord(text) {
    return String(text == null ? '' : text)
        .normalize('NFC')
        .replace(/[​-‍﻿]/g, '')
        .toLowerCase()
        .replace(/[\s\-_.·'"!?]+/g, '');
}

function cleanText(text, maxLength) {
    return String(text == null ? '' : text)
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function getRoleCounts(playerCount, mrWhiteEnabled) {
    const count = Number(playerCount) || 0;
    return {
        undercover: count >= 7 ? 2 : 1,
        mrWhite: mrWhiteEnabled && count >= MR_WHITE_MIN_PLAYERS ? 1 : 0
    };
}

// ---------------------------------------------------------------- state

function createInitialState() {
    return {
        mode: MODE,
        status: 'waiting',
        phase: 'lobby',
        step: 0,
        round: 0,
        players: [],
        pair: null,
        usedPairIds: [],
        roleCounts: { undercover: 0, mrWhite: 0 },
        startOffset: 0,
        speakerOrder: [],
        speakerIndex: 0,
        votes: {},
        voteCandidates: [],
        isRevote: false,
        lastElimination: null,
        mrWhiteGuess: null,
        clues: [],
        departed: {},
        staleRounds: 0,
        winner: null,
        history: [],
        rosterSnapshot: [],
        phaseEndsAt: null,
        statsRecordedAt: null,
        returnLobbyEndsAt: null,
        fxSeq: 0,
        fx: []
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
        role: null,
        word: null,
        alive: true,
        ready: false,
        spokeRound: 0,
        eliminatedRound: null,
        left: false
    };
}

function isConnectedRoomPlayer(player) {
    return !!(player && player.playerId && player.socketId);
}

/** แจกเฉพาะคนที่ออนไลน์อยู่ตอนเริ่ม (บอทมี socketId ปลอม = นับว่าออนไลน์) */
function resetRoomGame(room) {
    const seated = (room.players || []).filter(isConnectedRoomPlayer);
    return {
        ...createInitialState(),
        players: seated.map(player => createPlayerState(player, {
            isAdmin: player.permission === 'admin' || player.playerId === room.admin
        }))
    };
}

function getPlayer(room, playerId) {
    return (room.gameState?.players || []).find(player => player.playerId === playerId) || null;
}

function getAlivePlayers(room) {
    return (room.gameState?.players || []).filter(player => player.alive);
}

function isOnline(room, playerId) {
    const roomPlayer = (room.players || []).find(player => player.playerId === playerId);
    return !!(roomPlayer && roomPlayer.socketId);
}

// หลุดสั้น ๆ (รีเฟรช/เปลี่ยนหน้า) ยังนับว่าอยู่ — ถือว่า "ไม่อยู่" เมื่อหลุดเกิน AWAY_GRACE_MS
const AWAY_GRACE_MS = 8000;
function isPresent(room, playerId, now = Date.now()) {
    const roomPlayer = (room.players || []).find(player => player.playerId === playerId);
    if (!roomPlayer) return false;
    if (roomPlayer.socketId) return true;
    const since = roomPlayer.disconnectedAt ? new Date(roomPlayer.disconnectedAt).getTime() : 0;
    return Number.isFinite(since) && since > 0 && now - since < AWAY_GRACE_MS;
}

/**
 * roomManager.leaveRoom ตัดคนออกจาก gameState.players ก่อนเรียก handlePlayerLeft และถ้ากลับเข้าห้อง
 * จะดันสำเนาตอนก่อนออก (ยัง alive) กลับมา — ต้องกันไม่ให้ซ้ำ/ฟื้นคืนชีพ
 */
function syncRoster(room) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || !Array.isArray(state.players)) return;
    const seen = new Set();
    state.players = state.players.filter(player => {
        if (!player || !player.playerId || seen.has(player.playerId)) return false;
        seen.add(player.playerId);
        return true;
    });
    const departed = state.departed || {};
    state.players.forEach(player => {
        if (!departed[player.playerId]) return;
        player.alive = false;
        player.left = true;
        if (player.eliminatedRound == null) player.eliminatedRound = departed[player.playerId].round;
    });
}

function wordForRole(state, role) {
    if (!state.pair || role === 'mrwhite') return null;
    return role === 'undercover' ? state.pair.undercover : state.pair.civilian;
}

/** คนที่ถูกตัดออกจาก players ไปแล้ว — ใส่ที่นั่งกลับเป็นคนที่ออก เพื่อให้ทั้งวงยังเห็นบท/นับสถิติ */
function restoreDepartedSeat(room, playerId) {
    const state = room.gameState;
    const roster = state.rosterSnapshot || [];
    const snap = roster.find(entry => entry.playerId === playerId);
    if (!snap) return null;
    const stored = room.rejoinableGamePlayers instanceof Map ? room.rejoinableGamePlayers.get(playerId) : null;
    const seat = {
        ...createPlayerState({ playerId, playerName: snap.name }),
        ...(stored || {}),
        playerId,
        name: (stored && stored.name) || snap.name,
        role: snap.role,
        word: wordForRole(state, snap.role),
        alive: stored ? stored.alive !== false : true
    };
    delete seat.socketId;
    delete seat.leftAt;
    delete seat.lastKnownRoomProfile;
    const order = roster.map(entry => entry.playerId);
    const at = state.players.filter(player => order.indexOf(player.playerId) < order.indexOf(playerId)).length;
    state.players.splice(at, 0, seat);
    return seat;
}

function isUndercoverSide(player) {
    return player && (player.role === 'undercover' || player.role === 'mrwhite');
}

function bumpStep(room) {
    room.gameState.step = (Number(room.gameState.step) || 0) + 1;
}

function setPhase(room, phase, durationMs) {
    const state = room.gameState;
    state.phase = phase;
    state.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
    bumpStep(room);
}

function pushHistory(room, icon, text, kind = null) {
    room.gameState.history = [
        { icon, text, kind, round: room.gameState.round || 0, at: new Date().toISOString() },
        ...(room.gameState.history || [])
    ].slice(0, 60);
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (state.fxSeq || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, ...event }].slice(-8);
}

// ---------------------------------------------------------------- start

function startGame(room) {
    const state = resetRoomGame(room);
    const count = state.players.length;
    if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
        throw new Error(`คำใครไม่เหมือนเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน (ออนไลน์ตอนนี้ ${count} คน)`);
    }

    const pair = pickWordPair(room);
    const counts = getRoleCounts(count, !!room.settings?.undercoverMrWhite);
    const shuffled = shuffle(state.players.map(player => player.playerId));
    const undercoverIds = new Set(shuffled.slice(0, counts.undercover));
    const mrWhiteIds = new Set(shuffled.slice(counts.undercover, counts.undercover + counts.mrWhite));

    state.players.forEach(player => {
        if (mrWhiteIds.has(player.playerId)) {
            player.role = 'mrwhite';
            player.word = null;
        } else if (undercoverIds.has(player.playerId)) {
            player.role = 'undercover';
            player.word = pair.undercover;
        } else {
            player.role = 'civilian';
            player.word = pair.civilian;
        }
    });

    state.status = 'playing';
    state.pair = { id: pair.id, category: pair.category, civilian: pair.civilian, undercover: pair.undercover };
    state.usedPairIds = pair.usedPairIds;
    state.roleCounts = counts;
    state.startOffset = Math.floor(Math.random() * count);
    state.rosterSnapshot = state.players.map(player => ({
        playerId: player.playerId,
        name: player.name,
        role: player.role
    }));
    room.gameState = state;

    setPhase(room, 'reveal', REVEAL_MS);
    const extra = counts.mrWhite ? ' + Mr. White 1 คน' : '';
    pushHistory(room, '🃏', `แจกคำแล้ว — สายแฝง ${counts.undercover} คน${extra} · แตะการ์ดดูคำ แล้วกดพร้อม`, 'deal');
    pushFx(room, { kind: 'deal' });
    return room.gameState;
}

// ---------------------------------------------------------------- guards

function assertPlaying(room) {
    syncRoster(room);
    const state = room?.gameState;
    if (!state || state.mode !== MODE || state.phase === 'lobby') {
        throw new Error('เกมยังไม่เริ่ม');
    }
    if (state.phase === 'finished') {
        throw new Error('เกมจบแล้ว');
    }
    return state;
}

function assertStep(state, context) {
    const step = context && context.step;
    if (step === undefined || step === null || step === '' || Number(step) !== Number(state.step)) {
        throw new Error('จังหวะเกมเปลี่ยนไปแล้ว — ดูหน้าจออีกครั้งแล้วกดใหม่');
    }
}

function assertPhase(state, phase, message) {
    if (state.phase !== phase) throw new Error(message);
}

function assertAlivePlayer(room, playerId) {
    const player = getPlayer(room, playerId);
    if (!player) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    if (!player.alive) throw new Error('คุณถูกโหวตออกแล้ว — ดูเกมต่อได้');
    return player;
}

function isHost(room, playerId) {
    return !!playerId && room.admin === playerId;
}

// ---------------------------------------------------------------- reveal

function allReady(room) {
    return getAlivePlayers(room).every(player => player.ready);
}

function submitReady(room, playerId, context = {}) {
    const state = assertPlaying(room);
    assertPhase(state, 'reveal', 'ตอนนี้ไม่ใช่ช่วงดูคำ');
    assertStep(state, context);
    const player = assertAlivePlayer(room, playerId);
    if (player.ready) throw new Error('กดพร้อมไปแล้ว');
    player.ready = true;
    if (allReady(room)) startClueRound(room);
    return room.gameState;
}

// ---------------------------------------------------------------- clue

function buildSpeakerOrder(room) {
    const state = room.gameState;
    const alive = getAlivePlayers(room);
    if (!alive.length) return [];
    const offset = ((state.startOffset || 0) + Math.max(0, state.round - 1)) % alive.length;
    let order = alive.slice(offset).concat(alive.slice(0, offset));
    // Mr. White ห้ามพูดคนแรก (ไม่มีคำให้เกาะ) — เลื่อนไปคนถัดไปที่ไม่ใช่ Mr. White
    const firstOk = order.findIndex(player => player.role !== 'mrwhite');
    if (firstOk > 0) order = order.slice(firstOk).concat(order.slice(0, firstOk));
    return order.map(player => player.playerId);
}

function currentSpeakerId(state) {
    return state.phase === 'clue' ? (state.speakerOrder[state.speakerIndex] || null) : null;
}

function startClueRound(room) {
    const state = room.gameState;
    state.round += 1;
    state.votes = {};
    state.voteCandidates = [];
    state.isRevote = false;
    state.speakerOrder = buildSpeakerOrder(room);
    state.speakerIndex = -1;
    pushHistory(room, '🗣️', `รอบที่ ${state.round} — ใบ้คนละ 1 คำ ตามลำดับ`, 'round');
    pushFx(room, { kind: 'round', round: state.round });
    return advanceSpeaker(room);
}

/** ไปคนพูดถัดไปที่ยังรอดและออนไลน์ — หมดคิวแล้วเข้าโหวต */
function advanceSpeaker(room) {
    const state = room.gameState;
    let index = state.speakerIndex + 1;
    while (index < state.speakerOrder.length) {
        const candidate = getPlayer(room, state.speakerOrder[index]);
        if (candidate && candidate.alive && isPresent(room, candidate.playerId)) break;
        if (candidate && candidate.alive) {
            pushHistory(room, '📴', `${candidate.name} ออฟไลน์ — ข้ามตาพูด`, 'skip');
        }
        index += 1;
    }
    state.speakerIndex = index;
    if (index >= state.speakerOrder.length) {
        return startVote(room, null);
    }
    setPhase(room, 'clue', CLUE_MS);
    return state;
}

function submitClueDone(room, playerId, context = {}) {
    const state = assertPlaying(room);
    assertPhase(state, 'clue', 'ตอนนี้ไม่ใช่ช่วงใบ้');
    assertStep(state, context);
    const player = assertAlivePlayer(room, playerId);
    if (currentSpeakerId(state) !== playerId) throw new Error('ยังไม่ถึงตาคุณพูด');

    const text = cleanText(context.text, CLUE_MAX_LENGTH);
    if (text && player.word && normalizeWord(text).includes(normalizeWord(player.word))) {
        throw new Error('ห้ามพิมพ์คำของตัวเองตรง ๆ — ใบ้อ้อม ๆ');
    }
    player.spokeRound = state.round;
    if (text) {
        state.clues = [...(state.clues || []), { round: state.round, playerId, name: player.name, text }].slice(-80);
        pushHistory(room, '💬', `${player.name}: “${text}”`, 'clue');
    } else {
        pushHistory(room, '🗣️', `${player.name} ใบ้แล้ว`, 'clue');
    }
    return advanceSpeaker(room);
}

/** หัวห้องข้ามคนที่ไม่พูด (AFK) */
function skipSpeaker(room, actorId, context = {}) {
    const state = assertPlaying(room);
    assertPhase(state, 'clue', 'ตอนนี้ไม่ใช่ช่วงใบ้');
    assertStep(state, context);
    if (!isHost(room, actorId)) throw new Error('มีแค่หัวหน้าห้องที่ข้ามตาได้');
    const speaker = getPlayer(room, currentSpeakerId(state));
    if (speaker) pushHistory(room, '⏭️', `ข้ามตา ${speaker.name}`, 'skip');
    return advanceSpeaker(room);
}

// ---------------------------------------------------------------- vote

function startVote(room, candidates) {
    const state = room.gameState;
    state.votes = {};
    state.isRevote = Array.isArray(candidates) && candidates.length > 0;
    state.voteCandidates = state.isRevote
        ? candidates.filter(id => getPlayer(room, id)?.alive)
        : getAlivePlayers(room).map(player => player.playerId);
    state.speakerIndex = state.speakerOrder.length;
    setPhase(room, 'vote', VOTE_MS);
    if (state.isRevote) {
        const names = state.voteCandidates.map(id => getPlayer(room, id)?.name).filter(Boolean).join(' / ');
        pushHistory(room, '⚖️', `โหวตเสมอ — โหวตใหม่เฉพาะ ${names}`, 'revote');
    } else {
        pushHistory(room, '🗳️', 'ถึงเวลาโหวต — เลือกคนที่คิดว่าคำไม่เหมือน', 'vote');
    }
    pushFx(room, { kind: 'vote', isRevote: state.isRevote });
    return state;
}

function validVoteTargets(room, voterId) {
    const state = room.gameState;
    return (state.voteCandidates || []).filter(id => id !== voterId && getPlayer(room, id)?.alive);
}

function allVoted(room) {
    const state = room.gameState;
    return getAlivePlayers(room)
        .filter(player => isPresent(room, player.playerId))
        .filter(player => validVoteTargets(room, player.playerId).length > 0)
        .every(player => Object.prototype.hasOwnProperty.call(state.votes, player.playerId));
}

function submitVote(room, playerId, targetPlayerId, context = {}) {
    const state = assertPlaying(room);
    assertPhase(state, 'vote', 'ตอนนี้ไม่ใช่ช่วงโหวต');
    assertStep(state, context);
    assertAlivePlayer(room, playerId);
    if (Object.prototype.hasOwnProperty.call(state.votes, playerId)) throw new Error('โหวตไปแล้ว');
    if (targetPlayerId === playerId) throw new Error('โหวตตัวเองไม่ได้');
    if (!validVoteTargets(room, playerId).includes(targetPlayerId)) {
        throw new Error(state.isRevote ? 'โหวตรอบนี้เลือกได้เฉพาะคนที่เสมอ' : 'เลือกผู้เล่นที่ยังอยู่ในเกม');
    }
    state.votes[playerId] = targetPlayerId;
    if (allVoted(room)) resolveVotes(room);
    return room.gameState;
}

function tallyVotes(room) {
    const state = room.gameState;
    const counts = {};
    Object.entries(state.votes || {}).forEach(([voterId, targetId]) => {
        if (!getPlayer(room, voterId)?.alive) return;
        if (!state.voteCandidates.includes(targetId) || !getPlayer(room, targetId)?.alive) return;
        counts[targetId] = (counts[targetId] || 0) + 1;
    });
    return counts;
}

function resolveVotes(room) {
    const state = room.gameState;
    const counts = tallyVotes(room);
    const voteMap = { ...(state.votes || {}) };
    const entries = Object.entries(counts);
    const top = entries.reduce((max, [, value]) => Math.max(max, value), 0);
    const leaders = entries.filter(([, value]) => value === top && top > 0).map(([id]) => id);

    if (leaders.length === 1) {
        return eliminate(room, leaders[0], { counts, votes: voteMap });
    }

    if (leaders.length > 1 && !state.isRevote) {
        pushFx(room, { kind: 'tie', candidates: leaders });
        return startVote(room, leaders);
    }

    // เสมอซ้ำ หรือไม่มีใครโหวต — รอบนี้ไม่มีใครออก
    state.staleRounds = (state.staleRounds || 0) + 1;
    state.lastElimination = {
        round: state.round,
        playerId: null,
        name: null,
        role: null,
        reason: leaders.length > 1 ? 'tie' : 'novotes',
        counts,
        votes: voteMap
    };
    pushHistory(room, '🤝', leaders.length > 1 ? 'เสมออีก — รอบนี้ไม่มีใครออก' : 'ไม่มีใครโหวต — รอบนี้ไม่มีใครออก', 'noelim');
    pushFx(room, { kind: 'elimination', playerId: null });
    if (state.staleRounds >= MAX_STALE_ROUNDS) {
        return finishGame(room, 'undercover', `วงโหวตไม่ลงติดกัน ${MAX_STALE_ROUNDS} รอบ — ฝ่ายแฝงรอด`);
    }
    setPhase(room, 'elimination', RESULT_MS);
    return state;
}

function eliminate(room, playerId, tally) {
    const state = room.gameState;
    const player = getPlayer(room, playerId);
    player.alive = false;
    player.eliminatedRound = state.round;
    state.staleRounds = 0;
    const role = ROLE_DEFINITIONS[player.role] || ROLE_DEFINITIONS.civilian;
    state.lastElimination = {
        round: state.round,
        playerId,
        name: player.name,
        role: player.role,
        reason: 'vote',
        counts: tally.counts,
        votes: tally.votes
    };
    pushHistory(room, role.icon, `${player.name} ถูกโหวตออก — เป็น${role.name}`, 'elimination');
    pushFx(room, { kind: 'elimination', playerId, role: player.role });

    if (player.role === 'mrwhite') {
        state.mrWhiteGuess = { round: state.round, playerId, name: player.name, guess: null, correct: null, pending: true };
        setPhase(room, 'mrwhite', MRWHITE_MS);
        pushHistory(room, '❔', `${player.name} คือ Mr. White — ได้ทายคำของพลเมือง 1 ครั้ง`, 'mrwhite');
        return state;
    }

    if (checkWinner(room)) return state;
    setPhase(room, 'elimination', RESULT_MS);
    return state;
}

// ---------------------------------------------------------------- mr. white

function submitMrWhiteGuess(room, playerId, guess, context = {}) {
    const state = assertPlaying(room);
    assertPhase(state, 'mrwhite', 'ตอนนี้ไม่ใช่ช่วงทายคำ');
    assertStep(state, context);
    const pending = state.mrWhiteGuess;
    if (!pending || !pending.pending || pending.playerId !== playerId) {
        throw new Error('มีแค่ Mr. White ที่เพิ่งออกที่ทายได้');
    }
    const text = cleanText(guess, GUESS_MAX_LENGTH);
    if (!text) throw new Error('พิมพ์คำที่คิดว่าเป็นคำของพลเมือง');
    return resolveMrWhiteGuess(room, text);
}

function resolveMrWhiteGuess(room, text) {
    const state = room.gameState;
    const pending = state.mrWhiteGuess;
    const correct = !!text && normalizeWord(text) === normalizeWord(state.pair?.civilian);
    state.mrWhiteGuess = { ...pending, guess: text || null, correct, pending: false };
    pushFx(room, { kind: 'mrwhite', correct });
    if (correct) {
        pushHistory(room, '🎯', `${pending.name} ทายถูก “${text}” — Mr. White ชนะ!`, 'mrwhite-win');
        return finishGame(room, 'mrwhite', `Mr. White ทายคำพลเมืองถูก: ${text}`);
    }
    pushHistory(room, '❌', text ? `${pending.name} ทาย “${text}” — ผิด` : `${pending.name} ไม่ได้ทาย — หมดเวลา`, 'mrwhite-miss');
    if (checkWinner(room)) return state;
    setPhase(room, 'elimination', RESULT_MS);
    return state;
}

// ---------------------------------------------------------------- next round / win

/** หัวห้องกดไปต่อจากหน้าเฉลยได้เลย ไม่ต้องรอเวลา */
function continueAfterResult(room, actorId, context = {}) {
    const state = assertPlaying(room);
    assertPhase(state, 'elimination', 'ตอนนี้ยังไปรอบต่อไม่ได้');
    assertStep(state, context);
    if (!isHost(room, actorId)) throw new Error('มีแค่หัวหน้าห้องที่กดไปต่อได้');
    return startClueRound(room);
}

function checkWinner(room) {
    const state = room.gameState;
    if (state.phase === 'finished') return true;
    const alive = getAlivePlayers(room);
    const sideAlive = alive.filter(isUndercoverSide).length;
    const civAlive = alive.length - sideAlive;
    if (sideAlive === 0) {
        finishGame(room, 'civilians', 'จับฝ่ายแฝงได้ครบ');
        return true;
    }
    if (civAlive === 0 || alive.length <= 2) {
        finishGame(room, 'undercover', 'ฝ่ายแฝงรอดถึงสองคนสุดท้าย');
        return true;
    }
    return false;
}

function finishGame(room, team, reason) {
    const state = room.gameState;
    const roster = getRosterWithRoles(room);
    const winnerIds = roster
        .filter(player => (team === 'civilians'
            ? player.role === 'civilian'
            : (team === 'mrwhite' ? player.role === 'mrwhite' : isUndercoverSide(player))))
        .map(player => player.playerId);
    state.winner = {
        team,
        label: TEAM_LABELS[team] || team,
        reason,
        winnerIds,
        name: `${TEAM_LABELS[team] || team}ชนะ`
    };
    state.phase = 'finished';
    state.status = 'undercover_finished';
    state.phaseEndsAt = null;
    state.speakerIndex = state.speakerOrder.length;
    bumpStep(room);
    pushHistory(room, '🏆', `${TEAM_LABELS[team] || team}ชนะ — ${reason}`, 'winner');
    pushFx(room, { kind: 'finish', team });
    return state;
}

function getRosterWithRoles(room) {
    const state = room.gameState;
    const current = state.players || [];
    const presentIds = new Set(current.map(player => player.playerId));
    return current.concat((state.rosterSnapshot || []).filter(player => !presentIds.has(player.playerId)));
}

/** ผู้เล่นที่ต้องนับสถิติ = ทุกคนที่ได้บทตอนเริ่ม (รวมคนที่ออกกลางเกม) */
function getScoringPlayers(room) {
    return getRosterWithRoles(room).filter(player => player.playerId && player.role);
}

// ---------------------------------------------------------------- timeouts

function autoResolvePhase(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE) return state;
    if (state.phase === 'finished' || state.phase === 'lobby') return state;
    if (state.phaseEndsAt && now < state.phaseEndsAt) return state;
    syncRoster(room);

    if (state.phase === 'reveal') {
        getAlivePlayers(room).forEach(player => { player.ready = true; });
        pushHistory(room, '⏰', 'หมดเวลาดูคำ — เริ่มใบ้เลย', 'timeout');
        return startClueRound(room);
    }
    if (state.phase === 'clue') {
        const speaker = getPlayer(room, currentSpeakerId(state));
        if (speaker) pushHistory(room, '⏰', `${speaker.name} หมดเวลาพูด — ไปคนถัดไป`, 'timeout');
        return advanceSpeaker(room);
    }
    if (state.phase === 'vote') {
        const missing = getAlivePlayers(room).filter(player => !Object.prototype.hasOwnProperty.call(state.votes, player.playerId));
        if (missing.length) pushHistory(room, '⏰', `หมดเวลาโหวต — ${missing.length} คนงดออกเสียง`, 'timeout');
        return resolveVotes(room);
    }
    if (state.phase === 'mrwhite') {
        return resolveMrWhiteGuess(room, '');
    }
    if (state.phase === 'elimination') {
        return startClueRound(room);
    }
    return state;
}

// ---------------------------------------------------------------- leave

function handlePlayerLeft(room, playerId) {
    const state = room?.gameState;
    if (!state || state.mode !== MODE || state.phase === 'finished' || state.phase === 'lobby') return state;
    syncRoster(room);
    if (state.departed && state.departed[playerId]) return state;
    const player = getPlayer(room, playerId) || restoreDepartedSeat(room, playerId);
    if (!player) return state;
    state.departed = { ...(state.departed || {}), [playerId]: { round: state.round } };

    const wasAlive = player.alive;
    player.left = true;
    if (wasAlive) {
        player.alive = false;
        player.eliminatedRound = state.round;
        pushHistory(room, '🚪', `${player.name} ออกจากเกม`, 'left');
    }

    if (state.phase === 'mrwhite' && state.mrWhiteGuess?.pending && state.mrWhiteGuess.playerId === playerId) {
        return resolveMrWhiteGuess(room, '');
    }
    if (!wasAlive) return state;

    if (checkWinner(room)) return state;

    if (state.phase === 'reveal') {
        if (allReady(room)) startClueRound(room);
        return room.gameState;
    }
    if (state.phase === 'clue') {
        if (currentSpeakerId(state) === playerId) return advanceSpeaker(room);
        return state;
    }
    if (state.phase === 'vote') {
        delete state.votes[playerId];
        Object.keys(state.votes).forEach(voterId => {
            if (state.votes[voterId] === playerId) delete state.votes[voterId];
        });
        state.voteCandidates = state.voteCandidates.filter(id => id !== playerId);
        // โหวตซ้ำเหลือคนเสมอไม่ถึง 2 = ไม่มีอะไรให้เลือกแล้ว สรุปผลจากเสียงที่มี
        if ((state.isRevote && state.voteCandidates.length < 2) || allVoted(room)) resolveVotes(room);
        return room.gameState;
    }
    return state;
}

// ---------------------------------------------------------------- client view

function roleMeta(roleId) {
    const role = ROLE_DEFINITIONS[roleId];
    return role ? { id: role.id, name: role.name, team: role.team, icon: role.icon, image: role.image, blurb: role.blurb } : null;
}

function buildClientState(room, viewerPlayerId) {
    syncRoster(room);
    const state = room?.gameState || createInitialState();
    const viewer = getPlayer(room, viewerPlayerId);
    const isFinished = state.phase === 'finished';
    const speakerId = currentSpeakerId(state);
    const votePhase = state.phase === 'vote';
    const hostId = room?.admin || null;

    const players = (state.players || []).map(player => {
        return {
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
            alive: player.alive,
            left: !!player.left,
            online: isOnline(room, player.playerId),
            ready: !!player.ready,
            spoke: player.spokeRound === state.round && state.round > 0,
            hasVoted: votePhase && Object.prototype.hasOwnProperty.call(state.votes || {}, player.playerId),
            isSelf: player.playerId === viewerPlayerId,
            isHost: player.playerId === hostId,
            isSpeaker: player.playerId === speakerId,
            eliminatedRound: player.eliminatedRound,
            // บทเปิดเมื่อถูกโหวตออก/จบเกม — คำเปิดตอนจบเกมเท่านั้น
            role: (isFinished || !player.alive) ? roleMeta(player.role) : null,
            word: isFinished ? player.word : null
        };
    });

    const selfRoleVisible = viewer && (isFinished || !viewer.alive || viewer.role === 'mrwhite');
    const self = viewer ? {
        playerId: viewer.playerId,
        alive: viewer.alive,
        word: viewer.word,
        isMrWhite: viewer.role === 'mrwhite',
        role: selfRoleVisible ? roleMeta(viewer.role) : null,
        ready: !!viewer.ready,
        isSpeaker: viewer.playerId === speakerId,
        isHost: viewer.playerId === hostId,
        hasVoted: votePhase && Object.prototype.hasOwnProperty.call(state.votes || {}, viewer.playerId),
        voteTargetId: votePhase ? (state.votes || {})[viewer.playerId] || null : null,
        voteTargets: votePhase && viewer.alive ? validVoteTargets(room, viewer.playerId) : [],
        canGuess: state.phase === 'mrwhite' && !!state.mrWhiteGuess?.pending && state.mrWhiteGuess.playerId === viewer.playerId
    } : null;

    const alivePlayers = getAlivePlayers(room);
    const last = state.lastElimination;

    return {
        mode: MODE,
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        round: state.round || 0,
        isFinished,
        phaseEndsAt: state.phaseEndsAt,
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        tableMode: room?.settings?.tableMode || 'inPerson',
        roleCounts: { ...(state.roleCounts || {}) },
        aliveCount: getAlivePlayers(room).length,
        readyCount: alivePlayers.filter(player => player.ready).length,
        readyTotal: alivePlayers.length,
        speakerId,
        speakerOrder: state.phase === 'clue' ? [...(state.speakerOrder || [])] : [],
        speakerIndex: state.speakerIndex,
        vote: votePhase ? {
            isRevote: !!state.isRevote,
            candidates: [...(state.voteCandidates || [])],
            votedCount: Object.keys(state.votes || {}).length,
            voterCount: getAlivePlayers(room).filter(player => validVoteTargets(room, player.playerId).length > 0).length
        } : null,
        lastElimination: last ? {
            round: last.round,
            playerId: last.playerId,
            name: last.name,
            role: last.playerId ? roleMeta(last.role) : null,
            reason: last.reason,
            counts: { ...(last.counts || {}) },
            votes: { ...(last.votes || {}) }
        } : null,
        mrWhiteGuess: state.mrWhiteGuess ? {
            playerId: state.mrWhiteGuess.playerId,
            name: state.mrWhiteGuess.name,
            pending: !!state.mrWhiteGuess.pending,
            guess: state.mrWhiteGuess.pending ? null : state.mrWhiteGuess.guess,
            correct: state.mrWhiteGuess.pending ? null : state.mrWhiteGuess.correct
        } : null,
        clues: (state.clues || []).map(clue => ({ ...clue })),
        winner: isFinished && state.winner ? { ...state.winner, winnerIds: [...(state.winner.winnerIds || [])] } : null,
        pair: isFinished && state.pair ? { civilian: state.pair.civilian, undercover: state.pair.undercover, category: state.pair.category } : null,
        history: (state.history || []).slice(0, 30),
        self,
        players,
        roles: Object.values(ROLE_DEFINITIONS).map(role => roleMeta(role.id)),
        cardBack: IMAGE('back'),
        cardFront: IMAGE('card-front'),
        timers: { reveal: REVEAL_MS, clue: CLUE_MS, vote: VOTE_MS, mrwhite: MRWHITE_MS, result: RESULT_MS },
        fx: state.fx || []
    };
}

/** /m สำหรับแอดมินเว็บเท่านั้น — app.js ต้องเช็กสิทธิ์ก่อนเรียก */
function buildAdminReveal(room) {
    const state = room?.gameState || createInitialState();
    return {
        phase: state.phase,
        round: state.round,
        pair: state.pair ? { ...state.pair } : null,
        players: (state.players || []).map(player => ({
            playerId: player.playerId,
            name: player.name,
            role: player.role,
            roleName: ROLE_DEFINITIONS[player.role]?.name || '-',
            word: player.word,
            alive: player.alive
        }))
    };
}

module.exports = {
    id: MODE,
    label: 'คำใครไม่เหมือน',
    description: 'ทุกคนได้คำเหมือนกัน ยกเว้นสายแฝงที่ได้คำคล้าย ๆ — ใบ้คนละคำแล้วโหวตหาคนคำไม่เหมือน · 4–10 คน',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    MR_WHITE_MIN_PLAYERS,
    ROLE_DEFINITIONS,
    TEAM_LABELS,
    WORD_PAIRS,
    REVEAL_MS,
    CLUE_MS,
    VOTE_MS,
    MRWHITE_MS,
    RESULT_MS,
    MAX_STALE_ROUNDS,
    parseWordPairs,
    pickWordPair,
    normalizeWord,
    getRoleCounts,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    submitReady,
    submitClueDone,
    skipSpeaker,
    submitVote,
    submitMrWhiteGuess,
    continueAfterResult,
    autoResolvePhase,
    handlePlayerLeft,
    getScoringPlayers,
    buildClientState,
    buildAdminReveal
};
