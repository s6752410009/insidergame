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

function latest(client, roomId) {
    return [...client.states].reverse().find(state => state?.roomId === roomId) || null;
}

async function freshState(client, roomId) {
    const before = client.states.length;
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
    for (let i = 0; i < 40 && client.states.length === before; i += 1) await delay(50);
    return latest(client, roomId);
}

/**
 * Socket-only room (no browsers): custom timers, host skip (+ non-host rejected, + after host transfer),
 * vote last call, ghost chat and dead-role leak checks per socket.
 */
async function runServerRulesScenario(baseUrl) {
    const roles = ['werewolf', 'seer', 'doctor', 'mayor', 'cleric'];
    const cs = [];
    for (let i = 0; i < roles.length; i += 1) {
        const client = attachStateEvent(createClient(baseUrl, `rules-${i + 1}`, 'werewolfState'), 'werewolfState');
        client.messages = [];
        client.socket.on('newMessage', message => client.messages.push(message));
        await connectClient(client);
        cs.push(client);
    }
    const [host, ...rest] = cs;
    const created = await emitAck(host.socket, 'createRoom', {
        playerId: host.playerId,
        name: `Werewolf rules ${Date.now()}`,
        gameMode: 'werewolf',
        maxPlayers: cs.length,
        werewolfRoles: roles,
        werewolfNightSeconds: 45,
        werewolfDaySeconds: 120,
        werewolfVoteSeconds: 90
    });
    assert(created?.success, `rules room create failed: ${created?.error}`);
    const roomId = created.roomId;
    bindRoom(host, roomId, 'werewolf_requestState');
    for (const client of rest) {
        const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
        assert(joined?.success, `rules join failed: ${joined?.error}`);
        bindRoom(client, roomId, 'werewolf_requestState');
    }
    const started = await emitAck(host.socket, 'startGameFromLobby', { roomId }, 30000);
    assert(started?.success, `rules start failed: ${started?.error}`);
    await delay(1500);
    cs.forEach(client => bindRoom(client, roomId, 'werewolf_requestState'));
    const nights = await Promise.all(cs.map(client => waitState(client, roomId, state => state.phase === 'night' && state.playerRole?.id && state.phaseEndsAt, 30000)));
    nights.forEach((state, index) => { cs[index].role = state.playerRole.id; });
    const by = id => cs.find(client => client.role === id);
    const nightLeft = nights[0].phaseEndsAt - Date.now();
    assert(nightLeft > 35000 && nightLeft <= 46000, `custom night timer 45 s not honoured (${nightLeft} ms)`);
    assert(nights[0].isHost === true && nights.slice(1).every(state => state.isHost === false), 'isHost flag only for the host');

    // Host skip: non-host rejected; host skip = timeout rules + logged for everyone
    const notHost = rest[0];
    const rejected = await emitAck(notHost.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'night' });
    assert(rejected && rejected.success === false, 'non-host skip must be rejected');
    const skipNight = await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'night' });
    assert(skipNight?.success && skipNight.skippedPhase === 'night', `host night skip failed: ${skipNight?.error}`);
    const discussion = await waitState(host, roomId, state => state.phase === 'day-discussion', 10000);
    const discussionLeft = discussion.phaseEndsAt - Date.now();
    assert(discussionLeft > 110000 && discussionLeft <= 135000, `custom discussion timer 120 s (+recap buffer) not honoured (${discussionLeft} ms)`);
    await delay(300);
    assert(cs.every(client => client.messages.some(message => /หัวห้อง/.test(message.message || ''))), 'host skip must be logged for everyone');

    // Host transfer mid-game: the old host loses the button, the new host gets it
    const newHost = rest[1];
    const transferred = await emitAck(host.socket, 'transferAdmin', { newAdminPlayerId: newHost.playerId });
    assert(transferred?.success, `transferAdmin failed: ${transferred?.error}`);
    const oldHostSkip = await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'day-discussion' });
    assert(oldHostSkip && oldHostSkip.success === false, 'previous host must be rejected after a transfer');
    const newHostState = await freshState(newHost, roomId);
    assert(newHostState.isHost === true, 'new host should see the skip button');
    const skipDiscussion = await emitAck(newHost.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'day-discussion' });
    assert(skipDiscussion?.success, `new host discussion skip failed: ${skipDiscussion?.error}`);
    const vote = await waitState(host, roomId, state => state.phase === 'day-vote', 10000);
    const voteLeft = vote.phaseEndsAt - Date.now();
    assert(voteLeft > 80000 && voteLeft <= 91000, `custom vote timer 90 s not honoured (${voteLeft} ms)`);

    // Vote last call: final vote opens a fixed ~4 s window; a change is allowed and does not extend it
    const victim = by('cleric');
    for (const client of cs.filter(c => c !== victim)) {
        const ack = await emitAck(client.socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: victim.playerId });
        assert(ack?.success && !ack.resolved, `${client.role} vote failed: ${ack?.error}`);
    }
    const lastVote = await emitAck(victim.socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: by('seer').playerId });
    assert(lastVote?.success && lastVote.lastCall && !lastVote.resolved, 'final vote must open the last call');
    const closesAt = lastVote.voteClosesAt;
    const lastCallState = await freshState(by('seer'), roomId);
    assert(lastCallState.phase === 'day-vote' && lastCallState.voteClosesAt === closesAt, 'last call visible after refresh');
    await delay(1500);
    const change = await emitAck(by('mayor').socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: by('seer').playerId });
    assert(change?.success && change.voteClosesAt === closesAt, 'vote change during last call must not extend it');
    const night2 = await waitState(by('seer'), roomId, state => state.phase === 'night' && state.dayNumber === 2, 10000);
    assert(Date.now() - closesAt < 2500, 'vote should close right at the last-call deadline');
    assert(night2.dayResolutionAnnouncement?.outcomeType === 'vote-elimination', 'cleric should be voted out');

    // Ghost chat + dead role view: dead cleric only
    cs.forEach(client => { client.messages = []; client.states = []; });
    victim.socket.emit('sendMessage', { message: 'ghost-secret-123' });
    await delay(600);
    assert(victim.messages.some(message => message.messageType === 'ghost' && /ghost-secret-123/.test(message.message)), 'dead player should get own ghost message');
    cs.filter(client => client !== victim).forEach(client => {
        assert(!client.messages.some(message => /ghost-secret-123/.test(message.message || '')), `ghost chat leaked to living ${client.role}`);
    });
    for (const client of cs) {
        const state = await freshState(client, roomId);
        const hasRoles = (state.players || []).some(player => player.roleId || player.roleThaiName || player.revealedRole);
        if (client === victim) {
            assert(state.deadRoleView && state.players.every(player => player.roleId), 'dead player should see every role');
        } else {
            assert(!hasRoles && !state.deadRoleView, `roles leaked to living ${client.role}`);
        }
    }
    cs.forEach(client => client.socket.disconnect());
    return { roomId, customTimers: true, hostSkip: true, nonHostRejected: true, hostTransfer: true, voteLastCall: true, ghostChatPrivate: true, deadRolesPrivate: true };
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
        console.log('0. server rules (timers, host skip, last call, ghost chat, dead roles)');
        const rules = await runServerRulesScenario(server.baseUrl);
        console.log('   rules ok', JSON.stringify(rules));
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

        const nightStates = await Promise.all(clients.map(client => waitState(client, roomId, state => state.phase === 'night' && state.playerRole?.id && state.phaseEndsAt, 30000)));
        const defaultNightLeft = nightStates[0].phaseEndsAt - Date.now();
        assert(defaultNightLeft > 50000 && defaultNightLeft <= 61000, `default night timer should stay 60 s (${defaultNightLeft} ms)`);
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

        // Host skip button only on the host's screen
        for (const session of sessions) {
            const hasSkip = !!(await session.page.$('#mobileHint [data-testid="ww-host-skip"]'));
            assert(hasSkip === (session.client.playerId === admin.playerId), `${session.client.label}: host skip button visibility wrong (${hasSkip})`);
        }

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

        // Last call is visible to everyone, with a live countdown
        const lastCallSession = sessions[sessions.length - 1];
        await lastCallSession.page.waitForSelector('#mobileHint [data-testid="ww-last-call"]', { timeout: 3500 });
        const lastCallText = await lastCallSession.page.textContent('#mobileHint [data-testid="ww-last-call"]');
        assert(/ปิดโหวตใน\s*[1-4]/.test(lastCallText || ''), `last-call banner should count down: ${lastCallText}`);
        screenshots.push(...await screenshotPhase([lastCallSession], 'werewolf', 'vote-last-call', artifactDir));

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
