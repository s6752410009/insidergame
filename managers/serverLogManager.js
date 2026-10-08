/**
 * ServerLogManager — บันทึกกิจกรรมหลังบ้าน (แท็บ Logs) แบบเก็บถาวร
 *
 * เดิม: array เดียวใน memory 2,000 รายการ
 *   - เกมบอท Coup เกมเดียว (ทุกการขโมย/เก็บภาษี) ดัน error / เริ่ม-จบเกมห้องอื่นหลุดหมด
 *   - รีสตาร์ต/deploy แล้วหายเกลี้ยง
 *
 * ตอนนี้:
 *   - แบ่งถัง (bucket) แต่ละถังมีโควตาของตัวเอง ไม่แย่งที่กัน
 *       error · admin · system · room (เข้า/ออก) · game (เริ่ม/จบ/ออกกลางเกม) · detail (ระหว่างเล่น)
 *     detail มีเพดานต่อห้องอีกชั้น และบรรทัดของบอทมีเพดานต่อห้องที่ต่ำกว่า
 *   - เก็บไม่เกิน LOG_RETENTION_DAYS วัน (ค่าเริ่ม 7) แล้วหมดอายุ
 *   - MongoDB ถ้ามี (TTL index + ตัดตามโควตาเป็นรอบ) ไม่งั้นไฟล์ NDJSON ใน GAME_DATA_DIR
 *   - เขียนเป็นชุด (batch) แบบ async — เกมไม่ต้องรอ log
 */

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DEFAULT_CAPS = {
    error: envNumber('LOG_CAP_ERROR', 3000),
    admin: envNumber('LOG_CAP_ADMIN', 3000),
    system: envNumber('LOG_CAP_SYSTEM', 2000),
    room: envNumber('LOG_CAP_ROOM', 6000),
    game: envNumber('LOG_CAP_GAME', 6000),
    detail: envNumber('LOG_CAP_DETAIL', 15000),
    // ต่อห้อง (เฉพาะ detail) — เกมบอทเกมเดียวกินโควตาห้องอื่นไม่ได้
    detailPerRoom: envNumber('LOG_CAP_DETAIL_PER_ROOM', 800),
    botPerRoom: envNumber('LOG_CAP_BOT_PER_ROOM', 300)
};

// Mongo: memory เป็นแค่สำรองตอนต่อ DB ไม่ได้ เลยเก็บน้อยกว่า
const HOT_CAPS = {
    error: 500, admin: 500, system: 300, room: 500, game: 800, detail: 1500, detailPerRoom: 200, botPerRoom: 80
};

const BUCKETS = ['error', 'admin', 'system', 'room', 'game', 'detail'];
const CATEGORIES = new Set(['join', 'leave', 'game', 'admin', 'error', 'chat', 'system']);
// เหตุการณ์ระดับเกม — ต้องไม่โดนบรรทัดระหว่างเล่นดันหลุด และขึ้นในมุมมอง "สำคัญ"
const KEY_EVENTS = new Set([
    'game_start', 'game_end', 'game_abort', 'game_start_failed', 'table_end',
    'player_left_midgame', 'player_kicked'
]);
// มุมมองบนหน้าแอดมิน (ปุ่มประเภท)
const VIEWS = ['important', 'error', 'admin', 'game', 'room', 'system', 'all'];

const META_MAX_KEYS = 16;
const MESSAGE_MAX = 1000;

// ---------- รูปแบบ log ----------

let idSeq = 0;
// id เรียงตามเวลาได้ด้วยการเทียบสตริงตรงๆ (เวลา ms base36 + ลำดับ) — ใช้เป็น cursor แบ่งหน้า
function makeLogId(timeMs) {
    idSeq = (idSeq + 1) % 1679616; // 36^4
    const rand = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
    return `${Math.floor(timeMs).toString(36).padStart(9, '0')}${idSeq.toString(36).padStart(4, '0')}${rand}`;
}
const LOG_ID_RE = /^[0-9a-z]{15}$/;

function sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const out = {};
    let count = 0;
    for (const [key, value] of Object.entries(meta)) {
        if (count >= META_MAX_KEYS) break;
        if (value === undefined || typeof value === 'function') continue;
        if (value !== null && typeof value === 'object') {
            try {
                const text = JSON.stringify(value);
                out[key] = text.length > 400 ? text.slice(0, 400) + '…' : value;
            } catch (error) {
                continue;
            }
        } else {
            out[key] = typeof value === 'string' && value.length > 400 ? value.slice(0, 400) + '…' : value;
        }
        count += 1;
    }
    return count ? out : null;
}

function classify(entry) {
    const event = entry.meta && entry.meta.event;
    const bot = Boolean(entry.meta && (entry.meta.bot === true || entry.meta.isBot === true));
    let bucket;
    if (entry.category === 'error' || entry.type === 'error') bucket = 'error';
    else if (entry.category === 'admin') bucket = 'admin';
    else if (entry.category === 'system') bucket = 'system';
    else if (entry.category === 'join' || entry.category === 'leave') bucket = 'room';
    // บรรทัด "ผู้ชนะ" ใน history ของแต่ละเกมซ้ำกับ game_end อยู่แล้ว — ให้เป็น detail
    else if (entry.category === 'game' && KEY_EVENTS.has(event)) bucket = 'game';
    else bucket = 'detail';
    const important = bucket === 'error' || bucket === 'admin' || bucket === 'system' || bucket === 'game'
        || KEY_EVENTS.has(event);
    // บอทเดิน/บอทออกห้อง ไม่ใช่เรื่องที่แอดมินต้องดู
    return { bucket, important: important && !(bot && (bucket === 'detail' || bucket === 'room')), bot };
}

/** แปลงอะไรก็ได้ที่หน้าตาเป็น log ให้เป็นรูปแบบมาตรฐาน (ใช้ทั้งตอนเขียนใหม่และตอนโหลดไฟล์/DB) */
function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const time = new Date(raw.timestamp || Date.now());
    const timeMs = Number.isFinite(time.getTime()) ? time.getTime() : Date.now();
    const category = CATEGORIES.has(raw.category) ? raw.category : 'system';
    const entry = {
        id: typeof raw.id === 'string' && LOG_ID_RE.test(raw.id) ? raw.id : makeLogId(timeMs),
        timestamp: new Date(timeMs).toISOString(),
        category,
        type: ['info', 'success', 'warning', 'error'].includes(raw.type) ? raw.type : 'info',
        roomId: raw.roomId ? String(raw.roomId) : null,
        roomName: raw.roomName ? String(raw.roomName) : (raw.roomId ? String(raw.roomId) : 'ระบบ'),
        gameMode: raw.gameMode ? String(raw.gameMode) : null,
        gameModeLabel: raw.gameModeLabel ? String(raw.gameModeLabel) : null,
        message: String(raw.message == null ? '' : raw.message).slice(0, MESSAGE_MAX),
        meta: sanitizeMeta(raw.meta)
    };
    Object.assign(entry, classify(entry));
    return entry;
}

// ---------- ตัวกรอง (ใช้เหมือนกันทั้ง memory และ live update ฝั่งหน้าเว็บ) ----------

function matchesView(entry, view) {
    switch (view) {
        case 'all': return true;
        case 'important': return entry.important === true;
        case 'error': return entry.bucket === 'error';
        case 'room': return entry.category === 'join' || entry.category === 'leave';
        case 'admin': return entry.category === 'admin';
        case 'game': return entry.category === 'game';
        case 'system': return entry.category === 'system';
        default: return true;
    }
}

const SEARCH = Symbol('search');
function searchText(entry) {
    if (!entry[SEARCH]) {
        entry[SEARCH] = [entry.message, entry.roomName, entry.gameModeLabel, entry.gameMode,
            entry.meta ? Object.values(entry.meta).join(' ') : '']
            .join(' ').toLowerCase();
    }
    return entry[SEARCH];
}

