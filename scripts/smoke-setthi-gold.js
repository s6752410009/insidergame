/**
 * เศรษฐี 🪙 — เทสร้าน/เหรียญทอง (ไม่มีเซิร์ฟเวอร์)
 *  ตารางรางวัล · ให้ครั้งเดียวต่อ gameId · รีสตาร์ตแล้วไม่ได้ซ้ำ · เพดานรายวัน (เกมบอท/ทั้งหมด) · ข้ามวัน
 *  อัปเกรด: ตรวจสกิล/เลเวล/เหรียญ · กดรัว (sync + async พร้อมกัน) ได้ขั้นเดียว · ช่องติดตั้ง · เสกเหรียญ/ล้างสกิล
 *  รางวัลที่มาก่อนโหลดเสร็จ = รอคิว แล้วให้ทีเดียวหลัง init
 *
 * รัน: npm run smoke:setthi:gold   (ใช้ GAME_DATA_DIR ชั่วคราว ไม่แตะ data/ จริง)
 */
require('./isolateTestData');
const fs = require('fs');
const path = require('path');

let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
function eq(a, b, m) { assert(a === b, `${m}: ได้ ${JSON.stringify(a)} ต้องเป็น ${JSON.stringify(b)}`); }

const SK = require('../games/setthiSkills');
const MANAGER = require.resolve('../managers/setthiGoldManager');
function freshManager() {
    delete require.cache[MANAGER];
    return require('../managers/setthiGoldManager');
}

assert(require('../managers/dataPaths').DATA_DIR.includes('insider-smoke-data-'), 'ต้องใช้โฟลเดอร์ data ชั่วคราว');

