const ROLE_SPY = 'spy';
const ROLE_CITIZEN = 'citizen';

const REVEAL_PHASE_MS = Math.max(1000, Number(process.env.SPYFALL_REVEAL_PHASE_MS) || 5000);
const VOTE_PHASE_MS = 90 * 1000;
// โหวตเห็นด้วย/ไม่เห็นด้วยกับคำกล่าวหา และเวลาเลือกคนที่จะกล่าวหาตอนหมดเวลา
const ACCUSE_VOTE_MS = Math.max(1000, Number(process.env.SPYFALL_ACCUSE_VOTE_MS) || 60 * 1000);
const FINAL_PICK_MS = Math.max(1000, Number(process.env.SPYFALL_FINAL_PICK_MS) || 30 * 1000);
// คู่มือ: 3–8 คน
const MIN_PLAYERS = 3;

const { gameAssetImage } = require('./gameAssets');

const SPYFALL_IMAGE = (id) => gameAssetImage('spyfall', id);

const ROLE_DEFINITIONS = {
    [ROLE_CITIZEN]: {
        id: ROLE_CITIZEN,
        icon: '🕵️',
        image: SPYFALL_IMAGE('citizen'),
        title: 'พลเมือง',
        summary: 'คุณรู้สถานที่และบทในที่นั้น — ถาม–ตอบหาสายลับ อย่าบอกสถานที่ตรงๆ'
    },
    [ROLE_SPY]: {
        id: ROLE_SPY,
        icon: '🕶️',
        image: SPYFALL_IMAGE('spy'),
        title: 'สายลับ',
        summary: 'คุณไม่รู้สถานที่ — เนียนตอบให้รอด ไม่โดนจับ = ชนะ · หยุดเวลาทายสถานที่ได้ 1 ครั้ง (ถูกชนะ ผิดแพ้)'
    }
};

const LOCATIONS = [
    { id: 'school', icon: '🏫', image: SPYFALL_IMAGE('school'), name: 'โรงเรียน', hint: 'ครู นักเรียน กระดาน ห้องเรียน' },
    { id: 'hospital', icon: '🏥', image: SPYFALL_IMAGE('hospital'), name: 'โรงพยาบาล', hint: 'หมอ พยาบาล ผู้ป่วย เครื่องมือแพทย์' },
    { id: 'submarine', icon: '🛳️', image: SPYFALL_IMAGE('submarine'), name: 'เรือดำน้ำ', hint: 'ตู่ หลอดออกซิเจน ลูกเรือ มืด' },
    { id: 'sushi', icon: '🍣', image: SPYFALL_IMAGE('sushi'), name: 'ร้านซูชิ', hint: 'เชฟ ปลาดิบ โต๊ะบาร์ สายพาน' },
    { id: 'space', icon: '🚀', image: SPYFALL_IMAGE('space'), name: 'สถานีอวกาศ', hint: 'นักบิน แรงโน้มถ่วง ห้องควบคุม ชุดอวกาศ' },
    { id: 'bank', icon: '🏦', image: SPYFALL_IMAGE('bank'), name: 'ธนาคาร', hint: 'ตู้เอทีเอ็ม พนักงาน เงินสด ห้องนิรภัย' },
    { id: 'circus', icon: '🎪', image: SPYFALL_IMAGE('circus'), name: 'ละครสัตว์', hint: 'ม้า ช้าง โดม ตัวตลก' },
    { id: 'police', icon: '🚓', image: SPYFALL_IMAGE('police'), name: 'สถานีตำรวจ', hint: 'เครื่องแบบ กุญแจมือ คดี ห้องสอบสวน' },
    { id: 'beach', icon: '🏖️', image: SPYFALL_IMAGE('beach'), name: 'ชายหาด', hint: 'ทราย คลื่น ร่ม กันแดด' },
    { id: 'casino', icon: '🎰', image: SPYFALL_IMAGE('casino'), name: 'คาสิโน', hint: 'ไพ่ ชิป โต๊ะเดิมพัน แสงไฟ' },
    { id: 'theater', icon: '🎭', image: SPYFALL_IMAGE('theater'), name: 'โรงละคร', hint: 'เวที ม่าน ตั๋ว ไฟสปอตไลท์' },
    { id: 'airport', icon: '✈️', image: SPYFALL_IMAGE('airport'), name: 'สนามบิน', hint: 'เคาน์เตอร์เช็กอิน สายพาน ประกาศเที่ยวบิน' },
    { id: 'library', icon: '📚', image: SPYFALL_IMAGE('library'), name: 'ห้องสมุด', hint: 'หนังสือ ความเงียบ ชั้นวาง บัตรสมาชิก' },
    { id: 'factory', icon: '🏭', image: SPYFALL_IMAGE('factory'), name: 'โรงงาน', hint: 'สายพาน หมวกนิรภัย เครื่องจักร กะทำงาน' },
    { id: 'temple', icon: '🛕', image: SPYFALL_IMAGE('temple'), name: 'วัด', hint: 'ระฆัง ธูป ศาลา ผู้มาทำบุญ' },
    { id: 'supermarket', icon: '🛒', image: SPYFALL_IMAGE('supermarket'), name: 'ซูเปอร์มาร์เก็ต', hint: 'รถเข็น ชั้นวาง แคชเชียร์ โปรโมชัน' },
    { id: 'zoo', icon: '🦁', image: SPYFALL_IMAGE('zoo'), name: 'สวนสัตว์', hint: 'กรง ไกด์ สัตว์ป่า ตั๋วเข้าชม' },
    { id: 'wedding', icon: '💒', image: SPYFALL_IMAGE('wedding'), name: 'งานแต่งงาน', hint: 'เจ้าบ่าว เจ้าสาว ช่อดอกไม้ แขก' }
];

/** บทในสถานที่ (คนละบท) — สายลับไม่ได้รับบทนี้ */
const LOCATION_ROLES_BY_ID = {
    school: ['ครูผู้สอน', 'นักเรียน', 'ครูใหญ่', 'ภารโรง', 'พยาบาลโรงเรียน', 'บรรณารักษ์', 'โค้ชกีฬา', 'นักเรียนใหม่'],
    hospital: ['แพทย์', 'พยาบาล', 'ผู้ป่วยในเตียง', 'เจ้าหน้าที่เวร', 'รังสีแพทย์', 'เภสัชกร', 'คนไข้ฉุกเฉิน', 'ญาติผู้ป่วย'],
    submarine: ['กัปตัน', 'ลูกเรือห้องเครื่อง', 'พ่อครัว', 'มัคคุเทศก์', 'ลูกเรือเฝ้า', 'ช่างซ่อม', 'นักวิทยาศร์', 'ลูกเรือใหม่'],
    sushi: ['เชฟมือหลัก', 'ผู้ช่วยเชฟ', 'พนักงานเสิร์ฟ', 'ลูกค้าประจำ', 'คนทำความสะอาด', 'พนักงานแคชเชียร์', 'นักวิจารณ์อาหาร', 'เด็กเสิร์ฟ'],
    space: ['ผู้บัญชาการ', 'นักบินอวกาศ', 'วิศวกรระบบ', 'แพทย์อวกาศ', 'นักวิทยาศร์', 'ช่างซ่อม', 'ผู้เชี่ยวชาญการสื่อสาร', 'นักบินฝึกหัด'],
    bank: ['พนักงานเคาน์เตอร์', 'ผู้จัดการสาขา', 'รปภ.', 'ลูกค้า', 'พนักงานนิรภัย', 'ที่ปรึกษาการเงิน', 'คนทำความสะอาด', 'ผู้มาเยี่ยม'],
    circus: ['ตัวตลก', 'นักเล่นกล', 'คนฝึกสัตว์', 'พนักงานขายตั๋ว', 'ช่างแสง', 'นักแสดงไฟ', 'คนดูแลม้า', 'แขก VIP'],
    police: ['สารวัตร', 'ตำรวจสายสืบ', 'ตำรวจเวร', 'ผู้ต้องหา', 'พยาน', 'ทนาย', 'ช่างถ่ายรูปหลักฐาน', 'เจ้าหน้าที่รับแจ้ง'],
    beach: ['ไลฟ์การ์ด', 'พ่อค้าเช่าร่ม', 'นักท่องคลื่น', 'ครอบครัวมาเที่ยว', 'ช่างภาพ', 'พนักงานบาร์ริมหาด', 'คนขายของฝาก', 'นักดำน้ำตื้น'],
    casino: ['เจ้ามือ', 'เจ้าหน้าที่รปภ.', 'นักพนัน', 'พนักงานบาร์', 'ผู้จัดการพื้น', 'เคาน์เตอร์แลกชิป', 'นักเล่นไพ่', 'คนดูแลเครื่องดื่ม'],
    theater: ['นักแสดงนำ', 'ผู้กำกับ', 'ช่างแสง', 'ช่างเสียง', 'พนักงานขายตั๋ว', 'ตัวประกอบ', 'ช่างเวที', 'ผู้ชมแถวหน้า'],
    airport: ['พนักงานเช็กอิน', 'เจ้าหน้าที่ความปลอดภัย', 'นักเดินทาง', 'พนักงานต้อนรับ', 'ช่างซ่อมเครื่องบิน', 'พนักงานขนส่ง', 'ไกด์ทัวร์', 'ผู้โดยสารรอต่อ'],
    library: ['บรรณารักษ์', 'นักอ่านประจำ', 'นักศึกษา', 'เด็กนักเรียนมาค้นความ', 'อาสาสมัคร', 'คนดูแลห้องอ่าน', 'นักวิจัย', 'ผู้มาใช้คอม'],
    factory: ['หัวหน้ากะ', 'พนักงานสายพาน', 'ช่างซ่อม', 'ควบคุมคุณภาพ', 'คนขับรถโฟล์คลิฟต์', 'พนักงานคลัง', 'วิศวกรโรงงาน', 'ฝึกงาน'],
    temple: ['พระ', 'เณร', 'ผู้ดูแลวัด', 'ผู้มาทำบุญ', 'พ่อค้าเครื่องบูชา', 'ช่างภาพงานบุญ', 'เจ้าหน้าที่จอดรถ', 'แขกร่วมพิธี'],
    supermarket: ['แคชเชียร์', 'พนักงานเติมของ', 'ผู้จัดการแผนก', 'ลูกค้าประจำ', 'พนักงานรักษาความปลอดภัย', 'คนขับรถส่งของ', 'พนักงานโปรโมชัน', 'ช็อปปิ้งด่วน'],
    zoo: ['ไกด์นำชม', 'สัตวแพทย์', 'พนักงานดูแลกรง', 'นักเรียนทัศนศึกษา', 'ช่างภาพ', 'พ่อค้าของที่ระลึก', 'ผู้เยี่ยมชม', 'พนักงานขายตั๋ว'],
    wedding: ['เจ้าบ่าว', 'เจ้าสาว', 'เพื่อนเจ้าสาว', 'เพื่อนเจ้าบ่าว', 'MC', 'ช่างภาพ', 'แขกโต๊ะ VIP', 'พ่อครัวงานเลี้ยง']
};

