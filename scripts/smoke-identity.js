/**
 * ทดสอบระบบ identity ของผู้เล่น (localStorage + session + playerId ใน URL)
 *
 * บัคที่กันไว้: เดิม server ให้ session ชนะ query แล้ว client เอา meta จาก server
 * ไปทับ localStorage — พอ session หมดอายุ (คุกกี้ 24 ชม. / เซิร์ฟเวอร์รีสตาร์ต)
 * แล้วผู้เล่นเปิดลิงก์ที่มี playerId ของคนอื่นติดมา (ทุกลิงก์ในเว็บเคยพก playerId)
 * บัญชีเดิมบนเครื่องจะถูกเขียนทับหายถาวร = "เข้าเครื่องเดิมแต่กลายเป็นบัญชีใหม่"
 *
 * ดีไซน์ใหม่:
 *   - localStorage คือเจ้าของเครื่อง / query ชนะ session ฝั่ง server (client sync ให้เอง)
 *   - โหลดเสร็จ ลบ playerId ออกจาก address bar → ลิงก์ที่แชร์ไม่พกบัญชีติดไป
 *
 * รัน: node scripts/smoke-identity.js
 */

const { DATA_DIR: TEST_DATA_DIR } = require('./isolateTestData');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

function assert(condition, message) { if (!condition) throw new Error(message); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function bootServer(port) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL'); // อย่าทิ้ง orphan ไว้กิน CPU
            reject(new Error('server startup timeout\n--- server logs ---\n' + logs.slice(-1500)));
        }, 30000);
        child.stdout.on('data', chunk => {
            logs += String(chunk);
            if (String(chunk).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', chunk => { logs += String(chunk); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + '\n' + logs.slice(-1500))); });
    });
}

