/**
 * StatsManager - จัดการสถิติผู้เล่น
 * - รองรับทั้ง MongoDB และ JSON fallback
 * - บันทึกสถิติเมื่อเกมจบ
 * - เก็บข้อมูล: totalGames, wins, losses, roleStats, winByRole
 * - ใช้ playerId เป็น key
 */

const fs = require('fs');
const path = require('path');

// Try to load MongoDB models
let PlayerStats, useDatabase = false;
try {
    const models = require('./models');
    PlayerStats = models.PlayerStats;
} catch (e) {
    console.log('PlayerStats model not loaded, will use JSON fallback');
}

const STATS_FILE = path.join(__dirname, '../data/playerStats.json');
const MAX_GAME_HISTORY = 20;
const WEREWOLF_ROLE_IDS = ['villager', 'werewolf', 'alphaWolf', 'mayor', 'bodyguard', 'seer', 'doctor', 'witch', 'fool', 'revealer'];
const WEREWOLF_ROLE_LABELS = {
    villager: 'ชาวบ้าน',
    werewolf: 'หมาป่า',
    alphaWolf: 'อัลฟ่าหมาป่า',
    mayor: 'นายก',
    bodyguard: 'บอดี้การ์ด',
    seer: 'Seer',
    doctor: 'หมอ',
    witch: 'แม่มด',
    fool: 'คนบ้า',
    revealer: 'จอมเปิดโปง'
};

// เก็บสถิติใน memory (key: playerId)
const stats = new Map();

function createDefaultWerewolfRoleStats() {
    return {
        villager: 0,
        werewolf: 0,
        alphaWolf: 0,
        mayor: 0,
        bodyguard: 0,
        seer: 0,
        doctor: 0,
        witch: 0,
        fool: 0,
        revealer: 0
    };
}

function createDefaultRoleStats() {
    return {
        gameMasterCount: 0,
        traitorCount: 0,
        citizenCount: 0,
        werewolf: createDefaultWerewolfRoleStats()
    };
}

function createDefaultWinByRole() {
    return {
        winAsTraitor: 0,
        winAsCitizen: 0,
        werewolf: createDefaultWerewolfRoleStats()
    };
}

function createDefaultModeStats() {
    return {
        insider: { games: 0, wins: 0, losses: 0 },
        werewolf: { games: 0, wins: 0, losses: 0 }
    };
}

function normalizeCounter(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

function isWerewolfTeamRole(roleId) {
    return roleId === 'werewolf' || roleId === 'alphaWolf';
}

function createDefaultStatsRecord(playerId, playerName) {
    return {
        playerId,
        playerName: isPlaceholderPlayerName(playerName) ? 'Unknown' : playerName,
        totalGames: 0,
        wins: 0,
        losses: 0,
        roleStats: createDefaultRoleStats(),
        winByRole: createDefaultWinByRole(),
        modeStats: createDefaultModeStats(),
        lastPlayedAt: null,
        gameHistory: []
    };
}

function normalizeGameHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    const mode = entry.mode === 'werewolf' ? 'werewolf' : 'insider';
    return {
        ...entry,
        mode,
        roomName: entry.roomName || 'ไม่ทราบ',
        role: entry.role || 'ไม่ทราบ',
        playerCount: normalizeCounter(entry.playerCount),
        won: !!entry.won
    };
}

