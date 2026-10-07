/**
 * เศรษฐี 🏪 — API ร้านผ่านเซิร์ฟเวอร์จริง
 *  identity จาก cookie เท่านั้น (body playerId ไม่มีผล) · ต้องเป็น JSON · อัปเกรดพร้อมกันหลายคำขอได้ขั้นเดียว
 *  เหรียญไม่พอ/สกิลมั่ว/เลเวลไม่ตรง โดนปฏิเสธ · ช่องติดตั้ง · เสกเหรียญ/ล้างสกิลเฉพาะแอดมินเว็บ · รีสตาร์ตแล้วยอดยังอยู่
 *
 * รัน: npm run smoke:setthi:shop:api   (SHOP_TEST_PORT=8862 · ใช้ GAME_DATA_DIR ชั่วคราว)
 */
require('./isolateTestData');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const PORT = Number(process.env.SHOP_TEST_PORT) || 8862;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = process.env.GAME_DATA_DIR;
const delay = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function ok(cond, msg) {
    if (!cond) throw new Error('FAIL: ' + msg);
    passed += 1;
    console.log('  ✓ ' + msg);
}

function boot() {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT), ALLOW_LEGACY_SOCKET_IDENTITY: '1', WALLETS_FILE: path.join(DATA, 'wallets.json') },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('boot timeout\n' + logs.slice(-1500))); }, 30000);
        child.stdout.on('data', c => { logs += c; if (String(c).includes(`Server started on port ${PORT}`)) { clearTimeout(timer); resolve(child); } });
        child.stderr.on('data', c => { logs += c; });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}
