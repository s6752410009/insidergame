// Regression checks for Werewolf engine bugs (AFK fill, wolf cap, Fool leak,
// witch/seer skip, bodyguard armour, offline dealing). Drives the engine directly.
const werewolfEngine = require('../games/werewolfEngine');

const SKIP = werewolfEngine.SKIP_TARGET_ID;
const ITERATIONS = 40;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createRoom(roleIds, playerCount = roleIds.length, options = {}) {
    const offline = new Set(options.offlineIndexes || []);
    const room = {
        roomId: `smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: 'Werewolf regression smoke',
        settings: { gameMode: 'werewolf', werewolfRoles: roleIds, roundTime: 30 },
        players: Array.from({ length: playerCount }, (_, index) => ({
            playerId: `player-${index + 1}`,
            playerName: `Player ${index + 1}`,
            socketId: offline.has(index) ? null : `socket-${index + 1}`,
            color: '#3498db',
            avatar: '👤',
            avatarFrame: 'none'
        }))
    };
    werewolfEngine.startGame(room);
    return room;
}

function role(room, roleId) {
    const player = room.gameState.players.find(p => p.role === roleId);
    assert(player, `missing role ${roleId}`);
    return player;
}

function resetNightPhase(room, dayNumber) {
    Object.assign(room.gameState, {
        phase: 'night',
        phaseEndsAt: null,
        status: 'werewolf_night',
        dayNumber,
        nightActions: {
            werewolfVotes: {}, seerChecks: {}, oracleReads: {}, doctorSaves: {}, bodyguardProtects: {},
            witchHeals: {}, witchPoisons: {}, trackerScans: {}, vigilanteShots: {}, hunterShots: {}, clericBlesses: {}
        },
        nightSkips: {},
        dayVotes: {},
        discussionSkips: {},
        dayActionUsedBy: {},
        lastResolvedNight: null,
        lastResolvedDay: null,
        winner: null,
        lastAction: Date.now()
    });
    room.gameState.alivePlayerIds = room.gameState.players.filter(p => p.alive !== false).map(p => p.playerId);
}

const PACK_ROLES = ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor', 'villager'];

// Bug 1: an AFK wolf follows the pack's pick (never random); no pick -> skip.
function testAfkWolfFollowsPack() {
    for (let i = 0; i < ITERATIONS; i += 1) {
        const room = createRoom(PACK_ROLES, 7);
        const alpha = role(room, 'alphaWolf');
        const wolf = role(room, 'werewolf');
        const victim = role(room, 'mayor');
        resetNightPhase(room, 2);
        werewolfEngine.submitNightAction(room, wolf.playerId, victim.playerId);
        werewolfEngine.autoResolvePhase(room);
        assert(room.gameState.lastResolvedNight.attackedPlayerId === victim.playerId, 'AFK alpha must follow the other wolf pick');
        assert(victim.alive === false, 'pack target should die');
    }

    for (let i = 0; i < ITERATIONS; i += 1) {
        const room = createRoom(PACK_ROLES, 7);
        resetNightPhase(room, 2);
        werewolfEngine.autoResolvePhase(room);
        assert(!room.gameState.lastResolvedNight.attackedPlayerId, 'all wolves AFK must not produce a random kill');
        assert(room.gameState.players.every(p => p.alive !== false), 'nobody should die when all wolves are AFK');
    }
    return { afkWolfFollowsPack: true, afkWolvesSkip: true };
}

// Bug 2: AFK doctor/bodyguard skip (no burned save, no armour risk).
function testAfkProtectorsSkip() {
    for (let i = 0; i < ITERATIONS; i += 1) {
        const room = createRoom(PACK_ROLES, 7);
        const doctor = role(room, 'doctor');
        const bodyguard = role(room, 'bodyguard');
        const alpha = role(room, 'alphaWolf');
        const wolf = role(room, 'werewolf');
        const victim = role(room, 'mayor');
        resetNightPhase(room, 2);
        werewolfEngine.submitNightAction(room, alpha.playerId, victim.playerId);
        werewolfEngine.submitNightAction(room, wolf.playerId, victim.playerId);
        werewolfEngine.autoResolvePhase(room);
        assert(!doctor.doctorSaveUses, 'AFK doctor must not burn a save use');
        assert(bodyguard.bodyguardArmorBroken === false, 'AFK bodyguard armour must stay intact');
        assert(victim.alive === false, 'unprotected victim should die');
    }
    return { afkDoctorSkips: true, afkBodyguardSkips: true };
}

// AFK seer skips instead of getting a free random reading.
function testAfkSeerSkips() {
    for (let i = 0; i < ITERATIONS; i += 1) {
        const room = createRoom(PACK_ROLES, 7);
        const seer = role(room, 'seer');
        resetNightPhase(room, 2);
        werewolfEngine.autoResolvePhase(room);
        assert(!(seer.seerHistory || []).length, 'AFK seer must not receive a random reading');
    }
    return { afkSeerSkips: true };
}

// Bug 3: host-picked lists can't give 2 wolves to 3-4 player games.
function testWolfCap() {
    [3, 4, 5].forEach(count => {
        const picked = ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard'].slice(0, count);
        const plan = werewolfEngine.getRolePlan(count, { werewolfRoles: picked });
        const wolves = plan.filter(r => r.team === 'werewolf' || ['werewolf', 'alphaWolf'].includes(r.id)).length;
        assert(plan.length === count, `plan for ${count} should have ${count} roles`);
        assert(wolves === 1, `plan for ${count} players must have 1 wolf, got ${wolves}`);
        const room = createRoom(picked, count);
        const dealtWolves = room.gameState.players.filter(p => ['werewolf', 'alphaWolf'].includes(p.role)).length;
        assert(dealtWolves === 1, `dealt ${dealtWolves} wolves in a ${count}-player game`);
    });
    const sixPlan = werewolfEngine.getRolePlan(6, { werewolfRoles: ['alphaWolf', 'werewolf', 'seer', 'doctor', 'bodyguard', 'mayor'] });
    assert(sixPlan.filter(r => ['werewolf', 'alphaWolf'].includes(r.id)).length === 2, '6 players may keep 2 host-picked wolves');
    return { wolfCapSmallGames: true };
}

// Bug 4: attacking the Fool looks exactly like a protected save.
function testFoolLooksLikeSave() {
    const foolRoom = createRoom(['werewolf', 'fool', 'seer', 'doctor', 'mayor', 'villager'], 6);
    const foolWolf = role(foolRoom, 'werewolf');
    resetNightPhase(foolRoom, 2);
    werewolfEngine.submitNightAction(foolRoom, foolWolf.playerId, role(foolRoom, 'fool').playerId);
    werewolfEngine.autoResolvePhase(foolRoom);
    const foolState = werewolfEngine.buildClientState(foolRoom, foolWolf.playerId);

    const saveRoom = createRoom(['werewolf', 'fool', 'seer', 'doctor', 'mayor', 'villager'], 6);
    const saveWolf = role(saveRoom, 'werewolf');
    const saved = role(saveRoom, 'mayor');
    resetNightPhase(saveRoom, 2);
    werewolfEngine.submitNightAction(saveRoom, saveWolf.playerId, saved.playerId);
    werewolfEngine.submitNightAction(saveRoom, role(saveRoom, 'doctor').playerId, saved.playerId);
    werewolfEngine.autoResolvePhase(saveRoom);
    const saveState = werewolfEngine.buildClientState(saveRoom, saveWolf.playerId);

    assert(foolState.morningAnnouncement, 'fool night should produce a morning announcement');
    ['outcomeType', 'lead', 'detail'].forEach(key => {
        assert(foolState.morningAnnouncement[key] === saveState.morningAnnouncement[key], `fool announcement ${key} differs from a save`);
    });
    const nightMsg = state => (state.history || []).find(entry => entry.type === 'night')?.message;
    assert(nightMsg(foolState) === nightMsg(saveState), 'fool night history differs from a save');
    return { foolIndistinguishableFromSave: true };
}

// Bug 6: witch keep-heal (skip) must not block poison; seer skip must not block a check.
function testSkipDoesNotBlock() {
    const room = createRoom(['werewolf', 'witch', 'seer', 'doctor', 'mayor', 'villager'], 6);
    const witch = role(room, 'witch');
    const seer = role(room, 'seer');
    const target = role(room, 'werewolf');
    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, witch.playerId, SKIP, 'witch-heal');
    werewolfEngine.submitNightAction(room, witch.playerId, target.playerId, 'witch-poison');
    assert(room.gameState.nightActions.witchPoisons[witch.playerId] === target.playerId, 'poison should be recorded after keep-heal');

    werewolfEngine.submitNightAction(room, seer.playerId, SKIP);
    werewolfEngine.submitNightAction(room, seer.playerId, target.playerId);
    assert(room.gameState.nightActions.seerChecks[seer.playerId] === target.playerId, 'seer check should be recorded after a skip');
    return { witchKeepHealAllowsPoison: true, seerSkipAllowsCheck: true };
}

// Bug 8: bodyguard armour stays intact when the doctor also saved the target.
function testArmourWithDoctor() {
    const room = createRoom(PACK_ROLES, 7);
    const bodyguard = role(room, 'bodyguard');
    const doctor = role(room, 'doctor');
    const victim = role(room, 'mayor');
    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, role(room, 'alphaWolf').playerId, victim.playerId);
    werewolfEngine.submitNightAction(room, role(room, 'werewolf').playerId, victim.playerId);
    werewolfEngine.submitNightAction(room, doctor.playerId, victim.playerId);
    werewolfEngine.submitNightAction(room, bodyguard.playerId, victim.playerId);
    werewolfEngine.autoResolvePhase(room);
    assert(victim.alive !== false, 'double-protected victim should survive');
    assert(bodyguard.bodyguardArmorBroken === false, 'armour must not break when the doctor also saved');
    return { armourIntactWithDoctorSave: true };
}

// Bug 7: offline (grace) players are not dealt in.
function testOfflineNotDealt() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'mayor', 'villager'], 5, { offlineIndexes: [4] });
    assert(room.gameState.players.length === 4, `expected 4 dealt players, got ${room.gameState.players.length}`);
    assert(!room.gameState.players.some(p => p.playerId === 'player-5'), 'offline player must not be dealt a role');
    return { offlinePlayersNotDealt: true };
}

// UX: the night ends as soon as every skill holder has decided and a majority is ready
// (acting counts as ready), so players without a night skill can just wait.
function testNightAutoEnd() {
    const roles = ['werewolf', 'seer', 'doctor', 'mayor', 'cleric'];
    const room = createRoom(roles, 5);
    resetNightPhase(room, 2);
    const wolf = role(room, 'werewolf');
    const seer = role(room, 'seer');
    const doctor = role(room, 'doctor');
    werewolfEngine.submitNightAction(room, wolf.playerId, role(room, 'mayor').playerId);
    werewolfEngine.submitNightAction(room, seer.playerId, doctor.playerId);
    assert(!werewolfEngine.maybeAutoEndNight(room).resolved, 'night must wait for the doctor');
    const waiting = werewolfEngine.buildClientState(room, role(room, 'cleric').playerId).actionState.nightStatus;
    assert(waiting.readyCount === 2 && waiting.skipNeeded === 3, 'acting should count as ready');
    werewolfEngine.submitNightAction(room, doctor.playerId, SKIP);
    const ended = werewolfEngine.maybeAutoEndNight(room);
    assert(ended.resolved && room.gameState.phase === 'day-discussion', 'night should end once every skill holder decided');

    // Stuck case: majority pressed ready first, the last skill holder acts later.
    const late = createRoom(roles, 5);
    resetNightPhase(late, 2);
    ['mayor', 'cleric', 'werewolf'].forEach(id => werewolfEngine.submitNightSkip(late, role(late, id).playerId));
    werewolfEngine.submitNightAction(late, role(late, 'seer').playerId, SKIP);
    const lateState = werewolfEngine.buildClientState(late, role(late, 'mayor').playerId).actionState.nightStatus;
    assert(lateState.waitingForRoles, 'UI should explain the night waits for skill holders');
    werewolfEngine.submitNightAction(late, role(late, 'doctor').playerId, SKIP);
    assert(werewolfEngine.maybeAutoEndNight(late).resolved, 'last skill holder acting must end a night that already has a ready majority');

    // A split wolf pack never auto-ends the night (a tie would silently cancel the kill).
    const pack = createRoom(PACK_ROLES, 7);
    resetNightPhase(pack, 2);
    werewolfEngine.submitNightAction(pack, role(pack, 'alphaWolf').playerId, role(pack, 'mayor').playerId);
    werewolfEngine.submitNightAction(pack, role(pack, 'werewolf').playerId, role(pack, 'seer').playerId);
    // every other skill holder (the 7th seat may be any filler role) chooses "no skill"
    pack.gameState.players.filter(p => !['werewolf', 'alphaWolf'].includes(p.role)).forEach(p => {
        try {
            werewolfEngine.submitNightAction(pack, p.playerId, SKIP, p.role === 'witch' ? 'witch-heal' : null);
        } catch (error) {
            // roles without a night skill (mayor, cleric, ...) just wait
        }
    });
    assert(!werewolfEngine.maybeAutoEndNight(pack).resolved, 'split wolf pack must not auto-end the night');
    assert(werewolfEngine.buildClientState(pack, role(pack, 'werewolf').playerId).actionState.nightStatus.wolvesSplit, 'wolves should be told the pack is split');
    werewolfEngine.submitNightAction(pack, role(pack, 'werewolf').playerId, role(pack, 'mayor').playerId);
    assert(werewolfEngine.maybeAutoEndNight(pack).resolved, 'agreeing pack ends the night');
    return { nightAutoEndsWhenSkillsDone: true, nightLateActorEndsNight: true, splitPackWaits: true };
}

// UX: yesterday's vote result survives into the night, and the end-game recap follows the phase that ended it.
function testAnnouncementsFollowLastPhase() {
    const room = createRoom(['werewolf', 'seer', 'doctor', 'mayor', 'bodyguard', 'cleric'], 6);
    resetNightPhase(room, 1);
    werewolfEngine.autoResolvePhase(room); // night 1 -> discussion
    werewolfEngine.autoResolvePhase(room); // discussion -> vote
    const voteState = werewolfEngine.buildClientState(room, role(room, 'seer').playerId);
    assert(voteState.morningAnnouncement, 'day-vote should still carry last night news');
    const victim = role(room, 'mayor');
    room.gameState.players.filter(p => p.playerId !== victim.playerId)
        .forEach(p => werewolfEngine.submitDayVote(room, p.playerId, victim.playerId));
    werewolfEngine.submitDayVote(room, victim.playerId, SKIP);
    assert(room.gameState.phase === 'night', 'vote should resolve into night');
    const nightState = werewolfEngine.buildClientState(room, role(room, 'seer').playerId);
    assert(nightState.dayResolutionAnnouncement && nightState.dayResolutionAnnouncement.outcomeType === 'vote-elimination',
        'night must announce who was voted out');

    // Game ends on a day vote: the recap is the vote, not the previous night.
    const endRoom = createRoom(['werewolf', 'seer', 'doctor', 'mayor'], 4);
    resetNightPhase(endRoom, 2);
    werewolfEngine.submitNightAction(endRoom, role(endRoom, 'werewolf').playerId, role(endRoom, 'mayor').playerId);
    werewolfEngine.autoResolvePhase(endRoom);
    werewolfEngine.autoResolvePhase(endRoom);
    const wolf = role(endRoom, 'werewolf');
    ['seer', 'doctor'].forEach(id => werewolfEngine.submitDayVote(endRoom, role(endRoom, id).playerId, wolf.playerId));
    werewolfEngine.submitDayVote(endRoom, wolf.playerId, role(endRoom, 'seer').playerId);
    const finished = werewolfEngine.buildClientState(endRoom, wolf.playerId);
    assert(finished.winner === 'village', 'village should win');
    assert(!finished.morningAnnouncement && finished.dayResolutionAnnouncement, 'finished-by-vote recap must show the vote, not last night');
    return { voteResultAnnouncedAtNight: true, finishRecapFollowsLastPhase: true };
}

// UX: a witch who chose "no potion" is not told she used the heal.
function testWitchSkipLabel() {
    const room = createRoom(['werewolf', 'witch', 'seer', 'doctor', 'mayor', 'villager'], 6);
    const witch = role(room, 'witch');
    resetNightPhase(room, 2);
    werewolfEngine.submitNightAction(room, witch.playerId, SKIP, 'witch-heal');
    const label = werewolfEngine.buildClientState(room, witch.playerId).actionState.nightActions[0].label;
    assert(/ไม่ใช้ยา/.test(label), `witch skip label should say no potion, got: ${label}`);
    return { witchSkipLabel: true };
}

function main() {
    const tested = {
        ...testNightAutoEnd(),
        ...testAnnouncementsFollowLastPhase(),
        ...testWitchSkipLabel(),
        ...testAfkWolfFollowsPack(),
        ...testAfkProtectorsSkip(),
        ...testAfkSeerSkips(),
        ...testWolfCap(),
        ...testFoolLooksLikeSave(),
        ...testSkipDoesNotBlock(),
        ...testArmourWithDoctor(),
        ...testOfflineNotDealt()
    };
    console.log(`SMOKE_RESULT ${JSON.stringify({ tested })}`);
}

main();