function normalizeStatsShape(rawStat = {}, fallbackPlayerId = null, fallbackPlayerName = 'Unknown') {
    const stat = createDefaultStatsRecord(
        rawStat.playerId || fallbackPlayerId,
        isPlaceholderPlayerName(rawStat.playerName) ? fallbackPlayerName : rawStat.playerName
    );

    stat.totalGames = normalizeCounter(rawStat.totalGames);
    stat.wins = normalizeCounter(rawStat.wins);
    stat.losses = normalizeCounter(rawStat.losses);

    const rawRoleStats = rawStat.roleStats || {};
    stat.roleStats.gameMasterCount = normalizeCounter(rawRoleStats.gameMasterCount);
    stat.roleStats.traitorCount = normalizeCounter(rawRoleStats.traitorCount);
    stat.roleStats.citizenCount = normalizeCounter(rawRoleStats.citizenCount);

    const rawWerewolfRoleStats = rawRoleStats.werewolf || rawRoleStats.werewolfRoles || {};
    WEREWOLF_ROLE_IDS.forEach(roleId => {
        stat.roleStats.werewolf[roleId] = normalizeCounter(rawWerewolfRoleStats[roleId]);
    });

    const rawWinByRole = rawStat.winByRole || {};
    stat.winByRole.winAsTraitor = normalizeCounter(rawWinByRole.winAsTraitor);
    stat.winByRole.winAsCitizen = normalizeCounter(rawWinByRole.winAsCitizen);

    const rawWerewolfWins = rawWinByRole.werewolf || rawWinByRole.werewolfWins || {};
    WEREWOLF_ROLE_IDS.forEach(roleId => {
        stat.winByRole.werewolf[roleId] = normalizeCounter(rawWerewolfWins[roleId]);
    });

    const rawModeStats = rawStat.modeStats || {};
    ['insider', 'werewolf'].forEach(mode => {
        const modeStat = rawModeStats[mode] || {};
        stat.modeStats[mode] = {
            games: normalizeCounter(modeStat.games),
            wins: normalizeCounter(modeStat.wins),
            losses: normalizeCounter(modeStat.losses)
        };
    });

    if (stat.modeStats.insider.games === 0 && stat.modeStats.werewolf.games === 0 && stat.totalGames > 0) {
        stat.modeStats.insider.games = stat.totalGames;
        stat.modeStats.insider.wins = stat.wins;
        stat.modeStats.insider.losses = stat.losses;
    }

    stat.lastPlayedAt = rawStat.lastPlayedAt || null;
    stat.gameHistory = Array.isArray(rawStat.gameHistory)
        ? rawStat.gameHistory.map(normalizeGameHistoryEntry).filter(Boolean).slice(0, MAX_GAME_HISTORY)
        : [];

    return stat;
}

