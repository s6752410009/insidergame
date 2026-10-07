/**
 * สายลับคำใบ้ — กติกาใหม่ในเบราว์เซอร์จริงที่ 390×844
 *   A) 2 คน โหมดร่วมมือ: ห้องรอบอกโหมด → ใบ้ → พลาด → หัวหน้าแตะปิดสายลับฝ่ายตรงข้าม · หัวหน้าแชทไม่ได้
 *   B) 4 คน: หัวหน้าอีกทีมกด 🚩 ทักคำใบ้ → จบเทิร์น → แตะปิดคำทีมตัวเอง (โบนัส)
 * เช็ก: ไม่มี JS error · ไม่ล้นจอ · ปุ่ม ≥44px
 * รัน: npm run smoke:codenames:rules:mobile
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
if (!process.env.GAME_DATA_DIR) {
    const base = path.join(__dirname, '..', '..', '..', 'tmpdata-codenames');
    fs.mkdirSync(base, { recursive: true });
    process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(base, 'browser-rules-'));
    process.on('exit', () => { try { fs.rmSync(process.env.GAME_DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
if (!process.env.WALLETS_FILE) process.env.WALLETS_FILE = path.join(process.env.GAME_DATA_DIR, 'wallets.json');
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const { WORDS } = require('../games/codenamesWords');
const engine = require('../games/codenamesEngine');

const SHOT_DIR = process.env.CODENAMES_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'codenames-rules-shots-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.CODENAMES_RULES_PORT) || 8823;
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(t); rej(new Error('server exited ' + code + '\n' + logs.slice(-600))); });
    });
}
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await delay(80); }
    throw new Error('รอไม่ถึง: ' + label);
}
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|ERR_INTERNET/i;

async function layoutProblems(page, rootSel) {
    return page.evaluate(sel => {
        const vw = window.innerWidth;
        const problems = [];
        if (document.documentElement.scrollWidth > vw + 1) problems.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + vw);
        const root = document.querySelector(sel);
        if (!root) return ['no root ' + sel];
        root.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || el.closest('[hidden]')) return;
            const inCard = el.closest('.cn-card-inner');
            if ((r.right > vw + 1 || r.left < -1) && !inCard) problems.push('offscreen ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
            const clipped = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis';
            if (!clipped && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline') {
                problems.push('text overflow ' + el.tagName + '.' + el.className + ' "' + (el.textContent || '').slice(0, 20) + '"');
            }
            if (el.classList.contains('cn-word') && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.parentElement.clientWidth)) {
                problems.push('word overflow "' + el.textContent + '" ' + el.scrollHeight + '>' + el.clientHeight);
            }
            if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && cs.display !== 'none' && r.height < 43.5 && !el.closest('.cn-card') && !el.closest('#chatBox')) {
                problems.push('small target ' + el.tagName + '#' + el.id + '.' + el.className + ' h=' + Math.round(r.height));
            }
        });
        // แชท/แถบล่างต้องไม่บังปุ่ม
        const chat = document.getElementById('toggleChat');
        if (chat && getComputedStyle(chat).display !== 'none') {
            const c = chat.getBoundingClientRect();
            root.querySelectorAll('button, input').forEach(b => {
                const r = b.getBoundingClientRect();
                if (!r.width || b.closest('[hidden]')) return;
                if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) problems.push('chat covers ' + (b.id || b.className));
            });
        }
        return problems.slice(0, 8);
    }, rootSel);
}

async function openPlayer(browser, base, label, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600 });
    await ctx.addInitScript(() => {
        try { sessionStorage.setItem('insiderPromoSeen', '1'); localStorage.setItem('ig-firstplay-codenames', '1'); } catch (e) { /* ignore */ }
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('[console] ' + m.text()); });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    const id = randomUUID();
    await page.goto(`${base}/?playerId=${id}`, { waitUntil: 'domcontentloaded' });
    await delay(400);
    return { ctx, page, id, label, errors };
}
async function shot(p, name, opts = {}) {
    const file = path.join(SHOT_DIR, name);
    await p.page.screenshot({ path: file, fullPage: !!opts.full });
    return file;
}
async function boardState(page) {
    return page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#cnBoard .cn-card')).map(el => ({
            i: Number(el.dataset.i),
            revealed: el.classList.contains('is-revealed'),
            key: (Array.from(el.classList).find(c => c.startsWith('key-')) || '').slice(4) || null,
            mine: el.classList.contains('is-mine')
        }));
        return {
            cards,
            finished: !document.getElementById('cnResult').hidden,
            title: document.getElementById('cnNowTitle').textContent,
            who: document.getElementById('cnNowWho').textContent
        };
    });
}


