/* Shared player avatar + frame renderer.
 *
 * ก่อนหน้านี้แต่ละหน้า copy ตาราง gradient ของกรอบไปคนละชุด ทำให้กรอบโผล่แค่บาง
 * หน้า (leaderboard / โมดัลโปรไฟล์) และหลุดหายในแชท รายชื่อผู้เล่น และกระดานเกม
 * ไฟล์นี้เป็นแหล่งเดียวของกรอบ + ตัว render เพื่อให้ทุกที่ที่โชว์รูปผู้เล่นเหมือนกันหมด
 *
 * ต้องตรงกับ AVAILABLE_FRAMES ใน managers/playerManager.js
 */
(function attachPlayerAvatar(global) {
    const FRAME_STYLES = {
        none: 'none',
        bronze: 'linear-gradient(135deg, #cd7f32 0%, #8b4513 100%)',
        silver: 'linear-gradient(135deg, #c0c0c0 0%, #808080 100%)',
        gold: 'linear-gradient(135deg, #ffd700 0%, #ff8c00 100%)',
        diamond: 'linear-gradient(135deg, #b9f2ff 0%, #00bfff 100%)',
        fire: 'linear-gradient(135deg, #ff4500 0%, #ff0000 100%)',
        rainbow: 'linear-gradient(135deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #8b00ff)',
        neon: 'linear-gradient(135deg, #00ff00 0%, #00ffff 50%, #ff00ff 100%)'
    };

    // กรอบที่ควรมีชีวิต — หมุน/เรืองแสง ให้รู้สึกว่าเป็นของหายาก
    const ANIMATED_FRAMES = new Set(['rainbow', 'neon', 'fire']);

    function escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // รูปจาก Google — รับเฉพาะ https://*.googleusercontent.com แล้วบังคับขนาด =s96-c
    // ใช้ทั้งฝั่ง server (ตอนเก็บ/ส่ง payload) และฝั่ง client (ก่อนใส่ลง <img>) เป็นตัวเดียวกัน
    const AVATAR_IMAGE_SIZE_SUFFIX = '=s96-c';
    const AVATAR_IMAGE_MAX_LENGTH = 1024;
    const AVATAR_IMAGE_PATH_RE = /^\/[A-Za-z0-9\-_.~\/=]+$/;

    function normalizeAvatarImageUrl(value) {
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw || raw.length > AVATAR_IMAGE_MAX_LENGTH) return null;
        let url;
        try {
            url = new URL(raw);
        } catch (error) {
            return null;
        }
        if (url.protocol !== 'https:') return null;
        if (url.username || url.password || url.port) return null;
        const host = url.hostname.toLowerCase();
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.googleusercontent\.com$/.test(host)) return null;
        let path = url.pathname;
        if (!AVATAR_IMAGE_PATH_RE.test(path) || path.indexOf('..') !== -1) return null;
        // ตัดตัวเลือกขนาดเดิม (เช่น =s96-c, =s400) ทิ้งแล้วใส่ =s96-c เสมอ
        const lastSlash = path.lastIndexOf('/');
        const eq = path.indexOf('=', lastSlash);
        if (eq !== -1) path = path.slice(0, eq);
        if (path.length <= 1 || path.endsWith('/')) return null;
        return 'https://' + host + path + AVATAR_IMAGE_SIZE_SUFFIX;
    }

    function getFrameStyle(frameId) {
        return FRAME_STYLES[frameId] || 'none';
    }

    function hasFrame(frameId) {
        return getFrameStyle(frameId) !== 'none';
    }

    /**
     * @param {Object} player  { avatar, avatarFrame, color, playerName }
     * @param {Object} options { size: px (default 40), className, title }
     * @returns {string} HTML
     */
    function renderPlayerAvatar(player, options) {
        const p = player || {};
        const o = options || {};
        const size = Number(o.size) || 40;
        const frameId = p.avatarFrame || 'none';
        const frameStyle = getFrameStyle(frameId);
        const color = p.color || '#94a3b8';
        const title = o.title || p.displayName || p.playerName || '';
        const emoji = escapeAttr(p.avatar || '👤');
        // บอทไม่มีรูปจริงเสมอ ต่อให้ payload หลุดมา
        const isBot = p.isBot || String(p.playerId || '').indexOf('bot_') === 0;
        const imageUrl = !isBot && o.image !== false ? normalizeAvatarImageUrl(p.avatarImage) : null;

        const frameLayer = frameStyle !== 'none'
            ? '<span class="pa-frame' + (ANIMATED_FRAMES.has(frameId) ? ' pa-frame-animated' : '') +
              '" style="background:' + escapeAttr(frameStyle) + ';"></span>'
            : '';

        // รูปโหลดไม่ขึ้น (ลิงก์หมดอายุ/ถูกบล็อก) → ลบ <img> ทิ้งแล้วโชว์ emoji เดิม
        const inner = imageUrl
            ? '<img class="pa-img" src="' + escapeAttr(imageUrl) + '" alt="" width="' + size + '" height="' + size + '"' +
              ' loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false"' +
              ' onerror="this.parentNode.classList.remove(\'pa-has-img\');this.remove();">' +
              '<span class="pa-emoji">' + emoji + '</span>'
            : emoji;

        return '<span class="player-avatar ' + escapeAttr(o.className || '') + '"' +
            ' style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.5) + 'px;"' +
            ' data-frame="' + escapeAttr(frameId) + '"' +
            (title ? ' title="' + escapeAttr(title) + '"' : '') + '>' +
                frameLayer +
                '<span class="pa-inner' + (imageUrl ? ' pa-has-img' : '') + '" style="background:' + escapeAttr(color) + '22;border-color:' + escapeAttr(color) + ';">' +
                    inner +
                '</span>' +
            '</span>';
    }

    /**
     * สำหรับที่ที่มีกล่อง avatar ของตัวเองอยู่แล้ว (ไม่ใช้ .player-avatar)
     * คืน <img> + emoji สำรอง ถ้ามีรูป ไม่งั้นคืน emoji ล้วน (escape แล้ว)
     */
    function renderAvatarContent(player, options) {
        const p = player || {};
        const o = options || {};
        const size = Number(o.size) || 40;
        const emoji = o.emojiHtml != null ? String(o.emojiHtml) : escapeAttr(p.avatar || '👤');
        const isBot = p.isBot || String(p.playerId || '').indexOf('bot_') === 0;
        const imageUrl = isBot ? null : normalizeAvatarImageUrl(p.avatarImage);
        if (!imageUrl) return emoji;
        return '<span class="pa-content pa-has-img" style="width:' + size + 'px;height:' + size + 'px;">' +
            '<img class="pa-img" src="' + escapeAttr(imageUrl) + '" alt="" width="' + size + '" height="' + size + '"' +
            ' loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false"' +
            ' onerror="this.parentNode.classList.remove(\'pa-has-img\');this.remove();">' +
            '<span class="pa-emoji">' + emoji + '</span></span>';
    }

    /**
     * ฝั่ง server: ใส่ใน payload สาธารณะด้วย `...PlayerAvatar.avatarImageField(player)`
     * ได้ { avatarImage } เฉพาะคนที่เปิดใช้รูป Google (player.avatarImage มีค่า) และไม่ใช่บอท
     * ไม่งั้นได้ {} — payload ไม่มี key นี้เลย
     */
    function avatarImageField(player) {
        if (!player || !player.avatarImage) return {};
        const playerId = String(player.playerId || player.id || '');
        if (player.isBot || playerId.indexOf('bot_') === 0) return {};
        const url = normalizeAvatarImageUrl(player.avatarImage);
        return url ? { avatarImage: url } : {};
    }

    const api = {
        avatarImageField: avatarImageField,
        FRAME_STYLES: FRAME_STYLES,
        getFrameStyle: getFrameStyle,
        hasFrame: hasFrame,
        normalizeAvatarImageUrl: normalizeAvatarImageUrl,
        render: renderPlayerAvatar,
        renderContent: renderAvatarContent
    };

    // ใช้ไฟล์เดียวกันทั้งเบราว์เซอร์ (window.PlayerAvatar) และ Node (require)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.PlayerAvatar = api;
        global.renderPlayerAvatar = renderPlayerAvatar;
    }
})(typeof window !== 'undefined' ? window : globalThis);
