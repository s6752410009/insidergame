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

const VILLAGE_WIN_TEXT = 'ชาวบ้านชนะเมื่อหมาป่าทั้งหมด (และฆาตกรต่อเนื่องถ้ามี) ถูกกำจัด';

const ROLE_DEFINITIONS = {
    villager: {
        id: 'villager',
        image: werewolfRoleImage('villager'),
        icon: '👤',
        name: 'Villager',
        thaiName: 'ชาวบ้าน',
        team: 'village',
        description: 'ไม่มีสกิลพิเศษ ใช้การคุย จับพิรุธ และโหวตช่วยทีม',
        winCondition: VILLAGE_WIN_TEXT
    },
    werewolf: {
        id: 'werewolf',
        image: werewolfRoleImage('werewolf'),
        icon: '🐺',
        name: 'Werewolf',
        thaiName: 'หมาป่า',
        team: 'werewolf',
        description: 'คุยกับทีมหมาป่าและเลือกเหยื่อในตอนกลางคืน (คืนแรกยังล่าไม่ได้)',
        winCondition: 'หมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่ยังมีชีวิตอยู่รวมกัน และฆาตกรต่อเนื่อง (ถ้ามี) ตายแล้ว'
    },
    alphaWolf: {
        id: 'alphaWolf',
        image: werewolfRoleImage('alphaWolf'),
        icon: '👑',
        name: 'Alpha Wolf',
        thaiName: 'อัลฟ่าหมาป่า',
        team: 'werewolf',
        description: 'หมาป่าหัวหน้า โหวตล่าแรงกว่า 1 เสียง และผู้หยั่งรู้จะเห็นว่าไม่ทราบ',
        winCondition: 'หมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่ยังมีชีวิตอยู่รวมกัน และฆาตกรต่อเนื่อง (ถ้ามี) ตายแล้ว'
    },
    mayor: {
        id: 'mayor',
        image: werewolfRoleImage('mayor'),
        icon: '🎖️',
        name: 'Mayor',
        thaiName: 'นายก',
        team: 'village',
        description: 'เช้ากดเปิดตัวได้เอง แล้วเสียงโหวตของคุณจะนับเป็น 2',
        winCondition: VILLAGE_WIN_TEXT
    },
    bodyguard: {
        id: 'bodyguard',
        image: werewolfRoleImage('bodyguard'),
        icon: '🛡️',
        name: 'Bodyguard',
        thaiName: 'บอดี้การ์ด',
        team: 'village',
        description: 'กันการโจมตีได้ 1 คนตอนกลางคืน ห้ามปกป้องคนเดิมสองคืนติดกัน และเกราะจะพังเมื่อกันสำเร็จ',
        winCondition: VILLAGE_WIN_TEXT
    },
    seer: {
        id: 'seer',
        image: werewolfRoleImage('seer'),
        icon: '🔮',
        name: 'Seer',
        thaiName: 'ผู้หยั่งรู้',
        team: 'village',
        description: 'ตรวจผู้เล่นได้ 1 คนต่อคืน ดูตัวเองไม่ได้ ผลเป็น ดี / ไม่ดี / ไม่ทราบ',
        winCondition: VILLAGE_WIN_TEXT
    },
    oracle: {
        id: 'oracle',
        image: werewolfRoleImage('oracle'),
        icon: '✨',
        name: 'Oracle',
        thaiName: 'นักพยากรณ์',
        team: 'village',
        description: 'ตรวจผู้เล่นได้ 1 คนต่อคืน ดูตัวเองไม่ได้ ระบบบอกบทบาทจริงของเป้าหมาย (แม่นกว่าผู้หยั่งรู้) และเก็บประวัติไว้ให้',
        winCondition: VILLAGE_WIN_TEXT
    },
    doctor: {
        id: 'doctor',
        image: werewolfRoleImage('doctor'),
        icon: '💉',
        name: 'Doctor',
        thaiName: 'หมอ',
        team: 'village',
        description: 'ช่วยชีวิตผู้เล่น 1 คนต่อคืน ใช้ได้รวม 2 ครั้งต่อเกม',
        winCondition: VILLAGE_WIN_TEXT
    },
    witch: {
        id: 'witch',
        image: werewolfRoleImage('witch'),
        icon: '🧪',
        name: 'Witch',
        thaiName: 'แม่มด',
        team: 'village',
        description: 'มียาช่วย 1 ครั้งและยาพิษ 1 ครั้ง คืนหนึ่งใช้ได้แค่ 1 อย่าง',
        winCondition: VILLAGE_WIN_TEXT
    },
    tracker: {
        id: 'tracker',
        image: werewolfRoleImage('tracker'),
        icon: '🧭',
        name: 'Tracker',
        thaiName: 'นักสอดแนม',
        team: 'village',
        description: 'เลือก 1 คนตอนกลางคืนเพื่อดูว่าเขาใช้สกิลในคืนนั้นหรือไม่',
        winCondition: VILLAGE_WIN_TEXT
    },
    hunter: {
        id: 'hunter',
        image: werewolfRoleImage('hunter'),
        icon: '🏹',
        name: 'Hunter',
        thaiName: 'พราน',
        team: 'village',
        description: 'กลางคืนเลือกยิง 1 คนได้ 1 ครั้งตลอดเกม เปลี่ยน/ยกเลิกเป้าได้จนกว่าจะปิดคืน — ถ้าล็อกเป้าไว้แล้วคุณตายในคืนเดียวกัน ลูกธนูยังออกตามที่เลือก',
        winCondition: VILLAGE_WIN_TEXT
    },
    cleric: {
        id: 'cleric',
        image: werewolfRoleImage('cleric'),
        icon: '⛪',
        name: 'Cleric',
        thaiName: 'นักบวช',
        team: 'village',
        description: 'มีพรคุ้มกัน 1 ครั้ง ใช้กันตายให้ผู้เล่น 1 คนได้',
        winCondition: VILLAGE_WIN_TEXT
    },
    vigilante: {
        id: 'vigilante',
        image: werewolfRoleImage('vigilante'),
        icon: '🎯',
        name: 'Vigilante',
        thaiName: 'ศาลเตี้ย',
        team: 'village',
        description: 'กลางคืนเลือกยิง 1 คนได้ 1 ครั้งทั้งเกม เปลี่ยน/ยกเลิกเป้าได้จนกว่าจะปิดคืน สิทธิ์จะถูกใช้ก็ต่อเมื่อคืนนั้นจบลง',
        winCondition: VILLAGE_WIN_TEXT
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
        winCondition: VILLAGE_WIN_TEXT
    },
    // ===== บทใหม่ v6.5 (อิง Ultimate Werewolf / Wolvesville) =====
    serialKiller: {
        id: 'serialKiller',
        image: werewolfRoleImage('serialKiller'),
        icon: '🔪',
        name: 'Serial Killer',
        thaiName: 'ฆาตกรต่อเนื่อง',
        team: 'solo',
        description: 'ตั้งแต่คืนที่ 2 เลือกฆ่าได้คืนละ 1 คน หมาป่าฆ่าคุณไม่ได้ ต้องเป็นคนรอดท้ายสุด',
        winCondition: 'ชนะคนเดียวเมื่อเหลือผู้รอดชีวิตไม่เกิน 2 คน และคุณยังรอดอยู่'
    },
    prince: {
        id: 'prince',
        image: werewolfRoleImage('prince'),
        icon: '🤴',
        name: 'Prince',
        thaiName: 'เจ้าชาย',
        team: 'village',
        description: 'ถ้าถูกโหวตออกครั้งแรก คุณจะเปิดตัวเป็นเจ้าชายและไม่ตาย (ครั้งต่อไปตายตามปกติ)',
        winCondition: VILLAGE_WIN_TEXT
    },
    lycan: {
        id: 'lycan',
        image: werewolfRoleImage('lycan'),
        icon: '🌕',
        name: 'Lycan',
        thaiName: 'ไลแคน',
        team: 'village',
        description: 'ชาวบ้านที่มีเลือดหมาป่า ไม่มีสกิล แต่ผู้หยั่งรู้จะเห็นคุณเป็น "ไม่ดี"',
        winCondition: VILLAGE_WIN_TEXT
    },
    diseased: {
        id: 'diseased',
        image: werewolfRoleImage('diseased'),
        icon: '🤒',
        name: 'Diseased',
        thaiName: 'ผู้ติดเชื้อ',
        team: 'village',
        description: 'ถ้าหมาป่ากัดคุณตาย หมาป่าจะติดเชื้อและล่าใครไม่ได้ในคืนถัดไป',
        winCondition: VILLAGE_WIN_TEXT
    },
    apprenticeSeer: {
        id: 'apprenticeSeer',
        image: werewolfRoleImage('apprenticeSeer'),
        icon: '🧿',
        name: 'Apprentice Seer',
        thaiName: 'ศิษย์ผู้หยั่งรู้',
        team: 'village',
        description: 'เมื่อไม่มีผู้หยั่งรู้เหลือรอด คุณจะได้พลังตรวจออร่าคืนละ 1 คนแทน',
        winCondition: VILLAGE_WIN_TEXT
    }
};

