/**
 * SEO smoke — หน้าเกม /games/:gameId, หน้า hub และ sitemap
 *
 * HTTP (ไม่ต้องเปิดเบราว์เซอร์):
 *  - ทุก /games/<id> ตอบ 200 · title และ description ไม่ซ้ำกัน · H1 หนึ่งเดียว · canonical ถูก
 *  - og:image / twitter:image โหลดได้ เป็น JPEG 1200×630 · JSON-LD parse ได้ มี VideoGame + FAQPage + BreadcrumbList
 *  - ลิงก์ภายในทุกอันในหน้าเกมตอบ 200 · ลิงก์ "หน้าเกมนี้ →" ในหน้าวิธีเล่นตอบ 200 ทุกอัน
 *  - CTA ของเกมหลายคนชี้ /rooms?mode=<id> · เกมเล่นคนเดียวชี้ /solo/<id>
 *  - sitemap.xml มีทุกหน้า · id ที่ไม่รู้จัก = 404
 *  - หน้าแรก (มุมบอทค้นหา) มี H1 เดียว และลิงก์ไปทุกหน้าเกม
 * เบราว์เซอร์ (390×844):
 *  - กด CTA ของหน้าเกม → หน้าห้องเปิดขั้นตั้งค่าห้องโดยเลือกเกมนั้นไว้แล้ว
 *  - ภาพหน้าจอ 3 หน้า และไม่มีเลื่อนข้าง
 *
 * รัน: npm run smoke:seo
 *   BASE_URL=http://127.0.0.1:3961  ใช้เซิร์ฟเวอร์ที่รันอยู่แล้ว (ไม่ spawn เอง)
 *   SHOT_DIR=/path                    ที่เก็บภาพหน้าจอ (ค่าเริ่ม screenshots/seo)
 */

require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { listSeoGames } = require('../games/seoContent');

const PUBLIC_BASE = 'https://insider-th.me';
const SHOT_PAGES = ['/games/werewolf', '/games/setthi', '/games/wordle'];
const CTA_GAME = 'coup';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const failures = [];
function check(condition, message) {
    if (!condition) failures.push(message);
    return condition;
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function get(url, { userAgent } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { headers: userAgent ? { 'User-Agent': userAgent } : {} }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout ' + url)); });
    });
}

async function getFreePort() {
    return new Promise(resolve => {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function spawnServer() {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server startup timeout')), 30000);
        child.stdout.on('data', chunk => {
            if (String(chunk).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(); }
        });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); });
    });
    return { baseUrl: `http://127.0.0.1:${port}`, child };
}

