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
let saveTimer = null;

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

function loadWallets() {
    wallets.clear();
    if (!fs.existsSync(WALLETS_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
        Object.entries(data || {}).forEach(([playerId, row]) => {
            wallets.set(playerId, normalizeWallet(playerId, row));
        });
    } catch (error) {
        console.error('[wallet] load failed:', error.message);
    }
}

function persistNow() {
    try {
        ensureDir();
        const data = {};
        wallets.forEach((row, playerId) => { data[playerId] = row; });
        fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[wallet] save failed:', error.message);
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow();
    }, 250);
}

function normalizeWallet(playerId, row = {}) {
    const raw = Number(row.balance);
    const balance = Number.isFinite(raw) ? Math.max(0, Math.min(DEBUG_BALANCE_CAP, Math.floor(raw))) : STARTING_CHIPS;
    return {
        playerId,
        balance,
        lastDailyClaim: typeof row.lastDailyClaim === 'string' ? row.lastDailyClaim : null,
        ledger: Array.isArray(row.ledger) ? row.ledger.slice(0, LEDGER_LIMIT) : []
    };
}

function getOrCreate(playerId) {
    if (!playerId) throw new Error('ไม่มี playerId');
    if (!wallets.has(playerId)) {
        wallets.set(playerId, normalizeWallet(playerId, { balance: STARTING_CHIPS }));
        scheduleSave();
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
    const capped = Math.min(cap, next);
    const applied = capped - row.balance;
    row.balance = capped;
    pushLedger(row, { delta: applied, reason, roomId: meta.roomId || null });
    scheduleSave();
    return publicWallet(playerId);
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
    scheduleSave();
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

loadWallets();

module.exports = {
    STARTING_CHIPS,
    DAILY_CHIPS,
    WALLET_CAP,
    DEBUG_BALANCE_CAP,
    publicWallet,
    credit,
    debit,
    debugCredit,
    canAfford,
    claimDaily,
    persistNow
};
