import type { SupabaseClient } from "@supabase/supabase-js";
import type { TcgplayerClient } from "./client";

/** TCGplayer's product ID is catalog-level (shared across sellers, like
 * cards.external_id from Scryfall) so it's cached directly on cards --
 * cache-aside: check the column first, only hit TCGplayer's catalog search
 * on a miss. */
export async function resolveTcgplayerProductId(
  client: TcgplayerClient,
  supabase: SupabaseClient,
  cardId: string,
  cardName: string,
): Promise<string | null> {
  const { data: card } = await supabase.from("cards").select("tcgplayer_product_id").eq("id", cardId).single();
  if (card?.tcgplayer_product_id) return card.tcgplayer_product_id as string;

  const searchResult = await client.request<{ results: { productId: number }[] }>(
    `/catalog/products?productName=${encodeURIComponent(cardName)}`,
  );
  const productId = searchResult.results[0]?.productId;
  if (productId === undefined) return null;

  await supabase.from("cards").update({ tcgplayer_product_id: String(productId) }).eq("id", cardId);
  return String(productId);
}
