/**
 * เทสกติกาโซลิแทร์ (engine) + ตัวตรวจผลฝั่ง server + seed "ชนะได้แน่นอน"
 *
 * รัน: node scripts/smoke-solo-solitaire.js
 *      SOLITAIRE_VERIFY_ALL=1 node scripts/smoke-solo-solitaire.js   (ตรวจ seed ครบทุกตัว ~2 นาที)
 */
const E = require('../public/js/solo/solitaire-engine');
const SEEDS = require('../public/js/solo/solitaire-seeds');
const { solve } = require('./solitaire-solver');
const game = require('../games/solo/solitaire');

let passed = 0;
function check(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed++;
}
function throws(fn, pattern, msg) {
    try { fn(); } catch (error) {
        check(!pattern || pattern.test(error.message), msg + ' (got: ' + error.message + ')');
        return;
    }
    throw new Error('FAIL: expected throw — ' + msg);
}
const enc = moves => moves.map(E.encodeMove).join('');
const card = (rank, suit) => suit * 13 + rank - 1; // suit 0♠ 1♥ 2♣ 3♦

// ---------------------------------------------------------------- deal
{
    const s = E.deal(12345, 1);
    const all = [].concat(...s.t, s.stock, s.waste);
    check(all.length === 52 && new Set(all).size === 52, 'deal has 52 unique cards');
    check(s.t.every((p, i) => p.length === i + 1 && s.h[i] === i), 'pile i has i+1 cards, i face-down');
    check(s.stock.length === 24 && s.waste.length === 0, 'stock 24, waste empty');
    check(JSON.stringify(E.deal(12345, 1)) === JSON.stringify(s), 'deal is deterministic');
    check(JSON.stringify(E.deal(12346, 1).t) !== JSON.stringify(s.t), 'different seed → different deal');
    throws(() => E.deal(-1, 1), /seed/, 'negative seed rejected');
    throws(() => E.deal(1, 2), /draw/, 'draw 2 rejected');
}

// ---------------------------------------------------------------- encode/decode
{
    const samples = [{ draw: true }, { from: 'w', to: 'F', n: 1 }, { from: 3, to: 6, n: 12 }, { from: 'B', to: 0, n: 1 }, { from: 6, to: 'F', n: 1 }];
    samples.forEach(m => check(JSON.stringify(E.decodeMove(E.encodeMove(m))) === JSON.stringify(m), 'roundtrip ' + E.encodeMove(m)));
    ['', 'x01', '7F1', '0Fz', '0G1', 'D-', 'w0e'].forEach(code => check(E.decodeMove(code) === null, 'bad code rejected: ' + code));
    check(E.replay(1, 1, 'D-').ok === false, 'log with partial code rejected');
}

// ---------------------------------------------------------------- rules on a hand-built state
function blank(draw) {
    return { draw: draw || 1, t: [[], [], [], [], [], [], []], h: [0, 0, 0, 0, 0, 0, 0], stock: [], waste: [], f: [0, 0, 0, 0] };
}
{
    const s = blank();
    s.t[0] = [card(9, 0), card(8, 1)];     // 9♠ 8♥
    s.t[1] = [card(7, 2)];                  // 7♣
    s.t[2] = [card(7, 3)];                  // 7♦
    s.t[3] = [card(5, 0), card(13, 1)]; s.h[3] = 1; // (5♠ คว่ำ) K♥
    s.t[4] = [card(1, 2)];                  // A♣
    s.waste = [card(2, 2)];                 // 2♣
    check(E.isLegal(s, { from: 1, to: 0, n: 1 }), '7♣ on 8♥ ok');
    check(!E.isLegal(s, { from: 2, to: 0, n: 1 }), '7♦ on 8♥ rejected (same colour)');
    check(!E.isLegal(s, { from: 1, to: 5, n: 1 }), 'non-king to empty rejected');
    check(E.isLegal(s, { from: 3, to: 5, n: 1 }), 'king to empty ok');
    check(!E.isLegal(s, { from: 3, to: 5, n: 2 }), 'cannot lift face-down cards');
    check(!E.isLegal(s, { from: 'w', to: 'F', n: 1 }), '2♣ to empty foundation rejected');
    check(E.isLegal(s, { from: 4, to: 'F', n: 1 }), 'A♣ to foundation ok');
    const a = E.applyMove(s, { from: 3, to: 5, n: 1 });
    check(a.h[3] === 0 && a.t[3].length === 1, 'face-down card flips after its cover leaves');
    check(s.t[3].length === 2, 'applyMove does not mutate input');
    const b = E.applyMove(E.applyMove(s, { from: 4, to: 'F', n: 1 }), { from: 'w', to: 'F', n: 1 });
    check(b && b.f[2] === 2, 'A♣ then 2♣ on foundation');
    check(E.isLegal(b, { from: 'C', to: 1, n: 1 }) === false, '2♣ onto 7♣ from foundation rejected');
    const c = E.applyMove(s, { from: 1, to: 0, n: 1 });
    check(E.isLegal(c, { from: 0, to: 5, n: 3 }) === false, '9♠ stack to empty rejected (not a king)');
    // autoMoveFor: foundation first
    check(JSON.stringify(E.autoMoveFor(s, 4, 0)) === JSON.stringify({ from: 4, to: 'F', n: 1 }), 'tap A♣ → foundation');
    check(JSON.stringify(E.autoMoveFor(s, 1, 0)) === JSON.stringify({ from: 1, to: 0, n: 1 }), 'tap 7♣ → onto 8♥');
    check(E.autoMoveFor(s, 3, 0) === null, 'tap face-down card → nothing');
    const km = E.autoMoveFor(s, 3, 1);
    check(km && km.to === 5 && km.n === 1, 'tap K♥ → empty column (reveals a card)');
    const stackMove = E.autoMoveFor(c, 0, 0);
    check(stackMove === null, 'tap 9♠ stack with nowhere to go → null');
}

