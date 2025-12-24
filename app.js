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
const wordFamille = fs.readFileSync('words/famille.csv','utf8')
                      .split(/\r?\n/)
                      .map(word => word.trim())
                      .filter(word => word.length > 0);

// Import managers
const playerManager = require('./managers/playerManager');
const roomManager = require('./managers/roomManager');
const statsManager = require('./managers/statsManager');

// Load settings (including admin password)
const settings = JSON.parse(fs.readFileSync('./settings.json', 'utf8'));
const ADMIN_PASSWORD = settings.adminPassword || 'admin123';

// Constants from roomManager
const gameMasterRole = roomManager.gameMasterRole;
const traitorRole = roomManager.traitorRole;
const defaultRole = roomManager.defaultRole;

let nextMessageId = 1; // สำหรับสร้าง ID ข้อความที่ไม่ซ้ำกัน

// เก็บ mapping ระหว่าง socket.id กับ roomId (สำหรับ lookup เร็ว)
const socketRoomMap = new Map(); // Key: socket.id, Value: roomId

// เก็บ countdown intervals ต่อห้อง (Key: roomId, Value: interval)
const roomCountdowns = new Map();

// เก็บ timeout สำหรับ disconnect notification (Key: playerId, Value: timeout)
const disconnectTimeouts = new Map();

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
    } else if (a.name > b.name) {
        return 0;
    }
    return -1;
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

    // คำนวณจำนวนผู้ทรยศ
    const actualPlayersCount = players.length - 1; // ลบ GM ออก
    let numTraitors = 1;

    if (actualPlayersCount >= 6) {
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
    return data[Math.floor(Math.random() * data.length)];
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
        }
    });
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
 * Add vote count for vote2
 */
