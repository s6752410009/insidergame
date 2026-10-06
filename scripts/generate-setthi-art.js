/**
 * เศรษฐี — สร้างภาพแลนด์มาร์กแบบ "ของเล่น 3 มิติ" (isometric) ของทุกช่องบนกระดาน → public/assets/games/setthi/land/*.svg
 * วาดเองทั้งหมดด้วยรูปทรงเรขาคณิต (กล่อง หลังคา ทรงกลึง) แสงมาจากซ้ายบนทุกภาพ บนแท่นสีประจำชุด
 * ไม่มีพระพุทธรูป — ใช้สถาปัตยกรรม/สิ่งก่อสร้างที่ไม่ใช่ของศักดิ์สิทธิ์ที่จะโดนประทับตรา
 *
 * รัน: node scripts/generate-setthi-art.js
 */
const fs = require('fs');
const path = require('path');
const B = require('../games/setthiBoard');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'games', 'setthi', 'land');

// ---------- สี ----------
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function toHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function shade(c, k) { // k > 0 สว่างขึ้น · k < 0 มืดลง
    const [r, g, b] = hex(c);
    return k >= 0 ? toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : toHex(r * (1 + k), g * (1 + k), b * (1 + k));
}
const INK = '#1a2332';
const GOLD = '#f5c86b';
const PAL = {
    grass: '#8fcf7a', sand: '#ecd9a6', paving: '#e6dcc6', asphalt: '#5b6577', water: '#5fb6e6', brick: '#c0643f', laterite: '#b5683f',
    white: '#f6f1e6', red: '#d9443b', green: '#2f9d63', navy: '#2b3c5c', gold: GOLD, wood: '#a8673f', stone: '#b9b2a4', glass: '#7cc4ea', pink: '#ee7fb2'
};

// ---------- ฉายภาพไอโซเมตริก ----------
const C30 = Math.cos(Math.PI / 6);
const K = 2.55;
const OX = 60;
const OY = 80;
function P(x, y, z) { return [OX + (x - y) * C30 * K, OY + (x + y) * 0.5 * K - z * K]; }
const f = n => Math.round(n * 100) / 100;
function d(points) { return 'M' + points.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z'; }

function makeScene() {
    const parts = [];
    const defs = new Map();
    const S = {
        add(svg) { parts.push(svg); return S; },
        poly(points, fill, extra = '') { parts.push(`<path d="${d(points)}" fill="${fill}"${extra}/>`); return S; },
        grad(c, dir = 'h') {
            const id = 'g' + dir + c.slice(1);
            if (!defs.has(id)) {
                defs.set(id, dir === 'h'
                    ? `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${shade(c, 0.28)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.32)}"/></linearGradient>`
                    : `<radialGradient id="${id}" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="${shade(c, 0.45)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, -0.35)}"/></radialGradient>`);
            }
            return `url(#${id})`;
        },
        defsSvg() { return [...defs.values()].join(''); },
        body() { return parts.join(''); }
    };
    return S;
}
const EDGE = ` stroke="${INK}" stroke-opacity=".28" stroke-width=".5" stroke-linejoin="round"`;

function box(S, x, y, z, w, dd, h, c, opt = {}) {
    const top = shade(c, opt.topK != null ? opt.topK : 0.22);
    const left = c;
    const right = shade(c, -0.25);
    S.poly([P(x, y + dd, z), P(x + w, y + dd, z), P(x + w, y + dd, z + h), P(x, y + dd, z + h)], opt.leftFill || left, EDGE);
    S.poly([P(x + w, y, z), P(x + w, y + dd, z), P(x + w, y + dd, z + h), P(x + w, y, z + h)], opt.rightFill || right, EDGE);
    if (!opt.noTop) S.poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + dd, z + h), P(x, y + dd, z + h)], opt.topFill || top, EDGE);
    return S;
}
// หน้าต่างบนหน้าซ้าย (+y) หรือหน้าขวา (+x) ของกล่อง
function windows(S, x, y, z, w, dd, h, face, cols, rows, c, opt = {}) {
    const m = opt.margin != null ? opt.margin : 0.18;
    for (let i = 0; i < cols; i += 1) {
        for (let j = 0; j < rows; j += 1) {
            const span = face === 'L' ? w : dd;
            const cw = span / cols;
            const rh = h / rows;
            const a = cw * i + cw * m;
            const b2 = cw * (i + 1) - cw * m;
            const z0 = z + rh * j + rh * m;
            const z1 = z + rh * (j + 1) - rh * (m * 0.7);
            if (face === 'L') S.poly([P(x + a, y + dd + 0.01, z0), P(x + b2, y + dd + 0.01, z0), P(x + b2, y + dd + 0.01, z1), P(x + a, y + dd + 0.01, z1)], c);
            else S.poly([P(x + w + 0.01, y + a, z0), P(x + w + 0.01, y + b2, z0), P(x + w + 0.01, y + b2, z1), P(x + w + 0.01, y + a, z1)], shade(c, -0.18));
        }
    }
}
// หลังคาจั่ว สันหลังคาตามแกน x หรือ y
function gable(S, x, y, z, w, dd, h, c, axis = 'x', opt = {}) {
    const o = opt.over || 0.6;
    if (axis === 'x') {
        const ym = y + dd / 2;
        S.poly([P(x - o, y - o, z), P(x + w + o, y - o, z), P(x + w + o, ym, z + h), P(x - o, ym, z + h)], shade(c, 0.18), EDGE);
        S.poly([P(x + w, y, z), P(x + w, y + dd, z), P(x + w, ym, z + h)], opt.gableFill || shade(c === PAL.red ? PAL.white : c, -0.08), EDGE);
        S.poly([P(x - o, y + dd + o, z), P(x + w + o, y + dd + o, z), P(x + w + o, ym, z + h), P(x - o, ym, z + h)], c, EDGE);
        if (opt.finial) {
            const a = P(x - o, ym, z + h);
            const b = P(x + w + o, ym, z + h);
            S.add(`<path d="M${f(a[0])} ${f(a[1])}q-2.2 -1 -2.6 -3.4M${f(b[0])} ${f(b[1])}q2.2 -1 2.6 -3.4" fill="none" stroke="${GOLD}" stroke-width="1.3" stroke-linecap="round"/>`);
        }
    } else {
        const xm = x + w / 2;
        S.poly([P(x - o, y - o, z), P(x - o, y + dd + o, z), P(xm, y + dd + o, z + h), P(xm, y - o, z + h)], shade(c, 0.18), EDGE);
        S.poly([P(x, y + dd, z), P(x + w, y + dd, z), P(xm, y + dd, z + h)], opt.gableFill || shade(c === PAL.red ? PAL.white : c, -0.08), EDGE);
        S.poly([P(x + w + o, y - o, z), P(x + w + o, y + dd + o, z), P(xm, y + dd + o, z + h), P(xm, y - o, z + h)], shade(c, -0.22), EDGE);
        if (opt.finial) {
            const a = P(xm, y - o, z + h);
            const b = P(xm, y + dd + o, z + h);
            S.add(`<path d="M${f(a[0])} ${f(a[1])}q2.4 -1 2.6 -3.4M${f(b[0])} ${f(b[1])}q-2.4 -1 -2.6 -3.4" fill="none" stroke="${GOLD}" stroke-width="1.3" stroke-linecap="round"/>`);
        }
    }
}
function pyramid(S, cx, cy, z, half, h, c) {
    const a = P(cx - half, cy + half, z);
    const b = P(cx + half, cy + half, z);
    const e = P(cx + half, cy - half, z);
    const t = P(cx, cy, z + h);
    S.poly([a, b, t], c, EDGE);
    S.poly([b, e, t], shade(c, -0.25), EDGE);
}
// ทรงกลึง (เจดีย์ ปรางค์ หอคอย ถัง) — profile = [[รัศมี, ความสูง], ...] จากล่างขึ้นบน
function lathe(S, cx, cy, z, profile, c, opt = {}) {
    const center = h => P(cx, cy, z + h);
    const rx = r => r * 1.2247 * K;
    const ry = r => r * 0.7071 * K;
    const left = profile.map(([r, h]) => { const p = center(h); return [p[0] - rx(r), p[1]]; });
    const right = profile.map(([r, h]) => { const p = center(h); return [p[0] + rx(r), p[1]]; }).reverse();
    const [r0, h0] = profile[0];
    const b = center(h0);
    let dd = 'M' + left.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'L' + right.map(p => f(p[0]) + ' ' + f(p[1])).join('L');
    dd += `A${f(rx(r0))} ${f(ry(r0))} 0 0 1 ${f(left[0][0])} ${f(left[0][1])}Z`;
    S.add(`<path d="${dd}" fill="${S.grad(c)}"${EDGE}/>`);
    (opt.rings || []).forEach(i => {
        const [r, h] = profile[i];
        const p = center(h);
        S.add(`<path d="M${f(p[0] - rx(r))} ${f(p[1])}A${f(rx(r))} ${f(ry(r))} 0 0 0 ${f(p[0] + rx(r))} ${f(p[1])}" fill="none" stroke="${opt.ringColor || shade(c, -0.35)}" stroke-width="${opt.ringW || 0.7}"/>`);
    });
    if (opt.topCap) {
        const [r, h] = profile[profile.length - 1];
        const p = center(h);
        S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="${f(rx(r))}" ry="${f(ry(r))}" fill="${shade(c, 0.3)}"${EDGE}/>`);
    }
    if (opt.ribs) { // เส้นแนวตั้งให้ดูเป็นลอน (ปรางค์)
        const n = opt.ribs;
        for (let k = 1; k < n; k += 1) {
            const t = -1 + (2 * k) / n;
            const pts = profile.map(([r, h]) => { const p = center(h); return [p[0] + rx(r) * t, p[1] + ry(r) * Math.sqrt(Math.max(0, 1 - t * t))]; });
            S.add(`<path d="M${pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L')}" fill="none" stroke="${shade(c, -0.3)}" stroke-opacity=".55" stroke-width=".5"/>`);
        }
    }
    return S;
}
function cylinder(S, cx, cy, z, r, h, c) { return lathe(S, cx, cy, z, [[r, 0], [r, h]], c, { topCap: true }); }
function sphere(S, cx, cy, z, r, c) {
    const p = P(cx, cy, z);
    S.add(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r * K)}" fill="${S.grad(c, 'r')}"${EDGE}/>`);
}
function shadowAt(S, cx, cy, r, op = 0.2) {
    op = Math.min(op, 0.1);
    r *= 0.8;
    const p = P(cx, cy, 0);
    S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="${f(r * 1.2247 * K)}" ry="${f(r * 0.7071 * K)}" fill="${INK}" opacity="${op}"/>`);
}
function line(S, a, b, c, w = 0.8, extra = '') {
    S.add(`<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" fill="none"${extra}/>`);
}
function tree(S, x, y, s = 1, c = PAL.green) {
    shadowAt(S, x, y, 1.6 * s, 0.16);
    cylinder(S, x, y, 0, 0.35 * s, 2.2 * s, PAL.wood);
    sphere(S, x, y, 3.6 * s, 2 * s, c);
}
function palm(S, x, y, s = 1) {
    const base = P(x, y, 0);
    const top = P(x + 0.6 * s, y - 0.4 * s, 8 * s);
    S.add(`<path d="M${f(base[0])} ${f(base[1])}Q${f(base[0] - 2)} ${f((base[1] + top[1]) / 2)} ${f(top[0])} ${f(top[1])}" stroke="${PAL.wood}" stroke-width="${f(1.6 * s)}" fill="none" stroke-linecap="round"/>`);
    const leaves = [[-7, 2], [7, 2.5], [-5, -3], [5, -3.5], [0, -5]];
    leaves.forEach(([dx, dy]) => S.add(`<path d="M${f(top[0])} ${f(top[1])}q${f(dx * 0.5 * s)} ${f((dy - 3) * s)} ${f(dx * s)} ${f(dy * s)}" stroke="${PAL.green}" stroke-width="${f(1.8 * s)}" fill="none" stroke-linecap="round"/>`));
    S.add(`<circle cx="${f(top[0])}" cy="${f(top[1] + 1)}" r="${f(0.9 * s)}" fill="${PAL.wood}"/>`);
}
function waves(S, color = '#ffffff', y0 = 0) {
    for (let i = -1; i <= 1; i += 1) {
        const a = P(-7 + i * 3, 4 + i * 3 + y0, 0.02);
        S.add(`<path d="M${f(a[0])} ${f(a[1])}q2 -1.2 4 0t4 0" stroke="${color}" stroke-opacity=".7" stroke-width=".8" fill="none" stroke-linecap="round"/>`);
    }
}

