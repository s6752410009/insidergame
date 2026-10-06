/**
 * เศรษฐี — เกมซื้อขายที่ดินธีมจังหวัดไทย 2–6 คน (ใส่บอทได้)
 *
 * engine ล้วน: ไม่มี socket/IO · ทุกอย่างที่สุ่มรับ rng ได้ · เวลาอ่านผ่าน now() (เทสเปลี่ยนนาฬิกาได้ด้วย setClock)
 * เงินในเกมเป็นเงินสมมติ (฿) ไม่มีมูลค่าจริง ไม่เกี่ยวกับกระเป๋าเงินของเว็บ
 *
 * เฟสของตา (state.phase):
 *   roll    — คนที่ถึงตาทอยเต๋า (ติดคุก: จ่ายค่าปรับ/ใช้บัตร/ทอยหาดับเบิล)
 *   buy     — ตกช่องที่ยังไม่มีเจ้าของ: ซื้อ หรือส่งประมูล
 *   auction — ทุกคนที่ยังไม่ล้มละลายประมูลได้ นับถอยหลังรีเซ็ตทุกครั้งที่มีคนเสนอ
 *   debt    — เงินไม่พอจ่าย: ขายบ้าน/จำนอง (จ่ายอัตโนมัติเมื่อเงินพอ)
 *   manage  — หลังทอยแล้ว สร้างบ้าน/จำนอง/เทรด แล้วจบเทิร์น
 *   finished
 *
 * บัญชีเงิน: ทุกบาทที่เข้า/ออกจากธนาคารนับใน state.ledger — ผลรวมเงินสดทุกคน = ทุนตั้งต้น + bankOut − bankIn เสมอ
 * เงินสดไม่มีวันติดลบ: หนี้ที่จ่ายไม่ไหวเก็บไว้ใน state.debts จนกว่าจะหาเงินได้หรือล้มละลาย
 * ลำดับกองการ์ด (state.decks) กับความคิดของบอท (state.botMemo) ไม่ส่งให้ client
 */

const B = require('./setthiBoard');

const MODE = 'setthi';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MINUTE_CHOICES = [0, 20, 30, 45, 60];
const DEFAULT_MINUTES = 30;

const env = process.env;
const TURN_MS = Number(env.SETTHI_TURN_MS) || 30000;
const DEBT_MS = Number(env.SETTHI_DEBT_MS) || 40000;
const AUCTION_START_MS = Number(env.SETTHI_AUCTION_START_MS) || 10000;
const AUCTION_BID_MS = Number(env.SETTHI_AUCTION_MS) || 8000;
const TRADE_MS = Number(env.SETTHI_TRADE_MS) || 45000;
const TRADE_GRACE_MS = Number(env.SETTHI_TRADE_GRACE_MS) || 20000;
const OFFLINE_GRACE_MS = Number(env.SETTHI_OFFLINE_GRACE_MS) || 10000;
const OFFLINE_TURN_MS = Number(env.SETTHI_OFFLINE_TURN_MS) || 5000;
const BOT_MS = Number(env.SETTHI_BOT_MS) || 1100;
const MINUTE_MS = Number(env.SETTHI_MINUTE_MS) || 60000;
const MIN_BID_STEP = 10;
// กดค้างทอย: เข็มแกว่งขึ้นลง ยิ่งปล่อยใกล้ปลาย = ทอยแรง (แต้มรวมสูงขึ้นนิดหน่อย) · ปล่อยในช่องเขียว = โอกาสดับเบิลสูงขึ้น
const TAP_MS = 150;
const HOLD_EARLY_MS = 250; // เวลาจาก client เร็วกว่าเซิร์ฟเวอร์ได้ไม่เกินนี้
const HOLD_LATE_MS = 50; // ช้ากว่าได้ไม่เกินนี้ · นอกช่วง = ใช้เวลาฝั่งเซิร์ฟเวอร์
const HOLD_MAX_MS = 20000;
const GREEN_DOUBLES = 0.2; // ในช่องเขียว: ถ้ายังไม่ดับเบิล เปลี่ยนเป็นดับเบิลด้วยโอกาสนี้ (1/6 → ~1/3)
// ช่องเขียวเป็นโบนัสเซอร์ไพรส์: โผล่แค่บางครั้ง ตำแหน่ง/ความกว้างสุ่ม โผล่กลางทาง แล้วหายไปหลังช่วงสั้น ๆ
const GREEN_SPAWN = Number(env.SETTHI_GREEN_SPAWN) || 0.5;
const BOT_GREEN_HIT = 0.15;
const TOKEN_COLORS = ['#f5c86b', '#ef5b4c', '#4ea8dc', '#3fbf7f', '#b07cf0', '#f39a3d'];

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

function isBotId(playerId) {
    return String(playerId || '').startsWith('bot_');
}

function fmt(amount) {
    return '฿' + Math.round(Number(amount) || 0).toLocaleString('en-US');
}

function sqName(index) {
    const sq = B.SQUARES[index];
    return sq ? sq.name : '?';
}

