#!/usr/bin/env node
'use strict';
// 20 seats on a phone: 20 socket players, browser tabs for a wolf, the Serial Killer,
// the witch and a dead (ghost) player at 390×844, plus one landscape pass (844×390).
// Asserts no horizontal overflow, every seat visible/tappable, no broken images or JS errors.
// Screenshots: WEREWOLF_SHOT_DIR (default: a temp dir).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
    assert, attachStateEvent, bindRoom, closeSessions, connectClient, createArtifactDir, createClient,
    createMobilePage, delay, emitAck, restoreDataFiles, snapshotDataFiles, spawnServer, stopServer, waitState
} = require('./mobile-e2e-utils');

const N = 20;
const PHASE_LABELS = { night: 'กลางคืน', 'day-discussion': 'ประชุม', 'day-vote': 'โหวต', finished: 'จบ' };

function latest(client, roomId) {
    return [...client.states].reverse().find(state => state?.roomId === roomId) || null;
}

async function freshState(client, roomId) {
    const before = client.states.length;
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
    for (let i = 0; i < 60 && client.states.length === before; i += 1) await delay(25);
    return latest(client, roomId);
}

async function waitUiPhase(session, phase) {
    await session.page.waitForFunction(expected => (document.getElementById('mobilePhaseLabel')?.textContent || '').includes(expected), PHASE_LABELS[phase], { timeout: 30000 });
    await session.page.waitForFunction(() => !document.getElementById('phaseTransitionBanner')?.classList.contains('visible')
        && !document.getElementById('roleAnnouncementBanner')?.classList.contains('visible'), null, { timeout: 30000 });
    await delay(600);
}

async function checkLayout(session, label) {
    const metrics = await session.page.evaluate(() => {
        const vw = window.innerWidth;
        const grid = document.querySelector('#mobileInlinePlayerGrid') || document.querySelector('#werewolfPlayers');
        const seats = Array.from((grid || document).querySelectorAll('.player-row'));
        const wide = Array.from(document.querySelectorAll('body *')).filter(el => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.right > vw + 2 && style.position !== 'fixed' && !el.closest('.swal2-container');
        }).map(el => el.id || el.className).slice(0, 5);
        return {
            vw,
            docW: document.documentElement.scrollWidth,
            seats: seats.length,
            seatMinW: seats.reduce((m, el) => Math.min(m, el.getBoundingClientRect().width), 999),
            seatMinH: seats.reduce((m, el) => Math.min(m, el.getBoundingClientRect().height), 999),
            wide,
            broken: Array.from(document.images).filter(img => img.complete && img.naturalWidth === 0).map(img => img.src)
        };
    });
    assert(metrics.docW <= metrics.vw + 2, `${label}: horizontal overflow ${metrics.docW}/${metrics.vw} (${metrics.wide.join(' | ')})`);
    assert(metrics.seats === N, `${label}: expected ${N} seats, saw ${metrics.seats}`);
    assert(metrics.seatMinW >= 44 && metrics.seatMinH >= 44, `${label}: seats too small to tap (${metrics.seatMinW}x${metrics.seatMinH})`);
    assert(metrics.broken.length === 0, `${label}: broken images ${metrics.broken.join(', ')}`);
    return metrics;
}

async function shot(session, dir, name) {
    const file = path.join(dir, `${name}.png`);
    await session.page.screenshot({ path: file, fullPage: false });
    await session.page.screenshot({ path: path.join(dir, `${name}-full.png`), fullPage: true });
    return file;
}

