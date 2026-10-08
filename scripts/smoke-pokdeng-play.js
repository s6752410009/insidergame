/**
 * เล่นป๊อกเด้งผ่าน socket จริงจนจบโต๊ะ — คน 3 + บอท 2, หมุนเจ้ามือ, คนหลุดกลางมือ, สถิติ
 * รัน: npm run smoke:pokdeng:play   (SMOKE_PORT=8461 เพื่อกำหนดพอร์ต)
 */
require('./isolateTestData');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { io } = require('socket.io-client');

const delay = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function assert(c, m) { if (!c) throw new Error(m); checks += 1; }

async function getFreePort() {
    if (process.env.SMOKE_PORT) return Number(process.env.SMOKE_PORT);
    return new Promise(res => {
        const s = require('net').createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    });
}
function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            POKDENG_BET_MS: '5000',
            POKDENG_DEAL_MS: '500',
            POKDENG_DRAW_MS: '2500',
            POKDENG_DEALER_MS: '2500',
            POKDENG_RESULT_MS: '4000'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.logs = () => logs;
    return new Promise((res, rej) => {
        const t = setTimeout(() => { child.kill('SIGKILL'); rej(new Error('server timeout\n' + logs.slice(-600))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${port}`)) { clearTimeout(t); res(child); } });
        child.stderr.on('data', c => { logs += c; });
    });
}
function ack(s, e, p) { return new Promise(r => { const t = setTimeout(() => r({ __timeout: true }), 15000); s.emit(e, p, x => { clearTimeout(t); r(x); }); }); }
function conn(base) { return new Promise(r => { const s = io(base, { transports: ['websocket'], forceNew: true }); s.once('connect', () => r(s)); }); }
const last = p => p.states[p.states.length - 1];
async function waitFor(pred, ms = 20000, label = 'condition') {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (pred()) return true;
        await delay(60);
    }
    throw new Error('timeout waiting for ' + label);
}
const ctx = s => ({ step: s.step, phase: s.phase, handNumber: s.handNumber });

(async () => {
    const port = await getFreePort();
    const server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const players = [];
    try {
        for (let i = 0; i < 3; i += 1) {
            const socket = await conn(base);
            const id = randomUUID();
            socket.emit('initPlayer', id);
            const states = [];
            socket.on('pokdengState', s => states.push(s));
            players.push({ socket, id, states, name: 'P' + i });
        }
        await delay(400);
        const [host, p1, p2] = players;

        const created = await ack(host.socket, 'createRoom', { playerId: host.id, name: 'ป๊อกเด้ง', gameMode: 'pokdeng', maxPlayers: 6 });
        assert(created?.success, 'สร้างห้องป๊อกเด้งไม่ได้: ' + JSON.stringify(created));
        const roomId = created.roomId;
        host.socket.emit('setRoom', { roomId, playerId: host.id });
        for (const p of [p1, p2]) {
            assert((await ack(p.socket, 'joinRoom', { roomId, playerId: p.id }))?.success, 'join ไม่ได้');
            p.socket.emit('setRoom', { roomId, playerId: p.id });
        }
        await delay(400);
        const denied = await ack(p1.socket, 'pokdeng_addBots', { roomId, count: 2 });
        assert(denied && denied.success === false, 'คนที่ไม่ใช่หัวห้องเพิ่มบอทไม่ได้');
        const bots = await ack(host.socket, 'pokdeng_addBots', { roomId, count: 2 });
        assert(bots?.success && bots.added === 2, 'หัวห้องเพิ่มบอท 2 ตัว: ' + JSON.stringify(bots));
        console.log('1. ห้องป๊อกเด้ง คน 3 + บอท 2 ✓');

        assert((await ack(host.socket, 'startGameFromLobby', { roomId }))?.success, 'เริ่มเกมไม่ได้');
        await waitFor(() => last(p1)?.phase === 'bet', 15000, 'bet phase');
        let s1 = last(p1);
        assert(s1.dealerId === host.id, 'มือแรกหัวห้องเป็นเจ้ามือ');
        assert(s1.players.length === 5, 'ที่นั่ง 5');
        assert(s1.players.find(p => p.playerId === host.id).chips === 5000, 'เจ้ามือคงที่ถือ 5,000');
        assert(s1.rules && s1.rules.straights === true && s1.rules.mustDraw === false && s1.rules.maxBet === 500 && s1.limits.maxBet === 500, 'กติกาห้องค่าเริ่มต้น: นับเรียง · ไม่บังคับจั่ว · อั้น 500');
        const hostView = last(host);
        assert(!hostView.availableActions.canBet, 'เจ้ามือลงเดิมพันไม่ได้');
        const html = await (await fetch(`${base}/game/${roomId}?playerId=${p1.id}`)).text();
        assert(/pokdengBoard|pd-table/.test(html) && /ชิปในโต๊ะนี้ ไม่มีมูลค่าจริง/.test(html), 'หน้า /game แสดงโต๊ะป๊อกเด้ง + ป้ายชิปไม่มีมูลค่า');
        console.log('2. เริ่มโต๊ะ เจ้ามือ = หัวห้อง ✓');

        // ผิดกติกา
        let r = await ack(p1.socket, 'pokdeng_bet', { amount: 5, ...ctx(s1) });
        assert(r.success === false && /ขั้นต่ำ/.test(r.error), 'ลงต่ำกว่าขั้นต่ำต้องโดนปฏิเสธ');
        r = await ack(p1.socket, 'pokdeng_bet', { amount: 100, ...ctx(s1), step: s1.step - 1 });
        assert(r.success === false && /จังหวะ/.test(r.error), 'step เก่าต้องโดนปฏิเสธ');
        r = await ack(host.socket, 'pokdeng_bet', { amount: 100, ...ctx(s1) });
        assert(r.success === false, 'เจ้ามือลงไม่ได้');
        r = await ack(p1.socket, 'pokdeng_next', {});
        assert(r.success === false, 'คนอื่นกดมือต่อไปไม่ได้');
        r = await ack(p2.socket, 'pokdeng_end', {});
        assert(r.success === false, 'คนอื่นจบโต๊ะไม่ได้');
        r = await ack(p2.socket, 'pokdeng_rotate', { enabled: true });
        assert(r.success === false, 'คนอื่นตั้งหมุนเจ้ามือไม่ได้');
        r = await ack(p1.socket, 'pokdeng_sitin', {});
        assert(r.success === false && /ไม่ได้พักโต๊ะ/.test(r.error), 'ไม่ได้พักโต๊ะ กดกลับมาเล่นไม่ได้');
        console.log('3. ปฏิเสธคำสั่งผิดกติกา/ผิดสิทธิ์/step เก่า ✓');

        // สลับแบบเจ้ามือก่อนแจกมือแรก: ปิด→เปิด→ปิด→เปิด กองหัวห้องต้องตามแบบ (ไม่ค้าง 5,000)
        r = await ack(host.socket, 'pokdeng_rotate', { enabled: true });
        assert(r.success, 'มือแรกก่อนแจก หัวห้องเปิดหมุนได้: ' + JSON.stringify(r));
        await waitFor(() => last(p1)?.rotateDealer === true, 3000, 'เห็นหมุนเจ้ามือ');
        assert(last(p1).players.find(p => p.playerId === host.id).chips === 1000, 'เปิดหมุน: หัวห้องเหลือ 1,000');
        r = await ack(host.socket, 'pokdeng_rotate', { enabled: false });
        await waitFor(() => last(p1)?.rotateDealer === false, 3000, 'เห็นเจ้ามือคงที่');
        assert(last(p1).players.find(p => p.playerId === host.id).chips === 5000, 'ปิดหมุน: หัวห้องกลับมาถือ 5,000');
        r = await ack(host.socket, 'pokdeng_rotate', { enabled: true });
        assert(r.success, 'เปิดหมุนอีกครั้ง');
        await waitFor(() => last(p1)?.rotateDealer === true, 3000, 'หมุนเจ้ามือ');
        console.log('3b. สลับแบบเจ้ามือก่อนแจกมือแรก · ปรับกองหัวห้อง ✓');

        const handsSeen = new Set();
        const dealers = [];
        let lockChecked = false;
        let sitOutSeen = false;
        let sitInOk = false;
        let droppedP2 = false;
        let leakChecks = 0;
        let readyAt = 0;
        let readyAdvanceMs = -1;
        for (let guard = 0; guard < 900; guard += 1) {
            const s = last(p1);
            if (!s) { await delay(60); continue; }
            if (s.phase === 'finished') break;
            if (s.phase === 'result' && !handsSeen.has(s.handNumber)) {
                handsSeen.add(s.handNumber);
                dealers.push(s.dealerId);
                const net = s.players.reduce((sum, p) => sum + p.net, 0);
                assert(net === 0, `มือ ${s.handNumber}: ผลรวมกำไรขาดทุนต้องเป็น 0 (${net})`);
                assert(s.lastResult && (s.lastResult.empty || s.lastResult.dealer), 'สรุปผลมีข้อมูลเจ้ามือ');
                (s.lastResult.rows || []).forEach(row => assert(typeof row.delta === 'number' && row.label, 'ผลแต่ละขามีแต้ม/ยอด'));
                if (s.handNumber === 2 && !lockChecked) {
                    const rr = await ack(host.socket, 'pokdeng_rotate', { enabled: false });
                    assert(rr.success === false && /ก่อนแจกไพ่มือแรก/.test(rr.error), 'หลังแจกมือแรก เปลี่ยนแบบเจ้ามือไม่ได้: ' + JSON.stringify(rr));
                    lockChecked = true;
                }
                if (s.handNumber >= 5) {
                    const end = await ack(host.socket, 'pokdeng_end', {});
                    assert(end.success, 'หัวห้องจบโต๊ะได้');
                    break;
                }
                // มือ 2: คนจริงกด "พร้อม" ครบ → ต้องไปมือต่อไปเลย ไม่รอนาฬิกา 4 วิ
                if (s.handNumber === 2) {
                    const first = await ack(p1.socket, 'pokdeng_ready', {});
                    assert(first.success, 'p1 กดพร้อม: ' + JSON.stringify(first));
                    await waitFor(() => (last(p2)?.readyIds || []).includes(p1.id), 3000, 'p2 เห็นว่า p1 พร้อม');
                    assert(last(p2).phase === 'result' && last(p2).availableActions.canReady, 'ยังไม่ครบ ยังอยู่สรุปผล');
                    readyAt = Date.now();
                    await ack(p2.socket, 'pokdeng_ready', {});
                    const fin = await ack(host.socket, 'pokdeng_ready', {});
                    assert(fin.success, 'หัวห้องกดพร้อม');
                    await waitFor(() => last(p1)?.handNumber === 3, 3000, 'พร้อมครบแล้วไปมือ 3');
                    readyAdvanceMs = Date.now() - readyAt;
                    assert(readyAdvanceMs < 2500, `พร้อมครบต้องไปต่อทันที (${readyAdvanceMs}ms)`);
                }
                if (s.handNumber % 2 === 1) {
                    const nx = await ack(host.socket, 'pokdeng_next', {});
                    assert(nx.success || /ยังไม่จบมือ/.test(nx.error || ''), 'หัวห้องกดมือต่อไป: ' + JSON.stringify(nx));
                }
            }
            for (const p of players) {
                if (p.socket.disconnected) continue;
                const v = last(p);
                if (!v || v.phase === 'finished') continue;
                const a = v.availableActions || {};
                // p1 ไม่อยู่หน้าจอมือ 3–4 (ไม่ลงเดิมพัน) → มือ 3 ลงขั้นต่ำให้ · มือ 4 พักโต๊ะ แล้วกดกลับมาเล่น
                if (p === p1 && a.canSitIn) {
                    sitOutSeen = true;
                    assert(v.self.sittingOut && v.players.find(x => x.playerId === p1.id).sittingOut, 'ทุกคนเห็นว่า p1 พักโต๊ะ');
                    const back = await ack(p1.socket, 'pokdeng_sitin', {});
                    assert(back.success, 'กลับมาเล่นได้: ' + JSON.stringify(back));
                    sitInOk = true;
                    continue;
                }
                if (p === p1 && v.phase === 'bet' && (v.handNumber === 3 || v.handNumber === 4) && !sitInOk) continue;
                if (a.canBet && v.phase === 'bet') {
                    await ack(p.socket, 'pokdeng_bet', { amount: Math.min(a.maxBet, 50 + 10 * (guard % 7)), ...ctx(v) });
                } else if (a.canRebuy) {
                    await ack(p.socket, 'pokdeng_rebuy', {});
                } else if (a.canDraw) {
                    // ความลับ: ตอนจั่ว ไพ่คนอื่นที่ยังไม่เปิดต้องเป็น null
                    v.players.filter(x => !x.isSelf && !x.revealed && x.cardCount > 0).forEach(x => {
                        assert(x.cards === null, `รั่ว: ${p.name} เห็นไพ่ ${x.name}`);
                        leakChecks += 1;
                    });
                    const pts = v.self.eval ? v.self.eval.points : 0;
                    await ack(p.socket, 'pokdeng_draw', { draw: pts <= 4, ...ctx(v) });
                } else if (a.canDealerDecide) {
                    const pts = v.self.eval ? v.self.eval.points : 0;
                    await ack(p.socket, 'pokdeng_dealer', { draw: pts <= 3, ...ctx(v) });
                }
            }
            // มือที่ 3: p2 หลุดกลางมือ (ปิด socket) → เกมต้องเดินต่อเอง
            if (!droppedP2 && s.handNumber === 3 && ['deal', 'draw'].includes(s.phase)) {
                p2.socket.disconnect();
                droppedP2 = true;
                console.log('   · p2 หลุดกลางมือที่ 3');
            }
            await delay(120);
        }
        await waitFor(() => last(p1)?.phase === 'finished', 20000, 'finished');
        const fin = last(p1);
        assert(handsSeen.size >= 5, `เล่นอย่างน้อย 5 มือ (${handsSeen.size})`);
        assert(dealers[0] === host.id && dealers[1] === p1.id, 'หมุนเจ้ามือ: หัวห้อง → p1 ' + dealers.join(','));
        assert(new Set(dealers).size >= 3, `หมุนเจ้ามือแล้วเจ้ามือต้องเปลี่ยน: ${dealers.join(',')}`);
        assert(lockChecked, 'ได้ทดสอบล็อกแบบเจ้ามือ');
        assert(sitOutSeen && sitInOk, 'p1 หมดเวลา 2 มือติด → พักโต๊ะ → กลับมาเล่น');
        console.log('   · p1 หมดเวลาลงเดิมพัน 2 มือติด → พักโต๊ะ → กลับมาเล่น ✓');
        assert(leakChecks > 0, 'ต้องตรวจความลับตอนจั่วได้อย่างน้อยครั้งหนึ่ง');
        assert(readyAdvanceMs >= 0, 'ได้ทดสอบปุ่มพร้อมมือต่อไป');
        console.log(`   · พร้อมครบ 3 คน → มือต่อไปใน ${readyAdvanceMs}ms (ไม่รอนาฬิกา 4 วิ)`);
        console.log(`4. เล่น ${handsSeen.size} มือ · บอทเล่นเอง · หมุนเจ้ามือ (${dealers.map(d => d.slice(0, 6)).join(' → ')}) · ความลับ ${leakChecks} จุด ✓`);

        assert(fin.standings && fin.standings.length >= 3, 'จบโต๊ะมีตารางสรุป');
        const netSum = fin.standings.reduce((sum, row) => sum + row.net, 0);
        assert(netSum === 0, `ผลรวมกำไรขาดทุนตอนจบ = 0 (${netSum})`);
        console.log('5. จบโต๊ะ มีตารางสรุป กำไร/ขาดทุนรวม 0 ✓');

        await delay(1500);
        const statsFile = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
        const stats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};
        const rows = Array.isArray(stats) ? stats : Object.values(stats);
        // เกมที่มีบอทร่วมโต๊ะไม่นับสถิติให้ใครเลย (กันปั๊มชนะกับบอท) — คนจริงทั้ง 3 ต้องไม่ได้สถิติ
        [host, p1, p2].forEach(p => {
            const row = rows.find(r => r.playerId === p.id);
            assert(!(row && row.modeStats?.pokdeng?.games), `โต๊ะที่มีบอทต้องไม่นับสถิติให้ ${p.name}: ` + JSON.stringify(row?.modeStats?.pokdeng));
        });
        assert(!rows.some(row => String(row.playerId).startsWith('bot_')), 'ไม่บันทึกสถิติบอท');
        console.log('6. โต๊ะที่มีบอท: ไม่นับสถิติให้ใครเลย ✓');

        const back = new Promise(res => host.socket.once('redirectToLobby', () => res(true)));
        const ret = await ack(host.socket, 'returnFinishedToLobby', { roomId });
        assert(ret.success, 'กลับห้องรอได้');
        assert(await Promise.race([back, delay(4000).then(() => false)]), 'ทุกคนถูกพากลับห้องรอ');
        await delay(500);
        // ตั้งกติกาห้องในห้องรอ: อั้น 100 · ต่ำกว่า 4 ต้องจั่ว · ไม่นับไพ่เรียง · เจ้ามือคงที่
        const notAdmin = await ack(p1.socket, 'updateRoom', { pokdengMaxBet: 200 });
        assert(notAdmin.success === false, 'คนที่ไม่ใช่หัวห้องตั้งกติกาไม่ได้');
        const upd = await ack(host.socket, 'updateRoom', { pokdengMaxBet: 100, pokdengMustDraw: true, pokdengStraights: false, pokdengRotateDealer: false });
        assert(upd.success && upd.room.settings.pokdengMaxBet === 100 && upd.room.settings.pokdengMustDraw === true && upd.room.settings.pokdengStraights === false, 'หัวห้องตั้งกติกาได้: ' + JSON.stringify(upd.room && upd.room.settings));
        const junk = await ack(host.socket, 'updateRoom', { pokdengMaxBet: 9999 });
        assert(junk.success && junk.room.settings.pokdengMaxBet === 100, 'อั้นแปลก ๆ ไม่เปลี่ยนค่า');
        const again = await ack(host.socket, 'startGameFromLobby', { roomId });
        assert(again.success, 'เปิดโต๊ะใหม่ได้อีกรอบ');
        await waitFor(() => last(p1)?.phase === 'bet' && last(p1).handNumber === 1, 15000, 'new table');
        await delay(2000);
        const stats2 = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};
        const hostStat2 = (Array.isArray(stats2) ? stats2 : Object.values(stats2)).find(row => row.playerId === host.id);
        assert(!(hostStat2 && hostStat2.modeStats?.pokdeng?.games), 'โต๊ะที่มีบอทยังไม่นับสถิติ');
        console.log('7. กลับห้องรอ → เปิดโต๊ะใหม่ได้ ✓');

        // ---------- 8. กติกาห้องเปิด: อั้น 100 · ต่ำกว่า 4 ต้องจั่ว · ไม่นับเรียง · เจ้ามือจับ ----------
        let v8 = last(p1);
        assert(v8.rules.maxBet === 100 && v8.rules.mustDraw === true && v8.rules.straights === false && v8.limits.maxBet === 100, 'โต๊ะใหม่ใช้กติกาห้อง: ' + JSON.stringify(v8.rules));
        assert(v8.rotateDealer === false && v8.dealerId === host.id, 'เจ้ามือคงที่ = หัวห้อง');
        let overMax = false; let mustDrawRejected = false; let caught = 0; let catchDenied = false; let straightLabels = 0;
        const seen8 = new Set();
        for (let guard = 0; guard < 700; guard += 1) {
            const hv = last(host); const pv = last(p1);
            if (!hv || !pv) { await delay(60); continue; }
            if (pv.phase === 'result' && !seen8.has(pv.handNumber)) {
                seen8.add(pv.handNumber);
                (pv.lastResult && pv.lastResult.rows || []).forEach(row => { if (/เรียง|สเตรทฟลัช/.test(row.label)) straightLabels += 1; });
                const net = pv.players.reduce((sum, p) => sum + p.net, 0);
                assert(net === 0, `โต๊ะ 2 มือ ${pv.handNumber}: ชิปรวมคงที่ (${net})`);
                if ((caught && mustDrawRejected && overMax) || pv.handNumber >= 12) break;
                await ack(host.socket, 'pokdeng_next', {});
                continue;
            }
            const pa = pv.availableActions || {};
            if (pa.canBet && pv.phase === 'bet') {
                if (!overMax) {
                    const big = await ack(p1.socket, 'pokdeng_bet', { amount: 150, ...ctx(pv) });
                    assert(big.success === false && /สูงสุด 100/.test(big.error), 'อั้น 100: ลง 150 ไม่ได้');
                    overMax = true;
                }
                await ack(p1.socket, 'pokdeng_bet', { amount: Math.min(pa.maxBet, 100), ...ctx(last(p1)) });
            } else if (pa.canDraw) {
                if (pa.mustDraw && !mustDrawRejected) {
                    const stay = await ack(p1.socket, 'pokdeng_draw', { draw: false, ...ctx(pv) });
                    assert(stay.success === false && /ต้องจั่ว/.test(stay.error), 'ต่ำกว่า 4 กดอยู่ไม่ได้: ' + JSON.stringify(stay));
                    mustDrawRejected = true;
                }
                // จั่วทุกครั้ง (ถ้าไม่ป๊อก) ให้มีขา 3 ใบให้เจ้ามือจับ
                await ack(p1.socket, 'pokdeng_draw', { draw: true, ...ctx(last(p1)) });
            }
            const ha = hv.availableActions || {};
            if (ha.canDealerDecide && hv.phase === 'dealer') {
                if (!catchDenied) {
                    const deny = await ack(p1.socket, 'pokdeng_dealer_catch', { group: 3, ...ctx(pv) });
                    assert(deny.success === false, 'ขาไพ่สั่งจับไม่ได้');
                    catchDenied = true;
                }
                if (ha.canCatch3) {
                    const res = await ack(host.socket, 'pokdeng_dealer_catch', { group: 3, ...ctx(hv) });
                    assert(res.success, 'เจ้ามือจับ 3 ใบ: ' + JSON.stringify(res));
                    await waitFor(() => (last(p1)?.settledRows || []).length > 0 || last(p1)?.phase === 'result', 3000, 'ทุกคนเห็นผลจับ');
                    const vv = last(p1);
                    if (vv.phase === 'dealer') {
                        assert(vv.players.find(p => p.playerId === host.id).cards.length === 2, 'จับแล้วเห็นไพ่เจ้ามือ 2 ใบ');
                        assert(vv.settledRows.every(r => r.caught && r.dealerLabel), 'แถวที่จับมีมือเจ้ามือ');
                    }
                    caught += 1;
                } else {
                    const pts = hv.self.eval ? hv.self.eval.points : 0;
                    await ack(host.socket, 'pokdeng_dealer', { draw: ha.mustDraw || pts <= 4, ...ctx(hv) });
                }
            }
            await delay(100);
        }
        assert(overMax && mustDrawRejected && caught > 0, `กติกาห้องทำงานผ่าน socket (อั้น ${overMax} · บังคับจั่ว ${mustDrawRejected} · จับ ${caught})`);
        assert(straightLabels === 0, 'ไม่นับไพ่เรียง: ไม่มีผลที่เป็นเรียง/สเตรทฟลัช');
        console.log(`8. กติกาห้อง: อั้น 100 · ต่ำกว่า 4 ต้องจั่ว · ไม่นับเรียง · เจ้ามือจับ ${caught} ครั้ง ใน ${seen8.size} มือ ✓`);

        // ---------- 9. เจ้ามือ (หัวห้อง) ออกจากห้องกลางมือ → ยกเลิกมือ คืนเดิมพัน เจ้ามือคนถัดไป ไม่ค้าง ----------
        if (last(p1).phase === 'result') await ack(host.socket, 'pokdeng_next', {});
        await waitFor(() => last(p1)?.phase === 'bet' && last(p1).availableActions.canBet, 15000, 'มือใหม่ก่อนเจ้ามือออก');
        const chipsBefore = last(p1).self.chips;
        await ack(p1.socket, 'pokdeng_bet', { amount: 50, ...ctx(last(p1)) });
        await waitFor(() => ['deal', 'draw', 'dealer', 'result'].includes(last(p1)?.phase), 15000, 'แจกไพ่แล้ว');
        const midPhase = last(p1).phase;
        const handBefore = last(p1).handNumber;
        const left = await ack(host.socket, 'leaveRoom', { roomId, playerId: host.id });
        assert(left.success, 'หัวห้องออกได้');
        if (midPhase !== 'result') {
            await waitFor(() => last(p1)?.dealerId === p1.id && last(p1).phase === 'bet' && last(p1).handNumber === handBefore + 1, 10000, 'เจ้ามือออกกลางมือ → มือใหม่ p1 เป็นเจ้ามือ');
            assert(last(p1).self.chips === chipsBefore, `คืนเดิมพัน p1 ครบ (${last(p1).self.chips}/${chipsBefore})`);
            assert(last(p1).history.some(h => /เจ้ามือออกกลางมือ/.test(h.text)), 'บันทึกโต๊ะบอกว่ายกเลิกมือ');
        }
        await waitFor(() => last(p1)?.isHost === true, 5000, 'หัวห้องย้ายมาที่ p1 (คนจริงคนเดียวที่เหลือ)');
        const hostSeat = last(p1).players.find(p => p.playerId === host.id);
        assert(!hostSeat || hostSeat.left, 'หัวห้องเดิมถูกทำเครื่องหมายว่าออกแล้ว');
        console.log(`9. เจ้ามือออกจากห้อง (${midPhase}) → ${midPhase !== 'result' ? 'ยกเลิกมือ คืนเดิมพัน · ' : ''}p1 เป็นหัวห้อง/เจ้ามือ ✓`);

        // ---------- 10. โต๊ะคนล้วน 2 คน (ไม่มีบอท) → สถิติยังนับครบ ชนะ = จบแล้วชิปเกินทุน ----------
        {
            const pair = [];
            for (let i = 0; i < 2; i += 1) {
                const socket = await conn(base);
                const id = randomUUID();
                socket.emit('initPlayer', id);
                const states = [];
                socket.on('pokdengState', st => states.push(st));
                pair.push({ socket, id, states, name: 'Q' + i });
            }
            await delay(400);
            const [qHost, qGuest] = pair;
            const made = await ack(qHost.socket, 'createRoom', { playerId: qHost.id, name: 'ป๊อกเด้งคนล้วน', gameMode: 'pokdeng', maxPlayers: 6 });
            assert(made?.success, 'สร้างห้องคนล้วนไม่ได้');
            qHost.socket.emit('setRoom', { roomId: made.roomId, playerId: qHost.id });
            assert((await ack(qGuest.socket, 'joinRoom', { roomId: made.roomId, playerId: qGuest.id }))?.success, 'join ห้องคนล้วนไม่ได้');
            qGuest.socket.emit('setRoom', { roomId: made.roomId, playerId: qGuest.id });
            await delay(400);
            assert((await ack(qHost.socket, 'startGameFromLobby', { roomId: made.roomId }))?.success, 'เริ่มโต๊ะคนล้วนไม่ได้');
            let ended = false;
            for (let guard = 0; guard < 600 && last(qGuest)?.phase !== 'finished'; guard += 1) {
                const v0 = last(qGuest);
                if (v0 && v0.phase === 'result' && v0.handNumber >= 2 && !ended) {
                    assert((await ack(qHost.socket, 'pokdeng_end', {})).success, 'หัวห้องจบโต๊ะคนล้วนได้');
                    ended = true;
                }
                if (v0 && v0.phase === 'result' && !ended) await ack(qHost.socket, 'pokdeng_next', {});
                for (const p of pair) {
                    const v = last(p);
                    if (!v || v.phase === 'finished') continue;
                    const a = v.availableActions || {};
                    if (a.canBet && v.phase === 'bet') await ack(p.socket, 'pokdeng_bet', { amount: Math.min(a.maxBet, 100), ...ctx(v) });
                    else if (a.canDraw) await ack(p.socket, 'pokdeng_draw', { draw: (v.self.eval ? v.self.eval.points : 0) <= 4, ...ctx(v) });
                    else if (a.canDealerDecide) await ack(p.socket, 'pokdeng_dealer', { draw: (v.self.eval ? v.self.eval.points : 0) <= 3, ...ctx(v) });
                }
                await delay(120);
            }
            await waitFor(() => last(qGuest)?.phase === 'finished', 20000, 'โต๊ะคนล้วนจบ');
            const finQ = last(qGuest);
            const readRows = () => {
                const raw = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};
                return Array.isArray(raw) ? raw : Object.values(raw);
            };
            await waitFor(() => pair.every(p => readRows().find(r => r.playerId === p.id)?.modeStats?.pokdeng?.games === 1), 6000, 'สถิติโต๊ะคนล้วน');
            const qRow = readRows().find(r => r.playerId === qGuest.id);
            const qWin = finQ.standings.find(r => r.playerId === qGuest.id).net > 0;
            assert((qRow.modeStats.pokdeng.wins === 1) === qWin, 'โต๊ะคนล้วน: ชนะ/แพ้ตามกำไร');
            pair.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });
            console.log('10. โต๊ะคนล้วน 2 คน → สถิติบันทึกครบ ชนะ = ชิปเกินทุน ✓');
        }

        assert(!/\[pokdeng\].*failed/.test(server.logs()), 'server log มี error ของป๊อกเด้ง:\n' + server.logs().split('\n').filter(l => /pokdeng/.test(l)).slice(-5).join('\n'));
        players.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });
        console.log(`\n✅ smoke-pokdeng-play: ${checks} checks passed`);
    } finally {
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
