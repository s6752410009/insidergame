#!/usr/bin/env node
/**
 * เล่นจริงจนจบ (ใช้ smoke เดิมของแต่ละเกม) แล้วตรวจที่เก็บ log บนดิสก์:
 * ต้องมี game_start + game_end ของโหมดนั้น พร้อม roomId/roomName/gameMode
 * และบรรทัดที่บอทเล่นต้องติดป้าย bot (ไม่ขึ้นมุมมอง "สำคัญ")
 *
 *   node scripts/smoke-game-logs-e2e.js [mode ...]      (รันทีละเกม ต่อกัน)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITES = {
    insider: 'smoke-insider-flow.js',
    werewolf: 'smoke-werewolf-flow.js',
    blackmarket: 'integration-blackmarket-stats.js',
    spyfall: 'smoke-spyfall-integration.js',
    undercover: 'smoke-undercover-play.js',
    coup: 'smoke-coup-bots-play.js',
    avalon: 'smoke-avalon-play.js',
    liar: 'smoke-liar-play.js',
    poker5: 'smoke-poker-play.js',
    pokdeng: 'smoke-pokdeng-play.js',
    codenames: 'smoke-codenames-play.js',
    wavelength: 'smoke-wavelength-play.js',
    drawguess: 'smoke-drawguess-play.js',
    colorcards: 'smoke-colorcards-play.js',
    setthi: 'smoke-setthi-play.js'
};
const modes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUITES);

let passed = 0;
const failures = [];
function check(condition, message) {
    if (condition) passed += 1; else failures.push(message);
}

for (const mode of modes) {
    const script = SUITES[mode];
    if (!script) {
        failures.push(`[${mode}] ไม่มี suite`);
        continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `insider-e2e-${mode}-`));
    const startedAt = Date.now();
    const run = spawnSync(process.execPath, [path.join(__dirname, script)], {
        cwd: ROOT,
        env: { ...process.env, GAME_DATA_DIR: dir, MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1' },
        encoding: 'utf8',
        timeout: 9 * 60 * 1000
    });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
    check(run.status === 0, `[${mode}] ${script} ผ่าน (exit ${run.status})\n${String(run.stdout || '').slice(-600)}${String(run.stderr || '').slice(-600)}`);

    const file = path.join(dir, 'serverLogs.ndjson');
    const logs = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch (error) { return null; } }).filter(Boolean)
        : [];
    const ofMode = logs.filter(log => log.gameMode === mode);
    const starts = ofMode.filter(log => log.meta && log.meta.event === 'game_start');
    const ends = ofMode.filter(log => log.meta && log.meta.event === 'game_end');
    check(starts.length > 0, `[${mode}] มี game_start (${starts.length})`);
    check(ends.length > 0, `[${mode}] มี game_end (${ends.length})`);
    check(ofMode.filter(log => log.roomId).every(log => log.roomName && log.roomName !== log.roomId), `[${mode}] ทุกบรรทัดมีชื่อห้อง`);
    check(ends.every(log => log.important && log.bucket === 'game'), `[${mode}] game_end อยู่ถัง game + สำคัญ`);
    const botLines = ofMode.filter(log => log.bot);
    check(botLines.every(log => !log.important), `[${mode}] บรรทัดบอทไม่ขึ้น "สำคัญ" (${botLines.length})`);
    const errors = logs.filter(log => log.category === 'error');
    console.log(`  ${mode.padEnd(11)} ${run.status === 0 ? 'ok ' : 'FAIL'} ${seconds}s · start ${starts.length} · end ${ends.length} · lines ${ofMode.length} · bot ${botLines.length} · error ${errors.length}${errors.length ? ' → ' + errors.slice(0, 2).map(log => log.message).join(' | ') : ''}`);
    fs.rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`❌ game-logs-e2e: ${failures.length} failed, ${passed} passed`);
    failures.forEach(message => console.error('  - ' + message));
    process.exit(1);
}
console.log(`✅ game-logs-e2e: ${passed} assertions passed (${modes.length} modes)`);
