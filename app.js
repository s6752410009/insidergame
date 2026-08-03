/**
 * INSIDER GAME - Multi-Room Version
 * Refactored to support Lobby + Multi-Room + Player Identity + Statistics
 * Original game logic preserved and wrapped with room system
 */

const express = require('express');
const app = express();

var server = require('http').createServer(app),
    ent = require('ent'),
    session = require('express-session'),
    bodyParser = require('body-parser'),
    expressLayouts = require('express-ejs-layouts');

const { Server } = require('socket.io');
const io = new Server(server, {
    pingTimeout: 60000,        // 60 seconds ping timeout (default 20s)
    pingInterval: 25000,       // 25 seconds ping interval (default 25s)
    connectTimeout: 45000,     // 45 seconds connect timeout
    upgradeTimeout: 30000,     // 30 seconds upgrade timeout
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    perMessageDeflate: false   // Disable for better mobile performance
});

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = packageJson.version || '0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://insider-th.me';
const SESSION_SECRET = process.env.SESSION_SECRET || 'session-insider-secret';
const SEO_PREVIEW_PLAYER_ID = '00000000-0000-4000-8000-000000000001';
const CRAWLER_USER_AGENT_REGEX = /(googlebot|bingbot|duckduckbot|slurp|baiduspider|yandexbot|facebookexternalhit|twitterbot|linkedinbot|applebot|petalbot|bytespider|gptbot|chatgpt-user|claudebot|anthropic-ai|ccbot|perplexitybot|amazonbot)/i;
// Import managers
const playerManager = require('./managers/playerManager');
const roomManager = require('./managers/roomManager');
const statsManager = require('./managers/statsManager');
const gameSettingsManager = require('./managers/gameSettingsManager');
const seasonManager = require('./managers/seasonManager');
const adminMessageManager = require('./managers/adminMessageManager');
const { getGameEngine, getAvailableGameModes } = require('./games/engineRegistry');

app.locals.appVersion = APP_VERSION;

// Load settings (including admin password)
const settings = JSON.parse(fs.readFileSync('./settings.json', 'utf8'));
const ADMIN_PASSWORD = settings.adminPassword || 'admin123';
const ALLOW_LEGACY_SOCKET_IDENTITY = process.env.ALLOW_LEGACY_SOCKET_IDENTITY === '1';

// Constants from roomManager
const gameMasterRole = roomManager.gameMasterRole;
const traitorRole = roomManager.traitorRole;
const defaultRole = roomManager.defaultRole;

let nextMessageId = 1; // สำหรับสร้าง ID ข้อความที่ไม่ซ้ำกัน

// เก็บ mapping ระหว่าง socket.id กับ roomId (สำหรับ lookup เร็ว)
const socketRoomMap = new Map(); // Key: socket.id, Value: roomId

// เก็บ countdown intervals ต่อห้อง (Key: roomId, Value: interval)
const roomCountdowns = new Map();

// เก็บ timeout สำหรับ phase อัตโนมัติของ Werewolf
const werewolfPhaseTimeouts = new Map();

// เก็บ timeout ช่วงคั่นก่อน broadcast phase ถัดไปของ Werewolf
const werewolfTransitionTimeouts = new Map();

// เก็บ timeout สำหรับ phase อัตโนมัติของ Black Market
const blackMarketPhaseTimeouts = new Map();

// เก็บ timeout สำหรับ phase อัตโนมัติของ Spyfall
const spyfallPhaseTimeouts = new Map();
const spyfallReturnTimeouts = new Map();

// เก็บ timeout สำหรับ disconnect notification (Key: playerId, Value: timeout)
const disconnectTimeouts = new Map();

// เก็บ socket IDs ที่ authenticated เป็น admin (Key: socket.id, Value: true)
const adminSockets = new Set();

// เก็บ admin tokens ชั่วคราวสำหรับหน้า dashboard
const adminTokens = new Map();

// Lightweight anti-spam window for the public support inbox.
const supportMessageRateLimits = new Map();

// เก็บ server activity logs (เก็บ 500 logs ล่าสุด)
const serverLogs = [];
const MAX_SERVER_LOGS = 2000;

const ROOM_OFFLINE_GRACE_MS = 10 * 60 * 1000;
const ROOM_SWEEP_INTERVAL_MS = 60 * 1000;
const WEREWOLF_PHASE_TRANSITION_DELAY_MS = 2600;
const WEREWOLF_MORNING_RECAP_BUFFER_MS = 14000;

// สร้าง admin token
function generateAdminToken() {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.set(token, { createdAt: Date.now() });
    // ลบ token หลัง 60 วินาที (ป้องกัน token leak)
    setTimeout(() => adminTokens.delete(token), 60000);
    return token;
}

function emitAdminInboxUpdate(payload = {}) {
    const update = {
        ...payload,
        unreadCount: adminMessageManager.getUnreadAdminCount()
    };
    adminSockets.forEach(socketId => io.to(socketId).emit('adminInboxUpdate', update));
}

function canSendSupportMessage(rateKey, limit = 8) {
    const now = Date.now();
    if (supportMessageRateLimits.size > 1000) {
        supportMessageRateLimits.forEach((timestamps, key) => {
            if (!timestamps.some(timestamp => now - timestamp < 60 * 1000)) supportMessageRateLimits.delete(key);
        });
    }
    const recent = (supportMessageRateLimits.get(rateKey) || []).filter(timestamp => now - timestamp < 60 * 1000);
    if (recent.length >= limit) {
        supportMessageRateLimits.set(rateKey, recent);
        return false;
    }
    recent.push(now);
    supportMessageRateLimits.set(rateKey, recent);
    return true;
}

