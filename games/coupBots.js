/**
 * บอท Coup — ตัดสินใจจากข้อมูลที่ "ผู้เล่นคนนั้น" เห็นได้จริงเท่านั้น
 *   การ์ดคว่ำของตัวเอง + การ์ดที่หงายแล้วของทุกคน + เหรียญ/จำนวนการ์ด + บันทึกเกมที่ทุกคนเห็น
 * ไม่แอบดูการ์ดคว่ำของคนอื่น และไม่แอบดูกองจั่ว
 *
 * ความจำรายคู่แข่ง (ภายในเกม จากบันทึกเกมสาธารณะ):
 *   แต่ละคนเคยอ้างการ์ดอะไรกี่ครั้ง · โดนท้าแล้วพิสูจน์ว่าจริงกี่ครั้ง / โดนจับโกหกกี่ครั้ง
 *   · ขวางบ่อยแค่ไหน · ชอบท้าคนอื่นแค่ไหน · อ้างการ์ดหลายแบบเกินมือ (โกหกแน่ๆ สักใบ)
 * → ประเมิน "โอกาสที่คนนี้ถือการ์ดใบนั้นจริง" (นับใบที่มองไม่เห็น + ประวัติคำอ้าง + นิสัยโกหก)
 *   แล้วตัดสินใจท้า/ขวาง/เลือกเป้าแบบคิดได้เสีย (เสียการ์ดตัวเอง vs ทำให้อีกฝ่ายเสียการ์ด/แอ็กชันโมฆะ)
 *   คนที่พิสูจน์ว่าพูดจริงมาตลอด = ไม่ท้า · คนที่โดนจับโกหกบ่อย = ท้าบ่อยขึ้น
 *   เป้าหมาย = ผู้นำ/คนอันตรายที่สุด (เหรียญ การ์ด อ้างนักฆ่า/กัปตัน)
 *   บลัฟแบบมีบุคลิกเดิม: อ้างการ์ดที่เคยอ้างไว้แล้ว ไม่สุ่มการ์ดใหม่ (อ้างเกิน 2 แบบ = โดนจับ)
 *   ช่วงท้ายตัวต่อตัว: คิดเหรียญว่าใครจะรัฐประหารได้ก่อน ขโมยตัดเหรียญคู่แข่งก่อนถึง 7
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
const TOTAL_CARDS = CARD_IDS.length * COPIES_PER_CARD;
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

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---------- ความจำสาธารณะ (อ่านจากบันทึกเกมที่ทุกคนเห็น) ----------

function memory(state) {
    if (!state.botMemory || typeof state.botMemory !== 'object') state.botMemory = {};
    const mem = state.botMemory;
    if (!mem.mind || typeof mem.mind !== 'object') mem.mind = { opp: {}, seen: {}, seenOrder: [] };
    return mem;
}

function mind(state) {
    return memory(state).mind;
}

function rec(m, playerId) {
    if (!m.opp[playerId]) {
        m.opp[playerId] = {
            claims: {},          // การ์ด → จำนวนครั้งที่อ้าง (นับใหม่เมื่อพิสูจน์แล้ว/โดนจับ เพราะการ์ดถูกเปลี่ยน)
            everClaimed: {},     // การ์ดที่เคยอ้างทั้งเกม (บุคลิก)
            recent: {},          // การ์ดที่อ้างตั้งแต่เปลี่ยนมือครั้งล่าสุด (แลกการ์ด) — อ้างหลายแบบเกินมือ = โกหกแน่ๆ บางใบ
            proven: 0,           // โดนท้าแล้วมีจริง
            caught: 0,           // โดนท้าแล้วไม่มีจริง
            blocks: 0,
            challengesMade: 0,
            challengesWon: 0,
            chances: 0           // จำนวนครั้งที่มีโอกาสท้าคนอื่น
        };
    }
    return m.opp[playerId];
}

const CARD_BY_THAI = Object.fromEntries(CARD_IDS.map(id => [CARD_DEFINITIONS[id].thaiName, id]));
const ACTION_BY_THAI = Object.values(ACTIONS).sort((a, b) => b.thaiLabel.length - a.thaiLabel.length);

function nameAt(room, text) {
    return [...room.gameState.players]
        .sort((a, b) => String(b.name).length - String(a.name).length)
        .find(p => p.name && text.startsWith(p.name + ' ')) || null;
}

function cardIn(text) {
    const hit = Object.keys(CARD_BY_THAI).sort((a, b) => b.length - a.length).find(name => text.includes(name));
    return hit ? CARD_BY_THAI[hit] : null;
}

function noteClaim(room, m, playerId, card) {
    const r = rec(m, playerId);
    r.claims[card] = (r.claims[card] || 0) + 1;
    r.everClaimed[card] = (r.everClaimed[card] || 0) + 1;
    r.recent[card] = true;
    room.gameState.players.forEach(p => { if (p.alive && p.playerId !== playerId) rec(m, p.playerId).chances += 1; });
}

function readHistoryEntry(room, m, entry) {
    const text = String(entry.text || '');
    const actor = nameAt(room, text);
    if (!actor) return;
    const rest = text.slice(actor.name.length + 1);
    if (rest.startsWith('แลกเปลี่ยนการ์ด')) {
        // ได้มือใหม่แล้ว — คำอ้างเก่าบอกอะไรเกี่ยวกับมือตอนนี้ไม่ได้มาก
        const r = rec(m, actor.playerId);
        r.recent = {};
        r.claims = {};
        return;
    }
    if (rest.startsWith('ประกาศ ')) {
        const action = ACTION_BY_THAI.find(a => rest.slice(7).startsWith(a.thaiLabel));
        if (action && action.claim) noteClaim(room, m, actor.playerId, action.claim);
        return;
    }
    if (entry.kind === 'block' && rest.startsWith('ขวางด้วย ')) {
        const card = cardIn(rest);
        if (card) {
            noteClaim(room, m, actor.playerId, card);
            rec(m, actor.playerId).blocks += 1;
        }
        return;
    }
    if (entry.kind === 'challenge' && rest.startsWith('ท้า ')) {
        const defender = nameAt(room, rest.slice(4));
        const card = cardIn(rest);
        if (!defender || !card) return;
        const challenger = rec(m, actor.playerId);
        const def = rec(m, defender.playerId);
        challenger.challengesMade += 1;
        if (rest.includes('แล้วแพ้')) {
            def.proven += 1;      // มีจริง → การ์ดใบนั้นถูกสับคืนกอง ได้ใบใหม่แทน
            def.claims[card] = 0;
            delete def.recent[card];
        } else if (rest.includes('แล้วชนะ')) {
            challenger.challengesWon += 1;
            def.caught += 1;
            def.claims[card] = 0;
            delete def.recent[card];
        }
    }
}

/**
 * จดสิ่งที่ทุกคนเห็นจากบันทึกเกม (ประกาศแอ็กชัน / ขวาง / ผลการท้า)
 * เรียกทุกครั้งที่ state ถูกส่งออก — เป็นข้อมูลสาธารณะล้วน ไม่ได้ส่งให้ client
 */
