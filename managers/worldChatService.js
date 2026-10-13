/**
 * แชทโลก — กติกาฝั่งเซิร์ฟเวอร์ทั้งหมด (ใครพิมพ์ได้ ช้าเร็ว ซ้ำ ลิงก์ คำหยาบ รายงาน ชวนเล่น)
 *
 * client ส่งมาได้แค่ "ข้อความ" / "id ข้อความที่จะรายงาน" — ตัวตนมาจาก socket.playerId (คุกกี้ที่เซ็นแล้ว)
 * ไม่มีอะไรจาก client ที่ข้ามกติกาข้างล่างได้
 *
 * ใครพิมพ์ได้:
 *   - ต้องมีบัญชีจริง (ไม่ใช่บอท) และไม่ติดแบน/ไม่ถูกห้ามพิมพ์/ผ่านการอนุมัติ (ถ้าเปิดระบบอนุมัติ)
 *   - เล่นจบอย่างน้อย 1 เกม หรือ ผูก Google แล้ว (แอดมินเว็บพิมพ์ได้เสมอ)
 *   - คนใหม่อ่านได้ แต่พิมพ์ไม่ได้
 * กันสแปม:
 *   - 1 ข้อความ / 5 วิ ต่อคน (นับทั้งที่ถูกบล็อกด้วย — กันลองคำหลบรัวๆ)
 *   - ห้ามส่งข้อความเดิมซ้ำกับข้อความล่าสุดของตัวเอง
 *   - ห้ามลิงก์ / LINE / เบอร์โทร, ยาวไม่เกิน 200 ตัว
 *   - การ์ดชวนเล่น: 1 ครั้ง / 60 วิ ต่อคน
 *   - รายงาน: 10 ครั้ง / นาที ต่อคน
 */

'use strict';

const chatFilter = require('./worldChatFilter');

const SEND_INTERVAL_MS = 5000;
const INVITE_INTERVAL_MS = 60 * 1000;
const REPORT_WINDOW_MS = 60 * 1000;
const REPORT_LIMIT = 10;

const REASON_TEXT = {
    no_player: 'เปิดหน้าใหม่แล้วลองอีกครั้ง',
    bot: 'บอทพิมพ์ไม่ได้',
    banned: 'บัญชีนี้ถูกแบน พิมพ์ในแชทโลกไม่ได้',
    muted: 'ถูกห้ามพิมพ์ชั่วคราว',
    not_approved: 'รอแอดมินอนุมัติบัญชีก่อน',
    newcomer: 'เล่นจบ 1 เกม หรือเข้าสู่ระบบด้วย Google ก่อน ถึงจะพิมพ์ได้'
};

const BLOCK_TEXT = {
    empty: 'พิมพ์ข้อความก่อน',
    too_long: `ยาวเกิน ${chatFilter.MAX_LENGTH} ตัวอักษร`,
    link: 'ส่งลิงก์ไม่ได้ (กันมิจฉาชีพ)',
    line: 'ห้ามใส่ไอดี LINE / ช่องทางติดต่อ (กันมิจฉาชีพ)',
    phone: 'ห้ามใส่เบอร์โทร (กันมิจฉาชีพ)',
    profanity: 'มีคำไม่สุภาพ ข้อความนี้ไม่ถูกส่ง',
    repeat: 'ส่งข้อความเดิมซ้ำไม่ได้',
    rate: 'ส่งเร็วไป รอสักครู่'
};

/**
 * @param {Object} deps
 *   store            worldChatManager (หรือตัวที่สร้างจาก createWorldChatStore)
 *   now              () => ms
 *   getPlayer        (id) => { playerId, playerName, color, avatar, avatarFrame } | null
 *   getGamesPlayed   (id) => number
 *   isGoogleLinked   (id) => bool
 *   isBanned         (id) => bool
 *   isApproved       (id) => bool
 *   isSiteAdmin      (id) => bool
 *   isBot            (id) => bool
 *   avatarImageField (player) => { avatarImage? }
 */
