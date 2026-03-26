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

function getAliveVillagePlayer(room, excludedRoleIds = []) {
    const excluded = new Set(excludedRoleIds);
    const villagePlayer = room.gameState.players.find(player => (
        player.alive !== false
        && player.roleInfo?.team === 'village'
        && !excluded.has(player.role)
    ));
    assert(villagePlayer, 'missing alive village player');
    return villagePlayer;
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
    room.gameState.nightSkips = {};
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    room.gameState.dayActionUsedBy = {};
    room.gameState.lastResolvedNight = null;
    room.gameState.lastResolvedDay = null;
    room.gameState.alivePlayerIds = room.gameState.players.filter(player => player.alive !== false).map(player => player.playerId);
    room.gameState.lastAction = Date.now();
}

function submitRemainingNightSkips(room, excludedPlayerIds = []) {
    const excluded = new Set(excludedPlayerIds);

    room.gameState.players.forEach(player => {
        if (room.gameState.phase !== 'night') {
            return;
        }

        if (player.alive === false || excluded.has(player.playerId)) {
            return;
        }

        switch (player.role) {
            case 'werewolf':
            case 'alphaWolf':
                if (!room.gameState.nightActions.werewolfVotes[player.playerId]) {
                    werewolfEngine.submitNightAction(room, player.playerId, werewolfEngine.SKIP_TARGET_ID);
                }
                break;
            case 'seer':
                if (!room.gameState.nightActions.seerChecks[player.playerId]) {
                    werewolfEngine.submitNightAction(room, player.playerId, werewolfEngine.SKIP_TARGET_ID);
                }
                break;
            case 'doctor':
                if (!room.gameState.nightActions.doctorSaves[player.playerId]) {
                    werewolfEngine.submitNightAction(room, player.playerId, werewolfEngine.SKIP_TARGET_ID);
                }
                break;
            case 'bodyguard':
                if (!room.gameState.nightActions.bodyguardProtects[player.playerId]) {
                    werewolfEngine.submitNightAction(room, player.playerId, werewolfEngine.SKIP_TARGET_ID);
                }
                break;
            case 'witch':
                if (!room.gameState.nightActions.witchHeals[player.playerId] && !room.gameState.nightActions.witchPoisons[player.playerId]) {
                    werewolfEngine.submitNightAction(room, player.playerId, werewolfEngine.SKIP_TARGET_ID, 'witch-heal');
                }
                break;
            default:
                break;
        }
    });

    room.gameState.players.forEach(player => {
        if (room.gameState.phase !== 'night') {
            return;
        }

        if (player.alive === false || excluded.has(player.playerId)) {
            return;
        }

        if (!['werewolf', 'alphaWolf', 'seer', 'doctor', 'bodyguard', 'witch'].includes(player.role)) {
            werewolfEngine.submitNightSkip(room, player.playerId);
        }
    });
}

function testNightSkipMajorityRules() {
    const room = createRoom(['werewolf', 'mayor', 'fool'], 3);
    const werewolf = getSingleRole(room, 'werewolf');
    const mayor = getSingleRole(room, 'mayor');
    const fool = getSingleRole(room, 'fool');

    resetNightPhase(room, 2);
    const wolfSkip = werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);

    assert(!wolfSkip.resolved, 'night should not resolve from a single werewolf skip');
    assert(room.gameState.phase === 'night', 'night should stay active after one skip');

    const mayorSkip = werewolfEngine.submitNightSkip(room, mayor.playerId);
    assert(mayorSkip.resolved, 'night should resolve when night skip reaches majority');
    assert(room.gameState.phase === 'day-discussion', 'night skip majority should move room to day discussion');
    assert(
        (room.gameState.history || []).some(entry => /เสียงพร้อมข้ามกลางคืนเกินครึ่ง/.test(entry.message)),
        'history should record night skip majority resolution'
    );

    const foolState = werewolfEngine.buildClientState(room, fool.playerId);
    assert(!foolState.actionState.nightStatus?.canSkip, 'night skip controls should disappear after phase changes');

    return {
        nightSkipMajority: true,
        passiveNightSkipButton: true
    };
}