const NEW_ROLE_IDS = ['serialKiller', 'prince', 'lycan', 'diseased', 'apprenticeSeer'];

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

const CONFIGURABLE_ROLE_IDS = ['werewolf', 'alphaWolf', 'seer', 'oracle', 'doctor', 'witch', 'fool', 'bodyguard', 'mayor', 'revealer', 'tracker', 'vigilante', 'hunter', 'cleric', ...NEW_ROLE_IDS];
const DEFAULT_ROLE_SELECTION = [...CONFIGURABLE_ROLE_IDS];
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 20;
const MAX_WOLF_COUNT = 5;

// ===== ตารางบทแนะนำ 5–20 คน (ค่าเริ่มต้นเมื่อหัวห้องไม่ได้เลือกเอง) — ดู rules.md =====
// หมาป่า ~1 ตัวต่อ 4–5 คน · บทเดี่ยวเริ่มที่ 11 คน · ชาวบ้านธรรมดาเริ่มที่ 11 คนให้โต๊ะใหญ่อ่านง่าย
function getRecommendedWolfCount(playerCount) {
    const n = Number(playerCount) || 0;
    if (n <= 6) return 1;
    if (n <= 11) return 2;
    if (n <= 15) return 3;
    return 4;
}

function getRecommendedDistribution(playerCount) {
    const n = Math.max(5, Math.min(MAX_PLAYERS, Number(playerCount) || 5));
    const wolfCount = getRecommendedWolfCount(n);
    const wolves = wolfCount === 1 ? ['werewolf'] : ['alphaWolf', ...Array(wolfCount - 1).fill('werewolf')];
    const solo = n >= 17 ? ['serialKiller', 'fool'] : (n >= 13 ? ['serialKiller'] : (n >= 11 ? ['fool'] : []));
    const plainVillagers = n >= 18 ? 3 : (n >= 15 ? 2 : (n >= 11 ? 1 : 0));
    const core = ['seer', 'doctor'];
    if (n >= 8) core.push('bodyguard');
    if (n >= 11) core.push('witch', 'hunter');
    if (n >= 14) core.push('apprenticeSeer', 'prince');
    if (n >= 16) core.push('lycan', 'diseased');
    const flexPool = ['oracle', 'witch', 'bodyguard', 'mayor', 'revealer', 'tracker', 'vigilante', 'hunter', 'cleric', 'prince', 'lycan', 'diseased', 'apprenticeSeer']
        .filter(roleId => !core.includes(roleId))
        // บทใหม่ฝั่งชาวบ้านเหมาะกับโต๊ะ 7 คนขึ้นไป (โต๊ะเล็กไลแคน/ศิษย์ทำให้ข้อมูลน้อยเกินไป)
        .filter(roleId => n >= 7 || !NEW_ROLE_IDS.includes(roleId));
    const flexCount = Math.max(0, n - wolves.length - solo.length - plainVillagers - core.length);
    return { playerCount: n, wolves, solo, core, flexCount, flexPool, plainVillagers };
}

function buildRecommendedRolePlan(playerCount, previousPlanRoleIds = []) {
    const dist = getRecommendedDistribution(playerCount);
    const previousSignature = serializeRolePlan(previousPlanRoleIds);
    let plan = null;
    // สุ่มบทเสริมใหม่ได้สูงสุด 6 ครั้งเพื่อไม่ให้ซ้ำชุดเดิมเกมก่อน
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const flex = shuffle(dist.flexPool).slice(0, dist.flexCount);
        plan = [...dist.wolves, ...dist.solo, ...dist.core, ...flex, ...Array(dist.plainVillagers).fill('villager')];
        while (plan.length < dist.playerCount) plan.push('villager');
        if (serializeRolePlan(plan) !== previousSignature || dist.flexCount === 0) break;
    }
    return plan.slice(0, dist.playerCount);
}

function sanitizeWolfCount(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 1 && numeric <= MAX_WOLF_COUNT ? numeric : null;
}
const SKIP_TARGET_ID = '__skip__';

// ===== ตั้งเวลาโดยหัวห้อง + ช่วงเรียกโหวตสุดท้าย =====
const VOTE_LAST_CALL_MS = 4000;
const WEREWOLF_TIMER_CHOICES = {
    werewolfNightSeconds: [45, 60, 90],
    werewolfDaySeconds: [120, 180, 240, 300],
    werewolfVoteSeconds: [45, 60, 90]
};
const WEREWOLF_TIMER_DEFAULTS = {
    werewolfNightSeconds: 60,
    werewolfDaySeconds: 180,
    werewolfVoteSeconds: 60
};

function sanitizeTimerSeconds(key, value, fallback) {
    const numeric = Number(value);
    if (WEREWOLF_TIMER_CHOICES[key].includes(numeric)) {
        return numeric;
    }
    return WEREWOLF_TIMER_CHOICES[key].includes(Number(fallback)) ? Number(fallback) : WEREWOLF_TIMER_DEFAULTS[key];
}

/** คืนค่าตั้งเวลา/การมองเห็นบทของคนตายที่ปลอดภัยแล้ว (ค่าที่ไม่ได้ส่งมา = ใช้ค่าเดิมหรือค่าเริ่มต้น) */
function sanitizeWerewolfSettings(input = {}, current = {}) {
    const source = input || {};
    const previous = current || {};
    const result = {};
    Object.keys(WEREWOLF_TIMER_DEFAULTS).forEach(key => {
        result[key] = source[key] !== undefined
            ? sanitizeTimerSeconds(key, source[key], previous[key])
            : sanitizeTimerSeconds(key, previous[key]);
    });
    if (source.werewolfDeadSeeRoles !== undefined) {
        result.werewolfDeadSeeRoles = source.werewolfDeadSeeRoles === true || source.werewolfDeadSeeRoles === 'true';
    } else {
        result.werewolfDeadSeeRoles = previous.werewolfDeadSeeRoles !== false;
    }
    // เปิดบทเมื่อตาย: กติกามาตรฐาน Ultimate Werewolf / Miller's Hollow / Wolvesville
    // ค่าเริ่มต้นปิด เพราะเจ้าของเว็บอนุมัติให้ "คนที่ยังมีชีวิตไม่เห็นบทใครเลย" (v6.4)
    if (source.werewolfRevealOnDeath !== undefined) {
        result.werewolfRevealOnDeath = source.werewolfRevealOnDeath === true || source.werewolfRevealOnDeath === 'true';
    } else {
        result.werewolfRevealOnDeath = previous.werewolfRevealOnDeath === true;
    }
    return result;
}

function getPhaseDurationMs(room, phase) {
    const settings = sanitizeWerewolfSettings({}, room?.settings || {});
    if (phase === 'night') return settings.werewolfNightSeconds * 1000;
    if (phase === 'day-discussion') return settings.werewolfDaySeconds * 1000;
    return settings.werewolfVoteSeconds * 1000;
}

/** ทุกคนโหวตครบ → ไม่ปิดทันที เปิดช่วงเรียกสุดท้าย 4 วิ (ไม่ต่อเวลาเมื่อมีคนเปลี่ยนโหวต) */
function startVoteLastCall(room) {
    if (!room.gameState.voteClosesAt) {
        room.gameState.voteClosesAt = Date.now() + VOTE_LAST_CALL_MS;
        const currentEnd = Number(room.gameState.phaseEndsAt || 0);
        room.gameState.phaseEndsAt = currentEnd > 0 ? Math.min(currentEnd, room.gameState.voteClosesAt) : room.gameState.voteClosesAt;
    }
    return { resolved: false, lastCall: true, voteClosesAt: room.gameState.voteClosesAt };
}

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

function hasLivingRole(room, roleId) {
    return (room?.gameState?.players || []).some(player => player.alive !== false && player.role === roleId);
}

// ศิษย์ผู้หยั่งรู้ได้พลังเมื่อไม่มีผู้หยั่งรู้ที่ยังมีชีวิต (ตายแล้ว ออกจากเกม หรือไม่ได้แจกตั้งแต่ต้น)
function isApprenticeSeerActive(room) {
    return !hasLivingRole(room, 'seer');
}

