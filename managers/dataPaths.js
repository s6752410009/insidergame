/**
 * ที่อยู่ของไฟล์ข้อมูล JSON ทั้งหมด รวมไว้ที่เดียว
 *
 * เดิม players.json / playerStats.json / bannedPlayers.json ถูก hardcode ไว้
 * ทำให้เซิร์ฟเวอร์ที่ smoke test spawn ขึ้นมา ใช้ไฟล์ชุดเดียวกับ dev server ที่รันค้างอยู่
 * สองโปรเซสเขียนทับกัน → ผู้เล่นที่เทสสร้างหายกลางคัน เทสเลย flaky
 * และข้อมูลผู้เล่นจริงก็โดนเทสเขียนปนไปด้วย
 *
 * ตั้ง GAME_DATA_DIR เพื่อชี้ไปโฟลเดอร์อื่น (เทสใช้โฟลเดอร์ชั่วคราว)
 */

const path = require('path');

const DATA_DIR = process.env.GAME_DATA_DIR
    ? path.resolve(process.env.GAME_DATA_DIR)
    : path.join(__dirname, '..', 'data');

function dataFile(name) {
    return path.join(DATA_DIR, name);
}

module.exports = {
    DATA_DIR,
    dataFile,
    PLAYERS_FILE: process.env.PLAYERS_FILE || dataFile('players.json'),
    BANNED_FILE: process.env.BANNED_FILE || dataFile('bannedPlayers.json'),
    STATS_FILE: process.env.STATS_FILE || dataFile('playerStats.json'),
    SEASONS_FILE: process.env.SEASONS_FILE || dataFile('seasons.json'),
    ROOMS_FILE: process.env.ROOMS_FILE || dataFile('rooms.json'),
    ADMIN_MESSAGES_FILE: process.env.ADMIN_MESSAGES_FILE || dataFile('adminMessages.json'),
    BACKUP_DIR: dataFile('backups')
};
