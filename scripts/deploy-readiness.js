#!/usr/bin/env node
// Read-only public room list: never registers a player, joins a room, or sends game actions.
const { io } = require('socket.io-client');
function summarize(rooms) {
    if (!Array.isArray(rooms)) throw new Error('Invalid room list');
    const result = rooms.map(room => {
        if (!room.roomId || !['waiting', 'playing', 'finished'].includes(room.gameStatus)
            || !Number.isInteger(room.onlineCount) || room.onlineCount < 0
            || !Number.isInteger(room.playerCount) || room.playerCount < 0) throw new Error('Unknown room state; refusing deployment');
        return { roomId: room.roomId, gameMode: room.gameMode, status: room.gameStatus, players: room.playerCount, online: room.onlineCount };
    });
    return { rooms: result, onlineInRooms: result.reduce((n, room) => n + room.online, 0), safeToDeploy: !result.some(room => room.status === 'playing') };
}
async function inspect(base = 'https://www.insider-th.me') {
    const socket = io(base, { transports: ['websocket'], reconnection: false, forceNew: true, timeout: 15000, autoConnect: false });
    try {
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
        const response = await new Promise((resolve, reject) => socket.timeout(10000).emit('getRoomList', (error, result) => error ? reject(error) : resolve(result)));
        if (!response?.success) throw new Error('Cannot inspect live rooms');
        return summarize(response.rooms);
    } finally { socket.disconnect(); }
}
if (require.main === module) inspect().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.safeToDeploy) { console.error('Deployment paused: a game is in progress. Wait or obtain explicit interruption confirmation.'); process.exitCode = 2; }
}).catch(error => { console.error('Deployment paused: ' + error.message); process.exitCode = 1; });
module.exports = { inspect, summarize };
