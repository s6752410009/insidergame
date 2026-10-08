/**
 * วัดฝีมือบอทหมาป่า — บอทล้วนเล่นจนจบหลายพันเกม (seed คงที่) แล้วนับว่าใครชนะ
 *
 *  random  : ตั้งค่าห้องสุ่มแบบเดียวกับ smoke:werewolf:bots:engine (5–16 คน)
 *  fool    : บทสุ่มที่ "มีคนบ้าแน่นอน" (7–16 คน) — ดูว่าหมู่บ้านจับคนบ้าได้ไหม
 *  classic : หมาป่า + บทหมู่บ้าน ไม่มีบทเดี่ยว (6–16 คน) — วัดหมู่บ้าน vs หมาป่าล้วนๆ
 *
 *  hwolf   : แบบ classic แต่มี "คนจริงง่ายๆ" 1 ที่นั่งเป็นหมาป่า (โหวตตามเสียงข้างมาก ไม่อ้างบท ไม่แชท) → อัตราชนะของคนนั้น
 *  hvill   : แบบ classic แต่ "คนจริงง่ายๆ" 1 ที่นั่งเป็นชาวบ้าน (โหวตคนที่โดนโหวตมากสุด) → หมู่บ้านชนะกี่ %
 *  ต่อท้าย @n เพื่อกำหนดจำนวนคน เช่น classic@8, random@20
 *
 * รัน: node scripts/sim-werewolf-bots.js            (GAMES=400 ต่อกลุ่ม)
 *      GROUPS=classic@5,classic@8,hwolf node ...     (เลือกกลุ่ม) · SEED0=1000 (เลื่อนชุด seed)
 *      BOTS=/path/to/werewolfBots.js node ...      (เทียบกับบอทเวอร์ชันอื่น เช่นเวอร์ชันก่อนหน้า)
 *      FOOL_SILENT=1 node ...                      (ลบท่าทีคนบ้าออกจากความจำบอท = คนบ้าที่เล่นเนียนสนิท)
 */
const path = require('path');
const E = require('../games/werewolfEngine');

const bots = require(process.env.BOTS ? path.resolve(process.env.BOTS) : '../games/werewolfBots');
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
const VILLAGE_ROLES = ['seer', 'oracle', 'doctor', 'witch', 'bodyguard', 'mayor', 'revealer', 'tracker', 'vigilante', 'hunter', 'cleric', 'prince', 'lycan', 'diseased', 'apprenticeSeer'];

function settingsFor(group, rng) {
    if (group === 'random') {
        const settings = { gameMode: 'werewolf', werewolfRevealOnDeath: rng() < 0.3 };
        const mode = rng();
        if (mode < 0.4) settings.werewolfRoles = [];
        else if (mode < 0.6) { settings.werewolfRoles = []; settings.wolfCount = 1 + Math.floor(rng() * 5); }
        else {
            const pool = E.CONFIGURABLE_ROLE_IDS.filter(() => rng() < 0.6);
            settings.werewolfRoles = pool.length ? pool : ['werewolf', 'seer'];
        }
        return settings;
    }
    const pool = VILLAGE_ROLES.filter(() => rng() < 0.55);
    const roles = ['werewolf', ...(rng() < 0.5 ? ['alphaWolf'] : []), 'seer', ...pool];
    if (group === 'fool') roles.push('fool');
    return { gameMode: 'werewolf', werewolfRevealOnDeath: rng() < 0.3, werewolfRoles: [...new Set(roles)] };
}

const isWolfRole = r => r === 'werewolf' || r === 'alphaWolf';

/** "คนจริงง่ายๆ": ไม่แชท ไม่อ้างบท · กลางคืนตามฝูง (หมาป่า) หรือกดพร้อม · กลางวันโหวตตามคนที่โดนโหวตมากสุด */
function simpleHumanAct(room, human, rng) {
    const s = room.gameState;
    if (!human || human.alive === false || s.winner) return false;
    const tryDo = fn => { try { fn(); return true; } catch (error) { return false; } };
    if (s.phase === 'night') {
        if (isWolfRole(human.role) && E.canWolvesHuntTonight(room) && !s.nightActions?.werewolfVotes?.[human.playerId]) {
            const packPick = Object.entries(s.nightActions?.werewolfVotes || {}).find(([id, t]) => id !== human.playerId && t && t !== E.SKIP_TARGET_ID)?.[1];
            const prey = s.players.filter(p => p.alive !== false && !isWolfRole(p.role));
            const target = packPick || (prey.length ? prey[Math.floor(rng() * prey.length)].playerId : null);
            if (target && tryDo(() => E.submitNightAction(room, human.playerId, target))) return true;
        }
        if (!E.isPlayerReadyForMorning(room, human)) return tryDo(() => E.submitNightSkip(room, human.playerId));
        return false;
    }
    if (s.phase === 'day-discussion') {
        if (s.discussionSkips?.[human.playerId]) return false;
        return tryDo(() => E.submitDiscussionSkip(room, human.playerId));
    }
    if (s.phase === 'day-vote') {
        if (s.dayVotes?.[human.playerId]) return false;
        const tally = {};
        Object.entries(s.dayVotes || {}).forEach(([, t]) => { if (t && t !== E.SKIP_TARGET_ID) tally[t] = (tally[t] || 0) + 1; });
        const ok = id => {
            const p = s.players.find(x => x.playerId === id);
            return p && p.alive !== false && id !== human.playerId && !(isWolfRole(human.role) && isWolfRole(p.role));
        };
        const top = Object.entries(tally).filter(([id]) => ok(id)).sort((a, b) => b[1] - a[1])[0];
        return tryDo(() => E.submitDayVote(room, human.playerId, top ? top[0] : E.SKIP_TARGET_ID, { lastCall: true }));
    }
    return false;
}

