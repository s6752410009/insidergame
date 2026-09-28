/**
 * สร้างหน้าการ์ดของเกมจับคู่ความจำ (240×320 webp) จากภาพเกมที่มีอยู่ในเว็บ
 * ภาพต้นฉบับ 512px หนัก ~60–90KB ต่อใบ — ย่อ/ครอปให้พอดีการ์ด เหลือราว 10–20KB
 *
 * รัน: node scripts/build-solo-memory-faces.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const core = require('../public/js/solo/memory-core');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'games');
const OUT = path.join(ROOT, 'solo', 'memory', 'faces');

const SOURCES = {
    wolf: key => ({ file: `werewolf/${key}.webp`, mode: 'photo' }),
    market: key => ({ file: `blackmarket/${key}.webp`, mode: 'photo' }),
    city: key => ({ file: `spyfall/${key}.webp`, mode: 'icon' }),
    knight: key => ({
        file: `avalon/${key}.svg`,
        mode: ['crown', 'token-fail', 'token-success', 'vote-approve', 'vote-reject'].includes(key) ? 'emblem' : 'card'
    })
};

function dataUrl(file) {
    const ext = path.extname(file).slice(1);
    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    return `data:${mime};base64,${fs.readFileSync(path.join(ROOT, file)).toString('base64')}`;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent('<canvas id="c" width="240" height="320"></canvas>');
    let total = 0;
    for (const deckId of core.DECK_IDS) {
        fs.mkdirSync(path.join(OUT, deckId), { recursive: true });
        for (const [key] of core.DECKS[deckId].cards) {
            const src = SOURCES[deckId](key);
            const out = await page.evaluate(async ({ url, mode }) => {
                const img = new Image();
                img.src = url;
                await img.decode();
                const c = document.getElementById('c');
                const g = c.getContext('2d');
                const W = 240, H = 320;
                g.clearRect(0, 0, W, H);
                g.fillStyle = '#16203a';
                g.fillRect(0, 0, W, H);
                const iw = img.naturalWidth || 512, ih = img.naturalHeight || 512;
                if (mode === 'photo') {
                    const s = Math.max(W / iw, H / ih);
                    g.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
                } else if (mode === 'card') {
                    const s = W / iw;
                    g.drawImage(img, 0, (H - ih * s) / 2, W, ih * s);
                } else if (mode === 'icon') {
                    // ไอคอนทองบนพื้นกรมท่า มุมโค้งขาว — ครอปขอบทิ้ง แล้วใช้สีพื้นของไอคอนเต็มการ์ด
                    const tmp = document.createElement('canvas');
                    tmp.width = iw; tmp.height = ih;
                    const tg = tmp.getContext('2d');
                    tg.drawImage(img, 0, 0);
                    const px = tg.getImageData(Math.round(iw * 0.5), Math.round(ih * 0.05), 1, 1).data;
                    g.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
                    g.fillRect(0, 0, W, H);
                    const inset = 0.1;
                    const sx = iw * inset, sw = iw * (1 - inset * 2);
                    const size = 212;
                    g.drawImage(img, sx, sx, sw, sw, (W - size) / 2, (H - size) / 2, size, size);
                } else {
                    const grad = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 170);
                    grad.addColorStop(0, '#2b3a63');
                    grad.addColorStop(1, '#16203a');
                    g.fillStyle = grad;
                    g.fillRect(0, 0, W, H);
                    const size = 196;
                    g.drawImage(img, (W - size) / 2, (H - size) / 2, size, size);
                }
                return c.toDataURL('image/webp', 0.8);
            }, { url: dataUrl(src.file), mode: src.mode });
            const buf = Buffer.from(out.split(',')[1], 'base64');
            fs.writeFileSync(path.join(OUT, deckId, `${key}.webp`), buf);
            total += buf.length;
        }
    }
    await browser.close();
    console.log(`faces written: ${(total / 1024).toFixed(0)} KB total`);
})().catch(error => { console.error(error); process.exit(1); });
