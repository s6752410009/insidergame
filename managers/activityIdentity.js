'use strict';
const Avatar = require('../public/js/playerAvatar');
const cleanName = (value) =>
    typeof value === 'string' ? value.trim().slice(0, 160) : '';

// A recorded name is display evidence, not proof of an account. Never join it
// to an account by matching a current display name (names can be duplicated).
function recordedNames(log) {
    const meta = log.meta || {};
    const explicit = cleanName(meta.playerName || meta.actorName);
    if (explicit) return [explicit];
    if (meta.event === 'game_start' && typeof meta.players === 'string')
        return [meta.players.trim().slice(0, 380)].filter(Boolean);
    let message = String(log.message || '').trim();
    if (log.category === 'join') {
        const match = /^(.{1,160}?) เข้าห้อง(?:$|\s*\()/.exec(message);
        return match ? [match[1]] : [];
    }
    if (log.category === 'leave') {
        const match =
            /^(.{1,160}?) (?:ออกจากห้อง|ออกกลางเกม|ถูกเตะออก|ถูกแอดมินเตะออก|ถูกหัวห้องเตะออก)/.exec(
                message,
            );
        return match ? [match[1]] : [];
    }
    if (
        log.gameMode === 'liar' &&
        (meta.event === 'liar_history' || message.startsWith('🃏'))
    ) {
        message = message
            .replace(/^🃏\s*/u, '')
            .replace(/^(?:🂠|✅|🚨|😈|💥|🔫|💔|💀|⏰|🚪|🏆|🎬)\s*/u, '');
        const match =
            /^(.{1,160}?) (?:ลง \d+ ใบ บอกว่าเป็น|ท้าแล้วพลาด —|จับได้!|ท้าโดนไพ่ปีศาจของ|ลั่นไก —|เสียหัวใจ 1 ดวง|หัวใจหมด —|เป็นผู้รอดคนสุดท้าย!|หมดเวลา —|ออกจากเกม —)/u.exec(
                message,
            );
        return match ? [match[1]] : [];
    }
    return [];
}

function profileFields(player) {
    if (!player) return {};
    const out = {};
    if (typeof player.avatar === 'string' && player.avatar)
        out.avatar = player.avatar.slice(0, 32);
    if (
        typeof player.avatarFrame === 'string' &&
        Object.hasOwn(Avatar.FRAME_STYLES, player.avatarFrame)
    )
        out.avatarFrame = player.avatarFrame;
    if (
        typeof player.color === 'string' &&
        /^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(player.color)
    )
        out.color = player.color;
    Object.assign(out, Avatar.avatarImageField(player));
    return out;
}
module.exports = { recordedNames, profileFields };
