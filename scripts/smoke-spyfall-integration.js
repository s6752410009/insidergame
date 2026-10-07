#!/usr/bin/env node
require('./isolateTestData');
'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { randomUUID } = require('crypto');

// เปิดบทสั้นๆ ให้เทสต์ไม่ต้องรอ 5 วิทุกรอบ
process.env.SPYFALL_REVEAL_PHASE_MS = process.env.SPYFALL_REVEAL_PHASE_MS || '1500';

const SERVER_TIMEOUT_MS = Number(process.env.SMOKE_SERVER_TIMEOUT_MS || 30000);
const EVENT_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function request(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            res.resume();
            resolve(res.statusCode || 0);
        });
        req.on('error', reject);
    });
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = require('net').createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForHttpReady(baseUrl, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const status = await request(baseUrl);
            if (status >= 200 && status < 500) {
                return;
            }
        } catch (error) {
            await delay(250);
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function spawnServer() {
    const port = await getFreePort();
    const appPath = path.join(__dirname, '..', 'app.js');
    const child = spawn(process.execPath, [appPath], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const startedPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for app startup on port ${port}`));
        }, SERVER_TIMEOUT_MS);

        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error(`App exited before startup with code ${code}`));
        });

        child.stdout.on('data', chunk => {
            const text = String(chunk);
            stdout += text;
            if (text.includes(`Server started on port ${port}`)) {
                clearTimeout(timer);
                resolve();
            }
        });
    });

    child.stderr.on('data', chunk => {
        stderr += String(chunk);
    });

    try {
        await startedPromise;
        await waitForHttpReady(`http://127.0.0.1:${port}`, SERVER_TIMEOUT_MS);
    } catch (error) {
        child.kill('SIGTERM');
        throw new Error(`${error.message}\n${stdout}\n${stderr}`.trim());
    }

    return { port, baseUrl: `http://127.0.0.1:${port}`, child };
}

function onceWithTimeout(socket, eventName, predicate = null, timeoutMs = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(eventName, handler);
            reject(new Error(`Timeout waiting for ${eventName}`));
        }, timeoutMs);

        function handler(payload) {
            if (predicate && !predicate(payload)) {
                return;
            }
            clearTimeout(timer);
            socket.off(eventName, handler);
            resolve(payload);
        }

        socket.on(eventName, handler);
    });
}

