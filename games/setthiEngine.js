/**
 * เศรษฐี — เกมกระดานธีมเมืองไทยแนว "ทอย ซื้อ สร้าง ซื้อต่อ ผูกขาด" 2–4 คน (ใส่บอทได้)
 *
 * engine ล้วน: ไม่มี socket/IO · ทุกอย่างที่สุ่มรับ rng ได้ · เวลาอ่านผ่าน now() (เทสเปลี่ยนนาฬิกาได้ด้วย setClock)
 * เงินในเกมเป็นเงินสมมติ (฿) ไม่มีมูลค่าจริง ไม่เกี่ยวกับกระเป๋าเงินของเว็บ
 *
 * เฟสของตา (state.phase):
 *   roll     — คนที่ถึงตาทอยเต๋า (ติดเกาะ: จ่ายค่าออก หรือทอยหาดับเบิล)
 *   build    — ตกเมืองว่าง/เมืองตัวเอง/หลังซื้อต่อ: เลือกขั้นที่จะสร้างในแผ่นเดียว หรือผ่าน
 *   takeover — จ่ายค่าผ่านทางแล้ว: ซื้อต่อ 2 เท่าของมูลค่า หรือไม่ซื้อ
 *   pick     — แตะช่องบนกระดาน (ทัวร์วาร์ป · เทศกาล · โบนัสจุดเริ่ม · อัปเกรดฟรี)
 *   debt     — เงินไม่พอจ่าย: ขายช่องคืนครึ่งราคา (จ่ายอัตโนมัติเมื่อเงินพอ)
 *   finished
 * ไม่มีประมูล ไม่มีเทรด ไม่มีจำนอง — "ซื้อต่อ 2 เท่า" ใช้แทนทั้งหมด
 *
 * ชนะ: ผูกขาด 3 สี · ผูกขาดแถว (ทุกช่องที่ซื้อได้ในด้านเดียว) · ผูกขาดท่องเที่ยว (ครบ 4 แห่ง)
 *      คนอื่นล้มละลายหมด · หมดเวลา = ทรัพย์สินรวมสูงสุด
 *
 * บัญชีเงิน: ทุกบาทที่เข้า/ออกธนาคารนับใน state.ledger — ผลรวมเงินสดทุกคน = ทุนตั้งต้น + bankOut − bankIn เสมอ
 * จังหวะ: ทุก fx มี "เวลาฉาก" โดยประมาณ (fxCost) สะสมใน state.animUntil — บอทกับนาฬิกาตาเริ่มนับหลังฉากจบ
 * ลำดับกองการ์ด (state.deck) ไม่ส่งให้ client
 */

const B = require('./setthiBoard');

const MODE = 'setthi';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MINUTE_CHOICES = [0, 20, 30, 45, 60];
const DEFAULT_MINUTES = 30;

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const TURN_MS = num(env.SETTHI_TURN_MS, 30000);
const DECIDE_MS = num(env.SETTHI_DECIDE_MS, 20000);
const DEBT_MS = num(env.SETTHI_DEBT_MS, 40000);
const OFFLINE_GRACE_MS = num(env.SETTHI_OFFLINE_GRACE_MS, 10000);
const OFFLINE_TURN_MS = num(env.SETTHI_OFFLINE_TURN_MS, 5000);
const BOT_MS = num(env.SETTHI_BOT_MS, 1000); // บอทหยุดคิดให้เห็นก่อนตัดสินใจ
const ANIM_SCALE = num(env.SETTHI_ANIM_SCALE, 1); // เทสตั้ง 0 = ไม่รอฉาก
const MINUTE_MS = num(env.SETTHI_MINUTE_MS, 60000);
const FAST_FACTOR = 0.5; // ปุ่ม "เร่ง": ฉากเร็วขึ้น 2 เท่า บอทคิดสั้นลง
// กดค้างทอย: เข็มแกว่งขึ้นลง ยิ่งปล่อยใกล้ปลาย = ทอยแรง (แต้มรวมสูงขึ้นนิดหน่อย) · ปล่อยในช่องเขียว = โอกาสดับเบิลสูงขึ้น
const TAP_MS = 150;
const HOLD_EARLY_MS = 250;
const HOLD_LATE_MS = 50;
const HOLD_MAX_MS = 20000;
// เข็มกวาดจากเบาสุด→แรงสุด 1.6–2.0 วิ (cos ช้าลงที่ปลายทั้งสองข้าง จับปลายแรงได้)
const SWEEP_MIN_MS = 1600;
const SWEEP_MAX_MS = 2000;
const GREEN_DOUBLES = 0.2;
const GREEN_SPAWN = num(env.SETTHI_GREEN_SPAWN, 0.5);
const BOT_GREEN_HIT = 0.15;
const TOKEN_COLORS = ['#ef4b4b', '#3b82f6', '#22b573', '#a259e6'];
const TOKEN_COLOR_NAMES = ['แดง', 'ฟ้า', 'เขียว', 'ม่วง'];

let clock = () => Date.now();
function now() { return clock(); }
function setClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); }

// ลำดับเต๋าสำหรับเทสผ่านเซิร์ฟเวอร์จริงเท่านั้น (เช่น SETTHI_DICE="66,66,12") — ไม่ตั้ง = สุ่มปกติ
const DICE_SCRIPT = String(env.SETTHI_DICE || '').split(',').map(x => x.trim()).filter(x => /^[1-6][1-6]$/.test(x)).map(x => [Number(x[0]), Number(x[1])]);
let diceScriptIndex = 0;

// ---------- พื้นฐาน ----------

function shuffle(items, rng = Math.random) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function isBotId(playerId) { return String(playerId || '').startsWith('bot_'); }
function fmt(amount) { return '฿' + Math.round(Number(amount) || 0).toLocaleString('en-US'); }
function round10(x) { return Math.round(x / 10) * 10; }
function sqName(index) { const sq = B.SQUARES[index]; return sq ? sq.name : '?'; }
function isCity(i) { return !!(B.SQUARES[i] && B.SQUARES[i].type === 'city'); }
function isTourist(i) { return !!(B.SQUARES[i] && B.SQUARES[i].type === 'tourist'); }

function createInitialState() {
    return {
        mode: MODE,
        status: 'waiting',
        phase: 'lobby',
        players: [],
        seats: [],
        props: {},
        deck: [],
        config: null,
        turn: null,
        turnSeq: 0,
        phaseSeq: 0,
        phaseActor: null,
        phaseStartedAt: null,
        phaseMs: null,
        pending: null,
        pendingSeq: 0,
        phasePendingId: null,
        debts: [],
        debtSeq: 0,
        resume: null,
        festival: null,
        clock: null,
        ledger: null,
        firstSeat: 0,
        round: 1,
        outCount: 0,
        standings: null,
        winners: null,
        finishReason: null,
        monopoly: null,
        history: [],
        fx: [],
        fxSeq: 0,
        step: 0,
        lastActionAt: 0,
        lastActionKind: null,
        animUntil: 0,
        fast: false,
        rollHold: null,
        testDice: [],
        statsRecordedAt: null,
        returnLobbyEndsAt: null
    };
}

/** roomManager ใช้ตอนคนเข้าห้อง — ข้อมูลโปรไฟล์อย่างเดียว */
function createPlayerState(player) {
    return {
        playerId: player.playerId,
        name: player.playerName || player.name || 'ผู้เล่น',
        color: player.color || '#f5c86b',
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none'
    };
}

function resetRoomGame(room) {
    return { ...createInitialState(), players: (room.players || []).map(createPlayerState) };
}

function sanitizeMinutes(value) {
    return MINUTE_CHOICES.includes(Number(value)) ? Number(value) : DEFAULT_MINUTES;
}

function normalizeConfig(settings = {}) {
    return { minutes: sanitizeMinutes(settings.setthiMinutes), turnMs: TURN_MS, startCash: B.START_CASH, salary: B.SALARY };
}

function st(room) { return room.gameState; }
function seatOf(room, playerId) { return (st(room).seats || []).find(seat => seat.playerId === playerId) || null; }
function seatIndex(room, playerId) { return (st(room).seats || []).findIndex(seat => seat.playerId === playerId); }
function isActive(seat) { return !!(seat && !seat.bankrupt && !seat.left); }
function activeSeats(room) { return (st(room).seats || []).filter(isActive); }
function roomEntry(room, playerId) { return (room.players || []).find(p => p.playerId === playerId) || null; }

function isConnected(room, seat) {
    if (!seat || seat.left) return false;
    if (isBotId(seat.playerId)) return true;
    const entry = roomEntry(room, seat.playerId);
    return !!(entry && entry.socketId);
}

/** ออฟไลน์นานเกินช่วงผ่อนผัน (ไม่ใช่แค่รีเฟรชหน้า) → คืนเวลาที่เริ่มนับว่าหลุดจริง */
function offlineSince(room, playerId, at = now()) {
    if (!playerId || isBotId(playerId)) return null;
    const entry = roomEntry(room, playerId);
    if (!entry) return at - OFFLINE_GRACE_MS - 1;
    if (entry.socketId) return null;
    const since = Date.parse(entry.disconnectedAt || '') || 0;
    if (!since) return at - OFFLINE_GRACE_MS - 1;
    return since;
}

// ---------- ฉาก / จังหวะ ----------

/** เวลาฉากโดยประมาณ (ms ที่ความเร็วปกติ) — client ออกแบบฉากให้จบภายในเวลานี้ */
function fxCost(event) {
    switch (event.kind) {
        case 'turn': return 900;
        case 'dice': {
            if (event.streak >= 3) return 2400;
            const big = event.doubles || (event.d && event.d[0] + event.d[1] === 12);
            return big ? 2000 : 1300;
        }
        case 'move': return event.warp ? 1100 : 220 * (event.path || []).length + 300;
        case 'salary': return 250;
        case 'build': return event.to === 4 ? 2600 : 1400;
        case 'toll': return 1600;
        case 'shield': return 1200;
        case 'takeover': return 2600;
        case 'card': return 1900;
        case 'island': return 1800;
        case 'islandFree': return 900;
        case 'islandStay': return 800;
        case 'festival': return 1500;
        case 'tourReady': return 1000;
        case 'pay': case 'gain': case 'tax': return 1000;
        case 'sell': return 700;
        case 'decision': return 900;
        case 'monopoly': return 3800;
        case 'bankrupt': return 2400;
        case 'timeUp': return 1500;
        default: return 0;
    }
}

function animFactor(room) {
    return ANIM_SCALE * (st(room).fast ? FAST_FACTOR : 1);
}

function pushFx(room, event) {
    const state = st(room);
    const at = now();
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, at, ...event }].slice(-60);
    const cost = Math.round(fxCost(event) * animFactor(room));
    if (cost > 0) state.animUntil = Math.max(Number(state.animUntil) || 0, at) + cost;
}

function pushHistory(room, icon, text, kind = null) {
    st(room).history = [{ icon, text, kind, at: new Date(now()).toISOString() }, ...(st(room).history || [])].slice(0, 60);
}

