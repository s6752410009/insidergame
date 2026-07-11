const PASS_CHOICE = '__pass__';
const MAX_ROUNDS = 5;
const DEAL_BONUS_CASH = 1;
const DEAL_BONUS_INFLUENCE = 1;
const BETRAY_STEAL_CASH = 2;

const { gameAssetImage } = require('./gameAssets');

function blackMarketImage(id) {
    return gameAssetImage('blackmarket', id);
}

const ROLE_DEFINITIONS = {
    boss: {
        id: 'boss',
        image: blackMarketImage('boss'),
        icon: '🎩',
        title: 'เจ้าพ่อ',
        summary: 'ปิดงานส่งของแล้วได้อิทธิพลเพิ่ม',
        ability: 'ทุกครั้งที่ส่งของสำเร็จ ได้ 👑 เพิ่มอีก 1'
    },
    broker: {
        id: 'broker',
        image: blackMarketImage('broker'),
        icon: '🕴️',
        title: 'นายหน้า',
        summary: 'ของชิ้นแรกในตลาดถูกกว่าคนอื่น',
        ability: 'ซื้อของในตลาดแต่ละยกราคาถูกลง 💵 1 (ต่ำสุด 1)'
    },
    smuggler: {
        id: 'smuggler',
        image: blackMarketImage('smuggler'),
        icon: '🚚',
        title: 'คนส่งของ',
        summary: 'ส่งของได้หนักกว่าคนอื่น',
        ability: 'เวลา 📦 ส่งของ จะลากของเถื่อนติดมือไปได้อีก 1 ชิ้นถ้ามี'
    },
    fixer: {
        id: 'fixer',
        image: blackMarketImage('fixer'),
        icon: '🧹',
        title: 'คนเคลียร์ทาง',
        summary: 'เอาตัวรอดเก่งและกดค่าหัวลงไว',
        ability: 'หนีการสั่งเก็บได้ 1 ครั้ง และเวลา 🫥 หมอบจะลด 🔥 ได้เพิ่ม'
    },
    hitman: {
        id: 'hitman',
        image: blackMarketImage('hitman'),
        icon: '🔫',
        title: 'มือเก็บงาน',
        summary: 'สั่งเก็บคุ้มและปล้นซ้ำได้',
        ability: 'สั่งเก็บใช้ 💵 แค่ 2 และถ้าปิดงานสำเร็จจะชิงของเพิ่มได้'
    },
    mole: {
        id: 'mole',
        image: blackMarketImage('mole'),
        icon: '🕶️',
        title: 'สายข่าว',
        summary: 'เห็นลึกกว่าคนอื่นเวลาแอบดู',
        ability: 'เวลา 👁️ สืบ จะเห็นทั้งบทและของในมือเป้าหมาย'
    },
    doubleAgent: {
        id: 'doubleAgent',
        image: blackMarketImage('doubleAgent'),
        icon: '🃏',
        title: 'สองหน้า',
        summary: 'หักหลังและปล้นคุ้ม แต่ค่าหัวขึ้นง่าย',
        ability: 'เวลา 🗡️ หักหลัง หรือ 💣 ปล้น จะได้เพิ่ม แต่ 🔥 +1'
    }
};

const ITEM_DEFINITIONS = {
    gun: {
        id: 'gun',
        image: blackMarketImage('gun'),
        icon: '🔫',
        name: 'ปืนเงียบ',
        type: 'weapon',
        price: 3,
        summary: 'ใช้สั่งเก็บได้ 1 ครั้ง'
    },
    armor: {
        id: 'armor',
        image: blackMarketImage('armor'),
        icon: '🦺',
        name: 'เสื้อเกราะ',
        type: 'defense',
        price: 3,
        summary: 'กันการสั่งเก็บได้ 1 ครั้ง'
    },
    wiretap: {
        id: 'wiretap',
        image: blackMarketImage('wiretap'),
        icon: '🎧',
        name: 'เครื่องดักฟัง',
        type: 'intel',
        price: 2,
        summary: 'ทำให้ข่าวที่สืบมาแน่นขึ้น'
    },
    passport: {
        id: 'passport',
        image: blackMarketImage('passport'),
        icon: '🛂',
        name: 'พาสปลอม',
        type: 'utility',
        price: 2,
        summary: 'ตอนหมอบจะลดค่าหัวได้แรงขึ้น'
    },
    ledger: {
        id: 'ledger',
        image: blackMarketImage('ledger'),
        icon: '📒',
        name: 'สมุดบัญชีดำ',
        type: 'cargo',
        price: 2,
        influence: 2,
        summary: 'ของเถื่อนมูลค่าสูง ส่งแล้วได้ 👑 ดี'
    },
    crate: {
        id: 'crate',
        image: blackMarketImage('crate'),
        icon: '📦',
        name: 'ลังสินค้าเถื่อน',
        type: 'cargo',
        price: 2,
        influence: 2,
        summary: 'ส่งง่าย ได้ 👑 ชัวร์'
    },
    cashbag: {
        id: 'cashbag',
        image: blackMarketImage('cashbag'),
        icon: '💼',
        name: 'กระเป๋าเงินดำ',
        type: 'cargo',
        price: 1,
        influence: 1,
        summary: 'ของเบาแต่ปั่นแต้มเร็ว'
    }
};