function observe(room) {
    const state = room?.gameState;
    if (!state || state.mode !== 'coup' || state.status !== 'playing') return;
    const m = mind(state);
    const fresh = [];
    for (const entry of state.history || []) {
        const key = `${entry.at}|${entry.turn}|${entry.text}`;
        if (m.seen[key]) break;
        fresh.push({ entry, key });
    }
    fresh.reverse().forEach(({ entry, key }) => {
        m.seen[key] = true;
        m.seenOrder.push(key);
        readHistoryEntry(room, m, entry);
    });
    // กันโตไม่หยุด: บันทึกเกมเก็บแค่ 40 รายการล่าสุดอยู่แล้ว
    while (m.seenOrder.length > 120) delete m.seen[m.seenOrder.shift()];
}

// ---------- การประเมินจากข้อมูลที่มองเห็น ----------

/** การ์ดใบนี้ "ยังมองไม่เห็น" กี่ใบ จากมุมของบอท (3 - ที่หงายแล้ว - ที่อยู่ในมือตัวเอง) */
function unseenCount(room, bot, card) {
    let seen = 0;
    room.gameState.players.forEach(player => {
        seen += player.revealed.filter(id => id === card).length;
    });
    seen += (bot?.influence || []).filter(id => id === card).length;
    return Math.max(0, COPIES_PER_CARD - seen);
}

