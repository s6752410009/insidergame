#!/usr/bin/env node
/**
 * ตัวกรองแชทโลก (managers/worldChatFilter.js) \u2014 ตารางใหญ่: คำหลบที่ต้องจับได้ + คำปกติที่ต้องผ่าน
 * รัน: node scripts/smoke-world-chat-filter.js   (ไม่ต้องเปิดเซิร์ฟเวอร์)
 */

const filter = require('../managers/worldChatFilter');

const compiled = filter.compileFilter();
let passed = 0;
const failures = [];

function expect(label, condition, detail = '') {
    if (condition) passed += 1;
    else failures.push(`${label}${detail ? ' \u2014 ' + detail : ''}`);
}

// ---------- คำหลบที่ต้องจับได้ (ข้อความ, คำที่ควรเจอ) ----------
const EVASIONS = [
    // ควย
    ['ควย', 'ควย'], ['ค ว ย', 'ควย'], ['ค.ว.ย', 'ควย'], ['ค-ว-ย', 'ควย'], ['ค_ว_ย', 'ควย'],
    ['ควยยยยยย', 'ควย'], ['คคววยย', 'ควย'], ['ค่วย', 'ควย'], ['ค้วย', 'ควย'], ['ฅวย', 'ควย'],
    ['ค*ย', 'ควย'], ['คxย', 'ควย'], ['ค@ย', 'ควย'], ['ค\u200Bว\u200Bย', 'ควย'], ['ค\u00ADว\u00ADย', 'ควย'],
    ['ไอควย', 'ควย'], ['มึงมันควยมาก', 'ควย'], ['ค ว ย ๆ', 'ควย'], ['ค🍆ว🍆ย', 'ควย'], ['คํวย', 'ควย'],
    ['คว้าย', 'คว้าย'], ['ควั้ย', 'ควั้ย'], ['ควุ้ย', 'ควุ้ย'],
    ['kuy', 'kuy'], ['KUY', 'kuy'], ['k u y', 'kuy'], ['kuyyyy', 'kuy'], ['aikuy', 'kuy'], ['\u043Auy', 'kuy'],
    ['kuay', 'kuay'], ['ไอ้ kuy', 'kuy'],
    // หี
    ['หี', 'หี'], ['หีีีี', 'หี'], ['ห ี', 'หี'], ['หี่', 'หี'], ['อีหี', 'หี'], ['หีหี', 'หี'],
    ['ห.ี', 'หี'], ['ฬี', 'หี'], ['hee', 'hee'], ['heeeee', 'hee'], ['HEE', 'hee'],
    // เย็ด
    ['เย็ด', 'เย็ด'], ['เยด', 'เย็ด'], ['เย้ด', 'เย็ด'], ['เย็ดดดดด', 'เย็ด'], ['เ ย็ ด', 'เย็ด'],
    ['เย็ดแม่', 'เย็ด'], ['yed', 'yed'], ['y e d', 'yed'], ['yedmae', 'yedmae'], ['เ-ย-็-ด', 'เย็ด'],
    // เงี่ยน
    ['เงี่ยน', 'เงี่ยน'], ['เงียน', 'เงี่ยน'], ['เงี่ยนนนน', 'เงี่ยน'], ['เ งี่ ย น', 'เงี่ยน'],
    ['ngian', 'ngian'], ['เ*ี่ยน', 'เงี่ยน'],
    // เหี้ย
    ['เหี้ย', 'เหี้ย'], ['เหี๊ย', 'เหี้ย'], ['เหี่ย', 'เหี้ย'], ['เหีย', 'เหี้ย'], ['เหี้ยยยยย', 'เหี้ย'],
    ['ไอ้เหี้ย', 'เหี้ย'], ['เ-หี้-ย', 'เหี้ย'], ['เหี้ย!!!', 'เหี้ย'], ['เหี้้้้้ย', 'เหี้ย'],
    // สัส
    ['สัส', 'สัส'], ['ศัส', 'สัส'], ['ษัส', 'สัส'], ['ส ั ส', 'สัส'], ['สั๊ส', 'สัส'], ['สัสสสส', 'สัส'],
    ['ไอสัส', 'สัส'], ['ไอ้สัส', 'สัส'], ['ai sus', 'ai sus'], ['aisus', 'aisus'], ['AI  SUS', 'ai sus'],
    // แม่ง
    ['แม่ง', 'แม่ง'], ['แม้ง', 'แม้ง'], ['แม๊ง', 'แม๊ง'], ['แมร่ง', 'แมร่ง'], ['แม่งงงง', 'แม่ง'],
    ['แม่งเอ๊ย', 'แม่ง'], ['แม่ง!', 'แม่ง'], ['เกมนี้แม่งโคตรยาก', 'แม่ง'], ['แ ม่ ง', 'แม่ง'],
    // ห่า
    ['ห่า', 'ห่า'], ['ไอ้ห่า', 'ห่า'], ['ห่าเอ๊ย', 'ห่า'], ['ห่าราก', 'ห่า'], ['ห่่่า', 'ห่า'], ['ห . ่ า', 'ห่า'],
    // ระยำ
    ['ระยำ', 'ระยำ'], ['ระยํา', 'ระยำ'], ['ร ะ ย ำ', 'ระยำ'],
    // ควาย (เฉพาะด่าตรงตัว)
    ['ไอ้ควาย', 'ไอ้ควาย'], ['ไอควาย', 'ไอ้ควาย'], ['อีควาย', 'อีควาย'],
    // อังกฤษ
    ['fuck', 'fuck'], ['FUCK', 'fuck'], ['fuuuuuck', 'fuck'], ['f u c k', 'fuck'], ['f.u.c.k', 'fuck'],
    ['f*ck', 'fuck'], ['f**k', 'fuck'], ['fxck', 'fuck'], ['f\u00FCck', 'fuck'], ['\uFF46\uFF55\uFF43\uFF4B', 'fuck'], ['fu\u0441k', 'fuck'],
    ['motherfucker', 'fuck'], ['fucking noob', 'fuck'], ['fuk', 'fuk'], ['fck', 'fck'],
    ['shit', 'shit'], ['sh1t', 'shit'], ['sh!t', 'shit'], ['$hit', 'shit'], ['bullshit', 'shit'], ['s h i t', 'shit'],
    ['bitch', 'bitch'], ['b1tch', 'bitch'], ['b!tch', 'bitch'], ['bitchhhh', 'bitch'],
    ['asshole', 'asshole'], ['a55hole', 'asshole'], ['@sshole', 'asshole'], ['ass hole'.replace(' ', ''), 'asshole']
];

