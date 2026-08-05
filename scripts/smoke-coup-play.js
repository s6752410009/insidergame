/**
 * เล่น Coup จนจบในเบราว์เซอร์จริง — ตรวจว่า UI กับ engine คุยกันถูก
 *
 * ครอบ: ตาของตัวเอง → เลือกแอ็กชัน → ตอบโต้ (ท้า/ขวาง/ผ่าน) → หงายการ์ด → จบเกม
 * และไม่มี JS error / รูปการ์ดไม่แตก ตลอดเกม
 *
 * รัน: node scripts/smoke-coup-play.js
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

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();

    try {
        const players = [];
        for (let i = 0; i < 3; i++) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('coupState', s => states.push(s));
            players.push({ socket, id, states });
        }
        await delay(500);

        const created = await ack(players[0].socket, 'createRoom', {
            playerId: players[0].id, name: 'CoupPlay', gameMode: 'coup', maxPlayers: 6
        });
        assert(created?.success, 'สร้างห้อง coup ไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        players[0].socket.emit('setRoom', { roomId, playerId: players[0].id });
        for (const p of players.slice(1)) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(700);
        assert((await ack(players[0].socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await delay(2500);
        console.log('1. ตั้งห้อง Coup 3 คน เริ่มเกมแล้ว ✓');

        // เบราว์เซอร์เข้าเป็นผู้เล่นคนแรก (คนที่ได้เล่นตาแรก)
        players[0].socket.close();
        const page = await (await browser.newContext({ viewport: { width: 1100, height: 950 } })).newPage();
        const errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error' && !/mp3|favicon|autoplay|vibrate/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 120)); });
        await page.goto(`${base}/game/${roomId}?playerId=${players[0].id}`, { waitUntil: 'networkidle' });
        await delay(2500);

        const nowText = await page.textContent('#cpNowCopy');
        assert(/ตาคุณ/.test(nowText), 'ตาแรกต้องเป็นของผู้เล่นในเบราว์เซอร์ (ได้: ' + nowText + ')');
        console.log('2. แถบสถานะบอกว่าถึงตาเราแล้ว ✓');

        const handCount = await page.$$eval('#myHand .cp-influence:not(.is-revealed)', els => els.length);
        assert(handCount === 2, `ต้องเห็นการ์ดของตัวเอง 2 ใบ (ได้ ${handCount})`);
        const actionCount = await page.$$eval('.cp-action', els => els.length);
        assert(actionCount >= 5, `ต้องมีปุ่มแอ็กชันให้เลือก (ได้ ${actionCount})`);
        console.log(`3. เห็นการ์ดตัวเอง 2 ใบ และปุ่มแอ็กชัน ${actionCount} ปุ่ม ✓`);

        // กด Tax (ต้องอ้างว่ามี Duke) → เปิดให้คนอื่นตอบโต้
        await page.click('.cp-action[data-action="tax"]');
        await delay(1200);
        const afterTax = players[1].states[players[1].states.length - 1];
        assert(afterTax.phase === 'respond', 'กด Tax แล้วต้องเข้าเฟสตอบโต้');
        console.log('4. กด Tax ผ่าน UI → เข้าเฟสตอบโต้ ✓');

        // อีกสองคนปล่อยผ่าน → ได้ 3 เหรียญ
        await ack(players[1].socket, 'coup_respond', { response: 'pass' });
        await ack(players[2].socket, 'coup_respond', { response: 'pass' });
        await delay(1500);
        const coins = await page.textContent('#myCoins');
        assert(Number(coins) === 5, `Tax สำเร็จต้องมี 5 เหรียญ (ได้ ${coins})`);
        console.log('5. ทุกคนปล่อยผ่าน → ได้ 3 เหรียญ UI อัปเดตถูก ✓');

        // ตาคนที่ 2 ประกาศ Tax แล้วเบราว์เซอร์กด "ท้า" ผ่าน UI
        await ack(players[1].socket, 'coup_submitAction', { actionId: 'tax' });
        await delay(1500);
        const challengeBtn = await page.$('[data-respond="challenge"]');
        assert(challengeBtn, 'ต้องเห็นปุ่มท้าเมื่อคนอื่นประกาศแอ็กชัน');
        await challengeBtn.click();
        await delay(1800);
        console.log('6. กดปุ่มท้าผ่าน UI ได้ ✓');

        // ไล่เกมจนจบด้วย socket (คนที่เหลือ) แล้วเช็คว่าจอประกาศผู้ชนะ
        for (let guard = 0; guard < 120; guard++) {
            const state = players[1].states[players[1].states.length - 1];
            if (!state || state.phase === 'finished') break;

            for (const p of players.slice(1)) {
                const view = p.states[p.states.length - 1];
                if (!view) continue;
                try {
                    if (view.phase === 'lose-influence' && view.pendingLoss?.isMe) {
                        await ack(p.socket, 'coup_loseInfluence', { cardId: view.self.influence[0].id });
                    } else if (view.phase === 'exchange' && view.pendingExchange?.options) {
                        await ack(p.socket, 'coup_exchange', {
                            keepCardIds: view.pendingExchange.options.slice(0, view.pendingExchange.keepCount).map(c => c.id)
                        });
                    } else if (view.availableResponses) {
                        await ack(p.socket, 'coup_respond', { response: 'pass' });
                    } else if (view.isMyTurn && view.availableActions?.length) {
                        // เร่งเกมให้จบ: รัฐประหารทันทีที่ซื้อไหว ไม่งั้นเก็บภาษี (+3) เร็วกว่ารับรายได้ (+1)
                        const action = view.availableActions.find(a => a.id === 'coup')
                            || view.availableActions.find(a => a.id === 'tax')
                            || view.availableActions[0];
                        const target = view.players.find(x => x.alive && x.playerId !== p.id);
                        await ack(p.socket, 'coup_submitAction', {
                            actionId: action.id, targetPlayerId: action.needsTarget ? target?.playerId : null
                        });
                    }
                } catch {}
            }
            // เบราว์เซอร์ก็ต้องเล่นด้วย ไม่งั้นเกมค้างรอ (เลือกแอ็กชันแรกที่กดได้)
            const mine = await page.$('.cp-action[data-action="tax"]') || await page.$('.cp-action[data-action="income"]');
            if (mine) await mine.click().catch(() => {});
            const pickTarget = await page.$('[data-target]');
            if (pickTarget) await pickTarget.click().catch(() => {});
            const pass = await page.$('[data-respond="pass"]');
            if (pass) await pass.click().catch(() => {});
            const pick = await page.$('#myHand .cp-influence.is-pick');
            if (pick) await pick.click().catch(() => {});
            await delay(700);
        }

        const finalState = players[1].states[players[1].states.length - 1];
        assert(finalState?.phase === 'finished', `เกมต้องจบได้ (phase=${finalState?.phase})`);
        console.log(`7. เล่นจนจบเกม — ผู้ชนะ: ${finalState.winner?.name} ✓`);

        await delay(1500);
        const bodyText = await page.textContent('body');
        assert(/ชนะ/.test(bodyText), 'จอต้องประกาศผู้ชนะ');

        const broken = await page.evaluate(() => Array.from(document.images)
            .filter(img => img.getAttribute('src') && img.naturalWidth === 0)
            .map(img => img.getAttribute('src')));
        assert(broken.length === 0, 'รูปการ์ดแตก: ' + broken.join(', '));
        assert(errors.length === 0, 'มี JS error: ' + errors.slice(0, 3).join(' | '));
        console.log('8. จอประกาศผู้ชนะ · รูปการ์ดไม่แตก · ไม่มี JS error ✓');

        // จบเกมแล้วกลับห้องได้
        const res = await fetch(`${base}/room/${roomId}?playerId=${players[1].id}`, { redirect: 'manual' });
        const loc = res.headers.get('location') || '';
        assert(!(res.status === 302 && loc.includes('/game/')), 'จบเกมแล้วกลับห้องไม่ได้');
        console.log(`9. จบเกมแล้วกลับห้องได้ (HTTP ${res.status}) ✓`);

        players.forEach(p => { try { p.socket.close(); } catch {} });
        console.log('\n✅ COUP เล่นได้จริงครบวงจร');
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
