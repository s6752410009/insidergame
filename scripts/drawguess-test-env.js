/**
 * ตัวช่วยร่วมของเทสต์วาดแล้วทาย (socket + เบราว์เซอร์)
 *
 * - data ชั่วคราวของตัวเอง (GAME_DATA_DIR + WALLETS_FILE) ไม่แตะ data/ จริง · ลบทิ้งตอนจบ
 *   ตั้ง DRAWGUESS_TEST_DATA_ROOT ได้ (ค่าเริ่ม: โฟลเดอร์ชั่วคราวของระบบ)
 * - บูตเซิร์ฟเวอร์บนพอร์ตที่กำหนด (พอร์ตไม่ว่าง = ล้มทันที ไม่สุ่มพอร์ตอื่น)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

function setupDataDir(label) {
    if (!process.env.GAME_DATA_DIR) {
        const rootDir = process.env.DRAWGUESS_TEST_DATA_ROOT || os.tmpdir();
        fs.mkdirSync(rootDir, { recursive: true });
        const dir = fs.mkdtempSync(path.join(rootDir, `drawguess-${label}-`));
        process.env.GAME_DATA_DIR = dir;
        process.env.WALLETS_FILE = path.join(dir, 'wallets.json');
        process.on('exit', () => {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* โฟลเดอร์ชั่วคราว */ }
        });
    }
    if (!process.env.WALLETS_FILE) process.env.WALLETS_FILE = path.join(process.env.GAME_DATA_DIR, 'wallets.json');
    return process.env.GAME_DATA_DIR;
}

function assertPortFree(port) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', () => reject(new Error(`พอร์ต ${port} ไม่ว่าง — ปิดเซิร์ฟเวอร์ที่ค้างก่อน (lsof -ti:${port} | xargs kill)`)));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(port)));
    });
}

function bootServer(port, extraEnv = {}) {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'app.js')], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...extraEnv, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let logs = '';
    child.getLogs = () => logs;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('server timeout\n' + logs.slice(-800))); }, 30000);
        child.stdout.on('data', chunk => {
            logs += chunk;
            if (String(chunk).includes(`Server started on port ${port}`)) { clearTimeout(timer); resolve(child); }
        });
        child.stderr.on('data', chunk => { logs += chunk; });
        child.once('exit', code => { clearTimeout(timer); if (!logs.includes(`Server started on port ${port}`)) reject(new Error(`server exited ${code}\n${logs.slice(-800)}`)); });
    });
}

function stopServer(child) {
    return new Promise(resolve => {
        if (!child || child.exitCode !== null) { resolve(); return; }
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* */ } resolve(); }, 4000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
    });
}

module.exports = { setupDataDir, assertPortFree, bootServer, stopServer };
