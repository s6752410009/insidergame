/**
 * บอท Coup — ตัดสินใจจากข้อมูลที่ "ผู้เล่นคนนั้น" เห็นได้จริงเท่านั้น
 *   การ์ดคว่ำของตัวเอง + การ์ดที่หงายแล้วของทุกคน + การประกาศ/ขวางที่ทุกคนเห็น
 * ไม่แอบดูการ์ดคว่ำของคนอื่น และไม่แอบดูกองจั่ว
 *
 * ทุกคำสั่งเดินผ่าน engine.submit* ตัวเดียวกับคนกด จึงถูกกติกาเสมอ
 * ถ้าคำสั่งที่เลือกโดนปฏิเสธ (กันพลาด) จะถอยไปทางที่ปลอดภัย (ผ่าน / รับรายได้ / หงายใบแรก)
 * และถ้าพังหมดจริงๆ นาฬิกาของเฟส (autoResolvePhase) ยังพาเกมเดินต่อเหมือนคนหลุด
 *
 * จังหวะ: บอทแต่ละตัวมีเวลา "คิด" ของตัวเองนับจากต้นเฟส (phaseEndsAt - phaseMs)
 * ตอบก่อนหน้าต่างท้า/ขวางปิดเสมอ · COUP_BOT_MS ใช้เร่งเทส
 */

const engine = require('./coupEngine');

const { CARD_DEFINITIONS, ACTIONS, FORCED_COUP_AT } = engine;
const CARD_IDS = Object.keys(CARD_DEFINITIONS);
const COPIES_PER_CARD = 3;
const ENV_BOT_MS = Number(process.env.COUP_BOT_MS) || 0;
// เกมเพิ่งเริ่ม: คนจริงยังโหลดหน้ากระดานไม่เสร็จ — บอทตาแรกรอเพิ่ม
const FIRST_TURN_EXTRA_MS = ENV_BOT_MS ? 0 : 2500;

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function getPlayer(room, playerId) {
    return (room?.gameState?.players || []).find(p => p.playerId === playerId) || null;
}

function aliveOpponents(room, botId) {
    return room.gameState.players.filter(p => p.alive && p.playerId !== botId);
}

