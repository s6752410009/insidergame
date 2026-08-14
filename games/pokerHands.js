/**
 * วัดมือเก้าเก 3 ใบ
 * ตอง (ตอง 3 สูงสุด) > เรียงสี > เซียน > เรียง > สี > แต้ม
 * เรียงไม่ห่อ — A-2-3 ไม่ใช่เรียง, Q-K-A สูงสุด
 * J-Q-K ดอกปน = เซียน; ดอกเดียวกัน = เรียงสี
 */

const { gameAssetImage } = require('./gameAssets');

const SUIT_META = {
    S: { id: 'S', name: 'Spades', thaiName: 'โพดำ', icon: '♠', color: 'black', order: 4 },
    H: { id: 'H', name: 'Hearts', thaiName: 'โพแดง', icon: '♥', color: 'red', order: 3 },
    D: { id: 'D', name: 'Diamonds', thaiName: 'ข้าวหลามตัด', icon: '♦', color: 'red', order: 2 },
    C: { id: 'C', name: 'Clubs', thaiName: 'ดอกจิก', icon: '♣', color: 'black', order: 1 }
};

const RANK_META = {
    A: { id: 'A', value: 14, name: 'Ace', thaiName: 'เอซ', point: 1, straight: 13, trips: 12 },
    K: { id: 'K', value: 13, name: 'King', thaiName: 'คิง', point: 0, straight: 12, trips: 11 },
    Q: { id: 'Q', value: 12, name: 'Queen', thaiName: 'ควีน', point: 0, straight: 11, trips: 10 },
    J: { id: 'J', value: 11, name: 'Jack', thaiName: 'แจ็ค', point: 0, straight: 10, trips: 9 },
    10: { id: '10', value: 10, name: 'Ten', thaiName: '10', point: 0, straight: 9, trips: 8 },
    9: { id: '9', value: 9, name: 'Nine', thaiName: '9', point: 9, straight: 8, trips: 7 },
    8: { id: '8', value: 8, name: 'Eight', thaiName: '8', point: 8, straight: 7, trips: 6 },
    7: { id: '7', value: 7, name: 'Seven', thaiName: '7', point: 7, straight: 6, trips: 5 },
    6: { id: '6', value: 6, name: 'Six', thaiName: '6', point: 6, straight: 5, trips: 4 },
    5: { id: '5', value: 5, name: 'Five', thaiName: '5', point: 5, straight: 4, trips: 3 },
    4: { id: '4', value: 4, name: 'Four', thaiName: '4', point: 4, straight: 3, trips: 2 },
    3: { id: '3', value: 3, name: 'Three', thaiName: '3', point: 3, straight: 2, trips: 13 },
    2: { id: '2', value: 2, name: 'Two', thaiName: '2', point: 2, straight: 1, trips: 1 }
};

const SUIT_ORDER = ['S', 'H', 'D', 'C'];
const RANK_ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const FACE_RANKS = new Set(['J', 'Q', 'K']);
const SEAN_RANK = { K: 3, Q: 2, J: 1 };
const CARD_BACK = gameAssetImage('poker', 'back');

const CATEGORY = {
    POINT: 1,
    FLUSH: 2,
    STRAIGHT: 3,
    SEAN: 4,
    STRAIGHT_FLUSH: 5,
    TRIPS: 6
};

const CATEGORY_THAI = {
    [CATEGORY.POINT]: 'แต้ม',
    [CATEGORY.FLUSH]: 'สี',
    [CATEGORY.STRAIGHT]: 'เรียง',
    [CATEGORY.SEAN]: 'เซียน',
    [CATEGORY.STRAIGHT_FLUSH]: 'เรียงสี',
    [CATEGORY.TRIPS]: 'ตอง'
};

function rankThaiName(rankOrValue) {
    if (RANK_META[rankOrValue]) return RANK_META[rankOrValue].thaiName;
    const row = Object.values(RANK_META).find(item => item.value === Number(rankOrValue));
    return row ? row.thaiName : String(rankOrValue);
}

function parseCardId(cardId) {
    const raw = String(cardId || '');
    const suit = raw.slice(-1);
    const rank = raw.slice(0, -1);
    if (!RANK_META[rank] || !SUIT_META[suit]) {
        throw new Error('ไพ่ไม่รู้จัก: ' + raw);
    }
    const meta = RANK_META[rank];
    return {
        id: raw,
        rank,
        suit,
        value: meta.value,
        point: meta.point,
        straight: meta.straight,
        trips: meta.trips,
        suitOrder: SUIT_META[suit].order
    };
}

