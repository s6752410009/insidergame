/**
 * บอท Coup ระดับ engine — สุ่มเล่นจนจบหลาย seed (ไม่ต้องมีเซิร์ฟเวอร์)
 *
 *  A) บอทล้วน 2–6 คน: ห้ามพึ่งนาฬิกาหมดเวลาเลยสักครั้ง (บอทต้องเดินเกมเองทั้งหมด)
 *  B) คน 1 + บอท: คนกดสุ่มทุกอย่างที่กติกาอนุญาต
 *  C) คน 1 + บอท: คนไม่กดอะไรเลย (หมดเวลาทุกครั้ง) — เกมต้องจบได้
 * ทุกเกม: ไม่มี exception · การ์ดรวม 15 ใบตลอด · เหรียญไม่ติดลบ · ผู้ชนะเป็นคนที่รอดจริง
 * และบอทตัดสินใจจากข้อมูลที่ตัวเองเห็นเท่านั้น (เทสปิดตา: สลับการ์ดคว่ำของคนอื่นแล้วการตัดสินใจต้องเหมือนเดิม)
 * ความฉลาด: จำรายคู่แข่ง (พิสูจน์จริง/โดนจับโกหก/อ้างเกินมือ) · บลัฟตามบุคลิกเดิม · เล็งผู้นำ · ช่วงท้ายตัวต่อตัว
 *
 * รัน: node scripts/smoke-coup-bots-engine.js   (SEEDS=300 เพื่อเพิ่มรอบ)
 */
const engine = require('../games/coupEngine');
const bots = require('../games/coupBots');

let checks = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg); checks += 1; }

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

function makeRoom(count, humanCount) {
    const players = Array.from({ length: count }, (_, i) => {
        const human = i < humanCount;
        const playerId = human ? `human${i}` : `bot_${i}xyz${i}`;
        return { playerId, playerName: human ? `คน${i}` : `บอท${i}`, color: '#fff', avatar: '🤖', permission: i === 0 ? 'admin' : null, socketId: `s${i}` };
    });
    const room = { roomId: 'botsim', name: 'CoupBots', players, settings: { gameMode: 'coup' }, gameState: engine.createInitialState() };
    engine.startGame(room);
    return room;
}

function checkInvariants(room, label) {
    const s = room.gameState;
    let cards = s.deck.length;
    s.players.forEach(p => {
        cards += p.influence.length + p.revealed.length;
        assert(p.coins >= 0, `${label}: เหรียญติดลบ ${p.name}`);
        if (!p.alive) assert(p.influence.length === 0, `${label}: คนตกรอบยังถือการ์ด`);
        if (p.alive && !(s.pendingExchange && s.pendingExchange.playerId === p.playerId)) {
            assert(p.influence.length > 0, `${label}: คนรอดไม่มีการ์ด ${p.name}`);
        }
    });
    if (s.pendingExchange) cards += s.pendingExchange.options.length;
    assert(cards === 15, `${label}: การ์ดรวม ${cards} ไม่ใช่ 15`);
}

/** ใครที่เป็นคนจริงต้องตัดสินใจตอนนี้ */
function humanPending(room) {
    const s = room.gameState;
    const humans = s.players.filter(p => !bots.isBotId(p.playerId));
    if (s.phase === 'action') return humans.filter(p => p.playerId === s.currentPlayerId && p.alive).map(p => ({ kind: 'action', p }));
    if (s.phase === 'respond') return engine.getPendingResponders(room).filter(id => !bots.isBotId(id)).map(id => ({ kind: 'respond', p: humans.find(h => h.playerId === id) }));
    if (s.phase === 'block-respond') return engine.getPendingBlockResponders(room).filter(id => !bots.isBotId(id)).map(id => ({ kind: 'block', p: humans.find(h => h.playerId === id) }));
    if (s.phase === 'lose-influence' && s.pendingLoss && !bots.isBotId(s.pendingLoss.playerId)) return [{ kind: 'lose', p: humans.find(h => h.playerId === s.pendingLoss.playerId) }];
    if (s.phase === 'exchange' && s.pendingExchange && !bots.isBotId(s.pendingExchange.playerId)) return [{ kind: 'exchange', p: humans.find(h => h.playerId === s.pendingExchange.playerId) }];
    return [];
}

