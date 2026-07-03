// Single source of truth for game asset URLs (served from public/assets/games/)
function gameAssetImage(game, id) {
    return `/assets/games/${game}/${id}.svg`;
}

module.exports = { gameAssetImage };