function describeCard(cardId) {
    const parsed = parseCardId(cardId);
    const rank = RANK_META[parsed.rank];
    const suit = SUIT_META[parsed.suit];
    return {
        id: parsed.id,
        rank: rank.id,
        suit: suit.id,
        value: rank.value,
        name: `${rank.name} of ${suit.name}`,
        thaiName: `${rank.thaiName}${suit.icon}`,
        icon: suit.icon,
        color: suit.color,
        image: gameAssetImage('poker', `${rank.id.toLowerCase()}${suit.id.toLowerCase()}`),
        back: CARD_BACK
    };
}

function buildDeck() {
    const deck = [];
    SUIT_ORDER.forEach(suit => {
        RANK_ORDER.forEach(rank => {
            deck.push(rank + suit);
        });
    });
    return deck;
}

function shuffle(items) {
    const clone = [...items];
    for (let i = clone.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [clone[i], clone[j]] = [clone[j], clone[i]];
    }
    return clone;
}

function combinations(items, size) {
    const result = [];
    function walk(start, chosen) {
        if (chosen.length === size) {
            result.push(chosen.slice());
            return;
        }
        for (let i = start; i < items.length; i += 1) {
            chosen.push(items[i]);
            walk(i + 1, chosen);
            chosen.pop();
        }
    }
    walk(0, []);
    return result;
}

function packScore(category, parts) {
    const padded = (parts || []).slice(0, 7);
    while (padded.length < 7) padded.push(0);
    return padded.reduce((acc, n) => acc * 100 + (Number(n) || 0), category);
}

function isStraightCards(cards) {
    const vals = cards.map(card => card.straight).sort((a, b) => a - b);
    if (new Set(vals).size !== 3) return false;
    return vals[1] === vals[0] + 1 && vals[2] === vals[1] + 1;
}

function isSeanCards(cards) {
    return cards.every(card => FACE_RANKS.has(card.rank));
}

function pointOf(cards) {
    return cards.reduce((sum, card) => sum + card.point, 0) % 10;
}

function formatStraightLabel(cards) {
    return [...cards]
        .sort((a, b) => a.straight - b.straight)
        .map(card => rankThaiName(card.rank))
        .join('-');
}

function describeEvaluated(result) {
    const cards = (result.parsed || []).length
        ? result.parsed
        : (result.cards || []).map(parseCardId);
    if (result.category === CATEGORY.TRIPS) {
        return `ตอง${rankThaiName(cards[0].rank)}`;
    }
    if (result.category === CATEGORY.STRAIGHT_FLUSH) {
        return `เรียงสี ${formatStraightLabel(cards)}${SUIT_META[cards[0].suit].icon}`;
    }
    if (result.category === CATEGORY.SEAN) {
        const ranks = [...cards]
            .sort((a, b) => (SEAN_RANK[b.rank] - SEAN_RANK[a.rank]) || (b.suitOrder - a.suitOrder))
            .map(card => rankThaiName(card.rank))
            .join('');
        return `เซียน ${ranks}`;
    }
    if (result.category === CATEGORY.STRAIGHT) {
        return `เรียง ${formatStraightLabel(cards)}`;
    }
    if (result.category === CATEGORY.FLUSH) {
        return `สี${SUIT_META[cards[0].suit].icon}`;
    }
    if (result.pending) {
        return `แต้ม${result.point} · รอใบที่ 3`;
    }
    return `แต้ม${result.point}`;
}

function withHandTitle(result) {
    return { ...result, title: describeEvaluated(result), guideCategory: result.category };
}

const RANK_GUIDE = [
    { category: CATEGORY.TRIPS, name: 'ตอง', hint: 'สามใบเลขเดียวกัน · ตอง 3 ใหญ่สุด เพราะ 3+3+3 เป็น 9 แล้วค่อยเอซ คิง ควีน', example: ['3H', '3S', '3D'], live: [true, true, true] },
    { category: CATEGORY.STRAIGHT_FLUSH, name: 'เรียงสี', hint: 'เหมือนเรียง แต่ต้องดอกเดียวกัน เช่น 7♥ 8♥ 9♥', example: ['7H', '8H', '9H'], live: [true, true, true] },
    { category: CATEGORY.SEAN, name: 'เซียน', hint: 'แจ็ค ควีน คิง ทั้งสามใบ ดอกปนได้', example: ['JH', 'QS', 'KD'], live: [true, true, true] },
    { category: CATEGORY.STRAIGHT, name: 'เรียง', hint: 'เลขต่อกัน เช่น 3 > 4 > 5 ไม่ต้องดอกเดียวกัน · เอซ-2-3 ไม่นับเรียง', example: ['5S', '6H', '7D'], live: [true, true, true] },
    { category: CATEGORY.FLUSH, name: 'สี', hint: 'ดอกเดียวกัน แต่เลขไม่ต่อกัน · ดูดอกก่อน ♠ ใหญ่กว่า ♥ ♦ ♣', example: ['KH', '9H', '2H'], live: [true, true, true] },
    { category: CATEGORY.POINT, name: 'แต้ม', hint: 'ไม่เข้ามือไหน เอซ=1, 2–9 ตามหน้า, 10 แจ็คควีนคิง=0 รวมแล้วเอาหลักหน่วย เก้าใหญ่สุด', example: ['AS', '8D', 'KC'], live: [true, true, true] }
];