const GENERIC_LOCATION_ROLES = [
    'ผู้จัดการ', 'พนักงานหน้า', 'ลูกค้า', 'ผู้เยี่ยมชม', 'รปภ.', 'ช่าง', 'คนส่งของ', 'ผู้มาใหม่'
];

function shuffle(items) {
    const clone = [...items];
    for (let index = clone.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
    }
    return clone;
}

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}


// ===== ค่าตั้งห้อง (กติกาจริง: เป็นเอกฉันท์, เล่นหลายรอบ) =====
const ROUND_OPTIONS = [1, 3, 5];
const DEFAULT_ROUNDS = 5; // คู่มือ: "แนะนำเล่น 5 รอบ"
const VOTE_MODE_UNANIMOUS = 'unanimous';
const VOTE_MODE_MAJORITY = 'majority';

function sanitizeRounds(value) {
    const n = Number(value);
    return ROUND_OPTIONS.includes(n) ? n : DEFAULT_ROUNDS;
}

function sanitizeVoteMode(value) {
    return value === VOTE_MODE_MAJORITY ? VOTE_MODE_MAJORITY : VOTE_MODE_UNANIMOUS;
}

function createInitialState() {
    return {
        mode: 'spyfall',
        status: 'waiting',
        phase: 'lobby',
        voteMode: VOTE_MODE_UNANIMOUS,
        locationId: null,
        locationName: null,
        locationIcon: null,
        locationImage: null,
        locationHint: null,
        spyPlayerId: null,
        players: [],
        votes: {},
        voteCounts: {},
        accusedPlayerId: null,
        winner: null,
        history: [],
        lastAction: 0,
        phaseEndsAt: null,
        statsRecordedAt: null,
        // ลำดับถาม–ตอบ: เจ้ามือถามก่อน คนที่ถูกถามได้ถามต่อ (ห้ามถามกลับคนที่เพิ่งถามเรา)
        askerId: null,
        lastAskerId: null,
        questionCount: 0,
        timesAsked: {},
        // ปุ่ม "พร้อมโหวต" — เกินครึ่งของคนออนไลน์กด = ข้ามเวลาที่เหลือ
        readyToVote: {},
        // หยุดเวลากล่าวหา: คนละครั้งต่อรอบ
        stopUsed: {},
        accusation: null,
        pausedRemainingMs: null,
        finalRound: null,
        match: null,
        returnLobbyAt: null,
        nextRoundAt: null
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
        permission: context.isAdmin ? 'admin' : null,
        role: '',
        roleInfo: null,
        locationRoleTitle: null,
        hasVoted: false,
        voteTargetId: null
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
        }, {
            socketId: player.socketId,
            isAdmin: player.permission === 'admin'
        }))
    };
}

function getPlayer(room, playerId) {
    if (!playerId) return null;
    return room.gameState.players.find(player => player.playerId === playerId) || null;
}

function getActivePlayers(room) {
    return room.gameState.players.filter(player => !!player.playerId);
}

function isPlayerOnline(room, playerId) {
    const roomPlayer = room.players?.find(player => player.playerId === playerId);
    if (roomPlayer) {
        return !!roomPlayer.socketId;
    }
    return !!getPlayer(room, playerId)?.socketId;
}

function setPhaseDeadline(room, durationMs) {
    room.gameState.phaseEndsAt = Date.now() + durationMs;
}

function getDiscussionMs(room) {
    // คู่มือ: รอบละ 8 นาที
    const seconds = Number(room?.settings?.roundTime || 480);
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 480;
    return safeSeconds * 1000;
}

function getVoteMs(room) {
    const seconds = Number(room?.settings?.spyfallVoteSeconds || 90);
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 90;
    return safeSeconds * 1000;
}

// โหวตเห็นด้วย/ไม่เห็นด้วยกับคำกล่าวหา — กดปุ่มเดียว ไม่ต้องนาน
function getAccuseVoteMs(room) {
    return Math.min(ACCUSE_VOTE_MS, getVoteMs(room));
}

function getFinalPickMs() {
    return FINAL_PICK_MS;
}

function getPhaseDurationMs(room, phase) {
    if (phase === 'reveal') return REVEAL_PHASE_MS;
    if (phase === 'discussion') return getDiscussionMs(room);
    if (phase === 'accuse') return getAccuseVoteMs(room);
    if (phase === 'final') return room?.gameState?.accusation ? getAccuseVoteMs(room) : getFinalPickMs();
    return getVoteMs(room);
}

function isUnanimousMode(room) {
    return room?.gameState?.voteMode !== VOTE_MODE_MAJORITY;
}

function getAllLocations() {
    let extra = [];
    try {
        const gameSettingsManager = require('../managers/gameSettingsManager');
        extra = gameSettingsManager.getSpyfallExtraLocations();
    } catch (error) {
        extra = [];
    }
    return [...LOCATIONS, ...extra];
}

function getLocationRolePool(location) {
    if (location?.roles && Array.isArray(location.roles) && location.roles.length > 0) {
        return location.roles.map(r => String(r).trim()).filter(Boolean);
    }
    const preset = LOCATION_ROLES_BY_ID[location?.id];
    if (preset && preset.length > 0) {
        return [...preset];
    }
    const fromHint = String(location?.hint || '')
        .split(/[\s,，、]+/)
        .map(s => s.trim())
        .filter(s => s.length >= 2);
    if (fromHint.length >= 4) {
        return fromHint.slice(0, 8);
    }
    return [...GENERIC_LOCATION_ROLES];
}

