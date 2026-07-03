#!/usr/bin/env node
/**
 * Download game card images from URLs in data/game-image-sources.json
 * Sources: Unsplash (free to use per Unsplash License — https://unsplash.com/license)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SOURCES = path.join(ROOT, 'data', 'game-image-sources.json');
const LABELS = path.join(ROOT, 'data', 'game-image-labels.json');
const EXT = '.jpg';

let labelManifest = {};
try {
    labelManifest = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
} catch (e) {
    labelManifest = {};
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, {
            headers: { 'User-Agent': 'InsiderGameAssetFetcher/1.0' }
        }, (response) => {
            if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
                response.resume();
                return fetchUrl(response.headers.location).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
            }
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        request.on('error', reject);
        request.setTimeout(30000, () => {
            request.destroy(new Error(`Timeout: ${url}`));
        });
    });
}

function labelFallback(game, id) {
    const label = labelManifest[game]?.[id] || id.toUpperCase();
    return `https://placehold.co/256x256/1a2332/e8c468/png?text=${encodeURIComponent(label)}`;
}

async function downloadOne(game, id, primaryUrl) {
    try {
        const buffer = await fetchUrl(primaryUrl);
        if (buffer.length < 500) {
            throw new Error('response too small');
        }
        return { buffer, source: 'primary' };
    } catch (primaryError) {
        const fallbackUrl = labelFallback(game, id);
        const buffer = await fetchUrl(fallbackUrl);
        if (buffer.length < 500) {
            throw primaryError;
        }
        return { buffer, source: 'label-card' };
    }
}

async function downloadGame(game, entries) {
    const outDir = path.join(ROOT, 'public', 'assets', 'games', game);
    fs.mkdirSync(outDir, { recursive: true });

    let ok = 0;
    let fail = 0;

    for (const [id, url] of Object.entries(entries)) {
        const dest = path.join(outDir, `${id}${EXT}`);
        process.stdout.write(`  ${game}/${id}${EXT} ... `);
        try {
            const { buffer, source } = await downloadOne(game, id, url);
            fs.writeFileSync(dest, buffer);
            console.log(source === 'primary' ? 'ok' : 'ok (label card fallback)');
            ok += 1;
        } catch (error) {
            console.log(`fail (${error.message})`);
            fail += 1;
        }
    }

    return { ok, fail };
}

async function main() {
    const manifest = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
    let totalOk = 0;
    let totalFail = 0;

    for (const [game, entries] of Object.entries(manifest)) {
        console.log(`\n[${game}]`);
        const result = await downloadGame(game, entries);
        totalOk += result.ok;
        totalFail += result.fail;
    }

    console.log(`\nDone: ${totalOk} ok, ${totalFail} failed`);
    if (totalFail > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
