// Staging always uses its own JSON data, even if shared Coolify variables exist.
const { randomBytes } = require('node:crypto');
process.env.MONGO_URL = '';
process.env.MONGODB_URI = '';
process.env.GAME_DATA_DIR = '/data';
process.env.SESSION_SECRET = process.env.STAGING_SESSION_SECRET || randomBytes(48).toString('hex');
process.env.PUBLIC_BASE_URL = process.env.STAGING_PUBLIC_BASE_URL || '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.ADMIN_PASSWORD = '';
process.env.APP_ENV = 'staging';
require('../app');
