const werewolfEngine = require('../games/werewolfEngine');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
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
        name: 'Werewolf bugfix smoke',
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

function getSingleRole(room, roleId) {
    const rolePlayer = room.gameState.players.find(player => player.role === roleId);
    assert(rolePlayer, `missing role ${roleId}`);
    return rolePlayer;
}

function getAllRole(room, roleId) {
    return room.gameState.players.filter(player => player.role === roleId);
}

function getAliveVillager(room) {
    const villager = room.gameState.players.find(player => player.role === 'villager' && player.alive !== false);
    assert(villager, 'missing alive villager');
    return villager;
}

const tested = {};

// ─── Test 1: Vote cancellation (unvote toggle) ─────────────────────────
function testVoteCancellation() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const villager = getAliveVillager(room);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const wolf = getSingleRole(room, 'werewolf');

    // Complete night 1
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);
    assert(room.gameState.phase === 'day-discussion', 'should be day-discussion after night 1');

    // Skip discussion (majority needed, not all)
    var alivePlayers = room.gameState.players.filter(p => p.alive !== false);
    var skipNeeded = Math.floor(alivePlayers.length / 2) + 1;
    for (var i = 0; i < alivePlayers.length && room.gameState.phase === 'day-discussion'; i++) {
        werewolfEngine.submitDiscussionSkip(room, alivePlayers[i].playerId);
    }
    assert(room.gameState.phase === 'day-vote', 'should be day-vote after skip');

    // Player votes for villager
    werewolfEngine.submitDayVote(room, seer.playerId, villager.playerId);
    assert(room.gameState.dayVotes[seer.playerId] === villager.playerId, 'vote should be recorded');

    // Click same target again → unvote
    const result = werewolfEngine.submitDayVote(room, seer.playerId, villager.playerId);
    assert(result.unvoted === true, 'should return unvoted flag');
    assert(!room.gameState.dayVotes[seer.playerId], 'vote should be removed after toggle');

    // Vote for a different person after unvoting
    werewolfEngine.submitDayVote(room, seer.playerId, wolf.playerId);
    assert(room.gameState.dayVotes[seer.playerId] === wolf.playerId, 'should accept new vote after unvote');

    tested.voteCancellation = true;
    console.log('  ✅ Vote cancellation (unvote toggle)');
}

// ─── Test 2: Night action toggle (doctor/bodyguard/werewolf cancel) ─────
function testNightActionToggle() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const villager = getAliveVillager(room);

    assert(room.gameState.phase === 'night', 'should start in night phase');

    // Doctor selects a target
    werewolfEngine.submitNightAction(room, doctor.playerId, villager.playerId);
    assert(room.gameState.nightActions.doctorSaves[doctor.playerId] === villager.playerId, 'doctor save should be recorded');

    // Doctor clicks same target → cancel
    const docResult = werewolfEngine.submitNightAction(room, doctor.playerId, villager.playerId);
    assert(docResult.unvoted === true, 'doctor should return unvoted flag');
    assert(!room.gameState.nightActions.doctorSaves[doctor.playerId], 'doctor save should be removed');

    // Doctor can now select someone else
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    assert(room.gameState.nightActions.doctorSaves[doctor.playerId] === doctor.playerId, 'doctor should save self');

    // Bodyguard selects a target
    werewolfEngine.submitNightAction(room, bodyguard.playerId, villager.playerId);
    assert(room.gameState.nightActions.bodyguardProtects[bodyguard.playerId] === villager.playerId, 'bodyguard protect should be recorded');

    // Bodyguard clicks same target → cancel
    const bgResult = werewolfEngine.submitNightAction(room, bodyguard.playerId, villager.playerId);
    assert(bgResult.unvoted === true, 'bodyguard should return unvoted flag');
    assert(!room.gameState.nightActions.bodyguardProtects[bodyguard.playerId], 'bodyguard protect should be removed');

    tested.nightActionToggle = true;
    console.log('  ✅ Night action toggle (doctor/bodyguard cancel)');
}

// ─── Test 3: Werewolf vote toggle ──────────────────────────────────────
function testWerewolfVoteToggle() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const wolf = getSingleRole(room, 'werewolf');
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const villager = getAliveVillager(room);

    // Complete night 1
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);

    // Force to night 2 via auto-resolve to skip day cleanly
    werewolfEngine.autoResolvePhase(room); // auto-skip discussion
    werewolfEngine.autoResolvePhase(room); // auto-resolve day vote

    assert(room.gameState.phase === 'night', 'should be night 2');
    assert(room.gameState.dayNumber === 2, 'dayNumber should be 2');

    // Wolf selects a target
    werewolfEngine.submitNightAction(room, wolf.playerId, villager.playerId);
    assert(room.gameState.nightActions.werewolfVotes[wolf.playerId] === villager.playerId, 'wolf vote should be recorded');

    // Wolf clicks same target → cancel
    const result = werewolfEngine.submitNightAction(room, wolf.playerId, villager.playerId);
    assert(result.unvoted === true, 'wolf should return unvoted flag');
    assert(!room.gameState.nightActions.werewolfVotes[wolf.playerId], 'wolf vote should be removed');

    tested.werewolfVoteToggle = true;
    console.log('  ✅ Werewolf vote toggle');
}

