/**
 * เศรษฐี — รูปถ่ายจริงของแต่ละช่อง → public/assets/games/setthi/photos/
 *
 * แหล่งรูป (ใช้เชิงพาณิชย์ได้ฟรี):
 *  - Unsplash (Unsplash License: ใช้ฟรี ไม่บังคับให้เครดิต แต่เราใส่ให้)
 *  - Wikimedia Commons เฉพาะ CC BY / CC BY-SA / CC0 / Public Domain (ต้องให้เครดิต — อยู่ใน CREDITS.md และในเกมใต้ปุ่ม "?")
 * ไม่ใช้รูปที่พระพุทธรูปเป็นตัวหลัก (ช่องโดนเหยียบ/ประทับตรา) · ใช้ตัววัดภายนอก วิว ธรรมชาติ เมือง
 *
 * ทุกรูปผ่านการปรับสีเดียวกัน (อิ่มขึ้นนิด คอนทราสต์ อุ่นทอง ขอบมืดจาง ๆ) ให้ดูเป็นชุดเดียวกัน
 * ออก 2 ขนาด: <key>-t.webp 160×160 (บนช่อง) และ <key>-w.webp 640×400 (แผ่นข้อมูล/ฉาก) · webp q75
 *
 * รัน: node scripts/build-setthi-photos.js   (ต้องมีเน็ต · ใช้ curl + Chromium ของ playwright)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'games', 'setthi', 'photos');
const CACHE = process.env.PHOTO_CACHE || path.join(require('os').tmpdir(), 'setthi-photo-cache');

const U = (id, file, author, user, focus = [0.5, 0.5]) => ({
    source: 'Unsplash',
    license: 'Unsplash License',
    licenseUrl: 'https://unsplash.com/license',
    url: `https://images.unsplash.com/${file}?w=1400&q=85&fm=jpg`,
    link: `https://unsplash.com/photos/${id}`,
    author,
    authorUrl: `https://unsplash.com/@${user}`,
    focus
});
const W = (title, dir, license, author, focus = [0.5, 0.5]) => {
    const name = title.replace(/^File:/, '').replace(/ /g, '_');
    return {
        source: 'Wikimedia Commons',
        license,
        licenseUrl: /BY-SA 3\.0/.test(license) ? 'https://creativecommons.org/licenses/by-sa/3.0/' : /BY 4\.0/.test(license) ? 'https://creativecommons.org/licenses/by/4.0/' : 'https://creativecommons.org/licenses/',
        url: `https://upload.wikimedia.org/wikipedia/commons/thumb/${dir}/${encodeURIComponent(name)}/1280px-${encodeURIComponent(name)}`,
        link: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        author,
        authorUrl: null,
        focus
    };
};

/** key = ชื่อรูปในเกม (ตรงกับ art ของช่อง) */
const PHOTOS = {
    yasothon: W('File:2013 Yasothon Rocket Festival 06.jpg', 'b/be', 'CC BY-SA 3.0', 'Takeaway', [0.5, 0.35]),
    mukdahan: W('File:Bang Sai Yai, Mueang Mukdahan District, Mukdahan, Thailand - panoramio.jpg', '4/46', 'CC BY-SA 3.0', '::::=UT=::::', [0.5, 0.5]),
    udon: null,
    khonkaen: null,
    korat: W('File:Phimai Historical Park Thailand 04.jpg', 'f/f7', 'CC BY 4.0', 'Philip Nalangan', [0.5, 0.45]),
    nan: null,
    chiangrai: null,
    sukhothai: null,
    lopburi: null,
    ayutthaya: null,
    kanchanaburi: null,
    huahin: null,
    pattaya: null,
    chiangmai: null,
    phuket: null,
    yaowarat: null,
    pratunam: null,
    siam: null,
    silom: null,
    sukhumvit: null,
    damnoen: null,
    khaoyai: null,
    inthanon: null,
    phiphi: null,
    go: null,
    island: null,
    festival: null,
    tour: null
};

// รูปจาก Unsplash (id, ไฟล์บน CDN, ช่างภาพ) — เลือกจากการค้นหาแล้วดูด้วยตา
const UNSPLASH = JSON.parse(fs.readFileSync(path.join(__dirname, 'setthi-photos.json'), 'utf8'));
Object.entries(UNSPLASH).forEach(([key, v]) => { PHOTOS[key] = U(v.id, v.file, v.author, v.user, v.focus || [0.5, 0.5]); });

