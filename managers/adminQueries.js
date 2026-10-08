/**
 * ค้นหา/กรอง/เรียง/แบ่งหน้า ข้อมูลหลังบ้านฝั่ง server
 *
 * เดิมหน้า /admin ดึงผู้เล่น + สถิติ (รวม gameHistory ทุกคน) + ห้องทั้งหมดในก้อนเดียว (admin_getData)
 * แล้วค่อยกรองในเบราว์เซอร์ — ข้อมูลหลักพันคนก้อนเดียวหลายสิบ MB ทุก 15 วิ
 * ตอนนี้ส่งแค่หน้าที่ดูอยู่ และตัด field ที่ตารางไม่ใช้ทิ้ง
 *
 * ทุกฟังก์ชันเป็น pure (รับ array คืนผลลัพธ์) เทสได้โดยไม่ต้องเปิดเซิร์ฟเวอร์
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const STATS_MODES = ['insider', 'werewolf', 'blackmarket', 'spyfall', 'undercover', 'coup', 'avalon', 'liar',
    'poker5', 'poker4', 'pokdeng', 'codenames', 'wavelength', 'drawguess', 'colorcards', 'setthi'];

function compareValues(a, b, dir) {
    if (a < b) return dir === 'asc' ? -1 : 1;
    if (a > b) return dir === 'asc' ? 1 : -1;
    return 0;
}

function lower(value) {
    return String(value || '').toLowerCase();
}

function normalizePaging(query = {}) {
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(query.pageSize) || DEFAULT_PAGE_SIZE)));
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    return { page, pageSize };
}

function paginate(list, query, total, project = item => item) {
    const { page, pageSize } = normalizePaging(query);
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    const current = Math.min(page, pages);
    const start = (current - 1) * pageSize;
    return {
        rows: list.slice(start, start + pageSize).map(project),
        page: current,
        pages,
        pageSize,
        filtered: list.length,
        total
    };
}

// ---------- ผู้เล่น ----------

function playerStatusKey(player, now = Date.now()) {
    if (player.isBanned) return 'banned';
    if (player.isCleanupCandidate) return 'cleanup';
    const lastSeen = player.lastSeen ? new Date(player.lastSeen).getTime() : 0;
    return lastSeen && now - lastSeen < ONLINE_WINDOW_MS ? 'online' : 'offline';
}

const PLAYER_STATUS_SCORE = { online: 3, offline: 2, cleanup: 1, banned: 0 };

function projectPlayer(player) {
    return {
        playerId: player.playerId,
        playerName: player.playerName,
        displayName: player.displayName,
        color: player.color,
        category: player.category,
        categoryLabel: player.categoryLabel,
        isCleanupCandidate: Boolean(player.isCleanupCandidate),
        isBanned: Boolean(player.isBanned),
        isPendingApproval: Boolean(player.isPendingApproval),
        approved: player.approved,
        isSiteAdmin: Boolean(player.isSiteAdmin),
        totalGames: player.totalGames || 0,
        lastSeen: player.lastSeen || null,
        inRooms: (player.inRooms || []).map(room => ({ roomId: room.roomId, roomName: room.roomName, online: room.online }))
    };
}

function queryPlayers(players, query = {}, now = Date.now()) {
    const search = lower(query.search).trim();
    const typeFilter = query.typeFilter || 'all';
    const statusFilter = query.statusFilter || 'all';
    const sortCol = query.sortCol || 'lastSeen';
    const dir = query.sortDir === 'asc' ? 'asc' : 'desc';

    const filtered = players.filter(player => {
        if (typeFilter !== 'all' && (player.category || 'unknown') !== typeFilter) return false;
        if (statusFilter !== 'all' && playerStatusKey(player, now) !== statusFilter) return false;
        if (search && !`${player.playerName || ''} ${player.playerId || ''} ${player.category || ''}`.toLowerCase().includes(search)) return false;
        return true;
    });
    const value = player => {
        switch (sortCol) {
            case 'name': return lower(player.playerName);
            case 'category': return player.category || '';
            case 'id': return player.playerId || '';
            case 'status': return PLAYER_STATUS_SCORE[playerStatusKey(player, now)];
            case 'games': return player.totalGames || 0;
            case 'lastSeen':
            default: return player.lastSeen ? new Date(player.lastSeen).getTime() : 0;
        }
    };
    filtered.sort((a, b) => compareValues(value(a), value(b), dir) || compareValues(lower(a.playerName), lower(b.playerName), 'asc'));
    return paginate(filtered, query, players.length, projectPlayer);
}

// ---------- ห้อง ----------

function queryRooms(rooms, query = {}) {
    const search = lower(query.search).trim();
    const modeFilter = query.modeFilter || 'all';
    const statusFilter = query.statusFilter || 'all';
    const sortCol = query.sortCol || 'players';
    const dir = query.sortDir === 'asc' ? 'asc' : 'desc';
    const filtered = rooms.filter(room => {
        const mode = room.gameMode || 'insider';
        const status = room.gameStatus === 'playing' ? 'playing' : 'waiting';
        const lockStatus = room.locked ? 'locked' : 'unlocked';
        if (modeFilter !== 'all' && mode !== modeFilter) return false;
        if (statusFilter !== 'all' && status !== statusFilter && lockStatus !== statusFilter) return false;
        if (search && !`${room.name || ''} ${room.roomId || ''} ${mode} ${(room.playerNames || []).join(' ')}`.toLowerCase().includes(search)) return false;
        return true;
    });
    const value = room => {
        switch (sortCol) {
            case 'name': return lower(room.name);
            case 'id': return lower(room.roomId);
            case 'mode': return lower(room.gameMode || 'insider');
            case 'status': return room.gameStatus === 'playing' ? 1 : 0;
            case 'locked': return room.locked ? 1 : 0;
            case 'players':
            default: return Number(room.playerCount || 0);
        }
    };
    filtered.sort((a, b) => compareValues(value(a), value(b), dir) || compareValues(lower(a.name), lower(b.name), 'asc'));
    return paginate(filtered, query, rooms.length);
}

// ---------- สถิติ ----------

// ตัด gameHistory (20 เกมล่าสุดต่อคน) — ตารางไม่ได้ใช้ และเป็นก้อนใหญ่สุดของ payload เดิม
function projectStat(stat) {
    const { gameHistory, ...rest } = stat || {};
    return rest;
}

function queryStats(stats, query = {}) {
    const search = lower(query.search).trim();
    const modeFilter = String(query.modeFilter || 'all');
    const sortCol = query.sortCol || 'games';
    const dir = query.sortDir === 'asc' ? 'asc' : 'desc';
    const mode = modeFilter.startsWith('has-') ? modeFilter.slice(4) : null;
    const filtered = stats.filter(stat => {
        if (mode && STATS_MODES.includes(mode) && !(Number(stat.modeStats?.[mode]?.games || 0) > 0)) return false;
        if (search && !`${stat.playerName || ''} ${stat.playerId || ''}`.toLowerCase().includes(search)) return false;
        return true;
    });
    const winRate = stat => (stat.totalGames > 0 ? Math.round((stat.wins / stat.totalGames) * 100) : 0);
    const value = stat => {
        switch (sortCol) {
            case 'name': return lower(stat.playerName);
            case 'wins': return Number(stat.wins || 0);
            case 'losses': return Number(stat.losses || 0);
            case 'winRate': return winRate(stat);
            case 'games':
            default: return Number(stat.totalGames || 0);
        }
    };
    filtered.sort((a, b) => compareValues(value(a), value(b), dir) || compareValues(lower(a.playerName), lower(b.playerName), 'asc'));
    return paginate(filtered, query, stats.length, projectStat);
}

module.exports = {
    queryPlayers,
    queryRooms,
    queryStats,
    projectPlayer,
    projectStat,
    playerStatusKey,
    paginate,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
};
