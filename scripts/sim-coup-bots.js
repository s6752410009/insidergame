/**
 * วัดฝีมือบอท Coup (seed คงที่ · ไม่ต้องมีเซิร์ฟเวอร์)
 *
 *  1) โต๊ะผสม: บอทเวอร์ชันนี้ vs บอทเวอร์ชันเทียบ (BASE) นั่งสลับกัน 2–6 คน
 *     รายงาน "ส่วนแบ่งการชนะ" เทียบกับที่ควรได้ถ้าเก่งเท่ากัน (จำนวนที่นั่ง/คนทั้งโต๊ะ)
 *  2) จอมบลัฟ: ผู้เล่นสคริปต์ที่โกหกตลอด (เก็บภาษี/ขโมย/ลอบสังหาร/ขวาง ทั้งที่ไม่มีการ์ด ไม่เคยท้าใคร)
 *     เจอบอทล้วน — วัดว่าบอทจับโกหกได้กี่ % ของการบลัฟ และจอมบลัฟชนะกี่ %
 *
 * รัน: BASE=/path/to/oldCoupBots.js node scripts/sim-coup-bots.js   (GAMES=400 ต่อขนาดโต๊ะ)
 *      ไม่ใส่ BASE = เทียบกับตัวเอง (ส่วนแบ่งควรใกล้ 1.00) · ข้อ 2 ใช้บอทเวอร์ชันนี้
 */
const path = require('path');
const engine = require('../games/coupEngine');
const smart = require('../games/coupBots');

const base = process.env.BASE ? require(path.resolve(process.env.BASE)) : smart;
const GAMES = Number(process.env.GAMES) || 400;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const realRandom = Math.random;

function makeRoom(ids) {
    const players = ids.map((playerId, i) => ({ playerId, playerName: `P${i}`, color: '#fff', avatar: '🤖', permission: i === 0 ? 'admin' : null, socketId: `s${i}` }));
    const room = { roomId: 'sim', name: 'sim', players, settings: { gameMode: 'coup' }, gameState: engine.createInitialState() };
    engine.startGame(room);
    return room;
}

const player = (room, id) => room.gameState.players.find(p => p.playerId === id);
const ctxOf = s => ({ step: s.step, phase: s.phase, turnNumber: s.turnNumber });

/** ใครต้องตัดสินใจตอนนี้ (ทุกที่นั่ง ไม่ว่าบอทหรือสคริปต์) */
function whoActs(room) {
    const s = room.gameState;
    if (s.phase === 'action') return [{ kind: 'action', id: s.currentPlayerId }];
    if (s.phase === 'respond' && s.pendingAction) return engine.getPendingResponders(room).map(id => ({ kind: 'respond', id }));
    if (s.phase === 'block-respond' && s.pendingBlock) return engine.getPendingBlockResponders(room).map(id => ({ kind: 'block-respond', id }));
    if (s.phase === 'lose-influence' && s.pendingLoss) return [{ kind: 'lose', id: s.pendingLoss.playerId }];
    if (s.phase === 'exchange' && s.pendingExchange) return [{ kind: 'exchange', id: s.pendingExchange.playerId }];
    return [];
}

function botAct(mod, room, kind, id, rng) {
    const s = room.gameState;
    const bot = player(room, id);
    const ctx = ctxOf(s);
    try {
        if (kind === 'action') {
            const c = mod.chooseAction(room, bot, rng);
            engine.submitAction(room, id, c.actionId, c.target ? c.target.playerId : null);
        } else if (kind === 'respond') {
            const c = mod.decideRespond(room, bot, rng) || { response: 'pass' };
            engine.submitResponse(room, id, c.response, c.claimCard || null, ctx);
        } else if (kind === 'block-respond') {
            const c = mod.decideBlockRespond(room, bot, rng) || { response: 'pass' };
            engine.submitResponse(room, id, c.response, null, ctx);
        } else if (kind === 'lose') {
            engine.submitInfluenceLoss(room, id, mod.chooseLoss(bot, room));
        } else if (kind === 'exchange') {
            const ex = s.pendingExchange;
            engine.submitExchange(room, id, mod.chooseKeep(bot, ex.options, ex.keepCount, room));
        }
    } catch (error) {
        fallback(room, kind, id);
    }
}

