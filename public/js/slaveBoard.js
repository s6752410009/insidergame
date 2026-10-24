(function (global) {
  'use strict';
  global.mountSlaveBoard = function ({ playerId, roomId, initial, canDebug = false }) {
    const $ = id => document.getElementById(id);
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const titles = ['คิง', 'ควีน', 'รองสลาฟ', 'สลาฟ'];
    const roles = ['king', 'queen', 'commoner', 'slave'];
    // Public rank art only; rank 3 keeps the existing exchange rules.
    function roleIcon(role) {
      const art = {
        king: '<path fill="#ffda66" d="m11 24 12 9 9-17 9 17 12-9-5 27H16z"/><path fill="#fff0af" d="M29 7h6v5h5v5h-5v8h-6v-8h-5v-5h5z"/><path fill="#bd682b" d="M16 46h32v8H16z"/><path fill="#fbe7a4" d="M18 47h28v3H18z"/><path fill="#d84d47" d="m32 32 5 6-5 6-5-6z"/>',
        queen: '<path fill="#ffe9ac" d="m10 29 12 7 10-14 10 14 12-7-7 23H17z"/><circle fill="#fff8d9" cx="10" cy="26" r="4"/><circle fill="#fff8d9" cx="32" cy="17" r="5"/><circle fill="#fff8d9" cx="54" cy="26" r="4"/><path fill="#da557b" d="M32 44c-12-7-7-15 0-9 7-6 12 2 0 9"/><path stroke="#ba763b" stroke-width="4" d="M18 51h28"/>',
        commoner: '<path fill="#285857" stroke="#b0d5c3" stroke-width="2" d="M10 55c0-15 10-23 22-23s22 8 22 23z"/><path fill="#f6d0a0" d="M26 28h12v13l-6 6-6-6z"/><ellipse fill="#f6d0a0" cx="32" cy="23" rx="11" ry="14"/><path fill="#573e31" d="M21 24C15 7 38 1 44 18l-1 9-5-12c-3 7-12 7-17 9"/><path fill="#e4f0d6" d="m25 36 7 9-6 5-7-12zm14 0-7 9 6 5 7-12z"/>',
        slave: '<path fill="none" stroke="#f4d1a0" stroke-width="10" stroke-linecap="round" d="m9 15 11 12m35-12L44 27"/><g fill="#687f88" stroke="#d8e0da" stroke-width="3"><rect x="11" y="22" width="18" height="23" rx="7" transform="rotate(-25 20 33)"/><rect x="35" y="22" width="18" height="23" rx="7" transform="rotate(25 44 33)"/></g><path fill="none" stroke="#e5e3cf" stroke-width="4" stroke-linecap="round" d="m25 39 7 8 7-8"/><circle fill="#263d45" cx="19" cy="33" r="3"/><circle fill="#263d45" cx="45" cy="33" r="3"/>'
      };
      return '<svg class="sl-role-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' + (art[role] || art.commoner) + '</svg>';
    }
    function roleBadge(role, label) {
      return '<span class="sl-role-badge role-' + role + '" data-role="' + role + '" role="img" aria-label="' + esc(label) + '">' + roleIcon(role) + '</span>';
    }
    const socket = global.io(), guide = global.SlaveGuide;
    let state = initial, selected = new Set(), pending = false, last = null, handKey = '', pileKey = '', seatKey = '', warned = '';
    const audio = new global.SlaveAudio(soundLabel);
    function soundLabel() {
      $('slSound').textContent = !audio.enabled ? 'เสียง ปิด' : audio.ready ? '♪ เสียง เปิด' : 'เปิดเสียงเกม';
      $('slSound').setAttribute('aria-pressed', String(audio.enabled && audio.ready));
      $('slSound').title = audio.ready ? 'ปิดเสียงทั้งหมด' : 'เปิดเสียงและลองฟัง';
      $('slMusic').textContent = '♫ เพลง ' + (audio.music ? 'เปิด' : 'ปิด');
      $('slMusic').setAttribute('aria-pressed', String(audio.music));
      $('slAudioHint').hidden = !audio.enabled || audio.ready;
    }
    // Retry on subsequent gestures as mobile browsers may interrupt a context after backgrounding.
    function gesture(e) { if (!e.target.closest('#slSound') && !audio.ready) audio.unlock(); }
    document.addEventListener('pointerdown', gesture);
    document.addEventListener('keydown', gesture);
    $('slSound').onclick = async () => {
      if (audio.ready) audio.setEnabled(false);
      else { audio.setEnabled(true); if (await audio.unlock()) audio.cue('preview'); }
      soundLabel();
    };
    $('slMusic').onclick = () => { audio.setMusic(!audio.music); if (audio.enabled) audio.unlock(); };
    soundLabel();
    let navigating = false;
    const tools = global.mountSlaveTools({ socket, playerId, roomId, getState: () => state, canDebug, audio, onLeaving: () => { navigating = true; } });
    function card(c, button, index, count) {
      const tag = button ? 'button' : 'div';
      return '<' + tag + (button ? ' type="button" data-card="' + c.id + '" aria-label="' + esc(c.label) + '" aria-pressed="false"' : ' aria-label="' + esc(c.label) + '"') +
        ' class="sl-card ' + (c.red ? 'red' : '') + '" style="--i:' + index + ';--fan:' + (index - (count - 1) / 2) + '">' +
        '<span class="sl-corner">' + esc(c.rank) + '<small>' + esc(c.suit) + '</small></span><span class="sl-pip" aria-hidden="true">' + esc(c.suit) + '</span><span class="sl-corner bottom" aria-hidden="true">' + esc(c.rank) + '<small>' + esc(c.suit) + '</small></span></' + tag + '>';
    }
    function avatar(value) {
      const text = String(value || '♠');
      if (/^(https:\/\/|\/[^/])/.test(text)) return '<img src="' + esc(text) + '" alt="" referrerpolicy="no-referrer">';
      const portrait = { '👤': 'player', '👻': 'ghost', '🦊': 'fox', '🐼': 'panda' }[text];
      if (portrait) return '<span class="sl-portrait portrait-' + portrait + '"></span>';
      return esc(text);
    }
    function seats() {
      const nextKey = JSON.stringify([state.phase, state.turnId, state.self?.exchangeCount, state.seats]);
      if (nextKey === seatKey) return;
      seatKey = nextKey;
      const selfIndex = state.seats.findIndex(p => p.playerId === playerId);
      const ordered = [...state.seats.slice(selfIndex), ...state.seats.slice(0, selfIndex)];
      const positions = ['self', 'left', 'top', 'right'];
      $('slSeats').innerHTML = ordered.map((p, i) => {
        const self = p.playerId === playerId, turn = (p.playerId === state.turnId && state.phase === 'turn') || (self && Boolean(state.self?.exchangeCount));
        const label = p.place ? titles[p.place - 1] : p.passed ? 'ผ่านแล้ว' : turn ? (state.phase === 'exchange' ? 'เลือกไพ่คืน' : self ? 'ตาคุณ' : 'กำลังเล่น…') : !p.online && !p.isBot ? 'รอเชื่อมต่อ' : p.title || (p.isBot ? 'บอท' : 'พร้อมเล่น');
        const count = Math.max(0, Math.min(13, Number(p.count) || 0));
        const rank = p.place || titles.indexOf(p.title) + 1;
        const role = roles[rank - 1] || 'unranked';
        const backs = !self ? '<div class="sl-backs" data-card-count="' + count + '" style="--cards:' + count + '" aria-hidden="true">' + (count ? Array.from({ length: count }, (_, j) => '<i class="sl-back" style="--r:' + (j - (count - 1) / 2) * 2 + 'deg;--card-index:' + j + '"></i>').join('') : '<span class="sl-no-cards">หมดมือ</span>') + '</div>' : '';
        return '<div data-player-id="' + esc(p.playerId) + '" class="sl-seat seat-' + positions[i] + (turn ? ' turn' : '') + (p.passed ? ' passed' : '') + '"' + (turn ? ' aria-current="true"' : '') + '><div class="sl-avatar-wrap"><div class="sl-avatar" aria-hidden="true"><svg class="sl-avatar-timer" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="25" pathLength="100"/></svg>' + avatar(p.avatar) + '</div>' + roleBadge(role, rank ? titles[rank - 1] : 'ยังไม่มีอันดับ') + '</div><div class="sl-seat-info"><div class="sl-name">' + esc(self ? 'คุณ · ' + p.name : p.name) + '</div><span class="sl-seat-label">' + esc(label) + '</span>' + (self ? '' : '<span class="sl-count" aria-label="เหลือไพ่ ' + count + ' ใบ"><strong>' + count + '</strong> ใบ</span>') + '</div>' + backs + '</div>';
      }).join('');
    }
    function animate(el, name) {
      el.classList.remove(name); void el.offsetWidth; el.classList.add(name);
    }
    function render(next) {
      if (next.step < state.step) return;
      const changed = !last || next.step !== last.step || next.phase !== last.phase || next.round !== last.round;
      if (next.step !== state.step || next.phase !== state.phase) { selected.clear(); pending = false; }
      const previous = last;
      state = next;
      if (changed) {
        if (previous) {
          if (state.round !== previous.round) audio.cue('deal');
          else if (state.phase === 'round-end' && previous.phase !== 'round-end') audio.cue(state.standings?.[0]?.playerId === playerId ? 'win' : 'end');
          else if (previous.phase === 'exchange' && state.phase === 'turn') audio.cue('exchange');
          else if (state.top && JSON.stringify(state.top) !== JSON.stringify(previous.top)) audio.cue('play');
          else if (!state.top && previous.top) audio.cue('clear');
          else if (state.seats.filter(p => p.passed).length > previous.seats.filter(p => p.passed).length) audio.cue('pass');
        }
        audio.turn(Boolean(state.canPlay || state.self?.exchangeCount), state.round + ':' + state.step);
        last = state;
      }
      $('slRound').textContent = 'รอบ ' + state.round;
      seats();
      const newPileKey = state.top ? state.top.playerId + ':' + state.top.cards.map(c => c.id).join(',') : '';
      if (newPileKey !== pileKey || !$('slPile').children.length) {
        $('slPile').innerHTML = state.top ? state.top.cards.map((c, i) => card(c, false, i, state.top.cards.length)).join('') : '<div class="sl-empty-pile" aria-hidden="true">♠</div>';
        const actor = state.seats.findIndex(p => p.playerId === state.top?.playerId), me = state.seats.findIndex(p => p.playerId === playerId);
        const from = (actor - me + 4) % 4;
        $('slPile').style.setProperty('--play-x', from === 1 ? '-80px' : from === 3 ? '80px' : '0px');
        $('slPile').style.setProperty('--play-y', from === 0 ? '60px' : from === 2 ? '-60px' : '0px');
        if (state.top && previous) animate($('slPile'), 'just-played');
        pileKey = newPileKey;
      }
      $('slPileText').textContent = state.phase === 'exchange' ? 'เลือกคืนแล้ว ' + (state.exchangeProgress?.done || 0) + '/2 คน · แลกพร้อมกัน' : state.top ? (state.seats.find(p => p.playerId === state.top.playerId)?.name || '') + ' ลง' + guide.setName(state.top.cards) : state.openingRequired ? 'ผู้ถือ 3♣ เปิดกองก่อน' : 'กองใหม่ · ลงชุดไหนก็ได้';
      const hand = state.self?.hand || [], newHandKey = state.round + ':' + hand.map(c => c.id).join(',');
      if (newHandKey !== handKey) {
        $('slHand').classList.remove('dealing');
        $('slHand').innerHTML = hand.length ? hand.map((c, i) => card(c, true, i, hand.length)).join('') : '<div class="sl-hand-empty">หมดมือแล้ว · ลุ้นเพื่อนต่อได้เลย</div>';
        if (!previous || previous.round !== state.round) animate($('slHand'), 'dealing');
        handKey = newHandKey;
      }
      const exchange = state.self?.exchangeCount || 0, actionable = Boolean(state.canPlay || exchange);
      const advice = guide.analyze(state, selected), candidates = new Set(advice.candidates);
      $('slHand').querySelectorAll('[data-card]').forEach(b => {
        const id = Number(b.dataset.card), on = selected.has(id), playable = actionable && candidates.has(id);
        b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('playable', Boolean(playable));
        b.classList.toggle('unavailable', actionable && !playable && !on);
        b.classList.toggle('invalid-selection', on && advice.invalid);
        b.dataset.playable = String(Boolean(playable));
        b.setAttribute('aria-label', hand.find(c => c.id === id).label + (actionable ? playable ? ' · ใช้ในชุดที่ลงได้' : ' · ยังลงชุดนี้ไม่ได้' : ''));
        b.setAttribute('aria-disabled', String(!actionable || pending));
      });
      const turn = state.seats.find(p => p.playerId === state.turnId);
      const self = state.seats.find(p => p.playerId === playerId);
      const ownResult = state.standings?.find(p => p.playerId === playerId);
      $('slPlayerZone').classList.toggle('is-your-turn', actionable);
      $('slStatus').textContent = state.phase === 'finished' ? 'โต๊ะหยุดแล้ว · มีคนออกจากห้อง' : state.phase === 'round-end' ? (state.isHost ? 'เริ่มรอบถัดไปได้เมื่อเพื่อนพร้อม' : 'รอหัวห้องเริ่มรอบถัดไป') : state.phase === 'exchange' ? (exchange ? self.title + ' · เลือกคืน ' + exchange + ' ใบ' : self?.title === 'คิง' || self?.title === 'ควีน' ? 'เลือกคืนแล้ว · รอแลกไพ่' : self?.title + ' · ระบบแลกไพ่ให้') : state.canPlay ? '✦ ถึงตาคุณแล้ว!' : self?.passed ? 'คุณผ่านแล้ว · รอกองใหม่' : self?.place ? 'หมดมือแล้ว · อันดับ ' + self.place : 'รอ ' + (turn?.name || 'ผู้เล่น') + ' ลงไพ่';
      $('slHandMeta').textContent = hand.length + ' ใบในมือ' + (selected.size ? ' · เลือก ' + selected.size : '');
      $('slPlay').textContent = pending ? 'กำลังส่ง…' : advice.label;
      const legal = advice.legal;
      $('slPlay').disabled = pending || !socket.connected || !actionable || !selected.size || !legal;
      $('slPass').disabled = pending || !socket.connected || !state.canPass;
      $('slHint').disabled = pending || !actionable || (!exchange && !state.legalMoves?.length);
      $('slClear').disabled = !selected.size || pending;
      $('slNext').hidden = !(state.phase === 'round-end' && state.isHost);
      $('slNext').disabled = pending || !socket.connected;
      const ended = ['round-end', 'finished'].includes(state.phase);
      $('slActions').hidden = (state.phase === 'exchange' && !exchange) || (ended && !(state.phase === 'round-end' && state.isHost));
      if (ended) $('slHandMeta').textContent = ownResult ? 'อันดับ ' + ownResult.place : '';
      ['slPlay', 'slPass', 'slHint', 'slClear'].forEach(id => { $(id).hidden = ended; });
      const mustPass = Boolean(state.canPlay && state.canPass && !state.legalMoves?.length);
      if (mustPass) $('slPlay').hidden = true;
      $('slPass').classList.toggle('primary', mustPass);
      $('slPass').textContent = mustPass ? 'ผ่าน · รอกองใหม่' : 'ผ่าน';
      $('slHint').textContent = exchange ? '✧ เลือกไพ่ต่ำคืน' : '✧ เลือกชุดที่ลงได้';
      $('slHand').hidden = ended;
      $('slPlayArea').classList.toggle('is-round-end', ended);
      $('slActionHelp').classList.toggle('invalid', actionable && advice.invalid);
      $('slActionHelp').textContent = ended ? state.phase === 'finished' ? 'กลับห้องรอเพื่อจัดผู้เล่นใหม่ได้จากมุมขวาบน' : state.isHost ? 'เริ่มรอบใหม่แล้วจะแลกไพ่ตามอันดับ · กติกาเดิมทั้งโต๊ะ' : 'รอบใหม่เริ่มเมื่อหัวห้องกด · ไพ่ใหม่คนละ 13 ใบ' : state.phase === 'exchange' ? guide.exchange(state, playerId) + (exchange && selected.size ? ' · เลือกแล้ว ' + selected.size + '/' + exchange : '') : state.canPlay ? advice.message : self?.place ? 'ดูเพื่อนเล่นต่อได้ · พอจบรอบจะแสดงไพ่ที่คุณต้องแลก' : self?.passed ? 'ผ่านแล้วพักกองนี้ · ทุกคนผ่านเมื่อไร คุณกลับมาเล่นกองใหม่ได้' : guide.requirement(state);
      $('slResults').hidden = state.phase !== 'round-end';
      $('slResultEmblem').innerHTML = ownResult ? roleBadge(roles[ownResult.place - 1], ownResult.title) : '';
      $('slResultTitle').textContent = ownResult ? 'อันดับ ' + ownResult.place + ' · คุณเป็น' + ownResult.title : 'จบรอบแล้ว';
      $('slResultNext').textContent = guide.benefit(ownResult?.place);
      $('slRanks').innerHTML = (state.standings || []).map(p => '<div class="sl-rank role-' + roles[p.place - 1] + (p.playerId === playerId ? ' is-self' : '') + '">' + roleBadge(roles[p.place - 1], p.title) + '<span class="sl-rank-place" aria-label="อันดับ ' + p.place + '">' + p.place + '</span><div class="sl-rank-person"><small class="sl-rank-title">' + esc(p.title) + '</small><div class="sl-name">' + esc(p.name) + (p.playerId === playerId ? ' (คุณ)' : '') + '</div></div></div>').join('');
      $('slHistory').innerHTML = (state.history || []).slice(-8).reverse().map(t => '<li>' + esc(t) + '</li>').join('');
      tick(); tools.onState();
    }
    $('slHand').onclick = e => {
      const b = e.target.closest('[data-card]');
      if (!b || pending || (!state.canPlay && !state.self?.exchangeCount)) return;
      const id = Number(b.dataset.card), max = state.self?.exchangeCount || 4;
      if (selected.has(id)) selected.delete(id); else if (selected.size < max) selected.add(id); else return;
      audio.cue('select'); render(state);
    };
    function command(event) {
      if (pending || !socket.connected) return;
      pending = true; $('slError').textContent = ''; render(state);
      socket.timeout(8000).emit(event, { roomId, step: state.step, cardIds: [...selected] }, (err, res) => {
        pending = false;
        if (err || !res?.success) {
          $('slError').textContent = err ? 'เชื่อมต่อไม่สำเร็จ กำลังขอสถานะใหม่' : res?.error || 'ทำรายการไม่สำเร็จ';
          socket.emit('slave_requestState', { roomId });
        }
        render(state);
      });
    }
    $('slPlay').onclick = () => command(state.phase === 'exchange' ? 'slave_exchange' : 'slave_play');
    $('slPass').onclick = () => command('slave_pass');
    $('slNext').onclick = () => command('slave_nextRound');
    $('slClear').onclick = () => { selected.clear(); render(state); };
    $('slHint').onclick = () => {
      selected = new Set(state.self?.exchangeCount ? state.self.hand.slice(0, state.self.exchangeCount).map(c => c.id) : (state.legalMoves?.[0] || []));
      audio.cue('select'); render(state);
    };
    function bind() { if (navigating || tools.isLeaving()) return; socket.emit('initPlayer', playerId); socket.emit('setRoom', { roomId, playerId }); socket.emit('slave_requestState', { roomId }); tools.requestHistory(); }
    socket.on('connect', () => { $('slConnection').textContent = ''; pending = false; bind(); render(state); });
    socket.on('disconnect', () => { $('slConnection').textContent = 'กำลังเชื่อมต่อกลับ…'; pending = false; render(state); });
    socket.on('slaveState', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && socket.connected) bind(); });
    ['redirectToLobby', 'restartGame'].forEach(event => socket.on(event, () => { navigating = true; location.href = '/room/' + roomId + '?playerId=' + encodeURIComponent(playerId); }));
    socket.on('kickedFromRoom', () => { location.href = '/rooms'; });
    function tick() {
      const remaining = state.phaseEndsAt ? Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000)) : 0;
      const timed = ['turn', 'exchange'].includes(state.phase) && state.phaseEndsAt;
      const shown = Math.min(remaining, state.phase === 'exchange' ? 60 : 30);
      $('slClock').textContent = timed ? shown + ' วินาที' : '';
      $('slHandClock').textContent = timed ? ' · ' + shown + ' วิ' : '';
      $('slClock').hidden = !timed;
      const active = state.canPlay || state.self?.exchangeCount;
      const urgent = timed && remaining <= 5;
      $('slClock').classList.toggle('urgent', Boolean(urgent));
      $('slTurnTrack').hidden = !active || !timed;
      $('slTurnTrack').classList.toggle('urgent', Boolean(urgent));
      $('slTurnTrack').style.setProperty('--remaining', Math.min(1, remaining / (state.phase === 'exchange' ? 60 : 30)));
      $('slSeats').style.setProperty('--turn-remaining', Math.min(1, remaining / (state.phase === 'exchange' ? 60 : 30)));
      $('slSeats').classList.toggle('urgent', Boolean(urgent));
      const warningKey = state.round + ':' + state.step + ':' + remaining;
      if (active && urgent && remaining > 0 && warningKey !== warned) { warned = warningKey; audio.cue('warning'); }
    }
    setInterval(tick, 250);
    render(initial);
  };
})(window);
