const insiderEngine = require('./insiderEngine');
const blackMarketEngine = require('./blackMarketEngine');
const werewolfEngine = require('./werewolfEngine');

const ENGINES = {
    insider: insiderEngine,
    blackmarket: blackMarketEngine,
    werewolf: werewolfEngine
};

function normalizeGameMode(gameMode) {
    if (typeof gameMode !== 'string') {
        return 'insider';
    }

    const normalizedMode = gameMode.trim().toLowerCase();
    if (ENGINES[normalizedMode]) {
        return normalizedMode;
    }

    const compactMode = normalizedMode.replace(/[\s_-]+/g, '');
    const aliases = {
        blackmarket: 'blackmarket',
        blackmkt: 'blackmarket',
        blackmarketmode: 'blackmarket'
    };

    return ENGINES[aliases[compactMode]] ? aliases[compactMode] : 'insider';
}

function getGameEngine(gameMode) {
    return ENGINES[normalizeGameMode(gameMode)];
}

function getAvailableGameModes() {
    return Object.values(ENGINES).map(engine => ({
        id: engine.id,
        label: engine.label,
        description: engine.description,
        minPlayers: Number(engine.minPlayers || 3),
        maxPlayers: Number(engine.maxPlayers || 10)
    }));
}

module.exports = {
    normalizeGameMode,
    getGameEngine,
    getAvailableGameModes
};