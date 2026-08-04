/**
 * RoomManager - จัดการห้องเกมหลายห้อง
 * - สร้าง/ลบห้อง
 * - จัดการผู้เล่นในห้อง
 * - แยก game state ต่อห้อง
 */

const playerManager = require('./playerManager');
const { normalizeGameMode, getGameEngine } = require('../games/engineRegistry');
const gameSettingsManager = require('./gameSettingsManager');
const fs = require('fs');
const path = require('path');

// เก็บห้องทั้งหมด (key: roomId, value: room object)
const rooms = new Map();
const { ROOMS_FILE } = require('./dataPaths');
let persistTimer = null;
let persistQueued = false;
let useDatabase = false;
let RoomSnapshot = null;

try {
    ({ RoomSnapshot } = require('./models'));
} catch (error) {
    RoomSnapshot = null;
}

// Game Master Role constant
const gameMasterRole = 'ผู้ดำเนินเกม';
const traitorRole = 'จอมบงการ';
const defaultRole = 'พลเมือง';

function nowIso() {
    return new Date().toISOString();
}

function normalizeRoomId(roomId) {
    if (roomId == null) return null;
    const normalized = String(roomId).trim();
    return normalized || null;
}

function getMappedRoom(roomId) {
    const id = normalizeRoomId(roomId);
    if (!id) return null;
    return rooms.get(id) || null;
}

// ห้องที่ตั้งใจลบจริงๆ — ใช้สั่งลบใน Mongo แบบเจาะจง
// ห้ามลบด้วย "อะไรที่ไม่อยู่ใน memory ฉัน" เพราะถ้าโหลดพลาดหรือมีหลาย instance
// จะกวาดห้องของคนอื่นทิ้งหมด
const pendingRoomDeletes = new Set();

function deleteMappedRoom(roomId) {
    const id = normalizeRoomId(roomId);
    if (!id) return false;
    const removed = rooms.delete(id);
    if (removed) {
        pendingRoomDeletes.add(id);
    }
    return removed;
}

function schedulePersistRooms() {
    persistQueued = true;
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        if (!persistQueued) return;
        persistQueued = false;
        persistRooms().catch(error => {
            console.error('[RoomManager] Failed to persist rooms:', error.message);
        });
    }, 250);
}

function flushPersistRooms() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    persistQueued = false;
    return persistRooms().catch(error => {
        console.error('[RoomManager] Failed to persist rooms:', error.message);
    });
}

function serializeRoom(room) {
    return {
        roomId: room.roomId,
        name: room.name,
        players: (room.players || []).map(player => ({
            ...player,
            socketId: null,
            disconnectedAt: player.disconnectedAt || nowIso()
        })),
        admin: room.admin,
        settings: room.settings,
        gameState: room.gameState,
        chatHistory: Array.isArray(room.chatHistory) ? room.chatHistory.slice(-80) : [],
        rejoinableGamePlayers: room.rejoinableGamePlayers instanceof Map
            ? Array.from(room.rejoinableGamePlayers.entries())
            : [],
        createdAt: room.createdAt || nowIso(),
        zeroOnlineSince: room.zeroOnlineSince || nowIso(),
        lastAbandonedAt: room.lastAbandonedAt || null
    };
}

function hydrateRoom(raw) {
    if (!raw || !raw.roomId) return null;
    const room = {
        ...raw,
        roomId: String(raw.roomId),
        players: Array.isArray(raw.players) ? raw.players.map(player => ({
            ...player,
            socketId: null
        })) : [],
        chatHistory: Array.isArray(raw.chatHistory) ? raw.chatHistory : [],
        rejoinableGamePlayers: new Map(Array.isArray(raw.rejoinableGamePlayers) ? raw.rejoinableGamePlayers : []),
        createdAt: raw.createdAt || nowIso(),
        zeroOnlineSince: raw.zeroOnlineSince || nowIso()
    };
    return room;
}

