/* แชทโลก — ปุ่มลอย 💬 + แผงแชท (หน้าแรก / รายชื่อห้อง เท่านั้น ไม่ใส่ในกระดานเกม)
 *
 * ต้องมี window.appSocket (layout) และ window.PlayerAvatar (playerAvatar.js)
 * ทุกอย่างที่มาจากผู้เล่นใส่ผ่าน textContent เท่านั้น — ไม่มี HTML ในข้อความ
 * กติกาทั้งหมด (ใครพิมพ์ได้ ช้าเร็ว คำหยาบ ลิงก์) ตรวจที่ server — ฝั่งนี้แค่แสดงผล
 *
 * หน้าที่มีตัวเข้าห้องเอง (รายชื่อห้อง) ตั้ง window.WorldChatJoinRoom = function(roomId) {...}
 * ไม่งั้นปุ่ม "เข้าห้อง" ในการ์ดเชิญจะพาไป /rooms?join=<roomId>
 */
(function () {
    'use strict';

    var LAST_SEEN_KEY = 'worldChatLastSeen';
    var MAX_RENDERED = 200;

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch (e) { /* โหมดส่วนตัว/บล็อก storage — ทำงานต่อได้ */ }
        return null;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function safeColor(value) {
        return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#94a3b8';
    }

    function formatTime(iso) {
        var date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        var now = new Date();
        var opts = { hour: '2-digit', minute: '2-digit', hour12: false };
        var sameDay = date.toDateString() === now.toDateString();
        try {
            return sameDay
                ? date.toLocaleTimeString('th-TH', opts)
                : date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString('th-TH', opts);
        } catch (e) {
            return date.toISOString().slice(11, 16);
        }
    }

    var INVITE_STATUS = {
        open: { label: 'ว่าง', cls: 'is-open' },
        full: { label: 'เต็ม', cls: 'is-full' },
        playing: { label: 'กำลังเล่น', cls: 'is-playing' },
        closed: { label: 'ปิดแล้ว', cls: 'is-closed' }
    };

    function init() {
        var socket = window.appSocket;
        if (!socket || document.getElementById('wcFab')) return;

        var state = {
            open: false,
            loaded: false,
            loading: false,
            me: null,
            unread: 0,
            messages: new Map(),
            cooldownTimer: null,
            sending: false
        };

        // ---------- โครง DOM ----------
        var fab = el('button', 'wc-fab');
        fab.type = 'button';
        fab.id = 'wcFab';
        fab.setAttribute('aria-haspopup', 'dialog');
        fab.setAttribute('aria-expanded', 'false');
        fab.setAttribute('aria-controls', 'wcPanel');
        fab.setAttribute('aria-label', 'แชทโลก');
        var fabIcon = el('span', 'wc-fab-icon', '💬');
        fabIcon.setAttribute('aria-hidden', 'true');
        var fabLabel = el('span', 'wc-fab-label', 'แชทโลก');
        var badge = el('span', 'wc-badge');
        badge.id = 'wcBadge';
        badge.hidden = true;
        fab.appendChild(fabIcon);
        fab.appendChild(fabLabel);
        fab.appendChild(badge);

        var backdrop = el('div', 'wc-backdrop');
        backdrop.hidden = true;

        var panel = el('section', 'wc-panel');
        panel.id = 'wcPanel';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-labelledby', 'wcTitle');

        var head = el('div', 'wc-head');
        var title = el('h2', 'wc-title', '💬 แชทโลก');
        title.id = 'wcTitle';
        var sub = el('p', 'wc-sub', 'คุยกับทุกคนในเว็บ · หาเพื่อนเล่น');
        var titleWrap = el('div', 'wc-title-wrap');
        titleWrap.appendChild(title);
        titleWrap.appendChild(sub);
        var close = el('button', 'wc-close', '✕');
        close.type = 'button';
        close.setAttribute('aria-label', 'ปิดแชท');
        head.appendChild(titleWrap);
        head.appendChild(close);

        var list = el('div', 'wc-list');
        list.id = 'wcList';
        list.setAttribute('role', 'log');
        list.setAttribute('aria-live', 'off');
        list.setAttribute('aria-label', 'ข้อความ');
        var empty = el('p', 'wc-empty', 'ยังไม่มีข้อความ ทักทายเป็นคนแรกเลย 👋');

        var toast = el('div', 'wc-toast');
        toast.setAttribute('role', 'status');
        toast.hidden = true;

        var inviteBar = el('div', 'wc-invite-bar');
        inviteBar.hidden = true;
        var inviteBtn = el('button', 'wc-invite-btn');
        inviteBtn.type = 'button';
        inviteBtn.id = 'wcInviteBtn';
        inviteBar.appendChild(inviteBtn);

        var warn = el('p', 'wc-warn');
        warn.id = 'wcWarn';
        warn.setAttribute('role', 'alert');
        warn.hidden = true;

        var lock = el('div', 'wc-lock');
        lock.id = 'wcLock';
        lock.hidden = true;
        var lockText = el('p', 'wc-lock-text');
        var lockLink = el('a', 'wc-lock-link', 'หาห้องเล่น →');
        lockLink.href = '/rooms';
        lock.appendChild(lockText);
        lock.appendChild(lockLink);

        var form = el('form', 'wc-form');
        form.id = 'wcForm';
        form.setAttribute('autocomplete', 'off');
        var input = el('input', 'wc-input');
        input.id = 'wcInput';
        input.type = 'text';
        input.maxLength = 200;
        input.placeholder = 'พิมพ์ข้อความ…';
        input.setAttribute('aria-label', 'ข้อความ');
        input.setAttribute('enterkeyhint', 'send');
        var send = el('button', 'wc-send', 'ส่ง');
        send.type = 'submit';
        send.id = 'wcSend';
        var counter = el('span', 'wc-counter', '0/200');
        counter.setAttribute('aria-hidden', 'true');
        form.appendChild(input);
        form.appendChild(send);

        var foot = el('div', 'wc-foot');
        foot.appendChild(inviteBar);
        foot.appendChild(warn);
        foot.appendChild(lock);
        foot.appendChild(form);
        foot.appendChild(counter);

        panel.appendChild(head);
        panel.appendChild(list);
        panel.appendChild(toast);
        panel.appendChild(foot);

        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
        document.body.appendChild(fab);

        // อยู่เหนือแถบปุ่มล่าง (หน้ารายชื่อห้อง) ไม่ทับกัน
        function placeFab() {
            var node = document.querySelector('.ui-footer-bar');
            var offset = 0;
            // แถบล่างจริงๆ คือ <footer> ที่ fixed อยู่ (ตัว nav ข้างในไม่ fixed เอง)
            while (node && node !== document.body) {
                if (window.getComputedStyle(node).position === 'fixed') {
                    offset = Math.max(0, Math.round(window.innerHeight - node.getBoundingClientRect().top));
                    break;
                }
                node = node.parentElement;
            }
            document.documentElement.style.setProperty('--wc-bottom-offset', offset + 'px');
        }
        placeFab();
        window.addEventListener('resize', placeFab);
        if (window.location.pathname.indexOf('/rooms') === 0) lockLink.hidden = true;

        // ---------- ตัวช่วย ----------
        function lastSeen() {
            return store(LAST_SEEN_KEY) || null;
        }

        function markSeen(iso) {
            if (!iso) return;
            var current = lastSeen();
            if (!current || iso > current) store(LAST_SEEN_KEY, iso);
        }

        function setUnread(count) {
            state.unread = Math.max(0, count);
            badge.hidden = state.unread === 0;
            badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
            fab.setAttribute('aria-label', state.unread ? 'แชทโลก มีข้อความใหม่ ' + state.unread + ' ข้อความ' : 'แชทโลก');
            fab.classList.toggle('has-unread', state.unread > 0);
        }

        var toastTimer = null;
        function showToast(text) {
            toast.textContent = text;
            toast.hidden = false;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () { toast.hidden = true; }, 2600);
        }

        function showWarn(text) {
            if (!text) {
                warn.hidden = true;
                warn.textContent = '';
                return;
            }
            warn.textContent = '⚠️ ' + text;
            warn.hidden = false;
        }

        function myId() {
            return state.me && state.me.playerId;
        }

        function nearBottom() {
            return list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }

        function scrollToBottom() {
            list.scrollTop = list.scrollHeight;
        }

        // ---------- สถานะตัวเอง ----------
        function applyMe(me) {
            if (!me) return;
            state.me = me;
            var canSend = Boolean(me.canSend);
            form.hidden = !canSend;
            counter.hidden = !canSend;
            lock.hidden = canSend;
            if (!canSend) {
                lockText.textContent = '🔒 ' + (me.message || 'ตอนนี้ยังพิมพ์ไม่ได้');
                lockLink.hidden = me.reason !== 'newcomer' || window.location.pathname.indexOf('/rooms') === 0;
            }
            var room = me.inviteRoom;
            inviteBar.hidden = !(canSend && room);
            if (room) {
                inviteBtn.textContent = '📣 ชวนคนเข้าห้อง ' + (room.emoji || '🎮') + ' ' + (room.roomName || '');
            }
            list.querySelectorAll('.wc-report').forEach(function (button) {
                button.hidden = !me.canReport;
            });
        }

        // ---------- วาดข้อความ ----------
        function renderAvatar(message) {
            var holder = el('span', 'wc-avatar');
            if (window.PlayerAvatar && typeof window.PlayerAvatar.render === 'function') {
                // render escape ทุกค่าเอง และรับรูป Google เฉพาะ googleusercontent ที่ผ่าน normalize
                holder.innerHTML = window.PlayerAvatar.render({
                    playerId: message.playerId,
                    avatar: message.avatar,
                    avatarFrame: message.avatarFrame,
                    avatarImage: message.avatarImage,
                    color: safeColor(message.color),
                    playerName: message.playerName
                }, { size: 34 });
            } else {
                holder.textContent = message.avatar || '👤';
            }
            return holder;
        }

        function inviteCard(message) {
            var info = message.invite || {};
            var status = INVITE_STATUS[info.status] || null;
            var card = el('div', 'wc-card');
            var top = el('div', 'wc-card-top');
            var game = el('span', 'wc-card-game', (info.emoji || '🎮') + ' ' + (info.gameLabel || 'ห้องเกม'));
            top.appendChild(game);
            if (status) {
                var chip = el('span', 'wc-card-status ' + status.cls, status.label);
                top.appendChild(chip);
            }
            var name = el('p', 'wc-card-name', info.roomName || 'ห้องเกม');
            var meta = el('p', 'wc-card-meta', '👥 ' + (info.count || 0) + '/' + (info.max || '?') + ' คน' + (info.locked ? ' · 🔒 มีรหัส' : ''));
            var join = el('button', 'wc-card-join', 'เข้าห้อง');
            join.type = 'button';
            join.setAttribute('data-room-id', info.roomId || '');
            join.setAttribute('aria-label', 'เข้าห้อง ' + (info.roomName || ''));
            if (info.status === 'closed' || info.status === 'full' || info.status === 'playing') {
                join.disabled = true;
                join.textContent = info.status === 'closed' ? 'ห้องปิดแล้ว' : (info.status === 'full' ? 'ห้องเต็ม' : 'กำลังเล่น');
            }
            join.addEventListener('click', function () {
                var roomId = join.getAttribute('data-room-id');
                if (!roomId) return;
                if (typeof window.WorldChatJoinRoom === 'function') {
                    closePanel();
                    window.WorldChatJoinRoom(roomId);
                } else {
                    window.location.href = '/rooms?join=' + encodeURIComponent(roomId);
                }
            });
            card.appendChild(top);
            card.appendChild(name);
            card.appendChild(meta);
            card.appendChild(join);
            return card;
        }

        function renderMessage(message) {
            var mine = message.playerId === myId();
            var row = el('article', 'wc-msg' + (mine ? ' is-mine' : '') + (message.kind === 'invite' ? ' is-invite' : ''));
            row.setAttribute('data-id', message.id);
            row.setAttribute('data-at', message.createdAt);
            if (!mine) row.appendChild(renderAvatar(message));
            var body = el('div', 'wc-body');
            var meta = el('div', 'wc-meta');
            var name = el('span', 'wc-name', mine ? 'คุณ' : message.playerName);
            name.style.color = safeColor(message.color);
            meta.appendChild(name);
            if (message.isAdmin) meta.appendChild(el('span', 'wc-admin', 'แอดมิน'));
            var time = el('time', 'wc-time', formatTime(message.createdAt));
            time.setAttribute('datetime', message.createdAt);
            meta.appendChild(time);
            body.appendChild(meta);
            if (message.kind === 'invite') {
                body.appendChild(el('p', 'wc-text', 'ชวนมาเล่นด้วยกัน!'));
                body.appendChild(inviteCard(message));
            } else {
                body.appendChild(el('p', 'wc-text', message.text));
            }
            row.appendChild(body);
            if (!mine) {
                var report = el('button', 'wc-report', '🚩');
                report.type = 'button';
                report.title = 'รายงานข้อความนี้';
                report.setAttribute('aria-label', 'รายงานข้อความของ ' + message.playerName);
                report.hidden = !(state.me && state.me.canReport);
                report.addEventListener('click', function () { confirmReport(message, report); });
                row.appendChild(report);
            }
            return row;
        }

        function syncEmpty() {
            var has = list.querySelector('.wc-msg');
            if (!has && !empty.parentNode) list.appendChild(empty);
            if (has && empty.parentNode) empty.parentNode.removeChild(empty);
        }

        function insertMessage(message) {
            if (!message || !message.id) return;
            var existing = list.querySelector('[data-id="' + cssEscape(message.id) + '"]');
            var node = renderMessage(message);
            state.messages.set(message.id, message);
            if (existing) {
                existing.parentNode.replaceChild(node, existing);
                return;
            }
            // เรียงตามเวลา (ข้อความที่แอดมินคืนอาจเก่ากว่าข้อความล่าสุด)
            var after = null;
            var rows = list.querySelectorAll('.wc-msg');
            for (var i = rows.length - 1; i >= 0; i--) {
                if ((rows[i].getAttribute('data-at') || '') <= message.createdAt) { after = rows[i]; break; }
            }
            if (after) after.parentNode.insertBefore(node, after.nextSibling);
            else list.insertBefore(node, list.firstChild);
            while (list.querySelectorAll('.wc-msg').length > MAX_RENDERED) {
                var oldest = list.querySelector('.wc-msg');
                state.messages.delete(oldest.getAttribute('data-id'));
                oldest.parentNode.removeChild(oldest);
            }
            syncEmpty();
        }

        function removeMessage(id) {
            state.messages.delete(id);
            var node = list.querySelector('[data-id="' + cssEscape(id) + '"]');
            if (node) node.parentNode.removeChild(node);
            syncEmpty();
        }

        function cssEscape(value) {
            return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
        }

        function renderAll(messages) {
            state.messages.clear();
            list.textContent = '';
            messages.forEach(function (message) {
                state.messages.set(message.id, message);
                list.appendChild(renderMessage(message));
            });
            syncEmpty();
            scrollToBottom();
        }

        // ---------- รายงาน ----------
        function confirmReport(message, button) {
            var ask = 'รายงานข้อความนี้ว่าไม่เหมาะสม?\nถ้ามีหลายคนรายงาน ข้อความจะถูกซ่อนรอแอดมินตรวจ';
            var go = function () {
                button.disabled = true;
                socket.emit('worldChat:report', { messageId: message.id }, function (response) {
                    if (!response || !response.success) {
                        button.disabled = false;
                        showToast((response && response.error) || 'รายงานไม่สำเร็จ');
                        return;
                    }
                    button.classList.add('is-done');
                    button.setAttribute('aria-label', 'รายงานแล้ว');
                    showToast(response.hidden ? 'ซ่อนข้อความแล้ว ขอบคุณที่ช่วยดูแล 🙏' : 'รายงานแล้ว ขอบคุณที่ช่วยดูแล 🙏');
                    if (response.hidden) removeMessage(message.id);
                });
            };
            if (window.Swal && typeof window.Swal.fire === 'function') {
                window.Swal.fire({
                    title: '🚩 รายงานข้อความ',
                    text: 'ข้อความนี้ไม่เหมาะสม? ถ้ามีหลายคนรายงาน ข้อความจะถูกซ่อนรอแอดมินตรวจ',
                    showCancelButton: true,
                    confirmButtonText: 'รายงาน',
                    cancelButtonText: 'ยกเลิก',
                    confirmButtonColor: '#e2493b',
                    background: '#1e1b2e',
                    color: '#fff'
                }).then(function (result) { if (result.isConfirmed) go(); });
            } else if (window.confirm(ask)) {
                go();
            }
        }

        // ---------- ส่ง ----------
        function startCooldown(ms) {
            clearInterval(state.cooldownTimer);
            var until = Date.now() + ms;
            var tick = function () {
                var left = Math.ceil((until - Date.now()) / 1000);
                if (left <= 0) {
                    clearInterval(state.cooldownTimer);
                    send.disabled = false;
                    send.textContent = 'ส่ง';
                    return;
                }
                send.disabled = true;
                send.textContent = 'รอ ' + left;
            };
            tick();
            state.cooldownTimer = setInterval(tick, 250);
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var text = input.value.trim();
            if (!text || state.sending || send.disabled) return;
            state.sending = true;
            send.disabled = true;
            socket.emit('worldChat:send', { text: text }, function (response) {
                state.sending = false;
                send.disabled = false;
                if (response && response.success) {
                    input.value = '';
                    counter.textContent = '0/200';
                    showWarn('');
                    startCooldown((state.me && state.me.sendIntervalMs) || 5000);
                    return;
                }
                // คำเตือนเห็นแค่คนส่ง · เก็บข้อความไว้ให้แก้ต่อ
                showWarn((response && response.error) || 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง');
                if (response && response.retryInMs) startCooldown(response.retryInMs);
                if (response && response.me) applyMe(response.me);
                input.focus();
            });
        });

        input.addEventListener('input', function () {
            counter.textContent = input.value.length + '/200';
            if (!warn.hidden) showWarn('');
        });

        inviteBtn.addEventListener('click', function () {
            inviteBtn.disabled = true;
            socket.emit('worldChat:invite', {}, function (response) {
                inviteBtn.disabled = false;
                if (response && response.success) {
                    showToast('ส่งการ์ดชวนแล้ว 📣');
                    return;
                }
                showWarn((response && response.error) || 'ชวนไม่สำเร็จ');
            });
        });

        // ---------- เปิด/ปิด ----------
        function loadHistory() {
            if (state.loading) return;
            state.loading = true;
            list.setAttribute('aria-busy', 'true');
            if (!state.loaded) {
                list.textContent = '';
                list.appendChild(el('p', 'wc-empty', 'กำลังโหลด…'));
            }
            socket.emit('worldChat:history', {}, function (response) {
                state.loading = false;
                list.removeAttribute('aria-busy');
                if (!response || !response.success) {
                    list.textContent = '';
                    list.appendChild(el('p', 'wc-empty', 'โหลดแชทไม่สำเร็จ ลองเปิดใหม่อีกครั้ง'));
                    return;
                }
                state.loaded = true;
                applyMe(response.me);
                renderAll(response.messages || []);
                var latest = response.messages && response.messages.length ? response.messages[response.messages.length - 1].createdAt : null;
                markSeen(latest || new Date().toISOString());
                setUnread(0);
            });
        }

        var lastFocus = null;
        function openPanel() {
            if (state.open) return;
            state.open = true;
            lastFocus = document.activeElement;
            panel.hidden = false;
            backdrop.hidden = false;
            document.documentElement.classList.add('wc-is-open');
            fab.setAttribute('aria-expanded', 'true');
            list.setAttribute('aria-live', 'polite');
            setUnread(0);
            loadHistory();
            setTimeout(function () {
                if (!form.hidden && window.matchMedia('(pointer: fine)').matches) input.focus();
                else close.focus();
            }, 30);
        }

        function closePanel() {
            if (!state.open) return;
            state.open = false;
            panel.hidden = true;
            backdrop.hidden = true;
            document.documentElement.classList.remove('wc-is-open');
            fab.setAttribute('aria-expanded', 'false');
            list.setAttribute('aria-live', 'off');
            showWarn('');
            if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
            else fab.focus();
        }

        fab.addEventListener('click', function () {
            if (state.open) closePanel();
            else openPanel();
        });
        close.addEventListener('click', closePanel);
        backdrop.addEventListener('click', closePanel);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && state.open) closePanel();
        });

        // ---------- สด ----------
        function subscribe() {
            var since = lastSeen();
            socket.emit('worldChat:subscribe', { since: since }, function (response) {
                if (!response || !response.success) return;
                applyMe(response.me);
                if (!since) {
                    // เข้าครั้งแรก — ไม่นับของเก่าเป็น "ใหม่"
                    markSeen(response.latestAt || new Date().toISOString());
                    setUnread(0);
                } else if (!state.open) {
                    setUnread(response.unread || 0);
                }
            });
            if (state.open) loadHistory();
        }

        socket.on('worldChat:message', function (message) {
            if (!message || !message.id) return;
            var mine = message.playerId === myId();
            if (state.open && state.loaded) {
                var stick = mine || nearBottom();
                insertMessage(message);
                if (stick) scrollToBottom();
                markSeen(message.createdAt);
            } else if (!mine) {
                state.loaded = false;
                setUnread(state.unread + 1);
            } else {
                markSeen(message.createdAt);
            }
        });

        socket.on('worldChat:removed', function (data) {
            (data && data.ids || []).forEach(removeMessage);
        });

        socket.on('worldChat:me', function (me) {
            applyMe(me);
        });

        socket.on('connect', subscribe);
        if (socket.connected) subscribe();

        // ให้เทส/หน้าอื่นเปิดแผงได้
        window.WorldChat = { open: openPanel, close: closePanel, isOpen: function () { return state.open; } };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