function createInitialState() {
    return {
        mode: MODE,
        status: 'waiting',
        phase: 'lobby',
        players: [],
        seats: [],
        props: {},
        decks: { chance: [], fortune: [] },
        config: null,
        turn: null,
        turnSeq: 0,
        phaseSeq: 0,
        phaseActor: null,
        phaseStartedAt: null,
        phaseEndsAt: null,
        pendingBuy: null,
        auction: null,
        auctionSeq: 0,
        debts: [],
        debtSeq: 0,
        resume: null,
        trades: [],
        tradeSeq: 0,
        clock: null,
        ledger: null,
        firstSeat: 0,
        round: 1,
        outCount: 0,
        standings: null,
        winners: null,
        finishReason: null,
        history: [],
        fx: [],
        fxSeq: 0,
        step: 0,
        lastActionAt: 0,
        lastActionKind: null,
        rollHold: null,
        botMemo: {},
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
    return {
        ...createInitialState(),
        players: (room.players || []).map(createPlayerState)
    };
}

function normalizeConfig(settings = {}) {
    const minutes = MINUTE_CHOICES.includes(Number(settings.setthiMinutes)) ? Number(settings.setthiMinutes) : DEFAULT_MINUTES;
    return { minutes, turnMs: TURN_MS, startCash: B.START_CASH, salary: B.SALARY, jailFine: B.JAIL_FINE };
}

function sanitizeMinutes(value) {
    return MINUTE_CHOICES.includes(Number(value)) ? Number(value) : DEFAULT_MINUTES;
}

function st(room) { return room.gameState; }

function seatOf(room, playerId) {
    return (st(room).seats || []).find(seat => seat.playerId === playerId) || null;
}

function seatIndex(room, playerId) {
    return (st(room).seats || []).findIndex(seat => seat.playerId === playerId);
}

function isActive(seat) {
    return !!(seat && !seat.bankrupt && !seat.left);
}

function activeSeats(room) {
    return (st(room).seats || []).filter(isActive);
}

function roomEntry(room, playerId) {
    return (room.players || []).find(p => p.playerId === playerId) || null;
}

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

function pushFx(room, event) {
    const state = st(room);
    state.fxSeq = (Number(state.fxSeq) || 0) + 1;
    state.fx = [...(state.fx || []), { seq: state.fxSeq, at: now(), ...event }].slice(-60);
}

function pushHistory(room, icon, text, kind = null) {
    st(room).history = [{ icon, text, kind, at: new Date(now()).toISOString() }, ...(st(room).history || [])].slice(0, 60);
}

function bumpStep(room) {
    st(room).step = (Number(st(room).step) || 0) + 1;
}

function markAction(room, kind) {
    st(room).lastActionAt = now();
    st(room).lastActionKind = kind;
    bumpStep(room);
}

function cashMap(room, ids) {
    const out = {};
    ids.forEach(id => {
        const seat = seatOf(room, id);
        if (seat) out[id] = seat.cash;
    });
    return out;
}

// ---------- ทรัพย์สิน ----------

function prop(room, index) {
    return st(room).props[index] || null;
}

function groupSquares(group) {
    return B.GROUP_SQUARES[group] || [];
}

function ownsGroup(room, playerId, group) {
    const squares = groupSquares(group);
    return squares.length > 0 && squares.every(i => prop(room, i).owner === playerId);
}

function groupHasBuildings(room, group) {
    return groupSquares(group).some(i => prop(room, i).houses > 0);
}

function groupMortgaged(room, group) {
    return groupSquares(group).some(i => prop(room, i).mortgaged);
}

function countOwned(room, playerId, type) {
    return B.OWNABLE.filter(i => B.SQUARES[i].type === type && prop(room, i).owner === playerId).length;
}

function ownedSquares(room, playerId) {
    return B.OWNABLE.filter(i => prop(room, i).owner === playerId);
}

function mortgageValue(index) {
    return Math.floor((B.SQUARES[index].price || 0) / 2);
}

function unmortgageCost(index) {
    return Math.ceil(mortgageValue(index) * 11 / 10); // จำนอง +10% (คิดเป็นจำนวนเต็ม กันทศนิยมเพี้ยน)
}

function houseCost(index) {
    const sq = B.SQUARES[index];
    return sq.type === 'property' ? B.GROUPS[sq.group].houseCost : 0;
}

/** ค่าเช่า ณ ตอนนี้ · diceTotal ใช้กับสาธารณูปโภค · opts.mult จากการ์ด */
function rentFor(room, index, diceTotal = 7, opts = {}) {
    const sq = B.SQUARES[index];
    const p = prop(room, index);
    if (!p || !p.owner || p.mortgaged) return 0;
    if (sq.type === 'property') {
        if (p.houses > 0) return sq.rent[p.houses];
        return sq.rent[0] * (ownsGroup(room, p.owner, sq.group) ? 2 : 1);
    }
    if (sq.type === 'transport') {
        const count = countOwned(room, p.owner, 'transport');
        return B.TRANSPORT_RENT[Math.max(0, count - 1)] * (opts.mult || 1);
    }
    if (sq.type === 'utility') {
        const count = countOwned(room, p.owner, 'utility');
        const mult = opts.mult || B.UTILITY_MULT[Math.max(0, count - 1)];
        return diceTotal * mult;
    }
    return 0;
}

/** มูลค่าสุทธิ: เงินสด + ราคาที่ดิน (จำนองนับครึ่ง) + สิ่งปลูกสร้างตามทุน */
function netWorth(room, seat) {
    if (!seat || !isActive(seat)) return 0;
    let total = seat.cash;
    ownedSquares(room, seat.playerId).forEach(i => {
        const p = prop(room, i);
        total += p.mortgaged ? mortgageValue(i) : B.SQUARES[i].price;
        total += p.houses * houseCost(i);
    });
    return total;
}

/** เงินที่หาได้ทั้งหมดถ้าขายบ้านคืนครึ่งราคาและจำนองทุกแปลง */
function liquidationValue(room, seat) {
    if (!seat) return 0;
    let total = seat.cash;
    ownedSquares(room, seat.playerId).forEach(i => {
        const p = prop(room, i);
        total += Math.floor(p.houses * houseCost(i) / 2);
        if (!p.mortgaged) total += mortgageValue(i);
    });
    return total;
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

function debtTotal(debt) {
    return debt.payees.reduce((sum, p) => sum + p.amount, 0);
}

/** จ่ายตามรายการทันที (ต้องมีเงินพอแล้ว) */
function settlePayees(room, payer, payees, reason, meta = {}) {
    payees.forEach(entry => {
        if (entry.amount <= 0) return;
        const target = entry.to ? seatOf(room, entry.to) : null;
        if (target && isActive(target)) {
            transfer(room, payer, target, entry.amount);
            pushFx(room, { kind: meta.kind === 'rent' ? 'rent' : 'pay', from: payer.playerId, to: target.playerId, amount: entry.amount, square: meta.square, reason, cash: cashMap(room, [payer.playerId, target.playerId]) });
        } else {
            paysBank(room, payer, entry.amount);
            pushFx(room, { kind: 'pay', from: payer.playerId, to: null, amount: entry.amount, square: meta.square, reason, cash: cashMap(room, [payer.playerId]) });
        }
    });
}

/**
 * เรียกเก็บเงิน: มีเงินสดพอ = จ่ายเลย · ไม่พอแต่ขาย/จำนองแล้วพอ = เข้าคิวหนี้ · ขายทั้งหมดก็ไม่พอ = ล้มละลายทันที
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
        pushHistory(room, '⚠️', `${payer.name} เงินสดไม่พอจ่าย ${reason} ${fmt(total)} — ต้องขายบ้าน/จำนองให้พอ`, 'debt');
        pushFx(room, { kind: 'debt', playerId: payer.playerId, amount: total, reason });
        return 'debt';
    }
    declareBankrupt(room, payer, list.length === 1 ? (list[0].to || null) : null, list, reason);
    return 'bankrupt';
}

// ---------- ล้มละลาย / จบเกม ----------

function returnJailCards(room, seat) {
    (seat.jailCards || []).forEach(cardId => {
        const deck = cardId.startsWith('c') ? 'chance' : 'fortune';
        st(room).decks[deck].push(cardId);
    });
    seat.jailCards = [];
}

/**
 * ล้มละลาย: creditor = playerId → ทรัพย์สินทั้งหมดตกเป็นของเจ้าหนี้ (บ้านขายคืนธนาคารครึ่งราคาก่อน เงินรวมไปให้เจ้าหนี้)
 * creditor = null (ธนาคาร/หลายคน) → ที่ดินคืนธนาคาร ไม่มีเจ้าของ บ้านถูกรื้อ เงินสดแบ่งให้เจ้าหนี้ตามลำดับที่เหลือเข้าธนาคาร
 */
function declareBankrupt(room, seat, creditorId, payees = [], reason = '') {
    const state = st(room);
    if (!isActive(seat)) return;
    const creditor = creditorId ? seatOf(room, creditorId) : null;
    const toPlayer = creditor && isActive(creditor) && creditor.playerId !== seat.playerId ? creditor : null;
    const owned = ownedSquares(room, seat.playerId);

    if (toPlayer) {
        owned.forEach(i => {
            const p = prop(room, i);
            if (p.houses > 0) {
                bankPays(room, seat, Math.floor(p.houses * houseCost(i) / 2));
                p.houses = 0;
            }
        });
        const cash = seat.cash;
        if (cash > 0) transfer(room, seat, toPlayer, cash);
        owned.forEach(i => { prop(room, i).owner = toPlayer.playerId; });
        toPlayer.jailCards = [...(toPlayer.jailCards || []), ...(seat.jailCards || [])];
        seat.jailCards = [];
        pushFx(room, { kind: 'bankrupt', playerId: seat.playerId, creditor: toPlayer.playerId, squares: owned, amount: cash, cash: cashMap(room, [seat.playerId, toPlayer.playerId]) });
        pushHistory(room, '💥', `${seat.name} ล้มละลาย${reason ? ' (' + reason + ')' : ''} — ทรัพย์สินทั้งหมดตกเป็นของ ${toPlayer.name}`, 'bankrupt');
        announceNewSets(room, toPlayer.playerId, owned);
    } else {
        owned.forEach(i => {
            const p = prop(room, i);
            p.owner = null;
            p.houses = 0;
            p.mortgaged = false;
        });
        let cash = seat.cash;
        payees.forEach(entry => {
            const target = entry.to ? seatOf(room, entry.to) : null;
            if (!target || !isActive(target) || target === seat || cash <= 0) return;
            const part = Math.min(cash, entry.amount);
            transfer(room, seat, target, part);
            cash -= part;
        });
        if (seat.cash > 0) paysBank(room, seat, seat.cash);
        returnJailCards(room, seat);
        pushFx(room, { kind: 'bankrupt', playerId: seat.playerId, creditor: null, squares: owned, cash: cashMap(room, (state.seats || []).map(s => s.playerId)) });
        pushHistory(room, '💥', `${seat.name} ล้มละลาย${reason ? ' (' + reason + ')' : ''} — ที่ดินคืนธนาคาร`, 'bankrupt');
    }

    seat.bankrupt = true;
    seat.cash = 0;
    seat.inJail = false;
    state.outCount = (Number(state.outCount) || 0) + 1;
    seat.outOrder = state.outCount;
    removeFromPending(room, seat.playerId);
    bumpStep(room);
    if (activeSeats(room).length <= 1) {
        const last = activeSeats(room)[0];
        finishGame(room, last ? `${last.name} อยู่รอดคนสุดท้าย` : 'ทุกคนล้มละลาย');
    }
}

/** ลบผู้เล่นที่ออก/ล้มละลายจากคิวหนี้ ข้อเสนอเทรด และการประมูล */
function removeFromPending(room, playerId) {
    const state = st(room);
    state.debts = (state.debts || []).filter(d => d.debtorId !== playerId).map(d => ({
        ...d,
        payees: d.payees.map(p => (p.to === playerId ? { to: null, amount: p.amount } : p))
    }));
    const before = state.trades.length;
    state.trades = state.trades.filter(t => t.from !== playerId && t.to !== playerId);
    if (state.trades.length !== before) pushFx(room, { kind: 'tradeClosed', reason: 'gone' });
    if (state.auction) {
        const a = state.auction;
        a.bids = a.bids.filter(b => b.playerId !== playerId);
        if (a.leader === playerId) {
            const best = a.bids.slice().sort((x, y) => y.amount - x.amount).find(b => {
                const s = seatOf(room, b.playerId);
                return isActive(s) && s.cash >= b.amount;
            });
            a.high = best ? best.amount : 0;
            a.leader = best ? best.playerId : null;
        }
    }
}

function computeStandings(room) {
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
        bankrupt: !!seat.bankrupt,
        left: !!seat.left,
        outOrder: seat.outOrder || 0
    }));
    rows.sort((a, b) => {
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
        if (!alive || prev === null || row.netWorth !== prev) rank = i + 1;
        row.rank = rank;
        prev = alive ? row.netWorth : null;
    });
    return rows;
}

function finishGame(room, reason) {
    const state = st(room);
    if (state.phase === 'finished') return state;
    state.phase = 'finished';
    state.status = 'setthi_finished';
    state.phaseEndsAt = null;
    state.phaseActor = null;
    state.pendingBuy = null;
    state.auction = null;
    state.debts = [];
    state.resume = null;
    state.trades = [];
    state.finishReason = reason || 'จบเกม';
    state.standings = computeStandings(room);
    const top = state.standings.filter(r => !r.bankrupt && !r.left);
    const best = top.length ? top[0].netWorth : null;
    state.winners = top.filter(r => r.netWorth === best).map(r => ({ playerId: r.playerId, name: r.name, netWorth: r.netWorth }));
    const names = state.winners.map(w => w.name).join(', ');
    pushHistory(room, '🏆', `${state.finishReason}${names ? ' — ' + names + ' ชนะ' : ''}`, 'finished');
    pushFx(room, { kind: 'finished', winners: state.winners.map(w => w.playerId) });
    bumpStep(room);
    return state;
}

// ---------- เฟส / ตา ----------

function setPhase(room, phase, ms, actorId) {
    const state = st(room);
    const at = now();
    state.phase = phase;
    state.phaseSeq = (Number(state.phaseSeq) || 0) + 1;
    state.phaseActor = actorId || null;
    state.phaseStartedAt = at;
    state.phaseEndsAt = ms ? at + ms : null;
    state.rollHold = null;
    bumpStep(room);
}

function checkClock(room) {
    const state = st(room);
    const c = state.clock;
    if (!c || !c.endsAt || c.timeUp || state.phase === 'finished') return false;
    if (now() < c.endsAt) return false;
    c.timeUp = true;
    pushHistory(room, '⏰', 'หมดเวลาเกม! เล่นให้ครบรอบนี้ แล้วนับทรัพย์สินหาผู้ชนะ', 'timeup');
    pushFx(room, { kind: 'timeUp' });
    bumpStep(room);
    return true;
}

function startTurn(room, index) {
    const state = st(room);
    const seat = state.seats[index];
    state.turnSeq = (Number(state.turnSeq) || 0) + 1;
    state.turn = {
        playerId: seat.playerId,
        seq: state.turnSeq,
        doublesStreak: 0,
        canRollAgain: false,
        hasRolled: false,
        lastRoll: null,
        startedAt: now()
    };
    state.pendingBuy = null;
    state.resume = null;
    pushFx(room, { kind: 'turn', playerId: seat.playerId, round: state.round });
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
    if (next < 0) {
        finishGame(room, 'ไม่มีผู้เล่นเหลือ');
        return;
    }
    const rel = i => ((i - state.firstSeat) % n + n) % n;
    const wrapped = rel(next) <= rel(from);
    checkClock(room);
    if (wrapped) {
        if (state.clock && state.clock.timeUp) {
            finishGame(room, 'หมดเวลา — นับทรัพย์สินรวม');
            return;
        }
        state.round = (Number(state.round) || 1) + 1;
    }
    startTurn(room, next);
}

function continueTurn(room) {
    const state = st(room);
    if (state.phase === 'finished') return;
    const turn = state.turn;
    const seat = turn ? seatOf(room, turn.playerId) : null;
    if (!seat || !isActive(seat)) {
        advanceTurn(room);
        return;
    }
    if (turn.canRollAgain && !seat.inJail) {
        setPhase(room, 'roll', TURN_MS, seat.playerId);
        return;
    }
    turn.canRollAgain = false;
    setPhase(room, 'manage', TURN_MS, seat.playerId);
}

/** ทำงานค้างตามลำดับ: หนี้ → ประมูล → ซื้อ → งานต่อเนื่อง (เช่นเดินหลังออกคุก) → ตาต่อไป */
function proceed(room) {
    const state = st(room);
    for (let guard = 0; guard < 50; guard += 1) {
        if (state.phase === 'finished') return;
        if (state.debts.length) {
            const debt = state.debts[0];
            const seat = seatOf(room, debt.debtorId);
            if (!isActive(seat)) { state.debts.shift(); continue; }
            const total = debtTotal(debt);
            if (seat.cash >= total) {
                state.debts.shift();
                settlePayees(room, seat, debt.payees, debt.reason, debt.meta || {});
                pushHistory(room, '💸', `${seat.name} จ่าย ${debt.reason} ${fmt(total)} แล้ว`, 'debtPaid');
                continue;
            }
            if (state.phase !== 'debt' || state.phaseActor !== seat.playerId) setPhase(room, 'debt', DEBT_MS, seat.playerId);
            return;
        }
        if (state.auction) {
            if (state.phase !== 'auction') setPhase(room, 'auction', null, null);
            state.phaseEndsAt = state.auction.endsAt;
            return;
        }
        if (state.pendingBuy !== null && state.pendingBuy !== undefined) {
            const turnSeat = state.turn ? seatOf(room, state.turn.playerId) : null;
            if (!isActive(turnSeat)) {
                state.pendingBuy = null;
                continue;
            }
            if (state.phase !== 'buy') setPhase(room, 'buy', TURN_MS, turnSeat.playerId);
            return;
        }
        if (state.resume) {
            const job = state.resume;
            state.resume = null;
            runResume(room, job);
            continue;
        }
        continueTurn(room);
        return;
    }
}