// สร้างโฟลเดอร์ data ถ้ายังไม่มี
const dataDir = path.dirname(STATS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ============ Initialize ============
async function initStatsManager() {
    // Check if MongoDB is available
    if (process.env.MONGO_URL && PlayerStats) {
        try {
            const { connectDB, isDBConnected } = require('./database');
            await connectDB();
            if (isDBConnected()) {
                useDatabase = true;
                console.log('✅ StatsManager using MongoDB');
                await loadStatsFromDB();
                return;
            }
        } catch (e) {
            console.log('MongoDB not available for stats:', e.message);
        }
    }
    
    // Fallback to JSON
    useDatabase = false;
    console.log('📁 StatsManager using JSON files');
    loadStatsFromFile();
}

// ============ Load Functions ============
async function loadStatsFromDB() {
    try {
        const dbStats = await PlayerStats.find({});
        stats.clear();
        dbStats.forEach(s => {
            stats.set(s.playerId, normalizeStatsShape(s.toObject ? s.toObject() : s, s.playerId, s.playerName));
        });
        console.log(`Loaded stats for ${stats.size} players from MongoDB`);
    } catch (e) {
        console.error('Error loading stats from MongoDB:', e.message);
        // Fallback to JSON
        loadStatsFromFile();
    }
}

function loadStatsFromFile() {
    if (fs.existsSync(STATS_FILE)) {
        try {
            const data = fs.readFileSync(STATS_FILE, 'utf8');
            const statsData = JSON.parse(data);
            // โหลดเข้า Map
            if (statsData && typeof statsData === 'object') {
                for (const [playerId, stat] of Object.entries(statsData)) {
                    stats.set(playerId, normalizeStatsShape(stat, playerId, stat.playerName));
                }
            }
            console.log(`Loaded stats for ${stats.size} players from file`);
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    } else {
        console.log('Stats file not found, starting fresh');
    }
}

// ============ Save Functions ============
async function saveStats() {
    if (useDatabase) {
        await saveStatsToDB();
    } else {
        saveStatsToFile();
    }
}

async function saveStatsToDB() {
    try {
        const bulkOps = [];
        for (const [playerId, stat] of stats.entries()) {
            bulkOps.push({
                updateOne: {
                    filter: { playerId },
                    update: { $set: stat },
                    upsert: true
                }
            });
        }
        if (bulkOps.length > 0) {
            await PlayerStats.bulkWrite(bulkOps);
        }
    } catch (e) {
        console.error('Error saving stats to MongoDB:', e.message);
        // Fallback to JSON
        saveStatsToFile();
    }
}

function saveStatsToFile() {
    try {
        const statsData = {};
        for (const [playerId, stat] of stats.entries()) {
            statsData[playerId] = stat;
        }
        fs.writeFileSync(STATS_FILE, JSON.stringify(statsData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving stats:', error);
    }
}

function isPlaceholderPlayerName(playerName) {
    if (typeof playerName !== 'string') return true;
    const normalizedName = playerName.trim();
    return normalizedName.length === 0 || normalizedName.toLowerCase() === 'unknown';
}

/**
 * สร้างสถิติเริ่มต้นสำหรับผู้เล่น
 */
function initializeStats(playerId, playerName) {
    if (!stats.has(playerId)) {
        stats.set(playerId, createDefaultStatsRecord(playerId, playerName));
    }
    const stat = normalizeStatsShape(stats.get(playerId), playerId, playerName);
    stats.set(playerId, stat);
    if (!isPlaceholderPlayerName(playerName) && isPlaceholderPlayerName(stat.playerName)) {
        stat.playerName = playerName;
    }
    return stat;
}

/**
 * บันทึกสถิติเมื่อเกมจบ
 * @param {string} roomId - ID ของห้อง
 * @param {Object} gameResult - ผลการเล่นเกม { resultVote2, players, word, roomName }
 */
function recordGameEnd(roomId, gameResult) {
    if (gameResult?.mode === 'werewolf') {
        return recordWerewolfGameEnd(roomId, gameResult);
    }

    return recordInsiderGameEnd(roomId, gameResult);
}

function recordInsiderGameEnd(roomId, gameResult) {
    const { resultVote2, players, word, roomName } = gameResult;
    
    if (!resultVote2 || !players) {
        console.warn('Invalid game result data');
        return;
    }

    const hasWon = resultVote2.hasWon; // true = พลเมืองชนะ, false = ผู้ทรยศชนะ
    const gameTimestamp = new Date().toISOString();
    const traitorName = resultVote2.finalTraitorName || 'ไม่ทราบ';

    // อัปเดตสถิติสำหรับทุกผู้เล่นในเกม
    players.forEach(player => {
        // player ต้องมี playerId และ role
        if (!player.playerId || !player.role) return;

        const playerId = player.playerId;
        const role = player.role;
        const stat = initializeStats(playerId, player.playerName || player.name);

        // อัปเดต totalGames
        stat.totalGames += 1;
        stat.modeStats.insider.games += 1;

        // คำนวณผลชนะ/แพ้
        let playerWon = false;
        
        // ตรวจสอบว่าเป็นผู้ชนะหรือไม่ (ตาม role)
        if (role === 'ผู้ทรยศ') {
            // ผู้ทรยศชนะ = พลเมืองแพ้
            if (!hasWon) {
                stat.wins += 1;
                stat.modeStats.insider.wins += 1;
                stat.winByRole.winAsTraitor += 1;
                playerWon = true;
            } else {
                stat.losses += 1;
                stat.modeStats.insider.losses += 1;
            }
            stat.roleStats.traitorCount += 1;
        } else if (role === 'ผู้ดำเนินเกม') {
            // GM ไม่นับเป็น win/loss แต่บันทึก role
            stat.roleStats.gameMasterCount += 1;
            // GM ถือว่าชนะถ้าพลเมืองชนะ
            if (hasWon) {
                stat.wins += 1;
                stat.modeStats.insider.wins += 1;
                playerWon = true;
            } else {
                stat.losses += 1;
                stat.modeStats.insider.losses += 1;
            }
        } else {
            // พลเมือง (หรือ defaultRole)
            if (hasWon) {
                stat.wins += 1;
                stat.modeStats.insider.wins += 1;
                stat.winByRole.winAsCitizen += 1;
                playerWon = true;
            } else {
                stat.losses += 1;
                stat.modeStats.insider.losses += 1;
            }
            stat.roleStats.citizenCount += 1;
        }

        // อัปเดต lastPlayedAt
        stat.lastPlayedAt = gameTimestamp;
        
        // บันทึกประวัติเกม
        const gameEntry = {
            mode: 'insider',
            date: gameTimestamp,
            roomId: roomId,
            roomName: roomName || 'ไม่ทราบ',
            role: role,
            won: playerWon,
            word: word || 'ไม่ทราบ',
            traitor: traitorName,
            citizensWon: hasWon,
            playerCount: players.length
        };
        
        // เพิ่มเกมล่าสุดที่หัว array
        stat.gameHistory.unshift(gameEntry);
        
        // เก็บแค่ 20 เกมล่าสุด
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    // บันทึกลงไฟล์
    saveStats();
}

function recordWerewolfGameEnd(roomId, gameResult) {
    const { winner, players, roomName, dayNumber } = gameResult;

    if (!winner || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid werewolf game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const winnerLabel = winner === 'village' ? 'ชาวบ้าน' : (winner === 'werewolf' ? 'หมาป่า' : 'คนบ้า');

    players.forEach(player => {
        if (!player.playerId || !player.role) {
            return;
        }

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        const roleId = player.role;
        const team = player.roleInfo?.team || (isWerewolfTeamRole(roleId) ? 'werewolf' : 'village');
        const playerWon = winner === roleId || team === winner;
        const roleLabel = player.roleInfo?.thaiName || player.revealedRole || WEREWOLF_ROLE_LABELS[roleId] || roleId;

        stat.totalGames += 1;
        stat.modeStats.werewolf.games += 1;
        stat.roleStats.werewolf[roleId] = normalizeCounter(stat.roleStats.werewolf[roleId]) + 1;

        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.werewolf.wins += 1;
            stat.winByRole.werewolf[roleId] = normalizeCounter(stat.winByRole.werewolf[roleId]) + 1;
        } else {
            stat.losses += 1;
            stat.modeStats.werewolf.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'werewolf',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            roleId,
            role: roleLabel,
            team,
            won: playerWon,
            winner,
            winnerLabel,
            playerCount: players.length,
            dayNumber: normalizeCounter(dayNumber),
            survived: player.alive !== false
        });

        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/**
 * ดึงสถิติผู้เล่น
 */
function getStats(playerId) {
    const stat = stats.get(playerId);
    if (!stat) {
        return null;
    }

    const normalized = normalizeStatsShape(stat, playerId, stat.playerName);
    stats.set(playerId, normalized);
    return normalized;
}

/**
 * ดึงประวัติเกมของผู้เล่น
 * @param {string} playerId - ID ผู้เล่น
 * @param {number} limit - จำนวนที่ต้องการ (default 20)
 */
function getGameHistory(playerId, limit = 20) {
    const stat = getStats(playerId);
    if (!stat || !stat.gameHistory) {
        return [];
    }
    return stat.gameHistory.slice(0, limit);
}

/**
 * อัปเดตชื่อผู้เล่นในสถิติ (เมื่อผู้เล่นเปลี่ยนชื่อ)
 */
function updatePlayerNameInStats(playerId, newName) {
    if (stats.has(playerId)) {
        stats.get(playerId).playerName = newName;
        saveStats();
    }
}

async function repairStatsPlayerNames(players) {
    if (!Array.isArray(players) || players.length === 0) {
        return { repairedCount: 0, repairedPlayers: [] };
    }

    const playersById = new Map(players.map(player => [player.playerId, player.playerName]));
    const repairedPlayers = [];

    for (const stat of stats.values()) {
        if (!isPlaceholderPlayerName(stat.playerName)) {
            continue;
        }

        const restoredName = playersById.get(stat.playerId);
        if (!isPlaceholderPlayerName(restoredName)) {
            stat.playerName = restoredName;
            repairedPlayers.push({ playerId: stat.playerId, playerName: restoredName });
        }
    }

    if (repairedPlayers.length > 0) {
        await saveStats();
    }

    return {
        repairedCount: repairedPlayers.length,
        repairedPlayers
    };
}

/**
 * ดึงสถิติทั้งหมด (สำหรับ admin/dashboard)
 */
function getAllStats() {
    return Array.from(stats.values());
}

/**
 * รีเซ็ตสถิติผู้เล่น (สำหรับ admin)
 */
async function resetPlayerStats(playerId) {
    if (stats.has(playerId)) {
        const currentStat = stats.get(playerId);
        const stat = createDefaultStatsRecord(playerId, currentStat.playerName);
        stats.set(playerId, stat);
        await saveStats();
        return true;
    }
    return false;
}

/**
 * แก้ไขสถิติผู้เล่น (สำหรับ Admin เทพ!)
 */
async function editPlayerStats(playerId, newData) {
    // ถ้ายังไม่มี stats ให้สร้างใหม่
    if (!stats.has(playerId)) {
        stats.set(playerId, createDefaultStatsRecord(playerId, newData.playerName || 'Unknown'));
    }
    
    const stat = normalizeStatsShape(stats.get(playerId), playerId, newData.playerName || 'Unknown');
    stats.set(playerId, stat);
    
    // อัพเดทค่าที่ส่งมา
    if (newData.playerName !== undefined) stat.playerName = newData.playerName;
    if (newData.totalGames !== undefined) stat.totalGames = newData.totalGames;
    if (newData.wins !== undefined) stat.wins = newData.wins;
    if (newData.losses !== undefined) stat.losses = newData.losses;
    if (newData.roleStats) {
        if (newData.roleStats.gameMasterCount !== undefined) stat.roleStats.gameMasterCount = newData.roleStats.gameMasterCount;
        if (newData.roleStats.traitorCount !== undefined) stat.roleStats.traitorCount = newData.roleStats.traitorCount;
        if (newData.roleStats.citizenCount !== undefined) stat.roleStats.citizenCount = newData.roleStats.citizenCount;

        if (newData.roleStats.werewolf && typeof newData.roleStats.werewolf === 'object') {
            WEREWOLF_ROLE_IDS.forEach(roleId => {
                if (newData.roleStats.werewolf[roleId] !== undefined) {
                    stat.roleStats.werewolf[roleId] = normalizeCounter(newData.roleStats.werewolf[roleId]);
                }
            });
        }
    }

    if (newData.modeStats && typeof newData.modeStats === 'object') {
        ['insider', 'werewolf'].forEach(mode => {
            if (!newData.modeStats[mode]) {
                return;
            }

            const modeUpdate = newData.modeStats[mode];
            if (modeUpdate.games !== undefined) stat.modeStats[mode].games = normalizeCounter(modeUpdate.games);
            if (modeUpdate.wins !== undefined) stat.modeStats[mode].wins = normalizeCounter(modeUpdate.wins);
            if (modeUpdate.losses !== undefined) stat.modeStats[mode].losses = normalizeCounter(modeUpdate.losses);
        });
    }
    
    // บันทึก
    await saveStats();
    
    // ถ้าใช้ MongoDB อัพเดทใน DB ด้วย
    if (useDatabase && PlayerStats) {
        try {
            await PlayerStats.updateOne(
                { playerId },
                { $set: stat },
                { upsert: true }
            );
        } catch (e) {
            console.error('Error updating stats in MongoDB:', e.message);
        }
    }
    
    return stat;
}

/**
 * ลบสถิติผู้เล่น (สำหรับ admin)
 */
async function deletePlayerStats(playerId) {
    if (stats.has(playerId)) {
        stats.delete(playerId);
        
        // ถ้าใช้ MongoDB ต้องลบจาก DB ด้วย
        if (useDatabase && PlayerStats) {
            try {
                await PlayerStats.deleteOne({ playerId });
            } catch (e) {
                console.error('Error deleting stats from MongoDB:', e.message);
            }
        }
        
        await saveStats();
        return true;
    }
    return false;
}

/**
 * ลบสถิติทั้งหมด (Clear All)
 */
async function clearAllStats() {
    const count = stats.size;
    stats.clear();
    
    // ถ้าใช้ MongoDB ต้องลบทั้งหมดจาก DB ด้วย
    if (useDatabase && PlayerStats) {
        try {
            await PlayerStats.deleteMany({});
        } catch (e) {
            console.error('Error clearing stats from MongoDB:', e.message);
        }
    }
    
    await saveStats();
    return count;
}

/**
 * ลบสถิติหลายคน (Bulk Delete)
 * @param {Array} playerIds - รายการ playerId ที่ต้องการลบ
 */
async function bulkDeleteStats(playerIds) {
    let deletedCount = 0;
    playerIds.forEach(playerId => {
        if (stats.has(playerId)) {
            stats.delete(playerId);
            deletedCount++;
        }
    });
    
    if (deletedCount > 0) {
        // ถ้าใช้ MongoDB ต้องลบจาก DB ด้วย
        if (useDatabase && PlayerStats) {
            try {
                await PlayerStats.deleteMany({ playerId: { $in: playerIds } });
            } catch (e) {
                console.error('Error bulk deleting stats from MongoDB:', e.message);
            }
        }
        
        await saveStats();
    }
    return deletedCount;
}

/**
 * ดึง Leaderboard (top players by wins)
 * @param {number} limit - จำนวนที่ต้องการ (default 10)
 */
function getLeaderboard(limit = 10) {
    const allStats = Array.from(stats.values());
    
    // กรองเฉพาะคนที่เล่นแล้ว และเรียงตาม wins
    return allStats
        .filter(s => s.totalGames > 0)
        .sort((a, b) => {
            // เรียงตาม wins ก่อน
            if (b.wins !== a.wins) return b.wins - a.wins;
            // ถ้า wins เท่ากัน ดู win rate
            const aRate = a.totalGames > 0 ? a.wins / a.totalGames : 0;
            const bRate = b.totalGames > 0 ? b.wins / b.totalGames : 0;
            return bRate - aRate;
        })
        .slice(0, limit)
        .map((s, index) => ({
            rank: index + 1,
            playerId: s.playerId,
            playerName: s.playerName,
            totalGames: s.totalGames,
            wins: s.wins,
            losses: s.losses,
            winRate: s.totalGames > 0 ? Math.round((s.wins / s.totalGames) * 100) : 0
        }));
}

// โหลดสถิติเมื่อเริ่มต้น (สำหรับ backward compatibility)
loadStatsFromFile();

module.exports = {
    initStatsManager,
    recordGameEnd,
    getStats,
    initializeStats,
    getGameHistory,
    updatePlayerNameInStats,
    repairStatsPlayerNames,
    getAllStats,
    resetPlayerStats,
    editPlayerStats,
    deletePlayerStats,
    clearAllStats,
    bulkDeleteStats,
    getLeaderboard,
    saveStats
};