// ---------------------------------------------------------------- draw / recycle
{
    let s = E.deal(777, 3);
    s = E.applyMove(s, { draw: true });
    check(s.waste.length === 3 && s.stock.length === 21, 'draw-3 turns three cards');
    for (let i = 0; i < 7; i++) s = E.applyMove(s, { draw: true });
    check(s.stock.length === 0 && s.waste.length === 24, 'stock exhausted after 8 draws');
    const orderBefore = s.waste.slice();
    s = E.applyMove(s, { draw: true });
    check(s.stock.length === 24 && s.waste.length === 0, 'recycle waste back to stock');
    s = E.applyMove(s, { draw: true });
    check(JSON.stringify(s.waste) === JSON.stringify(orderBefore.slice(0, 3)), 'second pass shows the same first three cards');
    const empty = blank(1);
    check(E.applyMove(empty, { draw: true }) === null, 'cannot draw with empty stock and waste');
    let d1 = E.deal(777, 1);
    for (let i = 0; i < 24; i++) d1 = E.applyMove(d1, { draw: true });
    check(d1.stock.length === 0 && d1.waste.length === 24, 'draw-1 turns one at a time');
    check(E.applyMove(d1, { draw: true }).stock.length === 24, 'draw-1 unlimited redeal');
}

// ---------------------------------------------------------------- stuck detection / hint
{
    const s = blank(1);
    s.t[0] = [card(2, 0), card(5, 1)]; s.h[0] = 1; // 2♠ คว่ำอยู่ใต้ 5♥
    s.t[1] = [card(9, 2)];
    s.stock = [card(3, 3)];                        // 3♦ ลงไม่ได้
    s.f = [1, 0, 0, 0];
    // ไพ่ที่เหลือทั้งหมดอยู่ที่อื่นไม่สำคัญสำหรับเทสนี้
    check(!E.hasProgress(s), 'no playable card anywhere → stuck');
    check(E.hint(s) === null, 'hint null when stuck');
    s.stock = [card(4, 2)]; // 4♣ ต่อ 5♥ ได้
    check(E.hasProgress(s), 'card reachable by drawing → not stuck');
    check(E.hint(s) && E.hint(s).draw, 'hint says draw');
    const fresh = E.deal(4242, 1);
    const h = E.hint(fresh);
    check(h && (h.draw || E.isLegal(fresh, h)), 'hint on fresh deal is legal');
}