// ─── Test 4: Minimum vote threshold ─────────────────────────────────────
function testMinimumVoteThreshold() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const wolf = getSingleRole(room, 'werewolf');
    const villager = getAliveVillager(room);

    // Complete night 1
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);

    // Skip discussion (majority)
    for (var i = 0; i < room.gameState.players.length && room.gameState.phase === 'day-discussion'; i++) {
        var p = room.gameState.players[i];
        if (p.alive !== false) werewolfEngine.submitDiscussionSkip(room, p.playerId);
    }
    assert(room.gameState.phase === 'day-vote', 'should be day-vote');

    // 5 alive players → threshold = floor(5/2)+1 = 3
    // Everyone votes for different targets (1 vote each)
    // → nobody reaches threshold of 3
    const alivePlayers = room.gameState.players.filter(p => p.alive !== false);
    alivePlayers.forEach((voter, i) => {
        const targetIndex = (i + 1) % alivePlayers.length;
        werewolfEngine.submitDayVote(room, voter.playerId, alivePlayers[targetIndex].playerId);
    });

    assert(room.gameState.players.every(p => p.alive !== false), 'nobody should be eliminated with 1 vote each (threshold=3)');

    tested.minimumVoteThreshold = true;
    console.log('  ✅ Minimum vote threshold (1 vote = no elimination, need 3)');
}

// ─── Test 5: 2+ votes DO eliminate ──────────────────────────────────────
function testVoteThresholdMet() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const wolf = getSingleRole(room, 'werewolf');
    const villager = getAliveVillager(room);

    // Complete night 1
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);

    // Skip discussion (majority)
    for (var i = 0; i < room.gameState.players.length && room.gameState.phase === 'day-discussion'; i++) {
        var p = room.gameState.players[i];
        if (p.alive !== false) werewolfEngine.submitDiscussionSkip(room, p.playerId);
    }

    // 5 alive → threshold = 3
    // 3 votes for villager (meets threshold)
    werewolfEngine.submitDayVote(room, seer.playerId, villager.playerId);
    werewolfEngine.submitDayVote(room, doctor.playerId, villager.playerId);
    werewolfEngine.submitDayVote(room, bodyguard.playerId, villager.playerId);
    werewolfEngine.submitDayVote(room, wolf.playerId, seer.playerId);
    werewolfEngine.submitDayVote(room, villager.playerId, wolf.playerId);

    // With 3 votes for villager (meets majority threshold), they SHOULD be eliminated
    assert(villager.alive === false, 'villager should be eliminated with 3 votes (threshold=3)');

    tested.voteThresholdMet = true;
    console.log('  ✅ Vote threshold met (3 votes = elimination)');
}

// ─── Test 6: Witch included in night 1 required actors ──────────────────
function testWitchNight1Required() {
    const room = createRoom(['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch'], 6);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const witch = getSingleRole(room, 'witch');

    assert(room.gameState.phase === 'night', 'should start in night phase');
    assert(room.gameState.dayNumber === 1, 'should be night 1');

    // Seer and doctor submit
    werewolfEngine.submitNightAction(room, seer.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);

    // Night should NOT resolve yet because witch hasn't acted
    assert(room.gameState.phase === 'night', 'night should NOT resolve without witch on night 1');

    // Witch skips heal
    werewolfEngine.submitNightAction(room, witch.playerId, werewolfEngine.SKIP_TARGET_ID, 'witch-heal');

    // NOW night should resolve
    assert(room.gameState.phase === 'day-discussion', 'night should resolve after witch acts');

    tested.witchNight1Required = true;
    console.log('  ✅ Witch included in night 1 required actors');
}

