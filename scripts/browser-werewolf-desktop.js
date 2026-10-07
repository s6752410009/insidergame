// Werewolf ตอนกลางคืนบนจอกว้าง (คอม 1440×900 · iPad 1024×1366)
// เดิม: ถึงตาใช้สกิล → ฉากมืดเบลอคลุมทั้งจอ แต่แผงที่ถูกยกขึ้นเป็นแผงมือถือที่ซ่อนอยู่ → ไม่มีอะไรให้กด
// รัน: npm run smoke:werewolf:desktop
const path = require('path');
const { chromium } = require('playwright');
const U = require('./mobile-e2e-utils');
const OUT = process.env.OUT || U.createArtifactDir('werewolf-desktop');
(async () => {
  const server = await U.spawnServer();
  const clients = [];
  try {
    for (let i = 0; i < 5; i++) { const c = U.attachStateEvent(U.createClient(server.baseUrl, 'p' + i, 'werewolfState'), 'werewolfState'); await U.connectClient(c); clients.push(c); }
    const [host, ...rest] = clients;
    const created = await U.emitAck(host.socket, 'createRoom', { playerId: host.playerId, name: 'ww desk', gameMode: 'werewolf', maxPlayers: 8, werewolfRoles: ['werewolf', 'seer', 'doctor'] });
    const roomId = created.roomId; U.bindRoom(host, roomId, 'werewolf_requestState');
    for (const c of rest) { await U.emitAck(c.socket, 'joinRoom', { roomId, playerId: c.playerId }); U.bindRoom(c, roomId, 'werewolf_requestState'); }
    await U.emitAck(host.socket, 'startGameFromLobby', { roomId }, 30000);
    await U.delay(2500);
    clients.forEach(c => U.bindRoom(c, roomId, 'werewolf_requestState'));
    const nights = await Promise.all(clients.map(c => U.waitState(c, roomId, s => s.phase === 'night' && s.playerRole?.id, 30000)));
    nights.forEach((s, i) => { clients[i].role = s.playerRole.id; });
    const browser = await chromium.launch();
    const out = {};
    for (const role of ['werewolf', 'seer']) {
      const client = clients.find(c => c.role === role && c !== host) || clients.find(c => c.role === role);
      for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['ipad', { width: 1024, height: 1366 }]]) {
        const s = await U.createMobilePage(browser, server.baseUrl, roomId, client, '#werewolfShell');
        await s.page.setViewportSize(vp);
        await s.page.evaluate(() => { try { localStorage.setItem('ig-firstplay-werewolf', '1'); } catch (e) {} document.getElementById('ppFirstPlay')?.remove(); });
        await U.delay(6000);
        await s.page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
        out[role + '-' + name] = await s.page.evaluate(() => {
          const shell = document.getElementById('werewolfShell');
          const f = document.querySelector('.turn-focus');
          const res = { myTurn: shell.classList.contains('my-turn-active'), focus: !!f };
          if (f) {
            const r = f.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + 20, innerHeight - 5));
            res.focusRect = [Math.round(r.top), Math.round(r.height)];
            res.focusOnTop = !!hit && (hit === f || f.contains(hit));
            res.hit = hit ? hit.tagName + '#' + hit.id + '.' + String(hit.className).slice(0, 50) : null;
            const chain = []; let el = f;
            while (el && el !== document.body) { const cs = getComputedStyle(el); if (cs.zIndex !== 'auto' || cs.transform !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none' || Number(cs.opacity) < 1 || cs.isolation === 'isolate' || cs.contain !== 'none') chain.push(el.tagName + '#' + el.id + '.' + String(el.className).slice(0, 40) + ` z=${cs.zIndex} pos=${cs.position} tf=${cs.transform !== 'none'} bf=${cs.backdropFilter} op=${cs.opacity}`); el = el.parentElement; }
            res.stackChain = chain;
          }
          return res;
        });
        await s.context.close();
      }
    }
    let checks = 0;
    for (const [key, r] of Object.entries(out)) {
      // ฉากมืดได้เฉพาะตอนมีแผงสกิลที่มองเห็นและอยู่บนสุด
      U.assert(!r.myTurn || r.focusOnTop, `${key}: จอมืดเบลอแต่ไม่มีแผงให้กด ${JSON.stringify(r)}`); checks++;
    }
    console.log(`✅ werewolf desktop: ${checks} checks · ภาพที่ ${OUT}`);
    await browser.close();
  } finally { clients.forEach(c => c.socket.close()); await U.stopServer(server); }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
