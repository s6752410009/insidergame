/**
 * ป๊อกเด้งท้าเจ้ามือ — เล่นคนเดียวกับเจ้ามือบอท
 *
 * เซิร์ฟเวอร์เป็นคนสับ/แจก/ตัดสินทั้งหมด (กันโกง) — client แค่ส่ง "ลงเท่าไหร่" กับ "จั่ว/อยู่"
 *   POST /api/solo/pokdengsolo/start  { fresh?: true }   เริ่มรอบใหม่ (หรือคืนรอบเดิมที่ยังเล่นอยู่)
 *   GET  /api/solo/pokdengsolo/state                     สถานะรอบปัจจุบัน + สถิติ
 *   POST /api/solo/pokdengsolo/bet    { amount, hand }   ลงเดิมพัน + แจกไพ่ (hand = เลขมือที่คาดไว้ กันกดซ้ำ)
 *   POST /api/solo/pokdengsolo/act    { action: 'draw'|'stay', hand }
 *
 * ที่เก็บข้อมูล (ผ่าน soloStats):
 *   gameId 'pokdengsolo'      → สถิติสาธารณะ (หน้า /solo, ตารางอันดับ, GET /stats)
 *   gameId 'pokdengsolo.run'  → รอบที่เล่นอยู่ รวมสำรับที่ยังไม่แจก (ลับ — ไม่มี endpoint ไหนส่งออกไปตรงๆ)
 * POST /result แบบทั่วไปถูกปฏิเสธเสมอ ผลทุกมือบันทึกจากฝั่งเซิร์ฟเวอร์เท่านั้น
 */

const crypto = require('crypto');
const engine = require('../pokdengSoloEngine');

const GAME_ID = 'pokdengsolo';
const RUN_KEY = 'pokdengsolo.run';

const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const fmt = n => Number(n || 0).toLocaleString('en-US');

function loadRun(soloStats, playerId) {
    const raw = soloStats.getData(playerId, RUN_KEY);
    const run = engine.reviveRun(raw ? JSON.parse(JSON.stringify(raw)) : null);
    return run;
}

function saveRun(soloStats, playerId, run) {
    soloStats.setData(playerId, RUN_KEY, run);
}

function payload(run, stats) {
    return {
        success: true,
        state: engine.publicView(run),
        stats: engine.normalizeStats(stats)
    };
}