function download(key, item) {
    fs.mkdirSync(CACHE, { recursive: true });
    const file = path.join(CACHE, key + '.jpg');
    if (!fs.existsSync(file) || fs.statSync(file).size < 10000) {
        execFileSync('curl', ['-sSfL', '-m', '60', '-A', 'setthi-photo-builder/1.0 (insider-th.me game credits)', '-o', file, item.url]);
    }
    return file;
}

async function main() {
    const missing = Object.keys(PHOTOS).filter(k => !PHOTOS[k]);
    if (missing.length) throw new Error('ยังไม่มีรูป: ' + missing.join(', '));
    fs.mkdirSync(OUT, { recursive: true });
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    let bytes = 0;
    try {
        for (const [key, item] of Object.entries(PHOTOS)) {
            const src = download(key, item);
            const data = 'data:image/jpeg;base64,' + fs.readFileSync(src).toString('base64');
            const out = await page.evaluate(async ({ data, focus }) => {
                const img = new Image();
                img.src = data;
                await img.decode();
                function render(w, h) {
                    const c = document.createElement('canvas');
                    c.width = w;
                    c.height = h;
                    const g = c.getContext('2d');
                    // ครอปแบบ cover รอบจุดโฟกัส
                    const scale = Math.max(w / img.width, h / img.height);
                    const sw = w / scale;
                    const sh = h / scale;
                    const sx = Math.max(0, Math.min(img.width - sw, img.width * focus[0] - sw / 2));
                    const sy = Math.max(0, Math.min(img.height - sh, img.height * focus[1] - sh / 2));
                    g.filter = 'saturate(1.14) contrast(1.06) brightness(1.03)';
                    g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
                    g.filter = 'none';
                    // อุ่นทองบาง ๆ
                    g.globalCompositeOperation = 'soft-light';
                    g.fillStyle = 'rgba(245, 200, 107, 0.22)';
                    g.fillRect(0, 0, w, h);
                    // ขอบมืดจาง ๆ
                    g.globalCompositeOperation = 'source-over';
                    const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
                    v.addColorStop(0, 'rgba(0,0,0,0)');
                    v.addColorStop(1, 'rgba(10,14,24,0.38)');
                    g.fillStyle = v;
                    g.fillRect(0, 0, w, h);
                    return c.toDataURL('image/webp', 0.75);
                }
                return { t: render(160, 160), w: render(640, 400) };
            }, { data, focus: item.focus });
            for (const [suffix, url] of Object.entries(out)) {
                const buf = Buffer.from(url.split(',')[1], 'base64');
                fs.writeFileSync(path.join(OUT, `${key}-${suffix}.webp`), buf);
                bytes += buf.length;
            }
        }
    } finally {
        await browser.close();
    }
    const credits = Object.entries(PHOTOS).map(([key, p]) => ({ key, source: p.source, author: p.author, authorUrl: p.authorUrl, license: p.license, licenseUrl: p.licenseUrl, link: p.link }));
    fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 1));
    const md = ['# เครดิตรูปภาพ — เศรษฐี', '',
        'รูปถ่ายบนกระดานและในฉากของเกมเศรษฐี ครอปและปรับสีให้เป็นชุดเดียวกัน (ปรับความอิ่ม/คอนทราสต์ อุ่นทอง ขอบมืดจาง ๆ)',
        'รูปจาก Unsplash ใช้ภายใต้ Unsplash License · รูปจาก Wikimedia Commons ใช้ตามสัญญาอนุญาตที่ระบุ (ไฟล์ดัดแปลงอยู่ภายใต้สัญญาอนุญาตเดียวกัน)', '',
        '| รูป | ที่มา | ผู้ถ่าย | สัญญาอนุญาต |', '|---|---|---|---|',
        ...credits.map(c => `| ${c.key} | [${c.source}](${c.link}) | ${c.authorUrl ? `[${c.author}](${c.authorUrl})` : c.author} | [${c.license}](${c.licenseUrl}) |`), ''];
    fs.writeFileSync(path.join(OUT, 'CREDITS.md'), md.join('\n'));
    console.log(`wrote ${Object.keys(PHOTOS).length * 2} photos (${(bytes / 1024).toFixed(0)} KB) → ${OUT}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
