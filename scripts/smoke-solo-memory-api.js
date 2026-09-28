/**
 * เทส API ของเกมจับคู่ความจำ: /api/solo/memory/result, /stats, /leaderboard
 * เปิดเซิร์ฟเวอร์จริงบนโฟลเดอร์ data ชั่วคราว
 * รัน: npm run smoke:solo:memory:api
 */
require('./isolateTestData');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const core = require('../public/js/solo/memory-core');

let checks = 0;
function assert(cond, message) { if (!cond) throw new Error('FAIL: ' + message); checks += 1; }

function freePort() {
    return new Promise(resolve => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    });
}
function boot(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), WALLETS_FILE: path.join(process.env.GAME_DATA_DIR, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('boot timeout\n' + logs)); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs)); });
    });
}

function client(base) {
    const jar = new Map();
    async function req(method, url, body) {
        const headers = { Accept: 'application/json' };
        if (jar.size) headers.Cookie = Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
        (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach(line => {
            const [pair] = line.split(';');
            const i = pair.indexOf('=');
            jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        });
        let json = null;
        try { json = await res.clone().json(); } catch (e) { json = null; }
        return { status: res.status, json };
    }
    return { req, jar };
}

function perfectLog(level, seed, deck) {
    const cards = core.makeBoard(level, seed, deck);
    const seen = new Map();
    const log = [];
    cards.forEach((k, i) => { if (seen.has(k)) log.push([seen.get(k), i]); else seen.set(k, i); });
    return log;
}
function withMisses(level, seed, deck, n) {
    const cards = core.makeBoard(level, seed, deck);
    const b = cards.findIndex((k, i) => i > 0 && k !== cards[0]);
    return Array.from({ length: n }, () => [0, b]).concat(perfectLog(level, seed, deck));
}
function payload(level, seed, deck, extra = {}) {
    const log = extra.log || perfectLog(level, seed, deck);
    return { runId: extra.runId || ('r-' + randomUUID().slice(0, 12)), level, seed, deck, timeMs: 30000, moves: log.length, log, ...extra };
}

(async () => {
    const port = Number(process.env.PORT_OVERRIDE) || await freePort();
    const server = await boot(port);
    const base = `http://127.0.0.1:${port}`;
    try {
        // ไม่มี identity → 403
        const anon = client(base);
        const r0 = await anon.req('POST', '/api/solo/memory/result', payload('easy', 'anon1', 'wolf'));
        assert(r0.status === 403, 'no identity → 403');
        const lb0 = await anon.req('GET', '/api/solo/memory/leaderboard');
        assert(lb0.status === 200 && Array.isArray(lb0.json.entries) && lb0.json.entries.length === 0, 'empty leaderboard');

        const a = client(base);
        await a.req('GET', `/?playerId=${randomUUID()}`);
        assert(a.jar.size > 0, 'got identity cookie');
        const st0 = await a.req('GET', '/api/solo/memory/stats');
        assert(st0.status === 200 && st0.json.data === null, 'fresh stats null');

        // ผลปกติ
        const p1 = payload('medium', 'seed-a1', 'knight', { timeMs: 41234 });
        const r1 = await a.req('POST', '/api/solo/memory/result', p1);
        assert(r1.status === 200 && r1.json.success, 'valid result accepted');
        assert(r1.json.data.levels.medium.bestTimeMs === 41234 && r1.json.data.levels.medium.bestMoves === 8, 'bests stored');
        assert(typeof r1.json.summary === 'string', 'summary returned');
        const r1b = await a.req('POST', '/api/solo/memory/result', p1);
        assert(r1b.status === 200 && r1b.json.data.plays === 1, 'resend same runId is idempotent');

        // ข้อมูลไม่สมเหตุสมผล
        const bad = [
            ['too fast', payload('easy', 'b1', 'wolf', { timeMs: 1000 })],
            ['moves mismatch', payload('easy', 'b2', 'wolf', { moves: 3 })],
            ['forged log', payload('easy', 'b3', 'wolf', { log: perfectLog('easy', 'other', 'wolf') })],
            ['partial log', payload('easy', 'b4', 'wolf', { log: perfectLog('easy', 'b4', 'wolf').slice(0, 2) })],
            ['bad level', { ...payload('easy', 'b5', 'wolf'), level: 'insane' }],
            ['bad deck', { ...payload('easy', 'b6', 'wolf'), deck: '../x' }],
            ['bad seed', { ...payload('easy', 'b7', 'wolf'), seed: 'DROP TABLE' }],
            ['reused seed', payload('medium', 'seed-a1', 'knight')],
            ['old daily', payload('daily', 'daily-2020-01-01', core.dailyDeck('2020-01-01'))],
            ['empty', {}]
        ];
        for (const [name, body] of bad) {
            const r = await a.req('POST', '/api/solo/memory/result', body);
            assert(r.status === 400 && r.json && !r.json.success && typeof r.json.error === 'string', `${name} rejected (${r.status} ${r.json && r.json.error})`);
        }
        const st1 = await a.req('GET', '/api/solo/memory/stats');
        assert(st1.json.data.plays === 1, 'rejected payloads did not change stats');

        // กระดานประจำวัน: สองคน — คนเร็วกว่าอยู่อันดับ 1
        const today = core.bangkokDate(new Date());
        const dSeed = core.dailySeed(today);
        const dDeck = core.dailyDeck(today);
        const rd = await a.req('POST', '/api/solo/memory/result', payload('daily', dSeed, dDeck, { timeMs: 52000, log: withMisses('daily', dSeed, dDeck, 4) }));
        assert(rd.status === 200 && rd.json.data.daily.streak === 1, 'daily accepted, streak 1');
        const rd2 = await a.req('POST', '/api/solo/memory/result', payload('daily', dSeed, dDeck, { timeMs: 30000 }));
        assert(rd2.status === 400 && /ไปแล้ว/.test(rd2.json.error), 'second daily attempt rejected');

        const b = client(base);
        await b.req('GET', `/?playerId=${randomUUID()}`);
        const rb = await b.req('POST', '/api/solo/memory/result', payload('daily', dSeed, dDeck, { timeMs: 38000 }));
        assert(rb.status === 200, 'player b daily accepted');
        const rbWrongDeck = await b.req('POST', '/api/solo/memory/result', payload('daily', dSeed, core.DECK_IDS.find(d => d !== dDeck)));
        assert(rbWrongDeck.status === 400, 'daily with wrong deck rejected');

        // คนที่เล่นแต่ฝึกซ้อม ไม่ติดอันดับ
        const c = client(base);
        await c.req('GET', `/?playerId=${randomUUID()}`);
        await c.req('POST', '/api/solo/memory/result', payload('easy', 'c1', 'city', { timeMs: 9000 }));

        const lb = await a.req('GET', '/api/solo/memory/leaderboard');
        assert(lb.json.entries.length === 2, 'leaderboard = only today\'s daily players');
        assert(lb.json.entries[0].score === 38000 && lb.json.entries[0].rank === 1, 'fastest first (asc)');
        assert(lb.json.entries[1].score === 52000 && /14 ครั้ง/.test(lb.json.entries[1].label), 'label has moves');

        // rate limit: 30 ครั้ง/นาที ต่อคน
        let limited = false;
        for (let i = 0; i < 35; i++) {
            const r = await c.req('POST', '/api/solo/memory/result', payload('easy', 'rl' + i, 'city'));
            if (r.status === 429) { limited = true; break; }
        }
        assert(limited, 'rate limit kicks in');

        // หน้าเกม render ได้ (มี identity) และ hub มีการ์ด
        const page = await fetch(`${base}/solo/memory`, { headers: { Cookie: Array.from(a.jar, ([k, v]) => `${k}=${v}`).join('; ') } });
        const html = await page.text();
        assert(page.status === 200 && html.includes('mmGrid') && html.includes('MEMORY_BOOT'), 'game page renders');
        const hub = await fetch(`${base}/solo`, { headers: { Cookie: Array.from(a.jar, ([k, v]) => `${k}=${v}`).join('; ') } });
        const hubHtml = await hub.text();
        assert(hubHtml.includes('/solo/memory') && hubHtml.includes('รายวันติดกัน 1 วัน'), 'hub card with summary');
        const cover = await fetch(`${base}/assets/games/solo/memory/cover.svg`);
        assert(cover.status === 200, 'cover served');

        console.log(`smoke-solo-memory-api: ${checks} checks passed`);
    } finally {
        server.kill();
    }
})().catch(error => { console.error(error); process.exit(1); });