function bumpStep(room) { st(room).step = (Number(st(room).step) || 0) + 1; }

function markAction(room, kind) {
    st(room).lastActionAt = now();
    st(room).lastActionKind = kind;
    bumpStep(room);
}

function cashMap(room, ids) {
    const out = {};
    ids.forEach(id => { const seat = seatOf(room, id); if (seat) out[id] = seat.cash; });
    return out;
}

// ---------- ทรัพย์สิน ----------

function prop(room, index) { return st(room).props[index] || null; }
function ownedSquares(room, playerId) { return B.OWNABLE.filter(i => (prop(room, i) || {}).owner === playerId); }

/** ตั้งเรื่องที่ต้องตัดสินใจ (มี id ใหม่ทุกครั้ง → เฟสใหม่ เวลาตาใหม่) */
function setPending(room, pending) {
    const state = st(room);
    state.pendingSeq = (Number(state.pendingSeq) || 0) + 1;
    state.pending = { ...pending, id: state.pendingSeq };
}
function ownerOf(room, i) { const p = prop(room, i); return p ? p.owner : null; }

function squareValue(room, i) {
    const p = prop(room, i);
    if (!p || !p.owner) return 0;
    return B.valueAt(i, p.level);
}

function touristCount(room, playerId) {
    return B.TOURIST_SQUARES.filter(i => prop(room, i).owner === playerId).length;
}

/** ค่าผ่านทางตอนนี้ (รวมเทศกาล ×2) */
function tollFor(room, i) {
    const p = prop(room, i);
    if (!p || !p.owner) return 0;
    const festival = st(room).festival === i ? 2 : 1;
    if (isTourist(i)) return B.TOUR_TOLL[Math.max(0, touristCount(room, p.owner) - 1)] * festival;
    return round10(B.SQUARES[i].price * B.TOLL_MULT[p.level]) * festival;
}

function takeoverPrice(room, i) { return squareValue(room, i) * 2; }

function netWorth(room, seat) {
    if (!seat || !isActive(seat)) return 0;
    return seat.cash + ownedSquares(room, seat.playerId).reduce((sum, i) => sum + squareValue(room, i), 0);
}

function propertyValue(room, playerId) {
    return ownedSquares(room, playerId).reduce((sum, i) => sum + squareValue(room, i), 0);
}

function sellValue(room, i) { return Math.floor(squareValue(room, i) / 2); }

/** เงินที่หาได้ทั้งหมดถ้าขายทุกช่องคืนครึ่งราคา */
function liquidationValue(room, seat) {
    if (!seat) return 0;
    return seat.cash + ownedSquares(room, seat.playerId).reduce((sum, i) => sum + sellValue(room, i), 0);
}

/** รอบแรก (ยังไม่เคยผ่านจุดเริ่ม) สร้างได้ถึงบ้าน · หลังจากนั้นถึงโรงแรม */
function levelCap(seat) { return seat && seat.laps >= 1 ? 3 : 1; }

function clearSquare(room, i) {
    const p = prop(room, i);
    p.owner = null;
    p.level = 0;
    if (st(room).festival === i) st(room).festival = null;
}

// ---------- ผูกขาด ----------

/** ช่องที่ผู้เล่นนี้ยัง "ได้มาได้": ว่าง หรือเมืองของคนอื่นที่ยังไม่ใช่แลนด์มาร์ก (ท่องเที่ยวซื้อต่อไม่ได้) */
function acquirable(room, i, playerId) {
    const p = prop(room, i);
    if (!p) return false;
    if (!p.owner) return true;
    if (p.owner === playerId) return true;
    return isCity(i) && p.level < 4;
}

function completeGroups(room, playerId) {
    return Object.keys(B.GROUP_SQUARES).filter(g => B.GROUP_SQUARES[g].every(i => prop(room, i).owner === playerId));
}

/** ผูกขาดแบบไหนสำเร็จแล้ว (หรือ null) */
function monopolyOf(room, playerId) {
    if (!playerId) return null;
    if (B.TOURIST_SQUARES.every(i => prop(room, i).owner === playerId)) return { type: 'tourist', squares: B.TOURIST_SQUARES.slice() };
    for (let side = 0; side < 4; side += 1) {
        if (B.SIDE_SQUARES[side].every(i => prop(room, i).owner === playerId)) return { type: 'line', side, squares: B.SIDE_SQUARES[side].slice() };
    }
    const groups = completeGroups(room, playerId);
    if (groups.length >= 3) return { type: 'color', groups: groups.slice(0, 3), squares: groups.slice(0, 3).flatMap(g => B.GROUP_SQUARES[g]) };
    return null;
}

const MONOPOLY_LABEL = { color: 'ผูกขาด 3 สี', line: 'ผูกขาดแถว', tourist: 'ผูกขาดท่องเที่ยว' };

/** ใครขาดอีก 1 ช่องจะผูกขาด — [{ playerId, type, squares: [ช่องที่ขาด], side?, group? }] */
function monopolyThreats(room) {
    const out = [];
    activeSeats(room).forEach(seat => {
        const id = seat.playerId;
        const missingOf = list => list.filter(i => prop(room, i).owner !== id);
        const tour = missingOf(B.TOURIST_SQUARES);
        if (tour.length === 1 && acquirable(room, tour[0], id)) out.push({ playerId: id, type: 'tourist', squares: tour });
        B.SIDE_SQUARES.forEach((list, side) => {
            const miss = missingOf(list);
            if (miss.length === 1 && acquirable(room, miss[0], id)) out.push({ playerId: id, type: 'line', side, squares: miss });
        });
        const complete = completeGroups(room, id);
        if (complete.length === 2) {
            const squares = [];
            Object.keys(B.GROUP_SQUARES).forEach(g => {
                const miss = missingOf(B.GROUP_SQUARES[g]);
                if (miss.length === 1 && acquirable(room, miss[0], id)) squares.push(miss[0]);
            });
            if (squares.length) out.push({ playerId: id, type: 'color', squares });
        }
    });
    return out;
}

function checkMonopoly(room, playerId) {
    const state = st(room);
    if (state.phase === 'finished') return true;
    const m = monopolyOf(room, playerId);
    if (!m) return false;
    const seat = seatOf(room, playerId);
    state.monopoly = { playerId, ...m };
    pushFx(room, { kind: 'monopoly', playerId, type: m.type, side: m.side, groups: m.groups, squares: m.squares });
    pushHistory(room, '👑', `${seat.name} ${MONOPOLY_LABEL[m.type]}! ชนะทันที`, 'monopoly');
    finishGame(room, `${seat.name} ${MONOPOLY_LABEL[m.type]}`, { winnerId: playerId });
    return true;
}

// ---------- เงิน ----------

function bankPays(room, seat, amount) {
    if (amount <= 0) return;
    seat.cash += amount;
    st(room).ledger.bankOut += amount;
}

function paysBank(room, seat, amount) {
    if (amount <= 0) return;
    if (seat.cash < amount) throw new Error('เงินไม่พอ');
    seat.cash -= amount;
    st(room).ledger.bankIn += amount;
}

function transfer(room, from, to, amount) {
    if (amount <= 0) return;
    if (from.cash < amount) throw new Error('เงินไม่พอ');
    from.cash -= amount;
    to.cash += amount;
}

function debtTotal(debt) { return debt.payees.reduce((sum, p) => sum + p.amount, 0); }

function settlePayees(room, payer, payees, reason, meta = {}) {
    payees.forEach(entry => {
        if (entry.amount <= 0) return;
        const target = entry.to ? seatOf(room, entry.to) : null;
        if (target && isActive(target)) {
            transfer(room, payer, target, entry.amount);
            pushFx(room, { kind: meta.kind === 'toll' ? 'toll' : 'pay', from: payer.playerId, to: target.playerId, amount: entry.amount, square: meta.square, festival: meta.festival, reason, cash: cashMap(room, [payer.playerId, target.playerId]) });
        } else {
            paysBank(room, payer, entry.amount);
            pushFx(room, { kind: meta.kind === 'tax' ? 'tax' : 'pay', from: payer.playerId, to: null, amount: entry.amount, square: meta.square, reason, cash: cashMap(room, [payer.playerId]) });
        }
    });
}

/**
 * เรียกเก็บเงิน: เงินสดพอ = จ่ายเลย · ไม่พอแต่ขายช่องแล้วพอ = เข้าคิวหนี้ · ขายหมดก็ไม่พอ = ล้มละลายทันที
 * payees: [{ to: playerId | null (ธนาคาร), amount }]
 */
function charge(room, payer, payees, reason, meta = {}) {
    const list = payees.filter(p => p.amount > 0).map(p => ({ to: p.to || null, amount: Math.round(p.amount) }));
    if (!list.length || !isActive(payer)) return 'none';
    const total = list.reduce((sum, p) => sum + p.amount, 0);
    if (payer.cash >= total) {
        settlePayees(room, payer, list, reason, meta);
        return 'paid';
    }
    if (liquidationValue(room, payer) >= total) {
        const state = st(room);
        state.debtSeq = (Number(state.debtSeq) || 0) + 1;
        state.debts.push({ id: state.debtSeq, debtorId: payer.playerId, payees: list, reason, meta });
        pushHistory(room, '⚠️', `${payer.name} เงินไม่พอจ่าย ${fmt(total)} — ต้องขายที่`, 'debt');
        pushFx(room, { kind: 'debt', playerId: payer.playerId, amount: total, reason });
        return 'debt';
    }
    declareBankrupt(room, payer, list, reason);
    return 'bankrupt';
}

// ---------- ล้มละลาย / จบเกม ----------

/** ล้มละลาย: ขายทุกช่องคืนธนาคารครึ่งราคา (ที่ดินกลับเป็นไม่มีเจ้าของ) เงินที่มีจ่ายเจ้าหนี้ตามลำดับ ที่เหลือเข้าธนาคาร */
function declareBankrupt(room, seat, payees = [], reason = '') {
    const state = st(room);
    if (!isActive(seat)) return;
    const owned = ownedSquares(room, seat.playerId);
    owned.forEach(i => {
        bankPays(room, seat, sellValue(room, i));
        clearSquare(room, i);
    });
    let cash = seat.cash;
    const paid = [];
    payees.forEach(entry => {
        const target = entry.to ? seatOf(room, entry.to) : null;
        if (!target || !isActive(target) || target === seat || cash <= 0) return;
        const part = Math.min(cash, entry.amount);
        transfer(room, seat, target, part);
        paid.push(target.playerId);
        cash -= part;
    });
    if (seat.cash > 0) paysBank(room, seat, seat.cash);
    const creditor = payees.length && payees[0].to ? payees[0].to : null;
    seat.bankrupt = true;
    seat.cash = 0;
    seat.island = 0;
    seat.tourPending = false;
    seat.shield = null;
    state.outCount = (Number(state.outCount) || 0) + 1;
    seat.outOrder = state.outCount;
    pushFx(room, { kind: 'bankrupt', playerId: seat.playerId, creditor, squares: owned, cash: cashMap(room, (state.seats || []).map(s => s.playerId)) });
    pushHistory(room, '💥', `${seat.name} ล้มละลาย${reason ? ' (' + reason + ')' : ''} — ที่ดินคืนธนาคาร`, 'bankrupt');
    removeFromPending(room, seat.playerId);
    bumpStep(room);
    if (activeSeats(room).length <= 1) {
        const last = activeSeats(room)[0];
        finishGame(room, last ? `${last.name} อยู่รอดคนสุดท้าย` : 'ทุกคนล้มละลาย', last ? { winnerId: last.playerId } : {});
    }
}

