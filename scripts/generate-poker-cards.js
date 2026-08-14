/**
 * เจนไพ่โป๊กเกอร์ 52 ใบ + หลังไพ่ เป็น SVG
 * เด็คฝรั่งเศสมาตรฐาน: มุม rank+suit, จุด 2–10 ตาม English pattern, หน้าคน J/Q/K สองทิศ
 *
 * รัน: node scripts/generate-poker-cards.js
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'games', 'poker');
const W = 250;
const H = 350;

const SUITS = {
    S: { id: 's', name: 'Spades', thai: 'โพดำ', color: '#111111', pip: 'spade' },
    H: { id: 'h', name: 'Hearts', thai: 'โพแดง', color: '#c41e3a', pip: 'heart' },
    D: { id: 'd', name: 'Diamonds', thai: 'ข้าวหลามตัด', color: '#c41e3a', pip: 'diamond' },
    C: { id: 'c', name: 'Clubs', thai: 'ดอกจิก', color: '#111111', pip: 'club' }
};

const RANKS = [
    { id: 'A', label: 'A', thai: 'เอซ', pips: 1 },
    { id: '2', label: '2', thai: '2', pips: 2 },
    { id: '3', label: '3', thai: '3', pips: 3 },
    { id: '4', label: '4', thai: '4', pips: 4 },
    { id: '5', label: '5', thai: '5', pips: 5 },
    { id: '6', label: '6', thai: '6', pips: 6 },
    { id: '7', label: '7', thai: '7', pips: 7 },
    { id: '8', label: '8', thai: '8', pips: 8 },
    { id: '9', label: '9', thai: '9', pips: 9 },
    { id: '10', label: '10', thai: '10', pips: 10 },
    { id: 'J', label: 'J', thai: 'แจ็ค', pips: 0, face: 'jack' },
    { id: 'Q', label: 'Q', thai: 'ควีน', pips: 0, face: 'queen' },
    { id: 'K', label: 'K', thai: 'คิง', pips: 0, face: 'king' }
];

const COL = { L: 0.28, C: 0.5, R: 0.72 };
const ROW = {
    r1: 0.13,
    r1c: 0.245,
    r2: 0.36,
    mid: 0.5,
    r3: 0.64,
    r3c: 0.755,
    r4: 0.87
};

// English-pattern pip grid. Third value = flip (bottom-half pips point down).
const PIP_LAYOUT = {
    1: [[COL.C, ROW.mid, false]],
    2: [[COL.C, ROW.r1, false], [COL.C, ROW.r4, true]],
    3: [[COL.C, ROW.r1, false], [COL.C, ROW.mid, false], [COL.C, ROW.r4, true]],
    4: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ],
    5: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.C, ROW.mid, false],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ],
    6: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.L, ROW.mid, false], [COL.R, ROW.mid, false],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ],
    7: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.C, ROW.r1c, false],
        [COL.L, ROW.mid, false], [COL.R, ROW.mid, false],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ],
    8: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.C, ROW.r1c, false],
        [COL.L, ROW.mid, false], [COL.R, ROW.mid, false],
        [COL.C, ROW.r3c, true],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ],
    9: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.L, ROW.r2, false], [COL.R, ROW.r2, false],
        [COL.C, ROW.mid, false],
        [COL.L, ROW.r3, true], [COL.R, ROW.r3, true],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ],
    10: [
        [COL.L, ROW.r1, false], [COL.R, ROW.r1, false],
        [COL.C, ROW.r1c, false],
        [COL.L, ROW.r2, false], [COL.R, ROW.r2, false],
        [COL.L, ROW.r3, true], [COL.R, ROW.r3, true],
        [COL.C, ROW.r3c, true],
        [COL.L, ROW.r4, true], [COL.R, ROW.r4, true]
    ]
};

function r(n) {
    return Math.round(n * 100) / 100;
}

function pipPath(type, s) {
    if (type === 'spade') {
        return `<path d="M${r(s * 0.5)} ${r(s * 0.02)}C${r(s * 0.22)} ${r(s * 0.36)} ${r(s * 0.02)} ${r(s * 0.5)} ${r(s * 0.02)} ${r(s * 0.68)}C${r(s * 0.02)} ${r(s * 0.86)} ${r(s * 0.18)} ${r(s)} ${r(s * 0.36)} ${r(s)}C${r(s * 0.43)} ${r(s)} ${r(s * 0.47)} ${r(s * 0.96)} ${r(s * 0.5)} ${r(s * 0.9)}C${r(s * 0.53)} ${r(s * 0.96)} ${r(s * 0.57)} ${r(s)} ${r(s * 0.64)} ${r(s)}C${r(s * 0.82)} ${r(s)} ${r(s * 0.98)} ${r(s * 0.86)} ${r(s * 0.98)} ${r(s * 0.68)}C${r(s * 0.98)} ${r(s * 0.5)} ${r(s * 0.78)} ${r(s * 0.36)} ${r(s * 0.5)} ${r(s * 0.02)}Z"/>
      <path d="M${r(s * 0.4)} ${r(s * 0.78)}H${r(s * 0.6)}L${r(s * 0.68)} ${r(s * 1.12)}H${r(s * 0.32)}Z"/>`;
    }
    if (type === 'heart') {
        return `<path d="M${r(s * 0.5)} ${r(s * 0.96)}C${r(s * 0.5)} ${r(s * 0.96)} ${r(s * 0.04)} ${r(s * 0.58)} ${r(s * 0.04)} ${r(s * 0.32)}C${r(s * 0.04)} ${r(s * 0.14)} ${r(s * 0.17)} ${r(s * 0.03)} ${r(s * 0.33)} ${r(s * 0.03)}C${r(s * 0.43)} ${r(s * 0.03)} ${r(s * 0.5)} ${r(s * 0.12)} ${r(s * 0.5)} ${r(s * 0.2)}C${r(s * 0.5)} ${r(s * 0.12)} ${r(s * 0.57)} ${r(s * 0.03)} ${r(s * 0.67)} ${r(s * 0.03)}C${r(s * 0.83)} ${r(s * 0.03)} ${r(s * 0.96)} ${r(s * 0.14)} ${r(s * 0.96)} ${r(s * 0.32)}C${r(s * 0.96)} ${r(s * 0.58)} ${r(s * 0.5)} ${r(s * 0.96)} ${r(s * 0.5)} ${r(s * 0.96)}Z"/>`;
    }
    if (type === 'diamond') {
        return `<path d="M${r(s * 0.5)} ${r(s * 0.02)}L${r(s * 0.94)} ${r(s * 0.5)}L${r(s * 0.5)} ${r(s * 0.98)}L${r(s * 0.06)} ${r(s * 0.5)}Z"/>`;
    }
    return `<circle cx="${r(s * 0.5)}" cy="${r(s * 0.26)}" r="${r(s * 0.22)}"/>
      <circle cx="${r(s * 0.24)}" cy="${r(s * 0.52)}" r="${r(s * 0.22)}"/>
      <circle cx="${r(s * 0.76)}" cy="${r(s * 0.52)}" r="${r(s * 0.22)}"/>
      <path d="M${r(s * 0.4)} ${r(s * 0.6)}H${r(s * 0.6)}L${r(s * 0.68)} ${r(s * 1.08)}H${r(s * 0.32)}Z"/>`;
}

function suitMark(type, x, y, size, color, flip) {
    const s = r(size);
    const t = `translate(${r(x)} ${r(y)})${flip ? ' rotate(180)' : ''} translate(${r(-s / 2)} ${r(-s / 2)})`;
    return `<g transform="${t}" fill="${color}">${pipPath(type, s)}</g>`;
}

function indexBlock(rank, suit, x, y, color, flip) {
    const fontSize = rank === '10' ? 24 : 30;
    const t = flip
        ? `translate(${r(x)} ${r(y)}) rotate(180)`
        : `translate(${r(x)} ${r(y)})`;
    return `<g transform="${t}" fill="${color}" font-family="Georgia, 'Palatino Linotype', 'Times New Roman', serif" font-weight="700">
      <text x="0" y="${fontSize}" font-size="${fontSize}" text-anchor="middle">${rank}</text>
      ${suitMark(suit.pip, 0, fontSize + 16, 15, color, false)}
    </g>`;
}

function faceFeatures(skin, hair, blush) {
    return `
      <ellipse cx="125" cy="108" rx="17.5" ry="19.5" fill="${skin}" stroke="#c4a07a" stroke-width="1"/>
      <ellipse cx="108.2" cy="110" rx="3.1" ry="4.4" fill="${skin}" stroke="#c4a07a" stroke-width="0.55"/>
      <ellipse cx="141.8" cy="110" rx="3.1" ry="4.4" fill="${skin}" stroke="#c4a07a" stroke-width="0.55"/>
      <ellipse cx="118.2" cy="106.2" rx="3.5" ry="2.3" fill="#fff"/>
      <ellipse cx="131.8" cy="106.2" rx="3.5" ry="2.3" fill="#fff"/>
      <circle cx="118.8" cy="106.4" r="1.35" fill="#2a2118"/>
      <circle cx="132.4" cy="106.4" r="1.35" fill="#2a2118"/>
      <circle cx="119.4" cy="105.8" r="0.45" fill="#fff"/>
      <circle cx="133" cy="105.8" r="0.45" fill="#fff"/>
      <path d="M113.5 101.2 Q118.2 98.6 123.2 101" fill="none" stroke="${hair}" stroke-width="1.15" stroke-linecap="round"/>
      <path d="M126.8 101 Q131.8 98.6 136.5 101.2" fill="none" stroke="${hair}" stroke-width="1.15" stroke-linecap="round"/>
      <path d="M125 107.5 L122.2 114.2 Q125 115.4 127.8 114.2 Z" fill="#c4a07a" opacity="0.55"/>
      <ellipse cx="118" cy="112.5" rx="3.4" ry="1.6" fill="${blush}" opacity="0.35"/>
      <ellipse cx="132" cy="112.5" rx="3.4" ry="1.6" fill="${blush}" opacity="0.35"/>
      <path d="M119.5 119.2 Q125 123.2 130.5 119.2" fill="none" stroke="#a85a52" stroke-width="1.15" stroke-linecap="round"/>`;
}

function panelFrame(color) {
    const gold = '#c9a227';
    return `
      <rect x="70" y="70" width="110" height="100" rx="7" fill="#f3ead6" stroke="${gold}" stroke-width="2.4"/>
      <rect x="74" y="74" width="102" height="92" rx="5" fill="none" stroke="${color}" stroke-width="0.9" opacity="0.4"/>
      <path d="M78 78 H176 M78 162 H176" stroke="${gold}" stroke-width="0.5" opacity="0.55"/>
      <circle cx="78" cy="78" r="2.1" fill="${gold}"/>
      <circle cx="172" cy="78" r="2.1" fill="${gold}"/>
      <circle cx="78" cy="162" r="2.1" fill="${gold}"/>
      <circle cx="172" cy="162" r="2.1" fill="${gold}"/>`;
}

function courtHalf(face, suit, color) {
    const gold = '#c9a227';
    const skin = '#f0d0a8';
    const hair = face === 'queen' ? '#3d2918' : '#1c1410';
    const blush = '#e08a7a';
    const sidePip = suitMark(suit.pip, 86, 102, 18, color, false);
    const features = faceFeatures(skin, hair, blush);

    if (face === 'king') {
        return `<g>
      ${panelFrame(color)}
      <path d="M109 100 Q104 118 112 126 Q108 108 109 100Z" fill="${hair}"/>
      <path d="M141 100 Q146 118 138 126 Q142 108 141 100Z" fill="${hair}"/>
      <path d="M90 170 L106 126 L144 126 L160 170 Z" fill="${color}"/>
      <path d="M106 126 L125 170 L144 126 Z" fill="${gold}" opacity="0.28"/>
      <rect x="109" y="146" width="32" height="5.5" rx="1" fill="${gold}"/>
      <path d="M114 132 H136 V140 H114 Z" fill="#f7f1e4" opacity="0.35"/>
      ${features}
      <path d="M111 121 Q125 150 139 121 Q132 130 125 132 Q118 130 111 121Z" fill="${hair}"/>
      <path d="M107 93 L111.5 76 L118.5 87 L125 72 L131.5 87 L138.5 76 L143 93 Z" fill="${gold}" stroke="#8a6a10" stroke-width="0.75"/>
      <circle cx="111.5" cy="76" r="2.3" fill="#fbf7ee"/>
      <circle cx="125" cy="72" r="2.6" fill="${color}"/>
      <circle cx="138.5" cy="76" r="2.3" fill="#fbf7ee"/>
      <rect x="155.2" y="94" width="3.4" height="48" rx="1.2" fill="${gold}"/>
      <circle cx="156.9" cy="91" r="6.2" fill="${gold}" stroke="#8a6a10" stroke-width="0.7"/>
      ${suitMark(suit.pip, 156.9, 91, 9, color, false)}
      ${sidePip}
    </g>`;
    }

    if (face === 'queen') {
        return `<g>
      ${panelFrame(color)}
      <path d="M109 110 Q108 86 125 82 Q142 86 141 110 Q136 96 125 94 Q114 96 109 110Z" fill="${hair}"/>
      <path d="M92 170 C102 132 148 132 158 170 Z" fill="${color}"/>
      <path d="M108 138 H142 V146 H108 Z" fill="${gold}" opacity="0.55"/>
      <path d="M118 146 H132 V170 H118 Z" fill="${gold}" opacity="0.22"/>
      ${features}
      <path d="M107 104 C100 122 98 148 104 168" fill="none" stroke="${hair}" stroke-width="7" stroke-linecap="round"/>
      <path d="M143 104 C150 122 152 148 146 168" fill="none" stroke="${hair}" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="125" cy="94" rx="21" ry="7.5" fill="none" stroke="${gold}" stroke-width="3.1"/>
      <circle cx="125" cy="85.5" r="3.1" fill="${gold}"/>
      <circle cx="108" cy="94" r="2.1" fill="${color}"/>
      <circle cx="142" cy="94" r="2.1" fill="${color}"/>
      <circle cx="110.5" cy="116" r="1.7" fill="${gold}"/>
      <circle cx="139.5" cy="116" r="1.7" fill="${gold}"/>
      <path d="M152 128 C160 118 168 128 160 136 C168 130 162 118 154 122" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
      ${suitMark(suit.pip, 161, 118, 11, color, false)}
      ${sidePip}
    </g>`;
    }

    return `<g>
      ${panelFrame(color)}
      <path d="M111 108 C111 88 139 88 139 108 C136 94 114 94 111 108Z" fill="${hair}"/>
      <path d="M96 170 L125 128 L154 170 Z" fill="${color}"/>
      <path d="M112 148 H138 V156 H112 Z" fill="${gold}"/>
      ${features}
      <path d="M108 96 Q125 78 142 96 L138 102 Q125 90 112 102 Z" fill="${color}"/>
      <path d="M140 84 C152 78 158 96 148 104" fill="none" stroke="${gold}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M148 82 L162 70 L156 86 Z" fill="${gold}"/>
      <rect x="154.8" y="108" width="3.2" height="40" rx="1" fill="${gold}"/>
      ${suitMark(suit.pip, 156.4, 105, 10, color, false)}
      ${sidePip}
    </g>`;
}

function faceCard(rank, suit) {
    const color = suit.color;
    return `${courtHalf(rank.face, suit, color)}
    <g transform="rotate(180 125 175)">${courtHalf(rank.face, suit, color)}</g>
    <rect x="108" y="168" width="34" height="14" rx="3" fill="#fbf8f1" stroke="${color}" stroke-width="1" opacity="0.95"/>
    ${suitMark(suit.pip, 125, 175, 16, color, false)}`;
}

function ornateAceSpade() {
    const color = SUITS.S.color;
    const gold = '#c9a227';
    return `
    ${suitMark('spade', 125, 176, 118, color, false)}
    <path d="M70 176 C78 150 98 142 112 150" fill="none" stroke="${gold}" stroke-width="1.6"/>
    <path d="M180 176 C172 150 152 142 138 150" fill="none" stroke="${gold}" stroke-width="1.6"/>
    <path d="M74 176 C82 202 98 208 112 200" fill="none" stroke="${gold}" stroke-width="1.6"/>
    <path d="M176 176 C168 202 152 208 138 200" fill="none" stroke="${gold}" stroke-width="1.6"/>
    <circle cx="70" cy="176" r="2.4" fill="${gold}"/>
    <circle cx="180" cy="176" r="2.4" fill="${gold}"/>
    <path d="M104 232 H146" stroke="${gold}" stroke-width="1.2"/>
    <path d="M110 238 H140" stroke="${gold}" stroke-width="0.8"/>`;
}

function numberCard(rank, suit) {
    if (rank.id === 'A' && suit.pip === 'spade') {
        return ornateAceSpade();
    }
    const color = suit.color;
    const inner = { x: 48, y: 50, w: 154, h: 250 };
    const size = rank.pips === 1 ? 92 : rank.pips >= 9 ? 32 : 40;
    return (PIP_LAYOUT[rank.pips] || []).map(([px, py, flip]) => {
        const x = inner.x + inner.w * px;
        const y = inner.y + inner.h * py;
        return suitMark(suit.pip, x, y, size, color, flip);
    }).join('\n    ');
}

function cardSvg(rank, suit) {
    const color = suit.color;
    const body = rank.face ? faceCard(rank, suit) : numberCard(rank, suit);
    const aria = `${rank.thai} ${suit.thai}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffdf8"/>
      <stop offset="1" stop-color="#f4ead6"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="16" fill="#e8dcc4"/>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="12" fill="url(#paper)" stroke="#d2c4aa" stroke-width="1.2"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="9" fill="none" stroke="${color}" stroke-opacity="0.16" stroke-width="1"/>
  ${indexBlock(rank.label, suit, 26, 16, color, false)}
  ${indexBlock(rank.label, suit, W - 26, H - 16, color, true)}
  ${body}
</svg>
`;
}

function backSvg() {
    const diamonds = [];
    for (let row = 0; row < 11; row += 1) {
        for (let col = 0; col < 7; col += 1) {
            const x = 36 + col * 30 + (row % 2 ? 15 : 0);
            const y = 34 + row * 26;
            diamonds.push(`<path d="M${x} ${y - 9} L${x + 8} ${y} L${x} ${y + 9} L${x - 8} ${y}Z" fill="${(row + col) % 2 ? '#1a4a78' : '#0f3358'}"/>`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Card back">
  <rect width="${W}" height="${H}" rx="16" fill="#0b2744"/>
  <rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="11" fill="#123a60" stroke="#d4a017" stroke-width="3"/>
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="8" fill="#0e2f52" stroke="#7eb6d9" stroke-width="1"/>
  <g opacity="0.95">${diamonds.join('')}</g>
  <ellipse cx="125" cy="175" rx="54" ry="68" fill="#0c2a4c" stroke="#d4a017" stroke-width="2.4"/>
  <ellipse cx="125" cy="175" rx="44" ry="56" fill="none" stroke="#7eb6d9" stroke-width="1"/>
  ${suitMark('spade', 125, 162, 42, '#d4a017', false)}
  <path d="M96 204 H154" stroke="#d4a017" stroke-width="1.2"/>
</svg>
`;
}

function main() {
    fs.mkdirSync(OUT, { recursive: true });
    let count = 0;
    Object.values(SUITS).forEach(suit => {
        RANKS.forEach(rank => {
            const file = `${rank.id.toLowerCase()}${suit.id}.svg`;
            fs.writeFileSync(path.join(OUT, file), cardSvg(rank, suit));
            count += 1;
        });
    });
    fs.writeFileSync(path.join(OUT, 'back.svg'), backSvg());
    console.log(`Wrote ${count} face cards + back → ${OUT}`);
}

main();
