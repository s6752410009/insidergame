'use strict';

// The retained-log adapter remains available for tools and legacy callers.
// Production delegates to the independent durable activity archive below.
const { recordedNames, profileFields } = require('./activityIdentity');
const DAY = 86400000;
const BKK = 7 * 3600000;
const CAP = 100000;
const PAGE_SIZE = 50;
const KINDS = new Set(['all', 'start', 'end', 'join', 'leave', 'admin', 'error', 'detail', 'abort', 'system', 'chat']);
const pause = () => new Promise(resolve => setImmediate(resolve));
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const id = value => typeof value === 'string' && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : '';
const meaningful = value => {
    const valueId = id(value);
    return valueId && !/^(?:null|undefined|unknown|none|0)$/i.test(valueId) ? valueId : '';
};
const human = value => !/^bot_/i.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const dateKey = ms => new Date(ms + BKK).toISOString().slice(0, 10);
const gameKey = (row, gameId) => JSON.stringify([row.roomId, row.mode, gameId]);

function normalizeQuery(raw, retentionDays) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const requestedDays = [1, 3, 7].find(n => raw.days === n || raw.days === String(n)) || 7;
    const requestedPage = typeof raw.page === 'string' && /^\d{1,9}$/.test(raw.page)
        ? Number(raw.page) : typeof raw.page === 'number' ? raw.page : 1;
    return {
        days: Math.min(requestedDays, retentionDays),
        mode: id(raw.mode) || 'all',
        playerId: id(raw.playerId),
        kind: typeof raw.kind === 'string' && KINDS.has(raw.kind) ? raw.kind : 'all',
        search: text(raw.search, 100).trim(),
        page: Number.isFinite(requestedPage) ? Math.max(1, Math.min(100000, Math.floor(requestedPage))) : 1
    };
}

function kindOf(log, meta) {
    if (meta.event === 'game_start') return 'start';
    if (meta.event === 'game_end') return 'end';
    if (meta.event === 'game_abort' || meta.event === 'table_end') return 'abort';
    if (log.category === 'error' || log.bucket === 'error' || log.type === 'error') return 'error';
    if (['join', 'leave', 'admin', 'system', 'chat'].includes(log.category)) return log.category;
    return 'detail';
}

function actorsOf(meta, names, profiles) {
    const ids = new Set();
    const playerId = id(meta.playerId);
    const actorId = id(meta.actorId);
    if (playerId) ids.add(playerId);
    if (actorId) ids.add(actorId);
    if (Array.isArray(meta.participantIds)) {
        for (const value of meta.participantIds.slice(0, 20)) {
            const participant = id(value);
            if (participant) ids.add(participant);
        }
    }
    // meta.players contains legacy display names, never trustworthy account IDs.
    return [...ids].map(player => ({
        playerId: player,
        playerName: names.get(player)
            || ((player === playerId || (!playerId && player === actorId)) ? text(meta.playerName, 160) : '')
            || player,
        ...profileFields(profiles.get(player))
    }));
}

/**
 * Deterministic core. Supply context.now explicitly (epoch ms, ISO string or Date).
 * The generator lets the async facade yield during both normalization and counting;
 * buildAnalytics drains the same core synchronously for pure callers/tests.
 */
