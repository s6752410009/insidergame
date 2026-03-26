/**
 * RoomManager - จัดการห้องเกมหลายห้อง
 * - สร้าง/ลบห้อง
 * - จัดการผู้เล่นในห้อง
 * - แยก game state ต่อห้อง
 */

const { v4: uuidv4 } = require('uuid');
const playerManager = require('./playerManager');
const { normalizeGameMode, getGameEngine } = require('../games/engineRegistry');

// เก็บห้องทั้งหมด (key: roomId, value: room object)
const rooms = new Map();

// Game Master Role constant
const gameMasterRole = 'ผู้ดำเนินเกม';
const traitorRole = 'ผู้ทรยศ';
const defaultRole = 'พลเมือง';

function nowIso() {
    return new Date().toISOString();
}

function getOnlinePlayerCount(room) {
    return room.players.filter(player => !!player.socketId).length;
}

function isRoomGameActive(room) {
    if (!room || !room.gameState) {
        return false;
    }

    return !!(room.gameState.status && room.gameState.status !== '' && room.gameState.status !== 'waiting');
}

function clampMaxPlayers(gameEngine, requestedMaxPlayers, currentPlayers = 0) {
    const minPlayers = Number(gameEngine?.minPlayers || 3);
    const maxPlayers = Number(gameEngine?.maxPlayers || 10);
    const normalizedRequested = Number(requestedMaxPlayers) || Math.max(minPlayers, currentPlayers, 5);
    return Math.max(Math.max(minPlayers, currentPlayers), Math.min(maxPlayers, normalizedRequested));
}

/**
 * สร้างห้องใหม่
 */
function createRoom(roomData, creatorPlayerId) {
    const roomId = uuidv4().substring(0, 8); // ใช้ 8 ตัวแรกของ UUID เป็น roomId
    const creator = playerManager.getPlayer(creatorPlayerId);
    const gameMode = normalizeGameMode(roomData.gameMode);
    const gameEngine = getGameEngine(gameMode);
    
    if (!creator) {
        throw new Error('Creator player not found');
    }

    const hasExplicitWerewolfRoles = gameMode === 'werewolf'
        && Array.isArray(roomData.werewolfRoles)
        && roomData.werewolfRoles.length > 0;
    const werewolfRoles = gameMode === 'werewolf'
        ? (hasExplicitWerewolfRoles && typeof gameEngine.sanitizeRoleSelection === 'function'
            ? gameEngine.sanitizeRoleSelection(roomData.werewolfRoles)
            : [])
        : undefined;
    const wolfCount = gameMode === 'werewolf'
        ? (hasExplicitWerewolfRoles
            ? null
            : Math.min(Math.max(1, Number(roomData.wolfCount) || 2), 3))
        : null;

    const room = {
        roomId,
        name: roomData.name || `ห้อง ${roomId}`,
        players: [], // Array of { playerId, playerName, color, socketId, permission }
        admin: creatorPlayerId, // playerId ของ admin
        settings: {
            gameMode,
            maxPlayers: clampMaxPlayers(gameEngine, roomData.maxPlayers, 1),
            roundTime: gameMode === 'werewolf' ? 5 * 60 : (roomData.roundTime || 5) * 60, // Werewolf ใช้ค่า fixed
            traitorOptional: roomData.traitorOptional !== undefined ? roomData.traitorOptional : true,
            dualTraitorMode: roomData.dualTraitorMode || false, // โหมด 2 ผู้ทรยศ (ต้องมี 5+ คน)
            werewolfRoles,
            wolfCount,
            locked: roomData.locked || false,
            password: roomData.password || null
        },
        gameState: gameEngine.createInitialState(),
        chatHistory: [],
        rejoinableGamePlayers: new Map(),
        createdAt: new Date().toISOString()
    };

    rooms.set(roomId, room);
    
    // เพิ่มผู้สร้างเป็นผู้เล่นคนแรก
    joinRoom(roomId, creatorPlayerId, null, roomData.password);
    
    return room;
}

