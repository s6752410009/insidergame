/**
 * ชุดทดสอบล็อกอิน Google แบบไม่ต้องต่อเน็ต
 *
 * - สร้างกุญแจ RSA ของเทสเอง แล้วเซ็น ID token ปลอมด้วยกุญแจนั้น
 * - preload (node -r scripts/googleAuthTestKit.js) ดักเฉพาะ fetch ไปที่ JWKS ของ Google
 *   ให้คืนกุญแจสาธารณะจาก env GOOGLE_TEST_JWKS — โค้ดจริง (managers/googleAuth.js)
 *   ยังตรวจลายเซ็น/aud/iss/exp ครบทุกขั้น ไม่มี test hook ในโค้ด production
 *
 * ใช้เฉพาะในสคริปต์เทส ห้าม require จาก app.js
 */

const crypto = require('crypto');

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const TEST_CLIENT_ID = 'test-client.apps.googleusercontent.com';

function createKit() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'test-kid-' + crypto.randomBytes(4).toString('hex');
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid, kty: 'RSA', alg: 'RS256', use: 'sig' };

    function signIdToken(claims = {}) {
        const now = Math.floor(Date.now() / 1000);
        const header = { alg: 'RS256', kid, typ: 'JWT' };
        const payload = {
            iss: 'https://accounts.google.com',
            aud: TEST_CLIENT_ID,
            iat: now,
            exp: now + 3600,
            email_verified: true,
            ...claims
        };
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const signingInput = `${encode(header)}.${encode(payload)}`;
        const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
        return `${signingInput}.${signature}`;
    }

    return {
        clientId: TEST_CLIENT_ID,
        jwks: { keys: [jwk] },
        // env สำหรับ spawn เซิร์ฟเวอร์ที่ใช้กุญแจชุดนี้
        serverEnv() {
            return {
                GOOGLE_CLIENT_ID: TEST_CLIENT_ID,
                GOOGLE_TEST_JWKS: JSON.stringify({ keys: [jwk] }),
                NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} -r ${__filename}`.trim()
            };
        },
        signIdToken
    };
}

function installJwksStub(jwks) {
    const realFetch = global.fetch;
    global.fetch = async function stubbedFetch(url, ...rest) {
        if (String(url) === JWKS_URL) {
            return new Response(JSON.stringify(jwks), {
                status: 200,
                headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' }
            });
        }
        return realFetch(url, ...rest);
    };
}

// โหมด preload: มี GOOGLE_TEST_JWKS ใน env → ดัก fetch ของโปรเซสนี้
if (process.env.GOOGLE_TEST_JWKS) {
    installJwksStub(JSON.parse(process.env.GOOGLE_TEST_JWKS));
}

module.exports = { createKit, installJwksStub, TEST_CLIENT_ID, JWKS_URL };
