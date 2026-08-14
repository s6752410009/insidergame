/**
 * Game settings — persisted defaults per mode, Insider word pools, security flags.
 */

const fs = require('fs');
const path = require('path');
const { getGameEngine, getAvailableGameModes, normalizeGameMode } = require('../games/engineRegistry');
const spyfallEngine = require('../games/spyfallEngine');

const SETTINGS_FILE = path.join(__dirname, '../data/gameSettings.json');
const WORDS_DIR = path.join(__dirname, '../words');

const DEFAULT_PROFANITY = [
    'fuck', 'shit', 'bitch', 'asshole',
    'ควย', 'เหี้ย', 'สัส', 'แม่ง', 'ไอสัส', 'ระยำ', 'ห่า', 'เย็ด'
];

const DEFAULT_SETTINGS = {
    version: 1,
    modes: {
        insider: {
            defaultMaxPlayers: 8,
            defaultRoundTimeMinutes: 5,
            traitorOptional: true,
            dualTraitorDefault: false
        },
        werewolf: {
            defaultMaxPlayers: 10
        },
        blackmarket: {
            defaultMaxPlayers: 7,
            defaultRoundTimeMinutes: 5
        },
        spyfall: {
            defaultMaxPlayers: 8,
            defaultRoundTimeMinutes: 8,
            defaultVoteTimeMinutes: 1.5
        },
        liar: {
            defaultMaxPlayers: 6
        },
        poker5: {
            defaultMaxPlayers: 4
        },
        poker4: {
            defaultMaxPlayers: 4
        }
    },
    insider: {
        wordFile: 'famille'
    },
    spyfall: {
        extraLocations: []
    },
    security: {
        banSystemEnabled: true,
        profanityFilterEnabled: false,
        requireNewPlayerApproval: false,
        profanityWords: DEFAULT_PROFANITY
    }
};

let settings = null;
const wordPools = new Map();

function deepMerge(target, source) {
    const output = { ...target };
    if (!source || typeof source !== 'object') {
        return output;
    }
    Object.keys(source).forEach(key => {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            output[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            output[key] = source[key];
        }
    });
    return output;
}

function ensureDataDir() {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadSettings() {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_FILE)) {
        settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        saveSettings();
        return settings;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        settings = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw);
    } catch (error) {
        console.error('[gameSettings] Failed to load, using defaults:', error.message);
        settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return settings;
}