/**
 * เข้าห้อง
 */
function joinRoom(roomId, playerId, socketId = null, password = null) {
    const room = rooms.get(roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    // ตรวจสอบรหัสผ่าน
    if (room.settings.locked && room.settings.password !== password) {
        throw new Error('Invalid password');
    }

    const player = playerManager.getPlayer(playerId);
    const gameEngine = getGameEngine(room.settings.gameMode);
    if (!player) {
        throw new Error('Player not found');
    }

    // ตรวจสอบว่าผู้เล่นอยู่ในห้องนี้แล้วหรือยัง (reconnect)
    const existingPlayerIndex = room.players.findIndex(p => p.playerId === playerId);
    const isReconnecting = existingPlayerIndex >= 0;
    
    // ตรวจสอบว่าห้องเต็มหรือยัง (ยกเว้นกรณี reconnect)
    if (!isReconnecting) {
        const currentPlayerCount = room.players.length;
        if (currentPlayerCount >= room.settings.maxPlayers) {
            throw new Error('Room is full');
        }
    }
    if (existingPlayerIndex >= 0) {
        // อัปเดต socketId ถ้ามี
        if (socketId) {
            room.players[existingPlayerIndex].socketId = socketId;
            room.players[existingPlayerIndex].lastActiveAt = nowIso();
            room.players[existingPlayerIndex].disconnectedAt = null;
        }
        return room;
    }

    // เพิ่มผู้เล่นใหม่
    room.players.push({
        playerId: player.playerId,
        playerName: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        socketId: socketId,
        permission: playerId === room.admin ? 'admin' : null,
        joinedAt: nowIso(),
        lastActiveAt: nowIso(),
        disconnectedAt: socketId ? null : nowIso()
    });

    const rejoinableGamePlayer = room.rejoinableGamePlayers instanceof Map
        ? room.rejoinableGamePlayers.get(playerId)
        : null;

    // เพิ่มใน gameState.players ด้วย (สำหรับเกม)
    // Bug #5 Fix: เพิ่ม socketId เพื่อใช้เช็คว่า online หรือไม่
    if (rejoinableGamePlayer && isRoomGameActive(room)) {
        room.gameState.players.push({
            ...rejoinableGamePlayer,
            name: player.playerName,
            color: player.color,
            avatar: player.avatar || '👤',
            avatarFrame: player.avatarFrame || 'none',
            socketId,
            permission: playerId === room.admin ? 'admin' : null
        });
        room.rejoinableGamePlayers.delete(playerId);
    } else {
        room.gameState.players.push(gameEngine.createPlayerState(player, {
            socketId,
            isAdmin: playerId === room.admin
        }));
    }

    if (Array.isArray(room.gameState.alivePlayerIds)) {
        room.gameState.alivePlayerIds = room.players.map(existingPlayer => existingPlayer.playerId);
    }

    return room;
}

/**
 * ผู้เล่น disconnect (แค่เคลียร์ socketId ไม่ลบออกจากห้อง)
 * ใช้เมื่อ socket disconnect เพื่อรอให้ผู้เล่น reconnect
 * Bug #5 Fix: อัปเดตทั้งใน room.players และ room.gameState.players
 */
function disconnectPlayer(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) {
        return null;
    }

    const playerIndex = room.players.findIndex(p => p.playerId === playerId);
    if (playerIndex < 0) {
        return null;
    }

    // แค่เคลียร์ socketId ไม่ลบผู้เล่นออก
    room.players[playerIndex].socketId = null;
    room.players[playerIndex].disconnectedAt = nowIso();

    // Bug #5 Fix: อัปเดตใน gameState.players ด้วย
    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (gameStatePlayer) {
        gameStatePlayer.socketId = null;
    }

    return room;
}

/**
 * ออกจากห้อง (ลบผู้เล่นออกจริงๆ)
 */
