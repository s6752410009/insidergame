/**
 * อวาลอน · อัศวินโต๊ะกลม (Avalon) — 5–10 คน
 *
 * ฝ่ายดีต้องทำภารกิจสำเร็จ 3 ใน 5 ครั้ง ฝ่ายร้ายต้องทำให้ล้ม 3 ครั้ง
 * หัวหน้า (เวียนตามที่นั่ง) เลือกทีม → ทุกคนโหวตพร้อมกัน → ทีมที่ผ่านลงการ์ดภารกิจลับ
 * ฝ่ายดีสำเร็จครบ 3 ครั้ง มือสังหารยังพลิกได้ถ้าแทงเมอร์ลินถูกคน
 *
 * ความลับทั้งหมด (บทบาท / โหวตก่อนเปิด / การ์ดภารกิจ) อยู่ใน state ฝั่งเซิร์ฟเวอร์เท่านั้น
 * buildClientState ส่งให้แต่ละคนเฉพาะสิ่งที่บทของเขามีสิทธิ์รู้
 */

const { gameAssetImage } = require('./gameAssets');

const IMG = id => gameAssetImage('avalon', id);

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;
const QUEST_COUNT = 5;
const WIN_QUESTS = 3;
const MAX_REJECTS = 5;

const NIGHT_MS = Number(process.env.AVALON_NIGHT_MS) || 30000;
const TEAM_MS = Number(process.env.AVALON_TEAM_MS) || 90000;
const VOTE_MS = Number(process.env.AVALON_VOTE_MS) || 60000;
const QUEST_MS = Number(process.env.AVALON_QUEST_MS) || 45000;
const ASSASSIN_MS = Number(process.env.AVALON_ASSASSIN_MS) || 120000;

/** จำนวนฝ่ายดี : ฝ่ายร้าย ตามจำนวนคน */
const TEAM_COUNTS = {
    5: { good: 3, evil: 2 },
    6: { good: 4, evil: 2 },
    7: { good: 4, evil: 3 },
    8: { good: 5, evil: 3 },
    9: { good: 6, evil: 3 },
    10: { good: 6, evil: 4 }
};

/** ขนาดทีมของภารกิจ 1–5 ตามจำนวนคน */
const QUEST_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
};

const ROLE_DEFINITIONS = {
    merlin: {
        id: 'merlin', team: 'good', thaiName: 'เมอร์ลิน', title: 'ผู้หยั่งรู้', icon: '🔮',
        image: IMG('merlin'),
        blurb: 'คุณเห็นฝ่ายร้าย (ยกเว้นมอร์เดรด) ช่วยฝ่ายดีแบบเนียน ๆ — ถ้ามือสังหารจับได้ ฝ่ายดีแพ้'
    },
    percival: {
        id: 'percival', team: 'good', thaiName: 'เพอร์ซิวัล', title: 'อัศวินผู้พิทักษ์', icon: '🛡️',
        image: IMG('percival'),
        blurb: 'คุณเห็นเมอร์ลินกับมอร์กานา แต่ไม่รู้ว่าใครเป็นใคร — ปกป้องเมอร์ลินตัวจริง'
    },
    loyal: {
        id: 'loyal', team: 'good', thaiName: 'อัศวินผู้ภักดี', title: 'ฝ่ายดี', icon: '⚔️',
        image: IMG('loyal'),
        blurb: 'คุณไม่รู้อะไรเลย — อ่านเกม โหวตให้ดี แล้วลงการ์ดสำเร็จทุกครั้ง'
    },
    assassin: {
        id: 'assassin', team: 'evil', thaiName: 'มือสังหาร', title: 'ฝ่ายร้าย', icon: '🗡️',
        image: IMG('assassin'),
        blurb: 'ถ้าฝ่ายดีสำเร็จครบ 3 ภารกิจ คุณยังพลิกได้ — แทงเมอร์ลินให้ถูกคน'
    },
    morgana: {
        id: 'morgana', team: 'evil', thaiName: 'มอร์กานา', title: 'แม่มดเงา', icon: '🌙',
        image: IMG('morgana'),
        blurb: 'ในสายตาเพอร์ซิวัล คุณดูเหมือนเมอร์ลิน — ใช้มันหลอกเขา'
    },
    mordred: {
        id: 'mordred', team: 'evil', thaiName: 'มอร์เดรด', title: 'ราชันเงา', icon: '🖤',
        image: IMG('mordred'),
        blurb: 'เมอร์ลินมองไม่เห็นคุณ — คุณคือฝ่ายร้ายที่ซ่อนได้ลึกที่สุด'
    },
    oberon: {
        id: 'oberon', team: 'evil', thaiName: 'โอเบรอน', title: 'ผู้หลงเงา', icon: '👁️',
        image: IMG('oberon'),
        blurb: 'คุณไม่รู้ว่าพวกเดียวกันคือใคร และพวกเขาก็ไม่รู้จักคุณ (แต่เมอร์ลินเห็นคุณ)'
    },
    minion: {
        id: 'minion', team: 'evil', thaiName: 'สมุนมอร์เดรด', title: 'ฝ่ายร้าย', icon: '🦇',
        image: IMG('minion'),
        blurb: 'คุณรู้จักพวกเดียวกัน — แฝงตัวเข้าทีม แล้วลงการ์ดล้มในจังหวะที่ใช่'
    }
};