function assignLocationRoles(room, location, spyPlayerId) {
    const citizens = shuffle(getActivePlayers(room).filter(p => p.playerId !== spyPlayerId));
    const pool = shuffle(getLocationRolePool(location));
    const n = citizens.length;
    if (pool.length >= n) {
        const picked = shuffle(pool).slice(0, n);
        citizens.forEach((player, index) => {
            player.locationRoleTitle = picked[index];
        });
    } else {
        const extended = [];
        while (extended.length < n) {
            extended.push(...shuffle(pool));
        }
        citizens.forEach((player, index) => {
            player.locationRoleTitle = extended[index];
        });
    }
    const spy = getPlayer(room, spyPlayerId);
    if (spy) {
        spy.locationRoleTitle = null;
    }
}

function pushHistory(room, icon, text, tone = 'neutral') {
    room.gameState.history.unshift({
        icon,
        text,
        tone,
        at: new Date().toISOString()
    });
    room.gameState.history = room.gameState.history.slice(0, 30);
}

function assignRoles(room, spyPlayerId, location) {
    room.gameState.players.forEach(player => {
        if (player.playerId === spyPlayerId) {
            player.role = ROLE_SPY;
            player.roleInfo = ROLE_DEFINITIONS[ROLE_SPY];
        } else {
            player.role = ROLE_CITIZEN;
            player.roleInfo = ROLE_DEFINITIONS[ROLE_CITIZEN];
        }
        player.locationRoleTitle = null;
        player.hasVoted = false;
        player.voteTargetId = null;
    });
    assignLocationRoles(room, location, spyPlayerId);
}

function getOnlinePlayers(room) {
    return getActivePlayers(room).filter(player => isPlayerOnline(room, player.playerId));
}

function countLobbyPlayers(room) {
    return (room.players || []).filter(player => player.playerId).length;
}

// ===== แมตช์หลายรอบ =====
function createMatch(room) {
    return {
        round: 0,
        totalRounds: sanitizeRounds(room?.settings?.spyfallRounds),
        scores: {},
        names: {},
        dealerId: null,
        rounds: [],
        over: false,
        winnerIds: []
    };
}

function syncMatchRoster(room) {
    const match = room.gameState.match;
    room.gameState.players.forEach(player => {
        if (match.scores[player.playerId] === undefined) {
            match.scores[player.playerId] = 0;
        }
        match.names[player.playerId] = player.name;
    });
}

function beginRound(room, match, voteMode, dealerHint) {
    room.gameState = resetRoomGame(room);
    const state = room.gameState;
    state.voteMode = voteMode;
    state.match = match;
    match.round += 1;
    syncMatchRoster(room);

    const activePlayers = getActivePlayers(room);
    const onlinePlayers = activePlayers.filter(player => isPlayerOnline(room, player.playerId));
    const pool = onlinePlayers.length ? onlinePlayers : activePlayers;
    // เจ้ามือ: รอบแรกสุ่ม · รอบถัดไป = สายลับรอบก่อน (ถ้ายังอยู่)
    const dealer = (dealerHint && pool.find(player => player.playerId === dealerHint)) || pickRandom(pool);
    match.dealerId = dealer.playerId;

    const location = pickRandom(getAllLocations());
    // สายลับต้องเป็นคนที่ออนไลน์ตอนเริ่ม — ไม่งั้นเกมไม่มีสายลับเล่นจริง
    const spyPlayer = pickRandom(pool);

    state.locationId = location.id;
    state.locationName = location.name;
    state.locationIcon = location.icon;
    state.locationImage = location.image || (location.id ? SPYFALL_IMAGE(location.id) : null);
    state.locationHint = location.hint;
    state.spyPlayerId = spyPlayer.playerId;
    state.spyName = spyPlayer.name || null;
    state.spyGuess = null;
    state.lastAction = Date.now();
    state.roundStartedAt = Date.now();

    assignRoles(room, spyPlayer.playerId, location);
    // roster ตอนแจกบท — คนออกกลางเกม (โดยเฉพาะสายลับ) ยังต้องถูกนับสถิติ
    state.rosterSnapshot = state.players.map(player => ({
        playerId: player.playerId,
        name: player.name,
        role: player.role
    }));
    moveToRevealPhase(room);
    return state;
}

function startGame(room) {
    if (countLobbyPlayers(room) < MIN_PLAYERS) {
        throw new Error(`ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน`);
    }
    const match = createMatch(room);
    const voteMode = sanitizeVoteMode(room?.settings?.spyfallVoteMode);
    return beginRound(room, match, voteMode, null);
}

function isMatchOver(room) {
    const match = room?.gameState?.match;
    return !match || !!match.over;
}

// รอบต่อไปในแมตช์เดิม — คะแนนสะสมต่อ, สายลับรอบที่แล้วเป็นเจ้ามือ
function startNextRound(room) {
    const state = room?.gameState;
    if (!state || state.phase !== 'finished' || !state.match) {
        throw new Error('ยังไม่จบรอบนี้');
    }
    if (state.match.over) {
        throw new Error('ครบทุกรอบแล้ว');
    }
    if (countLobbyPlayers(room) < MIN_PLAYERS) {
        throw new Error(`ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คน`);
    }
    const lastSpyId = state.spyPlayerId;
    return beginRound(room, state.match, state.voteMode, lastSpyId);
}

// ผู้เล่นเหลือไม่พอเล่นรอบต่อไป → จบแมตช์ตรงนี้ (ใช้ตอนจะเริ่มรอบถัดไปไม่ได้)
function endMatchEarly(room) {
    const match = room?.gameState?.match;
    if (!match || match.over) return false;
    match.over = true;
    match.endedEarly = true;
    match.winnerIds = computeMatchWinners(match);
    return true;
}

function computeMatchWinners(match) {
    const entries = Object.entries(match.scores || {});
    if (!entries.length) return [];
    const top = Math.max(...entries.map(([, score]) => score));
    if (top <= 0) return [];
    return entries.filter(([, score]) => score === top).map(([id]) => id);
}

function moveToRevealPhase(room) {
    room.gameState.phase = 'reveal';
    room.gameState.status = 'spyfall_reveal';
    setPhaseDeadline(room, REVEAL_PHASE_MS);
    const match = room.gameState.match;
    const dealer = getPlayer(room, match?.dealerId);
    pushHistory(room, '🎭', `รอบ ${match?.round || 1}/${match?.totalRounds || 1} — แจกสถานที่และบทแล้ว${dealer ? ` · เจ้ามือ ${dealer.name}` : ''}`, 'gold');
}

function pickFirstAsker(room) {
    const online = getOnlinePlayers(room);
    const pool = online.length ? online : getActivePlayers(room);
    return pool.length ? pickRandom(pool) : null;
}

function moveToDiscussionPhase(room) {
    const state = room.gameState;
    state.phase = 'discussion';
    state.status = 'spyfall_discussion';
    state.votes = {};
    state.readyToVote = {};
    state.questionCount = 0;
    state.timesAsked = {};
    state.lastAskerId = null;
    state.stopUsed = {};
    state.accusation = null;
    state.pausedRemainingMs = null;
    state.players.forEach(player => {
        player.hasVoted = false;
        player.voteTargetId = null;
    });
    setPhaseDeadline(room, getDiscussionMs(room));
    pushHistory(room, '💬', 'เริ่มถาม–ตอบ — อย่าเปิดเผยสถานที่ตรงๆ', 'teal');
    // คู่มือ: เจ้ามือถามคนแรก
    const dealer = getPlayer(room, state.match?.dealerId);
    const firstAsker = dealer && isPlayerOnline(room, dealer.playerId) ? dealer : pickFirstAsker(room);
    state.askerId = firstAsker ? firstAsker.playerId : null;
    if (firstAsker) {
        pushHistory(room, '🎤', `${firstAsker.name}${firstAsker === dealer ? ' (เจ้ามือ)' : ''} ถามก่อน — เลือก 1 คนแล้วถามได้เลย`, 'teal');
    }
}

const VOTE_REASON_TEXT = {
    timeout: 'หมดเวลาคุย — โหวตจับสายลับ',
    host: 'หัวหน้าห้องจบช่วงคุย — เริ่มโหวตจับสายลับ',
    ready: 'ผู้เล่นเกินครึ่งพร้อมโหวต — เริ่มโหวตจับสายลับ'
};

const FINAL_REASON_TEXT = {
    timeout: 'หมดเวลา — ไล่กล่าวหาทีละคน เริ่มจากเจ้ามือ',
    host: 'หัวหน้าห้องจบช่วงคุย — ไล่กล่าวหาทีละคน เริ่มจากเจ้ามือ',
    ready: 'ผู้เล่นเกินครึ่งพร้อมโหวต — ไล่กล่าวหาทีละคน เริ่มจากเจ้ามือ'
};