function leaveRoom(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) {
        return null;
    }

    const playerIndex = room.players.findIndex(p => p.playerId === playerId);
    if (playerIndex < 0) {
        return null;
    }

    const wasAdmin = room.admin === playerId;
    
    const wasGameActive = isRoomGameActive(room);
    const roomPlayer = room.players[playerIndex];

    // ลบผู้เล่นออก
    room.players.splice(playerIndex, 1);
    
    // ลบออกจาก gameState.players ด้วย
    const gameStatePlayerIndex = room.gameState.players.findIndex(p => p.playerId === playerId);
    if (gameStatePlayerIndex >= 0) {
        if (wasGameActive) {
            if (!(room.rejoinableGamePlayers instanceof Map)) {
                room.rejoinableGamePlayers = new Map();
            }

            room.rejoinableGamePlayers.set(playerId, {
                ...room.gameState.players[gameStatePlayerIndex],
                socketId: null,
                permission: wasAdmin ? null : room.gameState.players[gameStatePlayerIndex].permission,
                leftAt: nowIso(),
                lastKnownRoomProfile: roomPlayer ? {
                    playerName: roomPlayer.playerName,
                    color: roomPlayer.color,
                    avatar: roomPlayer.avatar || '👤',
                    avatarFrame: roomPlayer.avatarFrame || 'none'
                } : null
            });
        }

        room.gameState.players.splice(gameStatePlayerIndex, 1);
    }

    // ถ้า admin ออก ให้โอนสิทธิให้ผู้เล่นคนแรก
    if (wasAdmin && room.players.length > 0) {
        const newAdmin = room.players[0].playerId;
        room.admin = newAdmin;
        room.players[0].permission = 'admin';
        
        // อัปเดตใน gameState ด้วย
        const newAdminGameState = room.gameState.players.find(p => p.playerId === newAdmin);
        if (newAdminGameState) {
            newAdminGameState.permission = 'admin';
        }
    }

    // ถ้าไม่มีผู้เล่นแล้ว ให้ลบห้อง
    if (room.players.length === 0) {
        rooms.delete(roomId);
        return null;
    }

    return room;
}

/**
 * เตะผู้เล่น
 */