// ---------- state จำลองของเกมที่จบแล้ว ----------
function seat(id, extra = {}) { return { playerId: id, name: id, left: false, bankrupt: false, landmarksBuilt: 0, takeovers: 0, ...extra }; }
function finished(seats, winners, winType, extra = {}) {
    return { phase: 'finished', seats, winners: winners.map(id => ({ playerId: id })), winType, endCause: winType === 'time' ? 'timeUp' : winType === 'bankrupt' ? 'bankrupt' : winType ? 'monopoly' : 'left', round: 8, debugUsed: false, ...extra };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('ตารางรางวัล: จบเกม 20 · ชนะเวลา 100 · ล้มละลาย 150 · แถว 200 · 3 สี 250 · ท่องเที่ยว 300 (+ จบเกม 20)', () => {
    const table = { time: 100, bankrupt: 150, line: 200, triple: 250, tourist: 300 };
    Object.entries(table).forEach(([wt, amount]) => {
        const r = SK.computeRewards(finished([seat('a'), seat('b')], ['a'], wt));
        eq(r.a.total, 20 + amount, `ชนะ ${wt}`);
        eq(r.b.total, 20, `แพ้ ${wt} ได้ค่าจบเกม`);
        eq(r.a.botGame, false, 'มีคนจริง 2 คน = เต็ม');
    });
});

test('โบนัสแลนด์มาร์ก/ซื้อต่อ +10 ต่อครั้ง เพดาน +100', () => {
    const r = SK.computeRewards(finished([seat('a', { landmarksBuilt: 2, takeovers: 1 }), seat('b', { landmarksBuilt: 9, takeovers: 9 })], ['a'], 'time'));
    eq(r.a.total, 20 + 100 + 30, 'a 3 ครั้ง');
    eq(r.b.total, 20 + 100, 'b เพดาน 100');
});

test('ออกกลางเกม = 0 · บอทไม่ได้ · เมนูทดสอบ = 0 · เกมสั้นกดจบ = 0 · ชนะเพราะคนอื่นออกหมด = แค่ค่าจบเกม', () => {
    const r = SK.computeRewards(finished([seat('a'), seat('b', { left: true }), seat('c'), seat('bot_x')], ['a'], 'line'));
    assert(!('b' in r), 'คนออกไม่มีรางวัล');
    assert(!('bot_x' in r), 'บอทไม่มีรางวัล');
    eq(r.c.total, 20, 'คนที่ล้มละลายแต่อยู่จนจบได้ 20');
    const dbg = SK.computeRewards(finished([seat('a'), seat('b')], ['a'], 'triple', { debugUsed: true }));
    eq(dbg.a.total, 0, 'debug ชนะ = 0');
    eq(dbg.a.reason, 'debug', 'บอกเหตุผล debug');
    const short = SK.computeRewards(finished([seat('a'), seat('b')], ['a'], 'time', { round: 2, endCause: 'hostEnd' }));
    eq(short.a.total, 0, 'กดจบก่อนรอบ 3 = 0');
    eq(short.a.reason, 'short', 'เหตุผล short');
    const fastWin = SK.computeRewards(finished([seat('a'), seat('b')], ['a'], 'tourist', { round: 2 }));
    eq(fastWin.a.total, 320, 'ผูกขาดเร็วยังได้');
    const left = SK.computeRewards(finished([seat('a'), seat('b', { left: true }), seat('c', { left: true })], ['a'], null));
    eq(left.a.total, 10, 'คนอื่นออกหมด: ค่าจบเกม (ครึ่งเพราะเหลือคนจริงคนเดียว)');
    eq(SK.computeRewards({ phase: 'roll', seats: [seat('a')] }).a, undefined, 'เกมยังไม่จบ = ไม่มีรางวัล');
});

test('เล่นกับบอท (ไม่มีคนจริงอื่นอยู่จนจบ) = ครึ่งเดียว', () => {
    const r = SK.computeRewards(finished([seat('a', { takeovers: 1 }), seat('bot_1'), seat('bot_2')], ['a'], 'bankrupt'));
    eq(r.a.total, Math.floor((20 + 150 + 10) / 2), 'ครึ่ง');
    eq(r.a.botGame, true, 'ตีตราเกมบอท');
    assert(r.a.parts.some(p => p.key === 'botGame' && p.amount < 0), 'มีบรรทัดหักครึ่ง');
});

test('สกิล: ค่า/ราคา/ติดตั้ง 3 ช่อง · โอกาสดับเบิลแปลงจาก % รวม', () => {
    eq(SK.SKILLS.length, 8, '8 สกิล');
    eq(SK.UPGRADE_COST.join(','), '100,250,500,900,1500', 'ราคา');
    eq(SK.upgradeCost(5), null, 'Lv5 เต็ม');
    SK.SKILLS.forEach(s => { eq(s.values.length, 6, s.id + ' มี 6 ค่า'); eq(s.values[0], 0, s.id + ' Lv0 = 0'); });
    eq(SK.procChance({ start2x: 5 }, 'start2x'), SK.valueOf('start2x', 5) / 100, 'start2x Lv5');
    eq(SK.procChance({}, 'start2x'), 0, 'ไม่มีสกิล = 0');
    eq(SK.procChance({ tollShield: 3 }, 'tollHalf'), SK.valueOf('tollShield', 3) / 100, 'key tollHalf → tollShield');
    assert(Math.abs(SK.procChance({ double: 5 }, 'double') * 5 / 6 - SK.valueOf('double', 5) / 100) < 1e-9, 'ดับเบิลแปลง');
    const snap = SK.snapshotLoadout({ double: 2, fly: 1, luck: 3, escape: 4 }, ['fly', 'fly', 'nope', 'escape', 'luck', 'double']);
    eq(JSON.stringify(snap), JSON.stringify({ fly: 1, escape: 4, luck: 3 }), 'snapshot 3 ช่องแรกที่มีเลเวล');
    eq(JSON.stringify(SK.snapshotLoadout({ fly: 0 }, ['fly'])), '{}', 'Lv0 ไม่ติด');
    eq(Object.keys(SK.sanitizeSkillMap({ a: 1, fly: 9, luck: 2, double: 1, escape: 1 })).length, 3, 'sanitize ไม่เกิน 3');
});

async function storeTests() {
    let G = freshManager();
    eq(G.isReady(), false, 'ยังไม่ init');
    eq(G.upgrade('player_a', 'double', 0).code, 'loading', 'ก่อน init อัปไม่ได้');
    const early = G.awardGame('boot_game', { player_a: { total: 70, botGame: false } });
    assert(early.player_a.pending, 'รางวัลก่อน init รอคิว');
    await G.initSetthiGoldManager();
    eq(G.publicProfile('player_a').gold, 70, 'init แล้วให้รางวัลที่ค้าง');
    eq(G.awardGame('boot_game', { player_a: { total: 70 } }).player_a.already, true, 'ค้างแล้วให้ซ้ำไม่ได้');
    checks += 1; console.log('✓ รางวัลก่อนโหลดเสร็จ รอคิวแล้วให้ครั้งเดียว');

    // ให้ครั้งเดียวต่อ gameId
    const r1 = G.awardGame('game_1', { player_a: { total: 120 }, player_b: { total: 20 }, bot_z: { total: 999 } });
    eq(r1.player_a.granted, 120, 'ได้ 120');
    assert(!r1.bot_z, 'บอทไม่ได้');
    const r2 = G.awardGame('game_1', { player_a: { total: 120 }, player_b: { total: 20 } });
    eq(r2.player_a.already, true, 'gameId เดิม = already');
    eq(G.publicProfile('player_a').gold, 190, 'ยอดไม่เพิ่มซ้ำ');
    eq(G.awardGame('game_x', { player_c: { total: -50 } }).player_c.granted, 0, 'ติดลบ = 0');
    eq(G.awardGame('game_y', { player_c: { total: '1e9' } }).player_c.granted, 3000, 'ใหญ่เกิน = โดนหนีบ (เพดานรายวัน)');
    checks += 1; console.log('✓ ให้ครั้งเดียวต่อ gameId · บอท/ติดลบ/ค่ามั่ว ไม่ได้');

    // รีสตาร์ต
    await G.persistNow();
    assert(fs.existsSync(G.GOLD_FILE), 'มีไฟล์');
    assert(G.GOLD_FILE.startsWith(process.env.GAME_DATA_DIR), 'ไฟล์อยู่ใน GAME_DATA_DIR');
    G = freshManager();
    await G.initSetthiGoldManager();
    eq(G.publicProfile('player_a').gold, 190, 'รีสตาร์ตยอดยังอยู่');
    eq(G.awardGame('game_1', { player_a: { total: 120 } }).player_a.already, true, 'รีสตาร์ตแล้ว finalize ซ้ำไม่ได้เพิ่ม');
    eq(G.publicProfile('player_a').gold, 190, 'ยอดเท่าเดิม');
    checks += 1; console.log('✓ รีสตาร์ตแล้วไม่ได้ซ้ำ');

    // เพดานรายวัน
    const day1 = new Date('2026-10-07T05:00:00Z');
    let got = 0;
    for (let k = 0; k < 10; k += 1) got += G.awardGame('bot_game_' + k, { player_d: { total: 100, botGame: true } }, { now: day1 }).player_d.granted;
    eq(got, G.BOT_DAILY_CAP, 'เกมบอทได้ไม่เกิน 600/วัน');
    const capped = G.awardGame('bot_game_more', { player_d: { total: 100, botGame: true } }, { now: day1 }).player_d;
    eq(capped.granted, 0, 'เต็มเพดานแล้วได้ 0');
    eq(capped.capped, true, 'บอกว่าโดนเพดาน');
    eq(G.awardGame('human_game', { player_d: { total: 220 } }, { now: day1 }).player_d.granted, 220, 'เกมกับคนจริงยังได้');
    const day2 = new Date('2026-10-08T05:00:00Z');
    eq(G.awardGame('bot_game_d2', { player_d: { total: 100, botGame: true } }, { now: day2 }).player_d.granted, 100, 'ข้ามวัน (เวลาไทย) เริ่มนับใหม่');
    let all = 0;
    for (let k = 0; k < 20; k += 1) all += G.awardGame('h_' + k, { player_e: { total: 320 } }, { now: day1 }).player_e.granted;
    eq(all, G.DAILY_CAP, 'ทุกเกมรวมไม่เกินเพดานรายวัน');
    checks += 1; console.log('✓ เพดานรายวัน (เกมบอท 600 · รวม 3000) และข้ามวัน');

    // อัปเกรด
    eq(G.upgrade('player_n', 'double', 0).code, 'gold', 'ไม่มีเหรียญ อัปไม่ได้');
    G.debugGrant('player_n', 5000, 'admin');
    eq(G.upgrade('player_n', 'nope', 0).code, 'skill', 'สกิลมั่ว');
    eq(G.upgrade('player_n', '__proto__', 0).code, 'skill', 'proto');
    eq(G.upgrade('player_n', 'double', 1).code, 'stale', 'เลเวลไม่ตรง');
    eq(G.upgrade('player_n', 'double', '0x').code, 'expect', 'expect มั่ว');
    eq(G.upgrade('player_n', 'double', null).code, 'expect', 'ไม่มี expect');
    eq(G.upgrade('bot_1', 'double', 0).code, 'player', 'บอทอัปไม่ได้');
    const u1 = G.upgrade('player_n', 'double', 0);
    assert(u1.ok && u1.cost === 100 && u1.level === 1, 'อัป Lv1 ราคา 100');
    eq(u1.profile.gold, 4900, 'หัก 100');
    eq(u1.profile.loadout.join(','), 'double', 'สกิลแรกใส่ช่องให้อัตโนมัติ');
    // กดรัว sync: expectLv เดิมสองครั้ง → ได้ขั้นเดียว
    const a = G.upgrade('player_n', 'double', 1);
    const b = G.upgrade('player_n', 'double', 1);
    assert(a.ok && !b.ok && b.code === 'stale', 'กดซ้ำได้ขั้นเดียว');
    eq(G.publicProfile('player_n').skills.double, 2, 'Lv2');
    eq(G.publicProfile('player_n').gold, 4900 - 250, 'หักครั้งเดียว');
    // กดพร้อมกันหลายคำขอ (async) — แบบ HTTP สองแท็บ
    const burst = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => G.upgrade('player_n', 'double', 2))));
    eq(burst.filter(x => x.ok).length, 1, '8 คำขอพร้อมกัน ผ่าน 1');
    eq(G.publicProfile('player_n').gold, 4900 - 250 - 500, 'หัก 500 ครั้งเดียว');
    G.upgrade('player_n', 'double', 3);
    G.upgrade('player_n', 'double', 4);
    eq(G.publicProfile('player_n').skills.double, 5, 'ถึง Lv5');
    eq(G.upgrade('player_n', 'double', 5).code, 'max', 'Lv5 อัปต่อไม่ได้');
    eq(G.publicProfile('player_n').gold, 5000 - 3250, 'รวม 3250 ต่อสกิล');
    eq(G.upgrade('player_n', 'fly', 0).ok, true, 'fly Lv1');
    eq(G.upgrade('player_n', 'luck', 0).ok, true, 'luck Lv1');
    eq(G.upgrade('player_n', 'escape', 0).ok, true, 'escape Lv1');
    eq(G.publicProfile('player_n').loadout.join(','), 'double,fly,luck', 'ช่องเต็ม 3 ไม่ใส่เพิ่ม');
    checks += 1; console.log('✓ อัปเกรด: ตรวจครบ · กดรัว/พร้อมกันได้ขั้นเดียว · ราคา 100/250/500/900/1500');

    // ช่องติดตั้ง
    eq(G.setLoadout('player_n', ['double', 'fly', 'luck', 'escape']).code, 'loadout', 'เกิน 3 ไม่ได้');
    eq(G.setLoadout('player_n', ['double', 'double']).code, 'dup', 'ซ้ำไม่ได้');
    eq(G.setLoadout('player_n', ['builder']).code, 'locked', 'ยังไม่มีเลเวล ใส่ไม่ได้');
    eq(G.setLoadout('player_n', 'double').code, 'loadout', 'ไม่ใช่ array');
    eq(G.setLoadout('player_n', [{}]).code, 'skill', 'ค่ามั่ว');
    eq(G.setLoadout('player_n', ['escape', 'double']).ok, true, 'ตั้งได้');
    eq(JSON.stringify(G.equippedSkills('player_n')), JSON.stringify({ escape: 1, double: 5 }), 'สกิลเข้าเกม = ช่องที่ติดตั้ง');
    eq(G.setLoadout('player_n', []).ok, true, 'ถอดหมดได้');
    eq(JSON.stringify(G.equippedSkills('player_n')), '{}', 'ไม่ติดตั้ง = ไม่มีสกิล');
    eq(JSON.stringify(G.equippedSkills('nobody_here')), '{}', 'คนไม่มีแถว = ไม่มีสกิล');
    checks += 1; console.log('✓ ช่องติดตั้ง 3 ช่อง ตรวจครบ');

    // เสกเหรียญ / ล้างสกิล
    eq(G.debugGrant('player_n', 0).code, 'amount', 'เสก 0 ไม่ได้');
    eq(G.debugGrant('player_n', 1.5).code, 'amount', 'เสกทศนิยมไม่ได้');
    eq(G.debugGrant('player_n', G.DEBUG_GRANT_MAX + 1).code, 'amount', 'เสกเกินไม่ได้');
    const before = G.publicProfile('player_n').gold;
    const reset = G.resetSkills('player_n', 'admin');
    eq(reset.refund, 3250 + 300, 'คืนเหรียญที่ใช้อัปทั้งหมด');
    eq(reset.profile.gold, before + 3550, 'ยอดคืน');
    eq(Object.keys(reset.profile.skills).length, 0, 'ล้างสกิล');
    assert(reset.profile.history.some(h => h.reason === 'debug-reset') && reset.profile.history.some(h => h.reason === 'debug-grant'), 'ลงประวัติ');
    checks += 1; console.log('✓ เสกเหรียญ/ล้างสกิล ตรวจจำนวน ลงประวัติ');

    // ไฟล์พัง → ใช้ไฟล์สำรอง · พังทั้งคู่ = ไม่เซฟทับ
    await G.persistNow();
    await G.persistNow();
    fs.writeFileSync(G.GOLD_FILE, '{broken');
    G = freshManager();
    await G.initSetthiGoldManager();
    assert(G.publicProfile('player_a').gold === 190, 'ไฟล์หลักพัง ใช้ไฟล์สำรอง');
    fs.writeFileSync(G.GOLD_FILE, '{broken');
    fs.writeFileSync(G.GOLD_FILE + '.bak', '{broken');
    G = freshManager();
    await G.initSetthiGoldManager();
    G.debugGrant('player_q', 10);
    await G.persistNow();
    eq(fs.readFileSync(G.GOLD_FILE, 'utf8'), '{broken', 'พังทั้งคู่ = ไม่เขียนทับ');
    checks += 1; console.log('✓ ไฟล์พัง: ใช้สำรอง · พังหมดไม่เซฟทับ');
}

(async () => {
    const started = Date.now();
    for (const t of tests) {
        try { t.fn(); } catch (error) { console.error('✗', t.name, '\n ', error.message); process.exit(1); }
        console.log('✓', t.name);
    }
    try { await storeTests(); } catch (error) { console.error('✗ store\n ', error.stack || error.message); process.exit(1); }
    console.log(`setthi gold: ${checks} checks ผ่านทั้งหมด (${((Date.now() - started) / 1000).toFixed(1)}s) · data ${path.basename(process.env.GAME_DATA_DIR)}`);
    process.exit(0);
})();
