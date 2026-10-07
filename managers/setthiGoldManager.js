/**
 * เศรษฐี 🪙 เหรียญทอง + เลเวลสกิล + ช่องติดตั้ง — ผูก playerId (สกุลแยก ไม่ใช่ชิปของกระเป๋าเงิน)
 *
 * แบบเดียวกับ walletManager: MongoDB ถ้ามี ไม่งั้น data/setthiGold.json (GAME_DATA_DIR) · เซฟแบบหน่วง · SIGTERM เซฟทันที
 * ทุกการได้/ใช้เหรียญคิดที่เซิร์ฟเวอร์เท่านั้น:
 *  - รางวัลจบเกม: ให้ครั้งเดียวต่อ gameId ต่อคน (จด gameId ไว้ในแถวเดียวกับยอด → เซฟพร้อมกัน รีสตาร์ตแล้วไม่ได้ซ้ำ)
 *  - อัปเกรด: client ส่งแค่ "สกิลไหน + เลเวลที่เห็นตอนกด" (expectLv) · ราคาคิดที่นี่ · เลเวลไม่ตรง = ไม่หัก (กดรัว/สองแท็บพร้อมกันได้ขั้นเดียว)
 *  - Node ทำงานทีละคำสั่ง และทุกฟังก์ชันที่แก้ยอดเป็น sync → ไม่มีจังหวะที่สองคำสั่งเห็นยอดเดิมพร้อมกัน
 *  - เสกเหรียญ (เทส) เฉพาะแอดมินเว็บ — ตรวจสิทธิ์ใน app.js · ลงประวัติทุกครั้ง
 */

const fs = require('fs');
const path = require('path');
const { dataFile } = require('./dataPaths');
const SK = require('../games/setthiSkills');

const GOLD_FILE = process.env.SETTHI_GOLD_FILE || dataFile('setthiGold.json');
const BOT_DAILY_CAP = 600; // เหรียญจากเกมที่ไม่มีคนจริงอื่น ต่อวัน
const DAILY_CAP = 3000; // เหรียญจากเกมทุกแบบ ต่อวัน (กันปั๊ม)
const GOLD_MAX = 1000000;
const DEBUG_GRANT_MAX = 100000;
const HISTORY_LIMIT = 40;
const AWARDED_LIMIT = 80;

const rows = new Map();
const dirtyIds = new Set();
let saveTimer = null;
let useDatabase = false;
let Model = null;
let persistBlocked = false;
let ready = false;
const pendingAwards = []; // รางวัลที่มาก่อนโหลดข้อมูลเสร็จ (เกมที่กู้คืนตอนบูต) — ให้หลัง init

function isBotId(id) { return String(id || '').startsWith('bot_'); }
function validId(id) { return typeof id === 'string' && id.length >= 3 && id.length <= 80 && !isBotId(id); }

function bangkokDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function int(v, d = 0) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? n : d;
}

function normalizeRow(playerId, raw = {}) {
    const skills = {};
    SK.SKILL_IDS.forEach(id => {
        const lv = SK.clampLevel(raw.skills && raw.skills[id]);
        if (lv > 0) skills[id] = lv;
    });
    const loadout = [];
    (Array.isArray(raw.loadout) ? raw.loadout : []).forEach(id => {
        if (SK.SKILL_BY_ID.has(id) && !loadout.includes(id) && loadout.length < SK.LOADOUT_SIZE) loadout.push(id);
    });
    const awarded = (Array.isArray(raw.awarded) ? raw.awarded : [])
        .filter(a => a && typeof a.g === 'string')
        .slice(0, AWARDED_LIMIT)
        .map(a => ({ g: a.g, n: Math.max(0, int(a.n)), at: typeof a.at === 'string' ? a.at : null }));
    return {
        playerId,
        gold: Math.max(0, Math.min(GOLD_MAX, int(raw.gold))),
        skills,
        loadout,
        dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : null,
        earnedToday: Math.max(0, int(raw.earnedToday)),
        botEarnedToday: Math.max(0, int(raw.botEarnedToday)),
        history: Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_LIMIT) : [],
        awarded
    };
}

function readFile(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = new Map();
    Object.entries(data || {}).forEach(([id, row]) => { if (validId(id)) out.set(id, normalizeRow(id, row)); });
    return out;
}

