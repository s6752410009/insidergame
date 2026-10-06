/**
 * เศรษฐี ในเบราว์เซอร์จริง: มือถือ 3 เครื่อง (390×844) + เดสก์ท็อป 1 เครื่อง (1280×900) เล่นผ่าน UI
 *  - ทอย/ซื้อ/จบเทิร์นด้วยปุ่มจริง · ไม่ซื้อ → ประมูล (กดเสนอราคาจากหลายเครื่อง) · เทรดผ่านชีต → อีกฝ่ายกดรับ
 *  - จำนอง/ไถ่ถอนผ่านชีตทรัพย์สิน · แตะช่องดูโฉนด · หัวห้องจบเกม → โพเดียม
 *  - ถ่ายภาพทุกฉาก (cutscene) ผ่าน __setthi.demo เพื่อดูด้วยตา
 * ตรวจ: ไม่มี page error / console error · ไม่มี scroll แนวนอน · ไม่มีข้อความล้นจอ
 *
 * รัน: npm run smoke:setthi:browser   (SMOKE_PORT=8851, SHOTS_DIR=<โฟลเดอร์ภาพ>)
 */
const path = require('path');
const fs = require('fs');

if (!process.env.GAME_DATA_DIR) {
    const dir = path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', `browser-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    process.env.GAME_DATA_DIR = dir;
    process.env.WALLETS_FILE = path.join(dir, 'wallets.json');
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const PORT = Number(process.env.SMOKE_PORT) || 8851;
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, '..', '..', '..', 'newgames', 'setthi');
fs.mkdirSync(SHOTS, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }
const IGNORE = /favicon|manifest|service-worker|sourcemap|net::ERR_INTERNET|autoplay|play\(\) failed|AudioContext|preload|\.mp3|fonts\.g/i;

// ไฟล์จาก CDN (ฟอนต์ Google, Font Awesome, SweetAlert2) โหลดครั้งเดียวแล้วเก็บไว้ในเครื่อง — เทสไม่ขึ้นกับเน็ตภายนอก
const crypto = require('crypto');
const CDN_RE = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;
const CDN_CACHE = process.env.CDN_CACHE_DIR || path.join(__dirname, '..', '..', '..', 'tmpdata-setthi', 'cdn-cache');
fs.mkdirSync(CDN_CACHE, { recursive: true });
async function cdnRoute(route) {
    const url = route.request().url();
    const key = crypto.createHash('sha1').update(url).digest('hex');
    const bodyFile = path.join(CDN_CACHE, key + '.bin');
    const metaFile = path.join(CDN_CACHE, key + '.json');
    if (fs.existsSync(bodyFile) && fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        await route.fulfill({ status: 200, contentType: meta.contentType, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(bodyFile) });
        return;
    }
    try {
        const resp = await route.fetch({ timeout: 20000 });
        const body = await resp.body();
        if (resp.status() === 200) {
            fs.writeFileSync(bodyFile, body);
            fs.writeFileSync(metaFile, JSON.stringify({ url, contentType: resp.headers()['content-type'] || 'application/octet-stream' }));
        }
        await route.fulfill({ response: resp, body });
    } catch (error) {
        await route.abort().catch(() => {});
    }
}

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            SETTHI_TURN_MS: '40000',
            SETTHI_AUCTION_START_MS: '7000',
            SETTHI_AUCTION_MS: '4500',
            SETTHI_TRADE_MS: '40000',
            // ทอยแรก ๆ ตกที่ดินว่างแน่นอน (ไม่ผ่านช่องการ์ด) ที่เหลือสุ่ม
            SETTHI_DICE: '12,34,45,24,13,14,23,12'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + logs.slice(-500))); });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }

