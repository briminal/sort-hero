/** Shared cross-platform shapes -- both the Shopify and TCGplayer client
 * modules normalize into these before touching the DB, so import-order.ts
 * and the push-listing flow only need to understand one shape each. */

export type SyncListingInput = {
  inventoryItemId: string;
  cardId: string;
  cardName: string;
  condition: "NM" | "LP" | "MP" | "HP" | "DMG";
  quantity: number;
  priceCents: number;
};

export type PushResult =
  | { ok: true; externalListingId: string; externalProductId: string | null }
  | { ok: false; error: string };

/** What parse-order.ts can know from a raw webhook/poll payload alone -- it
 * only ever has the marketplace's own listing id per line, never our
 * internal card_id/inventory_item_id. */
export type RawSyncOrderLine = {
  externalListingId: string | null;
  title: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type RawSyncOrder = {
  externalOrderId: string;
  subtotalCents: number;
  totalCents: number;
  customerName: string | null;
  customerEmail: string | null;
  shippingAddress: Record<string, unknown> | null;
  rawPayload: Record<string, unknown>;
  lines: RawSyncOrderLine[];
};

/** Fully resolved, post resolve-inventory-match.ts -- this is what actually
 * reaches the import_marketplace_order RPC. A line whose externalListingId
 * couldn't be matched to a known marketplace_listings row is dropped here
 * (not sent to the RPC at all -- card_id is NOT NULL on
 * marketplace_order_items, there's nothing sensible to insert) and instead
 * surfaced via SyncOrder.unmatchedLineCount for staff visibility. */
export type SyncOrderItem = {
  inventoryItemId: string | null;
  cardId: string;
  cardName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type SyncOrder = {
  externalOrderId: string;
  subtotalCents: number;
  totalCents: number;
  customerName: string | null;
  customerEmail: string | null;
  shippingAddress: Record<string, unknown> | null;
  rawPayload: Record<string, unknown>;
  items: SyncOrderItem[];
  unmatchedLineCount: number;
};
