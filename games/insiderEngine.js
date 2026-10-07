// Insider (Oink Games) — state + กติกาแบบ pure function (ไม่ยุ่ง socket/timer) ให้ app.js เรียก และเทสต์ได้ตรงๆ
// กติกาจริง: rules/insider/rules.md
const defaultRole = 'พลเมือง';
const MASTER_ROLE = 'ผู้ดำเนินเกม';
const INSIDER_ROLE = 'จอมบงการ';

// R6: พลิกนาฬิกาทราย = เวลาคุยเท่ากับเวลาที่ใช้ถามไป — ขั้นต่ำ 30 วิ เพราะออนไลน์ต้องพิมพ์แชท
const DISCUSSION_MIN_SECONDS = 30;
const ROUND_MINUTES_DEFAULT = 5; // R4: นาฬิกาทราย ~5 นาที
const ROUND_MINUTES_MAX = 10;
const ROUND_MINUTES_MIN = 0.05; // ~3 วิ — ใช้ในเทสต์ (UI ให้เลือก 1–10 นาที)

function createInitialState() {
    return {
        mode: 'insider',
        players: [],
        word: '',
        countdown: null,
        resultVote1: null,
        resultVote2: null,
        status: '',
        lastAction: 0
    };
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        socketId: context.socketId || null,
        name: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        role: '',
        vote1: null,
        vote2: null,
        nbVote2: 0,
        isGhost: false,
        permission: context.isAdmin ? 'admin' : null
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: room.players.map(player => ({
            ...createPlayerState({
                playerId: player.playerId,
                playerName: player.playerName,
                color: player.color,
                avatar: player.avatar,
                avatarFrame: player.avatarFrame
            }, {
                socketId: player.socketId,
                isAdmin: player.permission === 'admin'
            }),
            role: defaultRole
        }))
    };
}

// ==================== settings ====================

function sanitizeRoundMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return ROUND_MINUTES_DEFAULT;
    return Math.min(ROUND_MINUTES_MAX, Math.max(ROUND_MINUTES_MIN, minutes));
}

// ค่าเริ่มต้น = กติกาจริง (โหวตคนทายถูกก่อน) — ปิดได้เฉพาะเมื่อส่ง false มาตรงๆ
function sanitizeGuesserVote(value) {
    return value !== false && value !== 'false' && value !== 0;
}

// ==================== timing ====================

/** R6 — เวลาคุยหลังทายถูก = เวลาที่ใช้ถามไปแล้ว (นาฬิกาทรายพลิกกลับ) */
function discussionSeconds(questionSeconds, remainingSeconds) {
    const total = Math.max(0, Number(questionSeconds) || 0);
    const left = Math.min(total, Math.max(0, Number(remainingSeconds) || 0));
    const used = Math.round(total - left);
    return Math.max(DISCUSSION_MIN_SECONDS, used);
}

// ==================== players ====================

// ผู้เล่นที่ต้องนับผล = คนที่อยู่ตอนนี้ + คนที่ออกกลางเกม (จาก roster ตอนแจกบท)
function getScoringPlayers(gameState) {
    const current = Array.isArray(gameState?.players) ? gameState.players : [];
    const roster = Array.isArray(gameState?.rosterSnapshot) ? gameState.rosterSnapshot : [];
    const presentIds = new Set(current.map(p => p.playerId));
    return current.concat(roster.filter(p => p.playerId && !presentIds.has(p.playerId)));
}

function countInsiders(gameState) {
    return (gameState?.players || []).filter(p => p.role === INSIDER_ROLE).length;
}

function findGuesser(gameState) {
    if (!gameState?.guesserId) return null;
    return (gameState.players || []).find(p => p.playerId === gameState.guesserId) || null;
}

/** ใครเป็นคนทายถูกได้: ทุกคนยกเว้นผู้ดำเนินเกม (พลเมือง/จอมบงการ) */
function canBeGuesser(player) {
    return !!player && !!player.role && player.role !== MASTER_ROLE;
}

/** ผู้ต้องสงสัยในโหวตชี้ตัว: ทุกคนยกเว้นผู้ดำเนินเกม (เปิดเผยตัวอยู่แล้ว) และผี */
function vote2Candidates(gameState) {
    return (gameState?.players || []).filter(p => p.role !== MASTER_ROLE && !p.isGhost);
}

