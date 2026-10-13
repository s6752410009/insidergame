/**
 * แชทโลก — ต่อ socket.io (ฝั่งผู้เล่น + ฝั่งแอดมิน)
 *
 * ผู้เล่น (ตัวตน = socket.playerId จากคุกกี้ ไม่รับ id จาก client):
 *   worldChat:subscribe { since }  → { unread, latestAt, me }   (หน้าเว็บเปิด → แค่นับยังไม่อ่าน ไม่โหลดทั้งก้อน)
 *   worldChat:history              → { messages, me }          (เปิดแผงแชท)
 *   worldChat:send { text }        → { success } | { success:false, code, error }  (คำเตือนเห็นแค่คนส่ง)
 *   worldChat:report { messageId } → { success, hidden }
 *   worldChat:invite               → ส่งการ์ด "เชิญมาเล่น" ของห้องที่อยู่ตอนนี้
 * ส่งออก: worldChat:message (ข้อความใหม่/ที่แอดมินคืน), worldChat:removed { ids }, worldChat:me (สถานะตัวเองเปลี่ยน)
 *
 * แอดมิน (ต้อง login แอดมินแล้ว):
 *   admin_worldChatGet · admin_worldChatAction { action, messageId?, playerId?, minutes? }
 *   admin_worldChatWord { list, op, word } · admin_worldChatSettings { reportThreshold } · admin_worldChatTest { text }
 */

'use strict';

const chatFilter = require('./worldChatFilter');

const ROOM = 'world-chat';
const MUTE_PRESETS = { 10: '10 นาที', 1440: '1 วัน' };

function respond(callback, payload) {
    if (typeof callback === 'function') callback(payload);
}

function pickCallback(data, callback) {
    return typeof data === 'function' ? data : callback;
}

/**
 * @param {Object} deps
 *   io, service, store
 *   getPlayerId(socket)            → playerId ที่เชื่อได้ หรือ null
 *   describeInviteRoom(socket, id) → { roomId, roomName, gameMode, gameLabel, emoji, count, max, locked } | null
 *   liveRoom(roomId)               → { status: 'open'|'full'|'playing'|'closed', count, max } | null
 *   log(category, message, type, meta)
 *   getPlayerName(id)
 *   getAdminSocketIds()            → Iterable<socketId>
 */
