const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'games');
// webp มาก่อน: ไฟล์เดียวกันเล็กกว่า jpg/png หลายเท่า (ทั้งชุด 38MB -> 2.9MB)
// เบราว์เซอร์ที่เว็บนี้รองรับ (Safari 14+/Chrome/LINE in-app) อ่าน webp ได้หมดแล้ว
const EXT_PRIORITY = ['.webp', '.jpg', '.png', '.svg'];
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

// Prefer WebP, then original JPG/PNG, then SVG icon.
function gameAssetImage(game, id) {
    return `/assets/games/${game}/${id}${resolveExt(game, id)}`;
}

module.exports = { gameAssetImage };