function runResume(room, job) {
    const seat = seatOf(room, job.playerId);
    if (!isActive(seat)) return;
    if (job.type === 'move') moveSteps(room, seat, job.steps, { dice: job.dice });
}

// ---------- เดิน / ตกช่อง ----------

/**
 * เต๋า 2 ลูก ลูกละ 1–6 เสมอ · bias = { power: 0..1, green: bool } จากการกดค้าง
 *  - แรง: แต่ละลูกมีโอกาส = power ที่จะทอยซ้ำแล้วเอาค่าที่สูงกว่า (แรงสุดเฉลี่ย +1.94 จาก 7)
 *  - ช่องเขียว: ถ้ายังไม่ดับเบิล เปลี่ยนลูกที่สองให้เท่าลูกแรกด้วยโอกาส 20% (ดับเบิล ~1/6 → ~1/3)
 * ไม่มี bias = ทอยยุติธรรมปกติ
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

/** ตารางช่องเขียวของการกดครั้งนี้ (หรือ null) — ช่วงที่โผล่ยาวพอให้เข็มผ่านกลางช่องอย่างน้อยหนึ่งครั้ง */
function greenSchedule(rng, period) {
    if (rng() >= GREEN_SPAWN) return null;
    const appearAt = Math.round(300 + rng() * 900);
    const life = Math.round(period * (0.8 + rng() * 0.3));
    return {
        appearAt,
        until: appearAt + life,
        center: Math.round((0.3 + rng() * 0.55) * 1000) / 1000,
        width: Math.round((0.09 + rng() * 0.05) * 1000) / 1000
    };
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
    for (let i = 1; i <= Math.abs(steps); i += 1) path.push(((from + dir * i) % 40 + 40) % 40);
    return path;
}

function moveSteps(room, seat, steps, opts = {}) {
    const from = seat.pos;
    const to = ((from + steps) % 40 + 40) % 40;
    const passGo = steps > 0 && from + steps >= 40;
    seat.pos = to;
    pushFx(room, { kind: 'move', playerId: seat.playerId, from, to, steps, path: pathBetween(from, steps), passGo });
    if (passGo) paySalary(room, seat);
    land(room, seat, opts);
}

function moveForwardTo(room, seat, target, opts = {}) {
    const steps = ((target - seat.pos) % 40 + 40) % 40;
    moveSteps(room, seat, steps === 0 ? 40 : steps, opts);
}

function paySalary(room, seat) {
    bankPays(room, seat, B.SALARY);
    pushFx(room, { kind: 'salary', playerId: seat.playerId, amount: B.SALARY, cash: cashMap(room, [seat.playerId]) });
    pushHistory(room, '💰', `${seat.name} ผ่านจุดเริ่ม รับเงินเดือน ${fmt(B.SALARY)}`, 'salary');
}

function sendToJail(room, seat, reason) {
    const state = st(room);
    const from = seat.pos;
    seat.pos = B.JAIL_SQUARE;
    seat.inJail = true;
    seat.jailTurns = 0;
    if (state.turn && state.turn.playerId === seat.playerId) state.turn.canRollAgain = false;
    pushFx(room, { kind: 'jail', playerId: seat.playerId, from, reason });
    pushHistory(room, '🚔', `${seat.name} ${reason} — เข้าคุก`, 'jail');
}

function land(room, seat, opts = {}) {
    const state = st(room);
    if (!isActive(seat) || state.phase === 'finished') return;
    const index = seat.pos;
    const sq = B.SQUARES[index];
    if (sq.type === 'gotojail') {
        sendToJail(room, seat, 'ตกช่องไปคุก');
        return;
    }
    if (sq.type === 'tax') {
        pushHistory(room, '🧾', `${seat.name} จ่าย${sq.name} ${fmt(sq.amount)}`, 'tax');
        charge(room, seat, [{ to: null, amount: sq.amount }], sq.name, { square: index });
        return;
    }
    if (sq.type === 'chance' || sq.type === 'fortune') {
        drawCard(room, seat, sq.type, opts);
        return;
    }
    if (sq.type === 'property' || sq.type === 'transport' || sq.type === 'utility') {
        const p = prop(room, index);
        if (!p.owner) {
            state.pendingBuy = index;
            return;
        }
        if (p.owner === seat.playerId) return;
        const owner = seatOf(room, p.owner);
        if (!isActive(owner)) return;
        if (p.mortgaged) {
            pushHistory(room, '🏦', `${seat.name} ตก${sq.name} (จำนองอยู่) — ไม่ต้องจ่ายค่าเช่า`, 'free');
            return;
        }
        let diceTotal = opts.dice || 7;
        if (sq.type === 'utility' && opts.utilityRoll) {
            const pair = nextDice(room, opts.rng || Math.random);
            diceTotal = pair[0] + pair[1];
            pushFx(room, { kind: 'dice', playerId: seat.playerId, d: pair, doubles: false, purpose: 'utility' });
        }
        const rent = rentFor(room, index, diceTotal, { mult: opts.mult });
        if (rent <= 0) return;
        pushHistory(room, '🏠', `${seat.name} จ่ายค่าเช่า${sq.name} ${fmt(rent)} ให้ ${owner.name}`, 'rent');
        charge(room, seat, [{ to: owner.playerId, amount: rent }], `ค่าเช่า${sq.name}`, { kind: 'rent', square: index });
    }
}

function publicCard(card, deck) {
    return { id: card.id, deck, title: card.title, text: card.text, icon: card.icon, type: card.effect.type };
}

function drawCard(room, seat, deckName, opts = {}) {
    const state = st(room);
    const deck = state.decks[deckName];
    if (!deck.length) return;
    const cardId = deck.shift();
    const card = B.CARD_BY_ID.get(cardId);
    if (card.effect.type !== 'jailCard') deck.push(cardId);
    const deckLabel = deckName === 'chance' ? 'โอกาส' : 'ดวงชะตา';
    pushFx(room, { kind: 'card', playerId: seat.playerId, deck: deckName, card: publicCard(card, deckName) });
    pushHistory(room, deckName === 'chance' ? '❓' : '🔮', `${seat.name} เปิด${deckLabel}: ${card.title} — ${card.text}`, 'card');
    const depth = (opts.depth || 0) + 1;
    const fx = card.effect;
    switch (fx.type) {
        case 'advance':
            moveForwardTo(room, seat, fx.to, { depth, rng: opts.rng });
            break;
        case 'nearest': {
            const list = fx.kind === 'utility' ? B.UTILITY_SQUARES : B.TRANSPORT_SQUARES;
            const target = list.find(i => i > seat.pos) ?? list[0];
            moveForwardTo(room, seat, target, { depth, mult: fx.mult, utilityRoll: fx.kind === 'utility', rng: opts.rng });
            break;
        }
        case 'back':
            moveSteps(room, seat, -fx.steps, { depth, dice: opts.dice, rng: opts.rng });
            break;
        case 'jail':
            sendToJail(room, seat, card.title);
            break;
        case 'jailCard':
            seat.jailCards = [...(seat.jailCards || []), cardId];
            break;
        case 'repairs': {
            let houses = 0;
            let hotels = 0;
            ownedSquares(room, seat.playerId).forEach(i => {
                const h = prop(room, i).houses;
                if (h === 5) hotels += 1;
                else houses += h;
            });
            const amount = houses * fx.house + hotels * fx.hotel;
            if (amount > 0) charge(room, seat, [{ to: null, amount }], card.title);
            break;
        }
        case 'gain':
            bankPays(room, seat, fx.amount);
            pushFx(room, { kind: 'gain', playerId: seat.playerId, amount: fx.amount, reason: card.title, cash: cashMap(room, [seat.playerId]) });
            break;
        case 'pay':
            charge(room, seat, [{ to: null, amount: fx.amount }], card.title);
            break;
        case 'payEach': {
            const payees = activeSeats(room).filter(s => s !== seat).map(s => ({ to: s.playerId, amount: fx.amount }));
            charge(room, seat, payees, card.title);
            break;
        }
        case 'collectEach':
            activeSeats(room).filter(s => s !== seat).forEach(other => {
                if (isActive(seat)) charge(room, other, [{ to: seat.playerId, amount: fx.amount }], card.title);
            });
            break;
        default:
            break;
    }
}

function announceNewSets(room, playerId, squares) {
    const groups = new Set(squares.map(i => B.SQUARES[i].group).filter(Boolean));
    groups.forEach(group => {
        if (ownsGroup(room, playerId, group)) {
            const seat = seatOf(room, playerId);
            pushFx(room, { kind: 'set', playerId, group });
            pushHistory(room, '🎉', `${seat ? seat.name : ''} ครบชุดสี${B.GROUPS[group].name} (${B.GROUPS[group].region}) — ค่าเช่าเป็น 2 เท่า สร้างบ้านได้`, 'set');
        }
    });
}

// ---------- ตรวจคำสั่ง ----------

function assertPlaying(room) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished' || state.phase === 'lobby') {
        throw new Error('เกมยังไม่เริ่มหรือจบแล้ว');
    }
}

function assertActor(room, playerId, phases, ctx) {
    assertPlaying(room);
    const state = st(room);
    const list = Array.isArray(phases) ? phases : [phases];
    if (!list.includes(state.phase)) throw new Error('ตอนนี้ทำแบบนี้ไม่ได้');
    if (state.phaseActor !== playerId) throw new Error('ยังไม่ถึงตาคุณ');
    if (ctx && ctx.seq !== undefined && ctx.seq !== null && Number(ctx.seq) !== Number(state.phaseSeq)) {
        throw new Error('สถานะเปลี่ยนไปแล้ว ลองอีกครั้ง');
    }
    const seat = seatOf(room, playerId);
    if (!isActive(seat)) throw new Error('คุณไม่ได้อยู่ในเกมแล้ว');
    return seat;
}

function assertSquare(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || !B.OWNABLE.includes(i)) throw new Error('ไม่มีที่ดินนี้');
    return i;
}

// ---------- คำสั่งผู้เล่น ----------

