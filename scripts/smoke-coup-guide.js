/**
 * วิธีเล่น Coup (หน้ารอห้อง + ในเกม) และคำสั่ง /m เฉลยทั้งโต๊ะ
 *
 * ครอบ:
 *   - ปุ่ม "วิธีเล่น" ในหน้ารอห้องมีสไตล์จริง ไม่ใช่ปุ่มดิบของเบราว์เซอร์
 *   - modal ใช้สกิน coup-guide-popup ทั้งสองที่ และมีการ์ดครบ 5 ใบ
 *   - /m ใช้ได้เฉพาะหัวหน้าห้อง/แอดมินเว็บ คนอื่นโดนปฏิเสธ
 *   - /m ไม่หลุดไปเป็นข้อความในแชท
 *
 * รัน: node scripts/smoke-coup-guide.js
 */
require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const delay = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m); }

async function getFreePort() {
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

function watchPage(page, label, errors) {
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
}

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();
    const errors = [];

    try {
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            players.push({ socket, id });
        }
        await delay(500);

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'CoupGuide', gameMode: 'coup', maxPlayers: 6
        });
        assert(created?.success, 'สร้างห้อง coup ไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(700);

        // ---------- 1. หน้ารอห้อง: ปุ่มวิธีเล่น ----------
        const lobby = await browser.newPage();
        watchPage(lobby, 'lobby', errors);
        await lobby.goto(`${base}/room/${roomId}?playerId=${players[0].id}`, { waitUntil: 'networkidle' });

        const btn = lobby.locator('#btnCoupHowTo');
        assert(await btn.isVisible(), 'ปุ่มวิธีเล่น Coup ไม่โผล่ในหน้ารอห้อง');

        const btnStyle = await btn.evaluate(el => {
            const s = getComputedStyle(el);
            return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, color: s.color, border: s.borderTopWidth };
        });
        // ปุ่มดิบของ chromium = พื้นเทาอ่อน ขอบมน 0 ตัวหนังสือดำ
        assert(btnStyle.radius !== '0px', `ปุ่มยังไม่มี border-radius (${btnStyle.radius}) = ยังเป็นปุ่มดิบ`);
        assert(btnStyle.bg.includes('124, 58, 237') || btnStyle.bg.includes('rgba(124'),
            `พื้นปุ่มไม่ใช่ธีมม่วง: ${btnStyle.bg}`);
        assert(btnStyle.color !== 'rgb(0, 0, 0)', `ตัวหนังสือปุ่มยังดำ = สไตล์ไม่ติด (${btnStyle.color})`);
        console.log(`1. ปุ่มวิธีเล่นในหน้ารอห้องมีสไตล์ธีมม่วง ✓  (${btnStyle.bg} r=${btnStyle.radius})`);

        // ---------- 2. modal หน้ารอห้อง ----------
        await btn.click();
        await lobby.waitForSelector('.coup-guide-popup', { timeout: 5000 });
        const lobbyModal = await lobby.evaluate(() => {
            const popup = document.querySelector('.coup-guide-popup');
            return {
                skin: !!popup,
                bg: getComputedStyle(popup).backgroundColor,
                cards: document.querySelectorAll('.cpg-card').length,
                imgs: document.querySelectorAll('.cpg-card-art').length,
                brokenImgs: Array.from(document.querySelectorAll('img.cpg-card-art'))
                    .filter(i => i.complete && i.naturalWidth === 0).length,
                hasBluff: !!document.querySelector('.cpg-bluff'),
                hasWarn: !!document.querySelector('.cpg-warn'),
                usesBlackMarketSkin: !!document.querySelector('.bm-guide-popup')
            };
        });
        assert(lobbyModal.cards === 5, `การ์ดในวิธีเล่นควรมี 5 ใบ ได้ ${lobbyModal.cards}`);
        assert(lobbyModal.imgs === 5, `การ์ดควรมีรูป/ไอคอนครบ 5 ได้ ${lobbyModal.imgs}`);
        assert(lobbyModal.brokenImgs === 0, `รูปการ์ดแตก ${lobbyModal.brokenImgs} ใบ`);
        assert(lobbyModal.hasBluff, 'ไม่มีกล่อง "โกหกได้" ซึ่งเป็นกลไกหลัก');
        assert(lobbyModal.hasWarn, 'ไม่มีคำเตือน 10 เหรียญ');
        assert(!lobbyModal.usesBlackMarketSkin, 'ยังใช้สกิน bm-guide-popup ของ Black Market อยู่');
        console.log(`2. modal หน้ารอห้อง: สกินม่วง การ์ด 5 ใบ รูปไม่แตก ✓  (${lobbyModal.bg})`);

        // คำไทยยาวๆ ไม่มีช่องว่างให้ตัด เคยล้นออกไปทับขอบการ์ด — วัดเป็น px ไม่ใช่ดูตา
        const overflow = await lobby.evaluate(() => {
            const worst = { px: 0, text: '' };
            document.querySelectorAll('.cpg-card').forEach(card => {
                const box = card.getBoundingClientRect();
                card.querySelectorAll('.cpg-card-body > *').forEach(el => {
                    const r = el.getBoundingClientRect();
                    const spill = Math.max(0, box.left - r.left) + Math.max(0, r.right - box.right);
                    if (spill > worst.px) { worst.px = Math.round(spill); worst.text = el.textContent.slice(0, 30); }
                });
            });
            return worst;
        });
        assert(overflow.px <= 1, `ข้อความล้นออกนอกกรอบการ์ด ${overflow.px}px → "${overflow.text}"`);
        console.log('3. ข้อความในการ์ดไม่ล้นกรอบ ✓');

        await lobby.click('.coup-guide-popup .swal2-confirm');
        await delay(300);

        // ---------- 3. เริ่มเกม ----------
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await delay(2000);

        const adminPage = await browser.newPage();
        watchPage(adminPage, 'board-admin', errors);
        await adminPage.goto(`${base}/game/${roomId}?playerId=${players[0].id}`, { waitUntil: 'networkidle' });
        await delay(1200);

        // แถบบนของกระดานต้องไม่โดนกฎซ่อนแบนเนอร์ของ layout กินไปด้วย
        const topbar = await adminPage.evaluate(() => {
            const own = document.querySelector('.cp-topbar');
            const banner = document.querySelector('.container-fluid > header');
            const btn = document.querySelector('#cpHowToOpen');
            return {
                ownVisible: !!own && getComputedStyle(own).display !== 'none',
                bannerHidden: !banner || getComputedStyle(banner).display === 'none',
                btnBox: btn ? btn.getBoundingClientRect().height : 0
            };
        });
        assert(topbar.ownVisible, 'แถบบนของกระดาน Coup ถูกซ่อน — ปุ่มวิธีเล่น/ผู้เล่น/จบเกม กดไม่ได้ทั้งแถว');
        assert(topbar.bannerHidden, 'แบนเนอร์ของ layout ควรถูกซ่อนตอนอยู่ในเกม');
        assert(topbar.btnBox > 0, 'ปุ่มวิธีเล่นในเกมสูง 0 = มองไม่เห็น');
        console.log('4. แถบบนกระดานโชว์ / แบนเนอร์ layout ถูกซ่อน ✓');

        // CSS กลาง (style.css ทาสี <header> ตามธีม, mobile.css บังคับ #toggleSidebarBtn เป็น fixed)
        // เคยเล่นงานแถบบนจนพื้นแดงและปุ่มผู้เล่นลอยไปทับปุ่มจบเกม — ห้ามกลับมาอีก
        const chipHealth = await adminPage.evaluate(() => {
            const bar = document.querySelector('.cp-topbar');
            const barBox = bar.getBoundingClientRect();
            const chips = Array.from(bar.querySelectorAll('.cp-meta > *')).map(el => {
                const r = el.getBoundingClientRect();
                return {
                    label: el.textContent.trim().slice(0, 12),
                    position: getComputedStyle(el).position,
                    escaped: r.right > barBox.right + 1 || r.left < barBox.left - 1
                        || r.top < barBox.top - 1 || r.bottom > barBox.bottom + 1
                };
            });
            return {
                isHeaderTag: bar.tagName.toLowerCase() === 'header',
                chips,
                // ปุ่มจบเกมต้องกดโดนจริง ไม่ใช่มีอะไรมาทับ
                endGameHitsItself: (() => {
                    const btn = document.querySelector('#cpEndGameBtn');
                    if (!btn) return true; // ไม่ใช่แอดมินก็ไม่มีปุ่ม ถือว่าผ่าน
                    const r = btn.getBoundingClientRect();
                    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    return btn.contains(top);
                })()
            };
        });
        assert(!chipHealth.isHeaderTag,
            'แถบบนกลับไปเป็น <header> แล้ว — style.css จะทาสีทับตามธีม (ธีมแดงกลายเป็นแถบแดง)');
        const floating = chipHealth.chips.filter(c => c.position === 'fixed' || c.position === 'absolute');
        assert(floating.length === 0,
            'ปุ่มบนแถบหลุดเป็น fixed/absolute: ' + floating.map(c => `${c.label}(${c.position})`).join(', '));
        const escaped = chipHealth.chips.filter(c => c.escaped);
        assert(escaped.length === 0, 'ปุ่มบนแถบหลุดออกนอกกรอบ: ' + escaped.map(c => c.label).join(', '));
        assert(chipHealth.endGameHitsItself, 'ปุ่มจบเกมมีอย่างอื่นทับอยู่ กดไม่โดน');
        console.log(`5. ปุ่มบนแถบอยู่ในกรอบครบ ${chipHealth.chips.length} ปุ่ม · ปุ่มจบเกมกดโดน ✓`);

        // ---------- 4. modal ในเกมใช้สกินเดียวกัน ----------
        await adminPage.click('#cpHowToOpen');
        await adminPage.waitForSelector('.coup-guide-popup', { timeout: 5000 });
        const boardModal = await adminPage.evaluate(() => ({
            cards: document.querySelectorAll('.cpg-card').length,
            realImgs: document.querySelectorAll('img.cpg-card-art').length,
            broken: Array.from(document.querySelectorAll('img.cpg-card-art'))
                .filter(i => i.complete && i.naturalWidth === 0).length
        }));
        assert(boardModal.cards === 5, `วิธีเล่นในเกมควรมีการ์ด 5 ใบ ได้ ${boardModal.cards}`);
        assert(boardModal.realImgs === 5, `ในเกมควรโชว์รูปการ์ดจริงครบ 5 ได้ ${boardModal.realImgs}`);
        assert(boardModal.broken === 0, `รูปการ์ดในเกมแตก ${boardModal.broken} ใบ`);
        console.log('6. modal ในเกมใช้สกินเดียวกัน + รูปการ์ดจริงครบ 5 ✓');

        await adminPage.click('.coup-guide-popup .swal2-confirm');
        await delay(300);

        // ---------- 5. /m ของหัวหน้าห้อง ----------
        await adminPage.evaluate(() => {
            if (!jQuery('#chatBox').is(':visible')) jQuery('#toggleChat').trigger('click');
        });
        await delay(300);
        await adminPage.fill('#chatInput', '/m');
        await adminPage.click('#sendChat');
        await adminPage.waitForSelector('.cpr', { timeout: 5000 });

        const reveal = await adminPage.evaluate(() => ({
            rows: document.querySelectorAll('.cpr-row').length,
            chips: document.querySelectorAll('.cpr-chip').length,
            turnBadges: document.querySelectorAll('.cpr-turn').length,
            hasCoins: document.querySelectorAll('.cpr-coins').length,
            foot: (document.querySelector('.cpr-foot') || {}).textContent || ''
        }));
        assert(reveal.rows === 3, `/m ควรโชว์ 3 คน ได้ ${reveal.rows}`);
        assert(reveal.chips === 6, `เริ่มเกมทุกคนถือ 2 ใบ = 6 chip ได้ ${reveal.chips}`);
        assert(reveal.turnBadges === 1, `ควรมีป้าย "ถึงตา" 1 อัน ได้ ${reveal.turnBadges}`);
        assert(reveal.hasCoins === 3, 'ไม่ได้โชว์เหรียญครบทุกคน');
        assert(/การ์ดในกอง/.test(reveal.foot), 'ไม่ได้บอกจำนวนการ์ดในกอง');
        console.log(`7. /m หัวหน้าห้องเห็นการ์ดครบ 3 คน 6 ใบ ✓  (${reveal.foot.trim()})`);

        await adminPage.click('.coup-guide-popup .swal2-confirm');
        await delay(300);

        // /m ต้องไม่หลุดเป็นข้อความในแชท
        const leakedForAdmin = await adminPage.evaluate(() =>
            Array.from(document.querySelectorAll('.chat-message-bubble')).some(b => b.textContent.includes('/m')));
        assert(!leakedForAdmin, '/m หลุดไปเป็นข้อความในแชทของแอดมินเอง');

        // ---------- 6. /m ของคนที่ไม่ใช่แอดมิน ----------
        const guestPage = await browser.newPage();
        watchPage(guestPage, 'board-guest', errors);
        await guestPage.goto(`${base}/game/${roomId}?playerId=${players[1].id}`, { waitUntil: 'networkidle' });
        await delay(1200);

        await guestPage.evaluate(() => {
            if (!jQuery('#chatBox').is(':visible')) jQuery('#toggleChat').trigger('click');
        });
        await delay(300);
        await guestPage.fill('#chatInput', '/m');
        await guestPage.click('#sendChat');
        await guestPage.waitForSelector('.swal2-popup', { timeout: 5000 });

        const denied = await guestPage.evaluate(() => ({
            text: (document.querySelector('.swal2-popup') || {}).textContent || '',
            leakedCards: document.querySelectorAll('.cpr-chip').length
        }));
        assert(/ใช้ไม่ได้|เฉพาะ/.test(denied.text), `คนธรรมดาไม่ได้เห็นข้อความปฏิเสธ: ${denied.text.slice(0, 80)}`);
        assert(denied.leakedCards === 0, 'คนธรรมดาเห็นการ์ดคนอื่นได้ — รั่ว!');
        console.log('8. /m ของคนที่ไม่ใช่แอดมิน โดนปฏิเสธ ไม่เห็นการ์ดใคร ✓');

        await guestPage.click('.swal2-confirm');
        await delay(400);
        const leakedForGuest = await guestPage.evaluate(() =>
            Array.from(document.querySelectorAll('.chat-message-bubble')).some(b => b.textContent.includes('/m')));
        assert(!leakedForGuest, '/m ของคนธรรมดาหลุดไปเป็นข้อความในแชท');

        // แชทปกติต้องยังส่งได้อยู่
        await guestPage.fill('#chatInput', 'สวัสดีครับ');
        await guestPage.click('#sendChat');
        await delay(700);
        const chatWorks = await guestPage.evaluate(() =>
            Array.from(document.querySelectorAll('.chat-message-bubble')).some(b => b.textContent.includes('สวัสดีครับ')));
        assert(chatWorks, 'แชทปกติส่งไม่ได้แล้ว — hook คำสั่งกินข้อความธรรมดาไปด้วย');
        console.log('9. แชทข้อความปกติยังส่งได้ ✓');

        assert(errors.length === 0, 'มี JS error:\n' + errors.join('\n'));
        console.log(`\n✅ วิธีเล่น Coup + /m ผ่านทั้งหมด (ไม่มี JS error)`);
    } finally {
        await browser.close();
        server.kill('SIGKILL');
    }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
