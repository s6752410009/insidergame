'use strict';

// Isolated, deterministic backend checks; no app server, database or player data.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAdminAnalytics, buildAnalytics } = require('../managers/adminAnalytics');
const { normalizeEntry } = require('../managers/serverLogManager');

const NOW = Date.parse('2026-11-07T18:00:00.000Z'); // Nov 8, 01:00 Bangkok
const iso = ms => new Date(ms).toISOString();
const context = { now: NOW, retentionDays: 7, source: 'file', players: [
    { playerId: 'p1', playerName: 'Current One', recoveryCode: 'PRIVATE_RECOVERY', googleToken: 'PRIVATE_TOKEN' },
    { playerId: 'p2', playerName: 'Current Two', password: 'PRIVATE_PASSWORD' }
] };
let sequence = 0;
function log(event, meta = {}, extra = {}) {
    return {
        id: 'event-' + String(++sequence).padStart(6, '0'),
        timestamp: iso(NOW - 1000), category: 'game', gameMode: 'poker',
        gameModeLabel: 'Poker', roomId: 'r1', roomName: 'Room One', message: event,
        meta: { event, ...meta }, ...extra
    };
}
const build = (logs, query = {}, overrides = {}) => buildAnalytics(logs, query, { ...context, ...overrides });
let passed = 0;
async function test(name, run) {
    await run();
    passed++;
    console.log('PASS ' + name);
}

