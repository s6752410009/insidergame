/**
 * บอทหมาป่า — เล่นได้ทุกบท (รวม 5 บทใหม่) 3–20 คน
 *
 * ข้อมูลที่บอทใช้ = ข้อมูลที่ "ผู้เล่นที่นั่งตรงนั้น" เห็นได้จริงเท่านั้น
 *   - บทของตัวเอง + ผลตรวจของตัวเอง (ผู้หยั่งรู้/ศิษย์/นักพยากรณ์)
 *   - หมาป่ารู้จักเพื่อนหมาป่า (หน้าจอหมาป่าก็เห็น) · แม่มดเห็นเหยื่อที่หมาป่าเล็ง (กติกาเดิม)
 *   - ของสาธารณะ: ใครตาย ใครโหวตใคร นายก/เจ้าชายที่เปิดตัวแล้ว บทคนตายถ้าห้องเปิด "เปิดบทเมื่อตาย"
 * แชทของบอทเป็นประโยคกลางๆ ที่สุ่มโดยไม่ดูบทเลย — ไม่มีทางหลุดข้อมูลลับ · บอทที่ตายแล้วเงียบ
 *
 * ทุกคำสั่งเรียก engine.submit* ตัวเดียวกับคนกด · ถ้าโดนปฏิเสธจะถอยไป "ไม่ใช้สกิล/พร้อม/ข้ามโหวต"
 * และนาฬิกาเฟสเดิมยังพาเกมเดินต่อเสมอ บอทจึงทำเกมค้างไม่ได้
 * จังหวะ: นับจากตอนที่บอทเห็นเฟสนี้ครั้งแรก · WEREWOLF_BOT_MS ใช้เร่งเทส
 */

const engine = require('./werewolfEngine');

const SKIP = engine.SKIP_TARGET_ID;
const ENV_BOT_MS = Number(process.env.WEREWOLF_BOT_MS) || 0;
// ช่วงเช้ามีสรุปข่าวเมื่อคืน (app ใส่ buffer 14 วิ) — บอทไม่รีบกดข้ามก่อนคนอ่านจบ
const RECAP_MS = 14000;
const MAX_CHAT_PER_DAY = 3;

// ประโยคกลางๆ ไม่อ้างบท ไม่ชี้ตัวใคร — เลือกด้วย hash ที่ไม่เกี่ยวกับบท
const CHAT_LINES = [
    'อรุณสวัสดิ์ทุกคน 👋',
    'เมื่อคืนใครได้ยินอะไรบ้าง?',
    'ขอฟังทุกคนก่อนนะ ยังไม่แน่ใจ',
    'อย่าเพิ่งรีบโหวต ค่อยๆ คิดกัน',
    'ใครเงียบๆ นี่น่าสงสัยนะ 🤔',
    'ผมว่าวันนี้ต้องได้ใครสักคนแล้ว',
    'โหวตแตกเดี๋ยวหมาป่าได้เปรียบนะ',
    'ใครมีข้อมูลอะไรพูดมาเลย',
    'หมู่บ้านเราต้องสามัคคีกัน 💪',
    'ฟังดูทะแม่งๆ นะ แต่ยังไม่ฟันธง',
    'รอดมาอีกวัน ดีใจจัง 😅',
    'ผมโหวตตามเหตุผลนะ ไม่ได้มั่ว'
];

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function hashOf(text) {
    let h = 2166136261;
    const s = String(text);
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

function getPlayer(room, playerId) {
    return (room?.gameState?.players || []).find(p => p.playerId === playerId) || null;
}

function alivePlayers(room) {
    return room.gameState.players.filter(p => p.alive !== false);
}

const isWolf = player => !!player && engine.isWerewolfRole(player.role);

// ---------- ความจำของบอท (เก็บใน gameState แต่ไม่เคยถูกส่งให้หน้าเว็บ) ----------

function brain(state) {
    if (!state.botBrain || typeof state.botBrain !== 'object') state.botBrain = {};
    const b = state.botBrain;
    if (!b.votes) b.votes = {};
    if (!b.chat) b.chat = {};
    if (!b.clock) b.clock = { key: null, at: 0 };
    return b;
}

function phaseKey(state) {
    return `${state.phase}:${state.dayNumber}`;
}

/** จดสิ่งที่ทุกคนเห็น: ใครโหวตใครในแต่ละวัน + เวลาที่เฟสนี้เริ่ม (จากมุมบอท) */
function observe(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.mode !== 'werewolf') return;
    const b = brain(state);
    const key = phaseKey(state);
    if (b.clock.key !== key) b.clock = { key, at: now };
    if (state.phase === 'day-vote' && state.dayVotes) {
        const day = String(state.dayNumber);
        b.votes[day] = { ...(b.votes[day] || {}), ...state.dayVotes };
        const days = Object.keys(b.votes).map(Number).sort((x, y) => x - y);
        while (days.length > 12) delete b.votes[String(days.shift())];
    }
}