// แท่นฐาน: ผิวบนตามภูมิประเทศ ด้านข้างเป็นสีประจำชุด
function platform(S, top, accent, opt = {}) {
    S.add(`<ellipse cx="${OX}" cy="${OY + 29}" rx="40" ry="7" fill="${INK}" opacity=".16"/>`);
    box(S, -10, -10, -2.6, 20, 20, 2.6, accent, { topFill: top, leftFill: shade(accent, -0.05), rightFill: shade(accent, -0.32) });
    if (opt.split) { // ครึ่งหลังเป็นน้ำ/ทราย
        S.poly([P(-10, -10, 0), P(10, -10, 0), P(10, opt.split, 0), P(-10, opt.split, 0)], opt.splitColor);
    }
    if (opt.road) {
        S.poly([P(-10, -1.8, 0.01), P(10, -1.8, 0.01), P(10, 1.8, 0.01), P(-10, 1.8, 0.01)], PAL.asphalt);
        for (let i = -9; i < 9; i += 4) S.poly([P(i, -0.15, 0.02), P(i + 2, -0.15, 0.02), P(i + 2, 0.15, 0.02), P(i, 0.15, 0.02)], '#f4e6b8');
    }
}

// ---------- ภาพแต่ละช่อง ----------
const SCENES = {
    // อีสาน
    yasothon(S, ac) {
        platform(S, PAL.grass, ac);
        // ฐานยิงไม้ไผ่
        [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(([x, y]) => box(S, x - 0.3, y - 0.3, 0, 0.6, 0.6, 15, PAL.wood));
        [5, 10].forEach(z => box(S, -1.5, -1.5, z, 3, 3, 0.5, shade(PAL.wood, -0.1)));
        // บั้งไฟ
        cylinder(S, 0, 0, 13, 0.3, 4, PAL.wood);
        lathe(S, 0, 0, 16, [[1.5, 0], [1.5, 9], [1.2, 10.5], [0.2, 13]], PAL.gold, { rings: [1, 2], ringColor: PAL.red, ringW: 1.4 });
        [[3.5, 2, PAL.red], [-3.5, -2, PAL.pink]].forEach(([x, y, c]) => {
            const a = P(x, y, 0); const b = P(x, y, 10);
            line(S, a, b, PAL.wood, 0.8);
            S.add(`<path d="M${f(b[0])} ${f(b[1])}l5 1.6 -5 1.8z" fill="${c}"/>`);
        });
        // ควัน
        [[2.5, 3, 1.5], [3.5, 1, 1.8], [-2.8, 2.5, 1.4]].forEach(([x, y, r]) => sphere(S, x, y, r, r, '#ffffff'));
    },
    mukdahan(S, ac) {
        platform(S, PAL.grass, ac, { split: -3, splitColor: PAL.water });
        waves(S, '#ffffff', -10);
        shadowAt(S, 2, 3, 4);
        lathe(S, 2, 3, 0, [[4, 0], [4, 2], [2.2, 2], [1.8, 18], [3.6, 19.5], [3.6, 22], [1.8, 23], [0.7, 25]], PAL.white, { rings: [1, 4, 5], ringColor: GOLD, ringW: 0.9, topCap: false });
        windows(S, 1, 2, 19.6, 1, 1, 2.2, 'L', 1, 1, PAL.glass);
        sphere(S, 2, 3, 26.8, 1.6, '#fbf7ee');
        tree(S, -6, 6, 0.9); tree(S, 7, -2, 0.8);
    },
    udon(S, ac) {
        platform(S, PAL.water, ac);
        waves(S);
        const pads = [[-6, -4], [-3, 2], [1, -6], [4, 3], [6, -2], [-6, 5], [0, 7], [7, 6], [-1, -1]];
        pads.forEach(([x, y]) => { const p = P(x, y, 0.05); S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="4.4" ry="2.4" fill="${PAL.green}"/>`); });
        pads.forEach(([x, y], i) => {
            if (i % 2) return;
            const p = P(x, y, 1.1);
            S.add(`<g transform="translate(${f(p[0])} ${f(p[1])})"><path d="M0 -4c1.6 1.4 1.7 3.2 0 4.6-1.7-1.4-1.6-3.2 0-4.6z" fill="${PAL.pink}"/><path d="M0 .6c-2 0-3.6-1-4.2-2.8 2 .1 3.4 1 4.2 2.8zm0 0c2 0 3.6-1 4.2-2.8-2 .1-3.4 1-4.2 2.8z" fill="${shade(PAL.pink, -0.12)}"/></g>`);
        });
        // เรือชมบัว
        box(S, -2, 3, 0, 7, 2, 0.9, PAL.wood);
        box(S, -0.5, 3.3, 0.9, 3, 1.4, 0.4, PAL.red);
    },
    khonkaen(S, ac) {
        platform(S, PAL.grass, ac);
        box(S, -6, -3, 0, 12, 6, 1.4, PAL.stone);
        // ไดโนเสาร์คอยาว (ซอโรพอด)
        const g = S.grad('#5aa86a');
        const b0 = P(0, 0, 6);
        S.add(`<path d="M${f(b0[0] - 15)} ${f(b0[1] + 4)}Q${f(b0[0] - 22)} ${f(b0[1] + 9)} ${f(b0[0] - 27)} ${f(b0[1] + 6)}Q${f(b0[0] - 18)} ${f(b0[1] + 1)} ${f(b0[0] - 10)} ${f(b0[1] - 2)}Z" fill="${g}"${EDGE}/>`);
        [[-5, 6], [8, 6]].forEach(([dx, dy]) => S.add(`<rect x="${f(b0[0] + dx - 1.8)}" y="${f(b0[1] + dy - 6)}" width="3.8" height="10" rx="1.6" fill="${shade('#5aa86a', -0.25)}"${EDGE}/>`));
        S.add(`<ellipse cx="${f(b0[0] + 1)}" cy="${f(b0[1])}" rx="17" ry="10" fill="${g}"${EDGE}/>`);
        [[-8, 8], [4, 8.5]].forEach(([dx, dy]) => S.add(`<rect x="${f(b0[0] + dx - 2)}" y="${f(b0[1] + dy - 6)}" width="4.2" height="9" rx="1.8" fill="${shade('#5aa86a', -0.08)}"${EDGE}/>`));
        S.add(`<path d="M${f(b0[0] + 10)} ${f(b0[1] - 4)}Q${f(b0[0] + 15)} ${f(b0[1] - 22)} ${f(b0[0] + 18)} ${f(b0[1] - 40)}" stroke="${g}" stroke-width="6" fill="none" stroke-linecap="round"/>`);
        S.add(`<ellipse cx="${f(b0[0] + 20)}" cy="${f(b0[1] - 41)}" rx="4.6" ry="3" fill="#5aa86a"${EDGE}/><circle cx="${f(b0[0] + 21.6)}" cy="${f(b0[1] - 42)}" r=".8" fill="${INK}"/>`);
        S.add(`<path d="M${f(b0[0] - 8)} ${f(b0[1] - 6)}q8 -5 16 -1" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" fill="none" stroke-linecap="round"/>`);
        tree(S, -7, 6, 0.8); tree(S, 7, -6, 0.9);
    },
    korat(S, ac) {
        platform(S, PAL.grass, ac, { split: 5, splitColor: PAL.grass });
        S.poly([P(-10, 5, 0.01), P(10, 5, 0.01), P(10, 9, 0.01), P(-10, 9, 0.01)], PAL.water);
        box(S, -9, -1, 0, 6, 3, 7, PAL.brick);
        box(S, 3, -1, 0, 6, 3, 7, PAL.brick);
        box(S, -3, -1.2, 0, 6, 3.4, 9, shade(PAL.brick, 0.05));
        const a = P(-1.5, 2.2, 0); const b = P(1.5, 2.2, 0); const t = P(0, 2.2, 6);
        S.add(`<path d="M${f(a[0])} ${f(a[1])}L${f(a[0])} ${f(t[1] + 3)}Q${f(t[0])} ${f(t[1] - 1)} ${f(b[0])} ${f(t[1] + 3)}L${f(b[0])} ${f(b[1])}Z" fill="${INK}" opacity=".75"/>`);
        for (let x = -8.6; x < 9; x += 1.6) { if (Math.abs(x) > 3) box(S, x, -1, 7, 0.8, 0.8, 0.9, shade(PAL.brick, 0.08)); }
        box(S, -2.4, -0.6, 9, 4.8, 2.2, 2.4, PAL.white);
        gable(S, -2.8, -1, 11.4, 5.6, 3, 3.6, PAL.red, 'x', { finial: true });
    },
    // ล้านนา
    nan(S, ac) {
        platform(S, PAL.water, ac);
        waves(S, '#ffffff', 4);
        // เรือแข่งหัวพญานาค
        const h = [P(-9, 1, 0.3), P(8, 1, 0.3), P(8, 2.6, 0.3), P(-9, 2.6, 0.3)];
        S.poly([P(-9.5, 1.8, 0), P(-8, 2.8, 1), P(7.5, 2.8, 1), P(9, 1.8, 1.8), P(7.5, 0.8, 1), P(-8, 0.8, 1)], PAL.red, EDGE);
        void h;
        const nose = P(9, 1.8, 1.8);
        S.add(`<path d="M${f(nose[0])} ${f(nose[1])}q4 -4 1.5 -9q-1 -2 1.5 -3" stroke="${GOLD}" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="${f(nose[0] + 3.2)}" cy="${f(nose[1] - 12.2)}" r="1.8" fill="${GOLD}"/>`);
        const tail = P(-9.5, 1.8, 0);
        S.add(`<path d="M${f(tail[0])} ${f(tail[1])}q-3 -3 -1.5 -7" stroke="${GOLD}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`);
        for (let x = -7; x <= 6; x += 1.6) {
            const p = P(x, 1.8, 2.4);
            S.add(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="1.1" fill="${x % 3.2 ? '#f2c79b' : '#e3a877'}"/>`);
            const q = P(x - 0.6, 3.6, 0.2);
            line(S, [p[0], p[1] + 1], q, PAL.wood, 0.6);
        }
        tree(S, -6, -7, 0.9); tree(S, 6, -8, 1.1, '#3f8f5a');
    },
    lampang(S, ac) {
        platform(S, PAL.paving, ac, { road: true });
        shadowAt(S, 0, 0, 6.5, 0.2);
        const wheel = (x, y, r) => {
            const p = P(x, y, r);
            S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="${f(r * K * 0.62)}" ry="${f(r * K)}" fill="${INK}" opacity=".9"/><ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="${f(r * K * 0.5)}" ry="${f(r * K * 0.82)}" fill="none" stroke="${PAL.red}" stroke-width="1"/><path d="M${f(p[0])} ${f(p[1] - r * K * 0.8)}V${f(p[1] + r * K * 0.8)}M${f(p[0] - r * K * 0.48)} ${f(p[1])}H${f(p[0] + r * K * 0.48)}" stroke="${PAL.red}" stroke-width=".6"/>`);
        };
        wheel(-4.5, -1.6, 3.4);
        box(S, -7, -1.6, 2.6, 7, 3.2, 1.2, PAL.green);
        box(S, -6.6, -1.4, 3.8, 6, 2.8, 3.4, '#f6f1e6');
        windows(S, -6.6, -1.4, 4.4, 6, 2.8, 2.4, 'L', 2, 1, '#cfe9d8');
        [[-6.8, 1.4], [-1, 1.4], [-6.8, -1.4], [-1, -1.4]].forEach(([x, y]) => box(S, x, y, 7.2, 0.3, 0.3, 2.6, PAL.wood));
        box(S, -7.4, -2, 9.8, 7.8, 4, 0.5, PAL.red);
        gable(S, -7.4, -2, 10.3, 7.8, 4, 1.6, PAL.red, 'x');
        wheel(-4.5, 1.8, 3.4);
        wheel(0.6, 1.8, 2);
        // ม้า
        box(S, 3, -0.8, 4.2, 5, 1.8, 2.6, '#efe7d8');
        [[3.4, -0.6], [3.4, 0.6], [7.2, -0.6], [7.2, 0.6]].forEach(([x, y]) => box(S, x, y, 0, 0.5, 0.5, 4.2, '#d8cfbf'));
        box(S, 7.2, -0.6, 6.4, 1.4, 1.4, 3.2, '#efe7d8');
        box(S, 7.6, -0.6, 8.8, 2.4, 1.4, 1.2, '#efe7d8');
        box(S, 6.6, -0.65, 6.8, 0.6, 1.5, 3.2, PAL.wood);
        line(S, P(0.6, 1, 4.4), P(3, 1, 5.4), PAL.wood, 1);
        const pl = P(8.6, 0.8, 10.4);
        S.add(`<path d="M${f(pl[0])} ${f(pl[1])}l1.4 -3 1.2 2.6z" fill="${PAL.red}"/>`);
    },
    chiangrai(S, ac) {
        platform(S, PAL.paving, ac);
        shadowAt(S, 0, 0, 4);
        box(S, -3, -3, 0, 6, 6, 3, '#e8b54a');
        box(S, -2.2, -2.2, 3, 4.4, 4.4, 9, GOLD);
        const cf = P(0, 2.21, 9.5);
        S.add(`<circle cx="${f(cf[0] - 3)}" cy="${f(cf[1] + 1)}" r="2.4" fill="#fff8e6" stroke="${PAL.wood}" stroke-width=".6"/><path d="M${f(cf[0] - 3)} ${f(cf[1] + 1)}v-1.6M${f(cf[0] - 3)} ${f(cf[1] + 1)}h1.2" stroke="${INK}" stroke-width=".5"/>`);
        lathe(S, 0, 0, 12, [[3, 0], [3, 0.8], [2, 1.2], [2.2, 3], [1.4, 4], [1.6, 5.5], [0.9, 6.5], [1, 8], [0.4, 9.5], [0.1, 12]], '#f0bf4c', { rings: [1, 3, 5, 7], ringColor: shade(GOLD, -0.3) });
        [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(([x, y]) => lathe(S, x, y, 3, [[0.5, 0], [0.4, 1.5], [0.05, 3]], '#f0bf4c'));
        tree(S, -7, 6, 0.8); tree(S, 7, -6, 0.8);
    },
    // เมืองเก่า
    sukhothai(S, ac) {
        platform(S, PAL.grass, ac, { split: 4, splitColor: PAL.grass });
        S.poly([P(-10, 5, 0.01), P(10, 5, 0.01), P(10, 10, 0.01), P(-10, 10, 0.01)], PAL.water);
        const lotus = [[-6, 7.6], [5, 8.2], [-1, 7.2]];
        lotus.forEach(([x, y]) => { const p = P(x, y, 0.1); S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="3" ry="1.6" fill="${PAL.green}"/><circle cx="${f(p[0])}" cy="${f(p[1] - 1.4)}" r="1.1" fill="${PAL.pink}"/>`); });
        // เสาศิลาแลงหักสองแถว
        [[-7, -6, 6], [-7, -2, 4.5], [7, -6, 5.5], [7, -2, 3.5]].forEach(([x, y, h]) => cylinder(S, x, y, 0, 0.9, h, PAL.laterite));
        box(S, -4, -4, 0, 8, 8, 2, PAL.laterite);
        box(S, -3.2, -3.2, 2, 6.4, 6.4, 1.6, shade(PAL.laterite, 0.08));
        // เจดีย์ทรงดอกบัวตูม
        lathe(S, 0, 0, 3.6, [[2.6, 0], [2.6, 1.2], [1.8, 1.2], [1.8, 5], [2.4, 6], [2.6, 7.5], [2.2, 9], [1.2, 10.6], [0.3, 12], [0.1, 14]], '#9a8f80', { rings: [2, 4] });
    },
    lopburi(S, ac) {
        platform(S, PAL.grass, ac);
        box(S, -9, -3, 0, 18, 6, 2.4, PAL.laterite);
        [-5.5, 0, 5.5].forEach((x, i) => {
            box(S, x - 2, -1.8, 2.4, 4, 3.6, 3, shade(PAL.laterite, 0.06));
            lathe(S, x, 0, 5.4, [[1.9, 0], [1.9, 2], [1.6, 2.4], [1.7, 4], [1.2, 5.2], [1.3, 6.4], [0.8, 7.6], [0.85, 8.6], [0.25, 10.4], [0.05, 11.4 + (i === 1 ? 1 : 0)]], '#b07a52', { ribs: 4 });
        });
        // ลิง
        [[-8, 4], [7.5, 5], [2.6, 3.2]].forEach(([x, y], i) => {
            const p = P(x, y, i === 2 ? 2.4 : 0);
            S.add(`<g transform="translate(${f(p[0])} ${f(p[1] - 4)})"><ellipse cx="0" cy="2.6" rx="2.2" ry="2.6" fill="#9a6b45"/><circle cx="0" cy="-1" r="2.1" fill="#9a6b45"/><circle cx="-1.9" cy="-1.4" r=".9" fill="#c49470"/><circle cx="1.9" cy="-1.4" r=".9" fill="#c49470"/><ellipse cx="0" cy="-.6" rx="1.3" ry="1.1" fill="#e2bf98"/><path d="M2 3.5q3 1 2.4 -2.6" stroke="#9a6b45" stroke-width=".9" fill="none"/></g>`);
        });
    },
    ayutthaya(S, ac) {
        platform(S, PAL.grass, ac);
        box(S, -8, -8, 0, 16, 16, 1.6, PAL.brick);
        box(S, -5, -5, 1.6, 10, 10, 1.6, shade(PAL.brick, 0.05));
        [[-6.4, -6.4], [6.4, -6.4], [-6.4, 6.4], [6.4, 6.4]].forEach(([x, y]) => {
            if (y > 0 && x > 0) return;
            lathe(S, x, y, 1.6, [[1.3, 0], [1.1, 2], [0.9, 3.2], [0.5, 4.6], [0.05, 5.8]], '#b8693f', { ribs: 3 });
        });
        box(S, -2.6, -2.6, 3.2, 5.2, 5.2, 2.4, shade(PAL.brick, 0.1));
        lathe(S, 0, 0, 5.6, [[2.6, 0], [2.6, 1.6], [2, 2], [2.2, 4.5], [1.6, 6], [1.7, 8], [1.1, 9.6], [1.15, 11], [0.5, 13], [0.08, 15.5]], '#bd6e44', { ribs: 5, rings: [1, 3, 5, 7] });
        [[-6.4, 6.4], [6.4, 6.4]].forEach(([x, y]) => lathe(S, x, y, 1.6, [[1.3, 0], [1.1, 2], [0.9, 3.2], [0.5, 4.6], [0.05, 5.8]], '#b8693f', { ribs: 3 }));
    },
    // ตะวันตก–ใต้
    kanchanaburi(S, ac) {
        platform(S, PAL.water, ac, { split: -6, splitColor: PAL.grass });
        waves(S, '#ffffff', 3);
        [-8, -2.5, 3, 8.5].forEach(x => box(S, x - 0.8, -0.8, 0, 1.6, 1.6, 6, PAL.stone));
        // โครงเหล็กโค้ง
        [[-8, -2.5], [-2.5, 3], [3, 8.5]].forEach(([a, b]) => {
            const p0 = P(a, 0, 6); const p1 = P(b, 0, 6); const m = P((a + b) / 2, 0, 10);
            S.add(`<path d="M${f(p0[0])} ${f(p0[1])}Q${f(m[0])} ${f(m[1] - 4)} ${f(p1[0])} ${f(p1[1])}" stroke="#2b3240" stroke-width="1.6" fill="none"/>`);
            for (let k = 1; k < 4; k += 1) {
                const t = k / 4;
                const bx = p0[0] + (p1[0] - p0[0]) * t;
                const by = p0[1] + (p1[1] - p0[1]) * t;
                const qy = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * (m[1] - 4) + t * t * p1[1];
                line(S, [bx, by], [bx, qy], '#2b3240', 0.7);
            }
        });
        box(S, -9, -1, 6, 18.5, 2, 0.6, '#3d4554');
        // รถไฟ
        box(S, -3, -0.8, 6.6, 6, 1.6, 2.2, PAL.navy);
        windows(S, -3, -0.8, 7.1, 6, 1.6, 1.2, 'L', 3, 1, '#f4e6b8');
        box(S, 3.2, -0.8, 6.6, 3, 1.6, 2.6, PAL.red);
        tree(S, -7, -8, 0.9); tree(S, 7, -8.5, 0.8);
    },
    huahin(S, ac) {
        platform(S, PAL.paving, ac);
        [-1.2, 1.2].forEach(y => box(S, -10, y - 0.2, 0, 20, 0.4, 0.3, '#7a6a55'));
        box(S, -5, -5.5, 0, 10, 4, 1.2, PAL.white);
        [[-4.4, -5], [4, -5], [-4.4, -2.1], [4, -2.1]].forEach(([x, y]) => box(S, x, y, 1.2, 0.5, 0.5, 6, PAL.red));
        box(S, -4.6, -5.2, 7, 9.2, 3.8, 0.6, PAL.white);
        gable(S, -4.8, -5.4, 7.6, 9.6, 4.2, 4.2, PAL.red, 'x', { finial: true, gableFill: '#f3e3cf' });
        box(S, -2, -4.6, 1.2, 4, 0.4, 3, PAL.white);
        tree(S, 7, 6, 0.9); palm(S, -7, 6, 0.9);
    },
    krabi(S, ac) {
        platform(S, PAL.water, ac);
        waves(S, '#ffffff', 2);
        const karst = (x, y, r, h) => {
            lathe(S, x, y, 0, [[r, 0], [r * 1.02, h * 0.25], [r * 0.85, h * 0.55], [r * 0.9, h * 0.8], [r * 0.6, h]], '#c9bfac', { topCap: false, ribs: 5 });
            const top = [[0, 0, 1], [-0.45, 0.2, 0.75], [0.45, -0.1, 0.8], [0.1, 0.5, 0.7], [-0.2, -0.45, 0.7]];
            top.forEach(([dx, dy, k]) => sphere(S, x + dx * r, y + dy * r, h * 0.98 + k, r * 0.55 * k + 0.5, k === 1 ? '#4f9a5e' : '#5aa86a'));
            [[-0.8, 0.5, 0.55], [0.7, 0.6, 0.4]].forEach(([dx, dy, zk]) => sphere(S, x + dx * r * 0.9, y + dy * r * 0.9, h * zk, r * 0.3, '#4f9a5e'));
        };
        karst(-4, -4, 3.6, 18);
        karst(3.5, -5.5, 2.8, 13);
        karst(6, 0.5, 2.2, 9);
        // เรือหางยาว
        S.poly([P(-7, 4, 0), P(-1, 4, 0.3), P(0.5, 5, 1.6), P(-1, 6, 0.3), P(-7, 6, 0)], PAL.wood, EDGE);
        const prow = P(0.5, 5, 1.6);
        S.add(`<path d="M${f(prow[0])} ${f(prow[1])}l2 -3" stroke="${PAL.wood}" stroke-width="1"/><path d="M${f(prow[0] + 2)} ${f(prow[1] - 3)}l2 1.2-1 1.2z" fill="${PAL.red}"/><path d="M${f(prow[0] + 2)} ${f(prow[1] - 3)}l1.6 2.6" stroke="${GOLD}" stroke-width=".8"/>`);
        box(S, -4, 4.4, 0.3, 2, 1.2, 1.4, '#efe3c8');
    },
    // เมืองท่องเที่ยว
    pattaya(S, ac) {
        platform(S, PAL.sand, ac, { split: -2, splitColor: PAL.water });
        waves(S, '#ffffff', -9);
        lathe(S, -4, -6, 0, [[6, 0], [5.2, 3], [3.4, 6], [1, 8]], '#6aa96a', { topCap: false });
        const sign = P(-4.5, -3, 4.2);
        S.add(`<text x="${f(sign[0] - 1)}" y="${f(sign[1])}" font-family="Bai Jamjuree, Sarabun, Tahoma, sans-serif" font-weight="700" font-size="9" fill="#ffffff" stroke="${INK}" stroke-width=".5" paint-order="stroke" text-anchor="middle">พัทยา</text>`);
        palm(S, 5, 2, 1.05);
        // ร่มชายหาด
        const u = P(1, 6, 5);
        line(S, P(1, 6, 0), u, PAL.white, 0.7);
        S.add(`<path d="M${f(u[0] - 6)} ${f(u[1] + 1.5)}Q${f(u[0])} ${f(u[1] - 4)} ${f(u[0] + 6)} ${f(u[1] + 1.5)}Z" fill="${PAL.red}"/><path d="M${f(u[0] - 2)} ${f(u[1] - 0.4)}Q${f(u[0])} ${f(u[1] - 4)} ${f(u[0] + 2)} ${f(u[1] - 0.4)}" fill="#fff"/>`);
        box(S, 3, 7, 0, 3, 1.4, 0.6, PAL.white);
        // ร่มร่อน
        const k = P(6, -8, 18);
        S.add(`<path d="M${f(k[0] - 4)} ${f(k[1])}q4 -4 8 0z" fill="${GOLD}"/><path d="M${f(k[0] - 4)} ${f(k[1])}l4 6 4 -6" stroke="${INK}" stroke-width=".3" fill="none"/>`);
    },
    chiangmai(S, ac) {
        platform(S, PAL.grass, ac);
        pyramid(S, -5, -7, 0, 6, 9, '#4f8f6a');
        pyramid(S, 3, -8, 0, 5, 7, '#5f9f78');
        box(S, -9, 0, 0, 6.5, 2.4, 6, PAL.brick);
        box(S, 2.5, 0, 0, 6.5, 2.4, 6, PAL.brick);
        box(S, -2.5, -0.2, 0, 5, 2.8, 7.6, shade(PAL.brick, 0.06));
        const a = P(-1.3, 2.6, 0); const b = P(1.3, 2.6, 0); const t = P(0, 2.6, 5);
        S.add(`<path d="M${f(a[0])} ${f(a[1])}L${f(a[0])} ${f(t[1] + 2.4)}Q${f(t[0])} ${f(t[1] - 1.6)} ${f(b[0])} ${f(t[1] + 2.4)}L${f(b[0])} ${f(b[1])}Z" fill="${INK}" opacity=".7"/>`);
        for (let x = -8.6; x < 9; x += 1.5) { if (x < -3 || x > 2.4) box(S, x, 0, 6, 0.75, 0.8, 1, shade(PAL.brick, 0.1)); }
        [-2.3, -0.6, 1.1].forEach(x => box(S, x, -0.2, 7.6, 0.9, 0.9, 1.2, shade(PAL.brick, 0.1)));
        S.add(`<g>${[[-6, 7], [6, 8]].map(([x, y]) => { const p = P(x, y, 4 + Math.abs(x) * 0.6); return `<path d="M${f(p[0] - 1.6)} ${f(p[1])}h3.2l-.4 2.4h-2.4z" fill="${OR_LANTERN}"/><path d="M${f(p[0])} ${f(p[1] + 2.6)}v1.2" stroke="${GOLD}" stroke-width=".6"/>`; }).join('')}</g>`);
    },
    phuket(S, ac) {
        platform(S, PAL.water, ac);
        waves(S, '#ffffff', 4);
        lathe(S, -2, -3, 0, [[7, 0], [6.4, 2], [5, 4], [3, 5], [1, 5.4]], '#7b8f6a', { topCap: false });
        shadowAt(S, -2, -3, 2, 0.15);
        lathe(S, -2, -3, 4.6, [[1.6, 0], [1.3, 9], [1.6, 9.2]], PAL.white, { rings: [] });
        S.add(`<g>${[3, 6].map(z => { const p = P(-2, -3, 4.6 + z); return `<path d="M${f(p[0] - 2.3)} ${f(p[1])}A2.3 1.2 0 0 0 ${f(p[0] + 2.3)} ${f(p[1])}" stroke="${PAL.red}" stroke-width="1.6" fill="none"/>`; }).join('')}</g>`);
        cylinder(S, -2, -3, 13.8, 1.1, 1.8, GOLD);
        lathe(S, -2, -3, 15.6, [[1.4, 0], [0.2, 1.6]], PAL.red);
        const sun = P(7, -9, 14);
        S.add(`<circle cx="${f(sun[0])}" cy="${f(sun[1])}" r="5" fill="#f7a64a" opacity=".95"/><circle cx="${f(sun[0])}" cy="${f(sun[1])}" r="7.5" fill="#f7a64a" opacity=".25"/>`);
        palm(S, 5, 4, 0.8);
    },
    // กรุงเทพฯ ย่านดัง
    yaowarat(S, ac) {
        platform(S, PAL.paving, ac, { road: true });
        box(S, -9, -9, 0, 6, 5, 10, '#e7d8bd');
        box(S, 3, -9, 0, 6, 5, 9, '#d9c3a2');
        windows(S, -9, -9, 1.5, 6, 5, 7.5, 'L', 3, 3, '#7a8597');
        windows(S, 3, -9, 1.5, 6, 5, 6.5, 'R', 3, 3, '#7a8597');
        // ป้ายไฟแนวตั้ง
        [[-6, -3.9, '#ef4f4f', 7], [-3.2, -3.9, GOLD, 6], [4.6, -3.9, '#57c6f0', 6.5], [7.2, -3.9, '#ef4f4f', 5]].forEach(([x, y, c, h]) => {
            box(S, x, y, 3, 0.5, 1.6, h, c, { topK: 0.4 });
        });
        // ซุ้มประตูจีน
        [-4, 4].forEach(x => box(S, x - 0.5, 4.5, 0, 1, 1, 9, PAL.red));
        box(S, -5, 4.3, 8, 10, 1.4, 1, PAL.red);
        box(S, -5.6, 4.1, 9, 11.2, 1.8, 0.6, PAL.green);
        gable(S, -6, 4, 9.6, 12, 2, 2.4, '#2c8f56', 'x', { finial: true, gableFill: PAL.red });
        box(S, -1.6, 5.7, 6.2, 3.2, 0.2, 1.6, GOLD);
    },
    pratunam(S, ac) {
        platform(S, PAL.paving, ac);
        shadowAt(S, 0, -1, 5, 0.2);
        box(S, -3, -4, 0, 6, 6, 24, '#d9e6f1', { leftFill: S.grad('#cfe0ee') });
        for (let i = 0; i < 6; i += 1) S.poly([P(-3 + i + 0.2, 2.01, 1), P(-3 + i + 0.7, 2.01, 1), P(-3 + i + 0.7, 2.01, 23), P(-3 + i + 0.2, 2.01, 23)], ['#ef5b4c', '#f39a3d', GOLD, '#3fbf7f', '#4ea8dc', '#b07cf0'][i], ' opacity=".55"');
        windows(S, -3, -4, 1, 6, 6, 22, 'R', 3, 10, '#8fb6d6');
        box(S, -2, -3, 24, 4, 4, 2, GOLD);
        lathe(S, 0, -1, 26, [[1.4, 0], [1, 2], [0.15, 5]], GOLD, { rings: [1] });
        // แผงตลาดเสื้อผ้า
        [[-8, 5, PAL.red], [-5, 7, '#4ea8dc'], [6, 5, '#3fbf7f']].forEach(([x, y, c]) => {
            box(S, x - 1.2, y - 1, 0, 2.4, 2, 1.6, '#efe3c8');
            pyramid(S, x, y, 1.6, 1.8, 1.6, c);
        });
    },
    siam(S, ac) {
        platform(S, PAL.paving, ac);
        box(S, -9, -9, 0, 18, 7, 10, '#e9edf2');
        windows(S, -9, -9, 1.5, 18, 7, 8, 'L', 6, 2, '#86c4e8', { margin: 0.08 });
        box(S, -9, -9, 10, 18, 7, 0.8, PAL.pink);
        // รางรถไฟฟ้า
        [-6, 0, 6].forEach(x => box(S, x - 0.6, 2.4, 0, 1.2, 1.2, 6, PAL.stone));
        box(S, -10, 1.8, 6, 20, 2.4, 1, '#c9cdd4');
        box(S, -7, 2, 7, 12, 2, 3, '#f3f5f7');
        S.poly([P(-7, 4.01, 7.6), P(5, 4.01, 7.6), P(5, 4.01, 8.4), P(-7, 4.01, 8.4)], '#2fb34a');
        windows(S, -7, 2, 8.6, 12, 2, 1.2, 'L', 5, 1, '#2b3c5c', { margin: 0.12 });
        tree(S, -8, 7, 0.8); tree(S, 8, 7, 0.9);
    },
    silom(S, ac) {
        platform(S, PAL.paving, ac);
        box(S, -8, -8, 0, 6, 6, 20, '#8db8d8');
        windows(S, -8, -8, 1, 6, 6, 18, 'L', 3, 9, '#cfe6f5');
        windows(S, -8, -8, 1, 6, 6, 18, 'R', 3, 9, '#a7cbe6');
        box(S, 0, -9, 0, 7, 6, 15, '#c9d8e6');
        windows(S, 0, -9, 1, 7, 6, 13, 'L', 4, 7, '#6f98bd');
        windows(S, 0, -9, 1, 7, 6, 13, 'R', 3, 7, '#6f98bd');
        lathe(S, -5, -5, 20, [[0.3, 0], [0.05, 5]], '#dfe8f0');
        [-6, 1, 7].forEach(x => box(S, x - 0.5, 2.8, 0, 1, 1, 5.4, PAL.stone));
        box(S, -10, 2.2, 5.4, 20, 2.4, 0.9, '#c9cdd4');
        box(S, -2, 2.4, 6.3, 9, 2, 2.6, '#f3f5f7');
        S.poly([P(-2, 4.41, 6.8), P(7, 4.41, 6.8), P(7, 4.41, 7.4), P(-2, 4.41, 7.4)], '#2fb34a');
        tree(S, -7, 7, 0.9); tree(S, 7, 7, 0.8, '#3f8f5a');
    },
    // ทำเลทอง
    sukhumvit(S, ac) {
        platform(S, PAL.paving, ac);
        box(S, -9, -2, 0, 5, 5, 13, '#9cc3e0');
        windows(S, -9, -2, 1, 5, 5, 11, 'L', 2, 6, '#dcefff');
        box(S, 4, -9, 0, 5, 5, 17, '#b8cfe3');
        windows(S, 4, -9, 1, 5, 5, 15, 'R', 2, 8, '#7fa8cc');
        shadowAt(S, 0, -2, 4, 0.2);
        box(S, -2.5, -4.5, 0, 5, 5, 26, '#4f86c6', { leftFill: S.grad('#5b93d1') });
        windows(S, -2.5, -4.5, 1, 5, 5, 24, 'L', 3, 12, '#cfe6ff', { margin: 0.12 });
        windows(S, -2.5, -4.5, 1, 5, 5, 24, 'R', 3, 12, '#9fc4ea', { margin: 0.12 });
        box(S, -1.6, -3.6, 26, 3.2, 3.2, 2, GOLD);
        lathe(S, 0, -2, 28, [[0.35, 0], [0.05, 6]], GOLD);
        tree(S, -7, 7, 0.8); tree(S, 7, 7, 0.8);
    },
    // ขนส่ง
    bus(S, ac) {
        platform(S, PAL.asphalt, ac, { road: false });
        for (let i = -8; i < 9; i += 4) S.poly([P(i, 6, 0.02), P(i + 2, 6, 0.02), P(i + 2, 6.4, 0.02), P(i, 6.4, 0.02)], '#f4e6b8');
        shadowAt(S, 0, 0, 7, 0.22);
        box(S, -7, -2.5, 1, 14, 5, 7, '#f3f1ea');
        S.poly([P(-7, 2.51, 2), P(7, 2.51, 2), P(7, 2.51, 3.4), P(-7, 2.51, 3.4)], PAL.red);
        S.poly([P(-7, 2.51, 3.4), P(7, 2.51, 3.4), P(7, 2.51, 4.2), P(-7, 2.51, 4.2)], GOLD);
        windows(S, -7, -2.5, 4.6, 14, 5, 2.6, 'L', 6, 1, '#2b3c5c', { margin: 0.08 });
        windows(S, -7, -2.5, 3, 14, 5, 4.6, 'R', 1, 1, '#2b3c5c', { margin: 0.12 });
        [[-4.5, 2.5], [4.5, 2.5]].forEach(([x, y]) => { const p = P(x, y, 1); S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="2.2" ry="2.6" fill="${INK}"/><ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="1" ry="1.2" fill="#9aa3b2"/>`); });
    },
    train(S, ac) {
        platform(S, PAL.paving, ac);
        // โถงสถานีหลังคาโค้ง
        box(S, -8, -8, 0, 16, 7, 6, '#efe3c8');
        const a = P(-8, -1, 6); const b = P(8, -1, 6); const c2 = P(-8, -8, 6); const d2 = P(8, -8, 6);
        S.add(`<path d="M${f(a[0])} ${f(a[1])}Q${f((a[0] + c2[0]) / 2 - 3)} ${f((a[1] + c2[1]) / 2 - 12)} ${f(c2[0])} ${f(c2[1])}L${f(d2[0])} ${f(d2[1])}Q${f((b[0] + d2[0]) / 2 - 3)} ${f((b[1] + d2[1]) / 2 - 12)} ${f(b[0])} ${f(b[1])}Z" fill="${S.grad('#d7c6a2')}"${EDGE}/>`);
        S.add(`<path d="M${f(b[0])} ${f(b[1])}Q${f((b[0] + d2[0]) / 2 - 3)} ${f((b[1] + d2[1]) / 2 - 12)} ${f(d2[0])} ${f(d2[1])}Z" fill="#c9a96b"${EDGE}/>`);
        const cl = P(8, -4.5, 9.4);
        S.add(`<circle cx="${f(cl[0] - 1)}" cy="${f(cl[1])}" r="2.2" fill="#fff8e6" stroke="${PAL.wood}" stroke-width=".6"/>`);
        windows(S, -8, -8, 1, 16, 7, 4, 'L', 5, 1, '#8a6a3a');
        [2.4, 4.2].forEach(y => box(S, -10, y - 0.15, 0, 20, 0.3, 0.25, '#6d6150'));
        box(S, -3, 2.2, 0.3, 9, 2.2, 3.4, PAL.red);
        box(S, -3, 2.2, 3.7, 9, 2.2, 0.5, PAL.white);
        windows(S, -3, 2.2, 1.6, 9, 2.2, 1.6, 'L', 4, 1, '#f4e6b8');
    },
    ship(S, ac) {
        platform(S, PAL.water, ac, { split: -5, splitColor: PAL.paving });
        waves(S, '#ffffff', 5);
        // ปั้นจั่น
        box(S, -8, -9, 0, 1, 1, 13, GOLD); box(S, -8, -6, 0, 1, 1, 13, GOLD);
        box(S, -8, -9, 13, 1, 12, 1, shade(GOLD, -0.1));
        // เรือ
        S.poly([P(-6, -1, 0.2), P(7, -1, 0.2), P(9, 1, 1.5), P(7, 3, 0.2), P(-6, 3, 0.2)], PAL.navy, EDGE);
        box(S, -6, -1, 0.2, 13, 4, 2.2, PAL.navy, { topFill: '#c74a3c' });
        const colors = [PAL.red, '#3f8fd6', GOLD, '#3fbf7f', '#e0e0e0', '#f39a3d'];
        let k = 0;
        for (let x = -5; x < 4; x += 2.4) for (let z = 2.4; z < 6; z += 1.6) box(S, x, -0.6, z, 2.2, 3.2, 1.5, colors[(k++) % colors.length]);
        box(S, 4.4, -0.6, 2.4, 2.2, 3.2, 4.6, '#f3f1ea');
        windows(S, 4.4, -0.6, 4.4, 2.2, 3.2, 1.6, 'L', 1, 1, '#2b3c5c');
    },
    plane(S, ac) {
        platform(S, PAL.asphalt, ac);
        S.poly([P(-10, 3.6, 0.02), P(10, 3.6, 0.02), P(10, 4.1, 0.02), P(-10, 4.1, 0.02)], '#f4e6b8');
        // หอบังคับการบิน
        lathe(S, 6, -6, 0, [[1.4, 0], [1, 12], [2.6, 13.5]], '#e9edf2');
        lathe(S, 6, -6, 13.5, [[2.6, 0], [2.8, 2]], '#2b6f9a');
        lathe(S, 6, -6, 15.5, [[2.8, 0], [1, 1], [0.2, 2.6]], '#e9edf2');
        // เครื่องบิน (ลำตัวทรงกระบอกแนวนอน วาดเป็นกล่องโค้ง)
        shadowAt(S, -1, 1, 6, 0.22);
        S.poly([P(-3, -0.4, 3.6), P(2, -8, 3.6), P(3.6, -7.6, 3.6), P(1.6, -0.4, 3.6)], '#d7dee6', EDGE);
        box(S, -8, -0.9, 2.6, 15, 1.8, 2.2, '#f6f8fb', { topK: 0.1 });
        S.poly([P(-8, 0.91, 3.4), P(7, 0.91, 3.4), P(7, 0.91, 3.9), P(-8, 0.91, 3.9)], '#2b6f9a');
        windows(S, -6, -0.9, 3.9, 11, 1.8, 0.6, 'L', 9, 1, '#2b3c5c', { margin: 0.25 });
        const nose = [P(-8, -0.9, 2.6), P(-8, 0.9, 2.6), P(-8, 0.9, 4.8), P(-8, -0.9, 4.8)];
        S.add(`<path d="M${f(nose[1][0])} ${f(nose[1][1])}Q${f(nose[1][0] - 4)} ${f((nose[1][1] + nose[2][1]) / 2)} ${f(nose[2][0])} ${f(nose[2][1])}L${f(nose[3][0])} ${f(nose[3][1])}Q${f(nose[3][0] - 3)} ${f(nose[3][1] + 1)} ${f(nose[1][0])} ${f(nose[1][1])}Z" fill="#e9eef3"${EDGE}/>`);
        S.poly([P(-3, 0.4, 3.4), P(2.4, 8, 3.4), P(4, 7.6, 3.4), P(1.6, 0.4, 3.4)], '#cfd7e0', EDGE);
        cylinder(S, 0.4, 4, 2.2, 0.8, 1, '#9aa3b2');
        S.poly([P(5.5, -0.2, 4.8), P(7, -0.2, 4.8), P(7.4, -0.2, 9), P(6.6, -0.2, 9)], '#2b6f9a', EDGE);
    },
    // สาธารณูปโภค
    electric(S, ac) {
        platform(S, PAL.grass, ac);
        const base = [[-3, -3], [3, -3], [3, 3], [-3, 3]];
        const top = P(0, 0, 22);
        const mid = [P(-1.6, -1.6, 12), P(1.6, -1.6, 12), P(1.6, 1.6, 12), P(-1.6, 1.6, 12)];
        base.forEach(([x, y], i) => { line(S, P(x, y, 0), mid[i], '#59647a', 1.1); line(S, mid[i], top, '#59647a', 1); });
        for (let i = 0; i < 4; i += 1) line(S, mid[i], mid[(i + 1) % 4], '#59647a', 0.7);
        for (let i = 0; i < 4; i += 1) line(S, P(base[i][0], base[i][1], 0), mid[(i + 1) % 4], '#59647a', 0.5);
        [[16, 6], [19.5, 4.5]].forEach(([z, w]) => line(S, P(-w, 0, z), P(w, 0, z), '#59647a', 1.1));
        [[16, 6], [19.5, 4.5]].forEach(([z, w]) => { [-w, w].forEach(x => { const p = P(x, 0, z); S.add(`<rect x="${f(p[0] - 0.5)}" y="${f(p[1])}" width="1" height="2.4" fill="#9fd3ff"/>`); }); });
        const bolt = P(-6.5, 4, 9);
        S.add(`<path transform="translate(${f(bolt[0])} ${f(bolt[1])})" d="M2 -9L-4 1h3.4L-2 8 5 -2.2H1.4L3 -9z" fill="${GOLD}" stroke="${INK}" stroke-width=".5" stroke-linejoin="round"/>`);
        box(S, 4, 4, 0, 3, 2.4, 2.6, '#c9cdd4');
    },
    water(S, ac) {
        platform(S, PAL.grass, ac);
        [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]].forEach(([x, y]) => box(S, x - 0.35, y - 0.35, 0, 0.7, 0.7, 11, '#b9c2cf'));
        line(S, P(-2.4, 2.4, 3), P(2.4, 2.4, 9), '#9aa3b2', 0.6); line(S, P(2.4, 2.4, 3), P(-2.4, 2.4, 9), '#9aa3b2', 0.6);
        lathe(S, 0, 0, 10.5, [[1, 0], [4, 1.5], [4.2, 6], [3.6, 7.4], [0.6, 8.6]], '#4e9fd6', { rings: [1, 3] });
        const p = P(0, 4.2, 14);
        S.add(`<path transform="translate(${f(p[0] - 3)} ${f(p[1] - 1)})" d="M0 -3.2c1.6 2 2.6 3.4 2.6 4.6a2.6 2.6 0 0 1-5.2 0c0-1.2 1-2.6 2.6-4.6z" fill="#ffffff"/>`);
        // ก๊อกน้ำ
        box(S, 5, 4, 0, 0.8, 0.8, 3, '#9aa3b2'); box(S, 5, 4, 3, 2.4, 0.8, 0.6, '#9aa3b2');
        const drip = P(7, 4.4, 1.8);
        S.add(`<circle cx="${f(drip[0])}" cy="${f(drip[1])}" r=".9" fill="#5fb6e6"/>`);
        tree(S, -7, 6, 0.8);
    },
    // มุม
    go(S) {
        platform(S, '#f3e2b0', '#c94a3c');
        [[-5, 4, 4], [-3.2, 6, 3], [5, 5, 2]].forEach(([x, y, n]) => { for (let i = 0; i < n; i += 1) cylinder(S, x, y, i * 0.7, 1.6, 0.6, GOLD); });
        box(S, -0.5, -8.5, 0, 1, 1, 13, '#8a5a33');
        box(S, -4, -6, 0, 8, 6, 3, PAL.red);
        const a = P(0, -8, 14);
        S.add(`<path transform="translate(${f(a[0])} ${f(a[1])})" d="M16 -4H-1V-11L-16 1-1 13V6h17z" fill="${S.grad(GOLD)}" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/>`);
        const s = P(0, -3, 3);
        S.add(`<text x="${f(s[0] - 1)}" y="${f(s[1] + 2)}" font-family="Chakra Petch, Bai Jamjuree, sans-serif" font-weight="700" font-size="6" fill="#fff8e6" text-anchor="middle">เริ่ม</text>`);
    },
    jail(S, ac) {
        platform(S, PAL.paving, ac);
        box(S, -6, -6, 0, 12, 9, 8, '#a9afba');
        gable(S, -6.4, -6.4, 8, 12.8, 9.8, 3.2, '#5b6577', 'x');
        const fr = [P(-4, 3.01, 2), P(3, 3.01, 2), P(3, 3.01, 6.5), P(-4, 3.01, 6.5)];
        S.poly(fr, '#2b3240');
        for (let x = -3.4; x < 3; x += 0.9) line(S, P(x, 3.02, 2), P(x, 3.02, 6.5), '#c9d0dc', 0.7);
        windows(S, -6, -6, 3, 12, 9, 3, 'R', 2, 1, '#2b3240');
        box(S, -2, 3, 6.6, 3.6, 0.3, 1.6, GOLD);
        const sg = P(-0.2, 3.3, 7.1);
        S.add(`<text x="${f(sg[0])}" y="${f(sg[1] + 1)}" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="3.4" fill="${INK}" text-anchor="middle">คุก</text>`);
    },
    parking(S, ac) {
        platform(S, PAL.paving, ac);
        for (let x = -9; x < 10; x += 6) S.poly([P(x, -9.5, 0.02), P(x + 0.4, -9.5, 0.02), P(x + 0.4, 9.5, 0.02), P(x, 9.5, 0.02)], '#ffffff');
        tree(S, -7, 3, 1.3);
        tree(S, 6.5, -7, 1.1);
        shadowAt(S, 0.5, 1, 6.5, 0.22);
        // ตุ๊กตุ๊ก (ล้อหน้า 1 ล้อหลัง 2)
        const wheel = (x, y) => { const p = P(x, y, 1.2); S.add(`<ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx="1.9" ry="2.5" fill="${INK}"/><ellipse cx="${f(p[0])}" cy="${f(p[1])}" rx=".9" ry="1.2" fill="#c9cdd4"/>`); };
        wheel(-3.5, -1.8);
        box(S, -5, -2, 1, 7, 4.6, 2.4, '#2d8bd6');
        box(S, -4.4, -1.6, 3.4, 4.4, 3.8, 1.6, GOLD);
        box(S, 2, -1.2, 1, 3.6, 3, 2.2, '#2d8bd6');
        S.poly([P(5.6, -1, 3.2), P(5.6, 1.6, 3.2), P(5.6, 1.6, 6.8), P(5.6, -1, 6.8)], '#bfe3ff', ' opacity=".85"' + EDGE);
        [[-5, -2], [-5, 2.6], [5.4, -1.2], [5.4, 1.8]].forEach(([x, y]) => box(S, x, y - 0.2, 3.2, 0.35, 0.35, 4.6, '#2b3240'));
        box(S, -5.6, -2.6, 7.8, 11.6, 5.8, 0.5, '#1f6aa8');
        S.poly([P(-5.6, 3.21, 7.4), P(6, 3.21, 7.4), P(6, 3.21, 7.8), P(-5.6, 3.21, 7.8)], GOLD);
        wheel(-3.5, 2.8);
        wheel(5, 0.3);
    },
    police(S, ac) {
        platform(S, PAL.paving, ac, { road: true });
        shadowAt(S, -2, -4, 3.5, 0.2);
        box(S, -5, -7, 0, 6, 6, 7, '#f3f1ea');
        windows(S, -5, -7, 2.6, 6, 6, 3.6, 'L', 2, 1, '#7cc4ea');
        windows(S, -5, -7, 2.6, 6, 6, 3.6, 'R', 2, 1, '#7cc4ea');
        S.poly([P(-5, -0.99, 0.6), P(1, -0.99, 0.6), P(1, -0.99, 1.6), P(-5, -0.99, 1.6)], '#2b5fa8');
        box(S, -5.6, -7.6, 7, 7.2, 7.2, 1, '#2b5fa8');
        box(S, -2.6, -4.6, 8, 1.2, 1.2, 1, PAL.red, { topK: 0.5 });
        // กรวยจราจร + นกหวีด
        [[5, 5], [7, 3]].forEach(([x, y]) => { lathe(S, x, y, 0, [[1.3, 0], [0.2, 4]], '#f39a3d', { rings: [] }); const p = P(x, y, 2); S.add(`<path d="M${f(p[0] - 1)} ${f(p[1])}h2" stroke="#fff" stroke-width=".8"/>`); });
        const w = P(4, -6, 12);
        S.add(`<g transform="translate(${f(w[0])} ${f(w[1])}) scale(.55)">${'<path d="M3 10.5h9.5l2-2h6.5v5.5h-4.6a5.5 5.5 0 1 1-10.9 0z" fill="#f5c86b" stroke="#1a2332" stroke-width="1.4" transform="translate(-12 -12)"/>'}</g>`);
    },
    // การ์ด / ภาษี
    chance(S) {
        platform(S, '#f3e2b0', '#c9962f');
        box(S, -4, -4, 0, 8, 8, 1.6, '#2b3c5c');
        box(S, -3, -3, 1.6, 6, 6, 3, '#35486d');
        box(S, -3.4, -3.4, 4.6, 6.8, 6.8, 0.8, GOLD);
        const p = P(0, 0, 13);
        S.add(`<path transform="translate(${f(p[0])} ${f(p[1])})" d="M0 -11l3.4 7 7.8 1-5.6 5.4 1.4 7.8L0 6.5l-7 3.7 1.4-7.8-5.6-5.4 7.8-1z" fill="${S.grad(GOLD)}" stroke="${INK}" stroke-width=".7" stroke-linejoin="round"/><text x="${f(p[0])}" y="${f(p[1] + 3.6)}" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="9" fill="${INK}" text-anchor="middle">?</text>`);
        [[-8, -14], [9, -18], [-10, -2]].forEach(([dx, dy]) => S.add(`<path transform="translate(${f(p[0] + dx)} ${f(p[1] + dy)})" d="M0 -2.4l.7 1.7 1.7.7-1.7.7L0 2.4l-.7-1.7-1.7-.7 1.7-.7z" fill="#fff6cf"/>`));
    },
    fortune(S) {
        platform(S, '#f3e2b0', '#b5332c');
        const tips = [[-1.6, 22, PAL.red], [-0.6, 24, GOLD], [0.4, 23, PAL.red], [1.4, 25, GOLD], [0.9, 21.5, PAL.red]];
        tips.forEach(([dx, h]) => line(S, P(dx, 0, 8), P(dx * 1.6, -dx * 0.4, h - 3), '#d9b27a', 1.4));
        tips.forEach(([dx, h, c]) => { const p = P(dx * 1.6, -dx * 0.4, h - 3); S.add(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="1" fill="${c}"/>`); });
        lathe(S, 0, 0, 0, [[3.4, 0], [3.6, 2], [3.2, 9], [3.5, 10]], '#c23a32', { rings: [1, 2], ringColor: GOLD, ringW: 1.2 });
        const s = P(0, 3.4, 5);
        S.add(`<text x="${f(s[0])}" y="${f(s[1] + 1)}" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="4" fill="${GOLD}" text-anchor="middle">ดวง</text>`);
        const stick = P(4, 5, 0.3);
        S.add(`<path d="M${f(stick[0])} ${f(stick[1])}l10 -3" stroke="#d9b27a" stroke-width="1.4" stroke-linecap="round"/><circle cx="${f(stick[0] + 10)}" cy="${f(stick[1] - 3)}" r="1" fill="${GOLD}"/>`);
    },
    tax(S, ac) {
        platform(S, PAL.paving, ac);
        box(S, -8, -6, 0, 16, 9, 1.4, '#e8e2d4');
        box(S, -7, -5.4, 1.4, 14, 7.6, 7, '#f3efe6');
        for (let x = -6.4; x < 7; x += 2.2) cylinder(S, x, 2.6, 1.4, 0.55, 7, '#ffffff');
        box(S, -7.4, -5.8, 8.4, 14.8, 8.4, 1, '#e8e2d4');
        gable(S, -7.4, -5.8, 9.4, 14.8, 8.4, 3.4, '#cbbfa5', 'y', { gableFill: '#efe7d6' });
        const s = P(-0.2, 3.1, 4);
        S.add(`<text x="${f(s[0])}" y="${f(s[1])}" font-family="Chakra Petch, sans-serif" font-weight="700" font-size="5" fill="${PAL.red}" text-anchor="middle">฿</text>`);
    },
    luxury(S, ac) {
        platform(S, PAL.paving, ac);
        lathe(S, 0, 0, 0, [[3, 0], [3, 2], [2.4, 2.6], [2.4, 4]], '#a8873f', { topCap: true });
        box(S, -3.4, -3.4, 4, 6.8, 6.8, 1.8, '#9b2d4a', { topK: 0.15 });
        const p = P(0, 0, 11);
        S.add(`<g transform="translate(${f(p[0])} ${f(p[1])})"><path d="M-8 -4l3.6-4.6h8.8L8 -4 0 7z" fill="#bfe6ff" stroke="${INK}" stroke-width=".6" stroke-linejoin="round"/><path d="M-8 -4h16M-4.4 -8.6L-2.4 -4 0 7M4.4 -8.6L2.4 -4 0 7M-2.4 -4L0 -8.6 2.4 -4" fill="none" stroke="#5d9fd0" stroke-width=".6"/><path d="M-6.8 -4.6l2.4-3" stroke="#fff" stroke-width="1" stroke-linecap="round"/></g>`);
        [[-9, -14], [8, -12], [-4, -20]].forEach(([dx, dy]) => S.add(`<path transform="translate(${f(p[0] + dx)} ${f(p[1] + dy)})" d="M0 -2.4l.7 1.7 1.7.7-1.7.7L0 2.4l-.7-1.7-1.7-.7 1.7-.7z" fill="#ffffff"/>`));
    }
};
const OR_LANTERN = '#f39a3d';

const ART_OF = Object.fromEntries(B.SQUARES.map(sq => [sq.index, sq.art]));

function accentFor(index) {
    const sq = B.SQUARES[index];
    if (sq.group) return B.GROUPS[sq.group].color;
    if (sq.type === 'transport') return '#35435e';
    if (sq.type === 'utility') return '#4c5f80';
    return '#35435e';
}

function render(name, accent) {
    const S = makeScene();
    SCENES[name](S, accent);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240"><defs>${S.defsSvg()}</defs>${S.body()}</svg>`;
}

/** ครอป viewBox ให้พอดีภาพ (สี่เหลี่ยมจัตุรัส เว้นขอบนิดหน่อย) ด้วยเบราว์เซอร์จริง */
async function fitAll(files) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    for (const file of files) {
        const svg = fs.readFileSync(file, 'utf8');
        await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', '<svg id="s" ')}</body></html>`);
        const box = await page.evaluate(() => { const s = document.getElementById('s'); const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); [...s.childNodes].filter(n => n.nodeName !== 'defs').forEach(n => g.appendChild(n)); s.appendChild(g); const b = g.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
        const side = Math.max(box.w, box.h) * 1.04;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const vb = [cx - side / 2, cy - side / 2 + (box.h < box.w ? -side * 0.04 : 0), side, side].map(n => Math.round(n * 100) / 100).join(' ');
        fs.writeFileSync(file, svg.replace('viewBox="0 0 120 120"', `viewBox="${vb}"`));
    }
    await browser.close();
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const done = new Set();
    let bytes = 0;
    Object.keys(ART_OF).forEach(i => {
        const name = ART_OF[i];
        if (done.has(name)) return;
        done.add(name);
        const svg = render(name, accentFor(Number(i)));
        fs.writeFileSync(path.join(OUT, name + '.svg'), svg);
        bytes += Buffer.byteLength(svg);
    });
    await fitAll([...done].map(n => path.join(OUT, n + '.svg')));
    fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(ART_OF));
    console.log(`wrote ${done.size} landmark SVGs (${(bytes / 1024).toFixed(1)} KB) → ${OUT}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { ART_OF, SCENES, render };