const ACTION_DEFINITIONS = {
    deliver: {
        id: 'deliver',
        image: blackMarketImage('deliver'),
        icon: '📦',
        label: 'ส่งของ',
        shortLabel: 'ส่งของ',
        description: 'ใช้สินค้าเถื่อนที่ถืออยู่แลกเป็นอิทธิพล',
        targetMode: 'item'
    },
    intel: {
        id: 'intel',
        image: blackMarketImage('intel'),
        icon: '👁️',
        label: 'สืบข่าว',
        shortLabel: 'สืบข่าว',
        description: 'ดูข้อมูลลับของผู้เล่นเป้าหมาย',
        targetMode: 'player'
    },
    deal: {
        id: 'deal',
        image: blackMarketImage('deal'),
        icon: '🤝',
        label: 'เข้าดีล',
        shortLabel: 'เข้าดีล',
        description: 'ปิดดีลได้เมื่ออีกฝ่ายเลือกเข้าดีลกลับมาในยกเดียวกัน',
        targetMode: 'player'
    },
    betray: {
        id: 'betray',
        image: blackMarketImage('betray'),
        icon: '🗡️',
        label: 'หักหลัง',
        shortLabel: 'หักหลัง',
        description: 'ดักกินดีลที่อีกฝ่ายเปิดเข้ามาหาคุณ',
        targetMode: 'player'
    },
    raid: {
        id: 'raid',
        image: blackMarketImage('raid'),
        icon: '💣',
        label: 'ปล้น',
        shortLabel: 'ปล้น',
        description: 'ชิงเงินหรือของจากผู้เล่นเป้าหมาย',
        targetMode: 'player'
    },
    guard: {
        id: 'guard',
        image: blackMarketImage('guard'),
        icon: '🦺',
        label: 'ตั้งการ์ด',
        shortLabel: 'ตั้งการ์ด',
        description: 'กันแอ็กชันแรงที่พุ่งเข้ามาในยกนี้',
        targetMode: 'self'
    },
    laylow: {
        id: 'laylow',
        image: blackMarketImage('laylow'),
        icon: '🫥',
        label: 'หมอบต่ำ',
        shortLabel: 'หมอบต่ำ',
        description: 'ลดค่าหัวแล้วเล่นยกต่อไปแบบปลอดภัยขึ้น',
        targetMode: 'self'
    },
    hit: {
        id: 'hit',
        image: blackMarketImage('hit'),
        icon: '🔫',
        label: 'สั่งเก็บ',
        shortLabel: 'สั่งเก็บ',
        description: 'ใช้ปืนเปิดงานกับผู้เล่นเป้าหมาย',
        targetMode: 'player'
    },
    pass: {
        id: 'pass',
        image: blackMarketImage('pass'),
        icon: '🤐',
        label: 'ผ่านยกนี้',
        shortLabel: 'ผ่าน',
        description: 'ไม่ทำอะไรในยกนี้ เก็บจังหวะไว้ก่อน',
        targetMode: 'self'
    }
};

const ROLE_ORDER = Object.keys(ROLE_DEFINITIONS);
const MARKET_POOL = Object.keys(ITEM_DEFINITIONS);

function buildFeedIconLookup() {
    const lookup = {};
    [ROLE_DEFINITIONS, ITEM_DEFINITIONS, ACTION_DEFINITIONS].forEach(catalog => {
        Object.values(catalog).forEach(entry => {
            if (!entry?.icon) {
                return;
            }
            lookup[entry.icon] = {
                iconId: entry.id,
                icon: entry.icon
            };
        });
    });
    return lookup;
}

const FEED_ICON_LOOKUP = buildFeedIconLookup();

function resolveFeedIcon(icon) {
    return FEED_ICON_LOOKUP[icon] || { icon, iconId: null };
}

// feed entries render inline next to text, so image is always null; the field
// stays in the payload because the client icon helper reads it
function enrichFeedEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return entry;
    }
    const resolved = resolveFeedIcon(entry.icon);
    return {
        ...entry,
        icon: resolved.icon || entry.icon,
        iconId: entry.iconId || resolved.iconId || null,
        image: null
    };
}

function shuffle(items) {
    const clone = [...items];
    for (let index = clone.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
    }
    return clone;
}

function createInitialState() {
    return {
        mode: 'blackmarket',
        status: 'waiting',
        phase: 'lobby',
        roundNumber: 0,
        maxRounds: MAX_ROUNDS,
        players: [],
        marketOffers: [],
        marketChoices: {},
        actionChoices: {},
        dealLedger: [],
        history: [],
        lastRoundReport: [],
        winner: null,
        lastAction: 0,
        phaseEndsAt: null,
        statsRecordedAt: null
    };
}

function isPlayerOnline(room, playerId) {
    const roomPlayer = room.players?.find(player => player.playerId === playerId);
    if (roomPlayer) {
        return !!roomPlayer.socketId;
    }

    const gameStatePlayer = getPlayer(room, playerId);
    return !!gameStatePlayer?.socketId;
}

function setPhaseDeadline(room, durationMs) {
    room.gameState.phaseEndsAt = Date.now() + durationMs;
}

// ค่า default ใช้เมื่อห้องไม่ได้ตั้ง roundTime (รวม 210 วิ/ยก)
const MARKET_PHASE_MS = 90 * 1000;
const ACTION_PHASE_MS = 120 * 1000;
const DEFAULT_ROUND_BUDGET_MS = MARKET_PHASE_MS + ACTION_PHASE_MS;
const MARKET_PHASE_MIN_MS = 20 * 1000;
const ACTION_PHASE_MIN_MS = 30 * 1000;
const MARKET_PHASE_SHARE = 0.42; // แบ่งเวลาต่อยกให้ช่วงตลาดประมาณ 42% ที่เหลือเป็นช่วงลงมือ

// roundTime ในห้องเก็บเป็น "วินาที" (ล็อบบี้แปลงจากนาที) = งบเวลาต่อยก
function getRoundBudgetMs(room) {
    const seconds = Number(room?.settings?.roundTime);
    if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
    }
    return DEFAULT_ROUND_BUDGET_MS;
}

function getMarketPhaseMs(room) {
    const budget = getRoundBudgetMs(room);
    return Math.max(MARKET_PHASE_MIN_MS, Math.round(budget * MARKET_PHASE_SHARE));
}

function getActionPhaseMs(room) {
    const budget = getRoundBudgetMs(room);
    return Math.max(ACTION_PHASE_MIN_MS, Math.round(budget * (1 - MARKET_PHASE_SHARE)));
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        socketId: context.socketId || null,
        name: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        permission: context.isAdmin ? 'admin' : null,
        role: '',
        roleInfo: null,
        alive: true,
        revealedRole: null,
        cash: 5,
        heat: 0,
        influence: 0,
        inventory: [],
        intelNotes: [],
        fixerEscapeAvailable: true,
        lastMove: null
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: room.players.map(player => createPlayerState({
            playerId: player.playerId,
            playerName: player.playerName,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame
        }, {
            socketId: player.socketId,
            isAdmin: player.permission === 'admin'
        }))
    };
}

function pushHistory(room, icon, text, tone = 'neutral') {
    const resolved = resolveFeedIcon(icon);
    room.gameState.history.unshift({
        icon: resolved.icon || icon,
        iconId: resolved.iconId || null,
        text,
        tone,
        at: new Date().toISOString()
    });
    room.gameState.history = room.gameState.history.slice(0, 32);
}

function getPlayer(room, playerId) {
    return room.gameState.players.find(player => player.playerId === playerId) || null;
}

function getAlivePlayers(room) {
    return room.gameState.players.filter(player => player.alive !== false);
}

function describeItem(itemId) {
    const definition = ITEM_DEFINITIONS[itemId];
    return definition ? { ...definition } : null;
}

function drawMarketOffers() {
    return shuffle(MARKET_POOL).slice(0, 3);
}

