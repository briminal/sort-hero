import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedCard, NormalizedPrice, NormalizedSet } from "./types";

const CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Upserts sets for a game and returns a map of external_id -> set id. */
export async function upsertSets(
  admin: SupabaseClient,
  gameId: string,
  sets: NormalizedSet[],
): Promise<Map<string, string>> {
  const setIdByExternalId = new Map<string, string>();

  for (const batch of chunk(sets, CHUNK_SIZE)) {
    const rows = batch.map((s) => ({
      game_id: gameId,
      external_id: s.externalId,
      name: s.name,
      code: s.code,
      released_at: s.releasedAt,
    }));

    const { data, error } = await admin
      .from("sets")
      .upsert(rows, { onConflict: "game_id,external_id" })
      .select("id, external_id");

    if (error) throw new Error(`upsert sets failed: ${error.message}`);

    for (const row of data ?? []) {
      setIdByExternalId.set(row.external_id as string, row.id as string);
    }
  }

  return setIdByExternalId;
}

/** Upserts cards for a game, resolving set_id from the given external-id
 * map. Returns a map of external_id -> card id, needed by callers that also
 * upsert market prices (which reference the card's real id, not its
 * external id). */
export async function upsertCards(
  admin: SupabaseClient,
  gameId: string,
  cards: NormalizedCard[],
  setIdByExternalId: Map<string, string>,
): Promise<Map<string, string>> {
  const cardIdByExternalId = new Map<string, string>();

  for (const batch of chunk(cards, CHUNK_SIZE)) {
    const rows = batch.map((c) => ({
      game_id: gameId,
      set_id: c.setExternalId ? (setIdByExternalId.get(c.setExternalId) ?? null) : null,
      external_id: c.externalId,
      name: c.name,
      collector_number: c.collectorNumber,
      image_url: c.imageUrl,
      rarity: c.rarity,
      metadata: c.metadata,
    }));

    const { data, error } = await admin
      .from("cards")
      .upsert(rows, { onConflict: "game_id,external_id" })
      .select("id, external_id");

    if (error) throw new Error(`upsert cards failed: ${error.message}`);

    for (const row of data ?? []) {
      cardIdByExternalId.set(row.external_id as string, row.id as string);
    }
  }

  return cardIdByExternalId;
}

/** Upserts market prices, resolving card_id from the given external-id map.
 * Prices with no resolvable card (shouldn't happen -- cards are upserted
 * first in the same run) or no price data at all are skipped. */
export async function upsertMarketPrices(
  admin: SupabaseClient,
  source: string,
  prices: NormalizedPrice[],
  cardIdByExternalId: Map<string, string>,
): Promise<number> {
  const rows = prices
    .filter((p) => p.marketPriceCents !== null && cardIdByExternalId.has(p.cardExternalId))
    .map((p) => ({
      card_id: cardIdByExternalId.get(p.cardExternalId)!,
      source,
      market_price_cents: p.marketPriceCents,
      low_price_cents: p.lowPriceCents,
      high_price_cents: p.highPriceCents,
      fetched_at: new Date().toISOString(),
    }));

  let upserted = 0;

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    const { error, count } = await admin
      .from("card_market_prices")
      .upsert(batch, { onConflict: "card_id", count: "exact" });

    if (error) throw new Error(`upsert market prices failed: ${error.message}`);
    upserted += count ?? batch.length;
  }

  return upserted;
}
