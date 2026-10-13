/**
 * หน้า landing ของแต่ละเกม /games/:gameId — สำหรับคนที่ค้นเจอจาก Google
 *
 * - render ฝั่ง server ล้วน ไม่มี socket ไม่ต้องมีบัญชี (ไม่ผ่าน middleware identity)
 *   จึงต้องลงทะเบียนก่อน middleware ผูก playerId ใน app.js
 * - เนื้อหามาจาก games/seoContent.js · ภาพ OG 1200×630 อยู่ public/og/<id>.jpg (สร้างด้วย scripts/build-og-images.js)
 * - id ที่ไม่รู้จัก = 404 จริง (noindex) ไม่ใช่หน้า bootstrap 200
 */

const fs = require('fs');
const path = require('path');
const { getSeoGame, listSeoGames, CATEGORIES } = require('./seoContent');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SITE_NAME = 'Insider Game Thailand';

// ---------- ขนาดรูป (ใส่ width/height ให้ <img> กันหน้ากระตุก) ----------
const sizeCache = new Map();

function readJpegSize(buf) {
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xFF) { i += 1; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15 ยกเว้น DHT(C4) JPG(C8) DAC(CC)
        if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
    }
    return null;
}

function readSvgSize(text) {
    const head = text.slice(0, 600);
    const w = head.match(/\swidth="(\d+(?:\.\d+)?)"/);
    const h = head.match(/\sheight="(\d+(?:\.\d+)?)"/);
    if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
    const vb = head.match(/viewBox="[\d.\s-]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)"/);
    if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
    return null;
}

function imageSize(publicPath) {
    if (sizeCache.has(publicPath)) return sizeCache.get(publicPath);
    let size = null;
    try {
        const rel = publicPath.replace(/^\/(static|assets)\//, (m, dir) => (dir === 'assets' ? 'assets/' : ''));
        const file = path.join(PUBLIC_DIR, rel);
        if (/\.jpe?g$/i.test(file)) size = readJpegSize(fs.readFileSync(file));
        else if (/\.svg$/i.test(file)) size = readSvgSize(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        size = null;
    }
    size = size || { width: 1280, height: 720 };
    sizeCache.set(publicPath, size);
    return size;
}

function publicFileExists(publicPath) {
    const rel = publicPath.replace(/^\/static\//, '').replace(/^\/assets\//, 'assets/');
    return fs.existsSync(path.join(PUBLIC_DIR, rel));
}

// ภาพแชร์ของเกม: ใช้ภาพ OG 1200×630 ถ้าสร้างไว้แล้ว ไม่งั้นใช้ภาพปก (svg แชร์ไม่ขึ้น → ภาพรวมของเว็บ)
function shareImageFor(game) {
    if (publicFileExists(game.ogImage)) return { url: game.ogImage, width: 1200, height: 630 };
    if (/\.jpe?g$/i.test(game.cover)) return { url: game.cover, ...imageSize(game.cover) };
    return { url: '/static/image/title.jpg', width: null, height: null };
}

// ---------- JSON-LD ----------
function buildGameStructuredData(game, abs) {
    const pageUrl = abs(game.path);
    const share = shareImageFor(game);
    const videoGame = {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        '@id': `${pageUrl}#game`,
        name: game.name,
        alternateName: game.keywords.slice(0, 3),
        headline: game.h1,
        description: game.description,
        url: pageUrl,
        image: abs(share.url),
        inLanguage: 'th',
        genre: game.solo ? ['Puzzle', 'Card game'] : ['Party game', 'Social deduction', 'Board game'],
        gamePlatform: ['Web browser', 'Mobile web'],
        applicationCategory: 'Game',
        operatingSystem: 'Any (web browser)',
        playMode: game.solo ? 'SinglePlayer' : 'MultiPlayer',
        numberOfPlayers: {
            '@type': 'QuantitativeValue',
            minValue: game.players.min,
            maxValue: game.players.max
        },
        offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'THB',
            availability: 'https://schema.org/InStock',
            url: abs(game.playUrl)
        },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: abs('/') }
    };
    const faq = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: game.faq.map(item => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a }
        }))
    };
    const crumbs = [{ name: 'หน้าแรก', url: abs('/') }];
    if (game.solo) crumbs.push({ name: 'เล่นคนเดียว', url: abs('/solo') });
    crumbs.push({ name: game.name, url: pageUrl });
    const breadcrumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url }))
    };
    return [videoGame, faq, breadcrumb];
}

function buildGamePageSeo(game, abs) {
    const canonical = abs(game.path);
    const share = shareImageFor(game);
    return {
        title: game.title,
        description: game.description,
        keywords: game.keywords.join(', '),
        canonical,
        robots: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
        ogType: 'website',
        ogImage: abs(share.url),
        ogImageWidth: share.width,
        ogImageHeight: share.height,
        ogImageAlt: game.coverAlt,
        siteName: SITE_NAME,
        structuredData: buildGameStructuredData(game, abs)
    };
}

function cardFor(game) {
    return {
        id: game.id,
        name: game.name,
        emoji: game.emoji,
        players: game.playersLabel,
        path: game.path,
        category: game.category
    };
}

function registerSeoGameRoutes(app, { buildCanonicalUrl, buildId }) {
    const abs = p => buildCanonicalUrl(p);

    app.get('/games/:gameId', function(req, res) {
        const id = String(req.params.gameId || '');
        const game = getSeoGame(id) || getSeoGame(id.toLowerCase());
        res.set('Cache-Control', 'public, max-age=300');
        const allGames = listSeoGames().map(cardFor);

        if (!game) {
            return res.status(404).render('gamePage.ejs', {
                layout: false,
                notFound: true,
                game: null,
                allGames,
                categories: CATEGORIES,
                buildId,
                seo: {
                    title: 'ไม่พบเกมนี้ | Insider Game Thailand',
                    description: 'ไม่พบหน้าเกมที่ต้องการ เลือกดูเกมปาร์ตี้ออนไลน์ทั้งหมดของ insider-th.me',
                    canonical: abs('/'),
                    robots: 'noindex, follow',
                    structuredData: []
                }
            });
        }
        // URL ตัวพิมพ์ใหญ่ → ส่งไปตัวเล็ก (canonical เดียว)
        if (game.id !== id) return res.redirect(301, game.path);

        const similar = game.similar.map(getSeoGame).filter(Boolean).map(cardFor);
        const coverSize = imageSize(game.cover);
        return res.render('gamePage.ejs', {
            layout: false,
            notFound: false,
            game,
            similar,
            allGames,
            categories: CATEGORIES,
            coverSize,
            buildId,
            seo: buildGamePageSeo(game, abs)
        });
    });
}

module.exports = { registerSeoGameRoutes, buildGamePageSeo, imageSize, shareImageFor };
