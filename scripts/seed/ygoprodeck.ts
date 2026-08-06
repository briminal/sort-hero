import type { SupabaseClient } from "@supabase/supabase-js";
import { getGameId } from "./lib/games";
import { fetchJson } from "./lib/fetch-retry";
import { upsertCards, upsertMarketPrices, upsertSets } from "./lib/upsert";
import type { NormalizedCard, NormalizedPrice, NormalizedSet } from "./lib/types";

const API_BASE = "https://db.ygoprodeck.com/api/v7";

type YgoSet = {
  set_name: string;
  set_code: string;
  tcg_date?: string;
};

type YgoCardSet = {
  set_name: string;
  set_code: string;
  set_rarity?: string;
};

type YgoCardPrice = {
  cardmarket_price?: string;
  tcgplayer_price?: string;
};

type YgoCard = {
  id: number;
  name: string;
  type?: string;
  race?: string;
  attribute?: string;
  atk?: number;
  def?: number;
  level?: number;
  archetype?: string;
  card_sets?: YgoCardSet[];
  card_images?: { image_url?: string }[];
  card_prices?: YgoCardPrice[];
};

async function fetchSets(): Promise<NormalizedSet[]> {
  const json = await fetchJson<YgoSet[]>(`${API_BASE}/cardsets.php`);

  // set_code isn't always unique in the raw data (reprints reuse a code) --
  // dedupe before upserting since a single upsert statement can't target
  // the same conflict key twice.
  const byCode = new Map<string, NormalizedSet>();
  for (const s of json) {
    byCode.set(s.set_code, {
      externalId: s.set_code,
      name: s.set_name,
      code: s.set_code,
      releasedAt: s.tcg_date ?? null,
    });
  }

  return [...byCode.values()];
}

/** Yu-Gi-Oh cards can appear in many sets/printings -- explode one API card
 * into one row per printing, like MTG/Pokemon do, so a physical scanned
 * card's specific set is something we can actually match against. */
function normalizeCard(card: YgoCard): NormalizedCard[] {
  const imageUrl = card.card_images?.[0]?.image_url ?? null;
  const metadata = {
    type: card.type ?? null,
    race: card.race ?? null,
    attribute: card.attribute ?? null,
    atk: card.atk ?? null,
    def: card.def ?? null,
    level: card.level ?? null,
    archetype: card.archetype ?? null,
  };

  if (!card.card_sets || card.card_sets.length === 0) {
    return [
      {
        externalId: String(card.id),
        name: card.name,
        setExternalId: null,
        collectorNumber: null,
        imageUrl,
        rarity: null,
        metadata,
      },
    ];
  }

  // A card can list the same (set_code, rarity) combination more than once
  // in the raw data -- dedupe by the same key we use as external_id so a
  // single upsert batch never targets one conflict key twice.
  const byKey = new Map<string, NormalizedCard>();
  for (const printing of card.card_sets) {
    const key = `${card.id}-${printing.set_code}-${printing.set_rarity ?? "none"}`;
    byKey.set(key, {
      externalId: key,
      name: card.name,
      setExternalId: printing.set_code,
      collectorNumber: printing.set_code,
      imageUrl,
      rarity: printing.set_rarity ?? null,
      metadata,
    });
  }

  return [...byKey.values()];
}

function toCents(dollars: string | undefined): number | null {
  if (!dollars) return null;
  const n = Number(dollars);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** The API gives one price per card, not per printing -- every exploded
 * printing row for a card shares the same market price. */
function normalizePrices(card: YgoCard, externalIds: string[]): NormalizedPrice[] {
  const marketPriceCents = toCents(card.card_prices?.[0]?.tcgplayer_price);
  return externalIds.map((cardExternalId) => ({
    cardExternalId,
    marketPriceCents,
    lowPriceCents: null,
    highPriceCents: null,
  }));
}

async function fetchCardsAndPrices(
  limit: number | null,
): Promise<{ cards: NormalizedCard[]; prices: NormalizedPrice[] }> {
  const json = await fetchJson<{ data: YgoCard[] }>(`${API_BASE}/cardinfo.php`);

  const cards: NormalizedCard[] = [];
  const prices: NormalizedPrice[] = [];

  for (const raw of json.data) {
    const normalized = normalizeCard(raw);
    prices.push(...normalizePrices(raw, normalized.map((n) => n.externalId)));

    for (const n of normalized) {
      cards.push(n);
      if (limit !== null && cards.length >= limit) return { cards, prices };
    }
  }

  return { cards, prices };
}

export async function seedYgoprodeck(admin: SupabaseClient, limit: number | null) {
  const gameId = await getGameId(admin, "yugioh");

  const sets = await fetchSets();
  const setIdByExternalId = await upsertSets(admin, gameId, sets);
  console.log(`  ygoprodeck: upserted ${sets.length} sets`);

  const { cards, prices } = await fetchCardsAndPrices(limit);
  const cardIdByExternalId = await upsertCards(admin, gameId, cards, setIdByExternalId);
  console.log(
    `  ygoprodeck: upserted ${cardIdByExternalId.size} cards${limit ? ` (capped at ${limit})` : ""}`,
  );

  const priceCount = await upsertMarketPrices(admin, "ygoprodeck", prices, cardIdByExternalId);
  console.log(`  ygoprodeck: upserted ${priceCount} market prices`);
}
