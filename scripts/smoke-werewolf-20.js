#!/usr/bin/env node
'use strict';
// Full 20-player Werewolf game over real sockets (20 bot clients) with the default
// role table: every phase, every client acts through the socket API, and every
// payload is checked for secret leaks. Also checks illegal moves are rejected.
const {
    assert, attachStateEvent, bindRoom, connectClient, createClient, delay, emitAck,
    restoreDataFiles, snapshotDataFiles, spawnServer, stopServer, waitState
} = require('./mobile-e2e-utils');

const N = Number(process.env.WEREWOLF_SOCKET_PLAYERS || 20);
const WOLVES = ['werewolf', 'alphaWolf'];

function latest(client, roomId) {
    return [...client.states].reverse().find(state => state?.roomId === roomId) || null;
}

async function freshState(client, roomId) {
    const before = client.states.length;
    client.socket.emit('werewolf_requestState', { roomId, playerId: client.playerId });
    for (let i = 0; i < 60 && client.states.length === before; i += 1) await delay(25);
    return latest(client, roomId);
}

function checkLeaks(client, state) {
    if (!state || state.phase === 'finished') return;
    const self = state.players.find(p => p.isSelf);
    const raw = JSON.stringify(state);
    ['werewolfVotes', 'serialKills', 'seerChecks', 'witchPoisons', 'wolvesSickNight'].forEach(key => {
        assert(!raw.includes(key), `${client.role}: payload leaks ${key}`);
    });
    if (self && self.alive === false && state.deadRoleView) return;
    state.players.forEach(seat => {
        if (seat.isSelf) return;
        const known = seat.princeRevealed === true;
        assert(known || (!seat.roleId && !seat.roleThaiName && !seat.revealedRole), `${client.role}: role of ${seat.name} leaked (${seat.roleId})`);
    });
    if (!WOLVES.includes(client.role)) {
        assert(!(state.actionState.nightActions || []).some(card => card.type === 'night-kill'), `${client.role} got the wolf card`);
    }
}

