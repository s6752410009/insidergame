/**
 * Script to check MongoDB collections and data
 * Run: MONGO_URL="your-mongo-url" node scripts/uploadStats.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB connection - use PUBLIC URL for local access
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongo:LyvzhhmQFIlaSZgphLeTzxMoffxmHDKO@nozomi.proxy.rlwy.net:32138';

async function checkMongoDB() {
    try {
        console.log('Connecting to MongoDB...');
        console.log('URL:', MONGO_URL.replace(/:[^:@]+@/, ':****@'));
        
        await mongoose.connect(MONGO_URL);
        console.log('✅ Connected to MongoDB\n');

        // List all collections
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('📁 Collections in database:');
        collections.forEach(c => console.log('  -', c.name));
        console.log('');

        // Check playerstats collection
        const statsCollection = mongoose.connection.db.collection('playerstats');
        const statsCount = await statsCollection.countDocuments();
        console.log(`📊 playerstats: ${statsCount} documents`);
        
        if (statsCount > 0) {
            console.log('\n🏆 Top 5 players by wins:');
            const topPlayers = await statsCollection.find({})
                .sort({ wins: -1 })
                .limit(5)
                .toArray();
            topPlayers.forEach((p, i) => {
                console.log(`  ${i+1}. ${p.playerName} - ${p.totalGames} games, ${p.wins} wins`);
            });
        }

        // Check players collection
        const playersCollection = mongoose.connection.db.collection('players');
        const playersCount = await playersCollection.countDocuments();
        console.log(`\n👥 players: ${playersCount} documents`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB');
    }
}

checkMongoDB();