function isSeerLikeActor(room, player) {
    if (!player || player.alive === false) return false;
    if (player.role === 'seer') return true;
    return player.role === 'apprenticeSeer' && isApprenticeSeerActive(room);
}

// ฝูงหมาป่าติดเชื้อ: คืนนี้ล่าใครไม่ได้
function isWolfPackSick(room) {
    const sickNight = Number(room?.gameState?.wolvesSickNight || 0);
    return sickNight > 0 && sickNight === Number(room?.gameState?.dayNumber || 0) && room?.gameState?.phase === 'night';
}

// บทที่ฆ่าตอนกลางคืนได้ตั้งแต่คืนที่ 2 (หมาป่า/ฆาตกร) — คืนแรกหมู่บ้านยังสงบ
function canWolvesHuntTonight(room) {
    return !isFirstNight(room) && !isWolfPackSick(room);
}

function getSeerAlignment(roleId) {
    // ไลแคน = ชาวบ้านที่ออร่าเหมือนหมาป่า · ฆาตกรต่อเนื่องเป็นนักฆ่า ออร่าไม่ดี
    if (roleId === 'lycan' || roleId === 'serialKiller') {
        return {
            code: 'bad',
            label: 'ไม่ดี'
        };
    }

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
    if (isFoolRole(roleId) || roleId === 'serialKiller') {
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

// Host-picked role lists must never give wolves more than floor(n/3) seats
// (e.g. 2 wolves in a 3–4 player game = instant wolf win after night 1).
function capWolvesInPlan(roleIds, playerCount) {
    const maxWolves = Math.max(1, Math.floor(Number(playerCount) / 3));
    let wolfSeen = 0;
    return roleIds.map(roleId => {
        if (!isWerewolfRole(roleId)) {
            return roleId;
        }
        wolfSeen += 1;
        return wolfSeen > maxWolves ? 'villager' : roleId;
    });
}

function buildWolfRoleIds(count, allowAlpha = true) {
    if (count <= 0) return [];
    if (count === 1 || !allowAlpha) return Array(count).fill('werewolf');
    return ['alphaWolf', ...Array(count - 1).fill('werewolf')];
}

// หัวห้องเลือกจำนวนหมาป่าเอง: ใช้ตารางแนะนำแล้วปรับเฉพาะจำนวนหมาป่า (ไม่เกิน 1 ใน 3 ของโต๊ะ)
function applyWolfCountToPlan(planRoleIds, requestedWolves, playerCount) {
    const cap = Math.max(1, Math.floor(playerCount / 3));
    const wolfCount = Math.min(requestedWolves, cap);
    const nonWolves = planRoleIds.filter(roleId => !isWerewolfRole(roleId));
    const need = playerCount - wolfCount;
    let kept = nonWolves.slice(0, need);
    if (kept.length < need) {
        const extras = shuffle(getRecommendedDistribution(playerCount).flexPool.filter(roleId => !kept.includes(roleId)));
        while (kept.length < need) {
            kept.push(playerCount <= 10 && extras.length ? extras.shift() : 'villager');
        }
    }
    return [...buildWolfRoleIds(wolfCount), ...kept];
}

// โต๊ะ 11–20 คนที่หัวห้องติ๊กบทเอง: บทที่ติ๊กได้ 1 ที่ต่อบท ที่เหลือเป็นชาวบ้านธรรมดา
function buildLargeTableCustomPlan(playerCount, settings, wolfCountSetting) {
    const selected = sanitizeRoleSelection(settings.werewolfRoles);
    const cap = Math.max(1, Math.floor(playerCount / 3));
    const wolfCount = Math.min(wolfCountSetting || getRecommendedWolfCount(playerCount), cap);
    const hasAlpha = selected.includes('alphaWolf');
    const hasWolf = selected.includes('werewolf');
    const wolves = hasAlpha && (wolfCount >= 2 || !hasWolf)
        ? ['alphaWolf', ...Array(wolfCount - 1).fill('werewolf')]
        : Array(wolfCount).fill('werewolf');
    const priority = ['seer', 'doctor'];
    const specials = selected.filter(roleId => !isWerewolfRole(roleId));
    const ordered = [
        ...priority.filter(roleId => specials.includes(roleId)),
        ...shuffle(specials.filter(roleId => !priority.includes(roleId)))
    ];
    const plan = [...wolves, ...ordered.slice(0, playerCount - wolves.length)];
    while (plan.length < playerCount) plan.push('villager');
    return plan;
}

function getRolePlan(playerCount, settings = {}, previousPlanRoleIds = []) {
    const safeSettings = settings || {};
    const requestedCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Number(playerCount) || MIN_PLAYERS));
    const hasExplicitRoles = Array.isArray(safeSettings.werewolfRoles) && safeSettings.werewolfRoles.length > 0;
    const wolfCountSetting = hasExplicitRoles ? null : sanitizeWolfCount(safeSettings.wolfCount);
    const toDefs = roleIds => roleIds.map(roleId => ROLE_DEFINITIONS[roleId] || ROLE_DEFINITIONS.villager);

    if (requestedCount > 10 && hasExplicitRoles) {
        return toDefs(capWolvesInPlan(buildLargeTableCustomPlan(requestedCount, safeSettings, sanitizeWolfCount(safeSettings.wolfCount)), requestedCount));
    }
    if (requestedCount >= 5 && !hasExplicitRoles) {
        const recommended = buildRecommendedRolePlan(requestedCount, previousPlanRoleIds);
        return toDefs(wolfCountSetting ? applyWolfCountToPlan(recommended, wolfCountSetting, requestedCount) : recommended);
    }
    return getLegacyRolePlan(requestedCount, safeSettings, previousPlanRoleIds);
}

// กติกาเดิม (v6.4) สำหรับโต๊ะ 3–4 คน และโต๊ะ ≤10 คนที่หัวห้องติ๊กบทเอง — ห้ามเปลี่ยนพฤติกรรม
function getLegacyRolePlan(playerCount, settings = {}, previousPlanRoleIds = []) {
    const normalizedCount = Math.max(3, Math.min(10, Number(playerCount) || 3));
    const basePlan = getBaseRolePlan(normalizedCount, previousPlanRoleIds);
    const maxWolfCount = Math.max(1, basePlan.filter(isWerewolfRole).length);

    // Wolf count mode: pick N wolves, fill rest from base plan specials + villagers
    if (settings.wolfCount) {
        const wolfCount = Math.min(Math.max(1, Number(settings.wolfCount) || 1), MAX_WOLF_COUNT);
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
        const exactRoleIds = capWolvesInPlan(
            fillRolePlanWithoutVillager(enabledRoleIds, normalizedCount, basePlan, { maxWolfCount }),
            normalizedCount
        );

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

    const completedRoleIds = capWolvesInPlan(
        fillRolePlanWithoutVillager(plannedRoleIds, normalizedCount, basePlan, { maxWolfCount }),
        normalizedCount
    );

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
            clericBlesses: {},
            serialKills: {}
        },
        nightSkips: {},
        dayVotes: {},
        discussionSkips: {},
        dayActionUsedBy: {},
        pendingRevealActions: {},
        lastProtectedByBodyguard: {},
        lastResolvedNight: null,
        lastResolvedDay: null,
        voteClosesAt: null,
        // คืนที่ฝูงหมาป่าติดเชื้อจากผู้ติดเชื้อ (ล่าไม่ได้) — เก็บเป็นเลขคืน
        wolvesSickNight: null
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
        witchPoisonUsed: false,
        serialKillerLastTargetId: null,
        serialKillerLastResult: null,
        princeRevealed: false,
        apprenticePromotedNotified: false
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
    } else if (cause === 'serial-kill') {
        detail = `${player.name} ถูกฆาตกรต่อเนื่องสังหารในตอนกลางคืน`;
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
        clericBlesses: {},
        serialKills: {}
    };
    room.gameState.nightSkips = {};
}

function resetDayState(room) {
    room.gameState.voteClosesAt = null;
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
        clericBlesses: {},
        serialKills: {}
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
    // เก็บผลโหวตเมื่อวานไว้ให้คืนนี้ประกาศ/สรุปได้ (resetDayState ล้างทิ้ง ทำให้ไม่มีใครรู้ว่าใครโดนโหวตออก)
    const previousDayResolution = room.gameState.lastResolvedDay || null;
    resetDayState(room);
    room.gameState.lastResolvedDay = previousDayResolution;
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
    room.gameState.voteClosesAt = null;
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
    // Deal roles only to connected players (same rule as the app.js start check);
    // players still in reconnect grace (no socketId) would otherwise inflate vote majorities.
    const connectedPlayers = room.players.filter(player => player.socketId);
    const dealtPlayers = connectedPlayers.length > 0 ? connectedPlayers : room.players;
    return {
        ...createInitialState(),
        players: dealtPlayers.map(player => createPlayerState({
            playerId: player.playerId,
            playerName: player.playerName,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame
        }, {
            socketId: player.socketId,
            isAdmin: player.permission === 'admin'
        })),
        alivePlayerIds: dealtPlayers.map(player => player.playerId),
        rolePlan: getRolePlan(dealtPlayers.length, room.settings, room.lastWerewolfPlanRoleIds || [])
    };
}

