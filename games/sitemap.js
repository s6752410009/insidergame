/**
 * sitemap.xml แบบสร้างสด — หน้าหลัก, หน้าเกมทุกเกม (/games/<id>), เกมเล่นคนเดียว (/solo/<id>)
 *
 * lastmod เป็นวันที่ "เนื้อหาเปลี่ยน" จริง ไม่ใช่วัน deploy (Google เมิน lastmod ที่ขยับทุกครั้ง)
 *   - หน้าเกม: game.updated ใน seoContent.js ถ้ามี ไม่งั้น CONTENT_UPDATED
 *   - หน้าอื่น: PAGE_UPDATED ด้านล่าง
 * แก้เนื้อหาหน้าไหนอย่างมีนัย → ขยับวันที่ของหน้านั้น
 */

const { listSeoGames, CONTENT_UPDATED } = require('./seoContent');
const soloGames = require('./solo');

const PAGE_UPDATED = {
    '/': '2026-10-13',
    '/rooms': '2026-10-13',
    '/how-to-play': '2026-10-13',
    '/solo': '2026-10-13'
};

function escXml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function listSitemapEntries() {
    const entries = [
        { path: '/', changefreq: 'weekly', priority: '1.0' },
        { path: '/rooms', changefreq: 'daily', priority: '0.9' },
        { path: '/how-to-play', changefreq: 'weekly', priority: '0.8' },
        { path: '/solo', changefreq: 'weekly', priority: '0.7' }
    ].map(entry => ({ ...entry, lastmod: PAGE_UPDATED[entry.path] || CONTENT_UPDATED }));

    listSeoGames().forEach(game => {
        entries.push({
            path: game.path,
            lastmod: game.updated || CONTENT_UPDATED,
            changefreq: 'monthly',
            priority: game.solo ? '0.6' : '0.8'
        });
    });

    soloGames.listSoloGames().forEach(meta => {
        entries.push({ path: `/solo/${meta.id}`, lastmod: PAGE_UPDATED['/solo'], changefreq: 'monthly', priority: '0.5' });
    });
    return entries;
}

function buildSitemapXml(buildCanonicalUrl) {
    const urls = listSitemapEntries().map(entry => [
        '  <url>',
        `    <loc>${escXml(buildCanonicalUrl(entry.path))}</loc>`,
        `    <lastmod>${entry.lastmod}</lastmod>`,
        `    <changefreq>${entry.changefreq}</changefreq>`,
        `    <priority>${entry.priority}</priority>`,
        '  </url>'
    ].join('\n'));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

module.exports = { buildSitemapXml, listSitemapEntries };
