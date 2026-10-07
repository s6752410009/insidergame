#!/usr/bin/env node
'use strict';
// Exit standard for Werewolf at 390×844: "🚪 ออก" visible + tappable in every phase,
// phase-specific confirm, leaveRoom → /rooms, no pull-back after 15 s, the others play on.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
    assert, attachStateEvent, bindRoom, closeSessions, connectClient, createArtifactDir, createClient,
    createMobilePage, delay, emitAck, restoreDataFiles, snapshotDataFiles, spawnServer, stopServer, waitState
} = require('./mobile-e2e-utils');

const ROLES = ['werewolf', 'seer', 'doctor', 'mayor', 'villager', 'villager'];
const PHASE_LABELS = { night: 'กลางคืน', 'day-discussion': 'ประชุม', 'day-vote': 'โหวต', finished: 'จบ' };

async function prepare(session) {
    await session.page.evaluate(() => { try { localStorage.setItem('ig-firstplay-werewolf', '1'); } catch (e) {} document.getElementById('ppFirstPlay')?.remove(); });
}

async function waitUiPhase(session, phase) {
    await session.page.waitForFunction(expected => (document.getElementById('mobilePhaseLabel')?.textContent || '').includes(expected), PHASE_LABELS[phase], { timeout: 40000 });
}

async function exitVisible(session, label) {
    const info = await session.page.evaluate(() => {
        const btn = document.getElementById('leaveWerewolfRoom');
        if (!btn) return { exists: false };
        const r = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const describe = el => el ? `${el.tagName}#${el.id}.${String(el.className).slice(0, 60)}` : 'none';
        return {
            hit: describe(hit),
            hitParent: describe(hit && hit.parentElement),
            exists: true,
            text: btn.textContent.trim(),
            w: r.width,
            h: r.height,
            inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
            onTop: hit === btn || btn.contains(hit)
        };
    });
    assert(info.exists, `${label}: no exit button`);
    assert(/🚪/.test(info.text) && /ออก/.test(info.text), `${label}: exit label "${info.text}"`);
    assert(info.w >= 44 && info.h >= 44, `${label}: exit too small ${info.w}x${info.h}`);
    assert(info.inView && info.onTop, `${label}: exit not visible/covered (${JSON.stringify(info)})`);
}