/** เลขสุ่มคงที่ต่อ (บอท, เฟส) — เวลาคิดไม่กระโดดทุกครั้งที่ตั้งนาฬิกาใหม่ */
function hashOf(text) {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

// ---------- ความจำสาธารณะ (การประกาศที่ทุกคนเห็น) ----------

function memory(state) {
    if (!state.botMemory || typeof state.botMemory !== 'object') {
        state.botMemory = { claims: {}, seenSteps: {} };
    }
    if (!state.botMemory.claims) state.botMemory.claims = {};
    if (!state.botMemory.seenSteps) state.botMemory.seenSteps = {};
    return state.botMemory;
}

/**
 * จดว่าใครเคยอ้างการ์ดอะไร (จากแอ็กชัน/การขวางที่ประกาศต่อหน้าทุกคน)
 * เรียกทุกครั้งที่ state ถูกส่งออก — เป็นข้อมูลสาธารณะล้วน ไม่ได้ส่งให้ client
 */
function observe(room) {
    const state = room?.gameState;
    if (!state || state.mode !== 'coup' || state.status !== 'playing') return;
    const mem = memory(state);
    const note = (playerId, card, key) => {
        if (!playerId || !card || mem.seenSteps[key]) return;
        mem.seenSteps[key] = true;
        const claims = mem.claims[playerId] || (mem.claims[playerId] = {});
        claims[card] = (claims[card] || 0) + 1;
    };
    const pending = state.pendingAction;
    if (pending && pending.claim) note(pending.actorId, pending.claim, `a:${state.turnNumber}:${pending.actorId}`);
    const block = state.pendingBlock;
    if (block && block.claim) note(block.blockerId, block.claim, `b:${state.turnNumber}:${block.blockerId}`);
    // กันโตไม่หยุด: เก็บแค่ key ของไม่กี่ตาล่าสุด
    const keys = Object.keys(mem.seenSteps);
    if (keys.length > 60) {
        keys.slice(0, keys.length - 30).forEach(key => { delete mem.seenSteps[key]; });
    }
}

function claimsOf(room, playerId) {
    return memory(room.gameState).claims[playerId] || {};
}

/** การ์ดใบนี้ "ยังมองไม่เห็น" กี่ใบ จากมุมของบอท (3 - ที่หงายแล้ว - ที่อยู่ในมือตัวเอง) */
function unseenCount(room, bot, card) {
    let seen = 0;
    room.gameState.players.forEach(player => {
        seen += player.revealed.filter(id => id === card).length;
    });
    seen += bot.influence.filter(id => id === card).length;
    return Math.max(0, COPIES_PER_CARD - seen);
}

function cardValue(card, bot) {
    switch (card) {
        case 'duke': return 5;
        case 'assassin': return bot && bot.coins >= 3 ? 4.6 : 4;
        case 'captain': return 4.2;
        case 'contessa': return 3.6;
        case 'ambassador': return 2.6;
        default: return 1;
    }
}

function threatScore(room, player, rng) {
    const claims = claimsOf(room, player.playerId);
    return player.influence.length * 3
        + player.coins * 0.45
        + (claims.assassin ? 0.8 : 0)
        + (claims.duke ? 0.5 : 0)
        + rng() * 1.6;
}

function pickTarget(room, bot, rng, scorer) {
    const candidates = aliveOpponents(room, bot.playerId);
    if (!candidates.length) return null;
    return candidates
        .map(player => ({ player, score: scorer(player) }))
        .sort((a, b) => b.score - a.score)[0].player;
}

// ---------- ตาของบอท: เลือกแอ็กชัน ----------

function chooseAction(room, bot, rng) {
    const coins = bot.coins;
    const hand = bot.influence;
    const has = card => hand.includes(card);
    const lastCard = hand.length === 1;
    // บลัฟน้อยลงตอนเหลือการ์ดใบเดียว (โดนท้าทีเดียวตกรอบ)
    const bluffScale = lastCard ? 0.45 : 1;
    const canBluff = card => unseenCount(room, bot, card) > 0;
    const coupTarget = () => pickTarget(room, bot, rng, p => threatScore(room, p, rng));

    if (coins >= FORCED_COUP_AT) return { actionId: 'coup', target: coupTarget() };
    if (coins >= 7 && rng() < 0.9) return { actionId: 'coup', target: coupTarget() };

    const opponents = aliveOpponents(room, bot.playerId);

    // ลอบสังหาร (จริง หรือบลัฟบ้าง)
    if (coins >= 3 && (has('assassin') ? rng() < 0.75 : (canBluff('assassin') && rng() < 0.1 * bluffScale))) {
        const target = pickTarget(room, bot, rng, p => threatScore(room, p, rng) - (claimsOf(room, p.playerId).contessa ? 3 : 0));
        if (target) return { actionId: 'assassinate', target };
    }

    // ขโมย — เลือกคนที่มีเหรียญ และไม่เคยอ้างกัปตัน/ทูต (ขวางได้)
    const stealable = opponents.filter(p => p.coins >= 2);
    if (stealable.length && (has('captain') ? rng() < 0.55 : (canBluff('captain') && rng() < 0.12 * bluffScale))) {
        const target = stealable
            .map(p => {
                const claims = claimsOf(room, p.playerId);
                return { p, score: p.coins - (claims.captain ? 2 : 0) - (claims.ambassador ? 2 : 0) + rng() };
            })
            .sort((a, b) => b.score - a.score)[0].p;
        return { actionId: 'steal', target };
    }

    // เก็บภาษี — ทางหลักของคนมีดยุค · บลัฟบ่อยสุดเพราะไม่มีใครขวางได้
    if (has('duke') ? rng() < 0.9 : (canBluff('duke') && rng() < 0.28 * bluffScale)) {
        return { actionId: 'tax' };
    }

    // แลกการ์ด — มือไม่ค่อยดี (ไม่มีการ์ดทำเงิน/โจมตี)
    const weakHand = !hand.some(card => card === 'duke' || card === 'captain' || card === 'assassin');
    if (weakHand && (has('ambassador') ? rng() < 0.6 : (canBluff('ambassador') && rng() < 0.08 * bluffScale))) {
        return { actionId: 'exchange' };
    }

    // ที่เหลือ: เงินช่วยเหลือ (เสี่ยงโดนดยุคขวาง) หรือรับรายได้
    const dukeClaimers = opponents.filter(p => claimsOf(room, p.playerId).duke).length;
    const aidChance = dukeClaimers ? 0.3 : 0.65;
    return { actionId: rng() < aidChance ? 'foreign_aid' : 'income' };
}

// ---------- ช่วงตอบโต้ ----------

/**
 * โอกาสท้า: ยิ่งการ์ดใบนั้น "มองไม่เห็น" น้อย ยิ่งน่าจะโกหก
 * ถ้าหงาย/อยู่ในมือเราครบ 3 ใบแล้ว = โกหกแน่นอน ท้าเลย
 */
function challengeChance(room, bot, claimerId, card, stakes = 0) {
    const unseen = unseenCount(room, bot, card);
    if (unseen <= 0) return 1;
    let chance = unseen === 1 ? 0.3 : (unseen === 2 ? 0.1 : 0.05);
    const claims = claimsOf(room, claimerId);
    const otherClaims = Object.keys(claims).filter(id => id !== card).length;
    if (otherClaims >= 2) chance += 0.12;          // อ้างมาหลายตัวละครเกินไป
    if ((claims[card] || 0) >= 2) chance *= 0.6;   // อ้างตัวเดิมมาตลอด ดูน่าเชื่อ
    chance += stakes;
    if (bot.influence.length === 1 && stakes < 0.3) chance *= 0.4; // เหลือใบเดียว ท้าพลาด = ตกรอบ
    return Math.max(0, Math.min(0.85, chance));
}

function decideRespond(room, bot, rng) {
    const state = room.gameState;
    const pending = state.pendingAction;
    const options = engine.getAvailableResponses(room, bot.playerId);
    if (!pending || !options) return null;
    const action = ACTIONS[pending.actionId];
    const actor = getPlayer(room, pending.actorId);
    const targeted = pending.targetId === bot.playerId;
    const has = card => bot.influence.includes(card);
    const lastCard = bot.influence.length === 1;
    const blockIds = (options.blockOptions || []).map(option => option.id);
    const realBlock = blockIds.find(card => has(card));
    const bluffBlockCard = blockIds.find(card => unseenCount(room, bot, card) > 0) || null;

    // 1) ขวางด้วยการ์ดที่ถือจริง
    if (realBlock) {
        if (pending.actionId !== 'foreign_aid' || rng() < 0.75) return { response: 'block', claimCard: realBlock };
    }

    // 2) ท้า (ไม่มีในหน้าต่าง "ขวางได้อย่างเดียว")
    if (options.canChallenge && action.claim) {
        let stakes = 0;
        if (targeted && pending.actionId === 'assassinate') stakes = lastCard ? 0.35 : 0.15;
        else if (targeted && pending.actionId === 'steal') stakes = 0.08;
        else if (pending.actionId === 'tax' && actor && actor.coins >= 4) stakes = 0.05;
        else if (pending.actionId === 'exchange') stakes = -0.04;
        else if (!targeted && pending.targetId) stakes = -0.03;
        if (rng() < challengeChance(room, bot, pending.actorId, action.claim, stakes)) {
            return { response: 'challenge' };
        }
    }

    // 3) บลัฟขวาง — โดนลอบสังหารใบสุดท้ายแล้ว ยังไงก็ต้องลองดิ้น
    if (bluffBlockCard) {
        let bluff = 0;
        if (targeted && pending.actionId === 'assassinate') bluff = lastCard ? 0.75 : 0.2;
        else if (targeted && pending.actionId === 'steal') bluff = 0.12;
        else if (pending.actionId === 'foreign_aid') bluff = lastCard ? 0 : 0.05;
        if (rng() < bluff) return { response: 'block', claimCard: bluffBlockCard };
    }
    return { response: 'pass' };
}

function decideBlockRespond(room, bot, rng) {
    const state = room.gameState;
    const block = state.pendingBlock;
    const pending = state.pendingAction;
    const options = engine.getAvailableResponses(room, bot.playerId);
    if (!block || !pending || !options || !options.canChallenge) return null;
    const mine = pending.actorId === bot.playerId;
    const stakes = mine ? (pending.actionId === 'assassinate' ? 0.12 : 0.08) : -0.04;
    let chance = challengeChance(room, bot, block.blockerId, block.claim, stakes);
    if (!mine && chance < 1) chance *= 0.5;
    return { response: rng() < chance ? 'challenge' : 'pass' };
}

function chooseLoss(bot) {
    return [...bot.influence].sort((a, b) => cardValue(a, bot) - cardValue(b, bot))[0];
}

function chooseKeep(bot, options, keepCount) {
    const ranked = [...options].sort((a, b) => cardValue(b, bot) - cardValue(a, bot));
    const keep = [];
    // ไม่ถือใบซ้ำถ้าเลี่ยงได้ — มือหลากหลายบลัฟ/ขวางได้กว้างกว่า
    ranked.forEach(card => {
        if (keep.length < keepCount && !keep.includes(card)) keep.push(card);
    });
    ranked.forEach(card => {
        const already = keep.filter(id => id === card).length;
        const offered = options.filter(id => id === card).length;
        if (keep.length < keepCount && already < offered) keep.push(card);
    });
    return keep.slice(0, keepCount);
}

// ---------- ใครต้องตัดสินใจ / เมื่อไร ----------

function phaseStart(state, now) {
    if (state.phaseEndsAt && state.phaseMs) return state.phaseEndsAt - state.phaseMs;
    const mem = memory(state);
    if (!mem.clock || mem.clock.step !== state.step) mem.clock = { step: state.step, at: now };
    return mem.clock.at;
}

function thinkMs(kind, botId, step) {
    const jitter = hashOf(`${botId}:${step}:${kind}`);
    if (ENV_BOT_MS) return Math.round(ENV_BOT_MS * (1 + jitter));
    switch (kind) {
        case 'action': return 1800 + Math.round(jitter * 1600);
        case 'respond':
        case 'block-respond': return 1300 + Math.round(jitter * 2800);
        default: return 1400 + Math.round(jitter * 1100);
    }
}

/** รายการบอทที่ต้องตัดสินใจตอนนี้ พร้อมเวลาที่ควรลงมือ */
function pendingBotDecisions(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.status !== 'playing') return [];
    const start = phaseStart(state, now);
    const deadline = state.phaseEndsAt ? state.phaseEndsAt - 600 : Infinity;
    const due = (kind, botId) => {
        let at = start + thinkMs(kind, botId, state.step);
        if (kind === 'action' && Number(state.turnNumber) === 1) at += FIRST_TURN_EXTRA_MS;
        // ตอบก่อนหน้าต่างปิดเสมอ (เลยกำหนดแล้ว = ลงมือทันที)
        return Math.min(at, deadline);
    };
    const list = [];
    const add = (kind, botId) => {
        const bot = getPlayer(room, botId);
        if (bot && bot.alive && isBotId(botId)) list.push({ kind, botId, dueAt: due(kind, botId) });
    };
    switch (state.phase) {
        case 'action':
            add('action', state.currentPlayerId);
            break;
        case 'respond':
            if (state.pendingAction) engine.getPendingResponders(room).forEach(id => add('respond', id));
            break;
        case 'block-respond':
            if (state.pendingBlock) engine.getPendingBlockResponders(room).forEach(id => add('block-respond', id));
            break;
        case 'lose-influence':
            if (state.pendingLoss) add('lose', state.pendingLoss.playerId);
            break;
        case 'exchange':
            if (state.pendingExchange && isBotId(state.pendingExchange.playerId)) {
                // ระหว่างแลก การ์ดในมือย้ายไปอยู่ใน options ชั่วคราว (influence ว่าง) — ยังไม่ตกรอบ
                const bot = getPlayer(room, state.pendingExchange.playerId);
                if (bot) list.push({ kind: 'exchange', botId: bot.playerId, dueAt: due('exchange', bot.playerId) });
            }
            break;
        default:
            break;
    }
    return list.sort((a, b) => a.dueAt - b.dueAt);
}

