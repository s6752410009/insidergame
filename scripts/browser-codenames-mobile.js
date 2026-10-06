/**
 * สายลับคำใบ้ในเบราว์เซอร์จริง: 4 ผู้เล่นที่ 390×844 + ผู้ชมที่ 1280×900
 * เลือกทีมผ่าน UI ห้องรอ → เริ่ม → หัวหน้าพิมพ์คำใบ้ → ลูกทีมแตะ/เปิดเลย/กดค้าง → จนจบเกม
 * เช็ก: ไม่มี JS/console error · ไม่เลื่อนแนวนอน · ข้อความไม่ล้น · คำยาวพอดีการ์ด · ปุ่ม ≥44px · แชท/แถบล่างไม่บังปุ่ม
 * รัน: npm run smoke:codenames:mobile   (ภาพอยู่ที่ CODENAMES_SHOT_DIR)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
if (!process.env.GAME_DATA_DIR) {
    const base = path.join(__dirname, '..', '..', '..', 'tmpdata-codenames');
    fs.mkdirSync(base, { recursive: true });
    process.env.GAME_DATA_DIR = fs.mkdtempSync(path.join(base, 'browser-'));
    process.on('exit', () => { try { fs.rmSync(process.env.GAME_DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
}
if (!process.env.WALLETS_FILE) process.env.WALLETS_FILE = path.join(process.env.GAME_DATA_DIR, 'wallets.json');
require('./isolateTestData');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');
const { WORDS } = require('../games/codenamesWords');

const SHOT_DIR = process.env.CODENAMES_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'codenames-shots-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.CODENAMES_MOBILE_PORT) || 8822;
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

(async () => {
    const server = await bootServer(PORT);
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch();
    const players = [];
    const shots = [];
    try {
        const phone = { width: 390, height: 844 };
        for (let i = 0; i < 4; i += 1) players.push(await openPlayer(browser, base, 'P' + i, phone));
        const watcher = await openPlayer(browser, base, 'W', { width: 1280, height: 900 });
        players.push(watcher);
        const [host, p1, p2, p3] = players;

        const created = await host.page.evaluate(async () => {
            const res = await fetch('/api/rooms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name: 'สายลับคำใบ้', gameMode: 'codenames', maxPlayers: 12, codenamesClueSeconds: 120, codenamesGuessSeconds: 0 }) });
            return res.json();
        });
        assert(created && created.success && created.roomId, 'สร้างห้องผ่าน API: ' + JSON.stringify(created));
        const roomId = created.roomId;
        for (const p of players) {
            await p.page.goto(`${base}/room/${roomId}`, { waitUntil: 'domcontentloaded' });
        }
        await waitFor(() => host.page.evaluate(() => document.querySelectorAll('[data-cn-pick]').length >= 4), 10000, 'lobby team panel');
        await waitFor(() => host.page.evaluate(() => /ผู้ชม|ยังไม่เลือก/.test(document.querySelector('.cnl-others')?.textContent || '')), 8000, 'everyone in lobby');
        const startDisabled = await host.page.$eval('#btnStartGameLobby', b => b.disabled);
        const lobbyStatus = await host.page.$eval('#lobbyStatusText', el => el.textContent);
        assert(startDisabled && /ยังไม่ได้เลือกทีม/.test(lobbyStatus), 'ห้องรอบล็อกปุ่มเริ่มพร้อมเหตุผล: ' + lobbyStatus);
        shots.push(await shot(host, '01-lobby-unassigned-390.png', { full: true }));

        const pick = async (p, team, role) => {
            await p.page.click(team ? `[data-cn-pick="${team}"][data-cn-role="${role}"]` : '[data-cn-role="spectator"]');
            await delay(350);
        };
        // ห้องรอ: คนที่ไม่ใช่หัวห้องรู้ว่าทำไมกดเวลาไม่ได้ / ต้องรอใครสุ่มทีม
        const p1Lobby = await p1.page.evaluate(() => ({ note: document.querySelector('.cnl-note')?.textContent || '', status: document.querySelector('.cnl-status')?.textContent || '' }));
        assert(/หัวหน้าห้องเป็นคนตั้งเวลา/.test(p1Lobby.note) && /รอหัวหน้าห้องกด/.test(p1Lobby.status), 'ห้องรอ (ไม่ใช่หัวห้อง) บอกเหตุผล: ' + JSON.stringify(p1Lobby));
        assert(!(await host.page.$('.cnl-note')) && /หรือกด "สุ่มทีม"/.test(await host.page.$eval('.cnl-status', el => el.textContent)), 'หัวห้องเห็นปุ่มสุ่มทีมเอง');
        await pick(host, 'red', 'spymaster');
        await waitFor(() => p2.page.evaluate(() => /มีหัวหน้าแล้ว/.test(document.querySelector('[data-cn-pick="red"][data-cn-role="spymaster"]')?.textContent || '')), 5000, 'taken spymaster label');
        await pick(p1, 'red', 'operative');
        await pick(p2, 'blue', 'spymaster');
        await pick(p3, 'blue', 'operative');
        await pick(watcher, null, 'spectator');
        await waitFor(() => host.page.evaluate(() => !document.getElementById('btnStartGameLobby').disabled), 8000, 'start enabled');
        // สุ่มทีมหลังเลือกแล้ว = ถามก่อน · ยกเลิกแล้วทีมเดิมอยู่
        await host.page.click('[data-cn-shuffle]');
        await host.page.waitForSelector('.swal2-popup', { timeout: 4000 });
        assert(/สุ่มทีมใหม่/.test(await host.page.$eval('.swal2-popup', el => el.textContent)), 'ถามก่อนสุ่มทีมทับ');
        await delay(450);
        shots.push(await shot(host, '02b-lobby-shuffle-confirm-390.png'));
        await host.page.click('.swal2-cancel');
        await delay(500);
        assert(/คุณเป็นหัวหน้า/.test(await host.page.$eval('[data-cn-pick="red"][data-cn-role="spymaster"]', el => el.textContent)), 'ยกเลิกสุ่ม ทีมเดิมยังอยู่');
        assert(/พร้อม/.test(await host.page.$eval('.cnl-status', el => el.textContent)), 'ห้องรอบอกว่าพร้อม');
        let probs = await layoutProblems(host.page, '.room-lobby-container');
        assert(!probs.some(x => /horizontal|offscreen|text overflow/.test(x)), 'ห้องรอ 390 ล้น: ' + probs.join(' | '));
        shots.push(await shot(host, '02-lobby-teams-390.png', { full: true }));

        await host.page.click('#btnStartGameLobby');
        await Promise.all(players.map(p => p.page.waitForURL(/\/game\//, { timeout: 20000 })));
        await Promise.all(players.map(p => p.page.waitForSelector('#cnBoard .cn-card', { timeout: 15000 })));
        await delay(1200);

        const smRed = await boardState(host.page);
        assert(smRed.cards.length === 25 && smRed.cards.every(c => c.key), 'หัวหน้าเห็นกุญแจครบ 25 ใบ');
        const opView = await boardState(p1.page);
        assert(opView.cards.every(c => !c.key), 'ลูกทีมไม่เห็นกุญแจ');
        const wView = await boardState(watcher.page);
        assert(wView.cards.every(c => !c.key) && /ดูอย่างเดียว/.test(wView.who), 'ผู้ชมไม่เห็นกุญแจ');
        assert(await host.page.$eval('#cnLegend', el => !el.hidden), 'หัวหน้ามีคำอธิบายสีกุญแจ');
        const wNow = await watcher.page.$eval('#cnNowSub', el => el.textContent);
        assert(!/ทีมคุณ/.test(wNow) && /ข้างสนาม/.test(wNow), 'ผู้ชมไม่ถูกบอกว่า "ถึงตาทีมคุณ": ' + wNow);
        const skip = await host.page.$eval('#cnSkipBtn', b => ({ hidden: b.hidden, disabled: b.disabled, text: b.textContent }));
        assert(!skip.hidden && skip.disabled && /ข้ามเทิร์น \(\d+\)/.test(skip.text), 'หัวห้องเห็นปุ่มข้ามเทิร์น (รอนับถอยหลัง): ' + JSON.stringify(skip));
        assert(await p1.page.$eval('#cnSkipBtn', b => b.hidden) && await p1.page.$eval('#cnEndBtn', b => b.hidden), 'คนอื่นไม่เห็นปุ่มหัวห้อง');

        // คำยาวที่สุดในคลังต้องพอดีการ์ดที่ 390
        const longest = WORDS.slice().sort((a, b) => b.length - a.length).slice(0, 5);
        const fit = await p1.page.evaluate(words => {
            const els = Array.from(document.querySelectorAll('#cnBoard .cn-word')).slice(0, words.length);
            els.forEach((el, k) => { el.textContent = words[k]; el.style.setProperty('--fs', '12px'); });
            window.codenamesBoard.fitWords();
            return els.map(el => ({ w: el.textContent, ok: el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.parentElement.clientWidth, fs: parseFloat(el.style.getPropertyValue('--fs')) }));
        }, longest);
        fit.forEach(f => assert(f.ok && f.fs >= 9, `คำยาว "${f.w}" ล้นการ์ด (fs ${f.fs})`));
        await p1.page.evaluate(() => window.dispatchEvent(new Event('resize')));
        await delay(300);

        const startTeam = await host.page.evaluate(() => document.getElementById('cnRoot').dataset.turn);
        const team = { red: { sm: host, op: p1 }, blue: { sm: p2, op: p3 } };
        shots.push(await shot(team[startTeam].sm, '03-spymaster-clue-390.png'));
        shots.push(await shot(team[startTeam].op, '04-operative-waiting-390.png'));
        for (const p of players) {
            probs = await layoutProblems(p.page, '#cnRoot');
            assert(probs.length === 0, `${p.label} เลย์เอาต์มีปัญหา: ${probs.join(' | ')}`);
        }

        // เล่นจนจบผ่าน UI
        let turns = 0;
        let usedLongPress = false;
        let usedTap = false;
        while (turns < 12) {
            const turnTeam = await watcher.page.evaluate(() => document.getElementById('cnRoot').dataset.turn);
            const fin = await boardState(watcher.page);
            if (fin.finished) break;
            const { sm, op } = team[turnTeam];
            await waitFor(() => sm.page.$('#cnClueWord'), 8000, 'clue form');
            const key = await boardState(sm.page);
            const words = await sm.page.evaluate(() => Array.from(document.querySelectorAll('#cnBoard .cn-word')).map(e => e.textContent));
            // ลองคำบนกระดานก่อน → ต้องขึ้นเตือน ปุ่มกดไม่ได้
            if (turns === 0) {
                const onBoard = words[key.cards.findIndex(c => !c.revealed)];
                await sm.page.fill('#cnClueWord', onBoard);
                assert(await sm.page.$eval('#cnClueSend', b => b.disabled) && /อยู่บนกระดาน/.test(await sm.page.$eval('#cnClueErr', e => e.textContent)), 'เตือนคำใบ้ที่อยู่บนกระดาน');
                await sm.page.fill('#cnClueWord', 'สอง คำ');
                assert(/คำเดียว/.test(await sm.page.$eval('#cnClueErr', e => e.textContent)), 'เตือนคำใบ้หลายคำ');
            }
            const clue = ['ปริศนา', 'ลึกลับ', 'วิเศษ', 'มหัศจรรย์', 'ตื่นเต้น'].find(w => !words.some(x => w.includes(x) || x === w));
            if (turns === 0) {
                // เซิร์ฟเวอร์ปฏิเสธ (จังหวะเปลี่ยน) → เหตุผลอยู่ใต้ช่องพิมพ์ และยังกดส่งซ้ำได้
                await sm.page.fill('#cnClueWord', clue);
                const patched = await sm.page.evaluate(() => {
                    const proto = window.io && window.io.Socket && window.io.Socket.prototype;
                    if (!proto) return false;
                    const orig = proto.emit;
                    proto.emit = function(ev, data, ...rest) {
                        if (ev === 'codenames_clue') { proto.emit = orig; data = Object.assign({}, data, { step: -5 }); }
                        return orig.call(this, ev, data, ...rest);
                    };
                    return true;
                });
                assert(patched, 'แพตช์ socket ได้');
                await sm.page.click('#cnClueSend');
                await waitFor(() => sm.page.$eval('#cnClueErr', e => /จังหวะ/.test(e.textContent)), 5000, 'inline server error');
                assert(!(await sm.page.$eval('#cnClueSend', b => b.disabled)), 'โดนปฏิเสธแล้วยังกดส่งซ้ำได้');
                shots.push(await shot(sm, '05b-spymaster-server-reject-390.png'));
            }
            await sm.page.fill('#cnClueWord', clue);
            for (let k = 0; k < 9; k += 1) await sm.page.click('.cn-stepper [data-step="1"]');
            assert((await sm.page.$eval('#cnNumOut', e => e.textContent)) === '9', 'ตัวเลขคำใบ้ขึ้นถึง 9');
            if (turns === 0) shots.push(await shot(sm, '05-spymaster-typing-390.png'));
            await sm.page.click('#cnClueSend');
            await waitFor(() => op.page.evaluate(() => !document.getElementById('cnClue').hidden), 8000, 'clue shown');
            const mineIdx = key.cards.filter(c => c.key === turnTeam && !c.revealed).map(c => c.i);
            const wrongIdx = key.cards.find(c => c.key === 'neutral' && !c.revealed);
            const plan = turns === 0 ? [mineIdx[0], mineIdx[1], wrongIdx.i] : mineIdx;
            for (let k = 0; k < plan.length; k += 1) {
                const i = plan[k];
                const sel = `#cnBoard .cn-card[data-i="${i}"]`;
                if (turns === 0 && k === 1) {
                    // กดค้างใบที่ยังไม่ได้เลือก = แค่เลือก ไม่เปิด · กดค้างซ้ำใบเดิม = เปิด
                    const hold = async () => {
                        const box = await op.page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
                        await op.page.mouse.move(box.x, box.y);
                        await op.page.mouse.down();
                        await delay(800);
                        await op.page.mouse.up();
                    };
                    await hold();
                    await waitFor(() => op.page.$eval(sel, el => el.classList.contains('is-mine')), 5000, 'long-press selects');
                    await delay(700);
                    assert(!(await watcher.page.$eval(sel, el => el.classList.contains('is-revealed'))), 'กดค้างใบที่ยังไม่ได้เลือก ไม่เปิด');
                    const st = await op.page.evaluate(s2 => ({ tag: document.querySelector(s2 + ' .cn-tag.is-me')?.textContent || '', btn: document.getElementById('cnRevealBtn').textContent, dock: document.getElementById('cnDockInner').textContent }), sel);
                    assert(/คุณ/.test(st.tag) && /^เปิด ".+" เลย$/.test(st.btn) && /กดค้างที่ใบนี้/.test(st.dock), 'ใบที่เลือกแล้วบอกชัดว่าพร้อมเปิด: ' + JSON.stringify(st));
                    shots.push(await shot(op, '06b-operative-longpress-selected-390.png'));
                    await hold();
                    usedLongPress = true;
                } else {
                    if (turns === 0 && k === 0) {
                        assert(/เลือกการ์ดก่อน/.test(await op.page.$eval('#cnRevealBtn', b => b.textContent)) && await op.page.$eval('#cnRevealBtn', b => b.disabled), 'ยังไม่เลือก = ปุ่มเปิดกดไม่ได้ บอกเหตุผล');
                    }
                    await op.page.click(sel);
                    await waitFor(() => op.page.$eval(sel, el => el.classList.contains('is-mine')), 5000, 'card selected');
                    if (turns === 0 && k === 0) {
                        shots.push(await shot(op, '06-operative-selected-390.png'));
                        const word0 = await op.page.$eval(sel + ' .cn-word', e => e.textContent);
                        await waitFor(() => watcher.page.evaluate(w => (document.querySelector('.cn-votelist')?.textContent || '').includes(w), word0), 5000, 'vote list for spectator');
                        assert(/แตะใบเดิมซ้ำ = ยกเลิก/.test(await op.page.$eval('#cnDockInner', e => e.textContent)), 'บอกวิธียกเลิกการเสนอ');
                    }
                    await op.page.click('#cnRevealBtn');
                    usedTap = true;
                }
                await waitFor(() => watcher.page.$eval(sel, el => el.classList.contains('is-revealed')), 6000, 'revealed ' + i);
                if (turns === 0 && k === 0) {
                    const w0 = await watcher.page.$eval(sel + ' .cn-back-word', e => e.textContent);
                    assert((await watcher.page.$eval('#cnBanner', e => e.textContent)).includes(w0), 'แบนเนอร์เปิดการ์ดบอกคำ');
                    await delay(900);
                    shots.push(await shot(watcher, '07-desktop-1280.png'));
                    await op.page.setViewportSize({ width: 844, height: 390 });
                    await delay(500);
                    const lp = await layoutProblems(op.page, '#cnRoot');
                    assert(lp.length === 0, 'แนวนอนระหว่างทายมีปัญหา: ' + lp.join(' | '));
                    const boardFits = await op.page.evaluate(() => { const r = document.querySelector('.cn-boardwrap').getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0; });
                    assert(boardFits, 'แนวนอน: กระดานทั้ง 25 ใบอยู่ในจอเดียว');
                    shots.push(await shot(op, '07b-landscape-guess-844x390.png'));
                    await op.page.setViewportSize({ width: 390, height: 844 });
                    await delay(400);
                }
                const done = await boardState(watcher.page);
                if (done.finished) break;
            }
            await delay(700);
            if (turns === 0 && !(await boardState(watcher.page)).finished) {
                // ใบ้ 9 เปิดถูก 2 แล้วพลาด → ประวัติบอก "ค้าง 7"
                assert(/ค้าง 7/.test(await watcher.page.$eval('#cnLog', e => e.textContent)), 'ประวัติคำใบ้บอกจำนวนที่ค้าง');
                shots.push(await shot(watcher, '07c-cluelog-owe-1280.png'));
            }
            turns += 1;
        }
        const end = await boardState(watcher.page);
        assert(end.finished, 'เกมจบผ่าน UI');
        assert(usedLongPress && usedTap, 'ใช้ทั้งแตะ+เปิดเลย และกดค้าง');
        await delay(1800);
        for (const p of players) {
            assert(await p.page.$eval('#cnResult', el => !el.hidden && /ชนะ/.test(el.textContent)), `${p.label} เห็นผลจบเกม`);
            assert(await p.page.$eval('#cnResult p', el => /ทีม(แดง|น้ำเงิน)/.test(el.textContent) && !/อีกทีม/.test(el.textContent)), `${p.label} สรุปเหตุชนะบอกชื่อทีม`);
            probs = await layoutProblems(p.page, '#cnRoot');
            assert(probs.length === 0, `${p.label} (จบเกม) เลย์เอาต์มีปัญหา: ${probs.join(' | ')}`);
        }
        // หน้าจบค้าง ~30 วิ มีนับถอยหลัง · หัวห้อง = พาทุกคนกลับ · คนอื่น = กลับห้องเลย (คนเดียว)
        const backSec = Number(((await p1.page.$eval('#cnResultBack', e => e.textContent)).match(/(\d+) วิ/) || [])[1]);
        assert(backSec > 20 && backSec <= 30, 'หน้าจบนับถอยหลัง ~30 วิ: ' + backSec);
        assert(await host.page.$('#cnBackAllBtn') && !(await host.page.$('#cnBackBtn')), 'หัวห้องเห็น "พาทุกคนกลับห้อง"');
        assert(/กลับห้องเลย/.test(await p1.page.$eval('#cnBackBtn', b => b.textContent)) && !(await p1.page.$('#cnBackAllBtn')), 'คนอื่นเห็น "กลับห้องเลย"');
        shots.push(await shot(p1, '08-finished-390.png'));
        shots.push(await shot(p1, '09-finished-390-full.png', { full: true }));
        shots.push(await shot(watcher, '10-finished-1280.png'));

        // แนวนอนบนมือถือ
        await p3.page.setViewportSize({ width: 844, height: 390 });
        await delay(500);
        probs = await layoutProblems(p3.page, '#cnRoot');
        assert(!probs.some(x => /horizontal|offscreen|overflow/.test(x)), 'แนวนอนล้น: ' + probs.join(' | '));
        shots.push(await shot(p3, '11-landscape-844x390.png'));

        // รีเฟรชหน้าจบ: นับถอยหลังต่อจากเดิม ไม่เริ่ม 30 ใหม่
        await delay(2000);
        await p2.page.reload({ waitUntil: 'domcontentloaded' });
        await p2.page.waitForSelector('#cnResultBack', { timeout: 15000 });
        await delay(800);
        const afterReload = Number(((await p2.page.$eval('#cnResultBack', e => e.textContent)).match(/(\d+) วิ/) || [])[1]);
        assert(afterReload > 0 && afterReload < backSec, `รีเฟรชแล้วนับต่อ (${backSec} → ${afterReload})`);

        // คนเดียวกลับห้องก่อน: p1 ไปห้องรอ คนอื่นยังอยู่หน้าจบ
        await p1.page.click('#cnBackBtn');
        await p1.page.waitForURL(/\/room\//, { timeout: 15000 });
        await p1.page.waitForSelector('[data-cn-pick]', { timeout: 10000 });
        await delay(600);
        assert(/\/game\//.test(p3.page.url()) && await p3.page.$eval('#cnResult', el => !el.hidden), 'คนอื่นยังดูหน้าจบต่อได้');
        shots.push(await shot(p1, '12-early-return-lobby-390.png'));

        // หัวห้องพาทุกคนกลับตอนนี้
        await host.page.click('#cnBackAllBtn');
        await Promise.all(players.map(p => p.page.waitForURL(/\/room\//, { timeout: 15000 })));
        await waitFor(() => host.page.evaluate(() => !document.getElementById('btnStartGameLobby').disabled), 8000, 'teams kept, start enabled');
        console.log('   · เล่นอีกตา: กลับห้องรอพร้อมทีมเดิม ปุ่มเริ่มใช้ได้');

        players.forEach(p => assert(p.errors.length === 0, `${p.label} มี error: ${p.errors.slice(0, 3).join(' | ')}`));
        console.log(`✅ browser-codenames-mobile: ${checks} checks · ${turns} เทิร์น`);
        console.log('ภาพ: ' + SHOT_DIR);
    } finally {
        await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
