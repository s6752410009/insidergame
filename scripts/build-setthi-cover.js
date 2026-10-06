/**
 * วาดปกเกมเศรษฐี (ภาพของเราเอง ใช้ไอคอนจาก setthi-art.js) → public/assets/games/setthi/cover.jpg
 * รัน: node scripts/build-setthi-cover.js
 */
const fs = require('fs');
const path = require('path');
const B = require('../games/setthiBoard');

const art = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'games', 'setthi', 'setthi-art.js'), 'utf8');
const sq = i => B.SQUARES[i];
const landSvg = i => fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'games', 'setthi', 'land', sq(i).art + '.svg'), 'utf8').replace(/width="240" height="240"/, 'width="100%" height="100%"');
const band = i => (sq(i).group ? B.GROUPS[sq(i).group].color : '#35435e');

// แถวล่าง (ช่อง 1–9 เรียงจากขวาไปซ้าย) + มุมเริ่ม — วางในมุมมองเอียง
const row = [9, 8, 7, 6, 5, 4, 3, 2, 1].map(i => `
  <div class="cell" data-i="${i}">
    ${sq(i).type === 'property' ? `<div class="band" style="background:${band(i)}">${i === 6 || i === 7 ? '<i class="h"></i><i class="h"></i>' : (i === 9 ? '<i class="hotel"></i>' : '')}</div>` : ''}
    <div class="ico" data-icon="${sq(i).icon}"></div>
    <div class="nm">${sq(i).short}</div>
    <div class="pr">${sq(i).price ? '฿' + sq(i).price : (sq(i).amount ? '฿' + sq(i).amount : '')}</div>
  </div>`).join('');

const deed = (i, rot, x, y, z) => `
  <div class="deed" style="left:${x}px; top:${y}px; transform: rotate(${rot}deg); z-index:${z}">
    <div class="dh" style="background:${band(i)}"><small>สี${B.GROUPS[sq(i).group].name}</small><b>${sq(i).name}</b></div>
    <div class="di land">${landSvg(i)}</div>
    <div class="dp">ราคา ฿${sq(i).price}</div>
    <div class="dr"><span>ค่าเช่า</span><span>฿${sq(i).rent[0]}</span></div>
    <div class="dr"><span>โรงแรม</span><span>฿${sq(i).rent[5].toLocaleString('en-US')}</span></div>
  </div>`;

