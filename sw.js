const CACHE_NAME = "socarratt-rider-v4";
const ASSETS = [
  "/repartidor.html",
  "/mqtt.min.js",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Para llamadas a /api/state usar siempre red directa
  if (url.pathname.includes("/api/state")) {
    return;
  }
  // Network-first con fallback a caché para que nunca dé pantalla de error en ascensores o sin cobertura
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (event.request.method === "GET" && response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