/** บทเสริมที่หัวห้องเลือกเปิดได้ (เมอร์ลิน + มือสังหาร มีเสมอ) */
const OPTIONAL_ROLES = ['percival', 'morgana', 'mordred', 'oberon'];

const ART = {
    back: IMG('back'),
    success: IMG('quest-success'),
    fail: IMG('quest-fail'),
    approve: IMG('vote-approve'),
    reject: IMG('vote-reject'),
    crown: IMG('crown'),
    tokenSuccess: IMG('token-success'),
    tokenFail: IMG('token-fail'),
    cover: IMG('cover')
};

const TIMEOUT_HINTS = {
    night: 'หมดเวลา = พร้อมให้อัตโนมัติ',
    team: 'หมดเวลา = เลือกหัวหน้า + คนถัดไปให้',
    vote: 'หมดเวลา = คนที่ไม่โหวตนับเป็นเห็นด้วย',
    quest: 'หมดเวลา = ลงการ์ดสำเร็จให้',
    assassin: 'หมดเวลา = สุ่มแทงฝ่ายดี 1 คน'
};

function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function sanitizeRoleSelection(list) {
    if (!Array.isArray(list)) return [];
    const picked = new Set(list.map(item => String(item || '').trim().toLowerCase()));
    return OPTIONAL_ROLES.filter(id => picked.has(id));
}

/**
 * แผนบทบาทของโต๊ะ — ใช้ทั้งตอนเริ่มเกมและให้ห้องรอโชว์ว่าเลือกได้ไหม
 * คืน { ok, error, roles[], good, evil }
 */
function getRolePlan(playerCount, optionalRoles) {
    const count = Number(playerCount) || 0;
    const counts = TEAM_COUNTS[count];
    const optional = sanitizeRoleSelection(optionalRoles);
    if (!counts) {
        return { ok: false, error: `อวาลอนเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน`, roles: [], good: 0, evil: 0, optional };
    }
    const goodSpecial = ['merlin', ...optional.filter(id => ROLE_DEFINITIONS[id].team === 'good')];
    const evilSpecial = ['assassin', ...optional.filter(id => ROLE_DEFINITIONS[id].team === 'evil')];
    if (evilSpecial.length > counts.evil) {
        return {
            ok: false,
            error: `${count} คนมีฝ่ายร้าย ${counts.evil} คน — เลือกบทฝ่ายร้ายเสริมได้ไม่เกิน ${counts.evil - 1} บท`,
            roles: [], good: counts.good, evil: counts.evil, optional
        };
    }
    if (goodSpecial.length > counts.good) {
        return { ok: false, error: 'บทฝ่ายดีเกินจำนวนคน', roles: [], good: counts.good, evil: counts.evil, optional };
    }
    const roles = [...goodSpecial];
    while (roles.length < counts.good) roles.push('loyal');
    roles.push(...evilSpecial);
    while (roles.length < count) roles.push('minion');
    return { ok: true, error: null, roles, good: counts.good, evil: counts.evil, optional };
}

function createInitialState() {
    return {
        mode: 'avalon',
        status: 'waiting',
        phase: 'lobby',
        step: 0,
        players: [],
        seats: [],
        optionalRoles: [],
        playerCount: 0,
        questSizes: [],
        quests: [],
        questIndex: 0,
        rejectCount: 0,
        leaderId: null,
        proposalNumber: 0,
        proposal: null,
        votes: {},
        questCards: {},
        lastVote: null,
        lastQuest: null,
        assassinId: null,
        assassinTargetId: null,
        winner: null,
        phaseEndsAt: null,
        statsRecordedAt: null,
        history: [],
        fxSeq: 0,
        fx: []
    };
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        name: player.playerName || player.name,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        socketId: context.socketId || null,
        permission: context.isAdmin ? 'admin' : null
    };
}

function resetRoomGame(room) {
    const state = createInitialState();
    state.players = (room.players || []).map(player => createPlayerState(player, {
        socketId: player.socketId,
        isAdmin: player.playerId === room.admin || player.permission === 'admin'
    }));
    return state;
}

function pushHistory(room, icon, text, kind = null) {
    room.gameState.history = [
        { icon, text, kind, at: new Date().toISOString() },
        ...(room.gameState.history || [])
    ].slice(0, 60);
}

function pushFx(room, event) {
    const state = room.gameState;
    state.fxSeq = (state.fxSeq || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, at: Date.now(), ...event }].slice(-6);
}

function setPhase(room, phase, durationMs) {
    const state = room.gameState;
    state.phase = phase;
    state.step = (Number(state.step) || 0) + 1;
    state.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
}

function getSeat(room, playerId) {
    return (room.gameState.seats || []).find(seat => seat.playerId === playerId) || null;
}

function activeSeats(room) {
    return (room.gameState.seats || []).filter(seat => !seat.left);
}

function seatName(room, playerId) {
    return getSeat(room, playerId)?.name || 'ผู้เล่น';
}

function isFinished(state) {
    return !state || state.phase === 'finished' || state.status === 'avalon_finished';
}