function normalizeSupportBody(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function safeJsonForScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function requireAdminSession(req, res, next) {
    if (!req.session?.isAdmin) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

function getSupportSessionPlayerId(req) {
    const supportId = String(req.session?.supportPlayerId || '');
    if (playerManager.isValidPlayerId(supportId)) return supportId;
    const sessionId = String(req.session?.playerId || '');
    return playerManager.isValidPlayerId(sessionId) ? sessionId : null;
}

function createSupportToken(playerId) {
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
    const payload = `${playerId}.${expiresAt}`;
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    return `${payload}.${signature}`;
}

function verifySupportToken(token, playerId) {
    const raw = String(token || '');
    const parts = raw.split('.');
    if (parts.length !== 3) return false;
    const [tokenPlayerId, expiresAt, signature] = parts;
    if (!playerManager.isValidPlayerId(tokenPlayerId) || tokenPlayerId !== String(playerId || '')) {
        return false;
    }
    const expiresMs = Number(expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
        return false;
    }
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${tokenPlayerId}.${expiresAt}`).digest('hex');
    try {
        const left = Buffer.from(signature, 'utf8');
        const right = Buffer.from(expected, 'utf8');
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    } catch (error) {
        return false;
    }
}

function resolveSupportPlayerId(req) {
    const requestedId = String(req.query?.playerId || req.body?.playerId || '');
    const sessionId = getSupportSessionPlayerId(req);
    const token = req.get('x-support-token') || req.body?.supportToken || req.query?.supportToken || '';

    if (sessionId && (!requestedId || requestedId === sessionId)) {
        return sessionId;
    }
    if (requestedId && verifySupportToken(token, requestedId)) {
        if (req.session) {
            req.session.supportPlayerId = requestedId;
            req.session.playerId = requestedId;
        }
        return requestedId;
    }
    return null;
}

function buildCanonicalUrl(pathname = '/') {
    return new URL(pathname, PUBLIC_BASE_URL).toString();
}

function isCrawlerRequest(req) {
    const userAgent = String(req.get('user-agent') || '');
    return CRAWLER_USER_AGENT_REGEX.test(userAgent);
}

function isIndexablePublicPath(pathname = '/') {
    return pathname === '/' || pathname === '/rooms' || pathname === '/how-to-play';
}

function shouldUseSeoPreview(req) {
    return isCrawlerRequest(req) && isIndexablePublicPath(req.path || '/');
}

function buildStructuredData(pathname, canonicalUrl) {
    if (pathname === '/') {
        return [
            {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                name: 'Insider Game Thailand',
                alternateName: 'Insider Game + Werewolf Online',
                url: buildCanonicalUrl('/'),
                inLanguage: ['th', 'en'],
                description: 'เว็บเล่นเกม Insider, Werewolf และ Black Market ออนไลน์ฟรี เล่นกับเพื่อนได้ทันทีบนมือถือและเดสก์ท็อปโดยไม่ต้องติดตั้งแอป'
            },
            {
                '@context': 'https://schema.org',
                '@type': 'WebApplication',
                name: 'Insider Game + Werewolf Online',
                url: canonicalUrl,
                applicationCategory: 'GameApplication',
                operatingSystem: 'Web Browser',
                inLanguage: ['th', 'en'],
                browserRequirements: 'Requires JavaScript. Works on modern mobile and desktop browsers.',
                offers: {
                    '@type': 'Offer',
                    price: '0',
                    priceCurrency: 'THB'
                },
                featureList: [
                    'เล่น Insider ออนไลน์',
                    'เล่น Werewolf ออนไลน์',
                    'เล่น Black Market ออนไลน์',
                    'สร้างห้องและเล่นกับเพื่อน',
                    'ใช้งานผ่านเว็บโดยไม่ต้องติดตั้งแอป'
                ],
                description: 'แพลตฟอร์มเกมปาร์ตี้บนเว็บสำหรับเล่น Insider, Werewolf และ Black Market กับเพื่อนแบบหลายคน'
            }
        ];
    }

    if (pathname === '/rooms') {
        return [
            {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: 'ห้องเกม Insider, Werewolf และ Black Market',
                url: canonicalUrl,
                isPartOf: buildCanonicalUrl('/'),
                inLanguage: 'th',
                description: 'หน้ารวมห้องเกมสำหรับสร้างห้องใหม่หรือเข้าห้องเดิมเพื่อเล่น Insider, Werewolf และ Black Market ออนไลน์'
            }
        ];
    }

    if (pathname === '/how-to-play') {
        return [
            {
                '@context': 'https://schema.org',
                '@type': 'Article',
                headline: 'วิธีเล่น Insider, Werewolf และ Black Market ออนไลน์',
                description: 'คู่มือสรุปวิธีเล่น 3 โหมดหลักของ Insider Game Thailand พร้อมรูปแบบการชนะและจังหวะเริ่มเกมสำหรับวงเพื่อน',
                inLanguage: 'th',
                url: canonicalUrl,
                mainEntityOfPage: canonicalUrl,
                publisher: {
                    '@type': 'Organization',
                    name: 'Insider Game Thailand',
                    url: buildCanonicalUrl('/')
                }
            },
            {
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: [
                    {
                        '@type': 'Question',
                        name: 'Insider เล่นยังไง?',
                        acceptedAnswer: {
                            '@type': 'Answer',
                            text: 'ผู้เล่นช่วยกันถามคำถามเพื่อทายคำ โดยมีผู้ดำเนินเกมตอบได้แค่ใช่ ไม่ใช่ หรืออาจจะ หลังทายคำถูกต้องต้องโหวตจับจอมบงการให้เจอ'
                        }
                    },
                    {
                        '@type': 'Question',
                        name: 'Werewolf ชนะยังไง?',
                        acceptedAnswer: {
                            '@type': 'Answer',
                            text: 'ชาวบ้านชนะเมื่อกำจัดหมาป่าหมด ส่วนหมาป่าชนะเมื่อจำนวนหมาป่าไม่น้อยกว่าผู้เล่นฝ่ายอื่นที่ยังรอดอยู่'
                        }
                    },
                    {
                        '@type': 'Question',
                        name: 'Black Market เหมาะกับใคร?',
                        acceptedAnswer: {
                            '@type': 'Answer',
                            text: 'เหมาะกับวงที่อยากได้เกมหักเหลี่ยมต่อรองมากกว่าการโกหกตรง ๆ โดยแต่ละบทจะเน้นการแลกข้อมูล การบลัฟ และการหาผลประโยชน์ในโต๊ะเดียวกัน'
                        }
                    }
                ]
            }
        ];
    }

    return null;
}

function buildSeoMetadata(req) {
    const pathname = req.path || '/';
    const canonicalUrl = buildCanonicalUrl(pathname);
    const defaultImage = buildCanonicalUrl('/static/image/title.jpg');
    const isIndexable = isIndexablePublicPath(pathname);
    const pageMap = {
        '/': {
            title: 'Insider Game + Werewolf Online | เล่นฟรีกับเพื่อนบนเว็บ',
            description: 'เล่นเกม Insider, Werewolf และ Black Market ออนไลน์ฟรีกับเพื่อน สร้างห้องไว เล่นบนมือถือหรือเดสก์ท็อปได้โดยไม่ต้องโหลดแอป',
            keywords: 'insider game online, werewolf online, black market game, เกม insider ออนไลน์, เกม werewolf ออนไลน์, เกมปาร์ตี้เล่นกับเพื่อน, เกมหมาป่า, social deduction game thailand'
        },
        '/rooms': {
            title: 'Rooms | สร้างห้องและเข้าห้องเล่น Insider, Werewolf, Black Market',
            description: 'รวมรายชื่อห้องเกมและหน้าสร้างห้องสำหรับ Insider, Werewolf และ Black Market เลือกโหมด ตั้งค่าห้อง และเริ่มเล่นกับเพื่อนได้ทันที',
            keywords: 'สร้างห้องเกมออนไลน์, ห้อง insider, ห้อง werewolf, ห้อง black market, join room party game, multiplayer room browser'
        },
        '/how-to-play': {
            title: 'วิธีเล่น Insider, Werewolf, Black Market | คู่มือ 3 โหมด',
            description: 'อ่านวิธีเล่นแบบสั้นและเข้าใจเร็วสำหรับ Insider, Werewolf และ Black Market พร้อมรูปแบบการชนะ จำนวนผู้เล่นที่เหมาะ และวิธีเริ่มวงบนเว็บ',
            keywords: 'วิธีเล่น insider, วิธีเล่น werewolf, วิธีเล่น black market, กติกา insider, กติกา werewolf, social deduction guide thailand, party game rules'
        }
    };

    const page = pageMap[pathname] || {
        title: 'Insider Game Thailand',
        description: 'เว็บเกมปาร์ตี้ออนไลน์สำหรับเล่นกับเพื่อน',
        keywords: 'insider game, werewolf online, party game'
    };

    if (!isIndexable) {
        if (pathname.startsWith('/game/')) {
            page.title = 'Game Room | Insider Game Thailand';
            page.description = 'หน้าห้องเกมแบบเรียลไทม์สำหรับผู้เล่นที่อยู่ในห้อง';
        } else if (pathname.startsWith('/room/')) {
            page.title = 'Room Lobby | Insider Game Thailand';
            page.description = 'หน้าล็อบบี้ของห้องเกมสำหรับผู้เล่นที่เข้าร่วมแล้ว';
        } else if (pathname === '/settings') {
            page.title = 'Settings | Insider Game Thailand';
            page.description = 'หน้าตั้งค่าส่วนตัวของผู้เล่น';
        } else if (pathname === '/profile') {
            page.title = 'Profile | Insider Game Thailand';
            page.description = 'หน้าโปรไฟล์และสถิติของผู้เล่น';
        }
    }

    return {
        title: page.title,
        description: page.description,
        keywords: page.keywords,
        canonical: canonicalUrl,
        robots: isIndexable ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : 'noindex, nofollow',
        ogType: 'website',
        ogTitle: page.title,
        ogDescription: page.description,
        ogImage: defaultImage,
        ogImageAlt: 'Insider Game Thailand cover art',
        twitterCard: 'summary_large_image',
        twitterTitle: page.title,
        twitterDescription: page.description,
        twitterImage: defaultImage,
        siteName: 'Insider Game Thailand',
        structuredData: buildStructuredData(pathname, canonicalUrl)
    };
}

// ==================== GAME LOGIC HELPER FUNCTIONS ====================
// Refactored to work with gameState instead of global game

/**
 * Reset game state for a room
 */
function resetGame(gameState) {
    gameState.players.forEach(function(player) {
        player.role = defaultRole;
        player.vote1 = null;
        player.vote2 = null;
        player.nbVote2 = 0;
        player.isGhost = false;
    });

    gameState.word = '';
    gameState.countdown = null;
    gameState.resultVote1 = null;
    gameState.resultVote2 = null;
    gameState.status = '';
}

/**
 * Shuffle array
 */
function shuffle(array) {
    let ctr = array.length;
    let temp;
    let index;

    while (ctr > 0) {
        index = Math.floor(Math.random() * ctr);
        ctr--;
        temp = array[ctr];
        array[ctr] = array[index];
        array[index] = temp;
    }

    return array;
}

/**
 * Compare players for sorting
 */
function comparePlayer(a, b) {
    if (a.isGhost) {
        return 1; 
    } else if (b.isGhost) {
        return -1;
    } else if (a.name > b.name) {
        return 1;
    } else if (a.name < b.name) {
        return -1;
    }
    return 0;
}

/**
 * Set role for a player (helper for randomRoles)
 */
function setRole(players, role) {
    players.some(function(player) {
        if(player.role === defaultRole) {
            player.role = role;
            return true;
        }
    });
}

/**
 * Add ghost player to game
 */
function addGhostPlayerToGame(players) {
    const defaultPlayers = players.filter(player => player.role === defaultRole);
    if (defaultPlayers.length > 0) {
        const ghostIndex = players.indexOf(defaultPlayers[Math.floor(Math.random() * defaultPlayers.length)]);
        players[ghostIndex].isGhost = true;
        console.log(`No Traitor in this game. ${players[ghostIndex].name} is the Ghost Player.`);
    }
    return players;
}

/**
 * Random roles for players
 */
function randomRoles(gameState, settings) {
    resetGame(gameState);
    
    let players = [...gameState.players]; // Copy array
    players = shuffle(players);
    
    // สุ่มผู้ดำเนินเกม
    const gmIndex = Math.floor(Math.random() * players.length);
    players[gmIndex].role = gameMasterRole;

    // คำนวณจำนวนจอมบงการ
    const actualPlayersCount = players.length - 1; // ลบ GM ออก
    let numTraitors = 1;

    // ใช้ setting dualTraitorMode แทนการคำนวณอัตโนมัติ
    // ต้องมีผู้เล่น 5+ คน (ไม่รวม GM = 4+) ถึงจะเปิดโหมด 2 จอมบงการได้
    if (settings.dualTraitorMode && actualPlayersCount >= 4) {
        numTraitors = 2;
    }

    let hasTraitorInThisRound = true;
    if (settings.traitorOptional && Math.random() < 0.01) {
        hasTraitorInThisRound = false;
        numTraitors = 0;
    }

    if (hasTraitorInThisRound) {
        for (let i = 0; i < numTraitors; i++) {
            setRole(players, traitorRole);
        }
    } else {
        addGhostPlayerToGame(players);
    }

    players = shuffle(players);
    players.sort(comparePlayer);
    
    // Update gameState
    gameState.players = players;
    return players;
}

/**
 * Get random word
 */
function getWord(data) {
    if (Array.isArray(data) && data.length) {
        return data[Math.floor(Math.random() * data.length)];
    }
    return gameSettingsManager.getRandomInsiderWord();
}

function getInsiderWordPool() {
    return gameSettingsManager.getInsiderWordPool();
}

function isPlayerBanEnforced(playerId) {
    if (!gameSettingsManager.isBanSystemEnabled()) {
        return false;
    }
    return playerManager.isPlayerBanned(playerId);
}

function isPlayerApproved(playerId) {
    if (!gameSettingsManager.isApprovalRequired()) {
        return true;
    }
    const player = playerManager.getPlayer(playerId);
    if (!player) {
        return true;
    }
    if (player.isSiteAdmin) {
        return true;
    }
    return player.approved !== false;
}

/**
 * Check if everybody has voted
 * Bug #5 Fix: ข้ามผู้เล่นที่ disconnect (ไม่มี socketId) ด้วย
 */
function everybodyHasVoted(gameState, voteNumber) {
    // ดึง online players จาก room (ต้องมี socketId)
    const hasVoted1 = (currentValue) => {
        // ถ้าเป็น ghost หรือ โหวตแล้ว = ถือว่าโหวตแล้ว
        // ถ้า disconnect (ไม่มี socketId) ก็ข้ามไป
        return currentValue.isGhost || currentValue.vote1 !== null || !currentValue.socketId;
    };
    const hasVoted2 = (currentValue) => {
        // GM ไม่ต้องโหวต vote2
        if (currentValue.role === gameMasterRole) return true;
        return currentValue.isGhost || currentValue.vote2 !== null || !currentValue.socketId;
    };

    if(voteNumber == 1) {
        return gameState.players.every(hasVoted1);
    } else {
        return gameState.players.every(hasVoted2);
    }
}

/**
 * Reset votes
 */
function resetVote(gameState, voteNumber) {
    gameState.players.forEach(function(player) {
        if(voteNumber === 1) {
            player.vote1 = null;
        } else {
            player.vote2 = null;
            player.nbVote2 = 0;
        }
    });
}

function buildInsiderVoteCandidates(gameState) {
    return gameState.players
        .filter(player => player.role !== gameMasterRole && !player.isGhost)
        .map(player => ({
            playerId: player.playerId,
            name: player.name,
            color: player.color,
            avatar: player.avatar || '👤',
            avatarFrame: player.avatarFrame || 'none'
        }));
}

function emitInsiderRoleState(room, targetSocketId = null, targetPlayerId = null) {
    const numTraitors = room.gameState.players.filter(player => player.role === traitorRole).length;
    const send = (socketId, playerId) => {
        const player = room.gameState.players.find(candidate => candidate.playerId === playerId);
        if (!socketId || !player) return;
        io.to(socketId).emit('newRole', {
            role: player.role,
            isGhost: !!player.isGhost,
            status: room.gameState.status,
            dualTraitorMode: !!room.settings.dualTraitorMode,
            numTraitors
        });
    };

    if (targetSocketId && targetPlayerId) {
        send(targetSocketId, targetPlayerId);
        return;
    }
    room.players.forEach(player => send(player.socketId, player.playerId));
}

function emitInsiderWordState(room, targetSocketId = null, targetPlayerId = null) {
    const send = (socketId, playerId) => {
        const player = room.gameState.players.find(candidate => candidate.playerId === playerId);
        if (!socketId || !player) return;
        const canSeeWord = player.role === gameMasterRole || player.role === traitorRole;
        io.to(socketId).emit('revealWord', {
            role: player.role,
            word: canSeeWord ? room.gameState.word : null
        });
    };

    if (targetSocketId && targetPlayerId) {
        send(targetSocketId, targetPlayerId);
        return;
    }
    room.players.forEach(player => send(player.socketId, player.playerId));
}

/**
 * Check if player is not game master
 */
function isNotGameMaster(player) {
    return player.role !== gameMasterRole;
}

/**
 * Check if player is ghost
 */
function isGhostPlayer(player) {
    return player.isGhost;
}

/**
 * Add vote count for vote2 - รองรับทั้ง string (1 คน) และ array (2 คน)
 */
function addPlayerVote2(gameState, playerVote) {
    // รองรับทั้ง string และ array
    const votes = Array.isArray(playerVote) ? playerVote : [playerVote];
    
    votes.forEach(function(voteTarget) {
        gameState.players.forEach(function(player) {
            if(voteTarget === player.name || voteTarget === player.playerId) {
                player.nbVote2 += 1;
            }
        });
    });
}

/**
 * Build vote2 progress so clients can render live vote counts and voter lists.
 */
function buildVote2Progress(gameState) {
    const voteTargets = gameState.players
        .filter(isNotGameMaster)
        .map(function(player) {
            return {
                playerId: player.playerId,
                name: player.name,
                count: 0,
                voters: []
            };
        });
    const targetMap = new Map(voteTargets.map(function(target) {
        return [target.playerId || target.name, target];
    }));
    const eligibleVoters = gameState.players.filter(function(player) {
        return player.role !== gameMasterRole && !player.isGhost && !!player.socketId;
    });
    const voterChoices = [];

    eligibleVoters.forEach(function(player) {
        if (player.vote2 === null || typeof player.vote2 === 'undefined') {
            return;
        }

        const submittedVotes = Array.isArray(player.vote2) ? player.vote2 : [player.vote2];
        const voteValues = submittedVotes.filter(Boolean);
        const targetNames = [];

        voteValues.forEach(function(voteTarget) {
            const targetPlayer = gameState.players.find(function(candidate) {
                return candidate.playerId === voteTarget || candidate.name === voteTarget;
            });
            if (!targetPlayer) return;

            const voteSummary = targetMap.get(targetPlayer.playerId || targetPlayer.name);
            if (voteSummary) {
                voteSummary.count += 1;
                voteSummary.voters.push(player.name);
            }
            targetNames.push(targetPlayer.name);
        });

        voterChoices.push({
            voterId: player.playerId,
            voterName: player.name,
            voteValues: voteValues,
            targets: targetNames
        });
    });

    return {
        targets: voteTargets,
        voterChoices: voterChoices,
        pendingVoters: eligibleVoters
            .filter(function(player) {
                return player.vote2 === null || typeof player.vote2 === 'undefined';
            })
            .map(function(player) {
                return player.name;
            }),
        totalEligibleVoters: eligibleVoters.length,
        totalSubmittedVoters: voterChoices.length
    };
}

/**
 * Compare votes for sorting
 */
function compareVote(a, b) {
    if (a.nbVote2 < b.nbVote2) return 1;
    if (b.nbVote2 < a.nbVote2) return -1;
    return 0;
}

/**
 * Process vote1 result
 */
function processVote1Result(gameState) {
    const voteResult = {'up': 0, 'down': 0};
    gameState.players.forEach(function(player) {
        if(player.vote1 == '1') {
            voteResult.up += 1;
        } else if(!isGhostPlayer(player)) {
            voteResult.down += 1;
        }
    });
    gameState.resultVote1 = voteResult;
}

/**
 * Advance an Insider game from discussion into the traitor vote (vote2).
 * Shared by the admin "stop timer" action and the discussion timeout so the
 * game never stalls if the admin is gone. Reuses the live displayVote2 flow.
 */
function advanceInsiderToVote2(io, room) {
    if (!room || !room.gameState) return;
    const roomId = room.roomId;
    if (roomCountdowns.has(roomId)) {
        clearInterval(roomCountdowns.get(roomId));
        roomCountdowns.delete(roomId);
    }
    room.gameState.countdownEndsAt = null;
    resetVote(room.gameState, 2);
    const numTraitors = room.gameState.players.filter(p => p.role === traitorRole).length;
    io.to(roomId).emit('displayVote2', {
        players: buildInsiderVoteCandidates(room.gameState),
        numTraitors: numTraitors,
        progress: buildVote2Progress(room.gameState)
    });
    room.gameState.status = 'vote2';
}

/**
 * Process vote2 result - รองรับ 1 หรือ 2 จอมบงการ
 */
function processVote2Result(gameState) {
    gameState.players.forEach(function(player) {
        addPlayerVote2(gameState, player.vote2);
    });
    
    const votePlayers = gameState.players.filter(isNotGameMaster);
    votePlayers.sort(compareVote);

    // หาจอมบงการทั้งหมด (อาจมี 1 หรือ 2 คน)
    const allTraitors = gameState.players.filter(p => p.role === traitorRole);
    const numTraitors = allTraitors.length;
    let hasTraitorInGame = numTraitors > 0;

    let hasWon;
    let finalResultTraitorName = '';
    
    // หาผู้เล่นที่ได้โหวตสูงสุด (อาจมีหลายคนที่ได้โหวตเท่ากัน)
    const topVotedPlayer = votePlayers[0];
    const secondVotedPlayer = votePlayers[1];

    if (hasTraitorInGame) {
        if (numTraitors === 1) {
            // กรณีจอมบงการ 1 คน - logic เดิม
            if (topVotedPlayer && topVotedPlayer.role === traitorRole && (secondVotedPlayer ? topVotedPlayer.nbVote2 > secondVotedPlayer.nbVote2 : true)) {
                hasWon = true;
                finalResultTraitorName = topVotedPlayer.name;
            } else {
                hasWon = false;
                finalResultTraitorName = allTraitors[0].name;
            }
        } else {
            // กรณีจอมบงการ 2 คน - ต้องจับได้ทั้งคู่ถึงจะชนะ
            // หาว่าผู้เล่นที่ได้โหวตสูงสุด 2 อันดับแรกเป็นจอมบงการหรือไม่
            const top2Voted = votePlayers.slice(0, 2);
            const traitorsCaught = top2Voted.filter(p => p.role === traitorRole);
            
            // ต้องจับได้ทั้ง 2 คน และต้องมีโหวตมากกว่าคนอื่น
            const thirdVotedPlayer = votePlayers[2];
            const secondHasMoreVotesThanThird = !thirdVotedPlayer || (secondVotedPlayer && secondVotedPlayer.nbVote2 > thirdVotedPlayer.nbVote2);
            
            if (traitorsCaught.length === 2 && secondHasMoreVotesThanThird) {
                hasWon = true;
                finalResultTraitorName = traitorsCaught.map(t => t.name).join(' และ ');
            } else if (traitorsCaught.length === 1) {
                hasWon = false; // จับได้แค่คนเดียว
                const uncaughtTraitor = allTraitors.find(t => !traitorsCaught.includes(t));
                finalResultTraitorName = `จับได้ ${traitorsCaught[0].name} แต่พลาด ${uncaughtTraitor.name}`;
            } else {
                hasWon = false;
                finalResultTraitorName = allTraitors.map(t => t.name).join(' และ ');
            }
        }
    } else {
        if (topVotedPlayer && topVotedPlayer.isGhost && (secondVotedPlayer ? topVotedPlayer.nbVote2 > secondVotedPlayer.nbVote2 : true)) {
            hasWon = true;
            finalResultTraitorName = topVotedPlayer.name + ' (ไม่มีจอมบงการ)';
        } else if (!topVotedPlayer || (topVotedPlayer && !topVotedPlayer.isGhost && topVotedPlayer.nbVote2 === 0)) {
            hasWon = true;
            finalResultTraitorName = 'ไม่มีจอมบงการ';
        } else {
            hasWon = false;
            finalResultTraitorName = 'ไม่มีจอมบงการ (แต่ผู้เล่นโหวตพลาด)';
        }
    }

    gameState.resultVote2 = { 
        hasWon: hasWon, 
        voteDetail: votePlayers, 
        hasTraitor: hasTraitorInGame,
        numTraitors: numTraitors, // เพิ่มจำนวนจอมบงการ
        finalTraitorName: finalResultTraitorName,
        word: gameState.word || null, // เฉลยคำลับตอนจบ
        // เพิ่มบทบาททุกคนสำหรับเฉลยตอนจบ
        allRoles: gameState.players.map(p => ({ name: p.name, role: p.role }))
    };
}

/**
 * Check if socket is admin of room
 */
function isAdminSocket(room, socket) {
    if (!room || !socket.playerId) return false;
    return room.admin === socket.playerId;
}

function getSessionPlayerId(socket) {
    const playerId = socket?.request?.session?.playerId;
    return playerManager.isValidPlayerId(playerId) ? playerId : null;
}

function bindSocketPlayer(socket, requestedPlayerId = null) {
    const sessionPlayerId = getSessionPlayerId(socket);
    const requested = playerManager.isValidPlayerId(requestedPlayerId) ? requestedPlayerId : null;

    // Prefer session identity, but allow the client playerId when the socket
    // handshake has no session yet (common on mobile / after deploy).
    if (sessionPlayerId && requested && requested !== sessionPlayerId) {
        return null;
    }

    const playerId = sessionPlayerId || requested || (ALLOW_LEGACY_SOCKET_IDENTITY ? requested : null);
    if (!playerId) {
        return null;
    }
    if (socket.playerId && socket.playerId !== playerId) {
        return null;
    }

    socket.playerId = playerId;
    if (socket.request?.session && socket.request.session.playerId !== playerId) {
        socket.request.session.playerId = playerId;
        if (typeof socket.request.session.save === 'function') {
            socket.request.session.save(() => {});
        }
    }
    return playerId;
}

function getSocketRoom(socket, expectedMode = null) {
    const roomId = socket?.roomId;
    const playerId = socket?.playerId;
    if (!roomId || !playerId) return null;
    const room = roomManager.getRoom(roomId);
    if (!room || (expectedMode && room.settings.gameMode !== expectedMode)) return null;
    if (!room.players.some(player => player.playerId === playerId)) return null;
    return room;
}

function detachPlayerFromOtherRooms(socket, playerId, keepRoomId) {
    roomManager.getAllRooms().forEach(roomInfo => {
        if (roomInfo.roomId === keepRoomId) return;
        const oldRoom = roomManager.getRoom(roomInfo.roomId);
        if (!oldRoom || !oldRoom.players.some(player => player.playerId === playerId)) return;

        const updatedRoom = roomManager.leaveRoom(roomInfo.roomId, playerId);
        socket.leave(roomInfo.roomId);
        if (updatedRoom) {
            handleMidGamePlayerRemoval(updatedRoom, playerId);
            io.to(updatedRoom.roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));
            broadcastGameStateForRoom(updatedRoom);
        }
    });
}

function isSiteAdminPlayer(playerId) {
    return !!playerId && playerManager.isSiteAdmin(playerId);
}

function buildDisplayPlayerName(playerId, fallbackName = 'Unknown') {
    const resolvedName = resolveDisplayPlayerName(playerId, fallbackName);
    if (!playerId || !isSiteAdminPlayer(playerId)) {
        return resolvedName;
    }
    return `${resolvedName} [Admin]`;
}

/**
 * Check action cooldown for room
 */
function actionAllowedCooldown(gameState, seconds) {
    const now = Date.now();
    if (!gameState.lastAction || now - gameState.lastAction > (seconds * 1000)) {
        gameState.lastAction = now;
        return true;
    }
    return false;
}

/**
 * Mirror a chat message to every logged-in admin socket so the admin dashboard
 * can watch a room's conversation live.
 * @param {Object} io - Socket.io instance
 * @param {string} roomId - Room ID the message belongs to
 * @param {Object} payload - The chat payload emitted to players
 * @param {string} channel - 'public' or 'werewolf' (hidden night chat)
 */
function broadcastChatToAdmins(io, roomId, payload, channel = 'public') {
    if (!adminSockets.size) {
        return;
    }

    const room = roomManager.getRoom(roomId);
    const entry = {
        ...payload,
        roomId,
        roomName: room ? room.name : roomId,
        gameMode: room?.settings?.gameMode || null,
        channel
    };

    adminSockets.forEach(socketId => {
        io.to(socketId).emit('adminRoomChat', entry);
    });
}

/**
 * Send chat message to room
 */
function sendChatMessageToRoom(io, roomId, playerName, message, color, replyTo = null, playerId = null, avatar = '👤', avatarFrame = 'none') {
    const messageId = `msg-${nextMessageId++}`;
    let messageType = 'player';
    const displayName = playerName === 'System' ? playerName : buildDisplayPlayerName(playerId, playerName);
    const isSiteAdmin = playerName !== 'System' && isSiteAdminPlayer(playerId);

    if (playerName === 'System') {
        if (/เข้าห้อง|ออกจากห้อง|หลุดการเชื่อมต่อ/i.test(message)) {
            messageType = 'presence';
        } else if (/Admin|สิทธิ์/i.test(message)) {
            messageType = 'admin';
        } else if (/คืนที่|กลางวัน|หมดคืน|หมดเวลา|โหวต|เกม Werewolf เริ่มแล้ว|เริ่มรอบใหม่|เกมจบ/i.test(message)) {
            messageType = 'phase';
        } else {
            messageType = 'system';
        }
    }

    const payload = {
        messageId: messageId,
        message: message,
        playerName: playerName,
        displayName: displayName,
        color: color,
        playerId: playerId,
        avatar: avatar,
        avatarFrame: avatarFrame || 'none',
        isSiteAdmin: isSiteAdmin,
        messageType: messageType,
        timestamp: new Date().toLocaleTimeString('th-TH', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Bangkok'
        }),
        replyTo: replyTo
    };

    const room = roomManager.getRoom(roomId);
    if (room) {
        if (!Array.isArray(room.chatHistory)) {
            room.chatHistory = [];
        }
        room.chatHistory.push(payload);
        room.chatHistory = room.chatHistory.slice(-100);
    }

    io.to(roomId).emit('newMessage', payload);
    broadcastChatToAdmins(io, roomId, payload, 'public');
}

/**
 * Send game log to room (no longer broadcasts to room, only stores for admin)
 * @param {Object} io - Socket.io instance
 * @param {string} roomId - Room ID
 * @param {string} message - Log message
 * @param {string} type - Log type: 'info', 'success', 'warning', 'error', 'vote', 'role', 'system'
 * @param {string} icon - Optional emoji icon
 * @param {string} haptic - Optional haptic feedback type
 */
function sendGameLog(io, roomId, message, type = 'info', icon = null, haptic = null) {
    const room = roomId ? roomManager.getRoom(roomId) : null;
    addServerLog(io, 'game', roomId, message, type, {
        gameMode: room?.settings?.gameMode || null
    });
}

const GAME_MODE_LOG_STYLES = {
    insider: { label: 'Insider', emoji: '🎯', badgeBg: 'rgba(52,152,219,0.18)', badgeColor: '#d6ebff' },
    werewolf: { label: 'Werewolf', emoji: '🐺', badgeBg: 'rgba(192,57,43,0.2)', badgeColor: '#ffd5d0' },
    blackmarket: { label: 'Black Market', emoji: '🎩', badgeBg: 'rgba(246,211,101,0.18)', badgeColor: '#fde68a' },
    spyfall: { label: 'Spyfall', emoji: '🕵️', badgeBg: 'rgba(26,188,156,0.18)', badgeColor: '#7bedd6' }
};

function getGameModeLogStyle(gameMode) {
    const engine = getGameEngine(gameMode);
    const modeId = engine?.id || gameMode || 'insider';
    return GAME_MODE_LOG_STYLES[modeId] || {
        label: engine?.label || modeId,
        emoji: '🎮',
        badgeBg: 'rgba(255,255,255,0.1)',
        badgeColor: '#fff'
    };
}

function buildGameEndNotification(room) {
    if (!room?.gameState) {
        return null;
    }

    const mode = room.settings.gameMode;
    const gameState = room.gameState;
    const playerCount = Array.isArray(gameState.players)
        ? gameState.players.length
        : (room.players?.length || 0);

    if (mode === 'werewolf') {
        const winner = gameState.winner;
        const winnerLabel = winner === 'werewolf'
            ? 'หมาป่า'
            : (winner === 'village' ? 'ชาวบ้าน' : (winner === 'fool' ? 'คนบ้า' : String(winner || 'ไม่ทราบ')));
        return {
            chatMessage: `เกมจบ! ${winnerLabel} ชนะ (วันที่ ${gameState.dayNumber || 0})`,
            chatColor: winner === 'werewolf' ? '#e74c3c' : '#2ecc71',
            logMessage: `🐺 Werewolf จบ — ${winnerLabel} ชนะ · วัน ${gameState.dayNumber || 0} · ${playerCount} คน`,
            logType: winner === 'werewolf' ? 'error' : 'success',
            meta: { winner: winnerLabel, dayNumber: gameState.dayNumber || 0, playerCount }
        };
    }

    if (mode === 'blackmarket') {
        const winner = gameState.winner || {};
        const winnerName = winner.name || 'ไม่ทราบ';
        const winnerRole = winner.roleTitle || winner.roleId || '-';
        const reason = winner.reason || gameState.winner?.reason || '';
        return {
            chatMessage: `เกมจบ! ${winnerName} คุมโต๊ะ (${winnerRole})`,
            chatColor: '#f39c12',
            logMessage: `🎩 Black Market จบ — ${winnerName} ชนะ [${winnerRole}]${reason ? ` · ${reason}` : ''} · ${playerCount} คน`,
            logType: 'success',
            meta: { winnerName, winnerRole, reason, playerCount, roundNumber: gameState.roundNumber || 0 }
        };
    }

    if (mode === 'spyfall') {
        const winner = gameState.winner || {};
        const resultMsg = winner.team === 'citizens' ? 'พลเมืองจับสายลับได้!' : 'สายลับหลบรอด!';
        return {
            chatMessage: `เกมจบ! ${resultMsg} สถานที่: ${winner.locationName || gameState.locationName || '-'}`,
            chatColor: '#1abc9c',
            logMessage: `🕵️ Spyfall จบ — ${resultMsg} · ${winner.locationName || gameState.locationName || '-'} · ${playerCount} คน`,
            logType: winner.team === 'citizens' ? 'success' : 'warning',
            meta: {
                team: winner.team,
                location: winner.locationName || gameState.locationName,
                spyName: winner.spyName,
                playerCount
            }
        };
    }

    if (mode === 'insider' && gameState.resultVote2) {
        const result = gameState.resultVote2;
        const traitorName = result.finalTraitorName || 'ไม่ทราบ';
        const citizensWon = !!result.hasWon;
        return {
            chatMessage: `เกมจบ! ${citizensWon ? 'พลเมืองชนะ!' : 'จอมบงการชนะ!'}`,
            chatColor: '#9b59b6',
            logMessage: citizensWon
                ? `🎯 Insider จบ — พลเมืองชนะ! (จอมบงการ: ${traitorName}) · ${playerCount} คน`
                : `🎯 Insider จบ — จอมบงการชนะ! (จอมบงการ: ${traitorName}) · ${playerCount} คน`,
            logType: citizensWon ? 'success' : 'error',
            meta: { citizensWon, traitor: traitorName, playerCount, word: gameState.word || null }
        };
    }

    return null;
}

function notifyGameEndAfterRecord(room) {
    const notification = buildGameEndNotification(room);
    if (!notification) {
        return;
    }

    sendChatMessageToRoom(io, room.roomId, 'System', notification.chatMessage, notification.chatColor);
    addServerLog(io, 'game', room.roomId, notification.logMessage, notification.logType, {
        gameMode: room.settings.gameMode,
        meta: notification.meta
    });
}

function logGameStartFromRoom(room, extra = '') {
    if (!room?.roomId) {
        return;
    }

    const style = getGameModeLogStyle(room.settings.gameMode);
    const playerCount = room.players.filter(player => player.socketId).length;
    addServerLog(
        io,
        'game',
        room.roomId,
        `${style.emoji} ${style.label} เริ่มเกม (${playerCount} คน)${extra}`,
        'success',
        { gameMode: room.settings.gameMode, meta: { playerCount, event: 'game_start' } }
    );
}

/**
 * Add a server activity log
 * @param {Object} io - Socket.io instance  
 * @param {string} category - Log category: 'join', 'leave', 'game', 'admin', 'error', 'chat', 'system'
 * @param {string} roomId - Room ID (optional)
 * @param {string} message - Log message
 * @param {string} type - Log type: 'info', 'success', 'warning', 'error'
 * @param {Object} [options] - Optional: { gameMode, meta }
 */
function addServerLog(io, category, roomId, message, type = 'info', options = {}) {
    const room = roomId ? roomManager.getRoom(roomId) : null;
    const roomName = room ? room.name : roomId || 'ระบบ';
    const gameMode = options.gameMode || room?.settings?.gameMode || null;
    const modeStyle = gameMode ? getGameModeLogStyle(gameMode) : null;
    
    const logEntry = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        category: category,
        roomId: roomId || null,
        roomName: roomName,
        gameMode,
        gameModeLabel: modeStyle ? `${modeStyle.emoji} ${modeStyle.label}` : null,
        message: message,
        type: type,
        meta: options.meta && typeof options.meta === 'object' ? options.meta : null
    };
    
    // Add to beginning of array (newest first)
    serverLogs.unshift(logEntry);
    
    // Keep only MAX_SERVER_LOGS
    if (serverLogs.length > MAX_SERVER_LOGS) {
        serverLogs.length = MAX_SERVER_LOGS;
    }
    
    // Broadcast to all admin sockets
    adminSockets.forEach(socketId => {
        io.to(socketId).emit('adminLog', logEntry);
    });
}

function buildRoomUpdatePayload(room) {
    const gameEngine = getGameEngine(room.settings.gameMode);
    const gameStatus = roomManager.getRoomGameStatusLabel(room);

    return {
        roomId: room.roomId,
        roomName: room.name,
        players: room.players.map(player => ({
            playerId: player.playerId,
            playerName: player.playerName,
            displayName: buildDisplayPlayerName(player.playerId, player.playerName),
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
            isSiteAdmin: isSiteAdminPlayer(player.playerId),
            permission: player.permission,
            online: !!player.socketId
        })),
        playerCount: roomManager.getOnlinePlayerCount(room),
        onlineCount: roomManager.getOnlinePlayerCount(room),
        totalPlayerCount: room.players.length,
        admin: room.admin,
        locked: room.settings.locked,
        gameMode: room.settings.gameMode,
        gameModeLabel: gameEngine.label,
        gameStatus,
        settings: room.settings
    };
}

function buildWerewolfStatePayload(room, playerId) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return null;
    }

    finalizeWerewolfGameIfNeeded(room);
    const engine = getGameEngine('werewolf');
    return engine.buildClientState(room, playerId);
}

function buildBlackMarketStatePayload(room, playerId) {
    if (!room || room.settings.gameMode !== 'blackmarket') {
        return null;
    }

    finalizeBlackMarketGameIfNeeded(room);
    const engine = getGameEngine('blackmarket');
    return engine.buildClientState(room, playerId);
}

function buildSpyfallStatePayload(room, playerId) {
    if (!room || room.settings.gameMode !== 'spyfall') {
        return null;
    }

    finalizeSpyfallGameIfNeeded(room);
    const engine = getGameEngine('spyfall');
    return engine.buildClientState(room, playerId);
}

function buildWerewolfAdminRevealPayload(room) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return null;
    }

    const engine = getGameEngine('werewolf');
    const roleDefinitions = engine.ROLE_DEFINITIONS || {};
    const players = Array.isArray(room.gameState?.players)
        ? room.gameState.players.map(player => {
            const roleInfo = player.roleInfo || roleDefinitions[player.role] || null;
            return {
                playerId: player.playerId,
                name: buildDisplayPlayerName(player.playerId, player.name || player.playerName || resolveDisplayPlayerName(player.playerId, 'Unknown')),
                roleId: player.role || '',
                roleName: roleInfo?.thaiName || player.role || '-',
                team: roleInfo?.team || '-',
                alive: player.alive !== false
            };
        })
        : [];

    return {
        roomId: room.roomId,
        roomName: room.name,
        phase: room.gameState?.phase || 'lobby',
        dayNumber: Number(room.gameState?.dayNumber || 0),
        players
    };
}

function isWerewolfNightChatEligible(room, playerId) {
    if (!room || room.settings.gameMode !== 'werewolf' || room.gameState?.phase !== 'night' || !playerId) {
        return false;
    }

    const gamePlayer = room.gameState.players.find(player => player.playerId === playerId);
    return !!gamePlayer && gamePlayer.alive !== false && ['werewolf', 'alphaWolf'].includes(gamePlayer.role);
}

function isWerewolfTeamMember(room, playerId) {
    if (!room || room.settings.gameMode !== 'werewolf' || !playerId) {
        return false;
    }
    const gamePlayer = room.gameState?.players?.find(player => player.playerId === playerId);
    return !!gamePlayer && ['werewolf', 'alphaWolf'].includes(gamePlayer.role);
}

function buildWerewolfChatHistory(room, playerId) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return room?.chatHistory || [];
    }

    const publicHistory = Array.isArray(room.chatHistory) ? room.chatHistory : [];
    // ประวัติแชทหมาป่า: ให้สมาชิกทีมหมาป่าเห็นได้ทุกเฟส (ไม่ผูกกับ night) — กัน reconnect กลางวันแล้วแชทหาย
    const wolfHistory = isWerewolfTeamMember(room, playerId) && Array.isArray(room.werewolfChatHistory)
        ? room.werewolfChatHistory
        : [];

    return [...publicHistory, ...wolfHistory].sort((left, right) => {
        const leftOrder = Number(String(left?.messageId || '').replace(/[^0-9]/g, '')) || 0;
        const rightOrder = Number(String(right?.messageId || '').replace(/[^0-9]/g, '')) || 0;
        return leftOrder - rightOrder;
    });
}

/**
 * Full room transcript for the admin dashboard: public chat plus the hidden
 * werewolf night chat, merged in send order and tagged by channel.
 */
function buildAdminChatHistory(room) {
    if (!room) {
        return [];
    }

    const publicHistory = (Array.isArray(room.chatHistory) ? room.chatHistory : [])
        .map(entry => ({ ...entry, channel: 'public' }));
    const wolfHistory = (Array.isArray(room.werewolfChatHistory) ? room.werewolfChatHistory : [])
        .map(entry => ({ ...entry, channel: 'werewolf' }));

    return [...publicHistory, ...wolfHistory].sort((left, right) => {
        const leftOrder = Number(String(left?.messageId || '').replace(/[^0-9]/g, '')) || 0;
        const rightOrder = Number(String(right?.messageId || '').replace(/[^0-9]/g, '')) || 0;
        return leftOrder - rightOrder;
    });
}

function emitWerewolfChatHistory(room, targetSocketId, playerId) {
    if (!room || room.settings.gameMode !== 'werewolf' || !targetSocketId) {
        return;
    }

    io.to(targetSocketId).emit('werewolfChatSync', buildWerewolfChatHistory(room, playerId));
}

function sendWerewolfNightTeamMessage(io, room, player, message, replyTo = null) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return;
    }

    const messageId = `msg-${nextMessageId++}`;
    const displayName = buildDisplayPlayerName(player.playerId, player.playerName);
    const payload = {
        messageId,
        message,
        playerName: player.playerName,
        displayName,
        color: player.color,
        playerId: player.playerId,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        isSiteAdmin: isSiteAdminPlayer(player.playerId),
        messageType: 'wolf-team',
        timestamp: new Date().toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Bangkok'
        }),
        replyTo
    };

    if (!Array.isArray(room.werewolfChatHistory)) {
        room.werewolfChatHistory = [];
    }
    room.werewolfChatHistory.push(payload);
    room.werewolfChatHistory = room.werewolfChatHistory.slice(-100);

    room.players.forEach(roomPlayer => {
        if (roomPlayer.socketId && isWerewolfNightChatEligible(room, roomPlayer.playerId)) {
            io.to(roomPlayer.socketId).emit('newMessage', payload);
        }
    });

    broadcastChatToAdmins(io, room.roomId, payload, 'werewolf');
}

function finalizeWerewolfGameIfNeeded(room) {
    if (!room || room.settings.gameMode !== 'werewolf' || !room.gameState) {
        return;
    }

    if (room.gameState.status !== 'werewolf_finished' || !room.gameState.winner || room.gameState.statsRecordedAt) {
        return;
    }

    statsManager.recordGameEnd(room.roomId, {
        mode: 'werewolf',
        winner: room.gameState.winner,
        players: room.gameState.players,
        roomName: room.name,
        dayNumber: room.gameState.dayNumber
    });
    room.gameState.statsRecordedAt = new Date().toISOString();
    notifyGameEndAfterRecord(room);
}

function finalizeBlackMarketGameIfNeeded(room) {
    if (!room || room.settings.gameMode !== 'blackmarket' || !room.gameState) {
        return;
    }

    if (room.gameState.status !== 'blackmarket_finished' || !room.gameState.winner || room.gameState.statsRecordedAt) {
        return;
    }

    statsManager.recordGameEnd(room.roomId, {
        mode: 'blackmarket',
        winner: room.gameState.winner,
        players: room.gameState.players,
        roomName: room.name,
        roundNumber: room.gameState.roundNumber,
        maxRounds: room.gameState.maxRounds,
        reason: room.gameState.winner.reason
    });
    room.gameState.statsRecordedAt = new Date().toISOString();
    notifyGameEndAfterRecord(room);
}

function finalizeSpyfallGameIfNeeded(room) {
    if (!room || room.settings.gameMode !== 'spyfall' || !room.gameState) {
        return;
    }

    if (room.gameState.status !== 'spyfall_finished' || !room.gameState.winner || room.gameState.statsRecordedAt) {
        return;
    }

    statsManager.recordGameEnd(room.roomId, {
        mode: 'spyfall',
        winner: room.gameState.winner,
        players: room.gameState.players,
        roomName: room.name,
        locationName: room.gameState.locationName
    });
    room.gameState.statsRecordedAt = new Date().toISOString();
    notifyGameEndAfterRecord(room);
}

function emitWerewolfState(room, targetSocketId = null, playerId = null) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return;
    }

    if (targetSocketId && playerId) {
        io.to(targetSocketId).emit('werewolfState', buildWerewolfStatePayload(room, playerId));
        emitWerewolfChatHistory(room, targetSocketId, playerId);
        return;
    }

    room.players.forEach(player => {
        if (player.socketId) {
            io.to(player.socketId).emit('werewolfState', buildWerewolfStatePayload(room, player.playerId));
            emitWerewolfChatHistory(room, player.socketId, player.playerId);
        }
    });
}

function clearWerewolfTransitionTimer(roomId) {
    const timer = werewolfTransitionTimeouts.get(roomId);
    if (!timer) {
        return;
    }

    clearTimeout(timer.timeoutId);
    werewolfTransitionTimeouts.delete(roomId);
}

function emitWerewolfRoomState(room) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return;
    }

    console.debug('[werewolf][emit] room state broadcast', {
        roomId: room.roomId,
        phase: room.gameState?.phase,
        dayNumber: room.gameState?.dayNumber,
        winner: room.gameState?.winner,
        phaseEndsAt: room.gameState?.phaseEndsAt,
        players: Array.isArray(room.gameState?.players) ? room.gameState.players.length : 0
    });

    clearWerewolfTransitionTimer(room.roomId);
    syncWerewolfPhaseTimer(room);
    emitWerewolfState(room);
    io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
}

function clearBlackMarketPhaseTimer(roomId, resetPhaseEndsAt = true) {
    const timer = blackMarketPhaseTimeouts.get(roomId);
    if (timer) {
        clearTimeout(timer.timeoutId);
        blackMarketPhaseTimeouts.delete(roomId);
    }

    if (!resetPhaseEndsAt) {
        return;
    }

    const room = roomManager.getRoom(roomId);
    if (room?.gameState) {
        room.gameState.phaseEndsAt = null;
    }
}

function syncBlackMarketPhaseTimer(room) {
    if (!room || room.settings.gameMode !== 'blackmarket') {
        return;
    }

    const phase = room.gameState.phase;
    const activePhase = phase === 'market' || phase === 'action';
    if (!activePhase || room.gameState.winner) {
        clearBlackMarketPhaseTimer(room.roomId);
        return;
    }

    const blackMarketEngine = getGameEngine('blackmarket');
    const now = Date.now();
    const existingTimer = blackMarketPhaseTimeouts.get(room.roomId);
    if (existingTimer && existingTimer.phase === phase && room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > now) {
        return;
    }

    if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= now) {
        clearBlackMarketPhaseTimer(room.roomId, false);
        try {
            const resolution = blackMarketEngine.autoResolvePhase(room);
            if (resolution && resolution.resolved === false) {
                console.warn('[blackmarket][timer] auto resolve incomplete', {
                    roomId: room.roomId,
                    phase,
                    resolution
                });
            }
            emitBlackMarketState(room);
            syncBlackMarketPhaseTimer(roomManager.getRoom(room.roomId) || room);
        } catch (error) {
            console.error('[blackmarket] overdue auto resolve failed:', {
                roomId: room.roomId,
                phase,
                error: error?.message || error
            });
        }
        return;
    }

    clearBlackMarketPhaseTimer(room.roomId, false);

    const defaultDurationMs = phase === 'market'
        ? blackMarketEngine.getMarketPhaseMs(room)
        : blackMarketEngine.getActionPhaseMs(room);
    const targetEndsAt = room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > now
        ? room.gameState.phaseEndsAt
        : now + defaultDurationMs;
    const delayMs = Math.max(0, targetEndsAt - now);
    room.gameState.phaseEndsAt = targetEndsAt;

    const timeoutId = setTimeout(() => {
        blackMarketPhaseTimeouts.delete(room.roomId);

        const currentRoom = roomManager.getRoom(room.roomId);
        if (!currentRoom || currentRoom.settings.gameMode !== 'blackmarket') {
            return;
        }

        if (currentRoom.gameState.phase !== phase || currentRoom.gameState.winner) {
            return;
        }

        try {
            const resolution = blackMarketEngine.autoResolvePhase(currentRoom);
            if (resolution && resolution.resolved === false) {
                console.warn('[blackmarket][timer] auto resolve incomplete', {
                    roomId: currentRoom.roomId,
                    phase,
                    resolution
                });
            }
            sendChatMessageToRoom(
                io,
                currentRoom.roomId,
                'System',
                phase === 'market'
                    ? 'หมดเวลาตลาดแล้ว ระบบพาเข้าช่วงลงมือ'
                    : 'หมดเวลาลงมือแล้ว ระบบสรุปผลยกนี้',
                '#95a5a6'
            );
            emitBlackMarketState(currentRoom);
            syncBlackMarketPhaseTimer(roomManager.getRoom(currentRoom.roomId) || currentRoom);
        } catch (error) {
            console.error('[blackmarket] auto resolve failed:', {
                roomId: room.roomId,
                phase,
                error: error?.message || error
            });
        }
    }, delayMs);

    blackMarketPhaseTimeouts.set(room.roomId, { phase, timeoutId });
}

// onlyOverdue: หยุดทันทีที่ deadline ของ phase ใหม่ยังไม่ถึง — ใช้ตอนกู้หลัง restart
function forceResolveStuckBlackMarketRoom(room, { onlyOverdue = false } = {}) {
    if (!room || room.settings.gameMode !== 'blackmarket' || !roomManager.isRoomGameInProgress(room)) {
        return;
    }

    const blackMarketEngine = getGameEngine('blackmarket');
    const activePhases = new Set(['market', 'action']);
    let safety = 0;

    while (safety < 12 && roomManager.isRoomGameInProgress(room) && activePhases.has(room.gameState.phase)
        && (!onlyOverdue || (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()))) {
        try {
            const resolution = blackMarketEngine.autoResolvePhase(room);
            if (resolution && resolution.resolved === false) {
                console.warn('[blackmarket] force resolve incomplete', {
                    roomId: room.roomId,
                    phase: room.gameState.phase,
                    resolution
                });
                break;
            }
        } catch (error) {
            console.error('[blackmarket] force resolve failed:', {
                roomId: room.roomId,
                phase: room.gameState.phase,
                error: error?.message || error
            });
            break;
        }
        safety += 1;
    }
}

function emitBlackMarketState(room, targetSocketId = null, playerId = null) {
    if (!room || room.settings.gameMode !== 'blackmarket') {
        return;
    }

    syncBlackMarketPhaseTimer(room);

    if (targetSocketId && playerId) {
        io.to(targetSocketId).emit('blackmarketState', buildBlackMarketStatePayload(room, playerId));
        return;
    }

    room.players.forEach(player => {
        if (player.socketId) {
            io.to(player.socketId).emit('blackmarketState', buildBlackMarketStatePayload(room, player.playerId));
        }
    });
}

async function runBotsForRoom(room) {
    if (!room || room.settings.gameMode !== 'blackmarket') return;
    if (room.gameState.phase === 'finished') return;

    // Find all bots in the room
    const bots = room.gameState.players.filter(player => player.playerId.startsWith('bot_') && player.alive !== false);
    if (bots.length === 0) return;

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const blackMarketEngine = getGameEngine('blackmarket');

    // Run bots turns
    if (room.gameState.phase === 'market') {
        let hasResolved = false;
        for (const bot of bots) {
            // Check if already made a choice
            if (room.gameState.marketChoices[bot.playerId]) continue;

            // Wait a small randomized delay
            await delay(300 + Math.random() * 400);

            // Fetch current client state to check affordability
            const clientState = blackMarketEngine.buildClientState(room, bot.playerId);
            if (!clientState) continue;
            
            const affordableOffers = (clientState.marketOffers || []).filter(item => item.affordable);

            let chosenItemId = blackMarketEngine.PASS_CHOICE;
            if (affordableOffers.length > 0 && Math.random() > 0.15) {
                // Pick a random affordable item, with preference for cargo items
                const cargoOffers = affordableOffers.filter(item => item.type === 'cargo');
                if (cargoOffers.length > 0 && Math.random() > 0.4) {
                    chosenItemId = cargoOffers[Math.floor(Math.random() * cargoOffers.length)].id;
                } else {
                    chosenItemId = affordableOffers[Math.floor(Math.random() * affordableOffers.length)].id;
                }
            }

            try {
                const result = blackMarketEngine.submitMarketPurchase(room, bot.playerId, chosenItemId);
                const roundNum = room.gameState?.roundNumber || 1;
                addServerLog(io, 'game', room.roomId, `[🤖 บอท] ${bot.name} ซื้อของ: ${chosenItemId === '__pass__' ? 'ผ่าน (ไม่ซื้อ)' : chosenItemId} (ยกที่ ${roundNum})`, 'info', {
                    gameMode: 'blackmarket',
                    meta: { playerId: bot.playerId, itemId: chosenItemId, roundNumber: roundNum, isBot: true }
                });

                if (result.resolved) {
                    hasResolved = true;
                    addServerLog(io, 'game', room.roomId, `[BlackMarket] ตลาดปิดแล้ว! เริ่มช่วงลงมือ (ยกที่ ${roundNum})`, 'success', {
                        gameMode: 'blackmarket',
                        meta: { roundNumber: roundNum }
                    });
                    emitBlackMarketState(room);
                    // If the phase resolved, run bots for the next phase after a short delay
                    setTimeout(() => {
                        const r = roomManager.getRoom(room.roomId);
                        if (r) runBotsForRoom(r).catch(console.error);
                    }, 1000);
                    break;
                }
            } catch (err) {
                console.error(`Bot ${bot.name} failed market purchase:`, err.message);
            }
        }
        
        if (!hasResolved) {
            emitBlackMarketState(room);
        }
    } else if (room.gameState.phase === 'action') {
        let hasResolved = false;
        for (const bot of bots) {
            // Check if already made a choice
            if (room.gameState.actionChoices[bot.playerId]) continue;

            // Wait a small randomized delay
            await delay(300 + Math.random() * 400);

            const clientState = blackMarketEngine.buildClientState(room, bot.playerId);
            if (!clientState) continue;

            const targets = (clientState.players || []).filter(player => player.alive && player.playerId !== bot.playerId);
            const cargoItems = clientState.actionHelp?.cargoItems || [];

            let actionType = 'pass';
            let targetPlayerId = null;
            let itemId = null;

            if (cargoItems.length > 0) {
                // If has cargo, 75% chance to deliver
                if (Math.random() > 0.25) {
                    actionType = 'deliver';
                    itemId = cargoItems[0].id;
                }
            }

            if (actionType === 'pass' && clientState.actionHelp?.canHit && targets.length > 0) {
                // If has gun and cash, 60% chance to hit a target
                if (Math.random() > 0.4) {
                    actionType = 'hit';
                    targetPlayerId = targets[Math.floor(Math.random() * targets.length)].playerId;
                }
            }

            if (actionType === 'pass' && targets.length > 0) {
                // Choose between deal, betray, raid, intel, laylow, guard
                const rand = Math.random();
                const target = targets[Math.floor(Math.random() * targets.length)].playerId;
                if (rand < 0.35) {
                    actionType = 'deal';
                    targetPlayerId = target;
                } else if (rand < 0.55) {
                    actionType = 'betray';
                    targetPlayerId = target;
                } else if (rand < 0.75) {
                    actionType = 'raid';
                    targetPlayerId = target;
                } else if (rand < 0.85) {
                    actionType = 'intel';
                    targetPlayerId = target;
                } else if (rand < 0.92) {
                    actionType = 'laylow';
                } else {
                    actionType = 'guard';
                }
            }

            try {
                const result = blackMarketEngine.submitAction(room, bot.playerId, actionType, targetPlayerId, itemId);
                const roundNum = room.gameState?.roundNumber || 1;
                const targetPlayer = targetPlayerId ? (room.players.find(p => p.id === targetPlayerId)?.name || targetPlayerId) : null;
                const targetText = targetPlayer ? ` เล็งเป้า: ${targetPlayer}` : '';
                const itemText = itemId ? ` ของ: ${itemId}` : '';
                addServerLog(io, 'game', room.roomId, `[🤖 บอท] ${bot.name} ล็อกแผน: ${actionType}${targetText}${itemText} (ยกที่ ${roundNum})`, 'info', {
                    gameMode: 'blackmarket',
                    meta: { playerId: bot.playerId, actionType, targetPlayerId, itemId, roundNumber: roundNum, isBot: true }
                });

                if (result.resolved) {
                    hasResolved = true;
                    addServerLog(io, 'game', room.roomId, `[BlackMarket] ล็อกแผนครบทุกคน! สรุปผลยกที่ ${roundNum}`, 'success', {
                        gameMode: 'blackmarket',
                        meta: { roundNumber: roundNum }
                    });
                    if (room.gameState.lastRoundReport && room.gameState.lastRoundReport.length) {
                        room.gameState.lastRoundReport.forEach(reportItem => {
                            addServerLog(io, 'game', room.roomId, `[BlackMarket] สรุปยก ${roundNum}: ${reportItem.text}`, 'info', {
                                gameMode: 'blackmarket',
                                meta: { roundNumber: roundNum, icon: reportItem.icon }
                            });
                        });
                    }
                    emitBlackMarketState(room);
                    // If the phase resolved, run bots for the next phase
                    setTimeout(() => {
                        const r = roomManager.getRoom(room.roomId);
                        if (r) runBotsForRoom(r).catch(console.error);
                    }, 1000);
                    break;
                }
            } catch (err) {
                console.error(`Bot ${bot.name} failed action submission:`, err.message);
            }
        }
        
        if (!hasResolved) {
            emitBlackMarketState(room);
        }
    }
}

function clearSpyfallPhaseTimer(roomId, resetPhaseEndsAt = true) {
    const timer = spyfallPhaseTimeouts.get(roomId);
    if (timer) {
        clearTimeout(timer.timeoutId);
        spyfallPhaseTimeouts.delete(roomId);
    }

    if (!resetPhaseEndsAt) {
        return;
    }

    const room = roomManager.getRoom(roomId);
    if (room?.gameState) {
        room.gameState.phaseEndsAt = null;
    }
}

function clearSpyfallReturnTimer(roomId) {
    const timers = spyfallReturnTimeouts.get(roomId);
    if (!timers) {
        return;
    }

    if (timers.returnTimeoutId) {
        clearTimeout(timers.returnTimeoutId);
    }
    if (timers.redirectTimeoutId) {
        clearTimeout(timers.redirectTimeoutId);
    }
    spyfallReturnTimeouts.delete(roomId);
}

function scheduleSpyfallReturnToLobby(room) {
    if (!room || spyfallReturnTimeouts.has(room.roomId)) {
        return;
    }

    const roomId = room.roomId;
    const returnTimeoutId = setTimeout(() => {
        io.to(roomId).emit('returnToLobby', { countdown: 5, roomId });

        const redirectTimeoutId = setTimeout(() => {
            roomManager.resetRoomGame(roomId);
            const refreshedRoom = roomManager.getRoom(roomId);
            if (refreshedRoom) {
                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom));
            }
            io.to(roomId).emit('redirectToLobby', { roomId });
            spyfallReturnTimeouts.delete(roomId);
        }, 5000);

        const entry = spyfallReturnTimeouts.get(roomId) || {};
        entry.redirectTimeoutId = redirectTimeoutId;
        spyfallReturnTimeouts.set(roomId, entry);
    }, 3000);

    spyfallReturnTimeouts.set(roomId, { returnTimeoutId });
}

function handleSpyfallGameEnd(room) {
    if (!room || room.settings.gameMode !== 'spyfall') {
        return;
    }

    finalizeSpyfallGameIfNeeded(room);
    scheduleSpyfallReturnToLobby(room);
}

function syncSpyfallPhaseTimer(room) {
    if (!room || room.settings.gameMode !== 'spyfall') {
        return;
    }

    const phase = room.gameState.phase;
    const activePhase = phase === 'reveal' || phase === 'discussion' || phase === 'vote';
    if (!activePhase || room.gameState.winner) {
        clearSpyfallPhaseTimer(room.roomId);
        if (room.gameState.phase === 'finished') {
            handleSpyfallGameEnd(room);
        }
        return;
    }

    const spyfallEngine = getGameEngine('spyfall');
    const now = Date.now();
    const existingTimer = spyfallPhaseTimeouts.get(room.roomId);
    if (existingTimer && existingTimer.phase === phase && room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > now) {
        return;
    }

    if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= now) {
        clearSpyfallPhaseTimer(room.roomId, false);
        try {
            const resolution = spyfallEngine.autoResolvePhase(room);
            if (resolution?.phase === 'finished' || room.gameState.phase === 'finished') {
                emitSpyfallRoomState(roomManager.getRoom(room.roomId) || room);
                return;
            }
            emitSpyfallState(roomManager.getRoom(room.roomId) || room);
            syncSpyfallPhaseTimer(roomManager.getRoom(room.roomId) || room);
        } catch (error) {
            console.error('[spyfall] overdue auto resolve failed:', {
                roomId: room.roomId,
                phase,
                error: error?.message || error
            });
        }
        return;
    }

    clearSpyfallPhaseTimer(room.roomId, false);

    const defaultDurationMs = phase === 'reveal'
        ? spyfallEngine.REVEAL_PHASE_MS
        : (phase === 'discussion' ? spyfallEngine.getDiscussionMs(room) : spyfallEngine.getVoteMs(room));
    const targetEndsAt = room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > now
        ? room.gameState.phaseEndsAt
        : now + defaultDurationMs;
    const delayMs = Math.max(0, targetEndsAt - now);
    room.gameState.phaseEndsAt = targetEndsAt;

    const timeoutId = setTimeout(() => {
        spyfallPhaseTimeouts.delete(room.roomId);

        const currentRoom = roomManager.getRoom(room.roomId);
        if (!currentRoom || currentRoom.settings.gameMode !== 'spyfall') {
            return;
        }

        if (currentRoom.gameState.phase !== phase || currentRoom.gameState.winner) {
            return;
        }

        try {
            const resolution = spyfallEngine.autoResolvePhase(currentRoom);
            if (phase === 'discussion') {
                sendChatMessageToRoom(io, currentRoom.roomId, 'System', 'หมดเวลาคุยแล้ว — เริ่มโหวตจับสายลับ', '#95a5a6');
            } else if (phase === 'vote') {
                sendChatMessageToRoom(io, currentRoom.roomId, 'System', 'หมดเวลาโหวต — ระบบสรุปผล', '#95a5a6');
            }

            if (resolution?.phase === 'finished' || currentRoom.gameState.phase === 'finished') {
                emitSpyfallRoomState(roomManager.getRoom(currentRoom.roomId) || currentRoom);
                return;
            }

            emitSpyfallState(roomManager.getRoom(currentRoom.roomId) || currentRoom);
            syncSpyfallPhaseTimer(roomManager.getRoom(currentRoom.roomId) || currentRoom);
        } catch (error) {
            console.error('[spyfall] auto resolve failed:', {
                roomId: room.roomId,
                phase,
                error: error?.message || error
            });
        }
    }, delayMs);

    spyfallPhaseTimeouts.set(room.roomId, { phase, timeoutId });
}

function emitSpyfallState(room, targetSocketId = null, playerId = null) {
    if (!room || room.settings.gameMode !== 'spyfall') {
        return;
    }

    syncSpyfallPhaseTimer(room);

    if (targetSocketId && playerId) {
        io.to(targetSocketId).emit('spyfallState', buildSpyfallStatePayload(room, playerId));
        return;
    }

    room.players.forEach(player => {
        if (player.socketId) {
            io.to(player.socketId).emit('spyfallState', buildSpyfallStatePayload(room, player.playerId));
        }
    });
}

function emitSpyfallRoomState(room) {
    if (!room || room.settings.gameMode !== 'spyfall') {
        return;
    }

    emitSpyfallState(room);
    io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
}

// Broadcast เกมตามโหมดของห้อง ใช้เวลา state เปลี่ยนนอก flow ปกติ (เช่น คนออก/หลุดกลางเกม)
function broadcastGameStateForRoom(room) {
    if (!room || !room.settings) {
        return;
    }
    if (room.settings.gameMode === 'werewolf') {
        emitWerewolfRoomState(room);
    } else if (room.settings.gameMode === 'blackmarket') {
        emitBlackMarketState(room);
    } else if (room.settings.gameMode === 'spyfall') {
        emitSpyfallRoomState(room);
    }
}

// เรียกหลังผู้เล่นถูกเอาออกจากห้องกลางเกม (ออกเอง/ถูกเตะ/แบน/ถูกลบ) —
// ให้ engine รับรู้ (เช่น สายลับหนี → จบเกม) แล้วดัน state ใหม่ให้ทุกคน
// ไม่งั้นบอร์ดของคนที่เหลือยังโชว์คนที่ออกไปแล้วเป็นเป้าโหวต/เป้าแอคชันอยู่
function handleMidGamePlayerRemoval(room, playerId) {
    // helper เสริม — ห้าม throw ออกไปทำ flow ออกห้อง/เตะ/แบนพัง (callback จะไม่ถูกส่ง client ค้าง)
    try {
        if (!room || !roomManager.isRoomGameInProgress(room)) {
            return;
        }
        if (room.settings.gameMode === 'spyfall') {
            try {
                getGameEngine('spyfall').handlePlayerLeft(room, playerId);
            } catch (error) {
                console.error('[spyfall] handlePlayerLeft failed:', error?.message || error);
            }
        }
        broadcastGameStateForRoom(room);
    } catch (error) {
        console.error('[game] mid-game removal resync failed:', error?.message || error);
    }
}

function scheduleWerewolfStateBroadcast(room, delayMs = WEREWOLF_PHASE_TRANSITION_DELAY_MS) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return;
    }

    clearWerewolfPhaseTimer(room.roomId);
    clearWerewolfTransitionTimer(room.roomId);

    if (!delayMs || delayMs <= 0) {
        emitWerewolfRoomState(room);
        return;
    }

    room.gameState.phaseEndsAt = null;
    const expectedPhase = room.gameState.phase;
    const expectedDayNumber = room.gameState.dayNumber;
    const expectedWinner = room.gameState.winner || null;

    const timeoutId = setTimeout(() => {
        werewolfTransitionTimeouts.delete(room.roomId);

        const currentRoom = roomManager.getRoom(room.roomId);
        if (!currentRoom || currentRoom.settings.gameMode !== 'werewolf') {
            return;
        }

        if (
            currentRoom.gameState.phase !== expectedPhase ||
            currentRoom.gameState.dayNumber !== expectedDayNumber ||
            (currentRoom.gameState.winner || null) !== expectedWinner
        ) {
            return;
        }

        emitWerewolfRoomState(currentRoom);
    }, delayMs);

    werewolfTransitionTimeouts.set(room.roomId, {
        timeoutId,
        phase: expectedPhase,
        dayNumber: expectedDayNumber
    });
}

function clearWerewolfPhaseTimer(roomId, resetPhaseEndsAt = true) {
    const timer = werewolfPhaseTimeouts.get(roomId);
    if (timer) {
        clearTimeout(timer.timeoutId);
        werewolfPhaseTimeouts.delete(roomId);
    }

    if (!resetPhaseEndsAt) {
        return;
    }

    const room = roomManager.getRoom(roomId);
    if (room && room.settings.gameMode === 'werewolf' && room.gameState) {
        room.gameState.phaseEndsAt = null;
    }
}

function syncWerewolfPhaseTimer(room) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return;
    }

    if (werewolfTransitionTimeouts.has(room.roomId)) {
        console.debug('[werewolf][timer] skip sync during transition', {
            roomId: room.roomId,
            phase: room.gameState?.phase
        });
        return;
    }

    const phase = room.gameState.phase;
    const activePhase = phase === 'night' || phase === 'day-discussion' || phase === 'day-vote';
    if (!activePhase || room.gameState.winner) {
        clearWerewolfPhaseTimer(room.roomId);
        return;
    }

    const now = Date.now();
    const existingTimer = werewolfPhaseTimeouts.get(room.roomId);
    if (existingTimer && existingTimer.phase === phase && room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > now) {
        return;
    }

    if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= now) {
        clearWerewolfPhaseTimer(room.roomId, false);
        try {
            const werewolfEngine = getGameEngine('werewolf');
            console.debug('[werewolf][timer] overdue resolve start', {
                roomId: room.roomId,
                phase,
                dayNumber: room.gameState.dayNumber,
                phaseEndsAt: room.gameState.phaseEndsAt
            });
            const resolution = werewolfEngine.autoResolvePhase(room);
            console.debug('[werewolf][timer] overdue resolve done', {
                roomId: room.roomId,
                phase,
                resolution,
                nextPhase: room.gameState.phase,
                winner: room.gameState.winner
            });
            sendChatMessageToRoom(
                io,
                room.roomId,
                'System',
                phase === 'night'
                    ? 'หมดคืนแล้ว เกมกำลังพาเข้าสู่ช่วงเช้า'
                    : (phase === 'day-discussion' ? 'หมดเวลาพูดคุยแล้ว เปิดให้ทุกคนโหวตทันที' : 'หมดเวลาโหวตแล้ว เกมกำลังสรุปผลโหวต'),
                '#95a5a6'
            );
            emitWerewolfRoomState(room);
        } catch (error) {
            console.error('[werewolf] overdue auto resolve failed:', {
                roomId: room.roomId,
                phase,
                error: error?.message || error
            });
        }
        return;
    }

    clearWerewolfPhaseTimer(room.roomId, false);

    const NIGHT_DURATION_MS = 60000;      // 1 นาที
    const DISCUSSION_DURATION_MS = 180000; // 3 นาที
    const VOTE_DURATION_MS = 60000;        // 1 นาที
    const recapBufferMs = phase === 'day-discussion'
        ? Math.max(0, Number(room.gameState.phaseTimerBufferMs || 0))
        : 0;
    if (recapBufferMs > 0) {
        room.gameState.phaseTimerBufferMs = 0;
    }
    const durationMs = (phase === 'night'
        ? NIGHT_DURATION_MS
        : (phase === 'day-discussion' ? DISCUSSION_DURATION_MS : VOTE_DURATION_MS)) + recapBufferMs;
    const targetEndsAt = room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > now
        ? room.gameState.phaseEndsAt
        : now + durationMs;
    const delayMs = Math.max(0, targetEndsAt - now);
    room.gameState.phaseEndsAt = targetEndsAt;

    console.debug('[werewolf][timer] scheduled', {
        roomId: room.roomId,
        phase,
        durationMs: delayMs,
        phaseEndsAt: room.gameState.phaseEndsAt,
        players: Array.isArray(room.gameState.players) ? room.gameState.players.length : 0
    });

    const timeoutId = setTimeout(() => {
        werewolfPhaseTimeouts.delete(room.roomId);

        const currentRoom = roomManager.getRoom(room.roomId);
        if (!currentRoom || currentRoom.settings.gameMode !== 'werewolf') {
            console.debug('[werewolf][timer] aborted, room missing or wrong mode', { roomId: room.roomId, phase });
            return;
        }

        if (currentRoom.gameState.phase !== phase || currentRoom.gameState.winner) {
            console.debug('[werewolf][timer] aborted, phase changed or winner already set', {
                roomId: room.roomId,
                expectedPhase: phase,
                actualPhase: currentRoom.gameState.phase,
                winner: currentRoom.gameState.winner
            });
            return;
        }

        try {
            const werewolfEngine = getGameEngine('werewolf');
            console.debug('[werewolf][timer] auto resolve start', {
                roomId: currentRoom.roomId,
                phase,
                dayNumber: currentRoom.gameState.dayNumber
            });
            const resolution = werewolfEngine.autoResolvePhase(currentRoom);
            if (resolution && resolution.resolved === false) {
                console.warn('[werewolf][timer] auto resolve incomplete', {
                    roomId: currentRoom.roomId,
                    phase,
                    resolution,
                    nextPhase: currentRoom.gameState.phase
                });
            }
            console.debug('[werewolf][timer] auto resolve done', {
                roomId: currentRoom.roomId,
                phase,
                resolution,
                nextPhase: currentRoom.gameState.phase,
                winner: currentRoom.gameState.winner
            });
            sendChatMessageToRoom(
                io,
                currentRoom.roomId,
                'System',
                phase === 'night'
                    ? 'หมดคืนแล้ว เกมกำลังพาเข้าสู่ช่วงเช้า'
                    : (phase === 'day-discussion' ? 'หมดเวลาพูดคุยแล้ว เปิดให้ทุกคนโหวตทันที' : 'หมดเวลาโหวตแล้ว เกมกำลังสรุปผลโหวต'),
                '#95a5a6'
            );

            emitWerewolfRoomState(currentRoom);
        } catch (error) {
            console.error('[werewolf] auto resolve failed:', {
                roomId: room.roomId,
                phase,
                error: error?.message || error
            });
        }
    }, delayMs);

    werewolfPhaseTimeouts.set(room.roomId, { phase, timeoutId });
}

// onlyOverdue: หยุดทันทีที่ deadline ของ phase ใหม่ยังไม่ถึง — ใช้ตอนกู้หลัง restart
// (ไม่ใส่แล้วจะไล่ resolve หลาย phase รวด โหวต/สกิลถูกเติมอัตโนมัติทั้งที่ผู้เล่นยังออนไลน์)
function forceResolveStuckWerewolfRoom(room, { onlyOverdue = false } = {}) {
    if (!room || room.settings.gameMode !== 'werewolf' || !roomManager.isRoomGameInProgress(room)) {
        return;
    }

    const werewolfEngine = getGameEngine('werewolf');
    const timedPhases = new Set(['night', 'day-discussion', 'day-vote']);
    let safety = 0;

    while (safety < 20 && roomManager.isRoomGameInProgress(room) && timedPhases.has(room.gameState.phase)
        && (!onlyOverdue || (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()))) {
        try {
            werewolfEngine.autoResolvePhase(room);
        } catch (error) {
            console.error('[werewolf] force resolve failed:', {
                roomId: room.roomId,
                phase: room.gameState.phase,
                error: error?.message || error
            });
            break;
        }
        safety += 1;
    }
}

function recoverGamePhaseTimers() {
    roomManager.forEachRoom((room) => {
        if (roomManager.getOnlinePlayerCount(room) === 0) {
            return;
        }

        if (room.settings.gameMode === 'werewolf') {
            if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()) {
                forceResolveStuckWerewolfRoom(room, { onlyOverdue: true });
            }
            syncWerewolfPhaseTimer(room);
            return;
        }

        if (room.settings.gameMode === 'blackmarket') {
            if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()) {
                forceResolveStuckBlackMarketRoom(room, { onlyOverdue: true });
            }
            syncBlackMarketPhaseTimer(room);
            return;
        }

        if (room.settings.gameMode === 'spyfall') {
            if (room.gameState.phaseEndsAt && room.gameState.phaseEndsAt <= Date.now()) {
                const spyfallEngine = getGameEngine('spyfall');
                spyfallEngine.autoResolvePhase(room);
            }
            syncSpyfallPhaseTimer(room);
        }
    });
}

function runRoomCleanupSweep() {
    const activeSocketIds = new Set(Array.from(io.sockets.sockets.keys()));
    const staleSocketPlayers = roomManager.reconcileSocketState(activeSocketIds, ROOM_OFFLINE_GRACE_MS);
    const removedOfflinePlayers = roomManager.purgeDisconnectedPlayers(ROOM_OFFLINE_GRACE_MS);
    const affectedRoomIds = new Set();

    staleSocketPlayers.forEach(entry => {
        affectedRoomIds.add(entry.roomId);
        addServerLog(io, 'system', entry.roomId, `[Cleanup] ${entry.playerName} (${entry.reason})`, 'warning');
    });

    removedOfflinePlayers.forEach(entry => {
        affectedRoomIds.add(entry.roomId);
        addServerLog(io, 'system', entry.roomId, `[Cleanup] ลบ ${entry.playerName} ออกจากห้องเพราะ offline นานเกินกำหนด`, 'warning');
    });

    roomManager.collectAbandonCandidates().forEach(candidate => {
        const room = roomManager.getRoom(candidate.roomId);
        if (!room) {
            return;
        }

        if (room.settings.gameMode === 'werewolf' && roomManager.isRoomGameInProgress(room)) {
            forceResolveStuckWerewolfRoom(room);
        }
        if (room.settings.gameMode === 'blackmarket' && roomManager.isRoomGameInProgress(room)) {
            forceResolveStuckBlackMarketRoom(room);
        }
        if (room.settings.gameMode === 'spyfall' && roomManager.isRoomGameInProgress(room)) {
            const spyfallEngine = getGameEngine('spyfall');
            spyfallEngine.autoResolvePhase(room);
            emitSpyfallRoomState(room);
        }

        clearWerewolfPhaseTimer(candidate.roomId);
        clearWerewolfTransitionTimer(candidate.roomId);
        clearBlackMarketPhaseTimer(candidate.roomId);
        clearSpyfallPhaseTimer(candidate.roomId);
        clearSpyfallReturnTimer(candidate.roomId);
        if (roomCountdowns.has(candidate.roomId)) {
            clearInterval(roomCountdowns.get(candidate.roomId));
            roomCountdowns.delete(candidate.roomId);
        }

        const { room: refreshedRoom, removedPlayers } = roomManager.finalizeAbandonedRoom(candidate.roomId);
        affectedRoomIds.add(candidate.roomId);

        addServerLog(
            io,
            'system',
            candidate.roomId,
            `[Cleanup] ปิดเกมค้าง "${candidate.roomName}" (ไม่มีคนออนไลน์) ลบ offline ${removedPlayers.length} คน`,
            'warning',
            { gameMode: candidate.gameMode || room.settings.gameMode }
        );

        if (refreshedRoom) {
            sendChatMessageToRoom(
                io,
                candidate.roomId,
                'System',
                'ไม่มีผู้เล่นออนไลน์นานเกินกำหนด — รีเซ็ตเกมและลบผู้เล่นที่หลุดออกแล้ว',
                '#e74c3c'
            );
            io.to(candidate.roomId).emit('tableAbandoned', {
                message: 'เกมถูกรีเซ็ตเพราะไม่มีใครออนไลน์'
            });
            io.to(candidate.roomId).emit('restartGame');
            io.to(candidate.roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom));
            if (refreshedRoom.settings.gameMode === 'werewolf') {
                emitWerewolfRoomState(refreshedRoom);
            }
        } else {
            clearWerewolfPhaseTimer(candidate.roomId);
            clearWerewolfTransitionTimer(candidate.roomId);
        }
    });

    recoverGamePhaseTimers();

    affectedRoomIds.forEach(roomId => {
        const room = roomManager.getRoom(roomId);
        if (room) {
            io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
        } else {
            clearWerewolfPhaseTimer(roomId);
            clearWerewolfTransitionTimer(roomId);
        }
    });

    if (affectedRoomIds.size > 0) {
        io.emit('roomListUpdate', roomManager.getAllRooms());
    }
}

async function ensurePersistedPlayer(playerId) {
    if (!playerManager.isValidPlayerId(playerId)) {
        throw new Error('Invalid player ID');
    }

    const existingPlayer = playerManager.getPlayer(playerId);
    if (existingPlayer) {
        await playerManager.updateLastSeen(playerId);
        return existingPlayer;
    }

    const needsApproval = gameSettingsManager.isApprovalRequired();
    return playerManager.createOrGetPlayer(playerId, { approved: !needsApproval });
}

function getRenderablePlayer(playerId) {
    if (playerId === SEO_PREVIEW_PLAYER_ID) {
        return {
            playerId: SEO_PREVIEW_PLAYER_ID,
            playerName: 'Guest Preview',
            color: '#3498db',
            avatar: '👤',
            avatarFrame: 'none',
            createdAt: null,
            lastSeen: null,
            isTransient: true,
            isSeoPreview: true
        };
    }

    return playerManager.buildTransientPlayer(playerId);
}

function resolveDisplayPlayerName(playerId, fallbackName = 'Unknown') {
    const player = playerManager.getPlayer(playerId);
    if (player && player.playerName && player.playerName.trim()) {
        return player.playerName;
    }
    return fallbackName;
}

function getPlayerRoomMembership(playerId) {
    const memberships = [];
    roomManager.getAllRooms().forEach(roomInfo => {
        const room = roomManager.getRoom(roomInfo.roomId);
        if (!room) return;

        const member = room.players.find(p => p.playerId === playerId);
        if (member) {
            memberships.push({
                roomId: room.roomId,
                roomName: room.name,
                online: !!member.socketId,
                isAdmin: room.admin === playerId
            });
        }
    });
    return memberships;
}

function classifyPlayerForAdmin(player, stat, bannedPlayerIds = new Set()) {
    const memberships = getPlayerRoomMembership(player.playerId);
    const totalGames = stat?.totalGames || 0;
    const isAutoNamed = playerManager.isAutoGeneratedName(player.playerName);
    const defaultProfile = playerManager.isDefaultProfile(player);
    const isBanned = bannedPlayerIds.has(player.playerId);
    const isPendingApproval = gameSettingsManager.isApprovalRequired() && player.approved === false;
    const lastSeenMs = player.lastSeen ? new Date(player.lastSeen).getTime() : 0;
    const ageHours = lastSeenMs > 0 ? (Date.now() - lastSeenMs) / (1000 * 60 * 60) : null;
    const isCleanupCandidate = isAutoNamed && defaultProfile && totalGames === 0 && memberships.length === 0 && !isBanned;

    let category = 'real';
    let categoryLabel = 'ผู้เล่นจริง';

    if (isCleanupCandidate) {
        category = 'ghost';
        categoryLabel = 'ghost/cleanup';
    } else if (isAutoNamed) {
        category = totalGames > 0 ? 'guest-active' : 'guest-idle';
        categoryLabel = totalGames > 0 ? 'guest ที่เคยเล่น' : 'guest อัตโนมัติ';
    }

    return {
        ...player,
        displayName: buildDisplayPlayerName(player.playerId, player.playerName),
        totalGames,
        hasStats: !!stat,
        statsLastPlayedAt: stat?.lastPlayedAt || null,
        inRooms: memberships,
        category,
        categoryLabel,
        isCleanupCandidate,
        isAutoGenerated: isAutoNamed,
        isDefaultProfile: defaultProfile,
        isBanned,
        isPendingApproval,
        isSiteAdmin: Boolean(player.isSiteAdmin),
        ageHours
    };
}

function getAdminPlayersData() {
    const players = playerManager.getAllPlayers();
    const stats = statsManager.getAllStats();
    const statsByPlayerId = new Map(stats.map(stat => [stat.playerId, stat]));
    const bannedPlayerIds = new Set(playerManager.getAllBannedPlayers().map(ban => ban.playerId));

    const annotatedPlayers = players.map(player => classifyPlayerForAdmin(player, statsByPlayerId.get(player.playerId), bannedPlayerIds));
    const cleanupCandidates = annotatedPlayers.filter(player => player.isCleanupCandidate);
    const siteAdmins = annotatedPlayers
        .filter(player => player.isSiteAdmin)
        .sort((left, right) => (left.playerName || '').localeCompare(right.playerName || '', 'th'));

    return {
        annotatedPlayers,
        cleanupCandidates,
        siteAdmins,
        statsByPlayerId,
        summary: {
            realPlayers: annotatedPlayers.filter(player => player.category === 'real').length,
            guestActivePlayers: annotatedPlayers.filter(player => player.category === 'guest-active').length,
            guestIdlePlayers: annotatedPlayers.filter(player => player.category === 'guest-idle').length,
            cleanupCandidates: cleanupCandidates.length,
            siteAdmins: siteAdmins.length
        }
    };
}

function emitRoomUpdatesForPlayer(playerId) {
    roomManager.getAllRooms().forEach(roomInfo => {
        const room = roomManager.getRoom(roomInfo.roomId);
        if (!room) {
            return;
        }

        if (room.players.some(player => player.playerId === playerId)) {
            io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
        }
    });
}

async function removePlayerCompletely(playerId, options = {}) {
    const { deleteStats = true, reason = 'บัญชีของคุณถูกลบโดยแอดมิน' } = options;

    const targetSockets = [];
    io.sockets.sockets.forEach((connectedSocket) => {
        if (connectedSocket.playerId === playerId) {
            targetSockets.push(connectedSocket);
        }
    });

    targetSockets.forEach(connectedSocket => {
        connectedSocket.emit('playerDeleted', { message: reason });
        connectedSocket.disconnect(true);
    });

    roomManager.getAllRooms().forEach(roomInfo => {
        const updatedRoom = roomManager.leaveRoom(roomInfo.roomId, playerId);
        if (updatedRoom) {
            handleMidGamePlayerRemoval(updatedRoom, playerId);
        }
    });

    const deletedPlayer = await playerManager.deletePlayer(playerId);
    if (deleteStats) {
        await statsManager.deletePlayerStats(playerId);
    }

    disconnectTimeouts.delete(playerId);
    return deletedPlayer;
}

async function cleanupGhostPlayers(options = {}) {
    const minAgeHours = Number.isFinite(Number(options.minAgeHours)) ? Number(options.minAgeHours) : 24;
    const dryRun = !!options.dryRun;
    const { cleanupCandidates } = getAdminPlayersData();

    const targets = cleanupCandidates.filter(player => player.ageHours === null || player.ageHours >= minAgeHours);

    if (dryRun) {
        return {
            deletedCount: 0,
            candidates: targets,
            minAgeHours
        };
    }

    for (const player of targets) {
        await removePlayerCompletely(player.playerId, {
            deleteStats: true,
            reason: 'บัญชี ghost/auto-generated ถูกล้างโดยแอดมิน'
        });
    }

    io.emit('roomListUpdate', roomManager.getAllRooms());
    return {
        deletedCount: targets.length,
        candidates: targets,
        minAgeHours
    };
}

// ==================== EXPRESS MIDDLEWARE & ROUTES ====================

app.set('trust proxy', 1);

const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
});
io.engine.use(sessionMiddleware);

app.use(expressLayouts)
   .use(sessionMiddleware)
   .use('/static', express.static(__dirname + '/public'))
   .use('/assets', express.static(path.join(__dirname, 'public', 'assets')))
   .use('/js', express.static(path.join(__dirname, 'public', 'js')))
   .use(bodyParser.urlencoded({ extended: true }))
   .use(bodyParser.json())
   .set('view engine', 'ejs')
   .set('layout', 'layouts/layout');

// SEO: Serve robots.txt and sitemap.xml
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.sendFile(__dirname + '/public/robots.txt');
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.sendFile(__dirname + '/public/sitemap.xml');
});

app.get(['/llms.txt', '/ai.txt'], (req, res) => {
    res.type('text/plain');
    res.sendFile(__dirname + '/public/llms.txt');
});

// In INSIDER_DEV_FAST mode the HTTP server accepts requests before the
// player/stats managers finish loading — hold requests until they are ready,
// otherwise approved players are validated against empty state.
let resolveCoreManagersReady;
const coreManagersReady = new Promise(resolve => { resolveCoreManagersReady = resolve; });

app.use(function(req, res, next) {
    coreManagersReady.then(() => next());
});

app.use(function(req, res, next) {
    res.locals.seo = buildSeoMetadata(req);
    res.locals.seoPreviewMode = shouldUseSeoPreview(req);
    res.locals.publicBaseUrl = PUBLIC_BASE_URL;
    res.locals.safeJson = safeJsonForScript;
    next();
});

// Middleware: Initialize player identity
// ใช้ query parameter เท่านั้น (ไม่ใช้ cookie อีกต่อไป)
app.use(async function(req, res, next) {
    // Skip สำหรับ static files, admin, API, health checks และ socket.io
    if (
        req.path === '/ping' ||
        req.path.startsWith('/static') ||
        req.path.startsWith('/admin') ||
        req.path.startsWith('/socket.io') ||
        req.path.startsWith('/api/')
    ) {
        return next();
    }
    
    // หน้า /banned ไม่ต้องสร้าง player ใหม่
    if (req.path === '/banned') {
        let playerId = req.query.playerId;
        if (playerId && playerId !== 'undefined' && playerId !== 'null') {
            req.playerId = playerId;
        }
        return next();
    }

    if (req.path === '/how-to-play') {
        return next();
    }

    if (shouldUseSeoPreview(req)) {
        req.playerId = SEO_PREVIEW_PLAYER_ID;
        return next();
    }
    
    // ดึง playerId จาก query parameter
    let playerId = req.query.playerId;
    const boundPlayerId = playerManager.isValidPlayerId(req.session?.playerId) ? req.session.playerId : null;

    // Once a browser session owns a player identity, query strings cannot switch it.
    if (boundPlayerId) {
        playerId = boundPlayerId;
    }
    
    // ป้องกัน "undefined" หรือ "null" string
    if (!playerId || playerId === 'undefined' || playerId === 'null' || playerId === '' || !playerManager.isValidPlayerId(playerId)) {
        playerId = null;
    }
    
    if (playerId) {
        const existingPlayer = playerManager.getPlayer(playerId);
        if (existingPlayer) {
            await playerManager.updateLastSeen(playerId);
        }
        req.playerId = playerId;
        req.session.playerId = playerId;
        res.locals.viewerPlayerId = playerId;
    } else {
        // ไม่มี playerId ใน URL → ส่ง redirect script ให้ client สร้าง playerId ใหม่และกลับมา
        // ไม่สร้าง player ถาวรที่ server ทันที เพื่อกัน ghost players
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Loading...</title></head>
            <body>
                <p>กำลังโหลด...</p>
                <script>
                    // ดึง playerId จาก localStorage หรือสร้างใหม่
                    let playerId = localStorage.getItem('insiderGamePlayerId');
                    if (!playerId || playerId === 'undefined' || playerId === 'null') {
                        playerId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                            const r = Math.random() * 16 | 0;
                            const v = c === 'x' ? r : (r & 0x3 | 0x8);
                            return v.toString(16);
                        });
                        localStorage.setItem('insiderGamePlayerId', playerId);
                    }
                    // Redirect กลับมาพร้อม playerId
                    const url = new URL(window.location);
                    url.searchParams.set('playerId', playerId);
                    window.location.replace(url.pathname + url.search);
                </script>
            </body>
            </html>
        `);
    }
    
    next();
});

