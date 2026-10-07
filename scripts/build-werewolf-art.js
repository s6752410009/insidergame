/**
 * สร้างภาพบท Werewolf (การ์ตูน) จากต้นฉบับ → public/assets/games/werewolf/<id>.webp + <id>.jpg + cover.jpg/webp
 *
 * ต้นฉบับ (gitignored *.png อยู่ในโฟลเดอร์เดียวกัน ดูที่มาใน CREDITS.md):
 *   <id>.png          ภาพตัวละคร 1000px พื้นเทาเรียบ (Justin Nichol, CC BY 4.0)
 *   cover-village.png เงาหมู่บ้าน (Mohamed_hassan, Pixabay Content License)
 * ขั้นตอน: ลบพื้นเทา (flood fill จากขอบ — ภาพมีเส้นขอบขาว) → crop ให้ตัวละครเต็มกรอบสี่เหลี่ยม 512px
 *   → webp โปร่งใส (q82) + jpg พื้นกรมท่า (fallback) · ปก 1280x720 = ฉากพระจันทร์ + ตัวละครจากชุดเดียวกัน
 * รัน: node scripts/build-werewolf-art.js   (ต้องมี cwebp ใน PATH และ playwright chromium)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..', 'public', 'assets', 'games', 'werewolf');
const ROLE_IDS = [
    'villager', 'werewolf', 'alphaWolf', 'mayor', 'bodyguard', 'seer', 'oracle', 'doctor', 'witch', 'tracker',
    'hunter', 'cleric', 'vigilante', 'fool', 'revealer', 'serialKiller', 'prince', 'lycan', 'diseased', 'apprenticeSeer'
];
const SIZE = 512;
const KEY_TOLERANCE = 12;
const PAD = 0.04;

const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
const writeDataUrl = (file, url) => fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));

async function keyAndCrop(page, src) {
    return page.evaluate(async ({ data, size, tol, pad }) => {
        const img = new Image();
        img.src = data;
        await img.decode();
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const im = x.getImageData(0, 0, w, h);
        const a = im.data;
        const bg = [a[0], a[1], a[2]];
        const dist = (i) => Math.hypot(a[i] - bg[0], a[i + 1] - bg[1], a[i + 2] - bg[2]);
        const seen = new Uint8Array(w * h);
        const stack = [];
        for (let xx = 0; xx < w; xx++) stack.push(xx, (h - 1) * w + xx);
        for (let yy = 0; yy < h; yy++) stack.push(yy * w, yy * w + w - 1);
        while (stack.length) {
            const k = stack.pop();
            if (seen[k]) continue;
            seen[k] = 1;
            if (dist(k * 4) > tol) { seen[k] = 2; continue; }
            a[k * 4 + 3] = 0;
            const px = k % w;
            const py = (k / w) | 0;
            if (px > 0) stack.push(k - 1);
            if (px < w - 1) stack.push(k + 1);
            if (py > 0) stack.push(k - w);
            if (py < h - 1) stack.push(k + w);
        }
        // ขอบ 2px: แยกสีเทาออกจากพิกเซลที่ติดกับพื้นที่ลบ ให้ขอบเนียน
        for (let pass = 0; pass < 2; pass++) {
            const edge = [];
            for (let k = 0; k < w * h; k++) {
                if (a[k * 4 + 3] === 0 || seen[k] === 3) continue;
                const px = k % w;
                const py = (k / w) | 0;
                const nb = [px > 0 ? k - 1 : -1, px < w - 1 ? k + 1 : -1, py > 0 ? k - w : -1, py < h - 1 ? k + w : -1];
                if (nb.some((n) => n >= 0 && a[n * 4 + 3] === 0)) edge.push(k);
            }
            for (const k of edge) {
                const i = k * 4;
                const al = Math.max(0.15, Math.min(1, dist(i) / 110));
                for (let ch = 0; ch < 3; ch++) a[i + ch] = Math.max(0, Math.min(255, (a[i + ch] - (1 - al) * bg[ch]) / al));
                a[i + 3] = Math.round(al * 255);
                seen[k] = 3;
            }
        }
        x.putImageData(im, 0, 0);

        let minX = w; let minY = h; let maxX = -1; let maxY = -1;
        for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
                if (a[(yy * w + xx) * 4 + 3] > 24) {
                    if (xx < minX) minX = xx;
                    if (xx > maxX) maxX = xx;
                    if (yy < minY) minY = yy;
                    if (yy > maxY) maxY = yy;
                }
            }
        }
        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const side = Math.max(bw, bh) * (1 + pad * 2);
        const cx = minX + bw / 2;
        const cy = minY + bh / 2;
        const render = (withBg, type, q) => {
            const o = document.createElement('canvas');
            o.width = size; o.height = size;
            const ox = o.getContext('2d');
            if (withBg) {
                const g = ox.createRadialGradient(size / 2, size * 0.45, size * 0.08, size / 2, size / 2, size * 0.7);
                g.addColorStop(0, '#24345a');
                g.addColorStop(1, '#0b1020');
                ox.fillStyle = g;
                ox.fillRect(0, 0, size, size);
            }
            ox.imageSmoothingQuality = 'high';
            ox.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
            return o.toDataURL(type, q);
        };
        return { png: render(false, 'image/png'), jpg: render(true, 'image/jpeg', 0.84) };
    }, { data: dataUrl(src), size: SIZE, tol: KEY_TOLERANCE, pad: PAD });
}

function coverHtml(portrait, village) {
    // [role, center x, bottom y, size, mirror, z] — หมาป่าซ้าย ชาวบ้านขวา หันหน้าเข้าหากันใต้พระจันทร์
    const cast = [
        ['werewolf', 150, 700, 250, false, 2],
        ['alphaWolf', 380, 715, 330, true, 3],
        ['seer', 860, 712, 280, true, 3],
        ['villager', 1080, 705, 250, true, 2],
        ['hunter', 640, 724, 230, true, 4]
    ];
    return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#0a1024}
  .sky{position:absolute;inset:0;background:radial-gradient(circle at 50% 30%,#3b4f86 0%,#1c2a52 30%,#0d1530 62%,#070b1a 100%)}
  .moon{position:absolute;left:520px;top:40px;width:240px;height:240px;border-radius:50%;
    background:radial-gradient(circle at 42% 38%,#fffbe8 0%,#fdf0b8 45%,#f4d77a 100%);
    box-shadow:0 0 60px 20px rgba(253,230,138,.45),0 0 180px 90px rgba(253,230,138,.18)}
  .crater{position:absolute;border-radius:50%;background:rgba(214,180,90,.35)}
  canvas{position:absolute;left:0;bottom:0}
  .c{position:absolute;filter:drop-shadow(0 10px 18px rgba(0,0,0,.55))}
  .shade{position:absolute;inset:auto 0 0 0;height:260px;background:linear-gradient(180deg,transparent,rgba(5,8,20,.65));z-index:1}
  .red{position:absolute;left:0;top:0;width:640px;height:720px;background:radial-gradient(ellipse at 20% 85%,rgba(220,38,38,.28),transparent 60%)}
  .gold{position:absolute;right:0;top:0;width:640px;height:720px;background:radial-gradient(ellipse at 80% 85%,rgba(250,204,21,.22),transparent 60%)}
</style></head><body>
  <div class="sky"></div><div id="stars"></div>
  <div class="moon"><i class="crater" style="left:60px;top:70px;width:46px;height:46px"></i><i class="crater" style="left:140px;top:120px;width:30px;height:30px"></i><i class="crater" style="left:96px;top:160px;width:22px;height:22px"></i></div>
  <canvas id="v" width="1280" height="460"></canvas>
  <div class="red"></div><div class="gold"></div>
  ${cast.map(([id, x, b, s, flip, z]) => `<img class="c" src="${portrait(id)}" style="left:${x - s / 2}px;top:${b - s}px;width:${s}px;height:${s}px;z-index:${z};${flip ? 'transform:scaleX(-1)' : ''}">`).join('')}
  <div class="shade"></div>
<script>
  let h = ''; let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 90; i++) { const x = r() * 1280, y = r() * 360, s = r() * 2.2 + 0.6, o = 0.35 + r() * 0.6;
    h += '<i style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:#fff;opacity:' + o + '"></i>'; }
  document.getElementById('stars').innerHTML = h;
  (async () => {
    const img = new Image(); img.src = ${JSON.stringify(village)}; await img.decode();
    const c = document.getElementById('v'), x = c.getContext('2d');
    const w = 1280, hh = Math.round(img.naturalHeight * 1280 / img.naturalWidth);
    const t = document.createElement('canvas'); t.width = w; t.height = hh; const tx = t.getContext('2d'); tx.drawImage(img, 0, 0, w, hh);
    const d = tx.getImageData(0, 0, w, hh), a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const dr = a[i] - 116, dg = a[i + 1] - 186, db = a[i + 2] - 253; const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist < 40) a[i + 3] = 0; else if (dist < 90) a[i + 3] = Math.round(255 * (dist - 40) / 50);
      const lit = a[i] > 200 && a[i + 1] > 150 && a[i + 2] < 120;
      if (!lit) { a[i] *= 0.55; a[i + 1] *= 0.6; a[i + 2] *= 0.75; }
    }
    tx.putImageData(d, 0, 0);
    x.drawImage(t, 0, 0, w, hh, 0, 460 - hh + 40, w, hh);
    document.body.dataset.ready = '1';
  })();
</script></body></html>`;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>art</title>');
    const keyed = {};
    for (const id of ROLE_IDS) {
        const src = path.join(DIR, `${id}.png`);
        if (!fs.existsSync(src)) throw new Error(`missing source ${src} (see CREDITS.md)`);
        const out = await keyAndCrop(page, src);
        keyed[id] = out.png;
        const tmpPng = path.join(DIR, `.${id}.keyed.tmp`);
        writeDataUrl(tmpPng, out.png);
        execFileSync('cwebp', ['-quiet', '-q', '82', '-alpha_q', '90', '-m', '6', tmpPng, '-o', path.join(DIR, `${id}.webp`)]);
        fs.unlinkSync(tmpPng);
        writeDataUrl(path.join(DIR, `${id}.jpg`), out.jpg);
        console.log('role', id);
    }

    const coverPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const tmpHtml = path.join(DIR, '.cover.tmp.html');
    fs.writeFileSync(tmpHtml, coverHtml((id) => keyed[id], dataUrl(path.join(DIR, 'cover-village.png'))));
    await coverPage.goto('file://' + tmpHtml);
    await coverPage.waitForFunction(() => document.body.dataset.ready === '1');
    await coverPage.screenshot({ path: path.join(DIR, 'cover.jpg'), type: 'jpeg', quality: 82 });
    const tmpCover = path.join(DIR, '.cover.tmp');
    await coverPage.screenshot({ path: tmpCover, type: 'png' });
    execFileSync('cwebp', ['-quiet', '-q', '80', tmpCover, '-o', path.join(DIR, 'cover.webp')]);
    fs.unlinkSync(tmpCover);
    fs.unlinkSync(tmpHtml);
    console.log('cover');
    await browser.close();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
