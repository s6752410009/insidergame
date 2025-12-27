/**
 * StatsManager - จัดการสถิติผู้เล่น
 * - บันทึกสถิติเมื่อเกมจบ
 * - เก็บข้อมูล: totalGames, wins, losses, roleStats, winByRole
 * - ใช้ playerId เป็น key
 */

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '../data/playerStats.json');

// เก็บสถิติใน memory (key: playerId)
const stats = new Map();

// สร้างโฟลเดอร์ data ถ้ายังไม่มี
const dataDir = path.dirname(STATS_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * โหลดสถิติจากไฟล์
 */
function loadStats() {
    if (fs.existsSync(STATS_FILE)) {
        try {
            const data = fs.readFileSync(STATS_FILE, 'utf8');
            const statsData = JSON.parse(data);
            // โหลดเข้า Map
            for (const [playerId, stat] of Object.entries(statsData)) {
                stats.set(playerId, stat);
            }
            console.log(`Loaded stats for ${stats.size} players`);
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
}

/**
 * บันทึกสถิติลงไฟล์
 */
function saveStats() {
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
function resetPlayerStats(playerId) {
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
        saveStats();
        return true;
    }
    return false;
}

/**
 * ลบสถิติผู้เล่น (สำหรับ admin)
 */
function deletePlayerStats(playerId) {
    if (stats.has(playerId)) {
        stats.delete(playerId);
        saveStats();
        return true;
    }
    return false;
}

/**
 * ลบสถิติทั้งหมด (Clear All)
 */
function clearAllStats() {
    const count = stats.size;
    stats.clear();
    saveStats();
    return count;
}

/**
 * ลบสถิติหลายคน (Bulk Delete)
 * @param {Array} playerIds - รายการ playerId ที่ต้องการลบ
 */
function bulkDeleteStats(playerIds) {
    let deletedCount = 0;
    playerIds.forEach(playerId => {
        if (stats.has(playerId)) {
            stats.delete(playerId);
            deletedCount++;
        }
    });
    if (deletedCount > 0) {
        saveStats();
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

// โหลดสถิติเมื่อเริ่มต้น
loadStats();

module.exports = {
    recordGameEnd,
    getStats,
    getGameHistory,
    updatePlayerNameInStats,
    getAllStats,
    resetPlayerStats,
    deletePlayerStats,
    clearAllStats,
    bulkDeleteStats,
    getLeaderboard,
    saveStats
};