// Middleware: ตรวจสอบว่าผู้เล่นถูกแบนหรือไม่
app.use(function(req, res, next) {
    // ไม่ต้องเช็คหน้า banned และ static files
    if (req.path === '/banned' || req.path.startsWith('/static') || req.path.startsWith('/admin')) {
        return next();
    }
    
    // เช็คว่าถูกแบนไหม
    if (req.playerId && isPlayerBanEnforced(req.playerId)) {
        // ส่ง playerId ไปด้วยเพื่อให้หน้า banned แสดงข้อมูลได้
        return res.redirect('/banned?playerId=' + req.playerId);
    }
    
    next();
});

app.use(function(req, res, next) {
    const skipPaths = ['/banned', '/static', '/admin', '/socket.io', '/settings', '/profile', '/support', '/how-to-play'];
    if (skipPaths.some(p => req.path.startsWith(p)) || !req.playerId) {
        return next();
    }
    if (!isPlayerApproved(req.playerId)) {
        return res.status(403).send(`
            <!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รออนุมัติ</title>
            <style>body{font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
            .box{max-width:420px;background:#1e1e1e;border:1px solid #333;border-radius:12px;padding:24px;text-align:center;}
            a{color:#5eead4;}</style></head><body><div class="box">
            <h1>⏳ รอ Admin อนุมัติ</h1>
            <p>บัญชีของคุณยังไม่ได้รับอนุมัติให้เข้าเล่น กรุณารอผู้ดูแลระบบ</p>
            <p><a href="/settings">ไปตั้งค่าโปรไฟล์</a></p>
            </div></body></html>
        `);
    }
    next();
});

