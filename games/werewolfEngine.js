const ROLE_DEFINITIONS = {
    villager: {
        id: 'villager',
        name: 'Villager',
        thaiName: 'ชาวบ้าน',
        team: 'village',
        description: 'ไม่มีสกิลพิเศษ ใช้การคุยและการโหวตช่วยทีมชาวบ้านชนะ'
    },
    werewolf: {
        id: 'werewolf',
        name: 'Werewolf',
        thaiName: 'หมาป่า',
        team: 'werewolf',
        description: 'ร่วมกับฝั่งหมาป่าเลือกเหยื่อในตอนกลางคืน และชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าคนอื่นทั้งหมด'
    },
    alphaWolf: {
        id: 'alphaWolf',
        name: 'Alpha Wolf',
        thaiName: 'อัลฟ่าหมาป่า',
        team: 'werewolf',
        description: 'หัวหน้าฝั่งหมาป่า โหวตล่าเหยื่อตอนกลางคืนด้วยน้ำหนัก 2 เสียง'
    },
    mayor: {
        id: 'mayor',
        name: 'Mayor',
        thaiName: 'นายก',
        team: 'village',
        description: 'ไม่มีสกิลกลางคืน แต่โหวตกลางวันมีน้ำหนัก 2 เสียง'
    },
    bodyguard: {
        id: 'bodyguard',
        name: 'Bodyguard',
        thaiName: 'บอดี้การ์ด',
        team: 'village',
        description: 'ปกป้องผู้เล่น 1 คนในตอนกลางคืน และห้ามปกป้องคนเดิมสองคืนติดกัน'
    },
    seer: {
        id: 'seer',
        name: 'Seer',
        thaiName: 'Seer',
        team: 'village',
        description: 'ตรวจสอบบทบาทจริงของผู้เล่น 1 คนในตอนกลางคืน'
    },
    doctor: {
        id: 'doctor',
        name: 'Doctor',
        thaiName: 'หมอ',
        team: 'village',
        description: 'ช่วยชีวิตผู้เล่น 1 คนในตอนกลางคืน รวมถึงช่วยตัวเองได้'
    },
    revealer: {
        id: 'revealer',
        name: 'Revealer',
        thaiName: 'จอมเปิดโปง',
        team: 'village',
        description: 'ใช้ได้ครั้งเดียวในตอนกลางวัน ถ้าเปิดโปงหมาป่าถูก หมาป่าตายทันที แต่ถ้าพลาดตัวเองตาย'
    }
};

const ROLE_PLANS = {
    3: ['werewolf', 'seer', 'villager'],
    4: ['werewolf', 'seer', 'doctor', 'villager'],
    5: ['werewolf', 'seer', 'doctor', 'bodyguard', 'villager'],
    6: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor'],
    7: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'revealer'],
    8: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'revealer', 'villager'],
    9: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'revealer', 'villager', 'villager'],
    10: ['alphaWolf', 'werewolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'revealer', 'villager', 'villager']
};