// ---------- การอ่านเกม (ความสงสัย) ----------

function stableNoise(botId, targetId, day) {
    return hashOf(`${botId}>${targetId}@${day}`);
}

function publiclyVillage(room, player) {
    if (!player) return false;
    if (player.role === 'mayor' && player.mayorRevealed) return true;
    if (player.role === 'prince' && player.princeRevealed) return true;
    return room.settings?.werewolfRevealOnDeath === true && player.alive === false
        && player.roleInfo?.team === 'village';
}

/** ความสงสัยจากของสาธารณะล้วน (ใช้ร่วมกันทุกบท แล้วแต่ละบทเติมความรู้ของตัวเอง) */
function publicSuspicion(room, botId, target) {
    const state = room.gameState;
    const day = state.dayNumber;
    let score = stableNoise(botId, target.playerId, day) * 2;
    const votesNow = state.phase === 'day-vote' ? state.dayVotes || {} : {};
    Object.entries(votesNow).forEach(([voterId, targetId]) => {
        if (targetId === target.playerId && voterId !== botId) score += 1.1;
    });
    const memory = brain(state).votes;
    let accused = 0;
    Object.entries(memory).forEach(([d, votes]) => {
        if (Number(d) === day && state.phase === 'day-vote') return;
        Object.entries(votes).forEach(([voterId, pick]) => {
            // โดนคนอื่นชี้มาแล้วในวันก่อนๆ — สะสมทีละนิด ให้โหวตทั้งวงค่อยๆ ไปทางเดียวกัน (ไม่โหวตแตกวนไม่จบ)
            if (pick === target.playerId && voterId !== botId) accused += 0.5;
        });
        const pick = votes[target.playerId];
        if (!pick) return;
        if (pick === SKIP) { score += 0.2; return; }
        // เคยโหวตไล่คนที่ภายหลังรู้กันว่าเป็นฝ่ายหมู่บ้าน
        if (publiclyVillage(room, getPlayer(room, pick))) score += 0.9;
    });
    score += Math.min(3.5, accused);
    if (publiclyVillage(room, target)) score -= 4;
    return score;
}

function knowledgeBonus(room, bot, target) {
    let bonus = 0;
    (bot.seerHistory || []).forEach(entry => {
        if (entry.targetPlayerId !== target.playerId) return;
        if (entry.resultCode === 'bad') bonus += 10;
        else if (entry.resultCode === 'good') bonus -= 10;
        else bonus += 1;
    });
    (bot.oracleHistory || []).forEach(entry => {
        if (entry.targetPlayerId !== target.playerId) return;
        if (entry.roleId === 'werewolf' || entry.roleId === 'alphaWolf') bonus += 10;
        else if (entry.roleId === 'serialKiller') bonus += 7;
        else if (entry.roleId === 'unknown') bonus += 1;
        else bonus -= 10;
    });
    return bonus;
}

