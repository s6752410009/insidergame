#!/usr/bin/env node
/**
 * ที่เก็บ log หลังบ้าน: โควตาแยกถัง, เพดานต่อห้อง, บอท, หมดอายุ, แบ่งหน้า, เก็บข้ามรีสตาร์ต, ล้าง
 *
 *   node scripts/smoke-server-logs.js                    # JSON fallback
 *   TEST_MONGO_URL=mongodb://127.0.0.1:27017/x node scripts/smoke-server-logs.js   # + MongoDB
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServerLogManager } = require('../managers/serverLogManager');

let passed = 0;
function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}

const CAPS = { error: 50, admin: 50, system: 50, room: 100, game: 100, detail: 400, detailPerRoom: 150, botPerRoom: 60 };

async function fill(store) {
    const now = Date.now();
    // ห้อง A: เกมบอทพูดเยอะมาก 1,000 บรรทัด
    for (let i = 0; i < 1000; i++) {
        store.add({ category: 'game', type: 'info', roomId: 'roomA', roomName: 'บอทล้วน', gameMode: 'coup', message: `บอท${i % 4} เก็บภาษี +3 #${i}`, meta: { event: 'coup_history', bot: true } });
    }
    // ห้องอื่นๆ เริ่ม/จบเกม + error + admin
    for (let r = 0; r < 20; r++) {
        store.add({ category: 'game', type: 'success', roomId: `room${r}`, roomName: `ห้อง ${r}`, gameMode: 'avalon', message: `อวาลอน เริ่มเกม (5 คน)`, meta: { event: 'game_start' } });
        store.add({ category: 'game', type: 'success', roomId: `room${r}`, roomName: `ห้อง ${r}`, gameMode: 'avalon', message: `ฝ่ายดีชนะ`, meta: { event: 'game_end' } });
    }
    for (let i = 0; i < 30; i++) store.add({ category: 'error', type: 'error', message: `boom ${i}` });
    for (let i = 0; i < 10; i++) store.add({ category: 'admin', type: 'warning', message: `Admin action ${i}` });
    // ห้อง B: คนเล่นจริง 200 บรรทัด + บอทในห้องเดียวกัน 200 บรรทัด
    for (let i = 0; i < 200; i++) {
        store.add({ category: 'game', type: 'info', roomId: 'roomB', roomName: 'ผสม', gameMode: 'liar', message: `คน${i} ลงไพ่`, meta: { event: 'liar_history' } });
        store.add({ category: 'game', type: 'info', roomId: 'roomB', roomName: 'ผสม', gameMode: 'liar', message: `บอท ลงไพ่ ${i}`, meta: { event: 'liar_history', bot: true } });
    }
    // log เก่ากว่าวันเก็บ — ต้องหมดอายุ
    store.add({ timestamp: new Date(now - 9 * 86400000).toISOString(), category: 'error', type: 'error', message: 'old error' });
    await store.flush();
}

async function checkStore(label, store) {
    const all = await store.query({ cat: 'all', limit: 1000 });
    const errors = await store.query({ cat: 'error', limit: 1000 });
    assert(errors.counts.error === 30 || errors.counts.error === 31, `${label}: error 30 อยู่ครบ (ได้ ${errors.counts.error})`);
    const games = await store.query({ cat: 'important', limit: 1000 });
    const starts = games.logs.filter(entry => entry.meta && entry.meta.event === 'game_start');
    const ends = games.logs.filter(entry => entry.meta && entry.meta.event === 'game_end');
    assert(starts.length === 20 && ends.length === 20, `${label}: เริ่ม/จบเกมอีก 20 ห้องไม่โดนเกมบอทดันหลุด (${starts.length}/${ends.length})`);
    assert(games.logs.every(entry => !entry.bot), `${label}: มุมมองสำคัญไม่มีบรรทัดบอท`);
    assert(games.counts.admin === 10, `${label}: admin 10`);

    const roomA = await store.query({ cat: 'all', roomId: 'roomA', limit: 1000 });
    assert(roomA.counts.all <= CAPS.botPerRoom, `${label}: ห้องบอทล้วนเหลือไม่เกินเพดานบอทต่อห้อง (${roomA.counts.all})`);
    assert(roomA.logs[0].message.endsWith('#999'), `${label}: เก็บบรรทัดใหม่สุดไว้ ตัดของเก่า`);

    const roomB = await store.query({ cat: 'all', roomId: 'roomB', limit: 1000 });
    const humanB = roomB.logs.filter(entry => !entry.bot).length;
    const botB = roomB.logs.filter(entry => entry.bot).length;
    assert(roomB.counts.all <= CAPS.detailPerRoom, `${label}: ห้อง B ไม่เกินเพดานต่อห้อง (${roomB.counts.all})`);
    assert(botB <= CAPS.botPerRoom && humanB >= CAPS.detailPerRoom - CAPS.botPerRoom, `${label}: บอทในห้องผสมโดนตัดก่อนคน (คน ${humanB} บอท ${botB})`);
    assert(all.counts.all <= Object.values(CAPS).slice(0, 6).reduce((a, b) => a + b, 0), `${label}: รวมไม่เกินโควตา`);

    // แบ่งหน้า: เดินด้วย cursor จนครบ ไม่ซ้ำ ไม่ขาด และเรียงใหม่ → เก่า
    const seen = new Set();
    let before = null;
    let pages = 0;
    let previous = null;
    let duplicates = 0;
    let unordered = 0;
    do {
        const page = await store.query({ cat: 'all', limit: 37, before });
        page.logs.forEach(entry => {
            if (seen.has(entry.id)) duplicates += 1;
            if (previous && entry.id >= previous) unordered += 1;
            previous = entry.id;
            seen.add(entry.id);
        });
        before = page.nextCursor;
        pages += 1;
        if (!page.hasMore) break;
    } while (pages < 200);
    assert(duplicates === 0 && unordered === 0, `${label}: แบ่งหน้าไม่ซ้ำ เรียงใหม่ไปเก่า (ซ้ำ ${duplicates} สลับ ${unordered})`);
    assert(seen.size === all.counts.all, `${label}: เดินครบทุกหน้า = จำนวนทั้งหมด (${seen.size}/${all.counts.all})`);

    // กรองฝั่ง server: เกม + คำค้น
    const liar = await store.query({ cat: 'all', mode: 'liar', q: 'คน1', limit: 1000 });
    assert(liar.logs.length > 0 && liar.logs.every(entry => entry.gameMode === 'liar' && entry.message.includes('คน1')), `${label}: กรองเกม + ค้นหา`);
    assert(all.modes.includes('coup') && all.modes.includes('avalon'), `${label}: รายชื่อเกมมาจากที่เก็บ`);
    return all.counts.all;
}

async function runJson() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-logs-'));
    const file = path.join(dir, 'serverLogs.ndjson');
    try {
        const first = createServerLogManager({ file, caps: CAPS, flushMs: 5 });
        await first.init({ useDatabase: false, startTimers: false });
        await fill(first);
        await first.prune();
        const total = await checkStore('json', first);
        assert((await first.query({ q: 'old error' })).logs.length === 0, 'json: เก่ากว่า 7 วันหมดอายุ');

        // "รีสตาร์ต": โหลดจากไฟล์ใหม่ ต้องได้เหมือนเดิม
        const second = createServerLogManager({ file, caps: CAPS, flushMs: 5 });
        await second.init({ useDatabase: false, startTimers: false });
        const reloaded = await checkStore('json-restart', second);
        assert(reloaded === total, `json: รีสตาร์ตแล้วได้ครบ ${reloaded}/${total}`);
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
        assert(lines <= total + 100, `json: ไฟล์ถูกบีบเหลือเท่าที่เก็บ (${lines} บรรทัด)`);

        // ไฟล์มีบรรทัดพังกลางไฟล์ ไม่ทำให้โหลดล้ม
        fs.appendFileSync(file, '{"broken": \n');
        const third = createServerLogManager({ file, caps: CAPS });
        await third.init({ useDatabase: false, startTimers: false });
        assert((await third.query({})).counts.all === total, 'json: ข้ามบรรทัดพัง');

        // ล้าง แล้วรีสตาร์ต ต้องว่างจริง
        await third.clear();
        third.add({ category: 'admin', type: 'warning', message: 'Logs ถูกล้างโดย Admin' });
        await third.flush();
        const fourth = createServerLogManager({ file, caps: CAPS });
        await fourth.init({ useDatabase: false, startTimers: false });
        const afterClear = await fourth.query({});
        assert(afterClear.counts.all === 1 && afterClear.logs[0].message.includes('ถูกล้าง'), 'json: ล้างแล้วรีสตาร์ตเหลือแค่บันทึกการล้าง');

        // export เดินทุกหน้า
        for (let i = 0; i < 2500; i++) fourth.add({ category: 'join', type: 'info', roomId: 'r', message: `p${i} เข้าห้อง` });
        let exported = 0;
        for await (const entry of fourth.exportEntries({ cat: 'room' })) { if (entry) exported += 1; }
        assert(exported === CAPS.room, `json: export ได้ทุกแถวที่เก็บ (${exported})`);
        [first, second, third, fourth].forEach(store => store.stop());
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

async function runMongo(url) {
    const mongoose = require('mongoose');
    await mongoose.connect(url, { serverSelectionTimeoutMS: 5000 });
    const { ServerLog } = require('../managers/models');
    try {
        await ServerLog.deleteMany({});
        const first = createServerLogManager({ model: ServerLog, caps: CAPS, flushMs: 5 });
        await first.init({ useDatabase: true, startTimers: false });
        await fill(first);
        await first.prune();
        const total = await checkStore('mongo', first);
        const indexes = await ServerLog.collection.indexes();
        const ttl = indexes.find(index => index.key && index.key.timestamp === 1);
        assert(ttl && ttl.expireAfterSeconds === 7 * 86400, 'mongo: TTL index 7 วัน');
        assert(indexes.some(index => index.key && index.key.bucket === 1) && indexes.some(index => index.key && index.key.gameMode === 1)
            && indexes.some(index => index.key && index.key.roomId === 1) && indexes.some(index => index.key && index.key.category === 1), 'mongo: มี index ตามตัวกรอง');
        const plan = await ServerLog.find({ important: true }).sort({ logId: -1 }).limit(200).explain('executionStats');
        const stage = JSON.stringify(plan.queryPlanner?.winningPlan || plan);
        assert(!/COLLSCAN/.test(stage), 'mongo: มุมมองสำคัญใช้ index ไม่ scan ทั้ง collection');

        const second = createServerLogManager({ model: ServerLog, caps: CAPS });
        await second.init({ useDatabase: true, startTimers: false });
        assert((await second.query({})).counts.all === total, 'mongo: รีสตาร์ตแล้วได้ครบ');
        await second.clear();
        assert((await ServerLog.countDocuments({})) === 0, 'mongo: ล้างแล้ว collection ว่าง');
        [first, second].forEach(store => store.stop());
    } finally {
        await ServerLog.deleteMany({});
        await mongoose.disconnect();
    }
}

(async () => {
    await runJson();
    if (process.env.TEST_MONGO_URL) await runMongo(process.env.TEST_MONGO_URL);
    console.log(`✅ server-logs: ${passed} assertions passed${process.env.TEST_MONGO_URL ? ' (json + mongo)' : ' (json)'}`);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