async function stop(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise(r => child.once('exit', r)), delay(5000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

class Client {
    constructor() { this.jar = new Map(); }
    cookieHeader() { return Array.from(this.jar, ([k, v]) => `${k}=${v}`).join('; '); }
    absorb(res) {
        const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
        list.forEach(line => {
            const [pair] = line.split(';');
            const i = pair.indexOf('=');
            this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
        });
    }
    async raw(method, url, body, type = 'application/json') {
        let target = BASE + url;
        for (let hop = 0; hop < 6; hop++) {
            const res = await fetch(target, {
                method,
                redirect: 'manual',
                headers: { cookie: this.cookieHeader(), ...(body !== undefined ? { 'content-type': type } : {}) },
                body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
            });
            this.absorb(res);
            if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                target = new URL(res.headers.get('location'), target).toString();
                method = 'GET';
                body = undefined;
                continue;
            }
            return res;
        }
        throw new Error('too many redirects');
    }
    async json(method, url, body, type) {
        const res = await this.raw(method, url, body, type);
        let json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        return { status: res.status, json };
    }
    async identify(id = randomUUID()) {
        this.id = id;
        const res = await this.raw('GET', `/?playerId=${id}`);
        await res.text();
        return id;
    }
}

async function main() {
    const rich = randomUUID();
    const admin = randomUUID();
    // จัดฉากก่อนบูต: คนมีเหรียญ 3000 + แอดมินเว็บ 1 คน
    fs.writeFileSync(path.join(DATA, 'setthiGold.json'), JSON.stringify({ [rich]: { gold: 3000, skills: {}, loadout: [] } }));
    fs.writeFileSync(path.join(DATA, 'players.json'), JSON.stringify({ [admin]: { playerId: admin, playerName: 'แอดมิน', isSiteAdmin: true, approved: true, color: '#3498db', avatar: '👑' } }));
    let server = await boot();
    try {
        const anon = new Client();
        let r = await anon.json('POST', '/api/setthi/shop/upgrade', { skill: 'double', expectLv: 0 });
        ok(r.status === 403, 'ไม่มี identity → 403');
        r = await anon.json('GET', '/api/setthi/gold');
        ok(r.status === 200 && r.json.profile.gold === 0 && r.json.skills.length === 8, 'ดูตารางสกิลได้โดยไม่ต้องล็อกอิน (ยอด 0)');

        const a = new Client();
        await a.identify(rich);
        const page = await a.raw('GET', '/setthi/shop');
        const html = await page.text();
        ok(page.status === 200 && html.includes('ร้านเศรษฐี') && html.includes('"gold":3000'), 'หน้าร้านโชว์ยอดของคนนี้');
        ok(!html.includes(admin), 'หน้าร้านไม่มีข้อมูลคนอื่น');
        ok(!html.includes('id="shGrant"'), 'คนทั่วไปไม่เห็นเมนูเสกเหรียญ');

        r = await a.json('POST', '/api/setthi/shop/upgrade', 'skill=double&expectLv=0', 'application/x-www-form-urlencoded');
        ok(r.status === 415, 'ฟอร์มธรรมดา (ไม่ใช่ JSON) → 415');
        r = await a.json('POST', '/api/setthi/shop/upgrade', { skill: 'nope', expectLv: 0 });
        ok(r.status === 400 && r.json.code === 'skill', 'สกิลมั่ว → 400');
        r = await a.json('POST', '/api/setthi/shop/upgrade', { skill: 'double', expectLv: 3 });
        ok(r.status === 409 && r.json.code === 'stale' && r.json.profile.gold === 3000, 'เลเวลไม่ตรง → 409 ไม่หัก');
        r = await a.json('POST', '/api/setthi/shop/upgrade', { skill: 'double', expectLv: 0, cost: 1, gold: 999999 });
        ok(r.status === 200 && r.json.profile.gold === 2900 && r.json.profile.skills.double === 1, 'อัปได้ ราคาคิดที่เซิร์ฟเวอร์ (ส่ง cost มาไม่มีผล)');

        // กดรัว: 6 คำขอพร้อมกัน expectLv เดียวกัน → ได้ขั้นเดียว
        const burst = await Promise.all(Array.from({ length: 6 }, () => a.json('POST', '/api/setthi/shop/upgrade', { skill: 'double', expectLv: 1 })));
        ok(burst.filter(x => x.status === 200).length === 1, '6 คำขอพร้อมกัน ผ่าน 1');
        ok(burst.filter(x => x.status === 409 && x.json.code === 'stale').length === 5, 'ที่เหลือ stale');
        r = await a.json('GET', '/api/setthi/gold');
        ok(r.json.profile.gold === 2900 - 250 && r.json.profile.skills.double === 2, 'หัก 250 ครั้งเดียว');

        // คนอื่นอ้าง playerId ใน body = ไม่มีผล (ใช้ cookie)
        const b = new Client();
        await b.identify();
        r = await b.json('POST', '/api/setthi/shop/upgrade', { skill: 'fly', expectLv: 0, playerId: rich });
        ok(r.status === 409 && r.json.code === 'gold', 'อ้าง playerId คนอื่นไม่ได้ (ยังเป็นยอดตัวเอง = 0)');
        r = await a.json('GET', '/api/setthi/gold');
        ok(r.json.profile.gold === 2650, 'ยอดของ rich ไม่ถูกแตะ');
        r = await b.json('POST', '/api/setthi/shop/debug', { action: 'grant', amount: 5000 });
        ok(r.status === 403, 'คนทั่วไปเสกเหรียญไม่ได้');

        // ช่องติดตั้ง
        r = await a.json('POST', '/api/setthi/shop/loadout', { loadout: ['double', 'fly'] });
        ok(r.status === 409 && r.json.code === 'locked', 'ใส่สกิลที่ยังไม่มีไม่ได้');
        r = await a.json('POST', '/api/setthi/shop/upgrade', { skill: 'fly', expectLv: 0 });
        r = await a.json('POST', '/api/setthi/shop/upgrade', { skill: 'luck', expectLv: 0 });
        r = await a.json('POST', '/api/setthi/shop/upgrade', { skill: 'escape', expectLv: 0 });
        ok(r.status === 200 && r.json.profile.loadout.join(',') === 'double,fly,luck', 'อัปสกิลใหม่ใส่ช่องว่างให้ ช่องเต็มไม่ใส่');
        r = await a.json('POST', '/api/setthi/shop/loadout', { loadout: ['escape', 'double', 'fly', 'luck'] });
        ok(r.status === 409 && r.json.code === 'loadout', 'เกิน 3 ไม่ได้');
        r = await a.json('POST', '/api/setthi/shop/loadout', { loadout: ['escape', 'double'] });
        ok(r.status === 200 && r.json.profile.loadout.join(',') === 'escape,double', 'ตั้งช่องได้');

        // แอดมิน
        const ad = new Client();
        await ad.identify(admin);
        const adminPage = await (await ad.raw('GET', '/setthi/shop')).text();
        ok(adminPage.includes('id="shGrant"'), 'แอดมินเห็นเมนูเสกเหรียญ');
        r = await ad.json('POST', '/api/setthi/shop/debug', { action: 'grant', amount: 0 });
        ok(r.status === 400, 'เสก 0 ไม่ได้');
        r = await ad.json('POST', '/api/setthi/shop/debug', { action: 'grant', amount: 5000 });
        ok(r.status === 200 && r.json.profile.gold === 5000, 'แอดมินเสกได้ (ให้ตัวเอง)');
        await ad.json('POST', '/api/setthi/shop/upgrade', { skill: 'builder', expectLv: 0 });
        r = await ad.json('POST', '/api/setthi/shop/debug', { action: 'reset' });
        ok(r.status === 200 && r.json.profile.gold === 5000 && !r.json.profile.skills.builder, 'ล้างสกิลคืนเหรียญ');
    } finally {
        await stop(server);
    }

    // รีสตาร์ต
    server = await boot();
    try {
        const a = new Client();
        await a.identify(rich);
        const r = await a.json('GET', '/api/setthi/gold');
        ok(r.json.profile.gold === 2650 - 300 && r.json.profile.skills.double === 2 && r.json.profile.loadout.join(',') === 'escape,double', 'รีสตาร์ตแล้วยอด/สกิล/ช่องยังอยู่');
        ok(fs.existsSync(path.join(DATA, 'setthiGold.json')), 'ไฟล์อยู่ใน GAME_DATA_DIR');
    } finally {
        await stop(server);
    }
    console.log(`✅ setthi shop api: ${passed} checks`);
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
