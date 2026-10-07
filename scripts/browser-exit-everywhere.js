/**
 * ปุ่ม "🚪 ออก" ระหว่างเล่น — ทุกบอร์ด (มาตรฐานใน _briefs/exit-standard.md)
 *
 * แต่ละเกม: ตั้งห้องด้วย socket → เปิดหน้าเกมจริงบนจอ 390×844 ให้ "คนออก" กับ "คนดู"
 * → คนออกเห็นปุ่ม 🚪 ออก (ไม่ต้องเปิดเมนู) → popup บอกผลของการออกตอนนี้ → ยืนยัน
 * → ไป /rooms แล้วรอ 15 วิ ยังอยู่ /rooms · ย้อนกลับก็ไม่ถูก auto-join กลับ
 * → เกมของคนที่เหลือเดินต่อ (ตาย้าย / เกมจบถูกต้อง) และจอคนดูไม่มี error
 *
 * รัน: node scripts/browser-exit-everywhere.js <coup|liar|avalon|...>
 *      (npm run smoke:<game>:exit)
 */
const {
    delay, assert, ack, bootServer, stopServer, setupRoom, startGame, waitFor,
    openGamePage, exitVisible, exitAndStayOut, report
} = require('./exit-e2e-utils');
const { chromium } = require('playwright');

const game = process.argv[2];

/** ขอ state ล่าสุดของผู้เล่นฝั่ง socket (requestState ส่งกลับมาที่ socket นี้) */
async function fresh(p, mode, roomId) {
    const before = p.states.length;
    p.socket.emit(`${mode}_requestState`, { roomId, playerId: p.id });
    await waitFor(() => p.states.length > before, 5000, `${p.label} ได้ ${mode}State`);
    return p.last();
}

const byId = (players, id) => players.find(p => p.id === id);

