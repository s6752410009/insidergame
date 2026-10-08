/**
 * บอทหมาป่า — เล่นได้ทุกบท (รวม 5 บทใหม่) 3–20 คน · คิดแบบผู้เล่นที่มีประสบการณ์
 *
 * ข้อมูลที่บอทใช้ = ข้อมูลที่ "ผู้เล่นที่นั่งตรงนั้น" เห็นได้จริงเท่านั้น
 *   - บทของตัวเอง + ผลตรวจของตัวเอง (ผู้หยั่งรู้/ศิษย์/นักพยากรณ์) + รายชื่อบทในเกม (ทุกคนเห็น)
 *   - หมาป่ารู้จักเพื่อนหมาป่า + รู้ว่าเมื่อคืนฝูงกัดใคร (หน้าจอหมาป่าก็เห็น) · แม่มดเห็นเหยื่อที่หมาป่าเล็ง
 *   - ของสาธารณะ: ใครตาย ตายเพราะอะไร ใครโหวตใคร (และเปลี่ยนโหวต) นายก/เจ้าชายที่เปิดตัว
 *     บทคนตายถ้าห้องเปิด "เปิดบทเมื่อตาย" · ผลจอมเปิดโปง · สิ่งที่ทุกคนพูดในแชทกลางวัน (อ้างบท/ผลตรวจ/ชี้ตัว)
 *
 * การอ่านเกม: แต่ละคนมีความน่าจะเป็น หมาป่า / คนบ้า / ฆาตกร / ชาวบ้าน
 *   เริ่มจากจำนวนบทที่เหลือ แล้วปรับด้วยหลักฐาน: ผลตรวจของตัวเอง · ผลตรวจที่คนอื่นอ้าง (ถ่วงด้วยความน่าเชื่อของคนอ้าง)
 *   · อ้างบทซ้ำกัน/ขัดกับบทที่เปิด · ตายตอนกลางคืนเพราะหมาป่า (= คนนั้นพูดจริง) · โหวตปกป้องคนที่น่าจะเป็นหมาป่า
 *   · ท่าทีคนบ้า (ขอให้โหวต อ้างตัวเป็นหมาป่า โดนรุมแล้วไม่แก้ตัว)
 * การโหวต: คิดเป็นกำไร/ขาดทุน — ไล่หมาป่า +, ไล่ชาวบ้าน −, ไล่คนบ้า = แพ้ทั้งโต๊ะ (−มาก) · ไม่มีหลักฐานพอ → ข้าม
 *   (ยกเว้นหมาป่าใกล้ครองเมือง) · โหวตแล้วเปลี่ยนได้เมื่อเห็นข้อมูลใหม่ (วงโหวตเปลี่ยน/มีคนอ้างบท)
 *
 * ฝั่งหมู่บ้านมีนิสัยต่างกัน (PERSONAS: รอบคอบ / ใจร้อน / ตามกระแส) — เชื่อคำอ้างไม่เท่ากัน ต้องการหลักฐานไม่เท่ากัน
 *   ตามวงโหวตไม่เท่ากัน บางคนพลาดผลตรวจในแชท · ผู้หยั่งรู้รอบคอบเก็บผลไว้ก่อน ใจร้อนเปิดทันที
 *   (ทั้งวงจึงไม่โหวตพร้อมกันเหมือนสมองเดียว) · กลางคืนคิดคนเดียวได้รอบคอบ นิสัยไม่มีผล
 * ฝูงหมาป่าเล่นเป็นทีม (ใช้แค่ที่ฝูงรู้จริง = ใครเป็นพวก): ตกลงกันว่าใครเป็นคนอ้างบทปลอม (ผู้หยั่งรู้/นักพยากรณ์) ทีละตัว
 *   · โหวตตามวงของคนนอกฝูง ไม่รุมเป้าเดียวกันเป็นก้อน ไม่เป็นคนเดียวที่โหวตใคร · ทิ้งเพื่อน (bus) เฉพาะตอนที่เพื่อนโดนไล่แน่แล้ว
 *   · กลางคืนกัดคนที่น่าเชื่อ/ตัวตรวจ แต่ไม่กัดคนที่ฝูงเคยโหวตไล่ คนที่ตัวปลอมบอกว่า "ไม่ดี" หรือคนที่หมู่บ้านกำลังสงสัย
 *
 * แชทของบอทเป็นประโยคสั้นจากชุดแม่แบบ (CHAT_LINES + CHAT_TEMPLATES) ใส่ได้แค่ชื่อผู้เล่น/ชื่อบท/ผลตรวจ
 *   — ไม่มีประโยคที่บอกว่าใครเป็นเพื่อนหมาป่า · บอทที่ตายแล้วเงียบ · คนละไม่เกิน 2 ประโยคต่อวัน
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
const MAX_CHAT_PER_BOT = 2;
const MAX_NEUTRAL_PER_DAY = 3; // ประโยคทักทาย/กลางๆ ทั้งวงไม่เกิน 3 (เรื่องสำคัญ เช่น เปิดผลตรวจ ไม่นับ)

// น้ำหนักการตัดสินใจโหวต (หน่วย = "ไล่หมาป่าได้ 1 ตัว")
const FOOL_COST = 2.5;     // ไล่คนบ้า = คนบ้าชนะทันที ทุกคนแพ้ (ยังกลัวพอให้คนบ้าชนะไม่ถึง 10%)
const MISLYNCH_COST = 0.3; // ไล่ชาวบ้านผิดตัว
// หมาป่า (ปรับด้วย npm run sim:werewolf:bots ให้หมาป่าชนะราว 45–50% ในโต๊ะไม่มีบทเดี่ยว)
const BUS_RATE = 0.75;      // โอกาสที่หมาป่าแต่ละตัวโหวตทิ้งเพื่อนที่รอดไม่ได้แล้ว (โหวตคนนอกฝูงพอไล่อยู่แล้ว / โดนเปิดโปง)
const WOLF_BAND = 1.0;      // น้ำหนักการตามวงโหวตของคนนอกฝูง (กลมกลืน)
const WOLF_STACK = 0.35;    // โทษของการรุมเป้าเดียวกับเพื่อนในฝูงทั้งที่ไม่มีคนนอกฝูงโหวตด้วย
const WOLF_SOLO = 0.4;      // ไม่อยากเป็นคนเดียวที่โหวตใคร (ไม่มีใครนอกฝูงโหวตด้วย) — ข้ามดีกว่า
const SEER_PUSH = 0.8;      // อยากไล่ผู้หยั่งรู้ที่น่าเชื่อ — เต็มที่ก็ต่อเมื่อหมู่บ้านโหวตเขาอยู่แล้ว
const NIGHT_OWNVOTE = 1.0;  // ไม่กัดคนที่ฝูงเคยโหวตไล่ (กัดแล้วคนโหวตเขาดูเป็นหมาป่าทันที)
const NIGHT_HEAT = 0.5;     // ไม่กัดคนที่หมู่บ้านกำลังสงสัย — ปล่อยให้หมู่บ้านไล่เอง
const FAKE_COUNTER = 0.9;   // ผู้หยั่งรู้จริงชี้เพื่อนในฝูง → ตัวที่ฝูงเลือกอ้างแย้ง
const FAKE_LATER = 0.14;    // ยังไม่มีใครอ้าง (วันที่ 2 ขึ้นไป) → ชิงอ้างก่อน

// ประโยคกลางๆ ไม่อ้างบท ไม่ชี้ตัวใคร
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

// แม่แบบที่อ้างชื่อได้ — {a}/{b} = ชื่อผู้เล่น · {role} = ชื่อบท · {r} = รายการผลตรวจ "ชื่อ ผล · ชื่อ ผล"
const CHAT_TEMPLATES = {
    seerClaim: ['🔮 ผมเป็นผู้หยั่งรู้ ผลตรวจ: {r}'],
    apprenticeClaim: ['🧿 ผมเป็นศิษย์ผู้หยั่งรู้ ผลตรวจ: {r}'],
    oracleClaim: ['✨ ผมเป็นนักพยากรณ์ ผลตรวจ: {r}'],
    counter: ['{a} โกหก! ผมต่างหากที่เป็น{role}'],
    defend: ['ผมเป็น{role}นะ อย่าโหวตผมเลย 🙏'],
    accuse: ['ผมสงสัย {a} นะ 🤔', 'วันนี้ผมจะโหวต {a}', '{a} ดูมีพิรุธที่สุดแล้วตอนนี้'],
    bloc: ['{a} โหวตปกป้อง {b} ตลอด 🤔', '{a} กับ {b} โหวตไปทางเดียวกันตลอดเลยนะ'],
    trustDead: ['{a} โดนหมาป่ากัดตาย แปลว่าที่อ้างไว้น่าจะจริง'],
    foolWarn: ['{a} ดูอยากโดนโหวตเกินไป ระวังคนบ้านะ 🤪', 'อย่าเพิ่งไล่ {a} หลักฐานยังไม่พอ กลัวโดนคนบ้าหลอก'],
    noLynch: ['มีคนบ้าในเกม ไม่ชัวร์อย่าโหวตมั่วนะ', 'ยังไม่มีหลักฐาน ข้ามไปก่อนดีกว่า'],
    foolSubtle: ['เอ่อ... ผมไม่รู้จะพูดอะไรดี 😶', 'ทำไมทุกคนมองผมแบบนั้นล่ะ 😅', 'ผมก็น่าสงสัยนิดนึงแหละ ยอมรับ'],
    foolBeg: ['โหวตผมก็ได้นะ ไม่ว่ากัน 😏', 'ใครกล้าโหวตผมบ้าง? 😈'],
    foolWolf: ['ผมอาจจะเป็นหมาป่าก็ได้นะ 555']
};

// ท่าทีคนบ้า: น้ำหนักหลักฐาน (log-odds ของ "เป็นคนบ้า")
const TELL_WEIGHT = { foolSubtle: 0.45, foolBeg: 1.4, foolWolf: 1.8, humanBeg: 1.3, humanWolf: 1.8 };

const SEER_ROLES = ['seer', 'apprenticeSeer', 'oracle'];
const POWER_ROLES = ['seer', 'apprenticeSeer', 'oracle', 'doctor', 'bodyguard', 'witch', 'hunter', 'vigilante', 'tracker', 'cleric', 'revealer', 'mayor', 'prince', 'diseased', 'lycan'];

// นิสัยของบอทฝั่งหมู่บ้าน (คงที่ทั้งเกม เดาจาก id ห้อง+ผู้เล่น ไม่ได้ดูบทใคร) — ทำให้ทั้งวงไม่คิดเหมือนกันเป๊ะ
//   trust = เชื่อคำอ้างง่าย/ยาก · skip = ต้องมีหลักฐานแค่ไหนถึงยอมโหวต · band = ตามวงโหวตแค่ไหน
//   history = ดูประวัติโหวตละเอียดแค่ไหน · attention = โอกาสที่ทันเห็นผลตรวจแต่ละอันในแชท
const PERSONAS = {
    cautious: { trust: -0.08, skip: 0.12, band: 0.7, history: 0.85, attention: 0.95, reveal: 0.15 },
    aggressive: { trust: 0, skip: -0.12, band: 0.9, history: 0.45, attention: 0.85, reveal: 0.7 },
    follower: { trust: 0.12, skip: 0, band: 1.6, history: 0.2, attention: 0.5, reveal: 0.35 }
};
const TRUST_SPREAD = 0.6;   // แต่ละคนเชื่อคนอ้างแต่ละคนต่างกันได้ ±0.3

function personaOf(room, bot) {
    if (!bot || isWolf(bot) || bot.role === 'fool') return null;
    const h = hashOf(`persona:${room.roomId}:${bot.playerId}`);
    return PERSONAS[h < 0.34 ? 'cautious' : (h < 0.67 ? 'aggressive' : 'follower')];
}

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

function escapeHtml(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPlayer(room, playerId) {
    return (room?.gameState?.players || []).find(p => p.playerId === playerId) || null;
}

function alivePlayers(room) {
    return room.gameState.players.filter(p => p.alive !== false);
}

const isWolf = player => !!player && engine.isWerewolfRole(player.role);

function roleCat(roleId) {
    if (engine.isWerewolfRole(roleId)) return 'W';
    if (roleId === 'fool') return 'F';
    if (roleId === 'serialKiller') return 'S';
    return 'V';
}

function roleThai(roleId) {
    return engine.ROLE_DEFINITIONS[roleId]?.thaiName || roleId;
}

// ---------- ความจำของบอท (เก็บใน gameState แต่ไม่เคยถูกส่งให้หน้าเว็บ) ----------
//   ของสาธารณะ: votes/firstVotes/switches/claims/tells/accuse/deaths/known/notWolf
//   ของฝูงหมาป่า (อ่านได้เฉพาะบอทหมาป่า): pack · ของบอทแต่ละตัว: mine[botId]

function brain(state) {
    if (!state.botBrain || typeof state.botBrain !== 'object') state.botBrain = {};
    const b = state.botBrain;
    ['votes', 'firstVotes', 'switches', 'claims', 'tells', 'accuse', 'deaths', 'known', 'notWolf', 'chat', 'mine', 'voted'].forEach(key => {
        if (!b[key] || typeof b[key] !== 'object') b[key] = {};
    });
    if (!b.pack || typeof b.pack !== 'object') b.pack = { attacks: {}, survivors: {}, fakeClaimer: null };
    if (!b.clock) b.clock = { key: null, at: 0 };
    if (!b.seq) b.seq = 0;
    return b;
}

function mine(b, botId) {
    if (!b.mine[botId]) b.mine[botId] = {};
    return b.mine[botId];
}

function phaseKey(state) {
    return `${state.phase}:${state.dayNumber}`;
}

function recordDeaths(room, b) {
    const state = room.gameState;
    const revealOnDeath = room.settings?.werewolfRevealOnDeath === true;
    const nightEvents = state.lastResolvedNight?.publicEvents || [];
    const dayInfo = state.lastResolvedDay || null;
    state.players.forEach(player => {
        if (player.alive !== false || b.deaths[player.playerId]) return;
        const nightEvent = nightEvents.find(event => event && event.playerId === player.playerId);
        let cause = 'other';
        if (nightEvent) cause = nightEvent.cause || 'night';
        else if (dayInfo && dayInfo.eliminatedPlayerId === player.playerId) cause = 'vote';
        b.deaths[player.playerId] = { day: Number(state.dayNumber) || 0, cause };
        if (revealOnDeath) b.known[player.playerId] = player.role;
    });
    // จอมเปิดโปง: ผลประกาศเป็นชื่อ (ทุกคนเห็น)
    (dayInfo?.publicEvents || []).forEach(event => {
        if (!event || (event.type !== 'reveal-hit' && event.type !== 'reveal-miss')) return;
        const text = `${event.lead || ''} ${event.detail || ''}`;
        const lead = String(event.lead || '');
        const named = state.players.filter(p => p.name && text.includes(p.name)).sort((x, y) => y.name.length - x.name.length);
        const actor = named.find(p => lead.startsWith(p.name)) || null;
        const target = named.find(p => p !== actor) || null;
        if (event.type === 'reveal-hit' && target && !b.known[target.playerId]) b.known[target.playerId] = 'werewolf';
        if (event.type === 'reveal-miss') {
            if (actor) b.known[actor.playerId] = 'revealer';
            if (target) b.notWolf[target.playerId] = true;
        }
    });
}

/** จดสิ่งที่ทุกคนเห็น + เวลาที่เฟสนี้เริ่ม (จากมุมบอท) · หมาป่าจดเป้าที่ฝูงกัด */
function observe(room, now = Date.now()) {
    const state = room?.gameState;
    if (!state || state.mode !== 'werewolf') return;
    const b = brain(state);
    const key = phaseKey(state);
    if (b.clock.key !== key) {
        // เช้าใหม่: เป้าที่ฝูงกัดเมื่อคืนยังรอด = มีคนคุ้มกัน หรือเป็นคนบ้า/ฆาตกร (ความรู้ของฝูงเท่านั้น)
        if (state.phase === 'day-discussion') {
            const target = b.pack.attacks[String(state.dayNumber)];
            const victim = target ? getPlayer(room, target) : null;
            if (victim && victim.alive !== false) b.pack.survivors[target] = (b.pack.survivors[target] || 0) + 1;
        }
        b.clock = { key, at: now };
    }
    recordDeaths(room, b);
    if (state.phase === 'night' && engine.canWolvesHuntTonight(room)) {
        const pick = wolfPackPick(room);
        if (pick) b.pack.attacks[String(state.dayNumber)] = pick;
    }
    if (state.phase === 'day-vote' && state.dayVotes) {
        const day = String(state.dayNumber);
        const cur = b.votes[day] || (b.votes[day] = {});
        const first = b.firstVotes[day] || (b.firstVotes[day] = {});
        const sw = b.switches[day] || (b.switches[day] = {});
        Object.entries(state.dayVotes).forEach(([voterId, targetId]) => {
            if (!(voterId in first)) first[voterId] = targetId;
            else if (cur[voterId] !== undefined && cur[voterId] !== targetId) sw[voterId] = (sw[voterId] || 0) + 1;
            cur[voterId] = targetId;
        });
        Object.keys(cur).forEach(voterId => { if (!(voterId in state.dayVotes)) delete cur[voterId]; });
        const days = Object.keys(b.votes).map(Number).sort((x, y) => x - y);
        while (days.length > 14) {
            const old = String(days.shift());
            delete b.votes[old];
            delete b.firstVotes[old];
            delete b.switches[old];
        }
    }
}

