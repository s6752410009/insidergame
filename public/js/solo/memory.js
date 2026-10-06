/* จับคู่การ์ดความจำ — ตัวควบคุมหน้าเกม (ตรรกะอยู่ใน memory-core.js) */
(function () {
    'use strict';
    const C = window.MemoryCore;
    const BOOT = window.MEMORY_BOOT || {};
    const $ = id => document.getElementById(id);
    const FACE = (deck, key) => `/assets/games/solo/memory/faces/${deck}/${key}.webp`;
    const KEYS = {
        game: 'memory:game:v1',
        queue: 'memory:queue:v1',
        stats: 'memory:stats:v1',
        prefs: 'memory:prefs:v1',
        howto: 'memory:howto-seen'
    };
    const MISS_HOLD_MS = 850;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- storage (ต้องไม่พังในโหมดส่วนตัว) ----------
    function load(key, fallback) {
        try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }
    function save(key, value) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* เต็ม/ปิดไว้ */ }
    }
    function haptic(p) { if (typeof window.gameHaptic === 'function') window.gameHaptic(p); }
    function randomId(prefix) {
        const bytes = new Uint32Array(2);
        (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(bytes) : (bytes[0] = Math.random() * 4294967296, bytes[1] = Date.now());
        return (prefix ? prefix + '-' : '') + bytes[0].toString(36) + bytes[1].toString(36);
    }
    function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function starsHtml(n) {
        let out = '';
        for (let i = 0; i < 3; i++) out += i < n ? '★' : '<span class="off">★</span>';
        return `<span class="mm-stars" aria-label="${n} ดาว">${out}</span>`;
    }

    // ---------- สถิติ: ข้อมูลจาก server + ผลที่ยังรอส่ง ----------
    let stats = C.normalizeStats(null);
    (function initStats() {
        const cached = load(KEYS.stats, null);
        const server = BOOT.data;
        // ไม่มีผลค้างส่ง = เชื่อ server; มีค้าง = ใช้ตัวในเครื่องที่รวมผลนั้นไว้แล้ว
        const pending = load(KEYS.queue, []).length > 0;
        const useCached = cached && (!server || (pending && (cached.plays || 0) >= (server.plays || 0)));
        stats = C.normalizeStats(useCached ? cached : server);
    })();
    function setStats(next) { stats = C.normalizeStats(next); save(KEYS.stats, stats); }

    let prefs = Object.assign({ level: 'easy', deck: 'wolf' }, load(KEYS.prefs, {}));
    if (!C.LEVELS[prefs.level] || prefs.level === 'daily') prefs.level = 'easy';
    if (!C.DECKS[prefs.deck]) prefs.deck = 'wolf';

    // ---------- preload ภาพ (เล่นต่อได้แม้เน็ตหลุดหลังโหลด) ----------
    const imgCache = new Map();
    function preloadDeck(deckId) {
        const jobs = C.DECKS[deckId].cards.map(([key]) => {
            const url = FACE(deckId, key);
            if (!imgCache.has(url)) {
                const img = new Image();
                img.decoding = 'async';
                img.src = url;
                imgCache.set(url, img.decode ? img.decode().catch(() => null) : Promise.resolve());
            }
            return imgCache.get(url);
        });
        return Promise.all(jobs);
    }

    // ---------- สถานะเกม ----------
    let game = null;          // จาก MemoryCore.newGame
    let run = null;           // { runId, startedAt(perf)|null, baseMs, paused, finished }
    let missTimer = null;
    let tickHandle = null;
    let lastShownSec = -1;
    let cardEls = [];

    function elapsedMs() {
        if (!run) return 0;
        return run.baseMs + (run.startedAt !== null ? performance.now() - run.startedAt : 0);
    }
    function persistGame() {
        // ยังไม่แตะการ์ดสักใบ = ไม่มีอะไรให้ "เล่นต่อ" — ไม่เก็บ (ไม่งั้นเมนูขึ้น "มีเกมค้าง 0 คู่ · 0:00")
        if (!game || !run || run.finished || !game.log.length) return;
        save(KEYS.game, {
            v: 1, runId: run.runId, level: game.level, seed: game.seed, deck: game.deck,
            log: game.log, elapsedMs: Math.round(elapsedMs()), started: run.started, savedAt: Date.now()
        });
    }
    function readSavedGame() {
        const saved = load(KEYS.game, null);
        if (!saved || saved.v !== 1 || !C.LEVELS[saved.level] || !C.DECKS[saved.deck] || !C.isValidSeed(saved.seed)) return null;
        if (saved.level === 'daily') {
            const date = C.dateFromDailySeed(saved.seed);
            const today = C.bangkokDate();
            if (date !== today && date !== C.shiftDate(today, -1)) return null;
        }
        const replayed = C.replay(saved.level, saved.seed, saved.deck, saved.log || []);
        if (!replayed.ok || replayed.state.done) return null;
        return { saved, state: replayed.state };
    }

    // ---------- หน้าจอ ----------
    const menuEl = $('mmMenu');
    const playEl = $('mmPlay');
    function showScreen(name) {
        const playing = name === 'play';
        menuEl.hidden = playing;
        playEl.hidden = !playing;
        document.documentElement.classList.toggle('mm-playing', playing);
        if (playing) { window.scrollTo(0, 0); measureFooter(); layoutBoard(); }
        else renderMenu();
    }
    function measureFooter() {
        const footer = document.querySelector('footer.footer');
        const h = footer ? Math.ceil(footer.getBoundingClientRect().height) : 76;
        $('mm').style.setProperty('--mm-footer', h + 'px');
    }
    function openOverlay(id) { $(id).hidden = false; const btn = $(id).querySelector('.ui-btn--primary'); if (btn) setTimeout(() => btn.focus({ preventScroll: true }), 30); }
    function closeOverlay(id) { $(id).hidden = true; }

    // ---------- เมนู ----------
    function todayInfo() {
        const date = C.bangkokDate();
        return { date, seed: C.dailySeed(date), deck: C.dailyDeck(date) };
    }
    function dailyDoneToday() {
        const last = stats.daily && stats.daily.last;
        return last && last.date === todayInfo().date ? last : null;
    }
    // กระดานประจำวันเปลี่ยนตอนเที่ยงคืนเวลาไทย
    function msUntilNextDaily() {
        const day = 24 * 60 * 60 * 1000;
        const local = Date.now() + 7 * 60 * 60 * 1000;
        return day - (local % day);
    }
    function fmtCountdown(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':');
    }
    let shownDailyDate = null;
    function tickDaily() {
        if (menuEl.hidden) return;
        // ข้ามเที่ยงคืนระหว่างเปิดเมนูค้างไว้ → วาดเมนูใหม่ให้เป็นกระดานของวันใหม่
        if (shownDailyDate && shownDailyDate !== todayInfo().date) { renderMenu(); fetchBoard(); return; }
        const el = $('mmDailyNext');
        if (el) el.textContent = fmtCountdown(msUntilNextDaily());
    }
    function fmtDateThai(date) {
        const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const [y, m, d] = date.split('-').map(Number);
        return `${d} ${months[m - 1]} ${y + 543}`;
    }

    function renderMenu() {
        const t = todayInfo();
        shownDailyDate = t.date;
        $('mmDailyDate').textContent = fmtDateThai(t.date);
        const streak = C.liveStreak(stats);
        $('mmDailyMeta').textContent = `สำรับ${C.DECKS[t.deck].label} · ${C.LEVELS.daily.pairs} คู่ · ${streak > 0 ? `ติดกัน ${streak} วัน` : 'เล่นได้วันละครั้ง'} · เปลี่ยนกระดานเที่ยงคืน`;
        const done = dailyDoneToday();
        const resumable = readSavedGame();
        const dailyInProgress = resumable && resumable.saved.level === 'daily' && C.dateFromDailySeed(resumable.saved.seed) === t.date;
        $('mmDailyCta').hidden = !!done;
        $('mmDailyDone').hidden = !done;
        $('mmDailyBtn').textContent = dailyInProgress ? 'เล่นกระดานวันนี้ต่อ' : 'เล่นกระดานวันนี้';
        if (done) {
            $('mmDailyDone').innerHTML = `<strong>${esc(C.formatTimePrecise(done.timeMs))}</strong><span>${done.moves} ครั้ง ${starsHtml(done.stars)}</span><span id="mmDailyRank"></span>`
                + `<span class="mm-daily-next">กระดานใหม่ใน <b id="mmDailyNext">${fmtCountdown(msUntilNextDaily())}</b> (เที่ยงคืนเวลาไทย)</span>`;
            updateDailyRank();
        }

        // เกมค้าง (เฉพาะฝึกซ้อม — รายวันใช้ปุ่มด้านบน)
        const practice = resumable && resumable.saved.level !== 'daily' ? resumable : null;
        $('mmResume').hidden = !practice;
        // กดเริ่มเกมตอนมีเกมค้าง = ทิ้งเกมนั้น → บอกให้ชัดบนปุ่ม
        $('mmStart').textContent = practice ? 'เริ่มเกมใหม่ (ทิ้งเกมที่ค้าง)' : 'เริ่มเกม';
        if (practice) {
            const s = practice.saved;
            $('mmResumeInfo').textContent = `${C.LEVELS[s.level].label} · ${C.DECKS[s.deck].label} · ${practice.state.found}/${C.LEVELS[s.level].pairs} คู่ · ${C.formatTime(s.elapsedMs)}`;
        }

        $('mmLevels').innerHTML = ['easy', 'medium', 'hard'].map(id => {
            const L = C.LEVELS[id];
            const st = stats.levels[id] || {};
            const best = st.bestTimeMs ? `${C.formatTime(st.bestTimeMs)} · ${st.bestMoves} ครั้ง` : 'ยังไม่เคยเล่น';
            return `<button type="button" class="mm-opt" role="radio" aria-checked="${prefs.level === id}" data-level="${id}">
                <span class="mm-opt-name">${L.label}</span>
                <span class="mm-opt-sub">${L.rows}×${L.cols} · ${L.pairs} คู่</span>
                ${starsHtml(st.bestStars || 0)}
                <span class="mm-opt-best">${esc(best)}</span>
            </button>`;
        }).join('');

        $('mmDecks').innerHTML = C.DECK_IDS.map(id => {
            const deck = C.DECKS[id];
            return `<button type="button" class="mm-deck" role="radio" aria-checked="${prefs.deck === id}" data-deck="${id}">
                <img src="${FACE(id, deck.cards[0][0])}" alt="" loading="lazy" width="72" height="96"><span>${esc(deck.label)}</span>
            </button>`;
        }).join('');

        const best = ['easy', 'medium', 'hard'].reduce((acc, id) => acc + ((stats.levels[id] || {}).bestStars || 0), 0);
        $('mmStats').innerHTML = [
            [stats.totalStars, 'ดาวสะสม'],
            [streak, 'รายวันติดกัน'],
            [stats.daily.bestStreak || 0, 'ติดกันสูงสุด'],
            [`${best}/9`, 'ดาวทุกระดับ']
        ].map(([v, l]) => `<div class="mm-stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
    }

    let boardEntries = [];
    function renderBoard() {
        const list = $('mmBoard');
        if (!boardEntries.length) {
            list.innerHTML = '<li class="mm-empty">ยังไม่มีใครเล่นกระดานวันนี้ — เป็นคนแรกเลย</li>';
            return;
        }
        list.innerHTML = boardEntries.map(e => `<li class="mm-lb-row${e.playerId === BOOT.playerId ? ' is-me' : ''}">
            <span class="mm-lb-rank">${e.rank}</span>
            <span class="mm-lb-ava" aria-hidden="true">${esc(e.avatar || '👤')}</span>
            <span class="mm-lb-name">${esc(e.playerName)}</span>
            <span class="mm-lb-score">${esc(e.label)}</span>
        </li>`).join('');
        updateDailyRank();
    }
    function updateDailyRank() {
        const mine = boardEntries.find(e => e.playerId === BOOT.playerId);
        const rankEl = $('mmDailyRank');
        if (rankEl) rankEl.textContent = mine ? `อันดับ ${mine.rank} ของวันนี้` : '';
    }
    function fetchBoard() {
        return fetch('/api/solo/memory/leaderboard', { credentials: 'same-origin', cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(j => { if (j && Array.isArray(j.entries)) { boardEntries = j.entries; renderBoard(); } return boardEntries; })
            .catch(() => {
                if (!boardEntries.length) $('mmBoard').innerHTML = '<li class="mm-empty">โหลดอันดับไม่ได้ ลองใหม่ภายหลัง</li>';
                return boardEntries;
            });
    }

    // ---------- กระดาน ----------
    function buildBoard() {
        const grid = $('mmGrid');
        grid.innerHTML = '';
        cardEls = game.cards.map((key, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mm-card';
            btn.dataset.i = String(i);
            btn.style.setProperty('--i', String(i));
            btn.setAttribute('aria-label', `การ์ดคว่ำ ใบที่ ${i + 1}`);
            btn.innerHTML = `<span class="mm-card-inner"><span class="mm-face mm-back"></span><span class="mm-face mm-front"><img alt="" draggable="false" src="${FACE(game.deck, key)}"></span></span>`;
            grid.appendChild(btn);
            return btn;
        });
        game.matched.forEach((m, i) => { if (m) setCard(i, 'matched'); });
        layoutBoard();
    }
    function setCard(i, mode) {
        const el = cardEls[i];
        if (!el) return;
        el.classList.remove('is-miss');
        if (mode === 'up') el.classList.add('is-up');
        else if (mode === 'down') el.classList.remove('is-up');
        else if (mode === 'matched') { el.classList.add('is-matched'); el.classList.remove('is-up'); el.disabled = false; }
        else if (mode === 'miss') el.classList.add('is-miss');
        const up = el.classList.contains('is-up') || el.classList.contains('is-matched');
        const name = C.cardName(game.deck, game.cards[i]);
        el.setAttribute('aria-label', up ? `${name}${el.classList.contains('is-matched') ? ' (จับคู่แล้ว)' : ''}` : `การ์ดคว่ำ ใบที่ ${i + 1}`);
    }

    function layoutBoard() {
        if (!game || playEl.hidden) return;
        const stage = $('mmStage');
        const W = stage.clientWidth;
        const H = stage.clientHeight;
        if (!W || !H) return;
        const L = C.LEVELS[game.level];
        const gap = L.pairs >= 10 ? 7 : 9;
        const fit = (cols, rows) => {
            const byW = (W - gap * (cols - 1)) / cols;
            const byH = ((H - gap * (rows - 1)) / rows) * 0.75;
            return Math.min(byW, byH, 150);
        };
        // มือถือแนวตั้ง = ตามระดับ, จอกว้าง = กลับด้านให้การ์ดใหญ่ขึ้น
        const a = fit(L.cols, L.rows);
        const b = fit(L.rows, L.cols);
        const cols = b > a + 2 ? L.rows : L.cols;
        const cw = Math.floor(Math.max(a, b > a + 2 ? b : a));
        const grid = $('mmGrid');
        grid.style.setProperty('--cols', String(cols));
        grid.style.setProperty('--cw', cw + 'px');
        grid.style.setProperty('--ch', Math.floor(cw / 0.75) + 'px');
        grid.style.setProperty('--gap', gap + 'px');
        grid.style.setProperty('--radius', Math.max(7, Math.round(cw * 0.09)) + 'px');
    }

    function updateHud() {
        const L = C.LEVELS[game.level];
        $('mmMoves').textContent = String(game.moves);
        $('mmFound').textContent = `${game.found}/${L.pairs}`;
        $('mmBar').style.transform = `scaleX(${game.found / L.pairs})`;
        // ดาวที่ยังรักษาไว้ได้ (ครั้งต่อไปยังจบได้ไหม)
        const minFinish = game.moves + (L.pairs - game.found);
        const live = C.starsFor(game.level, minFinish);
        Array.from($('mmLiveStars').children).forEach((el, i) => el.classList.toggle('off', i >= live));
        $('mmLiveStars').setAttribute('aria-label', `ตอนนี้ยังได้ ${live} ดาว`);
        updateTime(true);
    }
    function updateTime(force) {
        const sec = Math.floor(elapsedMs() / 1000);
        if (!force && sec === lastShownSec) return;
        lastShownSec = sec;
        $('mmTime').textContent = C.formatTime(elapsedMs());
    }
    function tick() {
        updateTime(false);
        tickHandle = run && run.startedAt !== null ? requestAnimationFrame(tick) : null;
    }
    function startClock() {
        if (!run || run.finished || run.startedAt !== null) return;
        run.startedAt = performance.now();
        run.started = true;
        if (!tickHandle) tickHandle = requestAnimationFrame(tick);
    }
    function stopClock() {
        if (!run || run.startedAt === null) return;
        run.baseMs += performance.now() - run.startedAt;
        run.startedAt = null;
        if (tickHandle) cancelAnimationFrame(tickHandle);
        tickHandle = null;
    }

    let toastTimer = null;
    function toast(text) {
        const el = $('mmToast');
        el.textContent = text;
        el.classList.remove('is-on');
        void el.offsetWidth;
        el.classList.add('is-on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('is-on'), 1200);
    }

    function flushMiss() {
        if (missTimer) { clearTimeout(missTimer); missTimer = null; }
        if (game && game.open.length === 2) {
            const [a, b] = game.open;
            C.hideMiss(game);
            setCard(a, 'down');
            setCard(b, 'down');
        }
    }

    function onCardTap(i) {
        if (!game || !run || run.finished || run.paused) return;
        if (game.matched[i]) return;
        if (game.open.length === 2) flushMiss();
        if (game.open.indexOf(i) !== -1) return;
        startClock();
        const res = C.flip(game, i);
        if (res.event === 'ignored') return;
        setCard(i, 'up');
        haptic(8);
        if (res.event === 'match') {
            const [a, b] = res.pair;
            setCard(a, 'matched');
            setCard(b, 'matched');
            haptic(game.combo >= 2 ? [15, 40, 25] : 18);
            if (game.combo >= 2) toast(`คอมโบ ×${game.combo}  +${C.matchPoints(game.combo)}`);
            setTimeout(() => { [a, b].forEach(k => cardEls[k] && cardEls[k].classList.add('is-settled')); }, 1100);
        } else if (res.event === 'miss') {
            const [a, b] = res.pair;
            setCard(a, 'miss');
            setCard(b, 'miss');
            missTimer = setTimeout(flushMiss, MISS_HOLD_MS + (reduceMotion ? 0 : 200));
        }
        updateHud();
        persistGame();
        if (game.done) finish();
    }

    // ---------- เริ่ม/เล่นต่อ ----------
    async function startGame(levelId, seed, deckId, fromSave) {
        flushMiss();
        closeOverlay('mmResult');
        closeOverlay('mmPause');
        game = fromSave ? fromSave.state : C.newGame(levelId, seed, deckId);
        run = {
            runId: fromSave ? fromSave.saved.runId : randomId('r'),
            startedAt: null,
            baseMs: fromSave ? Math.max(0, Number(fromSave.saved.elapsedMs) || 0) : 0,
            started: fromSave ? !!fromSave.saved.started : false,
            paused: false,
            finished: false
        };
        lastShownSec = -1;
        const L = C.LEVELS[game.level];
        $('mmPlayLabel').textContent = `${game.level === 'daily' ? 'ประจำวัน' : L.label} · ${C.DECKS[game.deck].label}`;
        $('mmRestartBtn').hidden = game.level === 'daily';
        // รอภาพของสำรับให้พร้อมก่อน (ไม่เกิน 2.5 วิ) การ์ดจะได้ไม่เปิดมาเจอกรอบว่าง
        await Promise.race([preloadDeck(game.deck), new Promise(r => setTimeout(r, 2500))]);
        showScreen('play');
        buildBoard();
        updateHud();
        persistGame();
        if (fromSave && run.started) pause('เล่นต่อจากที่ค้างไว้');
    }
    function startPractice() {
        startGame(prefs.level, randomId('s'), prefs.deck);
    }
    function startDaily() {
        const t = todayInfo();
        if (dailyDoneToday()) return;
        const resumable = readSavedGame();
        if (resumable && resumable.saved.level === 'daily' && resumable.saved.seed === t.seed) return startGame(null, null, null, resumable);
        startGame('daily', t.seed, t.deck);
    }

    function pause(reason) {
        if (!run || run.finished || !game) return;
        stopClock();
        flushMiss();
        run.paused = true;
        persistGame();
        $('mmPauseTitle').textContent = reason || 'พักเกม';
        $('mmPauseInfo').textContent = `${C.formatTime(elapsedMs())} · ${game.moves} ครั้ง · จับได้ ${game.found}/${C.LEVELS[game.level].pairs} คู่`;
        openOverlay('mmPause');
    }
    function resume() {
        if (!run) return;
        closeOverlay('mmPause');
        run.paused = false;
        if (run.started) startClock();
    }

    // ---------- จบเกม + ส่งผล ----------
    function finish() {
        stopClock();
        run.finished = true;
        save(KEYS.game, null);
        const timeMs = Math.round(elapsedMs());
        const dailyDate = game.level === 'daily' ? C.dateFromDailySeed(game.seed) : null;
        const payload = {
            runId: run.runId, level: game.level, seed: game.seed, deck: game.deck,
            timeMs, moves: game.moves, log: game.log
        };
        const before = C.normalizeStats(stats);
        setStats(C.mergeStats(stats, {
            runId: run.runId, level: game.level, seed: game.seed, deck: game.deck, timeMs, moves: game.moves,
            score: game.score, bestCombo: game.bestCombo, dailyDate
        }));
        enqueue(payload);
        setSaveStatus('pending');
        setTimeout(() => showResult(payload, before), reduceMotion ? 150 : 700);
        flushQueue();
    }

    function showResult(p, before) {
        const stars = C.starsFor(p.level, p.moves);
        const prevLv = before.levels[p.level];
        const newTime = prevLv.bestTimeMs !== null && p.timeMs < prevLv.bestTimeMs;
        const newMoves = prevLv.bestMoves !== null && p.moves < prevLv.bestMoves;
        const starSvg = on => `<svg class="star" viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6l-6 3.3 1.3-6.7-5-4.7 6.8-.8z" fill="${on ? '#f5c86b' : '#3a4560'}" stroke="${on ? '#b98a35' : '#4a5572'}" stroke-width="1"/></svg>`;
        $('mmBigStars').innerHTML = [0, 1, 2].map(i => starSvg(i < stars)).join('');
        Array.from($('mmBigStars').children).forEach((el, i) => {
            el.classList.add(i < stars ? 'is-on' : 'is-dim');
            el.style.animationDelay = `${120 + i * 180}ms`;
        });
        const th = C.starThresholds(p.level);
        $('mmResultTitle').textContent = stars === 3 ? 'ความจำเป๊ะมาก!' : stars === 2 ? 'ครบทุกคู่!' : 'ผ่านแล้ว!';
        $('mmResultSub').textContent = p.level === 'daily'
            ? 'กระดานประจำวัน — พรุ่งนี้มีกระดานใหม่'
            : stars < 3 ? `3 ดาวต้องไม่เกิน ${th.three} ครั้ง` : `${C.LEVELS[p.level].label} · ${C.DECKS[p.deck].label}`;
        $('mmResultGrid').innerHTML = [
            [C.formatTimePrecise(p.timeMs), 'เวลา', newTime],
            [p.moves, 'ครั้ง', newMoves],
            [`×${game.bestCombo}`, 'คอมโบสูงสุด', false],
            [game.score.toLocaleString('th-TH'), 'คะแนน', false]
        ].map(([v, l, isNew]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span>${isNew ? '<br><span class="mm-badge">สถิติใหม่</span>' : ''}</div>`).join('');
        $('mmAgainBtn').textContent = p.level === 'daily' ? 'ฝึกต่อ (ระดับ' + C.LEVELS[prefs.level].label + ')' : 'เล่นอีกครั้ง';
        openOverlay('mmResult');
        haptic([20, 60, 30]);
    }

    function setSaveStatus(kind, message) {
        const el = $('mmSave');
        el.className = 'mm-save' + (kind === 'ok' ? ' is-ok' : kind === 'err' ? ' is-err' : '');
        el.textContent = kind === 'ok' ? (message || 'บันทึกผลแล้ว')
            : kind === 'err' ? message
            : kind === 'offline' ? 'ยังออฟไลน์อยู่ — จะบันทึกให้อัตโนมัติเมื่อเน็ตกลับมา'
            : 'กำลังบันทึกผล…';
    }

    // คิวส่งผล: เน็ตหลุด/เซิร์ฟเวอร์ล่ม = เก็บไว้ส่งใหม่ ไม่ขวางการเล่น
    function enqueue(payload) {
        const q = load(KEYS.queue, []);
        if (!q.some(x => x.runId === payload.runId)) q.push(payload);
        save(KEYS.queue, q.slice(-20));
    }
    let flushing = false;
    let retryTimer = null;
    let retryDelay = 4000;
    async function flushQueue() {
        if (flushing) return;
        const q = load(KEYS.queue, []);
        if (!q.length) return;
        flushing = true;
        let hadNetworkError = false;
        for (const payload of q) {
            let res = null;
            try {
                res = await fetch('/api/solo/memory/result', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e) { hadNetworkError = true; break; }
            let body = null;
            try { body = await res.json(); } catch (e) { body = null; }
            const isCurrent = run && run.runId === payload.runId;
            if (res.ok && body && body.success) {
                dropFromQueue(payload.runId);
                if (body.data) setStats(body.data);
                if (isCurrent) {
                    setSaveStatus('ok', payload.level === 'daily' ? 'บันทึกแล้ว — กำลังดูอันดับ…' : 'บันทึกผลแล้ว');
                    if (payload.level === 'daily') {
                        fetchBoard().then(entries => {
                            const mine = entries.find(e => e.playerId === BOOT.playerId);
                            if (run && run.runId === payload.runId) setSaveStatus('ok', mine ? `บันทึกแล้ว · อันดับ ${mine.rank} ของวันนี้` : 'บันทึกผลแล้ว');
                        });
                    }
                }
            } else if (res.status === 400 || res.status === 404) {
                // server ปฏิเสธ = ส่งซ้ำก็ไม่ผ่าน ทิ้งไป
                dropFromQueue(payload.runId);
                refreshStatsFromServer();
                if (isCurrent) setSaveStatus('err', `บันทึกไม่ได้: ${(body && body.error) || 'ข้อมูลไม่ถูกต้อง'}`);
            } else {
                hadNetworkError = true;
                if (isCurrent && res.status === 403) setSaveStatus('err', 'ยังไม่ได้ยืนยันตัวตน — จะลองบันทึกใหม่อัตโนมัติ');
                break;
            }
        }
        flushing = false;
        if (hadNetworkError) {
            if (run && run.finished && load(KEYS.queue, []).some(x => x.runId === run.runId) && $('mmSave').className.indexOf('is-err') === -1) setSaveStatus('offline');
            clearTimeout(retryTimer);
            retryTimer = setTimeout(flushQueue, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 60000);
        } else {
            retryDelay = 4000;
        }
    }
    function refreshStatsFromServer() {
        fetch('/api/solo/memory/stats', { credentials: 'same-origin', cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(j => { if (j && j.success && load(KEYS.queue, []).length === 0) { setStats(j.data); if (!menuEl.hidden) renderMenu(); } })
            .catch(() => {});
    }
    function dropFromQueue(runId) {
        save(KEYS.queue, load(KEYS.queue, []).filter(x => x.runId !== runId));
    }

    // ---------- วิธีเล่น ----------
    function openHow() { openOverlay('mmHow'); }
    function closeHow() { closeOverlay('mmHow'); save(KEYS.howto, 1); }

    // ---------- events ----------
    $('mmGrid').addEventListener('click', e => {
        const btn = e.target.closest('.mm-card');
        if (btn) onCardTap(Number(btn.dataset.i));
    });
    $('mmLevels').addEventListener('click', e => {
        const btn = e.target.closest('[data-level]');
        if (!btn) return;
        prefs.level = btn.dataset.level;
        save(KEYS.prefs, prefs);
        Array.from($('mmLevels').children).forEach(el => el.setAttribute('aria-checked', String(el === btn)));
    });
    $('mmDecks').addEventListener('click', e => {
        const btn = e.target.closest('[data-deck]');
        if (!btn) return;
        prefs.deck = btn.dataset.deck;
        save(KEYS.prefs, prefs);
        preloadDeck(prefs.deck);
        Array.from($('mmDecks').children).forEach(el => el.setAttribute('aria-checked', String(el === btn)));
    });
    // ลูกศรซ้าย/ขวาใน radiogroup
    ['mmLevels', 'mmDecks'].forEach(id => $(id).addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        const items = Array.from($(id).children);
        const idx = items.indexOf(document.activeElement);
        if (idx < 0) return;
        e.preventDefault();
        const next = items[(idx + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? items.length - 1 : 1)) % items.length];
        next.focus();
        next.click();
    }));
    $('mmStart').addEventListener('click', () => {
        const resumable = readSavedGame();
        if (resumable && resumable.saved.level !== 'daily') save(KEYS.game, null); // เริ่มใหม่ = ทิ้งเกมค้าง
        startPractice();
    });
    $('mmDailyBtn').addEventListener('click', startDaily);
    $('mmResumeGo').addEventListener('click', () => { const r = readSavedGame(); if (r) startGame(null, null, null, r); });
    $('mmResumeDrop').addEventListener('click', () => { save(KEYS.game, null); renderMenu(); });
    $('mmPauseBtn').addEventListener('click', () => pause());
    $('mmResumeBtn').addEventListener('click', resume);
    $('mmRestartBtn').addEventListener('click', () => {
        if (!game || game.level === 'daily') return;
        save(KEYS.game, null);
        startGame(game.level, randomId('s'), game.deck);
    });
    $('mmQuitBtn').addEventListener('click', () => {
        persistGame();
        closeOverlay('mmPause');
        stopClock();
        game = null; run = null;
        showScreen('menu');
    });
    $('mmAgainBtn').addEventListener('click', () => {
        if (game && game.level !== 'daily') startGame(game.level, randomId('s'), game.deck);
        else startPractice();
    });
    $('mmMenuBtn').addEventListener('click', () => {
        closeOverlay('mmResult');
        game = null; run = null;
        showScreen('menu');
        fetchBoard();
    });
    $('mmHowBtn').addEventListener('click', openHow);
    $('mmHowOk').addEventListener('click', closeHow);
    $('mmHowSkip').addEventListener('click', closeHow);
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (!$('mmHow').hidden) closeHow();
        else if (!$('mmPause').hidden) resume();
        else if (game && run && !run.finished && !playEl.hidden) pause();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && game && run && !run.finished && !run.paused && run.started) pause();
        else if (document.hidden) persistGame();
    });
    window.addEventListener('pagehide', persistGame);
    window.addEventListener('online', () => { retryDelay = 4000; flushQueue(); });
    window.addEventListener('resize', () => { measureFooter(); layoutBoard(); });
    if (window.ResizeObserver) new ResizeObserver(() => layoutBoard()).observe($('mmStage'));

    // ---------- boot ----------
    setInterval(tickDaily, 1000);
    renderMenu();
    renderBoard();
    fetchBoard();
    flushQueue();
    preloadDeck(prefs.deck);
    preloadDeck(todayInfo().deck);
    const resumable = readSavedGame();
    if (resumable) {
        // รีเฟรชกลางเกม → กลับเข้ากระดานเดิมทันที (หยุดเวลาไว้จนกดเล่นต่อ)
        startGame(null, null, null, resumable);
    } else if (!load(KEYS.howto, null)) {
        openHow();
    }
})();