const SCENARIOS = {
    // ---------------- Coup: คนที่ถึงตาออก → ยอมแพ้ ตาย้ายไปคนถัดไป
    coup: {
        mode: 'coup', stateEvent: 'coupState', count: 3, root: '#myHand', button: '#cpExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await fresh(players[1], 'coup', roomId);
            const leaver = byId(players, s0.currentPlayerId);
            if (!leaver) throw new Error("no current: " + JSON.stringify({ phase: s0.phase, cur: s0.currentPlayerId, ids: players.map(p => p.id) }));
            const others = players.filter(p => p !== leaver);
            const observer = others[0];
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกของคนดู (ไม่ใช่ตาตัวเอง): ' + await exitVisible(observer.page, ctx.button));
            await exitAndStayOut(leaver, { button: ctx.button, label: 'coup/ตาตัวเอง', expect: /ยอมแพ้[\s\S]*ข้ามไปคนต่อไป[\s\S]*เกมเล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'coup', roomId);
            assert(s1.phase !== 'finished', 'เหลือ 2 คน เกมต้องเล่นต่อ');
            assert(s1.currentPlayerId && s1.currentPlayerId !== leaver.id, 'ตาต้องย้ายจากคนที่ออก');
            assert(s1.players.find(p => p.playerId === leaver.id)?.alive === false || !s1.players.find(p => p.playerId === leaver.id), 'คนออกต้องตกรอบ');
            await waitFor(async () => /ออกจากเกม/.test(await observer.page.textContent('#historyFeed')), 6000, 'บันทึกเกมบอกว่าออก');
            // จอคนดูยังเล่นได้: ถ้าถึงตาคนดู กดรายได้ผ่าน UI
            if (s1.currentPlayerId === observer.id) {
                const coins = Number(await observer.page.textContent('#myCoins'));
                await observer.page.click('.cp-action[data-action="income"]');
                await waitFor(async () => Number(await observer.page.textContent('#myCoins')) === coins + 1, 6000, 'คนดูกดรายได้ได้');
            } else {
                const actor = byId(players, s1.currentPlayerId);
                assert((await ack(actor.socket, 'coup_submitAction', { actionId: 'income' }))?.success, 'คนถัดไปเล่นต่อได้');
            }
            const s2 = await fresh(observer, 'coup', roomId);
            assert(s2.turnNumber > s1.turnNumber || s2.currentPlayerId !== s1.currentPlayerId, 'เกมเดินต่อหลังคนออก');
            console.log('coup: ตาตัวเองกดออก → ยอมแพ้ ตาย้าย · คนที่เหลือเล่นต่อ ✓');
            ctx.observer = observer;
        }
    },
    // ---------------- ไพ่โกหก: คนที่ถึงตาออก → ตกรอบ ตาย้าย ไม่ค้างที่คนที่ไม่อยู่
    liar: {
        mode: 'liar', stateEvent: 'liarState', count: 3, root: '#lrNowCopy', button: '#lrExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await fresh(players[1], 'liar', roomId);
            const leaver = byId(players, s0.currentPlayerId);
            assert(leaver, 'liar: ต้องมีคนถึงตา (phase ' + s0.phase + ')');
            const observer = players.find(p => p !== leaver);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            await exitAndStayOut(leaver, { button: ctx.button, label: 'liar/ตาตัวเอง', expect: /ตกรอบ[\s\S]*ข้ามไปคนต่อไป[\s\S]*เกมเล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'liar', roomId);
            assert(s1.phase === 'turn', 'เหลือ 2 คน เกมต้องเล่นต่อ (phase ' + s1.phase + ')');
            assert(s1.currentPlayerId && s1.currentPlayerId !== leaver.id, 'ตาต้องย้ายจากคนที่ออก');
            const leftSeat = s1.players.find(p => p.playerId === leaver.id);
            assert(leftSeat && leftSeat.alive === false, 'คนออกต้องตกรอบ (ยังเห็นที่นั่งว่าออกแล้ว)');
            assert((s1.history || []).some(h => /ออกจากเกม/.test(h.text || h.message || JSON.stringify(h))), 'บันทึกเกมบอกว่าออก');
            const actor = byId(players, s1.currentPlayerId);
            const actorState = await fresh(actor, 'liar', roomId);
            const card = actorState.self.hand[0];
            const played = await ack(actor.socket, 'liar_play', { cardIds: [card.id] });
            assert(played && played.success, 'คนถัดไปลงไพ่ได้: ' + JSON.stringify(played));
            const s2 = await fresh(observer, 'liar', roomId);
            assert(s2.currentPlayerId !== actor.id && s2.currentPlayerId !== leaver.id, 'ตาเดินต่อ ไม่วนกลับไปคนที่ออก');
            await waitFor(async () => (await observer.page.textContent('#lrNowCopy')).trim().length > 0, 5000, 'จอคนดูยังอัปเดต');
            console.log('liar: ตาตัวเองกดออก → ตกรอบ ตาย้าย · คนที่เหลือเล่นต่อ ✓');
        }
    },
    // ---------------- อวาลอน 6 คน: หัวหน้าออกตอนเลือกทีม → ส่งต่อหัวหน้า โต๊ะเล่นต่อ 5 คน
    avalon: {
        mode: 'avalon', stateEvent: 'avalonState', count: 6, root: '#avRoot', button: '#avExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            for (const p of players) {
                const st = await fresh(p, 'avalon', roomId);
                if (st.phase === 'night') await ack(p.socket, 'avalon_ready', { step: st.step });
            }
            const s0 = await waitFor(async () => { const st = await fresh(players[0], 'avalon', roomId); return st.phase === 'team' ? st : null; }, 10000, 'อวาลอนเข้าเฟสเลือกทีม');
            const leaver = byId(players, s0.leaderId);
            assert(leaver, 'ต้องมีหัวหน้า');
            const observer = players.find(p => p !== leaver);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกคนดู: ' + await exitVisible(observer.page, ctx.button));
            await exitAndStayOut(leaver, { button: ctx.button, label: 'avalon/หัวหน้า', expect: /หัวหน้า[\s\S]*ส่งต่อ[\s\S]*โต๊ะเล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'avalon', roomId);
            assert(s1.phase === 'team', 'เหลือ 5 คน ยังเล่นต่อในเฟสเลือกทีม (ได้ ' + s1.phase + ')');
            assert(s1.leaderId && s1.leaderId !== leaver.id, 'หัวหน้าต้องย้าย');
            assert(s1.players.find(p => p.playerId === leaver.id)?.left === true, 'ที่นั่งคนออกขึ้นว่าออกแล้ว');
            const leader = byId(players, s1.leaderId);
            const ls = await fresh(leader, 'avalon', roomId);
            const teamIds = ls.players.filter(p => !p.left).slice(0, ls.currentQuest.size).map(p => p.playerId);
            const r = await ack(leader.socket, 'avalon_team', { teamIds, step: ls.step });
            assert(r && r.success, 'หัวหน้าคนใหม่เลือกทีมได้: ' + JSON.stringify(r));
            const s2 = await fresh(observer, 'avalon', roomId);
            assert(s2.phase === 'vote', 'เลือกทีมแล้วเข้าโหวต');
            await waitFor(async () => /ออก/.test(await observer.page.textContent('#avRoot')), 5000, 'จอคนดูยังอัปเดต');
            console.log('avalon: หัวหน้ากดออก → ส่งต่อหัวหน้า · โต๊ะ 5 คนเล่นต่อ ✓');
        }
    }
};

(async () => {
    const sc = SCENARIOS[game];
    if (!sc) { console.error('ไม่รู้จักเกม: ' + game + ' (มี ' + Object.keys(SCENARIOS).join(', ') + ')'); process.exit(2); }
    const server = await bootServer(sc.env || {});
    const browser = await chromium.launch({ headless: true });
    const ctx = { browser, base: server.base, root: sc.root, button: sc.button };
    try {
        const room = await setupRoom(server.base, { mode: sc.mode, count: sc.count, stateEvent: sc.stateEvent, roomOptions: sc.roomOptions });
        Object.assign(ctx, room);
        if (sc.beforeStart) await sc.beforeStart(ctx);
        await startGame(room.host, room.roomId);
        await sc.run(ctx);
        const pages = room.players.filter(p => p.page);
        for (const p of pages) {
            const errs = (p.errors || []).filter(e => !/WebSocket is closed|ERR_ABORTED|net::/i.test(e));
            assert(errs.length === 0, `${p.label}: JS error ${errs.join(' | ')}`);
        }
        report('exit ' + game);
    } catch (error) {
        console.error('❌', error.message);
        if (process.env.EXIT_DEBUG) console.error(server.child.logs().slice(-3000));
        process.exitCode = 1;
    } finally {
        await browser.close().catch(() => {});
        (ctx.players || []).forEach(p => { try { p.socket.close(); } catch (e) { /* */ } });
        await stopServer(server);
        process.exit(process.exitCode || 0);
    }
})();