function botNeedsTurn(room) {
    return pendingBotDecisions(room).length > 0;
}

/** ms ถึงการตัดสินใจครั้งถัดไปของบอท (null = ไม่มีบอทต้องทำอะไร) */
function botDelay(room, now = Date.now()) {
    const next = pendingBotDecisions(room, now)[0];
    if (!next) return null;
    return Math.max(60, next.dueAt - now);
}

// ---------- ลงมือ ----------

function attempt(run, fallback) {
    try {
        run();
        return true;
    } catch (error) {
        if (!fallback) return false;
        try {
            fallback();
            return true;
        } catch (fallbackError) {
            return false;
        }
    }
}

function actOnce(room, decision, rng) {
    const state = room.gameState;
    const bot = getPlayer(room, decision.botId);
    if (!bot) return false;
    const context = { step: state.step, phase: state.phase, turnNumber: state.turnNumber };

    switch (decision.kind) {
        case 'action': {
            const choice = chooseAction(room, bot, rng);
            const forced = bot.coins >= FORCED_COUP_AT;
            return attempt(
                () => engine.submitAction(room, bot.playerId, choice.actionId, choice.target ? choice.target.playerId : null),
                () => {
                    if (forced || bot.coins >= 7) {
                        const target = aliveOpponents(room, bot.playerId)[0];
                        engine.submitAction(room, bot.playerId, 'coup', target ? target.playerId : null);
                    } else {
                        engine.submitAction(room, bot.playerId, 'income');
                    }
                }
            );
        }
        case 'respond': {
            const choice = decideRespond(room, bot, rng) || { response: 'pass' };
            return attempt(
                () => engine.submitResponse(room, bot.playerId, choice.response, choice.claimCard || null, context),
                () => engine.submitResponse(room, bot.playerId, 'pass', null, context)
            );
        }
        case 'block-respond': {
            const choice = decideBlockRespond(room, bot, rng) || { response: 'pass' };
            return attempt(
                () => engine.submitResponse(room, bot.playerId, choice.response, null, context),
                () => engine.submitResponse(room, bot.playerId, 'pass', null, context)
            );
        }
        case 'lose': {
            if (!bot.influence.length) return false;
            const card = chooseLoss(bot);
            return attempt(
                () => engine.submitInfluenceLoss(room, bot.playerId, card),
                () => engine.submitInfluenceLoss(room, bot.playerId, bot.influence[0])
            );
        }
        case 'exchange': {
            const pending = state.pendingExchange;
            if (!pending) return false;
            const keep = chooseKeep(bot, pending.options, pending.keepCount);
            return attempt(
                () => engine.submitExchange(room, bot.playerId, keep),
                () => engine.submitExchange(room, bot.playerId, pending.options.slice(0, pending.keepCount))
            );
        }
        default:
            return false;
    }
}

