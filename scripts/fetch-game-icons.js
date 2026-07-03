#!/usr/bin/env node
/**
 * Download consistent SVG icons (Game Icons via Iconify API).
 * License: CC BY 3.0 — https://game-icons.net/
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const MAP = path.join(ROOT, 'data', 'game-icon-map.json');
const COLOR = '%23f5c86b';

function fetchSvg(iconRef) {
    const url = `https://api.iconify.design/${iconRef}.svg?color=${COLOR}&width=128&height=128`;
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'InsiderGameIconFetcher/1.0' } }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                return fetchSvg(iconRef).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} for ${iconRef}`));
            }
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}

function wrapCardSvg(inner, id) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${id}">
  <rect width="120" height="120" rx="18" fill="#1a2332"/>
  <g transform="translate(16 16) scale(0.69)">${inner.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>
</svg>`;
}

async function main() {
    const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
    let ok = 0;
    let fail = 0;

    for (const [game, entries] of Object.entries(map)) {
        const outDir = path.join(ROOT, 'public', 'assets', 'games', game);
        fs.mkdirSync(outDir, { recursive: true });
        console.log(`\n[${game}]`);

        for (const [id, iconRef] of Object.entries(entries)) {
            const dest = path.join(outDir, `${id}.svg`);
            process.stdout.write(`  ${id}.svg ... `);
            try {
                const raw = await fetchSvg(iconRef);
                if (!raw.includes('<svg')) {
                    throw new Error('invalid svg');
                }
                fs.writeFileSync(dest, wrapCardSvg(raw, id));
                console.log('ok');
                ok += 1;
            } catch (error) {
                console.log(`fail (${error.message})`);
                fail += 1;
            }
        }
    }

    console.log(`\nDone: ${ok} ok, ${fail} failed`);
    if (fail > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
