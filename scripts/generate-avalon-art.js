/**
 * สร้างการ์ด/โทเคน SVG ของอวาลอน (งานวาดต้นฉบับของโปรเจกต์ — ไม่ได้ใช้ภาพจากเกมจริง)
 *
 * รัน: node scripts/generate-avalon-art.js
 * ผลลัพธ์: public/assets/games/avalon/*.svg
 * สไตล์: พื้นกรมท่า #1a2332 · สัญลักษณ์ทอง #f5c86b · ฝ่ายดีฟ้าคราม · ฝ่ายร้ายแดงเลือดนก
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'games', 'avalon');
fs.mkdirSync(OUT, { recursive: true });

const FONT = "'Chakra Petch','Bai Jamjuree','Sukhumvit Set','Thonburi',Tahoma,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const TEAM = {
    good: {
        sky: ['#2c5796', '#16294a', '#0d1628'],
        glow: '#7fb0ff',
        banner: ['#2a5fa8', '#173a6e'],
        label: 'ฝ่ายดี'
    },
    evil: {
        sky: ['#7a2230', '#3a1220', '#140a12'],
        glow: '#ff7a6b',
        banner: ['#a3283a', '#5e1220'],
        label: 'ฝ่ายร้าย'
    }
};

function goldDefs() {
    return `
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff0c2"/>
      <stop offset="0.45" stop-color="#f5c86b"/>
      <stop offset="1" stop-color="#b9822f"/>
    </linearGradient>
    <linearGradient id="goldSide" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b9822f"/>
      <stop offset="0.5" stop-color="#ffe7a6"/>
      <stop offset="1" stop-color="#b9822f"/>
    </linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9aa7bb"/>
      <stop offset="0.5" stop-color="#f4f7fb"/>
      <stop offset="1" stop-color="#7d8aa0"/>
    </linearGradient>`;
}

function star(x, y, r, opacity = 0.9) {
    const s = r * 0.28;
    return `<path d="M${x} ${y - r} L${x + s} ${y - s} L${x + r} ${y} L${x + s} ${y + s} L${x} ${y + r} L${x - s} ${y + s} L${x - r} ${y} L${x - s} ${y - s} Z" fill="#fff4d0" opacity="${opacity}"/>`;
}

function dust(seed, count, box) {
    // จุดดาวแบบกำหนดตำแหน่งตายตัว (ไม่สุ่มทุกครั้งที่รัน ไฟล์จะได้ไม่เปลี่ยนเปล่า ๆ)
    let x = seed;
    const rand = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    let out = '';
    for (let i = 0; i < count; i += 1) {
        const cx = box[0] + rand() * (box[2] - box[0]);
        const cy = box[1] + rand() * (box[3] - box[1]);
        const r = 0.5 + rand() * 1.1;
        out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff6dc" opacity="${(0.25 + rand() * 0.55).toFixed(2)}"/>`;
    }
    return out;
}

function corner(x, y, sx, sy) {
    return `<g transform="translate(${x} ${y}) scale(${sx} ${sy})" fill="none" stroke="url(#gold)" stroke-width="1.4" stroke-linecap="round">
      <path d="M0 18 Q0 0 18 0"/>
      <path d="M5 26 L5 12 Q5 5 12 5 L26 5" stroke-opacity="0.55"/>
      <path d="M9 9 L13 13" stroke-width="2"/>
    </g>
    <circle cx="${x + sx * 11}" cy="${y + sy * 11}" r="2.2" fill="#f5c86b"/>`;
}

const ARCH = 'M36 216 V112 A84 84 0 0 1 204 112 V216 Z';

/**
 * การ์ดแนวตั้ง 240×336: หน้าต่างโค้ง (ภาพ) + ริบบิ้นชื่อ + ชื่ออังกฤษตัวเล็ก + ป้ายฝ่าย
 */
