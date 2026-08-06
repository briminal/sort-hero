// Client-side only -- the kiosk cart lives in localStorage (keyed per store
// slug) until checkout, since nothing is reserved/committed until then.
// Mirrors SortSwift's kiosk: browsing and cart-building are free, only
// submitting a reservation touches the server.

export type KioskCartLine = {
  inventoryItemId: string;
  cardId: string;
  cardName: string;
  setName: string | null;
  imageUrl: string | null;
  condition: string;
  printing: string;
  quantity: number;
  priceCents: number;
  maxQuantity: number;
};

function storageKey(storeSlug: string): string {
  return `kiosk-cart:${storeSlug}`;
}

// Fired on every write so other components mounted in the same tab (e.g.
// the header's cart badge) can re-read -- the native "storage" event only
// fires in *other* tabs, not the one that made the change.
export const KIOSK_CART_EVENT = "kiosk-cart-updated";

export function readCart(storeSlug: string): KioskCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(storeSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCart(storeSlug: string, lines: KioskCartLine[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(storeSlug), JSON.stringify(lines));
  window.dispatchEvent(new CustomEvent(KIOSK_CART_EVENT, { detail: { storeSlug } }));
}

export function cartItemCount(lines: KioskCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function cartTotalCents(lines: KioskCartLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
}
