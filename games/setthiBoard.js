/**
 * เศรษฐี — ข้อมูลกระดาน (ไม่มีโค้ดเกม) · กระดาน 32 ช่อง ด้านละ 8 ช่อง (รวมมุม) ธีมจังหวัด/ที่เที่ยวไทย จัดวางเอง
 *
 * ทุกช่องมี index 0–31 เดินตามเข็มนาฬิกา · มุม: 0 เริ่ม · 8 เกาะร้าง · 16 งานวัด (เทศกาล) · 24 ทัวร์ทั่วไทย
 * เมือง 20 ช่องใน 8 กลุ่มสี (2/3/2/3/2/3/2/3) ถูก → แพง ย่านดังกรุงเทพฯ อยู่ท้ายสุด
 * แหล่งท่องเที่ยว 4 (ด้านละ 1) · โอกาส 3 · ภาษี 1
 *
 * ขั้นสิ่งปลูกสร้างของเมือง: 0 ที่ดิน · 1 บ้าน · 2 ตึก · 3 โรงแรม · 4 แลนด์มาร์ก
 */

const START_CASH = 15000;
const SALARY = 3000;
const BOARD_SIZE = 32;
const SIDE = 8;
const START_SQUARE = 0;
const ISLAND_SQUARE = 8;
const FESTIVAL_SQUARE = 16;
const TOUR_SQUARE = 24;
const ISLAND_TURNS = 3;
const ISLAND_FEE = 1000;
const TOUR_FEE = 500;
const TAX_RATE = 0.1;

// ราคาแต่ละขั้น = ราคาที่ดิน × ตัวคูณ · ค่าผ่านทาง = ราคาที่ดิน × ตัวคูณตามขั้น
const LEVEL_COST = [1, 0.5, 1, 1.5, 2];
const TOLL_MULT = [0.3, 1, 2.2, 3.5, 6];
const LEVEL_NAMES = ['ที่ดิน', 'บ้าน', 'ตึก', 'โรงแรม', 'แลนด์มาร์ก'];
const TOUR_PRICE = 3000;
const TOUR_TOLL = [600, 1600, 3500, 6000];

const GROUPS = {
    g1: { id: 'g1', name: 'ดินเผา', region: 'อีสานริมโขง', color: '#a8673f', ink: '#fff' },
    g2: { id: 'g2', name: 'ฟ้าคราม', region: 'อีสานเมืองใหญ่', color: '#4ea8dc', ink: '#0d2233' },
    g3: { id: 'g3', name: 'บานเย็น', region: 'ล้านนา', color: '#cc4f95', ink: '#fff' },
    g4: { id: 'g4', name: 'แสด', region: 'เมืองเก่า', color: '#ee8a2c', ink: '#2a1606' },
    g5: { id: 'g5', name: 'ชาด', region: 'ตะวันตก', color: '#d9443b', ink: '#fff' },
    g6: { id: 'g6', name: 'ขมิ้น', region: 'เมืองท่องเที่ยว', color: '#ecbc2c', ink: '#2a1f04' },
    g7: { id: 'g7', name: 'มรกต', region: 'กรุงเทพฯ ย่านเก่า', color: '#2f9d63', ink: '#fff' },
    g8: { id: 'g8', name: 'กรมท่า', region: 'ใจกลางกรุงเทพฯ', color: '#3d64d8', ink: '#fff' }
};

const C = (name, group, price, icon, art, blurb, short) => ({ type: 'city', name, group, price, icon, art, blurb, short: short || name });
const T = (name, short, icon, art, blurb) => ({ type: 'tourist', name, short, price: TOUR_PRICE, icon, art, blurb });