async function main() {
    const dataSnapshot = snapshotDataFiles();
    const dir = process.env.WEREWOLF_SHOT_DIR || createArtifactDir('werewolf20');
    fs.mkdirSync(dir, { recursive: true });
    const clients = [];
    let sessions = [];
    let server;
    let browser;
    const files = [];
    try {
        server = await spawnServer();
        for (let i = 0; i < N; i += 1) {
            const client = attachStateEvent(createClient(server.baseUrl, `seat-${i + 1}`, 'werewolfState'), 'werewolfState');
            await connectClient(client);
            clients.push(client);
        }
        const [host, ...rest] = clients;
        const created = await emitAck(host.socket, 'createRoom', { playerId: host.playerId, name: `WW20 UI ${Date.now()}`, gameMode: 'werewolf', maxPlayers: N, wolfCount: 0 });
        assert(created?.success, `create failed: ${created?.error}`);
        const roomId = created.roomId;
        bindRoom(host, roomId, 'werewolf_requestState');
        for (const client of rest) {
            const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joined?.success, `join failed: ${joined?.error}`);
            bindRoom(client, roomId, 'werewolf_requestState');
        }
        const started = await emitAck(host.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(started?.success, `start failed: ${started?.error}`);
        await delay(2500);
        clients.forEach(client => bindRoom(client, roomId, 'werewolf_requestState'));
        const nights = await Promise.all(clients.map(c => waitState(c, roomId, s => s.phase === 'night' && s.playerRole?.id, 30000)));
        nights.forEach((s, i) => { clients[i].role = s.playerRole.id; clients[i].label = `${s.playerRole.id}-${i + 1}`; });
        // browser tabs take over a player's socket: hand the host role to a plain villager we never watch
        const controller = clients.filter(c => c.role === 'villager')[1];
        if (controller !== host) {
            const moved = await emitAck(host.socket, 'transferAdmin', { newAdminPlayerId: controller.playerId });
            assert(moved?.success, `transferAdmin failed: ${moved?.error}`);
        }
        const by = role => clients.find(c => c.role === role && c !== controller);
        const log = message => console.log(`[ww20] ${message}`);

        browser = await chromium.launch({ headless: true });
        const watched = [by('werewolf'), by('serialKiller'), by('witch'), by('villager')];
        assert(watched.every(Boolean), `watched roles missing: ${clients.map(c => c.role).join(',')}`);
        log(`watching ${watched.map(c => c.label).join(', ')}`);
        for (const client of watched) {
            const session = await createMobilePage(browser, server.baseUrl, roomId, client, '#werewolfShell');
            // dismiss the one-time "how to play" overlay so the board is visible
            await session.page.evaluate(() => { try { localStorage.setItem('ig-firstplay-werewolf', '1'); } catch (e) {} document.getElementById('ppFirstPlay')?.remove(); });
            sessions.push(session);
        }

        // Night 1 → skip to night 2 so wolves/SK have 16+ live targets
        for (const s of sessions) await waitUiPhase(s, 'night');
        for (const s of sessions) { await checkLayout(s, `night1/${s.client.label}`); files.push(await shot(s, dir, `n1-${s.client.role}`)); }
        for (const s of sessions) {
            const exit = await s.page.evaluate(() => {
                const btn = document.getElementById('leaveWerewolfRoom');
                const r = btn.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { text: btn.textContent.trim(), w: r.width, h: r.height, onTop: hit === btn || btn.contains(hit) };
            });
            assert(/🚪/.test(exit.text) && exit.w >= 44 && exit.h >= 44 && exit.onTop, `20-seat exit button: ${JSON.stringify(exit)}`);
        }

        const advance = async phase => {
            const ack = await emitAck(controller.socket, 'werewolf_hostSkipPhase', { roomId, phase });
            assert(ack?.success, `host skip ${phase}: ${ack?.error}`);
        };
        log('night 1 ok');
        await advance('night');
        await waitState(controller, roomId, s => s.phase === 'day-discussion', 20000);
        for (const s of sessions) await waitUiPhase(s, 'day-discussion');
        for (const s of sessions) { await checkLayout(s, `discussion/${s.client.label}`); }
        files.push(await shot(sessions[3], dir, 'd1-discussion-villager'));
        log('discussion ok');
        await advance('day-discussion');
        await waitState(controller, roomId, s => s.phase === 'day-vote', 20000);
        for (const s of sessions) await waitUiPhase(s, 'day-vote');
        // lynch the watched villager → becomes the ghost
        const ghost = by('villager');
        for (const c of clients) {
            if (c === ghost) continue;
            await emitAck(c.socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: ghost.playerId });
        }
        await delay(600);
        for (const s of sessions) await checkLayout(s, `vote/${s.client.label}`);
        files.push(await shot(sessions[0], dir, 'd1-vote-wolf'));
        await emitAck(ghost.socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: '__skip__' });
        log('vote ok');
        await waitState(controller, roomId, s => s.phase === 'night' && s.dayNumber === 2, 30000);
        for (const s of sessions) await waitUiPhase(s, 'night');

        // Night 2: wolf / SK / witch target pickers with 19 seats; ghost chat for the dead
        const wolfState = await freshState(by('werewolf'), roomId);
        const victim = wolfState.actionState.nightActions[0].targets[0];
        for (const c of clients.filter(x => ['werewolf', 'alphaWolf'].includes(x.role))) {
            await emitAck(c.socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: victim.playerId, actionType: 'night-kill' });
        }
        await delay(800);
        for (const s of sessions) await checkLayout(s, `night2/${s.client.label}`);
        files.push(await shot(sessions[0], dir, 'n2-wolf-picker'));
        files.push(await shot(sessions[1], dir, 'n2-serial-killer-picker'));
        const witchText = await sessions[2].page.textContent('#mobileHint');
        assert(witchText.includes(victim.name), 'witch sees the wolves’ victim in the hint bar');
        files.push(await shot(sessions[2], dir, 'n2-witch-sees-victim'));
        const ghostSession = sessions[3];
        ghost.socket.emit('sendMessage', { message: 'ghost hello from seat 20-player test' });
        await delay(800);
        const ghostUi = await ghostSession.page.evaluate(() => ({ deadView: !!document.querySelector('.player-row .player-status-tag') }));
        assert(ghostUi.deadView, 'ghost sees role tags');
        files.push(await shot(ghostSession, dir, 'n2-ghost-view'));

        // Landscape pass on the wolf tab
        await sessions[0].page.setViewportSize({ width: 844, height: 390 });
        await delay(800);
        const land = await sessions[0].page.evaluate(() => ({ vw: window.innerWidth, docW: document.documentElement.scrollWidth, seats: document.querySelectorAll('#mobileInlinePlayerGrid .player-row, #werewolfPlayers .player-row').length }));
        assert(land.docW <= land.vw + 2, `landscape overflow ${land.docW}/${land.vw}`);
        files.push(await shot(sessions[0], dir, 'n2-wolf-landscape'));

        const errors = sessions.flatMap(s => s.errors.filter(e => !/Failed to load resource|beforeunload/i.test(e)));
        assert(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
        console.log('WEREWOLF_20_UI ' + JSON.stringify({ roomId, roles: clients.map(c => c.role), screenshots: files.length, dir }));
    } finally {
        clients.forEach(c => c.socket.disconnect());
        await closeSessions(sessions);
        if (browser) await browser.close();
        await stopServer(server);
        restoreDataFiles(dataSnapshot);
    }
}

main().catch(error => {
    console.error('WEREWOLF_20_UI_FAIL', error.stack || error.message);
    process.exitCode = 1;
});