function rollDice(room, playerId, ctx = null, rng = Math.random, bias = null) {
    const seat = assertActor(room, playerId, 'roll', ctx);
    const state = st(room);
    const turn = state.turn;
    state.rollHold = null;
    const [a, b] = nextDice(room, rng, bias);
    const throwInfo = bias ? { power: Math.round((bias.power || 0) * 100) / 100, perfect: !!bias.green, elapsed: bias.elapsed } : {};
    const doubles = a === b;
    const total = a + b;
    turn.lastRoll = [a, b];
    turn.hasRolled = true;
    turn.canRollAgain = false;

    if (seat.inJail) {
        pushFx(room, { kind: 'dice', playerId, d: [a, b], doubles, purpose: 'jail', ...throwInfo });
        if (doubles) {
            seat.inJail = false;
            seat.jailTurns = 0;
            pushFx(room, { kind: 'jailFree', playerId, how: 'doubles' });
            pushHistory(room, '🎲', `${seat.name} ทอยได้ดับเบิล ${a}+${b} ออกจากคุก!`, 'jailFree');
            moveSteps(room, seat, total, { dice: total, rng });
        } else {
            seat.jailTurns += 1;
            if (seat.jailTurns >= 3) {
                seat.inJail = false;
                seat.jailTurns = 0;
                pushFx(room, { kind: 'jailFree', playerId, how: 'forced' });
                pushHistory(room, '🔓', `${seat.name} ติดคุกครบ 3 ตา — จ่ายค่าปรับ ${fmt(B.JAIL_FINE)} แล้วเดิน ${total} ช่อง`, 'jailFree');
                state.resume = { type: 'move', playerId, steps: total, dice: total };
                charge(room, seat, [{ to: null, amount: B.JAIL_FINE }], 'ค่าปรับออกคุก');
            } else {
                pushHistory(room, '🔒', `${seat.name} ทอย ${a}+${b} ไม่ได้ดับเบิล — ยังติดคุก (ครั้งที่ ${seat.jailTurns}/3)`, 'jailStay');
            }
        }
        markAction(room, 'roll');
        proceed(room);
        return state;
    }

    if (doubles) turn.doublesStreak += 1;
    pushFx(room, { kind: 'dice', playerId, d: [a, b], doubles, streak: turn.doublesStreak, ...throwInfo });
    if (doubles && turn.doublesStreak >= 3) {
        sendToJail(room, seat, 'ทอยดับเบิล 3 ครั้งติด');
        markAction(room, 'roll');
        proceed(room);
        return state;
    }
    turn.canRollAgain = doubles;
    pushHistory(room, '🎲', `${seat.name} ทอย ${a}+${b} = ${total}${doubles ? ' (ดับเบิล! ได้ทอยอีก)' : ''} → ${sqName((seat.pos + total) % 40)}`, 'roll');
    moveSteps(room, seat, total, { dice: total, rng });
    markAction(room, 'roll');
    proceed(room);
    return state;
}

/** เริ่มกดค้าง: สุ่มคาบเข็มกับช่องเขียวของการกดครั้งนี้ คืนค่าให้คนทอยคนเดียว */
function startRollHold(room, playerId, ctx = null, rng = Math.random) {
    assertActor(room, playerId, 'roll', ctx);
    const state = st(room);
    const period = Math.round(1000 + rng() * 500);
    const hold = {
        playerId,
        phaseSeq: state.phaseSeq,
        startedAt: now(),
        period,
        green: greenSchedule(rng, period)
    };
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
    return rollDice(room, playerId, null, rng, m.tap ? null : { power: m.power, green: m.green, elapsed: Math.round(used) });
}

function cancelRollHold(room, playerId) {
    const state = st(room);
    if (state && state.rollHold && state.rollHold.playerId === playerId) {
        state.rollHold = null;
        return true;
    }
    return false;
}

function payJailFine(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'roll', ctx);
    if (!seat.inJail) throw new Error('คุณไม่ได้ติดคุก');
    if (seat.cash < B.JAIL_FINE) throw new Error(`ต้องมีเงินสด ${fmt(B.JAIL_FINE)} (จำนองที่ดินก่อนได้)`);
    paysBank(room, seat, B.JAIL_FINE);
    seat.inJail = false;
    seat.jailTurns = 0;
    pushFx(room, { kind: 'pay', from: playerId, to: null, amount: B.JAIL_FINE, reason: 'ค่าปรับออกคุก', cash: cashMap(room, [playerId]) });
    pushFx(room, { kind: 'jailFree', playerId, how: 'fine' });
    pushHistory(room, '🔓', `${seat.name} จ่ายค่าปรับ ${fmt(B.JAIL_FINE)} ออกจากคุก`, 'jailFree');
    markAction(room, 'jailFine');
    return st(room);
}

function useJailCard(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'roll', ctx);
    if (!seat.inJail) throw new Error('คุณไม่ได้ติดคุก');
    if (!seat.jailCards || !seat.jailCards.length) throw new Error('คุณไม่มีบัตรอภัยโทษ');
    const cardId = seat.jailCards.shift();
    st(room).decks[cardId.startsWith('c') ? 'chance' : 'fortune'].push(cardId);
    seat.inJail = false;
    seat.jailTurns = 0;
    pushFx(room, { kind: 'jailFree', playerId, how: 'card' });
    pushHistory(room, '🗝️', `${seat.name} ใช้บัตรอภัยโทษ ออกจากคุก`, 'jailFree');
    markAction(room, 'jailCard');
    return st(room);
}

function buyProperty(room, playerId, ctx = null) {
    const seat = assertActor(room, playerId, 'buy', ctx);
    const state = st(room);
    const index = state.pendingBuy;
    const sq = B.SQUARES[index];
    if (seat.cash < sq.price) throw new Error(`เงินสดไม่พอ (ต้องการ ${fmt(sq.price)})`);
    paysBank(room, seat, sq.price);
    prop(room, index).owner = playerId;
    state.pendingBuy = null;
    pushFx(room, { kind: 'buy', playerId, square: index, price: sq.price, cash: cashMap(room, [playerId]) });
    pushHistory(room, '🏷️', `${seat.name} ซื้อ${sq.name} ${fmt(sq.price)}`, 'buy');
    announceNewSets(room, playerId, [index]);
    markAction(room, 'buy');
    proceed(room);
    return state;
}

function declineBuy(room, playerId, ctx = null) {
    assertActor(room, playerId, 'buy', ctx);
    startAuction(room, st(room).pendingBuy);
    markAction(room, 'decline');
    proceed(room);
    return st(room);
}

function startAuction(room, index) {
    const state = st(room);
    state.pendingBuy = null;
    state.auctionSeq = (Number(state.auctionSeq) || 0) + 1;
    const at = now();
    state.auction = { id: state.auctionSeq, square: index, high: 0, leader: null, bids: [], startedAt: at, endsAt: at + AUCTION_START_MS };
    pushFx(room, { kind: 'auctionStart', square: index });
    pushHistory(room, '🔨', `เปิดประมูล${sqName(index)} (ราคาตั้ง ${fmt(B.SQUARES[index].price)}) — ใครก็เสนอได้`, 'auction');
}

function minBid(auction) {
    return auction.high > 0 ? auction.high + MIN_BID_STEP : MIN_BID_STEP;
}

function placeBid(room, playerId, amount) {
    assertPlaying(room);
    const state = st(room);
    if (state.phase !== 'auction' || !state.auction) throw new Error('ไม่มีการประมูลตอนนี้');
    const seat = seatOf(room, playerId);
    if (!isActive(seat)) throw new Error('คุณไม่ได้อยู่ในเกมแล้ว');
    const a = state.auction;
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value)) throw new Error('จำนวนเงินไม่ถูกต้อง');
    if (a.leader === playerId) throw new Error('คุณเสนอสูงสุดอยู่แล้ว');
    if (value < minBid(a)) throw new Error(`ต้องเสนออย่างน้อย ${fmt(minBid(a))}`);
    if (value > seat.cash) throw new Error('เงินสดไม่พอสำหรับราคานี้');
    a.high = value;
    a.leader = playerId;
    a.bids = [...a.bids, { playerId, amount: value, at: now() }].slice(-30);
    a.endsAt = Math.max(a.endsAt, now() + AUCTION_BID_MS);
    state.phaseEndsAt = a.endsAt;
    pushFx(room, { kind: 'bid', playerId, amount: value, square: a.square });
    markAction(room, 'bid');
    return state;
}

function finishAuction(room) {
    const state = st(room);
    const a = state.auction;
    if (!a) return;
    state.auction = null;
    const winner = a.leader ? seatOf(room, a.leader) : null;
    if (winner && isActive(winner) && winner.cash >= a.high && a.high > 0) {
        paysBank(room, winner, a.high);
        prop(room, a.square).owner = winner.playerId;
        pushFx(room, { kind: 'auctionEnd', square: a.square, winner: winner.playerId, amount: a.high, cash: cashMap(room, [winner.playerId]) });
        pushHistory(room, '🔨', `ปัง! ${winner.name} ประมูล${sqName(a.square)}ได้ที่ ${fmt(a.high)}`, 'auctionWon');
        announceNewSets(room, winner.playerId, [a.square]);
    } else {
        pushFx(room, { kind: 'auctionEnd', square: a.square, winner: null, amount: 0 });
        pushHistory(room, '🔨', `ไม่มีใครประมูล${sqName(a.square)} — ยังเป็นของธนาคาร`, 'auctionNone');
    }
    markAction(room, 'auctionEnd');
    proceed(room);
}

function endTurn(room, playerId, ctx = null) {
    assertActor(room, playerId, 'manage', ctx);
    markAction(room, 'endTurn');
    advanceTurn(room);
    return st(room);
}

// ---------- จัดการทรัพย์สิน ----------

function managePhase(room, playerId, kind) {
    assertPlaying(room);
    const state = st(room);
    const seat = seatOf(room, playerId);
    if (!isActive(seat)) throw new Error('คุณไม่ได้อยู่ในเกมแล้ว');
    if (state.phase === 'debt') {
        if (state.phaseActor !== playerId) throw new Error('รอคนที่ติดหนี้จัดการก่อน');
        if (kind === 'build' || kind === 'unmortgage') throw new Error('ตอนติดหนี้ ขายบ้านหรือจำนองได้อย่างเดียว');
        return seat;
    }
    if (!['roll', 'buy', 'manage'].includes(state.phase) || state.phaseActor !== playerId) {
        throw new Error('จัดการทรัพย์สินได้เฉพาะตาของคุณ');
    }
    return seat;
}

function canBuild(room, playerId, index) {
    const sq = B.SQUARES[index];
    const p = prop(room, index);
    if (sq.type !== 'property' || p.owner !== playerId) return 'ไม่ใช่ที่ดินของคุณ';
    if (!ownsGroup(room, playerId, sq.group)) return 'ต้องมีครบทั้งชุดสีก่อน';
    if (groupMortgaged(room, sq.group)) return 'ไถ่ถอนที่ดินในชุดนี้ให้หมดก่อน';
    if (p.houses >= 5) return 'มีโรงแรมแล้ว';
    const min = Math.min(...groupSquares(sq.group).map(i => prop(room, i).houses));
    if (p.houses > min) return 'ต้องสร้างให้เท่ากันทั้งชุดก่อน';
    return null;
}

function canSell(room, playerId, index) {
    const sq = B.SQUARES[index];
    const p = prop(room, index);
    if (sq.type !== 'property' || p.owner !== playerId) return 'ไม่ใช่ที่ดินของคุณ';
    if (p.houses <= 0) return 'ไม่มีบ้านให้ขาย';
    const max = Math.max(...groupSquares(sq.group).map(i => prop(room, i).houses));
    if (p.houses < max) return 'ต้องขายจากแปลงที่มีบ้านมากที่สุดก่อน';
    return null;
}