function removeFromPending(room, playerId) {
    const state = st(room);
    state.debts = (state.debts || []).filter(d => d.debtorId !== playerId).map(d => ({
        ...d,
        payees: d.payees.map(p => (p.to === playerId ? { to: null, amount: p.amount } : p))
    }));
    if (state.pending && state.turn && state.turn.playerId === playerId) state.pending = null;
}

function computeStandings(room, winnerId = null) {
    const state = st(room);
    const rows = (state.seats || []).map(seat => ({
        playerId: seat.playerId,
        name: seat.name,
        avatar: seat.avatar,
        avatarFrame: seat.avatarFrame,
        token: seat.token,
        tokenColor: seat.tokenColor,
        isBot: isBotId(seat.playerId),
        cash: isActive(seat) ? seat.cash : 0,
        netWorth: netWorth(room, seat),
        properties: isActive(seat) ? ownedSquares(room, seat.playerId).length : 0,
        landmarks: isActive(seat) ? ownedSquares(room, seat.playerId).filter(i => prop(room, i).level === 4).length : 0,
        bankrupt: !!seat.bankrupt,
        left: !!seat.left,
        outOrder: seat.outOrder || 0
    }));
    rows.sort((a, b) => {
        if (winnerId && (a.playerId === winnerId) !== (b.playerId === winnerId)) return a.playerId === winnerId ? -1 : 1;
        const aIn = !a.bankrupt && !a.left;
        const bIn = !b.bankrupt && !b.left;
        if (aIn !== bIn) return aIn ? -1 : 1;
        if (aIn) return b.netWorth - a.netWorth;
        if (a.left !== b.left) return a.left ? 1 : -1;
        return b.outOrder - a.outOrder;
    });
    let rank = 0;
    let prev = null;
    rows.forEach((row, i) => {
        const alive = !row.bankrupt && !row.left;
        const key = winnerId && row.playerId === winnerId ? 'W' : row.netWorth;
        if (!alive || prev === null || key !== prev) rank = i + 1;
        row.rank = rank;
        prev = alive ? key : null;
    });
    return rows;
}

/** opts.winnerId = ผู้ชนะแน่นอน (ผูกขาด/รอดคนสุดท้าย) · ไม่ใส่ = ทรัพย์สินรวมสูงสุดชนะ เท่ากันชนะร่วม */
function finishGame(room, reason, opts = {}) {
    const state = st(room);
    if (state.phase === 'finished') return state;
    state.phase = 'finished';
    state.status = 'setthi_finished';
    state.phaseMs = null;
    state.phaseActor = null;
    state.pending = null;
    state.debts = [];
    state.resume = null;
    state.rollHold = null;
    state.finishReason = reason || 'จบเกม';
    state.standings = computeStandings(room, opts.winnerId || null);
    const alive = state.standings.filter(r => !r.bankrupt && !r.left);
    if (opts.winnerId) {
        state.winners = alive.filter(r => r.playerId === opts.winnerId).map(r => ({ playerId: r.playerId, name: r.name, netWorth: r.netWorth }));
    } else {
        const best = alive.length ? alive[0].netWorth : null;
        state.winners = alive.filter(r => r.netWorth === best).map(r => ({ playerId: r.playerId, name: r.name, netWorth: r.netWorth }));
    }
    const names = state.winners.map(w => w.name).join(', ');
    pushHistory(room, '🏆', `${state.finishReason}${names ? ' — ' + names + ' ชนะ' : ''}`, 'finished');
    pushFx(room, { kind: 'finished', winners: state.winners.map(w => w.playerId), monopoly: state.monopoly ? state.monopoly.type : null });
    bumpStep(room);
    return state;
}

// ---------- เฟส / ตา ----------

function setPhase(room, phase, ms, actorId) {
    const state = st(room);
    state.phase = phase;
    state.phaseSeq = (Number(state.phaseSeq) || 0) + 1;
    state.phaseActor = actorId || null;
    state.phaseStartedAt = now();
    state.phaseMs = ms || null;
    state.rollHold = null;
    bumpStep(room);
}

/** หมดเวลาตา = หลังฉากจบ + เวลาตา (คนไม่โดนนับเวลาระหว่างดูฉาก) */
function phaseDeadline(room) {
    const state = st(room);
    if (!state.phaseMs) return null;
    return Math.max(Number(state.phaseStartedAt) || 0, Number(state.animUntil) || 0) + state.phaseMs;
}

function checkClock(room) {
    const state = st(room);
    const c = state.clock;
    if (!c || !c.endsAt || c.timeUp || state.phase === 'finished') return false;
    if (now() < c.endsAt) return false;
    c.timeUp = true;
    pushHistory(room, '⏰', 'หมดเวลา! เล่นให้ครบรอบนี้ แล้วนับทรัพย์สิน', 'timeup');
    pushFx(room, { kind: 'timeUp' });
    bumpStep(room);
    return true;
}

function startTurn(room, index) {
    const state = st(room);
    const seat = state.seats[index];
    state.turnSeq = (Number(state.turnSeq) || 0) + 1;
    state.turn = { playerId: seat.playerId, seq: state.turnSeq, doublesStreak: 0, canRollAgain: false, hasRolled: false, lastRoll: null, startedAt: now() };
    state.pending = null;
    state.resume = null;
    pushFx(room, { kind: 'turn', playerId: seat.playerId, round: state.round });
    if (seat.tourPending) {
        setPending(room, { type: 'pick', purpose: 'tour', playerId: seat.playerId });
        proceed(room);
        return;
    }
    setPhase(room, 'roll', TURN_MS, seat.playerId);
}

function advanceTurn(room) {
    const state = st(room);
    if (state.phase === 'finished') return;
    const n = state.seats.length;
    const from = Math.max(0, seatIndex(room, state.turn ? state.turn.playerId : null));
    let next = -1;
    for (let j = 1; j <= n; j += 1) {
        const k = (from + j) % n;
        if (isActive(state.seats[k])) { next = k; break; }
    }
    if (next < 0) { finishGame(room, 'ไม่มีผู้เล่นเหลือ'); return; }
    const rel = i => ((i - state.firstSeat) % n + n) % n;
    const wrapped = rel(next) <= rel(from);
    checkClock(room);
    if (wrapped) {
        if (state.clock && state.clock.timeUp) { finishGame(room, 'หมดเวลา — นับทรัพย์สินรวม'); return; }
        state.round = (Number(state.round) || 1) + 1;
    }
    startTurn(room, next);
}

function continueTurn(room) {
    const state = st(room);
    if (state.phase === 'finished') return;
    const turn = state.turn;
    const seat = turn ? seatOf(room, turn.playerId) : null;
    if (!seat || !isActive(seat)) { advanceTurn(room); return; }
    if (!turn.hasRolled || (turn.canRollAgain && !seat.island)) {
        setPhase(room, 'roll', TURN_MS, seat.playerId);
        return;
    }
    turn.canRollAgain = false;
    advanceTurn(room);
}

/** ยังตัดสินใจเรื่องนี้ได้อยู่ไหม (เงินอาจหมดไปตอนจ่ายหนี้) */
function pendingValid(room, pending) {
    const seat = seatOf(room, pending.playerId);
    if (!isActive(seat)) return false;
    if (pending.type === 'build') {
        return buildChoices(room, seat, pending.square, pending.mode).options.some(o => {
            if (o.locked || o.built) return false;
            const cost = buildCost(room, seat, pending.square, pending.mode, o.level);
            return cost !== null && cost <= seat.cash;
        });
    }
    if (pending.type === 'takeover') {
        const p = prop(room, pending.square);
        return !!(p && p.owner && p.owner !== seat.playerId && isCity(pending.square) && p.level < 4 && seat.cash >= takeoverPrice(room, pending.square));
    }
    if (pending.type === 'pick') return pickOptions(room, seat, pending.purpose).length > 0;
    return false;
}

/** ทำงานค้างตามลำดับ: หนี้ → เรื่องที่ต้องตัดสินใจ → งานต่อเนื่อง → ตาต่อไป */
function proceed(room) {
    const state = st(room);
    for (let guard = 0; guard < 60; guard += 1) {
        if (state.phase === 'finished') return;
        if (state.debts.length) {
            const debt = state.debts[0];
            const seat = seatOf(room, debt.debtorId);
            if (!isActive(seat)) { state.debts.shift(); continue; }
            const total = debtTotal(debt);
            if (seat.cash >= total) {
                state.debts.shift();
                settlePayees(room, seat, debt.payees, debt.reason, debt.meta || {});
                pushHistory(room, '💸', `${seat.name} จ่าย ${fmt(total)} แล้ว`, 'debtPaid');
                continue;
            }
            if (state.phase !== 'debt' || state.phaseActor !== seat.playerId) setPhase(room, 'debt', DEBT_MS, seat.playerId);
            return;
        }
        if (state.pending) {
            const pending = state.pending;
            if (!pendingValid(room, pending)) {
                if (pending.type === 'pick' && pending.purpose === 'tour') {
                    const seat = seatOf(room, pending.playerId);
                    if (seat) seat.tourPending = false;
                }
                state.pending = null;
                continue;
            }
            if (state.phase !== pending.type || state.phaseActor !== pending.playerId || state.phasePendingId !== pending.id) {
                setPhase(room, pending.type, DECIDE_MS, pending.playerId);
                state.phasePendingId = pending.id;
            }
            return;
        }
        if (state.resume) {
            const job = state.resume;
            state.resume = null;
            const seat = seatOf(room, job.playerId);
            if (isActive(seat) && job.type === 'move') moveSteps(room, seat, job.steps, job.opts || {});
            continue;
        }
        continueTurn(room);
        return;
    }
}

// ---------- เดิน / ตกช่อง ----------

/**
 * เต๋า 2 ลูก ลูกละ 1–6 เสมอ · bias = { power: 0..1, green: bool } จากการกดค้าง
 *  - แรง: แต่ละลูกมีโอกาส = power ที่จะทอยซ้ำแล้วเอาค่าที่สูงกว่า
 *  - ช่องเขียว: ถ้ายังไม่ดับเบิล เปลี่ยนลูกที่สองให้เท่าลูกแรกด้วยโอกาส 20% (ดับเบิล ~1/6 → ~1/3)
 */
