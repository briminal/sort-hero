import type { SupabaseClient } from "@supabase/supabase-js";
import { getGameId } from "./lib/games";
import { fetchJson } from "./lib/fetch-retry";
import { upsertCards, upsertMarketPrices, upsertSets } from "./lib/upsert";
import type { NormalizedPrice, NormalizedSet } from "./lib/types";

const API_BASE = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;

type PokemonSet = {
  id: string;
  name: string;
  releaseDate?: string;
};

type PriceVariant = { low?: number | null; mid?: number | null; high?: number | null; market?: number | null };

type PokemonCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  set?: { id: string };
  images?: { small?: string; large?: string };
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  hp?: string;
  tcgplayer?: { prices?: Record<string, PriceVariant> };
};

function headers(): HeadersInit {
  const apiKey = process.env.POKEMONTCG_API_KEY;
  return apiKey ? { "X-Api-Key": apiKey } : {};
}

/** "1999/01/09" -> "1999-01-09" */
function toIsoDate(date: string | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("/");
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

async function fetchSets(): Promise<NormalizedSet[]> {
  const json = await fetchJson<{ data: PokemonSet[] }>(`${API_BASE}/sets?pageSize=250`, {
    headers: headers(),
  });

  return json.data.map((s) => ({
    externalId: s.id,
    name: s.name,
    code: s.id,
    releasedAt: toIsoDate(s.releaseDate),
  }));
}

function normalizeCard(card: PokemonCard) {
  return {
    externalId: card.id,
    name: card.name,
    setExternalId: card.set?.id ?? null,
    collectorNumber: card.number ?? null,
    imageUrl: card.images?.large ?? card.images?.small ?? null,
    rarity: card.rarity ?? null,
    metadata: {
      supertype: card.supertype ?? null,
      subtypes: card.subtypes ?? null,
      types: card.types ?? null,
      hp: card.hp ?? null,
    },
  };
}

function toCents(dollars: number | null | undefined): number | null {
  return typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
}

/** Cards have multiple print variants (holofoil, reverseHolofoil, etc.) --
 * take the first variant that actually has a market price. */
function normalizePrice(card: PokemonCard): NormalizedPrice {
  const variants = Object.values(card.tcgplayer?.prices ?? {});
  const withMarket = variants.find((v) => typeof v.market === "number");

  return {
    cardExternalId: card.id,
    marketPriceCents: toCents(withMarket?.market),
    lowPriceCents: toCents(withMarket?.low),
    highPriceCents: toCents(withMarket?.high),
  };
}

export async function seedPokemonTcg(admin: SupabaseClient, limit: number | null) {
  const gameId = await getGameId(admin, "pokemon");

  const sets = await fetchSets();
  const setIdByExternalId = await upsertSets(admin, gameId, sets);
  console.log(`  pokemontcg: upserted ${sets.length} sets`);

  // Upsert page-by-page rather than buffering the whole catalog and
  // upserting once at the end -- the unauthenticated API rate-limits
  // aggressively deep into pagination, and losing 60+ already-fetched pages
  // to one late failure (as happened in practice) wastes real work. A page
  // that fails even after retries is skipped, not fatal to the whole run --
  // re-running the (idempotent) script later fills in whatever was missed.
  let page = 1;
  let totalUpserted = 0;
  let totalPrices = 0;
  let seen = 0;
  const failedPages: number[] = [];

  while (true) {
    let json: { data: PokemonCard[]; totalCount: number };
    try {
      json = await fetchJson<{ data: PokemonCard[]; totalCount: number }>(
        `${API_BASE}/cards?page=${page}&pageSize=${PAGE_SIZE}`,
        { headers: headers() },
      );
    } catch (err) {
      console.error(
        `  pokemontcg: page ${page} failed, skipping (${err instanceof Error ? err.message : String(err)})`,
      );
      failedPages.push(page);
      page++;
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }

    const remaining = limit !== null ? limit - seen : json.data.length;
    const pageCards = remaining < json.data.length ? json.data.slice(0, remaining) : json.data;
    const normalized = pageCards.map(normalizeCard);
    const prices = pageCards.map(normalizePrice);

    const cardIdByExternalId = await upsertCards(admin, gameId, normalized, setIdByExternalId);
    totalUpserted += cardIdByExternalId.size;
    totalPrices += await upsertMarketPrices(admin, "pokemontcg", prices, cardIdByExternalId);
    seen += pageCards.length;

    if (limit !== null && seen >= limit) break;
    if (json.data.length < PAGE_SIZE || seen >= json.totalCount) break;

    page++;
    // Unauthenticated PokemonTCG API rate-limits aggressively -- pace requests.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const suffix = failedPages.length > 0 ? ` (skipped pages: ${failedPages.join(", ")})` : "";
  console.log(
    `  pokemontcg: upserted ${totalUpserted} cards${limit ? ` (capped at ${limit})` : ""}${suffix}`,
  );
  console.log(`  pokemontcg: upserted ${totalPrices} market prices`);

  if (failedPages.length > 0) {
    throw new Error(`pokemontcg: ${failedPages.length} page(s) failed -- re-run to retry`);
  }
}