function addPlayerVote2(gameState, playerVote) {
    gameState.players.forEach(function(player) {
        if(playerVote === player.name) {
            player.nbVote2 += 1;
        }
    });
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
 * Process vote2 result
 */
function processVote2Result(gameState) {
    gameState.players.forEach(function(player) {
        addPlayerVote2(gameState, player.vote2);
    });
    
    const votePlayers = gameState.players.filter(isNotGameMaster);
    votePlayers.sort(compareVote);

    const actualTraitor = gameState.players.find(p => p.role === traitorRole);
    let hasTraitorInGame = !!actualTraitor;

    let hasWon;
    let finalResultTraitorName = '';
    const topVotedPlayer = votePlayers[0];
    const secondVotedPlayer = votePlayers[1];

    if (hasTraitorInGame) {
        if (topVotedPlayer && topVotedPlayer.role === traitorRole && (secondVotedPlayer ? topVotedPlayer.nbVote2 > secondVotedPlayer.nbVote2 : true)) {
            hasWon = true;
            finalResultTraitorName = topVotedPlayer.name;
        } else {
            hasWon = false;
            finalResultTraitorName = actualTraitor.name;
        }
    } else {
        if (topVotedPlayer && topVotedPlayer.isGhost && (secondVotedPlayer ? topVotedPlayer.nbVote2 > secondVotedPlayer.nbVote2 : true)) {
            hasWon = true;
            finalResultTraitorName = topVotedPlayer.name + ' (ไม่มีผู้ทรยศ)';
        } else if (!topVotedPlayer || (topVotedPlayer && !topVotedPlayer.isGhost && topVotedPlayer.nbVote2 === 0)) {
            hasWon = true;
            finalResultTraitorName = 'ไม่มีผู้ทรยศ';
        } else {
            hasWon = false;
            finalResultTraitorName = 'ไม่มีผู้ทรยศ (แต่ผู้เล่นโหวตพลาด)';
        }
    }

    gameState.resultVote2 = { 
        hasWon: hasWon, 
        voteDetail: votePlayers, 
        hasTraitor: hasTraitorInGame,
        finalTraitorName: finalResultTraitorName
    };
}

/**
 * Check if socket is admin of room
 */
function isAdminSocket(room, socket) {
    if (!room || !socket.playerId) return false;
    return room.admin === socket.playerId;
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
 * Send chat message to room
 */
function sendChatMessageToRoom(io, roomId, playerName, message, color, replyTo = null) {
    const messageId = `msg-${nextMessageId++}`;
    io.to(roomId).emit('newMessage', {
        messageId: messageId,
        message: message,
        playerName: playerName,
        color: color,
        timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        replyTo: replyTo
    });
}

// ==================== EXPRESS MIDDLEWARE & ROUTES ====================

app.use(expressLayouts)
   .use(session({
       secret: process.env.SESSION_SECRET || 'session-insider-secret',
       resave: false,
       saveUninitialized: false,
       cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day for admin session
   }))
   .use('/static', express.static(__dirname + '/public'))
   .use(bodyParser.urlencoded({ extended: true }))
   .use(bodyParser.json())
   .set('view engine', 'ejs')
   .set('layout', 'layouts/layout');

// Middleware: Initialize player identity
// ใช้ query parameter เท่านั้น (ไม่ใช้ cookie อีกต่อไป)
app.use(async function(req, res, next) {
    // Skip สำหรับ static files และ admin
    if (req.path.startsWith('/static') || req.path.startsWith('/admin') || req.path.startsWith('/socket.io')) {
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
    
    // ดึง playerId จาก query parameter
    let playerId = req.query.playerId;
    
    // ป้องกัน "undefined" หรือ "null" string
    if (!playerId || playerId === 'undefined' || playerId === 'null' || playerId === '') {
        playerId = null;
    }
    
    if (playerId) {
        // ตรวจสอบว่า playerId นี้มีอยู่จริงหรือไม่
        const existingPlayer = playerManager.getPlayer(playerId);
        if (existingPlayer) {
            playerManager.updateLastSeen(playerId);
            req.playerId = playerId;
        } else {
            // ไม่พบ player - สร้างใหม่ด้วย playerId เดิม
            // (อาจเกิดจาก server restart หรือ database ถูก clear)
            console.log(`[Middleware] Player not found, recreating with same ID: ${playerId}`);
            await playerManager.createOrGetPlayer(playerId);
            req.playerId = playerId;
        }
    } else {
        // ไม่มี playerId ใน URL → ส่ง redirect script ให้ client สร้าง playerId ใหม่และกลับมา
        // แทนที่จะสร้าง player ใหม่ที่ server ทันที (ป้องกัน ghost players)
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
    if (req.playerId && playerManager.isPlayerBanned(req.playerId)) {
        // ส่ง playerId ไปด้วยเพื่อให้หน้า banned แสดงข้อมูลได้
        return res.redirect('/banned?playerId=' + req.playerId);
    }
    
    next();
});

// Middleware: ดึงผู้เล่นกลับห้องเกมถ้าเกมกำลังดำเนินอยู่
app.use(function(req, res, next) {
    // ไม่ต้องเช็คหน้าเหล่านี้
    const skipPaths = ['/banned', '/static', '/admin', '/socket.io', '/game/', '/room/'];
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

// Lobby page
app.get('/', function(req, res) {
    // ดึง player จาก middleware (ซึ่งจะสร้างใหม่ถ้าไม่มี)
    const player = playerManager.getPlayer(req.playerId);
    const stats = statsManager.getStats(req.playerId);
    res.render('lobby.ejs', { player: player, stats: stats });
});

// Settings page
app.get('/settings', function(req, res) {
    const player = playerManager.getPlayer(req.playerId);
    res.render('settings.ejs', { player: player });
});

// Room List page
app.get('/rooms', function(req, res) {
    const player = playerManager.getPlayer(req.playerId);
    const rooms = roomManager.getAllRooms();
    res.render('roomList.ejs', { player: player, rooms: rooms });
});

// Game/Board page จริง
app.get('/game/:roomId', function(req, res) {
    const roomId = req.params.roomId;
    const playerId = req.playerId;
    const room = roomManager.getRoom(roomId);
    
    // ถ้าห้องไม่มี → กลับไป rooms
    if (!room) {
        return res.redirect('/rooms?msg=room_not_found');
    }

    const player = playerManager.getPlayer(playerId);
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
            settings: room.settings // เพิ่ม settings เพื่อให้ board.ejs เข้าถึงได้
        },
        status: room.gameState.status,
        resultVote1: room.gameState.resultVote1,
        resultVote2: room.gameState.resultVote2
    });
});

// Room Lobby page (ก่อนเริ่มเกม)
app.get('/room/:roomId', function(req, res) {
    const roomId = req.params.roomId;
    const playerId = req.playerId;
    const room = roomManager.getRoom(roomId);
    
    // ถ้าห้องไม่มี → ส่งไป rooms พร้อมแจ้งเตือน
    if (!room) {
        return res.redirect('/rooms?msg=room_not_found');
    }

    const player = playerManager.getPlayer(playerId);
    if (!player) {
        return res.redirect('/');
    }

    // ตรวจสอบว่าผู้เล่นอยู่ในห้องนี้หรือไม่
    let playerInRoom = room.players.find(p => p.playerId === playerId);
    
    // ถ้าผู้เล่นยังไม่อยู่ในห้อง → พยายาม join ห้องให้อัตโนมัติ
    if (!playerInRoom) {
        // เช็คว่าห้องเต็มหรือยัง
        if (room.players.length >= room.settings.maxPlayers) {
            return res.redirect('/rooms?msg=room_full');
        }
        
        // เช็คว่าห้องล็อคหรือไม่
        if (room.settings.locked) {
            return res.redirect('/rooms?msg=room_locked');
        }
        
        // เช็คว่าเกมเริ่มแล้วหรือยัง
        if (room.gameState.status !== '' && room.gameState.status !== 'waiting') {
            return res.redirect('/rooms?msg=game_in_progress');
        }
        
        // Auto-join room
        try {
            const joinResult = roomManager.joinRoom(roomId, playerId, null, null);
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
        room: {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.length,
            maxPlayers: room.settings.maxPlayers,
            roundTime: Math.floor(room.settings.roundTime / 60), // แปลงกลับเป็นนาที
            locked: room.settings.locked,
            password: room.settings.password || '',
            adminId: room.admin,
            isAdmin: room.admin === req.playerId
        },
        status: room.gameState.status
    });
});

// Profile page
app.get('/profile', function(req, res) {
    const player = playerManager.getPlayer(req.playerId);
    const stats = statsManager.getStats(req.playerId);
    res.render('profile.ejs', { player: player, stats: stats, availableColors: playerManager.AVAILABLE_COLORS });
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
    res.render('admin.ejs');
});

// Update player name
app.post('/profile/updateName', async function(req, res) {
    try {
        const newName = req.body.name?.trim();
        if (!newName || newName.length === 0) {
            return res.json({ success: false, error: 'Invalid name' });
        }
        await playerManager.updatePlayerName(req.playerId, newName);
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
        await playerManager.updatePlayerColor(req.playerId, color);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
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

    // ========== ROOM MANAGEMENT EVENTS ==========

    // Create room
    socket.on('createRoom', function(roomData, callback) {
        try {
            // รับ playerId จาก client (ถ้ามี) หรือจาก socket เก่า
            const playerId = roomData.playerId || socket.playerId;
            if (!playerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authenticated' });
                return;
            }

            const room = roomManager.createRoom(roomData, playerId);
            socketRoomMap.set(socket.id, room.roomId);
            socket.join(room.roomId);
            
            // Update socket info
            socket.playerId = playerId;
            socket.roomId = room.roomId;
            
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
    });

    // Join room
    socket.on('joinRoom', function(data, callback) {
        try {
            const { roomId, password, playerId: clientPlayerId } = data;
            // Use playerId from client or socket, prefer client
            const playerId = clientPlayerId || socket.playerId;
            
            if (!playerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authenticated' });
                return;
            }
            
            // Set socket.playerId for future use
            socket.playerId = playerId;

            const room = roomManager.joinRoom(roomId, playerId, socket.id, password);
            socketRoomMap.set(socket.id, roomId);
            socket.join(roomId);
            
            // Update socket info
            socket.playerId = playerId;
            socket.roomId = roomId;
            
            // Send room data to client
            const playerInRoom = room.players.find(p => p.playerId === playerId);
            socket.emit('roomJoined', {
                room: {
                    roomId: room.roomId,
                    name: room.name,
                    players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                    admin: room.admin,
                    settings: room.settings
                },
                player: playerInRoom
            });

            // Emit to all in room
            io.to(roomId).emit('roomUpdate', {
                roomId: roomId,
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                playerCount: room.players.length,
                admin: room.admin
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
    });

    // Request room update (for re-rendering after admin change)
    socket.on('requestRoomUpdate', function(data) {
        const roomId = data?.roomId || socket.roomId;
        if (!roomId) return;
        
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        
        // Send room update to requesting socket
        io.to(socket.id).emit('roomUpdate', {
            roomId: roomId,
            players: room.players.map(p => ({ 
                playerId: p.playerId, 
                playerName: p.playerName, 
                color: p.color, 
                permission: p.permission, 
                online: !!p.socketId 
            })),
            playerCount: room.players.length,
            admin: room.admin,
            locked: room.locked
        });
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
            // Emit to remaining players
            io.to(roomId).emit('roomUpdate', {
                roomId: roomId,
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                playerCount: room.players.length,
                admin: room.admin
            });

            // Send chat notification
            const player = playerManager.getPlayer(playerId);
            if (player) {
                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} ออกจากห้อง`, '#e74c3c');
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
                io.to(roomId).emit('roomUpdate', {
                    roomId: roomId,
                    players: updatedRoom.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                    playerCount: updatedRoom.players.length,
                    admin: updatedRoom.admin
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
                roomId: roomId,
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                playerCount: room.players.length,
                admin: room.admin
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
                roomId: roomId,
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                playerCount: room.players.length,
                settings: room.settings,
                admin: room.admin
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

    // Get room list
    socket.on('getRoomList', function(callback) {
        const rooms = roomManager.getAllRooms();
        if (typeof callback === 'function') {
            callback({ success: true, rooms: rooms });
        }
    });

    // Admin: Get all data for dashboard
    socket.on('admin_getData', function(callback) {
        try {
            // ดึงข้อมูลผู้เล่นทั้งหมด
            const players = playerManager.getAllPlayers();
            
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
            const playerStats = statsManager.getAllStats();
            
            if (typeof callback === 'function') {
                callback({
                    success: true,
                    players: players,
                    rooms: roomsWithPlayers,
                    playerStats: playerStats,
                    bannedPlayers: playerManager.getAllBannedPlayers()
                });
            }
        } catch (error) {
            console.error('Error getting admin data:', error);
            if (typeof callback === 'function') {
                callback({ success: false, error: error.message });
            }
        }
    });

    // Admin: Ban player
    socket.on('admin_banPlayer', function(data, callback) {
        try {
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
                    roomManager.leaveRoom(roomInfo.roomId, playerId);
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
            const { playerId } = data;
            playerManager.unbanPlayer(playerId);
            callback({ success: true });
        } catch (error) {
            console.error('Error unbanning player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Edit player name
    socket.on('admin_editPlayerName', function(data, callback) {
        try {
            const { playerId, newName } = data;
            playerManager.adminUpdatePlayerName(playerId, newName);
            callback({ success: true });
        } catch (error) {
            console.error('Error editing player name:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Delete player
    socket.on('admin_deletePlayer', function(data, callback) {
        try {
            const { playerId } = data;
            
            // ส่ง event ให้ client ของผู้เล่นที่ถูกลบรู้ และ disconnect
            // หา socket ของผู้เล่นนั้น
            const targetSockets = [];
            io.sockets.sockets.forEach((s) => {
                if (s.playerId === playerId) {
                    targetSockets.push(s);
                }
            });
            
            // ส่ง event playerDeleted ให้ client
            targetSockets.forEach(s => {
                s.emit('playerDeleted', { message: 'บัญชีของคุณถูกลบโดยแอดมิน' });
                s.disconnect(true);
            });
            
            // Remove from all rooms first
            const allRooms = roomManager.getAllRooms();
            allRooms.forEach(roomInfo => {
                roomManager.leaveRoom(roomInfo.roomId, playerId);
            });
            
            // Delete player and stats
            playerManager.deletePlayer(playerId);
            statsManager.deletePlayerStats(playerId);
            
            callback({ success: true });
        } catch (error) {
            console.error('Error deleting player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Bulk delete players
    socket.on('admin_bulkDeletePlayers', function(data, callback) {
        try {
            const { playerIds } = data;
            let deletedCount = 0;
            
            if (!playerIds || !Array.isArray(playerIds)) {
                return callback({ success: false, error: 'ไม่มี playerIds' });
            }
            
            playerIds.forEach(playerId => {
                try {
                    // ส่ง event playerDeleted ให้ client และ disconnect
                    io.sockets.sockets.forEach((s) => {
                        if (s.playerId === playerId) {
                            s.emit('playerDeleted', { message: 'บัญชีของคุณถูกลบโดยแอดมิน' });
                            s.disconnect(true);
                        }
                    });
                    
                    // Remove from all rooms first
                    const allRooms = roomManager.getAllRooms();
                    allRooms.forEach(roomInfo => {
                        roomManager.leaveRoom(roomInfo.roomId, playerId);
                    });
                    
                    // Delete player and stats
                    playerManager.deletePlayer(playerId);
                    statsManager.deletePlayerStats(playerId);
                    deletedCount++;
                } catch (err) {
                    console.error('Error deleting player:', playerId, err);
                }
            });
            
            io.emit('roomListUpdate');
            callback({ success: true, deletedCount });
        } catch (error) {
            console.error('Error bulk deleting players:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Delete all players
    socket.on('admin_deleteAllPlayers', function(data, callback) {
        try {
            const allPlayers = playerManager.getAllPlayers();
            let deletedCount = 0;
            
            allPlayers.forEach(player => {
                try {
                    // ส่ง event playerDeleted ให้ client และ disconnect
                    io.sockets.sockets.forEach((s) => {
                        if (s.playerId === player.playerId) {
                            s.emit('playerDeleted', { message: 'บัญชีของคุณถูกลบโดยแอดมิน' });
                            s.disconnect(true);
                        }
                    });
                    
                    // Remove from all rooms first
                    const allRooms = roomManager.getAllRooms();
                    allRooms.forEach(roomInfo => {
                        roomManager.leaveRoom(roomInfo.roomId, player.playerId);
                    });
                    
                    // Delete player and stats
                    playerManager.deletePlayer(player.playerId);
                    statsManager.deletePlayerStats(player.playerId);
                    deletedCount++;
                } catch (err) {
                    console.error('Error deleting player:', player.playerId, err);
                }
            });
            
            io.emit('roomListUpdate');
            callback({ success: true, deletedCount });
        } catch (error) {
            console.error('Error deleting all players:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Close room
    socket.on('admin_closeRoom', function(data, callback) {
        try {
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
            io.emit('roomListUpdate');
            
            callback({ success: true });
        } catch (error) {
            console.error('Error closing room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Unlock room
    socket.on('admin_unlockRoom', function(data, callback) {
        try {
            const { roomId } = data;
            roomManager.unlockRoom(roomId);
            io.emit('roomListUpdate');
            callback({ success: true });
        } catch (error) {
            console.error('Error unlocking room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Reset room game
    socket.on('admin_resetRoom', function(data, callback) {
        try {
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
            io.emit('roomListUpdate');
            
            callback({ success: true });
        } catch (error) {
            console.error('Error resetting room:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Reset player stats
    socket.on('admin_resetPlayerStats', function(data, callback) {
        try {
            const { playerId } = data;
            statsManager.resetPlayerStats(playerId);
            callback({ success: true });
        } catch (error) {
            console.error('Error resetting player stats:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Clear empty rooms
    socket.on('admin_clearEmptyRooms', function(callback) {
        try {
            const count = roomManager.clearEmptyRooms();
            io.emit('roomListUpdate');
            callback({ success: true, count });
        } catch (error) {
            console.error('Error clearing empty rooms:', error);
            callback({ success: false, error: error.message, count: 0 });
        }
    });

    // Admin: Clear all rooms
    socket.on('admin_clearAllRooms', function(callback) {
        try {
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
            io.emit('roomListUpdate');
            callback({ success: true, count });
        } catch (error) {
            console.error('Error clearing all rooms:', error);
            callback({ success: false, error: error.message, count: 0 });
        }
    });

    // Admin: Broadcast message
    socket.on('admin_broadcast', function(data, callback) {
        try {
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
            const { roomId } = data;
            const room = roomManager.getRoom(roomId);
            if (!room) {
                return callback({ success: false, error: 'ไม่พบห้อง' });
            }
            
            const players = room.players.map(p => ({
                id: p.playerId,
                name: p.playerName,
                color: p.color,
                isAdmin: p.playerId === room.adminId,
                role: room.gameStatus === 'playing' ? (room.roles ? room.roles[p.playerId] : null) : null
            }));
            
            callback({
                success: true,
                room: {
                    roomId: room.roomId,
                    name: room.name,
                    gameStatus: room.gameStatus,
                    gamePhase: room.gamePhase || null,
                    locked: room.locked || false,
                    maxPlayers: room.maxPlayers,
                    currentWord: room.gameStatus === 'playing' ? room.currentWord : null,
                    players
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
            roomManager.removePlayerFromRoom(roomId, playerId);
            
            // Update room for others
            io.to(roomId).emit('roomUpdate', {
                players: room.players,
                admin: room.adminId
            });
            
            callback({ success: true });
        } catch (error) {
            console.error('Error kicking player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Save settings (placeholder - you can extend this)
    socket.on('admin_saveSettings', function(data, callback) {
        try {
            // For now, just acknowledge - you can save to settings.json
            console.log('Admin settings saved:', data);
            callback({ success: true });
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Add words
    socket.on('admin_addWords', function(data, callback) {
        try {
            const { words } = data;
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, 'words', 'famille.csv');
            
            // Read existing words
            let existingWords = [];
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                existingWords = content.split('\n').map(w => w.trim()).filter(w => w);
            }
            
            // Add new words (avoid duplicates)
            let addedCount = 0;
            words.forEach(word => {
                if (!existingWords.includes(word)) {
                    existingWords.push(word);
                    addedCount++;
                }
            });
            
            // Save back
            fs.writeFileSync(filePath, existingWords.join('\n'), 'utf-8');
            
            callback({ success: true, addedCount });
        } catch (error) {
            console.error('Error adding words:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Get words
    socket.on('admin_getWords', function(data, callback) {
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, 'words', 'famille.csv');
            
            let words = [];
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                words = content.split('\n').map(w => w.trim()).filter(w => w);
            }
            
            callback({ success: true, words });
        } catch (error) {
            console.error('Error getting words:', error);
            callback({ success: false, error: error.message });
        }
    });

    // ========== GAME EVENTS (Modified to work with rooms) ==========

    // Initialize player (when joining board page)
    socket.on('initPlayer', function(playerId) {
        socket.playerId = playerId;
        const player = playerManager.getPlayer(playerId);
        if (player) {
            socket.playerName = player.playerName;
            socket.playerColor = player.color;
        }
    });

    // Set room context (when joining board page)
    socket.on('setRoom', function(data) {
        const roomId = typeof data === 'string' ? data : data.roomId;
        const playerId = (typeof data === 'object' && data.playerId) ? data.playerId : socket.playerId;
        
        if (!playerId) {
            console.error('setRoom called without playerId');
            return;
        }
        
        // ยกเลิก disconnect timeout ถ้ามี (ผู้เล่น reconnect มาแล้ว)
        if (disconnectTimeouts.has(playerId)) {
            clearTimeout(disconnectTimeouts.get(playerId));
            disconnectTimeouts.delete(playerId);
            console.log(`[setRoom] Cancelled disconnect timeout for ${playerId}`);
        }
        
        socket.playerId = playerId;
        socket.roomId = roomId;
        socket.join(roomId);
        socketRoomMap.set(socket.id, roomId);
        
        const room = roomManager.getRoom(roomId);
        if (room) {
            // เช็คว่าเป็นการเข้าใหม่หรือ reconnect/duplicate setRoom
            const playerInRoom = room.players.find(p => p.playerId === playerId);
            const wasOnline = playerInRoom && playerInRoom.socketId;
            const isDuplicate = playerInRoom && playerInRoom.socketId === socket.id;
            
            // Make sure player is in room (in case they joined via HTTP redirect)
            roomManager.updatePlayerSocketId(roomId, playerId, socket.id);
            
            // Emit room update to all
            io.to(roomId).emit('roomUpdate', {
                roomId: roomId,
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                playerCount: room.players.length,
                admin: room.admin
            });

            // ส่ง chat notification เฉพาะกรณีเข้าใหม่จริงๆ (ไม่ใช่ reconnect หรือ duplicate)
            if (!wasOnline && !isDuplicate) {
                const player = playerManager.getPlayer(playerId);
                if (player) {
                    sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} เข้าห้อง`, '#3498db');
                }
            }

            // Sync game state: ส่ง players array แบบเดิม
            const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
            if (gameStatePlayer && gameStatePlayer.role) {
                io.to(socket.id).emit('newRole', {
                    players: room.gameState.players,
                    status: room.gameState.status
                });

                // ถ้าเกมอยู่ในช่วงที่มีคำแล้ว ให้ sync
                const shouldSyncWord = ['word', 'in_progress', 'vote1', 'vote2', 'end'].includes(room.gameState.status);
                if (shouldSyncWord && room.gameState.word) {
                    io.to(socket.id).emit('revealWord', {
                        players: room.gameState.players,
                        word: room.gameState.word
                    });
                }
            }
        }
    });

    // Start game from lobby (redirect all players to game board)
    socket.on('startGameFromLobby', function(data, callback) {
        try {
            const roomId = socket.roomId || (data && data.roomId);
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

            // ตรวจสอบจำนวนผู้เล่น (ต้องมีอย่างน้อย 3 คน)
            const onlinePlayers = room.players.filter(p => p.socketId);
            if (onlinePlayers.length < 3) {
                if (typeof callback === 'function') callback({ success: false, error: 'ต้องมีผู้เล่นออนไลน์อย่างน้อย 3 คน' });
                return;
            }

            // สุ่มบทบาทก่อนเริ่มเกม
            randomRoles(room.gameState, room.settings);
            room.gameState.status = 'role';
            // ตั้งคำอัตโนมัติทันที (GM ยังแก้ได้ก่อนเปิดเผย)
            room.gameState.word = getWord(wordFamille);
            console.log('[startGameFromLobby] Auto-set word:', room.gameState.word);

            // ส่งบทบาทแบบส่วนตัวให้แต่ละคน (ไม่ broadcast)
            console.log('[startGameFromLobby] Sending roles to', room.players.length, 'players');
            room.players.forEach(p => {
                if (p.socketId) {
                    const gamePlayer = room.gameState.players.find(gp => gp.playerId === p.playerId);
                    if (gamePlayer) {
                        console.log(`[startGameFromLobby] Sending role to ${p.playerName} (${p.socketId}): ${gamePlayer.role}`);
                        io.to(p.socketId).emit('newRole', { 
                            role: gamePlayer.role,
                            isGhost: gamePlayer.isGhost,
                            status: room.gameState.status
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
            onlinePlayers.forEach(p => {
                if (p.socketId) {
                    io.to(p.socketId).emit('gameStarting', { roomId: roomId });
                }
            });
            
            if (typeof callback === 'function') callback({ success: true });
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

        if (!isAdminSocket(room, socket)) return;

        io.to(socket.id).emit('admin_word_roles', {
            word: room.gameState.word,
            players: room.gameState.players.map(p => ({ name: p.name, role: p.role }))
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
        room.gameState.word = getWord(wordFamille);
        room.gameState.status = 'role';

        // Broadcast newRole แบบเดิม
        io.to(roomId).emit('newRole', { 
            players: room.gameState.players,
            status: room.gameState.status 
        });
        
        // Send chat notification
        sendChatMessageToRoom(io, roomId, 'System', 'เริ่มเกมใหม่! บทบาทถูกสุ่มแล้ว', '#9b59b6');
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

        // Broadcast revealWord แบบเดิม (ส่ง players + word ไปทั้งหมด ให้ client กรองเอง)
        io.to(roomId).emit('revealWord', { 
            players: room.gameState.players,
            word: room.gameState.word 
        });
        
        room.gameState.status = 'word';
        
        // Send chat notification
        sendChatMessageToRoom(io, roomId, 'System', 'คำได้ถูกเปิดเผยแล้ว', '#3498db');
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
        if (data && data.word && data.word.trim() !== '') {
            wordToSet = data.word.trim();
        } else {
            wordToSet = getWord(wordFamille);
            if (!wordToSet) {
                if (typeof callback === 'function') callback({ ok: false, error: 'no_word_available' });
                return;
            }
        }
        
        room.gameState.word = wordToSet;
        
        if (typeof callback === 'function') callback({ ok: true });
    });

    // Word found
    socket.on('wordFound', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        // ต้องเป็น admin เท่านั้นที่จะกดหยุดเกมได้
        if (!isAdminSocket(room, socket)) return;

        if (roomCountdowns.has(roomId)) {
            clearInterval(roomCountdowns.get(roomId));
            roomCountdowns.delete(roomId);
        }

        io.to(roomId).emit('wordFound');
        room.gameState.status = 'vote1';
    });

    // Display vote1
    socket.on('displayVote1', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        if (!isAdminSocket(room, socket)) return;

        resetVote(room.gameState, 1);
        io.to(roomId).emit('displayVote1');
        room.gameState.status = 'vote1';
    });

    // Display vote2
    socket.on('displayVote2', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        // ต้องเป็น admin เท่านั้น
        if (!isAdminSocket(room, socket)) return;

        resetVote(room.gameState, 2);
        io.to(roomId).emit('displayVote2', room.gameState.players.filter(isNotGameMaster));
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

        const player = room.gameState.players.find(p => p.playerId === playerId);
        if (!player || object.player !== player.name) return;

        // ป้องกันโหวตซ้ำ
        if (player.vote1 !== null) {
            console.log(`[vote1] Player ${player.name} already voted`);
            return;
        }

        player.vote1 = object.vote;

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

        const player = room.gameState.players.find(p => p.playerId === playerId);
        if (!player || object.player !== player.name) return;

        // ป้องกันโหวตซ้ำ
        if (player.vote2 !== null) {
            console.log(`[vote2] Player ${player.name} already voted`);
            return;
        }

        player.vote2 = object.vote;

        if(everybodyHasVoted(room.gameState, 2)) {
            processVote2Result(room.gameState);
            io.to(roomId).emit('vote2Ended', room.gameState.resultVote2);
            room.gameState.status = 'end';

            // Record statistics
            statsManager.recordGameEnd(roomId, {
                resultVote2: room.gameState.resultVote2,
                players: room.gameState.players
            });

            // Send chat notification
            const resultMsg = room.gameState.resultVote2.hasWon ? 'พลเมืองชนะ!' : 'ผู้ทรยศชนะ!';
            sendChatMessageToRoom(io, roomId, 'System', `เกมจบ! ${resultMsg}`, '#f39c12');

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
                console.log('[startGame] Countdown finished for room:', roomId);
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

        sendChatMessageToRoom(io, roomId, player.playerName, data.message, player.color, data.replyTo);
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
                io.to(roomId).emit('roomUpdate', {
                    roomId: roomId,
                    players: updatedRoom.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                    playerCount: updatedRoom.players.length,
                    admin: updatedRoom.admin
                });

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
                                
                                // ลบผู้เล่นออกจากห้องหลังจาก 5 นาที (300000ms)
                                const removeTimeout = setTimeout(() => {
                                    const roomCheck = roomManager.getRoom(roomId);
                                    if (roomCheck) {
                                        const stillDisconnected = roomCheck.players.find(p => p.playerId === playerId && !p.socketId);
                                        if (stillDisconnected) {
                                            // ลบผู้เล่นออกจากห้อง
                                            const updatedRoom = roomManager.leaveRoom(roomId, playerId);
                                            if (updatedRoom) {
                                                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} ออกจากห้อง (Timeout)`, '#e74c3c');
                                                io.to(roomId).emit('roomUpdate', {
                                                    roomId: roomId,
                                                    players: updatedRoom.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                                                    playerCount: updatedRoom.players.length,
                                                    admin: updatedRoom.admin
                                                });
                                                io.emit('roomListUpdate', roomManager.getAllRooms());
                                            }
                                            console.log(`[Timeout] Removed player ${player.playerName} from room ${roomId}`);
                                        }
                                    }
                                }, 300000); // 5 นาที
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
    // ใช้ playerId ที่มีอยู่แล้ว (จาก middleware) หรือสร้างใหม่
    let playerId = req.query.playerId || req.playerId;
    if (!playerId) {
        const newPlayer = await playerManager.createOrGetPlayer();
        playerId = newPlayer.playerId;
    }
    res.status(404).render('error.ejs', { 
        playerId: playerId,
        message: 'ไม่พบหน้าที่คุณต้องการ',
        redirectUrl: '/?playerId=' + playerId
    });
});

// ==================== SERVER START ====================

const PORT = process.env.PORT || 8080;

// Initialize database and start server
async function startServer() {
    try {
        // Initialize player manager with MongoDB if available
        await playerManager.initPlayerManager();
        console.log('✅ Player Manager initialized');
    } catch (e) {
        console.log('⚠️ Starting without MongoDB:', e.message);
    }
    
    server.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
        console.log('Multi-Room Insider Game is ready!');
    });
}

startServer();
