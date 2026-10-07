#!/usr/bin/env node
'use strict';

/**
 * Spyfall บนมือถือ 390×844 — กติกาเอกฉันท์ + ปุ่ม 🚪 ออก
 * - ปุ่มออกเห็นทุกช่วง (เปิดบท / คุย / กล่าวหา / เฉลย) ไม่ล้นจอ
 * - 🛑 กล่าวหา → ทุกคนเห็นแผง ✅/❌ · มีคนไม่เห็นด้วย = เวลาเดินต่อ
 * - พลเมืองกดออกกลางรอบ → ยืนยัน → ไป /rooms · รอ 15 วิ ยังอยู่ /rooms (ไม่ถูกดึงกลับ)
 *   คนที่เหลือเล่นต่อได้ (เหลือ 3 คน ยังช่วงคุย) แล้วจบรอบได้ปกติ
 *
 * รัน: npm run smoke:spyfall:exit
 */

const { chromium } = require('playwright');
const {
    assert,
    attachStateEvent,
    bindRoom,
    closeSessions,
    connectClient,
    createClient,
    createMobilePage,
    delay,
    emitAck,
    spawnServer,
    stopServer,
    waitState
} = require('./mobile-e2e-utils');

async function assertExitButton(session, label) {
    const box = await session.page.evaluate(() => {
        const btn = document.getElementById('sfExitBtn');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        const style = getComputedStyle(btn);
        return {
            visible: style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0,
            left: r.left, right: r.right, height: r.height,
            text: btn.textContent.trim(),
            vw: window.innerWidth,
            docWidth: document.documentElement.scrollWidth
        };
    });
    assert(box && box.visible, `${label}: 🚪 ออก must be visible`);
    assert(/ออก/.test(box.text) && box.text.includes('🚪'), `${label}: exit label "${box.text}"`);
    assert(box.left >= 0 && box.right <= box.vw + 1, `${label}: exit button off-screen`);
    assert(box.height >= 40, `${label}: exit button too small (${box.height})`);
    assert(box.docWidth <= box.vw + 2, `${label}: horizontal scroll (${box.docWidth}/${box.vw})`);
}

