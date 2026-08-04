/**
 * ทดสอบ path MongoDB ของ roomManager โดยไม่ต้องมี Mongo จริง
 *
 * บัคที่กันไว้: persistRooms เดิมลบห้องด้วย
 *     deleteMany({ roomId: { $nin: keepIds } })   // ห้องที่ instance นี้ไม่รู้จัก
 *     deleteMany({})                              // ตอน memory ว่าง
 * ถ้า loadPersistedRooms พัง (Mongo สะดุดตอน boot) app.js จะ catch แล้วรันต่อ
 * โดยที่ rooms ว่าง → persist รอบถัดไปลบห้องทั้งคอลเลกชันทิ้งถาวร
 * และถ้ามีหลาย instance ต่างฝ่ายก็ลบห้องของกันและกัน
 *
 * รัน: node scripts/smoke-room-persist-mongo.js
 */

require('./isolateTestData');
const Module = require('module');
const { randomUUID } = require('crypto');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const calls = { bulkWrite: [], deleteMany: [], find: 0 };
let findShouldThrow = false;

const RoomSnapshot = {
    async bulkWrite(ops) { calls.bulkWrite.push(ops); return { ok: 1 }; },
    async deleteMany(filter) { calls.deleteMany.push(filter); return { deletedCount: 0 }; },
    find() {
        calls.find += 1;
        return {
            async lean() {
                if (findShouldThrow) throw new Error('simulated mongo outage');
                return [];
            }
        };
    }
};

// ยัด stub เข้า require cache ก่อน roomManager จะ require ของจริง
function stubModule(relativePath, exports) {
    const resolved = require.resolve(relativePath);
    const stub = new Module(resolved, null);
    stub.filename = resolved;
    stub.loaded = true;
    stub.exports = exports;
    require.cache[resolved] = stub;
}

stubModule('../managers/models', { RoomSnapshot });
stubModule('../managers/database', { isDBConnected: () => true, connectDB: async () => {} });

const roomManager = require('../managers/roomManager');
const playerManager = require('../managers/playerManager');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const PERSIST_SETTLE_MS = 500;

function destructiveDeletes() {
    return calls.deleteMany.filter(filter => {
        if (!filter || Object.keys(filter).length === 0) return true;         // deleteMany({})
        const clause = filter.roomId;
        return clause && Object.prototype.hasOwnProperty.call(clause, '$nin'); // $nin
    });
}

async function main() {
    // ---- 1. boot ปกติ ต้องไม่ลบอะไรทิ้ง ----
    await roomManager.initRoomManager();
    roomManager.schedulePersistRooms();
    await delay(PERSIST_SETTLE_MS);
    assert(destructiveDeletes().length === 0,
        'boot ปกติแล้วยังยิงคำสั่งลบแบบกวาด: ' + JSON.stringify(calls.deleteMany));
    console.log('1. boot ปกติ ไม่มีคำสั่งลบแบบกวาด ✓');

    // ---- 2. สร้างห้องจริง ต้อง upsert ไม่ใช่ลบ ----
    await playerManager.initPlayerManager();
    const creator = await playerManager.createOrGetPlayer(randomUUID(), 'PersistOwner');
    const creatorId = creator.playerId;
    const room = roomManager.createRoom({ name: 'PersistCase', gameMode: 'insider', maxPlayers: 8 }, creatorId);
    await delay(PERSIST_SETTLE_MS);

    const upserted = calls.bulkWrite.flat().some(op => op.updateOne?.filter?.roomId === room.roomId);
    assert(upserted, 'สร้างห้องแล้วไม่ได้ upsert ลง Mongo');
    assert(destructiveDeletes().length === 0, 'สร้างห้องแล้วยิงคำสั่งลบแบบกวาด');
    console.log('2. สร้างห้อง → upsert อย่างเดียว ✓ (roomId', room.roomId + ')');

    // ---- 3. ลบห้อง ต้องลบเจาะจงด้วย $in ----
    calls.deleteMany.length = 0;
    roomManager.clearAllRooms();
    await delay(PERSIST_SETTLE_MS);

    const targeted = calls.deleteMany.find(filter => filter?.roomId?.$in);
    assert(targeted, 'ลบห้องแล้วไม่มีคำสั่งลบเจาะจง: ' + JSON.stringify(calls.deleteMany));
    assert(targeted.roomId.$in.includes(room.roomId), 'คำสั่งลบไม่ได้ระบุห้องที่ลบจริง');
    assert(destructiveDeletes().length === 0, 'ยังมีคำสั่งลบแบบกวาดปนมา');
    console.log('3. ลบห้อง → deleteMany({ $in: [...] }) เจาะจง ✓');

    // ---- 4. สถานการณ์อันตราย: Mongo ล่มตอน boot ----
    // app.js catch error แล้วรันต่อโดย rooms ว่าง — ห้ามลบห้องใน Mongo เด็ดขาด
    calls.deleteMany.length = 0;
    findShouldThrow = true;
    await roomManager.initRoomManager().catch(() => {});
    findShouldThrow = false;

    roomManager.schedulePersistRooms();
    await delay(PERSIST_SETTLE_MS);

    assert(calls.deleteMany.length === 0,
        'Mongo ล่มตอน boot แล้วยังสั่งลบห้อง! ' + JSON.stringify(calls.deleteMany));
    console.log('4. Mongo ล่มตอน boot → ไม่ลบห้องใน DB เลย ✓');

    console.log('\n✅ MONGO PERSIST CHECKS PASSED');
    process.exit(0);
}

main().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
