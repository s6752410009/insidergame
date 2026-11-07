// Prefer Playwright's pinned browser locally and in CI. System Chrome is a fallback
// for macOS checkouts that have not installed the Playwright browser yet.
const fs = require('node:fs');
module.exports = () => {
    if (process.env.PLAYWRIGHT_CHANNEL) return { headless:true, channel:process.env.PLAYWRIGHT_CHANNEL };
    if (!process.env.CI && process.platform === 'darwin'
        && !fs.existsSync(require('playwright').chromium.executablePath())) return { headless:true, channel:'chrome' };
    return { headless:true };
};