function unseenTotal(room, bot) {
    let seen = 0;
    room.gameState.players.forEach(player => { seen += player.revealed.length; });
    seen += (bot?.influence || []).length;
    return Math.max(1, TOTAL_CARDS - seen);
}

function handSize(room, player) {
    const ex = room.gameState.pendingExchange;
    if (ex && ex.playerId === player.playerId) return ex.keepCount;
    return player.influence.length;
}

function claimsOf(room, playerId) {
    return rec(mind(room.gameState), playerId).claims;
}

/** นิสัยโกหกของคนนี้ (สาธารณะ) — โดนจับบ่อย/อ้างการ์ดหลายแบบเกินมือ = สูง · พิสูจน์ว่าจริงบ่อย = ต่ำ */
function bluffRate(room, playerId) {
    const r = rec(mind(room.gameState), playerId);
    let rate = (r.caught + 0.6) / (r.caught + r.proven + 2);
    const distinct = Object.keys(r.everClaimed).length;
    if (distinct > 2) rate += 0.12 * (distinct - 2);
    return clamp(rate, 0.06, 0.92);
}

/** นิสัยชอบท้าของคนนี้ */
function challengeRate(room, playerId) {
    const r = rec(mind(room.gameState), playerId);
    return clamp((r.challengesMade + 0.4) / (r.chances + 3), 0.03, 0.9);
}

/**
 * โอกาสที่ player ถือ card อยู่จริงตอนนี้ จากมุมของ viewer
 * viewer = null → มุมสาธารณะ (คนที่ไม่เห็นมือใครเลย) ใช้ประเมินว่า "คนอื่นจะเชื่อเราไหม"
 */
function pHolds(room, viewer, player, card) {
    const u = unseenCount(room, viewer, card);
    if (u <= 0) return 0;
    const U = unseenTotal(room, viewer);
    const h = handSize(room, player);
    let none = 1;
    for (let i = 0; i < h; i += 1) none *= Math.max(0, (U - u - i)) / Math.max(1, U - i);
    const p0 = clamp(1 - none, 0.01, 0.99);
    const r = rec(mind(room.gameState), player.playerId);
    const n = r.claims[card] || 0;
    if (!n) return p0;
    // อ้างครั้งแรก = หลักฐานตามนิสัยโกหก · อ้างซ้ำใบเดิม = น่าเชื่อขึ้นนิดหน่อย (คนโกหกก็อ้างซ้ำได้)
    const odds = (p0 / (1 - p0)) * Math.pow(1 / bluffRate(room, player.playerId), Math.min(2, n));
    let p = odds / (1 + odds);
    // อ้างการ์ดหลายแบบเกินจำนวนการ์ดในมือ — อย่างน้อยบางใบต้องโกหก
    // การ์ดที่อ้างแล้วหงายทิ้งไปทีหลัง = อธิบายได้แล้ว ไม่นับ
    const distinct = Object.keys(r.recent).filter(c => !player.revealed.includes(c)).length;
    if (distinct > h && h > 0) p = Math.min(p, (0.8 * h) / distinct);
    return clamp(p, 0.01, 0.99);
}

/** ค่าของการ์ดหนึ่งใบของตัวเอง — ใบสุดท้าย = ตกรอบ */
function myCardLoss(bot) {
    return bot.influence.length <= 1 ? 3 : 1;
}

function coinValue(room) {
    return aliveOpponents(room, '').length <= 2 ? 0.17 : 0.13;
}

/** ความอันตรายของคู่แข่ง 0..1 (เหรียญ การ์ด การ์ดอันตรายที่อ้างไว้) เทียบกับคนอื่นในโต๊ะ */
function threatScores(room, bot) {
    const opps = aliveOpponents(room, bot.playerId);
    const raw = opps.map(p => {
        const claims = claimsOf(room, p.playerId);
        return {
            p,
            score: p.coins / 7 + handSize(room, p) * 0.45
                + (claims.assassin ? 0.25 : 0) + (claims.captain ? 0.12 : 0) + (claims.duke ? 0.15 : 0)
                + (p.coins >= 7 ? 0.4 : 0)
        };
    });
    const max = Math.max(0.01, ...raw.map(r => r.score));
    const out = {};
    raw.forEach(r => { out[r.p.playerId] = r.score / max; });
    return out;
}