// โหมดเสียงข้างมาก (ค่าตั้งห้อง): โหวตลับพร้อมกันครั้งเดียว
function moveToVotePhase(room, reason = 'timeout') {
    room.gameState.phase = 'vote';
    room.gameState.status = 'spyfall_vote';
    room.gameState.votes = {};
    room.gameState.accusation = null;
    room.gameState.players.forEach(player => {
        player.hasVoted = false;
        player.voteTargetId = null;
    });
    setPhaseDeadline(room, getVoteMs(room));
    pushHistory(room, reason === 'timeout' ? '🗳️' : '⏭️', VOTE_REASON_TEXT[reason] || VOTE_REASON_TEXT.timeout, 'amber');
}

// จบเวลาคุย: เป็นเอกฉันท์ → ไล่กล่าวหา · เสียงข้างมาก → โหวตลับ
function endDiscussion(room, reason = 'timeout') {
    if (isUnanimousMode(room)) {
        enterFinalRound(room, reason);
    } else {
        moveToVotePhase(room, reason);
    }
}

function getReadyNeeded(room) {
    const online = getOnlinePlayers(room).length || getActivePlayers(room).length;
    return Math.floor(online / 2) + 1;
}

function getReadyCount(room) {
    const ready = room.gameState.readyToVote || {};
    return getActivePlayers(room).filter(player => ready[player.playerId] && isPlayerOnline(room, player.playerId)).length;
}

function assertSpyfall(room) {
    if (!room?.gameState || room.settings?.gameMode !== 'spyfall') {
        throw new Error('ไม่พบเกมนี้');
    }
}

// คนที่ถูกถามจะได้เป็นคนถามคนต่อไป · ห้ามถามกลับคนที่เพิ่งถามเรา
function passQuestion(room, playerId, targetPlayerId, options = {}) {
    assertSpyfall(room);
    if (room.gameState.phase !== 'discussion') {
        throw new Error('ส่งคำถามได้เฉพาะช่วงคุย');
    }
    const caller = getPlayer(room, playerId);
    if (!caller) {
        throw new Error('ไม่พบผู้เล่น');
    }
    const askerId = room.gameState.askerId;
    const asker = askerId ? getPlayer(room, askerId) : null;
    // ปกติคนที่ถึงตาเป็นคนกด · หัวหน้าห้องกดแทนได้ (เช่นคนถามวางมือถือ/หลุด)
    if (asker && askerId !== playerId && !options.isHost) {
        throw new Error(`ตอนนี้ตาของ ${asker.name} ถาม`);
    }
    const fromId = asker ? askerId : playerId;
    const target = getPlayer(room, targetPlayerId);
    if (!target) {
        throw new Error('เลือกผู้เล่นไม่ถูกต้อง');
    }
    if (targetPlayerId === fromId) {
        throw new Error('ถามตัวเองไม่ได้ — เลือกคนอื่น');
    }
    if (room.gameState.lastAskerId && targetPlayerId === room.gameState.lastAskerId && getActivePlayers(room).length > 2) {
        throw new Error('ห้ามถามกลับคนที่เพิ่งถามคุณ — เลือกคนอื่น');
    }
    const from = getPlayer(room, fromId);
    room.gameState.lastAskerId = fromId;
    room.gameState.askerId = targetPlayerId;
    room.gameState.questionCount = (room.gameState.questionCount || 0) + 1;
    room.gameState.timesAsked = room.gameState.timesAsked || {};
    room.gameState.timesAsked[targetPlayerId] = (room.gameState.timesAsked[targetPlayerId] || 0) + 1;
    room.gameState.lastAction = Date.now();
    pushHistory(room, '🎤', `${from?.name || 'ผู้เล่น'} ถาม ${target.name} — ${target.name} ตอบแล้วถามต่อ`, 'teal');
    return { askerId: targetPlayerId };
}

function toggleReadyToVote(room, playerId) {
    assertSpyfall(room);
    if (room.gameState.phase !== 'discussion') {
        throw new Error('กดพร้อมโหวตได้เฉพาะช่วงคุย');
    }
    if (!getPlayer(room, playerId)) {
        throw new Error('ไม่พบผู้เล่น');
    }
    room.gameState.readyToVote = room.gameState.readyToVote || {};
    const nowReady = !room.gameState.readyToVote[playerId];
    if (nowReady) {
        room.gameState.readyToVote[playerId] = true;
    } else {
        delete room.gameState.readyToVote[playerId];
    }
    room.gameState.lastAction = Date.now();
    return { ready: nowReady, ...checkReadyToVote(room) };
}

function checkReadyToVote(room) {
    if (room?.gameState?.phase !== 'discussion') {
        return { advanced: false };
    }
    const count = getReadyCount(room);
    const needed = getReadyNeeded(room);
    if (count >= needed) {
        endDiscussion(room, 'ready');
        room.gameState.lastAction = Date.now();
        return { advanced: true, phase: room.gameState.phase, count, needed };
    }
    return { advanced: false, phase: room.gameState.phase, count, needed };
}

// คนถามหลุด/ออก → ส่งตาให้คนที่ยังออนไลน์ ไม่งั้นทั้งวงรอคนที่ไม่อยู่
function ensureAskerPresent(room) {
    const state = room?.gameState;
    if (!state || state.phase !== 'discussion') {
        return false;
    }
    if (state.askerId && getPlayer(room, state.askerId)) {
        return false;
    }
    const online = getOnlinePlayers(room).filter(player => player.playerId !== state.lastAskerId);
    const next = online.length ? pickRandom(online) : pickFirstAsker(room);
    state.askerId = next ? next.playerId : null;
    if (next) {
        pushHistory(room, '🎤', `คนถามออกจากเกม — ${next.name} ถามต่อ`, 'teal');
    }
    return true;
}

// ===== กล่าวหา (หยุดเวลา) — ต้องเห็นด้วยทุกคน ยกเว้นคนถูกกล่าวหา =====
function getAccusationVoters(room) {
    const accusation = room.gameState.accusation;
    if (!accusation) return [];
    return getActivePlayers(room).filter(player => player.playerId !== accusation.suspectId);
}

function openAccusation(room, accuserId, suspectId, kind) {
    const accuser = getPlayer(room, accuserId);
    const suspect = getPlayer(room, suspectId);
    room.gameState.accusation = {
        accuserId,
        accuserName: accuser?.name || '',
        suspectId,
        suspectName: suspect?.name || '',
        kind,
        votes: { [accuserId]: true },
        startedAt: Date.now()
    };
    setPhaseDeadline(room, getAccuseVoteMs(room));
    room.gameState.lastAction = Date.now();
}

function stopClockAccuse(room, playerId, suspectId) {
    assertSpyfall(room);
    const state = room.gameState;
    if (!isUnanimousMode(room)) {
        throw new Error('ห้องนี้ใช้โหวตแบบเสียงข้างมาก — รอโหวตตอนจบเวลา');
    }
    if (state.phase !== 'discussion') {
        throw new Error('หยุดเวลากล่าวหาได้เฉพาะตอนเวลายังเดิน');
    }
    const accuser = getPlayer(room, playerId);
    if (!accuser) {
        throw new Error('ไม่พบผู้เล่น');
    }
    if (state.stopUsed?.[playerId]) {
        throw new Error('รอบนี้คุณกล่าวหาไปแล้ว (ได้คนละครั้งต่อรอบ)');
    }
    const suspect = getPlayer(room, suspectId);
    if (!suspect || suspectId === playerId) {
        throw new Error('เลือกคนที่จะกล่าวหาไม่ถูกต้อง');
    }
    state.stopUsed = state.stopUsed || {};
    state.stopUsed[playerId] = true;
    state.pausedRemainingMs = Math.max(0, (state.phaseEndsAt || Date.now()) - Date.now());
    state.phase = 'accuse';
    state.status = 'spyfall_accuse';
    openAccusation(room, playerId, suspectId, 'stop');
    pushHistory(room, '🛑', `${accuser.name} หยุดเวลา กล่าวหา ${suspect.name} ว่าเป็นสายลับ — ทุกคน (ยกเว้น ${suspect.name}) ต้องเห็นด้วย`, 'amber');
    return { ...checkAccusation(room), phase: room.gameState.phase };
}

