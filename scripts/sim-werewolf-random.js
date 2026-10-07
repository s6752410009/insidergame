// Randomised Werewolf simulations (engine level). Thousands of games at 5/10/15/20 players
// with random role mixes and random-but-legal play, asserting invariants every step:
//   exactly one winning resolution · no dead player acts · the dead stay dead ·
//   no secret role/info in other viewers' payloads · every timer step advances the phase.
// Usage: node scripts/sim-werewolf-random.js [gamesPerSize=1000]
const E = require('../games/werewolfEngine');

const SKIP = E.SKIP_TARGET_ID;
const GAMES = Number(process.argv[2] || process.env.SIM_GAMES || 1000);
const SIZES = [5, 10, 15, 20];
const WOLF_IDS = ['werewolf', 'alphaWolf'];
const WINNERS = new Set(['village', 'werewolf', 'fool', 'serialKiller']);
const MAX_DAYS = 60;

let seed = Number(process.env.SIM_SEED || 20261007);
function rand() {
    // mulberry32 — reproducible runs
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = rand; // engine shuffles use Math.random → whole run reproducible from SIM_SEED
const pick = list => list[Math.floor(rand() * list.length)];
const chance = p => rand() < p;

function fail(message, ctx) {
    const error = new Error(`${message} :: ${JSON.stringify(ctx)}`);
    error.sim = true;
    throw error;
}

function randomSettings(n) {
    const mode = rand();
    const settings = { gameMode: 'werewolf', werewolfRevealOnDeath: chance(0.3), werewolfDeadSeeRoles: chance(0.8) };
    if (mode < 0.45) {
        settings.werewolfRoles = []; // auto table
    } else if (mode < 0.7) {
        settings.werewolfRoles = [];
        settings.wolfCount = 1 + Math.floor(rand() * 5);
    } else {
        const pool = E.CONFIGURABLE_ROLE_IDS.filter(() => chance(0.55));
        settings.werewolfRoles = pool.length ? pool : ['werewolf', 'seer'];
    }
    return settings;
}

function makeRoom(n) {
    const room = {
        roomId: `sim-${n}`,
        name: 'sim',
        admin: 'p1',
        settings: randomSettings(n),
        players: Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, playerName: `P${i + 1}`, socketId: `s${i + 1}`, color: '#fff' }))
    };
    E.startGame(room);
    return room;
}

const alivePlayers = room => room.gameState.players.filter(p => p.alive !== false);

function checkPayloads(room, ctx) {
    const gs = room.gameState;
    const finished = gs.phase === 'finished';
    gs.players.forEach(viewer => {
        const view = E.buildClientState(room, viewer.playerId, { includeStatic: false });
        const raw = JSON.stringify(view);
        ['werewolfVotes', 'serialKills', 'seerChecks', 'witchPoisons', 'wolvesSickNight', 'doctorSaves'].forEach(key => {
            if (raw.includes(key)) fail(`payload leaks ${key}`, ctx);
        });
        if (finished) return;
        const deadView = viewer.alive === false && room.settings.werewolfDeadSeeRoles !== false;
        view.players.forEach(seat => {
            if (seat.isSelf || deadView) return;
            const real = gs.players.find(p => p.playerId === seat.playerId);
            const publicKnown = (room.settings.werewolfRevealOnDeath === true && real.alive === false)
                || (real.role === 'prince' && real.princeRevealed);
            if ((seat.roleId || seat.roleThaiName || seat.revealedRole) && !publicKnown) {
                fail('secret role leaked to living viewer', { ...ctx, viewer: viewer.role, seat: real.role });
            }
        });
        // night cards belong to the viewer's own role only
        (view.actionState.nightActions || []).forEach(card => {
            const allowed = {
                werewolf: ['night-kill'], alphaWolf: ['night-kill'], seer: ['seer-check'], apprenticeSeer: ['seer-check'],
                oracle: ['oracle-read'], doctor: ['doctor-save'], bodyguard: ['bodyguard-protect'],
                witch: ['witch-heal', 'witch-poison', 'witch-rest'], tracker: ['tracker-scan'], vigilante: ['vigilante-shot'],
                hunter: ['hunter-shot'], serialKiller: ['serial-kill']
            }[viewer.role] || [];
            if (!allowed.includes(card.type)) fail(`viewer ${viewer.role} got card ${card.type}`, ctx);
        });
        if (viewer.alive === false && (view.actionState.nightActions || []).length) fail('dead viewer got night cards', ctx);
    });
}

