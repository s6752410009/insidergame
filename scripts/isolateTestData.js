/**
 * ให้ smoke test ที่ spawn เซิร์ฟเวอร์เอง ใช้โฟลเดอร์ data ชั่วคราวของตัวเอง
 *
 * เดิม players.json / playerStats.json / rooms.json ถูกใช้ร่วมกับ dev server ที่รันค้างอยู่
 * สองโปรเซสเขียนทับกันทั้งไฟล์ ผู้เล่นที่เทสสร้างเลยหายกลางคัน → เทส flaky แบบสุ่ม
 * และข้อมูลผู้เล่นจริงก็โดนเทสเขียนปนจนไฟล์ใน git สกปรกตลอด
 *
 * require ไฟล์นี้บนสุดของสคริปต์ที่ spawn เซิร์ฟเวอร์ — ลูกจะสืบทอด env นี้ไปเอง
 * ถ้าอยากใช้ data จริง (เช่น debug) ตั้ง SMOKE_USE_REAL_DATA=1
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.SMOKE_USE_REAL_DATA && !process.env.GAME_DATA_DIR) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-smoke-data-'));
    process.env.GAME_DATA_DIR = directory;

    process.on('exit', () => {
        try {
            fs.rmSync(directory, { recursive: true, force: true });
        } catch (error) {
            // ลบไม่ได้ก็ปล่อย — เป็นแค่โฟลเดอร์ชั่วคราว
        }
    });
}

module.exports = { DATA_DIR: process.env.GAME_DATA_DIR };
