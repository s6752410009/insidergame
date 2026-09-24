/* ปุ่ม "เข้าสู่ระบบด้วย Google" (ไม่บังคับ)
 *
 * ใส่ <div data-google-signin></div> ตรงไหนก็ได้ สคริปต์นี้จะวาดปุ่มของ Google ลงไปให้
 * ทำงานเฉพาะเมื่อหน้ามี <meta name="google-client-id"> (ตั้ง GOOGLE_CLIENT_ID ฝั่ง server แล้ว)
 */
(function() {
    var meta = document.querySelector('meta[name="google-client-id"]');
    var clientId = meta && meta.getAttribute('content');
    if (!clientId) return;

    var WELCOME_KEY = 'insiderGoogleWelcome';

    function store(key, value) {
        try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch (e) {}
    }

    function cleanUrl() {
        var url = new URL(location.href);
        url.searchParams.delete('playerId');
        return url.pathname + url.search + url.hash;
    }

    function notify(icon, title, text) {
        if (window.Swal) {
            Swal.fire({ icon: icon, title: title, text: text, background: '#1e1e2e', color: '#fff' });
        } else {
            alert(title + (text ? '\n' + text : ''));
        }
    }

    function onCredential(response) {
        fetch('/api/auth/google', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        }).then(function(r) { return r.json(); }).then(function(res) {
            if (!res.success) {
                notify('error', 'ล็อกอินไม่สำเร็จ', res.error || 'ลองใหม่อีกครั้ง');
                return;
            }
            store('insiderGamePlayerId', res.playerId);
            store('insiderGameRecoveryCode', res.recoveryCode);
            try { sessionStorage.setItem(WELCOME_KEY, res.action + '|' + (res.email || '')); } catch (e) {}
            location.replace(cleanUrl());
        }).catch(function() {
            notify('error', 'เชื่อมต่อไม่ได้', 'ลองใหม่อีกครั้ง');
        });
    }

    function renderButtons() {
        var slots = document.querySelectorAll('[data-google-signin]');
        if (!slots.length) return;
        google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup' });
        slots.forEach(function(slot) {
            google.accounts.id.renderButton(slot, {
                theme: 'filled_black',
                size: 'large',
                shape: 'pill',
                text: slot.getAttribute('data-google-text') || 'signin_with',
                locale: 'th',
                width: Math.min(300, slot.clientWidth || 300)
            });
        });
    }

    // ข้อความต้อนรับหลัง reload
    function showWelcome() {
        var raw = null;
        try { raw = sessionStorage.getItem(WELCOME_KEY); sessionStorage.removeItem(WELCOME_KEY); } catch (e) {}
        if (!raw) return;
        var parts = raw.split('|');
        var email = parts[1] ? ' (' + parts[1] + ')' : '';
        if (parts[0] === 'login') {
            notify('success', 'ยินดีต้อนรับกลับ!', 'เข้าบัญชีเดิมด้วย Google' + email + ' แล้ว ถ้วยและสถิติอยู่ครบ');
        } else {
            notify('success', 'ผูกบัญชีกับ Google แล้ว', 'ครั้งหน้าเปลี่ยนเครื่องหรือล้างเบราว์เซอร์ กดล็อกอินด้วย Google' + email + ' ก็ได้บัญชีนี้คืน');
        }
    }

    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = renderButtons;
    document.head.appendChild(script);

    if (document.readyState === 'complete') {
        setTimeout(showWelcome, 300);
    } else {
        window.addEventListener('load', function() { setTimeout(showWelcome, 300); });
    }
})();
