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
     * ดึง playerId จาก localStorage หรือสร้างใหม่
     * ถ้า server มี session identity แล้ว ให้ sync localStorage ตาม server
     * เพื่อกัน create ด้วยคนละ id แล้วเจอ room_not_found
     */
    function getOrCreatePlayerId() {
        const serverPlayerId = getServerPlayerId();
        if (serverPlayerId) {
            localStorage.setItem(PLAYER_ID_KEY, serverPlayerId);
            return serverPlayerId;
        }

        let playerId = localStorage.getItem(PLAYER_ID_KEY);
        
        // ตรวจสอบว่ามีค่าที่ถูกต้องหรือไม่
        if (!playerId || playerId === 'undefined' || playerId === 'null' || !PLAYER_ID_REGEX.test(playerId)) {
            playerId = generatePlayerId();
            localStorage.setItem(PLAYER_ID_KEY, playerId);
            console.log('[PlayerIdentity] Created new playerId:', playerId);
        } else {
            console.log('[PlayerIdentity] Using existing playerId:', playerId);
        }
        
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
     * ตรวจสอบและ redirect ถ้าไม่มี playerId ใน URL
     */
    function ensurePlayerIdInUrl() {
        const playerId = getOrCreatePlayerId();
        const urlPlayerId = getPlayerIdFromUrl();
        
        // ถ้าไม่มี playerId ใน URL ให้ใส่ของเราลงไป
        if (!urlPlayerId || urlPlayerId === 'undefined' || urlPlayerId === 'null') {
            const newUrl = addPlayerIdToUrl(window.location.pathname + window.location.search, playerId);
            console.log('[PlayerIdentity] Redirecting to (no playerId in URL):', newUrl);
            window.location.replace(newUrl);
            return false; // ยังไม่พร้อม
        }

        // ถ้า URL มี playerId แต่ไม่ตรงกับ localStorage
        // ให้ถือว่า localStorage คือเจ้าของเครื่องจริง และบังคับ URL ให้ตรงกับมัน
        // เพื่อป้องกันการแชร์ playerId ข้ามคน
        if (urlPlayerId !== playerId) {
            const fixedUrl = addPlayerIdToUrl(window.location.pathname + window.location.search, playerId);
            console.log('[PlayerIdentity] Fixing mismatched playerId in URL ->', fixedUrl);
            window.location.replace(fixedUrl);
            return false;
        }
        
        return true; // พร้อมใช้งาน
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
