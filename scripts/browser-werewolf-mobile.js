#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const {
    assert,
    attachStateEvent,
    bindRoom,
    closeSessions,
    connectClient,
    createArtifactDir,
    createClient,
    createMobilePage,
    delay,
    emitAck,
    restoreDataFiles,
    screenshotPhase,
    snapshotDataFiles,
    spawnServer,
    stopServer,
    waitState
} = require('./mobile-e2e-utils');

const ROLE_IDS = ['werewolf', 'seer', 'doctor', 'mayor', 'revealer'];
const PHASE_LABELS = {
    night: 'กลางคืน',
    'day-discussion': 'ประชุม',
    'day-vote': 'โหวต',
    finished: 'จบ'
};

async function waitUiPhase(session, phase) {
    await session.page.waitForFunction(expected => {
        const label = document.getElementById('mobilePhaseLabel')?.textContent || '';
        return label.includes(expected);
    }, PHASE_LABELS[phase], { timeout: 30000 });
}

async function validateSessions(sessions, phase) {
    for (const session of sessions) {
        await waitUiPhase(session, phase);
        const metrics = await session.page.evaluate(() => ({
            role: document.getElementById('mobileRoleName')?.textContent?.trim() || document.getElementById('mobileInlineRoleStrip')?.textContent?.trim() || '',
            actionText: document.getElementById('phaseStatusHeadline')?.textContent?.trim() || '',
            brokenImages: Array.from(document.images).filter(image => image.complete && image.naturalWidth === 0).map(image => image.src)
        }));
        assert(metrics.role.length > 0, `${session.client.label}: missing role strip in ${phase}`);
        assert(metrics.actionText.length > 0, `${session.client.label}: missing current-action guidance in ${phase}`);
        assert(metrics.brokenImages.length === 0, `${session.client.label}: broken images in ${phase}: ${metrics.brokenImages.join(', ')}`);
    }
}

async function emitForAlive(clients, eventName, roomId, extraPayload = {}) {
    for (const client of clients) {
        const state = client.states[client.states.length - 1];
        const self = state?.players?.find(player => player.playerId === client.playerId);
        if (!self || self.alive === false || state.phase === 'finished') continue;
        const response = await emitAck(client.socket, eventName, { roomId, playerId: client.playerId, ...extraPayload });
        console.log(`   ${eventName} ${client.label}:`, JSON.stringify(response));
        if (response?.success === false && !/ยังไม่ใช่ช่วง/.test(response.error || '')) {
            throw new Error(`${client.label} ${eventName}: ${response.error}`);
        }
    }
}

