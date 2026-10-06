/**
 * เศรษฐี — ส่วนฝั่งเซิร์ฟเวอร์ที่ผูกกับ socket/timer (แยกจาก app.js ให้ merge ง่าย)
 * engine ล้วนอยู่ที่ games/setthiEngine.js — ไฟล์นี้แค่ตั้งเวลา ยิง state ทีละ socket บันทึกสถิติ และกู้เกมหลังรีสตาร์ต
 *
 * ใช้: const setthi = require('./games/setthiRuntime')(() => ({ io, roomManager, ... }))
 */

const engine = require('./setthiEngine');

const MODE = 'setthi';
const STATE_EVENT = 'setthiState';
const WATCHDOG_MS = 2000;

module.exports = function createSetthiRuntime(getDeps) {
    const phaseTimeouts = new Map();
    const botTimeouts = new Map();
    const watchdogs = new Map();
    const botAddInFlight = new Set();
    const deps = () => getDeps();

    function isRoom(room) {
        return !!(room && room.settings && room.settings.gameMode === MODE);
    }

    function isLive(room) {
        return isRoom(room) && room.gameState && room.gameState.status === 'playing' && room.gameState.phase !== 'finished';
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

    function clearWatchdog(roomId) {
        const id = watchdogs.get(roomId);
        if (id) {
            clearInterval(id);
            watchdogs.delete(roomId);
        }
    }

    function clearTimers(roomId) {
        clearPhaseTimer(roomId);
        clearBotTimer(roomId);
        clearWatchdog(roomId);
    }

    function currentRoom(roomId) {
        const room = deps().roomManager.getRoom(roomId);
        return isRoom(room) ? room : null;
    }

    /** ปลุก engine ตามเวลาที่ใกล้สุด (หมดเวลาตา/ประมูล/ดีล/นาฬิกาเกม) */
    function syncPhaseTimer(room) {
        if (!isLive(room)) {
            clearPhaseTimer(room.roomId);
            return;
        }
        const due = engine.nextDeadline(room);
        if (!due) {
            clearPhaseTimer(room.roomId);
            return;
        }
        const existing = phaseTimeouts.get(room.roomId);
        if (existing && existing.due === due) return;
        clearPhaseTimer(room.roomId);
        const timeoutId = setTimeout(() => {
            phaseTimeouts.delete(room.roomId);
            runTick(room.roomId);
        }, Math.max(60, due - Date.now() + 15));
        phaseTimeouts.set(room.roomId, { timeoutId, due });
    }

    function runTick(roomId) {
        const live = currentRoom(roomId);
        if (!live || !isLive(live)) return;
        try {
            if (engine.tick(live)) emitRoomState(live);
            else syncPhaseTimer(live);
        } catch (error) {
            console.error('[setthi] tick failed:', error.message);
        }
    }

    // คนที่ต้องตัดสินใจหลุดกลางตา → deadline สั้นลง ต้องมีคนคอยเช็ก (ไม่มี event ตอน socket หลุด)
    function ensureWatchdog(room) {
        if (!isLive(room)) {
            clearWatchdog(room.roomId);
            return;
        }
        if (watchdogs.has(room.roomId)) return;
        const roomId = room.roomId;
        const id = setInterval(() => {
            const live = currentRoom(roomId);
            if (!live || !isLive(live)) {
                clearWatchdog(roomId);
                return;
            }
            const due = engine.nextDeadline(live);
            if (due && due <= Date.now()) runTick(roomId);
            else syncPhaseTimer(live);
        }, WATCHDOG_MS);
        if (typeof id.unref === 'function') id.unref();
        watchdogs.set(roomId, id);
    }

    function scheduleBots(room) {
        if (!isLive(room) || !engine.botNeedsTurn(room)) {
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
            if (!live || !isLive(live)) return;
            try {
                if (engine.playBotTurns(live)) emitRoomState(live);
                else scheduleBots(live);
            } catch (error) {
                console.error('[setthi] bots failed:', error.message);
                // บอทพัง (ไม่ควรเกิด) — ปล่อยให้ autopilot ตามเวลาพาเกมเดินต่อ
                syncPhaseTimer(live);
            }
        }, delay + 20);
        botTimeouts.set(room.roomId, { timeoutId, dueAt, step: room.gameState.step });
    }

    function buildPayload(room, playerId) {
        if (!isRoom(room)) return null;
        return engine.buildClientState(room, playerId);
    }

    function boardDef() {
        return engine.board.publicBoard();
    }

    // state ส่งทีละ socket (ดีลเทรดเห็นเฉพาะคู่ดีล · แต่ละคนได้ปุ่มของตัวเอง)
    function emitState(room, targetSocketId = null, playerId = null) {
        if (!isRoom(room)) return;
        const { io } = deps();
        syncPhaseTimer(room);
        ensureWatchdog(room);
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
            if (!['bankrupt', 'finished', 'left', 'trade', 'timeup'].includes(item.kind)) return;
            addServerLog(io, 'game', room.roomId, `💰 ${item.icon || ''} ${item.text || ''}`.replace(/\s+/g, ' ').trim(),
                item.kind === 'left' || item.kind === 'bankrupt' ? 'warning' : 'info',
                { gameMode: MODE, meta: { kind: item.kind || null, event: 'setthi_history' } });
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
        if (Array.isArray(state.winners) && state.winners.length) {
            statsManager.recordGameEnd(room.roomId, {
                mode: MODE,
                winners: state.winners,
                standings: state.standings || [],
                roomName: room.name,
                minutes: state.clock ? state.clock.minutes : 0,
                reason: state.finishReason
            });
        }
        clearTimers(room.roomId);
        notifyGameEndAfterRecord(room);
        scheduleFinishedGameReturnToLobby(room);
    }

    function emitRoomState(room) {
        if (!isRoom(room)) return;
        const { io, buildRoomUpdatePayload, roomManager } = deps();
        flushHistoryToLogs(room);
        finalizeIfNeeded(room);
        emitState(room);
        scheduleBots(room);
        io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
        // engine แก้ state ตรง ๆ — สั่งเซฟ (debounce ใน roomManager) ให้รีสตาร์ตแล้วกู้เกมได้สด
        if (roomManager && typeof roomManager.schedulePersistRooms === 'function') roomManager.schedulePersistRooms();
    }

    /** หลังรีสตาร์ต: อะไรที่เลยเวลาแล้ว resolve ทันที ที่เหลือตั้งนาฬิกา/บอทใหม่ */
    function recover(room) {
        if (!isLive(room)) return;
        try {
            if (engine.tick(room)) {
                emitRoomState(room);
                return;
            }
        } catch (error) {
            console.error('[setthi] recover failed:', error.message);
        }
        syncPhaseTimer(room);
        ensureWatchdog(room);
        scheduleBots(room);
    }

    /** ห้องถูกทิ้ง (ไม่มีคนออนไลน์นาน) — ให้เวลาเดินต่อหนึ่งจังหวะเหมือนเกมอื่น */
    function forceResolve(room) {
        if (!isLive(room)) return;
        try {
            room.gameState.phaseEndsAt = Date.now() - 1;
            engine.tick(room);
        } catch (error) {
            console.error('[setthi] forceResolve failed:', error.message);
        }
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
        const winners = Array.isArray(state.winners) ? state.winners : [];
        const playerCount = (state.seats || []).length;
        const fmt = n => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');
        const text = winners.length
            ? `${winners.map(w => w.name).join(', ')} ${winners.length > 1 ? 'ชนะร่วม' : 'ชนะ'} (ทรัพย์สิน ${fmt(winners[0].netWorth)})`
            : 'ไม่มีผู้ชนะ';
        return {
            chatMessage: `จบเกมเศรษฐี! ${text}`,
            chatColor: '#f5c86b',
            logMessage: `💰 เศรษฐี จบ — ${text} · ${playerCount} คน · ${state.finishReason || ''}`.trim(),
            logType: 'success',
            meta: { winnerName: winners[0] ? winners[0].name : null, winners: winners.length, playerCount, rounds: state.round || 1 }
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
        boardDef,
        emitState,
        emitRoomState,
        finalizeIfNeeded,
        recover,
        forceResolve,
        handleLeft,
        startGame,
        gameEndNotification
    };
};
