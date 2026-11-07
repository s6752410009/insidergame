'use strict';
const { recordedNames, profileFields } = require('./activityIdentity');
const DAY = 86400000,
    BKK = 7 * 3600000;
const kinds = new Set([
    'all',
    'start',
    'end',
    'join',
    'leave',
    'admin',
    'error',
    'detail',
    'abort',
    'system',
    'chat',
]);
const string = (v, max = 160) => (typeof v === 'string' ? v.slice(0, max) : '');
const isHuman = (id) => !/^bot_/i.test(String(id));
const day = (ms) => new Date(ms + BKK).toISOString().slice(0, 10);
const month = (ms) => day(ms).slice(0, 7);
function period(raw = {}, now = Date.now(), firstAt = null) {
    const today = Math.floor((now + BKK) / DAY) * DAY - BKK;
    let from,
        to = now,
        monthly = false;
    const query = {
        days: [1, 3, 7].includes(Number(raw.days)) ? Number(raw.days) : 7,
        mode: string(raw.mode, 80) || 'all',
        playerId: string(raw.playerId, 80),
        kind: kinds.has(raw.kind) ? raw.kind : 'all',
        search: string(raw.search, 100).trim(),
        page: Math.min(100000, Math.max(1, Math.floor(Number(raw.page) || 1))),
    };
    if (raw.period === 'all') {
        query.period = 'all';
        from = firstAt ? Date.parse(firstAt) : today;
        monthly = true;
    } else if (raw.period === 'month') {
        const selected =
            typeof raw.month === 'string' &&
            /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(raw.month)
                ? raw.month
                : month(now);
        query.period = 'month';
        query.month = selected;
        const [y, m] = selected.split('-').map(Number);
        from = Date.UTC(y, m - 1, 1) - BKK;
        to = Math.min(now, Date.UTC(y, m, 1) - BKK - 1);
    } else from = today - (query.days - 1) * DAY;
    return { query, from, to, monthly, today };
}
function eventKind(log) {
    const e = log.meta?.event;
    if (e === 'game_start') return 'start';
    if (e === 'game_end') return 'end';
    if (e === 'game_abort' || e === 'table_end') return 'abort';
    if (log.category === 'error' || log.type === 'error') return 'error';
    return ['join', 'leave', 'admin', 'system', 'chat'].includes(log.category)
        ? log.category
        : 'detail';
}
function actors(log, players) {
    const meta = log.meta || {},
        ids = new Set(
            [
                meta.playerId,
                meta.actorId,
                ...(Array.isArray(meta.participantIds)
                    ? meta.participantIds.slice(0, 20)
                    : []),
            ].filter(
                (v) => typeof v === 'string' && v.length <= 80 && v.trim(),
            ),
        );
    return [...ids].map((playerId) => ({
        playerId,
        playerName:
            players.get(playerId)?.playerName ||
            (playerId === meta.playerId || playerId === meta.actorId
                ? string(meta.playerName || meta.actorName)
                : '') ||
            string(meta.participantNames?.[playerId]) ||
            playerId,
        ...profileFields(players.get(playerId)),
    }));
}
function publicRow(log, players) {
    const names = recordedNames(log),
        meta = log.meta || {};
    const people = actors(log, players);
    const bot =
        log.bot === true ||
        meta.bot === true ||
        meta.isBot === true ||
        Number(meta.bots) > 0 ||
        people.some((p) => !isHuman(p.playerId));
    return {
        id: string(log.id),
        timestamp: log.timestamp,
        kind: eventKind(log),
        mode: log.gameMode || '',
        modeLabel: log.gameModeLabel || log.gameMode || '',
        roomId: log.roomId || null,
        roomName: log.roomName || null,
        message: string(log.message, 1000),
        players: people,
        bot,
        debug:
            meta.debugUsed === true ||
            meta.debug === true ||
            /\bDEBUG\b/i.test(log.message || ''),
        ...(names.length ? { recordedNames: names } : {}),
    };
}
async function buildReport(entries, raw, context) {
    const now = context.now || Date.now(),
        window = period(raw, now, context.firstAt),
        q = window.query;
    const players = new Map(
        (context.players || []).map((p) => [p.playerId, p]),
    );
    const summary = {
        starts: 0,
        ends: 0,
        uniqueHumans: 0,
        joins: 0,
        leaves: 0,
        errors: 0,
        botStarts: 0,
        testStarts: 0,
        soloEnds: 0,
    };
    const unique = new Set(),
        hourly = Array.from({ length: 24 }, () => new Set()),
        games = new Map(),
        people = new Map(),
        modes = new Map(),
        buckets = new Map(),
        debugGames = new Set();
    const rows = [],
        tail = new Array(50),
        offset = (q.page - 1) * 50;
    let total = 0,
        oldest = null,
        seen = 0;
    for await (const log of entries) {
        if (++seen % 1000 === 0)
            await new Promise((resolve) => setImmediate(resolve));
        const at = Date.parse(log.timestamp);
        if (!Number.isFinite(at) || at < window.from || at > window.to)
            continue;
        const row = publicRow(log, players),
            meta = log.meta || {};
        oldest = row.timestamp;
        const gameId = meta.gameId
            ? JSON.stringify([row.roomId, row.mode, meta.gameId])
            : null;
        if (gameId && row.debug) debugGames.add(gameId);
        if (gameId && debugGames.has(gameId)) row.debug = true;
        if (row.mode) modes.set(row.mode, row.modeLabel);
        if (q.mode !== 'all' && row.mode !== q.mode) continue;
        if (q.playerId && !row.players.some((p) => p.playerId === q.playerId))
            continue;
        const humanActors = row.players.filter((p) => isHuman(p.playerId));
        const botOnly =
            !humanActors.length &&
            !(Number(meta.humans) > 0) &&
            (row.bot || meta.humans === 0);
        const normal = !row.debug && !botOnly;
        const scoped = humanActors.filter(
            (p) => !q.playerId || p.playerId === q.playerId,
        );
        const start = normal && row.kind === 'start',
            end = normal && row.kind === 'end';
        if (row.debug && row.kind === 'start') summary.testStarts++;
        if (normal && row.kind === 'join') summary.joins++;
        if (normal && row.kind === 'leave') summary.leaves++;
        if (row.kind === 'error') summary.errors++;
        if (normal)
            for (const p of scoped) {
                unique.add(p.playerId);
                hourly[Math.floor((at + BKK) / 3600000) % 24].add(p.playerId);
                let person = people.get(p.playerId);
                if (!person) {
                    person = {
                        ...p,
                        events: 0,
                        lastAt: row.timestamp,
                        starts: 0,
                        ends: 0,
                    };
                    people.set(p.playerId, person);
                }
                person.events++;
                if (start) person.starts++;
                if (end) person.ends++;
            }
        if (start || end) {
            const key = window.monthly ? month(at) : day(at);
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { starts: 0, ends: 0 };
                buckets.set(key, bucket);
            }
            if (start) {
                summary.starts++;
                bucket.starts++;
                if (row.bot) summary.botStarts++;
            }
            if (end) {
                summary.ends++;
                bucket.ends++;
                if (row.mode.startsWith('solo_')) summary.soloEnds++;
            }
            if (row.mode) {
                let g = games.get(row.mode);
                if (!g) {
                    g = {
                        mode: row.mode,
                        label: row.modeLabel,
                        starts: 0,
                        ends: 0,
                        botStarts: 0,
                        humans: new Set(),
                    };
                    games.set(row.mode, g);
                }
                if (start) {
                    g.starts++;
                    if (row.bot) g.botStarts++;
                }
                if (end) g.ends++;
                scoped.forEach((p) => g.humans.add(p.playerId));
            }
        }
        if (q.kind !== 'all' && row.kind !== q.kind) continue;
        if (
            q.search &&
            ![
                row.message,
                row.mode,
                row.modeLabel,
                row.roomId,
                row.roomName,
                ...row.players.flatMap((p) => [p.playerId, p.playerName]),
                ...(row.recordedNames || []),
            ]
                .join(' ')
                .toLowerCase()
                .includes(q.search.toLowerCase())
        )
            continue;
        if (total >= offset && rows.length < 50) rows.push(row);
        tail[total % 50] = row;
        total++;
    }
    const daily = [];
    if (window.monthly) {
        let cursor = new Date(window.from + BKK);
        cursor = new Date(
            Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1),
        );
        let count = 0;
        while (cursor.getTime() - BKK <= now && count++ < 2400) {
            const key = cursor.toISOString().slice(0, 7);
            daily.push({
                date: key + '-01',
                ...(buckets.get(key) || { starts: 0, ends: 0 }),
                label: new Date(key + '-01T00:00:00+07:00').toLocaleDateString(
                    'th-TH',
                    {
                        timeZone: 'Asia/Bangkok',
                        month: 'short',
                        year: '2-digit',
                    },
                ),
            });
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
    } else
        for (let d = window.from; d <= window.to; d += DAY) {
            const key = day(d);
            daily.push({
                date: key,
                ...(buckets.get(key) || { starts: 0, ends: 0 }),
            });
        }
    const pages = Math.max(1, Math.ceil(total / 50));
    if (q.page > pages) {
        rows.length = 0;
        const lastSize = total % 50 || Math.min(50, total);
        for (let i = total - lastSize; i < total; i++) rows.push(tail[i % 50]);
        q.page = pages;
    }
    summary.uniqueHumans = unique.size;
    return {
        generatedAt: new Date(now).toISOString(),
        query: q,
        coverage: {
            retentionDays: null,
            from: new Date(window.from).toISOString(),
            to: new Date(Math.max(window.from, window.to)).toISOString(),
            oldestEventAt: oldest,
            truncated: false,
            source: context.source,
            recordedSince: context.firstAt || null,
            persistent: true,
        },
        summary,
        games: [...games.values()]
            .map((g) => ({
                mode: g.mode,
                label: g.label,
                starts: g.starts,
                ends: g.ends,
                uniqueHumans: g.humans.size,
                botStarts: g.botStarts,
            }))
            .sort(
                (a, b) =>
                    b.starts - a.starts ||
                    b.ends - a.ends ||
                    a.mode.localeCompare(b.mode),
            ),
        daily,
        hourly: hourly.map((set, hour) => ({ hour, uniqueHumans: set.size })),
        people: [...people.values()]
            .sort(
                (a, b) =>
                    b.events - a.events ||
                    b.lastAt.localeCompare(a.lastAt) ||
                    a.playerId.localeCompare(b.playerId),
            )
            .slice(0, 20),
        activity: { rows, page: q.page, pages, total, pageSize: 50 },
        modes: [...modes]
            .map(([mode, label]) => ({ mode, label }))
            .sort((a, b) => a.mode.localeCompare(b.mode)),
    };
}
module.exports = { buildReport, period };
