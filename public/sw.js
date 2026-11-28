const CACHE_NAME = 'ddoodle-pwa-v5';
const STATIC_CACHE = 'ddoodle-static-v5';
const SUPABASE_MEDIA_CACHE = 'supabase-media-cache-v3';
const SUPABASE_MEDIA_MAX_ENTRIES = 100;
const SUPABASE_MEDIA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const PRECACHE_URLS = [
  '/',
  '/civic',
  '/profile',
  '/about',
  '/contact',
  '/manifest.json',
  '/icon.svg',
];

const SUPABASE_STORAGE_REGEX =
  /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/storage\/v1\/object\/public\/.*/i;

const STATIC_ASSET_REGEX =
  /\.(?:js|css|svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|ttf|otf)$/i;

function isPreviewEnvironment() {
  const host = (self.location && self.location.hostname ? self.location.hostname : '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.run.app') ||
    host.endsWith('.usercontent.goog') ||
    host.endsWith('.ai.studio') ||
    host.includes('preview')
  );
}

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

function isStaticAssetRequest(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.json' ||
    STATIC_ASSET_REGEX.test(url.pathname)
  );
}

function isBypassCachePath(url) {
  return (
    url.pathname.startsWith('/auth/callback') ||
    url.pathname.startsWith('/api/auth')
  );
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
  const dateHeader =
    response.headers.get('sw-cached-at') || response.headers.get('date');
  if (!dateHeader) return true;
  const cachedTime = new Date(dateHeader).getTime();
  if (Number.isNaN(cachedTime)) return true;
  return Date.now() - cachedTime < SUPABASE_MEDIA_MAX_AGE_MS;
}

self.addEventListener('install', (event) => {
  if (isPreviewEnvironment()) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((path) =>
            cache.add(new Request(path, { cache: 'reload' }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  if (isPreviewEnvironment()) {
    // Delete all caches in preview to avoid stale code chunks
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.clients.claim())
    );
    return;
  }

  const allowedCaches = new Set([
    CACHE_NAME,
    STATIC_CACHE,
    SUPABASE_MEDIA_CACHE,
  ]);
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

  // Never intercept or cache anything in preview/development hosts
  if (isPreviewEnvironment()) {
    return;
  }

  const url = new URL(request.url);

  // Never intercept or cache OAuth callbacks / auth mutations
  if (url.origin === self.location.origin && isBypassCachePath(url)) {
    return;
  }

  // CacheFirst with 30-day freshness for Supabase public Storage media & avatars
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

  // CacheFirst for immutable static build assets, icons, and fonts
  if (isStaticAssetRequest(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            void cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response('Offline — Static asset unavailable.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      })
    );
    return;
  }

  // NetworkFirst with cached fallback for navigations & same-origin pages (/civic, /profile, etc.)
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic' &&
          !url.pathname.startsWith('/api/')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            void cache.put(request, responseClone);
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
          if (url.pathname.startsWith('/civic')) {
            const civicFallback = await caches.match('/civic');
            if (civicFallback) return civicFallback;
          }
          if (url.pathname.startsWith('/profile')) {
            const profileFallback = await caches.match('/profile');
            if (profileFallback) return profileFallback;
          }
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
