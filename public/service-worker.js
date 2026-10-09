const CACHE_NAME = 'sahara-ai-shell-v2';
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/sahara-icon.svg',
  '/sahara-icon-192.svg',
  '/sahara-icon-512.svg',
];

function isAppStaticAsset(url) {
  if (url.search) return false;
  return url.pathname.startsWith('/assets/')
    || [
      '/manifest.webmanifest',
      '/sahara-icon.svg',
      '/sahara-icon-192.svg',
      '/sahara-icon-512.svg',
    ].includes(url.pathname);
}

async function cacheStaticResponse(request, response) {
  const cacheControl = response.headers.get('cache-control') || '';
  if (!response.ok || response.type !== 'basic' || /private|no-store/i.test(cacheControl)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('sahara-ai-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/'))),
    );
    return;
  }

  if (!isAppStaticAsset(requestUrl)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    try {
      const response = await fetch(request);
      event.waitUntil(cacheStaticResponse(request, response));
      return response;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  })());
});