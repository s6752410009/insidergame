/**
 * ตัวกรองคำหยาบ + ลิงก์/ช่องทางติดต่อ ของแชทโลก (pure \u2014 ไม่มี I/O เทสได้ตรงๆ)
 *
 * ทำไมไม่ใช้ substring ธรรมดา (แบบ gameSettingsManager.filterProfanity):
 *   - หลบง่าย: "ค ว ย", "ค.ว.ย", "ควยยยย", "ค่วย", "ฅวย", "f*ck", "k u y"
 *   - โดนคำบริสุทธิ์: "หีบ" (กล่อง), "เห่า", "ห่าง", "ห้า", "แม่งาน", "เหี่ยว"
 *
 * วิธีทำ \u2014 แปลงข้อความเป็น "โครง" (view) แล้วค่อยจับคำ:
 *   1. NFKC + ตัวพิมพ์เล็ก, ตัดอักขระล่องหน (zero-width, soft hyphen, variation selector),
 *      ตัดเครื่องหมายเสียงของอักษรละติน (f\u00FAck \u2192 fuck), ประกอบ "ํา" กลับเป็น "ำ"
 *   2. แทนตัวหน้าตาคล้าย: ฅ\u2192ค ฃ\u2192ข ศ/ษ\u2192ส ฬ\u2192ห, ซีริลลิก/กรีก \u2192 ละติน, เลขไทย \u2192 อารบิก
 *   3. โครงไทย: เก็บเฉพาะอักษรไทย ตัดตัวคั่นระหว่างตัวอักษร (เว้นวรรค จุด ขีด อีโมจิ ๆ ฯ)
 *      ตัวปิดบังตัวเดียวระหว่างอักษรไทย (* x @ # 0 o ?) = ตัวแทน (wildcard)
 *      คำ/ตัวเลขละตินยาวๆ คั่นกลาง = ตัดตอน (คำห้ามข้ามไม่ได้)
 *      แล้วยุบตัวซ้ำติดกัน (เย็ดดดด \u2192 เย็ด)
 *        - มุมมอง "ไม่มีวรรณยุกต์": ตัด ่ ้ ๊ ๋ ็ ์ ํ ๎ ทิ้ง \u2192 จับ "ค่วย", "เหี๊ย", "เย้ด"
 *        - มุมมอง "วรรณยุกต์ตรง": ใช้กับคำที่ถ้าตัดวรรณยุกต์แล้วชนคำปกติ
 *          (ห่า\u2192หา "หา/ห้า", แม่ง\u2192แมง "แมงมุม", คว้าย\u2192ควาย "ควาย")
 *   4. โครงละติน: leet (0\u2192o 1\u2192i 3\u2192e 4\u2192a 5\u2192s 7\u2192t @\u2192a $\u2192s), * # × ระหว่างตัวอักษร = ตัวแทน,
 *      ตัวอักษรเดี่ยวที่เว้นวรรคกัน ต่อเป็นคำเดียว (f u c k \u2192 fuck), ตัวซ้ำได้ (fuuuck)
 *      คำสั้น (kuy, hee, yed) ต้องเป็นทั้งคำ ไม่จับกลางคำอังกฤษ
 *
 * กันจับผิด:
 *   - allow-list: คำที่มีคำต้องห้ามซ้อนอยู่ (หีบ, ห่าง, ห่าน, แม่งาน, เหี่ยว, สัสดี, shiitake…)
 *     จับได้ตรงไหนแล้วทั้งช่วงอยู่ในคำ allow \u2192 ปล่อยผ่าน
 *   - สระหน้า (เ แ โ ใ ไ) อยู่ติดหน้าคำไทยที่ขึ้นต้นด้วยพยัญชนะ = คนละพยางค์ (เห่า \u2260 ห่า)
 *   - คำแบบวรรณยุกต์ตรงที่ลงท้ายด้วยพยัญชนะ แล้วถัดไปเป็นสระ/วรรณยุกต์ = ตัวสุดท้ายเป็นต้นพยางค์ใหม่
 *     (แม่ + ง่าย, แม่ + งู \u2260 แม่ง)
 */

