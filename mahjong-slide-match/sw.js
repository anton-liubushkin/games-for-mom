// Offline-first service worker: precache the app shell, serve from cache,
// fall back to the network and cache new requests as they appear.

const CACHE = "mahjong-slide-v22";

const ASSETS = [
  ".",
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/ui.js",
  "js/engine.js",
  "js/generator.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Cache-first app shell: serve the precached, version-consistent set so HTML
  // and JS never mix versions across an update. A bumped CACHE swaps the whole
  // set atomically on activate; the network is only a fallback for new requests.
  if (request.mode === "navigate") {
    event.respondWith(
      caches.match("index.html", { ignoreSearch: true }).then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