function randomNight(room) {
    const gs = room.gameState;
    const living = alivePlayers(room);
    const wolfTarget = pick(living.filter(p => !WOLF_IDS.includes(p.role)) || []);
    living.forEach(actor => {
        if (gs.phase !== 'night') return;
        if (chance(0.12)) return; // AFK
        const options = E.buildClientState(room, actor.playerId).actionState.nightActions || [];
        options.forEach(card => {
            if (gs.phase !== 'night' || card.locked) return;
            let target = null;
            if (card.type === 'night-kill' && wolfTarget && card.targets.length && chance(0.85)) {
                target = card.targets.some(t => t.playerId === wolfTarget.playerId) ? wolfTarget.playerId : pick(card.targets).playerId;
            } else if (card.targets.length && chance(0.7)) {
                target = pick(card.targets).playerId;
            } else if (card.allowSkip) {
                target = SKIP;
            }
            if (!target) return;
            try {
                E.submitNightAction(room, actor.playerId, target, card.type.startsWith('witch-') ? card.type : null);
            } catch (error) {
                // legal-looking picks can still be refused (bodyguard repeat etc.) — must be a clean Error
                if (!(error instanceof Error)) throw error;
            }
        });
        if (gs.phase === 'night' && chance(0.5)) {
            try { E.submitNightSkip(room, actor.playerId); } catch (error) { /* ignore */ }
        }
        if (gs.phase === 'night' && chance(0.3)) E.maybeAutoEndNight(room);
    });
}

function randomDay(room) {
    const gs = room.gameState;
    if (gs.phase === 'day-discussion') {
        alivePlayers(room).forEach(actor => {
            if (gs.phase !== 'day-discussion') return;
            try {
                if (actor.role === 'mayor' && chance(0.4)) E.submitMayorReveal(room, actor.playerId);
                if (actor.role === 'cleric' && !actor.clericBlessUsed && chance(0.4)) {
                    const t = pick(alivePlayers(room).filter(p => p.playerId !== actor.playerId));
                    if (t) E.submitClericBless(room, actor.playerId, t.playerId);
                }
                if (actor.role === 'revealer' && !actor.revealerUsed && chance(0.2)) {
                    const t = pick(alivePlayers(room).filter(p => p.playerId !== actor.playerId));
                    if (t) E.useRevealAction(room, actor.playerId, t.playerId);
                }
                if (chance(0.3)) E.submitDiscussionSkip(room, actor.playerId);
            } catch (error) { /* refused actions are fine */ }
        });
        return;
    }
    if (gs.phase === 'day-vote') {
        const living = alivePlayers(room);
        const bandwagon = pick(living);
        living.forEach(actor => {
            if (gs.phase !== 'day-vote' || chance(0.1)) return;
            let target = chance(0.65) ? bandwagon.playerId : (chance(0.5) ? pick(living).playerId : SKIP);
            if (target === actor.playerId) target = SKIP;
            try { E.submitDayVote(room, actor.playerId, target, { lastCall: chance(0.5) }); } catch (error) { /* ignore */ }
        });
    }
}

function snapshot(room) {
    return {
        dead: new Set(room.gameState.players.filter(p => p.alive === false).map(p => p.playerId)),
        phase: room.gameState.phase,
        day: room.gameState.dayNumber,
        winner: room.gameState.winner
    };
}

