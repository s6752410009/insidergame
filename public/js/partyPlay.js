/* ตัวช่วยร่วมทุกโหมด: ถึงตาคุณ / การ์ดผล / overlay ครั้งแรก / ข้อตกลง 1 บรรทัด */
(function attachPartyPlay(global) {
    var TERMS = 'เล่นกับเพื่อนที่รู้จัก · อย่าแชร์ข้อมูลส่วนตัวในแชท · แอดมินไม่รับผิดชอบข้อความผู้เล่น';
    var FIRST_PLAY = {
        insider: {
            title: 'Insider',
            lines: ['ถามผู้ดำเนินเกม ใช่/ไม่ใช่ ทายคำลับใน 5 นาที', 'ทายถูก → คุยหาจอมบงการ (คนแอบรู้คำ)', 'โหวต: คนทายถูกใช่ไหม → ไม่ใช่ก็ชี้ตัว']
        },
        werewolf: {
            title: 'Werewolf',
            lines: ['คืน: คนมีสกิลกดเป้า', 'เช้า: คุยหาคนผิด', 'โหวตไล่ — ชาวบ้าน หมาป่า หรือบทเดี่ยวชนะ']
        },
        coup: {
            title: 'Coup',
            lines: ['ตาใครเลือกแอ็กชัน 1 อย่าง · ครบ 10 เหรียญต้องรัฐประหาร', 'โกหกได้ ท้าได้ ขวางได้ · โดนจับโกหกได้เหรียญที่จ่ายคืน', 'เสียการ์ดครบ 2 ใบ = ตกรอบ']
        },
        avalon: {
            title: 'อวาลอน',
            lines: ['ดูบทลับของคุณ แล้วกดพร้อม', 'หัวหน้าเลือกทีม → ทุกคนโหวต → ทีมลงการ์ดลับ', 'ดีสำเร็จ 3 ชนะ · ร้ายทำล้ม 3 ชนะ · มือสังหารแทงเมอร์ลินพลิกได้']
        },
        spyfall: {
            title: 'Spyfall',
            lines: ['ทุกคนรู้สถานที่ ยกเว้นสายลับ · เจ้ามือถามก่อน', 'ถาม–ตอบให้เนียน · 🛑 กล่าวหาได้คนละครั้ง ต้องเห็นด้วยทุกคน', 'สายลับหยุดเวลาทายสถานที่ได้ · เล่นหลายรอบสะสมแต้ม']
        },
        undercover: {
            title: 'คำใครไม่เหมือน',
            lines: ['แตะการ์ดดูคำ — สายแฝงได้คำคล้าย ๆ', 'ใบ้คนละ 1 คำตามคิว ห้ามพูดคำตรง ๆ', 'โหวตคนที่คำไม่เหมือนออก']
        },
        blackmarket: {
            title: 'Black Market',
            lines: ['ตลาด: ซื้อของหรือผ่าน', 'ลงมือพร้อมกันทั้งโต๊ะ', 'อิทธิพลสูงสุดตอนจบ = คุมเมือง']
        },
        liar: {
            title: 'ไพ่โกหก',
            lines: ['รอดคนสุดท้ายชนะ ไม่ใช่หมดมือ', 'ลงไพ่คว่ำ อ้างว่าเป็นไพ่บนโต๊ะ', 'กดโกหก! หงายไพ่ — คนแพ้ลั่นไก 🔫 หรือเสียหัวใจ']
        },
        poker5: {
            title: 'ไพ่ 5 ใบ',
            lines: ['ได้ 5 ใบ ทิ้ง 2 ใบ', 'ลงชิปรอบเดียว แล้วเปิด 3 ใบเทียบ', 'ตองใหญ่สุด ตอง 3 ใหญ่กว่าตองเอซ']
        },
        poker4: {
            title: 'สี่ใบเก',
            lines: ['ได้ 4 ใบ ทิ้ง 2 ใบ', 'ลงชิปรอบแรก ได้ใบที่ 3 แล้วลงชิปอีกรอบ', 'หมอบแล้วไม่ได้ใบที่ 3']
        },
        pokdeng: {
            title: 'ป๊อกเด้ง',
            lines: ['ลงเดิมพัน แล้วได้ไพ่ 2 ใบ · แต้ม = หลักหน่วยของผลรวม', 'ได้ 8/9 = ป๊อก เปิดเลย · ไม่งั้นจั่วเพิ่มได้ 1 ใบ · เจ้ามือ 4 แต้มขึ้นไปจับขา 3 ใบ/2 ใบก่อนได้', 'ชนะเจ้ามือได้ตามเด้ง (ดอกเดียวกัน/คู่ = 2 เด้ง) · ชิปในโต๊ะ ไม่มีมูลค่าจริง']
        },
        wavelength: {
            title: 'คลื่นความคิด',
            lines: ['ผู้ใบ้เห็นเป้าลับบนหน้าปัด แล้วใบ้ 1 คำ', 'ทีมช่วยกันหมุนเข็มเดียว กด ✅ ตกลงครบ = ล็อก · ทีมโน้นทาย ⬅️/➡️ ถูก +1', 'เป๊ะ 4 · ใกล้มาก 3 · เฉียด 2 · ถึง 10 ก่อนชนะ (โหมดเดี่ยว: ต่างคนต่างทาย)']
        },
        drawguess: {
            title: 'วาดแล้วทาย',
            lines: ['ผลัดกันวาด — ตาคุณเลือก 1 ใน 3 คำ แล้ววาดให้เพื่อนทาย', 'ที่เหลือพิมพ์ทายในช่องล่าง ทายถูกเร็วได้แต้มเยอะ', 'ครบทุกรอบ แต้มรวมสูงสุดชนะ']
        },
        colorcards: {
            title: 'ไพ่ทิ้งสี',
            lines: ['ลงไพ่สีเดียวกัน หรือเลข/สัญลักษณ์เดียวกับใบบนกอง', 'เลขเดียวกันคนละสี ลงพร้อมกันหลายใบได้', 'ไม่มีใบลง = จั่ว 1 ใบ · ข้าม กลับทิศ +2 +4 เปลี่ยนสี', 'เหลือ 2 ใบต้องกด "เหลือใบเดียว!" ไม่งั้นโดนจับ จั่ว 2']
        }
    };
    FIRST_PLAY.codenames = {
        title: 'สายลับคำใบ้',
        lines: ['หัวหน้าเห็นสีการ์ด ใบ้คำเดียว + ตัวเลข (หัวหน้าห้ามแชท)', 'ลูกทีมแตะเสนอ เสียงข้างมากเปิด หรือกด "เปิดเลย"', 'เจอสายลับทีมตัวเองครบก่อนชนะ · เจอมือสังหาร = แพ้ทันที']
    };

    FIRST_PLAY.setthi = {
        title: 'เศรษฐี',
        lines: ['กดค้างทอย ปล่อยตอนแรง = เดินไกล · ตกที่ว่าง = ซื้อ + สร้างได้ในแผ่นเดียว', 'ตกที่คนอื่นจ่ายค่าผ่านทาง แล้วซื้อต่อได้ 2 เท่า (แลนด์มาร์กซื้อต่อไม่ได้)', 'ผูกขาด 3 สี / ทั้งแถว / ท่องเที่ยว 4 = ชนะทันที · เงินในเกม ไม่มีมูลค่าจริง']
    };

    var lastPingKey = '';
    var pingHideTimer = null;
    var firstPlayTimer = null;
    var ready = false;

    function injectCss() {
        if (document.getElementById('partyPlayStyle')) return;
        var style = document.createElement('style');
        style.id = 'partyPlayStyle';
        style.textContent = [
            '#ppTurnPing{position:fixed;inset:0;z-index:12050;display:none;align-items:center;justify-content:center;pointer-events:none;background:rgba(8,6,18,0.55);}',
            '#ppTurnPing.is-on{display:flex;animation:ppPingIn .18s ease-out;}',
            '#ppTurnPing .pp-card{min-width:min(86vw,340px);padding:22px 24px;border-radius:20px;text-align:center;color:#fff;background:linear-gradient(160deg,#2a1848,#12101c);border:1px solid rgba(245,200,107,0.45);box-shadow:0 18px 50px rgba(0,0,0,0.45);}',
            '#ppTurnPing .pp-kicker{letter-spacing:.16em;text-transform:uppercase;font-size:.72rem;color:#f5c86b;font-weight:700;margin-bottom:6px;}',
            '#ppTurnPing .pp-title{font-size:1.55rem;font-weight:800;margin:0 0 4px;}',
            '#ppTurnPing .pp-sub{margin:0;color:#cfc6dd;font-size:.95rem;}',
            '@keyframes ppPingIn{from{opacity:0}to{opacity:1}}',
            // แบบเล็ก: ป้ายบนสุดจอ ไม่หรี่จอ ไม่บังปุ่มกลางจอ (เกมที่ปุ่มตัดสินใจอยู่กลางจอ เช่น Coup/อวาลอน)
            '#ppTurnPing.is-compact{align-items:flex-start;background:none;padding-top:calc(8px + env(safe-area-inset-top));}',
            '#ppTurnPing.is-compact .pp-card{min-width:0;width:min(92vw,420px);padding:10px 16px;border-radius:14px;display:flex;align-items:baseline;gap:10px;justify-content:center;flex-wrap:wrap;box-shadow:0 10px 28px rgba(0,0,0,0.5);}',
            '#ppTurnPing.is-compact .pp-kicker{margin:0;}',
            '#ppTurnPing.is-compact .pp-title{font-size:1.15rem;margin:0;}',
            '#ppTurnPing.is-compact .pp-sub{font-size:.85rem;}',
            '#ppFirstPlay{position:fixed;inset:0;z-index:12100;display:flex;align-items:center;justify-content:center;background:rgba(6,8,14,0.82);padding:18px;}',
            '#ppFirstPlay .pp-card{width:min(92vw,420px);padding:22px 22px 16px;border-radius:22px;background:#141826;color:#fff;border:1px solid rgba(255,255,255,0.12);text-align:left;}',
            '#ppFirstPlay h3{margin:0 0 12px;font-size:1.2rem;text-align:center;}',
            '#ppFirstPlay ol{margin:0 0 14px;padding-left:1.2em;color:#d7dce8;line-height:1.55;}',
            '#ppFirstPlay .pp-terms{margin:0 0 12px;font-size:.78rem;color:#9aa3b8;line-height:1.4;}',
            '#ppFirstPlay .pp-row{display:flex;gap:8px;align-items:center;}',
            '#ppFirstPlay button{flex:1;min-height:48px;border:0;border-radius:12px;padding:10px 12px;font-weight:700;cursor:pointer;background:#f5c86b;color:#1a1204;}',
            '#ppFirstPlay .pp-skip{background:transparent;color:#ddd;border:1px solid rgba(255,255,255,0.2);}',
            '#ppTermsBar{position:fixed;left:12px;right:12px;top:calc(12px + env(safe-area-inset-top));z-index:11900;padding:8px 12px;border-radius:12px;background:rgba(12,14,22,0.88);color:#c8cde0;font-size:.78rem;text-align:center;pointer-events:none;border:1px solid rgba(255,255,255,0.08);}',
            '#ppCountdown{position:fixed;inset:0;z-index:12080;display:none;align-items:center;justify-content:center;background:rgba(6,8,14,0.72);}',
            '#ppCountdown.is-on{display:flex;}',
            '#ppCountdown .pp-count{font-size:4rem;font-weight:800;color:#f5c86b;}',
            '@media (prefers-reduced-motion: reduce){#ppTurnPing.is-on,#ppFirstPlay{animation:none;}}'
        ].join('');
        document.head.appendChild(style);
    }

    function ensurePingNode() {
        var node = document.getElementById('ppTurnPing');
        if (node) return node;
        node = document.createElement('div');
        node.id = 'ppTurnPing';
        node.setAttribute('aria-live', 'assertive');
        node.innerHTML = '<div class="pp-card"><div class="pp-kicker">ตาคุณ</div><p class="pp-title"></p><p class="pp-sub"></p></div>';
        document.body.appendChild(node);
        return node;
    }

    function beep() {
        try {
            var Ctx = global.AudioContext || global.webkitAudioContext;
            if (!Ctx) return;
            if (!beep.ctx) beep.ctx = new Ctx();
            var ctx = beep.ctx;
            if (ctx.state === 'suspended') ctx.resume();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.24);
        } catch (error) {}
    }

    var pingCompact = false;
    function setCompactPing(on) { pingCompact = !!on; }

    function pingTurn(opts) {
        opts = opts || {};
        var key = String(opts.key || opts.title || 'turn');
        if (key === lastPingKey) return;
        lastPingKey = key;
        injectCss();
        var node = ensurePingNode();
        node.querySelector('.pp-title').textContent = opts.title || 'ถึงตาคุณแล้ว';
        node.querySelector('.pp-sub').textContent = opts.subtitle || 'เลือกแอ็กชันได้เลย';
        node.classList.toggle('is-compact', opts.compact !== undefined ? !!opts.compact : pingCompact);
        node.classList.add('is-on');
        beep();
        if (typeof global.gameHaptic === 'function') global.gameHaptic([18, 40, 28]);
        clearTimeout(pingHideTimer);
        pingHideTimer = setTimeout(function() {
            node.classList.remove('is-on');
        }, Number(opts.ms) || 1400);
    }

    function resetPing() {
        lastPingKey = '';
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function shareResult(payload) {
        payload = payload || {};
        var width = 1080;
        var height = 1350;
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        var accent = payload.accent || '#f5c86b';
        ctx.fillStyle = '#120d1c';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(180, 160, 280, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f4ecff';
        ctx.font = '700 42px sans-serif';
        ctx.fillText(payload.mode || 'Insider Game', 80, 120);
        ctx.fillStyle = accent;
        ctx.font = '800 72px sans-serif';
        wrapText(ctx, payload.headline || 'จบรอบ', 80, 240, 920, 84);
        ctx.fillStyle = '#d7cce8';
        ctx.font = '600 40px sans-serif';
        wrapText(ctx, payload.sub || '', 80, 430, 920, 52);
        ctx.font = '500 36px sans-serif';
        ctx.fillStyle = '#b9b1c9';
        var y = 560;
        (payload.lines || []).slice(0, 8).forEach(function(line) {
            wrapText(ctx, '• ' + line, 80, y, 920, 46);
            y += 58;
        });
        ctx.fillStyle = '#7d748c';
        ctx.font = '500 28px sans-serif';
        ctx.fillText(payload.footer || 'insider-th.me', 80, 1280);

        canvas.toBlob(function(blob) {
            if (!blob) return;
            var file = new File([blob], (payload.fileName || 'game-result') + '.png', { type: 'image/png' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: payload.headline || 'ผลรอบนี้' }).catch(function() {
                    downloadBlob(blob, file.name);
                });
                return;
            }
            downloadBlob(blob, file.name);
        }, 'image/png');
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
        var words = String(text || '').split(' ');
        var line = '';
        words.forEach(function(word) {
            var test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                ctx.fillText(line, x, y);
                line = word;
                y += lineHeight;
            } else {
                line = test;
            }
        });
        if (line) ctx.fillText(line, x, y);
    }

    function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function() { URL.revokeObjectURL(url); }, 1500);
    }

    function showTermsBar() {
        injectCss();
        var bar = document.getElementById('ppTermsBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'ppTermsBar';
            document.body.appendChild(bar);
        }
        bar.textContent = TERMS;
        setTimeout(function() {
            if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        }, 8000);
    }

    function showFirstPlay(mode) {
        var copy = FIRST_PLAY[mode];
        if (!copy) return;
        var key = 'ig-firstplay-' + mode;
        try {
            if (localStorage.getItem(key) === '1') {
                showTermsBar();
                return;
            }
        } catch (error) {
            showTermsBar();
            return;
        }
        injectCss();
        var overlay = document.createElement('div');
        overlay.id = 'ppFirstPlay';
        overlay.innerHTML = '<div class="pp-card"><h3>วิธีเล่น ' + copy.title + ' แบบสั้น</h3><ol>' +
            copy.lines.map(function(line) { return '<li>' + line + '</li>'; }).join('') +
            '</ol><p class="pp-terms">' + TERMS + '</p><div class="pp-row"><button type="button" class="pp-go">เริ่มเลย</button><button type="button" class="pp-skip">ข้าม</button></div></div>';
        document.body.appendChild(overlay);

        function close() {
            try { localStorage.setItem(key, '1'); } catch (error) {}
            clearTimeout(firstPlayTimer);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            showTermsBar();
        }
        overlay.querySelector('.pp-go').addEventListener('click', close);
        overlay.querySelector('.pp-skip').addEventListener('click', close);
        firstPlayTimer = setTimeout(close, 10000);
    }

    function showCountdown(seconds) {
        injectCss();
        var node = document.getElementById('ppCountdown');
        if (!node) {
            node = document.createElement('div');
            node.id = 'ppCountdown';
            node.innerHTML = '<div class="pp-count">3</div>';
            document.body.appendChild(node);
        }
        var left = Number(seconds) || 3;
        node.classList.add('is-on');
        node.querySelector('.pp-count').textContent = String(left);
        var tick = setInterval(function() {
            left -= 1;
            node.querySelector('.pp-count').textContent = String(Math.max(0, left));
            if (left <= 0) {
                clearInterval(tick);
                node.classList.remove('is-on');
            }
        }, 1000);
    }

    function attach(socket) {
        if (!socket || socket.__partyPlayBound) return;
        socket.__partyPlayBound = true;
        socket.on('gameStartingCountdown', function(data) {
            showCountdown(data && data.countdown);
        });
    }

    function startSession(mode, socket) {
        injectCss();
        ready = true;
        if (socket) attach(socket);
        showFirstPlay(mode);
    }

    global.partyPlay = {
        pingTurn: pingTurn,
        setCompactPing: setCompactPing,
        resetPing: resetPing,
        shareResult: shareResult,
        startSession: startSession,
        attach: attach,
        TERMS: TERMS
    };
})(typeof window !== 'undefined' ? window : globalThis);
