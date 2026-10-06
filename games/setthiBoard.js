/**
 * เศรษฐี — ข้อมูลกระดาน (ไม่มีโค้ดเกม) · กระดาน 40 ช่องธีมจังหวัด/เมืองไทย จัดวางเอง
 *
 * ทุกช่องมี index 0–39 เดินตามเข็มนาฬิกา · มุม: 0 เริ่ม · 10 คุก · 20 จอดฟรี · 30 ไปคุก
 * จังหวัด 22 ช่องใน 8 ชุดสี (2 ชุดมี 2 ช่อง อีก 6 ชุดมี 3 ช่อง) ถูก → แพง
 * ขนส่ง 4 · สาธารณูปโภค 2 · การ์ด โอกาส 3 + ดวงชะตา 3 · ภาษี 2
 * rent = [ไม่มีบ้าน, 1 หลัง, 2, 3, 4, โรงแรม]
 */

const START_CASH = 1500;
const SALARY = 200;
const JAIL_FINE = 50;
const JAIL_SQUARE = 10;
const GO_TO_JAIL_SQUARE = 30;
const BOARD_SIZE = 40;
const TRANSPORT_RENT = [25, 50, 100, 200];
const UTILITY_MULT = [4, 10];

const GROUPS = {
    g1: { id: 'g1', name: 'ดินเผา', region: 'อีสานบ้านเรา', color: '#a8673f', ink: '#fff', houseCost: 50 },
    g2: { id: 'g2', name: 'ฟ้าคราม', region: 'อีสานเมืองใหญ่', color: '#4ea8dc', ink: '#0d2233', houseCost: 50 },
    g3: { id: 'g3', name: 'บานเย็น', region: 'ล้านนา', color: '#cc4f95', ink: '#fff', houseCost: 100 },
    g4: { id: 'g4', name: 'แสด', region: 'เมืองเก่า', color: '#ee8a2c', ink: '#2a1606', houseCost: 100 },
    g5: { id: 'g5', name: 'ชาด', region: 'ตะวันตก–ใต้', color: '#d9443b', ink: '#fff', houseCost: 150 },
    g6: { id: 'g6', name: 'ขมิ้น', region: 'เมืองท่องเที่ยว', color: '#ecbc2c', ink: '#2a1f04', houseCost: 150 },
    g7: { id: 'g7', name: 'มรกต', region: 'กรุงเทพฯ ย่านดัง', color: '#2f9d63', ink: '#fff', houseCost: 200 },
    g8: { id: 'g8', name: 'กรมท่า', region: 'ทำเลทองกรุงเทพฯ', color: '#3d64d8', ink: '#fff', houseCost: 200 }
};

const P = (name, group, price, rent, icon, blurb, short) => ({ type: 'property', name, group, price, rent, icon, blurb, short: short || name });
const T = (name, short, icon) => ({ type: 'transport', name, short, price: 200, icon });
const U = (name, icon) => ({ type: 'utility', name, price: 150, icon });

