'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildReport, period, publicRow } = require('./activityReport');
const VERSION = 1;
const dayOf = (at) =>
    new Date(new Date(at).getTime() + 7 * 3600000).toISOString().slice(0, 10);
const gameKey = (entry) =>
    entry.meta?.gameId
        ? JSON.stringify([
              entry.roomId || null,
              entry.gameMode || '',
              entry.meta.gameId,
          ])
        : null;
const debugEntry = (entry) =>
    entry.meta?.debugUsed === true ||
    entry.meta?.debug === true ||
    /\bDEBUG\b/i.test(entry.message || '');
const idOf = (day, mode) => JSON.stringify([day, mode]);
const empty = (day, mode, label = '') => ({
    day,
    mode,
    label,
    counts: {
        starts: 0,
        ends: 0,
        uniqueHumans: 0,
        joins: 0,
        leaves: 0,
        errors: 0,
        botStarts: 0,
        testStarts: 0,
        soloEnds: 0,
    },
    people: [],
    total: 0,
    oldestAt: null,
});
function merge(target, delta) {
    for (const key of Object.keys(target.counts))
        if (key !== 'uniqueHumans')
            target.counts[key] += delta.counts[key] || 0;
    const people = new Map(
        target.people.map((person) => [person.playerId, { ...person }]),
    );
    for (const person of delta.people) {
        const previous = people.get(person.playerId);
        if (!previous) {
            people.set(person.playerId, { ...person });
            continue;
        }
        previous.events += person.events;
        previous.starts += person.starts;
        previous.ends += person.ends;
        previous.hourMask |= person.hourMask;
        previous.played ||= person.played;
        if (person.lastAt > previous.lastAt) {
            previous.lastAt = person.lastAt;
            previous.playerName = person.playerName;
        }
    }
    target.people = [...people.values()];
    target.counts.uniqueHumans = target.people.length;
    target.total += delta.total;
    if (
        delta.oldestAt &&
        (!target.oldestAt || delta.oldestAt < target.oldestAt)
    )
        target.oldestAt = delta.oldestAt;
    if (delta.label) target.label = delta.label;
    return target;
}
async function summarize(entries, day, mode, now, debugGames) {
    const report = await buildReport(
        entries,
        { period: 'month', month: day.slice(0, 7) },
        {
            now,
            firstAt: day,
            source: 'daily-build',
            debugGames,
            captureInternal: true,
        },
    );
    return {
        day,
        mode,
        label: report.modes.find((item) => item.mode === mode)?.label || mode,
        counts: report.summary,
        people: report.internalPeople,
        total: report.activity.total,
        oldestAt: report.coverage.oldestEventAt,
    };
}
function createActivityDaily(options) {
    const { source, model: Model, file } = options;
    let documents = new Map(),
        loadedCount = 0;
    async function init() {
        if (Model) {
            await Model.init();
            return;
        }
        if (!fs.existsSync(file)) return;
        try {
            const stored = JSON.parse(await fs.promises.readFile(file, 'utf8'));
            if (stored.version !== VERSION || !Array.isArray(stored.documents))
                return;
            documents = new Map(
                stored.documents
                    .filter(
                        (doc) =>
                            doc.version === VERSION &&
                            doc.data &&
                            Array.isArray(doc.data.people),
                    )
                    .map((doc) => [doc._id, doc]),
            );
            loadedCount = [...documents.values()].reduce(
                (sum, doc) => sum + doc.data.total,
                0,
            );
        } catch (error) {
            documents.clear();
            loadedCount = 0;
        }
    }
    async function resetFile() {
        documents.clear();
        loadedCount = 0;
        await persistFile();
    }
    async function persistFile() {
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        const temporary = file + '.' + process.pid + '.tmp';
        await fs.promises.writeFile(
            temporary,
            JSON.stringify({
                version: VERSION,
                documents: [...documents.values()],
            }),
        );
        await fs.promises.rename(temporary, file);
    }
    async function get(day, mode) {
        return Model
            ? await Model.findById(idOf(day, mode)).lean()
            : documents.get(idOf(day, mode));
    }
    async function put(day, mode, data, checkpointIds) {
        const doc = {
            _id: idOf(day, mode),
            version: VERSION,
            day,
            mode,
            data,
            checkpointIds,
        };
        if (Model)
            await Model.replaceOne({ _id: doc._id }, doc, { upsert: true });
        else {
            const previous = documents.get(doc._id);
            documents.set(doc._id, doc);
            try {
                await persistFile();
            } catch (error) {
                if (previous) documents.set(doc._id, previous);
                else documents.delete(doc._id);
                throw error;
            }
        }
    }
    async function refresh(now) {
        let debugGames = await source.prepareDebug();
        // The checkpoint is written with the counters, before source acknowledgement.
        // A crash at either step can replay acknowledgements without double counting.
        for (;;) {
            const pending = await source.pending(500, now);
            if (!pending.length) break;
            // A live write can arrive while earlier buckets are being acknowledged.
            // Discover its debug scope before acknowledging any affected source rows.
            if (
                pending.some(
                    (record) =>
                        record.debug &&
                        record.gameKey &&
                        !debugGames.has(record.gameKey),
                )
            )
                debugGames = await source.prepareDebug();
            const groups = new Map();
            for (const record of pending) {
                if (debugGames.has(record.gameKey)) record.dailyRebuild = true;
                const day = dayOf(record.entry.timestamp),
                    mode = record.entry.gameMode || '',
                    key = idOf(day, mode);
                if (!groups.has(key))
                    groups.set(key, { day, mode, records: [] });
                groups.get(key).records.push(record);
            }
            for (const { day, mode, records } of groups.values()) {
                const previous = await get(day, mode),
                    checkpoint = previous?.checkpointIds || [];
                const rebuilding = records.some(
                    (record) => record.dailyRebuild,
                );
                if (!rebuilding && checkpoint.length)
                    await source.ack(checkpoint);
                const checkpointSet = new Set(checkpoint),
                    fresh = rebuilding
                        ? records
                        : records.filter(
                              (record) => !checkpointSet.has(record._id),
                          );
                if (!fresh.length) continue;
                let data,
                    ids = [];
                if (fresh.some((record) => record.dailyRebuild)) {
                    const rows = (async function* () {
                        for await (const record of source.bucket(
                            day,
                            mode,
                            now,
                        )) {
                            if (record.dailyVersion !== VERSION)
                                ids.push(record._id);
                            yield record.entry;
                        }
                    })();
                    data = await summarize(rows, day, mode, now, debugGames);
                } else {
                    ids = fresh.map((record) => record._id);
                    const rows = fresh
                        .map((record) => record.entry)
                        .sort(
                            (a, b) =>
                                b.timestamp.localeCompare(a.timestamp) ||
                                b.id.localeCompare(a.id),
                        );
                    data = merge(
                        previous?.version === VERSION
                            ? structuredClone(previous.data)
                            : empty(day, mode),
                        await summarize(rows, day, mode, now, debugGames),
                    );
                }
                await put(day, mode, data, ids);
                await source.ack(ids);
            }
        }
        return debugGames;
    }
    async function* query(from, to) {
        const lower = dayOf(from),
            upper = dayOf(Math.max(from, to));
        if (Model) {
            const cursor = Model.find(
                { version: VERSION, day: { $gte: lower, $lte: upper } },
                { data: 1, _id: 0 },
            )
                .lean()
                .cursor({ batchSize: 100 });
            try {
                for await (const doc of cursor) yield doc.data;
            } finally {
                await cursor.close();
            }
        } else
            for (const doc of documents.values())
                if (doc.day >= lower && doc.day <= upper) yield doc.data;
    }
    async function report(raw, context, debugGames) {
        const window = period(raw, context.now, context.firstAt),
            q = window.query;
        const result = await buildReport([], raw, context),
            people = new Map(),
            games = new Map(),
            modes = new Map();
        const days = new Map(result.daily.map((item) => [item.date, item]));
        let total = 0,
            oldest = null;
        for await (const bucket of query(window.from, window.to)) {
            if (window.to < window.from) continue;
            if (bucket.oldestAt && (!oldest || bucket.oldestAt < oldest))
                oldest = bucket.oldestAt;
            if (bucket.mode) modes.set(bucket.mode, bucket.label);
            if (q.mode !== 'all' && q.mode !== bucket.mode) continue;
            for (const key of Object.keys(result.summary))
                if (key !== 'uniqueHumans')
                    result.summary[key] += bucket.counts[key] || 0;
            total += bucket.total;
            const date = window.monthly
                    ? bucket.day.slice(0, 7) + '-01'
                    : bucket.day,
                day = days.get(date);
            if (day) {
                day.starts += bucket.counts.starts;
                day.ends += bucket.counts.ends;
            }
            if (bucket.mode && (bucket.counts.starts || bucket.counts.ends)) {
                let game = games.get(bucket.mode);
                if (!game) {
                    game = {
                        mode: bucket.mode,
                        label: bucket.label,
                        starts: 0,
                        ends: 0,
                        botStarts: 0,
                        humans: new Set(),
                    };
                    games.set(bucket.mode, game);
                }
                game.starts += bucket.counts.starts;
                game.ends += bucket.counts.ends;
                game.botStarts += bucket.counts.botStarts;
                bucket.people
                    .filter((person) => person.played)
                    .forEach((person) => game.humans.add(person.playerId));
            }
            for (const person of bucket.people) {
                const previous = people.get(person.playerId);
                if (!previous) people.set(person.playerId, { ...person });
                else {
                    previous.events += person.events;
                    previous.starts += person.starts;
                    previous.ends += person.ends;
                    previous.hourMask |= person.hourMask;
                    if (person.lastAt > previous.lastAt) {
                        previous.lastAt = person.lastAt;
                        previous.playerName = person.playerName;
                    }
                }
            }
        }
        result.summary.uniqueHumans = people.size;
        result.hourly = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            uniqueHumans: [...people.values()].filter(
                (person) => person.hourMask & (1 << hour),
            ).length,
        }));
        result.people = [...people.values()]
            .sort(
                (a, b) =>
                    b.events - a.events ||
                    b.lastAt.localeCompare(a.lastAt) ||
                    a.playerId.localeCompare(b.playerId),
            )
            .slice(0, 20)
            .map(({ hourMask, played, ...person }) => person);
        result.games = [...games.values()]
            .map(({ humans, ...game }) => ({
                ...game,
                uniqueHumans: humans.size,
            }))
            .sort(
                (a, b) =>
                    b.starts - a.starts ||
                    b.ends - a.ends ||
                    a.mode.localeCompare(b.mode),
            );
        result.modes = [...modes]
            .map(([mode, label]) => ({ mode, label }))
            .sort((a, b) => a.mode.localeCompare(b.mode));
        const pages = Math.max(1, Math.ceil(total / 50)),
            page = Math.min(q.page, pages);
        result.query.page = page;
        const profiles = new Map(
            (context.players || []).map((person) => [person.playerId, person]),
        );
        const records = await source.page(window, q.mode, (page - 1) * 50, 50);
        const rows = records.map((record) => {
            const row = publicRow(record.entry, profiles);
            if (debugGames.has(gameKey(record.entry))) row.debug = true;
            return row;
        });
        result.activity = { rows, page, pages, total, pageSize: 50 };
        result.coverage.oldestEventAt = oldest;
        result.coverage.summarySource = 'daily';
        return result;
    }
    return { init, refresh, report, resetFile, loadedCount: () => loadedCount };
}
module.exports = { createActivityDaily, VERSION, dayOf, gameKey, debugEntry };
