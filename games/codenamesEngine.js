/**
 * สายลับคำใบ้ — engine ล้วน (ไม่มี socket/IO) ทดสอบได้ด้วย rng/now ที่ส่งเข้าไป
 *
 * สองทีม แดง/น้ำเงิน ทีมละหัวหน้า 1 คน + ลูกทีม ≥1 · กระดาน 5×5
 * ทีมที่เริ่มก่อนมีคำ 9 ใบ อีกทีม 8 · คนเดินถนน 7 · มือสังหาร 1
 * หัวหน้าใบ้ 1 คำ + ตัวเลข → ลูกทีมแตะเสนอการ์ด เสียงข้างมากเปิด หรือคนที่เสนอใบนั้นกด "เปิดเลย"
 *
 * กติกาตามคู่มือ Codenames (CGE) — ดู rules/codenames/rules.md
 * - โหมดร่วมมือ (2–3 คน หรือวงที่ไม่อยากแข่ง): มีทีมเดียว เริ่มก่อน 9 คำ · ตาอีกทีม หัวหน้าเลือกปิดสายลับ
 *   ฝ่ายตรงข้าม 1 ใบ · เจอครบก่อน = ชนะ (คะแนน = สายลับฝ่ายตรงข้ามที่ยังเหลือ) · ฝ่ายตรงข้ามถูกปิดครบ/มือสังหาร = แพ้
 * - คำใบ้ผิดกติกา: หัวหน้าอีกทีมเป็นคนตัดสิน (ตามคู่มือ) — กด "ทักท้วง" ได้ทีมละ 1 ครั้งต่อเกม
 *   → จบเทิร์นทันที + หัวหน้าที่ทักปิดคำของทีมตัวเองได้ 1 ใบก่อนใบ้
 *
 * ความลับ: สีของการ์ดที่ยังไม่เปิด (กุญแจ) ส่งให้เฉพาะหัวหน้า — buildClientState เป็นคนตัดสิน
 * ทุก action ตรวจฝั่งนี้: ตาใคร เฟสไหน บทอะไร การ์ดเปิดแล้วหรือยัง step ตรงไหม
 */

const { WORDS, COMPOUND_SPLITS } = require('./codenamesWords');

const MODE = 'codenames';
const FINISHED_STATUS = 'codenames_finished';
const TEAMS = ['red', 'blue'];
const TEAM_LABEL = { red: 'ทีมแดง', blue: 'ทีมน้ำเงิน' };
const ROLE_LABEL = { spymaster: 'หัวหน้า', operative: 'ลูกทีม', spectator: 'ผู้ชม', retired: 'อดีตหัวหน้า' };
const COLOR_LABEL = { red: 'แดง', blue: 'น้ำเงิน', neutral: 'คนเดินถนน', assassin: 'มือสังหาร' };

const BOARD_SIZE = 25;
const STARTING_TEAM_CARDS = 9;
const OTHER_TEAM_CARDS = 8;
const NEUTRAL_CARDS = 7;
const ASSASSIN_CARDS = 1;

// โหมดสองทีมต้อง 4 คน (หัวหน้า + ลูกทีม ทีมละ ≥1) · โหมดร่วมมือ 2 คนก็เล่นได้
const MIN_PLAYERS = 2;
const MIN_VERSUS_PLAYERS = 4;
const MAX_PLAYERS = 12;
// หัวหน้าอีกทีมทักคำใบ้ผิดกติกาได้กี่ครั้งต่อเกม (กันกดทักทุกคำ)
const FLAGS_PER_TEAM = 1;
const MAX_CLUE_NUMBER = 9;
const INFINITE = 'inf';

const CLUE_SECONDS_OPTIONS = [0, 90, 120];
const GUESS_SECONDS_OPTIONS = [0, 60, 90, 120];
const DEFAULT_CLUE_SECONDS = 120;
const DEFAULT_GUESS_SECONDS = 0;

const SPYMASTER_GRACE_MS = Number(process.env.CODENAMES_SPYMASTER_GRACE_MS) || 25000;
const NO_OPERATIVE_GRACE_MS = Number(process.env.CODENAMES_NO_OPERATIVE_GRACE_MS) || 12000;
// หัวหน้าห้องกด "ข้ามเทิร์น" ได้เมื่อเฟสเดิมค้างนานเกินนี้ (กันคน AFK ตอนปิดนาฬิกา) — สั้นกว่านี้ถือว่ายังเล่นอยู่
const HOST_SKIP_AFTER_MS = Number(process.env.CODENAMES_HOST_SKIP_MS) || 60000;
const MAX_CLUE_GRAPHEMES = 24;
// หน้าจบเกมค้างไว้นานกว่าเกมอื่น (ค่าปกติ 10 วิ) ให้ดูกุญแจทั้งกระดาน — app.js อ่านผ่าน engine.finishedReturnMs
const FINISHED_RETURN_MS = Number(process.env.CODENAMES_FINISHED_RETURN_MS) || 30000;
const MAX_HISTORY = 60;
const MAX_FX = 12;

// ---------- Thai text ----------

const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'grapheme' })
    : null;

function graphemes(text) {
    const value = String(text || '');
    if (!graphemeSegmenter) return Array.from(value);
    return Array.from(graphemeSegmenter.segment(value), part => part.segment);
}

// NFC · ตัด zero-width · ตัดช่องว่าง · ตัวพิมพ์เล็ก · นิคหิต+สระอา → สระอำ (พิมพ์ "น้ํา" ก็เท่ากับ "น้ำ")
function normalizeWord(text) {
    return String(text == null ? '' : text)
        .normalize('NFC')
        .replace(/[​-‍⁠﻿]/g, '')
        .replace(/\s+/g, '')
        .replace(/ํ([่-๋]?)า/g, '$1ำ')
        .toLowerCase();
}

// a มี b อยู่ข้างในไหม — เทียบทีละ grapheme ไม่ให้ "ก" ไปจับกลาง "ก้"
const graphemeCache = new Map();
function normalizedGraphemes(text) {
    const key = String(text == null ? '' : text);
    let value = graphemeCache.get(key);
    if (!value) {
        value = graphemes(normalizeWord(key));
        if (graphemeCache.size > 4000) graphemeCache.clear();
        graphemeCache.set(key, value);
    }
    return value;
}

function containsWord(haystack, needle) {
    const hay = normalizedGraphemes(haystack);
    const nee = normalizedGraphemes(needle);
    if (!nee.length || nee.length > hay.length) return false;
    outer:
    for (let i = 0; i <= hay.length - nee.length; i += 1) {
        for (let j = 0; j < nee.length; j += 1) {
            if (hay[i + j] !== nee[j]) continue outer;
        }
        return true;
    }
    return false;
}

// คำประสม: "รถ" ใน "รถไฟ", "ดำน้ำ" ใน "เรือดำน้ำ" → ใบ้ไม่ได้ (คู่มือ: ห้ามใช้ส่วนของคำประสมบนกระดาน)
// ไทยไม่มีช่องว่างคั่นคำ: คำในคลังใช้ชิ้นส่วนที่เขียนไว้ (COMPOUND_SPLITS) · คำอื่นใช้ตัวตัดคำ (Intl.Segmenter)
// โดยข้ามคำที่ตัดแล้วมีชิ้นตัวเดียว (มักเป็นคำทับศัพท์ที่ตัดมั่ว)
// ส่วน = ชิ้นที่ต่อกันพอดี ยาว ≥ 2 ตัวอักษร ไม่ใช่ทั้งคำ — "หมา" ไม่ติด "หมากรุก" (หมาก|รุก)
const wordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('th', { granularity: 'word' })
    : null;

function splitPieces(word) {
    const key = normalizeWord(word);
    if (COMPOUND_SPLITS[key]) return COMPOUND_SPLITS[key].split('|').map(normalizeWord);
    if (!wordSegmenter || !key) return [key];
    const segs = Array.from(wordSegmenter.segment(key), part => part.segment);
    return segs.every(seg => Array.from(seg).length >= 2) ? segs : [key];
}