/** คะแนน "อยากไล่ออก" ของบอทต่อเป้าหนึ่ง (null = ไม่มีวันเลือก) */
function voteScore(room, bot, target) {
    if (!target || target.playerId === bot.playerId || target.alive === false) return null;
    if (isWolf(bot)) {
        if (isWolf(target)) return null; // หมาป่าไม่โหวตพวกเดียวกัน
        let score = stableNoise(bot.playerId, target.playerId, room.gameState.dayNumber) * 2;
        const votesNow = room.gameState.phase === 'day-vote' ? room.gameState.dayVotes || {} : {};
        Object.entries(votesNow).forEach(([voterId, targetId]) => { if (targetId === target.playerId && voterId !== bot.playerId) score += 1.4; });
        Object.values(brain(room.gameState).votes).forEach(votes => {
            const pick = votes[target.playerId];
            if (pick && isWolf(getPlayer(room, pick))) score += 2; // คนนี้เคยไล่หมาป่า — อันตราย
        });
        if (target.role === 'mayor' && target.mayorRevealed) score += 2;
        return score;
    }
    return publicSuspicion(room, bot.playerId, target) + knowledgeBonus(room, bot, target);
}

function rankTargets(room, bot, scorer, candidates) {
    return candidates
        .map(target => ({ target, score: scorer(target) }))
        .filter(entry => entry.score !== null && Number.isFinite(entry.score))
        .sort((x, y) => y.score - x.score);
}

// ---------- กลางคืน ----------

function wolfPackPick(room, excludeId = null) {
    const votes = room.gameState.nightActions?.werewolfVotes || {};
    const real = Object.fromEntries(Object.entries(votes).filter(([voterId, targetId]) => voterId !== excludeId
        && targetId && targetId !== SKIP && isWolf(getPlayer(room, voterId))));
    const humanReal = Object.fromEntries(Object.entries(real).filter(([voterId]) => !isBotId(voterId)));
    // คนจริงในฝูงเลือกแล้ว = ตามคน (ทีมเดียวกัน) · ไม่งั้นตามบอทตัวที่เลือกก่อน
    return engine.getWeightedTarget(Object.keys(humanReal).length ? humanReal : real, room, { alphaWolf: 2 });
}

/** บอทตัวนี้ยังต้องทำอะไรตอนกลางคืน: 'act' (ใช้สกิล) · 'ready' (กดพร้อม) · null */
function nightNeed(room, bot) {
    const state = room.gameState;
    const actions = state.nightActions || {};
    if (isWolf(bot) && engine.canWolvesHuntTonight(room)) {
        const mine = actions.werewolfVotes?.[bot.playerId];
        if (!mine) return 'act';
        const pack = wolfPackPick(room, bot.playerId);
        if (pack && mine !== pack && mine !== SKIP) return 'act'; // ฝูงเลือกคนอื่น — ตามฝูง
        return engine.isPlayerReadyForMorning(room, bot) ? null : 'ready';
    }
    const required = engine.getRequiredNightActors(room).some(p => p.playerId === bot.playerId);
    if (required && !engine.hasNightActionSubmitted(room, bot) && !state.nightSkips?.[bot.playerId]) return 'act';
    return engine.isPlayerReadyForMorning(room, bot) ? null : 'ready';
}

function pickFrom(list, rng) {
    return list.length ? list[Math.floor(rng() * list.length)] : null;
}

function targetIds(option) {
    return (option?.targets || []).map(t => t.playerId);
}

