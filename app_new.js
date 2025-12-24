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
app.use(function(req, res, next) {
    // ดึง playerId จาก cookie หรือสร้างใหม่
    let playerId = req.cookies?.playerId;
    if (!playerId) {
        const player = playerManager.createOrGetPlayer();
        playerId = player.playerId;
        res.cookie('playerId', playerId, { maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year
    } else {
        playerManager.createOrGetPlayer(playerId);
        playerManager.updateLastSeen(playerId);
    }
    req.playerId = playerId;
    next();
});

// Lobby page
app.get('/', function(req, res) {
    const player = playerManager.getPlayer(req.playerId);
    res.render('lobby.ejs', { player: player });
});

// Room List page
app.get('/rooms', function(req, res) {
    const player = playerManager.getPlayer(req.playerId);
    const rooms = roomManager.getAllRooms();
    res.render('roomList.ejs', { player: player, rooms: rooms });
});

// Game/Board page
app.get('/room/:roomId', function(req, res) {
    const roomId = req.params.roomId;
    const room = roomManager.getRoom(roomId);
    
    if (!room) {
        return res.redirect('/rooms?error=room_not_found');
    }

    const player = playerManager.getPlayer(req.playerId);
    if (!player) {
        return res.redirect('/?error=player_not_found');
    }

    // ตรวจสอบว่าผู้เล่นอยู่ในห้องนี้หรือไม่
    const playerInRoom = room.players.find(p => p.playerId === req.playerId);
    if (!playerInRoom) {
        return res.redirect('/rooms?error=not_in_room');
    }

    const gameStatePlayer = room.gameState.players.find(p => p.playerId === req.playerId);
    if (!gameStatePlayer) {
        return res.redirect('/rooms?error=game_state_error');
    }

    res.render('board.ejs', {
        player: gameStatePlayer,
        playerInfo: playerInRoom,
        room: {
            roomId: room.roomId,
            name: room.name,
            playerCount: room.players.filter(p => p.socketId).length,
            maxPlayers: room.settings.maxPlayers,
            admin: room.admin === req.playerId,
            settings: room.settings
        },
        status: room.gameState.status,
        resultVote1: room.gameState.resultVote1,
        resultVote2: room.gameState.resultVote2
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
            const playerId = socket.playerId;
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
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                playerCount: room.players.filter(p => p.socketId).length
            });

            // Send chat notification
            const player = playerManager.getPlayer(playerId);
            sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} เข้าห้อง`, '#3498db');

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
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                playerCount: room.players.filter(p => p.socketId).length
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
                    players: updatedRoom.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                    playerCount: updatedRoom.players.filter(p => p.socketId).length
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
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                playerCount: room.players.filter(p => p.socketId).length,
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
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                playerCount: room.players.filter(p => p.socketId).length,
                settings: room.settings
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
        
        socket.playerId = playerId;
        socket.roomId = roomId;
        socket.join(roomId);
        socketRoomMap.set(socket.id, roomId);
        
        const room = roomManager.getRoom(roomId);
        if (room) {
            // Make sure player is in room (in case they joined via HTTP redirect)
            roomManager.updatePlayerSocketId(roomId, playerId, socket.id);
            
            // Emit room update to all
            io.to(roomId).emit('roomUpdate', {
                players: room.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                playerCount: room.players.filter(p => p.socketId).length
            });
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
            // Clear countdown if admin
            const room = roomManager.getRoom(roomId);
            if (room && room.admin === playerId && roomCountdowns.has(roomId)) {
                clearInterval(roomCountdowns.get(roomId));
                roomCountdowns.delete(roomId);
            }

            // Leave room
            const updatedRoom = roomManager.leaveRoom(roomId, playerId);
            if (updatedRoom) {
                io.to(roomId).emit('roomUpdate', {
                    players: updatedRoom.players.map(p => ({ playerId: p.playerId, playerName: p.playerName, color: p.color, permission: p.permission })),
                    playerCount: updatedRoom.players.filter(p => p.socketId).length
                });

                const player = playerManager.getPlayer(playerId);
                sendChatMessageToRoom(io, roomId, 'System', `${player.playerName} หลุดการเชื่อมต่อ`, '#95a5a6');
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