function portraitCard({ team, emblem, thai, latin, footer, seed = 7 }) {
    const t = TEAM[team];
    const nameSize = thai.length > 10 ? 17 : (thai.length > 7 ? 19 : 22);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336" width="240" height="336" role="img" aria-label="${thai}">
  <defs>${goldDefs()}
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#23324c"/>
      <stop offset="1" stop-color="#111a29"/>
    </linearGradient>
    <radialGradient id="sky" cx="0.5" cy="0.42" r="0.7">
      <stop offset="0" stop-color="${t.sky[0]}"/>
      <stop offset="0.55" stop-color="${t.sky[1]}"/>
      <stop offset="1" stop-color="${t.sky[2]}"/>
    </radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${t.glow}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${t.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.banner[0]}"/>
      <stop offset="1" stop-color="${t.banner[1]}"/>
    </linearGradient>
    <pattern id="tex" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="none"/>
      <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1.6"/>
    </pattern>
    <clipPath id="win"><path d="${ARCH}"/></clipPath>
  </defs>
  <rect width="240" height="336" rx="16" fill="url(#bg)"/>
  <rect width="240" height="336" rx="16" fill="url(#tex)"/>
  <rect x="7" y="7" width="226" height="322" rx="11" fill="none" stroke="url(#gold)" stroke-width="1.8"/>
  <rect x="13" y="13" width="214" height="310" rx="8" fill="none" stroke="#f5c86b" stroke-opacity="0.35" stroke-width="0.8"/>
  ${corner(13, 13, 1, 1)}${corner(227, 13, -1, 1)}${corner(13, 323, 1, -1)}${corner(227, 323, -1, -1)}
  <g clip-path="url(#win)">
    <rect x="30" y="20" width="180" height="200" fill="url(#sky)"/>
    ${dust(seed, 38, [38, 26, 202, 214])}
    <circle cx="120" cy="124" r="84" fill="url(#halo)"/>
    <g>${emblem}</g>
    <rect x="30" y="190" width="180" height="30" fill="#0b111c" opacity="0.35"/>
  </g>
  <path d="${ARCH}" fill="none" stroke="url(#gold)" stroke-width="2.6"/>
  <path d="M42 216 V113 A78 78 0 0 1 198 113 V216" fill="none" stroke="#f5c86b" stroke-opacity="0.35" stroke-width="0.9"/>
  <path d="M120 22 l5 7 l-5 7 l-5 -7 Z" fill="url(#gold)"/>
  <!-- ribbon -->
  <path d="M14 244 L30 244 L30 272 L14 272 L22 258 Z" fill="${t.banner[1]}" stroke="url(#gold)" stroke-width="1.2"/>
  <path d="M226 244 L210 244 L210 272 L226 272 L218 258 Z" fill="${t.banner[1]}" stroke="url(#gold)" stroke-width="1.2"/>
  <path d="M26 236 H214 V268 H26 Z" fill="url(#ribbon)" stroke="url(#gold)" stroke-width="1.8"/>
  <path d="M26 268 L30 272 L30 268 Z M214 268 L210 272 L210 268 Z" fill="#0b0f18"/>
  <text x="120" y="${259 + (22 - nameSize) * 0.2}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${nameSize}" fill="#fff6dc" letter-spacing="0.5">${thai}</text>
  <text x="120" y="290" text-anchor="middle" font-family="${SERIF}" font-size="11" fill="#f5c86b" fill-opacity="0.85" letter-spacing="4.5">${latin}</text>
  <g fill="#f5c86b">
    <path d="M78 299 H112 M128 299 H162" stroke="#f5c86b" stroke-opacity="0.45" stroke-width="0.8"/>
    <path d="M120 295 l4 4 l-4 4 l-4 -4 Z"/>
  </g>
  <text x="120" y="316" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="10.5" fill="${team === 'good' ? '#a9c8ff' : '#ffb1a8'}">${footer}</text>
</svg>
`;
}

/* ------------------------------------------------------------------ emblems (พิกัดในหน้าต่าง 36..204 × 28..216) */

const EMBLEMS = {
    merlin: `
    <g stroke="#f5c86b" stroke-opacity="0.55" stroke-width="1.4" stroke-linecap="round">
      ${Array.from({ length: 16 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 16;
        const r1 = i % 2 ? 52 : 50;
        const r2 = i % 2 ? 60 : 70;
        return `<line x1="${(120 + Math.cos(a) * r1).toFixed(1)}" y1="${(110 + Math.sin(a) * r1).toFixed(1)}" x2="${(120 + Math.cos(a) * r2).toFixed(1)}" y2="${(110 + Math.sin(a) * r2).toFixed(1)}"/>`;
    }).join('')}
    </g>
    <defs>
      <radialGradient id="orb" cx="0.38" cy="0.32" r="0.75">
        <stop offset="0" stop-color="#e3efff"/>
        <stop offset="0.35" stop-color="#8db6f2"/>
        <stop offset="1" stop-color="#1c3a6b"/>
      </radialGradient>
    </defs>
    <circle cx="120" cy="110" r="42" fill="url(#orb)" stroke="url(#gold)" stroke-width="3"/>
    <path d="M90 110 Q120 86 150 110 Q120 134 90 110 Z" fill="#0e1a30" stroke="#fff4d0" stroke-width="1.6"/>
    <circle cx="120" cy="110" r="11" fill="url(#gold)"/>
    <circle cx="120" cy="110" r="4.5" fill="#0e1a30"/>
    <circle cx="116" cy="106" r="2" fill="#fff"/>
    <ellipse cx="106" cy="88" rx="10" ry="5" fill="#ffffff" opacity="0.35" transform="rotate(-30 106 88)"/>
    <path d="M86 146 Q120 164 154 146 L146 160 Q120 172 94 160 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1"/>
    <path d="M86 146 L80 136 M154 146 L160 136 M104 154 L100 142 M136 154 L140 142" stroke="url(#gold)" stroke-width="4" stroke-linecap="round"/>
    <path d="M104 166 H136 L144 184 H96 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1"/>
    <rect x="86" y="184" width="68" height="8" rx="3" fill="url(#goldSide)"/>
    ${star(62, 64, 7)}${star(176, 70, 6)}${star(172, 164, 5, 0.7)}${star(66, 156, 4, 0.7)}`,

    percival: `
    <path d="M120 58 L176 76 Q176 146 120 192 Q64 146 64 76 Z" fill="#1a3564" stroke="url(#gold)" stroke-width="3"/>
    <path d="M120 68 L166 83 Q164 142 120 180 Q76 142 74 83 Z" fill="none" stroke="#f5c86b" stroke-opacity="0.45" stroke-width="1.2"/>
    <path d="M122 70 C128 44 156 30 178 40 C168 42 160 46 154 54 C168 52 176 56 182 64 C162 60 146 64 134 76 Z" fill="#6ea3f5" stroke="#cfe0ff" stroke-width="1"/>
    <path d="M90 100 Q90 72 120 68 Q150 72 150 100 V150 Q120 166 90 150 Z" fill="url(#steel)" stroke="#5c687c" stroke-width="1.6"/>
    <path d="M90 100 Q90 72 120 68 Q150 72 150 100" fill="none" stroke="url(#gold)" stroke-width="3"/>
    <rect x="95" y="106" width="50" height="7" rx="2" fill="#0d1526"/>
    <rect x="116.5" y="113" width="7" height="30" rx="2" fill="#0d1526"/>
    <path d="M120 70 V104" stroke="url(#gold)" stroke-width="4"/>
    <path d="M90 150 Q120 166 150 150" fill="none" stroke="url(#gold)" stroke-width="3"/>
    ${[0, 1, 2].map(i => `<circle cx="${102 + i * 6}" cy="${128 + i * 5}" r="1.8" fill="#0d1526"/><circle cx="${138 - i * 6}" cy="${128 + i * 5}" r="1.8" fill="#0d1526"/>`).join('')}
    ${star(66, 176, 5, 0.7)}${star(176, 172, 6)}`,

    loyal: `
    <g transform="rotate(-32 120 118)">
      <path d="M116 44 L120 32 L124 44 V150 H116 Z" fill="url(#steel)" stroke="#5c687c" stroke-width="0.8"/>
      <rect x="100" y="150" width="40" height="7" rx="3" fill="url(#gold)"/>
      <rect x="117" y="157" width="6" height="22" fill="#3b2a1a"/>
      <circle cx="120" cy="183" r="5.5" fill="url(#gold)"/>
    </g>
    <g transform="rotate(32 120 118)">
      <path d="M116 44 L120 32 L124 44 V150 H116 Z" fill="url(#steel)" stroke="#5c687c" stroke-width="0.8"/>
      <rect x="100" y="150" width="40" height="7" rx="3" fill="url(#gold)"/>
      <rect x="117" y="157" width="6" height="22" fill="#3b2a1a"/>
      <circle cx="120" cy="183" r="5.5" fill="url(#gold)"/>
    </g>
    <path d="M82 84 H158 V120 Q158 164 120 184 Q82 164 82 120 Z" fill="#1d4a8c" stroke="url(#gold)" stroke-width="3.4"/>
    <path d="M90 92 H150 V121 Q150 158 120 175 Q90 158 90 121 Z" fill="none" stroke="#f5c86b" stroke-opacity="0.4" stroke-width="1"/>
    <path d="M114 92 H126 V122 H150 V134 H126 V172 L120 175 L114 172 V134 H90 V122 H114 Z" fill="url(#gold)"/>
    <circle cx="120" cy="128" r="9" fill="#1d4a8c" stroke="url(#gold)" stroke-width="2.4"/>
    ${star(120, 128, 5)}`,

    assassin: `
    <path d="M66 184 Q58 96 120 58 Q182 96 174 184 Q150 164 120 164 Q90 164 66 184 Z" fill="#2a111b" stroke="url(#gold)" stroke-width="2.6"/>
    <path d="M78 176 Q74 104 120 72" fill="none" stroke="#f5c86b" stroke-opacity="0.3" stroke-width="1.2"/>
    <ellipse cx="120" cy="124" rx="33" ry="36" fill="#07040a"/>
    <path d="M100 118 L114 124 L100 127 Z" fill="#ff5d4d"/>
    <path d="M140 118 L126 124 L140 127 Z" fill="#ff5d4d"/>
    <ellipse cx="107" cy="123" rx="10" ry="5" fill="#ff5d4d" opacity="0.25"/>
    <ellipse cx="133" cy="123" rx="10" ry="5" fill="#ff5d4d" opacity="0.25"/>
    <path d="M92 146 Q120 138 148 146 L146 156 Q120 150 94 156 Z" fill="#43182a"/>
    <g transform="rotate(38 150 150)">
      <path d="M144 96 L150 76 L156 96 V150 H144 Z" fill="url(#steel)" stroke="#4b5566" stroke-width="0.8"/>
      <path d="M150 80 V148" stroke="#ffffff" stroke-opacity="0.5" stroke-width="0.8"/>
      <path d="M130 150 Q150 142 170 150 L168 156 Q150 150 132 156 Z" fill="url(#gold)"/>
      <rect x="146" y="156" width="8" height="22" rx="2" fill="#241018"/>
      <circle cx="150" cy="182" r="5" fill="url(#gold)"/>
    </g>
    <path d="M96 196 q3 6 0 9 q-3 -3 0 -9 Z" fill="#c9303c"/>`,

    morgana: `
    <defs>
      <mask id="crescent"><rect x="30" y="20" width="180" height="200" fill="#fff"/><circle cx="142" cy="92" r="44" fill="#000"/></mask>
      <radialGradient id="glass" cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stop-color="#d9e7ff"/>
        <stop offset="0.5" stop-color="#6f8fcb"/>
        <stop offset="1" stop-color="#2a1d40"/>
      </radialGradient>
    </defs>
    <circle cx="118" cy="104" r="54" fill="url(#gold)" mask="url(#crescent)"/>
    <circle cx="118" cy="104" r="54" fill="none" stroke="#fff0c2" stroke-opacity="0.4" stroke-width="1" mask="url(#crescent)"/>
    <g transform="rotate(-18 138 138)">
      <ellipse cx="138" cy="126" rx="24" ry="30" fill="url(#glass)" stroke="url(#gold)" stroke-width="4.5"/>
      <path d="M124 126 Q138 114 152 126 Q138 138 124 126 Z" fill="#0e1a30" stroke="#fff4d0" stroke-width="1"/>
      <circle cx="138" cy="126" r="5" fill="url(#gold)"/>
      <path d="M134 156 H142 L144 190 Q138 196 132 190 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="0.8"/>
      <circle cx="138" cy="160" r="4" fill="#a3283a"/>
    </g>
    <path d="M74 150 C82 160 96 162 104 156 C96 170 80 172 70 164 Z" fill="#150b14" stroke="#f5c86b" stroke-opacity="0.6" stroke-width="1"/>
    <path d="M70 164 C76 176 92 180 102 172" fill="none" stroke="#f5c86b" stroke-opacity="0.5" stroke-width="1"/>
    ${star(64, 72, 6)}${star(180, 150, 5, 0.8)}${star(170, 52, 4, 0.7)}`,

    mordred: `
    <circle cx="120" cy="120" r="64" fill="#0b0508" opacity="0.55"/>
    <path d="M74 98 L84 56 L102 84 L120 46 L138 84 L156 56 L166 98 Z" fill="#2a0f16" stroke="url(#gold)" stroke-width="3" stroke-linejoin="round"/>
    <rect x="72" y="96" width="96" height="16" rx="3" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1"/>
    <circle cx="120" cy="104" r="5" fill="#c21f36" stroke="#ffd6db" stroke-width="0.8"/>
    <circle cx="96" cy="104" r="3.5" fill="#c21f36"/><circle cx="144" cy="104" r="3.5" fill="#c21f36"/>
    <circle cx="84" cy="56" r="4" fill="url(#gold)"/><circle cx="120" cy="46" r="4.5" fill="url(#gold)"/><circle cx="156" cy="56" r="4" fill="url(#gold)"/>
    <path d="M110 158 L109 130 L115 122 L119 132 L125 121 L131 131 L130 158 Z" fill="url(#steel)" stroke="#4b5566" stroke-width="0.9"/>
    <path d="M120 128 V156" stroke="#ffffff" stroke-opacity="0.55" stroke-width="0.8"/>
    <path d="M88 158 Q120 150 152 158 L148 166 Q120 160 92 166 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="0.8"/>
    <circle cx="120" cy="161" r="3.2" fill="#c21f36"/>
    <rect x="115.5" y="166" width="9" height="20" rx="2" fill="#241018"/>
    <circle cx="120" cy="191" r="6" fill="url(#gold)"/>
    <path d="M140 124 L150 114 L152 124 Z" fill="url(#steel)"/>
    <path d="M92 128 L100 120 L103 130 Z" fill="url(#steel)"/>
    <path d="M154 140 L163 136 L160 145 Z" fill="url(#steel)" opacity="0.8"/>
    <path d="M80 140 L86 134 L88 142 Z" fill="url(#steel)" opacity="0.7"/>`,

    oberon: `
    <g fill="none" stroke="#6d2432" stroke-width="5" stroke-linecap="round">
      <circle cx="120" cy="118" r="60"/>
    </g>
    <circle cx="120" cy="118" r="60" fill="none" stroke="url(#gold)" stroke-width="1.2" stroke-dasharray="3 7"/>
    ${Array.from({ length: 14 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 14 + 0.1;
        const bx = 120 + Math.cos(a) * 60;
        const by = 118 + Math.sin(a) * 60;
        const tx = 120 + Math.cos(a + 0.12) * 74;
        const ty = 118 + Math.sin(a + 0.12) * 74;
        const cx = 120 + Math.cos(a + 0.2) * 60;
        const cy = 118 + Math.sin(a + 0.2) * 60;
        return `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${cx.toFixed(1)} ${cy.toFixed(1)} Z" fill="#8a2c3c" stroke="#f5c86b" stroke-opacity="0.5" stroke-width="0.6"/>`;
    }).join('')}
    <defs>
      <radialGradient id="maskShade" cx="0.5" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#e9e2d3"/>
        <stop offset="0.7" stop-color="#9c93a3"/>
        <stop offset="1" stop-color="#4a3f52"/>
      </radialGradient>
    </defs>
    <path d="M90 88 Q90 64 120 62 Q150 64 150 88 V124 Q150 162 120 174 Q90 162 90 124 Z" fill="url(#maskShade)" stroke="url(#gold)" stroke-width="2.6"/>
    <path d="M98 106 Q108 98 116 108 Q106 114 98 106 Z" fill="#12080e"/>
    <path d="M142 106 Q132 98 124 108 Q134 114 142 106 Z" fill="#12080e"/>
    <path d="M108 116 Q106 132 110 146" fill="none" stroke="#6d2432" stroke-width="2" stroke-linecap="round"/>
    <path d="M120 64 L116 80 L123 92 L118 104" fill="none" stroke="#3a2a3e" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M112 150 Q120 154 128 150" fill="none" stroke="#4a3f52" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M90 124 Q70 132 62 150 M150 124 Q170 132 178 150" fill="none" stroke="#f5c86b" stroke-opacity="0.35" stroke-width="1"/>`,

    minion: `
    <path d="M120 40 L124 60 H116 Z" fill="url(#steel)"/>
    <rect x="118" y="58" width="4" height="140" fill="#3a2418"/>
    <path d="M94 106 C70 88 50 92 40 110 C54 104 62 108 66 118 C72 110 82 110 88 122 Z" fill="#23101a" stroke="url(#gold)" stroke-width="1.6"/>
    <path d="M146 106 C170 88 190 92 200 110 C186 104 178 108 174 118 C168 110 158 110 152 122 Z" fill="#23101a" stroke="url(#gold)" stroke-width="1.6"/>
    <path d="M92 96 Q92 74 120 70 Q148 74 148 96 V140 Q120 158 92 140 Z" fill="#3a1624" stroke="url(#gold)" stroke-width="2.6"/>
    <path d="M100 78 L94 60 L108 74 Z M140 78 L146 60 L132 74 Z" fill="url(#gold)"/>
    <path d="M98 110 Q120 102 142 110 L140 122 Q120 116 100 122 Z" fill="#0a0509"/>
    <circle cx="110" cy="114" r="3.2" fill="#ff5d4d"/><circle cx="130" cy="114" r="3.2" fill="#ff5d4d"/>
    <circle cx="110" cy="114" r="7" fill="#ff5d4d" opacity="0.2"/><circle cx="130" cy="114" r="7" fill="#ff5d4d" opacity="0.2"/>
    <path d="M108 134 H132" stroke="#f5c86b" stroke-opacity="0.5" stroke-width="1.4"/>
    <path d="M96 142 Q120 160 144 142 L140 152 Q120 168 100 152 Z" fill="url(#gold)" opacity="0.9"/>`
};