function kickPlayer(roomId, adminPlayerId, targetPlayerId) {
    const room = rooms.get(roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    // ตรวจสอบสิทธิ admin
    if (room.admin !== adminPlayerId) {
        throw new Error('Only admin can kick players');
    }

    // ไม่ให้เตะตัวเอง
    if (adminPlayerId === targetPlayerId) {
        throw new Error('Cannot kick yourself');
    }

    // ลบผู้เล่น
    leaveRoom(roomId, targetPlayerId);

    if (room.rejoinableGamePlayers instanceof Map) {
        room.rejoinableGamePlayers.delete(targetPlayerId);
    }
    
    return room;
}

/**
 * โอนสิทธิ admin
 */
function transferAdmin(roomId, currentAdminId, newAdminPlayerId) {
    const room = rooms.get(roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    // ตรวจสอบสิทธิ admin ปัจจุบัน
    if (room.admin !== currentAdminId) {
        throw new Error('Only current admin can transfer admin');
    }

    // ตรวจสอบว่าผู้เล่นใหม่อยู่ในห้องนี้
    const newAdminPlayer = room.players.find(p => p.playerId === newAdminPlayerId);
    if (!newAdminPlayer) {
        throw new Error('New admin not in room');
    }

    // อัปเดต admin
    const oldAdminPlayer = room.players.find(p => p.playerId === currentAdminId);
    if (oldAdminPlayer) {
        oldAdminPlayer.permission = null;
    }

    room.admin = newAdminPlayerId;
    newAdminPlayer.permission = 'admin';

    // อัปเดตใน gameState ด้วย
    const oldAdminGameState = room.gameState.players.find(p => p.playerId === currentAdminId);
    if (oldAdminGameState) {
        oldAdminGameState.permission = null;
    }

    const newAdminGameState = room.gameState.players.find(p => p.playerId === newAdminPlayerId);
    if (newAdminGameState) {
        newAdminGameState.permission = 'admin';
    }

    return room;
}

/**
 * อัปเดตการตั้งค่าห้อง
 */
function updateRoom(roomId, adminPlayerId, updates) {
    const room = rooms.get(roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    // ตรวจสอบสิทธิ admin
    if (room.admin !== adminPlayerId) {
        throw new Error('Only admin can update room');
    }

    // อัปเดตชื่อห้อง
    if (updates.name !== undefined) {
        room.name = updates.name;
    }

    // อัปเดต settings
    if (updates.maxPlayers !== undefined) {
        const gameEngine = getGameEngine(room.settings.gameMode);
        room.settings.maxPlayers = clampMaxPlayers(gameEngine, updates.maxPlayers, room.players.length);
    }

    if (updates.roundTime !== undefined && room.settings.gameMode !== 'werewolf') {
        room.settings.roundTime = updates.roundTime * 60; // แปลงนาทีเป็นวินาที
    }

    if (updates.traitorOptional !== undefined) {
        room.settings.traitorOptional = updates.traitorOptional;
    }
    
    // อัปเดตโหมด 2 ผู้ทรยศ (ต้องมีผู้เล่น 5+ คนถึงจะเปิดได้)
    if (updates.dualTraitorMode !== undefined) {
        if (updates.dualTraitorMode && room.players.length < 5) {
            // ไม่อนุญาตให้เปิดถ้าผู้เล่นไม่ถึง 5 คน
            room.settings.dualTraitorMode = false;
        } else {
            room.settings.dualTraitorMode = updates.dualTraitorMode;
        }
    }

    if (updates.locked !== undefined) {
        room.settings.locked = updates.locked;
        room.settings.password = updates.password || null;
    }

    if (room.settings.gameMode === 'werewolf') {
        const gameEngine = getGameEngine(room.settings.gameMode);
        const hasExplicitWerewolfRoles = Array.isArray(updates.werewolfRoles) && updates.werewolfRoles.length > 0;

        if (hasExplicitWerewolfRoles) {
            room.settings.werewolfRoles = typeof gameEngine.sanitizeRoleSelection === 'function'
                ? gameEngine.sanitizeRoleSelection(updates.werewolfRoles)
                : updates.werewolfRoles;
            room.settings.wolfCount = null;
        } else {
            room.settings.werewolfRoles = [];
            if (updates.wolfCount !== undefined) {
                const wc = Number(updates.wolfCount) || 0;
                room.settings.wolfCount = (wc >= 1 && wc <= 3) ? wc : null;
            }
        }
    }

    if (room.settings.gameMode === 'werewolf') {
        const gameEngine = getGameEngine(room.settings.gameMode);
        if (typeof gameEngine.getRolePlan === 'function') {
            room.gameState.rolePlan = gameEngine.getRolePlan(room.players.length, room.settings);
        }
    }

    return room;
}

/**
 * ดึงข้อมูลห้อง
 */
function getRoom(roomId) {
    return rooms.get(roomId) || null;
}

/**
 * ดึงรายการห้องทั้งหมด (สำหรับ Room List)
 */
function getAllRooms() {
    return Array.from(rooms.values()).map(room => {
        const gameEngine = getGameEngine(room.settings.gameMode);
        const isInGame = !!(room.gameState.status && room.gameState.status !== 'waiting');
        
        return {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.length, // นับผู้เล่นทั้งหมด ไม่ว่าจะมี socketId หรือไม่
            onlineCount: getOnlinePlayerCount(room),
            maxPlayers: room.settings.maxPlayers,
            locked: room.settings.locked,
            admin: room.admin,
            gameMode: room.settings.gameMode,
            gameModeLabel: gameEngine.label,
            gameStatus: isInGame ? 'playing' : 'waiting', // เพิ่มสถานะเกม
            settings: {
                gameMode: room.settings.gameMode,
                dualTraitorMode: room.settings.dualTraitorMode || false
            }
        };
    });
}

/**
 * อัปเดต socketId ของผู้เล่น (เมื่อ reconnect)
 * อัปเดตทั้งใน room.players และ room.gameState.players
 */
function updatePlayerSocketId(roomId, playerId, socketId) {
    const room = rooms.get(roomId);
    if (!room) {
        return null;
    }

    // อัปเดตใน room.players
    const player = room.players.find(p => p.playerId === playerId);
    if (player) {
        player.socketId = socketId;
        player.lastActiveAt = nowIso();
        player.disconnectedAt = socketId ? null : (player.disconnectedAt || nowIso());
    }

    // Bug #5 Fix: อัปเดตใน gameState.players ด้วย
    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (gameStatePlayer) {
        gameStatePlayer.socketId = socketId;
    }

    return room;
}

function markPlayerActive(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) {
        return null;
    }

    const player = room.players.find(p => p.playerId === playerId);
    if (player) {
        player.lastActiveAt = nowIso();
        if (player.socketId) {
            player.disconnectedAt = null;
        }
    }

    return room;
}

function syncPlayerProfile(playerId, updates = {}) {
    rooms.forEach(room => {
        const roomPlayer = room.players.find(player => player.playerId === playerId);
        if (roomPlayer) {
            if (updates.playerName !== undefined) roomPlayer.playerName = updates.playerName;
            if (updates.color !== undefined) roomPlayer.color = updates.color;
            if (updates.avatar !== undefined) roomPlayer.avatar = updates.avatar;
            if (updates.avatarFrame !== undefined) roomPlayer.avatarFrame = updates.avatarFrame;
        }

        const gameStatePlayer = room.gameState.players.find(player => player.playerId === playerId);
        if (gameStatePlayer) {
            if (updates.playerName !== undefined) gameStatePlayer.name = updates.playerName;
            if (updates.color !== undefined) gameStatePlayer.color = updates.color;
            if (updates.avatar !== undefined) gameStatePlayer.avatar = updates.avatar;
            if (updates.avatarFrame !== undefined) gameStatePlayer.avatarFrame = updates.avatarFrame;
        }
    });
}

/**
 * ดึง playerId จาก socketId ในห้อง
 */
function getPlayerIdBySocket(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) {
        return null;
    }

    const player = room.players.find(p => p.socketId === socketId);
    return player ? player.playerId : null;
}

function purgeDisconnectedPlayers(maxOfflineMs = 10 * 60 * 1000) {
    const now = Date.now();
    const removedPlayers = [];

    for (const [roomId, room] of rooms.entries()) {
        const stalePlayers = room.players.filter(player => {
            if (player.socketId) return false;

            const referenceTime = player.disconnectedAt || player.lastActiveAt || player.joinedAt;
            if (!referenceTime) return false;

            return (now - new Date(referenceTime).getTime()) >= maxOfflineMs;
        });

        stalePlayers.forEach(player => {
            const roomName = room.name;
            leaveRoom(roomId, player.playerId);
            removedPlayers.push({
                roomId,
                roomName,
                playerId: player.playerId,
                playerName: player.playerName,
                reason: 'offline-timeout'
            });
        });
    }

    return removedPlayers;
}

function reconcileSocketState(activeSocketIds, staleSocketMs = 10 * 60 * 1000) {
    const now = Date.now();
    const affectedPlayers = [];

    for (const [roomId, room] of rooms.entries()) {
        const snapshot = [...room.players];

        snapshot.forEach(player => {
            if (!player.socketId || activeSocketIds.has(player.socketId)) {
                return;
            }

            const referenceTime = player.lastActiveAt || player.joinedAt;
            const ageMs = referenceTime ? (now - new Date(referenceTime).getTime()) : Number.MAX_SAFE_INTEGER;

            if (ageMs >= staleSocketMs) {
                const roomName = room.name;
                leaveRoom(roomId, player.playerId);
                affectedPlayers.push({
                    roomId,
                    roomName,
                    playerId: player.playerId,
                    playerName: player.playerName,
                    reason: 'stale-socket-removed'
                });
            } else {
                disconnectPlayer(roomId, player.playerId);
                affectedPlayers.push({
                    roomId,
                    roomName: room.name,
                    playerId: player.playerId,
                    playerName: player.playerName,
                    reason: 'stale-socket-marked-offline'
                });
            }
        });
    }

    return affectedPlayers;
}

// ========== ADMIN FUNCTIONS ==========

/**
 * บังคับปิดห้อง (Admin)
 */
function forceCloseRoom(roomId) {
    if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        rooms.delete(roomId);
        return { success: true, roomName: room.name, playerCount: room.players.length };
    }
    return { success: false, error: 'Room not found' };
}

