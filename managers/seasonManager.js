/**
 * SeasonManager - จัดการ season ของ leaderboard
 * - เก็บ snapshot อันดับของ season ที่ปิดไปแล้วไว้ใน data/seasons.json
 * - อันดับของ season ปัจจุบันยังคำนวณสดจาก statsManager.getLeaderboard() เหมือนเดิม
 * - ไฟล์นี้เก็บเฉพาะ "ประวัติ" ไม่แตะสถิติสด
 */

const fs = require('fs');
const path = require('path');

const { DATA_DIR, SEASONS_FILE, PLAYERS_FILE, BACKUP_DIR } = require('./dataPaths');

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

const SEASON_DOC_KEY = 'seasons';
let SeasonArchive = null;
let useDatabase = false;

try {
    ({ SeasonArchive } = require('./models'));
} catch (error) {
    SeasonArchive = null;
}

/**
 * โหลด season จาก Mongo ถ้าต่อได้ ไม่งั้นใช้ไฟล์
 *
 * ดิสก์ของ Render เป็น ephemeral — data/seasons.json หายทุกครั้งที่ deploy
 * ประวัติ Season ที่ปิดไปแล้วเลยหายเกลี้ยง ทั้งที่ผู้เล่นกับสถิติอยู่ใน Mongo รอดมาตลอด
 */
async function initSeasonManager() {
    try {
        const { isDBConnected } = require('./database');
        useDatabase = Boolean(SeasonArchive && isDBConnected());
    } catch (error) {
        useDatabase = false;
    }

    if (!useDatabase) {
        loadSeasons();
        console.log(`📁 SeasonManager using JSON file (season ${getSeasonData().current.number})`);
        return getSeasonData();
    }

    try {
        const doc = await SeasonArchive.findOne({ key: SEASON_DOC_KEY }).lean();
        if (doc?.payload) {
            seasonData = null;
            applyLoadedSeasonPayload(doc.payload);
            console.log(`✅ SeasonManager using MongoDB (season ${getSeasonData().current.number}, archived ${getSeasonData().archived.length})`);
            return getSeasonData();
        }

        // ยังไม่มีใน Mongo — ย้ายของเดิมจากไฟล์ขึ้นไปครั้งเดียว
        loadSeasons();
        await persistSeasons();
        console.log(`✅ SeasonManager migrated ${getSeasonData().archived.length} archived season(s) to MongoDB`);
    } catch (error) {
        console.error('[SeasonManager] Mongo load failed, falling back to file:', error.message);
        useDatabase = false;
        loadSeasons();
    }

    return getSeasonData();
}

function applyLoadedSeasonPayload(raw) {
    seasonData = createDefaultSeasonData();
    if (!raw || typeof raw !== 'object') {
        return;
    }

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

async function persistSeasons() {
    if (!useDatabase || !SeasonArchive) {
        return false;
    }
    await SeasonArchive.updateOne(
        { key: SEASON_DOC_KEY },
        { $set: { key: SEASON_DOC_KEY, payload: getSeasonData(), updatedAt: new Date() } },
        { upsert: true }
    );
    return true;
}

function saveSeasons() {
    // เขียนไฟล์ไว้เสมอเพื่อเป็น backup ในเครื่อง ส่วน Mongo คือตัวจริงตอนอยู่บนโปรดักชัน
    let ok = true;
    try {
        fs.writeFileSync(SEASONS_FILE, JSON.stringify(getSeasonData(), null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving seasons:', error.message);
        ok = false;
    }

    if (useDatabase) {
        persistSeasons().catch(error => {
            console.error('[SeasonManager] Could not save seasons to MongoDB:', error.message);
        });
    }

    return ok;
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
    initSeasonManager,
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
