const CACHE_NAME = 'grace-field-v1';
const STATIC_ASSETS = ['/field_technician_app.html', '/field_dvir_app.html', '/field-app-manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) return networkResponse;
      } catch (error) {
        // fallback below
      }
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const requestPath = new URL(event.request.url).pathname;
        const fallbackPath = requestPath.includes('field_dvir_app.html')
          ? '/field_dvir_app.html'
          : '/field_technician_app.html';
        return caches.match(fallbackPath);
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    })()
  );
});