function loadFromFile() {
    rows.clear();
    persistBlocked = false;
    if (!fs.existsSync(GOLD_FILE)) return;
    try {
        readFile(GOLD_FILE).forEach((row, id) => rows.set(id, row));
        return;
    } catch (error) {
        console.error('[setthiGold] load failed:', error.message);
    }
    try {
        readFile(`${GOLD_FILE}.bak`).forEach((row, id) => rows.set(id, row));
        console.error('[setthiGold] restored from backup file');
    } catch (error) {
        // ไฟล์พังทั้งคู่ — ห้ามเซฟทับ ไม่งั้นเหรียญ/สกิลของทุกคนหาย
        persistBlocked = true;
        console.error('[setthiGold] backup load failed too — saving disabled:', error.message);
    }
}

function persistFileNow() {
    if (persistBlocked) return;
    try {
        fs.mkdirSync(path.dirname(GOLD_FILE), { recursive: true });
        const data = {};
        rows.forEach((row, id) => { data[id] = row; });
        const tmp = `${GOLD_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data));
        if (fs.existsSync(GOLD_FILE)) fs.copyFileSync(GOLD_FILE, `${GOLD_FILE}.bak`);
        fs.renameSync(tmp, GOLD_FILE);
    } catch (error) {
        console.error('[setthiGold] save failed:', error.message);
    }
}

async function persistDbNow() {
    const ids = Array.from(dirtyIds);
    dirtyIds.clear();
    const ops = ids.filter(id => rows.has(id)).map(id => {
        const r = rows.get(id);
        return {
            updateOne: {
                filter: { playerId: id },
                update: { $set: { gold: r.gold, skills: r.skills, loadout: r.loadout, dayKey: r.dayKey, earnedToday: r.earnedToday, botEarnedToday: r.botEarnedToday, history: r.history, awarded: r.awarded } },
                upsert: true
            }
        };
    });
    if (!ops.length) return;
    try {
        await Model.bulkWrite(ops, { ordered: false });
    } catch (error) {
        ids.forEach(id => dirtyIds.add(id));
        console.error('[setthiGold] db save failed:', error.message);
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

function markDirty(id) {
    dirtyIds.add(id);
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow();
    }, 250);
}

async function initSetthiGoldManager() {
    try {
        const { isDBConnected } = require('./database');
        Model = require('./models').SetthiGold;
        useDatabase = Boolean(Model && isDBConnected());
    } catch (error) {
        useDatabase = false;
    }
    if (useDatabase) {
        const docs = await Model.find({}).lean();
        if (docs.length === 0 && rows.size > 0) {
            rows.forEach((row, id) => dirtyIds.add(id));
            await persistDbNow();
            console.log(`✅ SetthiGold migrated ${rows.size} row(s) to MongoDB`);
        } else {
            rows.clear();
            docs.forEach(doc => { if (validId(doc.playerId)) rows.set(doc.playerId, normalizeRow(doc.playerId, doc)); });
            console.log(`✅ SetthiGold using MongoDB (${rows.size} row(s))`);
        }
    } else {
        console.log('📁 SetthiGold using JSON file');
    }
    ready = true;
    // รางวัลที่ค้างตั้งแต่ก่อนโหลดเสร็จ (เกมที่จบตอนกู้ห้อง) — ตอนนี้ให้ได้แล้ว (ยังกันซ้ำด้วย gameId เหมือนเดิม)
    pendingAwards.splice(0).forEach(job => {
        try { awardGame(job.gameId, job.rewards, job.opts); } catch (error) { console.error('[setthiGold] pending award failed:', error.message); }
    });
}

function isReady() { return ready; }

function getRow(playerId) { return rows.get(playerId) || null; }

function getOrCreate(playerId) {
    if (!validId(playerId)) throw new Error('ไม่มีผู้เล่น');
    if (!rows.has(playerId)) rows.set(playerId, normalizeRow(playerId, {}));
    return rows.get(playerId);
}

/** เปลี่ยนวัน (เวลาไทย) = เริ่มนับเพดานรายวันใหม่ */
function rollDay(row, now = new Date()) {
    const today = bangkokDate(now);
    if (row.dayKey !== today) {
        row.dayKey = today;
        row.earnedToday = 0;
        row.botEarnedToday = 0;
    }
}

function pushHistory(row, entry) {
    row.history = [{ at: new Date().toISOString(), ...entry }, ...(row.history || [])].slice(0, HISTORY_LIMIT);
}

function publicProfile(playerId, now = new Date()) {
    const row = validId(playerId) ? (getRow(playerId) || normalizeRow(playerId, {})) : normalizeRow('-', {});
    const today = bangkokDate(now);
    const earned = row.dayKey === today ? row.earnedToday : 0;
    const botEarned = row.dayKey === today ? row.botEarnedToday : 0;
    return {
        gold: row.gold,
        skills: { ...row.skills },
        loadout: row.loadout.slice(),
        earnedToday: earned,
        dailyCap: DAILY_CAP,
        botEarnedToday: botEarned,
        botDailyCap: BOT_DAILY_CAP,
        history: row.history.slice(0, 12)
    };
}

function fail(code, error, playerId) {
    return { ok: false, code, error, profile: validId(playerId) ? publicProfile(playerId) : null };
}

/**
 * อัปเกรดสกิล 1 ขั้น · expectLv = เลเวลที่ client เห็นตอนกด (ต้องตรง ไม่งั้นไม่หัก — กันกดซ้ำ/สองแท็บ)
 * คืน { ok, profile, cost, level } หรือ { ok: false, code, error, profile }
 */
function upgrade(playerId, skillId, expectLv) {
    if (!ready) return fail('loading', 'ระบบกำลังโหลด ลองใหม่อีกครั้ง', playerId);
    if (!validId(playerId)) return fail('player', 'ไม่พบผู้เล่น', null);
    const skill = typeof skillId === 'string' ? SK.SKILL_BY_ID.get(skillId) : null;
    if (!skill) return fail('skill', 'ไม่มีสกิลนี้', playerId);
    // ต้องเป็นตัวเลขจริง (null/''/true ไม่นับเป็น 0)
    const expect = typeof expectLv === 'number' ? expectLv : (typeof expectLv === 'string' && /^[0-9]$/.test(expectLv) ? Number(expectLv) : NaN);
    if (!Number.isInteger(expect) || expect < 0 || expect > SK.MAX_LEVEL) return fail('expect', 'ข้อมูลไม่ถูกต้อง', playerId);
    const row = getOrCreate(playerId);
    const cur = SK.clampLevel(row.skills[skill.id]);
    if (cur !== expect) return fail('stale', 'เลเวลเปลี่ยนไปแล้ว', playerId);
    const cost = SK.upgradeCost(cur);
    if (cost === null) return fail('max', 'เต็ม Lv5 แล้ว', playerId);
    if (row.gold < cost) return fail('gold', `เหรียญไม่พอ (ต้องใช้ ${cost} 🪙)`, playerId);
    row.gold -= cost;
    row.skills[skill.id] = cur + 1;
    // อัปสกิลแรกเสร็จแล้วช่องว่าง = ใส่ให้เลย (คนใหม่ไม่ต้องหาปุ่มติดตั้ง)
    if (cur === 0 && row.loadout.length < SK.LOADOUT_SIZE && !row.loadout.includes(skill.id)) row.loadout.push(skill.id);
    pushHistory(row, { delta: -cost, reason: 'upgrade', skill: skill.id, level: cur + 1 });
    markDirty(playerId);
    return { ok: true, cost, level: cur + 1, profile: publicProfile(playerId) };
}

/** ตั้งช่องติดตั้ง (ไม่เกิน 3 · ต้องมีเลเวลแล้ว · ไม่ซ้ำ) */
function setLoadout(playerId, ids) {
    if (!ready) return fail('loading', 'ระบบกำลังโหลด ลองใหม่อีกครั้ง', playerId);
    if (!validId(playerId)) return fail('player', 'ไม่พบผู้เล่น', null);
    if (!Array.isArray(ids) || ids.length > SK.LOADOUT_SIZE) return fail('loadout', `ติดตั้งได้ไม่เกิน ${SK.LOADOUT_SIZE} สกิล`, playerId);
    const row = getOrCreate(playerId);
    const next = [];
    for (const id of ids) {
        if (typeof id !== 'string' || !SK.SKILL_BY_ID.has(id)) return fail('skill', 'ไม่มีสกิลนี้', playerId);
        if (next.includes(id)) return fail('dup', 'ใส่สกิลซ้ำไม่ได้', playerId);
        if (!(SK.clampLevel(row.skills[id]) > 0)) return fail('locked', 'ต้องอัปสกิลก่อน (Lv1)', playerId);
        next.push(id);
    }
    const same = next.length === row.loadout.length && next.every((id, k) => row.loadout[k] === id);
    if (!same) {
        row.loadout = next;
        markDirty(playerId);
    }
    return { ok: true, profile: publicProfile(playerId) };
}

/** สกิลที่ติดตั้งตอนเริ่มเกม { id: lv } (engine ล็อกค่านี้ไว้ทั้งเกม) */
function equippedSkills(playerId) {
    const row = validId(playerId) ? getRow(playerId) : null;
    return row ? SK.snapshotLoadout(row.skills, row.loadout) : {};
}

/**
 * ให้รางวัลจบเกม — ครั้งเดียวต่อ gameId ต่อคน · หักเพดานรายวันที่นี่
 * rewards = ผลจาก setthiSkills.computeRewards(state)
 * คืน { [playerId]: { requested, granted, capped, already, gold } }
 */
function awardGame(gameId, rewards, opts = {}) {
    const out = {};
    if (typeof gameId !== 'string' || !gameId || !rewards || typeof rewards !== 'object') return out;
    if (!ready) {
        pendingAwards.push({ gameId, rewards, opts });
        Object.keys(rewards).forEach(id => { out[id] = { requested: int(rewards[id] && rewards[id].total), granted: 0, capped: false, already: false, pending: true, gold: null }; });
        return out;
    }
    const now = opts.now instanceof Date ? opts.now : new Date();
    Object.entries(rewards).forEach(([playerId, reward]) => {
        if (!validId(playerId) || !reward) return;
        const requested = Math.max(0, Math.min(10000, int(reward.total)));
        const existing = getRow(playerId);
        const prior = existing && existing.awarded.find(a => a.g === gameId);
        if (prior) {
            out[playerId] = { requested, granted: prior.n, capped: prior.n < requested, already: true, gold: existing.gold };
            return;
        }
        if (!requested) {
            out[playerId] = { requested: 0, granted: 0, capped: false, already: false, gold: existing ? existing.gold : 0 };
            return;
        }
        const row = getOrCreate(playerId);
        rollDay(row, now);
        let granted = Math.min(requested, Math.max(0, DAILY_CAP - row.earnedToday));
        if (reward.botGame) granted = Math.min(granted, Math.max(0, BOT_DAILY_CAP - row.botEarnedToday));
        granted = Math.min(granted, GOLD_MAX - row.gold);
        row.gold += granted;
        row.earnedToday += granted;
        if (reward.botGame) row.botEarnedToday += granted;
        row.awarded = [{ g: gameId, n: granted, at: now.toISOString() }, ...row.awarded].slice(0, AWARDED_LIMIT);
        pushHistory(row, { delta: granted, reason: 'game', gameId, capped: granted < requested });
        markDirty(playerId);
        out[playerId] = { requested, granted, capped: granted < requested, already: false, gold: row.gold };
    });
    return out;
}

/** เสกเหรียญ (เทสเท่านั้น — app.js ตรวจว่าเป็นแอดมินเว็บก่อนเรียก) */
function debugGrant(playerId, amount, by = null) {
    if (!ready) return fail('loading', 'ระบบกำลังโหลด', playerId);
    if (!validId(playerId)) return fail('player', 'ไม่พบผู้เล่น', null);
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 1 || value > DEBUG_GRANT_MAX) return fail('amount', `ใส่จำนวนเต็ม 1–${DEBUG_GRANT_MAX.toLocaleString('en-US')}`, playerId);
    const row = getOrCreate(playerId);
    const applied = Math.min(value, GOLD_MAX - row.gold);
    row.gold += applied;
    pushHistory(row, { delta: applied, reason: 'debug-grant', by });
    markDirty(playerId);
    return { ok: true, granted: applied, profile: publicProfile(playerId) };
}

/** ล้างสกิลทั้งหมด คืนเหรียญที่ใช้อัปไป (เทสเท่านั้น — แอดมินเว็บ) */
function resetSkills(playerId, by = null) {
    if (!ready) return fail('loading', 'ระบบกำลังโหลด', playerId);
    if (!validId(playerId)) return fail('player', 'ไม่พบผู้เล่น', null);
    const row = getOrCreate(playerId);
    let refund = 0;
    Object.values(row.skills).forEach(lv => { for (let k = 0; k < lv; k += 1) refund += SK.UPGRADE_COST[k]; });
    row.skills = {};
    row.loadout = [];
    row.gold = Math.min(GOLD_MAX, row.gold + refund);
    pushHistory(row, { delta: refund, reason: 'debug-reset', by });
    markDirty(playerId);
    return { ok: true, refund, profile: publicProfile(playerId) };
}

/** เทสเท่านั้น: โหลดไฟล์ใหม่เหมือนรีสตาร์ต */
function reloadFromDiskForTests() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirtyIds.clear();
    loadFromFile();
}

loadFromFile();

module.exports = {
    GOLD_FILE,
    BOT_DAILY_CAP,
    DAILY_CAP,
    GOLD_MAX,
    DEBUG_GRANT_MAX,
    initSetthiGoldManager,
    isReady,
    publicProfile,
    upgrade,
    setLoadout,
    equippedSkills,
    awardGame,
    debugGrant,
    resetSkills,
    persistNow,
    bangkokDate,
    reloadFromDiskForTests
};
