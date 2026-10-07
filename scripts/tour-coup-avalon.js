/**
 * ทัวร์ถ่ายภาพ Coup + Avalon แบบผู้เล่นใหม่ — มือถือ 390×844 (ผู้เล่น A) + เดสก์ท็อป 1440×900 (ผู้เล่น B)
 * ที่เหลือเป็นบอท socket — ใช้ถ่ายภาพก่อน/หลังแก้ UX (ไม่ใช่เทส ไม่ assert ละเอียด)
 *
 * รัน: node scripts/tour-coup-avalon.js <โฟลเดอร์ภาพ> [coup|avalon|pages]
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const OUT = path.resolve(process.argv[2] || path.join(process.env.GAME_DATA_DIR, 'tour'));
const ONLY = process.argv[3] || 'all';
fs.mkdirSync(OUT, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));

async function getFreePort() {
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), ALLOW_LEGACY_SOCKET_IDENTITY: '1', WALLETS_FILE: path.join(process.env.GAME_DATA_DIR || '', 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }
function launchOptions() {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return fs.existsSync(chrome) ? { headless: true, executablePath: chrome } : { headless: true };
}
async function waitFor(pred, message, ms = 12000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if (await pred()) return true; } catch (e) { /* retry */ }
        await delay(80);
    }
    console.log('   (ข้าม: รอไม่ไหว — ' + message + ')');
    return false;
}

