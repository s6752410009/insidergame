/**
 * SeasonManager - จัดการ season ของ leaderboard
 * - เก็บ snapshot อันดับของ season ที่ปิดไปแล้วไว้ใน data/seasons.json
 * - อันดับของ season ปัจจุบันยังคำนวณสดจาก statsManager.getLeaderboard() เหมือนเดิม
 * - ไฟล์นี้เก็บเฉพาะ "ประวัติ" ไม่แตะสถิติสด
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const SEASONS_FILE = path.join(DATA_DIR, 'seasons.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// { current: { number, name, startedAt }, archived: [ { number, name, ... , entries: [] } ] }
let seasonData = null;

function createDefaultSeasonData() {
    return {
        current: {
            number: 1,
            name: 'Season 1',
            startedAt: null
        },
        archived: []
    };
}

function normalizeSeasonEntry(rawEntry, fallbackRank) {
    if (!rawEntry || typeof rawEntry !== 'object') {
        return null;
    }

    const totalGames = Number(rawEntry.totalGames) || 0;
    const wins = Number(rawEntry.wins) || 0;

    return {
        rank: Number(rawEntry.rank) || fallbackRank,
        playerId: rawEntry.playerId || null,
        playerName: rawEntry.playerName || 'Unknown',
        totalGames,
        wins,
        losses: Number(rawEntry.losses) || 0,
        winRate: Number.isFinite(Number(rawEntry.winRate))
            ? Number(rawEntry.winRate)
            : (totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0)
    };
}

function normalizeArchivedSeason(rawSeason, fallbackNumber) {
    if (!rawSeason || typeof rawSeason !== 'object') {
        return null;
    }

    const number = Number(rawSeason.number) || fallbackNumber;
    const entries = Array.isArray(rawSeason.entries)
        ? rawSeason.entries.map((entry, index) => normalizeSeasonEntry(entry, index + 1)).filter(Boolean)
        : [];

    return {
        number,
        name: rawSeason.name || `Season ${number}`,
        startedAt: rawSeason.startedAt || null,
        endedAt: rawSeason.endedAt || null,
        totalPlayers: Number(rawSeason.totalPlayers) || entries.length,
        totalGames: Number(rawSeason.totalGames) || 0,
        backupFile: rawSeason.backupFile || null,
        entries
    };
}

function loadSeasons() {
    seasonData = createDefaultSeasonData();

    if (!fs.existsSync(SEASONS_FILE)) {
        return seasonData;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(SEASONS_FILE, 'utf8'));

        if (raw && typeof raw === 'object') {
            if (Array.isArray(raw.archived)) {
                seasonData.archived = raw.archived
                    .map((season, index) => normalizeArchivedSeason(season, index + 1))
                    .filter(Boolean)
                    .sort((a, b) => b.number - a.number);
            }

            if (raw.current && typeof raw.current === 'object') {
                const number = Number(raw.current.number) || (seasonData.archived.length + 1);
                seasonData.current = {
                    number,
                    name: raw.current.name || `Season ${number}`,
                    startedAt: raw.current.startedAt || null
                };
            }
        }
    } catch (error) {
        console.error('Error loading seasons:', error.message);
        seasonData = createDefaultSeasonData();
    }

    return seasonData;
}

function getSeasonData() {
    if (!seasonData) {
        loadSeasons();
    }
    return seasonData;
}

function saveSeasons() {
    try {
        fs.writeFileSync(SEASONS_FILE, JSON.stringify(getSeasonData(), null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving seasons:', error.message);
        return false;
    }
}

/**
 * season ที่กำลังเล่นอยู่ (อันดับสดมาจาก statsManager)
 */
function getCurrentSeason() {
    return { ...getSeasonData().current };
}

/**
 * รายการ season ที่ปิดไปแล้ว (ไม่รวมตารางอันดับ เอาไว้ทำแท็บ)
 */
function listArchivedSeasons() {
    return getSeasonData().archived.map(season => ({
        number: season.number,
        name: season.name,
        startedAt: season.startedAt,
        endedAt: season.endedAt,
        totalPlayers: season.totalPlayers,
        totalGames: season.totalGames
    }));
}

/**
 * ดึง season ที่ปิดไปแล้วพร้อมตารางอันดับเต็ม
 * @param {number} number - เลข season
 */
function getArchivedSeason(number) {
    const seasonNumber = Number(number);
    if (!Number.isFinite(seasonNumber)) {
        return null;
    }
    return getSeasonData().archived.find(season => season.number === seasonNumber) || null;
}

/**
 * ปิด season ปัจจุบัน เก็บอันดับเป็นประวัติ แล้วเปิด season ถัดไป
 * @param {Object} options
 * @param {Array} options.entries - ผลอันดับจาก statsManager.getLeaderboard()
 * @param {number} [options.totalGames] - จำนวนเกมรวมของ season
 * @param {string} [options.backupFile] - path ไฟล์สำรอง playerStats ของ season นี้
 * @param {string} [options.startedAt] - เวลาเริ่ม season (ใช้เติมย้อนหลังถ้ายังไม่เคยบันทึก)
 * @param {string} options.endedAt - เวลาปิด season (ISO string)
 * @returns {{ archived: Object, current: Object }}
 */
