/**
 * ไพ่โซลิแทร์ (Klondike) — ฝั่ง server
 *
 * กันโกง: ผลชนะต้องแนบลำดับการเดิน (log) มาด้วย server จะ replay จาก seed ด้วย engine ตัวเดียวกับ client
 * ต้องจบที่เก็บไพ่ครบ 52 ใบจริง, จำนวนตาต้องตรงกับ log และเวลาต้องไม่เร็วเกินมนุษย์
 * ผลแพ้ (ยอมแพ้/เริ่มเกมใหม่กลางคัน) ตรวจแค่รูปแบบ — ส่งมาก็มีแต่เสียสถิติตัวเอง
 */

const E = require('../../public/js/solo/solitaire-engine');

const RECENT_IDS = 40;
const RECENT_WINS = 60;
const MAX_TIME_MS = 24 * 60 * 60 * 1000;

function formatMs(ms) {
    const total = Math.max(0, Math.round(Number(ms) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function emptyMode() { return { games: 0, wins: 0, bestMs: null, bestMoves: null }; }

function normalize(prev) {
    const d = prev && typeof prev === 'object' ? prev : {};
    const mode = m => ({ ...emptyMode(), ...(m && typeof m === 'object' ? m : {}) });
    return {
        v: 1,
        games: Number(d.games) || 0,
        wins: Number(d.wins) || 0,
        streak: Number(d.streak) || 0,
        bestStreak: Number(d.bestStreak) || 0,
        modes: { 1: mode(d.modes && d.modes[1]), 3: mode(d.modes && d.modes[3]) },
        recent: Array.isArray(d.recent) ? d.recent.slice(-RECENT_IDS) : [],
        recentWins: Array.isArray(d.recentWins) ? d.recentWins.slice(-RECENT_WINS) : [],
        lastWin: d.lastWin || null,
        updatedAt: d.updatedAt || null
    };
}

function recordResult(prevData, payload, ctx) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const gameId = String(p.gameId || '');
    if (!/^[a-z0-9]{8,32}$/i.test(gameId)) throw new Error('ข้อมูลเกมไม่ถูกต้อง');
    const outcome = p.outcome;
    if (outcome !== 'win' && outcome !== 'loss') throw new Error('ผลเกมไม่ถูกต้อง');
    const draw = Number(p.draw);
    if (!E.isValidDraw(draw)) throw new Error('โหมดจั่วไม่ถูกต้อง');
    const seed = Number(p.seed);
    if (!E.isValidSeed(seed)) throw new Error('ข้อมูลสำรับไม่ถูกต้อง');
    const timeMs = Number(p.timeMs);
    if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME_MS) throw new Error('เวลาไม่ถูกต้อง');
    const moves = Number(p.moves);
    if (!Number.isInteger(moves) || moves < 0 || moves > E.MAX_LOG_MOVES) throw new Error('จำนวนตาไม่ถูกต้อง');

    const data = normalize(prevData);
    // ส่งซ้ำ (เน็ตหลุดแล้ว retry) → ไม่นับซ้ำ
    if (data.recent.includes(gameId)) return data;

    if (outcome === 'win') {
        const log = typeof p.log === 'string' ? p.log : '';
        const result = E.replay(seed, draw, log);
        if (!result.ok || !E.isWon(result.state)) throw new Error('ตรวจเกมนี้แล้วยังเก็บไพ่ไม่ครบ');
        if (result.moves !== moves) throw new Error('จำนวนตาไม่ตรงกับการเดิน');
        if (timeMs < E.minPlausibleWinMs(moves)) throw new Error('เวลาเร็วเกินจริง');
        const winKey = `${draw}:${seed}`;
        if (data.recentWins.includes(winKey)) throw new Error('บันทึกชัยชนะของสำรับนี้ไปแล้ว');
        data.recentWins = data.recentWins.concat(winKey).slice(-RECENT_WINS);
    } else if (moves < 1) {
        throw new Error('ยังไม่ได้เล่น ไม่ต้องบันทึก');
    }

    const mode = data.modes[draw];
    data.games += 1;
    mode.games += 1;
    if (outcome === 'win') {
        data.wins += 1;
        mode.wins += 1;
        data.streak += 1;
        data.bestStreak = Math.max(data.bestStreak, data.streak);
        if (mode.bestMs == null || timeMs < mode.bestMs) mode.bestMs = timeMs;
        if (mode.bestMoves == null || moves < mode.bestMoves) mode.bestMoves = moves;
        data.lastWin = { draw, timeMs, moves, at: (ctx && ctx.now ? ctx.now : new Date()).toISOString() };
    } else {
        data.streak = 0;
    }
    data.recent = data.recent.concat(gameId).slice(-RECENT_IDS);
    data.updatedAt = (ctx && ctx.now ? ctx.now : new Date()).toISOString();
    return data;
}

function summary(data) {
    const d = normalize(data);
    if (!d.games) return null;
    if (!d.wins) return `เล่นแล้ว ${d.games} ตา`;
    const best = [d.modes[1].bestMs, d.modes[3].bestMs].filter(ms => ms != null);
    const parts = [];
    if (best.length) parts.push(`เร็วสุด ${formatMs(Math.min(...best))}`);
    parts.push(d.streak >= 2 ? `ชนะติดกัน ${d.streak}` : `ชนะ ${d.wins} ตา`);
    return parts.join(' · ');
}

function leaderboardEntry(data) {
    const d = normalize(data);
    const best = d.modes[1].bestMs;
    if (best == null) return null;
    return { score: best, label: formatMs(best) };
}

module.exports = {
    meta: {
        id: 'solitaire',
        order: 40,
        title: 'ไพ่โซลิแทร์',
        emoji: '♠️',
        tagline: 'เรียงไพ่ขึ้นช่องเก็บให้ครบ 52 ใบ แตะไพ่ให้ไปเองได้',
        accent: '#3fb58a',
        cover: '/assets/games/solo/solitaire/cover.svg'
    },
    recordResult,
    summary,
    leaderboardEntry,
    leaderboardOrder: 'asc',
    formatMs
};
