/**
 * เศรษฐี — 🪙 เหรียญทอง + สกิล (ข้อมูลล้วน ไม่มี IO)
 *
 * - ตารางสกิล 8 แบบ Lv 0–5 · ราคาอัปเกรดแต่ละขั้น · ช่องติดตั้ง 3 ช่อง
 * - โอกาส/ค่าของสกิลต่อเลเวล (engine ใช้ตอนเล่น ร้านใช้โชว์ % ตอนนี้ → % ถัดไป)
 * - ตารางรางวัลจบเกม (computeRewards) — คำนวณจาก state ของ engine ฝั่งเซิร์ฟเวอร์เท่านั้น
 *
 * เหรียญทองเป็นสกุลแยก ไม่เกี่ยวกับชิปโป๊กเกอร์/ป๊อกเด้ง และไม่มีมูลค่าจริง
 * ปรับสมดุลแล้วด้วย scripts/sim-setthi-skills.js (ดูรายงานใน rules/setthi/skills.md)
 */

const MAX_LEVEL = 5;
const LOADOUT_SIZE = 3;
// ราคาอัปจาก Lv k → k+1 (index = k)
const UPGRADE_COST = [100, 250, 500, 900, 1500];

/**
 * values[lv] = ค่าที่ Lv นั้น (lv 0 = 0 เสมอ)
 *  unit 'pct'  = โอกาส % (ติด = ✨ ป๊อปอัปทั้งห้อง)
 *  unit 'off'  = ส่วนลด % (ใช้ทุกครั้ง ไม่สุ่ม)
 *  unit 'bonus'= ค่าผ่านทางเพิ่ม % (ใช้ทุกครั้ง ไม่สุ่ม)
 * key = ชื่อจุดลุ้นใน engine (proc key) ถ้าเป็นสกิลสุ่ม
 */
const SKILLS = [
    { id: 'double', icon: '🎲', name: 'ดับเบิล', key: 'double', unit: 'pct', values: [0, 1, 2, 3, 4, 5],
        line: 'ทอยได้ดับเบิลบ่อยขึ้น', proc: 'ดับเบิล!', detail: 'ทอยไม่ได้ดับเบิล มีโอกาสกลายเป็นดับเบิล (ไม่ทำให้ติดเกาะ)' },
    { id: 'fly', icon: '✈️', name: 'บินทันที', key: 'fly', unit: 'pct', values: [0, 6, 12, 18, 24, 30],
        line: 'ตกทัวร์ บินได้เลยตานี้', proc: 'บินได้เลย!', detail: 'ตกช่องทัวร์ มีโอกาสเลือกที่บินได้ทันที ไม่ต้องรอตาหน้า' },
    { id: 'start2x', icon: '💰', name: 'Start ×2', key: 'start2x', unit: 'pct', values: [0, 5, 10, 15, 20, 25],
        line: 'ผ่านจุดเริ่ม ได้เงิน ×2', proc: 'Start ×2!', detail: 'ผ่านจุดเริ่ม มีโอกาสได้เงินเดือนสองเท่า' },
    { id: 'escape', icon: '🏝️', name: 'หนีเกาะ', key: 'escape', unit: 'pct', values: [0, 8, 16, 24, 32, 40],
        line: 'ติดเกาะ หนีออกได้ทันที', proc: 'หนีเกาะ!', detail: 'ติดเกาะแล้วทอยไม่ได้ดับเบิล มีโอกาสหนีออกเลย' },
    { id: 'tollShield', icon: '🛡️', name: 'ลดค่าผ่านทาง', key: 'tollHalf', unit: 'pct', values: [0, 4, 8, 12, 16, 20],
        line: 'ค่าผ่านทาง ลดครึ่ง', proc: 'ค่าผ่านทางลดครึ่ง!', detail: 'จ่ายค่าผ่านทาง มีโอกาสจ่ายแค่ครึ่งเดียว' },
    { id: 'builder', icon: '🏗️', name: 'ส่วนลดก่อสร้าง', key: null, unit: 'off', values: [0, 2, 4, 6, 8, 10],
        line: 'ซื้อ/สร้าง ถูกลง', proc: 'ส่วนลดก่อสร้าง', detail: 'ซื้อที่และสร้างบ้าน ถูกลงทุกครั้ง' },
    { id: 'luck', icon: '🃏', name: 'ดวงดี', key: 'luck', unit: 'pct', values: [0, 4, 8, 12, 16, 20],
        line: 'เลี่ยงการ์ดร้าย', proc: 'ดวงดี! เลี่ยงการ์ดร้าย', detail: 'เปิดได้การ์ดร้าย มีโอกาสเปลี่ยนเป็นการ์ดดี' },
    { id: 'festival', icon: '🎪', name: 'งานวัด', key: null, unit: 'bonus', values: [0, 5, 10, 15, 20, 20],
        line: 'งานวัดเมืองเรา เก็บแพงขึ้น', proc: 'งานวัด ×3!', detail: 'เมืองงานวัดของเรา ค่าผ่านทางเพิ่ม · Lv5 เปิดงานเริ่ม ×3' }
];
const SKILL_IDS = SKILLS.map(s => s.id);
const SKILL_BY_ID = new Map(SKILLS.map(s => [s.id, s]));
const SKILL_BY_KEY = new Map(SKILLS.filter(s => s.key).map(s => [s.key, s]));
// การ์ดร้ายที่ "ดวงดี" เลี่ยงได้: ไปเกาะ · ทำบุญ (จ่าย) · บริจาคเมือง · ไปเที่ยวงานวัด (จ่ายค่าผ่านทาง)
const BAD_CARDS = new Set(['k06', 'k07', 'k16', 'k17']);
// Lv5 งานวัด: เปิดงานใหม่เริ่มที่ ×3 (ซ้อนต่อ ×6 → ×12 → ×16)
const FESTIVAL_LV5_START = 3;