/** คืนลิสต์คำสั่งกลางคืน [{target, type}] ตามบท */
function planNight(room, bot, rng) {
    const state = room.gameState;
    const options = engine.getNightActionOptions(room, bot);
    const byType = type => options.find(option => option.type === type);
    const firstNight = engine.isFirstNight(room);
    const night = Number(state.dayNumber) || 1;
    const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId);
    const suspicionOrder = rankTargets(room, bot, t => voteScore(room, bot, t) ?? -99, others).map(e => e.target);

    switch (bot.role) {
        case 'werewolf':
        case 'alphaWolf': {
            const option = byType('night-kill');
            const allowed = targetIds(option);
            if (!allowed.length) return [{ target: SKIP }];
            const pack = wolfPackPick(room, bot.playerId);
            if (pack && allowed.includes(pack)) return [{ target: pack }];
            const ranked = rankTargets(room, bot, t => {
                if (!allowed.includes(t.playerId)) return null;
                let score = rng() * 1.5;
                if (t.role === 'mayor' && t.mayorRevealed) score += 3;
                Object.values(brain(state).votes).forEach(votes => {
                    if (votes[t.playerId] && isWolf(getPlayer(room, votes[t.playerId]))) score += 2;
                });
                return score;
            }, others);
            return [{ target: ranked[0] ? ranked[0].target.playerId : SKIP }];
        }
        case 'seer':
        case 'apprenticeSeer': {
            const option = byType('seer-check');
            if (!option || option.locked) return [];
            const checked = new Set((bot.seerHistory || []).map(e => e.targetPlayerId));
            const fresh = suspicionOrder.filter(t => !checked.has(t.playerId) && targetIds(option).includes(t.playerId));
            // ไม่ใช่ตามความสงสัยล้วน — สลับบ้างให้ตรวจกระจาย
            const choice = fresh.length ? (rng() < 0.6 ? fresh[0] : pickFrom(fresh, rng)) : null;
            return [{ target: choice ? choice.playerId : SKIP }];
        }
        case 'oracle': {
            const option = byType('oracle-read');
            if (!option || option.locked) return [];
            const read = new Set((bot.oracleHistory || []).map(e => e.targetPlayerId));
            const fresh = suspicionOrder.filter(t => !read.has(t.playerId) && targetIds(option).includes(t.playerId));
            const choice = fresh.length ? (rng() < 0.6 ? fresh[0] : pickFrom(fresh, rng)) : null;
            return [{ target: choice ? choice.playerId : SKIP }];
        }
        case 'doctor': {
            const option = byType('doctor-save');
            if (!option || !option.allowSkip) return [];
            // คืนแรกหมาป่ายังไม่ล่า — เก็บยาไว้ · มี 2 ครั้ง ใช้แบบมีจังหวะ
            if (firstNight || rng() > 0.6) return [{ target: SKIP }];
            const allowed = targetIds(option);
            const mayor = others.find(p => p.role === 'mayor' && p.mayorRevealed && allowed.includes(p.playerId));
            const target = rng() < 0.4 ? bot.playerId : (mayor ? mayor.playerId : pickFrom(allowed, rng));
            return [{ target: allowed.includes(target) ? target : SKIP }];
        }
        case 'bodyguard': {
            const option = byType('bodyguard-protect');
            if (!option || !option.allowSkip) return [];
            if (firstNight || rng() > 0.75) return [{ target: SKIP }];
            const allowed = targetIds(option);
            const mayor = others.find(p => p.role === 'mayor' && p.mayorRevealed && allowed.includes(p.playerId));
            let target = rng() < 0.3 ? bot.playerId : (mayor ? mayor.playerId : pickFrom(allowed.filter(id => id !== bot.playerId), rng));
            if (!allowed.includes(target)) target = pickFrom(allowed, rng) || SKIP;
            return [{ target }];
        }
        case 'witch': {
            const plan = [];
            const poison = byType('witch-poison');
            const heal = byType('witch-heal');
            // ยาพิษก่อน (กด "ไม่ใช้" ขวดหนึ่ง engine จะปัดอีกขวดเป็นไม่ใช้ให้ด้วย)
            if (poison && poison.selectedTargetId == null && night >= 2 && rng() < 0.2) {
                const top = rankTargets(room, bot, t => voteScore(room, bot, t), others)[0];
                if (top && top.score >= 2 && targetIds(poison).includes(top.target.playerId)) plan.push({ target: top.target.playerId, type: 'witch-poison' });
            }
            if (heal && heal.selectedTargetId == null) {
                const victim = engine.canWolvesHuntTonight(room) ? wolfPackPick(room) : null;
                if (victim && (victim === bot.playerId || rng() < 0.7)) plan.push({ target: victim, type: 'witch-heal' });
                else plan.push({ target: SKIP, type: 'witch-heal' });
            }
            if (poison && poison.selectedTargetId == null && !plan.some(p => p.type === 'witch-poison')) {
                plan.push({ target: SKIP, type: 'witch-poison' });
            }
            return plan;
        }
        case 'tracker': {
            const option = byType('tracker-scan');
            if (!option || option.locked) return [];
            return [{ target: pickFrom(targetIds(option), rng) || SKIP }];
        }
        case 'vigilante':
        case 'hunter': {
            const option = byType(bot.role === 'vigilante' ? 'vigilante-shot' : 'hunter-shot');
            if (!option || !option.allowSkip) return [];
            const top = rankTargets(room, bot, t => voteScore(room, bot, t), others)[0];
            // ยิงได้ครั้งเดียว ยิงผิดคือฆ่าพวกเดียวกัน — ยิงเมื่อมั่นใจ (มีคนโดนรุมสงสัย) เท่านั้น
            if (!firstNight && top && top.score >= 3 && rng() < 0.35 && targetIds(option).includes(top.target.playerId)) {
                return [{ target: top.target.playerId }];
            }
            return [{ target: SKIP }];
        }
        case 'serialKiller': {
            const option = byType('serial-kill');
            const allowed = targetIds(option);
            if (!allowed.length) return [{ target: SKIP }];
            const mayor = others.find(p => p.role === 'mayor' && p.mayorRevealed && allowed.includes(p.playerId));
            return [{ target: mayor && rng() < 0.5 ? mayor.playerId : pickFrom(allowed, rng) }];
        }
        default:
            return [];
    }
}

