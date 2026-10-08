/**
 * ไพ่ทิ้งสี — ส่วนฝั่งเซิร์ฟเวอร์ที่ผูกกับ socket/timer (แยกจาก app.js ให้ merge ง่าย)
 * engine ล้วนอยู่ที่ games/colorcardsEngine.js — ไฟล์นี้แค่ตั้งเวลา ยิง state ทีละ socket และบันทึกสถิติ
 *
 * ใช้: const colorcards = require('./games/colorcardsRuntime')(() => ({ io, roomManager, ... }))
 */

const engine = require('./colorcardsEngine');

const MODE = 'colorcards';
const STATE_EVENT = 'colorcardsState';

module.exports = function createColorCardsRuntime(getDeps) {
    const phaseTimeouts = new Map();
    const botTimeouts = new Map();
    const botAddInFlight = new Set();
    const deps = () => getDeps();

    function isRoom(room) {
        return !!(room && room.settings && room.settings.gameMode === MODE);
    }

    function clearPhaseTimer(roomId) {
        const timer = phaseTimeouts.get(roomId);
        if (timer) {
            clearTimeout(timer.timeoutId);
            phaseTimeouts.delete(roomId);
        }
    }

    function clearBotTimer(roomId) {
        const timer = botTimeouts.get(roomId);
        if (timer) {
            clearTimeout(timer.timeoutId);
            botTimeouts.delete(roomId);
        }
    }

    // ห้องปิด/จบ — ล้างทุก timer
    function clearTimers(roomId) {
        clearPhaseTimer(roomId);
        clearBotTimer(roomId);
    }

    function currentRoom(roomId) {
        const room = deps().roomManager.getRoom(roomId);
        return isRoom(room) ? room : null;
    }

    function syncPhaseTimer(room) {
        if (!isRoom(room)) return;
        const state = room.gameState;
        if (!state || state.status !== 'playing' || !state.phaseEndsAt) {
            clearPhaseTimer(room.roomId);
            return;
        }
        const existing = phaseTimeouts.get(room.roomId);
        if (existing && existing.endsAt === state.phaseEndsAt) return;
        clearPhaseTimer(room.roomId);
        const delay = Math.max(120, state.phaseEndsAt - Date.now());
        const timeoutId = setTimeout(() => {
            phaseTimeouts.delete(room.roomId);
            const live = currentRoom(room.roomId);
            if (!live) return;
            try {
                engine.autoResolvePhase(live);
                emitRoomState(live);
            } catch (error) {
                if (typeof deps().reportGameError === 'function') deps().reportGameError(room, '[colorcards] auto resolve failed', error);
                console.error('[colorcards] auto resolve failed:', error.message);
            }
        }, delay);
        phaseTimeouts.set(room.roomId, { timeoutId, endsAt: state.phaseEndsAt });
    }

    function scheduleBots(room) {
        if (!isRoom(room)) return;
        if (!engine.botNeedsTurn(room)) {
            clearBotTimer(room.roomId);
            return;
        }
        const delay = engine.botDelay(room);
        if (delay === null) return;
        const dueAt = Date.now() + delay;
        const existing = botTimeouts.get(room.roomId);
        if (existing && existing.step === room.gameState.step && Math.abs(existing.dueAt - dueAt) < 40) return;
        clearBotTimer(room.roomId);
        const timeoutId = setTimeout(() => {
            botTimeouts.delete(room.roomId);
            const live = currentRoom(room.roomId);
            if (!live) return;
            try {
                if (engine.playBotTurns(live)) emitRoomState(live);
                else scheduleBots(live);
            } catch (error) {
                if (typeof deps().reportGameError === 'function') deps().reportGameError(room, '[colorcards] bots failed', error);
                console.error('[colorcards] bots failed:', error.message);
            }
        }, delay + 20);
        botTimeouts.set(room.roomId, { timeoutId, dueAt, step: room.gameState.step });
    }

    function buildPayload(room, playerId) {
        if (!isRoom(room)) return null;
        return engine.buildClientState(room, playerId);
    }

    // ไพ่ในมือส่งทีละ socket เท่านั้น — ห้าม io.to(roomId) กับ state นี้
    function emitState(room, targetSocketId = null, playerId = null) {
        if (!isRoom(room)) return;
        const { io } = deps();
        syncPhaseTimer(room);
        if (targetSocketId && playerId) {
            io.to(targetSocketId).emit(STATE_EVENT, buildPayload(room, playerId));
            return;
        }
        (room.players || []).forEach(player => {
            if (player.socketId && !engine.isBotId(player.playerId)) {
                io.to(player.socketId).emit(STATE_EVENT, buildPayload(room, player.playerId));
            }
        });
    }

    function flushHistoryToLogs(room) {
        const history = room.gameState?.history;
        if (!Array.isArray(history) || !history.length) return;
        const { io, addServerLog } = deps();
        const lastAt = Number(room.gameState.lastLoggedHistoryAt) || 0;
        const fresh = history
            .filter(item => item && item.at && new Date(item.at).getTime() > lastAt)
            .sort((left, right) => new Date(left.at) - new Date(right.at));
        fresh.forEach(item => {
            if (!['round-win', 'finished', 'caught', 'left'].includes(item.kind)) return;
            addServerLog(io, 'game', room.roomId, `🃏 ${item.icon || ''} ${item.text || ''}`.replace(/\s+/g, ' ').trim(),
                item.kind === 'left' ? 'warning' : 'info',
                { gameMode: MODE, meta: { kind: item.kind || null, event: 'colorcards_history' } });
        });
        if (fresh.length) {
            room.gameState.lastLoggedHistoryAt = new Date(fresh[fresh.length - 1].at).getTime();
        }
    }

    function finalizeIfNeeded(room) {
        const state = room?.gameState;
        if (!state || state.phase !== 'finished' || state.statsRecordedAt) return;
        const { statsManager, notifyGameEndAfterRecord, scheduleFinishedGameReturnToLobby } = deps();
        state.statsRecordedAt = new Date().toISOString();
        // จบแบบไม่มีผู้ชนะ (หัวห้องสั่งจบตอนยังไม่มีใครนำ) = ไม่นับสถิติ
        if (state.winner && state.winner.playerId) {
            statsManager.recordGameEnd(room.roomId, {
                mode: MODE,
                winner: state.winner,
                standings: state.standings || [],
                roomName: room.name,
                rounds: state.round,
                target: state.config ? state.config.target : 0
            });
        }
        clearTimers(room.roomId);
        notifyGameEndAfterRecord(room);
        scheduleFinishedGameReturnToLobby(room);
    }

    function emitRoomState(room) {
        if (!isRoom(room)) return;
        const { io, buildRoomUpdatePayload } = deps();
        flushHistoryToLogs(room);
        finalizeIfNeeded(room);
        emitState(room);
        scheduleBots(room);
        io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
    }

    // หลังรีสตาร์ต: ตาที่เลยเวลาแล้ว resolve ทันที ที่เหลือตั้งนาฬิกา/บอทใหม่
    function recover(room) {
        if (!isRoom(room) || room.gameState?.status !== 'playing') return;
        if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()) {
            engine.autoResolvePhase(room);
            emitRoomState(room);
            return;
        }
        syncPhaseTimer(room);
        scheduleBots(room);
    }

    function forceResolve(room) {
        if (!isRoom(room) || room.gameState?.status !== 'playing') return;
        room.gameState.phaseEndsAt = Date.now() - 1;
        engine.autoResolvePhase(room);
        emitRoomState(room);
    }

    function handleLeft(room, playerId) {
        if (!isRoom(room)) return;
        engine.handlePlayerLeft(room, playerId);
    }

    function startGame(room) {
        clearTimers(room.roomId);
        engine.startGame(room);
    }

    function gameEndNotification(room) {
        const state = room.gameState || {};
        const winner = state.winner;
        const playerCount = (state.seats || []).length;
        const rounds = state.round || 1;
        const text = winner
            ? `${winner.name} ชนะ${state.config && state.config.target ? ` (${winner.score} แต้ม)` : ''}`
            : 'ไม่มีผู้ชนะ';
        return {
            chatMessage: `จบไพ่ทิ้งสี! ${text}`,
            chatColor: '#f5c86b',
            logMessage: `🃏 ไพ่ทิ้งสี จบ — ${text} · ${rounds} รอบ · ${playerCount} คน`,
            logType: 'success',
            meta: { winnerName: winner ? winner.name : null, score: winner ? winner.score : 0, playerCount, rounds }
        };
    }

    function adminRevealPayload(room) {
        const state = room.gameState || {};
        return {
            round: state.round,
            phase: state.phase,
            currentColor: state.currentColor,
            drawCount: (state.drawPile || []).length,
            players: (state.seats || []).map(seat => ({
                playerId: seat.playerId,
                name: seat.name,
                left: !!seat.left,
                score: seat.score,
                cards: (seat.hand || []).map(engine.describeCard).map(card => card.label)
            }))
        };
    }

    return {
        MODE,
        STATE_EVENT,
        engine,
        botAddInFlight,
        isRoom,
        clearTimers,
        syncPhaseTimer,
        scheduleBots,
        buildPayload,
        emitState,
        emitRoomState,
        finalizeIfNeeded,
        recover,
        forceResolve,
        handleLeft,
        startGame,
        gameEndNotification,
        adminRevealPayload
    };
};
