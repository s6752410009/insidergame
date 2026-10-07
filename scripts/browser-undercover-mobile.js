/**
 * เปิดกระดานคำใครไม่เหมือนในเบราว์เซอร์จริง (390×844 + เดสก์ท็อป 1280×900)
 * เล่นทุกเฟสผ่าน UI ของหลายบท แล้วเก็บภาพ + เช็กว่าไม่มี JS error / ไม่เลื่อนแนวนอน / ข้อความไม่ล้น
 *
 * รัน: npm run smoke:undercover:mobile   (ภาพอยู่ที่ UNDERCOVER_SHOT_DIR หรือโฟลเดอร์ชั่วคราว)
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');
const { chromium } = require('playwright');

const SHOT_DIR = process.env.UNDERCOVER_SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'undercover-shots-'));
fs.mkdirSync(SHOT_DIR, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

async function getPort() {
    const preferred = Number(process.env.UNDERCOVER_MOBILE_PORT) || 8452;
    return new Promise(res => {
        const s = require('net').createServer();
        s.once('error', () => {
            const t = require('net').createServer();
            t.listen(0, '127.0.0.1', () => { const { port } = t.address(); t.close(() => res(port)); });
        });
        s.listen(preferred, '127.0.0.1', () => s.close(() => res(preferred)));
    });
}
function bootServer(port) {
    const long = '600000';
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env, PORT: String(port),
            UNDERCOVER_REVEAL_MS: long, UNDERCOVER_CLUE_MS: long, UNDERCOVER_VOTE_MS: long,
            UNDERCOVER_MRWHITE_MS: long, UNDERCOVER_RESULT_MS: long, UNDERCOVER_RETURN_MS: long
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout')); }, 30000);
        child.stdout.on('data', c => { if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.once('connect', () => r(s)); }); }
function launchOptions() {
    const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH };
    if (fs.existsSync(sys)) return { executablePath: sys };
    return {};
}
async function waitFor(fn, ms, label) {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = await fn(); if (v) return v; await delay(80); }
    throw new Error('รอไม่ถึง: ' + label);
}

// ERR_SOCKET_NOT_CONNECTED = socket.io polling ที่ค้างตอนปิด socket บอท/สลับ transport — socket.io ต่อใหม่เอง ไม่ใช่บั๊กหน้าเว็บ
const IGNORE = /favicon|manifest|service-worker|autoplay|play\(\) failed|AudioContext|\.mp3|vibrate|googleapis|gstatic|ERR_SOCKET_NOT_CONNECTED/i;

async function layoutProblems(page) {
    return page.evaluate(() => {
        const vw = window.innerWidth;
        const problems = [];
        if (document.documentElement.scrollWidth > vw + 1) problems.push('horizontal scroll ' + document.documentElement.scrollWidth + '>' + vw);
        const root = document.getElementById('ucRoot');
        root.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden') return;
            if (r.right > vw + 1 || r.left < -1) {
                if (!el.closest('.uc-card-inner')) problems.push('offscreen ' + el.tagName + '.' + el.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
            }
            const clipped = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis';
            if (!clipped && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && cs.display !== 'inline') {
                problems.push('text overflow ' + el.tagName + '.' + el.className + ' "' + (el.textContent || '').slice(0, 20) + '"');
            }
            if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && cs.display !== 'none' && r.height < 43.5 && !el.closest('.uc-card')) {
                problems.push('small target ' + el.tagName + '#' + el.id + '.' + el.className + ' h=' + Math.round(r.height));
            }
        });
        return problems.slice(0, 8);
    });
}

(async () => {
    const port = await getPort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch(launchOptions());
    const sockets = [];
    const shots = [];
    try {
        // 6 คน เปิด Mr. White → สายแฝง 1 + Mr. White 1
        const bots = [];
        for (let i = 0; i < 6; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('undercoverState', s => states.push(s));
            bots.push({ socket, id, states, name: null });
            sockets.push(socket);
        }
        await delay(500);
        const created = await ack(bots[0].socket, 'createRoom', { playerId: bots[0].id, name: 'วงคำใครไม่เหมือน', gameMode: 'undercover', maxPlayers: 10 });
        assert(created?.success, 'createRoom failed');
        const roomId = created.roomId;
        bots[0].socket.emit('setRoom', { roomId, playerId: bots[0].id });
        for (const b of bots.slice(1)) {
            assert((await ack(b.socket, 'joinRoom', { roomId, playerId: b.id }))?.success, 'join failed');
            b.socket.emit('setRoom', { roomId, playerId: b.id });
        }
        await delay(500);
        assert((await ack(bots[0].socket, 'updateRoom', { undercoverMrWhite: true }))?.success, 'เปิด Mr. White ไม่ได้');

        // lobby page (หัวห้อง) ก่อนเริ่ม — เช็กว่าห้องรอรู้จักโหมดนี้
        {
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
            const page = await ctx.newPage();
            await page.goto(`${base}/room/${roomId}?playerId=${bots[0].id}`, { waitUntil: 'domcontentloaded' });
            await delay(1500);
            const txt = await page.textContent('body');
            assert(/คำใครไม่เหมือน/.test(txt), 'ห้องรอต้องแสดงชื่อโหมด');
            const file = path.join(SHOT_DIR, '00-lobby-390.png');
            await page.screenshot({ path: file, fullPage: false });
            shots.push(file);
            await ctx.close();
            bots[0].socket.emit('setRoom', { roomId, playerId: bots[0].id });
            await delay(300);
        }

        assert((await ack(bots[0].socket, 'startGameFromLobby', { roomId }))?.success, 'start failed');
        await waitFor(() => bots.every(b => b.states.length && b.states[b.states.length - 1].phase === 'reveal'), 8000, 'reveal');
        const view = b => b.states[b.states.length - 1];
        const roleOf = b => {
            const v = view(b);
            if (v.self.isMrWhite) return 'mrwhite';
            const words = bots.map(x => view(x).self.word).filter(Boolean);
            const n = words.filter(w => w === v.self.word).length;
            return n === 1 ? 'undercover' : 'civilian';
        };
        const host = bots[0];
        const uc = bots.find(b => roleOf(b) === 'undercover');
        const mw = bots.find(b => roleOf(b) === 'mrwhite');
        const civ = bots.find(b => b !== host && roleOf(b) === 'civilian');
        const viewers = [
            { bot: host, tag: 'host-' + roleOf(host) },
            ...(uc !== host ? [{ bot: uc, tag: 'undercover' }] : []),
            ...(mw !== host ? [{ bot: mw, tag: 'mrwhite' }] : []),
            ...(roleOf(host) !== 'civilian' ? [{ bot: civ, tag: 'civilian' }] : [])
        ];

        // เปิดหน้าเกมของผู้เล่นที่ดูด้วยตา (ปิด socket บอทของเขาก่อน — หน้าเว็บต่อเอง)
        for (const v of viewers) {
            v.bot.socket.close();
            const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
            await ctx.addInitScript(() => { try { localStorage.setItem('ig-firstplay-undercover', '1'); } catch (e) {} });
            const page = await ctx.newPage();
            v.errors = [];
            page.on('pageerror', e => v.errors.push('pageerror: ' + e.message));
            page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) v.errors.push('console: ' + m.text().slice(0, 160)); });
            await page.goto(`${base}/game/${roomId}?playerId=${v.bot.id}`, { waitUntil: 'domcontentloaded' });
            v.page = page;
        }
        globalThis.__ucViewers = viewers;
        // เดสก์ท็อปของหัวห้อง
        const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })).newPage();
        const deskErrors = [];
        desk.on('pageerror', e => deskErrors.push(e.message));
        await delay(1800);

        async function snap(label) {
            await delay(450);
            for (const v of viewers) {
                assert(await v.page.isVisible('#ucExitBtn'), `${label}/${v.tag}: ปุ่ม 🚪 ออก ต้องเห็นทุกเฟส`);
                const problems = await layoutProblems(v.page);
                assert(problems.length === 0, `${label}/${v.tag}: layout ${problems.join(' | ')}`);
                assert(v.errors.length === 0, `${label}/${v.tag}: ${v.errors.join(' | ')}`);
                const file = path.join(SHOT_DIR, `${label}-${v.tag}-390.png`);
                await v.page.screenshot({ path: file, fullPage: true });
                shots.push(file);
            }
        }
        const pageOf = bot => viewers.find(v => v.bot === bot)?.page || null;
        const liveBots = () => bots.filter(b => !viewers.some(v => v.bot === b));
        const hostView = () => view(liveBots()[0]);
        // บอทต้องรอ state ของตัวเองมาถึงก่อนกด (ไม่งั้น step เก่า → ถูกปัดตามที่ควร)
        async function pageVote(page, targetId) {
            await page.waitForSelector('.uc-vote-tile');
            const sel = `.uc-vote-tile[data-target="${targetId}"]`;
            await page.click((await page.$(sel)) ? sel : '.uc-vote-tile');
        }
        async function botSpeak(b, text = '') {
            await waitFor(() => view(b).phase === 'clue' && view(b).speakerId === b.id, 4000, 'state คนพูดมาถึง');
            const res = await ack(b.socket, 'undercover_clueDone', { step: view(b).step, text });
            assert(res?.success, 'บอทพูดเสร็จไม่ได้: ' + JSON.stringify(res));
        }
        async function botVote(b, targetId) {
            await waitFor(() => view(b).phase === 'vote' || view(b).phase !== 'clue', 4000, 'state โหวตมาถึง');
            if (view(b).phase !== 'vote' || !view(b).self.alive || view(b).self.hasVoted || !view(b).self.canVote) return;
            const res = await ack(b.socket, 'undercover_vote', { step: view(b).step, targetPlayerId: targetId });
            assert(res?.success, 'บอทโหวตไม่ได้: ' + JSON.stringify(res));
        }

        // ---------- reveal
        await snap('01-reveal-closed');
        for (const v of viewers) await v.page.click('#ucWordCard');
        await delay(700);
        for (const v of viewers) {
            const word = await v.page.textContent('#ucWordCard .uc-word');
            if (v.bot === mw) assert(/ไม่มีคำ/.test(word), 'Mr. White เห็น "ไม่มีคำ"');
            else assert(word && word.trim().length > 0 && word.trim() !== '—', `${v.tag} ต้องเห็นคำของตัวเอง`);
        }
        await snap('02-reveal-open');
        for (const v of viewers) await v.page.click('#ucReadyBtn');
        for (const b of liveBots()) await ack(b.socket, 'undercover_ready', { step: view(b).step });
        await waitFor(() => hostView().phase === 'clue', 5000, 'clue');
        await delay(500);

        // ---------- clue: ให้คนแรกที่เป็นหน้าเว็บได้พูด (บอทพูดไปก่อนจนถึงคิว)
        let shotSpeaker = false;
        let shotWaiting = false;
        let skipChecked = false;
        let guard = 0;
        while (hostView().phase === 'clue' && guard++ < 10) {
            const sp = hostView().speakerId;
            const page = pageOf(bots.find(b => b.id === sp));
            if (page) {
                if (!shotWaiting) { await snap('03-clue'); shotWaiting = true; }
                await page.fill('#ucClueInput', 'ใช้ทุกวัน');
                if (!shotSpeaker) { await snap('04-clue-speaking'); shotSpeaker = true; }
                await page.click('#ucClueDoneBtn');
            } else {
                // หัวห้องกดข้ามตาแล้วกดยกเลิก → ต้องไม่ข้าม (กันนิ้วพลาด)
                if (!skipChecked && pageOf(host)) {
                    skipChecked = true;
                    await pageOf(host).click('#ucSkipBtn');
                    await pageOf(host).waitForSelector('.swal2-cancel');
                    await pageOf(host).click('.swal2-cancel');
                    await delay(400);
                    assert(hostView().speakerId === sp, 'กดยกเลิกข้ามตาแล้วคนพูดต้องเหมือนเดิม');
                }
                await botSpeak(bots.find(x => x.id === sp), guard % 2 ? 'ของกินได้' : '');
            }
            await waitFor(() => hostView().speakerId !== sp || hostView().phase !== 'clue', 4000, 'next speaker');
            if (hostView().phase === 'clue') {
                await delay(350);
                const p0 = viewers[0].page;
                const typed = hostView().clues.some(c => c.round === hostView().round);
                if (typed) assert(await p0.$('#ucRoundClues li'), 'คำใบ้รอบนี้ต้องอยู่บนเวทีช่วงใบ้');
                const order = hostView().speakerOrder;
                if (hostView().speakerIndex < order.length - 1) assert(await p0.$('.uc-order li.is-next'), 'ต้องมีป้าย "ถัดไป" บนลำดับพูด');
            }
        }
        assert(hostView().phase === 'vote', 'ต้องเข้าโหวต');
        await delay(500);

        // ---------- vote round 1: โหวตพลเมืองคนหนึ่ง (ที่ไม่ใช่หน้าเว็บ) ออก เพื่อดูการ์ดพลเมือง
        const civTarget = liveBots().find(b => roleOf(b) === 'civilian' && b !== host) || liveBots().find(b => roleOf(b) === 'civilian');
        for (const v of viewers) await pageVote(v.page, civTarget.id);
        await snap('05-vote-picked');
        for (const v of viewers) await v.page.click('#ucVoteConfirm');
        await delay(400);
        await snap('06-vote-waiting');
        assert(/รอ /.test(await viewers[0].page.textContent('#ucVoteCount')), 'หน้ารอโหวตต้องบอกว่ายังรอใคร');
        for (const b of liveBots()) {
            await botVote(b, b === civTarget ? host.id : civTarget.id);
        }
        await waitFor(() => hostView().phase === 'elimination', 5000, 'elimination');
        await delay(1200);
        await snap('07-eliminated-civilian');
        for (const v of viewers) {
            const txt = await v.page.textContent('.uc-votelist');
            assert(/โหวตโดย/.test(txt), `${v.tag}: หน้าเฉลยต้องบอกว่าใครโหวตใคร`);
        }
        await pageOf(host).click('#ucContinueBtn');
        await waitFor(() => hostView().phase === 'clue', 5000, 'round 2');

        // ---------- round 2: ทุกคนพูด แล้วโหวต Mr. White
        guard = 0;
        while (hostView().phase === 'clue' && guard++ < 10) {
            const sp = hostView().speakerId;
            const page = pageOf(bots.find(b => b.id === sp));
            if (page) await page.click('#ucClueDoneBtn');
            else await botSpeak(bots.find(x => x.id === sp));
            await waitFor(() => hostView().speakerId !== sp || hostView().phase !== 'clue', 4000, 'next speaker r2');
        }
        await delay(400);
        for (const v of viewers) {
            if (!(await v.page.$('#ucVoteConfirm'))) continue;
            await pageVote(v.page, v.bot === mw ? uc.id : mw.id);
            await v.page.click('#ucVoteConfirm');
        }
        for (const b of liveBots()) {
            await botVote(b, mw.id);
        }
        await waitFor(() => hostView().phase === 'mrwhite', 5000, 'mrwhite phase');
        await delay(1200);
        assert(!(await pageOf(mw).$('.uc-role')), 'คนทายไม่ต้องมีการ์ดใหญ่ดันช่องพิมพ์ลง');
        assert(await pageOf(mw).$('#ucGuessClues li'), 'Mr. White ต้องเห็นคำใบ้ทั้งเกมตอนทาย');
        await pageOf(mw).fill('#ucGuessInput', 'ไม่รู้เลย');
        await snap('08-mrwhite-guess');
        await pageOf(mw).click('#ucGuessBtn');
        await pageOf(mw).waitForSelector('.swal2-confirm');
        assert(hostView().phase === 'mrwhite', 'ยังไม่ยืนยัน = ยังไม่ส่งคำทาย');
        await pageOf(mw).screenshot({ path: path.join(SHOT_DIR, '08b-mrwhite-confirm-390.png') });
        await pageOf(mw).click('.swal2-confirm');
        await waitFor(() => hostView().phase === 'elimination', 5000, 'after guess');
        await delay(1200);
        await snap('09-mrwhite-missed');
        await pageOf(host).click('#ucContinueBtn');
        await waitFor(() => hostView().phase === 'clue', 5000, 'round 3');

        // ---------- round 3: โหวตสายแฝงออก → พลเมืองชนะ
        guard = 0;
        while (hostView().phase === 'clue' && guard++ < 10) {
            const sp = hostView().speakerId;
            const page = pageOf(bots.find(b => b.id === sp));
            if (page) await page.click('#ucClueDoneBtn');
            else await botSpeak(bots.find(x => x.id === sp));
            await waitFor(() => hostView().speakerId !== sp || hostView().phase !== 'clue', 4000, 'next speaker r3');
        }
        await delay(400);
        // โหวตเสมอ 2:2 ระหว่างสายแฝงกับพลเมือง Y → สองคนนี้ใบ้เพิ่ม → คนที่เหลือโหวตใหม่ ต้องไม่มีชื่อที่เลือกไว้ก่อนเสมอติดมา
        const aliveIds = hostView().players.filter(p => p.alive).map(p => p.playerId);
        const yId = aliveIds.find(id => id !== uc.id && id !== host.id);
        let alt = 0;
        const tieTarget = id => (id === uc.id ? yId : (id === yId ? uc.id : (alt++ % 2 === 0 ? uc.id : yId)));
        const order3 = bots.filter(b => aliveIds.includes(b.id));
        for (const b of order3) {
            const t = tieTarget(b.id);
            const page = pageOf(b);
            if (page) { await pageVote(page, t); await page.click('#ucVoteConfirm'); await delay(250); }
            else await botVote(b, t);
        }
        await waitFor(() => hostView().phase === 'clue' && hostView().tieBreak, 5000, 'tie-break clues');
        await delay(600);
        for (const v of viewers) {
            assert(/เสมอ/.test(await v.page.textContent('#ucNow')), `${v.tag}: ช่วงใบ้เพิ่มต้องบอกว่าเสมอ`);
        }
        await snap('09a-tiebreak-clue');
        guard = 0;
        while (hostView().phase === 'clue' && guard++ < 4) {
            const sp = hostView().speakerId;
            assert([uc.id, yId].includes(sp), 'ใบ้เพิ่มเฉพาะคนที่เสมอ');
            const page = pageOf(bots.find(b => b.id === sp));
            if (page) await page.click('#ucClueDoneBtn');
            else await botSpeak(bots.find(x => x.id === sp), 'ใบ้เพิ่ม');
            await waitFor(() => hostView().speakerId !== sp || hostView().phase !== 'clue', 4000, 'next tie-break speaker');
        }
        await waitFor(() => hostView().phase === 'vote' && hostView().vote.isRevote, 5000, 'revote');
        await delay(600);
        for (const v of viewers) {
            if (![uc.id, yId].includes(v.bot.id) || !view(liveBots()[0]).players.find(p => p.playerId === v.bot.id)?.alive) continue;
            assert(!(await v.page.$('#ucVoteConfirm')), `${v.tag}: คนที่เสมอต้องไม่มีปุ่มโหวต`);
            assert(/เสมออยู่/.test(await v.page.textContent('#ucNowTitle')), `${v.tag}: คนที่เสมอต้องเห็นว่ารอคนอื่นโหวต`);
        }
        for (const v of viewers) {
            if (!(await v.page.$('#ucVoteConfirm'))) continue;
            assert(await v.page.$eval('#ucVoteConfirm', b => b.disabled), `${v.tag}: โหวตใหม่ต้องไม่มีตัวเลือกเดิมค้าง`);
            assert(!(await v.page.$('.uc-vote-tile.is-picked')), `${v.tag}: ไม่มีชื่อถูกเลือกค้างตอนโหวตใหม่`);
        }
        for (const v of viewers) {
            if (!(await v.page.$('#ucVoteConfirm'))) continue;
            assert(/เสมอกัน: /.test(await v.page.textContent('#ucNowSub')), `${v.tag}: โหวตใหม่ต้องบอกว่าใครเสมอกัน`);
        }
        await snap('09b-revote');
        for (const v of viewers) {
            if (!(await v.page.$('#ucVoteConfirm'))) continue;
            await pageVote(v.page, v.bot === uc ? yId : uc.id);
            await v.page.click('#ucVoteConfirm');
        }
        for (const b of liveBots()) {
            await botVote(b, b === uc ? yId : uc.id);
        }
        await waitFor(() => hostView().phase === 'finished', 5000, 'finished');
        await delay(1200);
        await snap('10-finished');
        for (const v of viewers) {
            const txt = await v.page.textContent('#ucStage');
            assert(/พลเมืองชนะ/.test(txt) && /คำสายแฝง/.test(txt), `${v.tag}: หน้าจบต้องบอกผู้ชนะและเปิดคำ`);
            assert(/ถูกโหวตออกรอบ 1/.test(txt) && /รอดถึงจบ/.test(txt), `${v.tag}: หน้าจบต้องบอกว่าใครออกรอบไหน`);
            assert(/คุณเป็น/.test(await v.page.textContent('#ucNowSub')), `${v.tag}: หน้าจบต้องบอกว่าตัวเองเป็นบทไหน`);
            assert(/\+2/.test(txt) && /คะแนนสะสมในห้องนี้/.test(txt), `${v.tag}: หน้าจบต้องโชว์แต้ม +2 และคะแนนสะสม`);
        }

        // desktop
        await desk.goto(`${base}/game/${roomId}?playerId=${liveBots()[1].id}`, { waitUntil: 'domcontentloaded' });
        await delay(1800);
        const deskProblems = await layoutProblems(desk);
        assert(deskProblems.length === 0, 'desktop layout: ' + deskProblems.join(' | '));
        assert(deskErrors.length === 0, 'desktop errors: ' + deskErrors.join(' | '));
        const deskFile = path.join(SHOT_DIR, '11-finished-desktop-1280.png');
        await desk.screenshot({ path: deskFile, fullPage: true });
        shots.push(deskFile);

        const broken = await pageOf(host).evaluate(() => Array.from(document.images).filter(i => i.getAttribute('src') && i.naturalWidth === 0).map(i => i.getAttribute('src')));
        assert(broken.length === 0, 'รูปแตก: ' + broken.join(', '));

        console.log(`✅ กระดานคำใครไม่เหมือนบนมือถือ/เดสก์ท็อป ผ่าน ${checks} checks · ${shots.length} ภาพ → ${SHOT_DIR}`);
    } catch (error) {
        // เก็บภาพทุกจอไว้ดูว่าค้างตรงไหน
        for (const v of (globalThis.__ucViewers || [])) {
            try { await v.page.screenshot({ path: path.join(SHOT_DIR, `fail-${v.tag}.png`), fullPage: true }); } catch {}
            if (v.errors && v.errors.length) console.error(v.tag, v.errors.slice(0, 3));
        }
        throw error;
    } finally {
        sockets.forEach(s => { try { s.close(); } catch {} });
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
