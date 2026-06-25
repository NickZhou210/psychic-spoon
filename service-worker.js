const CACHE = "k-loud-shell-v17";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=1.6.0",
  "/app.js?v=1.6.0",
  "/supabase.js?v=2.108.2",
  "/manifest.webmanifest?v=1.6.0",
  "/icon.svg?v=1.6.0"
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
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then(match => match || caches.match("/index.html")))
  );
});