const SQUARES = [
    { type: 'go', name: 'เริ่ม', icon: 'go' },
    P('ยโสธร', 'g1', 60, [3, 15, 40, 110, 180, 260], 'rocket', 'เมืองบุญบั้งไฟ'),
    { type: 'chance', name: 'โอกาส', icon: 'chance' },
    P('มุกดาหาร', 'g1', 70, [5, 25, 70, 200, 330, 460], 'bridge', 'สะพานข้ามโขง'),
    { type: 'tax', name: 'ภาษีเงินได้', amount: 200, icon: 'tax' },
    T('สถานีขนส่งหมอชิต', 'หมอชิต', 'bus'),
    P('อุดรธานี', 'g2', 100, [7, 35, 100, 280, 420, 560], 'lotus', 'ทะเลบัวแดง'),
    P('ขอนแก่น', 'g2', 100, [7, 35, 100, 280, 420, 560], 'dino', 'เมืองไดโนเสาร์'),
    { type: 'fortune', name: 'ดวงชะตา', icon: 'fortune' },
    P('นครราชสีมา', 'g2', 120, [9, 45, 120, 320, 460, 620], 'silk', 'ผ้าไหมโคราช'),
    { type: 'jail', name: 'คุก', icon: 'jail' },
    P('น่าน', 'g3', 140, [11, 55, 160, 460, 620, 760], 'longboat', 'แข่งเรือเมืองน่าน'),
    P('ลำปาง', 'g3', 140, [11, 55, 160, 460, 620, 760], 'carriage', 'รถม้าลำปาง'),
    U('การไฟฟ้า', 'bolt'),
    P('เชียงราย', 'g3', 160, [13, 65, 190, 520, 720, 900], 'spire', 'วัดงามบนดอย'),
    T('สถานีรถไฟหัวลำโพง', 'หัวลำโพง', 'train'),
    P('สุโขทัย', 'g4', 180, [15, 75, 210, 560, 760, 950], 'lantern', 'ลอยกระทง'),
    { type: 'chance', name: 'โอกาส', icon: 'chance' },
    P('ลพบุรี', 'g4', 180, [15, 75, 210, 560, 760, 950], 'monkey', 'เมืองลิง'),
    P('พระนครศรีอยุธยา', 'g4', 200, [17, 85, 240, 620, 820, 1000], 'prang', 'กรุงเก่า', 'อยุธยา'),
    { type: 'parking', name: 'จอดฟรี', icon: 'parking' },
    P('กาญจนบุรี', 'g5', 220, [19, 95, 270, 700, 880, 1060], 'railbridge', 'สะพานข้ามแคว'),
    { type: 'fortune', name: 'ดวงชะตา', icon: 'fortune' },
    P('หัวหิน', 'g5', 220, [19, 95, 270, 700, 880, 1060], 'pavilion', 'ชายหาดหัวหิน'),
    P('กระบี่', 'g5', 240, [21, 105, 310, 760, 940, 1120], 'karst', 'เขาหินปูนกลางทะเล'),
    T('ท่าเรือคลองเตย', 'ท่าเรือ', 'ship'),
    P('พัทยา', 'g6', 260, [23, 115, 340, 820, 990, 1160], 'palm', 'ทะเลพัทยา'),
    U('การประปา', 'drop'),
    P('เชียงใหม่', 'g6', 260, [23, 115, 340, 820, 990, 1160], 'mountain', 'ดอยหน้าหนาว'),
    P('ภูเก็ต', 'g6', 280, [25, 125, 370, 870, 1040, 1220], 'sun', 'ไข่มุกอันดามัน'),
    { type: 'gotojail', name: 'ไปคุก', icon: 'whistle' },
    P('เยาวราช', 'g7', 300, [27, 135, 400, 920, 1120, 1300], 'chinalantern', 'ถนนสายมังกร'),
    P('ประตูน้ำ', 'g7', 300, [27, 135, 400, 920, 1120, 1300], 'hanger', 'ตลาดเสื้อผ้า'),
    { type: 'chance', name: 'โอกาส', icon: 'chance' },
    P('สยาม', 'g7', 320, [29, 150, 450, 1020, 1220, 1420], 'bag', 'ใจกลางช้อปปิ้ง'),
    T('ท่าอากาศยานสุวรรณภูมิ', 'สุวรรณภูมิ', 'plane'),
    { type: 'fortune', name: 'ดวงชะตา', icon: 'fortune' },
    P('สีลม', 'g8', 360, [36, 180, 520, 1120, 1320, 1520], 'tower', 'ย่านธุรกิจ'),
    { type: 'tax', name: 'ภาษีของหรู', amount: 100, icon: 'gem' },
    P('สุขุมวิท', 'g8', 400, [48, 210, 620, 1400, 1700, 2000], 'skyline', 'ทำเลทองที่สุด')
];

// ภาพแลนด์มาร์กแบบของเล่น 3 มิติของแต่ละช่อง (public/assets/games/setthi/land/<art>.svg สร้างด้วย scripts/generate-setthi-art.js)
const LANDMARK = {
    0: 'go', 1: 'yasothon', 2: 'chance', 3: 'mukdahan', 4: 'tax', 5: 'bus', 6: 'udon', 7: 'khonkaen', 8: 'fortune', 9: 'korat',
    10: 'jail', 11: 'nan', 12: 'lampang', 13: 'electric', 14: 'chiangrai', 15: 'train', 16: 'sukhothai', 17: 'chance', 18: 'lopburi', 19: 'ayutthaya',
    20: 'parking', 21: 'kanchanaburi', 22: 'fortune', 23: 'huahin', 24: 'krabi', 25: 'ship', 26: 'pattaya', 27: 'water', 28: 'chiangmai', 29: 'phuket',
    30: 'police', 31: 'yaowarat', 32: 'pratunam', 33: 'chance', 34: 'siam', 35: 'plane', 36: 'fortune', 37: 'silom', 38: 'luxury', 39: 'sukhumvit'
};

SQUARES.forEach((sq, index) => {
    sq.index = index;
    sq.art = LANDMARK[index];
    if (!sq.short) sq.short = sq.name; // ชื่อยาวมีชื่อสั้นไว้ใช้บนกระดาน
});

