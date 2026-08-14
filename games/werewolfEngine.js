const { gameAssetImage } = require('./gameAssets');

function werewolfRoleImage(id) {
    return gameAssetImage('werewolf', id);
}

function serializePublicRole(role) {
    if (!role || !role.id) {
        return null;
    }

    return {
        id: role.id,
        name: role.name || '',
        thaiName: role.thaiName,
        team: role.team,
        description: role.description,
        winCondition: role.winCondition || '',
        image: role.image,
        icon: role.icon
    };
}

const ROLE_DEFINITIONS = {
    villager: {
        id: 'villager',
        image: werewolfRoleImage('villager'),
        icon: '👤',
        name: 'Villager',
        thaiName: 'ชาวบ้าน',
        team: 'village',
        description: 'ไม่มีสกิลพิเศษ ใช้การคุย จับพิรุธ และโหวตช่วยทีม',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    werewolf: {
        id: 'werewolf',
        image: werewolfRoleImage('werewolf'),
        icon: '🐺',
        name: 'Werewolf',
        thaiName: 'หมาป่า',
        team: 'werewolf',
        description: 'คุยกับทีมหมาป่าและเลือกเหยื่อในตอนกลางคืน (คืนแรกยังล่าไม่ได้)',
        winCondition: 'หมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่ยังมีชีวิตอยู่รวมกัน'
    },
    alphaWolf: {
        id: 'alphaWolf',
        image: werewolfRoleImage('alphaWolf'),
        icon: '👑',
        name: 'Alpha Wolf',
        thaiName: 'อัลฟ่าหมาป่า',
        team: 'werewolf',
        description: 'หมาป่าหัวหน้า โหวตล่าแรงกว่า 1 เสียง และผู้หยั่งรู้จะเห็นว่าไม่ทราบ',
        winCondition: 'หมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่ยังมีชีวิตอยู่รวมกัน'
    },
    mayor: {
        id: 'mayor',
        image: werewolfRoleImage('mayor'),
        icon: '🎖️',
        name: 'Mayor',
        thaiName: 'นายก',
        team: 'village',
        description: 'เช้ากดเปิดตัวได้เอง แล้วเสียงโหวตของคุณจะนับเป็น 2',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    bodyguard: {
        id: 'bodyguard',
        image: werewolfRoleImage('bodyguard'),
        icon: '🛡️',
        name: 'Bodyguard',
        thaiName: 'บอดี้การ์ด',
        team: 'village',
        description: 'กันการโจมตีได้ 1 คนตอนกลางคืน ห้ามปกป้องคนเดิมสองคืนติดกัน และเกราะจะพังเมื่อกันสำเร็จ',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    seer: {
        id: 'seer',
        image: werewolfRoleImage('seer'),
        icon: '🔮',
        name: 'Seer',
        thaiName: 'ผู้หยั่งรู้',
        team: 'village',
        description: 'ตรวจผู้เล่นได้ 1 คนต่อคืน ดูตัวเองไม่ได้ ผลเป็น ดี / ไม่ดี / ไม่ทราบ',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    oracle: {
        id: 'oracle',
        image: werewolfRoleImage('oracle'),
        icon: '✨',
        name: 'Oracle',
        thaiName: 'นักพยากรณ์',
        team: 'village',
        description: 'ตรวจผู้เล่นได้ 1 คนต่อคืน ดูตัวเองไม่ได้ ระบบบอกบทบาทจริงของเป้าหมาย (แม่นกว่าผู้หยั่งรู้) และเก็บประวัติไว้ให้',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    doctor: {
        id: 'doctor',
        image: werewolfRoleImage('doctor'),
        icon: '💉',
        name: 'Doctor',
        thaiName: 'หมอ',
        team: 'village',
        description: 'ช่วยชีวิตผู้เล่น 1 คนต่อคืน ใช้ได้รวม 2 ครั้งต่อเกม',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    witch: {
        id: 'witch',
        image: werewolfRoleImage('witch'),
        icon: '🧪',
        name: 'Witch',
        thaiName: 'แม่มด',
        team: 'village',
        description: 'มียาช่วย 1 ครั้งและยาพิษ 1 ครั้ง คืนหนึ่งใช้ได้แค่ 1 อย่าง',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    tracker: {
        id: 'tracker',
        image: werewolfRoleImage('tracker'),
        icon: '🧭',
        name: 'Tracker',
        thaiName: 'นักสอดแนม',
        team: 'village',
        description: 'เลือก 1 คนตอนกลางคืนเพื่อดูว่าเขาใช้สกิลในคืนนั้นหรือไม่',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    hunter: {
        id: 'hunter',
        image: werewolfRoleImage('hunter'),
        icon: '🏹',
        name: 'Hunter',
        thaiName: 'พราน',
        team: 'village',
        description: 'กลางคืนเลือกยิง 1 คนได้ 1 ครั้งตลอดเกม เปลี่ยน/ยกเลิกเป้าได้จนกว่าจะปิดคืน — ถ้าล็อกเป้าไว้แล้วคุณตายในคืนเดียวกัน ลูกธนูยังออกตามที่เลือก',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    cleric: {
        id: 'cleric',
        image: werewolfRoleImage('cleric'),
        icon: '⛪',
        name: 'Cleric',
        thaiName: 'นักบวช',
        team: 'village',
        description: 'มีพรคุ้มกัน 1 ครั้ง ใช้กันตายให้ผู้เล่น 1 คนได้',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    vigilante: {
        id: 'vigilante',
        image: werewolfRoleImage('vigilante'),
        icon: '🎯',
        name: 'Vigilante',
        thaiName: 'ศาลเตี้ย',
        team: 'village',
        description: 'กลางคืนเลือกยิง 1 คนได้ 1 ครั้งทั้งเกม เปลี่ยน/ยกเลิกเป้าได้จนกว่าจะปิดคืน สิทธิ์จะถูกใช้ก็ต่อเมื่อคืนนั้นจบลง',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    },
    fool: {
        id: 'fool',
        image: werewolfRoleImage('fool'),
        icon: '🤪',
        name: 'Fool',
        thaiName: 'คนบ้า',
        team: 'solo',
        description: 'หมาป่าฆ่าคุณไม่ได้ และถ้าถูกโหวตออกตอนกลางวันจะชนะเดี่ยวทันที',
        winCondition: 'ชนะคนเดียวทันทีเมื่อคุณถูกโหวตออกตอนกลางวัน'
    },
    revealer: {
        id: 'revealer',
        image: werewolfRoleImage('revealer'),
        icon: '💥',
        name: 'Revealer',
        thaiName: 'จอมเปิดโปง',
        team: 'village',
        description: 'ใช้ได้ 1 ครั้งตอนกลางวัน ล็อกเป้าแล้วรอเฉลยตอนหมดเวลา ถ้าพลาดคุณตายแทน',
        winCondition: 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมดถูกกำจัด'
    }
};

const ROLE_PLANS = {
    3: ['werewolf', 'seer', 'villager'],
    4: ['werewolf', 'seer', 'doctor', 'villager'],
    5: ['werewolf', 'seer', 'doctor', 'bodyguard', 'villager'],
    6: ['werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'villager'],
    7: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'villager'],
    8: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'witch', 'villager'],
    9: ['alphaWolf', 'werewolf', 'seer', 'oracle', 'doctor', 'bodyguard', 'mayor', 'witch', 'villager'],
    10: ['alphaWolf', 'werewolf', 'seer', 'oracle', 'doctor', 'bodyguard', 'mayor', 'witch', 'tracker', 'vigilante']
};

const THREE_PLAYER_WOLF_ROLE_IDS = ['werewolf', 'alphaWolf'];
const THREE_PLAYER_SPECIAL_ROLE_IDS = ['seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'mayor', 'revealer', 'tracker', 'vigilante', 'hunter', 'cleric'];

function buildRoleCombinations(roleIds, targetSize, startIndex = 0, prefix = [], results = []) {
    if (prefix.length === targetSize) {
        results.push([...prefix]);
        return results;
    }

    for (let index = startIndex; index < roleIds.length; index += 1) {
        prefix.push(roleIds[index]);
        buildRoleCombinations(roleIds, targetSize, index + 1, prefix, results);
        prefix.pop();
    }

    return results;
}

function buildThreePlayerRolePlanVariants() {
    const variants = [];

    THREE_PLAYER_WOLF_ROLE_IDS.forEach(wolfRoleId => {
        for (let leftIndex = 0; leftIndex < THREE_PLAYER_SPECIAL_ROLE_IDS.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < THREE_PLAYER_SPECIAL_ROLE_IDS.length; rightIndex += 1) {
                variants.push([
                    wolfRoleId,
                    THREE_PLAYER_SPECIAL_ROLE_IDS[leftIndex],
                    THREE_PLAYER_SPECIAL_ROLE_IDS[rightIndex]
                ]);
            }
        }
    });

    return variants;
}

function buildRolePlanVariantsForCount(playerCount) {
    if (playerCount === 3) {
        return buildThreePlayerRolePlanVariants();
    }

    const basePlan = ROLE_PLANS[playerCount] || ROLE_PLANS[3];
    const wolfRoleIds = basePlan.filter(isWerewolfRole);
    const specialRoleSlots = Math.max(0, basePlan.length - wolfRoleIds.length);

    if (specialRoleSlots <= 0) {
        return [basePlan];
    }

    const specialRoleCombos = buildRoleCombinations(THREE_PLAYER_SPECIAL_ROLE_IDS, Math.min(specialRoleSlots, THREE_PLAYER_SPECIAL_ROLE_IDS.length));
    if (!specialRoleCombos.length) {
        return [basePlan];
    }

    return specialRoleCombos.map(function(combo) {
        return [...wolfRoleIds, ...combo];
    });
}

const ROLE_PLAN_VARIANTS = {
    3: buildRolePlanVariantsForCount(3),
    4: buildRolePlanVariantsForCount(4),
    5: buildRolePlanVariantsForCount(5),
    6: buildRolePlanVariantsForCount(6),
    7: buildRolePlanVariantsForCount(7),
    8: buildRolePlanVariantsForCount(8),
    9: buildRolePlanVariantsForCount(9),
    10: buildRolePlanVariantsForCount(10)
};

const CONFIGURABLE_ROLE_IDS = ['werewolf', 'alphaWolf', 'seer', 'oracle', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'revealer', 'tracker', 'vigilante', 'hunter', 'cleric'];
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

function serializeRolePlan(roleIds) {
    return [...(Array.isArray(roleIds) ? roleIds : [])].sort().join('|');
}

function getBaseRolePlan(playerCount, previousPlanRoleIds = []) {
    const planVariants = ROLE_PLAN_VARIANTS[playerCount];
    if (!Array.isArray(planVariants) || planVariants.length === 0) {
        return [...(ROLE_PLANS[playerCount] || ROLE_PLANS[3])];
    }

    const previousSignature = serializeRolePlan(previousPlanRoleIds);
    const candidateVariants = planVariants.filter(function(plan) {
        return serializeRolePlan(plan) !== previousSignature;
    });
    const selectedPlan = chooseRandom(candidateVariants.length ? candidateVariants : planVariants) || ROLE_PLANS[playerCount] || ROLE_PLANS[3];
    return [...selectedPlan];
}

function isWerewolfRole(roleId) {
    return roleId === 'werewolf' || roleId === 'alphaWolf';
}

function countWerewolfRoles(roleIds = []) {
    return roleIds.filter(isWerewolfRole).length;
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

function getOracleAlignment(roleId) {
    if (isWerewolfRole(roleId)) {
        return { code: 'werewolf', label: 'หมาป่า' };
    }
    if (isFoolRole(roleId)) {
        return { code: 'solo', label: 'บทเดี่ยว' };
    }
    return { code: 'village', label: 'ชาวบ้าน' };
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

function filterRoleSelectionForPlayerCount(roleIds, playerCount) {
    const sanitized = sanitizeRoleSelection(roleIds);

    if (Number(playerCount) === 3) {
        return sanitized.filter(function(roleId) {
            return roleId !== 'fool';
        });
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
        winCondition: ROLE_DEFINITIONS[roleId].winCondition || '',
        image: ROLE_DEFINITIONS[roleId].image,
        icon: ROLE_DEFINITIONS[roleId].icon,
        defaultEnabled: DEFAULT_ROLE_SELECTION.includes(roleId)
    }));
}

function fillRolePlanWithoutVillager(roleIds, targetCount, preferredIds = [], options = {}) {
    const filled = [...roleIds];
    const seen = new Set(filled);
    const maxWolfCount = Number.isFinite(options.maxWolfCount) ? Number(options.maxWolfCount) : Infinity;
    const primaryFill = [
        ...preferredIds.filter(roleId => roleId && roleId !== 'villager'),
        ...DEFAULT_ROLE_SELECTION
    ];

    primaryFill.forEach(roleId => {
        if (filled.length >= targetCount || seen.has(roleId)) {
            return;
        }

        if (isWerewolfRole(roleId) && countWerewolfRoles(filled) >= maxWolfCount) {
            return;
        }

        filled.push(roleId);
        seen.add(roleId);
    });

    const duplicateFallback = ['werewolf', 'seer', 'doctor', 'bodyguard', 'witch', 'fool', 'mayor', 'revealer'];
    let fallbackIndex = 0;
    while (filled.length < targetCount) {
        const fallbackRoleId = duplicateFallback[fallbackIndex % duplicateFallback.length];
        fallbackIndex += 1;
        if (isWerewolfRole(fallbackRoleId) && countWerewolfRoles(filled) >= maxWolfCount) {
            continue;
        }

        filled.push(fallbackRoleId);
    }

    return filled.slice(0, targetCount);
}

function getRolePlan(playerCount, settings = {}, previousPlanRoleIds = []) {
    const normalizedCount = Math.max(3, Math.min(10, Number(playerCount) || 3));
    const basePlan = getBaseRolePlan(normalizedCount, previousPlanRoleIds);
    const maxWolfCount = Math.max(1, basePlan.filter(isWerewolfRole).length);

    // Wolf count mode: pick N wolves, fill rest from base plan specials + villagers
    if (settings.wolfCount) {
        const wolfCount = Math.min(Math.max(1, Number(settings.wolfCount) || 1), 3);
        const maxAllowedWolves = Math.max(1, Math.floor(normalizedCount / 3));
        const actualWolfCount = Math.min(wolfCount, maxAllowedWolves);

        const wolves = actualWolfCount === 1
            ? ['werewolf']
            : actualWolfCount === 2
                ? ['alphaWolf', 'werewolf']
                : ['alphaWolf', 'werewolf', 'werewolf'];

        const specials = basePlan.filter(id => !isWerewolfRole(id));
        const plan = [...wolves, ...specials];
        return fillRolePlanWithoutVillager(plan, normalizedCount, basePlan, { maxWolfCount: actualWolfCount }).map(id => ROLE_DEFINITIONS[id] || ROLE_DEFINITIONS.werewolf);
    }

    const enabledRoleIds = filterRoleSelectionForPlayerCount(settings.werewolfRoles, normalizedCount);

    if (enabledRoleIds.length > 0 && enabledRoleIds.length <= normalizedCount) {
        const exactRoleIds = fillRolePlanWithoutVillager(enabledRoleIds, normalizedCount, basePlan, { maxWolfCount });

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

    const completedRoleIds = fillRolePlanWithoutVillager(plannedRoleIds, normalizedCount, basePlan, { maxWolfCount });

    return completedRoleIds.map(roleId => ROLE_DEFINITIONS[roleId]);
}

function createInitialState() {
    return {
        mode: 'werewolf',
        players: [],
        status: '',
        phase: 'lobby',
        phaseEndsAt: null,
        phaseTimerBufferMs: 0,
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
            witchPoisons: {},
            trackerScans: {},
            oracleReads: {},
            vigilanteShots: {},
            hunterShots: {},
            clericBlesses: {}
        },
        nightSkips: {},
        dayVotes: {},
        discussionSkips: {},
        dayActionUsedBy: {},
        pendingRevealActions: {},
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
        trackerUsed: false,
        trackerLastTargetId: null,
        trackerLastResult: null,
        oracleUsed: false,
        oracleLastTargetId: null,
        oracleLastResult: null,
        oracleHistory: [],
        vigilanteShotUsed: false,
        vigilanteLastTargetId: null,
        vigilanteLastResult: null,
        hunterShotUsed: false,
        hunterLastTargetId: null,
        hunterLastResult: null,
        clericBlessUsed: false,
        clericBlessTargetId: null,
        clericLastTargetId: null,
        clericLastResult: null,
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
        totalSubmittedVoteWeight: voterChoices.reduce((total, entry) => total + Number(entry.weight || 0), 0),
        leadingVoteWeight: targetSummaries.reduce((highest, target) => Math.max(highest, Number(target.count || 0)), 0),
        completedActors: Array.from(completedActors),
        pendingActors,
        totalAlive: alivePlayers.length,
        totalVoteWeight: getTotalDayVoteWeight(room),
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
    return getDaySkipVoteWeight(room) >= (Math.floor(getTotalDayVoteWeight(room) / 2) + 1);
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

function buildNightPublicEvent(player, cause) {
    if (!player) {
        return null;
    }

    let detail = `${player.name} ไม่รอดในคืนนี้`;
    if (cause === 'wolf-attack') {
        detail = `${player.name} ถูกหมาป่าฆ่าในตอนกลางคืน`;
    } else if (cause === 'witch-poison') {
        detail = `${player.name} ถูกแม่มดวางยาพิษในตอนกลางคืน`;
    } else if (cause === 'night-shot') {
        detail = `${player.name} ถูกยิงเสียชีวิตในตอนกลางคืน`;
    }

    return {
        playerId: player.playerId,
        playerName: player.name,
        cause,
        detail
    };
}

function applySeerVision(room, seerId, targetPlayerId) {
    const seer = getPlayer(room, seerId);
    const target = getPlayer(room, targetPlayerId);
    if (!seer || !target) {
        return null;
    }

    const reading = getSeerAlignment(target.role);
    const seenRole = `${target.name} · ${reading.label}`;
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

    return seenEntry;
}

function getOracleRoleReveal(roleId) {
    if (roleId === 'alphaWolf' || isFoolRole(roleId)) {
        return {
            roleId: 'unknown',
            roleLabel: 'ไม่ทราบ'
        };
    }

    const roleInfo = ROLE_DEFINITIONS[roleId];
    return {
        roleId: roleId || 'unknown',
        roleLabel: roleInfo?.thaiName || roleInfo?.name || 'ไม่ทราบ'
    };
}

function applyOracleVision(room, oracleId, targetPlayerId) {
    const oracle = getPlayer(room, oracleId);
    const target = getPlayer(room, targetPlayerId);
    if (!oracle || !target) {
        return null;
    }

    const reveal = getOracleRoleReveal(target.role);
    const seenEntry = {
        dayNumber: room.gameState.dayNumber || 1,
        targetPlayerId: target.playerId,
        targetName: target.name,
        roleId: reveal.roleId,
        roleLabel: reveal.roleLabel,
        summary: `${target.name} · ${reveal.roleLabel}`
    };

    oracle.oracleLastResult = {
        actorId: oracleId,
        targetId: target.playerId,
        targetName: target.name,
        roleId: reveal.roleId,
        roleLabel: reveal.roleLabel,
        dayNumber: seenEntry.dayNumber
    };
    oracle.oracleHistory = [
        seenEntry,
        ...(Array.isArray(oracle.oracleHistory) ? oracle.oracleHistory : []).filter(entry => Number(entry?.dayNumber) !== Number(seenEntry.dayNumber))
    ].slice(0, 12);

    return seenEntry;
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
        witchPoisons: {},
        trackerScans: {},
        oracleReads: {},
        vigilanteShots: {},
        hunterShots: {},
        clericBlesses: {}
    };
    room.gameState.nightSkips = {};
}

function resetDayState(room) {
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.pendingRevealActions = {};
    room.gameState.lastResolvedDay = null;
}

function ensureActionMaps(room) {
    if (!room?.gameState) {
        return;
    }

    const gameState = room.gameState;
    if (!gameState.nightActions || typeof gameState.nightActions !== 'object') {
        gameState.nightActions = {};
    }

    const nightActions = gameState.nightActions;
    const nightDefaults = {
        werewolfVotes: {},
        seerChecks: {},
        doctorSaves: {},
        bodyguardProtects: {},
        witchHeals: {},
        witchPoisons: {},
        trackerScans: {},
        oracleReads: {},
        vigilanteShots: {},
        hunterShots: {},
        clericBlesses: {}
    };

    Object.keys(nightDefaults).forEach(key => {
        if (!nightActions[key] || typeof nightActions[key] !== 'object') {
            nightActions[key] = {};
        }
    });

    if (!gameState.nightSkips || typeof gameState.nightSkips !== 'object') {
        gameState.nightSkips = {};
    }
    if (!gameState.dayVotes || typeof gameState.dayVotes !== 'object') {
        gameState.dayVotes = {};
    }
    if (!gameState.discussionSkips || typeof gameState.discussionSkips !== 'object') {
        gameState.discussionSkips = {};
    }
    if (!gameState.dayActionUsedBy || typeof gameState.dayActionUsedBy !== 'object') {
        gameState.dayActionUsedBy = {};
    }
    if (!gameState.pendingRevealActions || typeof gameState.pendingRevealActions !== 'object') {
        gameState.pendingRevealActions = {};
    }
    if (!gameState.lastProtectedByBodyguard || typeof gameState.lastProtectedByBodyguard !== 'object') {
        gameState.lastProtectedByBodyguard = {};
    }
}

function startNightPhase(room, incrementDay = true) {
    clearPlayerTransientState(room);
    resetNightActions(room);
    resetDayState(room);
    room.gameState.players.forEach(player => {
        player.trackerUsed = false;
        player.trackerLastTargetId = null;
        player.oracleUsed = false;
        player.oracleLastTargetId = null;
    });
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
    room.gameState.phaseTimerBufferMs = 14000;
    room.gameState.status = 'werewolf_day_discussion';
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.pendingRevealActions = {};
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
    room.gameState.lastResolvedDay = null;
    room.gameState.lastAction = Date.now();
    syncAlivePlayerIds(room);

    // ใช้น้ำหนักโหวตจริง (นายกเทศมนตรีเปิดตัว = 2 เสียง) ให้ตรงกับเกณฑ์ตอน resolveDayVote
    const voteThreshold = Math.floor(getTotalDayVoteWeight(room) / 2) + 1;
    if (trigger === 'consensus-skip') {
        pushHistory(room, `เสียงข้ามเกินครึ่ง ข้ามช่วงคุยของวันที่ ${room.gameState.dayNumber} เข้าสู่การโหวตทันที (ต้องการ ${voteThreshold} เสียงถึงจะไล่ออกได้)`, 'day');
    } else {
        pushHistory(room, `ช่วงคุยของวันที่ ${room.gameState.dayNumber} จบแล้ว เริ่มโหวต (ต้องการ ${voteThreshold} เสียงถึงจะไล่ออกได้)`, 'day');
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
        rolePlan: getRolePlan(room.players.length, room.settings, room.lastWerewolfPlanRoleIds || [])
    };
}

function assignRoles(room) {
    const roleIds = room.gameState.rolePlan.map(role => role.id);
    const players = room.gameState.players;

    // getRolePlan cap ไว้ที่ 10 บท ถ้าห้องมีคนมากกว่านั้น backtrack จะหาบทไม่พอ
    // แล้ว fallback แจก undefined ให้คนท้ายๆ แบบเงียบๆ (role/roleInfo เป็น undefined จน UI พัง)
    // เติม villager ให้ครบจำนวนคนไว้ก่อน กันไว้เผื่อวันหลังขยับ maxPlayers
    while (roleIds.length < players.length) {
        roleIds.push('villager');
    }

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
            oracleHistory: [],
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
    room.lastWerewolfPlanRoleIds = room.gameState.rolePlan.map(function(role) {
        return role.id;
    });
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
    const alivePlayers = getAlivePlayers(room);
    const aliveNonWerewolves = alivePlayers.filter(player => !isWerewolfRole(player.role));
    const aliveFools = alivePlayers.filter(player => player.role === 'fool');

    if (aliveFools.length === 1 && alivePlayers.length === 1) {
        room.gameState.phase = 'finished';
        room.gameState.phaseEndsAt = null;
        room.gameState.status = 'werewolf_finished';
        room.gameState.winner = 'fool';
        room.gameState.players.forEach(player => {
            player.revealedRole = player.roleInfo?.thaiName || player.role;
        });
        pushHistory(room, 'คนบ้าชนะแล้วแบบเดี่ยวหลังเป็นผู้รอดชีวิตคนสุดท้าย', 'result');
        return 'fool';
    }

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

    // ตัวตลกนับเป็น "ตัวโหวต" ฝั่งหมู่บ้านด้วย — ไม่งั้นหมาป่าชนะก่อนเวลาทั้งที่หมู่บ้านยังโหวตชนะได้
    // แต่ถ้าเหลือแค่ตัวตลก (หมาป่าฆ่าตัวตลกไม่ได้) ต้องจบเกมกันเกมค้างไม่มีวันจบ
    const aliveVillagersExcludingFool = aliveNonWerewolves.filter(player => player.role !== 'fool');
    if (aliveWerewolves.length >= aliveNonWerewolves.length || aliveVillagersExcludingFool.length === 0) {
        room.gameState.phase = 'finished';
        room.gameState.phaseEndsAt = null;
        room.gameState.status = 'werewolf_finished';
        room.gameState.winner = 'werewolf';
        room.gameState.players.forEach(player => {
            player.revealedRole = player.roleInfo?.thaiName || player.role;
        });
        pushHistory(
            room,
            aliveWerewolves.length >= aliveNonWerewolves.length
                ? 'หมาป่าชนะแล้ว จำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่เหลือ'
                : 'หมาป่าชนะแล้ว ฝั่งหมู่บ้านไม่เหลือกำลังพอจะต้านหมาป่าได้',
            'result'
        );
        return 'werewolf';
    }

    return null;
}

function getRequiredNightActors(room) {
    const roleIds = isFirstNight(room)
        ? ['seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'tracker', 'hunter', 'vigilante']
        : ['werewolf', 'alphaWolf', 'seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'tracker', 'hunter', 'vigilante'];

    return getAlivePlayers(room).filter(player => roleIds.includes(player.role));
}

function hasNightActionSubmitted(room, player) {
    if (!room?.gameState?.nightActions || !player) {
        return false;
    }

    const nightActions = room.gameState.nightActions || {};

    switch (player.role) {
        case 'werewolf':
        case 'alphaWolf':
            return !!nightActions.werewolfVotes?.[player.playerId];
        case 'seer':
            return !!nightActions.seerChecks?.[player.playerId];
        case 'oracle':
            return !!nightActions.oracleReads?.[player.playerId];
        case 'doctor':
            return player.doctorSaveUses >= 2 || !!nightActions.doctorSaves?.[player.playerId];
        case 'bodyguard':
            return player.bodyguardArmorBroken || !!nightActions.bodyguardProtects?.[player.playerId];
        case 'witch': {
            const healSubmitted = !!nightActions.witchHeals?.[player.playerId];
            const poisonSubmitted = !!nightActions.witchPoisons?.[player.playerId];
            return (player.witchHealUsed && player.witchPoisonUsed) || healSubmitted || poisonSubmitted;
        }
        case 'tracker':
            return !!nightActions.trackerScans?.[player.playerId];
        case 'vigilante':
            return !!nightActions.vigilanteShots?.[player.playerId];
        case 'hunter':
            return !!nightActions.hunterShots?.[player.playerId];
        case 'cleric':
            return true;
        default:
            return true;
    }
}

function hasAnyNightActionSelected(room) {
    return [
        room.gameState.nightActions.werewolfVotes,
        room.gameState.nightActions.seerChecks,
        room.gameState.nightActions.oracleReads,
        room.gameState.nightActions.doctorSaves,
        room.gameState.nightActions.bodyguardProtects,
        room.gameState.nightActions.witchHeals,
        room.gameState.nightActions.witchPoisons,
        room.gameState.nightActions.trackerScans,
        room.gameState.nightActions.vigilanteShots,
        room.gameState.nightActions.hunterShots,
        room.gameState.nightActions.clericBlesses
    ].some(actions => Object.values(actions || {}).some(targetId => !!targetId && targetId !== SKIP_TARGET_ID));
}

function getNightSkipCount(room) {
    return Object.keys(room.gameState.nightSkips || {}).filter(playerId => {
        const player = getPlayer(room, playerId);
        return !!player && player.alive !== false;
    }).length;
}

function canSkipNight(room) {
    const aliveCount = getAlivePlayers(room).length;
    const skipCount = getNightSkipCount(room);
    const required = Math.floor(aliveCount / 2) + 1;
    return skipCount >= required;
}

function haveAllRequiredNightActorsDecided(room) {
    return getRequiredNightActors(room).every(actor =>
        hasNightActionSubmitted(room, actor) || room.gameState.nightSkips?.[actor.playerId]
    );
}

function fillMissingNightActionsAsSkip(room) {
    if (!room?.gameState?.nightActions) {
        return;
    }

    const nightActions = room.gameState.nightActions;
    getRequiredNightActors(room).forEach(actor => {
        if (hasNightActionSubmitted(room, actor)) {
            return;
        }

        switch (actor.role) {
            case 'werewolf':
            case 'alphaWolf':
                nightActions.werewolfVotes[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'seer':
                nightActions.seerChecks[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'doctor':
                nightActions.doctorSaves[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'bodyguard':
                nightActions.bodyguardProtects[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'witch':
                if (!actor.witchHealUsed && !nightActions.witchHeals[actor.playerId] && !nightActions.witchPoisons[actor.playerId]) {
                    nightActions.witchHeals[actor.playerId] = SKIP_TARGET_ID;
                } else if (!actor.witchPoisonUsed && !nightActions.witchHeals[actor.playerId] && !nightActions.witchPoisons[actor.playerId]) {
                    nightActions.witchPoisons[actor.playerId] = SKIP_TARGET_ID;
                }
                break;
            case 'tracker':
                nightActions.trackerScans[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'oracle':
                nightActions.oracleReads[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'vigilante':
                nightActions.vigilanteShots[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'hunter':
                nightActions.hunterShots[actor.playerId] = SKIP_TARGET_ID;
                break;
            default:
                break;
        }
    });
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

function buildDayPublicEvent(type, payload = {}) {
    if (type === 'reveal-hit') {
        return {
            type,
            lead: `${payload.actorName || 'จอมเปิดโปง'} ชี้หน้า ${payload.targetName || 'เป้าหมาย'} ได้ตรงตัว`,
            detail: `พอเสียงนับถอยหลังจบ ${payload.targetName || 'เป้าหมาย'} ก็ล้มลงทันที เพราะถูกเปิดโปงว่าเป็นหมาป่า`
        };
    }

    if (type === 'reveal-miss') {
        return {
            type,
            lead: `${payload.actorName || 'จอมเปิดโปง'} ฝากชีวิตไว้กับการเปิดโปง แต่พลาด`,
            detail: `เมื่อหมดเวลา ${payload.actorName || 'จอมเปิดโปง'} กลับล้มลงแทน เพราะชี้ ${payload.targetName || 'เป้าหมาย'} ผิดคน`
        };
    }

    if (type === 'vote-elimination') {
        return {
            type,
            lead: `${payload.targetName || 'เป้าหมาย'} ถูกยกให้เป็นแพะของทั้งหมู่บ้าน`,
            detail: `เสียงโหวตเทไปทางเดียวกัน และ ${payload.targetName || 'เป้าหมาย'} ถูกลากออกจากวงประชุม`
        };
    }

    if (type === 'vote-no-elimination') {
        return {
            type,
            lead: 'วงโหวตปิดลง แต่ยังไม่มีใครถูกชี้เป็นคนผิด',
            detail: payload.reason || 'คะแนนยังไม่ขาดหรือเสมอกัน ทำให้วันนี้ไม่มีใครถูกลากออกจากเกม'
        };
    }

    if (type === 'skip-majority') {
        return {
            type,
            lead: 'เสียงส่วนใหญ่ขอปิดวันไว้แค่นี้',
            detail: 'ไม่มีใครถูกกำจัด และทั้งหมู่บ้านต้องกลับไปรอฟังเสียงจากความมืดอีกครั้ง'
        };
    }

    return null;
}

function resolvePendingRevealActions(room) {
    const events = [];

    Object.entries(room.gameState.pendingRevealActions || {}).forEach(([actorId, targetPlayerId]) => {
        const actor = getPlayer(room, actorId);
        const target = getPlayer(room, targetPlayerId);

        if (!actor || actor.alive === false || !target || target.alive === false) {
            return;
        }

        if (isWerewolfRole(target.role)) {
            markPlayerDead(target, 'ถูกจอมเปิดโปงจับได้ว่าเป็นหมาป่า');
            events.push(buildDayPublicEvent('reveal-hit', {
                actorName: actor.name,
                targetName: target.name
            }));
            pushHistory(room, `${actor.name} เปิดโปง ${target.name} สำเร็จ หมาป่าตายตอนหมดเวลา`, 'day');
            return;
        }

        markPlayerDead(actor, 'เปิดโปงผิดเป้าและตายแทน');
        events.push(buildDayPublicEvent('reveal-miss', {
            actorName: actor.name,
            targetName: target.name
        }));
        pushHistory(room, `${actor.name} เปิดโปงผิดเป้าและตายตอนหมดเวลา`, 'day');
    });

    room.gameState.pendingRevealActions = {};
    return events.filter(Boolean);
}

function resolveNight(room) {
    if (!room?.gameState) {
        return { resolved: false, winner: null };
    }

    const attackedPlayerId = getWeightedTarget(
        Object.fromEntries(Object.entries(room.gameState.nightActions.werewolfVotes || {}).filter(([, targetId]) => targetId && targetId !== SKIP_TARGET_ID)),
        room,
        { alphaWolf: 2 }
    );
    const protectedTargets = new Set([
        ...Object.values(room.gameState.nightActions.doctorSaves || {}),
        ...Object.values(room.gameState.nightActions.bodyguardProtects || {}),
        ...Object.values(room.gameState.nightActions.witchHeals || {}),
        // พรนักบวชถูกใช้ไปแล้วตอนกลางวัน — ต้องคุ้มครองแม้นักบวชตายก่อนถึงคืนนั้น
        ...room.gameState.players
            .filter(player => player.role === 'cleric' && player.clericBlessTargetId)
            .map(player => player.clericBlessTargetId)
    ].filter(targetId => targetId && targetId !== SKIP_TARGET_ID));
    const poisonedTargetIds = Array.from(new Set(
        Object.values(room.gameState.nightActions.witchPoisons || {})
            .filter(targetId => targetId && targetId !== SKIP_TARGET_ID)
    ));
    const bodyguardBreakIds = new Set();

    const attackedPlayer = attackedPlayerId ? getPlayer(room, attackedPlayerId) : null;
    const eliminatedPlayers = [];
    const publicEvents = [];
    let immuneTargetId = null;

    if (isFirstNight(room)) {
        pushHistory(room, 'คืนแรกผ่านไปแบบเงียบผิดปกติ หมาป่ายังออกล่าไม่ได้ คืนนี้จึงไม่มีใครตาย', 'night');
    } else if (attackedPlayer && attackedPlayer.role === 'fool') {
        immuneTargetId = attackedPlayerId;
        pushHistory(room, 'เมื่อคืนหมาป่าพยายามลงมือ แต่การสังหารไม่สำเร็จ', 'night');
    } else if (attackedPlayer && attackedPlayer.alive !== false && !protectedTargets.has(attackedPlayerId)) {
        markPlayerDead(attackedPlayer, 'ถูกหมาป่าโจมตีในตอนกลางคืน');
        eliminatedPlayers.push(attackedPlayer);
        publicEvents.push(buildNightPublicEvent(attackedPlayer, 'wolf-attack'));
        pushHistory(room, `${attackedPlayer.name} ถูกกำจัดในตอนกลางคืน`, 'night');
    } else if (attackedPlayer) {
        Object.entries(room.gameState.nightActions.bodyguardProtects || {}).forEach(([guardId, protectedId]) => {
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
        if (!target || target.alive === false || eliminatedPlayers.some(player => player.playerId === targetId) || protectedTargets.has(targetId)) {
            return;
        }

        markPlayerDead(target, 'ถูกแม่มดวางยาพิษในตอนกลางคืน');
        eliminatedPlayers.push(target);
        publicEvents.push(buildNightPublicEvent(target, 'witch-poison'));
        pushHistory(room, `${target.name} ถูกแม่มดวางยาพิษในตอนกลางคืน`, 'night');
    });

    Object.entries(room.gameState.nightActions.seerChecks || {}).forEach(([seerId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        applySeerVision(room, seerId, targetId);
    });

    Object.entries(room.gameState.nightActions.oracleReads || {}).forEach(([oracleId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        const oracle = getPlayer(room, oracleId);
        const target = getPlayer(room, targetId);
        if (!oracle || !target) {
            return;
        }
        applyOracleVision(room, oracleId, targetId);
    });

    Object.entries(room.gameState.nightActions.trackerScans || {}).forEach(([trackerId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        const tracker = getPlayer(room, trackerId);
        const target = getPlayer(room, targetId);
        if (!tracker || !target) {
            return;
        }
        tracker.trackerLastResult = {
            actorId: trackerId,
            targetId,
            targetName: target.name,
            acted: didPlayerUseNightSkill(room, target.playerId)
        };
    });

    Object.entries(room.gameState.nightActions.vigilanteShots || {}).forEach(([shotId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        const shooter = getPlayer(room, shotId);
        const target = getPlayer(room, targetId);
        if (!shooter || !target) {
            return;
        }
        // เผาสิทธิ์ตอน resolve (คนยิงคอมมิตเป้าจริงแล้ว) — เปลี่ยนเป้าได้เฉพาะก่อนปิดคืน
        shooter.vigilanteShotUsed = true;
        if (target.alive === false) {
            return;
        }
        if (protectedTargets.has(targetId)) {
            shooter.vigilanteLastResult = { actorId: shotId, targetId, targetName: target.name, blocked: true };
            pushHistory(room, 'เมื่อคืนมีเสียงปืนดังขึ้น แต่เป้าหมายถูกปกป้องไว้ ไม่มีใครตายจากกระสุนนัดนี้', 'night');
            return;
        }
        markPlayerDead(target, 'ถูกศาลเตี้ยยิงตอนกลางคืน');
        eliminatedPlayers.push(target);
        publicEvents.push(buildNightPublicEvent(target, 'night-shot'));
        shooter.vigilanteLastResult = { actorId: shotId, targetId, targetName: target.name };
    });

    Object.entries(room.gameState.nightActions.hunterShots || {}).forEach(([shotId, targetId]) => {
        if (!targetId || targetId === SKIP_TARGET_ID) {
            return;
        }
        const hunter = getPlayer(room, shotId);
        const target = getPlayer(room, targetId);
        if (!hunter || !target) {
            return;
        }
        // เผาสิทธิ์ตอน resolve (คนยิงคอมมิตเป้าจริงแล้ว) — เปลี่ยนเป้าได้เฉพาะก่อนปิดคืน
        hunter.hunterShotUsed = true;
        if (target.alive === false) {
            return;
        }
        if (protectedTargets.has(targetId)) {
            hunter.hunterLastResult = { actorId: shotId, targetId, targetName: target.name, blocked: true };
            pushHistory(room, 'เมื่อคืนมีเสียงปืนดังขึ้น แต่เป้าหมายถูกปกป้องไว้ ไม่มีใครตายจากกระสุนนัดนี้', 'night');
            return;
        }
        markPlayerDead(target, 'ถูกพรานยิงตอนกลางคืน');
        eliminatedPlayers.push(target);
        publicEvents.push(buildNightPublicEvent(target, 'night-shot'));
        hunter.hunterLastResult = { actorId: shotId, targetId, targetName: target.name };
    });

    room.gameState.players
        .filter(player => player.role === 'cleric' && player.clericBlessTargetId)
        .forEach(cleric => {
            const target = getPlayer(room, cleric.clericBlessTargetId);
            if (!target) {
                return;
            }
            cleric.clericLastResult = {
                actorId: cleric.playerId,
                targetId: target.playerId,
                targetName: target.name
            };
            cleric.clericBlessTargetId = null;
        });

    Object.entries(room.gameState.nightActions.bodyguardProtects || {}).forEach(([guardId, protectedId]) => {
        if (protectedId && protectedId !== SKIP_TARGET_ID) {
            room.gameState.lastProtectedByBodyguard[guardId] = protectedId;
        } else {
            delete room.gameState.lastProtectedByBodyguard[guardId];
        }
    });

    room.gameState.players.forEach(player => {
        const doctorTargetId = room.gameState.nightActions.doctorSaves?.[player.playerId];
        const healTargetId = room.gameState.nightActions.witchHeals?.[player.playerId];
        const poisonTargetId = room.gameState.nightActions.witchPoisons?.[player.playerId];

        if (player.role === 'doctor' && doctorTargetId && doctorTargetId !== SKIP_TARGET_ID) {
            player.doctorSaveUses = Number(player.doctorSaveUses || 0) + 1;
            delete room.gameState.nightActions.doctorSaves[player.playerId];
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
        publicEvents: publicEvents.filter(Boolean),
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
    const aliveCount = getAlivePlayers(room).length;
    const required = Math.floor(aliveCount / 2) + 1;
    return getDiscussionSkipCount(room) >= required;
}

function getCompletedDayActorIds(room) {
    const dayVotes = room?.gameState?.dayVotes || {};
    const dayActionUsedBy = room?.gameState?.dayActionUsedBy || {};
    return new Set([
        ...Object.keys(dayVotes),
        ...Object.keys(dayActionUsedBy).filter(playerId => dayActionUsedBy[playerId])
    ]);
}

function isPlayerOnlineInRoom(room, playerId) {
    const roomPlayer = room?.players?.find(player => player.playerId === playerId);
    if (roomPlayer) {
        return !!roomPlayer.socketId;
    }

    const gameStatePlayer = getPlayer(room, playerId);
    return !!gameStatePlayer?.socketId;
}

function canResolveDay(room) {
    const completedActors = getCompletedDayActorIds(room);
    return getAlivePlayers(room).every(player => {
        return completedActors.has(player.playerId) || !isPlayerOnlineInRoom(room, player.playerId);
    });
}

function didPlayerUseNightSkill(room, playerId) {
    const player = getPlayer(room, playerId);
    if (!player) {
        return false;
    }

    return hasNightRoleAction(room, player.role, playerId);
}

function hasNightRoleAction(room, roleId, actorId) {
    if (!room?.gameState?.nightActions) {
        return false;
    }

    const nightActions = room.gameState.nightActions;
    // การกดข้าม (SKIP) ไม่นับว่า "ใช้สกิล" — ไม่งั้นนักสอดแนมได้ข่าวกรองผิด
    const isRealChoice = value => !!value && value !== SKIP_TARGET_ID;

    switch (roleId) {
        case 'werewolf':
        case 'alphaWolf':
            return isRealChoice(nightActions.werewolfVotes?.[actorId]);
        case 'seer':
            return isRealChoice(nightActions.seerChecks?.[actorId]);
        case 'oracle':
            return isRealChoice(nightActions.oracleReads?.[actorId]);
        case 'doctor':
            return isRealChoice(nightActions.doctorSaves?.[actorId]);
        case 'bodyguard':
            return isRealChoice(nightActions.bodyguardProtects?.[actorId]);
        case 'witch':
            return isRealChoice(nightActions.witchHeals?.[actorId]) || isRealChoice(nightActions.witchPoisons?.[actorId]);
        case 'tracker':
            return isRealChoice(nightActions.trackerScans?.[actorId]);
        case 'vigilante':
            return isRealChoice(nightActions.vigilanteShots?.[actorId]);
        case 'hunter':
            return isRealChoice(nightActions.hunterShots?.[actorId]);
        case 'cleric':
            return false;
        default:
            return false;
    }
}

function submitClericBless(room, actorId, targetPlayerId) {
    if (room.gameState.phase !== 'day-discussion') {
        throw new Error('นักบวชใช้พรได้ตอนประชุมเช้าเท่านั้น');
    }

    const actor = getPlayer(room, actorId);
    const target = getPlayer(room, targetPlayerId);

    if (!actor || actor.alive === false || actor.role !== 'cleric') {
        throw new Error('เฉพาะนักบวชเท่านั้นที่ใช้พรได้');
    }

    if (actor.clericBlessUsed) {
        throw new Error('นักบวชใช้พรไปแล้ว');
    }

    if (!target || target.alive === false || actorId === targetPlayerId) {
        throw new Error('นักบวชมอบพรให้ตัวเองไม่ได้');
    }

    actor.clericBlessUsed = true;
    actor.clericBlessTargetId = targetPlayerId;
    actor.clericLastTargetId = targetPlayerId;
    actor.clericLastResult = {
        actorId,
        targetId: targetPlayerId,
        targetName: target.name
    };
    room.gameState.lastAction = Date.now();

    return {
        resolved: false,
        clericBlessResult: actor.clericLastResult
    };
}

function resolveDayVote(room) {
    const publicEvents = resolvePendingRevealActions(room);
    syncAlivePlayerIds(room);

    if (checkWinCondition(room)) {
        room.gameState.lastResolvedDay = {
            eliminatedPlayerId: null,
            resolutionType: publicEvents[0]?.type || null,
            publicEvents
        };
        return { resolved: true, winner: room.gameState.winner };
    }

    if (canSkipDayVote(room)) {
        room.gameState.lastResolvedDay = {
            eliminatedPlayerId: null,
            resolutionType: 'skip-majority',
            skippedByMajority: true,
            skipVoteWeight: getDaySkipVoteWeight(room),
            publicEvents: [...publicEvents, buildDayPublicEvent('skip-majority')].filter(Boolean)
        };
        pushHistory(room, 'เสียงข้ามโหวตเกินครึ่ง วันจึงถูกข้ามทันทีและเกมเข้าสู่กลางคืน', 'day');
        startNightPhase(room);
        return { resolved: true, winner: null };
    }

    const voteThreshold = Math.floor(getTotalDayVoteWeight(room) / 2) + 1;
    const dayVoteTallies = getDayVoteTallies(room);
    const rankedTargets = Object.entries(dayVoteTallies).sort((a, b) => b[1] - a[1]);
    const hasValidTarget = rankedTargets.length > 0
        && rankedTargets[0][1] >= voteThreshold
        && (rankedTargets.length === 1 || rankedTargets[0][1] > rankedTargets[1][1]);
    const eliminatedPlayerId = hasValidTarget ? rankedTargets[0][0] : null;
    const eliminatedPlayer = eliminatedPlayerId ? getPlayer(room, eliminatedPlayerId) : null;

    if (eliminatedPlayer && eliminatedPlayer.alive !== false) {
        markPlayerDead(eliminatedPlayer, 'ถูกโหวตออกในเวลากลางวัน');
        publicEvents.push(buildDayPublicEvent('vote-elimination', {
            targetName: eliminatedPlayer.name
        }));
        pushHistory(room, `${eliminatedPlayer.name} ถูกโหวตออกจากหมู่บ้าน`, 'day');

        if (eliminatedPlayer.role === 'fool') {
            room.gameState.phase = 'finished';
            room.gameState.phaseEndsAt = null;
            room.gameState.status = 'werewolf_finished';
            room.gameState.winner = 'fool';
            room.gameState.players.forEach(player => {
                player.revealedRole = player.roleInfo?.thaiName || player.role;
            });
            room.gameState.lastResolvedDay = {
                eliminatedPlayerId: eliminatedPlayer.playerId,
                resolutionType: 'vote-elimination',
                publicEvents,
            };
            syncAlivePlayerIds(room);
            pushHistory(room, `${eliminatedPlayer.name} คือคนบ้า และชนะคนเดียวทันทีหลังถูกโหวตออก`, 'result');
            return { resolved: true, winner: room.gameState.winner };
        }
    } else if (rankedTargets.length > 0 && rankedTargets[0][1] < voteThreshold) {
        publicEvents.push(buildDayPublicEvent('vote-no-elimination', {
            reason: `คะแนนโหวตไม่ถึงเกณฑ์ ${voteThreshold} เสียง`
        }));
        pushHistory(room, `การโหวตวันนี้ไม่ถึงเกณฑ์ ${voteThreshold} เสียง ไม่มีใครถูกกำจัด`, 'day');
    } else if (rankedTargets.length > 1 && rankedTargets[0][1] === rankedTargets[1][1]) {
        publicEvents.push(buildDayPublicEvent('vote-no-elimination', {
            reason: 'คะแนนโหวตเสมอกัน ทำให้ไม่มีใครถูกกำจัด'
        }));
        pushHistory(room, 'การโหวตวันนี้เสมอกัน ไม่มีใครถูกกำจัด', 'day');
    } else {
        publicEvents.push(buildDayPublicEvent('vote-no-elimination', {
            reason: 'ไม่มีใครถูกเลือกในการโหวตวันนี้'
        }));
        pushHistory(room, 'การโหวตวันนี้ไม่มีใครถูกเลือก', 'day');
    }

    room.gameState.lastResolvedDay = {
        eliminatedPlayerId: eliminatedPlayer?.playerId || null,
        resolutionType: eliminatedPlayer ? 'vote-elimination' : 'vote-no-elimination',
        skippedByMajority: false,
        skipVoteWeight: getDaySkipVoteWeight(room),
        publicEvents
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

    ensureActionMaps(room);

    const actor = getPlayer(room, actorId);
    const isSkip = targetPlayerId === SKIP_TARGET_ID;
    const target = isSkip ? null : getPlayer(room, targetPlayerId);

    if (!actor || actor.alive === false) {
        throw new Error('ผู้เล่นนี้ไม่สามารถใช้สกิลได้');
    }

    if (!isSkip && (!target || target.alive === false)) {
        throw new Error('เป้าหมายไม่ถูกต้อง');
    }

    let seerResult = null;
    let oracleResult = null;

    switch (actor.role) {
        case 'werewolf':
        case 'alphaWolf':
            if (isFirstNight(room) && !isSkip) {
                throw new Error('คืนแรกหมาป่ายังออกล่าไม่ได้');
            }
            if (room.gameState.nightActions.werewolfVotes[actorId] === targetPlayerId) {
                delete room.gameState.nightActions.werewolfVotes[actorId];
                delete room.gameState.nightSkips[actorId];
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
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
                throw new Error('ผู้หยั่งรู้ดูได้แค่ 1 คนต่อคืน');
            }
            if (isSkip) {
                room.gameState.nightActions.seerChecks[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('ผู้หยั่งรู้ตรวจตัวเองไม่ได้');
            }
            room.gameState.nightActions.seerChecks[actorId] = targetPlayerId;
            seerResult = applySeerVision(room, actorId, targetPlayerId);
            break;
        case 'oracle':
            if (room.gameState.nightActions.oracleReads[actorId]) {
                throw new Error('นักพยากรณ์ดูได้แค่ 1 คนต่อคืน');
            }
            if (isSkip) {
                room.gameState.nightActions.oracleReads[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('นักพยากรณ์ตรวจตัวเองไม่ได้');
            }
            room.gameState.nightActions.oracleReads[actorId] = targetPlayerId;
            oracleResult = applyOracleVision(room, actorId, targetPlayerId);
            actor.oracleUsed = true;
            actor.oracleLastTargetId = targetPlayerId;
            break;
        case 'doctor':
            if (actor.doctorSaveUses >= 2) {
                throw new Error('หมอปกป้องได้รวม 2 ครั้งต่อเกมเท่านั้น');
            }
            if (room.gameState.nightActions.doctorSaves[actorId] === targetPlayerId) {
                delete room.gameState.nightActions.doctorSaves[actorId];
                delete room.gameState.nightSkips[actorId];
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
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
            if (room.gameState.nightActions.bodyguardProtects[actorId] === targetPlayerId) {
                delete room.gameState.nightActions.bodyguardProtects[actorId];
                delete room.gameState.nightSkips[actorId];
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
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
            if (actionType === 'witch-heal') {
                if (actor.witchHealUsed) {
                    throw new Error('คุณใช้ยาช่วยชีวิตไปแล้ว');
                }
                if (room.gameState.nightActions.witchPoisons[actorId]) {
                    throw new Error('คืนนี้แม่มดใช้ได้แค่ 1 สกิลต่อคืน');
                }
                if (room.gameState.nightActions.witchHeals[actorId] === targetPlayerId) {
                    delete room.gameState.nightActions.witchHeals[actorId];
                    delete room.gameState.nightSkips[actorId];
                    room.gameState.lastAction = Date.now();
                    return { resolved: false, unvoted: true };
                }
                room.gameState.nightActions.witchHeals[actorId] = isSkip ? SKIP_TARGET_ID : targetPlayerId;
                break;
            }

            if (actionType === 'witch-poison') {
                if (actor.witchPoisonUsed) {
                    throw new Error('คุณใช้ยาพิษไปแล้ว');
                }
                if (room.gameState.nightActions.witchHeals[actorId]) {
                    throw new Error('คืนนี้แม่มดใช้ได้แค่ 1 สกิลต่อคืน');
                }
                if (!isSkip && actorId === targetPlayerId) {
                    throw new Error('แม่มดวางยาพิษตัวเองไม่ได้');
                }
                if (room.gameState.nightActions.witchPoisons[actorId] === targetPlayerId) {
                    delete room.gameState.nightActions.witchPoisons[actorId];
                    delete room.gameState.nightSkips[actorId];
                    room.gameState.lastAction = Date.now();
                    return { resolved: false, unvoted: true };
                }
                room.gameState.nightActions.witchPoisons[actorId] = isSkip ? SKIP_TARGET_ID : targetPlayerId;
                break;
            }

            throw new Error('แม่มดต้องเลือกว่าจะใช้ยาช่วยชีวิตหรือยาพิษ');
        case 'tracker':
            if (room.gameState.nightActions.trackerScans[actorId]) {
                throw new Error('นักสอดแนมดูได้แค่ 1 คนต่อคืน');
            }
            if (isSkip) {
                room.gameState.nightActions.trackerScans[actorId] = SKIP_TARGET_ID;
                break;
            }
            room.gameState.nightActions.trackerScans[actorId] = targetPlayerId;
            actor.trackerUsed = true;
            actor.trackerLastTargetId = targetPlayerId;
            // ผล "เป้าหมายใช้สกิลคืนนี้ไหม" ต้องสรุปหลังทุกคนลงมือครบใน resolveNight
            // ถ้าคำนวณตอน submit แล้ว tracker กดก่อนคนอื่น จะได้ค่าผิด (เห็นว่า "ไม่ได้ใช้")
            actor.trackerLastResult = null;
            break;
        case 'vigilante':
            if (actor.vigilanteShotUsed) {
                throw new Error('คุณใช้สิทธิ์ยิงไปแล้ว');
            }
            // เลือกเป้าเดิมซ้ำ = ยกเลิก (เปลี่ยน/ถอนเป้าได้ก่อนปิดคืน)
            if (room.gameState.nightActions.vigilanteShots[actorId] === targetPlayerId) {
                delete room.gameState.nightActions.vigilanteShots[actorId];
                delete room.gameState.nightSkips[actorId];
                actor.vigilanteLastTargetId = null;
                actor.vigilanteLastResult = null;
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
            }
            if (isSkip) {
                room.gameState.nightActions.vigilanteShots[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('ศาลเตี้ยยิงตัวเองไม่ได้');
            }
            room.gameState.nightActions.vigilanteShots[actorId] = targetPlayerId;
            // ยังไม่ "เผาสิทธิ์" จนกว่าจะ resolve กลางคืน เพื่อกันเผลอคลิกแล้วเสียสิทธิ์ถาวร
            actor.vigilanteLastTargetId = targetPlayerId;
            actor.vigilanteLastResult = { actorId, targetId: targetPlayerId, targetName: target.name };
            break;
        case 'hunter':
            if (actor.hunterShotUsed) {
                throw new Error('พรานใช้สิทธิ์ยิงไปแล้ว');
            }
            // เลือกเป้าเดิมซ้ำ = ยกเลิก (เปลี่ยน/ถอนเป้าได้ก่อนปิดคืน)
            if (room.gameState.nightActions.hunterShots[actorId] === targetPlayerId) {
                delete room.gameState.nightActions.hunterShots[actorId];
                delete room.gameState.nightSkips[actorId];
                actor.hunterLastTargetId = null;
                actor.hunterLastResult = null;
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
            }
            if (isSkip) {
                room.gameState.nightActions.hunterShots[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('พรานยิงตัวเองไม่ได้');
            }
            room.gameState.nightActions.hunterShots[actorId] = targetPlayerId;
            // ยังไม่ "เผาสิทธิ์" จนกว่าจะ resolve กลางคืน
            actor.hunterLastTargetId = targetPlayerId;
            actor.hunterLastResult = { actorId, targetId: targetPlayerId, targetName: target.name };
            break;
        case 'cleric':
            throw new Error('นักบวชใช้พรได้ตอนประชุมเช้าเท่านั้น');
        default:
            throw new Error('บทบาทนี้ไม่มีสกิลกลางคืน');
    }

    room.gameState.lastAction = Date.now();

    return {
        resolved: false,
        seerResult,
        oracleResult
    };
}

function submitNightSkip(room, actorId) {
    if (room.gameState.phase !== 'night') {
        throw new Error('ยังไม่ใช่ช่วงกลางคืน');
    }

    ensureActionMaps(room);

    const actor = getPlayer(room, actorId);
    if (!actor || actor.alive === false) {
        throw new Error('ผู้เล่นนี้ไม่สามารถกดข้ามได้');
    }

    room.gameState.nightSkips[actorId] = true;
    room.gameState.lastAction = Date.now();

    if (canSkipNight(room) && haveAllRequiredNightActorsDecided(room)) {
        pushHistory(room, 'เสียงพร้อมข้ามกลางคืนเกินครึ่ง และทุกบทบาทที่ต้องลงมือตัดสินใจแล้ว จึงเข้าสู่ตอนเช้า', 'night');
        return {
            ...resolveNight(room),
            skippedToMorning: true,
            skipCount: getNightSkipCount(room),
            totalAlive: getAlivePlayers(room).length,
            skipNeeded: Math.floor(getAlivePlayers(room).length / 2) + 1
        };
    }

    return {
        resolved: false,
        skippedToMorning: false,
        waitingForRequiredRoles: canSkipNight(room) && !haveAllRequiredNightActorsDecided(room),
        skipCount: getNightSkipCount(room),
        totalAlive: getAlivePlayers(room).length,
        skipNeeded: Math.floor(getAlivePlayers(room).length / 2) + 1
    };
}

function submitDayVote(room, actorId, targetPlayerId) {
    if (room.gameState.phase !== 'day-vote') {
        throw new Error('ยังไม่ใช่ช่วงโหวตกลางวัน');
    }

    ensureActionMaps(room);

    const actor = getPlayer(room, actorId);
    const isSkip = targetPlayerId === SKIP_TARGET_ID;
    const target = isSkip ? null : getPlayer(room, targetPlayerId);

    if (!actor || actor.alive === false) {
        throw new Error('ผู้เล่นนี้ไม่สามารถโหวตได้');
    }

    if (!isSkip && (!target || target.alive === false || actorId === targetPlayerId)) {
        throw new Error('เป้าหมายการโหวตไม่ถูกต้อง');
    }

    if (room.gameState.dayActionUsedBy?.[actorId]) {
        throw new Error('คุณใช้สกิลตอนกลางวันไปแล้ว จึงโหวตเพิ่มไม่ได้');
    }

    if (room.gameState.dayVotes[actorId] === targetPlayerId) {
        delete room.gameState.dayVotes[actorId];
        room.gameState.lastAction = Date.now();
        return { resolved: false, unvoted: true };
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

    ensureActionMaps(room);

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
    if (room.gameState.phase !== 'day-discussion' && room.gameState.phase !== 'day-vote') {
        throw new Error('สกิลเปิดโปงใช้ได้เฉพาะตอนกลางวัน');
    }

    ensureActionMaps(room);

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
    room.gameState.pendingRevealActions[actorId] = targetPlayerId;
    delete room.gameState.dayVotes?.[actorId];
    room.gameState.lastAction = Date.now();

    if (room.gameState.phase === 'day-vote' && canResolveDay(room)) {
        return {
            ...resolveDayVote(room),
            queued: true,
            revealTargetId: target.playerId,
            revealTargetName: target.name
        };
    }

    return {
        resolved: false,
        queued: true,
        revealTargetId: target.playerId,
        revealTargetName: target.name
    };
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
                    applySeerVision(room, actor.playerId, target.playerId);
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
            case 'oracle':
                // บทข้อมูล: ถ้าไม่ทันเลือก ให้ข้าม (ไม่บังคับอ่านสุ่ม)
                room.gameState.nightActions.oracleReads[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'tracker':
                room.gameState.nightActions.trackerScans[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'vigilante':
                // บทยิง: ไม่ยิงสุ่มเองเพื่อกันฆ่าพลาด ให้ข้ามถ้า AFK
                room.gameState.nightActions.vigilanteShots[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'hunter':
                room.gameState.nightActions.hunterShots[actor.playerId] = SKIP_TARGET_ID;
                break;
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
    if (room?.gameState?.winner) {
        return { resolved: true, winner: room.gameState.winner, autoResolved: true };
    }

    ensureActionMaps(room);

    if (room?.gameState?.phase === 'night') {
        fillMissingNightActions(room);
        const result = resolveNight(room);
        if (result && typeof result === 'object') {
            result.autoResolved = true;
        }
        return result;
    }

    if (room?.gameState?.phase === 'day-discussion') {
        startDayPhase(room, 'timeout');
        return { resolved: true, winner: null, autoResolved: true, skippedToVote: true };
    }

    if (room?.gameState?.phase === 'day-vote') {
        fillMissingDayVotes(room);
        if (canResolveDay(room)) {
            const result = resolveDayVote(room);
            if (result && typeof result === 'object') {
                result.autoResolved = true;
            }
            return result;
        }
    }

    return { resolved: false, autoResolved: true };
}

function getNightActionOptions(room, viewer) {
    if (!viewer || viewer.alive === false || room.gameState.phase !== 'night') {
        return [];
    }

    const nightActions = room?.gameState?.nightActions || {
        werewolfVotes: {},
        seerChecks: {},
        oracleReads: {},
        doctorSaves: {},
        bodyguardProtects: {},
        witchHeals: {},
        witchPoisons: {},
        trackerScans: {},
        vigilanteShots: {},
        hunterShots: {},
        clericBlesses: {}
    };
    const alivePlayers = getAlivePlayers(room);
    switch (viewer.role) {
        case 'werewolf':
        case 'alphaWolf':
            if (isFirstNight(room)) {
                return [{
                    type: 'night-kill',
                    label: 'คืนแรกของหมาป่า',
                    description: 'คืนนี้หมาป่ายังไม่ออกล่า — กดการ์ด «ไม่ใช้สกิลคืนนี้» เพื่อผ่านคืนแรก แล้วไปอ่านเกมต่อในตอนเช้า',
                    selectedTargetId: nightActions.werewolfVotes?.[viewer.playerId] || null,
                    allowSkip: true,
                    emptyStateText: 'คืนนี้ยังไม่มีเหยื่อให้เลือก คืนแรกจะผ่านไปแบบไม่มีคนตายจากหมาป่า',
                    targets: []
                }];
            }
            return [{
                type: 'night-kill',
                label: viewer.role === 'alphaWolf' ? 'เลือกเหยื่อของอัลฟ่า' : 'เลือกเหยื่อของหมาป่า',
                description: 'เลือกเหยื่อ 1 คนในคืนนี้',
                selectedTargetId: nightActions.werewolfVotes?.[viewer.playerId] || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => !isWerewolfRole(player.role)).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        case 'seer':
            if (nightActions.seerChecks?.[viewer.playerId]) {
                return [{
                    type: 'seer-check',
                    label: 'ตรวจสอบบทบาทแล้วคืนนี้',
                    description: 'คืนนี้คุณเห็นผลตรวจแล้ว รอให้คนอื่นเล่นจบก่อนเช้า',
                    selectedTargetId: nightActions.seerChecks?.[viewer.playerId],
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
                label: 'ตรวจออร่า',
                description: 'เลือก 1 คนเพื่อดูว่า ดี, ไม่ดี หรือ ไม่ทราบ',
                selectedTargetId: nightActions.seerChecks?.[viewer.playerId] || null,
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
                selectedTargetId: nightActions.doctorSaves?.[viewer.playerId] || null,
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
            const targets = previousTarget
                ? alivePlayers.filter(player => player.playerId !== previousTarget)
                : alivePlayers;

            return [{
                type: 'bodyguard-protect',
                label: 'ปกป้อง',
                description: previousTarget ? 'เลือกได้ทั้งตัวเองหรือคนอื่น แต่ห้ามเลือกคนเดิมสองคืนติดกัน' : 'เลือกได้ทั้งตัวเองหรือคนอื่น ถ้ากันการโจมตีสำเร็จเกราะจะพังทันที',
                selectedTargetId: nightActions.bodyguardProtects?.[viewer.playerId] || null,
                allowSkip: true,
                targets: targets.map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        case 'tracker': {
            if (viewer.trackerUsed) {
                return [{
                    type: 'tracker-scan',
                    label: 'ตรวจร่องรอยแล้ว',
                    description: 'คืนนี้คุณใช้สกิลไปแล้ว รอผลตอนเช้า',
                    selectedTargetId: viewer.trackerLastTargetId || null,
                    allowSkip: false,
                    locked: true,
                    targets: []
                }];
            }
            return [{
                type: 'tracker-scan',
                label: 'ตรวจร่องรอย',
                description: 'เลือก 1 คนเพื่อดูว่าเขาใช้สกิลในคืนนี้หรือไม่',
                selectedTargetId: viewer.trackerLastTargetId || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        case 'oracle': {
            if (viewer.oracleUsed) {
                return [{
                    type: 'oracle-read',
                    label: 'ตรวจแล้วคืนนี้',
                    description: 'คืนนี้คุณใช้สกิลไปแล้ว',
                    selectedTargetId: viewer.oracleLastTargetId || null,
                    allowSkip: false,
                    locked: true,
                    targets: []
                }];
            }
            return [{
                type: 'oracle-read',
                label: 'ตรวจ',
                description: 'เลือก 1 คนเพื่อตรวจในคืนนี้ ระบบจะบอกบทบาทจริงทันทีและเก็บในประวัติ',
                selectedTargetId: viewer.oracleLastTargetId || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        case 'vigilante': {
            if (viewer.vigilanteShotUsed) {
                return [{
                    type: 'vigilante-shot',
                    label: 'ยิงไปแล้วทั้งเกม',
                    description: 'คุณใช้สิทธิ์ยิงไปแล้ว จึงทำอะไรเพิ่มไม่ได้',
                    selectedTargetId: null,
                    allowSkip: false,
                    emptyStateText: 'คุณยิงไปแล้ว',
                    targets: []
                }];
            }
            return [{
                type: 'vigilante-shot',
                label: 'ยิงเป้า',
                description: 'เลือก 1 คนเพื่อยิง (1 ครั้งตลอดเกม) เปลี่ยน/ยกเลิกเป้าได้จนกว่าคืนจะจบ แตะเป้าเดิมซ้ำเพื่อยกเลิก',
                selectedTargetId: nightActions.vigilanteShots?.[viewer.playerId] || viewer.vigilanteLastTargetId || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        case 'hunter': {
            if (viewer.hunterShotUsed) {
                return [{
                    type: 'hunter-shot',
                    label: 'ยิงไปแล้วทั้งเกม',
                    description: 'คุณใช้สิทธิ์ยิงของพรานไปแล้ว คืนนี้ไม่มีสกิลเพิ่ม',
                    selectedTargetId: null,
                    allowSkip: false,
                    emptyStateText: 'คุณใช้สิทธิ์ยิงแล้ว',
                    targets: []
                }];
            }
            return [{
                type: 'hunter-shot',
                label: 'ล็อกเป้ายิง (พราน)',
                description: 'เลือก 1 คนตอนกลางคืน (1 ครั้งตลอดเกม) เปลี่ยน/ยกเลิกเป้าได้จนกว่าคืนจะจบ — ถ้าล็อกเป้าไว้แล้วคุณตายในคืนเดียวกัน ลูกธนูยังออกตามที่เลือก',
                selectedTargetId: nightActions.hunterShots?.[viewer.playerId] || viewer.hunterLastTargetId || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
        }
        case 'witch': {
            const selectedHealTargetId = nightActions.witchHeals?.[viewer.playerId] || null;
            const selectedPoisonTargetId = nightActions.witchPoisons?.[viewer.playerId] || null;
            const actions = [];

            if (selectedHealTargetId || selectedPoisonTargetId) {
                const selectedType = selectedPoisonTargetId ? 'witch-poison' : 'witch-heal';
                const selectedTargetId = selectedPoisonTargetId || selectedHealTargetId;
                return [{
                    type: selectedType,
                    label: selectedType === 'witch-poison' ? 'คืนนี้คุณเลือกใช้ยาพิษแล้ว' : 'คืนนี้คุณเลือกใช้ยาช่วยชีวิตแล้ว',
                    description: 'แม่มดใช้ได้เพียง 1 สกิลต่อคืน ถ้าจะเปลี่ยนใจ เลือกเป้าหมายใหม่ในสกิลเดิม หรือกดเป้าเดิมซ้ำเพื่อยกเลิก',
                    selectedTargetId,
                    allowSkip: true,
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
                    label: 'ยาช่วยชีวิตของแม่มด',
                    description: 'เลือก 1 คนเพื่อกันตายในคืนนี้ ใช้ได้ 1 ครั้งตลอดเกม และคืนนี้จะใช้สกิลอื่นเพิ่มไม่ได้',
                    selectedTargetId: nightActions.witchHeals?.[viewer.playerId] || null,
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
                    selectedTargetId: nightActions.witchPoisons?.[viewer.playerId] || null,
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
                    description: 'คุณใช้ทั้งยาช่วยชีวิตและยาพิษไปครบแล้ว คืนนี้จึงไม่มีสกิลให้กดใช้',
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

function getNightActionState(room, viewer) {
    const totalAlive = getAlivePlayers(room).length;
    const skipCount = getNightSkipCount(room);
    const skipNeeded = Math.floor(totalAlive / 2) + 1;
    const hasSkipped = !!room.gameState.nightSkips?.[viewer?.playerId];

    if (!viewer || viewer.alive === false || room.gameState.phase !== 'night') {
        return {
            canSkip: false,
            hasSkipped: false,
            skipCount,
            totalAlive,
            skipNeeded
        };
    }

    return {
        canSkip: !hasSkipped,
        hasSkipped,
        skipCount,
        totalAlive,
        skipNeeded
    };
}

function getDayActionOptions(room, viewer) {
    if (!viewer || viewer.alive === false || room.gameState.phase !== 'day-vote') {
        const aliveCount = getAlivePlayers(room).length;
        const dayActions = room?.gameState?.dayActionUsedBy || {};
        const pendingRevealTargetId = viewer ? room.gameState.pendingRevealActions?.[viewer.playerId] || null : null;
        const pendingRevealTarget = pendingRevealTargetId ? getPlayer(room, pendingRevealTargetId) : null;
        return {
            canVote: false,
            selectedVoteTargetId: null,
            voteTargets: [],
            voteTallies: getDayVoteTallies(room),
            dayVoteSummary: room.gameState.phase === 'day-vote' ? buildDayVoteSummary(room) : null,
            skipVoteWeight: getDaySkipVoteWeight(room),
            totalVoteWeight: getTotalDayVoteWeight(room),
            completedVotes: Object.keys(room.gameState.dayVotes || {}).length,
            totalVoters: aliveCount,
            voteThreshold: Math.floor(getTotalDayVoteWeight(room) / 2) + 1,
            canReveal: false,
            revealUsed: !!viewer?.revealerUsed,
            revealTargets: [],
            pendingRevealTargetId,
            pendingRevealTargetName: pendingRevealTarget?.name || null
        };
    }

    const targets = getAlivePlayers(room)
        .filter(player => player.playerId !== viewer.playerId)
        .map(player => ({
            playerId: player.playerId,
            name: player.name
        }));

    const aliveCount = getAlivePlayers(room).length;
    const totalVoteWeight = getTotalDayVoteWeight(room);
    const pendingRevealTargetId = room.gameState.pendingRevealActions?.[viewer.playerId] || null;
    const pendingRevealTarget = pendingRevealTargetId ? getPlayer(room, pendingRevealTargetId) : null;
    return {
        canVote: !room.gameState.dayActionUsedBy[viewer.playerId],
        selectedVoteTargetId: room.gameState.dayVotes[viewer.playerId] || null,
        allowSkipVote: true,
        voteTargets: targets,
        voteTallies: getDayVoteTallies(room),
        dayVoteSummary: buildDayVoteSummary(room),
        skipVoteWeight: getDaySkipVoteWeight(room),
        totalVoteWeight,
        completedVotes: Object.keys(room.gameState.dayVotes || {}).length,
        totalVoters: aliveCount,
        voteThreshold: Math.floor(totalVoteWeight / 2) + 1,
        canRevealMayor: viewer.role === 'mayor' && !viewer.mayorRevealed,
        mayorRevealed: !!viewer.mayorRevealed,
        currentVoteWeight: getCurrentVoteWeight(viewer),
        canReveal: viewer.role === 'revealer' && !viewer.revealerUsed && !pendingRevealTargetId,
        revealUsed: !!viewer.revealerUsed,
        revealTargets: viewer.role === 'revealer' && !viewer.revealerUsed && !pendingRevealTargetId ? targets : [],
        pendingRevealTargetId,
        pendingRevealTargetName: pendingRevealTarget?.name || null
    };
}

function getDiscussionActionState(room, viewer) {
    const totalAlive = getAlivePlayers(room).length;
    const skipCount = getDiscussionSkipCount(room);
    const skipNeeded = Math.floor(totalAlive / 2) + 1;
    const hasSkipped = !!room.gameState.discussionSkips?.[viewer?.playerId];
    const pendingRevealTargetId = viewer ? room.gameState.pendingRevealActions?.[viewer.playerId] || null : null;
    const pendingRevealTarget = pendingRevealTargetId ? getPlayer(room, pendingRevealTargetId) : null;

    const clericBlessTargets = viewer && viewer.role === 'cleric' && !viewer.clericBlessUsed
        ? getAlivePlayers(room)
            .filter(player => player.playerId !== viewer.playerId)
            .map(player => ({
                playerId: player.playerId,
                name: player.name
            }))
        : [];

    if (!viewer || viewer.alive === false || room.gameState.phase !== 'day-discussion') {
        return {
            canSkip: false,
            hasSkipped: false,
            skipCount,
            totalAlive,
            skipNeeded,
            pendingRevealTargetId,
            pendingRevealTargetName: pendingRevealTarget?.name || null,
            canClericBless: false,
            clericBlessUsed: !!viewer?.clericBlessUsed,
            clericBlessTargetId: viewer?.clericBlessTargetId || null,
            clericBlessTargets: []
        };
    }

    return {
        canSkip: !hasSkipped,
        hasSkipped,
        skipCount,
        totalAlive,
        skipNeeded,
        canRevealMayor: viewer.role === 'mayor' && !viewer.mayorRevealed,
        mayorRevealed: !!viewer.mayorRevealed,
        currentVoteWeight: getCurrentVoteWeight(viewer),
        canReveal: viewer.role === 'revealer' && !viewer.revealerUsed && !pendingRevealTargetId,
        revealUsed: !!viewer.revealerUsed,
        revealTargets: viewer.role === 'revealer' && !viewer.revealerUsed && !pendingRevealTargetId
            ? getAlivePlayers(room)
                .filter(player => player.playerId !== viewer.playerId)
                .map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            : [],
        pendingRevealTargetId,
        pendingRevealTargetName: pendingRevealTarget?.name || null,
        canClericBless: viewer.role === 'cleric' && !viewer.clericBlessUsed,
        clericBlessUsed: !!viewer.clericBlessUsed,
        clericBlessTargetId: viewer.clericBlessTargetId || null,
        clericBlessTargets
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
    const publicEvents = Array.isArray(summary.publicEvents) ? summary.publicEvents : [];
    const attackedPlayer = summary.attackedPlayerId ? getPlayer(room, summary.attackedPlayerId) : null;
    const immunePlayer = summary.immuneTargetId ? getPlayer(room, summary.immuneTargetId) : null;

    if (dayNumber === 1 && eliminatedPlayers.length === 0) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'peaceful-first-night',
            lead: 'รุ่งเช้าแรกของหมู่บ้านยังเงียบผิดปกติ',
            detail: 'คืนแรกผ่านไปโดยไม่มีศพ และหมาป่ายังไม่ได้ออกล่าในเงามืด'
        };
    }

    if (eliminatedPlayers.length === 1) {
        const eliminatedPlayer = eliminatedPlayers[0];
        const publicEvent = publicEvents[0] || null;
        const lead = publicEvent?.cause === 'witch-poison'
            ? `รุ่งเช้า ${eliminatedPlayer.name} ไม่รอดหลังผ่านคืนแห่งยาพิษ`
            : `รุ่งเช้า ${eliminatedPlayer.name} ไม่กลับมาที่ลานหมู่บ้าน`;
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'death',
            lead,
            detail: publicEvent?.detail || `${eliminatedPlayer.name} ไม่รอดในคืนนี้`
        };
    }

    if (eliminatedPlayers.length > 1) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'multiple-deaths',
            lead: `รุ่งเช้ามีคนหายไปถึง ${eliminatedPlayers.length} คน`,
            detail: publicEvents.length > 0
                ? publicEvents.map(event => event.detail).join(' • ')
                : eliminatedPlayers.map(player => player.name).join(', ')
        };
    }

    if (immunePlayer) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'immune',
            lead: 'กลางคืนมีรอยล่า แต่เช้านี้ไม่มีใครล้มลง',
            detail: 'การลงมือเมื่อคืนพลาดเป้า และทั้งหมู่บ้านยังไม่รู้ว่าใครรอดมาเพราะอะไร'
        };
    }

    if (attackedPlayer) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'saved',
            lead: 'กลางคืนเต็มไปด้วยเสียงเคลื่อนไหว แต่ไม่มีศพให้เห็น',
            detail: 'มีบางอย่างทำให้การสังหารเมื่อคืนไม่สำเร็จ แต่หมู่บ้านยังไม่รู้ว่าเป้าหมายคือใครหรือเกิดจากอะไร'
        };
    }

    return {
        title: `☀️ เช้าวันที่ ${dayNumber}`,
        outcomeType: 'peaceful',
        lead: 'คืนที่ผ่านมาเงียบกว่าที่คิด ไม่มีใครตาย',
        detail: 'แต่ความเงียบนี้ยังไม่ใช่คำตอบว่าหมาป่าหยุดล่าจริงหรือไม่'
    };
}

function buildDayResolutionAnnouncement(room) {
    const summary = room?.gameState?.lastResolvedDay;
    if (!summary) {
        return null;
    }

    const dayNumber = room.gameState.dayNumber || 1;
    const eliminatedPlayer = summary.eliminatedPlayerId ? getPlayer(room, summary.eliminatedPlayerId) : null;
    const revealActor = summary.revealActorId ? getPlayer(room, summary.revealActorId) : null;
    const revealTarget = summary.revealTargetId ? getPlayer(room, summary.revealTargetId) : null;
    const publicEvents = Array.isArray(summary.publicEvents) ? summary.publicEvents.filter(Boolean) : [];
    // ถ้าเกมจบด้วยโหวตกลางวันแล้ว ห้ามขึ้น "คืนถัดไป" (ไม่มีคืนต่อ)
    const gameEnded = !!room.gameState.winner || room.gameState.phase === 'finished';
    // ตอนนี้ phase เป็น night แล้ว — startNightPhase เพิ่ม dayNumber ให้แล้ว ห้าม +1 ซ้ำ
    const nextTitle = gameEnded ? '⚖️ ผลโหวตปิดเกม' : `🌙 เข้าสู่คืน ${dayNumber}`;

    if (publicEvents.length > 0) {
        return {
            title: nextTitle,
            outcomeType: summary.resolutionType || publicEvents[0]?.type || 'day-resolution',
            lead: publicEvents.map(event => event.lead).filter(Boolean).join(' • ') || 'เหตุการณ์ช่วงกลางวันสิ้นสุดลงแล้ว',
            detail: publicEvents.map(event => event.detail).filter(Boolean).join(' • ') || 'ระบบสรุปผลช่วงกลางวันไว้ให้แล้ว'
        };
    }

    if (summary.skippedByMajority) {
        return {
            title: nextTitle,
            outcomeType: 'skipped',
            lead: 'เสียงข้ามโหวตเกินครึ่ง หมู่บ้านจบวันทันที',
            detail: 'ไม่มีใครถูกกำจัด และเกมเข้าสู่กลางคืนต่อทันที'
        };
    }

    if (summary.resolutionType === 'reveal-hit' && eliminatedPlayer) {
        return {
            title: nextTitle,
            outcomeType: 'reveal-hit',
            lead: `${revealActor?.name || 'จอมเปิดโปง'} เปิดโปง ${eliminatedPlayer.name} สำเร็จ`,
            detail: `${eliminatedPlayer.name} ตายทันทีเพราะถูกเปิดโปงว่าเป็นหมาป่า`
        };
    }

    if (summary.resolutionType === 'reveal-miss' && eliminatedPlayer) {
        return {
            title: nextTitle,
            outcomeType: 'reveal-miss',
            lead: `${revealActor?.name || 'จอมเปิดโปง'} เปิดโปงผิดเป้า`,
            detail: `${eliminatedPlayer.name} ตายแทนทันทีหลังใช้สกิลกับ ${revealTarget?.name || 'เป้าหมาย'} ผิดคน`
        };
    }

    if (eliminatedPlayer) {
        return {
            title: nextTitle,
            outcomeType: 'eliminated',
            lead: `${eliminatedPlayer.name} ถูกขับออกจากหมู่บ้าน`,
            detail: `บทบาทของ ${eliminatedPlayer.name} จะเฉลยเมื่อเกมจบ`
        };
    }

    return {
        title: nextTitle,
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
            notes.push(viewer.witchHealUsed ? '🧪 คุณใช้ยาช่วยชีวิตไปแล้ว' : '🧪 คุณยังมียาช่วยชีวิต 1 ครั้ง ใช้กันตายให้ผู้เล่น 1 คนในคืนนี้');
            notes.push(viewer.witchPoisonUsed ? '☠️ คุณใช้ยาพิษไปแล้ว' : '☠️ คุณยังมียาพิษ 1 ครั้ง ใช้กำจัดผู้เล่น 1 คนในตอนกลางคืน');
            notes.push('🌙 แต่ละคืนแม่มดเลือกใช้ได้เพียง 1 สกิลเท่านั้น');
            break;
        case 'tracker':
            notes.push('🕵️ คุณดูได้ว่าเป้าหมายมีการใช้สกิลในคืนนั้นหรือไม่');
            break;
        case 'oracle':
            notes.push('🔭 คุณตรวจได้ 1 คนต่อคืน ระบบบอกบทบาทจริงของเป้าหมายและเก็บประวัติไว้ให้');
            break;
        case 'vigilante':
            notes.push(viewer.vigilanteShotUsed ? '🔫 คุณใช้สิทธิ์ยิงไปแล้วทั้งเกม' : '🔫 คุณมีสิทธิ์ยิง 1 ครั้งตลอดเกม ใช้ได้ตอนกลางคืน');
            break;
        case 'hunter':
            if (viewer.hunterShotUsed) {
                notes.push('🏹 คุณใช้สิทธิ์ยิงของพรานไปแล้วตลอดเกม');
            } else {
                notes.push('🏹 ยิงได้ 1 ครั้งตลอดเกม — ต้องเลือกเป้าตอนกลางคืนก่อนจบรอบ');
                notes.push('🏹 ถ้าล็อกเป้าในคืนนั้นแล้วคุณตายในคืนเดียวกัน ลูกยังถึงเป้าตามที่เลือก');
            }
            break;
        case 'cleric':
            notes.push(viewer.clericBlessUsed
                ? '✝️ พรของคุณถูกใช้ไปแล้ว'
                : '✝️ คุณมีพรคุ้มกัน 1 ครั้งทั้งเกม ใช้ตอนประชุมเช้าเพื่อกันตายคืนถัดไป');
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

    if (viewer.roleInfo?.winCondition) {
        notes.push(`🏁 เงื่อนไขชนะ: ${viewer.roleInfo.winCondition}`);
    }

    return notes;
}

function handlePlayerLeft(room, playerId) {
    if (!room?.gameState) {
        return null;
    }
    if (room.gameState.phase === 'finished' || room.gameState.winner) {
        return room.gameState;
    }

    const player = getPlayer(room, playerId);
    if (!player || player.alive === false) {
        return room.gameState;
    }

    ensureActionMaps(room);
    markPlayerDead(player, 'ออกจากเกม');
    syncAlivePlayerIds(room);
    pushHistory(room, `${player.name} ออกจากเกม`, 'system');

    const nightActions = room.gameState.nightActions || {};
    Object.keys(nightActions).forEach(key => {
        if (nightActions[key] && typeof nightActions[key] === 'object') {
            delete nightActions[key][playerId];
        }
    });
    if (room.gameState.nightSkips) delete room.gameState.nightSkips[playerId];
    if (room.gameState.dayVotes) delete room.gameState.dayVotes[playerId];
    if (room.gameState.discussionSkips) delete room.gameState.discussionSkips[playerId];
    if (room.gameState.dayActionUsedBy) delete room.gameState.dayActionUsedBy[playerId];

    if (checkWinCondition(room)) {
        return room.gameState;
    }

    const phase = room.gameState.phase;
    if (phase === 'night' && getRequiredNightActors(room).length === 0) {
        return resolveNight(room);
    }
    if (phase === 'day-discussion' && canSkipDiscussion(room)) {
        startDayPhase(room, 'player-left');
        return room.gameState;
    }
    if (phase === 'day-vote' && canResolveDay(room)) {
        return resolveDayVote(room);
    }

    return room.gameState;
}

/**
 * @param {Object} options { includeStatic } — false = ตัด roleCatalog/rolePlan ออก
 *   ใช้เมื่อ client เครื่องนั้นได้ staticVersion เดียวกันไปแล้ว (ประหยัดแบนด์วิดท์)
 */
function buildClientState(room, viewerPlayerId, options = {}) {
    const includeStatic = options.includeStatic !== false;
    const viewer = getPlayer(room, viewerPlayerId);
    const rolePlan = room.gameState.rolePlan?.length ? room.gameState.rolePlan : getRolePlan(room.players.length, room.settings);
    const enabledRoleIds = new Set(getConfiguredRoleIds(room.settings));
    // เปลี่ยนเมื่อแผนบทหรือรายการบทที่เปิดใช้เปลี่ยนเท่านั้น
    const staticVersion = rolePlan.map(r => r?.id || '').join(',') + '|' + [...enabledRoleIds].sort().join(',');
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
        morningAnnouncement: ['day-discussion', 'finished'].includes(room.gameState.phase) ? buildMorningAnnouncement(room) : null,
        dayResolutionAnnouncement: ['night', 'finished'].includes(room.gameState.phase) ? buildDayResolutionAnnouncement(room) : null,
        playerRole: viewer ? serializePublicRole(viewer.roleInfo || ROLE_DEFINITIONS[viewer.role]) : null,
        personalNotes: {
            roleNotes: buildRoleNotes(room, viewer),
            lastSeenRole: viewer?.lastSeenRole || null,
            seerHistory: Array.isArray(viewer?.seerHistory) ? viewer.seerHistory : [],
            oracleHistory: Array.isArray(viewer?.oracleHistory) ? viewer.oracleHistory : [],
            trackerLastResult: viewer?.trackerLastResult || null,
            lastNightResult: viewer?.lastNightResult || null
        },
        players: room.gameState.players.map(player => ({
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame || 'none',
            alive: player.alive !== false,
            isSelf: player.playerId === viewerPlayerId,
            revealedRole: room.gameState.phase === 'finished' ? (player.revealedRole || null) : null,
            roleId: room.gameState.phase === 'finished' ? (player.role || null) : null,
            roleTeam: room.gameState.phase === 'finished' ? (player.roleInfo?.team || null) : null,
            roleThaiName: room.gameState.phase === 'finished' ? (player.roleInfo?.thaiName || null) : null,
            voteWeight: getCurrentVoteWeight(player),
            voteCount: dayVoteTallies[player.playerId] || 0
        })),
        // roleCatalog + rolePlan เป็นข้อมูลนิ่ง (คำอธิบายบท/รูป) ไม่เปลี่ยนระหว่างเล่น
        // แต่เดิมถูกยัดมาทุก broadcast = 9.7 KB จาก 14.8 KB ของ payload
        // ส่ง staticVersion ไปด้วย ให้ผู้เรียกตัดสินใจว่าจะส่งซ้ำไหม (client จำของเดิมไว้)
        staticVersion,
        ...(includeStatic ? {
            rolePlan: rolePlan.map(serializePublicRole).filter(Boolean),
            roleCatalog: Object.values(ROLE_DEFINITIONS).filter(role => role.id !== 'villager').map(role => ({
                ...serializePublicRole(role),
                enabledInRoom: enabledRoleIds.has(role.id)
            }))
        } : {}),
        history: room.gameState.history || [],
        actionState: {
            completedDayDecisions: Array.from(getCompletedDayActorIds(room)).length,
            requiredDayDecisions: getAlivePlayers(room).length,
            nightActions: getNightActionOptions(room, viewer),
            nightStatus: getNightActionState(room, viewer),
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
    submitNightSkip,
    submitMayorReveal,
    submitClericBless,
    submitDiscussionSkip,
    submitDayVote,
    useRevealAction,
    autoResolvePhase,
    handlePlayerLeft,
    buildClientState
};
