#!/usr/bin/env node
/* Read-only admin insights against a local app and disposable NDJSON fixtures. */
require('./isolateTestData');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { randomBytes } = require('crypto');
const { isDeepStrictEqual } = require('util');
const { chromium } = require('playwright');
const browserOptions = require('./browserOptions');

const ROOT = path.join(__dirname, '..');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
const API_PATH = '/admin/api/insights';
const PRIVATE = 'INSIGHTS_PRIVATE_METADATA_MUST_NOT_LEAK';
const NAME = 'ชื่อเดียวกัน';
const EXPECTED = { starts: 6, ends: 2, uniqueHumans: 2, joins: 60, leaves: 0,
    errors: 1, botStarts: 1, testStarts: 0, soloEnds: 0 };
let passed = 0;

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    passed += 1;
}
function equal(actual, expected, message) {
    assert(isDeepStrictEqual(actual, expected),
        `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function summary(data, expected, tag) {
    for (const [key, value] of Object.entries(expected)) equal(data.summary[key], value, `${tag} summary.${key}`);
}
function noSecrets(data, tag) {
    assert(!JSON.stringify(data).includes(PRIVATE), `${tag} private metadata is not exposed`);
    assert(data.activity.rows.every(row => !Object.hasOwn(row, 'meta')), `${tag} activity does not expose raw metadata`);
}

function seed(dataDir) {
    const now = Date.now();
    const rows = [];
    const add = (category, mode, message, meta, age = 1000 + rows.length) => {
        const timestamp = new Date(now - age).toISOString();
        rows.push({ id: (now - age).toString(36).padStart(9, '0') + rows.length.toString(36).padStart(6, '0'),
            timestamp, category, type: category === 'error' ? 'error' : 'info',
            roomId: mode ? `insights-${mode}` : null, roomName: mode ? `ห้องทดสอบ ${mode}` : 'ระบบ',
            gameMode: mode, gameModeLabel: mode === 'coup' ? 'Coup' : mode === 'insider' ? 'Insider' : mode === 'werewolf' ? 'Werewolf' : null,
            message, meta });
    };
    for (let index = 0; index < 60; index += 1) {
        const playerId = index < 40 ? 'p1' : 'p2';
        add('join', 'coup', `insights-page-${String(index).padStart(3, '0')} ${NAME} ${playerId}-only เข้าห้อง`,
            { event: 'player_join', playerId, playerName: NAME });
    }
    for (let index = 0; index < 3; index += 1) add('game', 'coup', `Coup เริ่มเกม fixture-${index}`,
        { event: 'game_start', participantIds: ['p1', 'p2'], playerCount: 2 });
    add('game', 'coup', 'Coup จบเกม fixture', { event: 'game_end', participantIds: ['p1', 'p2'] });
    add('game', 'insider', 'Insider เริ่มเกม fixture', { event: 'game_start', participantIds: ['p1'] });
    add('game', 'insider', 'Insider จบเกม fixture', { event: 'game_end', participantIds: ['p1'] });
    add('game', 'werewolf', 'Werewolf bot start fixture', { event: 'game_start', bot: true, humans: 0, bots: 1, participantIds: ['bot_insights_1'] });
    add('game', 'werewolf', 'Werewolf bot end fixture', { event: 'game_end', bot: true, humans: 0, bots: 1, participantIds: ['bot_insights_1'] });
    add('game', 'werewolf', 'Werewolf mixed human and bot start fixture',
        { event: 'game_start', humans: 1, bots: 1, participantIds: ['p1', 'bot_insights_1'] });
    add('admin', null, 'insights-admin-fixture บันทึกการตั้งค่า', { event: 'admin_settings',
        token: PRIVATE, password: PRIVATE, ip: PRIVATE, secretWord: PRIVATE, roles: [PRIVATE], cards: [PRIVATE] });
    add('error', 'coup', 'insights-error-fixture ข้อผิดพลาดทดสอบ', { event: 'fixture_error', playerId: 'p2', playerName: NAME, token: PRIVATE });
    // A matching display name in an older record must never establish a player's identity.
    add('game', 'insider', `legacy-noidentity ${NAME} เริ่มเกม`, { event: 'game_start' }, 2 * 86400000 + 60000);
    fs.writeFileSync(path.join(dataDir, 'serverLogs.ndjson'), rows.slice().reverse().map(row => JSON.stringify(row)).join('\n') + '\n');
    const players = Object.fromEntries(['p1', 'p2'].map(playerId => [playerId,
        { playerId, playerName: NAME, color: '#3498db', avatar: '🙂', approved: true,
            createdAt: new Date(now).toISOString(), lastSeen: new Date(now).toISOString() }]));
    fs.writeFileSync(path.join(dataDir, 'players.json'), JSON.stringify(players));
    return rows;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}
async function waitForServer(base, child, spawnError) {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (spawnError()) throw new Error('Could not spawn local app');
        if (child.exitCode !== null || child.signalCode) throw new Error('Local app exited before becoming ready');
        const ready = await new Promise(resolve => {
            const request = http.get(`${base}/ping`, response => { response.resume(); resolve(response.statusCode === 200); });
            request.setTimeout(1000, () => request.destroy());
            request.on('error', () => resolve(false));
        });
        if (ready) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for local app');
}
async function stopServer(child) {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode) return;
    await new Promise(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
    });
}

function monitorPage(page, errors, base) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === base && ['stylesheet', 'script'].includes(response.request().resourceType()) && response.status() >= 400) {
            errors.push(`Local ${response.request().resourceType()} failed: ${response.status()} ${url.pathname}`);
        }
    });
}

async function api(context, base, query = {}) {
    const response = await context.request.get(`${base}${API_PATH}`, { params: { days: 7, ...query } });
    equal(response.status(), 200, 'authenticated insights API succeeds');
    assert(/\bno-store\b/.test(response.headers()['cache-control'] || ''), 'API response is no-store');
    const data = await response.json();
    equal(data.success, true, 'API success flag');
    noSecrets(data, 'API');
    return data;
}
async function apiChecks(context, base, fixture) {
    const all = await api(context, base);
    summary(all, EXPECTED, 'all');
    assert(Number.isFinite(Date.parse(all.generatedAt)), 'generatedAt is a timestamp');
    equal(all.live, { rooms: 0, playingRooms: 0, humansInRooms: 0 }, 'local fixture has no live rooms');
    equal(all.query.days, 7, 'default seven-day query');
    equal(all.coverage.retentionDays, 7, 'retention coverage');
    assert(Number.isFinite(Date.parse(all.coverage.from)) && Number.isFinite(Date.parse(all.coverage.to)), 'coverage has a valid range');
    assert(Number.isFinite(Date.parse(all.coverage.oldestEventAt)), 'coverage includes oldest event');
    equal(all.coverage.truncated, false, 'small fixture is not truncated');
    assert(typeof all.coverage.source === 'string' && all.coverage.source.length > 0, 'coverage identifies its source');
    equal(all.daily.length, 7, 'daily series covers seven Thai dates');
    equal(all.hourly.map(hour => hour.hour), Array.from({ length: 24 }, (_, hour) => hour), 'hourly series covers every hour');
    equal(all.daily.reduce((sum, day) => sum + day.starts, 0), EXPECTED.starts, 'daily starts reconcile');
    equal(all.daily.reduce((sum, day) => sum + day.ends, 0), EXPECTED.ends, 'daily ends reconcile');
    assert(all.hourly.every(hour => hour.uniqueHumans >= 0 && hour.uniqueHumans <= 2), 'hourly humans exclude bots');
    equal(all.games[0].mode, 'coup', 'Coup leads popularity ranking');
    equal(all.games[0].starts, 3, 'ranking counts table starts rather than participants');
    for (const [mode, expected] of Object.entries({ coup: [3, 1, 2], insider: [2, 1, 1], werewolf: [1, 0, 1] })) {
        const game = all.games.find(item => item.mode === mode);
        assert(Boolean(game), `${mode} appears in ranking`);
        equal([game.starts, game.ends, game.uniqueHumans], expected, `${mode} ranking totals`);
    }
    equal(all.people.map(person => person.playerId).sort(), ['p1', 'p2'], 'people identify two distinct humans with the same name');
    for (const [id, expected] of Object.entries({ p1: [5, 2, 47], p2: [3, 1, 25] })) {
        const person = all.people.find(item => item.playerId === id);
        equal([person.starts, person.ends, person.events], expected, `${id} person totals`);
        equal(person.playerName, NAME, `${id} retains shared display name`);
        assert(Number.isFinite(Date.parse(person.lastAt)), `${id} has last activity time`);
    }
    assert(['coup', 'insider', 'werewolf'].every(mode => all.modes.some(item => item.mode === mode && item.label)), 'mode choices include all fixture modes');
    equal(all.activity.pageSize, 50, 'API page size is fifty');
    equal(all.activity.rows.length, 50, 'first API page is bounded');
    // The local app may also write its own startup system entries.
    const next = await api(context, base, { page: 2 });
    const allIds = [...all.activity.rows, ...next.activity.rows].map(row => row.id);
    equal(new Set(allIds).size, allIds.length, 'API pages do not overlap');
    assert(fixture.every(row => allIds.includes(row.id)), 'API pages retain every seeded event');

    const mode = await api(context, base, { mode: 'coup' });
    summary(mode, { starts: 3, ends: 1, uniqueHumans: 2, joins: 60, errors: 1, botStarts: 0 }, 'mode');
    assert(mode.activity.rows.every(row => row.mode === 'coup'), 'mode scopes feed and statistics');
    const today = await api(context, base, { days: 1 });
    summary(today, { starts: 5, ends: 2 }, 'one day excludes older legacy start');
    for (const [playerId, expected] of Object.entries({
        p1: { starts: 5, ends: 2, uniqueHumans: 1, joins: 40, errors: 0, botStarts: 1 },
        p2: { starts: 3, ends: 1, uniqueHumans: 1, joins: 20, errors: 1 }
    })) {
        const data = await api(context, base, { playerId });
        summary(data, expected, playerId);
        equal(data.activity.total, playerId === 'p1' ? 47 : 25, `${playerId} exact identity total`);
        assert(data.activity.rows.every(row => row.players.some(player => player.playerId === playerId)), `${playerId} uses recorded identity`);
        assert(data.activity.rows.every(row => !row.message.includes('legacy-noidentity') && !row.message.includes(`${playerId === 'p1' ? 'p2' : 'p1'}-only`)), `${playerId} excludes namesake and unidentified legacy events`);
    }
    for (const [kind, count] of Object.entries({ join: 60, admin: 1, error: 1, leave: 0 })) {
        const data = await api(context, base, { kind });
        summary(data, EXPECTED, `kind=${kind} leaves aggregate statistics unchanged`);
        equal(data.activity.total, count, `${kind} total`);
        assert(data.activity.rows.every(row => row.kind === kind), `${kind} limits only activity kind`);
    }
    const first = await api(context, base, { search: 'insights-page' });
    const second = await api(context, base, { search: 'insights-page', page: 2 });
    summary(first, EXPECTED, 'search leaves aggregates unchanged');
    equal([first.activity.total, first.activity.pages, first.activity.rows.length, second.activity.rows.length], [60, 2, 50, 10], 'search pagination is fifty plus ten');
    const messages = [...first.activity.rows, ...second.activity.rows].map(row => row.message);
    equal(new Set(messages).size, 60, 'pagination covers sixty unique search matches');
    assert(messages.every(message => message.includes('insights-page')), 'search filters server results');
}

async function rendered(page, data, tag) {
    await page.waitForFunction(() => document.querySelector('#adminInsights')?.getAttribute('aria-busy') === 'false'
        && !document.querySelector('#insightContent')?.hidden && document.querySelector('#insightError')?.hidden);
    await page.waitForFunction(count => document.querySelectorAll('#insightActivity .insights-event').length === count, data.activity.rows.length);
    equal(await page.locator('#insightActivity .insights-event-message').allTextContents(), data.activity.rows.map(row => row.message), `${tag} UI feed matches server rows`);
    const expectedTotals = ['starts', 'ends', 'uniqueHumans', 'joins', 'errors', 'testStarts'].map(key => String(data.summary[key]));
    equal((await page.locator('#insightTotals dd').allTextContents()).map(text => text.replace(/,/g, '')), expectedTotals, `${tag} UI summary matches API`);
    equal(await page.locator('#insightPeople [data-player]').count(), data.people.length, `${tag} UI people match API`);
    equal(await page.locator('#insightGames [data-mode]').evaluateAll(elements => elements.map(element => element.dataset.mode)), data.games.map(game => game.mode), `${tag} UI ranking order matches API`);
    equal(await page.locator('#insightDaily .insights-daily-row').count(), data.daily.length, `${tag} daily chart renders`);
    equal(await page.locator('#insightHours .insights-hour').count(), 24, `${tag} hourly chart renders`);
    assert(!(await page.locator('#adminInsights').innerText()).includes(PRIVATE), `${tag} UI hides private metadata`);
}
// A page navigation discards CDP response bodies from the departing document.
// Wait for the new document to finish rendering, then independently compare its
// controls and DOM against the authenticated API. In-page actions still assert
// their actual network response through load().
async function visit(page, url, expected = {}) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#adminInsights')?.getAttribute('aria-busy') === 'false'
        && !document.querySelector('#insightContent')?.hidden && document.querySelector('#insightError')?.hidden);
    const query = await page.evaluate(() => ({
        days: document.querySelector('#insightDays').value,
        mode: document.querySelector('#insightMode').value,
        playerId: document.querySelector('#insightPlayer').value,
        kind: document.querySelector('#insightKind').value,
        search: document.querySelector('#insightSearch').value,
        page: Number(document.querySelector('#insightPage').textContent.split('/')[0].trim())
    }));
    for (const [key, value] of Object.entries(expected)) equal(String(query[key]), String(value), `navigation ${key} filter`);
    const data = await api(page.context(), new URL(url).origin, query);
    await rendered(page, data, 'navigation');
    return data;
}

async function load(page, action, query = {}) {
    const [response] = await Promise.all([
        page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === API_PATH && Object.entries(query).every(([key, value]) => url.searchParams.get(key) === String(value));
        }),
        action()
    ]);
    equal(response.status(), 200, 'UI requests succeed');
    assert(/\bno-store\b/.test(response.headers()['cache-control'] || ''), 'UI receives no-store data');
    const data = await response.json();
    noSecrets(data, 'UI response');
    await rendered(page, data, 'loaded');
    return data;
}
async function layout(page, tag) {
    await page.evaluate(() => document.fonts.ready);
    const problems = await page.evaluate(() => {
        const issues = [];
        const day = document.querySelector('#insightDays').getBoundingClientRect();
        const game = document.querySelector('#insightMode').getBoundingClientRect();
        if (Math.min(day.right, game.right) - Math.max(day.left, game.left) > 1
            && Math.min(day.bottom, game.bottom) - Math.max(day.top, game.top) > 1) issues.push('day and game selects overlap');
        if (document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1) issues.push('page horizontal overflow');
        document.querySelectorAll('#adminInsights input, #adminInsights select, #adminInsights button, #insightActivity .insights-event-line, #insightActivity .insights-detail-body').forEach(element => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            if (rect.left < -1 || rect.right > innerWidth + 1) issues.push(element.id || element.className);
        });
        return issues;
    });
    equal(problems, [], `${tag} controls and content fit viewport`);
    equal(await page.locator('.insights-header').evaluate(element => getComputedStyle(element).backgroundImage), 'none', `${tag} insights header does not inherit the global branding background`);
    equal(await page.locator('.insights-header').evaluate(element => element.tagName === 'HEADER'), false, `${tag} insights heading avoids global header styles`);
    const dailyBars = await page.locator('#insightDaily .insights-day-plot > span').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height };
    }));
    assert(dailyBars.filter(bar => bar.width > 0 && bar.height > 0).length >= 3, `${tag} both recent daily values and legacy start draw positive vertical bars`);
    const track = await page.locator('#insightGames [data-mode="coup"] .insights-track').boundingBox();
    assert(track && track.width > 0 && track.height > 0, `${tag} Coup ranking track has positive dimensions`);
    const fill = await page.locator('#insightGames [data-mode="coup"] .insights-track > span').boundingBox();
    assert(fill && fill.width > 0 && fill.height > 0 && fill.width <= track.width + 1 && fill.height <= track.height + 1, `${tag} Coup ranking bar is visible within its track`);
}
async function exportPage(page, expected) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#insightExport').click()]);
    const text = fs.readFileSync(await download.path(), 'utf8');
    equal(text.trim().split(/\r?\n/).length, expected.activity.rows.length + 1, 'CSV contains header and current page only');
    assert(expected.activity.rows.every(row => text.includes(row.message)), 'CSV exports every visible activity');
    assert(!text.includes(PRIVATE), 'CSV omits private metadata');
    equal(download.suggestedFilename(), `insider-activity-page-${expected.activity.page}.csv`, 'CSV filename identifies current page');
}

async function collapsedActivity(page, tag) {
    const rows = page.locator('#insightActivity .insights-event');
    assert(await rows.count() > 0, `${tag} compact activity has rows`);
    equal(await page.locator('#insightActivity .insights-event-message:visible').count(), 0, `${tag} raw messages start hidden`);
    equal(await page.locator('#insightActivity .insights-detail-body:visible').count(), 0, `${tag} all activity details start collapsed`);
    const first = rows.first();
    const toggle = first.locator('.insights-expand');
    equal(await toggle.getAttribute('aria-expanded'), 'false', `${tag} collapsed activity exposes its state`);
    equal(await toggle.getAttribute('aria-controls'), await first.locator('.insights-detail-body').getAttribute('id'), `${tag} expand control identifies its detail body`);
    await toggle.click();
    equal(await toggle.getAttribute('aria-expanded'), 'true', `${tag} expanding activity updates aria state`);
    assert(await first.locator('.insights-event-message').isVisible(), `${tag} expanding activity reveals its message`);
    equal(await page.locator('#insightActivity .insights-detail-body:visible').count(), 1, `${tag} expanding one activity opens only its body`);
    await toggle.click();
    equal(await toggle.getAttribute('aria-expanded'), 'false', `${tag} collapsing activity restores aria state`);
    equal(await page.locator('#insightActivity .insights-event-message:visible').count(), 0, `${tag} collapsing hides raw messages again`);
}

async function adminOverviewChecks(page, base, width, artifacts) {
    const tag = `[admin ${width}]`;
    await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
    const tab = page.locator('[data-tab="overview"]');
    await tab.waitFor({ state: 'attached' });
    equal(await tab.count(), 1, `${tag} admin navigation includes overview`);
    assert(await tab.evaluate(element => element.classList.contains('active')), `${tag} overview is the default tab`);
    await page.locator('#tab-overview #adminInsights').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#adminInsights')?.getAttribute('aria-busy') === 'false'
        && !document.querySelector('#insightContent')?.hidden && document.querySelector('#insightError')?.hidden);
    equal((await page.locator('#insightTotals dd').allTextContents()).map(text => text.replace(/,/g, '')),
        ['6', '2', '2', '60', '1', '0'], `${tag} embedded overview shows fixture counts`);
    equal(await page.locator('#insightPlayer').inputValue(), '', `${tag} default overview is not scoped to browser identity`);
    await collapsedActivity(page, tag);
    assert(!/จบ\s*(?:มือ|โต๊ะ)/.test(await page.locator('#adminInsights').innerText()), `${tag} embedded overview avoids rejected wording`);
    await layout(page, tag);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, `admin-overview-${width}-viewport.png`), animations: 'disabled' });
    await page.screenshot({ path: path.join(artifacts, `admin-overview-${width}.png`), fullPage: true, animations: 'disabled' });
}

async function browserChecks(page, base, width, artifacts) {
    const tag = `[${width}]`;
    const initial = await visit(page, `${base}/admin/insights`);
    await page.waitForURL(url => url.pathname === '/admin/insights');
    equal(initial.query.playerId, '', `${tag} admin navigation starts without an unintended player filter`);
    summary(initial, EXPECTED, `${tag} initial`);
    equal(await page.locator('#insightPlayer').inputValue(), '', `${tag} navigation ignores browser identity as a filter`);
    const browserIdentity = await page.evaluate(() => localStorage.getItem('insiderGamePlayerId'));
    assert(Boolean(browserIdentity), `${tag} browser has its own identity`);
    const identityQuery = await visit(page, `${base}/admin/insights?playerId=${encodeURIComponent(browserIdentity)}`, { playerId: '' });
    summary(identityQuery, EXPECTED, `${tag} page playerId query does not scope analytics`);
    equal(await page.locator('#insightPlayer').inputValue(), '', `${tag} explicit browser identity query leaves filter empty`);
    equal(await page.evaluate(() => localStorage.getItem('insiderGamePlayerId')), browserIdentity, `${tag} loading insights preserves browser identity`);
    assert(await page.locator('#insightPrev').isDisabled(), `${tag} previous disabled on first page`);
    equal(await page.locator('#insightGames [data-mode]').first().getAttribute('data-mode'), 'coup', `${tag} top ranked game displayed`);
    equal((await page.locator('#insightGames [data-mode="coup"] .insights-game-count').innerText()).split(/\s/)[0], '3', `${tag} top game's start count`);
    await collapsedActivity(page, tag);
    assert(!/จบ\s*(?:มือ|โต๊ะ)/.test(await page.locator('#adminInsights').innerText()), `${tag} visible dashboard uses plain game and round wording`);
    await layout(page, tag);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, `insights-${width}-viewport.png`), animations: 'disabled' });
    await page.screenshot({ path: path.join(artifacts, `insights-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.locator('#insightActivitySection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, `insights-${width}-activity.png`), animations: 'disabled' });
    await page.evaluate(() => window.scrollTo(0, 0));

    const filteredMode = await load(page, () => page.locator('#insightMode').selectOption('insider'), { mode: 'insider' });
    summary(filteredMode, { starts: 2, ends: 1, uniqueHumans: 1, joins: 0 }, `${tag} mode`);
    assert(filteredMode.activity.rows.every(row => row.mode === 'insider'), `${tag} mode filters timeline`);
    await load(page, () => page.locator('#insightMode').selectOption('all'), { mode: 'all' });
    const oneDay = await load(page, () => page.locator('#insightDays').selectOption('1'), { days: 1 });
    summary(oneDay, { starts: 5, ends: 2 }, `${tag} day filter`);
    await load(page, () => page.locator('#insightDays').selectOption('7'), { days: 7 });
    const errors = await load(page, () => page.locator('#insightKind').selectOption('error'), { kind: 'error' });
    equal(errors.activity.total, 1, `${tag} error kind yields one event`);
    summary(errors, EXPECTED, `${tag} kind leaves stats unchanged`);
    await load(page, () => page.locator('#insightClear').click(), { kind: 'all', playerId: '', search: '' });
    const exact = await load(page, () => page.locator('#insightPeople [data-player="p1"]').click(), { playerId: 'p1' });
    equal(await page.locator('#insightPlayer').inputValue(), 'p1', `${tag} person link fills exact ID`);
    equal(exact.activity.total, 47, `${tag} namesake does not contaminate player history`);
    assert(exact.activity.rows.every(row => row.players.some(player => player.playerId === 'p1') && !row.message.includes('p2-only') && !row.message.includes('legacy-noidentity')), `${tag} player link preserves identity boundary`);
    equal(new URL(page.url()).searchParams.get('focusPlayer'), 'p1', `${tag} scoped history uses focusPlayer in copied page URL`);
    const restored = await visit(page, page.url(), { playerId: 'p1' });
    equal(restored.activity.total, 47, `${tag} copied focusPlayer URL restores exact history`);
    equal(await page.locator('#insightPlayer').inputValue(), 'p1', `${tag} copied URL restores player input`);
    equal(await page.evaluate(() => localStorage.getItem('insiderGamePlayerId')), browserIdentity, `${tag} copied focusPlayer URL preserves browser identity`);
    const twin = await load(page, () => page.locator('#insightPlayer').fill('p2'), { playerId: 'p2' });
    equal(twin.activity.total, 25, `${tag} typed player ID selects second namesake`);
    summary(twin, { starts: 3, ends: 1, uniqueHumans: 1, joins: 20 }, `${tag} typed player changes stats`);
    await load(page, () => page.locator('#insightClear').click(), { playerId: '' });
    const first = await load(page, () => page.locator('#insightSearch').fill('insights-page'), { search: 'insights-page', page: 1 });
    summary(first, EXPECTED, `${tag} search leaves stats unchanged`);
    equal([first.activity.total, first.activity.rows.length], [60, 50], `${tag} first search page`);
    assert(await page.locator('#insightPrev').isDisabled() && await page.locator('#insightNext').isEnabled(), `${tag} first page controls`);
    if (width === 1280) await exportPage(page, first);
    const second = await load(page, () => page.locator('#insightNext').click(), { page: 2, search: 'insights-page' });
    equal(second.activity.rows.length, 10, `${tag} second page has ten entries`);
    equal(new Set([...first.activity.rows, ...second.activity.rows].map(row => row.id)).size, 60, `${tag} UI pages do not overlap`);
    assert(await page.locator('#insightNext').isDisabled() && await page.locator('#insightPrev').isEnabled(), `${tag} last page controls`);
    if (width === 1280) await exportPage(page, second);
    const previous = await load(page, () => page.locator('#insightPrev').click(), { page: 1 });
    equal(previous.activity.rows.map(row => row.id), first.activity.rows.map(row => row.id), `${tag} previous restores first page`);
    const combined = await load(page, () => page.locator('#insightKind').selectOption('join'), { kind: 'join', search: 'insights-page', page: 1 });
    equal(combined.activity.total, 60, `${tag} search and kind combine`);
    const empty = await load(page, () => page.locator('#insightSearch').fill('insights-no-such-event'), { search: 'insights-no-such-event', page: 1 });
    equal(empty.activity.total, 0, `${tag} unmatched search returns empty feed`);
    summary(empty, EXPECTED, `${tag} empty search preserves stats`);
    assert(await page.locator('#insightActivity .insights-empty').isVisible(), `${tag} empty state is visible`);
    assert(await page.locator('#insightPrev').isDisabled() && await page.locator('#insightNext').isDisabled() && await page.locator('#insightExport').isDisabled(), `${tag} empty feed disables pagination and export`);
    await page.screenshot({ path: path.join(artifacts, `insights-${width}-empty.png`), fullPage: true, animations: 'disabled' });
    await load(page, () => page.locator('#insightClear').click(), { search: '', kind: 'all' });
    const noPlayer = await load(page, () => page.locator('#insightPlayer').fill('insights-unknown-player'), { playerId: 'insights-unknown-player' });
    summary(noPlayer, { starts: 0, ends: 0, uniqueHumans: 0, joins: 0, errors: 0 }, `${tag} unknown player has zero activity`);
    equal(noPlayer.activity.total, 0, `${tag} unknown player empty history`);
    await load(page, () => page.locator('#insightClear').click(), { playerId: '' });

    const failureRoute = '**/admin/api/insights*';
    await page.route(failureRoute, route => route.fulfill({ status: 503, contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ success: false, error: 'โหลดข้อมูลไม่สำเร็จ ลองอีกครั้ง' }) }));
    try {
        const [failure] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === API_PATH && response.status() === 503), page.locator('#insightRefresh').click()]);
        equal(failure.status(), 503, `${tag} simulated API failure`);
        await page.locator('#insightError').waitFor({ state: 'visible' });
        assert((await page.locator('#insightError').innerText()).includes('โหลดข้อมูลไม่สำเร็จ'), `${tag} useful error shown`);
        assert(await page.locator('#insightContent').isHidden(), `${tag} stale statistics hidden after failure`);
        await page.screenshot({ path: path.join(artifacts, `insights-${width}-error.png`), fullPage: true, animations: 'disabled' });
    } finally {
        await page.unroute(failureRoute);
    }
    const recovered = await load(page, () => page.locator('#insightRefresh').click());
    summary(recovered, EXPECTED, `${tag} refresh recovers after error`);
    assert(await page.locator('#insightError').isHidden(), `${tag} error clears after successful retry`);
    await layout(page, `${tag} recovered`);
}

async function run() {
    // Always create our own directory, even when a caller has GAME_DATA_DIR set.
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insider-insights-data-'));
    const artifactRoot = process.env.SMOKE_ARTIFACT_DIR || process.env.TEST_ARTIFACT_DIR;
    if (artifactRoot) fs.mkdirSync(path.resolve(artifactRoot), { recursive: true });
    const artifacts = fs.mkdtempSync(path.join(artifactRoot ? path.resolve(artifactRoot) : os.tmpdir(), 'insider-insights-browser-'));
    let child, browser, currentPage, adminStorageState;
    try {
        fs.mkdirSync(artifacts, { recursive: true });
        const fixture = seed(dataDir);
        const { adminPassword } = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings.json'), 'utf8'));
        assert(typeof adminPassword === 'string' && adminPassword.length > 0, 'local settings provide test credentials');
        const base = `http://127.0.0.1:${await freePort()}`;
        let spawnError;
        child = spawn(process.execPath, [path.join(ROOT, 'app.js')], { cwd: ROOT,
            env: { ...process.env, PORT: new URL(base).port, GAME_DATA_DIR: dataDir, MONGO_URL: '', MONGODB_URI: '', LOG_RETENTION_DAYS: '7',
                NODE_ENV: 'test', APP_ENV: 'staging', ADMIN_PASSWORD: adminPassword,
                SESSION_SECRET: randomBytes(32).toString('hex'), PUBLIC_BASE_URL: base },
            stdio: 'ignore' });
        child.once('error', error => { spawnError = error; });
        await waitForServer(base, child, () => spawnError);
        browser = await chromium.launch(browserOptions());
        const stranger = await browser.newContext();
        try {
            const redirect = await stranger.request.get(`${base}/admin/insights`, { maxRedirects: 0 });
            equal(redirect.status(), 302, 'unauthenticated HTML redirects');
            equal(new URL(redirect.headers().location, base).pathname, '/admin/login', 'redirect targets admin login');
            const denied = await stranger.request.get(`${base}${API_PATH}`);
            assert([401, 403].includes(denied.status()), 'unauthenticated insights API is denied');
            equal((await denied.json()).success, false, 'unauthenticated API returns no insights');
        } finally { await stranger.close(); }
        const viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 780 }];
        for (const viewport of viewports) {
            const context = await browser.newContext({ viewport, locale: 'th-TH', acceptDownloads: true });
            context.setDefaultTimeout(TIMEOUT_MS);
            const errors = [];
            try {
                currentPage = await context.newPage();
                monitorPage(currentPage, errors, base);
                await currentPage.goto(`${base}/admin/login`, { waitUntil: 'domcontentloaded' });
                await currentPage.locator('input[name="password"]').fill(adminPassword);
                await Promise.all([currentPage.waitForURL(url => url.pathname === '/admin'),
                    currentPage.locator('input[name="password"]').press('Enter')]);
                if (viewport.width === 1280) await apiChecks(context, base, fixture);
                await browserChecks(currentPage, base, viewport.width, artifacts);
                if (!adminStorageState) adminStorageState = await context.storageState();
                equal(errors, [], `[${viewport.width}] no browser errors or failed local assets`);
                console.log(`admin-insights-browser: ${viewport.width}px passed`);
            } catch (error) {
                if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(artifacts, `insights-${viewport.width}-failure.png`), fullPage: true }).catch(() => {});
                throw error;
            } finally { await context.close(); currentPage = null; }
        }
        for (const viewport of viewports) {
            const context = await browser.newContext({ viewport, locale: 'th-TH', storageState: adminStorageState });
            context.setDefaultTimeout(TIMEOUT_MS);
            const errors = [];
            try {
                currentPage = await context.newPage();
                monitorPage(currentPage, errors, base);
                await adminOverviewChecks(currentPage, base, viewport.width, artifacts);
                equal(errors, [], `[admin ${viewport.width}] no browser errors or failed local assets`);
                console.log(`admin-overview-browser: ${viewport.width}px passed`);
            } catch (error) {
                if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(artifacts, `admin-overview-${viewport.width}-failure.png`), fullPage: true }).catch(() => {});
                throw error;
            } finally { await context.close(); currentPage = null; }
        }
        console.log(`admin-insights-browser: ${passed} assertions passed`);
    } finally {
        console.log(`admin-insights-browser artifacts: ${artifacts}`);
        try { if (browser) await browser.close(); }
        finally { await stopServer(child); fs.rmSync(dataDir, { recursive: true, force: true }); }
    }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
