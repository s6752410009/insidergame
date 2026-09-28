/**
 * เทสตรรกะล้วนของเกมจับคู่ความจำ + การตรวจผลฝั่ง server (ไม่ต้องเปิดเซิร์ฟเวอร์)
 * รัน: npm run smoke:solo:memory
 */
const fs = require('fs');
const path = require('path');
const core = require('../public/js/solo/memory-core');
const game = require('../games/solo/memory');

let passed = 0;
function check(cond, message) {
    if (!cond) throw new Error('FAIL: ' + message);
    passed += 1;
}
function throws(fn, pattern, message) {
    try { fn(); } catch (error) {
        check(!pattern || pattern.test(error.message), `${message} (got "${error.message}")`);
        return;
    }
    throw new Error('FAIL (no throw): ' + message);
}

// เล่นแบบรู้คำตอบ: ทุกครั้งเปิดคู่ถูก
function perfectLog(level, seed, deck) {
    const cards = core.makeBoard(level, seed, deck);
    const seen = new Map();
    const log = [];
    cards.forEach((key, i) => {
        if (seen.has(key)) log.push([seen.get(key), i]);
        else seen.set(key, i);
    });
    return log;
}
// เล่นแบบคนจำได้หมด แต่เปิดผิดก่อน `misses` ครั้ง
function sloppyLog(level, seed, deck, misses) {
    const cards = core.makeBoard(level, seed, deck);
    const log = [];
    for (let m = 0; m < misses; m++) {
        const a = 0;
        const b = cards.findIndex((k, i) => i !== a && k !== cards[a]);
        log.push([a, b]);
    }
    return log.concat(perfectLog(level, seed, deck));
}

// ---------- กระดาน ----------
core.LEVEL_IDS.forEach(level => {
    const L = core.LEVELS[level];
    check(L.cols * L.rows === L.pairs * 2, `${level} grid matches pairs`);
    core.DECK_IDS.forEach(deck => {
        const board = core.makeBoard(level, 'abc123', deck);
        check(board.length === L.pairs * 2, `${level}/${deck} card count`);
        const counts = {};
        board.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
        check(Object.values(counts).every(c => c === 2), `${level}/${deck} every face twice`);
        check(JSON.stringify(board) === JSON.stringify(core.makeBoard(level, 'abc123', deck)), `${level}/${deck} deterministic`);
    });
});
check(JSON.stringify(core.makeBoard('hard', 's1', 'wolf')) !== JSON.stringify(core.makeBoard('hard', 's2', 'wolf')), 'different seeds → different boards');
core.DECK_IDS.forEach(deck => {
    check(core.DECKS[deck].cards.length >= core.LEVELS.hard.pairs, `${deck} has enough cards for hard`);
    core.DECKS[deck].cards.forEach(([key]) => {
        const file = path.join(__dirname, '..', 'public', 'assets', 'games', 'solo', 'memory', 'faces', deck, `${key}.webp`);
        check(fs.existsSync(file), `face exists ${deck}/${key}`);
    });
});

// ---------- วันที่ไทย ----------
check(core.bangkokDate(new Date('2026-09-28T16:59:00Z')) === '2026-09-28', 'bkk before midnight');
check(core.bangkokDate(new Date('2026-09-28T17:00:00Z')) === '2026-09-29', 'bkk after midnight');
check(core.shiftDate('2026-03-01', -1) === '2026-02-28', 'shiftDate');
check(core.dateFromDailySeed('daily-2026-09-29') === '2026-09-29', 'daily seed parse');
check(core.dateFromDailySeed('abc') === null, 'non daily seed');
check(core.DECK_IDS.includes(core.dailyDeck('2026-09-29')), 'daily deck valid');

// ---------- flip / คอมโบ / คะแนน ----------
{
    const s = core.newGame('easy', 'x1', 'city');
    const log = perfectLog('easy', 'x1', 'city');
    let r = core.flip(s, log[0][0]);
    check(r.event === 'open', 'first flip opens');
    check(core.flip(s, log[0][0]).event === 'ignored', 'same card twice ignored');
    r = core.flip(s, log[0][1]);
    check(r.event === 'match' && s.combo === 1 && s.score === 100, 'match scores 100');
    check(core.flip(s, log[0][0]).event === 'ignored', 'matched card ignored');
    core.flip(s, log[1][0]); r = core.flip(s, log[1][1]);
    check(s.combo === 2 && s.score === 250, 'combo bonus');
    // miss
    const unmatched = s.cards.map((_, i) => i).filter(i => !s.matched[i]);
    const a = unmatched[0];
    const b = unmatched.find(i => s.cards[i] !== s.cards[a]);
    core.flip(s, a); r = core.flip(s, b);
    check(r.event === 'miss' && s.combo === 0 && s.open.length === 2, 'miss resets combo and holds');
    r = core.flip(s, a);
    check(r.event === 'open' && s.open.length === 1, 'tap during miss hides pair and opens new');
    check(s.moves === 3, 'moves counted per pair');
}

