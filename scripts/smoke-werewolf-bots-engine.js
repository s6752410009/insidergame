/**
 * บอทหมาป่าระดับ engine — สุ่มเล่นจนจบหลาย seed · 3–20 คน · ทุกบท (รวม 5 บทใหม่)
 *
 *  A) บอทล้วน: กลางคืน/ช่วงประชุมต้องจบเองโดยไม่ต้องรอหมดเวลา (บอทกดพร้อม/ใช้สกิล/ข้ามครบ)
 *  B) คน 1 + บอท: คนกดสุ่มทุกอย่างที่กติกาให้
 *  C) คน 1 + บอท: คนไม่กดอะไรเลย (นาฬิกาเดินแทน)
 *  D) โต๊ะบทกำหนดเอง: บทใหม่ทั้ง 5 + บทสกิลครบ เพื่อให้ทุกบทได้ลงมือจริง
 * ทุกเกม: ไม่มี exception · ไม่ค้าง (จบภายใน 60 วัน) · ผู้ชนะถูกต้อง · คืนแรกหมาป่า/ฆาตกรไม่ลงมือ
 * · หมาป่าไม่โหวต/ไม่กัดหมาป่า · บอทที่ตายแล้วไม่ทำอะไร ไม่แชท · แชทเป็นประโยคกลางๆ เท่านั้น
 * · state ที่ส่งให้คนไม่มีความจำของบอท
 *
 * รัน: node scripts/smoke-werewolf-bots-engine.js   (SEEDS=40 เพื่อเพิ่มรอบ)
 */
const E = require('../games/werewolfEngine');
const bots = require('../games/werewolfBots');

const SKIP = E.SKIP_TARGET_ID;
const WINNERS = new Set(['village', 'werewolf', 'fool', 'serialKiller']);
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
const isWolfRole = r => r === 'werewolf' || r === 'alphaWolf';

function randomSettings(rng) {
    const settings = { gameMode: 'werewolf', werewolfRevealOnDeath: rng() < 0.3, werewolfDeadSeeRoles: rng() < 0.8 };
    const mode = rng();
    if (mode < 0.4) settings.werewolfRoles = [];
    else if (mode < 0.6) { settings.werewolfRoles = []; settings.wolfCount = 1 + Math.floor(rng() * 5); }
    else {
        const pool = E.CONFIGURABLE_ROLE_IDS.filter(() => rng() < 0.6);
        settings.werewolfRoles = pool.length ? pool : ['werewolf', 'seer'];
    }
    return settings;
}

function makeRoom(n, humans, settings, forcedRoles = null) {
    const room = {
        roomId: `wwbots-${n}-${Math.floor(Math.random() * 1e9)}`,
        name: 'bots sim',
        admin: humans ? 'h1' : 'bot_0',
        settings,
        players: Array.from({ length: n }, (_, i) => {
            const human = i < humans;
            return { playerId: human ? `h${i + 1}` : `bot_${i}abc`, playerName: human ? `คน${i + 1}` : `บอท${i}`, socketId: human ? `s${i}` : `bot_socket_${i}`, color: '#fff', avatar: '🤖' };
        })
    };
    E.startGame(room);
    if (forcedRoles) {
        room.gameState.players.forEach((player, index) => {
            player.role = forcedRoles[index];
            player.roleInfo = E.ROLE_DEFINITIONS[forcedRoles[index]];
        });
        room.gameState.rolePlan = forcedRoles.map(r => E.ROLE_DEFINITIONS[r]);
    }
    return room;
}

const tally = { games: 0, days: 0, winners: {}, timers: { night: 0, 'day-discussion': 0, 'day-vote': 0 }, chats: 0, roleActs: {}, maxDays: 0, sizes: new Set() };