function pick(rng, list) { return list[Math.floor(rng() * list.length)]; }

function humanAct(room, item, rng) {
    const s = room.gameState;
    const id = item.p.playerId;
    if (item.kind === 'action') {
        const actions = engine.getAvailableActions(room, id);
        const action = pick(rng, actions);
        const targets = s.players.filter(p => p.alive && p.playerId !== id);
        engine.submitAction(room, id, action.id, action.needsTarget ? pick(rng, targets).playerId : null);
    } else if (item.kind === 'respond') {
        const options = engine.getAvailableResponses(room, id);
        const choices = ['pass', 'pass'];
        if (options.canChallenge) choices.push('challenge');
        options.blockOptions.forEach(b => choices.push('block:' + b.id));
        const choice = pick(rng, choices);
        if (choice.startsWith('block:')) engine.submitResponse(room, id, 'block', choice.slice(6));
        else engine.submitResponse(room, id, choice);
    } else if (item.kind === 'block') {
        engine.submitResponse(room, id, rng() < 0.3 ? 'challenge' : 'pass');
    } else if (item.kind === 'lose') {
        engine.submitInfluenceLoss(room, id, pick(rng, item.p.influence));
    } else if (item.kind === 'exchange') {
        const opts = [...s.pendingExchange.options].sort(() => rng() - 0.5);
        engine.submitExchange(room, id, opts.slice(0, s.pendingExchange.keepCount));
    }
}

function timeout(room) {
    room.gameState.phaseEndsAt = Date.now() - 1;
    engine.autoResolvePhase(room);
}

const tally = { games: 0, turns: 0, timeouts: 0, challenges: 0, blocks: 0, coups: 0, assassinations: 0, botWins: 0, humanWins: 0, maxTurns: 0 };

function playGame(seed, count, humanMode) {
    const rng = mulberry32(seed * 7919 + count);
    Math.random = mulberry32(seed * 104729 + count * 31 + (humanMode === 'none' ? 1 : humanMode === 'random' ? 2 : 3));
    const humanCount = humanMode === 'none' ? 0 : 1;
    const room = makeRoom(count, humanCount);
    const label = `seed ${seed} · ${count} คน · คน=${humanMode}`;
    let timeouts = 0;
    let loops = 0;
    while (room.gameState.phase !== 'finished') {
        loops += 1;
        assert(loops < 4000, `${label}: เกมไม่จบใน 4000 จังหวะ (ค้าง) phase=${room.gameState.phase}`);
        checkInvariants(room, label);
        const human = humanPending(room);
        const botChanged = bots.playBotTurns(room, { force: true, rng });
        if (botChanged) continue;
        if (human.length) {
            if (humanMode === 'random') humanAct(room, human[0], rng);
            else { timeout(room); timeouts += 1; }
            continue;
        }
        // ไม่มีคนต้องตัดสินใจ แต่บอทก็ไม่ทำอะไร = บอททำเกมค้าง
        throw new Error(`${label}: บอทไม่ขยับทั้งที่ไม่มีคนต้องตัดสินใจ phase=${room.gameState.phase} pending=${JSON.stringify(bots.pendingBotDecisions(room))}`);
    }
    checkInvariants(room, label);
    const s = room.gameState;
    const alive = s.players.filter(p => p.alive);
    assert(alive.length === 1, `${label}: ต้องเหลือผู้รอด 1 คน (${alive.length})`);
    assert(s.winner && s.winner.playerId === alive[0].playerId, `${label}: ผู้ชนะไม่ตรงกับผู้รอด`);
    if (humanMode === 'none') assert(timeouts === 0, `${label}: บอทล้วนต้องไม่ต้องรอหมดเวลา (${timeouts})`);
    tally.games += 1;
    tally.turns += s.turnNumber;
    tally.maxTurns = Math.max(tally.maxTurns, s.turnNumber);
    tally.timeouts += timeouts;
    s.history.forEach(h => {
        if (h.kind === 'challenge') tally.challenges += 1;
        if (h.kind === 'block') tally.blocks += 1;
        if (h.kind === 'coup') tally.coups += 1;
        if (h.kind === 'assassinate') tally.assassinations += 1;
    });
    if (bots.isBotId(s.winner.playerId)) tally.botWins += 1; else tally.humanWins += 1;
}