function fallback(room, kind, id) {
    const s = room.gameState;
    const p = player(room, id);
    try {
        if (kind === 'action') {
            const target = s.players.find(x => x.alive && x.playerId !== id);
            if (p.coins >= 7) engine.submitAction(room, id, 'coup', target.playerId);
            else engine.submitAction(room, id, 'income');
        } else if (kind === 'respond' || kind === 'block-respond') engine.submitResponse(room, id, 'pass', null, ctxOf(s));
        else if (kind === 'lose') engine.submitInfluenceLoss(room, id, p.influence[0]);
        else if (kind === 'exchange') engine.submitExchange(room, id, s.pendingExchange.options.slice(0, s.pendingExchange.keepCount));
    } catch (error) {
        engine.autoResolvePhase(room);
    }
}

/** จอมบลัฟ: อ้างการ์ดที่ไม่มีตลอด · ขวางทุกครั้งที่ขวางได้ · ไม่เคยท้าใคร */
function liarAct(room, kind, id, rng, stats) {
    const s = room.gameState;
    const me = player(room, id);
    const ctx = ctxOf(s);
    const opps = s.players.filter(p => p.alive && p.playerId !== id);
    const bluffed = card => { if (!me.influence.includes(card)) stats.bluffs += 1; };
    try {
        if (kind === 'action') {
            const richest = [...opps].sort((a, b) => b.coins - a.coins)[0];
            if (me.coins >= 7) return engine.submitAction(room, id, 'coup', richest.playerId);
            const roll = rng();
            if (me.coins >= 3 && roll < 0.3) { bluffed('assassin'); return engine.submitAction(room, id, 'assassinate', richest.playerId); }
            if (richest.coins >= 2 && roll < 0.55) { bluffed('captain'); return engine.submitAction(room, id, 'steal', richest.playerId); }
            bluffed('duke');
            return engine.submitAction(room, id, 'tax');
        }
        if (kind === 'respond') {
            const options = engine.getAvailableResponses(room, id);
            const card = (options?.blockOptions || [])[0]?.id;
            if (card) { bluffed(card); return engine.submitResponse(room, id, 'block', card, ctx); }
            return engine.submitResponse(room, id, 'pass', null, ctx);
        }
        if (kind === 'block-respond') return engine.submitResponse(room, id, 'pass', null, ctx);
        if (kind === 'lose') return engine.submitInfluenceLoss(room, id, me.influence[0]);
        if (kind === 'exchange') return engine.submitExchange(room, id, s.pendingExchange.options.slice(0, s.pendingExchange.keepCount));
    } catch (error) {
        fallback(room, kind, id);
    }
    return null;
}

function play(room, seatMod, rng, liarStats = null) {
    let loops = 0;
    let caughtSeen = 0;
    while (room.gameState.phase !== 'finished' && loops < 5000) {
        loops += 1;
        smart.observe(room);
        if (base !== smart && base.observe) base.observe(room);
        const todo = whoActs(room);
        if (!todo.length) { engine.autoResolvePhase(room); continue; }
        const { kind, id } = todo[0];
        if (seatMod[id] === 'liar') liarAct(room, kind, id, rng, liarStats);
        else botAct(seatMod[id], room, kind, id, rng);
        if (liarStats) {
            // นับการบลัฟที่โดนจับ (บันทึกเกม: ใครท้าจอมบลัฟแล้วชนะ)
            const caught = (room.gameState.history || []).filter(h => h.kind === 'challenge' && /แล้วชนะ/.test(h.text) && h.text.includes(' ท้า LIAR ')).length;
            if (caught > caughtSeen) { liarStats.caught += caught - caughtSeen; caughtSeen = caught; }
            if (caught < caughtSeen) caughtSeen = caught; // บันทึกเกมถูกตัดเหลือ 40 รายการ
        }
    }
    return room.gameState.winner && room.gameState.winner.playerId;
}