const OWNABLE = SQUARES.filter(sq => sq.type === 'property' || sq.type === 'transport' || sq.type === 'utility').map(sq => sq.index);
const GROUP_SQUARES = {};
SQUARES.forEach(sq => {
    if (sq.type !== 'property') return;
    (GROUP_SQUARES[sq.group] = GROUP_SQUARES[sq.group] || []).push(sq.index);
});
const TRANSPORT_SQUARES = SQUARES.filter(sq => sq.type === 'transport').map(sq => sq.index);
const UTILITY_SQUARES = SQUARES.filter(sq => sq.type === 'utility').map(sq => sq.index);

/**
 * การ์ด 2 กอง · effect:
 *  advance{to} · nearest{kind, mult} · back{steps} · jail · jailCard · repairs{house, hotel}
 *  gain{amount} · pay{amount} · payEach{amount} · collectEach{amount}
 */
const CHANCE = [
    { id: 'c01', icon: 'go', title: 'ขึ้นรถด่วนกลับจุดเริ่ม', text: 'ไปที่ช่อง เริ่ม รับเงินเดือน ฿200', effect: { type: 'advance', to: 0 } },
    { id: 'c02', icon: 'mountain', title: 'เที่ยวดอยหน้าหนาว', text: 'ไปเชียงใหม่ · ผ่านจุดเริ่มรับ ฿200', effect: { type: 'advance', to: 28 } },
    { id: 'c03', icon: 'bag', title: 'นัดเพื่อนดูหนัง', text: 'ไปสยาม · ผ่านจุดเริ่มรับ ฿200', effect: { type: 'advance', to: 34 } },
    { id: 'c04', icon: 'skyline', title: 'ได้งานใหม่ใจกลางเมือง', text: 'ไปสุขุมวิท', effect: { type: 'advance', to: 39 } },
    { id: 'c05', icon: 'longboat', title: 'ปั่นจักรยานเที่ยวเมืองเก่า', text: 'ไปน่าน · ผ่านจุดเริ่มรับ ฿200', effect: { type: 'advance', to: 11 } },
    { id: 'c06', icon: 'bus', title: 'รีบไปให้ทันรถ!', text: 'ไปสถานี/ท่าที่ใกล้สุด · มีเจ้าของจ่ายค่าเช่า 2 เท่า · ไม่มีเจ้าของซื้อได้', effect: { type: 'nearest', kind: 'transport', mult: 2 } },
    { id: 'c07', icon: 'train', title: 'ตกรถเที่ยวแรก', text: 'ไปสถานี/ท่าที่ใกล้สุด · มีเจ้าของจ่ายค่าเช่า 2 เท่า · ไม่มีเจ้าของซื้อได้', effect: { type: 'nearest', kind: 'transport', mult: 2 } },
    { id: 'c08', icon: 'bolt', title: 'ไฟดับทั้งซอย!', text: 'ไปการไฟฟ้า/การประปาที่ใกล้สุด · มีเจ้าของ ทอยเต๋าแล้วจ่าย 10 เท่า', effect: { type: 'nearest', kind: 'utility', mult: 10 } },
    { id: 'c09', icon: 'wallet', title: 'ลืมกระเป๋าตังค์ที่ร้านส้มตำ', text: 'ถอยหลัง 3 ช่อง', effect: { type: 'back', steps: 3 } },
    { id: 'c10', icon: 'whistle', title: 'ขับรถฝ่าไฟแดง!', text: 'ไปคุกทันที ไม่ผ่านจุดเริ่ม ไม่ได้เงินเดือน', effect: { type: 'jail' } },
    { id: 'c11', icon: 'key', title: 'บัตรอภัยโทษ', text: 'เก็บไว้ใช้ออกจากคุกฟรี หรือแลกกับเพื่อนก็ได้', effect: { type: 'jailCard' } },
    { id: 'c12', icon: 'hammer', title: 'พายุฤดูร้อน', text: 'ซ่อมหลังคา จ่ายบ้านหลังละ ฿25 · โรงแรมละ ฿100', effect: { type: 'repairs', house: 25, hotel: 100 } },
    { id: 'c13', icon: 'coins', title: 'ปันผลสหกรณ์', text: 'รับ ฿50', effect: { type: 'gain', amount: 50 } },
    { id: 'c14', icon: 'mic', title: 'ชนะประกวดร้องเพลงลูกทุ่ง', text: 'รับรางวัล ฿150', effect: { type: 'gain', amount: 150 } },
    { id: 'c15', icon: 'ticket', title: 'จอดรถในที่ห้ามจอด', text: 'จ่ายค่าปรับ ฿15', effect: { type: 'pay', amount: 15 } },
    { id: 'c16', icon: 'people', title: 'ได้เป็นประธานรุ่น', text: 'เลี้ยงข้าวเพื่อนทุกคน จ่ายคนละ ฿50', effect: { type: 'payEach', amount: 50 } }
];

