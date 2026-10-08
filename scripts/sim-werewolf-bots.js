/**
 * วัดฝีมือบอทหมาป่า — บอทล้วนเล่นจนจบหลายพันเกม (seed คงที่) แล้วนับว่าใครชนะ
 *
 *  random  : ตั้งค่าห้องสุ่มแบบเดียวกับ smoke:werewolf:bots:engine (5–16 คน)
 *  fool    : บทสุ่มที่ "มีคนบ้าแน่นอน" (7–16 คน) — ดูว่าหมู่บ้านจับคนบ้าได้ไหม
 *  classic : หมาป่า + บทหมู่บ้าน ไม่มีบทเดี่ยว (6–16 คน) — วัดหมู่บ้าน vs หมาป่าล้วนๆ
 *
 * รัน: node scripts/sim-werewolf-bots.js            (GAMES=400 ต่อกลุ่ม)
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

function playGame(group, seed) {
    const rng = mulberry32(seed * 7717 + group.length * 101);
    Math.random = mulberry32(seed * 31337 + group.length);
    const lo = group === 'random' ? 5 : (group === 'fool' ? 7 : 6);
    const n = lo + Math.floor(rng() * (17 - lo));
    const room = {
        roomId: `sim-${group}-${seed}`,
        name: 'sim',
        admin: 'bot_0',
        settings: settingsFor(group, rng),
        players: Array.from({ length: n }, (_, i) => ({ playerId: `bot_${i}s`, playerName: `บอท${i}`, socketId: `bot_socket_${i}`, color: '#fff', avatar: '🤖' }))
    };
    E.startGame(room);
    const roles = room.gameState.players.map(p => p.role);
    let fakeNow = 1_000_000;
    for (let loops = 0; !room.gameState.winner && loops < 4000; loops += 1) {
        fakeNow += 1000;
        const result = bots.playBotTurns(room, { force: true, rng, now: fakeNow });
        if (process.env.FOOL_SILENT && room.gameState.botBrain) room.gameState.botBrain.tells = {};
        if (!result.changed) E.autoResolvePhase(room);
    }
    return {
        winner: room.gameState.winner || 'stuck',
        hasFool: roles.includes('fool'),
        hasKiller: roles.includes('serialKiller'),
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
        const tally = { games: 0, days: 0, winners: {}, foolGames: 0, foolWins: 0, soloFree: 0, soloFreeVillage: 0 };
        for (let seed = 1; seed <= GAMES; seed += 1) {
            const g = playGame(group, seed);
            tally.games += 1;
            tally.days += g.days;
            tally.winners[g.winner] = (tally.winners[g.winner] || 0) + 1;
            if (g.hasFool) {
                tally.foolGames += 1;
                if (g.winner === 'fool') tally.foolWins += 1;
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
            'village (no solo roles)': `${pct(tally.soloFreeVillage, tally.soloFree)} of ${tally.soloFree}`,
            'avg days': (tally.days / tally.games).toFixed(1)
        });
    });
    Math.random = realRandom;
    console.log(`werewolf bots sim · ${process.env.BOTS ? path.basename(path.dirname(path.resolve(process.env.BOTS))) + '/' + path.basename(process.env.BOTS) : 'current'} · ${GAMES} games/group`);
    console.table(rows);
})();
