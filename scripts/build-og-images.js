/**
 * สร้างภาพแชร์ (og:image / twitter:image) 1200×630 ของทุกเกม → public/og/<id>.jpg
 * และภาพรวมของเว็บ → public/og/home.jpg
 *
 * ใช้แค่ภาพปกที่มีอยู่แล้ว (public/assets/games/...) วางเต็มกรอบ + แถบชื่อเกมภาษาไทย
 * render ด้วย Playwright (Chromium) แล้วบันทึกเป็น JPEG
 *
 * รัน: node scripts/build-og-images.js           (ทุกเกม)
 *      node scripts/build-og-images.js coup setthi (เฉพาะบางเกม)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { listSeoGames } = require('../games/seoContent');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'og');
const W = 1200;
const H = 630;

function dataUrl(publicPath) {
    const file = path.join(ROOT, 'public', publicPath.replace(/^\/assets\//, 'assets/').replace(/^\/static\//, ''));
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BASE_CSS = `
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #17142b; }
    body { font-family: 'Thonburi', 'Sukhumvit Set', 'Noto Sans Thai', 'Tahoma', sans-serif; color: #fff; }
`;

function gameCardHtml(game) {
    const tagline = game.h1.split('—')[1] ? game.h1.split('—')[1].trim() : game.intro.split(' ').slice(0, 6).join(' ');
    return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>${BASE_CSS}
        .art { position: absolute; inset: 0; background: #17142b url('${dataUrl(game.cover)}') center / cover no-repeat; }
        .shade { position: absolute; inset: 0;
            background: linear-gradient(90deg, rgba(15,12,41,0.94) 0%, rgba(15,12,41,0.82) 38%, rgba(15,12,41,0.15) 72%, rgba(15,12,41,0) 100%),
                        linear-gradient(0deg, rgba(15,12,41,0.7) 0%, rgba(15,12,41,0) 40%); }
        .text { position: absolute; left: 64px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
        .kicker { font-size: 30px; font-weight: 700; color: #f5c86b; }
        .name { font-size: 92px; font-weight: 800; line-height: 1.05; text-shadow: 0 4px 24px rgba(0,0,0,.5); }
        .tag { font-size: 36px; font-weight: 600; line-height: 1.35; color: #e6e2f7; }
        .chips { display: flex; gap: 12px; margin-top: 6px; }
        .chip { font-size: 26px; font-weight: 700; padding: 8px 18px; border-radius: 999px; background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); }
        .brand { position: absolute; left: 64px; bottom: 40px; font-size: 26px; font-weight: 700; color: #cfcae6; }
        .brand b { color: #e74c3c; }
    </style></head><body>
        <div class="art"></div><div class="shade"></div>
        <div class="text">
            <div class="kicker">${esc(game.emoji)} ${game.solo ? 'เกมเล่นคนเดียว' : 'เกมปาร์ตี้ออนไลน์'}</div>
            <div class="name">${esc(game.name)}</div>
            <div class="tag">${esc(tagline)}</div>
            <div class="chips"><span class="chip">👥 ${esc(game.playersLabel)}</span><span class="chip">🆓 เล่นฟรีบนเว็บ</span></div>
        </div>
        <div class="brand"><b>●</b> insider-th.me</div>
    </body></html>`;
}

function homeCardHtml(games) {
    const tiles = games.filter(g => /\.jpe?g$/i.test(g.cover)).slice(0, 12);
    return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>${BASE_CSS}
        .grid { position: absolute; inset: -20px; display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: 230px; gap: 8px; transform: rotate(-4deg) scale(1.12); opacity: .9; }
        .grid div { background-size: cover; background-position: center; border-radius: 14px; }
        .shade { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(15,12,41,0.92) 0%, rgba(15,12,41,0.86) 45%, rgba(15,12,41,0.35) 100%); }
        .text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 16px; padding: 0 80px; }
        .name { font-size: 80px; font-weight: 800; line-height: 1.12; text-shadow: 0 4px 24px rgba(0,0,0,.6); }
        .tag { font-size: 34px; font-weight: 600; color: #e6e2f7; }
        .brand { font-size: 30px; font-weight: 700; color: #f5c86b; margin-top: 8px; }
    </style></head><body>
        <div class="grid">${tiles.map(g => `<div style="background-image:url('${dataUrl(g.cover)}')"></div>`).join('')}</div>
        <div class="shade"></div>
        <div class="text">
            <div class="name">เกมปาร์ตี้ออนไลน์<br>เล่นกับเพื่อนฟรี</div>
            <div class="tag">Werewolf · Coup · Avalon · Codenames · ป๊อกเด้ง · เศรษฐี · อีก ${games.length - 6} เกม</div>
            <div class="brand">insider-th.me</div>
        </div>
    </body></html>`;
}

async function render(page, html, outFile) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.screenshot({ path: outFile, type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: W, height: H } });
}

(async () => {
    const only = process.argv.slice(2);
    const games = listSeoGames();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
        for (const game of games) {
            if (only.length && !only.includes(game.id)) continue;
            const out = path.join(OUT_DIR, `${game.id}.jpg`);
            await render(page, gameCardHtml(game), out);
            console.log('og', game.id, `${Math.round(fs.statSync(out).size / 1024)}KB`);
        }
        if (!only.length || only.includes('home')) {
            const out = path.join(OUT_DIR, 'home.jpg');
            await render(page, homeCardHtml(games), out);
            console.log('og home', `${Math.round(fs.statSync(out).size / 1024)}KB`);
        }
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
