/* Map Planner 1055 — service worker : coque de l'appli hors ligne + cache des données. Version : __BUILD__ */
const BUILD = "__BUILD__";
const SHELL = "mp-shell-" + BUILD;
const DATA = "mp-data";

self.addEventListener("install", () => {
  // Pas de skipWaiting automatique : la page propose « Nouvelle version — recharger ».
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith("mp-shell-") && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

/** Clé de cache sans le jeton ?t= (il change à chaque renouvellement). */
const keyFor = (url) => {
  const u = new URL(url);
  u.searchParams.delete("t");
  return u.toString();
};

async function networkFirst(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request, cacheName, key) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(key, response.clone());
  return response;
}

async function staleWhileRevalidate(request, key) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(key);
  const refresh = fetch(request).then((response) => {
    if (response.status === 200) cache.put(key, response.clone());
    return response;
  });
  if (hit) {
    refresh.catch(() => undefined);
    return hit;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  if (request.headers.has("range")) return;
  if (url.pathname.includes("/data/")) {
    // Refus du serveur (clé révoquée) : on ne sert pas le cache obsolète d'une réponse 401, le client verrouille l'appli.
    return event.respondWith(staleWhileRevalidate(request, keyFor(request.url)));
  }
  if (request.mode === "navigate") return event.respondWith(networkFirst(request, SHELL, new URL("./", self.registration.scope).toString()));
  if (/\/assets\//.test(url.pathname) || /\.(png|webmanifest|ico|svg)$/.test(url.pathname)) return event.respondWith(cacheFirst(request, SHELL, request.url));
});
