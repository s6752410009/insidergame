#!/usr/bin/env node
const https = require('https');
const manifest = require('../data/game-image-sources.json');

function head(url) {
    return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'InsiderGame/1.0' } }, (res) => {
            resolve(res.statusCode);
            res.resume();
        }).on('error', () => resolve(0));
    });
}

(async () => {
    for (const [game, entries] of Object.entries(manifest)) {
        for (const [id, url] of Object.entries(entries)) {
            const code = await head(url);
            console.log(code === 200 ? 'OK' : code, `${game}/${id}`);
        }
    }
})();
