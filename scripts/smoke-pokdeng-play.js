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
            POKDENG_RESULT_MS: '1500'
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
        console.log('3. ปฏิเสธคำสั่งผิดกติกา/ผิดสิทธิ์/step เก่า ✓');

        const handsSeen = new Set();
        const dealers = [];
        let rotated = false;
        let droppedP2 = false;
        let leakChecks = 0;
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
                if (s.handNumber === 2 && !rotated) {
                    const rr = await ack(host.socket, 'pokdeng_rotate', { enabled: true });
                    assert(rr.success, 'หัวห้องเปิดหมุนเจ้ามือ');
                    rotated = true;
                }
                if (s.handNumber >= 5) {
                    const end = await ack(host.socket, 'pokdeng_end', {});
                    assert(end.success, 'หัวห้องจบโต๊ะได้');
                    break;
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
        assert(dealers[0] === host.id && dealers[1] === host.id, 'ก่อนเปิดหมุน เจ้ามือคงที่');
        assert(new Set(dealers.slice(2)).size >= 2, `เปิดหมุนแล้วเจ้ามือต้องเปลี่ยน: ${dealers.join(',')}`);
        assert(leakChecks > 0, 'ต้องตรวจความลับตอนจั่วได้อย่างน้อยครั้งหนึ่ง');
        console.log(`4. เล่น ${handsSeen.size} มือ · บอทเล่นเอง · หมุนเจ้ามือ (${dealers.map(d => d.slice(0, 6)).join(' → ')}) · ความลับ ${leakChecks} จุด ✓`);

        assert(fin.standings && fin.standings.length >= 3, 'จบโต๊ะมีตารางสรุป');
        const netSum = fin.standings.reduce((sum, row) => sum + row.net, 0);
        assert(netSum === 0, `ผลรวมกำไรขาดทุนตอนจบ = 0 (${netSum})`);
        console.log('5. จบโต๊ะ มีตารางสรุป กำไร/ขาดทุนรวม 0 ✓');

        await delay(1500);
        const statsFile = path.join(process.env.GAME_DATA_DIR, 'playerStats.json');
        const stats = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};
        const rows = Array.isArray(stats) ? stats : Object.values(stats);
        const hostStat = rows.find(row => row.playerId === host.id);
        assert(hostStat && hostStat.modeStats?.pokdeng?.games === 1, 'บันทึกสถิติป๊อกเด้งของหัวห้อง 1 เกม: ' + JSON.stringify(hostStat?.modeStats?.pokdeng));
        const p1Stat = rows.find(row => row.playerId === p1.id);
        assert(p1Stat && p1Stat.modeStats.pokdeng.games === 1, 'p1 บันทึก 1 เกม');
        const expectWin = fin.standings.find(row => row.playerId === p1.id).net > 0;
        assert((p1Stat.modeStats.pokdeng.wins === 1) === expectWin, 'ชนะ/แพ้ตามกำไร');
        assert(!rows.some(row => String(row.playerId).startsWith('bot_')), 'ไม่บันทึกสถิติบอท');
        console.log('6. สถิติบันทึกครั้งเดียว ชนะ = จบแล้วชิปเกินทุน ✓');

        const back = new Promise(res => host.socket.once('redirectToLobby', () => res(true)));
        const ret = await ack(host.socket, 'returnFinishedToLobby', { roomId });
        assert(ret.success, 'กลับห้องรอได้');
        assert(await Promise.race([back, delay(4000).then(() => false)]), 'ทุกคนถูกพากลับห้องรอ');
        await delay(500);
        const again = await ack(host.socket, 'startGameFromLobby', { roomId });
        assert(again.success, 'เปิดโต๊ะใหม่ได้อีกรอบ');
        await waitFor(() => last(p1)?.phase === 'bet' && last(p1).handNumber === 1, 15000, 'new table');
        await delay(2000);
        const stats2 = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
        const hostStat2 = (Array.isArray(stats2) ? stats2 : Object.values(stats2)).find(row => row.playerId === host.id);
        assert(hostStat2.modeStats.pokdeng.games === 1, 'สถิติยังเป็น 1 (ไม่บันทึกซ้ำ)');
        console.log('7. กลับห้องรอ → เปิดโต๊ะใหม่ได้ · สถิติไม่ซ้ำ ✓');

        assert(!/\[pokdeng\].*failed/.test(server.logs()), 'server log มี error ของป๊อกเด้ง:\n' + server.logs().split('\n').filter(l => /pokdeng/.test(l)).slice(-5).join('\n'));
        players.forEach(p => { try { p.socket.close(); } catch (e) { /* ignore */ } });
        console.log(`\n✅ smoke-pokdeng-play: ${checks} checks passed`);
    } finally {
        server.kill('SIGTERM');
    }
    process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