// ---------- แชทของคนจริง → ข้อมูลสาธารณะ (อ้างบท / ผลตรวจ / ชี้ตัว / ท่าทีคนบ้า) ----------

const SELF = '(?:ผม|ฉัน|เรา|หนู|กู|ข้า)';

function namesIn(room, text, exceptId) {
    const found = [];
    room.gameState.players
        .filter(p => p.playerId !== exceptId)
        .sort((x, y) => String(y.name).length - String(x.name).length)
        .forEach(p => {
            const name = String(p.name || '');
            if (name.length < 2) return;
            let at = text.indexOf(name);
            let used = name;
            if (at < 0) { used = escapeHtml(name); at = text.indexOf(used); }
            if (at >= 0 && !found.some(f => at >= f.at && at < f.at + f.name.length)) found.push({ player: p, at, name: used });
        });
    return found.sort((x, y) => x.at - y.at);
}

function addClaim(b, playerId, role, results, day) {
    const claim = b.claims[playerId];
    if (claim && claim.role === role) {
        Object.assign(claim.results, results || {});
        return claim;
    }
    b.seq += 1;
    b.claims[playerId] = { role, day, seq: b.seq, results: { ...(results || {}) } };
    return b.claims[playerId];
}

function addTell(b, playerId, weight) {
    b.tells[playerId] = Math.min(4, (b.tells[playerId] || 0) + weight);
}

/** app เรียกเมื่อคนจริงพิมพ์แชทสาธารณะช่วงกลางวัน — อ่านแบบหยาบๆ เหมือนคนฟัง */
function noteChat(room, playerId, text) {
    const state = room?.gameState;
    if (!state || state.mode !== 'werewolf' || !['day-discussion', 'day-vote'].includes(state.phase)) return;
    const speaker = getPlayer(room, playerId);
    if (!speaker || speaker.alive === false || isBotId(playerId)) return;
    const raw = String(text || '').slice(0, 300);
    const lower = raw.toLowerCase();
    const b = brain(state);
    const day = Number(state.dayNumber) || 0;
    const named = namesIn(room, raw, playerId);
    const claimsRole = thai => new RegExp(`${SELF}\\s*(?:เป็น|คือ)\\s*${thai}`).test(lower);

    if (new RegExp(`${SELF}\\s*(?:เป็น|คือ)\\s*หมาป่า`).test(lower)) {
        addTell(b, playerId, TELL_WEIGHT.humanWolf);
        b.tells[playerId + ':wolf'] = 1;
    }
    if (new RegExp(`(?:โหวต|ไล่|เอา)\\s*${SELF}(?:\\s|$|ออก|เลย|ก็|ได้)`).test(lower) && !/อย่า\s*(?:โหวต|ไล่|เอา)/.test(lower)) {
        addTell(b, playerId, TELL_WEIGHT.humanBeg);
    }

    const seerLike = [['apprenticeSeer', 'ศิษย์ผู้หยั่งรู้'], ['seer', 'ผู้หยั่งรู้'], ['oracle', 'นักพยากรณ์']];
    for (const [roleId, thai] of seerLike) {
        if (!claimsRole(thai)) continue;
        const results = {};
        named.forEach((entry, index) => {
            const tail = raw.slice(entry.at + entry.name.length, named[index + 1] ? named[index + 1].at : raw.length);
            if (roleId === 'oracle') {
                const hit = Object.values(engine.ROLE_DEFINITIONS).sort((x, y) => y.thaiName.length - x.thaiName.length).find(def => tail.includes(def.thaiName));
                if (/ไม่ทราบ|\?/.test(tail)) results[entry.player.playerId] = 'unknown';
                else if (hit) results[entry.player.playerId] = hit.id;
            } else if (/ไม่ดี|ร้าย|หมาป่า|❌/.test(tail)) results[entry.player.playerId] = 'bad';
            else if (/ไม่ทราบ|ไม่รู้|\?/.test(tail)) results[entry.player.playerId] = 'unknown';
            else if (/ดี|ขาว|✅/.test(tail)) results[entry.player.playerId] = 'good';
        });
        addClaim(b, playerId, roleId, results, day);
        return;
    }
    const roleClaim = Object.values(engine.ROLE_DEFINITIONS)
        .filter(def => roleCat(def.id) === 'V')
        .sort((x, y) => y.thaiName.length - x.thaiName.length)
        .find(def => claimsRole(def.thaiName));
    if (roleClaim) addClaim(b, playerId, roleClaim.id, {}, day);
    const accused = named.find(entry => /(?:โหวต|สงสัย|ไล่)\s*$/.test(raw.slice(Math.max(0, entry.at - 8), entry.at)));
    if (accused) {
        const today = b.accuse[String(day)] || (b.accuse[String(day)] = {});
        today[playerId] = accused.player.playerId;
    }
}