/** คนที่ออกไปแล้วกลับเข้าห้อง (roomManager คืนเขาเข้า gameState.players) → กลับมาเล่นต่อ */
function refreshSeats(room) {
    const state = room.gameState;
    if (!state || !Array.isArray(state.seats) || isFinished(state)) return;
    const present = new Set((state.players || []).map(player => player.playerId));
    state.seats.forEach(seat => {
        if (seat.left && present.has(seat.playerId)) {
            seat.left = false;
            pushHistory(room, '↩️', `${seat.name} กลับเข้าโต๊ะ`);
        }
    });
}

function nextActiveSeat(room, fromId) {
    const seats = room.gameState.seats || [];
    if (!seats.length) return null;
    const start = Math.max(0, seats.findIndex(seat => seat.playerId === fromId));
    for (let offset = 1; offset <= seats.length; offset += 1) {
        const candidate = seats[(start + offset) % seats.length];
        if (!candidate.left) return candidate;
    }
    return null;
}

function currentQuest(state) {
    return state.quests[state.questIndex] || null;
}

function countResults(state, result) {
    return state.quests.filter(quest => quest.result === result).length;
}

/** ข้อมูลกลางคืนของแต่ละบท — จุดเดียวที่ตัดสินว่าใครเห็นใคร */
function getKnowledge(state, viewerSeat) {
    if (!viewerSeat || !viewerSeat.role) return [];
    const others = (state.seats || []).filter(seat => seat.playerId !== viewerSeat.playerId);
    const role = viewerSeat.role;
    if (role === 'merlin') {
        return others
            .filter(seat => seat.team === 'evil' && seat.role !== 'mordred')
            .map(seat => ({ playerId: seat.playerId, tag: 'evil' }));
    }
    if (role === 'percival') {
        return others
            .filter(seat => seat.role === 'merlin' || seat.role === 'morgana')
            .map(seat => ({ playerId: seat.playerId, tag: 'merlin' }));
    }
    if (viewerSeat.team === 'evil' && role !== 'oberon') {
        return others
            .filter(seat => seat.team === 'evil' && seat.role !== 'oberon')
            .map(seat => ({ playerId: seat.playerId, tag: 'evil' }));
    }
    return [];
}

function finishGame(room, team, reason, text, extra = {}) {
    const state = room.gameState;
    state.winner = { team, reason, text, ...extra };
    state.phase = 'finished';
    state.status = 'avalon_finished';
    state.phaseEndsAt = null;
    state.step = (Number(state.step) || 0) + 1;
    state.proposal = null;
    state.votes = {};
    state.questCards = {};
    if (team === 'good') pushHistory(room, '🏆', `ฝ่ายดีชนะ — ${text}`, 'winner');
    else if (team === 'evil') pushHistory(room, '🏆', `ฝ่ายร้ายชนะ — ${text}`, 'winner');
    else pushHistory(room, '🚪', text, 'abandoned');
    pushFx(room, { kind: 'end', team, reason });
    return state;
}

function checkAbandoned(room) {
    const state = room.gameState;
    if (isFinished(state)) return true;
    if (activeSeats(room).length >= MIN_PLAYERS) return false;
    finishGame(room, null, 'abandoned', `ผู้เล่นเหลือไม่ถึง ${MIN_PLAYERS} คน — ยกเลิกเกมนี้ (ไม่นับสถิติ)`, { abandoned: true });
    return true;
}

function beginTeamPhase(room) {
    const state = room.gameState;
    const leader = getSeat(room, state.leaderId);
    if (!leader || leader.left) {
        const next = nextActiveSeat(room, state.leaderId);
        state.leaderId = next ? next.playerId : null;
    }
    state.proposal = null;
    state.votes = {};
    state.questCards = {};
    state.proposalNumber = (Number(state.proposalNumber) || 0) + 1;
    setPhase(room, 'team', TEAM_MS);
    return state;
}

function beginVotePhase(room, teamIds) {
    const state = room.gameState;
    state.proposal = { leaderId: state.leaderId, teamIds: [...teamIds] };
    state.votes = {};
    setPhase(room, 'vote', VOTE_MS);
    const quest = currentQuest(state);
    pushHistory(room, '👑', `${seatName(room, state.leaderId)} เสนอทีมภารกิจ ${state.questIndex + 1}: ${teamIds.map(id => seatName(room, id)).join(', ')}`, 'proposal');
    pushFx(room, { kind: 'proposal', questNumber: state.questIndex + 1, size: quest?.size || teamIds.length });
    return state;
}

