(function (global) {
  'use strict';
  global.mountSlaveBoard = function ({ playerId, roomId, initial }) {
    const $ = id => document.getElementById(id);
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const titles = ['คิง', 'ควีน', 'รองสลาฟ', 'สลาฟ'];
    const socket = global.io(), guide = global.SlaveGuide;
    let state = initial, selected = new Set(), pending = false, last = null, handKey = '', pileKey = '', warned = '';
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
    function card(c, button, index, count) {
      const tag = button ? 'button' : 'div';
      return '<' + tag + (button ? ' type="button" data-card="' + c.id + '" aria-label="' + esc(c.label) + '" aria-pressed="false"' : ' aria-label="' + esc(c.label) + '"') +
        ' class="sl-card ' + (c.red ? 'red' : '') + '" style="--i:' + index + ';--fan:' + (index - (count - 1) / 2) + '">' +
        '<span class="sl-corner">' + esc(c.rank) + '<small>' + esc(c.suit) + '</small></span><span class="sl-pip" aria-hidden="true">' + esc(c.suit) + '</span><span class="sl-corner bottom" aria-hidden="true">' + esc(c.rank) + '<small>' + esc(c.suit) + '</small></span></' + tag + '>';
    }
    function avatar(value) {
      const text = String(value || '♠');
      if (/^(https:\/\/|\/[^/])/.test(text)) return '<img src="' + esc(text) + '" alt="" referrerpolicy="no-referrer">';
      return esc(text);
    }
    function seats() {
      const selfIndex = state.seats.findIndex(p => p.playerId === playerId);
      const ordered = [...state.seats.slice(selfIndex), ...state.seats.slice(0, selfIndex)];
      const positions = ['self', 'left', 'top', 'right'];
      $('slSeats').innerHTML = ordered.map((p, i) => {
        const self = p.playerId === playerId, turn = p.playerId === state.turnId && state.phase === 'turn';
        const label = p.place ? titles[p.place - 1] : p.passed ? 'ผ่านแล้ว' : turn ? (self ? 'ตาคุณ' : 'กำลังคิด…') : !p.online && !p.isBot ? 'รอเชื่อมต่อ' : p.title || (p.isBot ? 'บอท' : 'พร้อมเล่น');
        const backs = !self && !p.place ? '<div class="sl-backs" aria-hidden="true">' + Array.from({ length: Math.min(p.count, 8) }, (_, j) => '<i class="sl-back" style="--r:' + (j - Math.min(p.count, 8) / 2) * 3 + 'deg"></i>').join('') + '</div>' : '';
        return '<div class="sl-seat seat-' + positions[i] + (turn ? ' turn' : '') + (p.passed ? ' passed' : '') + '"' + (turn ? ' aria-current="true"' : '') + '><div class="sl-avatar" aria-hidden="true">' + avatar(p.avatar) + '</div><div class="sl-seat-info"><div class="sl-name">' + esc(self ? 'คุณ · ' + p.name : p.name) + '</div><span class="sl-seat-label">' + esc(label) + '</span>' + (self ? '' : '<span class="sl-count"><strong>' + p.count + '</strong> ใบ</span>') + '</div>' + backs + '</div>';
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
      $('slResultTitle').textContent = ownResult ? 'อันดับ ' + ownResult.place + ' · คุณเป็น' + ownResult.title : 'จบรอบแล้ว';
      $('slResultNext').textContent = guide.benefit(ownResult?.place);
      $('slRanks').innerHTML = (state.standings || []).map(p => '<div class="sl-rank' + (p.playerId === playerId ? ' is-self' : '') + '"><span class="sl-rank-place">' + p.place + '</span><div><div class="sl-name">' + esc(p.name) + (p.playerId === playerId ? ' (คุณ)' : '') + '</div><small>' + esc(p.title) + '</small></div></div>').join('');
      $('slHistory').innerHTML = (state.history || []).slice(-8).reverse().map(t => '<li>' + esc(t) + '</li>').join('');
      tick();
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
    function bind() { socket.emit('initPlayer', playerId); socket.emit('setRoom', { roomId, playerId }); socket.emit('slave_requestState', { roomId }); }
    socket.on('connect', () => { $('slConnection').textContent = ''; pending = false; bind(); render(state); });
    socket.on('disconnect', () => { $('slConnection').textContent = 'กำลังเชื่อมต่อกลับ…'; pending = false; render(state); });
    socket.on('slaveState', render);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && socket.connected) bind(); });
    ['redirectToLobby', 'restartGame'].forEach(event => socket.on(event, () => { location.href = '/room/' + roomId; }));
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
      const warningKey = state.round + ':' + state.step + ':' + remaining;
      if (active && urgent && remaining > 0 && warningKey !== warned) { warned = warningKey; audio.cue('warning'); }
    }
    setInterval(tick, 250);
    render(initial);
  };
})(window);