function normalizeQuery(options = {}) {
    const view = VIEWS.includes(options.view) ? options.view
        : VIEWS.includes(options.cat) ? options.cat
            : (VIEWS.includes(options.filter) ? options.filter : 'all');
    const mode = options.mode || options.gameMode;
    const limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit) || 200)));
    return {
        view,
        mode: mode && mode !== 'all' ? String(mode) : null,
        roomId: options.roomId ? String(options.roomId) : null,
        q: String(options.q || '').trim().toLowerCase().slice(0, 100),
        before: typeof options.before === 'string' && LOG_ID_RE.test(options.before) ? options.before : null,
        limit
    };
}

function inScope(entry, query) {
    if (query.mode && entry.gameMode !== query.mode) return false;
    if (query.roomId && entry.roomId !== query.roomId) return false;
    if (query.q && !searchText(entry).includes(query.q)) return false;
    return true;
}

function emptyCounts() {
    return Object.fromEntries(VIEWS.map(view => [view, 0]));
}

function addToCounts(counts, entry) {
    VIEWS.forEach(view => {
        if (matchesView(entry, view)) counts[view] += 1;
    });
}

// ---------- Memory store ----------

const REMOVED = Symbol('removed');

/** คิว FIFO ที่ shift ได้ O(1) (เลื่อน head แทนการ splice) */
class Fifo {
    constructor() { this.items = []; this.head = 0; }
    push(item) { this.items.push(item); }
    shiftLive() {
        while (this.head < this.items.length) {
            const item = this.items[this.head++];
            if (this.head > 1024 && this.head * 2 > this.items.length) {
                this.items = this.items.slice(this.head);
                this.head = 0;
            }
            if (!item[REMOVED]) return item;
        }
        return null;
    }
    get size() { return this.items.length - this.head; }
}

class MemoryLogStore {
    constructor(caps) {
        this.caps = { ...caps };
        this.clear();
    }

    clear() {
        this.entries = []; // เรียงเก่า → ใหม่ ตาม id
        this.removed = 0;
        this.bucketQueues = Object.fromEntries(BUCKETS.map(bucket => [bucket, new Fifo()]));
        this.bucketCounts = Object.fromEntries(BUCKETS.map(bucket => [bucket, 0]));
        this.roomQueues = new Map();
        this.botQueues = new Map();
        this.modeCounts = new Map();
    }

    get size() {
        return this.entries.length - this.removed;
    }

    insert(entry) {
        const last = this.entries[this.entries.length - 1];
        if (!last || last.id < entry.id) {
            this.entries.push(entry);
        } else {
            // มาไม่เรียง (เช่นโหลดไฟล์ที่ต่อท้ายผิดลำดับ) — แทรกตามลำดับ id
            let low = 0;
            let high = this.entries.length;
            while (low < high) {
                const mid = (low + high) >> 1;
                if (this.entries[mid].id < entry.id) low = mid + 1; else high = mid;
            }
            if (this.entries[low] && this.entries[low].id === entry.id) return [];
            this.entries.splice(low, 0, entry);
        }
        this.bucketQueues[entry.bucket].push(entry);
        this.bucketCounts[entry.bucket] += 1;
        if (entry.gameMode) this.modeCounts.set(entry.gameMode, (this.modeCounts.get(entry.gameMode) || 0) + 1);
        const evicted = [];
        if (entry.bucket === 'detail' && entry.roomId) {
            const roomQueue = this.queueFor(this.roomQueues, entry.roomId);
            roomQueue.push(entry);
            roomQueue.count += 1;
            if (entry.bot) {
                const botQueue = this.queueFor(this.botQueues, entry.roomId);
                botQueue.push(entry);
                botQueue.count += 1;
                while (botQueue.count > this.caps.botPerRoom) {
                    const victim = botQueue.shiftLive();
                    if (!victim) break;
                    this.remove(victim);
                    evicted.push(victim);
                }
            }
            while (roomQueue.count > this.caps.detailPerRoom) {
                const victim = roomQueue.shiftLive();
                if (!victim) break;
                this.remove(victim);
                evicted.push(victim);
            }
        }
        const queue = this.bucketQueues[entry.bucket];
        while (this.bucketCounts[entry.bucket] > this.caps[entry.bucket]) {
            const victim = queue.shiftLive();
            if (!victim) break;
            this.remove(victim);
            evicted.push(victim);
        }
        this.maybeCompact();
        return evicted;
    }

