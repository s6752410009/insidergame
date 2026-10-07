/* แผงมือไพ่เก้าเก — รูปฝังในไฟล์นี้เลย ไม่พึ่ง JSON จากเซิร์ฟเวอร์ */
(function attachPokerRankChart(global) {
    var FALLBACK = [
        {
            name: 'ตอง',
            hint: 'สามใบเลขเดียวกัน · ตอง 3 ใหญ่สุด เพราะ 3+3+3 เป็น 9 แล้วค่อยตองเอซ คิง ควีน … ตอง 2 เล็กสุด',
            files: ['3h', '3s', '3d']
        },
        {
            name: 'เรียงสี',
            hint: 'เหมือนเรียง แต่ต้องดอกเดียวกัน เช่น 7♥ 8♥ 9♥ · เท่ากันดูใบใหญ่สุด แล้วดูดอก',
            files: ['7h', '8h', '9h']
        },
        {
            name: 'เซียน',
            hint: 'แจ็ค ควีน คิง ล้วน (ซ้ำกันได้ เช่น Q Q K) ดอกปนได้ · เท่ากันดูใบใหญ่สุด แล้วดูดอก',
            files: ['jh', 'qs', 'kd']
        },
        {
            name: 'เรียง',
            hint: 'เลขต่อกัน ไม่ต้องดอกเดียวกัน · Q-K-A ใหญ่สุด เอซ-2-3 เล็กสุด · K-A-2 ไม่นับ',
            files: ['5s', '6h', '7d']
        },
        {
            name: 'สี',
            hint: 'ดอกเดียวกัน แต่เลขไม่ต่อกัน · ดูดอกก่อน ♠ ใหญ่กว่า ♥ ♦ ♣',
            files: ['kh', '9h', '2h']
        },
        {
            name: 'แต้ม',
            hint: 'ไม่เข้ามือไหน เอซ=1, 2–9 ตามหน้า, 10 แจ็คควีนคิง=0 รวมแล้วเอาหลักหน่วย เก้าใหญ่สุด · เท่ากันดูใบใหญ่สุด แล้วดูดอก',
            files: ['as', '8d', 'kc']
        }
    ];

    function escapeText(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, function(ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[ch];
        });
    }

    function cardSrc(card, file) {
        if (card && card.image) return card.image;
        return '/assets/games/poker/' + file + '.svg';
    }

    function normalizeRows(list) {
        return FALLBACK.map(function(fallback, index) {
            var row = (Array.isArray(list) && list[index]) ? list[index] : {};
            return {
                name: row.name || fallback.name,
                hint: row.hint || fallback.hint,
                example: fallback.files.map(function(file, cardIndex) {
                    var card = row.example && row.example[cardIndex];
                    return {
                        image: cardSrc(card, file),
                        live: !card || card.live !== false
                    };
                })
            };
        });
    }

    // highlightName (ไม่บังคับ): ชื่อมือที่ผู้เล่นถืออยู่ ให้แถวนั้นเด่น + ป้าย "มือคุณ"
    function rankListHtml(list, highlightName) {
        return '<div class="pk-rank-list">' + normalizeRows(list).map(function(row, index) {
            var pics = (row.example || []).map(function(card) {
                return '<img src="' + escapeText(card.image) + '" alt="' + escapeText(row.name) + '">';
            }).join('');
            var mine = !!highlightName && highlightName === row.name;
            return '<div class="pk-rank-item' + (mine ? ' is-you' : '') + '">' +
                '<div class="pk-rank-n">' + (index + 1) + '</div>' +
                '<div class="pk-rank-cards">' + pics + '</div>' +
                '<div class="pk-rank-copy"><b>' + escapeText(row.name) +
                (mine ? '<span class="pk-rank-you-tag">มือคุณ</span>' : '') + '</b><small>' +
                escapeText(row.hint) + '</small></div>' +
                '</div>';
        }).join('') + '</div>';
    }

    function chartHtml(list, highlightName) {
        return rankListHtml(list, typeof highlightName === 'string' ? highlightName : '');
    }

    // ante (ไม่บังคับ): ค่าวางกองจริงของโต๊ะ — ไม่ส่งมาจะใช้ค่าเริ่มต้น 500
    function guideHtml(mode, list, ante) {
        var isFour = mode === 'poker4';
        var anteText = Number(ante) > 0 ? Math.floor(Number(ante)) : 500;
        var lead = isFour
            ? '<p>ได้ 4 ใบ ทิ้ง 2 ลงชิปรอบแรก คนที่ยังไม่หมอบได้ใบที่ 3 (คว่ำเห็นเองคนเดียว หรือหงายถ้าห้องตั้งไว้) แล้วลงชิปอีกรอบ ค่อยเปิดเทียบ</p>'
            : '<p>ได้ 5 ใบ ทิ้ง 2 ลงชิปรอบเดียว แล้วเปิด 3 ใบเทียบเลย</p>';
        return '<div class="pk-howto-copy">' + lead +
            '<p>ตาละวางกอง ' + anteText + ' · มือใหญ่กินกอง</p>' +
            '<p><b>ผ่าน</b> ไม่ลงเพิ่ม (ได้ถ้ายังไม่มีใครสู้) · <b>สู้</b> ลงชิปก่อน · <b>ตาม</b> ลงให้เท่าคนสู้ · ' +
            '<b>เกทับ</b> ลงเพิ่มให้สูงกว่า · <b>หมอบ</b> ทิ้งมือ เสียชิปที่ลงไปแล้ว · <b>หมดหน้าตัก</b> ลงทั้งหมดที่มี</p>' +
            '<p>มือเท่ากัน ดูใบใหญ่สุด แล้วดูดอก ♠ > ♥ > ♦ > ♣ (สีดูดอกก่อน) — ไพ่คนละใบ จึงไม่มีเสมอ · หมดหน้าตักแล้วกินได้เฉพาะกองที่ตัวเองลงถึง</p>' +
            '<p>หมดเวลาเลือกไพ่ ระบบทิ้งใบอ่อนสุดให้ · หมดเวลาลงชิป: ยังไม่มีใครสู้ = ผ่านให้ · มีคนสู้ = หมอบ</p></div>' +
            '<p class="pk-rank-kicker">ใหญ่ → เล็ก</p>' +
            rankListHtml(list) +
            '<p class="pk-howto-foot">เล่นสนุก: ได้ชิป 10,000 ชนะเก็บยอด เงินไม่พอเล่นเติม 10,000<br>เล่นเก็บชิป: ใช้ชิปในบัญชี ชนะได้ไป แพ้หาย</p>';
    }

    global.pokerRankChart = {
        FALLBACK: FALLBACK,
        normalizeRows: normalizeRows,
        chartHtml: chartHtml,
        rankListHtml: rankListHtml,
        guideHtml: guideHtml
    };
})(typeof window !== 'undefined' ? window : globalThis);