async function main() {
    const dataSnapshot = snapshotDataFiles();
    const clients = [];
    let server;
    const stats = { phases: 0, nights: 0, actions: 0, rejected: 0, leakChecks: 0 };
    try {
        server = await spawnServer();
        for (let i = 0; i < N; i += 1) {
            const client = attachStateEvent(createClient(server.baseUrl, `bot-${i + 1}`, 'werewolfState'), 'werewolfState');
            await connectClient(client);
            clients.push(client);
        }
        const [host, ...rest] = clients;
        const created = await emitAck(host.socket, 'createRoom', {
            playerId: host.playerId,
            name: `WW20 ${Date.now()}`,
            gameMode: 'werewolf',
            maxPlayers: N,
            wolfCount: 0
        });
        assert(created?.success, `create failed: ${created?.error}`);
        const roomId = created.roomId;
        bindRoom(host, roomId, 'werewolf_requestState');
        for (const client of rest) {
            const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joined?.success, `${client.label} join failed: ${joined?.error}`);
            bindRoom(client, roomId, 'werewolf_requestState');
        }
        const overflow = createClient(server.baseUrl, 'overflow-21', 'werewolfState');
        await connectClient(overflow);
        const overflowJoin = await emitAck(overflow.socket, 'joinRoom', { roomId, playerId: overflow.playerId });
        assert(overflowJoin && overflowJoin.success === false, 'player 21 must be refused');
        overflow.socket.disconnect();

        const started = await emitAck(host.socket, 'startGameFromLobby', { roomId }, 30000);
        assert(started?.success, `start failed: ${started?.error}`);
        await delay(2500);
        clients.forEach(client => bindRoom(client, roomId, 'werewolf_requestState'));
        const nights = await Promise.all(clients.map(client => waitState(client, roomId, s => s.phase === 'night' && s.playerRole?.id, 30000)));
        nights.forEach((state, index) => { clients[index].role = state.playerRole.id; });
        const roles = clients.map(c => c.role);
        const wolfCount = roles.filter(r => WOLVES.includes(r)).length;
        assert(roles.length === 20 && wolfCount === 4, `20-player table should deal 4 wolves, got ${wolfCount}`);
        assert(roles.includes('serialKiller') && roles.includes('fool') && roles.includes('seer'), 'table roles present');
        console.log('roles', roles.join(','));

        // illegal moves are rejected
        const villagerLike = clients.find(c => c.role === 'villager');
        const badKill = await emitAck(villagerLike.socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: host.playerId, actionType: 'night-kill' });
        assert(badKill?.success === false, 'villager cannot use a night skill');
        const sk = clients.find(c => c.role === 'serialKiller');
        const skNight1 = await emitAck(sk.socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: villagerLike.playerId });
        assert(skNight1?.success === false, 'SK cannot kill on night 1');
        stats.rejected += 2;

        let guard = 0;
        let lastPhaseKey = '';
        while (guard < 200) {
            guard += 1;
            const hostState = await freshState(host, roomId);
            if (hostState.phase === 'finished') break;
            const phaseKey = `${hostState.phase}-${hostState.dayNumber}`;
            assert(phaseKey !== lastPhaseKey || guard === 1, `phase did not advance (${phaseKey})`);
            lastPhaseKey = phaseKey;
            stats.phases += 1;
            const states = [];
            for (const client of clients) states.push(await freshState(client, roomId));
            states.forEach((state, index) => { checkLeaks(clients[index], state); stats.leakChecks += 1; });

            if (hostState.phase === 'night') {
                stats.nights += 1;
                const living = hostState.players.filter(p => p.alive);
                // wolves agree on one living non-wolf (from their own card's target list)
                const wolfCard = states.find((s, i) => WOLVES.includes(clients[i].role) && s.players.find(p => p.isSelf)?.alive)?.actionState.nightActions[0];
                const wolfTarget = wolfCard?.targets?.[hostState.dayNumber % Math.max(1, wolfCard.targets.length)]?.playerId;
                for (let i = 0; i < clients.length; i += 1) {
                    const state = states[i];
                    const self = state.players.find(p => p.isSelf);
                    if (!self?.alive) {
                        const dead = await emitAck(clients[i].socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: '__skip__' });
                        assert(dead?.success === false, 'dead player must not act');
                        stats.rejected += 1;
                        continue;
                    }
                    for (const card of state.actionState.nightActions || []) {
                        let target = '__skip__';
                        if (card.type === 'night-kill' && wolfTarget) target = wolfTarget;
                        else if (card.targets?.length && !card.locked && card.type !== 'witch-poison') target = card.targets[(i + hostState.dayNumber) % card.targets.length].playerId;
                        if (card.locked) continue;
                        const ack = await emitAck(clients[i].socket, 'werewolf_submitNightAction', { roomId, targetPlayerId: target, actionType: card.type });
                        if (ack?.success) stats.actions += 1;
                    }
                }
                const skip = await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'night' });
                assert(skip?.success || /ไม่มีช่วง|เปลี่ยนไปแล้ว/.test(skip?.error || ''), `night host skip failed: ${skip?.error}`);
                void living;
            } else if (hostState.phase === 'day-discussion') {
                const skip = await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'day-discussion' });
                assert(skip?.success || /ไม่มีช่วง|เปลี่ยนไปแล้ว/.test(skip?.error || ''), `discussion skip failed: ${skip?.error}`);
            } else if (hostState.phase === 'day-vote') {
                const living = hostState.players.filter(p => p.alive);
                const target = living[hostState.dayNumber % living.length];
                for (let i = 0; i < clients.length; i += 1) {
                    const self = states[i].players.find(p => p.isSelf);
                    if (!self?.alive || clients[i].playerId === target.playerId) continue;
                    const ack = await emitAck(clients[i].socket, 'werewolf_submitDayVote', { roomId, targetPlayerId: target.playerId });
                    if (ack?.success) stats.actions += 1;
                    if (ack?.resolved) break;
                }
                const cur = await freshState(host, roomId);
                if (cur.phase === 'day-vote') {
                    const skip = await emitAck(host.socket, 'werewolf_hostSkipPhase', { roomId, phase: 'day-vote' });
                    assert(skip?.success || /ไม่มีช่วง|เปลี่ยนไปแล้ว/.test(skip?.error || ''), `vote skip failed: ${skip?.error}`);
                }
            }
            // wait for the server to broadcast the next phase (transition delay ~2.6 s)
            await waitState(host, roomId, s => `${s.phase}-${s.dayNumber}` !== phaseKey, 20000);
        }
        const finalState = await freshState(host, roomId);
        assert(finalState.phase === 'finished' && finalState.winner, `game should finish (phase ${finalState.phase})`);
        assert(finalState.players.every(p => p.roleId), 'finished game reveals every role');
        console.log('SMOKE_RESULT ' + JSON.stringify({ roomId, players: N, winner: finalState.winner, days: finalState.dayNumber, ...stats }));
    } finally {
        clients.forEach(client => client.socket.disconnect());
        await stopServer(server);
        restoreDataFiles(dataSnapshot);
    }
}

main().catch(error => {
    console.error('SMOKE_FATAL', error.stack || error.message);
    process.exitCode = 1;
});
