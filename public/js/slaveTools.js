(function (global) {
  'use strict';
  global.mountSlaveTools = function ({ socket, playerId, roomId, getState, canDebug, audio, onLeaving }) {
    const $ = id => document.getElementById(id);
    let leaving = false, busy = false, unread = 0, debugStep = null;
    const seen = new Set();
    function show(dialog) { if (!dialog.open) dialog.showModal(); }
    function close(dialog) { if (dialog.open) dialog.close(); }
    function error(message) { $('slToolError').textContent = message || ''; }
    // Chat payloads already escape HTML on the server. Decode to text, never insert them as markup.
    function plain(value) { const node = document.createElement('textarea'); node.innerHTML = String(value || ''); return node.value; }
    function message(data, silent) {
      if (data.messageId && seen.has(data.messageId)) return;
      if (data.messageId) seen.add(data.messageId);
      const row = document.createElement('li'), name = document.createElement('strong'), text = document.createElement('span');
      name.textContent = (data.displayName || data.playerName || 'ผู้เล่น') + ': ';
      text.textContent = plain(data.message);
      row.append(name, text); row.className = data.playerId === playerId ? 'is-self' : '';
      $('slChatMessages').append(row);
      while ($('slChatMessages').children.length > 100) { const first = $('slChatMessages').firstElementChild; seen.delete(first.dataset.messageId); first.remove(); }
      row.dataset.messageId = data.messageId || '';
      if ($('slChatDialog').open) row.scrollIntoView({ block: 'nearest' });
      else if (!silent && data.playerId !== playerId) { unread++; $('slChatUnread').textContent = String(unread); $('slChatUnread').hidden = false; }
    }
    socket.on('newMessage', data => message(data, false));
    socket.on('chatHistory', history => { $('slChatMessages').replaceChildren(); seen.clear(); (history || []).slice(-100).forEach(data => message(data, true)); });
    socket.on('chatError', data => { $('slChatError').textContent = data.message || 'ส่งข้อความไม่สำเร็จ'; });
    $('slChat').onclick = () => { show($('slChatDialog')); unread = 0; $('slChatUnread').hidden = true; $('slChatInput').focus(); };
    $('slChatForm').onsubmit = event => {
      event.preventDefault();
      const text = $('slChatInput').value.trim();
      if (!text) return;
      if (text.toLowerCase() === '/m') { $('slChatInput').value = ''; close($('slChatDialog')); openDebug(); return; }
      if (!socket.connected) { $('slChatError').textContent = 'กำลังเชื่อมต่อกลับ ลองส่งอีกครั้ง'; return; }
      socket.emit('sendMessage', { message: text }); $('slChatInput').value = ''; $('slChatError').textContent = '';
    };
    $('slChatInput').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('slChatForm').requestSubmit(); } };
    document.querySelectorAll('[data-sl-close]').forEach(button => { button.onclick = () => close($(button.dataset.slClose)); });
    $('slExit').onclick = () => {
      $('slExitText').textContent = getState().isHost ? 'จบเกมนี้และพาทุกคนกลับห้องรอเดิม รอบที่กำลังเล่นจะหยุด แต่ยังอยู่ห้องเดิมด้วยกัน' : 'ออกจากเกมแล้วกลับห้องรอเดิม โต๊ะสลาฟต้องมี 4 คน รอบที่กำลังเล่นจึงหยุดสำหรับทุกคน';
      show($('slExitDialog'));
    };
    $('slConfirmExit').onclick = () => {
      if (leaving || busy) return;
      if (!socket.connected) { $('slExitError').textContent = 'ยังไม่เชื่อมต่อ กรุณารอแล้วลองอีกครั้ง'; return; }
      busy = true; $('slConfirmExit').disabled = true; $('slExitError').textContent = '';
      socket.timeout(8000).emit(getState().isHost ? 'endTableSession' : 'slave_returnLobby', { roomId }, (err, res) => {
        busy = false; $('slConfirmExit').disabled = false;
        if (err || !res?.success) { $('slExitError').textContent = err ? 'ยังไม่ได้รับคำตอบ ลองอีกครั้ง' : res?.error || 'ออกจากเกมไม่สำเร็จ'; return; }
        leaving = true; onLeaving(); global.location.href = res.roomClosed ? '/rooms' : '/room/' + encodeURIComponent(roomId) + '?playerId=' + encodeURIComponent(playerId);
      });
    };
    function paintDebug(data) {
      $('slDebugHands').replaceChildren();
      if (!$('slPeekHands').checked) return;
      for (const p of data.hands || []) {
        const row = document.createElement('div'), name = document.createElement('strong'), hand = document.createElement('div');
        name.textContent = p.name + ' · ' + p.cards.length + ' ใบ'; row.append(name, hand);
        for (const c of p.cards) { const card = document.createElement('span'); card.className = 'sl-debug-card' + (c.red ? ' red' : ''); card.textContent = c.label; hand.append(card); }
        $('slDebugHands').append(row);
      }
    }
    function enableDebugActions() {
      const phase = getState().phase;
      $('slDebugDialog').querySelectorAll('[data-sl-debug]').forEach(button => {
        const action = button.dataset.slDebug;
        button.disabled = busy || (['auto', 'finish'].includes(action) && !['turn', 'exchange'].includes(phase)) || (action === 'next' && phase !== 'round-end') || (action === 'exchange' && phase !== 'exchange');
      });
    }
    function debug(action = 'inspect') {
      if (busy) return;
      if (!socket.connected) { error('กำลังเชื่อมต่อกลับ'); return; }
      busy = true; error('');
      const step = getState().step;
      $('slDebugDialog').querySelectorAll('[data-sl-debug]').forEach(b => { b.disabled = true; });
      socket.timeout(8000).emit('slave_debug', { roomId, action, step }, (err, res) => {
        busy = false; enableDebugActions();
        if (err || !res?.success) { error(err ? 'เมนูทดสอบไม่ได้รับคำตอบ' : res?.error); return; }
        debugStep = res.step; paintDebug(res); $('slDebugNote').textContent = action === 'inspect' ? 'สถานะ: ' + res.phase : 'ทำรายการแล้ว · ' + res.phase;
      });
    }
    function openDebug() {
      if (!canDebug) { show($('slDebugDialog')); error('/m ใช้ได้เฉพาะหัวห้องหรือแอดมินบน staging'); return; }
      show($('slDebugDialog')); debug();
    }
    $('slDebug').hidden = !canDebug; $('slDebug').onclick = openDebug;
    $('slDebugActions').hidden = !canDebug;
    $('slPeekHands').onchange = () => { if (!$('slPeekHands').checked) $('slDebugHands').replaceChildren(); else debug(); };
    document.querySelectorAll('[data-sl-debug]').forEach(button => { button.onclick = () => {
      const action = button.dataset.slDebug;
      if (action === 'restart') { show($('slRestartDialog')); return; }
      debug(action);
    }; });
    $('slConfirmRestart').onclick = () => { close($('slRestartDialog')); debug('restart'); };
    document.querySelectorAll('[data-sl-cue]').forEach(button => { button.onclick = async () => { audio.setEnabled(true); if (await audio.unlock()) audio.cue(button.dataset.slCue); }; });
    return {
      isLeaving: () => leaving,
      onState: () => { $('slDebugUsed').hidden = !getState().debugUsed; if ($('slDebugDialog').open && canDebug && debugStep !== getState().step) debug(); },
      requestHistory: () => socket.emit('requestChatHistory', { roomId })
    };
  };
})(window);
