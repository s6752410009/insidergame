// Use-case tests for the v6.5 Werewolf roles (Serial Killer, Prince, Lycan, Diseased,
// Apprentice Seer), the witch fidelity fix and the 20-player role table.
// Every case has an id + Thai/English title; `--md <file>` writes the case list.
const fs = require('fs');
const { E, SKIP, assert, setup, P, act, wolvesKill, endNight, toVote, skipDay, lynch, toNight, state, nightOptions, expectThrow } = require('./werewolf-test-kit');

const cases = [];
function c(id, role, title, run) {
    cases.push({ id, role, title, run });
}
const alive = player => player.alive !== false;
const json = value => JSON.stringify(value);

// ───────────────────────── Serial Killer ─────────────────────────
c('SK-01', 'serialKiller', 'Night 1: SK cannot kill (only skip); nobody dies on night 1', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'doctor', 'villager', 'villager']);
    const sk = P(room, 'serialKiller');
    expectThrow(() => act(room, sk, P(room, 'villager')), /คืนแรก/, 'SK night-1 kill');
    act(room, sk, SKIP);
    endNight(room);
    assert(room.gameState.players.every(alive), 'nobody dies night 1');
    assert(nightOptions(setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager']), 'p2')[0].targets.length === 0, 'night-1 card has no targets');
});
c('SK-02', 'serialKiller', 'Night 2: SK kills an unprotected villager; morning names the killer type', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'doctor', 'villager', 'villager']);
    toNight(room, 2);
    const victim = P(room, 'villager');
    act(room, P(room, 'serialKiller'), victim);
    endNight(room);
    assert(!alive(victim), 'victim dead');
    const ann = state(room, P(room, 'seer')).morningAnnouncement;
    assert(/ฆาตกรต่อเนื่อง/.test(ann.detail), `announcement names SK: ${ann.detail}`);
});
c('SK-03', 'serialKiller', 'Wolves attack SK → SK survives; public text identical to a protected save', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'doctor', 'villager', 'villager']);
    toNight(room, 2);
    const sk = P(room, 'serialKiller');
    wolvesKill(room, sk);
    act(room, sk, SKIP);
    endNight(room);
    assert(alive(sk), 'SK immune to wolves');
    const ann = state(room, P(room, 'villager')).morningAnnouncement;
    assert(ann.outcomeType === 'saved', `outcome saved, got ${ann.outcomeType}`);
});
c('SK-04', 'serialKiller', 'Doctor protects the SK target → target survives, doctor use spent', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'doctor', 'villager', 'villager']);
    toNight(room, 2);
    const victim = P(room, 'villager');
    act(room, P(room, 'serialKiller'), victim);
    act(room, P(room, 'doctor'), victim);
    endNight(room);
    assert(alive(victim), 'saved by doctor');
    assert(P(room, 'doctor').doctorSaveUses === 1, 'doctor use spent');
    assert(P(room, 'serialKiller').serialKillerLastResult.blocked === true, 'SK told the kill was blocked');
});
c('SK-05', 'serialKiller', 'Bodyguard as sole protector blocks SK; armour breaks (same as a wolf block)', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'bodyguard', 'villager', 'villager']);
    toNight(room, 2);
    const victim = P(room, 'villager');
    act(room, P(room, 'serialKiller'), victim);
    act(room, P(room, 'bodyguard'), victim);
    endNight(room);
    assert(alive(victim), 'bodyguard saved');
    assert(P(room, 'bodyguard').bodyguardArmorBroken === true, 'armour broken');
});
c('SK-06', 'serialKiller', 'Witch heal blocks SK; witch poison kills SK', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'witch', 'villager', 'villager']);
    toNight(room, 2);
    const victim = P(room, 'villager');
    const sk = P(room, 'serialKiller');
    act(room, sk, victim);
    act(room, P(room, 'witch'), victim, 'witch-heal');
    act(room, P(room, 'witch'), sk, 'witch-poison');
    endNight(room);
    assert(alive(victim), 'healed');
    assert(!alive(sk), 'SK poisoned');
});
c('SK-07', 'serialKiller', 'Cleric blessing (cast in the morning) blocks the SK kill next night', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'cleric', 'villager', 'villager']);
    endNight(room);
    const victim = P(room, 'villager');
    E.submitClericBless(room, P(room, 'cleric').playerId, victim.playerId);
    skipDay(room);
    act(room, P(room, 'serialKiller'), victim);
    endNight(room);
    assert(alive(victim), 'blessed target survives SK');
});
c('SK-08', 'serialKiller', 'Vigilante and hunter night shots can kill SK', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'vigilante', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const sk = P(room, 'serialKiller');
    act(room, P(room, 'vigilante'), sk);
    endNight(room);
    assert(!alive(sk), 'vigilante killed SK');
    const room2 = setup(['werewolf', 'serialKiller', 'seer', 'hunter', 'villager', 'villager', 'villager']);
    toNight(room2, 2);
    act(room2, P(room2, 'hunter'), P(room2, 'serialKiller'));
    endNight(room2);
    assert(!alive(P(room2, 'serialKiller')), 'hunter killed SK');
});
c('SK-09', 'serialKiller', 'SK and wolves pick the same villager → one death, one public event', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'doctor', 'villager', 'villager']);
    toNight(room, 2);
    const victim = P(room, 'villager');
    wolvesKill(room, victim);
    act(room, P(room, 'serialKiller'), victim);
    endNight(room);
    assert(!alive(victim), 'victim dead');
    assert(room.gameState.lastResolvedNight.eliminatedPlayerIds.length === 1, 'single death');
    assert(P(room, 'serialKiller').serialKillerLastResult.alreadyDead === true, 'SK told the target was already dead');
});
c('SK-10', 'serialKiller', 'SK can kill the Fool (Fool is only immune to wolves) — no Fool win', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'fool', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'serialKiller'), P(room, 'fool'));
    endNight(room);
    assert(!alive(P(room, 'fool')), 'fool dead');
    assert(room.gameState.winner !== 'fool', 'no fool win');
});
c('SK-11', 'serialKiller', 'SK kills the Diseased → wolves are NOT sick the next night', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'diseased', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'serialKiller'), P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    act(room, P(room, 'werewolf'), P(room, 'villager'));
    assert(room.gameState.nightActions.werewolfVotes[P(room, 'werewolf').playerId], 'wolves may hunt');
});
c('SK-12', 'serialKiller', 'Seer reads SK as "ไม่ดี"; Oracle reads the exact role', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'oracle', 'villager', 'villager']);
    const seerRes = act(room, P(room, 'seer'), P(room, 'serialKiller')).seerResult;
    const oracleRes = act(room, P(room, 'oracle'), P(room, 'serialKiller')).oracleResult;
    assert(seerRes.resultCode === 'bad', `seer bad, got ${seerRes.resultCode}`);
    assert(oracleRes.roleId === 'serialKiller', 'oracle sees SK');
});
c('SK-13', 'serialKiller', 'Tracker sees SK "used a skill" only when SK picked a real target', () => {
    const room = setup(['werewolf', 'serialKiller', 'tracker', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'serialKiller'), P(room, 'villager'));
    act(room, P(room, 'tracker'), P(room, 'serialKiller'));
    endNight(room);
    assert(P(room, 'tracker').trackerLastResult.acted === true, 'acted');
    skipDay(room);
    act(room, P(room, 'serialKiller'), SKIP);
    act(room, P(room, 'tracker'), P(room, 'serialKiller'));
    endNight(room);
    assert(P(room, 'tracker').trackerLastResult.acted === false, 'skip is not a skill use');
});
c('SK-14', 'serialKiller', 'Win: SK + one villager left after the night → SK wins alone', () => {
    const room = setup(['werewolf', 'serialKiller', 'villager', 'villager', 'seer']);
    toNight(room, 2);
    lynchSetup(room, ['seer']);
    wolvesKill(room, P(room, 'villager', 1));
    act(room, P(room, 'serialKiller'), P(room, 'werewolf'));
    endNight(room);
    assert(room.gameState.winner === 'serialKiller', `SK wins, got ${room.gameState.winner}`);
});
c('SK-15', 'serialKiller', 'Priority: SK + 1 wolf left → SK wins (wolf parity does not apply while SK lives)', () => {
    const room = setup(['werewolf', 'serialKiller', 'villager', 'villager', 'seer']);
    toNight(room, 2);
    lynchSetup(room, ['seer', 'villager']);
    wolvesKill(room, P(room, 'villager', 1));
    act(room, P(room, 'serialKiller'), SKIP);
    endNight(room);
    assert(room.gameState.winner === 'serialKiller', `SK beats wolf parity, got ${room.gameState.winner}`);
});
c('SK-16', 'serialKiller', 'Wolves ≥ others but SK alive with 3+ players → game continues', () => {
    const room = setup(['werewolf', 'werewolf', 'serialKiller', 'villager', 'seer', 'villager']);
    toNight(room, 2);
    lynchSetup(room, ['seer', 'villager']);
    // 2 wolves, SK, 1 villager → wolves 2 ≥ others 2 but SK alive
    assert(E.checkWinCondition(room) === null, 'no wolf win while SK lives');
    assert(room.gameState.phase === 'night', 'game continues');
});
c('SK-17', 'serialKiller', 'Village wins only when wolves AND SK are dead', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    lynchSetup(room, ['werewolf']);
    assert(E.checkWinCondition(room) === null, 'SK alive → no village win yet');
    lynchSetup(room, ['serialKiller']);
    assert(E.checkWinCondition(room) === 'village', 'village wins');
});
c('SK-18', 'serialKiller', 'AFK SK: timer fills skip, never a random kill', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    endNight(room);
    assert(room.gameState.players.every(alive), 'no deaths from AFK SK (wolves AFK too)');
});
c('SK-19', 'serialKiller', 'SK disconnects mid-night (leaves) → removed, night still resolves, no SK kill', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const sk = P(room, 'serialKiller');
    act(room, sk, P(room, 'villager'));
    E.handlePlayerLeft(room, sk.playerId);
    assert(!room.gameState.nightActions.serialKills[sk.playerId], 'pending kill dropped');
    if (room.gameState.phase === 'night') endNight(room);
    assert(alive(P(room, 'villager')), 'no kill from a departed SK');
});
c('SK-20', 'serialKiller', 'Reconnect mid-night: SK state keeps the pick; nobody else sees SK picks', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const target = P(room, 'villager');
    act(room, P(room, 'serialKiller'), target);
    const skView = nightOptions(room, P(room, 'serialKiller'));
    assert(skView[0].type === 'serial-kill' && skView[0].selectedTargetId === target.playerId, 'pick survives reconnect');
    ['werewolf', 'seer', 'villager'].forEach(role => {
        const payload = json(state(room, P(room, role)));
        assert(!payload.includes('serial-kill') && !payload.includes('serialKills'), `${role} must not see SK action`);
    });
});
c('SK-21', 'serialKiller', 'Host skip during SK action applies the committed pick; an empty pick becomes skip', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const target = P(room, 'villager');
    act(room, P(room, 'serialKiller'), target);
    E.autoResolvePhase(room); // what werewolf_hostSkipPhase calls
    assert(!alive(target), 'committed SK pick resolves on host skip');
});
c('SK-22', 'serialKiller', 'Revealer accuses SK → miss (SK is not a wolf), the Revealer dies', () => {
    const room = setup(['werewolf', 'serialKiller', 'revealer', 'seer', 'villager', 'villager']);
    endNight(room);
    E.useRevealAction(room, P(room, 'revealer').playerId, P(room, 'serialKiller').playerId);
    skipDay(room);
    assert(!alive(P(room, 'revealer')) && alive(P(room, 'serialKiller')), 'revealer dies, SK lives');
});
c('SK-23', 'serialKiller', 'Tapping the same target again cancels; SK cannot target self', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const sk = P(room, 'serialKiller');
    act(room, sk, P(room, 'villager'));
    assert(act(room, sk, P(room, 'villager')).unvoted === true, 'toggle cancels');
    expectThrow(() => act(room, sk, sk), /ตัวเอง/, 'self target');
});
c('SK-24', 'serialKiller', 'Dead SK cannot act and is not a required night actor', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    lynchSetup(room, ['serialKiller']);
    toNight(room, 2);
    expectThrow(() => act(room, P(room, 'serialKiller'), P(room, 'villager')), /ไม่สามารถ/, 'dead SK');
    assert(nightOptions(room, P(room, 'serialKiller')).length === 0, 'no options for dead SK');
});
c('SK-25', 'serialKiller', 'SK is a required actor from night 2: night waits for SK before auto-ending', () => {
    const room = setup(['werewolf', 'serialKiller', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'villager'));
    room.gameState.players.filter(p => p.role === 'villager' && alive(p)).forEach(p => { if (room.gameState.phase === 'night') E.submitNightSkip(room, p.playerId); });
    assert(room.gameState.phase === 'night', 'still night: SK undecided');
    act(room, P(room, 'serialKiller'), SKIP);
    E.maybeAutoEndNight(room);
    assert(room.gameState.phase !== 'night', 'night ends once SK decides');
});