// ---------- การอ่านเกม ----------

function planInfo(room) {
    const state = room.gameState;
    const ids = (state.rolePlan || []).map(role => role && role.id).filter(Boolean);
    const count = {};
    ids.forEach(id => { count[id] = (count[id] || 0) + 1; });
    const n = state.players.length;
    const W = (count.werewolf || 0) + (count.alphaWolf || 0);
    const F = count.fool || 0;
    const S = count.serialKiller || 0;
    return { count, n, W, F, S, V: Math.max(1, n - W - F - S), alpha: count.alphaWolf || 0, lycan: count.lycan || 0 };
}

function roleCount(P, roleId) {
    if (roleId === 'villager') return P.n;
    return P.count[roleId] || 0;
}

function knownRole(room, b, player) {
    if (!player) return null;
    if (player.mayorRevealed) return 'mayor';
    if (player.princeRevealed) return 'prince';
    if (room.settings?.werewolfRevealOnDeath === true && player.alive === false) return player.role;
    return b.known[player.playerId] || null;
}

function seerLR(code, P) {
    if (code === 'bad') return { W: 1, S: P.S ? 1 : 0, F: 0, V: P.lycan ? P.lycan / P.V : 0 };
    if (code === 'good') return { W: 0, S: 0, F: 0, V: 1 };
    if (code === 'unknown') return { W: P.W ? P.alpha / P.W : 0, S: 0, F: P.F ? 1 : 0, V: 0 };
    return null;
}

function oracleLR(roleId, P) {
    if (!roleId) return null;
    if (roleId === 'unknown') return seerLR('unknown', P);
    const cat = roleCat(roleId);
    return { W: cat === 'W' ? 1 : 0, S: cat === 'S' ? 1 : 0, F: cat === 'F' ? 1 : 0, V: cat === 'V' ? 1 : 0 };
}

function resultLR(role, code, P) {
    return role === 'oracle' ? oracleLR(code, P) : seerLR(code, P);
}

/** ผลตรวจสองแบบขัดกันไหม (ผู้หยั่งรู้ ดี/ไม่ดี/ไม่ทราบ · นักพยากรณ์ = บทจริง) */
function resultsConflict(roleA, codeA, roleB, codeB, P) {
    const a = resultLR(roleA, codeA, P);
    const c = resultLR(roleB, codeB, P);
    if (!a || !c) return false;
    return !['W', 'F', 'S', 'V'].some(cat => a[cat] > 0 && c[cat] > 0);
}

function ownResults(bot) {
    const out = [];
    (bot.seerHistory || []).forEach(entry => out.push({ role: 'seer', target: entry.targetPlayerId, code: entry.resultCode, day: entry.dayNumber }));
    (bot.oracleHistory || []).forEach(entry => out.push({ role: 'oracle', target: entry.targetPlayerId, code: entry.roleId, day: entry.dayNumber }));
    return out;
}

function isBadCode(code) {
    return code === 'bad' || roleCat(code) === 'W' || code === 'serialKiller';
}

function consistentWithRole(role, code, actualRole, P) {
    const lr = resultLR(role, code, P);
    if (!lr) return true;
    if (actualRole === 'lycan') return role === 'oracle' ? code === 'lycan' : code === 'bad';
    if (actualRole === 'alphaWolf' && role !== 'oracle') return code === 'unknown';
    return lr[roleCat(actualRole)] > 0;
}

/** ความน่าเชื่อของทุกคนที่อ้างบท (0–1) จากมุมของบอทตัวนี้ */
function credibilities(room, b, bot, P, careful = false) {
    const byRole = {};
    Object.entries(b.claims).forEach(([id, claim]) => { (byRole[claim.role] || (byRole[claim.role] = [])).push(id); });
    const own = ownResults(bot);
    const wolfBot = isWolf(bot);
    const pp = careful ? null : personaOf(room, bot);
    const out = {};
    Object.entries(byRole).forEach(([role, ids]) => {
        ids.sort((x, y) => b.claims[x].seq - b.claims[y].seq);
        const k = roleCount(P, role);
        ids.forEach((id, index) => {
            const claim = b.claims[id];
            const player = getPlayer(room, id);
            let kappa;
            if (!k) kappa = 0.03;
            else if (ids.length <= k) kappa = role === 'villager' ? 0.5 : (SEER_ROLES.includes(role) ? 0.72 : 0.65);
            else kappa = Math.min(0.7, (k / ids.length) * (index < k ? 1.25 : 0.75));
            // คนแต่ละแบบเชื่อคำอ้างไม่เท่ากัน (คนตามกระแสเชื่อง่าย คนรอบคอบเชื่อยาก) — เฉพาะความน่าเชื่อตั้งต้น หลักฐานแข็งด้านล่างยังชนะ
            if (pp && id !== bot.playerId && kappa > 0.05) {
                kappa = Math.min(0.85, Math.max(0.05, kappa + pp.trust + TRUST_SPREAD * (hashOf(`trust:${bot.playerId}>${id}`) - 0.5)));
            }
            const death = b.deaths[id];
            if (death && death.cause === 'wolf-attack' && role !== 'villager') kappa = Math.max(kappa, 0.9);
            Object.entries(claim.results || {}).forEach(([targetId, code]) => {
                const target = getPlayer(room, targetId);
                const actual = knownRole(room, b, target);
                if (actual) {
                    kappa = consistentWithRole(role, code, actual, P) ? Math.min(0.97, kappa + 0.15) : 0.03;
                } else if (isBadCode(code) && b.deaths[targetId]?.cause === 'wolf-attack' && !P.lycan) {
                    kappa = Math.min(kappa, 0.08); // หมาป่าไม่กัดพวกเดียวกัน
                } else if (isBadCode(code) && b.notWolf[targetId] && !P.lycan && !P.S) {
                    kappa = Math.min(kappa, 0.08);
                }
            });
            const actualSelf = knownRole(room, b, player);
            if (actualSelf) kappa = actualSelf === role ? 1 : 0;
            if (id !== bot.playerId) {
                if (bot.role === role && k <= 1) kappa = 0;
                own.forEach(result => {
                    if (result.target === id) {
                        const lr = resultLR(result.role, result.code, P);
                        if (lr && lr.V === 0) kappa = Math.min(kappa, 0.05);
                        else if (lr && lr.W === 0 && lr.F === 0 && lr.S === 0) kappa = Math.max(kappa, role === 'villager' ? 0.6 : 0.85);
                    }
                    const theirs = claim.results ? claim.results[result.target] : undefined;
                    if (theirs !== undefined && result.target !== id) {
                        if (resultsConflict(role, theirs, result.role, result.code, P)) kappa = 0.03;
                        else kappa = Math.min(0.95, kappa + 0.08);
                    }
                });
                if (wolfBot && isWolf(player)) kappa = 0;
            }
            out[id] = kappa;
        });
        // บทมีใบเดียวแต่อ้างหลายคน: ถ้าคนหนึ่งยืนยันแล้ว (ตายเพราะหมาป่า/ผลตรงบทที่เปิด) อีกคนโกหก
        if (k === 1 && ids.length > 1) {
            const confirmed = ids.filter(id => out[id] >= 0.88);
            if (confirmed.length === 1) ids.forEach(id => { if (id !== confirmed[0]) out[id] = Math.min(out[id], 0.08); });
            if (wolfBot) {
                const fake = ids.filter(id => isWolf(getPlayer(room, id)));
                if (fake.length) ids.forEach(id => { if (!fake.includes(id)) out[id] = 1; });
            }
        }
    });
    return out;
}

function normalize(vec) {
    const sum = vec.W + vec.F + vec.S + vec.V;
    if (!(sum > 0)) return null;
    return { W: vec.W / sum, F: vec.F / sum, S: vec.S / sum, V: vec.V / sum };
}

function applyLR(post, lr, weight = 1) {
    if (!lr) return post;
    return normalize({
        W: post.W * (weight * lr.W + (1 - weight)),
        F: post.F * (weight * lr.F + (1 - weight)),
        S: post.S * (weight * lr.S + (1 - weight)),
        V: post.V * (weight * lr.V + (1 - weight))
    }) || post;
}

/** คำอ้างที่จริงด้วยโอกาส k: ผลลัพธ์ = k × (เชื่อเต็มที่) + (1−k) × (ไม่ได้ข้อมูลอะไร) */
function mixClaim(post, lr, k) {
    if (!lr) return post;
    const believed = applyLR(post, lr, 1);
    return {
        W: k * believed.W + (1 - k) * post.W,
        F: k * believed.F + (1 - k) * post.F,
        S: k * believed.S + (1 - k) * post.S,
        V: k * believed.V + (1 - k) * post.V
    };
}

function scale(post, factors) {
    return normalize({
        W: post.W * (factors.W ?? 1),
        F: post.F * (factors.F ?? 1),
        S: post.S * (factors.S ?? 1),
        V: post.V * (factors.V ?? 1)
    }) || post;
}

function dayVotesList(b) {
    return Object.entries(b.votes).map(([day, votes]) => ({ day: Number(day), votes }));
}

/**
 * ความน่าจะเป็นของทุกคนที่ยังมีชีวิต (นอกจากตัวเอง) จากมุมของบอท
 * คืน { map: Map playerId → { W, F, S, V, hard, protects, reasons }, kappa, P }
 */
