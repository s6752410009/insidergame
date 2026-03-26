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
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = packageJson.version || '0.0.0';
const wordFamille = fs.readFileSync('words/famille.csv','utf8')
                      .split(/\r?\n/)
                      .map(word => word.trim())
                      .filter(word => word.length > 0);

// Import managers
const playerManager = require('./managers/playerManager');
const roomManager = require('./managers/roomManager');
const statsManager = require('./managers/statsManager');
const { getGameEngine, getAvailableGameModes } = require('./games/engineRegistry');

app.locals.appVersion = APP_VERSION;

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

// เก็บ timeout สำหรับ phase อัตโนมัติของ Werewolf
const werewolfPhaseTimeouts = new Map();

// เก็บ timeout ช่วงคั่นก่อน broadcast phase ถัดไปของ Werewolf
const werewolfTransitionTimeouts = new Map();

// เก็บ timeout สำหรับ disconnect notification (Key: playerId, Value: timeout)
const disconnectTimeouts = new Map();

// เก็บ socket IDs ที่ authenticated เป็น admin (Key: socket.id, Value: true)
const adminSockets = new Set();

// เก็บ admin tokens ชั่วคราว (Key: token, Value: { createdAt, used })
const adminTokens = new Map();

// เก็บ server activity logs (เก็บ 500 logs ล่าสุด)
const serverLogs = [];
const MAX_SERVER_LOGS = 500;

const ROOM_OFFLINE_GRACE_MS = 10 * 60 * 1000;
const ROOM_SWEEP_INTERVAL_MS = 60 * 1000;
const WEREWOLF_PHASE_TRANSITION_DELAY_MS = 2600;

