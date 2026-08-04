/**
 * AdminMessageManager
 * Persistent player <-> site-admin inbox with MongoDB and JSON fallback.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let AdminMessageThread = null;
try {
    ({ AdminMessageThread } = require('./models'));
} catch (error) {
    console.warn('[AdminMessages] Mongo model unavailable:', error.message);
}

const { ADMIN_MESSAGES_FILE: THREADS_FILE } = require('./dataPaths');
const threads = new Map();
const threadWriteQueues = new Map();
let useDatabase = false;

function withThreadLock(playerId, task) {
    const key = String(playerId);
    const previous = threadWriteQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    threadWriteQueues.set(key, current);
    current.finally(() => {
        if (threadWriteQueues.get(key) === current) threadWriteQueues.delete(key);
    }).catch(() => {});
    return current;
}

function normalizeMessage(message) {
    return {
        messageId: String(message.messageId || uuidv4()),
        sender: message.sender === 'admin' ? 'admin' : 'user',
        body: String(message.body || ''),
        createdAt: new Date(message.createdAt || Date.now()).toISOString(),
        readAt: message.readAt ? new Date(message.readAt).toISOString() : null
    };
}

function normalizeThread(thread) {
    const messages = Array.isArray(thread.messages) ? thread.messages.map(normalizeMessage) : [];
    return {
        playerId: String(thread.playerId || ''),
        playerName: String(thread.playerName || 'Unknown'),
        messages,
        createdAt: new Date(thread.createdAt || messages[0]?.createdAt || Date.now()).toISOString(),
        updatedAt: new Date(thread.updatedAt || Date.now()).toISOString(),
        lastMessageAt: new Date(thread.lastMessageAt || messages[messages.length - 1]?.createdAt || Date.now()).toISOString()
    };
}

async function initAdminMessageManager() {
    const { isDBConnected } = require('./database');
    useDatabase = Boolean(AdminMessageThread && isDBConnected());

    threads.clear();
    if (useDatabase) {
        const storedThreads = await AdminMessageThread.find({}).sort({ lastMessageAt: -1 }).lean();
        storedThreads.forEach(thread => {
            const normalized = normalizeThread(thread);
            threads.set(normalized.playerId, normalized);
        });
        console.log(`✅ Admin messages using MongoDB (${threads.size} threads)`);
        return;
    }

    if (fs.existsSync(THREADS_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(THREADS_FILE, 'utf8'));
            const storedThreads = Array.isArray(raw) ? raw : Object.values(raw || {});
            storedThreads.forEach(thread => {
                const normalized = normalizeThread(thread);
                if (normalized.playerId) threads.set(normalized.playerId, normalized);
            });
        } catch (error) {
            console.error('[AdminMessages] Could not read JSON fallback:', error.message);
        }
    }
    console.log(`📁 Admin messages using JSON (${threads.size} threads)`);
}

function saveJson() {
    if (useDatabase) return;
    const directory = path.dirname(THREADS_FILE);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = `${THREADS_FILE}.${process.pid}.tmp`;
    const payload = Object.fromEntries(Array.from(threads.entries()));
    fs.writeFileSync(temporaryFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporaryFile, THREADS_FILE);
}

async function persistThread(thread) {
    if (useDatabase) {
        await AdminMessageThread.findOneAndUpdate(
            { playerId: thread.playerId },
            { $set: thread },
            { upsert: true, setDefaultsOnInsert: true }
        );
        return;
    }
    saveJson();
}

function summarizeThread(thread) {
    const lastMessage = thread.messages[thread.messages.length - 1] || null;
    return {
        playerId: thread.playerId,
        playerName: thread.playerName,
        lastMessage,
        lastMessageAt: thread.lastMessageAt,
        unreadForAdmin: thread.messages.filter(message => message.sender === 'user' && !message.readAt).length,
        unreadForUser: thread.messages.filter(message => message.sender === 'admin' && !message.readAt).length,
        messageCount: thread.messages.length
    };
}

function getUnreadAdminCount() {
    return Array.from(threads.values()).reduce((count, thread) => {
        return count + thread.messages.filter(message => message.sender === 'user' && !message.readAt).length;
    }, 0);
}

function listThreads() {
    return Array.from(threads.values())
        .map(summarizeThread)
        .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

function getThread(playerId) {
    const thread = threads.get(String(playerId));
    if (!thread) {
        return {
            playerId: String(playerId),
            playerName: 'Unknown',
            messages: [],
            unreadForAdmin: 0,
            unreadForUser: 0
        };
    }
    return {
        ...thread,
        ...summarizeThread(thread)
    };
}

function appendMessage(playerId, playerName, sender, body) {
    return withThreadLock(playerId, async () => {
        const now = new Date().toISOString();
        const existing = threads.get(String(playerId));
        const thread = existing || normalizeThread({
            playerId,
            playerName,
            messages: [],
            createdAt: now,
            updatedAt: now,
            lastMessageAt: now
        });
        const message = normalizeMessage({
            messageId: uuidv4(),
            sender,
            body,
            createdAt: now,
            readAt: null
        });

        thread.playerName = String(playerName || thread.playerName || 'Unknown');
        thread.messages.push(message);
        thread.updatedAt = now;
        thread.lastMessageAt = now;
        threads.set(thread.playerId, thread);
        await persistThread(thread);
        return { message, thread: getThread(thread.playerId) };
    });
}

function markRead(playerId, reader) {
    return withThreadLock(playerId, async () => {
        const thread = threads.get(String(playerId));
        if (!thread) return getThread(playerId);

        const senderToMark = reader === 'admin' ? 'user' : 'admin';
        const now = new Date().toISOString();
        let changed = false;
        thread.messages.forEach(message => {
            if (message.sender === senderToMark && !message.readAt) {
                message.readAt = now;
                changed = true;
            }
        });
        if (changed) {
            thread.updatedAt = now;
            await persistThread(thread);
        }
        return getThread(playerId);
    });
}

module.exports = {
    initAdminMessageManager,
    listThreads,
    getThread,
    appendMessage,
    markRead,
    getUnreadAdminCount
};