const die = (pips, x, y, rot) => `<div class="die" style="left:${x}px; top:${y}px; transform: rotate(${rot}deg)">${pips.map(([c, r]) => `<i style="grid-area:${r}/${c}"></i>`).join('')}</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@600;700&family=Chakra+Petch:wght@700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1280px;height:853px;overflow:hidden;background:#1a2332;font-family:'Bai Jamjuree',sans-serif}
  .bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 70% at 62% 58%,#2b3b5a 0%,#1a2332 55%,#0f1520 100%)}
  .kanok{position:absolute;inset:0;opacity:.9}
  .glow{position:absolute;left:520px;top:300px;width:760px;height:560px;border-radius:50%;background:radial-gradient(closest-side,rgba(245,200,107,.28),transparent)}
  .board{position:absolute;left:110px;top:520px;width:1150px;height:250px;transform:perspective(1100px) rotateX(46deg) rotateZ(-12deg);transform-origin:50% 50%;
    background:linear-gradient(145deg,#f0d38a,#a87a2c 45%,#ecc97a);padding:7px;border-radius:14px;box-shadow:0 60px 80px rgba(0,0,0,.55)}
  .inner{display:grid;grid-template-columns:repeat(9,1fr) 1.6fr;gap:2px;height:100%;background:#6b4f22;border-radius:9px;overflow:hidden}
  .cell{position:relative;background:#f6eedb;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:12px;color:#22304a}
  .band{position:absolute;left:0;right:0;top:0;height:22%;display:flex;gap:4px;align-items:center;justify-content:center}
  .h{width:18px;height:18px;background:#3fbf7f;clip-path:polygon(50% 0,100% 45%,100% 100%,0 100%,0 45%);box-shadow:0 0 0 2px #145c36 inset}
  .hotel{width:30px;height:20px;background:#e5534b;border-radius:3px 3px 0 0;box-shadow:inset 0 0 0 2px #7a1d18}
  .ico{width:52px;height:52px;margin-bottom:6px}.ico svg,.di svg{width:100%;height:100%}
  .nm{font-weight:700;font-size:15px}.pr{font-family:'Chakra Petch';font-size:14px;color:#55607a}
  .go{background:radial-gradient(circle,#fbe8b8,#efe0bd);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:'Chakra Petch';color:#22304a;font-size:30px;font-weight:700}
  .go .arrow{width:70px;height:70px;color:#d9443b}
  .title{position:absolute;left:640px;top:46px;transform:translateX(-50%);text-align:center;white-space:nowrap}
  .title b{display:block;font-family:'Chakra Petch';font-weight:700;font-size:170px;line-height:1;color:#f5c86b;letter-spacing:2px;text-shadow:0 5px 0 #8a6216,0 18px 40px rgba(0,0,0,.6)}
  .title span{display:block;margin-top:14px;font-size:34px;color:#e8e2d4;letter-spacing:6px;font-weight:600}
  .title em{display:inline-block;margin-top:18px;font-style:normal;font-size:22px;color:#1a2332;background:#f5c86b;border-radius:999px;padding:6px 18px;font-weight:700}
  .deed{position:absolute;width:210px;background:#f6eedb;border-radius:14px;padding:9px;box-shadow:0 26px 50px rgba(0,0,0,.5);text-align:center;color:#22304a}
  .dh{border-radius:9px;color:#fff;padding:8px 6px}.dh small{display:block;font-size:14px;opacity:.9}.dh b{font-family:'Chakra Petch';font-size:28px;line-height:1.1}
  .di{width:70px;height:70px;margin:8px auto 2px}.di.land{width:150px;height:150px;margin:2px auto -6px}.dp{font-family:'Chakra Petch';font-weight:700;font-size:21px}
  .dr{display:flex;justify-content:space-between;font-size:16px;border-top:1px dashed rgba(34,48,74,.3);padding:4px 6px}
  .die{position:absolute;width:96px;height:96px;border-radius:20px;background:radial-gradient(circle at 30% 25%,#fffdf6,#efe4cc 70%,#d9caa6);box-shadow:0 20px 34px rgba(0,0,0,.55),inset 0 -6px 0 rgba(0,0,0,.08);display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:15px;box-sizing:border-box}
  .die i{width:19px;height:19px;border-radius:50%;background:#22304a;place-self:center}
  .coin{position:absolute;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff6d0,#f5c86b 45%,#b8862b);box-shadow:0 10px 18px rgba(0,0,0,.45),inset 0 0 0 4px #c9962f;display:grid;place-items:center;font:700 32px 'Chakra Petch';color:#7a5410}
  .token{position:absolute;width:76px;height:76px;border-radius:50%;border:5px solid #fff8e8;display:grid;place-items:center;font-size:38px;box-shadow:0 14px 24px rgba(0,0,0,.5)}
</style></head><body>
<div class="bg"></div>
<svg class="kanok" width="1280" height="853"><defs><pattern id="k" width="56" height="56" patternUnits="userSpaceOnUse"><g fill="none" stroke="#f5c86b" stroke-opacity=".1" stroke-width="1.4"><path d="M28 5l8 11-8 12-8-12z"/><path d="M28 28l8 11-8 12-8-12z"/><path d="M5 28l11-8 12 8-12 8z"/><path d="M28 28l11-8 12 8-12 8z"/></g></pattern></defs><rect width="1280" height="853" fill="url(#k)"/></svg>
<div class="glow"></div>
<div class="board"><div class="inner">${row}<div class="go"><div class="arrow" data-icon="go"></div>เริ่ม</div></div></div>
${deed(28, -14, 240, 270, 3)}${deed(39, 12, 830, 250, 5)}
${die([[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 500, 430, -16)}${die([[1, 1], [3, 3]], 640, 470, 12)}
<div class="coin" style="left:470px;top:345px">฿</div><div class="coin" style="left:770px;top:410px;transform:scale(.8)">฿</div><div class="coin" style="left:420px;top:690px;transform:scale(.75)">฿</div>
<div class="token" style="left:780px;top:600px;background:#ef5b4c">🐯</div><div class="token" style="left:880px;top:650px;background:#4ea8dc">🐼</div>
<div class="title"><b>เศรษฐี</b><span>ทอย · ซื้อ · เก็บค่าเช่า</span><em>2–6 คน · ประมูล · เทรด · ใส่บอทได้</em></div>
<script>${art}</script>
<script>document.querySelectorAll('[data-icon]').forEach(function(n){n.innerHTML=SetthiArt.icon(n.dataset.icon)});</script>
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