function archiveCurrentSeason(options = {}) {
    const data = getSeasonData();
    const endedAt = options.endedAt || new Date().toISOString();
    const entries = Array.isArray(options.entries)
        ? options.entries.map((entry, index) => normalizeSeasonEntry(entry, index + 1)).filter(Boolean)
        : [];

    const archivedSeason = {
        number: data.current.number,
        name: data.current.name,
        startedAt: data.current.startedAt || options.startedAt || null,
        endedAt,
        totalPlayers: entries.length,
        totalGames: Number(options.totalGames) || 0,
        backupFile: options.backupFile || null,
        entries
    };

    data.archived = [archivedSeason, ...data.archived].sort((a, b) => b.number - a.number);

    const nextNumber = archivedSeason.number + 1;
    data.current = {
        number: nextNumber,
        name: `Season ${nextNumber}`,
        startedAt: endedAt
    };

    saveSeasons();

    return { archived: archivedSeason, current: { ...data.current } };
}

/**
 * เดาเวลาเริ่ม season ย้อนหลัง ถ้ายังไม่เคยบันทึกไว้ (ใช้ createdAt ที่เก่าที่สุดใน players.json)
 */
function guessSeasonStartedAt() {
    if (!fs.existsSync(PLAYERS_FILE)) {
        return null;
    }

    try {
        const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
        let earliest = null;

        for (const player of Object.values(players || {})) {
            const createdAt = player && player.createdAt ? new Date(player.createdAt) : null;
            if (createdAt && !Number.isNaN(createdAt.getTime())) {
                if (!earliest || createdAt < earliest) {
                    earliest = createdAt;
                }
            }
        }

        return earliest ? earliest.toISOString() : null;
    } catch (error) {
        console.warn('อ่าน players.json ไม่ได้:', error.message);
        return null;
    }
}

/**
 * สำรองสถิติดิบทั้งหมดก่อนรีเซ็ต
 * ดึงจาก statsManager แทนการ copy ไฟล์ เพื่อให้ได้ backup ครบทั้งตอนใช้ JSON และ MongoDB
 * (snapshot ใน seasons.json เก็บแค่ตารางอันดับ — roleStats/winByRole/modeStats/gameHistory
 * อยู่ในไฟล์นี้ที่เดียว ถ้าไม่สำรองไว้จะกู้ไม่ได้)
 * @param {number} seasonNumber
 * @param {Array} allStats - ผลจาก statsManager.getAllStats()
 * @returns {string | null} path แบบ relative หรือ null ถ้าสำรองไม่สำเร็จ
 */
function backupStatsFile(seasonNumber, allStats) {
    if (!Array.isArray(allStats) || allStats.length === 0) {
        return null;
    }

    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }

        // เก็บรูปแบบเดียวกับ playerStats.json (object keyed by playerId) เพื่อให้กู้กลับได้ตรงๆ
        const snapshot = {};
        for (const stat of allStats) {
            if (stat && stat.playerId) {
                snapshot[stat.playerId] = stat;
            }
        }

        const backupPath = path.join(BACKUP_DIR, `playerStats-season-${seasonNumber}.json`);
        fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), 'utf8');
        return path.relative(path.join(__dirname, '..'), backupPath);
    } catch (error) {
        console.error('สำรองสถิติดิบไม่สำเร็จ:', error.message);
        return null;
    }
}

/**
 * สรุปสถานะ season ปัจจุบันก่อนรีเซ็ต (ไว้ให้หน้า admin ยืนยันก่อนกด)
 */
function getSeasonResetPreview() {
    const statsManager = require('./statsManager');
    const allStats = statsManager.getAllStats();

    return {
        season: getCurrentSeason(),
        rankedCount: statsManager.getLeaderboard().length,
        totalPlayers: allStats.length,
        totalGames: allStats.reduce((sum, stat) => sum + (Number(stat.totalGames) || 0), 0)
    };
}

/**
 * ปิด season ปัจจุบันแบบครบวงจร: สำรองสถิติดิบ → เก็บอันดับเป็นประวัติ → รีเซ็ตสถิติทุกคน
 * ใช้ร่วมกันระหว่าง CLI (scripts/reset-season.js) กับปุ่มในหน้า admin
 * @param {Object} [options]
 * @param {boolean} [options.allowWithoutBackup=false] - ยอมรีเซ็ตแม้สำรองไฟล์ไม่สำเร็จ
 * @returns {Promise<{ archived: Object, current: Object, resetCount: number, backupFile: string|null }>}
 */
async function runSeasonReset(options = {}) {
    const statsManager = require('./statsManager');
    const preview = getSeasonResetPreview();
    const entries = statsManager.getLeaderboard();

    if (entries.length === 0) {
        throw new Error('ยังไม่มีใครติดอันดับใน season นี้ — ไม่มีอะไรให้เก็บเป็นประวัติ');
    }

    const backupFile = backupStatsFile(preview.season.number, statsManager.getAllStats());

    // ไม่มี backup = roleStats/gameHistory กู้ไม่ได้ ต้องยืนยันชัดเจนก่อนถึงจะยอมเดินต่อ
    if (!backupFile && !options.allowWithoutBackup) {
        throw new Error('สำรองสถิติดิบไม่สำเร็จ (เขียน data/backups/ ไม่ได้?) — ยกเลิกการรีเซ็ตเพื่อกันข้อมูลหาย');
    }

    const { archived, current } = archiveCurrentSeason({
        entries,
        totalGames: preview.totalGames,
        backupFile,
        startedAt: guessSeasonStartedAt(),
        endedAt: new Date().toISOString()
    });

    const resetCount = await statsManager.resetAllStatsForNewSeason();

    return { archived, current, resetCount, backupFile };
}

loadSeasons();

module.exports = {
    SEASONS_FILE,
    loadSeasons,
    saveSeasons,
    getCurrentSeason,
    listArchivedSeasons,
    getArchivedSeason,
    archiveCurrentSeason,
    getSeasonResetPreview,
    runSeasonReset
};
