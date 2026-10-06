/**
 * วาดปกเกมเศรษฐี (รูปถ่ายจาก photos/ ดูเครดิตใน photos/CREDITS.md) → public/assets/games/setthi/cover.jpg
 * รัน: node scripts/build-setthi-cover.js
 */
const fs = require('fs');
const path = require('path');
const B = require('../games/setthiBoard');

const PH = path.join(__dirname, '..', 'public', 'assets', 'games', 'setthi', 'photos');
const photo = (key, size) => 'data:image/webp;base64,' + fs.readFileSync(path.join(PH, `${key}-${size}.webp`)).toString('base64');
const sq = i => B.SQUARES[i];
const OWN = ['#e53935', '#1f6feb', '#16a34a', '#f5b800'];
const INK = ['#fff', '#fff', '#fff', '#2a1f00'];
const k = n => (n >= 1000 ? '฿' + (Math.round(n / 100) / 10) + 'k' : '฿' + n);

// แถวช่องในมุมมองเอียง: สีเจ้าของเต็มช่อง + รูปจริง (เหมือนในเกม)
const rowSquares = [[31, 0, 4], [30, 0, 3], [28, 1, 2], [27, null, 0], [26, 2, 3], [25, 3, 1], [23, null, 0], [22, 1, 4]];
const row = rowSquares.map(([i, o, lv]) => {
    const own = o === null ? null : OWN[o];
    const toll = own ? sq(i).price * B.TOLL_MULT[lv] : sq(i).price;
    return `<div class="cell${own ? ' owned' : ''}" style="--own:${own || 'transparent'};--ink:${o === null ? '#fff' : INK[o]}">
      <div class="ph" style="background-image:url(${photo(sq(i).art, 't')})"></div>
      ${lv === 4 ? `<div class="lm" style="background-image:url(${photo(sq(i).art, 't')})"></div>` : ''}
      <div class="lo"><div class="nm">${sq(i).short}</div><div class="pr">${k(Math.round(toll / 10) * 10)}</div></div>
    </div>`;
}).join('');

const card = (key, title, rot, x, y, z, o) => `
  <div class="card" style="left:${x}px; top:${y}px; transform: rotate(${rot}deg); z-index:${z}; --own:${OWN[o]}">
    <div class="cimg" style="background-image:url(${photo(key, 'w')})"></div>
    <div class="cb"><b>${title}</b><span>เจ้าของ</span></div>
  </div>`;

