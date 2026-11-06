const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
module.exports = name => {
    if (!process.env.TEST_ARTIFACT_DIR) return fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
    const directory = path.resolve(process.env.TEST_ARTIFACT_DIR, name);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
};
