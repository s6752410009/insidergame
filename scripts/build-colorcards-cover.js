/**
 * วาดปกไพ่ทิ้งสี (ศิลป์ของเราเอง ไม่อิงไพ่ยี่ห้อไหน) → public/assets/games/colorcards/cover.jpg
 * รัน: node scripts/build-colorcards-cover.js
 */
const fs = require('fs');
const C = { r: '#d9473a', y: '#f2c230', g: '#2f9e5b', b: '#3b7be0', w: '#1f2a3d' };
const INK = { r: '#fff', y: '#1a2332', g: '#fff', b: '#fff', w: '#f5c86b' };
const SHAPE = {
  r: s => `<path d="M0 ${-s} L${s * 1.1} ${s * 0.9} H${-s * 1.1}Z"/>`,
  y: s => `<circle r="${s}"/>`,
  g: s => `<rect x="${-s}" y="${-s}" width="${2 * s}" height="${2 * s}" rx="${s * 0.25}"/>`,
  b: s => `<path d="M0 ${-s * 1.2} L${s * 1.2} 0 L0 ${s * 1.2} L${-s * 1.2} 0Z"/>`
};
const W = 190, H = 270;
function pinwheel(scale) {
  return `<g transform="scale(${scale}) rotate(45)">
    <rect x="-30" y="-30" width="28" height="28" rx="7" fill="${C.r}"/>
    <rect x="2" y="-30" width="28" height="28" rx="7" fill="${C.y}"/>
    <rect x="2" y="2" width="28" height="28" rx="7" fill="${C.g}"/>
    <rect x="-30" y="2" width="28" height="28" rx="7" fill="${C.b}"/></g>`;
}
function glyph(kind, color, value) {
  const ink = INK[color];
  if (kind === 'num') return `<text x="0" y="34" text-anchor="middle" font-family="Chakra Petch, Arial Black, sans-serif" font-weight="700" font-size="104" fill="${ink}">${value}</text>`;
  if (kind === 'skip') return `<g fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-60 -60) scale(2.5)"><path d="M6 32 C9 12 36 10 41 28"/><path d="M33 25 L41 30 L45 21"/><circle cx="24" cy="37" r="5" fill="${ink}" stroke="none"/></g>`;
  if (kind === 'rev') return `<g fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-60 -60) scale(2.5)"><path d="M9 17 H37"/><path d="M30 10 L38 17 L30 24"/><path d="M39 31 H11"/><path d="M18 24 L10 31 L18 38"/></g>`;
  if (kind === 'd2') return `<text x="0" y="28" text-anchor="middle" font-family="Chakra Petch, Arial Black, sans-serif" font-weight="700" font-size="84" fill="${ink}">+2</text>`;
  if (kind === 'wild') return pinwheel(1.7);
  return `<text x="0" y="-26" text-anchor="middle" font-family="Chakra Petch, Arial Black, sans-serif" font-weight="700" font-size="58" fill="#f5c86b">+4</text><g transform="translate(0 40)">${pinwheel(1.05)}</g>`;
}
function card(color, kind, value, tx, ty, rot, id) {
  const fill = C[color];
  const ink = INK[color];
  const idx = kind === 'num' ? value : (kind === 'd2' ? '+2' : (kind === 'd4' ? '+4' : ''));
  const shape = SHAPE[color] ? `<g fill="${ink}" opacity="0.85">${SHAPE[color](6)}</g>` : '';
  const stroke = color === 'w' ? '#f5c86b' : 'rgba(255,255,255,0.45)';
  return `<g transform="translate(${tx} ${ty}) rotate(${rot})" filter="url(#sh)">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="22" fill="${fill}"/>
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="22" fill="url(#${color === 'w' ? 'hatchW' : 'hatch'})"/>
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="22" fill="url(#sheen)"/>
    <rect x="${-W / 2 + 3}" y="${-H / 2 + 3}" width="${W - 6}" height="${H - 6}" rx="19" fill="none" stroke="${stroke}" stroke-width="3"/>
    <g transform="translate(${-W / 2 + 24} ${-H / 2 + 34})"><text x="0" y="0" text-anchor="middle" font-family="Chakra Petch, Arial Black, sans-serif" font-weight="700" font-size="30" fill="${ink}">${idx}</text><g transform="translate(0 20)">${shape}</g></g>
    <g transform="rotate(180) translate(${-W / 2 + 24} ${-H / 2 + 34})"><text x="0" y="0" text-anchor="middle" font-family="Chakra Petch, Arial Black, sans-serif" font-weight="700" font-size="30" fill="${ink}">${idx}</text><g transform="translate(0 20)">${shape}</g></g>
    ${glyph(kind, color, value)}
  </g>`;
}
function back(tx, ty, rot) {
  return `<g transform="translate(${tx} ${ty}) rotate(${rot})" filter="url(#sh)">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="22" fill="#1f2a3d"/>
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="22" fill="url(#lattice)"/>
    <rect x="${-W / 2 + 4}" y="${-H / 2 + 4}" width="${W - 8}" height="${H - 8}" rx="18" fill="none" stroke="#f5c86b" stroke-opacity="0.7" stroke-width="3"/>
    <rect x="${-W / 2 + 14}" y="${-H / 2 + 14}" width="${W - 28}" height="${H - 28}" rx="12" fill="none" stroke="#f5c86b" stroke-opacity="0.35" stroke-width="2"/>
    <circle r="34" fill="#1f2a3d" stroke="#f5c86b" stroke-width="3"/>
    <g transform="scale(0.55)">${pinwheel(1)}</g>
  </g>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="853" viewBox="0 0 1280 853">
<defs>
  <radialGradient id="bg" cx="58%" cy="46%" r="75%"><stop offset="0" stop-color="#2a3a57"/><stop offset="0.55" stop-color="#1a2332"/><stop offset="1" stop-color="#0f1520"/></radialGradient>
  <radialGradient id="spot" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3b7be0" stop-opacity="0.35"/><stop offset="1" stop-color="#3b7be0" stop-opacity="0"/></radialGradient>
  <pattern id="hatch" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="6" height="16" fill="#fff" fill-opacity="0.09"/></pattern>
  <pattern id="hatchW" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="12" fill="#f5c86b" fill-opacity="0.1"/></pattern>
  <pattern id="lattice" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0 H14 M0 0 V14" stroke="#f5c86b" stroke-opacity="0.16" stroke-width="2"/></pattern>
  <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#000" stop-opacity="0.14"/></linearGradient>
  <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity="0.5"/></filter>
</defs>
<rect width="1280" height="853" fill="url(#bg)"/>
<ellipse cx="760" cy="420" rx="460" ry="340" fill="url(#spot)"/>
<g fill="none" stroke="#f5c86b" stroke-linecap="round">
  <circle cx="760" cy="420" r="330" stroke-opacity="0.22" stroke-width="3" stroke-dasharray="4 18"/>
  <circle cx="760" cy="420" r="390" stroke-opacity="0.1" stroke-width="2"/>
  <path d="M760 90 l26 14 -26 14" stroke-opacity="0.55" stroke-width="6" stroke-linejoin="round"/>
  <path d="M1090 420 l-14 26 -14 -26" stroke-opacity="0.55" stroke-width="6" stroke-linejoin="round"/>
  <path d="M760 750 l-26 -14 26 -14" stroke-opacity="0.55" stroke-width="6" stroke-linejoin="round"/>
  <path d="M430 420 l14 -26 14 26" stroke-opacity="0.55" stroke-width="6" stroke-linejoin="round"/>
</g>
${back(250, 300, -16)}${back(268, 288, -11)}${back(286, 276, -6)}
${card('b', 'num', 7, 720, 420, -10)}
${card('r', 'num', 3, 760, 410, 6)}
${card('y', 'rev', 0, 1060, 640, 18)}
<g>
${card('g', 'skip', 0, 470, 690, -26)}
${card('r', 'd2', 0, 600, 668, -12)}
${card('w', 'wild', 0, 735, 662, 2)}
${card('b', 'num', 9, 870, 672, 16)}
${card('w', 'd4', 0, 1000, 700, 30)}
</g>
<g transform="translate(1080 170)"><circle r="62" fill="#1a2332" stroke="#f5c86b" stroke-width="4"/><g transform="scale(0.95)">${pinwheel(1)}</g></g>
</svg>`;
(async () => {
    const path = require('path');
    const out = path.join(__dirname, '..', 'public', 'assets', 'games', 'colorcards');
    fs.mkdirSync(out, { recursive: true });
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 853 } });
    await page.setContent('<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&display=swap" rel="stylesheet"><style>html,body{margin:0;background:#1a2332}</style></head><body>' + svg + '</body></html>');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, 'cover.jpg'), type: 'jpeg', quality: 86 });
    await browser.close();
    console.log('wrote cover.jpg');
})().catch(e => { console.error(e); process.exit(1); });
