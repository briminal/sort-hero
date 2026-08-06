"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyStore } from "@/lib/supabase/store";
import { matchCards, type CardCandidate } from "@/lib/recognition/match";
import { getSignedScanUploadUrl } from "@/lib/storage/r2";
import {
  confirmBulkScanSchema,
  confirmScanSchema,
  getSetsForGameSchema,
  listCardAlternatesSchema,
  marketPricesForCardsSchema,
  searchCardsSchema,
  updateHighValueThresholdSchema,
} from "@/types/scanning";

export type SearchCardsResult = { candidates: CardCandidate[] } | { error: string };

export async function searchCards(input: {
  gameCode: string;
  query: string;
  setId?: string | null;
}): Promise<SearchCardsResult> {
  const parsed = searchCardsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const candidates = await matchCards(supabase, parsed.data.gameCode, parsed.data.query, 5, input.setId ?? null);
    return { candidates };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Search failed" };
  }
}

export type SetOption = { id: string; name: string };
export type GetSetsForGameResult = { sets: SetOption[] } | { error: string };

/** Powers the Scan Station's optional "Expansion" narrower -- authenticated
 * dashboard equivalent of the buylist portal's getSetsForGamePublic. */
export async function getSetsForGame(input: { gameCode: string }): Promise<GetSetsForGameResult> {
  const parsed = getSetsForGameSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id")
      .eq("code", parsed.data.gameCode)
      .maybeSingle();
    if (gameError) throw new Error(gameError.message);
    if (!game) return { sets: [] };

    const { data, error } = await supabase.from("sets").select("id, name").eq("game_id", game.id).order("name");
    if (error) throw new Error(error.message);

    return { sets: (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string })) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load sets" };
  }
}

export type UploadUrlResult = { uploadUrl: string; key: string } | { error: string };

export async function requestUploadUrl(fileSizeBytes: number): Promise<UploadUrlResult> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    return await getSignedScanUploadUrl(storeId, fileSizeBytes);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create upload URL" };
  }
}

export type ConfirmScanResult = { id: string } | { error: string };

export async function confirmScan(input: {
  cardId: string;
  imageKey: string | null;
  quantity: number;
}): Promise<ConfirmScanResult> {
  const parsed = confirmScanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data, error } = await supabase
      .from("inventory_items")
      .insert({
        store_id: storeId,
        card_id: parsed.data.cardId,
        scanned_image_url: parsed.data.imageKey,
        quantity: parsed.data.quantity,
        status: "staged",
      })
      .select("id")
      .single();

    if (error || !data) throw new Error(error?.message ?? "Insert failed");

    revalidatePath("/inventory");
    return { id: data.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not confirm scan" };
  }
}

export type HighValueThresholdReadResult = { thresholdCents: number } | { error: string };

export async function getHighValueThreshold(): Promise<HighValueThresholdReadResult> {
  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);
    const { data, error } = await supabase
      .from("stores")
      .select("high_value_threshold_cents")
      .eq("id", storeId)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Store not found");

    return { thresholdCents: data.high_value_threshold_cents as number };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load threshold" };
  }
}

export type MarketPricesResult = { prices: Record<string, number | null> } | { error: string };

/** Batched price lookup for the bulk review list -- one query instead of
 * one per row. Missing/never-priced cards resolve to null, not 0 or an
 * error, so the caller can tell "known to be free" apart from "unknown." */
export async function getMarketPricesForCards(input: { cardIds: string[] }): Promise<MarketPricesResult> {
  const parsed = marketPricesForCardsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from("card_market_prices")
      .select("card_id, market_price_cents")
      .in("card_id", parsed.data.cardIds);
    if (error) throw new Error(error.message);

    const prices: Record<string, number | null> = {};
    for (const id of parsed.data.cardIds) prices[id] = null;
    for (const row of data ?? []) {
      prices[row.card_id as string] = row.market_price_cents as number | null;
    }

    return { prices };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load prices" };
  }
}

export type PriceDetail = { marketCents: number | null; lowCents: number | null };
export type PriceDetailsResult = { prices: Record<string, PriceDetail> } | { error: string };

/** Same batched shape as getMarketPricesForCards but also surfaces low
 * price -- used by the Detail/Review panel, which shows both. */
export async function getPriceDetailsForCards(input: { cardIds: string[] }): Promise<PriceDetailsResult> {
  const parsed = marketPricesForCardsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { data, error } = await supabase
      .from("card_market_prices")
      .select("card_id, market_price_cents, low_price_cents")
      .in("card_id", parsed.data.cardIds);
    if (error) throw new Error(error.message);

    const prices: Record<string, PriceDetail> = {};
    for (const id of parsed.data.cardIds) prices[id] = { marketCents: null, lowCents: null };
    for (const row of data ?? []) {
      prices[row.card_id as string] = {
        marketCents: row.market_price_cents as number | null,
        lowCents: row.low_price_cents as number | null,
      };
    }

    return { prices };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load prices" };
  }
}

export type CardAlternate = {
  id: string;
  name: string;
  set_name: string | null;
  set_code: string | null;
  collector_number: string | null;
  image_url: string | null;
  rarity: string | null;
};
export type ListCardAlternatesResult = { alternates: CardAlternate[] } | { error: string };

/** Powers the Detail/Review panel's "Same Name Alternates" list -- every
 * printing of the exact matched card name, so an operator can re-pick the
 * correct set/printing when OCR read the right name but the trigram search
 * picked the wrong set. */
export async function listCardAlternates(input: { gameCode: string; name: string }): Promise<ListCardAlternatesResult> {
  const parsed = listCardAlternatesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("list_card_alternates", {
      p_game_code: parsed.data.gameCode,
      p_name: parsed.data.name,
    });
    if (error) throw new Error(error.message);

    return { alternates: (data ?? []) as CardAlternate[] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load alternates" };
  }
}

export type ConfirmBulkScanResult = { inserted: number } | { error: string };

export async function confirmBulkScan(input: {
  items: {
    cardId: string;
    imageKey: string | null;
    quantity: number;
    condition: string;
    printing?: string;
    language?: string;
    notes?: string | null;
    costCents?: number | null;
  }[];
}): Promise<ConfirmBulkScanResult> {
  const parsed = confirmBulkScanSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { storeId } = await getMyStore(supabase);

    const { data, error } = await supabase
      .from("inventory_items")
      .insert(
        parsed.data.items.map((item) => ({
          store_id: storeId,
          card_id: item.cardId,
          scanned_image_url: item.imageKey,
          quantity: item.quantity,
          condition: item.condition,
          printing: item.printing ?? "normal",
          language: item.language ?? "EN",
          notes: item.notes ?? null,
          cost_cents: item.costCents ?? null,
          status: "staged",
        })),
      )
      .select("id");

    if (error) throw new Error(error.message);

    revalidatePath("/inventory");
    return { inserted: data?.length ?? 0 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not confirm batch" };
  }
}

export type HighValueThresholdResult = { thresholdCents: number } | { error: string };

export async function updateHighValueThreshold(input: { thresholdCents: number }): Promise<HighValueThresholdResult> {
  const parsed = updateHighValueThresholdSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  try {
    const { storeId, role } = await getMyStore(supabase);
    if (role !== "owner") throw new Error("Only a store owner can change the high-value threshold");

    const { error } = await supabase
      .from("stores")
      .update({ high_value_threshold_cents: parsed.data.thresholdCents })
      .eq("id", storeId);
    if (error) throw new Error(error.message);

    revalidatePath("/scanning");
    return { thresholdCents: parsed.data.thresholdCents };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update threshold" };
  }
}
