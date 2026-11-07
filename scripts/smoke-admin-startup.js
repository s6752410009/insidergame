'use strict';
// Delay the actual archive adapter in an isolated child; no production DB or data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-archive-startup-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, socket, logs = '', checks = 0;
function ok(condition, label) { assert.ok(condition, label); checks++; }
async function wait(predicate, label, timeout = 18000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await predicate()) return; await sleep(25); }
    throw new Error('Timed out: ' + label + '\n' + logs.slice(-1800));
}
(async () => {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const base = 'http://127.0.0.1:' + port, password = randomUUID();
    const preload = path.join(temp, 'delay-archive.cjs');
    fs.writeFileSync(preload, `
const adapter = require(${JSON.stringify(path.join(root, 'managers/activityArchive.js'))});
const create = adapter.createActivityArchive;
adapter.createActivityArchive = options => {
    const archive = create(options), init = archive.init, importLogs = archive.importLogs;
    archive.init = async () => { await new Promise(resolve => setTimeout(resolve, 3500)); return init(); };
    archive.importLogs = store => importLogs({
        query: (...args) => store.query(...args),
        async *exportEntries(...args) {
            await new Promise(resolve => setTimeout(resolve, 3500));
            yield* store.exportEntries(...args);
        }
    });
    return archive;
};
`);
    const began = Date.now();
    child = spawn(process.execPath, ['--require', preload, path.join(root, 'app.js')], {
        cwd: root, env: { ...process.env, PORT: String(port), GAME_DATA_DIR: temp,
            MONGO_URL: '', MONGODB_URI: '', TEST_MONGO_URL: '', NODE_ENV: 'production',
            INSIDER_DEV_FAST: '0', ADMIN_PASSWORD: password, SESSION_SECRET: randomUUID() },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', data => { logs += data; });
    child.stderr.on('data', data => { logs += data; });
    await wait(() => logs.includes('Server started on port ' + port), 'HTTP without waiting for archive');
    ok(Date.now() - began < 3000, 'production HTTP starts before the delayed archive is ready');
    ok((await fetch(base + '/ping')).status === 200, 'healthcheck works while archive initializes');
    socket = io(base, { transports: ['websocket'], reconnection: false });
    await wait(() => socket.connected, 'WebSocket');
    const rooms = await new Promise((resolve, reject) => socket.timeout(2000).emit('getRoomList', (error, data) => error ? reject(error) : resolve(data)));
    ok(rooms.success && rooms.rooms.length === 0, 'public WebSocket works during backfill without registering a player');
    const login = await fetch(base + '/admin/login', { method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https' }, body: new URLSearchParams({ password }) });
    ok(login.status === 302, 'admin can log in during archive initialization');
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const insights = () => fetch(base + '/admin/api/insights?period=all', { headers: { cookie, 'x-forwarded-proto': 'https' } });
    ok((await insights()).status === 503, 'insights refuses partial history before initialization');
    await wait(() => logs.includes('[activity archive] importing retained logs'), 'import starts');
    ok((await insights()).status === 503, 'insights still refuses partial history during import');
    ok((await fetch(base + '/ping')).status === 200, 'backfill does not block healthcheck');
    await wait(() => logs.includes('[activity archive] ready ('), 'archive becomes ready');
    const response = await insights(), data = await response.json();
    ok(response.status === 200 && data.success && data.coverage.persistent, 'complete insights becomes available after import');
    console.log('Admin archive startup: ' + checks + ' checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    socket?.disconnect();
    if (child && child.exitCode === null) await new Promise(resolve => {
        const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 6000);
        child.once('exit', () => { clearTimeout(timeout); resolve(); }); child.kill('SIGTERM');
    });
    fs.rmSync(temp, { recursive: true, force: true });
});
