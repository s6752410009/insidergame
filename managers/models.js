/**
 * MongoDB Models
 * Schema definitions for Player, PlayerStats, BannedPlayer
 */

const mongoose = require('mongoose');

// Player Schema
const playerSchema = new mongoose.Schema({
    playerId: { type: String, required: true, unique: true, index: true },
    playerName: { type: String, required: true },
    color: { type: String, default: '#3498db' },
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
    roleStats: {
        gameMasterCount: { type: Number, default: 0 },
        traitorCount: { type: Number, default: 0 },
        citizenCount: { type: Number, default: 0 }
    }
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