// ช่วงไล่กล่าวหาหลังหมดเวลา: คนที่ถึงตาเลือกคนที่จะกล่าวหา
function finalAccuse(room, playerId, suspectId) {
    assertSpyfall(room);
    const state = room.gameState;
    if (state.phase !== 'final' || !state.finalRound) {
        throw new Error('ยังไม่ถึงช่วงไล่กล่าวหา');
    }
    if (state.accusation) {
        throw new Error('กำลังโหวตคำกล่าวหาอยู่');
    }
    const turnId = state.finalRound.order[state.finalRound.index];
    if (turnId !== playerId) {
        const turnPlayer = getPlayer(room, turnId);
        throw new Error(`ตอนนี้ตาของ ${turnPlayer?.name || 'คนอื่น'} กล่าวหา`);
    }
    const accuser = getPlayer(room, playerId);
    const suspect = getPlayer(room, suspectId);
    if (!accuser || !suspect || suspectId === playerId) {
        throw new Error('เลือกคนที่จะกล่าวหาไม่ถูกต้อง');
    }
    openAccusation(room, playerId, suspectId, 'final');
    pushHistory(room, '👉', `${accuser.name} กล่าวหา ${suspect.name} — ทุกคน (ยกเว้น ${suspect.name}) ต้องเห็นด้วย`, 'amber');
    return { ...checkAccusation(room), phase: room.gameState.phase };
}

function voteAccusation(room, playerId, agree) {
    assertSpyfall(room);
    const state = room.gameState;
    const accusation = state.accusation;
    if (!accusation || (state.phase !== 'accuse' && state.phase !== 'final')) {
        throw new Error('ตอนนี้ไม่มีคำกล่าวหาให้โหวต');
    }
    if (!getPlayer(room, playerId)) {
        throw new Error('ไม่พบผู้เล่น');
    }
    if (playerId === accusation.suspectId) {
        throw new Error('คนถูกกล่าวหาไม่ได้โหวต');
    }
    if (accusation.votes[playerId] !== undefined) {
        throw new Error('คุณโหวตไปแล้ว');
    }
    accusation.votes[playerId] = agree === true;
    state.lastAction = Date.now();
    return { ...checkAccusation(room), phase: state.phase };
}

// ตรวจผลคำกล่าวหา: มีคนไม่เห็นด้วย = ล้ม · ทุกคนที่ออนไลน์เห็นด้วย = เปิดการ์ด
// timeout: คนที่ยังไม่โหวต = ไม่เห็นด้วย
function checkAccusation(room, options = {}) {
    const state = room.gameState;
    const accusation = state.accusation;
    if (!accusation) return { resolved: false };
    const voters = getAccusationVoters(room);
    const anyNo = voters.some(player => accusation.votes[player.playerId] === false);
    if (anyNo) {
        failAccusation(room, 'no');
        return { resolved: true, convicted: false };
    }
    const onlineVoters = voters.filter(player => isPlayerOnline(room, player.playerId) || accusation.votes[player.playerId] !== undefined);
    const allYes = onlineVoters.length > 0 && onlineVoters.every(player => accusation.votes[player.playerId] === true);
    if (allYes) {
        convictSuspect(room);
        return { resolved: true, convicted: true };
    }
    if (options.timeout) {
        failAccusation(room, 'timeout');
        return { resolved: true, convicted: false };
    }
    return { resolved: false };
}

function failAccusation(room, why) {
    const state = room.gameState;
    const accusation = state.accusation;
    state.accusation = null;
    const noVoters = Object.entries(accusation.votes || {})
        .filter(([, value]) => value === false)
        .map(([id]) => getPlayer(room, id)?.name)
        .filter(Boolean);
    const whyText = why === 'timeout'
        ? 'หมดเวลาโหวต (ไม่โหวต = ไม่เห็นด้วย)'
        : (noVoters.length ? `${noVoters.join(', ')} ไม่เห็นด้วย` : 'ไม่เป็นเอกฉันท์');
    pushHistory(room, '✋', `คำกล่าวหา ${accusation.suspectName} ไม่ผ่าน — ${whyText}`, 'neutral');
    if (accusation.kind === 'stop') {
        resumeClock(room);
    } else {
        advanceFinalRound(room);
    }
}

function resumeClock(room) {
    const state = room.gameState;
    const remaining = Number(state.pausedRemainingMs) || 0;
    state.pausedRemainingMs = null;
    if (remaining <= 0) {
        enterFinalRound(room, 'timeout');
        return;
    }
    state.phase = 'discussion';
    state.status = 'spyfall_discussion';
    setPhaseDeadline(room, remaining);
    ensureAskerPresent(room);
    pushHistory(room, '▶️', 'เวลาเดินต่อ — ถาม–ตอบต่อได้เลย', 'teal');
}

function convictSuspect(room) {
    const state = room.gameState;
    const accusation = state.accusation;
    const suspectIsSpy = accusation.suspectId === state.spyPlayerId;
    state.accusation = null;
    state.accusedPlayerId = accusation.suspectId;
    if (suspectIsSpy) {
        finishRound(room, {
            team: 'citizens',
            reason: 'convicted_spy',
            accusedPlayerId: accusation.suspectId,
            accusedName: accusation.suspectName,
            accuserId: accusation.accuserId,
            accuserName: accusation.accuserName
        });
    } else {
        finishRound(room, {
            team: 'spy',
            reason: 'convicted_innocent',
            accusedPlayerId: accusation.suspectId,
            accusedName: accusation.suspectName,
            accuserId: accusation.accuserId,
            accuserName: accusation.accuserName
        });
    }
}

// ===== ไล่กล่าวหาหลังหมดเวลา (เริ่มจากเจ้ามือ วนตามที่นั่ง) =====
function buildFinalOrder(room) {
    const players = getActivePlayers(room);
    const dealerIndex = players.findIndex(player => player.playerId === room.gameState.match?.dealerId);
    const start = dealerIndex >= 0 ? dealerIndex : 0;
    return players.slice(start).concat(players.slice(0, start)).map(player => player.playerId);
}

function isFinalTurnPlayable(room, playerId) {
    return !!getPlayer(room, playerId) && isPlayerOnline(room, playerId);
}

function enterFinalRound(room, reason = 'timeout') {
    const state = room.gameState;
    state.phase = 'final';
    state.status = 'spyfall_final';
    state.accusation = null;
    state.pausedRemainingMs = null;
    state.finalRound = { order: buildFinalOrder(room), index: -1, reason };
    pushHistory(room, reason === 'timeout' ? '⏰' : '⏭️', FINAL_REASON_TEXT[reason] || FINAL_REASON_TEXT.timeout, 'amber');
    advanceFinalRound(room);
}

function advanceFinalRound(room) {
    const state = room.gameState;
    const final = state.finalRound;
    if (!final) return;
    state.accusation = null;
    let next = final.index + 1;
    while (next < final.order.length && !isFinalTurnPlayable(room, final.order[next])) {
        next += 1;
    }
    final.index = next;
    if (next >= final.order.length) {
        state.finalRound = { ...final, done: true };
        finishRound(room, { team: 'spy', reason: 'no_conviction' });
        return;
    }
    setPhaseDeadline(room, getFinalPickMs());
    const turnPlayer = getPlayer(room, final.order[next]);
    pushHistory(room, '👉', `ตา ${turnPlayer?.name || 'ผู้เล่น'} เลือกคนที่จะกล่าวหา`, 'amber');
}

function everyoneVoted(room) {
    return getActivePlayers(room).every(player => {
        if (!isPlayerOnline(room, player.playerId)) {
            return true;
        }
        return !!room.gameState.votes[player.playerId];
    });
}

// ===== คะแนน (คู่มือ) =====
// สายลับชนะ 2 · ได้ 4 ถ้าคนบริสุทธิ์ถูกจับ หรือทายสถานที่ถูก
// สายลับแพ้: พลเมืองคนละ 1 · คนเริ่มคำกล่าวหาที่จับได้ +1
function computeRoundPoints(room, result) {
    const state = room.gameState;
    const points = {};
    const roster = getScoringPlayers(room);
    if (result.team === 'spy') {
        const spyPoints = (result.reason === 'convicted_innocent' || result.reason === 'spy_guess_right' || result.reason === 'majority_innocent') ? 4 : 2;
        points[state.spyPlayerId] = spyPoints;
    } else {
        roster.forEach(player => {
            if (player.playerId !== state.spyPlayerId && getPlayer(room, player.playerId)) {
                points[player.playerId] = 1;
            }
        });
        if (result.reason === 'convicted_spy' && result.accuserId && points[result.accuserId] !== undefined) {
            points[result.accuserId] += 1;
        }
    }
    return points;
}