function startGame(room) {
    const connected = (room.players || []).filter(player => player.socketId || isBotId(player.playerId));
    const count = connected.length;
    if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
        throw new Error(`อวาลอนเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน (ออนไลน์ตอนนี้ ${count} คน)`);
    }
    const optional = sanitizeRoleSelection(room.settings?.avalonRoles);
    const plan = getRolePlan(count, optional);
    if (!plan.ok) throw new Error(plan.error);

    const roles = shuffle(plan.roles);
    const state = createInitialState();
    state.status = 'playing';
    state.optionalRoles = plan.optional;
    state.playerCount = count;
    state.questSizes = [...QUEST_SIZES[count]];
    state.quests = state.questSizes.map((size, index) => ({
        number: index + 1,
        size,
        failsNeeded: index === 3 && count >= 7 ? 2 : 1,
        result: null,
        failCount: 0,
        teamIds: []
    }));
    // ทุกคนในห้อง (รวมคนที่หลุดตอนเริ่ม) อยู่ใน players — กลับมาแล้วเปิดหน้าเกมดูได้
    // ไม่งั้น /game ส่งไป /room แล้ว /room ส่งกลับ /game วนจนเบราว์เซอร์ขึ้น ERR_TOO_MANY_REDIRECTS
    // คนที่นั่งโต๊ะจริงดูจาก seats เท่านั้น
    state.players = (room.players || []).map(player => createPlayerState(player, {
        socketId: player.socketId,
        isAdmin: player.playerId === room.admin || player.permission === 'admin'
    }));
    state.seats = connected.map((player, index) => ({
        playerId: player.playerId,
        name: player.playerName || player.name || 'ผู้เล่น',
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        seat: index,
        role: roles[index],
        team: ROLE_DEFINITIONS[roles[index]].team,
        ready: false,
        left: false
    }));
    const firstLeader = state.seats[Math.floor(Math.random() * state.seats.length)];
    state.leaderId = firstLeader.playerId;
    room.gameState = state;

    setPhase(room, 'night', NIGHT_MS);
    pushHistory(room, '🌙', `เริ่มเกม ${count} คน — ฝ่ายดี ${plan.good} · ฝ่ายร้าย ${plan.evil} · ดูบทของคุณแล้วกดพร้อม`, 'start');
    pushFx(room, { kind: 'deal' });
    return room.gameState;
}

/* ---------------------------------------------------------------- guards */

function assertPlaying(room) {
    const state = room?.gameState;
    if (!state || state.mode !== 'avalon' || state.phase === 'lobby') {
        throw new Error('เกมยังไม่เริ่ม');
    }
    if (isFinished(state)) {
        throw new Error('เกมจบแล้ว');
    }
    refreshSeats(room);
    return state;
}

function assertStep(state, context) {
    if (context && context.step !== undefined && context.step !== null && Number(context.step) !== Number(state.step)) {
        throw new Error('จังหวะนี้ผ่านไปแล้ว — หน้าจออัปเดตใหม่ให้แล้ว');
    }
}

function assertSeat(room, playerId) {
    const seat = getSeat(room, playerId);
    if (!seat) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    if (seat.left) throw new Error('คุณออกจากเกมนี้ไปแล้ว');
    return seat;
}

/* ---------------------------------------------------------------- night */

function submitReady(room, playerId, context = {}) {
    const state = assertPlaying(room);
    if (state.phase !== 'night') throw new Error('ตอนนี้ไม่ใช่ช่วงดูบท');
    assertStep(state, context);
    const seat = assertSeat(room, playerId);
    if (seat.ready) return state;
    seat.ready = true;
    if (activeSeats(room).every(entry => entry.ready)) {
        endNight(room);
    }
    return state;
}

function endNight(room) {
    const state = room.gameState;
    state.seats.forEach(seat => { seat.ready = true; });
    pushHistory(room, '☀️', `เช้าแล้ว — ${seatName(room, state.leaderId)} เป็นหัวหน้าคนแรก`, 'day');
    beginTeamPhase(room);
}

/* ---------------------------------------------------------------- team */

function submitTeam(room, playerId, teamIds, context = {}) {
    const state = assertPlaying(room);
    if (state.phase !== 'team') throw new Error('ตอนนี้ไม่ใช่ช่วงเลือกทีม');
    assertStep(state, context);
    assertSeat(room, playerId);
    if (state.leaderId !== playerId) throw new Error('หัวหน้าเท่านั้นที่เลือกทีมได้');
    const quest = currentQuest(state);
    if (!Array.isArray(teamIds)) throw new Error(`เลือกทีม ${quest.size} คน`);
    const unique = Array.from(new Set(teamIds.map(id => String(id || ''))));
    if (unique.length !== teamIds.length) throw new Error('เลือกคนซ้ำไม่ได้');
    if (unique.length !== quest.size) throw new Error(`ภารกิจนี้ต้องใช้ ${quest.size} คนพอดี`);
    unique.forEach(id => {
        const seat = getSeat(room, id);
        if (!seat) throw new Error('มีคนในทีมที่ไม่ได้อยู่ในเกม');
        if (seat.left) throw new Error(`${seat.name} ออกจากเกมไปแล้ว เลือกไม่ได้`);
    });
    return beginVotePhase(room, unique);
}

function autoPickTeam(room) {
    const state = room.gameState;
    const quest = currentQuest(state);
    const picks = [];
    let cursor = getSeat(room, state.leaderId);
    if (cursor && !cursor.left) picks.push(cursor.playerId);
    let guard = 0;
    while (picks.length < quest.size && guard < state.seats.length * 2) {
        cursor = nextActiveSeat(room, cursor ? cursor.playerId : state.leaderId);
        if (!cursor) break;
        if (!picks.includes(cursor.playerId)) picks.push(cursor.playerId);
        guard += 1;
    }
    return picks;
}

/* ---------------------------------------------------------------- vote */

