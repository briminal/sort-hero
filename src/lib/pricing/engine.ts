import type { PricingRule } from "@/types/pricing";

type Condition = "NM" | "LP" | "MP" | "HP" | "DMG";

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Folds an ordered list of pricing rules over a market price, producing
 * the store's suggested inventory price. Pure and deterministic -- given
 * the same inputs, always the same output, so it's fully unit-testable
 * without a database. */
export function computePrice(
  marketPriceCents: number,
  condition: Condition,
  rules: PricingRule[],
): number {
  let price = marketPriceCents;

  const ordered = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.stepOrder - b.stepOrder);

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
    }
  }

  return Math.max(0, Math.round(price));
}

export const DEFAULT_RULES: Omit<PricingRule, "id">[] = [
  {
    stepOrder: 0,
    ruleType: "condition_multiplier",
    config: { NM: 100, LP: 85, MP: 70, HP: 50, DMG: 30 },
    enabled: true,
  },
  { stepOrder: 1, ruleType: "margin_percent", config: { percent: -10 }, enabled: true },
  { stepOrder: 2, ruleType: "round_to_nearest", config: { cents: 25 }, enabled: true },
  { stepOrder: 3, ruleType: "min_price", config: { cents: 25 }, enabled: true },
];

/** Buy-side default: shops offer well under market since they need margin
 * to resell -- a steeper negative margin than the sell-side default above,
 * same six-rule-type pipeline underneath. */
export const DEFAULT_BUYLIST_RULES: Omit<PricingRule, "id">[] = [
  {
    stepOrder: 0,
    ruleType: "condition_multiplier",
    config: { NM: 100, LP: 80, MP: 60, HP: 35, DMG: 15 },
    enabled: true,
  },
  { stepOrder: 1, ruleType: "margin_percent", config: { percent: -40 }, enabled: true },
  { stepOrder: 2, ruleType: "round_to_nearest", config: { cents: 25 }, enabled: true },
  { stepOrder: 3, ruleType: "min_price", config: { cents: 0 }, enabled: true },
];