/** บอทต้องไม่แอบดูการ์ดคว่ำคนอื่น: สลับการ์ดคว่ำของฝ่ายตรงข้ามแล้วการตัดสินใจต้องเหมือนเดิม */
function blindfoldTest(seeds) {
    let compared = 0;
    for (let seed = 1; seed <= seeds; seed += 1) {
        Math.random = mulberry32(seed);
        const room = makeRoom(4, 0);
        for (let step = 0; step < 60 && room.gameState.phase !== 'finished'; step += 1) {
            const decisions = bots.pendingBotDecisions(room);
            if (decisions.length) {
                const botId = decisions[0].botId;
                const bot = room.gameState.players.find(p => p.playerId === botId);
                const kind = decisions[0].kind;
                const decide = () => {
                    const r = mulberry32(seed * 13 + step);
                    if (kind === 'action') { const c = bots.chooseAction(room, bot, r); return JSON.stringify({ a: c.actionId, t: c.target && c.target.playerId }); }
                    if (kind === 'respond') return JSON.stringify(bots.decideRespond(room, bot, r));
                    if (kind === 'block-respond') return JSON.stringify(bots.decideBlockRespond(room, bot, r));
                    return null;
                };
                const before = decide();
                if (before) {
                    const saved = room.gameState.players.map(p => [...p.influence]);
                    const savedDeck = [...room.gameState.deck];
                    room.gameState.players.forEach(p => {
                        if (p.playerId !== botId && p.influence.length) p.influence = p.influence.map((_, i) => ['duke', 'contessa', 'ambassador'][(i + step) % 3]);
                    });
                    room.gameState.deck = room.gameState.deck.map(() => 'assassin');
                    const after = decide();
                    room.gameState.players.forEach((p, i) => { p.influence = saved[i]; });
                    room.gameState.deck = savedDeck;
                    assert(before === after, `seed ${seed}: บอทตัดสินใจเปลี่ยนเมื่อการ์ดคว่ำคนอื่นเปลี่ยน (${before} → ${after})`);
                    compared += 1;
                }
            }
            if (!bots.playBotTurns(room, { force: true, rng: mulberry32(seed + step) })) break;
        }
    }
    return compared;
}