    queueFor(map, key) {
        let queue = map.get(key);
        if (!queue) {
            queue = new Fifo();
            queue.count = 0;
            map.set(key, queue);
        }
        return queue;
    }

    remove(entry) {
        if (entry[REMOVED]) return;
        entry[REMOVED] = true;
        this.removed += 1;
        this.bucketCounts[entry.bucket] -= 1;
        if (entry.gameMode) {
            const left = (this.modeCounts.get(entry.gameMode) || 1) - 1;
            if (left > 0) this.modeCounts.set(entry.gameMode, left); else this.modeCounts.delete(entry.gameMode);
        }
        if (entry.bucket === 'detail' && entry.roomId) {
            const roomQueue = this.roomQueues.get(entry.roomId);
            if (roomQueue) {
                roomQueue.count -= 1;
                if (roomQueue.count <= 0) this.roomQueues.delete(entry.roomId);
            }
            if (entry.bot) {
                const botQueue = this.botQueues.get(entry.roomId);
                if (botQueue) {
                    botQueue.count -= 1;
                    if (botQueue.count <= 0) this.botQueues.delete(entry.roomId);
                }
            }
        }
    }

    maybeCompact() {
        if (this.removed > 2000 && this.removed * 4 > this.entries.length) {
            this.entries = this.entries.filter(entry => !entry[REMOVED]);
            this.removed = 0;
        }
    }

    /** ลบที่เก่ากว่า cutoffMs — คืนจำนวนที่ลบ */
    expire(cutoffMs) {
        const cutoffId = Math.floor(cutoffMs).toString(36).padStart(9, '0');
        let count = 0;
        for (const entry of this.entries) {
            if (entry.id.slice(0, 9) >= cutoffId) break;
            if (!entry[REMOVED]) {
                this.remove(entry);
                count += 1;
            }
        }
        this.maybeCompact();
        return count;
    }

    live() {
        return this.entries.filter(entry => !entry[REMOVED]);
    }

    query(options) {
        const query = normalizeQuery(options);
        const counts = emptyCounts();
        const logs = [];
        let hasMore = false;
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (entry[REMOVED] || !inScope(entry, query)) continue;
            addToCounts(counts, entry);
            if (!matchesView(entry, query.view)) continue;
            if (query.before && entry.id >= query.before) continue;
            if (logs.length < query.limit) logs.push(entry);
            else hasMore = true;
        }
        return {
            logs,
            hasMore,
            nextCursor: hasMore && logs.length ? logs[logs.length - 1].id : null,
            counts,
            modes: Array.from(this.modeCounts.keys()).sort()
        };
    }

    *iterate(options) {
        const query = normalizeQuery({ ...options, limit: 1 });
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (entry[REMOVED] || !inScope(entry, query) || !matchesView(entry, query.view)) continue;
            yield entry;
        }
    }

    stats() {
        return { total: this.size, buckets: { ...this.bucketCounts } };
    }
}

// ---------- ตัวจัดการ (memory + ไฟล์ หรือ Mongo) ----------

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPublic(entry) {
    return {
        id: entry.id,
        timestamp: entry.timestamp,
        category: entry.category,
        type: entry.type,
        roomId: entry.roomId,
        roomName: entry.roomName,
        gameMode: entry.gameMode,
        gameModeLabel: entry.gameModeLabel,
        message: entry.message,
        meta: entry.meta,
        bucket: entry.bucket,
        important: entry.important,
        bot: entry.bot
    };
}

