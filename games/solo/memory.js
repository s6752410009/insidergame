/**
 * จับคู่การ์ดความจำ (solo) — ตรวจผลและเก็บสถิติ
 *
 * client ส่ง { runId, level, seed, deck, timeMs, moves, log } มา
 * server สร้างกระดานจาก seed แล้ว replay log เอง: จำนวนครั้ง/คะแนน/คอมโบ มาจากการ replay ไม่ใช่ตัวเลขที่ client อ้าง
 * กระดานประจำวันใช้ seed "daily-YYYY-MM-DD" (เวลาไทย) — ส่งได้วันละครั้ง, ตารางอันดับนับเฉพาะของวันนี้
 */

const core = require('../../public/js/solo/memory-core');

const MAX_TIME_MS = 3 * 60 * 60 * 1000;
const MAX_MOVES = 400;

function fail(message) { throw new Error(message); }

function recordResult(prevData, payload, ctx) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const now = ctx && ctx.now ? ctx.now : new Date();
    const runId = typeof body.runId === 'string' && /^[a-z0-9-]{6,40}$/.test(body.runId) ? body.runId : null;
    const levelId = String(body.level || '');
    const seed = body.seed;
    const deckId = String(body.deck || '');
    const timeMs = Math.round(Number(body.timeMs));
    const log = body.log;

    if (!runId) fail('ข้อมูลรอบนี้ไม่ครบ');
    if (!core.LEVELS[levelId]) fail('ไม่รู้จักระดับนี้');
    if (!core.DECKS[deckId]) fail('ไม่รู้จักสำรับนี้');
    if (!core.isValidSeed(seed)) fail('กระดานไม่ถูกต้อง');

    const data = core.normalizeStats(prevData);

    // ส่งซ้ำ (เช่นเน็ตหลุดตอนรอคำตอบแล้วคิวส่งใหม่) — ตอบสำเร็จโดยไม่นับซ้ำ
    if (data.recent.some(r => r.runId === runId)) return data;

    let dailyDate = null;
    if (levelId === 'daily') {
        dailyDate = core.dateFromDailySeed(seed);
        const today = core.bangkokDate(now);
        // เผื่อคนเริ่มก่อนเที่ยงคืนแล้วจบหลังเที่ยงคืน: รับของเมื่อวานได้ด้วย
        if (!dailyDate || (dailyDate !== today && dailyDate !== core.shiftDate(today, -1))) fail('กระดานประจำวันนี้หมดเวลาแล้ว');
        if (deckId !== core.dailyDeck(dailyDate)) fail('กระดานไม่ถูกต้อง');
        if (data.daily.last && data.daily.last.date === dailyDate) fail('วันนี้เล่นกระดานประจำวันไปแล้ว');
        if (data.daily.lastDate && dailyDate < data.daily.lastDate) fail('กระดานประจำวันนี้หมดเวลาแล้ว');
    } else {
        if (core.dateFromDailySeed(seed)) fail('กระดานไม่ถูกต้อง');
        // seed เดิมซ้ำ = จำคำตอบมาแล้ว ไม่นับ
        if (data.recent.some(r => r.seed === seed && r.level === levelId && r.deck === deckId)) fail('กระดานนี้ส่งผลไปแล้ว');
    }

    if (!Array.isArray(log) || log.length === 0 || log.length > MAX_MOVES) fail('ข้อมูลการเล่นไม่ถูกต้อง');
    const result = core.replay(levelId, seed, deckId, log);
    if (!result.ok || !result.state.done) fail('ผลนี้ไม่ตรงกับกระดาน');
    const state = result.state;
    const moves = state.moves;
    if (body.moves !== undefined && Number(body.moves) !== moves) fail('จำนวนครั้งไม่ตรงกับการเล่น');
    const level = core.LEVELS[levelId];
    if (moves < level.pairs) fail('จำนวนครั้งน้อยเกินจริง');
    if (!Number.isFinite(timeMs) || timeMs > MAX_TIME_MS) fail('เวลาไม่ถูกต้อง');
    if (timeMs < core.minTimeMs(levelId, moves)) fail('เวลาเร็วเกินกว่าที่คนเล่นได้');

    return core.mergeStats(data, {
        runId, level: levelId, seed, deck: deckId, timeMs, moves,
        score: state.score, bestCombo: state.bestCombo, dailyDate
    }, now.toISOString());
}

function summary(data) {
    if (!data) return null;
    const stars = Number(data.totalStars) || 0;
    const streak = core.liveStreak(data, new Date());
    const last = data.daily && data.daily.last;
    const playedToday = Boolean(last && last.date === core.bangkokDate(new Date()));
    if (streak > 0) return `รายวันติดกัน ${streak} วัน · ★ ${stars} · ${playedToday ? 'วันนี้เล่นแล้ว ✓' : 'วันนี้ยังไม่ได้เล่น'}`;
    const easy = data.levels && data.levels.easy && data.levels.easy.bestTimeMs;
    if (stars > 0) return `สะสม ★ ${stars}${easy ? ` · ง่ายดีสุด ${core.formatTime(easy)}` : ''}`;
    return null;
}

function leaderboardEntry(data) {
    const last = data && data.daily && data.daily.last;
    if (!last || last.date !== core.bangkokDate(new Date())) return null;
    const timeMs = Number(last.timeMs);
    if (!Number.isFinite(timeMs)) return null;
    return { score: timeMs, label: `${core.formatTimePrecise(timeMs)} · ${last.moves} ครั้ง` };
}

module.exports = {
    meta: {
        id: 'memory',
        order: 40,
        title: 'จับคู่การ์ดความจำ',
        emoji: '🧠',
        tagline: 'เปิดการ์ดทีละสองใบ จำให้แม่น จับคู่ให้ครบเร็วที่สุด',
        accent: '#4fd1c5',
        cover: '/assets/games/solo/memory/cover.svg'
    },
    recordResult,
    summary,
    leaderboardEntry,
    leaderboardOrder: 'asc'
};
