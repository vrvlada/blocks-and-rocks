/*
 * Blocks & Rocks — Service Worker v1
 * Strategija: Cache-First za statiku, Network-First za navigaciju.
 * Firebase SDK i Google Fonts se keširaju pri prvom učitavanju (runtime cache).
 */

const CACHE_VERSION = 'br-v2.9.7';
const STATIC_CACHE = `br-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `br-runtime-${CACHE_VERSION}`;

/* ═══ Svi lokalni resursi koji se precache-uju na install ═══ */
const PRECACHE_URLS = [
  // HTML pages
  '/', '/index.html', '/game.html', '/privacy.html', '/terms.html',
  // CSS
  '/styles.css', '/landing.css',
  // JS core
  '/gameCore.js', '/app.js', '/i18n.js',
  // JS modules
  '/js/utils.js', '/js/audio.js', '/js/effects.js',
  '/js/leaderboard.js', '/js/achievements.js',
  '/js/modules/firebase-init.js', '/js/modules/username-auth.js',
  '/js/modules/scores-sync.js', '/js/modules/stats-history.js',
  '/js/modules/share-ui.js',
  // Assets — icons
  '/assets/icon-192.png', '/assets/icon-512.png',
  '/assets/favicon.png', '/assets/apple-touch-icon.png',
  '/favicon.ico',
  // Assets — game art
  '/assets/gameplay_assets.jpg', '/assets/hero_art.jpg',
  '/assets/stone_full.svg', '/assets/stone_cracked.svg',
  // Assets — audio
  '/assets/combo.wav', '/assets/new_world_record.mp3',
  // Manifest
  '/manifest.json',
];

/* ═══ INSTALL — predkeširaj sve lokalne fajlove ═══ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing — caching', PRECACHE_URLS.length, 'files...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Precache skip:', url, err.message);
          })
        )
      );
    }).then(() => {
      console.log('[SW] Install complete — forcing activation.');
      return self.skipWaiting();
    })
  );
});

/* ═══ ACTIVATE — očisti stare keševe ═══ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

/* ═══ FETCH — strategija rutiranja ═══ */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignoriši non-GET zahteve i chrome-extension
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Firebase Auth/Firestore API pozive NE keširaj (propuštaj na mrežu)
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com')) {
    return; // Samo mreža, bez keša
  }

  // Google Fonts CSS — Stale-While-Revalidate
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Google Fonts font fajlovi — Cache-First (retko se menjaju)
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Firebase SDK (gstatic.com) — Stale-While-Revalidate
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Lokalne statičke resurse — Cache-First
  if (url.pathname.match(/\.(css|js|mjs|png|jpg|jpeg|svg|ico|webp|wav|mp3|ogg|woff2?)$/)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // HTML navigacija — Network-First, Cache-Fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Sve ostalo — Network-First
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

/* ═══ Pomoćne strategije ═══ */

/** Cache-First: vrati iz keša; ako nema — fečuj, keširaj, vrati. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    // Potpuni offline, nema ni u kešu — vrati fallback
    return new Response('Offline — Resource unavailable', { status: 503 });
  }
}

/** Network-First: fečuj; ako fejluje — vrati iz keša. */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback za navigaciju
    if (request.mode === 'navigate') {
      return caches.match('/game.html') || caches.match('/index.html')
        || new Response('You are offline.', { status: 503, statusText: 'Offline' });
    }
    return new Response('Offline', { status: 503 });
  }
}

/** Stale-While-Revalidate: vrati keširani; u pozadini ažuriraj. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}