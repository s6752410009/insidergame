const defaultRole = 'พลเมือง';

function createInitialState() {
    return {
        mode: 'insider',
        players: [],
        word: '',
        countdown: null,
        resultVote1: null,
        resultVote2: null,
        status: '',
        lastAction: 0
    };
}

function createPlayerState(player, context = {}) {
    return {
        playerId: player.playerId,
        socketId: context.socketId || null,
        name: player.playerName,
        color: player.color,
        avatar: player.avatar || '👤',
        avatarFrame: player.avatarFrame || 'none',
        role: '',
        vote1: null,
        vote2: null,
        nbVote2: 0,
        isGhost: false,
        permission: context.isAdmin ? 'admin' : null
    };
}

function resetRoomGame(room) {
    return {
        ...createInitialState(),
        players: room.players.map(player => ({
            ...createPlayerState({
                playerId: player.playerId,
                playerName: player.playerName,
                color: player.color,
                avatar: player.avatar,
                avatarFrame: player.avatarFrame
            }, {
                socketId: player.socketId,
                isAdmin: player.permission === 'admin'
            }),
            role: defaultRole
        }))
    };
}

module.exports = {
    id: 'insider',
    label: 'Insider',
    description: 'เกม Insider ที่ทุกคนจะได้รับบทบาทและต้องเดาคำลับจากคำใบ้ที่ผู้เล่นคนหนึ่งรู้คำลับนั้น',
    createInitialState,
    createPlayerState,
    resetRoomGame
};