function assignRoles(room) {
    const roleIds = room.gameState.rolePlan.map(role => role.id);
    const players = room.gameState.players;

    // getRolePlan รองรับถึง MAX_PLAYERS (20) — กันไว้อีกชั้น: ถ้าบทไม่พอ เติม villager ให้ครบ
    // (ไม่งั้น fallback แจก undefined ให้คนท้ายๆ จน UI พัง)
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
        // โต๊ะ 20 คน: จำกัดจำนวนรอบค้นหา กันกรณีหลีกเลี่ยงบทซ้ำไม่ได้แล้วค้นแบบ exponential
        let searchBudget = 20000;

        function backtrack(index, assignment, repeatCount) {
            searchBudget -= 1;
            if (repeatCount >= bestRepeatCount || (searchBudget <= 0 && bestAssignment)) {
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
            witchPoisonUsed: false,
            serialKillerLastTargetId: null,
            serialKillerLastResult: null,
            princeRevealed: false,
            apprenticePromotedNotified: false
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

function finishGame(room, winner, message) {
    room.gameState.phase = 'finished';
    room.gameState.phaseEndsAt = null;
    room.gameState.status = 'werewolf_finished';
    room.gameState.winner = winner;
    room.gameState.players.forEach(player => {
        player.revealedRole = player.roleInfo?.thaiName || player.role;
    });
    pushHistory(room, message, 'result');
    return winner;
}

/**
 * ลำดับความสำคัญเมื่อเงื่อนไขชนะเกิดพร้อมกัน (ดู rules.md):
 * 1) คนบ้าถูกโหวตออก (ตัดสินใน resolveDayVote ทันที) / คนบ้ารอดคนเดียว
 * 2) ฆาตกรต่อเนื่องยังรอด และเหลือผู้รอดชีวิตไม่เกิน 2 คน
 * 3) ชาวบ้าน: หมาป่าและฆาตกรต่อเนื่องตายหมด
 * 4) หมาป่า: ไม่มีฆาตกรต่อเนื่องเหลือ และหมาป่า ≥ คนอื่นที่รอด (หรือเหลือแต่คนบ้า)
 */
function checkWinCondition(room) {
    const aliveWerewolves = getAliveWerewolves(room);
    const alivePlayers = getAlivePlayers(room);
    const aliveNonWerewolves = alivePlayers.filter(player => !isWerewolfRole(player.role));
    const aliveFools = alivePlayers.filter(player => player.role === 'fool');
    const aliveKillers = alivePlayers.filter(player => player.role === 'serialKiller');

    if (aliveFools.length === 1 && alivePlayers.length === 1) {
        return finishGame(room, 'fool', 'คนบ้าชนะแล้วแบบเดี่ยวหลังเป็นผู้รอดชีวิตคนสุดท้าย');
    }

    // ฆาตกรฆ่าได้ทุกคืนและหมาป่าฆ่าไม่ได้ — เหลือ 2 คนเมื่อไร ไม่มีใครหยุดได้อีก
    if (aliveKillers.length > 0 && alivePlayers.length <= 2) {
        return finishGame(room, 'serialKiller', 'ฆาตกรต่อเนื่องชนะแล้ว เหลือรอดจนไม่มีใครหยุดได้');
    }

    if (aliveWerewolves.length === 0 && aliveKillers.length === 0) {
        return finishGame(room, 'village', 'ชาวบ้านชนะแล้ว หมาป่าถูกกำจัดหมด');
    }

    // ตัวตลกนับเป็น "ตัวโหวต" ฝั่งหมู่บ้านด้วย — ไม่งั้นหมาป่าชนะก่อนเวลาทั้งที่หมู่บ้านยังโหวตชนะได้
    // แต่ถ้าเหลือแค่ตัวตลก (หมาป่าฆ่าตัวตลกไม่ได้) ต้องจบเกมกันเกมค้างไม่มีวันจบ
    // ฆาตกรต่อเนื่องยังรอด = หมาป่ายังชนะไม่ได้ (ฆาตกรยังฆ่าหมาป่าได้ทุกคืน)
    const aliveVillagersExcludingFool = aliveNonWerewolves.filter(player => player.role !== 'fool');
    if (aliveKillers.length === 0 && aliveWerewolves.length > 0
        && (aliveWerewolves.length >= aliveNonWerewolves.length || aliveVillagersExcludingFool.length === 0)) {
        return finishGame(
            room,
            'werewolf',
            aliveWerewolves.length >= aliveNonWerewolves.length
                ? 'หมาป่าชนะแล้ว จำนวนหมาป่าไม่น้อยกว่าผู้เล่นคนอื่นที่เหลือ'
                : 'หมาป่าชนะแล้ว ฝั่งหมู่บ้านไม่เหลือกำลังพอจะต้านหมาป่าได้'
        );
    }

    return null;
}

function getRequiredNightActors(room) {
    const alwaysActive = ['seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'tracker', 'hunter', 'vigilante'];
    const firstNight = isFirstNight(room);
    const wolvesHunt = canWolvesHuntTonight(room);
    const apprenticeActive = isApprenticeSeerActive(room);

    return getAlivePlayers(room).filter(player => {
        if (alwaysActive.includes(player.role)) return true;
        if (isWerewolfRole(player.role)) return wolvesHunt;
        if (player.role === 'serialKiller') return !firstNight;
        if (player.role === 'apprenticeSeer') return apprenticeActive;
        return false;
    });
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
        case 'apprenticeSeer':
            return !isApprenticeSeerActive(room) || !!nightActions.seerChecks?.[player.playerId];
        case 'serialKiller':
            return isFirstNight(room) || !!nightActions.serialKills?.[player.playerId];
        case 'oracle':
            return !!nightActions.oracleReads?.[player.playerId];
        case 'doctor':
            return player.doctorSaveUses >= 2 || !!nightActions.doctorSaves?.[player.playerId];
        case 'bodyguard':
            return player.bodyguardArmorBroken || !!nightActions.bodyguardProtects?.[player.playerId];
        case 'witch': {
            // ใช้ยาได้ทั้ง 2 ขวดในคืนเดียว (กติกา Miller's Hollow) — ตัดสินใจครบเมื่อทุกขวดที่ยังเหลือถูกเลือกหรือกดไม่ใช้
            const healDecided = player.witchHealUsed || !!nightActions.witchHeals?.[player.playerId];
            const poisonDecided = player.witchPoisonUsed || !!nightActions.witchPoisons?.[player.playerId];
            return healDecided && poisonDecided;
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
        room.gameState.nightActions.clericBlesses,
        room.gameState.nightActions.serialKills
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

// "พร้อมจบคืน" = กดปุ่มพร้อมเอง หรือบทที่มีสกิลตัดสินใจคืนนี้แล้ว (เลือกเป้าหรือกดไม่ใช้สกิล)
function isPlayerReadyForMorning(room, player) {
    if (!player || player.alive === false) {
        return false;
    }
    if (room.gameState.nightSkips?.[player.playerId]) {
        return true;
    }
    const nightActions = room.gameState.nightActions || {};
    const decidedMaps = {
        werewolf: ['werewolfVotes'],
        alphaWolf: ['werewolfVotes'],
        seer: ['seerChecks'],
        oracle: ['oracleReads'],
        doctor: ['doctorSaves'],
        bodyguard: ['bodyguardProtects'],
        witch: ['witchHeals', 'witchPoisons'],
        tracker: ['trackerScans'],
        vigilante: ['vigilanteShots'],
        hunter: ['hunterShots'],
        serialKiller: ['serialKills'],
        apprenticeSeer: ['seerChecks']
    }[player.role] || [];
    return decidedMaps.some(key => !!nightActions[key]?.[player.playerId]);
}

function getNightReadyCount(room) {
    return getAlivePlayers(room).filter(player => isPlayerReadyForMorning(room, player)).length;
}

// ฝูงหมาป่าเลือกเหยื่อตรงกันแล้วหรือยัง (ไม่นับคนที่กดไม่ใช้สกิล)
function isWolfPackSettled(room) {
    const votes = room.gameState.nightActions?.werewolfVotes || {};
    const picks = new Set(getAliveWerewolves(room)
        .map(wolf => votes[wolf.playerId])
        .filter(targetId => targetId && targetId !== SKIP_TARGET_ID));
    return picks.size <= 1;
}

/**
 * จบคืนทันทีเมื่อทุกบทที่มีสกิลตัดสินใจครบ และคนมีชีวิตเกินครึ่ง "พร้อม" (กดพร้อมหรือใช้สกิลแล้ว)
 * คนที่ไม่มีสกิลกลางคืนจึงไม่ต้องกดอะไร ถ้าคนมีสกิลเป็นเสียงส่วนใหญ่อยู่แล้ว
 * ถ้าฝูงหมาป่ายังเลือกเหยื่อไม่ตรงกัน ให้รอ (หรือรอหมดเวลา/ทั้งโต๊ะกดพร้อมเอง)
 */
function maybeAutoEndNight(room) {
    if (!room?.gameState || room.gameState.phase !== 'night' || room.gameState.winner) {
        return { resolved: false };
    }
    ensureActionMaps(room);
    const totalAlive = getAlivePlayers(room).length;
    const needed = Math.floor(totalAlive / 2) + 1;
    if (getNightReadyCount(room) < needed || !haveAllRequiredNightActorsDecided(room) || !isWolfPackSettled(room)) {
        return { resolved: false };
    }
    pushHistory(room, 'ทุกบทที่มีสกิลตัดสินใจครบแล้ว และคนส่วนใหญ่พร้อม จึงเข้าสู่ตอนเช้าทันที', 'night');
    return { ...resolveNight(room), autoEndedNight: true };
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
                if (!actor.witchHealUsed && !nightActions.witchHeals[actor.playerId]) {
                    nightActions.witchHeals[actor.playerId] = SKIP_TARGET_ID;
                }
                if (!actor.witchPoisonUsed && !nightActions.witchPoisons[actor.playerId]) {
                    nightActions.witchPoisons[actor.playerId] = SKIP_TARGET_ID;
                }
                break;
            case 'apprenticeSeer':
                nightActions.seerChecks[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'serialKiller':
                nightActions.serialKills[actor.playerId] = SKIP_TARGET_ID;
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
            detail: `เสียงโหวตเทไปทางเดียวกัน และ ${payload.targetName || 'เป้าหมาย'} ถูกลากออกจากวงประชุม${payload.roleName ? ` (เป็น${payload.roleName})` : ''}`
        };
    }

    if (type === 'vote-no-elimination') {
        return {
            type,
            lead: 'วงโหวตปิดลง แต่ยังไม่มีใครถูกชี้เป็นคนผิด',
            detail: payload.reason || 'คะแนนยังไม่ขาดหรือเสมอกัน ทำให้วันนี้ไม่มีใครถูกลากออกจากเกม'
        };
    }

    if (type === 'prince-reveal') {
        return {
            type,
            lead: `${payload.targetName || 'เป้าหมาย'} ถูกโหวตออก แต่เปิดตัวว่าเป็นเจ้าชาย`,
            detail: `${payload.targetName || 'เจ้าชาย'} ใช้สิทธิ์เจ้าชายรอดจากการโหวตได้ 1 ครั้ง วันนี้จึงไม่มีใครออกจากหมู่บ้าน`
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
    const wolvesWereSick = isWolfPackSick(room);

    const attackedPlayer = attackedPlayerId ? getPlayer(room, attackedPlayerId) : null;
    const eliminatedPlayers = [];
    const publicEvents = [];
    let immuneTargetId = null;
    let blockedKillTargetId = null;

    // เกราะบอดี้การ์ดแตกเฉพาะตอนที่บอดี้การ์ดเป็นผู้คุ้มกันคนเดียวของเป้าที่ถูกฆ่า
    function breakSoleBodyguards(targetId) {
        const otherProtections = [
            ...Object.values(room.gameState.nightActions.doctorSaves || {}),
            ...Object.values(room.gameState.nightActions.witchHeals || {}),
            ...room.gameState.players
                .filter(player => player.role === 'cleric' && player.clericBlessTargetId)
                .map(player => player.clericBlessTargetId)
        ];
        if (otherProtections.includes(targetId)) {
            return;
        }
        Object.entries(room.gameState.nightActions.bodyguardProtects || {}).forEach(([guardId, protectedId]) => {
            if (protectedId === targetId) {
                bodyguardBreakIds.add(guardId);
            }
        });
    }

    if (isFirstNight(room)) {
        pushHistory(room, 'คืนแรกผ่านไปแบบเงียบผิดปกติ หมาป่ายังออกล่าไม่ได้ คืนนี้จึงไม่มีใครตาย', 'night');
    } else if (wolvesWereSick) {
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} หมาป่าไม่ได้ออกล่า`, 'night');
    } else if (attackedPlayer && (attackedPlayer.role === 'fool' || attackedPlayer.role === 'serialKiller')) {
        immuneTargetId = attackedPlayerId;
        // Public text must match a normal protected save so wolves can't identify the Fool.
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} ไม่มีใครตาย เพราะมีคนปกป้องสำเร็จ`, 'night');
    } else if (attackedPlayer && attackedPlayer.alive !== false && !protectedTargets.has(attackedPlayerId)) {
        markPlayerDead(attackedPlayer, 'ถูกหมาป่าโจมตีในตอนกลางคืน');
        eliminatedPlayers.push(attackedPlayer);
        publicEvents.push(buildNightPublicEvent(attackedPlayer, 'wolf-attack'));
        pushHistory(room, `${attackedPlayer.name} ถูกกำจัดในตอนกลางคืน`, 'night');
        // ผู้ติดเชื้อ: หมาป่าที่กัดกินจะป่วย คืนถัดไปล่าไม่ได้ (เฉพาะตายจากหมาป่าเท่านั้น)
        if (attackedPlayer.role === 'diseased') {
            room.gameState.wolvesSickNight = Number(room.gameState.dayNumber || 0) + 1;
        }
    } else if (attackedPlayer) {
        // Armour only breaks when the bodyguard(s) were the sole protection on the target.
        breakSoleBodyguards(attackedPlayerId);
        blockedKillTargetId = attackedPlayerId;
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} ไม่มีใครตาย เพราะมีคนปกป้องสำเร็จ`, 'night');
    } else {
        pushHistory(room, `คืนที่ ${room.gameState.dayNumber} หมาป่าลังเลจนไม่มีใครตาย`, 'night');
    }

    // ฆาตกรต่อเนื่อง: ฆ่าหลังหมาป่า โดนกันได้ด้วยหมอ/บอดี้การ์ด/ยาช่วย/พรนักบวชเหมือนหมาป่า
    // คนบ้ากันได้แค่หมาป่า — ฆาตกรฆ่าคนบ้าได้
    if (!isFirstNight(room)) {
        Object.entries(room.gameState.nightActions.serialKills || {}).forEach(([killerId, targetId]) => {
            if (!targetId || targetId === SKIP_TARGET_ID) {
                return;
            }
            const killer = getPlayer(room, killerId);
            const target = getPlayer(room, targetId);
            if (!killer || !target || killer.role !== 'serialKiller') {
                return;
            }
            killer.serialKillerLastResult = { actorId: killerId, targetId, targetName: target.name, dayNumber: room.gameState.dayNumber };
            if (target.alive === false) {
                killer.serialKillerLastResult.alreadyDead = true;
                return;
            }
            if (protectedTargets.has(targetId)) {
                breakSoleBodyguards(targetId);
                killer.serialKillerLastResult.blocked = true;
                if (blockedKillTargetId !== targetId) {
                    pushHistory(room, `คืนที่ ${room.gameState.dayNumber} มีคนถูกลอบทำร้าย แต่รอดเพราะมีคนปกป้อง`, 'night');
                }
                blockedKillTargetId = blockedKillTargetId || targetId;
                return;
            }
            markPlayerDead(target, 'ถูกฆาตกรต่อเนื่องสังหารในตอนกลางคืน');
            eliminatedPlayers.push(target);
            publicEvents.push(buildNightPublicEvent(target, 'serial-kill'));
            pushHistory(room, `${target.name} ถูกฆาตกรต่อเนื่องสังหารในตอนกลางคืน`, 'night');
        });
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

    // ผลกลางคืนคือเหตุการณ์ล่าสุดแล้ว — ล้างสรุปของกลางวันก่อนหน้า กันหน้าจบเกมเล่าเหตุการณ์ผิดช่วง
    room.gameState.lastResolvedDay = null;
    room.gameState.lastResolvedNight = {
        attackedPlayerId,
        eliminatedPlayerIds: eliminatedPlayers.map(player => player.playerId),
        publicEvents: publicEvents.filter(Boolean),
        protectedTargets: Array.from(protectedTargets),
        poisonedTargetIds,
        immuneTargetId,
        blockedKillTargetId,
        wolvesWereSick
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
        case 'apprenticeSeer':
            return isRealChoice(nightActions.seerChecks?.[actorId]);
        case 'serialKiller':
            return isRealChoice(nightActions.serialKills?.[actorId]);
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
    room.gameState.voteClosesAt = null;
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

    if (eliminatedPlayer && eliminatedPlayer.alive !== false && eliminatedPlayer.role === 'prince' && !eliminatedPlayer.princeRevealed) {
        // เจ้าชาย: โดนโหวตออกครั้งแรก เปิดตัวต่อหน้าทุกคนและไม่ตาย วันนี้จึงไม่มีใครออก
        eliminatedPlayer.princeRevealed = true;
        publicEvents.push(buildDayPublicEvent('prince-reveal', { targetName: eliminatedPlayer.name }));
        pushHistory(room, `${eliminatedPlayer.name} ถูกโหวตออก แต่เปิดตัวว่าเป็นเจ้าชาย จึงรอดไปได้ครั้งหนึ่ง`, 'day');
        room.gameState.lastResolvedDay = {
            eliminatedPlayerId: null,
            princeRevealedId: eliminatedPlayer.playerId,
            resolutionType: 'prince-reveal',
            skippedByMajority: false,
            skipVoteWeight: getDaySkipVoteWeight(room),
            publicEvents
        };
        syncAlivePlayerIds(room);
        if (checkWinCondition(room)) {
            return { resolved: true, winner: room.gameState.winner };
        }
        startNightPhase(room);
        return { resolved: true, winner: null, princeRevealed: true };
    }

    if (eliminatedPlayer && eliminatedPlayer.alive !== false) {
        markPlayerDead(eliminatedPlayer, 'ถูกโหวตออกในเวลากลางวัน');
        publicEvents.push(buildDayPublicEvent('vote-elimination', {
            targetName: eliminatedPlayer.name,
            roleName: room.settings?.werewolfRevealOnDeath === true ? (eliminatedPlayer.roleInfo?.thaiName || null) : null
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
            if (isWolfPackSick(room) && !isSkip) {
                throw new Error('ฝูงหมาป่าติดเชื้อจากเหยื่อเมื่อคืน คืนนี้ล่าใครไม่ได้');
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
        case 'apprenticeSeer':
        case 'seer':
            if (actor.role === 'apprenticeSeer' && !isApprenticeSeerActive(room)) {
                throw new Error('ผู้หยั่งรู้ยังมีชีวิตอยู่ ศิษย์จึงยังไม่มีพลังตรวจ');
            }
            if (room.gameState.nightActions.seerChecks[actorId] && room.gameState.nightActions.seerChecks[actorId] !== SKIP_TARGET_ID) {
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
            if (room.gameState.nightActions.oracleReads[actorId] && room.gameState.nightActions.oracleReads[actorId] !== SKIP_TARGET_ID) {
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
        case 'witch': {
            // แม่มดใช้ยาได้ทั้ง 2 ขวดในคืนเดียว (Miller's Hollow) · ช่วยตัวเองได้ · วางยาตัวเองไม่ได้
            // กด "ไม่ใช้" ขวดใดขวดหนึ่ง = ไม่ใช้ทุกขวดที่ยังไม่ได้เลือกเป้า (เลือกเป้าทีหลังได้ ทับค่าไม่ใช้)
            const isHeal = actionType === 'witch-heal';
            const isPoison = actionType === 'witch-poison';
            if (!isHeal && !isPoison) {
                throw new Error('แม่มดต้องเลือกว่าจะใช้ยาช่วยชีวิตหรือยาพิษ');
            }
            const ownMap = isHeal ? room.gameState.nightActions.witchHeals : room.gameState.nightActions.witchPoisons;
            const otherMap = isHeal ? room.gameState.nightActions.witchPoisons : room.gameState.nightActions.witchHeals;
            const ownUsed = isHeal ? actor.witchHealUsed : actor.witchPoisonUsed;
            const otherUsed = isHeal ? actor.witchPoisonUsed : actor.witchHealUsed;
            if (ownUsed) {
                throw new Error(isHeal ? 'คุณใช้ยาช่วยชีวิตไปแล้ว' : 'คุณใช้ยาพิษไปแล้ว');
            }
            if (isPoison && !isSkip && actorId === targetPlayerId) {
                throw new Error('แม่มดวางยาพิษตัวเองไม่ได้');
            }
            if (ownMap[actorId] === targetPlayerId) {
                delete ownMap[actorId];
                delete room.gameState.nightSkips[actorId];
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
            }
            ownMap[actorId] = isSkip ? SKIP_TARGET_ID : targetPlayerId;
            if (isSkip && !otherUsed && !otherMap[actorId]) {
                otherMap[actorId] = SKIP_TARGET_ID;
            }
            break;
        }
        case 'serialKiller':
            if (isFirstNight(room) && !isSkip) {
                throw new Error('คืนแรกยังไม่มีใครลงมือฆ่าได้');
            }
            if (room.gameState.nightActions.serialKills[actorId] === targetPlayerId) {
                delete room.gameState.nightActions.serialKills[actorId];
                delete room.gameState.nightSkips[actorId];
                actor.serialKillerLastTargetId = null;
                room.gameState.lastAction = Date.now();
                return { resolved: false, unvoted: true };
            }
            if (isSkip) {
                room.gameState.nightActions.serialKills[actorId] = SKIP_TARGET_ID;
                break;
            }
            if (actorId === targetPlayerId) {
                throw new Error('ฆาตกรต่อเนื่องเลือกฆ่าตัวเองไม่ได้');
            }
            room.gameState.nightActions.serialKills[actorId] = targetPlayerId;
            actor.serialKillerLastTargetId = targetPlayerId;
            break;
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

function submitDayVote(room, actorId, targetPlayerId, options = {}) {
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

    if (options.lastCall && room.gameState.voteClosesAt) {
        return { resolved: false, lastCall: true, voteClosesAt: room.gameState.voteClosesAt };
    }

    if (canSkipDayVote(room) || canResolveDay(room)) {
        return options.lastCall ? startVoteLastCall(room) : resolveDayVote(room);
    }

    return { resolved: false };
}

function submitMayorReveal(room, actorId, options = {}) {
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
        return options.lastCall ? { ...startVoteLastCall(room), mayorRevealed: true } : resolveDayVote(room);
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

function useRevealAction(room, actorId, targetPlayerId, options = {}) {
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
            ...(options.lastCall ? startVoteLastCall(room) : resolveDayVote(room)),
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
                if (!canWolvesHuntTonight(room)) {
                    break;
                }
                // Follow the pack: copy a pick another living wolf already made; never random.
                const votes = room.gameState.nightActions.werewolfVotes || {};
                const packPick = Object.entries(votes)
                    .filter(([voterId, targetId]) => voterId !== actor.playerId && targetId && targetId !== SKIP_TARGET_ID)
                    .map(([voterId, targetId]) => ({ voter: getPlayer(room, voterId), target: getPlayer(room, targetId) }))
                    .filter(({ voter, target }) => voter && voter.alive !== false && isWerewolfRole(voter.role) && target && target.alive !== false)
                    .map(({ target }) => target.playerId);
                const followId = getWeightedTarget(
                    Object.fromEntries(Object.entries(votes).filter(([voterId, targetId]) => voterId !== actor.playerId && packPick.includes(targetId))),
                    room,
                    { alphaWolf: 2 }
                ); // tie between other wolves → stay neutral (skip)
                room.gameState.nightActions.werewolfVotes[actor.playerId] = followId || SKIP_TARGET_ID;
                break;
            }
            case 'seer':
                // ไม่กดเลือก = ข้ามคืนนี้ (เหมือนบทบาทอื่น) ไม่สุ่มส่องให้ฟรี
                room.gameState.nightActions.seerChecks[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'doctor':
                // Don't burn a limited save on a random target when the doctor is AFK.
                room.gameState.nightActions.doctorSaves[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'bodyguard':
                // Don't risk the bodyguard's armour on a random target when AFK.
                room.gameState.nightActions.bodyguardProtects[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'witch': {
                if (!actor.witchHealUsed && !room.gameState.nightActions.witchHeals[actor.playerId]) {
                    room.gameState.nightActions.witchHeals[actor.playerId] = SKIP_TARGET_ID;
                }
                if (!actor.witchPoisonUsed && !room.gameState.nightActions.witchPoisons[actor.playerId]) {
                    room.gameState.nightActions.witchPoisons[actor.playerId] = SKIP_TARGET_ID;
                }
                break;
            }
            case 'apprenticeSeer':
                room.gameState.nightActions.seerChecks[actor.playerId] = SKIP_TARGET_ID;
                break;
            case 'serialKiller':
                // บทฆ่า: AFK = ไม่ฆ่า (ไม่สุ่มฆ่าแทน)
                room.gameState.nightActions.serialKills[actor.playerId] = SKIP_TARGET_ID;
                break;
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
        clericBlesses: {},
        serialKills: {}
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
            if (isWolfPackSick(room)) {
                return [{
                    type: 'night-kill',
                    label: 'ฝูงหมาป่าติดเชื้อ',
                    description: 'เหยื่อเมื่อคืนเป็นผู้ติดเชื้อ คืนนี้ฝูงหมาป่าป่วยจนออกล่าไม่ได้ — กด «ไม่ใช้สกิลคืนนี้» แล้วรอเช้า',
                    selectedTargetId: nightActions.werewolfVotes?.[viewer.playerId] || null,
                    allowSkip: true,
                    emptyStateText: 'คืนนี้หมาป่าล่าใครไม่ได้',
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
        case 'apprenticeSeer':
            if (!isApprenticeSeerActive(room)) {
                return [];
            }
            // fall through: ศิษย์ที่ได้พลังแล้วใช้การ์ดตรวจออร่าเดียวกับผู้หยั่งรู้
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
            // แม่มดเห็นเหยื่อที่หมาป่ากำลังเล็ง (กติกา Miller's Hollow) — อัปเดตสดจนกว่าคืนจะจบ
            let wolfTargetName = null;
            if (canWolvesHuntTonight(room)) {
                const wolfVotes = Object.fromEntries(Object.entries(nightActions.werewolfVotes || {}).filter(([, targetId]) => targetId && targetId !== SKIP_TARGET_ID));
                const wolfTargetId = getWeightedTarget(wolfVotes, room, { alphaWolf: 2 });
                wolfTargetName = wolfTargetId ? (getPlayer(room, wolfTargetId)?.name || null) : null;
            }
            const victimHint = isFirstNight(room)
                ? 'คืนแรกหมาป่ายังไม่ล่า'
                : (wolfTargetName ? `หมาป่ากำลังเล็ง: ${wolfTargetName}` : 'หมาป่ายังไม่ได้เลือกเหยื่อ');

            if (!viewer.witchHealUsed) {
                const healSkipped = selectedHealTargetId === SKIP_TARGET_ID;
                actions.push({
                    type: 'witch-heal',
                    label: healSkipped ? 'คืนนี้คุณเลือกไม่ใช้ยาช่วยชีวิต' : (selectedHealTargetId ? 'คืนนี้คุณเลือกใช้ยาช่วยชีวิตแล้ว' : 'ยาช่วยชีวิตของแม่มด'),
                    description: `${victimHint} · เลือก 1 คนเพื่อกันตายคืนนี้ (ช่วยตัวเองได้) ใช้ได้ 1 ครั้งตลอดเกม แตะเป้าเดิมซ้ำเพื่อยกเลิก`,
                    selectedTargetId: selectedHealTargetId,
                    witchVictimName: wolfTargetName,
                    allowSkip: true,
                    targets: alivePlayers.map(player => ({
                        playerId: player.playerId,
                        name: player.name
                    }))
                });
            }

            if (!viewer.witchPoisonUsed) {
                const poisonSkipped = selectedPoisonTargetId === SKIP_TARGET_ID;
                actions.push({
                    type: 'witch-poison',
                    label: poisonSkipped ? 'คืนนี้คุณเลือกไม่ใช้ยาพิษ' : (selectedPoisonTargetId ? 'คืนนี้คุณเลือกใช้ยาพิษแล้ว' : 'ยาพิษของแม่มด'),
                    description: 'เลือก 1 คนเพื่อวางยาพิษคืนนี้ ใช้ได้ 1 ครั้งตลอดเกม ใช้คู่กับยาช่วยชีวิตในคืนเดียวกันได้',
                    selectedTargetId: selectedPoisonTargetId,
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
        case 'serialKiller': {
            if (isFirstNight(room)) {
                return [{
                    type: 'serial-kill',
                    label: 'คืนแรกของฆาตกร',
                    description: 'คืนแรกยังไม่มีใครลงมือ — กด «ไม่ใช้สกิลคืนนี้» แล้วจำหน้าเหยื่อไว้ก่อน',
                    selectedTargetId: nightActions.serialKills?.[viewer.playerId] || null,
                    allowSkip: true,
                    emptyStateText: 'คืนแรกยังฆ่าใครไม่ได้',
                    targets: []
                }];
            }
            return [{
                type: 'serial-kill',
                label: 'เลือกเหยื่อของฆาตกร',
                description: 'เลือก 1 คนเพื่อสังหารคืนนี้ (เปลี่ยน/ยกเลิกได้จนจบคืน) หมอ บอดี้การ์ด ยาช่วย และพรนักบวชกันได้',
                selectedTargetId: nightActions.serialKills?.[viewer.playerId] || null,
                allowSkip: true,
                targets: alivePlayers.filter(player => player.playerId !== viewer.playerId).map(player => ({
                    playerId: player.playerId,
                    name: player.name
                }))
            }];
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
    const readyCount = room.gameState.phase === 'night' ? getNightReadyCount(room) : 0;
    const allRolesDecided = room.gameState.phase === 'night' ? haveAllRequiredNightActorsDecided(room) : false;
    const viewerIsWolf = !!viewer && viewer.alive !== false && isWerewolfRole(viewer.role);
    const extra = {
        readyCount,
        // เสียงพร้อมครบแล้ว แต่ยังมีคนมีสกิลที่ยังไม่ตัดสินใจ (ไม่บอกจำนวน กันเดาบทของคนที่ตาย)
        waitingForRoles: readyCount >= skipNeeded && !allRolesDecided,
        selfReady: !!viewer && isPlayerReadyForMorning(room, viewer),
        wolvesSplit: viewerIsWolf && !isFirstNight(room) && !isWolfPackSettled(room)
    };

    if (!viewer || viewer.alive === false || room.gameState.phase !== 'night') {
        return {
            canSkip: false,
            hasSkipped: false,
            skipCount,
            totalAlive,
            skipNeeded,
            readyCount: extra.readyCount,
            waitingForRoles: extra.waitingForRoles
        };
    }

    return {
        canSkip: !hasSkipped,
        hasSkipped,
        skipCount,
        totalAlive,
        skipNeeded,
        ...extra
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
    const blockedPlayer = summary.blockedKillTargetId ? getPlayer(room, summary.blockedKillTargetId) : null;
    const revealOnDeath = room.settings?.werewolfRevealOnDeath === true;
    const roleSuffix = player => (revealOnDeath && player?.roleInfo?.thaiName ? ` (เป็น${player.roleInfo.thaiName})` : '');

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
            detail: (publicEvent?.detail || `${eliminatedPlayer.name} ไม่รอดในคืนนี้`) + roleSuffix(eliminatedPlayer)
        };
    }

    if (eliminatedPlayers.length > 1) {
        return {
            title: `☀️ เช้าวันที่ ${dayNumber}`,
            outcomeType: 'multiple-deaths',
            lead: `รุ่งเช้ามีคนหายไปถึง ${eliminatedPlayers.length} คน`,
            detail: publicEvents.length > 0
                ? publicEvents.map(event => event.detail + roleSuffix(getPlayer(room, event.playerId))).join(' • ')
                : eliminatedPlayers.map(player => player.name).join(', ')
        };
    }

    // Fool immunity is announced exactly like a protected save (no distinct outcome).
    if (attackedPlayer || immunePlayer || blockedPlayer) {
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
            detail: room.settings?.werewolfRevealOnDeath === true && eliminatedPlayer.roleInfo?.thaiName
                ? `${eliminatedPlayer.name} คือ ${eliminatedPlayer.roleInfo.thaiName}`
                : `บทบาทของ ${eliminatedPlayer.name} จะเฉลยเมื่อเกมจบ`
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
            } else if (isWolfPackSick(room)) {
                notes.push('🤒 เหยื่อเมื่อคืนเป็นผู้ติดเชื้อ คืนนี้ฝูงหมาป่าป่วยจนออกล่าไม่ได้');
            } else if (viewer.role === 'alphaWolf') {
                notes.push('👑 โหวตล่าของคุณมีน้ำหนัก 2 เสียงในฐานะ Alpha Wolf');
            }
            break;
        }
        case 'seer':
            notes.push('🔮 คุณตรวจผู้เล่นได้คืนละ 1 คน และดูตัวเองไม่ได้');
            notes.push('🌓 ผลตรวจจะเห็นแค่ ดี, ไม่ดี หรือ ไม่ทราบ');
            notes.push('🕶️ อัลฟ่าหมาป่าและคนบ้าจะขึ้นว่า ไม่ทราบ');
            notes.push('🌕 ไลแคน (ชาวบ้าน) และฆาตกรต่อเนื่องจะขึ้นว่า ไม่ดี');
            break;
        case 'doctor':
            notes.push(`💉 คุณช่วยตัวเองหรือคนอื่นได้ แต่ใช้ได้รวม ${Math.max(0, 2 - Number(viewer.doctorSaveUses || 0))} ครั้งที่เหลือตลอดเกม`);
            break;
        case 'witch':
            notes.push(viewer.witchHealUsed ? '🧪 คุณใช้ยาช่วยชีวิตไปแล้ว' : '🧪 คุณยังมียาช่วยชีวิต 1 ครั้ง ใช้กันตายให้ผู้เล่น 1 คนในคืนนี้');
            notes.push(viewer.witchPoisonUsed ? '☠️ คุณใช้ยาพิษไปแล้ว' : '☠️ คุณยังมียาพิษ 1 ครั้ง ใช้กำจัดผู้เล่น 1 คนในตอนกลางคืน');
            notes.push('🌙 ใช้ยาทั้ง 2 ขวดในคืนเดียวกันได้ · ระบบบอกว่าหมาป่ากำลังเล็งใคร · ช่วยตัวเองได้ แต่วางยาตัวเองไม่ได้');
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
        case 'serialKiller': {
            notes.push('🔪 ตั้งแต่คืนที่ 2 เลือกฆ่าได้คืนละ 1 คน — หมาป่าฆ่าคุณไม่ได้');
            notes.push('🛡️ หมอ บอดี้การ์ด ยาช่วยของแม่มด และพรนักบวชกันการฆ่าของคุณได้ · ยาพิษ/ปืน/โหวตยังฆ่าคุณได้');
            const last = viewer.serialKillerLastResult;
            if (last && last.targetName) {
                notes.push(last.blocked
                    ? `🩹 คืนที่ ${last.dayNumber || '-'} ${last.targetName} รอดเพราะมีคนปกป้อง`
                    : (last.alreadyDead ? `💀 คืนที่ ${last.dayNumber || '-'} ${last.targetName} ตายก่อนคุณลงมือ` : `🩸 คืนที่ ${last.dayNumber || '-'} คุณจัดการ ${last.targetName} แล้ว`));
            }
            break;
        }
        case 'prince':
            notes.push(viewer.princeRevealed
                ? '🤴 คุณเปิดตัวเป็นเจ้าชายแล้ว ถ้าถูกโหวตออกอีกครั้งจะตายตามปกติ'
                : '🤴 ถ้าคุณถูกโหวตออกครั้งแรก ระบบจะเปิดตัวคุณเป็นเจ้าชายและคุณไม่ตาย');
            notes.push('🌙 กลางคืนคุณตายได้ตามปกติ');
            break;
        case 'lycan':
            notes.push('🌕 คุณเป็นชาวบ้าน แต่ผู้หยั่งรู้จะเห็นคุณเป็น «ไม่ดี» — เตรียมอธิบายตัวเองให้ดี');
            break;
        case 'diseased':
            notes.push('🤒 ถ้าหมาป่ากัดคุณตาย คืนถัดไปฝูงหมาป่าจะป่วยและล่าใครไม่ได้');
            notes.push('ℹ️ ตายด้วยวิธีอื่น (โหวต ยาพิษ ปืน ฆาตกร) ไม่มีผล');
            break;
        case 'apprenticeSeer':
            if (isApprenticeSeerActive(room)) {
                notes.push('🧿 ไม่มีผู้หยั่งรู้เหลือรอดแล้ว — คุณตรวจออร่าได้คืนละ 1 คนแทน (ดี / ไม่ดี / ไม่ทราบ)');
            } else {
                notes.push('🧿 ตอนนี้ผู้หยั่งรู้ยังมีชีวิต คุณยังไม่มีสกิล เมื่อผู้หยั่งรู้ตาย คุณจะได้พลังตรวจแทน');
            }
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
    if (player && player.alive === false) {
        return room.gameState;
    }

    ensureActionMaps(room);
    if (player) {
        markPlayerDead(player, 'ออกจากเกม');
        pushHistory(room, `${player.name} ออกจากเกม`, 'system');
    }
    // roomManager.leaveRoom ถอดที่นั่งออกจาก gameState ไปก่อนแล้ว (ออกเอง/เตะ/หลุดเกินเวลา)
    // เดิมฟังก์ชันนี้ return ทันทีเมื่อหาที่นั่งไม่เจอ → ไม่เช็กผลชนะ/ไม่ปิดคืนต่อ (เช่น หมาป่าตัวสุดท้ายออก เกมยังเดินต่อ)
    // จึงล้าง action ค้าง + เช็กผลชนะ + เดินเฟสต่อเหมือนกันทั้งสองกรณี
    syncAlivePlayerIds(room);

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
    if (phase === 'night' && maybeAutoEndNight(room).resolved) {
        return room.gameState;
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
    const isFinished = room.gameState.phase === 'finished';
    // คนตายเห็นบททุกคน (ตั้งค่าห้อง ค่าเริ่มต้นเปิด) — ส่งเฉพาะ state ของคนที่ตายแล้วเท่านั้น
    const deadRoleView = !isFinished
        && !!viewer && viewer.alive === false
        && room.settings?.werewolfDeadSeeRoles !== false
        && room.gameState.phase !== 'lobby';
    const showRoles = isFinished || deadRoleView;
    const revealOnDeath = room.settings?.werewolfRevealOnDeath === true && room.gameState.phase !== 'lobby';
    // บทที่ทุกคนรู้แล้ว: คนตาย (ถ้าเปิด "เปิดบทเมื่อตาย") และเจ้าชายที่เปิดตัวแล้ว
    const isPubliclyKnownRole = player => (revealOnDeath && player.alive === false)
        || (player.role === 'prince' && !!player.princeRevealed);
    const timerSettings = sanitizeWerewolfSettings({}, room.settings || {});

    return {
        mode: 'werewolf',
        isHost: !!viewerPlayerId && room.admin === viewerPlayerId,
        deadRoleView,
        voteClosesAt: room.gameState.phase === 'day-vote' ? (room.gameState.voteClosesAt || null) : null,
        timerSettings,
        roomId: room.roomId,
        roomName: room.name,
        phase: room.gameState.phase || 'lobby',
        phaseEndsAt: room.gameState.phaseEndsAt || null,
        status: room.gameState.status || '',
        dayNumber: room.gameState.dayNumber || 0,
        winner: room.gameState.winner || null,
        // day-vote ยังส่งข่าวเมื่อคืนให้ (แถบ "ข่าวล่าสุด"); ตอนจบเกมส่งเฉพาะถ้าเกมจบในกลางคืน
        morningAnnouncement: ['day-discussion', 'day-vote'].includes(room.gameState.phase)
            || (room.gameState.phase === 'finished' && !room.gameState.lastResolvedDay)
            ? buildMorningAnnouncement(room)
            : null,
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
            revealedRole: isFinished
                ? (player.revealedRole || null)
                : ((deadRoleView || isPubliclyKnownRole(player)) ? (player.roleInfo?.thaiName || player.role || null) : null),
            roleId: (showRoles || isPubliclyKnownRole(player)) ? (player.role || null) : null,
            roleTeam: (showRoles || isPubliclyKnownRole(player)) ? (player.roleInfo?.team || null) : null,
            roleThaiName: (showRoles || isPubliclyKnownRole(player)) ? (player.roleInfo?.thaiName || null) : null,
            princeRevealed: player.role === 'prince' && !!player.princeRevealed,
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
    VOTE_LAST_CALL_MS,
    WEREWOLF_TIMER_CHOICES,
    WEREWOLF_TIMER_DEFAULTS,
    sanitizeWerewolfSettings,
    getPhaseDurationMs,
    maybeAutoEndNight,
    getNightReadyCount,
    id: 'werewolf',
    label: 'Werewolf',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    MAX_WOLF_COUNT,
    NEW_ROLE_IDS,
    getRecommendedDistribution,
    getRecommendedWolfCount,
    sanitizeWolfCount,
    checkWinCondition,
    isApprenticeSeerActive,
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