// Middleware: ดึงผู้เล่นกลับห้องเกมถ้าเกมกำลังดำเนินอยู่
app.use(function(req, res, next) {
    // ไม่ต้องเช็คหน้าเหล่านี้
    const skipPaths = ['/banned', '/static', '/admin', '/socket.io', '/support', '/game/', '/room/'];
    if (skipPaths.some(p => req.path.startsWith(p)) || req.path.includes('/game/') || req.path.includes('/room/')) {
        return next();
    }
    
    // เช็คว่าผู้เล่นกำลังอยู่ในห้องที่เกมกำลังดำเนินอยู่หรือไม่
    if (req.playerId) {
        const allRooms = roomManager.getAllRooms();
        for (const roomInfo of allRooms) {
            const room = roomManager.getRoom(roomInfo.roomId);
            if (room) {
                const playerInRoom = room.players.find(p => p.playerId === req.playerId);
                if (playerInRoom) {
                    // ผู้เล่นอยู่ในห้องนี้
                    const gameStatus = room.gameState.status;
                    
                    // ถ้าเกมกำลังดำเนินอยู่ (ไม่ใช่ '' หรือ 'waiting') ให้ดึงกลับ
                    if (gameStatus && gameStatus !== '' && gameStatus !== 'waiting' && gameStatus !== 'ended') {
                        // ดึงกลับไปหน้าเกม
                        return res.redirect('/game/' + room.roomId);
                    }
                    break;
                }
            }
        }
    }
    
    next();
});

// หน้าแจ้งว่าถูกแบน
app.get('/banned', function(req, res) {
    const banInfo = playerManager.getBanInfo(req.playerId);
    
    // ถ้าไม่ได้ถูกแบน (หรือหมดอายุแล้ว) ให้กลับหน้าแรก
    if (!banInfo) {
        return res.redirect('/');
    }
    
    res.render('banned.ejs', { banInfo: banInfo });
});