const partsCache = new Map();
function compoundParts(word) {
    const key = normalizeWord(word);
    if (partsCache.has(key)) return partsCache.get(key);
    const pieces = splitPieces(key);
    const found = new Set();
    for (let i = 0; i < pieces.length; i += 1) {
        let joined = '';
        for (let j = i; j < pieces.length; j += 1) {
            joined += pieces[j];
            if (i === 0 && j === pieces.length - 1) break; // ทั้งคำ — ตรวจแยกอยู่แล้ว
            if (Array.from(joined).length >= 2) found.add(joined);
        }
    }
    const parts = Array.from(found);
    if (partsCache.size > 4000) partsCache.clear();
    partsCache.set(key, parts);
    return parts;
}

function isCompoundPart(clue, boardWord) {
    return compoundParts(boardWord).includes(normalizeWord(clue));
}

// ---------- helpers ----------

function shuffle(items, rng = Math.random) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function otherTeam(team) {
    return team === 'red' ? 'blue' : 'red';
}

function isTeam(team) {
    return team === 'red' || team === 'blue';
}

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function sanitizeClueSeconds(value) {
    const n = Number(value);
    return CLUE_SECONDS_OPTIONS.includes(n) ? n : DEFAULT_CLUE_SECONDS;
}

function sanitizeGuessSeconds(value) {
    const n = Number(value);
    return GUESS_SECONDS_OPTIONS.includes(n) ? n : DEFAULT_GUESS_SECONDS;
}

// ทักท้วงคำใบ้ (หัวหน้าอีกทีมตัดสิน ตามคู่มือ) — ค่าเริ่ม: เปิด
function sanitizeClueFlag(value) {
    if (value === false || value === 'false' || value === 0 || value === '0' || value === 'off') return false;
    return true;
}

function roomPlayer(room, playerId) {
    return (room.players || []).find(p => p.playerId === playerId) || null;
}

function isOnline(room, playerId) {
    const player = roomPlayer(room, playerId);
    return !!(player && player.socketId);
}

function displayName(player) {
    return String((player && (player.playerName || player.name)) || 'ผู้เล่น');
}

// ---------- state ----------

function createInitialState() {
    return {
        mode: MODE,
        status: 'waiting',
        phase: 'lobby',
        players: [],
        roster: [],
        board: [],
        step: 0,
        turnNumber: 0,
        startingTeam: null,
        currentTeam: null,
        clue: null,
        guessesMade: 0,
        votes: {},
        clueLog: [],
        phaseEndsAt: null,
        phaseStartedAt: null,
        settings: { clueSeconds: DEFAULT_CLUE_SECONDS, guessSeconds: DEFAULT_GUESS_SECONDS, clueFlag: true },
        coop: null,
        flagsUsed: { red: 0, blue: 0 },
        bonusCover: null,
        offlineSince: {},
        stuckSince: {},
        winner: null,
        winReason: null,
        history: [],
        fx: [],
        fxSeq: 0,
        statsRecordedAt: null,
        returnLobbyEndsAt: null
    };
}