const CONFIGURABLE_ROLE_IDS = ['werewolf', 'alphaWolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'revealer'];
const DEFAULT_ROLE_SELECTION = [...CONFIGURABLE_ROLE_IDS];
const SKIP_TARGET_ID = '__skip__';

function isFirstNight(room) {
    return Number(room?.gameState?.dayNumber) === 1;
}

function shuffle(array) {
    const items = [...array];
    for (let index = items.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
}

function chooseRandom(array) {
    if (!Array.isArray(array) || array.length === 0) {
        return null;
    }

    return array[Math.floor(Math.random() * array.length)];
}

function isWerewolfRole(roleId) {
    return roleId === 'werewolf' || roleId === 'alphaWolf';
}

function sanitizeRoleSelection(roleIds) {
    const input = Array.isArray(roleIds) ? roleIds : DEFAULT_ROLE_SELECTION;
    const seen = new Set();
    const sanitized = [];

    CONFIGURABLE_ROLE_IDS.forEach(roleId => {
        if (input.includes(roleId) && !seen.has(roleId)) {
            sanitized.push(roleId);
            seen.add(roleId);
        }
    });

    if (!sanitized.some(isWerewolfRole)) {
        sanitized.unshift('werewolf');
    }

    if (!sanitized.includes('werewolf')) {
        sanitized.unshift('werewolf');
    }

    return sanitized;
}

function getConfiguredRoleIds(settings = {}) {
    return sanitizeRoleSelection(settings.werewolfRoles);
}

function getConfigurableRoles() {
    return CONFIGURABLE_ROLE_IDS.map(roleId => ({
        id: roleId,
        name: ROLE_DEFINITIONS[roleId].name,
        thaiName: ROLE_DEFINITIONS[roleId].thaiName,
        team: ROLE_DEFINITIONS[roleId].team,
        description: ROLE_DEFINITIONS[roleId].description,
        defaultEnabled: DEFAULT_ROLE_SELECTION.includes(roleId)
    }));
}

function getRolePlan(playerCount, settings = {}) {
    const normalizedCount = Math.max(3, Math.min(10, Number(playerCount) || 3));
    const basePlan = ROLE_PLANS[normalizedCount] || ROLE_PLANS[3];
    const enabledRoleIds = getConfiguredRoleIds(settings);
    const plannedRoleIds = [];
    const wolfSlotCount = basePlan.filter(isWerewolfRole).length;

    if (wolfSlotCount > 1 && enabledRoleIds.includes('alphaWolf')) {
        plannedRoleIds.push('alphaWolf');
    } else {
        plannedRoleIds.push('werewolf');
    }

    while (plannedRoleIds.filter(isWerewolfRole).length < wolfSlotCount) {
        plannedRoleIds.push('werewolf');
    }

    const baseSpecialIds = basePlan.filter(roleId => roleId !== 'villager' && !isWerewolfRole(roleId));
    const specialIds = [];

    baseSpecialIds.forEach(roleId => {
        if (enabledRoleIds.includes(roleId) && !specialIds.includes(roleId)) {
            specialIds.push(roleId);
        }
    });

    CONFIGURABLE_ROLE_IDS.forEach(roleId => {
        if (isWerewolfRole(roleId)) {
            return;
        }

        if (enabledRoleIds.includes(roleId) && !specialIds.includes(roleId)) {
            specialIds.push(roleId);
        }
    });

    const slotsRemaining = normalizedCount - plannedRoleIds.length;
    plannedRoleIds.push(...specialIds.slice(0, slotsRemaining));

    while (plannedRoleIds.length < normalizedCount) {
        plannedRoleIds.push('villager');
    }

    return plannedRoleIds.map(roleId => ROLE_DEFINITIONS[roleId]);
}

function createInitialState() {
    return {
        mode: 'werewolf',
        players: [],
        status: '',
        phase: 'lobby',
        phaseEndsAt: null,
        dayNumber: 0,
        alivePlayerIds: [],
        lastAction: 0,
        rolePlan: [],
        winner: null,
        history: [],
        nightActions: {
            werewolfVotes: {},
            seerChecks: {},
            doctorSaves: {},
            bodyguardProtects: {}
        },
        dayVotes: {},
        dayActionUsedBy: {},
        lastProtectedByBodyguard: {},
        lastResolvedNight: null,
        lastResolvedDay: null
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
        roleInfo: null,
        alive: true,
        revealedRole: null,
        permission: context.isAdmin ? 'admin' : null,
        lastNightResult: null,
        lastSeenRole: null,
        seerHistory: [],
        revealerUsed: false
    };
}

function getPlayer(room, playerId) {
    return room.gameState.players.find(player => player.playerId === playerId) || null;
}

function getAlivePlayers(room) {
    return room.gameState.players.filter(player => player.alive !== false);
}

function getAliveWerewolves(room) {
    return getAlivePlayers(room).filter(player => isWerewolfRole(player.role));
}

function getAliveNonWerewolves(room) {
    return getAlivePlayers(room).filter(player => !isWerewolfRole(player.role));
}

function syncAlivePlayerIds(room) {
    room.gameState.alivePlayerIds = getAlivePlayers(room).map(player => player.playerId);
}

function pushHistory(room, message, type = 'system') {
    room.gameState.history.unshift({
        type,
        message,
        at: new Date().toISOString()
    });
    room.gameState.history = room.gameState.history.slice(0, 50);
}

function markPlayerDead(player, reason) {
    player.alive = false;
    player.revealedRole = player.roleInfo?.thaiName || player.role;
    player.lastNightResult = reason || null;
}

function clearPlayerTransientState(room) {
    room.gameState.players.forEach(player => {
        player.lastNightResult = null;
    });
}

function resetNightActions(room) {
    room.gameState.nightActions = {
        werewolfVotes: {},
        seerChecks: {},
        doctorSaves: {},
        bodyguardProtects: {}
    };
}

function resetDayState(room) {
    room.gameState.dayVotes = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.lastResolvedDay = null;
}

function startNightPhase(room, incrementDay = true) {
    clearPlayerTransientState(room);
    resetNightActions(room);
    resetDayState(room);
    room.gameState.phase = 'night';
    room.gameState.phaseEndsAt = null;
    room.gameState.status = 'werewolf_night';
    if (incrementDay) {
        room.gameState.dayNumber += 1;
    }
    room.gameState.lastAction = Date.now();
    syncAlivePlayerIds(room);
    pushHistory(room, `คืนที่ ${room.gameState.dayNumber} เริ่มแล้ว`, 'night');
}

function startDayPhase(room) {
    room.gameState.phase = 'day-vote';
    room.gameState.phaseEndsAt = null;
    room.gameState.status = 'werewolf_day_vote';
    room.gameState.dayVotes = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.lastResolvedDay = null;
    room.gameState.lastAction = Date.now();
    syncAlivePlayerIds(room);
    pushHistory(room, `กลางวันของวันที่ ${room.gameState.dayNumber} เริ่มขึ้นแล้ว ทุกคนเตรียมโหวต`, 'day');
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
        })),
        alivePlayerIds: room.players.map(player => player.playerId),
        rolePlan: getRolePlan(room.players.length, room.settings)
    };
}

