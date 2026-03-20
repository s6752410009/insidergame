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
        description: 'หัวหน้าฝั่งหมาป่า โหวตล่าเหยื่อตอนกลางคืนด้วยน้ำหนัก 2 เสียง และถ้า Seer ตรวจจะขึ้นว่าไม่ทราบ'
    },
    mayor: {
        id: 'mayor',
        name: 'Mayor',
        thaiName: 'นายก',
        team: 'village',
        description: 'ไม่มีสกิลกลางคืน แต่สามารถเปิดเผยตัวตอนเช้าเพื่อให้เสียงโหวตของตัวเองเพิ่มเป็น 2 ได้'
    },
    bodyguard: {
        id: 'bodyguard',
        name: 'Bodyguard',
        thaiName: 'บอดี้การ์ด',
        team: 'village',
        description: 'ปกป้องตัวเองหรือผู้เล่น 1 คนในตอนกลางคืน ห้ามปกป้องคนเดิมสองคืนติดกัน และถ้ากันการโจมตีสำเร็จเกราะจะพังทันที'
    },
    seer: {
        id: 'seer',
        name: 'Seer',
        thaiName: 'Seer',
        team: 'village',
        description: 'ตรวจออร่าผู้เล่น 1 คนในตอนกลางคืน และจะเห็นผลแค่ ดี, ไม่ดี หรือ ไม่ทราบ โดยดูได้เพียงครั้งเดียวต่อคืน'
    },
    doctor: {
        id: 'doctor',
        name: 'Doctor',
        thaiName: 'หมอ',
        team: 'village',
        description: 'ช่วยตัวเองหรือผู้เล่น 1 คนในตอนกลางคืน แต่ใช้สิทธิ์ช่วยได้รวม 2 ครั้งต่อเกมเท่านั้น'
    },
    witch: {
        id: 'witch',
        name: 'Witch',
        thaiName: 'แม่มด',
        team: 'village',
        description: 'มียาฟื้น 1 ครั้งและยาพิษ 1 ครั้งต่อเกม แต่ในแต่ละคืนเลือกใช้ได้เพียง 1 สกิลเท่านั้น'
    },
    fool: {
        id: 'fool',
        name: 'Fool',
        thaiName: 'คนบ้า',
        team: 'solo',
        description: 'หมาป่าฆ่าคุณไม่ได้ ถ้าคุณถูกโหวตออกตอนกลางวันคุณจะชนะคนเดียวทันที และถ้า Seer ตรวจจะขึ้นว่าไม่ทราบ'
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
    6: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch', 'villager'],
    7: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch', 'fool', 'villager'],
    8: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch', 'fool', 'bodyguard', 'villager'],
    9: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'villager'],
    10: ['alphaWolf', 'werewolf', 'werewolf', 'seer', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'revealer']
};

const CONFIGURABLE_ROLE_IDS = ['werewolf', 'alphaWolf', 'seer', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'revealer'];
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

function isFoolRole(roleId) {
    return roleId === 'fool';
}

function getSeerAlignment(roleId) {
    if (roleId === 'alphaWolf' || isFoolRole(roleId)) {
        return {
            code: 'unknown',
            label: 'ไม่ทราบ'
        };
    }

    if (roleId === 'werewolf') {
        return {
            code: 'bad',
            label: 'ไม่ดี'
        };
    }

    if (ROLE_DEFINITIONS[roleId]?.team === 'village') {
        return {
            code: 'good',
            label: 'ดี'
        };
    }

    return {
        code: 'unknown',
        label: 'ไม่ทราบ'
    };
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

    if (enabledRoleIds.length > 0 && enabledRoleIds.length <= normalizedCount) {
        const exactRoleIds = [...enabledRoleIds];

        while (exactRoleIds.length < normalizedCount) {
            exactRoleIds.push('villager');
        }

        return exactRoleIds.slice(0, normalizedCount).map(roleId => ROLE_DEFINITIONS[roleId]);
    }

    const wolfSlotCount = basePlan.filter(isWerewolfRole).length;
    const plannedRoleIds = [];
    let missingSpecialSlots = 0;
    const selectedSpecialIds = [];
    const fallbackSpecialIds = [];
    const enabledWolfIds = enabledRoleIds.filter(isWerewolfRole);
    const basePlanWolfIds = basePlan.filter(isWerewolfRole);
    const preferredPrimaryWolfId = basePlanWolfIds.includes('alphaWolf') && enabledWolfIds.includes('alphaWolf')
        ? 'alphaWolf'
        : (enabledWolfIds.includes('werewolf') ? 'werewolf' : (enabledWolfIds.includes('alphaWolf') ? 'alphaWolf' : 'werewolf'));
    const fallbackWolfId = enabledWolfIds.includes('werewolf')
        ? 'werewolf'
        : (enabledWolfIds.includes('alphaWolf') ? 'alphaWolf' : 'werewolf');

    if (wolfSlotCount > 0) {
        plannedRoleIds.push(preferredPrimaryWolfId);
    }

    while (plannedRoleIds.filter(isWerewolfRole).length < wolfSlotCount) {
        plannedRoleIds.push(fallbackWolfId);
    }

    basePlan.forEach(roleId => {
        if (isWerewolfRole(roleId)) {
            return;
        }

        if (roleId === 'villager') {
            plannedRoleIds.push('villager');
            return;
        }

        if (enabledRoleIds.includes(roleId)) {
            plannedRoleIds.push(roleId);
            selectedSpecialIds.push(roleId);
            return;
        }

        missingSpecialSlots += 1;
    });

    CONFIGURABLE_ROLE_IDS.forEach(roleId => {
        if (isWerewolfRole(roleId)) {
            return;
        }

        if (enabledRoleIds.includes(roleId) && !selectedSpecialIds.includes(roleId)) {
            fallbackSpecialIds.push(roleId);
        }
    });

    if (missingSpecialSlots > 0) {
        plannedRoleIds.push(...fallbackSpecialIds.slice(0, missingSpecialSlots));
    }

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
            bodyguardProtects: {},
            witchHeals: {},
            witchPoisons: {}
        },
        dayVotes: {},
        discussionSkips: {},
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
        doctorSaveUses: 0,
        bodyguardArmorBroken: false,
        mayorRevealed: false,
        revealerUsed: false,
        witchHealUsed: false,
        witchPoisonUsed: false
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