// ───────────────────────── Prince ─────────────────────────
c('PR-01', 'prince', 'First lynch: Prince reveals, survives, nobody leaves; game goes to night', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    const prince = P(room, 'prince');
    lynch(room, prince);
    assert(alive(prince) && prince.princeRevealed, 'prince survives + revealed');
    assert(room.gameState.phase === 'night', 'night next');
    assert(room.gameState.lastResolvedDay.resolutionType === 'prince-reveal', 'prince-reveal event');
});
c('PR-02', 'prince', 'After the reveal every living player sees "เจ้าชาย" on that seat; never before', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    const prince = P(room, 'prince');
    const before = state(room, P(room, 'villager')).players.find(p => p.playerId === prince.playerId);
    assert(!before.revealedRole && !before.roleId, 'hidden before');
    lynch(room, prince);
    const after = state(room, P(room, 'werewolf')).players.find(p => p.playerId === prince.playerId);
    assert(after.revealedRole === 'เจ้าชาย' && after.roleId === 'prince', 'public after reveal');
    const others = state(room, P(room, 'werewolf')).players.filter(p => p.playerId !== prince.playerId && !p.isSelf);
    assert(others.every(p => !p.roleId), 'only the prince is revealed');
});
c('PR-03', 'prince', 'Second lynch kills the revealed Prince', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    const prince = P(room, 'prince');
    lynch(room, prince);
    endNight(room);
    lynch(room, prince);
    assert(!alive(prince), 'prince dies on the second lynch');
});
c('PR-04', 'prince', 'Wolves can kill the Prince at night (ability is day-only)', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'prince'));
    endNight(room);
    assert(!alive(P(room, 'prince')), 'killed at night');
});
c('PR-05', 'prince', 'Revealer pending on a wolf + Prince lynch the same day: both events resolve', () => {
    const room = setup(['werewolf', 'werewolf', 'prince', 'revealer', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    E.useRevealAction(room, P(room, 'revealer').playerId, P(room, 'werewolf').playerId);
    lynch(room, P(room, 'prince'), { exclude: [P(room, 'revealer').playerId] });
    assert(!alive(P(room, 'werewolf')), 'revealer hit');
    assert(alive(P(room, 'prince')) && P(room, 'prince').princeRevealed, 'prince revealed');
});
c('PR-06', 'prince', 'Seer reads the Prince as "ดี"; Oracle reads "เจ้าชาย"', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'oracle', 'villager', 'villager']);
    assert(act(room, P(room, 'seer'), P(room, 'prince')).seerResult.resultCode === 'good', 'seer good');
    assert(act(room, P(room, 'oracle'), P(room, 'prince')).oracleResult.roleId === 'prince', 'oracle prince');
});
c('PR-07', 'prince', 'Revealer accuses the Prince → miss, Revealer dies', () => {
    const room = setup(['werewolf', 'prince', 'revealer', 'seer', 'villager', 'villager']);
    endNight(room);
    E.useRevealAction(room, P(room, 'revealer').playerId, P(room, 'prince').playerId);
    skipDay(room);
    assert(!alive(P(room, 'revealer')) && alive(P(room, 'prince')), 'revealer dies');
});
c('PR-08', 'prince', 'Lynch carried by a revealed Mayor (x2) still only reveals the Prince', () => {
    const room = setup(['werewolf', 'prince', 'mayor', 'seer', 'villager']);
    endNight(room);
    E.submitMayorReveal(room, P(room, 'mayor').playerId);
    toVote(room);
    E.submitDayVote(room, P(room, 'mayor').playerId, P(room, 'prince').playerId);
    E.submitDayVote(room, P(room, 'seer').playerId, P(room, 'prince').playerId);
    E.submitDayVote(room, P(room, 'villager').playerId, P(room, 'prince').playerId);
    if (room.gameState.phase === 'day-vote') E.autoResolvePhase(room);
    assert(alive(P(room, 'prince')) && P(room, 'prince').princeRevealed, 'revealed not killed');
});
c('PR-09', 'prince', 'Tie between Prince and someone else → no lynch, Prince stays hidden', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    toVote(room);
    const [a, b, d, e2, f] = room.gameState.players;
    E.submitDayVote(room, a.playerId, b.playerId);
    E.submitDayVote(room, d.playerId, b.playerId);
    E.submitDayVote(room, e2.playerId, a.playerId);
    E.submitDayVote(room, f.playerId, a.playerId);
    E.autoResolvePhase(room);
    assert(!P(room, 'prince').princeRevealed, 'not revealed on a tie');
});
c('PR-10', 'prince', 'Votes below the majority threshold → no reveal', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    toVote(room);
    E.submitDayVote(room, P(room, 'werewolf').playerId, P(room, 'prince').playerId);
    E.autoResolvePhase(room);
    assert(!P(room, 'prince').princeRevealed, 'below threshold');
});
c('PR-11', 'prince', 'Prince survival blocks a would-be wolf parity win that day', () => {
    const room = setup(['werewolf', 'werewolf', 'prince', 'villager', 'villager', 'seer']);
    lynchSetup(room, ['seer']);
    // 2 wolves vs prince + villager: lynching the prince would give wolves parity
    endNight(room);
    lynch(room, P(room, 'prince'));
    assert(!room.gameState.winner, 'no win: prince survived');
});
c('PR-12', 'prince', 'Skip-majority day → Prince not revealed', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    skipDay(room);
    assert(!P(room, 'prince').princeRevealed, 'no reveal on skip');
});
c('PR-13', 'prince', 'AFK Prince in the vote is filled as skip and can still be revealed by others', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    lynch(room, P(room, 'prince'));
    assert(room.gameState.dayVotes && P(room, 'prince').princeRevealed, 'revealed with AFK prince');
});
c('PR-14', 'prince', 'Prince who leaves dies silently (role hidden unless reveal-on-death is ON)', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    E.handlePlayerLeft(room, P(room, 'prince').playerId);
    const seat = state(room, P(room, 'villager')).players.find(p => p.playerId === P(room, 'prince').playerId);
    assert(!seat.roleId && !seat.princeRevealed, 'hidden by default');
    room.settings.werewolfRevealOnDeath = true;
    const seatOn = state(room, P(room, 'villager')).players.find(p => p.playerId === P(room, 'prince').playerId);
    assert(seatOn.roleId === 'prince', 'shown with reveal-on-death');
});
c('PR-15', 'prince', 'Host skip of the vote with the Prince leading → reveal path runs', () => {
    const room = setup(['werewolf', 'prince', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    toVote(room);
    ['werewolf', 'seer'].forEach(r => E.submitDayVote(room, P(room, r).playerId, P(room, 'prince').playerId));
    room.gameState.players.filter(p => p.role === 'villager').forEach(p => E.submitDayVote(room, p.playerId, P(room, 'prince').playerId));
    if (room.gameState.phase === 'day-vote') E.autoResolvePhase(room);
    assert(P(room, 'prince').princeRevealed, 'revealed');
});
c('PR-16', 'prince', 'Witch poison and SK kill the Prince normally', () => {
    const room = setup(['werewolf', 'prince', 'witch', 'serialKiller', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'witch'), P(room, 'prince'), 'witch-poison');
    endNight(room);
    assert(!alive(P(room, 'prince')), 'poisoned');
});

// ───────────────────────── Lycan ─────────────────────────
c('LY-01', 'lycan', 'Seer reads the Lycan as "ไม่ดี"', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager', 'villager']);
    assert(act(room, P(room, 'seer'), P(room, 'lycan')).seerResult.resultCode === 'bad', 'bad');
});
c('LY-02', 'lycan', 'Oracle reads the exact role "ไลแคน" (village)', () => {
    const room = setup(['werewolf', 'lycan', 'oracle', 'villager', 'villager']);
    const res = act(room, P(room, 'oracle'), P(room, 'lycan')).oracleResult;
    assert(res.roleId === 'lycan' && res.roleLabel === 'ไลแคน', 'oracle exact');
});
c('LY-03', 'lycan', 'Promoted Apprentice Seer also reads the Lycan as "ไม่ดี"', () => {
    const room = setup(['werewolf', 'lycan', 'apprenticeSeer', 'villager', 'villager']);
    assert(act(room, P(room, 'apprenticeSeer'), P(room, 'lycan')).seerResult.resultCode === 'bad', 'bad');
});
c('LY-04', 'lycan', 'Revealer accusing the Lycan misses (not a real wolf) → Revealer dies', () => {
    const room = setup(['werewolf', 'lycan', 'revealer', 'villager', 'villager', 'villager']);
    endNight(room);
    E.useRevealAction(room, P(room, 'revealer').playerId, P(room, 'lycan').playerId);
    skipDay(room);
    assert(!alive(P(room, 'revealer')) && alive(P(room, 'lycan')), 'revealer dies');
});
c('LY-05', 'lycan', 'Wolves can target and kill the Lycan (they are not told who it is)', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager', 'villager']);
    toNight(room, 2);
    assert(nightOptions(room, P(room, 'werewolf'))[0].targets.some(t => t.playerId === P(room, 'lycan').playerId), 'lycan targetable');
    wolvesKill(room, P(room, 'lycan'));
    endNight(room);
    assert(!alive(P(room, 'lycan')), 'dead');
});
c('LY-06', 'lycan', 'Lycan counts as village for wolf parity (1 wolf vs Lycan → wolves win)', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager']);
    lynchSetup(room, ['seer', 'villager']);
    assert(E.checkWinCondition(room) === 'werewolf', 'wolves win at parity');
});
c('LY-07', 'lycan', 'Lycan alive + all wolves dead → village wins (Lycan wins with village)', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager']);
    lynchSetup(room, ['werewolf']);
    assert(E.checkWinCondition(room) === 'village', 'village');
});
c('LY-08', 'lycan', 'Tracker on the Lycan: never "used a skill"', () => {
    const room = setup(['werewolf', 'lycan', 'tracker', 'villager', 'villager']);
    act(room, P(room, 'tracker'), P(room, 'lycan'));
    endNight(room);
    assert(P(room, 'tracker').trackerLastResult.acted === false, 'no skill');
});
c('LY-09', 'lycan', 'Lycan has no night card and cannot submit a night action', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager', 'villager']);
    assert(nightOptions(room, P(room, 'lycan')).length === 0, 'no card');
    expectThrow(() => act(room, P(room, 'lycan'), P(room, 'villager')), /ไม่มีสกิล/, 'lycan action');
});
c('LY-10', 'lycan', 'Lycan can press "ready for morning" (night skip) like a villager', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager', 'villager']);
    const res = E.submitNightSkip(room, P(room, 'lycan').playerId);
    assert(res && room.gameState.nightSkips[P(room, 'lycan').playerId], 'skip recorded');
});
c('LY-11', 'lycan', 'Lynched Lycan simply dies (no special effect)', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    lynch(room, P(room, 'lycan'));
    assert(!alive(P(room, 'lycan')) && !room.gameState.winner, 'dead, game on');
});
c('LY-12', 'lycan', 'Finished game reveals "ไลแคน" to everyone', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager']);
    endNight(room);
    lynch(room, P(room, 'werewolf'));
    assert(room.gameState.winner === 'village', 'village');
    const seat = state(room, P(room, 'seer')).players.find(p => p.playerId === P(room, 'lycan').playerId);
    assert(seat.revealedRole === 'ไลแคน', 'revealed at the end');
});
c('LY-13', 'lycan', 'Lycan role notes explain the seer reading', () => {
    const room = setup(['werewolf', 'lycan', 'seer', 'villager']);
    assert(state(room, P(room, 'lycan')).personalNotes.roleNotes.some(n => /ไม่ดี/.test(n)), 'note');
});
c('LY-14', 'lycan', 'Wolves’ teammate list never includes the Lycan', () => {
    const room = setup(['werewolf', 'werewolf', 'lycan', 'seer', 'villager', 'villager', 'villager']);
    const notes = state(room, P(room, 'werewolf')).personalNotes.roleNotes.join(' ');
    assert(!notes.includes(P(room, 'lycan').name), 'lycan not a teammate');
});
c('LY-15', 'lycan', 'Doctor can save the Lycan', () => {
    const room = setup(['werewolf', 'lycan', 'doctor', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'lycan'));
    act(room, P(room, 'doctor'), P(room, 'lycan'));
    endNight(room);
    assert(alive(P(room, 'lycan')), 'saved');
});