async function main() {
    const clients = [];
    const sessions = [];
    let server;
    let browser;
    try {
        server = await spawnServer({
            SPYFALL_REVEAL_PHASE_MS: '6000',
            MONGO_URL: ''
        });
        browser = await chromium.launch({ headless: true });

        for (let index = 0; index < 4; index += 1) {
            const client = attachStateEvent(createClient(server.baseUrl, `seat-${index + 1}`, 'spyfallState'), 'spyfallState');
            await connectClient(client);
            clients.push(client);
        }
        const [admin, ...guests] = clients;
        const created = await emitAck(admin.socket, 'createRoom', {
            playerId: admin.playerId,
            name: `Spyfall Exit ${Date.now()}`,
            gameMode: 'spyfall',
            maxPlayers: 8,
            roundTime: 3,
            spyfallRounds: 3
        });
        assert(created?.success && created.roomId, `create failed: ${created?.error}`);
        const roomId = created.roomId;
        bindRoom(admin, roomId, 'spyfall_requestState');
        for (const client of guests) {
            const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joined?.success, `${client.label} join failed`);
            bindRoom(client, roomId, 'spyfall_requestState');
        }
        const started = await emitAck(admin.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(started?.success, `start failed: ${started?.error}`);
        await delay(300);
        clients.forEach(client => bindRoom(client, roomId, 'spyfall_requestState'));
        const reveal = await Promise.all(clients.map(c => waitState(c, roomId, s => s.phase === 'reveal' && s.self, 20000)));
        reveal.forEach((state, index) => { clients[index].isSpy = !!state.self.isSpy; });

        for (const client of clients) {
            sessions.push(await createMobilePage(browser, server.baseUrl, roomId, client, '.sf-shell'));
        }

        console.log('1. 🚪 ออก visible in reveal');
        for (const s of sessions) await assertExitButton(s, `reveal/${s.client.label}`);

        console.log('2. discussion: 🛑 accuse → everyone sees ✅/❌ → one ❌ → clock runs again');
        await Promise.all(sessions.map(s => s.page.waitForFunction(() => /ช่วงคุย/.test(document.getElementById('phaseChip').textContent), null, { timeout: 30000 })));
        for (const s of sessions) await assertExitButton(s, `discussion/${s.client.label}`);
        const roundChip = await sessions[0].page.textContent('#sfRoundChip');
        assert(/รอบ 1\/3/.test(roundChip) && /เจ้ามือ/.test(roundChip), `round chip: ${roundChip}`);

        const citizenSessions = sessions.filter(s => !s.client.isSpy);
        const spySession = sessions.find(s => s.client.isSpy);
        const accuser = citizenSessions[0];
        const suspect = citizenSessions[1];
        const leaver = citizenSessions[2];
        await accuser.page.click('#sfAccuseBtn');
        await accuser.page.waitForSelector('.sf-accuse-tile');
        await accuser.page.click(`.sf-accuse-tile[data-target-id="${suspect.client.playerId}"]`);
        await accuser.page.click('.swal2-confirm');
        await Promise.all(sessions.map(s => s.page.waitForFunction(() => /กล่าวหา/.test(document.getElementById('phaseChip').textContent), null, { timeout: 10000 })));
        for (const s of sessions) await assertExitButton(s, `accuse/${s.client.label}`);
        assert(await suspect.page.$('#sfAgreeBtn') === null, 'suspect must not get vote buttons');
        assert(await spySession.page.$('#sfAgreeBtn') !== null, 'other players get ✅/❌');
        assert(await spySession.page.$('#sfGuessLocationBtn') === null, 'spy cannot guess while the clock is stopped');
        await leaver.page.click('#sfDisagreeBtn');
        await Promise.all(sessions.map(s => s.page.waitForFunction(() => /ช่วงคุย/.test(document.getElementById('phaseChip').textContent), null, { timeout: 10000 })));
        const usedLabel = await accuser.page.textContent('.sf-accuse-btn');
        assert(/กล่าวหาไปแล้ว/.test(usedLabel), `accuser used their stop: ${usedLabel}`);

        console.log('3. citizen taps 🚪 ออก mid-round → confirm → /rooms, no pull-back for 15 s');
        await leaver.page.click('#sfExitBtn');
        await leaver.page.waitForSelector('.swal2-popup');
        const dialog = await leaver.page.evaluate(() => ({
            title: document.querySelector('.swal2-title')?.textContent || '',
            body: document.querySelector('.swal2-html-container')?.textContent || '',
            ok: document.querySelector('.swal2-confirm')?.textContent || '',
            cancel: document.querySelector('.swal2-cancel')?.textContent || ''
        }));
        assert(dialog.title === 'ออกจากห้อง?', `dialog title: ${dialog.title}`);
        assert(dialog.ok === 'ออกจากห้อง' && dialog.cancel === 'อยู่ต่อ', `dialog buttons: ${dialog.ok}/${dialog.cancel}`);
        assert(/เล่นต่อโดยไม่มีคุณ/.test(dialog.body), `dialog explains the consequence: ${dialog.body}`);
        await leaver.page.click('.swal2-confirm');
        await leaver.page.waitForURL(/\/rooms/, { timeout: 8000 });
        await delay(15000);
        const urlAfter = leaver.page.url();
        assert(/\/rooms/.test(urlAfter) && !/\/game\//.test(urlAfter), `pulled back into the game: ${urlAfter}`);

        console.log('4. the others keep playing: 3 players, still in discussion, history says who left');
        const stayers = sessions.filter(s => s !== leaver);
        for (const s of stayers) {
            await s.page.waitForFunction(() => document.querySelectorAll('#onlinePlayerList li').length === 3, null, { timeout: 10000 });
            const phase = await s.page.textContent('#phaseChip');
            assert(/ช่วงคุย/.test(phase), `${s.client.label}: game stalled after leave (${phase})`);
        }

        console.log('5. the round still ends normally (spy guesses) and the exit button stays on the recap');
        await spySession.page.click('#sfGuessLocationBtn');
        await spySession.page.waitForSelector('.sf-guess-tile');
        await spySession.page.click('.sf-guess-tile >> nth=0');
        await spySession.page.click('.swal2-confirm');
        await spySession.page.waitForFunction(() => /ยืนยันทาย/.test(document.querySelector('.swal2-title')?.textContent || ''), null, { timeout: 5000 });
        await spySession.page.click('.swal2-confirm');
        await Promise.all(stayers.map(s => s.page.waitForFunction(() => /เฉลย/.test(document.getElementById('phaseChip').textContent), null, { timeout: 10000 })));
        for (const s of stayers) await assertExitButton(s, `finished/${s.client.label}`);
        const recap = await stayers[0].page.evaluate(() => ({
            points: document.querySelectorAll('.sf-points-row').length,
            note: document.getElementById('sfReturnNote')?.textContent || ''
        }));
        assert(recap.points >= 3, `scoreboard rows: ${recap.points}`);
        assert(/รอบต่อไป/.test(recap.note), `next-round countdown: ${recap.note}`);

        const pageErrors = sessions.flatMap(s => s.errors.filter(e => !/Failed to load resource|beforeunload|WebSocket|socket\.io/i.test(e)));
        assert(pageErrors.length === 0, `browser errors: ${pageErrors.join(' | ')}`);
        console.log('SPYFALL_EXIT_OK');
    } finally {
        clients.forEach(c => c.socket.disconnect());
        await closeSessions(sessions);
        if (browser) await browser.close();
        await stopServer(server);
    }
}

main().catch(error => {
    console.error('SPYFALL_EXIT_FAIL', error.stack || error.message);
    process.exitCode = 1;
});