const FORTUNE = [
    { id: 'f01', icon: 'go', title: 'เซียมซีเลขดี!', text: 'ไปที่ช่อง เริ่ม รับเงินเดือน ฿200', effect: { type: 'advance', to: 0 } },
    { id: 'f02', icon: 'bank', title: 'ธนาคารโอนเงินผิด', text: 'ได้เงินคืน ฿200', effect: { type: 'gain', amount: 200 } },
    { id: 'f03', icon: 'tooth', title: 'ไปหาหมอฟัน', text: 'จ่าย ฿50', effect: { type: 'pay', amount: 50 } },
    { id: 'f04', icon: 'box', title: 'ขายของออนไลน์ปัง', text: 'ได้กำไร ฿50', effect: { type: 'gain', amount: 50 } },
    { id: 'f05', icon: 'key', title: 'บัตรอภัยโทษ', text: 'เก็บไว้ใช้ออกจากคุกฟรี หรือแลกกับเพื่อนก็ได้', effect: { type: 'jailCard' } },
    { id: 'f06', icon: 'whistle', title: 'จอดรถขวางทางเข้าวัด', text: 'ไปคุกทันที ไม่ผ่านจุดเริ่ม ไม่ได้เงินเดือน', effect: { type: 'jail' } },
    { id: 'f07', icon: 'gift', title: 'วันเกิดคุณ!', text: 'เพื่อนทุกคนให้ซองคนละ ฿10', effect: { type: 'collectEach', amount: 10 } },
    { id: 'f08', icon: 'receipt', title: 'ได้คืนภาษี', text: 'รับ ฿20', effect: { type: 'gain', amount: 20 } },
    { id: 'f09', icon: 'piggy', title: 'ประกันออมทรัพย์ครบกำหนด', text: 'รับ ฿100', effect: { type: 'gain', amount: 100 } },
    { id: 'f10', icon: 'book', title: 'ค่าเรียนพิเศษ', text: 'จ่าย ฿50', effect: { type: 'pay', amount: 50 } },
    { id: 'f11', icon: 'cross', title: 'ค่าโรงพยาบาล', text: 'จ่าย ฿100', effect: { type: 'pay', amount: 100 } },
    { id: 'f12', icon: 'bowl', title: 'ประกวดส้มตำได้รางวัลชมเชย', text: 'รับ ฿10', effect: { type: 'gain', amount: 10 } },
    { id: 'f13', icon: 'cone', title: 'ซ่อมถนนหน้าบ้าน', text: 'จ่ายบ้านหลังละ ฿40 · โรงแรมละ ฿115', effect: { type: 'repairs', house: 40, hotel: 115 } },
    { id: 'f14', icon: 'heart', title: 'คุณยายให้มรดก', text: 'รับ ฿100', effect: { type: 'gain', amount: 100 } },
    { id: 'f15', icon: 'camera', title: 'รับจ้างถ่ายรูปงานแต่ง', text: 'ได้ค่าจ้าง ฿25', effect: { type: 'gain', amount: 25 } },
    { id: 'f16', icon: 'stall', title: 'ออกร้านงานวัด', text: 'ขายดี ได้กำไร ฿100', effect: { type: 'gain', amount: 100 } }
];

const CARD_BY_ID = new Map([...CHANCE, ...FORTUNE].map(card => [card.id, card]));

/** ข้อมูลกระดานแบบส่งให้ client (ไม่มีลำดับกองการ์ด) */
function publicBoard() {
    return {
        squares: SQUARES.map(sq => ({
            index: sq.index,
            type: sq.type,
            name: sq.name,
            short: sq.short,
            group: sq.group || null,
            price: sq.price || null,
            rent: sq.rent || null,
            amount: sq.amount || null,
            icon: sq.icon,
            art: sq.art,
            blurb: sq.blurb || null
        })),
        groups: GROUPS,
        groupSquares: GROUP_SQUARES,
        transportRent: TRANSPORT_RENT,
        utilityMult: UTILITY_MULT,
        startCash: START_CASH,
        salary: SALARY,
        jailFine: JAIL_FINE
    };
}

module.exports = {
    START_CASH,
    SALARY,
    JAIL_FINE,
    JAIL_SQUARE,
    GO_TO_JAIL_SQUARE,
    BOARD_SIZE,
    TRANSPORT_RENT,
    UTILITY_MULT,
    GROUPS,
    SQUARES,
    OWNABLE,
    GROUP_SQUARES,
    TRANSPORT_SQUARES,
    UTILITY_SQUARES,
    CHANCE,
    FORTUNE,
    CARD_BY_ID,
    publicBoard
};