function jpegSize(buf) {
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
    }
    return null;
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const meta = (html, attr, name) => {
    const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`));
    return m ? decode(m[1]) : null;
};
const toLocal = (url, baseUrl) => url.replace(PUBLIC_BASE, baseUrl);

async function checkHttp(baseUrl) {
    const games = listSeoGames();
    const titles = new Map();
    const descriptions = new Map();
    const internalLinks = new Set();

    for (const game of games) {
        const res = await get(baseUrl + game.path);
        const html = res.body.toString('utf8');
        const where = game.path;
        if (!check(res.status === 200, `${where}: status ${res.status}`)) continue;

        const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
        const description = meta(html, 'name', 'description');
        check(title && title.length <= 60, `${where}: title missing or > 60 chars`);
        check(description && description.length <= 155, `${where}: description missing or > 155 chars`);
        check(!titles.has(title), `${where}: title duplicates ${titles.get(title)}`);
        check(!descriptions.has(description), `${where}: description duplicates ${descriptions.get(description)}`);
        titles.set(title, where);
        descriptions.set(description, where);

        const h1Count = (html.match(/<h1[\s>]/g) || []).length;
        check(h1Count === 1, `${where}: ${h1Count} H1 (want 1)`);

        const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
        check(canonical === PUBLIC_BASE + game.path, `${where}: canonical ${canonical}`);

        const ogImage = meta(html, 'property', 'og:image');
        const twImage = meta(html, 'name', 'twitter:image');
        check(ogImage && ogImage === twImage, `${where}: og:image and twitter:image differ`);
        check(ogImage && ogImage.endsWith(`/static/og/${game.id}.jpg`), `${where}: og:image is not the game share image (${ogImage})`);
        if (ogImage) {
            const img = await get(toLocal(ogImage, baseUrl));
            const size = img.status === 200 ? jpegSize(img.body) : null;
            check(img.status === 200 && /image\/jpeg/.test(img.headers['content-type'] || ''), `${where}: og:image ${img.status}`);
            check(size && size.width === 1200 && size.height === 630, `${where}: og:image size ${JSON.stringify(size)}`);
        }

        const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
        let ld = null;
        try { ld = JSON.parse(ldMatch[1]); } catch (error) { ld = null; }
        if (check(Array.isArray(ld), `${where}: JSON-LD missing or does not parse`)) {
            const types = ld.map(item => item['@type']);
            ['VideoGame', 'FAQPage', 'BreadcrumbList'].forEach(type => check(types.includes(type), `${where}: JSON-LD has no ${type}`));
            const faq = ld.find(item => item['@type'] === 'FAQPage');
            check(faq && faq.mainEntity.length === game.faq.length, `${where}: FAQPage entries != FAQ on page`);
        }

        const cover = html.match(/<img src="([^"]+)" alt="([^"]+)" width="(\d+)" height="(\d+)" loading="lazy"/);
        check(cover && /[ก-๙]/.test(cover[2]), `${where}: cover needs Thai alt, width, height and loading=lazy`);

        const cta = html.match(/<a class="gp-cta" id="gpCta" href="([^"]+)"/);
        const wantCta = game.solo ? `/solo/${game.id}` : `/rooms?mode=${game.id}`;
        check(cta && decode(cta[1]) === wantCta, `${where}: CTA ${cta && cta[1]} (want ${wantCta})`);
        check(html.includes(`href="/how-to-play#${game.id}"`), `${where}: no "กฎละเอียด" link to /how-to-play#${game.id}`);
        check(/เกมที่คล้ายกัน/.test(html), `${where}: no similar games section`);

        for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
            internalLinks.add(decode(m[1]).split('#')[0] || '/');
        }
    }

    // ลิงก์ภายในทั้งหมดจากหน้าเกม
    for (const link of internalLinks) {
        const res = await get(baseUrl + link);
        check(res.status === 200, `internal link ${link}: ${res.status}`);
    }

    // หน้าวิธีเล่น: ลิงก์ "หน้าเกมนี้ →" ทุกอันต้องเปิดได้
    const howto = (await get(baseUrl + '/how-to-play')).body.toString('utf8');
    const howtoLinks = [...howto.matchAll(/<a class="hp-more" href="([^"]+)">หน้าเกมนี้/g)].map(m => decode(m[1]));
    check(howtoLinks.length >= 16, `how-to-play: only ${howtoLinks.length} "หน้าเกมนี้" links`);
    for (const link of howtoLinks) {
        const res = await get(baseUrl + link);
        check(res.status === 200, `how-to-play "หน้าเกมนี้" ${link}: ${res.status}`);
    }

    // id ที่ไม่รู้จัก
    for (const bad of ['/games/nope', '/games/werewolf2', '/games/%3Cscript%3E']) {
        const res = await get(baseUrl + bad);
        check(res.status === 404, `${bad}: status ${res.status} (want 404)`);
        check(/noindex/.test(res.body.toString('utf8')), `${bad}: 404 page should be noindex`);
    }

    // sitemap
    const sitemap = (await get(baseUrl + '/sitemap.xml')).body.toString('utf8');
    const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]));
    ['/', '/rooms', '/how-to-play', '/solo', ...games.map(g => g.path), ...games.filter(g => g.solo).map(g => `/solo/${g.id}`)]
        .forEach(p => check(locs.has(PUBLIC_BASE + p), `sitemap missing ${p}`));
    check(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap), 'sitemap has no lastmod');
    const robots = (await get(baseUrl + '/robots.txt')).body.toString('utf8');
    check(robots.includes(`Sitemap: ${PUBLIC_BASE}/sitemap.xml`), 'robots.txt has no Sitemap line');

    // หน้าแรกมุมบอทค้นหา
    const home = (await get(baseUrl + '/', { userAgent: GOOGLEBOT })).body.toString('utf8');
    const homeH1 = home.match(/<h1[^>]*>([^<]*)<\/h1>/g) || [];
    check(homeH1.length === 1 && /เกมปาร์ตี้ออนไลน์/.test(homeH1[0]), `home: H1 ${JSON.stringify(homeH1)}`);
    games.forEach(g => check(home.includes(`href="${g.path}"`), `home: no link to ${g.path}`));
    check(meta(home, 'property', 'og:image') === `${PUBLIC_BASE}/static/og/home.jpg`, 'home: og:image is not /static/og/home.jpg');

    console.log(`http: ${games.length} game pages, ${internalLinks.size} internal links, ${howtoLinks.length} how-to links, ${locs.size} sitemap URLs`);
}

async function checkBrowser(baseUrl, shotDir) {
    fs.mkdirSync(shotDir, { recursive: true });
    const browser = await chromium.launch();
    try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));

        for (const p of SHOT_PAGES) {
            await page.goto(baseUrl + p, { waitUntil: 'networkidle' });
            const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            check(sw <= 0, `${p}: horizontal scroll ${sw}px at 390px`);
            const file = path.join(shotDir, `game-${p.split('/').pop()}-390.png`);
            await page.screenshot({ path: file, fullPage: true });
            console.log('shot', file);
        }

        // CTA → หน้าห้องเปิดขั้นตั้งค่าโดยเลือกเกมไว้แล้ว
        await page.goto(`${baseUrl}/games/${CTA_GAME}`, { waitUntil: 'domcontentloaded' });
        await page.click('#gpCta');
        await page.waitForSelector('#selectedGameMode', { state: 'attached', timeout: 20000 });
        await delay(500);
        const state = await page.evaluate(() => ({
            mode: document.getElementById('selectedGameMode').value,
            path: location.pathname + location.search,
            setupVisible: (() => {
                const popup = document.querySelector('.room-popup');
                const pick = document.getElementById('gamePickStep');
                return Boolean(popup) && !popup.classList.contains('is-picking') && Boolean(pick && pick.hidden);
            })()
        }));
        check(state.mode === CTA_GAME, `CTA: selected mode ${state.mode} (want ${CTA_GAME})`);
        check(state.setupVisible, 'CTA: create popup did not jump to the setup step');
        check(!/mode=/.test(state.path), `CTA: ?mode= should be removed from the URL (${state.path})`);
        check(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    } finally {
        await browser.close();
    }
}

(async () => {
    let server = null;
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
        server = await spawnServer();
        baseUrl = server.baseUrl;
    }
    const shotDir = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots', 'seo');
    try {
        await checkHttp(baseUrl);
        await checkBrowser(baseUrl, shotDir);
    } finally {
        if (server) server.child.kill('SIGTERM');
    }
    if (failures.length) {
        console.error(`\nSEO smoke FAILED (${failures.length}):\n- ` + failures.join('\n- '));
        process.exit(1);
    }
    console.log('SEO smoke OK');
    process.exit(0);
})().catch(error => {
    console.error(error);
    process.exit(1);
});