async function main() {
    const dataSnapshot = snapshotDataFiles();
    const dir = process.env.WEREWOLF_SHOT_DIR || createArtifactDir('werewolf-exit');
    fs.mkdirSync(dir, { recursive: true });
    const clients = [];
    const sessions = [];
    let server;
    let browser;
    try {
        server = await spawnServer();
        for (let i = 0; i < ROLES.length; i += 1) {
            const client = attachStateEvent(createClient(server.baseUrl, `seat-${i + 1}`, 'werewolfState'), 'werewolfState');
            client.rooms = [];
            client.socket.on('roomUpdate', payload => client.rooms.push(payload));
            await connectClient(client);
            clients.push(client);
        }
        const [host, ...rest] = clients;
        const created = await emitAck(host.socket, 'createRoom', { playerId: host.playerId, name: `WW exit ${Date.now()}`, gameMode: 'werewolf', maxPlayers: ROLES.length, werewolfRoles: ROLES });
        assert(created?.success, `create failed: ${created?.error}`);
        const roomId = created.roomId;
        bindRoom(host, roomId, 'werewolf_requestState');
        for (const c of rest) {
            const joined = await emitAck(c.socket, 'joinRoom', { roomId, playerId: c.playerId });
            assert(joined?.success, `join failed: ${joined?.error}`);
            bindRoom(c, roomId, 'werewolf_requestState');
        }
        const started = await emitAck(host.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(started?.success, `start failed: ${started?.error}`);
        await delay(2500);
        clients.forEach(c => bindRoom(c, roomId, 'werewolf_requestState'));
        const nights = await Promise.all(clients.map(c => waitState(c, roomId, s => s.phase === 'night' && s.playerRole?.id, 30000)));
        nights.forEach((s, i) => { clients[i].role = s.playerRole.id; });

        // the leaver is a living non-wolf non-host (game must go on); the stayer watches results
        const leaver = clients.find(c => c !== host && !['werewolf', 'alphaWolf'].includes(c.role));
        const stayer = clients.find(c => c !== host && c !== leaver && !['werewolf', 'alphaWolf'].includes(c.role));
        browser = await chromium.launch({ headless: true });
        for (const c of [leaver, stayer]) {
            const s = await createMobilePage(browser, server.baseUrl, roomId, c, '#werewolfShell');
            await prepare(s);
            sessions.push(s);
        }
        const [leaveSession, staySession] = sessions;
        await waitUiPhase(leaveSession, 'night');
        await delay(4500); // role reveal banner
        await exitVisible(leaveSession, 'night');
        console.log('[exit] night exit ok');
        await leaveSession.page.screenshot({ path: path.join(dir, 'exit-night.png') });

        // host skips into the day; exit still visible in discussion
        await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'night' });
        await waitUiPhase(leaveSession, 'day-discussion');
        await leaveSession.page.waitForFunction(() => !document.getElementById('phaseTransitionBanner')?.classList.contains('visible'), null, { timeout: 30000 });
        await exitVisible(leaveSession, 'day-discussion');
        console.log('[exit] discussion exit ok');

        // cancel keeps you in the game; confirm text states the werewolf consequence
        await leaveSession.page.click('#leaveWerewolfRoom');
        await leaveSession.page.waitForSelector('.swal2-popup', { timeout: 5000 });
        const consequence = await leaveSession.page.textContent('[data-testid="ww-leave-consequence"]');
        assert(/หายจากโต๊ะทันที/.test(consequence) && /เกมเล่นต่อโดยไม่มีคุณ/.test(consequence), `consequence text: ${consequence}`);
        const buttons = await leaveSession.page.evaluate(() => [document.querySelector('.swal2-confirm')?.textContent, document.querySelector('.swal2-cancel')?.textContent]);
        assert(buttons[0] === 'ออกจากห้อง' && buttons[1] === 'อยู่ต่อ', `confirm buttons ${buttons}`);
        await leaveSession.page.screenshot({ path: path.join(dir, 'exit-confirm.png') });
        await leaveSession.page.click('.swal2-cancel');
        await delay(500);
        assert(/\/game\//.test(leaveSession.page.url()), 'cancel must stay in the game');

        // confirm → /rooms
        await leaveSession.page.click('#leaveWerewolfRoom');
        await leaveSession.page.waitForSelector('.swal2-confirm', { timeout: 5000 });
        await Promise.all([
            leaveSession.page.waitForURL(/\/rooms/, { timeout: 8000 }),
            leaveSession.page.click('.swal2-confirm')
        ]);
        const leftAt = Date.now();
        console.log('[exit] left to /rooms');

        // others see the leave and keep playing
        host.socket.emit('werewolf_requestState', { roomId, playerId: host.playerId });
        const afterLeave = await waitState(host, roomId, s => !s.players.some(p => p.playerId === leaver.playerId), 10000);
        console.log('[exit] others see leave');
        assert(['day-discussion', 'day-vote', 'night'].includes(afterLeave.phase) || afterLeave.phase === 'finished', 'game continues for the others');

        // finish the game from the sockets; the stayer sees results and the exit there too
        for (let guard = 0; guard < 12; guard += 1) {
            host.socket.emit('werewolf_requestState', { roomId, playerId: host.playerId });
            await delay(400);
            const st = [...host.states].reverse()[0];
            if (st.phase === 'finished') break;
            if (st.phase === 'day-vote') {
                const wolf = clients.find(c => ['werewolf', 'alphaWolf'].includes(c.role));
                for (const c of clients) {
                    if (c === leaver || c === wolf) continue;
                    await emitAck(c.socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: wolf.playerId });
                }
            }
            const cur = [...host.states].reverse()[0];
            if (cur.phase !== 'finished') await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: cur.phase });
            await delay(3200);
        }
        await waitUiPhase(staySession, 'finished');
        await delay(3500);
        await staySession.page.evaluate(() => document.querySelectorAll('.swal2-container').forEach(el => el.remove()));
        await exitVisible(staySession, 'finished');
        await staySession.page.screenshot({ path: path.join(dir, 'exit-finished.png') });

        // no pull-back: still on /rooms 15 s later and not seated in the room
        const wait = Math.max(0, 15000 - (Date.now() - leftAt));
        await delay(wait);
        assert(/\/rooms/.test(leaveSession.page.url()), `pulled back to ${leaveSession.page.url()}`);
        host.rooms.length = 0;
        host.socket.emit('requestRoomUpdate', { roomId });
        for (let i = 0; i < 40 && !host.rooms.length; i += 1) await delay(50);
        const roomPayload = host.rooms[0] || {};
        const seated = (roomPayload.players || []).some(p => p.playerId === leaver.playerId);
        assert(!seated, 'leaver must not be seated in the room any more');
        console.log('WEREWOLF_EXIT_E2E ' + JSON.stringify({ roomId, leaverRole: leaver.role, stayedOnRoomsMs: Date.now() - leftAt, dir }));
    } finally {
        clients.forEach(c => c.socket.disconnect());
        await closeSessions(sessions);
        if (browser) await browser.close();
        await stopServer(server);
        restoreDataFiles(dataSnapshot);
    }
}

main().catch(error => {
    console.error('WEREWOLF_EXIT_E2E_FAIL', error.stack || error.message);
    process.exitCode = 1;
});