function biasedDice(rng, bias = null) {
    const die = () => 1 + Math.floor(rng() * 6);
    let a = die();
    let b = die();
    const power = bias ? Math.max(0, Math.min(1, Number(bias.power) || 0)) : 0;
    if (power > 0) {
        if (rng() < power) a = Math.max(a, die());
        if (rng() < power) b = Math.max(b, die());
    }
    if (bias && bias.green && a !== b && rng() < GREEN_DOUBLES) b = a;
    return [a, b];
}

/** ตำแหน่งเข็ม (0..1) ณ เวลาที่กดค้าง — สูตรเดียวกับที่ client วาด */
function meterAt(hold, elapsedMs) {
    const t = Math.max(0, Number(elapsedMs) || 0);
    if (!hold || t < TAP_MS) return { pos: 0, power: 0, green: false, greenOn: false, tap: true };
    const pos = (1 - Math.cos((2 * Math.PI * t) / hold.period)) / 2;
    const g = hold.green;
    const greenOn = !!(g && t >= g.appearAt && t <= g.until);
    const green = greenOn && Math.abs(pos - g.center) <= g.width / 2;
    return { pos, power: pos, green, greenOn, tap: false };
}

/**
 * ตารางช่องเขียวของการกดครั้งนี้ (หรือ null): โผล่ 0.6–0.8 วิ ในช่วงที่เข็มกำลังจะวิ่งผ่านกลางช่องพอดี
 * (เข็มกวาดขึ้นหรือลงครั้งที่ 1–3) → มีเวลาเห็นแล้วตัดสินใจปล่อยทัน
 */
function greenSchedule(rng, period) {
    if (rng() >= GREEN_SPAWN) return null;
    const center = Math.round((0.3 + rng() * 0.55) * 1000) / 1000;
    const width = Math.round((0.1 + rng() * 0.05) * 1000) / 1000;
    const life = Math.round(600 + rng() * 200);
    // เวลาที่เข็มผ่าน center: pos(t) = (1 − cos(2πt/period)) / 2
    const base = (period / (2 * Math.PI)) * Math.acos(1 - 2 * center);
    const crossings = [base, period - base, period + base].filter(t => t - life * 0.55 >= 350);
    const cross = crossings[Math.min(crossings.length - 1, Math.floor(rng() * crossings.length))];
    const appearAt = Math.round(cross - life * 0.55);
    return { appearAt, until: appearAt + life, center, width };
}

function nextDice(room, rng, bias = null) {
    const state = st(room);
    if (Array.isArray(state.testDice) && state.testDice.length) return state.testDice.shift();
    if (diceScriptIndex < DICE_SCRIPT.length) {
        const pair = DICE_SCRIPT[diceScriptIndex];
        diceScriptIndex += 1;
        return pair.slice();
    }
    return biasedDice(rng, bias);
}

function pathBetween(from, steps) {
    const path = [];
    const dir = steps >= 0 ? 1 : -1;
    for (let i = 1; i <= Math.abs(steps); i += 1) path.push(((from + dir * i) % B.BOARD_SIZE + B.BOARD_SIZE) % B.BOARD_SIZE);
    return path;
}

function moveSteps(room, seat, steps, opts = {}) {
    const N = B.BOARD_SIZE;
    const from = seat.pos;
    const to = ((from + steps) % N + N) % N;
    const passGo = steps > 0 && from + steps >= N;
    seat.pos = to;
    pushFx(room, { kind: 'move', playerId: seat.playerId, from, to, steps, path: pathBetween(from, steps), passGo, warp: !!opts.warp });
    if (passGo) paySalary(room, seat);
    land(room, seat, opts);
}

function moveForwardTo(room, seat, target, opts = {}) {
    const N = B.BOARD_SIZE;
    const steps = ((target - seat.pos) % N + N) % N;
    moveSteps(room, seat, steps === 0 ? N : steps, opts);
}

function paySalary(room, seat) {
    seat.laps = (Number(seat.laps) || 0) + 1;
    bankPays(room, seat, B.SALARY);
    pushFx(room, { kind: 'salary', playerId: seat.playerId, amount: B.SALARY, laps: seat.laps, cash: cashMap(room, [seat.playerId]) });
    pushHistory(room, '💰', `${seat.name} ผ่านจุดเริ่ม +${fmt(B.SALARY)}`, 'salary');
}

function sendToIsland(room, seat, reason) {
    const state = st(room);
    const from = seat.pos;
    seat.pos = B.ISLAND_SQUARE;
    seat.island = B.ISLAND_TURNS;
    if (state.turn && state.turn.playerId === seat.playerId) state.turn.canRollAgain = false;
    pushFx(room, { kind: 'island', playerId: seat.playerId, from, reason });
    pushHistory(room, '🏝️', `${seat.name} ติดเกาะร้าง`, 'island');
}

function land(room, seat, opts = {}) {
    const state = st(room);
    if (!isActive(seat) || state.phase === 'finished') return;
    const index = seat.pos;
    const sq = B.SQUARES[index];
    const depth = opts.depth || 0;
    switch (sq.type) {
        case 'start':
            if (pickOptions(room, seat, 'startBonus').length) setPending(room, { type: 'pick', purpose: 'startBonus', playerId: seat.playerId });
            return;
        case 'island':
            sendToIsland(room, seat, 'landed');
            return;
        case 'festival':
            if (ownedSquares(room, seat.playerId).length) setPending(room, { type: 'pick', purpose: 'festival', playerId: seat.playerId });
            return;
        case 'tour':
            seat.tourPending = true;
            if (state.turn && state.turn.playerId === seat.playerId) state.turn.canRollAgain = false;
            pushFx(room, { kind: 'tourReady', playerId: seat.playerId });
            pushHistory(room, '✈️', `${seat.name} ได้ตั๋วทัวร์ — ตาหน้าเลือกไปช่องไหนก็ได้`, 'tour');
            return;
        case 'chance':
            if (depth < 3) drawCard(room, seat, { depth, rng: opts.rng });
            return;
        case 'tax': {
            const amount = round10(propertyValue(room, seat.playerId) * B.TAX_RATE);
            if (amount <= 0) {
                pushFx(room, { kind: 'tax', from: seat.playerId, to: null, amount: 0, square: index, cash: cashMap(room, [seat.playerId]) });
                return;
            }
            pushHistory(room, '🧾', `${seat.name} จ่ายภาษี ${fmt(amount)}`, 'tax');
            charge(room, seat, [{ to: null, amount }], 'ภาษี', { kind: 'tax', square: index });
            return;
        }
        case 'city':
        case 'tourist': {
            const p = prop(room, index);
            if (!p.owner) {
                if (seat.cash >= B.levelCost(index, 0)) setPending(room, { type: 'build', mode: 'buy', square: index, playerId: seat.playerId });
                return;
            }
            if (p.owner === seat.playerId) {
                if (isCity(index)) setPending(room, { type: 'build', mode: 'upgrade', square: index, playerId: seat.playerId });
                return;
            }
            const owner = seatOf(room, p.owner);
            if (!isActive(owner)) return;
            let toll = tollFor(room, index);
            const festival = state.festival === index;
            if (seat.shield && toll > 0) {
                const kind = seat.shield;
                const saved = kind === 'angel' ? toll : toll - round10(toll / 2);
                toll -= saved;
                seat.shield = null;
                pushFx(room, { kind: 'shield', playerId: seat.playerId, shield: kind, square: index, saved });
                pushHistory(room, kind === 'angel' ? '😇' : '🎟️', `${seat.name} ใช้${kind === 'angel' ? 'การ์ดนางฟ้า' : 'ส่วนลด'} ประหยัด ${fmt(saved)}`, 'shield');
            }
            if (toll > 0) {
                pushHistory(room, '🛣️', `${seat.name} จ่ายค่าผ่านทาง ${fmt(toll)} ให้ ${owner.name}`, 'toll');
                const result = charge(room, seat, [{ to: owner.playerId, amount: toll }], 'ค่าผ่านทาง', { kind: 'toll', square: index, festival });
                if (result === 'bankrupt') return;
            }
            if (isCity(index) && p.level < 4 && isActive(seat)) setPending(room, { type: 'takeover', square: index, playerId: seat.playerId });
            return;
        }
        default:
    }
}

function publicCard(card) {
    return { id: card.id, title: card.title, icon: card.icon, type: card.effect.type, kind: card.effect.kind || null, amount: card.effect.amount || null, steps: card.effect.steps || null };
}

function drawCard(room, seat, opts = {}) {
    const state = st(room);
    if (!state.deck.length) state.deck = shuffle(B.CARDS.map(c => c.id), opts.rng || Math.random);
    const cardId = state.deck.shift();
    const card = B.CARD_BY_ID.get(cardId);
    pushFx(room, { kind: 'card', playerId: seat.playerId, card: publicCard(card) });
    pushHistory(room, '❓', `${seat.name} เปิดการ์ด: ${card.title}`, 'card');
    const depth = (opts.depth || 0) + 1;
    const fx = card.effect;
    switch (fx.type) {
        case 'forward':
            moveSteps(room, seat, fx.steps, { depth, rng: opts.rng });
            break;
        case 'toStart':
            moveForwardTo(room, seat, B.START_SQUARE, { depth, rng: opts.rng });
            break;
        case 'tour':
            moveForwardTo(room, seat, B.TOUR_SQUARE, { depth, rng: opts.rng });
            break;
        case 'island':
            sendToIsland(room, seat, 'card');
            break;
        case 'freeUpgrade':
            if (pickOptions(room, seat, 'freeUpgrade').length) setPending(room, { type: 'pick', purpose: 'freeUpgrade', playerId: seat.playerId });
            break;
        case 'festival':
            if (ownedSquares(room, seat.playerId).length) setPending(room, { type: 'pick', purpose: 'festival', playerId: seat.playerId });
            break;
        case 'shield':
            seat.shield = fx.kind;
            break;
        case 'gain':
            bankPays(room, seat, fx.amount);
            pushFx(room, { kind: 'gain', playerId: seat.playerId, amount: fx.amount, reason: card.title, cash: cashMap(room, [seat.playerId]) });
            break;
        case 'pay':
            charge(room, seat, [{ to: null, amount: fx.amount }], card.title);
            break;
        default:
    }
}

// ---------- ตัวเลือกการสร้าง / แตะช่อง ----------

/**
 * ตัวเลือกในแผ่นสร้าง: ทุกขั้นของช่องนี้ พร้อมสถานะ built (มีแล้ว) / locked (เหตุผล) / ราคาของขั้นนั้น
 * mode: buy (ตกที่ว่าง) · upgrade (ตกเมืองตัวเอง) · afterTakeover (เพิ่งซื้อต่อ — ยังสร้างแลนด์มาร์กไม่ได้)
 */
