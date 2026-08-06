import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGameId } from "./lib/games";
import { upsertCards, upsertMarketPrices, upsertSets } from "./lib/upsert";
import type { NormalizedCard, NormalizedPrice, NormalizedSet } from "./lib/types";

type ScryfallSet = {
  code: string;
  name: string;
  released_at?: string;
};

type ScryfallCard = {
  id: string;
  name: string;
  set: string;
  collector_number: string;
  rarity: string;
  released_at?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  cmc?: number;
  image_uris?: { normal?: string };
  card_faces?: { image_uris?: { normal?: string } }[];
  prices?: { usd?: string | null };
};

// Scryfall rejects requests with a default HTTP-library User-Agent.
const SCRYFALL_HEADERS = {
  "User-Agent": "SortHero/0.1 (card-database-seed-script)",
  Accept: "application/json",
};

async function fetchSets(): Promise<NormalizedSet[]> {
  const res = await fetch("https://api.scryfall.com/sets", { headers: SCRYFALL_HEADERS });
  if (!res.ok) throw new Error(`Scryfall /sets failed: ${res.status}`);
  const json = (await res.json()) as { data: ScryfallSet[] };

  return json.data.map((s) => ({
    externalId: s.code,
    name: s.name,
    code: s.code,
    releasedAt: s.released_at ?? null,
  }));
}

async function fetchBulkDownloadUrl(): Promise<string> {
  const res = await fetch("https://api.scryfall.com/bulk-data", { headers: SCRYFALL_HEADERS });
  if (!res.ok) throw new Error(`Scryfall /bulk-data failed: ${res.status}`);
  const json = (await res.json()) as {
    data: { type: string; jsonl_download_uri?: string; download_uri?: string }[];
  };
  const entry = json.data.find((d) => d.type === "default_cards");
  const url = entry?.jsonl_download_uri ?? entry?.download_uri;
  if (!url) throw new Error("Scryfall bulk-data: no default_cards download URL found");
  return url;
}

function normalizeCard(card: ScryfallCard): NormalizedCard {
  const imageUrl =
    card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;

  return {
    externalId: card.id,
    name: card.name,
    setExternalId: card.set,
    collectorNumber: card.collector_number ?? null,
    imageUrl,
    rarity: card.rarity ?? null,
    metadata: {
      mana_cost: card.mana_cost ?? null,
      type_line: card.type_line ?? null,
      oracle_text: card.oracle_text ?? null,
      colors: card.colors ?? null,
      cmc: card.cmc ?? null,
    },
  };
}

function normalizePrice(card: ScryfallCard): NormalizedPrice {
  const usd = card.prices?.usd;
  const cents = usd ? Math.round(Number(usd) * 100) : null;

  return {
    cardExternalId: card.id,
    marketPriceCents: cents !== null && Number.isFinite(cents) ? cents : null,
    lowPriceCents: null,
    highPriceCents: null,
  };
}

async function fetchCardsAndPrices(
  limit: number | null,
): Promise<{ cards: NormalizedCard[]; prices: NormalizedPrice[] }> {
  const downloadUrl = await fetchBulkDownloadUrl();
  const res = await fetch(downloadUrl);
  if (!res.ok || !res.body) throw new Error(`Scryfall bulk download failed: ${res.status}`);

  // The bulk-data endpoint switched to gzipped JSONL (one card object per
  // line) -- stream-decompress and parse line by line rather than buffering
  // the whole ~300MB+ decompressed file before we've upserted anything.
  const gunzip = createGunzip();
  Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(gunzip);

  const rl = createInterface({ input: gunzip });
  const cards: NormalizedCard[] = [];
  const prices: NormalizedPrice[] = [];

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "[" || trimmed === "]") continue;
    const cleaned = trimmed.replace(/,$/, "");
    if (!cleaned) continue;

    try {
      const raw = JSON.parse(cleaned) as ScryfallCard;
      cards.push(normalizeCard(raw));
      prices.push(normalizePrice(raw));
    } catch {
      continue;
    }

    if (limit !== null && cards.length >= limit) {
      rl.close();
      gunzip.destroy();
      break;
    }
  }

  return { cards, prices };
}

export async function seedScryfall(admin: SupabaseClient, limit: number | null) {
  const gameId = await getGameId(admin, "mtg");

  const sets = await fetchSets();
  const setIdByExternalId = await upsertSets(admin, gameId, sets);
  console.log(`  scryfall: upserted ${sets.length} sets`);

  const { cards, prices } = await fetchCardsAndPrices(limit);
  const cardIdByExternalId = await upsertCards(admin, gameId, cards, setIdByExternalId);
  console.log(
    `  scryfall: upserted ${cardIdByExternalId.size} cards${limit ? ` (capped at ${limit})` : ""}`,
  );

  const priceCount = await upsertMarketPrices(admin, "scryfall", prices, cardIdByExternalId);
  console.log(`  scryfall: upserted ${priceCount} market prices`);
}
