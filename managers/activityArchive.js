'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    crypto = require('node:crypto');
const { buildReport, period } = require('./activityReport');
const fields = [
    'event',
    'kind',
    'playerId',
    'playerName',
    'actorId',
    'actorName',
    'participantIds',
    'players',
    'gameId',
    'resultId',
    'debugUsed',
    'debug',
    'bot',
    'isBot',
    'humans',
    'bots',
];
function project(log, resolvePlayer) {
    if (!log || !log.id || !Number.isFinite(Date.parse(log.timestamp)))
        return null;
    const meta = {};
    for (const key of fields) {
        const value = log.meta?.[key];
        if (key === 'participantIds' && Array.isArray(value))
            meta[key] = value
                .filter((v) => typeof v === 'string' && v.length <= 80)
                .slice(0, 20);
        else if (['string', 'number', 'boolean'].includes(typeof value))
            meta[key] = typeof value === 'string' ? value.slice(0, 400) : value;
    }
    const ids = [
        meta.playerId,
        meta.actorId,
        ...(Array.isArray(meta.participantIds) ? meta.participantIds : []),
    ]
        .filter((v) => typeof v === 'string' && v.length <= 80)
        .slice(0, 22);
    const names = {};
    for (const id of ids) {
        const player = resolvePlayer?.(id);
        const name = player?.playerName || log.meta?.participantNames?.[id];
        if (typeof name === 'string') names[id] = name.slice(0, 160);
    }
    if (Object.keys(names).length) meta.participantNames = names;
    return {
        id: String(log.id).slice(0, 160),
        timestamp: new Date(log.timestamp).toISOString(),
        category: log.category,
        type: log.type,
        roomId: log.roomId || null,
        roomName: String(log.roomName || '').slice(0, 160),
        gameMode: log.gameMode || null,
        gameModeLabel: String(log.gameModeLabel || '').slice(0, 160),
        message: String(log.message || '').slice(0, 1000),
        bot: log.bot === true,
        meta,
    };
}
function keyOf(entry) {
    const resultId =
        typeof entry.meta?.resultId === 'string'
            ? entry.meta.resultId.trim()
            : '';
    const hasResult =
        resultId &&
        resultId.length <= 80 &&
        !/^(?:null|undefined|unknown|none|0)$/i.test(resultId);
    return entry.meta?.event === 'game_end' && hasResult
        ? 'result:' +
              crypto
                  .createHash('sha256')
                  .update(
                      JSON.stringify([entry.roomId, entry.gameMode, resultId]),
                  )
                  .digest('hex')
        : 'log:' + entry.id;
}
function createActivityArchive(options = {}) {
    const file =
        options.file ||
        require('./dataPaths').dataFile('activityArchive.ndjson');
    let Model = options.model || null,
        usingDatabase = false,
        ready = false,
        unavailable = null,
        importing = false,
        timer = null,
        pending = new Map(),
        flushing = null;
    const memory = new Map(),
        cache = new Map(),
        inflight = new Map();
    let firstAt = null;
    const now = options.now || Date.now;
    function add(raw) {
        const entry = project(raw, options.resolvePlayer);
        if (!entry) return;
        const key = keyOf(entry);
        if (!usingDatabase && memory.has(key)) return;
        if (!firstAt || entry.timestamp < firstAt) firstAt = entry.timestamp;
        if (!usingDatabase) memory.set(key, entry);
        pending.set(key, entry);
        if (ready && !timer) {
            timer = setTimeout(() => {
                timer = null;
                flush().catch(() => {});
            }, 500);
            timer.unref?.();
        }
    }
    async function flush() {
        if (flushing) {
            await flushing;
            return pending.size ? flush() : undefined;
        }
        if (!pending.size || !ready) return;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        const batch = [...pending];
        pending.clear();
        flushing = (async () => {
            if (usingDatabase) {
                await Model.bulkWrite(
                    batch.map(([key, entry]) => ({
                        updateOne: {
                            filter: { _id: key },
                            update: {
                                $setOnInsert: {
                                    at: new Date(entry.timestamp),
                                    entry,
                                },
                            },
                            upsert: true,
                        },
                    })),
                    { ordered: false },
                );
            } else {
                await fs.promises.mkdir(path.dirname(file), {
                    recursive: true,
                });
                await fs.promises.appendFile(
                    file,
                    batch
                        .map(([key, entry]) => JSON.stringify({ key, entry }))
                        .join('\n') + '\n',
                );
            }
        })();
        try {
            await flushing;
            unavailable = null;
        } catch (error) {
            for (const [key, entry] of batch)
                if (!pending.has(key)) pending.set(key, entry);
            unavailable = 'Activity archive write unavailable';
            throw error;
        } finally {
            flushing = null;
        }
    }
    async function init() {
        usingDatabase =
            options.useDatabase !== undefined
                ? options.useDatabase
                : require('./database').isDBConnected();
        if (usingDatabase) {
            Model = Model || require('./models').ActivityArchive;
            await Model.init();
            const oldest = await Model.findOne({}, { at: 1 })
                .sort({ at: 1 })
                .lean();
            if (oldest) firstAt = new Date(oldest.at).toISOString();
        } else if (fs.existsSync(file)) {
            const readline = require('node:readline');
            for await (const line of readline.createInterface({
                input: fs.createReadStream(file),
                crlfDelay: Infinity,
            })) {
                if (!line.trim()) continue;
                let stored;
                try {
                    stored = JSON.parse(line);
                } catch (error) {
                    throw new Error(
                        'Activity archive contains an unreadable record',
                    );
                }
                const entry = project(stored.entry, options.resolvePlayer);
                if (entry) {
                    memory.set(stored.key || keyOf(entry), entry);
                    if (!firstAt || entry.timestamp < firstAt)
                        firstAt = entry.timestamp;
                }
            }
        }
        ready = true;
        await flush();
        return {
            source: usingDatabase ? 'mongo-archive' : 'file-archive',
            firstAt,
        };
    }
    async function importLogs(store) {
        importing = true;
        const probe = async () => {
            const source =
                typeof store.query === 'function'
                    ? (await store.query({ limit: 1 })).source
                    : null;
            if (source === 'memory-fallback')
                throw new Error('Full activity source unavailable');
            return source;
        };
        const before = await probe();
        let count = 0;
        for await (const entry of store.exportEntries(
            { requirePersistentSource: true },
            Number.MAX_SAFE_INTEGER,
        )) {
            add(entry);
            if (++count % 500 === 0) await flush();
        }
        const after = await probe();
        if (before && after && before !== after)
            throw new Error('Activity source changed during import');
        await flush();
        cache.clear();
        importing = false;
        return count;
    }
    async function* stream(raw) {
        const range = period(raw, now(), firstAt);
        if (usingDatabase) {
            const cursor = Model.find(
                {
                    at: {
                        $gte: new Date(range.from),
                        $lte: new Date(range.to),
                    },
                },
                { entry: 1, _id: 0 },
            )
                .sort({ at: -1, 'entry.id': -1 })
                .lean()
                .cursor({ batchSize: 500 });
            try {
                for await (const record of cursor) yield record.entry;
            } finally {
                await cursor.close();
            }
        } else {
            const values = [...memory.values()]
                .filter(
                    (e) =>
                        Date.parse(e.timestamp) >= range.from &&
                        Date.parse(e.timestamp) <= range.to,
                )
                .sort(
                    (a, b) =>
                        b.timestamp.localeCompare(a.timestamp) ||
                        b.id.localeCompare(a.id),
                );
            for (const entry of values) yield entry;
        }
    }
    async function getReport(raw = {}, context = {}) {
        if (!ready || importing)
            throw new Error('Activity archive is not ready');
        await flush();
        if (unavailable) throw new Error(unavailable);
        const range = period(raw, now(), firstAt),
            key = JSON.stringify(range.query),
            cached = cache.get(key);
        // Names/photos are public profile fields only; search always uses a fresh name map.
        let result;
        if (
            !range.query.search &&
            raw.fresh !== '1' &&
            cached &&
            now() - cached.at < 15000
        )
            result = cached.result;
        else {
            if (!inflight.has(key))
                inflight.set(
                    key,
                    buildReport(stream(raw), raw, {
                        now: now(),
                        firstAt,
                        source: usingDatabase
                            ? 'mongo-archive'
                            : 'file-archive',
                        players: context.players || [],
                    })
                        .then((value) => {
                            cache.set(key, { at: now(), result: value });
                            while (cache.size > 16)
                                cache.delete(cache.keys().next().value);
                            return value;
                        })
                        .finally(() => inflight.delete(key)),
                );
            result = await inflight.get(key);
        }
        // Return independent DTOs and apply current profile preferences on every read.
        const copy = JSON.parse(JSON.stringify(result)),
            profiles = new Map(
                (context.players || []).map((p) => [p.playerId, p]),
            );
        const { profileFields } = require('./activityIdentity');
        function hydrate(person) {
            const profile = profiles.get(person.playerId);
            const { avatar, avatarFrame, color, avatarImage, ...rest } = person;
            return profile
                ? {
                      ...rest,
                      playerName: profile.playerName || person.playerName,
                      ...profileFields(profile),
                  }
                : rest;
        }
        copy.people = copy.people.map(hydrate);
        copy.activity.rows.forEach((row) => {
            row.players = row.players.map(hydrate);
        });
        return copy;
    }
    function flushSyncOnExit() {
        if (usingDatabase || !ready || !pending.size) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(
            file,
            [...pending]
                .map(([key, entry]) => JSON.stringify({ key, entry }))
                .join('\n') + '\n',
        );
        pending.clear();
    }
    return {
        add,
        init,
        flush,
        flushSyncOnExit,
        importLogs,
        getReport,
        isReady: () => ready && !unavailable,
        source: () => (usingDatabase ? 'mongo-archive' : 'file-archive'),
    };
}
module.exports = { createActivityArchive };