function buildChoices(room, seat, i, mode) {
    const sq = B.SQUARES[i];
    const p = prop(room, i);
    const options = [];
    if (!sq || !p || !seat) return { current: -1, cap: 0, options };
    const cap = levelCap(seat);
    if (sq.type === 'tourist') {
        if (mode === 'buy' && !p.owner) options.push({ level: 0, cost: B.levelCost(i, 0), built: false, locked: null });
        return { current: p.owner ? 0 : -1, cap: 0, options };
    }
    const current = mode === 'buy' ? -1 : p.level;
    if (mode === 'buy' && p.owner) return { current: p.level, cap, options };
    if (mode !== 'buy' && p.owner !== seat.playerId) return { current, cap, options };
    for (let level = 0; level <= 4; level += 1) {
        const built = level <= current;
        let locked = null;
        if (!built) {
            if (level === 4) {
                if (mode !== 'upgrade') locked = mode === 'buy' ? 'hotel' : 'later';
                else if (current < 3) locked = 'hotel';
            } else if (level > cap) {
                locked = 'lap';
            }
        }
        options.push({ level, cost: B.levelCost(i, level), built, locked });
    }
    // ตกเมืองตัวเองที่มีโรงแรม: เลือกได้แค่แลนด์มาร์ก · ยังไม่มีโรงแรม: แลนด์มาร์กล็อก
    return { current, cap, options };
}

function buildCost(room, seat, i, mode, level) {
    const choices = buildChoices(room, seat, i, mode);
    let cost = 0;
    for (let k = choices.current + 1; k <= level; k += 1) {
        const opt = choices.options.find(o => o.level === k);
        if (!opt || opt.locked) return null;
        cost += opt.cost;
    }
    return cost;
}

function startBonusCost(room, i) {
    const p = prop(room, i);
    return Math.round(B.levelCost(i, p.level + 1) * (1 - B.START_BONUS_DISCOUNT));
}

/** ช่องที่แตะได้ในเฟส pick */
function pickOptions(room, seat, purpose) {
    if (!isActive(seat)) return [];
    if (purpose === 'tour') {
        if (seat.cash < B.TOUR_FEE) return [];
        return B.SQUARES.map(sq => sq.index).filter(i => i !== B.TOUR_SQUARE);
    }
    if (purpose === 'festival') return ownedSquares(room, seat.playerId);
    if (purpose === 'startBonus' || purpose === 'freeUpgrade') {
        const cap = Math.min(3, levelCap(seat));
        return ownedSquares(room, seat.playerId).filter(i => {
            if (!isCity(i) || prop(room, i).level >= cap) return false;
            return purpose === 'freeUpgrade' || seat.cash >= startBonusCost(room, i);
        });
    }
    return [];
}

// ---------- ตรวจคำสั่ง ----------

function assertPlaying(room) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished' || state.phase === 'lobby') throw new Error('เกมยังไม่เริ่มหรือจบแล้ว');
}

function assertActor(room, playerId, phases, ctx) {
    assertPlaying(room);
    const state = st(room);
    const list = Array.isArray(phases) ? phases : [phases];
    if (!list.includes(state.phase)) throw new Error('ตอนนี้ทำแบบนี้ไม่ได้');
    if (state.phaseActor !== playerId) throw new Error('ยังไม่ถึงตาคุณ');
    if (ctx && ctx.seq !== undefined && ctx.seq !== null && Number(ctx.seq) !== Number(state.phaseSeq)) throw new Error('สถานะเปลี่ยนไปแล้ว ลองอีกครั้ง');
    const seat = seatOf(room, playerId);
    if (!isActive(seat)) throw new Error('คุณไม่ได้อยู่ในเกมแล้ว');
    return seat;
}

function decision(room, seat, choice, extra = {}) {
    pushFx(room, { kind: 'decision', playerId: seat.playerId, choice, ...extra });
}

// ---------- คำสั่งผู้เล่น ----------

function rollDice(room, playerId, ctx = null, rng = Math.random, bias = null) {
    const seat = assertActor(room, playerId, 'roll', ctx);
    const state = st(room);
    const turn = state.turn;
    state.rollHold = null;
    const [a, b] = nextDice(room, rng, bias);
    const throwInfo = bias ? { power: Math.round((bias.power || 0) * 100) / 100, perfect: !!bias.green } : {};
    const doubles = a === b;
    const total = a + b;
    turn.lastRoll = [a, b];
    turn.hasRolled = true;
    turn.canRollAgain = false;

    if (seat.island > 0) {
        pushFx(room, { kind: 'dice', playerId, d: [a, b], doubles, purpose: 'island', ...throwInfo });
        if (doubles) {
            seat.island = 0;
            pushFx(room, { kind: 'islandFree', playerId, how: 'doubles' });
            pushHistory(room, '🎲', `${seat.name} ทอยดับเบิล หนีออกจากเกาะ!`, 'islandFree');
            moveSteps(room, seat, total, { rng });
        } else {
            seat.island -= 1;
            if (seat.island <= 0) {
                seat.island = 0;
                pushFx(room, { kind: 'islandFree', playerId, how: 'served' });
                pushHistory(room, '🔓', `${seat.name} ครบ ${B.ISLAND_TURNS} ตา ออกจากเกาะ`, 'islandFree');
                moveSteps(room, seat, total, { rng });
            } else {
                pushFx(room, { kind: 'islandStay', playerId, left: seat.island, d: [a, b] });
                pushHistory(room, '🏝️', `${seat.name} ยังติดเกาะ (เหลือ ${seat.island} ตา)`, 'islandStay');
            }
        }
        markAction(room, 'roll');
        proceed(room);
        return state;
    }

    if (doubles) turn.doublesStreak += 1;
    pushFx(room, { kind: 'dice', playerId, d: [a, b], doubles, streak: doubles ? turn.doublesStreak : 0, ...throwInfo });
    if (doubles && turn.doublesStreak >= 3) {
        sendToIsland(room, seat, 'triple');
        markAction(room, 'roll');
        proceed(room);
        return state;
    }
    turn.canRollAgain = doubles;
    pushHistory(room, '🎲', `${seat.name} ทอย ${a}+${b} = ${total}${doubles ? ' ดับเบิล!' : ''}`, 'roll');
    moveSteps(room, seat, total, { rng });
    markAction(room, 'roll');
    proceed(room);
    return state;
}

/** เริ่มกดค้าง: สุ่มคาบเข็มกับช่องเขียวของการกดครั้งนี้ คืนค่าให้คนทอยคนเดียว */
function startRollHold(room, playerId, ctx = null, rng = Math.random) {
    assertActor(room, playerId, 'roll', ctx);
    const state = st(room);
    const period = Math.round(SWEEP_MIN_MS * 2 + rng() * (SWEEP_MAX_MS - SWEEP_MIN_MS) * 2); // ขึ้นสุด→ลงสุด = ครึ่งคาบ
    const hold = { playerId, phaseSeq: state.phaseSeq, startedAt: now(), period, green: greenSchedule(rng, period) };
    state.rollHold = hold;
    state.lastActionAt = now();
    return { period: hold.period, green: hold.green ? { ...hold.green } : null, tapMs: TAP_MS };
}

/** ปล่อย: ใช้เวลาจาก client ถ้าอยู่ในช่วงที่เชื่อได้ ไม่งั้นใช้เวลาฝั่งเซิร์ฟเวอร์ */
function releaseRoll(room, playerId, elapsedMs, ctx = null, rng = Math.random) {
    assertActor(room, playerId, 'roll', ctx);
    const state = st(room);
    const hold = state.rollHold;
    if (!hold || hold.playerId !== playerId || hold.phaseSeq !== state.phaseSeq) throw new Error('ยังไม่ได้กดค้างทอย');
    const serverElapsed = Math.min(HOLD_MAX_MS, now() - hold.startedAt);
    const claimed = Number(elapsedMs);
    const used = Number.isFinite(claimed) && claimed >= serverElapsed - HOLD_EARLY_MS && claimed <= serverElapsed + HOLD_LATE_MS ? claimed : serverElapsed;
    const m = meterAt(hold, used);
    return rollDice(room, playerId, null, rng, m.tap ? null : { power: m.power, green: m.green });
}

function cancelRollHold(room, playerId) {
    const state = st(room);
    if (state && state.rollHold && state.rollHold.playerId === playerId) {
        state.rollHold = null;
        return true;
    }
    return false;
}

function payIsland(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'roll', ctx);
    if (!seat.island) throw new Error('คุณไม่ได้ติดเกาะ');
    if (seat.cash < B.ISLAND_FEE) throw new Error(`ต้องมีเงิน ${fmt(B.ISLAND_FEE)}`);
    paysBank(room, seat, B.ISLAND_FEE);
    seat.island = 0;
    pushFx(room, { kind: 'pay', from: playerId, to: null, amount: B.ISLAND_FEE, reason: 'ค่าเรือออกจากเกาะ', cash: cashMap(room, [playerId]) });
    pushFx(room, { kind: 'islandFree', playerId, how: 'fee' });
    pushHistory(room, '⛵', `${seat.name} จ่าย ${fmt(B.ISLAND_FEE)} นั่งเรือออกจากเกาะ`, 'islandFree');
    markAction(room, 'islandFee');
    setPhase(room, 'roll', TURN_MS, playerId);
    return st(room);
}

/** สร้าง/ซื้อถึงขั้น level ในแผ่นเดียว (ซื้อที่ดิน + สร้างหลายขั้นได้ในครั้งเดียว) */
function buildTo(room, playerId, level, ctx = null) {
    const seat = assertActor(room, playerId, 'build', ctx);
    const state = st(room);
    const pending = state.pending;
    if (!pending || pending.type !== 'build') throw new Error('ไม่มีอะไรให้สร้าง');
    const i = pending.square;
    const target = Math.floor(Number(level));
    const choices = buildChoices(room, seat, i, pending.mode);
    if (!Number.isInteger(target) || target <= choices.current || !choices.options.some(o => o.level === target)) throw new Error('เลือกขั้นไม่ถูกต้อง');
    const cost = buildCost(room, seat, i, pending.mode, target);
    if (cost === null) throw new Error('ขั้นนี้ยังสร้างไม่ได้');
    if (seat.cash < cost) throw new Error(`เงินไม่พอ (ต้องใช้ ${fmt(cost)})`);
    paysBank(room, seat, cost);
    const p = prop(room, i);
    const buying = !p.owner;
    p.owner = playerId;
    p.level = isCity(i) ? target : 0;
    state.pending = null;
    pushFx(room, { kind: 'build', playerId, square: i, from: choices.current, to: p.level, cost, mode: pending.mode, cash: cashMap(room, [playerId]) });
    pushHistory(room, p.level === 4 ? '🏛️' : buying ? '🏷️' : '🏗️', `${seat.name} ${buying ? 'ซื้อ' : 'สร้าง'}${sqName(i)}${isCity(i) ? ' (' + B.LEVEL_NAMES[p.level] + ')' : ''} ${fmt(cost)}`, p.level === 4 ? 'landmark' : 'build');
    markAction(room, 'build');
    if (buying && checkMonopoly(room, playerId)) return state;
    proceed(room);
    return state;
}

