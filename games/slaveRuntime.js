const { randomUUID } = require('node:crypto');
const engine = require('./slaveEngine');
const MODE = 'slave';
module.exports = getDeps => {
    const timers = new Map(), botAddInFlight = new Set();
    function clearTimers(id) {
        const timer = timers.get(id);
        if (timer) { clearTimeout(timer.bot); clearTimeout(timer.phase); clearTimeout(timer.transition); }
        timers.delete(id);
    }
    function schedule(room) {
        const s = room.gameState;
        const key = `${s.step}:${s.phase}:${s.roundAdvanceAt || s.nextMatchAt || s.returnLobbyAt || ''}`;
        if (timers.get(room.roomId)?.key === key) return;
        clearTimers(room.roomId);
        if (s.status !== 'playing' && !s.returnLobbyAt && !s.nextMatchAt) return;
        const live = () => getDeps().roomManager.getRoom(room.roomId);
        const timer = { key };
        const transitionAt = s.roundAdvanceAt || s.nextMatchAt || s.returnLobbyAt;
        if (transitionAt) timer.transition = setTimeout(() => {
            const current = live();
            if (!current || current.settings.gameMode !== MODE || current.gameState.gameId !== s.gameId) return;
            try {
                if (current.gameState.phase === 'round-end') { engine.nextRound(current, current.admin); emitRoomState(current); }
                else if (current.gameState.matchComplete) returnToLobby(current);
            } catch (error) { getDeps().reportGameError(current, '[slave] round transition', error); }
        }, Math.max(20, transitionAt-Date.now()));
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
        const continuous = !!s.continuous;
        const standings = continuous ? s.standings : s.matchStandings;
        if (!Array.isArray(standings) || standings.length !== 4
            || (continuous ? s.phase !== 'round-end' || s.statsRecordedRound >= s.round : !s.matchComplete || s.statsRecordedGameId === s.gameId)) return;
        // A completed result remains valid when somebody leaves the result screen afterward.
        if (!['round-end', 'finished'].includes(s.phase) || s.abandoned) return;
        if (!s.roundEndedAt || !Number.isFinite(new Date(s.roundEndedAt).getTime())) s.roundEndedAt = new Date().toISOString();
        const id = resultId(s);
        const { statsManager, notifyGameEndAfterRecord } = getDeps();
        let recorded = false;
        if (!s.debugUsed && statsManager) recorded = statsManager.recordGameEnd(room.roomId, {
            mode:MODE, resultId:id, gameId:s.gameId, round:s.round, roomName:room.name,
            startedAt:continuous ? s.roundStartedAt : s.startedAt, endedAt:continuous ? s.roundEndedAt : s.matchEndedAt || s.roundEndedAt, debugUsed:!!s.debugUsed,
            matchFormat:continuous ? 'continuous-round' : s.legacyRound ? 'legacy-round' : 'two-rounds', roundResults:s.roundResults,
            standings:standings.map(row => ({ ...row }))
        });
        // Persist the round/session checkpoint before resync or recovery can replay the result.
        s.statsRecordedGameId = s.gameId;
        s.statsRecordedRound = s.round;
        s.statsRecordedAt = new Date().toISOString();
        if ((!continuous || recorded) && typeof notifyGameEndAfterRecord === 'function') notifyGameEndAfterRecord(room, { chat:false });
    }
    function recordAbandonmentIfNeeded(room) {
        const s = room.gameState;
        if (!s.abandoned || s.abortRecordedAt) return;
        const { io, addServerLog } = getDeps();
        if (typeof addServerLog !== 'function') return;
        resultId(s);
        addServerLog(io, 'game', room.roomId, `🃏 สลาฟ ยกเลิกรอบ ${s.round} — ${s.abandoned.name || 'ผู้เล่น'} ออกจากเกม · ไม่นับสถิติ`, 'warning', {
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
        const s = room.gameState;
        // Convert previously shipped two-round looping snapshots without replaying their results.
        if (s.continuous && s.continuousVersion !== 2) {
            // An old finished match may have persisted stats before its room checkpoint.
            // Reconcile with its original two-round ID before changing the round number.
            if (s.matchComplete && s.statsRecordedGameId !== s.gameId) {
                s.continuous = false;
                try { finalizeRoundIfNeeded(room); } finally { s.continuous = true; }
            }
            const alreadyRecorded = s.matchComplete && s.statsRecordedGameId === s.gameId;
            s.round = ((s.gameNumber || 1)-1)*2+s.round;
            s.continuousVersion = 2; s.gameNumber = 1; s.maxRounds = null;
            if (alreadyRecorded) s.statsRecordedRound = s.round;
            if (s.matchComplete && s.standings?.length === 4) {
                s.phase='round-end'; s.status='playing';
                s.roundAdvanceAt=Date.now()+(Number(process.env.SLAVE_ROUND_BREAK_MS)||6500);
            }
            s.matchComplete=false; s.matchStandings=null; s.matchEndedAt=null; s.nextMatchAt=null; s.returnLobbyAt=null;
            s.roundResults=[];
        }
        // Tables saved by the old endless-round format finish their current round.
        // Previously recorded results remain untouched; the next lobby start uses two rounds.
        if (!s.continuous && !Number.isInteger(s.maxRounds) && s.seats?.length) {
            s.legacyRound = true;
            s.maxRounds = Math.max(1, Number(s.round) || 1);
            if (s.phase === 'round-end' && s.standings?.length === 4) {
                resultId(s);
                s.roundResults = [{round:s.round,startedAt:s.roundStartedAt,endedAt:s.roundEndedAt,standings:s.standings.map(row => ({...row}))}];
                s.matchStandings = engine.scoreRounds(s);
                s.matchComplete = true; s.phase = 'finished'; s.status = 'slave_finished';
                s.roundAdvanceAt = null; s.returnLobbyAt = Date.now() + (Number(process.env.SLAVE_RESULT_MS) || 10000);
                if (s.statsRecordedRound === s.round) s.statsRecordedGameId = s.gameId;
            }
        }
        if (room.gameState.status === 'playing') {
            if (room.gameState.phase === 'round-end' || engine.autoResolvePhase(room)) emitRoomState(room);
            else schedule(room);
        } else if (room.gameState.abandoned || room.gameState.matchComplete) emitRoomState(room);
    }
    function returnToLobby(room) {
        if (!room.gameState.matchComplete) return;
        finalizeRoundIfNeeded(room);
        clearTimers(room.roomId);
        const { io, roomManager, buildRoomUpdatePayload } = getDeps();
        if (typeof roomManager.resetRoomGame === 'function') roomManager.resetRoomGame(room.roomId);
        else room.gameState = engine.resetRoomGame(room);
        roomManager.schedulePersistRooms();
        io.to(room.roomId).emit('redirectToLobby', { roomId:room.roomId });
        io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
    }
    function gameEndNotification(room) {
        const s = room.gameState;
        const standings = s.matchStandings || s.standings || [];
        const winnerName = standings.filter(row => row.place === 1).map(row => row.name).join(', ') || 'ไม่ทราบ';
        const result = standings.map(row => `${row.place}. ${row.name} (${s.continuous ? row.title : (row.score ?? 0) + ' คะแนน'})`).join(' · ');
        const format = s.continuous || s.legacyRound ? 'รอบ ' + s.round : 'เกม 2 รอบ';
        return {
            chatMessage:`จบ${format}! ${winnerName} ชนะ`, chatColor:'#f5c86b',
            logMessage:`🃏 สลาฟ ${s.continuous ? format : 'จบ'+format} — ${result}${!isRanked(s) ? ' · ไม่นับอันดับ (บอท/ทดสอบ)' : ''}`,
            logType:'success',
            meta:{ ...(s.continuous ? {event:'round_end'} : {}), gameId:s.gameId, resultId:resultId(s), round:s.round, playerCount:standings.length, winnerName,
                ranked:isRanked(s), debugUsed:!!s.debugUsed, startedAt:(s.continuous ? s.roundStartedAt : s.startedAt) || null, endedAt:s.roundEndedAt || null,
                standings:standings.map(row => ({ name:String(row.name || '').slice(0, 32), place:row.place, title:row.title, score:row.score, roundScores:row.roundScores })) }
        };
    }
    return { engine, botAddInFlight, clearTimers, emitState, emitRoomState, recover, scheduleBots:schedule,
        flushHistoryToLogs, finalizeRoundIfNeeded, gameEndNotification, returnToLobby,
        startGame:room => { clearTimers(room.roomId); engine.startGame(room); },
        buildPayload:engine.buildClientState,
        handleLeft:(room, id) => engine.handlePlayerLeft(room, id),
        forceResolve:room => { room.gameState.phaseEndsAt = Date.now() - 1; engine.autoResolvePhase(room); emitRoomState(room); }
    };
};
