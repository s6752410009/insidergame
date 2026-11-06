// CI uses the Chromium installed by Playwright; local macOS keeps the existing Chrome setup.
module.exports = () => ({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : !process.env.CI && process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
