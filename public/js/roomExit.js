/*
 * ปุ่ม "🚪 ออก" ร่วมทุกเกม — ยืนยัน → leaveRoom → /rooms (ไม่โดนดึงกลับ)
 *
 *   const exit = roomExit.create({
 *     socket, roomId, playerId,
 *     consequences: () => ['บรรทัดสั้น ๆ ว่าออกตอนนี้แล้วเกิดอะไร'],
 *     onLeave: () => { allowNavigation = true; },   // ปิด beforeunload guard ของบอร์ด
 *     theme: { background: '#1b0f2b', color: '#fff', confirmButtonColor: '#b3262e' }
 *   });
 *   $('#xxExitBtn').on('click', exit.confirm);
 *   // ทุก handler ที่พากลับเข้าห้อง/เกม (connect → setRoom, gameStarting, redirectToLobby ...)
 *   // ต้องเช็ค exit.isLeaving() ก่อน แล้วไม่ทำอะไร
 */
(function attachRoomExit(global) {
    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function create(opts) {
        var options = opts || {};
        var leaving = false;

        function target() {
            return '/rooms?playerId=' + encodeURIComponent(options.playerId || '');
        }

        function leave() {
            if (leaving) return;
            leaving = true;
            try { if (typeof options.onLeave === 'function') options.onLeave(); } catch (e) { /* ไปต่อ */ }
            var gone = false;
            var go = function() {
                if (gone) return;
                gone = true;
                global.location.href = target();
            };
            setTimeout(go, 4000); // ไม่มีคำตอบใน 4 วิ ก็ออกเลย
            try {
                options.socket.emit('leaveRoom', { roomId: options.roomId, playerId: options.playerId }, go);
            } catch (e) {
                go();
            }
        }

        function confirm() {
            if (leaving) return;
            var lines = [];
            try { lines = (typeof options.consequences === 'function' ? options.consequences() : []) || []; } catch (e) { lines = []; }
            lines = lines.filter(Boolean);
            if (!lines.length) lines = ['กลับไปหน้ารวมห้อง'];
            if (typeof global.Swal === 'undefined') {
                if (global.confirm('ออกจากห้อง?\n' + lines.join('\n'))) leave();
                return;
            }
            var theme = options.theme || {};
            global.Swal.fire({
                icon: 'question',
                title: 'ออกจากห้อง?',
                html: '<ul class="room-exit-list" style="text-align:left; margin:0; padding-left:1.2em; line-height:1.55;">' +
                    lines.map(function(t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>',
                showCancelButton: true,
                confirmButtonText: 'ออกจากห้อง',
                cancelButtonText: 'อยู่ต่อ',
                confirmButtonColor: theme.confirmButtonColor || '#b3262e',
                reverseButtons: true,
                background: theme.background || '#1e1e1e',
                color: theme.color || '#fff'
            }).then(function(result) {
                if (result && result.isConfirmed) leave();
            });
        }

        return {
            confirm: confirm,
            leave: leave,
            isLeaving: function() { return leaving; }
        };
    }

    global.roomExit = { create: create };
})(window);