function* buildSteps(entries, rawQuery, context) {
    if (context.source === 'memory-fallback') throw new Error('Analytics source is memory-fallback');
    const now = context.now instanceof Date ? context.now.getTime()
        : typeof context.now === 'number' ? context.now : Date.parse(context.now);
    if (!Number.isFinite(now)) throw new TypeError('Analytics requires a valid context.now');
    const retentionDays = Number.isFinite(context.retentionDays) && context.retentionDays > 0 ? context.retentionDays : 7;
    const query = normalizeQuery(rawQuery, retentionDays);
    const today = Math.floor((now + BKK) / DAY) * DAY - BKK;
    const from = Math.max(today - (Math.ceil(query.days) - 1) * DAY, now - retentionDays * DAY);
    const names = new Map();
    const profiles = new Map();
    for (const player of Array.isArray(context.players) ? context.players : []) {
        if (!player || typeof player !== 'object') continue;
        const playerId = id(player.playerId);
        const name = text(player.playerName, 160);
        if (playerId && name) names.set(playerId, name);
        if (playerId) profiles.set(playerId, player);
    }

    const rows = [];
    const debugGames = new Set();
    let oldest = Infinity;
    let count = 0;
    const input = Array.isArray(entries) ? entries : [];
    for (const log of input.slice(0, CAP)) {
        if (++count % 1000 === 0) yield;
        if (!log || typeof log !== 'object') continue;
        const at = typeof log.timestamp === 'number' ? log.timestamp
            : log.timestamp instanceof Date ? log.timestamp.getTime()
                : typeof log.timestamp === 'string' ? Date.parse(log.timestamp) : NaN;
        if (!Number.isFinite(at) || at > now || at < now - retentionDays * DAY) continue;
        oldest = Math.min(oldest, at);
        if (at < from) continue;
        const meta = log.meta && typeof log.meta === 'object' && !Array.isArray(log.meta) ? log.meta : {};
        const mode = id(log.gameMode);
        const players = actorsOf(meta, names, profiles);
        const humanIds = players.map(p => p.playerId).filter(human);
        const bot = log.bot === true || meta.bot === true || meta.isBot === true
            || (typeof meta.bots === 'number' && meta.bots > 0) || players.some(p => !human(p.playerId));
        const botOnly = humanIds.length === 0 && !(typeof meta.humans === 'number' && meta.humans > 0)
            && (bot || meta.humans === 0);
        const row = {
            id: text(log.id, 160), timestamp: new Date(at).toISOString(),
            kind: kindOf(log, meta), mode, modeLabel: text(log.gameModeLabel, 160) || mode,
            roomId: text(log.roomId, 160) || null, roomName: text(log.roomName, 160) || null,
            message: text(log.message, 1000), players, bot,
            recordedNames:recordedNames(log),
            debug: log.debug === true || meta.debug === true || meta.debugUsed === true || /\bDEBUG\b/i.test(text(log.message, 1000)),
            at, humanIds, botOnly, resultId: meaningful(meta.resultId), gameId: meaningful(meta.gameId)
        };
        if (row.debug && row.gameId) debugGames.add(gameKey(row, row.gameId));
        rows.push(row);
    }
    rows.sort((a, b) => b.at - a.at || compare(b.id, a.id));
    const eventIds = new Set();
    const results = new Set();
    const modes = new Map();
    const selected = [];
    for (const row of rows) {
        if (++count % 1000 === 0) yield;
        if (row.id && eventIds.has(row.id)) continue;
        if (row.id) eventIds.add(row.id);
        // A gameId identifies a session/table, not a result: poker has many hands.
        if (row.kind === 'end' && row.resultId) {
            const result = gameKey(row, row.resultId);
            if (results.has(result)) continue;
            results.add(result);
        }
        if (row.gameId && debugGames.has(gameKey(row, row.gameId))) row.debug = true;
        if (row.mode && (!modes.has(row.mode) || modes.get(row.mode) === row.mode)) modes.set(row.mode, row.modeLabel);
        if (query.mode !== 'all' && row.mode !== query.mode) continue;
        if (query.playerId && !row.players.some(p => p.playerId === query.playerId)) continue;
        selected.push(row);
    }

    const summary = { starts: 0, ends: 0, uniqueHumans: 0, joins: 0, leaves: 0, errors: 0, botStarts: 0, testStarts: 0, soloEnds: 0 };
    const unique = new Set();
    const hours = Array.from({ length: 24 }, () => new Set());
    const days = new Map();
    for (let ms = today - (Math.ceil(query.days) - 1) * DAY; ms <= today; ms += DAY) {
        days.set(dateKey(ms), { date: dateKey(ms), starts: 0, ends: 0 });
    }
    const games = new Map();
    const people = new Map();
    const activity = [];
    const search = query.search.toLowerCase();
    for (const row of selected) {
        if (++count % 1000 === 0) yield;
        const normal = !row.debug && !row.botOnly;
        const scopedPlayers = row.players.filter(p => !query.playerId || p.playerId === query.playerId);
        const start = normal && row.kind === 'start';
        const end = normal && row.kind === 'end';
        if (row.kind === 'start' && row.debug) summary.testStarts++;
        if (normal && row.kind === 'join') summary.joins++;
        if (normal && row.kind === 'leave') summary.leaves++;
        if (row.kind === 'error') summary.errors++;
        if (normal) {
            const hour = Math.floor((row.at + BKK) / 3600000) % 24;
            for (const player of scopedPlayers) {
                if (!human(player.playerId)) continue;
                unique.add(player.playerId);
                hours[hour].add(player.playerId);
                let person = people.get(player.playerId);
                if (!person) {
                    person = { playerId: player.playerId, playerName: player.playerName, ...profileFields(profiles.get(player.playerId)), events: 0, lastAt: row.timestamp, starts: 0, ends: 0 };
                    people.set(player.playerId, person);
                }
                person.events++;
                if (start) person.starts++;
                if (end) person.ends++;
            }
        }
        if (start || end) {
            const daily = days.get(dateKey(row.at));
            if (start) { summary.starts++; daily.starts++; }
            if (end) { summary.ends++; daily.ends++; }
            if (end && row.mode.startsWith('solo_')) summary.soloEnds++;
            if (start && row.bot) summary.botStarts++;
            if (row.mode) {
                let game = games.get(row.mode);
                if (!game) {
                    game = { mode: row.mode, label: modes.get(row.mode) || row.mode, starts: 0, ends: 0, botStarts: 0, humans: new Set() };
                    games.set(row.mode, game);
                }
                if (start) { game.starts++; if (row.bot) game.botStarts++; }
                if (end) game.ends++;
                scopedPlayers.filter(p => human(p.playerId)).forEach(p => game.humans.add(p.playerId));
            }
        }
        if (query.kind !== 'all' && row.kind !== query.kind) continue;
        if (search && ![row.id, row.message, row.mode, row.modeLabel, row.roomId, row.roomName,
            ...row.players.flatMap(p => [p.playerId, p.playerName]), ...row.recordedNames].join(' ').toLowerCase().includes(search)) continue;
        // Explicit allowlist: never return log metadata or current private player fields.
        activity.push({
            id: row.id, timestamp: row.timestamp, kind: row.kind, mode: row.mode,
            modeLabel: row.modeLabel, roomId: row.roomId, roomName: row.roomName,
            message: row.message, players: row.players, bot: row.bot, debug: row.debug,
            ...(row.recordedNames.length ? { recordedNames:row.recordedNames } : {})
        });
    }
    summary.uniqueHumans = unique.size;
    const pages = Math.max(1, Math.ceil(activity.length / PAGE_SIZE));
    const page = Math.min(query.page, pages);
    query.page = page;
    return {
        generatedAt: new Date(now).toISOString(),
        query,
        coverage: {
            retentionDays, from: new Date(from).toISOString(), to: new Date(now).toISOString(),
            oldestEventAt: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
            truncated: context.truncated === true || input.length > CAP,
            source: text(context.source, 40) || 'unknown'
        },
        summary,
        games: [...games.values()].map(g => ({
            mode: g.mode, label: g.label, starts: g.starts, ends: g.ends, uniqueHumans: g.humans.size, botStarts: g.botStarts
        })).sort((a, b) => b.starts - a.starts || b.ends - a.ends || compare(a.mode, b.mode)),
        daily: [...days.values()],
        hourly: hours.map((values, hour) => ({ hour, uniqueHumans: values.size })),
        people: [...people.values()].sort((a, b) => b.events - a.events || compare(b.lastAt, a.lastAt) || compare(a.playerId, b.playerId)).slice(0, 20),
        activity: { rows: activity.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pages, total: activity.length, pageSize: PAGE_SIZE },
        modes: [...modes].map(([mode, label]) => ({ mode, label })).sort((a, b) => compare(a.mode, b.mode))
    };
}