function submitVote(room, playerId, vote, context = {}) {
    const state = assertPlaying(room);
    if (state.phase !== 'vote') throw new Error('ตอนนี้ไม่ใช่ช่วงโหวต');
    assertStep(state, context);
    assertSeat(room, playerId);
    if (vote !== 'approve' && vote !== 'reject') throw new Error('เลือก เห็นด้วย หรือ คัดค้าน');
    if (state.votes[playerId]) throw new Error('คุณโหวตไปแล้ว');
    state.votes[playerId] = vote;
    if (activeSeats(room).every(seat => state.votes[seat.playerId])) {
        resolveVote(room);
    }
    return state;
}

function resolveVote(room) {
    const state = room.gameState;
    const voters = activeSeats(room);
    const votes = voters.map(seat => ({ playerId: seat.playerId, vote: state.votes[seat.playerId] || 'approve', auto: !state.votes[seat.playerId] }));
    const approveCount = votes.filter(entry => entry.vote === 'approve').length;
    const rejectCount = votes.length - approveCount;
    const approved = approveCount * 2 > votes.length;
    const questNumber = state.questIndex + 1;
    const teamIds = [...(state.proposal?.teamIds || [])];
    const leaderId = state.proposal?.leaderId || state.leaderId;

    state.lastVote = {
        questNumber,
        attempt: state.rejectCount + 1,
        leaderId,
        teamIds,
        votes: votes.map(({ playerId, vote }) => ({ playerId, vote })),
        approveCount,
        rejectCount,
        approved
    };
    state.votes = {};
    pushFx(room, { kind: 'vote', approved, approveCount, rejectCount, questNumber });

    const next = nextActiveSeat(room, leaderId);
    state.leaderId = next ? next.playerId : leaderId;

    if (approved) {
        state.rejectCount = 0;
        pushHistory(room, '✅', `ทีมผ่าน ${approveCount}:${rejectCount} — ออกภารกิจ ${questNumber}`, 'vote-pass');
        state.proposal = { leaderId, teamIds };
        state.questCards = {};
        setPhase(room, 'quest', QUEST_MS);
        const anyoneToPlay = teamIds.some(id => {
            const member = getSeat(room, id);
            return member && !member.left;
        });
        if (!anyoneToPlay) return resolveQuest(room);
        return state;
    }

    state.rejectCount += 1;
    pushHistory(room, '❌', `ทีมไม่ผ่าน ${approveCount}:${rejectCount} (คัดค้านติดกัน ${state.rejectCount}/${MAX_REJECTS})`, 'vote-fail');
    if (state.rejectCount >= MAX_REJECTS) {
        return finishGame(room, 'evil', 'rejects', `ทีมถูกคัดค้าน ${MAX_REJECTS} ครั้งติด อาณาจักรแตกแยก`);
    }
    return beginTeamPhase(room);
}

/* ---------------------------------------------------------------- quest */

function submitQuestCard(room, playerId, card, context = {}) {
    const state = assertPlaying(room);
    if (state.phase !== 'quest') throw new Error('ตอนนี้ไม่ใช่ช่วงออกภารกิจ');
    assertStep(state, context);
    const seat = assertSeat(room, playerId);
    const teamIds = state.proposal?.teamIds || [];
    if (!teamIds.includes(playerId)) throw new Error('คุณไม่ได้อยู่ในทีมภารกิจนี้');
    if (card !== 'success' && card !== 'fail') throw new Error('เลือกการ์ด สำเร็จ หรือ ล้มเหลว');
    if (card === 'fail' && seat.team !== 'evil') throw new Error('ฝ่ายดีลงได้แค่การ์ดสำเร็จ');
    if (state.questCards[playerId]) throw new Error('คุณลงการ์ดไปแล้ว');
    state.questCards[playerId] = card;
    const pending = teamIds.filter(id => {
        const member = getSeat(room, id);
        return member && !member.left && !state.questCards[id];
    });
    if (!pending.length) resolveQuest(room);
    return state;
}

function resolveQuest(room) {
    const state = room.gameState;
    const quest = currentQuest(state);
    const teamIds = [...(state.proposal?.teamIds || [])];
    const cards = teamIds.map(id => state.questCards[id] || 'success');
    const failCount = cards.filter(card => card === 'fail').length;
    const result = failCount >= quest.failsNeeded ? 'fail' : 'success';

    quest.result = result;
    quest.failCount = failCount;
    quest.teamIds = teamIds;
    quest.leaderId = state.proposal?.leaderId || null;
    state.lastQuest = {
        questNumber: quest.number,
        teamIds,
        cards: shuffle(cards),
        failCount,
        successCount: cards.length - failCount,
        failsNeeded: quest.failsNeeded,
        result
    };
    state.questCards = {};
    state.proposal = null;
    pushHistory(
        room,
        result === 'success' ? '🏆' : '💥',
        `ภารกิจ ${quest.number} ${result === 'success' ? 'สำเร็จ' : 'ล้มเหลว'} (การ์ดล้ม ${failCount} ใบ)`,
        result === 'success' ? 'quest-success' : 'quest-fail'
    );
    pushFx(room, { kind: 'quest', questNumber: quest.number, result, failCount, cards: state.lastQuest.cards });

    if (countResults(state, 'fail') >= WIN_QUESTS) {
        return finishGame(room, 'evil', 'quests', `ภารกิจล้มเหลวครบ ${WIN_QUESTS} ครั้ง`);
    }
    if (countResults(state, 'success') >= WIN_QUESTS) {
        return beginAssassination(room);
    }
    state.questIndex += 1;
    state.rejectCount = 0;
    return beginTeamPhase(room);
}

