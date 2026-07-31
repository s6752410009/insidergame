#!/usr/bin/env node
/**
 * ปิด season ปัจจุบัน → เก็บอันดับเป็นประวัติ → รีเซ็ตสถิติทุกคนเพื่อเริ่ม season ใหม่
 *
 *   node scripts/reset-season.js            # dry run (ดูอย่างเดียว ไม่แก้ข้อมูล)
 *   node scripts/reset-season.js --confirm  # ทำจริง
 *
 * ทำงานอย่างเดียวกับปุ่ม "ปิด Season / รีแรงค์" ในหน้า admin
 * (ทั้งคู่เรียก seasonManager.runSeasonReset)
 *
 * หมายเหตุ: ต้องรันบนเครื่องที่เก็บข้อมูลจริง — ประวัติ season เขียนลง
 * data/seasons.json ของเครื่องที่รัน ไม่ได้อยู่ใน MongoDB
 */

const statsManager = require('../managers/statsManager');
const seasonManager = require('../managers/seasonManager');

const confirmed = process.argv.includes('--confirm');

async function main() {
    await statsManager.initStatsManager();

    const preview = seasonManager.getSeasonResetPreview();
    const entries = statsManager.getLeaderboard();

    console.log(`\n🏆 ${preview.season.name} (season #${preview.season.number})`);
    console.log(`   ผู้เล่นที่มีสถิติ : ${preview.totalPlayers} คน`);
    console.log(`   ติดอันดับ        : ${preview.rankedCount} คน (เล่นอย่างน้อย 1 เกม)`);
    console.log(`   เกมสะสมรวม       : ${preview.totalGames}`);

    if (entries.length === 0) {
        console.log('\n⚠️  ยังไม่มีใครติดอันดับ — ไม่มีอะไรให้เก็บเป็นประวัติ');
        return;
    }

    console.log('\n   Top 10:');
    entries.slice(0, 10).forEach(entry => {
        console.log(
            `   ${String(entry.rank).padStart(3)}. ${entry.playerName.padEnd(20)} ` +
            `${String(entry.wins).padStart(4)} ชนะ · ${entry.totalGames} เกม · ${entry.winRate}%`
        );
    });

    if (!confirmed) {
        console.log('\n👀 dry run — ยังไม่ได้แก้อะไร');
        console.log('   สั่ง `npm run season:reset -- --confirm` เพื่อทำจริง\n');
        return;
    }

    const result = await seasonManager.runSeasonReset({
        // --force = ยอมรีเซ็ตแม้เขียนไฟล์สำรองไม่ได้
        allowWithoutBackup: process.argv.includes('--force')
    });

    if (result.backupFile) {
        console.log(`\n💾 สำรองสถิติดิบไว้ที่ ${result.backupFile}`);
    } else {
        console.log('\n⚠️  ไม่ได้สำรองไฟล์ดิบ (ข้ามด้วย --force) — roleStats/gameHistory กู้ไม่ได้');
    }

    console.log(`📚 เก็บอันดับ ${result.archived.entries.length} คนไว้เป็น "${result.archived.name}"`);
    console.log(`🔄 รีเซ็ตสถิติ ${result.resetCount} คน`);
    console.log(`\n✅ เริ่ม ${result.current.name} แล้ว (เริ่ม ${result.current.startedAt})\n`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ reset-season ล้มเหลว:', error.message);
        process.exit(1);
    });