function persistRoomsToFileSync(payload) {
    const directory = path.dirname(ROOMS_FILE);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = `${ROOMS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporaryFile, ROOMS_FILE);
}

async function persistRooms() {
    const payload = Array.from(rooms.values()).map(serializeRoom);

    if (useDatabase && RoomSnapshot) {
        const ops = payload.map(room => ({
            updateOne: {
                filter: { roomId: room.roomId },
                update: {
                    $set: {
                        roomId: room.roomId,
                        payload: room,
                        updatedAt: new Date()
                    }
                },
                upsert: true
            }
        }));

        if (ops.length > 0) {
            await RoomSnapshot.bulkWrite(ops, { ordered: false });
        }

        // ลบเฉพาะห้องที่เราสั่งลบเอง — เดิมใช้ $nin keepIds และ deleteMany({})
        // ซึ่งจะกวาดห้องทั้งคอลเลกชันทิ้งถ้า loadPersistedRooms พังจน rooms ว่าง
        // หรือกวาดห้องของอีก instance ทิ้งตอน rolling deploy
        if (pendingRoomDeletes.size > 0) {
            const idsToDelete = Array.from(pendingRoomDeletes);
            pendingRoomDeletes.clear();
            try {
                await RoomSnapshot.deleteMany({ roomId: { $in: idsToDelete } });
            } catch (error) {
                // ลบไม่สำเร็จก็เอากลับเข้าคิว ไว้ลองใหม่รอบหน้า
                idsToDelete.forEach(id => pendingRoomDeletes.add(id));
                throw error;
            }
        }
        return payload.length;
    }

    pendingRoomDeletes.clear();

    persistRoomsToFileSync(payload);
    return payload.length;
}

function loadRoomsFromFile() {
    if (!fs.existsSync(ROOMS_FILE)) {
        return [];
    }
    const raw = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : Object.values(raw || {});
}

async function loadPersistedRooms() {
    rooms.clear();
    // คิวลบค้างจากรอบก่อนต้องล้าง ไม่งั้นห้องที่เพิ่งกู้คืนมาอาจโดนลบตาม
    pendingRoomDeletes.clear();
    let stored = [];

    if (useDatabase && RoomSnapshot) {
        const docs = await RoomSnapshot.find({}).lean();
        stored = docs.map(doc => doc.payload).filter(Boolean);
        console.log(`📁 RoomManager restored ${stored.length} room(s) from MongoDB`);
    } else {
        try {
            stored = loadRoomsFromFile();
            console.log(stored.length
                ? `📁 RoomManager restored ${stored.length} room(s) from disk`
                : '📁 RoomManager: no rooms.json yet');
        } catch (error) {
            console.error('[RoomManager] Could not read rooms.json:', error.message);
            stored = [];
        }
    }

    stored.forEach(entry => {
        const room = hydrateRoom(entry);
        if (room?.roomId) {
            rooms.set(room.roomId, room);
        }
    });
    return rooms.size;
}

async function initRoomManager() {
    try {
        const { isDBConnected } = require('./database');
        useDatabase = Boolean(RoomSnapshot && isDBConnected());
    } catch (error) {
        useDatabase = false;
    }

    if (useDatabase) {
        console.log('✅ RoomManager using MongoDB');
    } else {
        console.log('📁 RoomManager using JSON file fallback');
    }

    return loadPersistedRooms();
}

const FINISHED_GAME_STATUSES = new Set([
    'werewolf_finished',
    'blackmarket_finished',
    'spyfall_finished',
    'end',
    'finished'
]);

const ROOM_NAME_MODE_HINTS = {
    'วงจับจอมบงการ': 'insider',
    'ตลาดมืดคืนนี้': 'blackmarket',
    'คืนล่าหมาป่า': 'werewolf',
    'วงสายลับสถานที่': 'spyfall'
};

function inferGameModeFromRoomData(roomData) {
    const requestedMode = normalizeGameMode(roomData?.gameMode || 'insider');
    const roomName = String(roomData?.name || '').trim();
    const hintedMode = ROOM_NAME_MODE_HINTS[roomName];

    if (!hintedMode) {
        return requestedMode;
    }

    const normalizedHint = normalizeGameMode(hintedMode);
    if (requestedMode === 'insider' && normalizedHint !== 'insider') {
        return normalizedHint;
    }

    return requestedMode;
}

const WAITING_GAME_STATUSES = new Set(['', 'waiting']);

function getOnlinePlayerCount(room) {
    return room.players.filter(player => !!player.socketId).length;
}

function isPlayerOnlineInRoom(room, playerId) {
    const player = room?.players?.find(entry => entry.playerId === playerId);
    return !!(player && player.socketId);
}

function isRoomGameFinished(room) {
    if (!room?.gameState) {
        return false;
    }

    const status = room.gameState.status || '';
    return FINISHED_GAME_STATUSES.has(status) || !!room.gameState.winner;
}

function isRoomGameInProgress(room) {
    if (!room?.gameState) {
        return false;
    }

    const status = room.gameState.status || '';
    if (!status || WAITING_GAME_STATUSES.has(status)) {
        return false;
    }

    return !isRoomGameFinished(room);
}

/** @deprecated use isRoomGameInProgress */
function isRoomGameActive(room) {
    return isRoomGameInProgress(room);
}

function getRoomGameStatusLabel(room) {
    if (isRoomGameInProgress(room)) {
        return 'playing';
    }
    if (isRoomGameFinished(room)) {
        return 'finished';
    }
    return 'waiting';
}

function normalizeTableMode(tableMode) {
    return tableMode === 'remote' ? 'remote' : 'inPerson';
}

function applySmokeFastMs(ms) {
    if (process.env.SMOKE_FAST_CLEANUP === '1') {
        return Math.min(ms, 2500);
    }
    return ms;
}

function getOfflineGraceMs(room) {
    const base = normalizeTableMode(room?.settings?.tableMode) === 'remote'
        ? 10 * 60 * 1000
        : 2 * 60 * 1000;
    return applySmokeFastMs(base);
}

function getAbandonGraceMs(room) {
    const base = normalizeTableMode(room?.settings?.tableMode) === 'remote'
        ? 5 * 60 * 1000
        : 3 * 60 * 1000;
    return applySmokeFastMs(base);
}

function getDisconnectRemoveMs(room) {
    const base = normalizeTableMode(room?.settings?.tableMode) === 'remote'
        ? 5 * 60 * 1000
        : 3 * 60 * 1000;
    let removeMs = applySmokeFastMs(base);
    // ห้องเพิ่งสร้าง: อย่าลบผู้สร้างตอนกำลัง navigate /rooms → /room
    const createdAtMs = new Date(room?.createdAt || 0).getTime();
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
        const ageMs = Date.now() - createdAtMs;
        const protectMs = applySmokeFastMs(2 * 60 * 1000);
        if (ageMs < protectMs) {
            removeMs = Math.max(removeMs, protectMs - ageMs);
        }
    }
    return removeMs;
}

// เวลาที่ห้อง "ว่าง" (ไม่มีใครออนไลน์) แล้วยังไม่ได้เริ่มเกม ก่อนจะถูกเก็บกวาด
// เผื่อเวลาให้ reload หน้า / เดินทางจาก lobby ไปกระดานเกมได้ทัน
function getEmptyRoomGraceMs(room) {
    const base = normalizeTableMode(room?.settings?.tableMode) === 'remote'
        ? 10 * 60 * 1000
        : 5 * 60 * 1000;
    const grace = applySmokeFastMs(base);
    // ห้องเพิ่งสร้าง: อย่าเก็บกวาดตอนผู้สร้างกำลัง navigate จาก /rooms → /room
    const createdAtMs = new Date(room?.createdAt || 0).getTime();
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
        const ageMs = Date.now() - createdAtMs;
        const protectMs = applySmokeFastMs(2 * 60 * 1000);
        if (ageMs < protectMs) {
            return Math.max(grace, protectMs - ageMs);
        }
    }
    return grace;
}

function syncZeroOnlineTracker(room) {
    if (!room) {
        return;
    }

    if (getOnlinePlayerCount(room) > 0) {
        room.zeroOnlineSince = null;
        return;
    }

    // ติดตามทุกห้องที่ไม่มีคนออนไลน์ ไม่ใช่เฉพาะห้องที่กำลังเล่น/จบเกม —
    // เดิมห้องที่ยังรอเริ่มเกมถูกล้าง zeroOnlineSince ทุกรอบ ทำให้ไม่เคยเข้าเงื่อนไข
    // abandon เลย ห้องร้างจึงค้างอยู่จนกว่าผู้เล่นออฟไลน์จะหมดอายุทีละคน
    if (!room.zeroOnlineSince) {
        room.zeroOnlineSince = nowIso();
    }
}

function isRoomJoinable(room, options = {}) {
    if (!room) {
        return false;
    }

    const existingPlayerIndex = room.players.findIndex(player => player.playerId === options.playerId);
    if (existingPlayerIndex >= 0) {
        return true;
    }

    if (room.players.length >= room.settings.maxPlayers) {
        return false;
    }

    return !isRoomGameInProgress(room);
}

function clampMaxPlayers(gameEngine, requestedMaxPlayers, currentPlayers = 0) {
    const minPlayers = Number(gameEngine?.minPlayers || 3);
    const maxPlayers = Number(gameEngine?.maxPlayers || 10);
    const normalizedRequested = Number(requestedMaxPlayers) || Math.max(minPlayers, currentPlayers, 5);
    return Math.max(Math.max(minPlayers, currentPlayers), Math.min(maxPlayers, normalizedRequested));
}

/**
 * สุ่ม Room ID เป็นตัวเลข 6 หลัก (อ่าน/พิมพ์/บอกต่อง่ายกว่า hex เดิม)
 * วนสุ่มจนกว่าจะไม่ชนกับห้องที่มีอยู่ — พื้นที่ 900,000 เลข ชนกันยากมาก
 */
function generateRoomId() {
    let roomId;
    do {
        roomId = String(Math.floor(100000 + Math.random() * 900000));
    } while (rooms.has(roomId));
    return roomId;
}

/**
 * สร้างห้องใหม่
 */
function createRoom(roomData, creatorPlayerId) {
    const normalizedRoomData = gameSettingsManager.applyCreateRoomDefaults(roomData || {});
    const roomId = generateRoomId();
    const creator = playerManager.getPlayer(creatorPlayerId);
    const gameMode = inferGameModeFromRoomData(normalizedRoomData);
    const gameEngine = getGameEngine(gameMode);
    
    if (!creator) {
        throw new Error('Creator player not found');
    }

    const hasExplicitWerewolfRoles = gameMode === 'werewolf'
        && Array.isArray(normalizedRoomData.werewolfRoles)
        && normalizedRoomData.werewolfRoles.length > 0;
    const werewolfRoles = gameMode === 'werewolf'
        ? (hasExplicitWerewolfRoles && typeof gameEngine.sanitizeRoleSelection === 'function'
            ? gameEngine.sanitizeRoleSelection(normalizedRoomData.werewolfRoles)
            : [])
        : undefined;
    const wolfCount = gameMode === 'werewolf'
        ? (hasExplicitWerewolfRoles
            ? null
            : Math.min(Math.max(1, Number(normalizedRoomData.wolfCount) || 2), 3))
        : null;
    const spyfallVoteMinutes = gameMode === 'spyfall'
        ? Math.min(10, Math.max(0.5, Number(normalizedRoomData.spyfallVoteMinutes) || 1.5))
        : null;

    const room = {
        roomId,
        name: normalizedRoomData.name || `ห้อง ${roomId}`,
        players: [], // Array of { playerId, playerName, color, socketId, permission }
        admin: creatorPlayerId, // playerId ของ admin
        settings: {
            gameMode,
            maxPlayers: clampMaxPlayers(gameEngine, normalizedRoomData.maxPlayers, 1),
            roundTime: gameMode === 'werewolf' ? 5 * 60 : (Number(normalizedRoomData.roundTime) || 5) * 60,
            traitorOptional: normalizedRoomData.traitorOptional !== undefined ? normalizedRoomData.traitorOptional : true,
            dualTraitorMode: normalizedRoomData.dualTraitorMode || false,
            spyfallVoteSeconds: spyfallVoteMinutes != null ? Math.round(spyfallVoteMinutes * 60) : 90,
            werewolfRoles,
            wolfCount,
            locked: normalizedRoomData.locked || false,
            password: normalizedRoomData.password || null,
            tableMode: normalizeTableMode(normalizedRoomData.tableMode)
        },
        gameState: gameEngine.createInitialState(),
        chatHistory: [],
        rejoinableGamePlayers: new Map(),
        createdAt: new Date().toISOString()
    };

    rooms.set(roomId, room);
    
    // เพิ่มผู้สร้างเป็นผู้เล่นคนแรก
    joinRoom(roomId, creatorPlayerId, null, normalizedRoomData.password);
    flushPersistRooms();
    
    return room;
}

/**
 * เข้าห้อง
 */
function joinRoom(roomId, playerId, socketId = null, password = null, options = {}) {
    roomId = normalizeRoomId(roomId);
    const room = getMappedRoom(roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    // ตรวจสอบรหัสผ่าน
    if (room.settings.locked && !options.bypassLock && room.settings.password !== password) {
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
    const rejoinableGamePlayer = room.rejoinableGamePlayers instanceof Map
        ? room.rejoinableGamePlayers.get(playerId)
        : null;
    
    // ตรวจสอบว่าห้องเต็มหรือยัง (ยกเว้นกรณี reconnect)
    if (!isReconnecting) {
        const currentPlayerCount = room.players.length;
        if (currentPlayerCount >= room.settings.maxPlayers) {
            throw new Error('Room is full');
        }

        if (isRoomGameInProgress(room) && !rejoinableGamePlayer) {
            throw new Error('เกมกำลังดำเนินอยู่ ไม่สามารถเข้าร่วมได้');
        }
    }
    if (existingPlayerIndex >= 0) {
        // อัปเดต socketId ถ้ามี
        if (socketId) {
            room.players[existingPlayerIndex].socketId = socketId;
            room.players[existingPlayerIndex].lastActiveAt = nowIso();
            room.players[existingPlayerIndex].disconnectedAt = null;
        }
        syncZeroOnlineTracker(room);
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

    syncZeroOnlineTracker(room);
    schedulePersistRooms();
    return room;
}

/**
 * ผู้เล่น disconnect (แค่เคลียร์ socketId ไม่ลบออกจากห้อง)
 * ใช้เมื่อ socket disconnect เพื่อรอให้ผู้เล่น reconnect
 * Bug #5 Fix: อัปเดตทั้งใน room.players และ room.gameState.players
 */
function disconnectPlayer(roomId, playerId) {
    const room = getMappedRoom(roomId);
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

    syncZeroOnlineTracker(room);
    schedulePersistRooms();
    return room;
}

/**
 * ออกจากห้อง (ลบผู้เล่นออกจริงๆ)
 */
function leaveRoom(roomId, playerId) {
    const room = getMappedRoom(roomId);
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
        // ช่วง transition หลัง start อาจยังไม่ถูกนับเป็น in-progress ทั้งที่แจก role แล้ว
        // เก็บ snapshot เมื่อมี role ด้วย เพื่อให้ explicit leave/rejoin ไม่ทำ role หายจาก race นี้
        const gameStatePlayer = room.gameState.players[gameStatePlayerIndex];
        const hasAssignedGameRole = !!(gameStatePlayer.role || gameStatePlayer.roleInfo);
        if (wasGameActive || hasAssignedGameRole) {
            if (!(room.rejoinableGamePlayers instanceof Map)) {
                room.rejoinableGamePlayers = new Map();
            }

            room.rejoinableGamePlayers.set(playerId, {
                ...gameStatePlayer,
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

    // ถ้าไม่มีผู้เล่นแล้ว อย่าลบห้องทันที
    // create → navigate / disconnect ช่วงสั้นๆ เคยทำให้ room_not_found
    // เก็บเปล่าไว้ให้ grace แล้วให้ sweep ลบ
    if (room.players.length === 0) {
        room.zeroOnlineSince = room.zeroOnlineSince || nowIso();
        schedulePersistRooms();
        return null;
    }

    syncZeroOnlineTracker(room);
    schedulePersistRooms();
    return room;
}

/**
 * เตะผู้เล่น
 */
function kickPlayer(roomId, adminPlayerId, targetPlayerId) {
    const room = getMappedRoom(roomId);
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
    const room = getMappedRoom(roomId);
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
    const room = getMappedRoom(roomId);
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
    
    // อัปเดตโหมด 2 จอมบงการ (ต้องมีผู้เล่น 5+ คนถึงจะเปิดได้)
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

    if (updates.tableMode !== undefined) {
        room.settings.tableMode = normalizeTableMode(updates.tableMode);
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
    return getMappedRoom(roomId);
}

/**
 * ดึงรายการห้องทั้งหมด (สำหรับ Room List)
 */
function getAllRooms() {
    return Array.from(rooms.values())
        .filter(room => Array.isArray(room.players) && room.players.length > 0)
        .map(room => {
        const gameEngine = getGameEngine(room.settings.gameMode);
        const onlineCount = getOnlinePlayerCount(room);
        const gameStatus = getRoomGameStatusLabel(room);
        const isStuck = gameStatus === 'playing' && onlineCount === 0;

        return {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.length,
            onlineCount,
            totalPlayerCount: room.players.length,
            maxPlayers: room.settings.maxPlayers,
            locked: room.settings.locked,
            admin: room.admin,
            gameMode: room.settings.gameMode,
            gameModeLabel: gameEngine.label,
            gameStatus,
            isJoinable: isRoomJoinable(room),
            isStuck,
            settings: {
                gameMode: room.settings.gameMode,
                dualTraitorMode: room.settings.dualTraitorMode || false,
                tableMode: normalizeTableMode(room.settings.tableMode)
            }
        };
    });
}

/**
 * อัปเดต socketId ของผู้เล่น (เมื่อ reconnect)
 * อัปเดตทั้งใน room.players และ room.gameState.players
 */
function updatePlayerSocketId(roomId, playerId, socketId) {
    const room = getMappedRoom(roomId);
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

    syncZeroOnlineTracker(room);
    return room;
}

function markPlayerActive(roomId, playerId) {
    const room = getMappedRoom(roomId);
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
    const room = getMappedRoom(roomId);
    if (!room) {
        return null;
    }

    const player = room.players.find(p => p.socketId === socketId);
    return player ? player.playerId : null;
}

function purgeDisconnectedPlayers(defaultMaxOfflineMs = 10 * 60 * 1000) {
    const now = Date.now();
    const removedPlayers = [];

    for (const [roomId, room] of rooms.entries()) {
        const maxOfflineMs = getOfflineGraceMs(room) || defaultMaxOfflineMs;
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

function reconcileSocketState(activeSocketIds, defaultStaleSocketMs = 10 * 60 * 1000) {
    const now = Date.now();
    const affectedPlayers = [];

    for (const [roomId, room] of rooms.entries()) {
        const staleSocketMs = getOfflineGraceMs(room) || defaultStaleSocketMs;
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

function collectAbandonCandidates() {
    const now = Date.now();
    const candidates = [];

    for (const [roomId, room] of rooms.entries()) {
        syncZeroOnlineTracker(room);

        // ห้องว่างเปล่า (ไม่มีผู้เล่นแล้ว) ก็เข้าเกณฑ์ลบหลัง grace
        if (room.players.length === 0) {
            const emptySinceMs = new Date(room.zeroOnlineSince || room.createdAt || 0).getTime();
            const graceMs = getEmptyRoomGraceMs(room);
            if (Number.isFinite(emptySinceMs) && (now - emptySinceMs) >= graceMs) {
                candidates.push({ roomId, roomName: room.name, gameMode: room.settings?.gameMode });
            }
            continue;
        }

        if (getOnlinePlayerCount(room) > 0 || !room.zeroOnlineSince) {
            continue;
        }

        const graceMs = (isRoomGameInProgress(room) || isRoomGameFinished(room))
            ? getAbandonGraceMs(room)
            : getEmptyRoomGraceMs(room);

        if ((now - new Date(room.zeroOnlineSince).getTime()) < graceMs) {
            continue;
        }

        candidates.push({ roomId, roomName: room.name, gameMode: room.settings.gameMode });
    }

    return candidates;
}

function removeOfflinePlayers(roomId) {
    const removed = [];
    const room = getMappedRoom(roomId);
    if (!room) {
        return removed;
    }

    const offlineIds = room.players.filter(player => !player.socketId).map(player => player.playerId);
    offlineIds.forEach(playerId => {
        const player = room.players.find(entry => entry.playerId === playerId);
        leaveRoom(roomId, playerId);
        if (player) {
            removed.push(player);
        }
    });

    return removed;
}

function finalizeAbandonedRoom(roomId) {
    const room = getMappedRoom(roomId);
    if (!room) {
        return { room: null, removedPlayers: [] };
    }

    if (isRoomGameInProgress(room) || isRoomGameFinished(room)) {
        resetRoomGame(roomId);
    }

    const removedPlayers = removeOfflinePlayers(roomId);
    const refreshedRoom = getMappedRoom(roomId);
    if (!refreshedRoom || refreshedRoom.players.length === 0) {
        deleteMappedRoom(roomId);
        schedulePersistRooms();
        return { room: null, removedPlayers };
    }

    refreshedRoom.zeroOnlineSince = null;
    refreshedRoom.lastAbandonedAt = nowIso();
    syncZeroOnlineTracker(refreshedRoom);
    schedulePersistRooms();

    return {
        room: refreshedRoom,
        removedPlayers
    };
}

function endTableSession(roomId, adminPlayerId) {
    const room = getMappedRoom(roomId);
    if (!room) {
        throw new Error('Room not found');
    }

    if (room.admin !== adminPlayerId) {
        throw new Error('Only room admin can end the game session');
    }

    if (isRoomGameInProgress(room) || isRoomGameFinished(room)) {
        resetRoomGame(roomId);
    }

    const removedPlayers = removeOfflinePlayers(roomId);
    const refreshedRoom = getMappedRoom(roomId);
    if (refreshedRoom) {
        refreshedRoom.zeroOnlineSince = null;
    }

    return {
        room: refreshedRoom,
        removedPlayers
    };
}

function forEachRoom(callback) {
    rooms.forEach((room, roomId) => callback(room, roomId));
}

// ========== ADMIN FUNCTIONS ==========

/**
 * บังคับปิดห้อง (Admin)
 */
function forceCloseRoom(roomId) {
    if (rooms.has(roomId)) {
        const room = getMappedRoom(roomId);
        deleteMappedRoom(roomId);
        schedulePersistRooms();
        return { success: true, roomName: room.name, playerCount: room.players.length };
    }
    return { success: false, error: 'Room not found' };
}

/**
 * เตะผู้เล่นออกจากห้อง (Admin)
 */
function adminKickPlayer(roomId, playerId) {
    const room = getMappedRoom(roomId);
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
    const room = getMappedRoom(roomId);
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
    const room = getMappedRoom(roomId);
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
        const hasNoPlayers = room.players.length === 0;
        const hasNoOnlineWhileIdle = getOnlinePlayerCount(room) === 0
            && !isRoomGameInProgress(room)
            && room.players.length > 0
            && room.zeroOnlineSince
            && ((Date.now() - new Date(room.zeroOnlineSince).getTime()) >= 30 * 60 * 1000);

        if (hasNoPlayers || hasNoOnlineWhileIdle) {
            deleteMappedRoom(roomId);
            clearedCount++;
        }
    }
    if (clearedCount > 0) {
        schedulePersistRooms();
    }
    return clearedCount;
}

/**
 * เคลียร์ห้องทั้งหมด (Admin) - ใช้ระวัง!
 */
function clearAllRooms() {
    const count = rooms.size;
    // ต้องเข้าคิวลบทีละห้อง ไม่งั้นห้องจะหายจาก memory แต่ค้างอยู่ใน Mongo
    Array.from(rooms.keys()).forEach(roomId => pendingRoomDeletes.add(roomId));
    rooms.clear();
    schedulePersistRooms();
    return count;
}

/**
 * รีเซ็ตเกมในห้อง (Admin)
 */
function resetRoomGame(roomId) {
    const room = getMappedRoom(roomId);
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
    room.zeroOnlineSince = null;

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
    initRoomManager,
    schedulePersistRooms,
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
    isPlayerOnlineInRoom,
    isRoomGameInProgress,
    isRoomGameFinished,
    getRoomGameStatusLabel,
    isRoomJoinable,
    getOfflineGraceMs,
    getAbandonGraceMs,
    getDisconnectRemoveMs,
    updatePlayerSocketId,
    markPlayerActive,
    syncPlayerProfile,
    getPlayerIdBySocket,
    purgeDisconnectedPlayers,
    reconcileSocketState,
    collectAbandonCandidates,
    finalizeAbandonedRoom,
    endTableSession,
    removeOfflinePlayers,
    forEachRoom,
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
