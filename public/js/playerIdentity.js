/**
 * Player Identity System using localStorage
 * สร้างและจัดการ playerId ฝั่ง client
 */
(function() {
    'use strict';
    
    const PLAYER_ID_KEY = 'insiderGamePlayerId';
    const PLAYER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    /**
     * สร้าง UUID v4 สำหรับ playerId
     */
    function generatePlayerId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function getServerPlayerId() {
        const meta = document.querySelector('meta[name="insider-player-id"]');
        const value = meta && meta.getAttribute('content');
        if (!value || !PLAYER_ID_REGEX.test(value)) {
            return null;
        }
        return value;
    }
    
    /**
     * ดึง playerId ของ "เครื่องนี้"
     *
     * localStorage คือเจ้าของตัวจริงเสมอ — meta จาก server ใช้ได้แค่ "เติม" ตอน
     * localStorage ยังว่างเท่านั้น ห้ามเอามาทับของเดิมเด็ดขาด
     * (เวอร์ชันก่อนให้ meta ชนะ ผลคือเปิดลิงก์ที่มี playerId คนอื่นหนึ่งครั้ง
     *  ตอน session ฝั่ง server หมดอายุ = บัญชีเดิมบนเครื่องถูกเขียนทับหายถาวร)
     */
    function getOrCreatePlayerId() {
        const stored = localStorage.getItem(PLAYER_ID_KEY);
        if (stored && PLAYER_ID_REGEX.test(stored)) {
            return stored;
        }

        // localStorage ว่าง/เพี้ยน → รับ identity จาก server session ได้
        // (เคสตั้งใจ เช่น ลิงก์โอน site admin ไปเครื่องใหม่ หรือเบราว์เซอร์เพิ่งล้าง storage)
        const serverPlayerId = getServerPlayerId();
        if (serverPlayerId) {
            localStorage.setItem(PLAYER_ID_KEY, serverPlayerId);
            console.log('[PlayerIdentity] Adopted server identity:', serverPlayerId);
            return serverPlayerId;
        }

        const playerId = generatePlayerId();
        localStorage.setItem(PLAYER_ID_KEY, playerId);
        console.log('[PlayerIdentity] Created new playerId:', playerId);
        return playerId;
    }
    
    /**
     * ดึง playerId จาก URL query string
     */
    function getPlayerIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('playerId');
    }
    
    /**
     * เพิ่ม/อัพเดท playerId ใน URL
     */
    function addPlayerIdToUrl(url, playerId) {
        try {
            const urlObj = new URL(url, window.location.origin);
            urlObj.searchParams.set('playerId', playerId);
            return urlObj.pathname + urlObj.search;
        } catch (e) {
            // ถ้า URL parse ไม่ได้ ให้ใช้แบบง่าย
            if (url.includes('?')) {
                if (url.includes('playerId=')) {
                    return url.replace(/playerId=[^&]*/, 'playerId=' + playerId);
                }
                return url + '&playerId=' + playerId;
            }
            return url + '?playerId=' + playerId;
        }
    }
    
    /**
     * ลบ playerId ออกจาก address bar (เก็บ query อื่นและ hash ไว้)
     * เพื่อให้ URL ที่ผู้เล่นก๊อปไปแชร์ "ไม่พกกุญแจบัญชี" ติดไปด้วย —
     * ลิงก์ห้องที่แชร์กันจะเป็น /room/xxx เฉยๆ เครื่องใหม่ที่เปิดจะได้บัญชีของตัวเอง
     */
    function stripPlayerIdFromAddressBar() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has('playerId')) {
                return;
            }
            url.searchParams.delete('playerId');
            history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        } catch (e) {
            // แก้ address bar ไม่ได้ก็ไม่เป็นไร แค่เสียความสวยงาม
        }
    }

    /**
     * ทำให้ server กับเครื่องนี้เห็น identity ตรงกัน
     * - server รู้จักเราถูกคนแล้ว (meta ตรง localStorage) → ลบ playerId ออกจาก URL แล้วใช้งานต่อ
     * - server ยังไม่รู้จัก/รู้จักเป็นคนอื่น → บังคับ URL ให้ตรงกับ localStorage แล้ว reload
     *   (ฝั่ง server ให้ query ชนะ session จึง rebind กลับมาเป็นเราเสมอ — จบใน 1 redirect)
     */
    function ensurePlayerIdInUrl() {
        const playerId = getOrCreatePlayerId();
        const urlPlayerId = getPlayerIdFromUrl();
        const serverPlayerId = getServerPlayerId();

        if (serverPlayerId === playerId) {
            stripPlayerIdFromAddressBar();
            return true;
        }

        if (urlPlayerId !== playerId) {
            const fixedUrl = addPlayerIdToUrl(window.location.pathname + window.location.search, playerId);
            console.log('[PlayerIdentity] Syncing identity with server ->', fixedUrl);
            window.location.replace(fixedUrl);
            return false; // กำลัง reload
        }

        // URL ตรงกับเราแล้วแต่หน้านี้ไม่ได้ render meta (เช่นหน้า static) → ใช้งานได้เลย
        return true;
    }
    
    /**
     * อัพเดททุก link ในหน้าให้มี playerId
     */
    function updateAllLinks() {
        const playerId = getOrCreatePlayerId();
        
        // อัพเดท <a> tags
        document.querySelectorAll('a[href]').forEach(function(link) {
            const href = link.getAttribute('href');
            // ข้าม external links, anchors, javascript:
            if (!href || href.startsWith('#') || href.startsWith('javascript:') || 
                href.startsWith('http://') || href.startsWith('https://') ||
                href.startsWith('/static') || href.startsWith('/socket.io')) {
                return;
            }
            link.setAttribute('href', addPlayerIdToUrl(href, playerId));
        });
        
        // อัพเดท <form> actions
        document.querySelectorAll('form[action]').forEach(function(form) {
            const action = form.getAttribute('action');
            if (action && !action.startsWith('#') && !action.startsWith('javascript:')) {
                form.setAttribute('action', addPlayerIdToUrl(action, playerId));
            }
        });
    }
    
    // Export to global scope
    window.PlayerIdentity = {
        getPlayerId: getOrCreatePlayerId,
        getPlayerIdFromUrl: getPlayerIdFromUrl,
        addPlayerIdToUrl: addPlayerIdToUrl,
        ensurePlayerIdInUrl: ensurePlayerIdInUrl,
        updateAllLinks: updateAllLinks
    };
    
    // Auto-run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            if (ensurePlayerIdInUrl()) {
                updateAllLinks();
            }
        });
    } else {
        // DOM already loaded
        if (ensurePlayerIdInUrl()) {
            updateAllLinks();
        }
    }
})();