function getCurrentVoteWeight(player) {
    if (!player || player.alive === false) {
        return 0;
    }

    return player.role === 'mayor' && player.mayorRevealed ? 2 : 1;
}

function getDayVoteTallies(room) {
    const tallies = {};

    Object.entries(room.gameState.dayVotes || {}).forEach(([actorId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }

        const actor = getPlayer(room, actorId);
        const target = getPlayer(room, targetId);
        if (!actor || !target || actor.alive === false || target.alive === false) {
            return;
        }

        const weight = getCurrentVoteWeight(actor);
        tallies[targetId] = (tallies[targetId] || 0) + weight;
    });

    return tallies;
}

function buildDayVoteSummary(room) {
    const alivePlayers = getAlivePlayers(room);
    const targetSummaries = alivePlayers.map(player => ({
        playerId: player.playerId,
        name: player.name,
        count: 0,
        voters: []
    }));
    const summaryMap = new Map(targetSummaries.map(target => [target.playerId, target]));
    const voterChoices = [];
    let skipVoteWeight = 0;
    const skipVoters = [];

    Object.entries(room.gameState.dayVotes || {}).forEach(([actorId, targetId]) => {
        const actor = getPlayer(room, actorId);
        if (!actor || actor.alive === false) {
            return;
        }

        const weight = getCurrentVoteWeight(actor);
        const weightLabel = weight > 1 ? ` x${weight}` : '';

        if (!targetId || targetId === SKIP_TARGET_ID) {
            skipVoteWeight += weight;
            skipVoters.push({
                playerId: actor.playerId,
                name: actor.name,
                weight,
                weightLabel
            });
            voterChoices.push({
                voterId: actor.playerId,
                voterName: actor.name,
                targetId: SKIP_TARGET_ID,
                targetName: 'ข้ามรอบนี้',
                weight,
                weightLabel,
                isSkip: true
            });
            return;
        }

        const target = getPlayer(room, targetId);
        if (!target || target.alive === false) {
            return;
        }

        const summary = summaryMap.get(target.playerId);
        if (summary) {
            summary.count += weight;
            summary.voters.push({
                playerId: actor.playerId,
                name: actor.name,
                weight,
                weightLabel
            });
        }

        voterChoices.push({
            voterId: actor.playerId,
            voterName: actor.name,
            targetId: target.playerId,
            targetName: target.name,
            weight,
            weightLabel,
            isSkip: false
        });
    });

    const completedActors = getCompletedDayActorIds(room);
    const pendingActors = alivePlayers
        .filter(player => !completedActors.has(player.playerId))
        .map(player => ({
            playerId: player.playerId,
            name: player.name
        }));

    return {
        targets: targetSummaries,
        voterChoices,
        skipVoteWeight,
        skipVoters,
        completedActors: Array.from(completedActors),
        pendingActors,
        totalAlive: alivePlayers.length,
        totalSubmittedVotes: voterChoices.length,
        totalCompletedDecisions: completedActors.size
    };
}

function getDaySkipVoteWeight(room) {
    let total = 0;

    Object.entries(room.gameState.dayVotes || {}).forEach(([actorId, targetId]) => {
        if (targetId !== SKIP_TARGET_ID) {
            return;
        }

        total += getCurrentVoteWeight(getPlayer(room, actorId));
    });

    return total;
}

function getTotalDayVoteWeight(room) {
    return getAlivePlayers(room).reduce((total, player) => total + getCurrentVoteWeight(player), 0);
}

function canSkipDayVote(room) {
    return getDaySkipVoteWeight(room) > (getTotalDayVoteWeight(room) / 2);
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

function applySeerVision(room, seerId, targetPlayerId) {
    const seer = getPlayer(room, seerId);
    const target = getPlayer(room, targetPlayerId);
    if (!seer || !target) {
        return;
    }

    const reading = getSeerAlignment(target.role);
    const seenRole = `${target.name} มีออร่า ${reading.label}`;
    const seenEntry = {
        dayNumber: room.gameState.dayNumber || 1,
        targetPlayerId: target.playerId,
        targetName: target.name,
        resultCode: reading.code,
        roleName: reading.label,
        summary: seenRole
    };

    seer.lastSeenRole = seenRole;
    seer.seerHistory = [
        seenEntry,
        ...(Array.isArray(seer.seerHistory) ? seer.seerHistory : []).filter(entry => Number(entry?.dayNumber) !== Number(seenEntry.dayNumber))
    ].slice(0, 8);
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
        bodyguardProtects: {},
        witchHeals: {},
        witchPoisons: {}
    };
}

