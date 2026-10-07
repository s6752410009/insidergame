/**
 * ทายคำรายวัน (Thai Wordle) — คำตอบอยู่ฝั่ง server เท่านั้น
 *
 *   GET  /api/solo/wordle/today   ข้อวันนี้ + คำที่ผู้เล่นทายไปแล้ว (+ เฉลยเมื่อจบ)
 *   POST /api/solo/wordle/guess   { guess, puzzle, hard? } → สีของแต่ละช่อง, บันทึกความคืบหน้า/สตรีค
 *     hard = โหมดยาก (ตั้งในเครื่อง) — เปิดได้ก่อนทายคำแรกของข้อเท่านั้น ปิดได้ทุกเมื่อ (เหมือนต้นฉบับ)
 *
 * คำตอบ: games/solo/wordle/answers.json (คัดมือ คำไทยทั่วไป 4 ช่อง)
 * คำที่ทายได้: games/solo/wordle/allowed.txt (คลังคำ PyThaiNLP words_th, CC0 + คำตอบทั้งหมด)
 * ลำดับคำตอบ: สลับด้วย seed คงที่ ใช้ครบทุกคำก่อนวนรอบใหม่ (ดู WordleLogic.answerIndex)
 */

const fs = require('fs');
const path = require('path');
const W = require('../../public/js/solo/wordle-logic');

const GAME_ID = 'wordle';
const DATA_DIR = path.join(__dirname, 'wordle');
const SEED = Number(process.env.WORDLE_SEED) || 0x5EED_7A1;

const ANSWERS = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'answers.json'), 'utf8'));
const ALLOWED = new Set(
    fs.readFileSync(path.join(DATA_DIR, 'allowed.txt'), 'utf8')
        .split('\n')
        .map(w => w.trim())
        .filter(Boolean)
);
ANSWERS.forEach(w => ALLOWED.add(w));

function answerFor(puzzle) {
    return ANSWERS[W.answerIndex(puzzle, ANSWERS.length, SEED)];
}

function todayPuzzle(nowMs) {
    return W.puzzleNumber(nowMs == null ? Date.now() : nowMs);
}

/** ข้อมูลที่เก็บต่อผู้เล่น: สถิติ + ความคืบหน้าของข้อวันนี้ */
function normalizeData(data) {
    const base = W.emptyStats();
    const out = Object.assign({ v: 1 }, base, data && typeof data === 'object' ? data : {});
    out.dist = Array.isArray(out.dist) && out.dist.length === W.MAX_GUESSES ? out.dist.slice() : base.dist.slice();
    const today = out.today && typeof out.today === 'object' ? out.today : null;
    out.today = today && Number.isFinite(today.puzzle)
        ? { puzzle: today.puzzle, guesses: Array.isArray(today.guesses) ? today.guesses.slice(0, W.MAX_GUESSES) : [], done: Boolean(today.done), won: Boolean(today.won), hard: Boolean(today.hard) }
        : null;
    return out;
}

function publicStats(data, puzzle) {
    const d = normalizeData(data);
    return {
        played: d.played,
        wins: d.wins,
        winRate: d.played ? Math.round((d.wins / d.played) * 100) : 0,
        streak: W.currentStreak(d, puzzle),
        maxStreak: d.maxStreak,
        dist: d.dist
    };
}

/** สถานะข้อวันนี้สำหรับส่งให้ client (คำนวณสีใหม่ทุกครั้งจากคำที่ทาย) */
function buildState(data, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const puzzle = todayPuzzle(now);
    const d = normalizeData(data);
    const answer = answerFor(puzzle);
    const answerCells = W.toCells(answer);
    const today = d.today && d.today.puzzle === puzzle ? d.today : { puzzle, guesses: [], done: false, won: false };
    let keys = {};
    const guesses = today.guesses.map(word => {
        const cells = W.toCells(word);
        const scored = W.scoreGuess(cells, answerCells);
        keys = W.mergeKeys(keys, scored.keys);
        return { word, cells, states: scored.states, near: scored.near };
    });
    return {
        puzzle,
        length: answerCells.length,
        maxGuesses: W.MAX_GUESSES,
        guesses,
        keys,
        done: today.done,
        won: today.won,
        hard: Boolean(today.hard),
        answer: today.done ? answer : null,
        answerCells: today.done ? answerCells : null,
        stats: publicStats(d, puzzle),
        nextInMs: W.msUntilNext(now)
    };
}

