import type { RawSyncOrder } from "../types";

/** Shopify webhook payloads for order topics (orders/create, orders/paid,
 * orders/cancelled) use this REST-style JSON shape regardless of whether
 * the Admin API itself is called via GraphQL -- webhooks are a separate,
 * long-stable contract. Only the fields this integration needs are typed;
 * the full payload is preserved as-is in rawPayload for support/debugging. */
type ShopifyOrderPayload = {
  id: number | string;
  subtotal_price: string;
  total_price: string;
  email: string | null;
  customer: { first_name: string | null; last_name: string | null } | null;
  shipping_address: Record<string, unknown> | null;
  line_items: {
    variant_id: number | string | null;
    title: string;
    quantity: number;
    price: string;
  }[];
};

function toCents(decimalString: string): number {
  return Math.round(Number(decimalString) * 100);
}

export function parseShopifyOrder(payload: ShopifyOrderPayload): RawSyncOrder {
  const customerName = payload.customer
    ? [payload.customer.first_name, payload.customer.last_name].filter(Boolean).join(" ") || null
    : null;

  return {
    externalOrderId: String(payload.id),
    subtotalCents: toCents(payload.subtotal_price),
    totalCents: toCents(payload.total_price),
    customerName,
    customerEmail: payload.email,
    shippingAddress: payload.shipping_address,
    rawPayload: payload as unknown as Record<string, unknown>,
    lines: payload.line_items.map((li) => ({
      externalListingId: li.variant_id !== null ? String(li.variant_id) : null,
      title: li.title,
      quantity: li.quantity,
      unitPriceCents: toCents(li.price),
      lineTotalCents: toCents(li.price) * li.quantity,
    })),
  };
}