'use strict';

const WILD = '\u0001';
const BREAK = '\u0002';

// ---------- ตารางตัวอักษร ----------

const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;
const LATIN_COMBINING_RE = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF]/g;
const TONE_MARK_CHAR_RE = /^[\u0E47-\u0E4E]$/;
const TONE_AND_MARKS_RE = /[็-๎]/g; // ็ ่ ้ ๊ ๋ ์ ํ ๎

const HOMOGLYPHS = {
    // ไทยที่หน้าตาเหมือนกัน
    'ฅ': 'ค', 'ฃ': 'ข', 'ศ': 'ส', 'ษ': 'ส', 'ฬ': 'ห',
    // ซีริลลิก
    '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u0451': 'e', '\u043A': 'k', '\u043C': 'm', '\u043D': 'h', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c',
    '\u0442': 't', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0457': 'i', '\u0458': 'j', '\u0455': 's', '\u0501': 'd', '\u051B': 'q', '\u051D': 'w', '\u04AF': 'y',
    // กรีก
    '\u03B1': 'a', '\u03B2': 'b', '\u03B5': 'e', '\u03B7': 'n', '\u03B9': 'i', '\u03BA': 'k', '\u03BD': 'v', '\u03BF': 'o', '\u03C1': 'p', '\u03C4': 't',
    '\u03C5': 'u', '\u03C7': 'x', '\u03C9': 'w', '\u03BC': 'u'
};
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
// ตัวปิดบังที่คนใช้แทนตัวอักษร
const THAI_MASK_CHARS = new Set(['*', 'x', '×', '@', '#', '0', 'o', '?', '$', '%']);
const LATIN_MASK_CHARS = new Set(['*', '#', '×', '%']);

const LEADING_VOWELS = new Set(['เ', 'แ', 'โ', 'ใ', 'ไ']);

function isThaiLetter(ch) {
    // ก-ฮ, สระ, วรรณยุกต์ \u2014 ไม่รวม ฯ (0E2F) ๆ (0E46) เลขไทย และ ฿
    const code = ch.charCodeAt(0);
    return code >= 0x0E01 && code <= 0x0E4E && code !== 0x0E2F && code !== 0x0E3F && code !== 0x0E46;
}

function isThaiConsonant(ch) {
    const code = ch.charCodeAt(0);
    return code >= 0x0E01 && code <= 0x0E2E;
}

// สระหลัง/บน/ล่าง + วรรณยุกต์ (ไม่รวมสระหน้า) \u2014 ตามหลังพยัญชนะตัวไหน ตัวนั้นเป็นต้นพยางค์
function isDependentThai(ch) {
    const code = ch.charCodeAt(0);
    return (code >= 0x0E30 && code <= 0x0E3A) || (code >= 0x0E45 && code <= 0x0E4E && code !== 0x0E46);
}

function isLatinLetter(ch) {
    return ch >= 'a' && ch <= 'z';
}

function isSeparator(ch) {
    // ไม่ใช่ตัวอักษร/ตัวเลขทุกภาษา = ตัวคั่น (เว้นวรรค จุด ขีด อีโมจิ ๆ ฯ …)
    if (ch === 'ๆ' || ch === 'ฯ') return true;
    return !/[\p{L}\p{N}]/u.test(ch);
}

// ---------- ขั้นที่ 1\u20132: ทำให้เป็นรูปเดียวกัน ----------

function baseNormalize(input) {
    let text = String(input == null ? '' : input);
    text = text.normalize('NFKD').replace(LATIN_COMBINING_RE, '').normalize('NFC');
    text = text.toLowerCase().replace(INVISIBLE_RE, '');
    // NFKD แตก "ำ" เป็น "ํ" + "า" \u2014 ประกอบกลับ (คนพิมพ์ ํา เองเพื่อหลบก็จับได้)
    text = text.replace(/ํา/g, 'ำ');
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code >= 0x0E50 && code <= 0x0E59) out += String(code - 0x0E50);
        else out += HOMOGLYPHS[ch] || ch;
    }
    return out;
}

