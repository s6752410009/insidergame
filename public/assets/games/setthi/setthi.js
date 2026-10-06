/* เศรษฐี — client
 * เซิร์ฟเวอร์เป็นคนตัดสินทุกอย่าง (เต๋า การ์ด เงิน) · ไฟล์นี้แค่วาดกระดาน เล่นฉากเคลื่อนไหวตาม fx ที่เซิร์ฟเวอร์ส่งมา
 * และส่งคำสั่งของผู้เล่นกลับไป
 *
 * ฉาก (cutscene) เข้าคิวเล่นตามลำดับ · แตะข้ามได้ · ตามไม่ทัน (เช่นบอทเล่นรัว ๆ) = เร่งความเร็ว/ข้าม
 * โมชันใช้ transform/opacity ผ่าน Web Animations เท่านั้น · prefers-reduced-motion = ตัดฉากเหลือแค่สรุปสั้น ๆ
 */
(function() {
  'use strict';
  var BOOT = window.SETTHI_BOOT || {};
  var BOARD = BOOT.board || { squares: [], groups: {}, groupSquares: {} };
  var ART = window.SetthiArt;
  var SQ = BOARD.squares;
  var GROUPS = BOARD.groups;
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
    strip: $('#stStrip'), dock: $('#stDockBody'), timer: $('#stTimer'), log: $('#stLog'),
    clock: $('#stClock'), clockTxt: $('#stClockTxt'), fx: $('#stFx'), sheet: $('#stSheet'), sheetCard: $('#stSheetCard'),
    end: $('#stEnd'), pill: $('#stAuctionPill'), deskProps: $('#stDeskPropsBody')
  };

  // ---------- เครื่องมือ ----------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function money(n) { return '฿' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function nowServer() { return Date.now() + skew; }
  function seatOf(id, state) { return ((state || S || {}).seats || []).find(function(s) { return s.playerId === id; }) || null; }
  function meSeat() { return seatOf(playerId); }
  function nameOf(id) { var s = seatOf(id); return s ? s.name : 'ธนาคาร'; }
  function isOut(seat) { return !seat || seat.bankrupt || seat.left; }
  function groupOf(i) { return SQ[i] && SQ[i].group ? GROUPS[SQ[i].group] : null; }
  function bandOf(i) {
    var sq = SQ[i];
    if (!sq) return '#888';
    if (sq.group) return GROUPS[sq.group].color;
    if (sq.type === 'transport') return '#35435e';
    if (sq.type === 'utility') return '#6c7a93';
    return 'transparent';
  }
  function bandInkOf(i) { var g = groupOf(i); return g ? g.ink : '#fff'; }
  function haptic(p) { if (typeof window.gameHaptic === 'function') window.gameHaptic(p); }
  function tokenHtml(seat, extraClass) {
    if (!seat) return '<span class="st-token" style="--tk:#6c7a93"><span>🏦</span></span>';
    return '<span class="st-token ' + (extraClass || '') + '" style="--tk:' + esc(seat.tokenColor) + '" title="' + esc(seat.name) + '"><span>' + esc(seat.avatar || '👤') + '</span></span>';
  }
  function iconHtml(name) { return ART.icon(name); }
  // ภาพแลนด์มาร์กใหญ่ (โหลดเมื่อจะใช้)
  var LAND_BASE = '/assets/games/setthi/land/';
  function landHtml(i, cls) {
    var sq = SQ[i];
    if (!sq || !sq.art) return '<div class="st-deed-art">' + iconHtml(sq ? sq.icon : 'chance') + '</div>';
    return '<div class="st-deed-art is-land ' + (cls || '') + '"><img src="' + LAND_BASE + sq.art + '.svg" alt="" loading="lazy" decoding="async" width="240" height="240"></div>';
  }
  var preloaded = {};
  function preloadLand(i) {
    var sq = SQ[i];
    if (!sq || !sq.art || preloaded[sq.art]) return;
    preloaded[sq.art] = new Image();
    preloaded[sq.art].src = LAND_BASE + sq.art + '.svg';
  }
  function ownable(i) { var t = SQ[i] && SQ[i].type; return t === 'property' || t === 'transport' || t === 'utility'; }
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

  // ---------- เสียง (สังเคราะห์เอง ไม่โหลดไฟล์) ----------
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
      dice: function() { for (var i = 0; i < 6; i += 1) noise(0.035, 0.22, 2600 + i * 300, i * 0.07 + Math.random() * 0.03); },
      hop: function() { tone(620, 0.05, 'triangle', 0.05); },
      coin: function() { tone(1320, 0.08, 'sine', 0.14); tone(1760, 0.14, 'sine', 0.11, 0.06); },
      stamp: function() { tone(92, 0.2, 'sine', 0.45); noise(0.08, 0.3, 700); },
      gavel: function() { tone(240, 0.05, 'square', 0.12); noise(0.07, 0.4, 1400); },
      card: function() { noise(0.2, 0.12, 4200); },
      fanfare: function() { [523, 659, 784, 1047].forEach(function(f, i) { tone(f, 0.22, 'triangle', 0.14, i * 0.09); }); },
      jail: function() { tone(150, 0.45, 'sawtooth', 0.08); tone(112, 0.5, 'sawtooth', 0.07, 0.1); noise(0.12, 0.25, 900, 0.05); },
      turn: function() { tone(880, 0.1, 'sine', 0.12); tone(1175, 0.16, 'sine', 0.1, 0.08); },
      build: function() { tone(520, 0.06, 'square', 0.06); tone(780, 0.08, 'square', 0.05, 0.06); },
      bad: function() { tone(180, 0.16, 'square', 0.07); },
      bid: function() { tone(988, 0.06, 'triangle', 0.1); }
    };
  })();

  // ---------- กระดาน ----------
  function gridOf(i) {
    if (i === 0) return { r: 11, c: 11, side: 'x' };
    if (i < 10) return { r: 11, c: 11 - i, side: 'b' };
    if (i === 10) return { r: 11, c: 1, side: 'x' };
    if (i < 20) return { r: 11 - (i - 10), c: 1, side: 'l' };
    if (i === 20) return { r: 1, c: 1, side: 'x' };
    if (i < 30) return { r: 1, c: 1 + (i - 20), side: 't' };
    if (i === 30) return { r: 1, c: 11, side: 'x' };
    return { r: 1 + (i - 30), c: 11, side: 'r' };
  }

  var cells = [];
  function cornerHtml(i) {
    var sq = SQ[i];
    if (sq.type === 'go') return '<div class="st-corner st-corner--go"><div class="st-corner-icon">' + iconHtml('go') + '</div><div class="st-corner-label">เริ่ม</div><div class="st-corner-sub">ผ่านรับ ' + money(BOARD.salary) + '</div></div>';
    if (sq.type === 'jail') return '<div class="st-corner st-corner--jail"><div class="st-jail-box"><div class="st-corner-icon">' + iconHtml('jail') + '</div></div><span class="st-visit">เยี่ยมคุก</span></div>';
    if (sq.type === 'parking') return '<div class="st-corner"><div class="st-corner-icon">' + iconHtml('parking') + '</div><div class="st-corner-label">จอดฟรี</div></div>';
    return '<div class="st-corner st-corner--gotojail"><div class="st-corner-icon">' + iconHtml('whistle') + '</div><div class="st-corner-label">ไปคุก</div></div>';
  }
  function buildBoard() {
    var html = [];
    for (var i = 0; i < 40; i += 1) {
      var g = gridOf(i);
      var sq = SQ[i];
      var style = 'grid-row:' + g.r + ';grid-column:' + g.c + ';--band:' + bandOf(i) + ';';
      var label = sq.name + (sq.price ? ' ราคา ' + money(sq.price) : '');
      if (g.side === 'x') {
        html.push('<div class="st-cell is-corner" data-i="' + i + '" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + esc(sq.name) + '">' + cornerHtml(i) + '</div>');
        continue;
      }
      var hasBand = ownable(i) && sq.type === 'property';
      html.push('<div class="st-cell side-' + g.side + (hasBand ? '' : ' no-band') + '" data-i="' + i + '" style="' + style + '" role="gridcell" tabindex="0" aria-label="' + esc(label) + '">' +
        '<div class="st-cell-owner"></div>' +
        (hasBand ? '<div class="st-cell-band"><span class="st-cell-houses"></span></div>' : '') +
        '<div class="st-cell-main"><div class="st-cell-icon">' + iconHtml(sq.icon) + '</div><div class="st-cell-txt">' +
        '<div class="st-cell-name">' + esc(sq.short || sq.name) + '</div>' +
        (sq.price ? '<div class="st-cell-price">' + money(sq.price) + '</div>' : (sq.amount ? '<div class="st-cell-price">' + money(sq.amount) + '</div>' : '')) +
        '</div></div></div>');
    }
    html.push('<div class="st-center" id="stCenter">' +
      '<div class="st-word"><b>เศรษฐี</b><span>ทอย · ซื้อ · เก็บค่าเช่า</span></div>' +
      '<div class="st-deck st-deck--chance" id="stDeckChance"><i></i><i></i><i>' + iconHtml('chance') + '</i><b>โอกาส</b></div>' +
      '<div class="st-deck st-deck--fortune" id="stDeckFortune"><i></i><i></i><i>' + iconHtml('fortune') + '</i><b>ดวงชะตา</b></div>' +
      '<div class="st-dice" id="stDice">' + dieHtml() + dieHtml() + '<div class="st-die-shadow"></div></div>' +
      '<div class="st-center-status" id="stCenterStatus"></div>' +
      '</div>');
    el.board.innerHTML = html.join('');
    cells = [];
    el.board.querySelectorAll('.st-cell').forEach(function(c) { cells[Number(c.dataset.i)] = c; });
  }
  function dieHtml() {
    var pips = {
      1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9]
    };
    var faces = '';
    for (var f = 1; f <= 6; f += 1) {
      var cellsHtml = '';
      for (var k = 1; k <= 9; k += 1) cellsHtml += pips[f].indexOf(k) >= 0 ? '<i style="grid-area:' + (Math.ceil(k / 3)) + '/' + (((k - 1) % 3) + 1) + '"></i>' : '';
      faces += '<div class="st-die-face f' + f + '">' + cellsHtml + '</div>';
    }
    return '<div class="st-die">' + faces + '</div>';
  }
  var DIE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  function dieTransform(v, extraX, extraY, tx, ty, tz) {
    var r = DIE_ROT[v] || [0, 0];
    return 'translate3d(' + (tx || 0) + 'px,' + (ty || 0) + 'px,' + (tz || 0) + 'px) rotateX(-16deg) rotateY(22deg) rotateX(' + (r[0] + (extraX || 0)) + 'deg) rotateY(' + (r[1] + (extraY || 0)) + 'deg)';
  }
  function setDice(pair) {
    var dice = el.board.querySelectorAll('.st-die');
    if (!pair) pair = [5, 2];
    dice.forEach(function(d, k) { d.style.transform = dieTransform(pair[k]); });
  }

  // ---------- โมเดลภาพ ----------
  function modelFrom(state) {
    var m = { pos: {}, cash: {}, jail: {}, out: {}, props: {} };
    (state.seats || []).forEach(function(s) { m.pos[s.playerId] = s.pos; m.cash[s.playerId] = s.cash; m.jail[s.playerId] = s.inJail; m.out[s.playerId] = s.bankrupt || s.left; });
    Object.keys(state.props || {}).forEach(function(k) { var p = state.props[k]; m.props[k] = { owner: p.owner, houses: p.houses, mortgaged: p.mortgaged }; });
    return m;
  }

  function housesHtml(n) {
    if (!n) return '';
    if (n >= 5) return '<span class="is-hotel">' + ART.ICONS.hotel + '</span>';
    var out = '';
    for (var k = 0; k < n; k += 1) out += '<span>' + ART.ICONS.house + '</span>';
    return out;
  }
  function renderCell(i, model) {
    var c = cells[i];
    if (!c || !ownable(i)) return;
    var p = (model.props || {})[i] || {};
    var owner = p.owner ? seatOf(p.owner) : null;
    c.style.setProperty('--own', owner ? owner.tokenColor : 'transparent');
    c.classList.toggle('is-mortgaged', !!p.mortgaged);
    var pip = c.querySelector('.st-cell-pip');
    if (owner && !pip) { pip = document.createElement('span'); pip.className = 'st-cell-pip'; c.appendChild(pip); }
    if (!owner && pip) pip.remove();
    var lock = c.querySelector('.st-cell-lock');
    if (p.mortgaged && !lock) { lock = document.createElement('span'); lock.className = 'st-cell-lock'; lock.textContent = 'จำนอง'; c.appendChild(lock); }
    if (!p.mortgaged && lock) lock.remove();
    var h = c.querySelector('.st-cell-houses');
    if (h) {
      var key = String(p.houses || 0);
      if (h.dataset.n !== key) { h.dataset.n = key; h.innerHTML = housesHtml(p.houses || 0); }
    }
    var sq = SQ[i];
    c.setAttribute('aria-label', sq.name + (owner ? ' — เจ้าของ ' + owner.name : sq.price ? ' — ยังไม่มีเจ้าของ ราคา ' + money(sq.price) : '') + (p.houses ? (p.houses >= 5 ? ' โรงแรม' : ' บ้าน ' + p.houses + ' หลัง') : '') + (p.mortgaged ? ' (จำนอง)' : ''));
  }
  function renderCells(model) { for (var i = 0; i < 40; i += 1) renderCell(i, model); }

  // ---------- โทเคน ----------
  var tokenEls = {};
  function cellBox(i) {
    var c = cells[i];
    return { x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight };
  }
  function tokenSize() { return parseFloat(getComputedStyle(el.tokens).getPropertyValue('--tks')) || 18; }
  function slotXY(i, k, n, jailed) {
    var b = cellBox(i);
    var size = tokenSize();
    var cx = b.x + b.w / 2;
    var cy = b.y + b.h / 2;
    if (i === 10) {
      if (jailed) { cx = b.x + b.w * 0.67; cy = b.y + b.h * 0.33; } else { cx = b.x + b.w * 0.2; cy = b.y + b.h * 0.8; }
    }
    if (n > 1) {
      var cols = n <= 2 ? 2 : (n <= 4 ? 2 : 3);
      var rows = Math.ceil(n / cols);
      var col = k % cols;
      var row = Math.floor(k / cols);
      var step = Math.min(size * 0.62, (Math.min(b.w, b.h) - size) / Math.max(1, cols - 1));
      cx += (col - (cols - 1) / 2) * step;
      cy += (row - (rows - 1) / 2) * step * 0.8;
    }
    return { x: cx - size / 2, y: cy - size / 2 };
  }
  function ensureTokens(state) {
    (state.seats || []).forEach(function(s) {
      if (tokenEls[s.playerId]) return;
      var t = document.createElement('div');
      t.className = 'st-token';
      t.style.setProperty('--tk', s.tokenColor);
      t.innerHTML = '<span>' + esc(s.avatar || '👤') + '</span>';
      el.tokens.appendChild(t);
      tokenEls[s.playerId] = t;
    });
  }
  function placeTokens(model, skipId) {
    if (!S) return;
    ensureTokens(S);
    var groups = {};
    (S.seats || []).forEach(function(s) {
      if (model.out[s.playerId]) return;
      var key = model.pos[s.playerId] + (model.pos[s.playerId] === 10 && model.jail[s.playerId] ? 'j' : '');
      (groups[key] = groups[key] || []).push(s.playerId);
    });
    (S.seats || []).forEach(function(s) {
      var t = tokenEls[s.playerId];
      t.classList.toggle('is-out', !!model.out[s.playerId]);
      t.classList.toggle('is-turn', !!(S.turn && S.turn.playerId === s.playerId && S.phase !== 'finished'));
      if (s.playerId === skipId || model.out[s.playerId]) return;
      var pos = model.pos[s.playerId];
      var key = pos + (pos === 10 && model.jail[s.playerId] ? 'j' : '');
      var list = groups[key] || [s.playerId];
      var xy = slotXY(pos, list.indexOf(s.playerId), list.length, pos === 10 && model.jail[s.playerId]);
      t.style.transform = 'translate(' + xy.x + 'px,' + xy.y + 'px)';
    });
  }
  function tokenTransformAt(i, jailed) {
    var xy = slotXY(i, 0, 1, jailed);
    return { x: xy.x, y: xy.y };
  }

  // ---------- กล้อง (มือถือ) ----------
  var camState = { x: 0, y: 0, k: 1 };
  function camEnabled() { return !reduceMotion && window.innerWidth < 1000 && el.frame.offsetWidth < 620; }
  function camFor(i) {
    var b = cellBox(i);
    var W = el.cam.offsetWidth;
    var k = 1.85;
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
    return camTo({ x: 0, y: 0, k: 1 }, dur == null ? 320 : dur);
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
  function clearFx() {
    el.fx.innerHTML = '';
    setModal(false);
  }
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
      fxNode('st-fx-skip', 'แตะเพื่อข้าม');
    }
    return A(s, [{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: dur || 220 });
  }
  function centerNode() { return el.fx.querySelector('.st-fx-center') || fxNode('st-fx-center'); }

  document.addEventListener('pointerdown', function(e) {
    if (!running) return;
    if (e.target && e.target.closest && e.target.closest('.st-sheet-card, .st-dock, .chat-box, .st-sidebar')) return;
    skipNow();
  }, true);
  document.addEventListener('keydown', function(e) { if (running && (e.key === 'Escape' || e.key === ' ')) skipNow(); });

  var INSTANT = { bid: 1, tradeOffer: 1, tradeClosed: 1, left: 1, start: 1, debt: 1 };

  function enqueueFx(list) {
    list.forEach(function(f) {
      if (INSTANT[f.kind]) { instantFx(f); return; }
      if (f.kind === 'turn' && f.playerId !== playerId) return;
      if (f.kind === 'salary') return; // เล่นตอนเดินผ่านจุดเริ่มแล้ว
      queue.push(f);
    });
    if (!running) runQueue();
  }

  function pickSpeed(f) {
    var base = reduceMotion ? 5 : 1;
    var lag = nowServer() - (f.at || nowServer());
    if (queue.length >= 14 || lag > 12000) return Math.max(base, 5);
    if (queue.length >= 7 || lag > 6000) return Math.max(base, 2.6);
    if (queue.length >= 4) return Math.max(base, 1.6);
    return base;
  }

  async function runQueue() {
    if (running) return;
    running = true;
    renderDock();
    while (queue.length) {
      if (document.hidden || queue.length > 40) { queue = []; break; }
      var f = queue.shift();
      speed = pickSpeed(f);
      skipping = false;
      try {
        await playFx(f);
      } catch (e) {
        if (window.console) console.warn('[setthi] fx', f.kind, e && e.message);
      }
      clearFx();
      skipping = false;
    }
    running = false;
    speed = 1;
    await camReset(260);
    renderAll();
  }

  function playFx(f) {
    var h = FX[f.kind];
    return h ? h(f) : Promise.resolve();
  }

  function instantFx(f) {
    if (f.kind === 'bid') {
      sfx.bid();
      var hi = document.querySelector('.st-auction-high strong');
      if (hi) { hi.classList.remove('is-bump'); void hi.offsetWidth; hi.classList.add('is-bump'); }
      if (f.playerId !== playerId && S && S.auction) {
        // ประมูลกำลังดำเนิน — sheet วาดใหม่จาก S อยู่แล้ว
      }
      return;
    }
    if (f.kind === 'tradeOffer' && f.to === playerId) {
      haptic([15, 40, 15]);
      sfx.turn();
    }
    if (f.kind === 'tradeClosed' && f.from === playerId && f.reason === 'rejected') toast(nameOf(f.to) + ' ปฏิเสธข้อเสนอของคุณ');
    if (f.kind === 'tradeClosed' && f.from === playerId && f.reason === 'expired') toast('ข้อเสนอหมดเวลา');
    if (f.kind === 'left' && f.playerId !== playerId) toast(nameOf(f.playerId) + ' ออกจากเกม — ทรัพย์สินคืนธนาคาร');
    if (f.kind === 'debt' && f.playerId === playerId) { haptic([30, 50, 30]); sfx.bad(); }
  }

  // ตำแหน่งบนจอ
  function centerOf(node) {
    if (!node) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function chipOf(id) { return el.strip.querySelector('.st-chip[data-id="' + id + '"] .st-chip-token') || el.strip.querySelector('.st-chip[data-id="' + id + '"]'); }
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
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      node.textContent = money(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    A(node, [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
  }

  function flyCoins(from, to, amount) {
    if (reduceMotion) return Promise.resolve();
    var n = Math.max(4, Math.min(12, Math.round(Math.log2((amount || 10) / 5)) + 3));
    var promises = [];
    for (var k = 0; k < n; k += 1) {
      var coin = fxNode('st-coin' + (amount >= 300 ? ' is-big' : ''));
      var dx = (Math.random() - 0.5) * 30;
      var mid = { x: (from.x + to.x) / 2 + dx, y: Math.min(from.y, to.y) - 50 - Math.random() * 40 };
      promises.push(A(coin, [
        { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(0.6)', opacity: 0 },
        { transform: 'translate(' + from.x + 'px,' + from.y + 'px) scale(1)', opacity: 1, offset: 0.12 },
        { transform: 'translate(' + mid.x + 'px,' + mid.y + 'px) scale(1.15) rotate(180deg)', opacity: 1, offset: 0.55 },
        { transform: 'translate(' + to.x + 'px,' + to.y + 'px) scale(0.7) rotate(360deg)', opacity: 0.2 }
      ], { duration: 760, delay: k * 55, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' }));
    }
    setTimeout(function() { sfx.coin(); }, 420 / speed);
    return Promise.all(promises);
  }
  function moneyTag(at, amount, plus) {
    var tag = fxNode('st-money ' + (plus ? 'is-plus' : 'is-minus'), (plus ? '+' : '−') + money(amount));
    return A(tag, [
      { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 26) + 'px) translate(-50%, -50%) scale(1.08)', opacity: 1, offset: 0.3 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 46) + 'px) translate(-50%, -50%) scale(1)', opacity: 0 }
    ], { duration: 1100, easing: 'ease-out' });
  }

  function banner(opts) {
    var html = (opts.token ? tokenHtml(opts.token) : '') + (opts.icon ? '<div class="st-banner-art">' + iconHtml(opts.icon) + '</div>' : '') +
      (opts.kicker ? '<div class="st-banner-kicker">' + esc(opts.kicker) + '</div>' : '') +
      '<div class="st-banner-title">' + esc(opts.title) + '</div>' +
      (opts.sub ? '<div class="st-banner-sub">' + esc(opts.sub) + '</div>' : '');
    var b = fxNode('st-banner', html);
    if (opts.style) b.setAttribute('style', opts.style);
    return b;
  }
  async function showBanner(opts, hold) {
    var b = banner(opts);
    await A(b, [{ transform: 'translateX(-50%) translateY(18px) scale(0.92)', opacity: 0 }, { transform: 'translateX(-50%) translateY(0) scale(1)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await wait(hold || 700);
    await A(b, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(-50%) translateY(-10px) scale(0.98)' }], { duration: 220 });
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
  function deedHtml(i, opts) {
    opts = opts || {};
    var sq = SQ[i];
    var g = groupOf(i);
    var p = (S && S.props && S.props[i]) || {};
    var kicker = g ? 'สี' + g.name + ' · ' + g.region : (sq.type === 'transport' ? 'การเดินทาง' : sq.type === 'utility' ? 'สาธารณูปโภค' : '');
    var rows = '';
    if (sq.type === 'property') {
      var labels = ['ค่าเช่า', 'บ้าน 1 หลัง', 'บ้าน 2 หลัง', 'บ้าน 3 หลัง', 'บ้าน 4 หลัง', 'โรงแรม'];
      sq.rent.forEach(function(r, k) {
        rows += '<tr class="' + (p.owner && p.houses === k ? 'is-now' : '') + '"><td>' + labels[k] + '</td><td>' + money(r) + '</td></tr>';
        if (k === 0) rows += '<tr><td>ครบชุดสี (ไม่มีบ้าน)</td><td>' + money(r * 2) + '</td></tr>';
      });
    } else if (sq.type === 'transport') {
      BOARD.transportRent.forEach(function(r, k) { rows += '<tr><td>มี ' + (k + 1) + ' แห่ง</td><td>' + money(r) + '</td></tr>'; });
    } else if (sq.type === 'utility') {
      rows = '<tr><td>มี 1 แห่ง</td><td>เต๋า × ' + BOARD.utilityMult[0] + '</td></tr><tr><td>มี 2 แห่ง</td><td>เต๋า × ' + BOARD.utilityMult[1] + '</td></tr>';
    }
    var foot = '';
    if (sq.type === 'property') foot = 'บ้านหลังละ ' + money(g.houseCost) + ' · โรงแรม = บ้าน 4 + ' + money(g.houseCost) + '<br>จำนองได้ ' + money(Math.floor(sq.price / 2)) + ' · ไถ่ถอน ' + money(Math.ceil(Math.floor(sq.price / 2) * 11 / 10));
    else if (sq.price) foot = 'จำนองได้ ' + money(Math.floor(sq.price / 2)) + ' · ไถ่ถอน ' + money(Math.ceil(Math.floor(sq.price / 2) * 11 / 10));
    var owner = p.owner ? seatOf(p.owner) : null;
    return '<div class="st-deed" style="--band:' + (g ? g.color : bandOf(i)) + ';--band-ink:' + (g ? g.ink : '#fff') + '">' +
      '<div class="st-deed-head"><span class="st-deed-kicker">' + esc(kicker) + '</span><b class="st-deed-name">' + esc(sq.name) + '</b></div>' +
      landHtml(i, opts.compact ? 'is-compact' : '') +
      (sq.blurb && !opts.compact ? '<div class="st-deed-blurb">' + esc(sq.blurb) + '</div>' : '') +
      '<div class="st-deed-price">ราคา ' + money(sq.price) + '</div>' +
      (opts.compact ? '' : '<table class="st-deed-rent">' + rows + '</table><div class="st-deed-foot">' + foot + '</div>') +
      (opts.owner !== false && owner ? '<div class="st-deed-owner">' + tokenHtml(owner) + '<span>' + esc(owner.name) + '</span></div>' : '') +
      (opts.owner !== false && p.mortgaged ? '<span class="st-deed-tag">จำนองอยู่ — ไม่เก็บค่าเช่า</span>' : '') +
      '</div>';
  }

  // ---------- ฉากแต่ละแบบ ----------
  var FX = {};

  FX.turn = async function(f) {
    if (f.playerId !== playerId) return;
    sfx.turn();
    haptic([18, 40, 28]);
    await camReset(200);
    var b = banner({ kicker: 'รอบที่ ' + (f.round || 1), title: 'ตาคุณ!', token: meSeat(), style: 'top:38%' });
    await A(b, [{ transform: 'translateX(-50%) scale(0.7)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await wait(450);
    await A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
  };

  FX.dice = async function(f) {
    await camReset(220);
    sfx.dice();
    var power = Number(f.power) || 0;
    if (f.perfect) perfectFlash();
    var dice = el.board.querySelectorAll('.st-die');
    var W = el.cam.offsetWidth;
    var ps = [];
    var throwK = 1 + power * 0.9;
    dice.forEach(function(d, k) {
      var v = f.d[k];
      var spinX = 720 + Math.floor(Math.random() * 2) * 360 + Math.round(power * 2) * 360;
      var spinY = 540 + Math.floor(Math.random() * 2) * 360 + Math.round(power * 2) * 360;
      var sx = (k ? 1 : -1) * W * (0.18 + Math.random() * 0.08) * throwK;
      var sy = -W * (0.28 + Math.random() * 0.06) * throwK;
      d.style.transform = dieTransform(v, 0, 0, 0, 0, 0);
      ps.push(A(d, [
        { transform: dieTransform(v, spinX, spinY, sx, sy, 60) },
        { transform: dieTransform(v, spinX * 0.35, spinY * 0.35, sx * 0.25, W * 0.02, 0), offset: 0.55 },
        { transform: dieTransform(v, spinX * 0.08, spinY * 0.08, sx * 0.05, -W * 0.03, 10), offset: 0.75 },
        { transform: dieTransform(v, 0, 0, 0, 0, 0) }
      ], { duration: 980 + power * 620, delay: k * 70, easing: 'cubic-bezier(0.3, 0.6, 0.35, 1)', fill: 'none' }));
    });
    if (power >= 0.85) { var c0 = centerOf($('#stDice')); setTimeout(function() { burst(c0, ['#f5c86b', '#ef5b4c', '#fff3c4'], 14, 70); }, (900 + power * 600) / speed); }
    await Promise.all(ps);
    if (f.doubles) {
      var c = cellPoint(0);
      var center = centerOf($('#stDice'));
      var tag = fxNode('st-money is-plus', f.purpose === 'jail' ? 'ดับเบิล! ออกคุก' : 'ดับเบิล!');
      await A(tag, [
        { transform: 'translate(' + center.x + 'px,' + center.y + 'px) translate(-50%, -50%) scale(0.5)', opacity: 0 },
        { transform: 'translate(' + center.x + 'px,' + (center.y - 40) + 'px) translate(-50%, -50%) scale(1.1)', opacity: 1, offset: 0.35 },
        { transform: 'translate(' + center.x + 'px,' + (center.y - 50) + 'px) translate(-50%, -50%) scale(1)', opacity: 0 }
      ], { duration: 900 });
      void c;
    } else {
      await wait(180);
    }
  };

  function perfectFlash() {
    var at = centerOf($('#stDice'));
    var n = fxNode('st-perfect', 'เป๊ะ!<small>ช่องเขียว · ลุ้นดับเบิล</small>');
    sfx.fanfare();
    haptic([10, 30, 10]);
    burst(at, ['#45f09a', '#f5c86b', '#ffffff'], 18, 90);
    A(n, [
      { transform: 'translate(' + at.x + 'px,' + (at.y - 30) + 'px) translate(-50%, -50%) scale(0.4) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 58) + 'px) translate(-50%, -50%) scale(1.15) rotate(-4deg)', opacity: 1, offset: 0.25 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 62) + 'px) translate(-50%, -50%) scale(1) rotate(-4deg)', opacity: 1, offset: 0.75 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 76) + 'px) translate(-50%, -50%) scale(0.95) rotate(-4deg)', opacity: 0 }
    ], { duration: 1300 });
  }

  FX.move = async function(f) {
    var t = tokenEls[f.playerId];
    if (!t || !V) return;
    var path = f.path || [];
    var hops = path.length;
    var useCam = camEnabled();
    var per = hops > 12 ? Math.max(70, 1500 / hops) : 150;
    var cur = t.style.transform;
    V.jail[f.playerId] = false;
    if (useCam) await camTo(camFor(f.from), 300);
    for (var k = 0; k < hops; k += 1) {
      var sq = path[k];
      var xy = tokenTransformAt(sq, false);
      var target = 'translate(' + xy.x + 'px,' + xy.y + 'px)';
      var fromT = cur.replace(/ ?translateY\([^)]*\)| ?scale\([^)]*\)/g, '');
      var midX = xy.x;
      var midY = xy.y;
      t.style.transform = target;
      var hop = A(t, [
        { transform: fromT + ' translateY(0px) scale(1)' },
        { transform: 'translate(' + midX + 'px,' + midY + 'px) translateY(-' + Math.round(tokenSize() * 0.9) + 'px) scale(1.22)', offset: 0.45 },
        { transform: target + ' translateY(0px) scale(1)' }
      ], { duration: per, easing: 'ease-in-out', fill: 'none' });
      if (useCam) camTo(camFor(sq), per);
      if (k % 2 === 0) sfx.hop();
      await hop;
      cur = target;
      if (sq === 0 && f.passGo) passGoPop(f.playerId);
    }
    V.pos[f.playerId] = f.to;
    placeTokens(V);
    if (cells[f.to]) {
      cells[f.to].classList.add('is-land');
      setTimeout(function() { if (cells[f.to]) cells[f.to].classList.remove('is-land'); }, 900);
    }
    await wait(useCam ? 260 : 120);
  };

  function passGoPop(id) {
    var salaryFx = (S.fx || []).find(function(x) { return x.kind === 'salary' && x.playerId === id && x.seq > lastPlayedSeq; });
    var at = cellPoint(0);
    var pop = fxNode('st-salary', '<small>ผ่านจุดเริ่ม · เงินเดือน</small>+' + money(BOARD.salary));
    A(pop, [
      { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.4)', opacity: 0 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 40) + 'px) translate(-50%, -50%) scale(1.12)', opacity: 1, offset: 0.25 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 52) + 'px) translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(' + at.x + 'px,' + (at.y - 70) + 'px) translate(-50%, -50%) scale(0.95)', opacity: 0 }
    ], { duration: 1400, easing: 'ease-out' });
    flyCoins(at, centerOf(chipOf(id)), BOARD.salary);
    burst(at, ['#f5c86b', '#fff3c4', '#3fbf7f'], 16, 70);
    sfx.coin();
    if (salaryFx && salaryFx.cash) setCash(salaryFx.cash);
    else if (V) setCash((function() { var m = {}; m[id] = (V.cash[id] || 0) + BOARD.salary; return m; })());
  }
  var lastPlayedSeq = 0;

  FX.card = async function(f) {
    var deck = f.deck === 'chance' ? $('#stDeckChance') : $('#stDeckFortune');
    var from = centerOf(deck);
    setModal(true);
    sfx.card();
    var center = centerNode();
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight * 0.46;
    var scale0 = Math.max(0.12, (deck ? deck.getBoundingClientRect().width : 50) / 240);
    var card = document.createElement('div');
    card.className = 'st-bigcard';
    var deckColor = f.deck === 'chance' ? 'oklch(0.66 0.13 70)' : 'oklch(0.5 0.17 25)';
    var who = seatOf(f.playerId);
    card.innerHTML = '<div class="st-bigcard-inner">' +
      '<div class="st-bigcard-back ' + (f.deck === 'chance' ? 'is-chance' : 'is-fortune') + '">' + iconHtml(f.deck === 'chance' ? 'chance' : 'fortune') + '</div>' +
      '<div class="st-bigcard-face" style="--deck:' + deckColor + '">' +
      '<div class="st-bigcard-kicker">' + (f.deck === 'chance' ? 'โอกาส' : 'ดวงชะตา') + '</div>' +
      '<div class="st-bigcard-art">' + iconHtml(f.card.icon) + '</div>' +
      '<div class="st-bigcard-title">' + esc(f.card.title) + '</div>' +
      '<div class="st-bigcard-text">' + esc(f.card.text) + '</div>' +
      '<div class="st-bigcard-who">' + esc(who ? who.name : '') + '</div>' +
      '</div></div>';
    center.appendChild(card);
    var inner = card.querySelector('.st-bigcard-inner');
    scrim(true, 260);
    var dx = from.x - cx;
    var dy = from.y - cy;
    inner.style.transform = 'rotateY(180deg)';
    card.style.transform = 'translate(0px, 0px) scale(1)';
    await Promise.all([
      A(card, [
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale0 + ') rotate(' + (f.deck === 'chance' ? -11 : 11) + 'deg)' },
        { transform: 'translate(0px, -20px) scale(1.04) rotate(0deg)', offset: 0.7 },
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)' }
      ], { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'none' }),
      A(inner, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(0deg)', offset: 0.35 }, { transform: 'rotateY(180deg)' }], { duration: 760, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'none' })
    ]);
    if (f.playerId === playerId) haptic(12);
    await wait(reduceMotion ? 1600 : 1500);
    await Promise.all([
      A(card, [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(0, 30px) scale(0.86)', opacity: 0 }], { duration: 240 }),
      scrim(false, 240)
    ]);
  };

  async function soldScene(f, opts) {
    var sq = f.square;
    var to = chipOf(f.winner || f.playerId);
    setModal(true);
    var center = centerNode();
    var fly = document.createElement('div');
    fly.className = 'st-flydeed';
    fly.innerHTML = deedHtml(sq, { compact: true, owner: false });
    center.appendChild(fly);
    var w = 170;
    fly.style.left = (-w / 2) + 'px';
    fly.style.top = '-120px';
    scrim(true, 200);
    await A(fly, [{ transform: 'translateY(40px) scale(0.6) rotate(-6deg)', opacity: 0 }, { transform: 'translateY(0) scale(1) rotate(0deg)', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    var stamp = document.createElement('div');
    stamp.className = 'st-stamp';
    stamp.style.top = (fly.offsetHeight - 120 - 70) + 'px';
    stamp.innerHTML = '<div>ขายแล้ว<small>SOLD</small></div>';
    center.appendChild(stamp);
    sfx.stamp();
    haptic(20);
    await A(stamp, [
      { transform: 'scale(2.4) rotate(-4deg)', opacity: 0 },
      { transform: 'scale(0.92) rotate(-12deg)', opacity: 1, offset: 0.6 },
      { transform: 'scale(1) rotate(-12deg)', opacity: 1 }
    ], { duration: 340, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' });
    A(center.querySelector('.st-flydeed .st-deed') || fly, [{ transform: 'translateY(0)' }, { transform: 'translateY(5px)', offset: 0.3 }, { transform: 'translateY(0)' }], { duration: 220 });
    if (opts && opts.price) moneyTag({ x: window.innerWidth / 2, y: window.innerHeight * 0.46 + 70 }, opts.price, false);
    await wait(560);
    var target = centerOf(to);
    var here = centerOf(fly);
    A(stamp, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    scrim(false, 300);
    await A(fly, [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + (target.x - here.x) + 'px,' + (target.y - here.y) + 'px) scale(0.16) rotate(10deg)', opacity: 0.2 }
    ], { duration: 520, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' });
    if (V) {
      V.props[sq] = Object.assign({}, V.props[sq] || {}, { owner: f.winner || f.playerId });
      renderCell(sq, V);
      var pip = cells[sq] && cells[sq].querySelector('.st-cell-pip');
      if (pip) A(pip, [{ transform: 'scale(2.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 360, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'none' });
    }
  }

  FX.buy = async function(f) {
    setCash(f.cash);
    await soldScene(f, { price: f.price });
  };

  var GAVEL_SVG = '<svg viewBox="0 0 160 64" aria-hidden="true"><defs><linearGradient id="stGh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9995f"/><stop offset=".5" stop-color="#a8673f"/><stop offset="1" stop-color="#6b3f22"/></linearGradient><linearGradient id="stGs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b57a49"/><stop offset="1" stop-color="#6b3f22"/></linearGradient></defs>' +
    '<rect x="4" y="27" width="104" height="10" rx="5" fill="url(#stGs)"/><circle cx="8" cy="32" r="6" fill="#6b3f22"/>' +
    '<rect x="100" y="4" width="40" height="56" rx="10" fill="url(#stGh)"/><rect x="96" y="10" width="48" height="8" rx="3" fill="#f5c86b"/><rect x="96" y="46" width="48" height="8" rx="3" fill="#f5c86b"/><rect x="106" y="20" width="5" height="24" rx="2" fill="#fff" opacity=".25"/></svg>';
  FX.auctionStart = async function(f) {
    setModal(true);
    var center = centerNode();
    scrim(true, 200);
    var stage = document.createElement('div');
    stage.className = 'st-auction-stage';
    stage.innerHTML = '<div class="st-flydeed">' + deedHtml(f.square, { compact: true, owner: false }) + '</div>' +
      '<div class="st-gavel-block"></div><div class="st-gavel">' + GAVEL_SVG + '</div>';
    center.appendChild(stage);
    var fly = stage.querySelector('.st-flydeed');
    var gavel = stage.querySelector('.st-gavel');
    var block = stage.querySelector('.st-gavel-block');
    var title = banner({ kicker: 'ไม่มีใครซื้อ', title: 'เปิดประมูล!', sub: 'ใครก็เสนอราคาได้ · ' + SQ[f.square].name, style: 'top:7%;' });
    A(title, [{ transform: 'translateX(-50%) translateY(-16px)', opacity: 0 }, { transform: 'translateX(-50%) translateY(0)', opacity: 1 }], { duration: 300 });
    await Promise.all([
      A(fly, [{ transform: 'translateY(30px) scale(0.5) rotate(-6deg)', opacity: 0 }, { transform: 'translateY(0) scale(0.82) rotate(-4deg)', opacity: 1 }], { duration: 340, easing: 'cubic-bezier(0.34,1.56,0.64,1)' }),
      A(block, [{ transform: 'translateY(20px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 300 }),
      A(gavel, [{ transform: 'translateX(60px) rotate(-70deg)', opacity: 0 }, { transform: 'translateX(0) rotate(-48deg)', opacity: 1 }], { duration: 320 })
    ]);
    for (var k = 0; k < 2; k += 1) {
      await A(gavel, [{ transform: 'rotate(-48deg)' }, { transform: 'rotate(-56deg)', offset: 0.45 }, { transform: 'rotate(6deg)' }], { duration: k ? 300 : 360, easing: 'cubic-bezier(0.6, 0, 0.9, 0.6)' });
      sfx.gavel();
      haptic(14);
      A(block, [{ transform: 'translateY(0) scaleY(1)' }, { transform: 'translateY(3px) scaleY(0.9)' }, { transform: 'translateY(0) scaleY(1)' }], { duration: 160 });
      burst(centerOf(block), ['#f5c86b', '#fff3c4'], 8, 46);
      await A(gavel, [{ transform: 'rotate(6deg)' }, { transform: 'rotate(-48deg)' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
    }
    await wait(380);
    scrim(false, 220);
    await Promise.all([A(stage, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 220 }), A(title, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 })]);
  };

  FX.auctionEnd = async function(f) {
    closeSheetIf('auction');
    if (!f.winner) {
      await showBanner({ icon: 'gavel', kicker: 'จบประมูล', title: 'ไม่มีผู้ประมูล', sub: SQ[f.square].name + ' ยังเป็นของธนาคาร' }, 650);
      return;
    }
    setCash(f.cash);
    sfx.gavel();
    await soldScene({ square: f.square, winner: f.winner }, { price: f.amount });
  };

  FX.rent = async function(f) {
    var hasSq = f.square !== undefined && f.square !== null && cells[f.square];
    var payerToken = tokenEls[f.from];
    var from = payerToken && V && !V.out[f.from] ? centerOf(payerToken) : centerOf(chipOf(f.from));
    var to = centerOf(chipOf(f.to));
    if (hasSq) cells[f.square].classList.add('is-land');
    var owner = seatOf(f.to);
    var ribbon = fxNode('st-rent', '<span class="st-rent-k">ค่าเช่า' + (hasSq ? ' · ' + esc(SQ[f.square].short || SQ[f.square].name) : '') + '</span><b>' + money(f.amount) + '</b><span class="st-rent-to">→ ' + esc(owner ? owner.name : '') + '</span>');
    var at = hasSq ? cellPoint(f.square) : from;
    var rx = Math.max(90, Math.min(window.innerWidth - 90, at.x));
    var boardRect = el.frame.getBoundingClientRect();
    var dir = at.y < boardRect.top + boardRect.height / 2 ? 1 : -1; // แถวบนให้ป้ายอยู่ใต้ช่อง ไม่ทับแถบผู้เล่น
    var ry = at.y + dir * 54;
    A(ribbon, [
      { transform: 'translate(' + rx + 'px,' + (ry - dir * 16) + 'px) translate(-50%, -50%) scale(0.7)', opacity: 0 },
      { transform: 'translate(' + rx + 'px,' + ry + 'px) translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.2 },
      { transform: 'translate(' + rx + 'px,' + (ry + dir * 4) + 'px) translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(' + rx + 'px,' + (ry + dir * 12) + 'px) translate(-50%, -50%) scale(0.96)', opacity: 0 }
    ], { duration: 1500 });
    moneyTag(centerOf(chipOf(f.from)), f.amount, false);
    await flyCoins(from, to, f.amount);
    setCash(f.cash);
    moneyTag(to, f.amount, true);
    if (f.to === playerId) haptic(10);
    await wait(260);
    if (f.square !== undefined && f.square !== null && cells[f.square]) cells[f.square].classList.remove('is-land');
  };

  FX.pay = async function(f) {
    var from = centerOf(chipOf(f.from));
    var to = f.to ? centerOf(chipOf(f.to)) : bankPoint();
    moneyTag(from, f.amount, false);
    await flyCoins(from, to, f.amount);
    setCash(f.cash);
    if (f.to) moneyTag(to, f.amount, true);
    await wait(180);
  };

  FX.gain = async function(f) {
    var to = centerOf(chipOf(f.playerId));
    await flyCoins(bankPoint(), to, f.amount);
    setCash(f.cash);
    moneyTag(to, f.amount, true);
    await wait(200);
  };

  FX.build = async function(f) {
    setCash(f.cash);
    var c = cells[f.square];
    if (!c || !V) return;
    var hotel = f.houses >= 5;
    if (camEnabled()) await camTo(camFor(f.square), 260);
    var band = c.querySelector('.st-cell-band') || c;
    var at = centerOf(band);
    var drop = fxNode('st-house-drop' + (hotel ? ' is-hotel' : ''), hotel ? ART.ICONS.hotel : ART.ICONS.house);
    var size = hotel ? 52 : 38;
    sfx.build();
    await A(drop, [
      { transform: 'translate(' + (at.x - size / 2) + 'px,' + (at.y - size / 2 - 120) + 'px) scale(1.3) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(' + (at.x - size / 2) + 'px,' + (at.y - size / 2 - 8) + 'px) scale(1.05) rotate(0deg)', opacity: 1, offset: 0.65 },
      { transform: 'translate(' + (at.x - size / 2) + 'px,' + (at.y - size / 2 + 2) + 'px) scale(1.12, 0.86)', opacity: 1, offset: 0.82 },
      { transform: 'translate(' + (at.x - size / 2) + 'px,' + (at.y - size / 2) + 'px) scale(0.45)', opacity: 0 }
    ], { duration: hotel ? 700 : 560, easing: 'cubic-bezier(0.45, 0, 0.55, 1)' });
    var ring = fxNode('st-ring');
    A(ring, [{ transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(0.3)', opacity: 0.9 }, { transform: 'translate(' + at.x + 'px,' + at.y + 'px) translate(-50%, -50%) scale(1.6)', opacity: 0 }], { duration: 520, easing: 'ease-out' });
    V.props[f.square] = Object.assign({}, V.props[f.square], { houses: f.houses });
    renderCell(f.square, V);
    var hs = c.querySelectorAll('.st-cell-houses > span');
    var newest = hs[hs.length - 1];
    if (newest) A(newest, [{ transform: 'scale(2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'none' });
    burst(at, hotel ? ['#f5c86b', '#fff3c4', '#e5534b'] : ['#d9c9a3', '#ffffff'], hotel ? 22 : 8, hotel ? 70 : 26);
    if (hotel) {
      haptic([15, 30, 15]);
      sfx.fanfare();
      await showBanner({ icon: 'crown', kicker: SQ[f.square].name, title: 'สร้างโรงแรม!', sub: 'ค่าเช่า ' + money(SQ[f.square].rent[5]) }, 650);
    } else {
      await wait(160);
    }
  };

  FX.sell = async function(f) {
    setCash(f.cash);
    var c = cells[f.square];
    if (!c || !V) return;
    var at = centerOf(c.querySelector('.st-cell-band') || c);
    var up = fxNode('st-house-drop', ART.ICONS.house);
    V.props[f.square] = Object.assign({}, V.props[f.square], { houses: f.houses });
    renderCell(f.square, V);
    await A(up, [
      { transform: 'translate(' + (at.x - 11) + 'px,' + (at.y - 11) + 'px) scale(0.8)', opacity: 1 },
      { transform: 'translate(' + (at.x - 11) + 'px,' + (at.y - 60) + 'px) scale(1.2)', opacity: 0 }
    ], { duration: 460 });
  };

  FX.mortgage = async function(f) {
    setCash(f.cash);
    if (!V) return;
    V.props[f.square] = Object.assign({}, V.props[f.square], { mortgaged: true });
    renderCell(f.square, V);
    var lock = cells[f.square] && cells[f.square].querySelector('.st-cell-lock');
    if (lock) await A(lock, [{ transform: 'scale(2.4) rotate(-12deg)', opacity: 0 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'none' });
    moneyTag(centerOf(chipOf(f.playerId)), f.amount, true);
    await wait(200);
  };

  FX.unmortgage = async function(f) {
    setCash(f.cash);
    if (!V) return;
    var lock = cells[f.square] && cells[f.square].querySelector('.st-cell-lock');
    if (lock) await A(lock, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.6) translateY(-6px)', opacity: 0 }], { duration: 300 });
    V.props[f.square] = Object.assign({}, V.props[f.square], { mortgaged: false });
    renderCell(f.square, V);
    await wait(120);
  };

  FX.set = async function(f) {
    var g = GROUPS[f.group];
    var squares = BOARD.groupSquares[f.group] || [];
    squares.forEach(function(i) { if (cells[i]) { cells[i].classList.remove('is-glow'); void cells[i].offsetWidth; cells[i].classList.add('is-glow'); } });
    sfx.fanfare();
    if (f.playerId === playerId) haptic([20, 40, 20, 40, 30]);
    var who = seatOf(f.playerId);
    var b = banner({ token: who, kicker: 'ครบชุดสี' + g.name + '!', title: g.region, sub: (who ? who.name : '') + ' · ค่าเช่า 2 เท่า สร้างบ้านได้แล้ว', style: 'border-color:' + g.color + ';' });
    var top = centerOf(b);
    await A(b, [{ transform: 'translateX(-50%) scale(0.6)', opacity: 0 }, { transform: 'translateX(-50%) scale(1.04)', opacity: 1, offset: 0.7 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    burst(top, [g.color, '#f5c86b', '#fff3c4'], 26, 150);
    await wait(900);
    await A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
    squares.forEach(function(i) { if (cells[i]) cells[i].classList.remove('is-glow'); });
  };

  FX.jail = async function(f) {
    var t = tokenEls[f.playerId];
    var who = seatOf(f.playerId);
    if (t && V) {
      var xy = tokenTransformAt(10, true);
      var from = t.style.transform;
      var to = 'translate(' + xy.x + 'px,' + xy.y + 'px)';
      t.style.transform = to;
      if (camEnabled()) camTo(camFor(10), 360);
      await A(t, [
        { transform: from + ' scale(1)' },
        { transform: from + ' scale(1.6)', offset: 0.25 },
        { transform: to + ' scale(1)' }
      ], { duration: 520, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'none' });
      V.pos[f.playerId] = 10;
      V.jail[f.playerId] = true;
      placeTokens(V);
    }
    setModal(true);
    sfx.jail();
    if (f.playerId === playerId) haptic([40, 60, 40]);
    scrim(true, 200);
    var b = banner({ token: who, kicker: f.reason || 'โดนจับ', title: 'เข้าคุก!', sub: (who ? who.name : '') + ' · ทอยดับเบิล จ่าย ' + money(BOARD.jailFine) + ' หรือใช้บัตรเพื่อออก', style: 'top:40%;' });
    var bars = fxNode('st-bars', '<i></i><i></i><i></i><i></i><i></i><i></i>');
    var rail = fxNode('st-bars-rail');
    A(b, [{ transform: 'translateX(-50%) scale(0.85)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 260 });
    await Promise.all([
      A(bars, [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)', offset: 0.8 }, { transform: 'translateY(-3%)' }], { duration: 520, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' }),
      A(rail, [{ transform: 'translateY(-100vh)' }, { transform: 'translateY(0)', offset: 0.8 }, { transform: 'translateY(-2vh)' }], { duration: 560, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' })
    ]);
    await wait(800);
    await Promise.all([A(bars, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }), A(rail, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }), A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }), scrim(false, 220)]);
  };

  FX.jailFree = async function(f) {
    var who = seatOf(f.playerId);
    if (V) { V.jail[f.playerId] = false; placeTokens(V); }
    var how = { fine: 'จ่ายค่าปรับ ' + money(BOARD.jailFine), card: 'ใช้บัตรอภัยโทษ', doubles: 'ทอยได้ดับเบิล', forced: 'ครบ 3 ตา จ่ายค่าปรับ' }[f.how] || '';
    var bars = fxNode('st-bars', '<i></i><i></i><i></i><i></i><i></i><i></i>', 'opacity:0.85');
    var b = banner({ token: who, kicker: how, title: 'ออกจากคุก!', sub: who ? who.name : '', style: 'top:40%;' });
    A(b, [{ transform: 'translateX(-50%) scale(0.85)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 240 });
    await A(bars, [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: 560, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' });
    await wait(400);
    await A(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
  };

  FX.trade = async function(f) {
    closeSheetIf('offer');
    var a = seatOf(f.from);
    var b = seatOf(f.to);
    setModal(true);
    scrim(true, 200);
    var center = centerNode();
    var sum = function(side) {
      var parts = (side.props || []).map(function(i) { return SQ[i].short || SQ[i].name; });
      if (side.cash) parts.push(money(side.cash));
      if (side.jailCards) parts.push('บัตรอภัยโทษ');
      return parts.join(' + ') || 'ไม่มี';
    };
    var node = document.createElement('div');
    node.className = 'st-shake';
    node.innerHTML = '<div class="st-shake-row">' + tokenHtml(a) + '<div class="st-shake-hands">' + iconHtml('handshake') + '</div>' + tokenHtml(b) + '</div>' +
      '<div class="st-shake-title">ดีลสำเร็จ!</div>' +
      '<div class="st-shake-sub">' + esc(a ? a.name : '') + ' ให้ ' + esc(sum(f.give)) + '<br>' + esc(b ? b.name : '') + ' ให้ ' + esc(sum(f.get)) + '</div>';
    center.appendChild(node);
    var tokens = node.querySelectorAll('.st-shake-row .st-token');
    var hands = node.querySelector('.st-shake-hands');
    sfx.fanfare();
    if (f.from === playerId || f.to === playerId) haptic([20, 40, 20]);
    await Promise.all([
      A(tokens[0], [{ transform: 'translateX(-120px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 360 }),
      A(tokens[1], [{ transform: 'translateX(120px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 360 }),
      A(hands, [{ transform: 'scale(0.2) rotate(-20deg)', opacity: 0 }, { transform: 'scale(1.15) rotate(6deg)', opacity: 1, offset: 0.7 }, { transform: 'scale(1) rotate(0deg)', opacity: 1 }], { duration: 520, delay: 180, easing: 'cubic-bezier(0.34,1.56,0.64,1)' })
    ]);
    A(hands, [{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(4px)' }, { transform: 'translateY(0)' }], { duration: 420 });
    burst(centerOf(hands), ['#f5c86b', '#fff3c4', '#3fbf7f'], 18, 110);
    setCash(f.cash);
    if (V) {
      (f.give.props || []).forEach(function(i) { V.props[i] = Object.assign({}, V.props[i], { owner: f.to }); renderCell(i, V); });
      (f.get.props || []).forEach(function(i) { V.props[i] = Object.assign({}, V.props[i], { owner: f.from }); renderCell(i, V); });
    }
    await wait(1100);
    await Promise.all([A(node, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }), scrim(false, 220)]);
  };

  FX.bankrupt = async function(f) {
    var who = seatOf(f.playerId);
    setModal(true);
    scrim(true, 200);
    sfx.jail();
    var creditor = f.creditor ? seatOf(f.creditor) : null;
    var inner = tokenHtml(who) + '<div class="st-banner-kicker">' + esc(creditor ? 'ทรัพย์สินทั้งหมดตกเป็นของ ' + creditor.name : 'ที่ดินคืนธนาคาร') + '</div><div class="st-banner-title">ล้มละลาย!</div><div class="st-banner-sub">' + esc(who ? who.name : '') + '</div>';
    var wrap = fxNode('st-break', '<div class="st-break-half is-l"><div class="st-banner">' + inner + '</div></div><div class="st-break-half is-r"><div class="st-banner">' + inner + '</div></div>' +
      '<svg class="st-break-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="52,0 47,30 55,52 46,75 51,100" fill="none" stroke="#fff7e0" stroke-width="2.2" vector-effect="non-scaling-stroke"/></svg>');
    var halves = wrap.querySelectorAll('.st-break-half');
    var line = wrap.querySelector('.st-break-line');
    if (f.playerId === playerId) haptic([60, 40, 60]);
    await A(wrap, [{ transform: 'translateX(-50%) scale(1.25)', opacity: 0 }, { transform: 'translateX(-50%) scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    await A(wrap, [
      { transform: 'translateX(-50%) translateX(0)' }, { transform: 'translateX(-50%) translateX(-10px) rotate(-1.5deg)' },
      { transform: 'translateX(-50%) translateX(9px) rotate(1.2deg)' }, { transform: 'translateX(-50%) translateX(-5px)' },
      { transform: 'translateX(-50%) translateX(0)' }
    ], { duration: 380 });
    sfx.stamp();
    await A(line, [{ opacity: 0 }, { opacity: 1 }], { duration: 90 });
    await wait(520);
    A(line, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
    await Promise.all([
      A(halves[0], [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(-34px, 160px) rotate(-14deg)', opacity: 0 }], { duration: 640, easing: 'cubic-bezier(0.55, 0, 0.9, 0.4)' }),
      A(halves[1], [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 }, { transform: 'translate(38px, 180px) rotate(16deg)', opacity: 0 }], { duration: 680, easing: 'cubic-bezier(0.55, 0, 0.9, 0.4)' })
    ]);
    if (V) {
      V.out[f.playerId] = true;
      (f.squares || []).forEach(function(i) {
        V.props[i] = creditor ? Object.assign({}, V.props[i], { owner: creditor.playerId, houses: 0 }) : { owner: null, houses: 0, mortgaged: false };
        renderCell(i, V);
      });
      var t = tokenEls[f.playerId];
      if (t) A(t, [{ opacity: 1 }, { opacity: 0, transform: t.style.transform + ' scale(0.2)' }], { duration: 400 });
    }
    setCash(f.cash);
    await scrim(false, 220);
  };

  FX.timeUp = async function() {
    sfx.jail();
    await showBanner({ icon: 'clock', kicker: 'หมดเวลาเกม', title: 'รอบสุดท้าย!', sub: 'เล่นให้ครบรอบนี้ แล้วนับทรัพย์สินหาผู้ชนะ' }, 1000);
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
    renderDock();
    renderLog();
    renderCenter();
    renderClock();
    renderSidebar();
    renderDeskProps();
    if (S.turn && S.turn.lastRoll) setDice(S.turn.lastRoll);
    syncSheets();
    if (S.phase === 'finished' && !running && !endShown) showEnd(false, true);
  }

  function renderStrip() {
    if (!S) return;
    var model = V || modelFrom(S);
    var html = (S.seats || []).map(function(s) {
      var out = isOut(s);
      var badges = '';
      if (s.left) badges += '<span class="st-badge st-badge--off">ออกแล้ว</span>';
      else if (s.bankrupt) badges += '<span class="st-badge st-badge--off">ล้มละลาย</span>';
      else {
        if (s.inJail) badges += '<span class="st-badge st-badge--jail">ติดคุก</span>';
        if (!s.online && !s.isBot) badges += '<span class="st-badge st-badge--off">หลุด</span>';
        if (s.hasOffer) badges += '<span class="st-badge st-badge--deal">เสนอดีล</span>';
      }
      return '<div class="st-chip' + (s.isTurn ? ' is-turn' : '') + (out ? ' is-out' : '') + (s.isSelf ? ' is-self' : '') + '" data-id="' + esc(s.playerId) + '" role="button" tabindex="0" aria-label="' + esc(s.name + ' เงินสด ' + money(model.cash[s.playerId]) + (s.isTurn ? ' กำลังเล่น' : '')) + '">' +
        '<span class="st-chip-token">' + tokenHtml(s) + '</span>' +
        '<span class="st-chip-body"><span class="st-chip-name">' + esc(s.isSelf ? 'คุณ' : s.name) + '</span><span class="st-chip-cash">' + money(out ? 0 : model.cash[s.playerId]) + '</span></span>' +
        (badges ? '<span class="st-chip-badges">' + badges + '</span>' : '') +
        '</div>';
    }).join('');
    el.strip.innerHTML = html;
  }

  function renderCenter() {
    var node = $('#stCenterStatus');
    if (!node || !S) return;
    if (S.phase === 'finished') { node.innerHTML = '<b>จบเกม</b>'; return; }
    var actor = S.phaseActor ? seatOf(S.phaseActor) : null;
    var txt = '';
    if (S.phase === 'auction' && S.auction) txt = 'ประมูล<b> ' + esc(SQ[S.auction.square].name) + '</b>' + (S.auction.high ? ' · ' + money(S.auction.high) : '');
    else if (actor) txt = (actor.playerId === playerId ? '<b>ตาคุณ</b>' : 'ตาของ <b>' + esc(actor.name) + '</b>');
    node.innerHTML = txt;
  }

  function renderClock() {
    if (!S || !S.clock) return;
    var c = S.clock;
    el.clock.classList.toggle('is-final', !!c.timeUp);
    if (c.timeUp) { el.clockTxt.textContent = 'รอบสุดท้าย'; return; }
    if (!c.endsAt) { el.clockTxt.textContent = 'ไม่จำกัด · รอบ ' + (S.round || 1); return; }
    var left = Math.max(0, c.endsAt - nowServer());
    var m = Math.floor(left / 60000);
    var s = Math.floor((left % 60000) / 1000);
    el.clockTxt.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    el.clock.setAttribute('aria-label', 'เวลาเกมเหลือ ' + m + ' นาที ' + s + ' วินาที');
  }

  // แถบเวลาตา (transform: scaleX)
  var timerKey = '';
  var timerTotal = 0;
  var timerAnim = null;
  function syncTimer() {
    if (!S || !S.phaseEndsAt || S.phase === 'finished') {
      if (timerAnim) { timerAnim.cancel(); timerAnim = null; }
      timerKey = '';
      el.timer.querySelector('i').style.transform = 'scaleX(0)';
      return;
    }
    var key = S.phaseSeq + ':' + S.phaseEndsAt;
    if (key === timerKey) return;
    var remain = Math.max(0, S.phaseEndsAt - nowServer());
    if (!timerKey || timerKey.split(':')[0] !== String(S.phaseSeq) || remain > timerTotal) timerTotal = Math.max(remain, 1000);
    timerKey = key;
    var bar = el.timer.querySelector('i');
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
  function btn(id, label, opts) {
    opts = opts || {};
    return '<button type="button" class="st-btn' + (opts.primary ? ' st-btn--primary' + (opts.pulse ? ' is-pulse' : '') : '') + (opts.danger ? ' st-btn--danger' : '') + '" id="' + id + '"' + (opts.disabled ? ' disabled' : '') + (opts.aria ? ' aria-label="' + esc(opts.aria) + '"' : '') + '>' +
      (opts.icon ? '<span class="st-btn-ico">' + iconHtml(opts.icon) + '</span>' : '') +
      '<span class="st-btn-label">' + label + '</span></button>';
  }
  function rollBtn(disabled, hint) {
    return '<button type="button" class="st-roll' + (disabled ? '' : ' is-ready') + '" id="stRollBtn"' + (disabled ? ' disabled' : '') +
      ' aria-label="ทอยเต๋า — กดค้างเพื่อชาร์จแรง ปล่อยในช่องเขียวลุ้นดับเบิล (แตะ = ทอยปกติ)"><span class="st-roll-face" aria-hidden="true">🎲</span><span class="st-roll-txt">ทอย</span><small>' + esc(hint) + '</small></button>';
  }
  function renderDock() {
    if (hold) { syncTimer(); return; } // กำลังกดค้าง อย่าสร้างปุ่มใหม่ใต้นิ้ว
    if (!S || !S.mode) { el.dock.innerHTML = '<div class="st-status"><div class="st-status-text"><div class="st-status-title">กำลังโหลด...</div></div></div>'; return; }
    var me = meSeat();
    var a = S.availableActions || {};
    var actor = S.phaseActor ? seatOf(S.phaseActor) : null;
    var myAction = !!(me && S.phaseActor === playerId && !isOut(me));
    var busy = running || pending;
    var title = '';
    var sub = '';
    var token = actor || (S.turn ? seatOf(S.turn.playerId) : null);
    var actions = '';
    var extra = '';
    var wide = false;
    var propsBtn = btn('stPropsBtn', 'ทรัพย์สิน', { icon: 'house' });
    var tradeBtn = btn('stTradeBtn', 'เทรด', { icon: 'handshake', disabled: !a.trade || !me || isOut(me) });

    if (S.phase === 'finished') {
      title = 'จบเกม!';
      sub = S.finishReason || '';
      token = S.winners && S.winners[0] ? seatOf(S.winners[0].playerId) : null;
      actions = btn('stShowEnd', 'ดูผลสรุป', { primary: true }) + btn('stBackBtn', 'กลับห้องรอ');
      wide = true;
    } else if (!me || isOut(me)) {
      title = me && me.bankrupt ? 'คุณล้มละลายแล้ว' : 'กำลังดูเกม';
      sub = actor ? 'ตาของ ' + actor.name + ' · ดูเกมต่อได้จนจบ' : 'ดูเกมต่อได้จนจบ';
      actions = '';
    } else if (S.phase === 'auction' && S.auction) {
      var aq = SQ[S.auction.square];
      var leader = S.auction.leader ? seatOf(S.auction.leader) : null;
      title = 'ประมูล ' + aq.name;
      sub = leader ? 'สูงสุด ' + money(S.auction.high) + ' โดย ' + (leader.playerId === playerId ? 'คุณ' : leader.name) : 'ยังไม่มีใครเสนอ · ราคาตั้ง ' + money(aq.price);
      token = leader;
      actions = btn('stOpenAuction', a.bid && a.bid.leading ? 'คุณนำอยู่ · ดูประมูล' : 'เสนอราคา', { primary: true, pulse: !(a.bid && a.bid.leading), icon: 'gavel' });
      wide = true;
      actions = propsBtn + actions;
    } else if (myAction && S.phase === 'roll') {
      if (me.inJail) {
        title = 'คุณติดคุก (' + (me.jailTurns + 1) + '/3)';
        sub = 'ทอยให้ได้ดับเบิลเพื่อออก · หรือจ่าย ' + money(BOARD.jailFine) + (me.jailCards ? ' / ใช้บัตรอภัยโทษ' : '');
        actions = (a.useJailCard ? btn('stJailCardBtn', 'ใช้บัตร', { icon: 'key' }) : btn('stPayJailBtn', 'จ่าย ' + money(BOARD.jailFine), { disabled: !a.payJail || busy })) +
          rollBtn(busy, 'ลุ้นดับเบิล') +
          (a.useJailCard ? btn('stPayJailBtn', 'จ่าย ' + money(BOARD.jailFine), { disabled: !a.payJail || busy }) : propsBtn);
      } else {
        title = S.turn && S.turn.canRollAgain ? 'ดับเบิล! ทอยอีกครั้ง' : 'ตาคุณ! ทอยเต๋าเลย';
        sub = 'กดค้างให้เข็มแกว่ง ปล่อยตอนแรง = เดินไกล · ถ้าช่องเขียวโผล่ ปล่อยในช่อง = ลุ้นดับเบิล';
        actions = propsBtn + rollBtn(busy, 'กดค้าง') + tradeBtn;
      }
    } else if (myAction && S.phase === 'buy') {
      var bq = SQ[S.pendingBuy];
      var g = groupOf(S.pendingBuy);
      title = 'ซื้อ' + bq.name + 'ไหม?';
      sub = a.buy ? 'ไม่ซื้อ = เปิดประมูลให้ทุกคน (รวมคุณ)' : 'เงินสดไม่พอ — จำนองที่ดินในทรัพย์สิน หรือส่งประมูล';
      extra = '<div class="st-mini-deed" data-deed="' + S.pendingBuy + '"><span class="st-mini-deed-band" style="--band:' + (g ? g.color : bandOf(S.pendingBuy)) + '"></span><span class="st-mini-deed-icon"><img src="' + LAND_BASE + bq.art + '.svg" alt="" width="48" height="48"></span><span class="st-mini-deed-txt"><b>' + esc(bq.name) + '</b><span>' + (g ? 'สี' + g.name + ' · ' : '') + 'ค่าเช่าเริ่ม ' + (bq.rent ? money(bq.rent[0]) : bq.type === 'transport' ? money(BOARD.transportRent[0]) : 'เต๋า × ' + BOARD.utilityMult[0]) + ' · แตะดูโฉนด</span></span></div>';
      actions = btn('stDeclineBtn', 'ประมูล', { icon: 'gavel', disabled: busy }) + btn('stBuyBtn', 'ซื้อ ' + money(bq.price), { primary: true, pulse: !!a.buy, disabled: !a.buy || busy }) + propsBtn;
    } else if (myAction && S.phase === 'manage') {
      title = 'จะทำอะไรต่อ?';
      sub = 'สร้างบ้าน จำนอง เทรด — หรือจบเทิร์น';
      actions = propsBtn + btn('stEndTurnBtn', 'จบเทิร์น', { primary: true, pulse: true, disabled: busy }) + tradeBtn;
    } else if (myAction && S.phase === 'debt' && S.debt) {
      var short = S.debt.total - me.cash;
      title = 'ต้องจ่าย ' + money(S.debt.total) + ' (ขาด ' + money(short) + ')';
      sub = S.debt.reason + ' · ขายบ้าน/จำนองให้พอ แล้วจ่ายให้อัตโนมัติ';
      actions = btn('stDebtBtn', 'ขายบ้าน / จำนอง', { primary: true, pulse: true }) + tradeBtn;
      wide = true;
    } else {
      title = actor ? 'ตาของ ' + actor.name : 'รอสักครู่';
      if (S.phase === 'roll') sub = S.turn && S.turn.holding ? 'กำลังชาร์จแรงทอย…' : (actor && actor.inJail ? 'ติดคุก กำลังลุ้นดับเบิล' : 'กำลังทอยเต๋า');
      else if (S.phase === 'buy') sub = 'กำลังตัดสินใจซื้อ ' + (SQ[S.pendingBuy] ? SQ[S.pendingBuy].name : '');
      else if (S.phase === 'manage') sub = 'กำลังจัดการทรัพย์สิน';
      else if (S.phase === 'debt' && S.debt) sub = 'กำลังหาเงินจ่ายหนี้ ' + money(S.debt.total);
      actions = propsBtn + tradeBtn;
      wide = true;
    }

    // ดีลที่เกี่ยวกับเรา
    var deals = '';
    (S.trades || []).forEach(function(t) {
      if (t.from === playerId) deals += '<div class="st-dock-deal"><span>รอ ' + esc(nameOf(t.to)) + ' ตอบข้อเสนอ…</span>' + btn('stCancelDeal', 'ยกเลิก') + '</div>';
      if (t.to === playerId) deals += '<div class="st-dock-deal"><span>ข้อเสนอจาก ' + esc(nameOf(t.from)) + '</span>' + btn('stViewDeal' + t.id, 'ดูดีล', { primary: true }) + '</div>';
    });

    var sec = secondsLeft();
    el.dock.innerHTML =
      '<div class="st-status">' + (token ? '<span class="st-status-token">' + tokenHtml(token) + '</span>' : '') +
      '<div class="st-status-text"><div class="st-status-title">' + esc(title) + '</div>' + (sub ? '<div class="st-status-sub">' + esc(sub) + '</div>' : '') + '</div>' +
      (sec !== null && S.phase !== 'finished' ? '<div class="st-status-sec" id="stSec">' + sec + '</div>' : '') + '</div>' +
      extra + deals +
      (actions ? '<div class="st-actions' + (wide ? ' is-wide' : '') + '">' + actions + '</div>' : '');
    syncTimer();
    var h = document.getElementById('stDock').offsetHeight;
    if (window.innerWidth < 1000) root.style.setProperty('--st-dock-h', h + 'px');
  }

  function renderLog() {
    if (!S) return;
    el.log.innerHTML = (S.history || []).map(function(h) {
      return '<div class="st-log-item"><i>' + esc(h.icon || '•') + '</i><span>' + esc(h.text) + '</span></div>';
    }).join('');
  }

  function renderSidebar() {
    var list = $('#onlinePlayerList');
    if (!list || !S) return;
    list.innerHTML = (S.seats || []).map(function(s) {
      return '<li style="display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid oklch(1 0 0 / 0.08); min-width:0;">' + tokenHtml(s) +
        '<span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto;">' + esc(s.name) + '</span>' +
        '<span style="font-family:var(--st-display); color:var(--st-gold); white-space:nowrap;">' + money(isOut(s) ? 0 : s.netWorth) + '</span></li>';
    }).join('') + '<li style="padding-top:8px; font-size:0.78rem; color:var(--st-muted);">ตัวเลข = ทรัพย์สินรวม (เงินสด + ที่ดิน + บ้าน)</li>';
  }

  // ---------- ทรัพย์สิน ----------
  function myProps(id) {
    var out = [];
    Object.keys(S.props || {}).forEach(function(k) { if (S.props[k].owner === id) out.push(Number(k)); });
    return out.sort(function(x, y) { return x - y; });
  }
  function propsHtml(forDesk) {
    var me = meSeat();
    if (!me) return '<div class="st-empty">คุณไม่ได้อยู่ในเกมนี้</div>';
    var manage = (S.self && S.self.manage) || null;
    var mine = myProps(playerId);
    var head = forDesk ? '' : '<div class="st-prop-summary"><div><b>' + money(me.cash) + '</b><span>เงินสด</span></div><div><b>' + money(me.netWorth) + '</b><span>ทรัพย์สินรวม</span></div><div><b>' + mine.length + '</b><span>แปลง</span></div></div>';
    if (!mine.length) return head + '<div class="st-empty">ยังไม่มีที่ดิน — ตกช่องที่ว่างแล้วกดซื้อ หรือชนะประมูล</div>' + (me.jailCards ? '<div class="st-note">บัตรอภัยโทษ ' + me.jailCards + ' ใบ</div>' : '');
    var byGroup = {};
    mine.forEach(function(i) { var key = SQ[i].group || SQ[i].type; (byGroup[key] = byGroup[key] || []).push(i); });
    var order = Object.keys(GROUPS).concat(['transport', 'utility']);
    var html = head;
    order.forEach(function(key) {
      var list = byGroup[key];
      if (!list) return;
      var g = GROUPS[key];
      var total = g ? (BOARD.groupSquares[key] || []).length : (key === 'transport' ? 4 : 2);
      html += '<div class="st-group" style="--band:' + (g ? g.color : bandOf(list[0])) + '"><i></i>' + (g ? 'สี' + esc(g.name) + ' · ' + esc(g.region) : (key === 'transport' ? 'การเดินทาง' : 'สาธารณูปโภค')) + '<em>' + list.length + '/' + total + (list.length === total && g ? ' ครบชุด!' : '') + '</em></div>';
      list.forEach(function(i) {
        var p = S.props[i];
        var opt = manage && manage[i] ? manage[i] : {};
        var btns = '';
        if (manage) {
          if (SQ[i].type === 'property') {
            btns += '<button type="button" class="st-mini-btn st-mini-btn--build" data-act="build" data-sq="' + i + '"' + (opt.build ? '' : ' disabled') + '>' + (p.houses === 4 ? '+โรงแรม' : '+บ้าน') + '<small>' + (opt.build ? money(opt.build) : '—') + '</small></button>';
            if (p.houses > 0) btns += '<button type="button" class="st-mini-btn st-mini-btn--sell" data-act="sell" data-sq="' + i + '"' + (opt.sell ? '' : ' disabled') + '>ขาย<small>' + (opt.sell ? '+' + money(opt.sell) : '—') + '</small></button>';
          }
          if (p.mortgaged) btns += '<button type="button" class="st-mini-btn" data-act="unmortgage" data-sq="' + i + '"' + (opt.unmortgage ? '' : ' disabled') + '>ไถ่ถอน<small>' + (opt.unmortgage ? money(opt.unmortgage) : '—') + '</small></button>';
          else if (!p.houses) btns += '<button type="button" class="st-mini-btn" data-act="mortgage" data-sq="' + i + '"' + (opt.mortgage ? '' : ' disabled') + '>จำนอง<small>' + (opt.mortgage ? '+' + money(opt.mortgage) : '—') + '</small></button>';
        }
        html += '<div class="st-prop" style="--band:' + (g ? g.color : bandOf(i)) + '"><span class="st-prop-band"></span>' +
          '<div class="st-prop-main" data-deed="' + i + '"><div class="st-prop-name">' + esc(SQ[i].name) + '</div><div class="st-prop-meta">' +
          (p.mortgaged ? '<span>จำนองอยู่</span>' : '<span>ค่าเช่า ' + rentText(i) + '</span>') +
          (p.houses ? '<span class="st-cell-houses">' + housesHtml(p.houses) + '</span>' : '') + '</div></div>' +
          '<div class="st-prop-btns">' + btns + '</div></div>';
      });
    });
    if (me.jailCards) html += '<div class="st-note">🗝️ บัตรอภัยโทษ ' + me.jailCards + ' ใบ (ใช้ตอนติดคุก หรือแลกในเทรด)</div>';
    if (!manage && !forDesk) html += '<div class="st-note" style="margin-top:8px;">สร้างบ้าน/จำนองได้ตอนถึงตาคุณ (หรือตอนต้องหาเงินจ่ายหนี้)</div>';
    return html;
  }
  function rentText(i) {
    var sq = SQ[i];
    var p = S.props[i];
    if (sq.type === 'property') {
      if (p.houses) return money(sq.rent[p.houses]);
      var full = (BOARD.groupSquares[sq.group] || []).every(function(k) { return S.props[k].owner === p.owner; });
      return money(sq.rent[0] * (full ? 2 : 1));
    }
    if (sq.type === 'transport') {
      var n = BOARD.groupSquares ? Object.keys(S.props).filter(function(k) { return SQ[k].type === 'transport' && S.props[k].owner === p.owner; }).length : 1;
      return money(BOARD.transportRent[Math.max(0, n - 1)]);
    }
    var u = Object.keys(S.props).filter(function(k) { return SQ[k].type === 'utility' && S.props[k].owner === p.owner; }).length;
    return 'เต๋า × ' + BOARD.utilityMult[Math.max(0, u - 1)];
  }
  function renderDeskProps() {
    if (!el.deskProps || window.innerWidth < 1000 || !S) return;
    el.deskProps.innerHTML = propsHtml(true);
  }

  // ---------- ชีต ----------
  var sheetKind = null;
  var sheetArg = null;
  var lastFocus = null;
  function openSheet(kind, arg) {
    sheetKind = kind;
    sheetArg = arg;
    if (!el.sheet.classList.contains('is-open')) lastFocus = document.activeElement;
    buildSheet();
    el.sheet.classList.add('is-open');
    var close = el.sheetCard.querySelector('.st-sheet-close');
    if (close) setTimeout(function() { try { close.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
    if (kind !== 'auction') el.pill.classList.remove('is-on');
  }
  function closeSheet() {
    var was = sheetKind;
    sheetKind = null;
    el.sheet.classList.remove('is-open');
    if (was === 'auction' && S && S.phase === 'auction') auctionMinimized = true;
    syncAuctionPill();
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeSheetIf(kind) { if (sheetKind === kind) closeSheet(); }
  function sheetHead(title) {
    return '<div class="st-sheet-grab"></div><div class="st-sheet-head"><h3 id="stSheetTitle">' + esc(title) + '</h3><button type="button" class="st-sheet-close" data-close="1" aria-label="ปิด">✕</button></div>';
  }
  function buildSheet() {
    if (!sheetKind || !S) return;
    var html = '';
    if (sheetKind === 'deed') {
      var i = sheetArg;
      var sq = SQ[i];
      if (ownable(i)) html = sheetHead('โฉนด') + deedHtml(i);
      else html = sheetHead(sq.name) + infoHtml(i);
    } else if (sheetKind === 'props') {
      html = sheetHead(S.phase === 'debt' && S.phaseActor === playerId ? 'หาเงินจ่ายหนี้' : 'ทรัพย์สินของฉัน') + propsHtml(false);
      if (S.phase === 'debt' && S.phaseActor === playerId && S.debt) html = html.replace('<div class="st-prop-summary">', '<div class="st-note" style="margin-bottom:8px;">ต้องจ่าย <b>' + money(S.debt.total) + '</b> · มีเงินสด <b>' + money(meSeat().cash) + '</b> — ขายบ้านหรือจำนองจนพอ ระบบจ่ายให้เอง</div><div class="st-prop-summary">');
    } else if (sheetKind === 'auction') {
      html = auctionHtml();
    } else if (sheetKind === 'trade') {
      html = tradeHtml();
    } else if (sheetKind === 'offer') {
      html = offerHtml(sheetArg);
    } else if (sheetKind === 'howto') {
      html = sheetHead('เศรษฐี เล่นยังไง') + guideHtml();
    }
    if (!html) { closeSheet(); return; }
    var scroll = el.sheetCard.scrollTop;
    el.sheetCard.innerHTML = html;
    el.sheetCard.scrollTop = scroll;
    if (sheetKind === 'auction') syncAuctionBar();
  }
  function syncSheets() {
    if (!sheetKind) { maybeAutoOpen(); syncAuctionPill(); return; }
    if (sheetKind === 'trade') return; // ห้ามล้างฟอร์มที่กำลังกรอก
    if (sheetKind === 'auction' && (!S.auction || S.phase !== 'auction')) { closeSheet(); return; }
    if (sheetKind === 'offer' && !(S.trades || []).some(function(t) { return t.id === sheetArg; })) { closeSheet(); return; }
    if (sheetKind === 'auction') { updateAuctionSheet(); return; }
    buildSheet();
    maybeAutoOpen();
  }
  var seenOffers = {};
  var auctionMinimized = false;
  var lastAuctionId = null;
  function maybeAutoOpen() {
    if (!S || running) return;
    if (S.phase === 'auction' && S.auction) {
      if (lastAuctionId !== S.auction.id) { lastAuctionId = S.auction.id; auctionMinimized = false; }
      var me = meSeat();
      if (!auctionMinimized && me && !isOut(me) && sheetKind !== 'auction' && (!sheetKind || sheetKind === 'deed' || sheetKind === 'props')) openSheet('auction');
    }
    (S.trades || []).forEach(function(t) {
      if (t.to === playerId && !seenOffers[t.id]) {
        seenOffers[t.id] = true;
        if (!sheetKind) openSheet('offer', t.id);
        else toast('มีข้อเสนอเทรดจาก ' + nameOf(t.from) + ' — ดูได้ที่แผงล่าง', 2600);
      }
    });
  }
  function syncAuctionPill() {
    var on = !!(S && S.phase === 'auction' && S.auction && sheetKind !== 'auction' && !running);
    el.pill.classList.toggle('is-on', on);
    if (on) {
      var leader = S.auction.leader ? seatOf(S.auction.leader) : null;
      el.pill.textContent = '🔨 ประมูล ' + SQ[S.auction.square].name + ' · ' + (leader ? money(S.auction.high) : 'ยังไม่มีคนเสนอ') + ' · แตะเพื่อเสนอ';
    }
  }

  function infoHtml(i) {
    var sq = SQ[i];
    var t = {
      go: 'จุดเริ่มต้น — เดินผ่านหรือหยุดที่นี่ได้เงินเดือน ' + money(BOARD.salary),
      jail: 'เยี่ยมคุก: แค่เดินผ่าน ไม่เป็นอะไร · ติดคุก: ทอยหาดับเบิล (สูงสุด 3 ตา) จ่าย ' + money(BOARD.jailFine) + ' หรือใช้บัตรอภัยโทษเพื่อออก',
      parking: 'จอดพักฟรี ไม่มีอะไรเกิดขึ้น',
      gotojail: 'ตกช่องนี้ = ไปคุกทันที ไม่ผ่านจุดเริ่ม ไม่ได้เงินเดือน',
      chance: 'เปิดการ์ดโอกาส: ส่วนใหญ่พาเดินไปที่อื่น บางใบได้เงิน บางใบเสียเงิน',
      fortune: 'เปิดการ์ดดวงชะตา: ส่วนใหญ่เป็นเรื่องเงิน ได้บ้าง เสียบ้าง',
      tax: 'จ่ายภาษีให้ธนาคาร ' + money(sq.amount)
    }[sq.type] || '';
    return '<div class="st-deed" style="--band:var(--st-navy-3)"><div class="st-deed-head"><b class="st-deed-name">' + esc(sq.name) + '</b></div>' + landHtml(i) + '<div<div class="st-deed-foot" style="font-size:0.9rem; color:var(--st-ink);">' + esc(t) + '</div></div>';
  }

  function guideHtml() {
    return '<div class="st-guide">' +
      '<h4>เป้าหมาย</h4><p>ซื้อที่ดินทั่วไทย เก็บค่าเช่า ทำให้คนอื่นล้มละลาย — หรือมีทรัพย์สินรวมมากสุดตอนหมดเวลา</p>' +
      '<h4>ตาของคุณ</h4><p>ทอยเต๋า 2 ลูก เดินตามแต้ม · ผ่านจุดเริ่มรับ ' + money(BOARD.salary) + ' · ดับเบิลได้ทอยอีก แต่ดับเบิล 3 ครั้งติด = เข้าคุก</p>' +
      '<h4>กดค้างทอย</h4><p>กดปุ่มทอยค้างไว้ เข็มจะแกว่งขึ้นลง · ปล่อยตอนเข็มไปทางแรง = แต้มรวมมักสูงขึ้น (สุดเฉลี่ยราว +2) · บางครั้งช่องเขียวจะโผล่ขึ้นมาสั้น ๆ ปล่อยในช่องตอนที่มันโผล่ = โอกาสดับเบิลราว 1 ใน 3 · แตะเฉย ๆ = ทอยปกติ · ระวังโลภ ดับเบิล 3 ครั้งติดเข้าคุก!</p>' +
      '<h4>ตกที่ว่าง</h4><p>ซื้อตามราคา หรือไม่ซื้อ → เปิดประมูลให้ทุกคน (ปุ่ม +10/+50/+100 หรือใส่เอง · นับถอยหลังเริ่มใหม่ทุกครั้งที่มีคนเสนอ)</p>' +
      '<h4>ตกที่ของคนอื่น</h4><p>จ่ายค่าเช่า · ครบชุดสี = ค่าเช่า 2 เท่า · ขนส่งยิ่งมีหลายแห่งยิ่งแพง · ไฟฟ้า/ประปา = แต้มเต๋า × 4 (มีครบ × 10) · ที่จำนองไม่เก็บค่าเช่า</p>' +
      '<h4>สร้างบ้าน</h4><p>ครบชุดสีแล้วสร้างบ้านได้ ต้องสร้างให้เท่ากันทั้งชุด · บ้าน 4 หลังแล้วอัปเป็นโรงแรม · ขายคืนได้ครึ่งราคา</p>' +
      '<h4>จำนอง</h4><p>จำนองได้ครึ่งราคา (ต้องขายบ้านในชุดก่อน) · ไถ่ถอน = ยอดจำนอง + 10%</p>' +
      '<h4>เทรด</h4><p>แลกที่ดิน (ที่ไม่มีบ้าน) เงิน และบัตรอภัยโทษกับใครก็ได้ · อีกฝ่ายรับ ปฏิเสธ หรือโต้กลับได้ · ส่งข้อเสนอได้ทีละอัน</p>' +
      '<h4>คุก</h4><p>ทอยหาดับเบิล (3 ตา) · จ่าย ' + money(BOARD.jailFine) + ' · หรือใช้บัตรอภัยโทษ · ครบ 3 ตาต้องจ่ายแล้วเดิน</p>' +
      '<h4>เงินไม่พอ</h4><p>ขายบ้าน/จำนองจนพอจ่าย · ขายหมดยังไม่พอ = ล้มละลาย ทรัพย์สินไปที่เจ้าหนี้ (ถ้าเป็นธนาคาร ที่ดินกลับเป็นของว่าง)</p>' +
      '<h4>เวลา</h4><p>' + (S && S.clock && S.clock.endsAt ? 'ห้องนี้เล่น ' + S.clock.minutes + ' นาที · หมดเวลาแล้วเล่นให้ครบรอบ นับเงินสด + ที่ดิน (จำนองนับครึ่ง) + บ้านตามทุน สูงสุดชนะ เท่ากันชนะร่วม' : 'ห้องนี้ไม่จำกัดเวลา — เล่นจนเหลือคนสุดท้าย') + '</p>' +
      '<h4>หมดเวลาตา</h4><p>ตาละ ~30 วิ · ไม่กด = ระบบเล่นแบบปลอดภัยให้ (ทอย · ไม่ซื้อ · จบเทิร์น)</p>' +
      '<p style="margin-top:12px; color:var(--st-muted);">เงินในเกมเป็นเงินสมมติ ไม่มีมูลค่าจริง และไม่เกี่ยวกับกระเป๋าเงินของเว็บ</p>' +
      '</div>';
  }

  // ประมูล
  function auctionHtml() {
    var a = S.auction;
    if (!a) return '';
    var av = S.availableActions || {};
    var bid = av.bid || { min: 10, max: 0, can: false };
    var leader = a.leader ? seatOf(a.leader) : null;
    var price = SQ[a.square].price;
    var quick = [10, 50, 100].map(function(step) {
      var amount = a.high ? a.high + step : Math.max(step, 10);
      if (!a.high && step === 10) amount = 10;
      return '<button type="button" class="st-btn" data-bid="' + amount + '"' + (bid.can && amount <= bid.max && amount >= bid.min ? '' : ' disabled') + '>+' + step + '<small>' + money(amount) + '</small></button>';
    }).join('');
    return sheetHead('ประมูล') +
      '<div class="st-auction">' +
      '<div class="st-auction-top">' + deedHtml(a.square, { compact: true, owner: false }) +
      '<div class="st-auction-ring"><b id="stAuctionSec">' + (secondsLeft() || 0) + '</b></div></div>' +
      '<div class="st-timer" id="stAuctionBar" style="border-radius:2px;"><i></i></div>' +
      '<div class="st-auction-high">' + (leader ? tokenHtml(leader) : tokenHtml(null)) + '<div><span>' + (leader ? 'สูงสุดตอนนี้ · ' + esc(leader.playerId === playerId ? 'คุณ' : leader.name) : 'ยังไม่มีใครเสนอ · ราคาตั้ง ' + money(price)) + '</span><strong>' + money(a.high) + '</strong></div></div>' +
      (bid.leading ? '<div class="st-note">คุณเสนอสูงสุดอยู่ — รอดูว่าจะมีใครสู้ไหม</div>' : '') +
      '<div class="st-bid-row">' + quick + '</div>' +
      '<div class="st-bid-custom"><input type="number" inputmode="numeric" id="stBidInput" min="' + bid.min + '" max="' + bid.max + '" step="10" value="' + Math.min(bid.max, Math.max(bid.min, a.high ? a.high + 20 : Math.round(price * 0.5 / 10) * 10)) + '" aria-label="ใส่ราคาเอง"' + (bid.can ? '' : ' disabled') + '>' +
      '<button type="button" class="st-btn st-btn--primary" id="stBidCustom"' + (bid.can ? '' : ' disabled') + '>เสนอ</button></div>' +
      '<div class="st-note">เงินสดคุณ ' + money(bid.max) + ' · ขั้นต่ำ ' + money(bid.min) + ' · นับถอยหลังเริ่มใหม่ทุกครั้งที่มีคนเสนอ · ไม่มีใครเสนอ = ยังเป็นของธนาคาร</div>' +
      (a.bids && a.bids.length ? '<div class="st-bids">' + a.bids.slice().reverse().map(function(b) { return '<span>' + esc(nameOf(b.playerId)) + ' ' + money(b.amount) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';
  }
  function updateAuctionSheet() {
    // วาดใหม่แต่คงค่าที่พิมพ์ไว้
    var input = document.getElementById('stBidInput');
    var typed = input && document.activeElement === input ? input.value : null;
    buildSheet();
    if (typed !== null) { var n = document.getElementById('stBidInput'); if (n) { n.value = typed; n.focus(); } }
  }
  var auctionBarAnim = null;
  function syncAuctionBar() {
    var bar = document.querySelector('#stAuctionBar i');
    if (!bar || !S || !S.auction) return;
    var remain = Math.max(0, S.auction.endsAt - nowServer());
    var total = 8000;
    if (auctionBarAnim) auctionBarAnim.cancel();
    bar.style.transform = 'scaleX(0)';
    auctionBarAnim = bar.animate([{ transform: 'scaleX(' + Math.min(1, remain / total) + ')' }, { transform: 'scaleX(0)' }], { duration: Math.max(1, remain), easing: 'linear' });
  }

  // เทรด
  var draft = null;
  function newDraft(to) {
    return { to: to || null, give: { cash: 0, props: [], jailCards: 0 }, get: { cash: 0, props: [], jailCards: 0 }, counterOf: null };
  }
  function tradeable(i) {
    var sq = SQ[i];
    if (sq.type !== 'property') return true;
    return (BOARD.groupSquares[sq.group] || []).every(function(k) { return !S.props[k].houses; });
  }
  function pickHtml(i, side) {
    var sq = SQ[i];
    var g = groupOf(i);
    var on = draft[side].props.indexOf(i) >= 0;
    var ok = tradeable(i);
    var p = S.props[i];
    return '<button type="button" class="st-pick" data-side="' + side + '" data-sq="' + i + '" aria-pressed="' + on + '"' + (ok ? '' : ' disabled') + ' style="--band:' + (g ? g.color : bandOf(i)) + '"><i></i><span>' + esc(sq.short || sq.name) + '<small>' + (ok ? money(sq.price) + (p.mortgaged ? ' · จำนอง' : '') : 'มีบ้านในชุด') + '</small></span></button>';
  }
  function tradeHtml() {
    var me = meSeat();
    if (!me || isOut(me)) return sheetHead('เทรด') + '<div class="st-empty">คุณไม่ได้อยู่ในเกมแล้ว</div>';
    var others = (S.seats || []).filter(function(s) { return !s.isSelf && !isOut(s); });
    if (!draft) draft = newDraft();
    if (!draft.to || !others.some(function(s) { return s.playerId === draft.to; })) {
      draft = Object.assign(newDraft(others[0] ? others[0].playerId : null), { counterOf: draft.counterOf });
    }
    var who = '<div class="st-trade-who" role="group" aria-label="เลือกคนที่จะเทรดด้วย">' + others.map(function(s) {
      return '<button type="button" data-to="' + esc(s.playerId) + '" aria-pressed="' + (draft.to === s.playerId) + '">' + tokenHtml(s) + '<span>' + esc(s.name) + '</span></button>';
    }).join('') + '</div>';
    if (!draft.to) return sheetHead('เทรด') + '<div class="st-empty">ไม่มีใครให้เทรดด้วย</div>';
    var them = seatOf(draft.to);
    var mine = myProps(playerId);
    var theirs = myProps(draft.to);
    var col = function(side, title, seat, props, owner) {
      return '<div class="st-trade-col is-' + side + '"><h4>' + (side === 'give' ? '↑' : '↓') + ' <span>' + esc(title) + '</span></h4>' +
        '<div class="st-cash-input"><button type="button" data-cash="' + side + '" data-d="-50" aria-label="ลด 50">−</button><input type="number" inputmode="numeric" min="0" step="10" max="' + seat.cash + '" data-cashinput="' + side + '" value="' + draft[side].cash + '" aria-label="เงินที่' + (side === 'give' ? 'คุณให้' : 'คุณได้') + '"><button type="button" data-cash="' + side + '" data-d="50" aria-label="เพิ่ม 50">+</button></div>' +
        '<div class="st-note" style="text-align:center;">มีเงินสด ' + money(seat.cash) + '</div>' +
        (props.length ? props.map(function(i) { return pickHtml(i, side); }).join('') : '<div class="st-note" style="text-align:center;">ไม่มีที่ดิน</div>') +
        (seat.jailCards ? '<button type="button" class="st-pick" data-jail="' + side + '" aria-pressed="' + (draft[side].jailCards > 0) + '" style="--band:var(--st-gold)"><i></i><span>บัตรอภัยโทษ<small>มี ' + seat.jailCards + ' ใบ</small></span></button>' : '') +
        '</div>';
      void owner;
    };
    var summary = tradeSummary(draft, them);
    var mineOpen = (S.trades || []).some(function(t) { return t.from === playerId; });
    return sheetHead(draft.counterOf ? 'โต้กลับข้อเสนอ' : 'ยื่นข้อเสนอเทรด') + who +
      '<div class="st-trade-grid">' + col('give', 'คุณให้', me, mine, playerId) + col('get', 'คุณได้จาก ' + them.name, them, theirs, draft.to) + '</div>' +
      '<div class="st-trade-sum">' + summary + '</div>' +
      (mineOpen ? '<div class="st-note" style="margin-top:8px;">คุณมีข้อเสนอค้างอยู่ — ยกเลิกก่อนถึงส่งใหม่ได้</div>' : '') +
      '<div class="st-sheet-foot">' + btn('stTradeClose', 'ยกเลิก') + btn('stTradeSend', draft.counterOf ? 'ส่งข้อเสนอโต้กลับ' : 'ส่งข้อเสนอ', { primary: true, disabled: mineOpen && !draft.counterOf }) + '</div>';
  }
  function tradeSummary(d, them) {
    var side = function(s) {
      var parts = s.props.map(function(i) { return SQ[i].short || SQ[i].name; });
      if (s.cash) parts.push(money(s.cash));
      if (s.jailCards) parts.push('บัตรอภัยโทษ');
      return parts.join(' + ') || '—';
    };
    return 'คุณให้ <b>' + esc(side(d.give)) + '</b><br>คุณได้ <b>' + esc(side(d.get)) + '</b> จาก ' + esc(them ? them.name : '');
  }
  function offerHtml(id) {
    var t = (S.trades || []).find(function(x) { return x.id === id; });
    if (!t) return '';
    var from = seatOf(t.from);
    var list = function(side) {
      var out = side.props.map(function(i) {
        var g = groupOf(i);
        return '<div class="st-pick" style="--band:' + (g ? g.color : bandOf(i)) + '; cursor:default;"><i></i><span>' + esc(SQ[i].name) + '<small>' + money(SQ[i].price) + (S.props[i].mortgaged ? ' · จำนอง' : '') + '</small></span></div>';
      }).join('');
      if (side.cash) out += '<div class="st-pick" style="--band:var(--st-gold); cursor:default;"><i></i><span>เงินสด<small>' + money(side.cash) + '</small></span></div>';
      if (side.jailCards) out += '<div class="st-pick" style="--band:var(--st-gold); cursor:default;"><i></i><span>บัตรอภัยโทษ<small>' + side.jailCards + ' ใบ</small></span></div>';
      return out || '<div class="st-note" style="text-align:center;">ไม่มี</div>';
    };
    var remain = Math.max(0, t.expiresAt - nowServer());
    return sheetHead('ข้อเสนอจาก ' + (from ? from.name : '')) +
      '<div class="st-offer-timer"><i style="transform:scaleX(' + Math.min(1, remain / 45000) + ')"></i></div>' +
      '<div class="st-trade-grid">' +
      '<div class="st-trade-col is-give"><h4>↑ <span>คุณให้</span></h4>' + list(t.get) + '</div>' +
      '<div class="st-trade-col is-get"><h4>↓ <span>คุณได้</span></h4>' + list(t.give) + '</div>' +
      '</div>' +
      (S.phase === 'auction' ? '<div class="st-note" style="margin-top:8px;">กำลังประมูลอยู่ — กดรับได้หลังประมูลจบ</div>' : '') +
      '<div class="st-sheet-foot">' + btn('stOfferReject', 'ปฏิเสธ') + btn('stOfferCounter', 'โต้กลับ') + btn('stOfferAccept', 'ยอมรับ', { primary: true, disabled: S.phase === 'auction' }) + '</div>';
  }

  // ---------- กดค้างทอย (มินิเกมเข็มแรง) ----------
  var hold = null;
  var meterEl = null;
  function meterNode() {
    if (meterEl) return meterEl;
    meterEl = document.createElement('div');
    meterEl.className = 'st-meter';
    meterEl.id = 'stMeter';
    meterEl.setAttribute('aria-hidden', 'true');
    var arc = 'M20 120 A100 100 0 0 1 220 120';
    meterEl.innerHTML = '<svg viewBox="0 0 240 136">' +
      '<defs><linearGradient id="stHeat" x1="0" x2="1"><stop offset="0" stop-color="#4ea8dc"/><stop offset=".55" stop-color="#f5c86b"/><stop offset="1" stop-color="#ef5b4c"/></linearGradient>' +
      '<filter id="stGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>' +
      '<path d="' + arc + '" fill="none" stroke="#162033" stroke-width="26" stroke-linecap="round"/>' +
      '<path d="' + arc + '" fill="none" stroke="url(#stHeat)" stroke-width="12" stroke-linecap="round" opacity=".9"/>' +
      '<g class="st-meter-band" opacity="0"><path class="st-meter-green-glow" d="' + arc + '" pathLength="100" fill="none" stroke="#45f09a" stroke-width="28" filter="url(#stGlow)" opacity=".8"/>' +
      '<path class="st-meter-green" d="' + arc + '" pathLength="100" fill="none" stroke="#45f09a" stroke-width="20"/></g>' +
      '<text x="14" y="134" font-size="11" fill="#b9c1d6" font-family="Bai Jamjuree, sans-serif">เบา</text><text x="226" y="134" font-size="11" fill="#b9c1d6" text-anchor="end" font-family="Bai Jamjuree, sans-serif">แรง</text>' +
      '<g class="st-meter-needle"><path d="M120 120 L120 30" stroke="#fff8e6" stroke-width="5" stroke-linecap="round"/><path d="M120 120 L120 30" stroke="#1a2332" stroke-width="1.5" stroke-linecap="round" opacity=".35"/><circle cx="120" cy="120" r="11" fill="#f5c86b" stroke="#1a2332" stroke-width="2"/></g>' +
      '</svg><div class="st-meter-label"><b id="stMeterPct">แรง 0%</b><span id="stMeterHint">ปล่อยตอนเข็มแรง = เดินไกล</span></div>';
    document.body.appendChild(meterEl);
    return meterEl;
  }
  function meterPos(m, t) {
    if (!m || t < (m.tapMs || 150)) return 0;
    return (1 - Math.cos((2 * Math.PI * t) / m.period)) / 2;
  }
  // ช่องเขียวโผล่/หายตามตารางที่เซิร์ฟเวอร์กำหนด
  function setBand(node, on) {
    var band = node.querySelector('.st-meter-band');
    if (!band || band.__on === on) return;
    band.__on = on;
    node.classList.toggle('has-green', on);
    var hint = node.querySelector('#stMeterHint');
    if (on) {
      hint.textContent = 'ช่องเขียวโผล่! ปล่อยในช่อง = ลุ้นดับเบิล';
      haptic([8, 30, 8]);
      sfx.bid();
      band.setAttribute('opacity', '1');
      if (!reduceMotion) band.animate([{ opacity: 0, transform: 'scale(1.18)' }, { opacity: 1, transform: 'scale(0.97)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    } else {
      hint.textContent = node.__hadGreen ? 'ช่องเขียวหายแล้ว — ปล่อยตอนเข็มแรงก็ได้' : 'ปล่อยตอนเข็มแรง = เดินไกล';
      band.setAttribute('opacity', '0');
      if (!reduceMotion && node.__hadGreen) band.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    }
    if (on) node.__hadGreen = true;
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
  function holdFrame() {
    if (!hold || hold.released) return;
    var t = performance.now() - hold.t0;
    var m = hold.meter;
    var pos = meterPos(m, t);
    var node = meterNode();
    var needle = node.querySelector('.st-meter-needle');
    needle.setAttribute('transform', 'rotate(' + (-90 + 180 * pos).toFixed(2) + ' 120 120)');
    node.querySelector('#stMeterPct').textContent = 'แรง ' + Math.round(pos * 100) + '%';
    var g = m && m.green;
    var greenOn = !!(g && t >= g.appearAt && t <= g.until);
    setBand(node, greenOn);
    var inGreen = greenOn && Math.abs(pos - g.center) <= g.width / 2;
    if (inGreen !== hold.inGreen) {
      hold.inGreen = inGreen;
      node.classList.toggle('is-green', inGreen);
      if (inGreen) haptic(6);
    }
    var btnEl = document.getElementById('stRollBtn');
    if (btnEl && !reduceMotion) btnEl.style.transform = 'scale(' + (0.93 + pos * 0.07).toFixed(3) + ')';
    if (holdTone) try { holdTone.o.frequency.setTargetAtTime(220 + pos * 700, holdTone.ctx.currentTime, 0.02); } catch (e) { /* ignore */ }
    hold.raf = requestAnimationFrame(holdFrame);
  }
  function showMeter() {
    if (!hold || hold.released || !hold.meter) return;
    var node = meterNode();
    var m = hold.meter;
    node.__hadGreen = false;
    var band = node.querySelector('.st-meter-band');
    band.__on = null;
    setBand(node, false);
    if (m.green) {
      ['.st-meter-green', '.st-meter-green-glow'].forEach(function(sel) {
        var gp = node.querySelector(sel);
        gp.setAttribute('stroke-dasharray', (m.green.width * 100).toFixed(2) + ' 200');
        gp.setAttribute('stroke-dashoffset', (-(m.green.center - m.green.width / 2) * 100).toFixed(2));
      });
    }
    node.classList.add('is-on');
    node.animate([{ opacity: 0, transform: 'translateX(-50%) translateY(14px) scale(0.92)' }, { opacity: 1, transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: reduceMotion ? 1 : 180, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    startTone();
    hold.raf = requestAnimationFrame(holdFrame);
  }
  function hideMeter(keepMs) {
    stopTone();
    var node = meterEl;
    var btnEl = document.getElementById('stRollBtn');
    if (btnEl) btnEl.style.transform = '';
    if (!node || !node.classList.contains('is-on')) return;
    setTimeout(function() {
      var a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
      a.onfinish = function() { node.classList.remove('is-on', 'is-green', 'has-green'); };
    }, keepMs || 0);
  }
  function beginHold(pointerId) {
    if (hold || pending || running) return;
    var a = S && S.availableActions;
    if (!a || !a.roll) return;
    var sentAt = performance.now();
    hold = { t0: sentAt, pointerId: pointerId, meter: null, released: false, pendingRelease: null, inGreen: false };
    var mine = hold;
    socket.emit('setthi_rollHoldStart', { roomId: roomId, seq: S.phaseSeq }, function(res) {
      if (hold !== mine) { if (res && res.success) socket.emit('setthi_rollHoldCancel', { roomId: roomId }); return; }
      if (!res || !res.success) { toast((res && res.error) || 'ทอยไม่ได้'); endHold(); renderDock(); return; }
      // เซิร์ฟเวอร์เริ่มจับเวลาตอนได้รับข้อความ ≈ กึ่งกลางระหว่างส่งกับได้ ack — ตั้งเข็มตามนั้นให้เวลาสองฝั่งตรงกัน
      // (ถ้าปล่อยก่อน ack มา เวลาที่ส่งไปจะนับจากจุดนี้เหมือนกัน)
      mine.t0 = (sentAt + performance.now()) / 2;
      if (mine.pendingRelease !== null) mine.pendingRelease = Math.max(0, mine.pendingAt - mine.t0);
      mine.meter = res.meter;
      if (mine.pendingRelease !== null) sendRelease(mine.pendingRelease);
      else if (performance.now() - mine.t0 > 110) showMeter();
    });
    setTimeout(function() { if (hold === mine && mine.meter && !mine.released && !(meterEl && meterEl.classList.contains('is-on'))) showMeter(); }, 120);
  }
  function endHold() {
    if (hold && hold.raf) cancelAnimationFrame(hold.raf);
    hold = null;
  }
  function sendRelease(elapsed) {
    var h = hold;
    if (!h) return;
    h.released = true;
    if (h.raf) cancelAnimationFrame(h.raf);
    var tap = elapsed < ((h.meter && h.meter.tapMs) || 150);
    hideMeter(tap ? 0 : 260);
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
  document.addEventListener('pointerdown', function(e) {
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
    var b = document.getElementById('stRollBtn');
    if (!b) return;
    var r = b.getBoundingClientRect();
    var out = 48;
    if (e.clientX < r.left - out || e.clientX > r.right + out || e.clientY < r.top - out * 2 || e.clientY > r.bottom + out) cancelHold('นิ้วเลื่อนออก — ยกเลิกการทอย');
  });
  document.addEventListener('contextmenu', function(e) { if (e.target.closest && e.target.closest('#stRollBtn')) e.preventDefault(); });
  // Space บนเดสก์ท็อป: กดค้าง/ปล่อย
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
  document.addEventListener('keyup', function(e) {
    if ((e.code === 'Space' || e.key === ' ') && hold && hold.pointerId === 'key') { e.preventDefault(); finishHold(); }
  });

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
    var t = e.target.closest('button, [data-deed], .st-cell, .st-chip, [data-close]');
    if (!t) return;
    var id = t.id;
    if (t.dataset.close) { closeSheet(); return; }
    if (t.classList.contains('st-cell')) { openSheet('deed', Number(t.dataset.i)); return; }
    if (t.classList.contains('st-chip')) {
      var s = seatOf(t.dataset.id);
      if (s && !s.isSelf && !isOut(s) && !isOut(meSeat())) { draft = newDraft(s.playerId); openSheet('trade'); }
      else if (s && s.isSelf) openSheet('props');
      return;
    }
    if (t.dataset.deed !== undefined && !t.dataset.act && t.tagName !== 'BUTTON') { openSheet('deed', Number(t.dataset.deed)); return; }
    if (id === 'stRollBtn') { if (e.detail === 0 && !hold) { haptic(10); send('setthi_roll', seq()); } return; }
    if (id === 'stBuyBtn') { send('setthi_buy', seq()); return; }
    if (id === 'stDeclineBtn') { send('setthi_decline', seq()); return; }
    if (id === 'stEndTurnBtn') { send('setthi_endTurn', seq()); return; }
    if (id === 'stPayJailBtn') { send('setthi_payJail', seq()); return; }
    if (id === 'stJailCardBtn') { send('setthi_useJailCard', seq()); return; }
    if (id === 'stPropsBtn' || id === 'stDebtBtn') { openSheet('props'); return; }
    if (id === 'stTradeBtn') { draft = draft && draft.to ? draft : newDraft(); draft.counterOf = null; openSheet('trade'); return; }
    if (id === 'stOpenAuction') { auctionMinimized = false; openSheet('auction'); return; }
    if (id === 'stAuctionPill') { auctionMinimized = false; openSheet('auction'); return; }
    if (id === 'stShowEnd') { showEnd(false, true); return; }
    if (id === 'stBackBtn' || id === 'stEndBack') { socket.emit('returnFinishedToLobby', { roomId: roomId }); return; }
    if (id === 'stEndClose') { el.end.classList.remove('is-on'); return; }
    if (id === 'stEndShare') { shareResult(); return; }
    if (id === 'stCancelDeal') { send('setthi_tradeCancel', {}); return; }
    if (id && id.indexOf('stViewDeal') === 0) { openSheet('offer', Number(id.slice(10))); return; }
    if (t.dataset.act) { send('setthi_' + t.dataset.act, { square: Number(t.dataset.sq) }); return; }
    if (t.dataset.bid) { send('setthi_bid', { amount: Number(t.dataset.bid) }); return; }
    if (id === 'stBidCustom') {
      var v = Number((document.getElementById('stBidInput') || {}).value);
      send('setthi_bid', { amount: v });
      return;
    }
    if (t.dataset.to && sheetKind === 'trade') { var keep = draft.counterOf; draft = newDraft(t.dataset.to); draft.counterOf = keep; buildSheet(); return; }
    if (t.dataset.side && sheetKind === 'trade') {
      var list = draft[t.dataset.side].props;
      var sq = Number(t.dataset.sq);
      var k = list.indexOf(sq);
      if (k >= 0) list.splice(k, 1); else list.push(sq);
      buildSheet();
      return;
    }
    if (t.dataset.jail && sheetKind === 'trade') { draft[t.dataset.jail].jailCards = draft[t.dataset.jail].jailCards ? 0 : 1; buildSheet(); return; }
    if (t.dataset.cash && sheetKind === 'trade') {
      var sideKey = t.dataset.cash;
      var owner = sideKey === 'give' ? meSeat() : seatOf(draft.to);
      draft[sideKey].cash = Math.max(0, Math.min(owner ? owner.cash : 0, (draft[sideKey].cash || 0) + Number(t.dataset.d)));
      buildSheet();
      return;
    }
    if (id === 'stTradeClose') { closeSheet(); return; }
    if (id === 'stTradeSend') {
      var payload = { to: draft.to, give: draft.give, get: draft.get };
      if (draft.counterOf) {
        send('setthi_tradeCounter', Object.assign({ tradeId: draft.counterOf }, payload), function(res) { if (res.success) { draft = null; closeSheet(); toast('ส่งข้อเสนอโต้กลับแล้ว'); } });
      } else {
        send('setthi_tradePropose', payload, function(res) { if (res.success) { draft = null; closeSheet(); toast('ส่งข้อเสนอแล้ว — รออีกฝ่ายตอบ'); } });
      }
      return;
    }
    if (id === 'stOfferAccept') { send('setthi_tradeRespond', { tradeId: sheetArg, accept: true }, function(res) { if (res.success) closeSheet(); }); return; }
    if (id === 'stOfferReject') { send('setthi_tradeRespond', { tradeId: sheetArg, accept: false }, function(res) { if (res.success) closeSheet(); }); return; }
    if (id === 'stOfferCounter') {
      var offer = (S.trades || []).find(function(x) { return x.id === sheetArg; });
      if (!offer) return;
      draft = { to: offer.from, give: JSON.parse(JSON.stringify(offer.get)), get: JSON.parse(JSON.stringify(offer.give)), counterOf: offer.id };
      openSheet('trade');
      return;
    }
  });
  document.addEventListener('input', function(e) {
    var t = e.target;
    if (t.dataset && t.dataset.cashinput && draft) {
      var side = t.dataset.cashinput;
      var owner = side === 'give' ? meSeat() : seatOf(draft.to);
      draft[side].cash = Math.max(0, Math.min(owner ? owner.cash : 0, Math.floor(Number(t.value) || 0)));
      var sum = el.sheetCard.querySelector('.st-trade-sum');
      if (sum) sum.innerHTML = tradeSummary(draft, seatOf(draft.to));
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'stBidInput') { e.preventDefault(); var b = document.getElementById('stBidCustom'); if (b) b.click(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && (e.target.classList.contains('st-cell') || e.target.classList.contains('st-chip'))) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape' && sheetKind) closeSheet();
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
      return '<div class="st-rank"><b>' + r.rank + '</b>' + tokenHtml(seat) + '<span class="st-rank-name">' + esc(r.name) + '<small>' + (r.bankrupt ? 'ล้มละลาย' : r.left ? 'ออกจากเกม' : 'เงินสด ' + money(r.cash) + ' · ที่ดิน ' + r.properties + ' แปลง') + '</small></span><span class="st-rank-worth">' + money(r.netWorth) + '</span></div>';
    }).join('');
    var title = winners.length > 1 ? winners.map(function(w) { return w.name; }).join(' & ') + ' ชนะร่วม!' : (winners[0] ? winners[0].name + ' คือเศรษฐี!' : 'จบเกม');
    var iWon = winners.some(function(w) { return w.playerId === playerId; });
    el.end.innerHTML = '<div class="st-end-inner">' +
      '<div class="st-end-kicker">' + (iWon ? 'คุณชนะ!' : 'จบเกม') + '</div>' +
      '<h2 class="st-end-title">' + esc(title) + '</h2>' +
      '<p class="st-end-reason">' + esc(S.finishReason || '') + '</p>' +
      '<div class="st-podium">' + pod + '</div>' +
      '<div class="st-ranks">' + list + '</div>' +
      '<div class="st-end-btns">' + btn('stEndBack', 'กลับห้องรอ · เล่นอีกตา', { primary: true }) + btn('stEndShare', 'แชร์ผล') + '</div>' +
      btn('stEndClose', 'ดูกระดาน', {}) +
      '<div class="st-end-note" id="stEndNote">ทรัพย์สินรวม = เงินสด + ราคาที่ดิน (จำนองนับครึ่ง) + บ้านตามทุน · เงินในเกม ไม่มีมูลค่าจริง</div>' +
      '</div>';
    el.end.classList.add('is-on');
    var blocks = el.end.querySelectorAll('.st-pod-block');
    var toks = el.end.querySelectorAll('.st-pod .st-token');
    if (celebrate && !reduceMotion) {
      sfx.fanfare();
      blocks.forEach(function(b, k) { b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1.06)', offset: 0.8 }, { transform: 'scaleY(1)' }], { duration: 700, delay: [200, 500, 0][k], easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }); });
      toks.forEach(function(t, k) { t.animate([{ transform: 'translateY(-120px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 600, delay: 600 + k * 120, easing: 'cubic-bezier(0.34,1.56,0.64,1)', fill: 'both' }); });
      confetti(80);
    }
  }
  function confetti(n) {
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
      c.animate([
        { transform: 'translate(' + x + 'px, -30px) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + (x + drift) + 'px,' + (H + 40) + 'px) rotate(' + (540 + Math.random() * 720) + 'deg)', opacity: 0.9 }
      ], { duration: 2200 + Math.random() * 1600, delay: Math.random() * 900, easing: 'cubic-bezier(0.25, 0.5, 0.5, 1)', fill: 'both' });
    }
    setTimeout(function() { layer.remove(); }, 5200);
  }
  function shareResult() {
    if (!window.partyPlay || !S || !S.standings) return;
    window.partyPlay.shareResult({
      mode: 'เศรษฐี',
      headline: (S.winners || []).map(function(w) { return w.name; }).join(' & ') + ((S.winners || []).length > 1 ? ' ชนะร่วม!' : ' คือเศรษฐี!'),
      sub: (S.finishReason || '') + ' · เงินในเกม ไม่มีมูลค่าจริง',
      lines: S.standings.slice(0, 6).map(function(r) { return r.rank + '. ' + r.name + ' ' + (r.bankrupt ? 'ล้มละลาย' : money(r.netWorth)); }),
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
    if (next.pendingBuy !== null && next.pendingBuy !== undefined) preloadLand(next.pendingBuy);
    if (next.auction) preloadLand(next.auction.square);
    (next.fx || []).forEach(function(f) { if (f.seq > lastFxSeq - 12 && (f.kind === 'buy' || f.kind === 'auctionStart')) preloadLand(f.square); });
    if (first || gap || !fresh.length) {
      if (first || gap) { queue = []; }
      if (!running) renderAll();
      else { renderDock(); syncSheets(); }
      return;
    }
    lastPlayedSeq = fresh[0].seq - 1;
    enqueueFx(fresh);
    if (!running) renderAll();
    else { renderDock(); renderLog(); syncSheets(); renderClock(); }
  }

  // นาฬิกา + ตัวนับวินาที
  setInterval(function() {
    renderClock();
    var secNode = document.getElementById('stSec');
    var s = secondsLeft();
    if (secNode && s !== null) secNode.textContent = s;
    var aSec = document.getElementById('stAuctionSec');
    if (aSec && S && S.auction) aSec.textContent = Math.max(0, Math.ceil((S.auction.endsAt - nowServer()) / 1000));
    el.timer.classList.toggle('is-low', s !== null && s <= 5);
    if (sheetKind === 'auction') {
      var bar = document.querySelector('#stAuctionBar i');
      if (bar && (!auctionBarAnim || auctionBarAnim.playState === 'finished')) syncAuctionBar();
    }
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
  $('#stHowBtn').addEventListener('click', function() { openSheet('howto'); });
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
  $('#leaveRoomBtn').addEventListener('click', function() {
    Swal.fire({ icon: 'question', title: 'ออกจากเกม?', text: 'ทรัพย์สินทั้งหมดของคุณจะคืนธนาคาร แล้วเกมเดินต่อโดยไม่มีคุณ', showCancelButton: true, confirmButtonText: 'ออก', cancelButtonText: 'อยู่ต่อ', background: '#1d2433', color: '#fff' })
      .then(function(r) {
        if (!r.isConfirmed) return;
        allowNavigation = true;
        socket.emit('leaveRoom', {}, function() { window.location.href = '/rooms?playerId=' + playerId; });
      });
  });
  var endBtn = $('#stEndBtn');
  if (endBtn) endBtn.addEventListener('click', function() {
    Swal.fire({ icon: 'warning', title: 'จบเกมเลยไหม?', text: 'นับทรัพย์สินรวมตอนนี้ คนที่มากสุดชนะ แล้วทุกคนกลับห้องรอ', showCancelButton: true, confirmButtonText: 'จบเกม', cancelButtonText: 'เล่นต่อ', background: '#1d2433', color: '#fff', confirmButtonColor: '#c2410c' })
      .then(function(r) { if (r.isConfirmed) { setSidebar(false); send('setthi_end', {}); } });
  });
  var touched = false;
  document.addEventListener('pointerdown', function() { touched = true; }, { once: true, capture: true });
  window.addEventListener('beforeunload', function(e) { if (touched && !allowNavigation && S && S.phase !== 'finished' && meSeat() && !isOut(meSeat())) e.preventDefault(); });

  var resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() { if (V) { camState = { x: 0, y: 0, k: 1 }; el.cam.style.transform = ''; placeTokens(V); renderDock(); renderDeskProps(); } }, 120);
  });

  // ---------- socket ----------
  socket.on('connect', function() {
    $('#stConn').style.display = 'none';
    socket.emit('initPlayer', playerId);
    socket.emit('setRoom', { roomId: roomId, playerId: playerId });
    socket.emit('setthi_requestState', { roomId: roomId, playerId: playerId });
  });
  socket.on('disconnect', function() { $('#stConn').style.display = 'block'; });
  socket.on('setthiState', onState);
  socket.on('redirectToLobby', function() { allowNavigation = true; window.location.href = '/room/' + roomId + '?playerId=' + playerId; });
  socket.on('returnToLobby', function(data) {
    var note = document.getElementById('stEndNote');
    var secs = Number(data && data.countdown) || 10;
    if (note) note.textContent = 'กลับห้องรอใน ' + secs + ' วินาที · เงินในเกม ไม่มีมูลค่าจริง';
  });
  socket.on('restartGame', function() { allowNavigation = true; window.location.href = '/room/' + roomId + '?playerId=' + playerId; });
  socket.on('gameStarting', function() { allowNavigation = true; window.location.href = '/game/' + roomId + '?playerId=' + playerId; });
  socket.on('kickedFromRoom', function(data) {
    allowNavigation = true;
    Swal.fire({ icon: 'error', title: 'ถูกเตะออกจากห้อง', text: (data && data.reason) || '', background: '#1d2433', color: '#fff' })
      .then(function() { window.location.href = '/rooms?playerId=' + playerId; });
  });

  if (window.initChatPanel) window.initChatPanel({ socket: socket, playerId: playerId, playerName: BOOT.playerName });

  // ---------- เริ่ม ----------
  buildBoard();
  if (S) {
    V = modelFrom(S);
    renderAll();
  } else {
    renderDock();
  }
  // ช่องบนกระดานขนาดเปลี่ยนหลังฟอนต์โหลด
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function() { if (V) placeTokens(V); });
  // ใช้ในเทส/ถ่ายภาพฉาก: เล่นฉากจาก fx ตัวอย่าง (แค่ภาพบนเครื่องนี้ ไม่ส่งอะไรไปเซิร์ฟเวอร์)
  window.__setthi = {
    state: function() { return S; },
    queueLength: function() { return queue.length + (running ? 1 : 0); },
    skip: skipNow,
    hold: function() { return hold ? { meter: hold.meter, t0: hold.t0, released: hold.released } : null; },
    demo: function(list) { enqueueFx((Array.isArray(list) ? list : [list]).map(function(f) { return Object.assign({ seq: 0, at: nowServer() }, f); })); }
  };
})();