// Keep-alive endpoint for UptimeRobot (Glitch)
app.get('/ping', function(req, res) {
    res.status(200).json({ 
        status: 'alive', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Lobby page
app.get('/', function(req, res) {
    const player = getRenderablePlayer(req.playerId);
    const stats = statsManager.getStats(req.playerId);
    // season ที่เพิ่งปิดไป + แชมป์ 3 อันดับแรก ใช้ประกาศรีแรงค์ในหน้าแรก
    const lastSeasonSummary = seasonManager.listArchivedSeasons()[0] || null;
    const lastSeasonFull = lastSeasonSummary ? seasonManager.getArchivedSeason(lastSeasonSummary.number) : null;

    res.render('lobby.ejs', {
        player: player,
        stats: stats,
        currentSeason: seasonManager.getCurrentSeason(),
        lastSeason: lastSeasonFull
            ? { ...lastSeasonSummary, topThree: lastSeasonFull.entries.slice(0, 3) }
            : null
    });
});

// API: Leave room (สำหรับ sendBeacon เมื่อปิดหน้า)
app.post('/api/leave-room', express.text({ type: '*/*' }), function(req, res) {
    try {
        const data = JSON.parse(req.body);
        const { roomId } = data;
        const playerId = playerManager.isValidPlayerId(req.session?.playerId) ? req.session.playerId : null;
        if (!playerId || (data.playerId && data.playerId !== playerId)) {
            return res.status(403).send('เปิดหน้าห้องใหม่แล้วลองอีกครั้ง');
        }
        
        if (roomId && playerId) {
            const updatedRoom = roomManager.leaveRoom(roomId, playerId);
            if (updatedRoom) {
                handleMidGamePlayerRemoval(updatedRoom, playerId);
                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));
                io.emit('roomListUpdate', roomManager.getAllRooms());
                const player = playerManager.getPlayer(playerId);
                if (player) {
                    sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} ออกจากห้อง`, '#e74c3c');
                }
                console.log(`[API] Player ${playerId} left room ${roomId} via sendBeacon`);
            } else {
                clearWerewolfPhaseTimer(roomId);
                clearWerewolfTransitionTimer(roomId);
                io.emit('roomListUpdate', roomManager.getAllRooms());
                console.log(`[API] Player ${playerId} left room ${roomId} via sendBeacon`);
            }
        }
        res.status(200).send('OK');
    } catch (e) {
        res.status(200).send('OK'); // ส่ง OK เสมอเพื่อไม่ให้ browser retry
    }
});

// API: Create room over HTTP so create→lobby does not depend on socket session race
app.post('/api/rooms', async function(req, res) {
    try {
        const body = req.body || {};
        const sessionPlayerId = playerManager.isValidPlayerId(req.session?.playerId) ? req.session.playerId : null;
        const requestedPlayerId = playerManager.isValidPlayerId(body.playerId) ? body.playerId : null;
        const playerId = sessionPlayerId || requestedPlayerId;

        if (!playerId) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }
        if (sessionPlayerId && requestedPlayerId && sessionPlayerId !== requestedPlayerId) {
            return res.status(403).json({ success: false, error: 'เปิดหน้าห้องใหม่แล้วลองอีกครั้ง' });
        }

        req.session.playerId = playerId;
        await ensurePersistedPlayer(playerId);

        if (!isPlayerApproved(playerId)) {
            return res.status(403).json({ success: false, error: 'บัญชีของคุณยังไม่ได้รับอนุมัติจาก Admin' });
        }

        const room = roomManager.createRoom(body, playerId);
        io.emit('roomListUpdate', roomManager.getAllRooms());

        return res.json({ success: true, roomId: room.roomId });
    } catch (error) {
        console.error('[API] create room failed:', error);
        return res.status(400).json({ success: false, error: error.message || 'สร้างห้องไม่สำเร็จ' });
    }
});

// Settings page
app.get('/settings', function(req, res) {
    const player = getRenderablePlayer(req.playerId);
    res.render('settings.ejs', { player: player });
});

// Room List page
app.get('/rooms', function(req, res) {
    const player = getRenderablePlayer(req.playerId);
    const rooms = roomManager.getAllRooms();
    res.render('roomList.ejs', {
        player: player,
        rooms: rooms,
        gameModes: getAvailableGameModes(),
        gameModeDefaults: gameSettingsManager.getModeDefaultsForClient(),
        werewolfRoleOptions: getGameEngine('werewolf').getConfigurableRoles()
    });
});

app.get('/how-to-play', function(req, res) {
    res.render('howToPlay.ejs');
});

// Game/Board page จริง
app.get('/game/:roomId', async function(req, res) {
    const roomId = req.params.roomId;
    const playerId = req.playerId;
    const room = roomManager.getRoom(roomId);
    
    // ถ้าห้องไม่มี → กลับไป rooms
    if (!room) {
        return res.redirect('/rooms?msg=room_not_found');
    }

    const player = await ensurePersistedPlayer(playerId);
    if (!player) {
        return res.redirect('/');
    }

    const playerInRoom = room.players.find(p => p.playerId === playerId);
    
    // ถ้าไม่อยู่ในห้อง → กลับไป room lobby (ให้ join ใหม่)
    if (!playerInRoom) {
        return res.redirect('/room/' + roomId + '?playerId=' + playerId);
    }

    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (!gameStatePlayer) {
        return res.redirect('/room/' + roomId + '?playerId=' + playerId);
    }

    if (room.settings.gameMode === 'werewolf') {
        return res.render('werewolfBoard.ejs', {
            player: gameStatePlayer,
            playerInfo: playerInRoom,
            room: {
                roomId: room.roomId,
                name: room.name,
                playerCount: room.players.filter(p => p.socketId).length,
                maxPlayers: room.settings.maxPlayers,
                locked: room.settings.locked,
                admin: room.admin === req.playerId,
                isSiteAdmin: isSiteAdminPlayer(req.playerId),
                settings: room.settings
            },
            werewolfState: buildWerewolfStatePayload(room, playerId),
            chatHistory: buildWerewolfChatHistory(room, playerId)
        });
    }

    if (room.settings.gameMode === 'blackmarket') {
        return res.render('blackMarketBoard.ejs', {
            player: gameStatePlayer,
            playerInfo: playerInRoom,
            room: {
                roomId: room.roomId,
                name: room.name,
                playerCount: room.players.filter(p => p.socketId).length,
                maxPlayers: room.settings.maxPlayers,
                locked: room.settings.locked,
                admin: room.admin === req.playerId,
                isSiteAdmin: isSiteAdminPlayer(req.playerId),
                settings: room.settings
            },
            blackMarketState: buildBlackMarketStatePayload(room, playerId),
            chatHistory: Array.isArray(room.chatHistory) ? room.chatHistory : []
        });
    }

    if (room.settings.gameMode === 'spyfall') {
        return res.render('spyfallBoard.ejs', {
            player: gameStatePlayer,
            playerInfo: playerInRoom,
            room: {
                roomId: room.roomId,
                name: room.name,
                playerCount: room.players.filter(p => p.socketId).length,
                maxPlayers: room.settings.maxPlayers,
                locked: room.settings.locked,
                admin: room.admin === req.playerId,
                isSiteAdmin: isSiteAdminPlayer(req.playerId),
                settings: room.settings
            },
            spyfallState: buildSpyfallStatePayload(room, playerId),
            chatHistory: Array.isArray(room.chatHistory) ? room.chatHistory : []
        });
    }

    res.render('board.ejs', {
        player: gameStatePlayer,
        playerInfo: playerInRoom,
        room: {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.filter(p => p.socketId).length,
            maxPlayers: room.settings.maxPlayers,
            locked: room.settings.locked,
            admin: room.admin === req.playerId,
            isSiteAdmin: isSiteAdminPlayer(req.playerId),
            settings: room.settings // เพิ่ม settings เพื่อให้ board.ejs เข้าถึงได้
        },
        status: room.gameState.status,
        resultVote1: room.gameState.resultVote1,
        resultVote2: room.gameState.resultVote2
    });
});

// Room Lobby page (ก่อนเริ่มเกม)
app.get('/room/:roomId', async function(req, res) {
    const roomId = req.params.roomId;
    const playerId = req.playerId;
    const room = roomManager.getRoom(roomId);
    
    // ถ้าห้องไม่มี → ส่งไป rooms พร้อมแจ้งเตือน
    if (!room) {
        return res.redirect('/rooms?msg=room_not_found');
    }

    const player = await ensurePersistedPlayer(playerId);
    if (!player) {
        return res.redirect('/');
    }

    // ถ้าเกมกำลังเล่นอยู่ → ส่งผู้เล่นที่อยู่ในห้องไปหน้าเกมเลย
    const playerInRoomAlready = room.players.find(p => p.playerId === playerId);
    if (playerInRoomAlready && room.gameState.status !== '' && room.gameState.status !== 'waiting') {
        return res.redirect('/game/' + roomId + '?playerId=' + playerId);
    }

    // ตรวจสอบว่าผู้เล่นอยู่ในห้องนี้หรือไม่
    let playerInRoom = playerInRoomAlready;
    
    // ถ้าผู้เล่นยังไม่อยู่ในห้อง → พยายาม join ห้องให้อัตโนมัติ
    if (!playerInRoom) {
        // เช็คว่าห้องเต็มหรือยัง
        if (room.players.length >= room.settings.maxPlayers) {
            return res.redirect('/rooms?msg=room_full');
        }
        
        // เช็คว่าห้องล็อคหรือไม่
        const canBypassLock = isSiteAdminPlayer(playerId);
        if (room.settings.locked && !canBypassLock) {
            return res.redirect('/rooms?msg=room_locked');
        }
        
        // เช็คว่าเกมเริ่มแล้วหรือยัง
        if (room.gameState.status !== '' && room.gameState.status !== 'waiting') {
            return res.redirect('/rooms?msg=game_in_progress');
        }
        
        // Auto-join room
        try {
            const joinResult = roomManager.joinRoom(roomId, playerId, null, null, { bypassLock: canBypassLock });
            if (!joinResult) {
                return res.redirect('/rooms?msg=join_failed');
            }
            
            playerInRoom = room.players.find(p => p.playerId === playerId);
        } catch (error) {
            console.error('Error auto-joining room:', error);
            return res.redirect('/rooms?msg=' + encodeURIComponent(error.message));
        }
    }

    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (!gameStatePlayer) {
        return res.redirect('/rooms?msg=game_state_error');
    }

    res.render('roomLobby.ejs', {
        player: gameStatePlayer,
        playerInfo: playerInRoom,
        initialRoomPayload: buildRoomUpdatePayload(room),
        room: {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.length,
            maxPlayers: room.settings.maxPlayers,
            roundTime: Math.floor(room.settings.roundTime / 60), // แปลงกลับเป็นนาที
            locked: room.settings.locked,
            password: room.settings.password || '',
            gameMode: room.settings.gameMode,
            gameModeLabel: getGameEngine(room.settings.gameMode).label,
            dualTraitorMode: room.settings.dualTraitorMode || false, // โหมด 2 จอมบงการ
            werewolfRoles: room.settings.werewolfRoles || [],
            adminId: room.admin,
            isAdmin: room.admin === req.playerId,
            isSiteAdmin: isSiteAdminPlayer(req.playerId)
        },
        status: room.gameState.status,
        werewolfRoleOptions: getGameEngine('werewolf').getConfigurableRoles()
    });
});

// Profile page
app.get('/profile', function(req, res) {
    const player = getRenderablePlayer(req.playerId);
    const stats = statsManager.getStats(req.playerId);
    res.render('profile.ejs', { player: player, stats: stats, availableColors: playerManager.AVAILABLE_COLORS });
});

// Player support inbox. Messages remain available when admins are offline.
app.get('/support', function(req, res) {
    const player = getRenderablePlayer(req.playerId);
    req.session.supportPlayerId = player.playerId;
    res.render('support.ejs', {
        player,
        supportToken: createSupportToken(player.playerId)
    });
});

app.get('/api/admin-messages/thread', async function(req, res) {
    try {
        const playerId = resolveSupportPlayerId(req);
        if (!playerId) {
            return res.status(403).json({ success: false, error: 'เปิดหน้าติดต่อแอดมินใหม่อีกครั้ง' });
        }
        const thread = await adminMessageManager.markRead(playerId, 'user');
        return res.json({ success: true, thread });
    } catch (error) {
        console.error('[AdminMessages] Could not load player thread:', error);
        return res.status(500).json({ success: false, error: 'โหลดข้อความไม่สำเร็จ' });
    }
});

app.post('/api/admin-messages', async function(req, res) {
    try {
        const playerId = resolveSupportPlayerId(req);
        const body = normalizeSupportBody(req.body?.message);
        if (!playerId) {
            return res.status(403).json({ success: false, error: 'เปิดหน้าติดต่อแอดมินใหม่อีกครั้ง' });
        }
        if (!body || body.length > 2000) {
            return res.status(400).json({ success: false, error: 'ข้อความต้องมี 1–2,000 ตัวอักษร' });
        }
        if (!canSendSupportMessage(`player:${playerId}`, 8) || !canSendSupportMessage(`ip:${req.ip}`, 30)) {
            return res.status(429).json({ success: false, error: 'ส่งถี่เกินไป กรุณารอสักครู่' });
        }

        const player = playerManager.getPlayer(playerId) || playerManager.buildTransientPlayer(playerId);
        if (!player) {
            return res.status(400).json({ success: false, error: 'Invalid player ID' });
        }
        const result = await adminMessageManager.appendMessage(playerId, player.playerName, 'user', body);
        emitAdminInboxUpdate({ playerId, thread: result.thread });
        addServerLog(io, 'admin', null, `มีข้อความใหม่จาก ${player.playerName}`, 'info', { meta: { playerId } });
        return res.status(201).json({ success: true, message: result.message, thread: result.thread });
    } catch (error) {
        console.error('[AdminMessages] Could not send player message:', error);
        return res.status(500).json({ success: false, error: 'ส่งข้อความไม่สำเร็จ' });
    }
});

// Admin Login page
app.get('/admin/login', function(req, res) {
    if (req.session.isAdmin) {
        return res.redirect('/admin');
    }
    res.render('adminLogin.ejs', { error: null });
});

// Admin Login POST
app.post('/admin/login', function(req, res) {
    const password = req.body.password;
    if (password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('adminLogin.ejs', { error: 'รหัสผ่านไม่ถูกต้อง' });
    }
});

// Admin Logout
app.get('/admin/logout', function(req, res) {
    req.session.isAdmin = false;
    res.redirect('/admin/login');
});

// Admin Dashboard (protected)
app.get('/admin', function(req, res) {
    if (!req.session.isAdmin) {
        return res.redirect('/admin/login');
    }
    // สร้าง token ชั่วคราวสำหรับ authenticate socket
    const adminToken = generateAdminToken();
    res.render('admin.ejs', { adminToken: adminToken });
});

app.get('/admin/api/messages', requireAdminSession, function(req, res) {
    res.json({
        success: true,
        threads: adminMessageManager.listThreads(),
        unreadCount: adminMessageManager.getUnreadAdminCount()
    });
});

app.get('/admin/api/messages/:playerId', requireAdminSession, async function(req, res) {
    try {
        const playerId = String(req.params.playerId || '');
        if (!playerManager.isValidPlayerId(playerId)) {
            return res.status(400).json({ success: false, error: 'Invalid player ID' });
        }
        const thread = await adminMessageManager.markRead(playerId, 'admin');
        return res.json({ success: true, thread, unreadCount: adminMessageManager.getUnreadAdminCount() });
    } catch (error) {
        console.error('[AdminMessages] Could not open admin thread:', error);
        return res.status(500).json({ success: false, error: 'เปิดบทสนทนาไม่สำเร็จ' });
    }
});

app.post('/admin/api/messages/:playerId/reply', requireAdminSession, async function(req, res) {
    try {
        const playerId = String(req.params.playerId || '');
        const body = normalizeSupportBody(req.body?.message);
        if (!playerManager.isValidPlayerId(playerId)) {
            return res.status(400).json({ success: false, error: 'Invalid player ID' });
        }
        if (!body || body.length > 2000) {
            return res.status(400).json({ success: false, error: 'ข้อความต้องมี 1–2,000 ตัวอักษร' });
        }

        const player = playerManager.getPlayer(playerId);
        const result = await adminMessageManager.appendMessage(playerId, player?.playerName, 'admin', body);
        emitAdminInboxUpdate({ playerId, thread: result.thread });
        return res.status(201).json({ success: true, message: result.message, thread: result.thread });
    } catch (error) {
        console.error('[AdminMessages] Could not send admin reply:', error);
        return res.status(500).json({ success: false, error: 'ตอบข้อความไม่สำเร็จ' });
    }
});

// Update player name
app.post('/profile/updateName', async function(req, res) {
    try {
        const newName = req.body.name?.trim();
        if (!newName || newName.length === 0) {
            return res.json({ success: false, error: 'Invalid name' });
        }
        await ensurePersistedPlayer(req.playerId);
        const updatedPlayer = await playerManager.updatePlayerName(req.playerId, newName);
        roomManager.syncPlayerProfile(req.playerId, { playerName: updatedPlayer.playerName });
        statsManager.updatePlayerNameInStats(req.playerId, newName);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Update player color
app.post('/profile/updateColor', async function(req, res) {
    try {
        const color = req.body.color;
        await ensurePersistedPlayer(req.playerId);
        const updatedPlayer = await playerManager.updatePlayerColor(req.playerId, color);
        roomManager.syncPlayerProfile(req.playerId, { color: updatedPlayer.color });
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Update player avatar
app.post('/profile/updateAvatar', async function(req, res) {
    try {
        const avatar = req.body.avatar;
        await ensurePersistedPlayer(req.playerId);
        const updatedPlayer = await playerManager.updatePlayerAvatar(req.playerId, avatar);
        roomManager.syncPlayerProfile(req.playerId, { avatar: updatedPlayer.avatar });
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Update player avatar frame
app.post('/profile/updateAvatarFrame', async function(req, res) {
    try {
        const frameId = req.body.frameId;
        await ensurePersistedPlayer(req.playerId);
        const updatedPlayer = await playerManager.updatePlayerAvatarFrame(req.playerId, frameId);
        roomManager.syncPlayerProfile(req.playerId, { avatarFrame: updatedPlayer.avatarFrame });
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Get available avatars and frames
app.get('/api/avatars', function(req, res) {
    res.json({
        avatars: playerManager.AVAILABLE_AVATARS,
        frames: playerManager.AVAILABLE_FRAMES
    });
});

// Get leaderboard
app.get('/api/leaderboard', function(req, res) {
    const rawLimit = typeof req.query.limit === 'string' ? req.query.limit.trim() : '';
    const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
    const leaderboard = statsManager.getLeaderboard(limit);

    // เพิ่มข้อมูล avatar จาก playerManager
    res.json(enrichLeaderboardEntries(leaderboard));
});

// เติม avatar/สีให้ตารางอันดับ (ใช้ร่วมกันระหว่าง season ปัจจุบันกับประวัติ)
function enrichLeaderboardEntries(entries) {
    return entries.map(entry => {
        const player = playerManager.getPlayer(entry.playerId);
        return {
            ...entry,
            playerName: resolveDisplayPlayerName(entry.playerId, entry.playerName),
            avatar: player?.avatar || '👤',
            avatarFrame: player?.avatarFrame || 'none',
            color: player?.color || '#3498db'
        };
    });
}

// รายชื่อ season: ปัจจุบัน + ที่ปิดไปแล้ว (ไว้ทำแท็บใน leaderboard)
app.get('/api/seasons', function(req, res) {
    res.json({
        current: seasonManager.getCurrentSeason(),
        archived: seasonManager.listArchivedSeasons()
    });
});

// ตารางอันดับของ season ที่ปิดไปแล้ว
app.get('/api/seasons/:number/leaderboard', function(req, res) {
    const seasonNumber = parseInt(req.params.number, 10);
    const season = Number.isFinite(seasonNumber) ? seasonManager.getArchivedSeason(seasonNumber) : null;

    if (!season) {
        return res.status(404).json({ error: 'Season not found' });
    }

    res.json({
        number: season.number,
        name: season.name,
        startedAt: season.startedAt,
        endedAt: season.endedAt,
        totalPlayers: season.totalPlayers,
        totalGames: season.totalGames,
        entries: enrichLeaderboardEntries(season.entries)
    });
});

// Get player profile (for viewing other players)
app.get('/api/player/:playerId/profile', function(req, res) {
    const { playerId } = req.params;
    const player = playerManager.getPlayer(playerId);
    
    if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }
    
    const stats = statsManager.getStats(playerId);
    
    res.json({
        playerId: player.playerId,
        playerName: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        createdAt: player.createdAt,
        stats: stats ? {
            totalGames: stats.totalGames,
            wins: stats.wins,
            losses: stats.losses,
            winRate: stats.totalGames > 0 ? Math.round((stats.wins / stats.totalGames) * 100) : 0,
            roleStats: stats.roleStats,
            winByRole: stats.winByRole,
            modeStats: stats.modeStats,
            lastPlayedAt: stats.lastPlayedAt,
            gameHistory: Array.isArray(stats.gameHistory) ? stats.gameHistory.slice(0, 5) : []
        } : null
    });
});

// Legacy routes (for backward compatibility - redirect to lobby)
app.get('/game', function(req, res) {
    res.redirect('/');
});

app.get('/adminPlayer', function(req, res) {
    res.redirect('/');
});

// ==================== SOCKET.IO HANDLERS ====================

io.sockets.on('connection', function(socket) {
    console.log('Socket connected:', socket.id);
    const sessionPlayerId = getSessionPlayerId(socket);
    if (sessionPlayerId) socket.playerId = sessionPlayerId;

    // ========== ROOM MANAGEMENT EVENTS ==========

    // Create room
    socket.on('createRoom', function(roomData, callback) {
        (async function() {
        try {
            // รับ playerId จาก client (ถ้ามี) หรือจาก socket เก่า
            const playerId = bindSocketPlayer(socket, roomData?.playerId || socket.playerId);
            if (!playerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authenticated' });
                return;
            }

            await ensurePersistedPlayer(playerId);

            if (!isPlayerApproved(playerId)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'บัญชีของคุณยังไม่ได้รับอนุมัติจาก Admin' });
                }
                return;
            }

            const room = roomManager.createRoom(roomData, playerId);
            detachPlayerFromOtherRooms(socket, playerId, room.roomId);
            socketRoomMap.set(socket.id, room.roomId);
            socket.join(room.roomId);
            
            // Update socket info
            socket.playerId = playerId;
            socket.roomId = room.roomId;

            // The creator was added during room creation before this socket was bound.
            // Mark them online now so room list counts are correct immediately.
            roomManager.updatePlayerSocketId(room.roomId, playerId, socket.id);
            roomManager.markPlayerActive(room.roomId, playerId);
            
            // Emit to room list
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            // Send success response
            if (typeof callback === 'function') {
                callback({ success: true, roomId: room.roomId });
            }
        } catch (error) {
            console.error('Error creating room:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
        })();
    });

    // Join room
    socket.on('joinRoom', function(data, callback) {
        (async function() {
        try {
            const { roomId, password, playerId: clientPlayerId } = data || {};
            const playerId = bindSocketPlayer(socket, clientPlayerId || socket.playerId);
            
            if (!playerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authenticated' });
                return;
            }

            await ensurePersistedPlayer(playerId);

            if (!isPlayerApproved(playerId)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'บัญชีของคุณยังไม่ได้รับอนุมัติจาก Admin' });
                }
                return;
            }
            
            // Set socket.playerId for future use
            socket.playerId = playerId;

            const room = roomManager.joinRoom(
                roomId,
                playerId,
                socket.id,
                password,
                { bypassLock: isSiteAdminPlayer(playerId) }
            );
            // Always use canonical string roomId — clients may send numeric 6-digit IDs
            const joinedRoomId = room.roomId;
            detachPlayerFromOtherRooms(socket, playerId, joinedRoomId);
            roomManager.markPlayerActive(joinedRoomId, playerId);
            socketRoomMap.set(socket.id, joinedRoomId);
            socket.join(joinedRoomId);
            
            // Update socket info
            socket.playerId = playerId;
            socket.roomId = joinedRoomId;
            
            // Send room data to client
            const playerInRoom = room.players.find(p => p.playerId === playerId);
            socket.emit('roomJoined', {
                room: {
                    roomId: room.roomId,
                    name: room.name,
                    players: room.players.map(p => ({
                        playerId: p.playerId,
                        playerName: p.playerName,
                        displayName: buildDisplayPlayerName(p.playerId, p.playerName),
                        color: p.color,
                        permission: p.permission,
                        isSiteAdmin: isSiteAdminPlayer(p.playerId)
                    })),
                    admin: room.admin,
                    settings: room.settings
                },
                player: playerInRoom
            });

            // Emit to all in room
            io.to(joinedRoomId).emit('roomUpdate', {
                ...buildRoomUpdatePayload(room)
            });

            // ไม่ส่ง chat notification ที่นี่แล้ว - จะส่งใน setRoom แทน เพื่อให้ผู้เล่นเห็นตัวเองด้วย

            // Update room list
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            console.error('Error joining room:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
        })();
    });

    // Request room update (for re-rendering after admin change)
    socket.on('requestRoomUpdate', function(data) {
        const room = getSocketRoom(socket);
        if (!room || (data?.roomId && data.roomId !== room.roomId)) return;
        
        // Send room update to requesting socket
        io.to(socket.id).emit('roomUpdate', {
            ...buildRoomUpdatePayload(room)
        });
    });

    // Check room status (เมื่อ user กลับมาจาก background)
    socket.on('checkRoomStatus', function(data) {
        const roomId = data?.roomId || socket.roomId;
        const playerId = socket.playerId || getSessionPlayerId(socket);
        if (!roomId || !playerId || (data?.playerId && data.playerId !== playerId)) {
            socket.emit('kickedFromRoom', { message: 'เซสชันผู้เล่นไม่ตรงกัน กรุณาเปิดห้องใหม่' });
            return;
        }
        const room = roomManager.getRoom(roomId);
        
        if (!room) {
            // ห้องถูกลบไปแล้ว → ส่งกลับไป roomList
            socket.emit('roomClosed', { message: 'ห้องถูกปิดไปแล้ว' });
            return;
        }
        
        // ตรวจสอบว่า player ยังอยู่ในห้องไหม
        const playerInRoom = room.players.find(p => p.playerId === playerId);
        if (!playerInRoom) {
            // ถูกเตะออกไปแล้ว → ส่งกลับไป roomList
            socket.emit('kickedFromRoom', { message: 'คุณถูกเตะออกจากห้อง' });
            return;
        }
        
        // ถ้ายังอยู่ → อัปเดต socketId และ rejoin room
        roomManager.updatePlayerSocketId(roomId, playerId, socket.id);
        roomManager.markPlayerActive(roomId, playerId);
        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerId = playerId;
        
        const refreshedRoom = roomManager.getRoom(roomId);
        io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom || room));

        if (refreshedRoom?.settings?.gameMode === 'werewolf') {
            emitWerewolfState(refreshedRoom, socket.id, playerId);
            syncWerewolfPhaseTimer(refreshedRoom);
        } else if (refreshedRoom?.settings?.gameMode === 'blackmarket') {
            emitBlackMarketState(refreshedRoom, socket.id, playerId);
        } else if (refreshedRoom?.settings?.gameMode === 'spyfall') {
            emitSpyfallState(refreshedRoom, socket.id, playerId);
        }
    });

    socket.on('endTableSession', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = roomManager.getRoom(roomId);

            if (!room) {
                throw new Error('ไม่พบห้อง');
            }

            if (!playerId || room.admin !== playerId) {
                throw new Error('มีแค่หัวหน้าห้องที่จบเกมได้');
            }

            clearWerewolfPhaseTimer(roomId);
            clearWerewolfTransitionTimer(roomId);
            clearBlackMarketPhaseTimer(roomId);
            clearSpyfallPhaseTimer(roomId);
            clearSpyfallReturnTimer(roomId);
            if (roomCountdowns.has(roomId)) {
                clearInterval(roomCountdowns.get(roomId));
                roomCountdowns.delete(roomId);
            }

            const { room: refreshedRoom, removedPlayers } = roomManager.endTableSession(roomId, playerId);

            if (!refreshedRoom) {
                io.emit('roomListUpdate', roomManager.getAllRooms());
                if (typeof callback === 'function') {
                    callback({ success: true, roomClosed: true });
                }
                return;
            }

            const offlineCount = removedPlayers.length;
            sendChatMessageToRoom(
                io,
                roomId,
                'System',
                `หัวหน้าห้องจบเกมแล้ว${offlineCount > 0 ? ` (ลบผู้เล่นที่หลุด ${offlineCount} คน)` : ''}`,
                '#e67e22'
            );
            io.to(roomId).emit('restartGame');
            io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom));
            io.emit('roomListUpdate', roomManager.getAllRooms());

            if (refreshedRoom.settings.gameMode === 'werewolf') {
                emitWerewolfRoomState(refreshedRoom);
            } else if (refreshedRoom.settings.gameMode === 'blackmarket') {
                emitBlackMarketState(refreshedRoom);
            } else if (refreshedRoom.settings.gameMode === 'spyfall') {
                emitSpyfallRoomState(refreshedRoom);
            }

            if (typeof callback === 'function') {
                callback({ success: true, removedCount: offlineCount });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Leave room
    socket.on('leaveRoom', function(data, callback) {
        const roomId = socket.roomId;
        const playerId = socket.playerId;
        
        if (!roomId || !playerId) {
            if (typeof callback === 'function') callback({ success: true });
            return;
        }

        // ตรวจสอบว่าคนที่ออกเป็น Admin หรือเปล่า
        const roomBefore = roomManager.getRoom(roomId);
        const wasAdmin = roomBefore && roomBefore.admin === playerId;

        const room = roomManager.leaveRoom(roomId, playerId);
        socket.leave(roomId);
        socketRoomMap.delete(socket.id);
        socket.roomId = null;

        if (room) {
            handleMidGamePlayerRemoval(room, playerId);

            // Emit to remaining players
            io.to(roomId).emit('roomUpdate', {
                ...buildRoomUpdatePayload(room)
            });

            // Send chat notification
            const player = playerManager.getPlayer(playerId);
            if (player) {
                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} ออกจากห้อง`, '#e74c3c');
                addServerLog(io, 'leave', roomId, `${player.playerName} ออกจากห้อง`, 'warning');
            }
            
            // ถ้า Admin ออก → แจ้งเตือนว่า Admin ใหม่คือใคร
            if (wasAdmin && room.admin) {
                const newAdmin = playerManager.getPlayer(room.admin);
                if (newAdmin) {
                    sendChatMessageToRoom(io, roomId, 'System', `👑 ${newAdmin.playerName} ได้รับสิทธิ์ Admin แล้ว`, '#f39c12');
                    
                    // แจ้งเตือนทุกคนในห้อง
                    io.to(roomId).emit('adminTransferred', { 
                        message: `${newAdmin.playerName} เป็น Admin คนใหม่แล้ว`,
                        newAdminId: room.admin,
                        newAdminName: newAdmin.playerName,
                        oldAdminId: playerId
                    });
                }
            }
        }

        if (!room) {
            clearWerewolfPhaseTimer(roomId);
            clearWerewolfTransitionTimer(roomId);
        }

        // Update room list
        io.emit('roomListUpdate', roomManager.getAllRooms());
        
        // Send callback
        if (typeof callback === 'function') callback({ success: true });
    });

    // Kick player
    socket.on('kickPlayer', function(data, callback) {
        try {
            const { targetPlayerId } = data;
            const roomId = socket.roomId;
            const adminPlayerId = socket.playerId;
            
            if (!roomId || !adminPlayerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not in room' });
                return;
            }

            const room = roomManager.getRoom(roomId);
            if (!isAdminSocket(room, socket)) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authorized' });
                return;
            }

            const targetPlayer = playerManager.getPlayer(targetPlayerId);
            
            // Find target socket BEFORE kicking (important!)
            const targetSocketId = room.players.find(p => p.playerId === targetPlayerId)?.socketId;
            
            // Emit kick event to target player BEFORE removing them
            if (targetSocketId) {
                io.to(targetSocketId).emit('kickedFromRoom', { message: 'คุณถูกเตะออกจากห้อง' });
                
                // Also make them leave the socket room
                const targetSocket = io.sockets.sockets.get(targetSocketId);
                if (targetSocket) {
                    targetSocket.leave(roomId);
                    targetSocket.roomId = null;
                }
            }

            // Now kick player from room data
            roomManager.kickPlayer(roomId, adminPlayerId, targetPlayerId);

            // Update remaining players
            const updatedRoom = roomManager.getRoom(roomId);
            if (updatedRoom) {
                handleMidGamePlayerRemoval(updatedRoom, targetPlayerId);

                io.to(roomId).emit('roomUpdate', {
                    ...buildRoomUpdatePayload(updatedRoom)
                });

                // Send chat notification
                sendChatMessageToRoom(io, roomId, 'System', `${targetPlayer.playerName} ถูกเตะออกจากห้อง`, '#e74c3c');
            }

            // Update room list
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            console.error('Error kicking player:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Transfer admin
    socket.on('transferAdmin', function(data, callback) {
        try {
            const { newAdminPlayerId } = data;
            const roomId = socket.roomId;
            const currentAdminId = socket.playerId;
            
            if (!roomId || !currentAdminId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not in room' });
                return;
            }

            const room = roomManager.transferAdmin(roomId, currentAdminId, newAdminPlayerId);
            
            // Emit to room
            io.to(roomId).emit('roomUpdate', {
                ...buildRoomUpdatePayload(room)
            });

            // Send chat notification
            const newAdmin = playerManager.getPlayer(newAdminPlayerId);
            sendChatMessageToRoom(io, roomId, 'System', `👑 สิทธิ์ Admin ถูกโอนให้ ${newAdmin.playerName}`, '#f39c12');
            
            // Notify all players in room about admin change
            io.to(roomId).emit('adminTransferred', { 
                message: `${newAdmin.playerName} เป็น Admin คนใหม่แล้ว`,
                newAdminId: newAdminPlayerId,
                newAdminName: newAdmin.playerName,
                oldAdminId: currentAdminId
            });

            // Update room list ให้ทุกคนเห็นว่า admin เปลี่ยน
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            console.error('Error transferring admin:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Update room settings
    socket.on('updateRoom', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const adminPlayerId = socket.playerId;
            
            if (!roomId || !adminPlayerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not in room' });
                return;
            }

            const room = roomManager.updateRoom(roomId, adminPlayerId, data);
            
            // Emit to room
            io.to(roomId).emit('roomUpdate', {
                ...buildRoomUpdatePayload(room)
            });

            // Send chat notification
            sendChatMessageToRoom(io, roomId, 'System', 'การตั้งค่าห้องถูกอัปเดต', '#2ecc71');
            
            // Update room list
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            if (typeof callback === 'function') {
                callback({ success: true, room: room });
            }
        } catch (error) {
            console.error('Error updating room:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });
    
    // Quick toggle dual traitor mode
    socket.on('toggleDualTraitorMode', function(data) {
        try {
            const roomId = socket.roomId;
            const adminPlayerId = socket.playerId;
            const enabled = data.enabled;
            
            if (!roomId || !adminPlayerId) return;
            
            const room = roomManager.getRoom(roomId);
            if (!room) return;
            
            // Check if player is admin
            if (room.admin !== adminPlayerId) return;
            
            // Check player count
            if (enabled && room.players.length < 5) return;
            
            // Update setting
            room.settings.dualTraitorMode = enabled;
            
            // Emit to room
            io.to(roomId).emit('roomUpdate', {
                ...buildRoomUpdatePayload(room)
            });

            // Send chat notification
            const modeText = enabled ? '🔴🔴 เปิดโหมด 2 จอมบงการ!' : '🔴 ปิดโหมด 2 จอมบงการ (ใช้โหมดปกติ)';
            sendChatMessageToRoom(io, roomId, 'System', modeText, '#e74c3c');
            
            // Update room list for all clients
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            console.log(`[toggleDualTraitorMode] Room ${roomId}: ${enabled ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error('Error toggling dual traitor mode:', error);
        }
    });

    // Get room list
    socket.on('getRoomList', function(callback) {
        const rooms = roomManager.getAllRooms();
        if (typeof callback === 'function') {
            callback({ success: true, rooms: rooms });
        }
    });

    // ==================== ADMIN SOCKET AUTHENTICATION ====================
    
    // Admin: Authenticate socket ด้วย token (ต้องเรียกก่อนใช้ admin functions อื่นๆ)
    socket.on('admin_authenticate', function(data, callback) {
        try {
            const { token } = data;
            
            // ตรวจสอบ token
            if (token && adminTokens.has(token)) {
                const tokenData = adminTokens.get(token);
                
                // อนุญาตให้ reuse token ภายในอายุ 60 วินาที เพื่อให้ reconnect แล้ว dashboard ไม่หลุดง่าย
                if ((Date.now() - tokenData.createdAt) < 60000) {
                    adminSockets.add(socket.id);
                    console.log(`[Admin] Socket ${socket.id} authenticated as admin via token`);
                    if (typeof callback === 'function') {
                        callback({ success: true });
                    }
                } else {
                    console.log(`[Admin] Token expired from socket ${socket.id}`);
                    if (typeof callback === 'function') {
                        callback({ success: false, error: 'Token หมดอายุ กรุณา refresh หน้า' });
                    }
                }
            } else {
                console.log(`[Admin] Invalid token from socket ${socket.id}`);
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Token ไม่ถูกต้อง' });
                }
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Helper function: ตรวจสอบว่า socket เป็น admin หรือไม่
    function isAdminAuthenticated(socketId) {
        return adminSockets.has(socketId);
    }

    // Admin: Get all data for dashboard
    socket.on('admin_getData', function(callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            // ดึงข้อมูลผู้เล่นทั้งหมด
            const adminPlayersData = getAdminPlayersData();
            
            // ดึงข้อมูลห้องทั้งหมด พร้อมชื่อผู้เล่นในห้อง
            const allRooms = roomManager.getAllRooms();
            const roomsWithPlayers = allRooms.map(room => {
                const fullRoom = roomManager.getRoom(room.roomId);
                return {
                    ...room,
                    playerNames: fullRoom ? fullRoom.players.map(p => p.playerName) : []
                };
            });
            
            // ดึงสถิติผู้เล่นทั้งหมด
            const playerStats = statsManager.getAllStats().map(stat => ({
                ...stat,
                playerName: resolveDisplayPlayerName(stat.playerId, stat.playerName)
            }));
            
            if (typeof callback === 'function') {
                callback({
                    success: true,
                    players: adminPlayersData.annotatedPlayers,
                    siteAdmins: adminPlayersData.siteAdmins,
                    rooms: roomsWithPlayers,
                    playerStats: playerStats,
                    bannedPlayers: playerManager.getAllBannedPlayers(),
                    playerSummary: adminPlayersData.summary,
                    cleanupCandidates: adminPlayersData.cleanupCandidates
                });
            }
        } catch (error) {
            console.error('Error getting admin data:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Admin: Get server logs
    socket.on('admin_getLogs', function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized' });
                }
                return;
            }
            
            const { filter, gameMode: modeFilter, limit } = data || {};
            let logs = [...serverLogs]; // Clone array
            
            // Filter by category if specified
            if (filter && filter !== 'all') {
                logs = logs.filter(log => log.category === filter);
            }

            if (modeFilter && modeFilter !== 'all') {
                logs = logs.filter(log => log.gameMode === modeFilter);
            }
            
            // Limit results
            if (limit && limit > 0) {
                logs = logs.slice(0, limit);
            }
            
            if (typeof callback === 'function') {
                callback({ success: true, logs: logs });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Admin: Clear server logs
    socket.on('admin_clearLogs', function(callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized' });
                }
                return;
            }
            
            serverLogs.length = 0;
            addServerLog(io, 'admin', null, 'Logs ถูกล้างโดย Admin', 'warning');
            
            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Admin: Ban player
    socket.on('admin_banPlayer', function(data, callback) {
        try {
            console.log(`[Admin Ban] Attempt from socket ${socket.id}, isAuthenticated: ${isAdminAuthenticated(socket.id)}`);
            
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                console.log(`[Admin Ban] REJECTED - socket ${socket.id} is not authenticated`);
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId, reason, durationHours } = data;
            const player = playerManager.getPlayer(playerId);
            if (!player) {
                return callback({ success: false, error: 'ไม่พบผู้เล่น' });
            }
            
            // แบนผู้เล่น พร้อมระยะเวลา
            playerManager.banPlayer(playerId, player.playerName, reason || 'ไม่ระบุเหตุผล', 'Admin', durationHours);
            
            // สร้างข้อความแจ้งเตือน
            const durationText = durationHours === null ? 'ถาวร' : `${durationHours} ชั่วโมง`;
            const banMessage = `คุณถูกแบนโดยผู้ดูแลระบบ\nเหตุผล: ${reason}\nระยะเวลา: ${durationText}`;
            
            // Kick from all rooms และส่งไปหน้า banned
            const allRooms = roomManager.getAllRooms();
            allRooms.forEach(roomInfo => {
                const room = roomManager.getRoom(roomInfo.roomId);
                if (room) {
                    const playerInRoom = room.players.find(p => p.playerId === playerId);
                    if (playerInRoom && playerInRoom.socketId) {
                        io.to(playerInRoom.socketId).emit('banned', { 
                            reason: reason,
                            durationHours: durationHours,
                            message: banMessage
                        });
                    }
                    const bannedRoom = roomManager.leaveRoom(roomInfo.roomId, playerId);
                    if (bannedRoom) {
                        handleMidGamePlayerRemoval(bannedRoom, playerId);
                    }
                }
            });

            callback({ success: true });
        } catch (error) {
            console.error('Error banning player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Unban player
    socket.on('admin_unbanPlayer', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId } = data;
            playerManager.unbanPlayer(playerId);
            callback({ success: true });
        } catch (error) {
            console.error('Error unbanning player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Edit player name
    socket.on('admin_editPlayerName', async function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId, newName } = data;
            const updateResult = await playerManager.adminUpdatePlayerName(playerId, newName);
            roomManager.syncPlayerProfile(playerId, { playerName: updateResult.newName });
            statsManager.updatePlayerNameInStats(playerId, updateResult.newName);
            callback({ success: true });
        } catch (error) {
            console.error('Error editing player name:', error);
            callback({ success: false, error: error.message });
        }
    });

    socket.on('admin_setSiteAdmin', async function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }

            const { playerId, isSiteAdmin } = data || {};
            const updatedPlayer = await playerManager.setSiteAdmin(playerId, isSiteAdmin);
            emitRoomUpdatesForPlayer(playerId);
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true, player: updatedPlayer });
        } catch (error) {
            console.error('Error updating site admin:', error);
            callback({ success: false, error: error.message });
        }
    });

    socket.on('admin_createSiteAdmin', async function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }

            const { playerName } = data || {};
            const createdPlayer = await playerManager.createSiteAdmin(playerName);
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true, player: createdPlayer });
        } catch (error) {
            console.error('Error creating site admin:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Delete player
    socket.on('admin_deletePlayer', async function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId } = data;
            await removePlayerCompletely(playerId);
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            callback({ success: true });
        } catch (error) {
            console.error('Error deleting player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Bulk delete players
    socket.on('admin_bulkDeletePlayers', async function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerIds } = data;
            let deletedCount = 0;
            
            if (!playerIds || !Array.isArray(playerIds)) {
                return callback({ success: false, error: 'ไม่มี playerIds' });
            }
            
            for (const playerId of playerIds) {
                try {
                    await removePlayerCompletely(playerId);
                    deletedCount++;
                } catch (err) {
                    console.error('Error deleting player:', playerId, err);
                }
            }
            
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true, deletedCount });
        } catch (error) {
            console.error('Error bulk deleting players:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Delete all players
    socket.on('admin_deleteAllPlayers', async function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const allPlayers = playerManager.getAllPlayers();
            let deletedCount = 0;
            
            for (const player of allPlayers) {
                try {
                    await removePlayerCompletely(player.playerId);
                    deletedCount++;
                } catch (err) {
                    console.error('Error deleting player:', player.playerId, err);
                }
            }
            
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true, deletedCount });
        } catch (error) {
            console.error('Error deleting all players:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Close room
    socket.on('admin_closeRoom', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { roomId } = data;
            const room = roomManager.getRoom(roomId);
            
            if (!room) {
                return callback({ success: false, error: 'ไม่พบห้อง' });
            }
            
            // Kick all players
            room.players.forEach(player => {
                if (player.socketId) {
                    io.to(player.socketId).emit('kicked', { reason: 'ห้องถูกปิดโดยผู้ดูแลระบบ' });
                }
            });
            
            roomManager.forceCloseRoom(roomId);
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            callback({ success: true });
        } catch (error) {
            console.error('Error closing room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Unlock room
    socket.on('admin_unlockRoom', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { roomId } = data;
            roomManager.unlockRoom(roomId);
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true });
        } catch (error) {
            console.error('Error unlocking room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Reset room game
    socket.on('admin_resetRoom', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { roomId } = data;
            const room = roomManager.getRoom(roomId);
            
            if (!room) {
                return callback({ success: false, error: 'ไม่พบห้อง' });
            }
            
            // Stop countdown if running
            if (roomCountdowns.has(roomId)) {
                clearInterval(roomCountdowns.get(roomId));
                roomCountdowns.delete(roomId);
            }
            
            // Reset game state
            roomManager.resetRoomGame(roomId);
            
            // Notify all players in room
            io.to(roomId).emit('restartGame');
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            callback({ success: true });
        } catch (error) {
            console.error('Error resetting room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Reset player stats
    socket.on('admin_resetPlayerStats', async function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId } = data;
            await statsManager.resetPlayerStats(playerId);
            callback({ success: true });
        } catch (error) {
            console.error('Error resetting player stats:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Edit player stats (เทพ!)
    socket.on('admin_editPlayerStats', async function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId, playerName, totalGames, wins, losses, roleStats, modeStats } = data;
            await statsManager.editPlayerStats(playerId, {
                playerName,
                totalGames,
                wins,
                losses,
                roleStats,
                modeStats
            });
            addServerLog(io, 'admin', null, `Admin แก้ไขสถิติ ${playerName}: ${wins}W/${losses}L`, 'warning');
            callback({ success: true });
        } catch (error) {
            console.error('Error editing player stats:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Clear all player stats
    socket.on('admin_clearAllStats', async function(callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const count = await statsManager.clearAllStats();
            addServerLog(io, 'admin', null, `Admin ล้างสถิติทั้งหมด (${count} รายการ)`, 'warning');
            callback({ success: true, count });
        } catch (error) {
            console.error('Error clearing all stats:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: สรุปสถานะ season ปัจจุบัน (ใช้ยืนยันก่อนกดรีแรงค์)
    socket.on('admin_seasonPreview', function(callback) {
        if (typeof callback !== 'function') {
            return;
        }

        try {
            if (!isAdminAuthenticated(socket.id)) {
                callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                return;
            }

            const preview = seasonManager.getSeasonResetPreview();
            const topThree = statsManager.getLeaderboard(3);
            callback({ success: true, ...preview, topThree });
        } catch (error) {
            console.error('Error building season preview:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: ปิด season ปัจจุบัน เก็บอันดับเป็นประวัติ แล้วรีเซ็ตสถิติทุกคน
    socket.on('admin_resetSeason', async function(data, callback) {
        const done = typeof callback === 'function' ? callback : (typeof data === 'function' ? data : function() {});
        const payload = typeof data === 'object' && data !== null ? data : {};

        try {
            if (!isAdminAuthenticated(socket.id)) {
                done({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                return;
            }

            // กันกดพลาด: ต้องพิมพ์ชื่อ season ที่กำลังจะปิดให้ตรง
            const currentSeason = seasonManager.getCurrentSeason();
            const typedName = typeof payload.confirmName === 'string' ? payload.confirmName.trim() : '';
            if (typedName.toLowerCase() !== currentSeason.name.toLowerCase()) {
                done({ success: false, error: `ต้องพิมพ์ "${currentSeason.name}" ให้ตรงเพื่อยืนยัน` });
                return;
            }

            const result = await seasonManager.runSeasonReset();
            addServerLog(
                io,
                'admin',
                null,
                `Admin ปิด ${result.archived.name} (เก็บอันดับ ${result.archived.entries.length} คน) และรีเซ็ตสถิติ ${result.resetCount} คน เริ่ม ${result.current.name}`,
                'warning'
            );

            done({
                success: true,
                archivedName: result.archived.name,
                archivedCount: result.archived.entries.length,
                currentName: result.current.name,
                resetCount: result.resetCount,
                backupFile: result.backupFile
            });
        } catch (error) {
            console.error('Error resetting season:', error);
            done({ success: false, error: error.message });
        }
    });

    // Admin: Bulk delete player stats
    socket.on('admin_bulkDeleteStats', async function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerIds } = data;
            if (!Array.isArray(playerIds) || playerIds.length === 0) {
                callback({ success: false, error: 'ไม่มีรายการที่เลือก' });
                return;
            }
            
            const count = await statsManager.bulkDeleteStats(playerIds);
            addServerLog(io, 'admin', null, `Admin ลบสถิติ ${count} รายการ`, 'warning');
            callback({ success: true, count });
        } catch (error) {
            console.error('Error bulk deleting stats:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Delete single player stats
    socket.on('admin_deletePlayerStats', async function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { playerId, playerName } = data;
            const success = await statsManager.deletePlayerStats(playerId);
            if (success) {
                addServerLog(io, 'admin', null, `Admin ลบสถิติของ ${playerName || playerId}`, 'warning');
            }
            callback({ success });
        } catch (error) {
            console.error('Error deleting player stats:', error);
            callback({ success: false, error: error.message });
        }
    });

    socket.on('admin_cleanupGhostPlayers', async function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }

            const result = await cleanupGhostPlayers({
                minAgeHours: data?.minAgeHours,
                dryRun: data?.dryRun
            });

            if (!data?.dryRun) {
                addServerLog(io, 'admin', null, `Admin cleanup ghost players ${result.deletedCount} คน (เก่ากว่า ${result.minAgeHours} ชม.)`, 'warning');
            }

            callback({ success: true, ...result });
        } catch (error) {
            console.error('Error cleaning ghost players:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Clear empty rooms
    socket.on('admin_clearEmptyRooms', function(callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const count = roomManager.clearEmptyRooms();
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true, count });
        } catch (error) {
            console.error('Error clearing empty rooms:', error);
            callback({ success: false, error: error.message, count: 0 });
        }
    });

    // Admin: Clear all rooms
    socket.on('admin_clearAllRooms', function(callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            // Kick all players from all rooms first
            const allRooms = roomManager.getAllRooms();
            allRooms.forEach(roomInfo => {
                const room = roomManager.getRoom(roomInfo.roomId);
                if (room) {
                    room.players.forEach(player => {
                        if (player.socketId) {
                            io.to(player.socketId).emit('kicked', { reason: 'ห้องทั้งหมดถูกปิดโดยผู้ดูแลระบบ' });
                        }
                    });
                }
            });
            
            const count = roomManager.clearAllRooms();
            io.emit('roomListUpdate', roomManager.getAllRooms());
            callback({ success: true, count });
        } catch (error) {
            console.error('Error clearing all rooms:', error);
            callback({ success: false, error: error.message, count: 0 });
        }
    });

    // Admin: Broadcast message
    socket.on('admin_broadcast', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { message } = data;
            io.emit('systemBroadcast', { message, timestamp: Date.now() });
            callback({ success: true });
        } catch (error) {
            console.error('Error broadcasting:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Get room details
    socket.on('admin_getRoomDetails', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { roomId } = data;
            const room = roomManager.getRoom(roomId);
            if (!room) {
                return callback({ success: false, error: 'ไม่พบห้อง' });
            }

            const inGameStatuses = ['role', 'word', 'vote1', 'vote2', 'in_progress'];
            const isPlaying = inGameStatuses.includes(room.gameState.status);
            
            const players = room.players.map(p => ({
                id: p.playerId,
                name: p.playerName,
                color: p.color,
                isAdmin: p.playerId === room.admin,
                role: isPlaying ? (room.gameState.players.find(gp => gp.playerId === p.playerId)?.role || null) : null
            }));

            callback({
                success: true,
                room: {
                    roomId: room.roomId,
                    name: room.name,
                    gameMode: room.settings?.gameMode || null,
                    gameStatus: isPlaying ? 'playing' : 'waiting',
                    gamePhase: room.gameState.status || null,
                    locked: room.settings?.locked || false,
                    maxPlayers: room.settings?.maxPlayers,
                    currentWord: isPlaying ? room.gameState.word : null,
                    players,
                    chatHistory: buildAdminChatHistory(room)
                }
            });
        } catch (error) {
            console.error('Error getting room details:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Kick player from room
    socket.on('admin_kickPlayerFromRoom', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
            const { roomId, playerId } = data;
            const room = roomManager.getRoom(roomId);
            if (!room) {
                return callback({ success: false, error: 'ไม่พบห้อง' });
            }
            
            const player = room.players.find(p => p.playerId === playerId);
            if (!player) {
                return callback({ success: false, error: 'ไม่พบผู้เล่นในห้อง' });
            }
            
            // Notify the player
            if (player.socketId) {
                io.to(player.socketId).emit('kickedFromRoom', { 
                    reason: 'ถูกเตะออกโดย Admin' 
                });
            }
            
            // Remove from room
            const updatedRoom = roomManager.leaveRoom(roomId, playerId);

            // Update room for others
            if (updatedRoom) {
                handleMidGamePlayerRemoval(updatedRoom, playerId);
                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));
            }
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            callback({ success: true });
        } catch (error) {
            console.error('Error kicking player:', error);
            callback({ success: false, error: error.message });
        }
    });

    socket.on('admin_getGameSettings', function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized' });
                }
                return;
            }
            if (typeof callback === 'function') {
                callback({ success: true, ...gameSettingsManager.buildAdminPayload() });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('admin_saveSettings', function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }

            const normalized = gameSettingsManager.normalizeIncomingSettings(data);
            const previousWordFile = gameSettingsManager.getSettings().insider?.wordFile;
            gameSettingsManager.updateSettings(normalized);
            if (normalized.insider?.wordFile && normalized.insider.wordFile !== previousWordFile) {
                gameSettingsManager.reloadInsiderWords();
            }

            addServerLog(io, 'admin', null, 'Admin บันทึกการตั้งค่าเกม (ทุกโหมด)', 'success');
            if (typeof callback === 'function') {
                callback({ success: true, ...gameSettingsManager.buildAdminPayload() });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('admin_addWords', function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }

            const { words, wordFile } = data || {};
            const fileId = wordFile || gameSettingsManager.getSettings().insider?.wordFile || 'famille';
            const result = gameSettingsManager.addWordsToFile(fileId, words || []);
            if (fileId === (gameSettingsManager.getSettings().insider?.wordFile || 'famille')) {
                gameSettingsManager.reloadInsiderWords();
            }

            addServerLog(io, 'admin', null, `Admin เพิ่มคำ Insider ${result.addedCount} คำ (${fileId}.csv)`, 'success');
            if (typeof callback === 'function') {
                callback({ success: true, addedCount: result.addedCount, total: result.total, wordFile: fileId });
            }
        } catch (error) {
            console.error('Error adding words:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('admin_setPlayerApproval', function(data, callback) {
        (async function() {
            try {
                if (!isAdminAuthenticated(socket.id)) {
                    if (typeof callback === 'function') {
                        callback({ success: false, error: 'Unauthorized' });
                    }
                    return;
                }
                const { playerId, approved } = data || {};
                if (!playerId) {
                    if (typeof callback === 'function') {
                        callback({ success: false, error: 'playerId required' });
                    }
                    return;
                }
                const player = await playerManager.setPlayerApproved(playerId, approved !== false);
                addServerLog(
                    io,
                    'admin',
                    null,
                    `Admin ${approved !== false ? 'อนุมัติ' : 'ยกเลิกอนุมัติ'} ${player.playerName}`,
                    'success'
                );
                if (typeof callback === 'function') {
                    callback({ success: true, playerId, approved: player.approved });
                }
            } catch (error) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: error.message });
                }
            }
        })();
    });

    socket.on('admin_getWords', function(data, callback) {
        try {
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }

            const fileId = (data && data.wordFile) || gameSettingsManager.getSettings().insider?.wordFile || 'famille';
            const words = gameSettingsManager.getWordsFromFile(fileId);
            callback({ success: true, words, wordFile: fileId });
        } catch (error) {
            console.error('Error getting words:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== GAME EVENTS (Modified to work with rooms) ==========

    // Initialize player (when joining board page)
    socket.on('initPlayer', function(playerId) {
        const boundPlayerId = bindSocketPlayer(socket, playerId);
        if (!boundPlayerId) {
            socket.emit('identityError', { message: 'เซสชันผู้เล่นไม่ตรงกัน กรุณารีเฟรชหน้า' });
            return;
        }
        const player = playerManager.getPlayer(boundPlayerId);
        if (player) {
            socket.playerName = player.playerName;
            socket.playerColor = player.color;
        }
    });

    // Set room context (when joining board page)
    socket.on('setRoom', function(data) {
        const roomId = typeof data === 'string' ? data : data?.roomId;
        const requestedPlayerId = typeof data === 'object' ? data?.playerId : null;
        const playerId = bindSocketPlayer(socket, requestedPlayerId || socket.playerId);
        
        if (!playerId) {
            console.error('setRoom called without playerId');
            return;
        }

        // ตรวจสอบว่า player มีอยู่จริง
        const validPlayer = playerManager.getPlayer(playerId);
        if (!validPlayer) {
            console.error('setRoom called with invalid playerId:', playerId);
            return;
        }
        
        // ยกเลิก disconnect timeout ถ้ามี (ผู้เล่น reconnect มาแล้ว)
        if (disconnectTimeouts.has(playerId)) {
            clearTimeout(disconnectTimeouts.get(playerId));
            disconnectTimeouts.delete(playerId);
            console.log(`[setRoom] Cancelled disconnect timeout for ${playerId}`);
        }
        
        socket.playerId = playerId;
        const room = roomManager.getRoom(roomId);
        if (room) {
            // เช็คว่าเป็นการเข้าใหม่หรือ reconnect/duplicate setRoom
            const playerInRoom = room.players.find(p => p.playerId === playerId);
            if (!playerInRoom) {
                console.warn(`[setRoom] Player ${playerId} is not a member of room ${roomId}`);
                io.to(socket.id).emit('kickedFromRoom', { message: 'คุณไม่ได้อยู่ในห้องนี้แล้ว' });
                socketRoomMap.delete(socket.id);
                return;
            }

            const wasOnline = playerInRoom && playerInRoom.socketId;
            const isDuplicate = playerInRoom && playerInRoom.socketId === socket.id;

            socket.roomId = roomId;
            socket.join(roomId);
            socketRoomMap.set(socket.id, roomId);
            
            // Make sure player is in room (in case they joined via HTTP redirect)
            roomManager.updatePlayerSocketId(roomId, playerId, socket.id);
            roomManager.markPlayerActive(roomId, playerId);
            
            // Emit room update to all
            io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(room));

            // Also refresh the global room list because onlineCount depends on socket binding.
            io.emit('roomListUpdate', roomManager.getAllRooms());

            // ส่ง chat notification เฉพาะกรณีเข้าใหม่จริงๆ (ไม่ใช่ reconnect หรือ duplicate)
            if (!wasOnline && !isDuplicate) {
                const player = playerManager.getPlayer(playerId);
                if (player) {
                    sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} เข้าห้อง`, '#3498db');
                    addServerLog(io, 'join', roomId, `${player.playerName} เข้าห้อง`, 'info');
                }
            }

            // Sync game state: ส่ง players array แบบเดิม
            const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
            if (gameStatePlayer && gameStatePlayer.role) {
                if (room.settings.gameMode === 'werewolf') {
                    emitWerewolfState(room, socket.id, playerId);
                    emitWerewolfChatHistory(room, socket.id, playerId);
                } else if (room.settings.gameMode === 'blackmarket') {
                    emitBlackMarketState(room, socket.id, playerId);
                } else if (room.settings.gameMode === 'spyfall') {
                    emitSpyfallState(room, socket.id, playerId);
                } else {
                    // Insider: resync ให้ตรงเฟสจริง (ไม่ replay role/startGame ผิดเฟส)
                    const gs = room.gameState;
                    const insiderStatus = gs.status;
                    if (insiderStatus === 'in_progress') {
                        // ช่วงคุย — คืนค่า countdown ที่เหลือ
                        let remaining = 0;
                        if (gs.countdownEndsAt) {
                            remaining = Math.max(0, Math.ceil((gs.countdownEndsAt - Date.now()) / 1000));
                        }
                        io.to(socket.id).emit('countdownUpdate', remaining);
                    } else if (insiderStatus === 'vote2') {
                        const numTraitors = gs.players.filter(p => p.role === traitorRole).length;
                        io.to(socket.id).emit('displayVote2', {
                            players: gs.players.filter(isNotGameMaster),
                            numTraitors: numTraitors,
                            progress: buildVote2Progress(gs)
                        });
                    } else if (insiderStatus === 'end' && gs.resultVote2) {
                        io.to(socket.id).emit('vote2Ended', gs.resultVote2);
                    } else if (insiderStatus === 'word' && gs.word) {
                        emitInsiderWordState(room, socket.id, playerId);
                    } else {
                        emitInsiderRoleState(room, socket.id, playerId);
                    }
                }
            }
        } else {
            io.to(socket.id).emit('roomClosed', { message: 'ห้องถูกปิดไปแล้ว' });
        }
    });

    socket.on('werewolf_requestState', function(data) {
        const room = getSocketRoom(socket, 'werewolf');
        const playerId = socket.playerId;
        if (!room || (data?.roomId && data.roomId !== room.roomId) || (data?.playerId && data.playerId !== playerId)) {
            return;
        }

        syncWerewolfPhaseTimer(room);
        emitWerewolfState(room, socket.id, playerId);
    });

    socket.on('spyfall_requestState', function(data) {
        const room = getSocketRoom(socket, 'spyfall');
        const playerId = socket.playerId;
        if (!room || (data?.roomId && data.roomId !== room.roomId) || (data?.playerId && data.playerId !== playerId)) {
            return;
        }

        syncSpyfallPhaseTimer(room);
        emitSpyfallState(room, socket.id, playerId);
    });

    socket.on('blackmarket_requestState', function(data) {
        const room = getSocketRoom(socket, 'blackmarket');
        const playerId = socket.playerId;
        if (!room || (data?.roomId && data.roomId !== room.roomId) || (data?.playerId && data.playerId !== playerId)) {
            return;
        }

        emitBlackMarketState(room, socket.id, playerId);
    });

    socket.on('werewolf_admin_request_roles', function(data, callback) {
        const roomId = data?.roomId || socket.roomId;
        const room = roomManager.getRoom(roomId);

        if (!room || room.settings.gameMode !== 'werewolf') {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'ไม่พบห้อง Werewolf' });
            }
            return;
        }

        const isSiteAdmin = isSiteAdminPlayer(socket.playerId);
        const canRevealFinishedRoom = room.gameState?.phase === 'finished' && isAdminSocket(room, socket);
        if (!isSiteAdmin && !canRevealFinishedRoom) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'เปิดดูบทบาทได้หลังจบเกมเท่านั้น (site admin ตรวจสอบได้ตลอด)' });
            }
            return;
        }

        io.to(socket.id).emit('werewolf_admin_roles', buildWerewolfAdminRevealPayload(room));
        if (typeof callback === 'function') {
            callback({ success: true });
        }
    });

    socket.on('werewolf_submitNightAction', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const targetPlayerId = data?.targetPlayerId;
            const actionType = data?.actionType || null;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId || !targetPlayerId) {
                throw new Error('ข้อมูล action ไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.submitNightAction(room, playerId, targetPlayerId, actionType);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_submitDayVote', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const targetPlayerId = data?.targetPlayerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId || !targetPlayerId) {
                throw new Error('ข้อมูลการโหวตไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.submitDayVote(room, playerId, targetPlayerId);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_revealMayor', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId) {
                throw new Error('ข้อมูลนายกไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.submitMayorReveal(room, playerId);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_clericBless', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const targetPlayerId = data?.targetPlayerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId || !targetPlayerId) {
                throw new Error('ข้อมูลพรของนักบวชไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.submitClericBless(room, playerId, targetPlayerId);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_skipDiscussion', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId) {
                throw new Error('ข้อมูลการกดข้ามไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.submitDiscussionSkip(room, playerId);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_skipNight', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId) {
                throw new Error('ข้อมูลการกดข้ามไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.submitNightSkip(room, playerId);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_useRevealAction', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const targetPlayerId = data?.targetPlayerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!playerId || !targetPlayerId) {
                throw new Error('ข้อมูลการเปิดโปงไม่ครบ');
            }

            const werewolfEngine = getGameEngine('werewolf');
            const result = werewolfEngine.useRevealAction(room, playerId, targetPlayerId);
            emitWerewolfRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('werewolf_restartGame', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'werewolf') {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            if (!isAdminSocket(room, socket)) {
                throw new Error('ต้องเป็นหัวหน้าห้องเท่านั้น');
            }

            clearWerewolfPhaseTimer(roomId);
            clearWerewolfTransitionTimer(roomId);
            roomManager.resetRoomGame(roomId);

            const refreshedRoom = roomManager.getRoom(roomId);
            if (!refreshedRoom) {
                throw new Error('ไม่พบห้อง Werewolf');
            }

            sendChatMessageToRoom(io, roomId, 'System', 'เริ่มรอบใหม่ กลับไปที่ห้องเพื่อพร้อมเล่นอีกครั้ง', '#9b59b6');
            io.to(roomId).emit('restartGame');
            io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom));
            io.emit('roomListUpdate', roomManager.getAllRooms());

            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('blackmarket_buyOffer', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const itemId = data?.itemId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'blackmarket') {
                throw new Error('ไม่พบตลาดนี้');
            }

            const blackMarketEngine = getGameEngine('blackmarket');
            const result = blackMarketEngine.submitMarketPurchase(room, playerId, itemId);

            // Server activity logs
            const player = room.players.find(p => p.playerId === playerId);
            const playerName = player ? player.playerName : playerId;
            const roundNum = room.gameState?.roundNumber || 1;
            addServerLog(io, 'game', roomId, `[BlackMarket] ${playerName} ซื้อของ: ${itemId === '__pass__' ? 'ผ่าน (ไม่ซื้อ)' : itemId} (ยกที่ ${roundNum})`, 'info', {
                gameMode: 'blackmarket',
                meta: { playerId, itemId, roundNumber: roundNum }
            });

            if (result.resolved) {
                addServerLog(io, 'game', roomId, `[BlackMarket] ตลาดปิดแล้ว! เริ่มช่วงลงมือ (ยกที่ ${roundNum})`, 'success', {
                    gameMode: 'blackmarket',
                    meta: { roundNumber: roundNum }
                });
            }

            emitBlackMarketState(room);
            runBotsForRoom(room).catch(console.error);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('blackmarket_submitAction', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'blackmarket') {
                throw new Error('ไม่พบโต๊ะนี้');
            }

            const blackMarketEngine = getGameEngine('blackmarket');
            const result = blackMarketEngine.submitAction(
                room,
                playerId,
                data?.actionType,
                data?.targetPlayerId || null,
                data?.itemId || null
            );

            // Server activity logs
            const player = room.players.find(p => p.playerId === playerId);
            const playerName = player ? player.playerName : playerId;
            const roundNum = room.gameState?.roundNumber || 1;
            const targetPlayer = data?.targetPlayerId ? (room.players.find(p => p.playerId === data.targetPlayerId)?.playerName || data.targetPlayerId) : null;
            const targetText = targetPlayer ? ` เล็งเป้า: ${targetPlayer}` : '';
            const itemText = data?.itemId ? ` ของ: ${data.itemId}` : '';
            addServerLog(io, 'game', roomId, `[BlackMarket] ${playerName} ล็อกแผน: ${data?.actionType}${targetText}${itemText} (ยกที่ ${roundNum})`, 'info', {
                gameMode: 'blackmarket',
                meta: { playerId, actionType: data?.actionType, targetPlayerId: data?.targetPlayerId, itemId: data?.itemId, roundNumber: roundNum }
            });

            if (result.resolved) {
                addServerLog(io, 'game', roomId, `[BlackMarket] ล็อกแผนครบทุกคน! สรุปผลยกที่ ${roundNum}`, 'success', {
                    gameMode: 'blackmarket',
                    meta: { roundNumber: roundNum }
                });
                if (room.gameState.lastRoundReport && room.gameState.lastRoundReport.length) {
                    room.gameState.lastRoundReport.forEach(reportItem => {
                        addServerLog(io, 'game', roomId, `[BlackMarket] สรุปยก ${roundNum}: ${reportItem.text}`, 'info', {
                            gameMode: 'blackmarket',
                            meta: { roundNumber: roundNum, icon: reportItem.icon }
                        });
                    });
                }
            }

            emitBlackMarketState(room);
            runBotsForRoom(room).catch(console.error);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('blackmarket_restartGame', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'blackmarket') {
                throw new Error('ไม่พบโต๊ะนี้');
            }

            if (!isAdminSocket(room, socket)) {
                throw new Error('มีแค่หัวหน้าห้องที่สั่งเปิดเมืองใหม่ได้');
            }

            roomManager.resetRoomGame(roomId);

            const refreshedRoom = roomManager.getRoom(roomId);
            if (!refreshedRoom) {
                throw new Error('ไม่พบโต๊ะนี้');
            }

            sendChatMessageToRoom(io, roomId, 'System', 'รอบนี้จบแล้ว กลับไปตั้งเกมใหม่ในห้อง', '#9b59b6');
            io.to(roomId).emit('restartGame');
            io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom));
            io.emit('roomListUpdate', roomManager.getAllRooms());

            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('blackmarket_addBots', async function(data, callback) {
        try {
            const roomId = socket.roomId;
            const adminPlayerId = socket.playerId;
            const room = roomManager.getRoom(roomId);
            
            if (!room) {
                throw new Error('ไม่พบห้อง');
            }
            if (room.admin !== adminPlayerId) {
                throw new Error('เฉพาะหัวหน้าห้องเท่านั้นที่เพิ่มบอทได้');
            }
            if (room.settings.gameMode !== 'blackmarket') {
                throw new Error('โหมดนี้ไม่รองรับบอท');
            }
            if (roomManager.isRoomGameInProgress(room)) {
                throw new Error('เกมเริ่มไปแล้ว ไม่สามารถเพิ่มบอทได้');
            }

            const needed = Math.max(0, 4 - room.players.length);
            if (needed === 0) {
                throw new Error('ห้องมีผู้เล่นพอสำหรับเริ่มเกมแล้ว');
            }

            const botNames = ['บอทสมชาย 🤖', 'บอทสมหญิง 🤖', 'บอทสมศักดิ์ 🤖', 'บอทวิชัย 🤖', 'บอทปราณี 🤖'];
            const botAvatars = ['🤖', '👻', '🦊', '🐼', '👽'];
            const botColors = ['#f39c12', '#9b59b6', '#e74c3c', '#2ecc71', '#1abc9c'];

            for (let i = 0; i < needed; i++) {
                const botId = `bot_${uuidv4()}`;
                const botName = botNames[i % botNames.length] + ' ' + botId.substring(botId.length - 4);
                
                // Create player
                await playerManager.createOrGetPlayer(botId, { approved: true });
                await playerManager.updatePlayerName(botId, botName);
                await playerManager.updatePlayerColor(botId, botColors[i % botColors.length]);
                await playerManager.updatePlayerAvatar(botId, botAvatars[i % botAvatars.length]);

                // Join the bot to the room
                const botSocketId = `bot_socket_${uuidv4()}`;
                roomManager.joinRoom(roomId, botId, botSocketId, null, { bypassLock: true });
            }

            // Broadcast roomUpdate
            io.to(roomId).emit('roomUpdate', {
                ...buildRoomUpdatePayload(room)
            });
            io.emit('roomListUpdate', roomManager.getAllRooms());

            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            console.error('Error adding bots:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('spyfall_endDiscussion', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'spyfall') {
                throw new Error('ไม่พบเกมนี้');
            }

            if (!isAdminSocket(room, socket)) {
                throw new Error('มีแค่หัวหน้าห้องที่จบช่วงคุยได้');
            }

            const spyfallEngine = getGameEngine('spyfall');
            const result = spyfallEngine.endDiscussionEarly(room);
            emitSpyfallRoomState(room);

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('spyfall_vote', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const playerId = socket.playerId;
            const targetPlayerId = data?.targetPlayerId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'spyfall') {
                throw new Error('ไม่พบเกมนี้');
            }

            const spyfallEngine = getGameEngine('spyfall');
            const result = spyfallEngine.submitVote(room, playerId, targetPlayerId);

            if (result.resolved && room.gameState.phase === 'finished') {
                emitSpyfallRoomState(room);
            } else {
                emitSpyfallState(room);
            }

            if (typeof callback === 'function') {
                callback({ success: true, ...result });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    socket.on('spyfall_restartGame', function(data, callback) {
        try {
            const roomId = socket.roomId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'spyfall') {
                throw new Error('ไม่พบเกมนี้');
            }

            if (!isAdminSocket(room, socket)) {
                throw new Error('มีแค่หัวหน้าห้องที่จบเกมได้');
            }

            clearSpyfallPhaseTimer(roomId);
            clearSpyfallReturnTimer(roomId);
            roomManager.resetRoomGame(roomId);

            const refreshedRoom = roomManager.getRoom(roomId);
            if (!refreshedRoom) {
                throw new Error('ไม่พบเกมนี้');
            }

            sendChatMessageToRoom(io, roomId, 'System', 'รอบ Spyfall จบแล้ว กลับไปตั้งเกมใหม่ในห้อง', '#1abc9c');
            io.to(roomId).emit('restartGame');
            io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(refreshedRoom));
            io.emit('roomListUpdate', roomManager.getAllRooms());

            if (typeof callback === 'function') {
                callback({ success: true });
            }
        } catch (error) {
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Start game from lobby (redirect all players to game board)
    socket.on('startGameFromLobby', function(data, callback) {
        try {
            const roomId = socket.roomId;
            if (!roomId) {
                if (typeof callback === 'function') callback({ success: false, error: 'ไม่พบห้อง' });
                return;
            }

            const room = roomManager.getRoom(roomId);
            if (!room) {
                if (typeof callback === 'function') callback({ success: false, error: 'ห้องไม่มีอยู่แล้ว' });
                return;
            }

            // ตรวจสอบสิทธิ์ admin
            if (!isAdminSocket(room, socket)) {
                if (typeof callback === 'function') callback({ success: false, error: 'ต้องเป็น admin เท่านั้น' });
                return;
            }

            // ตรวจสอบจำนวนผู้เล่นตามโหมดเกม
            const onlinePlayers = room.players.filter(p => p.socketId);
            const currentEngine = getGameEngine(room.settings.gameMode);
            const requiredPlayers = Number(currentEngine?.minPlayers || 3);
            if (onlinePlayers.length < requiredPlayers) {
                if (typeof callback === 'function') callback({ success: false, error: `ต้องมีผู้เล่นออนไลน์อย่างน้อย ${requiredPlayers} คน` });
                return;
            }

            // ป้องกันกดซ้ำ
            if (room.gameStarting) {
                if (typeof callback === 'function') callback({ success: false, error: 'เกมกำลังเริ่มอยู่แล้ว' });
                return;
            }
            room.gameStarting = true;

            // แจ้งให้ทุกคนรู้ว่ากำลังจะเริ่มเกม (แสดง countdown)
            io.to(roomId).emit('gameStartingCountdown', { countdown: 3 });
            onlinePlayers.forEach(p => {
                if (p.socketId) {
                    io.to(p.socketId).emit('gameStartingCountdown', { countdown: 3 });
                }
            });

            // รอ 3 วินาทีให้ผู้เล่นทุกคน sync ก่อนเริ่มเกมจริง
            setTimeout(() => {
                try {
                // ตรวจสอบอีกครั้งหลังรอ
                const currentRoom = roomManager.getRoom(roomId);
                if (!currentRoom) {
                    room.gameStarting = false;
                    return;
                }

                const currentOnlinePlayers = currentRoom.players.filter(p => p.socketId);
                if (currentOnlinePlayers.length < requiredPlayers) {
                    io.to(roomId).emit('gameStartCancelled', { error: `ผู้เล่นไม่ครบ ${requiredPlayers} คน` });
                    room.gameStarting = false;
                    return;
                }

                if (currentRoom.settings.gameMode === 'werewolf') {
                    const werewolfEngine = getGameEngine('werewolf');
                    clearWerewolfTransitionTimer(roomId);
                    werewolfEngine.startGame(currentRoom);
                    currentRoom.chatHistory = (currentRoom.chatHistory || []).filter(entry => entry.playerName !== 'System');
                    currentRoom.werewolfChatHistory = [];

                    io.to(roomId).emit('gameStarting', { roomId: roomId });
                    currentOnlinePlayers.forEach(p => {
                        if (p.socketId) {
                            io.to(p.socketId).emit('gameStarting', { roomId: roomId });
                        }
                    });

                    sendChatMessageToRoom(io, roomId, 'System', 'เกม Werewolf เริ่มแล้ว คืนแรกกำลังเริ่ม ทุกคนเช็กบทของตัวเองได้เลย', '#2ecc71');
                    logGameStartFromRoom(currentRoom);
                    emitWerewolfRoomState(currentRoom);
                    room.gameStarting = false;
                    return;
                }

                if (currentRoom.settings.gameMode === 'blackmarket') {
                    const blackMarketEngine = getGameEngine('blackmarket');
                    blackMarketEngine.startGame(currentRoom);
                    currentRoom.chatHistory = (currentRoom.chatHistory || []).filter(entry => entry.playerName !== 'System');

                    io.to(roomId).emit('gameStarting', { roomId: roomId });
                    currentOnlinePlayers.forEach(p => {
                        if (p.socketId) {
                            io.to(p.socketId).emit('gameStarting', { roomId: roomId });
                        }
                    });

                    sendChatMessageToRoom(io, roomId, 'System', 'ตลาดมืดเปิดแล้ว รีบล็อกของก่อนคู่แข่งจะคว้าไป', '#f39c12');
                    logGameStartFromRoom(currentRoom);
                    emitBlackMarketState(currentRoom);

                    // Trigger bots after 5 seconds to let the human client redirect and load
                    setTimeout(() => {
                        const r = roomManager.getRoom(roomId);
                        if (r) runBotsForRoom(r).catch(console.error);
                    }, 5000);

                    room.gameStarting = false;
                    return;
                }

                if (currentRoom.settings.gameMode === 'spyfall') {
                    const spyfallEngine = getGameEngine('spyfall');
                    clearSpyfallPhaseTimer(roomId);
                    clearSpyfallReturnTimer(roomId);
                    spyfallEngine.startGame(currentRoom);
                    currentRoom.chatHistory = (currentRoom.chatHistory || []).filter(entry => entry.playerName !== 'System');

                    io.to(roomId).emit('gameStarting', { roomId: roomId });
                    currentOnlinePlayers.forEach(p => {
                        if (p.socketId) {
                            io.to(p.socketId).emit('gameStarting', { roomId: roomId });
                        }
                    });

                    sendChatMessageToRoom(io, roomId, 'System', 'เกมสายลับเริ่มแล้ว — จำสถานที่หรือเล่นให้เนียน', '#1abc9c');
                    logGameStartFromRoom(currentRoom);
                    emitSpyfallRoomState(currentRoom);
                    currentRoom.gameStarting = false;
                    return;
                }

                // สุ่มบทบาทก่อนเริ่มเกม
                randomRoles(currentRoom.gameState, currentRoom.settings);
                currentRoom.gameState.status = 'role';
                // ตั้งคำอัตโนมัติทันที (GM ยังแก้ได้ก่อนเปิดเผย)
                currentRoom.gameState.word = getWord(getInsiderWordPool());
                console.log('[startGameFromLobby] Auto-set word:', currentRoom.gameState.word);

                // ส่งบทบาทแบบส่วนตัวให้แต่ละคน (ไม่ broadcast)
                console.log('[startGameFromLobby] Sending roles to', currentRoom.players.length, 'players');
                currentRoom.players.forEach(p => {
                    if (p.socketId) {
                        const gamePlayer = currentRoom.gameState.players.find(gp => gp.playerId === p.playerId);
                        if (gamePlayer) {
                            console.log(`[startGameFromLobby] Sending role to ${p.playerName} (${p.socketId}): ${gamePlayer.role}`);
                            io.to(p.socketId).emit('newRole', {
                                role: gamePlayer.role,
                                isGhost: !!gamePlayer.isGhost,
                                status: currentRoom.gameState.status,
                                dualTraitorMode: !!currentRoom.settings.dualTraitorMode,
                                numTraitors: currentRoom.gameState.players.filter(candidate => candidate.role === traitorRole).length
                            });
                        } else {
                            console.log(`[startGameFromLobby] WARNING: No gamePlayer found for ${p.playerName}`);
                        }
                    } else {
                        console.log(`[startGameFromLobby] WARNING: No socketId for ${p.playerName}`);
                    }
                });

                // ส่ง event ให้ทุกคนใน room redirect ไปหน้าเกม
                // ส่ง 2 ทางเพื่อกันเคส client บางตัวไม่ได้ join socket.io room จริงๆ
                // 1) Broadcast ไปที่ socket.io room
                io.to(roomId).emit('gameStarting', { roomId: roomId });

                // 2) ยิงตรงไปที่ socketId ของผู้เล่นออนไลน์ทุกคน
                currentOnlinePlayers.forEach(p => {
                    if (p.socketId) {
                        io.to(p.socketId).emit('gameStarting', { roomId: roomId });
                    }
                });

                const insiderModeMsg = currentRoom.settings.dualTraitorMode ? ' · โหมด 2 จอมบงการ' : '';
                sendChatMessageToRoom(io, roomId, 'System', `เกม Insider เริ่มแล้ว${insiderModeMsg}`, '#9b59b6');
                logGameStartFromRoom(currentRoom, insiderModeMsg);

                room.gameStarting = false;
                } catch (deferredError) {
                    // ถ้า startGame ล้มกลางคัน ต้องปลดธง gameStarting เสมอ
                    // ไม่งั้นห้องนี้กดเริ่มเกมไม่ได้อีกเลย (ติด "เกมกำลังเริ่มอยู่แล้ว" ถาวร)
                    console.error('Error in deferred game start:', deferredError);
                    room.gameStarting = false;
                    io.to(roomId).emit('gameStartCancelled', { error: deferredError.message || 'เริ่มเกมไม่สำเร็จ ลองใหม่อีกครั้ง' });
                }
            }, 3000); // รอ 3 วินาที
            
            if (typeof callback === 'function') callback({ success: true, message: 'เกมจะเริ่มใน 3 วินาที...' });
        } catch (error) {
            console.error('Error starting game from lobby:', error);
            if (typeof callback === 'function') callback({ success: false, error: error.message });
        }
    });

    // Admin request word and roles
    socket.on('admin_request_word_roles', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        if (!isAdminSocket(room, socket) && !isSiteAdminPlayer(socket.playerId)) return;

        io.to(socket.id).emit('admin_word_roles', {
            word: room.gameState.word,
            players: room.gameState.players.map(p => ({ name: buildDisplayPlayerName(p.playerId, p.name), role: p.role }))
        });
    });

    // Reset game (start new round)
    socket.on('resetGame', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        if (!isAdminSocket(room, socket)) {
            io.to(socket.id).emit('notAuthorized', { message: 'ต้องเป็นแอดมินเท่านั้น' });
            return;
        }

        if (!actionAllowedCooldown(room.gameState, 2)) {
            return;
        }

        // Clear existing countdown
        if (roomCountdowns.has(roomId)) {
            clearInterval(roomCountdowns.get(roomId));
            roomCountdowns.delete(roomId);
        }

        randomRoles(room.gameState, room.settings);
        room.gameState.word = getWord(getInsiderWordPool());
        room.gameState.status = 'role';
        
        // นับจำนวนจอมบงการในเกมนี้
        const numTraitors = room.gameState.players.filter(p => p.role === traitorRole).length;

        emitInsiderRoleState(room);
        
        // Send chat notification
        const modeMsg = numTraitors === 2 ? ' (โหมด 2 จอมบงการ!)' : '';
        sendChatMessageToRoom(io, roomId, 'System', `เริ่มเกมใหม่! บทบาทถูกสุ่มแล้ว${modeMsg}`, '#9b59b6');
        logGameStartFromRoom(room, modeMsg);
    });

    // Reveal word (only GM can do this, and only after word is set)
    socket.on('revealWord', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;
        
        // เช็คว่าเป็น GM หรือไม่
        const playerId = socket.playerId;
        const player = room.gameState.players.find(p => p.playerId === playerId);
        if (!player || player.role !== gameMasterRole) {
            console.log('[revealWord] Not game master, playerId:', playerId);
            return;
        }
        
        // เช็คว่ามี word แล้วหรือยัง
        if (!room.gameState.word) {
            console.log('[revealWord] No word set yet');
            io.to(socket.id).emit('error', { message: 'กรุณาตั้งคำก่อน' });
            return;
        }

        room.gameState.status = 'word';
        emitInsiderWordState(room);
        
        // Send chat notification
        sendChatMessageToRoom(io, roomId, 'System', 'คำได้ถูกเปิดเผยแล้ว', '#3498db');
        addServerLog(io, 'game', roomId, `📝 คำเปิดเผย: ${room.gameState.word}`, 'info', {
            gameMode: room.settings.gameMode,
            meta: { word: room.gameState.word, event: 'word_revealed' }
        });
    });

    // Get 5 random word suggestions for GM to choose from
    socket.on('getWordSuggestions', function(data, callback) {
        const roomId = socket.roomId;
        if (!roomId) {
            if (typeof callback === 'function') callback({ ok: false, error: 'not_in_room' });
            return;
        }
        const room = roomManager.getRoom(roomId);
        if (!room) {
            if (typeof callback === 'function') callback({ ok: false, error: 'room_not_found' });
            return;
        }
        const playerId = socket.playerId;
        const me = room.gameState.players.find(p => p.playerId === playerId);
        if (!me || me.role !== gameMasterRole) {
            if (typeof callback === 'function') callback({ ok: false, error: 'not_game_master' });
            return;
        }

        // สุ่ม 5 คำโดยไม่ซ้ำกัน
        const pool = [...getInsiderWordPool()];
        const suggestions = [];
        while (suggestions.length < 5 && pool.length > 0) {
            const idx = Math.floor(Math.random() * pool.length);
            suggestions.push(pool.splice(idx, 1)[0]);
        }

        if (typeof callback === 'function') callback({ ok: true, words: suggestions });
    });

    // Set word
    socket.on('setWord', function(data, callback) {
        const roomId = socket.roomId;
        if (!roomId) {
            if (typeof callback === 'function') callback({ ok: false, error: 'not_in_room' });
            return;
        }

        const room = roomManager.getRoom(roomId);
        if (!room) {
            if (typeof callback === 'function') callback({ ok: false, error: 'room_not_found' });
            return;
        }

        const playerId = socket.playerId;
        if (!playerId) {
            if (typeof callback === 'function') callback({ ok: false, error: 'not_authenticated' });
            return;
        }

        const me = room.gameState.players.find(p => p.playerId === playerId);
        if (!me || me.role !== gameMasterRole) {
            if (typeof callback === 'function') callback({ ok: false, error: 'not_game_master' });
            return;
        }

        let wordToSet = '';
        if (data && typeof data.word === 'string' && data.word.trim() !== '') {
            wordToSet = data.word.trim();
            if (wordToSet.length > 100) {
                if (typeof callback === 'function') callback({ ok: false, error: 'คำต้องไม่เกิน 100 ตัวอักษร' });
                return;
            }
        } else {
            wordToSet = getWord(getInsiderWordPool());
            if (!wordToSet) {
                if (typeof callback === 'function') callback({ ok: false, error: 'no_word_available' });
                return;
            }
        }
        
        room.gameState.word = wordToSet;
        
        if (typeof callback === 'function') callback({ ok: true });
    });

    // Word found - ไปโหวต 2 เลย (ตัดโหวต 1 ออก)
    socket.on('wordFound', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        // ต้องเป็น admin เท่านั้นที่จะกดหยุดเกมได้
        if (!isAdminSocket(room, socket)) return;

        // ไปโหวต 2 เลย ไม่ต้องผ่านโหวต 1 (ใช้ helper เดียวกับ timeout)
        advanceInsiderToVote2(io, room);
    });

    // Display vote2 (vote1 ถูกตัดออกแล้ว - ไปโหวต 2 เลยตอน wordFound)
    socket.on('displayVote2', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        // ต้องเป็น admin เท่านั้น
        if (!isAdminSocket(room, socket)) return;

        resetVote(room.gameState, 2);
        const numTraitors = room.gameState.players.filter(p => p.role === traitorRole).length;
        io.to(roomId).emit('displayVote2', {
            players: buildInsiderVoteCandidates(room.gameState),
            numTraitors: numTraitors
        });
        room.gameState.status = 'vote2';
    });

    // Vote1
    socket.on('vote1', function(object) {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        const playerId = socket.playerId;
        if (!playerId) return;

        if (!object || typeof object !== 'object') return;
        const player = room.gameState.players.find(p => p.playerId === playerId);
        if (!player || object.player !== player.name) return;

        // ตรวจสอบสถานะเกม
        if (room.gameState.status !== 'vote1') {
            console.log(`[vote1] Wrong game status: ${room.gameState.status}`);
            return;
        }

        // ป้องกันโหวตซ้ำ (double-check with lock flag)
        if (player.vote1 !== null || player._votingInProgress1) {
            console.log(`[vote1] Player ${player.name} already voted or voting in progress`);
            return;
        }
        player._votingInProgress1 = true;

        player.vote1 = object.vote;
        player._votingInProgress1 = false;

        if(everybodyHasVoted(room.gameState, 1)) {
            processVote1Result(room.gameState);
            io.to(roomId).emit('vote1Ended', room.gameState.resultVote1);
            room.gameState.status = 'vote2';
        }
    });

    // Vote2
    socket.on('vote2', function(object) {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        const playerId = socket.playerId;
        if (!playerId) return;

        if (!object || typeof object !== 'object' || Array.isArray(object)) {
            io.to(socket.id).emit('voteError', { message: 'รูปแบบคะแนนไม่ถูกต้อง กรุณาเลือกใหม่' });
            return;
        }

        const player = room.gameState.players.find(p => p.playerId === playerId);
        if (!player || player.role === gameMasterRole || player.isGhost || object.player !== player.name) return;

        // ตรวจสอบสถานะเกม
        if (room.gameState.status !== 'vote2') {
            console.log(`[vote2] Wrong game status: ${room.gameState.status}`);
            return;
        }

        // ป้องกันโหวตซ้ำ (double-check with lock flag)
        if (player.vote2 !== null || player._votingInProgress2) {
            console.log(`[vote2] Player ${player.name} already voted or voting in progress`);
            return;
        }
        const expectedChoices = room.gameState.players.filter(candidate => candidate.role === traitorRole).length;
        const rawChoices = Array.isArray(object.votes) ? object.votes : [object.vote];
        const candidates = buildInsiderVoteCandidates(room.gameState);
        const candidateByKey = new Map();
        candidates.forEach(candidate => {
            candidateByKey.set(candidate.playerId, candidate.playerId);
            candidateByKey.set(candidate.name, candidate.playerId);
        });
        const normalizedChoices = rawChoices.map(choice => candidateByKey.get(choice)).filter(Boolean);
        const uniqueChoices = Array.from(new Set(normalizedChoices));

        if (uniqueChoices.length !== expectedChoices || rawChoices.length !== expectedChoices) {
            io.to(socket.id).emit('voteError', {
                message: expectedChoices === 2 ? 'เลือกผู้ต้องสงสัย 2 คนและห้ามเลือกซ้ำ' : 'เลือกผู้ต้องสงสัย 1 คน'
            });
            return;
        }

        player._votingInProgress2 = true;
        player.vote2 = expectedChoices === 1 ? uniqueChoices[0] : uniqueChoices;
        player._votingInProgress2 = false;

        io.to(roomId).emit('vote2Progress', buildVote2Progress(room.gameState));

        if(everybodyHasVoted(room.gameState, 2)) {
            processVote2Result(room.gameState);
            io.to(roomId).emit('vote2Ended', room.gameState.resultVote2);
            room.gameState.status = 'end';

            // Record statistics (including game history)
            statsManager.recordGameEnd(roomId, {
                resultVote2: room.gameState.resultVote2,
                players: room.gameState.players,
                word: room.gameState.word,
                roomName: room.name || roomId
            });

            notifyGameEndAfterRecord(room);

            // Auto return to lobby after 5 seconds
            setTimeout(() => {
                io.to(roomId).emit('returnToLobby', { countdown: 5, roomId: roomId });
                
                // Reset game state for this room so it can be played again
                room.gameState = {
                    players: room.gameState.players.map(p => ({
                        playerId: p.playerId,
                        socketId: p.socketId,
                        name: p.name,
                        room: p.room,
                        permission: p.permission, // เก็บ permission ไว้!
                        color: p.color,
                        avatar: p.avatar || '👤',
                        avatarFrame: p.avatarFrame || 'none',
                        isGhost: !!p.isGhost,
                        role: null,
                        vote1: null,
                        vote2: null,
                        nbVote2: 0
                    })),
                    word: null,
                    status: '',
                    resultVote1: null,
                    resultVote2: null
                };
                
                // Redirect all players to lobby after 5 more seconds
                setTimeout(() => {
                    io.to(roomId).emit('redirectToLobby', { roomId: roomId });
                }, 5000);
            }, 3000);
        }
    });

    // Start game
    socket.on('startGame', function() {
        console.log('[startGame] Received from socket:', socket.id);
        console.log('[startGame] socket.roomId:', socket.roomId, 'socket.playerId:', socket.playerId);
        
        const roomId = socket.roomId;
        if (!roomId) {
            console.log('[startGame] No roomId, ignoring');
            return;
        }

        const room = roomManager.getRoom(roomId);
        if (!room) {
            console.log('[startGame] Room not found:', roomId);
            return;
        }
        
        console.log('[startGame] Room admin:', room.admin, 'Socket playerId:', socket.playerId);

        if (!isAdminSocket(room, socket)) {
            console.log('[startGame] Not admin, rejecting');
            io.to(socket.id).emit('notAuthorized', { message: 'ต้องเป็นแอดมินเท่านั้น' });
            return;
        }

        if (!actionAllowedCooldown(room.gameState, 2)) {
            console.log('[startGame] Cooldown active, ignoring');
            return;
        }

        let counter = room.settings.roundTime || 300;
        // เก็บเวลาหมดไว้เพื่อ resync ตอน reconnect/reload
        room.gameState.countdownEndsAt = Date.now() + counter * 1000;
        
        // Clear existing countdown
        if (roomCountdowns.has(roomId)) {
            clearInterval(roomCountdowns.get(roomId));
        }

        // Emit initial countdown value immediately
        io.to(roomId).emit('countdownUpdate', counter);
        console.log('[startGame] Initial countdown:', counter);

        const countdownInterval = setInterval(function() {
            counter--;
            io.to(roomId).emit('countdownUpdate', counter);
            if (counter <= 0) {
                clearInterval(countdownInterval);
                roomCountdowns.delete(roomId);
                room.gameState.countdownEndsAt = null;
                console.log('[startGame] Countdown finished for room:', roomId);
                // หมดเวลาคุย → เข้าโหวตจับจอมบงการอัตโนมัติ (กันเกมค้างถ้าแอดมินไม่กดหยุด)
                if (room.gameState.status === 'in_progress') {
                    sendChatMessageToRoom(io, roomId, 'System', 'หมดเวลาคุย — เริ่มโหวตจับจอมบงการ', '#f39c12');
                    advanceInsiderToVote2(io, room);
                }
            }
        }, 1000);

        roomCountdowns.set(roomId, countdownInterval);
        room.gameState.countdown = countdownInterval;

        io.to(roomId).emit('startGame', {});
        console.log('[startGame] Game started in room:', roomId);
        room.gameState.status = 'in_progress';
        
        // Send chat notification
        sendChatMessageToRoom(io, roomId, 'System', 'เกมเริ่มแล้ว!', '#2ecc71');
    });

    // Send message
    socket.on('sendMessage', function(data) {
        const roomId = socket.roomId;
        if (!roomId) return;

        const playerId = socket.playerId;
        if (!playerId) return;

        const player = playerManager.getPlayer(playerId);
        if (!player) return;
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        roomManager.markPlayerActive(roomId, playerId);

        // XSS Protection: sanitize message (escape HTML special chars only, preserve Thai/Unicode)
        let safeMessage = data.message;
        if (typeof safeMessage !== 'string') return;
        safeMessage = safeMessage.trim();
        if (safeMessage.length === 0 || safeMessage.length > 500) return; // ป้องกัน spam
        // Escape only HTML special characters: < > & " '
        safeMessage = safeMessage
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        safeMessage = gameSettingsManager.filterProfanity(safeMessage);

        if (room.settings.gameMode === 'werewolf') {
            const gamePlayer = room.gameState?.players?.find(candidate => candidate.playerId === playerId);
            if (!gamePlayer) {
                io.to(socket.id).emit('chatError', { message: 'ไม่พบสถานะผู้เล่นในเกม Werewolf' });
                return;
            }

            if (gamePlayer.alive === false && !room.gameState?.winner) {
                io.to(socket.id).emit('chatError', { message: 'คุณตายแล้ว จึงส่งข้อความในเกมนี้ไม่ได้' });
                return;
            }

            if (room.gameState?.phase === 'night') {
                if (!isWerewolfNightChatEligible(room, playerId)) {
                    io.to(socket.id).emit('chatError', { message: 'ตอนกลางคืนมีเฉพาะหมาป่าที่ยังมีชีวิตเท่านั้นที่คุยกันเองได้' });
                    return;
                }

                sendWerewolfNightTeamMessage(io, room, player, safeMessage, data.replyTo);
                return;
            }
        }

        sendChatMessageToRoom(io, roomId, player.playerName, safeMessage, player.color, data.replyTo, playerId, player.avatar || '👤', player.avatarFrame || 'none');
    });

    // GM Quick Reaction (ผู้ดำเนินเกมตอบด่วน)
    socket.on('gmReaction', function(data) {
        const roomId = socket.roomId;
        if (!roomId) return;

        const playerId = socket.playerId;
        if (!playerId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        // ตรวจสอบว่าเป็นผู้ดำเนินเกมจริงหรือไม่
        const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
        if (!gameStatePlayer || gameStatePlayer.role !== 'ผู้ดำเนินเกม') {
            return; // ไม่ใช่ผู้ดำเนินเกม
        }

        // ส่ง reaction ไปให้ทุกคนในห้อง
        io.to(roomId).emit('gmReactionReceived', {
            targetMessageId: data.targetMessageId,
            reactionType: data.reactionType, // 'yes', 'no', 'maybe'
            gmName: data.playerName
        });
    });

    // Disconnect
    socket.on('disconnect', function() {
        // ลบออกจาก adminSockets ถ้าเป็น admin
        adminSockets.delete(socket.id);
        
        const roomId = socket.roomId;
        const playerId = socket.playerId;

        if (roomId && playerId) {
            // เช็คว่า player มี socket อื่นที่ยัง active อยู่หรืสไม่ (เช่น เปิดหลายแท็บ)
            const hasOtherActiveSockets = Array.from(io.sockets.sockets.values()).some(
                s => s.playerId === playerId && s.id !== socket.id && s.connected
            );
            
            if (hasOtherActiveSockets) {
                console.log(`[Disconnect] Player ${playerId} has other active sockets, skipping cleanup`);
                socketRoomMap.delete(socket.id);
                return;
            }
            
            // แค่เคลียร์ socketId ไม่ลบผู้เล่นออก (รอให้ reconnect)
            const updatedRoom = roomManager.disconnectPlayer(roomId, playerId);
            if (updatedRoom) {
                // ส่ง roomUpdate ทันที (เพื่ออัปเดต online status)
                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));

                // ตั้ง timeout ก่อนส่งข้อความ "หลุดการเชื่อมต่อ" และลบผู้เล่นออกจากห้อง
                const player = playerManager.getPlayer(playerId);
                if (player) {
                    // ยกเลิก timeout เก่าถ้ามี
                    if (disconnectTimeouts.has(playerId)) {
                        clearTimeout(disconnectTimeouts.get(playerId));
                    }
                    
                    const timeout = setTimeout(() => {
                        // เช็คว่ายังไม่ได้ reconnect จริงๆ (ยังไม่มี socketId ใหม่)
                        const currentRoom = roomManager.getRoom(roomId);
                        if (currentRoom) {
                            const playerInRoom = currentRoom.players.find(p => p.playerId === playerId);
                            if (playerInRoom && !playerInRoom.socketId) {
                                // ส่งข้อความแจ้งว่าหลุดการเชื่อมต่อ
                                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} หลุดการเชื่อมต่อ`, '#95a5a6');
                                
                                const removeDelayMs = roomManager.getDisconnectRemoveMs(currentRoom);
                                const removeTimeout = setTimeout(() => {
                                    const roomCheck = roomManager.getRoom(roomId);
                                    if (roomCheck) {
                                        const stillDisconnected = roomCheck.players.find(p => p.playerId === playerId && !p.socketId);
                                        if (stillDisconnected) {
                                            const updatedRoom = roomManager.leaveRoom(roomId, playerId);
                                            if (updatedRoom) {
                                                handleMidGamePlayerRemoval(updatedRoom, playerId);
                                                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} ออกจากห้อง (Timeout)`, '#e74c3c');
                                                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));
                                                // อัปเดต state เกมให้ client ไม่ค้างผู้เล่นที่ออกไปแล้วกลางเกม
                                                broadcastGameStateForRoom(updatedRoom);
                                                io.emit('roomListUpdate', roomManager.getAllRooms());
                                            } else {
                                                io.emit('roomListUpdate', roomManager.getAllRooms());
                                            }
                                            console.log(`[Timeout] Removed player ${player.playerName} from room ${roomId}`);
                                        }
                                    }
                                }, removeDelayMs);
                            }
                        }
                        disconnectTimeouts.delete(playerId);
                    }, 10000); // รอ 10 วินาที (เพิ่มจาก 3s เพื่อรองรับ mobile reconnect)
                    
                    disconnectTimeouts.set(playerId, timeout);
                }
            }

            io.emit('roomListUpdate', roomManager.getAllRooms());
        }

        socketRoomMap.delete(socket.id);
        console.log('Socket disconnected:', socket.id);
    });
});

