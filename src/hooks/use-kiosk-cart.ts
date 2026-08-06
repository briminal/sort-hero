"use client";

import { useCallback, useEffect, useState } from "react";
import { KIOSK_CART_EVENT, readCart, writeCart, type KioskCartLine } from "@/lib/kiosk/cart";

export function useKioskCart(storeSlug: string) {
  const [lines, setLines] = useState<KioskCartLine[]>([]);

  useEffect(() => {
    setLines(readCart(storeSlug));
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<{ storeSlug: string }>).detail;
      if (detail?.storeSlug === storeSlug) setLines(readCart(storeSlug));
    }
    window.addEventListener(KIOSK_CART_EVENT, onUpdate);
    window.addEventListener("storage", () => setLines(readCart(storeSlug)));
    return () => window.removeEventListener(KIOSK_CART_EVENT, onUpdate);
  }, [storeSlug]);

  const setCart = useCallback(
    (next: KioskCartLine[]) => {
      writeCart(storeSlug, next);
      setLines(next);
    },
    [storeSlug],
  );

  return [lines, setCart] as const;
}