const die = (pips, x, y, rot) => `<div class="die" style="left:${x}px; top:${y}px; transform: rotate(${rot}deg)">${pips.map(([c, r]) => `<i style="grid-area:${r}/${c}"></i>`).join('')}</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@600;700&family=Chakra+Petch:wght@700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1280px;height:853px;overflow:hidden;background:#1a2332;font-family:'Bai Jamjuree',sans-serif}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 70% at 62% 58%,#2b3b5a 0%,#1a2332 55%,#0f1520 100%)}
  .kanok{position:absolute;inset:0;opacity:.9}
  .glow{position:absolute;left:420px;top:330px;width:860px;height:560px;border-radius:50%;background:radial-gradient(closest-side,rgba(245,200,107,.26),transparent)}
  .board{position:absolute;left:70px;top:540px;width:1200px;height:230px;transform:perspective(1100px) rotateX(44deg) rotateZ(-10deg);transform-origin:50% 50%;
    background:linear-gradient(145deg,#f0d38a,#a87a2c 45%,#ecc97a);padding:7px;border-radius:14px;box-shadow:0 60px 80px rgba(0,0,0,.55)}
  .inner{display:grid;grid-template-columns:repeat(8,1fr);gap:3px;height:100%;background:#6b4f22;border-radius:9px;overflow:visible}
  .cell{position:relative;background:#222;overflow:visible;border-radius:4px}
  .ph{position:absolute;inset:0;background-size:cover;background-position:center;border-radius:4px}
  .lo{position:absolute;left:0;right:0;bottom:0;height:52%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:10px;background:linear-gradient(180deg,transparent,rgba(16,22,36,.85) 40%);border-radius:0 0 4px 4px}
  .owned .lo{background:linear-gradient(180deg,transparent,var(--own) 45%)}
  .owned::after{content:'';position:absolute;inset:0;border:6px solid color-mix(in oklch,var(--own) 70%,#000);border-radius:4px}
  .nm{font-weight:700;font-size:24px;color:var(--ink,#fff);text-shadow:0 2px 3px rgba(0,0,0,.5)}
  .pr{font-family:'Chakra Petch';font-size:20px;color:#fff;background:rgba(0,0,0,.45);border-radius:999px;padding:1px 10px;margin-top:2px}
  .owned .pr{background:color-mix(in oklch,var(--own) 50%,#000)}
  .lm{position:absolute;left:8%;bottom:96%;width:84%;aspect-ratio:1;border-radius:50%;background-size:cover;background-position:center;border:5px solid #ffe28a;box-shadow:0 0 0 3px var(--own),0 0 30px rgba(255,226,138,.8)}
  .title{position:absolute;left:640px;top:36px;transform:translateX(-50%);text-align:center;white-space:nowrap;z-index:10}
  .title b{display:block;font-family:'Chakra Petch';font-weight:700;font-size:170px;line-height:1;color:#f5c86b;letter-spacing:2px;text-shadow:0 5px 0 #8a6216,0 18px 40px rgba(0,0,0,.6)}
  .title span{display:block;margin-top:12px;font-size:34px;color:#e8e2d4;letter-spacing:6px;font-weight:600}
  .title em{display:inline-block;margin-top:16px;font-style:normal;font-size:22px;color:#1a2332;background:#f5c86b;border-radius:999px;padding:6px 18px;font-weight:700}
  .card{position:absolute;width:250px;border-radius:18px;background:var(--own);padding:8px;box-shadow:0 26px 50px rgba(0,0,0,.5)}
  .cimg{height:160px;border-radius:12px;background-size:cover;background-position:center}
  .cb{display:flex;justify-content:space-between;align-items:center;padding:8px 6px 2px;color:#fff}
  .cb b{font-family:'Chakra Petch';font-size:30px}.cb span{font-size:16px;opacity:.9}
  .die{position:absolute;width:96px;height:96px;border-radius:20px;background:radial-gradient(circle at 30% 25%,#fffdf6,#efe4cc 70%,#d9caa6);box-shadow:0 20px 34px rgba(0,0,0,.55),inset 0 -6px 0 rgba(0,0,0,.08);display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:15px;box-sizing:border-box}
  .die i{width:19px;height:19px;border-radius:50%;background:#22304a;place-self:center}
  .coin{position:absolute;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff6d0,#f5c86b 45%,#b8862b);box-shadow:0 10px 18px rgba(0,0,0,.45),inset 0 0 0 4px #c9962f;display:grid;place-items:center;font:700 32px 'Chakra Petch';color:#7a5410}
  .token{position:absolute;width:76px;height:76px;border-radius:50%;border:5px solid #fff8e8;display:grid;place-items:center;font-size:38px;box-shadow:0 14px 24px rgba(0,0,0,.5)}
</style></head><body>
<div class="bg"></div>
<svg class="kanok" width="1280" height="853"><defs><pattern id="k" width="56" height="56" patternUnits="userSpaceOnUse"><g fill="none" stroke="#f5c86b" stroke-opacity=".1" stroke-width="1.4"><path d="M28 5l8 11-8 12-8-12z"/><path d="M28 28l8 11-8 12-8-12z"/><path d="M5 28l11-8 12 8-12 8z"/><path d="M28 28l11-8 12 8-12 8z"/></g></pattern></defs><rect width="1280" height="853" fill="url(#k)"/></svg>
<div class="glow"></div>
<div class="board"><div class="inner">${row}</div></div>
${card('phiphi', 'เกาะพีพี', -12, 150, 300, 3, 2)}${card('siam', 'สยาม', 10, 880, 290, 5, 1)}
${die([[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 500, 440, -16)}${die([[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]], 640, 470, 12)}
<div class="coin" style="left:450px;top:360px">฿</div><div class="coin" style="left:790px;top:440px;transform:scale(.8)">฿</div>
<div class="token" style="left:770px;top:610px;background:#e53935">🐯</div><div class="token" style="left:860px;top:660px;background:#1f6feb">🐼</div>
<div class="title"><b>เศรษฐี</b><span>ทอย · ซื้อ · ผูกขาด</span><em>2–4 คน · ซื้อต่อ · แลนด์มาร์ก · ใส่บอทได้</em></div>
</body></html>`;

(async () => {
    const out = path.join(__dirname, '..', 'public', 'assets', 'games', 'setthi');
    fs.mkdirSync(out, { recursive: true });
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 853 } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'cover.jpg'), type: 'jpeg', quality: 86 });
    await browser.close();
    console.log('wrote cover.jpg');
})().catch(e => { console.error(e); process.exit(1); });