function assess(room, bot, careful = false) {
    const state = room.gameState;
    const b = brain(state);
    const P = planInfo(room);
    const day = Number(state.dayNumber) || 0;
    const wolfBot = isWolf(bot);
    // careful = คิดกลางคืนตามลำพัง (ทบทวนแชทได้ครบ ไม่โดนวงโหวตพาไป) — นิสัยไม่มีผล
    const pp = careful ? null : personaOf(room, bot);
    const kappa = credibilities(room, b, bot, P, careful);
    const others = state.players.filter(p => p.alive !== false && p.playerId !== bot.playerId);

    // ---- จำนวนบทที่น่าจะยังรอด (ในกลุ่มที่ยังไม่รู้บท) ----
    const rem = { W: P.W, F: P.F, S: P.S };
    const selfCat = roleCat(bot.role);
    if (rem[selfCat] !== undefined) rem[selfCat] -= 1;
    const unknownAlive = [];
    state.players.forEach(player => {
        if (player.playerId === bot.playerId) return;
        const kr = knownRole(room, b, player);
        const cat = kr ? roleCat(kr) : (wolfBot && isWolf(player) ? 'W' : null);
        if (cat) {
            if (rem[cat] !== undefined) rem[cat] -= 1;
            return;
        }
        if (player.alive !== false) { unknownAlive.push(player); return; }
        // คนตายที่ไม่เปิดบท: ตายเพราะหมาป่า = ไม่ใช่หมาป่า/คนบ้า/ฆาตกร · โดนโหวต = ไม่ใช่คนบ้า (ไม่งั้นเกมจบแล้ว)
        const cause = b.deaths[player.playerId]?.cause;
        if (cause === 'wolf-attack') return;
        const share = 1 / Math.max(2, P.n - 1);
        if (!wolfBot) rem.W -= P.W * share;
        if (cause !== 'vote') rem.F -= P.F * share;
        rem.S -= P.S * share;
    });
    if (!wolfBot && rem.W + rem.S < 1 && !state.winner) rem.W = Math.max(rem.W, 1 - Math.max(0, rem.S));
    const pool = Math.max(1, unknownAlive.length);
    const prior = {
        W: wolfBot ? 0 : Math.min(0.9, Math.max(0, rem.W) / pool),
        F: Math.min(0.9, Math.max(0, rem.F) / pool),
        S: Math.min(0.9, Math.max(0, rem.S) / pool)
    };
    prior.V = Math.max(0.05, 1 - prior.W - prior.F - prior.S);

    const own = ownResults(bot);
    const results = new Map();
    const exact = cat => ({ W: cat === 'W' ? 1 : 0, F: cat === 'F' ? 1 : 0, S: cat === 'S' ? 1 : 0, V: cat === 'V' ? 1 : 0 });
    const votesByDay = dayVotesList(b).filter(({ day: d }) => !(d === day && state.phase === 'day-vote'));

    // ---- รอบ 1: หลักฐานแข็ง (ผลตรวจ / คำอ้าง / ท่าทีคนบ้า) ----
    others.forEach(target => {
        const id = target.playerId;
        const kr = knownRole(room, b, target);
        if (kr) { results.set(id, { ...exact(roleCat(kr)), hard: 1, known: true, protects: {}, reasons: {} }); return; }
        if (wolfBot && isWolf(target)) { results.set(id, { ...exact('W'), hard: 1, known: true, protects: {}, reasons: {} }); return; }
        let post = { ...prior };
        let hard = 0;
        const reasons = {};
        own.forEach(result => {
            if (result.target !== id) return;
            post = applyLR(post, resultLR(result.role, result.code, P), 1);
            hard = 1;
            reasons.own = result.code;
        });
        Object.entries(b.claims).forEach(([claimerId, claim]) => {
            if (claimerId === bot.playerId || claimerId === id || !claim.results || claim.results[id] === undefined) return;
            // ไม่ใช่ทุกคนตามแชททัน — บางคนพลาดผลตรวจบางอัน
            if (pp && hashOf(`att:${bot.playerId}>${claimerId}:${id}`) > pp.attention) return;
            const k = kappa[claimerId] ?? 0.5;
            if (k <= 0.05) return;
            post = mixClaim(post, resultLR(claim.role, claim.results[id], P), k * 0.95);
            hard = Math.max(hard, k);
            if (k >= 0.6) reasons.claimedBy = claimerId;
        });
        if (b.notWolf[id]) post = scale(post, { W: 0 });
        const tells = b.tells[id] || 0;
        if (tells > 0 && P.F) {
            post = scale(post, { F: Math.exp(tells), W: b.tells[id + ':wolf'] ? 0.4 : 1 });
            reasons.tells = tells;
        }
        if (wolfBot && b.pack.survivors[id]) post = scale(post, { F: 2.5 * b.pack.survivors[id], S: 2 });
        // โดนรุมโหวตแล้วไม่เคยแก้ตัว/อ้างบท — คนบ้าชอบแบบนี้
        if (P.F && !b.claims[id]) {
            let heatDays = 0;
            votesByDay.forEach(({ votes }) => {
                const voters = Object.keys(votes).length || 1;
                const onTarget = Object.values(votes).filter(t => t === id).length;
                if (onTarget / voters >= 0.3) heatDays += 1;
            });
            if (heatDays) post = scale(post, { F: Math.pow(1.35, Math.min(2, heatDays)) });
        }
        results.set(id, { ...post, hard, protects: {}, reasons });
    });

    // ---- คนที่อ้างบท: จริง (ชาวบ้าน) หรือโกหก (ส่วนใหญ่หมาป่า) ----
    others.forEach(target => {
        const entry = results.get(target.playerId);
        const claim = b.claims[target.playerId];
        if (!entry || entry.known || !claim) return;
        const k = kappa[target.playerId] ?? 0.5;
        const liar = normalize({ W: entry.W * 2.5, F: entry.F * (claim.role === 'villager' ? 0.6 : 0.25), S: entry.S * 0.8, V: entry.V * 0.25 }) || entry;
        ['W', 'F', 'S', 'V'].forEach(cat => { entry[cat] = k * (cat === 'V' ? 1 : 0) + (1 - k) * liar[cat]; });
        if (k <= 0.1 && claim.role !== 'villager') entry.hard = Math.max(entry.hard, 0.8);
        entry.reasons.claim = claim.role;
    });

    // ---- รอบ 2: พฤติกรรมโหวต (ใครปกป้องใคร / ใครผลักให้ไล่คนบริสุทธิ์) ----
    const likelyWolf = id => {
        const entry = results.get(id);
        if (entry) return entry.W;
        const kr = knownRole(room, b, getPlayer(room, id));
        if (kr) return roleCat(kr) === 'W' ? 1 : 0;
        return 0;
    };
    const likelyVillage = id => {
        const kr = knownRole(room, b, getPlayer(room, id));
        if (kr) return roleCat(kr) === 'V' ? 1 : 0;
        if (b.deaths[id]?.cause === 'wolf-attack') return 0.9;
        if ((kappa[id] ?? 0) >= 0.85) return 0.9;
        return 0;
    };
    others.forEach(target => {
        const entry = results.get(target.playerId);
        if (!entry || entry.known) return;
        const id = target.playerId;
        let factor = 1;
        votesByDay.forEach(({ votes }) => {
            const pick = votes[id];
            const voters = Object.keys(votes).length || 1;
            if (pick && pick !== SKIP) {
                if (likelyVillage(pick) >= 0.85) factor *= 1.35;   // ผลักให้ไล่คนที่ภายหลังรู้ว่าเป็นชาวบ้าน
                else if (likelyWolf(pick) >= 0.85) factor *= 0.7;  // ช่วยไล่หมาป่า
                if ((kappa[pick] ?? 0) >= 0.75 && SEER_ROLES.includes(b.claims[pick]?.role)) factor *= 1.3; // โหวตไล่ผู้หยั่งรู้ที่น่าเชื่อ
            }
            // ใครโดนรุม (≥ 40%) แล้วคนนี้ไม่ร่วม = ปกป้อง
            const tally = {};
            Object.values(votes).forEach(t => { if (t && t !== SKIP) tally[t] = (tally[t] || 0) + 1; });
            Object.entries(tally).forEach(([heated, n]) => {
                if (heated === id || n / voters < 0.4 || pick === heated || pick === undefined) return;
                entry.protects[heated] = (entry.protects[heated] || 0) + 1;
            });
        });
        Object.entries(entry.protects).forEach(([heated, n]) => {
            const w = likelyWolf(heated);
            if (w >= 0.6) {
                factor *= Math.pow(1 + 0.45 * w, n);
                entry.reasons.bloc = heated;
            }
        });
        // ไม่ใช่ทุกคนจำประวัติโหวตได้ละเอียด (คนตามกระแสแทบไม่ดู)
        if (pp) factor = Math.pow(factor, pp.history);
        const noise = Math.exp(0.5 * (hashOf(`${bot.playerId}>${id}@${day}`) - 0.5));
        const scaled = scale(entry, { W: factor * noise });
        Object.assign(entry, { W: scaled.W, F: scaled.F, S: scaled.S, V: scaled.V });
    });
    return { map: results, kappa, P, prior };
}

// ---------- กำไร/ขาดทุนของการโหวต ----------

/** วันติดกันที่ไม่มีใครตายเลย (เกมนิ่ง) */
function stallDays(room) {
    const b = brain(room.gameState);
    const day = Number(room.gameState.dayNumber) || 0;
    const lastDeath = Math.max(0, ...Object.values(b.deaths).map(d => Number(d.day) || 0));
    return Math.max(0, day - Math.max(1, lastDeath) - 1);
}

function urgency(room, bot, A) {
    const alive = alivePlayers(room).length;
    const wolves = isWolf(bot)
        ? alivePlayers(room).filter(isWolf).length
        : Math.max(1, Math.round([...A.map.values()].reduce((sum, e) => sum + e.W, 0)));
    // หลายวันแล้วไม่มีใครตายเลย (เกมนิ่ง) — ยิ่งนานยิ่งต้องเสี่ยงโหวตสักคน ไม่งั้นเกมไม่จบ
    const stallPressure = Math.min(2.5, 0.3 * stallDays(room));
    if (alive <= 2 * wolves + 1) return 1.4 + stallPressure;  // ไม่ไล่วันนี้ คืนนี้หมาป่าครองเมือง
    if (alive <= 2 * wolves + 3) return 0.35 + stallPressure;
    return stallPressure;
}

function liveVotes(room) {
    const tally = {};
    if (room.gameState.phase !== 'day-vote') return tally;
    Object.entries(room.gameState.dayVotes || {}).forEach(([voterId, targetId]) => {
        if (!targetId || targetId === SKIP) return;
        const voter = getPlayer(room, voterId);
        if (!voter || voter.alive === false) return;
        tally[targetId] = (tally[targetId] || 0) + (voter.mayorRevealed ? 2 : 1);
    });
    return tally;
}

const voteWeight = player => (player && player.mayorRevealed ? 2 : 1);

/**
 * วงโหวตวันนี้จากมุมฝูงหมาป่า (ฝูงรู้ว่าใครเป็นพวก — ข้อมูลที่ที่นั่งหมาป่าเห็นจริง)
 * tally = เสียงจากคนนอกฝูงต่อเป้า · mates = เพื่อนในฝูงที่โหวตเป้านั้นอยู่ · threshold = เสียงที่ต้องได้เพื่อไล่ออก
 */
function packVoteView(room) {
    const state = room.gameState;
    const alive = alivePlayers(room);
    const total = alive.reduce((sum, p) => sum + voteWeight(p), 0);
    const view = { tally: {}, mates: {}, voted: 0, total, threshold: Math.floor(total / 2) + 1 };
    if (state.phase !== 'day-vote') return view;
    Object.entries(state.dayVotes || {}).forEach(([voterId, targetId]) => {
        const voter = getPlayer(room, voterId);
        if (!voter || voter.alive === false) return;
        if (isWolf(voter)) {
            if (targetId && targetId !== SKIP) (view.mates[targetId] || (view.mates[targetId] = [])).push(voterId);
            return;
        }
        view.voted += voteWeight(voter);
        if (targetId && targetId !== SKIP) view.tally[targetId] = (view.tally[targetId] || 0) + voteWeight(voter);
    });
    return view;
}