const SQUARES = [
    { type: 'start', name: 'เริ่ม', icon: 'go', art: 'go' },
    C('ยโสธร', 'g1', 500, 'rocket', 'yasothon', 'เมืองบุญบั้งไฟ'),
    C('มุกดาหาร', 'g1', 600, 'bridge', 'mukdahan', 'หอแก้วริมโขง'),
    { type: 'chance', name: 'โอกาส', icon: 'chance', art: 'chance' },
    C('อุดรธานี', 'g2', 800, 'lotus', 'udon', 'ทะเลบัวแดง', 'อุดร'),
    T('ตลาดน้ำดำเนินสะดวก', 'ตลาดน้ำ', 'boat', 'damnoen', 'เรือขายของในคลอง'),
    C('ขอนแก่น', 'g2', 800, 'dino', 'khonkaen', 'เมืองไดโนเสาร์'),
    C('นครราชสีมา', 'g2', 1000, 'silk', 'korat', 'ประตูเมืองโคราช', 'โคราช'),
    { type: 'island', name: 'เกาะร้าง', icon: 'island', art: 'island' },
    C('น่าน', 'g3', 1100, 'longboat', 'nan', 'แข่งเรือเมืองน่าน'),
    C('เชียงราย', 'g3', 1200, 'spire', 'chiangrai', 'วัดงามบนดอย'),
    T('เขาใหญ่', 'เขาใหญ่', 'forest', 'khaoyai', 'ป่าใหญ่ น้ำตก ช้างป่า'),
    C('สุโขทัย', 'g4', 1400, 'lantern', 'sukhothai', 'ลอยกระทง'),
    { type: 'chance', name: 'โอกาส', icon: 'chance', art: 'chance' },
    C('ลพบุรี', 'g4', 1400, 'monkey', 'lopburi', 'เมืองลิง'),
    C('พระนครศรีอยุธยา', 'g4', 1600, 'prang', 'ayutthaya', 'กรุงเก่า', 'อยุธยา'),
    { type: 'festival', name: 'งานวัด', icon: 'flag', art: 'festival' },
    C('กาญจนบุรี', 'g5', 1800, 'railbridge', 'kanchanaburi', 'สะพานข้ามแคว', 'กาญจน์'),
    C('หัวหิน', 'g5', 1900, 'pavilion', 'huahin', 'ชายหาดหัวหิน'),
    { type: 'chance', name: 'โอกาส', icon: 'chance', art: 'chance' },
    C('พัทยา', 'g6', 2100, 'palm', 'pattaya', 'ทะเลพัทยา'),
    T('ดอยอินทนนท์', 'อินทนนท์', 'peak', 'inthanon', 'ยอดดอยสูงสุดของไทย'),
    C('เชียงใหม่', 'g6', 2100, 'mountain', 'chiangmai', 'ดอยหน้าหนาว'),
    C('ภูเก็ต', 'g6', 2300, 'sun', 'phuket', 'ไข่มุกอันดามัน'),
    { type: 'tour', name: 'ทัวร์ทั่วไทย', icon: 'plane', art: 'tour' },
    C('เยาวราช', 'g7', 2500, 'chinalantern', 'yaowarat', 'ถนนสายมังกร'),
    C('ประตูน้ำ', 'g7', 2600, 'hanger', 'pratunam', 'ตลาดเสื้อผ้า'),
    T('เกาะพีพี', 'พีพี', 'islet', 'phiphi', 'ทะเลใสอันดามัน'),
    C('สยาม', 'g8', 2800, 'bag', 'siam', 'ใจกลางช้อปปิ้ง'),
    { type: 'tax', name: 'ภาษี', icon: 'tax', art: 'tax' },
    C('สีลม', 'g8', 3000, 'tower', 'silom', 'ย่านธุรกิจ'),
    C('สุขุมวิท', 'g8', 3200, 'skyline', 'sukhumvit', 'ทำเลทองที่สุด')
];

SQUARES.forEach((sq, index) => {
    sq.index = index;
    sq.side = index % SIDE === 0 ? null : Math.floor(index / SIDE);
    if (!sq.short) sq.short = sq.name;
});

const CITY_SQUARES = SQUARES.filter(sq => sq.type === 'city').map(sq => sq.index);
const TOURIST_SQUARES = SQUARES.filter(sq => sq.type === 'tourist').map(sq => sq.index);
const OWNABLE = SQUARES.filter(sq => sq.type === 'city' || sq.type === 'tourist').map(sq => sq.index);
const GROUP_SQUARES = {};
CITY_SQUARES.forEach(i => { (GROUP_SQUARES[SQUARES[i].group] = GROUP_SQUARES[SQUARES[i].group] || []).push(i); });
// ช่องที่ซื้อได้ในแต่ละด้าน (ไม่นับมุม) — ไว้ตรวจผูกขาดแถว
const SIDE_SQUARES = [0, 1, 2, 3].map(side => OWNABLE.filter(i => SQUARES[i].side === side));

/** ราคาขั้นที่ level ของเมือง (level 0 = ที่ดิน) */
function levelCost(index, level) {
    const sq = SQUARES[index];
    if (!sq || !sq.price) return 0;
    if (sq.type === 'tourist') return level === 0 ? sq.price : 0;
    return Math.round(sq.price * LEVEL_COST[level]);
}

