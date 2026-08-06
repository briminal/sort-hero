/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Force browsers to always re-check for an updated service worker
        // rather than caching it long-term -- a well-known PWA footgun
        // otherwise (a stale sw.js can keep serving stale app-shell caches
        // indefinitely).
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
