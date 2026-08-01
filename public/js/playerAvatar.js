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

        const frameLayer = frameStyle !== 'none'
            ? '<span class="pa-frame' + (ANIMATED_FRAMES.has(frameId) ? ' pa-frame-animated' : '') +
              '" style="background:' + escapeAttr(frameStyle) + ';"></span>'
            : '';

        return '<span class="player-avatar ' + escapeAttr(o.className || '') + '"' +
            ' style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.5) + 'px;"' +
            ' data-frame="' + escapeAttr(frameId) + '"' +
            (title ? ' title="' + escapeAttr(title) + '"' : '') + '>' +
                frameLayer +
                '<span class="pa-inner" style="background:' + escapeAttr(color) + '22;border-color:' + escapeAttr(color) + ';">' +
                    escapeAttr(p.avatar || '👤') +
                '</span>' +
            '</span>';
    }

    global.PlayerAvatar = {
        FRAME_STYLES: FRAME_STYLES,
        getFrameStyle: getFrameStyle,
        hasFrame: hasFrame,
        render: renderPlayerAvatar
    };
    global.renderPlayerAvatar = renderPlayerAvatar;
})(typeof window !== 'undefined' ? window : globalThis);
