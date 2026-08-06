import type { AutopricingConfig, AutopricingSource } from "@/types/autopricing";

type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";
type PriceRow = { market: number | null; low: number | null; high: number | null };

export type PriceStep = { label: string; priceCents: number };

export type AutopricingResult = {
  finalPriceCents: number;
  steps: PriceStep[];
};

function sourceValue(prices: PriceRow, source: AutopricingSource | null): number | null {
  if (!source) return null;
  if (source === "market") return prices.market;
  if (source === "low") return prices.low;
  if (source === "high") return prices.high;
  if (source === "mid") return prices.low != null && prices.high != null ? Math.round((prices.low + prices.high) / 2) : null;
  return null;
}

const CONDITION_MODIFIER_KEY = {
  NM: "nmModifierPercent",
  LP: "lpModifierPercent",
  MP: "mpModifierPercent",
  HP: "hpModifierPercent",
  DMG: "dmgModifierPercent",
} as const satisfies Record<Condition, keyof AutopricingConfig>;

export type RarityBaselineInput = { normalBaselineCents: number | null; foilBaselineCents: number | null } | null;

function baselineCentsFor(rarityBaseline: RarityBaselineInput, foil: boolean): number | null {
  if (!rarityBaseline) return null;
  if (foil) return rarityBaseline.foilBaselineCents ?? rarityBaseline.normalBaselineCents;
  return rarityBaseline.normalBaselineCents;
}

// Each field independently nullable -- a set can override just NM and
// leave the rest to fall back to the config's global Condition Modifiers.
export type SetModifierInput = {
  nmModifierPercent: number | null;
  lpModifierPercent: number | null;
  mpModifierPercent: number | null;
  hpModifierPercent: number | null;
  dmgModifierPercent: number | null;
} | null;

/** Pure, deterministic sell-side pricing calculator matching SortSwift's own
 * step-by-step trace (used both by the "Run Autopricing" batch job and the
 * live Price Preview panel, so what staff preview is exactly what would be
 * applied). Returns null when no price can be resolved at all -- neither
 * the source chain/selection rule NOR a rarity baseline has anything to
 * price this item with -- same "don't silently price at $0" reasoning as
 * buylist's computeBuylistOffer.
 *
 * The rarity baseline (if the card's rarity has one configured) plays two
 * roles: it's the starting price when no market/low/high data exists at
 * all, and it's a floor the final price is never allowed to drop below
 * otherwise (a common bulk card computing to a fraction of a cent still
 * sells for at least its baseline). The set modifier (if the card's set has
 * one configured), when present for this specific condition, fully
 * replaces the config's global condition modifier for that condition. */
export function computeAutopricedPrice(
  prices: PriceRow,
  condition: Condition,
  config: AutopricingConfig,
  rarityBaseline: RarityBaselineInput = null,
  foil = false,
  setModifier: SetModifierInput = null,
): AutopricingResult | null {
  const steps: PriceStep[] = [];
  let price: number | null = null;
  const baselineCents = baselineCentsFor(rarityBaseline, foil);

  if (config.priceSelectionRule === "lowest" || config.priceSelectionRule === "highest") {
    // Bypasses the chain order entirely -- compares every source that
    // actually has a price and picks the min/max, ignoring which one is
    // configured as "primary".
    const candidates = [prices.market, prices.low, prices.high].filter((v): v is number => v != null);
    if (candidates.length > 0) {
      price = config.priceSelectionRule === "lowest" ? Math.min(...candidates) : Math.max(...candidates);
      steps.push({
        label: `Initial base price (${config.priceSelectionRule} of market/low/high)`,
        priceCents: price,
      });

      // No chain link resolved this price (selection bypasses the chain
      // entirely), so the Primary Price Modifier is the only configured
      // modifier that still makes sense to apply here.
      price = Math.round(price * (1 + config.primaryModifierPercent / 100));
      steps.push({ label: `After primary price modifier (${config.primaryModifierPercent}%)`, priceCents: price });
    }
  } else {
    // "None" -- walk the chain in order; the modifier that applies is
    // whichever link actually resolved the price, same as buylist's
    // resolveStartingPriceCents.
    const chain: { label: string; source: AutopricingSource | null; modifierPercent: number }[] = [
      { label: "primary", source: config.primarySource, modifierPercent: config.primaryModifierPercent },
      { label: "fallback", source: config.secondarySource, modifierPercent: config.secondaryModifierPercent },
      { label: "last call", source: config.lastCallSource, modifierPercent: config.lastCallModifierPercent },
      { label: "doomsday", source: config.doomsdaySource, modifierPercent: config.doomsdayModifierPercent },
    ];

    for (const link of chain) {
      const value = sourceValue(prices, link.source);
      if (value == null) continue;

      price = value;
      steps.push({ label: `Initial base price (${link.source})`, priceCents: price });

      price = Math.round(price * (1 + link.modifierPercent / 100));
      steps.push({ label: `After ${link.label} price modifier (${link.modifierPercent}%)`, priceCents: price });
      break;
    }
  }

  // No market/low/high data resolved anything -- the rarity baseline
  // becomes the starting price instead of giving up entirely.
  if (price == null && baselineCents != null) {
    price = baselineCents;
    steps.push({ label: `Initial base price (rarity baseline, no market data)`, priceCents: price });
  }

  if (price == null) return null;

  const setOverride = setModifier?.[CONDITION_MODIFIER_KEY[condition]] ?? null;
  const conditionModifierPercent = setOverride ?? config[CONDITION_MODIFIER_KEY[condition]];
  price = Math.round(price * (conditionModifierPercent / 100));
  steps.push({
    label: `After condition modifier (${condition} - ${conditionModifierPercent}%${setOverride != null ? ", set override" : ""})`,
    priceCents: price,
  });

  if (config.roundingIncrementCents) {
    price = Math.round(price / config.roundingIncrementCents) * config.roundingIncrementCents;
    steps.push({
      label: `After rounding to nearest $${(config.roundingIncrementCents / 100).toFixed(2)}`,
      priceCents: price,
    });
  }

  price = Math.max(0, price);

  if (baselineCents != null && price < baselineCents) {
    price = baselineCents;
    steps.push({ label: `After rarity baseline floor ($${(baselineCents / 100).toFixed(2)})`, priceCents: price });
  }

  return { finalPriceCents: price, steps };
}
