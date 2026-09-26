/**
 * ป๊อกเด้ง — ส่วนฝั่งเซิร์ฟเวอร์ที่ผูกกับ socket/timer (แยกจาก app.js ให้ merge ง่าย)
 * engine ล้วนอยู่ที่ games/pokdengEngine.js — ไฟล์นี้แค่ตั้งเวลา ยิง state และบันทึกสถิติ
 *
 * ใช้: const pokdeng = require('./games/pokdengRuntime')(() => ({ io, roomManager, ... }))
 * getDeps ถูกเรียกตอนใช้งานจริง (ไม่ใช่ตอน require) จึงไม่ติดลำดับประกาศใน app.js
 */

const engine = require('./pokdengEngine');

const MODE = 'pokdeng';

module.exports = function createPokDengRuntime(getDeps) {
    const phaseTimeouts = new Map();
    const botTimeouts = new Map();
    const deps = () => getDeps();
    const botAddInFlight = new Set();

    function isRoom(room) {
        return !!(room && room.settings && room.settings.gameMode === MODE);
    }

    function clearPhaseTimer(roomId, resetPhaseEndsAt = true) {
        const timer = phaseTimeouts.get(roomId);
        if (timer) {
            clearTimeout(timer.timeoutId);
            phaseTimeouts.delete(roomId);
        }
        if (!resetPhaseEndsAt) return;
        const room = deps().roomManager.getRoom(roomId);
        if (room?.gameState && isRoom(room)) room.gameState.phaseEndsAt = null;
    }

    function clearBotTimer(roomId) {
        const timeoutId = botTimeouts.get(roomId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            botTimeouts.delete(roomId);
        }
    }

    // ห้องปิด/จบ — ล้างทุก timer (ห้ามเรียกระหว่างเล่นปกติ นาฬิกาจะหยุด)
    function clearTimers(roomId) {
        clearPhaseTimer(roomId, false);
        clearBotTimer(roomId);
    }

    function syncPhaseTimer(room) {
        if (!isRoom(room)) return;
        const state = room.gameState;
        if (!state || state.status !== 'playing' || !state.phaseEndsAt) {
            clearPhaseTimer(room.roomId, false);
            return;
        }
        const existing = phaseTimeouts.get(room.roomId);
        if (existing && existing.endsAt === state.phaseEndsAt) return;
        clearPhaseTimer(room.roomId, false);
        const delay = Math.max(200, state.phaseEndsAt - Date.now());
        const timeoutId = setTimeout(() => {
            phaseTimeouts.delete(room.roomId);
            const current = deps().roomManager.getRoom(room.roomId);
            if (!isRoom(current)) return;
            try {
                engine.autoResolvePhase(current);
                emitRoomState(current);
            } catch (error) {
                console.error('[pokdeng] auto resolve failed:', error.message);
            }
        }, delay);
        phaseTimeouts.set(room.roomId, { timeoutId, endsAt: state.phaseEndsAt });
    }

    function scheduleBots(room) {
        if (!isRoom(room)) return;
        clearBotTimer(room.roomId);
        if (!engine.botNeedsTurn(room)) return;
        const base = room.gameState.phase === 'bet' ? 900 : 1100;
        const timeoutId = setTimeout(() => {
            botTimeouts.delete(room.roomId);
            const current = deps().roomManager.getRoom(room.roomId);
            if (!isRoom(current)) return;
            try {
                if (engine.playBotTurns(current)) emitRoomState(current);
            } catch (error) {
                console.error('[pokdeng] bots failed:', error.message);
            }
        }, base + Math.floor(Math.random() * 600));
        botTimeouts.set(room.roomId, timeoutId);
    }

    function buildPayload(room, playerId) {
        if (!isRoom(room)) return null;
        return engine.buildClientState(room, playerId);
    }

    function emitState(room, targetSocketId = null, playerId = null) {
        if (!isRoom(room)) return;
        const { io } = deps();
        syncPhaseTimer(room);
        if (targetSocketId && playerId) {
            io.to(targetSocketId).emit('pokdengState', buildPayload(room, playerId));
            return;
        }
        (room.players || []).forEach(player => {
            if (player.socketId && !String(player.playerId).startsWith('bot_')) {
                io.to(player.socketId).emit('pokdengState', buildPayload(room, player.playerId));
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
            if (!['result', 'pok', 'shortfall', 'finished', 'dealer'].includes(item.kind)) return;
            addServerLog(io, 'game', room.roomId, `🎴 ${item.icon || ''} ${item.text || ''}`.replace(/\s+/g, ' ').trim(),
                item.kind === 'shortfall' ? 'warning' : 'info',
                { gameMode: MODE, meta: { kind: item.kind || null, event: 'pokdeng_history' } });
        });
        if (fresh.length) {
            room.gameState.lastLoggedHistoryAt = new Date(fresh[fresh.length - 1].at).getTime();
        }
    }

    function finalizeIfNeeded(room) {
        const state = room?.gameState;
        if (!state || state.phase !== 'finished' || state.statsRecordedAt) return;
        const { statsManager, notifyGameEndAfterRecord, scheduleFinishedGameReturnToLobby } = deps();
        statsManager.recordGameEnd(room.roomId, {
            mode: MODE,
            winner: state.winner,
            standings: state.standings || [],
            players: state.players,
            roomName: room.name,
            handNumber: state.handNumber
        });
        state.statsRecordedAt = new Date().toISOString();
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

    // หลังรีสตาร์ต: เฟสที่เลยเวลาแล้ว resolve ทันที ที่เหลือตั้งนาฬิกา/บอทใหม่
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
        const rows = state.standings || [];
        const top = rows[0];
        const playerCount = rows.length;
        const text = top && top.net > 0
            ? `${top.name} กำไรสูงสุด +${top.net}`
            : 'ไม่มีใครได้กำไร';
        return {
            chatMessage: `จบโต๊ะป๊อกเด้ง! ${text} (${state.handNumber || 0} มือ)`,
            chatColor: '#f5c86b',
            logMessage: `🎴 ป๊อกเด้ง จบ — ${text} · ${state.handNumber || 0} มือ · ${playerCount} คน`,
            logType: 'success',
            meta: { winnerName: top?.name || null, net: top?.net || 0, playerCount, handNumber: state.handNumber || 0 }
        };
    }

    function adminRevealPayload(room) {
        const state = room.gameState || {};
        return {
            handNumber: state.handNumber,
            phase: state.phase,
            dealerId: state.dealerId,
            players: (state.players || []).map(p => {
                let label = '';
                try { label = (p.hand || []).length >= 2 ? engine.evaluateHand(p.hand).label : ''; } catch (e) { label = ''; }
                return {
                    playerId: p.playerId,
                    name: p.name,
                    chips: p.chips,
                    bet: p.bet,
                    isDealer: p.playerId === state.dealerId,
                    cards: (p.hand || []).map(engine.describeCard).map(c => c.thaiName),
                    label
                };
            })
        };
    }

    return {
        MODE,
        engine,
        botAddInFlight,
        isRoom,
        clearTimers,
        clearPhaseTimer,
        clearBotTimer,
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