function collapseRuns(chars) {
    const out = [];
    for (const ch of chars) {
        if (out.length && out[out.length - 1] === ch) continue;
        out.push(ch);
    }
    return out;
}

// ---------- ขั้นที่ 3: โครงไทย ----------

function buildThaiSkeleton(base) {
    const out = [];
    let gap = [];
    for (const ch of base) {
        if (isThaiLetter(ch)) {
            if (out.length && gap.length) {
                const meaningful = gap.filter(g => !isSeparator(g) || THAI_MASK_CHARS.has(g));
                if (meaningful.length === 0) {
                    // มีแต่ตัวคั่น \u2192 ต่อกัน
                } else if (meaningful.length === 1 && THAI_MASK_CHARS.has(meaningful[0])) {
                    out.push(WILD);
                } else {
                    out.push(BREAK);
                }
            }
            gap = [];
            out.push(ch);
        } else if (out.length) {
            gap.push(ch);
        }
    }
    const exact = collapseRuns(out);
    const toneless = collapseRuns(exact.filter(ch => !TONE_MARK_CHAR_RE.test(ch)));
    return { exact: exact.join(''), toneless: toneless.join('') };
}

function stripThaiMarks(text) {
    return text.replace(TONE_AND_MARKS_RE, '');
}

// ---------- ขั้นที่ 4: โครงละติน ----------

