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
const io = new Server(server);

const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const wordFamille = fs.readFileSync('words/famille.csv','utf8')
                      .split(/\r?\n/)
                      .map(word => word.trim())
                      .filter(word => word.length > 0);

// Import managers
const playerManager = require('./managers/playerManager');
const roomManager = require('./managers/roomManager');
const statsManager = require('./managers/statsManager');

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
 */
function everybodyHasVoted(gameState, voteNumber) {
    const hasVoted1 = (currentValue) => currentValue.isGhost || currentValue.vote1 !== null;
    const hasVoted2 = (currentValue) => currentValue.isGhost || currentValue.vote2 !== null;

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
   .use(cookieParser())
   .use(session({
       secret: process.env.SESSION_SECRET || 'session-insider-secret',
       resave: false,
       saveUninitialized: false,
       cookie: { maxAge: null }
   }))
   .use('/static', express.static(__dirname + '/public'))
   .use(bodyParser.urlencoded({ extended: true }))
   .use(bodyParser.json())
   .set('view engine', 'ejs')
   .set('layout', 'layouts/layout');

// Middleware: Initialize player identity
// ใช้ query parameter แทน cookie เพื่อให้แต่ละ tab มี playerId แยกกัน
app.use(function(req, res, next) {
    // ดึง playerId จาก query parameter
    let playerId = req.query.playerId;
    
    if (playerId) {
        // ตรวจสอบว่า playerId นี้มีอยู่จริงหรือไม่
        const existingPlayer = playerManager.getPlayer(playerId);
        if (existingPlayer) {
            playerManager.updateLastSeen(playerId);
            req.playerId = playerId;
        } else {
            // ถ้าไม่มี ให้สร้างใหม่ด้วย playerId นี้
            playerManager.createOrGetPlayer(playerId);
            req.playerId = playerId;
        }
    } else {
        // ถ้าไม่มี playerId ใน query ให้สร้างใหม่
        const player = playerManager.createOrGetPlayer();
        req.playerId = player.playerId;
    }
    next();
});

// Lobby page
app.get('/', function(req, res) {
    // ถ้าไม่มี playerId ใน URL ให้ redirect พร้อม playerId
    if (!req.query.playerId) {
        return res.redirect('/?playerId=' + req.playerId);
    }
    const player = playerManager.getPlayer(req.playerId);
    res.render('lobby.ejs', { player: player });
});

// Room List page
app.get('/rooms', function(req, res) {
    // ถ้าไม่มี playerId ใน URL ให้ redirect พร้อม playerId ที่สร้างใหม่
    if (!req.query.playerId) {
        return res.redirect('/rooms?playerId=' + req.playerId);
    }
    const player = playerManager.getPlayer(req.playerId);
    if (!player) {
        // ถ้า player ไม่มีจริง ให้สร้างใหม่แล้ว redirect
        const newPlayer = playerManager.createOrGetPlayer();
        return res.redirect('/rooms?playerId=' + newPlayer.playerId);
    }
    const rooms = roomManager.getAllRooms();
    res.render('roomList.ejs', { player: player, rooms: rooms });
});

// Game/Board page จริง
app.get('/game/:roomId', function(req, res) {
    const roomId = req.params.roomId;
    const playerId = req.playerId;
    const room = roomManager.getRoom(roomId);
    
    if (!room) {
        return res.redirect('/rooms?playerId=' + playerId + '&error=room_not_found');
    }

    const player = playerManager.getPlayer(playerId);
    if (!player) {
        return res.redirect('/');
    }

    const playerInRoom = room.players.find(p => p.playerId === playerId);
    if (!playerInRoom) {
        return res.redirect('/rooms?playerId=' + playerId + '&error=not_in_room');
    }

    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (!gameStatePlayer) {
        return res.redirect('/rooms?playerId=' + playerId + '&error=game_state_error');
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
    
    console.log('[DEBUG /room/:roomId] roomId:', roomId, 'playerId:', playerId);
    console.log('[DEBUG /room/:roomId] room exists:', !!room);
    
    if (!room) {
        console.log('[DEBUG] Room not found for roomId:', roomId);
        return res.redirect('/rooms?playerId=' + playerId + '&error=room_not_found');
    }

    console.log('[DEBUG] Room players:', room.players.map(p => p.playerId));
    console.log('[DEBUG] GameState players:', room.gameState.players.map(p => p.playerId));

    const player = playerManager.getPlayer(playerId);
    if (!player) {
        console.log('[DEBUG] Player not found for playerId:', playerId);
        return res.redirect('/');
    }

    // ตรวจสอบว่าผู้เล่นอยู่ในห้องนี้หรือไม่
    const playerInRoom = room.players.find(p => p.playerId === playerId);
    if (!playerInRoom) {
        console.log('[DEBUG] Player not in room, playerId:', playerId);
        return res.redirect('/rooms?playerId=' + playerId + '&error=not_in_room');
    }

    const gameStatePlayer = room.gameState.players.find(p => p.playerId === playerId);
    if (!gameStatePlayer) {
        console.log('[DEBUG] Player not in gameState, playerId:', playerId);
        return res.redirect('/rooms?playerId=' + playerId + '&error=game_state_error');
    }

    res.render('roomLobby.ejs', {
        player: gameStatePlayer,
        playerInfo: playerInRoom,
        room: {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.length, // นับผู้เล่นทั้งหมดในห้อง (ไม่ใช่เฉพาะที่มี socketId)
            maxPlayers: room.settings.maxPlayers,
            locked: room.settings.locked,
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

// Update player name
app.post('/profile/updateName', function(req, res) {
    try {
        const newName = req.body.name?.trim();
        if (!newName || newName.length === 0) {
            return res.json({ success: false, error: 'Invalid name' });
        }
        playerManager.updatePlayerName(req.playerId, newName);
        statsManager.updatePlayerNameInStats(req.playerId, newName);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Update player color
app.post('/profile/updateColor', function(req, res) {
    try {
        const color = req.body.color;
        playerManager.updatePlayerColor(req.playerId, color);
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

    // Leave room
    socket.on('leaveRoom', function() {
        const roomId = socket.roomId;
        const playerId = socket.playerId;
        
        if (!roomId || !playerId) return;

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
            sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} ออกจากห้อง`, '#e74c3c');
        }

        // Update room list
        io.emit('roomListUpdate', roomManager.getAllRooms());
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
            roomManager.kickPlayer(roomId, adminPlayerId, targetPlayerId);

            // Find target socket and emit kick event
            const targetSocketId = room.players.find(p => p.playerId === targetPlayerId)?.socketId;
            if (targetSocketId) {
                io.to(targetSocketId).emit('kickedFromRoom', { message: 'คุณถูกเตะออกจากห้อง' });
            }

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
            sendChatMessageToRoom(io, roomId, 'System', `สิทธิ์ admin ถูกโอนให้ ${newAdmin.playerName}`, '#f39c12');
            
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
            // เช็คว่าเป็นการเข้าใหม่หรือ reconnect
            const playerInRoom = room.players.find(p => p.playerId === playerId);
            const wasOnline = playerInRoom && playerInRoom.socketId;
            
            // Make sure player is in room (in case they joined via HTTP redirect)
            roomManager.updatePlayerSocketId(roomId, playerId, socket.id);
            
            // Emit room update to all
            io.to(roomId).emit('roomUpdate', {
                roomId: roomId,
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission, online: !!p.socketId })),
                playerCount: room.players.length,
                admin: room.admin
            });

            // ส่ง chat notification ถ้าเป็นการเข้าใหม่ (ไม่ใช่ reconnect)
            if (!wasOnline) {
                const player = playerManager.getPlayer(playerId);
                if (player) {
                    sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} เข้าห้อง`, '#3498db');
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
            room.gameState.word = getWord(wordFamille);
            room.gameState.status = 'role';

            // ส่งให้ทุกคนในห้องไปหน้าเกม
            io.to(roomId).emit('gameStarted', { roomId: roomId });

            // Send chat notification
            sendChatMessageToRoom(io, roomId, 'System', 'เกมเริ่มแล้ว! ทุกคนกำลังเข้าสู่เกม', '#2ecc71');
            
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

        io.to(roomId).emit('newRole', { players: room.gameState.players, status: room.gameState.status });
        
        // Send chat notification
        sendChatMessageToRoom(io, roomId, 'System', 'เริ่มเกมใหม่! บทบาทถูกสุ่มแล้ว', '#9b59b6');
    });

    // Reveal word
    socket.on('revealWord', function() {
        const roomId = socket.roomId;
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        io.to(roomId).emit('revealWord', { players: room.gameState.players, word: room.gameState.word });
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

        let counter = room.settings.roundTime || 300;
        
        // Clear existing countdown
        if (roomCountdowns.has(roomId)) {
            clearInterval(roomCountdowns.get(roomId));
        }

        const countdownInterval = setInterval(function() {
            counter--;
            if (counter === 0) {
                clearInterval(countdownInterval);
                roomCountdowns.delete(roomId);
            }
            io.to(roomId).emit('countdownUpdate', counter);
        }, 1000);

        roomCountdowns.set(roomId, countdownInterval);
        room.gameState.countdown = countdownInterval;

        io.to(roomId).emit('startGame', {});
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

    // Disconnect
    socket.on('disconnect', function() {
        const roomId = socket.roomId;
        const playerId = socket.playerId;

        if (roomId && playerId) {
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

                // ตั้ง timeout ก่อนส่งข้อความ "หลุดการเชื่อมต่อ"
                // ถ้าผู้เล่น reconnect ภายใน 3 วินาที จะไม่ส่งข้อความนี้
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
                                // ยังไม่ได้ reconnect ส่งข้อความแจ้ง
                                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} หลุดการเชื่อมต่อ`, '#95a5a6');
                            }
                        }
                        disconnectTimeouts.delete(playerId);
                    }, 3000); // รอ 3 วินาที
                    
                    disconnectTimeouts.set(playerId, timeout);
                }
            }

            io.emit('roomListUpdate', roomManager.getAllRooms());
        }

        socketRoomMap.delete(socket.id);
        console.log('Socket disconnected:', socket.id);
    });
});

// ==================== SERVER START ====================

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log('Multi-Room Insider Game is ready!');
});
