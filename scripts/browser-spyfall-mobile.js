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
    finished: 'เฉลย'
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

        const spySession = sessions.find(session => session.client.label === 'spy');
        const citizenSessions = sessions.filter(session => session !== spySession);

        console.log('2b. timer stays on screen while scrolling (sticky now-bar)');
        await spySession.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(200);
        const timerTop = await spySession.page.evaluate(() => document.getElementById('timerDisplay').getBoundingClientRect().top);
        assert(timerTop >= 0 && timerTop < 120, `timer should stay visible after scrolling, top=${timerTop}`);
        await spySession.page.evaluate(() => window.scrollTo(0, 0));

        console.log('2c. whose turn: asker taps who they ask → that player is told it is their turn');
        const turnInfo = await sessions[0].page.evaluate(() => document.getElementById('sfNowCopy').textContent);
        assert(/ตา/.test(turnInfo), `now-bar should say whose turn it is: ${turnInfo}`);
        let askerSession = null;
        for (const session of sessions) {
            if (/ตาคุณถาม/.test(await session.page.evaluate(() => document.getElementById('sfNowCopy').textContent))) askerSession = session;
        }
        assert(askerSession, 'one player should see "ตาคุณถาม"');
        const askTargetId = await askerSession.page.evaluate(() => document.querySelector('.sf-ask-btn:not([disabled])')?.dataset.targetId);
        assert(askTargetId, 'asker needs player buttons to pick who to ask');
        await askerSession.page.click(`.sf-ask-btn[data-target-id="${askTargetId}"]`);
        const targetSession = sessions.find(session => session.client.playerId === askTargetId);
        await targetSession.page.waitForFunction(() => /ตาคุณถาม/.test(document.getElementById('sfNowCopy').textContent), null, { timeout: 10000 });
        const blockedBack = await targetSession.page.evaluate(id => !!document.querySelector(`.sf-ask-btn[data-target-id="${id}"]`)?.disabled, askerSession.client.playerId);
        assert(blockedBack, 'cannot ask back the player who just asked you');

        console.log('2d. spy: strike out a location + tap-to-pick guess grid');
        await spySession.page.click('.sf-location-pool .sf-location-pill >> nth=0');
        assert(await spySession.page.evaluate(() => document.querySelector('.sf-location-pool .sf-location-pill').classList.contains('is-out')), 'tapping a location should strike it out');
        await spySession.page.click('#sfGuessLocationBtn');
        await spySession.page.waitForSelector('.sf-guess-tile');
        const tileCount = await spySession.page.$$eval('.sf-guess-tile', tiles => tiles.length);
        assert(tileCount >= 18, `guess grid should list every location, got ${tileCount}`);
        const tileHeight = await spySession.page.$eval('.sf-guess-tile', tile => tile.getBoundingClientRect().height);
        assert(tileHeight >= 48, `guess tiles must be thumb-sized, got ${tileHeight}`);
        await spySession.page.click('.swal2-cancel');
        await delay(300);

        console.log('2e. ready-to-vote: a majority (3 of 4) skips the rest of the discussion');
        for (const session of sessions.slice(0, 3)) {
            await session.page.click('#sfReadyVoteBtn');
            await delay(250);
        }
        console.log('3. capture vote');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'vote')));
        await validateSessions(sessions, 'vote');
        screenshots.push(...await screenshotPhase(sessions, 'spyfall', 'vote', artifactDir));

        const spyClient = clients.find(client => client.label === 'spy');
        const citizenClient = clients.find(client => client.label !== 'spy');
        assert(spyClient && citizenClient, 'missing spy/citizen clients');
        console.log('3b. vote is two-step: first tap only selects, confirm sends');
        for (const session of sessions) {
            const targetPlayerId = session.client === spyClient ? citizenClient.playerId : spyClient.playerId;
            await session.page.click(`.sf-vote-pick[data-target-id="${targetPlayerId}"]`);
            await delay(150);
            const stillMine = await session.page.evaluate(() => !document.querySelector('.sf-vote-pick[disabled]'));
            assert(stillMine, `${session.client.label}: a single tap must not lock the vote`);
            await session.page.click('#sfConfirmVoteBtn');
            await delay(250);
        }

        console.log('4. capture finished');
        await Promise.all(sessions.map(session => waitUiPhase(session, 'finished')));
        await validateSessions(sessions, 'finished');
        for (const session of sessions) {
            const recap = await session.page.evaluate(() => ({
                rows: document.querySelectorAll('.sf-roster-row').length,
                why: document.querySelector('.sf-recap-why')?.textContent || '',
                me: document.querySelector('.sf-recap-me')?.textContent || '',
                note: document.getElementById('sfReturnNote')?.textContent || ''
            }));
            assert(recap.rows === 4, `${session.client.label}: recap should list every player's role, got ${recap.rows}`);
            assert(recap.why.length > 5, `${session.client.label}: recap should explain why`);
            assert(/คุณ(ชนะ|แพ้)/.test(recap.me), `${session.client.label}: recap should say if I won`);
            assert(/กลับห้องรอ/.test(recap.note), `${session.client.label}: recap should show the auto-return countdown`);
        }
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