// ---------- replay ----------
{
    const log = perfectLog('hard', 'r1', 'knight');
    const r = core.replay('hard', 'r1', 'knight', log);
    check(r.ok && r.state.done && r.state.moves === 12 && r.state.bestCombo === 12, 'perfect replay');
    check(!core.replay('hard', 'r1', 'knight', log.concat([[0, 1]])).ok, 'moves after done rejected');
    check(core.replay('hard', 'r1', 'knight', log.slice(0, -1)).state.done === false, 'incomplete not done');
    check(!core.replay('hard', 'r1', 'knight', [[0, 0]]).ok, 'same index rejected');
    check(!core.replay('hard', 'r1', 'knight', [[0, 99]]).ok, 'out of range rejected');
    check(!core.replay('hard', 'r1', 'knight', [log[0], log[0]]).ok, 'reopening matched rejected');
    check(!core.replay('hard', 'BAD SEED', 'knight', log).ok, 'bad seed rejected');
}

// ---------- ดาว ----------
check(core.starsFor('easy', 6) === 3 && core.starsFor('easy', 10) === 3 && core.starsFor('easy', 11) === 2 && core.starsFor('easy', 15) === 1, 'easy stars');
check(core.starsFor('hard', 20) === 3 && core.starsFor('hard', 27) === 2 && core.starsFor('hard', 28) === 1, 'hard stars');

// ---------- recordResult ----------
const now = new Date('2026-09-29T05:00:00Z'); // 12:00 เวลาไทย
const ctx = { playerId: 'p1', now };
function payload(level, seed, deck, extra) {
    const log = extra && extra.log ? extra.log : perfectLog(level, seed, deck);
    return Object.assign({ runId: 'run-' + seed + '-' + level, level, seed, deck, timeMs: 60000, moves: log.length, log }, extra || {});
}
let data = game.recordResult(null, payload('easy', 'aa1', 'wolf'), ctx);
check(data.levels.easy.plays === 1 && data.levels.easy.bestMoves === 6 && data.levels.easy.bestStars === 3, 'easy recorded');
check(data.totalStars === 3 && data.plays === 1, 'totals');
check(game.recordResult(data, payload('easy', 'aa1', 'wolf'), ctx).plays === 1, 'same runId idempotent');
throws(() => game.recordResult(data, payload('easy', 'aa1', 'wolf', { runId: 'run-other' }), ctx), /ส่งผลไปแล้ว/, 'reused seed rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { timeMs: 2000 }), ctx), /เร็วเกิน/, 'too fast rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { moves: 5 }), ctx), /ไม่ตรง/, 'claimed moves mismatch rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { log: perfectLog('easy', 'aa2', 'wolf').slice(0, 3) }), ctx), /ไม่ตรงกับกระดาน/, 'unfinished log rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { log: perfectLog('easy', 'zz9', 'wolf') }), ctx), /ไม่ตรงกับกระดาน|ข้อมูลการเล่น/, 'log for another board rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { log: [] }), ctx), /ข้อมูลการเล่น/, 'empty log rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { timeMs: 'abc' }), ctx), /เวลา/, 'NaN time rejected');
throws(() => game.recordResult(data, payload('easy', 'aa2', 'wolf', { timeMs: 99999999 }), ctx), /เวลา/, 'huge time rejected');
throws(() => game.recordResult(data, { ...payload('easy', 'aa2', 'wolf'), level: 'mega' }, ctx), /ระดับ/, 'unknown level rejected');
throws(() => game.recordResult(data, { ...payload('easy', 'aa2', 'wolf'), deck: 'nope' }, ctx), /สำรับ/, 'unknown deck rejected');
throws(() => game.recordResult(data, { ...payload('easy', 'aa2', 'wolf'), runId: undefined }, ctx), /ไม่ครบ/, 'missing runId rejected');
throws(() => game.recordResult(data, payload('easy', 'daily-2026-09-29', 'wolf'), ctx), /ไม่ถูกต้อง/, 'daily seed on practice rejected');