function passBuild(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'build', ctx);
    const state = st(room);
    decision(room, seat, 'pass', { square: state.pending ? state.pending.square : null, about: 'build' });
    state.pending = null;
    markAction(room, 'pass');
    proceed(room);
    return state;
}

function acceptTakeover(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'takeover', ctx);
    const state = st(room);
    const pending = state.pending;
    const i = pending.square;
    const p = prop(room, i);
    if (!isCity(i) || p.level >= 4) throw new Error('แลนด์มาร์กซื้อต่อไม่ได้');
    const price = takeoverPrice(room, i);
    if (seat.cash < price) throw new Error(`เงินไม่พอ (ต้องใช้ ${fmt(price)})`);
    const owner = seatOf(room, p.owner);
    transfer(room, seat, owner, price);
    p.owner = playerId;
    state.pending = null;
    pushFx(room, { kind: 'takeover', playerId, from: owner.playerId, square: i, price, level: p.level, cash: cashMap(room, [playerId, owner.playerId]) });
    pushHistory(room, '🤝', `${seat.name} ซื้อต่อ${sqName(i)}จาก ${owner.name} ${fmt(price)}`, 'takeover');
    markAction(room, 'takeover');
    if (checkMonopoly(room, playerId)) return state;
    setPending(room, { type: 'build', mode: 'afterTakeover', square: i, playerId });
    proceed(room);
    return state;
}

function declineTakeover(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'takeover', ctx);
    const state = st(room);
    decision(room, seat, 'pass', { square: state.pending ? state.pending.square : null, about: 'takeover' });
    state.pending = null;
    markAction(room, 'pass');
    proceed(room);
    return state;
}

function pickSquare(room, playerId, square, ctx = null) {
    const seat = assertActor(room, playerId, 'pick', ctx);
    const state = st(room);
    const pending = state.pending;
    const i = Number(square);
    if (!Number.isInteger(i) || !pickOptions(room, seat, pending.purpose).includes(i)) throw new Error('เลือกช่องนี้ไม่ได้');
    state.pending = null;
    switch (pending.purpose) {
        case 'tour': {
            paysBank(room, seat, B.TOUR_FEE);
            seat.tourPending = false;
            state.turn.hasRolled = true;
            state.turn.canRollAgain = false;
            pushFx(room, { kind: 'pay', from: playerId, to: null, amount: B.TOUR_FEE, reason: 'ค่าทัวร์', cash: cashMap(room, [playerId]) });
            pushHistory(room, '✈️', `${seat.name} บินไป${sqName(i)}`, 'tour');
            markAction(room, 'tour');
            const steps = ((i - seat.pos) % B.BOARD_SIZE + B.BOARD_SIZE) % B.BOARD_SIZE;
            moveSteps(room, seat, steps, { warp: true });
            break;
        }
        case 'festival': {
            const prev = state.festival;
            state.festival = i;
            pushFx(room, { kind: 'festival', playerId, square: i, prev });
            pushHistory(room, '🎉', `${seat.name} จัดงานวัดที่${sqName(i)} ค่าผ่านทาง ×2`, 'festival');
            markAction(room, 'festival');
            break;
        }
        case 'startBonus':
        case 'freeUpgrade': {
            const p = prop(room, i);
            const cost = pending.purpose === 'startBonus' ? startBonusCost(room, i) : 0;
            if (cost) paysBank(room, seat, cost);
            const from = p.level;
            p.level += 1;
            pushFx(room, { kind: 'build', playerId, square: i, from, to: p.level, cost, mode: pending.purpose, cash: cashMap(room, [playerId]) });
            pushHistory(room, '🏗️', `${seat.name} อัปเกรด${sqName(i)}เป็น${B.LEVEL_NAMES[p.level]}${cost ? ' ' + fmt(cost) : ' ฟรี'}`, 'build');
            markAction(room, 'upgrade');
            break;
        }
        default:
    }
    proceed(room);
    return state;
}

function skipPick(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'pick', ctx);
    const state = st(room);
    const pending = state.pending;
    if (pending.purpose === 'tour') seat.tourPending = false;
    decision(room, seat, 'pass', { about: pending.purpose });
    state.pending = null;
    markAction(room, 'skip');
    proceed(room);
    return state;
}

function sellSquare(room, playerId, square) {
    assertPlaying(room);
    const state = st(room);
    if (state.phase !== 'debt' || state.phaseActor !== playerId) throw new Error('ขายที่ได้เฉพาะตอนเงินไม่พอจ่าย');
    const seat = seatOf(room, playerId);
    if (!isActive(seat)) throw new Error('คุณไม่ได้อยู่ในเกมแล้ว');
    const i = Number(square);
    if (!Number.isInteger(i) || !B.OWNABLE.includes(i) || ownerOf(room, i) !== playerId) throw new Error('ไม่ใช่ที่ของคุณ');
    const refund = sellValue(room, i);
    const level = prop(room, i).level;
    clearSquare(room, i);
    bankPays(room, seat, refund);
    pushFx(room, { kind: 'sell', playerId, square: i, level, amount: refund, cash: cashMap(room, [playerId]) });
    pushHistory(room, '🔧', `${seat.name} ขาย${sqName(i)}คืน ${fmt(refund)}`, 'sell');
    markAction(room, 'sell');
    proceed(room);
    return state;
}

/** ปุ่ม "เร่ง ⏩" ทั้งโต๊ะ: ฉากเร็วขึ้น บอทคิดสั้นลง */
function setFast(room, playerId, on) {
    assertPlaying(room);
    const state = st(room);
    const seat = seatOf(room, playerId);
    if (!seat || isBotId(playerId)) throw new Error('คุณไม่ได้อยู่ในเกมนี้');
    const value = !!on;
    if (state.fast === value) return state;
    state.fast = value;
    pushFx(room, { kind: 'fast', on: value, by: playerId });
    bumpStep(room);
    return state;
}

// ---------- เริ่ม / จบ ----------

/** options.dice (เทสเท่านั้น): รายการเต๋าที่จะออกก่อน เช่น [[6,6],[3,4]] · options.firstSeat */
function startGame(room, rng = Math.random, options = {}) {
    const roster = (room.players || []).filter(p => p.socketId || isBotId(p.playerId));
    if (roster.length < MIN_PLAYERS || roster.length > MAX_PLAYERS) throw new Error(`เศรษฐีเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน`);
    const state = resetRoomGame(room);
    const at = now();
    state.status = 'playing';
    state.config = normalizeConfig(room.settings || {});
    state.seats = roster.map((p, i) => ({
        playerId: p.playerId,
        name: isBotId(p.playerId) ? String(p.playerName || p.name || 'บอท').replace(/\s[0-9a-f]{2,4}$/i, '') : (p.playerName || p.name || 'ผู้เล่น'),
        color: p.color || '#f5c86b',
        avatar: p.avatar || '👤',
        avatarFrame: p.avatarFrame || 'none',
        token: i,
        tokenColor: TOKEN_COLORS[i % TOKEN_COLORS.length],
        colorName: TOKEN_COLOR_NAMES[i % TOKEN_COLOR_NAMES.length],
        cash: B.START_CASH,
        pos: 0,
        laps: 0,
        island: 0,
        tourPending: false,
        shield: null,
        bankrupt: false,
        left: false,
        outOrder: 0
    }));
    state.props = {};
    B.OWNABLE.forEach(i => { state.props[i] = { owner: null, level: 0 }; });
    state.deck = shuffle(B.CARDS.map(c => c.id), rng);
    state.ledger = { startTotal: state.seats.length * B.START_CASH, bankOut: 0, bankIn: 0 };
    state.clock = { minutes: state.config.minutes, startedAt: at, endsAt: state.config.minutes ? at + state.config.minutes * MINUTE_MS : null, timeUp: false };
    state.testDice = Array.isArray(options.dice) ? options.dice.map(d => d.slice()) : [];
    state.firstSeat = Number.isInteger(options.firstSeat) ? options.firstSeat : Math.floor(rng() * state.seats.length);
    state.round = 1;
    state.animUntil = at;
    room.gameState = state;
    pushHistory(room, '💰', `เริ่มเกม! ทุกคนได้ ${fmt(B.START_CASH)}`, 'start');
    pushFx(room, { kind: 'start' });
    startTurn(room, state.firstSeat);
    return state;
}

function endGame(room, playerId) {
    const state = st(room);
    if (!state || state.status !== 'playing') throw new Error('เกมยังไม่เริ่มหรือจบแล้ว');
    if (room.admin !== playerId) throw new Error('มีแค่หัวห้องที่จบเกมได้');
    return finishGame(room, 'หัวห้องจบเกม — นับทรัพย์สินรวม');
}

function handlePlayerLeft(room, playerId) {
    const state = st(room);
    if (!state || state.status !== 'playing') return state;
    const seat = seatOf(room, playerId);
    if (!seat || seat.left) return state;
    const wasActor = state.phaseActor === playerId;
    const wasTurn = state.turn && state.turn.playerId === playerId;
    if (isActive(seat)) {
        ownedSquares(room, playerId).forEach(i => clearSquare(room, i));
        if (seat.cash > 0) paysBank(room, seat, seat.cash);
    }
    seat.left = true;
    seat.island = 0;
    seat.tourPending = false;
    seat.shield = null;
    removeFromPending(room, playerId);
    pushFx(room, { kind: 'left', playerId });
    pushHistory(room, '🚪', `${seat.name} ออกจากเกม — ที่ดินคืนธนาคาร`, 'left');
    bumpStep(room);
    if (activeSeats(room).length <= 1) {
        const last = activeSeats(room)[0];
        finishGame(room, last ? `คนอื่นออกหมด — ${last.name} ชนะ` : 'ทุกคนออกจากเกม', last ? { winnerId: last.playerId } : {});
        return state;
    }
    if (wasTurn) {
        state.pending = null;
        state.resume = null;
        if (state.debts.length) proceed(room);
        else advanceTurn(room);
    } else if (wasActor) {
        proceed(room);
    }
    return state;
}

// ---------- หมดเวลา / autopilot ----------

function effectiveDeadline(room, at = now()) {
    const state = st(room);
    let deadline = phaseDeadline(room);
    if (!deadline) return null;
    const since = offlineSince(room, state.phaseActor, at);
    if (since !== null) {
        const start = Math.max(Number(state.phaseStartedAt) || 0, Number(state.animUntil) || 0);
        deadline = Math.min(deadline, Math.max(start, since + OFFLINE_GRACE_MS) + OFFLINE_TURN_MS);
    }
    return deadline;
}