function resetDayState(room) {
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
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

function startDiscussionPhase(room) {
    room.gameState.phase = 'day-discussion';
    room.gameState.phaseEndsAt = null;
    room.gameState.status = 'werewolf_day_discussion';
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.lastResolvedDay = null;
    room.gameState.lastAction = Date.now();
    syncAlivePlayerIds(room);
    pushHistory(room, `เช้าวันที่ ${room.gameState.dayNumber} เริ่มขึ้นแล้ว หมู่บ้านมีเวลาพูดคุยก่อนเปิดโหวต`, 'day');
}

function startDayPhase(room, trigger = 'discussion-ended') {
    room.gameState.phase = 'day-vote';
    room.gameState.phaseEndsAt = null;
    room.gameState.status = 'werewolf_day_vote';
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.lastResolvedDay = null;
    room.gameState.lastAction = Date.now();
    syncAlivePlayerIds(room);

    if (trigger === 'consensus-skip') {
        pushHistory(room, `ทุกคนพร้อมใจกันข้ามช่วงคุยของวันที่ ${room.gameState.dayNumber} และเข้าสู่การโหวตทันที`, 'day');
    } else {
        pushHistory(room, `ช่วงคุยของวันที่ ${room.gameState.dayNumber} จบแล้ว ทุกคนเตรียมโหวต`, 'day');
    }
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

    function buildBestRoleAssignment(playerStates, availableRoleIds, previousRolesByPlayerId) {
        const roleCounts = availableRoleIds.reduce((counts, roleId) => {
            counts[roleId] = (counts[roleId] || 0) + 1;
            return counts;
        }, {});
        const searchPlayers = shuffle(playerStates);
        let bestAssignment = null;
        let bestRepeatCount = Number.POSITIVE_INFINITY;

        function backtrack(index, assignment, repeatCount) {
            if (repeatCount >= bestRepeatCount) {
                return;
            }

            if (index >= searchPlayers.length) {
                bestAssignment = { ...assignment };
                bestRepeatCount = repeatCount;
                return;
            }

            const player = searchPlayers[index];
            const previousRoleId = previousRolesByPlayerId[player.playerId] || null;
            const uniqueRoleIds = shuffle(Object.keys(roleCounts).filter(roleId => roleCounts[roleId] > 0));
            uniqueRoleIds.sort((left, right) => {
                const leftPenalty = left === previousRoleId ? 1 : 0;
                const rightPenalty = right === previousRoleId ? 1 : 0;
                return leftPenalty - rightPenalty;
            });

            for (const roleId of uniqueRoleIds) {
                roleCounts[roleId] -= 1;
                assignment[player.playerId] = roleId;
                backtrack(index + 1, assignment, repeatCount + (roleId === previousRoleId ? 1 : 0));
                delete assignment[player.playerId];
                roleCounts[roleId] += 1;

                if (bestRepeatCount === 0) {
                    return;
                }
            }
        }

        backtrack(0, {}, 0);

        if (bestAssignment) {
            return bestAssignment;
        }

        const fallbackRoleIds = shuffle(availableRoleIds);
        return playerStates.reduce((assignment, playerState, index) => {
            assignment[playerState.playerId] = fallbackRoleIds[index];
            return assignment;
        }, {});
    }

    const previousRoles = players.reduce((result, playerState) => {
        if (playerState.role) {
            result[playerState.playerId] = playerState.role;
        }
        return result;
    }, {});
    const roleAssignmentByPlayerId = buildBestRoleAssignment(players, roleIds, previousRoles);

    room.gameState.players = players.map(playerState => {
        const roleId = roleAssignmentByPlayerId[playerState.playerId];
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
            doctorSaveUses: 0,
            bodyguardArmorBroken: false,
            mayorRevealed: false,
            revealerUsed: false,
            witchHealUsed: false,
            witchPoisonUsed: false
        };
    });
}

