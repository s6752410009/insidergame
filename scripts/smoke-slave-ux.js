/* Deterministic rule/viewport fixtures use real engine payloads and the actual EJS/CSS/client. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ejs = require('ejs'), { chromium } = require('playwright');
const engine = require('../games/slaveEngine'), guide = require('../public/js/slaveGuide');
const root = path.join(__dirname, '..'), shots = fs.mkdtempSync(path.join(os.tmpdir(), 'slave-ux-'));
const titles = ['คิง', 'ควีน', 'รองสลาฟ', 'สลาฟ'];
let checks = 0, browser;
const ok = (value, label) => { assert.ok(value, label); checks++; };
function room() {
  const r = { roomId: 'ux-fixture', admin: 'p0', players: Array.from({ length: 4 }, (_, i) => ({ playerId: 'p' + i, playerName: ['คุณทดสอบ', 'สมหญิง', 'สมศักดิ์', 'วิชัย'][i], avatar: ['👤', '👻', '🦊', '🐼'][i], socketId: 's' + i })) };
  engine.startGame(r, () => .999);
  return r;
}
const clone = value => JSON.parse(JSON.stringify(value));
const initialRoom = room(), opening = engine.buildClientState(initialRoom, 'p0');
function state(overrides) { return { ...clone(opening), ...overrides }; }
function cards(ids) { return ids.map(engine.describeCard); }
function turnFixture(hand, top, moves) {
  return state({ openingRequired: false, top: { playerId: 'p1', cards: cards(top) }, self: { hand: cards(hand), exchangeCount: 0 }, legalMoves: moves, canPlay: true, canPass: true });
}
const pair = turnFixture([8, 9, 10, 12, 13, 16, 17, 18, 19, 24, 28, 40, 44], [4, 5], [[8, 9], [8, 10], [9, 10], [12, 13], [16, 17], [16, 18], [16, 19], [17, 18], [17, 19], [18, 19], [16, 17, 18, 19]]);
const noMove = turnFixture([0, 4, 8], [51], []);
const weakPair = turnFixture([0, 1, 8, 9], [4, 5], [[8, 9]]);
const cut = turnFixture([8, 9, 10, 12], [51], [[8, 9, 10]]);
const endRoom = room();
endRoom.gameState.phase = 'round-end';
endRoom.gameState.standings = endRoom.gameState.seats.map((p, i) => ({ playerId: p.playerId, name: p.name, place: i + 1, title: titles[i] }));
endRoom.gameState.finishOrder = ['p0', 'p1', 'p2', 'p3'];
endRoom.gameState.seats.forEach((p, i) => { p.title = titles[i]; });
endRoom.gameState.turnId = null; endRoom.gameState.phaseEndsAt = null;
const ended = [0, 1, 2, 3].map(i => engine.buildClientState(endRoom, 'p' + i));
engine.nextRound(endRoom, 'p0');
const exchanging = [0, 1, 2, 3].map(i => engine.buildClientState(endRoom, 'p' + i));

function ruleChecks() {
  ok(opening.openingRequired, 'opening requirement is explicit in engine payload');
  ok(guide.analyze(opening, [4]).message.includes('3♣'), 'wrong opening explains 3 clubs');
  ok(!guide.analyze(opening, [4]).legal, 'wrong opening not legal');
  ok(guide.analyze(opening, [0]).legal, 'single 3 clubs opening allowed');
  ok(guide.analyze(opening, [0, 1, 2, 3]).legal, 'four 3s opening allowed');
  ok(guide.analyze(opening, [0, 4]).message.includes('หลายหน้า'), 'mixed ranks explained');
  ok(!guide.analyze(pair, [8]).legal && guide.analyze(pair, [8]).message.includes('อีก 1'), 'partial pair tells how to complete it');
  ok(guide.analyze(pair, [8]).candidates.includes(9) && !guide.analyze(pair, [8]).candidates.includes(12), 'only compatible next cards highlighted');
  ok(guide.analyze(pair, [8, 9]).label === 'ลงคู่ 5 →', 'legal button identifies the set');
  ok(guide.analyze(cut, [8, 9]).message.includes('อีก 1'), 'triple cut explains third card');
  ok(guide.analyze(cut, [8, 9, 10]).legal, 'triple beats single 2 spades');
  ok(guide.analyze(noMove, []).message.includes('ผ่าน'), 'no-move instruction is actionable');
  for (let i = 0; i < 4; i++) {
    ok(guide.benefit(i + 1).includes(i === 0 || i === 3 ? '2 ใบ' : '1 ใบ'), 'rank-specific next-round consequence ' + i);
    ok(guide.exchange(exchanging[i], 'p' + i).includes(i < 2 ? 'เลือก' : 'อัตโนมัติ'), 'exchange explains manual/automatic action ' + i);
  }
  ok(exchanging[0].exchangeProgress.done === 0, 'public exchange progress starts empty');
  engine.exchangeCards(endRoom, 'p0', endRoom.gameState.seats[0].hand.slice(0, 2), endRoom.gameState.step);
  const submitted = engine.buildClientState(endRoom, 'p0');
  ok(submitted.exchangeProgress.done === 1 && !submitted.self.exchangeCount, 'own submitted exchange is visible');
  ok(guide.exchange(submitted, 'p0').includes('เรียบร้อย'), 'submitted exchange says wait for other player');
  ok(!JSON.stringify(submitted).includes('returns'), 'exchange progress never reveals returned cards');
  // Compare against the engine over a full real round, including each legal partial set.
  const r = room();
  let steps = 0;
  while (r.gameState.phase === 'turn' && steps++ < 1000) {
    const id = r.gameState.turnId, s = engine.buildClientState(r, id);
    for (const move of s.legalMoves) {
      ok(guide.analyze(s, move).legal, 'every engine-authorized set is accepted by guide');
      for (let n = 0; n < move.length; n++) {
        const advice = guide.analyze(s, move.slice(0, n));
        ok(advice.candidates.includes(move[n]), 'every legal completion remains selectable');
      }
    }
    if (s.legalMoves.length) engine.playCards(r, id, s.legalMoves[0], s.step);
    else engine.passTurn(r, id, s.step);
  }
  ok(r.gameState.phase === 'round-end', 'guide checked through a complete engine round');
}
function markup(payload, id) {
  const template = fs.readFileSync(path.join(root, 'views/slaveBoard.ejs'), 'utf8');
  const body = ejs.render(template, { contentFor: () => '', slaveDebugAllowed: true, room: initialRoom, playerInfo: { playerId: id }, slaveState: payload, safeJson: v => JSON.stringify(v).replace(/</g, '\\u003c') });
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="content">' + body + '</body></html>';
}
const mockSocket = `window.__commands=[];window.__socket={connected:true,handlers:{},on(e,fn){this.handlers[e]=fn;return this},emit(e,data,cb){window.__commands.push({event:e,data});if(cb)cb(null,{success:true})},timeout(){return this}};window.io=()=>window.__socket;const emit=window.__socket.emit;window.__socket.emit=function(e,data,cb){if(e==='slave_debug'){window.__commands.push({event:e,data});const s=window.__debugState;cb(null,{success:true,step:s.step,phase:s.phase,hands:s.seats.map(p=>({playerId:p.playerId,name:p.name,cards:window.__fixtureHands.find(h=>h.playerId===p.playerId).cards.slice(0,p.count)}))});return;}return emit.call(this,e,data,cb)};`;
async function fixture(page, payload, id = 'p0') {
  await page.route('**/*', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: markup(payload, id) });
    if (pathname === '/socket.io/socket.io.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.__debugState=' + JSON.stringify(payload) + ';window.__fixtureHands=' + JSON.stringify(initialRoom.gameState.seats.map(p => ({playerId:p.playerId,cards:p.hand.map(engine.describeCard)}))) + ';' + mockSocket });
    if (pathname.startsWith('/static/')) {
      const file = path.join(root, 'public', pathname.slice(8));
      return route.fulfill({ contentType: file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file) });
    }
    return route.fulfill({ contentType: 'text/css', body: '' });
  });
  await page.goto('http://slave.test/');
  await page.waitForSelector('#slHand .sl-card');
}
async function deliver(page, payload) {
  await page.evaluate(s => { window.__debugState = s; window.__socket.handlers.slaveState(s); }, payload);
}
async function geometry(page, label) {
  const result = await page.evaluate(() => {
    const ids = ['slStatus', 'slActionHelp', 'slHand', 'slPlay', 'slPass', 'slClear', 'slNext'];
    const rects = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      rects.push({ id, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    }
    const cards = [...document.querySelectorAll('#slHand .sl-card')].filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect(); return { id: el.dataset.card, x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    });
    const clippedInk = [...document.querySelectorAll('#slHand .sl-card')].filter(el => el.getClientRects().length).flatMap(el => {
      const card = el.getBoundingClientRect();
      return [...el.querySelectorAll('.sl-corner,.sl-pip')].filter(ink => ink.getClientRects().length).map(ink => ({card,ink:ink.getBoundingClientRect()})).filter(({card:c,ink:i})=>i.left<c.left-1||i.right>c.right+1||i.top<c.top-1||i.bottom>c.bottom+1).map(()=>el.dataset.card);
    });
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const backs = [...document.querySelectorAll('.sl-backs')].filter(visible).map(el => {
      const count = Number(el.dataset.cardCount), r = el.getBoundingClientRect();
      return { count, drawn: el.querySelectorAll('.sl-back,.sl-revealed-card').length, x: r.x, right: r.right, y: r.y, bottom: r.bottom, hidden: [...el.children].some(c => !visible(c)), privateFaces: el.querySelectorAll('[data-card],.sl-corner,.sl-pip').length };
    });
    const ranks = [...document.querySelectorAll('#slRanks .sl-rank')].filter(visible).map(el => {
      const r = el.getBoundingClientRect(); return { x:r.x,right:r.right,y:r.y,bottom:r.bottom };
    });
    const clippedText = [...document.querySelectorAll('#slStatus,#slActionHelp,#slPileText')].filter(visible).filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map(el => el.id);
    const ordinaryNames = document.querySelector('.slave').classList.contains('has-revealed-hands') ? [] : [...document.querySelectorAll('#slSeats .sl-name')].filter(visible).map(el => ({ text: el.textContent, size: parseFloat(getComputedStyle(el).fontSize) }));
    const arena = document.querySelector('.sl-arena').getBoundingClientRect(), zone = document.getElementById('slPlayerZone').getBoundingClientRect();
    const self = document.querySelector('.seat-self'), status = document.getElementById('slStatus');
    const compactLandscape = innerWidth > innerHeight && innerHeight <= 540;
    const proximity = compactLandscape ? null : { tableToTray: zone.top - arena.bottom, selfToStatus: self && visible(self) ? status.getBoundingClientRect().top - self.getBoundingClientRect().bottom : null };
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, rects, cards, clippedInk, clippedText, ordinaryNames, proximity, backs, ranks };
  });
  ok(!result.overflow, label + ' has no horizontal overflow');
  ok(!result.clippedText.length, label + ' status, action help and pile caption are not clipped: ' + result.clippedText.join(','));
  if (result.proximity) {
    ok(result.proximity.tableToTray <= 24, label + ' hand tray stays close to the table: ' + result.proximity.tableToTray);
    if (result.proximity.selfToStatus !== null) ok(result.proximity.selfToStatus <= 40, label + ' own turn status stays close to own seat: ' + result.proximity.selfToStatus);
  }
  const nameMinimum = result.width > 820 && result.height > 540 ? 15 : 10;
  for (const name of result.ordinaryNames) ok(name.size >= nameMinimum, label + ' readable player name ' + name.size + 'px: ' + name.text);
  ok(!result.clippedInk.length, label + ' ranks and suits stay inside card faces: ' + result.clippedInk.join(','));
  if (!label.includes('round end') && !label.includes('result')) ok(result.backs.length === 3, label + ' all three opponent hands visible, including top');
  for (const b of result.backs) {
    ok(b.count === b.drawn && !b.hidden, label + ' exactly one visible back per public card: ' + JSON.stringify(b));
    ok(!b.privateFaces, label + ' opponent backs contain no card faces or ids');
    ok(b.x >= -1 && b.right <= result.width + 1 && b.y >= -1 && b.bottom <= result.height + 1, label + ' opponent hand within screen: ' + JSON.stringify(b));
  }
  for (const r of result.ranks) ok(r.x >= 0 && r.right <= result.width && r.y >= 0 && r.bottom <= result.height, label + ' rank award visible: ' + JSON.stringify(r));
  for (const r of [...result.rects, ...result.cards]) {
    ok(r.x >= -1 && r.right <= result.width + 1 && r.y >= -1 && r.bottom <= result.height + 1, label + ' visible without scrolling: ' + JSON.stringify(r));
    if (r.id.startsWith('sl') && !['slStatus', 'slActionHelp', 'slHand'].includes(r.id)) ok(r.height >= 44, label + ' control touch height ' + r.id);
    if (!r.id.startsWith('sl')) ok(r.width >= 43.9 && r.height >= 44, label + ' card touch target ' + r.id);
  }
}
async function enabledControlsHitTest(page, label) {
  const targets = await page.evaluate(() => ['slPlay', 'slPass', 'slClear', 'slNext'].map(id => document.getElementById(id)).filter(el => el && !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: el.id, receivesPointer: Boolean(hit && (hit === el || el.contains(hit))), interceptedBy: hit && (hit.id || hit.className || hit.tagName) };
  }));
  ok(targets.length > 0, label + ' has an enabled main control');
  for (const target of targets) ok(target.receivesPointer, label + ' enabled control receives pointer events: ' + JSON.stringify(target));
}
async function timerChecks() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p = await context.newPage(), now = 1700000000000;
  // Keep interval ticks running while fixing wall time, so five seconds is exact.
  await p.addInitScript(fixed => { Date.now = () => fixed; }, now);
  const ownTurn = { ...clone(opening), turnId: 'p0', canPlay: true, phaseEndsAt: now + 5000 };
  await fixture(p, ownTurn);
  await p.waitForFunction(() => document.getElementById('slHandClock').textContent.includes('เหลือ 5 วิ'));
  ok(await p.locator('#slHandClock').isVisible(), 'own turn has a visible five-second hand timer');
  ok(await p.locator('.sl-status-row').evaluate(el => el.classList.contains('is-urgent')), 'own five-second turn makes the status row urgent');
  ok(await p.locator('#slSeats .sl-seat-clock:visible').count() === 0, 'own turn does not add an opponent timer');
  const opponentTurn = { ...ownTurn, step: ownTurn.step + 1, turnId: 'p1', canPlay: false, canPass: false };
  await deliver(p, opponentTurn);
  await p.waitForFunction(() => document.getElementById('slHandClock').textContent.includes('ตานี้ 5 วิ'));
  ok(await p.locator('#slSeats .sl-seat-clock:visible').count() === 1, 'waiting turn shows exactly one opponent timer');
  const currentClock = p.locator('.sl-seat.turn .sl-seat-info .sl-seat-clock');
  ok(await currentClock.isVisible() && (await currentClock.innerText()).includes('5'), 'opponent countdown is beside the current player name');
  await deliver(p, { ...ended[0], step: opponentTurn.step + 1 });
  await p.waitForFunction(() => !document.querySelector('.sl-status-row').classList.contains('is-urgent'));
  ok(await p.locator('#slSeats .sl-seat-clock:visible').count() === 0, 'untimed result hides every opponent timer');
  await context.close();
}
async function browserChecks() {
  browser = await chromium.launch();
  const errors = [];
  const sizes = [[320,568],[360,640],[375,667],[390,844],[768,1024],[800,700],[820,700],[821,700],[1280,800],[568,320],[667,375],[844,390],[1024,512],[2137,1011]];
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
    await fixture(p, opening);
    const atlas = await p.evaluate(async () => { const image = new Image(); image.src = '/static/img/slave/portraits-v1.jpg'; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; });
    ok(atlas.width >= 512 && atlas.width === atlas.height, 'local character atlas decodes correctly');
    ok(await p.locator('.sl-portrait').count() === 4, 'all four default characters use portrait art');
    ok(await p.locator('#slSeats [data-role="unranked"]').count() === 4, 'first round does not invent ranks');
    ok(await p.locator('.sl-back').count() === 39, 'opening draws all 13 backs for every opponent');
    await p.evaluate(() => { window.seatBeforeSelection = document.querySelector('.seat-self .sl-avatar'); });
    const label = width + 'x' + height;
    await geometry(p, label + ' opening');
    for (const id of ['slChat', 'slExit', 'slDebug']) {
      const r = await p.locator('#' + id).boundingBox();
      ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= width + 1 && r.y + r.height <= height && r.height >= 44, label + ' reachable toolbar ' + id);
    }
    await p.locator('#slChat').click();
    ok(await p.locator('#slChatDialog').isVisible(), label + ' chat opens');
    await p.locator('#slChatInput').fill('/m'); await p.locator('#slChatInput').press('Enter');
    ok(await p.locator('#slDebugDock').isVisible(), label + ' slash command opens inline debug');
    ok(await p.locator(':modal').count() === 0, label + ' debug does not create a modal or backdrop');
    await p.locator('#slPeekHands').check();
    ok(await p.locator('#slSeats .sl-revealed-card').count() === 39, label + ' all opponent faces are at their table seats');
    await geometry(p, label + ' debug peek');
    const hiddenFaces = await p.locator('.sl-revealed-card').evaluateAll(els => els.filter(el => { const r=el.getBoundingClientRect(); return r.x<0||r.right>innerWidth+1||r.y<0||r.bottom>innerHeight+1; }).length);
    ok(!hiddenFaces, label + ' every revealed card stays on screen');
    await p.locator('[data-card="0"]').click(); ok(await p.locator('#slPlay').isEnabled(), label + ' can select and play with debug open');
    await enabledControlsHitTest(p, label + ' debug selected');
    await p.locator('#slClear').click();
    if ([320,375,667,1280,2137].includes(width)) await p.screenshot({path:path.join(shots,'live-debug-'+label+'.png')});
    await p.locator('#slDebugFold').click();
    ok(await p.locator('#slSeats .sl-revealed-card').count() === 39, label + ' folded tools preserve live revealed hands');
    await p.locator('#slDebug').click(); await p.locator('#slPeekHands').uncheck();
    ok(await p.locator('.sl-revealed-card').count() === 0 && await p.locator('.sl-back').count() === 39, label + ' turning peek off restores private backs');
    ok(!(await p.evaluate(() => window.__commands.some(c => c.event === 'sendMessage' && c.data.message === '/m'))), label + ' slash command is private');
    await p.locator('#slDebugFold').click();
    await p.locator('#slExit').click();
    ok(await p.locator('#slExitDialog').isVisible(), label + ' exit confirmation opens');
    ok((await p.locator('#slExitText').innerText()).includes('ทุกคน'), label + ' exit explains table consequence');
    await p.locator('[data-sl-close="slExitDialog"]').click();
    ok(!(await p.evaluate(() => window.__commands.some(c => c.event === 'endTableSession'))), label + ' cancel does not stop game');

    ok((await p.locator('#slActionHelp').innerText()).includes('3♣'), 'opening rule beside hand ' + label);
    ok(await p.locator('#slHint').count() === 0, label + ' no separate choose-a-set button');
    ok((await p.locator('#slActionHelp').innerText()).includes('↑'), label + ' automatic guidance explains the in-hand marker');
    ok(await p.locator('#slHand [aria-pressed="true"]').count() === 0, label + ' guidance never selects or plays cards for the player');
    ok(await p.locator('[data-card="0"]').getAttribute('data-playable') === 'true', 'opening legal card marked');
    ok(await p.locator('[data-card="4"]').getAttribute('data-playable') === 'false', 'opening illegal card distinguished');
    await p.locator('[data-card="4"]').click();
    ok((await p.locator('#slActionHelp').innerText()).includes('3♣'), 'invalid opening has concrete reason');
    ok(!(await p.locator('#slPlay').isEnabled()), 'invalid opening cannot be submitted');
    await p.locator('#slClear').click(); await p.locator('[data-card="0"]').click();
    ok(await p.evaluate(() => window.seatBeforeSelection === document.querySelector('.seat-self .sl-avatar')), 'selection preserves portrait and countdown DOM');
    ok(await p.locator('.seat-self .sl-avatar').evaluate(el => getComputedStyle(el).animationName) === 'none', 'reduced motion disables portrait animation');
    ok(await p.locator('#slPlay').isEnabled(), 'first valid move enabled');
    ok((await p.locator('#slPlay').innerText()).includes('3♣'), 'submit names selected card');
    await geometry(p, label + ' selected');
    if ([320,375,667,821,1280,2137].includes(width)) await p.screenshot({ path: path.join(shots, 'opening-' + label + '.png'), fullPage: false });
    await deliver(p, { ...pair, step: 2 });
    if ([375,1280].includes(width)) await p.screenshot({ path: path.join(shots, 'guide-options-' + label + '.png'), fullPage: false });
    await p.locator('[data-card="8"]').click();
    if ([375,1280].includes(width)) await p.screenshot({ path: path.join(shots, 'guide-partial-' + label + '.png'), fullPage: false });
    ok((await p.locator('#slActionHelp').innerText()).includes('อีก 1'), 'partial pair instruction');
    ok(await p.locator('[data-card="9"]').getAttribute('data-playable') === 'true', 'matching pair highlighted');
    ok(await p.locator('[data-card="12"]').getAttribute('data-playable') === 'false', 'other rank not highlighted');
    await p.locator('[data-card="12"]').click();
    ok((await p.locator('#slActionHelp').innerText()).includes('หลายหน้า'), 'mixed ranks give a concrete correction');
    ok(!(await p.locator('#slPlay').isEnabled()), 'mixed ranks cannot be submitted');
    await p.locator('[data-card="12"]').click();
    ok(await p.locator('[data-card="9"]').getAttribute('data-playable') === 'true', 'undoing a wrong card restores matching guidance');
    await p.locator('[data-card="9"]').click();
    ok(await p.locator('#slPlay').isEnabled(), 'completed pair enabled');
    ok((await p.locator('#slPlay').innerText()) === 'ลงคู่ 5 →', 'pair submit named correctly');
    await p.locator('#slClear').click();
    ok(await p.locator('[data-card="12"]').getAttribute('data-playable') === 'true', 'clearing selection offers all legal starting ranks again');
    await deliver(p, { ...weakPair, step: 3 });
    await p.locator('[data-card="0"]').click(); await p.locator('[data-card="1"]').click();
    ok((await p.locator('#slActionHelp').innerText()).includes('ไม่ใหญ่กว่า'), 'weaker pair explains why it cannot beat the pile');
    ok(!(await p.locator('#slPlay').isEnabled()), 'weaker pair cannot be submitted');
    await deliver(p, { ...pair, step: 4, turnId: 'p1', canPlay: false, canPass: false });
    ok(await p.locator('#slHand [data-playable="true"]').count() === 0, 'waiting turn shows no misleading playable cards');
    ok(!(await p.locator('#slPlay').isEnabled()), 'waiting player cannot submit a move');
    await deliver(p, { ...noMove, step: 5 });
    ok(await p.locator('#slPlay').isHidden(), 'no impossible disabled primary move');
    ok(await p.locator('#slPass').isEnabled(), 'pass available when no moves');
    ok((await p.locator('#slPass').getAttribute('class')).includes('primary'), 'pass becomes primary');
    ok(await p.locator('#slHand [data-playable="true"]').count() === 0 && (await p.locator('#slActionHelp').innerText()).includes('ผ่าน'), 'no legal move clears highlights and explains pass');
    await geometry(p, label + ' pass only');
    // End-of-round can arrive with the same step as the final move.
    await deliver(p, { ...ended[0], step: 5 });
    ok((await p.locator('#slResultTitle').innerText()).includes('คุณเป็นคิง'), 'own result is the headline');
    ok(await p.locator('#slResultEmblem [data-role="king"]').count() === 1, 'personal award uses king art');
    for (const role of ['king', 'queen', 'commoner', 'slave']) ok(await p.locator('#slRanks [data-role="' + role + '"] svg').count() === 1, 'distinct SVG rank art ' + role);
    ok(await p.locator('#slRanks [data-role]').evaluateAll(els => new Set(els.map(el => el.innerHTML)).size) === 4, 'all four role silhouettes differ');
    ok((await p.locator('#slResultNext').innerText()).includes('2 ใบ'), 'result explains upcoming exchange');
    ok(await p.locator('#slNext').isVisible(), 'host next-round action visible');
    await geometry(p, label + ' round end');
    if ([375,667].includes(width)) await p.screenshot({ path: path.join(shots, 'result-' + label + '.png'), fullPage: false });
    await deliver(p, { ...exchanging[0], step: 6 });
    ok((await p.locator('#slActionHelp').innerText()).includes('มือเดิมคืน 2 ใบ'), 'king exchange explains original hand');
    ok(await p.locator('#slHand [data-playable="true"]').count() === exchanging[0].self.hand.length, 'exchange highlights all cards eligible for returning');
    await p.locator('#slHand [data-playable="true"][aria-pressed="false"]').first().click();
    ok(!(await p.locator('#slPlay').isEnabled()) && (await p.locator('#slActionHelp').innerText()).includes('1/2'), 'exchange explains one of two chosen and prevents early submit');
    await p.locator('#slHand [data-playable="true"][aria-pressed="false"]').first().click();
    ok(await p.locator('#slPlay').isEnabled(), 'complete exchange selection enabled');
    ok(await p.locator('#slHand [data-playable="true"][aria-pressed="false"]').count() === 0, 'full exchange selection stops suggesting extra cards');
    await geometry(p, label + ' exchange');
    ok(await p.locator('#slSeats [data-role="unranked"]').count() === 0, 'assigned ranks stay visible during exchange');
    if ([375,667].includes(width)) await p.screenshot({ path: path.join(shots, 'exchange-' + label + '.png'), fullPage: false });
    await p.locator('#slDebug').click(); await p.locator('#slPeekHands').check(); await p.locator('#slDebugFold').click();
    const shrinking = clone(opening); shrinking.step = 7;
    shrinking.seats[1].count = 1; shrinking.seats[2].count = 0; shrinking.seats[2].place = 1; shrinking.seats[3].count = 7;
    await deliver(p, shrinking);
    ok(await p.locator('.seat-left .sl-back,.seat-left .sl-revealed-card').count() === 1, 'one remaining card draws one back');
    ok(await p.locator('.seat-top .sl-back,.seat-top .sl-revealed-card').count() === 0 && await p.locator('.seat-top .sl-no-cards').isVisible(), 'empty hand clears backs and displays finished label');
    ok(await p.locator('.seat-right .sl-back,.seat-right .sl-revealed-card').count() === 7, 'hand count decreases after an update');
    ok(await p.locator('#slSeats .sl-revealed-card').count() === 8, label + ' folded peek updates after server turn');
    await geometry(p, label + ' updated counts');
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const p = await context.newPage(), custom = clone(opening);
    custom.seats[0].avatar = '😎';
    await fixture(p, custom);
    ok((await p.locator('.seat-self .sl-avatar').innerText()).includes('😎'), 'custom player emoji is preserved');
    custom.step++; custom.seats[0].avatar = 'https://example.test/avatar.jpg';
    await deliver(p, custom);
    ok(await p.locator('.seat-self .sl-avatar img').getAttribute('src') === custom.seats[0].avatar, 'custom player image is preserved');
    await context.close();
  }
  for (let i = 1; i < 4; i++) {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce' });
    const p = await context.newPage(); await fixture(p, exchanging[i], 'p' + i);
    ok((await p.locator('#slActionHelp').innerText()).includes(i === 1 ? 'คืน 1 ใบ' : 'อัตโนมัติ'), 'exchange for rank ' + (i + 1));
    await deliver(p, { ...ended[i], step: exchanging[i].step + 1 });
    ok((await p.locator('#slResultTitle').innerText()).includes(titles[i]), 'own result for rank ' + (i + 1));
    ok(await p.locator('#slResultEmblem [data-role="' + ['king','queen','commoner','slave'][i] + '"]').count() === 1, 'own emblem matches rank ' + (i + 1));
    ok(await p.locator('#slNext').isHidden(), 'non-host sees no next-round button');
    await geometry(p, 'rank ' + (i + 1) + ' result');
    await context.close();
  }
  await timerChecks();
  ok(errors.length === 0, 'no browser errors: ' + errors.join('; '));
}
(async () => {
  ruleChecks(); await browserChecks();
  console.log('Slave UX: ' + checks + ' checks passed · real engine legal sets, 14 viewports, readable names/proximity, unblocked debug controls, own/opponent timers, opening/pair/cut/pass, all ranks/exchanges, same-step results, 44px targets, visible turn controls · screenshots ' + shots);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