function createWorldChatService(deps) {
    const store = deps.store;
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const call = (fn, fallback, ...args) => {
        try {
            return typeof fn === 'function' ? fn(...args) : fallback;
        } catch (error) {
            return fallback;
        }
    };

    // สถานะชั่วคราวต่อคน (ไม่ต้องเก็บถาวร — รีสตาร์ตแล้วเริ่มนับใหม่ได้)
    const lastAttemptAt = new Map();
    const lastTextKey = new Map();
    const lastInviteAt = new Map();
    const reportTimes = new Map();

    function pruneMaps() {
        if (lastAttemptAt.size < 5000) return;
        const cutoff = now() - 10 * 60 * 1000;
        lastAttemptAt.forEach((at, id) => { if (at < cutoff) lastAttemptAt.delete(id); });
        lastInviteAt.forEach((at, id) => { if (at < cutoff) lastInviteAt.delete(id); });
        reportTimes.forEach((times, id) => { if (!times.some(at => at > cutoff)) reportTimes.delete(id); });
    }

    /** @returns {{ canSend, reason?, message?, mutedUntil? , canReport }} */
    function getStatus(playerId) {
        if (!playerId) return { canSend: false, canReport: false, reason: 'no_player', message: REASON_TEXT.no_player };
        if (call(deps.isBot, false, playerId) || String(playerId).startsWith('bot_')) {
            return { canSend: false, canReport: false, reason: 'bot', message: REASON_TEXT.bot };
        }
        const player = call(deps.getPlayer, null, playerId);
        if (!player) return { canSend: false, canReport: false, reason: 'no_player', message: REASON_TEXT.no_player };
        if (call(deps.isBanned, false, playerId)) {
            return { canSend: false, canReport: false, reason: 'banned', message: REASON_TEXT.banned };
        }
        if (!call(deps.isApproved, true, playerId)) {
            return { canSend: false, canReport: false, reason: 'not_approved', message: REASON_TEXT.not_approved };
        }
        const isAdmin = call(deps.isSiteAdmin, false, playerId);
        const eligible = isAdmin
            || Number(call(deps.getGamesPlayed, 0, playerId)) >= 1
            || call(deps.isGoogleLinked, false, playerId);
        if (!eligible) {
            return { canSend: false, canReport: false, reason: 'newcomer', message: REASON_TEXT.newcomer };
        }
        const mute = store.getMute(playerId);
        if (mute) {
            return {
                canSend: false,
                canReport: true,
                reason: 'muted',
                mutedUntil: mute.until,
                message: `${REASON_TEXT.muted} ถึง ${formatThaiTime(mute.until)}`
            };
        }
        return { canSend: true, canReport: true, isAdmin };
    }

    function formatThaiTime(isoText) {
        try {
            return new Date(isoText).toLocaleString('th-TH', {
                timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
        } catch (error) {
            return isoText;
        }
    }

    function rateCheck(map, playerId, interval) {
        const last = map.get(playerId) || 0;
        const wait = last + interval - now();
        return wait > 0 ? wait : 0;
    }

    function fail(code, extra = {}) {
        return { ok: false, code, error: BLOCK_TEXT[code] || REASON_TEXT[code] || 'ส่งไม่ได้', ...extra };
    }

    function authorFields(player) {
        return {
            playerId: player.playerId,
            playerName: player.playerName,
            color: player.color,
            avatar: player.avatar || '👤',
            avatarFrame: player.avatarFrame || 'none'
        };
    }

    /**
     * @returns {{ ok: true, message } | { ok: false, code, error, retryInMs?, words? }}
     */
    function send(playerId, rawText) {
        pruneMaps();
        const status = getStatus(playerId);
        if (!status.canSend) return { ...fail(status.reason), error: status.message, status };

        const wait = rateCheck(lastAttemptAt, playerId, SEND_INTERVAL_MS);
        if (wait > 0) {
            return fail('rate', { retryInMs: wait, error: `ส่งเร็วไป รออีก ${Math.ceil(wait / 1000)} วิ` });
        }
        if (typeof rawText !== 'string') return fail('empty');
        // นับเวลาก่อนตรวจ: ข้อความที่โดนบล็อกก็ต้องรอ 5 วิ (กันลองคำหลบรัวๆ)
        const trimmed = rawText.slice(0, chatFilter.MAX_LENGTH * 4);
        const verdict = chatFilter.checkMessage(trimmed, store.getCompiledFilter());
        if (!verdict.ok) {
            if (verdict.reason !== 'empty' && verdict.reason !== 'too_long') lastAttemptAt.set(playerId, now());
            return fail(verdict.reason, verdict.words ? { words: verdict.words } : {});
        }
        const key = chatFilter.repeatKey(verdict.text);
        if (lastTextKey.get(playerId) === key) return fail('repeat');

        const player = call(deps.getPlayer, null, playerId);
        const message = store.addMessage({ ...authorFields(player), kind: 'text', text: verdict.text });
        if (!message) return fail('empty');
        lastAttemptAt.set(playerId, now());
        lastTextKey.set(playerId, key);
        return { ok: true, message };
    }

    /**
     * room: ข้อมูลห้องที่ app.js หาให้จาก socket (ไม่รับจาก client)
     *   { roomId, roomName, gameMode, gameLabel, emoji, count, max, locked }
     */
    function invite(playerId, room) {
        pruneMaps();
        const status = getStatus(playerId);
        if (!status.canSend) return { ...fail(status.reason), error: status.message, status };
        if (!room || !room.roomId) return { ok: false, code: 'no_room', error: 'ต้องอยู่ในห้องที่ยังรอคนก่อน ถึงจะชวนได้' };
        const wait = Math.max(rateCheck(lastInviteAt, playerId, INVITE_INTERVAL_MS), rateCheck(lastAttemptAt, playerId, SEND_INTERVAL_MS));
        if (wait > 0) {
            return fail('rate', { retryInMs: wait, error: `ชวนได้อีกครั้งใน ${Math.ceil(wait / 1000)} วิ` });
        }
        // ชื่อห้องตั้งเองได้ — ต้องผ่านตัวกรองเหมือนข้อความ
        const nameVerdict = chatFilter.checkMessage(String(room.roomName || 'ห้อง'), store.getCompiledFilter());
        const roomName = nameVerdict.ok ? nameVerdict.text : (room.gameLabel || 'ห้องเกม');
        const player = call(deps.getPlayer, null, playerId);
        const message = store.addMessage({
            ...authorFields(player),
            kind: 'invite',
            invite: { ...room, roomName }
        });
        if (!message) return { ok: false, code: 'no_room', error: 'ชวนไม่สำเร็จ' };
        lastInviteAt.set(playerId, now());
        lastAttemptAt.set(playerId, now());
        lastTextKey.delete(playerId);
        return { ok: true, message };
    }

    /** @returns {{ ok, status?, hidden?, message?, error? }} */
    function report(playerId, messageId) {
        const status = getStatus(playerId);
        if (!status.canReport) return { ok: false, code: status.reason, error: status.message };
        const times = (reportTimes.get(playerId) || []).filter(at => now() - at < REPORT_WINDOW_MS);
        if (times.length >= REPORT_LIMIT) {
            reportTimes.set(playerId, times);
            return { ok: false, code: 'rate', error: 'รายงานถี่เกินไป รอสักครู่' };
        }
        const result = store.reportMessage(String(messageId || '').slice(0, 40), playerId);
        if (result.status === 'not_found') return { ok: false, code: 'not_found', error: 'ไม่พบข้อความนี้แล้ว' };
        if (result.status === 'own') return { ok: false, code: 'own', error: 'รายงานข้อความตัวเองไม่ได้' };
        if (result.status === 'reported' || result.status === 'hidden') {
            times.push(now());
            reportTimes.set(playerId, times);
        }
        return {
            ok: true,
            status: result.status,
            hidden: result.status === 'hidden' || result.status === 'hidden_already',
            message: result.message
        };
    }

    /** payload ที่ส่งให้ทุกคน — ไม่มีรายชื่อคนรายงาน */
    function toPublic(message, liveRoom) {
        const player = call(deps.getPlayer, null, message.playerId);
        const out = {
            id: message.id,
            kind: message.kind,
            playerId: message.playerId,
            playerName: player?.playerName || message.playerName,
            color: player?.color || message.color,
            avatar: player?.avatar || message.avatar,
            avatarFrame: player?.avatarFrame || message.avatarFrame,
            ...(player ? call(deps.avatarImageField, {}, player) : {}),
            isAdmin: Boolean(call(deps.isSiteAdmin, false, message.playerId)),
            text: message.text,
            createdAt: message.createdAt
        };
        if (message.kind === 'invite' && message.invite) {
            out.invite = { ...message.invite };
            const live = typeof liveRoom === 'function' ? call(liveRoom, null, message.invite.roomId) : null;
            out.invite.status = live ? live.status : 'unknown';
            if (live && Number.isFinite(live.count)) out.invite.count = live.count;
            if (live && Number.isFinite(live.max)) out.invite.max = live.max;
        }
        return out;
    }

    function history(liveRoom) {
        return store.listMessages().map(message => toPublic(message, liveRoom));
    }

    function forgetPlayer(playerId) {
        lastTextKey.delete(playerId);
    }

    return {
        SEND_INTERVAL_MS,
        INVITE_INTERVAL_MS,
        getStatus,
        send,
        invite,
        report,
        toPublic,
        history,
        forgetPlayer
    };
}

module.exports = {
    createWorldChatService,
    SEND_INTERVAL_MS,
    INVITE_INTERVAL_MS,
    REPORT_LIMIT,
    BLOCK_TEXT,
    REASON_TEXT
};
