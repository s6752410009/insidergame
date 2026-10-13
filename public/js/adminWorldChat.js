/* หลังบ้าน → แท็บ "💬 แชทโลก" (โหลดเมื่อเปิดแท็บเท่านั้น)
 *   ข้อความล่าสุด 200 (รวมที่ถูกซ่อน) · ลบ / ซ่อน / คืน · ห้ามพิมพ์ 10 นาที / 1 วัน · แบน (ระบบเดิม) · ลบทั้งหมดของคนนั้น
 *   คนที่ถูกห้ามพิมพ์ · รายการคำต้องห้าม / คำที่อนุญาต · ทดสอบข้อความ · จำนวนรายงานก่อนซ่อนอัตโนมัติ
 * ทุกค่าจากผู้เล่น escape ก่อนใส่ HTML
 */
(function () {
    'use strict';

    var state = { data: null, filter: 'all', q: '', loading: false, loaded: false, refreshTimer: null };

    function socket() { return window.appSocket; }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function root() { return document.getElementById('awcRoot'); }

    function fmt(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        try {
            return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
        } catch (e) { return d.toISOString(); }
    }

    function toast(text, icon) {
        if (window.Swal) {
            window.Swal.fire({ toast: true, position: 'top-end', icon: icon || 'success', title: text, timer: 2200, showConfirmButton: false, background: '#1e1e1e', color: '#fff' });
        }
    }

    function call(event, payload) {
        return new Promise(function (resolve) {
            var s = socket();
            if (!s) return resolve({ success: false, error: 'ไม่มีการเชื่อมต่อ' });
            s.emit(event, payload || {}, function (response) { resolve(response || { success: false, error: 'ไม่มีคำตอบ' }); });
        });
    }

    function accept(response) {
        if (!response || !response.success) {
            toast((response && response.error) || 'ทำไม่สำเร็จ', 'error');
            return false;
        }
        if (response.messages) {
            state.data = response;
            render();
        }
        return true;
    }

    // ---------- วาด ----------
    function visibleMessages() {
        var list = (state.data && state.data.messages) || [];
        var q = state.q.trim().toLowerCase();
        return list.filter(function (m) {
            if (state.filter === 'reported' && !(m.reports > 0)) return false;
            if (state.filter === 'hidden' && !m.hidden) return false;
            if (q) {
                var hay = [m.playerName, m.playerId, m.text, m.invite && m.invite.roomName].join(' ').toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    function messageRow(m) {
        var body = m.kind === 'invite'
            ? '📣 ชวนเล่น ' + esc((m.invite && m.invite.emoji) || '') + ' ' + esc(m.invite && m.invite.gameLabel) + ' · ห้อง ' + esc(m.invite && m.invite.roomName) + ' (' + esc(m.invite && m.invite.roomId) + ')'
            : esc(m.text);
        var badges = '';
        if (m.hidden) badges += '<span class="awc-tag is-hidden">' + (m.hiddenReason === 'admin' ? '🙈 แอดมินซ่อน' : '🙈 ซ่อนอัตโนมัติ') + '</span>';
        if (m.reports > 0) badges += '<span class="awc-tag is-report" title="' + esc((m.reporters || []).join(', ')) + '">🚩 ' + m.reports + ' รายงาน</span>';
        if (m.muted) badges += '<span class="awc-tag is-muted">🔇 ห้ามพิมพ์อยู่</span>';
        return '<li class="awc-msg' + (m.hidden ? ' is-hidden' : '') + '" data-id="' + esc(m.id) + '" data-player="' + esc(m.playerId) + '">' +
            '<div class="awc-msg-head">' +
                '<strong class="awc-name" style="color:' + (/^#[0-9a-f]{3,8}$/i.test(m.color || '') ? m.color : '#ddd') + '">' + esc(m.playerName) + '</strong>' +
                '<span class="awc-time">' + esc(fmt(m.createdAt)) + '</span>' + badges +
            '</div>' +
            '<p class="awc-text">' + body + '</p>' +
            (m.reports > 0 && m.reporters && m.reporters.length ? '<p class="awc-reporters">รายงานโดย: ' + esc(m.reporters.join(', ')) + '</p>' : '') +
            '<div class="awc-actions">' +
                (m.hidden
                    ? '<button type="button" class="btn-admin btn-success" data-act="restore">↩️ คืน</button>'
                    : '<button type="button" class="btn-admin btn-warning" data-act="hide">🙈 ซ่อน</button>') +
                '<button type="button" class="btn-admin btn-danger" data-act="delete">🗑️ ลบ</button>' +
                '<button type="button" class="btn-admin btn-warning" data-act="mute" data-min="10">🔇 10 นาที</button>' +
                '<button type="button" class="btn-admin btn-warning" data-act="mute" data-min="1440">🔇 1 วัน</button>' +
                '<button type="button" class="btn-admin btn-danger" data-act="ban">🚫 แบน</button>' +
                '<button type="button" class="btn-admin btn-danger" data-act="purge" title="ลบทุกข้อความของคนนี้">🧹 ลบทั้งหมดของคนนี้</button>' +
            '</div>' +
        '</li>';
    }

    function wordChips(list, kind) {
        return list.map(function (w) {
            var cls = 'awc-chip' + (w.builtin ? ' is-builtin' : '') + (w.enabled ? '' : ' is-off');
            var label = esc(w.word) + (w.exact ? ' <small>(ตรงวรรณยุกต์)</small>' : '');
            var btn = w.enabled
                ? '<button type="button" data-word-op="remove" data-list="' + kind + '" data-word="' + esc(w.word) + '" aria-label="เอาออก ' + esc(w.word) + '">✕</button>'
                : '<button type="button" data-word-op="add" data-list="' + kind + '" data-word="' + esc(w.word) + '" aria-label="เปิดกลับ ' + esc(w.word) + '">↩︎</button>';
            return '<span class="' + cls + '" title="' + (w.builtin ? 'คำตั้งต้น' : 'แอดมินเพิ่ม') + '">' + label + btn + '</span>';
        }).join('');
    }

    function render() {
        var el = root();
        if (!el || !state.data) return;
        var d = state.data;
        var rows = visibleMessages();
        var mutes = d.mutes || [];
        var counts = d.counts || {};
        var words = d.words || { block: [], allow: [] };
        var body = el.querySelector('.awc-body');
        if (!body) {
            body = document.createElement('div');
            body.className = 'awc-body';
            el.appendChild(body);
        }
        var loading = el.querySelector('.awc-loading');
        if (loading) loading.remove();

        body.innerHTML =
            '<div class="awc-summary">' +
                '<span>ข้อความ <b>' + (counts.total || 0) + '</b>/' + (d.limit || 200) + '</span>' +
                '<span>🚩 ถูกรายงาน <b>' + (counts.reported || 0) + '</b></span>' +
                '<span>🙈 ซ่อนอยู่ <b>' + (counts.hidden || 0) + '</b></span>' +
                '<label class="awc-threshold">ซ่อนอัตโนมัติเมื่อรายงานครบ <input type="number" min="1" max="20" id="awcThreshold" value="' + esc(words.reportThreshold) + '"> คน ' +
                '<button type="button" class="btn-admin btn-refresh" id="awcThresholdSave">บันทึก</button></label>' +
            '</div>' +
            '<div class="awc-grid">' +
                '<section class="awc-col" aria-label="ข้อความ">' +
                    '<div class="awc-filters" role="group" aria-label="กรองข้อความ">' +
                        ['all:ทั้งหมด', 'reported:🚩 ถูกรายงาน', 'hidden:🙈 ซ่อนอยู่'].map(function (pair) {
                            var parts = pair.split(':');
                            return '<button type="button" class="awc-filter' + (state.filter === parts[0] ? ' is-active' : '') + '" data-filter="' + parts[0] + '" aria-pressed="' + (state.filter === parts[0]) + '">' + parts[1] + '</button>';
                        }).join('') +
                        '<input type="search" class="search-box awc-search" id="awcSearch" placeholder="ค้นหาชื่อ / ข้อความ" value="' + esc(state.q) + '">' +
                    '</div>' +
                    (rows.length
                        ? '<ol class="awc-list" id="awcList">' + rows.map(messageRow).join('') + '</ol>'
                        : '<div class="empty-message">ไม่มีข้อความ</div>') +
                '</section>' +
                '<aside class="awc-col awc-side">' +
                    '<h3>🔇 ห้ามพิมพ์อยู่ (' + mutes.length + ')</h3>' +
                    (mutes.length
                        ? '<ul class="awc-mutes">' + mutes.map(function (m) {
                            return '<li data-player="' + esc(m.playerId) + '"><span><b>' + esc(m.playerName || m.playerId) + '</b><br><small>ถึง ' + esc(fmt(m.until)) + '</small></span>' +
                                '<button type="button" class="btn-admin btn-success" data-act="unmute">ปลด</button></li>';
                        }).join('') + '</ul>'
                        : '<p class="awc-note">ไม่มี</p>') +
                    '<h3>⛔ คำต้องห้าม</h3>' +
                    '<p class="awc-note">ระบบจับคำที่เว้นวรรค/จุด/ตัวซ้ำ/วรรณยุกต์ผิดให้เอง ใส่ <code>=</code> หน้าคำ ถ้าต้องตรงวรรณยุกต์ (เช่น <code>=ห่า</code>)</p>' +
                    '<div class="awc-chips" id="awcBlock">' + wordChips(words.block, 'block') + '</div>' +
                    '<form class="awc-add" data-list="block"><input type="text" class="search-box" maxlength="40" placeholder="เพิ่มคำต้องห้าม" aria-label="เพิ่มคำต้องห้าม"><button type="submit" class="btn-admin btn-danger">เพิ่ม</button></form>' +
                    '<h3>✅ คำที่อนุญาต</h3>' +
                    '<p class="awc-note">คำปกติที่มีคำต้องห้ามซ้อนอยู่ เช่น หีบ ห่าง แม่งาน</p>' +
                    '<div class="awc-chips" id="awcAllow">' + wordChips(words.allow, 'allow') + '</div>' +
                    '<form class="awc-add" data-list="allow"><input type="text" class="search-box" maxlength="40" placeholder="เพิ่มคำที่อนุญาต" aria-label="เพิ่มคำที่อนุญาต"><button type="submit" class="btn-admin btn-success">เพิ่ม</button></form>' +
                    '<h3>🧪 ทดสอบข้อความ</h3>' +
                    '<form class="awc-test" id="awcTest"><input type="text" class="search-box" maxlength="200" placeholder="พิมพ์ข้อความลองดู" aria-label="ข้อความทดสอบ"><button type="submit" class="btn-admin btn-refresh">ทดสอบ</button></form>' +
                    '<p class="awc-test-result" id="awcTestResult" role="status"></p>' +
                '</aside>' +
            '</div>';
    }

    // ---------- โหลด ----------
    function load() {
        var el = root();
        if (!el || state.loading) return;
        state.loading = true;
        if (!state.loaded && !el.querySelector('.awc-loading')) {
            var loading = document.createElement('div');
            loading.className = 'empty-message awc-loading';
            loading.textContent = 'กำลังโหลด…';
            el.appendChild(loading);
        }
        call('admin_worldChatGet', {}).then(function (response) {
            state.loading = false;
            if (!response.success) {
                toast(response.error || 'โหลดไม่สำเร็จ', 'error');
                return;
            }
            state.loaded = true;
            state.data = response;
            render();
        });
    }

    function isActive() {
        var tab = document.getElementById('tab-worldchat');
        return Boolean(tab && tab.classList.contains('active'));
    }

    function onUpdate() {
        if (!isActive()) return;
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(load, 600);
    }

    // ---------- คำสั่ง ----------
    function playerName(playerId) {
        var m = ((state.data && state.data.messages) || []).find(function (x) { return x.playerId === playerId; });
        var mute = ((state.data && state.data.mutes) || []).find(function (x) { return x.playerId === playerId; });
        return (m && m.playerName) || (mute && mute.playerName) || playerId;
    }

    function confirmThen(title, text, run) {
        if (!window.Swal) { if (window.confirm(title)) run(); return; }
        window.Swal.fire({ title: title, text: text || '', icon: 'warning', showCancelButton: true, confirmButtonText: 'ยืนยัน', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#e74c3c', background: '#1e1e1e', color: '#fff' })
            .then(function (r) { if (r.isConfirmed) run(); });
    }

    function ban(playerId) {
        var name = playerName(playerId);
        var ask = window.Swal
            ? window.Swal.fire({
                title: '🚫 แบน ' + name,
                html: '<select id="awcBanDur" class="swal2-select" style="display:flex;width:80%;margin:8px auto;">' +
                      '<option value="1">1 ชั่วโมง</option><option value="24" selected>1 วัน</option><option value="168">7 วัน</option><option value="0">ถาวร</option></select>' +
                      '<input id="awcBanReason" class="swal2-input" maxlength="120" placeholder="เหตุผล" value="พฤติกรรมในแชทโลก">',
                showCancelButton: true, confirmButtonText: 'แบน', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#e74c3c', background: '#1e1e1e', color: '#fff',
                preConfirm: function () {
                    var hours = Number(document.getElementById('awcBanDur').value);
                    return { durationHours: hours > 0 ? hours : null, reason: document.getElementById('awcBanReason').value || 'พฤติกรรมในแชทโลก' };
                }
            }).then(function (r) { return r.isConfirmed ? r.value : null; })
            : Promise.resolve(window.confirm('แบน ' + name + ' 1 วัน?') ? { durationHours: 24, reason: 'พฤติกรรมในแชทโลก' } : null);
        ask.then(function (choice) {
            if (!choice) return;
            call('admin_banPlayer', { playerId: playerId, reason: choice.reason, durationHours: choice.durationHours }).then(function (response) {
                if (!response.success) return toast(response.error || 'แบนไม่สำเร็จ', 'error');
                toast('แบน ' + name + ' แล้ว');
                load();
            });
        });
    }

    function onClick(event) {
        var target = event.target.closest('button');
        if (!target || !root() || !root().contains(target)) return;

        if (target.id === 'awcRefresh') return load();
        if (target.id === 'awcThresholdSave') {
            var value = document.getElementById('awcThreshold').value;
            return call('admin_worldChatSettings', { reportThreshold: Number(value) }).then(function (r) { if (accept(r)) toast('บันทึกแล้ว'); });
        }
        if (target.dataset.filter) {
            state.filter = target.dataset.filter;
            return render();
        }
        if (target.dataset.wordOp) {
            return call('admin_worldChatWord', { list: target.dataset.list, op: target.dataset.wordOp, word: target.dataset.word }).then(accept);
        }
        var act = target.dataset.act;
        if (!act) return;
        var row = target.closest('[data-player]');
        var playerId = row && row.getAttribute('data-player');
        var messageRowEl = target.closest('.awc-msg');
        var messageId = messageRowEl && messageRowEl.getAttribute('data-id');

        if (act === 'delete') {
            return confirmThen('ลบข้อความนี้?', 'ลบถาวร ทุกคนจะไม่เห็นอีก', function () {
                call('admin_worldChatAction', { action: 'delete', messageId: messageId }).then(function (r) { if (accept(r)) toast('ลบแล้ว'); });
            });
        }
        if (act === 'hide' || act === 'restore') {
            return call('admin_worldChatAction', { action: act, messageId: messageId }).then(function (r) { if (accept(r)) toast(act === 'hide' ? 'ซ่อนแล้ว' : 'คืนข้อความแล้ว'); });
        }
        if (act === 'mute') {
            var minutes = Number(target.dataset.min);
            return call('admin_worldChatAction', { action: 'mute', playerId: playerId, minutes: minutes }).then(function (r) {
                if (accept(r)) toast('ห้าม ' + playerName(playerId) + ' พิมพ์ ' + (minutes === 10 ? '10 นาที' : '1 วัน'));
            });
        }
        if (act === 'unmute') {
            return call('admin_worldChatAction', { action: 'unmute', playerId: playerId }).then(function (r) { if (accept(r)) toast('ปลดแล้ว'); });
        }
        if (act === 'purge') {
            return confirmThen('ลบทุกข้อความของ ' + playerName(playerId) + '?', '', function () {
                call('admin_worldChatAction', { action: 'purge', playerId: playerId }).then(function (r) { if (accept(r)) toast('ลบแล้ว'); });
            });
        }
        if (act === 'ban') return ban(playerId);
    }

    function onSubmit(event) {
        var form = event.target;
        if (!root() || !root().contains(form)) return;
        event.preventDefault();
        var input = form.querySelector('input');
        var text = input ? input.value.trim() : '';
        if (!text) return;
        if (form.classList.contains('awc-add')) {
            call('admin_worldChatWord', { list: form.dataset.list, op: 'add', word: text }).then(function (r) {
                if (accept(r)) toast('เพิ่ม "' + text + '" แล้ว');
            });
            return;
        }
        if (form.id === 'awcTest') {
            call('admin_worldChatTest', { text: text }).then(function (r) {
                var out = document.getElementById('awcTestResult');
                if (!out || !r.success) return;
                var v = r.verdict || {};
                var reasons = { profanity: 'คำไม่สุภาพ', link: 'ลิงก์', line: 'ไอดี LINE / ช่องทางติดต่อ', phone: 'เบอร์โทร', too_long: 'ยาวเกิน', empty: 'ว่าง' };
                out.className = 'awc-test-result ' + (v.ok ? 'is-ok' : 'is-bad');
                out.textContent = v.ok ? '✅ ส่งได้' : '⛔ ถูกบล็อก: ' + (reasons[v.reason] || v.reason) + (v.words ? ' (' + v.words.join(', ') + ')' : '');
            });
        }
    }

    function onInput(event) {
        if (event.target && event.target.id === 'awcSearch') {
            state.q = event.target.value;
            var caret = event.target.selectionStart;
            render();
            var again = document.getElementById('awcSearch');
            if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
        }
    }

    function init() {
        document.addEventListener('click', onClick);
        document.addEventListener('submit', onSubmit);
        document.addEventListener('input', onInput);
        var s = socket();
        if (s) s.on('adminWorldChatUpdate', onUpdate);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.AdminWorldChat = { load: load, onUpdate: onUpdate };
})();
