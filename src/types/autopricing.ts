import { z } from "zod";

// Deliberately not shared with buylist-pricing.ts's priceSourceSchema --
// same four-value vocabulary, but kept independent so a change to one
// side's price-source concept never accidentally reaches the other.
export const autopricingSourceSchema = z.enum(["market", "low", "high", "mid"]);
export const priceSelectionRuleSchema = z.enum(["none", "lowest", "highest"]);
export const repriceDaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export const autopricingConfigSchema = z.object({
  id: z.string().uuid().optional(),
  gameId: z.string().uuid(),
  name: z.string().min(1).max(200),

  primarySource: autopricingSourceSchema.default("market"),
  secondarySource: autopricingSourceSchema.nullable().default(null),
  lastCallSource: autopricingSourceSchema.nullable().default(null),
  doomsdaySource: autopricingSourceSchema.nullable().default(null),

  priceSelectionRule: priceSelectionRuleSchema.default("none"),
  roundingIncrementCents: z.number().int().positive().nullable().default(null),

  primaryModifierPercent: z.number().min(-100).max(1000).default(0),
  secondaryModifierPercent: z.number().min(-100).max(1000).default(0),
  lastCallModifierPercent: z.number().min(-100).max(1000).default(0),
  doomsdayModifierPercent: z.number().min(-100).max(1000).default(0),

  nmModifierPercent: z.number().min(0).max(500).default(100),
  lpModifierPercent: z.number().min(0).max(500).default(99),
  mpModifierPercent: z.number().min(0).max(500).default(90),
  hpModifierPercent: z.number().min(0).max(500).default(80),
  dmgModifierPercent: z.number().min(0).max(500).default(70),

  repriceDayOfWeek: repriceDaySchema.nullable().default(null),
});

export const createAutopricingConfigSchema = z.object({
  gameId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const updateAutopricingConfigSchema = autopricingConfigSchema.extend({
  id: z.string().uuid(),
});

export const deleteAutopricingConfigSchema = z.object({
  id: z.string().uuid(),
});

export const previewAutopricingPriceSchema = z.object({
  configId: z.string().uuid(),
  cardId: z.string().uuid(),
  condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]),
  foil: z.boolean().default(false),
});

export const rarityBaselineSchema = z.object({
  rarity: z.string().min(1).max(100),
  normalBaselineCents: z.number().int().min(0).nullable(),
  foilBaselineCents: z.number().int().min(0).nullable(),
});

export const saveRarityBaselinesSchema = z.object({
  configId: z.string().uuid(),
  baselines: z.array(rarityBaselineSchema).max(200),
});

export type RarityBaseline = z.infer<typeof rarityBaselineSchema>;

const conditionModifierField = z.number().min(0).max(500).nullable();

export const saveSetModifierSchema = z.object({
  configId: z.string().uuid(),
  setId: z.string().uuid(),
  nmModifierPercent: conditionModifierField,
  lpModifierPercent: conditionModifierField,
  mpModifierPercent: conditionModifierField,
  hpModifierPercent: conditionModifierField,
  dmgModifierPercent: conditionModifierField,
});

export const deleteSetModifierSchema = z.object({
  id: z.string().uuid(),
});

export type SetModifier = {
  id: string;
  setId: string;
  setName: string;
  nmModifierPercent: number | null;
  lpModifierPercent: number | null;
  mpModifierPercent: number | null;
  hpModifierPercent: number | null;
  dmgModifierPercent: number | null;
};

export type AutopricingSource = z.infer<typeof autopricingSourceSchema>;
export type PriceSelectionRule = z.infer<typeof priceSelectionRuleSchema>;
export type RepriceDay = z.infer<typeof repriceDaySchema>;
export type AutopricingConfig = z.infer<typeof autopricingConfigSchema>;
export type CreateAutopricingConfigInput = z.infer<typeof createAutopricingConfigSchema>;
export type UpdateAutopricingConfigInput = z.infer<typeof updateAutopricingConfigSchema>;