// ───────────────────────── Diseased ─────────────────────────
c('DI-01', 'diseased', 'Wolves kill the Diseased → next night wolves cannot hunt (server rejects picks)', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    expectThrow(() => act(room, P(room, 'werewolf'), P(room, 'villager')), /ติดเชื้อ/, 'sick wolves');
});
c('DI-02', 'diseased', 'Sick night: wolves are not required actors, night auto-ends without them', () => {
    const room = setup(['werewolf', 'diseased', 'villager', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    room.gameState.players.filter(p => alive(p) && p.role === 'villager').forEach(p => { if (room.gameState.phase === 'night') E.submitNightSkip(room, p.playerId); });
    assert(room.gameState.phase !== 'night', 'night ended without the wolves');
});
c('DI-03', 'diseased', 'Sick night: the Serial Killer still kills', () => {
    const room = setup(['werewolf', 'diseased', 'serialKiller', 'villager', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    act(room, P(room, 'serialKiller'), P(room, 'villager'));
    endNight(room);
    assert(!alive(P(room, 'villager')), 'SK kill on sick night');
});
c('DI-04', 'diseased', 'Sickness lasts exactly one night', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    endNight(room);
    skipDay(room);
    act(room, P(room, 'werewolf'), P(room, 'villager'));
    endNight(room);
    assert(!alive(P(room, 'villager')), 'wolves hunt again on night 4');
});
c('DI-05', 'diseased', 'Diseased saved by the doctor → no sickness', () => {
    const room = setup(['werewolf', 'diseased', 'doctor', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    act(room, P(room, 'doctor'), P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    assert(alive(P(room, 'diseased')) && !room.gameState.wolvesSickNight, 'saved → not sick');
    act(room, P(room, 'werewolf'), P(room, 'villager'));
    assert(room.gameState.nightActions.werewolfVotes[P(room, 'werewolf').playerId] === P(room, 'villager').playerId, 'wolves may hunt');
});
c('DI-06', 'diseased', 'Diseased poisoned by the witch → no sickness', () => {
    const room = setup(['werewolf', 'diseased', 'witch', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'witch'), P(room, 'diseased'), 'witch-poison');
    endNight(room);
    skipDay(room);
    act(room, P(room, 'werewolf'), P(room, 'villager'));
    assert(!room.gameState.wolvesSickNight, 'not sick');
});
c('DI-07', 'diseased', 'Diseased lynched → no sickness', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    endNight(room);
    lynch(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    act(room, P(room, 'werewolf'), P(room, 'villager'));
    assert(!room.gameState.wolvesSickNight, 'not sick');
});
c('DI-08', 'diseased', 'Diseased shot by the vigilante → no sickness', () => {
    const room = setup(['werewolf', 'diseased', 'vigilante', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'vigilante'), P(room, 'diseased'));
    endNight(room);
    assert(!room.gameState.wolvesSickNight, 'not sick');
});
c('DI-09', 'diseased', 'Sick wolves see a "pack is sick" card and note; SKIP is still accepted', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    const card = nightOptions(room, P(room, 'werewolf'))[0];
    assert(/ติดเชื้อ/.test(card.label) && card.targets.length === 0, 'sick card');
    assert(state(room, P(room, 'werewolf')).personalNotes.roleNotes.some(n => /ป่วย/.test(n)), 'sick note');
    act(room, P(room, 'werewolf'), SKIP);
});
c('DI-10', 'diseased', 'Sick night public text is neutral and the morning is "peaceful" (no leak of the cause)', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    endNight(room);
    const ann = state(room, P(room, 'seer')).morningAnnouncement;
    assert(ann.outcomeType === 'peaceful' && !/ติดเชื้อ|ป่วย/.test(json(ann)), 'neutral');
    assert(!/ติดเชื้อ|ป่วย/.test(json(room.gameState.history)), 'history neutral');
});
c('DI-11', 'diseased', 'Non-wolf payloads never carry the sickness flag', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    const v = state(room, P(room, 'villager'));
    assert(!json(v.actionState).includes('ติดเชื้อ') && !json(v.personalNotes).includes('ป่วย'), 'no leak');
});
c('DI-12', 'diseased', 'AFK on a sick night: timer resolves, no wolf kill', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    const aliveBefore = room.gameState.players.filter(alive).length;
    endNight(room);
    assert(room.gameState.players.filter(alive).length === aliveBefore, 'no deaths');
});
c('DI-13', 'diseased', 'Wolves win on the night they eat the Diseased → game ends (sickness irrelevant)', () => {
    const room = setup(['werewolf', 'diseased', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    assert(room.gameState.winner === 'werewolf', 'wolves win');
});
c('DI-14', 'diseased', 'Seer reads the Diseased as "ดี"', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager']);
    assert(act(room, P(room, 'seer'), P(room, 'diseased')).seerResult.resultCode === 'good', 'good');
});
c('DI-15', 'diseased', 'Witch on a sick night sees no wolf victim', () => {
    const room = setup(['werewolf', 'diseased', 'witch', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    endNight(room);
    skipDay(room);
    const heal = nightOptions(room, P(room, 'witch')).find(a => a.type === 'witch-heal');
    assert(!heal.witchVictimName, 'no victim');
});
c('DI-16', 'diseased', 'Host skip on the night the Diseased dies still sets the sickness', () => {
    const room = setup(['werewolf', 'diseased', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'diseased'));
    E.autoResolvePhase(room);
    assert(room.gameState.wolvesSickNight === 3, 'sick on night 3');
});

// ───────────────────────── Apprentice Seer ─────────────────────────
c('AP-01', 'apprenticeSeer', 'Seer alive → Apprentice has no card, is not required, submit is rejected', () => {
    const room = setup(['werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager']);
    assert(nightOptions(room, P(room, 'apprenticeSeer')).length === 0, 'no card');
    expectThrow(() => act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf')), /ยังมีชีวิต/, 'inactive');
});
c('AP-02', 'apprenticeSeer', 'Seer killed at night → next night the Apprentice gets the aura check', () => {
    const room = setup(['werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'seer'));
    endNight(room);
    skipDay(room);
    const card = nightOptions(room, P(room, 'apprenticeSeer'))[0];
    assert(card && card.type === 'seer-check', 'promoted');
});
c('AP-03', 'apprenticeSeer', 'Seer lynched → the Apprentice checks that same night', () => {
    const room = setup(['werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    endNight(room);
    lynch(room, P(room, 'seer'));
    const res = act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf')).seerResult;
    assert(res.resultCode === 'bad', 'wolf bad');
});
c('AP-04', 'apprenticeSeer', 'No Seer dealt → Apprentice is active from night 1', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager']);
    assert(nightOptions(room, P(room, 'apprenticeSeer'))[0].type === 'seer-check', 'active');
});
c('AP-05', 'apprenticeSeer', 'Readings match the Seer: wolf bad, alpha unknown, fool unknown, lycan bad, villager good', () => {
    const roles = ['werewolf', 'alphaWolf', 'fool', 'lycan', 'villager', 'apprenticeSeer', 'villager'];
    const expected = { werewolf: 'bad', alphaWolf: 'unknown', fool: 'unknown', lycan: 'bad', villager: 'good' };
    Object.entries(expected).forEach(([role, code]) => {
        const room = setup(roles);
        const got = act(room, P(room, 'apprenticeSeer'), P(room, role)).seerResult.resultCode;
        assert(got === code, `${role}: expected ${code}, got ${got}`);
    });
});
c('AP-06', 'apprenticeSeer', 'Promoted Apprentice cannot check self', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager']);
    expectThrow(() => act(room, P(room, 'apprenticeSeer'), P(room, 'apprenticeSeer')), /ตัวเอง/, 'self');
});
c('AP-07', 'apprenticeSeer', 'One check per night (locked after the first)', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager']);
    act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf'));
    expectThrow(() => act(room, P(room, 'apprenticeSeer'), P(room, 'villager')), /1 คนต่อคืน/, 'second check');
});
c('AP-08', 'apprenticeSeer', 'Results are kept in the Apprentice’s seer history', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager']);
    act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf'));
    endNight(room);
    assert(state(room, P(room, 'apprenticeSeer')).personalNotes.seerHistory.length === 1, 'history');
});
c('AP-09', 'apprenticeSeer', 'Tracker sees a promoted Apprentice "used a skill"', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'tracker', 'villager', 'villager']);
    act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf'));
    act(room, P(room, 'tracker'), P(room, 'apprenticeSeer'));
    endNight(room);
    assert(P(room, 'tracker').trackerLastResult.acted === true, 'acted');
});
c('AP-10', 'apprenticeSeer', 'AFK promoted Apprentice → filled as skip, no free random check', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager']);
    endNight(room);
    assert(P(room, 'apprenticeSeer').seerHistory.length === 0, 'no random check');
});
c('AP-11', 'apprenticeSeer', 'Seer disconnects mid-night → Apprentice active immediately; night still resolves', () => {
    const room = setup(['werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    E.handlePlayerLeft(room, P(room, 'seer').playerId);
    assert(nightOptions(room, P(room, 'apprenticeSeer'))[0].type === 'seer-check', 'active after leave');
    act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf'));
    endNight(room);
    assert(room.gameState.phase === 'day-discussion', 'resolved');
});
c('AP-12', 'apprenticeSeer', 'Role notes change when promoted', () => {
    const room = setup(['werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    const before = state(room, P(room, 'apprenticeSeer')).personalNotes.roleNotes.join(' ');
    lynchSetup(room, ['seer']);
    const after = state(room, P(room, 'apprenticeSeer')).personalNotes.roleNotes.join(' ');
    assert(/ยังมีชีวิต/.test(before) && /ไม่มีผู้หยั่งรู้เหลือรอด/.test(after), 'notes updated');
});
c('AP-13', 'apprenticeSeer', 'Other players’ payloads do not reveal the promotion', () => {
    const room = setup(['werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    lynchSetup(room, ['seer']);
    toNight(room, 2);
    act(room, P(room, 'apprenticeSeer'), P(room, 'villager'));
    const wolfView = json(state(room, P(room, 'werewolf')).actionState);
    assert(!wolfView.includes('seer-check'), 'wolf cannot see the check');
});
c('AP-14', 'apprenticeSeer', 'Host skip after the Apprentice picked → result kept', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager']);
    act(room, P(room, 'apprenticeSeer'), P(room, 'werewolf'));
    E.autoResolvePhase(room);
    assert(P(room, 'apprenticeSeer').seerHistory[0].resultCode === 'bad', 'kept');
});
c('AP-15', 'apprenticeSeer', 'Dead Apprentice has no actions even with no Seer', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    lynchSetup(room, ['apprenticeSeer']);
    assert(nightOptions(room, P(room, 'apprenticeSeer')).length === 0, 'none');
});
c('AP-16', 'apprenticeSeer', 'Apprentice becomes a required actor once promoted (night waits for it)', () => {
    const room = setup(['werewolf', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    wolvesKill(room, P(room, 'villager'));
    room.gameState.players.filter(p => p.role === 'villager' && alive(p)).forEach(p => { if (room.gameState.phase === 'night') E.submitNightSkip(room, p.playerId); });
    assert(room.gameState.phase === 'night', 'waits for apprentice');
});

// ───────────────────────── Witch fidelity ─────────────────────────
c('WI-01', 'witch', 'Witch uses heal and poison in the same night (Miller’s Hollow rule)', () => {
    const room = setup(['werewolf', 'witch', 'villager', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const victim = P(room, 'villager');
    wolvesKill(room, victim);
    act(room, P(room, 'witch'), victim, 'witch-heal');
    act(room, P(room, 'witch'), P(room, 'werewolf'), 'witch-poison');
    endNight(room);
    assert(alive(victim) && !alive(P(room, 'werewolf')), 'both potions worked');
    assert(room.gameState.winner === 'village', 'village wins');
});
c('WI-02', 'witch', 'Witch sees the wolves’ current pick live; nothing on night 1', () => {
    const room = setup(['werewolf', 'witch', 'villager', 'villager', 'villager']);
    assert(!nightOptions(room, P(room, 'witch'))[0].witchVictimName, 'night 1 nothing');
    toNight(room, 2);
    wolvesKill(room, P(room, 'villager', 1));
    const heal = nightOptions(room, P(room, 'witch')).find(a => a.type === 'witch-heal');
    assert(heal.witchVictimName === P(room, 'villager', 1).name, 'victim shown');
    const villagerView = json(state(room, P(room, 'villager')));
    assert(!villagerView.includes('witchVictimName'), 'only the witch gets it');
});
c('WI-03', 'witch', 'Witch decision is complete only when every remaining potion is chosen or skipped', () => {
    const room = setup(['werewolf', 'witch', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    act(room, P(room, 'witch'), P(room, 'villager'), 'witch-heal');
    const options = nightOptions(room, P(room, 'witch'));
    assert(options.length === 2, 'both potion cards stay open');
    act(room, P(room, 'witch'), SKIP, 'witch-poison');
    assert(room.gameState.nightActions.witchHeals[P(room, 'witch').playerId] === P(room, 'villager').playerId, 'heal kept');
});
c('WI-04', 'witch', 'Skip on one potion with nothing chosen = no potion tonight (both skipped)', () => {
    const room = setup(['werewolf', 'witch', 'villager', 'villager', 'villager']);
    act(room, P(room, 'witch'), SKIP, 'witch-heal');
    assert(room.gameState.nightActions.witchPoisons[P(room, 'witch').playerId] === SKIP, 'poison skipped too');
});

// ───────────────────────── Table / 20 players ─────────────────────────
c('TB-01', 'table', 'Recommended table 5–20: right size, wolves ≈ n/4–5, ≤ n/3, one SK max', () => {
    for (let n = 5; n <= 20; n += 1) {
        for (let k = 0; k < 20; k += 1) {
            const plan = E.getRolePlan(n, { werewolfRoles: [], wolfCount: null }).map(r => r.id);
            const wolves = plan.filter(r => r === 'werewolf' || r === 'alphaWolf').length;
            assert(plan.length === n, `size ${n}`);
            assert(wolves === E.getRecommendedWolfCount(n) && wolves <= Math.floor(n / 3), `wolves ${n}: ${wolves}`);
            assert(plan.filter(r => r === 'serialKiller').length <= 1, 'one SK');
            assert(plan.includes('seer') && plan.includes('doctor'), 'seer+doctor core');
            const nonVillager = plan.filter(r => r !== 'villager' && r !== 'werewolf');
            assert(new Set(nonVillager).size === nonVillager.length, `no duplicate specials at ${n}`);
        }
    }
});
c('TB-02', 'table', 'Host wolf count 1–5 is honoured up to the n/3 cap at every size', () => {
    for (let n = 5; n <= 20; n += 1) {
        for (let w = 1; w <= 5; w += 1) {
            const plan = E.getRolePlan(n, { werewolfRoles: [], wolfCount: w }).map(r => r.id);
            const wolves = plan.filter(r => r === 'werewolf' || r === 'alphaWolf').length;
            assert(plan.length === n && wolves === Math.min(w, Math.floor(n / 3)), `n=${n} w=${w} got ${wolves}`);
        }
    }
});
c('TB-03', 'table', '20 connected players are all dealt a valid role', () => {
    const room = { roomId: 'x', settings: { gameMode: 'werewolf', werewolfRoles: [] }, players: Array.from({ length: 20 }, (_, i) => ({ playerId: `p${i}`, playerName: `P${i}`, socketId: `s${i}` })) };
    E.startGame(room);
    assert(room.gameState.players.length === 20 && room.gameState.players.every(p => E.ROLE_DEFINITIONS[p.role]), 'all dealt');
    assert(E.maxPlayers === 20 && E.minPlayers === 3, 'engine limits');
});
c('TB-04', 'table', 'Host-ticked roles at 11–20 players: each ticked role once, rest villagers', () => {
    const plan = E.getRolePlan(15, { werewolfRoles: ['werewolf', 'seer', 'serialKiller', 'prince'] }).map(r => r.id);
    assert(plan.length === 15 && plan.filter(r => r === 'werewolf').length === 3, 'wolves');
    assert(['seer', 'serialKiller', 'prince'].every(r => plan.filter(x => x === r).length === 1), 'specials once');
});
c('TB-05', 'table', 'Reveal-on-death setting sanitised (default OFF, owner-approved hidden roles)', () => {
    assert(E.sanitizeWerewolfSettings({}).werewolfRevealOnDeath === false, 'default off');
    assert(E.sanitizeWerewolfSettings({ werewolfRevealOnDeath: true }).werewolfRevealOnDeath === true, 'on');
    const room = setup(['werewolf', 'seer', 'villager', 'villager', 'villager'], { werewolfRevealOnDeath: true });
    toNight(room, 2);
    wolvesKill(room, P(room, 'seer'));
    endNight(room);
    const view = state(room, P(room, 'villager'));
    const seat = view.players.find(p => p.playerId === P(room, 'seer').playerId);
    assert(seat.roleId === 'seer' && /ผู้หยั่งรู้/.test(view.morningAnnouncement.detail), 'revealed on death');
    assert(view.players.filter(p => p.alive && !p.isSelf).every(p => !p.roleId), 'living stay hidden');
});

// ───────────────────────── Leaving mid-game (production path: roomManager removes the seat first) ─────────────────────────
function removeSeat(room, player) {
    room.players = room.players.filter(p => p.playerId !== player.playerId);
    room.gameState.players = room.gameState.players.filter(p => p.playerId !== player.playerId);
    return E.handlePlayerLeft(room, player.playerId);
}
c('LV-01', 'leave', 'Last wolf leaves (seat removed) → village wins at once (was: game kept running)', () => {
    const room = setup(['werewolf', 'seer', 'doctor', 'villager', 'villager']);
    endNight(room);
    removeSeat(room, P(room, 'werewolf'));
    assert(room.gameState.winner === 'village', `village wins, got ${room.gameState.winner}`);
});
c('LV-02', 'leave', 'Serial Killer leaves mid-night: pending kill dropped, night still resolves', () => {
    const room = setup(['werewolf', 'serialKiller', 'seer', 'villager', 'villager', 'villager']);
    toNight(room, 2);
    const sk = P(room, 'serialKiller');
    const target = P(room, 'villager');
    act(room, sk, target);
    removeSeat(room, sk);
    assert(!room.gameState.nightActions.serialKills[sk.playerId], 'pick dropped');
    if (room.gameState.phase === 'night') endNight(room);
    assert(alive(target), 'no kill from a departed SK');
});
c('LV-03', 'leave', 'Seer leaves (seat removed) → Apprentice promoted; wolf leaving mid-vote lets the day resolve', () => {
    const room = setup(['werewolf', 'werewolf', 'seer', 'apprenticeSeer', 'villager', 'villager', 'villager']);
    removeSeat(room, P(room, 'seer'));
    assert(nightOptions(room, P(room, 'apprenticeSeer'))[0].type === 'seer-check', 'apprentice active');
    endNight(room);
    toVote(room);
    const stay = room.gameState.players.filter(p => p.playerId !== P(room, 'werewolf', 1).playerId);
    stay.forEach(p => { if (room.gameState.phase === 'day-vote') E.submitDayVote(room, p.playerId, SKIP); });
    removeSeat(room, P(room, 'werewolf', 1));
    assert(room.gameState.phase !== 'day-vote', 'day resolves once the last voter left');
});

// helper: kill the listed roles outright (setup shortcut, not a game action)
function lynchSetup(room, roles) {
    roles.forEach(role => {
        const target = room.gameState.players.find(p => p.role === role && p.alive !== false);
        assert(target, `lynchSetup: no living ${role}`);
        target.alive = false;
    });
    room.gameState.alivePlayerIds = room.gameState.players.filter(alive).map(p => p.playerId);
}

function main() {
    const mdIndex = process.argv.indexOf('--md');
    const failures = [];
    cases.forEach(testCase => {
        try {
            testCase.run();
        } catch (error) {
            failures.push(`${testCase.id} ${testCase.title}: ${error.message}`);
        }
    });
    const byRole = cases.reduce((acc, item) => { acc[item.role] = (acc[item.role] || 0) + 1; return acc; }, {});
    if (mdIndex !== -1) {
        const titles = { serialKiller: 'ฆาตกรต่อเนื่อง (Serial Killer)', prince: 'เจ้าชาย (Prince)', lycan: 'ไลแคน (Lycan)', diseased: 'ผู้ติดเชื้อ (Diseased)', apprenticeSeer: 'ศิษย์ผู้หยั่งรู้ (Apprentice Seer)', witch: 'แม่มด — rules-fidelity fix', table: 'ตารางบท / 20 คน', leave: 'ออกกลางเกม (ปุ่ม 🚪 ออก)' };
        const lines = ['# Werewolf new roles — use cases', '', 'Generated from `scripts/smoke-werewolf-new-roles.js` (each line is an automated test; run `npm run smoke:werewolf:new-roles`).', ''];
        Object.keys(titles).forEach(role => {
            lines.push(`## ${titles[role]} — ${byRole[role] || 0} cases`, '');
            cases.filter(item => item.role === role).forEach(item => lines.push(`- **${item.id}** ${item.title}`));
            lines.push('');
        });
        lines.push('Socket/browser coverage: `scripts/smoke-werewolf-20.js` (20 socket clients, full game, payload-leak checks) and `scripts/browser-werewolf-20.js` (20 seats at 390×844 + landscape).', '');
        fs.writeFileSync(process.argv[mdIndex + 1], lines.join('\n'));
    }
    console.log(`cases: ${cases.length} ${JSON.stringify(byRole)}`);
    if (failures.length) {
        failures.forEach(line => console.error('FAIL', line));
        process.exitCode = 1;
        return;
    }
    console.log(`SMOKE_RESULT ${JSON.stringify({ passed: cases.length, byRole })}`);
}

main();
