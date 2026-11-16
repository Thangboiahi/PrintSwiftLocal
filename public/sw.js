const CACHE_NAME = 'printswift-local-pwa-v2';
const SUPABASE_MEDIA_CACHE = 'supabase-media-cache-v1';
const SUPABASE_MEDIA_MAX_ENTRIES = 100;
const SUPABASE_MEDIA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const PRECACHE_URLS = [
  '/',
  '/about',
  '/contact',
  '/manifest.json',
  '/icon.svg',
];

const SUPABASE_STORAGE_REGEX =
  /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/storage\/v1\/object\/public\/.*/i;

function isSupabaseMediaRequest(url) {
  if (SUPABASE_STORAGE_REGEX.test(url.href)) {
    return true;
  }
  if (
    url.pathname === '/_next/image' &&
    url.searchParams.has('url') &&
    /supabase\.(co|in)\/storage\/v1\/object\/public/i.test(
      decodeURIComponent(url.searchParams.get('url') || '')
    )
  ) {
    return true;
  }
  return false;
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const overflow = keys.length - maxEntries;
    for (let i = 0; i < overflow; i += 1) {
      await cache.delete(keys[i]);
    }
  }
}

function isCachedResponseFresh(response) {
  if (!response) return false;
  const dateHeader = response.headers.get('sw-cached-at') || response.headers.get('date');
  if (!dateHeader) return true;
  const cachedTime = new Date(dateHeader).getTime();
  if (Number.isNaN(cachedTime)) return true;
  return Date.now() - cachedTime < SUPABASE_MEDIA_MAX_AGE_MS;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const allowedCaches = new Set([CACHE_NAME, SUPABASE_MEDIA_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !allowedCaches.has(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Phase 37: CacheFirst with StaleWhileRevalidate refresh for Supabase Storage media & 360 panoramas
  if (isSupabaseMediaRequest(url)) {
    event.respondWith(
      caches.open(SUPABASE_MEDIA_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(request);
        if (cachedResponse && isCachedResponseFresh(cachedResponse)) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            await cache.put(request, networkResponse.clone());
            void trimCache(SUPABASE_MEDIA_CACHE, SUPABASE_MEDIA_MAX_ENTRIES);
          }
          return networkResponse;
        } catch {
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response('Offline — Media asset unavailable.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        if (request.mode === 'navigate') {
          const fallbackRoot = await caches.match('/');
          if (fallbackRoot) return fallbackRoot;
        }
        return new Response('Offline — Cached data unavailable.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      })
  );
});
