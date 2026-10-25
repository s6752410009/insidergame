const { randomUUID } = require('node:crypto');
const engine = require('./slaveEngine');
const MODE = 'slave';
module.exports = getDeps => {
    const timers = new Map(), botAddInFlight = new Set();
    function clearTimers(id) {
        const timer = timers.get(id);
        if (timer) { clearTimeout(timer.bot); clearTimeout(timer.phase); }
        timers.delete(id);
    }
    function schedule(room) {
        const s = room.gameState;
        if (timers.get(room.roomId)?.step === s.step) return;
        clearTimers(room.roomId);
        if (s.status !== 'playing') return;
        const live = () => getDeps().roomManager.getRoom(room.roomId);
        const timer = { step:s.step };
        if (engine.botNeedsTurn(room)) timer.bot = setTimeout(() => {
            const current = live();
            if (!current || current.settings.gameMode !== MODE) return;
            try { if (engine.playBotTurns(current)) emitRoomState(current); }
            catch (error) { getDeps().reportGameError(current, '[slave] bot', error); }
        }, Number(process.env.SLAVE_BOT_MS) || 900);
        if (s.phaseEndsAt) timer.phase = setTimeout(() => {
            const current = live();
            if (!current || current.settings.gameMode !== MODE) return;
            try { engine.autoResolvePhase(current); emitRoomState(current); }
            catch (error) { getDeps().reportGameError(current, '[slave] timeout', error); }
        }, Math.max(20, s.phaseEndsAt - Date.now() + 10));
        timers.set(room.roomId, timer);
    }
    function resultId(s) {
        // Legacy room snapshots may predate game IDs. Persist one before finalizing their next result.
        if (!s.gameId) s.gameId = randomUUID();
        return `${s.gameId}:${s.round}`;
    }
    function isRanked(s) {
        return !s.debugUsed && !s.abandoned && !s.seats.some(player => engine.isBotId(player.playerId));
    }
    function flushHistoryToLogs(room) {
        const s = room.gameState;
        const { io, addServerLog } = getDeps();
        if (typeof addServerLog !== 'function') return;
        const fresh = (s.auditHistory || []).filter(item => item.seq > (s.lastLoggedAuditSequence || 0));
        fresh.forEach(item => {
            if (!['round-end', 'left'].includes(item.kind)) {
                addServerLog(io, 'game', room.roomId, `🃏 สลาฟ · ${item.text}`, 'info', {
                    gameMode:MODE,
                    meta:{ event:'slave_history', kind:item.kind, gameId:s.gameId, round:item.round, actionAt:item.at,
                        playerId:item.playerId, bot:!!item.playerId && engine.isBotId(item.playerId), debugUsed:!!s.debugUsed }
                });
            }
            s.lastLoggedAuditSequence = item.seq;
        });
    }
    function finalizeRoundIfNeeded(room) {
        const s = room.gameState;
        if (!Array.isArray(s.standings) || s.standings.length !== 4 || s.statsRecordedRound === s.round) return;
        // A completed result remains valid when somebody leaves the result screen afterward.
        if (!['round-end', 'finished'].includes(s.phase) || s.abandoned) return;
        if (!s.roundEndedAt || !Number.isFinite(new Date(s.roundEndedAt).getTime())) s.roundEndedAt = new Date().toISOString();
        const id = resultId(s);
        const { statsManager, notifyGameEndAfterRecord } = getDeps();
        if (isRanked(s) && statsManager) statsManager.recordGameEnd(room.roomId, {
            mode:MODE, resultId:id, gameId:s.gameId, round:s.round, roomName:room.name,
            startedAt:s.roundStartedAt, endedAt:s.roundEndedAt, debugUsed:!!s.debugUsed,
            standings:s.standings.map(row => ({ playerId:row.playerId, name:row.name, place:row.place, title:row.title }))
        });
        // Persisted per round, not a single game flag: the table can keep playing after exchanging cards.
        s.statsRecordedRound = s.round;
        s.statsRecordedAt = new Date().toISOString();
        if (typeof notifyGameEndAfterRecord === 'function') notifyGameEndAfterRecord(room, { chat:false });
    }
    function recordAbandonmentIfNeeded(room) {
        const s = room.gameState;
        if (!s.abandoned || s.abortRecordedAt) return;
        const { io, addServerLog } = getDeps();
        if (typeof addServerLog !== 'function') return;
        resultId(s);
        addServerLog(io, 'game', room.roomId, `🃏 สลาฟ ยกเลิกรอบ ${s.round} — ${s.abandoned.name || 'ผู้เล่น'} ออกจากโต๊ะ · ไม่นับสถิติ`, 'warning', {
            gameMode:MODE,
            meta:{ event:'game_abort', gameId:s.gameId, round:s.round, reason:s.abandoned.reason,
                playerId:s.abandoned.playerId, endedAt:s.abandoned.at, debugUsed:!!s.debugUsed, ranked:false, playerCount:s.seats.length }
        });
        s.abortRecordedAt = new Date().toISOString();
    }
    function emitState(room, targetSocketId = null, playerId = null) {
        const { io } = getDeps();
        if (targetSocketId && playerId) io.to(targetSocketId).emit('slaveState', engine.buildClientState(room, playerId));
        else room.players.filter(player => player.socketId && !engine.isBotId(player.playerId))
            .forEach(player => io.to(player.socketId).emit('slaveState', engine.buildClientState(room, player.playerId)));
        schedule(room);
    }
    function emitRoomState(room) {
        flushHistoryToLogs(room);
        finalizeRoundIfNeeded(room);
        recordAbandonmentIfNeeded(room);
        emitState(room);
        const { io, roomManager, buildRoomUpdatePayload } = getDeps();
        roomManager.schedulePersistRooms();
        io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
    }
    function recover(room) {
        if (room.gameState.status === 'playing') {
            if (room.gameState.phase === 'round-end' || engine.autoResolvePhase(room)) emitRoomState(room);
            else schedule(room);
        } else if (room.gameState.abandoned) emitRoomState(room);
    }
    function gameEndNotification(room) {
        const s = room.gameState;
        const standings = s.standings || [];
        const winnerName = standings[0]?.name || 'ไม่ทราบ';
        const result = standings.map(row => `${row.place}. ${row.name} (${row.title})`).join(' · ');
        return {
            chatMessage:`จบรอบ ${s.round}! ${winnerName} เป็นคิง`, chatColor:'#f5c86b',
            logMessage:`🃏 สลาฟ จบรอบ ${s.round} — ${result}${!isRanked(s) ? ' · ไม่นับสถิติ (บอท/ทดสอบ)' : ''}`,
            logType:'success',
            meta:{ gameId:s.gameId, resultId:resultId(s), round:s.round, playerCount:standings.length, winnerName,
                ranked:isRanked(s), debugUsed:!!s.debugUsed, startedAt:s.roundStartedAt || null, endedAt:s.roundEndedAt || null,
                standings:standings.map(row => ({ name:String(row.name || '').slice(0, 32), place:row.place, title:row.title })) }
        };
    }
    return { engine, botAddInFlight, clearTimers, emitState, emitRoomState, recover, scheduleBots:schedule,
        flushHistoryToLogs, finalizeRoundIfNeeded, gameEndNotification,
        startGame:room => { clearTimers(room.roomId); engine.startGame(room); },
        buildPayload:engine.buildClientState,
        handleLeft:(room, id) => engine.handlePlayerLeft(room, id),
        forceResolve:room => { room.gameState.phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(room); emitRoomState(room); }
    };
};