function canMortgage(room, playerId, index) {
    const sq = B.SQUARES[index];
    const p = prop(room, index);
    if (!p || p.owner !== playerId) return 'ไม่ใช่ที่ดินของคุณ';
    if (p.mortgaged) return 'จำนองอยู่แล้ว';
    if (sq.type === 'property' && groupHasBuildings(room, sq.group)) return 'ขายบ้านในชุดนี้ให้หมดก่อน';
    return null;
}

function canUnmortgage(room, playerId, index) {
    const p = prop(room, index);
    if (!p || p.owner !== playerId) return 'ไม่ใช่ที่ดินของคุณ';
    if (!p.mortgaged) return 'ไม่ได้จำนองอยู่';
    return null;
}

function afterManage(room, kind) {
    markAction(room, kind);
    if (st(room).phase === 'debt') proceed(room);
}

function build(room, playerId, index) {
    const seat = managePhase(room, playerId, 'build');
    const i = assertSquare(index);
    const reason = canBuild(room, playerId, i);
    if (reason) throw new Error(reason);
    const cost = houseCost(i);
    if (seat.cash < cost) throw new Error(`เงินสดไม่พอ (ต้องการ ${fmt(cost)})`);
    paysBank(room, seat, cost);
    const p = prop(room, i);
    p.houses += 1;
    pushFx(room, { kind: 'build', playerId, square: i, houses: p.houses, cost, cash: cashMap(room, [playerId]) });
    pushHistory(room, p.houses === 5 ? '🏨' : '🏠', `${seat.name} ${p.houses === 5 ? 'สร้างโรงแรม' : 'สร้างบ้านหลังที่ ' + p.houses} ที่${sqName(i)} (${fmt(cost)})`, 'build');
    afterManage(room, 'build');
    return st(room);
}

function sellBuilding(room, playerId, index) {
    const seat = managePhase(room, playerId, 'sell');
    const i = assertSquare(index);
    const reason = canSell(room, playerId, i);
    if (reason) throw new Error(reason);
    const refund = Math.floor(houseCost(i) / 2);
    const p = prop(room, i);
    p.houses -= 1;
    bankPays(room, seat, refund);
    pushFx(room, { kind: 'sell', playerId, square: i, houses: p.houses, amount: refund, cash: cashMap(room, [playerId]) });
    pushHistory(room, '🔧', `${seat.name} ขาย${p.houses === 4 ? 'โรงแรม' : 'บ้าน'}ที่${sqName(i)} คืนธนาคาร ได้ ${fmt(refund)}`, 'sell');
    afterManage(room, 'sell');
    return st(room);
}

function mortgage(room, playerId, index) {
    const seat = managePhase(room, playerId, 'mortgage');
    const i = assertSquare(index);
    const reason = canMortgage(room, playerId, i);
    if (reason) throw new Error(reason);
    const value = mortgageValue(i);
    prop(room, i).mortgaged = true;
    bankPays(room, seat, value);
    pushFx(room, { kind: 'mortgage', playerId, square: i, amount: value, cash: cashMap(room, [playerId]) });
    pushHistory(room, '🏦', `${seat.name} จำนอง${sqName(i)} ได้ ${fmt(value)}`, 'mortgage');
    afterManage(room, 'mortgage');
    return st(room);
}

function unmortgage(room, playerId, index) {
    const seat = managePhase(room, playerId, 'unmortgage');
    const i = assertSquare(index);
    const reason = canUnmortgage(room, playerId, i);
    if (reason) throw new Error(reason);
    const cost = unmortgageCost(i);
    if (seat.cash < cost) throw new Error(`เงินสดไม่พอ (ต้องการ ${fmt(cost)})`);
    paysBank(room, seat, cost);
    prop(room, i).mortgaged = false;
    pushFx(room, { kind: 'unmortgage', playerId, square: i, amount: cost, cash: cashMap(room, [playerId]) });
    pushHistory(room, '🔑', `${seat.name} ไถ่ถอน${sqName(i)} ${fmt(cost)}`, 'unmortgage');
    afterManage(room, 'unmortgage');
    return st(room);
}

/** ขายบ้าน/จำนองอัตโนมัติจนเงินสดถึง target (ใช้กับบอทและ autopilot) */
function autoLiquidate(room, seat, target) {
    for (let guard = 0; guard < 200 && seat.cash < target; guard += 1) {
        const owned = ownedSquares(room, seat.playerId);
        const mortgageable = owned
            .filter(i => !canMortgage(room, seat.playerId, i))
            .sort((a, b) => {
                const ga = B.SQUARES[a].group;
                const gb = B.SQUARES[b].group;
                const sa = ga && ownsGroup(room, seat.playerId, ga) ? 1 : 0;
                const sb = gb && ownsGroup(room, seat.playerId, gb) ? 1 : 0;
                return sa - sb || mortgageValue(a) - mortgageValue(b);
            });
        if (mortgageable.length) {
            const i = mortgageable[0];
            prop(room, i).mortgaged = true;
            bankPays(room, seat, mortgageValue(i));
            pushFx(room, { kind: 'mortgage', playerId: seat.playerId, square: i, amount: mortgageValue(i), cash: cashMap(room, [seat.playerId]) });
            pushHistory(room, '🏦', `${seat.name} จำนอง${sqName(i)} ได้ ${fmt(mortgageValue(i))}`, 'mortgage');
            continue;
        }
        const sellable = owned.filter(i => !canSell(room, seat.playerId, i)).sort((a, b) => houseCost(a) - houseCost(b));
        if (!sellable.length) break;
        const i = sellable[0];
        const p = prop(room, i);
        p.houses -= 1;
        const refund = Math.floor(houseCost(i) / 2);
        bankPays(room, seat, refund);
        pushFx(room, { kind: 'sell', playerId: seat.playerId, square: i, houses: p.houses, amount: refund, cash: cashMap(room, [seat.playerId]) });
        pushHistory(room, '🔧', `${seat.name} ขายบ้านที่${sqName(i)} ได้ ${fmt(refund)}`, 'sell');
    }
    bumpStep(room);
}

// ---------- เทรด ----------

function cleanSide(raw) {
    const side = raw && typeof raw === 'object' ? raw : {};
    const props = Array.isArray(side.props) ? [...new Set(side.props.map(Number).filter(i => B.OWNABLE.includes(i)))] : [];
    return {
        cash: Math.max(0, Math.floor(Number(side.cash) || 0)),
        props: props.slice(0, 28),
        jailCards: Math.max(0, Math.min(2, Math.floor(Number(side.jailCards) || 0)))
    };
}

function sideEmpty(side) {
    return !side.cash && !side.props.length && !side.jailCards;
}

/** ตรวจว่าฝั่ง owner ให้ของตามรายการได้จริงตอนนี้ · คืนข้อความผิดพลาดหรือ null */
function validateSide(room, ownerSeat, side) {
    if (side.cash > ownerSeat.cash) return `${ownerSeat.name} มีเงินสดไม่พอ`;
    if (side.jailCards > (ownerSeat.jailCards || []).length) return `${ownerSeat.name} ไม่มีบัตรอภัยโทษพอ`;
    for (const i of side.props) {
        const p = prop(room, i);
        if (!p || p.owner !== ownerSeat.playerId) return `${sqName(i)} ไม่ใช่ของ ${ownerSeat.name}`;
        const sq = B.SQUARES[i];
        if (sq.type === 'property' && groupHasBuildings(room, sq.group)) return `${sqName(i)} อยู่ในชุดที่มีบ้าน — ขายบ้านก่อนจึงแลกได้`;
    }
    return null;
}

function validateTrade(room, from, to, give, get) {
    if (!isActive(from) || !isActive(to)) return 'ผู้เล่นคนนี้ไม่ได้อยู่ในเกมแล้ว';
    if (from === to) return 'เทรดกับตัวเองไม่ได้';
    if (sideEmpty(give) && sideEmpty(get)) return 'ใส่ของที่จะแลกอย่างน้อยหนึ่งอย่าง';
    return validateSide(room, from, give) || validateSide(room, to, get);
}

function proposeTrade(room, playerId, offer = {}, opts = {}) {
    assertPlaying(room);
    const state = st(room);
    const from = seatOf(room, playerId);
    if (!isActive(from)) throw new Error('คุณไม่ได้อยู่ในเกมแล้ว');
    const to = seatOf(room, offer.to);
    if (!to) throw new Error('ไม่พบผู้เล่นที่จะเทรดด้วย');
    if (state.trades.some(t => t.from === playerId && t.id !== opts.replacing)) throw new Error('คุณมีข้อเสนอค้างอยู่ — ยกเลิกก่อนส่งใหม่');
    const give = cleanSide(offer.give);
    const get = cleanSide(offer.get);
    const error = validateTrade(room, from, to, give, get);
    if (error) throw new Error(error);
    state.tradeSeq = (Number(state.tradeSeq) || 0) + 1;
    const at = now();
    const trade = { id: state.tradeSeq, from: playerId, to: to.playerId, give, get, createdAt: at, expiresAt: at + TRADE_MS, counterOf: opts.counterOf || null };
    state.trades.push(trade);
    // คนที่ถึงตาอยู่ในดีล → ต่อเวลาตาให้มีเวลาคุย
    if (state.phaseActor && (state.phaseActor === playerId || state.phaseActor === to.playerId) && state.phaseEndsAt && state.phase !== 'auction') {
        state.phaseEndsAt = Math.max(state.phaseEndsAt, at + TRADE_GRACE_MS);
    }
    pushFx(room, { kind: 'tradeOffer', id: trade.id, from: playerId, to: to.playerId, counter: !!opts.counterOf });
    pushHistory(room, '🤝', `${from.name} ${opts.counterOf ? 'ยื่นข้อเสนอโต้กลับ' : 'ยื่นข้อเสนอเทรด'}ให้ ${to.name}`, 'tradeOffer');
    markAction(room, 'tradeOffer');
    return trade;
}

function findTrade(room, tradeId) {
    return st(room).trades.find(t => t.id === Number(tradeId)) || null;
}

function executeTrade(room, trade) {
    const from = seatOf(room, trade.from);
    const to = seatOf(room, trade.to);
    const moveSide = (giver, taker, side) => {
        if (side.cash) transfer(room, giver, taker, side.cash);
        side.props.forEach(i => { prop(room, i).owner = taker.playerId; });
        for (let k = 0; k < side.jailCards; k += 1) taker.jailCards.push(giver.jailCards.shift());
    };
    moveSide(from, to, trade.give);
    moveSide(to, from, trade.get);
    pushFx(room, {
        kind: 'trade', id: trade.id, from: from.playerId, to: to.playerId,
        give: trade.give, get: trade.get, cash: cashMap(room, [from.playerId, to.playerId])
    });
    const describe = side => [side.props.map(sqName).join(', '), side.cash ? fmt(side.cash) : '', side.jailCards ? `บัตรอภัยโทษ ${side.jailCards}` : ''].filter(Boolean).join(' + ') || 'ไม่มี';
    pushHistory(room, '🤝', `ดีลสำเร็จ! ${from.name} ให้ ${describe(trade.give)} · ${to.name} ให้ ${describe(trade.get)}`, 'trade');
    announceNewSets(room, from.playerId, trade.get.props);
    announceNewSets(room, to.playerId, trade.give.props);
}