function chalice({ cracked }) {
    const body = `
    <g stroke="#f5c86b" stroke-opacity="${cracked ? 0.25 : 0.5}" stroke-width="1.3">
      ${Array.from({ length: 18 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 18;
        return `<line x1="${(120 + Math.cos(a) * 46).toFixed(1)}" y1="${(104 + Math.sin(a) * 46).toFixed(1)}" x2="${(120 + Math.cos(a) * (i % 2 ? 60 : 72)).toFixed(1)}" y2="${(104 + Math.sin(a) * (i % 2 ? 60 : 72)).toFixed(1)}"/>`;
    }).join('')}
    </g>
    <ellipse cx="120" cy="80" rx="36" ry="8" fill="${cracked ? '#3a0d14' : '#fff0c2'}" stroke="url(#gold)" stroke-width="2"/>
    <path d="M84 80 Q84 128 120 136 Q156 128 156 80 Q120 92 84 80 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1.2"/>
    <path d="M94 92 Q98 118 116 126" fill="none" stroke="#fff6dc" stroke-opacity="0.6" stroke-width="3" stroke-linecap="round"/>
    <circle cx="120" cy="108" r="6" fill="${cracked ? '#6b1a26' : '#2a5fa8'}" stroke="#fff0c2" stroke-width="1.2"/>
    <rect x="114" y="136" width="12" height="26" fill="url(#goldSide)"/>
    <ellipse cx="120" cy="148" rx="10" ry="4" fill="url(#gold)"/>
    <path d="M96 176 Q120 160 144 176 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1"/>
    <rect x="92" y="176" width="56" height="8" rx="3" fill="url(#goldSide)"/>`;
    if (!cracked) {
        return `${body}${star(70, 66, 7)}${star(172, 72, 6)}${star(160, 164, 4, 0.7)}${star(78, 160, 5, 0.8)}`;
    }
    return `${body}
    <path d="M122 82 L114 96 L126 106 L116 120 L124 134" fill="none" stroke="#1a0a0e" stroke-width="3" stroke-linejoin="round"/>
    <path d="M122 82 L114 96 L126 106 L116 120 L124 134" fill="none" stroke="#ff8a7a" stroke-width="1" stroke-linejoin="round"/>
    <path d="M150 84 q10 8 8 22 q-8 -6 -8 -22 Z" fill="#c21f36"/>
    <path d="M158 116 q4 6 0 10 q-4 -4 0 -10 Z" fill="#c21f36"/>
    <path d="M164 140 q3 5 0 8 q-3 -3 0 -8 Z" fill="#c21f36" opacity="0.8"/>
    <path d="M72 186 Q100 180 118 188 Q140 196 168 186" fill="none" stroke="#c21f36" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
}

/* ------------------------------------------------------------------ round tokens 120×120 */

function token({ inner, ring = 'url(#gold)', content, label }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${label}">
  <defs>${goldDefs()}
    <radialGradient id="disc" cx="0.4" cy="0.35" r="0.75">
      <stop offset="0" stop-color="${inner[0]}"/>
      <stop offset="1" stop-color="${inner[1]}"/>
    </radialGradient>
    <radialGradient id="shine" cx="0.35" cy="0.25" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="60" cy="60" r="58" fill="#1a2332"/>
  <circle cx="60" cy="60" r="55" fill="none" stroke="${ring}" stroke-width="4"/>
  <circle cx="60" cy="60" r="49" fill="url(#disc)"/>
  <circle cx="60" cy="60" r="49" fill="none" stroke="#f5c86b" stroke-opacity="0.5" stroke-width="1" stroke-dasharray="2 4"/>
  ${content}
  <circle cx="60" cy="60" r="49" fill="url(#shine)"/>
</svg>
`;
}

