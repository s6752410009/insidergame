/**
 * PlayerManager - จัดการข้อมูลผู้เล่นและ identity
 * รองรับทั้ง MongoDB และ JSON fallback
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Try to load MongoDB models
let Player, BannedPlayer, useDatabase = false;
try {
    const models = require('./models');
    Player = models.Player;
    BannedPlayer = models.BannedPlayer;
} catch (e) {
    console.log('Models not loaded, will use JSON fallback');
}

const PLAYERS_FILE = path.join(__dirname, '../data/players.json');
const BANNED_FILE = path.join(__dirname, '../data/bannedPlayers.json');

// Memory cache
const players = new Map();
const bannedPlayers = new Map();

// สีที่ใช้ได้
const AVAILABLE_COLORS = [
    '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c',
    '#e67e22', '#e91e63', '#ffeb3b', '#00bcd4', '#ff5722', '#8e44ad'
];

// Create data directory
const dataDir = path.dirname(PLAYERS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ============ Initialize ============
async function initPlayerManager() {
    // Check if MongoDB is available
    if (process.env.MONGO_URL && Player) {
        try {
            const { connectDB, isDBConnected } = require('./database');
            await connectDB();
            if (isDBConnected()) {
                useDatabase = true;
                console.log('✅ PlayerManager using MongoDB');
                await loadPlayersFromDB();
                await loadBannedFromDB();
                return;
            }
        } catch (e) {
            console.log('MongoDB not available:', e.message);
        }
    }
    
    // Fallback to JSON
    useDatabase = false;
    console.log('📁 PlayerManager using JSON files');
    loadPlayersFromFile();
    loadBannedFromFile();
}

// ============ Load Functions ============
async function loadPlayersFromDB() {
    try {
        const dbPlayers = await Player.find({});
        players.clear();
        dbPlayers.forEach(p => {
            players.set(p.playerId, {
                playerId: p.playerId,
                playerName: p.playerName,
                color: p.color,
                createdAt: p.createdAt,
                lastSeen: p.lastSeen
            });
        });
        console.log(`Loaded ${players.size} players from MongoDB`);
    } catch (e) {
        console.error('Error loading from MongoDB:', e.message);
    }
}

async function loadBannedFromDB() {
    try {
        const dbBanned = await BannedPlayer.find({});
        bannedPlayers.clear();
        dbBanned.forEach(b => {
            bannedPlayers.set(b.playerId, {
                playerId: b.playerId,
                playerName: b.playerName,
                reason: b.reason,
                bannedAt: b.bannedAt,
                bannedBy: b.bannedBy,
                expiresAt: b.expiresAt,
                isPermanent: b.isPermanent,
                durationHours: b.durationHours
            });
        });
        console.log(`Loaded ${bannedPlayers.size} banned players from MongoDB`);
    } catch (e) {
        console.error('Error loading banned from MongoDB:', e.message);
    }
}

function loadPlayersFromFile() {
    if (fs.existsSync(PLAYERS_FILE)) {
        try {
            const data = fs.readFileSync(PLAYERS_FILE, 'utf8');
            const playersData = JSON.parse(data);
            for (const [playerId, player] of Object.entries(playersData)) {
                players.set(playerId, player);
            }
            console.log(`Loaded ${players.size} players from file`);
        } catch (error) {
            console.error('Error loading players:', error);
        }
    }
}

function loadBannedFromFile() {
    if (fs.existsSync(BANNED_FILE)) {
        try {
            const data = fs.readFileSync(BANNED_FILE, 'utf8');
            const bannedData = JSON.parse(data);
            for (const [playerId, banInfo] of Object.entries(bannedData)) {
                bannedPlayers.set(playerId, banInfo);
            }
            console.log(`Loaded ${bannedPlayers.size} banned players`);
        } catch (error) {
            console.error('Error loading banned players:', error);
        }
    }
}

// ============ Save Functions ============
async function savePlayers() {
    if (useDatabase && Player) {
        return;
    }
    try {
        const playersData = {};
        for (const [playerId, player] of players.entries()) {
            playersData[playerId] = player;
        }
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playersData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving players:', error);
    }
}

async function saveBannedPlayers() {
    if (useDatabase && BannedPlayer) {
        return;
    }
    try {
        const bannedData = {};
        for (const [playerId, banInfo] of bannedPlayers.entries()) {
            bannedData[playerId] = banInfo;
        }
        fs.writeFileSync(BANNED_FILE, JSON.stringify(bannedData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving banned players:', error);
    }
}

// ============ Helper Functions ============
function generateRandomName() {
    const randomNum = Math.floor(Math.random() * 1000000);
    return `guest${randomNum}`;
}

function getRandomColor() {
    return AVAILABLE_COLORS[Math.floor(Math.random() * AVAILABLE_COLORS.length)];
}

// ============ Player Functions ============
async function createOrGetPlayer(playerId = null) {
    if (playerId && players.has(playerId)) {
        const player = players.get(playerId);
        player.lastSeen = new Date().toISOString();
        
        if (useDatabase && Player) {
            await Player.updateOne({ playerId }, { lastSeen: new Date() });
        } else {
            savePlayers();
        }
        return player;
    }

    const newPlayerId = playerId || uuidv4();
    const newPlayer = {
        playerId: newPlayerId,
        playerName: generateRandomName(),
        color: getRandomColor(),
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
    };

    players.set(newPlayerId, newPlayer);
    
    if (useDatabase && Player) {
        try {
            await Player.create(newPlayer);
        } catch (e) {
            if (e.code !== 11000) console.error('Error creating player in DB:', e.message);
        }
    } else {
        savePlayers();
    }
    
    return newPlayer;
}

function isNameTaken(name, excludePlayerId = null) {
    const normalizedName = name.trim().toLowerCase();
    for (const player of players.values()) {
        if (excludePlayerId && player.playerId === excludePlayerId) continue;
        if (player.playerName.toLowerCase() === normalizedName) return true;
    }
    return false;
}

async function updatePlayerName(playerId, newName) {
    if (!players.has(playerId)) throw new Error('Player not found');
    
    const trimmedName = newName.trim();
    if (trimmedName.length < 2) throw new Error('ชื่อต้องมีอย่างน้อย 2 ตัวอักษร');
    if (trimmedName.length > 20) throw new Error('ชื่อต้องไม่เกิน 20 ตัวอักษร');
    if (isNameTaken(trimmedName, playerId)) throw new Error('ชื่อนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');
    
    const player = players.get(playerId);
    player.playerName = trimmedName;
    player.lastSeen = new Date().toISOString();
    
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { playerName: trimmedName, lastSeen: new Date() });
    } else {
        savePlayers();
    }
    
    return player;
}

async function updatePlayerColor(playerId, color) {
    if (!players.has(playerId)) throw new Error('Player not found');
    if (!AVAILABLE_COLORS.includes(color)) throw new Error('Invalid color');

    const player = players.get(playerId);
    player.color = color;
    player.lastSeen = new Date().toISOString();
    
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { color, lastSeen: new Date() });
    } else {
        savePlayers();
    }
    
    return player;
}

function getPlayer(playerId) {
    return players.get(playerId) || null;
}

function getPlayerByName(playerName) {
    for (const player of players.values()) {
        if (player.playerName === playerName) return player;
    }
    return null;
}

async function updateLastSeen(playerId) {
    if (players.has(playerId)) {
        players.get(playerId).lastSeen = new Date().toISOString();
        if (useDatabase && Player) {
            await Player.updateOne({ playerId }, { lastSeen: new Date() });
        } else {
            savePlayers();
        }
    }
}

function getAllPlayers() {
    return Array.from(players.values());
}

async function deletePlayer(playerId) {
    if (players.has(playerId)) {
        players.delete(playerId);
        if (useDatabase && Player) {
            await Player.deleteOne({ playerId });
        } else {
            savePlayers();
        }
        return true;
    }
    return false;
}

function getPlayerCount() {
    return players.size;
}

// ============ Ban Functions ============
async function banPlayer(playerId, playerName, reason = 'ไม่ระบุเหตุผล', bannedBy = 'Admin', durationHours = null) {
    const player = players.get(playerId);
    const name = playerName || (player ? player.playerName : 'Unknown');
    
    const bannedAt = new Date();
    let expiresAt = null;
    
    if (durationHours !== null && durationHours > 0) {
        expiresAt = new Date(bannedAt.getTime() + (durationHours * 60 * 60 * 1000));
    }
    
    const banInfo = {
        playerId,
        playerName: name,
        reason,
        bannedAt: bannedAt.toISOString(),
        bannedBy,
        durationHours,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        isPermanent: durationHours === null || durationHours === 0
    };
    
    bannedPlayers.set(playerId, banInfo);
    
    if (useDatabase && BannedPlayer) {
        await BannedPlayer.findOneAndUpdate(
            { playerId },
            banInfo,
            { upsert: true, new: true }
        );
    } else {
        saveBannedPlayers();
    }
    
    return banInfo;
}

async function unbanPlayer(playerId) {
    if (bannedPlayers.has(playerId)) {
        bannedPlayers.delete(playerId);
        if (useDatabase && BannedPlayer) {
            await BannedPlayer.deleteOne({ playerId });
        } else {
            saveBannedPlayers();
        }
        return true;
    }
    return false;
}

function isPlayerBanned(playerId) {
    if (!bannedPlayers.has(playerId)) return false;
    
    const banInfo = bannedPlayers.get(playerId);
    if (banInfo.isPermanent || !banInfo.expiresAt) return true;
    
    const now = new Date();
    const expiresAt = new Date(banInfo.expiresAt);
    
    if (now >= expiresAt) {
        bannedPlayers.delete(playerId);
        if (useDatabase && BannedPlayer) {
            BannedPlayer.deleteOne({ playerId }).catch(() => {});
        } else {
            saveBannedPlayers();
        }
        console.log(`Auto-unbanned player ${playerId} (ban expired)`);
        return false;
    }
    
    return true;
}

function getBanInfo(playerId) {
    if (!bannedPlayers.has(playerId)) return null;
    
    const banInfo = bannedPlayers.get(playerId);
    
    if (banInfo.expiresAt && !banInfo.isPermanent) {
        const now = new Date();
        const expiresAt = new Date(banInfo.expiresAt);
        const remainingMs = expiresAt - now;
        
        if (remainingMs <= 0) {
            bannedPlayers.delete(playerId);
            saveBannedPlayers();
            return null;
        }
        
        const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        
        return {
            ...banInfo,
            remainingMs,
            remainingHours,
            remainingMinutes,
            remainingText: remainingHours > 0 
                ? `${remainingHours} ชั่วโมง ${remainingMinutes} นาที`
                : `${remainingMinutes} นาที`
        };
    }
    
    return { ...banInfo, remainingText: 'ถาวร' };
}

function getAllBannedPlayers() {
    return Array.from(bannedPlayers.values());
}

async function adminUpdatePlayerName(playerId, newName) {
    if (!players.has(playerId)) throw new Error('Player not found');
    const player = players.get(playerId);
    const oldName = player.playerName;
    player.playerName = newName.trim();
    
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { playerName: newName.trim() });
    } else {
        savePlayers();
    }
    
    return { oldName, newName: player.playerName };
}

// Initialize on load (for JSON mode)
loadPlayersFromFile();
loadBannedFromFile();

module.exports = {
    initPlayerManager,
    createOrGetPlayer,
    updatePlayerName,
    updatePlayerColor,
    getPlayer,
    getPlayerByName,
    updateLastSeen,
    getAllPlayers,
    deletePlayer,
    getPlayerCount,
    isNameTaken,
    AVAILABLE_COLORS,
    banPlayer,
    unbanPlayer,
    isPlayerBanned,
    getBanInfo,
    getAllBannedPlayers,
    adminUpdatePlayerName
};
