/**
 * ตรวจอันดับของผู้เล่นที่อยู่นอกหน้าแรกของ leaderboard และ pagination
 * รัน: node scripts/browser-leaderboard-rank.js
 */

const { DATA_DIR } = require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const PLAYER_ID = randomUUID();

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function request(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, response => {
            response.resume();
            resolve(response.statusCode || 0);
        });
        req.on('error', reject);
        req.setTimeout(2000, () => req.destroy(new Error('request timeout')));
    });
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = require('net').createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

function seedData() {
    const ids = [...Array.from({ length: 6 }, () => randomUUID()), PLAYER_ID, randomUUID()];
    const players = {};
    const stats = {};

    ids.forEach((id, index) => {
        const wins = id === PLAYER_ID ? 1 : 9 - (index + 1);
        players[id] = {
            playerId: id,
            playerName: id === PLAYER_ID ? 'Rank Check Player' : `Rank Check ${index + 1}`,
            color: '#3498db',
            avatar: '👤',
            avatarFrame: 'none',
            approved: true,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };
        stats[id] = {
            playerId: id,
            playerName: players[id].playerName,
            totalGames: wins + 1,
            wins,
            losses: 1,
            modeStats: { insider: { games: wins + 1, wins, losses: 1 } }
        };
    });

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'players.json'), JSON.stringify(players));
    fs.writeFileSync(path.join(DATA_DIR, 'playerStats.json'), JSON.stringify(stats));
    fs.writeFileSync(path.join(DATA_DIR, 'bannedPlayers.json'), '{}');
    fs.writeFileSync(path.join(DATA_DIR, 'rooms.json'), '{}');
}

async function startServer() {
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'app.js')], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + TIMEOUT;

    while (Date.now() < deadline) {
        try {
            const status = await request(`${baseUrl}/ping`);
            if (status >= 200 && status < 500) return { child, baseUrl };
        } catch (error) {
            // server ยังเริ่มไม่เสร็จ
        }
        await delay(200);
    }

    child.kill('SIGTERM');
    throw new Error(`Timed out waiting for server at ${baseUrl}`);
}

async function main() {
    seedData();
    let server = null;
    let browser = null;

    try {
        server = await startServer();
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        await page.goto(`${server.baseUrl}/?playerId=${PLAYER_ID}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

        await page.waitForFunction(() => document.getElementById('leaderboardSelf')?.textContent.includes('#7'), null, { timeout: TIMEOUT });

        const firstPage = await page.evaluate(() => ({
            self: document.getElementById('leaderboardSelf').textContent.replace(/\s+/g, ' ').trim(),
            ranks: Array.from(document.querySelectorAll('#leaderboardList .leaderboard-rank')).map(node => node.textContent.trim())
        }));
        assert(firstPage.self.includes('#7') && firstPage.self.includes('จาก 8 คน'), `unexpected self summary: ${firstPage.self}`);
        assert(firstPage.ranks.join(',') === '1,2,3,4,5', `unexpected first page: ${firstPage.ranks.join(',')}`);

        await page.click('.leaderboard-page[data-page="2"]');
        await page.waitForFunction(() => document.querySelector('#leaderboardList .leaderboard-rank')?.textContent.trim() === '6', null, { timeout: TIMEOUT });

        const secondPage = await page.evaluate(() => ({
            self: document.getElementById('leaderboardSelf').textContent.replace(/\s+/g, ' ').trim(),
            ranks: Array.from(document.querySelectorAll('#leaderboardList .leaderboard-rank')).map(node => node.textContent.trim())
        }));
        assert(secondPage.self.includes('#7'), `self rank changed after pagination: ${secondPage.self}`);
        assert(secondPage.ranks.join(',') === '6,7,8', `unexpected second page: ${secondPage.ranks.join(',')}`);

        console.log('✅ leaderboard rank smoke test passed');
        console.log(JSON.stringify({ firstPage, secondPage }));
    } finally {
        if (browser) await browser.close();
        if (server?.child) server.child.kill('SIGTERM');
    }
}

main().catch(error => {
    console.error('❌ leaderboard rank smoke test failed');
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