async function getFreePort() {
    return new Promise(resolve => {
        const server = require('net').createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

/**
 * หน้าเว็บมี redirect chain (bootstrap → sync id → strip URL) — evaluate กลางทาง
 * จะเจอ "Execution context was destroyed" ต้อง retry จนหน้าเข้าที่ก่อนค่อยอ่านค่า
 */
async function settled(page, fn, arg) {
    const deadline = Date.now() + 15000;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            await page.waitForFunction(() => localStorage.getItem('insiderGamePlayerId'), { timeout: 5000 });
            await delay(400); // เผื่อ replaceState/strip รอบสุดท้าย
            return await page.evaluate(fn, arg);
        } catch (error) {
            lastError = error;
            if (/Execution context was destroyed|Navigation/i.test(error.message)) {
                await delay(300); // โดน redirect ตัดหน้า — รอแล้วลองใหม่
                continue;
            }
            throw error;
        }
    }
    throw lastError || new Error('page never settled');
}

const readIdentity = page => settled(page, () => localStorage.getItem('insiderGamePlayerId'));
const readBarHasPlayerId = page => settled(page, () => new URL(location.href).searchParams.has('playerId'));

async function nameAccount(page, playerId, name) {
    await page.evaluate(async ({ id, newName }) => {
        await fetch('/profile/updateName?playerId=' + id, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
    }, { id: playerId, newName: name });
}

async function lookupName(page, playerId) {
    return page.evaluate(async id => {
        const res = await fetch('/api/player/' + id + '/profile');
        return res.ok ? (await res.json()).playerName : null;
    }, playerId);
}

async function main() {
    const port = await getFreePort();
    let server = await bootServer(port);
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch();

    try {
        // ================= เคสหลัก: เครื่องเดิมต้องไม่กลายเป็นบัญชีใหม่ =================
        const myDevice = await browser.newContext();
        const page = await myDevice.newPage();
        await page.goto(`${base}/rooms`, { waitUntil: 'networkidle' });
        await delay(1200);
        const myId = await readIdentity(page);
        assert(myId, 'ไม่ได้ identity ตอนเปิดครั้งแรก');
        await nameAccount(page, myId, 'บัญชีหลักของผม');
        console.log('1. สร้างบัญชี "บัญชีหลักของผม" =', myId);

        // address bar ต้องสะอาด ไม่พก playerId ให้คนก๊อปไปแชร์
        assert(!(await readBarHasPlayerId(page)), 'address bar ยังมี playerId ค้างอยู่');
        console.log('2. address bar สะอาด ไม่มี playerId ✓');

        // จำลอง session หมดอายุแบบสุดขั้ว: รีสตาร์ตเซิร์ฟเวอร์ (MemoryStore หายหมด)
        server.kill('SIGTERM');
        await delay(2000);
        server = await bootServer(port);
        await delay(1000);

        // แล้วเปิด "ลิงก์เก่าที่มี playerId ของคนอื่น" — จุดที่เคยทำบัญชีหาย
        const strangerId = randomUUID();
        await page.goto(`${base}/rooms?playerId=${strangerId}`, { waitUntil: 'networkidle' });
        await delay(2000);
        const afterAttack = await readIdentity(page);
        const nameNow = await lookupName(page, afterAttack);
        assert(afterAttack === myId,
            `บัญชีถูกเขียนทับ! ${myId} -> ${afterAttack} (ลิงก์คนอื่น + session หมดอายุ)`);
        assert(nameNow === 'บัญชีหลักของผม', `ชื่อบัญชีเพี้ยน: ${nameNow}`);
        console.log('3. session หมดอายุ + เปิดลิงก์ id คนอื่น → บัญชีเดิมรอด ✓');

        // reload เฉยๆ (URL สะอาดแล้ว ใช้ session ล้วน) ต้องยังเป็นคนเดิม
        await page.reload({ waitUntil: 'networkidle' });
        await delay(1200);
        assert((await readIdentity(page)) === myId, 'reload แล้ว identity เปลี่ยน');
        assert(!(await readBarHasPlayerId(page)), 'reload แล้ว address bar มี playerId โผล่มา');
        console.log('4. reload ด้วย URL สะอาด → identity เดิม ✓');

        // ================= ลิงก์ที่แชร์ต้องไม่พาบัญชีติดไปด้วย =================
        // เพื่อนเปิดลิงก์ address bar ของเรา (ซึ่งตอนนี้สะอาด) จากเครื่องใหม่
        const friendDevice = await browser.newContext();
        const friendPage = await friendDevice.newPage();
        const sharedUrl = page.url(); // ก๊อปจาก address bar ตรงๆ เหมือนผู้ใช้จริง
        assert(!sharedUrl.includes('playerId'), 'URL ที่จะแชร์ยังมี playerId: ' + sharedUrl);
        await friendPage.goto(sharedUrl, { waitUntil: 'networkidle' });
        await delay(1500);
        const friendId = await readIdentity(friendPage);
        assert(friendId && friendId !== myId,
            `เพื่อนเปิดลิงก์ที่แชร์แล้วกลายเป็นบัญชีเรา! (${friendId})`);
        console.log('5. เครื่องใหม่เปิดลิงก์ที่แชร์ → ได้บัญชีของตัวเอง ✓');

        // ================= เครื่องว่างเปล่า + ลิงก์โอน identity (ตั้งใจ) =================
        // ฟีเจอร์ copySiteAdminLink พึ่งพฤติกรรมนี้: เครื่องที่ "ไม่มี" บัญชีเดิม
        // เปิดลิงก์ที่มี playerId → รับ identity นั้นมาใช้
        const blankDevice = await browser.newContext();
        const blankPage = await blankDevice.newPage();
        await blankPage.goto(`${base}/rooms?playerId=${myId}`, { waitUntil: 'networkidle' });
        await delay(1500);
        assert((await readIdentity(blankPage)) === myId, 'ลิงก์โอน identity ไปเครื่องว่างไม่ทำงาน');
        console.log('6. เครื่องว่าง + ลิงก์โอน identity → รับมาใช้ได้ (ฟีเจอร์ admin) ✓');

        console.log('\n✅ IDENTITY CHECKS PASSED');
    } finally {
        await browser.close();
        server.kill('SIGTERM');
    }
    process.exit(0);
}

main().catch(error => {
    console.error('❌', error.message);
    process.exit(1);
});