/** เวลาเร็วสุดที่ต้องปลุก engine (หมดเวลาตา, นาฬิกาเกม) */
function nextDeadline(room, at = now()) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished') return null;
    const times = [];
    const d = effectiveDeadline(room, at);
    if (d) times.push(d);
    if (state.clock && state.clock.endsAt && !state.clock.timeUp) times.push(state.clock.endsAt);
    return times.length ? Math.min(...times) : null;
}

/** ดูแลเวลาทั้งหมด · คืน true ถ้า state เปลี่ยน */
function tick(room, rng = Math.random) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished') return false;
    const at = now();
    const changed = checkClock(room);
    const deadline = effectiveDeadline(room, at);
    if (!deadline || at < deadline) return changed;
    autopilot(room, rng);
    return true;
}

/** หมดเวลา: เล่นแบบปลอดภัยแทน — ทอย · ไม่ซื้อ · ไม่ซื้อต่อ · เทศกาล/อัปเกรดฟรีเลือกช่องที่ดีสุด · หนี้ = ขายให้ */
function autopilot(room, rng = Math.random) {
    const state = st(room);
    const actor = state.phaseActor;
    const seat = actor ? seatOf(room, actor) : null;
    if (!seat) return;
    const ctx = { seq: state.phaseSeq };
    switch (state.phase) {
        case 'roll':
            pushHistory(room, '⏰', `${seat.name} หมดเวลา — ทอยให้`, 'auto');
            rollDice(room, actor, ctx, rng);
            break;
        case 'build':
            passBuild(room, actor, ctx);
            break;
        case 'takeover':
            declineTakeover(room, actor, ctx);
            break;
        case 'pick': {
            const purpose = state.pending ? state.pending.purpose : null;
            const best = purpose === 'festival' || purpose === 'freeUpgrade' ? botPickTarget(room, seat, purpose) : null;
            if (best !== null) pickSquare(room, actor, best, ctx);
            else skipPick(room, actor, ctx);
            break;
        }
        case 'debt':
            settleDebtAuto(room, seat);
            break;
        default:
    }
}

/** ขายช่องให้อัตโนมัติจนพอจ่าย (บอท/หมดเวลา) — ไม่พอ = ล้มละลาย */
function settleDebtAuto(room, seat) {
    const state = st(room);
    const debt = state.debts[0];
    if (!debt) { proceed(room); return; }
    autoLiquidate(room, seat, debtTotal(debt));
    if (state.debts[0] === debt && seat.cash < debtTotal(debt)) {
        state.debts.shift();
        declareBankrupt(room, seat, debt.payees, debt.reason);
    }
    markAction(room, 'autoDebt');
    proceed(room);
}

function autoLiquidate(room, seat, target) {
    const keep = new Set(monopolyThreats(room).filter(t => t.playerId === seat.playerId).flatMap(t => (t.type === 'color' ? [] : B.SIDE_SQUARES[t.side] || B.TOURIST_SQUARES)));
    for (let guard = 0; guard < 40 && seat.cash < target; guard += 1) {
        const owned = ownedSquares(room, seat.playerId).sort((a, b) => (keep.has(a) - keep.has(b)) || squareValue(room, a) - squareValue(room, b));
        if (!owned.length) break;
        const i = owned[0];
        const refund = sellValue(room, i);
        const level = prop(room, i).level;
        clearSquare(room, i);
        bankPays(room, seat, refund);
        pushFx(room, { kind: 'sell', playerId: seat.playerId, square: i, level, amount: refund, cash: cashMap(room, [seat.playerId]) });
        pushHistory(room, '🔧', `${seat.name} ขาย${sqName(i)}คืน ${fmt(refund)}`, 'sell');
    }
    bumpStep(room);
}

// ---------- บอท ----------

/** เงินสำรองที่บอทอยากเหลือไว้ (ตามค่าผ่านทางที่แพงที่สุดของคนอื่น) */
function botReserve(room, seat) {
    let worst = 0;
    B.OWNABLE.forEach(i => {
        const owner = ownerOf(room, i);
        if (owner && owner !== seat.playerId) worst = Math.max(worst, tollFor(room, i));
    });
    return Math.max(1500, Math.min(9000, Math.round(worst * 0.6)));
}

function threatSquaresOf(room, filter) {
    const set = new Set();
    monopolyThreats(room).filter(filter).forEach(t => t.squares.forEach(i => set.add(i)));
    return set;
}

function botBuildLevel(room, seat, pending) {
    const i = pending.square;
    const choices = buildChoices(room, seat, i, pending.mode);
    const reserve = botReserve(room, seat);
    const urgent = threatSquaresOf(room, t => t.playerId !== seat.playerId).has(i) || threatSquaresOf(room, t => t.playerId === seat.playerId).has(i);
    let best = null;
    choices.options.filter(o => !o.built && !o.locked).forEach(o => {
        const cost = buildCost(room, seat, i, pending.mode, o.level);
        if (cost === null || cost > seat.cash) return;
        const left = seat.cash - cost;
        const minimum = o.level === choices.current + 1 && pending.mode === 'buy' ? (urgent ? 0 : reserve * 0.45) : reserve;
        if (left >= minimum) best = o.level;
    });
    return best;
}

function botWantsTakeover(room, seat, i) {
    const price = takeoverPrice(room, i);
    if (price > seat.cash) return false;
    const left = seat.cash - price;
    const mine = new Set(ownedSquares(room, seat.playerId));
    mine.add(i);
    const owner = ownerOf(room, i);
    // ซื้อแล้วผูกขาดทันที
    const p = prop(room, i);
    p.owner = seat.playerId;
    const wins = !!monopolyOf(room, seat.playerId);
    p.owner = owner;
    if (wins) return true;
    if (threatSquaresOf(room, t => t.playerId !== seat.playerId).has(i)) return left >= 0;
    const group = B.SQUARES[i].group;
    const completes = B.GROUP_SQUARES[group].every(k => mine.has(k));
    const reserve = botReserve(room, seat);
    if (completes) return left >= reserve * 0.3;
    // ซื้อต่อเมืองที่มีสิ่งปลูกสร้าง ถ้ายังเหลือเงินสำรองพอ (เมืองว่างเปล่าคุ้มน้อยกว่า)
    return left >= reserve * (p.level >= 1 ? 0.8 : 1.4);
}

function botPickTarget(room, seat, purpose) {
    const options = pickOptions(room, seat, purpose);
    if (!options.length) return null;
    if (purpose === 'festival') return options.slice().sort((a, b) => tollFor(room, b) - tollFor(room, a) || b - a)[0];
    if (purpose === 'startBonus' || purpose === 'freeUpgrade') return options.slice().sort((a, b) => B.SQUARES[b].price - B.SQUARES[a].price)[0];
    if (purpose === 'tour') {
        const reserve = botReserve(room, seat);
        const cash = seat.cash - B.TOUR_FEE;
        const afford = i => cash - B.levelCost(i, 0) >= reserve * 0.3;
        const free = options.filter(i => B.OWNABLE.includes(i) && !ownerOf(room, i));
        const winning = threatSquaresOf(room, t => t.playerId === seat.playerId);
        const blocking = threatSquaresOf(room, t => t.playerId !== seat.playerId);
        const pickFrom = list => list.sort((a, b) => B.SQUARES[b].price - B.SQUARES[a].price)[0];
        const win = free.filter(i => winning.has(i) && cash >= B.levelCost(i, 0));
        if (win.length) return pickFrom(win);
        const landmark = ownedSquares(room, seat.playerId).filter(i => isCity(i) && prop(room, i).level === 3 && cash - B.levelCost(i, 4) >= reserve * 0.5);
        if (landmark.length) return pickFrom(landmark);
        const block = free.filter(i => blocking.has(i) && afford(i));
        if (block.length) return pickFrom(block);
        const near = free.filter(i => isCity(i) && afford(i) && B.GROUP_SQUARES[B.SQUARES[i].group].some(k => ownerOf(room, k) === seat.playerId));
        if (near.length) return pickFrom(near);
        if (pickOptions(room, seat, 'startBonus').length && seat.cash > reserve) return B.START_SQUARE;
        return null;
    }
    return null;
}

/** ใครเป็นบอทที่ต้องขยับตอนนี้ */
function botPending(room) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished') return null;
    if (state.phaseActor && isBotId(state.phaseActor) && ['roll', 'build', 'takeover', 'pick', 'debt'].includes(state.phase)) {
        return { kind: 'actor', seat: seatOf(room, state.phaseActor) };
    }
    return null;
}

function botNeedsTurn(room) { return !!botPending(room); }

/** บอทรอให้ฉากจบ แล้วหยุดคิดอีกนิดให้คนเห็น */
function botDelay(room, at = now()) {
    const state = st(room);
    if (!botPending(room)) return null;
    const think = Math.round(BOT_MS * (state.fast ? 0.35 : 1));
    const due = Math.max(Number(state.lastActionAt) || 0, Number(state.animUntil) || 0) + think;
    return Math.max(30, due - at);
}

/** บอทขยับ 1 ครั้ง (ถ้าถึงเวลา) · คืน true ถ้าทำอะไรไป */
function playBotTurns(room, rng = Math.random, at = now()) {
    const state = st(room);
    const pending = botPending(room);
    if (!pending) return false;
    const delay = botDelay(room, at);
    if (delay !== null && delay > 40) return false;
    const seat = pending.seat;
    const id = seat.playerId;
    const ctx = { seq: state.phaseSeq };
    switch (state.phase) {
        case 'roll': {
            const unowned = B.OWNABLE.filter(i => !ownerOf(room, i)).length;
            if (seat.island && seat.cash >= B.ISLAND_FEE + botReserve(room, seat) && unowned > 6) { payIsland(room, id, ctx); return true; }
            rollDice(room, id, ctx, rng, { power: rng(), green: rng() < BOT_GREEN_HIT });
            return true;
        }
        case 'build': {
            const level = botBuildLevel(room, seat, state.pending);
            if (level !== null) buildTo(room, id, level, ctx);
            else passBuild(room, id, ctx);
            return true;
        }
        case 'takeover':
            if (botWantsTakeover(room, seat, state.pending.square)) acceptTakeover(room, id, ctx);
            else declineTakeover(room, id, ctx);
            return true;
        case 'pick': {
            const target = botPickTarget(room, seat, state.pending.purpose);
            if (target !== null) pickSquare(room, id, target, ctx);
            else skipPick(room, id, ctx);
            return true;
        }
        case 'debt':
            settleDebtAuto(room, seat);
            return true;
        default:
            return false;
    }
}

// ---------- ส่งให้ client ----------