const TEAM_LABELS = {
    convicted_spy: 'จับสายลับได้ — พลเมืองชนะ',
    convicted_innocent: 'จับผิดคน — สายลับชนะ',
    no_conviction: 'ไม่มีใครถูกจับ — สายลับรอด',
    spy_guess_right: 'สายลับทายสถานที่ถูก — สายลับชนะ',
    spy_guess_wrong: 'สายลับทายสถานที่ผิด — พลเมืองชนะ',
    spy_left: 'สายลับหนีออกจากเกม — พลเมืองชนะ',
    majority_spy: 'พลเมืองชนะ',
    majority_innocent: 'สายลับรอด',
    majority_none: 'สายลับรอด'
};

function finishRound(room, result) {
    const state = room.gameState;
    const spyPlayer = getPlayer(room, state.spyPlayerId);
    const spyDisplayName = spyPlayer?.name || state.spyName || 'ไม่ทราบ';
    const points = computeRoundPoints(room, result);
    const match = state.match;

    state.phase = 'finished';
    state.status = 'spyfall_finished';
    state.phaseEndsAt = null;
    state.accusation = null;
    state.pausedRemainingMs = null;

    if (match) {
        syncMatchRoster(room);
        Object.entries(points).forEach(([playerId, value]) => {
            match.scores[playerId] = (match.scores[playerId] || 0) + value;
        });
        match.rounds.push({
            round: match.round,
            spyId: state.spyPlayerId,
            spyName: spyDisplayName,
            team: result.team,
            reason: result.reason,
            locationName: state.locationName,
            points
        });
        if (match.round >= match.totalRounds) {
            match.over = true;
            match.winnerIds = computeMatchWinners(match);
        }
    }

    state.winner = {
        team: result.team,
        reason: result.reason,
        teamLabel: TEAM_LABELS[result.reason] || (result.team === 'citizens' ? 'พลเมืองชนะ' : 'สายลับรอด'),
        spyPlayerId: state.spyPlayerId,
        spyName: spyDisplayName,
        spyLeft: result.reason === 'spy_left',
        spyGuess: result.spyGuess || null,
        accusedPlayerId: result.accusedPlayerId || null,
        accusedName: result.accusedName || null,
        accuserId: result.accuserId || null,
        accuserName: result.accuserName || null,
        locationId: state.locationId,
        locationName: state.locationName,
        locationIcon: state.locationIcon,
        locationImage: state.locationImage,
        voteCounts: result.voteCounts || {},
        topVotes: result.topVotes || 0,
        wasTie: !!result.wasTie,
        points,
        round: match?.round || 1,
        totalRounds: match?.totalRounds || 1,
        matchOver: !match || !!match.over
    };
    state.lastAction = Date.now();

    const historyText = {
        convicted_spy: `ทุกคนเห็นด้วย — ${result.accusedName} คือสายลับจริง! สถานที่คือ ${state.locationName}`,
        convicted_innocent: `ทุกคนเห็นด้วย แต่ ${result.accusedName} ไม่ใช่สายลับ — สายลับ ${spyDisplayName} ชนะ (สถานที่: ${state.locationName})`,
        no_conviction: `ไม่มีคำกล่าวหาไหนผ่าน — สายลับ ${spyDisplayName} รอด (สถานที่: ${state.locationName})`,
        spy_left: `สายลับ ${spyDisplayName} หนีออกจากเกม — พลเมืองชนะ! สถานที่คือ ${state.locationName}`
    }[result.reason] || null;
    if (historyText) {
        pushHistory(room, result.team === 'citizens' ? '🎉' : '🕶️', historyText, result.team === 'citizens' ? 'green' : 'red');
    }
    if (match?.over) {
        const names = (match.winnerIds || []).map(id => match.names[id]).filter(Boolean);
        pushHistory(room, '🏆', names.length ? `ครบ ${match.totalRounds} รอบ — ${names.join(', ')} คะแนนสูงสุด` : `ครบ ${match.totalRounds} รอบ`, 'gold');
    }
    return state;
}

// โหมดเสียงข้างมาก: นับโหวตลับ — เสียงสูงสุดคนเดียวเท่านั้นที่ถูกจับ (เสมอ = สายลับรอด)
function resolveVotes(room) {
    if (room.gameState.phase === 'finished') {
        return room.gameState;
    }

    // ไม่เติมโหวตสุ่มให้คนที่ไม่ได้โหวต — โหวตที่นับต้องเป็นเจตนาจริงเท่านั้น
    const voteCounts = {};
    getActivePlayers(room).forEach(player => {
        voteCounts[player.playerId] = 0;
    });

    Object.values(room.gameState.votes || {}).forEach(targetId => {
        if (targetId && Object.prototype.hasOwnProperty.call(voteCounts, targetId)) {
            voteCounts[targetId] += 1;
        }
    });

    room.gameState.voteCounts = voteCounts;

    let topVotes = 0;
    let accusedPlayerId = null;
    const tiedIds = [];

    Object.entries(voteCounts).forEach(([playerId, count]) => {
        if (count > topVotes) {
            topVotes = count;
            accusedPlayerId = playerId;
            tiedIds.length = 0;
            tiedIds.push(playerId);
        } else if (count === topVotes && count > 0) {
            tiedIds.push(playerId);
        }
    });

    if (tiedIds.length > 1) {
        accusedPlayerId = null;
    }

    room.gameState.accusedPlayerId = accusedPlayerId;

    const spyPlayer = getPlayer(room, room.gameState.spyPlayerId);
    const spyLeft = !spyPlayer;
    const accusedIsSpy = accusedPlayerId === room.gameState.spyPlayerId;
    const accusedPlayer = accusedPlayerId ? getPlayer(room, accusedPlayerId) : null;
    let reason;
    if (spyLeft) reason = 'spy_left';
    else if (accusedIsSpy && topVotes > 0) reason = 'majority_spy';
    else if (accusedPlayer) reason = 'majority_innocent';
    else reason = 'majority_none';

    finishRound(room, {
        team: (reason === 'spy_left' || reason === 'majority_spy') ? 'citizens' : 'spy',
        reason,
        accusedPlayerId,
        accusedName: accusedPlayer?.name || (tiedIds.length > 1 ? 'เสมอ — สายลับรอด' : 'ไม่มีใครโดนโหวตสูงสุด'),
        voteCounts,
        topVotes,
        wasTie: tiedIds.length > 1
    });

    if (reason !== 'spy_left') {
        const spyDisplayName = room.gameState.winner.spyName;
        pushHistory(
            room,
            reason === 'majority_spy' ? '🎉' : '🕶️',
            reason === 'majority_spy'
                ? `จับสายลับ ${spyDisplayName} ได้! สถานที่คือ ${room.gameState.locationName}`
                : `สายลับ ${spyDisplayName} รอด — สถานที่คือ ${room.gameState.locationName}`,
            reason === 'majority_spy' ? 'green' : 'red'
        );
    }
    return room.gameState;
}

const LIVE_PHASES = ['reveal', 'discussion', 'accuse', 'final', 'vote'];

// เรียกหลังผู้เล่นถูกเอาออกจาก gameState แล้ว
function handlePlayerLeft(room, playerId) {
    const state = room?.gameState;
    if (!state) {
        return null;
    }
    const phase = state.phase;
    if (!LIVE_PHASES.includes(phase)) {
        return null;
    }
    if (playerId === state.spyPlayerId) {
        // สายลับออก → พลเมืองชนะทันที
        pushHistory(room, '🚪', 'สายลับออกจากเกม — จบรอบทันที', 'amber');
        finishRound(room, { team: 'citizens', reason: 'spy_left' });
        return state;
    }
    if (state.readyToVote) {
        delete state.readyToVote[playerId];
    }
    if (state.stopUsed) {
        delete state.stopUsed[playerId];
    }
    if (state.votes) {
        delete state.votes[playerId];
    }
    const accusation = state.accusation;
    if (accusation) {
        delete accusation.votes[playerId];
        if (accusation.suspectId === playerId) {
            // คนถูกกล่าวหาออก → ยกเลิกคำกล่าวหานี้ (คนกล่าวหาได้สิทธิ์คืน)
            state.accusation = null;
            pushHistory(room, '🚪', `${accusation.suspectName} ออกจากเกม — ยกเลิกคำกล่าวหา`, 'neutral');
            if (accusation.kind === 'stop') {
                if (state.stopUsed) delete state.stopUsed[accusation.accuserId];
                resumeClock(room);
            } else {
                setPhaseDeadline(room, getFinalPickMs());
            }
            return null;
        }
        checkAccusation(room);
        return null;
    }
    if (phase === 'final' && state.finalRound && state.finalRound.order[state.finalRound.index] === playerId) {
        advanceFinalRound(room);
        return null;
    }
    ensureAskerPresent(room);
    if (phase === 'discussion' && getReadyCount(room) > 0) {
        checkReadyToVote(room);
    }
    return null;
}