function buildAnalytics(entries, query = {}, context = {}) {
    const work = buildSteps(entries, query, context);
    let step;
    do { step = work.next(); } while (!step.done);
    return step.value;
}

function createAdminAnalytics(logStore, options = {}) {
    if (typeof logStore?.getReport === 'function') return {get:(query,context)=>logStore.getReport(query,context)};
    if (!logStore || typeof logStore.exportEntries !== 'function') throw new TypeError('Analytics requires a log store');
    const now = typeof options.now === 'function' ? options.now : Date.now;
    let cached = null;
    let pending = null;

    async function probe() {
        const result = typeof logStore.query === 'function' ? await logStore.query({ limit: 1 }) : null;
        const source = result && result.source || logStore.source;
        if (source === 'memory-fallback') throw new Error('Analytics source is memory-fallback; full history is unavailable');
        return typeof source === 'string' ? source : null;
    }

    async function scan() {
        const firstSource = await probe();
        const exported = await logStore.exportEntries({}, CAP + 1);
        if (exported && exported.source === 'memory-fallback') throw new Error('Analytics source is memory-fallback');
        const entries = [];
        let truncated = false;
        let seen = 0;
        for await (const entry of exported) {
            if (entry && entry.source === 'memory-fallback') throw new Error('Analytics source is memory-fallback');
            if (++seen > CAP) { truncated = true; break; }
            entries.push(entry);
            if (seen % 1000 === 0) await pause();
        }
        const finalSource = await probe();
        if (firstSource && finalSource && firstSource !== finalSource) throw new Error('Analytics source changed during scan');
        const retention = typeof logStore.retention === 'function' ? await logStore.retention() : null;
        const stats = typeof logStore.stats === 'function' ? await logStore.stats() : null;
        const configured = Number(retention && retention.days || stats && stats.retentionDays || options.retentionDays || 7);
        return {
            entries, truncated, at: now(),
            retentionDays: Number.isFinite(configured) && configured > 0 ? configured : 7,
            source: finalSource || firstSource || (typeof logStore.isUsingDatabase === 'function' ? (logStore.isUsingDatabase() ? 'mongo' : 'file') : 'unknown')
        };
    }

    async function snapshot() {
        if (cached && now() >= cached.at && now() - cached.at < 15000) return cached;
        if (!pending) {
            pending = scan().then(value => { cached = value; return value; }).finally(() => { pending = null; });
        }
        return pending;
    }

    return {
        async get(query = {}, context = {}) {
            const value = await snapshot();
            // Use fresh, explicitly projected player context on every request, including cache hits.
            const work = buildSteps(value.entries, query, {
                now: now(), players: context.players, retentionDays: value.retentionDays,
                source: value.source, truncated: value.truncated
            });
            let step;
            do { step = work.next(); if (!step.done) await pause(); } while (!step.done);
            return step.value;
        }
    };
}

module.exports = { createAdminAnalytics, buildAnalytics };