/** ได้อะไรถ้า target เสียการ์ด 1 ใบ (ตกรอบ = ได้มากกว่า · เป็นผู้นำ = ได้มากกว่า) */
function harmValue(room, bot, target, threats) {
    const heads = aliveOpponents(room, bot.playerId).length;
    let value = handSize(room, target) <= 1 ? 1.4 : 1;
    value *= 0.55 + 0.6 * (threats[target.playerId] ?? 0.5);
    if (heads === 1) value *= 1.25;
    return value;
}

/** โอกาสที่มีคนท้า เมื่อบอทอ้าง card (ดูจากนิสัยชอบท้า + คำอ้างของบอทน่าเชื่อแค่ไหนในสายตาคนอื่น) */
function pChallenged(room, bot, card, onlyId = null) {
    const believed = pHolds(room, null, bot, card);
    const suspicion = 0.5 + 1.8 * (1 - believed);
    let none = 1;
    aliveOpponents(room, bot.playerId).forEach(o => {
        if (onlyId && o.playerId !== onlyId) return;
        none *= 1 - clamp(challengeRate(room, o.playerId) * suspicion, 0, 0.95);
    });
    return 1 - none;
}

/** การ์ดที่บอทพร้อมจะบลัฟ: เคยอ้างไว้แล้ว (บุคลิกเดิม) ได้คะแนนดี · การ์ดใหม่ทั้งที่อ้างมา 2 แบบแล้ว = แย่ */
function personaFit(room, bot, card) {
    const r = rec(mind(room.gameState), bot.playerId);
    const claimed = Object.keys(r.everClaimed);
    if (bot.influence.includes(card)) return 1;
    if (claimed.includes(card)) return 0.9;
    if (claimed.length >= 2) return 0.15;
    if (claimed.length === 1 && !bot.influence.includes(claimed[0])) return 0.35; // บลัฟใบแรกไว้แล้ว อย่าเพิ่มอีกแบบ
    return 0.6;
}

function cardValue(card, bot, room) {
    let value;
    switch (card) {
        case 'duke': value = 5; break;
        case 'assassin': value = bot && bot.coins >= 3 ? 4.6 : 4; break;
        case 'captain': value = 4.2; break;
        case 'contessa': value = 3.6; break;
        case 'ambassador': value = 2.6; break;
        default: value = 1;
    }
    if (room && bot) {
        // เก็บการ์ดที่ตรงกับสิ่งที่เคยอ้างไว้ — คำอ้างเดิมยังน่าเชื่อ
        const r = rec(mind(room.gameState), bot.playerId);
        if (r.everClaimed[card]) value += 0.9;
        if (card === 'contessa' && aliveOpponents(room, bot.playerId).some(p => claimsOf(room, p.playerId).assassin)) value += 0.8;
    }
    return value;
}

function softPick(options, rng, temperature = 0.08) {
    const best = Math.max(...options.map(o => o.ev));
    const weights = options.map(o => Math.exp((o.ev - best) / temperature));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    for (let i = 0; i < options.length; i += 1) {
        roll -= weights[i];
        if (roll <= 0) return options[i];
    }
    return options[options.length - 1];
}

// ---------- ตาของบอท: เลือกแอ็กชัน ----------

