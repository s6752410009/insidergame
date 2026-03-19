/**
 * Database Connection Manager
 * เชื่อมต่อ MongoDB
 */

const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
    if (isConnected) {
        return;
    }

    const mongoUrl = process.env.MONGO_URL;
    
    if (!mongoUrl) {
        console.log('⚠️ MONGO_URL not found, using JSON file fallback');
        return false;
    }

    try {
        await mongoose.connect(mongoUrl, {
            serverSelectionTimeoutMS: 10000
        });
        isConnected = true;
        console.log('✅ Connected to MongoDB');
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        return false;
    }
}

function isDBConnected() {
    return isConnected;
}

module.exports = {
    connectDB,
    isDBConnected,
    mongoose
};
