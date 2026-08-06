"use client";

import { useEffect, useState } from "react";

/** Wraps navigator.onLine + the online/offline window events. Starts
 * optimistic (true) since navigator.onLine is undefined during SSR --
 * corrected on mount before paint matters for this use case (a banner
 * that's only ever wrong for a frame). */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