function getActionEffectText(actionType, actor = null) {
    switch (actionType) {
        case 'deliver':
            return actor?.role === 'boss'
                ? 'เปลี่ยนสินค้าเถื่อนเป็น 👑 และบทเจ้าพ่อได้อิทธิพลเพิ่มอีก 1'
                : 'เปลี่ยนสินค้าเถื่อนเป็น 👑 ตามค่าของแต่ละชิ้น';
        case 'intel':
            return actor?.role === 'mole'
                ? 'เห็นทั้งบท เงิน ค่าหัว และของในมือของเป้าหมาย'
                : 'เห็นเงิน ค่าหัว และเบาะแสของที่เป้าหมายถือ';
        case 'deal':
            return actor?.role === 'broker'
                ? 'ถ้าอีกฝ่ายเข้าดีลกลับมา ทั้งคู่ได้ 👑 +1 และคุณได้ 💵 เพิ่มคุ้มขึ้น'
                : 'ถ้าอีกฝ่ายเข้าดีลกลับมา ทั้งคู่ได้ 👑 +1 และ 💵 +1';
        case 'betray':
            return actor?.role === 'doubleAgent'
                ? 'สำเร็จเมื่ออีกฝ่ายเข้าดีลใส่คุณ แล้วคุณชิงเงินเพิ่มและค่าหัว +1'
                : 'สำเร็จเมื่ออีกฝ่ายเข้าดีลใส่คุณ แล้วคุณชิงเงินจากอีกฝ่าย';
        case 'raid':
            return actor?.role === 'doubleAgent'
                ? 'ชิงเงินได้แรงขึ้น หรือกวาดของจากเป้าหมาย แต่ค่าหัวจะเพิ่ม'
                : 'ชิงเงินหรือของจากเป้าหมาย ถ้าเขาไม่ได้รับการคุ้มกัน';
        case 'guard':
            return 'ตั้งการ์ดไว้รับแอ็กชันแรง และช่วยบล็อกแผนที่พุ่งมาใส่โต๊ะคุณ';
        case 'laylow':
            return actor?.inventory?.includes('passport')
                ? 'ลดค่าหัวได้มากขึ้น เพราะมีพาสปลอมช่วยกลบเส้นทาง'
                : 'ลดค่าหัว 1 หรือมากกว่านั้นตามบทที่ถือ';
        case 'hit':
            return actor?.role === 'hitman'
                ? 'ใช้ปืนสั่งเก็บด้วยต้นทุน 2 และถ้าสำเร็จมีสิทธิ์ชิงของเพิ่ม'
                : 'ใช้ปืนกับทุนในมือเพื่อเปิดงานใส่เป้าหมาย';
        case 'pass':
            return 'เก็บมือไว้ก่อน ไม่เสี่ยง แต่ก็ไม่สร้างแต้มเพิ่มในยกนี้';
        default:
            return '';
    }
}

function describeActionChoice(room, actor, choice) {
    if (!choice || !choice.actionType) {
        return null;
    }

    const meta = ACTION_DEFINITIONS[choice.actionType] || ACTION_DEFINITIONS.pass;
    const target = choice.targetPlayerId ? getPlayer(room, choice.targetPlayerId) : null;
    const item = choice.itemId ? ITEM_DEFINITIONS[choice.itemId] : null;
    return {
        actionType: choice.actionType,
        id: meta.id,
        image: meta.image,
        icon: meta.icon,
        label: meta.label,
        shortLabel: meta.shortLabel,
        description: meta.description,
        effectText: getActionEffectText(choice.actionType, actor),
        targetMode: meta.targetMode,
        targetPlayerId: target?.playerId || null,
        targetPlayerName: target?.name || null,
        itemId: item?.id || null,
        itemName: item?.name || null,
        summaryText: target
            ? `${meta.label} ใส่ ${target.name}`
            : (item ? `${meta.label} ${item.name}` : meta.label)
    };
}

function buildActionCatalog(actor) {
    return Object.values(ACTION_DEFINITIONS).map(meta => ({
        id: meta.id,
        image: meta.image,
        icon: meta.icon,
        label: meta.label,
        shortLabel: meta.shortLabel,
        description: meta.description,
        effectText: getActionEffectText(meta.id, actor),
        targetMode: meta.targetMode
    }));
}

function buildTutorialState(room, actor) {
    const phaseTips = {
        market: 'เริ่มแต่ละยกด้วยการกวาดของ 1 ชิ้นหรือกดผ่านตลาด จากนั้นรอทุกคนล็อกมือก่อนเกมจะเข้าสู่ช่วงลงมือ',
        action: 'หลังตลาดปิด คุณเลือกได้ 1 แอ็กชันต่อยก ดูชื่อปุ่มและเอฟเฟกต์ใต้ปุ่มก่อนกด ถ้ายังไม่ชัวร์ให้เริ่มจาก สืบข่าว หรือ หมอบต่ำ',
        finished: 'โต๊ะปิดแล้ว ดูว่าใครชนะเพราะอะไร แล้วค่อยเปิดโต๊ะใหม่หรือกลับห้อง'
    };

    return {
        goal: 'สะสม 👑 อิทธิพลให้มากสุดก่อนจบ 5 ยก หรืออยู่เป็นคนสุดท้ายบนโต๊ะ',
        phaseTip: phaseTips[room.gameState.phase] || 'รอสถานะจากโต๊ะ',
        roleTip: actor?.roleInfo?.ability || '',
        reminders: [
            'แต่ละยกทำได้ 1 แอ็กชันเท่านั้น',
            'สินค้าเถื่อนใช้กับปุ่ม ส่งของ',
            'ปิดดีลต้องกดเข้าดีลใส่กันทั้งสองฝ่ายในยกเดียวกัน',
            'ค่าหัวถึง 5 เมื่อไร จะโดนริบเงินและอิทธิพลอย่างละ 1 ทุกจบยก จนกว่าจะหมอบต่ำลดค่าหัวลง'
        ],
        roundFlow: [
            '1. ช่วงตลาด: เลือกของหรือกดผ่าน',
            '2. ช่วงลงมือ: เลือก 1 แอ็กชันให้ตรงแผน',
            '3. จบยก: ระบบเฉลยผล ดีลแตก และปรับค่าหัวให้เอง'
        ]
    };
}

function hasItem(player, itemId) {
    return player.inventory.includes(itemId);
}

function consumeItem(player, itemId) {
    const itemIndex = player.inventory.indexOf(itemId);
    if (itemIndex < 0) {
        return false;
    }

    player.inventory.splice(itemIndex, 1);
    return true;
}

function removeRandomItem(player) {
    if (!Array.isArray(player.inventory) || player.inventory.length === 0) {
        return null;
    }

    const randomIndex = Math.floor(Math.random() * player.inventory.length);
    return player.inventory.splice(randomIndex, 1)[0] || null;
}

