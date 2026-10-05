/* Pulse Studio service worker — makes the whole app work offline. */
const VERSION = "pulse-v1";
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

const ROUTES = ["/", "/studio", "/decks", "/eq", "/visualizer", "/library", "/youtube"];
const STATIC = ["/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

/** Fetch each page and pre-cache every /_next/static asset it references, so pages open offline even if never visited. */
async function precache() {
  const cache = await caches.open(SHELL);
  await cache.addAll(STATIC).catch(() => {});
  const assets = new Set();
  await Promise.all(
    ROUTES.map(async (route) => {
      try {
        const res = await fetch(route, { cache: "reload", credentials: "same-origin" });
        if (!res.ok) return;
        const html = await res.clone().text();
        await cache.put(route, res);
        for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
      } catch {}
    }),
  );
  await Promise.all(
    [...assets].map((a) =>
      cache.match(a).then((hit) => hit || fetch(a).then((r) => r.ok && cache.put(a, r)).catch(() => {})),
    ),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // YouTube API & cross-origin requests always go to the network.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Next.js RSC payloads: network only. On failure Next falls back to a full navigation, which we serve from cache.
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // Hashed build assets & icons: cache-first (they're immutable).
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".woff2")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(RUNTIME).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Page navigations: network-first so updates arrive, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(url.pathname, copy));
          }
          return res;
        } catch {
          return (
            (await caches.match(url.pathname, { ignoreSearch: true })) ||
            (await caches.match("/")) ||
            new Response("<h1>Offline</h1>", { headers: { "Content-Type": "text/html" } })
          );
        }
      })(),
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(RUNTIME).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