function saveSettings() {
    ensureDataDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function getSettings() {
    if (!settings) {
        loadSettings();
    }
    return settings;
}

function updateSettings(partial) {
    settings = deepMerge(getSettings(), partial);
    saveSettings();
    return settings;
}

function listWordFiles() {
    if (!fs.existsSync(WORDS_DIR)) {
        fs.mkdirSync(WORDS_DIR, { recursive: true });
    }
    return fs.readdirSync(WORDS_DIR)
        .filter(name => name.endsWith('.csv'))
        .map(name => ({
            id: name.replace(/\.csv$/i, ''),
            filename: name,
            label: name.replace(/\.csv$/i, '')
        }));
}

function resolveWordFilePath(fileId) {
    const safeId = String(fileId || 'famille').replace(/[^a-z0-9_-]/gi, '');
    const filename = `${safeId || 'famille'}.csv`;
    return path.join(WORDS_DIR, filename);
}

function loadWordPool(fileId) {
    const filePath = resolveWordFilePath(fileId);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const words = fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map(word => word.trim())
        .filter(word => word.length > 0);
    wordPools.set(fileId, words);
    return words;
}

function getInsiderWordPool() {
    const fileId = getSettings().insider?.wordFile || 'famille';
    if (!wordPools.has(fileId)) {
        loadWordPool(fileId);
    }
    return wordPools.get(fileId) || [];
}

function reloadInsiderWords() {
    wordPools.clear();
    return getInsiderWordPool();
}

function getRandomInsiderWord() {
    const pool = getInsiderWordPool();
    if (!pool.length) {
        return 'คำ';
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

function addWordsToFile(fileId, words) {
    const filePath = resolveWordFilePath(fileId);
    let existing = [];
    if (fs.existsSync(filePath)) {
        existing = fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .map(word => word.trim())
            .filter(Boolean);
    } else {
        ensureDataDir();
        if (!fs.existsSync(WORDS_DIR)) {
            fs.mkdirSync(WORDS_DIR, { recursive: true });
        }
    }

    let addedCount = 0;
    words.forEach(word => {
        const trimmed = String(word).trim();
        if (!trimmed || existing.includes(trimmed)) {
            return;
        }
        existing.push(trimmed);
        addedCount += 1;
    });

    fs.writeFileSync(filePath, existing.join('\n'), 'utf8');
    loadWordPool(fileId);
    return { addedCount, total: existing.length };
}

function getWordsFromFile(fileId) {
    return loadWordPool(fileId);
}

function getModeDefaults(modeId) {
    const engine = getGameEngine(modeId);
    const stored = getSettings().modes?.[modeId] || {};
    return {
        id: modeId,
        label: engine?.label || modeId,
        minPlayers: Number(engine?.minPlayers || 3),
        maxPlayers: Number(engine?.maxPlayers || 10),
        defaultMaxPlayers: Math.min(
            Number(engine?.maxPlayers || 10),
            Math.max(Number(engine?.minPlayers || 3), Number(stored.defaultMaxPlayers || engine?.maxPlayers || 8))
        ),
        defaultRoundTimeMinutes: stored.defaultRoundTimeMinutes != null
            ? Number(stored.defaultRoundTimeMinutes)
            : (modeId === 'spyfall' ? 8 : 5),
        defaultVoteTimeMinutes: stored.defaultVoteTimeMinutes != null
            ? Number(stored.defaultVoteTimeMinutes)
            : 1.5,
        traitorOptional: stored.traitorOptional !== false,
        dualTraitorDefault: !!stored.dualTraitorDefault
    };
}

function getModeDefaultsForClient() {
    return getAvailableGameModes().map(mode => getModeDefaults(mode.id));
}

function applyCreateRoomDefaults(roomData) {
    const merged = { ...(roomData || {}) };
    merged.gameMode = normalizeGameMode(merged.gameMode || 'insider');
    const mode = merged.gameMode;
    const defaults = getModeDefaults(mode);

    if (merged.maxPlayers == null || merged.maxPlayers === '') {
        merged.maxPlayers = defaults.defaultMaxPlayers;
    }

    if (mode !== 'werewolf' && (merged.roundTime == null || merged.roundTime === '')) {
        merged.roundTime = defaults.defaultRoundTimeMinutes;
    }

    if (mode === 'insider') {
        if (merged.traitorOptional === undefined) {
            merged.traitorOptional = defaults.traitorOptional;
        }
        if (merged.dualTraitorMode === undefined) {
            merged.dualTraitorMode = defaults.dualTraitorDefault;
        }
    }

    if (mode === 'spyfall') {
        merged.spyfallVoteMinutes = merged.spyfallVoteMinutes != null
            ? merged.spyfallVoteMinutes
            : defaults.defaultVoteTimeMinutes;
    }

    return merged;
}

function getCreateRoomSettingsFromDefaults(modeId) {
    const defaults = getModeDefaults(modeId);
    const result = {
        maxPlayers: defaults.defaultMaxPlayers
    };

    if (modeId !== 'werewolf') {
        result.roundTime = defaults.defaultRoundTimeMinutes;
    }

    if (modeId === 'insider') {
        result.traitorOptional = defaults.traitorOptional;
        result.dualTraitorMode = defaults.dualTraitorDefault;
    }

    if (modeId === 'spyfall') {
        result.spyfallVoteMinutes = defaults.defaultVoteTimeMinutes;
    }

    return result;
}

function isBanSystemEnabled() {
    return getSettings().security?.banSystemEnabled !== false;
}

function isProfanityFilterEnabled() {
    return !!getSettings().security?.profanityFilterEnabled;
}

function isApprovalRequired() {
    return !!getSettings().security?.requireNewPlayerApproval;
}

function getProfanityWords() {
    const list = getSettings().security?.profanityWords;
    return Array.isArray(list) && list.length ? list : DEFAULT_PROFANITY;
}

function filterProfanity(text) {
    if (!isProfanityFilterEnabled() || typeof text !== 'string') {
        return text;
    }
    let result = text;
    getProfanityWords().forEach(word => {
        if (!word || word.length < 2) {
            return;
        }
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'gi'), '***');
    });
    return result;
}

function getSpyfallExtraLocations() {
    const extra = getSettings().spyfall?.extraLocations;
    return Array.isArray(extra) ? extra.filter(loc => loc && loc.id && loc.name) : [];
}

function buildAdminPayload() {
    const engines = getAvailableGameModes();
    return {
        settings: getSettings(),
        modeDefaults: engines.map(mode => getModeDefaults(mode.id)),
        wordFiles: listWordFiles(),
        insiderWordCount: getInsiderWordPool().length,
        spyfallLocationCount: (spyfallEngine.LOCATIONS?.length || 0) + getSpyfallExtraLocations().length
    };
}

function normalizeIncomingSettings(data) {
    if (!data || typeof data !== 'object') {
        return {};
    }

    const modes = {};
    const modeIds = ['insider', 'werewolf', 'blackmarket', 'spyfall'];
    modeIds.forEach(modeId => {
        const input = data.modes?.[modeId];
        if (!input) {
            return;
        }
        const engine = getGameEngine(modeId);
        const minP = Number(engine?.minPlayers || 3);
        const maxP = Number(engine?.maxPlayers || 10);
        modes[modeId] = {
            defaultMaxPlayers: Math.min(maxP, Math.max(minP, Number(input.defaultMaxPlayers) || minP))
        };
        if (input.defaultRoundTimeMinutes != null && modeId !== 'werewolf') {
            modes[modeId].defaultRoundTimeMinutes = Math.min(60, Math.max(1, Number(input.defaultRoundTimeMinutes) || 5));
        }
        if (modeId === 'spyfall' && input.defaultVoteTimeMinutes != null) {
            modes[modeId].defaultVoteTimeMinutes = Math.min(10, Math.max(0.5, Number(input.defaultVoteTimeMinutes) || 1.5));
        }
        if (modeId === 'insider') {
            modes[modeId].traitorOptional = !!input.traitorOptional;
            modes[modeId].dualTraitorDefault = !!input.dualTraitorDefault;
        }
    });

    return {
        modes,
        insider: data.insider?.wordFile ? { wordFile: String(data.insider.wordFile).replace(/[^a-z0-9_-]/gi, '') } : undefined,
        security: data.security ? {
            banSystemEnabled: !!data.security.banSystemEnabled,
            profanityFilterEnabled: !!data.security.profanityFilterEnabled,
            requireNewPlayerApproval: !!data.security.requireNewPlayerApproval
        } : undefined
    };
}

// Init on require
loadSettings();
reloadInsiderWords();

module.exports = {
    DEFAULT_SETTINGS,
    getSettings,
    updateSettings,
    normalizeIncomingSettings,
    listWordFiles,
    getInsiderWordPool,
    reloadInsiderWords,
    getRandomInsiderWord,
    addWordsToFile,
    getWordsFromFile,
    getModeDefaults,
    getModeDefaultsForClient,
    applyCreateRoomDefaults,
    getCreateRoomSettingsFromDefaults,
    isBanSystemEnabled,
    isProfanityFilterEnabled,
    isApprovalRequired,
    filterProfanity,
    getSpyfallExtraLocations,
    buildAdminPayload
};