function getPurchasePrice(player, itemId) {
    const definition = ITEM_DEFINITIONS[itemId];
    if (!definition) {
        return Number.MAX_SAFE_INTEGER;
    }

    const discount = player.role === 'broker' ? 1 : 0;
    return Math.max(1, definition.price - discount);
}

function assignRoles(room) {
    const selectedRoles = shuffle(ROLE_ORDER).slice(0, room.gameState.players.length);
    room.gameState.players.forEach((player, index) => {
        const roleId = selectedRoles[index];
        player.role = roleId;
        player.roleInfo = ROLE_DEFINITIONS[roleId];
        player.revealedRole = null;
        player.alive = true;
        player.cash = 5;
        player.heat = 0;
        player.influence = 0;
        player.inventory = [];
        player.intelNotes = [];
        player.fixerEscapeAvailable = true;
        player.lastMove = null;
    });
}

function startGame(room) {
    room.gameState = resetRoomGame(room);
    assignRoles(room);
    room.gameState.roundNumber = 1;
    room.gameState.phase = 'market';
    room.gameState.status = 'blackmarket_market';
    room.gameState.marketOffers = drawMarketOffers();
    room.gameState.marketChoices = {};
    room.gameState.actionChoices = {};
    room.gameState.dealLedger = [];
    room.gameState.lastRoundReport = [];
    room.gameState.winner = null;
    room.gameState.lastAction = Date.now();
    room.gameState.statsRecordedAt = null;
    setPhaseDeadline(room, getMarketPhaseMs(room));
    pushHistory(room, '🎩', 'ตลาดมืดเปิดแล้ว ยก 1 เริ่มกวาดของเถื่อน', 'gold');
    return room.gameState;
}

function everyoneCommitted(room, bucket) {
    return getAlivePlayers(room).every(player => {
        if (bucket[player.playerId]) {
            return true;
        }

        return !isPlayerOnline(room, player.playerId);
    });
}

function fillMissingMarketChoices(room) {
    getAlivePlayers(room).forEach(player => {
        if (!room.gameState.marketChoices[player.playerId]) {
            room.gameState.marketChoices[player.playerId] = PASS_CHOICE;
        }
    });
}

function fillMissingActionChoices(room) {
    getAlivePlayers(room).forEach(player => {
        if (!room.gameState.actionChoices[player.playerId]) {
            room.gameState.actionChoices[player.playerId] = {
                actionType: 'pass',
                targetPlayerId: null,
                itemId: null
            };
        }
    });
}

function moveToActionPhase(room, report = []) {
    room.gameState.phase = 'action';
    room.gameState.status = 'blackmarket_action';
    room.gameState.actionChoices = {};
    room.gameState.marketChoices = {};
    room.gameState.lastRoundReport = report;
    room.gameState.lastAction = Date.now();
    setPhaseDeadline(room, getActionPhaseMs(room));
    pushHistory(room, '🛒', `ตลาดยก ${room.gameState.roundNumber} ปิดแล้ว ถึงเวลาลงมือ`, 'amber');
}

function rememberDeal(room, icon, text, tone = 'neutral') {
    const resolved = resolveFeedIcon(icon);
    room.gameState.dealLedger.unshift({
        icon: resolved.icon || icon,
        iconId: resolved.iconId || null,
        text,
        tone,
        roundNumber: room.gameState.roundNumber,
        at: new Date().toISOString()
    });
    room.gameState.dealLedger = room.gameState.dealLedger.slice(0, 12);
}

function createPairKey(leftPlayerId, rightPlayerId) {
    return [leftPlayerId, rightPlayerId].sort().join(':');
}

function finalizeWinner(room, reasonIcon, reasonText) {
    const players = [...room.gameState.players].sort((left, right) => {
        if ((left.alive !== false) !== (right.alive !== false)) {
            return left.alive === false ? 1 : -1;
        }
        if (right.influence !== left.influence) {
            return right.influence - left.influence;
        }
        if (right.cash !== left.cash) {
            return right.cash - left.cash;
        }
        if (left.heat !== right.heat) {
            return left.heat - right.heat;
        }
        return left.name.localeCompare(right.name, 'th');
    });

    const winner = players[0] || null;
    room.gameState.phase = 'finished';
    room.gameState.status = 'blackmarket_finished';
    room.gameState.phaseEndsAt = null;
    room.gameState.winner = winner ? {
        playerId: winner.playerId,
        name: winner.name,
        avatar: winner.avatar,
        roleId: winner.role,
        roleTitle: winner.roleInfo?.title || winner.role,
        influence: winner.influence,
        cash: winner.cash,
        heat: winner.heat,
        reason: reasonText
    } : null;
    room.gameState.players.forEach(player => {
        player.revealedRole = player.roleInfo?.title || player.role;
    });
    pushHistory(room, reasonIcon, reasonText, 'red');
}

function maybeFinishGame(room) {
    const alivePlayers = getAlivePlayers(room);

    // <= 1 ไม่ใช่ === 1: ถ้าสองคนสุดท้ายสั่งเก็บกันเองตายพร้อมกัน เกมต้องจบ ไม่ใช่เดินยกเปล่าต่อ
    if (alivePlayers.length <= 1) {
        if (alivePlayers.length === 1) {
            finalizeWinner(room, '💀', `${alivePlayers[0].name} ยืนเป็นคนสุดท้ายบนโต๊ะและกวาดวงนี้ไปทั้งแถบ`);
        } else {
            finalizeWinner(room, '💀', 'ไม่มีใครรอดถึงเช้า — ตัดสินผู้ชนะจากอิทธิพลที่สะสมไว้');
        }
        return true;
    }

    if (room.gameState.roundNumber >= room.gameState.maxRounds) {
        finalizeWinner(room, '👑', `ครบ ${room.gameState.maxRounds} ยกแล้ว ใครคุมอิทธิพลสูงสุดคือเจ้าของเมืองคืนนี้`);
        return true;
    }

    return false;
}

function startNextRound(room, report = []) {
    room.gameState.lastRoundReport = report;
    if (maybeFinishGame(room)) {
        return;
    }

    room.gameState.roundNumber += 1;
    room.gameState.phase = 'market';
    room.gameState.status = 'blackmarket_market';
    room.gameState.marketOffers = drawMarketOffers();
    room.gameState.marketChoices = {};
    room.gameState.actionChoices = {};
    room.gameState.lastAction = Date.now();
    setPhaseDeadline(room, getMarketPhaseMs(room));
    pushHistory(room, '🌒', `ยก ${room.gameState.roundNumber} เปิดฉาก ล็อตใหม่พร้อมแล้ว`, 'neutral');
}

