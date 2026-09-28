/**
 * สร้างรายการ seed "ไพ่ที่ชนะได้แน่นอน" ของโซลิแทร์ → public/js/solo/solitaire-seeds.js
 *
 * สุ่ม seed จาก PRNG ที่ตั้งค่าตายตัว (รันซ้ำได้ผลเดิม) แล้วเก็บเฉพาะชุดที่ตัวแก้ (scripts/solitaire-solver.js)
 * หาทางชนะเจอจริง — smoke test จะสุ่มตรวจซ้ำทุกครั้ง
 *
 * รัน: node scripts/gen-solitaire-seeds.js [จำนวนต่อโหมด=300]
 */
const fs = require('fs');
const path = require('path');
const E = require('../public/js/solo/solitaire-engine');
const { solve } = require('./solitaire-solver');

const PER_MODE = Number(process.argv[2]) || 300;
const out = {};
for (const draw of [1, 3]) {
    const rand = E.mulberry32(draw === 1 ? 20260929 : 30092026);
    const seeds = [];
    let tried = 0;
    while (seeds.length < PER_MODE) {
        const seed = Math.floor(rand() * 4294967296) >>> 0;
        tried++;
        const result = solve(seed, draw, { maxNodes: 150000 });
        if (result.solved) seeds.push(seed);
    }
    console.log(`draw-${draw}: ${seeds.length} winnable of ${tried} tried`);
    out[draw] = seeds;
}

const body = `/* สร้างโดย scripts/gen-solitaire-seeds.js — ห้ามแก้เอง
 * seed ทุกตัวในนี้ตัวแก้ในเทสหาทางชนะเจอแล้ว (ไพ่ที่ชนะได้แน่นอน) */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SolitaireSeeds = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    return {
        1: [${out[1].join(',')}],
        3: [${out[3].join(',')}]
    };
}));
`;
fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', 'solo', 'solitaire-seeds.js'), body);
