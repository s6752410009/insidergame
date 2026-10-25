require('./isolateTestData');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');
const E = require('../games/slaveEngine'), D = require('../games/slaveDebug');
let checks = 0, server, browser, clients = [];
const ok = (v, label) => { assert.ok(v, label); checks++; };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await delay(30); } throw new Error('Timeout: ' + label); }
const ack = (s, e, d) => new Promise((resolve, reject) => s.timeout(8000).emit(e, d, (err, res) => err ? reject(err) : resolve(res)));
async function selectGuidedMove(page) {
  for (let n = 0; n < 4 && !await page.locator('#slPlay').isEnabled(); n++) {
    const next = page.locator('#slHand [data-playable="true"][aria-pressed="false"]').first();
    ok(await next.count() === 1, 'live card guide offers a compatible next card');
    await next.click();
  }
  ok(await page.locator('#slPlay').isEnabled(), 'live card guidance completes a legal selection');
}
function invariant(room) { const ids = [...room.gameState.played, ...room.gameState.seats.flatMap(p => p.hand)]; ok(ids.length === 52 && new Set(ids).size === 52, 'debug preserves the complete unique deck'); }
function watchDebugRequests(page) {
  const sent = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    if (typeof frame.payload === 'string' && frame.payload.includes('"slave_debug"')) sent.push(frame.payload);
  }));
  return sent;
}
async function deniedSlashCommand(page, sent, label) {
  ok(await page.locator('#slDebug').isHidden() && await page.locator('#slDebugDock').isHidden(), label + ' starts without debug UI');
  ok(sent.length === 0, label + ' ordinary play sends no private inspect request');
  await page.locator('#slChat').click();
  await page.locator('#slChatInput').fill('/m'); await page.locator('#slChatInput').press('Enter');
  await page.waitForFunction(() => Boolean(document.getElementById('slChatError').textContent.trim()));
  ok(await page.locator('#slChatDialog').isVisible(), label + ' denial stays in chat');
  ok(await page.locator('#slChatError').isVisible(), label + ' denial explains why the command is unavailable');
  ok(await page.locator('#slDebug').isHidden() && await page.locator('#slDebugDock').isHidden(), label + ' denied command reveals no debug UI');
  ok(await page.locator('.sl-revealed-card').count() === 0, label + ' denied command reveals no private cards');
  ok(sent.length === 0, label + ' denied command sends no debug request');
  await page.locator('[data-sl-close="slChatDialog"]').click();
}
function engineChecks() {
  const room = { admin: 'p0', players: Array.from({ length: 4 }, (_, i) => ({ playerId: 'p' + i, socketId: 's' + i })) };
  E.startGame(room); invariant(room);
  const before = JSON.stringify(room.gameState);
  assert.throws(() => D.run(room, 'p0', 'auto', -1)); ok(JSON.stringify(room.gameState) === before, 'stale debug cannot mutate');
  assert.throws(() => D.run(room, 'p0', 'unknown', room.gameState.step));
  for (const action of ['auto', 'finish', 'next', 'exchange', 'restart']) {
    const step = room.gameState.step; D.run(room, 'p0', action, step); invariant(room); ok(room.gameState.step > step, 'monotonic debug step: ' + action);
  }
  ok(room.gameState.round === 1 && room.gameState.debugUsed, 'restart redeals a marked debug round');
  ok(!JSON.stringify(E.buildClientState(room, 'p1').seats).includes('hand'), 'normal payload never gains debug hands');
}
async function runEnvironment(env, port) {
  const base = 'http://127.0.0.1:' + port; let logs = '';
  server = spawn(process.execPath, ['app.js'], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, PORT: String(port), APP_ENV: env, MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1', SLAVE_BOT_MS: '60000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', c => { logs += c; }); server.stderr.on('data', c => { logs += c; });
  await wait(() => logs.includes('Server started on port ' + port), 'server startup');
  async function client() {
    const id = randomUUID(), socket = io(base, { transports: ['websocket'], forceNew: true }); clients.push(socket);
    await wait(() => socket.connected, 'socket connect'); socket.emit('initPlayer', id); await delay(180);
    const c = { id, socket, messages: [], states: [] };
    socket.on('slaveState', s => { c.state = s; c.states.push(s); }); socket.on('newMessage', m => c.messages.push(m)); return c;
  }
  const host = await client(), guest = await client(), outsider = await client();
  const created = await ack(host.socket, 'createRoom', { playerId: host.id, gameMode: 'slave', name: 'Slave tools ' + env, maxPlayers: 4 }); ok(created.success, 'create test room');
  const roomId = created.roomId; host.socket.emit('setRoom', { roomId, playerId: host.id });
  ok((await ack(guest.socket, 'joinRoom', { roomId, playerId: guest.id })).success, 'join second human');
  guest.socket.emit('setRoom', { roomId, playerId: guest.id }); await delay(200);
  ok((await ack(host.socket, 'slave_addBots', { roomId, count: 2 })).added === 2, 'fill two bots');
  ok((await ack(host.socket, 'startGameFromLobby', { roomId })).success, 'start tools test');
  await wait(() => host.state?.phase === 'turn' && guest.state?.phase === 'turn', 'dealt');
  ok(!(await ack(outsider.socket, 'slave_returnLobby', { roomId, playerId: host.id })).success, 'outsider cannot stop table or forge exit');
  ok(!(await ack(outsider.socket, 'slave_debug', { roomId, action: 'inspect', playerId: host.id })).success, 'outsider cannot forge debug host');
  ok(!(await ack(guest.socket, 'slave_debug', { roomId, action: 'inspect', playerId: host.id })).success, 'member cannot forge debug host');
  const reveal = await ack(host.socket, 'slave_debug', { roomId, action: 'inspect' });
  if (env !== 'staging') {
    ok(!reveal.success && !reveal.hands, 'production denies host debug and reveals no hands');
    const before = host.state.step;
    ok(!(await ack(host.socket, 'slave_debug', { roomId, action: 'finish', step: before })).success, 'production denies mutating debug');
    await delay(100); ok(host.state.step === before, 'production denied mutation preserves state');
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
    const sent = watchDebugRequests(page);
    await page.goto(base + '/game/' + roomId + '?playerId=' + host.id); await page.waitForSelector('#slHand .sl-card');
    await deniedSlashCommand(page, sent, 'production host');
    await delay(100); ok(!guest.messages.some(m => m.message === '/m'), 'production slash command is never broadcast to another player');
    await context.close();
  } else {
    ok(reveal.success && reveal.hands.length === 4 && reveal.hands.every(p => p.cards.length === 13), 'host-only inspect gets all 52 cards');
    ok(guest.states.every(s => s.seats.every(p => !p.hand && !p.cards)), 'guest normal stream has no private debug hands');
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
    const sent = watchDebugRequests(page);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/game/' + roomId + '?playerId=' + host.id); await page.waitForSelector('#slHand .sl-card');
    ok(await page.locator('#slDebug').isHidden() && await page.locator('#slDebugDock').isHidden(), 'authorized staging host still starts without debug UI');
    ok(sent.length === 0, 'authorized staging host sends no debug requests before slash command');
    ok(!(await page.locator('#slChatInput').getAttribute('placeholder')).includes('/m'), 'normal chat does not advertise debug command');
    await page.locator('#slChat').click(); ok(await page.locator('#slChatDialog').isVisible(), 'real chat dialog opens');
    const text = '<img src=x onerror=alert(1)> แชทสลาฟ ' + randomUUID();
    await page.locator('#slChatInput').fill(text); await page.locator('#slChatInput').press('Enter');
    await wait(() => guest.messages.some(m => m.message.includes('แชทสลาฟ')), 'chat delivered to other human');
    await wait(async () => (await page.locator('#slChatMessages').innerText()).includes(text), 'chat rendered as literal text');
    ok(await page.locator('#slChatMessages img').count() === 0, 'chat XSS payload creates no executable markup');
    await page.locator('[data-sl-close="slChatDialog"]').click();
    guest.socket.emit('sendMessage', { message: 'ข้อความตอนปิดแชท' });
    await wait(async () => await page.locator('#slChatUnread').isVisible(), 'unread notification');
    await page.locator('#slChat').click(); ok(await page.locator('#slChatUnread').isHidden(), 'opening chat clears unread');
    await page.locator('#slChatInput').fill('/m'); await page.locator('#slChatInput').press('Enter');
    ok(await page.locator('#slDebugDock').isVisible(), 'slash command opens debug menu');
    ok(await page.locator('#slDebug').isVisible(), 'authorized slash command reveals header toggle');
    await wait(() => sent.length > 0, 'authorized command inspects debug state');
    ok(!guest.messages.some(m => m.message === '/m'), 'slash command never enters room chat');
    await page.locator('#slPeekHands').check(); await wait(async () => await page.locator('.sl-revealed-card').count() === 39, 'private opponent faces render at their seats');
    ok(await page.locator(':modal').count() === 0, 'debug leaves table interactive with no modal');
    for (let n=0;n<80;n++) {
      if (guest.state.turnId===host.id) {
        await wait(async()=>await page.locator('#slHand [data-playable="true"]').count()||await page.locator('#slPass').isEnabled(),'human UI catches up');
        if (await page.locator('#slHand [data-playable="true"]').count()) break;
        const step=guest.state.step; await page.locator('#slPass').click(); await wait(()=>guest.state.step>step,'normal pass while debug open');
      } else {
        const step=guest.state.step;
        ok((await ack(host.socket,'slave_debug',{roomId,action:'auto',step})).success,'advance to playable human turn');
        await wait(()=>guest.state.step>step,'updated debug turn');
      }
    }
    ok(await page.locator('#slHint').count() === 0, 'obsolete select-set button is absent');
    await selectGuidedMove(page);
    const ownCount=await page.locator('#slHand .sl-card').count();
    await page.locator('#slPlay').click();
    await wait(async()=>await page.locator('#slHand .sl-card').count()<ownCount,'normal human play while debug tools are open');
    ok(await page.locator('#slDebugDock').isVisible(), 'normal play keeps nonmodal debug tools open');
    await wait(async()=>await page.locator('.sl-revealed-card').count()>0,'fresh private faces after normal play');
    const facesBeforeFold=await page.locator('.sl-revealed-card').count();
    await page.locator('#slDebugFold').click();
    ok(await page.locator('.sl-revealed-card').count()===facesBeforeFold, 'fold preserves visible opponent faces');
    const autoStep=guest.state.step;
    ok((await ack(host.socket,'slave_debug',{roomId,action:'auto',step:autoStep})).success,'other player advances while folded');
    await wait(()=>guest.state.step>autoStep,'other player state');
    await wait(async()=>await page.locator('.sl-revealed-card').count()===guest.state.seats.filter(p=>p.playerId!==host.id).reduce((n,p)=>n+p.count,0),'private revealed counts update while folded');
    await context.setOffline(true); await wait(async()=>await page.locator('.sl-revealed-card').count()===0,'disconnect clears cached private faces');
    await context.setOffline(false); await wait(async()=>await page.locator('.sl-revealed-card').count()>0,'reconnect refreshes revealed hands');
    await page.locator('#slDebug').click();
    for (const action of ['auto', 'finish', 'next', 'exchange']) {
      const before = guest.state.step;
      await page.locator('[data-sl-debug="' + action + '"]').click();
      await wait(() => guest.state.step > before, 'debug UI command ' + action);
      ok(guest.state.debugUsed, 'public test marker after ' + action);
    }
    ok(guest.state.phase === 'turn' && guest.state.round === 2, 'next round and automatic exchange finish');
    await page.locator('[data-sl-debug="restart"]').click();
    ok(await page.locator('#slRestartDialog').isVisible(), 'redeal asks before discarding round');
    await page.locator('[data-sl-close="slRestartDialog"]').click(); ok(guest.state.round === 2, 'cancel redeal preserves round');
    await page.locator('[data-sl-debug="restart"]').click(); await page.locator('#slConfirmRestart').click();
    await wait(() => guest.state.round === 1, 'confirmed redeal');
    await page.locator('#slDebugFold').click();
    const beforeReload = sent.length;
    await page.reload(); await page.waitForSelector('#slHand .sl-card');
    ok(await page.locator('#slDebug').isHidden() && await page.locator('#slDebugDock').isHidden(), 'reload clears debug unlock and keeps tools hidden');
    ok(await page.locator('.sl-revealed-card').count() === 0, 'reload restores concealed opponent hands');
    ok(sent.length === beforeReload, 'reload sends no automatic debug inspect request');
    await page.locator('#slChat').click(); await wait(async () => (await page.locator('#slChatMessages').innerText()).includes(text), 'chat history after reload');
    await page.locator('[data-sl-close="slChatDialog"]').click();
    // A non-host returns to this lobby without losing membership or being redirected into the board.
    const guestContext = await browser.newContext({ viewport: { width: 375, height: 667 } }), guestPage = await guestContext.newPage();
    const guestSent = watchDebugRequests(guestPage);
    await guestPage.goto(base + '/game/' + roomId + '?playerId=' + guest.id); await guestPage.waitForSelector('#slHand .sl-card');
    ok(await guestPage.locator('#slDebug').isHidden(), 'non-host has no debug shortcut');
    await deniedSlashCommand(guestPage, guestSent, 'non-host staging member');
    await delay(100); ok(!host.messages.some(m => m.message === '/m'), 'non-host slash command is never broadcast to another player');
    await guestPage.locator('#slExit').click(); await guestPage.locator('[data-sl-close="slExitDialog"]').click();
    ok(guestPage.url().includes('/game/'), 'cancel exit stays in game');
    await guestPage.locator('#slExit').click(); await guestPage.locator('#slConfirmExit').click();
    await guestPage.waitForURL('**/room/' + roomId + '**'); ok(true, 'non-host exit reaches same lobby');
    await guestPage.reload(); ok(guestPage.url().includes('/room/' + roomId), 'lobby reload does not bounce into game');
    await page.locator('#slExit').click(); await page.locator('#slConfirmExit').click();
    await page.waitForURL('**/room/' + roomId + '**'); ok(true, 'host exit returns to same lobby');
    ok(errors.length === 0, 'no browser errors: ' + errors.join('; '));
    await context.close(); await guestContext.close();
  }
  clients.forEach(s => s.disconnect()); clients = [];
  server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); server = null;
}
(async () => { engineChecks(); browser = await chromium.launch(); await runEnvironment('staging', 8488); await runEnvironment('production', 8489); console.log('Slave tools: ' + checks + ' checks passed · chat/history/XSS/unread, private /m, host/non-host exit, debug deck invariants, staging authorization and production denial'); })()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { clients.forEach(s => s.disconnect()); await browser?.close(); server?.kill('SIGTERM'); });
