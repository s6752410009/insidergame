/**
 * แชทโลก — ที่เก็บข้อมูล (ข้อความล่าสุด 200 · รายการคำ · คนที่โดนห้ามพิมพ์)
 *
 * MongoDB ถ้ามี (เอกสารเดียว key='main' ในคอลเลกชัน WorldChatState)
 * ไม่งั้นไฟล์ worldChat.json ใน GAME_DATA_DIR · เซฟแบบหน่วง (ข้อความถี่ๆ รวมเป็นการเขียนครั้งเดียว)
 * · SIGTERM / process exit เซฟทันที
 *
 * ทุกฟังก์ชันที่แก้ข้อมูลเป็น sync (Node ทำทีละคำสั่ง) แล้วค่อยสั่งเซฟ — ไม่มีจังหวะสองคำสั่งเห็นข้อมูลเก่าพร้อมกัน
 * ตรวจสิทธิ์/กติกา (ใครพิมพ์ได้ ช้าเร็ว คำหยาบ) อยู่ที่ worldChatService ไม่ใช่ที่นี่
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chatFilter = require('./worldChatFilter');

const MESSAGE_LIMIT = 200;
const DEFAULT_REPORT_THRESHOLD = 3;
const WORD_MAX_LENGTH = 40;
const WORD_LIST_MAX = 500;

function str(value, max) {
    return String(value == null ? '' : value).slice(0, max);
}

function iso(value, fallback = null) {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function normalizeInvite(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const count = Math.max(0, Math.floor(Number(raw.count) || 0));
    const max = Math.max(0, Math.floor(Number(raw.max) || 0));
    return {
        roomId: str(raw.roomId, 40),
        roomName: str(raw.roomName, 60),
        gameMode: str(raw.gameMode, 40),
        gameLabel: str(raw.gameLabel, 60),
        emoji: str(raw.emoji, 16),
        count,
        max,
        locked: Boolean(raw.locked)
    };
}

function normalizeMessage(raw) {
    if (!raw || typeof raw !== 'object' || !raw.playerId) return null;
    const kind = raw.kind === 'invite' ? 'invite' : 'text';
    const invite = kind === 'invite' ? normalizeInvite(raw.invite) : null;
    if (kind === 'invite' && (!invite || !invite.roomId)) return null;
    const reports = Array.isArray(raw.reports)
        ? Array.from(new Set(raw.reports.map(id => str(id, 80)).filter(Boolean))).slice(0, 50)
        : [];
    return {
        id: str(raw.id, 40) || crypto.randomBytes(8).toString('hex'),
        kind,
        playerId: str(raw.playerId, 80),
        playerName: str(raw.playerName, 40) || 'ผู้เล่น',
        color: str(raw.color, 32) || '#94a3b8',
        avatar: str(raw.avatar, 16) || '👤',
        avatarFrame: str(raw.avatarFrame, 20) || 'none',
        text: kind === 'text' ? str(raw.text, chatFilter.MAX_LENGTH * 2) : '',
        invite,
        createdAt: iso(raw.createdAt, new Date().toISOString()),
        reports,
        hidden: Boolean(raw.hidden),
        hiddenReason: raw.hidden ? (raw.hiddenReason === 'admin' ? 'admin' : 'reports') : null,
        hiddenAt: raw.hidden ? iso(raw.hiddenAt, null) : null
    };
}

function normalizeWordList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach(item => {
        const word = str(item, WORD_MAX_LENGTH).trim();
        if (!word) return;
        const key = chatFilter.wordKey(word);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(word);
    });
    return out.slice(0, WORD_LIST_MAX);
}

function normalizeConfig(raw = {}) {
    const threshold = Math.floor(Number(raw.reportThreshold));
    return {
        extraWords: normalizeWordList(raw.extraWords),
        removedWords: normalizeWordList(raw.removedWords),
        allowWords: normalizeWordList(raw.allowWords),
        removedAllowWords: normalizeWordList(raw.removedAllowWords),
        reportThreshold: Number.isFinite(threshold) && threshold >= 1 && threshold <= 20 ? threshold : DEFAULT_REPORT_THRESHOLD
    };
}

function normalizeMutes(raw, nowMs) {
    const out = new Map();
    const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
    entries.forEach(entry => {
        if (!entry || !entry.playerId) return;
        const until = new Date(entry.until).getTime();
        if (!Number.isFinite(until) || until <= nowMs) return;
        out.set(String(entry.playerId), {
            playerId: String(entry.playerId),
            playerName: str(entry.playerName, 40),
            until: new Date(until).toISOString(),
            by: str(entry.by, 40) || 'Admin',
            reason: str(entry.reason, 120),
            createdAt: iso(entry.createdAt, new Date(nowMs).toISOString())
        });
    });
    return out;
}

/**
 * @param {Object} options
 *   file       ไฟล์ JSON (ใช้เมื่อไม่มี Mongo)
 *   getModel   () => Mongoose model (WorldChatState) หรือ null
 *   now        () => ms (เทสเลื่อนเวลาได้)
 *   debounceMs หน่วงเซฟ
 */
