// Deno-side mirror of src/lib/sync/tcgplayer/push-listing.ts + resolve-product-id.ts.

import type { TcgplayerClient } from "./tcgplayer.ts";

type SyncListingInput = {
  inventoryItemId: string;
  cardId: string;
  cardName: string;
  condition: string;
  quantity: number;
  priceCents: number;
};

type PushResult =
  | { ok: true; externalListingId: string; externalProductId: string | null }
  | { ok: false; error: string };

async function resolveTcgplayerProductId(
  client: TcgplayerClient,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  cardId: string,
  cardName: string,
): Promise<string | null> {
  const { data: card } = await supabase.from("cards").select("tcgplayer_product_id").eq("id", cardId).single();
  if (card?.tcgplayer_product_id) return card.tcgplayer_product_id;

  const searchResult = await client.request<{ results: { productId: number }[] }>(
    `/catalog/products?productName=${encodeURIComponent(cardName)}`,
  );
  const productId = searchResult.results[0]?.productId;
  if (productId === undefined) return null;

  await supabase.from("cards").update({ tcgplayer_product_id: String(productId) }).eq("id", cardId);
  return String(productId);
}

export async function pushTcgplayerListing(
  client: TcgplayerClient,
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
      body: JSON.stringify({ productId, condition: listing.condition, price: listing.priceCents / 100, quantity: listing.quantity }),
    });

    return { ok: true, externalListingId: `${productId}:${listing.condition}`, externalProductId: productId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "TCGplayer listing push failed" };
  }
}