// สร้าง admin token
function generateAdminToken() {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.set(token, { createdAt: Date.now(), used: false });
    // ลบ token หลัง 60 วินาที (ป้องกัน token leak)
    setTimeout(() => adminTokens.delete(token), 60000);
    return token;
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

    // คำนวณจำนวนผู้ทรยศ
    const actualPlayersCount = players.length - 1; // ลบ GM ออก
    let numTraitors = 1;

    // ใช้ setting dualTraitorMode แทนการคำนวณอัตโนมัติ
    // ต้องมีผู้เล่น 5+ คน (ไม่รวม GM = 4+) ถึงจะเปิดโหมด 2 ผู้ทรยศได้
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
 * Process vote2 result - รองรับ 1 หรือ 2 ผู้ทรยศ
 */
function processVote2Result(gameState) {
    gameState.players.forEach(function(player) {
        addPlayerVote2(gameState, player.vote2);
    });
    
    const votePlayers = gameState.players.filter(isNotGameMaster);
    votePlayers.sort(compareVote);

    // หาผู้ทรยศทั้งหมด (อาจมี 1 หรือ 2 คน)
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
            // กรณีผู้ทรยศ 1 คน - logic เดิม
            if (topVotedPlayer && topVotedPlayer.role === traitorRole && (secondVotedPlayer ? topVotedPlayer.nbVote2 > secondVotedPlayer.nbVote2 : true)) {
                hasWon = true;
                finalResultTraitorName = topVotedPlayer.name;
            } else {
                hasWon = false;
                finalResultTraitorName = allTraitors[0].name;
            }
        } else {
            // กรณีผู้ทรยศ 2 คน - ต้องจับได้ทั้งคู่ถึงจะชนะ
            // หาว่าผู้เล่นที่ได้โหวตสูงสุด 2 อันดับแรกเป็นผู้ทรยศหรือไม่
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
        numTraitors: numTraitors, // เพิ่มจำนวนผู้ทรยศ
        finalTraitorName: finalResultTraitorName,
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
function sendChatMessageToRoom(io, roomId, playerName, message, color, replyTo = null, playerId = null, avatar = '👤') {
    const messageId = `msg-${nextMessageId++}`;
    let messageType = 'player';

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
        color: color,
        playerId: playerId,
        avatar: avatar,
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
    // Store log for admin dashboard
    addServerLog(io, 'game', roomId, message, type);
}

/**
 * Add a server activity log
 * @param {Object} io - Socket.io instance  
 * @param {string} category - Log category: 'join', 'leave', 'game', 'admin', 'error', 'chat', 'system'
 * @param {string} roomId - Room ID (optional)
 * @param {string} message - Log message
 * @param {string} type - Log type: 'info', 'success', 'warning', 'error'
 */
function addServerLog(io, category, roomId, message, type = 'info') {
    const room = roomId ? roomManager.getRoom(roomId) : null;
    const roomName = room ? room.name : roomId || 'ระบบ';
    const gameMode = room?.settings?.gameMode || null;
    
    const logEntry = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        category: category,
        roomId: roomId || null,
        roomName: roomName,
        gameMode,
        message: message,
        type: type
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
    const isInGame = !!(room.gameState.status && room.gameState.status !== 'waiting' && room.gameState.status !== '');

    return {
        roomId: room.roomId,
        roomName: room.name,
        players: room.players.map(player => ({
            playerId: player.playerId,
            playerName: player.playerName,
            color: player.color,
            avatar: player.avatar,
            avatarFrame: player.avatarFrame,
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
        gameStatus: isInGame ? 'playing' : 'waiting',
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
                name: player.name || player.playerName || resolveDisplayPlayerName(player.playerId, 'Unknown'),
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

function buildWerewolfChatHistory(room, playerId) {
    if (!room || room.settings.gameMode !== 'werewolf') {
        return room?.chatHistory || [];
    }

    const publicHistory = Array.isArray(room.chatHistory) ? room.chatHistory : [];
    const wolfHistory = isWerewolfNightChatEligible(room, playerId) && Array.isArray(room.werewolfChatHistory)
        ? room.werewolfChatHistory
        : [];

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
    const payload = {
        messageId,
        message,
        playerName: player.playerName,
        color: player.color,
        playerId: player.playerId,
        avatar: player.avatar || '👤',
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

    clearWerewolfTransitionTimer(room.roomId);
    syncWerewolfPhaseTimer(room);
    emitWerewolfState(room);
    io.to(room.roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
}

function emitBlackMarketState(room, targetSocketId = null, playerId = null) {
    if (!room || room.settings.gameMode !== 'blackmarket') {
        return;
    }

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
        return;
    }

    const phase = room.gameState.phase;
    const activePhase = phase === 'night' || phase === 'day-discussion' || phase === 'day-vote';
    if (!activePhase || room.gameState.winner) {
        clearWerewolfPhaseTimer(room.roomId);
        return;
    }

    const existingTimer = werewolfPhaseTimeouts.get(room.roomId);
    if (existingTimer && existingTimer.phase === phase && room.gameState.phaseEndsAt && room.gameState.phaseEndsAt > Date.now()) {
        return;
    }

    clearWerewolfPhaseTimer(room.roomId, false);

    const NIGHT_DURATION_MS = 60000;      // 1 นาที
    const DISCUSSION_DURATION_MS = 180000; // 3 นาที
    const VOTE_DURATION_MS = 60000;        // 1 นาที
    const durationMs = phase === 'night'
        ? NIGHT_DURATION_MS
        : (phase === 'day-discussion' ? DISCUSSION_DURATION_MS : VOTE_DURATION_MS);
    room.gameState.phaseEndsAt = Date.now() + durationMs;

    const timeoutId = setTimeout(() => {
        werewolfPhaseTimeouts.delete(room.roomId);

        const currentRoom = roomManager.getRoom(room.roomId);
        if (!currentRoom || currentRoom.settings.gameMode !== 'werewolf') {
            return;
        }

        if (currentRoom.gameState.phase !== phase || currentRoom.gameState.winner) {
            return;
        }

        try {
            const werewolfEngine = getGameEngine('werewolf');
            const resolution = werewolfEngine.autoResolvePhase(currentRoom);
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
            console.error('[werewolf] auto resolve failed:', error);
        }
    }, durationMs);

    werewolfPhaseTimeouts.set(room.roomId, { phase, timeoutId });
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

    return playerManager.createOrGetPlayer(playerId);
}

function getRenderablePlayer(playerId) {
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

    return {
        annotatedPlayers,
        cleanupCandidates,
        statsByPlayerId,
        summary: {
            realPlayers: annotatedPlayers.filter(player => player.category === 'real').length,
            guestActivePlayers: annotatedPlayers.filter(player => player.category === 'guest-active').length,
            guestIdlePlayers: annotatedPlayers.filter(player => player.category === 'guest-idle').length,
            cleanupCandidates: cleanupCandidates.length
        }
    };
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
        roomManager.leaveRoom(roomInfo.roomId, playerId);
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

// SEO: Serve robots.txt and sitemap.xml
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.sendFile(__dirname + '/public/robots.txt');
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.sendFile(__dirname + '/public/sitemap.xml');
});

// Middleware: Initialize player identity
// ใช้ query parameter เท่านั้น (ไม่ใช้ cookie อีกต่อไป)
app.use(async function(req, res, next) {
    // Skip สำหรับ static files, admin, API และ socket.io
    if (req.path.startsWith('/static') || req.path.startsWith('/admin') || req.path.startsWith('/socket.io') || req.path.startsWith('/api/')) {
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
    if (!playerId || playerId === 'undefined' || playerId === 'null' || playerId === '' || !playerManager.isValidPlayerId(playerId)) {
        playerId = null;
    }
    
    if (playerId) {
        const existingPlayer = playerManager.getPlayer(playerId);
        if (existingPlayer) {
            await playerManager.updateLastSeen(playerId);
        }
        req.playerId = playerId;
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
    res.render('lobby.ejs', { player: player, stats: stats });
});

// API: Leave room (สำหรับ sendBeacon เมื่อปิดหน้า)
app.post('/api/leave-room', express.text({ type: '*/*' }), function(req, res) {
    try {
        const data = JSON.parse(req.body);
        const { roomId, playerId } = data;
        
        if (roomId && playerId) {
            const updatedRoom = roomManager.leaveRoom(roomId, playerId);
            if (updatedRoom) {
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
        werewolfRoleOptions: getGameEngine('werewolf').getConfigurableRoles()
    });
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
                settings: room.settings
            },
            blackMarketState: buildBlackMarketStatePayload(room, playerId)
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
            dualTraitorMode: room.settings.dualTraitorMode || false, // โหมด 2 ผู้ทรยศ
            werewolfRoles: room.settings.werewolfRoles || [],
            adminId: room.admin,
            isAdmin: room.admin === req.playerId
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
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = statsManager.getLeaderboard(limit);
    
    // เพิ่มข้อมูล avatar จาก playerManager
    const enrichedLeaderboard = leaderboard.map(entry => {
        const player = playerManager.getPlayer(entry.playerId);
        return {
            ...entry,
            playerName: resolveDisplayPlayerName(entry.playerId, entry.playerName),
            avatar: player?.avatar || '👤',
            avatarFrame: player?.avatarFrame || 'none',
            color: player?.color || '#3498db'
        };
    });
    
    res.json(enrichedLeaderboard);
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

    // ========== ROOM MANAGEMENT EVENTS ==========

    // Create room
    socket.on('createRoom', function(roomData, callback) {
        (async function() {
        try {
            // รับ playerId จาก client (ถ้ามี) หรือจาก socket เก่า
            const playerId = roomData.playerId || socket.playerId;
            if (!playerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authenticated' });
                return;
            }

            await ensurePersistedPlayer(playerId);

            const room = roomManager.createRoom(roomData, playerId);
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
            const { roomId, password, playerId: clientPlayerId } = data;
            // Use playerId from client or socket, prefer client
            const playerId = clientPlayerId || socket.playerId;
            
            if (!playerId) {
                if (typeof callback === 'function') callback({ success: false, error: 'Not authenticated' });
                return;
            }

            await ensurePersistedPlayer(playerId);
            
            // Set socket.playerId for future use
            socket.playerId = playerId;

            const room = roomManager.joinRoom(roomId, playerId, socket.id, password);
            roomManager.markPlayerActive(roomId, playerId);
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
        const roomId = data?.roomId || socket.roomId;
        if (!roomId) return;
        
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        
        // Send room update to requesting socket
        io.to(socket.id).emit('roomUpdate', {
            ...buildRoomUpdatePayload(room)
        });
    });

    // Check room status (เมื่อ user กลับมาจาก background)
    socket.on('checkRoomStatus', function(data) {
        const { roomId, playerId } = data;
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
        
        // ส่งข้อมูลห้องกลับ
        io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(room));
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
            const roomId = socket.roomId || data.roomId;
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
            const modeText = enabled ? '🔴🔴 เปิดโหมด 2 ผู้ทรยศ!' : '🔴 ปิดโหมด 2 ผู้ทรยศ (ใช้โหมดปกติ)';
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
                
                // ตรวจสอบว่า token ยังไม่ถูกใช้ และไม่เกิน 60 วินาที
                if (!tokenData.used && (Date.now() - tokenData.createdAt) < 60000) {
                    tokenData.used = true; // Mark as used
                    adminSockets.add(socket.id);
                    console.log(`[Admin] Socket ${socket.id} authenticated as admin via token`);
                    if (typeof callback === 'function') {
                        callback({ success: true });
                    }
                } else {
                    console.log(`[Admin] Token expired or already used from socket ${socket.id}`);
                    if (typeof callback === 'function') {
                        callback({ success: false, error: 'Token หมดอายุหรือถูกใช้แล้ว กรุณา refresh หน้า' });
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
            
            const { filter, limit } = data || {};
            let logs = [...serverLogs]; // Clone array
            
            // Filter by category if specified
            if (filter && filter !== 'all') {
                logs = logs.filter(log => log.category === filter);
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
                    gameStatus: isPlaying ? 'playing' : 'waiting',
                    gamePhase: room.gameState.status || null,
                    locked: room.settings?.locked || false,
                    maxPlayers: room.settings?.maxPlayers,
                    currentWord: isPlaying ? room.gameState.word : null,
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
                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));
            }
            io.emit('roomListUpdate', roomManager.getAllRooms());
            
            callback({ success: true });
        } catch (error) {
            console.error('Error kicking player:', error);
            callback({ success: false, error: error.message });
        }
    });

    // Admin: Save settings (placeholder - you can extend this)
    socket.on('admin_saveSettings', function(data, callback) {
        try {
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
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
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
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
            // ตรวจสอบสิทธิ์ admin
            if (!isAdminAuthenticated(socket.id)) {
                if (typeof callback === 'function') {
                    callback({ success: false, error: 'Unauthorized - กรุณา login ก่อน' });
                }
                return;
            }
            
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
                } else {
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
        } else {
            io.to(socket.id).emit('roomClosed', { message: 'ห้องถูกปิดไปแล้ว' });
        }
    });

    socket.on('werewolf_requestState', function(data) {
        const roomId = data?.roomId || socket.roomId;
        const playerId = data?.playerId || socket.playerId;
        const room = roomManager.getRoom(roomId);
        if (!room || room.settings.gameMode !== 'werewolf' || !playerId) {
            return;
        }

        syncWerewolfPhaseTimer(room);
        emitWerewolfState(room, socket.id, playerId);
    });

    socket.on('blackmarket_requestState', function(data) {
        const roomId = data?.roomId || socket.roomId;
        const playerId = data?.playerId || socket.playerId;
        const room = roomManager.getRoom(roomId);
        if (!room || room.settings.gameMode !== 'blackmarket' || !playerId) {
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

        if (!isAdminSocket(room, socket)) {
            if (typeof callback === 'function') {
                callback({ success: false, error: 'คำสั่งนี้ใช้ได้เฉพาะหัวหน้าห้องเท่านั้น' });
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
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
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
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
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
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
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

    socket.on('werewolf_skipDiscussion', function(data, callback) {
        try {
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
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

    socket.on('werewolf_useRevealAction', function(data, callback) {
        try {
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
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
            const roomId = socket.roomId || data?.roomId;
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
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
            const itemId = data?.itemId;
            const room = roomManager.getRoom(roomId);

            if (!room || room.settings.gameMode !== 'blackmarket') {
                throw new Error('ไม่พบตลาดนี้');
            }

            const blackMarketEngine = getGameEngine('blackmarket');
            const result = blackMarketEngine.submitMarketPurchase(room, playerId, itemId);
            emitBlackMarketState(room);

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
            const roomId = socket.roomId || data?.roomId;
            const playerId = socket.playerId || data?.playerId;
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
            emitBlackMarketState(room);

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
            const roomId = socket.roomId || data?.roomId;
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

            sendChatMessageToRoom(io, roomId, 'System', 'คืนนี้ปิดโต๊ะก่อน กลับไปตั้งเกมใหม่ในห้อง', '#9b59b6');
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
                    emitBlackMarketState(currentRoom);
                    room.gameStarting = false;
                    return;
                }

                // สุ่มบทบาทก่อนเริ่มเกม
                randomRoles(currentRoom.gameState, currentRoom.settings);
                currentRoom.gameState.status = 'role';
                // ตั้งคำอัตโนมัติทันที (GM ยังแก้ได้ก่อนเปิดเผย)
                currentRoom.gameState.word = getWord(wordFamille);
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
                                isGhost: gamePlayer.isGhost,
                                status: currentRoom.gameState.status
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

                room.gameStarting = false;
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
        
        // นับจำนวนผู้ทรยศในเกมนี้
        const numTraitors = room.gameState.players.filter(p => p.role === traitorRole).length;

        // Broadcast newRole แบบเดิม + เพิ่มข้อมูล dual traitor mode
        io.to(roomId).emit('newRole', { 
            players: room.gameState.players,
            status: room.gameState.status,
            dualTraitorMode: room.settings.dualTraitorMode,
            numTraitors: numTraitors
        });
        
        // Send chat notification
        const modeMsg = numTraitors === 2 ? ' (โหมด 2 ผู้ทรยศ!)' : '';
        sendChatMessageToRoom(io, roomId, 'System', `เริ่มเกมใหม่! บทบาทถูกสุ่มแล้ว${modeMsg}`, '#9b59b6');
        addServerLog(io, 'game', roomId, `🎮 เกมเริ่มแล้ว! สุ่มบทบาท${modeMsg}`, 'success');
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
        addServerLog(io, 'game', roomId, `📝 คำเปิดเผย: ${room.gameState.word}`, 'info');
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

    // Word found - ไปโหวต 2 เลย (ตัดโหวต 1 ออก)
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

        // ไปโหวต 2 เลย ไม่ต้องผ่านโหวต 1
        resetVote(room.gameState, 2);
        const numTraitors = room.gameState.players.filter(p => p.role === traitorRole).length;
        io.to(roomId).emit('displayVote2', {
            players: room.gameState.players.filter(isNotGameMaster),
            numTraitors: numTraitors,
            progress: buildVote2Progress(room.gameState)
        });
        room.gameState.status = 'vote2';
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
            players: room.gameState.players.filter(isNotGameMaster),
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

        const player = room.gameState.players.find(p => p.playerId === playerId);
        if (!player || object.player !== player.name) return;

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
        player._votingInProgress2 = true;

        // รองรับทั้ง vote (1 คน) และ votes (2 คน)
        if (object.votes && Array.isArray(object.votes)) {
            // โหมด 2 ผู้ทรยศ - votes เป็น array
            player.vote2 = object.votes; // เก็บเป็น array
        } else {
            player.vote2 = object.vote; // เก็บเป็น string (โหมดปกติ)
        }
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

            // Send chat notification
            const resultMsg = room.gameState.resultVote2.hasWon ? 'พลเมืองชนะ!' : 'ผู้ทรยศชนะ!';
            sendChatMessageToRoom(io, roomId, 'System', `เกมจบ! ${resultMsg}`, '#f39c12');
            
            // Game log for end
            const traitorName = room.gameState.resultVote2.finalTraitorName || 'ไม่ทราบ';
            if (room.gameState.resultVote2.hasWon) {
                addServerLog(io, 'game', roomId, `🎉 พลเมืองชนะ! (ผู้ทรยศ: ${traitorName})`, 'success');
            } else {
                addServerLog(io, 'game', roomId, `💀 ผู้ทรยศชนะ! (ผู้ทรยศ: ${traitorName})`, 'error');
            }

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

        sendChatMessageToRoom(io, roomId, player.playerName, safeMessage, player.color, data.replyTo, playerId, player.avatar || '👤');
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
                                                io.to(roomId).emit('roomUpdate', buildRoomUpdatePayload(updatedRoom));
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
async function startServer() {
    try {
        // Initialize player manager with MongoDB if available
        await playerManager.initPlayerManager();
        console.log('✅ Player Manager initialized');
        
        // Initialize stats manager with MongoDB if available
        await statsManager.initStatsManager();
        console.log('✅ Stats Manager initialized');

        const repairedStatsNames = await statsManager.repairStatsPlayerNames(playerManager.getAllPlayers());
        if (repairedStatsNames.repairedCount > 0) {
            console.log(`✅ Repaired ${repairedStatsNames.repairedCount} stats player names`);
        }
    } catch (e) {
        console.log('⚠️ Starting without MongoDB:', e.message);
    }
    
    server.listen(PORT, () => {
        console.log(`Server started on port ${PORT}`);
        console.log('Multi-Room Insider Game is ready!');
        
        // Add startup log
        serverLogs.unshift({
            id: Date.now() + '-startup',
            timestamp: new Date().toISOString(),
            category: 'system',
            roomId: null,
            roomName: 'ระบบ',
            message: '🚀 Server เริ่มทำงานแล้ว',
            type: 'success'
        });
    });
}

startServer();

setInterval(runRoomCleanupSweep, ROOM_SWEEP_INTERVAL_MS);