function resolveMarketPhase(room) {
    const report = [];
    getAlivePlayers(room).forEach(player => {
        const itemId = room.gameState.marketChoices[player.playerId];
        if (!itemId || itemId === PASS_CHOICE) {
            player.lastMove = 'ผ่านตลาด';
            report.push({ icon: '🤐', text: `${player.name} ไม่แตะของในยกนี้`, tone: 'neutral' });
            return;
        }

        const item = ITEM_DEFINITIONS[itemId];
        const price = getPurchasePrice(player, itemId);
        if (!item || player.cash < price) {
            player.lastMove = 'เงินไม่พอ';
            report.push({ icon: '🚫', text: `${player.name} เอื้อมไม่ถึง ${item?.name || 'ของชิ้นนั้น'}`, tone: 'red' });
            return;
        }

        player.cash -= price;
        player.inventory.push(itemId);
        player.lastMove = `ซื้อ ${item.name}`;
        report.push({ icon: item.icon, text: `${player.name} รับ ${item.name} เข้ากระเป๋า`, tone: 'gold' });
    });

    moveToActionPhase(room, report);
}

function buildIntelNote(actor, target) {
    const visibleItems = target.inventory.map(itemId => ITEM_DEFINITIONS[itemId]?.icon || '🎴').join(' ');
    if (actor.role === 'mole') {
        return `${target.name} ถือบท ${target.roleInfo?.title || '-'} • 🔥 ค่าหัว ${target.heat} • 💵 ${target.cash} • ของ ${visibleItems || 'มือเปล่า'}`;
    }

    if (hasItem(actor, 'wiretap')) {
        const itemDetail = target.inventory.length
            ? target.inventory.map(itemId => ITEM_DEFINITIONS[itemId]?.name || itemId).join(', ')
            : 'มือเปล่า';
        return `${target.name} • 💵 ${target.cash} • 🔥 ${target.heat} • ของ: ${itemDetail}`;
    }

    const firstItem = target.inventory[0] ? ITEM_DEFINITIONS[target.inventory[0]] : null;
    return `${target.name} มี 💵 ${target.cash} • 🔥 ค่าหัว ${target.heat}${firstItem ? ` • โผล่ ${firstItem.icon} ${firstItem.name}` : ' • ไม่เห็นของชัด'}`;
}