// ---------- คำปกติที่ต้องผ่าน ----------
const INNOCENT = [
    // หี
    'หีบ', 'หีบเพลง', 'หีบศพ', 'หีบห่อ', 'เปิดหีบสมบัติ', 'หนี', 'หมี', 'สีหน้า', 'ดีใจ', 'มีหมาเลี้ยง',
    // เหี้ย
    'เหี่ยว', 'ดอกไม้เหี่ยว', 'โหดเหี้ยม', 'เกลี้ยงเหี้ยน', 'คลื่นเหียน', 'ต้นเหียง', 'เหยียบ', 'เฮีย',
    // ห่า
    'เห่า', 'หมาเห่า', 'ห่าง', 'อยู่ห่างกัน', 'ห่าน', 'ห่าม', 'ห้า', 'ห้าโมงเย็น', 'หา', 'ค้นหา', 'ปัญหา',
    'ห๋า อะไรนะ', 'หาย', 'เหล่า', 'ใหญ่', 'ไปหาเพื่อน',
    // แม่ง
    'แม่', 'แม่งาน', 'แม่งอน', 'แม่งู', 'แม่ง่วงนอน', 'แม่ง่ายมาก', 'แมง', 'แมงมุม', 'แมงปอ', 'แม่งอแง',
    // ควย / ควาย
    'ควาย', 'ควายป่า', 'เลี้ยงควาย', 'ควายธนู', 'ความ', 'ความรัก', 'กล้วย', 'ช่วยด้วย', 'ด้วย', 'สวย', 'รวย',
    'ขวัญ', 'ควัก', 'ร่วมด้วยช่วยกัน', 'เควส',
    // สัส
    'สัสดี', 'ศัสตรา', 'พัสดุ', 'รัสเซีย', 'รหัส', 'ภัสสร', 'อัสสัมชัญ', 'ทัศนศึกษา', 'สัตว์', 'สัปดาห์',
    'ศาสนา', 'มหัศจรรย์', 'รัศมี', 'สวัสดีครับ', 'สวัสดีค่ะทุกคน',
    // เย็ด / เงี่ยน / ระยำ
    'เย็น', 'เยี่ยม', 'เยอะ', 'เด็ก', 'เยาวชน', 'เงียบ', 'เงิน', 'เงี่ยหูฟัง', 'ระยะ', 'ระยอง', 'ระยะทาง',
    'กรรมการ', 'ธรรมดา', 'สวรรค์',
    // ประโยคทั่วไป
    'ใครว่างมาเล่น werewolf กัน', 'ห้องนี้ขาดอีก 2 คน', 'ไปดูหนังกัน', 'เล่นเกมสนุกมาก 555',
    'insider ใครเป็นคนรู้คำ', 'ขอบคุณที่ชวนนะ', 'เมื่อกี้หลุดเน็ต ขอโทษ',
    // อังกฤษ
    'hello', 'the', 'he is pro', 'sus', 'sus มาก', 'you are sus', 'class', 'pass', 'assassin', 'assist', 'bass',
    'shiitake', 'shitzu', 'kitchen', 'cocktail', 'scunthorpe', 'button', 'grape', 'therapist', 'skyline',
    'kuya', 'night', 'sushi', 'suspect', 'assume', 'hiya', 'heel', 'wheel', 'cheese', 'glass', 'shift',
    'shirt', 'fuchsia', 'yes', 'yeah', 'hehe', 'lol', 'gg', 'gg wp', 'nice', 'ok', 'snitch',
    // ตัวเลข/สัญลักษณ์
    '555555555', '55555555555555', '5555', '123456', '9999 แต้ม', '1000000', 'ห้อง 482913', '@_@', '^^', ':)',
    'ver.2', '5.5', '3-2 แล้ว', '08:30', '10/10'
];