function rankGuideForClient() {
    return RANK_GUIDE.map(row => ({
        category: row.category,
        name: row.name,
        hint: row.hint,
        example: row.example.map((cardId, index) => ({
            ...describeCard(cardId),
            live: !row.live || row.live[index] !== false
        }))
    }));
}

function kickerParts(cards) {
    return [...cards]
        .sort((a, b) => (b.value - a.value) || (b.suitOrder - a.suitOrder))
        .flatMap(card => [card.value, card.suitOrder]);
}

function evaluateThree(cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length !== 3) {
        throw new Error('ต้องวัดมือ 3 ใบ');
    }
    const cards = cardIds.map(parseCardId);
    const flush = cards.every(card => card.suit === cards[0].suit);
    const straight = isStraightCards(cards);
    const sean = isSeanCards(cards);
    const trips = cards.every(card => card.rank === cards[0].rank);
    const point = pointOf(cards);
    const values = cards.map(card => card.value).sort((a, b) => b - a);

    let category = CATEGORY.POINT;
    let score = packScore(CATEGORY.POINT, [point, ...kickerParts(cards)]);

    if (trips) {
        category = CATEGORY.TRIPS;
        score = packScore(CATEGORY.TRIPS, [cards[0].trips]);
    } else if (straight && flush) {
        category = CATEGORY.STRAIGHT_FLUSH;
        const high = Math.max(...cards.map(card => card.straight));
        score = packScore(CATEGORY.STRAIGHT_FLUSH, [high, cards[0].suitOrder]);
    } else if (sean) {
        category = CATEGORY.SEAN;
        const ordered = [...cards].sort((a, b) =>
            (SEAN_RANK[b.rank] - SEAN_RANK[a.rank]) || (b.suitOrder - a.suitOrder));
        score = packScore(CATEGORY.SEAN, [
            SEAN_RANK[ordered[0].rank],
            SEAN_RANK[ordered[1].rank],
            SEAN_RANK[ordered[2].rank],
            ordered[0].suitOrder
        ]);
    } else if (straight) {
        category = CATEGORY.STRAIGHT;
        const highCard = [...cards].sort((a, b) => (b.straight - a.straight) || (b.suitOrder - a.suitOrder))[0];
        score = packScore(CATEGORY.STRAIGHT, [highCard.straight, highCard.suitOrder]);
    } else if (flush) {
        category = CATEGORY.FLUSH;
        score = packScore(CATEGORY.FLUSH, [cards[0].suitOrder, ...values]);
    }

    return withHandTitle({
        cards: cardIds.slice(),
        parsed: cards,
        category,
        categoryName: CATEGORY_THAI[category],
        score,
        values,
        point
    });
}

function evaluatePartial(cardIds) {
    const cards = (cardIds || []).map(parseCardId);
    const point = pointOf(cards);
    const values = cards.map(card => card.value).sort((a, b) => b - a);
    return withHandTitle({
        cards: (cardIds || []).slice(),
        parsed: cards,
        category: CATEGORY.POINT,
        categoryName: 'รอใบที่ 3',
        score: 0,
        values,
        point,
        pending: true
    });
}

function evaluateHand(cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length < 2) {
        return withHandTitle({
            cards: [],
            parsed: [],
            category: CATEGORY.POINT,
            categoryName: 'ไม่มีไพ่',
            score: 0,
            values: [],
            point: 0
        });
    }
    if (cardIds.length === 2) return evaluatePartial(cardIds);
    if (cardIds.length === 3) return evaluateThree(cardIds);
    return bestThreeFrom(cardIds);
}

function bestThreeFrom(cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length < 3) {
        return evaluateHand(cardIds || []);
    }
    if (cardIds.length === 3) return evaluateThree(cardIds);
    let best = null;
    combinations(cardIds, 3).forEach(combo => {
        const result = evaluateThree(combo);
        if (!best || result.score > best.score) best = result;
    });
    return best;
}

function compareHands(leftIds, rightIds) {
    return evaluateHand(leftIds).score - evaluateHand(rightIds).score;
}

module.exports = {
    SUIT_META,
    RANK_META,
    SUIT_ORDER,
    RANK_ORDER,
    CARD_BACK,
    CATEGORY,
    CATEGORY_THAI,
    parseCardId,
    describeCard,
    buildDeck,
    shuffle,
    combinations,
    evaluateHand,
    evaluateThree,
    bestThreeFrom,
    describeEvaluated,
    RANK_GUIDE,
    rankGuideForClient,
    compareHands,
    pointOf
};