/** คืนรายการแอ็กชันที่ทำได้พร้อมค่าคาดหวัง (ยิ่งมากยิ่งดี) */
function actionOptions(room, bot) {
    const coins = bot.coins;
    const has = card => bot.influence.includes(card);
    const opps = aliveOpponents(room, bot.playerId);
    const heads = opps.length;
    const threats = threatScores(room, bot);
    const cv = coinValue(room);
    const loss = myCardLoss(bot);
    const options = [];
    const bluffCost = card => {
        if (has(card)) return { p: 0, ok: true };
        if (unseenCount(room, bot, card) <= 0) return { p: 1, ok: false };
        const p = clamp(pChallenged(room, bot, card) + (1 - personaFit(room, bot, card)) * 0.25, 0, 0.98);
        return { p, ok: true };
    };
    const coinGain = (n, after) => {
        let value = n * cv;
        if (coins < 7 && after >= 7) value += 0.35; // ตาหน้ารัฐประหารได้
        if (after >= FORCED_COUP_AT) value -= 0.1;
        return value;
    };
    const dangerNext = opps.filter(p => p.coins >= 7).length; // คู่แข่งที่ตาหน้ารัฐประหารได้

    if (coins >= FORCED_COUP_AT) {
        opps.forEach(t => options.push({ actionId: 'coup', target: t, ev: harmValue(room, bot, t, threats) + 1 }));
        return options;
    }
    if (coins >= 7) {
        opps.forEach(t => options.push({ actionId: 'coup', target: t, ev: harmValue(room, bot, t, threats) * 1.15 + 0.35 }));
    }

    // ลอบสังหาร
    if (coins >= 3) {
        const risk = bluffCost('assassin');
        if (risk.ok) {
            opps.forEach(t => {
                const contessa = pHolds(room, bot, t, 'contessa');
                // ไม่มีท่านหญิงจริงก็อาจบลัฟขวาง (ใบสุดท้ายไม่มีอะไรจะเสีย) — แต่เราอาจท้ากลับได้
                const bluffBlock = handSize(room, t) <= 1 ? 0.7 : 0.25;
                const pBlock = contessa + (1 - contessa) * bluffBlock * 0.55;
                const success = (1 - pBlock) * harmValue(room, bot, t, threats);
                const ev = (1 - risk.p) * success - risk.p * loss - 3 * cv * 0.55;
                options.push({ actionId: 'assassinate', target: t, ev, bluff: !has('assassin') });
            });
        }
    }

    // ขโมย — คนที่มีเหรียญ ไม่น่าจะถือกัปตัน/ทูต · ตัดเหรียญคนที่ใกล้รัฐประหาร
    {
        const risk = bluffCost('captain');
        if (risk.ok) {
            opps.filter(t => t.coins >= 1).forEach(t => {
                const amount = Math.min(2, t.coins);
                const pc = pHolds(room, bot, t, 'captain');
                const pa = pHolds(room, bot, t, 'ambassador');
                const blockHabit = Math.min(0.3, rec(mind(room.gameState), t.playerId).blocks * 0.05);
                const pBlock = clamp(1 - (1 - pc) * (1 - pa) + blockHabit, 0, 0.95);
                const denial = heads === 1 ? 1 : 0.35 + 0.5 * (threats[t.playerId] ?? 0.5);
                let gain = coinGain(amount, coins + amount) + amount * cv * denial;
                // ตัดเหรียญคนที่ตาหน้าจะรัฐประหาร (โดยเฉพาะตอนเราเหลือใบเดียว)
                if (t.coins >= 7 && t.coins - amount < 7) gain += heads === 1 ? (bot.influence.length <= 1 ? 1.6 : 0.8) : 0.45;
                const ev = (1 - risk.p) * (1 - pBlock) * gain - risk.p * loss;
                options.push({ actionId: 'steal', target: t, ev, bluff: !has('captain') });
            });
        }
    }

    // เก็บภาษี
    {
        const risk = bluffCost('duke');
        if (risk.ok) {
            const ev = (1 - risk.p) * coinGain(3, coins + 3) - risk.p * loss;
            options.push({ actionId: 'tax', ev, bluff: !has('duke') });
        }
    }

    // แลกการ์ด — มือไม่มีการ์ดทำเงิน/โจมตี หรือบุคลิกพังแล้ว (โดนจับโกหก)
    {
        const risk = bluffCost('ambassador');
        if (risk.ok) {
            const weak = !bot.influence.some(card => card === 'duke' || card === 'captain' || card === 'assassin');
            const caught = rec(mind(room.gameState), bot.playerId).caught;
            const value = (weak ? 0.45 : 0.08) + (caught ? 0.15 : 0);
            options.push({ actionId: 'exchange', ev: (1 - risk.p) * value - risk.p * loss - (dangerNext && heads === 1 ? 0.3 : 0), bluff: !has('ambassador') });
        }
    }

    // เงินช่วยเหลือ (เสี่ยงโดนดยุคขวาง) / รายได้ (ปลอดภัย)
    {
        let none = 1;
        opps.forEach(o => { none *= 1 - clamp(0.75 * pHolds(room, bot, o, 'duke') + 0.04, 0, 0.95); });
        options.push({ actionId: 'foreign_aid', ev: none * coinGain(2, coins + 2) });
        options.push({ actionId: 'income', ev: coinGain(1, coins + 1) });
    }
    return options;
}