/**
 * เตะผู้เล่นออกจากห้อง (Admin)
 */
function adminKickPlayer(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }
    
    const playerIndex = room.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
        return { success: false, error: 'Player not in room' };
    }
    
    const kickedPlayer = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    
    // ลบออกจาก gameState ด้วย
    const gsIndex = room.gameState.players.findIndex(p => p.playerId === playerId);
    if (gsIndex >= 0) {
        room.gameState.players.splice(gsIndex, 1);
    }
    
    // ถ้าเป็น admin ให้โอนให้คนอื่น
    if (room.admin === playerId && room.players.length > 0) {
        room.admin = room.players[0].playerId;
        room.players[0].permission = 'admin';
    }
    
    return { success: true, kickedPlayer: kickedPlayer };
}

/**
 * ปลดล็อคห้อง (Admin)
 */
function unlockRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }
    
    room.settings.locked = false;
    room.settings.password = null;
    return { success: true };
}

/**
 * ล็อคห้อง (Admin)
 */
function lockRoom(roomId, password) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }
    
    room.settings.locked = true;
    room.settings.password = password;
    return { success: true };
}

/**
 * เคลียร์ห้องว่างทั้งหมด (Admin)
 */
function clearEmptyRooms() {
    let clearedCount = 0;
    for (const [roomId, room] of rooms.entries()) {
        if (room.players.length === 0) {
            rooms.delete(roomId);
            clearedCount++;
        }
    }
    return clearedCount;
}