/* ---------------------------------------------------------------- assassination */

function pickActingAssassin(room) {
    const seats = activeSeats(room);
    const assassin = seats.find(seat => seat.role === 'assassin');
    if (assassin) return assassin;
    return seats.find(seat => seat.team === 'evil' && seat.role !== 'oberon')
        || seats.find(seat => seat.team === 'evil')
        || null;
}

function beginAssassination(room) {
    const state = room.gameState;
    const assassin = pickActingAssassin(room);
    if (!assassin) {
        return finishGame(room, 'good', 'quests', `ภารกิจสำเร็จ ${WIN_QUESTS} ครั้ง และไม่มีมือสังหารเหลือบนโต๊ะ`);
    }
    state.assassinId = assassin.playerId;
    state.proposal = null;
    setPhase(room, 'assassin', ASSASSIN_MS);
    pushHistory(room, '🗡️', `ฝ่ายดีสำเร็จ ${WIN_QUESTS} ภารกิจ — ${assassin.name} เปิดตัวเป็นมือสังหาร เลือกแทงเมอร์ลิน`, 'assassin');
    pushFx(room, { kind: 'assassin', assassinId: assassin.playerId });
    return state;
}

/** เป้าที่มือสังหารแทงได้: ทุกคนยกเว้นตัวเองและฝ่ายร้ายที่เขารู้จัก */
function assassinTargets(room) {
    const state = room.gameState;
    const assassin = getSeat(room, state.assassinId);
    if (!assassin) return [];
    const known = new Set(getKnowledge(state, assassin).map(entry => entry.playerId));
    return state.seats
        .filter(seat => seat.playerId !== assassin.playerId && !known.has(seat.playerId))
        .map(seat => seat.playerId);
}

function submitAssassination(room, playerId, targetId, context = {}) {
    const state = assertPlaying(room);
    if (state.phase !== 'assassin') throw new Error('ตอนนี้ไม่ใช่ช่วงลอบสังหาร');
    assertStep(state, context);
    assertSeat(room, playerId);
    if (state.assassinId !== playerId) throw new Error('มือสังหารเท่านั้นที่เลือกเป้าได้');
    const target = getSeat(room, targetId);
    if (!target) throw new Error('ไม่พบเป้าหมาย');
    if (!assassinTargets(room).includes(targetId)) throw new Error('เลือกคนนี้ไม่ได้ — ต้องเป็นคนที่คุณคิดว่าเป็นฝ่ายดี');
    return resolveAssassination(room, targetId);
}

function resolveAssassination(room, targetId) {
    const state = room.gameState;
    const target = getSeat(room, targetId);
    state.assassinTargetId = targetId;
    const hit = target?.role === 'merlin';
    const merlin = state.seats.find(seat => seat.role === 'merlin');
    pushFx(room, { kind: 'stab', targetId, hit });
    if (hit) {
        return finishGame(room, 'evil', 'assassin', `มือสังหารแทงถูก — ${target.name} คือเมอร์ลิน`);
    }
    return finishGame(room, 'good', 'assassin-miss',
        `มือสังหารแทงพลาด (${target?.name || '-'}) — เมอร์ลินตัวจริงคือ ${merlin?.name || '-'}`);
}

/* ---------------------------------------------------------------- timeouts */

function autoResolvePhase(room, options = {}) {
    const state = room?.gameState;
    if (!state || state.mode !== 'avalon' || isFinished(state) || state.phase === 'lobby') return state;
    if (!options.force && state.phaseEndsAt && Date.now() < state.phaseEndsAt) return state;
    refreshSeats(room);
    if (checkAbandoned(room)) return room.gameState;

    if (state.phase === 'night') {
        pushHistory(room, '⏰', 'หมดเวลาดูบท — เริ่มเลือกทีม');
        endNight(room);
        return state;
    }
    if (state.phase === 'team') {
        const picks = autoPickTeam(room);
        pushHistory(room, '⏰', `${seatName(room, state.leaderId)} เลือกทีมไม่ทัน — ระบบเลือกให้`);
        return beginVotePhase(room, picks);
    }
    if (state.phase === 'vote') {
        const missing = activeSeats(room).filter(seat => !state.votes[seat.playerId]).length;
        if (missing) pushHistory(room, '⏰', `หมดเวลาโหวต — ${missing} คนที่ไม่โหวตนับเป็นเห็นด้วย`);
        return resolveVote(room);
    }
    if (state.phase === 'quest') {
        const missing = (state.proposal?.teamIds || []).filter(id => !state.questCards[id]).length;
        if (missing) pushHistory(room, '⏰', `หมดเวลาภารกิจ — ลงการ์ดสำเร็จแทน ${missing} คน`);
        return resolveQuest(room);
    }
    if (state.phase === 'assassin') {
        const goodTargets = assassinTargets(room).filter(id => getSeat(room, id)?.team === 'good');
        const pool = goodTargets.length ? goodTargets : assassinTargets(room);
        const target = pool[Math.floor(Math.random() * pool.length)];
        pushHistory(room, '⏰', 'มือสังหารเลือกไม่ทัน — สุ่มเป้าให้');
        return resolveAssassination(room, target);
    }
    return state;
}