// รูปแบบที่ roomManager ใส่ไว้ใน gameState.players (ใช้เช็คสิทธิ์เข้า /game เท่านั้น)
function createPlayerState(player) {
    return {
        playerId: player.playerId,
        name: displayName(player),
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

function pushHistory(state, icon, text, kind = null, now = Date.now()) {
    state.history = state.history || [];
    state.history.push({ icon, text, kind, at: new Date(now).toISOString() });
    if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
}

function pushFx(state, event) {
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = (state.fx || []).concat([{ id: state.fxSeq, ...event }]).slice(-MAX_FX);
}

function bumpStep(state) {
    state.step = (Number(state.step) || 0) + 1;
}

function assertStep(state, context) {
    if (context && context.step !== undefined && context.step !== null && Number(context.step) !== Number(state.step)) {
        throw new Error('จังหวะเกมเปลี่ยนไปแล้ว ลองใหม่อีกครั้ง');
    }
}

function rosterEntry(state, playerId) {
    return (state.roster || []).find(p => p.playerId === playerId) || null;
}

function activeMembers(state, team) {
    return (state.roster || []).filter(p => p.team === team && !p.left);
}

function spymasterOf(state, team) {
    return (state.roster || []).find(p => p.team === team && p.role === 'spymaster' && !p.left) || null;
}

function onlineOperatives(room, team) {
    const state = room.gameState;
    return activeMembers(state, team).filter(p => p.role === 'operative' && isOnline(room, p.playerId));
}

// ทั้งสองทีมไม่เหลือลูกทีมเลย (ออกไปหมด) = เล่นต่อไม่ได้แล้ว
function nobodyCanGuess(state) {
    return TEAMS.every(team => activeMembers(state, team).filter(p => p.role === 'operative').length === 0);
}

function remainingFor(state, team) {
    return (state.board || []).filter(card => card.color === team && !card.revealed).length;
}

// ---------- lobby: team picks (เก็บใน room.settings.codenamesTeams) ----------

function lobbyPicks(room) {
    const raw = room?.settings?.codenamesTeams;
    return raw && typeof raw === 'object' ? raw : {};
}

function lobbyMembers(room) {
    const picks = lobbyPicks(room);
    return (room.players || [])
        .filter(p => !isBotId(p.playerId))
        .map(p => {
            const pick = picks[p.playerId] || null;
            return {
                playerId: p.playerId,
                name: displayName(p),
                online: !!p.socketId,
                team: pick && isTeam(pick.team) ? pick.team : null,
                role: pick ? (pick.role === 'spectator' ? 'spectator' : (isTeam(pick.team) ? (pick.role === 'spymaster' ? 'spymaster' : 'operative') : null)) : null
            };
        });
}

function assertLobby(room) {
    const status = room?.gameState?.status;
    if (status === 'playing') throw new Error('เกมเริ่มไปแล้ว เปลี่ยนทีมไม่ได้');
}

function writePicks(room, picks) {
    room.settings = room.settings || {};
    const memberIds = new Set((room.players || []).map(p => p.playerId));
    const clean = {};
    Object.keys(picks).forEach(id => {
        if (memberIds.has(id)) clean[id] = picks[id];
    });
    room.settings.codenamesTeams = clean;
    return clean;
}

function pickTeam(room, playerId, choice = {}) {
    assertLobby(room);
    if (!roomPlayer(room, playerId)) throw new Error('ไม่พบผู้เล่นในห้อง');
    const picks = { ...lobbyPicks(room) };
    const role = choice.role;
    if (role === 'spectator') {
        picks[playerId] = { team: null, role: 'spectator' };
        return writePicks(room, picks);
    }
    if (role === 'none' || (!choice.team && !role)) {
        delete picks[playerId];
        return writePicks(room, picks);
    }
    if (!isTeam(choice.team)) throw new Error('เลือกทีมแดงหรือทีมน้ำเงิน');
    if (role !== 'spymaster' && role !== 'operative') throw new Error('เลือกเป็นหัวหน้าหรือลูกทีม');
    if (role === 'spymaster') {
        const holder = Object.keys(picks).find(id => id !== playerId && picks[id] && picks[id].team === choice.team && picks[id].role === 'spymaster' && roomPlayer(room, id));
        if (holder) {
            if (isOnline(room, holder)) throw new Error(`${TEAM_LABEL[choice.team]}มีหัวหน้าแล้ว`);
            // หัวหน้าเดิมหลุดอยู่ — ให้คนที่อยู่ตรงนี้รับแทน คนเดิมกลับมาเป็นลูกทีม
            picks[holder] = { team: choice.team, role: 'operative' };
        }
    }
    picks[playerId] = { team: choice.team, role };
    return writePicks(room, picks);
}

function shuffleTeams(room, rng = Math.random) {
    assertLobby(room);
    const picks = lobbyPicks(room);
    const members = lobbyMembers(room).filter(m => m.online && m.role !== 'spectator');
    if (members.length < 2) throw new Error('ต้องมีผู้เล่นออนไลน์อย่างน้อย 2 คนถึงจะสุ่มทีมได้');
    const order = shuffle(members, rng);
    const first = rng() < 0.5 ? 'red' : 'blue';
    const next = { ...picks };
    const counts = { red: 0, blue: 0 };
    // ไม่ถึง 4 คน แบ่งสองทีมไม่ได้ → ทุกคนอยู่ทีมเดียว (โหมดร่วมมือ)
    const together = order.length < MIN_VERSUS_PLAYERS;
    order.forEach((member, index) => {
        const team = together || index % 2 === 0 ? first : otherTeam(first);
        next[member.playerId] = { team, role: counts[team] === 0 ? 'spymaster' : 'operative' };
        counts[team] += 1;
    });
    return writePicks(room, next);
}

// ทีมเดียวที่มีคน (อีกทีมว่าง) = โหมดร่วมมือ · คืนสีทีม หรือ null ถ้าเป็นโหมดสองทีม/ยังไม่มีใคร
function coopTeamOf(members) {
    const used = TEAMS.filter(team => members.some(m => m.team === team));
    return used.length === 1 ? used[0] : null;
}

function lobbyCoopTeam(room) {
    return coopTeamOf(lobbyMembers(room).filter(m => m.online && isTeam(m.team)));
}

// คืนข้อความภาษาไทยว่าทำไมยังเริ่มไม่ได้ หรือ null ถ้าพร้อม (นับเฉพาะคนออนไลน์)
function getStartBlockReason(room) {
    const members = lobbyMembers(room).filter(m => m.online);
    if (members.length < MIN_PLAYERS) return `ต้องมีผู้เล่นออนไลน์อย่างน้อย ${MIN_PLAYERS} คน`;
    const unassigned = members.filter(m => !m.role);
    if (unassigned.length) {
        const names = unassigned.slice(0, 3).map(m => m.name).join(', ') + (unassigned.length > 3 ? ` และอีก ${unassigned.length - 3} คน` : '');
        return `ยังไม่ได้เลือกทีม: ${names} — เลือกทีมเอง หรือกด "สุ่มทีม"`;
    }
    const players = members.filter(m => isTeam(m.team));
    if (players.length > MAX_PLAYERS) return `เล่นได้สูงสุด ${MAX_PLAYERS} คน ให้บางคนเป็นผู้ชม`;
    if (players.length < MIN_PLAYERS) return `ต้องมีคนเล่นอย่างน้อย ${MIN_PLAYERS} คน (หัวหน้า 1 + ลูกทีม 1)`;
    const coop = coopTeamOf(players);
    if (!coop && players.length < MIN_VERSUS_PLAYERS) return `แข่งสองทีมต้องมี ${MIN_VERSUS_PLAYERS} คนขึ้นไป — ${players.length} คนให้อยู่ทีมเดียวกัน (โหมดร่วมมือ)`;
    // โหมดร่วมมือ: ตรวจเฉพาะทีมที่มีคน · สองทีม: ตรวจทั้งสองทีม
    for (const team of (coop ? [coop] : TEAMS)) {
        const inTeam = players.filter(m => m.team === team);
        const masters = inTeam.filter(m => m.role === 'spymaster');
        const ops = inTeam.filter(m => m.role === 'operative');
        if (masters.length === 0) return `${TEAM_LABEL[team]}ยังไม่มีหัวหน้า`;
        if (masters.length > 1) return `${TEAM_LABEL[team]}มีหัวหน้าได้คนเดียว`;
        if (ops.length === 0) return `${TEAM_LABEL[team]}ต้องมีลูกทีมอย่างน้อย 1 คน`;
    }
    return null;
}

// ---------- start ----------

function buildBoard(rng = Math.random, startingTeam = 'red', wordPool = WORDS) {
    const picked = [];
    for (const word of shuffle(wordPool, rng)) {
        if (picked.length >= BOARD_SIZE) break;
        // กันพลาด: บนกระดานเดียวกันห้ามมีคำที่ซ้อนกัน
        if (picked.some(other => other === word || containsWord(other, word) || containsWord(word, other))) continue;
        picked.push(word);
    }
    if (picked.length < BOARD_SIZE) throw new Error('คำในคลังไม่พอสร้างกระดาน');
    const colors = []
        .concat(Array(STARTING_TEAM_CARDS).fill(startingTeam))
        .concat(Array(OTHER_TEAM_CARDS).fill(otherTeam(startingTeam)))
        .concat(Array(NEUTRAL_CARDS).fill('neutral'))
        .concat(Array(ASSASSIN_CARDS).fill('assassin'));
    const order = shuffle(colors, rng);
    return picked.map((word, index) => ({
        word,
        color: order[index],
        revealed: false,
        revealedBy: null,
        revealedTurn: null
    }));
}

function startGame(room, rng = Math.random, now = Date.now()) {
    const reason = getStartBlockReason(room);
    if (reason) throw new Error(reason);
    const picks = lobbyPicks(room);
    const coopTeam = lobbyCoopTeam(room);
    // คู่มือ: สองทีม = กุญแจบอกทีมเริ่ม (สุ่ม) · ร่วมมือ = ทีมผู้เล่นเริ่มก่อน
    const startingTeam = coopTeam || (rng() < 0.5 ? 'red' : 'blue');
    const roster = (room.players || [])
        .filter(p => !isBotId(p.playerId))
        .map(p => {
            const pick = picks[p.playerId];
            // คนที่หลุดตอนเริ่มและยังไม่ได้เลือกทีม = ผู้ชม
            const team = pick && isTeam(pick.team) ? pick.team : null;
            const role = team ? (pick.role === 'spymaster' ? 'spymaster' : 'operative') : 'spectator';
            return {
                playerId: p.playerId,
                name: displayName(p),
                color: p.color || '#f5c86b',
                avatar: p.avatar || '👤',
                avatarFrame: p.avatarFrame || 'none',
                team,
                role,
                left: false
            };
        });
    // ร่วมมือ: คนที่หลุดอยู่แต่เคยเลือกอีกทีม = ผู้ชม (อีกทีมต้องไม่มีคนเล่น)
    if (coopTeam) {
        roster.forEach(p => { if (p.team && p.team !== coopTeam) { p.team = null; p.role = 'spectator'; } });
    }
    // หัวหน้าที่หลุดตอนเริ่มนับไม่ได้ — getStartBlockReason นับเฉพาะคนออนไลน์ ถ้ามีหัวหน้าซ้อน (ออฟไลน์) ให้เป็นลูกทีม
    TEAMS.forEach(team => {
        const masters = roster.filter(p => p.team === team && p.role === 'spymaster');
        masters.forEach(p => { if (masters.length > 1 && !isOnline(room, p.playerId)) p.role = 'operative'; });
    });

    const state = {
        ...createInitialState(),
        status: 'playing',
        phase: 'clue',
        players: (room.players || []).map(createPlayerState),
        roster,
        board: buildBoard(rng, startingTeam),
        startingTeam,
        currentTeam: startingTeam,
        turnNumber: 1,
        startedAt: new Date(now).toISOString(),
        settings: {
            clueSeconds: sanitizeClueSeconds(room.settings && room.settings.codenamesClueSeconds),
            guessSeconds: sanitizeGuessSeconds(room.settings && room.settings.codenamesGuessSeconds),
            clueFlag: sanitizeClueFlag(room.settings && room.settings.codenamesClueFlag)
        },
        coop: coopTeam ? { team: coopTeam } : null
    };
    state.phaseEndsAt = state.settings.clueSeconds ? now + state.settings.clueSeconds * 1000 : null;
    state.phaseStartedAt = now;
    room.gameState = state;
    if (coopTeam) {
        pushHistory(state, '🤝', `เริ่มเกมโหมดร่วมมือ — ${TEAM_LABEL[coopTeam]}หา ${STARTING_TEAM_CARDS} คำ ก่อนฝ่ายตรงข้ามถูกปิดครบ ${OTHER_TEAM_CARDS} คำ`, 'start', now);
    } else {
        pushHistory(state, '🎬', `เริ่มเกม — ${TEAM_LABEL[startingTeam]}เริ่มก่อน (${STARTING_TEAM_CARDS} คำ) · ${TEAM_LABEL[otherTeam(startingTeam)]} ${OTHER_TEAM_CARDS} คำ`, 'start', now);
    }
    pushFx(state, { type: 'start', team: startingTeam, coop: !!coopTeam });
    bumpStep(state);
    return state;
}

// ---------- clue ----------

function parseClueNumber(value) {
    if (value === INFINITE || value === '∞' || value === 'infinity') return INFINITE;
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    if (typeof value === 'string' && !/^\d$/.test(value.trim())) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > MAX_CLUE_NUMBER) return null;
    return n;
}

// ตรวจคำใบ้: คำเดียว ไม่มีช่องว่าง ไม่ใช่/ไม่มีคำบนกระดานที่ยังไม่เปิด — คืนข้อความ error หรือ null
function validateClueWord(state, rawWord) {
    const raw = String(rawWord == null ? '' : rawWord).normalize('NFC').replace(/[​-‍⁠﻿]/g, '').trim();
    if (!raw) return 'พิมพ์คำใบ้ก่อน';
    if (/\s/.test(raw)) return 'ใบ้ได้คำเดียว ห้ามเว้นวรรค';
    const word = normalizeWord(raw);
    if (!/^[\p{L}\p{M}\p{N}]+$/u.test(word)) return 'คำใบ้ใช้ได้แค่ตัวอักษรหรือตัวเลข ห้ามมีสัญลักษณ์';
    if (graphemes(word).length > MAX_CLUE_GRAPHEMES) return `คำใบ้ยาวเกินไป (ไม่เกิน ${MAX_CLUE_GRAPHEMES} ตัวอักษร)`;
    const hit = (state.board || []).find(card => !card.revealed && containsWord(word, card.word));
    if (hit) {
        return normalizeWord(hit.word) === word
            ? `"${hit.word}" อยู่บนกระดาน ใช้เป็นคำใบ้ไม่ได้`
            : `คำใบ้มีคำว่า "${hit.word}" ที่อยู่บนกระดาน ลองคำอื่น`;
    }
    // ส่วนของคำประสมบนกระดาน เช่น "รถ" ตอน "รถไฟ" ยังไม่เปิด (เปิดแล้ว = ไม่อยู่บนกระดานแล้ว ใช้ได้)
    const part = (state.board || []).find(card => !card.revealed && isCompoundPart(word, card.word));
    if (part) return `"${raw}" เป็นส่วนหนึ่งของ "${part.word}" บนกระดาน ลองคำอื่น`;
    return null;
}

function assertPlaying(state) {
    if (!state || state.status !== 'playing') throw new Error('เกมยังไม่เริ่มหรือจบไปแล้ว');
}

function submitClue(room, playerId, payload = {}, context = null, now = Date.now()) {
    const state = room.gameState;
    assertPlaying(state);
    assertStep(state, context);
    if (state.phase !== 'clue') throw new Error('ตอนนี้ไม่ใช่ช่วงใบ้คำ');
    const me = rosterEntry(state, playerId);
    if (!me || me.left || me.role !== 'spymaster') throw new Error('เฉพาะหัวหน้าทีมที่ใบ้ได้');
    if (me.team !== state.currentTeam) throw new Error('ยังไม่ถึงตาทีมคุณ');
    const number = parseClueNumber(payload.number);
    if (number === null) throw new Error('เลือกจำนวน 0–9 หรือ ∞');
    const error = validateClueWord(state, payload.word);
    if (error) throw new Error(error);

    const word = String(payload.word).normalize('NFC').replace(/[​-‍⁠﻿]/g, '').trim();
    const maxGuesses = number === INFINITE || number === 0 ? null : number + 1;
    state.clue = { word, number, team: me.team, byId: me.playerId, byName: me.name, maxGuesses, turn: state.turnNumber };
    // โบนัสปิดคำจากการทักท้วง ต้องใช้ก่อนใบ้ — ใบ้แล้วถือว่าสละสิทธิ์
    if (state.bonusCover === me.team) state.bonusCover = null;
    state.guessesMade = 0;
    state.votes = {};
    state.phase = 'guess';
    state.stuckSince = {};
    state.phaseEndsAt = state.settings.guessSeconds ? now + state.settings.guessSeconds * 1000 : null;
    state.phaseStartedAt = now;
    state.clueLog = (state.clueLog || []).concat([{
        team: me.team, word, number, byName: me.name, turn: state.turnNumber, picks: [], endedBy: null
    }]);
    const numberText = number === INFINITE ? '∞' : String(number);
    pushHistory(state, '💬', `${TEAM_LABEL[me.team]} ใบ้ "${word}" ${numberText}`, 'clue', now);
    pushFx(state, { type: 'clue', team: me.team, word, number });
    bumpStep(state);
    return state;
}

// ---------- guessing ----------

function assertOperativeTurn(state, playerId) {
    assertPlaying(state);
    if (state.phase !== 'guess') throw new Error('รอหัวหน้าใบ้คำก่อน');
    const me = rosterEntry(state, playerId);
    if (!me || me.left) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    if (me.role !== 'operative') throw new Error(me.role === 'spymaster' ? 'หัวหน้าเปิดการ์ดเองไม่ได้' : 'คุณเปิดการ์ดไม่ได้');
    if (me.team !== state.currentTeam) throw new Error('ยังไม่ถึงตาทีมคุณ');
    return me;
}

function assertCard(state, index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= (state.board || []).length) throw new Error('ไม่พบการ์ดใบนี้');
    if (state.board[i].revealed) throw new Error('การ์ดใบนี้เปิดไปแล้ว');
    return i;
}

