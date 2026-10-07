/**
 * เทส API ป๊อกเด้งท้าเจ้ามือ ผ่าน HTTP จริง (spawn เซิร์ฟเวอร์เอง ใช้ data ชั่วคราว)
 * รัน: node scripts/api-solo-pokdengsolo.js   (PORT ตั้งได้ด้วย SOLO_TEST_PORT)
 *
 * ครอบคลุม: identity, เริ่ม/ต่อรอบ, ตรวจยอดเดิมพัน, ส่งซ้ำไม่หักซ้ำ, ไม่หลุดไพ่ลับ,
 *           POST /result ถูกปฏิเสธ, สถิติ/อันดับ, rate limit, รีสตาร์ตเซิร์ฟเวอร์กลางมือแล้วเล่นต่อได้
 */

require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const PORT = Number(process.env.SOLO_TEST_PORT) || 8490;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/solo/pokdengsolo`;

let passed = 0;
function assert(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed += 1;
}

function bootServer() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), MONGO_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('startup timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => {
            logs += String(c);
            if (logs.includes(`Server started on port ${PORT}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', c => { logs += String(c); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}
function stopServer(child) {
    return new Promise(resolve => {
        child.removeAllListeners('exit');
        child.once('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ตายแล้ว */ } }, 8000);
    });
}

function jar() {
    const cookies = new Map();
    return {
        header() { return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; '); },
        take(res) {
            const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
            list.forEach(line => {
                const [pair] = line.split(';');
                const i = pair.indexOf('=');
                cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
            });
        }
    };
}

async function call(j, method, url, body) {
    const res = await fetch(url, {
        method,
        redirect: 'manual',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(j ? { Cookie: j.header() } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    if (j) j.take(res);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { status: res.status, data, text };
}

async function identity() {
    const j = jar();
    const id = randomUUID();
    await call(j, 'GET', `${BASE}/?playerId=${id}`);
    return { j, id };
}

(async () => {
    let server = await bootServer();
    try {
        // ---------- ไม่มีตัวตน ----------
        {
            const r = await call(null, 'GET', `${API}/state`);
            assert(r.status === 403, 'ไม่มี cookie → 403');
            const b = await call(null, 'POST', `${API}/bet`, { amount: 100, hand: 1 });
            assert(b.status === 403, 'ลงเดิมพันโดยไม่มีตัวตน → 403');
        }

        const { j, id } = await identity();

        // ---------- เริ่มรอบ ----------
        let r = await call(j, 'GET', `${API}/state`);
        assert(r.status === 200 && r.data.state === null, 'ยังไม่มีรอบ');
        r = await call(j, 'POST', `${API}/bet`, { amount: 100, hand: 1 });
        assert(r.status === 409, 'ลงก่อนเริ่มรอบ → 409');
        r = await call(j, 'POST', `${API}/start`, {});
        assert(r.status === 200 && r.data.state.chips === 1000 && r.data.state.phase === 'bet', 'เริ่มรอบ 1,000 ชิป');
        assert(r.data.stats.runs === 1, 'นับรอบ');
        const runId = r.data.state.runId;
        r = await call(j, 'POST', `${API}/start`, {});
        assert(r.data.state.runId === runId && r.data.stats.runs === 1, 'start ซ้ำ = กลับรอบเดิม ไม่นับรอบเพิ่ม');

        // ---------- ยอดเดิมพันผิด ----------
        for (const amount of [5, 501, 'abc', 12.5, null, -100, 1e9]) {
            const bad = await call(j, 'POST', `${API}/bet`, { amount, hand: 1 });
            assert(bad.status === 400 && bad.data.state.chips === 1000 && bad.data.state.phase === 'bet', `ยอด ${amount} ถูกปฏิเสธ ชิปไม่ขยับ`);
        }
        r = await call(j, 'POST', `${API}/bet`, { amount: 100, hand: 7 });
        assert(r.status === 409, 'เลขมือไม่ตรง → 409');
        r = await call(j, 'POST', `${API}/act`, { action: 'draw', hand: 1 });
        assert(r.status === 409, 'จั่วก่อนลงเดิมพัน → 409');
        r = await call(j, 'POST', `${API}/act`, { action: 'cheat', hand: 1 });
        assert(r.status === 400, 'action แปลก → 400');

        // ---------- POST /result ปลอม ----------
        r = await call(j, 'POST', `${BASE}/api/solo/pokdengsolo/result`, { bestPeak: 999999, handsPlayed: 1 });
        assert(r.status === 400 && /เซิร์ฟเวอร์/.test(r.data.error), 'ส่งผลเองถูกปฏิเสธ');

        // ---------- เล่นจริง: ส่งซ้ำไม่หักซ้ำ + ไม่หลุดไพ่ ----------
        let S = (await call(j, 'GET', `${API}/state`)).data.state;
        let sawDraw = false;
        let sawReplay = false;
        let hands = 0;
        let peak = 1000;
        let bestWin = 0;
        let poks = 0;
        while (hands < 40 && S.phase !== 'busted') {
            const hand = S.handNo + 1;
            const before = S.chips;
            const amount = Math.min(S.maxBet, 50);
            const first = await call(j, 'POST', `${API}/bet`, { amount, hand });
            assert(first.status === 200, `ลงมือ ${hand} ได้`);
            if (!sawReplay) {
                const again = await call(j, 'POST', `${API}/bet`, { amount, hand });
                assert(again.status === 200 && again.data.replay === true, 'ส่งเดิมพันซ้ำ = replay');
                assert(again.data.state.chips === first.data.state.chips, 'ส่งซ้ำไม่หักชิปซ้ำ');
                sawReplay = true;
            }
            S = first.data.state;
            if (S.phase === 'draw') {
                const firstDraw = !sawDraw;
                sawDraw = true;
                assert(!/"deck"/.test(first.text), 'ไม่มีสำรับหลุดใน response');
                assert(S.hand.dealer.cardCount === 2 && !S.hand.dealer.cards, 'ไม่เห็นไพ่เจ้ามือก่อนเปิด');
                assert(S.chips === before - amount, 'หักเดิมพันตอนแจก');
                const stateNow = await call(j, 'GET', `${API}/state`);
                assert(!/"deck"/.test(stateNow.text) && !stateNow.data.state.hand.dealer.cards, 'GET /state ก็ไม่หลุด');
                const stats = await call(j, 'GET', `${API}/stats`);
                assert(!/"deck"|"dealer"/.test(stats.text), 'GET /stats ไม่มีข้อมูลรอบลับ');
                if (firstDraw) {
                    const blocked = await call(j, 'POST', `${API}/start`, { fresh: true });
                    assert(blocked.status === 409, 'เริ่มรอบใหม่กลางมือไม่ได้');
                }
                const action = S.hand.player.eval.points <= 4 ? 'draw' : 'stay';
                const done = await call(j, 'POST', `${API}/act`, { action, hand: S.handNo });
                assert(done.status === 200 && done.data.state.lastResult.handNo === hand, 'จั่ว/อยู่ แล้ววัดผล');
                const again = await call(j, 'POST', `${API}/act`, { action, hand: S.handNo });
                assert(again.data.replay === true && again.data.state.chips === done.data.state.chips, 'ส่งจั่วซ้ำ = replay ไม่วัดซ้ำ');
                S = done.data.state;
            }
            const res = S.lastResult;
            assert(res && res.handNo === hand, `มีผลมือ ${hand}`);
            assert(S.chips === before + res.delta, `ชิปมือ ${hand} ตรงกับ delta`);
            assert(res.dealer.cards.length >= 2 && res.dealer.eval, 'เปิดไพ่เจ้ามือหลังวัด');
            if (res.player.eval.pok) poks += 1;
            bestWin = Math.max(bestWin, res.delta);
            peak = Math.max(peak, S.chips);
            hands += 1;
        }
        assert(sawDraw, 'เจอจังหวะจั่วอย่างน้อยหนึ่งครั้ง');

        // ---------- สถิติ + อันดับ ----------
        const st = (await call(j, 'GET', `${API}/stats`)).data.data;
        assert(st.handsPlayed === hands && st.bestPeak === peak && st.pokCount === poks && st.biggestWin === bestWin, `สถิติตรง (${hands} มือ สูงสุด ${peak})`);
        const lb = (await call(j, 'GET', `${API}/leaderboard`)).data.entries;
        const mine = lb.find(e => e.playerId === id);
        assert(mine && mine.score === peak, 'ติดอันดับด้วยชิปสูงสุด');
        const hub = await call(j, 'GET', `${BASE}/solo`);
        assert(hub.status === 200 && hub.text.includes('ป๊อกเด้งท้าเจ้ามือ') && hub.text.includes('/assets/games/solo/pokdengsolo/cover.svg'), 'การ์ดบนหน้า /solo');
        const page = await call(j, 'GET', `${BASE}/solo/pokdengsolo`);
        assert(page.status === 200 && page.text.includes('pdsBoot') && !/"deck"/.test(page.text), 'หน้าเกมเรนเดอร์ ไม่หลุดสำรับ');

        // ---------- รีสตาร์ตกลางมือ ----------
        if (S.phase === 'busted') {
            const nr = await call(j, 'POST', `${API}/start`, {});
            assert(nr.data.state.chips === 1000 && nr.data.stats.runs === 2, 'หมดตัวแล้ว start = รอบใหม่');
            S = nr.data.state;
        }
        let mid = null;
        for (let i = 0; i < 30 && !mid; i += 1) {
            const b = await call(j, 'POST', `${API}/bet`, { amount: Math.min(10, S.maxBet), hand: S.handNo + 1 });
            S = b.data.state;
            if (S.phase === 'draw') mid = S;
            if (S.phase === 'busted') break;
        }
        if (mid) {
            await new Promise(res => setTimeout(res, 500));
            await stopServer(server);
            server = await bootServer();
            const back = (await call(j, 'GET', `${API}/state`)).data.state;
            assert(back.phase === 'draw' && back.handNo === mid.handNo && back.chips === mid.chips, 'รีสตาร์ตแล้วกลับมามือเดิม');
            assert(JSON.stringify(back.hand.player.cards) === JSON.stringify(mid.hand.player.cards), 'ไพ่ในมือเหมือนเดิม');
            const fin = await call(j, 'POST', `${API}/act`, { action: 'stay', hand: back.handNo });
            assert(fin.status === 200 && fin.data.state.lastResult.handNo === back.handNo, 'เล่นต่อจนจบมือได้หลังรีสตาร์ต');
            console.log(`  รีสตาร์ตกลางมือ ${back.handNo} แล้วเล่นต่อได้`);
        }

        // ---------- กติกาที่เลือกในเครื่อง (ส่งมากับการลงเดิมพัน) ----------
        {
            const who = await identity();
            let T = (await call(who.j, 'POST', `${API}/start`, {})).data.state;
            assert(T.rules.straights === true && T.rules.mustDraw === false, 'ค่าเริ่มต้น: นับเรียง · ไม่บังคับจั่ว');
            let forcedSeen = false;
            for (let i = 0; i < 40 && !forcedSeen && T.phase !== 'busted'; i += 1) {
                const b = await call(who.j, 'POST', `${API}/bet`, { amount: 10, hand: T.handNo + 1, rules: { mustDraw: true, straights: false, junk: 1 } });
                assert(b.status === 200 && b.data.state.rules.mustDraw === true && b.data.state.rules.straights === false && !('junk' in b.data.state.rules), 'กติกาที่ส่งมาถูกกรองแล้วใช้กับมือนี้');
                T = b.data.state;
                if (T.phase !== 'draw') continue;
                if (T.hand.mustDraw) {
                    forcedSeen = true;
                    const stay = await call(who.j, 'POST', `${API}/act`, { action: 'stay', hand: T.handNo });
                    assert(stay.status === 400 && /ต้องจั่ว/.test(stay.data.error) && stay.data.state.phase === 'draw', 'ต่ำกว่า 4 กดอยู่ → 400 มือยังค้าง');
                    const draw = await call(who.j, 'POST', `${API}/act`, { action: 'draw', hand: T.handNo });
                    assert(draw.status === 200 && draw.data.state.lastResult.player.cards.length === 3, 'จั่วแล้ววัดผล');
                    assert(draw.data.state.lastResult.rules.mustDraw === true, 'ผลมือบอกกติกาที่ใช้');
                    T = draw.data.state;
                } else {
                    const act = await call(who.j, 'POST', `${API}/act`, { action: 'stay', hand: T.handNo });
                    assert(act.status === 200, '4 แต้มขึ้นไป อยู่ได้');
                    T = act.data.state;
                }
            }
            assert(forcedSeen, 'เจอมือที่ต้องจั่วอย่างน้อยหนึ่งครั้ง');
        }

        // ---------- rate limit ----------
        const other = await identity();
        let limited = 0;
        const burst = await Promise.all(Array.from({ length: 140 }, () => call(other.j, 'GET', `${API}/state`)));
        burst.forEach(x => { if (x.status === 429) limited += 1; });
        assert(limited > 0, `ยิงรัวโดน 429 (${limited} ครั้ง)`);
        let startLimited = 0;
        for (let i = 0; i < 24; i += 1) {
            const s = await call(other.j, 'POST', `${API}/start`, { fresh: true });
            if (s.status === 429) startLimited += 1;
        }
        assert(startLimited > 0, 'เริ่มรอบรัวๆ โดนจำกัด');

        console.log(`✅ api-solo-pokdengsolo: ${passed} assertions passed (${hands} hands)`);
    } finally {
        await stopServer(server);
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