/**
 * คำทายที่ใช้ไม่ได้ในจังหวะเล่นปกติ (ไม่มีในคลัง, ไม่ครบช่อง, ขึ้นวันใหม่ ฯลฯ) ตอบ 200 + success:false
 * เพื่อไม่ให้ browser พ่น "Failed to load resource" ใน console ทุกครั้งที่ผู้เล่นพิมพ์ผิด
 * ส่วน payload ที่ UI ไม่มีทางส่งเอง (bad_input) ตอบ 400
 */
class GuessError extends Error {
    constructor(message, code, status) {
        super(message);
        this.code = code;
        this.status = status || 200;
    }
}

/** ทาย 1 ครั้ง — pure: รับ data เดิม คืน data ใหม่ (throw GuessError ถ้าไม่ผ่าน) */
function applyGuess(prevData, rawGuess, clientPuzzle, nowMs, opts) {
    const now = nowMs == null ? Date.now() : nowMs;
    const puzzle = todayPuzzle(now);
    if (clientPuzzle != null && Number(clientPuzzle) !== puzzle) {
        throw new GuessError('ขึ้นข้อใหม่แล้ว กำลังโหลดข้อวันนี้', 'stale_puzzle');
    }
    if (typeof rawGuess !== 'string' || rawGuess.length > 40) {
        throw new GuessError('พิมพ์คำก่อนนะ', 'bad_input', 400);
    }
    const cells = W.toCells(rawGuess);
    if (!cells) throw new GuessError('สระหรือวรรณยุกต์วางไม่ถูกที่', 'malformed');
    const answerCells = W.toCells(answerFor(puzzle));
    if (cells.length !== answerCells.length) {
        throw new GuessError(`ต้องมี ${answerCells.length} ช่องพอดี`, 'bad_length');
    }
    const word = cells.join('');
    if (!ALLOWED.has(word)) throw new GuessError('ไม่มีคำนี้ในคลังคำ', 'not_word');

    const d = normalizeData(prevData);
    const today = d.today && d.today.puzzle === puzzle ? d.today : { puzzle, guesses: [], done: false, won: false };
    if (today.done) throw new GuessError('ข้อวันนี้จบแล้ว พรุ่งนี้มาใหม่นะ', 'done');
    if (today.guesses.includes(word)) throw new GuessError('ทายคำนี้ไปแล้ว', 'repeat');

    // โหมดยาก: เปิดได้ตอนยังไม่ทายเลย ปิดได้ทุกเมื่อ
    const wantHard = opts && typeof opts.hard === 'boolean' ? opts.hard : null;
    let hard = Boolean(today.hard);
    if (wantHard === false) hard = false;
    else if (wantHard === true && today.guesses.length === 0) hard = true;
    if (hard) {
        const rows = today.guesses.map(prev => {
            const prevCells = W.toCells(prev);
            const sc = W.scoreGuess(prevCells, answerCells);
            return { cells: prevCells, states: sc.states, near: sc.near };
        });
        const why = W.hardModeError(rows, cells);
        if (why) throw new GuessError(why, 'hard_mode');
    }
    today.hard = hard;

    const scored = W.scoreGuess(cells, answerCells);
    today.guesses = today.guesses.concat(word);
    const won = W.isWin(scored.states);
    if (won || today.guesses.length >= W.MAX_GUESSES) {
        today.done = true;
        today.won = won;
        Object.assign(d, W.finishStats(d, puzzle, won, today.guesses.length));
    }
    d.today = today;
    d.updatedAt = new Date(now).toISOString();
    return d;
}

