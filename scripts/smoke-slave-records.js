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
    ok(['round-end','finished'].includes(room.gameState.phase), 'round completes with four standings');
}
function counters(room) { return room.players.map(player => stats.getStats(player.playerId)); }
async function main() {
    ok(stats.GAME_MODES.includes('slave'), 'Slave is a normalized supported game mode');
    const room = createRoom('human');
    ok(room.gameState.gameId && room.gameState.startedAt && room.gameState.roundStartedAt, 'server creates game identity and round start timestamps');
    finishRound(room);
    ok(ends.length === 0 && counters(room).every(stat => !stat || stat.totalGames === 0), 'first round does not record a game or result notification');
    const firstRound = structuredClone(room.gameState);
    runtime.recover(room); runtime.emitRoomState(room); runtime.clearTimers(room.roomId);
    ok(ends.length === 0, 'resync between rounds still does not record a partial match');
    engine.nextRound(room, room.admin); runtime.emitRoomState(room);
    ok(room.gameState.phase === 'exchange', 'second round exchanges according to round-one placements');
    finishRound(room);
    const first = structuredClone(room.gameState);
    const firstIds = first.matchStandings.map(row => row.playerId);
    ok(first.matchComplete && first.round === 2 && first.phase === 'finished', 'second round finishes the game');
    ok(ends.length === 1 && ends[0].options.chat === false, 'one completed-match admin summary, without chat spam');
    ok(ends[0].meta.ranked && ends[0].meta.standings.length === 4, 'human match result is ranked with all four places');
    first.matchStandings.forEach(row => {
        const stat = stats.getStats(row.playerId), history = stat.gameHistory[0];
        ok(stat.totalGames === 1 && stat.modeStats.slave.games === 1, 'both rounds count as exactly one game');
        ok(stat.modeStats.slave.wins === (row.place === 1 ? 1 : 0), 'highest total score wins, including ties');
        ok(history.totalRounds === 2 && history.score === row.score && history.roundScores.length === 2, 'history preserves both round scores and total');
        ok(history.resultId === first.gameId + ':2' && history.startedAt && history.endedAt, 'stable match identity and timestamps');
        ok(!Object.hasOwn(history,'hand') && !Object.hasOwn(history,'cards'), 'no private cards in history');
    });
    for (let n=0; n<3; n++) { runtime.emitRoomState(room); runtime.recover(room); }
    runtime.clearTimers(room.roomId);
    ok(ends.length === 1 && counters(room).every(stat => stat.totalGames === 1), 'resync and recovery cannot duplicate match results');
    ok(logs.some(item => item.meta.kind === 'play') && logs.every(item => !Object.hasOwn(item.meta || {},'hands')), 'public action audit remains private-card free');
    await stats.saveStats();
    const statsPath = require.resolve('../managers/statsManager');
    delete require.cache[statsPath]; stats = require('../managers/statsManager');
    ok(stats.getStats(firstIds[0]).modeStats.slave.games === 1, 'one-game total survives JSON reload');
    const oldSnapshot = structuredClone(room); delete oldSnapshot.gameState.statsRecordedGameId;
    runtime.finalizeRoundIfNeeded(oldSnapshot);
    ok(counters(room).every(stat => stat.totalGames === 1), 'stale room snapshot cannot record an already persisted match');
    ok(stats.getLeaderboard(undefined,'slave').length === 4, 'ranked match appears in Slave leaderboard');
    const bots = createRoom('bots','bots',true);
    finishRound(bots); engine.nextRound(bots,bots.admin); finishRound(bots);
    ok(bots.players.filter(p => !engine.isBotId(p.playerId)).every(p => stats.getStats(p.playerId)?.totalGames === 0 && stats.getStats(p.playerId).gameHistory.length === 1 && stats.getStats(p.playerId).gameHistory[0].ranked === false), 'two bot rounds save one unranked human history entry');
    ok(!stats.getLeaderboard(undefined,'slave').some(row => row.playerId.startsWith('bots-')), 'bot games never enter leaderboard');
    const debug = createRoom('debug'); debug.gameState.debugUsed = true;
    finishRound(debug); engine.nextRound(debug,debug.admin); finishRound(debug);
    ok(debug.players.every(p => !stats.getStats(p.playerId)), 'debug match adds no statistics');
    const cancelled = createRoom('cancelled'); finishRound(cancelled);
    runtime.handleLeft(cancelled,cancelled.players[1].playerId); runtime.emitRoomState(cancelled); runtime.recover(cancelled);
    ok(logs.filter(log => log.roomId === cancelled.roomId && log.meta.event === 'game_abort').length === 1, 'leaving between rounds aborts one incomplete match');
    ok(cancelled.players.every(p => !stats.getStats(p.playerId)), 'incomplete match gives no win/loss/history');
    const savedDeadline = room.gameState.returnLobbyAt;
    runtime.handleLeft(room,room.players[1].playerId);
    ok(!room.gameState.abandoned && room.gameState.returnLobbyAt === savedDeadline, 'leaving after completion does not cancel everyone else return');
    // Ties are genuine shared wins, without a hidden round-two tie-breaker.
    const tie = createRoom('tie');
    const ranking = ids => ids.map((playerId,index) => ({playerId,name:playerId,place:index+1,title:['คิง','ควีน','รองสลาฟ','สลาฟ'][index]}));
    const ids = tie.players.map(p => p.playerId);
    Object.assign(tie.gameState,{round:2,phase:'finished',status:'slave_finished',matchComplete:true,roundEndedAt:new Date().toISOString(),roundResults:[{round:1,standings:ranking(ids)},{round:2,standings:ranking([ids[1],ids[0],ids[2],ids[3]])}]});
    tie.gameState.matchStandings = engine.scoreRounds(tie.gameState); runtime.emitRoomState(tie);
    ok(ids.slice(0,2).every(id => stats.getStats(id).wins === 1) && stats.getStats(ids[2]).losses === 1, 'equal highest totals share the win');
    const nonLastKing = {...tie.gameState,roundResults:[{round:1,standings:ranking(ids)},{round:2,standings:ranking([ids[3],ids[0],ids[1],ids[2]])}]};
    ok(engine.scoreRounds(nonLastKing)[0].playerId === ids[0], 'winner is the total-score leader even when somebody else wins round two');
    const forged = {mode:'slave',matchFormat:'two-rounds',gameId:'forged',resultId:'forged:2',round:2,endedAt:new Date().toISOString(),roundResults:first.roundResults,standings:first.matchStandings.map(row=>({...row,score:row.score+1}))};
    ok(stats.recordGameEnd('forged',forged) === false, 'stats rejects a forged aggregate score');
    forged.roundResults = [{round:1,standings:[null,null,null,null]},{round:2,standings:first.standings}];
    ok(stats.recordGameEnd('forged',forged) === false, 'malformed round standings are rejected without throwing');
    const automatic = createRoom('automatic'); finishRound(automatic);
    automatic.gameState.roundAdvanceAt = Date.now()-1; runtime.emitRoomState(automatic);
    await new Promise(resolve => setTimeout(resolve,50)); runtime.clearTimers(automatic.roomId);
    ok(automatic.gameState.round === 2 && automatic.gameState.phase === 'exchange', 'server automatically advances into second-round exchange');
    finishRound(automatic); automatic.gameState.returnLobbyAt = Date.now()-1; runtime.recover(automatic);
    await new Promise(resolve => setTimeout(resolve,50));
    ok(automatic.gameState.phase === 'lobby' && states.some(row => row.event === 'redirectToLobby' && row.id === automatic.roomId), 'server resets game and returns the whole room to the lobby');
    ok(automatic.players.length === 4, 'automatic lobby return retains all four room members');
    const legacy = createRoom('legacy');
    finishRound(legacy);
    delete legacy.gameState.maxRounds; delete legacy.gameState.matchComplete;
    legacy.gameState.statsRecordedRound = 1;
    const summariesBeforeLegacy = ends.length;
    runtime.recover(legacy); runtime.clearTimers(legacy.roomId);
    ok(legacy.gameState.matchComplete && legacy.gameState.legacyRound && ends.length === summariesBeforeLegacy, 'legacy completed snapshots return safely without recounting recorded rounds');
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
    console.log(JSON.stringify({ ok:true, checks, rounds:10, humans:4, logs:logs.length, isolatedData:true }));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
    for (const room of rooms.values()) runtime.clearTimers(room.roomId);
});