function testMayorRules() {
    const room = createRoom(['werewolf', 'mayor', 'doctor', 'bodyguard'], 4);
    const mayor = getSingleRole(room, 'mayor');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const villagePlayer = bodyguard;

    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);
    submitRemainingNightSkips(room, [doctor.playerId, bodyguard.playerId]);

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
        .some(player => {
            if (room.gameState.phase !== 'day-discussion') return true;
            werewolfEngine.submitDiscussionSkip(room, player.playerId);
            return false;
        });

    assert(room.gameState.phase === 'day-vote', 'discussion skip should move to day vote');

    werewolfEngine.submitDayVote(room, mayor.playerId, werewolfEngine.SKIP_TARGET_ID);
    const resolution = werewolfEngine.submitDayVote(room, doctor.playerId, werewolfEngine.SKIP_TARGET_ID);

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
    const room = createRoom(['werewolf', 'doctor', 'seer'], 3);
    const doctor = getSingleRole(room, 'doctor');
    const werewolf = getSingleRole(room, 'werewolf');
    const villagePlayer = getSingleRole(room, 'seer');

    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    submitRemainingNightSkips(room, [werewolf.playerId, doctor.playerId]);
    assert(doctor.doctorSaveUses === 1, 'doctor self-save should consume first total use');

    resetNightPhase(room, 3);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, doctor.playerId, villagePlayer.playerId);
    submitRemainingNightSkips(room, [werewolf.playerId, doctor.playerId]);
    assert(doctor.doctorSaveUses === 2, 'doctor protecting another player should consume second total use');

    resetNightPhase(room, 4);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    expectThrows(
        () => werewolfEngine.submitNightAction(room, doctor.playerId, villagePlayer.playerId),
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
    const room = createRoom(['werewolf', 'bodyguard', 'seer'], 3);
    const bodyguard = getSingleRole(room, 'bodyguard');
    const werewolf = getSingleRole(room, 'werewolf');
    const villagePlayer = getSingleRole(room, 'seer');

    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, villagePlayer.playerId);
    submitRemainingNightSkips(room, [werewolf.playerId, bodyguard.playerId]);

    assert(room.gameState.lastProtectedByBodyguard[bodyguard.playerId] === villagePlayer.playerId, 'bodyguard should be able to protect another player');
    assert(bodyguard.bodyguardArmorBroken === false, 'bodyguard armor should remain intact if no attack is blocked');

    resetNightPhase(room, 3);
    expectThrows(
        () => werewolfEngine.submitNightAction(room, bodyguard.playerId, villagePlayer.playerId),
        /บอดี้การ์ดห้ามปกป้องคนเดิมสองคืนติดกัน/,
        'bodyguard should not protect the same target on consecutive nights'
    );

    werewolfEngine.submitNightAction(room, werewolf.playerId, bodyguard.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);
    submitRemainingNightSkips(room, [werewolf.playerId, bodyguard.playerId]);

    assert(bodyguard.alive !== false, 'bodyguard should survive when self-protecting against an attack');
    assert(bodyguard.bodyguardArmorBroken, 'bodyguard armor should break after a successful block');

    resetNightPhase(room, 4);
    expectThrows(
        () => werewolfEngine.submitNightAction(room, bodyguard.playerId, villagePlayer.playerId),
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
    const room = createRoom(['alphaWolf', 'werewolf', 'seer', 'fool', 'doctor'], 5);
    const seer = getSingleRole(room, 'seer');
    const alphaWolf = getSingleRole(room, 'alphaWolf');
    const werewolf = getSingleRole(room, 'werewolf');
    const fool = getSingleRole(room, 'fool');
    const doctor = getSingleRole(room, 'doctor');

    function inspectTarget(targetPlayer, dayNumber) {
        resetNightPhase(room, dayNumber);
        werewolfEngine.submitNightAction(room, alphaWolf.playerId, werewolfEngine.SKIP_TARGET_ID);
        werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
        werewolfEngine.submitNightAction(room, seer.playerId, targetPlayer.playerId);
        submitRemainingNightSkips(room, [alphaWolf.playerId, werewolf.playerId, seer.playerId]);

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

    const villageReading = inspectTarget(doctor, 5);
    assert(/ดี/.test(villageReading.lastSeenRole), 'seer should read village team as good');
    assert(villageReading.latestHistory?.resultCode === 'good', 'seer history should mark village team as good');

    return {
        seerAlphaUnknown: true,
        seerFoolUnknown: true,
        seerWerewolfBad: true,
        seerVillageGood: true
    };
}

function testWitchPoisonFinishAnnouncement() {
    const room = createRoom(['werewolf', 'witch', 'seer'], 3);
    const witch = getSingleRole(room, 'witch');
    const werewolf = getSingleRole(room, 'werewolf');
    const seer = getSingleRole(room, 'seer');

    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    const result = werewolfEngine.submitNightAction(room, witch.playerId, werewolf.playerId, 'witch-poison');
    if (!result.resolved) {
        submitRemainingNightSkips(room, [werewolf.playerId, witch.playerId]);
    }

    assert(room.gameState.phase === 'finished', 'poisoning the last werewolf should finish the game immediately');
    assert(room.gameState.winner === 'village', 'village should win when witch poisons the last werewolf');

    const witchState = werewolfEngine.buildClientState(room, witch.playerId);
    assert(witchState.morningAnnouncement, 'finished state should still expose the last morning announcement');
    assert(/แม่มดวางยาพิษ/.test(witchState.morningAnnouncement.detail || ''), 'morning announcement should explain poison as the cause of death');
    assert(/ไม่รอด/.test(witchState.morningAnnouncement.lead || ''), 'morning announcement should still identify the victim');

    const seerState = werewolfEngine.buildClientState(room, seer.playerId);
    assert(seerState.morningAnnouncement, 'all players should receive the final morning announcement in finished state');

    return {
        witchPoisonFinishAnnouncement: true
    };
}

function testRevealerDayVoteAccess() {
    const room = createRoom(['werewolf', 'revealer', 'doctor'], 3);
    const werewolf = getSingleRole(room, 'werewolf');
    const revealer = getSingleRole(room, 'revealer');
    const doctor = getSingleRole(room, 'doctor');

    werewolfEngine.submitNightAction(room, werewolf.playerId, werewolfEngine.SKIP_TARGET_ID);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    submitRemainingNightSkips(room, [werewolf.playerId, doctor.playerId]);

    assert(room.gameState.phase === 'day-discussion', 'night should move to discussion before testing revealer vote access');

    room.gameState.players
        .filter(player => player.alive !== false)
        .forEach(player => {
            if (room.gameState.phase === 'day-discussion') {
                werewolfEngine.submitDiscussionSkip(room, player.playerId);
            }
        });

    assert(room.gameState.phase === 'day-vote', 'discussion should advance to day vote');

    const dayVoteState = werewolfEngine.buildClientState(room, revealer.playerId);
    assert(dayVoteState.actionState.dayActions.canReveal, 'revealer should still be able to use reveal during day vote');

    const resolution = werewolfEngine.useRevealAction(room, revealer.playerId, werewolf.playerId);
    assert(resolution.resolved, 'revealer action should resolve when it kills the last werewolf');
    assert(room.gameState.phase === 'finished', 'revealer kill on the last werewolf should finish the game');

    const finishedState = werewolfEngine.buildClientState(room, revealer.playerId);
    assert(finishedState.dayResolutionAnnouncement, 'finished state should still expose the last day resolution announcement');
    assert(finishedState.dayResolutionAnnouncement.outcomeType === 'reveal-hit', 'day resolution should mark reveal-hit outcomes explicitly');

    return {
        revealerDayVoteAccess: true
    };
}

function main() {
    const tested = {
        ...testNightSkipMajorityRules(),
        ...testMayorRules(),
        ...testDoctorRules(),
        ...testBodyguardRules(),
        ...testSeerReadingRules(),
        ...testWitchPoisonFinishAnnouncement(),
        ...testRevealerDayVoteAccess()
    };

    console.log(`SMOKE_RESULT ${JSON.stringify({ tested })}`);
}

main();