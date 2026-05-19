const ROLE_SPY = 'spy';
const ROLE_CITIZEN = 'citizen';

const REVEAL_PHASE_MS = 5000;
const VOTE_PHASE_MS = 90 * 1000;

const ROLE_DEFINITIONS = {
    [ROLE_CITIZEN]: {
        id: ROLE_CITIZEN,
        icon: '🕵️',
        title: 'พลเมือง',
        summary: 'คุณรู้สถานที่และบทในที่นั้น — ถาม–ตอบให้จับสายลับโดยไม่เปิดเผยตรงๆ'
    },
    [ROLE_SPY]: {
        id: ROLE_SPY,
        icon: '🕶️',
        title: 'สายลับ',
        summary: 'คุณไม่รู้สถานที่ — ฟังให้ดีแล้วเดาว่าอยู่ที่ไหนก่อนโดนจับ'
    }
};

const LOCATIONS = [
    { id: 'school', icon: '🏫', name: 'โรงเรียน', hint: 'ครู นักเรียน กระดาน ห้องเรียน' },
    { id: 'hospital', icon: '🏥', name: 'โรงพยาบาล', hint: 'หมอ พยาบาล ผู้ป่วย เครื่องมือแพทย์' },
    { id: 'submarine', icon: '🛳️', name: 'เรือดำน้ำ', hint: 'ตู่ หลอดออกซิเจน ลูกเรือ มืด' },
    { id: 'sushi', icon: '🍣', name: 'ร้านซูชิ', hint: 'เชฟ ปลาดิบ โต๊ะบาร์ สายพาน' },
    { id: 'space', icon: '🚀', name: 'สถานีอวกาศ', hint: 'นักบิน แรงโน้มถ่วง ห้องควบคุม ชุดอวกาศ' },
    { id: 'bank', icon: '🏦', name: 'ธนาคาร', hint: 'ตู้เอทีเอ็ม พนักงาน เงินสด ห้องนิรภัย' },
    { id: 'circus', icon: '🎪', name: 'ละครสัตว์', hint: 'ม้า ช้าง โดม ตัวตลก' },
    { id: 'police', icon: '🚓', name: 'สถานีตำรวจ', hint: 'เครื่องแบบ กุญแจมือ คดี ห้องสอบสวน' },
    { id: 'beach', icon: '🏖️', name: 'ชายหาด', hint: 'ทราย คลื่น ร่ม กันแดด' },
    { id: 'casino', icon: '🎰', name: 'คาสิโน', hint: 'ไพ่ ชิป โต๊ะเดิมพัน แสงไฟ' },
    { id: 'theater', icon: '🎭', name: 'โรงละคร', hint: 'เวที ม่าน ตั๋ว ไฟสปอตไลท์' },
    { id: 'airport', icon: '✈️', name: 'สนามบิน', hint: 'เคาน์เตอร์เช็กอิน สายพาน ประกาศเที่ยวบิน' },
    { id: 'library', icon: '📚', name: 'ห้องสมุด', hint: 'หนังสือ ความเงียบ ชั้นวาง บัตรสมาชิก' },
    { id: 'factory', icon: '🏭', name: 'โรงงาน', hint: 'สายพาน หมวกนิรภัย เครื่องจักร กะทำงาน' },
    { id: 'temple', icon: '🛕', name: 'วัด', hint: 'ระฆัง ธูป ศาลา ผู้มาทำบุญ' },
    { id: 'supermarket', icon: '🛒', name: 'ซูเปอร์มาร์เก็ต', hint: 'รถเข็น ชั้นวาง แคชเชียร์ โปรโมชัน' },
    { id: 'zoo', icon: '🦁', name: 'สวนสัตว์', hint: 'กรง ไกด์ สัตว์ป่า ตั๋วเข้าชม' },
    { id: 'wedding', icon: '💒', name: 'งานแต่งงาน', hint: 'เจ้าบ่าว เจ้าสาว ช่อดอกไม้ แขก' }
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

function createInitialState() {
    return {
        mode: 'spyfall',
        status: 'waiting',
        phase: 'lobby',
        locationId: null,
        locationName: null,
        locationIcon: null,
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
        statsRecordedAt: null
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
    const seconds = Number(room?.settings?.roundTime || 300);
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 300;
    return safeSeconds * 1000;
}

function getVoteMs(room) {
    const seconds = Number(room?.settings?.spyfallVoteSeconds || 90);
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 90;
    return safeSeconds * 1000;
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
    room.gameState.history = room.gameState.history.slice(0, 24);
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

function startGame(room) {
    const lobbyPlayers = (room.players || []).filter(player => player.playerId);
    if (lobbyPlayers.length < 4) {
        throw new Error('ต้องมีผู้เล่นอย่างน้อย 4 คน');
    }

    room.gameState = resetRoomGame(room);
    const activePlayers = getActivePlayers(room);
    const location = pickRandom(getAllLocations());
    const spyPlayer = pickRandom(activePlayers);

    room.gameState.locationId = location.id;
    room.gameState.locationName = location.name;
    room.gameState.locationIcon = location.icon;
    room.gameState.locationHint = location.hint;
    room.gameState.spyPlayerId = spyPlayer.playerId;
    room.gameState.votes = {};
    room.gameState.voteCounts = {};
    room.gameState.winner = null;
    room.gameState.statsRecordedAt = null;
    room.gameState.lastAction = Date.now();

    assignRoles(room, spyPlayer.playerId, location);
    moveToRevealPhase(room);
    return room.gameState;
}

function moveToRevealPhase(room) {
    room.gameState.phase = 'reveal';
    room.gameState.status = 'spyfall_reveal';
    setPhaseDeadline(room, REVEAL_PHASE_MS);
    pushHistory(room, '🎭', 'แจกสถานที่และบทในที่นั้นแล้ว — จำให้แม่น หรือเล่นให้เนียน', 'gold');
}

function moveToDiscussionPhase(room) {
    room.gameState.phase = 'discussion';
    room.gameState.status = 'spyfall_discussion';
    room.gameState.votes = {};
    room.gameState.players.forEach(player => {
        player.hasVoted = false;
        player.voteTargetId = null;
    });
    setPhaseDeadline(room, getDiscussionMs(room));
    pushHistory(room, '💬', 'เริ่มถาม–ตอบ — อย่าเปิดเผยสถานที่ตรงๆ', 'teal');
}

function moveToVotePhase(room) {
    room.gameState.phase = 'vote';
    room.gameState.status = 'spyfall_vote';
    room.gameState.votes = {};
    room.gameState.players.forEach(player => {
        player.hasVoted = false;
        player.voteTargetId = null;
    });
    setPhaseDeadline(room, getVoteMs(room));
    pushHistory(room, '🗳️', 'หมดเวลาคุย — โหวตจับสายลับ', 'amber');
}

function everyoneVoted(room) {
    return getActivePlayers(room).every(player => {
        if (!isPlayerOnline(room, player.playerId)) {
            return true;
        }
        return !!room.gameState.votes[player.playerId];
    });
}

function fillMissingVotes(room) {
    const candidates = getActivePlayers(room).map(player => player.playerId);
    getActivePlayers(room).forEach(player => {
        if (!isPlayerOnline(room, player.playerId)) {
            return;
        }
        if (!room.gameState.votes[player.playerId]) {
            const others = candidates.filter(id => id !== player.playerId);
            const randomTarget = others.length ? pickRandom(others) : player.playerId;
            room.gameState.votes[player.playerId] = randomTarget;
            player.hasVoted = true;
            player.voteTargetId = randomTarget;
        }
    });
}

function resolveVotes(room) {
    if (room.gameState.phase === 'finished') {
        return room.gameState;
    }

    fillMissingVotes(room);

    const voteCounts = {};
    getActivePlayers(room).forEach(player => {
        voteCounts[player.playerId] = 0;
    });

    Object.values(room.gameState.votes).forEach(targetId => {
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
    const accusedIsSpy = accusedPlayerId === room.gameState.spyPlayerId;
    const citizensWin = accusedIsSpy && topVotes > 0;

    const winnerTeam = citizensWin ? 'citizens' : 'spy';
    const accusedPlayer = accusedPlayerId ? getPlayer(room, accusedPlayerId) : null;

    room.gameState.phase = 'finished';
    room.gameState.status = 'spyfall_finished';
    room.gameState.phaseEndsAt = null;
    room.gameState.winner = {
        team: winnerTeam,
        teamLabel: citizensWin ? 'พลเมืองชนะ' : 'สายลับรอด',
        spyPlayerId: room.gameState.spyPlayerId,
        spyName: spyPlayer?.name || 'ไม่ทราบ',
        accusedPlayerId,
        accusedName: accusedPlayer?.name || (tiedIds.length > 1 ? 'เสมอ — สายลับรอด' : 'ไม่มีใครโดนโหวตสูงสุด'),
        locationId: room.gameState.locationId,
        locationName: room.gameState.locationName,
        locationIcon: room.gameState.locationIcon,
        voteCounts,
        topVotes,
        wasTie: tiedIds.length > 1
    };

    pushHistory(
        room,
        citizensWin ? '🎉' : '🕶️',
        citizensWin
            ? `จับสายลับ ${spyPlayer?.name || '-'} ได้! สถานที่คือ ${room.gameState.locationName}`
            : `สายลับ ${spyPlayer?.name || '-'} รอด — สถานที่คือ ${room.gameState.locationName}`,
        citizensWin ? 'green' : 'red'
    );

    return room.gameState;
}

function endDiscussionEarly(room) {
    if (!room?.gameState) {
        throw new Error('ไม่พบเกมนี้');
    }
    if (room.gameState.phase !== 'discussion') {
        throw new Error('จบช่วงคุยได้เฉพาะตอนถาม–ตอบ');
    }
    moveToVotePhase(room);
    pushHistory(room, '⏭️', 'หัวหน้าห้องจบช่วงคุย — เริ่มโหวตจับสายลับ', 'amber');
    room.gameState.lastAction = Date.now();
    return { advanced: true, phase: room.gameState.phase };
}

function advancePhase(room) {
    const phase = room.gameState.phase;
    if (phase === 'reveal') {
        moveToDiscussionPhase(room);
        return { advanced: true, phase: room.gameState.phase };
    }
    if (phase === 'discussion') {
        moveToVotePhase(room);
        return { advanced: true, phase: room.gameState.phase };
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

function buildClientState(room, playerId) {
    const self = getPlayer(room, playerId);
    if (!self) {
        return null;
    }

    const isSpy = self.role === ROLE_SPY;
    const isFinished = room.gameState.phase === 'finished';
    const showLocation = !isSpy || isFinished;

    return {
        roomId: room.roomId,
        mode: 'spyfall',
        status: room.gameState.status,
        phase: room.gameState.phase,
        phaseEndsAt: room.gameState.phaseEndsAt || null,
        winner: room.gameState.winner,
        location: showLocation ? {
            id: room.gameState.locationId,
            icon: room.gameState.locationIcon,
            name: room.gameState.locationName,
            hint: room.gameState.locationHint
        } : null,
        locationPool: isSpy && !isFinished
            ? getAllLocations().map(location => ({ id: location.id, icon: location.icon, name: location.name }))
            : null,
        self: {
            playerId: self.playerId,
            name: self.name,
            color: self.color,
            avatar: self.avatar,
            role: self.role,
            roleInfo: self.roleInfo,
            isSpy,
            locationRoleTitle: !isSpy ? (self.locationRoleTitle || null) : null,
            hasVoted: self.hasVoted,
            voteTargetId: self.voteTargetId
        },
        players: room.gameState.players.map(player => ({
            playerId: player.playerId,
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            isSelf: player.playerId === self.playerId,
            hasVoted: room.gameState.phase === 'vote' ? !!room.gameState.votes[player.playerId] : false,
            voteCount: room.gameState.voteCounts?.[player.playerId] || 0,
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
        votes: room.gameState.phase === 'vote' && self.hasVoted
            ? { [self.playerId]: self.voteTargetId }
            : {},
        voteProgress: {
            submitted: Object.keys(room.gameState.votes || {}).length,
            total: getActivePlayers(room).filter(player => isPlayerOnline(room, player.playerId)).length
        },
        accusedPlayerId: isFinished ? room.gameState.accusedPlayerId : null,
        history: room.gameState.history || [],
        phaseTips: {
            reveal: 'จำสถานที่และบทของคุณ — อีกไม่กี่วิจะเริ่มคุย',
            discussion: 'ถาม–ตอบให้จับสายลับ — อย่าเปิดเผยสถานที่หรือบทตัวเองตรงๆ',
            vote: 'โหวตเลือก 1 คนที่คิดว่าเป็นสายลับ (ไม่ใช่เลือกสถานที่)',
            finished: 'เกมจบแล้ว — กำลังกลับห้องรอ'
        }
    };
}

module.exports = {
    id: 'spyfall',
    label: 'Spyfall',
    description: 'สายลับในสถานที่ — พลเมืองรู้ที่และบทในที่นั้น สายลับไม่รู้ คุยแล้วโหวตจับ',
    minPlayers: 4,
    maxPlayers: 8,
    ROLE_SPY,
    ROLE_CITIZEN,
    ROLE_DEFINITIONS,
    LOCATIONS,
    REVEAL_PHASE_MS,
    VOTE_PHASE_MS,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    advancePhase,
    endDiscussionEarly,
    autoResolvePhase,
    submitVote,
    resolveVotes,
    buildClientState,
    getDiscussionMs,
    getVoteMs,
    getAllLocations,
    getLocationRolePool
};