function createWorldChatHub(deps) {
    const { io, service, store } = deps;

    function statusFor(playerId) {
        const status = service.getStatus(playerId);
        return {
            playerId: playerId || null,
            canSend: Boolean(status.canSend),
            canReport: Boolean(status.canReport),
            reason: status.reason || null,
            message: status.message || null,
            mutedUntil: status.mutedUntil || null,
            sendIntervalMs: service.SEND_INTERVAL_MS,
            maxLength: chatFilter.MAX_LENGTH
        };
    }

    // ห้องที่ชวนได้ตอนนี้ (ให้หน้าเว็บโชว์ปุ่ม "ชวนเข้าห้อง") — หาจากฝั่ง server เท่านั้น
    function meFor(socket, playerId) {
        const me = statusFor(playerId);
        if (me.canSend && playerId && typeof deps.describeInviteRoom === 'function') {
            const room = deps.describeInviteRoom(socket, playerId);
            me.inviteRoom = room ? { roomName: room.roomName, gameLabel: room.gameLabel, emoji: room.emoji, count: room.count, max: room.max } : null;
        } else {
            me.inviteRoom = null;
        }
        return me;
    }

    function broadcastMessage(message) {
        io.to(ROOM).emit('worldChat:message', service.toPublic(message, deps.liveRoom));
    }

    function broadcastRemoved(ids) {
        if (ids.length) io.to(ROOM).emit('worldChat:removed', { ids });
    }

    function notifyAdmins(reason) {
        const ids = typeof deps.getAdminSocketIds === 'function' ? deps.getAdminSocketIds() : [];
        for (const socketId of ids) io.to(socketId).emit('adminWorldChatUpdate', { reason });
    }

    /** สถานะเปลี่ยน (โดนห้ามพิมพ์/ปลด/แบน) → บอกทุกแท็บของคนนั้น */
    function notifyPlayerStatus(playerId) {
        if (!playerId || !io.sockets || !io.sockets.sockets) return;
        const status = statusFor(playerId);
        io.sockets.sockets.forEach(socket => {
            if (socket.playerId === playerId) socket.emit('worldChat:me', status);
        });
    }

    function log(category, message, type, meta) {
        if (typeof deps.log === 'function') {
            try { deps.log(category, message, type, meta); } catch (error) { /* log พังห้ามทำแชทพัง */ }
        }
    }

    function nameOf(playerId) {
        return (typeof deps.getPlayerName === 'function' && deps.getPlayerName(playerId)) || playerId;
    }

    function attach(socket) {
        const on = (event, handler) => socket.on(event, (...args) => {
            try {
                handler(...args);
            } catch (error) {
                console.error(`[worldChat:${event}]`, error);
                const callback = args.find(arg => typeof arg === 'function');
                respond(callback, { success: false, error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' });
            }
        });

        on('worldChat:subscribe', (data, callback) => {
            const done = pickCallback(data, callback);
            socket.join(ROOM);
            const playerId = deps.getPlayerId(socket);
            const since = data && typeof data.since === 'string' ? Date.parse(data.since) : NaN;
            const visible = store.listMessages();
            const unread = Number.isFinite(since)
                ? visible.filter(message => Date.parse(message.createdAt) > since && message.playerId !== playerId).length
                : 0;
            respond(done, {
                success: true,
                unread,
                latestAt: visible.length ? visible[visible.length - 1].createdAt : null,
                me: meFor(socket, playerId)
            });
        });

        on('worldChat:history', (data, callback) => {
            const done = pickCallback(data, callback);
            socket.join(ROOM);
            const playerId = deps.getPlayerId(socket);
            respond(done, { success: true, messages: service.history(deps.liveRoom), me: meFor(socket, playerId) });
        });

        on('worldChat:send', (data, callback) => {
            const playerId = deps.getPlayerId(socket);
            const text = data && typeof data.text === 'string' ? data.text : '';
            const result = service.send(playerId, text);
            if (!result.ok) {
                if (['profanity', 'link', 'line', 'phone'].includes(result.code)) {
                    log('chat', `🚫 แชทโลก: บล็อกข้อความของ ${nameOf(playerId)} (${result.code === 'profanity' ? 'คำไม่สุภาพ' : 'ช่องทางติดต่อ/ลิงก์'})`, 'warning', {
                        event: 'world_chat_blocked', playerId, reason: result.code,
                        words: result.words ? result.words.join(', ') : undefined,
                        text: text.slice(0, 200)
                    });
                }
                respond(callback, {
                    success: false,
                    code: result.code,
                    error: result.error,
                    retryInMs: result.retryInMs || 0,
                    me: result.status ? statusFor(playerId) : undefined
                });
                return;
            }
            broadcastMessage(result.message);
            log('chat', `💬 ${result.message.playerName}: ${result.message.text}`, 'info', {
                event: 'world_chat_message', playerId, messageId: result.message.id
            });
            respond(callback, { success: true, id: result.message.id });
        });

        on('worldChat:report', (data, callback) => {
            const playerId = deps.getPlayerId(socket);
            const messageId = data && typeof data.messageId === 'string' ? data.messageId : '';
            const result = service.report(playerId, messageId);
            if (!result.ok) {
                respond(callback, { success: false, code: result.code, error: result.error });
                return;
            }
            if (result.status === 'reported' || result.status === 'hidden') {
                const target = result.message;
                log('chat', `🚩 ${nameOf(playerId)} รายงานข้อความของ ${target.playerName} (${target.reports.length}/${store.getConfig().reportThreshold})`, 'info', {
                    event: 'world_chat_report', playerId, messageId: target.id, author: target.playerId
                });
                if (result.status === 'hidden') {
                    broadcastRemoved([target.id]);
                    log('chat', `🙈 แชทโลก: ซ่อนข้อความของ ${target.playerName} อัตโนมัติ (รายงานครบ ${target.reports.length} คน) รอแอดมินตรวจ`, 'warning', {
                        event: 'world_chat_auto_hidden', messageId: target.id, author: target.playerId, text: (target.text || '').slice(0, 200)
                    });
                }
                notifyAdmins('report');
            }
            respond(callback, { success: true, status: result.status, hidden: result.hidden });
        });

        on('worldChat:invite', (data, callback) => {
            const done = pickCallback(data, callback);
            const playerId = deps.getPlayerId(socket);
            const room = playerId ? deps.describeInviteRoom(socket, playerId) : null;
            const result = service.invite(playerId, room);
            if (!result.ok) {
                respond(done, { success: false, code: result.code, error: result.error, retryInMs: result.retryInMs || 0 });
                return;
            }
            broadcastMessage(result.message);
            log('chat', `📣 ${result.message.playerName} ชวนเล่น ${result.message.invite.gameLabel} ห้อง ${result.message.invite.roomName}`, 'info', {
                event: 'world_chat_invite', playerId, messageId: result.message.id, roomId: result.message.invite.roomId
            });
            respond(done, { success: true, id: result.message.id });
        });
    }

    // ---------- แอดมิน ----------

    function adminMessages() {
        return store.listMessages({ includeHidden: true }).slice().reverse().map(message => ({
            ...service.toPublic(message, deps.liveRoom),
            reports: message.reports.length,
            reporters: message.reports.slice(0, 10).map(id => nameOf(id)),
            hidden: message.hidden,
            hiddenReason: message.hiddenReason,
            muted: Boolean(store.getMute(message.playerId))
        }));
    }

    function adminSnapshot() {
        const messages = adminMessages();
        return {
            success: true,
            messages,
            words: store.describeWords(),
            mutes: store.listMutes(),
            counts: {
                total: messages.length,
                hidden: messages.filter(message => message.hidden).length,
                reported: messages.filter(message => message.reports > 0 && !message.hidden).length
            },
            limit: store.MESSAGE_LIMIT,
            mutePresets: MUTE_PRESETS
        };
    }

    function attachAdmin(socket, admin) {
        const guard = (event, handler) => socket.on(event, (data, callback) => {
            const done = pickCallback(data, callback);
            const payload = data && typeof data === 'object' ? data : {};
            if (!admin.isAdmin(socket)) {
                respond(done, { success: false, error: 'Unauthorized' });
                return;
            }
            try {
                handler(payload, done);
            } catch (error) {
                console.error(`[${event}]`, error);
                respond(done, { success: false, error: error.message });
            }
        });

        guard('admin_worldChatGet', (data, done) => respond(done, adminSnapshot()));

        guard('admin_worldChatAction', (data, done) => {
            const action = String(data.action || '');
            const messageId = String(data.messageId || '');
            if (['delete', 'hide', 'restore'].includes(action)) {
                const message = store.getMessage(messageId);
                if (!message) return respond(done, { success: false, error: 'ไม่พบข้อความ (อาจถูกลบไปแล้ว)' });
                if (action === 'delete') {
                    store.deleteMessage(messageId);
                    broadcastRemoved([messageId]);
                } else if (action === 'hide') {
                    store.hideMessage(messageId);
                    broadcastRemoved([messageId]);
                } else {
                    store.restoreMessage(messageId);
                    broadcastMessage(store.getMessage(messageId));
                }
                const verb = { delete: 'ลบ', hide: 'ซ่อน', restore: 'คืน' }[action];
                admin.audit(`${verb}ข้อความแชทโลกของ ${message.playerName}: "${(message.text || message.invite?.roomName || '').slice(0, 80)}"`, {
                    event: `world_chat_${action}`, playerId: message.playerId, messageId
                });
                return respond(done, adminSnapshot());
            }

            const playerId = String(data.playerId || '');
            if (!playerId) return respond(done, { success: false, error: 'ไม่ระบุผู้เล่น' });
            const playerName = nameOf(playerId);
            if (action === 'mute') {
                const minutes = Math.floor(Number(data.minutes));
                if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30 * 24 * 60) {
                    return respond(done, { success: false, error: 'ระยะเวลาไม่ถูกต้อง' });
                }
                const entry = store.mute(playerId, minutes * 60 * 1000, { playerName, by: 'Admin', reason: String(data.reason || '').slice(0, 120) });
                notifyPlayerStatus(playerId);
                admin.audit(`ห้าม ${playerName} พิมพ์แชทโลก ${MUTE_PRESETS[minutes] || minutes + ' นาที'}`, {
                    event: 'world_chat_mute', playerId, minutes, until: entry.until
                });
                return respond(done, adminSnapshot());
            }
            if (action === 'unmute') {
                store.unmute(playerId);
                notifyPlayerStatus(playerId);
                admin.audit(`ปลดห้ามพิมพ์แชทโลก ${playerName}`, { event: 'world_chat_unmute', playerId }, 'info');
                return respond(done, adminSnapshot());
            }
            if (action === 'purge') {
                const removed = store.deleteMessagesByPlayer(playerId);
                broadcastRemoved(removed.map(message => message.id));
                admin.audit(`ลบข้อความแชทโลกทั้งหมดของ ${playerName} (${removed.length} ข้อความ)`, { event: 'world_chat_purge', playerId, count: removed.length });
                return respond(done, adminSnapshot());
            }
            if (action === 'statusChanged') {
                // หลังแบน/ปลดแบนจากแท็บแชท — ให้หน้าเว็บของคนนั้นรู้ทันที
                notifyPlayerStatus(playerId);
                return respond(done, adminSnapshot());
            }
            return respond(done, { success: false, error: 'คำสั่งไม่ถูกต้อง' });
        });

        guard('admin_worldChatWord', (data, done) => {
            const list = data.list === 'allow' ? 'allow' : 'block';
            const op = data.op === 'remove' ? 'remove' : 'add';
            const result = store.editWord(list, op, data.word);
            if (!result.ok) return respond(done, { success: false, error: result.error });
            admin.audit(`${op === 'add' ? 'เพิ่ม' : 'ลบ'}คำ${list === 'allow' ? 'ที่อนุญาต' : 'ต้องห้าม'}แชทโลก: ${String(data.word).slice(0, 40)}`, {
                event: 'world_chat_word', list, op
            }, 'info');
            return respond(done, adminSnapshot());
        });

        guard('admin_worldChatSettings', (data, done) => {
            const result = store.setReportThreshold(data.reportThreshold);
            if (!result.ok) return respond(done, { success: false, error: result.error });
            admin.audit(`ตั้งแชทโลก: ซ่อนอัตโนมัติเมื่อรายงานครบ ${result.config.reportThreshold} คน`, { event: 'world_chat_settings' }, 'info');
            return respond(done, adminSnapshot());
        });

        guard('admin_worldChatTest', (data, done) => {
            const verdict = chatFilter.checkMessage(String(data.text || '').slice(0, 800), store.getCompiledFilter());
            respond(done, { success: true, verdict });
        });
    }

    return { ROOM, attach, attachAdmin, notifyPlayerStatus, broadcastRemoved, statusFor };
}

module.exports = { createWorldChatHub, ROOM };