/**
 * ให้บอททุกตัวที่ "ถึงเวลา" ตัดสินใจ — หยุดทันทีที่เฟสเปลี่ยน (ให้หน้าเว็บได้เห็นทีละจังหวะ)
 * options.force = ไม่สนเวลา (เทส engine) · คืน true ถ้า state เปลี่ยน
 */
function playBotTurns(room, options = {}) {
    const rng = options.rng || Math.random;
    const now = options.now || Date.now();
    const state = room?.gameState;
    if (!state || state.status !== 'playing') return false;
    observe(room);
    let changed = false;
    for (let guard = 0; guard < 8; guard += 1) {
        const step = state.step;
        const ready = pendingBotDecisions(room, now).filter(item => options.force || item.dueAt <= now);
        if (!ready.length) break;
        const acted = actOnce(room, ready[0], rng);
        if (!acted) break;
        changed = true;
        observe(room);
        if (room.gameState.step !== step || room.gameState.status !== 'playing') break;
    }
    return changed;
}

module.exports = {
    isBotId,
    observe,
    pendingBotDecisions,
    botNeedsTurn,
    botDelay,
    playBotTurns,
    // ให้เทสเรียกตรงได้
    chooseAction,
    decideRespond,
    decideBlockRespond,
    challengeChance,
    unseenCount,
    chooseLoss,
    chooseKeep
};