/** R7 — โหวตคนทายถูก: ทุกคนยกเว้นคนทายถูก (ผู้ดำเนินเกมโหวตด้วย) · ผี/คนหลุดไม่นับ */
function vote1Voters(gameState) {
    return (gameState?.players || []).filter(p => p.playerId !== gameState.guesserId && !p.isGhost && !!p.socketId);
}

/** R8 — โหวตชี้ตัว: ทุกคน (รวมผู้ดำเนินเกมและคนทายถูก) · ผี/คนหลุดไม่นับ */
function vote2Voters(gameState) {
    return (gameState?.players || []).filter(p => !p.isGhost && !!p.socketId);
}

function hasVoted2(player) {
    return player.vote2 !== null && typeof player.vote2 !== 'undefined' && player.vote2 !== '';
}

function hasEveryoneVoted(gameState, phase) {
    if (phase === 'vote1') return vote1Voters(gameState).every(p => p.vote1 === 'yes' || p.vote1 === 'no');
    return vote2Voters(gameState).every(hasVoted2);
}

/** ใครโหวตได้ในเฟสนั้น — คืนเหตุผลถ้าโหวตไม่ได้ */
function voteDenyReason(gameState, player, phase) {
    if (!player) return 'ไม่พบผู้เล่น';
    if (player.isGhost) return 'รอบนี้คุณเป็นผี 👻 ไม่มีสิทธิ์โหวต — รอดูผลได้เลย';
    if (phase === 'vote1' && player.playerId === gameState.guesserId) return 'คุณเป็นคนทายถูก — รอบนี้คนอื่นโหวตว่าคุณใช่จอมบงการไหม';
    if (phase === 'tiebreak' && player.playerId !== gameState.guesserId) return 'คะแนนเสมอ — คนทายถูกเป็นคนตัดสิน';
    return null;
}

// ==================== vote 1: คนทายถูกคือจอมบงการไหม ====================

function buildVote1Progress(gameState) {
    const voters = vote1Voters(gameState);
    const submitted = voters.filter(p => p.vote1 === 'yes' || p.vote1 === 'no');
    return {
        totalEligibleVoters: voters.length,
        totalSubmittedVoters: submitted.length,
        submittedIds: submitted.map(p => p.playerId),
        pendingVoters: voters.filter(p => !submitted.includes(p)).map(p => p.name)
    };
}

/** R7 — เสียง "ใช่" ต้องเกินครึ่งของคนที่มีสิทธิ์ (เสมอ = ไม่ผ่าน · ไม่โหวต = ไม่ยกมือ) */
function resolveVote1(gameState) {
    const voters = vote1Voters(gameState);
    const yes = voters.filter(p => p.vote1 === 'yes').length;
    const no = voters.length - yes;
    return { yes, no, total: voters.length, majority: voters.length > 0 && yes * 2 > voters.length };
}

function baseResult(gameState) {
    const scoring = getScoringPlayers(gameState);
    const traitors = scoring.filter(p => p.role === INSIDER_ROLE);
    const presentIds = new Set((gameState.players || []).map(p => p.playerId));
    return {
        traitors,
        leftTraitors: traitors.filter(p => !presentIds.has(p.playerId)),
        common: {
            hasTraitor: traitors.length > 0,
            numTraitors: traitors.length,
            word: gameState.word || null,
            guesserName: gameState.guesserName || null,
            allRoles: scoring.map(p => ({ name: p.name, role: p.role }))
        }
    };
}

/** โหวตแรกผ่าน (เสียงข้างมากว่า "ใช่") → เปิดบทคนทายถูก จบเกมทันที */
function buildVote1Result(gameState) {
    const { traitors, leftTraitors, common } = baseResult(gameState);
    const guesser = getScoringPlayers(gameState).find(p => p.playerId === gameState.guesserId) || null;
    const caughtInsider = !!guesser && guesser.role === INSIDER_ROLE;
    let finalTraitorName;
    if (leftTraitors.length) finalTraitorName = traitors.map(t => t.name).join(' และ ') + ' (ออกจากเกม)';
    else if (traitors.length) finalTraitorName = traitors.map(t => t.name).join(' และ ');
    else finalTraitorName = 'ไม่มีจอมบงการ';
    return {
        ...common,
        hasWon: leftTraitors.length > 0 || caughtInsider,
        voteDetail: [],
        finalTraitorName,
        decidedBy: 'vote1',
        pickedName: guesser ? guesser.name : null,
        tie: false,
        guesserVote: gameState.resultVote1 || null
    };
}