function laurel(side) {
    let out = '';
    for (let i = 0; i < 7; i += 1) {
        const deg = 118 + i * 19;
        const rad = (deg * Math.PI) / 180;
        let x = 60 + Math.cos(rad) * 38;
        const y = 60 + Math.sin(rad) * 38;
        let rot = deg;
        if (side === 'right') { x = 120 - x; rot = 180 - deg; }
        out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.4" ry="7.5" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#gold)"/>`;
    }
    return out;
}

/* ------------------------------------------------------------------ files */

const files = {};

const ROLES = [
    ['merlin', 'good', 'เมอร์ลิน', 'MERLIN', 'ผู้หยั่งรู้ · ฝ่ายดี', 11],
    ['percival', 'good', 'เพอร์ซิวัล', 'PERCIVAL', 'อัศวินผู้พิทักษ์ · ฝ่ายดี', 23],
    ['loyal', 'good', 'อัศวินผู้ภักดี', 'LOYAL KNIGHT', 'ฝ่ายดี', 31],
    ['assassin', 'evil', 'มือสังหาร', 'ASSASSIN', 'ฝ่ายร้าย', 43],
    ['morgana', 'evil', 'มอร์กานา', 'MORGANA', 'แม่มดเงา · ฝ่ายร้าย', 57],
    ['mordred', 'evil', 'มอร์เดรด', 'MORDRED', 'ราชันเงา · ฝ่ายร้าย', 61],
    ['oberon', 'evil', 'โอเบรอน', 'OBERON', 'ผู้หลงเงา · ฝ่ายร้าย', 73],
    ['minion', 'evil', 'สมุนมอร์เดรด', 'MINION', 'ฝ่ายร้าย', 89]
];
ROLES.forEach(([id, team, thai, latin, footer, seed]) => {
    files[`${id}.svg`] = portraitCard({ team, emblem: EMBLEMS[id], thai, latin, footer, seed });
});

files['quest-success.svg'] = portraitCard({ team: 'good', emblem: chalice({ cracked: false }), thai: 'สำเร็จ', latin: 'SUCCESS', footer: 'การ์ดภารกิจ', seed: 101 });
files['quest-fail.svg'] = portraitCard({ team: 'evil', emblem: chalice({ cracked: true }), thai: 'ล้มเหลว', latin: 'FAIL', footer: 'การ์ดภารกิจ · ฝ่ายร้ายเท่านั้น', seed: 103 });

files['back.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336" width="240" height="336" role="img" aria-label="หลังการ์ดอวาลอน">
  <defs>${goldDefs()}
    <radialGradient id="bg" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0" stop-color="#2a3d60"/>
      <stop offset="0.6" stop-color="#1a2332"/>
      <stop offset="1" stop-color="#0e1522"/>
    </radialGradient>
    <pattern id="lattice" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="20" height="20" fill="none" stroke="#f5c86b" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="240" height="336" rx="16" fill="url(#bg)"/>
  <rect width="240" height="336" rx="16" fill="url(#lattice)"/>
  <rect x="7" y="7" width="226" height="322" rx="11" fill="none" stroke="url(#gold)" stroke-width="1.8"/>
  <rect x="13" y="13" width="214" height="310" rx="8" fill="none" stroke="#f5c86b" stroke-opacity="0.35" stroke-width="0.8"/>
  ${corner(13, 13, 1, 1)}${corner(227, 13, -1, 1)}${corner(13, 323, 1, -1)}${corner(227, 323, -1, -1)}
  ${dust(5, 30, [20, 20, 220, 316])}
  <circle cx="120" cy="168" r="82" fill="none" stroke="#f5c86b" stroke-opacity="0.3" stroke-width="1"/>
  <circle cx="120" cy="168" r="72" fill="#16233a" stroke="url(#gold)" stroke-width="3"/>
  <circle cx="120" cy="168" r="56" fill="none" stroke="#f5c86b" stroke-opacity="0.45" stroke-width="1"/>
  ${Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
        const x = 120 + Math.cos(a) * 64;
        const y = 168 + Math.sin(a) * 64;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#1a2332" stroke="url(#gold)" stroke-width="1.6"/>`;
    }).join('')}
  ${Array.from({ length: 10 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2 + Math.PI / 10;
        return `<line x1="${(120 + Math.cos(a) * 14).toFixed(1)}" y1="${(168 + Math.sin(a) * 14).toFixed(1)}" x2="${(120 + Math.cos(a) * 54).toFixed(1)}" y2="${(168 + Math.sin(a) * 54).toFixed(1)}" stroke="#f5c86b" stroke-opacity="0.3" stroke-width="1"/>`;
    }).join('')}
  <path d="M114 98 L120 80 L126 98 V196 H114 Z" fill="url(#steel)" stroke="#4b5566" stroke-width="0.8"/>
  <path d="M120 84 V194" stroke="#ffffff" stroke-opacity="0.6" stroke-width="0.8"/>
  <path d="M92 196 Q120 186 148 196 L146 204 Q120 196 94 204 Z" fill="url(#gold)"/>
  <rect x="115" y="204" width="10" height="28" rx="3" fill="#3b2a1a"/>
  <circle cx="120" cy="238" r="7" fill="url(#gold)"/>
  <circle cx="120" cy="199" r="3" fill="#2a5fa8"/>
  <path d="M120 30 l8 10 l-8 10 l-8 -10 Z" fill="url(#gold)"/>
  <text x="120" y="296" text-anchor="middle" font-family="${SERIF}" font-size="14" fill="#f5c86b" letter-spacing="7">AVALON</text>
  <path d="M70 306 H170" stroke="#f5c86b" stroke-opacity="0.4" stroke-width="0.8"/>
