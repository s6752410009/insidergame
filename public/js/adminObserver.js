(function () {
  'use strict';
  const roomId = document.querySelector('script[data-room-id]').dataset.roomId;
  const $ = id => document.getElementById(id), socket = window.io();
  let busy = false, debugStep = null, messagesKey = '';
  function plain(value) { const el = document.createElement('textarea'); el.innerHTML = String(value || ''); return el.value; }
  function list(id, rows) { $(id).replaceChildren(...rows.map(text => { const li = document.createElement('li'); li.textContent = text; return li; })); }
  function chats(rows) {
    const key = JSON.stringify(rows);
    if (key === messagesKey) return;
    messagesKey = key;
    const el = $('observerChat'), atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    list('observerChat', rows.slice(-100).map(m => plain(m.displayName || m.playerName) + ': ' + plain(m.message)));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function refresh() {
    if (!socket.connected || busy) return;
    busy = true;
    socket.timeout(5000).emit('admin_observeRoom', { roomId }, (error, result) => {
      busy = false;
      if (error || !result?.success) { $('observerStatus').textContent = result?.error || 'เชื่อมต่อไม่สำเร็จ กำลังลองใหม่'; return; }
      $('observerStatus').textContent = 'กำลังดูแบบ Ghost · ผู้เล่น ' + result.room.totalPlayerCount + '/' + result.room.settings.maxPlayers;
      $('observerPhase').textContent = result.room.gameModeLabel + ' · ' + (result.game.phase || 'รอผู้เล่น') + (result.game.round ? ' · รอบ ' + result.game.round : '');
      list('observerPlayers', (result.slave?.seats || result.room.players).map(p => (p.name || p.displayName || p.playerName) + (p.count !== undefined ? ' · ไพ่ ' + p.count + ' ใบ' : '') + (p.place ? ' · อันดับ ' + p.place : '') + (p.playerId === result.slave?.turnId ? ' · กำลังเล่น' : '')));
      $('observerPile').textContent = result.slave?.top ? 'กองกลาง: ' + result.slave.top.cards.map(c => c.label).join(' ') : '';
      list('observerHistory', result.game.history);
      chats(result.chat);
      if (result.slave && debugStep !== null && debugStep !== result.slave.step) { $('observerDebug').hidden = true; debugStep = null; }
    });
  }
  socket.on('connect', refresh);
  socket.on('disconnect', () => { $('observerStatus').textContent = 'หลุดการเชื่อมต่อ กำลังเชื่อมต่อกลับ…'; });
  socket.on('newMessage', refresh);
  socket.on('roomUpdate', refresh);
  socket.on('roomClosed', () => { $('observerStatus').textContent = 'ห้องปิดแล้ว'; });
  $('observerForm').onsubmit = event => {
    event.preventDefault();
    const message = $('observerInput').value.trim();
    if (!message || !socket.connected) return;
    const button = $('observerForm').querySelector('button'); button.disabled = true;
    socket.timeout(5000).emit('admin_observerMessage', { roomId, message }, (error, result) => {
      button.disabled = false;
      $('observerError').textContent = error ? 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง' : result?.success ? '' : result?.error || 'ส่งไม่สำเร็จ';
      if (!error && result?.success) {
        $('observerInput').value = '';
        if (result.debug) {
          debugStep = result.debug.step;
          $('observerDebug').hidden = false; $('observerDebug').open = true;
          $('observerHands').replaceChildren(...result.debug.hands.map(p => { const row = document.createElement('p'); row.textContent = p.name + ': ' + p.cards.map(c => c.label).join(' '); return row; }));
        }
        refresh();
      }
    });
  };
  setInterval(refresh, 2000);
})();
