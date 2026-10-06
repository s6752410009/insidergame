/* ไพ่โซลิแทร์ — หน้าเล่น (DOM + การควบคุม) กติกาทั้งหมดอยู่ใน solitaire-engine.js */
(function () {
    'use strict';

    const E = window.SolitaireEngine;
    const SEEDS = window.SolitaireSeeds || { 1: [], 3: [] };
    const BOOT = window.SOLITAIRE_BOOT || {};
    const ASSETS = BOOT.assets || '/assets/games/poker/';
    const KEY_GAME = 'solitaire:v1:game';
    const KEY_PREFS = 'solitaire:v1:prefs';
    const KEY_QUEUE = 'solitaire:v1:queue';
    const KEY_RECENT = 'solitaire:v1:recentSeeds';
    const KEY_INTRO = 'solitaire:v1:intro';
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const $ = id => document.getElementById(id);
    const board = $('solBoard');
    const els = {
        time: $('solTime'), moves: $('solMoves'), mode: $('solMode'),
        undo: $('solUndo'), hint: $('solHint'), newBtn: $('solNew'), help: $('solHelp'),
        auto: $('solAuto'), toast: $('solToast')
    };

    // ------------------------------------------------------------ storage
    function load(key, fallback) {
        try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }
    function save(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* โหมดส่วนตัว/เต็ม — เล่นต่อได้ */ }
    }
    function randomId() {
        const bytes = new Uint8Array(8);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    function randomSeed() {
        const buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        return buf[0] >>> 0;
    }
    function fmt(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
        return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    }
    function haptic(p) { if (typeof window.gameHaptic === 'function') window.gameHaptic(p); }

    const prefs = Object.assign({ draw: 1, deal: 'winnable' }, load(KEY_PREFS, {}));
    if (!E.isValidDraw(prefs.draw)) prefs.draw = 1;
    if (prefs.deal !== 'random') prefs.deal = 'winnable';

    // ------------------------------------------------------------ game state
    let game = null;   // { id, seed, draw, deal, log, elapsed, won, reported }
    let state = null;  // สถานะจาก engine (replay ของ game.log)
    let runningSince = null;
    let busy = false;  // ระหว่างเก็บไพ่อัตโนมัติ / ฉลองชัย
    let stuckShownAt = -1;

    function pickSeed(draw, deal) {
        if (deal === 'winnable' && SEEDS[draw] && SEEDS[draw].length) {
            const recent = load(KEY_RECENT, []);
            const pool = SEEDS[draw].filter(s => recent.indexOf(draw + ':' + s) < 0);
            const list = pool.length ? pool : SEEDS[draw];
            const seed = list[Math.floor(Math.random() * list.length)];
            save(KEY_RECENT, recent.concat(draw + ':' + seed).slice(-60));
            return seed;
        }
        return randomSeed();
    }

    function elapsedNow() {
        return game.elapsed + (runningSince != null ? performance.now() - runningSince : 0);
    }
    function pauseClock() {
        if (runningSince != null) { game.elapsed = elapsedNow(); runningSince = null; }
    }
    function startClock() {
        if (runningSince == null && game && !game.won && game.log.length && document.visibilityState !== 'hidden') runningSince = performance.now();
    }
    function persist() {
        if (!game) return;
        save(KEY_GAME, Object.assign({}, game, { elapsed: Math.round(elapsedNow()) }));
    }

    function newGame(draw, deal) {
        pauseClock();
        if (game && !game.won && game.log.length) {
            enqueue({ gameId: game.id, outcome: 'loss', draw: game.draw, seed: game.seed, timeMs: Math.round(game.elapsed), moves: game.log.length / 3, deal: game.deal });
        }
        game = { id: randomId(), seed: pickSeed(draw, deal), draw, deal, log: '', elapsed: 0, won: false };
        state = E.deal(game.seed, game.draw);
        stuckShownAt = -1;
        persist();
        renderAll({ deal: true });
    }

    function restore() {
        const saved = load(KEY_GAME, null);
        if (!saved || saved.won || !E.isValidSeed(saved.seed) || !E.isValidDraw(saved.draw)) return false;
        const r = E.replay(saved.seed, saved.draw, saved.log || '');
        if (!r.ok) return false;
        game = { id: String(saved.id || randomId()), seed: saved.seed, draw: saved.draw, deal: saved.deal === 'random' ? 'random' : 'winnable', log: saved.log || '', elapsed: Number(saved.elapsed) || 0, won: false };
        state = r.state;
        renderAll({ instant: true });
        startClock();
        return true;
    }

    // ------------------------------------------------------------ DOM: slots + cards
    const cardEls = [];
    const slot = { stock: null, f: [], t: [], waste: null };
    let stockCount = null;
    let geo = null;

    function makeSlot(cls, label) {
        const el = document.createElement('div');
        el.className = 'sol-slot ' + cls;
        if (label) el.textContent = label;
        board.appendChild(el);
        return el;
    }
    function buildBoard() {
        slot.stock = makeSlot('sol-stock', '');
        slot.stock.setAttribute('role', 'button');
        slot.stock.setAttribute('aria-label', 'จั่วไพ่');
        slot.stock.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>';
        stockCount = document.createElement('span');
        stockCount.className = 'sol-stock-count';
        board.appendChild(stockCount);
        slot.waste = makeSlot('sol-waste-slot', '');
        slot.waste.style.opacity = '0.5';
        for (let i = 0; i < 4; i++) {
            const el = makeSlot('sol-f', E.SUIT_SYMBOLS[i]);
            if (i === 1 || i === 3) el.style.color = 'oklch(0.7 0.14 20 / 0.5)';
            slot.f.push(el);
        }
        for (let i = 0; i < 7; i++) slot.t.push(makeSlot('sol-t', 'K'));
        for (let c = 0; c < 52; c++) {
            const el = document.createElement('div');
            el.className = 'sol-card is-down' + (E.isRed(c) ? ' is-red' : '');
            el.dataset.card = String(c);
            const r = E.RANK_LABELS[E.rankOf(c)];
            el.innerHTML =
                '<div class="sol-card-in">' +
                '<div class="sol-face"><img src="' + ASSETS + E.cardFile(c) + '" alt="" draggable="false" decoding="async"><span class="sol-idx">' + r + '<i>' + E.SUIT_SYMBOLS[E.suitOf(c)] + '</i></span></div>' +
                '<div class="sol-back"><img src="' + ASSETS + 'back.svg" alt="" draggable="false" decoding="async"></div>' +
                '</div>';
            board.appendChild(el);
            cardEls.push(el);
        }
    }

    /** คำนวณขนาดไพ่ + ตำแหน่งกองต่าง ๆ จากความกว้างโต๊ะ */
    function computeGeometry() {
        const width = board.clientWidth;
        const pad = width < 480 ? 6 : 12;
        const gap = width < 480 ? 5 : 10;
        const cw = Math.floor(Math.min(104, (width - pad * 2 - gap * 6) / 7));
        const ch = Math.round(cw * 1.4);
        const colX = i => pad + i * (cw + gap) + Math.floor((width - pad * 2 - (cw * 7 + gap * 6)) / 2);
        const topY = pad;
        const tabY = topY + ch + Math.max(10, Math.round(cw * 0.22));
        // ความสูงที่มีให้บนจอ (โต๊ะ + ปุ่มควบคุม + footer ต้องอยู่ในจอเดียว)
        const boardTop = board.getBoundingClientRect().top + window.scrollY;
        const reserved = 64 + 84; // แถวปุ่ม + footer นำทาง
        const viewH = window.innerHeight;
        const avail = Math.max(ch * 4.2, viewH - boardTop - reserved);
        return {
            cw, ch, pad, gap, colX, topY, tabY,
            downOff: Math.max(5, Math.round(cw * 0.13)),
            upOff: Math.round(cw * 0.36),
            minUp: Math.max(12, Math.round(cw * 0.24)),
            fanOff: Math.round(Math.min(cw * 0.45, (cw + gap * 2) / 2)),
            maxH: Math.max(tabY + ch * 3, Math.floor(avail))
        };
    }

    function pileOffsets(i) {
        const p = state.t[i];
        const hidden = state.h[i];
        const up = p.length - hidden;
        let upOff = geo.upOff;
        if (up > 1) {
            const room = geo.maxH - geo.pad - geo.tabY - geo.ch - hidden * geo.downOff;
            upOff = Math.max(geo.minUp, Math.min(geo.upOff, Math.floor(room / (up - 1))));
        }
        const ys = [];
        let y = geo.tabY;
        for (let k = 0; k < p.length; k++) {
            ys.push(y);
            y += k < hidden ? geo.downOff : upOff;
        }
        return ys;
    }

    /** ตำแหน่งปลายทางของไพ่ทุกใบตามสถานะตอนนี้ */
    function positions() {
        const pos = new Array(52);
        const g = geo;
        state.stock.forEach((c, k) => { pos[c] = { x: g.colX(0), y: g.topY, z: 10 + k, up: false, zone: 's', idx: k }; });
        const wx = g.colX(1);
        const w = state.waste;
        const fanFrom = state.draw === 3 ? Math.max(0, w.length - 3) : w.length;
        w.forEach((c, k) => {
            const fan = k >= fanFrom ? (k - fanFrom) * g.fanOff : 0;
            pos[c] = { x: wx + fan, y: g.topY, z: 100 + k, up: true, zone: 'w', idx: k };
        });
        for (let s = 0; s < 4; s++) {
            for (let r = 1; r <= state.f[s]; r++) {
                pos[s * 13 + r - 1] = { x: g.colX(3 + s), y: g.topY, z: 200 + r, up: true, zone: 'f', suit: s };
            }
        }
        for (let i = 0; i < 7; i++) {
            const ys = pileOffsets(i);
            state.t[i].forEach((c, k) => { pos[c] = { x: g.colX(i), y: ys[k], z: 300 + k, up: k >= state.h[i], zone: 't', pile: i, idx: k }; });
        }
        return pos;
    }

    let lastPos = null;
    function render(opts) {
        opts = opts || {};
        geo = computeGeometry();
        board.style.setProperty('--cw', geo.cw + 'px');
        board.style.setProperty('--ch', geo.ch + 'px');
        document.getElementById('sol').style.setProperty('--cw', geo.cw + 'px');
        const place = (el, x, y) => { el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
        place(slot.stock, geo.colX(0), geo.topY);
        place(slot.waste, geo.colX(1), geo.topY);
        slot.f.forEach((el, s) => place(el, geo.colX(3 + s), geo.topY));
        slot.t.forEach((el, i) => place(el, geo.colX(i), geo.tabY));
        stockCount.style.transform = 'translate(' + (geo.colX(0) + geo.cw - 18) + 'px,' + (geo.topY + geo.ch - 14) + 'px)';
        stockCount.textContent = String(state.stock.length);
        stockCount.hidden = state.stock.length === 0;
        slot.stock.classList.toggle('can-recycle', !state.stock.length && state.waste.length > 0);
        slot.stock.setAttribute('aria-label', state.stock.length ? 'จั่วไพ่ (เหลือ ' + state.stock.length + ' ใบ)' : 'วนกองเปิดกลับ');

        const pos = positions();
        let maxBottom = geo.tabY + geo.ch;
        for (let c = 0; c < 52; c++) {
            const p = pos[c];
            const el = cardEls[c];
            const prev = lastPos && lastPos[c];
            const moved = !prev || prev.x !== p.x || prev.y !== p.y;
            if (opts.instant) el.classList.add('no-anim');
            else el.classList.remove('no-anim');
            if (opts.deal && !opts.instant) {
                el.classList.add('no-anim');
                place(el, geo.colX(0), geo.topY);
                el.classList.add('is-down');
            }
            if (moved && prev && !opts.instant) {
                el.style.zIndex = String(1000 + p.z); // บินข้ามกองอื่น แล้วค่อยลดลง
                clearTimeout(el._zt);
                el._zt = setTimeout(() => { el.style.zIndex = String(p.z); }, 280);
            } else {
                el.style.zIndex = String(p.z);
            }
            if (p.zone === 't') maxBottom = Math.max(maxBottom, p.y + geo.ch);
        }
        if (opts.deal && !opts.instant) void board.offsetWidth; // ให้ตำแหน่งเริ่มที่กองคว่ำมีผลก่อน
        let dealOrder = 0;
        for (let c = 0; c < 52; c++) {
            const p = pos[c];
            const el = cardEls[c];
            if (opts.deal && !opts.instant) {
                el.classList.remove('no-anim');
                if (p.zone === 't' && !reduceMotion) {
                    const delay = (p.idx * 7 + p.pile - (p.idx * (p.idx + 1)) / 2) * 32;
                    dealOrder = Math.max(dealOrder, delay);
                    el.style.transitionDelay = delay + 'ms';
                    setTimeout(() => { el.style.transitionDelay = ''; el.classList.toggle('is-down', !p.up); }, delay + 200);
                    place(el, p.x, p.y);
                    continue;
                }
            }
            place(el, p.x, p.y);
            el.classList.toggle('is-down', !p.up);
            el.setAttribute('aria-label', p.up ? E.cardThai(c) : 'ไพ่คว่ำ');
        }
        board.style.height = Math.max(geo.maxH, maxBottom + geo.pad) + 'px';
        if (opts.instant) {
            void board.offsetWidth;
            cardEls.forEach(el => el.classList.remove('no-anim'));
        }
        lastPos = pos;
    }

    function updateHud() {
        els.moves.textContent = String(game.log.length / 3);
        els.time.textContent = fmt(elapsedNow());
        els.mode.textContent = 'จั่ว ' + game.draw + ' ใบ · ' + (game.deal === 'winnable' ? 'ชนะได้แน่นอน' : 'สุ่มล้วน');
        els.undo.disabled = !game.log.length || game.won || busy;
        els.hint.disabled = game.won || busy;
        const canAuto = !game.won && !busy && E.allRevealed(state) && !!E.autoCompletePlan(state);
        els.auto.classList.toggle('is-on', canAuto);
        els.auto.tabIndex = canAuto ? 0 : -1;
    }

    function renderAll(opts) {
        render(opts);
        updateHud();
    }

    // ------------------------------------------------------------ moves
    function commit(move, opts) {
        const next = E.applyMove(state, move);
        if (!next) return false;
        const firstMove = !game.log.length;
        state = next;
        game.log += E.encodeMove(move);
        if (firstMove) startClock();
        persist();
        render();
        updateHud();
        if (!(opts && opts.quiet)) haptic(8);
        if (E.isWon(state)) onWin();
        else if (!(opts && opts.quiet)) checkStuck();
        return true;
    }

    function undo() {
        if (busy || !game.log.length || game.won) return;
        const log = game.log.slice(0, -3);
        const r = E.replay(game.seed, game.draw, log);
        if (!r.ok) return;
        game.log = log;
        state = r.state;
        stuckShownAt = -1;
        persist();
        renderAll();
    }

    function toast(text, ms) {
        els.toast.textContent = text;
        els.toast.classList.add('is-on');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => els.toast.classList.remove('is-on'), ms || 1800);
    }

    function flash(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 1600);
    }

    function showHint() {
        if (busy || game.won) return;
        const mv = E.hint(state);
        if (!mv) { toast('ไม่มีทางไปต่อแล้ว ลองย้อนหรือแจกใหม่'); return; }
        if (mv.draw) {
            flash(slot.stock, 'is-hint');
            const top = state.stock.length ? state.stock[state.stock.length - 1] : null;
            if (top != null) flash(cardEls[top], 'is-hint');
            toast(state.stock.length ? 'แตะกองคว่ำเพื่อจั่ว' : 'แตะเพื่อวนกองเปิดกลับ');
            return;
        }
        let cards = [];
        if (mv.from === 'w') cards = [state.waste[state.waste.length - 1]];
        else if (typeof mv.from === 'number') cards = state.t[mv.from].slice(state.t[mv.from].length - mv.n);
        else { const s = E.FOUNDATION_CODES.indexOf(mv.from); cards = [s * 13 + state.f[s] - 1]; }
        cards.forEach(c => flash(cardEls[c], 'is-hint'));
        if (mv.to === 'F') {
            const s = E.suitOf(cards[0]);
            if (state.f[s]) flash(cardEls[s * 13 + state.f[s] - 1], 'is-hint'); else flash(slot.f[s], 'is-hint');
        } else {
            const p = state.t[mv.to];
            if (p.length) flash(cardEls[p[p.length - 1]], 'is-hint'); else flash(slot.t[mv.to], 'is-hint');
        }
    }

    function checkStuck() {
        if (game.won || busy) return;
        const moves = game.log.length / 3;
        if (stuckShownAt === moves) return;
        if (!E.hasProgress(state)) {
            stuckShownAt = moves;
            setTimeout(() => { if (!game.won && !E.hasProgress(state)) openDialog('dlgStuck'); }, 450);
        }
    }

    function drawStock() {
        if (busy || game.won) return;
        if (!state.stock.length && !state.waste.length) return;
        commit({ draw: true });
    }

    function locate(c) {
        const p = lastPos && lastPos[c];
        return p || null;
    }

    function tapCard(c) {
        const p = locate(c);
        if (!p || busy || game.won) return;
        if (p.zone === 's') { drawStock(); return; }
        // แตะแล้วต้องรู้ว่าแตะติด: ไพ่ที่ยังขยับไม่ได้ก็สั่นให้เห็น + บอกเหตุผล
        if (!p.up) { flash(cardEls[c], 'is-nope'); toast('ไพ่คว่ำ — ย้ายใบที่ทับอยู่ออกก่อน แล้วจะหงายเอง'); return; }
        let from, index = 0;
        if (p.zone === 'w') {
            if (p.idx !== state.waste.length - 1) { flash(cardEls[c], 'is-nope'); toast('ใช้ได้เฉพาะใบบนสุดของกองเปิด'); return; }
            from = 'w';
        }
        else if (p.zone === 'f') { from = E.FOUNDATION_CODES[p.suit]; if (state.f[p.suit] !== E.rankOf(c)) return; }
        else { from = p.pile; index = p.idx; }
        const mv = E.autoMoveFor(state, from, index);
        if (mv) commit(mv);
        else { flash(cardEls[c], 'is-nope'); haptic(20); }
    }

    // ------------------------------------------------------------ drag & drop
    let drag = null;

    function dragStack(c) {
        const p = locate(c);
        if (!p || !p.up) return null;
        if (p.zone === 'w') return p.idx === state.waste.length - 1 ? { from: 'w', cards: [c] } : null;
        if (p.zone === 'f') return state.f[p.suit] === E.rankOf(c) ? { from: E.FOUNDATION_CODES[p.suit], cards: [c] } : null;
        if (p.zone === 't') return { from: p.pile, cards: state.t[p.pile].slice(p.idx) };
        return null;
    }

    function dropTargets(stack) {
        const out = [];
        const n = stack.cards.length;
        if (n === 1) {
            const s = E.suitOf(stack.cards[0]);
            out.push({ to: 'F', x: geo.colX(3), y: geo.topY, w: geo.colX(6) + geo.cw - geo.colX(3), h: geo.ch, mark: () => state.f[s] ? cardEls[s * 13 + state.f[s] - 1] : slot.f[s] });
        }
        for (let i = 0; i < 7; i++) {
            if (i === stack.from) continue;
            const p = state.t[i];
            const ys = pileOffsets(i);
            const bottom = p.length ? ys[p.length - 1] + geo.ch : geo.tabY + geo.ch;
            out.push({ to: i, x: geo.colX(i) - geo.gap / 2, y: geo.tabY - 6, w: geo.cw + geo.gap, h: Math.max(bottom - geo.tabY, geo.ch) + geo.ch * 0.6, mark: () => p.length ? cardEls[p[p.length - 1]] : slot.t[i] });
        }
        return out;
    }

    function pickTarget(stack, rect) {
        // rect = ตำแหน่งไพ่ใบบนสุดของชุดที่ลาก (พิกัดในโต๊ะ)
        let best = null, bestArea = 0;
        dropTargets(stack).forEach(t => {
            const mv = { from: stack.from, to: t.to, n: stack.cards.length };
            if (!E.isLegal(state, mv)) return;
            const ix = Math.min(rect.x + rect.w, t.x + t.w) - Math.max(rect.x, t.x);
            const iy = Math.min(rect.y + rect.h, t.y + t.h) - Math.max(rect.y, t.y);
            const area = ix > 0 && iy > 0 ? ix * iy : 0;
            if (area > bestArea) { bestArea = area; best = { mv, t }; }
        });
        return best;
    }

    let markedEl = null;
    function markTarget(el) {
        if (markedEl === el) return;
        if (markedEl) markedEl.classList.remove('is-target');
        markedEl = el;
        if (el && el.classList.contains('sol-slot')) el.classList.add('is-target');
        else markedEl = null;
    }

    function onPointerDown(ev) {
        if (busy || game.won || drag) return;
        if (ev.button != null && ev.button !== 0) return;
        const cardEl = ev.target.closest('.sol-card');
        const stockHit = ev.target.closest('.sol-stock');
        if (!cardEl && !stockHit) return;
        const c = cardEl ? Number(cardEl.dataset.card) : -1;
        drag = { id: ev.pointerId, c, sx: ev.clientX, sy: ev.clientY, moved: false, stack: null, stockOnly: !cardEl };
        try { board.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }

    function onPointerMove(ev) {
        if (!drag || ev.pointerId !== drag.id || drag.stockOnly) return;
        const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
        if (!drag.moved) {
            if (Math.abs(dx) + Math.abs(dy) < 7) return;
            const stack = dragStack(drag.c);
            if (!stack) { drag.stockOnly = true; return; }
            drag.moved = true;
            drag.stack = stack;
            drag.base = stack.cards.map(c => ({ c, x: lastPos[c].x, y: lastPos[c].y }));
            stack.cards.forEach((c, k) => {
                const el = cardEls[c];
                el.classList.add('is-dragging');
                clearTimeout(el._zt);
                el.style.zIndex = String(2000 + k);
            });
        }
        drag.dx = dx; drag.dy = dy;
        drag.base.forEach(b => { cardEls[b.c].style.transform = 'translate(' + (b.x + dx) + 'px,' + (b.y + dy) + 'px)'; });
        const b0 = drag.base[0];
        const hit = pickTarget(drag.stack, { x: b0.x + dx, y: b0.y + dy, w: geo.cw, h: geo.ch });
        markTarget(hit ? hit.t.mark() : null);
        ev.preventDefault();
    }

    function endDrag(ev, cancelled) {
        if (!drag || ev.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        markTarget(null);
        if (!d.moved) {
            if (cancelled) return;
            if (d.c >= 0) tapCard(d.c);
            else drawStock();
            return;
        }
        d.stack.cards.forEach(c => cardEls[c].classList.remove('is-dragging'));
        if (!cancelled) {
            const b0 = d.base[0];
            const hit = pickTarget(d.stack, { x: b0.x + d.dx, y: b0.y + d.dy, w: geo.cw, h: geo.ch });
            if (hit && commit(hit.mv)) return;
        }
        render(); // ไม่มีที่วาง → เด้งกลับที่เดิม
        d.stack.cards.forEach(c => { cardEls[c].style.zIndex = String(3000); clearTimeout(cardEls[c]._zt); cardEls[c]._zt = setTimeout(() => { cardEls[c].style.zIndex = String(lastPos[c].z); }, 260); });
    }

    // ------------------------------------------------------------ auto-complete
    function autoComplete() {
        if (busy || game.won) return;
        const plan = E.autoCompletePlan(state);
        if (!plan) return;
        busy = true;
        updateHud();
        els.auto.classList.remove('is-on');
        let i = 0;
        const step = () => {
            if (i >= plan.length || game.won) { busy = false; updateHud(); return; }
            const mv = plan[i++];
            if (!commit(mv, { quiet: true })) { busy = false; updateHud(); return; }
            if (game.won) { busy = false; return; }
            setTimeout(step, reduceMotion ? 10 : 70);
        };
        step();
    }

    // ------------------------------------------------------------ win
    function onWin() {
        pauseClock();
        game.won = true;
        const timeMs = Math.round(game.elapsed);
        const moves = game.log.length / 3;
        persist();
        updateHud();
        haptic([20, 60, 30]);
        const before = stats ? stats.modes && stats.modes[game.draw] : null;
        const isBest = !before || before.bestMs == null || timeMs < before.bestMs;
        enqueue({ gameId: game.id, outcome: 'win', draw: game.draw, seed: game.seed, timeMs, moves, log: game.log, deal: game.deal }, true);
        $('winTime').textContent = fmt(timeMs);
        $('winMoves').textContent = String(moves);
        $('winStreak').textContent = String(((stats && stats.streak) || 0) + 1);
        $('winBadge').hidden = !isBest || !(before && before.wins);
        $('winSave').textContent = 'กำลังบันทึกผล…';
        const cascadeMs = reduceMotion ? 0 : cascade();
        setTimeout(() => openDialog('dlgWin'), reduceMotion ? 250 : cascadeMs);
    }

    let cascadeLayer = null;
    function stopCascade() {
        if (cascadeLayer) { cascadeLayer.remove(); cascadeLayer = null; }
    }
    /** ไพ่เด้งลงจากช่องเก็บแบบโซลิแทร์คลาสสิก — ใช้แค่ transform */
    function cascade() {
        stopCascade();
        const layer = document.createElement('div');
        layer.className = 'sol-cascade';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
        cascadeLayer = layer;
        const rect = board.getBoundingClientRect();
        const W = window.innerWidth, H = window.innerHeight;
        const floor = Math.min(H, rect.bottom) - geo.ch;
        const order = [];
        for (let r = 13; r >= 1; r--) for (let s = 0; s < 4; s++) order.push({ c: s * 13 + r - 1, s });
        const stagger = 110;
        let total = 0;
        const ghosts = W < 600 ? 1 : 2;
        order.forEach((o, k) => {
            const x0 = rect.left + geo.colX(3 + o.s), y0 = rect.top + geo.topY;
            let x = x0, y = y0;
            let vx = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 4.5);
            let vy = -Math.random() * 7;
            const frames = [];
            for (let f = 0; f < 240; f++) {
                frames.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)' });
                vy += 0.55; x += vx; y += vy;
                if (y > floor) { y = floor; vy = -vy * 0.72; }
                if (x < -geo.cw - 10 || x > W + 10) break;
            }
            const duration = frames.length * 16;
            total = Math.max(total, k * stagger + duration);
            for (let g = ghosts; g >= 0; g--) {
                const img = document.createElement('img');
                img.src = ASSETS + E.cardFile(o.c);
                img.alt = '';
                img.style.width = geo.cw + 'px';
                img.style.height = geo.ch + 'px';
                img.style.opacity = '0';
                layer.appendChild(img);
                const anim = img.animate(frames, { duration, delay: k * stagger + g * 45, easing: 'linear', fill: 'forwards' });
                img.animate([{ opacity: g ? 0.35 / g : 1 }, { opacity: g ? 0.35 / g : 1 }], { duration, delay: k * stagger + g * 45, fill: 'forwards' });
                anim.onfinish = () => img.remove();
            }
        });
        setTimeout(() => { if (cascadeLayer === layer) stopCascade(); }, total + 400);
        return 1700;
    }

    // ------------------------------------------------------------ results queue
    let stats = BOOT.data || null;
    let flushing = false;
    let retryTimer = null;
    let retryDelay = 4000;

    function enqueue(payload, isWinNow) {
        const q = load(KEY_QUEUE, []);
        if (!q.some(p => p.gameId === payload.gameId)) q.push(payload);
        save(KEY_QUEUE, q.slice(-30));
        flush(isWinNow ? payload.gameId : null);
    }

    function setWinSave(gameId, text) {
        if (game && game.id === gameId && game.won) $('winSave').textContent = text;
    }

    async function flush(watchId) {
        if (flushing) return;
        flushing = true;
        clearTimeout(retryTimer);
        try {
            let q = load(KEY_QUEUE, []);
            while (q.length) {
                const item = q[0];
                let res;
                try {
                    res = await fetch('/api/solo/solitaire/result', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify(item)
                    });
                } catch (e) {
                    res = null;
                }
                if (res && res.ok) {
                    const body = await res.json().catch(() => null);
                    if (body && body.data) { stats = body.data; renderStats(); }
                    if (item.outcome === 'win') { setWinSave(item.gameId, 'บันทึกผลแล้ว'); loadLeaderboard(); }
                } else if (res && res.status === 400) {
                    const body = await res.json().catch(() => null);
                    if (item.outcome === 'win') setWinSave(item.gameId, 'บันทึกไม่ได้: ' + ((body && body.error) || 'ข้อมูลไม่ถูกต้อง'));
                } else {
                    if (item.outcome === 'win') setWinSave(item.gameId, 'ยังบันทึกไม่ได้ จะลองส่งให้อีกครั้งเอง');
                    retryTimer = setTimeout(() => flush(), retryDelay);
                    retryDelay = Math.min(retryDelay * 2, 120000);
                    break;
                }
                retryDelay = 4000;
                q = load(KEY_QUEUE, []).filter(p => p.gameId !== item.gameId);
                save(KEY_QUEUE, q);
            }
        } finally {
            flushing = false;
        }
    }

    // ------------------------------------------------------------ stats + leaderboard
    function renderStats() {
        const d = stats || {};
        const m = d.modes || {};
        $('stWins').textContent = (d.wins || 0) + ' / ' + (d.games || 0);
        $('stStreak').textContent = String(d.streak || 0) + (d.bestStreak ? ' (สูงสุด ' + d.bestStreak + ')' : '');
        $('stBest1').textContent = m[1] && m[1].bestMs != null ? fmt(m[1].bestMs) : '–';
        $('stBest3').textContent = m[3] && m[3].bestMs != null ? fmt(m[3].bestMs) : '–';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    async function loadLeaderboard() {
        const list = $('solLb');
        try {
            const res = await fetch('/api/solo/solitaire/leaderboard', { credentials: 'same-origin' });
            const body = await res.json();
            const entries = (body && body.entries) || [];
            if (!entries.length) {
                list.innerHTML = '<li><span></span><span></span><span class="sol-empty">ยังไม่มีใครติดอันดับ ชนะคนแรกเลย</span><span></span></li>';
                return;
            }
            list.innerHTML = entries.map(e =>
                '<li class="' + (e.playerId === BOOT.playerId ? 'is-me' : '') + '">' +
                '<span class="sol-rank">' + e.rank + '</span>' +
                '<span class="sol-ava" aria-hidden="true">' + escapeHtml(e.avatar || '👤') + '</span>' +
                '<span class="sol-name">' + escapeHtml(e.playerName || 'ผู้เล่น') + '</span>' +
                '<span class="sol-time">' + escapeHtml(e.label) + '</span></li>'
            ).join('');
        } catch (e) {
            list.innerHTML = '<li><span></span><span></span><span class="sol-empty">โหลดอันดับไม่ได้ (ออฟไลน์?)</span><span></span></li>';
        }
    }

    // ------------------------------------------------------------ dialogs
    function openDialog(id) {
        const dlg = $(id);
        if (!dlg || dlg.open) return;
        dlg.returnValue = ''; // ค่าจากครั้งก่อนห้ามค้าง (ปิดด้วย Esc/ปุ่มย้อนกลับ ต้องได้ '' เสมอ)
        document.querySelectorAll('dialog[open]').forEach(d => { if (d !== dlg) d.close('replaced'); });
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    }

    const pending = { draw: prefs.draw, deal: prefs.deal };
    function syncSeg() {
        document.querySelectorAll('#dlgNew [data-draw]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.draw) === pending.draw)));
        document.querySelectorAll('#dlgNew [data-deal]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.deal === pending.deal)));
    }
    function openNew() {
        pending.draw = game ? game.draw : prefs.draw;
        pending.deal = game ? game.deal : prefs.deal;
        syncSeg();
        $('newWarn').hidden = !(game && !game.won && game.log.length);
        openDialog('dlgNew');
    }

    function wire() {
        board.addEventListener('pointerdown', onPointerDown);
        board.addEventListener('pointermove', onPointerMove);
        board.addEventListener('pointerup', ev => endDrag(ev, false));
        board.addEventListener('pointercancel', ev => endDrag(ev, true));
        board.addEventListener('lostpointercapture', ev => { if (drag && drag.id === ev.pointerId) endDrag(ev, true); });
        board.addEventListener('contextmenu', ev => ev.preventDefault());
        els.undo.addEventListener('click', undo);
        els.hint.addEventListener('click', showHint);
        els.newBtn.addEventListener('click', openNew);
        els.help.addEventListener('click', () => openDialog('dlgHelp'));
        els.auto.addEventListener('click', autoComplete);
        els.auto.addEventListener('pointerdown', ev => ev.stopPropagation());

        document.querySelectorAll('#dlgNew [data-draw]').forEach(b => b.addEventListener('click', () => { pending.draw = Number(b.dataset.draw); syncSeg(); }));
        document.querySelectorAll('#dlgNew [data-deal]').forEach(b => b.addEventListener('click', () => { pending.deal = b.dataset.deal; syncSeg(); }));
        $('dlgNew').addEventListener('close', () => {
            if ($('dlgNew').returnValue !== 'deal') return;
            prefs.draw = pending.draw; prefs.deal = pending.deal;
            save(KEY_PREFS, prefs);
            stopCascade();
            newGame(prefs.draw, prefs.deal);
        });
        $('dlgWin').addEventListener('close', () => {
            const v = $('dlgWin').returnValue;
            if (v === 'settings') { setTimeout(openNew, 0); return; }
            // ปัดทิ้ง/ปุ่มย้อนกลับของมือถือ = ปิดดูโต๊ะที่ชนะ ไม่แจกใหม่ทันที
            if (v !== 'again') { stopCascade(); toast('ชนะแล้ว! กด “เกมใหม่” เมื่อพร้อมเล่นตาต่อไป', 2600); return; }
            stopCascade();
            newGame(game.draw, game.deal);
        });
        $('dlgStuck').addEventListener('close', () => {
            const v = $('dlgStuck').returnValue;
            if (v === 'undo') undo();
            else if (v === 'new') openNew();
        });
        $('dlgHelp').addEventListener('close', () => save(KEY_INTRO, 1));

        document.addEventListener('keydown', ev => {
            if (document.querySelector('dialog[open]')) return;
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); }
            else if (ev.key === 'h' || ev.key === 'H') showHint();
            else if (ev.key === ' ' && ev.target === document.body) { ev.preventDefault(); drawStock(); }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') { pauseClock(); persist(); } else startClock();
        });
        window.addEventListener('pagehide', persist);
        window.addEventListener('online', () => flush());
        let resizeT = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => { if (!drag) render({ instant: true }); }, 80);
        });
        setInterval(() => {
            if (!game) return;
            els.time.textContent = fmt(elapsedNow());
            if (runningSince != null && Math.floor(elapsedNow() / 1000) % 5 === 0) persist();
        }, 500);
    }

    // ------------------------------------------------------------ boot
    buildBoard();
    wire();
    renderStats();
    if (!restore()) newGame(prefs.draw, prefs.deal);
    loadLeaderboard();
    flush();
    if (!load(KEY_INTRO, 0)) setTimeout(() => openDialog('dlgHelp'), 350);

    // เปิดทางให้เทสอัตโนมัติ (อ่านสถานะ/สั่งเดิน) โดยไม่กระทบผู้เล่น
    window.__solitaire = {
        get state() { return state; },
        get game() { return game; },
        move: code => commit(E.decodeMove(code)),
        pos: c => lastPos && lastPos[c]
    };
}());
