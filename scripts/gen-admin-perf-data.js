#!/usr/bin/env node
/**
 * สร้างข้อมูลจำลองขนาดใหญ่ไว้วัดความเร็วหลังบ้าน (/admin)
 *
 *   node scripts/gen-admin-perf-data.js <dir> [--players 8000] [--stats 6000] [--rooms 150] [--logs 30000] [--banned 120]
 *
 * เขียน players.json / playerStats.json / bannedPlayers.json / rooms.json / serverLogs.ndjson ลง <dir>
 * แล้วรันเซิร์ฟเวอร์ด้วย GAME_DATA_DIR=<dir> MONGO_URL= เพื่อวัด
 * ห้ามชี้ไปที่ data/ จริง — สคริปต์ปฏิเสธถ้าโฟลเดอร์นั้นเป็น data/ ของ repo
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = { dir: null, players: 8000, stats: 6000, rooms: 150, logs: 30000, banned: 120 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            out[arg.slice(2)] = Number(argv[i + 1]);
            i += 1;
        } else if (!out.dir) {
            out.dir = arg;
        }
    }
    return out;
}

const MODES = ['insider', 'werewolf', 'blackmarket', 'spyfall', 'undercover', 'coup', 'avalon', 'liar',
    'poker5', 'poker4', 'pokdeng', 'codenames', 'wavelength', 'drawguess', 'colorcards', 'setthi'];
const NAMES = ['โอ๊ต', 'เจ', 'มิ้นท์', 'บอส', 'ฟ้า', 'ต้น', 'แพร', 'นัท', 'เบียร์', 'ปอนด์', 'ไอซ์', 'กาย', 'แนน', 'พีท', 'จูน'];

// สุ่มแบบกำหนด seed ได้ — รันซ้ำได้ชุดเดิม เทียบก่อน/หลังได้ตรง
let seed = 20261009;
function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
function pick(list) { return list[Math.floor(rand() * list.length)]; }
function int(max) { return Math.floor(rand() * max); }

function makePlayers(count) {
    const now = Date.now();
    const players = {};
    for (let i = 0; i < count; i++) {
        const playerId = `perf-${String(i).padStart(6, '0')}-${Math.floor(rand() * 1e9).toString(36)}`;
        // ราวครึ่งเป็น guest ชื่ออัตโนมัติ (แบบที่เว็บสร้างให้) ที่เหลือตั้งชื่อเอง
        const auto = rand() < 0.5;
        players[playerId] = {
            playerId,
            playerName: auto ? `ผู้เล่น${1000 + int(9000)}` : `${pick(NAMES)}${i}`,
            color: pick(['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6']),
            avatar: pick(['👤', '🐱', '🐶', '🦊', '🐼']),
            avatarFrame: 'none',
            isSiteAdmin: i < 3,
            createdAt: new Date(now - int(90) * 86400000).toISOString(),
            lastSeen: new Date(now - int(30 * 86400) * 1000).toISOString()
        };
    }
    return players;
}

function makeStats(playerIds, count) {
    const now = Date.now();
    const stats = {};
    playerIds.slice(0, count).forEach(playerId => {
        const modeStats = {};
        let total = 0;
        let wins = 0;
        MODES.forEach(mode => {
            const games = rand() < 0.35 ? int(40) : 0;
            const w = int(games + 1);
            modeStats[mode] = { games, wins: w, losses: games - w };
            total += games;
            wins += w;
        });
        const gameHistory = [];
        for (let i = 0; i < 20; i++) {
            const mode = pick(MODES);
            gameHistory.push({
                mode,
                date: new Date(now - i * 3600000).toISOString(),
                roomId: `R${int(99999)}`,
                roomName: `ห้อง ${pick(NAMES)}`,
                won: rand() < 0.5,
                role: 'พลเมือง',
                team: null,
                playerCount: 4 + int(6),
                winnerName: pick(NAMES),
                resultText: `${pick(NAMES)} ชนะ — เหลือรอดคนสุดท้าย`
            });
        }
        stats[playerId] = {
            playerId,
            playerName: `${pick(NAMES)}`,
            totalGames: total,
            wins,
            losses: total - wins,
            roleStats: { gameMasterCount: int(10), traitorCount: int(10), citizenCount: int(30), werewolf: { villager: int(5), werewolf: int(5) }, blackmarket: { boss: int(3) } },
            winByRole: { winAsTraitor: int(5), winAsCitizen: int(10), werewolf: { villager: int(3) }, blackmarket: {} },
            modeStats,
            lastPlayedAt: new Date(now - int(30) * 86400000).toISOString(),
            gameHistory
        };
    });
    return stats;
}

function makeBanned(playerIds, count) {
    const banned = {};
    playerIds.slice(-count).forEach(playerId => {
        banned[playerId] = {
            playerId,
            playerName: pick(NAMES),
            reason: 'สแปมแชต',
            bannedAt: new Date().toISOString(),
            bannedBy: 'Admin',
            expiresAt: null,
            isPermanent: true,
            durationHours: null
        };
    });
    return banned;
}

// ห้องสร้างผ่าน roomManager จริง จะได้รูปแบบ snapshot ตรงกับที่เซิร์ฟเวอร์อ่าน
async function makeRooms(dir, playerIds, count) {
    process.env.GAME_DATA_DIR = dir;
    process.env.MONGO_URL = '';
    const playerManager = require('../managers/playerManager');
    const roomManager = require('../managers/roomManager');
    await playerManager.initPlayerManager();
    await roomManager.initRoomManager();
    const rooms = [];
    let cursor = 0;
    for (let i = 0; i < count; i++) {
        const mode = MODES[i % MODES.length];
        const creator = playerIds[cursor++ % playerIds.length];
        let room;
        try {
            room = roomManager.createRoom({ name: `ห้องทดสอบ ${i} ${pick(NAMES)}`, gameMode: mode, maxPlayers: 10 }, creator);
            roomManager.joinRoom(room.roomId, creator, null, null, { bypassLock: true });
            const extra = 2 + int(5);
            for (let j = 0; j < extra; j++) {
                try { roomManager.joinRoom(room.roomId, playerIds[cursor++ % playerIds.length], null, null, { bypassLock: true }); } catch (error) { /* ห้องเต็ม */ }
            }
            rooms.push(room.roomId);
        } catch (error) {
            // โหมดที่ต้องตั้งค่าเพิ่ม ข้ามไป
        }
    }
    await roomManager.flushPersistRooms();
    return rooms;
}