/** เพื่อนหมาป่ารอดไม่ได้แล้วจากหลักฐานสาธารณะ: โดนเปิดโปง หรือเสียงคนนอกฝูงพอไล่ออกอยู่แล้วโดยไม่ต้องมีหมาป่าช่วย */
function mateDoomed(room, b, mate, view) {
    const kr = knownRole(room, b, mate);
    if (kr && roleCat(kr) === 'W') return true;
    return (view.tally[mate.playerId] || 0) >= view.threshold;
}

function accusationsToday(room, b) {
    const today = b.accuse[String(room.gameState.dayNumber)] || {};
    const count = {};
    Object.values(today).forEach(t => { count[t] = (count[t] || 0) + 1; });
    return count;
}

/** คะแนนของการโหวตแต่ละคน (ยิ่งมากยิ่งอยากไล่) */
function voteValues(room, bot, A) {
    const state = room.gameState;
    const b = brain(state);
    const live = liveVotes(room);
    const accused = accusationsToday(room, b);
    const alive = alivePlayers(room).length;
    const out = [];
    const wolfBot = isWolf(bot);
    const pack = wolfBot ? packVoteView(room) : null;
    const pp = personaOf(room, bot);
    const day = Number(state.dayNumber) || 0;
    // เกมนิ่งนานๆ ต้องยอมเสี่ยงมากขึ้น (กลัวคนบ้าน้อยลง) ไม่งั้นเกมไม่จบ
    const foolCost = FOOL_COST / (1 + 0.5 * stallDays(room));
    A.map.forEach((entry, id) => {
        const target = getPlayer(room, id);
        if (!target || target.alive === false) return;
        let ev;
        let band = ((live[id] || 0) / Math.max(1, alive)) * 0.6 + Math.min(3, accused[id] || 0) * 0.04;
        if (wolfBot && isWolf(target)) {
            // ทิ้งเพื่อน (bus): เฉพาะเมื่อเพื่อนรอดไม่ได้แล้วจากหลักฐานสาธารณะ และไม่ใช่ทุกตัว — โหวตร่วมแล้วดูเป็นชาวบ้าน
            if (!mateDoomed(room, b, target, pack) || hashOf(`bus:${bot.playerId}>${id}@${day}`) >= BUS_RATE) return;
            out.push({ id, ev: 0.9, band: 0.3, entry, bus: true });
            return;
        }
        if (wolfBot) {
            ev = entry.V * 0.6 + entry.S * 1.1 - entry.F * foolCost;
            // กลมกลืน: ตามวงที่คนนอกฝูงโหวตอยู่ · ไม่รุมเป้าเดียวกับเพื่อนถ้าคนอื่นไม่ได้โหวตด้วย (โหวตเป็นก้อน = โป๊ะ)
            band = ((pack.tally[id] || 0) / Math.max(1, alive)) * WOLF_BAND + Math.min(3, accused[id] || 0) * 0.04;
            const stacked = (pack.mates[id] || []).filter(m => m !== bot.playerId).length;
            if (stacked && !pack.tally[id]) ev -= WOLF_STACK * stacked;
            if (state.phase === 'day-vote' && !pack.tally[id]) ev -= WOLF_SOLO;
            const claim = b.claims[id];
            // ผู้หยั่งรู้ที่น่าเชื่อ: อยากไล่ แต่ร่วมก็ต่อเมื่อหมู่บ้านโหวตอยู่แล้ว (โหวตไล่ผู้หยั่งรู้คนเดียว = โป๊ะ)
            if (claim && SEER_ROLES.includes(claim.role) && (A.kappa[id] ?? 0) >= 0.5) {
                ev += SEER_PUSH * Math.min(1, (pack.voted ? (pack.tally[id] || 0) / pack.voted : 0) * 2.5);
            }
            if (target.mayorRevealed) ev += 0.3;
            ev += (hashOf(`w:${bot.playerId}>${id}@${state.dayNumber}`) - 0.5) * 0.5;
        } else if (bot.role === 'serialKiller') {
            ev = entry.W * 1 + entry.V * 0.5 - entry.F * foolCost;
        } else {
            ev = entry.W * 1 + entry.S * 0.85 - entry.F * foolCost - entry.V * MISLYNCH_COST;
        }
        if (pp) band *= pp.band;
        out.push({ id, ev, band, entry });
    });
    return out.sort((x, y) => (y.ev + y.band) - (x.ev + x.band));
}

/** เลือกโหวต: { target, ev } (target = SKIP ถ้าไม่คุ้ม) */
function chooseVote(room, bot) {
    if (bot.role === 'fool') {
        // คนบ้า: โหวตแบบไม่ตามกระแส ให้ดูมีพิรุธนิดๆ
        const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId);
        const pick = hashOf(`fool:${bot.playerId}:${room.gameState.dayNumber}`);
        if (pick < 0.2 || !others.length) return { target: SKIP, ev: 0 };
        return { target: others[Math.floor(pick * 997) % others.length].playerId, ev: 0.1 };
    }
    const A = assess(room, bot);
    const values = voteValues(room, bot, A);
    const skipValue = -urgency(room, bot, A) + 0.05 + (personaOf(room, bot)?.skip || 0);
    const top = values[0];
    if (!top || top.ev + top.band <= skipValue || (top.entry.F >= 0.5 && stallDays(room) < 3)) return { target: SKIP, ev: 0, values, A, skipValue };
    return { target: top.id, ev: top.ev, values, A, skipValue };
}

/** คะแนน "อยากไล่ออก" ของบอทต่อเป้าหนึ่ง (null = ไม่มีวันเลือก) */
function voteScore(room, bot, target) {
    if (!target || target.playerId === bot.playerId || target.alive === false) return null;
    const A = assess(room, bot);
    const entry = voteValues(room, bot, A).find(v => v.id === target.playerId);
    return entry ? entry.ev + entry.band : null;
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
        const mineVote = actions.werewolfVotes?.[bot.playerId];
        if (!mineVote) return 'act';
        const pack = wolfPackPick(room, bot.playerId);
        if (pack && mineVote !== pack && mineVote !== SKIP) return 'act'; // ฝูงเลือกคนอื่น — ตามฝูง
        return engine.isPlayerReadyForMorning(room, bot) ? null : 'ready';
    }
    const required = engine.getRequiredNightActors(room).some(p => p.playerId === bot.playerId);
    if (required && !engine.hasNightActionSubmitted(room, bot) && !state.nightSkips?.[bot.playerId]) return 'act';
    return engine.isPlayerReadyForMorning(room, bot) ? null : 'ready';
}

function targetIds(option) {
    return (option?.targets || []).map(t => t.playerId);
}

/** คนที่อ้างบทสำคัญ (ตรวจ/นายก) แล้วน่าเชื่อ — ควรคุ้มกัน / หมาป่าอยากกัด */
function keyPlayers(room, A) {
    const b = brain(room.gameState);
    return alivePlayers(room)
        .map(p => {
            const claim = b.claims[p.playerId];
            let value = 0;
            if (claim && SEER_ROLES.includes(claim.role)) value = 2 * (A.kappa[p.playerId] ?? 0.5) + Object.keys(claim.results || {}).length * 0.1;
            else if (claim && POWER_ROLES.includes(claim.role)) value = 0.6 * (A.kappa[p.playerId] ?? 0.5);
            if (p.mayorRevealed) value = Math.max(value, 1.2);
            return { player: p, value };
        })
        .filter(entry => entry.value > 0.3)
        .sort((x, y) => y.value - x.value);
}

