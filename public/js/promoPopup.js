/* ป๊อปอัปชวนรีวิว / แชร์ / ติดตามช่อง
 *
 * ขึ้น 1 ครั้งต่อการเข้าเว็บ (sessionStorage) — ปิดแท็บแล้วเข้าใหม่จะขึ้นอีกครั้ง
 * ไม่ขึ้นระหว่างเล่นเกม (/game/...) หรือหน้าแอดมิน เพื่อไม่ขัดจังหวะวงเล่น
 * ใส่ลิงก์ช่องใน PROMO_LINKS ได้เลย ถ้าเว้นว่างไว้ปุ่มนั้นจะถูกซ่อน
 */
(function() {
    var PROMO_LINKS = {
        tiktok: '',   // เช่น 'https://www.tiktok.com/@yourchannel'
        youtube: '',  // เช่น 'https://www.youtube.com/@yourchannel'
        review: ''    // เช่น ลิงก์ Google Form / Facebook Page รีวิว
    };
    var SEEN_KEY = 'insiderPromoSeen';
    var SKIP_PREFIXES = ['/game', '/admin', '/banned', '/support'];

    var path = location.pathname;
    if (SKIP_PREFIXES.some(function(p) { return path === p || path.indexOf(p + '/') === 0; })) return;

    try {
        if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch (e) {
        // storage ใช้ไม่ได้ (private mode) — ไม่โชว์ดีกว่าโชว์ทุกหน้า
        return;
    }

    var soloChannel = !PROMO_LINKS.tiktok !== !PROMO_LINKS.youtube;

    function linkButton(url, cls, icon, label) {
        if (!url) return '';
        if (soloChannel && cls !== 'promo-review') cls += ' is-solo';
        return '<a class="promo-btn ' + cls + '" href="' + url + '" target="_blank" rel="noopener">' +
            '<i class="' + icon + '" aria-hidden="true"></i><span>' + label + '</span></a>';
    }

    function build() {
        try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { return; }
        var overlay = document.createElement('div');
        overlay.className = 'promo-overlay';
        overlay.innerHTML =
            '<div class="promo-card" role="dialog" aria-modal="true" aria-labelledby="promo-title">' +
                '<button type="button" class="promo-close" aria-label="ปิด">&times;</button>' +
                '<div class="promo-emoji" aria-hidden="true">🥺</div>' +
                '<h2 id="promo-title">ขอประชาสัมพันธ์หน่อยครับ 🙏</h2>' +
                '<p>เกมนี้ทำโดยนักพัฒนาตัวเล็ก ๆ คนหนึ่ง<br>ถ้าเล่นแล้วสนุก ช่วย<b>ชวนเพื่อน</b> <b>รีวิว</b><br>หรืออัดคลิปลง TikTok / YouTube ให้หน่อยนะครับ</p>' +
                '<p class="promo-thanks">ทุกการแชร์คือกำลังใจให้ทำเกมต่อ ขอบคุณมากครับ ❤️</p>' +
                '<div class="promo-actions">' +
                    linkButton(PROMO_LINKS.review, 'promo-review', 'fas fa-star', 'เขียนรีวิว') +
                    linkButton(PROMO_LINKS.tiktok, 'promo-tiktok', 'fab fa-tiktok', 'TikTok') +
                    linkButton(PROMO_LINKS.youtube, 'promo-youtube', 'fab fa-youtube', 'YouTube') +
                '</div>' +
                '<button type="button" class="promo-later">ไปเล่นเลย</button>' +
            '</div>';
        document.body.appendChild(overlay);

        var lastFocus = document.activeElement;
        function close() {
            overlay.classList.remove('is-open');
            document.removeEventListener('keydown', onKey);
            setTimeout(function() { overlay.remove(); }, 200);
            if (lastFocus && lastFocus.focus) lastFocus.focus();
        }
        function onKey(e) { if (e.key === 'Escape') close(); }

        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        overlay.querySelector('.promo-close').addEventListener('click', close);
        overlay.querySelector('.promo-later').addEventListener('click', close);
        document.addEventListener('keydown', onKey);

        requestAnimationFrame(function() {
            overlay.classList.add('is-open');
            overlay.querySelector('.promo-later').focus();
        });
    }

    // รอหน้าโหลดนิ่ง และรอให้ SweetAlert อื่น (เช่น ประกาศอัปเดต/ตั้งชื่อ) ปิดก่อน ไม่ให้ซ้อนกัน
    function showWhenClear() {
        if (document.querySelector('.swal2-container')) {
            setTimeout(showWhenClear, 800);
            return;
        }
        build();
    }
    window.addEventListener('load', function() { setTimeout(showWhenClear, 1200); });
})();
