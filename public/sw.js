// Hand-rolled, not a library (see the module plan) -- Next.js's
// content-hashed build filenames mean a precache manifest would need
// build-time generation anyway, so this caches opportunistically at
// runtime instead of maintaining a precache list.
//
// The one correctness-critical rule in this file: anything that isn't a
// same-origin static GET is network-only, never cached. Caching a stale
// inventory count or a POS payment response would be a real bug, not a UX
// nicety -- served with no-cache (see next.config.mjs) so this file itself
// is re-checked on every load rather than sticking around after an update.

const CACHE_NAME = "sort-hero-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// cache.put can throw (opaque/redirected responses, storage quota) --
// swallow-and-log rather than an unhandled rejection on every cache write.
function putInCache(request, response) {
  caches.open(CACHE_NAME).then((cache) => cache.put(request, response)).catch((err) => {
    console.error("sw.js: failed to cache", request.url, err);
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Network-only: non-GET (every Server Action POST, form submission),
  // cross-origin (Supabase, Stripe, Shippo, etc.), and API routes. None of
  // this should ever be served from a cache.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigation requests (page loads): network-first, falling back to a
  // cached copy of the same page, and finally the offline page if neither
  // is available -- keeps the app shell loadable through a brief network
  // drop without ever showing a raw browser error page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache a real success -- caching a transient 404/500 as "the
          // page" would mean a later real outage serves that error instead
          // of falling through to the offline page.
          if (response.ok) putInCache(request, response.clone());
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          // Always resolve to a real Response -- respondWith(undefined)
          // throws and surfaces as a hard net::ERR_FAILED, worse than no
          // service worker at all, if the offline page itself was never
          // successfully cached (e.g. evicted under storage pressure).
          return offline ?? new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }),
    );
    return;
  }

  // Static assets (_next/static bundles, icons, manifest): cache-first,
  // cached on first fetch since these are content-hashed and immutable. An
  // uncached asset requested while offline still fails, but as an explicit
  // network-error Response rather than an unhandled rejection.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) putInCache(request, response.clone());
          return response;
        })
        .catch(() => new Response("Network error", { status: 503, headers: { "Content-Type": "text/plain" } }));
    }),
  );
});
