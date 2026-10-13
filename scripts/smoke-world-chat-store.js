#!/usr/bin/env node
/**
 * ที่เก็บแชทโลก (managers/worldChatManager.js): เก็บล่าสุด 200, รีสตาร์ตแล้วยังอยู่ (ไฟล์ + Mongo จำลอง),
 * รายงานครบ N ซ่อนเอง, ห้ามพิมพ์หมดเวลาเอง, แก้รายการคำแล้วตัวกรองเปลี่ยนตาม
 * รัน: node scripts/smoke-world-chat-store.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorldChatStore, MESSAGE_LIMIT } = require('../managers/worldChatManager');
const chatFilter = require('../managers/worldChatFilter');

let passed = 0;
function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-chat-store-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, 'worldChat.json');

let clock = Date.parse('2026-10-13T10:00:00Z');
const now = () => clock;

function sample(i, extra = {}) {
    return { playerId: `p${i % 7}`, playerName: `ผู้เล่น ${i}`, color: '#fff', avatar: '😀', avatarFrame: 'gold', text: `ข้อความ ${i}`, ...extra };
}

async function fileBackend() {
    const store = createWorldChatStore({ file, now, debounceMs: 5 });
    await store.init({ useDatabase: false });
    assert(store.listMessages().length === 0, 'เริ่มว่าง');

    for (let i = 0; i < MESSAGE_LIMIT + 25; i++) {
        clock += 1000;
        store.addMessage(sample(i));
    }
    const all = store.listMessages();
    assert(all.length === MESSAGE_LIMIT, `เก็บ ${MESSAGE_LIMIT} (ได้ ${all.length})`);
    assert(all[0].text === 'ข้อความ 25', 'ตัดข้อความเก่าสุดทิ้ง');
    assert(all[all.length - 1].text === `ข้อความ ${MESSAGE_LIMIT + 24}`, 'ล่าสุดอยู่ท้าย');

    const invite = store.addMessage({ ...sample(1), kind: 'invite', invite: { roomId: '123456', roomName: '<b>ห้อง</b>', gameMode: 'werewolf', gameLabel: 'Werewolf', emoji: '🐺', count: 3, max: 8 } });
    assert(invite && invite.kind === 'invite' && invite.invite.count === 3, 'การ์ดชวนเล่นเก็บได้');
    assert(store.addMessage({ ...sample(1), kind: 'invite', invite: {} }) === null, 'การ์ดไม่มีห้อง = ไม่รับ');

    // รายงาน
    const target = all[all.length - 1];
    assert(store.reportMessage(target.id, target.playerId).status === 'own', 'รายงานตัวเองไม่ได้');
    assert(store.reportMessage(target.id, 'r1').status === 'reported', 'รายงานครั้งที่ 1');
    assert(store.reportMessage(target.id, 'r1').status === 'already', 'คนเดิมรายงานซ้ำไม่นับ');
    assert(store.reportMessage(target.id, 'r2').status === 'reported', 'รายงานครั้งที่ 2');
    assert(store.reportMessage(target.id, 'r3').status === 'hidden', 'ครบ 3 คน → ซ่อน');
    assert(!store.listMessages().some(m => m.id === target.id), 'ข้อความซ่อนไม่อยู่ในรายการสาธารณะ');
    assert(store.listMessages({ includeHidden: true }).some(m => m.id === target.id && m.hiddenReason === 'reports'), 'แอดมินยังเห็น');
    assert(store.reportMessage('nope', 'r1').status === 'not_found', 'ไม่มีข้อความ');

    store.restoreMessage(target.id);
    assert(store.listMessages().some(m => m.id === target.id) && store.getMessage(target.id).reports.length === 0, 'แอดมินคืนข้อความ');
    store.hideMessage(target.id);
    assert(store.getMessage(target.id).hiddenReason === 'admin', 'แอดมินซ่อน');

    assert(!store.getMessage(all[0].id), 'การ์ดชวนเล่นดันข้อความเก่าสุดออก (ยังคง 200)');
    const oldest = store.listMessages()[0];
    const removed = store.deleteMessage(oldest.id);
    assert(removed && !store.getMessage(oldest.id), 'ลบข้อความ');
    const purged = store.deleteMessagesByPlayer('p3');
    assert(purged.length > 0 && !store.listMessages({ includeHidden: true }).some(m => m.playerId === 'p3'), 'ลบข้อความทั้งหมดของคนเดียว');

    // ห้ามพิมพ์
    store.mute('p1', 10 * 60 * 1000, { playerName: 'หนึ่ง', reason: 'สแปม' });
    assert(store.getMute('p1') && store.getMute('p1').reason === 'สแปม', 'ห้ามพิมพ์ 10 นาที');
    clock += 9 * 60 * 1000;
    assert(store.getMute('p1'), 'ผ่าน 9 นาที ยังโดน');
    clock += 2 * 60 * 1000;
    assert(store.getMute('p1') === null, 'ครบ 10 นาที หมดเอง');
    store.mute('p2', 24 * 60 * 60 * 1000, { playerName: 'สอง' });
    assert(store.listMutes().length === 1, 'รายการห้ามพิมพ์');
    assert(store.unmute('p2') === true && store.listMutes().length === 0, 'ปลดห้ามพิมพ์');
    store.mute('p4', 24 * 60 * 60 * 1000, { playerName: 'สี่' });

    // รายการคำ
    assert(chatFilter.findProfanity('ตอแหล', store.getCompiledFilter()).length === 0, 'ก่อนเพิ่มคำ ผ่าน');
    assert(store.editWord('block', 'add', 'ตอแหล').ok, 'เพิ่มคำต้องห้าม');
    assert(chatFilter.findProfanity('ต อ แ ห ล', store.getCompiledFilter()).length > 0, 'เพิ่มแล้วตัวกรองจับ');
    assert(store.editWord('block', 'remove', 'ระยำ').ok, 'ปิดคำตั้งต้น');
    assert(chatFilter.findProfanity('ระยำ', store.getCompiledFilter()).length === 0, 'ปิดแล้วผ่าน');
    assert(store.describeWords().block.find(w => w.word === 'ระยำ').enabled === false, 'หน้าแอดมินเห็นว่าปิด');
    assert(store.editWord('allow', 'add', 'หีบห่อของขวัญ').ok, 'เพิ่ม allow');
    assert(store.editWord('block', 'add', 'ก').ok === false, 'คำสั้นเกินไม่รับ');
    assert(store.editWord('block', 'add', ' ').ok === false, 'คำว่างไม่รับ');
    assert(store.setReportThreshold(5).ok && store.getConfig().reportThreshold === 5, 'ตั้งจำนวนรายงาน');
    assert(store.setReportThreshold(0).ok === false, 'จำนวนรายงานต้อง ≥1');

    await store.persistNow();
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(onDisk.messages.length === store.listMessages({ includeHidden: true }).length, 'เขียนลงไฟล์ครบ');

    // "รีสตาร์ต" — สร้าง store ใหม่อ่านไฟล์เดิม
    const reborn = createWorldChatStore({ file, now, debounceMs: 5 });
    await reborn.init({ useDatabase: false });
    assert(reborn.listMessages({ includeHidden: true }).length === onDisk.messages.length, 'รีสตาร์ตแล้วข้อความอยู่ครบ');
    assert(reborn.getMessage(target.id).hidden === true, 'สถานะซ่อนอยู่หลังรีสตาร์ต');
    assert(reborn.getMute('p4') !== null, 'ห้ามพิมพ์อยู่หลังรีสตาร์ต');
    assert(chatFilter.findProfanity('ตอแหล', reborn.getCompiledFilter()).length > 0, 'คำที่เพิ่มอยู่หลังรีสตาร์ต');
    assert(chatFilter.findProfanity('ระยำ', reborn.getCompiledFilter()).length === 0, 'คำที่ปิดยังปิดหลังรีสตาร์ต');
    assert(reborn.getConfig().reportThreshold === 5, 'จำนวนรายงานอยู่หลังรีสตาร์ต');

    // ไฟล์เสีย → เริ่มว่าง ไม่ล่ม
    fs.writeFileSync(file, '{broken');
    const broken = createWorldChatStore({ file, now });
    await broken.init({ useDatabase: false });
    assert(broken.listMessages().length === 0, 'ไฟล์เสีย เริ่มว่างได้');
}

async function mongoBackend() {
    let doc = null;
    let writes = 0;
    const model = {
        findOne() { return { lean: async () => (doc ? JSON.parse(JSON.stringify(doc)) : null) }; },
        async findOneAndUpdate(filter, update, opts) {
            assert(filter.key === 'main' && opts.upsert === true, 'Mongo upsert เอกสาร main');
            writes += 1;
            doc = { key: 'main', ...JSON.parse(JSON.stringify(update.$set)) };
            return doc;
        }
    };
    const store = createWorldChatStore({ now, debounceMs: 5, getModel: () => model });
    await store.init({ useDatabase: true });
    assert(store.isUsingDatabase(), 'ใช้ Mongo');
    for (let i = 0; i < 30; i++) store.addMessage(sample(i));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert(writes === 1, `ข้อความรัวๆ รวมเป็นการเขียนครั้งเดียว (เขียน ${writes} ครั้ง)`);
    store.editWord('block', 'add', 'noob');
    await store.persistNow();
    const reborn = createWorldChatStore({ now, getModel: () => model });
    await reborn.init({ useDatabase: true });
    assert(reborn.listMessages().length === 30, 'Mongo: รีสตาร์ตแล้วข้อความอยู่');
    assert(chatFilter.findProfanity('noob', reborn.getCompiledFilter()).length > 0, 'Mongo: รายการคำอยู่');
}

(async () => {
    await fileBackend();
    await mongoBackend();
    console.log(`✅ world chat store: ${passed} checks passed`);
})().catch(error => {
    console.error(error.message);
    process.exit(1);
});