function targetedChecks() {
    Math.random = mulberry32(42);
    // ประกาศดยุคทั้งที่หงายดยุคไปแล้ว 2 ใบ + บอทถือใบที่ 3 → โกหกแน่นอน ต้องท้า
    const room = makeRoom(3, 1);
    const s = room.gameState;
    const [human, botA, botB] = s.players;
    human.influence = ['captain', 'contessa'];
    botA.influence = ['duke', 'assassin'];
    botB.influence = ['captain'];
    botB.revealed = ['duke'];
    human.revealed = [];
    s.deck = ['duke', 'assassin', 'assassin', 'ambassador', 'ambassador', 'ambassador', 'contessa', 'contessa', 'captain'];
    // ไม่ให้ใบที่หงายรวมแล้วเกิน 15 — ปรับ: duke หงาย 1 (botB) + ถือ 1 (botA) + ในกอง 1
    engine.submitAction(room, human.playerId, 'tax');
    assert(bots.unseenCount(room, botA, 'duke') === 1, 'นับดยุคที่มองไม่เห็นผิด');
    // ทำให้เหลือ 0: หงายดยุคใบในกองไปที่ botB (สมมติ)
    s.deck.splice(s.deck.indexOf('duke'), 1);
    botB.revealed.push('duke');
    assert(bots.unseenCount(room, botA, 'duke') === 0, 'ดยุคครบ 3 ใบแล้วต้องเหลือ 0');
    assert(bots.challengeChance(room, botA, human.playerId, 'duke') === 1, 'โกหกแน่นอนต้องท้า 100%');
    const res = bots.decideRespond(room, botA, () => 0.99);
    assert(res.response === 'challenge', 'บอทต้องท้าเมื่อโกหกแน่นอน: ' + JSON.stringify(res));

    // โดนลอบสังหาร + ถือท่านหญิง → ขวางเสมอ
    Math.random = mulberry32(43);
    const r2 = makeRoom(3, 1);
    const [h2, b2] = r2.gameState.players;
    h2.coins = 5;
    b2.influence = ['contessa', 'duke'];
    engine.submitAction(r2, h2.playerId, 'assassinate', b2.playerId);
    const block = bots.decideRespond(r2, b2, () => 0.99);
    assert(block.response === 'block' && block.claimCard === 'contessa', 'ถือท่านหญิงต้องขวางลอบสังหาร: ' + JSON.stringify(block));

    // 10 เหรียญ = รัฐประหารเสมอ
    Math.random = mulberry32(44);
    const r3 = makeRoom(3, 0);
    const actor = r3.gameState.players.find(p => p.playerId === r3.gameState.currentPlayerId);
    actor.coins = 10;
    for (let i = 0; i < 30; i += 1) assert(bots.chooseAction(r3, actor, mulberry32(i)).actionId === 'coup', '10 เหรียญต้องรัฐประหาร');
    actor.coins = 7;
    const coups = Array.from({ length: 50 }, (_, i) => bots.chooseAction(r3, actor, mulberry32(i)).actionId).filter(a => a === 'coup').length;
    assert(coups >= 35, `7 เหรียญควรรัฐประหารเกือบทุกครั้ง (${coups}/50)`);

    // หงายการ์ดค่าต่ำสุด · แลกเก็บใบดีและไม่ซ้ำ
    assert(bots.chooseLoss({ influence: ['duke', 'ambassador'], coins: 2 }) === 'ambassador', 'ต้องทิ้งทูตก่อนดยุค');
    const keep = bots.chooseKeep({ coins: 2 }, ['duke', 'duke', 'ambassador', 'captain'], 2);
    assert(keep.includes('duke') && keep.includes('captain'), 'แลกต้องเก็บดยุค+กัปตัน: ' + keep);

    // จังหวะ: บอทตอบก่อนหน้าต่างปิด และไม่ตอบทันทีที่เปิด
    Math.random = mulberry32(45);
    const r4 = makeRoom(4, 1);
    const h4 = r4.gameState.players[0];
    r4.gameState.currentPlayerId = h4.playerId;
    engine.submitAction(r4, h4.playerId, 'tax');
    const decisions = bots.pendingBotDecisions(r4);
    assert(decisions.length === 3, 'บอท 3 ตัวต้องรอตอบ');
    decisions.forEach(d => {
        assert(d.dueAt < r4.gameState.phaseEndsAt, 'บอทต้องตอบก่อนหน้าต่างปิด');
        assert(d.dueAt >= r4.gameState.phaseEndsAt - r4.gameState.phaseMs + 1000, 'บอทต้องคิดสักพักก่อนตอบ');
    });
    assert(!bots.playBotTurns(r4, { now: Date.now() }), 'ยังไม่ถึงเวลา บอทต้องยังไม่ตอบ');
}

/** เติมบันทึกเกม (ข้อความเดียวกับที่ engine เขียน) แล้วให้บอทอ่าน */
let fakeClock = 0;
function say(room, text, kind = null) {
    fakeClock += 1;
    room.gameState.history = [{ icon: '·', text, kind, at: `t${fakeClock}`, turn: room.gameState.turnNumber }, ...room.gameState.history].slice(0, 40);
    bots.observe(room);
}
const cardTh = id => engine.CARD_DEFINITIONS[id].thaiName;