module.exports = {
    meta: {
        id: GAME_ID,
        order: 10,
        title: 'ทายคำรายวัน',
        emoji: '🟩',
        tagline: 'ทายคำไทย 4 ช่อง วันละคำ ใน 6 ครั้ง',
        accent: '#4fbf8a',
        cover: '/assets/games/solo/wordle/cover.svg'
    },

    // ผลของเกมนี้ตัดสินที่ server ตอนทาย (/guess) — ห้าม client ส่งผลเอง
    recordResult() {
        throw new Error('เกมนี้บันทึกผลอัตโนมัติตอนทาย ส่งผลเองไม่ได้');
    },

    summary(data) {
        const d = normalizeData(data);
        const puzzle = todayPuzzle();
        const streak = W.currentStreak(d, puzzle);
        // บอกบนการ์ดหน้า /solo ว่าข้อวันนี้ทำไปหรือยัง (สตรีคจะหลุดถ้าลืม)
        const today = d.today && d.today.puzzle === puzzle ? d.today : null;
        const todayNote = today && today.done ? 'วันนี้ทายแล้ว ✓' : 'วันนี้ยังไม่ได้ทาย';
        if (streak > 0) return `🔥 ติดกัน ${streak} วัน · ${todayNote}`;
        if (d.played > 0) return `เล่นแล้ว ${d.played} วัน · ชนะ ${Math.round((d.wins / d.played) * 100)}% · ${todayNote}`;
        return null;
    },

    leaderboardEntry(data) {
        const d = normalizeData(data);
        const streak = W.currentStreak(d, todayPuzzle());
        if (streak <= 0) return null;
        return { score: streak, label: `${streak} วัน` };
    },
    leaderboardOrder: 'desc',

    registerRoutes(router, helpers) {
        router.get('/today', function (req, res) {
            res.set('Cache-Control', 'no-store');
            const playerId = helpers.getPlayerId(req);
            if (playerId && !helpers.rateLimit(`wordle-today:${playerId}`, 60, 60 * 1000)) {
                return res.status(429).json({ success: false, error: 'โหลดถี่เกินไป รอสักครู่' });
            }
            const data = playerId ? helpers.soloStats.getData(playerId, GAME_ID) : null;
            return res.json({ success: true, signedIn: Boolean(playerId), ...buildState(data) });
        });

        router.post('/guess', async function (req, res) {
            res.set('Cache-Control', 'no-store');
            const playerId = helpers.getPlayerId(req);
            if (!playerId) return res.status(403).json({ success: false, error: 'เปิดหน้าใหม่แล้วลองอีกครั้ง', code: 'no_player' });
            if (!helpers.rateLimit(`wordle-guess:${playerId}`, 20, 60 * 1000)) {
                return res.status(429).json({ success: false, error: 'ทายถี่เกินไป พักหายใจแป๊บนึง', code: 'rate' });
            }
            try {
                if (typeof helpers.ensurePersistedPlayer === 'function') await helpers.ensurePersistedPlayer(playerId);
                // อ่าน-แก้-เขียน แบบ synchronous ต่อจากนี้ — คำขอซ้อนกันจึงไม่ทับกัน
                const body = req.body || {};
                const prev = helpers.soloStats.getData(playerId, GAME_ID);
                const next = applyGuess(prev, body.guess, body.puzzle, null, { hard: typeof body.hard === 'boolean' ? body.hard : undefined });
                helpers.soloStats.setData(playerId, GAME_ID, next);
                return res.json({ success: true, ...buildState(next) });
            } catch (error) {
                if (error instanceof GuessError) {
                    const payload = { success: false, error: error.message, code: error.code };
                    if (error.code === 'stale_puzzle' || error.code === 'done') {
                        Object.assign(payload, buildState(helpers.soloStats.getData(playerId, GAME_ID)));
                    }
                    return res.status(error.status).json(payload);
                }
                console.error('[wordle] guess failed:', error);
                return res.status(500).json({ success: false, error: 'ระบบขัดข้อง ลองอีกครั้ง' });
            }
        });
    },

    // สำหรับเทส
    _internal: { answerFor, applyGuess, buildState, normalizeData, todayPuzzle, GuessError, ANSWERS, ALLOWED }
};
