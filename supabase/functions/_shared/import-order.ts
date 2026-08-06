// Deno-side mirror of src/lib/sync/resolve-inventory-match.ts + import-order.ts.

// deno-lint-ignore no-explicit-any
type RawSyncOrder = ReturnType<typeof import("./tcgplayer.ts").parseTcgplayerOrder>;

export async function resolveAndImportOrder(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  storeId: string,
  connectionId: string,
  platform: "shopify" | "tcgplayer",
  raw: RawSyncOrder,
): Promise<{ orderId: string }> {
  const externalIds = raw.lines.map((l) => l.externalListingId).filter((id): id is string => id !== null);

  const listingsByExternalId = new Map<string, string>();
  if (externalIds.length > 0) {
    const { data: listings } = await supabase
      .from("marketplace_listings")
      .select("external_listing_id, inventory_item_id")
      .eq("connection_id", connectionId)
      .in("external_listing_id", externalIds);
    for (const l of listings ?? []) listingsByExternalId.set(l.external_listing_id, l.inventory_item_id);
  }

  const inventoryItemIds = [...listingsByExternalId.values()];
  const cardByInventoryItemId = new Map<string, { card_id: string; card_name: string }>();
  if (inventoryItemIds.length > 0) {
    const { data: items } = await supabase.from("inventory_items").select("id, card_id, cards(name)").in("id", inventoryItemIds);
    for (const item of items ?? []) {
      cardByInventoryItemId.set(item.id, { card_id: item.card_id, card_name: item.cards.name });
    }
  }

  const resolvedItems: {
    inventoryItemId: string;
    cardId: string;
    cardName: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }[] = [];
  let unmatchedLineCount = 0;

  for (const line of raw.lines) {
    const inventoryItemId = line.externalListingId ? listingsByExternalId.get(line.externalListingId) : undefined;
    const card = inventoryItemId ? cardByInventoryItemId.get(inventoryItemId) : undefined;

    if (!inventoryItemId || !card) {
      unmatchedLineCount++;
      continue;
    }

    resolvedItems.push({
      inventoryItemId,
      cardId: card.card_id,
      cardName: card.card_name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    });
  }

  const rawPayload =
    unmatchedLineCount > 0 ? { ...raw.rawPayload, unmatched_line_count: unmatchedLineCount } : raw.rawPayload;

  const { data: orderId, error } = await supabase.rpc("import_marketplace_order", {
    p_store_id: storeId,
    p_connection_id: connectionId,
    p_platform: platform,
    p_external_order_id: raw.externalOrderId,
    p_subtotal_cents: raw.subtotalCents,
    p_total_cents: raw.totalCents,
    p_customer_name: raw.customerName,
    p_customer_email: raw.customerEmail,
    p_shipping_address: raw.shippingAddress,
    p_raw_payload: rawPayload,
    p_items: resolvedItems,
  });
  if (error) throw new Error(error.message);

  return { orderId };
}