// ---------------------------------------------------------------- winnable seeds verified by solver
const verifyAll = process.env.SOLITAIRE_VERIFY_ALL === '1';
let solvedExample = null;
for (const draw of [1, 3]) {
    const list = SEEDS[draw];
    check(Array.isArray(list) && list.length >= 200, `draw-${draw} has ≥200 winnable seeds`);
    check(new Set(list).size === list.length, `draw-${draw} seeds unique`);
    const sample = verifyAll ? list : list.filter((_, i) => i % 25 === 0);
    const t0 = Date.now();
    sample.forEach(seed => {
        const r = solve(seed, draw, { maxNodes: 150000 });
        check(r.solved, `seed ${seed} (draw-${draw}) is solvable`);
        const rep = E.replay(seed, draw, enc(r.moves));
        check(rep.ok && E.isWon(rep.state), `solution for ${seed} replays to a win`);
        if (!solvedExample && draw === 1) solvedExample = { seed, draw, moves: r.moves };
    });
    console.log(`  draw-${draw}: verified ${sample.length}/${list.length} seeds solvable in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------- auto-complete
{
    const { seed, draw, moves } = solvedExample;
    let s = E.deal(seed, draw);
    let i = 0;
    while (!E.allRevealed(s)) s = E.applyMove(s, moves[i++]);
    const plan = E.autoCompletePlan(s);
    check(Array.isArray(plan) && plan.length > 0, 'auto-complete plan exists once all tableau cards are face-up');
    let t = s;
    plan.forEach(m => { t = E.applyMove(t, m); });
    check(E.isWon(t), 'auto-complete plan wins');
    check(E.autoCompletePlan(E.deal(seed, draw)) === null, 'no auto-complete on a fresh deal');
    // draw-3 variant
    const r3 = solve(SEEDS[3][0], 3);
    let s3 = E.deal(SEEDS[3][0], 3); let k = 0;
    while (!E.allRevealed(s3)) s3 = E.applyMove(s3, r3.moves[k++]);
    const p3 = E.autoCompletePlan(s3);
    let t3 = s3; (p3 || []).forEach(m => { t3 = E.applyMove(t3, m); });
    check(p3 && E.isWon(t3), 'draw-3 auto-complete wins');
}

// ---------------------------------------------------------------- server: recordResult
{
    const { seed, draw, moves } = solvedExample;
    const log = enc(moves);
    const now = new Date('2026-09-29T10:00:00Z');
    const ctx = { playerId: 'p1', now };
    const win = (extra) => Object.assign({ gameId: 'g0000001', outcome: 'win', draw, seed, timeMs: 180000, moves: moves.length, log }, extra);

    let d = game.recordResult(null, win(), ctx);
    check(d.games === 1 && d.wins === 1 && d.streak === 1 && d.modes[1].bestMs === 180000, 'valid win recorded');
    check(game.leaderboardEntry(d).score === 180000 && game.leaderboardEntry(d).label === '3:00', 'leaderboard entry = best draw-1 time');
    check(/เร็วสุด 3:00/.test(game.summary(d)), 'summary shows best time');
    check(game.recordResult(d, win(), ctx) === d || game.recordResult(d, win(), ctx).games === 1, 'same gameId is idempotent');
    throws(() => game.recordResult(d, win({ gameId: 'g0000002' }), ctx), /บันทึกชัยชนะ/, 'same seed win twice rejected');
    throws(() => game.recordResult(null, win({ timeMs: 9000 }), ctx), /เร็วเกินจริง/, 'too-fast win rejected');
    throws(() => game.recordResult(null, win({ timeMs: moves.length * 100 }), ctx), /เร็วเกินจริง/, 'per-move floor enforced');
    throws(() => game.recordResult(null, win({ moves: moves.length + 1 }), ctx), /จำนวนตา/, 'move count must match log');
    throws(() => game.recordResult(null, win({ log: log.slice(0, -3), moves: moves.length - 1 }), ctx), /ไม่ครบ/, 'unfinished game rejected');
    throws(() => game.recordResult(null, win({ log: '0F1' + log }), ctx), /ไม่ครบ/, 'illegal move in log rejected');
    throws(() => game.recordResult(null, win({ seed: seed + 1 }), ctx), /ไม่ครบ/, 'log from another seed rejected');
    throws(() => game.recordResult(null, win({ draw: 2 }), ctx), /โหมด/, 'bad draw rejected');
    throws(() => game.recordResult(null, win({ gameId: 'x' }), ctx), /ข้อมูลเกม/, 'bad gameId rejected');
    throws(() => game.recordResult(null, win({ outcome: 'draw' }), ctx), /ผลเกม/, 'bad outcome rejected');
    throws(() => game.recordResult(null, win({ timeMs: -5 }), ctx), /เวลา/, 'negative time rejected');
    throws(() => game.recordResult(null, { gameId: 'g0000009', outcome: 'loss', draw: 1, seed: 5, timeMs: 1000, moves: 0 }, ctx), /ยังไม่ได้เล่น/, 'loss without moves rejected');

    const beforeLoss = game.recordResult(d, win({ gameId: 'g0000003', timeMs: 240000, seed: SEEDS[1][1], log: enc(solve(SEEDS[1][1], 1).moves), moves: solve(SEEDS[1][1], 1).moves.length }), ctx);
    check(beforeLoss.wins === 2 && beforeLoss.streak === 2 && beforeLoss.modes[1].bestMs === 180000, 'slower win keeps best, streak 2');
    const lost = game.recordResult(beforeLoss, { gameId: 'g0000004', outcome: 'loss', draw: 3, seed: 99, timeMs: 30000, moves: 12 }, ctx);
    check(lost.streak === 0 && lost.bestStreak === 2 && lost.games === 3 && lost.modes[3].games === 1, 'loss resets streak, keeps best streak');
    check(game.leaderboardEntry({ modes: { 3: { bestMs: 1000 } } }) === null, 'draw-3 only → not on draw-1 leaderboard');
    check(game.summary(null) === null, 'no summary before first game');
    check(game.leaderboardOrder === 'asc', 'leaderboard ascending');
}

// ---------------------------------------------------------------- scoring (Windows Standard) + Vegas
{
    // ปกติ: กองเปิด→กองล่าง +5 · กองเปิด→ช่องเก็บ +10 · กองล่าง→ช่องเก็บ +10 (+5 ถ้าหงายใบใต้) · ช่องเก็บ→กองล่าง −15
    const s = blank();
    s.t[0] = [card(9, 0), card(8, 1)];
    s.t[1] = [card(4, 0), card(1, 3)]; s.h[1] = 1;        // (4♠ คว่ำ) A♦
    s.waste = [card(2, 3), card(7, 2)];                     // 2♦ ใต้ 7♣
    let x = E.applyMove(s, { from: 'w', to: 0, n: 1 });
    check(x.score === 5, 'waste → tableau +5');
    x = E.applyMove(x, { from: 1, to: 'F', n: 1 });
    check(x.score === 20 && x.h[1] === 0, 'tableau → foundation +10, turn over +5');
    x = E.applyMove(x, { from: 'w', to: 'F', n: 1 });
    check(x.score === 30, 'waste → foundation +10');
    const back = blank();
    back.f[3] = 2; back.t[0] = [card(3, 0)];               // 2♦ ลงบน 3♠
    back.score = 10;
    check(E.applyMove(back, { from: 'D', to: 0, n: 1 }).score === 0, 'foundation → tableau −15, floored at 0');
    check(E.applyMove(blank(), { from: 'w', to: 0, n: 1 }) === null, 'illegal move unchanged');
    const t2t = blank();
    t2t.t[0] = [card(9, 0), card(8, 1)]; t2t.t[1] = [card(10, 1)];
    check(E.applyMove(t2t, { from: 0, to: 1, n: 2 }).score === 0, 'tableau → tableau 0 (no card turned)');
}
{
    // วนกอง: จั่ว 1 ผ่านฟรี 1 รอบ แล้ว −100 ทุกครั้ง · จั่ว 3 ฟรี 3 รอบ แล้ว −20
    const one = blank(1);
    one.waste = [card(5, 0)]; one.score = 250;
    let y = E.applyMove(one, { draw: true });
    check(y.passes === 1 && y.score === 150, 'draw-1 first recycle −100');
    y = E.applyMove(y, { draw: true }); y = E.applyMove(y, { draw: true });
    check(y.passes === 2 && y.score === 50, 'draw-1 second recycle −100');
    y = E.applyMove(E.applyMove(y, { draw: true }), { draw: true });
    check(y.score === 0, 'draw-1 score never below 0');
    const three = blank(3);
    three.waste = [card(5, 0)]; three.score = 100;
    let z = three;
    const scores = [];
    for (let i = 0; i < 4; i++) { z = E.applyMove(z, { draw: true }); z = E.applyMove(z, { draw: true }); scores.push(z.score); }
    check(JSON.stringify(scores) === JSON.stringify([100, 100, 80, 60]), 'draw-3: passes 2–3 free, 4th pass on −20 each (' + scores + ')');
    check(E.canRecycle(E.applyMove(three, { draw: true })) === false && E.canRecycle(three), 'canRecycle only when stock empty');
}
{
    // เวกัส: เริ่ม −52, +5 ต่อใบที่ขึ้น, −5 ถ้าเอาลง, วนกองจำกัด (จั่ว 1 = 1 รอบ, จั่ว 3 = 3 รอบ)
    const v1 = E.deal(777, 1, 'vegas');
    check(v1.score === -52 && v1.limit === 1 && v1.scoring === 'vegas', 'vegas starts at −52 with 1 pass (draw 1)');
    check(E.deal(777, 1).limit === 0 && E.deal(777, 1).score === 0, 'standard: unlimited passes, score 0');
    let v = v1;
    while (v.stock.length) v = E.applyMove(v, { draw: true });
    check(!E.isLegal(v, { draw: true }) && !E.canRecycle(v) && E.recyclesLeft(v) === 0, 'vegas draw-1: no recycle after the only pass');
    check(!E.legalMoves(v).some(m => m.draw), 'legalMoves has no draw when passes are used up');
    check(E.applyMove(v, { draw: true }) === null, 'recycle refused by applyMove');
    E.hint(v); E.hasProgress(v); // ต้องไม่พัง
    check(E.replay(777, 1, 'D--'.repeat(25), 'vegas').ok === false, 'replay refuses a 25th draw (recycle) in vegas draw-1');
    check(E.replay(777, 1, 'D--'.repeat(25)).ok === true, 'standard allows the recycle');
    let v3 = E.deal(777, 3, 'vegas');
    let recycles = 0;
    for (let i = 0; i < 100 && E.isLegal(v3, { draw: true }); i++) {
        const wasEmpty = !v3.stock.length;
        v3 = E.applyMove(v3, { draw: true });
        if (wasEmpty) recycles++;
    }
    check(recycles === 2 && v3.passes === 2, 'vegas draw-3: 3 passes = 2 recycles');
    const vf = blank(); vf.scoring = 'vegas'; vf.score = -52;
    vf.t[0] = [card(1, 0)];
    const vf2 = E.applyMove(vf, { from: 0, to: 'F', n: 1 });
    check(vf2.score === -47, 'vegas +5 per card to foundation');
    vf2.t[1] = [card(2, 1)];
    check(E.applyMove(vf2, { from: 'A', to: 1, n: 1 }).score === -52, 'vegas −5 back from foundation (can go negative)');
    throws(() => E.deal(1, 1, 'cheat'), /scoring/, 'unknown scoring rejected');
}
{
    // server: คะแนนคิดจาก replay · เวกัสตรวจด้วยกติกาวนจำกัด
    const { seed, draw, moves } = solvedExample;
    const log = enc(moves);
    const ctx = { playerId: 'p1', now: new Date('2026-09-29T10:00:00Z') };
    const std = game.recordResult(null, { gameId: 'gs000001', outcome: 'win', draw, seed, timeMs: 200000, moves: moves.length, log }, ctx);
    const expect = E.replay(seed, draw, log).state.score;
    check(std.lastWin.scoring === 'standard' && std.lastWin.score === expect && std.modes[draw].bestScore === expect && expect > 0, 'standard win stores server score ' + expect);
    const vr = E.replay(seed, draw, log, 'vegas');
    if (vr.ok && E.isWon(vr.state)) {
        const vd = game.recordResult(null, { gameId: 'gv000001', outcome: 'win', draw, seed, timeMs: 200000, moves: moves.length, log, scoring: 'vegas' }, ctx);
        check(vd.lastWin.scoring === 'vegas' && vd.lastWin.score === 208 && vd.modes[draw].vegasWins === 1, 'vegas win: 52 cards × 5 − 52 = 208');
    } else {
        throws(() => game.recordResult(null, { gameId: 'gv000001', outcome: 'win', draw, seed, timeMs: 200000, moves: moves.length, log, scoring: 'vegas' }, ctx), /ไม่ครบ/, 'win that needs extra passes is rejected in vegas');
    }
    throws(() => game.recordResult(null, { gameId: 'gv000002', outcome: 'win', draw, seed, timeMs: 200000, moves: moves.length, log, scoring: 'x' }, ctx), /คะแนน/, 'bad scoring rejected');
    // หาเกมที่ต้องวนกองเกินที่เวกัสให้ → server ต้องปฏิเสธ
    let rejectedOnce = false;
    for (const sd of SEEDS[1].slice(0, 10)) {
        const sol = solve(sd, 1, { maxNodes: 150000 });
        if (!sol || !sol.moves) continue;
        const l = enc(sol.moves);
        let st = E.deal(sd, 1); let rec = 0;
        sol.moves.forEach(m => { if (m.draw && !st.stock.length) rec++; st = E.applyMove(st, m); });
        if (rec === 0) continue;
        throws(() => game.recordResult(null, { gameId: 'gv0000' + sd.toString(36).slice(0, 4), outcome: 'win', draw: 1, seed: sd, timeMs: 400000, moves: sol.moves.length, log: l, scoring: 'vegas' }, ctx), /ไม่ครบ/, 'vegas rejects a win that recycled the stock');
        rejectedOnce = true;
        break;
    }
    check(rejectedOnce, 'found a recycling solution to test vegas rejection');
}

console.log(`smoke-solo-solitaire: ${passed} checks passed`);