// ผู้เล่นที่ต้องนับสถิติ = คนที่อยู่ตอนนี้ + คนที่ออกกลางเกม (จาก roster ตอนเริ่ม)
function getScoringPlayers(room) {
    const current = Array.isArray(room?.gameState?.players) ? room.gameState.players : [];
    const roster = Array.isArray(room?.gameState?.rosterSnapshot) ? room.gameState.rosterSnapshot : [];
    const presentIds = new Set(current.map(player => player.playerId));
    return current.concat(roster.filter(player => player.playerId && !presentIds.has(player.playerId)));
}

// สายลับหยุดเวลาทายสถานที่ (ครั้งเดียว · เฉพาะตอนเวลายังเดิน): ถูก = ชนะ 4, ผิด = แพ้
function guessLocation(room, playerId, locationId) {
    assertSpyfall(room);
    const phase = room.gameState.phase;
    if (phase !== 'discussion') {
        throw new Error(phase === 'accuse'
            ? 'มีคนหยุดเวลากล่าวหาอยู่ — ทายได้ตอนเวลาเดินต่อ'
            : 'ทายสถานที่ได้เฉพาะตอนเวลายังเดิน (ช่วงคุย)');
    }
    if (!playerId || playerId !== room.gameState.spyPlayerId || !getPlayer(room, playerId)) {
        throw new Error('เฉพาะสายลับเท่านั้นที่ทายสถานที่ได้');
    }
    if (room.gameState.spyGuess) {
        throw new Error('ทายสถานที่ไปแล้ว');
    }
    const guessed = getAllLocations().find(location => location.id === locationId);
    if (!guessed) {
        throw new Error('เลือกสถานที่ไม่ถูกต้อง');
    }

    const correct = guessed.id === room.gameState.locationId;
    const spyPlayer = getPlayer(room, playerId);
    const spyDisplayName = spyPlayer?.name || room.gameState.spyName || 'ไม่ทราบ';
    const spyGuess = { locationId: guessed.id, locationName: guessed.name, correct };
    room.gameState.spyGuess = spyGuess;
    room.gameState.accusedPlayerId = null;
    pushHistory(
        room,
        correct ? '🕶️' : '🎉',
        correct
            ? `สายลับ ${spyDisplayName} หยุดเวลา ทายถูกว่าเป็น ${guessed.name} — สายลับชนะ!`
            : `สายลับ ${spyDisplayName} ทาย ${guessed.name} ผิด (ที่จริงคือ ${room.gameState.locationName}) — พลเมืองชนะ!`,
        correct ? 'red' : 'green'
    );
    finishRound(room, {
        team: correct ? 'spy' : 'citizens',
        reason: correct ? 'spy_guess_right' : 'spy_guess_wrong',
        spyGuess,
        accusedName: '— (สายลับทายสถานที่)'
    });
    return { resolved: true, correct, phase: room.gameState.phase };
}

function endDiscussionEarly(room) {
    if (!room?.gameState) {
        throw new Error('ไม่พบเกมนี้');
    }
    if (room.gameState.phase !== 'discussion') {
        throw new Error('จบช่วงคุยได้เฉพาะตอนถาม–ตอบ');
    }
    endDiscussion(room, 'host');
    room.gameState.lastAction = Date.now();
    return { advanced: true, phase: room.gameState.phase };
}

function advancePhase(room) {
    const state = room.gameState;
    const phase = state.phase;
    if (phase === 'reveal') {
        moveToDiscussionPhase(room);
        return { advanced: true, phase: state.phase };
    }
    if (phase === 'discussion') {
        endDiscussion(room, 'timeout');
        return { advanced: true, phase: room.gameState.phase };
    }
    if (phase === 'accuse') {
        checkAccusation(room, { timeout: true });
        return { advanced: true, phase: room.gameState.phase, finished: room.gameState.phase === 'finished' };
    }
    if (phase === 'final') {
        if (state.accusation) {
            checkAccusation(room, { timeout: true });
        } else {
            const turnPlayer = getPlayer(room, state.finalRound?.order?.[state.finalRound.index]);
            if (turnPlayer) {
                pushHistory(room, '⏭️', `${turnPlayer.name} ไม่ได้เลือกใคร — ข้ามไปคนต่อไป`, 'neutral');
            }
            advanceFinalRound(room);
        }
        return { advanced: true, phase: room.gameState.phase, finished: room.gameState.phase === 'finished' };
    }
    if (phase === 'vote') {
        resolveVotes(room);
        return { advanced: true, phase: room.gameState.phase, finished: true };
    }
    return { advanced: false, phase };
}

function autoResolvePhase(room) {
    if (!room?.gameState || room.gameState.phase === 'finished' || room.gameState.winner) {
        return { resolved: true, autoResolved: true, phase: room?.gameState?.phase || 'finished' };
    }

    if (room.gameState.phase === 'vote' && everyoneVoted(room)) {
        resolveVotes(room);
        return { resolved: true, phase: room.gameState.phase, autoResolved: false };
    }

    // คนที่ยังไม่โหวตคำกล่าวหาหลุดไป → ที่เหลือเห็นด้วยครบ = ตัดสินเลย
    if (room.gameState.accusation) {
        const check = checkAccusation(room);
        if (check.resolved) {
            return { resolved: true, phase: room.gameState.phase, autoResolved: false };
        }
    }

    // ตาไล่กล่าวหาเป็นของคนที่หลุด → ข้าม
    const final = room.gameState.finalRound;
    if (room.gameState.phase === 'final' && !room.gameState.accusation && final
        && !isFinalTurnPlayable(room, final.order[final.index])) {
        advanceFinalRound(room);
        return { resolved: true, phase: room.gameState.phase, autoResolved: true };
    }

    const now = Date.now();
    if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= now) {
        advancePhase(room);
        return { resolved: true, phase: room.gameState.phase, autoResolved: true };
    }

    return { resolved: false, autoResolved: true, phase: room.gameState.phase };
}

function submitVote(room, playerId, targetPlayerId) {
    if (!room || room.settings.gameMode !== 'spyfall') {
        throw new Error('ไม่พบเกมนี้');
    }

    if (room.gameState.phase !== 'vote') {
        throw new Error('ตอนนี้ยังไม่ถึงช่วงโหวต');
    }

    const voter = getPlayer(room, playerId);
    if (!voter) {
        throw new Error('ไม่พบผู้เล่น');
    }

    if (room.gameState.votes[playerId]) {
        throw new Error('คุณโหวตไปแล้ว');
    }

    const target = getPlayer(room, targetPlayerId);
    if (!target) {
        throw new Error('เลือกผู้เล่นไม่ถูกต้อง');
    }

    if (targetPlayerId === playerId) {
        throw new Error('ห้ามโหวตตัวเอง');
    }

    room.gameState.votes[playerId] = targetPlayerId;
    voter.hasVoted = true;
    voter.voteTargetId = targetPlayerId;
    room.gameState.lastAction = Date.now();

    if (everyoneVoted(room)) {
        resolveVotes(room);
        return { resolved: true, phase: room.gameState.phase };
    }

    return { resolved: false, phase: room.gameState.phase };
}

