/**
 * สายลับคำใบ้ — ส่วนฝั่งเซิร์ฟเวอร์ที่ผูกกับ socket/timer (แยกจาก app.js ให้ merge ง่าย)
 * engine ล้วนอยู่ที่ games/codenamesEngine.js — ไฟล์นี้แค่เดินนาฬิกา ยิง state ทีละ socket และบันทึกสถิติ
 *
 * ใช้: const codenames = require('./games/codenamesRuntime')(() => ({ io, roomManager, ... }))
 * getDeps ถูกเรียกตอนใช้งานจริง (ไม่ใช่ตอน require) จึงไม่ติดลำดับประกาศใน app.js
 *
 * ความลับ: กุญแจ (สีการ์ดที่ยังไม่เปิด) ห้ามออกทาง io.to(room) — ส่งทีละ socket ผ่าน buildClientState เท่านั้น
 */

const engine = require('./codenamesEngine');

const MODE = 'codenames';
const TICK_MS = Number(process.env.CODENAMES_TICK_MS) || 1000;

module.exports = function createCodenamesRuntime(getDeps) {
    const tickers = new Map();
    const deps = () => getDeps();

    function isRoom(room) {
        return !!(room && room.settings && room.settings.gameMode === MODE);
    }

    function isPlaying(room) {
        return isRoom(room) && room.gameState && room.gameState.status === 'playing';
    }

    function clearTimers(roomId) {
        const handle = tickers.get(roomId);
        if (handle) {
            clearInterval(handle);
            tickers.delete(roomId);
        }
    }

    // นาฬิกาเดียวต่อห้อง: หมดเวลา/หัวหน้าหลุด/ทีมไม่มีคนเล่น ตัดสินใน engine.tick
    function ensureTicker(room) {
        if (!isPlaying(room)) {
            clearTimers(room && room.roomId);
            return;
        }
        if (tickers.has(room.roomId)) return;
        const roomId = room.roomId;
        const handle = setInterval(() => {
            const current = deps().roomManager.getRoom(roomId);
            if (!isPlaying(current)) {
                clearTimers(roomId);
                if (isRoom(current)) finalizeIfNeeded(current);
                return;
            }
            try {
                if (engine.tick(current, Date.now())) emitRoomState(current);
            } catch (error) {
                console.error('[codenames] tick failed:', error.message);
            }
        }, TICK_MS);
        if (typeof handle.unref === 'function') handle.unref();
        tickers.set(roomId, handle);
    }

    function buildPayload(room, playerId) {
        if (!isRoom(room)) return null;
        return engine.buildClientState(room, playerId, Date.now());
    }

    function emitState(room, targetSocketId = null, playerId = null) {
        if (!isRoom(room)) return;
        const { io } = deps();
        ensureTicker(room);
        if (targetSocketId && playerId) {
            io.to(targetSocketId).emit('codenamesState', buildPayload(room, playerId));
            return;
        }
        (room.players || []).forEach(player => {
            if (player.socketId && !String(player.playerId).startsWith('bot_')) {
                io.to(player.socketId).emit('codenamesState', buildPayload(room, player.playerId));
            }
        });
    }

    function flushHistoryToLogs(room) {
        const history = room.gameState && room.gameState.history;
        if (!Array.isArray(history) || !history.length) return;
        const { io, addServerLog } = deps();
        const lastAt = Number(room.gameState.lastLoggedHistoryAt) || 0;
        const fresh = history.filter(item => item && item.at && new Date(item.at).getTime() > lastAt);
        fresh.forEach(item => {
            if (!['assassin', 'promote', 'finished', 'left'].includes(item.kind)) return;
            addServerLog(io, 'game', room.roomId, `🕵️ ${item.icon || ''} ${item.text || ''}`.replace(/\s+/g, ' ').trim(),
                item.kind === 'promote' || item.kind === 'left' ? 'warning' : 'info',
                { gameMode: MODE, meta: { kind: item.kind || null, event: 'codenames_history' } });
        });
        if (fresh.length) {
            room.gameState.lastLoggedHistoryAt = new Date(fresh[fresh.length - 1].at).getTime();
        }
    }

    function finalizeIfNeeded(room) {
        const state = room && room.gameState;
        if (!state || state.phase !== 'finished' || state.statsRecordedAt) return;
        const { statsManager, notifyGameEndAfterRecord, scheduleFinishedGameReturnToLobby } = deps();
        state.statsRecordedAt = new Date().toISOString();
        if (state.winner) {
            const result = engine.buildResult(room);
            statsManager.recordGameEnd(room.roomId, { ...result, roomName: room.name });
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
        io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
        if (roomManager && typeof roomManager.schedulePersistRooms === 'function') roomManager.schedulePersistRooms();
    }

    // หลังรีสตาร์ต: เดินนาฬิกาต่อ (เฟสที่เลยเวลาแล้วจะถูกตัดสินใน tick แรก) · จบแล้วแต่ยังไม่บันทึก = บันทึก
    function recover(room) {
        if (!isRoom(room)) return;
        if (room.gameState && room.gameState.phase === 'finished') {
            finalizeIfNeeded(room);
            return;
        }
        ensureTicker(room);
    }

    function handleLeft(room, playerId) {
        if (!isRoom(room)) return;
        engine.handlePlayerLeft(room, playerId, Date.now());
    }

    function startGame(room) {
        clearTimers(room.roomId);
        engine.startGame(room, Math.random, Date.now());
        ensureTicker(room);
    }

    // ---- ห้องรอ: เลือกทีม/บท ----
    function pickTeam(room, playerId, choice) {
        if (!isRoom(room)) throw new Error('ห้องนี้ไม่ใช่สายลับคำใบ้');
        return engine.pickTeam(room, playerId, choice || {});
    }

    function shuffleTeams(room, playerId) {
        if (!isRoom(room)) throw new Error('ห้องนี้ไม่ใช่สายลับคำใบ้');
        if (room.admin !== playerId) throw new Error('เฉพาะหัวหน้าห้องที่สุ่มทีมได้');
        return engine.shuffleTeams(room, Math.random);
    }

    function startBlockReason(room) {
        if (!isRoom(room)) return null;
        return engine.getStartBlockReason(room);
    }

    function gameEndNotification(room) {
        const state = room.gameState || {};
        const label = state.winner ? engine.TEAM_LABEL[state.winner] : null;
        const reason = {
            words: 'เจอสายลับครบ',
            gift: 'อีกทีมเปิดคำสุดท้ายให้',
            assassin: 'อีกทีมเปิดเจอมือสังหาร',
            forfeit: 'อีกทีมไม่เหลือผู้เล่น'
        }[state.winReason] || '';
        const text = label ? `${label}ชนะ!${reason ? ' — ' + reason : ''}` : 'จบเกม ไม่มีผู้ชนะ';
        const playerCount = (state.roster || []).filter(p => p.team && !p.left).length;
        return {
            chatMessage: `จบเกมสายลับคำใบ้! ${text}`,
            chatColor: state.winner === 'blue' ? '#7cb4ff' : '#ff8a7a',
            logMessage: `🕵️ สายลับคำใบ้ จบ — ${text} · ${state.turnNumber || 0} เทิร์น · ${playerCount} คน`,
            logType: 'success',
            meta: { winner: state.winner || null, winReason: state.winReason || null, playerCount, turns: state.turnNumber || 0 }
        };
    }

    return {
        MODE,
        engine,
        isRoom,
        clearTimers,
        ensureTicker,
        buildPayload,
        emitState,
        emitRoomState,
        finalizeIfNeeded,
        recover,
        handleLeft,
        startGame,
        pickTeam,
        shuffleTeams,
        startBlockReason,
        gameEndNotification
    };
};