async function createRoom(host, base, extra = {}) {
    const created = await host.page.evaluate(async body => {
        const res = await fetch('/api/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
        return res.json();
    }, { name: 'สายลับคำใบ้', gameMode: 'codenames', maxPlayers: 12, codenamesClueSeconds: 120, codenamesGuessSeconds: 0, ...extra });
    assert(created && created.success && created.roomId, 'สร้างห้อง: ' + JSON.stringify(created));
    return created.roomId;
}
async function confirmSwal(page) {
    await page.waitForSelector('.swal2-confirm', { timeout: 5000 });
    await delay(350);
    await page.click('.swal2-confirm');
    await delay(400);
}
async function startFromLobby(host, all) {
    await waitFor(() => host.page.evaluate(() => !document.getElementById('btnStartGameLobby').disabled), 8000, 'start enabled');
    await host.page.click('#btnStartGameLobby');
    await Promise.all(all.map(p => p.page.waitForURL(/\/game\//, { timeout: 20000 })));
    await Promise.all(all.map(p => p.page.waitForSelector('#cnBoard .cn-card', { timeout: 15000 })));
    await delay(1200);
}
const keyOf = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#cnBoard .cn-card')).map(el => ({
    i: Number(el.dataset.i),
    revealed: el.classList.contains('is-revealed'),
    key: (Array.from(el.classList).find(c => c.startsWith('key-')) || '').slice(4) || null,
    cover: el.classList.contains('can-cover'),
    word: el.querySelector('.cn-word')?.textContent || ''
})));
async function giveClue(sm, number = 1) {
    await waitFor(() => sm.page.$('#cnClueWord'), 8000, 'clue form');
    const words = (await keyOf(sm.page)).map(c => c.word);
    const clue = ['ปริศนา', 'ลึกลับ', 'วิเศษ', 'มหัศจรรย์', 'ตื่นเต้น'].find(w => !words.some(x => w.includes(x) || x.includes(w)));
    await sm.page.fill('#cnClueWord', clue);
    for (let k = 1; k < number; k += 1) await sm.page.click('.cn-stepper [data-step="1"]');
    await sm.page.click('#cnClueSend');
    return clue;
}
async function revealAs(op, index) {
    const sel = `#cnBoard .cn-card[data-i="${index}"]`;
    await waitFor(() => op.page.$eval(sel, el => el.classList.contains('can-tap')), 8000, 'can tap');
    await op.page.click(sel);
    await waitFor(() => op.page.$eval(sel, el => el.classList.contains('is-mine')), 5000, 'selected');
    await op.page.click('#cnRevealBtn');
    await waitFor(() => op.page.$eval(sel, el => el.classList.contains('is-revealed')), 6000, 'revealed');
}
async function checkLayout(p, label) {
    const probs = await layoutProblems(p.page, '#cnRoot');
    assert(probs.length === 0, `${label} เลย์เอาต์มีปัญหา: ${probs.join(' | ')}`);
}