function respondTrade(room, playerId, tradeId, accept) {
    assertPlaying(room);
    const state = st(room);
    const trade = findTrade(room, tradeId);
    if (!trade) throw new Error('ข้อเสนอนี้หมดอายุหรือถูกยกเลิกแล้ว');
    if (trade.to !== playerId) throw new Error('ข้อเสนอนี้ไม่ได้ส่งถึงคุณ');
    if (!accept) {
        state.trades = state.trades.filter(t => t !== trade);
        pushFx(room, { kind: 'tradeClosed', id: trade.id, from: trade.from, to: trade.to, reason: 'rejected' });
        pushHistory(room, '✋', `${seatOf(room, playerId).name} ปฏิเสธข้อเสนอของ ${seatOf(room, trade.from).name}`, 'tradeReject');
        markAction(room, 'tradeReject');
        return state;
    }
    if (state.phase === 'auction') throw new Error('รอประมูลจบก่อนแล้วค่อยตกลง');
    const error = validateTrade(room, seatOf(room, trade.from), seatOf(room, trade.to), trade.give, trade.get);
    if (error) {
        state.trades = state.trades.filter(t => t !== trade);
        pushFx(room, { kind: 'tradeClosed', id: trade.id, from: trade.from, to: trade.to, reason: 'invalid' });
        markAction(room, 'tradeInvalid');
        throw new Error('ดีลนี้ใช้ไม่ได้แล้ว: ' + error);
    }
    state.trades = state.trades.filter(t => t !== trade);
    executeTrade(room, trade);
    markAction(room, 'trade');
    if (state.phase === 'debt') proceed(room);
    return state;
}

function counterTrade(room, playerId, tradeId, offer = {}) {
    assertPlaying(room);
    const state = st(room);
    const trade = findTrade(room, tradeId);
    if (!trade) throw new Error('ข้อเสนอนี้หมดอายุหรือถูกยกเลิกแล้ว');
    if (trade.to !== playerId) throw new Error('ข้อเสนอนี้ไม่ได้ส่งถึงคุณ');
    const mine = state.trades.find(t => t.from === playerId);
    if (mine) throw new Error('คุณมีข้อเสนอค้างอยู่ — ยกเลิกก่อนโต้กลับ');
    // ตรวจข้อเสนอใหม่ก่อน ค่อยปิดข้อเสนอเดิม
    const created = proposeTrade(room, playerId, { ...offer, to: trade.from }, { counterOf: trade.id });
    state.trades = state.trades.filter(t => t.id !== trade.id);
    pushFx(room, { kind: 'tradeClosed', id: trade.id, from: trade.from, to: trade.to, reason: 'countered' });
    return created;
}

function cancelTrade(room, playerId, tradeId = null) {
    assertPlaying(room);
    const state = st(room);
    const trade = state.trades.find(t => t.from === playerId && (tradeId === null || tradeId === undefined || t.id === Number(tradeId)));
    if (!trade) throw new Error('ไม่มีข้อเสนอให้ยกเลิก');
    state.trades = state.trades.filter(t => t !== trade);
    pushFx(room, { kind: 'tradeClosed', id: trade.id, from: trade.from, to: trade.to, reason: 'cancelled' });
    markAction(room, 'tradeCancel');
    return state;
}

// ---------- เริ่ม / จบ ----------

/** options.dice (เทสเท่านั้น): รายการเต๋าที่จะออกก่อน เช่น [[6,6],[3,4]] · options.firstSeat */
function startGame(room, rng = Math.random, options = {}) {
    const roster = (room.players || []).filter(p => p.socketId || isBotId(p.playerId));
    if (roster.length < MIN_PLAYERS || roster.length > MAX_PLAYERS) {
        throw new Error(`เศรษฐีเล่นได้ ${MIN_PLAYERS}–${MAX_PLAYERS} คน`);
    }
    const state = resetRoomGame(room);
    const at = now();
    state.status = 'playing';
    state.config = normalizeConfig(room.settings || {});
    state.seats = roster.map((p, i) => ({
        playerId: p.playerId,
        // บอทมีรหัสท้ายชื่อไว้กันชื่อซ้ำทั้งเว็บ — ในโต๊ะชื่อไม่ซ้ำกันอยู่แล้ว ตัดออกให้อ่านง่าย
        name: isBotId(p.playerId) ? String(p.playerName || p.name || 'บอท').replace(/\s[0-9a-f]{2,4}$/i, '') : (p.playerName || p.name || 'ผู้เล่น'),
        color: p.color || '#f5c86b',
        avatar: p.avatar || '👤',
        avatarFrame: p.avatarFrame || 'none',
        token: i,
        tokenColor: TOKEN_COLORS[i % TOKEN_COLORS.length],
        cash: B.START_CASH,
        pos: 0,
        inJail: false,
        jailTurns: 0,
        jailCards: [],
        bankrupt: false,
        left: false,
        outOrder: 0
    }));
    state.props = {};
    B.OWNABLE.forEach(i => { state.props[i] = { owner: null, houses: 0, mortgaged: false }; });
    state.decks = {
        chance: shuffle(B.CHANCE.map(c => c.id), rng),
        fortune: shuffle(B.FORTUNE.map(c => c.id), rng)
    };
    state.ledger = { startTotal: state.seats.length * B.START_CASH, bankOut: 0, bankIn: 0 };
    state.clock = {
        minutes: state.config.minutes,
        startedAt: at,
        endsAt: state.config.minutes ? at + state.config.minutes * MINUTE_MS : null,
        timeUp: false
    };
    state.testDice = Array.isArray(options.dice) ? options.dice.map(d => d.slice()) : [];
    state.firstSeat = Number.isInteger(options.firstSeat) ? options.firstSeat : Math.floor(rng() * state.seats.length);
    state.round = 1;
    room.gameState = state;
    pushHistory(room, '💰', `เริ่มเกมเศรษฐี! ทุกคนได้ ${fmt(B.START_CASH)} · ${state.config.minutes ? 'เวลา ' + state.config.minutes + ' นาที' : 'เล่นจนเหลือคนสุดท้าย'}`, 'start');
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
    const wasActive = isActive(seat);

    if (wasActive) {
        ownedSquares(room, playerId).forEach(i => {
            const p = prop(room, i);
            p.owner = null;
            p.houses = 0;
            p.mortgaged = false;
        });
        if (seat.cash > 0) paysBank(room, seat, seat.cash);
        returnJailCards(room, seat);
    }
    seat.left = true;
    seat.inJail = false;
    removeFromPending(room, playerId);
    pushFx(room, { kind: 'left', playerId });
    pushHistory(room, '🚪', `${seat.name} ออกจากเกม — ทรัพย์สินคืนธนาคาร`, 'left');
    bumpStep(room);

    if (activeSeats(room).length <= 1) {
        const last = activeSeats(room)[0];
        finishGame(room, last ? `คนอื่นออกหมด — ${last.name} ชนะ` : 'ทุกคนออกจากเกม');
        return state;
    }
    if (state.phase === 'auction') {
        state.phaseEndsAt = state.auction ? state.auction.endsAt : state.phaseEndsAt;
        return state;
    }
    if (wasTurn) {
        state.pendingBuy = null;
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
    if (!state.phaseEndsAt) return null;
    let deadline = state.phaseEndsAt;
    const since = offlineSince(room, state.phaseActor, at);
    if (since !== null && state.phase !== 'auction') {
        const offlineDeadline = Math.max(state.phaseStartedAt || 0, since + OFFLINE_GRACE_MS) + OFFLINE_TURN_MS;
        deadline = Math.min(deadline, offlineDeadline);
    }
    return deadline;
}

/** เวลาเร็วสุดที่ต้องปลุก engine (หมดเวลาตา/ประมูล, ข้อเสนอหมดอายุ, นาฬิกาเกม) */
function nextDeadline(room, at = now()) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished') return null;
    const times = [];
    const d = effectiveDeadline(room, at);
    if (d) times.push(d);
    (state.trades || []).forEach(t => times.push(t.expiresAt));
    if (state.clock && state.clock.endsAt && !state.clock.timeUp) times.push(state.clock.endsAt);
    // ผู้เล่นที่ต้องทำอะไรอยู่ยังออนไลน์ แต่ถ้าหลุดภายหลังต้องเช็กใหม่ — runtime มี watchdog แยก
    return times.length ? Math.min(...times) : null;
}

/** ดูแลเวลาทั้งหมด · คืน true ถ้า state เปลี่ยน */
function tick(room, rng = Math.random) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished') return false;
    const at = now();
    let changed = checkClock(room);

    const expired = state.trades.filter(t => t.expiresAt <= at);
    if (expired.length) {
        state.trades = state.trades.filter(t => t.expiresAt > at);
        expired.forEach(t => pushFx(room, { kind: 'tradeClosed', id: t.id, from: t.from, to: t.to, reason: 'expired' }));
        bumpStep(room);
        changed = true;
    }

    const deadline = effectiveDeadline(room, at);
    if (!deadline || at < deadline) return changed;
    autopilot(room, rng);
    return true;
}

/** หมดเวลา: เล่นแบบปลอดภัยแทน — ทอย · ไม่ซื้อ (ส่งประมูล) · จบเทิร์น · หนี้ = ขาย/จำนองแล้วจ่าย */
function autopilot(room, rng = Math.random) {
    const state = st(room);
    const actor = state.phaseActor;
    const seat = actor ? seatOf(room, actor) : null;
    switch (state.phase) {
        case 'roll':
            if (seat) pushHistory(room, '⏰', `${seat.name} หมดเวลา — ทอยให้อัตโนมัติ`, 'auto');
            rollDice(room, actor, null, rng);
            break;
        case 'buy':
            if (seat) pushHistory(room, '⏰', `${seat.name} หมดเวลา — ไม่ซื้อ ส่งประมูล`, 'auto');
            declineBuy(room, actor, null);
            break;
        case 'manage':
            if (seat) pushHistory(room, '⏰', `${seat.name} หมดเวลา — จบเทิร์นให้`, 'auto');
            endTurn(room, actor, null);
            break;
        case 'debt': {
            const debt = state.debts[0];
            if (seat && debt) {
                pushHistory(room, '⏰', `${seat.name} หมดเวลา — ขายบ้าน/จำนองให้อัตโนมัติ`, 'auto');
                autoLiquidate(room, seat, debtTotal(debt));
                if (seat.cash < debtTotal(debt)) {
                    state.debts.shift();
                    declareBankrupt(room, seat, debt.payees.length === 1 ? debt.payees[0].to : null, debt.payees, debt.reason);
                }
            } else if (debt) {
                state.debts.shift();
            }
            markAction(room, 'autoDebt');
            proceed(room);
            break;
        }
        case 'auction':
            finishAuction(room);
            break;
        default:
            break;
    }
}

// ---------- บอท ----------

function botReserve(room) {
    // ช่วงต้นเกมกล้าซื้อ · มีคนสร้างบ้านแล้วเก็บเงินสำรองมากขึ้น
    const built = B.OWNABLE.some(i => prop(room, i).houses > 0);
    return built ? 220 : 120;
}

