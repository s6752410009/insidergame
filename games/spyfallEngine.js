const ROLE_SPY = 'spy';
const ROLE_CITIZEN = 'citizen';

const REVEAL_PHASE_MS = 5000;
const VOTE_PHASE_MS = 90 * 1000;

const ROLE_DEFINITIONS = {
    [ROLE_CITIZEN]: {
        id: ROLE_CITIZEN,
        icon: '🕵️',
        title: 'พลเมือง',
        summary: 'คุณรู้ว่าอยู่ที่ไหน — ถาม–ตอบให้จับสายลับโดยไม่เปิดเผยสถานที่'
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
    // room.settings.roundTime is stored in seconds (same as Insider lobby)
    const seconds = Number(room?.settings?.roundTime || 300);
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 300;
    return safeSeconds * 1000;
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

function assignRoles(room, spyPlayerId) {
    room.gameState.players.forEach(player => {
        if (player.playerId === spyPlayerId) {
            player.role = ROLE_SPY;
            player.roleInfo = ROLE_DEFINITIONS[ROLE_SPY];
        } else {
            player.role = ROLE_CITIZEN;
            player.roleInfo = ROLE_DEFINITIONS[ROLE_CITIZEN];
        }
        player.hasVoted = false;
        player.voteTargetId = null;
    });
}

function startGame(room) {
    const lobbyPlayers = (room.players || []).filter(player => player.playerId);
    if (lobbyPlayers.length < 4) {
        throw new Error('ต้องมีผู้เล่นอย่างน้อย 4 คน');
    }

    room.gameState = resetRoomGame(room);
    const activePlayers = getActivePlayers(room);
    const location = pickRandom(LOCATIONS);
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

    assignRoles(room, spyPlayer.playerId);
    moveToRevealPhase(room);
    return room.gameState;
}

function moveToRevealPhase(room) {
    room.gameState.phase = 'reveal';
    room.gameState.status = 'spyfall_reveal';
    setPhaseDeadline(room, REVEAL_PHASE_MS);
    pushHistory(room, '🎭', 'แจกบทแล้ว — จำสถานที่หรือเล่นให้เนียน', 'gold');
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
    setPhaseDeadline(room, VOTE_PHASE_MS);
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
            ? LOCATIONS.map(location => ({ id: location.id, icon: location.icon, name: location.name }))
            : null,
        self: {
            playerId: self.playerId,
            name: self.name,
            color: self.color,
            avatar: self.avatar,
            role: self.role,
            roleInfo: self.roleInfo,
            isSpy,
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
                ? (player.role === ROLE_SPY ? ROLE_DEFINITIONS[ROLE_SPY].title : ROLE_DEFINITIONS[ROLE_CITIZEN].title)
                : null,
            roleIcon: isFinished
                ? (player.role === ROLE_SPY ? ROLE_DEFINITIONS[ROLE_SPY].icon : ROLE_DEFINITIONS[ROLE_CITIZEN].icon)
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
            reveal: 'จำบทและสถานที่ — อีกไม่กี่วิจะเริ่มคุย',
            discussion: 'ถามคำถามที่ตอบได้หลายทาง — อย่าเปิดเผยสถานที่ตรงๆ',
            vote: 'โหวตเลือก 1 คนที่คิดว่าเป็นสายลับ (ไม่ใช่เลือกสถานที่)',
            finished: 'เกมจบแล้ว — กำลังกลับห้องรอ'
        }
    };
}

module.exports = {
    id: 'spyfall',
    label: 'Spyfall',
    description: 'สายลับในสถานที่ — ทุกคนรู้ที่ยกเว้นสายลับ คุยแล้วโหวตจับ',
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
    getDiscussionMs
};
