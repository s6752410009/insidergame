require('./isolateTestData');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../games/slaveEngine');
const createRuntime = require('../games/slaveRuntime');
let stats = require('../managers/statsManager');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
const rooms = new Map(), logs = [], ends = [], states = [];
let persistCount = 0;
const runtime = createRuntime(() => ({
    io:{ to:id => ({ emit:(event, data) => states.push({ id, event, data }) }) },
    roomManager:{ getRoom:id => rooms.get(id), schedulePersistRooms:() => { persistCount += 1; } },
    buildRoomUpdatePayload:room => ({ roomId:room.roomId, phase:room.gameState.phase }),
    statsManager:stats,
    addServerLog:(io, category, roomId, message, type, options) => logs.push({ category, roomId, message, type, ...options }),
    notifyGameEndAfterRecord:(room, options) => ends.push({ roomId:room.roomId, options, ...runtime.gameEndNotification(room) }),
    reportGameError:(room, message, error) => { throw error; }
}));
function createRoom(id, prefix = id, bot = false) {
    const players = Array.from({ length:4 }, (_, index) => ({ playerId:bot && index === 3 ? 'bot_' + prefix : prefix + '-' + index, playerName:'ผู้เล่น ' + index, socketId:prefix + '-socket-' + index }));
    const room = { roomId:id, name:'โต๊ะทดสอบ ' + id, players, admin:players[0].playerId, settings:{ gameMode:'slave' } };
    rooms.set(id, room);
    runtime.startGame(room);
    runtime.emitRoomState(room);
    return room;
}
function finishRound(room) {
    for (let n = 0; n < 1000 && ['turn', 'exchange'].includes(room.gameState.phase); n += 1) {
        room.gameState.phaseEndsAt = Date.now() - 1;
        ok(engine.autoResolvePhase(room), 'human legal-action simulation advances the round');
        runtime.emitRoomState(room);
    }
    runtime.clearTimers(room.roomId);
    ok(room.gameState.phase === 'round-end', 'round completes with four standings');
}
function counters(room) { return room.players.map(player => stats.getStats(player.playerId)); }
async function main() {
    ok(stats.GAME_MODES.includes('slave'), 'Slave is a normalized supported game mode');
    const room = createRoom('human');
    ok(room.gameState.gameId && room.gameState.startedAt && room.gameState.roundStartedAt, 'server creates game identity and round start timestamps');
    finishRound(room);
    const first = structuredClone(room.gameState);
    const firstIds = first.standings.map(row => row.playerId);
    ok(ends.length === 1, 'one completed-round admin summary');
    ok(ends[0].options.chat === false, 'result summary does not spam room chat');
    ok(ends[0].meta.ranked && !ends[0].meta.debugUsed, 'human result audit is ranked');
    ok(ends[0].meta.standings.length === 4 && ends[0].meta.round === 1, 'admin summary includes all four placements');
    first.standings.forEach((row, index) => {
        const stat = stats.getStats(row.playerId);
        ok(stat.totalGames === 1 && stat.modeStats.slave.games === 1, 'one round counts once for ' + row.playerId);
        ok(stat.modeStats.slave.wins === (index === 0 ? 1 : 0), 'only King wins');
        const history = stat.gameHistory[0];
        ok(history.mode === 'slave' && history.place === index + 1 && history.role === row.title, 'history preserves Slave placement and role');
        ok(history.round === 1 && history.resultId === first.gameId + ':1', 'stable round identity');
        ok(history.roomName === room.name && history.startedAt && history.endedAt, 'history preserves room and timestamps');
        ok(!Object.hasOwn(history, 'hand') && !Object.hasOwn(history, 'cards'), 'profile history has no private cards');
    });
    const beforeLogCount = logs.length;
    for (let n = 0; n < 3; n += 1) { runtime.emitRoomState(room); runtime.recover(room); }
    ok(ends.length === 1 && logs.length === beforeLogCount, 'resync and recovery do not duplicate logs');
    ok(counters(room).every(stat => stat.totalGames === 1), 'resync and recovery do not duplicate wins or games');
    ok(logs.some(item => item.meta.kind === 'play') && logs.some(item => item.meta.kind === 'pass'), 'admin keeps public play and pass logs');
    ok(logs.every(item => !Object.hasOwn(item.meta || {}, 'hands') && !Object.hasOwn(item.meta || {}, 'cards')), 'audit excludes hands and private exchange cards');
    ok(first.auditHistory.length <= 100 && first.lastLoggedAuditSequence === first.auditSequence, 'bounded public-action audit is fully flushed');
    const countBeforeDirectRetry = counters(room).map(stat => stat.totalGames);
    stats.recordGameEnd(room.roomId, { mode:'slave', resultId:first.gameId + ':1', gameId:first.gameId, round:1, standings:first.standings, endedAt:first.roundEndedAt });
    ok(counters(room).every((stat, index) => stat.totalGames === countBeforeDirectRetry[index]), 'persisted result ID rejects direct duplicate recording');
    engine.nextRound(room, room.admin);
    runtime.emitRoomState(room);
    ok(room.gameState.phase === 'exchange', 'second round continues into exchange without lobby reset');
    finishRound(room);
    ok(ends.length === 2 && ends[1].meta.round === 2, 'second round has its own admin result');
    ok(counters(room).every(stat => stat.totalGames === 2 && stat.modeStats.slave.games === 2), 'both rounds count independently');
    await stats.saveStats();
    const statsPath = require.resolve('../managers/statsManager');
    delete require.cache[statsPath];
    stats = require('../managers/statsManager');
    const reloaded = stats.getStats(firstIds[0]);
    ok(reloaded.modeStats.slave.games === 2 && reloaded.gameHistory[0].mode === 'slave', 'JSON reload preserves mode totals and history');
    const oldSnapshot = structuredClone(room);
    oldSnapshot.gameState.statsRecordedRound = 1;
    runtime.finalizeRoundIfNeeded(oldSnapshot);
    ok(counters(room).every(stat => stat.totalGames === 2), 'stale room snapshot after restart cannot count the result twice');
    const leaderboard = stats.getLeaderboard(undefined, 'slave');
    ok(leaderboard.length === 4 && leaderboard.every(row => row.mode === 'slave' && row.totalGames === 2), 'Slave leaderboard uses only Slave results');
    const bots = createRoom('bots', 'bots', true);
    finishRound(bots);
    ok(bots.players.filter(player => !engine.isBotId(player.playerId)).every(player => !stats.getStats(player.playerId)), 'bot table never adds human ranked stats');
    ok(ends.at(-1).meta.ranked === false && ends.at(-1).meta.standings.length === 4, 'bot table still has complete unranked admin result');
    const debug = createRoom('debug');
    debug.gameState.debugUsed = true;
    finishRound(debug);
    ok(debug.players.every(player => !stats.getStats(player.playerId)), 'debug table never adds ranked stats');
    ok(ends.at(-1).meta.debugUsed && !ends.at(-1).meta.ranked, 'debug result is identifiable in admin audit');
    const cancelled = createRoom('cancelled');
    runtime.handleLeft(cancelled, cancelled.players[1].playerId);
    runtime.emitRoomState(cancelled);
    runtime.recover(cancelled);
    runtime.emitRoomState(cancelled);
    const aborts = logs.filter(log => log.roomId === cancelled.roomId && log.meta.event === 'game_abort');
    ok(aborts.length === 1 && aborts[0].meta.ranked === false, 'abandonment records one unranked game_abort');
    ok(cancelled.players.every(player => !stats.getStats(player.playerId)), 'abandonment gives no win or loss');
    const completeCount = ends.length;
    runtime.handleLeft(room, room.players[1].playerId);
    runtime.emitRoomState(room);
    ok(ends.length === completeCount && !room.gameState.abandoned, 'leaving the completed result screen does not overwrite result or create abortion');
    const initialCount = stats.getLeaderboard(undefined, 'slave').reduce((sum, row) => sum + row.totalGames, 0);
    stats.recordGameEnd('invalid', { mode:'slave', resultId:'invalid', round:1, standings:first.standings.slice(0, 3) });
    stats.recordGameEnd('debug-direct', { mode:'slave', resultId:'debug-direct', round:1, standings:first.standings, debugUsed:true });
    ok(stats.getLeaderboard(undefined, 'slave').reduce((sum, row) => sum + row.totalGames, 0) === initialCount, 'incomplete and debug result payloads are rejected at stats boundary');
    ok(persistCount > 1 && states.some(item => item.event === 'slaveState'), 'normal state fanout and snapshot persistence remain active');
    const data = JSON.parse(fs.readFileSync(path.join(process.env.GAME_DATA_DIR, 'playerStats.json'), 'utf8'));
    ok(Object.values(data).every(stat => !stat.playerId.startsWith('bot_')), 'persisted stats contain no bots');

    const ledgerStandings = first.standings.map((row, index) => ({ ...row, playerId:'ledger-' + index }));
    const ledgerStart = Date.now() + 10000;
    const ledgerResult = (gameId, round, endedAt) => ({ mode:'slave', gameId, resultId:gameId + ':' + round,
        round, standings:ledgerStandings, endedAt:new Date(endedAt).toISOString() });
    for (let round = 1; round <= 32; round += 1) stats.recordGameEnd('ledger-table', ledgerResult('ledger-game-a', round, ledgerStart + round));
    ok(stats.getStats('ledger-0').gameHistory.length === 20, 'public history remains bounded after 32 rounds');
    ok(!stats.getStats('ledger-0').gameHistory.some(entry => entry.resultId === 'ledger-game-a:1'), 'oldest result really fell out of public history');
    stats.recordGameEnd('ledger-table', ledgerResult('ledger-game-a', 1, ledgerStart + 1));
    ok(stats.getStats('ledger-0').modeStats.slave.games === 32, 'high-water mark blocks evicted same-table result replay');
    stats.recordGameEnd('new-table', ledgerResult('ledger-game-b', 1, ledgerStart + 100));
    stats.recordGameEnd('old-table', ledgerResult('ledger-game-a', 1, ledgerStart + 1));
    ok(stats.getStats('ledger-0').modeStats.slave.games === 33, 'newer completed table blocks older-table result replay');
    stats.recordGameEnd('same-time-table', ledgerResult('ledger-game-c', 1, ledgerStart + 100));
    ok(stats.getStats('ledger-0').modeStats.slave.games === 34, 'distinct game result with equal timestamp is valid');
    const markerBeforeAdminEdit = structuredClone(stats.getStats('ledger-0').slaveLatestResult);
    await stats.editPlayerStats('ledger-0', { slaveLatestResult:null });
    ok(JSON.stringify(stats.getStats('ledger-0').slaveLatestResult) === JSON.stringify(markerBeforeAdminEdit), 'ordinary admin stat edits cannot overwrite internal replay protection');
    await stats.saveStats();
    delete require.cache[statsPath];
    stats = require('../managers/statsManager');
    stats.recordGameEnd('old-table', ledgerResult('ledger-game-a', 1, ledgerStart + 1));
    ok(stats.getStats('ledger-0').modeStats.slave.games === 34, 'high-water guard survives JSON restart with evicted history');
    console.log(JSON.stringify({ ok:true, checks, rounds:4, humans:4, logs:logs.length, isolatedData:true }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
    for (const room of rooms.values()) runtime.clearTimers(room.roomId);
});