/** มูลค่าที่ดินในสายตาบอท (ไว้ประมูล/ตัดสินใจซื้อ) */
function botValue(room, seat, index) {
    const sq = B.SQUARES[index];
    let value = sq.price;
    if (sq.type === 'property') {
        const squares = groupSquares(sq.group);
        const mine = squares.filter(i => prop(room, i).owner === seat.playerId).length;
        const owners = new Set(squares.map(i => prop(room, i).owner).filter(id => id && id !== seat.playerId));
        if (mine === squares.length - 1) value *= 1.7;
        else if (mine > 0 && owners.size === 0) value *= 1.25;
        if (owners.size === 1) {
            const other = [...owners][0];
            const theirs = squares.filter(i => prop(room, i).owner === other).length;
            if (theirs === squares.length - 1) value *= 1.4; // กันคนอื่นครบชุด
        }
    } else if (sq.type === 'transport') {
        value *= 1 + 0.2 * countOwned(room, seat.playerId, 'transport');
    } else {
        value *= countOwned(room, seat.playerId, 'utility') ? 1.3 : 0.85;
    }
    return Math.round(value);
}

/** คะแนนตำแหน่งของผู้เล่น (ใช้ประเมินดีลเทรด) — คิดจากสภาพ props ที่ส่งมา */
function positionScore(props, playerId, cash) {
    let score = cash;
    Object.keys(B.GROUP_SQUARES).forEach(group => {
        const squares = B.GROUP_SQUARES[group];
        const mine = squares.filter(i => props[i].owner === playerId);
        const value = mine.reduce((sum, i) => sum + (props[i].mortgaged ? B.SQUARES[i].price * 0.45 : B.SQUARES[i].price), 0);
        score += value;
        const groupPrice = squares.reduce((sum, i) => sum + B.SQUARES[i].price, 0);
        if (mine.length === squares.length) score += groupPrice * 0.9;
        else if (mine.length === squares.length - 1) {
            const missing = squares.find(i => props[i].owner !== playerId);
            score += props[missing].owner ? groupPrice * 0.08 : groupPrice * 0.2;
        }
    });
    const transports = B.TRANSPORT_SQUARES.filter(i => props[i].owner === playerId).length;
    score += transports * 200 + transports * transports * 30;
    const utils = B.UTILITY_SQUARES.filter(i => props[i].owner === playerId).length;
    score += utils * 140 + (utils === 2 ? 80 : 0);
    return score;
}

function applyTradeToProps(room, trade) {
    const props = {};
    B.OWNABLE.forEach(i => { props[i] = { ...prop(room, i) }; });
    trade.give.props.forEach(i => { props[i].owner = trade.to; });
    trade.get.props.forEach(i => { props[i].owner = trade.from; });
    return props;
}

/** บอทรับดีลถ้าตัวเองดีขึ้นชัดเจนกว่าที่อีกฝ่ายดีขึ้น */
function botWantsTrade(room, botId, trade) {
    const state = st(room);
    const bot = seatOf(room, botId);
    const other = seatOf(room, trade.from === botId ? trade.to : trade.from);
    if (!isActive(bot) || !isActive(other)) return false;
    const before = {};
    B.OWNABLE.forEach(i => { before[i] = prop(room, i); });
    const after = applyTradeToProps(room, trade);
    const botIsFrom = trade.from === botId;
    const botCashDelta = (botIsFrom ? -trade.give.cash + trade.get.cash : trade.give.cash - trade.get.cash);
    const jailDelta = (botIsFrom ? trade.get.jailCards - trade.give.jailCards : trade.give.jailCards - trade.get.jailCards) * 40;
    const mine = positionScore(after, botId, bot.cash + botCashDelta) + jailDelta - positionScore(before, botId, bot.cash);
    const theirs = positionScore(after, other.playerId, other.cash - botCashDelta) - positionScore(before, other.playerId, other.cash);
    if (bot.cash + botCashDelta < 0) return false;
    if (bot.cash + botCashDelta < 60 && botCashDelta < 0) return false;
    void state;
    return mine - 0.85 * Math.max(0, theirs) > 25;
}

/** บอทลองขอซื้อที่ดินแปลงสุดท้ายที่ขาดเพื่อครบชุด (จำว่าเคยขอใครแล้ว ไม่ขอซ้ำถี่ ๆ) */
function botTradeIdea(room, seat) {
    const state = st(room);
    const memo = state.botMemo[seat.playerId] || (state.botMemo[seat.playerId] = { asked: {} });
    for (const group of Object.keys(B.GROUP_SQUARES)) {
        const squares = B.GROUP_SQUARES[group];
        const mine = squares.filter(i => prop(room, i).owner === seat.playerId);
        if (mine.length !== squares.length - 1) continue;
        const missing = squares.find(i => prop(room, i).owner !== seat.playerId);
        const owner = prop(room, missing).owner;
        if (!owner) continue;
        const ownerSeat = seatOf(room, owner);
        if (!isActive(ownerSeat) || groupHasBuildings(room, group)) continue;
        const key = `${missing}:${owner}`;
        if ((memo.asked[key] || 0) >= 2) continue;
        if (state.turn && memo.lastAskTurn === state.turn.seq) continue;
        const price = B.SQUARES[missing].price;
        const offer = Math.min(Math.round(price * (1.5 + 0.35 * (memo.asked[key] || 0)) / 10) * 10, seat.cash - botReserve(room));
        if (offer < price) continue;
        memo.asked[key] = (memo.asked[key] || 0) + 1;
        memo.lastAskTurn = state.turn ? state.turn.seq : 0;
        return { to: owner, give: { cash: offer, props: [], jailCards: 0 }, get: { cash: 0, props: [missing], jailCards: 0 } };
    }
    return null;
}

function botBuildTarget(room, seat) {
    const reserve = botReserve(room) + 60;
    const candidates = [];
    ownedSquares(room, seat.playerId).forEach(i => {
        if (B.SQUARES[i].type !== 'property') return;
        if (canBuild(room, seat.playerId, i)) return;
        if (seat.cash - houseCost(i) < reserve) return;
        candidates.push(i);
    });
    candidates.sort((a, b) => prop(room, a).houses - prop(room, b).houses || B.SQUARES[b].price - B.SQUARES[a].price);
    return candidates.length ? candidates[0] : null;
}

function botUnmortgageTarget(room, seat) {
    const list = ownedSquares(room, seat.playerId).filter(i => prop(room, i).mortgaged && seat.cash - unmortgageCost(i) > 450);
    list.sort((a, b) => B.SQUARES[b].price - B.SQUARES[a].price);
    return list.length ? list[0] : null;
}

/** ใครเป็นบอทที่ต้องขยับตอนนี้ (ไม่รวมเรื่องจังหวะเวลา) */
function botPending(room) {
    const state = st(room);
    if (!state || state.status !== 'playing' || state.phase === 'finished') return null;
    const tradeForBot = state.trades.find(t => isBotId(t.to) && isActive(seatOf(room, t.to)));
    if (tradeForBot) return { kind: 'trade', trade: tradeForBot };
    if (state.phase === 'auction' && state.auction) {
        const a = state.auction;
        const bidders = activeSeats(room).filter(seat => isBotId(seat.playerId) && a.leader !== seat.playerId);
        const want = bidders.map(seat => ({ seat, limit: Math.min(botValue(room, seat, a.square), seat.cash - 40) }))
            .filter(x => x.limit >= minBid(a))
            .sort((x, y) => y.limit - x.limit);
        if (want.length) return { kind: 'bid', seat: want[0].seat, limit: want[0].limit };
        return null;
    }
    if (state.phaseActor && isBotId(state.phaseActor) && ['roll', 'buy', 'manage', 'debt'].includes(state.phase)) {
        return { kind: 'actor', seat: seatOf(room, state.phaseActor) };
    }
    return null;
}

function botNeedsTurn(room) {
    return !!botPending(room);
}

/** หน่วงเวลาให้คนตามทัน: หลังทอยรอนานกว่า (เต๋า + เดิน) */
function botDelay(room, at = now()) {
    const state = st(room);
    const pending = botPending(room);
    if (!pending) return null;
    let wait = BOT_MS;
    if (state.lastActionKind === 'roll') wait = BOT_MS * 2.2;
    if (pending.kind === 'bid') wait = Math.round(BOT_MS * 0.8);
    if (pending.kind === 'trade') wait = Math.max(BOT_MS, (pending.trade.createdAt + BOT_MS * 1.5) - (state.lastActionAt || 0));
    const due = (state.lastActionAt || 0) + wait;
    return Math.max(60, due - at);
}

/** บอทขยับ 1 ครั้ง (ถ้าถึงเวลา) · คืน true ถ้าทำอะไรไป */
function playBotTurns(room, rng = Math.random, at = now()) {
    const state = st(room);
    const pending = botPending(room);
    if (!pending) return false;
    const delay = botDelay(room, at);
    if (delay !== null && delay > 70) return false;

    if (pending.kind === 'trade') {
        const accept = botWantsTrade(room, pending.trade.to, pending.trade);
        try {
            respondTrade(room, pending.trade.to, pending.trade.id, accept);
        } catch (error) {
            // ดีลใช้ไม่ได้แล้ว (ถูกตัดทิ้งใน respondTrade) — ถ้ายังค้างอยู่ให้ปฏิเสธ
            if (findTrade(room, pending.trade.id)) respondTrade(room, pending.trade.to, pending.trade.id, false);
        }
        return true;
    }
    if (pending.kind === 'bid') {
        const a = state.auction;
        const price = B.SQUARES[a.square].price;
        const round10 = x => Math.round(x / 10) * 10;
        // เปิดราคาแรงหน่อยแล้วค่อยขยับทีละ ~8% ของราคา การประมูลจะได้ไม่ยืดยาว
        const target = a.high < price * 0.5
            ? round10(price * (0.5 + rng() * 0.1))
            : a.high + Math.max(MIN_BID_STEP, round10(price * (0.06 + rng() * 0.04)));
        const amount = Math.min(pending.limit, Math.max(minBid(a), target));
        placeBid(room, pending.seat.playerId, amount);
        return true;
    }

    const seat = pending.seat;
    const id = seat.playerId;
    const ctx = { seq: state.phaseSeq };
    switch (state.phase) {
        case 'roll': {
            if (seat.inJail) {
                const unowned = B.OWNABLE.filter(i => !prop(room, i).owner).length;
                if (seat.jailCards.length && unowned > 6) { useJailCard(room, id, ctx); return true; }
                if (seat.cash >= B.JAIL_FINE + 300 && unowned > 10) { payJailFine(room, id, ctx); return true; }
            }
            // บอทกดค้างแบบสุ่ม: แรงสุ่ม บางทีโดนช่องเขียว
            rollDice(room, id, ctx, rng, { power: rng(), green: rng() < BOT_GREEN_HIT });
            return true;
        }
        case 'buy': {
            const index = state.pendingBuy;
            const price = B.SQUARES[index].price;
            const value = botValue(room, seat, index);
            const reserve = botReserve(room);
            const keen = value > price * 1.3;
            if (seat.cash >= price && (seat.cash - price >= reserve || (keen && seat.cash - price >= 40))) buyProperty(room, id, ctx);
            else declineBuy(room, id, ctx);
            return true;
        }
        case 'debt': {
            const debt = state.debts[0];
            autoLiquidate(room, seat, debtTotal(debt));
            if (seat.cash < debtTotal(debt)) {
                state.debts.shift();
                declareBankrupt(room, seat, debt.payees.length === 1 ? debt.payees[0].to : null, debt.payees, debt.reason);
            }
            markAction(room, 'botDebt');
            proceed(room);
            return true;
        }
        case 'manage': {
            let built = 0;
            for (let target = botBuildTarget(room, seat); target !== null && built < 3; target = botBuildTarget(room, seat)) {
                build(room, id, target);
                built += 1;
            }
            if (built) return true;
            const redeem = botUnmortgageTarget(room, seat);
            if (redeem !== null) { unmortgage(room, id, redeem); return true; }
            if (!state.trades.some(t => t.from === id)) {
                const idea = botTradeIdea(room, seat);
                if (idea) {
                    try { proposeTrade(room, id, idea); return true; } catch (error) { /* ดีลใช้ไม่ได้ ข้าม */ }
                }
            }
            endTurn(room, id, ctx);
            return true;
        }
        default:
            return false;
    }
}