function chooseAction(room, bot, rng) {
    observe(room);
    const options = actionOptions(room, bot);
    if (!options.length) return { actionId: 'income', target: null };
    const pick = softPick(options, rng);
    return { actionId: pick.actionId, target: pick.target || null, ev: pick.ev, bluff: !!pick.bluff };
}

// ---------- ช่วงตอบโต้ ----------

/** โอกาสที่ claimer โกหกเรื่อง card (จากมุมบอท) · ใบที่มองไม่เห็นเหลือ 0 = โกหกแน่นอน */
function challengeChance(room, bot, claimerId, card) {
    const claimer = getPlayer(room, claimerId);
    if (!claimer) return 0;
    if (unseenCount(room, bot, card) <= 0) return 1;
    return 1 - pHolds(room, bot, claimer, card);
}

/** ได้อะไรถ้าแอ็กชันที่ค้างอยู่ถูกยกเลิก (จากมุมบอท) */
function cancelGain(room, bot, pending, threats) {
    const cv = coinValue(room);
    const heads = aliveOpponents(room, bot.playerId).length;
    const w = heads === 1 ? 1 : 1.3 / heads;
    const targeted = pending.targetId === bot.playerId;
    const actor = getPlayer(room, pending.actorId);
    const threat = threats[pending.actorId] ?? 0.5;
    switch (pending.actionId) {
        case 'tax': return 3 * cv * w * (0.6 + threat) + (actor && actor.coins + 3 >= 7 && actor.coins < 7 ? 0.25 * w : 0);
        case 'steal': return targeted ? 2 * cv * 2 : 0.1 * w;
        case 'assassinate': return targeted ? myCardLoss(bot) : -0.15 * w;
        case 'exchange': return 0.05 * w;
        case 'foreign_aid': return 2 * cv * w * (0.6 + threat);
        default: return 0;
    }
}

function decideRespond(room, bot, rng) {
    observe(room);
    const state = room.gameState;
    const pending = state.pendingAction;
    const options = engine.getAvailableResponses(room, bot.playerId);
    if (!pending || !options) return null;
    const action = ACTIONS[pending.actionId];
    const actor = getPlayer(room, pending.actorId);
    const targeted = pending.targetId === bot.playerId;
    const has = card => bot.influence.includes(card);
    const threats = threatScores(room, bot);
    const heads = aliveOpponents(room, bot.playerId).length;
    const w = heads === 1 ? 1 : 1.3 / heads;
    const loss = myCardLoss(bot);
    const cancel = cancelGain(room, bot, pending, threats);
    const choices = [{ response: 'pass', ev: 0 }];
    const blockIds = (options.blockOptions || []).map(option => option.id);

    // 1) ขวาง — การ์ดจริงไม่มีความเสี่ยง (ใครท้าก็เสียการ์ดเอง)
    blockIds.forEach(card => {
        if (has(card)) {
            let ev = cancel + 0.05;
            if (pending.actionId === 'foreign_aid') ev = cancel;
            choices.push({ response: 'block', claimCard: card, ev });
            return;
        }
        if (unseenCount(room, bot, card) <= 0) return;
        // บลัฟขวาง: โดนจับ = เสียการ์ด + แอ็กชันยังเกิด (โดนลอบสังหารตอนมี 2 ใบ = ตกรอบ)
        const pCh = clamp(pChallenged(room, bot, card) + (1 - personaFit(room, bot, card)) * 0.2, 0, 0.98);
        let caughtCost = loss;
        if (pending.actionId === 'assassinate' && targeted) caughtCost = bot.influence.length <= 1 ? 0 : 2;
        const ev = (1 - pCh) * cancel - pCh * caughtCost;
        choices.push({ response: 'block', claimCard: card, ev, bluff: true });
    });

    // 2) ท้า (ไม่มีในหน้าต่าง "ขวางได้อย่างเดียว")
    if (options.canChallenge && action.claim && actor) {
        const pBluff = challengeChance(room, bot, pending.actorId, action.claim);
        let lose = loss;
        // โดนลอบสังหาร ท้าแพ้ = เสีย 1 ใบ แล้วยังโดนฆ่าต่อ (ถ้าขวางไม่ได้) → มี 2 ใบก็ตกรอบได้
        if (targeted && pending.actionId === 'assassinate' && !has('contessa')) lose = 3;
        const gain = harmValue(room, bot, actor, threats) * (heads === 1 ? 1 : w) + cancel;
        const ev = pBluff >= 1 ? 5 : pBluff * gain - (1 - pBluff) * lose;
        choices.push({ response: 'challenge', ev });
    }

    choices.sort((a, b) => b.ev - a.ev);
    const top = choices[0];
    if (top.response === 'challenge' && top.ev >= 5) return { response: 'challenge' };
    // ใกล้เคียงกันมาก = ลังเลแบบคน (สุ่มระหว่างสองทาง)
    if (choices[1] && top.ev - choices[1].ev < 0.08 && rng() < 0.35) {
        const alt = choices[1];
        return alt.response === 'block' ? { response: 'block', claimCard: alt.claimCard } : { response: alt.response };
    }
    if (top.ev <= 0) return { response: 'pass' };
    return top.response === 'block' ? { response: 'block', claimCard: top.claimCard } : { response: top.response };
}

