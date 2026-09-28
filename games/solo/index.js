/**
 * ทะเบียนเกมเล่นคนเดียว — ค้นหาเองจากไฟล์ในโฟลเดอร์นี้ (ยกเว้น index.js)
 *
 * เพิ่มเกมใหม่ = วางไฟล์ games/solo/<id>.js ที่ export หน้าตาแบบนี้:
 *
 *   module.exports = {
 *     meta: {
 *       id: 'wordle',                // ตรงกับชื่อไฟล์ และ views/solo/<id>.ejs
 *       order: 10,                   // ลำดับบนหน้า /solo
 *       title: 'ทายคำรายวัน',
 *       emoji: '🧩',
 *       tagline: 'ทายคำไทยวันละคำ 6 ครั้ง',
 *       accent: '#22c55e',           // สีประจำเกม
 *       cover: '/assets/games/solo/wordle/cover.svg'
 *     },
 *     // รับผลจาก client → คืน data ใหม่ (throw Error ภาษาไทยถ้าข้อมูลไม่สมเหตุสมผล)
 *     recordResult(prevData, payload, ctx) { ... },   // ctx = { playerId, now }
 *     // สรุปสั้นๆ บนการ์ดหน้า /solo เช่น "ดีที่สุด 1:23"
 *     summary(data) { return 'ติดกัน 5 วัน'; },
 *     // ตารางอันดับ (ไม่มีก็ได้): คืน { score, label } หรือ null ถ้าไม่ควรติดอันดับ
 *     leaderboardEntry(data) { ... },
 *     leaderboardOrder: 'desc' | 'asc',
 *     // API เพิ่มเติมของเกม (ไม่มีก็ได้) — mount ที่ /api/solo/<id>/...
 *     registerRoutes(router, helpers) { ... }         // helpers = { getPlayerId(req), soloStats, rateLimit(key, max, windowMs) }
 *   };
 */

const fs = require('fs');
const path = require('path');

const GAMES = new Map();

fs.readdirSync(__dirname)
    .filter(file => file.endsWith('.js') && file !== 'index.js')
    .forEach(file => {
        try {
            const mod = require(path.join(__dirname, file));
            if (mod && mod.meta && mod.meta.id) GAMES.set(mod.meta.id, mod);
        } catch (error) {
            // เกมเดียวพัง ต้องไม่ทำทั้งเว็บล่ม
            console.error(`[solo] failed to load ${file}:`, error.message);
        }
    });

function listSoloGames() {
    return Array.from(GAMES.values())
        .map(game => game.meta)
        .sort((a, b) => (a.order || 99) - (b.order || 99));
}

function getSoloGame(id) {
    return GAMES.get(String(id || '')) || null;
}

module.exports = { listSoloGames, getSoloGame };
