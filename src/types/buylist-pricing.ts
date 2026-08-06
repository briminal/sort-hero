import { z } from "zod";

// Deliberately parallel to, but NOT sharing, src/types/pricing.ts. Buylist's
// tiered_price rule type is buy-side only (cash vs. store-credit tiers with
// an optional rarity filter) -- keeping it here means it can never surface
// in Autopricing's rule editor, whose RULE_LABELS map is exhaustive over the
// shared RuleType union.
export const buylistRuleTypeSchema = z.enum([
  "condition_multiplier",
  "margin_percent",
  "margin_fixed",
  "round_to_nearest",
  "min_price",
  "max_price",
  "tiered_price",
]);

export const conditionMultiplierConfigSchema = z.object({
  NM: z.number().min(0).max(500).default(100),
  LP: z.number().min(0).max(500).default(80),
  MP: z.number().min(0).max(500).default(60),
  HP: z.number().min(0).max(500).default(35),
  DMG: z.number().min(0).max(500).default(15),
});

export const marginPercentConfigSchema = z.object({ percent: z.number().min(-100).max(1000) });
export const marginFixedConfigSchema = z.object({ cents: z.number().int() });
export const roundToNearestConfigSchema = z.object({ cents: z.number().int().min(1).max(10000) });
export const minPriceConfigSchema = z.object({ cents: z.number().int().min(0) });
export const maxPriceConfigSchema = z.object({ cents: z.number().int().min(0) });

// A single tier definition covers both SortSwift's plain price-range tiers
// and its rarity-scoped bulk rules: `rarities` empty/absent means "any
// rarity in this price range", populated means "only these rarities".
export const tieredPriceTierSchema = z.object({
  minCents: z.number().int().min(0),
  maxCents: z.number().int().min(0).nullable(),
  type: z.enum(["fixed", "percent"]),
  cashValue: z.number(),
  creditValue: z.number(),
  rarities: z.array(z.string()).optional(),
});

export const tieredPriceConfigSchema = z.object({
  tiers: z.array(tieredPriceTierSchema).max(20),
  // Applied when no tier matches, so a card outside every configured range
  // still gets a price instead of falling through to $0.
  fallbackCashPercent: z.number().min(-100).max(1000).default(0),
  fallbackCreditPercent: z.number().min(-100).max(1000).default(0),
});

const CONFIG_SCHEMA_BY_RULE_TYPE = {
  condition_multiplier: conditionMultiplierConfigSchema,
  margin_percent: marginPercentConfigSchema,
  margin_fixed: marginFixedConfigSchema,
  round_to_nearest: roundToNearestConfigSchema,
  min_price: minPriceConfigSchema,
  max_price: maxPriceConfigSchema,
  tiered_price: tieredPriceConfigSchema,
} satisfies Record<z.infer<typeof buylistRuleTypeSchema>, z.ZodTypeAny>;

export const buylistPricingRuleSchema = z
  .object({
    id: z.string().optional(),
    // Null/absent = applies to every game. A rule set with any game-specific
    // rows for a given game fully replaces the global rules for that game
    // (see rulesForCard in buylist-offer.ts) rather than merging with them.
    gameId: z.string().uuid().nullable().optional(),
    // Null/absent = applies to every set within the scoped game. Requires
    // gameId to be set (a set-only override with no game makes no sense --
    // sets belong to exactly one game). Most specific: a rule set scoped to
    // the card's exact set fully replaces both the game and global rules.
    setId: z.string().uuid().nullable().optional(),
    stepOrder: z.number().int().min(0),
    ruleType: buylistRuleTypeSchema,
    config: z.record(z.string(), z.unknown()),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    const result = CONFIG_SCHEMA_BY_RULE_TYPE[rule.ruleType].safeParse(rule.config);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid config for rule type "${rule.ruleType}": ${result.error.issues[0]?.message ?? "invalid"}`,
        path: ["config"],
      });
    }
    if (rule.setId && !rule.gameId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A set-scoped rule requires a game",
        path: ["setId"],
      });
    }
  });

export const saveBuylistPricingRulesSchema = z.object({
  gameId: z.string().uuid().nullable(),
  setId: z.string().uuid().nullable(),
  rules: z.array(buylistPricingRuleSchema).max(50),
});

export const priceSourceSchema = z.enum(["market", "low", "high", "mid"]);

export const priceSourceConfigSchema = z.object({
  gameId: z.string().uuid().nullable(),
  primarySource: priceSourceSchema.default("market"),
  secondarySource: priceSourceSchema.nullable().default(null),
  lastCallSource: priceSourceSchema.nullable().default(null),
  doomsdaySource: priceSourceSchema.nullable().default(null),
  primaryModifierPercent: z.number().min(-100).max(1000).default(0),
  secondaryModifierPercent: z.number().min(-100).max(1000).default(0),
  lastCallModifierPercent: z.number().min(-100).max(1000).default(0),
  doomsdayModifierPercent: z.number().min(-100).max(1000).default(0),
});

export const saveBuylistPriceSourceConfigSchema = priceSourceConfigSchema;

export type BuylistRuleType = z.infer<typeof buylistRuleTypeSchema>;
export type BuylistPricingRule = z.infer<typeof buylistPricingRuleSchema>;
export type TieredPriceTier = z.infer<typeof tieredPriceTierSchema>;
export type PriceSource = z.infer<typeof priceSourceSchema>;
export type PriceSourceConfig = z.infer<typeof priceSourceConfigSchema>;

export const DEFAULT_BUYLIST_PRICING_RULES: Omit<BuylistPricingRule, "id">[] = [
  {
    gameId: null,
    stepOrder: 0,
    ruleType: "condition_multiplier",
    config: { NM: 100, LP: 80, MP: 60, HP: 35, DMG: 15 },
    enabled: true,
  },
  { gameId: null, stepOrder: 1, ruleType: "margin_percent", config: { percent: -40 }, enabled: true },
  { gameId: null, stepOrder: 2, ruleType: "round_to_nearest", config: { cents: 25 }, enabled: true },
  { gameId: null, stepOrder: 3, ruleType: "min_price", config: { cents: 0 }, enabled: true },
];
