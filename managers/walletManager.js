/**
 * กระเป๋าชิปผูก playerId — ออกเข้าใหม่ไม่หาย
 * โต๊ะเงินหัก/โอนผ่านฟังก์ชันนี้เท่านั้น ไม่เซ็ตยอดตรงๆ
 */

const fs = require('fs');
const path = require('path');
const { dataFile } = require('./dataPaths');

const WALLETS_FILE = process.env.WALLETS_FILE || dataFile('wallets.json');
const STARTING_CHIPS = 1000;
const DAILY_CHIPS = 300;
const WALLET_CAP = 20000;
const DEBUG_BALANCE_CAP = 1000000000;
const DAILY_HALF_AT = 10000;
const LEDGER_LIMIT = 40;

const wallets = new Map();
const dirtyIds = new Set();
// คนที่มี "เงินพักโป๊กเกอร์" ค้างอยู่ — ไม่ต้องไล่ทุกกระเป๋าตอนหาเงินพักที่ต้องคืน
const escrowHolders = new Set();
let saveTimer = null;
let useDatabase = false;
let Wallet = null;
// โหลดไฟล์ไม่สำเร็จ = ห้ามเซฟทับเด็ดขาด ไม่งั้น map ว่างจะเขียนทับยอดของทุกคนหายหมด
let persistBlocked = false;

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function bangkokDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);
}

