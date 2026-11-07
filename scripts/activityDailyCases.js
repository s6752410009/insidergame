'use strict';
const assert = require('node:assert/strict');
const { buildReport } = require('../managers/activityReport');
const { gameKey, debugEntry } = require('../managers/activityDaily');
module.exports = async function runCases(factory) {
    const now = Date.parse('2026-11-07T06:00:00Z');
    let checks = 0;
    const ok = (condition, label) => {
        assert.ok(condition, label);
        checks++;
    };
    const players = [
        {
            playerId: 'p1',
            playerName: 'Mark.',
            avatar: '👽',
            avatarFrame: 'rainbow',
        },
        { playerId: 'p2', playerName: 'Mark.', avatar: '🐼' },
    ];
    const log = (id, timestamp, event, meta = {}, mode = 'slave') => ({
        id,
        timestamp: new Date(timestamp).toISOString(),
        category: event === 'join' ? 'join' : 'game',
        type: 'info',
        roomId: 'r1',
        gameMode: mode,
        gameModeLabel: mode === 'slave' ? 'สลาฟ' : mode,
        message: event,
        meta: { event, playerId: 'p1', ...meta },
    });
    const entries = Array.from({ length: 1200 }, (_, i) =>
        log(
            'seed-' + i,
            new Date(
                Date.parse('2026-10-01T00:00:00Z') + i * 3600000,
            ).toISOString(),
            i % 9 === 0 ? 'game_start' : i % 11 === 0 ? 'game_end' : 'join',
            {
                playerId: i % 2 ? 'p1' : 'p2',
                participantIds: i % 9 === 0 ? ['p1', 'p2'] : undefined,
            },
            i % 3 ? 'slave' : 'coup',
        ),
    ).filter((e) => Date.parse(e.timestamp) <= now);
    entries.push(
        log('bkk-boundary', '2026-10-31T17:00:00Z', 'game_start', {
            participantIds: ['p1', 'p2'],
        }),
    );
    entries.push(
        log('bot', '2026-11-01T05:00:00Z', 'game_start', {
            playerId: 'bot_a',
            humans: 0,
            bots: 1,
        }),
    );
    entries.push(
        log('continuous-round', '2026-11-07T05:30:00Z', 'round_end', {
            gameId: 'continuous',
            resultId: 'continuous:6',
            participantIds: ['p1', 'p2'],
        }),
    );
    for (let person = 0; person < 25; person++) {
        for (const month of ['10', '11'])
            entries.push(
                log(
                    `person-${person}-${month}`,
                    `2026-${month}-03T04:00:00Z`,
                    'join',
                    { playerId: 'extra-' + person },
                ),
            );
    }
    await factory.seed(entries);
    let archive = factory.archive({
        now: () => now,
        resolvePlayer: (id) => players.find((p) => p.playerId === id),
        dailyRefreshMs: 0,
    });
    await archive.init();
    const context = { players };
    async function parity(raw) {
        const actual = await archive.getReport({ ...raw, fresh: '1' }, context);
        const expected = await buildReport(
            entries
                .slice()
                .sort(
                    (a, b) =>
                        b.timestamp.localeCompare(a.timestamp) ||
                        b.id.localeCompare(a.id),
                ),
            raw,
            {
                now,
                firstAt: entries.reduce(
                    (old, e) => (old < e.timestamp ? old : e.timestamp),
                    entries[0].timestamp,
                ),
                source: 'test',
                players,
                debugGames: new Set(
                    entries.filter(debugEntry).map(gameKey).filter(Boolean),
                ),
            },
        );
        for (const key of [
            'summary',
            'daily',
            'games',
            'hourly',
            'people',
            'modes',
        ])
            assert.deepEqual(
                actual[key],
                expected[key],
                key + ' matches raw archive ' + JSON.stringify(raw),
            );
        ok(
            actual.activity.total === expected.activity.total &&
                actual.activity.page === expected.activity.page,
            'daily feed count and page match raw report',
        );
        assert.deepEqual(
            actual.activity.rows.map((row) => row.id),
            expected.activity.rows.map((row) => row.id),
        );
        checks++;
        if (!raw.playerId && !raw.search && !raw.kind)
            ok(
                actual.coverage.summarySource === 'daily',
                'normal report uses persisted daily summaries',
            );
        return actual;
    }
    for (const raw of [
        { period: 'all' },
        { period: 'all', mode: 'slave' },
        { period: 'month', month: '2026-10' },
        { period: 'month', month: '2026-11' },
        { days: 7 },
        { period: 'all', page: 999 },
        { period: 'all', playerId: 'p1' },
        { period: 'all', kind: 'join' },
    ])
        await parity(raw);
    const distinct = await parity({ period: 'all' });
    ok(
        distinct.summary.uniqueHumans === 27 && distinct.people.length === 20,
        'distinct users are not truncated to the twenty displayed players',
    );
    const cursorBefore = factory.cursorCount();
    await parity({ period: 'all', page: 2 });
    await parity({ period: 'month', month: '2026-10', mode: 'coup' });
    ok(
        factory.cursorCount() === cursorBefore,
        'historical reports use no raw archive cursor scans after backfill',
    );
    const added = log('late', '2026-10-02T12:00:00Z', 'join', {
        playerId: 'p1',
    });
    entries.push(added);
    archive.add(added);
    await parity({ period: 'all' });
    const originalRootUpdate = factory.root.updateMany;
    let failAck = true;
    factory.root.updateMany = async (filter, update) => {
        if (failAck && filter._id?.$in) {
            failAck = false;
            throw new Error('injected ack failure');
        }
        return originalRootUpdate.call(factory.root, filter, update);
    };
    const crashing = log('crash', '2026-11-07T05:00:00Z', 'join');
    entries.push(crashing);
    archive.add(crashing);
    await assert.rejects(
        archive.getReport({ period: 'all', fresh: '1' }, context),
        /injected ack failure/,
    );
    checks++;
    factory.root.updateMany = originalRootUpdate;
    archive = factory.archive({
        now: () => now,
        resolvePlayer: (id) => players.find((p) => p.playerId === id),
        dailyRefreshMs: 0,
    });
    await archive.init();
    await parity({ period: 'all' });
    ok(
        (await factory.rawCount()) === entries.length,
        'checkpoint replay does not add or lose source records',
    );
    const start = log('tainted-start', '2026-10-02T14:00:00Z', 'game_start', {
        gameId: 'tainted',
        participantIds: ['p1'],
    });
    entries.push(start);
    archive.add(start);
    await parity({ period: 'all' });
    const debug = log('late-debug', '2026-11-07T05:01:00Z', 'slave_history', {
        gameId: 'tainted',
        debugUsed: true,
    });
    entries.push(debug);
    archive.add(debug);
    await parity({ period: 'all' });
    await parity({ period: 'month', month: '2026-10' });
    ok(
        (await archive.getReport({ period: 'all', fresh: '1' }, context))
            .summary.testStarts === 1,
        'late debug flags repair historical day totals',
    );
    const concurrentStart = log(
        'concurrent-start',
        '2026-10-03T14:00:00Z',
        'game_start',
        { gameId: 'concurrent', participantIds: ['p1'] },
    );
    entries.push(concurrentStart);
    archive.add(concurrentStart);
    await parity({ period: 'all' });
    const trigger = log('trigger', '2026-11-07T05:02:00Z', 'join');
    entries.push(trigger);
    archive.add(trigger);
    let injected = false;
    factory.root.updateMany = async (filter, update) => {
        const result = await originalRootUpdate.call(
            factory.root,
            filter,
            update,
        );
        if (!injected && filter._id?.$in) {
            injected = true;
            const liveDebug = log(
                'concurrent-debug',
                '2026-11-07T05:03:00Z',
                'slave_history',
                { gameId: 'concurrent', debugUsed: true },
            );
            entries.push(liveDebug);
            archive.add(liveDebug);
            await archive.flush();
        }
        return result;
    };
    try {
        await parity({ period: 'all' });
    } finally {
        factory.root.updateMany = originalRootUpdate;
    }
    ok(
        injected,
        'live debug event arrived while daily counters were being acknowledged',
    );
    await parity({ period: 'month', month: '2026-10' });
    const dailyJson = JSON.stringify(await factory.dailyData());
    ok(
        !/avatarImage|googleSub|recoveryCode|password/.test(dailyJson),
        'stored daily counters contain no private profile fields',
    );
    console.log(
        'Daily activity ' + factory.name + ': ' + checks + ' checks passed',
    );
};