function invariantStep(room, before, ctx) {
    const gs = room.gameState;
    before.dead.forEach(id => {
        const p = gs.players.find(x => x.playerId === id);
        if (p.alive !== false) fail('dead player came back', { ...ctx, id });
    });
    if (before.winner && gs.winner !== before.winner) fail('winner changed after finish', ctx);
    if (gs.winner && !WINNERS.has(gs.winner)) fail('unknown winner', { ...ctx, winner: gs.winner });
    if (gs.phase === 'finished' && !gs.winner) fail('finished without a winner', ctx);
    if (gs.winner && gs.phase !== 'finished') fail('winner set but not finished', ctx);
    // dead players can never act
    const dead = gs.players.find(p => p.alive === false);
    if (dead && gs.phase === 'night') {
        let threw = false;
        try { E.submitNightAction(room, dead.playerId, SKIP); } catch (error) { threw = true; }
        if (!threw) fail('dead player could act at night', ctx);
    }
    if (dead && gs.phase === 'day-vote') {
        let threw = false;
        try { E.submitDayVote(room, dead.playerId, SKIP); } catch (error) { threw = true; }
        if (!threw) fail('dead player could vote', ctx);
    }
}

function playGame(n, gameIndex, stats) {
    const room = makeRoom(n);
    const ctx = { n, gameIndex, seedRoles: room.gameState.players.map(p => p.role).join(',') };
    const sk = room.gameState.players.filter(p => p.role === 'serialKiller').length;
    if (sk > 1) fail('more than one serial killer dealt', ctx);
    let steps = 0;
    while (room.gameState.phase !== 'finished') {
        steps += 1;
        if (steps > 2000 || room.gameState.dayNumber > MAX_DAYS) {
            stats.longGames += 1;
            return;
        }
        let before = snapshot(room);
        ctx.phase = room.gameState.phase;
        ctx.day = room.gameState.dayNumber;
        if (room.gameState.phase === 'night') randomNight(room);
        else randomDay(room);
        invariantStep(room, before, ctx);
        if (chance(0.02) && room.gameState.phase !== 'finished') {
            const leaver = pick(alivePlayers(room));
            if (leaver) {
                E.handlePlayerLeft(room, leaver.playerId);
                stats.leaves += 1;
            }
        }
        if (chance(0.25) && room.gameState.phase !== 'finished') checkPayloads(room, ctx);
        if (room.gameState.phase === 'finished') break;
        // timer / host skip fires: the phase MUST advance
        before = snapshot(room);
        const phaseBefore = room.gameState.phase;
        const dayBefore = room.gameState.dayNumber;
        if (room.gameState.phase === 'day-vote' && room.gameState.voteClosesAt) room.gameState.voteClosesAt = null;
        E.autoResolvePhase(room);
        if (room.gameState.phase === phaseBefore && room.gameState.dayNumber === dayBefore) {
            fail('autoResolvePhase did not advance the phase', { ...ctx, phaseBefore });
        }
        invariantStep(room, before, ctx);
    }
    checkPayloads(room, ctx);
    const results = room.gameState.history.filter(h => h.type === 'result').length;
    if (results !== 1) fail(`expected exactly one winning resolution, got ${results}`, ctx);
    // after finish, nothing can change the result
    try { E.submitNightAction(room, room.gameState.players[0].playerId, SKIP); } catch (error) { /* expected */ }
    if (E.autoResolvePhase(room).winner !== room.gameState.winner) fail('post-finish resolve changed winner', ctx);
    stats.winners[room.gameState.winner] = (stats.winners[room.gameState.winner] || 0) + 1;
    stats.days += room.gameState.dayNumber;
}

function main() {
    const summary = {};
    let total = 0;
    SIZES.forEach(n => {
        const stats = { games: 0, winners: {}, days: 0, leaves: 0, longGames: 0 };
        for (let g = 0; g < GAMES; g += 1) {
            playGame(n, g, stats);
            stats.games += 1;
            total += 1;
        }
        stats.avgDays = Number((stats.days / Math.max(1, stats.games - stats.longGames)).toFixed(2));
        delete stats.days;
        summary[n] = stats;
        console.log(`n=${n}`, JSON.stringify(stats));
    });
    const long = Object.values(summary).reduce((sum, s) => sum + s.longGames, 0);
    if (long > total * 0.01) {
        console.error(`too many games never ended: ${long}/${total}`);
        process.exitCode = 1;
        return;
    }
    console.log(`SMOKE_RESULT ${JSON.stringify({ games: total, summary })}`);
}

try {
    main();
} catch (error) {
    console.error('SIM_FAIL', error.message);
    process.exitCode = 1;
}
