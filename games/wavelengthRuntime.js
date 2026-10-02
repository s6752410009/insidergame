/**
 * คลื่นความคิด — ส่วนฝั่งเซิร์ฟเวอร์ที่ผูกกับ socket/timer (แยกจาก app.js ให้ merge ง่าย)
 * engine ล้วนอยู่ที่ games/wavelengthEngine.js — ไฟล์นี้แค่ตั้งเวลา ยิง state ทีละคน และบันทึกสถิติ
 *
 * ใช้: const wavelength = require('./games/wavelengthRuntime')(() => ({ io, roomManager, ... }))
 */

const engine = require('./wavelengthEngine');

const MODE = 'wavelength';

module.exports = function createWavelengthRuntime(getDeps) {
    const phaseTimeouts = new Map();
    const deps = () => getDeps();

    function isRoom(room) {
        return !!(room && room.settings && room.settings.gameMode === MODE);
    }

    function clearTimers(roomId) {
        const timer = phaseTimeouts.get(roomId);
        if (timer) {
            clearTimeout(timer.timeoutId);
            phaseTimeouts.delete(roomId);
        }
    }

    function syncPhaseTimer(room) {
        if (!isRoom(room)) return;
        const state = room.gameState;
        if (!state || state.status !== 'playing' || !state.phaseEndsAt) {
            clearTimers(room.roomId);
            return;
        }
        const existing = phaseTimeouts.get(room.roomId);
        if (existing && existing.endsAt === state.phaseEndsAt) return;
        clearTimers(room.roomId);
        const delay = Math.max(100, state.phaseEndsAt - Date.now());
        const timeoutId = setTimeout(() => {
            phaseTimeouts.delete(room.roomId);
            const current = deps().roomManager.getRoom(room.roomId);
            if (!isRoom(current)) return;
            try {
                engine.autoResolvePhase(current);
                emitRoomState(current);
            } catch (error) {
                console.error('[wavelength] auto resolve failed:', error.message);
            }
        }, delay);
        phaseTimeouts.set(room.roomId, { timeoutId, endsAt: state.phaseEndsAt });
    }

    function buildPayload(room, playerId) {
        if (!isRoom(room)) return null;
        return engine.buildClientState(room, playerId);
    }

    // ส่งทีละ socket เสมอ — เป้าลับของผู้ใบ้ห้ามออกไปทาง room broadcast
    function emitState(room, targetSocketId = null, playerId = null) {
        if (!isRoom(room)) return;
        const { io } = deps();
        syncPhaseTimer(room);
        if (targetSocketId && playerId) {
            io.to(targetSocketId).emit('wavelengthState', buildPayload(room, playerId));
            return;
        }
        // ส่งทุก socket ของผู้เล่นในห้องนี้ (เปิดหลายแท็บ/ต่อใหม่ก็ได้ state ครบ) — payload สร้างตาม playerId ของ socket นั้นเอง
        const targets = new Map();
        (room.players || []).forEach(player => {
            if (player.socketId && !String(player.playerId).startsWith('bot_')) targets.set(player.socketId, player.playerId);
        });
        const members = new Set((room.players || []).map(player => player.playerId));
        const live = io.sockets && io.sockets.sockets;
        if (live && typeof live.forEach === 'function') {
            live.forEach(sock => {
                if (sock.connected && sock.roomId === room.roomId && members.has(sock.playerId)) targets.set(sock.id, sock.playerId);
            });
        }
        const cache = new Map();
        targets.forEach((pid, socketId) => {
            if (!cache.has(pid)) cache.set(pid, buildPayload(room, pid));
            io.to(socketId).emit('wavelengthState', cache.get(pid));
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
            if (!['clue', 'reveal', 'skip', 'finished'].includes(item.kind)) return;
            addServerLog(io, 'game', room.roomId, `📡 ${item.icon || ''} ${item.text || ''}`.replace(/\s+/g, ' ').trim(),
                item.kind === 'skip' ? 'warning' : 'info',
                { gameMode: MODE, meta: { kind: item.kind || null, event: 'wavelength_history' } });
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
        try {
            statsManager.recordGameEnd(room.roomId, {
                mode: MODE,
                standings: state.standings || [],
                winners: state.winners || [],
                roomName: room.name,
                rounds: state.round
            });
        } catch (error) {
            console.error('[wavelength] record stats failed:', error.message);
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
        io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
    }

    /** มีคนหลุด/ต่อกลับ — ผ่อนผันผู้ใบ้ หรือเปิดเป้าเมื่อคนออนไลน์ล็อกครบ */
    function handlePresence(room) {
        if (!isRoom(room) || room.gameState?.status !== 'playing') return;
        try {
            engine.refreshPresence(room);
        } catch (error) {
            console.error('[wavelength] presence failed:', error.message);
        }
        emitRoomState(room);
    }

    // หลังรีสตาร์ต: เฟสที่เลยเวลาแล้ว resolve ทันที ที่เหลือตั้งนาฬิกาใหม่
    function recover(room) {
        if (!isRoom(room) || room.gameState?.status !== 'playing') return;
        if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()) {
            engine.autoResolvePhase(room);
            emitRoomState(room);
            return;
        }
        syncPhaseTimer(room);
    }

    function forceResolve(room) {
        if (!isRoom(room) || room.gameState?.status !== 'playing') return;
        room.gameState.phaseEndsAt = Date.now() - 1;
        if (room.gameState.phase === 'clue') room.gameState.clueDeadline = Date.now() - 1;
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
        const winners = state.winners || [];
        const rows = state.standings || [];
        const text = winners.length
            ? `${winners.map(w => w.name).join(', ')} ชนะ ${winners[0].score} แต้ม`
            : 'ไม่มีใครทำแต้มได้';
        return {
            chatMessage: `จบคลื่นความคิด! ${text} (${state.round || 0} รอบ)`,
            chatColor: '#5eead4',
            logMessage: `📡 คลื่นความคิด จบ — ${text} · ${state.round || 0} รอบ · ${rows.length} คน`,
            logType: 'success',
            meta: { winnerName: winners[0]?.name || null, score: winners[0]?.score || 0, playerCount: rows.length, rounds: state.round || 0 }
        };
    }

    return {
        MODE,
        engine,
        isRoom,
        clearTimers,
        syncPhaseTimer,
        buildPayload,
        emitState,
        emitRoomState,
        finalizeIfNeeded,
        handlePresence,
        recover,
        forceResolve,
        handleLeft,
        startGame,
        gameEndNotification
    };
};