function runNightAct(room, bot, rng) {
    const plan = planNight(room, bot, rng);
    let changed = false;
    for (const step of plan) {
        const current = step.type === 'witch-heal' ? room.gameState.nightActions.witchHeals?.[bot.playerId]
            : step.type === 'witch-poison' ? room.gameState.nightActions.witchPoisons?.[bot.playerId]
                : null;
        if (current) continue; // engine ปัดเป็นไม่ใช้ให้แล้ว
        if (room.gameState.phase !== 'night') break;
        try {
            // กดเป้าเดิมซ้ำ = ยกเลิก — ห้ามส่งซ้ำ
            if (isWolf(bot) && room.gameState.nightActions.werewolfVotes?.[bot.playerId] === step.target) continue;
            engine.submitNightAction(room, bot.playerId, step.target, step.type || null);
            changed = true;
        } catch (error) {
            try {
                engine.submitNightAction(room, bot.playerId, SKIP, step.type || null);
                changed = true;
            } catch (skipError) { /* ปล่อยให้กดพร้อมแทน */ }
        }
    }
    if (room.gameState.phase === 'night' && !engine.isPlayerReadyForMorning(room, bot)) {
        changed = pressReady(room, bot) || changed;
    }
    return changed;
}

function pressReady(room, bot) {
    try {
        engine.submitNightSkip(room, bot.playerId);
        return true;
    } catch (error) {
        return false;
    }
}

// ---------- กลางวัน ----------

function runDiscuss(room, bot, rng) {
    const state = room.gameState;
    let changed = false;
    const day = Number(state.dayNumber) || 1;
    if (bot.role === 'cleric' && !bot.clericBlessUsed && rng() < 0.35) {
        const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId);
        const mayor = others.find(p => p.role === 'mayor' && p.mayorRevealed);
        const target = mayor || pickFrom(others, rng);
        if (target) {
            try { engine.submitClericBless(room, bot.playerId, target.playerId); changed = true; } catch (error) { /* ข้าม */ }
        }
    }
    if (bot.role === 'mayor' && !bot.mayorRevealed && day >= 2 && rng() < 0.3) {
        try { engine.submitMayorReveal(room, bot.playerId); changed = true; } catch (error) { /* ข้าม */ }
    }
    if (room.gameState.phase === 'day-discussion' && !state.discussionSkips?.[bot.playerId]) {
        try { engine.submitDiscussionSkip(room, bot.playerId); changed = true; } catch (error) { /* ข้าม */ }
    }
    return changed;
}