data = game.recordResult(data, payload('easy', 'aa3', 'wolf', { log: sloppyLog('easy', 'aa3', 'wolf', 9), timeMs: 45000 }), ctx);
check(data.levels.easy.plays === 2 && data.levels.easy.bestMoves === 6 && data.levels.easy.bestTimeMs === 45000, 'best time improves, best moves kept');
check(data.totalStars === 3 + 1, 'sloppy game 1 star (15 moves)');
check(data.lastResult.isBestTime === true && data.lastResult.isBestMoves === false, 'lastResult flags');

// ---------- daily ----------
const today = core.bangkokDate(now);
const dDeck = core.dailyDeck(today);
throws(() => game.recordResult(data, payload('daily', core.dailySeed(today), dDeck === 'wolf' ? 'city' : 'wolf'), ctx), /ไม่ถูกต้อง/, 'daily wrong deck rejected');
throws(() => game.recordResult(data, payload('daily', core.dailySeed('2026-09-20'), core.dailyDeck('2026-09-20')), ctx), /หมดเวลา/, 'old daily rejected');
throws(() => game.recordResult(data, payload('daily', core.dailySeed('2026-09-30'), core.dailyDeck('2026-09-30')), ctx), /หมดเวลา/, 'future daily rejected');
check(game.leaderboardEntry(data) === null, 'no leaderboard before daily');

// เมื่อวาน (ยอมรับช่วงข้ามเที่ยงคืน) แล้ววันนี้ = streak 2
const yday = core.shiftDate(today, -1);
data = game.recordResult(data, payload('daily', core.dailySeed(yday), core.dailyDeck(yday), { timeMs: 50000 }), ctx);
check(data.daily.streak === 1 && data.daily.lastDate === yday, 'yesterday daily accepted');
data = game.recordResult(data, payload('daily', core.dailySeed(today), dDeck, { timeMs: 42300 }), ctx);
check(data.daily.streak === 2 && data.daily.bestStreak === 2 && data.daily.last.date === today, 'streak continues');
throws(() => game.recordResult(data, payload('daily', core.dailySeed(today), dDeck, { runId: 'run-again' }), ctx), /ไปแล้ว/, 'daily twice rejected');
throws(() => game.recordResult(data, payload('daily', core.dailySeed(yday), core.dailyDeck(yday), { runId: 'run-back' }), ctx), /ไปแล้ว|หมดเวลา/, 'going back to yesterday rejected');
check(game.recordResult(data, payload('daily', core.dailySeed(today), dDeck), ctx).daily.streak === 2, 'daily retry same runId idempotent');

// leaderboardEntry ใช้เวลาจริงของเครื่อง — ทดสอบด้วยข้อมูลที่ date = วันนี้จริง
{
    const realToday = core.bangkokDate(new Date());
    const entry = game.leaderboardEntry({ daily: { last: { date: realToday, timeMs: 42300, moves: 14 } } });
    check(entry && entry.score === 42300 && /0:42\.3/.test(entry.label) && /14 ครั้ง/.test(entry.label), 'leaderboard entry today');
    check(game.leaderboardEntry({ daily: { last: { date: core.shiftDate(realToday, -1), timeMs: 1000, moves: 10 } } }) === null, 'yesterday excluded from leaderboard');
    check(game.leaderboardOrder === 'asc', 'asc order');
}

// streak ขาด
{
    let d2 = game.recordResult(null, payload('daily', core.dailySeed(yday), core.dailyDeck(yday)), ctx);
    d2.daily.lastDate = '2026-09-01'; d2.daily.last.date = '2026-09-01';
    d2 = game.recordResult(d2, payload('daily', core.dailySeed(today), dDeck, { runId: 'run-fresh' }), ctx);
    check(d2.daily.streak === 1 && d2.daily.bestStreak === 1, 'streak resets after gap');
}

// summary
check(game.summary(null) === null, 'summary null');
check(typeof game.summary({ totalStars: 5, levels: { easy: { bestTimeMs: 30000 } } }) === 'string', 'summary text');

// min time
check(core.minTimeMs('easy', 6) === 5400 && core.minTimeMs('hard', 40) === 16000, 'min time');

console.log(`smoke-solo-memory: ${passed} checks passed`);