(async () => {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch();
    const all = [];
    const phone = { width: 390, height: 844 };
    try {
        // ================= A: 2 คน โหมดร่วมมือ =================
        const a0 = await openPlayer(browser, base, 'A0', phone);
        const a1 = await openPlayer(browser, base, 'A1', phone);
        all.push(a0, a1);
        const roomA = await createRoom(a0, base);
        for (const p of [a0, a1]) await p.page.goto(`${base}/room/${roomA}`, { waitUntil: 'domcontentloaded' });
        await waitFor(() => a0.page.evaluate(() => document.querySelectorAll('[data-cn-shuffle]').length === 1 && /ยังไม่เลือก/.test(document.querySelector('.cnl-others')?.textContent || '')), 10000, 'lobby A');
        await a0.page.click('[data-cn-shuffle]');
        await waitFor(() => a0.page.evaluate(() => /โหมดร่วมมือ/.test(document.querySelector('.cnl-status')?.textContent || '')), 8000, 'co-op status');
        assert(await a0.page.evaluate(() => /2–3 คนเล่นทีมเดียว/.test(document.querySelector('.lobby-spotlight-pill')?.textContent || '')), 'ห้องรอบอกว่า 2–3 คนเล่นได้');
        assert(await a0.page.$('[data-cn-timer="codenamesClueFlag"]'), 'มีปุ่มตั้งค่าทักคำใบ้');
        let probs = await layoutProblems(a0.page, '.room-lobby-container');
        assert(!probs.some(x => /horizontal|offscreen|text overflow/.test(x)), 'ห้องรอ 390 ล้น: ' + probs.join(' | '));
        await shot(a0, 'r01-lobby-coop-390.png', { full: true });
        await startFromLobby(a0, [a0, a1]);
        const keyA0 = await keyOf(a0.page);
        const smA = keyA0.every(c => c.key) ? a0 : a1;
        const opA = smA === a0 ? a1 : a0;
        assert((await keyOf(opA.page)).every(c => !c.key), 'ลูกทีมไม่เห็นกุญแจ');
        const coopTeam = await smA.page.evaluate(() => document.getElementById('cnRoot').dataset.turn);
        const enemy = coopTeam === 'red' ? 'blue' : 'red';
        assert(/ฝ่ายตรงข้าม/.test(await smA.page.$eval('#cnScore', e => e.textContent)), 'แถบคะแนนบอกว่าอีกทีมเป็นฝ่ายตรงข้าม');
        await checkLayout(smA, 'A หัวหน้า');

        // หัวหน้าแชท → โดนปฏิเสธ
        await smA.page.click('#toggleChat');
        await smA.page.fill('#chatInput', 'ใบ้ในแชท');
        await smA.page.click('#sendChat');
        await waitFor(() => smA.page.evaluate(() => /พิมพ์แชทไม่ได้/.test(document.querySelector('.swal2-toast')?.textContent || '')), 5000, 'chat blocked toast');
        await shot(smA, 'r02-spymaster-chat-blocked-390.png');
        await smA.page.click('#closeChat').catch(() => {});
        await delay(2800);

        await giveClue(smA, 1);
        const key = await keyOf(smA.page);
        const neutral = key.find(c => c.key === 'neutral' && !c.revealed).i;
        await revealAs(opA, neutral);
        await waitFor(async () => (await keyOf(smA.page)).filter(c => c.cover).length > 0, 8000, 'cover cards glow');
        const glow = (await keyOf(smA.page)).filter(c => c.cover);
        assert(glow.every(c => c.key === enemy) && glow.length === 8, 'เรืองแสงเฉพาะสายลับฝ่ายตรงข้าม 8 ใบ: ' + glow.length);
        assert((await keyOf(opA.page)).every(c => !c.cover), 'ลูกทีมไม่มีการ์ดให้ปิด');
        assert(/เลือกปิด/.test(await smA.page.$eval('#cnNowTitle', e => e.textContent)), 'หัวหน้าเห็นว่าต้องเลือกปิด');
        assert(/ตาฝ่ายตรงข้าม/.test(await opA.page.$eval('#cnNowTitle', e => e.textContent)), 'ลูกทีมเห็นว่าเป็นตาฝ่ายตรงข้าม');
        await delay(1800);
        await checkLayout(smA, 'A ช่วงปิด');
        await shot(smA, 'r03-coop-cover-pick-390.png');
        await smA.page.click(`#cnBoard .cn-card[data-i="${glow[0].i}"]`);
        await confirmSwal(smA.page);
        await waitFor(() => opA.page.$eval(`#cnBoard .cn-card[data-i="${glow[0].i}"]`, el => el.classList.contains('is-revealed')), 6000, 'covered');
        await waitFor(() => smA.page.$('#cnClueWord'), 6000, 'back to our clue');
        await delay(1600);
        assert(/ฝ่ายตรงข้าม/.test(await opA.page.$eval('#cnLog', e => e.textContent)) && (await opA.page.$eval('#cnLog', e => e.textContent)).includes(glow[0].word), 'บันทึกคำที่ถูกปิด');
        await shot(opA, 'r04-coop-after-cover-390.png');
        await checkLayout(opA, 'A ลูกทีม');
        // จบ: มือสังหาร → แพ้ ไม่นับสถิติ
        await giveClue(smA, 1);
        const assassin = (await keyOf(smA.page)).find(c => c.key === 'assassin').i;
        await revealAs(opA, assassin);
        await waitFor(() => opA.page.$eval('#cnResult', el => !el.hidden), 8000, 'co-op result');
        await delay(1800);
        const resA = await opA.page.$eval('#cnResult', e => e.textContent);
        assert(/แพ้/.test(resA) && /ไม่นับสถิติ/.test(resA) && /มือสังหาร/.test(resA), 'ผลโหมดร่วมมือ: ' + resA);
        await checkLayout(opA, 'A จบ');
        await shot(opA, 'r05-coop-result-390.png');
        console.log('A. ร่วมมือ 2 คน: ห้องรอ → หัวหน้าห้ามแชท → แตะปิดสายลับฝ่ายตรงข้าม → ผลแพ้ไม่นับสถิติ ✓');

        // ================= B: ทักท้วงคำใบ้ =================
        const bs = [];
        for (let i = 0; i < 4; i += 1) bs.push(await openPlayer(browser, base, 'B' + i, phone));
        all.push(...bs);
        const roomB = await createRoom(bs[0], base);
        for (const p of bs) await p.page.goto(`${base}/room/${roomB}`, { waitUntil: 'domcontentloaded' });
        await waitFor(() => bs[0].page.evaluate(() => document.querySelectorAll('[data-cn-pick]').length >= 4 && (document.querySelector('.cnl-others')?.textContent || '').split(',').length >= 4), 10000, 'lobby B');
        const pickB = async (p, team, role) => { await p.page.click(`[data-cn-pick="${team}"][data-cn-role="${role}"]`); await delay(350); };
        await pickB(bs[0], 'red', 'spymaster');
        await pickB(bs[1], 'red', 'operative');
        await pickB(bs[2], 'blue', 'spymaster');
        await pickB(bs[3], 'blue', 'operative');
        await startFromLobby(bs[0], bs);
        const turn = await bs[0].page.evaluate(() => document.getElementById('cnRoot').dataset.turn);
        const tm = { red: { sm: bs[0], op: bs[1] }, blue: { sm: bs[2], op: bs[3] } };
        const other = turn === 'red' ? 'blue' : 'red';
        // ช่องพิมพ์เตือนส่วนของคำประสมทันที (เช่น "รถ" ตอนมี "รถไฟ")
        const bWords = (await keyOf(tm[turn].sm.page)).map(c => c.word);
        const compound = bWords.find(w => engine.compoundParts(w).length);
        if (compound) {
            await waitFor(() => tm[turn].sm.page.$('#cnClueWord'), 8000, 'clue form B');
            await tm[turn].sm.page.fill('#cnClueWord', engine.compoundParts(compound)[0]);
            assert(await tm[turn].sm.page.$eval('#cnClueSend', b => b.disabled) && /ส่วนหนึ่งของ/.test(await tm[turn].sm.page.$eval('#cnClueErr', e => e.textContent)), 'เตือนส่วนของคำประสม: ' + compound);
            await tm[turn].sm.page.fill('#cnClueWord', '');
        }
        await giveClue(tm[turn].sm, 2);
        const flagger = tm[other].sm;
        await waitFor(() => flagger.page.$('#cnFlagBtn'), 8000, 'flag button');
        assert(!(await tm[turn].sm.page.$('#cnFlagBtn')) && !(await tm[other].op.page.$('#cnFlagBtn')), 'ปุ่มทักมีเฉพาะหัวหน้าอีกทีม');
        await delay(1600);
        await checkLayout(flagger, 'B ปุ่มทัก');
        await shot(flagger, 'r06-flag-button-390.png');
        await flagger.page.click('#cnFlagBtn');
        await flagger.page.waitForSelector('.swal2-popup', { timeout: 4000 });
        assert(/ทีมละ 1 ครั้ง/.test(await flagger.page.$eval('.swal2-popup', e => e.textContent)), 'ยืนยันบอกว่าทีมละครั้ง');
        await confirmSwal(flagger.page);
        await waitFor(() => flagger.page.$('.cn-bonus'), 8000, 'bonus hint');
        const ownGlow = (await keyOf(flagger.page)).filter(c => c.cover);
        assert(ownGlow.length > 0 && ownGlow.every(c => c.key === other), 'เรืองแสงเฉพาะคำทีมตัวเอง');
        assert(await tm[turn].op.page.evaluate(() => /ผิดกติกา|ทัก/.test(document.getElementById('cnFeed').textContent)), 'อีกทีมเห็นว่าโดนทัก');
        await flagger.page.fill('#cnClueWord', 'ค้างไว้');
        await delay(1600);
        await checkLayout(flagger, 'B โบนัส');
        await shot(flagger, 'r07-flag-bonus-390.png');
        await flagger.page.click(`#cnBoard .cn-card[data-i="${ownGlow[0].i}"]`);
        await confirmSwal(flagger.page);
        await waitFor(() => tm[turn].op.page.$eval(`#cnBoard .cn-card[data-i="${ownGlow[0].i}"]`, el => el.classList.contains('is-revealed')), 6000, 'bonus covered');
        await waitFor(async () => !(await flagger.page.$('.cn-bonus')), 6000, 'bonus gone');
        assert((await flagger.page.$eval('#cnClueWord', e => e.value)) === 'ค้างไว้', 'คำที่พิมพ์ค้างไม่หายหลังปิดโบนัส');
        console.log('B. ทักท้วง: ปุ่มเฉพาะหัวหน้าอีกทีม → จบเทิร์น → แตะปิดคำตัวเอง · คำที่พิมพ์ไม่หาย ✓');

        all.forEach(p => assert(p.errors.length === 0, `${p.label} มี error: ${p.errors.slice(0, 3).join(' | ')}`));
        console.log(`✅ browser-codenames-rules: ${checks} checks`);
        console.log('ภาพ: ' + SHOT_DIR);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