function playGame(spec, seed) {
    const [group, fixedN] = spec.split('@');
    const base = group === 'hwolf' || group === 'hvill' ? 'classic' : group;
    const rng = mulberry32(seed * 7717 + spec.length * 101);
    Math.random = mulberry32(seed * 31337 + spec.length);
    const lo = base === 'random' ? 5 : (base === 'fool' ? 7 : 6);
    const n = fixedN ? Number(fixedN) : lo + Math.floor(rng() * (17 - lo));
    const humanSeat = base !== group;
    const room = {
        roomId: `sim-${spec}-${seed}`,
        name: 'sim',
        admin: 'bot_0',
        settings: settingsFor(base, rng),
        players: Array.from({ length: n }, (_, i) => ({ playerId: humanSeat && i === 0 ? 'h_0' : `bot_${i}s`, playerName: `บอท${i}`, socketId: `bot_socket_${i}`, color: '#fff', avatar: '🤖' }))
    };
    E.startGame(room);
    let human = null;
    if (humanSeat) {
        human = room.gameState.players.find(p => p.playerId === 'h_0');
        const want = group === 'hwolf' ? (p => isWolfRole(p.role)) : (p => p.role === 'villager');
        const donor = room.gameState.players.find(want);
        if (donor && donor !== human) {
            [donor.role, human.role] = [human.role, donor.role];
            [donor.roleInfo, human.roleInfo] = [human.roleInfo, donor.roleInfo];
        }
    }
    const roles = room.gameState.players.map(p => p.role);
    let fakeNow = 1_000_000;
    for (let loops = 0; !room.gameState.winner && loops < 4000; loops += 1) {
        fakeNow += 1000;
        const result = bots.playBotTurns(room, { force: true, rng, now: fakeNow });
        if (process.env.FOOL_SILENT && room.gameState.botBrain) room.gameState.botBrain.tells = {};
        if (result.changed) continue;
        if (human && simpleHumanAct(room, human, rng)) continue;
        E.autoResolvePhase(room);
    }
    return {
        winner: room.gameState.winner || 'stuck',
        hasFool: roles.includes('fool'),
        hasKiller: roles.includes('serialKiller'),
        humanRole: human ? human.role : null,
        days: room.gameState.dayNumber,
        n
    };
}

function pct(part, total) {
    return total ? `${((100 * part) / total).toFixed(1)}%` : '-';
}

(function main() {
    const groups = (process.env.GROUPS || 'random,fool,classic').split(',');
    const rows = [];
    groups.forEach(group => {
        const tally = { games: 0, days: 0, winners: {}, foolGames: 0, foolWins: 0, killerGames: 0, killerWins: 0, soloFree: 0, soloFreeVillage: 0 };
        const seed0 = Number(process.env.SEED0) || 0;
        for (let seed = seed0 + 1; seed <= seed0 + GAMES; seed += 1) {
            const g = playGame(group, seed);
            tally.games += 1;
            tally.days += g.days;
            tally.winners[g.winner] = (tally.winners[g.winner] || 0) + 1;
            if (g.hasFool) {
                tally.foolGames += 1;
                if (g.winner === 'fool') tally.foolWins += 1;
            }
            if (g.hasKiller) {
                tally.killerGames += 1;
                if (g.winner === 'serialKiller') tally.killerWins += 1;
            }
            if (!g.hasFool && !g.hasKiller) {
                tally.soloFree += 1;
                if (g.winner === 'village') tally.soloFreeVillage += 1;
            }
        }
        const w = tally.winners;
        rows.push({
            group,
            games: tally.games,
            village: pct(w.village || 0, tally.games),
            werewolf: pct(w.werewolf || 0, tally.games),
            fool: pct(w.fool || 0, tally.games),
            serialKiller: pct(w.serialKiller || 0, tally.games),
            stuck: w.stuck || 0,
            'fool rate (games with fool)': `${pct(tally.foolWins, tally.foolGames)} of ${tally.foolGames}`,
            'killer rate (games with killer)': `${pct(tally.killerWins, tally.killerGames)} of ${tally.killerGames}`,
            'village (no solo roles)': `${pct(tally.soloFreeVillage, tally.soloFree)} of ${tally.soloFree}`,
            'avg days': (tally.days / tally.games).toFixed(1)
        });
    });
    Math.random = realRandom;
    console.log(`werewolf bots sim · ${process.env.BOTS ? path.basename(path.dirname(path.resolve(process.env.BOTS))) + '/' + path.basename(process.env.BOTS) : 'current'} · ${GAMES} games/group`);
    console.table(rows);
})();
