/* เศรษฐี — client
 * เซิร์ฟเวอร์ตัดสินทุกอย่าง (เต๋า การ์ด เงิน) · ไฟล์นี้วาดกระดาน เล่นฉากตาม fx ที่เซิร์ฟเวอร์ส่งมา และส่งคำสั่งกลับ
 *
 * หลักการ: ดูกระดานแล้วรู้ทันทีว่าช่องไหนของใคร (ระบายสีเจ้าของทั้งช่อง + ค่าผ่านทางบนช่อง) · ตัดสินใจทีละเรื่องในแผ่นเดียว
 * ฉากเข้าคิวเล่นทีละฉาก แตะข้ามได้ · เซิร์ฟเวอร์เผื่อเวลาฉากไว้แล้ว (fxCost) จึงไม่ต้องเร่งเอง ยกเว้นตามไม่ทันจริง ๆ
 * โมชันใช้ transform/opacity ผ่าน Web Animations · prefers-reduced-motion = ตัดการเคลื่อนไหว เหลือผลลัพธ์สั้น ๆ
 */
(function() {
  'use strict';
  var BOOT = window.SETTHI_BOOT || {};
  var BOARD = BOOT.board || { squares: [], groups: {}, groupSquares: {}, sideSquares: [], touristSquares: [] };
  var ART = window.SetthiArt;
  var SQ = BOARD.squares;
  var GROUPS = BOARD.groups;
  var N = SQ.length || 32;
  var roomId = BOOT.roomId;
  var playerId = BOOT.playerId;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  root.classList.add('st-active');
  root.style.setProperty('--st-kanok', ART.KANOK);

  var socket = io({ reconnection: true, reconnectionAttempts: Infinity, transports: ['websocket', 'polling'] });
  if (window.partyPlay) window.partyPlay.startSession('setthi', socket);

  var S = BOOT.state && BOOT.state.mode ? BOOT.state : null; // state ล่าสุดจากเซิร์ฟเวอร์
  var V = null; // ภาพที่กำลังแสดง (ตามหลังเซิร์ฟเวอร์ระหว่างเล่นฉาก)
  var lastFxSeq = S ? (S.fxSeq || 0) : 0;
  var skew = 0;
  var pending = false;
  var soundOn = true;
  try { soundOn = localStorage.getItem('setthiSound') !== 'off'; } catch (e) { /* ignore */ }

  var $ = function(sel) { return document.querySelector(sel); };
  var el = {
    board: $('#stBoard'), tokens: $('#stTokens'), cam: $('#stCam'), frame: $('#stFrame'),
    strip: $('#stStrip'), dock: $('#stDockBody'), timer: $('#stTimer'), alerts: $('#stAlerts'),
    clock: $('#stClock'), clockTxt: $('#stClockTxt'), fx: $('#stFx'), sheet: $('#stSheet'), sheetCard: $('#stSheetCard'),
    end: $('#stEnd'), pickbar: $('#stPickbar'), fast: $('#stFastBtn'), log: $('#stLogList')
  };
  var LAND = '/assets/games/setthi/land/';
  var TIER_ART = ['b-land', 'b-house', 'b-building', 'b-hotel'];
  var LEVEL_NAMES = BOARD.levelNames || ['ที่ดิน', 'บ้าน', 'ตึก', 'โรงแรม', 'แลนด์มาร์ก'];
  var MONO = { color: 'ผูกขาด 3 สี', line: 'ผูกขาดแถว', tourist: 'ผูกขาดท่องเที่ยว' };

  // ---------- เครื่องมือ ----------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function money(n) { return '฿' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function moneyK(n) {
    n = Math.round(Number(n) || 0);
    if (n < 1000) return '฿' + n;
    if (n < 10000) return '฿' + (Math.round(n / 100) / 10).toString() + 'k';
    return '฿' + Math.round(n / 1000) + 'k';
  }
  function nowServer() { return Date.now() + skew; }
  function seatOf(id, state) { return ((state || S || {}).seats || []).find(function(s) { return s.playerId === id; }) || null; }
  function meSeat() { return seatOf(playerId); }
  function nameOf(id) { var s = seatOf(id); return s ? (s.playerId === playerId ? 'คุณ' : s.name) : 'ธนาคาร'; }
  function isOut(seat) { return !seat || seat.bankrupt || seat.left; }
  function groupOf(i) { return SQ[i] && SQ[i].group ? GROUPS[SQ[i].group] : null; }
  function isCity(i) { return SQ[i] && SQ[i].type === 'city'; }
  function isTour(i) { return SQ[i] && SQ[i].type === 'tourist'; }
  function ownable(i) { return isCity(i) || isTour(i); }
  function haptic(p) { if (typeof window.gameHaptic === 'function') window.gameHaptic(p); }
  function iconHtml(name) { return ART.icon(name); }
  function artSrc(name) { return LAND + name + '.svg'; }
  // รูปถ่ายจริงของแต่ละที่ (scripts/build-setthi-photos.js) · ไม่มีรูป (โอกาส/ภาษี) = ใช้ไอคอน
  var PHOTO_BASE = '/assets/games/setthi/photos/';
  var NO_PHOTO = { chance: 1, tax: 1 };
  function placeSrc(name, size) { return NO_PHOTO[name] ? artSrc(name) : PHOTO_BASE + name + '-' + (size || 't') + '.webp'; }
  function tokenHtml(seat, extra) {
    if (!seat) return '<span class="st-token" style="--tk:#6c7a93"><span>🏦</span></span>';
    return '<span class="st-token ' + (extra || '') + '" style="--tk:' + esc(seat.tokenColor) + '" title="' + esc(seat.name) + '"><span>' + esc(seat.avatar || '👤') + '</span></span>';
  }
  /** เครื่องหมายเจ้าของบนธง: อวาตาร์ (ถ้าไม่ซ้ำใคร) ไม่งั้นเลขที่นั่ง — คู่กับสี ให้คนตาบอดสีแยกได้ */
  function markOf(seat) {
    if (!seat) return '';
    var same = ((S && S.seats) || []).filter(function(x) { return x.avatar === seat.avatar; }).length;
    return same > 1 || !seat.avatar ? String((seat.token || 0) + 1) : seat.avatar;
  }
  function inkOf(seat) { return (seat && seat.tokenInk) || '#fff'; }
  /** ไอคอนบนช่อง (เล็ก): ขั้นสูงสุดอันเดียว + จำนวนขั้น · แลนด์มาร์กโชว์ดาว */
  function tileBld(level, stars) {
    if (level >= 4) return '<span class="is-lm">' + ART.ICONS.landmark + '</span>' + (stars ? '<b class="st-stars">⭐' + stars + '</b>' : '');
    var icon = level >= 3 ? ART.ICONS.hotel : level === 2 ? ART.ICONS.bld : ART.ICONS.house;
    return '<span>' + icon + '</span>';
  }
  function bldIcons(level) {
    if (level >= 4) return '<span class="is-lm">' + ART.ICONS.landmark + '</span>';
    var out = '';
    if (level >= 1) out += '<span>' + ART.ICONS.house + '</span>';
    if (level >= 2) out += '<span>' + ART.ICONS.bld + '</span>';
    if (level >= 3) out += '<span class="is-hotel">' + ART.ICONS.hotel + '</span>';
    return out;
  }
  function costOf(i, level) { var c = SQ[i].costs || []; return c[level] || 0; }
  function valueOf(i, level) { var t = 0; for (var k = 0; k <= level; k += 1) t += costOf(i, k); return t; }
  function toast(msg, ms) {
    var t = document.createElement('div');
    t.className = 'st-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    t.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 180, fill: 'forwards' });
    setTimeout(function() {
      var a = t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      a.onfinish = function() { t.remove(); };
    }, ms || 2200);
  }
  var preloaded = {};
  function preload(name, place) { if (!name || preloaded[name]) return; preloaded[name] = new Image(); preloaded[name].src = place ? placeSrc(name, 'w') : artSrc(name); }
  TIER_ART.forEach(function(n) { preload(n); });

  // ---------- เสียง (สังเคราะห์เอง) ----------
  var sfx = (function() {
    var ctx = null;
    function c() {
      if (!soundOn) return null;
      try {
        if (!ctx) { var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return null; ctx = new Ctx(); }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) { return null; }
      return ctx;
    }
    function tone(freq, dur, type, vol, when) {
      var a = c(); if (!a) return;
      try {
        var t0 = a.currentTime + (when || 0);
        var o = a.createOscillator(); var g = a.createGain();
        o.type = type || 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) { /* ignore */ }
    }
    function noise(dur, vol, freq, when) {
      var a = c(); if (!a) return;
      try {
        var len = Math.floor(a.sampleRate * dur);
        var buf = a.createBuffer(1, len, a.sampleRate); var d = buf.getChannelData(0);
        for (var i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        var src = a.createBufferSource(); src.buffer = buf;
        var f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2000;
        var g = a.createGain(); g.gain.value = vol || 0.2;
        src.connect(f); f.connect(g); g.connect(a.destination);
        src.start(a.currentTime + (when || 0));
      } catch (e) { /* ignore */ }
    }
    return {
      dice: function() { for (var i = 0; i < 5; i += 1) noise(0.035, 0.22, 2600 + i * 300, i * 0.06 + Math.random() * 0.03); },
      hop: function(k) { tone(560 + (k || 0) * 30, 0.05, 'triangle', 0.05); },
      coin: function() { tone(1320, 0.08, 'sine', 0.14); tone(1760, 0.14, 'sine', 0.11, 0.06); },
      stamp: function() { tone(92, 0.2, 'sine', 0.45); noise(0.08, 0.3, 700); },
      card: function() { noise(0.2, 0.12, 4200); },
      fanfare: function() { [523, 659, 784, 1047].forEach(function(f, i) { tone(f, 0.22, 'triangle', 0.14, i * 0.09); }); },
      big: function() { [392, 523, 659, 784, 1047, 1319].forEach(function(f, i) { tone(f, 0.3, 'triangle', 0.13, i * 0.08); }); },
      alarm: function() { for (var i = 0; i < 4; i += 1) { tone(880, 0.12, 'square', 0.07, i * 0.22); tone(660, 0.12, 'square', 0.07, i * 0.22 + 0.11); } },
      sad: function() { tone(330, 0.25, 'sawtooth', 0.07); tone(247, 0.4, 'sawtooth', 0.07, 0.2); },
      turn: function() { tone(880, 0.1, 'sine', 0.12); tone(1175, 0.16, 'sine', 0.1, 0.08); },
      build: function() { tone(520, 0.06, 'square', 0.06); tone(780, 0.08, 'square', 0.05, 0.06); },
      bad: function() { tone(180, 0.16, 'square', 0.07); },
      tick: function() { tone(988, 0.05, 'triangle', 0.08); },
      whoosh: function() { noise(0.35, 0.14, 900); }
    };
  })();

  // ---------- กระดาน ----------
  function gridOf(i) {
    if (i === 0) return { r: 9, c: 9, side: 'x' };
    if (i < 8) return { r: 9, c: 9 - i, side: 'b' };
    if (i === 8) return { r: 9, c: 1, side: 'x' };
    if (i < 16) return { r: 9 - (i - 8), c: 1, side: 'l' };
    if (i === 16) return { r: 1, c: 1, side: 'x' };
    if (i < 24) return { r: 1, c: 1 + (i - 16), side: 't' };
    if (i === 24) return { r: 1, c: 9, side: 'x' };
    return { r: 1 + (i - 24), c: 9, side: 'r' };
  }
  var CORNER_LABEL = { start: 'เริ่ม', island: 'เกาะร้าง', festival: 'งานวัด', tour: 'ทัวร์' };
  var CORNER_SUB = { start: '+' + moneyK(BOARD.salary), island: 'ติด 3 ตา', festival: 'ค่าผ่าน ×2', tour: 'วาร์ป' };
  var cells = [];
  function cellHtml(i) {
    var sq = SQ[i];
    var g = gridOf(i);
    var style = 'grid-row:' + g.r + ';grid-column:' + g.c + ';';
    var attrs = ' data-i="' + i + '" role="gridcell" tabindex="0"';
    if (g.side === 'x') {
      return '<div class="st-cell is-corner corner-' + sq.type + '"' + attrs + ' style="' + style + '" aria-label="' + esc(sq.name) + '">' +
        '<span class="st-corner-photo" style="background-image:url(' + placeSrc(sq.art, 't') + ')"></span>' +
        '<span class="st-corner-name">' + esc(CORNER_LABEL[sq.type] || sq.name) + '</span><span class="st-corner-sub">' + esc(CORNER_SUB[sq.type] || '') + '</span></div>';
    }
    var cls = 'st-cell side-' + g.side + ' type-' + sq.type;
    if (isCity(i)) {
      var grp = groupOf(i);
      return '<div class="' + cls + '"' + attrs + ' style="' + style + '--band:' + grp.color + '">' +
        '<span class="st-photo" style="background-image:url(' + placeSrc(sq.art, 't') + ')"></span><i class="st-band"></i>' +
        '<span class="st-bld"></span><div class="st-cell-in"><span class="st-name">' + esc(sq.short) + '</span><span class="st-val">' + moneyK(sq.price) + '</span></div>' +
        '<span class="st-ownframe"></span><span class="st-dot"></span><span class="st-flag" aria-hidden="true"></span></div>';
    }
    if (isTour(i)) {
      return '<div class="' + cls + '"' + attrs + ' style="' + style + '">' +
        '<span class="st-photo" style="background-image:url(' + placeSrc(sq.art, 't') + ')"></span><i class="st-band"></i>' +
        '<span class="st-bld"></span><span class="st-tour-tag" aria-hidden="true">📷</span><div class="st-cell-in"><span class="st-name">' + esc(sq.short) + '</span><span class="st-val">' + moneyK(sq.price) + '</span></div>' +
        '<span class="st-ownframe"></span><span class="st-dot"></span><span class="st-flag" aria-hidden="true"></span></div>';
    }
    var sub = sq.type === 'tax' ? '10%' : '';
    return '<div class="' + cls + '"' + attrs + ' style="' + style + '" aria-label="' + esc(sq.name) + '">' +
      '<div class="st-cell-in"><span class="st-bld">' + iconHtml(sq.icon) + '</span><span class="st-name">' + esc(sq.short) + '</span>' + (sub ? '<span class="st-val is-plain">' + sub + '</span>' : '') + '</div></div>';
  }
  function dieHtml() {
    var pips = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
    var faces = '';
    for (var f = 1; f <= 6; f += 1) {
      var h = '';
      for (var k = 1; k <= 9; k += 1) h += pips[f].indexOf(k) >= 0 ? '<i style="grid-area:' + (Math.ceil(k / 3)) + '/' + (((k - 1) % 3) + 1) + '"></i>' : '';
      faces += '<div class="st-die-face f' + f + '">' + h + '</div>';
    }
    return '<div class="st-die">' + faces + '</div>';
  }
  function buildBoard() {
    var html = [];
    for (var i = 0; i < N; i += 1) html.push(cellHtml(i));
    html.push('<div class="st-center" id="stCenter">' +
      '<div class="st-word"><b>เศรษฐี</b></div>' +
      '<div class="st-dice" id="stDice">' + dieHtml() + dieHtml() + '<div class="st-die-shadow"></div></div>' +
      '<div class="st-turnline" id="stTurnline"></div>' +
      '<button type="button" class="st-lastlog" id="stLastLog" aria-label="ดูบันทึกเกม"></button>' +
      '</div>');
    el.board.innerHTML = html.join('');
    cells = [];
    el.board.querySelectorAll('.st-cell').forEach(function(c) { cells[Number(c.dataset.i)] = c; });
  }
  var DIE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  function dieTransform(v, ex, ey, tx, ty, tz) {
    var r = DIE_ROT[v] || [0, 0];
    return 'translate3d(' + (tx || 0) + 'px,' + (ty || 0) + 'px,' + (tz || 0) + 'px) rotateX(-16deg) rotateY(22deg) rotateX(' + (r[0] + (ex || 0)) + 'deg) rotateY(' + (r[1] + (ey || 0)) + 'deg)';
  }
  function setDice(pair) {
    if (!pair) pair = [5, 2];
    el.board.querySelectorAll('.st-die').forEach(function(d, k) { d.style.transform = dieTransform(pair[k]); });
  }

  // ---------- โมเดลภาพ ----------
  function modelFrom(state) {
    var m = { pos: {}, cash: {}, island: {}, out: {}, props: {}, festival: state.festival === undefined ? null : state.festival, festivalMult: state.festivalMult || 2 };
    (state.seats || []).forEach(function(s) { m.pos[s.playerId] = s.pos; m.cash[s.playerId] = s.cash; m.island[s.playerId] = s.island; m.out[s.playerId] = s.bankrupt || s.left; });
    Object.keys(state.props || {}).forEach(function(k) { var p = state.props[k]; m.props[k] = { owner: p.owner, level: p.level, stars: p.stars || 0 }; });
    return m;
  }
  function tollIn(m, i) {
    var p = m.props[i];
    if (!p || !p.owner) return 0;
    var fest = m.festival === i ? Math.max(2, m.festivalMult || 2) : 1;
    if (isTour(i)) {
      var n = (BOARD.touristSquares || []).filter(function(k) { return m.props[k] && m.props[k].owner === p.owner; }).length;
      return (SQ[i].tolls[Math.max(0, n - 1)] || 0) * fest;
    }
    var t = SQ[i].tolls[p.level] || 0;
    if (p.level === 4 && p.stars) t = Math.round(t * (1 + 0.25 * Math.min(4, p.stars)) / 10) * 10;
    return t * fest;
  }
  function threatOn(i) {
    if (!S || !S.threats) return null;
    for (var k = 0; k < S.threats.length; k += 1) if (S.threats[k].squares.indexOf(i) >= 0) return S.threats[k];
    return null;
  }
  var focusId = null;
  var focusTimer = null;
  function renderCell(i, m) {
    var c = cells[i];
    if (!c || !ownable(i)) return;
    var p = (m.props || {})[i] || {};
    var owner = p.owner ? seatOf(p.owner) : null;
    c.classList.toggle('is-owned', !!owner);
    c.style.setProperty('--own', owner ? owner.tokenColor : 'transparent');
    c.style.setProperty('--own-ink', owner ? inkOf(owner) : 'inherit');
    c.classList.toggle('is-ink-dark', !!(owner && inkOf(owner) !== '#ffffff' && inkOf(owner) !== '#fff'));
    var dot = c.querySelector('.st-dot');
    dot.textContent = owner ? markOf(owner) : '';
    var val = c.querySelector('.st-val');
    var toll = owner ? tollIn(m, i) : 0;
    val.textContent = owner ? moneyK(toll) : moneyK(SQ[i].price);
    if (isCity(i)) {
      var bld = c.querySelector('.st-bld');
      var key = owner ? 'L' + p.level + 's' + (p.stars || 0) : 'icon';
      if (bld.dataset.k !== key) {
        bld.dataset.k = key;
        bld.innerHTML = owner && p.level > 0 ? tileBld(p.level, p.stars) : '';
        bld.classList.toggle('is-icons', !!(owner && p.level > 0));
      }
      var lm = c.querySelector('.st-lm');
      if (owner && p.level >= 4 && !lm) {
        lm = document.createElement('span');
        lm.className = 'st-lm';
        lm.style.backgroundImage = 'url(' + placeSrc(SQ[i].art, 't') + ')';
        c.appendChild(lm);
      } else if ((!owner || p.level < 4) && lm) lm.remove();
      c.classList.toggle('is-landmark', !!(owner && p.level >= 4));
    }
    c.classList.toggle('is-fest', m.festival === i && !!owner);
    var fl = c.querySelector('.st-flag');
    if (fl) { var fm = m.festival === i ? Math.max(2, m.festivalMult || 2) : 0; fl.dataset.x = fm; fl.className = 'st-flag' + (fm >= 4 ? ' is-x' + fm : ''); }
    var th = threatOn(i);
    c.classList.toggle('is-threat', !!th);
    if (th) { var ts = seatOf(th.playerId); c.style.setProperty('--threat', ts ? ts.tokenColor : '#fff'); }
    c.classList.toggle('is-focus', !!focusId && p.owner === focusId);
    var sq = SQ[i];
    c.setAttribute('aria-label', sq.name + (owner ? ' — ของ ' + owner.name + (isCity(i) ? ' ' + LEVEL_NAMES[p.level] : '') + ' ค่าผ่านทาง ' + money(toll) : ' — ว่าง ราคา ' + money(sq.price)) + (m.festival === i ? ' (งานวัด ×2)' : ''));
  }
  function renderCells(m) {
    for (var i = 0; i < N; i += 1) renderCell(i, m);
    el.board.classList.toggle('is-focusing', !!focusId);
  }

  // ---------- โทเคน ----------
  var tokenEls = {};
  function cellBox(i) { var c = cells[i]; return { x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight }; }
  function tokenSize() { return parseFloat(getComputedStyle(el.tokens).getPropertyValue('--tks')) || 18; }
  /**
   * หมากยืน "ในช่อง" เสมอ: โซนหมาก = แถบไอคอนตอนบนของช่อง (เหนือชื่อและค่าผ่านทาง ไม่ทับตัวหนังสือ)
   * 1 ตัว = ขนาดเต็ม · หลายตัว = ย่อแล้วเรียงแถวเดียวกันในช่องเดียวกัน · มุม = กลางรูป
   * คืน { x, y, k } โดย x,y = มุมซ้ายบนของกล่องขนาดฐาน (--tks) และ k = สเกล
   */
  function slotXY(i, k, n) {
    var b = cellBox(i);
    var size = tokenSize();
    var side = gridOf(i).side;
    var band = 0.08;
    var cx = b.x + b.w / 2;
    var cy;
    if (side === 'x') cy = b.y + b.h * 0.42;
    else if (side === 'b') cy = b.y + b.h * (band + 0.22);
    else if (side === 't') cy = b.y + b.h * 0.26;
    else { cy = b.y + b.h * 0.27; cx = b.x + b.w * (side === 'l' ? 0.46 : 0.54); }
    var scale = 1;
    if (n > 1) {
      scale = n === 2 ? 0.8 : 0.7;
      var tok = size * scale;
      var span = b.w * (side === 'x' ? 0.8 : 0.9) - tok;
      var step = Math.min(tok * 0.92, span / (n - 1));
      cx += (k - (n - 1) / 2) * step;
    }
    return { x: cx - size / 2, y: cy - size / 2, k: scale };
  }
  function tokenTransform(xy) { return 'translate(' + xy.x + 'px,' + xy.y + 'px)' + (xy.k && xy.k !== 1 ? ' scale(' + xy.k + ')' : ''); }
  /** ขนาดหมากตามขนาดช่องจริง (เปลี่ยนตามจอ) */
  function sizeTokens() {
    var c = cells[1];
    if (!c || !c.offsetWidth) return;
    el.tokens.style.setProperty('--tks', Math.round(Math.min(c.offsetWidth * 0.5, 40)) + 'px');
  }
  function ensureTokens(state) {
    (state.seats || []).forEach(function(s) {
      if (tokenEls[s.playerId]) return;
      var t = document.createElement('div');
      t.className = 'st-token st-piece';
      t.style.setProperty('--tk', s.tokenColor);
      t.innerHTML = '<span>' + esc(s.avatar || '👤') + '</span>';
      el.tokens.appendChild(t);
      tokenEls[s.playerId] = t;
    });
  }
  function placeTokens(model, skipId) {
    if (!S) return;
    sizeTokens();
    ensureTokens(S);
    var groups = {};
    (S.seats || []).forEach(function(s) {
      if (model.out[s.playerId]) return;
      (groups[model.pos[s.playerId]] = groups[model.pos[s.playerId]] || []).push(s.playerId);
    });
    (S.seats || []).forEach(function(s) {
      var t = tokenEls[s.playerId];
      t.classList.toggle('is-out', !!model.out[s.playerId]);
      t.classList.toggle('is-turn', !!(S.turn && S.turn.playerId === s.playerId && S.phase !== 'finished'));
      t.classList.toggle('is-island', !!model.island[s.playerId]);
      if (s.playerId === skipId || model.out[s.playerId]) return;
      var pos = model.pos[s.playerId];
      var list = groups[pos] || [s.playerId];
      var xy = slotXY(pos, list.indexOf(s.playerId), list.length);
      t.style.transform = tokenTransform(xy);
    });
  }

  // ---------- กล้อง (มือถือ) ----------
  var camState = { x: 0, y: 0, k: 1 };
  function camEnabled() { return !reduceMotion && el.frame.offsetWidth < 620; }
  function camFor(i, k) {
    var b = cellBox(i);
    var W = el.cam.offsetWidth;
    k = k || 1.55;
    var x = W / 2 - (b.x + b.w / 2) * k;
    var y = W / 2 - (b.y + b.h / 2) * k;
    x = Math.min(0, Math.max(W - W * k, x));
    y = Math.min(0, Math.max(W - W * k, y));
    return { x: x, y: y, k: k };
  }
  function camStr(c) { return 'translate(' + c.x + 'px,' + c.y + 'px) scale(' + c.k + ')'; }
  function camTo(c, dur) {
    var from = camStr(camState);
    camState = c;
    el.cam.style.transform = camStr(c);
    if (!dur) return Promise.resolve();
    return A(el.cam, [{ transform: from }, { transform: camStr(c) }], { duration: dur, fill: 'none' });
  }
  function camReset(dur) {
    if (camState.k === 1 && camState.x === 0 && camState.y === 0) return Promise.resolve();
    return camTo({ x: 0, y: 0, k: 1 }, dur == null ? 300 : dur);
  }

  // ---------- คิวฉาก ----------
  var queue = [];
  var running = false;
  var speed = 1;
  var skipping = false;
  var liveAnims = new Set();
  var waiters = new Set();

  function A(target, frames, opts) {
    opts = opts || {};
    var dur = skipping ? 1 : Math.max(1, (opts.duration || 400) / speed);
    var a;
    try {
      a = target.animate(frames, { duration: dur, delay: skipping ? 0 : (opts.delay || 0) / speed, easing: opts.easing || 'cubic-bezier(0.22, 1, 0.36, 1)', fill: opts.fill || 'forwards' });
    } catch (e) { return Promise.resolve(); }
    liveAnims.add(a);
    return a.finished.then(function() { liveAnims.delete(a); }, function() { liveAnims.delete(a); });
  }
  function wait(ms) {
    if (skipping) return Promise.resolve();
    return new Promise(function(resolve) {
      var done = function() { clearTimeout(t); waiters.delete(done); resolve(); };
      var t = setTimeout(done, ms / speed);
      waiters.add(done);
    });
  }
  function skipNow() {
    if (!running) return;
    skipping = true;
    liveAnims.forEach(function(a) { try { a.finish(); } catch (e) { /* ignore */ } });
    Array.from(waiters).forEach(function(fn) { fn(); });
  }
  function setModal(on) {
    el.fx.classList.toggle('is-modal', !!on);
    el.fx.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  function clearFx() { el.fx.innerHTML = ''; setModal(false); }
  function fxNode(cls, html, style) {
    var n = document.createElement('div');
    n.className = cls;
    if (html) n.innerHTML = html;
    if (style) n.setAttribute('style', style);
    el.fx.appendChild(n);
    return n;
  }
  function scrim(on, dur) {
    var s = el.fx.querySelector('.st-fx-scrim');
    if (!s) {
      s = document.createElement('div');
      s.className = 'st-fx-scrim';
      el.fx.insertBefore(s, el.fx.firstChild);
    }
    return A(s, [{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: dur || 200 });
  }

  document.addEventListener('pointerdown', function(e) {
    if (!running) return;
    if (e.target && e.target.closest && e.target.closest('.st-sheet-card, .st-dock, .chat-box, .st-sidebar, .st-top, #toggleChat')) return;
    skipNow();
  }, true);
  document.addEventListener('keydown', function(e) { if (running && e.key === 'Escape') skipNow(); });

  var INSTANT = { left: 1, start: 1, debt: 1, fast: 1, debug: 1, finished: 0 };

  function enqueueFx(list) {
    list.forEach(function(f) {
      if (INSTANT[f.kind]) { instantFx(f); return; }
      if (f.kind === 'salary') return; // เล่นตอนเดินผ่านจุดเริ่ม
      queue.push(f);
    });
    if (!running) runQueue();
  }
  function pickSpeed(f) {
    var base = reduceMotion ? 4 : (S && S.fast ? 2 : 1);
    var lag = nowServer() - (f.at || nowServer());
    if (queue.length >= 24 || lag > 15000) return Math.max(base, 5);
    if (queue.length >= 12 || lag > 8000) return Math.max(base, 2.5);
    return base;
  }
  async function runQueue() {
    if (running) return;
    running = true;
    renderDock();
    closeSheetForScenes();
    while (queue.length) {
      if (document.hidden || queue.length > 60) { queue = []; break; }
      var f = queue.shift();
      speed = pickSpeed(f);
      skipping = false;
      try { await playFx(f); } catch (e) { if (window.console) console.warn('[setthi] fx', f.kind, e && e.message); }
      clearFx();
      skipping = false;
    }
    running = false;
    speed = 1;
    hideStepBubble();
    await camReset(260);
    renderAll();
  }
  function playFx(f) { var h = FX[f.kind]; return h ? h(f) : Promise.resolve(); }

  function instantFx(f) {
    if (f.kind === 'left' && f.playerId !== playerId) toast(nameOf(f.playerId) + ' ออกจากเกม');
    if (f.kind === 'debt' && f.playerId === playerId) { haptic([30, 50, 30]); sfx.bad(); }
    if (f.kind === 'debug') { paintDebug(); toast('🛠 ' + nameOf(f.playerId) + ': ' + f.text, 2600); }
    if (f.kind === 'fast') { paintFast(); if (f.by !== playerId) toast(f.on ? '⏩ ' + nameOf(f.by) + ' เปิดเร่งเกม' : nameOf(f.by) + ' ปิดเร่งเกม', 1600); }
  }

  function centerOf(node) {
    if (!node) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function chipOf(id) { return el.strip.querySelector('.st-chip[data-id="' + id + '"] .st-token') || el.strip.querySelector('.st-chip[data-id="' + id + '"]'); }
  function bankPoint() { return centerOf($('#stCenter .st-word')); }
  function cellPoint(i) { return centerOf(cells[i]); }

  function setCash(map) {
    if (!map || !V) return;
    Object.keys(map).forEach(function(id) {
      var before = V.cash[id];
      V.cash[id] = map[id];
      var node = el.strip.querySelector('.st-chip[data-id="' + id + '"] .st-chip-cash');
      if (node && before !== map[id]) countTo(node, before, map[id]);
    });
  }
  function countTo(node, from, to) {
    if (from == null || reduceMotion) { node.textContent = money(to); return; }
    var t0 = performance.now();
    var dur = 520 / Math.max(1, speed);
    node.classList.toggle('is-down', to < from);
    node.classList.toggle('is-up', to > from);
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      node.textContent = money(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
      else setTimeout(function() { node.classList.remove('is-down', 'is-up'); }, 600);
    }
    requestAnimationFrame(step);
    A(node, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  }
  function flyCoins(from, to, amount) {
    if (reduceMotion) return Promise.resolve();
    var n = Math.max(4, Math.min(12, Math.round(Math.log2((amount || 10) / 50)) + 3));
    var ps = [];
    for (var k = 0; k < n; k += 1) {
      var coin = fxNode('st-coin' + (amount >= 3000 ? ' is-big' : ''));
      var mid = { x: (from.x + to.x) / 2 + (Math.random() - 0.5) * 30, y: Math.min(from.y, to.y) - 50 - Math.random() * 40 };
      ps.push(A(coin, [
        { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(0.6)', opacity: 0 },
        { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(1)', opacity: 1, offset: 0.12 },
        { transform: 'translate(' + mid.x + 'px,' + mid.y + 'px) scale(1.15) rotate(180deg)', opacity: 1, offset: 0.55 },
        { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(0.7) rotate(360deg)', opacity: 0.2 }
      ], { duration: 680, delay: k * 45, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' }));
    }
    setTimeout(function() { sfx.coin(); }, 380 / speed);
    return Promise.all(ps);
  }
  function moneyTag(at, amount, plus, label) {
    var tag = fxNode('st-money ' + (plus ? 'is-plus' : 'is-minus'), (label ? '<small>' + esc(label) + '</small>' : '') + (plus ? '+' : '−') + money(amount));
    return A(tag, [
      { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 26) + 'px) translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.25 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 40) + 'px) translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 52) + 'px) translate(-50%, -50%) scale(1)', opacity: 0 }
    ], { duration: 1100, easing: 'ease-out' });
  }
  function banner(opts) {
    var html = (opts.token && !opts.art ? tokenHtml(opts.token) : '') + (opts.art ? '<img class="st-banner-img" src="' + placeSrc(opts.art, 'w') + '" alt="" width="160" height="100">' : '') + (opts.icon ? '<div class="st-banner-art">' + iconHtml(opts.icon) + '</div>' : '') +
      (opts.kicker ? '<div class="st-banner-kicker">' + esc(opts.kicker) + '</div>' : '') +
      '<div class="st-banner-title">' + esc(opts.title) + '</div>' +
      (opts.sub ? '<div class="st-banner-sub">' + opts.sub + '</div>' : '');
    var b = fxNode('st-banner' + (opts.cls ? ' ' + opts.cls : ''), html);
    if (opts.style) b.setAttribute('style', opts.style);
    return b;
  }
  async function showBanner(opts, hold) {
    var b = banner(opts);
    await A(b, [{ transform: 'translateX(-50%) translateY(18px) scale(0.92)', opacity: 0 }, { transform: 'translateX(-50%) translateY(0) scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await wait(hold || 600);
    await A(b, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(-50%) translateY(-10px) scale(0.98)' }], { duration: 200 });
  }
  function burst(at, colors, count, spread) {
    if (reduceMotion) return Promise.resolve();
    var ps = [];
    for (var k = 0; k < (count || 18); k += 1) {
      var s = fxNode('st-spark', '', '--c:' + colors[k % colors.length]);
      var ang = Math.random() * Math.PI * 2;
      var dist = (spread || 90) * (0.4 + Math.random() * 0.8);
      ps.push(A(s, [
        { transform: 'translate(' + at.x + 'px,' + at.y + 'px) rotate(0deg) scale(1)', opacity: 1 },
        { transform: 'translate(' + (at.x + Math.cos(ang) * dist) + 'px,' + (at.y + Math.sin(ang) * dist + 30) + 'px) rotate(' + (360 + Math.random() * 360) + 'deg) scale(0.4)', opacity: 0 }
      ], { duration: 700 + Math.random() * 400, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }));
    }
    return Promise.all(ps);
  }
  /** สีเจ้าของไหลเต็มช่องตอนเปลี่ยนเจ้าของ */
  function floodCell(i, color) {
    var c = cells[i];
    if (!c || reduceMotion) return;
    var f = document.createElement('span');
    f.className = 'st-flood';
    f.style.background = color;
    c.appendChild(f);
    var a = f.animate([{ transform: 'scale(0)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 1, offset: 0.6 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 650 / speed, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    a.onfinish = function() { f.remove(); };
  }
  function pulseCell(i, cls, ms) {
    var c = cells[i];
    if (!c) return;
    c.classList.remove(cls);
    void c.offsetWidth;
    c.classList.add(cls);
    setTimeout(function() { if (cells[i]) cells[i].classList.remove(cls); }, ms || 1200);
  }

  // ---------- แผ่นตัดสินใจ (ใช้ทั้งแผ่นจริงและ "แผ่นแวบ" ที่โชว์ว่าคนอื่นเลือกอะไร) ----------
  function tileHtml(i, level, state, extra) {
    // state: built | sel | open | locked
    var img = level === 4 || isTour(i) ? placeSrc(SQ[i].art, 't') : artSrc(TIER_ART[level]);
    var label = isTour(i) ? 'ซื้อ' : LEVEL_NAMES[level];
    var small = extra || '';
    return '<button type="button" class="st-tile is-' + state + (level === 4 ? ' is-lm' : '') + '" data-level="' + level + '"' + (state === 'locked' || state === 'built' ? ' aria-disabled="true"' : '') + '>' +
      '<span class="st-tile-img"><img src="' + img + '" alt="" width="56" height="56"></span><b>' + esc(label) + '</b><small>' + small + '</small></button>';
  }
  var LOCK_TEXT = { lap: '🔒 รอบ 2', hotel: '🔒 มีโรงแรม', later: '🔒 ตกซ้ำ' };
  function sheetHeadArt(i, title, sub) {
    var g = groupOf(i);
    return '<div class="st-dhead"><span class="st-dhead-art is-photo" style="--band:' + (g ? g.color : '#139a8e') + '"><img src="' + placeSrc(SQ[i].art, 'w') + '" alt="" width="72" height="72"></span>' +
      '<div class="st-dhead-txt"><h3 id="stSheetTitle">' + esc(title) + '</h3>' + (sub ? '<div class="st-dhead-sub">' + sub + '</div>' : '') + '</div></div>';
  }
  function groupChip(i) {
    var g = groupOf(i);
    if (!g) return '<span class="st-chipline"><i style="background:#139a8e"></i>ท่องเที่ยว</span>';
    return '<span class="st-chipline"><i style="background:' + g.color + '"></i>สี' + esc(g.name) + '</span>';
  }

  // ตัวเลือกในแผ่นสร้างของเรา
  var buildSel = null;
  function buildSheetHtml(d, readonly, chosen) {
    var i = d.square;
    var sq = SQ[i];
    var title = d.mode === 'buy' ? 'ซื้อ ' + sq.short + '?' : d.current === 3 ? 'สร้างแลนด์มาร์ก?' : 'สร้างเพิ่ม?';
    var sel = readonly ? chosen : buildSel;
    var tiles = '';
    var total = 0;
    (d.options || []).forEach(function(o) {
      var st;
      if (o.built) st = 'built';
      else if (o.locked) st = 'locked';
      else st = sel !== null && sel !== undefined && o.level <= sel ? 'sel' : 'open';
      if (st === 'sel') total += o.cost;
      var small = st === 'built' ? '✓ มีแล้ว' : st === 'locked' ? LOCK_TEXT[o.locked] || '🔒' : money(o.cost);
      tiles += tileHtml(i, o.level, st, small);
    });
    var tollNow = sel !== null && sel !== undefined && sel >= 0 ? (isTour(i) ? sq.tolls[0] : sq.tolls[sel]) : null;
    var cash = d.cash;
    var info = '<div class="st-dinfo">' +
      '<span class="st-dinfo-item"><small>ค่าผ่านทาง</small><b>' + (tollNow !== null ? money(tollNow) : '—') + '</b></span>' +
      '<span class="st-dinfo-item"><small>จ่าย</small><b class="is-pay">' + money(total) + '</b></span>' +
      '<span class="st-dinfo-item"><small>เหลือ</small><b class="' + (cash - total < 0 ? 'is-bad' : '') + '">' + money(cash - total) + '</b></span></div>';
    var verb = d.mode === 'buy' ? 'ซื้อ' : 'สร้าง';
    var btns = readonly ? '' : '<div class="st-sheet-foot">' +
      btn('stPassBtn', 'ผ่าน', {}) +
      btn('stBuildBtn', total > 0 ? verb + ' ' + money(total) : 'เลือกขั้นก่อน', { primary: true, disabled: !total || total > cash || pending || running }) + '</div>';
    var sub = groupChip(i) + (d.mode === 'afterTakeover' ? '<span class="st-chipline">ซื้อต่อแล้ว</span>' : '');
    return sheetHeadArt(i, title, sub) +
      '<div class="st-tiles' + (isTour(i) ? ' is-one' : '') + '" role="group" aria-label="เลือกขั้นที่จะสร้าง">' + tiles + '</div>' + info + btns;
  }
  function takeoverSheetHtml(d, readonly) {
    var i = d.square;
    var owner = seatOf(d.owner);
    var me = seatOf(d.playerId);
    var sub = '<span class="st-swap">' + tokenHtml(owner) + '<span class="st-swap-arrow">→</span>' + tokenHtml(me) + '</span>';
    return sheetHeadArt(i, 'ซื้อต่อ ' + SQ[i].short + '?', sub) +
      '<div class="st-take"><div class="st-take-bld">' + (d.level > 0 ? bldIcons(d.level) : '<span class="st-take-land">ที่ดิน</span>') + '</div>' +
      '<div class="st-take-price"><small>ราคา ×2</small><b>' + money(d.price) + '</b></div>' +
      '<div class="st-take-left"><small>เหลือ</small><b>' + money(d.cash - d.price) + '</b></div></div>' +
      (readonly ? '' : '<div class="st-sheet-foot">' + btn('stNoTakeBtn', 'ไม่ซื้อ', {}) + btn('stTakeBtn', 'ซื้อต่อ ' + money(d.price), { primary: true, disabled: d.cash < d.price || pending || running }) + '</div>');
  }
  function sellSheetHtml() {
    var me = meSeat();
    var sell = (S.self && S.self.sell) || {};
    var keys = Object.keys(sell).map(Number).sort(function(a, b) { return sell[a] - sell[b]; });
    var short = S.debt ? Math.max(0, S.debt.total - me.cash) : 0;
    var list = keys.map(function(i) {
      var p = S.props[i] || {};
      return '<button type="button" class="st-sell" data-sell="' + i + '"><span class="st-sell-img"><img src="' + placeSrc(SQ[i].art, 't') + '" alt="" width="40" height="40"></span>' +
        '<span class="st-sell-name">' + esc(SQ[i].short) + '<span class="st-sell-bld">' + (isCity(i) ? bldIcons(p.level) : '') + '</span></span><b>+' + money(sell[i]) + '</b></button>';
    }).join('');
    return '<div class="st-dhead"><span class="st-dhead-art is-alert">' + iconHtml('coins') + '</span><div class="st-dhead-txt"><h3 id="stSheetTitle">เงินไม่พอ! ขาด ' + money(short) + '</h3><div class="st-dhead-sub"><span class="st-chipline">ขายที่ = ได้คืนครึ่งราคา</span></div></div></div>' +
      '<div class="st-sells">' + list + '</div>';
  }
  function squareSheetHtml(i) {
    var sq = SQ[i];
    var m = V || modelFrom(S);
    var p = m.props[i] || {};
    var owner = p.owner ? seatOf(p.owner) : null;
    if (!ownable(i)) {
      var what = {
        start: [['💰', 'ผ่าน/ตก +' + money(BOARD.salary)], ['🎁', 'ทอยมาตกพอดี = อัปเมืองฟรี 1 ขั้น'], ['✈️', 'วาร์ป/การ์ด ไม่ได้อัปฟรี']],
        island: [['🏝️', 'ติด ' + BOARD.islandTurns + ' ตา'], ['🎲', 'ดับเบิล = ออก'], ['⛵', 'จ่าย ' + money(BOARD.islandFee) + ' = ออก']],
        festival: [['🎉', 'เลือกที่ตัวเอง ค่าผ่านทาง ×2'], ['×16', 'เลือกเมืองเดิมซ้ำ ×4 ×8 ×16']],
        tour: [['✈️', 'ตาหน้าเลือกช่อง เดินหน้าเสมอ'], ['💰', 'ผ่านจุดเริ่มได้เงินเดือน'], ['🎫', 'ค่าทัวร์ ' + money(BOARD.tourFee)]],
        chance: [['❓', 'สุ่มการ์ด 1 ใบ']],
        tax: [['🧾', 'จ่าย 10% ของที่']]
      }[sq.type] || [];
      return '<div class="st-dhead"><span class="st-dhead-art' + (NO_PHOTO[sq.art] ? '' : ' is-photo') + '"><img src="' + placeSrc(sq.art, 'w') + '" alt="" width="72" height="72"></span><div class="st-dhead-txt"><h3 id="stSheetTitle">' + esc(sq.name) + '</h3></div></div>' +
        '<div class="st-facts">' + what.map(function(w) { return '<div class="st-fact"><i>' + esc(w[0]) + '</i><span>' + esc(w[1]) + '</span></div>'; }).join('') + '</div>';
    }
    var sub = groupChip(i) + (owner ? '<span class="st-chipline">' + tokenHtml(owner) + esc(owner.playerId === playerId ? 'ของคุณ' : owner.name) + '</span>' : '<span class="st-chipline">ว่าง</span>') + (m.festival === i ? '<span class="st-chipline is-fest">🎉 ×2</span>' : '');
    var rows = '';
    var levels = isTour(i) ? [0] : [0, 1, 2, 3, 4];
    levels.forEach(function(k) {
      var here = owner && (isTour(i) || p.level === k);
      rows += '<div class="st-tier' + (here ? ' is-now' : '') + '"><img src="' + (k === 4 || isTour(i) ? placeSrc(sq.art, 't') : artSrc(TIER_ART[k])) + '" alt="" width="36" height="36"><b>' + esc(isTour(i) ? 'ที่ดิน' : LEVEL_NAMES[k]) + '</b><span>' + money(sq.costs[k]) + '</span><span class="st-tier-toll">' + (isTour(i) ? '1→4 แห่ง ' + sq.tolls.map(moneyK).join(' / ') : money(sq.tolls[k])) + '</span></div>';
    });
    var now = owner ? '<div class="st-dinfo"><span class="st-dinfo-item"><small>ค่าผ่านทางตอนนี้</small><b>' + money(tollIn(m, i)) + '</b></span>' + (isCity(i) && p.level === 4 ? '<span class="st-dinfo-item"><small>ดาว</small><b>' + (p.stars ? '⭐' + p.stars : '—') + ' / 4</b></span>' : '') + (isCity(i) && p.level < 4 ? '<span class="st-dinfo-item"><small>ซื้อต่อ ×2</small><b>' + money(valueOf(i, p.level) * 2) + '</b></span>' : '<span class="st-dinfo-item"><small>ซื้อต่อ</small><b>ไม่ได้</b></span>') + '</div>' : '';
    var ownerBar = owner ? '<div class="st-ownerbar" style="--tk:' + esc(owner.tokenColor) + ';--tk-ink:' + esc(inkOf(owner)) + '">' + tokenHtml(owner) + '<span>เจ้าของ: <b>' + esc(owner.playerId === playerId ? 'คุณ' : owner.name) + '</b></span></div>' : '<div class="st-ownerbar is-free">ยังไม่มีเจ้าของ · ราคา ' + money(sq.price) + '</div>';
    return ownerBar + sheetHeadArt(i, sq.name, sub) + now +
      '<div class="st-tiers"><div class="st-tier is-head"><span></span><b></b><span>ราคา</span><span class="st-tier-toll">ค่าผ่านทาง</span></div>' + rows + '</div>';
  }
  function helpHtml() {
    var rows = [
      ['🎲', 'กดค้างทอย ปล่อยตอนแรง = เดินไกล · ช่องเขียว = ลุ้นดับเบิล'],
      ['🏠', 'ตกที่ว่าง: ซื้อ + สร้างได้ในแผ่นเดียว'],
      ['1️⃣', 'รอบแรกสร้างถึงบ้าน · รอบ 2 ถึงโรงแรม'],
      ['🏛️', 'มีโรงแรม แล้วตกซ้ำ = แลนด์มาร์ก'],
      ['⭐', 'ตกแลนด์มาร์กตัวเอง: โบนัส 20% + ดาว (สูงสุด ⭐4 = ×2)'],
      ['🎁', 'ทอยมาตกจุดเริ่มพอดี: อัปเมืองฟรี 1 ขั้น'],
      ['🛣️', 'ตกที่คนอื่น = จ่ายค่าผ่านทาง'],
      ['🤝', 'จ่ายแล้วซื้อต่อได้ ราคา ×2'],
      ['🚫', 'แลนด์มาร์ก/ท่องเที่ยว ซื้อต่อไม่ได้'],
      ['👑', 'ผูกขาด 3 สี / ทั้งแถว / ท่องเที่ยว 4 = ชนะ'],
      ['⚠️', 'วงกระพริบ = อีก 1 ช่องผูกขาด!'],
      ['🎉', 'งานวัด: ค่าผ่านทาง ×2 · เลือกเมืองเดิมซ้ำ ซ้อนถึง ×16'],
      ['✈️', 'ทัวร์: ตาหน้าแตะช่อง เดินหน้าเสมอ ผ่านเริ่มได้เงิน'],
      ['🏝️', 'เกาะร้าง: ดับเบิล / จ่าย / รอ 3 ตา'],
      ['🎲🎲', 'ดับเบิล = ทอยอีก · 3 ครั้ง = เกาะ'],
      ['💸', 'เงินไม่พอ: ขายที่คืนครึ่ง · หมด = ล้ม'],
      ['⏰', S && S.clock && S.clock.endsAt ? 'หมดเวลา: ทรัพย์สินมากสุดชนะ' : 'ไม่จำกัดเวลา: เหลือคนสุดท้ายชนะ']
    ];
    return '<div class="st-dhead"><span class="st-dhead-art">' + iconHtml('crown') + '</span><div class="st-dhead-txt"><h3 id="stSheetTitle">เล่นยังไง</h3><div class="st-dhead-sub"><span class="st-chipline">เงินในเกม ไม่มีมูลค่าจริง</span></div></div></div>' +
      '<div class="st-facts">' + rows.map(function(r) { return '<div class="st-fact"><i>' + r[0] + '</i><span>' + esc(r[1]) + '</span></div>'; }).join('') + '</div>' +
      '<details class="st-credits"><summary>เครดิตรูปภาพ</summary><div class="st-credits-list" id="stCredits">' + creditsHtml() + '</div></details>';
  }
  // เครดิตรูปถ่าย (photos/credits.json จาก scripts/build-setthi-photos.js)
  var credits = null;
  function creditsHtml() {
    if (!credits) {
      if (credits === null) {
        credits = false;
        fetch(PHOTO_BASE + 'credits.json').then(function(r) { return r.json(); }).then(function(list) {
          credits = list;
          var n = document.getElementById('stCredits');
          if (n) n.innerHTML = creditsHtml();
        }).catch(function() { credits = null; });
      }
      return 'กำลังโหลด…';
    }
    var nameOfKey = {};
    SQ.forEach(function(q) { if (q.art) nameOfKey[q.art] = q.name; });
    return credits.map(function(c) {
      return '<div class="st-credit"><b>' + esc(nameOfKey[c.key] || c.key) + '</b><span>' + esc(c.author) + ' · <a href="' + esc(c.link) + '" target="_blank" rel="noopener">' + esc(c.source) + '</a> · <a href="' + esc(c.licenseUrl) + '" target="_blank" rel="noopener">' + esc(c.license) + '</a></span></div>';
    }).join('');
  }
  function logHtml() {
    return '<div class="st-dhead"><span class="st-dhead-art">' + iconHtml('book') + '</span><div class="st-dhead-txt"><h3 id="stSheetTitle">เพิ่งเกิดอะไร</h3></div></div>' +
      '<div class="st-log">' + (S.history || []).map(function(h) { return '<div class="st-log-item"><i>' + esc(h.icon || '•') + '</i><span>' + esc(h.text) + '</span></div>'; }).join('') + '</div>';
  }
  function btn(id, label, opts) {
    opts = opts || {};
    return '<button type="button" class="st-btn' + (opts.primary ? ' st-btn--primary' + (opts.pulse ? ' is-pulse' : '') : '') + (opts.cls ? ' ' + opts.cls : '') + '" id="' + id + '"' + (opts.disabled ? ' disabled' : '') + '>' +
      (opts.icon ? '<span class="st-btn-ico">' + iconHtml(opts.icon) + '</span>' : '') + '<span class="st-btn-label">' + label + '</span></button>';
  }

  /** แผ่นแวบ: โชว์ว่าคนอื่น (หรือบอท) เลือกอะไร ในหน้าตาเดียวกับแผ่นจริง */
  async function flashDecision(actorId, inner, stamp, good) {
    if (actorId === playerId) return;
    var who = seatOf(actorId);
    var card = fxNode('st-flash', '<div class="st-flash-who">' + tokenHtml(who) + '<b>' + esc(who ? who.name : '') + '</b></div>' + inner +
      '<div class="st-stamp2 ' + (good ? 'is-good' : 'is-bad') + '">' + esc(stamp) + '</div>');
    var st = card.querySelector('.st-stamp2');
    await A(card, [{ transform: 'translate(-50%, 30px) scale(0.96)', opacity: 0 }, { transform: 'translate(-50%, 0) scale(1)', opacity: 1 }], { duration: 200 });
    sfx.stamp();
    await A(st, [{ transform: 'scale(2.2) rotate(-6deg)', opacity: 0 }, { transform: 'scale(0.94) rotate(-10deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1) rotate(-10deg)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' });
    await wait(420);
    await A(card, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, 16px) scale(0.98)' }], { duration: 160 });
    card.remove();
  }

  // ---------- ฉาก ----------
  var FX = {};

  FX.turn = async function(f) {
    var who = seatOf(f.playerId);
    var mine = f.playerId === playerId;
    if (mine) { sfx.turn(); haptic([18, 40, 28]); }
    var t = tokenEls[f.playerId];
    if (camEnabled() && V && V.pos[f.playerId] !== undefined) camTo(camFor(V.pos[f.playerId], 1.35), 300);
    if (t) A(t, [{ transform: t.style.transform + ' scale(1)' }, { transform: t.style.transform + ' scale(1.5)' }, { transform: t.style.transform + ' scale(1)' }], { duration: 600, fill: 'none' });
    var b = banner({ token: who, kicker: 'รอบ ' + (f.round || 1), title: mine ? 'ตาคุณ!' : 'ตาของ ' + (who ? who.name : ''), cls: 'is-turn' + (mine ? ' is-mine' : ''), style: '--tk:' + (who ? who.tokenColor : '#f5c86b') });
    await A(b, [{ transform: 'translateX(-50%) scale(0.7)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await wait(430);
    await A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
  };

  // ผลเต๋าแบบเกม: ตัวเลขเด้งบนเต๋าแต่ละลูก → แต้มรวมตัวใหญ่ (ระดับคำตามแต้ม) → ป้ายพลังเต็ม/ดับเบิล/เตือน
  function totalTier(t) {
    if (t <= 4) return { cls: 'is-slow', text: 'เดินช้าๆ', num: String(t) };
    if (t <= 8) return { cls: 'is-ok', text: 'ได้ ' + t + '!', num: '' };
    if (t <= 11) return { cls: 'is-strong', text: 'แรงดี! ' + t, num: '' };
    return { cls: 'is-max', text: 'สุดยอด 12!!', num: '' };
  }
  FX.dice = async function(f) {
    await camReset(200);
    sfx.dice();
    var power = Number(f.power) || 0;
    var dice = el.board.querySelectorAll('.st-die');
    var W = el.cam.offsetWidth;
    var total = f.d[0] + f.d[1];
    var big = f.doubles || total === 12;
    if (!reduceMotion) {
      var ps = [];
      var throwK = 1 + power * 0.6;
      dice.forEach(function(d, k) {
        var v = f.d[k];
        var spinX = 720 + Math.floor(Math.random() * 2) * 360;
        var spinY = 540 + Math.floor(Math.random() * 2) * 360;
        var sx = (k ? 1 : -1) * W * (0.16 + Math.random() * 0.06) * throwK;
        var sy = -W * (0.24 + Math.random() * 0.05) * throwK;
        d.style.transform = dieTransform(v);
        ps.push(A(d, [
          { transform: dieTransform(v, spinX, spinY, sx, sy, 60) },
          { transform: dieTransform(v, spinX * 0.3, spinY * 0.3, sx * 0.2, W * 0.02, 0), offset: 0.6 },
          { transform: dieTransform(v, spinX * 0.06, spinY * 0.06, sx * 0.04, -W * 0.025, 10), offset: 0.8 },
          { transform: dieTransform(v) }
        ], { duration: 620 + power * 200, delay: k * 60, easing: 'cubic-bezier(0.3, 0.6, 0.35, 1)', fill: 'none' }));
      });
      await Promise.all(ps);
    } else {
      setDice(f.d);
    }
    // ตัวเลขบนเต๋าแต่ละลูก
    var nums = [];
    dice.forEach(function(d, k) {
      var at = centerOf(d);
      var n = fxNode('st-die-num', String(f.d[k]));
      n.style.transform = 'translate(' + at.x + 'px,' + (at.y - 34) + 'px) translate(-50%, -50%)';
      nums.push(A(n, [{ transform: 'translate(' + at.x + 'px,' + (at.y - 20) + 'px) translate(-50%, -50%) scale(0.2)', opacity: 0 }, { transform: 'translate(' + at.x + 'px,' + (at.y - 38) + 'px) translate(-50%, -50%) scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'translate(' + at.x + 'px,' + (at.y - 34) + 'px) translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 220, delay: k * 80, easing: 'cubic-bezier(0.34,1.56,0.64,1)' }));
    });
    sfx.tick();
    await Promise.all(nums);
    // แต้มรวม
    var c0 = centerOf($('#stDice'));
    var tier = totalTier(total);
    var label = f.purpose === 'island' ? (f.doubles ? 'ดับเบิล! หนีออกจากเกาะ' : total + ' · ไม่ใช่ดับเบิล') : tier.text;
    var tot = fxNode('st-total ' + (f.purpose === 'island' && !f.doubles ? 'is-slow' : tier.cls), '<b>' + esc(label) + '</b>' + (tier.num && f.purpose !== 'island' ? '<span>' + tier.num + '</span>' : ''));
    var badges = '';
    if (power >= 0.85 && f.purpose !== 'island') badges += '<span class="st-badge2 is-power">พลังเต็ม!</span>';
    if (f.perfect) badges += '<span class="st-badge2 is-green">เป๊ะ! ช่องเขียว</span>';
    if (badges) tot.insertAdjacentHTML('beforeend', '<div class="st-badges2">' + badges + '</div>');
    var ty = c0.y + 46;
    A(tot, [{ transform: 'translate(' + c0.x + 'px,' + ty + 'px) translate(-50%, -50%) scale(0.4)', opacity: 0 }, { transform: 'translate(' + c0.x + 'px,' + ty + 'px) translate(-50%, -50%) scale(1.12)', opacity: 1, offset: 0.65 }, { transform: 'translate(' + c0.x + 'px,' + ty + 'px) translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    if (total === 12) { sfx.big(); burst(c0, ['#f5c86b', '#fff3c4', '#ef5b4c'], 22, 110); }
    if (power >= 0.85) haptic(14);
    if (f.doubles && f.purpose !== 'island') {
      await wait(220);
      var streak = f.streak || 1;
      var rib = fxNode('st-ribbon' + (streak >= 3 ? ' is-alarm' : ''), '<b>ดับเบิล!</b><span>' + (streak >= 3 ? 'ครบ 3 ครั้ง!' : 'ทอยอีกครั้ง!') + '</span>' + (streak === 2 ? '<em>อีกครั้งติดเกาะ!</em>' : ''));
      sfx.fanfare();
      haptic([10, 30, 10]);
      await A(rib, [{ transform: 'translate(-50%, -50%) scaleX(0.1) rotate(-4deg)', opacity: 0 }, { transform: 'translate(-50%, -50%) scaleX(1.06) rotate(-4deg)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -50%) scaleX(1) rotate(-4deg)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
      if (streak === 2) { var em = rib.querySelector('em'); if (em) A(em, [{ opacity: 0.4 }, { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 600 }); sfx.bad(); }
      if (streak >= 3) {
        sfx.alarm();
        haptic([60, 40, 60, 40, 60]);
        var flash = fxNode('st-alarm');
        await A(flash, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0 }], { duration: 900 });
      } else {
        await wait(780);
      }
    } else if (f.purpose === 'island' && f.doubles) {
      sfx.fanfare();
      await wait(800);
    } else {
      await wait(total === 12 ? 900 : 520);
    }
  };

  var stepBubble = null;
  function showStepBubble(n, xy) {
    if (!stepBubble) { stepBubble = document.createElement('div'); stepBubble.className = 'st-steps'; el.tokens.appendChild(stepBubble); }
    stepBubble.textContent = n;
    var size = tokenSize();
    stepBubble.style.transform = 'translate(' + (xy.x + size / 2) + 'px,' + (xy.y - size * 0.55) + 'px) translate(-50%, -100%)';
    stepBubble.classList.add('is-on');
  }
  function hideStepBubble() { if (stepBubble) stepBubble.classList.remove('is-on'); }

  FX.move = async function(f) {
    var t = tokenEls[f.playerId];
    if (!t || !V) return;
    var path = f.path || [];
    var hops = path.length;
    var useCam = camEnabled();
    V.island[f.playerId] = 0;
    t.classList.remove('is-island');
    if (f.warp) sfx.whoosh();
    if (useCam) await camTo(camFor(f.from), 240);
    var per = f.warp ? 85 : (hops > 14 ? Math.max(90, 2600 / hops) : 210);
    var cur = t.style.transform;
    for (var k = 0; k < hops; k += 1) {
      var sq = path[k];
      var xy = slotXY(sq, 0, 1);
      var target = 'translate(' + xy.x + 'px,' + xy.y + 'px)';
      var fromT = cur.replace(/ ?translateY\([^)]*\)| ?scale\([^)]*\)/g, '');
      t.style.transform = target;
      var hop = A(t, [
        { transform: fromT + ' translateY(0px) scale(1)' },
        { transform: 'translate(' + xy.x + 'px,' + xy.y + 'px) translateY(-' + Math.round(tokenSize() * 0.9) + 'px) scale(1.2)', offset: 0.45 },
        { transform: target + ' translateY(0px) scale(1)' }
      ], { duration: per, easing: 'ease-in-out', fill: 'none' });
      if (useCam) camTo(camFor(sq), per);
      showStepBubble(hops - k - 1 > 0 ? hops - k - 1 : '✓', xy);
      if (!f.warp || k % 3 === 0) sfx.hop(k % 4);
      await hop;
      cur = target;
      if (sq === 0 && f.passGo) passGoPop(f.playerId);
    }
    V.pos[f.playerId] = f.to;
    placeTokens(V);
    pulseCell(f.to, 'is-land', 900);
    await wait(220);
    hideStepBubble();
  };

  function passGoPop(id) {
    var salaryFx = (S.fx || []).find(function(x) { return x.kind === 'salary' && x.playerId === id && x.seq > lastPlayedSeq; });
    var at = cellPoint(0);
    var pop = fxNode('st-salary', '<small>เงินเดือน</small>+' + money(BOARD.salary));
    A(pop, [
      { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.4)', opacity: 0 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 40) + 'px) translate(-50%, -50%) scale(1.12)', opacity: 1, offset: 0.25 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 52) + 'px) translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 70) + 'px) translate(-50%, -50%) scale(0.95)', opacity: 0 }
    ], { duration: 1300, easing: 'ease-out' });
    flyCoins(at, centerOf(chipOf(id)), BOARD.salary);
    sfx.coin();
    if (salaryFx && salaryFx.cash) setCash(salaryFx.cash);
  }
  var lastPlayedSeq = 0;

  // ซื้อ / สร้าง / อัปเกรด
  FX.build = async function(f) {
    var i = f.square;
    var d = { square: i, mode: f.mode === 'buy' || f.from < 0 ? 'buy' : 'upgrade', cash: (V && V.cash[f.playerId]) || 0, current: f.from, options: [] };
    var levels = isTour(i) ? [0] : [0, 1, 2, 3, 4];
    levels.forEach(function(k) { d.options.push({ level: k, cost: costOf(i, k), built: k <= f.from, locked: null }); });
    if (f.mode === 'buy' || f.mode === 'upgrade' || f.mode === 'afterTakeover') {
      var verb = f.mode === 'buy' ? 'ซื้อ' : 'สร้าง';
      await flashDecision(f.playerId, buildSheetHtml(d, true, f.to), verb + ' ✔', true);
    }
    setCash(f.cash);
    var c = cells[i];
    if (!c || !V) return;
    if (camEnabled()) await camTo(camFor(i), 220);
    var at = centerOf(c);
    if (f.to === 4) { await landmarkScene(f); return; }
    // ชิ้นสิ่งปลูกสร้างตกลงมาทีละขั้น
    var first = Math.max(0, f.from + 1);
    for (var k = first; k <= f.to; k += 1) {
      var drop = fxNode('st-drop', '<img src="' + (isTour(i) ? placeSrc(SQ[i].art, 't') : artSrc(TIER_ART[k])) + '" alt="" width="56" height="56">');
      sfx.build();
      await A(drop, [
        { transform: 'translate(' + at.x + 'px,' + (at.y - 110) + 'px) translate(-50%, -50%) scale(1.2)', opacity: 0 },
        { transform: 'translate(' + at.x + 'px,' + (at.y - 8) + 'px) translate(-50%, -50%) scale(1.05)', opacity: 1, offset: 0.65 },
        { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(1.1, 0.88)', opacity: 1, offset: 0.82 },
        { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.4)', opacity: 0 }
      ], { duration: f.to - first > 1 ? 300 : 440, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' });
      drop.remove();
    }
    var wasOwner = V.props[i] && V.props[i].owner;
    V.props[i] = { owner: f.playerId, level: f.to };
    renderCell(i, V);
    renderStripLands();
    if (wasOwner !== f.playerId) { var bw = seatOf(f.playerId); floodCell(i, bw ? bw.tokenColor : '#f5c86b'); }
    var ring = fxNode('st-ring');
    A(ring, [{ transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.3)', opacity: 0.9 }, { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(1.8)', opacity: 0 }], { duration: 500, easing: 'ease-out' });
    var who = seatOf(f.playerId);
    burst(at, [who ? who.tokenColor : '#f5c86b', '#fff3c4'], f.to >= 3 ? 18 : 10, 46);
    if (f.cost) moneyTag(centerOf(chipOf(f.playerId)), f.cost, false);
    if (f.mode === 'startBonus' || f.mode === 'freeUpgrade') moneyTag({ x: at.x, y: at.y - 30 }, f.cost || 0, false, 'อัปฟรี!');
    await wait(300);
  };

  async function landmarkScene(f) {
    var i = f.square;
    var who = seatOf(f.playerId);
    setModal(true);
    scrim(true, 220);
    sfx.big();
    haptic([20, 40, 20, 40, 40]);
    var rays = fxNode('st-rays');
    var img = fxNode('st-lm-rise', '<img src="' + placeSrc(SQ[i].art, 'w') + '" alt="" width="320" height="200">');
    var b = banner({ token: who, kicker: SQ[i].name, title: 'แลนด์มาร์ก!', sub: 'ค่าผ่านทาง ' + money(SQ[i].tolls[4]) + ' · ซื้อต่อไม่ได้', cls: 'is-gold', style: 'top:auto;bottom:16%;' });
    A(rays, [{ transform: 'translate(-50%, -50%) rotate(0deg) scale(0.4)', opacity: 0 }, { transform: 'translate(-50%, -50%) rotate(40deg) scale(1)', opacity: 1 }], { duration: 1600 });
    await A(img, [{ transform: 'translate(-50%, -30%) scale(0.3)', opacity: 0 }, { transform: 'translate(-50%, -58%) scale(1.08)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -55%) scale(1)', opacity: 1 }], { duration: 620, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    A(b, [{ transform: 'translateX(-50%) scale(0.7)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    burst({ x: window.innerWidth / 2, y: window.innerHeight * 0.4 }, ['#f5c86b', '#fff3c4', who ? who.tokenColor : '#ef5b4c'], 30, 160);
    await wait(900);
    V.props[i] = { owner: f.playerId, level: 4 };
    renderCell(i, V);
    await Promise.all([A(img, [{ opacity: 1 }, { opacity: 0, transform: 'translate(-50%, -55%) scale(0.6)' }], { duration: 260 }), A(rays, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }), A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }), scrim(false, 240)]);
    var lm = cells[i] && cells[i].querySelector('.st-lm');
    if (lm) A(lm, [{ transform: 'scale(2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 360, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'none' });
    pulseCell(i, 'is-land', 900);
  }

  FX.startExact = async function(f) {
    if (f.can) await showBanner({ token: seatOf(f.playerId), icon: 'go', kicker: 'ตกจุดเริ่มพอดี!', title: 'อัปฟรี 1 ขั้น', sub: 'แตะเมืองตัวเองที่เรืองแสง', cls: 'is-gold' }, 650);
    else await showBanner({ token: seatOf(f.playerId), icon: 'go', kicker: 'ตกจุดเริ่มพอดี', title: 'ไม่มีเมืองที่อัปได้' }, 500);
  };

  FX.landmarkStar = async function(f) {
    var i = f.square;
    var who = seatOf(f.playerId);
    if (camEnabled()) await camTo(camFor(i), 220);
    var at = cellPoint(i);
    flyCoins(bankPoint(), centerOf(chipOf(f.playerId)), f.bonus);
    setCash(f.cash);
    if (V) { V.props[i] = Object.assign({}, V.props[i], { stars: f.stars }); renderCell(i, V); }
    burst(at, ['#f5c86b', '#fff3c4', who ? who.tokenColor : '#ef5b4c'], 22, 70);
    sfx.fanfare();
    if (f.playerId === playerId) haptic([15, 30, 15]);
    await showBanner({ token: who, art: SQ[i].art, kicker: SQ[i].name + ' · โบนัส +' + money(f.bonus), title: f.upgraded ? (f.stars >= 4 ? 'แลนด์มาร์กเต็ม ⭐4' : 'แลนด์มาร์กอัปเกรด! ⭐' + f.stars) : 'แลนด์มาร์กเต็ม ⭐4', sub: 'ค่าผ่านทาง ' + money(f.toll), cls: 'is-gold', style: 'top:34%;' }, 750);
  };

  FX.decision = async function(f) {
    if (f.playerId === playerId) return;
    var what = { build: 'ไม่ซื้อ', takeover: 'ไม่ซื้อต่อ', tour: 'ไม่วาร์ป', festival: 'ข้าม', startBonus: 'ข้าม', freeUpgrade: 'ข้าม' }[f.about] || 'ผ่าน';
    var inner = f.square !== null && f.square !== undefined && SQ[f.square] ? sheetHeadArt(f.square, SQ[f.square].short, groupChip(f.square)) : '';
    await flashDecision(f.playerId, inner, what + ' ✖', false);
  };

  FX.toll = async function(f) {
    var i = f.square;
    var hasSq = i !== undefined && i !== null && cells[i];
    var payerToken = tokenEls[f.from];
    var from = payerToken && V && !V.out[f.from] ? centerOf(payerToken) : centerOf(chipOf(f.from));
    var to = centerOf(chipOf(f.to));
    if (hasSq) cells[i].classList.add('is-land');
    var owner = seatOf(f.to);
    var rib = fxNode('st-toll', '<span class="st-toll-k">ค่าผ่านทาง' + (f.festival ? ' <em>งานวัด ×2</em>' : '') + '</span><b>' + money(f.amount) + '</b><span class="st-toll-to">' + tokenHtml(seatOf(f.from)) + '→' + tokenHtml(owner) + '</span>');
    if (f.from === playerId) { haptic([30, 30]); sfx.bad(); }
    await A(rib, [{ transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 }, { transform: 'translate(-50%, -50%) scale(1.06)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await flyCoins(from, to, f.amount);
    setCash(f.cash);
    moneyTag(to, f.amount, true);
    if (f.to === playerId) haptic(10);
    await wait(380);
    await A(rib, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
    if (hasSq) cells[i].classList.remove('is-land');
  };

  FX.shield = async function(f) {
    var angel = f.shield === 'angel';
    await showBanner({ token: seatOf(f.playerId), icon: angel ? 'angel' : 'ticket', kicker: angel ? 'การ์ดนางฟ้า' : 'ส่วนลดครึ่ง', title: angel ? 'ไม่ต้องจ่าย!' : 'จ่ายครึ่งเดียว!', sub: 'ประหยัด ' + money(f.saved), cls: 'is-gold' }, 650);
  };

  FX.takeover = async function(f) {
    var i = f.square;
    var buyer = seatOf(f.playerId);
    var victim = seatOf(f.from);
    await flashDecision(f.playerId, takeoverSheetHtml({ square: i, owner: f.from, playerId: f.playerId, price: f.price, level: f.level, cash: (V && V.cash[f.playerId]) || 0 }, true), 'ซื้อต่อ ✔', true);
    setModal(true);
    scrim(true, 200);
    var mineLost = f.from === playerId;
    var node = fxNode('st-take-scene' + (mineLost ? ' is-lost' : ''),
      '<div class="st-take-title">' + (mineLost ? 'ถูกซื้อต่อ!' : 'ซื้อต่อ!') + '</div>' +
      '<div class="st-take-card"><img src="' + placeSrc(SQ[i].art, 'w') + '" alt="" width="240" height="150"><b>' + esc(SQ[i].name) + '</b><span class="st-take-bld">' + bldIcons(f.level) + '</span></div>' +
      '<div class="st-take-swap">' + tokenHtml(victim, 'is-old') + '<span class="st-swap-arrow">→</span>' + tokenHtml(buyer, 'is-new') + '</div>' +
      '<div class="st-take-amt">' + money(f.price) + '</div>');
    if (mineLost) { sfx.sad(); haptic([60, 40, 60]); } else { sfx.stamp(); haptic(20); }
    var card = node.querySelector('.st-take-card');
    var title = node.querySelector('.st-take-title');
    await Promise.all([
      A(title, [{ transform: 'scale(2.4) rotate(-6deg)', opacity: 0 }, { transform: 'scale(0.95) rotate(-4deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1) rotate(-4deg)', opacity: 1 }], { duration: 360, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' }),
      A(card, [{ transform: 'rotateY(0deg) scale(0.8)', opacity: 0 }, { transform: 'rotateY(0deg) scale(1)', opacity: 1 }], { duration: 300 })
    ]);
    card.style.setProperty('--own', victim ? victim.tokenColor : '#888');
    await A(card, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)', offset: 0.5 }, { transform: 'rotateY(0deg)' }], { duration: 520 });
    card.style.setProperty('--own', buyer ? buyer.tokenColor : '#f5c86b');
    setCash(f.cash);
    V.props[i] = { owner: f.playerId, level: f.level };
    renderCell(i, V);
    renderStripLands();
    floodCell(i, buyer ? buyer.tokenColor : '#f5c86b');
    burst(centerOf(card), [buyer ? buyer.tokenColor : '#f5c86b', '#fff3c4'], 18, 110);
    await wait(700);
    await Promise.all([A(node, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }), scrim(false, 200)]);
  };

  FX.card = async function(f) {
    var center = $('#stDice');
    var from = centerOf(center);
    setModal(true);
    sfx.card();
    var who = seatOf(f.playerId);
    var sub = {
      forward: 'เดินหน้า ' + (f.card.steps || 3) + ' ช่อง', toStart: 'รับเงินเดือน + โบนัส', freeUpgrade: 'เลือกเมืองตัวเอง +1 ขั้น',
      shield: f.card.kind === 'angel' ? 'ตกที่คนอื่นครั้งหน้า ไม่ต้องจ่าย' : 'ค่าผ่านทางครั้งหน้า ลดครึ่ง', island: 'ติดเกาะ 3 ตา',
      pay: '−' + money(f.card.amount), gain: '+' + money(f.card.amount), festival: 'เลือกที่ตัวเอง ×2', tour: 'ตาหน้าเลือกช่องไหนก็ได้'
    }[f.card.type] || '';
    var card = fxNode('st-bigcard', '<div class="st-bigcard-inner"><div class="st-bigcard-back">' + iconHtml('chance') + '</div>' +
      '<div class="st-bigcard-face"><div class="st-bigcard-kicker">โอกาส</div><div class="st-bigcard-art">' + iconHtml(f.card.icon) + '</div>' +
      '<div class="st-bigcard-title">' + esc(f.card.title) + '</div><div class="st-bigcard-text">' + esc(sub) + '</div><div class="st-bigcard-who">' + tokenHtml(who) + '</div></div></div>');
    var inner = card.querySelector('.st-bigcard-inner');
    scrim(true, 220);
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight * 0.44;
    inner.style.transform = 'rotateY(180deg)';
    await Promise.all([
      A(card, [{ transform: 'translate(' + (from.x - cx) + 'px,' + (from.y - cy) + 'px) translate(-50%, -50%) scale(0.2)' }, { transform: 'translate(0px, -16px) translate(-50%, -50%) scale(1.04)', offset: 0.7 }, { transform: 'translate(0px, 0px) translate(-50%, -50%) scale(1)' }], { duration: 520, fill: 'none' }),
      A(inner, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(0deg)', offset: 0.3 }, { transform: 'rotateY(180deg)' }], { duration: 640, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'none' })
    ]);
    if (f.playerId === playerId) haptic(12);
    await wait(950);
    await Promise.all([A(card, [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }, { transform: 'translate(-50%, -40%) scale(0.86)', opacity: 0 }], { duration: 200 }), scrim(false, 200)]);
  };

  FX.island = async function(f) {
    var t = tokenEls[f.playerId];
    var who = seatOf(f.playerId);
    if (t && V && f.reason !== 'landed') {
      var xy = slotXY(8, 0, 1);
      var from = t.style.transform;
      var to = 'translate(' + xy.x + 'px,' + xy.y + 'px)';
      t.style.transform = to;
      sfx.whoosh();
      await A(t, [{ transform: from + ' scale(1)' }, { transform: from + ' translateY(-24px) scale(1.6)', offset: 0.3 }, { transform: to + ' scale(1)' }], { duration: 560, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'none' });
    }
    if (V) { V.pos[f.playerId] = 8; V.island[f.playerId] = BOARD.islandTurns; placeTokens(V); }
    setModal(true);
    scrim(true, 200);
    if (f.playerId === playerId) haptic([40, 60, 40]);
    sfx.sad();
    var b = banner({ token: who, art: 'island', kicker: (who ? (who.playerId === playerId ? 'คุณ' : who.name) : '') + (f.reason === 'triple' ? ' · ดับเบิล 3 ครั้ง!' : f.reason === 'card' ? ' · การ์ดโอกาส' : ''), title: 'ติดเกาะร้าง!', sub: '<span class="st-pips"><i></i><i></i><i></i></span> ดับเบิล · จ่าย ' + money(BOARD.islandFee) + ' · รอ 3 ตา', cls: 'is-island', style: 'top:30%;' });
    var waves = fxNode('st-waves');
    A(waves, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 600 });
    await A(b, [{ transform: 'translateX(-50%) scale(0.85)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 280 });
    await wait(900);
    await Promise.all([A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }), A(waves, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }), scrim(false, 200)]);
  };
  FX.islandFree = async function(f) {
    if (V) { V.island[f.playerId] = 0; placeTokens(V); }
    var how = { fee: 'นั่งเรือออก ⛵', doubles: 'ดับเบิล! 🎲', served: 'ครบ 3 ตา' }[f.how] || '';
    await showBanner({ token: seatOf(f.playerId), kicker: how, title: 'ออกจากเกาะ!', cls: 'is-island' }, 420);
  };
  FX.islandStay = async function(f) {
    if (V) V.island[f.playerId] = f.left;
    var pips = '';
    for (var k = 0; k < BOARD.islandTurns; k += 1) pips += '<i class="' + (k < BOARD.islandTurns - f.left ? 'is-used' : '') + '"></i>';
    await showBanner({ token: seatOf(f.playerId), kicker: 'ไม่ใช่ดับเบิล', title: 'ยังติดเกาะ', sub: '<span class="st-pips">' + pips + '</span> เหลือ ' + f.left + ' ตา', cls: 'is-island' }, 380);
  };

  FX.festival = async function(f) {
    var i = f.square;
    if (camEnabled()) await camTo(camFor(i), 240);
    var at = centerOf(cells[i]);
    var flag = fxNode('st-flag-drop', iconHtml('flag'));
    sfx.fanfare();
    await A(flag, [{ transform: 'translate(' + at.x + 'px,' + (at.y - 120) + 'px) translate(-50%, -50%) scale(1.6)', opacity: 0 }, { transform: 'translate(' + at.x + 'px,' + (at.y - 10) + 'px) translate(-50%, -50%) scale(1)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(0.5, 0, 0.5, 1.4)' });
    if (V) { V.festival = i; V.festivalMult = f.mult || 2; renderCells(V); }
    var n = Math.min(4, Math.log2(f.mult || 2));
    for (var k = 0; k < n; k += 1) burst({ x: at.x + (k - n / 2) * 30, y: at.y - 20 - k * 12 }, ['#ef5b4c', '#f5c86b', '#4ea8dc', '#3fbf7f', '#fff3c4'], 16 + k * 6, 70 + k * 25);
    if (f.stacked) sfx.big();
    await showBanner({ token: seatOf(f.playerId), kicker: SQ[i].name, title: f.stacked ? (f.mult >= 16 && !f.grew ? 'งานวัดใหญ่ขึ้น! ×' + f.mult : 'งานวัดใหญ่ขึ้น! ×' + f.mult) : 'งานวัด! ×2', sub: 'ค่าผ่านทาง ' + money(f.toll || (V ? tollIn(V, i) : 0)), cls: 'is-fest', style: 'top:auto;bottom:22%;' }, 560);
  };

  FX.tourReady = async function(f) {
    await showBanner({ token: seatOf(f.playerId), icon: 'plane', title: 'ได้ตั๋วทัวร์!', sub: 'ตาหน้าแตะช่องที่อยากไป' }, 520);
  };

  FX.pay = async function(f) {
    var from = centerOf(chipOf(f.from));
    var to = f.to ? centerOf(chipOf(f.to)) : bankPoint();
    moneyTag(from, f.amount, false, f.reason || '');
    await flyCoins(from, to, f.amount);
    setCash(f.cash);
    await wait(160);
  };
  FX.tax = async function(f) {
    if (!f.amount) { await showBanner({ token: seatOf(f.from), icon: 'tax', title: 'ไม่มีที่ ไม่เสียภาษี' }, 360); return; }
    await FX.pay(Object.assign({}, f, { reason: 'ภาษี 10%' }));
  };
  FX.gain = async function(f) {
    var to = centerOf(chipOf(f.playerId));
    await flyCoins(bankPoint(), to, f.amount);
    setCash(f.cash);
    moneyTag(to, f.amount, true);
    await wait(180);
  };
  FX.sell = async function(f) {
    setCash(f.cash);
    var at = cellPoint(f.square);
    if (V) { V.props[f.square] = { owner: null, level: 0 }; if (V.festival === f.square) V.festival = null; renderCell(f.square, V); renderStripLands(); }
    pulseCell(f.square, 'is-sold', 700);
    await moneyTag(at, f.amount, true, 'ขายคืน');
  };

  var MONO_ICON = { color: 'crown', line: 'flag', tourist: 'camera' };
  FX.monopoly = async function(f) {
    var who = seatOf(f.playerId);
    setModal(true);
    scrim(true, 240);
    sfx.big();
    haptic([30, 40, 30, 40, 60]);
    (f.squares || []).forEach(function(i) { if (cells[i]) { cells[i].classList.add('is-win'); cells[i].style.setProperty('--win', who ? who.tokenColor : '#f5c86b'); } });
    var rays = fxNode('st-rays');
    A(rays, [{ transform: 'translate(-50%, -50%) rotate(0deg) scale(0.4)', opacity: 0 }, { transform: 'translate(-50%, -50%) rotate(60deg) scale(1.2)', opacity: 1 }], { duration: 2400 });
    var b = banner({ token: who, icon: MONO_ICON[f.type], kicker: who ? who.name : '', title: MONO[f.type] + '!', sub: 'ชนะทันที 👑', cls: 'is-gold is-huge', style: 'top:26%;' });
    await A(b, [{ transform: 'translateX(-50%) scale(0.4)', opacity: 0 }, { transform: 'translateX(-50%) scale(1.1)', opacity: 1, offset: 0.7 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    confetti(70);
    burst({ x: window.innerWidth / 2, y: window.innerHeight * 0.32 }, [who ? who.tokenColor : '#f5c86b', '#f5c86b', '#fff3c4'], 36, 180);
    await wait(2400);
    await Promise.all([A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }), A(rays, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }), scrim(false, 260)]);
  };

  FX.bankrupt = async function(f) {
    var who = seatOf(f.playerId);
    setModal(true);
    scrim(true, 200);
    sfx.sad();
    var inner = tokenHtml(who) + '<div class="st-banner-kicker">ที่ดินคืนธนาคาร</div><div class="st-banner-title">ล้มละลาย!</div><div class="st-banner-sub">' + esc(who ? who.name : '') + '</div>';
    var wrap = fxNode('st-break', '<div class="st-break-half is-l"><div class="st-banner">' + inner + '</div></div><div class="st-break-half is-r"><div class="st-banner">' + inner + '</div></div>' +
      '<svg class="st-break-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="52,0 47,30 55,52 46,75 51,100" fill="none" stroke="#fff7e0" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>');
    var halves = wrap.querySelectorAll('.st-break-half');
    var line = wrap.querySelector('.st-break-line');
    if (f.playerId === playerId) haptic([60, 40, 60]);
    await A(wrap, [{ transform: 'translateX(-50%) scale(1.25)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await A(wrap, [{ transform: 'translateX(-50%) translateX(0)' }, { transform: 'translateX(-50%) translateX(-10px) rotate(-1.5deg)' }, { transform: 'translateX(-50%) translateX(9px) rotate(1.2deg)' }, { transform: 'translateX(-50%) translateX(0)' }], { duration: 320 });
    sfx.stamp();
    await A(line, [{ opacity: 0 }, { opacity: 1 }], { duration: 90 });
    await wait(420);
    await Promise.all([
      A(halves[0], [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(-34px, 160px) rotate(-14deg)', opacity: 0 }], { duration: 600, easing: 'cubic-bezier(0.55, 0, 0.9, 0.4)' }),
      A(halves[1], [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(38px, 180px) rotate(16deg)', opacity: 0 }], { duration: 640, easing: 'cubic-bezier(0.55, 0, 0.9, 0.4)' })
    ]);
    if (V) {
      V.out[f.playerId] = true;
      (f.squares || []).forEach(function(i) { V.props[i] = { owner: null, level: 0 }; if (V.festival === i) V.festival = null; renderCell(i, V); });
      var t = tokenEls[f.playerId];
      if (t) A(t, [{ opacity: 1 }, { opacity: 0, transform: t.style.transform + ' scale(0.2)' }], { duration: 360 });
    }
    setCash(f.cash);
    await scrim(false, 200);
  };

  FX.timeUp = async function() {
    sfx.alarm();
    await showBanner({ icon: 'clock', kicker: 'หมดเวลา', title: 'รอบสุดท้าย!', sub: 'จบรอบนี้แล้วนับทรัพย์สิน' }, 900);
  };
  FX.finished = async function() {
    renderAll();
    showEnd(true, true);
  };

  // ---------- วาดทั้งหมด ----------
  function renderAll() {
    if (!S) return;
    V = modelFrom(S);
    renderCells(V);
    placeTokens(V);
    renderStrip();
    renderAlerts();
    renderCenter();
    renderClock();
    renderSidebar();
    renderPick();
    renderDock();
    if (S.turn && S.turn.lastRoll) setDice(S.turn.lastRoll);
    paintFast();
    paintDebug();
    syncSheets();
    if (S.phase === 'finished' && !running && !endShown) showEnd(false, true);
  }

  function renderStrip() {
    if (!S) return;
    var model = V || modelFrom(S);
    el.strip.innerHTML = (S.seats || []).map(function(s) {
      var out = isOut(s);
      var badge = '';
      if (s.left) badge = '<span class="st-badge st-badge--off">ออกแล้ว</span>';
      else if (s.bankrupt) badge = '<span class="st-badge st-badge--off">ล้มละลาย</span>';
      else if (!s.online && !s.isBot) badge = '<span class="st-badge st-badge--off">หลุด</span>';
      else if (s.island) badge = '<span class="st-badge st-badge--island">🏝️ ' + s.island + '</span>';
      else if (s.tourPending) badge = '<span class="st-badge st-badge--tour">✈️</span>';
      else if (s.shield) badge = '<span class="st-badge st-badge--shield">' + (s.shield === 'angel' ? '😇' : '🎟️') + '</span>';
      var lands = landsOf(s.playerId, model);
      return '<button type="button" class="st-chip' + (s.isTurn ? ' is-turn' : '') + (out ? ' is-out' : '') + (s.isSelf ? ' is-self' : '') + (focusId === s.playerId ? ' is-focus' : '') + '" data-id="' + esc(s.playerId) + '" style="--tk:' + esc(s.tokenColor) + '" aria-pressed="' + (focusId === s.playerId) + '" aria-label="' + esc(s.name + ' เงิน ' + money(model.cash[s.playerId]) + ' ที่ดิน ' + lands + ' ช่อง' + (s.isTurn ? ' กำลังเล่น' : '') + ' — แตะเพื่อดูที่ของคนนี้') + '">' +
        tokenHtml(s) +
        '<span class="st-chip-body"><span class="st-chip-name">' + esc(s.isSelf ? 'คุณ' : s.name) + '</span><span class="st-chip-cash">' + money(out ? 0 : model.cash[s.playerId]) + '</span></span>' +
        '<span class="st-chip-lands" data-lands>🏠<b>' + lands + '</b></span>' + badge + '</button>';
    }).join('');
  }
  function landsOf(id, model) { var n = 0; Object.keys(model.props).forEach(function(k) { if (model.props[k].owner === id) n += 1; }); return n; }
  function renderStripLands() {
    if (!V) return;
    el.strip.querySelectorAll('.st-chip').forEach(function(c) { var b = c.querySelector('[data-lands] b'); if (b) b.textContent = landsOf(c.dataset.id, V); });
  }
  function renderAlerts() {
    if (!S) return;
    var list = (S.threats || []).slice(0, 3);
    el.alerts.innerHTML = list.map(function(t) {
      var s = seatOf(t.playerId);
      if (!s) return '';
      return '<div class="st-alert" style="--tk:' + esc(s.tokenColor) + '"><span class="st-alert-ico">⚠️</span>' + tokenHtml(s) + '<b>' + esc(s.isSelf ? 'คุณ' : s.name) + '</b><span>อีก 1 ช่อง ' + esc(MONO[t.type]) + '!</span></div>';
    }).join('');
    el.alerts.classList.toggle('is-on', !!list.length);
  }
  function renderCenter() {
    var node = $('#stTurnline');
    var last = $('#stLastLog');
    if (!node || !S) return;
    if (S.phase === 'finished') node.innerHTML = '<b>จบเกม</b>';
    else {
      var t = S.turn ? seatOf(S.turn.playerId) : null;
      node.innerHTML = t ? tokenHtml(t) + '<span>' + (t.playerId === playerId ? '<b>ตาคุณ</b>' : 'ตาของ <b>' + esc(t.name) + '</b>') + '</span>' : '';
    }
    var h = (S.history || [])[0];
    last.innerHTML = h ? '<i>' + esc(h.icon || '•') + '</i><span>' + esc(h.text) + '</span>' : '';
  }
  function renderClock() {
    if (!S || !S.clock) return;
    var c = S.clock;
    el.clock.classList.toggle('is-final', !!c.timeUp);
    if (c.timeUp) { el.clockTxt.textContent = 'รอบสุดท้าย'; return; }
    if (!c.endsAt) { el.clockTxt.textContent = 'รอบ ' + (S.round || 1); return; }
    var left = Math.max(0, c.endsAt - nowServer());
    var m = Math.floor(left / 60000);
    var s = Math.floor((left % 60000) / 1000);
    el.clockTxt.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    el.clock.setAttribute('aria-label', 'เวลาเกมเหลือ ' + m + ' นาที ' + s + ' วินาที');
  }
  function paintFast() {
    if (!el.fast || !S) return;
    el.fast.setAttribute('aria-pressed', S.fast ? 'true' : 'false');
    el.fast.classList.toggle('is-on', !!S.fast);
    el.fast.disabled = !(S.availableActions && S.availableActions.fast);
  }

  // แถบเวลาตา
  var timerKey = '';
  var timerTotal = 0;
  var timerAnim = null;
  function syncTimer() {
    var bar = el.timer.querySelector('i');
    if (!S || !S.phaseEndsAt || S.phase === 'finished') {
      if (timerAnim) { timerAnim.cancel(); timerAnim = null; }
      timerKey = '';
      bar.style.transform = 'scaleX(0)';
      return;
    }
    var key = S.phaseSeq + ':' + S.phaseEndsAt;
    if (key === timerKey) return;
    var remain = Math.max(0, S.phaseEndsAt - nowServer());
    if (!timerKey || timerKey.split(':')[0] !== String(S.phaseSeq) || remain > timerTotal) timerTotal = Math.max(remain, 1000);
    timerKey = key;
    var frac = Math.max(0, Math.min(1, remain / timerTotal));
    if (timerAnim) timerAnim.cancel();
    bar.style.transform = 'scaleX(0)';
    timerAnim = bar.animate([{ transform: 'scaleX(' + frac + ')' }, { transform: 'scaleX(0)' }], { duration: Math.max(1, remain), easing: 'linear', fill: 'none' });
  }
  function secondsLeft() {
    if (!S || !S.phaseEndsAt) return null;
    return Math.max(0, Math.ceil((S.phaseEndsAt - nowServer()) / 1000));
  }

  // ---------- แผงล่าง ----------
  function rollBtn(disabled) {
    return '<button type="button" class="st-roll' + (disabled ? '' : ' is-ready') + '" id="stRollBtn"' + (disabled ? ' disabled' : '') +
      ' aria-label="ทอยเต๋า — กดค้างแล้วปล่อยตอนเข็มแรง"><span class="st-roll-face" aria-hidden="true">🎲</span><span class="st-roll-txt">ทอย</span><small>กดค้าง</small></button>';
  }
  var PICK_TEXT = {
    tour: { icon: '✈️', title: 'แตะช่องที่อยากไป (เดินหน้า)', skip: 'ไม่ไป ทอยเลย' },
    festival: { icon: '🎉', title: 'แตะที่จัดงานวัด (ซ้ำ = ทวีคูณ)', skip: 'ข้าม' },
    startBonus: { icon: '🎁', title: 'แตะเมืองอัปฟรี 1 ขั้น', skip: 'ข้าม' },
    freeUpgrade: { icon: '🎁', title: 'แตะเมืองอัปเกรดฟรี', skip: 'ข้าม' }
  };
  function decisionPeek(d) {
    if (!d) return '';
    if (d.type === 'build') return (d.mode === 'buy' ? 'ซื้อ ' : 'สร้าง ') + SQ[d.square].short + '?';
    if (d.type === 'takeover') return 'ซื้อต่อ ' + SQ[d.square].short + '?';
    if (d.type === 'pick') return (PICK_TEXT[d.purpose] || {}).title || '';
    return '';
  }
  function renderDock() {
    if (hold) { syncTimer(); return; }
    if (!S || !S.mode) { el.dock.innerHTML = '<div class="st-status"><div class="st-status-text"><div class="st-status-title">กำลังโหลด...</div></div></div>'; return; }
    var me = meSeat();
    var a = S.availableActions || {};
    var actor = S.phaseActor ? seatOf(S.phaseActor) : null;
    var mine = !!(me && S.phaseActor === playerId && !isOut(me));
    var busy = running || pending;
    var title = '';
    var sub = '';
    var token = actor || (S.turn ? seatOf(S.turn.playerId) : null);
    var actions = '';
    var cls = '';
    if (S.phase === 'finished') {
      var w = S.winners && S.winners[0] ? seatOf(S.winners[0].playerId) : null;
      title = w ? (w.playerId === playerId ? 'คุณชนะ!' : w.name + ' ชนะ!') : 'จบเกม';
      sub = S.finishReason || '';
      token = w;
      actions = btn('stShowEnd', 'ดูผล', { primary: true }) + btn('stBackBtn', 'กลับห้องรอ');
    } else if (!me || isOut(me)) {
      title = me && me.bankrupt ? 'คุณล้มละลาย' : 'กำลังดูเกม';
      sub = actor ? 'ตาของ ' + actor.name : '';
    } else if (mine && S.phase === 'roll') {
      cls = 'is-roll';
      if (me.island) {
        title = '🏝️ ติดเกาะ · เหลือ ' + me.island + ' ตา';
        sub = 'ดับเบิล = ออก';
        actions = btn('stPayIsland', 'จ่าย ' + money(BOARD.islandFee) + ' ออก', { disabled: !a.payIsland || busy, cls: 'is-island' }) + rollBtn(busy);
      } else {
        title = S.turn && S.turn.canRollAgain ? 'ดับเบิล! ทอยอีก' : 'ตาคุณ!';
        sub = 'กดค้าง ปล่อยตอนแรง';
        actions = rollBtn(busy);
      }
    } else if (mine && (S.phase === 'build' || S.phase === 'takeover')) {
      title = decisionPeek(S.decision);
      actions = btn('stOpenDecision', S.phase === 'build' ? 'เปิดแผ่นสร้าง' : 'เปิดแผ่นซื้อต่อ', { primary: true, pulse: true, disabled: running });
    } else if (mine && S.phase === 'pick' && S.decision) {
      var pt = PICK_TEXT[S.decision.purpose] || {};
      title = pt.icon + ' ' + pt.title;
      sub = S.decision.purpose === 'tour' ? 'ค่าทัวร์ ' + money(S.decision.fee) : '';
      actions = btn('stSkipPick', pt.skip || 'ข้าม', { disabled: busy });
    } else if (mine && S.phase === 'debt' && S.debt) {
      title = 'เงินไม่พอ! ขาด ' + money(Math.max(0, S.debt.total - me.cash));
      actions = btn('stOpenSell', 'ขายที่', { primary: true, pulse: true, disabled: running });
      cls = 'is-alert';
    } else {
      title = actor ? 'ตาของ ' + actor.name : 'รอสักครู่';
      if (S.phase === 'roll') sub = S.turn && S.turn.holding ? 'กำลังชาร์จแรง…' : actor && actor.island ? '🏝️ ลุ้นดับเบิล' : 'กำลังทอย';
      else if (S.phase === 'debt') sub = 'กำลังขายที่ใช้หนี้';
      else sub = '<span class="st-think">กำลังคิด<i></i><i></i><i></i></span> ' + esc(decisionPeek(S.decision));
      cls = 'is-watch';
    }
    var sec = secondsLeft();
    el.dock.innerHTML =
      '<div class="st-status ' + cls + '">' + (token ? '<span class="st-status-token">' + tokenHtml(token) + '</span>' : '') +
      '<div class="st-status-text"><div class="st-status-title">' + esc(title) + '</div>' + (sub ? '<div class="st-status-sub">' + (cls === 'is-watch' ? sub : esc(sub)) + '</div>' : '') + '</div>' +
      (sec !== null && S.phase !== 'finished' ? '<div class="st-status-sec" id="stSec">' + sec + '</div>' : '') + '</div>' +
      (actions ? '<div class="st-actions">' + actions + '</div>' : '');
    syncTimer();
    var h = document.getElementById('stDock').offsetHeight;
    if (window.innerWidth < 1000) root.style.setProperty('--st-dock-h', h + 'px');
  }

  // โหมดแตะช่อง (ทัวร์ · งานวัด · โบนัส)
  function renderPick() {
    var mine = S && S.phase === 'pick' && S.phaseActor === playerId && S.decision && !running;
    el.board.classList.toggle('is-picking', !!mine);
    cells.forEach(function(c, i) {
      var ok = !!(mine && S.decision.options.indexOf(i) >= 0);
      c.classList.toggle('is-pickable', ok);
      var badge = c.querySelector('.st-pickcost');
      var pv = ok && S.decision.preview ? S.decision.preview[i] : null;
      var text = '';
      if (pv && pv.toll !== undefined) text = '→' + moneyK(pv.toll);
      else if (pv && pv.steps !== undefined) text = String(pv.steps);
      if (text) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'st-pickcost'; c.appendChild(badge); }
        badge.textContent = text;
        badge.classList.toggle('is-salary', !!(pv && pv.salary));
      } else if (badge) badge.remove();
    });
    if (mine) {
      var pt = PICK_TEXT[S.decision.purpose] || {};
      el.pickbar.innerHTML = '<span class="st-pickbar-ico">' + pt.icon + '</span><b>' + esc(pt.title) + '</b>' + (S.decision.fee ? '<span class="st-chipline">' + money(S.decision.fee) + '</span>' : '') +
        (S.decision.purpose === 'tour' ? '<span class="st-pickbar-legend"><i class="is-salary"></i>ผ่านเริ่ม +' + moneyK(BOARD.salary) + '</span>' : '');
    }
    el.pickbar.classList.toggle('is-on', !!mine);
  }

  function renderSidebar() {
    var list = $('#onlinePlayerList');
    if (!list || !S) return;
    list.innerHTML = (S.seats || []).map(function(s) {
      return '<li class="st-side-row">' + tokenHtml(s) + '<span class="st-side-name">' + esc(s.name) + '</span><span class="st-side-worth">' + money(isOut(s) ? 0 : s.netWorth) + '</span></li>';
    }).join('') + '<li class="st-side-note">ทรัพย์สินรวม = เงิน + ที่ + สิ่งปลูกสร้าง</li>';
  }

  // ---------- ชีต ----------
  var sheetKind = null;
  var sheetArg = null;
  var lastFocus = null;
  var dismissed = {};
  function openSheet(kind, arg) {
    sheetKind = kind;
    sheetArg = arg;
    if (!el.sheet.classList.contains('is-open')) lastFocus = document.activeElement;
    if (kind === 'build' && S.decision) buildSel = defaultBuildSel(S.decision);
    buildSheet();
    el.sheet.classList.add('is-open');
    el.sheet.classList.toggle('is-decision', kind === 'build' || kind === 'takeover' || kind === 'sell');
    var close = el.sheetCard.querySelector('.st-sheet-close');
    if (close) setTimeout(function() { try { close.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }
  function closeSheet(byUser) {
    if (byUser && (sheetKind === 'build' || sheetKind === 'takeover' || sheetKind === 'sell') && S) dismissed[S.phaseSeq] = true;
    sheetKind = null;
    el.sheet.classList.remove('is-open', 'is-decision');
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    renderDock();
  }
  function closeSheetForScenes() {
    if (sheetKind === 'build' || sheetKind === 'takeover' || sheetKind === 'sell') { sheetKind = null; el.sheet.classList.remove('is-open', 'is-decision'); }
  }
  function defaultBuildSel(d) {
    // เลือกขั้นสูงสุดที่จ่ายไหวไว้ก่อน (แตะลดลงได้)
    var best = null;
    var total = 0;
    (d.options || []).forEach(function(o) {
      if (o.built || o.locked) return;
      if (best === null && o.level !== d.current + 1) return;
      if (best !== null && o.level !== best + 1) return;
      if (total + o.cost > d.cash) return;
      total += o.cost;
      best = o.level;
    });
    return best;
  }
  function buildSheet() {
    if (!sheetKind || !S) return;
    var html = '';
    var closer = '<div class="st-sheet-grab"></div><button type="button" class="st-sheet-close" data-close="1" aria-label="ปิด">✕</button>';
    if (sheetKind === 'build' && S.decision && S.decision.type === 'build') html = buildSheetHtml(S.decision, false);
    else if (sheetKind === 'takeover' && S.decision && S.decision.type === 'takeover') html = takeoverSheetHtml(S.decision, false);
    else if (sheetKind === 'sell' && S.phase === 'debt') html = sellSheetHtml();
    else if (sheetKind === 'square') html = squareSheetHtml(sheetArg);
    else if (sheetKind === 'help') html = helpHtml();
    else if (sheetKind === 'log') html = logHtml();
    if (!html) { closeSheet(); return; }
    var scroll = el.sheetCard.scrollTop;
    el.sheetCard.innerHTML = closer + html;
    el.sheetCard.scrollTop = scroll;
  }
  function syncSheets() {
    if (!S) return;
    var mine = S.phaseActor === playerId && S.phase !== 'finished';
    var want = null;
    if (mine && S.phase === 'build') want = 'build';
    if (mine && S.phase === 'takeover') want = 'takeover';
    if (mine && S.phase === 'debt') want = 'sell';
    if (sheetKind && ['build', 'takeover', 'sell'].indexOf(sheetKind) >= 0 && sheetKind !== want) { closeSheet(); }
    if (want && !running && !dismissed[S.phaseSeq]) {
      if (sheetKind !== want || sheetArg !== S.phaseSeq) openSheet(want, S.phaseSeq);
      else buildSheet();
      return;
    }
    if (sheetKind === 'square' || sheetKind === 'log') buildSheet();
  }

  // ---------- กดค้างทอย (มินิเกมเข็มแรง) ----------
  var hold = null;
  var meterEl = null;
  // ช่องเขียววาดไว้ล่วงหน้าตั้งแต่เริ่มกด (ซ่อนด้วย opacity) แล้วค่อยโชว์ด้วย opacity อย่างเดียว · ไม่มี SVG filter
  // ในแต่ละเฟรมไม่ query DOM / ไม่อ่าน layout — แตะแค่ transform ของเข็มกับข้อความเมื่อค่าเปลี่ยน
  var meterRefs = null;
  function meterNode() {
    if (meterEl) return meterEl;
    meterEl = document.createElement('div');
    meterEl.className = 'st-meter';
    meterEl.id = 'stMeter';
    meterEl.setAttribute('aria-hidden', 'true');
    var arc = 'M20 120 A100 100 0 0 1 220 120';
    meterEl.innerHTML = '<svg viewBox="0 0 240 136">' +
      '<defs><linearGradient id="stHeat" x1="0" x2="1"><stop offset="0" stop-color="#4ea8dc"/><stop offset=".55" stop-color="#f5c86b"/><stop offset="1" stop-color="#ef5b4c"/></linearGradient></defs>' +
      '<path d="' + arc + '" fill="none" stroke="#162033" stroke-width="26" stroke-linecap="round"/>' +
      '<path d="' + arc + '" fill="none" stroke="url(#stHeat)" stroke-width="12" stroke-linecap="round" opacity=".9"/>' +
      '<g class="st-meter-band"><path class="st-meter-green-glow" d="' + arc + '" pathLength="100" fill="none" stroke="#45f09a" stroke-width="32" opacity=".28"/>' +
      '<path class="st-meter-green" d="' + arc + '" pathLength="100" fill="none" stroke="#45f09a" stroke-width="20"/></g>' +
      '<text x="14" y="134" font-size="11" fill="#b9c1d6" font-family="Bai Jamjuree, sans-serif">เบา</text><text x="226" y="134" font-size="11" fill="#b9c1d6" text-anchor="end" font-family="Bai Jamjuree, sans-serif">แรง</text>' +
      '<g class="st-meter-needle"><path d="M120 120 L120 30" stroke="#fff8e6" stroke-width="5" stroke-linecap="round"/><circle cx="120" cy="120" r="11" fill="#f5c86b" stroke="#1a2332" stroke-width="2"/></g>' +
      '</svg><div class="st-meter-label"><b id="stMeterPct">แรง 0%</b><span id="stMeterHint">ปล่อยตอนแรง = เดินไกล</span></div>';
    document.body.appendChild(meterEl);
    meterRefs = {
      needle: meterEl.querySelector('.st-meter-needle'),
      pct: meterEl.querySelector('#stMeterPct'),
      hint: meterEl.querySelector('#stMeterHint'),
      greens: [meterEl.querySelector('.st-meter-green'), meterEl.querySelector('.st-meter-green-glow')]
    };
    return meterEl;
  }
  function meterPos(m, t) {
    if (!m || t < (m.tapMs || 150)) return 0;
    return (1 - Math.cos((2 * Math.PI * t) / m.period)) / 2;
  }
  function showGreen(node) {
    if (node.__green) return;
    node.__green = true;
    node.classList.add('has-green');
    meterRefs.hint.textContent = 'ช่องเขียว! ปล่อยในช่อง = ลุ้นดับเบิล';
    haptic([8, 30, 8]);
    sfx.tick();
  }
  function holdFrame(now) {
    if (!hold || hold.released) return;
    var t = (now || performance.now()) - hold.t0;
    var m = hold.meter;
    var pos = meterPos(m, t);
    var node = meterEl;
    meterRefs.needle.setAttribute('transform', 'rotate(' + (-90 + 180 * pos).toFixed(1) + ' 120 120)');
    var label = pos >= 0.85 ? 'พลังเต็ม!' : 'แรง ' + Math.round(pos * 20) * 5 + '%';
    if (label !== hold.label) { hold.label = label; meterRefs.pct.textContent = label; }
    var max = pos >= 0.85;
    if (max !== hold.max) { hold.max = max; node.classList.toggle('is-max', max); }
    var g = m && m.green;
    if (g && t >= g.appearAt) showGreen(node);
    var inGreen = !!(g && t >= g.appearAt && Math.abs(pos - g.center) <= g.width / 2);
    if (inGreen !== hold.inGreen) { hold.inGreen = inGreen; node.classList.toggle('is-green', inGreen); if (inGreen) haptic(6); }
    if (hold.btn && !reduceMotion) {
      var sc = (0.93 + Math.round(pos * 20) / 20 * 0.07).toFixed(3);
      if (sc !== hold.sc) { hold.sc = sc; hold.btn.style.transform = 'scale(' + sc + ')'; }
    }
    if (holdTone) try { holdTone.o.frequency.setTargetAtTime(220 + pos * 700, holdTone.ctx.currentTime, 0.02); } catch (e) { /* ignore */ }
    hold.raf = requestAnimationFrame(holdFrame);
  }
  function showMeter() {
    if (!hold || hold.released || !hold.meter) return;
    var node = meterNode();
    var m = hold.meter;
    node.__green = false;
    node.classList.remove('has-green', 'is-green', 'is-max');
    meterRefs.hint.textContent = 'ปล่อยตอนแรง = เดินไกล';
    if (m.green) {
      meterRefs.greens.forEach(function(gp) {
        gp.setAttribute('stroke-dasharray', (m.green.width * 100).toFixed(2) + ' 200');
        gp.setAttribute('stroke-dashoffset', (-(m.green.center - m.green.width / 2) * 100).toFixed(2));
      });
    }
    hold.btn = document.getElementById('stRollBtn');
    node.classList.add('is-on');
    node.animate([{ opacity: 0, transform: 'translateY(14px) scale(0.92)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: reduceMotion ? 1 : 180, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    startTone();
    hold.raf = requestAnimationFrame(holdFrame);
  }
  var holdTone = null;
  function startTone() {
    if (!soundOn) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = startTone.ctx || (startTone.ctx = new Ctx());
      if (ctx.state === 'suspended') ctx.resume();
      var o = ctx.createOscillator(); var g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = 220; g.gain.value = 0.035;
      o.connect(g); g.connect(ctx.destination); o.start();
      holdTone = { o: o, g: g, ctx: ctx };
    } catch (e) { holdTone = null; }
  }
  function stopTone() {
    if (!holdTone) return;
    try { holdTone.g.gain.setTargetAtTime(0.0001, holdTone.ctx.currentTime, 0.03); holdTone.o.stop(holdTone.ctx.currentTime + 0.12); } catch (e) { /* ignore */ }
    holdTone = null;
  }
  function hideMeter(keepMs) {
    stopTone();
    var node = meterEl;
    var b = document.getElementById('stRollBtn');
    if (b) b.style.transform = '';
    if (!node || !node.classList.contains('is-on')) return;
    setTimeout(function() {
      var a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
      a.onfinish = function() { node.classList.remove('is-on', 'is-green', 'has-green', 'is-max'); node.__green = false; };
    }, keepMs || 0);
  }
  function beginHold(pointerId) {
    if (hold || pending || running) return;
    var a = S && S.availableActions;
    if (!a || !a.roll) return;
    var sentAt = performance.now();
    var rb = document.getElementById('stRollBtn');
    hold = { t0: sentAt, pointerId: pointerId, meter: null, released: false, pendingRelease: null, inGreen: false, rect: rb ? rb.getBoundingClientRect() : null };
    var mine = hold;
    socket.emit('setthi_rollHoldStart', { roomId: roomId, seq: S.phaseSeq }, function(res) {
      if (hold !== mine) { if (res && res.success) socket.emit('setthi_rollHoldCancel', { roomId: roomId }); return; }
      if (!res || !res.success) { toast((res && res.error) || 'ทอยไม่ได้'); endHold(); renderDock(); return; }
      mine.t0 = (sentAt + performance.now()) / 2;
      if (mine.pendingRelease !== null) mine.pendingRelease = Math.max(0, mine.pendingAt - mine.t0);
      mine.meter = res.meter;
      if (mine.pendingRelease !== null) sendRelease(mine.pendingRelease);
      else if (performance.now() - mine.t0 > 110) showMeter();
    });
    setTimeout(function() { if (hold === mine && mine.meter && !mine.released && !(meterEl && meterEl.classList.contains('is-on'))) showMeter(); }, 120);
  }
  function endHold() { if (hold && hold.raf) cancelAnimationFrame(hold.raf); hold = null; }
  function sendRelease(elapsed) {
    var h = hold;
    if (!h) return;
    h.released = true;
    if (h.raf) cancelAnimationFrame(h.raf);
    var tap = elapsed < ((h.meter && h.meter.tapMs) || 150);
    hideMeter(tap ? 0 : 200);
    pending = true;
    socket.emit('setthi_rollRelease', { roomId: roomId, elapsedMs: Math.round(elapsed) }, function(res) {
      pending = false;
      endHold();
      if (res && !res.success) { toast(res.error || 'ทอยไม่สำเร็จ'); sfx.bad(); socket.emit('setthi_requestState', { roomId: roomId, playerId: playerId }); }
      renderDock();
    });
  }
  function finishHold() {
    if (!hold || hold.released) return;
    var elapsed = performance.now() - hold.t0;
    haptic(12);
    if (hold.meter) sendRelease(elapsed);
    else { hold.pendingRelease = elapsed; hold.pendingAt = performance.now(); hold.released = true; hideMeter(0); }
  }
  function cancelHold(reason) {
    if (!hold || hold.released) return;
    var h = hold;
    if (h.raf) cancelAnimationFrame(h.raf);
    hideMeter(0);
    if (h.meter) socket.emit('setthi_rollHoldCancel', { roomId: roomId });
    endHold();
    if (reason) toast(reason, 1400);
    renderDock();
  }
  // นิ้ว (มือถือ) ใช้ touch event ตรงๆ: iPhone Safari มักยิง pointercancel ทิ้งตอนกดค้าง
  // (คิดว่าจะเลื่อนจอ/กดค้างเปิดเมนู) → หลอดพลังไม่ทันโผล่ · preventDefault ที่ touchstart กันทั้งเลื่อนจอและเมนู
  // เมาส์/ปากกายังใช้ pointer event เหมือนเดิม
  function slidOut(x, y) {
    var r = hold && hold.rect;
    if (!r) return false;
    var out = 56;
    return x < r.left - out || x > r.right + out || y < r.top - out * 2 || y > r.bottom + out;
  }
  document.addEventListener('touchstart', function(e) {
    var b = e.target.closest && e.target.closest('#stRollBtn');
    if (!b) return;
    e.preventDefault();
    if (b.disabled || hold) return;
    var t = e.changedTouches[0];
    beginHold('touch:' + t.identifier);
  }, { passive: false });
  function touchOf(e) {
    if (!hold || hold.released || String(hold.pointerId).indexOf('touch:') !== 0) return null;
    var id = Number(String(hold.pointerId).slice(6));
    for (var i = 0; i < e.changedTouches.length; i += 1) if (e.changedTouches[i].identifier === id) return e.changedTouches[i];
    return null;
  }
  window.addEventListener('touchend', function(e) { if (touchOf(e)) finishHold(); });
  window.addEventListener('touchcancel', function(e) { if (touchOf(e)) cancelHold('ยกเลิกการทอย'); });
  window.addEventListener('touchmove', function(e) {
    var t = touchOf(e);
    if (!t) return;
    e.preventDefault();
    if (slidOut(t.clientX, t.clientY)) cancelHold('นิ้วเลื่อนออก — ยกเลิก');
  }, { passive: false });

  document.addEventListener('pointerdown', function(e) {
    if (e.pointerType === 'touch') return; // นิ้วไปทาง touch event ด้านบน
    var b = e.target.closest && e.target.closest('#stRollBtn');
    if (!b || b.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    beginHold(e.pointerId);
  });
  window.addEventListener('pointerup', function(e) { if (hold && !hold.released && hold.pointerId === e.pointerId) finishHold(); });
  window.addEventListener('pointercancel', function(e) { if (hold && hold.pointerId === e.pointerId) cancelHold('ยกเลิกการทอย'); });
  window.addEventListener('pointermove', function(e) {
    if (!hold || hold.released || hold.pointerId !== e.pointerId) return;
    if (slidOut(e.clientX, e.clientY)) cancelHold('นิ้วเลื่อนออก — ยกเลิก');
  });
  document.addEventListener('contextmenu', function(e) { if (e.target.closest && e.target.closest('#stRollBtn')) e.preventDefault(); });
  document.addEventListener('keydown', function(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (e.repeat) { if (hold) e.preventDefault(); return; }
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || sheetKind || running) return;
    var b = document.getElementById('stRollBtn');
    if (!b || b.disabled) return;
    e.preventDefault();
    beginHold('key');
  });
  document.addEventListener('keyup', function(e) { if ((e.code === 'Space' || e.key === ' ') && hold && hold.pointerId === 'key') { e.preventDefault(); finishHold(); } });

  // ---------- ส่งคำสั่ง ----------
  function send(event, payload, after) {
    if (pending) return;
    pending = true;
    var guard = setTimeout(function() { pending = false; renderDock(); }, 6000);
    socket.emit(event, Object.assign({ roomId: roomId }, payload || {}), function(res) {
      clearTimeout(guard);
      pending = false;
      if (res && !res.success) {
        toast(res.error || 'ทำรายการไม่สำเร็จ');
        sfx.bad();
        socket.emit('setthi_requestState', { roomId: roomId, playerId: playerId });
      }
      if (typeof after === 'function') after(res || {});
      if (!running) renderDock();
    });
    renderDock();
  }
  function seq() { return { seq: S ? S.phaseSeq : null }; }

  document.addEventListener('click', function(e) {
    var t = e.target.closest('button, .st-cell, [data-close]');
    if (!t) return;
    var id = t.id;
    if (t.dataset.close) { closeSheet(true); return; }
    if (t.classList.contains('st-cell')) {
      var i = Number(t.dataset.i);
      if (S && S.phase === 'pick' && S.phaseActor === playerId && S.decision && !running) {
        if (S.decision.options.indexOf(i) >= 0) { haptic(12); send('setthi_pick', Object.assign({ square: i }, seq())); }
        else toast('เลือกช่องที่เรืองแสง', 1200);
        return;
      }
      openSheet('square', i);
      return;
    }
    if (t.classList.contains('st-chip')) {
      var pid = t.dataset.id;
      focusId = focusId === pid ? null : pid;
      clearTimeout(focusTimer);
      if (focusId) focusTimer = setTimeout(function() { focusId = null; if (V) renderCells(V); renderStrip(); }, 3000);
      if (V) renderCells(V);
      renderStrip();
      return;
    }
    if (t.classList.contains('st-tile') && sheetKind === 'build') {
      var lv = Number(t.dataset.level);
      var d = S.decision;
      var o = d && (d.options || []).find(function(x) { return x.level === lv; });
      if (!o || o.built) return;
      if (o.locked) { toast({ lap: 'ผ่านจุดเริ่มก่อน ถึงสร้างขั้นนี้ได้', hotel: 'ต้องมีโรงแรมก่อน แล้วตกซ้ำ', later: 'ตกช่องนี้อีกครั้งถึงสร้างได้' }[o.locked] || 'ยังสร้างไม่ได้', 1600); return; }
      buildSel = buildSel === lv && lv > d.current + 1 ? lv - 1 : lv;
      if (buildSel <= d.current) buildSel = null;
      haptic(8);
      buildSheet();
      return;
    }
    if (t.dataset.sell !== undefined) { send('setthi_sell', { square: Number(t.dataset.sell) }); return; }
    if (id === 'stBuildBtn') { if (buildSel !== null) send('setthi_build', Object.assign({ level: buildSel }, seq())); return; }
    if (id === 'stPassBtn') { send('setthi_pass', seq()); return; }
    if (id === 'stTakeBtn') { send('setthi_takeover', seq()); return; }
    if (id === 'stNoTakeBtn') { send('setthi_declineTakeover', seq()); return; }
    if (id === 'stSkipPick') { send('setthi_skipPick', seq()); return; }
    if (id === 'stPayIsland') { send('setthi_payIsland', seq()); return; }
    if (id === 'stOpenDecision') { dismissed[S.phaseSeq] = false; openSheet(S.phase === 'build' ? 'build' : 'takeover', S.phaseSeq); return; }
    if (id === 'stOpenSell') { dismissed[S.phaseSeq] = false; openSheet('sell', S.phaseSeq); return; }
    if (id === 'stRollBtn') { if (e.detail === 0 && !hold) { haptic(10); send('setthi_roll', seq()); } return; }
    if (id === 'stLastLog') { openSheet('log'); return; }
    if (id === 'stShowEnd') { showEnd(false, true); return; }
    if (id === 'stBackBtn' || id === 'stEndBack') { socket.emit('returnFinishedToLobby', { roomId: roomId }); return; }
    if (id === 'stEndClose') { el.end.classList.remove('is-on'); return; }
    if (id === 'stEndShare') { shareResult(); return; }
    if (id === 'stEndExit') { exit.confirm(); return; }
  });
  document.addEventListener('keydown', function(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('st-cell')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape' && sheetKind) closeSheet(true);
  });

  // ---------- จบเกม ----------
  var endShown = false;
  function showEnd(celebrate, force) {
    if (!S || S.phase !== 'finished' || !S.standings) return;
    if (!force && el.end.classList.contains('is-on')) return;
    endShown = true;
    closeSheet();
    var rows = S.standings;
    var winners = S.winners || [];
    var podium = [rows[1], rows[0], rows[2]];
    var klass = ['r2', 'r1', 'r3'];
    var pod = podium.map(function(r, k) {
      if (!r) return '<div class="st-pod is-empty ' + klass[k] + '"></div>';
      var seat = seatOf(r.playerId) || r;
      return '<div class="st-pod ' + klass[k] + '">' + (k === 1 ? '<div class="st-pod-crown">' + iconHtml('crown') + '</div>' : '') + tokenHtml(seat) +
        '<div class="st-pod-name">' + esc(r.name) + '</div><div class="st-pod-worth">' + (r.bankrupt ? 'ล้มละลาย' : r.left ? 'ออกแล้ว' : money(r.netWorth)) + '</div><div class="st-pod-block">' + r.rank + '</div></div>';
    }).join('');
    var list = rows.map(function(r) {
      var seat = seatOf(r.playerId) || r;
      return '<div class="st-rank"><b>' + r.rank + '</b>' + tokenHtml(seat) + '<span class="st-rank-name">' + esc(r.name) + '<small>' + (r.bankrupt ? 'ล้มละลาย' : r.left ? 'ออกจากเกม' : '🏠 ' + r.properties + (r.landmarks ? ' · 🏛️ ' + r.landmarks : '')) + '</small></span><span class="st-rank-worth">' + money(r.netWorth) + '</span></div>';
    }).join('');
    var mono = S.monopoly ? MONO[S.monopoly.type] : null;
    var title = winners.length > 1 ? winners.map(function(w) { return w.name; }).join(' & ') + ' ชนะร่วม!' : (winners[0] ? winners[0].name + ' คือเศรษฐี!' : 'จบเกม');
    var iWon = winners.some(function(w) { return w.playerId === playerId; });
    el.end.innerHTML = '<div class="st-end-inner">' +
      '<div class="st-end-kicker">' + (iWon ? 'คุณชนะ!' : 'จบเกม') + '</div>' +
      (mono ? '<div class="st-end-mono">👑 ' + esc(mono) + '</div>' : '') +
      '<h2 class="st-end-title">' + esc(title) + '</h2>' +
      '<p class="st-end-reason">' + esc(S.finishReason || '') + '</p>' +
      '<div class="st-podium">' + pod + '</div>' +
      '<div class="st-ranks">' + list + '</div>' +
      '<div class="st-end-btns">' + btn('stEndBack', 'เล่นอีกตา', { primary: true }) + btn('stEndShare', 'แชร์ผล') + btn('stEndExit', '🚪 ออก') + '</div>' +
      btn('stEndClose', 'ดูกระดาน', {}) +
      '<div class="st-end-note" id="stEndNote">เงินในเกม ไม่มีมูลค่าจริง</div></div>';
    el.end.classList.add('is-on');
    if (celebrate && !reduceMotion) {
      sfx.fanfare();
      el.end.querySelectorAll('.st-pod-block').forEach(function(b, k) { b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.06)', offset: 0.8 }, { transform: 'scaleY(1)' }], { duration: 700, delay: [200, 500, 0][k], easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }); });
      el.end.querySelectorAll('.st-pod .st-token').forEach(function(t, k) { t.animate([{ transform: 'translateY(-120px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 600, delay: 600 + k * 120, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'both' }); });
      confetti(80);
    }
  }
  function confetti(n) {
    if (reduceMotion) return;
    var layer = document.createElement('div');
    layer.className = 'st-confetti-layer';
    document.body.appendChild(layer);
    var colors = ['#f5c86b', '#ef5b4c', '#4ea8dc', '#3fbf7f', '#b07cf0', '#fff3c4'];
    var W = window.innerWidth;
    var H = window.innerHeight;
    for (var k = 0; k < n; k += 1) {
      var c = document.createElement('i');
      c.className = 'st-confetti';
      c.style.setProperty('--c', colors[k % colors.length]);
      layer.appendChild(c);
      var x = Math.random() * W;
      var drift = (Math.random() - 0.5) * 160;
      c.animate([{ transform: 'translate(' + x + 'px, -30px) rotate(0deg)', opacity: 1 }, { transform: 'translate(' + (x + drift) + 'px,' + (H + 40) + 'px) rotate(' + (540 + Math.random() * 720) + 'deg)', opacity: 0.9 }], { duration: 2200 + Math.random() * 1600, delay: Math.random() * 900, easing: 'cubic-bezier(0.25, 0.5, 0.5, 1)', fill: 'both' });
    }
    setTimeout(function() { layer.remove(); }, 5200);
  }
  function shareResult() {
    if (!window.partyPlay || !S || !S.standings) return;
    window.partyPlay.shareResult({
      mode: 'เศรษฐี',
      headline: (S.winners || []).map(function(w) { return w.name; }).join(' & ') + ((S.winners || []).length > 1 ? ' ชนะร่วม!' : ' คือเศรษฐี!'),
      sub: (S.monopoly ? MONO[S.monopoly.type] + ' · ' : '') + 'เงินในเกม ไม่มีมูลค่าจริง',
      lines: S.standings.slice(0, 4).map(function(r) { return r.rank + '. ' + r.name + ' ' + (r.bankrupt ? 'ล้มละลาย' : money(r.netWorth)); }),
      accent: '#f5c86b',
      fileName: 'setthi-result'
    });
  }

  // ---------- รับ state ----------
  function onState(next) {
    if (!next || !next.mode) return;
    skew = (next.serverNow || Date.now()) - Date.now();
    var first = !S || !V;
    var fresh = (next.fx || []).filter(function(f) { return f.seq > lastFxSeq; });
    var gap = fresh.length && fresh[0].seq > lastFxSeq + 1 && lastFxSeq > 0;
    S = next;
    lastFxSeq = Math.max(lastFxSeq, next.fxSeq || 0);
    if (next.decision && next.decision.square !== undefined && SQ[next.decision.square]) preload(SQ[next.decision.square].art, true);
    fresh.forEach(function(f) { if (f.square !== undefined && SQ[f.square]) preload(SQ[f.square].art, true); });
    if (first || gap || !fresh.length) {
      if (first || gap) queue = [];
      if (!running) renderAll();
      else { renderDock(); paintFast(); }
      return;
    }
    lastPlayedSeq = fresh[0].seq - 1;
    enqueueFx(fresh);
    if (!running) renderAll();
    else { renderDock(); renderCenter(); renderClock(); paintFast(); }
  }

  setInterval(function() {
    renderClock();
    var secNode = document.getElementById('stSec');
    var s = secondsLeft();
    if (secNode && s !== null) secNode.textContent = s;
    el.timer.classList.toggle('is-low', s !== null && s <= 5);
  }, 250);

  // ---------- ปุ่มบน / sidebar ----------
  function paintSound() { var b = $('#stSoundBtn'); b.textContent = soundOn ? '🔊 เสียง: เปิด' : '🔈 เสียง: ปิด'; b.setAttribute('aria-pressed', soundOn ? 'true' : 'false'); }
  $('#stSoundBtn').addEventListener('click', function() {
    soundOn = !soundOn;
    try { localStorage.setItem('setthiSound', soundOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    paintSound();
    if (soundOn) sfx.coin();
  });
  paintSound();
  $('#stHowBtn').addEventListener('click', function() { openSheet('help'); });
  if (el.fast) el.fast.addEventListener('click', function() {
    if (!S) return;
    var on = !S.fast;
    S.fast = on;
    paintFast();
    send('setthi_fast', { on: on });
  });
  function setSidebar(open) {
    if (open && $('#chatBox').style.display !== 'none') { var c = $('#closeChat'); if (c) c.click(); }
    $('#stSidebar').classList.toggle('open', open);
    $('#stSidebar').setAttribute('aria-hidden', open ? 'false' : 'true');
    $('#stSidebarOverlay').style.display = open ? 'block' : 'none';
    $('#stMenuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('#closeSidebarBtn').focus();
  }
  $('#stMenuBtn').addEventListener('click', function() { setSidebar(!$('#stSidebar').classList.contains('open')); });
  $('#closeSidebarBtn').addEventListener('click', function() { setSidebar(false); });
  $('#stSidebarOverlay').addEventListener('click', function() { setSidebar(false); });
  var allowNavigation = false;
  // ออกจากห้อง: บอกผลตามจังหวะเกม แล้วไป /rooms — กดแล้วห้ามมีอะไรดึงกลับเข้าเกม
  function exitConsequences() {
    if (!S || !S.phase || S.phase === 'lobby' || S.phase === 'finished') return ['เกมจบแล้ว — กลับไปหน้ารวมห้อง'];
    var me = meSeat();
    if (isOut(me)) return ['คุณออกจากเกมแล้ว — ออกได้เลย เกมไม่สะดุด'];
    var lines = ['ที่ดินและเงินของคุณคืนธนาคาร'];
    if (S.turn && S.turn.playerId === playerId) lines.push('ตาของคุณจะข้ามไปคนต่อไป');
    var others = (S.seats || []).filter(function(s) { return s.playerId !== playerId && !isOut(s); });
    lines.push(others.length <= 1 ? ('เหลือคนเดียว — ' + (others[0] ? others[0].name + ' ชนะ' : 'เกมจบ')) : 'เกมเล่นต่อโดยไม่มีคุณ');
    if (S.isHost === undefined ? BOOT.isRoomAdmin : S.isHost) lines.push('คุณเป็นหัวห้อง — หัวห้องจะย้ายไปคนอื่น');
    return lines;
  }
  var exit = window.roomExit.create({
    socket: socket, roomId: roomId, playerId: playerId,
    consequences: exitConsequences,
    onLeave: function() { allowNavigation = true; },
    theme: { background: '#1d2433', color: '#fff', confirmButtonColor: '#b3262e' }
  });
  $('#stExitBtn').addEventListener('click', exit.confirm);
  $('#leaveRoomBtn').addEventListener('click', function() { setSidebar(false); exit.confirm(); });
  var endBtn = $('#stEndBtn');
  if (endBtn) endBtn.addEventListener('click', function() {
    Swal.fire({ icon: 'warning', title: 'จบเกมเลยไหม?', text: 'นับทรัพย์สินรวมตอนนี้ มากสุดชนะ', showCancelButton: true, confirmButtonText: 'จบเกม', cancelButtonText: 'เล่นต่อ', background: '#1d2433', color: '#fff', confirmButtonColor: '#c2410c' })
      .then(function(r) { if (r.isConfirmed) { setSidebar(false); send('setthi_end', {}); } });
  });
  var touched = false;
  document.addEventListener('pointerdown', function() { touched = true; }, { once: true, capture: true });
  window.addEventListener('beforeunload', function(e) { if (touched && !allowNavigation && S && S.phase !== 'finished' && meSeat() && !isOut(meSeat())) e.preventDefault(); });

  var resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() { if (V) { camState = { x: 0, y: 0, k: 1 }; el.cam.style.transform = ''; placeTokens(V); renderDock(); } }, 120);
  });

  // ---------- socket ----------
  socket.on('connect', function() {
    if (exit.isLeaving()) return;
    $('#stConn').style.display = 'none';
    socket.emit('initPlayer', playerId);
    socket.emit('setRoom', { roomId: roomId, playerId: playerId });
    socket.emit('setthi_requestState', { roomId: roomId, playerId: playerId });
  });
  socket.on('disconnect', function() { $('#stConn').style.display = 'block'; });
  socket.on('setthiState', onState);
  socket.on('redirectToLobby', function() { if (exit.isLeaving()) return; allowNavigation = true; window.location.href = '/room/' + roomId + '?playerId=' + playerId; });
  socket.on('returnToLobby', function(data) {
    var note = document.getElementById('stEndNote');
    var secs = Number(data && data.countdown) || 10;
    if (note) note.textContent = 'กลับห้องรอใน ' + secs + ' วินาที · เงินในเกม ไม่มีมูลค่าจริง';
  });
  socket.on('restartGame', function() { if (exit.isLeaving()) return; allowNavigation = true; window.location.href = '/room/' + roomId + '?playerId=' + playerId; });
  socket.on('gameStarting', function() { if (exit.isLeaving()) return; allowNavigation = true; window.location.href = '/game/' + roomId + '?playerId=' + playerId; });
  socket.on('kickedFromRoom', function(data) {
    if (exit.isLeaving()) return;
    allowNavigation = true;
    Swal.fire({ icon: 'error', title: 'ถูกเตะออกจากห้อง', text: (data && data.reason) || '', background: '#1d2433', color: '#fff' })
      .then(function() { window.location.href = '/rooms?playerId=' + playerId; });
  });

  // ---------- เมนูทดสอบ /m (แอดมินเว็บ/หัวห้อง · เซิร์ฟเวอร์ตรวจสิทธิ์ทุกคำสั่ง) ----------
  var dbg = { panel: $('#stDebug'), head: $('#stDebugHead'), toggle: $('#stDebugToggle'), six: $('#stDbgSix'), doubles: $('#stDbgDoubles'), amt: $('#stDbgAmt'), mint: $('#stDbgMint'), badge: $('#stDebugBadge') };
  function paintDebug() {
    if (!S) return;
    if (dbg.badge) dbg.badge.hidden = !S.debugUsed;
    if (!dbg.panel) return;
    if (!S.canDebug || S.phase === 'finished') dbg.panel.hidden = true;
    var mine = S.debug || {};
    if (dbg.six) dbg.six.checked = !!mine.six;
    if (dbg.doubles) dbg.doubles.checked = !!mine.doubles;
  }
  function setDebugMin(min) {
    dbg.panel.classList.toggle('is-min', min);
    dbg.toggle.textContent = min ? '+' : '✕';
    dbg.toggle.setAttribute('aria-label', min ? 'ขยาย' : 'ย่อ');
  }
  if (dbg.panel) {
    var drag = null;
    dbg.head.addEventListener('pointerdown', function(ev) {
      if (ev.target.closest('button')) return;
      var rect = dbg.panel.getBoundingClientRect();
      drag = { x: ev.clientX, y: ev.clientY, left: rect.left, top: rect.top, moved: false };
      dbg.head.setPointerCapture(ev.pointerId);
    });
    dbg.head.addEventListener('pointermove', function(ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x;
      var dy = ev.clientY - drag.y;
      if (!drag.moved && dx * dx + dy * dy < 36) return;
      drag.moved = true;
      dbg.panel.style.left = Math.max(0, Math.min(window.innerWidth - dbg.panel.offsetWidth, drag.left + dx)) + 'px';
      dbg.panel.style.top = Math.max(0, Math.min(window.innerHeight - dbg.panel.offsetHeight, drag.top + dy)) + 'px';
      dbg.panel.style.right = 'auto';
    });
    dbg.head.addEventListener('pointerup', function() {
      if (drag && !drag.moved && dbg.panel.classList.contains('is-min')) setDebugMin(false);
      drag = null;
    });
    dbg.toggle.addEventListener('click', function(ev) { ev.preventDefault(); ev.stopPropagation(); setDebugMin(!dbg.panel.classList.contains('is-min')); });
    dbg.six.addEventListener('change', function() { socket.emit('setthi_debug_dice', { roomId: roomId, six: dbg.six.checked }, debugAck); });
    dbg.doubles.addEventListener('change', function() { socket.emit('setthi_debug_dice', { roomId: roomId, doubles: dbg.doubles.checked }, debugAck); });
    dbg.mint.addEventListener('click', function() {
      var v = Math.floor(Number(dbg.amt.value));
      if (!(v >= 1 && v <= 1000000)) { toast('ใส่จำนวน 1–1,000,000'); return; }
      socket.emit('setthi_debug_mint', { roomId: roomId, amount: v }, debugAck);
    });
  }
  function debugAck(res) {
    if (res && !res.success) { toast(res.error || 'ทำรายการไม่สำเร็จ'); paintDebug(); }
  }
  function openDebug(text) {
    if (String(text || '').trim().toLowerCase() !== '/m') return false;
    if (!S || !S.canDebug) {
      if (window.Swal) Swal.fire({ icon: 'error', title: '/m ใช้ได้เฉพาะแอดมินหรือหัวห้อง', background: '#1d2433', color: '#fff' });
      else toast('/m ใช้ได้เฉพาะแอดมินหรือหัวห้อง');
      return true;
    }
    if (S.phase === 'finished') { toast('เกมจบแล้ว'); return true; }
    dbg.panel.hidden = false;
    setDebugMin(false);
    paintDebug();
    return true;
  }
  if (window.initChatPanel) window.initChatPanel({ socket: socket, playerId: playerId, playerName: BOOT.playerName, onCommand: openDebug });

  // ---------- เริ่ม ----------
  buildBoard();
  if (S) { V = modelFrom(S); renderAll(); } else renderDock();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function() { if (V) placeTokens(V); });
  // เทส/ถ่ายภาพฉาก: เล่นฉากจาก fx ตัวอย่าง (แค่ภาพบนเครื่องนี้ ไม่ส่งอะไรไปเซิร์ฟเวอร์)
  window.__setthi = {
    state: function() { return S; },
    queueLength: function() { return queue.length + (running ? 1 : 0); },
    running: function() { return running; },
    skip: skipNow,
    sheet: function() { return sheetKind; },
    hold: function() { return hold ? { meter: hold.meter, t0: hold.t0, released: hold.released } : null; },
    // เทส: ส่งคำสั่งผ่าน socket ของหน้านี้ (เซิร์ฟเวอร์ตรวจสิทธิ์ทุกอย่างเหมือนเดิม)
    emit: function(ev, payload) { return new Promise(function(resolve) { socket.emit(ev, Object.assign({ roomId: roomId }, payload || {}), function(res) { resolve(res || {}); }); }); },
    demo: function(list) { enqueueFx((Array.isArray(list) ? list : [list]).map(function(f) { return Object.assign({ seq: 0, at: nowServer() }, f); })); }
  };
})();