function buildLatinTokens(base) {
    const chars = Array.from(base);
    const mapped = chars.map((ch, index) => {
        if (LEET[ch] !== undefined) return LEET[ch];
        if (ch === '!' || ch === '|') {
            const prev = chars[index - 1] || '';
            const next = chars[index + 1] || '';
            if (/[a-z]/.test(prev) && /[a-z]/.test(next)) return 'i';
        }
        if (LATIN_MASK_CHARS.has(ch)) {
            const prev = chars[index - 1] || '';
            const next = chars[index + 1] || '';
            if (/[a-z*#×%]/.test(prev) || /[a-z*#×%]/.test(next)) return WILD;
        }
        return ch;
    });

    // แบ่งคำ: ตัวคั่นธรรมดา = รอยต่อเบา (ต่อคำเดี่ยวได้), อักษรไทย/ตัวเลข = รอยต่อแข็ง
    const tokens = [];
    let current = '';
    let hardBefore = true;
    let pendingHard = false;
    const pushToken = () => {
        if (current) tokens.push({ text: current, hardBefore });
        current = '';
    };
    for (const ch of mapped) {
        if (isLatinLetter(ch) || ch === WILD) {
            if (!current) {
                hardBefore = pendingHard || tokens.length === 0;
                pendingHard = false;
            }
            current += ch;
        } else {
            pushToken();
            if (!isSeparator(ch)) pendingHard = true;
        }
    }
    pushToken();

    // f u c k \u2192 fuck : ต่อคำยาวหนึ่งตัวอักษรที่คั่นด้วยตัวคั่นธรรมดา
    const merged = [];
    for (const token of tokens) {
        const last = merged[merged.length - 1];
        if (last && token.text.length === 1 && last.singles && !token.hardBefore) {
            last.text += token.text;
            continue;
        }
        merged.push({ text: token.text, singles: token.text.length === 1 });
    }
    return merged.map(token => token.text);
}

// ---------- คอมไพล์รายการคำ ----------

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ระบุจาก string ที่แอดมินพิมพ์: "=ห่า" = บังคับวรรณยุกต์ตรง */
function parseWordSpec(raw) {
    if (raw && typeof raw === 'object') return { ...raw, word: String(raw.word || '') };
    let word = String(raw == null ? '' : raw).trim();
    let exact = false;
    if (word.startsWith('=')) {
        exact = true;
        word = word.slice(1).trim();
    }
    return { word, exact };
}

function isThaiWord(word) {
    return /[ก-๎]/.test(word);
}

function compileThaiTerm(spec) {
    const base = baseNormalize(spec.word);
    const skeleton = buildThaiSkeleton(base);
    const hasMarks = skeleton.exact !== skeleton.toneless;
    // ตัดวรรณยุกต์แล้วเหลือ \u22642 ตัว (เช่น ห่า\u2192หา) ชนคำปกติแน่นอน \u2192 ต้องตรงวรรณยุกต์
    const exact = Boolean(spec.exact) || (hasMarks && Array.from(skeleton.toneless).length <= 2);
    const form = exact ? skeleton.exact : skeleton.toneless;
    const chars = Array.from(form).filter(ch => ch !== WILD && ch !== BREAK);
    if (chars.length < 2) return null;
    const consonants = chars.filter(isThaiConsonant).length;
    const pattern = chars.map((ch, index) => {
        const interior = index > 0 && index < chars.length - 1;
        return interior && isThaiConsonant(ch) ? `(?:${escapeRegex(ch)}|${WILD})` : escapeRegex(ch);
    }).join('');
    return {
        kind: 'thai',
        word: spec.word,
        view: exact ? 'exact' : 'toneless',
        form: chars.join(''),
        regex: new RegExp(pattern, 'g'),
        consonants,
        maxWild: consonants >= 4 ? 2 : 1,
        startsWithConsonant: isThaiConsonant(chars[0]),
        endsWithConsonant: isThaiConsonant(chars[chars.length - 1]),
        checkTrailing: exact
    };
}

function latinRunPattern(word, allowWild) {
    // ตัวซ้ำได้ (fuuuck) \u2014 กลุ่มตัวเดียวกันติดกันเป็น "อย่างน้อย n ตัว"
    const runs = [];
    for (const ch of word) {
        const last = runs[runs.length - 1];
        if (last && last.ch === ch) last.count += 1;
        else runs.push({ ch, count: 1 });
    }
    return runs.map((run, index) => {
        const interior = index > 0 && index < runs.length - 1;
        const cls = interior && allowWild ? `[${escapeRegex(run.ch)}${WILD}x]` : escapeRegex(run.ch);
        return run.count > 1 ? `${cls}{${run.count},}` : `${cls}+`;
    }).join('');
}

function compileLatinTerm(spec) {
    const word = baseNormalize(spec.word).replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    if (word.replace(/ /g, '').length < 3) return null;
    const phrase = word.includes(' ');
    const letters = word.replace(/ /g, '');
    const mode = spec.mode || (phrase ? 'phrase' : letters.length <= 4 ? 'token' : 'sub');
    const allowWild = letters.length >= 4;
    let regex;
    if (mode === 'phrase') {
        const body = word.split(' ').map(part => latinRunPattern(part, false)).join(' ');
        regex = new RegExp(`(?:^| )${body}(?= |$)`);
    } else if (mode === 'token') {
        const prefix = spec.prefix ? `(?:${spec.prefix})?` : '';
        regex = new RegExp(`^${prefix}${latinRunPattern(letters, allowWild)}$`);
    } else {
        regex = new RegExp(latinRunPattern(letters, allowWild), 'g');
    }
    return { kind: 'latin', word: spec.word, mode, letters, regex };
}

/**
 * คำต้องห้ามตั้งต้น \u2014 ครอบ DEFAULT_PROFANITY ใน gameSettingsManager ทั้งหมด (มีเทสเช็ก)
 * exact = ต้องตรงวรรณยุกต์ (ดูหัวไฟล์)
 */
const BUILTIN_BLOCK = [
    { word: 'ควย' }, { word: 'หี' }, { word: 'เย็ด' }, { word: 'เงี่ยน' }, { word: 'เหี้ย' },
    { word: 'สัส' }, { word: 'ไอสัส' }, { word: 'ระยำ' },
    { word: 'ห่า', exact: true },
    { word: 'แม่ง', exact: true }, { word: 'แม้ง', exact: true }, { word: 'แม๊ง', exact: true },
    { word: 'แมร่ง', exact: true }, { word: 'แมร้ง', exact: true },
    // ควาย (วัว/ควาย) เป็นคำปกติ \u2014 จับเฉพาะรูปที่ใช้แทน ควย หรือด่าตรงตัว
    { word: 'คว้าย', exact: true }, { word: 'ควั้ย', exact: true }, { word: 'ควุ้ย', exact: true },
    { word: 'ไอ้ควาย' }, { word: 'อีควาย' },
    // ละติน
    { word: 'fuck', mode: 'sub' }, { word: 'fuk', mode: 'token' }, { word: 'fck', mode: 'token' },
    { word: 'shit', mode: 'sub' }, { word: 'bitch', mode: 'sub' }, { word: 'asshole', mode: 'sub' },
    { word: 'kuy', mode: 'token', prefix: 'ai' }, { word: 'kuay', mode: 'token', prefix: 'ai' },
    { word: 'hee', mode: 'token', prefix: 'ai|e' }, { word: 'yed', mode: 'token' }, { word: 'yedmae', mode: 'sub' },
    { word: 'ngian', mode: 'token' }, { word: 'aisus', mode: 'token' }, { word: 'ai sus', mode: 'phrase' },
    { word: 'aisas', mode: 'token' }, { word: 'ai sas', mode: 'phrase' }
];

/** คำปกติที่มีคำต้องห้ามซ้อนอยู่ข้างใน */
const BUILTIN_ALLOW = [
    // หี
    'หีบ',
    // เหี้ย (ตัดวรรณยุกต์แล้วเหลือ เหีย)
    'เหี่ยว', 'เหี้ยม', 'เหี้ยน', 'เหียน', 'เหียง',
    // ห่า
    'ห่าง', 'ห่าน', 'ห่าม',
    // แม่ง (แม่ + คำที่ขึ้นด้วย ง)
    'แม่งาน', 'แม่งอน', 'แม่งอแง', 'แม่งู', 'แม่งัว',
    // สัส (ศ/ษ ถูกแปลงเป็น ส)
    'สัสดี', 'ศัสตรา',
    // ละติน
    'shiitake', 'shitake', 'shitzu', 'shihtzu'
];

function wordKey(raw) {
    const spec = parseWordSpec(raw);
    return (spec.exact ? '=' : '') + spec.word.normalize('NFC').toLowerCase();
}

/**
 * @param {Object} options { extraWords: [], removedWords: [], allowWords: [] }
 *   removedWords = คำตั้งต้นที่แอดมินปิด (ตรงกับ word ใน BUILTIN_BLOCK)
 */
function compileFilter(options = {}) {
    const removed = new Set((options.removedWords || []).map(word => String(word).normalize('NFC').toLowerCase()));
    const removedAllow = new Set((options.removedAllowWords || []).map(word => String(word).normalize('NFC').toLowerCase()));
    const specs = [];
    const seen = new Set();
    const addSpec = spec => {
        if (!spec.word) return;
        const key = (spec.exact ? '=' : '') + spec.word.normalize('NFC').toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        specs.push(spec);
    };
    BUILTIN_BLOCK.forEach(spec => {
        if (!removed.has(spec.word.normalize('NFC').toLowerCase())) addSpec(spec);
    });
    (options.extraWords || []).forEach(raw => addSpec(parseWordSpec(raw)));

    const thaiTerms = [];
    const latinTerms = [];
    specs.forEach(spec => {
        if (isThaiWord(spec.word)) {
            const term = compileThaiTerm(spec);
            if (term) thaiTerms.push(term);
        } else {
            const term = compileLatinTerm(spec);
            if (term) latinTerms.push(term);
        }
    });

    const allowWords = BUILTIN_ALLOW.filter(word => !removedAllow.has(word.normalize('NFC').toLowerCase()))
        .concat((options.allowWords || []).map(word => String(word || '').trim()).filter(Boolean));
    const thaiAllow = { exact: new Set(), toneless: new Set() };
    const latinAllow = new Set();
    allowWords.forEach(word => {
        if (isThaiWord(word)) {
            const skeleton = buildThaiSkeleton(baseNormalize(word));
            if (skeleton.exact) thaiAllow.exact.add(skeleton.exact);
            if (skeleton.toneless) thaiAllow.toneless.add(skeleton.toneless);
        } else {
            const latin = baseNormalize(word).replace(/[^a-z]/g, '');
            if (latin) latinAllow.add(latin);
        }
    });

    return { thaiTerms, latinTerms, thaiAllow, latinAllow, size: thaiTerms.length + latinTerms.length };
}

// ---------- การจับคำ ----------

function allowSpans(view, allowSet) {
    const spans = [];
    allowSet.forEach(word => {
        let index = view.indexOf(word);
        while (index !== -1) {
            spans.push([index, index + word.length]);
            index = view.indexOf(word, index + 1);
        }
    });
    return spans;
}

function insideAllow(spans, start, end) {
    return spans.some(([s, e]) => s <= start && end <= e);
}

function findThai(views, compiled) {
    const hits = [];
    const spans = {
        exact: allowSpans(views.exact, compiled.thaiAllow.exact),
        toneless: allowSpans(views.toneless, compiled.thaiAllow.toneless)
    };
    compiled.thaiTerms.forEach(term => {
        const view = views[term.view];
        const regex = term.regex;
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(view)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            regex.lastIndex = start + 1;
            const wild = (match[0].match(new RegExp(WILD, 'g')) || []).length;
            if (wild > term.maxWild || term.consonants - wild < 2 && wild > 0) continue;
            if (term.startsWithConsonant && start > 0 && LEADING_VOWELS.has(view[start - 1])) continue;
            if (term.checkTrailing && term.endsWithConsonant && end < view.length && isDependentThai(view[end])) continue;
            if (insideAllow(spans[term.view], start, end)) continue;
            hits.push(term.word);
            break;
        }
    });
    return hits;
}

function findLatin(tokens, compiled) {
    const hits = [];
    const allowed = token => {
        const clean = token.replace(new RegExp(WILD, 'g'), '');
        for (const word of compiled.latinAllow) {
            if (clean.includes(word)) return true;
        }
        return false;
    };
    const phraseText = tokens.join(' ');
    compiled.latinTerms.forEach(term => {
        if (term.mode === 'phrase') {
            if (term.regex.test(phraseText)) hits.push(term.word);
            return;
        }
        for (const token of tokens) {
            if (term.mode === 'token') {
                if (term.regex.test(token) && !allowed(token)) {
                    hits.push(term.word);
                    return;
                }
                continue;
            }
            term.regex.lastIndex = 0;
            let match;
            while ((match = term.regex.exec(token)) !== null) {
                term.regex.lastIndex = match.index + 1;
                const wild = (match[0].match(new RegExp(`[${WILD}]`, 'g')) || []).length;
                const real = match[0].length - wild;
                if (wild > 2 || real < 2) continue;
                if (allowed(token)) break;
                hits.push(term.word);
                return;
            }
        }
    });
    return hits;
}

function analyze(text) {
    const base = baseNormalize(text);
    return {
        base,
        thai: buildThaiSkeleton(base),
        latinTokens: buildLatinTokens(base)
    };
}

/** คืนรายการคำต้องห้ามที่เจอ (ว่าง = ผ่าน) */
function findProfanity(text, compiled) {
    const views = analyze(text);
    const hits = findThai(views.thai, compiled).concat(findLatin(views.latinTokens, compiled));
    return Array.from(new Set(hits));
}

// ---------- ลิงก์ / LINE / เบอร์โทร (กันมิจฉาชีพ) ----------

const TLDS = 'com|net|org|co|th|io|me|ly|gg|xyz|app|link|shop|site|online|info|biz|cc|tk|ml|ga|cf|tv|ru|club|live|vip|bet|win|asia|pro|top|cloud|fun|game|games|store|page|dev|ai|bio|lol|cyou|icu|one|pw|ws|su';
const URL_PATTERNS = [
    /(?:https?|ftp)\s*:\s*\/\s*\//i,
    /\bwww\s*\./i,
    /:\/\//,
    new RegExp(`[a-z0-9][a-z0-9-]*\\s*(?:\\.|。|．|｡|,\\s*|\\(\\s*\\.\\s*\\)|\\[\\s*\\.\\s*\\]|\\s(?:dot|ดอท|ด็อท|จุด)\\s|(?:dot|ดอท|ด็อท|จุด))\\s*(?:${TLDS})(?![a-z])`, 'i'),
    /(?:^|[^a-z])(?:bit\s*\.?\s*ly|t\s*\.\s*me|wa\s*\.\s*me|lin\s*\.\s*ee|discord\s*\.\s*gg|tinyurl|shorturl|cutt\s*\.\s*ly)/i
];
const LINE_PATTERNS = [
    /(?:^|[^a-z])(?<![\u0E01-\u0E4E])(?:line|lineid|ไลน์|ไลน|ไล\s*น์|แอดไลน์|ไอดีไลน์)\s*(?:id|ไอดี)?\s*[:：=\-]?\s*@?[a-z0-9._-]{4,}/i,
    /(?:^|[^a-z])(?:id|ไอดี)\s*(?:line|ไลน์)?\s*[:：=]\s*@?[a-z0-9._-]{3,}/i,
    /(?:^|[^a-z0-9._-])@[a-z0-9._-]{3,}/i,
    /(?:telegram|เทเลแกรม|whatsapp|wechat|วีแชท|discord|ดิสคอร์ด|เฟซ|facebook|fb|ig|instagram|ไอจี|tiktok)\s*(?:id|ไอดี)?\s*[:：=]\s*@?[a-z0-9._-]{3,}/i
];

function findPhone(base) {
    // ตัวเลข (รวมเลขไทยที่ถูกแปลงแล้ว) คั่นด้วยเว้นวรรค/จุด/ขีด ได้ไม่เกิน 2 ตัวต่อช่อง
    const re = /(?:\+\s*)?\d(?:[\s.\-\u2013\u2014_()/]{0,2}\d){8,}/g;
    let match;
    while ((match = re.exec(base)) !== null) {
        const digits = match[0].replace(/\D/g, '');
        if (/^(\d)\1+$/.test(digits)) continue; // 5555555555 = หัวเราะ
        let rest = null;
        if (digits.startsWith('66') && digits.length >= 10 && digits.length <= 12) rest = digits.slice(2);
        else if (digits.startsWith('0') && digits.length >= 9) rest = digits.slice(1);
        if (rest === null) continue;
        if (/^(\d)\1+$/.test(rest)) continue;
        return true;
    }
    return false;
}

/** 'link' | 'line' | 'phone' | null */
function findContact(text) {
    const base = baseNormalize(text);
    if (URL_PATTERNS.some(re => re.test(base))) return 'link';
    if (LINE_PATTERNS.some(re => re.test(base))) return 'line';
    if (findPhone(base)) return 'phone';
    return null;
}

// ---------- ตรวจข้อความทั้งก้อน ----------

const MAX_LENGTH = 200;

/** ทำข้อความให้สะอาดก่อนเก็บ: บรรทัดเดียว ตัดอักขระควบคุม/ล่องหน ช่องว่างซ้อน */
function cleanMessageText(input) {
    return String(input == null ? '' : input)
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @returns {{ ok: true, text } | { ok: false, reason, words? }}
 *   reason: empty | too_long | link | line | phone | profanity
 */
function checkMessage(input, compiled) {
    const text = cleanMessageText(input);
    if (!text) return { ok: false, reason: 'empty' };
    if (Array.from(text).length > MAX_LENGTH) return { ok: false, reason: 'too_long' };
    const contact = findContact(text);
    if (contact) return { ok: false, reason: contact };
    const words = findProfanity(text, compiled);
    if (words.length) return { ok: false, reason: 'profanity', words };
    return { ok: true, text };
}

/** ใช้เทียบข้อความซ้ำ (พิมพ์ซ้ำแค่เติมเว้นวรรค/ตัวพิมพ์ใหญ่ก็ยังนับว่าซ้ำ) */
function repeatKey(input) {
    return baseNormalize(cleanMessageText(input)).replace(/[\s.!?~,…]+/g, '');
}

module.exports = {
    BUILTIN_BLOCK,
    BUILTIN_ALLOW,
    MAX_LENGTH,
    analyze,
    baseNormalize,
    buildThaiSkeleton,
    checkMessage,
    cleanMessageText,
    compileFilter,
    findContact,
    findProfanity,
    parseWordSpec,
    repeatKey,
    stripThaiMarks,
    wordKey
};
