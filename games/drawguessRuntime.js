/**
 * วาดแล้วทาย — ส่วนฝั่งเซิร์ฟเวอร์ที่ผูกกับ socket/timer (แยกจาก app.js ให้ merge ง่าย)
 * engine ล้วนอยู่ที่ games/drawguessEngine.js — ไฟล์นี้แค่เดินนาฬิกา ส่ง state/เส้น และบันทึกสถิติ
 *
 * ใช้: const drawguess = require('./games/drawguessRuntime')(() => ({ io, roomManager, ... }))
 * getDeps ถูกเรียกตอนใช้งานจริง (ไม่ใช่ตอน require) จึงไม่ติดลำดับประกาศใน app.js
 *
 * นาฬิกา: ห้องที่กำลังเล่นมี interval เดียว (TICK_MS) เรียก engine.tick — ครอบคลุมหมดเวลา/คำใบ้/คนวาดหลุด
 * interval ปิดตัวเองเมื่อห้องหายหรือเกมจบ
 */

const engine = require('./drawguessEngine');

const MODE = 'drawguess';
const TICK_MS = 500;

module.exports = function createDrawGuessRuntime(getDeps) {
    const tickers = new Map();
    const deps = () => getDeps();

    function isRoom(room) {
        return !!(room && room.settings && room.settings.gameMode === MODE);
    }

    function isPlaying(room) {
        return isRoom(room) && room.gameState?.mode === MODE && room.gameState.status === 'playing';
    }

    function clearTimers(roomId) {
        const handle = tickers.get(roomId);
        if (handle) {
            clearInterval(handle);
            tickers.delete(roomId);
        }
    }

    function onTick(roomId) {
        const room = deps().roomManager.getRoom(roomId);
        if (!isPlaying(room)) {
            clearTimers(roomId);
            return;
        }
        try {
            if (engine.tick(room, Date.now())) emitRoomState(room);
        } catch (error) {
            console.error('[drawguess] tick failed:', error.message);
        }
    }

    function ensureTicker(room) {
        if (!isPlaying(room)) {
            if (room?.roomId) clearTimers(room.roomId);
            return;
        }
        if (tickers.has(room.roomId)) return;
        // นาฬิกาเพิ่งเริ่มเดินในโปรเซสนี้ (เริ่มเกม/เซิร์ฟเวอร์บูตใหม่) — ให้ทุกคนมีเวลากลับมาก่อนถือว่าหลุด
        engine.markRecovered(room, Date.now());
        const handle = setInterval(() => onTick(room.roomId), TICK_MS);
        if (typeof handle.unref === 'function') handle.unref();
        tickers.set(room.roomId, handle);
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
            io.to(targetSocketId).emit('drawguessState', buildPayload(room, playerId));
            return;
        }
        (room.players || []).forEach(player => {
            if (player.socketId) {
                io.to(player.socketId).emit('drawguessState', buildPayload(room, player.playerId));
            }
        });
    }

    /** ส่งเส้นทั้งหมดของตานี้ให้คนที่เพิ่งต่อเข้ามา (รีเฟรช/หลุดแล้วกลับมา) */
    function emitCanvas(room, targetSocketId) {
        if (!isRoom(room) || !targetSocketId) return;
        deps().io.to(targetSocketId).emit('drawguess_canvas', engine.getCanvas(room));
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
            if (!['turn', 'finished'].includes(item.kind)) return;
            addServerLog(io, 'game', room.roomId, `🎨 ${item.text || ''}`.replace(/\s+/g, ' ').trim(), 'info',
                { gameMode: MODE, meta: { kind: item.kind || null, event: 'drawguess_history' } });
        });
        if (fresh.length) {
            room.gameState.lastLoggedHistoryAt = new Date(fresh[fresh.length - 1].at).getTime();
        }
    }

    function finalizeIfNeeded(room) {
        const state = room?.gameState;
        if (!state || state.mode !== MODE || state.phase !== 'finished' || state.statsRecordedAt) return;
        const { statsManager, notifyGameEndAfterRecord, scheduleFinishedGameReturnToLobby } = deps();
        state.statsRecordedAt = new Date().toISOString();
        if (state.countsForStats) {
            try {
                statsManager.recordGameEnd(room.roomId, {
                    mode: MODE,
                    standings: engine.getScoringPlayers(room),
                    winnerIds: state.winnerIds || [],
                    roomName: room.name,
                    rounds: state.settings?.rounds || 0
                });
            } catch (error) {
                console.error('[drawguess] record stats failed:', error.message);
            }
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

    // หลังรีสตาร์ต: ให้นาฬิกาเดินต่อ — tick แรกจะปิดเฟสที่เลยเวลาไปแล้วเอง
    function recover(room) {
        if (!isRoom(room)) return;
        if (isPlaying(room)) {
            ensureTicker(room);
            return;
        }
        if (room.gameState?.phase === 'finished') finalizeIfNeeded(room);
    }

    function handleLeft(room, playerId) {
        if (!isRoom(room)) return;
        engine.handlePlayerLeft(room, playerId, Date.now());
    }

    function startGame(room) {
        clearTimers(room.roomId);
        engine.startGame(room, Date.now());
        ensureTicker(room);
    }

    function chooseWord(room, playerId, data) {
        return engine.chooseWord(room, playerId, data?.index, { turnNo: data?.turnNo }, Date.now());
    }

    function guess(room, playerId, data) {
        const { filterText } = deps();
        return engine.submitGuess(room, playerId, data?.text, {
            displayFilter: typeof filterText === 'function' ? filterText : null
        }, Date.now());
    }

    function skipTurn(room, playerId, data) {
        return engine.skipTurn(room, playerId, { turnNo: data?.turnNo }, Date.now());
    }

    /** คนวาดกด "วาดเสร็จแล้ว" — ตัดเวลาเหลือช่วงทายสั้น ๆ */
    function finishDrawing(room, playerId, data) {
        return engine.finishDrawing(room, playerId, { turnNo: data?.turnNo }, Date.now());
    }

    /** คนทายกด 🚩 คนวาดเขียนตัวหนังสือ (กดซ้ำ = ยกเลิก) — เกินครึ่งของคนทาย = ตานี้โมฆะ */
    function reportDrawing(room, playerId, data) {
        return engine.reportDrawing(room, playerId, { turnNo: data?.turnNo }, Date.now());
    }

    /** รับเส้นจากคนวาด → ตรวจแล้วส่งต่อให้ทุกคนในห้อง (ยกเว้นคนส่ง) */
    function relayStrokes(socket, room, data) {
        const ops = engine.applyStrokes(room, socket.playerId, data, Date.now());
        if (ops.length) {
            socket.to(room.roomId).emit('drawguess_draw', { turnNo: room.gameState.turnNo, ops });
        }
        return ops.length;
    }

    /** ห้องว่าง/เก็บกวาด — ไม่ต้องบันทึกสถิติ แค่หยุดนาฬิกา */
    function forceResolve(room) {
        if (!isRoom(room)) return;
        clearTimers(room.roomId);
    }

    function gameEndNotification(room) {
        const state = room.gameState || {};
        const rows = state.standings || [];
        const winners = rows.filter(row => (state.winnerIds || []).includes(row.playerId));
        const top = winners[0];
        const text = winners.length
            ? `${winners.map(row => row.name).join(', ')} ชนะ (${top.score} แต้ม)`
            : 'ไม่มีใครได้แต้ม';
        const suffix = state.countsForStats ? '' : ' · ไม่นับสถิติ';
        return {
            chatMessage: `จบเกมวาดแล้วทาย! ${text}${suffix}`,
            chatColor: '#f5c86b',
            logMessage: `🎨 วาดแล้วทาย จบ — ${text} · ${rows.length} คน${suffix}`,
            logType: 'success',
            meta: { winnerNames: winners.map(row => row.name), score: top?.score || 0, playerCount: rows.length, countsForStats: !!state.countsForStats }
        };
    }

    function adminRevealPayload(room) {
        const state = room.gameState || {};
        return {
            phase: state.phase,
            round: state.round,
            turnNo: state.turnNo,
            drawerName: state.roster?.[state.drawerId]?.name || null,
            word: state.word || null,
            choices: (state.choices || []).map(choice => choice.word)
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
        emitCanvas,
        emitRoomState,
        finalizeIfNeeded,
        recover,
        handleLeft,
        startGame,
        chooseWord,
        guess,
        skipTurn,
        finishDrawing,
        reportDrawing,
        relayStrokes,
        forceResolve,
        gameEndNotification,
        adminRevealPayload
    };
};
