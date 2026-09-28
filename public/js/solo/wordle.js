/* ทายคำรายวัน — หน้าเกม (คำตอบอยู่ที่ server เสมอ ตัวนี้แค่วาด/ส่งคำทาย) */
(function () {
    'use strict';
    var W = window.WordleLogic;
    var root = document.getElementById('wd');
    if (!W || !root) return;

    var API = '/api/solo/wordle';
    var CACHE_KEY = 'wordle:state:v1';
    var DRAFT_KEY = 'wordle:draft:v1';
    var INTRO_KEY = 'wordle:intro:v1';
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var myId = root.getAttribute('data-player') || '';

    var LAYOUT_MAIN = [
        'ภถุูึคตจขชโ',
        'ไำพะัีรนยบล',
        'ฟหกดเ้่าสวง',
        'ผปแอิืทมใฝ็'
    ];
    var LAYOUT_ALT = [
        'ฆซฌญฎฏฐฑฒณ',
        'ธศษฉฬฮฤ',
        '๊๋์'
    ];
    var PRAISE = ['อัจฉริยะ!', 'เก่งเกินคน!', 'ยอดเยี่ยม!', 'เยี่ยมเลย!', 'ดีมาก!', 'เฉียดฉิว!'];
    var STATE_LABEL = { correct: 'ถูกตำแหน่ง', present: 'มีในคำ', absent: 'ไม่มีในคำ' };

    var els = {
        no: document.getElementById('wd-no'),
        board: document.getElementById('wd-board'),
        toasts: document.getElementById('wd-toasts'),
        kb: document.getElementById('wd-kb'),
        kbRows: document.getElementById('wd-kb-rows'),
        shift: document.getElementById('wd-shift'),
        shiftLabel: document.getElementById('wd-shift-label'),
        back: document.getElementById('wd-back'),
        enter: document.getElementById('wd-enter'),
        done: document.getElementById('wd-done'),
        doneTitle: document.getElementById('wd-done-title'),
        doneNext: document.getElementById('wd-done-next'),
        howto: document.getElementById('wd-howto'),
        sheet: document.getElementById('wd-sheet'),
        result: document.getElementById('wd-result'),
        statGrid: document.getElementById('wd-stat-grid'),
        dist: document.getElementById('wd-dist'),
        next: document.getElementById('wd-next'),
        share: document.getElementById('wd-share'),
        tabStats: document.getElementById('wd-tab-stats'),
        tabLb: document.getElementById('wd-tab-lb'),
        panelStats: document.getElementById('wd-panel-stats'),
        panelLb: document.getElementById('wd-panel-lb'),
        lb: document.getElementById('wd-lb')
    };

    var state = null;        // สถานะจาก server
    var draft = [];          // ช่องในแถวที่กำลังพิมพ์
    var shift = false;
    var busy = false;        // กำลังส่ง/กำลังเล่นแอนิเมชัน
    var pending = null;      // คำที่ส่งไม่สำเร็จเพราะเน็ต รอส่งใหม่
    var retryTimer = null;
    var retryDelay = 2000;
    var deadline = 0;
    var keyEls = {};
    var lastFocus = null;

    // ---------- storage (พังได้ ต้องไม่ทำเกมพัง) ----------
    function store(key, value) {
        try {
            if (value == null) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* private mode */ }
    }
    function load(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
    }
    function haptic(p) { if (typeof window.gameHaptic === 'function') window.gameHaptic(p); }

    // ---------- toast ----------
    function toast(text, opts) {
        opts = opts || {};
        var node = document.createElement('div');
        node.className = 'wd-toast' + (opts.answer ? ' is-answer' : '');
        node.textContent = text;
        els.toasts.appendChild(node);
        while (els.toasts.children.length > 2) els.toasts.removeChild(els.toasts.firstChild);
        setTimeout(function () {
            node.classList.add('is-out');
            setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
        }, opts.ms || 1800);
    }

    // ---------- กระดาน ----------
    function buildBoard() {
        els.board.innerHTML = '';
        for (var r = 0; r < W.MAX_GUESSES; r++) {
            var row = document.createElement('div');
            row.className = 'wd-row';
            row.setAttribute('role', 'group');
            for (var c = 0; c < W.LENGTH; c++) {
                var tile = document.createElement('div');
                tile.className = 'wd-tile';
                row.appendChild(tile);
            }
            els.board.appendChild(row);
        }
    }

    function paintTile(tile, text, st, near) {
        tile.textContent = text || '';
        tile.classList.toggle('is-filled', Boolean(text) && !st);
        if (st) tile.setAttribute('data-state', st); else tile.removeAttribute('data-state');
        if (near) {
            var dot = document.createElement('span');
            dot.className = 'wd-near';
            tile.appendChild(dot);
        }
    }

    function rowLabel(index, cells, states, near) {
        var parts = [];
        for (var i = 0; i < W.LENGTH; i++) {
            if (!cells[i]) continue;
            var label = cells[i];
            if (states) label += ' ' + (near && near[i] ? 'ตัวอักษรถูกช่อง แต่สระหรือวรรณยุกต์ไม่ตรง' : STATE_LABEL[states[i]]);
            parts.push(label);
        }
        return 'แถว ' + (index + 1) + (parts.length ? ': ' + parts.join(', ') : ' ว่าง');
    }

    function renderBoard(skipRow) {
        var guesses = state ? state.guesses : [];
        var rows = els.board.children;
        for (var r = 0; r < rows.length; r++) {
            if (r === skipRow) continue;
            var row = rows[r];
            var g = guesses[r];
            var current = !g && r === guesses.length && !(state && state.done);
            var cells = g ? g.cells : (current ? draft : []);
            row.classList.toggle('is-current', current);
            for (var c = 0; c < W.LENGTH; c++) {
                var tile = row.children[c];
                paintTile(tile, cells[c], g ? g.states[c] : null, g ? g.near[c] : false);
                tile.classList.toggle('is-next', current && c === cells.length);
            }
            row.setAttribute('aria-label', rowLabel(r, cells, g ? g.states : null, g ? g.near : null));
        }
    }

    function renderDraftRow(popIndex) {
        if (!state && !draft.length && popIndex == null) return;
        var r = state ? state.guesses.length : 0;
        var row = els.board.children[r];
        if (!row) return;
        for (var c = 0; c < W.LENGTH; c++) {
            var tile = row.children[c];
            paintTile(tile, draft[c], null, false);
            tile.classList.toggle('is-next', c === draft.length);
        }
        row.setAttribute('aria-label', rowLabel(r, draft));
        if (popIndex != null && row.children[popIndex] && !reduceMotion) {
            var t = row.children[popIndex];
            t.classList.remove('is-pop');
            void t.offsetWidth;
            t.classList.add('is-pop');
        }
        els.enter.disabled = draft.length < W.LENGTH;
        store(DRAFT_KEY, { puzzle: state ? state.puzzle : null, cells: draft });
    }

    function shakeRow() {
        var r = state ? state.guesses.length : 0;
        var row = els.board.children[r];
        if (!row) return;
        haptic([30, 40, 30]);
        if (reduceMotion) return;
        row.classList.remove('is-shake');
        void row.offsetWidth;
        row.classList.add('is-shake');
    }

    // ---------- คีย์บอร์ด ----------
    function buildKeyboard() {
        els.kbRows.innerHTML = '';
        keyEls = {};
        var layout = shift ? LAYOUT_ALT : LAYOUT_MAIN;
        for (var r = 0; r < 4; r++) {
            var row = document.createElement('div');
            row.className = 'wd-kb-row';
            var chars = Array.from(layout[r] || '');
            chars.forEach(function (ch) {
                var key = document.createElement('button');
                key.type = 'button';
                key.className = 'wd-key' + (W.isMark(ch) ? ' is-mark' : '');
                key.setAttribute('data-key', ch);
                // สระบน/ล่าง/วรรณยุกต์ใส่ตัวเดียว — ตัวจัดรูปอักษรของระบบวาดวงกลมประ (◌) ให้เอง
                key.textContent = ch;
                key.setAttribute('aria-label', W.isMark(ch) ? 'เครื่องหมาย ' + ch : ch);
                row.appendChild(key);
                keyEls[ch] = key;
            });
            els.kbRows.appendChild(row);
        }
        els.shift.setAttribute('aria-pressed', shift ? 'true' : 'false');
        els.shiftLabel.textContent = shift ? 'ก ข ค' : 'ฆ ศ ษ';
        els.shift.setAttribute('aria-label', shift ? 'กลับไปแป้นหลัก' : 'สลับไปอักษรอื่น');
        paintKeys();
    }

    function paintKeys() {
        var keys = (state && state.keys) || {};
        Object.keys(keyEls).forEach(function (ch) {
            var st = keys[ch];
            if (st) keyEls[ch].setAttribute('data-state', st); else keyEls[ch].removeAttribute('data-state');
        });
        // จุดบนปุ่มสลับ: อีกหน้ามีตัวที่เขียว/ทองอยู่
        var other = (shift ? LAYOUT_MAIN : LAYOUT_ALT).join('');
        var hasHint = Array.from(other).some(function (ch) { return keys[ch] === 'correct' || keys[ch] === 'present'; });
        els.shift.classList.toggle('has-dot', hasHint);
    }

    function pressKey(ch) {
        if (!canType()) return;
        var res = W.typeKey(draft, ch, W.LENGTH);
        if (!res.ok) {
            if (W.isMark(ch) && draft.length) toast('สระ/วรรณยุกต์ต้องวางบนพยัญชนะ');
            else if (!draft.length && W.isMark(ch)) toast('พิมพ์พยัญชนะก่อน แล้วค่อยใส่สระ/วรรณยุกต์');
            shakeRow();
            return;
        }
        draft = res.cells;
        haptic(8);
        renderDraftRow(draft.length - 1);
    }

    function pressBack() {
        if (!canType()) return;
        draft = W.backspace(draft);
        haptic(8);
        renderDraftRow();
    }

    function canType() {
        return !busy && !(state && state.done) && !pending;
    }

    // ---------- network ----------
    function request(method, url, body) {
        return fetch(url, {
            method: method,
            credentials: 'same-origin',
            cache: 'no-store',
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (json) {
                return { status: res.status, ok: res.ok, json: json };
            });
        });
    }

    function applyState(next, opts) {
        opts = opts || {};
        var firstLoad = !state;
        var puzzleChanged = firstLoad || state.puzzle !== next.puzzle;
        state = {
            puzzle: next.puzzle,
            guesses: Array.isArray(next.guesses) ? next.guesses : [],
            keys: next.keys || {},
            done: Boolean(next.done),
            won: Boolean(next.won),
            answer: next.answer || null,
            answerCells: next.answerCells || null,
            stats: next.stats || null
        };
        if (typeof next.nextInMs === 'number') deadline = Date.now() + next.nextInMs;
        // พิมพ์ไว้ก่อนข้อมูลจาก server มาถึง (เน็ตช้า) → เก็บร่างไว้ ไม่ล้างทิ้ง
        if (puzzleChanged && !opts.keepDraft && !(firstLoad && draft.length)) {
            var saved = load(DRAFT_KEY);
            draft = saved && saved.puzzle === state.puzzle && Array.isArray(saved.cells) ? saved.cells.slice(0, W.LENGTH) : [];
        }
        if (state.done) draft = [];
        els.no.textContent = '#' + state.puzzle;
        store(CACHE_KEY, Object.assign({}, state, { savedAt: Date.now(), deadline: deadline }));
    }

    function renderAll() {
        renderBoard();
        renderDraftRow();
        paintKeys();
        renderDone();
    }

    function fetchToday(opts) {
        return request('GET', API + '/today').then(function (res) {
            if (!res.ok || !res.json || !res.json.success) throw new Error(res.json && res.json.error || 'load failed');
            applyState(res.json);
            if (!busy) renderAll();
            return res.json;
        }).catch(function (error) {
            if (!(opts && opts.silent)) toast('ออฟไลน์อยู่ — ต่อเน็ตแล้วจะโหลดข้อวันนี้ให้เอง', { ms: 2600 });
            throw error;
        });
    }

    function submit() {
        if (busy || pending || (state && state.done)) return;
        if (draft.length < W.LENGTH) {
            toast('ยังไม่ครบ ' + W.LENGTH + ' ช่อง');
            shakeRow();
            return;
        }
        var word = draft.join('');
        if (state && state.guesses.some(function (g) { return g.word === word; })) {
            toast('ทายคำนี้ไปแล้ว');
            shakeRow();
            return;
        }
        sendGuess(word);
    }

    function sendGuess(word) {
        busy = true;
        els.enter.disabled = true;
        request('POST', API + '/guess', { guess: word, puzzle: state ? state.puzzle : null })
            .then(function (res) {
                var json = res.json || {};
                if (res.ok && json.success) {
                    clearRetry();
                    pending = null;
                    var rowIndex = state ? state.guesses.length : 0;
                    applyState(json, { keepDraft: true });
                    draft = [];
                    store(DRAFT_KEY, null);
                    revealRow(rowIndex);
                    return;
                }
                if (res.status >= 500 || res.status === 0) throw new Error('server');
                clearRetry();
                pending = null;
                busy = false;
                if (json.code === 'stale_puzzle' && json.puzzle) {
                    toast(json.error || 'ขึ้นข้อใหม่แล้ว');
                    store(DRAFT_KEY, null);
                    draft = [];
                    applyState(json);
                    renderAll();
                    return;
                }
                if (json.code === 'done' && json.puzzle) {
                    applyState(json);
                    renderAll();
                    toast(json.error);
                    return;
                }
                toast(json.error || 'ทายไม่สำเร็จ ลองอีกครั้ง');
                shakeRow();
                renderDraftRow();
            })
            .catch(function () {
                // เน็ตหลุด: เก็บคำไว้ ส่งใหม่ให้อัตโนมัติ (ไม่ต้องพิมพ์ใหม่)
                pending = word;
                busy = false;
                toast('เน็ตหลุด — จะส่งคำนี้ใหม่ให้อัตโนมัติ', { ms: 2400 });
                scheduleRetry();
            });
    }

    function scheduleRetry() {
        clearRetry();
        retryTimer = setTimeout(function () {
            retryTimer = null;
            if (pending) sendGuess(pending);
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
    }
    function clearRetry() {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        retryDelay = 2000;
    }
    window.addEventListener('online', function () {
        if (pending) { clearRetry(); sendGuess(pending); }
        else if (!state) fetchToday({ silent: true }).catch(function () {});
    });

    // ---------- แอนิเมชันเปิดแถว ----------
    function revealRow(rowIndex) {
        var row = els.board.children[rowIndex];
        var g = state.guesses[rowIndex];
        if (!row || !g) { busy = false; renderAll(); return; }
        row.classList.remove('is-current');
        var step = reduceMotion ? 0 : 320;
        var half = reduceMotion ? 0 : 250;
        for (var c = 0; c < W.LENGTH; c++) {
            (function (c) {
                var tile = row.children[c];
                tile.classList.remove('is-next');
                setTimeout(function () {
                    if (!reduceMotion) tile.classList.add('is-flip');
                    setTimeout(function () {
                        paintTile(tile, g.cells[c], g.states[c], g.near[c]);
                    }, half);
                }, c * step);
            })(c);
        }
        var total = reduceMotion ? 0 : (W.LENGTH - 1) * step + 520;
        setTimeout(function () {
            Array.prototype.forEach.call(row.children, function (t) { t.classList.remove('is-flip'); });
            busy = false;
            renderBoard();
            paintKeys();
            renderDraftRow();
            if (state.done) finish(rowIndex);
        }, total);
    }

    function finish(rowIndex) {
        renderDone();
        if (state.won) {
            haptic([20, 50, 20, 50, 40]);
            toast(PRAISE[Math.min(rowIndex, PRAISE.length - 1)], { ms: 2200 });
            var row = els.board.children[rowIndex];
            if (row && !reduceMotion) {
                Array.prototype.forEach.call(row.children, function (tile, i) {
                    setTimeout(function () { tile.classList.add('is-bounce'); }, i * 100);
                    setTimeout(function () { tile.classList.remove('is-bounce'); }, i * 100 + 700);
                });
            }
            confetti();
            setTimeout(function () { openSheet('stats'); }, reduceMotion ? 600 : 1900);
        } else {
            haptic([60]);
            toast('เฉลย: ' + (state.answer || ''), { answer: true, ms: 3200 });
            setTimeout(function () { openSheet('stats'); }, reduceMotion ? 900 : 2600);
        }
    }

    function confetti() {
        if (reduceMotion) return;
        var layer = document.createElement('div');
        layer.className = 'wd-confetti';
        layer.setAttribute('aria-hidden', 'true');
        var colors = ['oklch(0.67 0.13 158)', 'oklch(0.84 0.13 84)', 'oklch(0.72 0.17 28)', 'oklch(0.96 0.01 262)', 'oklch(0.7 0.12 250)'];
        for (var i = 0; i < 44; i++) {
            var p = document.createElement('i');
            p.style.left = (Math.random() * 100) + '%';
            p.style.background = colors[i % colors.length];
            p.style.setProperty('--x', ((Math.random() - 0.5) * 160).toFixed(0) + 'px');
            p.style.setProperty('--r', ((Math.random() - 0.5) * 1080).toFixed(0) + 'deg');
            p.style.setProperty('--d', (1.4 + Math.random() * 1.2).toFixed(2) + 's');
            p.style.setProperty('--delay', (Math.random() * 0.35).toFixed(2) + 's');
            if (i % 3 === 0) { p.style.width = '7px'; p.style.height = '7px'; p.style.borderRadius = '50%'; }
            layer.appendChild(p);
        }
        document.body.appendChild(layer);
        setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 3200);
    }

    // ---------- จบเกม / สถิติ ----------
    function renderDone() {
        var done = Boolean(state && state.done);
        els.kb.hidden = done;
        els.done.hidden = !done;
        if (!done) return;
        els.doneTitle.textContent = state.won
            ? 'ทายถูกใน ' + state.guesses.length + ' ครั้ง 🎉'
            : 'คำวันนี้คือ “' + (state.answer || '') + '”';
    }

    function fmtCountdown(ms) {
        var s = Math.max(0, Math.floor(ms / 1000));
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        return [h, m, sec].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
    }

    function tick() {
        if (!deadline) return;
        var left = deadline - Date.now();
        var text = fmtCountdown(left);
        els.next.textContent = text;
        els.doneNext.textContent = text;
        if (left <= 0) {
            deadline = 0;
            store(DRAFT_KEY, null);
            fetchToday({ silent: true }).then(function () {
                if (!els.sheet.hidden) renderStats();
                toast('ข้อใหม่มาแล้ว!');
            }).catch(function () { deadline = Date.now() + 15000; });
        }
    }

    function renderStats() {
        var s = (state && state.stats) || { played: 0, winRate: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0] };
        var items = [
            [s.played, 'เล่นแล้ว'],
            [s.winRate + '%', 'ชนะ'],
            [s.streak, 'สตรีคตอนนี้', 'is-streak'],
            [s.maxStreak, 'สตรีคสูงสุด']
        ];
        els.statGrid.innerHTML = '';
        items.forEach(function (it) {
            var box = document.createElement('div');
            box.className = 'wd-stat' + (it[2] ? ' ' + it[2] : '');
            var b = document.createElement('b');
            b.textContent = it[0];
            var span = document.createElement('span');
            span.textContent = it[1];
            box.appendChild(b);
            box.appendChild(span);
            els.statGrid.appendChild(box);
        });

        var max = Math.max.apply(null, s.dist.concat([1]));
        var todayRow = state && state.done && state.won ? state.guesses.length : 0;
        els.dist.innerHTML = '';
        s.dist.forEach(function (count, i) {
            var row = document.createElement('div');
            row.className = 'wd-dist-row' + (todayRow === i + 1 ? ' is-today' : '');
            var label = document.createElement('span');
            label.textContent = i + 1;
            var track = document.createElement('span');
            track.className = 'wd-dist-track';
            var bar = document.createElement('span');
            bar.className = 'wd-dist-bar';
            bar.style.width = Math.max(8, Math.round((count / max) * 100)) + '%';
            bar.style.animationDelay = (i * 50) + 'ms';
            bar.textContent = count;
            track.appendChild(bar);
            row.appendChild(label);
            row.appendChild(track);
            els.dist.appendChild(row);
        });

        els.result.innerHTML = '';
        if (state && state.done && state.answerCells) {
            var reveal = document.createElement('div');
            reveal.className = 'wd-reveal';
            reveal.setAttribute('aria-label', 'คำวันนี้ ' + state.answer);
            state.answerCells.forEach(function (cell) {
                var t = document.createElement('div');
                t.className = 'wd-tile';
                t.setAttribute('data-state', state.won ? 'correct' : 'present');
                t.textContent = cell;
                reveal.appendChild(t);
            });
            var p = document.createElement('p');
            p.style.textAlign = 'center';
            p.textContent = state.won ? 'ทายถูกใน ' + state.guesses.length + '/' + W.MAX_GUESSES + ' ครั้ง' : 'คราวหน้าเอาใหม่! คำวันนี้คือ';
            els.result.appendChild(p);
            els.result.appendChild(reveal);
        }
        els.share.hidden = !(state && state.done);
        tick();
    }

    function renderLeaderboard() {
        els.lb.innerHTML = '<li class="wd-empty" style="display:block">กำลังโหลด…</li>';
        request('GET', API + '/leaderboard').then(function (res) {
            var entries = (res.json && res.json.entries) || [];
            els.lb.innerHTML = '';
            if (!entries.length) {
                var empty = document.createElement('li');
                empty.className = 'wd-empty';
                empty.style.display = 'block';
                empty.textContent = 'ยังไม่มีใครติดสตรีค — ทายถูกวันนี้แล้วคุณจะเป็นคนแรก';
                els.lb.appendChild(empty);
                return;
            }
            entries.forEach(function (e) {
                var li = document.createElement('li');
                if (myId && e.playerId === myId) li.className = 'is-me';
                var rank = document.createElement('span');
                rank.className = 'wd-lb-rank';
                rank.textContent = e.rank;
                var av = document.createElement('span');
                av.className = 'wd-lb-av';
                av.textContent = e.avatar || '👤';
                var name = document.createElement('span');
                name.className = 'wd-lb-name';
                name.textContent = e.playerName || 'ผู้เล่น';
                var score = document.createElement('span');
                score.className = 'wd-lb-score';
                score.textContent = '🔥 ' + (e.label || e.score);
                li.appendChild(rank);
                li.appendChild(av);
                li.appendChild(name);
                li.appendChild(score);
                els.lb.appendChild(li);
            });
        }).catch(function () {
            els.lb.innerHTML = '';
            var li = document.createElement('li');
            li.className = 'wd-empty';
            li.style.display = 'block';
            li.textContent = 'โหลดอันดับไม่ได้ — ลองใหม่เมื่อต่อเน็ต';
            els.lb.appendChild(li);
        });
    }

    function selectTab(which) {
        var lb = which === 'lb';
        els.tabStats.setAttribute('aria-selected', lb ? 'false' : 'true');
        els.tabLb.setAttribute('aria-selected', lb ? 'true' : 'false');
        els.panelStats.hidden = lb;
        els.panelLb.hidden = !lb;
        if (lb) renderLeaderboard(); else renderStats();
    }

    // ---------- แผ่นป๊อปอัป ----------
    function openModal(el) {
        lastFocus = document.activeElement;
        el.hidden = false;
        var close = el.querySelector('[data-close]');
        if (close) close.focus({ preventScroll: true });
    }
    function closeModal(el) {
        // ปุ่มในป๊อปอัปที่ถูกซ่อนยังถือโฟกัสค้างได้ชั่วครู่ — ปล่อยก่อน ไม่งั้น Enter ถัดไปไปตกที่ปุ่มนั้น
        if (el.contains(document.activeElement)) document.activeElement.blur();
        el.hidden = true;
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    }
    function openSheet(tab) {
        openModal(els.sheet);
        selectTab(tab || 'stats');
    }
    [els.howto, els.sheet].forEach(function (bg) {
        bg.addEventListener('click', function (e) {
            if (e.target === bg || e.target.closest('[data-close]')) {
                closeModal(bg);
                if (bg === els.howto) store(INTRO_KEY, 1);
            }
        });
    });

    // ---------- แชร์ ----------
    function shareResult() {
        if (!state || !state.done) return;
        var text = W.shareText(state.puzzle, state.guesses.map(function (g) { return g.states; }), state.won);
        var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (coarse && navigator.share) {
            navigator.share({ text: text }).catch(function (err) {
                if (err && err.name === 'AbortError') return;
                copyText(text);
            });
            return;
        }
        copyText(text);
    }
    function copyText(text) {
        function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            toast(ok ? 'คัดลอกผลแล้ว ไปวางอวดเพื่อนได้เลย' : 'คัดลอกไม่ได้ ลองกดค้างที่ข้อความ');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                toast('คัดลอกผลแล้ว ไปวางอวดเพื่อนได้เลย');
            }, fallback);
        } else {
            fallback();
        }
    }

    // ---------- events ----------
    els.kbRows.addEventListener('click', function (e) {
        var key = e.target.closest('.wd-key');
        if (key) pressKey(key.getAttribute('data-key'));
    });
    els.shift.addEventListener('click', function () {
        shift = !shift;
        buildKeyboard();
    });
    els.back.addEventListener('click', pressBack);
    els.enter.addEventListener('click', submit);
    document.getElementById('wd-help').addEventListener('click', function () { openModal(els.howto); });
    document.getElementById('wd-stats-btn').addEventListener('click', function () { openSheet('stats'); });
    document.getElementById('wd-done-stats').addEventListener('click', function () { openSheet('stats'); });
    document.getElementById('wd-done-share').addEventListener('click', shareResult);
    els.share.addEventListener('click', shareResult);
    els.tabStats.addEventListener('click', function () { selectTab('stats'); });
    els.tabLb.addEventListener('click', function () { selectTab('lb'); });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (!els.sheet.hidden) closeModal(els.sheet);
            else if (!els.howto.hidden) { closeModal(els.howto); store(INTRO_KEY, 1); }
            return;
        }
        if (!els.sheet.hidden || !els.howto.hidden) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.querySelector('.swal2-container, .promo-overlay')) return;
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === 'Enter') {
            var btn = e.target && e.target.closest ? e.target.closest('button') : null;
            if (btn && btn.offsetParent !== null && !btn.closest('.wd-kb')) return; // ให้ปุ่มที่โฟกัสอยู่ทำงานเอง
            e.preventDefault();
            submit();
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            pressBack();
        } else if (e.key && e.key.length === 1 && (W.isBase(e.key) || W.isMark(e.key))) {
            e.preventDefault();
            pressKey(e.key);
        }
    });

    // ---------- start ----------
    buildBoard();
    buildKeyboard();
    var cached = load(CACHE_KEY);
    if (cached && cached.puzzle === W.puzzleNumber(Date.now()) && Array.isArray(cached.guesses)) {
        applyState(Object.assign({}, cached, { nextInMs: cached.deadline ? cached.deadline - Date.now() : undefined }));
    }
    renderAll();
    fetchToday().catch(function () {});
    setInterval(tick, 1000);
    if (!load(INTRO_KEY)) openModal(els.howto);
})();