function noteActions(room, seen) {
    const s = room.gameState;
    const na = s.nightActions || {};
    const maps = { werewolfVotes: 'wolf-kill', seerChecks: 'seer-check', oracleReads: 'oracle-read', doctorSaves: 'doctor-save', bodyguardProtects: 'bodyguard', witchHeals: 'witch-heal', witchPoisons: 'witch-poison', trackerScans: 'tracker', vigilanteShots: 'vigilante', hunterShots: 'hunter', serialKills: 'serial-kill' };
    Object.entries(maps).forEach(([key, label]) => {
        Object.entries(na[key] || {}).forEach(([actorId, targetId]) => {
            if (!targetId || targetId === SKIP || !bots.isBotId(actorId)) return;
            const actor = s.players.find(p => p.playerId === actorId);
            const target = s.players.find(p => p.playerId === targetId);
            const tag = `${s.dayNumber}:${key}:${actorId}`;
            if (seen.has(tag)) return;
            seen.add(tag);
            // ส่งสกิลแล้วคืนนั้นจบในจังหวะเดียวกัน คนส่งอาจตายตอนเช้า — ตรวจเฉพาะตอนยังเป็นกลางคืน
            if (s.phase === 'night') assert(actor && actor.alive !== false, 'บอทที่ตายแล้วใช้สกิล');
            if (key === 'werewolfVotes') {
                assert(s.dayNumber > 1, 'หมาป่าบอทกัดคืนแรก');
                assert(!isWolfRole(target.role), 'หมาป่าบอทกัดหมาป่า');
            }
            if (key === 'serialKills') assert(s.dayNumber > 1, 'ฆาตกรบอทฆ่าคืนแรก');
            const roleLabel = actor.role === 'apprenticeSeer' && key === 'seerChecks' ? 'apprentice-check' : label;
            tally.roleActs[roleLabel] = (tally.roleActs[roleLabel] || 0) + 1;
        });
    });
    s.players.forEach(p => {
        if (!bots.isBotId(p.playerId)) return;
        if (p.role === 'cleric' && p.clericBlessUsed && !seen.has('cleric:' + p.playerId)) { seen.add('cleric:' + p.playerId); tally.roleActs.cleric = (tally.roleActs.cleric || 0) + 1; }
        if (p.role === 'mayor' && p.mayorRevealed && !seen.has('mayor:' + p.playerId)) { seen.add('mayor:' + p.playerId); tally.roleActs.mayor = (tally.roleActs.mayor || 0) + 1; }
        if (p.role === 'revealer' && p.revealerUsed && !seen.has('rev:' + p.playerId)) { seen.add('rev:' + p.playerId); tally.roleActs.revealer = (tally.roleActs.revealer || 0) + 1; }
        if (p.role === 'prince' && p.princeRevealed && !seen.has('prince:' + p.playerId)) { seen.add('prince:' + p.playerId); tally.roleActs['prince-survived'] = (tally.roleActs['prince-survived'] || 0) + 1; }
    });
    if (s.wolvesSickNight && !seen.has('sick:' + s.wolvesSickNight)) { seen.add('sick:' + s.wolvesSickNight); tally.roleActs['diseased-sick'] = (tally.roleActs['diseased-sick'] || 0) + 1; }
    // หมาป่าบอทโหวตกลางวัน: ไม่โหวตหมาป่า
    Object.entries(s.dayVotes || {}).forEach(([voterId, targetId]) => {
        const voter = s.players.find(p => p.playerId === voterId);
        const target = s.players.find(p => p.playerId === targetId);
        if (bots.isBotId(voterId) && voter && isWolfRole(voter.role) && target) assert(!isWolfRole(target.role), 'หมาป่าบอทโหวตหมาป่า');
    });
}

function humanAct(room, human, rng, done) {
    const s = room.gameState;
    if (!human || human.alive === false) return false;
    const key = `${s.phase}:${s.dayNumber}`;
    if (done.has(key)) return false;
    done.add(key);
    try {
        if (s.phase === 'night') {
            const options = E.getNightActionOptions(room, human);
            options.forEach(option => {
                if (option.locked || !option.allowSkip) return;
                const targets = option.targets || [];
                const target = targets.length && rng() < 0.6 ? targets[Math.floor(rng() * targets.length)].playerId : SKIP;
                try { E.submitNightAction(room, human.playerId, target, option.type.startsWith('witch') ? option.type : null); } catch (e) { /* ผิดกติกาก็ข้าม */ }
            });
            if (s.phase === 'night') { E.submitNightSkip(room, human.playerId); if (room.gameState.phase === 'night') E.maybeAutoEndNight(room); }
        } else if (s.phase === 'day-discussion') {
            if (human.role === 'mayor' && rng() < 0.4) { try { E.submitMayorReveal(room, human.playerId); } catch (e) { /* */ } }
            if (rng() < 0.7) E.submitDiscussionSkip(room, human.playerId);
        } else if (s.phase === 'day-vote') {
            const others = s.players.filter(p => p.alive !== false && p.playerId !== human.playerId);
            const target = rng() < 0.8 && others.length ? others[Math.floor(rng() * others.length)].playerId : SKIP;
            E.submitDayVote(room, human.playerId, target, { lastCall: true });
        }
    } catch (error) {
        if (!/ยังไม่ใช่|ไม่ใช่ช่วง/.test(error.message)) throw error;
    }
    return true;
}