function clampLevel(lv) {
    const n = Math.floor(Number(lv));
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_LEVEL, n)) : 0;
}

/** ค่าของสกิลที่เลเวลนี้ (หน่วยตาม unit · % เป็นเลขเต็ม) */
function valueOf(id, lv) {
    const s = SKILL_BY_ID.get(id);
    return s ? s.values[clampLevel(lv)] : 0;
}

/** ราคาอัปจากเลเวลนี้ไปขั้นถัดไป (null = เต็มแล้ว) */
function upgradeCost(lv) {
    const k = clampLevel(lv);
    return k >= MAX_LEVEL ? null : UPGRADE_COST[k];
}

/** โอกาส 0..1 ของจุดลุ้น key จากสกิลที่ติดตั้ง (ไม่มีสกิล = 0 → engine ไม่สุ่มเลย) */
function procChance(skills, key) {
    const s = SKILL_BY_KEY.get(key);
    if (!s || !skills) return 0;
    const lv = clampLevel(skills[s.id]);
    if (!lv) return 0;
    let v = s.values[lv] / 100;
    // ดับเบิล: ตัวเลขในร้านคือ "% ดับเบิลเพิ่ม" แบบรวม → แปลงเป็นโอกาสเปลี่ยนตาที่ไม่ดับเบิล (5/6 ของตา)
    if (s.id === 'double') v = v / (5 / 6);
    return Math.max(0, Math.min(1, v));
}

/** สกิลที่ติดตั้งเข้าเกม: { id: lv } เฉพาะสกิลที่มีเลเวล (ไม่เกิน 3 อัน) */
function snapshotLoadout(skills = {}, loadout = []) {
    const out = {};
    (Array.isArray(loadout) ? loadout : []).forEach(id => {
        if (Object.keys(out).length >= LOADOUT_SIZE) return;
        if (!SKILL_BY_ID.has(id) || out[id]) return;
        const lv = clampLevel(skills && skills[id]);
        if (lv > 0) out[id] = lv;
    });
    return out;
}

function sanitizeSkillMap(map) {
    const out = {};
    if (!map || typeof map !== 'object') return out;
    Object.keys(map).forEach(id => {
        if (!SKILL_BY_ID.has(id)) return;
        const lv = clampLevel(map[id]);
        if (lv > 0 && Object.keys(out).length < LOADOUT_SIZE) out[id] = lv;
    });
    return out;
}

/** ตารางสกิลสำหรับหน้าร้าน (ข้อมูลคงที่) */
function publicSkills() {
    return SKILLS.map(s => ({ id: s.id, icon: s.icon, name: s.name, unit: s.unit, values: s.values.slice(), line: s.line, detail: s.detail, proc: s.proc, cost: UPGRADE_COST.slice() }));
}