const INIT = (stateEvent, firstPlayKey) => `
try { sessionStorage.insiderPromoSeen = '1'; localStorage.setItem('${firstPlayKey}', '1'); } catch (e) {}
(function () {
  let real;
  Object.defineProperty(window, 'io', { configurable: true, get() { return real; }, set(fn) {
    real = function () { const s = fn.apply(this, arguments); s.on('${stateEvent}', st => { window.__state = st; }); return s; };
    Object.assign(real, fn);
  } });
})();`;

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(launchOptions());
    const errors = [];

    async function makeRoom(n, gameMode, name, stateEvent, settings) {
        const players = [];
        for (let i = 0; i < n; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on(stateEvent, s => states.push(s));
            players.push({ socket, id, states, last: () => states[states.length - 1], name: 'P' + (i + 1) });
        }
        await delay(400);
        const created = await ack(players[0].socket, 'createRoom', { playerId: players[0].id, name, gameMode, maxPlayers: 10 });
        if (!created?.success) throw new Error('สร้างห้องไม่ได้ ' + JSON.stringify(created));
        players[0].socket.emit('setRoom', { roomId: created.roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            const j = await ack(p.socket, 'joinRoom', { roomId: created.roomId, playerId: p.id });
            if (!j?.success) throw new Error('join ไม่ได้ ' + JSON.stringify(j));
            p.socket.emit('setRoom', { roomId: created.roomId, playerId: p.id });
        }
        await delay(400);
        if (settings) await ack(players[0].socket, 'updateRoom', settings);
        return { roomId: created.roomId, players };
    }
    async function openPage(roomId, player, viewport, stateEvent, firstPlayKey) {
        const mobile = viewport.width < 600;
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
        await ctx.addInitScript(INIT(stateEvent, firstPlayKey));
        const page = await ctx.newPage();
        page.on('pageerror', e => errors.push(player.name + ': ' + e.message));
        page.on('response', r => { if (r.status() === 404 && /\/assets\//.test(r.url())) errors.push('404 ' + r.url()); });
        await page.goto(`${base}/?playerId=${player.id}`, { waitUntil: 'domcontentloaded' });
        await page.goto(`${base}/game/${roomId}?playerId=${player.id}`, { waitUntil: 'networkidle' });
        await delay(800);
        player.page = page;
        player.ctx = ctx;
        player.view = () => page.evaluate(() => window.__state);
        return page;
    }
    const shotsTaken = new Set();
    async function shot(page, name, opts = {}) {
        if (opts.once && shotsTaken.has(name)) return;
        shotsTaken.add(name);
        await delay(opts.wait ?? 450);
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!opts.full });
        console.log('   📸 ' + name);
    }
    async function clickIf(page, selector) {
        // คลิกผ่าน DOM — กันจังหวะที่หน้าเว็บ render ใหม่ระหว่างเลื่อนจอแล้วคลิกพลาด
        const ok = await page.$eval(selector, el => { el.scrollIntoView({ block: 'center' }); el.click(); return true; }).catch(() => false);
        await delay(120);
        return ok;
    }

    /* =========================== COUP =========================== */
    async function runCoup() {
        console.log('== Coup ==');
        const room = await makeRoom(4, 'coup', 'โต๊ะเทส Coup', 'coupState', { coupActionSeconds: 90 });
        const [A, B, C, D] = room.players;
        const started = await ack(A.socket, 'startGameFromLobby', { roomId: room.roomId });
        if (!started?.success) throw new Error('เริ่ม coup ไม่ได้ ' + JSON.stringify(started));
        await waitFor(() => room.players.every(p => p.last() && p.last().phase === 'action'), 'coup start', 15000);
        A.socket.close(); B.socket.close();
        const pa = await openPage(room.roomId, A, { width: 390, height: 844 }, 'coupState', 'ig-firstplay-coup');
        const pb = await openPage(room.roomId, B, { width: 1440, height: 900 }, 'coupState', 'ig-firstplay-coup');
        const bots = [C, D];
        const any = () => C.last();
        const nameOf = id => (any().players.find(p => p.playerId === id) || {}).name;
        A.name = nameOf(A.id); B.name = nameOf(B.id);

        const phaseIs = (ph, extra) => () => { const s = any(); return s && s.phase === ph && (!extra || extra(s)); };
        const botView = bot => bot.last();

        // 1. ตา A
        await waitFor(phaseIs('action', s => s.currentPlayerId === A.id), 'ตา A');
        await shot(pa, 'coup-01-my-turn-phone');
        await shot(pa, 'coup-01-my-turn-phone-full', { full: true, wait: 0 });
        await shot(pb, 'coup-01-waiting-desktop');

        // 2. A ขอเงินช่วยเหลือ → C ขวางด้วยดยุค
        await clickIf(pa, '.cp-action[data-action="foreign_aid"]');
        await waitFor(phaseIs('respond'), 'respond FA');
        await shot(pb, 'coup-02-respond-foreign-aid-desktop');
        await shot(pa, 'coup-02-actor-waiting-phone', { wait: 0 });
        await ack(C.socket, 'coup_respond', { response: 'block', claimCard: 'duke', step: botView(C).step, phase: 'respond', turnNumber: botView(C).turnNumber });
        await waitFor(phaseIs('block-respond'), 'block-respond');
        await shot(pa, 'coup-03-blocked-phone');
        await shot(pb, 'coup-03-blocked-desktop', { wait: 0 });
        await clickIf(pa, '[data-respond="pass"]');
        await clickIf(pb, '[data-respond="pass"]');
        await delay(300);
        if (any().phase === 'block-respond') await ack(D.socket, 'coup_respond', { response: 'pass', step: botView(D).step });
        await waitFor(phaseIs('action', s => s.currentPlayerId === B.id), 'ตา B');
        await shot(pa, 'coup-04-after-block-phone');

        // 3. ตา B (เดสก์ท็อป) เก็บภาษี → A ท้า
        await shot(pb, 'coup-05-my-turn-desktop');
        await clickIf(pb, '.cp-action[data-action="tax"]');
        await waitFor(phaseIs('respond'), 'respond tax');
        await shot(pa, 'coup-06-respond-tax-phone');
        await clickIf(pa, '[data-respond="challenge"]');
        await waitFor(phaseIs('lose-influence'), 'lose-influence');
        await shot(pa, 'coup-07-challenge-result-phone', { wait: 350 });
        await shot(pb, 'coup-07-challenge-result-desktop', { wait: 0 });
        const loser = any().pendingLoss && any().pendingLoss.playerId;
        const loserPage = loser === A.id ? pa : (loser === B.id ? pb : null);
        if (loserPage) {
            await clickIf(loserPage, '#myHand .cp-influence.is-pick');
            await shot(loserPage, loser === A.id ? 'coup-07b-pick-loss-phone' : 'coup-07b-pick-loss-desktop');
            await clickIf(loserPage, '#cpLossConfirm');
        }
        await waitFor(phaseIs('action', s => s.currentPlayerId === C.id), 'ตา C');
        await shot(pa, 'coup-08-after-challenge-phone', { wait: 600 });

        // 4. C ขโมยจาก A → A ยอม
        await ack(C.socket, 'coup_submitAction', { actionId: 'steal', targetPlayerId: A.id });
        await waitFor(phaseIs('respond'), 'respond steal');
        await shot(pa, 'coup-09-steal-target-phone');
        await clickIf(pa, '[data-respond="pass"]');
        await clickIf(pb, '[data-respond="pass"]');
        await delay(300);
        if (any().phase === 'respond') await ack(D.socket, 'coup_respond', { response: 'pass', step: botView(D).step });
        await waitFor(phaseIs('action', s => s.currentPlayerId === D.id), 'ตา D');
        await shot(pa, 'coup-10-after-steal-phone', { wait: 300 });

        // 5. D รับรายได้ · 6. A แลกการ์ด
        await ack(D.socket, 'coup_submitAction', { actionId: 'income' });
        if (await waitFor(phaseIs('action', s => s.currentPlayerId === A.id), 'ตา A รอบ 2')) {
            await clickIf(pa, '.cp-action[data-action="exchange"]');
            await waitFor(phaseIs('respond'), 'respond exchange');
            await clickIf(pb, '[data-respond="pass"]');
            for (const bot of bots) await ack(bot.socket, 'coup_respond', { response: 'pass', step: botView(bot).step });
            await waitFor(phaseIs('exchange'), 'exchange');
            await shot(pa, 'coup-11-exchange-phone');
            await clickIf(pa, '#cpExchangeConfirm');
        }
        // 7. B รายได้ · 8. C รายได้ · 9. D ลอบสังหาร A
        if (await waitFor(phaseIs('action', s => s.currentPlayerId === B.id), 'ตา B รอบ 2')) await clickIf(pb, '.cp-action[data-action="income"]');
        if (await waitFor(phaseIs('action', s => s.currentPlayerId === C.id), 'ตา C รอบ 2')) await ack(C.socket, 'coup_submitAction', { actionId: 'income' });
        if (await waitFor(phaseIs('action', s => s.currentPlayerId === D.id), 'ตา D รอบ 2')) {
            await ack(D.socket, 'coup_submitAction', { actionId: 'assassinate', targetPlayerId: A.id });
            if (await waitFor(phaseIs('respond'), 'respond assassinate')) {
                await shot(pa, 'coup-12-assassin-target-phone');
                await shot(pb, 'coup-12-assassin-other-desktop', { wait: 0 });
                await clickIf(pa, '[data-respond="block"][data-claim="contessa"]');
                if (await waitFor(phaseIs('block-respond'), 'block contessa')) {
                    await shot(pa, 'coup-13-contessa-block-phone');
                    await ack(D.socket, 'coup_respond', { response: 'challenge', step: botView(D).step, phase: 'block-respond', turnNumber: botView(D).turnNumber });
                    await delay(500);
                    await shot(pa, 'coup-13b-contessa-challenged-phone');
                }
            }
        }

        // 10. เล่นต่ออัตโนมัติจนจบ
        let guard = 0;
        let shotTimer = false;
        while (any().phase !== 'finished' && guard++ < 160) {
            const s = any();
            const actor = id => [A, B, C, D].find(p => p.id === id);
            if (s.phase === 'action') {
                const who = actor(s.currentPlayerId);
                const me = s.players.find(p => p.playerId === who.id);
                if (who.page) {
                    if (!shotTimer && who === A) {
                        // ใกล้หมดเวลา: บอกไหมว่าหมดแล้วจะเกิดอะไร
                        shotTimer = true;
                    }
                    if (me.coins >= 7) {
                        await clickIf(who.page, '.cp-action[data-action="coup"]');
                        const foe = s.players.find(p => p.alive && p.playerId !== who.id);
                        await clickIf(who.page, `[data-target="${foe.playerId}"]`);
                        await clickIf(who.page, '[data-confirm-target]');
                    } else await clickIf(who.page, '.cp-action[data-action="income"]');
                } else if (me.coins >= 7) {
                    const foe = s.players.find(p => p.alive && p.playerId !== who.id && (p.playerId === A.id || p.playerId === B.id)) || s.players.find(p => p.alive && p.playerId !== who.id);
                    await ack(who.socket, 'coup_submitAction', { actionId: 'coup', targetPlayerId: foe.playerId });
                } else await ack(who.socket, 'coup_submitAction', { actionId: 'income' });
            } else if (s.phase === 'respond' || s.phase === 'block-respond') {
                for (const p of [A, B]) if (p.page) await clickIf(p.page, '[data-respond="pass"]');
                for (const bot of bots) if (botView(bot).availableResponses) await ack(bot.socket, 'coup_respond', { response: 'pass', step: botView(bot).step });
            } else if (s.phase === 'lose-influence') {
                const who = actor(s.pendingLoss.playerId);
                if (who.page) {
                    await clickIf(who.page, '#myHand .cp-influence.is-pick');
                    if (who === A) await shot(pa, 'coup-14-lose-card-phone', { once: true });
                    await clickIf(who.page, '#cpLossConfirm');
                } else await ack(who.socket, 'coup_loseInfluence', { cardId: botView(who).self.influence[0].id });
            } else if (s.phase === 'exchange') {
                const who = actor(s.currentPlayerId);
                if (who.page) await clickIf(who.page, '#cpExchangeConfirm');
                else await ack(who.socket, 'coup_exchange', { keepCardIds: botView(who).pendingExchange.options.slice(0, botView(who).pendingExchange.keepCount).map(c => c.id) });
            }
            await delay(500);
            const v = await pa.evaluate(() => window.__state).catch(() => null);
            if (v && v.self && !v.self.alive) await shot(pa, 'coup-15-eliminated-phone', { once: true });
        }
        await delay(1600);
        await shot(pa, 'coup-16-end-phone');
        await shot(pb, 'coup-16-end-desktop', { wait: 0 });
        await shot(pb, 'coup-16-end-desktop-full', { full: true, wait: 0 });
        await pa.context().close(); await pb.context().close();
        C.socket.close(); D.socket.close();
    }

    /* =========================== AVALON =========================== */
    async function runAvalon() {
        console.log('== Avalon ==');
        const room = await makeRoom(7, 'avalon', 'โต๊ะเทสอวาลอน', 'avalonState', { avalonRoles: ['percival', 'morgana'], avalonLady: true });
        const all = room.players;
        const [A, B] = all;
        const bots = all.slice(2);
        const started = await ack(A.socket, 'startGameFromLobby', { roomId: room.roomId });
        if (!started?.success) throw new Error('เริ่ม avalon ไม่ได้ ' + JSON.stringify(started));
        // เริ่มจริงหลังนับถอยหลัง 3 วิ — ปิด socket ก่อนนั้น = ไม่ได้นั่งโต๊ะ
        await waitFor(() => all.every(p => p.last() && p.last().phase === 'night'), 'avalon night', 15000);
        A.socket.close(); B.socket.close();
        const pa = await openPage(room.roomId, A, { width: 390, height: 844 }, 'avalonState', 'ig-firstplay-avalon');
        const pb = await openPage(room.roomId, B, { width: 1440, height: 900 }, 'avalonState', 'ig-firstplay-avalon');
        await pa.waitForSelector('#avSeats .av-seat');
        const any = () => bots[0].last();
        const byId = id => all.find(p => p.id === id);

        // กลางคืน
        await shot(pa, 'av-01-night-closed-phone');
        await clickIf(pa, '[data-rolecard]');
        await shot(pa, 'av-02-role-open-phone', { wait: 900 });
        await clickIf(pb, '[data-rolecard]');
        await shot(pb, 'av-02-role-open-desktop', { wait: 900 });
        await clickIf(pa, '#avReadyBtn');
        await clickIf(pb, '#avReadyBtn');
        for (const bot of bots) await ack(bot.socket, 'avalon_ready', { step: bot.last().step });

        let proposals = 0;
        let guard = 0;
        let lastStep = -1;
        while (guard++ < 200) {
            await delay(250);
            const s = any();
            if (!s) continue;
            if (s.phase === 'finished') break;
            if (s.step === lastStep) continue;
            if (process.env.TOUR_DEBUG) console.log('   phase', s.phase, s.step);
            const viewA = await pa.evaluate(() => window.__state).catch(() => null);
            if (!viewA || viewA.step !== s.step) continue;
            lastStep = s.step;
            if (s.phase === 'team') {
                const leader = byId(s.leaderId);
                const size = s.currentQuest.size;
                if (leader.page) {
                    const tag = leader === A ? 'phone' : 'desktop';
                    await shot(leader.page, 'av-03-leader-pick-' + tag, { once: true });
                    const team = [leader.id, ...[A.id, B.id].filter(id => id !== leader.id), ...bots.map(b => b.id)].slice(0, size);
                    for (const id of team) await clickIf(leader.page, `button[data-pick="${id}"]`);
                    await shot(leader.page, 'av-03b-leader-picked-' + tag, { once: true });
                    await clickIf(leader.page, '#avTeamBtn');
                } else {
                    await shot(pa, 'av-03-team-waiting-phone', { once: true });
                    const team = [A.id, B.id, leader.id, ...bots.map(b => b.id)].filter((id, i, arr) => arr.indexOf(id) === i).slice(0, size);
                    const r = await ack(leader.socket, 'avalon_team', { teamIds: team, step: leader.last().step });
                    if (!r?.success) console.log('   team fail', JSON.stringify(r), JSON.stringify(team), JSON.stringify(s.players.map(p => p.playerId)));
                }
            } else if (s.phase === 'vote') {
                proposals += 1;
                await shot(pa, 'av-04-vote-phone', { once: true });
                await shot(pb, 'av-04-vote-desktop', { once: true, wait: 0 });
                const reject = proposals === 1;   // ครั้งแรกบอทคัดค้าน ให้เห็นทีมไม่ผ่าน
                await clickIf(pa, reject ? '[data-vote="reject"]' : '[data-vote="approve"]');
                await clickIf(pb, '[data-vote="approve"]');
                await delay(200);
                for (const bot of bots) await ack(bot.socket, 'avalon_vote', { vote: reject ? 'reject' : 'approve', step: bot.last().step });
                await delay(2300);
                await shot(pa, reject ? 'av-05-vote-rejected-phone' : 'av-05b-vote-approved-phone', { once: true, wait: 0 });
                if (reject) await shot(pb, 'av-05-vote-rejected-desktop', { once: true, wait: 0 });
                await pa.keyboard.press('Escape'); await pb.keyboard.press('Escape');
            } else if (s.phase === 'quest') {
                const qn = s.currentQuest.number;
                for (const p of [A, B]) {
                    const v = await p.view();
                    if (v.self.canPlayQuest) {
                        const tag = p === A ? 'phone' : 'desktop';
                        await shot(p.page, 'av-06-quest-card-' + tag, { once: true });
                        await clickIf(p.page, v.self.team === 'evil' && qn === 1 ? '[data-card="fail"]' : '[data-card="success"]');
                    }
                }
                if (!(await A.view()).self.onTeam) await shot(pa, 'av-06-quest-waiting-phone', { once: true });
                for (const bot of bots) {
                    const v = bot.last();
                    if (v.self.canPlayQuest) await ack(bot.socket, 'avalon_quest', { card: v.self.team === 'evil' && qn === 1 ? 'fail' : 'success', step: v.step });
                }
                await delay(3600);
                await shot(pa, 'av-07-quest-result-' + qn + '-phone', { once: true, wait: 0 });
                if (qn === 1) await shot(pb, 'av-07-quest-result-1-desktop', { once: true, wait: 0 });
                await pa.keyboard.press('Escape'); await pb.keyboard.press('Escape');
                await delay(300);
                await shot(pa, 'av-07b-board-after-quest-' + qn + '-phone', { once: true });
            } else if (s.phase === 'lady') {
                const holder = byId(s.lady.holderId);
                if (holder.page) {
                    const tag = holder === A ? 'phone' : 'desktop';
                    await shot(holder.page, 'av-08-lady-holder-' + tag, { once: true });
                    const t = (await holder.view()).ladyTargets[0];
                    await clickIf(holder.page, `button[data-pick="${t}"]`);
                    await clickIf(holder.page, '#avLadyBtn');
                    await delay(500);
                    await clickIf(holder.page, '.swal2-confirm');
                    await delay(900);
                    await shot(holder.page, 'av-08b-lady-result-' + tag, { once: true, wait: 0 });
                    await holder.page.keyboard.press('Escape');
                } else {
                    await shot(pa, 'av-08-lady-waiting-phone', { once: true });
                    const targets = holder.last().ladyTargets || [];
                    const t = targets.includes(A.id) ? A.id : targets[0];
                    await ack(holder.socket, 'avalon_lady', { targetId: t, step: holder.last().step });
                }
            } else if (s.phase === 'assassin') {
                const assassin = byId(s.assassinId);
                await shot(pa, 'av-09-assassin-phase-phone', { once: true });
                await shot(pb, 'av-09-assassin-phase-desktop', { once: true, wait: 0 });
                if (assassin.page) {
                    const t = (await assassin.view()).assassinTargets[0];
                    await clickIf(assassin.page, `button[data-pick="${t}"]`);
                    await clickIf(assassin.page, '#avStabBtn');
                    await delay(500);
                    await clickIf(assassin.page, '.swal2-confirm');
                } else {
                    const v = assassin.last();
                    await ack(assassin.socket, 'avalon_assassinate', { targetId: (v.assassinTargets || [])[0], step: v.step });
                }
                await delay(1200);
                await shot(pa, 'av-10-stab-result-phone', { once: true, wait: 0 });
            }
        }
        await delay(800);
        await pa.keyboard.press('Escape'); await pb.keyboard.press('Escape');
        await shot(pa, 'av-11-end-phone');
        await shot(pa, 'av-11-end-phone-full', { full: true, wait: 0 });
        await shot(pb, 'av-11-end-desktop', { wait: 0 });
        await pa.context().close(); await pb.context().close();
        bots.forEach(b => b.socket.close());
    }

    /* =========================== หน้าที่มีรูปการ์ด =========================== */
    async function runPages() {
        console.log('== Pages ==');
        for (const [vp, tag] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 1440, height: 900 }, 'desktop']]) {
            const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
            await ctx.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; } catch (e) { /* ignore */ } });
            const page = await ctx.newPage();
            page.on('response', r => { if (r.status() === 404 && /\/assets\//.test(r.url())) errors.push('404 ' + r.url()); });
            await page.goto(`${base}/how-to-play#coup`, { waitUntil: 'networkidle' });
            const coupCard = await page.$('#coup');
            if (coupCard) { await coupCard.scrollIntoViewIfNeeded(); await shot(page, 'page-howto-coup-' + tag); }
            const roles = await page.$('#coup img');
            if (roles) { await roles.scrollIntoViewIfNeeded(); await shot(page, 'page-howto-coup-cards-' + tag); }
            const av = await page.$('#avalon img');
            if (av) { await av.scrollIntoViewIfNeeded(); await shot(page, 'page-howto-avalon-cards-' + tag); }
            await ctx.close();
        }
        // ห้องรอ อวาลอน (ตัวเลือกบทเสริม)
        const room = await makeRoom(1, 'avalon', 'ห้องรออวาลอน', 'avalonState');
        const host = room.players[0];
        host.socket.close();
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await ctx.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; } catch (e) { /* ignore */ } });
        const page = await ctx.newPage();
        page.on('response', r => { if (r.status() === 404 && /\/assets\//.test(r.url())) errors.push('404 ' + r.url()); });
        await page.goto(`${base}/?playerId=${host.id}`, { waitUntil: 'domcontentloaded' });
        await page.goto(`${base}/room/${room.roomId}?playerId=${host.id}`, { waitUntil: 'networkidle' });
        const chip = await page.$('[data-avalon-role]');
        if (chip) { await chip.scrollIntoViewIfNeeded(); await shot(page, 'page-lobby-avalon-roles-phone'); }
        await ctx.close();
        // หน้ารวมห้อง (ปกเกม)
        for (const [vp, tag] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 1440, height: 900 }, 'desktop']]) {
            const c2 = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
            await c2.addInitScript(() => { try { sessionStorage.insiderPromoSeen = '1'; } catch (e) { /* ignore */ } });
            const p2 = await c2.newPage();
            p2.on('response', r => { if (r.status() === 404 && /\/assets\//.test(r.url())) errors.push('404 ' + r.url()); });
            await p2.goto(`${base}/rooms?playerId=${host.id}`, { waitUntil: 'networkidle' });
            const coupCover = await p2.$('img[src*="/coup/cover"]');
            if (coupCover) { await coupCover.scrollIntoViewIfNeeded(); await shot(p2, 'page-rooms-covers-' + tag); }
            const avCover = await p2.$('img[src*="/avalon/cover"]');
            if (avCover) { await avCover.scrollIntoViewIfNeeded(); await shot(p2, 'page-rooms-avalon-cover-' + tag); }
            await c2.close();
        }
    }

    try {
        if (ONLY === 'all' || ONLY === 'coup') await runCoup();
        if (ONLY === 'all' || ONLY === 'avalon') await runAvalon();
        if (ONLY === 'all' || ONLY === 'pages') await runPages();
        console.log(errors.length ? '⚠️ ' + errors.join('\n') : 'ไม่มี JS error / 404 รูป');
    } catch (e) {
        console.error('ทัวร์ล้ม:', e);
        process.exitCode = 1;
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
})();