function createWorldChatStore(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 400;
    let file = options.file || null;
    let model = null;
    let useDatabase = false;
    let ready = false;

    let messages = [];
    let config = normalizeConfig();
    let compiled = chatFilter.compileFilter(config);
    let mutes = new Map();
    let saveTimer = null;
    let saving = null;
    let dirty = false;

    function snapshot() {
        pruneMutes();
        return {
            version: 1,
            messages,
            config,
            mutes: Array.from(mutes.values())
        };
    }

    function load(payload) {
        const data = payload && typeof payload === 'object' ? payload : {};
        messages = (Array.isArray(data.messages) ? data.messages : [])
            .map(normalizeMessage)
            .filter(Boolean)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .slice(-MESSAGE_LIMIT);
        config = normalizeConfig(data.config || {});
        compiled = chatFilter.compileFilter(config);
        mutes = normalizeMutes(data.mutes, now());
    }

    function writeFileSync() {
        if (!file) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(snapshot()), 'utf8');
        fs.renameSync(temporary, file);
    }

    async function persist() {
        if (!dirty) return;
        dirty = false;
        if (useDatabase && model) {
            await model.findOneAndUpdate(
                { key: 'main' },
                { $set: { payload: snapshot(), updatedAt: new Date() } },
                { upsert: true }
            );
            return;
        }
        writeFileSync();
    }

    function persistNow() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        const run = (saving || Promise.resolve()).catch(() => {}).then(() => persist()).catch(error => {
            dirty = true;
            console.error('[worldChat] save failed:', error.message);
        });
        saving = run;
        return run;
    }

    function markDirty() {
        dirty = true;
        if (saveTimer) return;
        saveTimer = setTimeout(() => {
            saveTimer = null;
            persistNow();
        }, debounceMs);
        if (typeof saveTimer.unref === 'function') saveTimer.unref();
    }

    function flushSyncOnExit() {
        if (!dirty || useDatabase) return;
        try {
            dirty = false;
            writeFileSync();
        } catch (error) {
            console.error('[worldChat] exit save failed:', error.message);
        }
    }

    async function init(initOptions = {}) {
        if (initOptions.file) file = initOptions.file;
        const wantDb = initOptions.useDatabase !== undefined
            ? initOptions.useDatabase
            : Boolean(options.isDbConnected && options.isDbConnected());
        model = wantDb && typeof options.getModel === 'function' ? options.getModel() : null;
        useDatabase = Boolean(wantDb && model);
        if (useDatabase) {
            const doc = await model.findOne({ key: 'main' }).lean();
            load(doc && doc.payload);
        } else if (file && fs.existsSync(file)) {
            try {
                load(JSON.parse(fs.readFileSync(file, 'utf8')));
            } catch (error) {
                console.error('[worldChat] could not read JSON:', error.message);
                // เก็บไฟล์เสียไว้ดูทีหลัง ไม่ให้การเซฟครั้งถัดไปเขียนทับ
                try { fs.renameSync(file, `${file}.broken-${Date.now()}`); } catch (renameError) { /* ignore */ }
                load(null);
            }
        } else {
            load(null);
        }
        ready = true;
        return { messages: messages.length, useDatabase };
    }

    // ---------- ข้อความ ----------

    function addMessage(raw) {
        const message = normalizeMessage({ ...raw, createdAt: new Date(now()).toISOString(), reports: [], hidden: false });
        if (!message) return null;
        messages.push(message);
        if (messages.length > MESSAGE_LIMIT) messages.splice(0, messages.length - MESSAGE_LIMIT);
        markDirty();
        return message;
    }

    function getMessage(id) {
        return messages.find(message => message.id === String(id)) || null;
    }

    function listMessages({ includeHidden = false } = {}) {
        return includeHidden ? messages.slice() : messages.filter(message => !message.hidden);
    }

    /**
     * @returns {{ status: 'reported'|'hidden'|'already'|'own'|'not_found'|'hidden_already', message? }}
     */
    function reportMessage(id, reporterId) {
        const message = getMessage(id);
        if (!message) return { status: 'not_found' };
        if (message.playerId === reporterId) return { status: 'own' };
        if (message.hidden) return { status: 'hidden_already', message };
        if (message.reports.includes(reporterId)) return { status: 'already', message };
        message.reports.push(reporterId);
        let status = 'reported';
        if (message.reports.length >= config.reportThreshold) {
            message.hidden = true;
            message.hiddenReason = 'reports';
            message.hiddenAt = new Date(now()).toISOString();
            status = 'hidden';
        }
        markDirty();
        return { status, message };
    }

    function hideMessage(id) {
        const message = getMessage(id);
        if (!message) return null;
        message.hidden = true;
        message.hiddenReason = 'admin';
        message.hiddenAt = new Date(now()).toISOString();
        markDirty();
        return message;
    }

    function restoreMessage(id) {
        const message = getMessage(id);
        if (!message) return null;
        message.hidden = false;
        message.hiddenReason = null;
        message.hiddenAt = null;
        message.reports = [];
        markDirty();
        return message;
    }

    function deleteMessage(id) {
        const index = messages.findIndex(message => message.id === String(id));
        if (index === -1) return null;
        const [removed] = messages.splice(index, 1);
        markDirty();
        return removed;
    }

    function deleteMessagesByPlayer(playerId) {
        const removed = messages.filter(message => message.playerId === playerId);
        if (!removed.length) return [];
        messages = messages.filter(message => message.playerId !== playerId);
        markDirty();
        return removed;
    }

    // ---------- ห้ามพิมพ์ (mute) ----------

    function pruneMutes() {
        const nowMs = now();
        mutes.forEach((entry, playerId) => {
            if (new Date(entry.until).getTime() <= nowMs) mutes.delete(playerId);
        });
    }

    function mute(playerId, durationMs, info = {}) {
        const ms = Math.max(60 * 1000, Math.min(30 * 24 * 60 * 60 * 1000, Math.floor(Number(durationMs) || 0)));
        const entry = {
            playerId: String(playerId),
            playerName: str(info.playerName, 40),
            until: new Date(now() + ms).toISOString(),
            by: str(info.by, 40) || 'Admin',
            reason: str(info.reason, 120),
            createdAt: new Date(now()).toISOString()
        };
        mutes.set(entry.playerId, entry);
        markDirty();
        return entry;
    }

    function unmute(playerId) {
        const existed = mutes.delete(String(playerId));
        if (existed) markDirty();
        return existed;
    }

    function getMute(playerId) {
        const entry = mutes.get(String(playerId));
        if (!entry) return null;
        if (new Date(entry.until).getTime() <= now()) {
            mutes.delete(String(playerId));
            markDirty();
            return null;
        }
        return entry;
    }

    function listMutes() {
        pruneMutes();
        return Array.from(mutes.values()).sort((a, b) => a.until.localeCompare(b.until));
    }

    // ---------- รายการคำ ----------

    function getConfig() {
        return JSON.parse(JSON.stringify(config));
    }

    function getCompiledFilter() {
        return compiled;
    }

    function applyConfig(next) {
        config = normalizeConfig(next);
        compiled = chatFilter.compileFilter(config);
        markDirty();
        return getConfig();
    }

    function isBuiltinBlock(word) {
        const key = String(word).normalize('NFC').toLowerCase();
        return chatFilter.BUILTIN_BLOCK.some(spec => spec.word.normalize('NFC').toLowerCase() === key);
    }

    function isBuiltinAllow(word) {
        const key = String(word).normalize('NFC').toLowerCase();
        return chatFilter.BUILTIN_ALLOW.some(item => item.normalize('NFC').toLowerCase() === key);
    }

    function sameWord(a, b) {
        return chatFilter.wordKey(a) === chatFilter.wordKey(b);
    }

    /**
     * list: 'block' | 'allow'  action: 'add' | 'remove'
     * คำตั้งต้น: ลบ = ใส่ใน removed*, เพิ่มกลับ = เอาออกจาก removed*
     */
    function editWord(list, action, rawWord) {
        const word = str(rawWord, WORD_MAX_LENGTH + 1).replace(/\s+/g, ' ').trim();
        if (!word) return { ok: false, error: 'พิมพ์คำก่อน' };
        if (word.length > WORD_MAX_LENGTH) return { ok: false, error: `ยาวเกิน ${WORD_MAX_LENGTH} ตัว` };
        const bare = word.replace(/^=/, '').trim();
        if (Array.from(bare).length < 2) return { ok: false, error: 'คำสั้นเกินไป (อย่างน้อย 2 ตัว)' };
        const next = getConfig();
        const isBlock = list === 'block';
        const builtin = isBlock ? isBuiltinBlock(bare) : isBuiltinAllow(bare);
        const extraKey = isBlock ? 'extraWords' : 'allowWords';
        const removedKey = isBlock ? 'removedWords' : 'removedAllowWords';
        if (action === 'add') {
            if (builtin) {
                next[removedKey] = next[removedKey].filter(item => !sameWord(item, bare));
            } else if (!next[extraKey].some(item => sameWord(item, word))) {
                if (next[extraKey].length >= WORD_LIST_MAX) return { ok: false, error: 'รายการเต็มแล้ว' };
                next[extraKey].push(word);
            }
        } else if (action === 'remove') {
            if (builtin) {
                if (!next[removedKey].some(item => sameWord(item, bare))) next[removedKey].push(bare);
            }
            next[extraKey] = next[extraKey].filter(item => !sameWord(item, word));
        } else {
            return { ok: false, error: 'คำสั่งไม่ถูกต้อง' };
        }
        return { ok: true, config: applyConfig(next) };
    }

    function setReportThreshold(value) {
        const threshold = Math.floor(Number(value));
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 20) {
            return { ok: false, error: 'ใส่ 1–20' };
        }
        return { ok: true, config: applyConfig({ ...getConfig(), reportThreshold: threshold }) };
    }

    /** รายการคำสำหรับหน้าแอดมิน: คำตั้งต้น (เปิด/ปิด) + คำที่เพิ่มเอง */
    function describeWords() {
        const removed = new Set(config.removedWords.map(word => word.normalize('NFC').toLowerCase()));
        const removedAllow = new Set(config.removedAllowWords.map(word => word.normalize('NFC').toLowerCase()));
        return {
            block: chatFilter.BUILTIN_BLOCK.map(spec => ({
                word: spec.word,
                builtin: true,
                exact: Boolean(spec.exact),
                enabled: !removed.has(spec.word.normalize('NFC').toLowerCase())
            })).concat(config.extraWords.map(word => ({ word, builtin: false, exact: word.startsWith('='), enabled: true }))),
            allow: chatFilter.BUILTIN_ALLOW.map(word => ({
                word,
                builtin: true,
                enabled: !removedAllow.has(word.normalize('NFC').toLowerCase())
            })).concat(config.allowWords.map(word => ({ word, builtin: false, enabled: true }))),
            reportThreshold: config.reportThreshold
        };
    }

    function reset() {
        load(null);
        markDirty();
    }

    return {
        MESSAGE_LIMIT,
        init,
        isReady: () => ready,
        isUsingDatabase: () => useDatabase,
        addMessage,
        getMessage,
        listMessages,
        reportMessage,
        hideMessage,
        restoreMessage,
        deleteMessage,
        deleteMessagesByPlayer,
        mute,
        unmute,
        getMute,
        listMutes,
        getConfig,
        getCompiledFilter,
        editWord,
        setReportThreshold,
        describeWords,
        persistNow,
        flushSyncOnExit,
        reset
    };
}

// ตัวหลักของแอป — ไฟล์ใน GAME_DATA_DIR / Mongo
const { WORLD_CHAT_FILE } = require('./dataPaths');
const defaultStore = createWorldChatStore({
    file: WORLD_CHAT_FILE,
    getModel: () => {
        try {
            return require('./models').WorldChatState;
        } catch (error) {
            return null;
        }
    },
    isDbConnected: () => {
        try {
            return require('./database').isDBConnected();
        } catch (error) {
            return false;
        }
    }
});

module.exports = defaultStore;
module.exports.createWorldChatStore = createWorldChatStore;
module.exports.MESSAGE_LIMIT = MESSAGE_LIMIT;
module.exports.DEFAULT_REPORT_THRESHOLD = DEFAULT_REPORT_THRESHOLD;
