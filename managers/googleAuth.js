/**
 * ตรวจ ID token จากปุ่ม "Sign in with Google" (Google Identity Services)
 *
 * ตรวจลายเซ็นกับกุญแจสาธารณะของ Google เอง ไม่ต้องลง library เพิ่ม
 * ต้องตั้ง GOOGLE_CLIENT_ID ใน environment — ไม่ตั้ง = ปิดฟีเจอร์ล็อกอิน Google ทั้งหมด
 */

const crypto = require('crypto');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;

let cachedKeys = null; // kid -> KeyObject
let cachedUntil = 0;

function isEnabled() {
    return Boolean(GOOGLE_CLIENT_ID);
}

function decodeSegment(segment) {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

async function loadKeys(forceRefresh = false) {
    if (!forceRefresh && cachedKeys && Date.now() < cachedUntil) return cachedKeys;
    const response = await fetch(JWKS_URL);
    if (!response.ok) throw new Error(`โหลดกุญแจ Google ไม่ได้ (${response.status})`);
    const { keys } = await response.json();
    const map = new Map();
    (keys || []).forEach(jwk => {
        if (jwk.kid && jwk.kty === 'RSA') map.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    });
    // Google บอกอายุ cache ใน header — ไม่มีก็เก็บไว้ 1 ชม.
    const maxAge = Number((response.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]) || 3600;
    cachedKeys = map;
    cachedUntil = Date.now() + maxAge * 1000;
    return map;
}

/**
 * คืน { sub, email, name } ถ้า token ถูกต้อง ไม่งั้น throw
 */
async function verifyGoogleIdToken(idToken) {
    if (!isEnabled()) throw new Error('ยังไม่ได้เปิดใช้การล็อกอินด้วย Google');
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new Error('ข้อมูลล็อกอินไม่ถูกต้อง');

    const header = decodeSegment(parts[0]);
    const payload = decodeSegment(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) throw new Error('ข้อมูลล็อกอินไม่ถูกต้อง');

    let keys = await loadKeys();
    if (!keys.has(header.kid)) keys = await loadKeys(true); // Google หมุนกุญแจแล้ว
    const key = keys.get(header.kid);
    if (!key) throw new Error('ข้อมูลล็อกอินไม่ถูกต้อง');

    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    if (!crypto.verify('RSA-SHA256', signedData, key, signature)) {
        throw new Error('ข้อมูลล็อกอินไม่ถูกต้อง');
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('ข้อมูลล็อกอินไม่ได้ออกให้เว็บนี้');
    if (!VALID_ISSUERS.has(payload.iss)) throw new Error('ข้อมูลล็อกอินไม่ถูกต้อง');
    if (!payload.exp || payload.exp + CLOCK_SKEW_SECONDS < now) throw new Error('ล็อกอินหมดอายุ ลองกดใหม่อีกครั้ง');
    if (!payload.sub) throw new Error('ข้อมูลล็อกอินไม่ถูกต้อง');
    if (payload.email && payload.email_verified === false) throw new Error('อีเมล Google นี้ยังไม่ได้ยืนยัน');

    return {
        sub: String(payload.sub),
        email: payload.email ? String(payload.email) : null,
        name: payload.name ? String(payload.name) : null
    };
}

module.exports = {
    GOOGLE_CLIENT_ID,
    isEnabled,
    verifyGoogleIdToken
};
