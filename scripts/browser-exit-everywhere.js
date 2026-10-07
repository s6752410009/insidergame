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
    },
    // ---------------- คลื่นความคิด (รับคนเข้ากลางเกม): ผู้ใบ้ออกตอนคิดคำ → ข้ามรอบ ผู้ใบ้คนถัดไป
    // จุดสำคัญ: เดิมย้อนกลับ/เปิด /room/ หลังออก = auto-join กลับเข้าเกมทันที
    wavelength: {
        mode: 'wavelength', stateEvent: 'wavelengthState', count: 3, root: '#wlRoot', button: '#wlExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await waitFor(async () => { const st = await fresh(players[1], 'wavelength', roomId); return st.phase === 'clue' && st.giverId ? st : null; }, 10000, 'เฟสคิดคำใบ้');
            const leaver = byId(players, s0.giverId);
            const observer = players.find(p => p !== leaver);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกคนดู: ' + await exitVisible(observer.page, ctx.button));
            await exitAndStayOut(leaver, { button: ctx.button, label: 'wavelength/ผู้ใบ้', expect: /ผู้ใบ้[\s\S]*ข้ามรอบ[\s\S]*เกมเล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'wavelength', roomId);
            // ข้ามรอบแล้วโชว์สั้น ๆ — ระหว่างรอ 15 วิ อาจเข้ารอบถัดไปแล้ว
            const skipped = (s1.phase === 'reveal' && s1.lastRound && s1.lastRound.skipped)
                || (s1.phase === 'clue' && s1.round > s0.round && s1.giverId !== leaver.id);
            assert(skipped, 'ผู้ใบ้ออก → ข้ามรอบ (ได้ ' + s1.phase + ' รอบ ' + s1.round + ')');
            assert((s1.history || []).some(h => /ออกจากห้อง/.test(h.text || JSON.stringify(h))), 'บันทึกเกมบอกว่าผู้ใบ้ออก');
            assert(!s1.players.some(p => p.playerId === leaver.id), 'คนออกไม่ถูกพากลับเข้าเกม');
            for (const p of players.filter(x => x !== leaver)) {
                const st = await fresh(p, 'wavelength', roomId);
                if (st.phase === 'reveal') await ack(p.socket, 'wavelength_next', { roomId, round: st.round, phase: st.phase });
            }
            const s2 = await waitFor(async () => { const st = await fresh(observer, 'wavelength', roomId); return st.phase === 'clue' ? st : null; }, 12000, 'รอบถัดไปเริ่ม');
            assert(s2.giverId && s2.giverId !== leaver.id && s2.round > s0.round, 'ผู้ใบ้คนใหม่ รอบใหม่');
            await waitFor(async () => /คิดคำใบ้/.test(await observer.page.textContent('#wlNowPhase')), 6000, 'จอคนดูขึ้นรอบใหม่');
            console.log('wavelength: ผู้ใบ้กดออก → ข้ามรอบ · ไม่ถูก auto-join กลับ · รอบถัดไปเดินต่อ ✓');
        }
    },
    // ---------------- วาดแล้วทาย: คนวาดออก → ข้ามตาไปคนถัดไป
    drawguess: {
        mode: 'drawguess', stateEvent: 'drawguessState', count: 3, root: '#dgRoot', button: '#dgExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await waitFor(async () => { const st = await fresh(players[1], 'drawguess', roomId); return (st.phase === 'choose' || st.phase === 'draw') && st.drawerId ? st : null; }, 12000, 'มีคนวาด');
            const leaver = byId(players, s0.drawerId);
            const observer = players.find(p => p !== leaver);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1200);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกคนดู: ' + await exitVisible(observer.page, ctx.button));
            await exitAndStayOut(leaver, { button: ctx.button, label: 'drawguess/คนวาด', expect: /คนวาดอยู่[\s\S]*ข้ามไปคนต่อไป[\s\S]*เกมเล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'drawguess', roomId);
            assert(s1.phase !== 'finished', 'เหลือ 2 คน เกมเล่นต่อ (ได้ ' + s1.phase + ')');
            assert(s1.players.find(p => p.playerId === leaver.id)?.left === true, 'คนออกขึ้นว่าออกแล้ว');
            assert(s1.turnNo > s0.turnNo || s1.drawerId !== leaver.id, 'ตาย้ายจากคนวาดที่ออก');
            assert((s1.feed || []).some(f => /ออกจากเกม/.test(f.text || '')), 'ฟีดบอกว่าออก');
            const s2 = await waitFor(async () => { const st = await fresh(observer, 'drawguess', roomId); return (st.phase === 'choose' || st.phase === 'draw') && st.drawerId ? st : null; }, 15000, 'ตาวาดถัดไป');
            assert(s2.drawerId !== leaver.id, 'คนวาดคนใหม่ไม่ใช่คนที่ออก');
            await waitFor(async () => /ออกจากเกม/.test(await observer.page.textContent('#dgRoot')), 6000, 'จอคนดูเห็นว่าออก');
            console.log('drawguess: คนวาดกดออก → ข้ามตา · คนที่เหลือเล่นต่อ ✓');
        }
    },
    // ---------------- สายลับคำใบ้ 5 คน: หัวหน้าทีมที่ถึงตาออกตอนใบ้ → ลูกทีมเป็นหัวหน้าแทน เล่นต่อ
    codenames: {
        mode: 'codenames', stateEvent: 'codenamesState', count: 5, root: '#cnRoot', button: '#cnLeaveBtn',
        async beforeStart(ctx) {
            const [p1, p2, p3, p4, p5] = ctx.players;
            const picks = [[p1, 'red', 'spymaster'], [p2, 'red', 'operative'], [p3, 'red', 'operative'], [p4, 'blue', 'spymaster'], [p5, 'blue', 'operative']];
            for (const [p, team, role] of picks) {
                const r = await ack(p.socket, 'codenames_pickTeam', { team, role });
                assert(r && r.success, 'เลือกทีม ' + p.label + ': ' + JSON.stringify(r));
            }
        },
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await waitFor(async () => { const st = await fresh(players[1], 'codenames', roomId); return st.phase === 'clue' && st.currentTeam ? st : null; }, 10000, 'เฟสใบ้');
            const team = s0.currentTeam;
            const smId = s0.teams[team].members.find(m => m.role === 'spymaster').playerId;
            const leaver = byId(players, smId);
            const observer = byId(players, s0.teams[team].members.find(m => m.role === 'operative').playerId);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1200);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกคนดู: ' + await exitVisible(observer.page, ctx.button));
            await exitAndStayOut(leaver, { button: ctx.button, label: 'codenames/หัวหน้า', expect: /หัวหน้า[\s\S]*แทน[\s\S]*เล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'codenames', roomId);
            assert(s1.phase === 'clue' && s1.currentTeam === team, 'ทีมเดิมยังใบ้ต่อ (ได้ ' + s1.phase + '/' + s1.currentTeam + ')');
            const newSm = s1.teams[team].members.find(m => m.role === 'spymaster' && !m.left);
            assert(newSm && newSm.playerId !== leaver.id, 'มีหัวหน้าคนใหม่');
            assert(s1.teams[team].members.find(m => m.playerId === leaver.id)?.left === true, 'คนออกขึ้นว่าออก');
            const sm = byId(players, newSm.playerId);
            const sms = await fresh(sm, 'codenames', roomId);
            const r = await ack(sm.socket, 'codenames_clue', { word: 'ทะเลสาบ', number: 1, step: sms.step });
            assert(r && r.success, 'หัวหน้าคนใหม่ใบ้ได้: ' + JSON.stringify(r));
            const s2 = await fresh(observer, 'codenames', roomId);
            assert(s2.phase === 'guess', 'เข้าเฟสทาย');
            await waitFor(async () => /ทะเลสาบ/.test(await observer.page.textContent('#cnRoot')), 6000, 'จอคนดูเห็นคำใบ้ใหม่');
            console.log('codenames: หัวหน้ากดออก → ลูกทีมเป็นหัวหน้าแทน · ใบ้ต่อได้ ✓');
        }
    },
    // ---------------- เศรษฐี 3 คน: คนที่ถึงตาทอยออก → ที่ดินคืนธนาคาร ตาย้ายไปคนถัดไป
    setthi: {
        mode: 'setthi', stateEvent: 'setthiState', count: 3, root: '#stRoot', button: '#stExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await waitFor(async () => { const st = await fresh(players[1], 'setthi', roomId); return st.phase === 'roll' && st.turn && st.turn.playerId ? st : null; }, 12000, 'ตาทอยเต๋า');
            const leaver = byId(players, s0.turn.playerId);
            const observer = players.find(p => p !== leaver);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกคนดู: ' + await exitVisible(observer.page, ctx.button));
            await exitAndStayOut(leaver, { button: ctx.button, label: 'setthi/ตาตัวเอง', expect: /คืนธนาคาร[\s\S]*ข้ามไปคนต่อไป[\s\S]*เกมเล่นต่อโดยไม่มีคุณ/ });
            const s1 = await fresh(observer, 'setthi', roomId);
            assert(s1.phase !== 'finished', 'เหลือ 2 คน เกมเล่นต่อ (ได้ ' + s1.phase + ')');
            assert(s1.seats.find(x => x.playerId === leaver.id)?.left === true, 'ที่นั่งคนออกขึ้นว่าออก');
            assert(s1.turn && s1.turn.playerId !== leaver.id, 'ตาย้ายจากคนที่ออก');
            const s2 = await waitFor(async () => { const st = await fresh(observer, 'setthi', roomId); return st.phase === 'roll' ? st : null; }, 15000, 'ตาทอยของคนถัดไป');
            const actor = byId(players, s2.turn.playerId);
            assert(actor && actor !== leaver, 'คนทอยคนถัดไปยังอยู่');
            const r = await ack(actor.socket, 'setthi_roll', { seq: s2.phaseSeq });
            assert(r && r.success !== false, 'คนถัดไปทอยได้: ' + JSON.stringify(r));
            await waitFor(async () => { const st = await fresh(observer, 'setthi', roomId); return st.phaseSeq !== s2.phaseSeq; }, 8000, 'เกมเดินต่อหลังทอย');
            console.log('setthi: ตาตัวเองกดออก → ที่ดินคืนธนาคาร ตาย้าย · คนที่เหลือทอยต่อ ✓');
        }
    },
    // ---------------- Insider 4 คน: คนสุดท้ายที่ยังไม่โหวตกดออกช่วงโหวต (ปุ่มผู้เล่นถูกซ่อนช่วงนี้)
    // → คนที่เหลือโหวตครบแล้ว สรุปผลทันที ไม่ต้องรอหมดเวลา
    insider: {
        mode: 'insider', stateEvent: null, count: 4, root: '#insExitBtn', button: '#insExitBtn',
        async beforeStart(ctx) {
            for (const p of ctx.players) {
                p.events = [];
                ['newRole', 'startGame', 'displayVote2', 'vote2Ended'].forEach(name => p.socket.on(name, payload => p.events.push({ name, payload })));
            }
        },
        async run(ctx) {
            const { players, roomId, browser, base, host } = ctx;
            const ev = (p, name) => p.events.find(e => e.name === name);
            await waitFor(() => players.every(p => ev(p, 'newRole')), 10000, 'แจกบท');
            players.forEach(p => { p.role = ev(p, 'newRole').payload.role; });
            const gm = players.find(p => p.role === 'ผู้ดำเนินเกม');
            assert(gm, 'มีผู้ดำเนินเกม');
            const r = await ack(gm.socket, 'setWord', { word: 'ช้าง' });
            assert(r && r.ok, 'ตั้งคำ: ' + JSON.stringify(r));
            gm.socket.emit('revealWord');
            await delay(2300);
            host.socket.emit('startGame');
            await waitFor(() => ev(gm, 'startGame'), 8000, 'เริ่มช่วงคุย');
            const others = players.filter(p => p !== gm);
            const leaver = others.find(p => p !== host) || others[0];
            const observer = others.find(p => p !== leaver);
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            assert((await exitVisible(leaver.page, ctx.button)) === 'ok', 'ปุ่มออกช่วงคุย: ' + await exitVisible(leaver.page, ctx.button));
            gm.socket.emit('wordFound');
            await waitFor(() => ev(observer, 'displayVote2'), 8000, 'เปิดโหวต');
            const vote = ev(observer, 'displayVote2').payload;
            const voteStart = Date.now();
            const nameOf = id => (vote.progress.targets.find(t => t.playerId === id) || {}).name;
            for (const p of others.filter(x => x !== leaver)) {
                p.socket.emit('vote2', { player: nameOf(p.id), vote: vote.players.find(c => c.playerId !== p.id).playerId });
            }
            await leaver.page.waitForFunction(() => document.body.classList.contains('ins-voting'), null, { timeout: 8000 }).catch(async e => {
                const info = await leaver.page.evaluate(() => ({ url: location.href, cls: document.body.className, vote: !!document.querySelector('#vote2') && getComputedStyle(document.querySelector('#vote2')).display }));
                throw new Error('ไม่เข้าโหมดโหวต ' + JSON.stringify(info) + ' events=' + JSON.stringify(observer.events.map(x => x.name)) + ' errs=' + leaver.errors.join('|'));
            });
            await delay(500);
            assert(!observer.events.some(e => e.name === 'vote2Ended'), 'ยังรอคนที่ยังไม่โหวต');
            let resultAt = 0;
            await exitAndStayOut(leaver, {
                button: ctx.button, label: 'insider/ช่วงโหวต', expect: /โหวตของคุณไม่นับ[\s\S]*เกมเล่นต่อโดยไม่มีคุณ/,
                onLeft: async () => {
                    await waitFor(() => observer.events.some(e => e.name === 'vote2Ended'), 6000, 'สรุปโหวตหลังคนออก');
                    resultAt = Date.now();
                    await observer.page.waitForSelector('#vote2Result', { state: 'visible', timeout: 8000 });
                }
            });
            assert(resultAt - voteStart < 14000, 'สรุปผลทันทีที่คนที่เหลือโหวตครบ ไม่รอหมดเวลา (' + (resultAt - voteStart) + 'ms)');
            // จบรอบแล้วระบบพาทุกคนกลับห้องรอเอง (คนดูไม่ค้างหน้าเกม)
            await waitFor(async () => /\/room\/|\/game\//.test(observer.page.url()), 5000, 'คนดูอยู่ในห้องต่อ');
            console.log('insider: ออกช่วงโหวต → ปุ่มเห็น · คนที่เหลือโหวตครบ สรุปผลทันที ✓');
        }
    },
    // ---------------- Black Market 4 คน: ออกช่วงตลาด → ตกรอบ ยกเดินต่อเมื่อคนที่เหลือเลือกครบ
    blackmarket: {
        mode: 'blackmarket', stateEvent: 'blackmarketState', count: 4, root: '#bmExitBtn', button: '#bmExitBtn',
        async run(ctx) {
            const { players, roomId, browser, base } = ctx;
            const s0 = await waitFor(async () => { const st = await fresh(players[1], 'blackmarket', roomId); return st.phase === 'market' ? st : null; }, 12000, 'ช่วงตลาด');
            const leaver = players[3];
            const observer = players[1];
            leaver.socket.close();
            await openGamePage(browser, base, roomId, leaver, ctx.root);
            await openGamePage(browser, base, roomId, observer, ctx.root);
            await delay(1500);
            assert((await exitVisible(observer.page, ctx.button)) === 'ok', 'ปุ่มออกคนดู: ' + await exitVisible(observer.page, ctx.button));
            // คนที่เหลือเลือกผ่านหมดแล้ว รอแค่คนที่จะออก
            for (const p of players.filter(x => x !== leaver)) {
                const r = await ack(p.socket, 'blackmarket_buyOffer', { roomId, playerId: p.id, itemId: '__pass__' });
                assert(r && r.success !== false, p.label + ' เลือกตลาด: ' + JSON.stringify(r));
            }
            const mid = await fresh(observer, 'blackmarket', roomId);
            assert(mid.phase === 'market', 'ยังรอคนที่จะออก');
            let movedAt = 0;
            const t0 = Date.now();
            await exitAndStayOut(leaver, {
                button: ctx.button, label: 'blackmarket/ตลาด', expect: /ตกรอบ[\s\S]*โต๊ะเล่นต่อโดยไม่มีคุณ/,
                onLeft: async () => {
                    await waitFor(async () => { const st = await fresh(observer, 'blackmarket', roomId); return st.phase !== 'market' || st.roundNumber !== mid.roundNumber; }, 6000, 'ปิดตลาดหลังคนออก');
                    movedAt = Date.now();
                }
            });
            assert(movedAt && movedAt - t0 < 20000, 'ยกเดินต่อทันทีหลังคนออก');
            const s1 = await fresh(observer, 'blackmarket', roomId);
            const seat = (s1.players || []).find(p => p.playerId === leaver.id);
            assert(!seat || seat.alive === false, 'คนออกไม่อยู่ในโต๊ะแล้ว');
            assert(s1.phase !== 'finished' && !s1.winner, 'เหลือ 3 คน เล่นต่อ');
            console.log('blackmarket: ออกช่วงตลาด → ยกเดินต่อทันที · โต๊ะ 3 คนเล่นต่อ ✓');
            void s0;
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
