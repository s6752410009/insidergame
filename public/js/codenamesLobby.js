/* สายลับคำใบ้ — แผงเลือกทีม/บทในห้องรอ (roomLobby.ejs เรียก html() / blockReason())
 * ข้อมูลทีมอยู่ใน roomUpdate.settings.codenamesTeams (สาธารณะ) · เซิร์ฟเวอร์ตรวจซ้ำทุกครั้งตอนกดเริ่ม */
(function attachCodenamesLobby(global) {
    var TEAM = { red: 'ทีมแดง', blue: 'ทีมน้ำเงิน' };
    var MIN_PLAYERS = 2;          // โหมดร่วมมือ (ทีมเดียว)
    var MIN_VERSUS_PLAYERS = 4;   // แข่งสองทีม
    var MAX_PLAYERS = 12;
    var CLUE_OPTIONS = [[0, 'ปิด'], [90, '90 วิ'], [120, '120 วิ']];
    var GUESS_OPTIONS = [[0, 'ปิด'], [60, '60 วิ'], [90, '90 วิ'], [120, '120 วิ']];
    var FLAG_OPTIONS = [[1, 'เปิด'], [0, 'ปิด']];
    var ctx = { socket: null, playerId: null, isAdmin: function() { return false; } };
    var busy = false;
    var latestPayload = null;

    function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function(ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function injectCss() {
        if (document.getElementById('cnLobbyStyle')) return;
        var style = document.createElement('style');
        style.id = 'cnLobbyStyle';
        style.textContent = [
            '.cnl{--cnl-red:oklch(0.64 0.19 28);--cnl-red-bg:oklch(0.32 0.1 28 / 0.55);--cnl-blue:oklch(0.68 0.15 250);--cnl-blue-bg:oklch(0.3 0.09 255 / 0.6);--cnl-gold:#f5c86b;--cnl-ink:#f1f0fa;--cnl-muted:#a9b3c4;margin-top:10px;font-family:"Bai Jamjuree",sans-serif;color:var(--cnl-ink)}',
            '.cnl-teams{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
            '.cnl-team{min-width:0;padding:10px;border-radius:14px;border:1px solid oklch(1 0 0 / 0.1)}',
            '.cnl-team.is-red{background:var(--cnl-red-bg);border-color:oklch(0.64 0.19 28 / 0.5)}',
            '.cnl-team.is-blue{background:var(--cnl-blue-bg);border-color:oklch(0.68 0.15 250 / 0.5)}',
            '.cnl-team.is-mine{box-shadow:0 0 0 2px var(--cnl-gold)}',
            '.cnl-team-name{font-family:"Chakra Petch",sans-serif;font-weight:700;font-size:1rem;display:flex;align-items:center;gap:6px}',
            '.cnl-team.is-red .cnl-team-name{color:oklch(0.82 0.1 28)}.cnl-team.is-blue .cnl-team-name{color:oklch(0.85 0.08 250)}',
            '.cnl-count{margin-left:auto;font-size:0.78rem;color:var(--cnl-muted);font-weight:600}',
            '.cnl-label{margin:8px 0 3px;font-size:0.72rem;color:var(--cnl-muted);letter-spacing:0.04em}',
            '.cnl-name{display:flex;align-items:center;gap:5px;min-width:0;font-size:0.88rem;font-weight:600;line-height:1.3}',
            '.cnl-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.cnl-name.is-off{opacity:0.5}.cnl-name.is-me span{color:var(--cnl-gold)}',
            '.cnl-empty{font-size:0.84rem;color:var(--cnl-muted);font-style:normal}',
            '.cnl-ops{display:grid;gap:2px}',
            '.cnl-actions{display:grid;grid-template-columns:1fr;gap:6px;margin-top:10px}',
            '.cnl-btn{min-height:44px;padding:6px 10px;border-radius:12px;border:1px solid oklch(1 0 0 / 0.16);background:oklch(0.22 0.03 255);color:var(--cnl-ink);font:inherit;font-size:0.86rem;font-weight:700;cursor:pointer;line-height:1.2}',
            '.cnl-btn:hover{background:oklch(0.27 0.035 255)}',
            '.cnl-btn:disabled{opacity:0.45;cursor:not-allowed}',
            '.cnl-btn.is-on,.cnl-btn.is-on:disabled{background:var(--cnl-gold);color:#1a2332;border-color:transparent;opacity:1;cursor:default}',
            '.cnl-btn:focus-visible{outline:2px solid var(--cnl-gold);outline-offset:2px}',
            '.cnl-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}',
            '.cnl-row .cnl-btn{flex:1 1 140px}',
            '.cnl-others{margin-top:8px;font-size:0.82rem;color:var(--cnl-muted);overflow-wrap:anywhere}',
            '.cnl-timers{margin-top:10px;display:grid;gap:6px}',
            '.cnl-timer{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
            '.cnl-timer-label{font-size:0.82rem;color:var(--cnl-muted);min-width:64px}',
            '.cnl-seg{display:flex;gap:4px;flex:1 1 auto}',
            '.cnl-seg .cnl-btn{flex:1 1 0;min-width:0;padding:6px 4px;font-size:0.8rem}',
            '.cnl-note,.cnl-tip{margin:0;font-size:0.78rem;color:var(--cnl-muted)}',
            '.cnl-status{margin:10px 0 0;padding:8px 10px;border-radius:10px;font-size:0.86rem;font-weight:600;line-height:1.4}',
            '.cnl-status.is-bad{background:oklch(0.3 0.08 60 / 0.45);color:#fde68a}',
            '.cnl-status.is-ok{background:oklch(0.32 0.08 150 / 0.45);color:#bbf7d0}',
            '@media (max-width:360px){.cnl-teams{gap:6px}.cnl-team{padding:8px}}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function members(payload) {
        var picks = (payload && payload.settings && payload.settings.codenamesTeams) || {};
        return ((payload && payload.players) || [])
            .filter(function(p) { return String(p.playerId).indexOf('bot_') !== 0; })
            .map(function(p) {
                var pick = picks[p.playerId] || null;
                var team = pick && (pick.team === 'red' || pick.team === 'blue') ? pick.team : null;
                var role = pick ? (pick.role === 'spectator' ? 'spectator' : (team ? (pick.role === 'spymaster' ? 'spymaster' : 'operative') : null)) : null;
                return { playerId: p.playerId, name: p.displayName || p.playerName || 'ผู้เล่น', online: p.online !== false, team: team, role: role };
            });
    }

    // เหมือน engine.getStartBlockReason ทุกข้อ — เซิร์ฟเวอร์ตรวจซ้ำอีกรอบ
    function blockReason(payload) {
        var online = members(payload).filter(function(m) { return m.online; });
        if (online.length < MIN_PLAYERS) return 'ต้องมีผู้เล่นออนไลน์อย่างน้อย ' + MIN_PLAYERS + ' คน';
        var unassigned = online.filter(function(m) { return !m.role; });
        if (unassigned.length) {
            return 'ยังไม่ได้เลือกทีม: ' + unassigned.slice(0, 3).map(function(m) { return m.name; }).join(', ') +
                (unassigned.length > 3 ? ' และอีก ' + (unassigned.length - 3) + ' คน' : '') +
                (ctx.isAdmin() ? ' — เลือกทีมเอง หรือกด "สุ่มทีม"' : ' — เลือกทีมเอง หรือรอหัวหน้าห้องกด "สุ่มทีม"');
        }
        var players = online.filter(function(m) { return m.team; });
        if (players.length > MAX_PLAYERS) return 'เล่นได้สูงสุด ' + MAX_PLAYERS + ' คน ให้บางคนเป็นผู้ชม';
        if (players.length < MIN_PLAYERS) return 'ต้องมีคนเล่นอย่างน้อย ' + MIN_PLAYERS + ' คน (หัวหน้า 1 + ลูกทีม 1)';
        var coop = coopTeam(players);
        if (!coop && players.length < MIN_VERSUS_PLAYERS) return 'แข่งสองทีมต้องมี ' + MIN_VERSUS_PLAYERS + ' คนขึ้นไป — ' + players.length + ' คนให้อยู่ทีมเดียวกัน (โหมดร่วมมือ)';
        var teams = coop ? [coop] : ['red', 'blue'];
        for (var i = 0; i < teams.length; i += 1) {
            var inTeam = players.filter(function(m) { return m.team === teams[i]; });
            var masters = inTeam.filter(function(m) { return m.role === 'spymaster'; });
            var ops = inTeam.filter(function(m) { return m.role === 'operative'; });
            if (!masters.length) return TEAM[teams[i]] + 'ยังไม่มีหัวหน้า';
            if (masters.length > 1) return TEAM[teams[i]] + 'มีหัวหน้าได้คนเดียว';
            if (!ops.length) return TEAM[teams[i]] + 'ต้องมีลูกทีมอย่างน้อย 1 คน';
        }
        return null;
    }

    // ทีมเดียวที่มีคน = โหมดร่วมมือ (เหมือน engine.coopTeamOf)
    function coopTeam(players) {
        var used = ['red', 'blue'].filter(function(team) { return players.some(function(m) { return m.team === team; }); });
        return used.length === 1 ? used[0] : null;
    }

    function nameRow(m, extra) {
        var me = m.playerId === ctx.playerId;
        return '<div class="cnl-name' + (m.online ? '' : ' is-off') + (me ? ' is-me' : '') + '">' + (extra || '') +
            '<span>' + esc(m.name) + (me ? ' (คุณ)' : '') + (m.online ? '' : ' · หลุด') + '</span></div>';
    }

    function teamHtml(team, list, me) {
        var inTeam = list.filter(function(m) { return m.team === team; });
        var master = inTeam.filter(function(m) { return m.role === 'spymaster'; })[0] || null;
        var ops = inTeam.filter(function(m) { return m.role === 'operative'; });
        var mine = me && me.team === team;
        var masterTaken = master && master.playerId !== ctx.playerId && master.online;
        var amMaster = mine && me.role === 'spymaster';
        var amOp = mine && me.role === 'operative';
        return '<div class="cnl-team is-' + team + (mine ? ' is-mine' : '') + '">' +
            '<div class="cnl-team-name">' + (team === 'red' ? '🟥' : '🟦') + ' ' + TEAM[team] + '<span class="cnl-count">' + inTeam.length + ' คน</span></div>' +
            '<div class="cnl-label">หัวหน้า (เห็นกุญแจ)</div>' +
            (master ? nameRow(master, '🕵️') : '<div class="cnl-empty">ยังว่าง</div>') +
            '<div class="cnl-label">ลูกทีม</div>' +
            '<div class="cnl-ops">' + (ops.length ? ops.map(function(m) { return nameRow(m); }).join('') : '<div class="cnl-empty">ยังไม่มี</div>') + '</div>' +
            '<div class="cnl-actions">' +
            '<button type="button" class="cnl-btn' + (amMaster ? ' is-on' : '') + '" data-cn-pick="' + team + '" data-cn-role="spymaster"' + (masterTaken || amMaster ? ' disabled' : '') + '>' + (amMaster ? '✓ คุณเป็นหัวหน้า' : (masterTaken ? 'มีหัวหน้าแล้ว' : 'เป็นหัวหน้า')) + '</button>' +
            '<button type="button" class="cnl-btn' + (amOp ? ' is-on' : '') + '" data-cn-pick="' + team + '" data-cn-role="operative"' + (amOp ? ' disabled' : '') + '>' + (amOp ? '✓ อยู่ทีมนี้' : 'เข้า' + TEAM[team]) + '</button>' +
            '</div></div>';
    }

    function segHtml(key, options, current, admin) {
        return '<div class="cnl-seg" role="group">' + options.map(function(opt) {
            var on = Number(current) === opt[0];
            return '<button type="button" class="cnl-btn' + (on ? ' is-on' : '') + '" data-cn-timer="' + key + '" data-cn-value="' + opt[0] + '" aria-pressed="' + on + '"' + (admin ? '' : ' disabled') + '>' + opt[1] + '</button>';
        }).join('') + '</div>';
    }

    function html(payload) {
        latestPayload = payload;
        injectCss();
        var list = members(payload);
        var me = list.filter(function(m) { return m.playerId === ctx.playerId; })[0] || null;
        var admin = ctx.isAdmin();
        var settings = (payload && payload.settings) || {};
        var clue = settings.codenamesClueSeconds === undefined ? 120 : settings.codenamesClueSeconds;
        var guess = settings.codenamesGuessSeconds === undefined ? 0 : settings.codenamesGuessSeconds;
        var flag = settings.codenamesClueFlag === false ? 0 : 1;
        var coop = coopTeam(list.filter(function(m) { return m.online && m.team; }));
        var spectators = list.filter(function(m) { return m.role === 'spectator'; });
        var unassigned = list.filter(function(m) { return !m.role; });
        var reason = blockReason(payload);
        var okText = coop
            ? '🤝 โหมดร่วมมือ — ' + TEAM[coop] + 'เล่นทีมเดียว พร้อมเริ่มแล้ว (ไม่นับสถิติ)'
            : 'ทีมพร้อมแล้ว — หัวหน้าห้องกดเริ่มได้เลย';
        return [
            '<div class="lobby-spotlight-pill" style="background:rgba(245,200,107,0.16); color:#fde68a;">🕵️ สายลับคำใบ้ · 4–12 คน 2 ทีม · 2–3 คนเล่นทีมเดียว</div>',
            '<p style="margin:8px 0 0; color:#cbd5e1; font-size:0.88em; line-height:1.45;">หัวหน้าเห็นว่าคำไหนเป็นสายลับทีมตัวเอง ใบ้คำเดียว + ตัวเลข ลูกทีมช่วยกันเปิด — ระวังมือสังหาร</p>',
            '<div class="cnl">',
            '<div class="cnl-teams">', teamHtml('red', list, me), teamHtml('blue', list, me), '</div>',
            '<div class="cnl-row">',
            '<button type="button" class="cnl-btn' + (me && me.role === 'spectator' ? ' is-on' : '') + '" data-cn-pick="" data-cn-role="spectator"' + (me && me.role === 'spectator' ? ' disabled' : '') + '>' + (me && me.role === 'spectator' ? '✓ คุณเป็นผู้ชม' : '👀 ดูอย่างเดียว') + '</button>',
            admin ? '<button type="button" class="cnl-btn" data-cn-shuffle="1">🎲 สุ่มทีม</button>' : '',
            '</div>',
            (unassigned.length || spectators.length) ? '<div class="cnl-others">' +
                (unassigned.length ? 'ยังไม่เลือก: ' + unassigned.map(function(m) { return esc(m.name); }).join(', ') : '') +
                (unassigned.length && spectators.length ? ' · ' : '') +
                (spectators.length ? 'ผู้ชม: ' + spectators.map(function(m) { return esc(m.name); }).join(', ') : '') + '</div>' : '',
            '<div class="cnl-timers">',
            '<div class="cnl-timer"><span class="cnl-timer-label">เวลาใบ้</span>' + segHtml('codenamesClueSeconds', CLUE_OPTIONS, clue, admin) + '</div>',
            '<div class="cnl-timer"><span class="cnl-timer-label">เวลาทาย</span>' + segHtml('codenamesGuessSeconds', GUESS_OPTIONS, guess, admin) + '</div>',
            '<div class="cnl-timer"><span class="cnl-timer-label">🚩 ทักคำใบ้</span>' + segHtml('codenamesClueFlag', FLAG_OPTIONS, flag, admin) + '</div>',
            '<p class="cnl-tip">ทักคำใบ้ = หัวหน้าอีกทีมกดได้ทีมละ 1 ครั้ง ถ้าคำใบ้ผิดกติกา</p>',
            admin ? '' : '<p class="cnl-note">หัวหน้าห้องเป็นคนตั้งเวลา</p>',
            '</div>',
            '<p class="cnl-status ' + (reason ? 'is-bad' : 'is-ok') + '" role="status">' + esc(reason || okText) + '</p>',
            '</div>'
        ].join('');
    }

    function toastError(message) {
        if (global.Swal) {
            global.Swal.fire({ toast: true, position: 'top', icon: 'error', title: message || 'ทำรายการไม่สำเร็จ', showConfirmButton: false, timer: 2400, background: '#1e1e1e', color: '#fff' });
        }
    }

    function emit(eventName, payload) {
        if (busy || !ctx.socket) return;
        busy = true;
        ctx.socket.emit(eventName, payload, function(res) {
            busy = false;
            if (res && res.success === false) toastError(res.error);
        });
        setTimeout(function() { busy = false; }, 4000);
    }

    function init(options) {
        ctx.socket = options.socket;
        ctx.playerId = options.playerId;
        ctx.isAdmin = typeof options.isAdmin === 'function' ? options.isAdmin : function() { return !!options.isAdmin; };
        document.addEventListener('click', function(event) {
            var pick = event.target.closest('[data-cn-pick]');
            if (pick && !pick.disabled) {
                emit('codenames_pickTeam', { team: pick.getAttribute('data-cn-pick') || null, role: pick.getAttribute('data-cn-role') });
                return;
            }
            if (event.target.closest('[data-cn-shuffle]')) {
                // มีคนเลือกทีมไว้แล้ว = สุ่มใหม่จะล้างที่เลือก → ถามก่อน (กันกดพลาด)
                var picked = members(latestPayload).filter(function(m) { return m.team; }).length;
                if (picked && global.Swal) {
                    global.Swal.fire({ title: 'สุ่มทีมใหม่?', text: 'ทีมและหัวหน้าที่เลือกไว้ ' + picked + ' คนจะถูกสุ่มใหม่ (ผู้ชมยังเป็นผู้ชม)', showCancelButton: true, confirmButtonText: '🎲 สุ่มเลย', cancelButtonText: 'ยกเลิก', background: '#1e1e1e', color: '#fff', confirmButtonColor: '#d9443c' })
                        .then(function(r) { if (r.isConfirmed) emit('codenames_shuffleTeams', {}); });
                    return;
                }
                emit('codenames_shuffleTeams', {});
                return;
            }
            var timer = event.target.closest('[data-cn-timer]');
            if (timer && !timer.disabled) {
                var update = {};
                var key = timer.getAttribute('data-cn-timer');
                var value = Number(timer.getAttribute('data-cn-value'));
                update[key] = key === 'codenamesClueFlag' ? value === 1 : value;
                emit('updateRoom', update);
            }
        });
    }

    global.codenamesLobby = { init: init, html: html, blockReason: blockReason, members: members };
})(typeof window !== 'undefined' ? window : globalThis);
