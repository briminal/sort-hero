"use client";

import { useEffect } from "react";

/** Registers public/sw.js once on mount. A component (not an inline
 * script) so it participates in Next's client bundle lifecycle normally --
 * renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed", err);
    });
  }, []);

  return null;
}