function resolveActionPhase(room) {
    const report = [];
    const actions = room.gameState.actionChoices || {};
    const aliveAtStart = getAlivePlayers(room).map(player => player.playerId);
    const settledDealPairs = new Set();
    const guardSet = new Set(
        aliveAtStart.filter(playerId => actions[playerId]?.actionType === 'guard')
    );

    aliveAtStart.forEach(playerId => {
        const action = actions[playerId];
        const actor = getPlayer(room, playerId);
        if (!actor || !action || actor.alive === false) {
            return;
        }

        if (action.actionType === 'intel' && action.targetPlayerId) {
            const target = getPlayer(room, action.targetPlayerId);
            if (!target || target.alive === false || target.playerId === actor.playerId) {
                return;
            }
            const intel = buildIntelNote(actor, target);
            actor.intelNotes = [
                { roundNumber: room.gameState.roundNumber, text: intel },
                ...actor.intelNotes.filter(note => Number(note.roundNumber) !== Number(room.gameState.roundNumber))
            ].slice(0, 5);
            actor.lastMove = `สืบ ${target.name}`;
            report.push({ icon: actor.role === 'mole' ? '🕶️' : '👁️', text: `${actor.name} ได้ข่าววงในของ ${target.name}`, tone: 'blue' });
        }
    });

    aliveAtStart.forEach(playerId => {
        const action = actions[playerId];
        const actor = getPlayer(room, playerId);
        if (!actor || !action || actor.alive === false || !['deal', 'betray'].includes(action.actionType)) {
            return;
        }

        const target = getPlayer(room, action.targetPlayerId);
        if (!target || target.alive === false || target.playerId === actor.playerId) {
            return;
        }

        const pairKey = createPairKey(actor.playerId, target.playerId);
        if (settledDealPairs.has(pairKey)) {
            return;
        }

        const reverseAction = actions[target.playerId];
        const isMutualPair = reverseAction
            && ['deal', 'betray'].includes(reverseAction.actionType)
            && reverseAction.targetPlayerId === actor.playerId;

        if (!isMutualPair) {
            return;
        }

        settledDealPairs.add(pairKey);

        if (action.actionType === 'deal' && reverseAction.actionType === 'deal') {
            const actorCashGain = DEAL_BONUS_CASH + (actor.role === 'broker' ? 1 : 0);
            const targetCashGain = DEAL_BONUS_CASH + (target.role === 'broker' ? 1 : 0);
            actor.cash += actorCashGain;
            target.cash += targetCashGain;
            actor.influence += DEAL_BONUS_INFLUENCE;
            target.influence += DEAL_BONUS_INFLUENCE;
            actor.lastMove = `เข้าดีลกับ ${target.name}`;
            target.lastMove = `เข้าดีลกับ ${actor.name}`;

            const dealText = `${actor.name} กับ ${target.name} ปิดดีลกันสำเร็จ รับ 👑 คนละ ${DEAL_BONUS_INFLUENCE} และ 💵 เพิ่ม`;
            rememberDeal(room, '🤝', dealText, 'gold');
            report.push({ icon: '🤝', text: dealText, tone: 'gold' });
            return;
        }

        if (action.actionType === 'betray' && reverseAction.actionType === 'deal') {
            const stolenCash = Math.min(BETRAY_STEAL_CASH, target.cash);
            target.cash -= stolenCash;
            actor.cash += stolenCash + (actor.role === 'doubleAgent' ? 1 : 0);
            actor.influence += actor.role === 'doubleAgent' ? 2 : 1;
            actor.heat += actor.role === 'doubleAgent' ? 1 : 0;
            target.heat += 1;
            actor.lastMove = `หักหลัง ${target.name}`;
            target.lastMove = `โดน ${actor.name} หักหลัง`;

            const betrayalText = `${actor.name} รับดีลจาก ${target.name} ก่อนพลิกโต๊ะ ชิง 💵 ${stolenCash}${actor.role === 'doubleAgent' ? ' + โบนัสสองหน้า 1' : ''}`;
            rememberDeal(room, '🗡️', betrayalText, 'red');
            report.push({ icon: '🗡️', text: betrayalText, tone: 'red' });
            return;
        }

        if (action.actionType === 'deal' && reverseAction.actionType === 'betray') {
            const stolenCash = Math.min(BETRAY_STEAL_CASH, actor.cash);
            actor.cash -= stolenCash;
            target.cash += stolenCash + (target.role === 'doubleAgent' ? 1 : 0);
            target.influence += target.role === 'doubleAgent' ? 2 : 1;
            target.heat += target.role === 'doubleAgent' ? 1 : 0;
            actor.heat += 1;
            actor.lastMove = `โดน ${target.name} หักหลัง`;
            target.lastMove = `หักหลัง ${actor.name}`;

            const betrayalText = `${target.name} รับดีลจาก ${actor.name} ก่อนพลิกโต๊ะ ชิง 💵 ${stolenCash}${target.role === 'doubleAgent' ? ' + โบนัสสองหน้า 1' : ''}`;
            rememberDeal(room, '🗡️', betrayalText, 'red');
            report.push({ icon: '🗡️', text: betrayalText, tone: 'red' });
            return;
        }

        actor.heat += 1;
        target.heat += 1;
        actor.lastMove = `หักหลังชน ${target.name}`;
        target.lastMove = `หักหลังชน ${actor.name}`;
        const crossText = `${actor.name} กับ ${target.name} ต่างฝ่ายต่างชักมีดใส่กัน ดีลพังทั้งคู่`;
        rememberDeal(room, '⚠️', crossText, 'amber');
        report.push({ icon: '⚠️', text: crossText, tone: 'amber' });
    });

    aliveAtStart.forEach(playerId => {
        const action = actions[playerId];
        const actor = getPlayer(room, playerId);
        if (!actor || !action || actor.alive === false || !['deal', 'betray'].includes(action.actionType)) {
            return;
        }

        const target = getPlayer(room, action.targetPlayerId);
        const pairKey = target ? createPairKey(actor.playerId, target.playerId) : null;
        if (pairKey && settledDealPairs.has(pairKey)) {
            return;
        }

        if (action.actionType === 'deal') {
            actor.lastMove = target ? `เปิดดีลให้ ${target.name}` : 'เปิดดีลลอย';
            report.push({ icon: '🤲', text: `${actor.name} เปิดดีล แต่ไม่มีใครรับกลับ`, tone: 'neutral' });
            return;
        }

        actor.lastMove = target ? `หักหลัง ${target.name} ไม่ติด` : 'หักหลังลอย';
        report.push({ icon: '🫥', text: `${actor.name} วางมีดดักไว้ แต่เหยื่อไม่เปิดดีลใส่`, tone: 'neutral' });
    });

    const hitAttempts = [];
    aliveAtStart.forEach(playerId => {
        const action = actions[playerId];
        const actor = getPlayer(room, playerId);
        if (!actor || !action || action.actionType !== 'hit' || actor.alive === false) {
            return;
        }

        const target = getPlayer(room, action.targetPlayerId);
        const hitCost = actor.role === 'hitman' ? 2 : 3;
        // target.alive === false ต้องพลาดแบบไม่เสียปืน/เงิน — ไม่งั้นยิงศพแล้วเสียของฟรี
        if (!target || target.alive === false || target.playerId === actor.playerId || !hasItem(actor, 'gun') || actor.cash < hitCost) {
            actor.lastMove = 'สั่งเก็บพลาด';
            report.push({ icon: '🚫', text: `${actor.name} เปิดงานสั่งเก็บไม่สำเร็จ`, tone: 'red' });
            return;
        }

        actor.cash -= hitCost;
        consumeItem(actor, 'gun');

        let blockedReason = null;
        if (guardSet.has(target.playerId)) {
            blockedReason = 'มีคนคุ้มกันอยู่';
        } else if (consumeItem(target, 'armor')) {
            blockedReason = 'เสื้อเกราะรับไว้';
        } else if (target.role === 'fixer' && target.fixerEscapeAvailable) {
            target.fixerEscapeAvailable = false;
            target.heat += 1;
            blockedReason = 'สายเคลียร์พาหนีทัน';
        }

        if (blockedReason) {
            actor.heat += 1;
            actor.lastMove = 'สั่งเก็บโดนกัน';
            report.push({ icon: '🛡️', text: `${target.name} รอดจากคำสั่งเก็บ เพราะ${blockedReason}`, tone: 'amber' });
            return;
        }

        hitAttempts.push({ actorId: actor.playerId, targetId: target.playerId });
    });

    const deadTargetIds = [...new Set(hitAttempts.map(attempt => attempt.targetId))];
    deadTargetIds.forEach(targetId => {
        const target = getPlayer(room, targetId);
        const attemptsOnTarget = hitAttempts.filter(attempt => attempt.targetId === targetId);
        const killerAttempt = attemptsOnTarget[0];
        const killer = killerAttempt ? getPlayer(room, killerAttempt.actorId) : null;

        // คนที่สั่งเก็บเป้าเดียวกันแต่ไม่ใช่คนแรก = งานซ้ำ คืนปืน + เงินให้ ไม่ให้เสียฟรี
        attemptsOnTarget.slice(1).forEach(extra => {
            const extraActor = getPlayer(room, extra.actorId);
            if (!extraActor) {
                return;
            }
            extraActor.inventory.push('gun');
            extraActor.cash += (extraActor.role === 'hitman' ? 2 : 3);
            extraActor.lastMove = 'งานซ้ำ ได้ของคืน';
            report.push({ icon: '↩️', text: `${extraActor.name} ไปถึงช้ากว่า มีคนเก็บ ${target ? target.name : 'เป้า'} ไปก่อน — คืนปืนและเงินให้`, tone: 'neutral' });
        });

        if (!target || target.alive === false) {
            return;
        }

        target.alive = false;
        target.revealedRole = target.roleInfo?.title || target.role;
        target.lastMove = 'โดนเก็บ';
        const lostCash = Math.floor(target.cash / 2);
        target.cash = Math.max(0, target.cash - lostCash);

        if (killer) {
            killer.heat += 2;
            killer.lastMove = `เก็บ ${target.name}`;
            if (killer.role === 'hitman') {
                const lootedItem = removeRandomItem(target);
                if (lootedItem) {
                    killer.inventory.push(lootedItem);
                } else if (target.cash > 0) {
                    killer.cash += 1;
                    target.cash = Math.max(0, target.cash - 1);
                }
            }
        }

        report.push({ icon: '💀', text: `${target.name} ถูกเก็บ และบท ${target.revealedRole} หลุดออกมา`, tone: 'red' });
    });

    aliveAtStart.forEach(playerId => {
        const actor = getPlayer(room, playerId);
        const action = actions[playerId];
        if (!actor || !action || actor.alive === false) {
            return;
        }

        if (action.actionType === 'raid') {
            const target = getPlayer(room, action.targetPlayerId);
            if (!target || target.alive === false || target.playerId === actor.playerId) {
                return;
            }

            if (guardSet.has(target.playerId)) {
                actor.lastMove = 'ปล้นไม่เข้า';
                report.push({ icon: '🦺', text: `${actor.name} เข้าใกล้ ${target.name} ไม่ได้ เพราะมีคนกันทาง`, tone: 'amber' });
                return;
            }

            const stealAmount = actor.role === 'doubleAgent' ? 3 : 2;
            if (target.cash > 0) {
                const transferred = Math.min(stealAmount, target.cash);
                target.cash -= transferred;
                actor.cash += transferred;
                if (actor.role === 'doubleAgent') {
                    actor.heat += 1;
                    actor.influence += 1;
                }
                actor.lastMove = `ปล้น ${target.name}`;
                report.push({ icon: '💣', text: `${actor.name} ล้วงเงินจาก ${target.name} ไป ${transferred} ก้อน`, tone: 'amber' });
                return;
            }

            const lootedItem = removeRandomItem(target);
            if (lootedItem) {
                actor.inventory.push(lootedItem);
                if (actor.role === 'doubleAgent') {
                    actor.heat += 1;
                    actor.influence += 1;
                }
                actor.lastMove = `ปล้นของจาก ${target.name}`;
                report.push({ icon: '🎒', text: `${actor.name} ชิง ${ITEM_DEFINITIONS[lootedItem]?.name || 'ของเถื่อน'} จาก ${target.name}`, tone: 'amber' });
                return;
            }

            actor.lastMove = 'ปล้นมือเปล่า';
            report.push({ icon: '🤷', text: `${actor.name} งมหาอะไรจาก ${target.name} ไม่เจอ`, tone: 'neutral' });
        }
    });

    aliveAtStart.forEach(playerId => {
        const actor = getPlayer(room, playerId);
        const action = actions[playerId];
        if (!actor || !action || actor.alive === false) {
            return;
        }

        if (action.actionType === 'deliver' && action.itemId) {
            const item = ITEM_DEFINITIONS[action.itemId];
            if (!item || item.type !== 'cargo' || !consumeItem(actor, action.itemId)) {
                return;
            }

            let influenceGain = item.influence || 0;
            let extraDeliveryText = '';
            if (actor.role === 'boss') {
                influenceGain += 1;
            }

            if (actor.role === 'smuggler') {
                const extraItemId = actor.inventory.find(itemId => ITEM_DEFINITIONS[itemId]?.type === 'cargo');
                if (extraItemId) {
                    consumeItem(actor, extraItemId);
                    influenceGain += ITEM_DEFINITIONS[extraItemId].influence || 0;
                    extraDeliveryText = ` พร้อมพ่วง ${ITEM_DEFINITIONS[extraItemId].name}`;
                }
            }

            actor.influence += influenceGain;
            actor.lastMove = `ส่ง ${item.name}`;
            report.push({ icon: '📦', text: `${actor.name} ส่ง ${item.name}${extraDeliveryText} รับ 👑 ${influenceGain}`, tone: 'gold' });
        }
    });

    aliveAtStart.forEach(playerId => {
        const actor = getPlayer(room, playerId);
        const action = actions[playerId];
        if (!actor || !action || actor.alive === false) {
            return;
        }

        if (action.actionType === 'laylow') {
            let heatDrop = actor.role === 'fixer' ? 2 : 1;
            // พาสปลอมเป็นของติดตัวเหมือนเครื่องดักฟัง — ไม่ถูกเผาทิ้งตอนใช้
            // (ข้อความไอเทม/actionHelp ทุกจุดสื่อว่าเป็นบัฟถาวร ไม่ใช่ของใช้แล้วหมด)
            if (hasItem(actor, 'passport')) {
                heatDrop += 2;
            }
            actor.heat = Math.max(0, actor.heat - heatDrop);
            actor.lastMove = 'หมอบต่ำ';
            report.push({ icon: '🫥', text: `${actor.name} หมอบต่ำ ล้าง 🔥 ได้ ${heatDrop}`, tone: 'blue' });
        }

        if (action.actionType === 'guard') {
            actor.lastMove = 'ตั้งการ์ด';
            report.push({ icon: '🦺', text: `${actor.name} ตั้งการ์ดรอรับทุกทาง`, tone: 'blue' });
        }
    });

    getAlivePlayers(room).forEach(player => {
        if (player.heat >= 5) {
            player.cash = Math.max(0, player.cash - 1);
            player.influence = Math.max(0, player.influence - 1);
            report.push({ icon: '🔥', text: `${player.name} ค่าหัวสูงเกินไป โดนริบแต้มและเงินอย่างละ 1`, tone: 'red' });
        }
    });

    room.gameState.actionChoices = {};
    room.gameState.marketChoices = {};
    room.gameState.lastAction = Date.now();

    report.forEach(entry => pushHistory(room, entry.icon, entry.text, entry.tone));
    startNextRound(room, report);
}

