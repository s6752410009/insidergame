#!/usr/bin/env node
/**
 * ออกจากระบบ (หน้าโปรไฟล์ → แท็บบัญชี)
 * - บัญชีที่ยังไม่ผูก Google ต้องติ๊กยืนยันว่าจดรหัสแล้วก่อน
 * - ออกแล้วเครื่องนี้กลายเป็นผู้เล่นใหม่ (คุกกี้/localStorage ไม่ใช่บัญชีเดิม)
 * - กู้บัญชีเดิมกลับมาได้ด้วยรหัสกู้บัญชี
 * - แอดมินที่ล็อกอินหน้า /admin ไว้ ไม่หลุดตอนผู้เล่นออกจากระบบ
 */

require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
let passed = 0;

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForServer(url, child) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < TIMEOUT_MS) {
        if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
        const ok = await new Promise(resolve => {
            http.get(url, res => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
        });
        if (ok) return;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for local server');
}

async function run() {
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
    const server = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), MONGO_URL: '' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverOutput = '';
    server.stdout.on('data', c => { serverOutput += String(c); });
    server.stderr.on('data', c => { serverOutput += String(c); });
    let browser;
    try {
        await waitForServer(`${base}/ping`, server);
        browser = await chromium.launch({ headless: true });

        // ---------- ผู้เล่นออกจากระบบ แล้วกู้กลับด้วยรหัส ----------
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'th-TH' });
        await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));

        const original = randomUUID();
        await page.goto(`${base}/?playerId=${original}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        // ทำให้บัญชีถูกบันทึกจริง (เกมแรก) → เข้าหน้าใหม่อีกครั้งจะได้รหัสกู้บัญชี
        const start = await page.request.post(`${base}/api/solo/pokdengsolo/start`, { data: {} });
        assert(start.ok(), 'เริ่มเกมเดี่ยวได้ (บันทึกบัญชี)');
        await page.goto(`${base}/profile`, { waitUntil: 'domcontentloaded' });
        await page.click('#tab-account');
        const code = await page.getAttribute('#recoveryCode', 'data-code');
        assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(code || ''), 'มีรหัสกู้บัญชี: ' + code);
        assert(await page.isVisible('#pfLogout'), 'มีปุ่มออกจากระบบ');

        // ยังไม่ผูก Google → ต้องติ๊กยืนยันก่อน และ popup โชว์รหัส
        await page.click('#pfLogout');
        await page.waitForSelector('.swal2-popup');
        assert((await page.textContent('.swal2-html-container')).includes(code), 'popup โชว์รหัสกู้บัญชี');
        await page.click('.swal2-confirm');
        await page.waitForSelector('.swal2-validation-message', { state: 'visible' });
        assert(await page.isVisible('.swal2-popup'), 'ยังไม่ติ๊ก = ยังไม่ออก');
        await page.check('#swal2-checkbox');
        await Promise.all([
            page.waitForURL(url => url.pathname === '/' || url.pathname === '', { timeout: TIMEOUT_MS }),
            page.click('.swal2-confirm')
        ]);
        await page.waitForFunction(id => {
            const now = localStorage.getItem('insiderGamePlayerId');
            return now && now !== id;
        }, original, { timeout: TIMEOUT_MS });
        const fresh = await page.evaluate(() => localStorage.getItem('insiderGamePlayerId'));
        assert(fresh && fresh !== original, 'ออกแล้วเป็นผู้เล่นใหม่');
        assert(await page.evaluate(() => localStorage.getItem('insiderGameRecoveryCode')) !== code, 'ล้างรหัสเก่าออกจากเครื่อง');
        const me = await (await page.request.get(`${base}/api/identity/me`)).json();
        assert(!me.success || me.playerId !== original, 'server ไม่มองว่าเป็นบัญชีเดิมแล้ว');
        const pidCookie = (await ctx.cookies()).find(c => c.name === 'insider_pid');
        assert(!pidCookie || !decodeURIComponent(pidCookie.value).includes(original), 'คุกกี้ไม่ใช่บัญชีเดิม');

        // กู้กลับ
        await page.goto(`${base}/profile`, { waitUntil: 'domcontentloaded' });
        await page.click('#tab-account');
        await page.click('.pf-restore > summary');
        await page.fill('#recoveryInput', code);
        await Promise.all([
            page.waitForURL(url => url.pathname === '/profile', { timeout: TIMEOUT_MS }),
            page.click('#recoveryRestore')
        ]);
        await page.waitForTimeout(400);
        assert(await page.evaluate(() => localStorage.getItem('insiderGamePlayerId')) === original, 'กู้บัญชีเดิมกลับมาได้ด้วยรหัส');
        const meBack = await (await page.request.get(`${base}/api/identity/me`)).json();
        assert(meBack.success && meBack.playerId === original, 'server ยืนยันบัญชีเดิม');
        assert(errors.length === 0, 'ไม่มี error ในหน้า: ' + errors.join(' | '));
        await ctx.close();

        // ---------- แอดมินไม่หลุดตอนผู้เล่นออกจากระบบ ----------
        const actx = await browser.newContext();
        const apage = await actx.newPage();
        await apage.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
        await apage.locator('input[name="password"]').fill(settings.adminPassword || 'admin123');
        await Promise.all([
            apage.waitForURL(url => url.pathname === '/admin', { timeout: TIMEOUT_MS }),
            apage.locator('input[name="password"]').press('Enter')
        ]);
        await apage.goto(`${base}/?playerId=${randomUUID()}`, { waitUntil: 'domcontentloaded' });
        const out = await apage.request.post(`${base}/api/auth/logout`);
        assert(out.ok() && (await out.json()).success, 'logout API ตอบสำเร็จ');
        // ไม่ใช้ goto: หน้า /admin สร้างตัวตนผู้เล่นใหม่ให้เอง (redirect ไป /?playerId=) ซึ่งปกติ
        const adminAgain = await apage.request.get(`${base}/admin`, { maxRedirects: 0 });
        assert(adminAgain.status() === 200, 'แอดมินยังอยู่หลังผู้เล่นออกจากระบบ (ไม่เด้งไปหน้าล็อกอิน): ' + adminAgain.status());
        await actx.close();

        // ---------- เว็บอื่นยิง GET มาให้ออกไม่ได้ ----------
        const getRes = await new Promise(resolve => http.get(`${base}/api/auth/logout`, r => { r.resume(); resolve(r.statusCode); }));
        assert(getRes === 404, 'GET /api/auth/logout ใช้ไม่ได้ (ต้อง POST)');

        console.log(`✅ logout-browser: ${passed} assertions passed`);
    } catch (error) {
        console.error(serverOutput.slice(-1500));
        throw error;
    } finally {
        if (browser) await browser.close();
        server.kill('SIGTERM');
    }
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