function emitAck(socket, eventName, payload, timeoutMs = EVENT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout ack for ${eventName}`)), timeoutMs);
        socket.emit(eventName, payload, response => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

function createClient(label, baseUrl) {
    const playerId = randomUUID();
    const socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false,
        forceNew: true,
        timeout: 15000
    });
    const states = [];
    socket.on('spyfallState', payload => {
        states.push(payload);
    });
    return { label, playerId, socket, states };
}

async function connectClient(client) {
    // ต่อติดก่อนเริ่มรอ event ได้ (สร้างหลาย socket พร้อมกัน) — ไม่งั้นรอ connect ไม่มีวันมา
    if (!client.socket.connected) {
        await onceWithTimeout(client.socket, 'connect', null, 15000);
    }
    client.socket.emit('initPlayer', client.playerId);
}

function bindRoom(client, roomId) {
    client.socket.emit('setRoom', { roomId, playerId: client.playerId });
    client.socket.emit('requestRoomUpdate', { roomId });
    client.socket.emit('spyfall_requestState', { roomId, playerId: client.playerId });
}

function waitSpyfallState(client, roomId, predicate, timeoutMs = EVENT_TIMEOUT_MS) {
    const existing = client.states.find(payload =>
        payload?.roomId === roomId && (!predicate || predicate(payload))
    );
    if (existing) {
        return Promise.resolve(existing);
    }
    return onceWithTimeout(
        client.socket,
        'spyfallState',
        payload => payload?.roomId === roomId && (!predicate || predicate(payload)),
        timeoutMs
    );
}

async function main() {
    const server = await spawnServer();
    const clients = ['a', 'b', 'c', 'd'].map(label => createClient(`player-${label}`, server.baseUrl));
    let roomId = null;

    try {
        console.log(`1. Server ready → ${server.baseUrl}`);
        for (const client of clients) {
            await connectClient(client);
        }

        const [admin, p2, p3, p4] = clients;

        console.log('2. Create Spyfall room');
        const createResponse = await emitAck(admin.socket, 'createRoom', {
            playerId: admin.playerId,
            name: `Spyfall Smoke ${Date.now()}`,
            gameMode: 'spyfall',
            maxPlayers: 8,
            roundTime: 1,
            // ส่วนนี้ทดสอบโหวตลับแบบเสียงข้างมาก (ค่าตั้งห้อง) · กติกาเอกฉันท์อยู่ใน unanimousFlow
            spyfallVoteMode: 'majority',
            spyfallRounds: 1
        });
        assert(createResponse?.success && createResponse.roomId, JSON.stringify(createResponse));
        roomId = createResponse.roomId;
        bindRoom(admin, roomId);

        console.log('3. Join players');
        for (const client of [p2, p3, p4]) {
            const joinResponse = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joinResponse?.success, `join failed: ${client.label}`);
            bindRoom(client, roomId);
        }

        console.log('4. Start game');
        const startResponse = await emitAck(admin.socket, 'startGameFromLobby', { roomId });
        assert(startResponse?.success, JSON.stringify(startResponse));

        await Promise.all(clients.map(c =>
            onceWithTimeout(c.socket, 'gameStarting', payload => payload?.roomId === roomId, 20000)
        ));

        await delay(500);
        clients.forEach(c => bindRoom(c, roomId));

        console.log('5. Reveal phase + role views');
        const revealStates = await Promise.all(clients.map(c =>
            waitSpyfallState(c, roomId, payload => payload.phase === 'reveal', 25000)
        ));

        const spies = revealStates.filter(state => state.self?.isSpy);
        const citizens = revealStates.filter(state => !state.self?.isSpy);
        assert(spies.length === 1, `expected 1 spy, got ${spies.length}`);
        assert(citizens.length === 3, `expected 3 citizens, got ${citizens.length}`);
        assert(spies[0].location === null, 'spy must not see location');
        assert(citizens[0].location?.name, 'citizen must see location');
        assert(spies[0].locationPool?.length >= 18, 'spy needs location pool');

        const spyId = spies[0].self.playerId;
        const citizenId = citizens[0].self.playerId;
        const byId = id => clients.find(c => c.playerId === id);

        console.log('6. Discussion: asker passes the question, the person asked asks next');
        const disc = await waitSpyfallState(admin, roomId, payload => payload.phase === 'discussion' && payload.turn?.askerId, 20000);
        const askerId = disc.turn.askerId;
        const target = clients.find(c => c.playerId !== askerId && c !== admin) || clients.find(c => c.playerId !== askerId);
        const outsider = clients.find(c => c.playerId !== askerId && c !== admin && c !== target);
        if (outsider) {
            const denied = await emitAck(outsider.socket, 'spyfall_passQuestion', { targetPlayerId: target.playerId });
            assert(denied?.success === false && /ตาของ/.test(denied.error || ''), 'non-asker must not pass the turn: ' + JSON.stringify(denied));
        }
        const passed = await emitAck(byId(askerId).socket, 'spyfall_passQuestion', { targetPlayerId: target.playerId });
        assert(passed?.success, 'pass question failed: ' + JSON.stringify(passed));
        await waitSpyfallState(target, roomId, payload => payload.turn?.isMyTurn === true && payload.turn?.lastAskerId === askerId, 10000);

        console.log('7. Ready-to-vote: majority (3 of 4) jumps straight to the vote');
        const readyOrder = clients.slice(0, 3);
        for (const client of readyOrder) {
            const r = await emitAck(client.socket, 'spyfall_readyVote', {});
            assert(r?.success, 'ready failed: ' + JSON.stringify(r));
        }
        await waitSpyfallState(admin, roomId, payload => payload.phase === 'vote', 10000);

        console.log('8. Everyone but one citizen votes, then that citizen leaves → result without waiting');
        const leaver = clients.find(c => c.playerId !== spyId && c !== admin);
        for (const client of clients) {
            if (client === leaver) continue;
            // สายลับโหวตพลเมืองคนไหนก็ได้ที่ไม่ใช่ตัวเองและไม่ใช่คนที่จะออก (เดิมสุ่มโดนโหวตตัวเองได้ถ้าสายลับเป็นหัวห้อง)
            const targetId = client.playerId === spyId
                ? clients.find(c => c.playerId !== spyId && c !== leaver).playerId
                : spyId;
            const voteResponse = await emitAck(client.socket, 'spyfall_vote', { targetPlayerId: targetId });
            assert(voteResponse?.success !== false, `vote failed: ${client.label} ${voteResponse?.error}`);
        }
        const leaveResponse = await emitAck(leaver.socket, 'leaveRoom', { roomId, playerId: leaver.playerId });
        assert(leaveResponse?.success !== false, 'leave failed: ' + JSON.stringify(leaveResponse));

        console.log('9. Finished — citizens win, recap has roles + return countdown');
        const finishedState = await waitSpyfallState(
            admin,
            roomId,
            payload => payload.phase === 'finished' && payload.winner?.team === 'citizens',
            15000
        );
        assert(finishedState.location?.name, 'location revealed');
        assert(finishedState.players.some(player => player.isSpy === true), 'roles revealed');
        assert(finishedState.players.every(player => player.roleTitle), 'every player shows a role title in the recap');
        assert(finishedState.returnLobbyAt && finishedState.returnLobbyAt - Date.now() > 15000,
            'players get >15s to read the recap before returning to the lobby');

        clients.forEach(client => client.socket.disconnect());
        await unanimousFlow(server);
        console.log('smoke-spyfall-integration: OK');
    } finally {
        clients.forEach(client => client.socket.disconnect());
        server.child.kill('SIGTERM');
    }
}

// กติกาจริง (ค่าเริ่ม): หยุดเวลากล่าวหา เอกฉันท์ · สายลับทายตอนเวลาเดิน · หลายรอบ เจ้ามือ = สายลับรอบก่อน
async function unanimousFlow(server) {
    const clients = ['e', 'f', 'g', 'h'].map(label => createClient(`player-${label}`, server.baseUrl));
    try {
        for (const client of clients) {
            await connectClient(client);
        }
        const [admin, ...guests] = clients;
        console.log('10. Unanimous room, 3 rounds');
        const created = await emitAck(admin.socket, 'createRoom', {
            playerId: admin.playerId,
            name: `Spyfall Rules ${Date.now()}`,
            gameMode: 'spyfall',
            maxPlayers: 8,
            roundTime: 1,
            spyfallRounds: 3
        });
        assert(created?.success && created.roomId, JSON.stringify(created));
        const roomId = created.roomId;
        bindRoom(admin, roomId);
        for (const client of guests) {
            const joined = await emitAck(client.socket, 'joinRoom', { roomId, playerId: client.playerId });
            assert(joined?.success, `join failed: ${client.label}`);
            bindRoom(client, roomId);
        }
        const started = await emitAck(admin.socket, 'startGameFromLobby', { roomId });
        assert(started?.success, JSON.stringify(started));
        await delay(400);
        clients.forEach(c => bindRoom(c, roomId));

        const disc = await Promise.all(clients.map(c =>
            waitSpyfallState(c, roomId, s => s.phase === 'discussion' && s.match?.round === 1, 25000)));
        const byId = id => clients.find(c => c.playerId === id);
        const spyState = disc.find(s => s.self.isSpy);
        const spy = byId(spyState.self.playerId);
        const citizens = clients.filter(c => c !== spy);
        const trueLocation = disc.find(s => !s.self.isSpy).location.id;
        assert(disc[0].voteMode === 'unanimous', 'default vote mode is unanimous');
        assert(disc[0].match.totalRounds === 3 && disc[0].match.dealerId, 'match info + dealer');
        assert(disc[0].turn.askerId === disc[0].match.dealerId, 'dealer asks first');

        console.log('11. Stop the clock: accuse, one "no" → clock runs again');
        const [accuser, suspect, objector] = citizens;
        const acc = await emitAck(accuser.socket, 'spyfall_accuse', { targetPlayerId: suspect.playerId });
        assert(acc?.success, 'accuse failed: ' + JSON.stringify(acc));
        const accState = await waitSpyfallState(suspect, roomId, s => s.phase === 'accuse' && s.accusation, 10000);
        assert(accState.accusation.isSuspect === true && accState.accusation.canVote === false, 'suspect cannot vote');
        const spyGuessBlocked = await emitAck(spy.socket, 'spyfall_guessLocation', { locationId: trueLocation });
        assert(spyGuessBlocked?.success === false, 'spy cannot guess while the clock is stopped');
        const no = await emitAck(objector.socket, 'spyfall_accuseVote', { agree: false });
        assert(no?.success, 'vote failed: ' + JSON.stringify(no));
        const resumed = await waitSpyfallState(accuser, roomId, s => s.phase === 'discussion' && s.accuseUsed === true, 10000);
        assert(resumed.canAccuse === false && resumed.phaseEndsAt > Date.now(), 'clock resumed, accuser used their stop');
        const again = await emitAck(accuser.socket, 'spyfall_accuse', { targetPlayerId: objector.playerId });
        assert(again?.success === false, 'only one accusation per player per round');

        console.log('12. Spy stops the clock and guesses right → 4 points, next round queued');
        const guess = await emitAck(spy.socket, 'spyfall_guessLocation', { locationId: trueLocation });
        assert(guess?.success && guess.correct, 'guess failed: ' + JSON.stringify(guess));
        const fin1 = await waitSpyfallState(admin, roomId, s => s.phase === 'finished' && s.match?.round === 1 && s.nextRoundAt, 10000);
        assert(fin1.winner.points[spy.playerId] === 4, 'spy guess = 4 points');
        assert(fin1.match.over === false, 'match continues');

        console.log('13. Host starts round 2 — last spy deals and asks first');
        const next = await emitAck(admin.socket, 'spyfall_nextRound', {});
        assert(next?.success, 'next round failed: ' + JSON.stringify(next));
        const disc2 = await waitSpyfallState(admin, roomId, s => s.phase === 'discussion' && s.match?.round === 2, 20000);
        assert(disc2.match.dealerId === spy.playerId, 'spy of round 1 deals round 2');
        assert(disc2.turn.askerId === spy.playerId, 'dealer asks first');
        assert(disc2.match.scoreboard.find(r => r.playerId === spy.playerId).score === 4, 'scores carry over');

        console.log('14. Host skips the clock → dealer-first accusations → unanimous verdict');
        const skip = await emitAck(admin.socket, 'spyfall_endDiscussion', {});
        assert(skip?.success, 'end discussion failed: ' + JSON.stringify(skip));
        const fin = await waitSpyfallState(admin, roomId, s => s.phase === 'final' && s.finalTurn, 10000);
        assert(fin.finalTurn.accuserId === spy.playerId, 'final accusations start with the dealer');
        const dealer = byId(fin.finalTurn.accuserId);
        const target = clients.find(c => c !== dealer);
        const fa = await emitAck(dealer.socket, 'spyfall_finalAccuse', { targetPlayerId: target.playerId });
        assert(fa?.success, 'final accuse failed: ' + JSON.stringify(fa));
        for (const c of clients) {
            if (c === dealer || c === target) continue;
            const v = await emitAck(c.socket, 'spyfall_accuseVote', { agree: true });
            assert(v?.success, 'agree failed: ' + JSON.stringify(v));
        }
        const end = await waitSpyfallState(admin, roomId, s => s.phase === 'finished' && s.match?.round === 2, 10000);
        assert(['convicted_spy', 'convicted_innocent'].includes(end.winner.reason), 'unanimous verdict: ' + end.winner.reason);
        assert(end.match.over === false && end.nextRoundAt, 'round 2 of 3 → next round queued');

        console.log('15. Round 3: spy guesses wrong → town wins, match over, back to lobby countdown');
        await emitAck(admin.socket, 'spyfall_nextRound', {});
        const disc3 = await Promise.all(clients.map(c =>
            waitSpyfallState(c, roomId, s => s.phase === 'discussion' && s.match?.round === 3, 20000)));
        const spy3 = byId(disc3.find(s => s.self.isSpy).self.playerId);
        const real3 = disc3.find(s => !s.self.isSpy).location.id;
        const wrong3 = disc3.find(s => s.self.isSpy).locationPool.find(l => l.id !== real3).id;
        const g3 = await emitAck(spy3.socket, 'spyfall_guessLocation', { locationId: wrong3 });
        assert(g3?.success && g3.correct === false, 'wrong guess ack');
        const last = await waitSpyfallState(admin, roomId, s => s.phase === 'finished' && s.match?.round === 3, 10000);
        assert(last.winner.reason === 'spy_guess_wrong' && last.winner.points[spy3.playerId] === undefined, 'wrong guess: spy gets nothing');
        assert(last.match.over === true && last.returnLobbyAt && !last.nextRoundAt, 'match over → back to lobby countdown');
        assert(last.match.rounds.length === 3, 'three rounds in the log');
        const noMore = await emitAck(admin.socket, 'spyfall_nextRound', {});
        assert(noMore?.success === false, 'no round 4');
    } finally {
        clients.forEach(client => client.socket.disconnect());
    }
}

main().catch(error => {
    console.error('smoke-spyfall-integration: FAIL', error.message);
    process.exit(1);
});