async function layoutProblems(page) {
    return page.evaluate(() => {
        const out = [];
        const vw = window.innerWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push('scroll แนวนอน ' + document.documentElement.scrollWidth + ' > ' + vw);
        const skip = e => e.closest('.st-cam, .st-board, .st-tokens, #stFx, .st-sidebar:not(.open), #chatBox, .swal2-container, #ppTermsBar, .st-sheet:not(.is-open), .st-trade-who, .st-toast');
        document.querySelectorAll('#stRoot *, #stDock *, #stSheet.is-open *, #stEnd.is-on *').forEach(e => {
            if (skip(e)) return;
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const st = getComputedStyle(e);
            if (st.visibility === 'hidden' || st.display === 'none') return;
            if (r.right > vw + 1 || r.left < -1) out.push('ล้นจอ: ' + (e.id || e.className || e.tagName) + ' ' + Math.round(r.left) + '–' + Math.round(r.right));
            if (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 1
                && st.overflow !== 'hidden' && st.textOverflow !== 'ellipsis' && st.overflowX !== 'auto') {
                const p = e.parentElement;
                const ps = p && getComputedStyle(p);
                if (!(ps && (ps.textOverflow === 'ellipsis' || ps.overflow === 'hidden'))) out.push('ข้อความล้น: ' + (e.className || e.tagName) + ' "' + e.textContent.trim().slice(0, 24) + '"');
            }
        });
        return [...new Set(out)].slice(0, 8);
    });
}

async function openPlayer(browser, base, id, viewport, label, roomId, extra = {}) {
    const mobile = viewport.width < 600;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile, ...extra });
    await context.route(CDN_RE, cdnRoute);
    context.setDefaultTimeout(45000);
    context.setDefaultNavigationTimeout(60000);
    await context.addInitScript(() => {
        try {
            sessionStorage.setItem('insiderPromoSeen', '1');
            localStorage.setItem('ig-firstplay-setthi', '1');
            localStorage.setItem('setthiSound', 'off');
        } catch (e) { /* ignore */ }
    });
    const page = await context.newPage();
    const errors = [];
    let prevUrl = '';
    let curUrl = '';
    page.on('framenavigated', f => { if (f === page.mainFrame()) { prevUrl = curUrl; curUrl = f.url(); } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {
        if (m.type() !== 'error' || IGNORE.test(m.text())) return;
        if (/beforeunload/.test(m.text()) && /\/room\//.test(prevUrl)) return;
        errors.push('console: ' + m.text().slice(0, 80) + ' @ ' + page.url());
    });
    page.on('requestfailed', r => { if (!IGNORE.test(r.url())) errors.push('requestfailed: ' + r.url()); });
    await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${base}/game/${roomId}?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#stBoard .st-cell', { timeout: 15000 });
    await page.waitForTimeout(400);
    return { context, page, errors, label, id };
}

const state = p => p.page.evaluate(() => window.__setthi.state());
const busy = p => p.page.evaluate(() => window.__setthi.queueLength());
async function skipAll(players) {
    for (let i = 0; i < 60; i += 1) {
        let total = 0;
        for (const p of players) {
            await p.page.evaluate(() => window.__setthi.skip());
            total += await busy(p);
        }
        if (!total) return;
        await delay(120);
    }
}
/** คลิกถ้าปุ่มอยู่ เห็นได้ และกดได้ · ใช้ locator (หาใหม่ทุกครั้ง) เพราะแผงล่างวาดใหม่ทุกครั้งที่ state เปลี่ยน */
async function clickIf(p, sel) {
    const loc = p.page.locator(sel).first();
    try {
        if (!(await loc.count())) return false;
        if (!(await loc.isVisible()) || (await loc.isDisabled())) return false;
        await loc.click({ timeout: 3000 });
        return true;
    } catch (error) {
        // ปุ่มถูกวาดใหม่/หายไประหว่างทาง = รอบนี้ยังกดไม่ได้ ลองใหม่รอบหน้า
        if (process.env.DEBUG_SETTHI) console.log('   click skip', sel, p.label, error.message.split('\n')[0]);
        return false;
    }
}
async function shot(p, name) {
    await p.page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 60000 });
}

