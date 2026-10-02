/**
 * สร้างภาพคลื่นความคิด: emblem.svg (หน้าปัดเล็ก) + cover.svg (1280×853)
 * แล้วเรนเดอร์ cover.jpg ด้วย Playwright (ฟอนต์ Chakra Petch / Bai Jamjuree จาก Google Fonts)
 * รัน: node scripts/generate-wavelength-art.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'games', 'wavelength');
fs.mkdirSync(OUT, { recursive: true });

const C = { navy: '#1a2332', navyDeep: '#0f1724', gold: '#f5c86b', teal: '#5eead4', coral: '#f08a5d', band2: '#f2c66d', band3: '#f08a5d', band4: '#5eead4' };

function polar(cx, cy, r, v) {
    const a = (180 - v * 1.8) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}
function wedge(cx, cy, r, from, to) {
    const [x1, y1] = polar(cx, cy, r, from);
    const [x2, y2] = polar(cx, cy, r, to);
    return `M${cx} ${cy} L${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}
function dial({ cx, cy, r, target, needle, ring = 10, ticks = true, labels = true, id = 'd' }) {
    const half = r;
    let s = '';
    s += `<path d="M${cx - half} ${cy} A${half} ${half} 0 0 1 ${cx + half} ${cy} Z" fill="url(#${id}Face)"/>`;
    s += `<g clip-path="url(#${id}Clip)">`;
    [[18, C.band2], [11, C.band3], [4, C.band4]].forEach(([w, col]) => {
        s += `<path d="${wedge(cx, cy, r * 1.05, target - w, target + w)}" fill="${col}"/>`;
    });
    [18, 11, 4].forEach(w => [-w, w].forEach(u => {
        const [x, y] = polar(cx, cy, r * 1.05, target + u);
        s += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.navyDeep}" stroke-opacity="0.5" stroke-width="${r / 110}"/>`;
    }));
    if (labels) {
        [[0, 4], [-7.5, 3], [7.5, 3], [-14.5, 2], [14.5, 2]].forEach(([u, p]) => {
            const [x, y] = polar(cx, cy, r * 0.8, target + u);
            s += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'Chakra Petch',sans-serif" font-weight="700" font-size="${(p === 4 ? 0.105 : 0.085) * r}" fill="${C.navyDeep}" transform="rotate(${(u * 1.8).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${p}</text>`;
        });
    }
    s += `</g>`;
    s += `<path d="M${cx - half} ${cy} A${half} ${half} 0 0 1 ${cx + half} ${cy}" fill="none" stroke="url(#${id}Ring)" stroke-width="${ring}" stroke-linecap="round"/>`;
    if (ticks) {
        for (let v = 0; v <= 100; v += 5) {
            const major = v % 25 === 0;
            const [x1, y1] = polar(cx, cy, r * 0.955, v);
            const [x2, y2] = polar(cx, cy, r * (major ? 0.87 : 0.91), v);
            s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#e2e8f0" stroke-opacity="${major ? 0.6 : 0.3}" stroke-width="${r / (major ? 80 : 120)}" stroke-linecap="round"/>`;
        }
    }
    const [nx, ny] = polar(cx, cy, r * 0.8, needle);
    s += `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${C.gold}" stroke-width="${r / 34}" stroke-linecap="round"/>`;
    s += `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${r / 13}" fill="${C.navyDeep}" stroke="${C.gold}" stroke-width="${r / 50}"/>`;
    s += `<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="${r / 28}" fill="${C.gold}"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r / 13}" fill="${C.navyDeep}" stroke="${C.gold}" stroke-width="${r / 60}"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${r / 36}" fill="${C.gold}"/>`;
    return s;
}
function defs(id, cx, cy, r) {
    return `<radialGradient id="${id}Face" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0f1a2b"/><stop offset="0.7" stop-color="#16263b"/><stop offset="1" stop-color="#1f3350"/></radialGradient>
    <linearGradient id="${id}Ring" x1="${cx - r}" y1="0" x2="${cx + r}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.teal}"/><stop offset="0.5" stop-color="${C.gold}"/><stop offset="1" stop-color="#fb8a6b"/></linearGradient>
    <clipPath id="${id}Clip"><path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy} Z"/></clipPath>`;
}

// ---------- emblem ----------
const emblem = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180" role="img" aria-label="หน้าปัดคลื่นความคิด">
  <defs>${defs('e', 160, 166, 150)}</defs>
  ${dial({ cx: 160, cy: 166, r: 150, target: 64, needle: 58, ring: 8, id: 'e' })}
</svg>
`;
fs.writeFileSync(path.join(OUT, 'emblem.svg'), emblem);

// ---------- cover ----------
const W = 1280, H = 853;
const dcx = 880, dcy = 640, dr = 330;
let waves = '';
for (let i = 1; i <= 7; i += 1) {
    const r = dr + i * 46;
    waves += `<path d="M${dcx - r} ${dcy} A${r} ${r} 0 0 1 ${dcx + r} ${dcy}" fill="none" stroke="${C.teal}" stroke-opacity="${(0.16 - i * 0.018).toFixed(3)}" stroke-width="2"/>`;
}
let stars = '';
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let i = 0; i < 70; i += 1) {
    stars += `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * H * 0.62).toFixed(0)}" r="${(rnd() * 1.6 + 0.4).toFixed(1)}" fill="#e2e8f0" opacity="${(rnd() * 0.5 + 0.15).toFixed(2)}"/>`;
}
const font = `'Chakra Petch','Bai Jamjuree','Sukhumvit Set','Thonburi',Tahoma,sans-serif`;
const cover = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="คลื่นความคิด · ใบ้ 1 คำ หมุนเข็มทาย">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0d1522"/><stop offset="0.6" stop-color="${C.navy}"/><stop offset="1" stop-color="#121a28"/>
    </linearGradient>
    <radialGradient id="glow" cx="${dcx}" cy="${dcy}" r="560" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.teal}" stop-opacity="0.18"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/>
    </radialGradient>
    ${defs('c', dcx, dcy, dr)}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${stars}
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${waves}
  ${dial({ cx: dcx, cy: dcy, r: dr, target: 68, needle: 61, ring: 16, id: 'c' })}
  <rect x="0" y="${dcy + 2}" width="${W}" height="${H - dcy}" fill="#0c131f"/>
  <line x1="0" y1="${dcy + 2}" x2="${W}" y2="${dcy + 2}" stroke="${C.teal}" stroke-opacity="0.35" stroke-width="2"/>
  <g transform="translate(96 188)">
    <text x="0" y="0" font-family="${font}" font-weight="700" font-size="112" fill="${C.gold}">คลื่นความคิด</text>
    <text x="4" y="74" font-family="${font}" font-weight="600" font-size="44" fill="#e8eefc">ใบ้ 1 คำ · หมุนเข็มทาย</text>
    <line x1="4" y1="112" x2="400" y2="112" stroke="${C.gold}" stroke-opacity="0.6" stroke-width="2"/>
    <rect x="412" y="105" width="14" height="14" fill="${C.gold}" transform="rotate(45 419 112)"/>
    <text x="4" y="164" font-family="${font}" font-weight="500" font-size="30" fill="#b9c6e4">อ่านใจเพื่อน · ใกล้เป้าได้แต้ม · 3–12 คน</text>
  </g>
  <g transform="translate(96 ${dcy + 70})" font-family="${font}" font-weight="700" font-size="40">
    <rect x="0" y="0" width="150" height="70" rx="22" fill="${C.teal}" fill-opacity="0.16" stroke="${C.teal}" stroke-opacity="0.6" stroke-width="2"/>
    <text x="75" y="47" text-anchor="middle" fill="${C.teal}">ร้อน</text>
    <text x="196" y="48" text-anchor="middle" fill="#94a3b8" font-size="40">↔</text>
    <rect x="242" y="0" width="150" height="70" rx="22" fill="${C.coral}" fill-opacity="0.16" stroke="${C.coral}" stroke-opacity="0.65" stroke-width="2"/>
    <text x="317" y="47" text-anchor="middle" fill="#fdba9a">เย็น</text>
  </g>
  <g transform="translate(${dcx} ${dcy + 104})" font-family="${font}">
    <rect x="-150" y="-44" width="300" height="88" rx="26" fill="#0f1a2b" stroke="${C.gold}" stroke-opacity="0.55" stroke-width="2"/>
    <text x="0" y="-12" text-anchor="middle" font-size="22" font-weight="600" fill="#94a3b8">คำใบ้</text>
    <text x="0" y="26" text-anchor="middle" font-size="40" font-weight="700" fill="#f1f5f9">“ไอติม”</text>
  </g>
</svg>
`;
fs.writeFileSync(path.join(OUT, 'cover.svg'), cover);

(async () => {
    const { chromium } = require('playwright');
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const browser = await chromium.launch(fs.existsSync(sys) ? { executablePath: sys } : {});
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <link href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@500;600;700&family=Chakra+Petch:wght@500;600;700&display=block" rel="stylesheet">
      <style>html,body{margin:0;background:#0d1522}</style></head><body>${cover}</body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, 'cover.jpg'), type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: W, height: H } });
    await browser.close();
    console.log('wrote emblem.svg, cover.svg, cover.jpg →', OUT);
})().catch(e => { console.error(e); process.exit(1); });