/** รายละเอียดเรื่องที่กำลังตัดสินใจ (ทุกคนเห็น — ไม่มีความลับ) */
function publicDecision(room) {
    const state = st(room);
    const pending = state.pending;
    if (!pending || !['build', 'takeover', 'pick'].includes(state.phase) || state.phaseActor !== pending.playerId) return null;
    const seat = seatOf(room, pending.playerId);
    if (!seat) return null;
    const out = { type: pending.type, playerId: pending.playerId, cash: seat.cash };
    if (pending.type === 'build') {
        const choices = buildChoices(room, seat, pending.square, pending.mode);
        out.square = pending.square;
        out.mode = pending.mode;
        out.current = choices.current;
        out.cap = choices.cap;
        out.options = choices.options;
    } else if (pending.type === 'takeover') {
        out.square = pending.square;
        out.price = takeoverPrice(room, pending.square);
        out.owner = ownerOf(room, pending.square);
        out.level = prop(room, pending.square).level;
    } else {
        out.purpose = pending.purpose;
        out.options = pickOptions(room, seat, pending.purpose);
        out.fee = pending.purpose === 'tour' ? B.TOUR_FEE : null;
        if (pending.purpose === 'startBonus') {
            out.costs = {};
            out.options.forEach(i => { out.costs[i] = startBonusCost(room, i); });
        }
    }
    return out;
}

function getAvailableActions(room, viewerId) {
    const state = st(room);
    const seat = seatOf(room, viewerId);
    const playing = state.status === 'playing' && state.phase !== 'finished';
    const actor = playing && state.phaseActor === viewerId && isActive(seat);
    const out = { roll: false, payIsland: false, build: false, takeover: false, pick: false, sell: false, end: room.admin === viewerId && playing, fast: playing && !!seat && !isBotId(viewerId) };
    if (!actor) return out;
    if (state.phase === 'roll') {
        out.roll = true;
        out.payIsland = seat.island > 0 && seat.cash >= B.ISLAND_FEE;
    }
    if (state.phase === 'build') out.build = true;
    if (state.phase === 'takeover') out.takeover = seat.cash >= takeoverPrice(room, state.pending.square);
    if (state.phase === 'pick') out.pick = true;
    if (state.phase === 'debt') out.sell = true;
    return out;
}

function buildClientState(room, viewerId) {
    const state = room.gameState || createInitialState();
    const seats = state.seats || [];
    const at = now();
    const viewer = seats.find(seat => seat.playerId === viewerId) || null;
    const debt = state.debts && state.debts[0];
    const playing = state.status === 'playing' && state.phase !== 'finished';
    const props = {};
    const tolls = {};
    Object.keys(state.props || {}).forEach(k => {
        const p = state.props[k];
        props[k] = { owner: p.owner, level: p.level };
        if (p.owner && room.gameState) tolls[k] = tollFor(room, Number(k));
    });
    return {
        mode: MODE,
        status: state.status,
        phase: state.phase,
        step: Number(state.step) || 0,
        phaseSeq: Number(state.phaseSeq) || 0,
        serverNow: at,
        config: state.config || normalizeConfig(room.settings || {}),
        clock: state.clock ? { ...state.clock } : null,
        round: state.round,
        fast: !!state.fast,
        turn: state.turn ? {
            playerId: state.turn.playerId,
            seq: state.turn.seq,
            doublesStreak: state.turn.doublesStreak,
            canRollAgain: state.turn.canRollAgain,
            hasRolled: state.turn.hasRolled,
            lastRoll: state.turn.lastRoll,
            holding: !!(state.rollHold && state.rollHold.phaseSeq === state.phaseSeq)
        } : null,
        phaseActor: state.phaseActor,
        phaseEndsAt: playing && room.gameState ? effectiveDeadline(room, at) : null,
        isHost: room.admin === viewerId,
        seats: seats.map(seat => ({
            playerId: seat.playerId,
            name: seat.name,
            avatar: seat.avatar,
            avatarFrame: seat.avatarFrame,
            color: seat.color,
            token: seat.token,
            tokenColor: seat.tokenColor,
            colorName: seat.colorName,
            cash: seat.cash,
            pos: seat.pos,
            laps: seat.laps || 0,
            island: seat.island || 0,
            tourPending: !!seat.tourPending,
            shield: seat.shield || null,
            bankrupt: !!seat.bankrupt,
            left: !!seat.left,
            online: isConnected(room, seat),
            isBot: isBotId(seat.playerId),
            isSelf: seat.playerId === viewerId,
            isTurn: !!(state.turn && state.turn.playerId === seat.playerId && state.phase !== 'finished'),
            lands: room.gameState ? ownedSquares(room, seat.playerId).length : 0,
            netWorth: room.gameState ? netWorth(room, seat) : 0
        })),
        props,
        tolls,
        festival: state.festival,
        decision: room.gameState && playing ? publicDecision(room) : null,
        threats: room.gameState && playing ? monopolyThreats(room) : [],
        monopoly: state.monopoly || null,
        debt: debt ? { debtorId: debt.debtorId, total: debtTotal(debt), reason: debt.reason } : null,
        self: viewer ? {
            playerId: viewer.playerId,
            active: isActive(viewer),
            liquidation: room.gameState ? liquidationValue(room, viewer) : 0,
            sell: state.phase === 'debt' && state.phaseActor === viewerId ? Object.fromEntries(ownedSquares(room, viewerId).map(i => [i, sellValue(room, i)])) : null
        } : null,
        availableActions: room.gameState ? getAvailableActions(room, viewerId) : {},
        standings: state.phase === 'finished' ? state.standings : null,
        winners: state.phase === 'finished' ? state.winners : null,
        finishReason: state.phase === 'finished' ? state.finishReason : null,
        history: (state.history || []).slice(0, 40),
        returnLobbyEndsAt: state.returnLobbyEndsAt || null,
        fxSeq: Number(state.fxSeq) || 0,
        fx: state.fx || []
    };
}

// ---------- ตรวจความถูกต้อง (เทส) ----------

/** คืนรายการสิ่งที่ผิดกติกา/บัญชีเงินไม่ลง — ว่าง = ถูกต้อง */
function auditState(room) {
    const state = st(room);
    const problems = [];
    if (!state || !state.ledger) return problems;
    const cash = state.seats.reduce((sum, seat) => sum + seat.cash, 0);
    const expected = state.ledger.startTotal + state.ledger.bankOut - state.ledger.bankIn;
    if (cash !== expected) problems.push(`เงินรวม ${cash} ≠ บัญชี ${expected}`);
    state.seats.forEach(seat => {
        if (!Number.isInteger(seat.cash) || seat.cash < 0) problems.push(`${seat.name} เงินติดลบ/ไม่ใช่จำนวนเต็ม ${seat.cash}`);
        if (!isActive(seat)) {
            if (seat.cash !== 0) problems.push(`${seat.name} ออก/ล้มละลายแต่ยังมีเงิน`);
            if (ownedSquares(room, seat.playerId).length) problems.push(`${seat.name} ออก/ล้มละลายแต่ยังมีที่ดิน`);
        }
        if (seat.pos < 0 || seat.pos >= B.BOARD_SIZE) problems.push(`${seat.name} ตำแหน่งผิด ${seat.pos}`);
        if (seat.island < 0 || seat.island > B.ISLAND_TURNS) problems.push(`${seat.name} นับเกาะผิด ${seat.island}`);
        if (seat.island > 0 && seat.pos !== B.ISLAND_SQUARE) problems.push(`${seat.name} ติดเกาะแต่ไม่อยู่บนเกาะ`);
    });
    B.OWNABLE.forEach(i => {
        const p = prop(room, i);
        if (!p) { problems.push(`${sqName(i)} ไม่มีข้อมูล`); return; }
        if (isTourist(i) && p.level !== 0) problems.push(`${sqName(i)} ท่องเที่ยวมีสิ่งปลูกสร้าง`);
        if (isCity(i) && (p.level < 0 || p.level > 4)) problems.push(`${sqName(i)} ขั้นผิด ${p.level}`);
        if (p.level > 0 && !p.owner) problems.push(`${sqName(i)} มีสิ่งปลูกสร้างแต่ไม่มีเจ้าของ`);
        if (p.owner && !isActive(seatOf(room, p.owner))) problems.push(`${sqName(i)} เจ้าของไม่อยู่ในเกม`);
    });
    if (state.festival !== null && state.festival !== undefined && !ownerOf(room, state.festival)) problems.push('เทศกาลอยู่บนช่องที่ไม่มีเจ้าของ');
    if (state.phase === 'debt' && !state.debts.length) problems.push('เฟสหนี้แต่ไม่มีหนี้');
    if (['build', 'takeover', 'pick'].includes(state.phase) && (!state.pending || state.pending.type !== state.phase)) problems.push(`เฟส ${state.phase} แต่ไม่มีเรื่องให้ตัดสินใจ`);
    if (state.phase === 'takeover' && state.pending && prop(room, state.pending.square).level >= 4) problems.push('เสนอซื้อต่อแลนด์มาร์ก');
    if (state.status === 'playing' && state.phase !== 'finished') {
        const actor = seatOf(room, state.phaseActor);
        if (!isActive(actor)) problems.push(`ผู้ทำตาไม่อยู่ในเกม (${state.phase})`);
        activeSeats(room).forEach(seat => { if (monopolyOf(room, seat.playerId)) problems.push(`${seat.name} ผูกขาดแล้วแต่เกมไม่จบ`); });
        if (activeSeats(room).length < 2) problems.push('เหลือผู้เล่นคนเดียวแต่เกมไม่จบ');
    }
    return problems;
}

module.exports = {
    id: MODE,
    label: 'เศรษฐี',
    description: 'ทอยเต๋าซื้อเมืองทั่วไทย สร้างจนเป็นแลนด์มาร์ก ซื้อต่อ 2 เท่า ผูกขาดชนะทันที — 2–4 คน ใส่บอทได้',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    MINUTE_CHOICES,
    DEFAULT_MINUTES,
    TURN_MS,
    DECIDE_MS,
    DEBT_MS,
    BOT_MS,
    MINUTE_MS,
    TOKEN_COLORS,
    TAP_MS,
    HOLD_EARLY_MS,
    HOLD_LATE_MS,
    GREEN_DOUBLES,
    GREEN_SPAWN,
    SWEEP_MIN_MS,
    SWEEP_MAX_MS,
    MONOPOLY_LABEL,
    greenSchedule,
    biasedDice,
    meterAt,
    startRollHold,
    releaseRoll,
    cancelRollHold,
    board: B,
    setClock,
    now,
    fxCost,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    normalizeConfig,
    sanitizeMinutes,
    startGame,
    rollDice,
    payIsland,
    buildTo,
    passBuild,
    acceptTakeover,
    declineTakeover,
    pickSquare,
    skipPick,
    sellSquare,
    setFast,
    endGame,
    handlePlayerLeft,
    tick,
    autopilot,
    nextDeadline,
    effectiveDeadline,
    playBotTurns,
    botNeedsTurn,
    botDelay,
    botPending,
    autoLiquidate,
    buildChoices,
    buildCost,
    pickOptions,
    buildClientState,
    getAvailableActions,
    tollFor,
    takeoverPrice,
    squareValue,
    netWorth,
    liquidationValue,
    levelCap,
    monopolyOf,
    monopolyThreats,
    computeStandings,
    auditState,
    isBotId,
    isActive,
    shuffle
};
