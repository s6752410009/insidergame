#!/usr/bin/env node
/**
 * วัดความเร็วหลังบ้าน /admin กับข้อมูลชุดใหญ่
 *
 *   node scripts/gen-admin-perf-data.js /tmp/perfdata
 *   node scripts/perf-admin.js /tmp/perfdata [--app path/to/app.js] [--runs 3] [--json]
 *
 * ก๊อปข้อมูลไปโฟลเดอร์ชั่วคราวทุกรอบ (เซิร์ฟเวอร์เขียนทับได้) แล้วเปิดหน้า /admin ใน Chromium จริง:
 * - เวลาที่เซิร์ฟเวอร์ใช้ render GET /admin + ขนาด HTML
 * - ทุก socket event ที่หน้าเรียกตอนโหลด: เวลาไป-กลับ + ขนาดข้อมูลที่ได้กลับ
 * - เวลาจนตารางผู้เล่นขึ้น
 * - ตัวเลือก --budget: ล้มถ้าโหลดรวมเกินงบ (ใช้เป็นเทสกันถอยหลัง)
 */

const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
    const out = { dir: null, app: path.join(ROOT, 'app.js'), runs: 3, json: false, budgetBytes: 0, budgetMs: 0 };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--app') out.app = path.resolve(argv[++i]);
        else if (arg === '--runs') out.runs = Number(argv[++i]);
        else if (arg === '--json') out.json = true;
        else if (arg === '--budget-bytes') out.budgetBytes = Number(argv[++i]);
        else if (arg === '--budget-ms') out.budgetMs = Number(argv[++i]);
        else if (!out.dir) out.dir = path.resolve(arg);
    }
    return out;
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

async function waitForServer(url, child, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
        const ok = await new Promise(resolve => {
            http.get(url, res => { res.resume(); resolve(res.statusCode < 500); }).on('error', () => resolve(false));
        });
        if (ok) return Date.now() - startedAt;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for server');
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(name => {
        const from = path.join(src, name);
        if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dest, name));
    });
}

function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function kb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

// socket.io v4 ผ่าน websocket: "42[...]" = event, "42<id>[...]" = emit ที่รอ ack, "43<id>[...]" = ack
function parseFrame(payload) {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    const match = /^4([23])(\d*)(\[.*)$/s.exec(text);
    if (!match) return null;
    const kind = match[1] === '2' ? 'event' : 'ack';
    const id = match[2] ? Number(match[2]) : null;
    let name = null;
    if (kind === 'event') {
        const nameMatch = /^\["([^"]+)"/.exec(match[3]);
        name = nameMatch ? nameMatch[1] : null;
    }
    return { kind, id, name, bytes: Buffer.byteLength(text) };
}

