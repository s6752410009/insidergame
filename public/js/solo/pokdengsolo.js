/**
 * ป๊อกเด้งท้าเจ้ามือ — ฝั่งหน้าเว็บ
 *
 * หน้าเว็บไม่รู้ไพ่ล่วงหน้าเลย: ส่งแค่ "ลงเท่าไหร่" กับ "จั่ว/อยู่" แล้วเล่นแอนิเมชันตามผลที่เซิร์ฟเวอร์ตอบ
 * ทุกคำขอพกเลขมือไปด้วย → กดซ้ำ/ส่งซ้ำตอนเน็ตกระตุกไม่หักชิปซ้ำ
 */
(function () {
    'use strict';

    const API = '/api/solo/pokdengsolo';
    const CARD_BACK = '/assets/games/poker/back.svg';
    const CHIP = v => '/assets/games/pokdeng/chip-' + v + '.svg';
    const CHIP_VALUES = [10, 50, 100, 500];
    const INTRO_KEY = 'pokdengsolo.intro.v1';
    const BET_KEY = 'pokdengsolo.bet';

    const boot = readBoot();
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = id => document.getElementById(id);

    let S = null; // สถานะสาธารณะจากเซิร์ฟเวอร์
    let stats = boot.stats || null;
    let betAmount = Number(safeGet(BET_KEY)) || 50;
    let busy = false;
    let retryFn = null;
    let shownChips = null;
    let boardBest = null;

    document.documentElement.classList.add('pds-active');

    // ---------- utils ----------
    function readBoot() {
        try { return JSON.parse(document.getElementById('pdsBoot').textContent) || {}; } catch (e) { return {}; }
    }
    function safeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
    function safeSet(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* โหมดส่วนตัว */ } }
    function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
    }
    function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
    function signed(n) { n = Number(n) || 0; return (n > 0 ? '+' : (n < 0 ? '−' : '')) + fmt(Math.abs(n)); }
    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, reduceMotion ? Math.min(ms, 60) : ms)); }
    function haptic(p) { if (typeof window.gameHaptic === 'function') window.gameHaptic(p); }
    function dengWord(d) { return d >= 5 ? 'ห้าเด้ง' : (d === 3 ? 'สามเด้ง' : (d === 2 ? 'สองเด้ง' : '')); }
    function center(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function preload(src) {
        return new Promise(resolve => {
            if (!src) return resolve();
            const img = new Image();
            const done = () => resolve();
            img.onload = done;
            img.onerror = done;
            setTimeout(done, 1500);
            img.src = src;
        });
    }

    // ---------- network ----------
    async function api(method, path, body) {
        let lastError = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                const res = await fetch(API + path, {
                    method,
                    credentials: 'same-origin',
                    headers: body ? { 'Content-Type': 'application/json' } : {},
                    body: body ? JSON.stringify(body) : undefined,
                    cache: 'no-store'
                });
                const data = await res.json().catch(() => null);
                if (res.status >= 500 || !data) throw new Error('server ' + res.status);
                return { ok: res.ok && data.success !== false, status: res.status, data };
            } catch (error) {
                lastError = error;
                await sleep(450 * (attempt + 1));
            }
        }
        throw lastError || new Error('network');
    }

    function showError(text, retry) {
        retryFn = retry || null;
        $('pdsErrorText').textContent = text;
        $('pdsRetry').hidden = !retry;
        $('pdsError').hidden = false;
    }
    function clearError() {
        retryFn = null;
        $('pdsError').hidden = true;
    }
    $('pdsRetry').addEventListener('click', () => {
        const fn = retryFn;
        clearError();
        if (fn) fn();
    });
    // เน็ตกลับมา → ลองส่งคำขอที่ค้างให้เอง (เลขมือกันกดซ้ำอยู่แล้ว ส่งซ้ำไม่หักชิปซ้ำ)
    window.addEventListener('online', () => {
        if (!retryFn || $('pdsError').hidden || busy) return;
        setTimeout(() => { if (retryFn && !$('pdsError').hidden && !busy) $('pdsRetry').click(); }, 400);
    });

    // ---------- cards ----------
    function makeCard(card, opts) {
        opts = opts || {};
        const el = document.createElement('div');
        el.className = 'pc' + (opts.third ? ' is-third' : '');
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', card && opts.faceUp ? (card.thaiName || 'ไพ่') : 'ไพ่คว่ำ');
        el.innerHTML = '<div class="pc-inner"><img class="pc-back" src="' + CARD_BACK + '" alt="" draggable="false">' +
            (card ? '<img class="pc-face" src="' + esc(card.image) + '" alt="" draggable="false">' : '') + '</div>';
        if (opts.faceUp && card) el.classList.add('is-face', 'no-anim');
        return el;
    }

    function setFace(el, card) {
        if (!card) return;
        if (!el.querySelector('.pc-face')) {
            const img = document.createElement('img');
            img.className = 'pc-face';
            img.alt = '';
            img.draggable = false;
            img.src = card.image;
            el.querySelector('.pc-inner').appendChild(img);
        }
        el.setAttribute('aria-label', card.thaiName || 'ไพ่');
    }

    async function flip(el, card) {
        await preload(card && card.image);
        setFace(el, card);
        el.classList.remove('no-anim');
        // เฟรมถัดไปค่อยใส่คลาส ไม่งั้นเบราว์เซอร์ข้าม transition
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        el.classList.add('is-face');
        haptic(8);
    }

    function flyFromDeck(el) {
        if (reduceMotion || !el.animate) return Promise.resolve();
        const from = center($('pdsDeck'));
        const to = center(el);
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const anim = el.animate([
            { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(-18deg) scale(0.55)', opacity: 0 },
            { opacity: 1, offset: 0.2 },
            { transform: 'none', opacity: 1 }
        ], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        return anim.finished.catch(() => {});
    }

    async function dealCard(containerId, card, opts) {
        const el = makeCard(card, Object.assign({}, opts, { faceUp: false }));
        $(containerId).appendChild(el);
        haptic(6);
        await flyFromDeck(el);
        return el;
    }

    async function clearTable() {
        const boxes = [$('pdsDealerCards'), $('pdsPlayerCards')];
        const hasCards = boxes.some(b => b.children.length);
        if (hasCards && !reduceMotion) {
            boxes.forEach(b => b.classList.add('is-fading'));
            await sleep(230);
        }
        boxes.forEach(b => { b.classList.remove('is-fading'); b.innerHTML = ''; });
        setLabel('pdsDealerLabel', null);
        setLabel('pdsPlayerLabel', null);
    }

    function setLabel(id, ev, pop) {
        const el = $(id);
        el.classList.remove('is-special', 'is-pop');
        if (!ev) { el.textContent = ''; return; }
        el.textContent = ev.label;
        if (ev.pok || ev.special || ev.deng > 1) el.classList.add('is-special');
        if (pop && !reduceMotion) { void el.offsetWidth; el.classList.add('is-pop'); }
    }

    // ---------- fx ----------
    function chipFlight(fromEl, toEl, count, value) {
        if (reduceMotion || !fromEl || !toEl || !document.body.animate) return Promise.resolve();
        const layer = $('pdsFx');
        const a = center(fromEl);
        const b = center(toEl);
        const flights = [];
        for (let i = 0; i < count; i += 1) {
            const img = document.createElement('img');
            img.className = 'pds-fly';
            img.src = CHIP(value || CHIP_VALUES[i % CHIP_VALUES.length]);
            img.alt = '';
            layer.appendChild(img);
            const jx = (Math.random() - 0.5) * 60;
            const jy = (Math.random() - 0.5) * 30;
            const anim = img.animate([
                { transform: 'translate(' + (a.x - 15 + jx) + 'px,' + (a.y - 15 + jy) + 'px) scale(0.6)', opacity: 0 },
                { opacity: 1, offset: 0.15 },
                { transform: 'translate(' + (b.x - 15) + 'px,' + (b.y - 15) + 'px) scale(1)', opacity: 0.9, offset: 0.9 },
                { transform: 'translate(' + (b.x - 15) + 'px,' + (b.y - 15) + 'px) scale(0.7)', opacity: 0 }
            ], { duration: 720, delay: i * 55, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'both' });
            flights.push(anim.finished.catch(() => {}).then(() => img.remove()));
        }
        return Promise.all(flights);
    }

    function burst(text, side) {
        if (reduceMotion) return;
        const table = $('pdsTable');
        const target = side === 'dealer' ? $('pdsDealerCards') : $('pdsPlayerCards');
        const tr = table.getBoundingClientRect();
        const c = center(target);
        const top = (c.y - tr.top) + 'px';
        const ring = document.createElement('div');
        ring.className = 'pds-ring';
        ring.style.top = top;
        const tag = document.createElement('div');
        tag.className = 'pds-burst';
        tag.style.top = top;
        tag.textContent = text;
        table.appendChild(ring);
        table.appendChild(tag);
        setTimeout(() => { ring.remove(); tag.remove(); }, 1900);
    }

    function showOutcome(kind, title, sub) {
        const box = $('pdsOutcome');
        box.className = 'pds-outcome is-' + kind;
        $('pdsOutcomeTitle').textContent = title;
        $('pdsOutcomeSub').textContent = sub || '';
        void box.offsetWidth;
        box.classList.add('is-on');
        clearTimeout(showOutcome.t);
        showOutcome.t = setTimeout(() => box.classList.remove('is-on'), reduceMotion ? 1800 : 2300);
    }

    function tweenChips(to) {
        const el = $('pdsChips');
        const from = shownChips == null ? to : shownChips;
        shownChips = to;
        if (from === to || reduceMotion) { el.textContent = fmt(to); return; }
        el.classList.remove('is-bump');
        void el.offsetWidth;
        el.classList.add('is-bump');
        const start = performance.now();
        const dur = 650;
        function step(now) {
            const t = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - t, 3);
            el.textContent = fmt(Math.round(from + (to - from) * eased));
            if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // ---------- render ----------
    function setStatus(text, sub) {
        $('pdsStatus').textContent = text;
        $('pdsStatusSub').textContent = sub || '';
    }

    function setPot(amount) {
        $('pdsPotAmount').textContent = fmt(amount || 0);
        $('pdsPot').classList.toggle('is-empty', !amount);
    }

    function renderHud(opts) {
        if (!S) return;
        if (!opts || !opts.keepChips) {
            if (opts && opts.tween) tweenChips(S.chips);
            else { shownChips = S.chips; $('pdsChips').textContent = fmt(S.chips); }
        }
        $('pdsRunPeak').textContent = fmt(S.run.peak);
        const best = Math.max((stats && stats.bestPeak) || 0, S.run.peak || 0);
        $('pdsBestPeak').textContent = fmt(best);
        $('pdsKicker').textContent = 'เล่นคนเดียว · ' + (S.phase === 'draw' ? 'มือที่ ' + S.handNo : (S.run.hands ? 'เล่นไป ' + fmt(S.run.hands) + ' มือ' : 'รอบใหม่'));
    }

    function renderStats() {
        const s = stats || {};
        const run = S ? S.run : null;
        const cells = [
            ['สูงสุดตลอดกาล', fmt(Math.max(s.bestPeak || 0, run ? run.peak : 0)), true],
            ['มือทั้งหมด', fmt(s.handsPlayed || 0)],
            ['ชนะสุดต่อมือ', s.biggestWin ? '+' + fmt(s.biggestWin) : '–'],
            ['ป๊อก', fmt(s.pokCount || 0)],
            ['ชนะ – แพ้', fmt(s.wins || 0) + ' – ' + fmt(s.losses || 0)],
            ['รอบที่เล่น', fmt(s.runs || 0)]
        ];
        $('pdsStats').innerHTML = cells.map(c =>
            '<div class="pds-stat' + (c[2] ? ' is-best' : '') + '"><span class="pds-stat-label">' + c[0] + '</span><span class="pds-stat-value">' + c[1] + '</span></div>'
        ).join('');
        $('pdsRunSub').textContent = run ? 'รอบนี้ ' + fmt(run.hands) + ' มือ · ป๊อก ' + fmt(run.poks) + ' · ชนะสุด ' + (run.biggestWin ? '+' + fmt(run.biggestWin) : '–') : '';
    }

    function clampBet() {
        if (!S) return;
        const max = S.maxBet || 0;
        // 0 = กดล้างไว้ ปล่อยว่างให้เลือกชิปใหม่
        betAmount = Math.max(0, Math.min(max, Math.floor(Number(betAmount) || 0)));
    }

    function renderActions() {
        const box = $('pdsActions');
        if (!S) {
            box.innerHTML = '<div class="pds-hint">กำลังโหลดโต๊ะ…</div>';
            return;
        }
        const dis = busy ? ' disabled' : '';
        if (S.phase === 'busted') {
            const run = S.run;
            const isBest = stats && run.peak >= stats.bestPeak && run.peak > S.startChips;
            box.innerHTML = '<div class="pds-bust">' +
                '<h2>หมดตัวแล้ว!</h2>' +
                '<p style="color:var(--soft);">รอบนี้เล่นไป ' + fmt(run.hands) + ' มือ' + (isBest ? ' · <span class="pds-newbest">ทำสถิติใหม่!</span>' : '') + '</p>' +
                '<div class="pds-bust-grid">' +
                    '<div><b>' + fmt(run.peak) + '</b><span>ชิปสูงสุด</span></div>' +
                    '<div><b>' + (run.biggestWin ? '+' + fmt(run.biggestWin) : '–') + '</b><span>ชนะมากสุด</span></div>' +
                    '<div><b>' + fmt(run.poks) + '</b><span>ป๊อก</span></div>' +
                '</div>' +
                '<button type="button" class="pds-btn pds-btn--primary" data-act="newrun"' + dis + '>เริ่มรอบใหม่ · 1,000 ชิป</button>' +
            '</div>';
            return;
        }
        if (S.phase === 'draw' && S.hand) {
            const ev = S.hand.player.eval;
            box.innerHTML =
                '<div class="pds-row">' +
                    '<button type="button" class="pds-btn pds-btn--draw" data-act="draw"' + dis + '>จั่ว <small>+1 ใบ</small></button>' +
                    '<button type="button" class="pds-btn pds-btn--stay" data-act="stay"' + dis + '>อยู่ <small>' + esc(ev.points) + ' แต้ม</small></button>' +
                '</div>' +
                '<div class="pds-hint">เจ้ามือจั่วเมื่อได้ 0–3 แต้ม · 4 แต้มลุ้นครึ่งๆ · 5 ขึ้นไปอยู่</div>';
            return;
        }
        clampBet();
        const max = S.maxBet;
        const chips = CHIP_VALUES.map(v =>
            '<button type="button" class="pds-chip" data-chip="' + v + '" aria-label="เพิ่ม ' + v + ' ชิป"' + (busy || betAmount + v > max ? ' disabled' : '') + '>' +
            '<img src="' + CHIP(v) + '" alt="" draggable="false"></button>').join('');
        const can = !busy && betAmount >= S.minBet && betAmount <= max;
        box.innerHTML = '<div class="pds-bet">' +
            '<div class="pds-bet-top">' +
                '<div class="pds-bet-amount"><strong id="pdsBetAmt">' + fmt(betAmount) + '</strong><span>เดิมพัน ' + S.minBet + '–' + fmt(max) + '</span></div>' +
                '<div class="pds-chips">' + chips + '</div>' +
            '</div>' +
            '<div class="pds-row">' +
                '<button type="button" class="pds-btn pds-btn--sm" data-act="clear"' + dis + '>ล้าง</button>' +
                '<button type="button" class="pds-btn pds-btn--sm" data-act="double"' + (busy || !betAmount || betAmount * 2 > max ? ' disabled' : '') + '>×2</button>' +
                '<button type="button" class="pds-btn pds-btn--sm" data-act="max"' + dis + '>สุด ' + fmt(max) + '</button>' +
            '</div>' +
            '<button type="button" class="pds-btn pds-btn--primary" data-act="deal"' + (can ? '' : ' disabled') + '>' +
                (betAmount >= S.minBet ? 'แจกไพ่ · ลง ' + fmt(betAmount) : 'แตะชิปเพื่อลงเดิมพัน') + '</button>' +
        '</div>';
    }

    function describeResultStatus(r) {
        if (!r) return ['วางเดิมพันแล้วกดแจกไพ่', 'ลง 10–500 ต่อมือ · ป๊อก 8/9 เปิดชนะทันที'];
        if (r.outcome === 'win') return ['ชนะ ' + signed(r.delta) + (r.multiplier > 1 ? ' · ' + dengWord(r.multiplier) : ''), 'ลงมือต่อไปได้เลย'];
        if (r.outcome === 'lose') return ['แพ้ ' + signed(r.delta) + (r.multiplier > 1 ? ' · เจ้ามือ' + dengWord(r.multiplier) : ''), r.short ? 'เสียไม่เกินชิปที่มี' : 'แก้มือได้ ลงต่อเลย'];
        return ['เสมอ · ได้เดิมพันคืน', 'ลงมือต่อไปได้เลย'];
    }

    /** วาดโต๊ะตามสถานะโดยไม่มีแอนิเมชัน (โหลดหน้า / ซิงก์ใหม่) */
    function renderTableStatic() {
        const dBox = $('pdsDealerCards');
        const pBox = $('pdsPlayerCards');
        dBox.innerHTML = '';
        pBox.innerHTML = '';
        $('pdsDealerBadge').hidden = true;
        if (!S) return;
        if (S.phase === 'draw' && S.hand) {
            S.hand.player.cards.forEach((c, i) => pBox.appendChild(makeCard(c, { faceUp: true, third: i === 2 })));
            for (let i = 0; i < S.hand.dealer.cardCount; i += 1) dBox.appendChild(makeCard(null, {}));
            setLabel('pdsPlayerLabel', S.hand.player.eval);
            setLabel('pdsDealerLabel', null);
            setPot(S.hand.bet);
            setStatus('จั่วเพิ่ม หรือ อยู่?', 'มือที่ ' + S.handNo + ' · ลง ' + fmt(S.hand.bet));
            return;
        }
        const r = S.lastResult;
        setPot(0);
        if (r) {
            r.player.cards.forEach((c, i) => pBox.appendChild(makeCard(c, { faceUp: true, third: i === 2 })));
            r.dealer.cards.forEach((c, i) => dBox.appendChild(makeCard(c, { faceUp: true, third: i === 2 })));
            setLabel('pdsPlayerLabel', r.player.eval);
            setLabel('pdsDealerLabel', r.dealer.eval);
        } else {
            setLabel('pdsPlayerLabel', null);
            setLabel('pdsDealerLabel', null);
        }
        const st = S.phase === 'busted' ? ['หมดตัว — จบรอบนี้', 'เริ่มรอบใหม่ได้ทันที'] : describeResultStatus(r);
        setStatus(st[0], st[1]);
    }

    function renderAll() {
        renderHud();
        renderTableStatic();
        renderActions();
        renderStats();
    }

    function adopt(data) {
        if (!data) return;
        if (data.stats) stats = data.stats;
        if (data.state !== undefined) S = data.state;
    }

    // ---------- flows ----------
    async function loadState() {
        clearError();
        let res;
        try {
            res = await api('GET', '/state');
        } catch (error) {
            showError('เชื่อมต่อไม่ได้ — เช็กเน็ตแล้วลองอีกครั้ง', loadState);
            return;
        }
        if (!res.ok) {
            showError((res.data && res.data.error) || 'โหลดโต๊ะไม่สำเร็จ', res.status === 403 ? () => location.reload() : loadState);
            return;
        }
        adopt(res.data);
        if (!S) {
            await startRun(false); // เข้าครั้งแรก — เปิดรอบให้เลย
            return;
        }
        renderAll();
    }

    async function startRun(fresh) {
        busy = true;
        renderActions();
        clearError();
        let res;
        try {
            res = await api('POST', '/start', { fresh: !!fresh });
        } catch (error) {
            busy = false;
            renderActions();
            showError('เชื่อมต่อไม่ได้ — เช็กเน็ตแล้วลองอีกครั้ง', () => startRun(fresh));
            return;
        }
        busy = false;
        adopt(res.data);
        if (!res.ok) showError((res.data && res.data.error) || 'เริ่มรอบไม่สำเร็จ', res.status === 403 ? () => location.reload() : null);
        if (S && fresh) {
            await clearTable();
            setPot(0);
            betAmount = Math.min(betAmount || 50, S.maxBet);
        }
        renderAll();
        if (S && fresh) tweenChips(S.chips);
        loadBoard();
    }

    async function placeBet() {
        if (busy || !S || S.phase !== 'bet') return;
        const amount = betAmount;
        const hand = S.handNo + 1;
        const before = S.chips;
        busy = true;
        clearError();
        renderActions();
        safeSet(BET_KEY, String(amount));
        // ชิปลงกองกลางระหว่างรอเซิร์ฟเวอร์ ให้รู้สึกไว
        setPot(amount);
        $('pdsChips').textContent = fmt(before - amount);
        shownChips = before - amount;
        const flight = chipFlight($('pdsChips'), $('pdsPot'), Math.min(6, 2 + Math.round(amount / 100)), amount >= 500 ? 500 : (amount >= 100 ? 100 : (amount >= 50 ? 50 : 10)));
        const clearing = clearTable();
        let res;
        try {
            res = await api('POST', '/bet', { amount, hand });
        } catch (error) {
            await clearing;
            busy = false;
            renderAll();
            showError('ส่งเดิมพันไม่สำเร็จ — เช็กเน็ตแล้วลองอีกครั้ง', placeBet);
            return;
        }
        await Promise.all([flight, clearing]);
        if (!res.ok) {
            busy = false;
            adopt(res.data);
            renderAll();
            showError((res.data && res.data.error) || 'ลงเดิมพันไม่สำเร็จ', res.status === 403 ? () => location.reload() : null);
            return;
        }
        adopt(res.data);
        try {
            await animateDeal(hand, amount);
        } catch (error) {
            renderAll();
        }
        busy = false;
        renderActions();
    }

    async function animateDeal(hand, bet) {
        const result = S.lastResult && S.lastResult.handNo === hand ? S.lastResult : null;
        const playerCards = result ? result.player.cards : S.hand.player.cards;
        const dealerCards = result ? result.dealer.cards : [null, null];
        const playerEval = result ? result.player.eval : S.hand.player.eval;
        setStatus('แจกไพ่…', 'มือที่ ' + hand + ' · ลง ' + fmt(bet));
        // ยังไม่อัปเดต HUD ทั้งหมด — ผลมือ (ถ้ามีป๊อก) มากับ response แล้ว แต่ต้องรอเปิดไพ่ก่อน
        $('pdsKicker').textContent = 'เล่นคนเดียว · มือที่ ' + hand;
        const pEls = [];
        const dEls = [];
        for (let i = 0; i < 2; i += 1) {
            pEls.push(await dealCard('pdsPlayerCards', playerCards[i]));
            await sleep(40);
            dEls.push(await dealCard('pdsDealerCards', null));
            await sleep(40);
        }
        for (let i = 0; i < 2; i += 1) {
            await flip(pEls[i], playerCards[i]);
            await sleep(140);
        }
        await sleep(260);
        setLabel('pdsPlayerLabel', playerEval, true);

        if (!result) {
            setStatus('จั่วเพิ่ม หรือ อยู่?', 'ตอนนี้ ' + playerEval.points + ' แต้ม' + (playerEval.deng > 1 ? ' · ' + dengWord(playerEval.deng) : ''));
            return;
        }
        // มีป๊อก → เปิดวัดทันที
        if (result.player.eval.pok) {
            setStatus('ป๊อก ' + result.player.eval.points + '!', 'เปิดวัดกับเจ้ามือทันที');
            burst('ป๊อก ' + result.player.eval.points + '!', 'player');
            pEls.forEach(el => el.classList.add('is-glow'));
            haptic([20, 50, 30]);
            await sleep(700);
        }
        if (result.dealer.eval.pok) setStatus('เจ้ามือป๊อก!', 'เปิดวัดทันที');
        for (let i = 0; i < dEls.length; i += 1) {
            await flip(dEls[i], dealerCards[i]);
            await sleep(150);
        }
        await sleep(250);
        setLabel('pdsDealerLabel', result.dealer.eval, true);
        if (result.dealer.eval.pok) {
            burst('เจ้ามือป๊อก ' + result.dealer.eval.points, 'dealer');
            await sleep(600);
        }
        await finishHand(result);
    }

    async function act(action) {
        if (busy || !S || S.phase !== 'draw') return;
        const hand = S.handNo;
        busy = true;
        clearError();
        renderActions();
        setStatus(action === 'draw' ? 'จั่ว…' : 'อยู่', 'รอเจ้ามือ');
        let res;
        try {
            res = await api('POST', '/act', { action, hand });
        } catch (error) {
            busy = false;
            renderActions();
            setStatus('จั่วเพิ่ม หรือ อยู่?', '');
            showError('ส่งไม่สำเร็จ — ลองอีกครั้ง', () => act(action));
            return;
        }
        if (!res.ok) {
            busy = false;
            adopt(res.data);
            renderAll();
            if (res.status !== 409) showError((res.data && res.data.error) || 'ทำรายการไม่สำเร็จ', null);
            return;
        }
        adopt(res.data);
        try {
            await animateAct(S.lastResult);
        } catch (error) {
            renderAll();
        }
        busy = false;
        renderActions();
    }

    async function animateAct(r) {
        const dBox = $('pdsDealerCards');
        if (r.playerDrew) {
            const el = await dealCard('pdsPlayerCards', r.player.cards[2], { third: true });
            await flip(el, r.player.cards[2]);
            await sleep(320);
            setLabel('pdsPlayerLabel', r.player.eval, true);
            if (r.player.eval.special) burst(r.player.eval.name + '!', 'player');
        } else {
            setLabel('pdsPlayerLabel', r.player.eval);
        }
        const badge = $('pdsDealerBadge');
        badge.hidden = false;
        badge.className = 'pds-badge is-thinking';
        badge.textContent = 'คิด';
        setStatus('ตาเจ้ามือ', 'จั่วเมื่อได้ 0–3 แต้ม');
        await sleep(700);
        if (r.dealerDrew) {
            badge.className = 'pds-badge';
            badge.textContent = 'จั่ว';
            await dealCard('pdsDealerCards', null, { third: true });
        } else {
            badge.className = 'pds-badge';
            badge.textContent = 'อยู่';
        }
        await sleep(300);
        const dEls = Array.from(dBox.children);
        for (let i = 0; i < dEls.length; i += 1) {
            await flip(dEls[i], r.dealer.cards[i]);
            await sleep(150);
        }
        await sleep(250);
        setLabel('pdsDealerLabel', r.dealer.eval, true);
        await finishHand(r);
    }

    async function finishHand(r) {
        $('pdsDealerBadge').hidden = true;
        const before = shownChips == null ? r.chipsAfter : shownChips;
        if (r.outcome === 'win') {
            showOutcome('win', 'ชนะ ' + signed(r.delta), (r.player.eval.label || '') + (r.multiplier > 1 ? ' ×' + r.multiplier : ''));
            Array.from($('pdsPlayerCards').children).forEach(el => el.classList.add('is-glow'));
            if (r.multiplier > 1) burst(dengWord(r.multiplier) + '!', 'player');
            haptic(r.multiplier > 1 ? [30, 60, 30, 60, 40] : [25, 50, 25]);
            await chipFlight($('pdsDealerCards'), $('pdsChips'), Math.min(16, 4 + r.multiplier * 3), r.delta >= 500 ? 500 : 100);
        } else if (r.outcome === 'lose') {
            showOutcome('lose', 'แพ้ ' + signed(r.delta), 'เจ้ามือ ' + (r.dealer.eval.label || '') + (r.multiplier > 1 ? ' ×' + r.multiplier : ''));
            if (!reduceMotion && r.multiplier > 1) {
                const t = $('pdsTable');
                t.classList.remove('is-shake');
                void t.offsetWidth;
                t.classList.add('is-shake');
            }
            haptic(40);
            await chipFlight($('pdsPot'), $('pdsDealerCards'), 4, 100);
        } else {
            showOutcome('push', 'เสมอ', 'ได้เดิมพันคืน');
            await chipFlight($('pdsPot'), $('pdsChips'), 3, 100);
        }
        setPot(0);
        shownChips = before;
        renderHud({ tween: true });
        renderStats();
        const st = S.phase === 'busted' ? ['หมดตัว — จบรอบนี้', 'เริ่มรอบใหม่ได้ทันที'] : describeResultStatus(r);
        setStatus(st[0], st[1]);
        if (S.phase === 'busted') await sleep(900);
        if (stats && stats.bestPeak && boardBest != null && stats.bestPeak > boardBest) loadBoard();
    }

    // ---------- leaderboard ----------
    async function loadBoard() {
        try {
            const res = await api('GET', '/leaderboard');
            const entries = (res.data && res.data.entries) || [];
            const mine = entries.find(e => e.playerId === boot.playerId);
            boardBest = mine ? mine.score : (entries.length >= 20 ? entries[entries.length - 1].score : 0);
            if (!entries.length) {
                $('pdsBoard').innerHTML = '<li class="pds-board-empty" style="display:block;">ยังไม่มีใครติดอันดับ — เป็นคนแรกเลย</li>';
                return;
            }
            $('pdsBoard').innerHTML = entries.map(e => {
                const av = typeof window.renderPlayerAvatar === 'function'
                    ? window.renderPlayerAvatar({ avatar: e.avatar, avatarFrame: e.avatarFrame, color: e.color, playerName: e.playerName }, { size: 28 })
                    : '<span aria-hidden="true">' + esc(e.avatar || '👤') + '</span>';
                return '<li class="' + (e.playerId === boot.playerId ? 'is-me' : '') + '">' +
                    '<span class="pds-rank">' + e.rank + '</span>' +
                    '<span class="pds-av">' + av + '</span>' +
                    '<span class="pds-name" style="color:' + esc(e.color || 'inherit') + '">' + esc(e.playerName) + (e.playerId === boot.playerId ? ' (คุณ)' : '') + '</span>' +
                    '<span class="pds-score">' + esc(e.label) + '</span></li>';
            }).join('');
        } catch (error) {
            $('pdsBoard').innerHTML = '<li class="pds-board-empty" style="display:block;">โหลดอันดับไม่ได้ตอนนี้</li>';
        }
    }

    // ---------- sheets ----------
    let sheetReturn = null;
    let sheetOnClose = null;
    function openSheet(title, html, opts) {
        opts = opts || {};
        sheetReturn = document.activeElement;
        sheetOnClose = opts.onClose || null;
        $('pdsSheetTitle').textContent = title;
        $('pdsSheetBody').innerHTML = html;
        $('pdsSheetClose').textContent = opts.closeText || 'เข้าใจแล้ว';
        $('pdsSheet').hidden = false;
        $('pdsSheetClose').focus();
    }
    function closeSheet() {
        if ($('pdsSheet').hidden) return;
        $('pdsSheet').hidden = true;
        const cb = sheetOnClose;
        sheetOnClose = null;
        if (cb) cb();
        if (sheetReturn && sheetReturn.focus) sheetReturn.focus();
    }
    $('pdsSheetClose').addEventListener('click', closeSheet);
    $('pdsSheet').addEventListener('click', e => { if (e.target === $('pdsSheet')) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    $('pdsSheetBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-sheet-act]');
        if (!btn) return;
        if (btn.dataset.sheetAct === 'confirm-newrun') {
            sheetOnClose = null;
            closeSheet();
            startRun(true);
        }
    });

    function mini(ids) {
        return '<span class="pds-mini">' + ids.map(id => '<img src="/assets/games/poker/' + id + '.svg" alt="">').join('') + '</span>';
    }
    function rankGuideHtml() {
        const rows = [
            ['ป๊อก 9', '2 ใบรวมได้ 9 · เปิดชนะทันที', ['9s', 'kh'], ''],
            ['ป๊อก 8', '2 ใบรวมได้ 8 · แพ้ป๊อก 9 อย่างเดียว', ['5d', '3c'], ''],
            ['ตอง', '3 ใบหน้าเดียวกัน', ['7s', '7h', '7d'], '×5'],
            ['เรียง', '3 ใบเรียงกัน A-2-3 ถึง Q-K-A', ['4c', '5h', '6s'], '×3'],
            ['เซียน', 'J Q K ล้วน', ['js', 'qd', 'kh'], '×3'],
            ['แต้ม 9 → 0', 'แต้มมากชนะ · 0 = บอด · เท่ากัน = เสมอ', ['2d', '6d', 'as'], '']
        ];
        return rows.map((r, i) => '<div class="pds-rankrow"><span class="pds-rankno">' + (i + 1) + '</span>' +
                '<span><span class="pds-rankname">' + r[0] + '</span>' + (r[3] ? '<span class="pds-deng">' + r[3] + '</span>' : '') +
                '<span class="pds-rankdesc">' + r[1] + '</span></span>' + mini(r[2]) + '</div>').join('') +
            '<h3>เด้ง = ตัวคูณของฝั่งที่ชนะ</h3>' +
            '<div class="pds-rankrow"><span class="pds-rankno">×2</span><span><span class="pds-rankname">สองเด้ง</span><span class="pds-rankdesc">2 ใบดอกเดียวกัน หรือคู่</span></span>' + mini(['8h', 'kh']) + '</div>' +
            '<div class="pds-rankrow"><span class="pds-rankno">×3</span><span><span class="pds-rankname">สามเด้ง</span><span class="pds-rankdesc">3 ใบดอกเดียวกัน</span></span>' + mini(['2c', '5c', 'qc']) + '</div>' +
            '<p style="margin-top:10px;">แต้ม = หลักหน่วยของผลรวม · A = 1 · 10/J/Q/K = 0</p>';
    }
    function howToHtml() {
        return '<ol class="pds-steps">' +
            '<li><div><b>ลงเดิมพัน 10–500</b><p>แตะชิปเพื่อเพิ่มยอด แล้วกดแจกไพ่</p></div></li>' +
            '<li><div><b>ได้ 2 ใบ</b><p>รวมได้ 8 หรือ 9 = <b>ป๊อก</b> เปิดวัดทันที · เจ้ามือป๊อกก็เปิดทันทีเหมือนกัน</p></div></li>' +
            '<li><div><b>จั่วหรืออยู่</b><p>จั่วเพิ่มได้ 1 ใบ แล้วเจ้ามือบอทจั่ว (0–3 แต้มจั่วเสมอ · 4 แต้มลุ้นครึ่งๆ)</p></div></li>' +
            '<li><div><b>วัดแต้ม</b><p>ชนะได้ เดิมพัน × เด้งของเรา · แพ้เสีย เดิมพัน × เด้งเจ้ามือ (ไม่เกินชิปที่มี)</p></div></li>' +
            '</ol>' +
            '<h3>เป้าหมาย</h3><p>เริ่ม 1,000 ชิป ปั้นให้สูงที่สุดก่อนหมดตัว — <b>ชิปสูงสุดที่เคยถึง</b> ขึ้นตารางอันดับทั้งเว็บ</p>' +
            '<p>ชิปเล่นๆ ไม่ผูกกับกระเป๋า ไม่มีมูลค่าจริง · เซิร์ฟเวอร์สับไพ่และแจกเอง รีเฟรชหน้าก็เล่นต่อจากเดิม</p>';
    }
    $('pdsRankBtn').addEventListener('click', () => openSheet('อันดับไพ่ป๊อกเด้ง', rankGuideHtml()));
    $('pdsHowBtn').addEventListener('click', () => openSheet('ป๊อกเด้งท้าเจ้ามือ เล่นยังไง', howToHtml()));

    // ---------- actions ----------
    $('pdsActions').addEventListener('click', e => {
        const chip = e.target.closest('[data-chip]');
        if (chip && !chip.disabled) {
            betAmount = Math.min(S.maxBet, betAmount + Number(chip.dataset.chip));
            haptic(8);
            renderActions();
            const amt = $('pdsBetAmt');
            if (amt && !reduceMotion) amt.classList.add('is-bump');
            return;
        }
        const btn = e.target.closest('[data-act]');
        if (!btn || btn.disabled) return;
        const a = btn.dataset.act;
        if (a === 'clear') { betAmount = 0; renderActions(); }
        else if (a === 'double') { betAmount = Math.min(S.maxBet, betAmount * 2); renderActions(); }
        else if (a === 'max') { betAmount = S.maxBet; renderActions(); }
        else if (a === 'deal') placeBet();
        else if (a === 'draw') act('draw');
        else if (a === 'stay') act('stay');
        else if (a === 'newrun') startRun(true);
    });

    // เริ่มรอบใหม่เองระหว่างเล่น (ยืนยันก่อน)
    const runTitle = $('pdsRunTitle');
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'pds-pill';
    restart.style.cssText = 'float:right; min-height:36px; margin-top:-6px; font-size:0.8rem;';
    restart.textContent = 'เริ่มรอบใหม่';
    restart.addEventListener('click', () => {
        if (busy || !S) return;
        if (S.phase === 'draw') { showError('เล่นมือนี้ให้จบก่อนค่อยเริ่มรอบใหม่', null); return; }
        if (S.phase === 'busted') { startRun(true); return; }
        openSheet('เริ่มรอบใหม่?', '<p>ชิปรอบนี้ (' + fmt(S.chips) + ') จะหายไป แล้วเริ่มใหม่ที่ 1,000 ชิป · สถิติสูงสุดที่ทำไว้ยังอยู่ครบ</p>' +
            '<button type="button" class="pds-btn" data-sheet-act="confirm-newrun" style="width:100%; margin-top:10px;">เริ่มรอบใหม่เลย</button>', { closeText: 'เล่นรอบนี้ต่อ' });
    });
    runTitle.parentNode.insertBefore(restart, runTitle);

    // ---------- go ----------
    renderStats();
    loadState();
    loadBoard();
    if (!safeGet(INTRO_KEY)) {
        openSheet('ป๊อกเด้งท้าเจ้ามือ เล่นยังไง', howToHtml(), { closeText: 'เริ่มเล่น', onClose: () => safeSet(INTRO_KEY, '1') });
    }
})();