function startGame(room) {
    const previousRoles = room.gameState && room.gameState.players
        ? room.gameState.players.reduce((result, playerState) => {
            if (playerState.role) {
                result[playerState.playerId] = playerState.role;
            }
            return result;
        }, {})
        : { ...(room.lastWerewolfRolesByPlayerId || {}) };

    if (Object.keys(previousRoles).length === 0 && room.lastWerewolfRolesByPlayerId) {
        Object.assign(previousRoles, room.lastWerewolfRolesByPlayerId);
    }

    room.gameState = resetRoomGame(room);

    room.gameState.players.forEach(playerState => {
        if (previousRoles[playerState.playerId]) {
            playerState.role = previousRoles[playerState.playerId];
        }
    });

    assignRoles(room);
    room.lastWerewolfRolesByPlayerId = room.gameState.players.reduce((result, playerState) => {
        result[playerState.playerId] = playerState.role;
        return result;
    }, {});
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
        : ['werewolf', 'alphaWolf', 'seer', 'doctor', 'bodyguard', 'witch'];

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
            return player.doctorSaveUses >= 2 || !!room.gameState.nightActions.doctorSaves[player.playerId];
        case 'bodyguard':
            return player.bodyguardArmorBroken || !!room.gameState.nightActions.bodyguardProtects[player.playerId];
        case 'witch': {
            const healSubmitted = !!room.gameState.nightActions.witchHeals[player.playerId];
            const poisonSubmitted = !!room.gameState.nightActions.witchPoisons[player.playerId];
            return (player.witchHealUsed && player.witchPoisonUsed) || healSubmitted || poisonSubmitted;
        }
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
        ...Object.values(room.gameState.nightActions.bodyguardProtects),
        ...Object.values(room.gameState.nightActions.witchHeals)
    ].filter(targetId => targetId && targetId !== SKIP_TARGET_ID));
    const poisonedTargetIds = Array.from(new Set(
        Object.values(room.gameState.nightActions.witchPoisons)
            .filter(targetId => targetId && targetId !== SKIP_TARGET_ID)
    ));
    const bodyguardBreakIds = new Set();

    const attackedPlayer = attackedPlayerId ? getPlayer(room, attackedPlayerId) : null;
    const eliminatedPlayers = [];
    let immuneTargetId = null;

    if (isFirstNight(room)) {
        pushHistory(room, 'คืนแรกผ่านไปแบบเงียบผิดปกติ หมาป่ายังออกล่าไม่ได้ คืนนี้จึงไม่มีใครตาย', 'night');
    } else if (attackedPlayer && attackedPlayer.role === 'fool') {
        immuneTargetId = attackedPlayerId;
        pushHistory(room, 'เมื่อคืนหมาป่าพยายามลงมือ แต่การสังหารไม่สำเร็จ', 'night');
    } else if (attackedPlayer && attackedPlayer.alive !== false && !protectedTargets.has(attackedPlayerId)) {
        markPlayerDead(attackedPlayer, 'ถูกหมาป่าโจมตีในตอนกลางคืน');
        eliminatedPlayers.push(attackedPlayer);
        pushHistory(room, `${attackedPlayer.name} ถูกกำจัดในตอนกลางคืน และเผยตัวว่าเป็น ${attackedPlayer.revealedRole}`, 'night');
    } else if (attackedPlayer) {
        Object.entries(room.gameState.nightActions.bodyguardProtects).forEach(([guardId, protectedId]) => {
            if (protectedId === attackedPlayerId) {
                bodyguardBreakIds.add(guardId);
            }
        });
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} ไม่มีใครตาย เพราะมีคนปกป้องสำเร็จ`, 'night');
    } else {
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} หมาป่าลังเลจนไม่มีใครตาย`, 'night');
    }

    poisonedTargetIds.forEach(targetId => {
        const target = getPlayer(room, targetId);
        if (!target || target.alive === false || eliminatedPlayers.some(player => player.playerId === targetId)) {
            return;
        }

        markPlayerDead(target, 'ถูกแม่มดวางยาพิษในตอนกลางคืน');
        eliminatedPlayers.push(target);
        pushHistory(room, `${target.name} ถูกแม่มดวางยาพิษในตอนกลางคืน และเผยตัวว่าเป็น ${target.revealedRole}`, 'night');
    });

    Object.entries(room.gameState.nightActions.seerChecks).forEach(([seerId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        applySeerVision(room, seerId, targetId);
    });

    Object.entries(room.gameState.nightActions.bodyguardProtects).forEach(([guardId, protectedId]) => {
        if (protectedId && protectedId !== SKIP_TARGET_ID) {
            room.gameState.lastProtectedByBodyguard[guardId] = protectedId;
        } else {
            delete room.gameState.lastProtectedByBodyguard[guardId];
        }
    });

    room.gameState.players.forEach(player => {
        const doctorTargetId = room.gameState.nightActions.doctorSaves[player.playerId];
        const healTargetId = room.gameState.nightActions.witchHeals[player.playerId];
        const poisonTargetId = room.gameState.nightActions.witchPoisons[player.playerId];

        if (player.role === 'doctor' && doctorTargetId && doctorTargetId !== SKIP_TARGET_ID) {
            player.doctorSaveUses = Number(player.doctorSaveUses || 0) + 1;
        }

        if (player.role === 'bodyguard' && bodyguardBreakIds.has(player.playerId)) {
            player.bodyguardArmorBroken = true;
            player.lastNightResult = 'เกราะของคุณแตกแล้ว หลังจากกันการโจมตีเมื่อคืน คุณจะปกป้องใครต่อไม่ได้อีก';
        }

        if (player.role === 'witch' && healTargetId && healTargetId !== SKIP_TARGET_ID) {
            player.witchHealUsed = true;
        }

        if (player.role === 'witch' && poisonTargetId && poisonTargetId !== SKIP_TARGET_ID) {
            player.witchPoisonUsed = true;
        }
    });

    room.gameState.lastResolvedNight = {
        attackedPlayerId,
        eliminatedPlayerIds: eliminatedPlayers.map(player => player.playerId),
        protectedTargets: Array.from(protectedTargets),
        poisonedTargetIds,
        immuneTargetId
    };

    syncAlivePlayerIds(room);
    if (checkWinCondition(room)) {
        return { resolved: true, winner: room.gameState.winner };
    }

    startDiscussionPhase(room);
    return { resolved: true, winner: null };
}

function getDiscussionSkipCount(room) {
    return Object.keys(room.gameState.discussionSkips || {}).filter(playerId => {
        const player = getPlayer(room, playerId);
        return !!player && player.alive !== false;
    }).length;
}