function mixedTables() {
    const rows = [];
    let totalShare = 0;
    for (let n = 2; n <= 6; n += 1) {
        let smartWins = 0;
        let smartSeats = 0;
        for (let g = 1; g <= GAMES; g += 1) {
            Math.random = mulberry32(g * 7919 + n * 104729);
            const rng = mulberry32(g * 31 + n);
            const ids = Array.from({ length: n }, (_, i) => `bot_${i}x${g}`);
            const room = makeRoom(ids);
            // ที่นั่งสลับกัน และสลับว่าใครได้ที่นั่งเกิน (โต๊ะคี่) ทุกเกม
            const seatMod = {};
            ids.forEach((id, i) => { seatMod[id] = (i + g) % 2 === 0 ? smart : base; });
            const seats = ids.filter(id => seatMod[id] === smart).length;
            smartSeats += seats / n;
            const winner = play(room, seatMod, rng);
            if (winner && seatMod[winner] === smart) smartWins += 1;
        }
        const winRate = smartWins / GAMES;
        const expected = smartSeats / GAMES;
        totalShare += winRate / expected;
        rows.push({ players: n, games: GAMES, 'smart win %': (100 * winRate).toFixed(1), 'fair share %': (100 * expected).toFixed(1), 'smart / fair': (winRate / expected).toFixed(2) });
    }
    Math.random = realRandom;
    console.log(`\n1) โต๊ะผสม: บอทเวอร์ชันนี้ vs ${process.env.BASE ? path.basename(process.env.BASE) : 'ตัวเอง'} (ค่า > 1 = ชนะมากกว่าส่วนแบ่ง)`);
    console.table(rows);
    console.log(`   เฉลี่ย smart/fair = ${(totalShare / 5).toFixed(2)}`);
}

function liarTables(mod, label) {
    const rows = [];
    const all = { bluffs: 0, caught: 0, wins: 0, games: 0 };
    for (let n = 2; n <= 6; n += 1) {
        const stats = { bluffs: 0, caught: 0 };
        let wins = 0;
        for (let g = 1; g <= GAMES; g += 1) {
            Math.random = mulberry32(g * 4241 + n * 7);
            const rng = mulberry32(g * 97 + n * 3);
            const ids = ['LIAR', ...Array.from({ length: n - 1 }, (_, i) => `bot_${i}y${g}`)];
            const room = makeRoom(ids);
            room.gameState.players[0].name = 'LIAR';
            const seatMod = { LIAR: 'liar' };
            ids.slice(1).forEach(id => { seatMod[id] = mod; });
            if (play(room, seatMod, rng, stats) === 'LIAR') wins += 1;
        }
        all.bluffs += stats.bluffs;
        all.caught += stats.caught;
        all.wins += wins;
        all.games += GAMES;
        rows.push({ players: n, games: GAMES, 'liar bluffs': stats.bluffs, 'caught %': (100 * stats.caught / Math.max(1, stats.bluffs)).toFixed(1), 'liar win %': (100 * wins / GAMES).toFixed(1), 'fair share %': (100 / n).toFixed(1) });
    }
    Math.random = realRandom;
    console.log(`\n2) จอมบลัฟ vs ${label}`);
    console.table(rows);
    console.log(`   รวม: จับได้ ${(100 * all.caught / Math.max(1, all.bluffs)).toFixed(1)}% ของการบลัฟ · จอมบลัฟชนะ ${(100 * all.wins / all.games).toFixed(1)}%`);
}

(function main() {
    mixedTables();
    liarTables(smart, 'บอทเวอร์ชันนี้');
    if (base !== smart) liarTables(base, path.basename(process.env.BASE));
})();
