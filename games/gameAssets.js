const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'games');
const EXT_PRIORITY = ['.jpg', '.png', '.webp', '.svg'];
const extCache = new Map();

function resolveExt(game, id) {
    const key = `${game}/${id}`;
    if (extCache.has(key)) {
        return extCache.get(key);
    }

    const dir = path.join(ROOT, game);
    for (const ext of EXT_PRIORITY) {
        if (fs.existsSync(path.join(dir, `${id}${ext}`))) {
            extCache.set(key, ext);
            return ext;
        }
    }

    // Default to jpg for role portraits; boards still fall back to emoji if missing.
    extCache.set(key, '.jpg');
    return '.jpg';
}

// Prefer AI portrait JPG, then PNG/WebP, then SVG icon.
function gameAssetImage(game, id) {
    return `/assets/games/${game}/${id}${resolveExt(game, id)}`;
}

module.exports = { gameAssetImage };
