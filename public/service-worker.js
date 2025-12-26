// Service Worker สำหรับ Insider Game PWA
const CACHE_NAME = 'insider-game-v1';

// ไฟล์ที่จะ cache เก็บไว้ (เล่นได้แม้เน็ตช้า)
const STATIC_ASSETS = [
  '/static/css/style.css',
  '/static/css/mobile.css',
  '/static/css/form.css',
  '/static/image/favicon-96x96.png',
  '/static/image/favicon-32x32.png',
  '/static/image/favicon.ico',
  '/static/image/title.jpg',
  '/static/image/insider.jpg',
  '/static/sound/ding.mp3',
  '/static/sound/dong.mp3',
  '/static/sound/message.mp3',
  '/static/sound/popup.mp3'
];

// ติดตั้ง Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static files');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.log('[SW] Cache failed:', err))
  );
});

// เปิดใช้งาน Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ดักจับ request
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // ข้าม socket.io (ต้องใช้ real-time)
  if (url.pathname.startsWith('/socket.io')) {
    return;
  }
  
  // สำหรับไฟล์ static - ใช้ cache ก่อน
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          });
        })
    );
    return;
  }
  
  // สำหรับหน้าเว็บ - ใช้ network ก่อน
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
