// Service worker template. The build fills in VERSION and PRECACHE and writes it to /sw.js (see vite.config.ts).
// Pages load from the network first and fall back to the cached app shell offline. Built assets are served from
// the cache. API requests are never touched.

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `starwatch-${VERSION}`;
const SHELL = "/index.html";

/** Copy without redirect info, so a cached shell can answer any navigation. */
async function plain(response) {
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      const shell = await fetch(SHELL, { cache: "no-cache" });
      if (shell.ok) await cache.put(SHELL, await plain(shell));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter((key) => key.startsWith("starwatch-") && key !== CACHE);
      await Promise.all(old.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

async function navigate(request) {
  try {
    const response = await fetch(request);
    const html = response.headers.get("Content-Type")?.includes("text/html");
    if (response.ok && html) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, await plain(response.clone()));
    }
    return response;
  } catch (err) {
    const cached = await caches.match(SHELL);
    if (cached) return cached;
    throw err;
  }
}

async function asset(request) {
  return (await caches.match(request)) ?? fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(request.mode === "navigate" ? navigate(request) : asset(request));
});