async function measureOnce(args, browser) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-perf-'));
    copyDir(args.dir, dataDir);
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    const server = spawn(process.execPath, ['--max-old-space-size=1024', args.app], {
        cwd: path.dirname(args.app),
        env: { ...process.env, PORT: String(port), MONGO_URL: '', GAME_DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    server.stdout.on('data', c => { output += String(c); });
    server.stderr.on('data', c => { output += String(c); });
    try {
        const bootMs = await waitForServer(`${base}/ping`, server);
        const settings = JSON.parse(fs.readFileSync(path.join(path.dirname(args.app), 'settings.json'), 'utf8'));
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addInitScript(() => { try { sessionStorage.setItem('insiderPromoSeen', '1'); } catch (e) { /* ignore */ } });
        const page = await ctx.newPage();

        await page.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
        await page.locator('input[name="password"]').fill(settings.adminPassword || 'admin123');

        const sent = new Map();
        const events = [];
        const pushes = new Map();
        page.on('websocket', ws => {
            ws.on('framesent', frame => {
                const parsed = parseFrame(frame.payload);
                if (parsed && parsed.kind === 'event' && parsed.id !== null) {
                    sent.set(parsed.id, { name: parsed.name, at: Date.now(), sentBytes: parsed.bytes });
                }
            });
            ws.on('framereceived', frame => {
                const parsed = parseFrame(frame.payload);
                if (!parsed) return;
                if (parsed.kind === 'ack' && sent.has(parsed.id)) {
                    const request = sent.get(parsed.id);
                    events.push({ name: request.name, ms: Date.now() - request.at, bytes: parsed.bytes });
                } else if (parsed.kind === 'event' && parsed.name) {
                    const entry = pushes.get(parsed.name) || { count: 0, bytes: 0 };
                    entry.count += 1;
                    entry.bytes += parsed.bytes;
                    pushes.set(parsed.name, entry);
                }
            });
        });

        const navStart = Date.now();
        const [response] = await Promise.all([
            page.waitForResponse(res => new URL(res.url()).pathname === '/admin' && res.request().method() === 'GET', { timeout: 60000 }),
            page.locator('input[name="password"]').press('Enter')
        ]);
        const timing = response.request().timing();
        const firstRenderMs = timing.responseStart > 0 ? timing.responseStart - timing.requestStart : NaN;
        await page.waitForFunction(() => {
            const meta = document.querySelector('#playersTableMeta');
            return meta && /แสดง|ไม่มีผู้เล่น/.test(meta.textContent || '');
        }, null, { timeout: 120000 });
        const tableMs = Date.now() - navStart;
        // ให้ event ที่ตามมาหลังตารางขึ้น (logs, settings, inbox) ทำเสร็จด้วย
        await page.waitForTimeout(2500);
        const heap = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
        // GET /admin ซ้ำด้วย cookie เดิม วัดเวลาเซิร์ฟเวอร์ + ขนาด HTML ให้นิ่งกว่าครั้งแรก
        const cookie = (await ctx.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
        const renders = [];
        let htmlBytes = 0;
        for (let i = 0; i < 5; i++) {
            const started = process.hrtime.bigint();
            htmlBytes = await new Promise((resolve, reject) => {
                http.get(`${base}/admin`, { headers: { cookie } }, res => {
                    let size = 0;
                    res.on('data', chunk => { size += chunk.length; });
                    res.on('end', () => resolve(size));
                }).on('error', reject);
            });
            renders.push(Number(process.hrtime.bigint() - started) / 1e6);
        }
        await ctx.close();
        return { bootMs, firstRenderMs, renderMs: median(renders), htmlBytes, tableMs, events, pushes: Object.fromEntries(pushes), heap };
    } catch (error) {
        console.error(output.slice(-2000));
        throw error;
    } finally {
        server.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 300));
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.dir || !fs.existsSync(args.dir)) {
        console.error('usage: node scripts/perf-admin.js <generated-data-dir> [--app app.js] [--runs 3] [--json] [--budget-bytes N] [--budget-ms N]');
        process.exit(2);
    }
    const browser = await chromium.launch({ headless: true });
    const runs = [];
    try {
        for (let i = 0; i < args.runs; i++) runs.push(await measureOnce(args, browser));
    } finally {
        await browser.close();
    }

    const byEvent = new Map();
    runs.forEach(run => run.events.forEach(event => {
        const entry = byEvent.get(event.name) || { ms: [], bytes: [] };
        entry.ms.push(event.ms);
        entry.bytes.push(event.bytes);
        byEvent.set(event.name, entry);
    }));
    const summary = {
        app: args.app,
        runs: runs.length,
        bootMs: median(runs.map(r => r.bootMs)),
        renderMs: median(runs.map(r => r.renderMs)),
        firstRenderMs: median(runs.map(r => r.firstRenderMs)),
        htmlBytes: median(runs.map(r => r.htmlBytes)),
        tableMs: median(runs.map(r => r.tableMs)),
        events: Array.from(byEvent.entries()).map(([name, entry]) => ({
            name,
            calls: Math.round(entry.ms.length / runs.length),
            ms: median(entry.ms),
            bytes: median(entry.bytes)
        })),
        pushes: runs[runs.length - 1].pushes
    };
    summary.totalAckBytes = summary.events.reduce((sum, e) => sum + e.bytes * e.calls, 0);

    if (args.json) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log(`app: ${summary.app} (${summary.runs} runs, median)`);
        console.log(`boot ${summary.bootMs} ms · GET /admin ${summary.renderMs.toFixed(1)} ms (first ${summary.firstRenderMs.toFixed(1)} ms), ${kb(summary.htmlBytes)} · players table visible after ${summary.tableMs} ms`);
        summary.events.forEach(e => console.log(`  ${e.name.padEnd(28)} x${e.calls}  ${String(e.ms).padStart(6)} ms  ${kb(e.bytes).padStart(12)}`));
        console.log(`  total socket payload on load: ${kb(summary.totalAckBytes)}`);
        Object.entries(summary.pushes).forEach(([name, p]) => console.log(`  push ${name}: ${p.count}x ${kb(p.bytes)}`));
    }

    let failed = false;
    if (args.budgetBytes && summary.totalAckBytes > args.budgetBytes) {
        console.error(`FAIL: socket payload ${summary.totalAckBytes} > budget ${args.budgetBytes}`);
        failed = true;
    }
    if (args.budgetMs && summary.tableMs > args.budgetMs) {
        console.error(`FAIL: table visible after ${summary.tableMs} ms > budget ${args.budgetMs}`);
        failed = true;
    }
    process.exit(failed ? 1 : 0);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