/** คืนลิสต์คำสั่งกลางคืน [{target, type}] ตามบท */
function planNight(room, bot, rng) {
    const state = room.gameState;
    const b = brain(state);
    const options = engine.getNightActionOptions(room, bot);
    const byType = type => options.find(option => option.type === type);
    const firstNight = engine.isFirstNight(room);
    const night = Number(state.dayNumber) || 1;
    const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId);
    const A = assess(room, bot, true);
    const entryOf = id => A.map.get(id) || { W: 0, F: 0, S: 0, V: 1, hard: 0 };
    const noise = (id, salt) => hashOf(`${salt}:${bot.playerId}>${id}@${night}`);

    switch (bot.role) {
        case 'werewolf':
        case 'alphaWolf': {
            const option = byType('night-kill');
            const allowed = targetIds(option);
            if (!allowed.length) return [{ target: SKIP }];
            const pack = wolfPackPick(room, bot.playerId);
            if (pack && allowed.includes(pack)) return [{ target: pack }];
            const keys = keyPlayers(room, A);
            const fake = b.pack.fakeClaimer && getPlayer(room, b.pack.fakeClaimer)?.alive !== false ? b.claims[b.pack.fakeClaimer] : null;
            const ranked = rankTargets(room, bot, t => {
                if (!allowed.includes(t.playerId) || isWolf(t)) return null;
                const e = entryOf(t.playerId);
                let score = rng() * 1.2;
                const key = keys.find(k => k.player.playerId === t.playerId);
                if (key) score += 1.5 * key.value;
                // คนที่ตัวปลอมของฝูงบอกว่า "ไม่ดี" — กัดตายเท่ากับยอมรับว่าโกหก
                if (fake && isBadCode(fake.results?.[t.playerId])) score -= 3;
                // คนที่หมู่บ้านสงสัยอยู่ เก็บไว้ให้หมู่บ้านไล่เองตอนกลางวัน
                score -= NIGHT_HEAT * Math.min(1.5, heatOn(room, b, t.playerId));
                // เพื่อนในฝูงอ้างผู้หยั่งรู้แข่งกับคนนี้อยู่ — กัดตอนนี้เท่ากับยืนยันว่าเขาพูดจริง ไปลากออกตอนกลางวันแทน
                const claim = b.claims[t.playerId];
                if (claim && b.pack.fakeClaimer && b.claims[b.pack.fakeClaimer]?.role === claim.role
                    && getPlayer(room, b.pack.fakeClaimer)?.alive !== false) score -= 4;
                // กัดแล้วไม่ตาย = มีคนเฝ้า หรือเป็นคนบ้า/ฆาตกร — ไม่เปลืองคืน
                score -= 2.5 * (b.pack.survivors[t.playerId] || 0);
                score -= 3 * (e.F + e.S);
                dayVotesList(b).forEach(({ votes }) => {
                    if (votes[t.playerId] && isWolf(getPlayer(room, votes[t.playerId]))) score += 0.8;
                    // คนที่ฝูงเคยโหวตไล่ — กัดตายเท่ากับบอกทุกคนว่าคนที่โหวตเขาคือหมาป่า
                    score -= NIGHT_OWNVOTE * Object.entries(votes).filter(([v, tt]) => tt === t.playerId && isWolf(getPlayer(room, v))).length;
                });
                Object.values(b.accuse).forEach(today => { if (today[t.playerId] && isWolf(getPlayer(room, today[t.playerId]))) score += 0.6; });
                return score;
            }, others);
            return [{ target: ranked[0] ? ranked[0].target.playerId : SKIP }];
        }
        case 'seer':
        case 'apprenticeSeer':
        case 'oracle': {
            const option = byType(bot.role === 'oracle' ? 'oracle-read' : 'seer-check');
            if (!option || option.locked) return [];
            const checked = new Set(ownResults(bot).map(r => r.target));
            const allowed = targetIds(option);
            const ranked = rankTargets(room, bot, t => {
                if (checked.has(t.playerId) || !allowed.includes(t.playerId)) return null;
                const e = entryOf(t.playerId);
                if (e.known) return null;
                // ตรวจคนที่โดนสงสัย/อ้างบท (ข้อมูลที่หมู่บ้านต้องใช้) + กระจายบ้าง
                return e.W + 0.6 * e.F + (b.claims[t.playerId] ? 0.35 : 0) + (1 - e.hard) * 0.2 + noise(t.playerId, 'check') * 0.5;
            }, others);
            return [{ target: ranked[0] ? ranked[0].target.playerId : SKIP }];
        }
        case 'doctor':
        case 'bodyguard': {
            const option = byType(bot.role === 'doctor' ? 'doctor-save' : 'bodyguard-protect');
            if (!option || !option.allowSkip) return [];
            if (firstNight) return [{ target: SKIP }];
            const allowed = targetIds(option);
            const keys = keyPlayers(room, A).filter(k => allowed.includes(k.player.playerId) && k.player.playerId !== bot.playerId);
            // หมอมียา 2 ครั้ง: เก็บไว้คุ้มคนสำคัญ · บอดี้การ์ดเฝ้าได้ทุกคืน (ห้ามซ้ำคนเดิม)
            if (keys.length) return [{ target: keys[0].player.playerId }];
            if (b.claims[bot.playerId] && allowed.includes(bot.playerId)) return [{ target: bot.playerId }];
            const spend = bot.role === 'bodyguard' ? 0.75 : (night >= 4 ? 0.45 : 0.2);
            if (rng() > spend) return [{ target: SKIP }];
            const trusted = rankTargets(room, bot, t => (allowed.includes(t.playerId) ? entryOf(t.playerId).V + noise(t.playerId, 'guard') * 0.3 : null), others);
            const pick = rng() < 0.3 && allowed.includes(bot.playerId) ? bot.playerId : (trusted[0] ? trusted[0].target.playerId : SKIP);
            return [{ target: pick }];
        }
        case 'witch': {
            const plan = [];
            const poison = byType('witch-poison');
            const heal = byType('witch-heal');
            if (poison && poison.selectedTargetId == null && night >= 2) {
                const top = rankTargets(room, bot, t => (targetIds(poison).includes(t.playerId) ? entryOf(t.playerId).W + 0.5 * entryOf(t.playerId).S : null), others)[0];
                if (top && top.score >= 0.75) plan.push({ target: top.target.playerId, type: 'witch-poison' });
            }
            if (heal && heal.selectedTargetId == null && !plan.length) {
                const victim = engine.canWolvesHuntTonight(room) ? wolfPackPick(room) : null;
                const key = victim ? keyPlayers(room, A).some(k => k.player.playerId === victim) : false;
                if (victim && (victim === bot.playerId || key || rng() < 0.65)) plan.push({ target: victim, type: 'witch-heal' });
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
            const top = rankTargets(room, bot, t => (targetIds(option).includes(t.playerId) ? entryOf(t.playerId).W + noise(t.playerId, 'scan') * 0.6 : null), others)[0];
            return [{ target: top ? top.target.playerId : SKIP }];
        }
        case 'vigilante':
        case 'hunter': {
            const option = byType(bot.role === 'vigilante' ? 'vigilante-shot' : 'hunter-shot');
            if (!option || !option.allowSkip) return [];
            if (firstNight) return [{ target: SKIP }];
            const allowed = targetIds(option);
            const urgent = urgency(room, bot, A) > 1;
            // ยิงได้ครั้งเดียว ยิงผิดคือฆ่าพวกเดียวกัน — ยิงคนที่หลักฐานแข็ง (ยิงคนบ้าตอนกลางคืนไม่เสียหาย)
            const top = rankTargets(room, bot, t => {
                if (!allowed.includes(t.playerId)) return null;
                const e = entryOf(t.playerId);
                return e.W + 0.8 * e.S + 0.3 * e.F;
            }, others)[0];
            const stalled = stallDays(room) >= 4;
            if (top && (top.score >= 0.72 || (urgent && top.score >= 0.45) || (stalled && top.score >= 0.2))) return [{ target: top.target.playerId }];
            return [{ target: SKIP }];
        }
        case 'serialKiller': {
            const option = byType('serial-kill');
            const allowed = targetIds(option);
            if (!allowed.length) return [{ target: SKIP }];
            const keys = keyPlayers(room, A).filter(k => allowed.includes(k.player.playerId));
            if (keys.length && rng() < 0.6) return [{ target: keys[0].player.playerId }];
            const ranked = rankTargets(room, bot, t => (allowed.includes(t.playerId) ? entryOf(t.playerId).W * 0.8 + rng() : null), others);
            return [{ target: ranked[0] ? ranked[0].target.playerId : SKIP }];
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

/** หมาป่าตัวที่ฝูงให้เป็นคนอ้างบทปลอม: ตัวที่โดนสงสัยน้อยที่สุด (ทุกตัวในฝูงคิดตรงกัน) */
function designatedLiar(room, b) {
    const wolves = alivePlayers(room).filter(p => isWolf(p) && !b.claims[p.playerId]);
    if (!wolves.length) return null;
    const day = Number(room.gameState.dayNumber) || 0;
    return wolves
        .map(p => ({ id: p.playerId, score: heatOn(room, b, p.playerId) + 0.3 * hashOf(`liar:${p.playerId}@${day}`) }))
        .sort((x, y) => x.score - y.score)[0].id;
}

// ---------- แชทกลางวัน ----------

function fill(template, values) {
    return template
        .replace('{a}', values.a != null ? escapeHtml(values.a) : '')
        .replace('{b}', values.b != null ? escapeHtml(values.b) : '')
        .replace('{role}', values.role != null ? escapeHtml(values.role) : '')
        .replace('{r}', values.r != null ? values.r : '');
}

function pickTemplate(kind, salt) {
    const list = CHAT_TEMPLATES[kind];
    return list[Math.floor(hashOf(salt) * list.length) % list.length];
}

function resultText(role, code) {
    if (role === 'oracle') return code === 'unknown' ? 'ไม่ทราบ' : roleThai(code);
    return code === 'bad' ? 'ไม่ดี' : (code === 'good' ? 'ดี' : 'ไม่ทราบ');
}

function claimLine(room, role, results) {
    const kind = role === 'oracle' ? 'oracleClaim' : (role === 'apprenticeSeer' ? 'apprenticeClaim' : 'seerClaim');
    const parts = Object.entries(results).slice(-4).map(([id, code]) => `${escapeHtml(getPlayer(room, id)?.name || '?')} ${resultText(role, code)}`);
    return fill(CHAT_TEMPLATES[kind][0], { r: parts.join(' · ') });
}

/** ช่วงนี้ใครโดนชี้/โดนโหวตหนัก (สาธารณะ) */
function heatOn(room, b, playerId) {
    const day = Number(room.gameState.dayNumber) || 0;
    const accused = Object.values(b.accuse[String(day)] || {}).filter(t => t === playerId).length;
    const yesterday = b.votes[String(day - 1)] || {};
    const voters = Object.keys(yesterday).length || 1;
    const share = Object.values(yesterday).filter(t => t === playerId).length / voters;
    const bad = Object.entries(b.claims).some(([id, c]) => id !== playerId && c.results && isBadCode(c.results[playerId]));
    return accused * 0.35 + share + (bad ? 1 : 0);
}

/**
 * บอทพูดอะไรดี (หรือเงียบ) — คืน { text, kind, claim?, accuse? } หรือ null
 * slot 0 = ต้นวง (เปิดผล/ทักทาย) · slot 1 = กลางวง (ตอบโต้/แก้ตัว/ชี้ตัว)
 * ผลลง brain ตอนพูดจริง (commitChat) — คำอ้าง/ชี้ตัว/ท่าที เป็นของสาธารณะทันทีที่พูด
 */
function decideChat(room, bot, slot) {
    const state = room.gameState;
    const b = brain(state);
    const day = Number(state.dayNumber) || 0;
    const me = mine(b, bot.playerId);
    const myClaim = b.claims[bot.playerId];
    const P = planInfo(room);
    const heat = heatOn(room, b, bot.playerId);
    const nameOf = id => getPlayer(room, id)?.name;

    // ---- คนบ้า: ทำตัวมีพิรุธแบบเนียนๆ ไม่อ้างบท ----
    if (bot.role === 'fool') {
        const h = hashOf(`foolchat:${bot.playerId}:${day}:${slot}`);
        if (slot === 1 && h < 0.5) {
            if (heat >= 0.5 && h < 0.3) return { kind: 'foolBeg', text: pickTemplate('foolBeg', `${bot.playerId}:${day}`) };
            if (h < 0.06) return { kind: 'foolWolf', text: CHAT_TEMPLATES.foolWolf[0] };
            return { kind: 'foolSubtle', text: pickTemplate('foolSubtle', `${bot.playerId}:${day}`) };
        }
        if (slot === 0 && (b.chat[`neu:${day}`] || 0) < MAX_NEUTRAL_PER_DAY && hashOf(`n:${bot.playerId}:${day}`) < 0.3) return { kind: 'neutral', text: CHAT_LINES[Math.floor(h * CHAT_LINES.length)] };
        return null;
    }

    // ---- ผู้หยั่งรู้/ศิษย์/นักพยากรณ์: ตัดสินใจว่าจะเปิดผลตอนไหน ----
    const seerRole = bot.role === 'oracle' ? 'oracle'
        : ((bot.role === 'seer' || (bot.role === 'apprenticeSeer' && (bot.seerHistory || []).length)) ? bot.role : null);
    if (seerRole) {
        const results = {};
        ownResults(bot).forEach(r => { if (getPlayer(room, r.target)) results[r.target] = r.code; });
        const fresh = Object.entries(results).filter(([id]) => !(myClaim && myClaim.results && id in myClaim.results));
        const badAlive = fresh.some(([id, code]) => isBadCode(code) && getPlayer(room, id)?.alive !== false);
        const unknownHeated = fresh.some(([id, code]) => code === 'unknown' && P.F && heatOn(room, b, id) >= 0.6);
        const goodHeated = fresh.some(([id, code]) => code !== 'unknown' && !isBadCode(code) && heatOn(room, b, id) >= 0.6);
        const rivalId = Object.keys(b.claims).find(id => id !== bot.playerId && b.claims[id].role === seerRole);
        let reveal = false;
        if (myClaim && fresh.length) reveal = true;
        else if (!myClaim && Object.keys(results).length) {
            // เจอหมาป่า: คนใจร้อนเปิดทันที · คนรอบคอบเก็บไว้ก่อน (กลัวโดนกัด อยากได้ผลเพิ่ม) แต่ยังโหวตคนนั้นอยู่
            if (badAlive) reveal = hashOf(`reveal:${bot.playerId}:${day}`) < (personaOf(room, bot)?.reveal ?? 0.85);
            else if (rivalId || heat >= 0.6 || unknownHeated || goodHeated) reveal = true;
            else if (day >= 3 && Object.keys(results).length >= 2) reveal = hashOf(`reveal2:${bot.playerId}:${day}`) < 0.5;
        }
        if (reveal) {
            if (!myClaim && rivalId && slot === 1) {
                return { kind: 'counter', text: fill(CHAT_TEMPLATES.counter[0], { a: nameOf(rivalId), role: roleThai(seerRole) }), claim: { role: seerRole, results } };
            }
            return { kind: 'claim', text: claimLine(room, seerRole, myClaim ? Object.fromEntries(fresh) : results), claim: { role: seerRole, results } };
        }
    }

    // ---- หมาป่า: อ้างบทตรวจปลอม (ผู้หยั่งรู้/นักพยากรณ์) — ฝูงมีคนอ้างได้ทีละตัว ----
    if (isWolf(bot) && (P.count.seer || P.count.oracle)) {
        const pack = b.pack;
        const liveFake = pack.fakeClaimer && getPlayer(room, pack.fakeClaimer)?.alive !== false ? pack.fakeClaimer : null;
        const realClaims = Object.entries(b.claims).filter(([id, c]) => SEER_ROLES.includes(c.role) && !isWolf(getPlayer(room, id)));
        const wolfAccuser = realClaims.find(([id, c]) => getPlayer(room, id)?.alive !== false && Object.entries(c.results || {})
            .some(([t, code]) => isBadCode(code) && isWolf(getPlayer(room, t)) && getPlayer(room, t).alive !== false));
        const A = assess(room, bot);
        const victims = voteValues(room, bot, A).filter(v => !v.bus && v.entry.F < 0.15 && !(v.id in (myClaim?.results || {})));
        const badCode = role => (role === 'oracle' ? 'werewolf' : 'bad');
        const goodCode = role => (role === 'oracle' ? 'villager' : 'good');
        if (liveFake === bot.playerId && myClaim && SEER_ROLES.includes(myClaim.role)) {
            // ประกาศผลปลอมวันละคน (บางทีฟอกเพื่อนหมาป่าว่า "ดี") · ชี้คนที่หมู่บ้านสงสัยอยู่แล้ว ให้ดูเข้าทาง
            if (me.fakeDay !== day && slot === 0) {
                const mate = alivePlayers(room).find(p => isWolf(p) && p.playerId !== bot.playerId && !(p.playerId in myClaim.results));
                const heated = victims.filter(v => !b.claims[v.id]).sort((x, y) => heatOn(room, b, y.id) - heatOn(room, b, x.id))[0];
                const mark = heated || victims[0];
                const result = mate && hashOf(`mate:${bot.playerId}:${day}`) < 0.4 ? { [mate.playerId]: goodCode(myClaim.role) } : (mark ? { [mark.id]: badCode(myClaim.role) } : null);
                if (result) return { kind: 'claim', text: claimLine(room, myClaim.role, result), claim: { role: myClaim.role, results: result }, fake: true };
            }
        } else if (!liveFake && !myClaim && designatedLiar(room, b) === bot.playerId) {
            // ฝูงตกลงกันว่าใครเป็นคนอ้าง (ตัวที่โดนสงสัยน้อยสุด) — ตัวอื่นเงียบไว้ ไม่อ้างชนกันเอง
            let target = null;
            let role = null;
            const liveReal = realClaims.filter(([id]) => getPlayer(room, id)?.alive !== false);
            const heated = victims.filter(v => !b.claims[v.id]).sort((x, y) => heatOn(room, b, y.id) - heatOn(room, b, x.id))[0];
            if (wolfAccuser && hashOf(`counter:${bot.playerId}:${day}`) < FAKE_COUNTER) {
                target = wolfAccuser[0];
                role = wolfAccuser[1].role;
            } else if (!wolfAccuser && !liveReal.length && day >= 2 && hashOf(`fake:${bot.playerId}:${day}`) < FAKE_LATER) {
                target = (heated || victims[0])?.id || null;
                role = P.count.seer && (!P.count.oracle || hashOf(`fakerole:${bot.playerId}`) < 0.7) ? 'seer' : 'oracle';
            }
            if (target && role) {
                const results = { [target]: badCode(role) };
                if (wolfAccuser && slot === 1) {
                    return { kind: 'counter', text: fill(CHAT_TEMPLATES.counter[0], { a: nameOf(target), role: roleThai(role) }), claim: { role, results }, fake: true };
                }
                return { kind: 'claim', text: claimLine(room, role, results), claim: { role, results }, fake: true };
            }
        }
    }

    // ---- โดนสงสัย: แก้ตัวด้วยการอ้างบท (หมาป่า/ฆาตกรอ้างบทปลอม) · นายกใช้ปุ่มเปิดตัวแทน ----
    if (!myClaim && heat >= 0.6 && slot === 1 && bot.role !== 'mayor') {
        let role = bot.role;
        if (isWolf(bot) || bot.role === 'serialKiller') {
            const free = ['doctor', 'bodyguard', 'witch', 'hunter', 'tracker']
                .filter(r => roleCount(P, r) && !Object.values(b.claims).some(c => c.role === r));
            role = hashOf(`lie:${bot.playerId}:${day}`) < 0.6 && free.length ? free[Math.floor(hashOf(`lier:${bot.playerId}`) * free.length) % free.length] : 'villager';
        }
        if (SEER_ROLES.includes(role)) role = 'villager';
        return { kind: 'defend', text: fill(CHAT_TEMPLATES.defend[0], { role: roleThai(role) }), claim: { role, results: {} } };
    }

    // ---- คนอื่นอ้างบทเดียวกับเรา (บทมีใบเดียว) = โกหก ----
    if (!isWolf(bot) && bot.role !== 'serialKiller' && bot.role !== 'villager' && !myClaim && slot === 1 && roleCount(P, bot.role) === 1) {
        const liar = Object.keys(b.claims).find(id => id !== bot.playerId && b.claims[id].role === bot.role && getPlayer(room, id)?.alive !== false);
        if (liar) return { kind: 'counter', text: fill(CHAT_TEMPLATES.counter[0], { a: nameOf(liar), role: roleThai(bot.role) }), claim: { role: bot.role, results: {} } };
    }

    // ---- เหตุผลสาธารณะ: ชี้ตัว / ปกป้องกันเป็นกลุ่ม / ระวังคนบ้า ----
    const total = b.chat[`n:${day}`] || 0;
    const cap = Math.max(4, Math.ceil(alivePlayers(room).length / 2));
    if (total >= cap) return null;
    const villageSide = !isWolf(bot) && bot.role !== 'serialKiller';
    if (slot === 1) {
        const A = assess(room, bot);
        const values = voteValues(room, bot, A);
        if (villageSide && P.F) {
            const risky = values.find(v => v.entry.F >= 0.35 && heatOn(room, b, v.id) >= 0.5 && !b.chat[`fw:${day}:${v.id}`]);
            if (risky) return { kind: 'foolWarn', text: fill(pickTemplate('foolWarn', `${bot.playerId}:${day}`), { a: nameOf(risky.id) }), ref: risky.id };
        }
        if (villageSide && !b.chat[`td:${day}`]) {
            // ผู้หยั่งรู้ที่อ้างไว้โดนกัดตายเมื่อคืน → เชื่อผลของเขา ชี้คนที่เขาบอกว่าไม่ดี
            const martyr = Object.entries(b.claims).find(([id, c]) => SEER_ROLES.includes(c.role) && b.deaths[id]?.cause === 'wolf-attack'
                && b.deaths[id].day === day && Object.entries(c.results || {}).some(([t, code]) => isBadCode(code) && getPlayer(room, t)?.alive !== false));
            if (martyr) {
                const badTarget = Object.entries(martyr[1].results).find(([t, code]) => isBadCode(code) && getPlayer(room, t)?.alive !== false)[0];
                return { kind: 'trustDead', text: fill(CHAT_TEMPLATES.trustDead[0], { a: nameOf(martyr[0]) }), accuse: badTarget };
            }
        }
        let top = values[0];
        if (isWolf(bot)) {
            // หมาป่าชี้ตามที่หมู่บ้านสงสัยอยู่แล้ว (ฟังดูมีเหตุผล) · ไม่ชี้ซ้ำคนที่เพื่อนในฝูงเพิ่งชี้ถ้าคนอื่นไม่ได้ชี้ด้วย
            const today = b.accuse[String(day)] || {};
            const byPack = id => Object.entries(today).some(([v, t]) => t === id && v !== bot.playerId && isWolf(getPlayer(room, v)));
            const byOthers = id => Object.entries(today).some(([v, t]) => t === id && !isWolf(getPlayer(room, v)));
            top = values.filter(v => !v.bus)
                .map(v => ({ ...v, ev: v.ev + 0.6 * Math.min(1.5, heatOn(room, b, v.id)) - (byPack(v.id) && !byOthers(v.id) ? 0.5 : 0) }))
                .sort((x, y) => y.ev - x.ev)[0];
        }
        if (top && top.ev > 0.25) {
            const bloc = villageSide ? top.entry.reasons.bloc : null;
            if (bloc && getPlayer(room, bloc) && hashOf(`bloc:${bot.playerId}:${day}`) < 0.6) {
                return { kind: 'bloc', text: fill(pickTemplate('bloc', `${bot.playerId}:${day}:b`), { a: nameOf(top.id), b: nameOf(bloc) }), accuse: top.id };
            }
            if (hashOf(`acc:${bot.playerId}:${day}`) < (isWolf(bot) ? 0.45 : 0.7)) {
                return { kind: 'accuse', text: fill(pickTemplate('accuse', `${bot.playerId}:${day}:a`), { a: nameOf(top.id) }), accuse: top.id };
            }
        }
        if (villageSide && P.F && (!top || top.ev <= 0) && hashOf(`nl:${bot.playerId}:${day}`) < 0.25 && !b.chat[`nl:${day}`]) {
            return { kind: 'noLynch', text: pickTemplate('noLynch', `${bot.playerId}:${day}:n`) };
        }
    }
    if (slot === 0 && (b.chat[`neu:${day}`] || 0) < MAX_NEUTRAL_PER_DAY && hashOf(`chat:${room.roomId}:${day}:${bot.playerId}`) < 0.35) {
        return { kind: 'neutral', text: CHAT_LINES[Math.floor(hashOf(`line:${day}:${bot.playerId}`) * CHAT_LINES.length)] };
    }
    return null;
}

function commitChat(room, bot, said) {
    const state = room.gameState;
    const b = brain(state);
    const day = Number(state.dayNumber) || 0;
    if (said.claim) {
        addClaim(b, bot.playerId, said.claim.role, said.claim.results, day);
        if (said.fake && isWolf(bot)) {
            b.pack.fakeClaimer = bot.playerId;
            mine(b, bot.playerId).fakeDay = day;
        }
    }
    if (said.accuse) {
        const today = b.accuse[String(day)] || (b.accuse[String(day)] = {});
        today[bot.playerId] = said.accuse;
    }
    if (said.kind === 'foolSubtle') addTell(b, bot.playerId, TELL_WEIGHT.foolSubtle);
    if (said.kind === 'foolBeg') addTell(b, bot.playerId, TELL_WEIGHT.foolBeg);
    if (said.kind === 'foolWolf') {
        addTell(b, bot.playerId, TELL_WEIGHT.foolWolf);
        b.tells[bot.playerId + ':wolf'] = 1;
    }
    if (said.kind === 'foolWarn' && said.ref) b.chat[`fw:${day}:${said.ref}`] = true;
    if (said.kind === 'noLynch') b.chat[`nl:${day}`] = true;
    if (said.kind === 'trustDead') b.chat[`td:${day}`] = true;
    if (said.kind === 'neutral') b.chat[`neu:${day}`] = (b.chat[`neu:${day}`] || 0) + 1;
    b.chat[`n:${day}`] = (b.chat[`n:${day}`] || 0) + 1;
}

/** ตรวจว่าเป็นประโยคที่บอทพูดได้ (ใช้ในเทส) */
function isBotChatLine(text) {
    if (CHAT_LINES.includes(text)) return true;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Object.values(CHAT_TEMPLATES).some(list => list.some(template => {
        const pattern = esc(template)
            .replace(/\\\{a\\\}|\\\{b\\\}/g, '\\S.*?')
            .replace('\\{role\\}', '\\S+')
            .replace('\\{r\\}', '.+');
        return new RegExp(`^${pattern}$`).test(text);
    }));
}

// ---------- กลางวัน ----------

function runDiscuss(room, bot, rng) {
    const state = room.gameState;
    const b = brain(state);
    let changed = false;
    const day = Number(state.dayNumber) || 1;
    const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId);
    if (bot.role === 'cleric' && !bot.clericBlessUsed) {
        const A = assess(room, bot);
        const key = keyPlayers(room, A).find(k => k.player.playerId !== bot.playerId);
        const target = key ? key.player : (day >= 2 && rng() < 0.4 ? rankTargets(room, bot, t => (A.map.get(t.playerId)?.V ?? 0) + rng() * 0.2, others)[0]?.target : null);
        if (target) {
            try { engine.submitClericBless(room, bot.playerId, target.playerId); changed = true; } catch (error) { /* ข้าม */ }
        }
    }
    if (bot.role === 'mayor' && !bot.mayorRevealed && day >= 2 && (rng() < 0.3 || heatOn(room, b, bot.playerId) >= 0.5)) {
        try { engine.submitMayorReveal(room, bot.playerId); changed = true; } catch (error) { /* ข้าม */ }
    }
    if (room.gameState.phase === 'day-discussion' && !state.discussionSkips?.[bot.playerId]) {
        try { engine.submitDiscussionSkip(room, bot.playerId); changed = true; } catch (error) { /* ข้าม */ }
    }
    return changed;
}

function submitVote(room, bot, target) {
    try {
        engine.submitDayVote(room, bot.playerId, target, { lastCall: true });
        return true;
    } catch (error) {
        if (target === SKIP) return false;
        try {
            engine.submitDayVote(room, bot.playerId, SKIP, { lastCall: true });
            return true;
        } catch (skipError) {
            return false;
        }
    }
}

function runVote(room, bot) {
    const state = room.gameState;
    const b = brain(state);
    const day = Number(state.dayNumber) || 0;
    const choice = chooseVote(room, bot);

    // จอมเปิดโปง: ชี้เมื่อหลักฐานแข็งมาก (ผิด = ตายแทน)
    if (bot.role === 'revealer' && !bot.revealerUsed && day >= 2 && choice.values && choice.values[0]) {
        const top = choice.values[0];
        if (top.entry.W >= 0.85) {
            try {
                engine.useRevealAction(room, bot.playerId, top.id, { lastCall: true });
                return true;
            } catch (error) { /* โหวตแทน */ }
        }
    }
    b.voted[`${day}:${bot.playerId}`] = { revotes: 0, checkedAt: null };
    return submitVote(room, bot, choice.target);
}

/** โหวตไปแล้ว เห็นวงโหวต/ข้อมูลใหม่ — เปลี่ยนใจได้ (วันละไม่เกิน 2 ครั้ง) */
function runRevote(room, bot) {
    const state = room.gameState;
    const b = brain(state);
    const day = Number(state.dayNumber) || 0;
    const mark = b.voted[`${day}:${bot.playerId}`] || (b.voted[`${day}:${bot.playerId}`] = { revotes: 0 });
    mark.revotes += 1;
    mark.checkedAt = state.lastAction || 0;
    const current = state.dayVotes?.[bot.playerId];
    if (!current) return false;
    if (bot.role === 'fool') {
        // คนบ้าเปลี่ยนโหวตไปมาบ้าง (ไม่มีเหตุผลชัด)
        if (hashOf(`foolre:${bot.playerId}:${day}:${mark.revotes}`) < 0.3) {
            const others = alivePlayers(room).filter(p => p.playerId !== bot.playerId && p.playerId !== current);
            if (others.length) return submitVote(room, bot, others[Math.floor(hashOf(`foolpick:${bot.playerId}:${day}`) * others.length) % others.length].playerId);
        }
        return false;
    }
    const choice = chooseVote(room, bot);
    if (!choice.values || choice.target === current) return false;
    const valueOf = id => {
        if (id === SKIP) return choice.skipValue;
        const v = choice.values.find(x => x.id === id);
        return v ? v.ev + v.band : -1;
    };
    const now = valueOf(current);
    const next = valueOf(choice.target);
    // เปลี่ยนเมื่อดีกว่าชัดเจน (กันโหวตกลับไปกลับมา) หรือเป้าเดิมกลายเป็นเสี่ยง (เช่น อาจเป็นคนบ้า)
    if (next - now < 0.2 && !(current !== SKIP && now < -0.3)) return false;
    const result = submitVote(room, bot, choice.target);
    if (result) mark.checkedAt = state.lastAction || 0;
    return result;
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
    const day = Number(state.dayNumber) || 0;

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
            // พูดได้ 2 จังหวะ: ต้นวง (เปิดผล/ทักทาย) กับกลางวง (ตอบโต้/แก้ตัว/ชี้ตัว) — ก่อนกดข้ามเสมอ
            const said = b.chat[`${day}:${bot.playerId}`] || 0;
            const slotsDone = b.chat[`s:${day}:${bot.playerId}`] || 0;
            if (said < MAX_CHAT_PER_BOT && slotsDone < 2) {
                const offset = slotsDone === 0
                    ? (ENV_BOT_MS ? fast(0.3 + j * 0.6) : 5000 + j * 12000)
                    : (ENV_BOT_MS ? fast(1 + j * 0.6) : 19000 + j * 12000);
                list.push({ botId: bot.playerId, kind: 'chat', slot: slotsDone, dueAt: Math.min(start + offset, deadline) });
            }
            if (!state.discussionSkips?.[bot.playerId]) {
                push(bot, 'discuss', ENV_BOT_MS ? fast(2 + j) : Math.max(34000, RECAP_MS + Math.min(45000, dayMs * 0.25)) + j * 10000);
            }
        } else if (state.phase === 'day-vote') {
            if (state.dayActionUsedBy?.[bot.playerId]) return;
            if (!state.dayVotes?.[bot.playerId]) {
                push(bot, 'vote', ENV_BOT_MS ? fast(1 + j) : 3000 + j * 9000);
                return;
            }
            // โหวตแล้ว: ดูวงโหวตอีกรอบเมื่อมีคนขยับ (วันละไม่เกิน 2 ครั้ง)
            const mark = b.voted[`${day}:${bot.playerId}`];
            if (mark && mark.revotes < 2 && (state.lastAction || 0) !== mark.checkedAt) {
                const offset = ENV_BOT_MS ? fast(2.2 + j + mark.revotes) : 13000 + j * 8000 + mark.revotes * 6000;
                const lastCall = state.voteClosesAt ? state.voteClosesAt - 1500 : Infinity;
                list.push({ botId: bot.playerId, kind: 'revote', slot: mark.revotes, dueAt: Math.min(start + offset, lastCall, deadline) });
            }
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
            const day = Number(state.dayNumber) || 0;
            const slotKey = `s:${day}:${bot.playerId}`;
            const slot = b.chat[slotKey] || 0;
            b.chat[slotKey] = slot + 1;
            if (state.phase !== 'day-discussion') return false;
            const said = decideChat(room, bot, slot);
            if (!said || !said.text) return false;
            commitChat(room, bot, said);
            b.chat[`${day}:${bot.playerId}`] = (b.chat[`${day}:${bot.playerId}`] || 0) + 1;
            chats.push({ playerId: bot.playerId, text: said.text, kind: said.kind });
            return true;
        }
        case 'discuss':
            return runDiscuss(room, bot, rng);
        case 'vote':
            return runVote(room, bot);
        case 'revote':
            return runRevote(room, bot);
        default:
            return false;
    }
}

