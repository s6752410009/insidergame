#!/usr/bin/env node
/**
 * Local dev entry — logs immediately, default port 8082 (8080 often taken by ssh tunnel).
 */
if (!process.env.PORT) {
    process.env.PORT = '8082';
}
process.env.INSIDER_DEV_FAST = process.env.INSIDER_DEV_FAST || '1';

console.log(`[dev] loading app (PORT=${process.env.PORT})...`);
console.time('[dev] app.js load');
require('../app.js');
console.timeEnd('[dev] app.js load');