// ==================== 404 ERROR HANDLER ====================
// ต้องอยู่หลัง routes ทั้งหมด
app.use(async function(req, res) {
    const playerId = req.playerId || req.query.playerId;
    res.status(404).render('error.ejs', { 
        playerId: playerId,
        message: 'ไม่พบหน้าที่คุณต้องการ',
        redirectUrl: playerId ? '/?playerId=' + playerId : '/'
    });
});

// ==================== SERVER START ====================

const PORT = process.env.PORT || 8080;

// Initialize database and start server
function onServerListening() {
    console.log(`Server started on port ${PORT}`);
    console.log('Multi-Room Insider Game is ready!');

    serverLogs.unshift({
        id: Date.now() + '-startup',
        timestamp: new Date().toISOString(),
        category: 'system',
        roomId: null,
        roomName: 'ระบบ',
        gameMode: null,
        gameModeLabel: null,
        message: '🚀 Server เริ่มทำงานแล้ว',
        type: 'success',
        meta: null
    });

    recoverGamePhaseTimers();
}

async function startServer() {
    const devFast = process.env.INSIDER_DEV_FAST === '1';
    console.log(`[insider] initializing (port ${PORT}${devFast ? ', fast dev' : ''})...`);

    if (devFast) {
        server.listen(PORT, () => {
            console.log(`[insider] HTTP ready on port ${PORT} — loading players/stats in background...`);
        });
    }

    try {
        await playerManager.initPlayerManager();
        console.log('✅ Player Manager initialized');

        await statsManager.initStatsManager();
        console.log('✅ Stats Manager initialized');

        await adminMessageManager.initAdminMessageManager();
        console.log('✅ Admin Message Manager initialized');

        const restoredRooms = await roomManager.initRoomManager();
        console.log(`✅ Room Manager initialized (${restoredRooms} room(s) restored)`);

        if (!devFast) {
            const repairedStatsNames = await statsManager.repairStatsPlayerNames(playerManager.getAllPlayers());
            if (repairedStatsNames.repairedCount > 0) {
                console.log(`✅ Repaired ${repairedStatsNames.repairedCount} stats player names`);
            }
        }
    } catch (e) {
        console.log('⚠️ Starting without MongoDB:', e.message);
    } finally {
        resolveCoreManagersReady();
    }

    if (!devFast) {
        server.listen(PORT, onServerListening);
    } else {
        console.log('[insider] background init done');
        onServerListening();
    }
}

startServer();

setInterval(runRoomCleanupSweep, ROOM_SWEEP_INTERVAL_MS);