function assignRoles(room) {
    const roleIds = room.gameState.rolePlan.map(role => role.id);
    const players = room.gameState.players;

    // Collect previous roles (from last round) to avoid repeats
    const previousRoles = {};
    players.forEach(p => {
        if (p.role) previousRoles[p.playerId] = p.role;
    });

    // Try up to 20 shuffles to find one where no player repeats their previous role
    let bestShuffle = shuffle(roleIds);
    let bestRepeatCount = players.length; // worst case

    for (let attempt = 0; attempt < 20; attempt++) {
        const candidate = shuffle(roleIds);
        let repeats = 0;
        for (let i = 0; i < players.length; i++) {
            if (previousRoles[players[i].playerId] === candidate[i]) {
                repeats++;
            }
        }
        if (repeats < bestRepeatCount) {
            bestRepeatCount = repeats;
            bestShuffle = candidate;
        }
        if (repeats === 0) break;
    }

    room.gameState.players = players.map((playerState, index) => {
        const roleId = bestShuffle[index];
        const roleInfo = ROLE_DEFINITIONS[roleId];
        return {
            ...playerState,
            role: roleId,
            roleInfo,
            alive: true,
            revealedRole: null,
            lastNightResult: null,
            lastSeenRole: null,
            seerHistory: [],
            revealerUsed: false
        };
    });
}

function startGame(room) {
    // Save previous roles before reset so assignRoles can avoid repeats
    const previousRoles = {};
    if (room.gameState && room.gameState.players) {
        room.gameState.players.forEach(p => {
            if (p.role) previousRoles[p.playerId] = p.role;
        });
    }

    room.gameState = resetRoomGame(room);

    // Restore previous roles onto fresh player states
    room.gameState.players.forEach(p => {
        if (previousRoles[p.playerId]) {
            p.role = previousRoles[p.playerId];
        }
    });

    assignRoles(room);
    room.gameState.dayNumber = 0;
    room.gameState.winner = null;
    room.gameState.history = [];
    room.gameState.phaseEndsAt = null;
    pushHistory(room, `เริ่มเกม Werewolf ด้วยผู้เล่น ${room.players.length} คน`, 'system');
    startNightPhase(room);
    return room.gameState;
}

function checkWinCondition(room) {
    const aliveWerewolves = getAliveWerewolves(room);
    const aliveNonWerewolves = getAliveNonWerewolves(room);

    if (aliveWerewolves.length === 0) {
        room.gameState.phase = 'finished';
        room.gameState.phaseEndsAt = null;
        room.gameState.status = 'werewolf_finished';
        room.gameState.winner = 'village';
        room.gameState.players.forEach(player => {
            player.revealedRole = player.roleInfo?.thaiName || player.role;
        });
        pushHistory(room, 'ชาวบ้านชนะแล้ว หมาป่าถูกกำจัดหมด', 'result');
        return 'village';
    }

    if (aliveWerewolves.length >= aliveNonWerewolves.length) {
        room.gameState.phase = 'finished';
        room.gameState.phaseEndsAt = null;
        room.gameState.status = 'werewolf_finished';
        room.gameState.winner = 'werewolf';
        room.gameState.players.forEach(player => {
            player.revealedRole = player.roleInfo?.thaiName || player.role;
        });
        pushHistory(room, 'หมาป่าชนะแล้ว จำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่เหลือ', 'result');
        return 'werewolf';
    }

    return null;
}

function getRequiredNightActors(room) {
    const roleIds = isFirstNight(room)
        ? ['seer', 'doctor', 'bodyguard']
        : ['werewolf', 'alphaWolf', 'seer', 'doctor', 'bodyguard'];

    return getAlivePlayers(room).filter(player => roleIds.includes(player.role));
}

function hasNightActionSubmitted(room, player) {
    switch (player.role) {
        case 'werewolf':
        case 'alphaWolf':
            return !!room.gameState.nightActions.werewolfVotes[player.playerId];
        case 'seer':
            return !!room.gameState.nightActions.seerChecks[player.playerId];
        case 'doctor':
            return !!room.gameState.nightActions.doctorSaves[player.playerId];
        case 'bodyguard':
            return !!room.gameState.nightActions.bodyguardProtects[player.playerId];
        default:
            return true;
    }
}

function canResolveNight(room) {
    return getRequiredNightActors(room).every(player => hasNightActionSubmitted(room, player));
}

function getWeightedTarget(votes, room, weightedRoles = {}) {
    const scoreboard = new Map();

    Object.entries(votes).forEach(([actorId, targetId]) => {
        const actor = getPlayer(room, actorId);
        const target = getPlayer(room, targetId);
        if (!actor || !target || actor.alive === false || target.alive === false) {
            return;
        }

        const weight = weightedRoles[actor.role] || 1;
        scoreboard.set(targetId, (scoreboard.get(targetId) || 0) + weight);
    });

    const ranked = Array.from(scoreboard.entries()).sort((left, right) => right[1] - left[1]);
    if (ranked.length === 0) {
        return null;
    }

    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
        return null;
    }

    return ranked[0][0];
}

