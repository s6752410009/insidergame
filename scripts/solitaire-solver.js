/**
 * ตัวแก้เกมโซลิแทร์ (ใช้ตอนเทส + ตอนสร้างรายการ "ไพ่ที่ชนะได้แน่นอน")
 *
 * DFS + จำสถานะที่เคยเห็น + ตัดการเดินไร้ประโยชน์ทิ้ง
 * ถ้าเจอทางชนะ = ไพ่ชุดนั้นชนะได้แน่นอน (คืนลำดับการเดินที่ replay ด้วย engine ได้จริง)
 * ถ้าหาไม่เจอในงบ node ที่ให้ = "ไม่รู้" (ไม่ได้แปลว่าชนะไม่ได้) — เราแค่ไม่ใส่ seed นั้นในรายการ
 */

const E = require('../public/js/solo/solitaire-engine');

function stateKey(s) {
    let key = '';
    for (let i = 0; i < 7; i++) {
        key += s.h[i] + ':' + s.t[i].join(',') + '/';
    }
    return key + '|' + s.stock.join(',') + '|' + s.waste.join(',');
}

function candidateMoves(s) {
    // ขึ้นช่องเก็บแบบปลอดภัย = บังคับเดินเลย ไม่ต้องแตกกิ่ง
    if (s.waste.length && E.canFoundation(s, s.waste[s.waste.length - 1]) && E.isSafeFoundation(s, s.waste[s.waste.length - 1])) {
        return [{ from: 'w', to: 'F', n: 1 }];
    }
    for (let i = 0; i < 7; i++) {
        const p = s.t[i];
        if (p.length && E.canFoundation(s, p[p.length - 1]) && E.isSafeFoundation(s, p[p.length - 1])) {
            return [{ from: i, to: 'F', n: 1 }];
        }
    }
    const scored = [];
    const moves = E.legalMoves(s);
    for (const m of moves) {
        let score;
        if (m.draw) score = 0;
        else if (typeof m.from === 'number' && m.to === 'F') {
            const p = s.t[m.from];
            score = 90 + (p.length - 1 === s.h[m.from] && s.h[m.from] > 0 ? 10 : 0);
        } else if (typeof m.from === 'number') {
            if (!E.isUsefulTableauMove(s, m)) continue;
            const start = s.t[m.from].length - m.n;
            score = start === s.h[m.from] && s.h[m.from] > 0 ? 70 + s.h[m.from] : 40;
        } else if (m.from === 'w' && m.to === 'F') score = 60;
        else if (m.from === 'w') score = 50;
        else continue; // ช่องเก็บ → กองล่าง: ไม่ใช้ในตัวแก้ (พอสำหรับหาไพ่ที่ชนะได้)
        scored.push({ m, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(x => x.m);
}

/**
 * @returns {{ solved: boolean, moves: object[]|null, nodes: number, exhausted: boolean }}
 */
function solve(seed, draw, { maxNodes = 200000 } = {}) {
    const start = E.deal(seed, draw);
    const seen = new Set([stateKey(start)]);
    // stack ของ frame: { state, moves, idx }
    const stack = [{ state: start, moves: candidateMoves(start), idx: 0, via: null }];
    let nodes = 0;
    while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.idx >= top.moves.length) { stack.pop(); continue; }
        const mv = top.moves[top.idx++];
        const next = E.applyMove(top.state, mv);
        if (!next) continue;
        const key = stateKey(next);
        if (seen.has(key)) continue;
        seen.add(key);
        nodes++;
        if (E.isWon(next)) {
            const path = stack.slice(1).map(f => f.via);
            path.push(mv);
            return { solved: true, moves: path, nodes, exhausted: false };
        }
        if (nodes >= maxNodes) return { solved: false, moves: null, nodes, exhausted: false };
        stack.push({ state: next, moves: candidateMoves(next), idx: 0, via: mv });
    }
    return { solved: false, moves: null, nodes, exhausted: true };
}

module.exports = { solve, stateKey };
