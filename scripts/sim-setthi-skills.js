/**
 * เศรษฐี 🪙 — จำลองสมดุลสกิล: บอท 4 ตัว (สมองบอทเดียวกัน) มี 1 ตัว ("ฮีโร่") ติดสกิล อีก 3 ตัวไม่มี
 * วัดอัตราชนะของฮีโร่ (ชนะร่วม = หารเท่า) · ฐาน = 25%
 *
 * จังหวะเวลา: นาฬิกาจำลองเดินตามเวลาฉาก (fxCost) + เวลาคิดของบอท 1 วิ (เหมือนเกมบอทจริงบนเซิร์ฟเวอร์)
 * โหมด: 30 นาที (หมดเวลานับทรัพย์สิน) และไม่จำกัดเวลา
 *
 * รัน: node scripts/sim-setthi-skills.js [games ต่อชุด=400] [top=6] [validate=4000]
 *      SIM_MODE=30|0|both (ค่าเริ่ม both) · SIM_ONLY=single|combos|max
 */
process.env.SETTHI_ANIM_SCALE = '1';
process.env.SETTHI_BOT_MS = process.env.SIM_THINK_MS || '1000'; // เวลาคิดต่อการตัดสินใจ (คนจริงช้ากว่าบอท)
const E = require('../games/setthiEngine');
const SK = require('../games/setthiSkills');

function mulberry(a) {
    return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let T = 1.7e12;
E.setClock(() => T);

/** 1 เกม: คืน { share: ส่วนชนะของฮีโร่ 0..1, winType, rounds } */
function playOne(seed, heroSkills, minutes) {
    const rng = mulberry(seed);
    E.setRng(rng);
    const ids = ['bot_0', 'bot_1', 'bot_2', 'bot_3'];
    const hero = ids[seed % 4]; // หมุนที่นั่ง (ใครเริ่มก่อนสุ่มจาก rng)
    const room = { roomId: 'sim', admin: ids[0], settings: { gameMode: 'setthi', setthiMinutes: minutes }, players: ids.map(id => ({ playerId: id, playerName: id })) };
    E.startGame(room, rng, { skills: heroSkills ? { [hero]: heroSkills } : {} });
    const S = room.gameState;
    let guard = 0;
    while (S.phase !== 'finished' && guard < 20000) {
        const d = E.botDelay(room, T);
        T += d === null ? 1000 : Math.max(1, d) + 30;
        if (!E.playBotTurns(room, rng, T)) E.tick(room, rng);
        guard += 1;
    }
    E.setRng(null);
    const winners = S.winners || [];
    const share = winners.some(w => w.playerId === hero) ? 1 / winners.length : 0;
    return { share, winType: S.winType, rounds: S.round, procs: S.seats.find(x => x.playerId === hero).skillProcs || {} };
}

function run(heroSkills, games, minutes, seed0 = 1) {
    let wins = 0;
    let rounds = 0;
    const types = {};
    const procs = {};
    for (let g = 0; g < games; g += 1) {
        const r = playOne(seed0 + g, heroSkills, minutes);
        wins += r.share;
        rounds += r.rounds;
        types[r.winType || 'none'] = (types[r.winType || 'none'] || 0) + 1;
        Object.entries(r.procs).forEach(([k, v]) => { procs[k] = (procs[k] || 0) + v; });
    }
    const p = wins / games;
    return { rate: p, se: Math.sqrt(p * (1 - p) / games), rounds: rounds / games, types, procsPerGame: Object.fromEntries(Object.entries(procs).map(([k, v]) => [k, +(v / games).toFixed(2)])) };
}
const pct = x => (x * 100).toFixed(1) + '%';
const fmt = r => `${pct(r.rate)} ±${pct(1.96 * r.se)} (รอบเฉลี่ย ${r.rounds.toFixed(1)})`;

function combos(list, k) {
    const out = [];
    (function rec(start, acc) {
        if (acc.length === k) { out.push(acc.slice()); return; }
        for (let i = start; i < list.length; i += 1) { acc.push(list[i]); rec(i + 1, acc); acc.pop(); }
    })(0, []);
    return out;
}

const N = Number(process.argv[2]) || 400;
const TOP = Number(process.argv[3]) || 6;
const VALIDATE = Number(process.argv[4]) || 4000;
const MODE = process.env.SIM_MODE || 'both';
const ONLY = process.env.SIM_ONLY || '';
const modes = MODE === 'both' ? [30, 0] : [Number(MODE)];
const started = Date.now();

for (const minutes of modes) {
    const label = minutes ? `${minutes} นาที` : 'ไม่จำกัดเวลา';
    console.log(`\n=== ${label} · 4 บอท · ฮีโร่ 1 ตัว ===`);
    const base = run(null, VALIDATE, minutes, 900000);
    console.log(`ฐาน (ไม่มีสกิล, ${VALIDATE} เกม): ${fmt(base)} · จบแบบ ${JSON.stringify(base.types)}`);
    if (!ONLY || ONLY === 'single') {
        console.log(`-- สกิลเดี่ยว Lv5 (${N * 2} เกม)`);
        SK.SKILL_IDS.forEach(id => {
            const r = run({ [id]: 5 }, N * 2, minutes, 100000);
            console.log(`  ${SK.SKILL_BY_ID.get(id).icon} ${id.padEnd(10)} ${fmt(r)} · ติด/เกม ${JSON.stringify(r.procsPerGame)}`);
        });
    }
    let ranked = [];
    if (!ONLY || ONLY === 'combos' || ONLY === 'max') {
        const all = combos(SK.SKILL_IDS, 3);
        console.log(`-- ทุกชุด 3 สกิล Lv5 (${all.length} ชุด × ${N} เกม)`);
        ranked = all.map(c => ({ c, r: run(Object.fromEntries(c.map(id => [id, 5])), N, minutes, 200000) })).sort((a, b) => b.r.rate - a.r.rate);
        ranked.slice(0, TOP).forEach(x => console.log(`  ${x.c.join('+').padEnd(32)} ${fmt(x.r)}`));
        const mean = ranked.reduce((a, x) => a + x.r.rate, 0) / ranked.length;
        console.log(`  เฉลี่ยทุกชุด ${pct(mean)} · ชุดที่ ≥ 35% (ก่อนยืนยัน) ${ranked.filter(x => x.r.rate >= 0.35).length}/${ranked.length}`);
        console.log(`  ... อ่อนสุด ${ranked[ranked.length - 1].c.join('+')} ${fmt(ranked[ranked.length - 1].r)}`);
        console.log(`-- ยืนยันชุดแรง ${Math.min(Number(process.env.SIM_VALIDATE_TOP) || 3, ranked.length)} ชุด (${VALIDATE} เกม, seed ใหม่)`);
        ranked.slice(0, Number(process.env.SIM_VALIDATE_TOP) || 3).forEach(x => {
            const r = run(Object.fromEntries(x.c.map(id => [id, 5])), VALIDATE, minutes, 500000);
            console.log(`  ${x.c.join('+').padEnd(32)} ${fmt(r)} · ติด/เกม ${JSON.stringify(r.procsPerGame)}`);
        });
    }
}
console.log(`\nเวลา ${((Date.now() - started) / 1000).toFixed(0)}s`);
