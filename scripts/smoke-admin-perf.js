#!/usr/bin/env node
/**
 * หลังบ้านเร็วพอกับข้อมูลชุดใหญ่ + ไม่ทำให้เกมค้าง
 *
 *   node scripts/smoke-admin-perf.js                 # unit + ข้อมูลใหญ่ (JSON)
 *   TEST_MONGO_URL=mongodb://127.0.0.1:27017/x node scripts/smoke-admin-perf.js   # + เช็คจำนวนเขียน Mongo
 *
 * 1. adminQueries: กรอง/เรียง/แบ่งหน้า
 * 2. ผู้เล่น 8,000 · สถิติ 6,000 · ห้อง 150 · log 30,000: ทุก event ตอบเร็ว ก้อนเล็ก และ /ping ยังตอบทันระหว่างนั้น
 * 3. (Mongo) เกมจบ 1 เกม เขียนสถิติเฉพาะคนในเกม · ห้องที่ไม่เปลี่ยนไม่ถูกเขียนซ้ำ
 */

require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { io } = require('socket.io-client');
const adminQueries = require('../managers/adminQueries');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}

function unitTests() {
    const now = Date.now();
    const players = Array.from({ length: 230 }, (_, i) => ({
        playerId: `p${String(i).padStart(3, '0')}`,
        playerName: `name${String(229 - i).padStart(3, '0')}`,
        category: i % 3 === 0 ? 'real' : 'guest-idle',
        isBanned: i % 50 === 0,
        isCleanupCandidate: i % 7 === 0 && i % 50 !== 0,
        totalGames: i,
        lastSeen: new Date(now - i * 60000).toISOString(),
        inRooms: [],
        secretField: 'x'
    }));
    const page1 = adminQueries.queryPlayers(players, { pageSize: 50 }, now);
    assert(page1.rows.length === 50 && page1.pages === 5 && page1.total === 230 && page1.filtered === 230, 'players: แบ่งหน้า 50');
    assert(page1.rows[0].playerId === 'p000', 'players: ค่าเริ่ม = ออนไลน์ล่าสุดก่อน');
    assert(!('secretField' in page1.rows[0]), 'players: ตัด field ที่ตารางไม่ใช้');
    const last = adminQueries.queryPlayers(players, { pageSize: 50, page: 99 }, now);
    assert(last.page === 5 && last.rows.length === 30, 'players: หน้าเกินไปอยู่หน้าสุดท้าย');
    const banned = adminQueries.queryPlayers(players, { statusFilter: 'banned' }, now);
    assert(banned.filtered === 5 && banned.rows.every(row => row.isBanned), 'players: กรองแบน');
    const online = adminQueries.queryPlayers(players, { statusFilter: 'online' }, now);
    assert(online.rows.every(row => now - new Date(row.lastSeen).getTime() < 5 * 60000), 'players: ออนไลน์ = 5 นาทีล่าสุด');
    const byName = adminQueries.queryPlayers(players, { sortCol: 'name', sortDir: 'asc', pageSize: 3 }, now);
    assert(byName.rows.map(row => row.playerName).join() === 'name000,name001,name002', 'players: เรียงชื่อ');
    const search = adminQueries.queryPlayers(players, { search: 'P12' }, now);
    assert(search.filtered === 10, `players: ค้นหาไม่สนตัวพิมพ์ (${search.filtered})`);

    const stats = players.map((player, i) => ({ playerId: player.playerId, playerName: player.playerName, totalGames: i, wins: i % 10, losses: i - (i % 10),
        modeStats: { coup: { games: i % 2 } }, gameHistory: [{ big: 'x'.repeat(100) }] }));
    const statsPage = adminQueries.queryStats(stats, { modeFilter: 'has-coup', sortCol: 'wins', sortDir: 'desc' });
    assert(statsPage.filtered === 115 && statsPage.rows.every(row => !row.gameHistory), 'stats: กรองโหมด + ไม่ส่ง gameHistory');
    assert(statsPage.rows[0].wins === 9, 'stats: เรียงชนะ');

    const rooms = Array.from({ length: 70 }, (_, i) => ({ roomId: `R${i}`, name: `room ${i}`, gameMode: i % 2 ? 'coup' : 'insider',
        gameStatus: i % 3 ? 'waiting' : 'playing', locked: i % 5 === 0, playerCount: i % 9, playerNames: [`owner${i}`] }));
    const roomsPage = adminQueries.queryRooms(rooms, { modeFilter: 'coup', statusFilter: 'playing' });
    assert(roomsPage.rows.every(room => room.gameMode === 'coup' && room.gameStatus === 'playing'), 'rooms: กรองโหมด + สถานะ');
    assert(adminQueries.queryRooms(rooms, { search: 'owner42' }).filtered === 1, 'rooms: ค้นหาจากชื่อคนในห้อง');
    assert(adminQueries.queryRooms(rooms, { pageSize: 1000 }).pageSize === adminQueries.MAX_PAGE_SIZE, 'rooms: จำกัดขนาดหน้า');
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function request(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const req = http.request({ method, hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function largeDataset() {
    const dataDir = process.env.GAME_DATA_DIR;
    const generated = spawnSync(process.execPath, [path.join(__dirname, 'gen-admin-perf-data.js'), dataDir,
        '--players', '8000', '--stats', '6000', '--rooms', '150', '--logs', '30000'], { encoding: 'utf8' });
    if (generated.status !== 0) throw new Error('generate failed: ' + generated.stderr);
    const seededLines = fs.readFileSync(path.join(dataDir, 'serverLogs.ndjson'), 'utf8');
    const seededErrors = (seededLines.match(/"category":"error"/g) || []).length;
    const seededAdmin = (seededLines.match(/"category":"admin"/g) || []).length;

    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT, env: { ...process.env, PORT: String(port), MONGO_URL: '' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    server.stdout.on('data', c => { output += c; });
    server.stderr.on('data', c => { output += c; });
    try {
        for (let i = 0; i < 300; i++) {
            try { if ((await request('GET', `${base}/ping`)).status < 500) break; } catch (error) { /* booting */ }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
        const login = await request('POST', `${base}/admin/login`, `password=${encodeURIComponent(settings.adminPassword || 'admin123')}`,
            { 'content-type': 'application/x-www-form-urlencoded' });
        const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        const renderStart = process.hrtime.bigint();
        const page = await request('GET', `${base}/admin`, null, { cookie });
        const renderMs = Number(process.hrtime.bigint() - renderStart) / 1e6;
        assert(renderMs < 500, `GET /admin < 500ms (${renderMs.toFixed(1)}ms)`);
        assert(!/adminPassword|"password"/.test(page.body.replace(/name="password"/g, '')), 'หน้า /admin ไม่มีรหัสแอดมิน');
        const token = /const adminToken = '([^']+)'/.exec(page.body)[1];
        const socket = io(base, { transports: ['websocket'], forceNew: true });
        await new Promise(resolve => socket.once('connect', resolve));
        const emit = (event, data) => new Promise((resolve, reject) => {
            const started = process.hrtime.bigint();
            const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 60000);
            const done = response => {
                clearTimeout(timer);
                resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, bytes: Buffer.byteLength(JSON.stringify(response)), response });
            };
            if (data === undefined) socket.emit(event, done); else socket.emit(event, data, done);
        });
        assert((await emit('admin_authenticate', { token })).response.success, 'admin auth');

        // ระหว่างแอดมินโหลด /ping ต้องยังตอบทัน (เดิม admin_getData บล็อก event loop ~25 วิ)
        let worstPing = 0;
        let pinging = true;
        const pinger = (async () => {
            while (pinging) {
                const started = Date.now();
                await request('GET', `${base}/ping`);
                worstPing = Math.max(worstPing, Date.now() - started);
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        })();
        const budgets = [
            ['admin_getSummary', {}, 2 * 1024],
            ['admin_getPlayers', { pageSize: 50 }, 60 * 1024],
            ['admin_getPlayers', { pageSize: 50, page: 80, search: 'perf', sortCol: 'name' }, 60 * 1024],
            ['admin_getStats', { pageSize: 50, modeFilter: 'has-coup' }, 120 * 1024],
            ['admin_getRooms', { pageSize: 50 }, 60 * 1024],
            ['admin_getBanned', {}, 60 * 1024],
            ['admin_getLogs', { cat: 'important', limit: 200 }, 120 * 1024],
            ['admin_getLogs', { cat: 'all', limit: 200, q: 'ภาษี' }, 120 * 1024]
        ];
        const report = [];
        for (const [event, data, maxBytes] of budgets) {
            const result = await emit(event, data);
            report.push(`${event} ${result.ms.toFixed(0)}ms ${(result.bytes / 1024).toFixed(1)}KB`);
            assert(result.response.success, `${event} success`);
            assert(result.bytes <= maxBytes, `${event} ≤ ${(maxBytes / 1024).toFixed(0)}KB (${(result.bytes / 1024).toFixed(1)}KB)`);
            assert(result.ms < 1500, `${event} < 1.5s (${result.ms.toFixed(0)}ms)`);
        }
        const logsPage = (await emit('admin_getLogs', { cat: 'all', limit: 200 })).response;
        // 30,000 บรรทัดที่สร้าง เกินโควตาถัง detail (15,000) — ส่วนเกินถูกตัดตั้งแต่บูต ถังอื่นอยู่ครบ
        assert(logsPage.counts.all >= 15000 && logsPage.counts.all < 30000 && logsPage.logs.length === 200 && logsPage.hasMore, `log ชุดใหญ่โหลดทีละ 200 (${logsPage.counts.all} หลังตัดโควตา)`);
        assert(logsPage.counts.error === seededErrors && logsPage.counts.admin === seededAdmin, `error/admin อยู่ครบ ไม่โดน detail ดันหลุด (${logsPage.counts.error}/${seededErrors} · ${logsPage.counts.admin}/${seededAdmin})`);
        const older = (await emit('admin_getLogs', { cat: 'all', limit: 200, before: logsPage.nextCursor })).response;
        assert(older.logs.length === 200 && older.logs[0].id < logsPage.logs[199].id, 'แสดงเพิ่มดึงหน้าเก่ากว่าจากที่เก็บ');
        pinging = false;
        await pinger;
        assert(worstPing < 800, `/ping ระหว่างโหลดหลังบ้าน < 800ms (แย่สุด ${worstPing}ms)`);
        // รูปแบบเดิมยังใช้ได้ (สคริปต์เก่า) และไม่บล็อกนานแล้ว
        const legacy = await emit('admin_getData');
        assert(legacy.response.success && legacy.ms < 3000, `admin_getData เดิมยังทำงาน (${legacy.ms.toFixed(0)}ms ${(legacy.bytes / 1024 / 1024).toFixed(1)}MB)`);
        socket.close();
        console.log(`  GET /admin ${renderMs.toFixed(1)}ms · ${report.join(' · ')} · worst /ping ${worstPing}ms · legacy getData ${legacy.ms.toFixed(0)}ms`);
    } catch (error) {
        console.error(output.slice(-1500));
        throw error;
    } finally {
        server.kill('SIGTERM');
    }
}

async function mongoWrites(url) {
    process.env.MONGO_URL = url;
    const mongoose = require('mongoose');
    const models = require('../managers/models');
    const { connectDB } = require('../managers/database');
    await connectDB();
    await Promise.all([models.PlayerStats.deleteMany({}), models.RoomSnapshot.deleteMany({}), models.Player.deleteMany({})]);
    try {
        const docs = Array.from({ length: 300 }, (_, i) => ({ playerId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, playerName: `p${i}`, totalGames: 1 }));
        await models.PlayerStats.insertMany(docs);
        await models.Player.insertMany(docs.map(doc => ({ playerId: doc.playerId, playerName: doc.playerName })));
        const statsManager = require('../managers/statsManager');
        const playerManager = require('../managers/playerManager');
        const roomManager = require('../managers/roomManager');
        await playerManager.initPlayerManager();
        await statsManager.initStatsManager();
        await roomManager.initRoomManager();

        const statWrites = [];
        const realStatsWrite = models.PlayerStats.bulkWrite.bind(models.PlayerStats);
        models.PlayerStats.bulkWrite = (ops, options) => { statWrites.push(ops.length); return realStatsWrite(ops, options); };
        const players = docs.slice(0, 3).map(doc => ({ playerId: doc.playerId, name: doc.playerName }));
        statsManager.recordGameEnd('ROOM1', { mode: 'coup', winner: { playerId: players[0].playerId, name: players[0].name }, players, roomName: 'r' });
        await new Promise(resolve => setTimeout(resolve, 300));
        assert(statWrites.length === 1 && statWrites[0] === 3, `เกมจบ 3 คน เขียนสถิติ 3 แถว ไม่ใช่ทั้งเว็บ (${statWrites.join(',')})`);
        const saved = await models.PlayerStats.findOne({ playerId: players[0].playerId }).lean();
        assert(saved.totalGames === 2, 'สถิติคนในเกมถูกบันทึกจริง');
        const untouched = await models.PlayerStats.findOne({ playerId: docs[200].playerId }).lean();
        assert(untouched.totalGames === 1, 'คนนอกเกมไม่ถูกแตะ');

        const roomWrites = [];
        const realRoomWrite = models.RoomSnapshot.bulkWrite.bind(models.RoomSnapshot);
        models.RoomSnapshot.bulkWrite = (ops, options) => { roomWrites.push(ops.length); return realRoomWrite(ops, options); };
        const created = [];
        for (let i = 0; i < 20; i++) created.push(roomManager.createRoom({ name: `room ${i}`, gameMode: 'coup', maxPlayers: 6 }, docs[10 + i].playerId));
        await roomManager.flushPersistRooms({ force: false });
        roomWrites.length = 0;
        roomManager.joinRoom(created[0].roomId, docs[50].playerId, 'sock-1');
        roomManager.schedulePersistRooms();
        await new Promise(resolve => setTimeout(resolve, 600));
        assert(roomWrites.length === 1 && roomWrites[0] === 1, `ห้องเดียวเปลี่ยน เขียนห้องเดียว (${roomWrites.join(',')})`);
        roomWrites.length = 0;
        await roomManager.flushPersistRooms();
        assert(roomWrites[0] === 20, `ปิดเซิร์ฟเวอร์ เขียนครบทุกห้อง (${roomWrites.join(',')})`);
    } finally {
        await Promise.all([models.PlayerStats.deleteMany({}), models.RoomSnapshot.deleteMany({}), models.Player.deleteMany({})]);
        await mongoose.disconnect();
    }
}

(async () => {
    unitTests();
    await largeDataset();
    if (process.env.TEST_MONGO_URL) await mongoWrites(process.env.TEST_MONGO_URL);
    console.log(`✅ admin-perf: ${passed} assertions passed${process.env.TEST_MONGO_URL ? ' (+ mongo writes)' : ''}`);
    process.exit(0);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
