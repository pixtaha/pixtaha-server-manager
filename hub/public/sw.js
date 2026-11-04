/* Pixtaha Management service worker.
 * Security dashboard rules: never cache authenticated or dynamic responses.
 * - /api/*, page HTML and RSC requests, and anything sent with credentials: network-only.
 * - Static hashed assets (/_next/static/*, /icons/*, fonts): cache-first.
 * - Failed navigations fall back to /offline.html (precached).
 */
const VERSION = "v1";
const CACHE = `pm-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload", credentials: "omit" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pm-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(woff2?|ttf|otf)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: always network. Only on network failure show the static offline page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL, { cacheName: CACHE }).then((r) => r || Response.error())),
    );
    return;
  }

  // Everything that is not a static hashed asset (API, RSC payloads, anything else) is left to the browser: network-only.
  if (!isStaticAsset(url) || url.pathname.startsWith("/api/") || req.headers.has("RSC") || req.headers.has("Authorization")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && !res.redirected && res.type === "basic" && !res.headers.get("Set-Cookie")) cache.put(req, res.clone());
      return res;
    }),
  );
});