/** มูลค่ารวม (ที่ดิน + สิ่งปลูกสร้าง) ถึงขั้น level */
function valueAt(index, level) {
    let total = 0;
    for (let k = 0; k <= level; k += 1) total += levelCost(index, k);
    return total;
}

/**
 * การ์ดโอกาส 10 ใบ (สุ่มลำดับ วนใช้) · effect:
 *  forward{steps} · toStart · freeUpgrade · shield{kind: angel|half} · island · pay{amount} · gain{amount} · festival · tour
 */
const CARDS = [
    { id: 'k01', icon: 'arrow', title: 'เดินหน้า 3 ช่อง', effect: { type: 'forward', steps: 3 } },
    { id: 'k02', icon: 'go', title: 'กลับจุดเริ่ม', effect: { type: 'toStart' } },
    { id: 'k03', icon: 'hammer', title: 'อัปเกรดฟรี!', effect: { type: 'freeUpgrade' } },
    { id: 'k04', icon: 'angel', title: 'การ์ดนางฟ้า', effect: { type: 'shield', kind: 'angel' } },
    { id: 'k05', icon: 'ticket', title: 'ส่วนลดครึ่งราคา', effect: { type: 'shield', kind: 'half' } },
    { id: 'k06', icon: 'island', title: 'ไปเกาะร้าง!', effect: { type: 'island' } },
    { id: 'k07', icon: 'heart', title: 'ทำบุญ', effect: { type: 'pay', amount: 1000 } },
    { id: 'k08', icon: 'flag', title: 'จัดงานวัด!', effect: { type: 'festival' } },
    { id: 'k09', icon: 'coins', title: 'ขายของออนไลน์ปัง', effect: { type: 'gain', amount: 2000 } },
    { id: 'k10', icon: 'plane', title: 'ตั๋วทัวร์ทั่วไทย', effect: { type: 'tour' } }
];
const CARD_BY_ID = new Map(CARDS.map(card => [card.id, card]));

/** ข้อมูลกระดานแบบส่งให้ client (ไม่มีลำดับกองการ์ด) */
function publicBoard() {
    return {
        squares: SQUARES.map(sq => ({
            index: sq.index,
            type: sq.type,
            name: sq.name,
            short: sq.short,
            side: sq.side,
            group: sq.group || null,
            price: sq.price || null,
            icon: sq.icon,
            art: sq.art,
            blurb: sq.blurb || null,
            costs: sq.type === 'city' ? LEVEL_COST.map((_, k) => levelCost(sq.index, k)) : sq.type === 'tourist' ? [sq.price] : null,
            tolls: sq.type === 'city' ? TOLL_MULT.map(m => Math.round(sq.price * m)) : sq.type === 'tourist' ? TOUR_TOLL.slice() : null
        })),
        groups: GROUPS,
        groupSquares: GROUP_SQUARES,
        sideSquares: SIDE_SQUARES,
        touristSquares: TOURIST_SQUARES,
        levelNames: LEVEL_NAMES,
        startCash: START_CASH,
        salary: SALARY,
        islandFee: ISLAND_FEE,
        islandTurns: ISLAND_TURNS,
        tourFee: TOUR_FEE,
        taxRate: TAX_RATE,
        // รายชื่อการ์ดทั้งหมด (ข้อมูลคงที่ ไว้โชว์ในวิธีเล่น/เมนูทดสอบ) — ลำดับกองอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
        cards: CARDS.map(c => ({ id: c.id, title: c.title, icon: c.icon })),
        size: BOARD_SIZE
    };
}

module.exports = {
    START_CASH,
    SALARY,
    BOARD_SIZE,
    SIDE,
    START_SQUARE,
    ISLAND_SQUARE,
    FESTIVAL_SQUARE,
    TOUR_SQUARE,
    ISLAND_TURNS,
    ISLAND_FEE,
    TOUR_FEE,
    TAX_RATE,
    LEVEL_COST,
    TOLL_MULT,
    LEVEL_NAMES,
    TOUR_PRICE,
    TOUR_TOLL,
    GROUPS,
    SQUARES,
    OWNABLE,
    CITY_SQUARES,
    TOURIST_SQUARES,
    GROUP_SQUARES,
    SIDE_SQUARES,
    CARDS,
    CARD_BY_ID,
    levelCost,
    valueAt,
    publicBoard
};