function resolveNight(room) {
    const attackedPlayerId = getWeightedTarget(
        Object.fromEntries(Object.entries(room.gameState.nightActions.werewolfVotes).filter(([, targetId]) => targetId && targetId !== SKIP_TARGET_ID)),
        room,
        { alphaWolf: 2 }
    );
    const protectedTargets = new Set([
        ...Object.values(room.gameState.nightActions.doctorSaves),
        ...Object.values(room.gameState.nightActions.bodyguardProtects)
    ].filter(targetId => targetId && targetId !== SKIP_TARGET_ID));

    const attackedPlayer = attackedPlayerId ? getPlayer(room, attackedPlayerId) : null;
    let eliminatedPlayer = null;

    if (isFirstNight(room)) {
        pushHistory(room, 'คืนแรกผ่านไปแบบเงียบผิดปกติ หมาป่ายังออกล่าไม่ได้ คืนนี้จึงไม่มีใครตาย', 'night');
    } else if (attackedPlayer && attackedPlayer.alive !== false && !protectedTargets.has(attackedPlayerId)) {
        markPlayerDead(attackedPlayer, 'ถูกหมาป่าโจมตีในตอนกลางคืน');
        eliminatedPlayer = attackedPlayer;
        pushHistory(room, `${attackedPlayer.name} ถูกกำจัดในตอนกลางคืน และเผยตัวว่าเป็น ${attackedPlayer.revealedRole}`, 'night');
    } else if (attackedPlayer) {
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} ไม่มีใครตาย เพราะมีคนปกป้องสำเร็จ`, 'night');
    } else {
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} หมาป่าลังเลจนไม่มีใครตาย`, 'night');
    }

    Object.entries(room.gameState.nightActions.seerChecks).forEach(([seerId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        const seer = getPlayer(room, seerId);
        const target = getPlayer(room, targetId);
        if (seer && target) {
            const seenRole = `${target.name} คือ ${target.roleInfo?.thaiName || target.role}`;
            const seenEntry = {
                dayNumber: room.gameState.dayNumber || 1,
                targetPlayerId: target.playerId,
                targetName: target.name,
                roleName: target.roleInfo?.thaiName || target.role,
                summary: seenRole
            };
            seer.lastSeenRole = seenRole;
            seer.seerHistory = [seenEntry, ...(Array.isArray(seer.seerHistory) ? seer.seerHistory : [])].slice(0, 8);
        }
    });

    Object.entries(room.gameState.nightActions.bodyguardProtects).forEach(([guardId, protectedId]) => {
        if (protectedId && protectedId !== SKIP_TARGET_ID) {
            room.gameState.lastProtectedByBodyguard[guardId] = protectedId;
        } else {
            delete room.gameState.lastProtectedByBodyguard[guardId];
        }
    });

    room.gameState.lastResolvedNight = {
        attackedPlayerId,
        eliminatedPlayerId: eliminatedPlayer?.playerId || null,
        protectedTargets: Array.from(protectedTargets)
    };

    syncAlivePlayerIds(room);
    if (checkWinCondition(room)) {
        return { resolved: true, winner: room.gameState.winner };
    }

    startDayPhase(room);
    return { resolved: true, winner: null };
}

function getCompletedDayActorIds(room) {
    return new Set([
        ...Object.keys(room.gameState.dayVotes),
        ...Object.keys(room.gameState.dayActionUsedBy).filter(playerId => room.gameState.dayActionUsedBy[playerId])
    ]);
}

function canResolveDay(room) {
    return getCompletedDayActorIds(room).size >= getAlivePlayers(room).length;
}

function resolveDayVote(room) {
    const eliminatedPlayerId = getWeightedTarget(
        Object.fromEntries(Object.entries(room.gameState.dayVotes).filter(([, targetId]) => targetId && targetId !== SKIP_TARGET_ID)),
        room,
        { mayor: 2 }
    );
    const eliminatedPlayer = eliminatedPlayerId ? getPlayer(room, eliminatedPlayerId) : null;

    if (eliminatedPlayer && eliminatedPlayer.alive !== false) {
        markPlayerDead(eliminatedPlayer, 'ถูกโหวตออกในเวลากลางวัน');
        pushHistory(room, `${eliminatedPlayer.name} ถูกโหวตออก และเผยตัวว่าเป็น ${eliminatedPlayer.revealedRole}`, 'day');
    } else {
        pushHistory(room, 'การโหวตวันนี้เสมอกัน ไม่มีใครถูกกำจัด', 'day');
    }

    room.gameState.lastResolvedDay = {
        eliminatedPlayerId: eliminatedPlayer?.playerId || null
    };

    syncAlivePlayerIds(room);
    if (checkWinCondition(room)) {
        return { resolved: true, winner: room.gameState.winner };
    }

    startNightPhase(room);
    return { resolved: true, winner: null };
}