function smartChecks() {
    // A) ความจำรายคู่แข่ง: พิสูจน์ว่าพูดจริงมาตลอด = ไม่ค่อยท้า · โดนจับโกหกบ่อย = ท้าบ่อย
    const duel = setup => {
        Math.random = mulberry32(77);
        const room = makeRoom(2, 1);
        const [human, bot] = room.gameState.players;
        human.influence = ['captain', 'contessa'];
        bot.influence = ['assassin', 'ambassador'];
        room.gameState.currentPlayerId = human.playerId;
        setup(room, human, bot);
        say(room, `${human.name} ประกาศ เก็บภาษี`);
        engine.submitAction(room, human.playerId, 'tax');
        const p = bots.challengeChance(room, bot, human.playerId, 'duke');
        let challenges = 0;
        for (let i = 0; i < 40; i += 1) if (bots.decideRespond(room, bot, mulberry32(500 + i)).response === 'challenge') challenges += 1;
        return { p, challenges };
    };
    const fresh = duel(() => {});
    const honest = duel((room, h, b) => {
        for (let i = 0; i < 2; i += 1) {
            say(room, `${h.name} ประกาศ เก็บภาษี`);
            say(room, `${b.name} ท้า ${h.name} แล้วแพ้ — ${h.name} มี ${cardTh('duke')} จริง`, 'challenge');
        }
    });
    const liar = duel((room, h, b) => {
        for (let i = 0; i < 2; i += 1) {
            say(room, `${h.name} ประกาศ เก็บภาษี`);
            say(room, `${b.name} ท้า ${h.name} แล้วชนะ — ไม่มี ${cardTh('duke')} จริง`, 'challenge');
        }
    });
    assert(honest.p < fresh.p && fresh.p < liar.p, `โอกาสโกหกต้องเรียง พิสูจน์แล้ว < ใหม่ < โกหกประจำ (${honest.p.toFixed(2)} / ${fresh.p.toFixed(2)} / ${liar.p.toFixed(2)})`);
    assert(liar.challenges >= 30, `คนโกหกประจำต้องโดนท้าเกือบทุกครั้ง (${liar.challenges}/40)`);
    assert(honest.challenges <= 6, `คนที่พิสูจน์ว่าพูดจริงต้องไม่ค่อยโดนท้า (${honest.challenges}/40)`);

    // B) อ้างการ์ดหลายแบบเกินมือ (มี 2 ใบ อ้าง 4 แบบ) — อย่างน้อยครึ่งต้องโกหก
    {
        Math.random = mulberry32(78);
        const room = makeRoom(3, 1);
        const [human, bot] = room.gameState.players;
        say(room, `${human.name} ประกาศ เก็บภาษี`);
        say(room, `${human.name} ประกาศ ขโมย ใส่ ${bot.name}`);
        say(room, `${human.name} ประกาศ ลอบสังหาร ใส่ ${bot.name}`);
        say(room, `${human.name} ขวางด้วย ${cardTh('contessa')}`, 'block');
        assert(bots.pHolds(room, bot, human, 'duke') <= 0.45, 'อ้าง 4 แบบทั้งที่มี 2 ใบ ต้องไม่เชื่อว่าถือดยุค: ' + bots.pHolds(room, bot, human, 'duke').toFixed(2));
        say(room, `${human.name} แลกเปลี่ยนการ์ดกับกองกลาง`);
        assert(bots.pHolds(room, bot, human, 'duke') < 0.45, 'แลกการ์ดแล้ว คำอ้างเก่าไม่ช่วยให้น่าเชื่อขึ้น');
    }

    // C) บุคลิกเดิม: เคยบลัฟดยุคไว้ → บลัฟต่อก็บลัฟดยุค ไม่สุ่มการ์ดใหม่
    {
        Math.random = mulberry32(79);
        const room = makeRoom(3, 0);
        const bot = room.gameState.players.find(p => p.playerId === room.gameState.currentPlayerId);
        bot.influence = ['contessa', 'contessa'];
        bot.coins = 3;
        say(room, `${bot.name} ประกาศ เก็บภาษี`);
        say(room, `${bot.name} ประกาศ เก็บภาษี`);
        const counts = {};
        for (let i = 0; i < 80; i += 1) {
            const c = bots.chooseAction(room, bot, mulberry32(900 + i));
            counts[c.actionId] = (counts[c.actionId] || 0) + 1;
        }
        const bluffs = (counts.tax || 0) + (counts.steal || 0) + (counts.assassinate || 0) + (counts.exchange || 0);
        assert(bluffs === 0 || (counts.tax || 0) / bluffs >= 0.7, 'บลัฟต้องตรงกับการ์ดที่เคยอ้าง (ดยุค): ' + JSON.stringify(counts));
    }

    // D) เลือกเป้าเป็นผู้นำ (เหรียญเยอะ การ์ดครบ อ้างนักฆ่า) ไม่ใช่คนที่แทบไม่มีพิษภัย
    {
        Math.random = mulberry32(80);
        const room = makeRoom(4, 0);
        const s = room.gameState;
        const bot = s.players.find(p => p.playerId === s.currentPlayerId);
        const [leader, weak1, weak2] = s.players.filter(p => p !== bot);
        bot.coins = 7;
        leader.coins = 6;
        weak1.coins = 1; weak1.revealed = [weak1.influence.pop()];
        weak2.coins = 1;
        say(room, `${leader.name} ประกาศ ลอบสังหาร ใส่ ${weak2.name}`);
        let hits = 0;
        for (let i = 0; i < 40; i += 1) {
            const c = bots.chooseAction(room, bot, mulberry32(1300 + i));
            if (c.actionId === 'coup' && c.target.playerId === leader.playerId) hits += 1;
        }
        assert(hits >= 28, `7 เหรียญต้องรัฐประหารผู้นำเป็นส่วนใหญ่ (${hits}/40)`);
    }

    // E) ตัวต่อตัวช่วงท้าย: คู่แข่ง 8 เหรียญ (ตาหน้ารัฐประหารได้) เราเหลือใบเดียว ถือกัปตัน → ขโมยตัดเหรียญ
    {
        Math.random = mulberry32(81);
        const room = makeRoom(2, 0);
        const s = room.gameState;
        const bot = s.players.find(p => p.playerId === s.currentPlayerId);
        const opp = s.players.find(p => p !== bot);
        bot.revealed = [bot.influence.pop()];
        bot.influence = ['captain'];
        bot.coins = 2;
        opp.coins = 8;
        let steals = 0;
        for (let i = 0; i < 40; i += 1) if (bots.chooseAction(room, bot, mulberry32(1500 + i)).actionId === 'steal') steals += 1;
        assert(steals >= 30, `ต้องขโมยตัดเหรียญคู่แข่งก่อนโดนรัฐประหาร (${steals}/40)`);
        // คู่แข่งเหลือใบเดียว เรามี 3 เหรียญ + นักฆ่าจริง → ลอบสังหารปิดเกม
        bot.influence = ['assassin'];
        bot.coins = 3;
        opp.coins = 2;
        opp.revealed = [opp.influence.pop()];
        let kills = 0;
        for (let i = 0; i < 40; i += 1) if (bots.chooseAction(room, bot, mulberry32(1600 + i)).actionId === 'assassinate') kills += 1;
        assert(kills >= 30, `คู่แข่งเหลือใบเดียว ถือนักฆ่า 3 เหรียญ ต้องลอบสังหาร (${kills}/40)`);
    }
}

(function main() {
    const seeds = Number(process.env.SEEDS) || 120;
    targetedChecks();
    smartChecks();
    for (let seed = 1; seed <= seeds; seed += 1) {
        for (let count = 2; count <= 6; count += 1) {
            playGame(seed, count, 'none');
            playGame(seed, count, 'random');
            if (seed % 3 === 0) playGame(seed, count, 'idle');
        }
    }
    const compared = blindfoldTest(40);
    Math.random = realRandom;
    console.log(`coup bots: ${tally.games} เกมจบครบ (บอทล้วน/คนสุ่ม/คนไม่กด · 2–6 คน · ${seeds} seed)`);
    console.log(`  เฉลี่ย ${(tally.turns / tally.games).toFixed(1)} ตา (สูงสุด ${tally.maxTurns}) · ท้า ${tally.challenges} · ขวาง ${tally.blocks} · รัฐประหาร ${tally.coups} · ลอบสังหาร ${tally.assassinations}`);
    console.log(`  บอทชนะ ${tally.botWins} · คนชนะ ${tally.humanWins} · หมดเวลาของคน ${tally.timeouts} · เทสปิดตา ${compared} จุด`);
    console.log(`✅ smoke:coup:bots:engine ผ่าน ${checks} checks`);
})();
