const CACHE = "k-loud-shell-v21";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=1.8.0",
  "/app.js?v=1.8.0",
  "/supabase.js?v=2.108.2",
  "/xlsx.full.min.js?v=0.18.5",
  "/manifest.webmanifest?v=1.8.0",
  "/pwa-192.png?v=1.8.0",
  "/pwa-512.png?v=1.8.0",
  "/pwa-maskable-512.png?v=1.8.0",
  "/apple-touch-icon.png?v=1.8.0",
  "/logo-kloud.png?v=1.7.0"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.matchAll({ type: "window" }))
      .then(clients => clients.forEach(client => client.postMessage({ type: "K_LOUD_UPDATE_READY", version: CACHE })))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(match => match || caches.match("/index.html")))
  );
});
