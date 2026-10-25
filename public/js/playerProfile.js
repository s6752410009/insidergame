/* Shared public profile: the home screen and room lobby must show the same game results. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PlayerProfile = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const MODES = [
        ['insider', '🎯', 'Insider'], ['werewolf', '🐺', 'Werewolf'],
        ['blackmarket', '🎩', 'Black Market'], ['spyfall', '🕵️', 'Spyfall'],
        ['undercover', '🫥', 'คำใครไม่เหมือน'], ['coup', '👑', 'Coup'],
        ['avalon', '🏰', 'อวาลอน'], ['liar', '🃏', 'ไพ่โกหก'],
        ['poker5', '♠', 'ไพ่ 5 ใบ'], ['poker4', '♦', 'สี่ใบเก'],
        ['pokdeng', '🎴', 'ป๊อกเด้ง'], ['codenames', '🕵️', 'สายลับคำใบ้'],
        ['wavelength', '📡', 'คลื่นความคิด'], ['drawguess', '🎨', 'วาดแล้วทาย'],
        ['colorcards', '🃏', 'ไพ่ทิ้งสี'], ['setthi', '💰', 'เศรษฐี'],
        ['slave', '♠', 'สลาฟ']
    ].map(([id, icon, label]) => ({ id, icon, label }));
    const ROLE_GROUPS = [
        { id: 'insider', rows: [['gameMasterCount', '👑 ผู้ดำเนินเกม', null], ['traitorCount', '😈 จอมบงการ', 'winAsTraitor'], ['citizenCount', '👤 พลเมือง', 'winAsCitizen']] },
        { id: 'werewolf', rows: [['werewolf', '🐺 หมาป่า'], ['seer', '🔮 ผู้หยั่งรู้'], ['doctor', '💊 หมอ'], ['villager', '👤 ชาวบ้าน']] },
        { id: 'blackmarket', rows: [['boss', '🎩 เจ้าพ่อ'], ['broker', '🕴️ นายหน้า'], ['smuggler', '🚚 คนส่งของ'], ['fixer', '🧹 คนเคลียร์ทาง'], ['hitman', '🔫 มือเก็บงาน'], ['mole', '🕶️ สายข่าว'], ['doubleAgent', '🃏 สองหน้า']] }
    ];
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
    const modeMeta = id => MODES.find(mode => mode.id === (id || 'insider')) || { id: 'other', icon: '🎮', label: 'เกมอื่น' };
    function date(value, withTime) {
        const parsed = new Date(value);
        if (!value || !Number.isFinite(parsed.getTime())) return '—';
        return parsed.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
    }
    function historyDetail(game) {
        const mode = game.mode || 'insider';
        if (mode === 'slave') return game.resultText || [game.round ? 'รอบ ' + count(game.round) : '', game.place ? 'อันดับ ' + count(game.place) + '/4' : '', game.title || game.role || ''].filter(Boolean).join(' · ');
        if (game.resultText) return game.resultText;
        if (mode === 'werewolf') return 'ทีมชนะ: ' + (game.winnerLabel || (game.winner === 'werewolf' ? 'หมาป่า' : 'ชาวบ้าน'));
        if (mode === 'blackmarket') return 'เจ้าโต๊ะ: ' + (game.winnerLabel || '—');
        if (mode === 'spyfall') return [game.location ? 'สถานที่: ' + game.location : '', game.citizensWon ? 'พลเมืองชนะ' : 'สายลับรอด'].filter(Boolean).join(' · ');
        if (mode === 'undercover') return [game.civilianWord, game.undercoverWord].filter(Boolean).join(' / ');
        if (mode === 'insider') return [game.word ? 'คำ: ' + game.word : '', game.traitor ? 'จอมบงการ: ' + game.traitor : ''].filter(Boolean).join(' · ');
        return game.winnerName ? 'ผู้ชนะ: ' + game.winnerName : '';
    }
    function render(data, avatarHtml) {
        data = data || {};
        const stats = data.stats || {};
        const total = count(stats.totalGames), wins = count(stats.wins);
        const played = MODES.map(mode => { const row = (stats.modeStats || {})[mode.id] || {}; return { ...mode, games: count(row.games), wins: count(row.wins) }; }).filter(mode => count(mode.games) > 0).sort((a, b) => count(b.games) - count(a.games));
        const modesHtml = played.length ? played.map(mode => {
            const games = count(mode.games), modeWins = count(mode.wins);
            return `<div class="pp-mode" data-profile-mode="${mode.id}"><span>${mode.icon} ${mode.label}</span><span>${games} ${mode.id === 'slave' ? 'รอบ · คิง' : 'เกม · ชนะ'} ${modeWins}<small>${Math.round(modeWins / games * 100)}%</small></span></div>`;
        }).join('') : '<p class="pp-empty">ยังไม่มีเกมที่เล่นจบ</p>';
        const roleHtml = ROLE_GROUPS.map(group => {
            const counts = group.id === 'insider' ? (stats.roleStats || {}) : ((stats.roleStats || {})[group.id] || {});
            const roleWins = group.id === 'insider' ? (stats.winByRole || {}) : ((stats.winByRole || {})[group.id] || {});
            const rows = group.rows.filter(([id]) => count(counts[id]) > 0).map(([id, label, winKey]) => `<div class="pp-mode"><span>${label}</span><span>${count(counts[id])} ครั้ง${winKey === null ? '' : ' · ชนะ ' + count(roleWins[winKey || id])}</span></div>`).join('');
            return rows ? `<details class="pp-roles"><summary>บทบาท ${modeMeta(group.id).label}</summary>${rows}</details>` : '';
        }).join('');
        const history = (Array.isArray(stats.gameHistory) ? stats.gameHistory : []).slice(0, 5);
        const historyHtml = history.length ? history.map(game => {
            const meta = modeMeta(game.mode);
            const placed = game.mode === 'slave' && count(game.place) >= 1 && count(game.place) <= 4;
            const outcome = placed ? 'อันดับ ' + count(game.place) + '/4' : (game.won ? 'ชนะ' : 'แพ้');
            return `<li class="pp-game"><div class="pp-game-top"><strong>${meta.icon} ${meta.label}</strong><span class="pp-outcome${game.won ? ' is-win' : placed ? ' is-place' : ''}">${outcome}</span></div><p>${escape(historyDetail(game))}${game.mode !== 'slave' && game.role ? ' · ' + escape(game.role) : ''}</p><div class="pp-game-meta"><span>${escape(game.roomName || 'ห้องเกม')} · ${count(game.playerCount)} คน</span><time>${date(game.date, true)}</time></div></li>`;
        }).join('') : '<li class="pp-empty">ยังไม่มีประวัติให้ดู</li>';
        const color = /^#[\da-f]{6}$/i.test(data.color || '') ? data.color : '#f5c86b';
        return `<div class="pp-public"><div class="pp-header"><div class="pp-avatar">${avatarHtml || escape(data.avatar || '👤')}</div><div><h2 style="color:${color}">${escape(data.playerName || 'ผู้เล่น')}</h2><p>เข้าร่วม ${date(data.createdAt)}<br>เล่นล่าสุด ${stats.lastPlayedAt ? date(stats.lastPlayedAt) : 'ยังไม่เคยเล่น'}</p></div></div><div class="pp-totals"><div><b>${total}</b><span>เกม / รอบที่จบ</span></div><div><b>${wins}</b><span>ชนะ</span></div><div><b>${total ? Math.round(wins / total * 100) : 0}%</b><span>อัตราชนะ</span></div></div><section><h3>เกมที่เล่น</h3>${modesHtml}${played.some(mode => mode.id === 'slave') ? '<p class="pp-note">สลาฟนับสถิติโต๊ะคนเล่น 4 คนเมื่อจบรอบ · อันดับ 1 (คิง) นับเป็นชนะ</p>' : ''}</section>${roleHtml}<section><h3>5 เกม / รอบล่าสุด</h3><ol class="pp-history">${historyHtml}</ol></section></div>`;
    }
    function show(targetPlayerId) {
        const jq = window.jQuery || window.$;
        jq.get('/api/player/' + encodeURIComponent(targetPlayerId) + '/profile', data => {
            const avatarHtml = window.PlayerAvatar ? window.PlayerAvatar.render(data, { size: 64 }) : '';
            window.Swal.fire({ title: '', html: render(data, avatarHtml), background: '#182529', color: '#fff', showConfirmButton: true, confirmButtonText: 'ปิด', confirmButtonColor: '#bc493e', width: 620, customClass: { popup: 'pp-popup' } });
        }).fail(() => window.Swal.fire({ icon: 'error', title: 'ไม่พบข้อมูล', text: 'ไม่สามารถโหลดโปรไฟล์ได้', background: '#182529', color: '#fff', confirmButtonColor: '#bc493e' }));
    }
    return { MODES, render, show };
}));
