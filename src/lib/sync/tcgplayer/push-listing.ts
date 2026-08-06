import type { SupabaseClient } from "@supabase/supabase-js";
import type { TcgplayerClient } from "./client";
import { resolveTcgplayerProductId } from "./resolve-product-id";
import type { PushResult, SyncListingInput } from "../types";

/** TCGplayer's seller inventory is SKU/condition-based, not
 * product-creation like Shopify -- a store lists an existing catalog
 * product at a given condition/price/qty rather than creating a new
 * product. The POST is idempotent server-side (create-or-update the SKU
 * listing), so this same call handles both first-push and later updates. */
export async function pushTcgplayerListing(
  client: TcgplayerClient,
  supabase: SupabaseClient,
  storeKey: string,
  listing: SyncListingInput,
): Promise<PushResult> {
  try {
    const productId = await resolveTcgplayerProductId(client, supabase, listing.cardId, listing.cardName);
    if (!productId) {
      return { ok: false, error: `Could not resolve a TCGplayer catalog product for "${listing.cardName}"` };
    }

    await client.request(`/inventory/${storeKey}/skus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        condition: listing.condition,
        price: listing.priceCents / 100,
        quantity: listing.quantity,
      }),
    });

    return { ok: true, externalListingId: `${productId}:${listing.condition}`, externalProductId: productId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "TCGplayer listing push failed" };
  }
}
