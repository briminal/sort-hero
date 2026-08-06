import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncOrder } from "./types";

/** Shared by both the Shopify webhook route and the TCGplayer poll job --
 * calls the atomic, idempotent import_marketplace_order RPC. Both entry
 * points normalize into the same SyncOrder shape first (via each
 * platform's parse-order.ts + resolve-inventory-match.ts), so this is the
 * one place that actually touches the database for an inbound order. */
export async function importSyncOrder(
  supabase: SupabaseClient,
  storeId: string,
  connectionId: string,
  platform: "shopify" | "tcgplayer",
  order: SyncOrder,
): Promise<{ orderId: string }> {
  const rawPayload =
    order.unmatchedLineCount > 0
      ? { ...order.rawPayload, unmatched_line_count: order.unmatchedLineCount }
      : order.rawPayload;

  const { data: orderId, error } = await supabase.rpc("import_marketplace_order", {
    p_store_id: storeId,
    p_connection_id: connectionId,
    p_platform: platform,
    p_external_order_id: order.externalOrderId,
    p_subtotal_cents: order.subtotalCents,
    p_total_cents: order.totalCents,
    p_customer_name: order.customerName,
    p_customer_email: order.customerEmail,
    p_shipping_address: order.shippingAddress,
    p_raw_payload: rawPayload,
    p_items: order.items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      cardId: item.cardId,
      cardName: item.cardName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
  });
  if (error) throw new Error(error.message);

  return { orderId: orderId as string };
}