/* ---------------------------------------------------------------- leave */

function handlePlayerLeft(room, playerId) {
    const state = room?.gameState;
    if (!state || state.mode !== 'avalon' || isFinished(state) || state.phase === 'lobby') return state;
    const seat = getSeat(room, playerId);
    if (!seat || seat.left) return state;
    seat.left = true;
    pushHistory(room, '🚪', `${seat.name} ออกจากโต๊ะ`, 'left');
    if (checkAbandoned(room)) return room.gameState;

    if (state.phase === 'night') {
        if (activeSeats(room).every(entry => entry.ready)) endNight(room);
        return state;
    }
    if (state.phase === 'team') {
        if (state.leaderId === playerId) {
            const next = nextActiveSeat(room, playerId);
            state.leaderId = next ? next.playerId : null;
            pushHistory(room, '👑', `หัวหน้าออก — ส่งต่อให้ ${seatName(room, state.leaderId)}`);
            state.proposalNumber = Math.max(0, (Number(state.proposalNumber) || 1) - 1);
            beginTeamPhase(room);
        }
        return state;
    }
    if (state.phase === 'vote') {
        // โหวตนับเฉพาะคนที่ยังอยู่ · หัวหน้าที่ออกระหว่างโหวต — resolveVote ส่งต่อให้คนถัดไปเอง
        delete state.votes[playerId];
        if (activeSeats(room).every(entry => state.votes[entry.playerId])) resolveVote(room);
        return state;
    }
    if (state.phase === 'quest') {
        const teamIds = state.proposal?.teamIds || [];
        if (teamIds.includes(playerId) && !state.questCards[playerId]) {
            state.questCards[playerId] = 'success';
        }
        const pending = teamIds.filter(id => {
            const member = getSeat(room, id);
            return member && !member.left && !state.questCards[id];
        });
        if (!pending.length) resolveQuest(room);
        return state;
    }
    if (state.phase === 'assassin' && state.assassinId === playerId) {
        const replacement = pickActingAssassin(room);
        if (!replacement) {
            return finishGame(room, 'good', 'quests', 'มือสังหารออกจากโต๊ะ ไม่มีใครลอบสังหารแทน');
        }
        state.assassinId = replacement.playerId;
        pushHistory(room, '🗡️', `มือสังหารออก — ${replacement.name} รับหน้าที่เลือกเป้าแทน`);
        setPhase(room, 'assassin', ASSASSIN_MS);
    }
    return state;
}

/* ---------------------------------------------------------------- client view */

function publicRole(roleId) {
    const role = ROLE_DEFINITIONS[roleId];
    if (!role) return null;
    return { id: role.id, team: role.team, thaiName: role.thaiName, title: role.title, icon: role.icon, image: role.image, blurb: role.blurb };
}

