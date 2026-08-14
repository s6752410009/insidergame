/* แผงมือไพ่เก้าเก — รูปฝังในไฟล์นี้เลย ไม่พึ่ง JSON จากเซิร์ฟเวอร์ */
(function attachPokerRankChart(global) {
    var FALLBACK = [
        {
            name: 'ตอง',
            hint: 'สามใบเลขเดียวกัน · ตอง 3 ใหญ่สุด เพราะ 3+3+3 เป็น 9 แล้วค่อยเอซ คิง ควีน',
            files: ['3h', '3s', '3d']
        },
        {
            name: 'เรียงสี',
            hint: 'เหมือนเรียง แต่ต้องดอกเดียวกัน เช่น 7♥ 8♥ 9♥',
            files: ['7h', '8h', '9h']
        },
        {
            name: 'เซียน',
            hint: 'แจ็ค ควีน คิง ทั้งสามใบ ดอกปนได้',
            files: ['jh', 'qs', 'kd']
        },
        {
            name: 'เรียง',
            hint: 'เลขต่อกัน เช่น 3 > 4 > 5 ไม่ต้องดอกเดียวกัน · เอซ-2-3 ไม่นับเรียง',
            files: ['5s', '6h', '7d']
        },
        {
            name: 'สี',
            hint: 'ดอกเดียวกัน แต่เลขไม่ต่อกัน · ดูดอกก่อน ♠ ใหญ่กว่า ♥ ♦ ♣',
            files: ['kh', '9h', '2h']
        },
        {
            name: 'แต้ม',
            hint: 'ไม่เข้ามือไหน เอซ=1, 2–9 ตามหน้า, 10 แจ็คควีนคิง=0 รวมแล้วเอาหลักหน่วย เก้าใหญ่สุด',
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

    function rankListHtml(list) {
        return '<div class="pk-rank-list">' + normalizeRows(list).map(function(row, index) {
            var pics = (row.example || []).map(function(card) {
                return '<img src="' + escapeText(card.image) + '" alt="' + escapeText(row.name) + '">';
            }).join('');
            return '<div class="pk-rank-item">' +
                '<div class="pk-rank-n">' + (index + 1) + '</div>' +
                '<div class="pk-rank-cards">' + pics + '</div>' +
                '<div class="pk-rank-copy"><b>' + escapeText(row.name) + '</b><small>' +
                escapeText(row.hint) + '</small></div>' +
                '</div>';
        }).join('') + '</div>';
    }

    function chartHtml(list) {
        return rankListHtml(list);
    }

    function guideHtml(mode, list) {
        var isFour = mode === 'poker4';
        var lead = isFour
            ? '<p>ได้ 4 ใบ ทิ้ง 2 ลงชิปรอบนึง คนที่ยังไม่หมอบได้ใบที่ 3 หงายให้ดู แล้วเปิดเทียบเลย</p>'
            : '<p>ได้ 5 ใบ ทิ้ง 2 ลงชิปรอบนึง แล้วเปิด 3 ใบเทียบเลย</p>';
        return '<div class="pk-howto-copy">' + lead +
            '<p>ตาละวางกอง 500 · สู้ ตาม เกทับ หมอบได้ · มือใหญ่กินกอง</p></div>' +
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