/**
 * เคลียร์ห้องทั้งหมด (Admin) - ใช้ระวัง!
 */
function clearAllRooms() {
    const count = rooms.size;
    rooms.clear();
    return count;
}

/**
 * รีเซ็ตเกมในห้อง (Admin)
 */
function resetRoomGame(roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: 'Room not found' };
    }

    if (room.settings.gameMode === 'werewolf' && room.gameState && Array.isArray(room.gameState.players)) {
        room.lastWerewolfRolesByPlayerId = room.gameState.players.reduce((result, playerState) => {
            if (playerState.role) {
                result[playerState.playerId] = playerState.role;
            }
            return result;
        }, {});
    }

    const gameEngine = getGameEngine(room.settings.gameMode);
    room.gameState = gameEngine.resetRoomGame(room);
    room.rejoinableGamePlayers = new Map();
    
    return { success: true };
}

/**
 * นับจำนวนห้องทั้งหมด
 */
function getRoomCount() {
    return rooms.size;
}

/**
 * ดึงห้องที่กำลังเล่นอยู่
 */
function getActiveRooms() {
    const activeStatuses = ['role', 'word', 'vote1', 'vote2', 'in_progress'];
    return Array.from(rooms.values()).filter(room => 
        activeStatuses.includes(room.gameState.status)
    );
}

module.exports = {
    createRoom,
    joinRoom,
    leaveRoom,
    disconnectPlayer,
    kickPlayer,
    transferAdmin,
    updateRoom,
    getRoom,
    getAllRooms,
    getOnlinePlayerCount,
    updatePlayerSocketId,
    markPlayerActive,
    syncPlayerProfile,
    getPlayerIdBySocket,
    purgeDisconnectedPlayers,
    reconcileSocketState,
    gameMasterRole,
    traitorRole,
    defaultRole,
    // Admin functions
    forceCloseRoom,
    adminKickPlayer,
    unlockRoom,
    lockRoom,
    clearEmptyRooms,
    clearAllRooms,
    resetRoomGame,
    getRoomCount,
    getActiveRooms
};
