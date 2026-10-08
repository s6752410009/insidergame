/**
 * บอทหมาป่าระดับ engine — สุ่มเล่นจนจบหลาย seed · 3–20 คน · ทุกบท (รวม 5 บทใหม่)
 *
 *  A) บอทล้วน: กลางคืน/ช่วงประชุมต้องจบเองโดยไม่ต้องรอหมดเวลา (บอทกดพร้อม/ใช้สกิล/ข้ามครบ)
 *  B) คน 1 + บอท: คนกดสุ่มทุกอย่างที่กติกาให้
 *  C) คน 1 + บอท: คนไม่กดอะไรเลย (นาฬิกาเดินแทน)
 *  D) โต๊ะบทกำหนดเอง: บทใหม่ทั้ง 5 + บทสกิลครบ เพื่อให้ทุกบทได้ลงมือจริง
 * ทุกเกม: ไม่มี exception · ไม่ค้าง (จบภายใน 60 วัน) · ผู้ชนะถูกต้อง · คืนแรกหมาป่า/ฆาตกรไม่ลงมือ
 * · หมาป่าไม่กัดหมาป่า · โหวตหมาป่าได้แค่ตอนทิ้งเพื่อนที่โดนไล่แน่แล้ว (นานๆ ครั้ง) · บอทที่ตายแล้วไม่ทำอะไร ไม่แชท · แชทมาจากชุดแม่แบบ (≤ 2 ประโยค/คน/วัน)
 *   ท่าทีคนบ้ามาจากคนบ้าเท่านั้น · หมาป่าไม่เคยหลุดว่าตัวเองเป็นหมาป่า
 * · state ที่ส่งให้คนไม่มีความจำของบอท
 *  E) ความฉลาด: ไม่โหวตคนที่ดูเป็นคนบ้า · เชื่อผลตรวจที่น่าเชื่อ · จับคนอ้างผู้หยั่งรู้ปลอม · เปลี่ยนโหวตตามข้อมูลใหม่
 *     · ศาลเตี้ย/พรานยิงเมื่อมีหลักฐาน · คนบ้าบอทมีท่าทีแบบเนียนๆ
 *  F) เทสปิดตา: สลับบทของคนที่ยังไม่เปิดบท → การตัดสินใจของบอทต้องเหมือนเดิม (ไม่แอบดูบทคนอื่น)
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

const tally = { wolfDayVotes: 0, buses: 0, games: 0, days: 0, winners: {}, timers: { night: 0, 'day-discussion': 0, 'day-vote': 0 }, chats: 0, chatKinds: {}, roleActs: {}, maxDays: 0, sizes: new Set() };

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
    // หมาป่าบอทโหวตกลางวัน: โหวตหมาป่าได้แค่ตอน "ทิ้งเพื่อน" ที่รอดไม่ได้แล้วจากหลักฐานสาธารณะ
    //   (เสียงคนนอกฝูงพอไล่อยู่แล้ว เผื่อ 1 เสียงที่เปลี่ยนใจในจังหวะเดียวกัน · หรือโดนจอมเปิดโปงชี้แล้ว)
    if (s.phase === 'day-vote') {
        const alive = s.players.filter(p => p.alive !== false);
        const total = alive.reduce((sum, p) => sum + (p.mayorRevealed ? 2 : 1), 0);
        const threshold = Math.floor(total / 2) + 1;
        Object.entries(s.dayVotes || {}).forEach(([voterId, targetId]) => {
            const voter = s.players.find(p => p.playerId === voterId);
            const target = s.players.find(p => p.playerId === targetId);
            if (!bots.isBotId(voterId) || !voter || !isWolfRole(voter.role) || !target) return;
            const tag = `vote:${s.dayNumber}:${voterId}:${targetId}`;
            if (seen.has(tag)) return;
            seen.add(tag);
            tally.wolfDayVotes += 1;
            if (!isWolfRole(target.role)) return;
            tally.buses += 1;
            const outside = Object.entries(s.dayVotes).filter(([v, t]) => t === targetId && !isWolfRole(s.players.find(p => p.playerId === v)?.role))
                .reduce((sum, [v]) => sum + (s.players.find(p => p.playerId === v)?.mayorRevealed ? 2 : 1), 0);
            const exposed = s.botBrain?.known?.[targetId] && isWolfRole(s.botBrain.known[targetId]);
            assert(exposed || outside >= threshold - 1, `หมาป่าบอทโหวตเพื่อนทั้งที่เพื่อนยังไม่โดนไล่แน่ (คนนอกฝูง ${outside}/${threshold})`);
        });
    }
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
    const chatCount = {};
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
            assert(bots.isBotChatLine(chat.text), `${label}: บอทแชทประโยคนอกชุดแม่แบบ: ${chat.text}`);
            // ท่าทีคนบ้าเป็นของคนบ้าเท่านั้น · หมาป่าไม่เคยพูดว่าตัวเองเป็นหมาป่า
            if (/^fool(Subtle|Beg|Wolf)$/.test(chat.kind || '')) assert(speaker.role === 'fool', `${label}: ${speaker.role} พูดประโยคของคนบ้า`);
            if (isWolfRole(speaker.role)) assert(!/หมาป่าก็ได้|เป็นหมาป่า/.test(chat.text), `${label}: หมาป่าบอทหลุดว่าตัวเองเป็นหมาป่า`);
            const perBot = `${room.gameState.dayNumber}:${chat.playerId}`;
            chatCount[perBot] = (chatCount[perBot] || 0) + 1;
            assert(chatCount[perBot] <= 2, `${label}: บอทพูดเกิน 2 ประโยคต่อวัน (สแปม)`);
            tally.chatKinds[chat.kind] = (tally.chatKinds[chat.kind] || 0) + 1;
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
    // หมาป่าบอทไม่ให้คะแนนเพื่อนหมาป่า (เว้นแต่เพื่อนรอดไม่ได้แล้ว — ดู busCheck)
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

/** ตั้งโต๊ะบทกำหนด แล้วพาไปถึงกลางวันของวันที่ day (ไม่มีใครตาย) */
function dayRoom(roles, humans = 0, phase = 'day-vote', day = 2) {
    Math.random = mulberry32(roles.length * 17 + humans);
    const room = makeRoom(roles.length, humans, { gameMode: 'werewolf', werewolfRoles: [...new Set(roles.filter(r => r !== 'villager'))] }, roles);
    room.gameState.phase = phase;
    room.gameState.dayNumber = day;
    room.gameState.dayVotes = {};
    room.gameState.discussionSkips = {};
    bots.observe(room, 1);
    return room;
}