</svg>
`;

files['vote-approve.svg'] = token({
    label: 'เห็นด้วย',
    inner: ['#3d74c4', '#15305c'],
    content: `${laurel('left')}${laurel('right')}
    <path d="M44 61 L55 72 L77 47" fill="none" stroke="#0d1a33" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" transform="translate(0 2)"/>
    <path d="M44 61 L55 72 L77 47" fill="none" stroke="url(#gold)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`
});
files['vote-reject.svg'] = token({
    label: 'คัดค้าน',
    inner: ['#b3303f', '#4d0f1a'],
    content: `
    <g stroke-linecap="round">
      <path d="M40 40 L80 80 M80 40 L40 80" stroke="#1a2332" stroke-width="13" opacity="0.5" transform="translate(0 2)"/>
      <path d="M40 40 L80 80 M80 40 L40 80" stroke="url(#gold)" stroke-width="10"/>
    </g>
    <circle cx="60" cy="60" r="6" fill="#4d0f1a" stroke="url(#gold)" stroke-width="2"/>`
});
files['token-success.svg'] = token({
    label: 'ภารกิจสำเร็จ',
    inner: ['#3d74c4', '#15305c'],
    content: `
    <ellipse cx="60" cy="40" rx="20" ry="4.5" fill="#fff0c2"/>
    <path d="M40 40 Q40 66 60 70 Q80 66 80 40 Q60 47 40 40 Z" fill="url(#gold)"/>
    <rect x="56" y="70" width="8" height="14" fill="url(#goldSide)"/>
    <path d="M46 92 Q60 82 74 92 Z" fill="url(#gold)"/>
    <rect x="44" y="91" width="32" height="5" rx="2" fill="url(#goldSide)"/>`
});
files['token-fail.svg'] = token({
    label: 'ภารกิจล้มเหลว',
    inner: ['#b3303f', '#4d0f1a'],
    content: `
    <g transform="rotate(35 60 60)">
      <path d="M56 38 L60 22 L64 38 V74 H56 Z" fill="url(#steel)"/>
      <path d="M44 74 Q60 68 76 74 L74 80 Q60 75 46 80 Z" fill="url(#gold)"/>
      <rect x="57" y="80" width="6" height="14" rx="2" fill="#241018"/>
      <circle cx="60" cy="97" r="4" fill="url(#gold)"/>
    </g>`
});
files['crown.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="มงกุฎหัวหน้า">
  <defs>${goldDefs()}</defs>
  <path d="M18 88 L12 38 L38 60 L60 22 L82 60 L108 38 L102 88 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M26 80 L22 52 L40 68 L60 36 L80 68 L98 52 L94 80" fill="none" stroke="#fff6dc" stroke-opacity="0.5" stroke-width="1.5" stroke-linejoin="round"/>
  <rect x="16" y="86" width="88" height="16" rx="4" fill="url(#goldSide)" stroke="#8a5d1f" stroke-width="2"/>
  <circle cx="60" cy="94" r="5" fill="#2a5fa8" stroke="#fff0c2" stroke-width="1.2"/>
  <circle cx="36" cy="94" r="3.5" fill="#c21f36"/><circle cx="84" cy="94" r="3.5" fill="#c21f36"/>
  <circle cx="12" cy="38" r="5" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1.5"/>
  <circle cx="60" cy="22" r="6" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1.5"/>
  <circle cx="108" cy="38" r="5" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1.5"/>
</svg>
`;

files['cover.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 853" width="1280" height="853" role="img" aria-label="อวาลอน · อัศวินโต๊ะกลม">
  <defs>${goldDefs()}
    <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1322"/>
      <stop offset="0.55" stop-color="#1c2e4f"/>
      <stop offset="0.8" stop-color="#3a3350"/>
      <stop offset="1" stop-color="#1a1424"/>
    </linearGradient>
    <radialGradient id="moonGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff2c8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#fff2c8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="moon" cx="0.4" cy="0.4" r="0.7">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="1" stop-color="#f1d9a0"/>
    </radialGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2d3f63"/>
      <stop offset="1" stop-color="#0b1220"/>
    </linearGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a9b8d8" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#a9b8d8" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#a9b8d8" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="853" fill="url(#night)"/>
  ${dust(3, 180, [0, 0, 1280, 470])}
  ${star(220, 120, 9)}${star(1080, 90, 8)}${star(960, 230, 6, 0.8)}${star(360, 250, 5, 0.7)}${star(1180, 300, 5, 0.7)}
  <circle cx="930" cy="250" r="170" fill="url(#moonGlow)"/>
  <circle cx="930" cy="250" r="78" fill="url(#moon)"/>
  <circle cx="905" cy="232" r="12" fill="#e8cf95" opacity="0.5"/><circle cx="955" cy="275" r="8" fill="#e8cf95" opacity="0.45"/>
  <!-- far hills -->
  <path d="M0 540 Q180 470 360 520 T720 500 T1060 520 T1280 490 V620 H0 Z" fill="#1b2440"/>
  <!-- castle on the isle -->
  <g fill="#0d1322">
    <path d="M760 520 V420 L776 400 L792 420 V520 Z"/>
    <path d="M800 520 V380 L822 350 L844 380 V520 Z"/>
    <path d="M850 520 V430 H856 V420 H864 V430 H872 V420 H880 V430 H888 V420 H896 V430 H900 V520 Z"/>
    <path d="M896 520 V330 L924 290 L952 330 V520 Z"/>
    <path d="M956 520 V410 H962 V400 H970 V410 H978 V400 H986 V410 H994 V400 H1000 V520 Z"/>
    <path d="M700 530 H1120 V540 H700 Z"/>
    <path d="M1000 520 V372 L1020 346 L1040 372 V520 Z"/>
    <path d="M1044 520 V436 L1058 420 L1072 436 V520 Z"/>
    <path d="M740 540 Q900 500 1100 540 Z"/>
  </g>
  <g fill="#f5c86b" opacity="0.85">
    <rect x="918" y="360" width="10" height="16" rx="5"/><rect x="818" y="410" width="8" height="12" rx="4"/>
    <rect x="1016" y="400" width="8" height="12" rx="4"/><rect x="866" y="460" width="8" height="12" rx="4"/>
  </g>
  <path d="M924 290 V262 L944 270 L924 278" fill="#c21f36"/>
  <rect x="0" y="540" width="1280" height="313" fill="url(#lake)"/>
  <g stroke="#f7e3ad" stroke-linecap="round" opacity="0.55">
    <path d="M880 560 H980" stroke-width="3"/><path d="M896 580 H966" stroke-width="2.4"/><path d="M906 602 H956" stroke-width="2"/>
    <path d="M914 626 H946" stroke-width="1.6"/><path d="M922 650 H940" stroke-width="1.2"/>
  </g>
  <rect x="0" y="500" width="1280" height="90" fill="url(#mist)"/>
  <!-- foreground: sword in the stone -->
  <path d="M0 853 V690 Q200 640 380 686 Q560 730 680 853 Z" fill="#0a0f1a"/>
  <path d="M680 853 Q900 760 1280 790 V853 Z" fill="#0a0f1a"/>
  <g transform="translate(300 0)">
    <g transform="translate(0 420)">
      <circle cx="0" cy="0" r="12" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1.5"/>
      <rect x="-8" y="10" width="16" height="50" rx="4" fill="#3b2a1a"/>
      <path d="M-6 18 H6 M-6 30 H6 M-6 42 H6" stroke="#6b4a2a" stroke-width="2"/>
      <path d="M-62 60 Q0 44 62 60 L56 74 Q0 60 -56 74 Z" fill="url(#gold)" stroke="#8a5d1f" stroke-width="1.5"/>
      <circle cx="0" cy="64" r="6" fill="#2a5fa8" stroke="#fff0c2" stroke-width="1.5"/>
      <path d="M-11 72 H11 V250 H-11 Z" fill="url(#steel)" stroke="#4b5566" stroke-width="1.5"/>
      <path d="M0 76 V250" stroke="#ffffff" stroke-opacity="0.6" stroke-width="1.5"/>
      <path d="M-5 80 H5 V200 H-5 Z" fill="#6c7890" opacity="0.35"/>
    </g>
    <path d="M-120 700 Q-96 640 -30 636 Q40 628 90 660 Q140 690 130 740 Q20 770 -110 750 Z" fill="#1f2839" stroke="#34405c" stroke-width="3"/>
    <path d="M-80 690 Q-40 666 10 668 M30 668 Q70 674 96 694" fill="none" stroke="#3e4a66" stroke-width="3" stroke-linecap="round"/>
    <circle cx="0" cy="560" r="120" fill="url(#moonGlow)" opacity="0.35"/>
  </g>
  <!-- title -->
  <g transform="translate(96 250)">
    <text x="0" y="0" font-family="${FONT}" font-weight="700" font-size="132" fill="url(#gold)" letter-spacing="2">อวาลอน</text>
    <text x="4" y="74" font-family="${FONT}" font-weight="600" font-size="46" fill="#e8eefc" letter-spacing="3">อัศวินโต๊ะกลม</text>
    <path d="M6 104 H356" stroke="#f5c86b" stroke-opacity="0.6" stroke-width="2"/>
    <path d="M362 104 l8 -8 l8 8 l-8 8 Z" fill="url(#gold)"/>
    <text x="4" y="146" font-family="${FONT}" font-weight="500" font-size="28" fill="#b9c6e4">ภารกิจ · โหวต · หักหลัง · 5–10 คน</text>
  </g>
  <rect width="1280" height="853" fill="url(#vignette)"/>
</svg>
`;

Object.entries(files).forEach(([name, svg]) => {
    fs.writeFileSync(path.join(OUT, name), svg.replace(/\n\s*\n/g, '\n'));
});
console.log(`wrote ${Object.keys(files).length} files to ${path.relative(process.cwd(), OUT)}`);
