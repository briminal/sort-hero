import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawSyncOrder, SyncOrder, SyncOrderItem } from "./types";

/** Resolves each raw line's marketplace listing id into our internal
 * inventory_item_id/card_id/card_name via marketplace_listings +
 * inventory_items + cards. A line that can't be matched (delisted item,
 * unknown SKU) is dropped from the items sent to the RPC -- card_id is
 * NOT NULL on marketplace_order_items, there's nothing sensible to insert
 * -- and counted in unmatchedLineCount instead, so the order is still
 * recorded and staff can see something needs reconciling. */
export async function resolveInventoryMatches(
  supabase: SupabaseClient,
  connectionId: string,
  raw: RawSyncOrder,
): Promise<SyncOrder> {
  const externalIds = raw.lines
    .map((l) => l.externalListingId)
    .filter((id): id is string => id !== null);

  const listingsByExternalId = new Map<string, { inventory_item_id: string }>();
  if (externalIds.length > 0) {
    const { data: listings } = await supabase
      .from("marketplace_listings")
      .select("external_listing_id, inventory_item_id")
      .eq("connection_id", connectionId)
      .in("external_listing_id", externalIds);

    for (const l of listings ?? []) {
      listingsByExternalId.set(l.external_listing_id as string, {
        inventory_item_id: l.inventory_item_id as string,
      });
    }
  }

  const inventoryItemIds = [...listingsByExternalId.values()].map((l) => l.inventory_item_id);
  const cardByInventoryItemId = new Map<string, { card_id: string; card_name: string }>();
  if (inventoryItemIds.length > 0) {
    const { data: items } = await supabase
      .from("inventory_items")
      .select("id, card_id, cards(name)")
      .in("id", inventoryItemIds);

    for (const item of items ?? []) {
      cardByInventoryItemId.set(item.id as string, {
        card_id: item.card_id as string,
        card_name: (item.cards as unknown as { name: string }).name,
      });
    }
  }

  const items: SyncOrderItem[] = [];
  let unmatchedLineCount = 0;

  for (const line of raw.lines) {
    const listing = line.externalListingId ? listingsByExternalId.get(line.externalListingId) : undefined;
    const card = listing ? cardByInventoryItemId.get(listing.inventory_item_id) : undefined;

    if (!listing || !card) {
      unmatchedLineCount++;
      continue;
    }

    items.push({
      inventoryItemId: listing.inventory_item_id,
      cardId: card.card_id,
      cardName: card.card_name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    });
  }

  return {
    externalOrderId: raw.externalOrderId,
    subtotalCents: raw.subtotalCents,
    totalCents: raw.totalCents,
    customerName: raw.customerName,
    customerEmail: raw.customerEmail,
    shippingAddress: raw.shippingAddress,
    rawPayload: raw.rawPayload,
    items,
    unmatchedLineCount,
  };
}