function ensureDir() {
    const dir = path.dirname(WALLETS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readWalletFile(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = new Map();
    Object.entries(data || {}).forEach(([playerId, row]) => {
        if (isBotId(playerId)) return;
        rows.set(playerId, normalizeWallet(playerId, row));
    });
    return rows;
}

function loadWalletsFromFile() {
    wallets.clear();
    escrowHolders.clear();
    persistBlocked = false;
    if (!fs.existsSync(WALLETS_FILE)) return;
    try {
        readWalletFile(WALLETS_FILE).forEach((row, id) => wallets.set(id, row));
        return;
    } catch (error) {
        console.error('[wallet] load failed:', error.message);
    }
    // ไฟล์หลักพัง → ลองไฟล์สำรองรอบก่อน
    try {
        readWalletFile(`${WALLETS_FILE}.bak`).forEach((row, id) => wallets.set(id, row));
        console.error('[wallet] restored from backup file');
    } catch (error) {
        persistBlocked = true;
        console.error('[wallet] backup load failed too — saving disabled to protect the file:', error.message);
    }
}

function persistFileNow() {
    if (persistBlocked) return;
    try {
        ensureDir();
        const data = {};
        wallets.forEach((row, playerId) => {
            if (!isBotId(playerId)) data[playerId] = row;
        });
        // เขียนไฟล์ชั่วคราวแล้ว rename — ไฟล์จริงไม่มีวันถูกเขียนค้างครึ่งไฟล์
        const tmp = `${WALLETS_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        if (fs.existsSync(WALLETS_FILE)) fs.copyFileSync(WALLETS_FILE, `${WALLETS_FILE}.bak`);
        fs.renameSync(tmp, WALLETS_FILE);
    } catch (error) {
        console.error('[wallet] save failed:', error.message);
    }
}

async function persistDbNow() {
    const ids = Array.from(dirtyIds);
    dirtyIds.clear();
    const ops = ids
        .filter(id => wallets.has(id) && !isBotId(id))
        .map(id => {
            const row = wallets.get(id);
            return {
                updateOne: {
                    filter: { playerId: id },
                    update: { $set: { balance: row.balance, lastDailyClaim: row.lastDailyClaim, ledger: row.ledger, pokerEscrow: row.pokerEscrow || {} } },
                    upsert: true
                }
            };
        });
    if (!ops.length) return;
    try {
        await Wallet.bulkWrite(ops, { ordered: false });
    } catch (error) {
        // เขียนไม่ผ่าน → ใส่กลับเข้าคิว รอบหน้าลองใหม่
        ids.forEach(id => dirtyIds.add(id));
        console.error('[wallet] db save failed:', error.message);
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

function markDirty(playerId) {
    if (isBotId(playerId)) return;
    dirtyIds.add(playerId);
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow();
    }, 250);
}

// เรียกหลัง connectDB — ถ้ามี Mongo ใช้ Mongo เป็นหลัก (รอด deploy)
async function initWalletManager() {
    try {
        const { isDBConnected } = require('./database');
        Wallet = require('./models').Wallet;
        useDatabase = Boolean(Wallet && isDBConnected());
    } catch (error) {
        useDatabase = false;
    }
    if (!useDatabase) {
        console.log('📁 WalletManager using JSON file');
        return;
    }

    const docs = await Wallet.find({}).lean();
    if (docs.length === 0 && wallets.size > 0) {
        // ย้ายยอดจากไฟล์เดิมขึ้น Mongo ครั้งแรก
        wallets.forEach((row, id) => dirtyIds.add(id));
        await persistDbNow();
        console.log(`✅ WalletManager migrated ${wallets.size} wallet(s) from file to MongoDB`);
        return;
    }
    wallets.clear();
    escrowHolders.clear();
    docs.forEach(doc => {
        if (!isBotId(doc.playerId)) wallets.set(doc.playerId, normalizeWallet(doc.playerId, doc));
    });
    console.log(`✅ WalletManager using MongoDB (${wallets.size} wallet(s))`);
}

// เงินพักโป๊กเกอร์: { [handKey]: { amount, roomId } } — ชิปที่หักเข้ามือที่ยังไม่จบ
// เก็บในแถวเดียวกับ balance → เซฟพร้อมกันเสมอ ไม่มีจังหวะที่ยอดกับเงินพักไม่ตรงกัน
function normalizeEscrow(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([key, entry]) => {
        const amount = Math.floor(Number(entry && entry.amount));
        if (!key || !Number.isFinite(amount) || amount <= 0) return;
        out[key] = { amount, roomId: entry && entry.roomId ? String(entry.roomId) : null };
    });
    return out;
}

function trackEscrow(row) {
    if (row.pokerEscrow && Object.keys(row.pokerEscrow).length) escrowHolders.add(row.playerId);
    else escrowHolders.delete(row.playerId);
}

function normalizeWallet(playerId, row = {}) {
    const raw = Number(row.balance);
    const balance = Number.isFinite(raw) ? Math.max(0, Math.min(DEBUG_BALANCE_CAP, Math.floor(raw))) : STARTING_CHIPS;
    const normalized = {
        playerId,
        balance,
        lastDailyClaim: typeof row.lastDailyClaim === 'string' ? row.lastDailyClaim : null,
        ledger: Array.isArray(row.ledger) ? row.ledger.slice(0, LEDGER_LIMIT) : [],
        pokerEscrow: normalizeEscrow(row.pokerEscrow)
    };
    trackEscrow(normalized);
    return normalized;
}

function getOrCreate(playerId) {
    if (!playerId) throw new Error('ไม่มี playerId');
    if (!wallets.has(playerId)) {
        wallets.set(playerId, normalizeWallet(playerId, { balance: STARTING_CHIPS }));
        markDirty(playerId);
    }
    return wallets.get(playerId);
}

function publicWallet(playerId) {
    const row = getOrCreate(playerId);
    const today = bangkokDate();
    const half = row.balance >= DAILY_HALF_AT;
    return {
        balance: row.balance,
        cap: WALLET_CAP,
        dailyAmount: half ? Math.floor(DAILY_CHIPS / 2) : DAILY_CHIPS,
        canClaimDaily: row.lastDailyClaim !== today,
        lastDailyClaim: row.lastDailyClaim
    };
}

function pushLedger(row, entry) {
    row.ledger = [{ at: new Date().toISOString(), ...entry }, ...(row.ledger || [])].slice(0, LEDGER_LIMIT);
}

function applyDelta(playerId, delta, reason, meta = {}) {
    const row = getOrCreate(playerId);
    const next = row.balance + Number(delta);
    if (next < 0) throw new Error('ชิปไม่พอ');
    const cap = meta.bypassCap ? DEBUG_BALANCE_CAP : WALLET_CAP;
    // เพดานมีไว้หยุด "การได้เพิ่ม" เท่านั้น — ยอดที่เกินเพดานอยู่แล้ว (เช่นชนะกองใหญ่)
    // ต้องไม่ถูกตัดลงตอนได้ชิปเพิ่ม เช่น กดรับรายวัน
    const capped = delta > 0 ? Math.max(row.balance, Math.min(cap, next)) : next;
    const applied = capped - row.balance;
    row.balance = capped;
    pushLedger(row, { delta: applied, reason, roomId: meta.roomId || null });
    if (meta.escrowKey) {
        const escrow = row.pokerEscrow || (row.pokerEscrow = {});
        const entry = escrow[meta.escrowKey] || { amount: 0, roomId: meta.roomId || null };
        if (applied < 0) entry.amount += -applied;
        else if (meta.escrowRelease) entry.amount = Math.max(0, entry.amount - applied);
        if (entry.amount > 0) escrow[meta.escrowKey] = entry;
        else delete escrow[meta.escrowKey];
        trackEscrow(row);
    }
    markDirty(playerId);
    return publicWallet(playerId);
}

// มือจบปกติ (จ่ายกองแล้ว) → ล้างเงินพักของมือนั้น ไม่ขยับยอด
function settleEscrow(playerId, key) {
    const row = wallets.get(playerId);
    if (!row || !key || !row.pokerEscrow || !row.pokerEscrow[key]) return false;
    delete row.pokerEscrow[key];
    trackEscrow(row);
    markDirty(playerId);
    return true;
}

// มือค้าง/ถูกยกเลิก → คืนเงินพักทั้งก้อนให้เจ้าของ แล้วลบรายการในจังหวะเดียวกัน (กันคืนซ้ำ)
function refundEscrow(playerId, key, reason = 'poker-void-refund') {
    const row = wallets.get(playerId);
    const entry = row && row.pokerEscrow ? row.pokerEscrow[key] : null;
    if (!entry) return 0;
    delete row.pokerEscrow[key];
    trackEscrow(row);
    const amount = Math.max(0, Math.floor(Number(entry.amount) || 0));
    if (amount > 0) applyDelta(playerId, amount, reason, { roomId: entry.roomId, bypassCap: true });
    else markDirty(playerId);
    return amount;
}

function listEscrows() {
    const rows = [];
    escrowHolders.forEach(playerId => {
        const row = wallets.get(playerId);
        Object.entries((row && row.pokerEscrow) || {}).forEach(([key, entry]) => {
            rows.push({ playerId, key, amount: entry.amount, roomId: entry.roomId });
        });
    });
    return rows;
}

function credit(playerId, amount, reason, meta) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!value) return publicWallet(playerId);
    return applyDelta(playerId, value, reason, meta);
}

function debit(playerId, amount, reason, meta) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!value) return publicWallet(playerId);
    return applyDelta(playerId, -value, reason, meta);
}

function canAfford(playerId, amount) {
    return getOrCreate(playerId).balance >= Math.max(0, Math.floor(Number(amount) || 0));
}

function debugCredit(playerId, amount, reason, meta = {}) {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    if (!value) return publicWallet(playerId);
    const row = getOrCreate(playerId);
    const next = Math.min(DEBUG_BALANCE_CAP, row.balance + value);
    const applied = next - row.balance;
    row.balance = next;
    pushLedger(row, { delta: applied, reason: reason || 'debug-credit', roomId: meta.roomId || null });
    markDirty(playerId);
    return publicWallet(playerId);
}

function claimDaily(playerId) {
    const row = getOrCreate(playerId);
    const today = bangkokDate();
    if (row.lastDailyClaim === today) {
        throw new Error('รับชิปรายวันนี้ไปแล้ว');
    }
    const amount = row.balance >= DAILY_HALF_AT ? Math.floor(DAILY_CHIPS / 2) : DAILY_CHIPS;
    row.lastDailyClaim = today;
    applyDelta(playerId, amount, 'daily-claim');
    return publicWallet(playerId);
}

loadWalletsFromFile();

module.exports = {
    initWalletManager,
    STARTING_CHIPS,
    DAILY_CHIPS,
    WALLET_CAP,
    DEBUG_BALANCE_CAP,
    publicWallet,
    credit,
    debit,
    settleEscrow,
    refundEscrow,
    listEscrows,
    debugCredit,
    canAfford,
    claimDaily,
    persistNow
};