function canSkipDiscussion(room) {
    return getDiscussionSkipCount(room) >= getAlivePlayers(room).length;
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
    if (canSkipDayVote(room)) {
        room.gameState.lastResolvedDay = {
            eliminatedPlayerId: null,
            skippedByMajority: true,
            skipVoteWeight: getDaySkipVoteWeight(room)
        };
        pushHistory(room, 'เสียงข้ามโหวตเกินครึ่ง วันจึงถูกข้ามทันทีและเกมเข้าสู่กลางคืน', 'day');
        startNightPhase(room);
        return { resolved: true, winner: null };
    }

    const eliminatedPlayerId = getWeightedTarget(
        Object.fromEntries(Object.entries(room.gameState.dayVotes).filter(([, targetId]) => targetId && targetId !== SKIP_TARGET_ID)),
        room,
        {}
    );
    const eliminatedPlayer = eliminatedPlayerId ? getPlayer(room, eliminatedPlayerId) : null;

    if (eliminatedPlayer && eliminatedPlayer.alive !== false) {
        markPlayerDead(eliminatedPlayer, 'ถูกโหวตออกในเวลากลางวัน');
        pushHistory(room, `${eliminatedPlayer.name} ถูกโหวตออก และเผยตัวว่าเป็น ${eliminatedPlayer.revealedRole}`, 'day');

        if (eliminatedPlayer.role === 'fool') {
            room.gameState.phase = 'finished';
            room.gameState.phaseEndsAt = null;
            room.gameState.status = 'werewolf_finished';
            room.gameState.winner = 'fool';
            room.gameState.players.forEach(player => {
                player.revealedRole = player.roleInfo?.thaiName || player.role;
            });
            room.gameState.lastResolvedDay = {
                eliminatedPlayerId: eliminatedPlayer.playerId
            };
            syncAlivePlayerIds(room);
            pushHistory(room, `${eliminatedPlayer.name} คือคนบ้า และชนะคนเดียวทันทีหลังถูกโหวตออก`, 'result');
            return { resolved: true, winner: room.gameState.winner };
        }
    } else {
        pushHistory(room, 'การโหวตวันนี้เสมอกัน ไม่มีใครถูกกำจัด', 'day');
    }

    room.gameState.lastResolvedDay = {
        eliminatedPlayerId: eliminatedPlayer?.playerId || null,
        skippedByMajority: false,
        skipVoteWeight: getDaySkipVoteWeight(room)
    };

    syncAlivePlayerIds(room);
    if (checkWinCondition(room)) {
        return { resolved: true, winner: room.gameState.winner };
    }

    startNightPhase(room);
    return { resolved: true, winner: null };
}

