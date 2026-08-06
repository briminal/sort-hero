import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBuylistPrice } from "@/lib/pricing/buylist-engine";
import type { BuylistPricingRule, PriceSource } from "@/types/buylist-pricing";

type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

export type BuylistOfferLineInput = {
  cardId: string;
  cardName: string;
  condition: Condition;
  quantity: number;
  // Pass-through metadata that doesn't affect price calculation -- carried
  // straight onto the output line (via the `...item` spread below) so
  // callers can round-trip them into buylist_items without a second lookup.
  payoutType?: "cash" | "credit";
  printing?: string;
  language?: string;
  notes?: string | null;
};

export type BuylistOfferLine = BuylistOfferLineInput & {
  cashUnitPriceCents: number;
  creditUnitPriceCents: number;
  cashLineTotalCents: number;
  creditLineTotalCents: number;
};

export type BuylistOffer = {
  lines: BuylistOfferLine[];
  totalCashCents: number;
  totalCreditCents: number;
};

type PriceRow = { market: number | null; low: number | null; high: number | null };
type SourceConfigRow = {
  game_id: string | null;
  primary_source: PriceSource;
  secondary_source: PriceSource | null;
  last_call_source: PriceSource | null;
  doomsday_source: PriceSource | null;
  primary_modifier_pct: number;
  secondary_modifier_pct: number;
  last_call_modifier_pct: number;
  doomsday_modifier_pct: number;
};

function sourceValue(prices: PriceRow, source: PriceSource | null): number | null {
  if (!source) return null;
  if (source === "market") return prices.market;
  if (source === "low") return prices.low;
  if (source === "high") return prices.high;
  if (source === "mid") return prices.low != null && prices.high != null ? Math.round((prices.low + prices.high) / 2) : null;
  return null;
}

/** Walks a store's configured fallback chain (primary -> secondary -> last
 * call -> doomsday), each with its own percent modifier, returning the first
 * source that actually has a price. Falls back to the plain market price
 * (pre-Phase-2 behavior) when no config exists for the game, so stores that
 * never touch this feature see no change. */
function resolveStartingPriceCents(prices: PriceRow | undefined, config: SourceConfigRow | undefined): number | null {
  if (!prices) return null;
  if (!config) return prices.market;

  const chain: { source: PriceSource | null; modifier: number }[] = [
    { source: config.primary_source, modifier: config.primary_modifier_pct },
    { source: config.secondary_source, modifier: config.secondary_modifier_pct },
    { source: config.last_call_source, modifier: config.last_call_modifier_pct },
    { source: config.doomsday_source, modifier: config.doomsday_modifier_pct },
  ];

  for (const link of chain) {
    const value = sourceValue(prices, link.source);
    if (value != null) return Math.round(value * (1 + (link.modifier ?? 0) / 100));
  }
  return null;
}

/** Computes buy-side cash and store-credit offers for a cart of cards --
 * shared between the public portal (service-role client, no auth) and POS
 * buy mode (authenticated client), which is why this takes a generic
 * SupabaseClient rather than one of the app's specific client wrappers.
 * Rules are resolved most-specific-first (set overrides game overrides
 * global, each fully replacing rather than merging with the next tier
 * down); the price-source chain is resolved per-game. Cards with no
 * resolvable price get a $0 offer rather than being dropped, so the caller
 * can still show the customer why. */