// เสียงข้างมากของลูกทีมที่ออนไลน์ · มีลูกทีมคนเดียวต้องกด "เปิดเลย" เอง
function votesNeeded(room) {
    const n = onlineOperatives(room, room.gameState.currentTeam).length;
    return n >= 2 ? Math.floor(n / 2) + 1 : null;
}

function voteCounts(room) {
    const state = room.gameState;
    const eligible = new Set(onlineOperatives(room, state.currentTeam).map(p => p.playerId));
    const counts = {};
    Object.entries(state.votes || {}).forEach(([id, index]) => {
        if (!eligible.has(id)) return;
        counts[index] = (counts[index] || 0) + 1;
    });
    return counts;
}

function checkMajority(room, now = Date.now()) {
    const state = room.gameState;
    if (!state || state.status !== 'playing' || state.phase !== 'guess') return false;
    const needed = votesNeeded(room);
    if (!needed) return false;
    const counts = voteCounts(room);
    const winner = Object.keys(counts).find(index => counts[index] >= needed && !state.board[Number(index)].revealed);
    if (winner === undefined) return false;
    revealCard(room, Number(winner), null, now, 'vote');
    return true;
}

function proposeCard(room, playerId, index, context = null, now = Date.now()) {
    const state = room.gameState;
    const me = assertOperativeTurn(state, playerId);
    assertStep(state, context);
    const i = assertCard(state, index);
    state.votes = { ...(state.votes || {}) };
    if (state.votes[me.playerId] === i) {
        delete state.votes[me.playerId];
    } else {
        state.votes[me.playerId] = i;
    }
    checkMajority(room, now);
    return state;
}

function confirmReveal(room, playerId, index, context = null, now = Date.now()) {
    const state = room.gameState;
    const me = assertOperativeTurn(state, playerId);
    assertStep(state, context);
    const i = assertCard(state, index);
    // เปิดได้เฉพาะใบที่ตัวเองเสนอไว้แล้ว = ต้องตั้งใจสองจังหวะ (แตะเลือก → กดเปิด/กดค้างใบเดิม) กันมือลั่นเปิดมือสังหาร
    if ((state.votes || {})[me.playerId] !== i) throw new Error('แตะเลือกการ์ดใบนี้ก่อน แล้วค่อยกดเปิด');
    revealCard(room, i, me, now, 'confirm');
    return state;
}

function lastClueEntry(state) {
    const log = state.clueLog || [];
    return log.length ? log[log.length - 1] : null;
}

