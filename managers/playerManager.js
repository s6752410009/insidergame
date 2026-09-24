/**
 * PlayerManager - จัดการข้อมูลผู้เล่นและ identity
 * รองรับทั้ง MongoDB และ JSON fallback
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
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

const { PLAYERS_FILE, BANNED_FILE } = require('./dataPaths');

// Memory cache
const players = new Map();
const bannedPlayers = new Map();
// playerId -> รหัสกู้บัญชี (ห้ามใส่ใน object ผู้เล่น เพราะ object นั้นถูกส่งให้ client)
const recoveryCodes = new Map();
// playerId -> { sub, email } บัญชี Google ที่ผูกไว้ (เก็บแยกด้วยเหตุผลเดียวกัน)
const googleLinks = new Map();

function isBotPlayerId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

// สีที่ใช้ได้
const AVAILABLE_COLORS = [
    '#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c',
    '#e67e22', '#e91e63', '#ffeb3b', '#00bcd4', '#ff5722', '#8e44ad'
];

const PLAYER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Avatar ที่เลือกได้ (emoji)
const AVAILABLE_AVATARS = [
    '👤', '😀', '😎', '🤖', '👻', '🎭', '🦊', '🐱', '🐶', '🐼',
    '🦁', '🐯', '🐸', '🐵', '🦄', '🐲', '👽', '🤡', '💀', '🎃',
    '🧙', '🧛', '🧟', '🦸', '🦹', '👑', '🎩', '🌟', '🔥', '💎'
];

// กรอบ Avatar ที่เลือกได้
const AVAILABLE_FRAMES = [
    { id: 'none', name: 'ไม่มีกรอบ', style: 'none' },
    { id: 'bronze', name: 'บรอนซ์', style: 'linear-gradient(135deg, #cd7f32 0%, #8b4513 100%)' },
    { id: 'silver', name: 'เงิน', style: 'linear-gradient(135deg, #c0c0c0 0%, #808080 100%)' },
    { id: 'gold', name: 'ทอง', style: 'linear-gradient(135deg, #ffd700 0%, #ff8c00 100%)' },
    { id: 'diamond', name: 'เพชร', style: 'linear-gradient(135deg, #b9f2ff 0%, #00bfff 100%)' },
    { id: 'fire', name: 'ไฟ', style: 'linear-gradient(135deg, #ff4500 0%, #ff0000 100%)' },
    { id: 'rainbow', name: 'รุ้ง', style: 'linear-gradient(135deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff)' },
    { id: 'neon', name: 'นีออน', style: 'linear-gradient(135deg, #00ff00 0%, #00ffff 50%, #ff00ff 100%)' }
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
        recoveryCodes.clear();
        googleLinks.clear();
        dbPlayers.forEach(p => {
            if (isBotPlayerId(p.playerId)) return;
            if (p.recoveryCode) recoveryCodes.set(p.playerId, p.recoveryCode);
            if (p.googleSub) googleLinks.set(p.playerId, { sub: p.googleSub, email: p.googleEmail || null });
            players.set(p.playerId, {
                playerId: p.playerId,
                playerName: p.playerName,
                color: p.color || '#3498db',
                avatar: p.avatar || '👤',
                avatarFrame: p.avatarFrame || 'none',
                isSiteAdmin: Boolean(p.isSiteAdmin),
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
            let droppedBots = 0;
            for (const [playerId, player] of Object.entries(playersData)) {
                if (isBotPlayerId(playerId)) {
                    droppedBots += 1;
                    continue;
                }
                // รหัสกู้บัญชีเก็บแยกจาก object ผู้เล่น — object นี้ถูกส่งออกไปหน้าเว็บหลายที่
                const { recoveryCode, googleSub, googleEmail, ...publicFields } = player || {};
                if (recoveryCode) recoveryCodes.set(playerId, recoveryCode);
                if (googleSub) googleLinks.set(playerId, { sub: googleSub, email: googleEmail || null });
                players.set(playerId, publicFields);
            }
            console.log(`Loaded ${players.size} players from file`);
            if (droppedBots > 0) {
                console.log(`Dropped ${droppedBots} bot accounts from player list`);
                savePlayers();
            }
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
            if (isBotPlayerId(playerId)) continue;
            const recoveryCode = recoveryCodes.get(playerId);
            const google = googleLinks.get(playerId);
            playersData[playerId] = {
                ...player,
                ...(recoveryCode ? { recoveryCode } : {}),
                ...(google ? { googleSub: google.sub, googleEmail: google.email } : {})
            };
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

function isValidPlayerId(playerId) {
    if (typeof playerId !== 'string') return false;
    const cleanId = playerId.trim();
    if (cleanId.startsWith('bot_')) {
        return PLAYER_ID_REGEX.test(cleanId.substring(4));
    }
    return PLAYER_ID_REGEX.test(cleanId);
}

function hashPlayerId(playerId) {
    const normalizedId = String(playerId || '').replace(/-/g, '').toLowerCase();
    let hash = 0;
    for (let i = 0; i < normalizedId.length; i++) {
        hash = (hash * 31 + normalizedId.charCodeAt(i)) % 1000000;
    }
    return hash;
}

function generateGuestNameFromPlayerId(playerId, excludePlayerId = null) {
    let seed = hashPlayerId(playerId);

    for (let attempt = 0; attempt < 1000; attempt++) {
        const name = `guest${String(seed).padStart(6, '0')}`;
        if (!isNameTaken(name, excludePlayerId)) {
            return name;
        }
        seed = (seed + 7919) % 1000000;
    }

    return generateRandomName();
}

function getColorForPlayerId(playerId) {
    const colorIndex = hashPlayerId(playerId) % AVAILABLE_COLORS.length;
    return AVAILABLE_COLORS[colorIndex];
}

function buildTransientPlayer(playerId) {
    if (!isValidPlayerId(playerId)) return null;

    const existingPlayer = players.get(playerId);
    if (existingPlayer) {
        return existingPlayer;
    }

    return {
        playerId,
        playerName: generateGuestNameFromPlayerId(playerId, playerId),
        color: getColorForPlayerId(playerId),
        avatar: '👤',
        avatarFrame: 'none',
        isSiteAdmin: false,
        createdAt: null,
        lastSeen: null,
        isTransient: true
    };
}

// ============ Recovery Code ============
// ตัดตัวที่อ่านสับสนออก (0/O, 1/I/L) — ผู้เล่นต้องพิมพ์เองจากมือถืออีกเครื่อง
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRecoveryCode() {
    const bytes = crypto.randomBytes(12);
    let raw = '';
    for (let i = 0; i < 12; i++) raw += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function normalizeRecoveryCode(code) {
    const raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length !== 12) return null;
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function generateUniqueRecoveryCode() {
    for (;;) {
        const code = generateRecoveryCode();
        if (!findPlayerByRecoveryCode(code)) return code;
    }
}

function findPlayerByRecoveryCode(code) {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) return null;
    for (const [playerId, stored] of recoveryCodes.entries()) {
        if (stored === normalized) return players.get(playerId) || null;
    }
    return null;
}

function getRecoveryCode(playerId) {
    return recoveryCodes.get(playerId) || null;
}

// บัญชีที่ยังไม่มีรหัส = บัญชีเก่าก่อนมีระบบนี้ ยังไม่เคยถูก "จอง" เข้ากับเครื่องไหน
function hasRecoveryCode(playerId) {
    return recoveryCodes.has(playerId);
}

async function ensureRecoveryCode(playerId) {
    const player = players.get(playerId);
    if (!player || isBotPlayerId(playerId)) return null;
    if (recoveryCodes.has(playerId)) return recoveryCodes.get(playerId);
    const code = generateUniqueRecoveryCode();
    recoveryCodes.set(playerId, code);
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { recoveryCode: code });
    } else {
        savePlayers();
    }
    return code;
}

// ============ Google Link ============
function findPlayerByGoogleSub(sub) {
    if (!sub) return null;
    for (const [playerId, link] of googleLinks.entries()) {
        if (link.sub === sub) return players.get(playerId) || null;
    }
    return null;
}

function getGoogleLink(playerId) {
    return googleLinks.get(playerId) || null;
}

async function linkGoogleAccount(playerId, sub, email) {
    if (!players.has(playerId) || isBotPlayerId(playerId)) throw new Error('Player not found');
    const owner = findPlayerByGoogleSub(sub);
    if (owner && owner.playerId !== playerId) throw new Error('บัญชี Google นี้ผูกกับผู้เล่นอื่นอยู่แล้ว');
    googleLinks.set(playerId, { sub, email: email || null });
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { googleSub: sub, googleEmail: email || null });
    } else {
        savePlayers();
    }
}

async function unlinkGoogleAccount(playerId) {
    if (!googleLinks.has(playerId)) return;
    googleLinks.delete(playerId);
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { $unset: { googleSub: 1, googleEmail: 1 } });
    } else {
        savePlayers();
    }
}

// ============ Player Functions ============
async function createOrGetPlayer(playerId = null, options = {}) {
    if (playerId && !isValidPlayerId(playerId)) {
        throw new Error('Invalid player ID');
    }

    if (playerId && players.has(playerId)) {
        const player = players.get(playerId);
        player.lastSeen = new Date().toISOString();
        if (isBotPlayerId(playerId)) {
            return player;
        }
        
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
        playerName: generateGuestNameFromPlayerId(newPlayerId, newPlayerId),
        color: getColorForPlayerId(newPlayerId),
        avatar: '👤',
        avatarFrame: 'none',
        isSiteAdmin: false,
        approved: options.approved !== false,
        isBot: isBotPlayerId(newPlayerId),
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
    };

    players.set(newPlayerId, newPlayer);
    if (isBotPlayerId(newPlayerId)) {
        return newPlayer;
    }
    recoveryCodes.set(newPlayerId, generateUniqueRecoveryCode());

    if (useDatabase && Player) {
        try {
            await Player.create({ ...newPlayer, recoveryCode: recoveryCodes.get(newPlayerId) });
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
    if (isBotPlayerId(playerId)) return player;
    
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
    if (isBotPlayerId(playerId)) return player;
    
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { color, lastSeen: new Date() });
    } else {
        savePlayers();
    }
    
    return player;
}

async function updatePlayerAvatar(playerId, avatar) {
    if (!players.has(playerId)) throw new Error('Player not found');
    if (!AVAILABLE_AVATARS.includes(avatar)) throw new Error('Invalid avatar');

    const player = players.get(playerId);
    player.avatar = avatar;
    player.lastSeen = new Date().toISOString();
    if (isBotPlayerId(playerId)) return player;
    
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { avatar, lastSeen: new Date() });
    } else {
        savePlayers();
    }
    
    return player;
}

async function updatePlayerAvatarFrame(playerId, frameId) {
    if (!players.has(playerId)) throw new Error('Player not found');
    const frame = AVAILABLE_FRAMES.find(f => f.id === frameId);
    if (!frame) throw new Error('Invalid frame');

    const player = players.get(playerId);
    player.avatarFrame = frameId;
    player.lastSeen = new Date().toISOString();
    if (isBotPlayerId(playerId)) return player;
    
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { avatarFrame: frameId, lastSeen: new Date() });
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
        if (isBotPlayerId(playerId)) return;
        if (useDatabase && Player) {
            await Player.updateOne({ playerId }, { lastSeen: new Date() });
        } else {
            savePlayers();
        }
    }
}

function getAllPlayers() {
    return Array.from(players.values()).filter(player => !isBotPlayerId(player.playerId));
}

async function deletePlayer(playerId) {
    if (players.has(playerId)) {
        players.delete(playerId);
        recoveryCodes.delete(playerId);
        googleLinks.delete(playerId);
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
    return getAllPlayers().length;
}

function isSiteAdmin(playerId) {
    return Boolean(players.get(playerId)?.isSiteAdmin);
}

async function setSiteAdmin(playerId, nextValue) {
    if (!players.has(playerId)) throw new Error('Player not found');

    const player = players.get(playerId);
    player.isSiteAdmin = Boolean(nextValue);
    player.lastSeen = new Date().toISOString();

    if (useDatabase && Player) {
        await Player.updateOne(
            { playerId },
            { isSiteAdmin: player.isSiteAdmin, lastSeen: new Date() }
        );
    } else {
        savePlayers();
    }

    return player;
}

async function createSiteAdmin(playerName) {
    const trimmedName = String(playerName || '').trim();
    if (trimmedName.length < 2) throw new Error('ชื่อต้องมีอย่างน้อย 2 ตัวอักษร');
    if (trimmedName.length > 20) throw new Error('ชื่อต้องไม่เกิน 20 ตัวอักษร');
    if (isNameTaken(trimmedName)) throw new Error('ชื่อนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');

    const player = await createOrGetPlayer();
    player.playerName = trimmedName;
    player.isSiteAdmin = true;
    player.lastSeen = new Date().toISOString();

    if (useDatabase && Player) {
        await Player.updateOne(
            { playerId: player.playerId },
            {
                playerName: player.playerName,
                isSiteAdmin: true,
                lastSeen: new Date()
            }
        );
    } else {
        savePlayers();
    }

    return player;
}

function getAllSiteAdmins() {
    return Array.from(players.values()).filter(player => Boolean(player.isSiteAdmin));
}

function isAutoGeneratedName(playerName) {
    return typeof playerName === 'string' && /^guest\d{5,6}$/i.test(playerName.trim());
}

function isDefaultProfile(player) {
    if (!player) return false;
    return (player.avatar || '👤') === '👤' && (player.avatarFrame || 'none') === 'none';
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

async function setPlayerApproved(playerId, approved = true) {
    if (!players.has(playerId)) {
        throw new Error('Player not found');
    }
    const player = players.get(playerId);
    player.approved = !!approved;
    if (useDatabase && Player) {
        await Player.updateOne({ playerId }, { approved: player.approved });
    } else {
        savePlayers();
    }
    return player;
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
    buildTransientPlayer,
    updatePlayerName,
    updatePlayerColor,
    updatePlayerAvatar,
    updatePlayerAvatarFrame,
    getPlayer,
    getPlayerByName,
    updateLastSeen,
    getAllPlayers,
    deletePlayer,
    getPlayerCount,
    isSiteAdmin,
    setSiteAdmin,
    createSiteAdmin,
    getAllSiteAdmins,
    isNameTaken,
    isValidPlayerId,
    isBotPlayerId,
    isAutoGeneratedName,
    isDefaultProfile,
    AVAILABLE_COLORS,
    AVAILABLE_AVATARS,
    AVAILABLE_FRAMES,
    banPlayer,
    unbanPlayer,
    isPlayerBanned,
    getBanInfo,
    getAllBannedPlayers,
    adminUpdatePlayerName,
    setPlayerApproved,
    normalizeRecoveryCode,
    findPlayerByRecoveryCode,
    hasRecoveryCode,
    ensureRecoveryCode,
    getRecoveryCode,
    findPlayerByGoogleSub,
    getGoogleLink,
    linkGoogleAccount,
    unlinkGoogleAccount
};
