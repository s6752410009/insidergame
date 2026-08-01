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

const PHASE_LABELS = {
    reveal: 'เปิดบท',
    discussion: 'ช่วงคุย',
    vote: 'โหวต',
    finished: 'จบเกม'
};

async function waitUiPhase(session, phase) {
    await session.page.waitForFunction(expected => {
        const label = document.getElementById('phaseChip')?.textContent || '';
        return label.includes(expected);
    }, PHASE_LABELS[phase], { timeout: 40000 });
}

async function validateSessions(sessions, phase) {
    for (const session of sessions) {
        await waitUiPhase(session, phase);
        const metrics = await session.page.evaluate(() => ({
            roleText: document.getElementById('rolePanel')?.textContent?.trim() || '',
            stageText: document.getElementById('mainStage')?.textContent?.trim() || '',
            brokenImages: Array.from(document.images).filter(image => image.complete && image.naturalWidth === 0).map(image => image.src)
        }));
        assert(metrics.roleText.length > 0, `${session.client.label}: role panel empty in ${phase}`);
        assert(metrics.stageText.length > 0, `${session.client.label}: stage empty in ${phase}`);
        assert(metrics.brokenImages.length === 0, `${session.client.label}: broken images in ${phase}: ${metrics.brokenImages.join(', ')}`);
    }
}

async function main() {
    const dataSnapshot = snapshotDataFiles();
    const artifactDir = createArtifactDir('spyfall');
    const clients = [];
    const sessions = [];
    let server;
    let browser;

    try {
        server = await spawnServer({ SPYFALL_REVEAL_PHASE_MS: '30000' });
        browser = await chromium.launch({ headless: true });

        for (let index = 0; index < 4; index += 1) {
            const client = attachStateEvent(createClient(server.baseUrl, `seat-${index + 1}`, 'spyfallState'), 'spyfallState');
            await connectClient(client);
            clients.push(client);
        }

        const [admin, ...guests] = clients;
        const created = await emitAck(admin.socket, 'createRoom', {
            playerId: admin.playerId,
            name: `Spyfall Mobile E2E ${Date.now()}`,
            gameMode: 'spyfall',
            maxPlayers: 4,
            roundTime: 1,
            spyfallVoteMinutes: 1
        });
        assert(created?.success && created.roomId, `create room failed: ${created?.error || 'unknown'}`);
        const roomId = created.roomId;
        bindRoom(admin, roomId, 'spyfall_requestState');

        for (const client of guests) {
            const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joined?.success, `${client.label} join failed: ${joined?.error || 'unknown'}`);
            bindRoom(client, roomId, 'spyfall_requestState');
        }

        const started = await emitAck(admin.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(started?.success, `start failed: ${started?.error || 'unknown'}`);
        await delay(400);
        clients.forEach(client => bindRoom(client, roomId, 'spyfall_requestState'));

        const revealStates = await Promise.all(clients.map(client => waitState(client, roomId, state => state.phase === 'reveal' && state.self, 30000)));
        revealStates.forEach((state, index) => {
            clients[index].label = state.self.isSpy ? 'spy' : `citizen-${index + 1}`;
        });
        assert(revealStates.filter(state => state.self.isSpy).length === 1, 'expected exactly one spy');

        for (const client of clients) {
            sessions.push(await createMobilePage(browser, server.baseUrl, roomId, client, '.sf-shell'));
        }

        const screenshots = [];
        console.log('1. capture reveal across spy + citizen tabs');
        await validateSessions(sessions, 'reveal');
        screenshots.push(...await screenshotPhase(sessions, 'spyfall', 'reveal', artifactDir));

        console.log('2. wait for discussion');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'discussion')));
        await validateSessions(sessions, 'discussion');
        screenshots.push(...await screenshotPhase(sessions, 'spyfall', 'discussion', artifactDir));

        const ended = await emitAck(admin.socket, 'spyfall_endDiscussion', { roomId });
        assert(ended?.success, `end discussion failed: ${ended?.error || 'unknown'}`);
        console.log('3. capture vote');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'vote')));
        await validateSessions(sessions, 'vote');
        screenshots.push(...await screenshotPhase(sessions, 'spyfall', 'vote', artifactDir));

        const spyClient = clients.find(client => client.label === 'spy');
        const citizenClient = clients.find(client => client.label !== 'spy');
        assert(spyClient && citizenClient, 'missing spy/citizen clients');
        for (const client of clients) {
            const targetPlayerId = client === spyClient ? citizenClient.playerId : spyClient.playerId;
            const response = await emitAck(client.socket, 'spyfall_vote', { roomId, playerId: client.playerId, targetPlayerId });
            if (response?.success === false && !/ยังไม่ใช่ช่วง/.test(response.error || '')) {
                throw new Error(`${client.label} vote failed: ${response.error}`);
            }
        }

        console.log('4. capture finished');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'finished')));
        await validateSessions(sessions, 'finished');
        screenshots.push(...await screenshotPhase(sessions, 'spyfall', 'finished', artifactDir));

        const pageErrors = sessions.flatMap(session => session.errors.filter(error =>
            !/Failed to load resource|Blocked attempt to show a 'beforeunload'/i.test(error)
        ));
        assert(pageErrors.length === 0, `browser errors: ${pageErrors.join(' | ')}`);

        console.log('SPYFALL_MOBILE_E2E ' + JSON.stringify({
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
    console.error('SPYFALL_MOBILE_E2E_FAIL', error.stack || error.message);
    process.exitCode = 1;
});
