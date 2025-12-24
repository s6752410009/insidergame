/**
 * RoomManager - จัดการห้องเกมหลายห้อง
 * - สร้าง/ลบห้อง
 * - จัดการผู้เล่นในห้อง
 * - แยก game state ต่อห้อง
 */

const { v4: uuidv4 } = require('uuid');
const playerManager = require('./playerManager');

// เก็บห้องทั้งหมด (key: roomId, value: room object)
const rooms = new Map();

// Game Master Role constant
const gameMasterRole = 'ผู้ดำเนินเกม';
const traitorRole = 'ผู้ทรยศ';
const defaultRole = 'พลเมือง';

/**
 * สร้างห้องใหม่
 */
function createRoom(roomData, creatorPlayerId) {
    const roomId = uuidv4().substring(0, 8); // ใช้ 8 ตัวแรกของ UUID เป็น roomId
    const creator = playerManager.getPlayer(creatorPlayerId);
    
    if (!creator) {
        throw new Error('Creator player not found');
    }

    const room = {
        roomId,
        name: roomData.name || `ห้อง ${roomId}`,
        players: [], // Array of { playerId, playerName, color, socketId, permission }
        admin: creatorPlayerId, // playerId ของ admin
        settings: {
            maxPlayers: roomData.maxPlayers || 5,
            roundTime: (roomData.roundTime || 5) * 60, // แปลงนาทีเป็นวินาที
            traitorOptional: roomData.traitorOptional !== undefined ? roomData.traitorOptional : true,
            locked: roomData.locked || false,
            password: roomData.password || null
        },
        // Game state (clone จากโครงสร้างเดิม)
        gameState: {
            players: [], // Array of player objects with role, vote1, vote2, etc.
            word: '',
            countdown: null,
            resultVote1: null,
            resultVote2: null,
            status: '', // '', 'role', 'word', 'vote1', 'vote2', 'in_progress', 'end'
            lastAction: 0
        },
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
        }
        return room;
    }

    // เพิ่มผู้เล่นใหม่
    room.players.push({
        playerId: player.playerId,
        playerName: player.playerName,
        color: player.color,
        socketId: socketId,
        permission: playerId === room.admin ? 'admin' : null
    });

    // เพิ่มใน gameState.players ด้วย (สำหรับเกม)
    // Bug #5 Fix: เพิ่ม socketId เพื่อใช้เช็คว่า online หรือไม่
    room.gameState.players.push({
        playerId: player.playerId,
        socketId: socketId,
        name: player.playerName,
        role: '',
        vote1: null,
        vote2: null,
        nbVote2: 0,
        isGhost: false,
        permission: playerId === room.admin ? 'admin' : null
    });

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
    
    // ลบผู้เล่นออก
    room.players.splice(playerIndex, 1);
    
    // ลบออกจาก gameState.players ด้วย
    const gameStatePlayerIndex = room.gameState.players.findIndex(p => p.playerId === playerId);
    if (gameStatePlayerIndex >= 0) {
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
        room.settings.maxPlayers = updates.maxPlayers;
    }

    if (updates.roundTime !== undefined) {
        room.settings.roundTime = updates.roundTime * 60; // แปลงนาทีเป็นวินาที
    }

    if (updates.traitorOptional !== undefined) {
        room.settings.traitorOptional = updates.traitorOptional;
    }

    if (updates.locked !== undefined) {
        room.settings.locked = updates.locked;
        room.settings.password = updates.password || null;
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
        // ตรวจสอบสถานะเกม: ถ้า status ไม่ใช่ '' หรือเป็น role, word, vote1, vote2, in_progress = กำลังเล่น
        const inGameStatuses = ['role', 'word', 'vote1', 'vote2', 'in_progress'];
        const isInGame = inGameStatuses.includes(room.gameState.status);
        
        return {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.length, // นับผู้เล่นทั้งหมด ไม่ว่าจะมี socketId หรือไม่
            maxPlayers: room.settings.maxPlayers,
            locked: room.settings.locked,
            admin: room.admin,
            gameStatus: isInGame ? 'playing' : 'waiting' // เพิ่มสถานะเกม
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
    }

    // Bug #5 Fix: อัปเดตใน gameState.players ด้วย
    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (gameStatePlayer) {
        gameStatePlayer.socketId = socketId;
    }

    return room;
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
    
    room.gameState = {
        players: room.players.map(p => ({
            playerId: p.playerId,
            name: p.playerName,
            color: p.color,
            permission: p.permission,
            role: '',
            vote1: null,
            vote2: null,
            nbVote2: 0,        // Bug #7 Fix: เพิ่ม nbVote2
            isGhost: false,    // Bug #7 Fix: เพิ่ม isGhost
            hasVoted1: false,
            hasVoted2: false
        })),
        word: '',
        countdown: null,
        resultVote1: null,
        resultVote2: null,
        status: '',
        lastAction: 0
    };
    
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
    updatePlayerSocketId,
    getPlayerIdBySocket,
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
