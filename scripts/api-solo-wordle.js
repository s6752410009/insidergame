/**
 * API test ของ "ทายคำรายวัน": /today, /guess, /result (ต้องปฏิเสธ), /stats, /leaderboard, rate limit
 * และความคืบหน้าต้องรอดการรีสตาร์ตเซิร์ฟเวอร์
 *
 * รัน: npm run smoke:solo:wordle:api   (PORT=8482 เป็นค่าเริ่ม, ใช้ GAME_DATA_DIR ชั่วคราว)
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const W = require('../public/js/solo/wordle-logic');
const { answerFor, ANSWERS } = require('../games/solo/wordle')._internal;

const PORT = Number(process.env.WORDLE_TEST_PORT) || 8482;
const BASE = `http://127.0.0.1:${PORT}`;
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function ok(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed += 1;
    console.log('  ✓ ' + msg);
}

function boot() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), WALLETS_FILE: process.env.WALLETS_FILE || path.join(process.env.GAME_DATA_DIR, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('boot timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${PORT}`) || logs.includes(`HTTP ready on port ${PORT}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}
async function stop(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise(r => child.once('exit', r)), delay(4000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

/** cookie jar แบบง่าย — เปิดหน้าแรกด้วย ?playerId แล้วเก็บ cookie ไว้ใช้ต่อ */
class Client {
    constructor() { this.jar = new Map(); }
    cookieHeader() { return Array.from(this.jar, ([k, v]) => `${k}=${v}`).join('; '); }
    absorb(res) {
        const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
        list.forEach(line => {
            const [pair] = line.split(';');
            const i = pair.indexOf('=');
            this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        });
    }
    async raw(method, url, body) {
        let target = BASE + url;
        for (let hop = 0; hop < 6; hop++) {
            const res = await fetch(target, {
                method,
                redirect: 'manual',
                headers: { cookie: this.cookieHeader(), ...(body ? { 'content-type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined
            });
            this.absorb(res);
            if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                target = new URL(res.headers.get('location'), target).toString();
                method = 'GET';
                body = undefined;
                continue;
            }
            return res;
        }
        throw new Error('too many redirects');
    }
    async json(method, url, body) {
        const res = await this.raw(method, url, body);
        let json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        return { status: res.status, json };
    }
    async identify() {
        this.id = randomUUID();
        const res = await this.raw('GET', `/?playerId=${this.id}`);
        await res.text();
        return this.id;
    }
}

async function main() {
    const puzzle = W.puzzleNumber(Date.now());
    const answer = answerFor(puzzle);
    const wrongs = ANSWERS.filter(w => w !== answer);
    console.log(`puzzle #${puzzle} (answer hidden) — data: ${process.env.GAME_DATA_DIR}`);
    let server = await boot();
    try {
        const anon = new Client();
        let r = await anon.json('GET', '/api/solo/wordle/today');
        ok(r.status === 200 && r.json.success && r.json.puzzle === puzzle, 'today works without identity');
        ok(r.json.length === 4 && r.json.maxGuesses === 6 && r.json.answer === null, 'today: length 4, 6 guesses, answer hidden');
        ok(!JSON.stringify(r.json).includes(answer), 'today payload never contains the answer');
        r = await anon.json('POST', '/api/solo/wordle/guess', { guess: wrongs[0], puzzle });
        ok(r.status === 403, 'guess without identity → 403');

        const a = new Client();
        await a.identify();
        ok(a.jar.size > 0, 'got identity cookie');

        const bad = [
            [{}, 400, 'bad_input'],
            [{ guess: 'กข', puzzle }, 200, 'bad_length'],
            [{ guess: 'กขคง', puzzle }, 200, 'not_word'],
            [{ guess: 'ก่้ขคง', puzzle }, 200, 'malformed'],
            [{ guess: 'x'.repeat(500), puzzle }, 400, 'bad_input'],
            [{ guess: wrongs[0], puzzle: puzzle - 1 }, 200, 'stale_puzzle']
        ];
        for (const [body, status, code] of bad) {
            r = await a.json('POST', '/api/solo/wordle/guess', body);
            ok(r.status === status && r.json.success === false && r.json.code === code, `rejects ${code} (${r.status})`);
        }

        r = await a.json('POST', '/api/solo/wordle/guess', { guess: wrongs[0], puzzle });
        ok(r.status === 200 && r.json.guesses.length === 1, 'valid wrong guess accepted');
        ok(r.json.guesses[0].states.length === 4 && r.json.guesses[0].states.every(s => ['correct', 'present', 'absent'].includes(s)), 'per-tile colours returned');
        ok(r.json.answer === null && !r.json.done, 'answer still hidden mid-game');
        const expected = W.scoreGuess(W.toCells(wrongs[0]), W.toCells(answer)).states;
        ok(JSON.stringify(expected) === JSON.stringify(r.json.guesses[0].states), 'colours match the pure scorer');

        r = await a.json('POST', '/api/solo/wordle/guess', { guess: wrongs[0], puzzle });
        ok(r.json.success === false && r.json.code === 'repeat', 'same word twice rejected');

        r = await a.json('GET', '/api/solo/wordle/today');
        ok(r.json.guesses.length === 1 && r.json.guesses[0].word === wrongs[0], 'progress stored server-side (resume after refresh)');

        // ทายโดยพิมพ์สระ/วรรณยุกต์สลับลำดับ → server ทำให้เป็นรูปมาตรฐานเอง
        const scrambled = W.toCells(answer).map(cell => cell[0] + Array.from(cell.slice(1)).reverse().join('')).join(' ');
        r = await a.json('POST', '/api/solo/wordle/guess', { guess: scrambled, puzzle });
        ok(r.status === 200 && r.json.done && r.json.won, 'correct answer wins');
        ok(r.json.answer === answer && r.json.answerCells.length === 4, 'answer revealed after finishing');
        ok(r.json.stats.played === 1 && r.json.stats.streak === 1 && r.json.stats.dist[1] === 1 && r.json.stats.winRate === 100, 'stats: played 1, streak 1, dist[2]=1');

        r = await a.json('POST', '/api/solo/wordle/guess', { guess: wrongs[1], puzzle });
        ok(r.json.success === false && r.json.code === 'done' && r.json.done, 'one puzzle per day — further guesses refused');

        r = await a.json('POST', '/api/solo/wordle/result', { won: true, guesses: 1 });
        ok(r.status === 400 && /อัตโนมัติ/.test(r.json.error), 'generic /result rejects client-made results');

        r = await a.json('GET', '/api/solo/wordle/stats');
        ok(r.status === 200 && r.json.data && r.json.data.played === 1, '/stats returns this player data');

        // ผู้เล่นคนที่ 2: แพ้ครบ 6 ครั้ง
        const b = new Client();
        await b.identify();
        for (let i = 0; i < 6; i++) {
            r = await b.json('POST', '/api/solo/wordle/guess', { guess: wrongs[10 + i], puzzle });
        }
        ok(r.status === 200 && r.json.done && !r.json.won && r.json.guesses.length === 6, 'six misses → lost');
        ok(r.json.answer === answer, 'loss reveals the answer');
        ok(r.json.stats.streak === 0 && r.json.stats.played === 1 && r.json.stats.winRate === 0, 'loss stats');

        r = await a.json('GET', '/api/solo/wordle/leaderboard');
        const lb = r.json.entries || [];
        ok(lb.some(e => e.playerId === a.id && e.score === 1), 'leaderboard lists the winner streak');
        ok(!lb.some(e => e.playerId === b.id), 'player with no streak not on the leaderboard');

        // rate limit
        const c = new Client();
        await c.identify();
        let limited = false;
        for (let i = 0; i < 25 && !limited; i++) {
            r = await c.json('POST', '/api/solo/wordle/guess', { guess: 'กขคง', puzzle });
            if (r.status === 429) limited = true;
        }
        ok(limited, 'guess endpoint rate-limited (20/min)');

        // hub card summary
        const hub = await a.raw('GET', '/solo');
        const html = await hub.text();
        ok(html.includes('ทายคำรายวัน') && html.includes('ติดกัน 1 วัน'), 'hub card shows the streak summary');
        const page = await a.raw('GET', '/solo/wordle');
        const pageHtml = await page.text();
        ok(page.status === 200 && !pageHtml.includes(answer), 'game page renders and does not embed the answer');

        // รีสตาร์ต: ความคืบหน้าต้องยังอยู่
        await delay(800);
        await stop(server);
        server = await boot();
        r = await b.json('GET', '/api/solo/wordle/today');
        ok(r.json.done && r.json.guesses.length === 6, 'progress survives a server restart');
    } finally {
        await stop(server);
    }
    console.log(`OK — ${passed} API checks passed`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
