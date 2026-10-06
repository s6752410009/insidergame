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

const { STATS_FILE } = require('./dataPaths');
const MAX_GAME_HISTORY = 20;

function isBotPlayerId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

const WEREWOLF_ROLE_IDS = ['villager', 'werewolf', 'alphaWolf', 'mayor', 'bodyguard', 'seer', 'doctor', 'witch', 'fool', 'revealer'];
const BLACKMARKET_ROLE_IDS = ['boss', 'broker', 'smuggler', 'fixer', 'hitman', 'mole', 'doubleAgent'];
const WEREWOLF_ROLE_LABELS = {
    villager: 'ชาวบ้าน',
    werewolf: 'หมาป่า',
    alphaWolf: 'อัลฟ่าหมาป่า',
    mayor: 'นายก',
    bodyguard: 'บอดี้การ์ด',
    seer: 'ผู้หยั่งรู้',
    oracle: 'นักพยากรณ์',
    doctor: 'หมอ',
    witch: 'แม่มด',
    tracker: 'นักสอดแนม',
    vigilante: 'ศาลเตี้ย',
    hunter: 'พราน',
    cleric: 'นักบวช',
    fool: 'คนบ้า',
    revealer: 'จอมเปิดโปง'
};
const BLACKMARKET_ROLE_LABELS = {
    boss: 'เจ้าพ่อ',
    broker: 'นายหน้า',
    smuggler: 'คนส่งของ',
    fixer: 'คนเคลียร์ทาง',
    hitman: 'มือเก็บงาน',
    mole: 'สายข่าว',
    doubleAgent: 'สองหน้า'
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

function createDefaultBlackMarketRoleStats() {
    return {
        boss: 0,
        broker: 0,
        smuggler: 0,
        fixer: 0,
        hitman: 0,
        mole: 0,
        doubleAgent: 0
    };
}

function createDefaultRoleStats() {
    return {
        gameMasterCount: 0,
        traitorCount: 0,
        citizenCount: 0,
        werewolf: createDefaultWerewolfRoleStats(),
        blackmarket: createDefaultBlackMarketRoleStats()
    };
}

function createDefaultWinByRole() {
    return {
        winAsTraitor: 0,
        winAsCitizen: 0,
        werewolf: createDefaultWerewolfRoleStats(),
        blackmarket: createDefaultBlackMarketRoleStats()
    };
}

const GAME_MODES = ['insider', 'werewolf', 'blackmarket', 'spyfall', 'undercover', 'coup', 'avalon', 'liar', 'poker5', 'poker4', 'pokdeng', 'wavelength'];
GAME_MODES.push('codenames');
GAME_MODES.push('drawguess');
GAME_MODES.push('colorcards');
GAME_MODES.push('setthi');

function createDefaultModeStats() {
    return {
        insider: { games: 0, wins: 0, losses: 0 },
        werewolf: { games: 0, wins: 0, losses: 0 },
        blackmarket: { games: 0, wins: 0, losses: 0 },
        spyfall: { games: 0, wins: 0, losses: 0 },
        undercover: { games: 0, wins: 0, losses: 0 },
        coup: { games: 0, wins: 0, losses: 0 },
        avalon: { games: 0, wins: 0, losses: 0 },
        liar: { games: 0, wins: 0, losses: 0 },
        poker5: { games: 0, wins: 0, losses: 0 },
        poker4: { games: 0, wins: 0, losses: 0 },
        codenames: { games: 0, wins: 0, losses: 0 },
        pokdeng: { games: 0, wins: 0, losses: 0 },
        wavelength: { games: 0, wins: 0, losses: 0 },
        drawguess: { games: 0, wins: 0, losses: 0 },
        colorcards: { games: 0, wins: 0, losses: 0 },
        setthi: { games: 0, wins: 0, losses: 0 }
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

    const mode = GAME_MODES.includes(entry.mode) ? entry.mode : 'insider';
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

    const rawBlackMarketRoleStats = rawRoleStats.blackmarket || rawRoleStats.blackMarket || {};
    BLACKMARKET_ROLE_IDS.forEach(roleId => {
        stat.roleStats.blackmarket[roleId] = normalizeCounter(rawBlackMarketRoleStats[roleId]);
    });

    const rawWinByRole = rawStat.winByRole || {};
    stat.winByRole.winAsTraitor = normalizeCounter(rawWinByRole.winAsTraitor);
    stat.winByRole.winAsCitizen = normalizeCounter(rawWinByRole.winAsCitizen);

    const rawWerewolfWins = rawWinByRole.werewolf || rawWinByRole.werewolfWins || {};
    WEREWOLF_ROLE_IDS.forEach(roleId => {
        stat.winByRole.werewolf[roleId] = normalizeCounter(rawWerewolfWins[roleId]);
    });

    const rawBlackMarketWins = rawWinByRole.blackmarket || rawWinByRole.blackMarket || {};
    BLACKMARKET_ROLE_IDS.forEach(roleId => {
        stat.winByRole.blackmarket[roleId] = normalizeCounter(rawBlackMarketWins[roleId]);
    });

    const rawModeStats = rawStat.modeStats || {};
    GAME_MODES.forEach(mode => {
        const modeStat = rawModeStats[mode] || {};
        stat.modeStats[mode] = {
            games: normalizeCounter(modeStat.games),
            wins: normalizeCounter(modeStat.wins),
            losses: normalizeCounter(modeStat.losses)
        };
    });

    const hasAnyModeGames = GAME_MODES.some(mode => stat.modeStats[mode].games > 0);
    if (!hasAnyModeGames && stat.totalGames > 0) {
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
            if (isBotPlayerId(s.playerId)) return;
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
                    if (isBotPlayerId(playerId)) continue;
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
            if (isBotPlayerId(playerId)) continue;
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
            if (isBotPlayerId(playerId)) continue;
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
    if (isBotPlayerId(playerId)) return null;
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

    if (gameResult?.mode === 'blackmarket') {
        return recordBlackMarketGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'spyfall') {
        return recordSpyfallGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'undercover') {
        return recordUndercoverGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'coup') {
        return recordCoupGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'avalon') {
        return recordAvalonGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'liar') {
        return recordLiarGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'poker5' || gameResult?.mode === 'poker4') {
        return recordPokerHandEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'pokdeng') {
        return recordPokDengGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'codenames') {
        return recordCodenamesGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'wavelength') {
        return recordWavelengthGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'drawguess') {
        return recordDrawGuessGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'colorcards') {
        return recordColorCardsGameEnd(roomId, gameResult);
    }

    if (gameResult?.mode === 'setthi') {
        return recordSetthiGameEnd(roomId, gameResult);
    }

    return recordInsiderGameEnd(roomId, gameResult);
}

/** อวาลอน: ชนะ/แพ้ตามฝ่าย (ดี/ร้าย) — เกมที่ยกเลิกเพราะคนไม่พอไม่ต้องส่งมา */
function recordAvalonGameEnd(roomId, gameResult) {
    const { winner, players, roomName } = gameResult;
    if (!winner || !winner.team || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid avalon game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const teamLabel = winner.team === 'good' ? 'ฝ่ายดี' : 'ฝ่ายร้าย';

    players.forEach(player => {
        if (!player.playerId || !player.team || isBotPlayerId(player.playerId)) return;

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const playerWon = player.team === winner.team;

        stat.totalGames += 1;
        stat.modeStats.avalon.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.avalon.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.avalon.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'avalon',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            role: player.roleName || null,
            team: player.team,
            playerCount: players.length,
            winnerName: teamLabel,
            resultText: `${teamLabel}ชนะ${winner.text ? ' — ' + winner.text : ''}`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** Coup: ผู้รอดคนสุดท้ายชนะคนเดียว ที่เหลือแพ้ทั้งหมด (ไม่มีทีม) */
function recordCoupGameEnd(roomId, gameResult) {
    const { winner, players, roomName } = gameResult;
    if (!winner || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid coup game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();

    players.forEach(player => {
        if (!player.playerId || isBotPlayerId(player.playerId)) return;

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const playerWon = player.playerId === winner.playerId;

        stat.totalGames += 1;
        stat.modeStats.coup.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.coup.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.coup.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'coup',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName: winner.name || 'ไม่ทราบ',
            resultText: playerWon ? 'รอดเป็นคนสุดท้าย' : `${winner.name || 'คนอื่น'} รอดเป็นคนสุดท้าย`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** โกหก: ผู้รอดคนสุดท้ายชนะคนเดียว ที่เหลือแพ้ */
function recordLiarGameEnd(roomId, gameResult) {
    const { winner, players, roomName } = gameResult;
    if (!winner || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid liar game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();

    players.forEach(player => {
        if (!player.playerId || isBotPlayerId(player.playerId)) return;

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const playerWon = player.playerId === winner.playerId;

        stat.totalGames += 1;
        stat.modeStats.liar.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.liar.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.liar.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'liar',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName: winner.name || 'ไม่ทราบ',
            resultText: playerWon ? 'รอดเป็นคนสุดท้าย' : `${winner.name || 'คนอื่น'} รอดเป็นคนสุดท้าย`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

function recordPokerHandEnd(roomId, gameResult) {
    const mode = gameResult.mode === 'poker4' ? 'poker4' : 'poker5';
    const { winner, players, roomName, handNumber } = gameResult;
    if (!Array.isArray(players) || players.length === 0) {
        console.warn('Invalid poker hand result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const label = mode === 'poker4' ? 'สี่ใบเก' : 'ไพ่ 5 ใบ';

    players.forEach(player => {
        if (!player.playerId || player.sittingOut) return;
        if (isBotPlayerId(player.playerId)) return;

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const winnerIds = new Set(
            (Array.isArray(gameResult.winners) ? gameResult.winners : [])
                .map(row => row && row.playerId)
                .filter(Boolean)
        );
        if (winner?.playerId) winnerIds.add(winner.playerId);
        const playerWon = winnerIds.has(player.playerId);

        stat.totalGames += 1;
        stat.modeStats[mode].games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats[mode].wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats[mode].losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode,
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName: winner?.name || 'ไม่ทราบ',
            resultText: playerWon
                ? `${winnerIds.size > 1 ? 'เสมอมือที่' : 'ชนะมือที่'} ${handNumber || 1} (${label})`
                : `${winner?.name || 'คนอื่น'} ชนะมือที่ ${handNumber || 1}`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** ป๊อกเด้ง: จบโต๊ะแล้วชิปมากกว่าที่ลงทุน (รวมขอชิปใหม่) = ชนะ ไม่งั้นแพ้ — นับเจ้ามือด้วย */
function recordPokDengGameEnd(roomId, gameResult) {
    const { standings, roomName, handNumber } = gameResult;
    if (!Array.isArray(standings) || standings.length === 0) {
        console.warn('Invalid pokdeng game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    standings.forEach(row => {
        if (!row || !row.playerId || isBotPlayerId(row.playerId)) return;
        const stat = initializeStats(row.playerId, row.name);
        if (!stat) return;
        const playerWon = Number(row.net) > 0;

        stat.totalGames += 1;
        stat.modeStats.pokdeng.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.pokdeng.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.pokdeng.losses += 1;
        }

        const net = Number(row.net) || 0;
        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'pokdeng',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName: standings[0]?.name || 'ไม่ทราบ',
            resultText: `${net > 0 ? 'กำไร +' : (net < 0 ? 'ขาดทุน ' : 'เสมอตัว ')}${net === 0 ? '' : net} ชิปโต๊ะ · ${handNumber || 0} มือ`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** สายลับคำใบ้: ทีมที่ชนะได้ชนะทุกคน (หัวหน้า + ลูกทีม) อีกทีมแพ้ — ผู้ชม/คนที่ออกกลางเกมไม่นับ */
function recordCodenamesGameEnd(roomId, gameResult) {
    const { winner, players, roomName, winReason, remaining } = gameResult;
    if ((winner !== 'red' && winner !== 'blue') || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid codenames game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const teamLabel = winner === 'red' ? 'ทีมแดง' : 'ทีมน้ำเงิน';
    const reasonText = {
        words: 'เจอสายลับครบ',
        gift: 'อีกทีมเปิดคำสุดท้ายให้',
        assassin: 'อีกทีมเจอมือสังหาร',
        forfeit: 'อีกทีมไม่เหลือผู้เล่น'
    }[winReason] || '';

    players.forEach(player => {
        if (!player || !player.playerId || isBotPlayerId(player.playerId)) return;
        if (player.team !== 'red' && player.team !== 'blue') return;
        const stat = initializeStats(player.playerId, player.name);
        if (!stat) return;
        const playerWon = player.team === winner;

        stat.totalGames += 1;
        stat.modeStats.codenames.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.codenames.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.codenames.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'codenames',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            role: player.role === 'spymaster' ? 'หัวหน้า' : 'ลูกทีม',
            team: player.team,
            playerCount: players.length,
            winnerName: teamLabel,
            resultText: `${teamLabel}ชนะ${reasonText ? ' — ' + reasonText : ''}${remaining ? ` · เหลือแดง ${remaining.red || 0} / น้ำเงิน ${remaining.blue || 0}` : ''}`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** คลื่นความคิด: แต้มสูงสุดชนะ (เสมอกันชนะร่วม) — คนที่ออกกลางเกมก็นับถ้าเล่นไปแล้ว */
function recordWavelengthGameEnd(roomId, gameResult) {
    const { standings, roomName, rounds } = gameResult;
    if (!Array.isArray(standings) || standings.length === 0) {
        console.warn('Invalid wavelength game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const winnerNames = standings.filter(row => row.won).map(row => row.name);
    standings.forEach(row => {
        if (!row || !row.playerId || isBotPlayerId(row.playerId)) return;
        const stat = initializeStats(row.playerId, row.name);
        if (!stat) return;
        const playerWon = !!row.won;

        stat.totalGames += 1;
        stat.modeStats.wavelength.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.wavelength.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.wavelength.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'wavelength',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            playerCount: standings.length,
            winnerName: winnerNames.join(', ') || 'ไม่มี',
            resultText: `${Number(row.score) || 0} แต้ม · อันดับ ${row.rank || '-'}/${standings.length} · ${rounds || 0} รอบ`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** วาดแล้วทาย: แต้มสูงสุดตอนจบ = ชนะ (เสมอกันชนะร่วม) ที่เหลือแพ้ — ออกกลางเกมนับแพ้ */
function recordDrawGuessGameEnd(roomId, gameResult) {
    const { standings, winnerIds, roomName, rounds } = gameResult;
    if (!Array.isArray(standings) || standings.length === 0) {
        console.warn('Invalid drawguess game result data');
        return;
    }

    const winners = new Set(Array.isArray(winnerIds) ? winnerIds : []);
    const winnerName = standings.filter(row => winners.has(row.playerId)).map(row => row.name).join(', ') || 'ไม่มี';
    const gameTimestamp = new Date().toISOString();
    standings.forEach(row => {
        if (!row || !row.playerId || isBotPlayerId(row.playerId)) return;
        const stat = initializeStats(row.playerId, row.name);
        if (!stat) return;
        if (!stat.modeStats.drawguess) stat.modeStats.drawguess = { games: 0, wins: 0, losses: 0 };
        const playerWon = winners.has(row.playerId);

        stat.totalGames += 1;
        stat.modeStats.drawguess.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.drawguess.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.drawguess.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'drawguess',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName,
            playerCount: standings.length,
            resultText: `อันดับ ${row.rank || '-'} · ${Number(row.score) || 0} แต้ม${rounds ? ` · ${rounds} รอบ` : ''}${row.left ? ' (ออกกลางเกม)' : ''}`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** ไพ่ทิ้งสี: คนที่ชนะรอบ (โหมด 1 รอบ) หรือถึงแต้มเป้าก่อน = ชนะ คนอื่นแพ้ — ไม่บันทึกบอท */
function recordColorCardsGameEnd(roomId, gameResult) {
    const { winner, standings, roomName, rounds, target } = gameResult;
    if (!winner || !winner.playerId || !Array.isArray(standings) || standings.length === 0) {
        console.warn('Invalid colorcards game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    standings.forEach(row => {
        if (!row || !row.playerId || isBotPlayerId(row.playerId)) return;
        const stat = initializeStats(row.playerId, row.name);
        if (!stat) return;
        const playerWon = row.playerId === winner.playerId;

        stat.totalGames += 1;
        stat.modeStats.colorcards.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.colorcards.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.colorcards.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'colorcards',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName: winner.name || 'ไม่ทราบ',
            resultText: target
                ? `${winner.name || 'ไม่ทราบ'} ถึง ${target} แต้มก่อน · ${rounds || 1} รอบ`
                : `${winner.name || 'ไม่ทราบ'} ทิ้งหมดมือก่อน`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** เศรษฐี: คนที่ทรัพย์สินรวมสูงสุด (หรือรอดคนสุดท้าย) ชนะ — เสมอกันชนะร่วม · ไม่บันทึกบอท */
function recordSetthiGameEnd(roomId, gameResult) {
    const { winners, standings, roomName, reason } = gameResult;
    if (!Array.isArray(winners) || !winners.length || !Array.isArray(standings) || standings.length === 0) {
        console.warn('Invalid setthi game result data');
        return;
    }
    const winnerIds = new Set(winners.map(w => w && w.playerId).filter(Boolean));
    const winnerNames = winners.map(w => w.name || 'ไม่ทราบ').join(', ');
    const money = n => '฿' + Math.round(Number(n) || 0).toLocaleString('en-US');

    const gameTimestamp = new Date().toISOString();
    standings.forEach(row => {
        if (!row || !row.playerId || isBotPlayerId(row.playerId)) return;
        const stat = initializeStats(row.playerId, row.name);
        if (!stat) return;
        if (!stat.modeStats.setthi) stat.modeStats.setthi = { games: 0, wins: 0, losses: 0 };
        const playerWon = winnerIds.has(row.playerId);

        stat.totalGames += 1;
        stat.modeStats.setthi.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.setthi.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.setthi.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'setthi',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            won: playerWon,
            winnerName: winnerNames,
            resultText: `${winnerNames} ${winners.length > 1 ? 'ชนะร่วม' : 'ชนะ'} · ทรัพย์สิน ${money(winners[0].netWorth)}${reason && /หมดเวลา/.test(reason) ? ' · หมดเวลา' : ''}`
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

function recordSpyfallGameEnd(roomId, gameResult) {
    const { winner, players, roomName, locationName } = gameResult;

    if (!winner || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid spyfall game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const citizensWin = winner.team === 'citizens';
    const spyPlayerId = winner.spyPlayerId;

    players.forEach(player => {
        if (!player.playerId || !player.role || isBotPlayerId(player.playerId)) {
            return;
        }

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const isSpy = player.role === 'spy';
        const playerWon = citizensWin ? !isSpy : isSpy;

        stat.totalGames += 1;
        stat.modeStats.spyfall.games += 1;

        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.spyfall.wins += 1;
            if (isSpy) {
                stat.winByRole.winAsTraitor += 1;
            } else {
                stat.winByRole.winAsCitizen += 1;
            }
        } else {
            stat.losses += 1;
            stat.modeStats.spyfall.losses += 1;
        }

        if (isSpy) {
            stat.roleStats.traitorCount += 1;
        } else {
            stat.roleStats.citizenCount += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'spyfall',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            role: isSpy ? 'สายลับ' : 'พลเมือง',
            won: playerWon,
            location: locationName || winner.locationName || 'ไม่ทราบ',
            spyName: winner.spyName || 'ไม่ทราบ',
            citizensWon: citizensWin,
            playerCount: players.length
        });

        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

/** คำใครไม่เหมือน: ชนะ/แพ้ตามฝั่ง — พลเมือง / ฝ่ายแฝง (สายแฝง + Mr. White) / Mr. White ทายถูกชนะคนเดียว */
function recordUndercoverGameEnd(roomId, gameResult) {
    const { winner, players, roomName, pair } = gameResult;
    if (!winner || !winner.team || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid undercover game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const roleLabels = { civilian: 'พลเมือง', undercover: 'สายแฝง', mrwhite: 'Mr. White' };
    const winnerIds = new Set(Array.isArray(winner.winnerIds) ? winner.winnerIds : []);

    players.forEach(player => {
        if (!player.playerId || !player.role || isBotPlayerId(player.playerId)) return;

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const playerWon = winnerIds.size
            ? winnerIds.has(player.playerId)
            : (winner.team === 'civilians'
                ? player.role === 'civilian'
                : (winner.team === 'mrwhite' ? player.role === 'mrwhite' : player.role !== 'civilian'));

        stat.totalGames += 1;
        stat.modeStats.undercover.games += 1;
        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.undercover.wins += 1;
        } else {
            stat.losses += 1;
            stat.modeStats.undercover.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'undercover',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            role: roleLabels[player.role] || 'ไม่ทราบ',
            won: playerWon,
            winnerTeam: winner.team,
            resultText: `${winner.label || winner.team}ชนะ`,
            civilianWord: pair?.civilian || null,
            undercoverWord: pair?.undercover || null,
            playerCount: players.length
        });
        if (stat.gameHistory.length > MAX_GAME_HISTORY) {
            stat.gameHistory = stat.gameHistory.slice(0, MAX_GAME_HISTORY);
        }
    });

    saveStats();
}

function recordInsiderGameEnd(roomId, gameResult) {
    const { resultVote2, players, word, roomName } = gameResult;
    
    if (!resultVote2 || !players) {
        console.warn('Invalid game result data');
        return;
    }

    const hasWon = resultVote2.hasWon; // true = พลเมืองชนะ, false = จอมบงการชนะ
    // หมดเวลาโดยยังทายคำไม่ได้ → ทุกคนแพ้ (รวมจอมบงการและ GM)
    const everyoneLoses = !!resultVote2.everyoneLoses;
    const gameTimestamp = new Date().toISOString();
    const traitorName = resultVote2.finalTraitorName || 'ไม่ทราบ';

    // อัปเดตสถิติสำหรับทุกผู้เล่นในเกม
    players.forEach(player => {
        // player ต้องมี playerId และ role
        if (!player.playerId || !player.role || isBotPlayerId(player.playerId)) return;

        const playerId = player.playerId;
        const role = player.role;
        const stat = initializeStats(playerId, player.playerName || player.name);
        if (!stat) return;

        // อัปเดต totalGames
        stat.totalGames += 1;
        stat.modeStats.insider.games += 1;

        // คำนวณผลชนะ/แพ้
        let playerWon = false;
        
        // ตรวจสอบว่าเป็นผู้ชนะหรือไม่ (ตาม role)
        if (everyoneLoses) {
            stat.losses += 1;
            stat.modeStats.insider.losses += 1;
            if (role === 'จอมบงการ') stat.roleStats.traitorCount += 1;
            else if (role === 'ผู้ดำเนินเกม') stat.roleStats.gameMasterCount += 1;
            else stat.roleStats.citizenCount += 1;
        } else if (role === 'จอมบงการ') {
            // จอมบงการชนะ = พลเมืองแพ้
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
            everyoneLost: everyoneLoses,
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
        if (!player.playerId || !player.role || isBotPlayerId(player.playerId)) {
            return;
        }

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
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

function recordBlackMarketGameEnd(roomId, gameResult) {
    const { winner, players, roomName, roundNumber, maxRounds, reason } = gameResult;

    if (!winner || !Array.isArray(players) || players.length === 0) {
        console.warn('Invalid black market game result data');
        return;
    }

    const gameTimestamp = new Date().toISOString();
    const winnerId = winner.playerId;
    const winnerLabel = winner.name || 'ไม่ทราบ';
    // เสมอกันทุกเกณฑ์ = ชนะร่วม ทุกคนในกลุ่มผู้นำได้นับชนะ
    const blackMarketWinnerIds = new Set(
        Array.isArray(winner.playerIds) && winner.playerIds.length ? winner.playerIds : [winnerId]
    );

    players.forEach(player => {
        if (!player.playerId || !player.role || isBotPlayerId(player.playerId)) {
            return;
        }

        const stat = initializeStats(player.playerId, player.playerName || player.name);
        if (!stat) return;
        const roleId = player.role;
        const roleLabel = player.roleInfo?.title || player.revealedRole || BLACKMARKET_ROLE_LABELS[roleId] || roleId;
        const playerWon = blackMarketWinnerIds.has(player.playerId);

        stat.totalGames += 1;
        stat.modeStats.blackmarket.games += 1;
        stat.roleStats.blackmarket[roleId] = normalizeCounter(stat.roleStats.blackmarket[roleId]) + 1;

        if (playerWon) {
            stat.wins += 1;
            stat.modeStats.blackmarket.wins += 1;
            stat.winByRole.blackmarket[roleId] = normalizeCounter(stat.winByRole.blackmarket[roleId]) + 1;
        } else {
            stat.losses += 1;
            stat.modeStats.blackmarket.losses += 1;
        }

        stat.lastPlayedAt = gameTimestamp;
        stat.gameHistory.unshift({
            mode: 'blackmarket',
            date: gameTimestamp,
            roomId,
            roomName: roomName || 'ไม่ทราบ',
            roleId,
            role: roleLabel,
            won: playerWon,
            winner: winnerId,
            winnerLabel,
            winnerRole: winner.roleTitle || BLACKMARKET_ROLE_LABELS[winner.roleId] || '-',
            playerCount: players.length,
            roundNumber: normalizeCounter(roundNumber),
            maxRounds: normalizeCounter(maxRounds),
            survived: player.alive !== false,
            cash: normalizeCounter(player.cash),
            influence: normalizeCounter(player.influence),
            heat: normalizeCounter(player.heat),
            resultText: playerWon ? 'คุมเมืองสำเร็จ' : (reason || 'พลาดโต๊ะนี้')
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
 * รีเซ็ตสถิติทุกคนเพื่อเริ่ม season ใหม่
 * - เก็บ playerId/playerName ไว้ แต่ล้างตัวเลขทั้งหมดกลับเป็น 0 (รวม gameHistory)
 * - ผู้เล่นจะหายจาก leaderboard จนกว่าจะเล่นเกมแรกของ season ใหม่ (getLeaderboard กรอง totalGames > 0)
 * @returns {number} จำนวนผู้เล่นที่ถูกรีเซ็ต
 */
async function resetAllStatsForNewSeason() {
    let resetCount = 0;

    for (const [playerId, stat] of stats.entries()) {
        stats.set(playerId, createDefaultStatsRecord(playerId, stat.playerName));
        resetCount++;
    }

    if (resetCount > 0) {
        await saveStats();
    }

    return resetCount;
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

        if (newData.roleStats.blackmarket && typeof newData.roleStats.blackmarket === 'object') {
            BLACKMARKET_ROLE_IDS.forEach(roleId => {
                if (newData.roleStats.blackmarket[roleId] !== undefined) {
                    stat.roleStats.blackmarket[roleId] = normalizeCounter(newData.roleStats.blackmarket[roleId]);
                }
            });
        }
    }

    if (newData.modeStats && typeof newData.modeStats === 'object') {
        GAME_MODES.forEach(mode => {
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
 * ดึง Leaderboard (เรียงตาม wins)
 * @param {number | undefined} limit - จำนวนที่ต้องการ ถ้าไม่ส่งจะคืนทั้งหมด
 * @param {string | undefined} mode - insider/werewolf/spyfall/coup/blackmarket/liar หรือไม่ส่ง = รวมทุกโหมด
 */
function getLeaderboard(limit, mode) {
    const rankedMode = GAME_MODES.includes(mode) ? mode : null;

    const rankedPlayers = Array.from(stats.values())
        .map(stat => {
            if (!rankedMode) {
                return {
                    playerId: stat.playerId,
                    playerName: stat.playerName,
                    totalGames: stat.totalGames,
                    wins: stat.wins,
                    losses: stat.losses
                };
            }

            const modeStat = (stat.modeStats && stat.modeStats[rankedMode]) || { games: 0, wins: 0, losses: 0 };
            return {
                playerId: stat.playerId,
                playerName: stat.playerName,
                totalGames: modeStat.games,
                wins: modeStat.wins,
                losses: modeStat.losses
            };
        })
        .filter(s => s.totalGames > 0 && !isBotPlayerId(s.playerId))
        .sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;

            const aRate = a.totalGames > 0 ? a.wins / a.totalGames : 0;
            const bRate = b.totalGames > 0 ? b.wins / b.totalGames : 0;
            return bRate - aRate;
        })
        .map((s, index) => ({
            rank: index + 1,
            playerId: s.playerId,
            playerName: s.playerName,
            totalGames: s.totalGames,
            wins: s.wins,
            losses: s.losses,
            winRate: s.totalGames > 0 ? Math.round((s.wins / s.totalGames) * 100) : 0,
            mode: rankedMode || 'all'
        }));

    if (Number.isFinite(limit) && limit > 0) {
        return rankedPlayers.slice(0, limit);
    }

    return rankedPlayers;
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
    resetAllStatsForNewSeason,
    editPlayerStats,
    deletePlayerStats,
    clearAllStats,
    bulkDeleteStats,
    getLeaderboard,
    GAME_MODES,
    saveStats
};