export async function computeBuylistOffer(
  supabase: SupabaseClient,
  storeId: string,
  items: BuylistOfferLineInput[],
): Promise<BuylistOffer> {
  const cardIds = [...new Set(items.map((i) => i.cardId))];

  const cardInfoById = new Map<string, { gameId: string; setId: string | null; rarity: string | null }>();
  if (cardIds.length > 0) {
    const { data, error } = await supabase.from("cards").select("id, game_id, set_id, rarity").in("id", cardIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      cardInfoById.set(row.id as string, {
        gameId: row.game_id as string,
        setId: (row.set_id as string | null) ?? null,
        rarity: (row.rarity as string | null) ?? null,
      });
    }
  }

  const priceByCardId = new Map<string, PriceRow>();
  if (cardIds.length > 0) {
    const { data, error } = await supabase
      .from("card_market_prices")
      .select("card_id, market_price_cents, low_price_cents, high_price_cents")
      .in("card_id", cardIds);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      priceByCardId.set(row.card_id as string, {
        market: row.market_price_cents as number | null,
        low: row.low_price_cents as number | null,
        high: row.high_price_cents as number | null,
      });
    }
  }

  const { data: rulesData, error: rulesError } = await supabase
    .from("buylist_pricing_rules")
    .select("id, game_id, set_id, step_order, rule_type, config, enabled")
    .eq("store_id", storeId);
  if (rulesError) throw new Error(rulesError.message);

  const allRules: BuylistPricingRule[] = (rulesData ?? []).map((r) => ({
    id: r.id as string,
    gameId: (r.game_id as string | null) ?? null,
    setId: (r.set_id as string | null) ?? null,
    stepOrder: r.step_order as number,
    ruleType: r.rule_type as BuylistPricingRule["ruleType"],
    config: r.config as Record<string, unknown>,
    enabled: r.enabled as boolean,
  }));

  // Most specific wins, fully replacing (not merging with) the next tier
  // down: a rule set scoped to the card's exact set, else the card's game,
  // else the store's global rules.
  function rulesForCard(gameId: string, setId: string | null): BuylistPricingRule[] {
    if (setId) {
      const setSpecific = allRules.filter((r) => r.gameId === gameId && r.setId === setId);
      if (setSpecific.length > 0) return setSpecific;
    }
    const gameSpecific = allRules.filter((r) => r.gameId === gameId && r.setId === null);
    return gameSpecific.length > 0 ? gameSpecific : allRules.filter((r) => r.gameId === null);
  }

  const { data: sourceConfigData, error: sourceConfigError } = await supabase
    .from("buylist_price_source_config")
    .select(
      "game_id, primary_source, secondary_source, last_call_source, doomsday_source, primary_modifier_pct, secondary_modifier_pct, last_call_modifier_pct, doomsday_modifier_pct",
    )
    .eq("store_id", storeId);
  if (sourceConfigError) throw new Error(sourceConfigError.message);

  const sourceConfigs = (sourceConfigData ?? []) as unknown as SourceConfigRow[];
  function sourceConfigForGame(gameId: string): SourceConfigRow | undefined {
    return sourceConfigs.find((c) => c.game_id === gameId) ?? sourceConfigs.find((c) => c.game_id === null);
  }

  const lines: BuylistOfferLine[] = items.map((item) => {
    const cardInfo = cardInfoById.get(item.cardId);
    if (!cardInfo) {
      return { ...item, cashUnitPriceCents: 0, creditUnitPriceCents: 0, cashLineTotalCents: 0, creditLineTotalCents: 0 };
    }

    const startingPriceCents = resolveStartingPriceCents(priceByCardId.get(item.cardId), sourceConfigForGame(cardInfo.gameId));
    if (startingPriceCents === null) {
      return { ...item, cashUnitPriceCents: 0, creditUnitPriceCents: 0, cashLineTotalCents: 0, creditLineTotalCents: 0 };
    }

    const rules = rulesForCard(cardInfo.gameId, cardInfo.setId);
    const cashUnitPriceCents = computeBuylistPrice(startingPriceCents, item.condition, cardInfo.rarity, rules, "cash");
    const creditUnitPriceCents = computeBuylistPrice(startingPriceCents, item.condition, cardInfo.rarity, rules, "credit");

    return {
      ...item,
      cashUnitPriceCents,
      creditUnitPriceCents,
      cashLineTotalCents: cashUnitPriceCents * item.quantity,
      creditLineTotalCents: creditUnitPriceCents * item.quantity,
    };
  });

  return {
    lines,
    totalCashCents: lines.reduce((sum, l) => sum + l.cashLineTotalCents, 0),
    totalCreditCents: lines.reduce((sum, l) => sum + l.creditLineTotalCents, 0),
  };
}