function playGame(seed, n, humanMode, forcedRoles = null) {
    const rng = mulberry32(seed * 977 + n * 13 + (humanMode === 'none' ? 0 : humanMode === 'random' ? 1 : 2));
    Math.random = mulberry32(seed * 31337 + n);
    const humans = humanMode === 'none' ? 0 : 1;
    const settings = forcedRoles
        ? { gameMode: 'werewolf', werewolfRoles: [...new Set(forcedRoles.filter(r => r !== 'villager'))], werewolfRevealOnDeath: rng() < 0.5 }
        : randomSettings(rng);
    const room = makeRoom(n, humans, settings, forcedRoles);
    const label = `seed ${seed} · ${n} คน · คน=${humanMode}${forcedRoles ? ' · บทกำหนด' : ''}`;
    const human = room.gameState.players.find(p => !bots.isBotId(p.playerId));
    const seen = new Set();
    const humanDone = new Set();
    let loops = 0;
    let fakeNow = 1_000_000;
    while (!room.gameState.winner) {
        loops += 1;
        assert(loops < 3000, `${label}: ค้าง (วนเกิน 3000) phase=${room.gameState.phase} day=${room.gameState.dayNumber}`);
        assert(room.gameState.dayNumber <= 60, `${label}: เกมไม่จบใน 60 วัน`);
        fakeNow += 1000;
        const before = room.gameState.phase;
        const result = bots.playBotTurns(room, { force: true, rng, now: fakeNow });
        result.chats.forEach(chat => {
            const speaker = room.gameState.players.find(p => p.playerId === chat.playerId);
            assert(speaker && speaker.alive !== false, `${label}: บอทที่ตายแล้วแชท`);
            assert(before === 'day-discussion', `${label}: บอทแชทนอกช่วงประชุม (${before})`);
            assert(bots.CHAT_LINES.includes(chat.text), `${label}: บอทแชทประโยคนอกชุดกลาง`);
            tally.chats += 1;
        });
        noteActions(room, seen);
        if (result.changed) continue;
        if (humanMode === 'random' && humanAct(room, human, rng, humanDone)) { noteActions(room, seen); continue; }
        // ไม่มีใครทำอะไรได้แล้ว = นาฬิกาเฟสหมด (หรือหัวห้องกดข้าม)
        const phase = room.gameState.phase;
        if (humanMode === 'none' && phase !== 'day-vote') {
            throw new Error(`${label}: บอทล้วนแต่ ${phase} ต้องรอนาฬิกา (บอทไม่กดพร้อม/ข้าม) pending=${JSON.stringify(bots.pendingBotDecisions(room, fakeNow))}`);
        }
        if (humanMode === 'none' && phase === 'day-vote') {
            assert(!!room.gameState.voteClosesAt, `${label}: บอทล้วนโหวตไม่ครบจนต้องรอหมดเวลา`);
        }
        tally.timers[phase] = (tally.timers[phase] || 0) + 1;
        E.autoResolvePhase(room);
    }
    const s = room.gameState;
    assert(WINNERS.has(s.winner), `${label}: ผู้ชนะไม่ถูกต้อง ${s.winner}`);
    const alive = s.players.filter(p => p.alive !== false);
    if (s.winner === 'village') assert(!alive.some(p => isWolfRole(p.role) || p.role === 'serialKiller'), `${label}: หมู่บ้านชนะทั้งที่หมาป่า/ฆาตกรยังอยู่`);
    if (s.winner === 'werewolf') assert(alive.some(p => isWolfRole(p.role)), `${label}: หมาป่าชนะทั้งที่ไม่มีหมาป่ารอด`);
    if (s.winner === 'serialKiller') assert(alive.some(p => p.role === 'serialKiller'), `${label}: ฆาตกรชนะทั้งที่ตาย`);
    if (human) {
        const view = JSON.stringify(E.buildClientState(room, human.playerId));
        assert(!view.includes('botBrain'), `${label}: ความจำบอทหลุดไปหน้าเว็บ`);
    }
    tally.games += 1;
    tally.days += s.dayNumber;
    tally.maxDays = Math.max(tally.maxDays, s.dayNumber);
    tally.winners[s.winner] = (tally.winners[s.winner] || 0) + 1;
    tally.sizes.add(n);
}