// ==================== vote 2: ชี้ตัวจอมบงการ ====================

function voteTargetsOf(player) {
    const raw = player?.vote2;
    if (raw === null || typeof raw === 'undefined' || raw === '') return [];
    return (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
}

/** นับคะแนนใหม่ทุกครั้ง (เรียกซ้ำหลังตัดสินเสมอได้ ไม่บวกซ้ำ) */
function tallyVote2(gameState) {
    const players = gameState.players || [];
    players.forEach(p => { p.nbVote2 = 0; });
    players.forEach(voter => {
        voteTargetsOf(voter).forEach(target => {
            const hit = players.find(p => p.playerId === target || p.name === target);
            if (hit) hit.nbVote2 += 1;
        });
    });
    return players
        .filter(p => p.role !== MASTER_ROLE)
        .slice()
        .sort((a, b) => b.nbVote2 - a.nbVote2);
}

function buildVote2Progress(gameState) {
    const players = gameState.players || [];
    const targets = players.filter(p => p.role !== MASTER_ROLE).map(p => ({
        playerId: p.playerId, name: p.name, count: 0, voters: []
    }));
    const targetMap = new Map(targets.map(t => [t.playerId || t.name, t]));
    const voters = vote2Voters(gameState);
    const voterChoices = [];
    voters.forEach(voter => {
        const values = voteTargetsOf(voter);
        if (!values.length) return;
        const names = [];
        values.forEach(value => {
            const target = players.find(p => p.playerId === value || p.name === value);
            if (!target) return;
            const summary = targetMap.get(target.playerId || target.name);
            if (summary) {
                summary.count += 1;
                summary.voters.push(voter.name);
            }
            names.push(target.name);
        });
        voterChoices.push({ voterId: voter.playerId, voterName: voter.name, voteValues: values, targets: names });
    });
    return {
        targets,
        voterChoices,
        pendingVoters: voters.filter(v => !hasVoted2(v)).map(v => v.name),
        totalEligibleVoters: voters.length,
        totalSubmittedVoters: voterChoices.length
    };
}

/**
 * ตัดสินโหวตชี้ตัว
 * - จอมบงการ 1 คน (หรือรอบไม่มีจอมบงการ): คะแนนสูงสุดคนเดียว = ถูกจับ
 *   เสมอ (R8) → คนทายถูกตัดสิน: ถ้าคนทายถูกโหวตให้คนที่เสมออยู่แล้ว = เลือกคนนั้น
 *   ไม่งั้นถามคนทายถูก (allowTiebreak) · ไม่มีใครตัดสิน = ไม่มีใครโดนจับ (จอมบงการชนะ)
 * - โหมด 2 จอมบงการ (กติกาบ้าน): 2 อันดับแรกต้องเป็นจอมบงการทั้งคู่ และอันดับ 2 ต้องนำอันดับ 3
 * คืน { needsTiebreak:true, tied } เมื่อต้องรอคนทายถูก, ไม่งั้นเขียน gameState.resultVote2 แล้วคืน { needsTiebreak:false }
 */
function processVote2Result(gameState, options = {}) {
    const sorted = tallyVote2(gameState);
    const { traitors, leftTraitors, common } = baseResult(gameState);
    const numTraitors = traitors.length;
    const voteDetail = sorted.map(p => ({ name: p.name, role: p.role, nbVote2: p.nbVote2 || 0, isGhost: !!p.isGhost }));

    let hasWon;
    let finalTraitorName;
    let decidedBy = 'vote2';
    let pickedName = null;
    let tie = false;

    if (numTraitors >= 2) {
        const top2 = sorted.slice(0, 2);
        const caught = top2.filter(p => p.role === INSIDER_ROLE && p.nbVote2 > 0);
        const second = sorted[1];
        const third = sorted[2];
        const secondLeads = !third || (second && second.nbVote2 > third.nbVote2);
        if (leftTraitors.length) {
            hasWon = true;
            finalTraitorName = traitors.map(t => t.name).join(' และ ') + ' (ออกจากเกม)';
        } else if (caught.length === 2 && secondLeads) {
            hasWon = true;
            finalTraitorName = caught.map(t => t.name).join(' และ ');
        } else if (caught.length === 1) {
            hasWon = false;
            const missed = traitors.find(t => t.playerId !== caught[0].playerId);
            finalTraitorName = `จับได้ ${caught[0].name} แต่พลาด ${missed ? missed.name : '?'}`;
        } else {
            hasWon = false;
            finalTraitorName = traitors.map(t => t.name).join(' และ ');
        }
    } else {
        const candidates = sorted.filter(p => !p.isGhost);
        const topCount = candidates.length ? candidates[0].nbVote2 : 0;
        const tied = topCount > 0 ? candidates.filter(p => p.nbVote2 === topCount) : [];
        let picked = null;
        if (tied.length === 1) {
            picked = tied[0];
        } else if (tied.length > 1) {
            tie = true;
            const guesser = findGuesser(gameState);
            const guesserVote = guesser ? voteTargetsOf(guesser)[0] : null;
            const tiedIds = tied.map(p => p.playerId);
            if (guesserVote && tiedIds.includes(guesserVote)) {
                picked = tied.find(p => p.playerId === guesserVote);
                decidedBy = 'guesser-vote';
            } else if (gameState.tiebreakPick && tiedIds.includes(gameState.tiebreakPick)) {
                picked = tied.find(p => p.playerId === gameState.tiebreakPick);
                decidedBy = 'tiebreak';
            } else if (options.allowTiebreak && guesser && guesser.socketId && !gameState.tiebreakAsked) {
                return { needsTiebreak: true, tied: tiedIds };
            } else {
                decidedBy = 'tie-unresolved';
            }
        }
        pickedName = picked ? picked.name : null;

        if (leftTraitors.length) {
            hasWon = true;
            finalTraitorName = traitors.map(t => t.name).join(' และ ') + ' (ออกจากเกม)';
        } else if (numTraitors === 1) {
            hasWon = !!picked && picked.role === INSIDER_ROLE;
            finalTraitorName = traitors[0].name;
        } else if (!picked && topCount === 0) {
            hasWon = true;
            finalTraitorName = 'ไม่มีจอมบงการ';
        } else {
            hasWon = false;
            finalTraitorName = 'ไม่มีจอมบงการ (แต่ผู้เล่นโหวตพลาด)';
        }
    }

    gameState.resultVote2 = {
        ...common,
        hasWon,
        // ส่งให้ทุกคนตอนจบ — เฉพาะที่หน้าผลใช้ ห้ามแนบ object ผู้เล่นทั้งก้อน
        voteDetail,
        finalTraitorName,
        decidedBy,
        pickedName,
        tie,
        guesserVote: gameState.resultVote1 || null
    };
    return { needsTiebreak: false };
}

module.exports = {
    id: 'insider',
    label: 'Insider',
    description: 'เกม Insider ที่ทุกคนจะได้รับบทบาทและต้องเดาคำลับจากคำใบ้ที่ผู้เล่นคนหนึ่งรู้คำลับนั้น',
    // R1: กล่อง 4–8 คน · 3 คนเล่นไม่ได้จริง (พลเมืองคนเดียวรู้ทันทีว่าอีกคนคือจอมบงการ) · บนเว็บให้ถึง 10
    minPlayers: 4,
    maxPlayers: 10,
    MASTER_ROLE,
    INSIDER_ROLE,
    DEFAULT_ROLE: defaultRole,
    DISCUSSION_MIN_SECONDS,
    ROUND_MINUTES_DEFAULT,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    sanitizeRoundMinutes,
    sanitizeGuesserVote,
    discussionSeconds,
    getScoringPlayers,
    countInsiders,
    findGuesser,
    canBeGuesser,
    vote2Candidates,
    vote1Voters,
    vote2Voters,
    hasEveryoneVoted,
    voteDenyReason,
    buildVote1Progress,
    resolveVote1,
    buildVote1Result,
    tallyVote2,
    buildVote2Progress,
    processVote2Result
};