async function main() {
    await test('exact DTO, safe actor projection and deterministic pure result', () => {
        const entries = [log('game_start', {
            playerId: 'p1', participantIds: ['p1', 'p2'], recoveryCode: 'PRIVATE_META', nested: { token: 'PRIVATE_NESTED' }
        }, { privateField: 'PRIVATE_LOG' })];
        const input = JSON.stringify(entries);
        const data = build(entries);
        assert.deepEqual(Object.keys(data), ['generatedAt', 'query', 'coverage', 'summary', 'games', 'daily', 'hourly', 'people', 'activity', 'modes']);
        assert.deepEqual(Object.keys(data.query), ['days', 'mode', 'playerId', 'kind', 'search', 'page']);
        assert.deepEqual(Object.keys(data.coverage), ['retentionDays', 'from', 'to', 'oldestEventAt', 'truncated', 'source']);
        assert.deepEqual(Object.keys(data.summary), ['starts', 'ends', 'uniqueHumans', 'joins', 'leaves', 'errors', 'botStarts', 'testStarts', 'soloEnds']);
        assert.deepEqual(Object.keys(data.games[0]), ['mode', 'label', 'starts', 'ends', 'uniqueHumans', 'botStarts']);
        assert.deepEqual(Object.keys(data.people[0]), ['playerId', 'playerName', 'events', 'lastAt', 'starts', 'ends']);
        assert.deepEqual(Object.keys(data.activity), ['rows', 'page', 'pages', 'total', 'pageSize']);
        assert.deepEqual(Object.keys(data.activity.rows[0]), ['id', 'timestamp', 'kind', 'mode', 'modeLabel', 'roomId', 'roomName', 'message', 'players', 'bot', 'debug']);
        assert.deepEqual(Object.keys(data.activity.rows[0].players[0]), ['playerId', 'playerName']);
        assert.equal(data.activity.rows[0].players[0].playerName, 'Current One');
        assert.ok(!JSON.stringify(data).includes('PRIVATE_'));
        assert.equal(JSON.stringify(entries), input);
        assert.deepEqual(build(entries), data);
        assert.throws(() => buildAnalytics(entries), /context.now/);
        assert.throws(() => build(entries, {}, { source: 'memory-fallback' }), /memory-fallback/);
    });

    await test('stable event IDs and meaningful result IDs deduplicate within room/mode; gameId keeps poker hands', () => {
        const first = log('game_end', { resultId: 'hand-1', gameId: 'table-1', participantIds: ['p1'] });
        const entries = [
            first, { ...first },
            log('game_end', { resultId: 'hand-1', gameId: 'table-1' }),
            log('game_end', { resultId: 'hand-2', gameId: 'table-1' }),
            log('game_end', { resultId: 'hand-1' }, { roomId: 'r2' }),
            log('game_end', { resultId: 'hand-1' }, { gameMode: 'coup' }),
            log('game_end', { gameId: 'table-1' }), log('game_end', { gameId: 'table-1' }),
            log('game_end', { resultId: 'unknown' }), log('game_end', { resultId: 'unknown' })
        ];
        const data = build(entries);
        assert.equal(data.summary.ends, 8);
        assert.equal(data.activity.total, 8);
    });

    await test('Bangkok calendar boundary, rolling retention clamp, invalid/future timestamps and zero buckets', () => {
        const entries = [
            log('game_start', { playerId: 'p1' }, { timestamp: '2026-11-07T17:00:00.000Z' }),
            log('game_start', {}, { timestamp: '2026-11-07T16:59:59.999Z' }),
            log('game_end', {}, { timestamp: iso(NOW + 1) }),
            log('game_end', {}, { timestamp: 'bad date' }),
            log('game_end', {}, { timestamp: iso(NOW - 7 * 86400000 - 1) })
        ];
        const today = build(entries, { days: '1' });
        assert.equal(today.summary.starts, 1);
        assert.equal(today.coverage.from, '2026-11-07T17:00:00.000Z');
        assert.deepEqual(today.daily, [{ date: '2026-11-08', starts: 1, ends: 0 }]);
        assert.equal(today.hourly.length, 24);
        assert.equal(today.hourly[0].uniqueHumans, 1);
        assert.equal(today.summary.ends, 0);
        assert.equal(today.coverage.oldestEventAt, '2026-11-07T16:59:59.999Z');
        const week = build(entries);
        assert.equal(week.daily.length, 7);
        assert.equal(week.daily[0].date, '2026-11-02');
        assert.equal(week.summary.starts, 2);
        const short = build(entries, { days: 7 }, { retentionDays: 1 });
        assert.equal(short.query.days, 1);
        assert.equal(short.daily.length, 1);
        assert.equal(build(entries, { days: 3 }).daily.length, 3);
        const fractional = build(entries, { days: 7 }, { retentionDays: 0.1 });
        assert.ok(Date.parse(fractional.coverage.from) >= NOW - 0.1 * 86400000);
    });

    await test('bot-only and DEBUG events stay in activity; human+bot starts are a subset; joins/leaves count humans', () => {
        const data = build([
            log('game_start', { participantIds: ['p1', 'bot_x'], bots: 1, humans: 1 }),
            log('game_start', { participantIds: ['bot_x'], humans: 0, bots: 1 }),
            log('game_end', { participantIds: ['bot_x'], humans: 0, bots: 1 }),
            log('game_start', { participantIds: ['p2'], debugUsed: true }),
            log('game_end', { participantIds: ['p2'], debugUsed: true }),
            log('game_start', { participantIds: ['p2'] }, { message: '[DEBUG] start' }),
            log('join', { playerId: 'p1' }, { category: 'join' }),
            log('leave', { playerId: 'p1' }, { category: 'leave' }),
            log('join', { playerId: 'bot_x', bot: true }, { category: 'join' }),
            log('leave', { playerId: 'bot_x', bot: true }, { category: 'leave' }),
            log('join', { playerId: 'p2', debugUsed: true }, { category: 'join' }),
            log('failure', {}, { category: 'error' })
        ]);
        assert.equal(data.summary.starts, 1);
        assert.equal(data.summary.ends, 0);
        assert.equal(data.summary.botStarts, 1);
        assert.equal(data.summary.testStarts, 2);
        assert.equal(data.summary.uniqueHumans, 1);
        assert.equal(data.summary.joins, 1);
        assert.equal(data.summary.leaves, 1);
        assert.equal(data.summary.errors, 1);
        assert.equal(data.activity.total, 12);
        assert.deepEqual(data.people.map(p => p.playerId), ['p1']);
    });

    await test('later debugUsed end marks matching game start, scoped by room/mode/gameId', () => {
        const data = build([
            log('game_start', { gameId: 'session', playerId: 'p1' }),
            log('game_end', { gameId: 'session', playerId: 'p1', debugUsed: true }),
            log('game_start', { gameId: 'other', playerId: 'p2' }),
            log('game_start', { gameId: 'session', playerId: 'p2' }, { roomId: 'r2' }),
            log('game_start', { gameId: 'session', playerId: 'p2' }, { gameMode: 'coup' })
        ]);
        assert.equal(data.summary.starts, 3);
        assert.equal(data.summary.testStarts, 1);
        assert.equal(data.summary.ends, 0);
    });

    await test('selected player scopes every metric but keeps full activity participants', () => {
        const entries = [
            log('game_start', { participantIds: ['p1', 'p2'] }),
            log('game_end', { participantIds: ['p1', 'p2'] }),
            log('detail', { playerId: 'p2' })
        ];
        const data = build(entries, { playerId: 'p1' });
        assert.equal(data.summary.uniqueHumans, 1);
        assert.equal(data.summary.starts, 1);
        assert.equal(data.summary.ends, 1);
        assert.equal(data.games[0].uniqueHumans, 1);
        assert.equal(data.hourly.reduce((sum, h) => sum + h.uniqueHumans, 0), 1);
        assert.deepEqual(data.people.map(p => p.playerId), ['p1']);
        assert.equal(data.people[0].events, 2);
        assert.equal(data.activity.rows[0].players.length, 2);
    });

    await test('legacy names never become identities; deleted IDs and actorId remain visible with safe name fallbacks', () => {
        const entries = [
            log('game_start', { players: 'Current One, Old Name' }),
            log('game_end', { players: ['p1', 'p2'] }),
            log('join', { playerId: 'deleted', playerName: 'Former Player' }, { category: 'join' }),
            log('detail', { actorId: 'actor-gone' }),
            log('detail', { participantIds: ['participant-gone', 'bot_old'] })
        ];
        const data = build(entries);
        assert.equal(data.summary.starts, 1);
        assert.equal(data.summary.ends, 1);
        assert.equal(data.summary.uniqueHumans, 3);
        assert.equal(build(entries, { playerId: 'p1' }).activity.total, 0);
        assert.equal(data.people.find(p => p.playerId === 'deleted').playerName, 'Former Player');
        assert.equal(data.people.find(p => p.playerId === 'actor-gone').playerName, 'actor-gone');
        assert.equal(data.people.find(p => p.playerId === 'participant-gone').playerName, 'participant-gone');
        assert.equal(data.activity.rows.find(r => r.kind === 'start').players.length, 0);
    });

    await test('solo results count only ends without invented starts', () => {
        const data = build([log('game_end', { playerId: 'p1' }, { gameMode: 'solo_memory', gameModeLabel: null })]);
        assert.equal(data.summary.starts, 0);
        assert.equal(data.summary.ends, 1);
        assert.equal(data.summary.soloEnds, 1);
        assert.deepEqual(data.games[0], { mode: 'solo_memory', label: 'solo_memory', starts: 0, ends: 1, uniqueHumans: 1, botStarts: 0 });
    });

    await test('kind/search affect only activity; mode/player affect all metrics; modes survive filtering', () => {
        const entries = [
            log('game_start', { participantIds: ['p1'] }),
            log('game_end', { playerId: 'p1' }, { message: 'Needle result' }),
            log('game_start', { playerId: 'p2' }, { gameMode: 'coup', gameModeLabel: 'Coup' })
        ];
        const baseline = build(entries);
        const filtered = build(entries, { kind: 'end', search: 'NEEDLE' });
        assert.deepEqual(filtered.summary, baseline.summary);
        assert.deepEqual(filtered.games, baseline.games);
        assert.equal(filtered.activity.total, 1);
        const player = build(entries, { mode: 'poker', playerId: 'p1', search: 'no match' });
        assert.equal(player.summary.starts, 1);
        assert.equal(player.activity.total, 0);
        assert.deepEqual(player.modes.map(m => m.mode), ['coup', 'poker']);
        assert.equal(build(entries, { mode: 'no-such-mode' }).summary.starts, 0);
        assert.equal(build(entries, { search: 'Current One' }).activity.total, 2);
        assert.equal(build(entries, { search: 'PRIVATE_RECOVERY' }).activity.total, 0);
    });

    await test('hostile query values are bounded scalars; search is literal and pagination clamps', () => {
        const entries = Array.from({ length: 123 }, () => log('game_start', { playerId: 'p1' }));
        const data = build(entries, { days: ['1'], mode: { $ne: null }, playerId: ['p1'], kind: '__proto__', search: { toString() { throw Error('must not coerce'); } }, page: '999999999' });
        assert.deepEqual(data.query, { days: 7, mode: 'all', playerId: '', kind: 'all', search: '', page: 3 });
        assert.equal(data.activity.rows.length, 23);
        assert.equal(data.activity.pageSize, 50);
        assert.equal(data.activity.total, 123);
        assert.equal(build(entries, { page: '-4' }).activity.page, 1);
        assert.equal(build(entries, { page: Infinity }).activity.page, 1);
        assert.equal(build(entries, { search: 'a'.repeat(10000) }).query.search.length, 100);
        assert.equal(build(entries, { mode: 'x'.repeat(81) }).query.mode, 'all');
        assert.equal(build(entries, { playerId: 'x'.repeat(81) }).query.playerId, '');
        assert.equal(build(entries, { search: '.*' }).activity.total, 0);
        assert.equal(build([], { page: 300 }).activity.pages, 1);
        assert.equal(build([], { page: 300 }).activity.page, 1);
    });

    await test('descending timestamps then IDs; games rank starts then ends; detail cannot inflate popularity; people top20', () => {
        const entries = [
            log('game_start', { playerId: 'p1' }),
            log('game_start', { playerId: 'p1' }, { gameMode: 'coup' }),
            log('game_end', { playerId: 'p1' }, { gameMode: 'coup' }),
            ...Array.from({ length: 30 }, (_, i) => log('detail', { playerId: 'detail-' + i }, { gameMode: 'detail-only' })),
            log('game_start', {}, { id: 'aaa', timestamp: iso(NOW - 1) }),
            log('game_start', {}, { id: 'zzz', timestamp: iso(NOW - 1) })
        ];
        const data = build(entries);
        assert.deepEqual(data.activity.rows.slice(0, 2).map(r => r.id), ['zzz', 'aaa']);
        assert.equal(data.games[0].mode, 'poker');
        assert.ok(!data.games.some(g => g.mode === 'detail-only'));
        assert.equal(data.people.length, 20);
        assert.equal(data.people[0].playerId, 'p1');
        const tied = build(entries.slice(0, 3));
        assert.equal(tied.games[0].mode, 'coup');
    });

    await test('all activity kinds map explicitly', () => {
        const entries = [
            log('game_start'), log('game_end'), log('game_abort'), log('table_end'),
            ...['join', 'leave', 'admin', 'error', 'system', 'chat', 'game'].map(category => log('misc', {}, { category }))
        ];
        for (const kind of ['start', 'end', 'join', 'leave', 'admin', 'error', 'detail', 'abort', 'system', 'chat']) {
            const data = build(entries, { kind });
            assert.ok(data.activity.total > 0, kind);
            assert.ok(data.activity.rows.every(r => r.kind === kind), kind);
        }
    });

    await test('normalizeEntry preserves 20 UUID participant IDs beyond 400 bytes and deduplicates/caps/filters', () => {
        const ids = Array.from({ length: 25 }, () => randomUUID());
        const normalized = normalizeEntry(log('game_start', { participantIds: ids.slice(0, 20) }));
        assert.ok(JSON.stringify(ids.slice(0, 20)).length > 400);
        assert.deepEqual(normalized.meta.participantIds, ids.slice(0, 20));
        const bounded = normalizeEntry(log('game_start', {
            participantIds: [null, 42, {}, 'x'.repeat(81), ids[0], ids[0], ...ids.slice(1)]
        }));
        assert.deepEqual(bounded.meta.participantIds, ids.slice(0, 20));
        assert.equal(build([normalized]).summary.uniqueHumans, 20);
    });

    await test('cache coalesces parallel scans, expires at15s, and uses fresh private-safe player context', async () => {
        let clock = NOW, scans = 0, probes = 0;
        const entry = log('game_start', { playerId: 'p1' });
        const store = {
            query: async options => { assert.deepEqual(options, { limit: 1 }); probes++; return { source: 'file' }; },
            retention: () => ({ days: 3 }),
            async *exportEntries(options, limit) {
                assert.deepEqual(options, {}); assert.equal(limit, 100001); scans++;
                await new Promise(resolve => setImmediate(resolve));
                yield entry;
            }
        };
        const analytics = createAdminAnalytics(store, { now: () => clock });
        const values = await Promise.all(Array.from({ length: 8 }, () => analytics.get({}, context)));
        assert.equal(scans, 1); assert.equal(probes, 2);
        assert.ok(values.every(data => data.query.days === 3));
        values[0].activity.rows[0].players[0].playerName = 'MUTATED';
        clock += 14999;
        const renamed = await analytics.get({}, { players: [{ playerId: 'p1', playerName: 'Renamed', token: 'PRIVATE_FRESH' }] });
        assert.equal(scans, 1);
        assert.equal(renamed.activity.rows[0].players[0].playerName, 'Renamed');
        assert.ok(!JSON.stringify(renamed).includes('PRIVATE_'));
        clock++;
        await Promise.all([analytics.get(), analytics.get()]);
        assert.equal(scans, 2);
    });

    await test('detectable memory fallback fails closed before/after scan and errors retry without stale success', async () => {
        let fallback = true, scans = 0, postFallback = false;
        const store = {
            query: async () => ({ source: fallback || postFallback && scans > 0 ? 'memory-fallback' : 'mongo' }),
            async *exportEntries() { scans++; yield log('game_start'); }
        };
        const analytics = createAdminAnalytics(store, { now: () => NOW });
        await assert.rejects(analytics.get(), /memory-fallback/);
        assert.equal(scans, 0);
        fallback = false; postFallback = true;
        await assert.rejects(analytics.get(), /memory-fallback/);
        assert.equal(scans, 1);
        postFallback = false;
        assert.equal((await analytics.get()).coverage.source, 'mongo');
        assert.equal(scans, 2);
        const broken = createAdminAnalytics({
            async *exportEntries() { throw new Error('source unavailable'); }
        }, { now: () => NOW });
        await assert.rejects(broken.get(), /source unavailable/);
        await assert.rejects(broken.get(), /source unavailable/);
    });

    await test('generic awaited-array export, source changes and retention metadata', async () => {
        const analytics = createAdminAnalytics({
            exportEntries: async () => [log('game_start')],
            stats: () => ({ retentionDays: 1 }),
            isUsingDatabase: () => false
        }, { now: () => NOW });
        const data = await analytics.get();
        assert.equal(data.coverage.source, 'file');
        assert.equal(data.query.days, 1);
        let probes = 0;
        const changing = createAdminAnalytics({
            query: async () => ({ source: ++probes === 1 ? 'mongo' : 'file' }),
            exportEntries: async () => []
        }, { now: () => NOW });
        await assert.rejects(changing.get(), /source changed/);
    });

    await test('100001 export sentinel caps at100000, exposes truncation and yields to event loop', async () => {
        let yielded = 0, heartbeat = 0, active = true;
        const tick = () => { heartbeat++; if (active) setImmediate(tick); };
        setImmediate(tick);
        const entry = log('detail', { playerId: 'p1' });
        const analytics = createAdminAnalytics({
            query: async () => ({ source: 'file' }),
            async *exportEntries(_, limit) {
                assert.equal(limit, 100001);
                for (let i = 0; i < 100005; i++) {
                    yielded++;
                    yield { ...entry, id: 'cap-' + i };
                }
            }
        }, { now: () => NOW });
        try {
            const data = await analytics.get();
            assert.equal(yielded, 100001);
            assert.equal(data.activity.total, 100000);
            assert.equal(data.coverage.truncated, true);
            assert.ok(heartbeat >= 100, 'event loop must run at each1000 scan/aggregation entries');
            const exact = createAdminAnalytics({
                exportEntries: async () => Array.from({ length: 100000 }, (_, i) => ({ ...entry, id: 'exact-' + i }))
            }, { now: () => NOW });
            assert.equal((await exact.get()).coverage.truncated, false);
        } finally { active = false; }
    });

    console.log('Admin analytics smoke: ' + passed + ' checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
