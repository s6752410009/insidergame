/**
 * สถิติเกมเล่นคนเดียว (หนึ่งแถวต่อ ผู้เล่น × เกม)
 *
 * ใช้ MongoDB ถ้ามี (รอด deploy) ไม่งั้นเก็บไฟล์ data/soloStats.json
 * รูปแบบ data เป็นของแต่ละเกมเอง — ตัวนี้แค่เก็บ/อ่าน/ไล่อันดับ
 */

const fs = require('fs');
const path = require('path');
const { dataFile } = require('./dataPaths');

const SOLO_FILE = process.env.SOLO_STATS_FILE || dataFile('soloStats.json');

const rows = new Map(); // `${gameId}:${playerId}` -> { playerId, gameId, data, updatedAt }
const dirty = new Set();
let saveTimer = null;
let useDatabase = false;
let SoloStat = null;
let persistBlocked = false;

const keyOf = (playerId, gameId) => `${gameId}:${playerId}`;

function readFile(file) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = new Map();
    Object.values(parsed || {}).forEach(row => {
        if (row && row.playerId && row.gameId) out.set(keyOf(row.playerId, row.gameId), row);
    });
    return out;
}

function loadFromFile() {
    rows.clear();
    persistBlocked = false;
    if (!fs.existsSync(SOLO_FILE)) return;
    try {
        readFile(SOLO_FILE).forEach((row, key) => rows.set(key, row));
        return;
    } catch (error) {
        console.error('[solo] load failed:', error.message);
    }
    try {
        readFile(`${SOLO_FILE}.bak`).forEach((row, key) => rows.set(key, row));
        console.error('[solo] restored from backup file');
    } catch (error) {
        // ไฟล์พังทั้งคู่ — ห้ามเซฟทับ ไม่งั้นสถิติทุกคนหาย
        persistBlocked = true;
        console.error('[solo] backup load failed too — saving disabled:', error.message);
    }
}

function persistFileNow() {
    if (persistBlocked) return;
    try {
        fs.mkdirSync(path.dirname(SOLO_FILE), { recursive: true });
        const out = {};
        rows.forEach((row, key) => { out[key] = row; });
        const tmp = `${SOLO_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(out));
        if (fs.existsSync(SOLO_FILE)) fs.copyFileSync(SOLO_FILE, `${SOLO_FILE}.bak`);
        fs.renameSync(tmp, SOLO_FILE);
    } catch (error) {
        console.error('[solo] save failed:', error.message);
    }
}

async function persistDbNow() {
    const keys = Array.from(dirty);
    dirty.clear();
    const ops = keys.filter(k => rows.has(k)).map(k => {
        const row = rows.get(k);
        return {
            updateOne: {
                filter: { playerId: row.playerId, gameId: row.gameId },
                update: { $set: { data: row.data } },
                upsert: true
            }
        };
    });
    if (!ops.length) return;
    try {
        await SoloStat.bulkWrite(ops, { ordered: false });
    } catch (error) {
        keys.forEach(k => dirty.add(k));
        console.error('[solo] db save failed:', error.message);
    }
}

function persistNow() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    if (useDatabase) return persistDbNow();
    persistFileNow();
    return Promise.resolve();
}

function markDirty(key) {
    dirty.add(key);
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow();
    }, 300);
}

async function initSoloStatsManager() {
    try {
        const { isDBConnected } = require('./database');
        SoloStat = require('./models').SoloStat;
        useDatabase = Boolean(SoloStat && isDBConnected());
    } catch (error) {
        useDatabase = false;
    }
    if (!useDatabase) {
        console.log('📁 SoloStatsManager using JSON file');
        return;
    }
    const docs = await SoloStat.find({}).lean();
    if (docs.length === 0 && rows.size > 0) {
        rows.forEach((row, key) => dirty.add(key));
        await persistDbNow();
        console.log(`✅ SoloStatsManager migrated ${rows.size} row(s) to MongoDB`);
        return;
    }
    rows.clear();
    docs.forEach(doc => rows.set(keyOf(doc.playerId, doc.gameId), {
        playerId: doc.playerId,
        gameId: doc.gameId,
        data: doc.data || {},
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null
    }));
    console.log(`✅ SoloStatsManager using MongoDB (${rows.size} row(s))`);
}

function getData(playerId, gameId) {
    const row = rows.get(keyOf(playerId, gameId));
    return row ? row.data : null;
}

function setData(playerId, gameId, data) {
    const key = keyOf(playerId, gameId);
    rows.set(key, { playerId, gameId, data, updatedAt: new Date().toISOString() });
    markDirty(key);
    return data;
}

/** ทุกแถวของเกมหนึ่ง (ใช้ทำตารางอันดับ) */
function listGame(gameId) {
    const out = [];
    rows.forEach(row => {
        if (row.gameId === gameId) out.push(row);
    });
    return out;
}

loadFromFile();

module.exports = {
    initSoloStatsManager,
    getData,
    setData,
    listGame,
    persistNow
};
