const insiderEngine = require('./insiderEngine');
const blackMarketEngine = require('./blackMarketEngine');
const werewolfEngine = require('./werewolfEngine');
const spyfallEngine = require('./spyfallEngine');
const coupEngine = require('./coupEngine');
const liarEngine = require('./liarEngine');
const { poker5, poker4 } = require('./pokerEngine');

const ENGINES = {
    insider: insiderEngine,
    blackmarket: blackMarketEngine,
    werewolf: werewolfEngine,
    spyfall: spyfallEngine,
    coup: coupEngine,
    liar: liarEngine,
    poker5,
    poker4
};

function isPokerMode(gameMode) {
    return gameMode === 'poker5' || gameMode === 'poker4';
}

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
        blackmarketmode: 'blackmarket',
        spyfall: 'spyfall',
        spy: 'spyfall',
        secretplace: 'spyfall',
        coup: 'coup',
        coupgame: 'coup',
        liar: 'liar',
        liarsbar: 'liar',
        liarbar: 'liar',
        cheat: 'liar',
        โกหก: 'liar',
        ไพ่โกหก: 'liar',
        poker5: 'poker5',
        poker4: 'poker4',
        holdem: 'poker5',
        texasholdem: 'poker5',
        ห้าใบเลือกสาม: 'poker5',
        โป๊กเกอร์5ใบ: 'poker5',
        ไพ่5ใบ: 'poker5',
        สี่ใบเก: 'poker4',
        '4ใบเก': 'poker4',
        fourcard: 'poker4'
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
    getAvailableGameModes,
    isPokerMode
};