function buildRoleSummary(state) {
    const plan = state.seats?.length
        ? state.seats.map(seat => seat.role)
        : [];
    const counts = {};
    plan.forEach(roleId => { counts[roleId] = (counts[roleId] || 0) + 1; });
    const order = ['merlin', 'percival', 'loyal', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'];
    return order.filter(id => counts[id]).map(id => ({ ...publicRole(id), count: counts[id] }));
}

function buildClientState(room, viewerPlayerId) {
    const state = room?.gameState || createInitialState();
    if (state.mode === 'avalon' && !isFinished(state)) refreshSeats(room);
    const finished = isFinished(state) && state.phase === 'finished';
    const viewer = (state.seats || []).find(seat => seat.playerId === viewerPlayerId) || null;
    const knowledge = viewer ? getKnowledge(state, viewer) : [];
    const knowledgeById = {};
    knowledge.forEach(entry => { knowledgeById[entry.playerId] = entry.tag; });
    const onlineIds = new Set((state.players || []).filter(player => player.socketId || isBotId(player.playerId)).map(player => player.playerId));
    const proposalIds = state.proposal?.teamIds || [];
    const quest = currentQuest(state);
    const lastVoteById = {};
    (state.lastVote?.votes || []).forEach(entry => { lastVoteById[entry.playerId] = entry.vote; });

    const inPhase = phase => state.phase === phase;
    const viewerActive = !!(viewer && !viewer.left && !finished);
    const onTeam = !!(viewer && proposalIds.includes(viewer.playerId));
    const targets = inPhase('assassin') ? assassinTargets(room) : [];

    return {
        mode: 'avalon',
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        isFinished: finished,
        phaseEndsAt: state.phaseEndsAt,
        timeoutHint: TIMEOUT_HINTS[state.phase] || '',
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        playerCount: state.playerCount || (state.seats || []).length,
        teamCounts: TEAM_COUNTS[state.playerCount] || null,
        rolesInPlay: buildRoleSummary(state),
        questIndex: state.questIndex,
        questNumber: (state.questIndex || 0) + 1,
        quests: (state.quests || []).map(entry => ({
            number: entry.number,
            size: entry.size,
            failsNeeded: entry.failsNeeded,
            result: entry.result,
            failCount: entry.result ? entry.failCount : null,
            // ทีมที่ออกภารกิจแล้วเป็นข้อมูลสาธารณะ — ให้ทุกคนย้อนดูได้ว่าใครอยู่ในภารกิจที่ล้ม
            teamIds: entry.result ? [...(entry.teamIds || [])] : [],
            leaderId: entry.result ? (entry.leaderId || null) : null
        })),
        currentQuest: quest ? { number: quest.number, size: quest.size, failsNeeded: quest.failsNeeded } : null,
        successCount: countResults(state, 'success'),
        failCount: countResults(state, 'fail'),
        rejectCount: state.rejectCount || 0,
        maxRejects: MAX_REJECTS,
        leaderId: state.leaderId,
        proposalNumber: state.proposalNumber || 0,
        proposal: state.proposal && (inPhase('vote') || inPhase('quest'))
            ? { leaderId: state.proposal.leaderId, teamIds: [...proposalIds] }
            : null,
        votedCount: inPhase('vote') ? Object.keys(state.votes || {}).length : 0,
        questPlayedCount: inPhase('quest') ? Object.keys(state.questCards || {}).length : 0,
        readyCount: inPhase('night') ? (state.seats || []).filter(seat => seat.ready && !seat.left).length : 0,
        lastVote: state.lastVote ? { ...state.lastVote, votes: state.lastVote.votes.map(entry => ({ ...entry })) } : null,
        lastQuest: state.lastQuest ? { ...state.lastQuest, cards: [...state.lastQuest.cards] } : null,
        assassinId: (inPhase('assassin') || finished) ? state.assassinId : null,
        assassinTargetId: finished ? state.assassinTargetId : null,
        assassinTargets: viewer && state.assassinId === viewer.playerId ? targets : [],
        winner: state.winner || null,
        history: (state.history || []).slice(0, 30),
        fx: state.fx || [],
        art: ART,
        self: viewer ? {
            playerId: viewer.playerId,
            seat: viewer.seat,
            role: publicRole(viewer.role),
            team: viewer.team,
            knowledge: knowledge.map(entry => ({ ...entry, name: seatName(room, entry.playerId) })),
            left: !!viewer.left,
            ready: !!viewer.ready,
            isLeader: state.leaderId === viewer.playerId,
            canPickTeam: viewerActive && inPhase('team') && state.leaderId === viewer.playerId,
            canVote: viewerActive && inPhase('vote') && !state.votes[viewer.playerId],
            myVote: inPhase('vote') ? (state.votes[viewer.playerId] || null) : null,
            onTeam: onTeam && (inPhase('vote') || inPhase('quest')),
            canPlayQuest: viewerActive && inPhase('quest') && onTeam && !state.questCards[viewer.playerId],
            canFail: viewer.team === 'evil',
            myQuestCard: inPhase('quest') ? (state.questCards[viewer.playerId] || null) : null,
            isAssassin: state.assassinId === viewer.playerId && (inPhase('assassin') || finished),
            canAssassinate: viewerActive && inPhase('assassin') && state.assassinId === viewer.playerId
        } : null,
        players: (state.seats || []).map(seat => {
            const reveal = finished;
            return {
                playerId: seat.playerId,
                name: seat.name,
                color: seat.color,
                avatar: seat.avatar,
                avatarFrame: seat.avatarFrame,
                seat: seat.seat,
                isSelf: seat.playerId === viewerPlayerId,
                // ช่วงลอบสังหารไม่มีหัวหน้าแล้ว — ไม่โชว์มงกุฎค้าง
                isLeader: seat.playerId === state.leaderId && !finished && !inPhase('assassin'),
                onTeam: proposalIds.includes(seat.playerId) && (inPhase('vote') || inPhase('quest')),
                hasVoted: inPhase('vote') ? !!state.votes[seat.playerId] : false,
                hasPlayed: inPhase('quest') ? !!state.questCards[seat.playerId] : false,
                ready: inPhase('night') ? !!seat.ready : true,
                left: !!seat.left,
                online: onlineIds.has(seat.playerId),
                known: knowledgeById[seat.playerId] || null,
                lastVote: lastVoteById[seat.playerId] || null,
                isAssassin: (inPhase('assassin') || finished) && seat.playerId === state.assassinId,
                role: reveal ? publicRole(seat.role) : null,
                team: reveal ? seat.team : null
            };
        })
    };
}

module.exports = {
    id: 'avalon',
    label: 'อวาลอน',
    description: 'อัศวินโต๊ะกลม 5–10 คน — ฝ่ายดีทำภารกิจ ฝ่ายร้ายแฝงตัวบ่อนทำลาย เมอร์ลินต้องไม่ถูกจับได้',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    ROLE_DEFINITIONS,
    OPTIONAL_ROLES,
    TEAM_COUNTS,
    QUEST_SIZES,
    MAX_REJECTS,
    ART,
    TIMINGS: { NIGHT_MS, TEAM_MS, VOTE_MS, QUEST_MS, ASSASSIN_MS },
    sanitizeRoleSelection,
    getRolePlan,
    getKnowledge,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    submitReady,
    submitTeam,
    submitVote,
    submitQuestCard,
    submitAssassination,
    autoResolvePhase,
    handlePlayerLeft,
    buildClientState
};
