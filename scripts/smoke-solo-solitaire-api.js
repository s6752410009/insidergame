/**
 * เทส API โซลิแทร์กับเซิร์ฟเวอร์จริง: /api/solo/solitaire/result|stats|leaderboard + หน้า /solo
 *
 * รัน: node scripts/smoke-solo-solitaire-api.js   (เปิดเซิร์ฟเวอร์เองบน PORT หรือ 8486 ด้วยโฟลเดอร์ data ชั่วคราว)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const E = require('../public/js/solo/solitaire-engine');
const SEEDS = require('../public/js/solo/solitaire-seeds');
const { solve } = require('./solitaire-solver');

let passed = 0;
function check(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); passed++; }

async function bootServer() {
    const port = Number(process.env.PORT) || 8486;
    const dataDir = process.env.GAME_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'solitaire-api-'));
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port), GAME_DATA_DIR: dataDir, WALLETS_FILE: path.join(dataDir, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
    return { base: `http://localhost:${port}`, stop() { child.kill('SIGTERM'); } };
}

function jar() {
    const cookies = new Map();
    return {
        header() { return Array.from(cookies, ([k, v]) => `${k}=${v}`).join('; '); },
        store(res) {
            const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
            list.forEach(line => { const [pair] = line.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1)); });
        }
    };
}

async function identity(base) {
    const j = jar();
    const playerId = randomUUID();
    let url = `${base}/?playerId=${playerId}`;
    for (let hop = 0; hop < 6; hop++) {
        const res = await fetch(url, { headers: { cookie: j.header() }, redirect: 'manual' });
        j.store(res);
        const loc = res.headers.get('location');
        if (!loc || res.status < 300 || res.status >= 400) break;
        url = new URL(loc, base).toString();
    }
    return { j, playerId };
}

(async () => {
    const server = await bootServer();
    const { base } = server;
    try {
        const me = await identity(base);
        const api = (p, opts = {}) => fetch(base + '/api/solo/solitaire' + p, {
            ...opts,
            headers: { 'Content-Type': 'application/json', cookie: me.j.header(), ...(opts.headers || {}) }
        });
        const post = async body => { const r = await api('/result', { method: 'POST', body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

        const page = await fetch(base + '/solo/solitaire', { headers: { cookie: me.j.header() } });
        const html = await page.text();
        check(page.status === 200 && html.includes('ไพ่โซลิแทร์') && html.includes('solitaire-engine.js'), 'game page renders');
        check(html.includes('ui-footer-bar') && html.includes('href="/solo"'), 'footer nav back to /solo');

        let stats = await (await api('/stats')).json();
        check(stats.success && stats.data === null, 'no stats before playing');

        const seed = SEEDS[1][7];
        const sol = solve(seed, 1);
        const log = sol.moves.map(E.encodeMove).join('');
        const win = extra => Object.assign({ gameId: 'apiwin0001', outcome: 'win', draw: 1, seed, timeMs: 185000, moves: sol.moves.length, log, deal: 'winnable' }, extra);

        let r = await post(win());
        check(r.status === 200 && r.body.data.wins === 1 && r.body.summary.includes('3:05'), 'valid win accepted');
        r = await post(win());
        check(r.status === 200 && r.body.data.games === 1, 'resend same gameId is idempotent');
        r = await post(win({ gameId: 'apiwin0002' }));
        check(r.status === 400 && /บันทึกชัยชนะ/.test(r.body.error), 'same deal won twice rejected');
        r = await post(win({ gameId: 'apiwin0003', timeMs: 4000 }));
        check(r.status === 400 && /เร็วเกินจริง/.test(r.body.error), 'impossibly fast win rejected');
        r = await post(win({ gameId: 'apiwin0004', log: log.slice(0, -30), moves: sol.moves.length - 10 }));
        check(r.status === 400, 'unfinished log rejected');
        r = await post(win({ gameId: 'apiwin0005', draw: 3 }));
        check(r.status === 400, 'draw-1 log claimed as draw-3 rejected');
        r = await post({ gameId: 'apiloss001', outcome: 'loss', draw: 3, seed: 42, timeMs: 30000, moves: 9 });
        check(r.status === 200 && r.body.data.streak === 0 && r.body.data.games === 2, 'loss recorded, streak reset');
        r = await post({ nonsense: true });
        check(r.status === 400, 'garbage payload rejected');

        stats = await (await api('/stats')).json();
        check(stats.data.wins === 1 && stats.data.modes[1].bestMs === 185000, 'stats persisted');
        const lb = await (await api('/leaderboard')).json();
        check(lb.entries.length === 1 && lb.entries[0].label === '3:05' && lb.entries[0].rank === 1, 'leaderboard lists fastest draw-1 win');

        const hub = await (await fetch(base + '/solo', { headers: { cookie: me.j.header() } })).text();
        check(hub.includes('/solo/solitaire') && hub.includes('cover.svg') && hub.includes('เร็วสุด 3:05'), 'hub card shows summary');

        const anon = await fetch(base + '/api/solo/solitaire/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(win({ gameId: 'anon00001' })) });
        check(anon.status === 403, 'no identity → 403');

        // rate limit (30 ครั้ง/นาที ต่อผู้เล่น)
        let limited = false;
        for (let i = 0; i < 35 && !limited; i++) {
            const res = await post({ gameId: 'spam' + String(i).padStart(6, '0'), outcome: 'loss', draw: 1, seed: i, timeMs: 1000, moves: 1 });
            if (res.status === 429) limited = true;
        }
        check(limited, 'rate limited after burst');

        console.log(`smoke-solo-solitaire-api: ${passed} checks passed`);
    } finally {
        server.stop();
    }
})().catch(error => { console.error(error); process.exit(1); });
