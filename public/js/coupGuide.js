/* วิธีเล่น Coup — modal ตัวเดียวใช้ทั้งหน้ารอห้องและในเกม
 * ต้องมี SweetAlert2 + /static/css/coupGuide.css
 *
 * window.showCoupGuide()        เปิด modal
 * window.buildCoupGuideHtml()   เอา html ไปยัดที่อื่นเองก็ได้
 */
(function attachCoupGuide(global) {
    // ข้อความสั้นที่เขียนเองดีกว่า power/counter จาก engine ที่ยาวเกินสำหรับการ์ดใบเล็ก
    const CARD_COPY = {
        duke:       { icon: '👑', name: 'ดยุค',        power: 'เก็บภาษี เอา 3 เหรียญ',    block: 'ขวางเงินช่วยเหลือของคนอื่น' },
        assassin:   { icon: '🗡️', name: 'นักฆ่า',      power: 'จ่าย 3 บังคับเป้าเปิดการ์ด', block: '' },
        captain:    { icon: '⚓', name: 'กัปตัน',       power: 'ขโมย 2 เหรียญจากคนอื่น',   block: 'ขวางการโดนขโมย' },
        ambassador: { icon: '🕊️', name: 'ทูต',         power: 'จั่ว 2 ใบแล้วเลือกเก็บ',    block: 'ขวางการโดนขโมย' },
        contessa:   { icon: '🛡️', name: 'ท่านหญิง',  power: 'ไม่มีพลังในตาตัวเอง',       block: 'ขวางการลอบสังหาร' }
    };
    const CARD_ORDER = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];

    function escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function row(icon, title, desc, note) {
        return '<div class="cpg-row"><span class="cpg-ico">' + icon + '</span>' +
            '<span><b>' + title + '</b> — ' + desc +
            (note ? '<br><span class="' + note.cls + '">' + note.text + '</span>' : '') +
            '</span></div>';
    }

    // มีรูปก็โชว์รูป ไม่มีก็ตกกลับไปใช้อิโมจิ — เปิดจากที่ไหนก็ไม่พัง
    function cardTile(id, image) {
        const copy = CARD_COPY[id];
        if (!copy) return '';
        const art = image
            ? '<img class="cpg-card-art" src="' + escapeAttr(image) + '" alt="' + escapeAttr(copy.name) + '" loading="lazy">'
            : '<span class="cpg-card-art cpg-card-art-fallback">' + copy.icon + '</span>';

        return '<div class="cpg-card">' + art +
            '<div class="cpg-card-body">' +
            '<b>' + copy.icon + ' ' + copy.name + '</b>' +
            '<span class="cpg-card-power">⚡ ' + copy.power + '</span>' +
            (copy.block ? '<span class="cpg-blk">🛡️ ' + copy.block + '</span>' : '') +
            '</div></div>';
    }

    function buildCardGrid(cards) {
        const imageById = {};
        (Array.isArray(cards) ? cards : []).forEach(card => {
            if (card && card.id && card.image) imageById[card.id] = card.image;
        });
        return '<div class="cpg-cards">' +
            CARD_ORDER.map(id => cardTile(id, imageById[id])).join('') +
            '</div>';
    }

    function buildCoupGuideHtml(cards) {
        return [
            '<div class="cpg">',

            '<div class="cpg-goal"><span class="cpg-goal-icon">👑</span>',
            '<span><b>เป้าหมาย:</b> เป็นคนสุดท้ายที่ยังเหลือการ์ดคว่ำ<br>',
            '<span class="cpg-note">เริ่มด้วยการ์ดคว่ำ 2 ใบ + 2 เหรียญ · ตาของคุณเลือกทำได้ 1 อย่าง</span></span></div>',

            '<div class="cpg-bluff"><span class="cpg-bluff-title">🎭 หัวใจของเกม: โกหกได้</span>',
            'ประกาศใช้พลังของการ์ดที่<span class="hl">ไม่มีในมือ</span>ก็ได้ ไม่มีใครท้า = ผ่านไปเลย<br>',
            'โดนท้าแล้ว<span class="hl">ไม่มีจริง</span> → คุณเสียการ์ด 1 ใบ · ท้าแล้ว<span class="hl">เขามีจริง</span> → คนท้าเสียการ์ดแทน',
            '</div>',

            '<div class="cpg-sec"><span class="cpg-h">ทำได้ทุกตา ไม่ต้องมีการ์ด</span>',
            row('🪙', 'รับรายได้', 'เอา 1 เหรียญ', { cls: 'cpg-note', text: 'ขวางไม่ได้ · ท้าไม่ได้' }),
            row('💶', 'เงินช่วยเหลือ', 'เอา 2 เหรียญ', { cls: 'cpg-blk', text: '⛔ ดยุคขวางได้' }),
            row('💥', 'รัฐประหาร', 'จ่าย 7 บังคับคู่แข่งเปิดการ์ด 1 ใบ', { cls: 'cpg-note', text: 'ขวางไม่ได้ · ท้าไม่ได้' }),
            '</div>',

            '<div class="cpg-sec"><span class="cpg-h">พลังการ์ด 5 ใบ (อ้างได้แม้ไม่มี)</span>',
            buildCardGrid(cards),
            '</div>',

            '<div class="cpg-warn">⚠️ มีเหรียญครบ 10 เมื่อไหร่ ตานั้น<b>ต้องทำรัฐประหารเท่านั้น</b></div>',

            // เปิดแท็บใหม่ ไม่งั้นคนที่กำลังเล่นอยู่จะหลุดออกจากเกม
            '<a class="cpg-more" href="/how-to-play#coup" target="_blank" rel="noopener">',
            'ยังงงอยู่? ดูตัวอย่างเล่นจริงทีละตา →</a>',

            '</div>'
        ].join('');
    }

    function showCoupGuide(options) {
        if (typeof Swal === 'undefined') return null;
        const opts = options || {};
        return Swal.fire({
            title: '👑 วิธีเล่น Coup',
            html: buildCoupGuideHtml(opts.cards),
            width: 520,
            background: '#14091f',
            color: '#fff',
            confirmButtonText: opts.confirmButtonText || 'เข้าใจแล้ว',
            confirmButtonColor: '#7c3aed',
            customClass: { popup: 'coup-guide-popup' }
        });
    }

    global.buildCoupGuideHtml = buildCoupGuideHtml;
    global.showCoupGuide = showCoupGuide;
})(window);
