'use strict';
const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { createActivityArchive } = require('../managers/activityArchive');
const { buildReport, period } = require('../managers/activityReport');
const { recordedNames } = require('../managers/activityIdentity');
const now = Date.parse('2026-11-07T06:00:00Z');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-archive-'));
let n = 0;
const check = (value, description) => {
    assert.ok(value, description);
    n++;
};
const p1 = {
    playerId: 'p1',
    playerName: 'Mark.',
    avatar: '👽',
    avatarFrame: 'rainbow',
    color: '#22aa99',
    avatarImage: 'https://lh3.googleusercontent.com/a/photo=s400',
    recoveryCode: 'PRIVATE',
};
const entry = (id, timestamp, meta = {}, extra = {}) => ({
    id,
    timestamp,
    category: 'game',
    type: 'info',
    roomId: 'r1',
    roomName: 'ห้องเพื่อน',
    gameMode: 'liar',
    gameModeLabel: 'ไพ่โกหก',
    message: 'Mark. เล่น',
    meta,
    ...extra,
});
async function main() {
    check(
        recordedNames(
            entry(
                'a',
                '2026-11-01',
                { event: 'liar_history' },
                { message: '🃏 🂠 ชื่อ มีช่องว่าง ลง 2 ใบ บอกว่าเป็น คิง' },
            ),
        )[0] === 'ชื่อ มีช่องว่าง',
        'legacy play name',
    );
    check(
        recordedNames(
            entry(
                'a',
                '2026-11-01',
                {},
                { category: 'join', message: 'Mark. เข้าห้อง' },
            ),
        )[0] === 'Mark.',
        'legacy join name',
    );
    check(
        recordedNames(
            entry(
                'a',
                '2026-11-01',
                { event: 'liar_history' },
                { message: '🃏 🎬 เริ่มเกม — คนละ 5 ใบ' },
            ),
        ).length === 0,
        'system event has no invented actor',
    );
    let store = createActivityArchive({
        file: path.join(dir, 'archive.ndjson'),
        useDatabase: false,
        now: () => now,
        resolvePlayer: (id) => (id === 'p1' ? p1 : null),
    });
    await store.init();
    const records = [
        entry('old', '2026-08-02T03:00:00Z', {
            event: 'game_start',
            participantIds: ['p1'],
        }),
        entry('oct', '2026-10-31T17:00:00Z', {
            event: 'game_end',
            playerId: 'p1',
            resultId: 'unique',
        }),
        entry('new', '2026-11-07T03:00:00Z', {
            event: 'liar_history',
            playerId: 'p1',
            playerName: 'Mark.',
            password: 'PRIVATE_SECRET',
        }),
        entry(
            'legacy',
            '2026-11-06T15:00:00Z',
            { event: 'liar_history' },
            { message: '🃏 🂠 Mark. ลง 1 ใบ บอกว่าเป็น เอซ' },
        ),
    ];
    await store.importLogs({
        async *exportEntries() {
            yield* records;
            yield* records;
        },
    });
    const all = await store.getReport({ period: 'all' }, { players: [p1] });
    check(
        all.activity.total === 4 &&
            all.summary.starts === 1 &&
            all.summary.ends === 1,
        'all-time imports idempotently and includes old months',
    );
    check(
        all.daily.length === 4 && all.daily[0].date === '2026-08-01',
        'all-time graph has every calendar month',
    );
    check(
        all.activity.rows.find((row) => row.id === 'legacy')
            .recordedNames[0] === 'Mark.',
        'old names display without identity matching',
    );
    check(
        all.activity.rows.find((row) => row.id === 'legacy').players.length ===
            0,
        'old name is not falsely bound to account',
    );
    check(
        all.people[0].avatar === '👽' &&
            all.people[0].avatarFrame === 'rainbow' &&
            all.people[0].avatarImage.endsWith('=s96-c'),
        'real profile and photo projected',
    );
    check(
        !JSON.stringify(all).includes('PRIVATE') &&
            !fs
                .readFileSync(path.join(dir, 'archive.ndjson'), 'utf8')
                .includes('PRIVATE'),
        'no private fields returned or archived',
    );
    const november = await store.getReport(
        { period: 'month', month: '2026-11' },
        { players: [p1] },
    );
    check(
        november.activity.total === 3 && november.summary.ends === 1,
        'Thai midnight assigns Oct31 17UTC to November',
    );
    const august = await store.getReport(
        { period: 'month', month: '2026-08' },
        { players: [p1] },
    );
    check(
        august.activity.total === 1 &&
            august.summary.starts === 1 &&
            august.daily.length === 31,
        'old month is independently queryable',
    );
    const identity = await store.getReport(
        { period: 'all', playerId: 'p1' },
        { players: [p1] },
    );
    check(
        identity.activity.total === 3,
        'exact ID filter never assigns legacy names',
    );
    const noPhoto = { ...p1 };
    delete noPhoto.avatarImage;
    const fresh = await store.getReport(
        { period: 'all' },
        { players: [noPhoto] },
    );
    check(
        !fresh.people[0].avatarImage,
        'cached queries respect current photo opt-out',
    );
    store = createActivityArchive({
        file: path.join(dir, 'archive.ndjson'),
        useDatabase: false,
        now: () => now,
    });
    await store.init();
    const restored = await store.getReport({ period: 'all' }, { players: [] });
    check(
        restored.activity.total === 4 &&
            restored.people[0].playerName === 'Mark.',
        'archive survives restart and deleted profile retains recorded name',
    );
    for (let i = 0; i < 115; i++)
        store.add(
            entry(
                'page-' + i,
                '2026-11-07T05:' +
                    String(Math.floor(i / 60)).padStart(2, '0') +
                    ':' +
                    String(i % 60).padStart(2, '0') +
                    'Z',
                { playerId: 'p1' },
            ),
        );
    await store.flush();
    const last = await store.getReport({ period: 'all', page: 999 });
    check(
        last.activity.page === 3 &&
            last.activity.rows.length === 19 &&
            last.activity.total === 119,
        'oversized page clamps to complete final page',
    );
    const empty = await store.getReport({ period: 'month', month: '2025-01' });
    check(
        empty.activity.total === 0 && empty.daily.length === 31,
        'empty historical month is empty, not fabricated',
    );
    const { ActivityArchive } = require('../managers/models');
    check(
        ActivityArchive.schema
            .indexes()
            .every(([, options]) => !('expireAfterSeconds' in options)),
        'archive has no log TTL',
    );
    const window = period({ period: 'month', month: '2026-11' }, now);
    check(
        new Date(window.from).toISOString() === '2026-10-31T17:00:00.000Z',
        'month boundaries use Bangkok',
    );

    // Exercise the database adapter, including indexed range reads and retries.
    const database = new Map();
    let failWrite = false,
        closed = 0,
        sortUsed = null;
    const createTestModel=require('./testActivityModel');
    let opened=0;
    const model=createTestModel(database,event=>{if(event==='open')opened++;else closed++;});
    const dailyModel=createTestModel();
    const write=model.bulkWrite;
    model.bulkWrite=async operations=>{if(failWrite)throw new Error('simulated unavailable');return write(operations);};
    const mongo = createActivityArchive({
        useDatabase: true,
        model,
        dailyModel,
        now: () => now,
        resolvePlayer: (id) => (id === 'p1' ? p1 : null),
    });
    await mongo.init();
    await mongo.importLogs({
        async *exportEntries() {
            yield* records;
            yield* records;
        },
    });
    const dbAll = await mongo.getReport({ period: 'all' }, { players: [p1] });
    check(
        dbAll.activity.total === 4 && database.size === 4,
        'Mongo upserts preserve import idempotency',
    );
    check(
        opened===closed && closed>0,
        'Mongo uses indexed order and closes its cursor',
    );
    const dbMonth = await mongo.getReport(
        { period: 'month', month: '2026-08' },
        { players: [p1] },
    );
    check(
        dbMonth.activity.total === 1 && dbMonth.summary.starts === 1,
        'Mongo historical month matches file archive',
    );
    const removed = await mongo.getReport({ period: 'all' }, { players: [] });
    check(
        !removed.people[0].avatarImage,
        'profile removed during cache lifetime does not retain photo',
    );
    failWrite = true;
    mongo.add(entry('retry', '2026-11-07T05:59:00Z', { playerId: 'p1' }));
    await assert.rejects(
        mongo.getReport({ period: 'all', fresh: '1' }),
        /simulated unavailable/,
    );
    n++;
    failWrite = false;
    const retry = await mongo.getReport({ period: 'all', fresh: '1' });
    check(
        retry.activity.total === 5,
        'failed writes retry without losing the event',
    );
    const bad = createActivityArchive({
        useDatabase: true,
        model,
        dailyModel,
        now: () => now,
    });
    await bad.init();
    await assert.rejects(
        bad.importLogs({
            async query() {
                return { source: 'memory-fallback' };
            },
            async *exportEntries() {
                yield records[0];
            },
        }),
        /source unavailable/,
    );
    n++;
    await assert.rejects(bad.getReport({ period: 'all' }), /not ready/);
    n++;
    const bigCount = 100051;
    const large = await buildReport(
        (async function* () {
            for (let i = 0; i < bigCount; i++)
                yield entry('stream-' + i, '2026-11-07T03:00:00Z', {
                    playerId: 'p1',
                });
        })(),
        { period: 'all', page: 2002 },
        { now, firstAt: '2026-11-07', source: 'mongo-archive', players: [p1] },
    );
    check(
        large.activity.total === bigCount &&
            large.activity.rows.length === 1 &&
            !large.coverage.truncated,
        'stream reports more than 100000 records with bounded page output',
    );
    const { createServerLogManager } = require('../managers/serverLogManager');
    const diagnostic = createServerLogManager({
        file: path.join(dir, 'diagnostic.ndjson'),
    });
    await diagnostic.init();
    diagnostic.setEntrySink((log) => store.add(log));
    diagnostic.add({
        timestamp: new Date(now - 1000).toISOString(),
        category: 'join',
        message: 'Mark. เข้าห้อง',
        meta: { playerId: 'p1' },
    });
    await store.flush();
    await diagnostic.clear();
    const retained = await store.getReport({ period: 'all', fresh: '1' });
    check(
        retained.activity.total === 120,
        'clearing diagnostic logs preserves captured activity',
    );
    const placeholders = createActivityArchive({
        file: path.join(dir, 'placeholders.ndjson'),
        useDatabase: false,
        now: () => now,
    });
    await placeholders.init();
    for (let i = 0; i < 2; i++)
        placeholders.add(
            entry('unknown-' + i, '2026-11-07T03:00:00Z', {
                event: 'game_end',
                resultId: 'unknown',
            }),
        );
    const unidentified = await placeholders.getReport({ period: 'all' });
    check(
        unidentified.summary.ends === 2,
        'placeholder result IDs do not collapse unrelated games',
    );
    check(
        period({ period: 'month', month: ['2026-08'] }, now).query.month ===
            '2026-11',
        'malformed month does not crash or coerce arrays',
    );
    console.log('Activity archive: ' + n + ' checks passed');
}
const deadline=setTimeout(()=>{console.error('Archive test did not finish');process.exit(1);},30000);
main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {clearTimeout(deadline);fs.rmSync(dir, { recursive: true, force: true });});