function smartChecks() {
    // 1) คนบ้า: คนที่ขอให้โหวต/อ้างว่าเป็นหมาป่า (แชทคนจริง) + โดนรุมเมื่อวาน → ชาวบ้านไม่โหวต
    {
        const roles = ['fool', 'werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'doctor', 'villager'];
        const room = dayRoom(roles, 1, 'day-discussion');
        const [fool] = room.gameState.players;
        bots.noteChat(room, fool.playerId, 'โหวตผมเลย ผมเป็นหมาป่าเอง 555');
        bots.noteChat(room, 'h1', 'ผมไม่ได้เป็นหมาป่านะ'); // ไม่ใช่ท่าที (ตรวจว่าไม่นับมั่ว) — h1 คือคนบ้าเองด้วย ไม่เพิ่มอะไร
        room.gameState.botBrain.votes['1'] = Object.fromEntries(room.gameState.players.slice(1, 6).map(p => [p.playerId, fool.playerId]));
        room.gameState.phase = 'day-vote';
        const villagers = room.gameState.players.filter(p => p.role === 'villager' || p.role === 'doctor');
        villagers.forEach(v => {
            const view = bots.assess(room, v).map.get(fool.playerId);
            assert(view.F > 0.5, `ชาวบ้านต้องสงสัยว่าคนที่ขอให้โหวตคือคนบ้า (F=${view.F.toFixed(2)})`);
            assert(bots.chooseVote(room, v).target !== fool.playerId, 'ชาวบ้านบอทต้องไม่โหวตคนที่ดูเป็นคนบ้า');
        });
        const wolf = room.gameState.players[1];
        assert(bots.chooseVote(room, wolf).target !== fool.playerId, 'หมาป่าบอทก็ไม่อยากให้คนบ้าชนะ');
    }
    // 2) ผู้หยั่งรู้ (น่าเชื่อ) บอกว่า "ดี" → คนที่โดนรุมไม่ถูกโหวต · ผู้หยั่งรู้บอก "ไม่ดี" → ทุกคนโหวตตาม
    {
        const roles = ['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'doctor', 'villager'];
        const room = dayRoom(roles);
        const [w1, , seer, suspect] = room.gameState.players;
        const brain = room.gameState.botBrain;
        brain.votes['1'] = Object.fromEntries(room.gameState.players.filter(p => p !== suspect).slice(0, 5).map(p => [p.playerId, suspect.playerId]));
        seer.seerHistory = [{ dayNumber: 1, targetPlayerId: suspect.playerId, resultCode: 'good' }, { dayNumber: 2, targetPlayerId: w1.playerId, resultCode: 'bad' }];
        room.gameState.phase = 'day-discussion';
        const said = bots.decideChat(room, seer, 0);
        assert(said && said.kind === 'claim' && said.claim.results[w1.playerId] === 'bad', 'ผู้หยั่งรู้บอทเจอหมาป่าต้องเปิดผล: ' + JSON.stringify(said));
        assert(bots.isBotChatLine(said.text) && said.text.includes(w1.name), 'ประโยคเปิดผลต้องอยู่ในแม่แบบและมีชื่อเป้า');
        brain.claims[seer.playerId] = { role: 'seer', day: 2, seq: 1, results: { ...said.claim.results } };
        room.gameState.phase = 'day-vote';
        room.gameState.players.filter(p => ['villager', 'doctor'].includes(p.role) && p !== suspect).forEach(v => {
            const choice = bots.chooseVote(room, v);
            assert(choice.target === w1.playerId, `ชาวบ้านต้องโหวตคนที่ผู้หยั่งรู้บอกว่าไม่ดี (ได้ ${choice.target})`);
            assert(choice.target !== suspect.playerId, 'คนที่ผู้หยั่งรู้บอกว่าดีต้องไม่ถูกโหวต');
        });
    }
    // 3) อ้างผู้หยั่งรู้ชนกัน: คนที่โดนหมาป่ากัดตายคือตัวจริง → อีกคนโกหก โดนโหวต
    {
        const roles = ['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'doctor', 'villager', 'villager'];
        const room = dayRoom(roles, 0, 'day-vote', 3);
        const [w1, w2, seer, c] = room.gameState.players;
        const brain = room.gameState.botBrain;
        brain.claims[seer.playerId] = { role: 'seer', day: 2, seq: 1, results: { [w1.playerId]: 'bad' } };
        brain.claims[w2.playerId] = { role: 'seer', day: 2, seq: 2, results: { [c.playerId]: 'bad' } };
        seer.alive = false;
        brain.deaths[seer.playerId] = { day: 3, cause: 'wolf-attack' };
        room.gameState.players.filter(p => p.role === 'villager' && p !== c).forEach(v => {
            const A = bots.assess(room, v);
            assert(A.kappa[w2.playerId] <= 0.1, 'คนอ้างผู้หยั่งรู้ที่ยังรอด (อีกคนโดนกัดตาย) ต้องหมดความน่าเชื่อ');
            const pick = bots.chooseVote(room, v).target;
            assert(pick === w1.playerId || pick === w2.playerId, `ต้องโหวตหมาป่า (ได้ ${pick})`);
        });
    }
    // 4) เปลี่ยนโหวตเมื่อวงโหวตไปทางอื่นที่สมเหตุผล (ไม่ยึดโหวตแรกตลอด) และไม่สลับไปมา
    {
        const roles = ['werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];
        const room = makeRoom(roles.length, roles.length - 1, { gameMode: 'werewolf', werewolfRoles: ['werewolf'] }, roles.slice().reverse());
        const bot = room.gameState.players.find(p => bots.isBotId(p.playerId));
        room.gameState.phase = 'day-vote';
        room.gameState.dayNumber = 2;
        room.gameState.dayVotes = {};
        bots.observe(room, 1);
        bots.playBotTurns(room, { force: true, rng: mulberry32(9), now: 5 });
        const first = room.gameState.dayVotes[bot.playerId];
        assert(first, 'บอทต้องโหวตก่อน');
        const z = room.gameState.players.find(p => p.playerId !== bot.playerId && p.playerId !== first && !bots.isBotId(p.playerId));
        room.gameState.players.filter(p => !bots.isBotId(p.playerId) && p !== z).slice(0, 5).forEach(p => {
            room.gameState.dayVotes[p.playerId] = z.playerId;
        });
        room.gameState.lastAction = 12345;
        bots.playBotTurns(room, { force: true, rng: mulberry32(10), now: 6 });
        assert(room.gameState.dayVotes[bot.playerId] === z.playerId, `บอทต้องเปลี่ยนไปโหวตตามวงที่เข้าท่า (${first} → ${room.gameState.dayVotes[bot.playerId]})`);
        bots.playBotTurns(room, { force: true, rng: mulberry32(11), now: 7 });
        assert(room.gameState.dayVotes[bot.playerId] === z.playerId, 'ไม่มีข้อมูลใหม่ บอทต้องไม่เปลี่ยนกลับไปมา');
    }
    // 5) คนบ้าบอท: ไม่อ้างบท มีท่าทีชวนสงสัยบ้าง (เนียนๆ)
    {
        const roles = ['fool', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'doctor'];
        const room = dayRoom(roles, 0, 'day-discussion', 1);
        const fool = room.gameState.players[0];
        const kinds = [];
        for (let d = 1; d <= 12; d += 1) {
            room.gameState.dayNumber = d;
            [0, 1].forEach(slot => { const said = bots.decideChat(room, fool, slot); if (said) kinds.push(said.kind); });
        }
        assert(kinds.some(k => /^fool(Subtle|Beg|Wolf)$/.test(k)), 'คนบ้าบอทต้องมีท่าทีชวนสงสัยบ้าง: ' + kinds);
        assert(!kinds.includes('claim') && !kinds.includes('defend'), 'คนบ้าบอทต้องไม่อ้างบท');
        assert(kinds.filter(k => /^fool(Subtle|Beg|Wolf)$/.test(k)).length <= 9, 'คนบ้าบอทต้องไม่โจ่งแจ้งทุกวัน');
    }
    // 6) ศาลเตี้ย/พราน: ยิงคนที่ผู้หยั่งรู้ (น่าเชื่อ) บอกว่าไม่ดี ไม่ยิงมั่ว
    {
        const roles = ['werewolf', 'werewolf', 'seer', 'vigilante', 'villager', 'villager', 'villager', 'hunter'];
        const room = dayRoom(roles, 0, 'night', 3);
        room.gameState.nightActions = {};
        const [w1, , seer, vig] = room.gameState.players;
        const hunter = room.gameState.players[7];
        const noInfo = bots.planNight(room, vig, mulberry32(1));
        assert(noInfo.every(step => step.target === SKIP), 'ไม่มีหลักฐาน ศาลเตี้ยต้องไม่ยิง');
        room.gameState.botBrain.claims[seer.playerId] = { role: 'seer', day: 2, seq: 1, results: { [w1.playerId]: 'bad' } };
        assert(bots.planNight(room, vig, mulberry32(2))[0].target === w1.playerId, 'ศาลเตี้ยต้องยิงคนที่ผู้หยั่งรู้บอกว่าไม่ดี');
        assert(bots.planNight(room, hunter, mulberry32(3))[0].target === w1.playerId, 'พรานต้องยิงคนที่ผู้หยั่งรู้บอกว่าไม่ดี');
    }
}

/** ทิ้งเพื่อน (bus): ทำเฉพาะเมื่อเพื่อนรอดไม่ได้แล้ว · เพื่อนแค่โดนสงสัยยังไม่ทิ้ง */
function busCheck() {
    const roles = ['werewolf', 'werewolf', 'werewolf', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager'];
    const setup = outsideVotes => {
        const room = dayRoom(roles, 0, 'day-vote', 2);
        const [, mate] = room.gameState.players;
        const villagers = room.gameState.players.filter(p => p.role === 'villager');
        room.gameState.dayVotes = Object.fromEntries(villagers.slice(0, outsideVotes).map(p => [p.playerId, mate.playerId]));
        return { room, mate, wolves: room.gameState.players.filter(p => p.role === 'werewolf' && p !== mate) };
    };
    // เสียงคนนอกฝูง 3/6 — ยังไม่พอไล่ หมาป่าต้องไม่ทิ้งเพื่อน
    {
        const { room, mate, wolves } = setup(3);
        wolves.forEach(w => assert(bots.chooseVote(room, w).target !== mate.playerId, 'เพื่อนแค่โดนสงสัย หมาป่าต้องไม่โหวตทิ้ง'));
        wolves.forEach(w => assert(bots.voteScore(room, w, mate) === null, 'เพื่อนยังรอดได้ ต้องไม่ให้คะแนนเพื่อน'));
    }
    // เสียงคนนอกฝูง 7/6 (ครบเกณฑ์ไล่อยู่แล้ว) — ทิ้งได้ (ไม่จำเป็นต้องทุกตัว)
    let busedSomewhere = false;
    for (let seed = 0; seed < 6 && !busedSomewhere; seed += 1) {
        const { room, mate, wolves } = setup(7);
        room.roomId = `bus-${seed}`;
        room.gameState.dayNumber = 2 + seed;
        busedSomewhere = wolves.some(w => bots.chooseVote(room, w).target === mate.playerId);
    }
    assert(busedSomewhere, 'เพื่อนโดนไล่แน่แล้ว หมาป่าควรโหวตร่วมบ้าง (ทิ้งเพื่อนให้ตัวเองดูเป็นชาวบ้าน)');
}

/** บอทต้องไม่แอบดูบทคนอื่น: สลับบทของคนที่ยังไม่เปิดบท แล้วการตัดสินใจต้องเหมือนเดิม */
function blindfoldCheck(seeds) {
    let compared = 0;
    for (let seed = 1; seed <= seeds; seed += 1) {
        Math.random = mulberry32(seed * 101);
        const rng = mulberry32(seed);
        const n = 8 + (seed % 7);
        const room = makeRoom(n, 0, randomSettings(rng));
        for (let step = 0; step < 400 && !room.gameState.winner; step += 1) {
            const s = room.gameState;
            if (['night', 'day-discussion', 'day-vote'].includes(s.phase) && step % 3 === 0) {
                const alive = s.players.filter(p => p.alive !== false && bots.isBotId(p.playerId));
                const bot = alive[step % alive.length];
                const decide = () => JSON.stringify({
                    vote: s.phase === 'day-vote' ? bots.chooseVote(room, bot).target : null,
                    chat: s.phase === 'day-discussion' ? [0, 1].map(slot => (bots.decideChat(room, bot, slot) || {}).text || null) : null,
                    night: s.phase === 'night' && bot.role !== 'witch' ? bots.planNight(room, bot, mulberry32(step)) : null
                });
                const before = decide();
                const hidden = s.players.filter(p => p !== bot && p.alive !== false && !p.mayorRevealed && !p.princeRevealed
                    && !(isWolfRole(bot.role) && isWolfRole(p.role)));
                const saved = hidden.map(p => [p.role, p.roleInfo]);
                hidden.forEach((p, i) => {
                    const [role, info] = saved[(i + 1) % saved.length];
                    p.role = role;
                    p.roleInfo = info;
                });
                // หมาป่ารู้จักเพื่อน: ถ้าสลับแล้วมีหมาป่าใหม่โผล่ในกลุ่มที่สลับ ข้าม (ข้อมูลที่หมาป่าเห็นเปลี่ยนจริง)
                const wolfViewChanged = isWolfRole(bot.role) && hidden.some((p, i) => isWolfRole(p.role) !== isWolfRole(saved[i][0]));
                const after = decide();
                hidden.forEach((p, i) => { p.role = saved[i][0]; p.roleInfo = saved[i][1]; });
                if (!wolfViewChanged && hidden.length > 1) {
                    assert(before === after, `seed ${seed}: บอท ${bot.role} ตัดสินใจเปลี่ยนเมื่อบทคนอื่น (ที่มองไม่เห็น) ถูกสลับ\n${before}\n${after}`);
                    compared += 1;
                }
            }
            if (!bots.playBotTurns(room, { force: true, rng, now: 1e6 + step * 1000 }).changed) E.autoResolvePhase(room);
        }
    }
    return compared;
}

(function main() {
    const seeds = Number(process.env.SEEDS) || 12;
    targetedChecks();
    smartChecks();
    busCheck();
    leakCheck();
    const blindCompared = blindfoldCheck(Number(process.env.BLIND_SEEDS) || 30);
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
    console.log(`  ประโยคบอท ${JSON.stringify(tally.chatKinds)}`);
    console.log(`  เทสปิดตา (สลับบทคนอื่น) ${blindCompared} จุด`);
    // ทิ้งเพื่อนต้องเป็นเรื่องนานๆ ครั้ง ไม่ใช่นิสัย
    assert(tally.buses <= tally.wolfDayVotes * 0.08, `หมาป่าบอททิ้งเพื่อนบ่อยเกินไป (${tally.buses}/${tally.wolfDayVotes})`);
    console.log(`  หมาป่าทิ้งเพื่อน ${tally.buses} ครั้ง จากโหวตกลางวันของหมาป่า ${tally.wolfDayVotes} ครั้ง`);
    console.log(`✅ smoke:werewolf:bots:engine ผ่าน ${checks} checks`);
})();