/**
 * ให้บอทที่ถึงเวลาทำงาน — หยุดเมื่อเฟสเปลี่ยน
 * @returns {{changed: boolean, chats: Array<{playerId, text, kind}>}}
 */
function playBotTurns(room, options = {}) {
    const rng = options.rng || Math.random;
    const now = options.now || Date.now();
    const result = { changed: false, chats: [] };
    const state = room?.gameState;
    if (!state || state.winner) return result;
    const key = phaseKey(state);
    const tried = new Set();
    for (let guard = 0; guard < 80; guard += 1) {
        if (room.gameState.winner || phaseKey(room.gameState) !== key) break;
        const ready = pendingBotDecisions(room, now)
            .filter(item => (options.force || item.dueAt <= now) && !tried.has(`${item.botId}:${item.kind}:${item.slot ?? ''}`));
        if (!ready.length) break;
        const decision = ready[0];
        tried.add(`${decision.botId}:${decision.kind}:${decision.slot ?? ''}`);
        if (actOnce(room, decision, rng, result.chats)) result.changed = true;
    }
    return result;
}

module.exports = {
    isBotId,
    observe,
    noteChat,
    pendingBotDecisions,
    botNeedsTurn,
    botDelay,
    playBotTurns,
    CHAT_LINES,
    CHAT_TEMPLATES,
    isBotChatLine,
    // ให้เทสเรียกตรง
    assess,
    chooseVote,
    decideChat,
    voteScore,
    planNight,
    nightNeed
};
