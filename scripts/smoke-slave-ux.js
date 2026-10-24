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
  const body = ejs.render(template, { contentFor: () => '', room: initialRoom, playerInfo: { playerId: id }, slaveState: payload, safeJson: v => JSON.stringify(v).replace(/</g, '\\u003c') });
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="content">' + body + '</body></html>';
}
const mockSocket = `window.__commands=[];window.__socket={connected:true,handlers:{},on(e,fn){this.handlers[e]=fn;return this},emit(e,data,cb){window.__commands.push({event:e,data});if(cb)cb(null,{success:true})},timeout(){return this}};window.io=()=>window.__socket;`;
async function fixture(page, payload, id = 'p0') {
  await page.route('**/*', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: markup(payload, id) });
    if (pathname === '/socket.io/socket.io.js') return route.fulfill({ contentType: 'text/javascript', body: mockSocket });
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
  await page.evaluate(s => window.__socket.handlers.slaveState(s), payload);
}
async function geometry(page, label) {
  const result = await page.evaluate(() => {
    const ids = ['slStatus', 'slActionHelp', 'slHand', 'slPlay', 'slPass', 'slHint', 'slClear', 'slNext'];
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
    return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1, rects, cards, clippedInk };
  });
  ok(!result.overflow, label + ' has no horizontal overflow');
  ok(!result.clippedInk.length, label + ' ranks and suits stay inside card faces: ' + result.clippedInk.join(','));
  for (const r of [...result.rects, ...result.cards]) {
    ok(r.x >= -1 && r.right <= result.width + 1 && r.y >= -1 && r.bottom <= result.height + 1, label + ' visible without scrolling: ' + JSON.stringify(r));
    if (r.id.startsWith('sl') && !['slStatus', 'slActionHelp', 'slHand'].includes(r.id)) ok(r.height >= 44, label + ' control touch height ' + r.id);
    if (!r.id.startsWith('sl')) ok(r.width >= 43.9 && r.height >= 44, label + ' card touch target ' + r.id);
  }
}
async function browserChecks() {
  browser = await chromium.launch();
  const errors = [];
  const sizes = [[320,568],[360,640],[375,667],[390,844],[768,1024],[800,700],[820,700],[821,700],[1280,800],[568,320],[667,375],[844,390],[1024,512]];
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
    await fixture(p, opening);
    const atlas = await p.evaluate(async () => { const image = new Image(); image.src = '/static/img/slave/portraits-v1.jpg'; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; });
    ok(atlas.width >= 512 && atlas.width === atlas.height, 'local character atlas decodes correctly');
    ok(await p.locator('.sl-portrait').count() === 4, 'all four default characters use portrait art');
    await p.evaluate(() => { window.seatBeforeSelection = document.querySelector('.seat-self .sl-avatar'); });
    const label = width + 'x' + height;
    await geometry(p, label + ' opening');
    ok((await p.locator('#slActionHelp').innerText()).includes('3♣'), 'opening rule beside hand ' + label);
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
    if ([320,375,667,821,1280].includes(width)) await p.screenshot({ path: path.join(shots, 'opening-' + label + '.png'), fullPage: false });
    await deliver(p, { ...pair, step: 2 });
    await p.locator('[data-card="8"]').click();
    ok((await p.locator('#slActionHelp').innerText()).includes('อีก 1'), 'partial pair instruction');
    ok(await p.locator('[data-card="9"]').getAttribute('data-playable') === 'true', 'matching pair highlighted');
    ok(await p.locator('[data-card="12"]').getAttribute('data-playable') === 'false', 'other rank not highlighted');
    await p.locator('[data-card="9"]').click();
    ok(await p.locator('#slPlay').isEnabled(), 'completed pair enabled');
    ok((await p.locator('#slPlay').innerText()) === 'ลงคู่ 5 →', 'pair submit named correctly');
    await deliver(p, { ...noMove, step: 3 });
    ok(await p.locator('#slPlay').isHidden(), 'no impossible disabled primary move');
    ok(await p.locator('#slPass').isEnabled(), 'pass available when no moves');
    ok((await p.locator('#slPass').getAttribute('class')).includes('primary'), 'pass becomes primary');
    await geometry(p, label + ' pass only');
    // End-of-round can arrive with the same step as the final move.
    await deliver(p, { ...ended[0], step: 3 });
    ok((await p.locator('#slResultTitle').innerText()).includes('คุณเป็นคิง'), 'own result is the headline');
    ok((await p.locator('#slResultNext').innerText()).includes('2 ใบ'), 'result explains upcoming exchange');
    ok(await p.locator('#slNext').isVisible(), 'host next-round action visible');
    await geometry(p, label + ' round end');
    if ([375,667].includes(width)) await p.screenshot({ path: path.join(shots, 'result-' + label + '.png'), fullPage: false });
    await deliver(p, { ...exchanging[0], step: 4 });
    ok((await p.locator('#slActionHelp').innerText()).includes('มือเดิมคืน 2 ใบ'), 'king exchange explains original hand');
    await p.locator('#slHint').click();
    ok(await p.locator('#slPlay').isEnabled(), 'complete exchange selection enabled');
    await geometry(p, label + ' exchange');
    if ([375,667].includes(width)) await p.screenshot({ path: path.join(shots, 'exchange-' + label + '.png'), fullPage: false });
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
    ok(await p.locator('#slNext').isHidden(), 'non-host sees no next-round button');
    await geometry(p, 'rank ' + (i + 1) + ' result');
    await context.close();
  }
  ok(errors.length === 0, 'no browser errors: ' + errors.join('; '));
}
(async () => {
  ruleChecks(); await browserChecks();
  console.log('Slave UX: ' + checks + ' checks passed · real engine legal sets, 13 viewports, opening/pair/cut/pass, all ranks/exchanges, same-step results, 44px targets, visible turn controls · screenshots ' + shots);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