function decideBlockRespond(room, bot, rng) {
    observe(room);
    const state = room.gameState;
    const block = state.pendingBlock;
    const pending = state.pendingAction;
    const options = engine.getAvailableResponses(room, bot.playerId);
    if (!block || !pending || !options || !options.canChallenge) return null;
    const blocker = getPlayer(room, block.blockerId);
    if (!blocker) return { response: 'pass' };
    const mine = pending.actorId === bot.playerId;
    const threats = threatScores(room, bot);
    const heads = aliveOpponents(room, bot.playerId).length;
    const w = heads === 1 ? 1 : 1.3 / heads;
    const pBluff = challengeChance(room, bot, block.blockerId, block.claim);
    if (pBluff >= 1) return { response: 'challenge' };
    const cv = coinValue(room);
    let restored = 0;
    if (mine) {
        const target = pending.targetId ? getPlayer(room, pending.targetId) : null;
        if (pending.actionId === 'assassinate' && target) restored = harmValue(room, bot, target, threats);
        else if (pending.actionId === 'steal') restored = 2 * cv * 2;
        else if (pending.actionId === 'foreign_aid') restored = 2 * cv;
    } else if (pending.targetId === bot.playerId) {
        restored = -cancelGain(room, bot, pending, threats); // การขวางช่วยเราอยู่ อย่าไปทำลาย
    }
    const gain = harmValue(room, bot, blocker, threats) * (mine || heads === 1 ? 1 : w) + restored;
    const ev = pBluff * gain - (1 - pBluff) * myCardLoss(bot);
    if (ev > 0.08) return { response: 'challenge' };
    if (ev > -0.05 && rng() < 0.25) return { response: 'challenge' };
    return { response: 'pass' };
}

function chooseLoss(bot, room = null) {
    return [...bot.influence].sort((a, b) => cardValue(a, bot, room) - cardValue(b, bot, room))[0];
}

function chooseKeep(bot, options, keepCount, room = null) {
    const ranked = [...options].sort((a, b) => cardValue(b, bot, room) - cardValue(a, bot, room));
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
            const card = chooseLoss(bot, room);
            return attempt(
                () => engine.submitInfluenceLoss(room, bot.playerId, card),
                () => engine.submitInfluenceLoss(room, bot.playerId, bot.influence[0])
            );
        }
        case 'exchange': {
            const pending = state.pendingExchange;
            if (!pending) return false;
            const keep = chooseKeep(bot, pending.options, pending.keepCount, room);
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
    actionOptions,
    decideRespond,
    decideBlockRespond,
    challengeChance,
    unseenCount,
    pHolds,
    bluffRate,
    challengeRate,
    chooseLoss,
    chooseKeep
};
