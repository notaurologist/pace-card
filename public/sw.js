// Offline support. Network first, so a deploy shows up on the next load; the cache is only the fallback
// for when there is no signal (a gym basement, a boathouse). Same-origin GETs only; Google Fonts fall back
// to system fonts offline.
const CACHE = "pacecard-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/pace.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
      .then((hit) => hit || (req.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});