// ---------- ลิงก์ / LINE / เบอร์ ----------
const CONTACTS = [
    ['https://evil.example', 'link'], ['http://x.co', 'link'], ['www.scam', 'link'], ['google.com', 'link'],
    ['google . com', 'link'], ['google dot com', 'link'], ['google ดอท คอม', null], ['bit.ly/abc', 'link'],
    ['t.me/scam', 'link'], ['เข้า example(.)com', 'link'], ['shop.co.th', 'link'], ['free-coin.xyz', 'link'],
    ['\uFF47\uFF4F\uFF4F\uFF47\uFF4C\uFF45．\uFF43\uFF4F\uFF4D', 'link'], ['discord.gg/abc', 'link'], ['เว็บ abcจุดcom', 'link'],
    ['line: abc123', 'line'], ['line id abcd', 'line'], ['ไลน์ myid99', 'line'], ['แอดไลน์ @promo', 'line'],
    ['ไอดีไลน์: abcd', 'line'], ['id: scammer', 'line'], ['@freecoins', 'line'], ['ทักมา @shop99', 'line'],
    ['0812345678', 'phone'], ['081-234-5678', 'phone'], ['081 234 5678', 'phone'], ['๐๘๑๒๓๔๕๖๗๘', 'phone'],
    ['+66 81 234 5678', 'phone'], ['โทร 02-123-4567', 'phone'], ['0.8.1.2.3.4.5.6.7.8', 'phone'],
    // ไม่ใช่ช่องทางติดต่อ
    ['555555555555', null], ['0 555555555', null], ['ห้อง 123456', null], ['line up ก่อน', null],
    ['เล่นออนไลน์ด้วยกัน', null], ['ไลน์กลุ่มเพื่อน', null], ['@_@', null], ['ok.', null], ['gg.', null],
    ['ชนะ 3.5 แต้ม', null], ['ver.2', null]
];

EVASIONS.forEach(([text, word]) => {
    const words = filter.findProfanity(text, compiled);
    expect(`จับ "${text}"`, words.length > 0, `ไม่เจอ (ควรเจอ ${word})`);
    const result = filter.checkMessage(text, compiled);
    expect(`บล็อก "${text}"`, result.ok === false, JSON.stringify(result));
});

