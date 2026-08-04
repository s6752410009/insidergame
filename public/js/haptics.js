/* Haptic feedback กลาง — ใช้แทน navigator.vibrate ตรงๆ
 *
 * เบราว์เซอร์บล็อก vibrate ก่อนผู้ใช้แตะหน้าจอครั้งแรก (และพ่น warning รก console)
 * ตัวนี้จำว่ามี gesture แล้วหรือยัง: ยังไม่มี = เงียบเฉยๆ ไม่ error ไม่ warning
 *
 *   gameHaptic(15)              — สั่นสั้น
 *   gameHaptic([20, 60, 30])    — จังหวะเปิดบท
 */
(function attachGameHaptic(global) {
    let userHasInteracted = false;

    function markInteracted() {
        userHasInteracted = true;
        global.removeEventListener('pointerdown', markInteracted);
        global.removeEventListener('keydown', markInteracted);
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('pointerdown', markInteracted, { passive: true });
        global.addEventListener('keydown', markInteracted, { passive: true });
    }

    global.gameHaptic = function gameHaptic(pattern) {
        if (!userHasInteracted) return;
        if (!navigator.vibrate) return;
        try {
            navigator.vibrate(pattern);
        } catch (error) {
            // บางเบราว์เซอร์ throw แทน no-op — เงียบไว้
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