function submitNightAction(room, actorId, targetPlayerId) {
    if (room.gameState.phase !== 'night') {
        throw new Error('ยังไม่ใช่ช่วงกลางคืน');
    }

    const actor = getPlayer(room, actorId);
    const isSkip = targetPlayerId === SKIP_TARGET_ID;
    const target = isSkip ? null : getPlayer(room, targetPlayerId);

    if (!actor || actor.alive === false) {
        throw new Error('ผู้เล่นนี้ไม่สามารถใช้สกิลได้');
    }

    if (!isSkip && (!target || target.alive === false)) {
        throw new Error('เป้าหมายไม่ถูกต้อง');
    }

    switch (actor.role) {
        case 'werewolf':
        case 'alphaWolf':
            if (isFirstNight(room)) {
                throw new Error('คืนแรกหมาป่ายังออกล่าไม่ได้');
            }
            if (isSkip) {
                room.gameState.nightActions.werewolfVotes[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (isWerewolfRole(target.role)) {
                throw new Error('หมาป่าเลือกโจมตีหมาป่าด้วยกันเองไม่ได้');
            }
            room.gameState.nightActions.werewolfVotes[actorId] = targetPlayerId;
            break;
        case 'seer':
            if (isSkip) {
                room.gameState.nightActions.seerChecks[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('Seer ตรวจตัวเองไม่ได้');
            }
            room.gameState.nightActions.seerChecks[actorId] = targetPlayerId;
            break;
        case 'doctor':
            if (isSkip) {
                room.gameState.nightActions.doctorSaves[actorId] = SKIP_TARGET_ID;
                break;
            }
            room.gameState.nightActions.doctorSaves[actorId] = targetPlayerId;
            break;
        case 'bodyguard': {
            if (isSkip) {
                room.gameState.nightActions.bodyguardProtects[actorId] = SKIP_TARGET_ID;
                break;
            }
            const previousTarget = room.gameState.lastProtectedByBodyguard[actorId];
            if (previousTarget && previousTarget === targetPlayerId) {
                throw new Error('บอดี้การ์ดห้ามปกป้องคนเดิมสองคืนติดกัน');
            }
            room.gameState.nightActions.bodyguardProtects[actorId] = targetPlayerId;
            break;
        }
        default:
            throw new Error('บทบาทนี้ไม่มีสกิลกลางคืน');
    }

    room.gameState.lastAction = Date.now();

    if (canResolveNight(room)) {
        return resolveNight(room);
    }

    return { resolved: false };
}

function submitDayVote(room, actorId, targetPlayerId) {
    if (room.gameState.phase !== 'day-vote') {
        throw new Error('ยังไม่ใช่ช่วงโหวตกลางวัน');
    }

    const actor = getPlayer(room, actorId);
    const isSkip = targetPlayerId === SKIP_TARGET_ID;
    const target = isSkip ? null : getPlayer(room, targetPlayerId);

    if (!actor || actor.alive === false) {
        throw new Error('ผู้เล่นนี้ไม่สามารถโหวตได้');
    }

    if (!isSkip && (!target || target.alive === false || actorId === targetPlayerId)) {
        throw new Error('เป้าหมายการโหวตไม่ถูกต้อง');
    }

    if (room.gameState.dayActionUsedBy[actorId]) {
        throw new Error('คุณใช้สกิลตอนกลางวันไปแล้ว จึงโหวตเพิ่มไม่ได้');
    }

    room.gameState.dayVotes[actorId] = targetPlayerId;
    room.gameState.lastAction = Date.now();

    if (canResolveDay(room)) {
        return resolveDayVote(room);
    }

    return { resolved: false };
}

function useRevealAction(room, actorId, targetPlayerId) {
    if (room.gameState.phase !== 'day-vote') {
        throw new Error('สกิลเปิดโปงใช้ได้เฉพาะตอนกลางวัน');
    }

    const actor = getPlayer(room, actorId);
    const target = getPlayer(room, targetPlayerId);

    if (!actor || actor.alive === false || actor.role !== 'revealer') {
        throw new Error('บทบาทนี้ใช้สกิลเปิดโปงไม่ได้');
    }

    if (actor.revealerUsed) {
        throw new Error('คุณใช้สกิลเปิดโปงไปแล้ว');
    }

    if (!target || target.alive === false || actorId === targetPlayerId) {
        throw new Error('เป้าหมายเปิดโปงไม่ถูกต้อง');
    }

    actor.revealerUsed = true;
    room.gameState.dayActionUsedBy[actorId] = true;
    delete room.gameState.dayVotes[actorId];

    if (isWerewolfRole(target.role)) {
        markPlayerDead(target, 'ถูกจอมเปิดโปงจับได้ว่าเป็นหมาป่า');
        pushHistory(room, `${actor.name} เปิดโปง ${target.name} สำเร็จ หมาป่าตายทันที`, 'day');
    } else {
        markPlayerDead(actor, 'เปิดโปงผิดเป้าและตายแทน');
        pushHistory(room, `${actor.name} เปิดโปงผิดเป้าและตายทันที`, 'day');
    }

    syncAlivePlayerIds(room);
    room.gameState.lastAction = Date.now();

    if (checkWinCondition(room)) {
        return { resolved: true, winner: room.gameState.winner };
    }

    if (canResolveDay(room)) {
        return resolveDayVote(room);
    }

    return { resolved: false };
}

function fillMissingNightActions(room) {
    getRequiredNightActors(room).forEach(actor => {
        if (hasNightActionSubmitted(room, actor)) {
            return;
        }

        switch (actor.role) {
            case 'werewolf':
            case 'alphaWolf': {
                if (isFirstNight(room)) {
                    break;
                }
                const targets = getAlivePlayers(room).filter(player => !isWerewolfRole(player.role));
                const target = chooseRandom(targets);
                if (target) {
                    room.gameState.nightActions.werewolfVotes[actor.playerId] = target.playerId;
                }
                break;
            }
            case 'seer': {
                const targets = getAlivePlayers(room).filter(player => player.playerId !== actor.playerId);
                const target = chooseRandom(targets);
                if (target) {
                    room.gameState.nightActions.seerChecks[actor.playerId] = target.playerId;
                }
                break;
            }
            case 'doctor': {
                const target = chooseRandom(getAlivePlayers(room));
                if (target) {
                    room.gameState.nightActions.doctorSaves[actor.playerId] = target.playerId;
                }
                break;
            }
            case 'bodyguard': {
                const previousTarget = room.gameState.lastProtectedByBodyguard[actor.playerId] || null;
                let targets = getAlivePlayers(room).filter(player => player.playerId !== previousTarget);
                if (targets.length === 0) {
                    targets = getAlivePlayers(room);
                }
                const target = chooseRandom(targets);
                if (target) {
                    room.gameState.nightActions.bodyguardProtects[actor.playerId] = target.playerId;
                }
                break;
            }
            default:
                break;
        }
    });
}

function fillMissingDayVotes(room) {
    getAlivePlayers(room).forEach(actor => {
        if (room.gameState.dayActionUsedBy[actor.playerId] || room.gameState.dayVotes[actor.playerId]) {
            return;
        }

        const targets = getAlivePlayers(room).filter(player => player.playerId !== actor.playerId);
        const target = chooseRandom(targets);
        if (target) {
            room.gameState.dayVotes[actor.playerId] = target.playerId;
        }
    });
}

function autoResolvePhase(room) {
    if (room.gameState.winner) {
        return { resolved: true, winner: room.gameState.winner, autoResolved: true };
    }

    if (room.gameState.phase === 'night') {
        fillMissingNightActions(room);
        if (canResolveNight(room)) {
            return { ...resolveNight(room), autoResolved: true };
        }
    }

    if (room.gameState.phase === 'day-vote') {
        fillMissingDayVotes(room);
        if (canResolveDay(room)) {
            return { ...resolveDayVote(room), autoResolved: true };
        }
    }

    return { resolved: false, autoResolved: true };
}

function getNightActionOptions(room, viewer) {
    if (!viewer || viewer.alive === false || room.gameState.phase !== 'night') {
        return [];
    }

    const alivePlayers = getAlivePlayers(room);
    switch (viewer.role) {
        case 'werewolf':
        case 'alphaWolf':
            if (isFirstNight(room)) {
                return [{
                    type: 'night-kill',
                    label: 'คืนแรกของหมาป่า',
                    description: 'คืนนี้หมาป่ายังไม่ออกล่า ใช้เวลาจำหน้า อ่านจังหวะ และเตรียมเรื่องที่จะคุยตอนเช้า',
                    selectedTargetId: null,
                    allowSkip: false,
                    emptyStateText: 'คืนนี้ยังไม่มีเหยื่อให้เลือก คืนแรกจะผ่านไปแบบไม่มีคนตายจากหมาป่า',
                    targets: []
                }];
            }
            return [{
                type: 'night-kill',
                label: viewer.role === 'alphaWolf' ? 'เลือกเหยื่อของอัลฟ่า' : 'เลือกเหยื่อของหมาป่า',
                description: 'เลือกเหยื่อ 1 คนในคืนนี้',
                selectedTargetId: room.gameState.nightActions.werewolfVotes[viewer.playerId] || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => !isWerewolfRole(player.role)).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        case 'seer':
            return [{
                type: 'seer-check',
                label: 'ตรวจสอบบทบาท',
                description: 'ดูบทบาทจริงของผู้เล่น 1 คน',
                selectedTargetId: room.gameState.nightActions.seerChecks[viewer.playerId] || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        case 'doctor':
            return [{
                type: 'doctor-save',
                label: 'ช่วยชีวิต',
                description: 'เลือกคนที่ต้องการช่วยคืนนี้',
                selectedTargetId: room.gameState.nightActions.doctorSaves[viewer.playerId] || null,
                allowSkip: true,
                targets: alivePlayers.map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        case 'bodyguard': {
            const previousTarget = room.gameState.lastProtectedByBodyguard[viewer.playerId] || null;
            let targets = alivePlayers.filter(player => player.playerId !== previousTarget);
            if (targets.length === 0) {
                targets = alivePlayers;
            }

            return [{
                type: 'bodyguard-protect',
                label: 'ปกป้อง',
                description: previousTarget ? 'ห้ามเลือกคนเดิมสองคืนติดกัน' : 'เลือกคนที่ต้องการปกป้องคืนนี้',
                selectedTargetId: room.gameState.nightActions.bodyguardProtects[viewer.playerId] || null,
                allowSkip: true,
                targets: targets.map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        default:
            return [];
    }
}

function getDayActionOptions(room, viewer) {
    if (!viewer || viewer.alive === false || room.gameState.phase !== 'day-vote') {
        return {
            canVote: false,
            selectedVoteTargetId: null,
            voteTargets: [],
            canReveal: false,
            revealUsed: !!viewer?.revealerUsed,
            revealTargets: []
        };
    }

    const targets = getAlivePlayers(room)
        .filter(player => player.playerId !== viewer.playerId)
        .map(player => ({
            playerId: player.playerId,
            name: player.name
        }));

    return {
        canVote: !room.gameState.dayActionUsedBy[viewer.playerId],
        selectedVoteTargetId: room.gameState.dayVotes[viewer.playerId] || null,
        allowSkipVote: true,
        voteTargets: targets,
        canReveal: viewer.role === 'revealer' && !viewer.revealerUsed,
        revealUsed: !!viewer.revealerUsed,
        revealTargets: viewer.role === 'revealer' && !viewer.revealerUsed ? targets : []
    };
}

function buildMorningAnnouncement(room) {
    const summary = room?.gameState?.lastResolvedNight;
    if (!summary) {
        return null;
    }

    const dayNumber = room.gameState.dayNumber || 1;
    const eliminatedPlayer = summary.eliminatedPlayerId ? getPlayer(room, summary.eliminatedPlayerId) : null;
    const attackedPlayer = summary.attackedPlayerId ? getPlayer(room, summary.attackedPlayerId) : null;

    if (dayNumber === 1 && !eliminatedPlayer) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'peaceful-first-night',
            lead: 'หมู่บ้านตื่นขึ้นมาพร้อมความเงียบผิดปกติ',
            detail: 'คืนแรกผ่านไปโดยไม่มีใครตาย และหมาป่ายังไม่ได้ออกล่า'
        };
    }

    if (eliminatedPlayer) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'death',
            lead: `เมื่อคืน ${eliminatedPlayer.name} ไม่รอด`,
            detail: `${eliminatedPlayer.name} เผยตัวว่าเป็น ${eliminatedPlayer.revealedRole || eliminatedPlayer.roleInfo?.thaiName || eliminatedPlayer.role}`
        };
    }

    if (attackedPlayer) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'saved',
            lead: 'เมื่อคืนมีเสียงเคลื่อนไหว แต่ไม่มีใครตาย',
            detail: `${attackedPlayer.name} รอดมาได้ และหมู่บ้านยังต้องสืบต่อว่าเกิดอะไรขึ้น`
        };
    }

    return {
        title: `☀️ เช้าวันที่ ${dayNumber}`,
        outcomeType: 'peaceful',
        lead: 'คืนนี้ผ่านไปโดยไม่มีใครตาย',
        detail: 'หมู่บ้านยังไม่มีคำตอบว่าหมาป่าลงมือหรือไม่'
    };
}

function buildDayResolutionAnnouncement(room) {
    const summary = room?.gameState?.lastResolvedDay;
    if (!summary) {
        return null;
    }

    const dayNumber = room.gameState.dayNumber || 1;
    const eliminatedPlayer = summary.eliminatedPlayerId ? getPlayer(room, summary.eliminatedPlayerId) : null;

    if (eliminatedPlayer) {
        return {
            title: `🌙 คืน ${dayNumber + 1}`,
            outcomeType: 'eliminated',
            lead: `${eliminatedPlayer.name} ถูกขับออกจากหมู่บ้าน`,
            detail: `${eliminatedPlayer.name} เผยตัวว่าเป็น ${eliminatedPlayer.revealedRole || eliminatedPlayer.roleInfo?.thaiName || eliminatedPlayer.role}`
        };
    }

    return {
        title: `🌙 คืน ${dayNumber + 1}`,
        outcomeType: 'tie',
        lead: 'การโหวตจบลงแบบไม่มีใครถูกกำจัด',
        detail: 'คืนนี้หมู่บ้านต้องกลับไปฟังความเคลื่อนไหวในความมืดอีกครั้ง'
    };
}

function buildRoleNotes(room, viewer) {
    if (!viewer) {
        return [];
    }

    const notes = [];

    switch (viewer.role) {
        case 'werewolf':
        case 'alphaWolf': {
            const teammates = room.gameState.players
                .filter(player => player.playerId !== viewer.playerId && isWerewolfRole(player.role))
                .map(player => `${player.name}${player.alive === false ? ' (ตายแล้ว)' : ''}`);

            if (teammates.length > 0) {
                notes.push(`🐺 ทีมหมาป่าของคุณ: ${teammates.join(', ')}`);
            }

            if (isFirstNight(room)) {
                notes.push('🌙 คืนแรกหมาป่ายังออกล่าไม่ได้ ใช้เวลาจำหน้าและวางแผนก่อน');
            } else if (viewer.role === 'alphaWolf') {
                notes.push('👑 โหวตล่าของคุณมีน้ำหนัก 2 เสียงในฐานะ Alpha Wolf');
            }
            break;
        }
        case 'seer':
            notes.push('🔮 คุณตรวจผู้เล่นได้คืนละ 1 คน และดูตัวเองไม่ได้');
            break;
        case 'doctor':
            notes.push('💉 คุณช่วยชีวิตผู้เล่นได้คืนละ 1 คน และช่วยตัวเองได้');
            break;
        case 'bodyguard': {
            const previousTargetId = room.gameState.lastProtectedByBodyguard?.[viewer.playerId] || null;
            const previousTarget = previousTargetId ? getPlayer(room, previousTargetId) : null;
            if (previousTarget) {
                notes.push(`🛡️ คืนก่อนคุณปกป้อง ${previousTarget.name} คืนนี้เลือกคนเดิมซ้ำไม่ได้`);
            } else {
                notes.push('🛡️ คุณปกป้องผู้เล่นได้คืนละ 1 คน แต่ห้ามเลือกคนเดิมสองคืนติดกัน');
            }
            break;
        }
        case 'mayor':
            notes.push('🗳️ โหวตกลางวันของคุณมีน้ำหนัก 2 เสียง');
            break;
        case 'revealer':
            if (viewer.revealerUsed) {
                notes.push('💥 คุณใช้สกิลเปิดโปงไปแล้ว');
            } else {
                notes.push('💥 คุณยังมีสกิลเปิดโปง 1 ครั้ง ใช้ได้ตอนกลางวัน');
            }
            break;
        case 'villager':
            notes.push('🏡 คุณไม่มีสกิลกลางคืน ใช้การคุยและการโหวตช่วยทีมชาวบ้าน');
            break;
        default:
            break;
    }

    return notes;
}

function buildClientState(room, viewerPlayerId) {
    const viewer = getPlayer(room, viewerPlayerId);
    const rolePlan = room.gameState.rolePlan?.length ? room.gameState.rolePlan : getRolePlan(room.players.length, room.settings);
    const enabledRoleIds = new Set(['villager', ...getConfiguredRoleIds(room.settings)]);

    return {
        mode: 'werewolf',
        roomId: room.roomId,
        roomName: room.name,
        phase: room.gameState.phase || 'lobby',
        phaseEndsAt: room.gameState.phaseEndsAt || null,
        status: room.gameState.status || '',
        dayNumber: room.gameState.dayNumber || 0,
        winner: room.gameState.winner || null,
        morningAnnouncement: room.gameState.phase === 'day-vote' ? buildMorningAnnouncement(room) : null,
        dayResolutionAnnouncement: room.gameState.phase === 'night' ? buildDayResolutionAnnouncement(room) : null,
        playerRole: viewer ? {
            id: viewer.role,
            name: viewer.roleInfo?.name || '',
            thaiName: viewer.roleInfo?.thaiName || '',
            team: viewer.roleInfo?.team || '',
            description: viewer.roleInfo?.description || ''
        } : null,
        personalNotes: {
            roleNotes: buildRoleNotes(room, viewer),
            lastSeenRole: viewer?.lastSeenRole || null,
            seerHistory: Array.isArray(viewer?.seerHistory) ? viewer.seerHistory : [],
            lastNightResult: viewer?.lastNightResult || null
        },
        players: room.gameState.players.map(player => ({
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            alive: player.alive !== false,
            isSelf: player.playerId === viewerPlayerId,
            revealedRole: player.revealedRole || null,
            voteWeight: player.role === 'mayor' ? 2 : 1
        })),
        rolePlan: rolePlan.map(role => ({
            id: role.id,
            thaiName: role.thaiName,
            team: role.team,
            description: role.description
        })),
        roleCatalog: Object.values(ROLE_DEFINITIONS).map(role => ({
            id: role.id,
            thaiName: role.thaiName,
            team: role.team,
            description: role.description,
            enabledInRoom: enabledRoleIds.has(role.id)
        })),
        history: room.gameState.history || [],
        actionState: {
            aliveWerewolves: getAliveWerewolves(room).length,
            aliveVillagers: getAliveNonWerewolves(room).length,
            completedDayDecisions: Array.from(getCompletedDayActorIds(room)).length,
            requiredDayDecisions: getAlivePlayers(room).length,
            nightActions: getNightActionOptions(room, viewer),
            dayActions: getDayActionOptions(room, viewer)
        }
    };
}

module.exports = {
    id: 'werewolf',
    label: 'Werewolf',
    description: 'โหมดใหม่ เกมหมาป่าที่ทุกคนรู้จักกันดี แต่เพิ่มบทบาทใหม่และปรับสมดุลให้เล่นสนุกขึ้น',
    ROLE_DEFINITIONS,
    CONFIGURABLE_ROLE_IDS,
    sanitizeRoleSelection,
    getConfigurableRoles,
    getRolePlan,
    SKIP_TARGET_ID,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    submitNightAction,
    submitDayVote,
    useRevealAction,
    autoResolvePhase,
    buildClientState
};