INNOCENT.forEach(text => {
    const words = filter.findProfanity(text, compiled);
    expect(`ผ่าน "${text}"`, words.length === 0, `โดนจับเป็น ${words.join(',')}`);
    const result = filter.checkMessage(text, compiled);
    expect(`ส่งได้ "${text}"`, result.ok === true, JSON.stringify(result));
});

CONTACTS.forEach(([text, reason]) => {
    const found = filter.findContact(text);
    expect(`ช่องทางติดต่อ "${text}"`, found === reason, `ได้ ${found} ควรได้ ${reason}`);
});

// DEFAULT_PROFANITY เดิม (แชทในห้อง) ต้องโดนครบ
const { DEFAULT_PROFANITY } = require('../managers/gameSettingsManager');
DEFAULT_PROFANITY.forEach(word => {
    expect(`ครอบ DEFAULT_PROFANITY "${word}"`, filter.findProfanity(word, compiled).length > 0);
});

// ---------- รายการคำที่แอดมินแก้ ----------
const custom = filter.compileFilter({ extraWords: ['ตอแหล', 'noob', '=ส้นตีน'], allowWords: ['ตอแหลน'], removedWords: ['ระยำ'] });
expect('คำเพิ่ม: ตอแหล', filter.findProfanity('ต อ แ ห ล', custom).length > 0);
expect('คำเพิ่ม allow: ตอแหลน', filter.findProfanity('ตอแหลน', custom).length === 0);
expect('คำเพิ่มสั้นละติน = ทั้งคำ: noob', filter.findProfanity('n o o b', custom).length > 0);
expect('คำเพิ่มสั้นละติน ไม่จับกลางคำ: noobs', filter.findProfanity('noobs', custom).length === 0);
expect('คำเพิ่ม exact: ส้นตีน', filter.findProfanity('ส้นตีน', custom).length > 0);
expect('ปิดคำตั้งต้น: ระยำ ผ่าน', filter.findProfanity('ระยำ', custom).length === 0);
expect('ปิดคำตั้งต้น: คำอื่นยังโดน', filter.findProfanity('ควย', custom).length > 0);
const noAllow = filter.compileFilter({ removedAllowWords: ['หีบ'] });
expect('ปิด allow ตั้งต้น: หีบ โดน', filter.findProfanity('หีบ', noAllow).length > 0);

// ---------- อื่นๆ ----------
expect('ว่าง', filter.checkMessage('   ', compiled).reason === 'empty');
expect('ยาวเกิน', filter.checkMessage('ก'.repeat(filter.MAX_LENGTH + 1), compiled).reason === 'too_long');
expect('ยาวพอดี', filter.checkMessage('ก'.repeat(filter.MAX_LENGTH), compiled).ok === true);
expect('ล้างบรรทัดใหม่', filter.checkMessage('สวัสดี\n\nครับ', compiled).text === 'สวัสดี ครับ');
expect('repeatKey เท่ากันเมื่อแค่เว้นวรรค/ตัวใหญ่', filter.repeatKey('Hello  ทุกคน!') === filter.repeatKey('hello ทุกคน'));
expect('repeatKey ต่างกันเมื่อข้อความต่าง', filter.repeatKey('hello') !== filter.repeatKey('hello2'));

// ความเร็ว \u2014 ข้อความยาวสุดต้องตรวจเร็ว (ทุกข้อความผ่านตัวนี้)
const longText = 'สวัสดีครับ ใครว่างมาเล่นกัน '.repeat(8).slice(0, filter.MAX_LENGTH);
const startedAt = process.hrtime.bigint();
for (let i = 0; i < 2000; i++) filter.checkMessage(longText, compiled);
const perMessageMs = Number(process.hrtime.bigint() - startedAt) / 1e6 / 2000;
expect('ตรวจ 1 ข้อความ < 2ms', perMessageMs < 2, `${perMessageMs.toFixed(3)}ms`);

console.log(`evasions: ${EVASIONS.length} \u00B7 innocent: ${INNOCENT.length} \u00B7 contact cases: ${CONTACTS.length} \u00B7 ${perMessageMs.toFixed(3)}ms/ข้อความ`);
if (failures.length) {
    console.error(`\u274C ${failures.length} fail / ${passed} pass`);
    failures.forEach(line => console.error('  - ' + line));
    process.exit(1);
}
console.log(`\u2705 world chat filter: ${passed} checks passed`);