function buildLockProgress(room) {
    const phase = room.gameState.phase;
    const alive = getAlivePlayers(room);
    const total = alive.length;
    let locked = 0;
    if (phase === 'market') {
        const choices = room.gameState.marketChoices || {};
        locked = alive.filter(p => Object.prototype.hasOwnProperty.call(choices, p.playerId)).length;
    } else if (phase === 'action') {
        const choices = room.gameState.actionChoices || {};
        locked = alive.filter(p => Object.prototype.hasOwnProperty.call(choices, p.playerId)).length;
    } else {
        return null;
    }
    return { locked, total };
}

function buildClientState(room, playerId) {
    const self = getPlayer(room, playerId);
    if (!self) {
        return null;
    }

    const marketOffers = (room.gameState.marketOffers || []).map(itemId => {
        const item = describeItem(itemId);
        return item ? {
            ...item,
            affordable: self.cash >= getPurchasePrice(self, itemId),
            priceForPlayer: getPurchasePrice(self, itemId)
        } : null;
    }).filter(Boolean);

    return {
        roomId: room.roomId,
        mode: 'blackmarket',
        status: room.gameState.status,
        phase: room.gameState.phase,
        roundNumber: room.gameState.roundNumber,
        maxRounds: room.gameState.maxRounds,
        phaseEndsAt: room.gameState.phaseEndsAt || null,
        lockProgress: buildLockProgress(room),
        winner: room.gameState.winner,
        playerRole: {
            id: self.role,
            ...(self.roleInfo || {})
        },
        self: {
            playerId: self.playerId,
            alive: self.alive !== false,
            cash: self.cash,
            heat: self.heat,
            influence: self.influence,
            inventory: self.inventory.map(itemId => describeItem(itemId)).filter(Boolean),
            pendingMarketChoice: room.gameState.marketChoices?.[self.playerId] || null,
            pendingAction: describeActionChoice(room, self, room.gameState.actionChoices?.[self.playerId] || null),
            intelNotes: self.intelNotes || [],
            fixerEscapeAvailable: self.fixerEscapeAvailable,
            lastMove: self.lastMove || null
        },
        players: room.gameState.players.map(player => {
            const roleVisible = player.playerId === self.playerId
                || player.alive === false
                || room.gameState.phase === 'finished';
            return {
            playerId: player.playerId,
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            alive: player.alive !== false,
            influence: player.influence,
            cash: player.cash,
            heat: player.heat,
            inventoryCount: player.inventory.length,
            roleId: roleVisible ? player.role : null,
            roleTitle: roleVisible
                ? (player.roleInfo?.title || player.role || '-')
                : '???',
            roleIcon: roleVisible
                ? (player.roleInfo?.icon || '🎭')
                : '❓',
            roleImage: roleVisible ? (player.roleInfo?.image || null) : null,
            isSelf: player.playerId === self.playerId,
            lastMove: room.gameState.phase === 'finished' ? player.lastMove || null : null
        };
        }),
        marketOffers,
        dealLedger: (room.gameState.dealLedger || []).map(enrichFeedEntry),
        history: (room.gameState.history || []).map(enrichFeedEntry),
        lastRoundReport: (room.gameState.lastRoundReport || []).map(enrichFeedEntry),
        actionCatalog: buildActionCatalog(self),
        tutorial: buildTutorialState(room, self),
        actionHelp: {
            canHit: hasItem(self, 'gun') && self.cash >= (self.role === 'hitman' ? 2 : 3),
            cargoItems: self.inventory.map(itemId => describeItem(itemId)).filter(item => item?.type === 'cargo'),
            hasPassport: hasItem(self, 'passport')
        },
        passChoice: PASS_CHOICE
    };
}