// ─── Test 7: Witch toggle (cancel heal to use poison instead) ────────────
function testWitchToggle() {
    const room = createRoom(['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch'], 6);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const witch = getSingleRole(room, 'witch');
    const villagers = room.gameState.players.filter(p => p.role === 'villager');
    const target = villagers[0] || seer;

    // Witch selects heal target
    werewolfEngine.submitNightAction(room, witch.playerId, target.playerId, 'witch-heal');
    assert(room.gameState.nightActions.witchHeals[witch.playerId] === target.playerId, 'witch heal should be recorded');

    // Witch clicks same → cancel heal
    const result = werewolfEngine.submitNightAction(room, witch.playerId, target.playerId, 'witch-heal');
    assert(result.unvoted === true, 'witch should return unvoted flag');
    assert(!room.gameState.nightActions.witchHeals[witch.playerId], 'witch heal should be removed');

    // Witch can now use poison instead
    werewolfEngine.submitNightAction(room, witch.playerId, target.playerId, 'witch-poison');
    assert(room.gameState.nightActions.witchPoisons[witch.playerId] === target.playerId, 'witch poison should be allowed after canceling heal');

    tested.witchToggle = true;
    console.log('  ✅ Witch toggle (cancel heal to use poison)');
}

// ─── Test 8: Mayor vote weight applies in elimination ────────────────────
function testMayorVoteWeight() {
    const room = createRoom(['werewolf', 'mayor', 'seer', 'doctor', 'bodyguard'], 6);
    const mayor = getSingleRole(room, 'mayor');
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const wolf = getSingleRole(room, 'werewolf');
    const villager = getAliveVillager(room);

    // Complete night 1
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);

    // Skip discussion and reveal mayor
    werewolfEngine.submitMayorReveal(room, mayor.playerId);
    for (var i = 0; i < room.gameState.players.length && room.gameState.phase === 'day-discussion'; i++) {
        var p = room.gameState.players[i];
        if (p.alive !== false) werewolfEngine.submitDiscussionSkip(room, p.playerId);
    }
    assert(room.gameState.phase === 'day-vote', 'should be day-vote');

    // 6 alive → threshold = 4
    // Mayor (weight 2) + seer + doctor vote for wolf = 2+1+1 = 4 weighted votes (meets threshold)
    // Others vote for different targets
    werewolfEngine.submitDayVote(room, mayor.playerId, wolf.playerId);
    werewolfEngine.submitDayVote(room, seer.playerId, wolf.playerId);
    werewolfEngine.submitDayVote(room, doctor.playerId, wolf.playerId);
    werewolfEngine.submitDayVote(room, bodyguard.playerId, seer.playerId);
    werewolfEngine.submitDayVote(room, wolf.playerId, doctor.playerId);
    werewolfEngine.submitDayVote(room, villager.playerId, bodyguard.playerId);

    // Mayor's 2 weighted votes + 2 regular = 4, wolf eliminated
    assert(wolf.alive === false, 'wolf should be eliminated by mayor 2x + 2 votes = 4 (threshold=4)');
    assert(villager.alive !== false, 'villager should survive (0 votes)');

    tested.mayorVoteWeight = true;
    console.log('  ✅ Mayor vote weight applied in elimination (threshold=4)');
}

// ─── Test 9: Seer does NOT skip other roles on night 1 ──────────────────
function testSeerDoesNotSkipOthers() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const villager = getAliveVillager(room);

    assert(room.gameState.phase === 'night', 'should start in night phase');

    // Seer acts first
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);

    // Night should NOT resolve yet - doctor and bodyguard haven't acted
    assert(room.gameState.phase === 'night', 'night should NOT resolve after only seer on night 1');

    // Doctor acts
    werewolfEngine.submitNightAction(room, doctor.playerId, doctor.playerId);
    assert(room.gameState.phase === 'night', 'night should NOT resolve after seer + doctor');

    // Bodyguard acts → NOW it should resolve
    werewolfEngine.submitNightAction(room, bodyguard.playerId, bodyguard.playerId);
    assert(room.gameState.phase === 'day-discussion', 'night should resolve after all required actors');

    tested.seerDoesNotSkipOthers = true;
    console.log('  ✅ Seer does NOT skip other roles on night 1');
}

// ─── Test 10: Seer toggle (cancel check to recheck) ────────────────────
function testSeerToggle() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const villager = getAliveVillager(room);
    const wolf = getSingleRole(room, 'werewolf');

    // Seer checks villager
    werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    assert(room.gameState.nightActions.seerChecks[seer.playerId] === villager.playerId, 'seer check should be recorded');

    // Seer tries same target again → should throw (locked, no toggle)
    let threw = false;
    try {
        werewolfEngine.submitNightAction(room, seer.playerId, villager.playerId);
    } catch (e) {
        threw = true;
    }
    assert(threw, 'seer should NOT be able to toggle off (locked after check)');

    // Seer tries different target → should also throw (already checked)
    threw = false;
    try {
        werewolfEngine.submitNightAction(room, seer.playerId, wolf.playerId);
    } catch (e) {
        threw = true;
    }
    assert(threw, 'seer should NOT be able to check a second target');

    tested.seerToggle = true;
    console.log('  ✅ Seer locked after check (no toggle exploit)');
}