function submitNightAction(room, actorId, targetPlayerId, actionType = null) {
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
            if (room.gameState.nightActions.seerChecks[actorId]) {
                throw new Error('Seer ดูได้แค่ 1 คนต่อคืน');
            }
            if (isSkip) {
                room.gameState.nightActions.seerChecks[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('Seer ตรวจตัวเองไม่ได้');
            }
            room.gameState.nightActions.seerChecks[actorId] = targetPlayerId;
            applySeerVision(room, actorId, targetPlayerId);
            break;
        case 'doctor':
            if (actor.doctorSaveUses >= 2) {
                throw new Error('หมอปกป้องได้รวม 2 ครั้งต่อเกมเท่านั้น');
            }
            if (isSkip) {
                room.gameState.nightActions.doctorSaves[actorId] = SKIP_TARGET_ID;
                break;
            }
            room.gameState.nightActions.doctorSaves[actorId] = targetPlayerId;
            break;
        case 'bodyguard': {
            if (actor.bodyguardArmorBroken) {
                throw new Error('เกราะของบอดี้การ์ดแตกแล้ว จึงปกป้องใครต่อไม่ได้อีก');
            }
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
        case 'witch':
            if (room.gameState.nightActions.witchHeals[actorId] && actionType !== 'witch-heal') {
                throw new Error('แม่มดใช้ได้คืนละ 1 สกิลเท่านั้น');
            }

            if (room.gameState.nightActions.witchPoisons[actorId] && actionType !== 'witch-poison') {
                throw new Error('แม่มดใช้ได้คืนละ 1 สกิลเท่านั้น');
            }

            if (actionType === 'witch-heal') {
                if (actor.witchHealUsed) {
                    throw new Error('คุณใช้ยาฟื้นไปแล้ว');
                }
                room.gameState.nightActions.witchHeals[actorId] = isSkip ? SKIP_TARGET_ID : targetPlayerId;
                break;
            }

            if (actionType === 'witch-poison') {
                if (actor.witchPoisonUsed) {
                    throw new Error('คุณใช้ยาพิษไปแล้ว');
                }
                if (!isSkip && actorId === targetPlayerId) {
                    throw new Error('แม่มดวางยาพิษตัวเองไม่ได้');
                }
                room.gameState.nightActions.witchPoisons[actorId] = isSkip ? SKIP_TARGET_ID : targetPlayerId;
                break;
            }

            throw new Error('แม่มดต้องเลือกว่าจะใช้ยาฟื้นหรือยาพิษ');
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

    if (canSkipDayVote(room) || canResolveDay(room)) {
        return resolveDayVote(room);
    }

    return { resolved: false };
}

function submitMayorReveal(room, actorId) {
    if (room.gameState.phase !== 'day-discussion' && room.gameState.phase !== 'day-vote') {
        throw new Error('นายกเปิดเผยตัวได้เฉพาะตอนเช้าเท่านั้น');
    }

    const actor = getPlayer(room, actorId);
    if (!actor || actor.alive === false || actor.role !== 'mayor') {
        throw new Error('มีแต่นายกที่เปิดเผยตัวเองได้');
    }

    if (actor.mayorRevealed) {
        throw new Error('นายกเปิดเผยตัวไปแล้ว');
    }

    actor.mayorRevealed = true;
    actor.revealedRole = actor.roleInfo?.thaiName || actor.role;
    room.gameState.lastAction = Date.now();
    pushHistory(room, `${actor.name} เปิดเผยตัวว่าเป็นนายก ทำให้เสียงโหวตของเขานับเป็น 2 ตั้งแต่นี้`, 'day');

    if (room.gameState.phase === 'day-vote' && (canSkipDayVote(room) || canResolveDay(room))) {
        return resolveDayVote(room);
    }

    return { resolved: false, mayorRevealed: true };
}

function submitDiscussionSkip(room, actorId) {
    if (room.gameState.phase !== 'day-discussion') {
        throw new Error('ยังไม่ใช่ช่วงพูดคุยตอนเช้า');
    }

    const actor = getPlayer(room, actorId);
    if (!actor || actor.alive === false) {
        throw new Error('ผู้เล่นนี้ไม่สามารถกดข้ามได้');
    }

    room.gameState.discussionSkips[actorId] = true;
    room.gameState.lastAction = Date.now();

    if (canSkipDiscussion(room)) {
        startDayPhase(room, 'consensus-skip');
        return { resolved: true, skippedToVote: true };
    }

    return {
        resolved: false,
        skippedToVote: false,
        skipCount: getDiscussionSkipCount(room),
        totalAlive: getAlivePlayers(room).length
    };
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
                if (actor.doctorSaveUses >= 2) {
                    break;
                }
                const target = chooseRandom(getAlivePlayers(room));
                if (target) {
                    room.gameState.nightActions.doctorSaves[actor.playerId] = target.playerId;
                }
                break;
            }
            case 'bodyguard': {
                if (actor.bodyguardArmorBroken) {
                    break;
                }
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
            case 'witch': {
                if (!actor.witchHealUsed) {
                    room.gameState.nightActions.witchHeals[actor.playerId] = SKIP_TARGET_ID;
                } else if (!actor.witchPoisonUsed) {
                    room.gameState.nightActions.witchPoisons[actor.playerId] = SKIP_TARGET_ID;
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

        room.gameState.dayVotes[actor.playerId] = SKIP_TARGET_ID;
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

    if (room.gameState.phase === 'day-discussion') {
        startDayPhase(room, 'timeout');
        return { resolved: true, winner: null, autoResolved: true, skippedToVote: true };
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
            if (room.gameState.nightActions.seerChecks[viewer.playerId]) {
                return [{
                    type: 'seer-check',
                    label: 'ตรวจสอบบทบาทแล้วคืนนี้',
                    description: 'คืนนี้คุณใช้สิทธิ์ตรวจไปแล้ว รอฟังผลต่อในเช้าวันถัดไป',
                    selectedTargetId: room.gameState.nightActions.seerChecks[viewer.playerId],
                    allowSkip: false,
                    locked: true,
                    targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                        playerId: player.playerId,
                        name: player.name
                    }))
                }];
            }
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
            if (viewer.doctorSaveUses >= 2) {
                return [{
                    type: 'doctor-save',
                    label: 'ยาหมอหมดแล้ว',
                    description: 'คุณใช้สิทธิ์ปกป้องครบ 2 ครั้งตลอดเกมแล้ว คืนนี้จึงช่วยใครต่อไม่ได้',
                    selectedTargetId: null,
                    allowSkip: false,
                    emptyStateText: 'หมอใช้สิทธิ์ครบแล้ว',
                    targets: []
                }];
            }
            return [{
                type: 'doctor-save',
                label: 'ช่วยชีวิต',
                description: `เลือกคนที่ต้องการช่วยคืนนี้ (เหลือ ${Math.max(0, 2 - Number(viewer.doctorSaveUses || 0))} ครั้งตลอดเกม)`,
                selectedTargetId: room.gameState.nightActions.doctorSaves[viewer.playerId] || null,
                allowSkip: true,
                targets: alivePlayers.map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        case 'bodyguard': {
            if (viewer.bodyguardArmorBroken) {
                return [{
                    type: 'bodyguard-protect',
                    label: 'เกราะของบอดี้การ์ดแตกแล้ว',
                    description: 'คุณกันการโจมตีสำเร็จไปแล้ว 1 ครั้ง จึงปกป้องใครต่อไม่ได้อีก',
                    selectedTargetId: null,
                    allowSkip: false,
                    emptyStateText: 'คืนนี้คุณทำได้เพียงเฝ้าดูสถานการณ์',
                    targets: []
                }];
            }
            const previousTarget = room.gameState.lastProtectedByBodyguard[viewer.playerId] || null;
            let targets = alivePlayers.filter(player => player.playerId !== previousTarget);
            if (targets.length === 0) {
                targets = alivePlayers;
            }

            return [{
                type: 'bodyguard-protect',
                label: 'ปกป้อง',
                description: previousTarget ? 'เลือกได้ทั้งตัวเองหรือคนอื่น แต่ห้ามเลือกคนเดิมสองคืนติดกัน' : 'เลือกได้ทั้งตัวเองหรือคนอื่น ถ้ากันการโจมตีสำเร็จเกราะจะพังทันที',
                selectedTargetId: room.gameState.nightActions.bodyguardProtects[viewer.playerId] || null,
                allowSkip: true,
                targets: targets.map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        case 'witch': {
            const selectedHealTargetId = room.gameState.nightActions.witchHeals[viewer.playerId] || null;
            const selectedPoisonTargetId = room.gameState.nightActions.witchPoisons[viewer.playerId] || null;
            const actions = [];

            if (selectedHealTargetId || selectedPoisonTargetId) {
                const selectedType = selectedPoisonTargetId ? 'witch-poison' : 'witch-heal';
                const selectedTargetId = selectedPoisonTargetId || selectedHealTargetId;
                return [{
                    type: selectedType,
                    label: selectedType === 'witch-poison' ? 'คืนนี้คุณเลือกใช้ยาพิษแล้ว' : 'คืนนี้คุณเลือกใช้ยาฟื้นแล้ว',
                    description: 'แม่มดใช้ได้เพียง 1 สกิลต่อคืน ถ้าจะเปลี่ยนใจให้เลือกเป้าหมายใหม่ในสกิลเดิมเท่านั้น',
                    selectedTargetId,
                    allowSkip: true,
                    locked: true,
                    targets: alivePlayers
                        .filter(player => selectedType !== 'witch-poison' || player.playerId !== viewer.playerId)
                        .map(player => ({
                            playerId: player.playerId,
                            name: player.name
                        }))
                }];
            }

            if (!viewer.witchHealUsed) {
                actions.push({
                    type: 'witch-heal',
                    label: 'ยาฟื้นของแม่มด',
                    description: 'เลือก 1 คนเพื่อปกป้องคืนนี้ ใช้ได้ 1 ครั้งตลอดเกม และคืนนี้จะใช้สกิลอื่นเพิ่มไม่ได้',
                    selectedTargetId: room.gameState.nightActions.witchHeals[viewer.playerId] || null,
                    allowSkip: true,
                    targets: alivePlayers.map(player => ({
                        playerId: player.playerId,
                        name: player.name
                    }))
                });
            }

            if (!viewer.witchPoisonUsed) {
                actions.push({
                    type: 'witch-poison',
                    label: 'ยาพิษของแม่มด',
                    description: 'เลือก 1 คนเพื่อวางยาพิษคืนนี้ ใช้ได้ 1 ครั้งตลอดเกม และคืนนี้จะใช้สกิลอื่นเพิ่มไม่ได้',
                    selectedTargetId: room.gameState.nightActions.witchPoisons[viewer.playerId] || null,
                    allowSkip: true,
                    targets: alivePlayers
                        .filter(player => player.playerId !== viewer.playerId)
                        .map(player => ({
                            playerId: player.playerId,
                            name: player.name
                        }))
                });
            }

            if (actions.length === 0) {
                return [{
                    type: 'witch-rest',
                    label: 'พลังของแม่มดหมดแล้ว',
                    description: 'คุณใช้ทั้งยาฟื้นและยาพิษไปครบแล้ว คืนนี้จึงไม่มีสกิลให้กดใช้',
                    selectedTargetId: null,
                    allowSkip: false,
                    emptyStateText: 'แม่มดใช้ยาครบแล้ว รอดูสถานการณ์อย่างเดียวในคืนนี้',
                    targets: []
                }];
            }

            return actions;
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
            dayVoteSummary: null,
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
        voteTallies: getDayVoteTallies(room),
        dayVoteSummary: buildDayVoteSummary(room),
        skipVoteWeight: getDaySkipVoteWeight(room),
        totalVoteWeight: getTotalDayVoteWeight(room),
        completedVotes: Object.keys(room.gameState.dayVotes || {}).length,
        totalVoters: getAlivePlayers(room).length,
        canRevealMayor: viewer.role === 'mayor' && !viewer.mayorRevealed,
        mayorRevealed: !!viewer.mayorRevealed,
        currentVoteWeight: getCurrentVoteWeight(viewer),
        canReveal: viewer.role === 'revealer' && !viewer.revealerUsed,
        revealUsed: !!viewer.revealerUsed,
        revealTargets: viewer.role === 'revealer' && !viewer.revealerUsed ? targets : []
    };
}

function getDiscussionActionState(room, viewer) {
    const totalAlive = getAlivePlayers(room).length;
    const skipCount = getDiscussionSkipCount(room);
    const hasSkipped = !!room.gameState.discussionSkips?.[viewer?.playerId];

    if (!viewer || viewer.alive === false || room.gameState.phase !== 'day-discussion') {
        return {
            canSkip: false,
            hasSkipped: false,
            skipCount,
            totalAlive
        };
    }

    return {
        canSkip: !hasSkipped,
        hasSkipped,
        skipCount,
        totalAlive,
        canRevealMayor: viewer.role === 'mayor' && !viewer.mayorRevealed,
        mayorRevealed: !!viewer.mayorRevealed,
        currentVoteWeight: getCurrentVoteWeight(viewer)
    };
}

function buildMorningAnnouncement(room) {
    const summary = room?.gameState?.lastResolvedNight;
    if (!summary) {
        return null;
    }

    const dayNumber = room.gameState.dayNumber || 1;
    const eliminatedPlayers = Array.isArray(summary.eliminatedPlayerIds)
        ? summary.eliminatedPlayerIds.map(playerId => getPlayer(room, playerId)).filter(Boolean)
        : [];
    const attackedPlayer = summary.attackedPlayerId ? getPlayer(room, summary.attackedPlayerId) : null;
    const immunePlayer = summary.immuneTargetId ? getPlayer(room, summary.immuneTargetId) : null;

    if (dayNumber === 1 && eliminatedPlayers.length === 0) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'peaceful-first-night',
            lead: 'หมู่บ้านตื่นขึ้นมาพร้อมความเงียบผิดปกติ',
            detail: 'คืนแรกผ่านไปโดยไม่มีใครตาย และหมาป่ายังไม่ได้ออกล่า'
        };
    }

    if (eliminatedPlayers.length === 1) {
        const eliminatedPlayer = eliminatedPlayers[0];
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'death',
            lead: `เมื่อคืน ${eliminatedPlayer.name} ไม่รอด`,
            detail: `${eliminatedPlayer.name} เผยตัวว่าเป็น ${eliminatedPlayer.revealedRole || eliminatedPlayer.roleInfo?.thaiName || eliminatedPlayer.role}`
        };
    }

    if (eliminatedPlayers.length > 1) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'multiple-deaths',
            lead: `เมื่อคืนมีผู้เล่น ${eliminatedPlayers.length} คนไม่รอด`,
            detail: eliminatedPlayers.map(player => `${player.name} (${player.revealedRole || player.roleInfo?.thaiName || player.role})`).join(', ')
        };
    }

    if (immunePlayer) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'immune',
            lead: 'เมื่อคืนหมาป่าพยายามลงมือ แต่ไม่มีใครตาย',
            detail: 'การสังหารเมื่อคืนไม่สำเร็จ แต่หมู่บ้านยังไม่รู้ว่าเพราะอะไร'
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

    if (summary.skippedByMajority) {
        return {
            title: `🌙 คืน ${dayNumber + 1}`,
            outcomeType: 'skipped',
            lead: 'เสียงข้ามโหวตเกินครึ่ง หมู่บ้านจบวันทันที',
            detail: 'ไม่มีใครถูกกำจัด และเกมเข้าสู่กลางคืนต่อทันที'
        };
    }

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
            notes.push('🌓 ผลตรวจจะเห็นแค่ ดี, ไม่ดี หรือ ไม่ทราบ');
            notes.push('🕶️ อัลฟ่าหมาป่าและคนบ้าจะขึ้นว่า ไม่ทราบ');
            break;
        case 'doctor':
            notes.push(`💉 คุณช่วยตัวเองหรือคนอื่นได้ แต่ใช้ได้รวม ${Math.max(0, 2 - Number(viewer.doctorSaveUses || 0))} ครั้งที่เหลือตลอดเกม`);
            break;
        case 'witch':
            notes.push(viewer.witchHealUsed ? '🧪 คุณใช้ยาฟื้นไปแล้ว' : '🧪 คุณยังมียาฟื้น 1 ครั้ง ใช้ปกป้องใครก็ได้ในตอนกลางคืน');
            notes.push(viewer.witchPoisonUsed ? '☠️ คุณใช้ยาพิษไปแล้ว' : '☠️ คุณยังมียาพิษ 1 ครั้ง ใช้กำจัดผู้เล่น 1 คนในตอนกลางคืน');
            notes.push('🌙 แต่ละคืนแม่มดเลือกใช้ได้เพียง 1 สกิลเท่านั้น');
            break;
        case 'fool':
            notes.push('🤪 หมาป่าฆ่าคุณไม่ได้ในตอนกลางคืน');
            notes.push('🏆 ถ้าคุณถูกโหวตออกตอนกลางวัน คุณจะชนะคนเดียวทันที');
            break;
        case 'bodyguard': {
            if (viewer.bodyguardArmorBroken) {
                notes.push('🛡️ เกราะของคุณแตกแล้ว จึงปกป้องใครต่อไม่ได้อีก');
                break;
            }
            const previousTargetId = room.gameState.lastProtectedByBodyguard?.[viewer.playerId] || null;
            const previousTarget = previousTargetId ? getPlayer(room, previousTargetId) : null;
            if (previousTarget) {
                notes.push(`🛡️ คืนก่อนคุณปกป้อง ${previousTarget.name} คืนนี้เลือกคนเดิมซ้ำไม่ได้`);
            } else {
                notes.push('🛡️ คุณปกป้องตัวเองหรือคนอื่นได้ แต่ห้ามเลือกคนเดิมสองคืนติดกัน');
            }
            notes.push('🧱 ถ้าคุณกันการโจมตีสำเร็จ เกราะจะพังและคุณจะใช้สกิลนี้ต่อไม่ได้อีก');
            break;
        }
        case 'mayor':
            notes.push(viewer.mayorRevealed ? '🎖️ คุณเปิดเผยตัวเป็นนายกแล้ว เสียงโหวตของคุณนับเป็น 2' : '🎖️ ถ้าคุณเปิดเผยตัวเป็นนายกตอนเช้า เสียงโหวตของคุณจะเพิ่มเป็น 2');
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
    const dayVoteTallies = getDayVoteTallies(room);

    return {
        mode: 'werewolf',
        roomId: room.roomId,
        roomName: room.name,
        phase: room.gameState.phase || 'lobby',
        phaseEndsAt: room.gameState.phaseEndsAt || null,
        status: room.gameState.status || '',
        dayNumber: room.gameState.dayNumber || 0,
        winner: room.gameState.winner || null,
        morningAnnouncement: room.gameState.phase === 'day-discussion' ? buildMorningAnnouncement(room) : null,
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
            voteWeight: getCurrentVoteWeight(player),
            voteCount: dayVoteTallies[player.playerId] || 0
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
            discussionActions: getDiscussionActionState(room, viewer),
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
    submitMayorReveal,
    submitDiscussionSkip,
    submitDayVote,
    useRevealAction,
    autoResolvePhase,
    buildClientState
};