function submitMarketPurchase(room, playerId, itemId) {
    if (!room || room.settings.gameMode !== 'blackmarket') {
        throw new Error('ไม่พบตลาดนี้');
    }

    if (room.gameState.phase !== 'market') {
        throw new Error('ตอนนี้ตลาดยังไม่เปิด');
    }

    const player = getPlayer(room, playerId);
    if (!player || player.alive === false) {
        throw new Error('คนที่ล้มไปแล้วแตะตลาดไม่ได้');
    }

    if (room.gameState.marketChoices[playerId]) {
        throw new Error('คุณล็อกของในยกนี้ไปแล้ว');
    }

    if (itemId !== PASS_CHOICE) {
        if (!room.gameState.marketOffers.includes(itemId)) {
            throw new Error('ของชิ้นนี้ไม่อยู่บนโต๊ะตลาด');
        }

        if (player.cash < getPurchasePrice(player, itemId)) {
            throw new Error('ทุนในมือไม่พอ');
        }
    }

    room.gameState.marketChoices[playerId] = itemId || PASS_CHOICE;
    if (everyoneCommitted(room, room.gameState.marketChoices)) {
        resolveMarketPhase(room);
        return { resolved: true, phase: room.gameState.phase };
    }

    return { resolved: false, phase: room.gameState.phase };
}

function autoResolvePhase(room) {
    if (!room?.gameState || room.gameState.phase === 'finished' || room.gameState.winner) {
        return { resolved: true, autoResolved: true, phase: room?.gameState?.phase || 'finished' };
    }

    if (room.gameState.phase === 'market') {
        fillMissingMarketChoices(room);
        if (everyoneCommitted(room, room.gameState.marketChoices)) {
            resolveMarketPhase(room);
            return { resolved: true, phase: room.gameState.phase, autoResolved: true };
        }
    }

    if (room.gameState.phase === 'action') {
        fillMissingActionChoices(room);
        if (everyoneCommitted(room, room.gameState.actionChoices)) {
            resolveActionPhase(room);
            return { resolved: true, phase: room.gameState.phase, autoResolved: true };
        }
    }

    return { resolved: false, autoResolved: true, phase: room.gameState.phase };
}

function submitAction(room, playerId, actionType, targetPlayerId = null, itemId = null) {
    if (!room || room.settings.gameMode !== 'blackmarket') {
        throw new Error('ไม่พบเกมนี้');
    }

    if (room.gameState.phase !== 'action') {
        throw new Error('ตอนนี้ยังไม่ถึงช่วงลงมือ');
    }

    const player = getPlayer(room, playerId);
    if (!player || player.alive === false) {
        throw new Error('คนที่ล้มไปแล้วลงมือไม่ได้');
    }

    if (room.gameState.actionChoices[playerId]) {
        throw new Error('คุณล็อกแผนในยกนี้ไปแล้ว');
    }

    const allowedActions = ['deliver', 'intel', 'raid', 'guard', 'laylow', 'hit', 'deal', 'betray', 'pass'];
    if (!allowedActions.includes(actionType)) {
        throw new Error('แผนนี้ไม่มีบนโต๊ะ');
    }

    if (actionType === 'deliver') {
        if (!itemId || ITEM_DEFINITIONS[itemId]?.type !== 'cargo' || !hasItem(player, itemId)) {
            throw new Error('ไม่มีของให้ส่ง');
        }
    }

    if (['intel', 'raid', 'hit', 'deal', 'betray'].includes(actionType)) {
        if (!targetPlayerId || targetPlayerId === playerId) {
            throw new Error('ต้องล็อกเป้าหมายก่อน');
        }
        const targetPlayer = getPlayer(room, targetPlayerId);
        if (!targetPlayer || targetPlayer.alive === false) {
            throw new Error('เป้าหมายนี้ไม่อยู่บนโต๊ะแล้ว — เลือกเป้าใหม่');
        }
    }

    if (actionType === 'hit' && (!hasItem(player, 'gun') || player.cash < (player.role === 'hitman' ? 2 : 3))) {
        throw new Error('ยังไม่มีเครื่องมือเปิดงาน');
    }

    room.gameState.actionChoices[playerId] = {
        actionType,
        targetPlayerId: targetPlayerId || null,
        itemId: itemId || null
    };

    if (everyoneCommitted(room, room.gameState.actionChoices)) {
        resolveActionPhase(room);
        return { resolved: true, phase: room.gameState.phase };
    }

    return { resolved: false, phase: room.gameState.phase };
}

module.exports = {
    id: 'blackmarket',
    label: 'Black Market',
    description: 'ตลาดมืด 4-7 คน กวาดของเถื่อน เปิดดีล หักหลัง และชิงอิทธิพล',
    minPlayers: 4,
    maxPlayers: 7,
    PASS_CHOICE,
    ROLE_DEFINITIONS,
    ITEM_DEFINITIONS,
    createInitialState,
    createPlayerState,
    resetRoomGame,
    startGame,
    buildClientState,
    submitMarketPurchase,
    submitAction,
    autoResolvePhase,
    MARKET_PHASE_MS,
    ACTION_PHASE_MS,
    getMarketPhaseMs,
    getActionPhaseMs
};