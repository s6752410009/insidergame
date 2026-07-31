#!/usr/bin/env node
/**
 * ปิด season ปัจจุบัน → เก็บอันดับเป็นประวัติ → รีเซ็ตสถิติทุกคนเพื่อเริ่ม season ใหม่
 *
 *   node scripts/reset-season.js            # dry run (ดูอย่างเดียว ไม่แก้ข้อมูล)
 *   node scripts/reset-season.js --confirm  # ทำจริง
 *
 * ทำจริงจะ:
 *   1. สำรอง data/playerStats.json ไว้ที่ data/backups/playerStats-season-<n>.json
 *   2. เก็บตารางอันดับทั้งหมดลง data/seasons.json เป็น season ที่ปิดแล้ว
 *   3. ล้าง totalGames/wins/losses/roleStats/winByRole/modeStats/gameHistory ของทุกคนเป็น 0
 */

const fs = require('fs');
const path = require('path');

const statsManager = require('../managers/statsManager');
const seasonManager = require('../managers/seasonManager');

const ROOT_DIR = path.join(__dirname, '..');
const STATS_FILE = path.join(ROOT_DIR, 'data/playerStats.json');
const PLAYERS_FILE = path.join(ROOT_DIR, 'data/players.json');
const BACKUP_DIR = path.join(ROOT_DIR, 'data/backups');

const confirmed = process.argv.includes('--confirm');

/**
 * หาเวลาเริ่ม season ย้อนหลัง ถ้า seasons.json ยังไม่เคยบันทึกไว้
 * ใช้ createdAt ที่เก่าที่สุดใน players.json
 */
function guessSeasonStartedAt() {
    if (!fs.existsSync(PLAYERS_FILE)) {
        return null;
    }

    try {
        const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
        let earliest = null;

        for (const player of Object.values(players || {})) {
            const createdAt = player && player.createdAt ? new Date(player.createdAt) : null;
            if (createdAt && !Number.isNaN(createdAt.getTime())) {
                if (!earliest || createdAt < earliest) {
                    earliest = createdAt;
                }
            }
        }

        return earliest ? earliest.toISOString() : null;
    } catch (error) {
        console.warn('อ่าน players.json ไม่ได้:', error.message);
        return null;
    }
}

function backupStatsFile(seasonNumber) {
    if (!fs.existsSync(STATS_FILE)) {
        return null;
    }

    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const backupPath = path.join(BACKUP_DIR, `playerStats-season-${seasonNumber}.json`);
    fs.copyFileSync(STATS_FILE, backupPath);
    return path.relative(ROOT_DIR, backupPath);
}

async function main() {
    await statsManager.initStatsManager();

    const current = seasonManager.getCurrentSeason();
    const entries = statsManager.getLeaderboard();
    const allStats = statsManager.getAllStats();
    const totalGames = allStats.reduce((sum, stat) => sum + (Number(stat.totalGames) || 0), 0);

    console.log(`\n🏆 ${current.name} (season #${current.number})`);
    console.log(`   ผู้เล่นที่มีสถิติ : ${allStats.length} คน`);
    console.log(`   ติดอันดับ        : ${entries.length} คน (เล่นอย่างน้อย 1 เกม)`);
    console.log(`   เกมสะสมรวม       : ${totalGames}`);

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

    const startedAt = current.startedAt || guessSeasonStartedAt();
    if (!current.startedAt && startedAt) {
        console.log(`\n   (ไม่มีวันเริ่ม season บันทึกไว้ ใช้ผู้เล่นคนแรกสุด: ${startedAt})`);
    }

    const backupFile = backupStatsFile(current.number);
    if (backupFile) {
        console.log(`\n💾 สำรองสถิติดิบไว้ที่ ${backupFile}`);
    } else {
        console.log('\n⚠️  ไม่พบ data/playerStats.json จึงไม่ได้สำรองไฟล์ดิบ');
    }

    const result = seasonManager.archiveCurrentSeason({
        entries,
        totalGames,
        backupFile,
        endedAt: new Date().toISOString(),
        startedAt
    });

    console.log(`📚 เก็บอันดับ ${result.archived.entries.length} คนไว้เป็น "${result.archived.name}"`);

    const resetCount = await statsManager.resetAllStatsForNewSeason();
    console.log(`🔄 รีเซ็ตสถิติ ${resetCount} คน`);
    console.log(`\n✅ เริ่ม ${result.current.name} แล้ว (เริ่ม ${result.current.startedAt})\n`);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error('❌ reset-season ล้มเหลว:', error);
        process.exit(1);
    });