// ─── Test 11: Poison respects protection ────────────────────────────────
function testPoisonProtection() {
    const room = createRoom(['alphaWolf', 'werewolf', 'seer', 'doctor', 'witch'], 6);
    const wolves = getAllRole(room, 'alphaWolf').concat(getAllRole(room, 'werewolf'));
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const witch = getSingleRole(room, 'witch');
    const villagers = room.gameState.players.filter(p => p.role === 'villager');
    const target = villagers[0] || seer;

    // Complete night 1 (no wolf attack)
    werewolfEngine.submitNightAction(room, seer.playerId, target.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, target.playerId); // doctor saves target
    werewolfEngine.submitNightAction(room, witch.playerId, target.playerId, 'witch-poison'); // witch poisons same target

    // Night should resolve, but target should survive because doctor protected them
    assert(room.gameState.phase === 'day-discussion', 'should resolve to day');
    assert(target.alive !== false, 'target should survive poison when protected by doctor');

    tested.poisonProtection = true;
    console.log('  ✅ Poison respects protection');
}

// ─── Test 12: Dead player sees vote summary ─────────────────────────────
function testDeadPlayerVoteSummary() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard'], 5);
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const wolf = getSingleRole(room, 'werewolf');
    const villager = getAliveVillager(room);

    // Kill villager manually
    villager.alive = false;
    villager.revealedRole = 'ชาวบ้าน';

    // Advance to day-vote
    room.gameState.phase = 'day-vote';
    room.gameState.dayVotes = {};
    room.gameState.dayActionUsedBy = {};

    // Live players vote
    room.gameState.dayVotes[seer.playerId] = wolf.playerId;
    room.gameState.dayVotes[doctor.playerId] = wolf.playerId;

    // Build client state for dead viewer
    const deadState = werewolfEngine.buildClientState(room, villager.playerId);
    const dayActions = deadState.actionState.dayActions;

    assert(dayActions.dayVoteSummary !== null, 'dead player should see dayVoteSummary');
    assert(dayActions.voteTallies !== undefined, 'dead player should see voteTallies');
    assert(dayActions.canVote === false, 'dead player should not be able to vote');

    tested.deadPlayerVoteSummary = true;
    console.log('  ✅ Dead player sees vote summary');
}

// ─── Test 13: Revealer auto-resolve day after kill ──────────────────────
function testRevealerAutoResolve() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'bodyguard', 'revealer'], 6);
    const wolf = getSingleRole(room, 'werewolf');
    const revealer = getSingleRole(room, 'revealer');
    const seer = getSingleRole(room, 'seer');
    const doctor = getSingleRole(room, 'doctor');
    const bodyguard = getSingleRole(room, 'bodyguard');
    const villager = getAliveVillager(room);

    // Jump to day-vote
    room.gameState.phase = 'day-vote';
    room.gameState.dayVotes = {};
    room.gameState.dayActionUsedBy = {};

    // All non-revealer alive players vote (5 total alive, 4 others vote)
    room.gameState.dayVotes[seer.playerId] = wolf.playerId;
    room.gameState.dayVotes[doctor.playerId] = villager.playerId;
    room.gameState.dayVotes[bodyguard.playerId] = villager.playerId;
    room.gameState.dayVotes[wolf.playerId] = seer.playerId;

    // Revealer uses reveal on wolf (the last action) → should auto-resolve
    const result = werewolfEngine.useRevealAction(room, revealer.playerId, wolf.playerId);
    assert(result.resolved === true, 'reveal should auto-resolve day when it is the last action');

    tested.revealerAutoResolve = true;
    console.log('  ✅ Revealer auto-resolves day after kill');
}

// ─── Test 14: Revealer hint bar __show__ guard ──────────────────────────
// (Client-side only, no engine test needed)

// ─── Run all tests ──────────────────────────────────────────────────────
console.log('Werewolf bugfix smoke tests:');
testVoteCancellation();
testNightActionToggle();
testWerewolfVoteToggle();
testMinimumVoteThreshold();
testVoteThresholdMet();
testWitchNight1Required();
testWitchToggle();
testMayorVoteWeight();
testSeerDoesNotSkipOthers();
testSeerToggle();
testPoisonProtection();
testDeadPlayerVoteSummary();
testRevealerAutoResolve();

console.log(`\nSMOKE_RESULT ${JSON.stringify({ tested })}`);
