const werewolfEngine = require('../games/werewolfEngine');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function expectThrows(action, pattern, message) {
    try {
        action();
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!pattern.test(text)) {
            throw new Error(`${message}: unexpected error "${text}"`);
        }
        return text;
    }

    throw new Error(`${message}: expected error`);
}

function createPlayers(count) {
    return Array.from({ length: count }, (_, index) => ({
        playerId: `player-${index + 1}`,
        playerName: `Player ${index + 1}`,
        color: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'][index % 5],
        avatar: '👤',
        avatarFrame: 'none'
    }));
}

function createRoom(roleIds, playerCount = roleIds.length) {
    const room = {
        roomId: `smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: 'Werewolf role smoke',
        settings: {
            gameMode: 'werewolf',
            werewolfRoles: roleIds,
            roundTime: 30
        },
        players: createPlayers(playerCount)
    };

    werewolfEngine.startGame(room);
    return room;
}

function getRoleMap(room) {
    return room.gameState.players.reduce((result, player) => {
        result[player.role] = result[player.role] || [];
        result[player.role].push(player);
        return result;
    }, {});
}

function getSingleRole(room, roleId) {
    const rolePlayer = room.gameState.players.find(player => player.role === roleId);
    assert(rolePlayer, `missing role ${roleId}`);
    return rolePlayer;
}

function getAliveVillager(room) {
    const villager = room.gameState.players.find(player => player.role === 'villager' && player.alive !== false);
    assert(villager, 'missing alive villager');
    return villager;
}

function resetNightPhase(room, dayNumber) {
    room.gameState.phase = 'night';
    room.gameState.phaseEndsAt = null;
    room.gameState.status = 'werewolf_night';
    room.gameState.dayNumber = dayNumber;
    room.gameState.nightActions = {
        werewolfVotes: {},
        seerChecks: {},
        doctorSaves: {},
        bodyguardProtects: {},
        witchHeals: {},
        witchPoisons: {}
    };
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.lastResolvedNight = null;
    room.gameState.lastResolvedDay = null;
    room.gameState.alivePlayerIds = room.gameState.players.filter(player => player.alive !== false).map(player => player.playerId);
    room.gameState.lastAction = Date.now();
}

function testMayorRules() {
    const room = createRoom(['werewolf', 'mayor', 'doctor', 'bodyguard'], 5);
    const mayor = getSingleRole(room, 'mayor');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const villager = getAliveVillager(room);

    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);

    assert(room.gameState.phase === 'day-discussion', 'night 1 should move to day discussion');

    const beforeReveal = werewolfEngine.buildClientState(room, mayor.playerId);
    assert(beforeReveal.actionState.discussionActions.canRevealMayor, 'mayor should be able to reveal in morning discussion');
    assert(beforeReveal.actionState.discussionActions.currentVoteWeight === 1, 'mayor vote weight should be 1 before reveal');

    werewolfEngine.submitMayorReveal(room, mayor.playerId);

    const afterReveal = werewolfEngine.buildClientState(room, mayor.playerId);
    assert(afterReveal.actionState.discussionActions.mayorRevealed, 'mayor should be marked revealed');
    assert(afterReveal.actionState.discussionActions.currentVoteWeight === 2, 'mayor vote weight should be 2 after reveal');

    room.gameState.players
        .filter(player => player.alive !== false)
        .forEach(player => {
            werewolfEngine.submitDiscussionSkip(room, player.playerId);
        });

    assert(room.gameState.phase === 'day-vote', 'discussion skip should move to day vote');

    werewolfEngine.submitDayVote(room, mayor.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitDayVote(room, doctor.playerId, werewolfEngine.SKIP_TARGET_ID);
    const resolution = werewolfEngine.submitDayVote(room, villager.playerId, werewolfEngine.SKIP_TARGET_ID);

    assert(resolution && resolution.resolved, 'skip majority should resolve immediately');
    assert(room.gameState.phase === 'night', 'skip majority should move room to night');
    assert(
        (room.gameState.history || []).some(entry => /เสียงข้ามโหวตเกินครึ่ง/.test(entry.message)),
        'history should record skip-majority resolution'
    );

    return {
        mayorReveal: true,
        weightedSkipMajority: true
    };
}

function testDoctorRules() {
    const room = createRoom(['werewolf', 'doctor'], 4);
    const doctor = getSingleRole(room, 'doctor');
    const werewolf = getSingleRole(room, 'werewolf');
    const villager = getAliveVillager(room);

    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    assert(doctor.doctorSaveUses === 1, 'doctor self-save should consume first total use');

    resetNightPhase(room, 3);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, doctor.playerId, villager.playerId);
    assert(doctor.doctorSaveUses === 2, 'doctor protecting another player should consume second total use');

    resetNightPhase(room, 4);
    expectThrows(
        () => werewolfEngine.submitNightAction(room, doctor.playerId, villager.playerId),
        /หมอปกป้องได้รวม 2 ครั้งต่อเกมเท่านั้น/,
        'doctor should not be able to use a third save'
    );

    return {
        doctorSelfProtect: true,
        doctorProtectOthers: true,
        doctorTotalUseLimit: true
    };
}

function testBodyguardRules() {
    const room = createRoom(['werewolf', 'bodyguard'], 4);
    const bodyguard = getSingleRole(room, 'bodyguard');
    const werewolf = getSingleRole(room, 'werewolf');
    const villager = getAliveVillager(room);

    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, villager.playerId);

    assert(room.gameState.lastProtectedByBodyguard[bodyguard.playerId] === villager.playerId, 'bodyguard should be able to protect another player');
    assert(bodyguard.bodyguardArmorBroken === false, 'bodyguard armor should remain intact if no attack is blocked');

    resetNightPhase(room, 3);
    expectThrows(
        () => werewolfEngine.submitNightAction(room, bodyguard.playerId, villager.playerId),
        /บอดี้การ์ดห้ามปกป้องคนเดิมสองคืนติดกัน/,
        'bodyguard should not protect the same target on consecutive nights'
    );

    werewolfEngine.submitNightAction(room, werewolf.playerId, bodyguard.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);

    assert(bodyguard.alive !== false, 'bodyguard should survive when self-protecting against an attack');
    assert(bodyguard.bodyguardArmorBroken, 'bodyguard armor should break after a successful block');

    resetNightPhase(room, 4);
    expectThrows(
        () => werewolfEngine.submitNightAction(room, bodyguard.playerId, villager.playerId),
        /เกราะของบอดี้การ์ดแตกแล้ว/,
        'bodyguard should not act again after armor breaks'
    );

    return {
        bodyguardProtectOthers: true,
        bodyguardSelfProtect: true,
        bodyguardNoRepeatTarget: true,
        bodyguardArmorBreak: true
    };
}

function testSeerReadingRules() {
    const room = createRoom(['alphaWolf', 'werewolf', 'seer', 'fool'], 5);
    const seer = getSingleRole(room, 'seer');
    const alphaWolf = getSingleRole(room, 'alphaWolf');
    const werewolf = getSingleRole(room, 'werewolf');
    const fool = getSingleRole(room, 'fool');
    const villager = getAliveVillager(room);

    function inspectTarget(targetPlayer, dayNumber) {
        resetNightPhase(room, dayNumber);
        werewolfEngine.submitNightAction(room, alphaWolf.playerId, werewolfEngine.SKIP_TARGET_ID);
        werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
        werewolfEngine.submitNightAction(room, seer.playerId, targetPlayer.playerId);

        const state = werewolfEngine.buildClientState(room, seer.playerId);
        return {
            lastSeenRole: state.personalNotes?.lastSeenRole || '',
            latestHistory: state.personalNotes?.seerHistory?.[0] || null
        };
    }

    const alphaReading = inspectTarget(alphaWolf, 2);
    assert(/ไม่ทราบ/.test(alphaReading.lastSeenRole), 'seer should read Alpha Wolf as unknown');
    assert(alphaReading.latestHistory?.resultCode === 'unknown', 'seer history should mark Alpha Wolf as unknown');

    const foolReading = inspectTarget(fool, 3);
    assert(/ไม่ทราบ/.test(foolReading.lastSeenRole), 'seer should read Fool as unknown');
    assert(foolReading.latestHistory?.resultCode === 'unknown', 'seer history should mark Fool as unknown');

    const wolfReading = inspectTarget(werewolf, 4);
    assert(/ไม่ดี/.test(wolfReading.lastSeenRole), 'seer should read normal werewolf as bad');
    assert(wolfReading.latestHistory?.resultCode === 'bad', 'seer history should mark normal werewolf as bad');

    const villagerReading = inspectTarget(villager, 5);
    assert(/ดี/.test(villagerReading.lastSeenRole), 'seer should read villager as good');
    assert(villagerReading.latestHistory?.resultCode === 'good', 'seer history should mark villager as good');

    return {
        seerAlphaUnknown: true,
        seerFoolUnknown: true,
        seerWerewolfBad: true,
        seerVillagerGood: true
    };
}

function main() {
    const tested = {
        ...testMayorRules(),
        ...testDoctorRules(),
        ...testBodyguardRules(),
        ...testSeerReadingRules()
    };

    console.log(`SMOKE_RESULT ${JSON.stringify({ tested })}`);
}

main();