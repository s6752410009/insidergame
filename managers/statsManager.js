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

// เก็บสถิติใน memory (key: playerId)
const stats = new Map();

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
            stats.set(s.playerId, {
                playerId: s.playerId,
                playerName: s.playerName,
                totalGames: s.totalGames || 0,
                wins: s.wins || 0,
                losses: s.losses || 0,
                roleStats: s.roleStats || {
                    gameMasterCount: 0,
                    traitorCount: 0,
                    citizenCount: 0
                },
                winByRole: s.winByRole || {
                    winAsTraitor: 0,
                    winAsCitizen: 0
                },
                lastPlayedAt: s.lastPlayedAt || null,
                gameHistory: s.gameHistory || []
            });
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
                    stats.set(playerId, stat);
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

/**
 * สร้างสถิติเริ่มต้นสำหรับผู้เล่น
 */
function initializeStats(playerId, playerName) {
    if (!stats.has(playerId)) {
        stats.set(playerId, {
            playerId,
            playerName,
            totalGames: 0,
            wins: 0,
            losses: 0,
            roleStats: {
                gameMasterCount: 0,
                traitorCount: 0,
                citizenCount: 0
            },
            winByRole: {
                winAsTraitor: 0,
                winAsCitizen: 0
            },
            lastPlayedAt: null,
            gameHistory: [] // เพิ่ม: ประวัติเกมล่าสุด (เก็บ 20 เกมล่าสุด)
        });
    }
    // Migrate old stats that don't have gameHistory
    const stat = stats.get(playerId);
    if (!stat.gameHistory) {
        stat.gameHistory = [];
    }
    return stat;
}

/**
 * บันทึกสถิติเมื่อเกมจบ
 * @param {string} roomId - ID ของห้อง
 * @param {Object} gameResult - ผลการเล่นเกม { resultVote2, players, word, roomName }
 */
function recordGameEnd(roomId, gameResult) {
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

        // คำนวณผลชนะ/แพ้
        let playerWon = false;
        
        // ตรวจสอบว่าเป็นผู้ชนะหรือไม่ (ตาม role)
        if (role === 'ผู้ทรยศ') {
            // ผู้ทรยศชนะ = พลเมืองแพ้
            if (!hasWon) {
                stat.wins += 1;
                stat.winByRole.winAsTraitor += 1;
                playerWon = true;
            } else {
                stat.losses += 1;
            }
            stat.roleStats.traitorCount += 1;
        } else if (role === 'ผู้ดำเนินเกม') {
            // GM ไม่นับเป็น win/loss แต่บันทึก role
            stat.roleStats.gameMasterCount += 1;
            // GM ถือว่าชนะถ้าพลเมืองชนะ
            if (hasWon) {
                stat.wins += 1;
                playerWon = true;
            } else {
                stat.losses += 1;
            }
        } else {
            // พลเมือง (หรือ defaultRole)
            if (hasWon) {
                stat.wins += 1;
                stat.winByRole.winAsCitizen += 1;
                playerWon = true;
            } else {
                stat.losses += 1;
            }
            stat.roleStats.citizenCount += 1;
        }

        // อัปเดต lastPlayedAt
        stat.lastPlayedAt = gameTimestamp;
        
        // บันทึกประวัติเกม
        const gameEntry = {
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
        if (stat.gameHistory.length > 20) {
            stat.gameHistory = stat.gameHistory.slice(0, 20);
        }
    });

    // บันทึกลงไฟล์
    saveStats();
}

/**
 * ดึงสถิติผู้เล่น
 */
function getStats(playerId) {
    if (!stats.has(playerId)) {
        return initializeStats(playerId, 'Unknown');
    }
    return stats.get(playerId);
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
        const stat = stats.get(playerId);
        stat.totalGames = 0;
        stat.wins = 0;
        stat.losses = 0;
        stat.roleStats = {
            gameMasterCount: 0,
            traitorCount: 0,
            citizenCount: 0
        };
        stat.winByRole = {
            winAsTraitor: 0,
            winAsCitizen: 0
        };
        stat.lastPlayedAt = null;
        stat.gameHistory = [];
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
        stats.set(playerId, {
            playerId,
            playerName: newData.playerName || 'Unknown',
            totalGames: 0,
            wins: 0,
            losses: 0,
            roleStats: { gameMasterCount: 0, traitorCount: 0, citizenCount: 0 },
            winByRole: { winAsTraitor: 0, winAsCitizen: 0 },
            lastPlayedAt: new Date(),
            gameHistory: []
        });
    }
    
    const stat = stats.get(playerId);
    
    // อัพเดทค่าที่ส่งมา
    if (newData.playerName !== undefined) stat.playerName = newData.playerName;
    if (newData.totalGames !== undefined) stat.totalGames = newData.totalGames;
    if (newData.wins !== undefined) stat.wins = newData.wins;
    if (newData.losses !== undefined) stat.losses = newData.losses;
    if (newData.roleStats) {
        if (newData.roleStats.gameMasterCount !== undefined) stat.roleStats.gameMasterCount = newData.roleStats.gameMasterCount;
        if (newData.roleStats.traitorCount !== undefined) stat.roleStats.traitorCount = newData.roleStats.traitorCount;
        if (newData.roleStats.citizenCount !== undefined) stat.roleStats.citizenCount = newData.roleStats.citizenCount;
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
    getGameHistory,
    updatePlayerNameInStats,
    getAllStats,
    resetPlayerStats,
    editPlayerStats,
    deletePlayerStats,
    clearAllStats,
    bulkDeleteStats,
    getLeaderboard,
    saveStats
};