function revealCard(room, index, actor, now = Date.now(), how = 'confirm') {
    const state = room.gameState;
    const card = state.board[index];
    const team = state.currentTeam;
    card.revealed = true;
    card.revealedBy = actor ? actor.name : null;
    card.revealedTeam = team;
    card.revealedTurn = state.turnNumber;
    state.guessesMade = (Number(state.guessesMade) || 0) + 1;
    state.votes = {};
    const entry = lastClueEntry(state);
    if (entry && entry.turn === state.turnNumber) {
        entry.picks = (entry.picks || []).concat([{ index, word: card.word, color: card.color }]);
    }
    const who = actor ? actor.name : 'ลูกทีมส่วนใหญ่';
    pushFx(state, { type: 'reveal', index, color: card.color, team, how });
    bumpStep(state);

    if (card.color === 'assassin') {
        pushHistory(state, '💀', `${TEAM_LABEL[team]}เปิด "${card.word}" เจอมือสังหาร!`, 'assassin', now);
        return finishGame(room, otherTeam(team), 'assassin', now);
    }
    if (isTeam(card.color) && remainingFor(state, card.color) === 0) {
        pushHistory(state, card.color === team ? '🎯' : '😬', `${who}เปิด "${card.word}" — คำสุดท้ายของ${TEAM_LABEL[card.color]}`, 'reveal', now);
        return finishGame(room, card.color, card.color === team ? 'words' : 'gift', now);
    }
    if (card.color === team) {
        pushHistory(state, '✅', `${who}เปิด "${card.word}" ถูก! (${TEAM_LABEL[team]})`, 'reveal', now);
        const max = state.clue && state.clue.maxGuesses;
        if (max && state.guessesMade >= max) {
            return passTurn(room, 'limit', now);
        }
        return state;
    }
    const label = card.color === 'neutral' ? 'คนเดินถนน' : `สายลับ${TEAM_LABEL[card.color]}`;
    pushHistory(state, card.color === 'neutral' ? '🚶' : '❌', `${who}เปิด "${card.word}" เป็น${label} — จบเทิร์น`, 'reveal', now);
    return passTurn(room, card.color === 'neutral' ? 'neutral' : 'wrong', now);
}

function endTurn(room, playerId, context = null, now = Date.now()) {
    const state = room.gameState;
    const me = assertOperativeTurn(state, playerId);
    assertStep(state, context);
    if (!(Number(state.guessesMade) > 0)) throw new Error('ต้องเปิดอย่างน้อย 1 ใบก่อนจบเทิร์น');
    pushHistory(state, '✋', `${me.name} จบเทิร์น${TEAM_LABEL[state.currentTeam]}`, 'pass', now);
    return passTurn(room, 'ended', now);
}

// หัวหน้าห้องข้ามเทิร์นที่ค้าง (ใบ้หรือทาย) — ได้เฉพาะเมื่อเฟสนั้นนานเกิน HOST_SKIP_AFTER_MS
// isHost มาจาก runtime (room.admin) · engine ไม่ตัดสินสิทธิ์หัวห้องเอง
function hostSkipWaitMs(state, now = Date.now()) {
    const since = Number(state && state.phaseStartedAt) || 0;
    if (!since) return 0; // state เก่าก่อนมี phaseStartedAt — ให้ข้ามได้
    return Math.max(0, HOST_SKIP_AFTER_MS - (now - since));
}

function hostSkipTurn(room, playerId, isHost, context = null, now = Date.now()) {
    const state = room.gameState;
    assertPlaying(state);
    if (!isHost) throw new Error('เฉพาะหัวหน้าห้องที่ข้ามเทิร์นได้');
    assertStep(state, context);
    if (state.phase !== 'clue' && state.phase !== 'guess' && state.phase !== 'cover') throw new Error('ตอนนี้ข้ามเทิร์นไม่ได้');
    const wait = hostSkipWaitMs(state, now);
    if (wait > 0) throw new Error(`ข้ามได้เมื่อเทิร์นนี้ค้างนานเกิน ${Math.round(HOST_SKIP_AFTER_MS / 1000)} วิ (อีก ${Math.ceil(wait / 1000)} วิ)`);
    const me = rosterEntry(state, playerId);
    if (state.phase === 'cover') {
        pushHistory(state, '⏭️', `${me ? me.name : 'หัวหน้าห้อง'} (หัวหน้าห้อง) ข้ามการเลือก — สุ่มปิดให้ 1 ใบ`, 'pass', now);
        return autoCover(room, now);
    }
    pushHistory(state, '⏭️', `${me ? me.name : 'หัวหน้าห้อง'} (หัวหน้าห้อง) ข้ามเทิร์น${TEAM_LABEL[state.currentTeam]} ช่วง${state.phase === 'clue' ? 'ใบ้' : 'ทาย'} — ไป${TEAM_LABEL[otherTeam(state.currentTeam)]}`, 'pass', now);
    return passTurn(room, 'host-skip', now);
}

const PASS_REASON_TEXT = {
    'clue-timeout': 'หมดเวลาคิดคำใบ้',
    'guess-timeout': 'หมดเวลาทาย',
    'no-operatives': 'ไม่มีลูกทีมออนไลน์',
    'no-spymaster': 'หัวหน้าหลุดและไม่มีคนรับแทน'
};

function passTurn(room, reason, now = Date.now()) {
    const state = room.gameState;
    const from = state.currentTeam;
    const entry = lastClueEntry(state);
    if (entry && entry.turn === state.turnNumber && !entry.endedBy) entry.endedBy = reason;
    if (PASS_REASON_TEXT[reason]) {
        pushHistory(state, '⏭️', `${TEAM_LABEL[from]}: ${PASS_REASON_TEXT[reason]} — ข้ามไป${TEAM_LABEL[otherTeam(from)]}`, 'pass', now);
    }
    state.currentTeam = otherTeam(from);
    state.turnNumber = (Number(state.turnNumber) || 0) + 1;
    // โหมดร่วมมือ: ตาฝ่ายตรงข้าม = หัวหน้าเลือกปิดสายลับฝ่ายตรงข้าม 1 ใบ (ไม่มีใบ้/ทาย)
    state.phase = state.coop && state.currentTeam !== state.coop.team ? 'cover' : 'clue';
    state.clue = null;
    state.bonusCover = null;
    state.guessesMade = 0;
    state.votes = {};
    state.stuckSince = {};
    state.phaseEndsAt = state.settings.clueSeconds ? now + state.settings.clueSeconds * 1000 : null;
    state.phaseStartedAt = now;
    pushFx(state, { type: 'turn', team: state.currentTeam, reason, phase: state.phase });
    bumpStep(state);
    return state;
}

// ---------- ทักท้วงคำใบ้ / ปิดคำ ----------

function flagsLeft(state, team) {
    if (!state || state.coop || !(state.settings && state.settings.clueFlag) || !isTeam(team)) return 0;
    return Math.max(0, FLAGS_PER_TEAM - (Number((state.flagsUsed || {})[team]) || 0));
}

// หัวหน้าอีกทีมทักว่าคำใบ้ผิดกติกา (คู่มือ: "ถ้าหัวหน้าอีกทีมยอม ก็ถือว่าใช้ได้") → จบเทิร์นทันที
// + หัวหน้าที่ทักปิดคำของทีมตัวเองได้ 1 ใบก่อนใบ้ · ทักได้ระหว่างที่ลูกทีมกำลังทายคำใบ้นั้น
function flagClue(room, playerId, context = null, now = Date.now()) {
    const state = room.gameState;
    assertPlaying(state);
    assertStep(state, context);
    if (state.coop) throw new Error('โหมดร่วมมือไม่มีการทักท้วง');
    if (!(state.settings && state.settings.clueFlag)) throw new Error('ห้องนี้ปิดการทักท้วงคำใบ้');
    if (state.phase !== 'guess' || !state.clue) throw new Error('ทักได้ตอนอีกทีมกำลังทายคำใบ้');
    const me = rosterEntry(state, playerId);
    if (!me || me.left || me.role !== 'spymaster') throw new Error('เฉพาะหัวหน้าทีมที่ทักท้วงได้');
    if (me.team === state.currentTeam) throw new Error('ทักคำใบ้ของทีมตัวเองไม่ได้');
    if (flagsLeft(state, me.team) <= 0) throw new Error('ทีมคุณใช้สิทธิ์ทักท้วงไปแล้ว');
    state.flagsUsed = { red: 0, blue: 0, ...(state.flagsUsed || {}) };
    state.flagsUsed[me.team] += 1;
    const clue = state.clue;
    pushHistory(state, '🚩', `${me.name} (หัวหน้า${TEAM_LABEL[me.team]}) ทักว่าคำใบ้ "${clue.word}" ผิดกติกา — จบเทิร์น${TEAM_LABEL[clue.team]}`, 'flag', now);
    pushFx(state, { type: 'flag', team: me.team, against: clue.team, word: clue.word, name: me.name });
    passTurn(room, 'flag', now);
    state.bonusCover = me.team;
    return state;
}