function buildMatchView(room) {
    const match = room.gameState.match;
    if (!match) return null;
    const present = new Set(getActivePlayers(room).map(player => player.playerId));
    const scoreboard = Object.keys(match.scores)
        .map(playerId => ({
            playerId,
            name: match.names[playerId] || 'ผู้เล่น',
            score: match.scores[playerId] || 0,
            present: present.has(playerId)
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const dealer = getPlayer(room, match.dealerId);
    return {
        round: match.round,
        totalRounds: match.totalRounds,
        dealerId: match.dealerId,
        dealerName: dealer?.name || match.names[match.dealerId] || null,
        over: !!match.over,
        endedEarly: !!match.endedEarly,
        winnerIds: [...(match.winnerIds || [])],
        scoreboard,
        rounds: match.rounds.map(entry => ({ ...entry, points: { ...entry.points } }))
    };
}

function buildClientState(room, playerId) {
    const self = getPlayer(room, playerId);
    if (!self) {
        return null;
    }
    const state = room.gameState;
    const askerPlayer = state.phase === 'discussion' && state.askerId ? getPlayer(room, state.askerId) : null;
    const lastAskerPlayer = state.phase === 'discussion' && state.lastAskerId ? getPlayer(room, state.lastAskerId) : null;

    const isSpy = self.role === ROLE_SPY;
    const isFinished = state.phase === 'finished';
    const showLocation = !isSpy || isFinished;
    const unanimous = isUnanimousMode(room);
    const accusation = state.accusation;
    const final = state.finalRound;
    const finalTurnId = state.phase === 'final' && final && !final.done ? final.order[final.index] : null;
    const finalTurnPlayer = finalTurnId ? getPlayer(room, finalTurnId) : null;

    let accusationView = null;
    if (accusation) {
        const voters = getAccusationVoters(room);
        accusationView = {
            kind: accusation.kind,
            accuserId: accusation.accuserId,
            accuserName: accusation.accuserName,
            suspectId: accusation.suspectId,
            suspectName: accusation.suspectName,
            isSuspect: accusation.suspectId === self.playerId,
            canVote: accusation.suspectId !== self.playerId && accusation.votes[self.playerId] === undefined,
            myVote: accusation.votes[self.playerId] === undefined ? null : accusation.votes[self.playerId],
            yes: voters.filter(player => accusation.votes[player.playerId] === true).length,
            needed: voters.filter(player => isPlayerOnline(room, player.playerId) || accusation.votes[player.playerId] !== undefined).length,
            waitingNames: voters
                .filter(player => accusation.votes[player.playerId] === undefined && isPlayerOnline(room, player.playerId))
                .map(player => player.name)
        };
    }

    return {
        roomId: room.roomId,
        roundId: state.roundStartedAt || null,
        mode: 'spyfall',
        voteMode: unanimous ? VOTE_MODE_UNANIMOUS : VOTE_MODE_MAJORITY,
        status: state.status,
        phase: state.phase,
        phaseEndsAt: state.phaseEndsAt || null,
        pausedRemainingMs: state.phase === 'accuse' ? (state.pausedRemainingMs || 0) : null,
        winner: state.winner,
        match: buildMatchView(room),
        location: showLocation ? {
            id: state.locationId,
            icon: state.locationIcon,
            image: state.locationImage,
            name: state.locationName,
            hint: state.locationHint
        } : null,
        locationPool: isSpy && !isFinished
            ? getAllLocations().map(location => ({
                id: location.id,
                icon: location.icon,
                image: location.image || (location.id ? SPYFALL_IMAGE(location.id) : null),
                name: location.name
            }))
            : null,
        canGuessLocation: isSpy && !state.spyGuess && state.phase === 'discussion',
        canAccuse: unanimous && state.phase === 'discussion' && !(state.stopUsed || {})[self.playerId],
        accuseUsed: !!(state.stopUsed || {})[self.playerId],
        accusation: accusationView,
        finalTurn: state.phase === 'final' && final ? {
            accuserId: finalTurnId,
            accuserName: finalTurnPlayer?.name || null,
            isMyTurn: !!finalTurnId && finalTurnId === self.playerId && !accusation,
            position: Math.min(final.index + 1, final.order.length),
            total: final.order.length
        } : null,
        self: {
            playerId: self.playerId,
            name: self.name,
            color: self.color,
            avatar: self.avatar,
            avatarFrame: self.avatarFrame || 'none',
            role: self.role,
            roleInfo: self.roleInfo,
            isSpy,
            isDealer: state.match?.dealerId === self.playerId,
            locationRoleTitle: !isSpy ? (self.locationRoleTitle || null) : null,
            hasVoted: self.hasVoted,
            voteTargetId: self.voteTargetId
        },
        players: state.players.map(player => ({
            playerId: player.playerId,
            name: player.name,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame || 'none',
            color: player.color,
            isSelf: player.playerId === self.playerId,
            isDealer: state.match?.dealerId === player.playerId,
            hasVoted: state.phase === 'vote' ? !!state.votes[player.playerId] : false,
            voteCount: state.voteCounts?.[player.playerId] || 0,
            accuseUsed: !!(state.stopUsed || {})[player.playerId],
            roleTitle: isFinished
                ? (player.role === ROLE_SPY
                    ? ROLE_DEFINITIONS[ROLE_SPY].title
                    : (player.locationRoleTitle || ROLE_DEFINITIONS[ROLE_CITIZEN].title))
                : null,
            roleIcon: isFinished
                ? (player.role === ROLE_SPY ? ROLE_DEFINITIONS[ROLE_SPY].icon : '🎭')
                : null,
            isSpy: isFinished ? player.role === ROLE_SPY : null
        })),
        votes: state.phase === 'vote' && self.hasVoted
            ? { [self.playerId]: self.voteTargetId }
            : {},
        voteProgress: {
            submitted: Object.keys(state.votes || {}).length,
            total: getActivePlayers(room).filter(player => isPlayerOnline(room, player.playerId)).length
        },
        accusedPlayerId: isFinished ? state.accusedPlayerId : null,
        turn: state.phase === 'discussion' ? {
            askerId: askerPlayer ? askerPlayer.playerId : null,
            askerName: askerPlayer ? askerPlayer.name : null,
            lastAskerId: lastAskerPlayer ? lastAskerPlayer.playerId : null,
            lastAskerName: lastAskerPlayer ? lastAskerPlayer.name : null,
            questionCount: state.questionCount || 0,
            timesAsked: { ...(state.timesAsked || {}) },
            isMyTurn: !!askerPlayer && askerPlayer.playerId === self.playerId
        } : null,
        readyVote: state.phase === 'discussion' ? {
            count: getReadyCount(room),
            needed: getReadyNeeded(room),
            self: !!(state.readyToVote || {})[self.playerId]
        } : null,
        returnLobbyAt: isFinished ? (state.returnLobbyAt || null) : null,
        nextRoundAt: isFinished ? (state.nextRoundAt || null) : null,
        history: state.history || [],
        phaseTips: {
            reveal: 'จำสถานที่และบทของคุณ — อีกไม่กี่วิจะเริ่มคุย',
            discussion: 'ถาม–ตอบทีละคน — คนที่ถูกถามจะได้ถามคนต่อไป',
            accuse: 'หยุดเวลาแล้ว — โหวตว่าเห็นด้วยไหม (ต้องเห็นด้วยทุกคน)',
            final: 'หมดเวลา — ไล่กล่าวหาทีละคน เริ่มจากเจ้ามือ',
            vote: 'โหวตเลือก 1 คนที่คิดว่าเป็นสายลับ (ไม่ใช่เลือกสถานที่)',
            finished: 'จบรอบแล้ว — ดูเฉลยด้านล่าง'
        }
    };
}

module.exports = {
    id: 'spyfall',
    label: 'Spyfall',
    description: 'สายลับในสถานที่ — พลเมืองรู้ที่และบทในที่นั้น สายลับไม่รู้ ถามตอบแล้วกล่าวหาจับ',
    minPlayers: MIN_PLAYERS,
    maxPlayers: 8,
    ROLE_SPY,
    ROLE_CITIZEN,
    ROLE_DEFINITIONS,
    LOCATIONS,
    REVEAL_PHASE_MS,
    VOTE_PHASE_MS,
    ROUND_OPTIONS,
    DEFAULT_ROUNDS,
    VOTE_MODE_UNANIMOUS,
    VOTE_MODE_MAJORITY,
    sanitizeRounds,
    sanitizeVoteMode,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    startNextRound,
    endMatchEarly,
    isMatchOver,
    advancePhase,
    endDiscussionEarly,
    passQuestion,
    toggleReadyToVote,
    checkReadyToVote,
    ensureAskerPresent,
    stopClockAccuse,
    finalAccuse,
    voteAccusation,
    everyoneVoted,
    autoResolvePhase,
    submitVote,
    resolveVotes,
    handlePlayerLeft,
    guessLocation,
    getScoringPlayers,
    buildClientState,
    getDiscussionMs,
    getVoteMs,
    getAccuseVoteMs,
    getPhaseDurationMs,
    getAllLocations,
    getLocationRolePool
};
