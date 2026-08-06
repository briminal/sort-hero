import type { RawSyncOrder } from "../types";

/** TCGplayer's Seller/Pro order-management API is (to the best of my
 * knowledge) pull-based, not webhook-driven -- this shape reflects a
 * reasonable orders-list response and is the part of this module most
 * likely to need adjustment once real API access/docs exist (see the
 * module plan's stated caveat). Kept minimal and isolated to this one
 * function specifically so that revision is cheap. */
type TcgplayerOrderPayload = {
  orderId: string;
  subtotal: number;
  orderTotal: number;
  buyerName: string | null;
  buyerEmail: string | null;
  shippingAddress: Record<string, unknown> | null;
  items: { sku: string; productName: string; quantity: number; price: number }[];
};

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function parseTcgplayerOrder(payload: TcgplayerOrderPayload): RawSyncOrder {
  return {
    externalOrderId: payload.orderId,
    subtotalCents: toCents(payload.subtotal),
    totalCents: toCents(payload.orderTotal),
    customerName: payload.buyerName,
    customerEmail: payload.buyerEmail,
    shippingAddress: payload.shippingAddress,
    rawPayload: payload as unknown as Record<string, unknown>,
    lines: payload.items.map((item) => ({
      externalListingId: item.sku,
      title: item.productName,
      quantity: item.quantity,
      unitPriceCents: toCents(item.price),
      lineTotalCents: toCents(item.price) * item.quantity,
    })),
  };
}
