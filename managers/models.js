/**
 * MongoDB Models
 * Schema definitions for Player, PlayerStats, BannedPlayer
 */

const mongoose = require('mongoose');

function createDefaultWerewolfRoleStats() {
    return {
        villager: 0,
        werewolf: 0,
        alphaWolf: 0,
        mayor: 0,
        bodyguard: 0,
        seer: 0,
        doctor: 0,
        witch: 0,
        fool: 0,
        revealer: 0
    };
}

function createDefaultRoleStats() {
    return {
        gameMasterCount: 0,
        traitorCount: 0,
        citizenCount: 0,
        werewolf: createDefaultWerewolfRoleStats()
    };
}

function createDefaultWinByRole() {
    return {
        winAsTraitor: 0,
        winAsCitizen: 0,
        werewolf: createDefaultWerewolfRoleStats()
    };
}

function createDefaultModeStats() {
    return {
        insider: { games: 0, wins: 0, losses: 0 },
        werewolf: { games: 0, wins: 0, losses: 0 }
    };
}

// Player Schema
const playerSchema = new mongoose.Schema({
    playerId: { type: String, required: true, unique: true, index: true },
    playerName: { type: String, required: true },
    color: { type: String, default: '#3498db' },
    avatar: { type: String, default: '👤' },
    avatarFrame: { type: String, default: 'none' },
    createdAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now }
}, { timestamps: true });

// Player Stats Schema
const playerStatsSchema = new mongoose.Schema({
    playerId: { type: String, required: true, unique: true, index: true },
    playerName: { type: String },
    totalGames: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    roleStats: { type: mongoose.Schema.Types.Mixed, default: createDefaultRoleStats },
    winByRole: { type: mongoose.Schema.Types.Mixed, default: createDefaultWinByRole },
    modeStats: { type: mongoose.Schema.Types.Mixed, default: createDefaultModeStats },
    lastPlayedAt: { type: Date },
    gameHistory: { type: Array, default: [] }
}, { timestamps: true });

// Banned Player Schema
const bannedPlayerSchema = new mongoose.Schema({
    playerId: { type: String, required: true, unique: true, index: true },
    playerName: { type: String },
    reason: { type: String, default: 'ไม่ระบุเหตุผล' },
    bannedAt: { type: Date, default: Date.now },
    bannedBy: { type: String, default: 'Admin' },
    expiresAt: { type: Date },
    isPermanent: { type: Boolean, default: false },
    durationHours: { type: Number }
}, { timestamps: true });

const Player = mongoose.model('Player', playerSchema);
const PlayerStats = mongoose.model('PlayerStats', playerStatsSchema);
const BannedPlayer = mongoose.model('BannedPlayer', bannedPlayerSchema);

module.exports = {
    Player,
    PlayerStats,
    BannedPlayer
};
