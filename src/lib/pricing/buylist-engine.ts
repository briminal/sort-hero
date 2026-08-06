import type { BuylistPricingRule, TieredPriceTier } from "@/types/buylist-pricing";

type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";
type Channel = "cash" | "credit";

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function matchingTier(tiers: TieredPriceTier[], priceCents: number, rarity: string | null): TieredPriceTier | undefined {
  return tiers.find(
    (tier) =>
      priceCents >= tier.minCents &&
      (tier.maxCents == null || priceCents <= tier.maxCents) &&
      (!tier.rarities || tier.rarities.length === 0 || (rarity != null && tier.rarities.includes(rarity))),
  );
}

/** Buy-side counterpart to computePrice in engine.ts -- same fold-over-rules
 * shape, but run once per channel (cash/credit) since tiered_price can send
 * the two channels down different paths. Pure and deterministic. */
export function computeBuylistPrice(
  marketPriceCents: number,
  condition: Condition,
  rarity: string | null,
  rules: BuylistPricingRule[],
  channel: Channel,
): number {
  let price = marketPriceCents;

  const ordered = [...rules].filter((r) => r.enabled).sort((a, b) => a.stepOrder - b.stepOrder);

  for (const rule of ordered) {
    switch (rule.ruleType) {
      case "condition_multiplier": {
        const percent = num(rule.config, condition, 100);
        price = price * (percent / 100);
        break;
      }
      case "margin_percent": {
        const percent = num(rule.config, "percent", 0);
        price = price * (1 + percent / 100);
        break;
      }
      case "margin_fixed": {
        price = price + num(rule.config, "cents", 0);
        break;
      }
      case "round_to_nearest": {
        const increment = num(rule.config, "cents", 1);
        price = Math.round(price / increment) * increment;
        break;
      }
      case "min_price": {
        price = Math.max(price, num(rule.config, "cents", 0));
        break;
      }
      case "max_price": {
        price = Math.min(price, num(rule.config, "cents", Infinity));
        break;
      }
      case "tiered_price": {
        const tiers = Array.isArray(rule.config.tiers) ? (rule.config.tiers as TieredPriceTier[]) : [];
        const tier = matchingTier(tiers, price, rarity);
        const value = tier ? (channel === "cash" ? tier.cashValue : tier.creditValue) : undefined;
        if (tier && value != null) {
          price = tier.type === "fixed" ? value : price * (value / 100);
        } else {
          const fallbackPercent =
            channel === "cash" ? num(rule.config, "fallbackCashPercent", 0) : num(rule.config, "fallbackCreditPercent", 0);
          price = price * (1 + fallbackPercent / 100);
        }
        break;
      }
    }
  }

  return Math.max(0, Math.round(price));
}