function runVote(room, bot, rng) {
    const state = room.gameState;
    const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId);
    const ranked = rankTargets(room, bot, t => voteScore(room, bot, t), others);
    const top = ranked[0];
    const day = Number(state.dayNumber) || 1;

    // จอมเปิดโปง: ชี้เมื่อมั่นใจมาก (ผิด = ตายแทน)
    if (bot.role === 'revealer' && !bot.revealerUsed && day >= 2 && top && top.score >= 3.5 && rng() < 0.15) {
        try {
            engine.useRevealAction(room, bot.playerId, top.target.playerId, { lastCall: true });
            return true;
        } catch (error) { /* โหวตแทน */ }
    }
    // คะแนนต่ำ (ยังไม่มีเหตุผล) — วันแรกข้ามบ้าง
    const threshold = day <= 1 ? 1.1 : 0.7;
    const choice = top && top.score >= threshold ? top.target.playerId : SKIP;
    try {
        engine.submitDayVote(room, bot.playerId, choice, { lastCall: true });
        return true;
    } catch (error) {
        try {
            engine.submitDayVote(room, bot.playerId, SKIP, { lastCall: true });
            return true;
        } catch (skipError) {
            return false;
        }
    }
}

// ---------- ใครต้องทำอะไร / เมื่อไร ----------

function jitter(bot, key, kind) {
    return hashOf(`${bot.playerId}:${key}:${kind}`);
}

function pendingBotDecisions(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.winner || !['night', 'day-discussion', 'day-vote'].includes(state.phase)) return [];
    observe(room, now);
    const b = brain(state);
    const start = b.clock.at;
    const key = b.clock.key;
    const deadline = state.phaseEndsAt ? state.phaseEndsAt - 1200 : Infinity;
    const nightMs = engine.getPhaseDurationMs(room, 'night');
    const dayMs = engine.getPhaseDurationMs(room, 'day-discussion');
    const list = [];
    const push = (bot, kind, offsetMs) => list.push({ botId: bot.playerId, kind, dueAt: Math.min(start + offsetMs, deadline) });
    const fast = base => ENV_BOT_MS * base;

    alivePlayers(room).filter(p => isBotId(p.playerId)).forEach(bot => {
        const j = jitter(bot, key, state.phase);
        if (state.phase === 'night') {
            const need = nightNeed(room, bot);
            if (!need) return;
            if (need === 'act' && isWolf(bot) && state.nightActions?.werewolfVotes?.[bot.playerId]) {
                // ตามฝูงที่เปลี่ยนเป้า — ตอบสนองไวหน่อย
                list.push({ botId: bot.playerId, kind: 'night', dueAt: Math.min(now + (ENV_BOT_MS ? fast(1) : 1200), deadline) });
                return;
            }
            if (need === 'act' && bot.role === 'witch') {
                // แม่มดรอดูว่าหมาป่าเล็งใคร (ถ้ายังไม่เลือก รอได้ถึงครึ่งคืน)
                const huntOpen = engine.canWolvesHuntTonight(room) && room.gameState.players.some(p => p.alive !== false && isWolf(p));
                const waitWolves = huntOpen && !wolfPackPick(room);
                const offset = ENV_BOT_MS ? fast(waitWolves ? 4 : 2 + j) : (waitWolves ? nightMs * 0.55 : 9000 + j * 4000);
                push(bot, 'night', offset);
                return;
            }
            if (need === 'act') push(bot, 'night', ENV_BOT_MS ? fast(1 + j) : 3000 + j * 6000);
            else push(bot, 'ready', ENV_BOT_MS ? fast(1.5 + j) : 4000 + j * 8000);
        } else if (state.phase === 'day-discussion') {
            const chatKey = `${state.dayNumber}:${bot.playerId}`;
            const wantsChat = hashOf(`chat:${room.roomId}:${chatKey}`) < 0.35;
            if (wantsChat && !b.chat[chatKey] && (b.chat[`n:${state.dayNumber}`] || 0) < MAX_CHAT_PER_DAY) {
                push(bot, 'chat', ENV_BOT_MS ? fast(0.5 + j) : 6000 + j * 20000);
            }
            if (!state.discussionSkips?.[bot.playerId]) {
                push(bot, 'discuss', ENV_BOT_MS ? fast(2 + j) : RECAP_MS + Math.min(45000, dayMs * 0.25) + j * 10000);
            }
        } else if (state.phase === 'day-vote') {
            if (state.dayVotes?.[bot.playerId] || state.dayActionUsedBy?.[bot.playerId]) return;
            push(bot, 'vote', ENV_BOT_MS ? fast(1 + j) : 3000 + j * 9000);
        }
    });
    return list.sort((x, y) => x.dueAt - y.dueAt);
}

