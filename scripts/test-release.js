#!/usr/bin/env node
// Each suite owns a separate temporary data directory. Never inherit a live DB or target URL.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const groups = {
    rules: [ ['smoke-admin-analytics'], ['smoke-release-gate'], ['smoke-slave'], ['smoke-slave-records'], ['test-blackmarket-engine'], ['smoke-blackmarket-strategy'] ],
    integration: [ ['smoke-admin-perf'], ['smoke-slave-history-e2e'], ['smoke-slave-history-e2e', { SLAVE_HISTORY_ENV: 'staging' }],
        ['smoke-blackmarket-flow'], ['smoke-blackmarket-bots'], ['integration-blackmarket-stats'] ],
    'slave-browser': [ ['smoke-slave-ux'], ['smoke-slave-tools'], ['smoke-slave-play'] ],
    'website-browser': [ ['smoke-admin-insights-browser'], ['smoke-admin-tables-browser'], ['browser-play-flow'], ['browser-leaderboard-rank'], ['browser-blackmarket-board'], ['smoke-seo'] ]
};
const requested = process.argv.slice(2);
const selected = requested.length ? requested : Object.keys(groups);
if (selected.some(group => !groups[group])) throw new Error('Unknown release test group: ' + selected.join(', '));
const artifacts = path.resolve(process.env.TEST_ARTIFACT_DIR || path.join(root, 'test-artifacts'));
fs.mkdirSync(artifacts, { recursive: true });
const env = { ...process.env, NODE_ENV: 'test', MONGO_URL: '', MONGODB_URI: '', TEST_MONGO_URL: '', ALLOW_LEGACY_SOCKET_IDENTITY: '1', TEST_ARTIFACT_DIR: artifacts };
for (const key of ['GAME_DATA_DIR', 'SMOKE_USE_REAL_DATA', 'BASE_URL', 'SLAVE_HISTORY_APP_ROOT', 'PLAY_FLOW_MODES', 'SHOT_DIR', 'APP_ENV']) delete env[key];
let active;
function kill() { if (active) { try { process.kill(-active.pid, 'SIGKILL'); } catch (_) {} } }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { kill(); process.exit(1); });
async function run(group, [name, overrides = {}], index) {
    console.log('\nRunning ' + group + ' / ' + name + (overrides.SLAVE_HISTORY_ENV ? ' (staging)' : ''));
    const log = fs.createWriteStream(path.join(artifacts, group + '-' + index + '-' + name + '.log'));
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(root, 'scripts', name + '.js')], {
            cwd: root, env: { ...env, ...overrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe']
        });
        active = child;
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; kill(); }, 8 * 60 * 1000);
        child.once('error', error => { clearTimeout(timeout); log.end(); active = null; reject(error); });
        child.once('close', (code, signal) => {
            clearTimeout(timeout); kill(); active = null; log.end();
            if (code === 0 && !timedOut) resolve();
            else reject(new Error(name + ': ' + (timedOut ? 'timed out' : 'exit ' + code + ' ' + (signal || ''))));
        });
    });
}
(async () => {
    for (const group of selected) for (const [index, suite] of groups[group].entries()) await run(group, suite, index);
    console.log('Release tests passed: ' + selected.join(', '));
})().catch(error => { console.error(error); process.exitCode = 1; });