async function main() {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch();
    const started = Date.now();
    const report = {};
    try {
        // ---------- ตั้งห้อง 4 คน ----------
        const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const sockets = [];
        for (const id of ids) {
            const s = await conn(base);
            s.emit('initPlayer', id);
            sockets.push(s);
        }
        await delay(500);
        const created = await ack(sockets[0], 'createRoom', { playerId: ids[0], name: 'วงเศรษฐี', gameMode: 'setthi', maxPlayers: 6, setthiMinutes: 30 });
        assert(created && created.success, 'สร้างห้องได้');
        const roomId = created.roomId;
        sockets[0].emit('setRoom', { roomId, playerId: ids[0] });
        for (let i = 1; i < 4; i += 1) {
            const r = await ack(sockets[i], 'joinRoom', { roomId, playerId: ids[i] });
            assert(r && r.success, 'join ได้');
            sockets[i].emit('setRoom', { roomId, playerId: ids[i] });
        }
        await delay(300);
        const st = await ack(sockets[0], 'startGameFromLobby', { roomId });
        assert(st && st.success, 'เริ่มเกมได้');
        await delay(3600);

        const phones = [];
        for (let i = 0; i < 3; i += 1) phones.push(await openPlayer(browser, base, ids[i], { width: 390, height: 844 }, 'phone' + (i + 1), roomId));
        const desk = await openPlayer(browser, base, ids[3], { width: 1280, height: 900 }, 'desktop', roomId);
        const players = [...phones, desk];
        sockets.forEach(s => s.close());
        await delay(800);
        await skipAll(players);
        await delay(600);
        await shot(phones[0], 'board-mobile');
        await shot(desk, 'board-desktop');
        for (const p of players) {
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} layout ตอนเริ่ม: ${probs.join(' | ')}`);
        }
        console.log('1. 4 คนเปิดกระดาน (3 มือถือ + เดสก์ท็อป) ไม่มี scroll แนวนอน/ข้อความล้น ✓');

        // แตะช่องดูโฉนด
        await phones[1].page.click('#stBoard .st-cell[data-i="39"]');
        await phones[1].page.waitForSelector('.st-sheet.is-open .st-deed', { timeout: 15000 });
        await delay(400);
        await shot(phones[1], 'sheet-deed');
        assert(/สุขุมวิท/.test(await phones[1].page.textContent('.st-sheet.is-open')), 'โฉนดสุขุมวิท');
        await phones[1].page.click('.st-sheet.is-open .st-sheet-close');
        console.log('2. แตะช่องเปิดโฉนด ✓');

        // ---------- เล่นจริงผ่าน UI ----------
        let auctionDone = false;
        let auctionShot = false;
        let tradeDone = false;
        let mortgageDone = false;
        let bidRound = 0;
        let auctionId = null;
        let auctionBids = 0;
        let actions = 0;
        let rolls = 0;
        const deadline = Date.now() + 150000;
        let loops = 0;
        while (Date.now() < deadline) {
            const S = await state(phones[0]);
            loops += 1;
            if (process.env.DEBUG_SETTHI && loops % 15 === 0) console.log('   …', S.phase, (S.seats.find(x => x.playerId === S.phaseActor) || {}).name, 'rolls', rolls, 'auction', auctionDone, 'trade', tradeDone, 'owners', Object.values(S.props).filter(p => p.owner).length);
            if (S.phase === 'auction') {
                // เปิดชีตประมูลเองบนทุกเครื่อง แล้วผลัดกันกดเสนอ
                for (const p of players) {
                    if (!(await p.page.$('.st-sheet.is-open #stAuctionSec'))) {
                        if (!(await clickIf(p, '#stOpenAuction'))) await clickIf(p, '#stAuctionPill');
                    }
                }
                await delay(400);
                if (S.auction && S.auction.id !== auctionId) { auctionId = S.auction.id; auctionBids = 0; }
                const bidder = players[bidRound % players.length];
                bidRound += 1;
                const quick = await bidder.page.$$('.st-sheet.is-open .st-bid-row button:not([disabled])');
                if (quick.length && auctionBids < 4) {
                    const ok = await quick[Math.min(quick.length - 1, bidRound % 2)].click({ timeout: 3000 }).then(() => true, () => false);
                    if (ok) { auctionBids += 1; report.bids = (report.bids || 0) + 1; }
                }
                if (!auctionShot && bidRound >= 3) {
                    await delay(350);
                    await shot(phones[0], 'sheet-auction-mobile');
                    await shot(desk, 'sheet-auction-desktop');
                    auctionShot = true;
                }
                await delay(700);
                continue;
            }
            if (S.phase === 'finished') break;
            if (!auctionDone && (S.fx.some(f => f.kind === 'auctionEnd' && f.winner) || S.history.some(h => h.kind === 'auctionWon'))) auctionDone = true;

            // เทรด: เมื่อมีอย่างน้อยสองคนมีที่ดินแล้ว
            if (!tradeDone && auctionDone) {
                const owners = {};
                Object.keys(S.props).forEach(k => { if (S.props[k].owner) (owners[S.props[k].owner] = owners[S.props[k].owner] || []).push(Number(k)); });
                const proposer = players.find(p => owners[p.id]);
                const target = players.find(p => p !== proposer && owners[p.id]);
                if (proposer && target && S.phase !== 'auction') {
                    await skipAll(players);
                    await proposer.page.click('#stTradeBtn', { timeout: 15000 });
                    await proposer.page.waitForSelector('.st-sheet.is-open .st-trade-grid', { timeout: 15000 }).catch(async e => {
                        await shot(proposer, 'debug-trade');
                        console.log('   debug', proposer.label, await proposer.page.evaluate(() => ({ html: (document.querySelector('#stSheetCard') || {}).innerHTML.slice(0, 300), open: document.querySelector('#stSheet').className })));
                        throw e;
                    });
                    await proposer.page.click(`.st-trade-who button[data-to="${target.id}"]`);
                    await proposer.page.click(`.st-pick[data-side="give"][data-sq="${owners[proposer.id][0]}"]`);
                    await proposer.page.click(`.st-pick[data-side="get"][data-sq="${owners[target.id][0]}"]`);
                    await proposer.page.click('.st-cash-input button[data-cash="give"][data-d="50"]');
                    await delay(300);
                    await shot(proposer, 'sheet-trade-' + (proposer === desk ? 'desktop' : 'mobile'));
                    const probs = await layoutProblems(proposer.page);
                    assert(!probs.length, 'ชีตเทรดไม่ล้น: ' + probs.join(' | '));
                    await proposer.page.click('#stTradeSend');
                    await target.page.waitForFunction(() => document.querySelector('.st-sheet.is-open #stOfferAccept') || document.querySelector('[id^="stViewDeal"]'), null, { timeout: 15000 });
                    if (!(await target.page.$('.st-sheet.is-open #stOfferAccept'))) await target.page.click('[id^="stViewDeal"]');
                    await target.page.waitForSelector('.st-sheet.is-open #stOfferAccept', { timeout: 15000 });
                    await delay(300);
                    await shot(target, 'sheet-offer-' + (target === desk ? 'desktop' : 'mobile'));
                    await target.page.click('#stOfferAccept');
                    await target.page.waitForFunction(() => document.querySelector('.st-shake'), null, { timeout: 15000 });
                    await delay(500);
                    await shot(target, 'cut-trade-live');
                    await delay(1500);
                    const after = await state(target);
                    assert(after.props[owners[proposer.id][0]].owner === target.id && after.props[owners[target.id][0]].owner === proposer.id, 'เทรดผ่าน UI สลับที่ดิน');
                    tradeDone = true;
                    console.log('4. เทรดผ่านชีต (เลือกคน · ให้/ได้ · เงิน) → อีกฝ่ายกดรับ → จับมือ ✓');
                    continue;
                }
            }

            // ตาของใคร → กดปุ่มบนเครื่องคนนั้น
            const actor = players.find(p => p.id === S.phaseActor);
            if (!actor) { await delay(200); continue; }
            if (await busy(actor)) { await actor.page.evaluate(() => window.__setthi.skip()); await delay(150); continue; }

            // จำนอง/ไถ่ถอนผ่าน UI ตอนถึงตาและมีที่ดิน
            const mine = Object.keys(S.props).filter(k => S.props[k].owner === actor.id);
            if (!mortgageDone && mine.length && ['roll', 'manage'].includes(S.phase)) {
                await actor.page.click('#stPropsBtn', { timeout: 15000 });
                await actor.page.waitForSelector('.st-sheet.is-open [data-act="mortgage"]:not([disabled])', { timeout: 15000 });
                await delay(250);
                await shot(actor, 'sheet-props-' + (actor === desk ? 'desktop' : 'mobile'));
                const cash0 = S.seats.find(s => s.playerId === actor.id).cash;
                await actor.page.click('.st-sheet.is-open [data-act="mortgage"]:not([disabled])');
                await actor.page.waitForSelector('.st-sheet.is-open [data-act="unmortgage"]:not([disabled])', { timeout: 15000 });
                const mid = await state(actor);
                assert(mid.seats.find(s => s.playerId === actor.id).cash > cash0, 'จำนองได้เงิน');
                await actor.page.click('.st-sheet.is-open [data-act="unmortgage"]:not([disabled])');
                await actor.page.waitForSelector('.st-sheet.is-open [data-act="mortgage"]:not([disabled])', { timeout: 15000 });
                await actor.page.click('.st-sheet.is-open .st-sheet-close');
                mortgageDone = true;
                console.log('3. จำนอง → ไถ่ถอนผ่านชีตทรัพย์สิน ✓');
                continue;
            }

            let did = false;
            if (await clickIf(actor, '#stRollBtn')) { did = true; rolls += 1; }
            else if (await actor.page.$('#stBuyBtn')) {
                // ไม่ซื้อจนกว่าจะได้ประมูลที่มีผู้ชนะอย่างน้อยหนึ่งครั้ง
                if (!auctionDone) did = await clickIf(actor, '#stDeclineBtn');
                else did = (await clickIf(actor, '#stBuyBtn')) || (await clickIf(actor, '#stDeclineBtn'));
            } else if (await clickIf(actor, '#stEndTurnBtn')) did = true;
            else if (await clickIf(actor, '#stPayJailBtn')) did = true;
            else if (S.phase === 'debt') {
                await clickIf(actor, '#stDebtBtn');
                await delay(300);
                did = (await clickIf(actor, '.st-sheet.is-open [data-act="sell"]:not([disabled])')) || (await clickIf(actor, '.st-sheet.is-open [data-act="mortgage"]:not([disabled])'));
            }
            if (did) actions += 1;
            if (did && actions % 6 === 0) {
                for (const p of players) {
                    const probs = await layoutProblems(p.page);
                    assert(!probs.length, `${p.label} layout กลางเกม: ${probs.join(' | ')}`);
                }
            }
            if (auctionDone && tradeDone && mortgageDone && rolls >= 12) break;
            await delay(did ? 350 : 200);
        }
        assert(auctionDone, 'มีการประมูลจบด้วยผู้ชนะ (ผ่าน UI)');
        assert(tradeDone && mortgageDone, 'ทำเทรดและจำนองผ่าน UI');
        assert(rolls >= 12, 'ทอยผ่านปุ่มอย่างน้อย 12 ครั้ง (' + rolls + ')');
        console.log(`5. เล่นจริงผ่านปุ่ม ${actions} ครั้ง (ทอย ${rolls}) · ประมูลผ่านชีตเสนอราคา ${report.bids || 0} ครั้ง ✓`);

        // ---------- กดค้างทอย: เข็มแรง · ช่องเขียว · ทอยแรงสุด ----------
        async function waitMyRoll(p) {
            for (let i = 0; i < 200; i += 1) {
                const S2 = await state(p);
                if (S2.phase === 'roll' && S2.phaseActor === p.id && !(await busy(p))) {
                    const b = await p.page.$('#stRollBtn:not([disabled])');
                    if (b) return S2;
                }
                const actor = players.find(x => x.id === S2.phaseActor);
                if (S2.phase === 'auction') { await delay(600); continue; }
                if (actor && actor !== p) {
                    if (await busy(actor)) await actor.page.evaluate(() => window.__setthi.skip());
                    else if (!(await clickIf(actor, '#stRollBtn')) && !(await clickIf(actor, '#stBuyBtn')) && !(await clickIf(actor, '#stDeclineBtn')) && !(await clickIf(actor, '#stEndTurnBtn'))) await clickIf(actor, '#stPayJailBtn');
                } else if (actor === p) {
                    if (await busy(p)) await p.page.evaluate(() => window.__setthi.skip());
                    else if (!(await clickIf(p, '#stBuyBtn')) && !(await clickIf(p, '#stEndTurnBtn'))) await clickIf(p, '#stPayJailBtn');
                }
                await delay(250);
            }
            throw new Error('ไม่ถึงตาทอยของ ' + p.label);
        }
        /** กดค้าง · ถ้า wantGreen ยกเลิก (เลื่อนนิ้วออก) แล้วกดใหม่จนกว่าจะมีช่องเขียว · ให้หน้าเว็บปล่อยเองตามเวลาเป้า */
        async function holdTo(p, target, opts = {}) {
            for (let attempt = 0; attempt < 16; attempt += 1) {
                const box = await p.page.locator('#stRollBtn').boundingBox();
                await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await p.page.mouse.down();
                await p.page.waitForFunction(() => { const h = window.__setthi.hold(); return h && h.meter; }, null, { timeout: 15000 });
                const meter = await p.page.evaluate(() => window.__setthi.hold().meter);
                if (target === 'green' && !meter.green) {
                    await p.page.waitForSelector('#stMeter.is-on', { timeout: 15000 });
                    await p.page.mouse.move(box.x + box.width / 2, box.y - 400, { steps: 4 }); // นิ้วเลื่อนออก = ยกเลิก
                    await p.page.mouse.up();
                    await p.page.waitForFunction(() => !window.__setthi.hold(), null, { timeout: 15000 });
                    await delay(250);
                    continue;
                }
                await p.page.waitForSelector('#stMeter.is-on', { timeout: 15000 });
                if (opts.midShot && meter.green) {
                    await p.page.waitForFunction(() => document.querySelector('#stMeter.has-green'), null, { timeout: 4000 });
                    await delay(140);
                    await shot(p, 'hold-green-pop');
                } else if (opts.midShot) {
                    await delay(opts.midShot);
                    await shot(p, 'hold-meter');
                }
                const result = await p.page.evaluate(t => new Promise(resolve => {
                    const h = window.__setthi.hold();
                    const m = h.meter;
                    const pos = x => (1 - Math.cos(2 * Math.PI * x / m.period)) / 2;
                    const now0 = performance.now() - h.t0 + 40;
                    let at = null;
                    if (t === 'green') {
                        const g = m.green;
                        for (let x = Math.max(now0, g.appearAt + 20); x < g.until - 25; x += 2) {
                            if (Math.abs(pos(x) - g.center) <= g.width * 0.25) { at = x; break; }
                        }
                    } else {
                        const base = Math.acos(1 - 2 * t) * m.period / (2 * Math.PI);
                        at = base;
                        while (at < now0) at += m.period;
                    }
                    if (at === null) { resolve({ miss: true }); return; }
                    const step = () => {
                        const e = performance.now() - h.t0;
                        if (e >= at) {
                            window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', bubbles: true }));
                            resolve({ elapsed: e, at, green: m.green, period: m.period, fxSeq: window.__setthi.state().fxSeq });
                        } else requestAnimationFrame(step);
                    };
                    requestAnimationFrame(step);
                }), target);
                await p.page.mouse.up();
                if (result.miss) { await p.page.waitForFunction(() => !window.__setthi.hold(), null, { timeout: 15000 }).catch(() => {}); continue; }
                return result;
            }
            throw new Error('กดค้างแล้วไม่ได้ช่องเขียวเลย');
        }
        await skipAll(players);
        await waitMyRoll(phones[0]);
        // ภาพเข็มกลางการชาร์จ (ครั้งที่ไม่สนช่องเขียว) แล้วยกเลิกด้วยการเลื่อนนิ้วออก
        {
            const box = await phones[0].page.locator('#stRollBtn').boundingBox();
            await phones[0].page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await phones[0].page.mouse.down();
            await phones[0].page.waitForSelector('#stMeter.is-on', { timeout: 15000 });
            await delay(420);
            await shot(phones[0], 'hold-meter');
            await phones[0].page.mouse.move(box.x + box.width / 2, box.y - 400, { steps: 4 });
            await phones[0].page.mouse.up();
            await phones[0].page.waitForFunction(() => !window.__setthi.hold(), null, { timeout: 15000 });
            const S3 = await state(phones[0]);
            assert(S3.phase === 'roll' && S3.phaseActor === phones[0].id && !S3.turn.holding, 'เลื่อนนิ้วออก = ยกเลิก ยังไม่ทอย');
            await delay(300);
        }
        // ปล่อยในช่องเขียวระหว่างที่โผล่ · ถ้าเครื่องช้าจนเซิร์ฟเวอร์หนีบเวลา (ตามกติกา) ลองตาถัดไป
        let perfectSeen = false;
        for (let attempt = 0; attempt < 4 && !perfectSeen; attempt += 1) {
            if (attempt) { await skipAll(players); await waitMyRoll(phones[0]); }
            const g = await holdTo(phones[0], 'green', { midShot: attempt === 0 });
            const fxOf = async () => (await state(phones[0])).fx.filter(f => f.kind === 'dice' && f.playerId === phones[0].id).pop();
            await phones[0].page.waitForFunction(seqBefore => { const S4 = window.__setthi.state(); return S4.fx.some(f => f.kind === 'dice' && f.seq > seqBefore); }, g.fxSeq || 0, { timeout: 15000 }).catch(() => {});
            const gfx = await fxOf();
            const used = gfx && gfx.elapsed;
            const sched = g.green;
            const posAt = t => (1 - Math.cos(2 * Math.PI * t / g.period)) / 2;
            const shouldHit = used !== undefined && used >= sched.appearAt && used <= sched.until && Math.abs(posAt(used) - sched.center) <= sched.width / 2;
            assert(!!(gfx && gfx.perfect) === shouldHit, `เซิร์ฟเวอร์ตัดสินช่องเขียวตามตารางเดียวกัน (ใช้ ${used}ms, เป๊ะ=${gfx && gfx.perfect})`);
            if (gfx && gfx.perfect) {
                await phones[0].page.waitForSelector('.st-perfect', { timeout: 15000 });
                await delay(480);
                await shot(phones[0], 'hold-perfect');
                perfectSeen = true;
            } else if (process.env.DEBUG_SETTHI) console.log('   green retry: claimed', Math.round(g.elapsed), 'used', used);
        }
        assert(perfectSeen, 'ปล่อยในช่องเขียวผ่านปุ่มจริง = เป๊ะ!');
        await skipAll(players);
        await waitMyRoll(phones[0]);
        await holdTo(phones[0], 0.999);
        await delay(520);
        await shot(phones[0], 'hold-max-throw');
        const afterMax = await state(phones[0]);
        const mfx = afterMax.fx.filter(f => f.kind === 'dice' && f.playerId === phones[0].id).pop();
        assert(mfx && mfx.power >= 0.95, 'ปล่อยตอนเข็มสุด = แรงสุด (' + (mfx && mfx.power) + ')');
        for (const p of players) assert(!(await layoutProblems(p.page)).length, p.label + ' layout หลังกดค้าง');
        console.log(`5b. กดค้างทอยผ่านปุ่มจริง: เข็มแกว่ง · ปล่อยในช่องเขียว = เป๊ะ! · ปล่อยตอนสุด = แรง ${mfx.power} ✓`);

        // ---------- ภาพทุกฉาก ----------
        await skipAll(players);
        const p0 = phones[0];
        const S = await state(p0);
        const me = p0.id;
        const other = phones[1].id;
        const posMe = S.seats.find(s => s.playerId === me).pos;
        const scenes = {
            dice: [[{ kind: 'dice', playerId: me, d: [6, 6], doubles: true }], [650, 1250]],
            move: [[{ kind: 'move', playerId: me, from: posMe, to: (posMe + 8) % 40, steps: 8, path: Array.from({ length: 8 }, (_, k) => (posMe + k + 1) % 40), passGo: false }], [700]],
            salary: [[{ kind: 'move', playerId: me, from: 37, to: 2, steps: 5, path: [38, 39, 0, 1, 2], passGo: true }], [1000]],
            card: [[{ kind: 'card', playerId: me, deck: 'fortune', card: { id: 'f07', deck: 'fortune', title: 'วันเกิดคุณ!', text: 'เพื่อนทุกคนให้ซองคนละ ฿10', icon: 'gift' } }], [320, 900]],
            buy: [[{ kind: 'buy', playerId: me, square: 37, price: 360, cash: {} }], [700, 1150]],
            rent: [[{ kind: 'rent', from: other, to: me, amount: 620, square: 39, cash: {} }], [550]],
            build: [[{ kind: 'build', playerId: me, square: 26, houses: 3, cost: 150, cash: {} }], [450]],
            hotel: [[{ kind: 'build', playerId: me, square: 29, houses: 5, cost: 150, cash: {} }], [1000]],
            set: [[{ kind: 'set', playerId: me, group: 'g7' }], [700]],
            jail: [[{ kind: 'jail', playerId: me, from: 30, reason: 'ตกช่องไปคุก' }], [1250]],
            auction: [[{ kind: 'auctionStart', square: 34 }], [750]],
            sold: [[{ kind: 'auctionEnd', square: 34, winner: other, amount: 410, cash: {} }], [700]],
            trade: [[{ kind: 'trade', from: me, to: other, give: { cash: 150, props: [26], jailCards: 0 }, get: { cash: 0, props: [16, 18], jailCards: 0 }, cash: {} }], [800]],
            bankrupt: [[{ kind: 'bankrupt', playerId: phones[2].id, creditor: me, squares: [], cash: {} }], [800, 1550]],
            timeup: [[{ kind: 'timeUp' }], [500]]
        };
        for (const [name, [list, times]] of Object.entries(scenes)) {
            await p0.page.evaluate(l => window.__setthi.demo(l), list);
            let lastT = 0;
            for (const t of times) {
                await delay(t - lastT);
                lastT = t;
                await shot(p0, `cut-${name}-${t}`);
            }
            await skipAll([p0]);
            await delay(300);
        }
        await desk.page.evaluate(l => window.__setthi.demo(l), scenes.card[0]);
        await delay(900);
        await shot(desk, 'cut-card-desktop');
        await skipAll([desk]);
        console.log(`6. ถ่ายภาพฉาก ${Object.keys(scenes).length} แบบ ✓`);

        // ---------- prefers-reduced-motion: ฉากสั้นลงเหลือสรุป ไม่มี error ----------
        const calm = phones[2];
        await calm.page.emulateMedia({ reducedMotion: 'reduce' });
        await calm.page.reload({ waitUntil: 'domcontentloaded' });
        await calm.page.waitForSelector('#stBoard .st-cell', { timeout: 15000 });
        await delay(600);
        await skipAll([calm]);
        assert(await calm.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'จำลองลดการเคลื่อนไหวได้');
        const t0 = Date.now();
        await calm.page.evaluate(l => window.__setthi.demo(l), [...scenes.dice[0], ...scenes.move[0], ...scenes.rent[0], ...scenes.build[0]]);
        await calm.page.waitForFunction(() => window.__setthi.queueLength() === 0, null, { timeout: 10000 });
        assert(Date.now() - t0 < 4000, 'ลดการเคลื่อนไหว: ฉากจบเร็ว (' + (Date.now() - t0) + 'ms)');
        await calm.page.evaluate(l => window.__setthi.demo(l), scenes.card[0]);
        await delay(400);
        await shot(calm, 'reduced-motion-card');
        await skipAll([calm]);
        await calm.page.emulateMedia({ reducedMotion: 'no-preference' });
        console.log('6b. prefers-reduced-motion: ฉากสั้น อ่านการ์ดได้ ไม่มี error ✓');

        // ---------- หัวห้องจบเกม → โพเดียม ----------
        await skipAll(players);
        const hostPage = phones[0];
        await hostPage.page.click('#stMenuBtn');
        await hostPage.page.waitForSelector('#stSidebar.open #stEndBtn', { timeout: 15000 });
        await delay(300);
        await hostPage.page.click('#stEndBtn');
        await hostPage.page.waitForSelector('.swal2-confirm', { timeout: 15000 });
        await hostPage.page.click('.swal2-confirm');
        for (const p of players) await p.page.waitForSelector('#stEnd.is-on .st-podium', { timeout: 15000 });
        await delay(1300);
        await shot(phones[1], 'cut-podium-mobile');
        await shot(desk, 'cut-podium-desktop');
        for (const p of players) {
            const probs = await layoutProblems(p.page);
            assert(!probs.length, `${p.label} layout ตอนจบ: ${probs.join(' | ')}`);
        }
        const fin = await state(phones[1]);
        assert(fin.phase === 'finished' && fin.standings.length === 4, 'จบเกมมีอันดับครบ');
        console.log('7. หัวห้องจบเกม → โพเดียม + อันดับบนทุกเครื่อง ✓');

        // ---------- error ----------
        for (const p of players) assert(!p.errors.length, `${p.label} มี error: ${p.errors.slice(0, 3).join(' | ')}`);
        assert(!/\[setthi\][^\n]*failed/.test(server.logs()), 'เซิร์ฟเวอร์ไม่มี error ของเศรษฐี');
        console.log(`✅ setthi browser: ${checks} checks · ภาพที่ ${SHOTS} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
        await delay(300);
    }
}

main().then(() => process.exit(0)).catch(error => {
    console.error('❌ setthi browser:', error.stack || error.message);
    process.exit(1);
});