// ---------- ส่งให้ client ----------

function manageOptions(room, viewerId) {
    const state = st(room);
    const seat = seatOf(room, viewerId);
    if (!isActive(seat) || state.status !== 'playing' || state.phase === 'finished') return null;
    const inDebt = state.phase === 'debt' && state.phaseActor === viewerId;
    const myTurn = ['roll', 'buy', 'manage'].includes(state.phase) && state.phaseActor === viewerId;
    if (!inDebt && !myTurn) return null;
    const out = {};
    ownedSquares(room, viewerId).forEach(i => {
        const opt = {};
        if (!inDebt && B.SQUARES[i].type === 'property' && !canBuild(room, viewerId, i)) opt.build = houseCost(i);
        if (!canSell(room, viewerId, i)) opt.sell = Math.floor(houseCost(i) / 2);
        if (!canMortgage(room, viewerId, i)) opt.mortgage = mortgageValue(i);
        if (!inDebt && !canUnmortgage(room, viewerId, i)) opt.unmortgage = unmortgageCost(i);
        out[i] = opt;
    });
    return out;
}

function getAvailableActions(room, viewerId) {
    const state = st(room);
    const seat = seatOf(room, viewerId);
    const playing = state.status === 'playing' && state.phase !== 'finished';
    const actor = playing && state.phaseActor === viewerId && isActive(seat);
    const out = {
        roll: false, payJail: false, useJailCard: false, buy: false, decline: false, endTurn: false,
        bid: null, trade: false, end: room.admin === viewerId && playing
    };
    if (!seat || !isActive(seat) || !playing) return out;
    if (actor && state.phase === 'roll') {
        out.roll = true;
        out.payJail = seat.inJail && seat.cash >= B.JAIL_FINE;
        out.useJailCard = seat.inJail && seat.jailCards.length > 0;
    }
    if (actor && state.phase === 'buy') {
        out.buy = seat.cash >= B.SQUARES[state.pendingBuy].price;
        out.decline = true;
    }
    if (actor && state.phase === 'manage') out.endTurn = true;
    if (state.phase === 'auction' && state.auction) {
        const a = state.auction;
        out.bid = { min: minBid(a), max: seat.cash, leading: a.leader === viewerId, can: a.leader !== viewerId && seat.cash >= minBid(a) };
    }
    out.trade = activeSeats(room).length > 1;
    return out;
}

function publicTrade(trade) {
    return { id: trade.id, from: trade.from, to: trade.to, give: trade.give, get: trade.get, expiresAt: trade.expiresAt, counterOf: trade.counterOf };
}

function buildClientState(room, viewerId) {
    const state = room.gameState || createInitialState();
    const seats = state.seats || [];
    const at = now();
    const viewer = seats.find(seat => seat.playerId === viewerId) || null;
    const debt = state.debts && state.debts[0];
    const props = {};
    Object.keys(state.props || {}).forEach(k => {
        const p = state.props[k];
        props[k] = { owner: p.owner, houses: p.houses, mortgaged: p.mortgaged };
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
        phaseEndsAt: state.status === 'playing' && state.phase !== 'finished' ? effectiveDeadline(room, at) : null,
        isHost: room.admin === viewerId,
        seats: seats.map(seat => ({
            playerId: seat.playerId,
            name: seat.name,
            avatar: seat.avatar,
            avatarFrame: seat.avatarFrame,
            color: seat.color,
            token: seat.token,
            tokenColor: seat.tokenColor,
            cash: seat.cash,
            pos: seat.pos,
            inJail: !!seat.inJail,
            jailTurns: seat.jailTurns || 0,
            jailCards: (seat.jailCards || []).length,
            bankrupt: !!seat.bankrupt,
            left: !!seat.left,
            online: isConnected(room, seat),
            isBot: isBotId(seat.playerId),
            isSelf: seat.playerId === viewerId,
            isTurn: !!(state.turn && state.turn.playerId === seat.playerId && state.phase !== 'finished'),
            netWorth: netWorth(room, seat),
            hasOffer: (state.trades || []).some(t => t.from === seat.playerId)
        })),
        props,
        pendingBuy: state.pendingBuy,
        auction: state.auction ? {
            id: state.auction.id,
            square: state.auction.square,
            high: state.auction.high,
            leader: state.auction.leader,
            endsAt: state.auction.endsAt,
            bids: state.auction.bids.slice(-6).map(b => ({ playerId: b.playerId, amount: b.amount }))
        } : null,
        debt: debt ? { debtorId: debt.debtorId, total: debtTotal(debt), reason: debt.reason, payees: debt.payees } : null,
        trades: (state.trades || []).filter(t => t.from === viewerId || t.to === viewerId).map(publicTrade),
        self: viewer ? {
            playerId: viewer.playerId,
            active: isActive(viewer),
            manage: manageOptions(room, viewerId),
            liquidation: liquidationValue(room, viewer)
        } : null,
        availableActions: getAvailableActions(room, viewerId),
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
            if ((seat.jailCards || []).length) problems.push(`${seat.name} ออก/ล้มละลายแต่ยังมีบัตรอภัยโทษ`);
        }
        if (seat.pos < 0 || seat.pos > 39) problems.push(`${seat.name} ตำแหน่งผิด ${seat.pos}`);
    });
    B.OWNABLE.forEach(i => {
        const p = prop(room, i);
        if (p.houses < 0 || p.houses > 5) problems.push(`${sqName(i)} บ้าน ${p.houses}`);
        if (p.houses > 0 && !p.owner) problems.push(`${sqName(i)} มีบ้านแต่ไม่มีเจ้าของ`);
        if (p.mortgaged && !p.owner) problems.push(`${sqName(i)} จำนองแต่ไม่มีเจ้าของ`);
        if (p.mortgaged && p.houses > 0) problems.push(`${sqName(i)} จำนองแต่มีบ้าน`);
        if (p.owner && !isActive(seatOf(room, p.owner))) problems.push(`${sqName(i)} เจ้าของไม่อยู่ในเกม`);
        if (B.SQUARES[i].type !== 'property' && p.houses > 0) problems.push(`${sqName(i)} สร้างบ้านบนช่องที่ห้าม`);
        if (p.mortgaged && rentFor(room, i, 7) !== 0) problems.push(`${sqName(i)} จำนองแต่ยังเก็บค่าเช่า`);
    });
    Object.keys(B.GROUP_SQUARES).forEach(group => {
        const houses = B.GROUP_SQUARES[group].map(i => prop(room, i).houses);
        if (Math.max(...houses) - Math.min(...houses) > 1) problems.push(`ชุด${B.GROUPS[group].name} สร้างไม่เท่ากัน ${houses.join('/')}`);
        if (Math.max(...houses) > 0 && !B.GROUP_SQUARES[group].every(i => prop(room, i).owner === prop(room, B.GROUP_SQUARES[group][0]).owner)) {
            problems.push(`ชุด${B.GROUPS[group].name} มีบ้านแต่เจ้าของไม่ครบชุด`);
        }
        if (Math.max(...houses) > 0 && groupMortgaged(room, group)) problems.push(`ชุด${B.GROUPS[group].name} มีบ้านและมีแปลงจำนอง`);
    });
    const cardsHeld = state.seats.flatMap(seat => seat.jailCards || []);
    const deckTotal = state.decks.chance.length + state.decks.fortune.length + cardsHeld.length;
    if (deckTotal !== B.CHANCE.length + B.FORTUNE.length) problems.push(`การ์ดหาย/เกิน ${deckTotal}`);
    if (state.phase === 'debt' && !state.debts.length) problems.push('เฟสหนี้แต่ไม่มีหนี้');
    if (state.phase === 'buy' && (state.pendingBuy === null || prop(room, state.pendingBuy).owner)) problems.push('เฟสซื้อแต่ไม่มีที่ให้ซื้อ');
    if (state.phase === 'auction' && !state.auction) problems.push('เฟสประมูลแต่ไม่มีประมูล');
    if (state.auction && prop(room, state.auction.square).owner) problems.push('ประมูลที่ดินที่มีเจ้าของแล้ว');
    if (state.status === 'playing' && state.phase !== 'finished') {
        const actor = seatOf(room, state.phaseActor);
        if (state.phase !== 'auction' && !isActive(actor)) problems.push(`ผู้ทำตาไม่อยู่ในเกม (${state.phase})`);
    }
    return problems;
}

module.exports = {
    id: MODE,
    label: 'เศรษฐี',
    description: 'ทอยเต๋าซื้อที่ดินทั่วไทย เก็บค่าเช่า สร้างบ้าน ประมูล เทรด — 2–6 คน ใส่บอทได้',
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    MINUTE_CHOICES,
    DEFAULT_MINUTES,
    TURN_MS,
    AUCTION_BID_MS,
    AUCTION_START_MS,
    TRADE_MS,
    BOT_MS,
    MINUTE_MS,
    MIN_BID_STEP,
    TOKEN_COLORS,
    TAP_MS,
    HOLD_EARLY_MS,
    HOLD_LATE_MS,
    GREEN_DOUBLES,
    GREEN_SPAWN,
    greenSchedule,
    biasedDice,
    meterAt,
    startRollHold,
    releaseRoll,
    cancelRollHold,
    board: B,
    setClock,
    now,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    normalizeConfig,
    sanitizeMinutes,
    startGame,
    rollDice,
    payJailFine,
    useJailCard,
    buyProperty,
    declineBuy,
    placeBid,
    finishAuction,
    endTurn,
    build,
    sellBuilding,
    mortgage,
    unmortgage,
    proposeTrade,
    respondTrade,
    counterTrade,
    cancelTrade,
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
    botWantsTrade,
    botValue,
    autoLiquidate,
    buildClientState,
    getAvailableActions,
    rentFor,
    netWorth,
    liquidationValue,
    ownsGroup,
    canBuild,
    canSell,
    canMortgage,
    mortgageValue,
    unmortgageCost,
    houseCost,
    computeStandings,
    auditState,
    isBotId,
    isActive,
    shuffle
};