function coverReveal(room, index, actor, now, why) {
    const state = room.gameState;
    const card = state.board[index];
    card.revealed = true;
    card.revealedBy = actor ? actor.name : null;
    card.revealedTeam = card.color;
    card.revealedTurn = state.turnNumber;
    card.covered = why;
    pushFx(state, { type: 'reveal', index, color: card.color, team: card.color, how: 'cover' });
    bumpStep(state);
    return card;
}

// จบตาฝ่ายตรงข้าม (โหมดร่วมมือ) → กลับมาตาทีมผู้เล่น
function endCover(room, now) {
    const state = room.gameState;
    const team = state.coop.team;
    state.currentTeam = team;
    state.turnNumber = (Number(state.turnNumber) || 0) + 1;
    state.phase = 'clue';
    state.clue = null;
    state.guessesMade = 0;
    state.votes = {};
    state.stuckSince = {};
    state.phaseEndsAt = state.settings.clueSeconds ? now + state.settings.clueSeconds * 1000 : null;
    state.phaseStartedAt = now;
    pushFx(state, { type: 'turn', team, reason: 'covered', phase: 'clue' });
    bumpStep(state);
    return state;
}

function afterCoopCover(room, card, now) {
    const state = room.gameState;
    const enemy = otherTeam(state.coop.team);
    const left = remainingFor(state, enemy);
    if (left === 0) {
        pushHistory(state, '🕶️', `ปิด "${card.word}" — สายลับฝ่ายตรงข้ามถูกปิดครบ`, 'reveal', now);
        return finishGame(room, enemy, 'covered', now);
    }
    pushHistory(state, '🕶️', `ตาฝ่ายตรงข้าม: ปิด "${card.word}" (เหลือ ${left})`, 'reveal', now);
    return endCover(room, now);
}

// ปิดคำ: (1) โหมดร่วมมือ ตาฝ่ายตรงข้าม — หัวหน้าเลือกปิดสายลับฝ่ายตรงข้าม 1 ใบ
//        (2) โบนัสทักท้วง — หัวหน้าที่ทักปิดคำของทีมตัวเอง 1 ใบ ก่อนใบ้
function coverCard(room, playerId, index, context = null, now = Date.now()) {
    const state = room.gameState;
    assertPlaying(state);
    assertStep(state, context);
    const me = rosterEntry(state, playerId);
    if (!me || me.left || me.role !== 'spymaster') throw new Error('เฉพาะหัวหน้าที่ปิดคำได้');
    const i = assertCard(state, index);
    const card = state.board[i];
    if (state.phase === 'cover' && state.coop) {
        if (me.team !== state.coop.team) throw new Error('คุณปิดคำไม่ได้');
        const enemy = otherTeam(state.coop.team);
        if (card.color !== enemy) throw new Error(`เลือกการ์ดสาย${TEAM_LABEL[enemy]}เท่านั้น`);
        coverReveal(room, i, me, now, 'coop');
        return afterCoopCover(room, card, now);
    }
    if (state.phase === 'clue' && state.bonusCover && state.bonusCover === me.team && state.currentTeam === me.team) {
        if (card.color !== me.team) throw new Error(`เลือกการ์ดสาย${TEAM_LABEL[me.team]}ของทีมคุณเท่านั้น`);
        state.bonusCover = null;
        coverReveal(room, i, me, now, 'flag');
        if (remainingFor(state, me.team) === 0) {
            pushHistory(state, '🎯', `${me.name} ปิด "${card.word}" (โบนัสทักท้วง) — คำสุดท้ายของ${TEAM_LABEL[me.team]}`, 'reveal', now);
            return finishGame(room, me.team, 'words', now);
        }
        pushHistory(state, '🎁', `${me.name} ปิด "${card.word}" ของ${TEAM_LABEL[me.team]} (โบนัสทักท้วง)`, 'reveal', now);
        return state;
    }
    throw new Error('ตอนนี้ปิดคำไม่ได้');
}

// หมดเวลา/หัวห้องข้าม ตอนตาฝ่ายตรงข้าม (ร่วมมือ) → สุ่มปิด 1 ใบ
function autoCover(room, now = Date.now(), rng = Math.random) {
    const state = room.gameState;
    const enemy = otherTeam(state.coop.team);
    const options = (state.board || []).map((card, index) => ({ card, index })).filter(x => x.card.color === enemy && !x.card.revealed);
    if (!options.length) return finishGame(room, enemy, 'covered', now);
    const pick = options[Math.floor(rng() * options.length)] || options[0];
    coverReveal(room, pick.index, null, now, 'coop-auto');
    return afterCoopCover(room, pick.card, now);
}

function finishGame(room, winner, reason, now = Date.now()) {
    const state = room.gameState;
    state.status = FINISHED_STATUS;
    state.phase = 'finished';
    state.winner = isTeam(winner) ? winner : null;
    state.winReason = reason;
    state.phaseEndsAt = null;
    state.votes = {};
    state.finishedAt = new Date(now).toISOString();
    const text = {
        words: 'เจอสายลับครบทุกคน',
        gift: 'อีกทีมเปิดคำสุดท้ายให้',
        assassin: 'อีกทีมเปิดเจอมือสังหาร',
        forfeit: 'อีกทีมไม่เหลือผู้เล่น'
    }[reason] || '';
    if (state.coop && state.winner) {
        const won = state.winner === state.coop.team;
        state.coopScore = won ? remainingFor(state, otherTeam(state.coop.team)) : 0;
        const why = {
            words: `เจอสายลับครบ — คะแนน ${state.coopScore}/${OTHER_TEAM_CARDS}`,
            assassin: 'เปิดเจอมือสังหาร',
            gift: 'เปิดสายลับฝ่ายตรงข้ามใบสุดท้าย',
            covered: 'สายลับฝ่ายตรงข้ามถูกปิดครบ'
        }[reason] || '';
        pushHistory(state, won ? '🏆' : '💥', `${won ? 'ชนะ' : 'แพ้'}!${why ? ' — ' + why : ''}`, 'finished', now);
    } else if (state.winner) {
        pushHistory(state, '🏆', `${TEAM_LABEL[state.winner]}ชนะ!${text ? ' — ' + text : ''}`, 'finished', now);
    } else {
        pushHistory(state, '🏁', reason === 'abandoned' ? 'ไม่เหลือลูกทีมให้ทายทั้งสองทีม — จบเกม ไม่นับผล' : 'จบเกม — ไม่มีผู้ชนะ', 'finished', now);
    }
    pushFx(state, { type: 'finish', team: state.winner, reason });
    bumpStep(state);
    return state;
}

// ---------- leave / disconnect / timers ----------

function promoteSpymaster(room, team, now, reasonText) {
    const state = room.gameState;
    const current = spymasterOf(state, team);
    const candidates = activeMembers(state, team).filter(p => p.role === 'operative' && isOnline(room, p.playerId));
    if (!candidates.length) return false;
    const next = candidates[0];
    if (current) current.role = 'retired';
    next.role = 'spymaster';
    delete state.votes[next.playerId];
    pushHistory(state, '🕵️', `${reasonText} — ${next.name} เป็นหัวหน้า${TEAM_LABEL[team]}แทน`, 'promote', now);
    pushFx(state, { type: 'promote', team, playerId: next.playerId, name: next.name });
    bumpStep(state);
    return true;
}

