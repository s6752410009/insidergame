const insiderEngine = require('./insiderEngine');
const werewolfEngine = require('./werewolfEngine');

const ENGINES = {
    insider: insiderEngine,
    werewolf: werewolfEngine
};

function normalizeGameMode(gameMode) {
    if (typeof gameMode !== 'string') {
        return 'insider';
    }

    const normalizedMode = gameMode.trim().toLowerCase();
    return ENGINES[normalizedMode] ? normalizedMode : 'insider';
}

function getGameEngine(gameMode) {
    return ENGINES[normalizeGameMode(gameMode)];
}

function getAvailableGameModes() {
    return Object.values(ENGINES).map(engine => ({
        id: engine.id,
        label: engine.label,
        description: engine.description
    }));
}

module.exports = {
    normalizeGameMode,
    getGameEngine,
    getAvailableGameModes
};