function makeLogs(count, roomIds) {
    const now = Date.now();
    const lines = [];
    const span = 6 * 86400000;
    for (let i = 0; i < count; i++) {
        const roll = rand();
        const roomId = roomIds.length ? pick(roomIds) : null;
        const mode = pick(MODES);
        let entry;
        if (roll < 0.01) entry = { category: 'error', type: 'error', message: `event "coup_action" ล้มเหลว: boom ${i}` };
        else if (roll < 0.03) entry = { category: 'admin', type: 'warning', message: `Admin แก้ไขสถิติ ${pick(NAMES)}` };
        else if (roll < 0.05) entry = { category: 'system', type: 'warning', message: `[Cleanup] ${pick(NAMES)} (offline)` };
        else if (roll < 0.12) entry = { category: rand() < 0.5 ? 'join' : 'leave', type: 'info', message: `${pick(NAMES)} เข้าห้อง` };
        else if (roll < 0.16) entry = { category: 'game', type: 'success', message: `เริ่มเกม (${4 + int(5)} คน)`, meta: { event: 'game_start' } };
        else if (roll < 0.19) entry = { category: 'game', type: 'success', message: `${pick(NAMES)} ชนะ`, meta: { event: 'game_end' } };
        else entry = { category: 'game', type: 'info', message: `${pick(NAMES)} เก็บภาษี +3`, meta: { event: 'coup_history', bot: rand() < 0.6 } };
        lines.push(JSON.stringify({
            id: `perf-${i}`,
            timestamp: new Date(now - Math.floor((i / count) * span)).toISOString(),
            roomId: entry.category === 'admin' || entry.category === 'error' ? null : roomId,
            roomName: roomId ? `ห้อง ${roomId}` : 'ระบบ',
            gameMode: entry.category === 'admin' ? null : mode,
            gameModeLabel: null,
            meta: null,
            ...entry
        }));
    }
    // ไฟล์เรียงจากเก่าไปใหม่ (แบบเดียวกับที่ append จริง)
    return lines.reverse().join('\n') + '\n';
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.dir) {
        console.error('usage: node scripts/gen-admin-perf-data.js <dir> [--players N] [--stats N] [--rooms N] [--logs N] [--banned N]');
        process.exit(2);
    }
    const dir = path.resolve(args.dir);
    if (dir === path.resolve(__dirname, '..', 'data')) {
        console.error('refusing to overwrite the repo data/ folder');
        process.exit(2);
    }
    fs.mkdirSync(dir, { recursive: true });

    const players = makePlayers(args.players);
    const ids = Object.keys(players);
    fs.writeFileSync(path.join(dir, 'players.json'), JSON.stringify(players));
    fs.writeFileSync(path.join(dir, 'playerStats.json'), JSON.stringify(makeStats(ids, args.stats)));
    fs.writeFileSync(path.join(dir, 'bannedPlayers.json'), JSON.stringify(makeBanned(ids, args.banned)));
    const roomIds = await makeRooms(dir, ids, args.rooms);
    fs.writeFileSync(path.join(dir, 'serverLogs.ndjson'), makeLogs(args.logs, roomIds));

    const sizes = ['players.json', 'playerStats.json', 'bannedPlayers.json', 'rooms.json', 'serverLogs.ndjson']
        .map(name => {
            const file = path.join(dir, name);
            return `${name} ${fs.existsSync(file) ? (fs.statSync(file).size / 1024 / 1024).toFixed(1) + 'MB' : '-'}`;
        });
    console.log(`generated in ${dir}: players=${ids.length} stats=${Math.min(args.stats, ids.length)} rooms=${roomIds.length} logs=${args.logs}`);
    console.log(sizes.join(' · '));
    process.exit(0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
