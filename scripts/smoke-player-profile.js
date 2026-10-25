#!/usr/bin/env node
/* Public profile regressions: all game modes, ranking, XSS and compact layout. No player data is read or written. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { MODES, render } = require('../public/js/playerProfile');
const ROOT = path.join(__dirname, '..');
let passed = 0;
function check(ok, message) { if (!ok) throw new Error(message); passed += 1; }
const date = '2026-10-25T03:00:00.000Z';
const base = { playerId: 'public-player', playerName: 'คนเล่นสลาฟ', avatar: '🙂', color: '#f5c86b', createdAt: date };
const game = { mode: 'slave', place: 2, title: 'ควีน', role: 'ควีน', round: 3, won: false, playerCount: 4, roomName: 'ห้องเพื่อน', date, resultText: 'รอบ 3 · อันดับ 2/4 · ควีน' };
const fixture = { ...base, stats: { totalGames: 3, wins: 1, modeStats: { slave: { games: 3, wins: 1, losses: 2 } }, gameHistory: [game], lastPlayedAt: date } };
async function run() {
    for (const mode of MODES) {
        const html = render({ ...base, stats: { totalGames: 2, wins: 1, modeStats: { [mode.id]: { games: 2, wins: 1 } }, gameHistory: [{ ...game, mode: mode.id, role: 'ผู้เล่น', resultText: 'ผลเกมตัวอย่าง' }] } });
        check(html.includes(`data-profile-mode="${mode.id}"`), mode.id + ' is included when played');
        check((html.match(/data-profile-mode=/g) || []).length === 1, mode.id + ' excludes unplayed-mode clutter');
        check(html.includes(mode.label), mode.id + ' history shows correct game label');
        if (mode.id !== 'insider') check(!html.includes('data-profile-mode="insider"'), mode.id + ' does not become Insider');
    }
    const slave = render(fixture);
    check(slave.includes('อันดับ 2/4'), 'Slave history shows own place');
    check(slave.includes('รอบ 3 · อันดับ 2/4 · ควีน'), 'Slave history shows round and title');
    check(!slave.includes('>แพ้<'), 'Slave result uses place instead of only a loss badge');
    check(slave.includes('3 รอบ · คิง 1'), 'Slave games are counted as rounds and wins as king');
    check(!slave.includes('ผู้ดำเนินเกม'), 'Slave-only profile does not show empty Insider roles');
    check(render(base).includes('ยังไม่มีเกมที่เล่นจบ'), 'New player empty state works');
    check(!render({ ...base, stats: { modeStats: { slave: { games: Infinity, wins: NaN } } } }).includes('Infinity'), 'Malformed counters do not render Infinity');
    check(!render({ ...base, stats: { modeStats: { slave: { games: 1, icon: '<svg>', label: '<svg>' } } } }).includes('<svg>'), 'Stored stats cannot override trusted mode labels');
    const mixed = render({ ...base, stats: { roleStats: { traitorCount: 2 }, winByRole: { winAsTraitor: 1 }, modeStats: { insider: { games: 2, wins: 1 }, slave: { games: 3, wins: 1 } }, gameHistory: Array.from({ length: 8 }, () => game) } });
    check(mixed.includes('จอมบงการ') && mixed.includes('2 ครั้ง · ชนะ 1'), 'Existing Insider role stats are retained');
    check((mixed.match(/class="pp-game"/g) || []).length === 5, 'Modal limits history to five completed games');
    const attack = '<img src=x onerror="window.profileXss=true">';
    const hostile = render({ ...base, playerName: attack, color: 'red;animation:x', stats: { gameHistory: [{ ...game, roomName: attack, resultText: attack, role: attack }] } });
    check(!hostile.includes('<img'), 'Names, room names and results are escaped');
    check(!hostile.includes('style="color:red'), 'Public name color is restricted to a hex color');
    for (const name of ['lobby', 'roomLobby']) {
        const source = fs.readFileSync(path.join(ROOT, 'views', name + '.ejs'), 'utf8');
        check(source.includes('/static/js/playerProfile.js') && source.includes('/static/css/playerProfile.css'), name + ' loads shared profile assets');
        check(source.includes('window.PlayerProfile.show(targetPlayerId)'), name + ' calls shared renderer');
        check(!source.includes('stats.roleStats.gameMasterCount'), name + ' has no stale Insider-only modal');
    }
    check(fs.readFileSync(path.join(ROOT, 'views/lobby.ejs'), 'utf8').includes("{ id: 'slave', label: 'สลาฟ' }"), 'Slave has a leaderboard filter');
    const admin = fs.readFileSync(path.join(ROOT, 'views/admin.ejs'), 'utf8');
    let editor;
    const context = { escapeHtml: value => String(value), WEREWOLF_ROLE_META: [], BLACKMARKET_ROLE_META: [], document: { getElementById: id => ({ value: ({ editModeSlaveGames: '7', editModeSlaveWins: '2', editModeSlaveLosses: '5' })[id] || '0' }) }, Swal: { fire: options => { editor = options; return { then() {} }; } } };
    vm.createContext(context);
    vm.runInContext(admin.slice(admin.indexOf('    function showEditPlayerStats('), admin.indexOf('    // ลบสถิติผู้เล่นรายคน')), context);
    context.showEditPlayerStats('public-player', { modeStats: { slave: { games: 7, wins: 2, losses: 5 } } });
    check(editor.html.includes('id="editModeSlaveGames"') && editor.html.includes('value="7"'), 'Admin editor loads Slave counters');
    const saved = editor.preConfirm().modeStats.slave;
    check(saved.games === 7 && saved.wins === 2 && saved.losses === 5, 'Admin editor sends Slave counters instead of dropping them');
    check(admin.includes('value="slave"') && admin.includes('value="has-slave"'), 'Admin has room and stats filters for Slave');
    check(admin.includes('Slave Rounds,Slave King,Slave Places 2-4'), 'Stats CSV includes Slave outcomes');
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        for (const width of [320, 375, 768, 1280]) {
            const page = await browser.newPage({ viewport: { width, height: 800 } });
            await page.setContent(`<style>body{margin:0;font-family:Arial,sans-serif;background:#10191c}.pp-popup{box-sizing:border-box;width:calc(100% - 16px);max-width:620px;margin:8px auto;padding:20px;background:#182529}.swal2-html-container{margin:0}</style><style>${fs.readFileSync(path.join(ROOT, 'public/css/playerProfile.css'), 'utf8')}</style><div class="pp-popup"><div class="swal2-html-container">${render(fixture)}</div></div>`);
            check(await page.locator('.pp-mode[data-profile-mode="slave"]').count() === 1, width + 'px: Slave stats visible');
            check(await page.locator('.pp-game').innerText().then(text => text.includes('ควีน') && text.includes('อันดับ 2/4')), width + 'px: rank and title visible');
            const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth, blocks: Array.from(document.querySelectorAll('.pp-public,.pp-header,.pp-mode,.pp-game')).some(el => el.scrollWidth > el.clientWidth + 1) }));
            check(!overflow.page && !overflow.blocks, width + 'px: profile has no horizontal clipping');
            await page.setContent(hostile);
            await page.waitForTimeout(20);
            check(!await page.evaluate(() => Boolean(window.profileXss)), width + 'px: profile text cannot run scripts');
            await page.close();
        }
    } finally { if (browser) await browser.close(); }
    console.log(`PASS player profile: ${passed} checks`);
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; });