async function main() {
    const dataSnapshot = snapshotDataFiles();
    const artifactDir = createArtifactDir('werewolf');
    const clients = [];
    const sessions = [];
    let server;
    let browser;

    try {
        server = await spawnServer();
        browser = await chromium.launch({ headless: true });

        for (let index = 0; index < ROLE_IDS.length; index += 1) {
            const client = attachStateEvent(createClient(server.baseUrl, `seat-${index + 1}`, 'werewolfState'), 'werewolfState');
            await connectClient(client);
            clients.push(client);
        }

        const [admin, ...guests] = clients;
        const created = await emitAck(admin.socket, 'createRoom', {
            playerId: admin.playerId,
            name: `Werewolf Mobile E2E ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: clients.length,
            roundTime: 0.25,
            werewolfRoles: ROLE_IDS
        });
        assert(created?.success && created.roomId, `create room failed: ${created?.error || 'unknown'}`);
        const roomId = created.roomId;
        bindRoom(admin, roomId, 'werewolf_requestState');

        for (const client of guests) {
            const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joined?.success, `${client.label} join failed: ${joined?.error || 'unknown'}`);
            bindRoom(client, roomId, 'werewolf_requestState');
        }

        const started = await emitAck(admin.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(started?.success, `start failed: ${started?.error || 'unknown'}`);
        await delay(3000);
        clients.forEach(client => bindRoom(client, roomId, 'werewolf_requestState'));

        const nightStates = await Promise.all(clients.map(client => waitState(client, roomId, state => state.phase === 'night' && state.playerRole?.id, 30000)));
        nightStates.forEach((state, index) => { clients[index].label = state.playerRole.id; });
        assert(new Set(nightStates.map(state => state.playerRole.id)).size === clients.length, 'expected a distinct role for every mobile tab');

        for (const client of clients) {
            sessions.push(await createMobilePage(browser, server.baseUrl, roomId, client, '#werewolfShell'));
        }
        await delay(3200);

        const screenshots = [];
        console.log('1. capture night across 5 role tabs');
        await validateSessions(sessions, 'night');
        screenshots.push(...await screenshotPhase(sessions, 'werewolf', 'night', artifactDir));

        // UX regressions: readable phase title (no N/D1/D2 codes) and a labelled, tappable role strip
        for (const session of sessions) {
            const ui = await session.page.evaluate(() => ({
                title: document.getElementById('phaseHudTitle')?.textContent?.trim() || '',
                caption: document.querySelector('#mobileInlineRoleStrip .role-strip-caption')?.textContent || ''
            }));
            assert(!/^(N|D1|D2|END|LB|ST)\b/.test(ui.title), `${session.client.label}: cryptic phase code in title "${ui.title}"`);
            assert(ui.caption.includes('แตะ'), `${session.client.label}: role strip caption missing`);
        }

        // Skill holders act (acting = ready); one player without a night skill presses ready → morning, no timer wait
        const byRole = id => clients.find(client => client.label === id);
        const seerAck = await emitAck(byRole('seer').socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: byRole('werewolf').playerId, actionType: 'seer-check' });
        assert(seerAck?.success, `seer check failed: ${seerAck?.error}`);
        const doctorAck = await emitAck(byRole('doctor').socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: '__skip__', actionType: 'doctor-save' });
        assert(doctorAck?.success && !doctorAck.resolved, 'night must not end before a ready majority');
        const mayorReady = await emitAck(byRole('mayor').socket, 'werewolf_skipNight', { roomId });
        assert(mayorReady?.success && mayorReady.resolved, `night should end once skills are done and a majority is ready: ${JSON.stringify(mayorReady)}`);
        console.log('2. wait for day discussion');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'day-discussion')));
        await delay(3000);
        await validateSessions(sessions, 'day-discussion');
        screenshots.push(...await screenshotPhase(sessions, 'werewolf', 'day-discussion', artifactDir));

        // Persistent "last night" news line, and the mayor reveal asks for confirmation (cancel keeps the role hidden)
        const mayorSession = sessions.find(session => session.client.label === 'mayor');
        await mayorSession.page.waitForFunction(() => !document.getElementById('phaseTransitionBanner')?.classList.contains('visible'), null, { timeout: 30000 });
        const newsText = await mayorSession.page.textContent('#mobileHint [data-testid="ww-latest-news"]').catch(() => '');
        assert(/เมื่อคืน/.test(newsText || ''), 'day discussion should show the last-night news line');
        await mayorSession.page.click('#mobileHint .btn-reveal');
        await mayorSession.page.waitForSelector('.swal2-popup', { timeout: 5000 });
        await mayorSession.page.click('.swal2-cancel');
        await delay(800);
        const stillHidden = await mayorSession.page.$('#mobileHint .btn-reveal');
        assert(stillHidden, 'cancelled mayor confirm must not reveal the mayor');

        await emitForAlive(clients, 'werewolf_skipDiscussion', roomId);
        console.log('3. wait for day vote');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'day-vote')));
        await delay(3000);
        await validateSessions(sessions, 'day-vote');
        screenshots.push(...await screenshotPhase(sessions, 'werewolf', 'day-vote', artifactDir));

        const wolfClient = clients.find(client => client.label === 'werewolf');
        assert(wolfClient, 'werewolf role was not assigned');
        for (const client of clients) {
            const state = client.states[client.states.length - 1];
            const self = state?.players?.find(player => player.playerId === client.playerId);
            if (!self?.alive) continue;
            const targetPlayerId = client.playerId === wolfClient.playerId
                ? clients.find(candidate => candidate.playerId !== wolfClient.playerId).playerId
                : wolfClient.playerId;
            const response = await emitAck(client.socket, 'werewolf_submitDayVote', { roomId, playerId: client.playerId, targetPlayerId });
            if (response?.success === false && !/ยังไม่ใช่ช่วง/.test(response.error || '')) {
                throw new Error(`${client.label} vote failed: ${response.error}`);
            }
        }

        console.log('4. wait for finished result');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'finished')));
        await delay(3000);
        await validateSessions(sessions, 'finished');
        screenshots.push(...await screenshotPhase(sessions, 'werewolf', 'finished', artifactDir));

        const pageErrors = sessions.flatMap(session => session.errors.filter(error =>
            !/Failed to load resource|Blocked attempt to show a 'beforeunload'/i.test(error)
        ));
        assert(pageErrors.length === 0, `browser errors: ${pageErrors.join(' | ')}`);

        console.log('WEREWOLF_MOBILE_E2E ' + JSON.stringify({
            roomId,
            roles: clients.map(client => client.label),
            phases: Object.keys(PHASE_LABELS),
            screenshots: screenshots.length,
            artifactDir
        }));
    } finally {
        clients.forEach(client => client.socket.disconnect());
        await closeSessions(sessions);
        if (browser) await browser.close();
        await stopServer(server);
        restoreDataFiles(dataSnapshot);
    }
}

main().catch(error => {
    console.error('WEREWOLF_MOBILE_E2E_FAIL', error.stack || error.message);
    process.exitCode = 1;
});