function botNeedsTurn(room) {
    return pendingBotDecisions(room).length > 0;
}

function botDelay(room, now = Date.now()) {
    const next = pendingBotDecisions(room, now)[0];
    if (!next) return null;
    return Math.max(80, next.dueAt - now);
}

function chatLine(state, bot) {
    const index = Math.floor(hashOf(`line:${state.dayNumber}:${bot.playerId}`) * CHAT_LINES.length);
    return CHAT_LINES[index];
}

function actOnce(room, decision, rng, chats) {
    const bot = getPlayer(room, decision.botId);
    if (!bot || bot.alive === false) return false;
    const state = room.gameState;
    switch (decision.kind) {
        case 'night': {
            const changed = runNightAct(room, bot, rng);
            if (room.gameState.phase === 'night') engine.maybeAutoEndNight(room);
            return changed;
        }
        case 'ready': {
            const changed = pressReady(room, bot);
            if (room.gameState.phase === 'night') engine.maybeAutoEndNight(room);
            return changed;
        }
        case 'chat': {
            const b = brain(state);
            const key = `${state.dayNumber}:${bot.playerId}`;
            b.chat[key] = true;
            b.chat[`n:${state.dayNumber}`] = (b.chat[`n:${state.dayNumber}`] || 0) + 1;
            if (state.phase === 'day-discussion' && bot.alive !== false) chats.push({ playerId: bot.playerId, text: chatLine(state, bot) });
            return true;
        }
        case 'discuss':
            return runDiscuss(room, bot, rng);
        case 'vote':
            return runVote(room, bot, rng);
        default:
            return false;
    }
}

/**
 * ให้บอทที่ถึงเวลาทำงาน — หยุดเมื่อเฟสเปลี่ยน
 * @returns {{changed: boolean, chats: Array<{playerId, text}>}}
 */
function playBotTurns(room, options = {}) {
    const rng = options.rng || Math.random;
    const now = options.now || Date.now();
    const result = { changed: false, chats: [] };
    const state = room?.gameState;
    if (!state || state.winner) return result;
    const key = phaseKey(state);
    const tried = new Set();
    for (let guard = 0; guard < 40; guard += 1) {
        if (room.gameState.winner || phaseKey(room.gameState) !== key) break;
        const ready = pendingBotDecisions(room, now)
            .filter(item => (options.force || item.dueAt <= now) && !tried.has(`${item.botId}:${item.kind}`));
        if (!ready.length) break;
        const decision = ready[0];
        tried.add(`${decision.botId}:${decision.kind}`);
        if (actOnce(room, decision, rng, result.chats)) result.changed = true;
    }
    return result;
}

module.exports = {
    isBotId,
    observe,
    pendingBotDecisions,
    botNeedsTurn,
    botDelay,
    playBotTurns,
    CHAT_LINES,
    // ให้เทสเรียกตรง
    voteScore,
    planNight,
    nightNeed
};