function handlePlayerLeft(room, playerId, now = Date.now()) {
    const state = room.gameState;
    if (!state || state.status !== 'playing') return state;
    const me = rosterEntry(state, playerId);
    if (!me || me.left) return state;
    me.left = true;
    if (state.votes) delete state.votes[playerId];
    if (state.offlineSince) delete state.offlineSince[playerId];
    if (!isTeam(me.team)) return state;
    pushHistory(state, '🚪', `${me.name} ออกจากเกม (${TEAM_LABEL[me.team]})`, 'left', now);

    if (activeMembers(state, me.team).length === 0) {
        // ร่วมมือ: ทีมเดียวออกหมด = ไม่มีใครเล่นแล้ว ไม่นับผล
        return state.coop ? finishGame(room, null, 'abandoned', now) : finishGame(room, otherTeam(me.team), 'forfeit', now);
    }
    if (me.role === 'spymaster') {
        me.role = 'retired';
        // หัวหน้าออกแล้ว — ตั้งคนใหม่ทันที (ไม่มีคนออนไลน์ก็รอคนกลับมา tick จะจัดการ)
        const candidates = activeMembers(state, me.team).filter(p => p.role === 'operative');
        const online = candidates.filter(p => isOnline(room, p.playerId));
        const next = online[0] || candidates[0];
        if (next) {
            next.role = 'spymaster';
            delete state.votes[next.playerId];
            pushHistory(state, '🕵️', `หัวหน้า${TEAM_LABEL[me.team]}ออกไป — ${next.name} เป็นหัวหน้าแทน`, 'promote', now);
            pushFx(state, { type: 'promote', team: me.team, playerId: next.playerId, name: next.name });
        }
    }
    bumpStep(state);
    if (nobodyCanGuess(state)) return finishGame(room, null, 'abandoned', now);
    checkMajority(room, now);
    return state;
}

// ผู้เล่นที่ roomManager พากลับเข้าห้องกลางเกม (rejoinableGamePlayers) — กลับมาอยู่ทีมเดิม
function syncRoster(room, now) {
    const state = room.gameState;
    let changed = false;
    (state.roster || []).forEach(entry => {
        const inRoom = !!roomPlayer(room, entry.playerId);
        if (!entry.left && !inRoom) {
            handlePlayerLeft(room, entry.playerId, now);
            changed = true;
        } else if (entry.left && inRoom && state.status === 'playing') {
            entry.left = false;
            if (entry.role === 'spymaster' && spymasterOf(state, entry.team) && spymasterOf(state, entry.team) !== entry) entry.role = 'retired';
            pushHistory(state, '👋', `${entry.name} กลับเข้าเกม`, 'rejoin', now);
            changed = true;
        }
    });
    return changed;
}

function onlineSignature(room) {
    return (room.gameState.roster || [])
        .map(p => `${p.playerId}:${p.left ? 'L' : (isOnline(room, p.playerId) ? '1' : '0')}`)
        .join('|');
}

/**
 * เรียกทุกวินาทีจาก runtime: นาฬิกาเฟส, ตั้งหัวหน้าใหม่, ข้ามเทิร์นทีมที่ไม่มีคนเล่น
 * คืน true ถ้า state เปลี่ยน (runtime จะยิง state ใหม่ให้ทุกคน)
 */
function tick(room, now = Date.now()) {
    const state = room && room.gameState;
    if (!state || state.status !== 'playing') return false;
    let changed = syncRoster(room, now);
    if (state.status !== 'playing') return true;

    state.offlineSince = state.offlineSince || {};
    state.stuckSince = state.stuckSince || {};

    // หัวหน้าหลุดเกินเวลาผ่อนผัน → ตั้งลูกทีมที่ออนไลน์ขึ้นแทน
    TEAMS.forEach(team => {
        const master = spymasterOf(state, team);
        if (!master) {
            if (activeMembers(state, team).some(p => isOnline(room, p.playerId))) {
                if (promoteSpymaster(room, team, now, `${TEAM_LABEL[team]}ไม่มีหัวหน้า`)) changed = true;
            }
            return;
        }
        if (isOnline(room, master.playerId)) {
            delete state.offlineSince[master.playerId];
            return;
        }
        if (!state.offlineSince[master.playerId]) state.offlineSince[master.playerId] = now;
        if (now - state.offlineSince[master.playerId] >= SPYMASTER_GRACE_MS) {
            if (promoteSpymaster(room, team, now, `หัวหน้า${TEAM_LABEL[team]} (${master.name}) หลุดการเชื่อมต่อ`)) {
                delete state.offlineSince[master.playerId];
                changed = true;
            }
        }
    });

    // ร่วมมือ ตาฝ่ายตรงข้าม: รอหัวหน้าเลือก · หมดเวลา = สุ่มปิดให้
    if (state.phase === 'cover') {
        if (state.phaseEndsAt && now >= state.phaseEndsAt) {
            pushHistory(state, '⏭️', 'หมดเวลาเลือก — สุ่มปิดให้ 1 ใบ', 'pass', now);
            autoCover(room, now);
            return true;
        }
        const sig = onlineSignature(room);
        if (sig !== state.onlineSignature) {
            state.onlineSignature = sig;
            changed = true;
        }
        return changed;
    }

    // ทีมที่ถึงตาแต่เล่นไม่ได้ (ไม่มีลูกทีมออนไลน์ หรือช่วงใบ้แต่หัวหน้าหลุดนาน) → ข้ามเทิร์น
    const team = state.currentTeam;
    const master = spymasterOf(state, team);
    const masterGone = state.phase === 'clue'
        && (!master || (!isOnline(room, master.playerId) && now - (state.offlineSince[master.playerId] || now) >= SPYMASTER_GRACE_MS));
    const noOps = onlineOperatives(room, team).length === 0;
    if (noOps || masterGone) {
        const other = otherTeam(team);
        const otherCanPlay = onlineOperatives(room, other).length > 0
            && !!spymasterOf(state, other);
        if (!state.stuckSince[team]) state.stuckSince[team] = now;
        if (otherCanPlay && now - state.stuckSince[team] >= NO_OPERATIVE_GRACE_MS) {
            passTurn(room, noOps ? 'no-operatives' : 'no-spymaster', now);
            return true;
        }
    } else if (state.stuckSince[team]) {
        delete state.stuckSince[team];
    }

    if (state.phase === 'guess' && checkMajority(room, now)) changed = true;

    if (state.status === 'playing' && state.phaseEndsAt && now >= state.phaseEndsAt) {
        passTurn(room, state.phase === 'clue' ? 'clue-timeout' : 'guess-timeout', now);
        return true;
    }

    const signature = onlineSignature(room);
    if (signature !== state.onlineSignature) {
        state.onlineSignature = signature;
        changed = true;
    }
    return changed;
}

// ---------- client view ----------

function canSeeKey(state, viewerId) {
    if (state.phase === 'finished' || state.status === FINISHED_STATUS) return true;
    const me = rosterEntry(state, viewerId);
    return !!(me && !me.left && (me.role === 'spymaster' || me.role === 'retired'));
}

// คู่มือ: หัวหน้าห้ามสื่ออะไรนอกจากคำใบ้ 1 คำ + ตัวเลข — ออนไลน์ "แชท" คือช่องใบ้เพิ่ม
// คนที่เห็นกุญแจ (หัวหน้า/อดีตหัวหน้า) จึงพิมพ์แชทห้องไม่ได้ระหว่างเกม · จบเกมแล้วคุยได้ตามปกติ
function chatBlockReason(room, playerId) {
    const state = room && room.gameState;
    if (!state || state.status !== 'playing') return null;
    if (!canSeeKey(state, playerId)) return null;
    return 'หัวหน้าเห็นกุญแจ พิมพ์แชทไม่ได้ระหว่างเกม — ใบ้ได้ทางช่องคำใบ้เท่านั้น';
}

function publicMember(room, p) {
    return {
        playerId: p.playerId,
        name: p.name,
        color: p.color,
        avatar: p.avatar,
        avatarFrame: p.avatarFrame,
        team: p.team,
        role: p.role,
        left: !!p.left,
        online: isOnline(room, p.playerId)
    };
}