/** ระหว่างเกม: state ของคนที่ยังมีชีวิตไม่มีบทของบอทหลุดมา (นอกจากที่เปิดเผยแล้ว) */
function leakCheck() {
    Math.random = mulberry32(99);
    const room = makeRoom(8, 1, { gameMode: 'werewolf', werewolfRoles: [] });
    const rng = mulberry32(7);
    for (let i = 0; i < 40 && !room.gameState.winner; i += 1) {
        bots.playBotTurns(room, { force: true, rng });
        const view = E.buildClientState(room, 'h1');
        if (view.players.find(p => p.isSelf).alive) {
            view.players.filter(p => !p.isSelf && p.alive).forEach(p => {
                if (!p.princeRevealed) assert(p.roleId === null, 'บทบอทหลุดไปหน้าคนที่ยังมีชีวิต');
            });
        }
        if (!bots.playBotTurns(room, { force: true, rng }).changed) E.autoResolvePhase(room);
    }
}

function targetedChecks() {
    // ผู้หยั่งรู้บอทที่เห็นว่าใคร "ไม่ดี" ต้องโหวตคนนั้น
    Math.random = mulberry32(5);
    const roles = ['werewolf', 'seer', 'villager', 'villager', 'villager'];
    const room = makeRoom(5, 0, { gameMode: 'werewolf', werewolfRoles: ['werewolf', 'seer'] }, roles);
    const seer = room.gameState.players[1];
    const wolf = room.gameState.players[0];
    seer.seerHistory = [{ dayNumber: 1, targetPlayerId: wolf.playerId, resultCode: 'bad' }];
    room.gameState.phase = 'day-vote';
    room.gameState.dayNumber = 2;
    const scores = room.gameState.players.filter(p => p !== seer).map(p => ({ id: p.playerId, s: bots.voteScore(room, seer, p) }));
    assert(scores.sort((a, b) => b.s - a.s)[0].id === wolf.playerId, 'ผู้หยั่งรู้บอทต้องโหวตคนที่ตรวจเจอว่าไม่ดี');
    // หมาป่าบอทไม่มีวันให้คะแนนหมาป่า
    const wolves = makeRoom(6, 0, { gameMode: 'werewolf', werewolfRoles: ['werewolf'] }, ['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
    assert(bots.voteScore(wolves, wolves.gameState.players[0], wolves.gameState.players[1]) === null, 'หมาป่าบอทต้องไม่โหวตหมาป่า');
    // คืนแรก: หมาป่าบอทแค่กดพร้อม ไม่ได้ส่งเป้า
    assert(bots.nightNeed(wolves, wolves.gameState.players[0]) === 'ready', 'คืนแรกหมาป่าบอทต้องแค่กดพร้อม');
    // คืนสอง: หมาป่าตัวที่สองตามเป้าของตัวแรก (ฝูงเดียวกัน)
    E.autoResolvePhase(wolves); E.autoResolvePhase(wolves); E.autoResolvePhase(wolves);
    assert(wolves.gameState.phase === 'night' && wolves.gameState.dayNumber === 2, 'ต้องถึงคืนที่สอง');
    const [w1, w2] = wolves.gameState.players;
    const t1 = bots.planNight(wolves, w1, mulberry32(1))[0].target;
    E.submitNightAction(wolves, w1.playerId, t1);
    assert(bots.planNight(wolves, w2, mulberry32(2))[0].target === t1, 'หมาป่าบอทต้องตามเป้าของฝูง');
    // คนจริงในฝูงเปลี่ยนเป้า → บอทเปลี่ยนตาม
    const mixed = makeRoom(6, 1, { gameMode: 'werewolf', werewolfRoles: ['werewolf'] }, ['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager']);
    E.autoResolvePhase(mixed); E.autoResolvePhase(mixed); E.autoResolvePhase(mixed);
    const [hw, bw] = mixed.gameState.players;
    bots.playBotTurns(mixed, { force: true, rng: mulberry32(3) });
    const villagers = mixed.gameState.players.filter(p => p.role === 'villager' && p.alive !== false);
    const humanPick = villagers.find(v => v.playerId !== mixed.gameState.nightActions.werewolfVotes[bw.playerId]) || villagers[0];
    E.submitNightAction(mixed, hw.playerId, humanPick.playerId);
    bots.playBotTurns(mixed, { force: true, rng: mulberry32(4) });
    assert(mixed.gameState.phase !== 'night' || mixed.gameState.nightActions.werewolfVotes[bw.playerId] === humanPick.playerId, 'บอทหมาป่าต้องตามเป้าของคนในฝูง');
    // จังหวะจริง: บอทไม่ลงมือทันทีที่เข้าเฟส
    Math.random = mulberry32(8);
    const timed = makeRoom(6, 1, { gameMode: 'werewolf', werewolfRoles: [] });
    const t0 = Date.now();
    bots.observe(timed, t0);
    assert(!bots.playBotTurns(timed, { now: t0 + 500 }).changed, 'บอทต้องคิดสักพักก่อนลงมือ');
    assert(bots.playBotTurns(timed, { now: t0 + 60000 }).changed, 'ผ่านไปนานพอบอทต้องลงมือ');
}

(function main() {
    const seeds = Number(process.env.SEEDS) || 12;
    targetedChecks();
    leakCheck();
    const sizes = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20];
    for (let seed = 1; seed <= seeds; seed += 1) {
        sizes.forEach(n => {
            playGame(seed, n, 'none');
            playGame(seed, n, 'random');
            if (seed % 2 === 0) playGame(seed, n, 'idle');
        });
    }
    // โต๊ะบทกำหนด: บทสกิลครบ + บทใหม่ 5 บท
    const fullCast = ['alphaWolf', 'werewolf', 'serialKiller', 'prince', 'lycan', 'diseased', 'apprenticeSeer', 'seer', 'oracle', 'doctor', 'bodyguard', 'witch', 'tracker', 'hunter', 'vigilante', 'cleric', 'mayor', 'revealer', 'fool', 'villager'];
    const newRoles = ['werewolf', 'serialKiller', 'prince', 'lycan', 'diseased', 'apprenticeSeer', 'seer', 'villager'];
    for (let seed = 1; seed <= seeds * 4; seed += 1) {
        const shuffled = [...fullCast].sort(() => mulberry32(seed)() - 0.5);
        playGame(1000 + seed, 20, seed % 3 === 0 ? 'random' : 'none', shuffled);
        playGame(2000 + seed, 8, seed % 3 === 0 ? 'idle' : 'none', [...newRoles].sort(() => mulberry32(seed + 5)() - 0.5));
        playGame(3000 + seed, 3, 'none', ['werewolf', seed % 2 ? 'seer' : 'witch', 'villager']);
    }
    Math.random = realRandom;
    const mustAct = ['wolf-kill', 'seer-check', 'oracle-read', 'doctor-save', 'bodyguard', 'witch-heal', 'witch-poison', 'tracker', 'vigilante', 'hunter', 'serial-kill', 'cleric', 'mayor', 'apprentice-check'];
    mustAct.forEach(role => assert((tally.roleActs[role] || 0) > 0, `บทนี้ไม่เคยลงมือเลยทั้งรอบเทส: ${role}`));
    assert(tally.chats > 0, 'บอทควรแชทบ้าง');
    console.log(`werewolf bots: ${tally.games} เกมจบครบ · ขนาด ${[...tally.sizes].sort((a, b) => a - b).join('/')} คน · เฉลี่ย ${(tally.days / tally.games).toFixed(1)} วัน (สูงสุด ${tally.maxDays})`);
    console.log(`  ผู้ชนะ ${JSON.stringify(tally.winners)} · รอนาฬิกา ${JSON.stringify(tally.timers)} · แชท ${tally.chats}`);
    console.log(`  บทที่ลงมือ ${JSON.stringify(tally.roleActs)}`);
    console.log(`✅ smoke:werewolf:bots:engine ผ่าน ${checks} checks`);
})();