module.exports = {
    meta: {
        id: GAME_ID,
        order: 40,
        title: 'ป๊อกเด้งท้าเจ้ามือ',
        emoji: '🃏',
        tagline: 'ดวลเจ้ามือบอท 1 ต่อ 1 เริ่ม 1,000 ชิป ปั้นให้สูงที่สุดก่อนหมดตัว',
        accent: '#e2574c',
        cover: '/assets/games/solo/pokdengsolo/cover.svg'
    },

    recordResult() {
        throw new Error('ผลของเกมนี้บันทึกจากโต๊ะฝั่งเซิร์ฟเวอร์เท่านั้น');
    },

    summary(data) {
        const s = engine.normalizeStats(data);
        if (!s.handsPlayed) return null;
        return `สูงสุด ${fmt(s.bestPeak)} ชิป · ป๊อก ${fmt(s.pokCount)} ครั้ง`;
    },

    leaderboardEntry(data) {
        const s = engine.normalizeStats(data);
        if (!s.handsPlayed || !s.bestPeak) return null;
        return { score: s.bestPeak, label: `${fmt(s.bestPeak)} ชิป` };
    },
    leaderboardOrder: 'desc',

    registerRoutes(router, helpers) {
        const { getPlayerId, soloStats, rateLimit, ensurePersistedPlayer } = helpers;

        function identify(req, res, bucket, max) {
            const playerId = getPlayerId(req);
            if (!playerId) {
                res.status(403).json({ success: false, error: 'เปิดหน้าใหม่แล้วลองอีกครั้ง' });
                return null;
            }
            if (!rateLimit(`${GAME_ID}:${bucket}:${playerId}`, max, 60 * 1000)) {
                res.status(429).json({ success: false, error: 'กดถี่เกินไป รอสักครู่' });
                return null;
            }
            return playerId;
        }
        const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
        router.use(noStore);

        router.get('/state', (req, res) => {
            const playerId = identify(req, res, 'state', 120);
            if (!playerId) return;
            const run = loadRun(soloStats, playerId);
            res.json(payload(run, soloStats.getData(playerId, GAME_ID)));
        });

        router.post('/start', async (req, res) => {
            const playerId = identify(req, res, 'start', 20);
            if (!playerId) return;
            try {
                if (typeof ensurePersistedPlayer === 'function') await ensurePersistedPlayer(playerId);
            } catch (error) {
                console.error('[pokdengsolo] start: ensurePersistedPlayer failed:', error.message);
                return res.status(403).json({ success: false, error: 'เปิดหน้าใหม่แล้วลองอีกครั้ง' });
            }
            // อ่าน run หลัง await เท่านั้น (ไม่มี await คั่นระหว่างอ่าน-เขียน)
            const current = loadRun(soloStats, playerId);
            const fresh = req.body && req.body.fresh === true;
            if (current && current.phase === 'draw') {
                return res.status(409).json({ success: false, error: 'เล่นมือนี้ให้จบก่อน', ...payload(current, soloStats.getData(playerId, GAME_ID)) });
            }
            if (current && current.phase === 'bet' && !fresh) {
                return res.json(payload(current, soloStats.getData(playerId, GAME_ID)));
            }
            const run = engine.createRun({ now: Date.now(), runId: `r${Date.now().toString(36)}${crypto.randomInt(0, 1296).toString(36)}` });
            saveRun(soloStats, playerId, run);
            const stats = engine.applyRunStartToStats(soloStats.getData(playerId, GAME_ID), run);
            soloStats.setData(playerId, GAME_ID, stats);
            return res.json(payload(run, stats));
        });

        router.post('/bet', (req, res) => {
            const playerId = identify(req, res, 'play', 120);
            if (!playerId) return;
            const body = req.body || {};
            const run = loadRun(soloStats, playerId);
            if (!run) return res.status(409).json({ success: false, error: 'ยังไม่ได้เริ่มรอบ', state: null });
            const expected = Number(body.hand);
            // กดซ้ำ/ส่งซ้ำตอนเน็ตกระตุก: มือนี้เริ่มไปแล้ว → คืนสถานะปัจจุบัน ไม่หักชิปซ้ำ
            // รวมกรณีมือจบทันทีตอนลงเดิมพัน (มีป๊อก) — phase วนกลับเป็น 'bet' แล้ว แต่ lastResult ยังเป็นมือนี้
            const alreadyPlayed = run.phase !== 'bet' || (run.lastResult && run.lastResult.handNo === expected);
            if (Number.isInteger(expected) && expected === run.handNo && alreadyPlayed) {
                return res.json({ replay: true, ...payload(run, soloStats.getData(playerId, GAME_ID)) });
            }
            if (Number.isInteger(expected) && expected !== run.handNo + 1) {
                return res.status(409).json({ success: false, error: 'สถานะโต๊ะเปลี่ยนไปแล้ว', ...payload(run, soloStats.getData(playerId, GAME_ID)) });
            }
            try {
                engine.placeBet(run, body.amount, { rng: cryptoRng });
            } catch (error) {
                return res.status(400).json({ success: false, error: error.message, ...payload(run, soloStats.getData(playerId, GAME_ID)) });
            }
            saveRun(soloStats, playerId, run);
            let stats = soloStats.getData(playerId, GAME_ID);
            if (run.phase !== 'draw') {
                stats = engine.applyHandToStats(stats, run);
                soloStats.setData(playerId, GAME_ID, stats);
            }
            return res.json(payload(run, stats));
        });

        router.post('/act', (req, res) => {
            const playerId = identify(req, res, 'play', 120);
            if (!playerId) return;
            const body = req.body || {};
            const action = body.action;
            if (action !== 'draw' && action !== 'stay') {
                return res.status(400).json({ success: false, error: 'เลือกจั่วหรืออยู่' });
            }
            const run = loadRun(soloStats, playerId);
            if (!run) return res.status(409).json({ success: false, error: 'ยังไม่ได้เริ่มรอบ', state: null });
            const expected = Number(body.hand);
            if (Number.isInteger(expected) && run.phase !== 'draw' && run.lastResult && run.lastResult.handNo === expected) {
                return res.json({ replay: true, ...payload(run, soloStats.getData(playerId, GAME_ID)) });
            }
            if (run.phase !== 'draw' || (Number.isInteger(expected) && expected !== run.handNo)) {
                return res.status(409).json({ success: false, error: 'ยังไม่ถึงตาจั่ว', ...payload(run, soloStats.getData(playerId, GAME_ID)) });
            }
            engine.playerAct(run, action === 'draw', { rng: cryptoRng });
            saveRun(soloStats, playerId, run);
            const stats = engine.applyHandToStats(soloStats.getData(playerId, GAME_ID), run);
            soloStats.setData(playerId, GAME_ID, stats);
            return res.json(payload(run, stats));
        });
    }
};