function buildClientState(room, viewerId, now = Date.now()) {
    const state = room.gameState || createInitialState();
    const showKey = canSeeKey(state, viewerId);
    const me = rosterEntry(state, viewerId);
    const votes = state.votes || {};
    const voterNames = {};
    Object.entries(votes).forEach(([id, index]) => {
        const voter = rosterEntry(state, id);
        if (!voter || voter.left || voter.team !== state.currentTeam || voter.role !== 'operative') return;
        (voterNames[index] = voterNames[index] || []).push(voter.name);
    });
    const isMyTurn = !!(me && !me.left && me.team === state.currentTeam && state.status === 'playing');
    const coopTeam = state.coop ? state.coop.team : null;
    const playing = state.status === 'playing';
    const amSpymaster = !!(me && !me.left && me.role === 'spymaster');
    // ปิดคำ: ร่วมมือ (ตาฝ่ายตรงข้าม) หรือโบนัสทักท้วง (ก่อนใบ้)
    let coverColor = null;
    if (playing && amSpymaster && state.phase === 'cover' && coopTeam && me.team === coopTeam) coverColor = otherTeam(coopTeam);
    else if (playing && amSpymaster && state.phase === 'clue' && state.bonusCover === me.team && isMyTurn) coverColor = me.team;
    const canFlag = !!(playing && amSpymaster && state.phase === 'guess' && state.clue && me.team !== state.currentTeam && flagsLeft(state, me.team) > 0);
    const roster = (state.roster || []).map(p => publicMember(room, p));
    const teams = {};
    TEAMS.forEach(team => {
        teams[team] = {
            label: TEAM_LABEL[team],
            spymaster: roster.find(p => p.team === team && p.role === 'spymaster' && !p.left) || null,
            members: roster.filter(p => p.team === team),
            total: (state.board || []).filter(card => card.color === team).length,
            remaining: remainingFor(state, team)
        };
    });

    return {
        mode: MODE,
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        turnNumber: state.turnNumber,
        startingTeam: state.startingTeam,
        currentTeam: state.currentTeam,
        phaseEndsAt: state.phaseEndsAt,
        phaseStartedAt: state.phaseStartedAt || null,
        hostSkipAfterMs: HOST_SKIP_AFTER_MS,
        serverNow: now,
        settings: state.settings,
        coop: state.coop ? { team: state.coop.team, enemy: otherTeam(state.coop.team), score: state.coopScore == null ? null : state.coopScore } : null,
        bonusCover: state.bonusCover || null,
        flagsLeft: { red: flagsLeft(state, 'red'), blue: flagsLeft(state, 'blue') },
        keyVisible: showKey,
        board: (state.board || []).map((card, index) => ({
            index,
            word: card.word,
            revealed: !!card.revealed,
            color: card.revealed || showKey ? card.color : null,
            revealedBy: card.revealed ? card.revealedBy || null : null,
            covered: card.revealed ? card.covered || null : null,
            // ส่วนของคำประสม (ข้อมูลสาธารณะจากตัวคำ) — ให้ช่องพิมพ์คำใบ้เตือนได้ทันที
            parts: card.revealed ? [] : compoundParts(card.word),
            votes: card.revealed ? [] : (voterNames[index] || []),
            mine: !card.revealed && votes[viewerId] === index
        })),
        clue: state.clue ? {
            word: state.clue.word,
            number: state.clue.number,
            team: state.clue.team,
            byName: state.clue.byName,
            maxGuesses: state.clue.maxGuesses,
            guessesMade: state.guessesMade || 0
        } : null,
        votesNeeded: state.phase === 'guess' ? votesNeeded(room) : null,
        clueLog: (state.clueLog || []).map(entry => ({
            team: entry.team,
            word: entry.word,
            number: entry.number,
            byName: entry.byName,
            turn: entry.turn,
            picks: (entry.picks || []).map(pick => ({ word: pick.word, color: pick.color })),
            endedBy: entry.endedBy
        })),
        teams,
        spectators: roster.filter(p => !isTeam(p.team)),
        self: me ? {
            playerId: me.playerId,
            team: me.team,
            role: me.role,
            left: !!me.left,
            isMyTurn,
            canGiveClue: isMyTurn && me.role === 'spymaster' && state.phase === 'clue',
            canGuess: isMyTurn && me.role === 'operative' && state.phase === 'guess',
            canEndTurn: isMyTurn && me.role === 'operative' && state.phase === 'guess' && (state.guessesMade || 0) > 0,
            canCover: !!coverColor,
            coverColor,
            canFlag
        } : { playerId: viewerId, team: null, role: 'spectator', left: false, isMyTurn: false, canGiveClue: false, canGuess: false, canEndTurn: false, canCover: false, coverColor: null, canFlag: false },
        isHost: room.admin === viewerId,
        winner: state.winner || null,
        winReason: state.winReason || null,
        history: (state.history || []).slice(-30),
        fx: state.fx || [],
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        limits: { minPlayers: MIN_PLAYERS, minVersusPlayers: MIN_VERSUS_PLAYERS, maxPlayers: MAX_PLAYERS, maxClueNumber: MAX_CLUE_NUMBER }
    };
}

// ผลจบเกมสำหรับสถิติ — ผู้ชมและคนที่ออกไปแล้วไม่นับ
function buildResult(room) {
    const state = room.gameState || {};
    return {
        mode: MODE,
        winner: state.winner,
        winReason: state.winReason,
        coop: !!state.coop,
        coopScore: state.coop ? (state.coopScore || 0) : null,
        players: (state.roster || [])
            .filter(p => isTeam(p.team) && !p.left && !isBotId(p.playerId))
            .map(p => ({ playerId: p.playerId, name: p.name, team: p.team, role: p.role, won: p.team === state.winner })),
        remaining: { red: remainingFor(state, 'red'), blue: remainingFor(state, 'blue') },
        turns: state.turnNumber || 0
    };
}

module.exports = {
    id: MODE,
    label: 'สายลับคำใบ้',
    description: 'สองทีมแข่งกันหาสายลับบนกระดาน 25 คำ — หัวหน้าใบ้คำเดียว ลูกทีมช่วยกันเปิด ระวังมือสังหาร · 4–12 คน (2–3 คนเล่นทีมเดียวได้)',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    finishedReturnMs: FINISHED_RETURN_MS,
    MODE,
    FINISHED_STATUS,
    TEAMS,
    TEAM_LABEL,
    ROLE_LABEL,
    COLOR_LABEL,
    BOARD_SIZE,
    STARTING_TEAM_CARDS,
    OTHER_TEAM_CARDS,
    NEUTRAL_CARDS,
    ASSASSIN_CARDS,
    CLUE_SECONDS_OPTIONS,
    GUESS_SECONDS_OPTIONS,
    DEFAULT_CLUE_SECONDS,
    DEFAULT_GUESS_SECONDS,
    SPYMASTER_GRACE_MS,
    NO_OPERATIVE_GRACE_MS,
    HOST_SKIP_AFTER_MS,
    MAX_CLUE_GRAPHEMES,
    MIN_PLAYERS,
    MIN_VERSUS_PLAYERS,
    FLAGS_PER_TEAM,
    INFINITE,
    WORDS,
    graphemes,
    normalizeWord,
    containsWord,
    shuffle,
    otherTeam,
    sanitizeClueSeconds,
    sanitizeGuessSeconds,
    sanitizeClueFlag,
    isCompoundPart,
    compoundParts,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    lobbyMembers,
    pickTeam,
    shuffleTeams,
    getStartBlockReason,
    buildBoard,
    startGame,
    parseClueNumber,
    validateClueWord,
    submitClue,
    proposeCard,
    confirmReveal,
    endTurn,
    hostSkipTurn,
    hostSkipWaitMs,
    flagClue,
    flagsLeft,
    coverCard,
    autoCover,
    chatBlockReason,
    lobbyCoopTeam,
    passTurn,
    handlePlayerLeft,
    tick,
    canSeeKey,
    buildClientState,
    buildResult,
    remainingFor
};