function fromDoc(doc) {
    return toPublic({
        ...doc,
        id: doc.logId,
        timestamp: doc.timestamp instanceof Date ? doc.timestamp.toISOString() : doc.timestamp
    });
}

function toDoc(entry) {
    const { id, ...rest } = toPublic(entry);
    return { ...rest, logId: id, timestamp: new Date(entry.timestamp) };
}

function viewToMongo(view) {
    switch (view) {
        case 'important': return { important: true };
        case 'error': return { bucket: 'error' };
        case 'room': return { category: { $in: ['join', 'leave'] } };
        case 'admin': return { category: 'admin' };
        case 'game': return { category: 'game' };
        case 'system': return { category: 'system' };
        default: return {};
    }
}

function scopeToMongo(query) {
    const match = {};
    if (query.mode) match.gameMode = query.mode;
    if (query.roomId) match.roomId = query.roomId;
    if (query.q) {
        const re = new RegExp(escapeRegex(query.q), 'i');
        match.$or = [{ message: re }, { roomName: re }, { gameModeLabel: re }, { gameMode: re }];
    }
    return match;
}

function createServerLogManager(options = {}) {
    const retentionDays = Number(options.retentionDays) > 0 ? Number(options.retentionDays) : envNumber('LOG_RETENTION_DAYS', 7);
    const caps = { ...DEFAULT_CAPS, ...(options.caps || {}) };
    const file = options.file || process.env.SERVER_LOGS_FILE || require('./dataPaths').dataFile('serverLogs.ndjson');
    const flushMs = Number(options.flushMs) >= 0 ? Number(options.flushMs) : 1000;
    const pruneMs = Number(options.pruneMs) > 0 ? Number(options.pruneMs) : 2 * 60 * 1000;
    const MAX_PENDING = 10000;

    let Model = options.model || null;
    let useDatabase = false;
    let memory = new MemoryLogStore(caps);
    let pending = []; // รอเขียนลงไฟล์/DB
    let flushTimer = null;
    let flushing = null;
    let fileLines = 0;
    let pruneTimer = null;
    let dirtyRooms = new Set();
    let countsCache = new Map();
    let modesCache = null;
    let ready = false;
    let writesSincePrune = 0;
    let pruneSoon = null;

    function cutoffMs() {
        return Date.now() - retentionDays * DAY_MS;
    }

    // ----- ไฟล์ NDJSON -----
    function loadFile() {
        if (!fs.existsSync(file)) return { loaded: 0, lines: 0 };
        let raw = '';
        try {
            raw = fs.readFileSync(file, 'utf8');
        } catch (error) {
            console.error('[serverLogs] read failed:', error.message);
            return { loaded: 0, lines: 0 };
        }
        let lines = 0;
        const cutoff = cutoffMs();
        raw.split('\n').forEach(line => {
            if (!line.trim()) return;
            lines += 1;
            try {
                const entry = normalizeEntry(JSON.parse(line));
                if (entry && new Date(entry.timestamp).getTime() >= cutoff) memory.insert(entry);
            } catch (error) {
                // บรรทัดพัง (เช่นเครื่องดับกลางการเขียน) ข้ามไป
            }
        });
        return { loaded: memory.size, lines };
    }

    function rewriteFileSync() {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        const live = memory.live();
        fs.writeFileSync(tmp, live.map(entry => JSON.stringify(toPublic(entry))).join('\n') + (live.length ? '\n' : ''), 'utf8');
        fs.renameSync(tmp, file);
        fileLines = live.length;
    }

    async function rewriteFile() {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        const live = memory.live();
        await fs.promises.writeFile(tmp, live.map(entry => JSON.stringify(toPublic(entry))).join('\n') + (live.length ? '\n' : ''), 'utf8');
        await fs.promises.rename(tmp, file);
        fileLines = live.length;
    }

    async function flushFile(batch) {
        // ไฟล์ยาวเกินของที่ยังเก็บอยู่มาก (มีบรรทัดที่ถูกตัดทิ้งค้าง) → เขียนใหม่ทั้งไฟล์แทนการต่อท้าย
        if (fileLines + batch.length > memory.size * 1.5 + 2000) {
            await rewriteFile();
            return;
        }
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.appendFile(file, batch.map(entry => JSON.stringify(toPublic(entry))).join('\n') + '\n', 'utf8');
        fileLines += batch.length;
    }

    // ----- Mongo -----
    async function flushDb(batch) {
        try {
            await Model.insertMany(batch.map(toDoc), { ordered: false });
        } catch (error) {
            // id ซ้ำ (เขียนซ้ำรอบ retry) ไม่เป็นไร · อย่างอื่นใส่คิวกลับ รอบหน้าลองใหม่
            const duplicateOnly = error && (error.code === 11000
                || (Array.isArray(error.writeErrors) && error.writeErrors.every(item => (item.code || item.err?.code) === 11000)));
            if (!duplicateOnly) {
                pending = batch.concat(pending).slice(-MAX_PENDING);
                throw error;
            }
        }
    }

    function flush() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (flushing) {
            // กำลังเขียนอยู่ — รอรอบนั้นจบแล้วเขียนที่เหลือต่อ
            return flushing.then(() => (pending.length ? flush() : undefined));
        }
        if (!pending.length) return Promise.resolve();
        const batch = pending;
        pending = [];
        flushing = (useDatabase ? flushDb(batch) : flushFile(batch))
            .catch(error => {
                console.error('[serverLogs] write failed:', error.message);
                if (!useDatabase) pending = batch.concat(pending).slice(-MAX_PENDING);
            })
            .finally(() => {
                flushing = null;
            });
        return flushing;
    }

    function scheduleFlush() {
        if (flushTimer || flushMs === 0) {
            if (flushMs === 0) flush();
            return;
        }
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flush();
        }, pending.length >= 500 ? 50 : flushMs);
        if (flushTimer.unref) flushTimer.unref();
    }

    /** ตอนโปรเซสกำลังจะตาย (ไม่มี event loop แล้ว) — JSON เท่านั้น เขียนแบบ sync */
    function flushSyncOnExit() {
        if (useDatabase || !pending.length) return;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.appendFileSync(file, pending.map(entry => JSON.stringify(toPublic(entry))).join('\n') + '\n', 'utf8');
            pending = [];
        } catch (error) {
            // ทำอะไรไม่ได้แล้ว
        }
    }

    async function pruneDb() {
        if (!useDatabase) return;
        const removeOlderThanNth = async (filter, cap) => {
            const [nth] = await Model.find(filter).sort({ logId: -1 }).skip(cap).limit(1).select({ logId: 1, _id: 0 }).lean();
            if (nth) await Model.deleteMany({ ...filter, logId: { $lte: nth.logId } });
        };
        try {
            await Model.deleteMany({ timestamp: { $lt: new Date(cutoffMs()) } });
            // ต่อห้องก่อน แล้วค่อยโควตารวม — ไม่งั้นห้องที่พูดเยอะดันห้องอื่นหลุดจากโควตารวมก่อนโดนตัดเอง
            const rooms = Array.from(dirtyRooms);
            dirtyRooms = new Set();
            for (const roomId of rooms) {
                await removeOlderThanNth({ roomId, bucket: 'detail', bot: true }, caps.botPerRoom);
                await removeOlderThanNth({ roomId, bucket: 'detail' }, caps.detailPerRoom);
            }
            for (const bucket of BUCKETS) await removeOlderThanNth({ bucket }, caps[bucket]);
        } catch (error) {
            console.error('[serverLogs] prune failed:', error.message);
        }
    }

    function prune() {
        writesSincePrune = 0;
        memory.expire(cutoffMs());
        countsCache.clear();
        return pruneDb();
    }

    async function ensureMongoIndexes() {
        try {
            await Model.createIndexes();
        } catch (error) {
            // TTL index เดิมตั้งวันไว้ไม่ตรง (เปลี่ยน LOG_RETENTION_DAYS) → แก้ด้วย collMod
            if (/expireAfterSeconds|IndexOptionsConflict|already exists with different options/i.test(error.message)) {
                try {
                    await Model.db.db.command({
                        collMod: Model.collection.collectionName,
                        index: { keyPattern: { timestamp: 1 }, expireAfterSeconds: Math.round(retentionDays * 86400) }
                    });
                    await Model.createIndexes();
                } catch (collModError) {
                    console.error('[serverLogs] TTL index update failed:', collModError.message);
                }
            } else {
                console.error('[serverLogs] createIndexes failed:', error.message);
            }
        }
    }

    async function init(initOptions = {}) {
        const wantDb = initOptions.useDatabase !== undefined ? initOptions.useDatabase : (() => {
            try {
                return require('./database').isDBConnected();
            } catch (error) {
                return false;
            }
        })();
        if (wantDb && !Model) {
            try {
                Model = require('./models').ServerLog;
            } catch (error) {
                Model = null;
            }
        }
        // log ที่เกิดก่อน init (ระหว่างบูต) ยังอยู่ใน memory/pending — เก็บไว้ ไม่ทิ้ง
        const early = memory.live();
        useDatabase = Boolean(wantDb && Model);
        memory = new MemoryLogStore(useDatabase ? { ...HOT_CAPS, ...(options.hotCaps || {}) } : caps);
        if (useDatabase) {
            await ensureMongoIndexes();
            early.forEach(entry => memory.insert(entry));
            pending = early.slice();
            await prune();
            console.log(`✅ ServerLogs using MongoDB (เก็บ ${retentionDays} วัน)`);
        } else {
            const { loaded, lines } = loadFile();
            early.forEach(entry => memory.insert(entry));
            memory.expire(cutoffMs());
            // ไฟล์มีบรรทัดหมดอายุ/เกินโควตาค้าง → เขียนใหม่ให้เล็กลง
            if (lines > memory.size + 100) {
                try {
                    rewriteFileSync();
                } catch (error) {
                    console.error('[serverLogs] compact failed:', error.message);
                }
            } else {
                fileLines = lines;
            }
            pending = early.slice();
            console.log(`📁 ServerLogs using ${path.basename(file)} (${loaded} entries, เก็บ ${retentionDays} วัน)`);
        }
        if (pending.length) scheduleFlush();
        if (!pruneTimer && initOptions.startTimers !== false) {
            pruneTimer = setInterval(() => { prune(); }, pruneMs);
            if (pruneTimer.unref) pruneTimer.unref();
        }
        ready = true;
    }

    function add(rawEntry) {
        const entry = normalizeEntry(rawEntry);
        if (!entry) return null;
        memory.insert(entry);
        pending.push(entry);
        if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
        if (entry.bucket === 'detail' && entry.roomId) dirtyRooms.add(entry.roomId);
        if (entry.gameMode && modesCache && !modesCache.values.includes(entry.gameMode)) modesCache = null;
        countsCache.clear();
        scheduleFlush();
        // Mongo: ตัดตามโควตาเป็นรอบ — ถ้ามีเกมพูดเยอะมากระหว่างรอบ ตัดเร็วขึ้น
        writesSincePrune += 1;
        if (useDatabase && writesSincePrune > 3000 && !pruneSoon) {
            pruneSoon = setTimeout(() => {
                pruneSoon = null;
                flush().then(prune);
            }, 1000);
            if (pruneSoon.unref) pruneSoon.unref();
        }
        return toPublic(entry);
    }

    async function queryDb(query) {
        await flush();
        const scope = scopeToMongo(query);
        const viewMatch = viewToMongo(query.view);
        const filter = { ...scope, ...viewMatch };
        if (viewMatch.$or && scope.$or) {
            delete filter.$or;
            filter.$and = [{ $or: scope.$or }, { $or: viewMatch.$or }];
        }
        if (query.before) filter.logId = { $lt: query.before };
        const projection = { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 };
        const docs = await Model.find(filter, projection).sort({ logId: -1 }).limit(query.limit + 1).lean();
        const hasMore = docs.length > query.limit;
        const logs = docs.slice(0, query.limit).map(fromDoc);

        const scopeKey = JSON.stringify([query.mode, query.roomId, query.q]);
        let counts = countsCache.get(scopeKey);
        if (!counts || Date.now() - counts.at > 3000) {
            const groups = await Model.aggregate([
                { $match: scope },
                { $group: { _id: { c: '$category', b: '$bucket', i: '$important' }, n: { $sum: 1 } } }
            ]);
            const value = emptyCounts();
            groups.forEach(group => {
                const sample = { category: group._id.c, bucket: group._id.b, important: group._id.i === true };
                VIEWS.forEach(view => {
                    if (matchesView(sample, view)) value[view] += group.n;
                });
            });
            counts = { at: Date.now(), value };
            countsCache.set(scopeKey, counts);
        }
        if (!modesCache || Date.now() - modesCache.at > 30000) {
            const values = (await Model.distinct('gameMode')).filter(Boolean).sort();
            modesCache = { at: Date.now(), values };
        }
        return {
            logs,
            hasMore,
            nextCursor: hasMore && logs.length ? logs[logs.length - 1].id : null,
            counts: counts.value,
            modes: modesCache.values
        };
    }

    async function query(queryOptions = {}) {
        const normalized = normalizeQuery(queryOptions);
        if (useDatabase) {
            try {
                const result = await queryDb(normalized);
                return { ...result, source: 'mongo' };
            } catch (error) {
                console.error('[serverLogs] mongo query failed, using memory:', error.message);
            }
        }
        const result = memory.query(normalized);
        return { ...result, logs: result.logs.map(toPublic), source: useDatabase ? 'memory-fallback' : 'file' };
    }

    /** สำหรับดาวน์โหลด — เดินทีละหน้าจากที่เก็บจริง ไม่ใช่แค่ใน memory */
    async function* exportEntries(queryOptions = {}, maxEntries = 100000) {
        let before = null;
        let sent = 0;
        while (sent < maxEntries) {
            const page = await query({ ...queryOptions, before, limit: 1000 });
            for (const entry of page.logs) {
                yield entry;
                sent += 1;
                if (sent >= maxEntries) return;
            }
            if (!page.hasMore || !page.nextCursor) return;
            before = page.nextCursor;
        }
    }

    async function clear() {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (flushing) await flushing.catch(() => {});
        pending = [];
        memory.clear();
        countsCache.clear();
        modesCache = null;
        dirtyRooms = new Set();
        if (useDatabase) {
            await Model.deleteMany({});
        } else {
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.writeFile(file, '', 'utf8');
            fileLines = 0;
        }
    }

    function stop() {
        if (pruneTimer) clearInterval(pruneTimer);
        pruneTimer = null;
    }

    return {
        init,
        add,
        query,
        exportEntries,
        clear,
        flush,
        flushSyncOnExit,
        prune,
        stop,
        isReady: () => ready,
        isUsingDatabase: () => useDatabase,
        stats: () => ({ ...memory.stats(), pending: pending.length, useDatabase, retentionDays, caps: { ...caps } }),
        retention: () => ({ days: retentionDays, caps: { ...caps } })
    };
}

const defaultManager = createServerLogManager();

module.exports = {
    ...defaultManager,
    createServerLogManager,
    normalizeEntry,
    matchesView,
    KEY_EVENTS,
    VIEWS,
    DEFAULT_CAPS
};