// ---------- รางวัลจบเกม ----------

const REWARD = {
    finished: 20,
    win: { time: 100, bankrupt: 150, line: 200, triple: 250, tourist: 300 },
    perFeat: 10, // ต่อแลนด์มาร์กที่สร้าง / ซื้อต่อ 1 ครั้ง
    featCap: 100,
    botGameMult: 0.5, // ไม่มีคนจริงอื่นอยู่จนจบ = ครึ่งเดียว
    minRounds: 3 // จบก่อนรอบ 3 แบบไม่ใช่ชนะบนกระดาน (หัวห้องกดจบ) = ไม่ได้เหรียญ
};
const WIN_LABEL = { time: 'ชนะ (ทรัพย์สินมากสุด)', bankrupt: 'ชนะ (คนอื่นล้มละลาย)', line: 'ผูกขาดแถว', triple: 'ผูกขาด 3 สี', tourist: 'ผูกขาดท่องเที่ยว' };

function isBotId(id) { return String(id || '').startsWith('bot_'); }

/**
 * รางวัลของทุกคนในเกมที่จบแล้ว (ก่อนเพดานรายวัน — ร้านเป็นคนหักเพดาน)
 * คืน { [playerId]: { total, parts: [{ key, label, amount }], botGame, reason } }
 *  - ได้เฉพาะคนที่ยังนั่งอยู่จนจบ (ออกกลางเกม = 0) · บอทไม่ได้
 *  - เกมที่ใช้เมนูทดสอบ /m = 0 ทุกคน · เกมสั้นเกิน (ไม่ถึงรอบ 3 และไม่ได้จบด้วยผูกขาด/ล้มละลาย) = 0
 *  - ไม่มีคนจริงคนอื่นอยู่จนจบ = ครึ่งเดียว (และนับเพดานเกมบอทรายวัน)
 */
function computeRewards(state) {
    const out = {};
    if (!state || state.phase !== 'finished' || !Array.isArray(state.seats)) return out;
    const winners = new Set((state.winners || []).map(w => w.playerId));
    const seated = state.seats.filter(s => !s.left && !isBotId(s.playerId));
    const humansAtEnd = seated.length;
    const botGame = humansAtEnd < 2;
    const boardWin = state.endCause === 'monopoly' || state.endCause === 'bankrupt';
    const short = (Number(state.round) || 1) < REWARD.minRounds && !boardWin;
    seated.forEach(seat => {
        const row = { total: 0, parts: [], botGame, reason: null };
        out[seat.playerId] = row;
        if (state.debugUsed) { row.reason = 'debug'; return; }
        if (short) { row.reason = 'short'; return; }
        row.parts.push({ key: 'finished', label: 'เล่นจนจบ', amount: REWARD.finished });
        if (winners.has(seat.playerId) && REWARD.win[state.winType]) {
            row.parts.push({ key: 'win', label: WIN_LABEL[state.winType], amount: REWARD.win[state.winType] });
        }
        const feats = (Number(seat.landmarksBuilt) || 0) + (Number(seat.takeovers) || 0);
        if (feats > 0) {
            row.parts.push({ key: 'feats', label: `แลนด์มาร์ก/ซื้อต่อ ×${feats}`, amount: Math.min(REWARD.featCap, feats * REWARD.perFeat) });
        }
        let total = row.parts.reduce((sum, p) => sum + p.amount, 0);
        if (botGame) {
            const half = Math.floor(total * REWARD.botGameMult);
            row.parts.push({ key: 'botGame', label: 'เล่นกับบอท ครึ่งเดียว', amount: half - total });
            total = half;
        }
        row.total = Math.max(0, total);
    });
    return out;
}

module.exports = {
    MAX_LEVEL,
    LOADOUT_SIZE,
    UPGRADE_COST,
    SKILLS,
    SKILL_IDS,
    SKILL_BY_ID,
    BAD_CARDS,
    FESTIVAL_LV5_START,
    REWARD,
    clampLevel,
    valueOf,
    upgradeCost,
    procChance,
    snapshotLoadout,
    sanitizeSkillMap,
    publicSkills,
    computeRewards
};
