import { z } from "zod";

export const ruleTypeSchema = z.enum([
  "condition_multiplier",
  "margin_percent",
  "margin_fixed",
  "round_to_nearest",
  "min_price",
  "max_price",
]);

export const conditionMultiplierConfigSchema = z.object({
  NM: z.number().min(0).max(500).default(100),
  LP: z.number().min(0).max(500).default(85),
  MP: z.number().min(0).max(500).default(70),
  HP: z.number().min(0).max(500).default(50),
  DMG: z.number().min(0).max(500).default(30),
});

export const marginPercentConfigSchema = z.object({ percent: z.number().min(-100).max(1000) });
export const marginFixedConfigSchema = z.object({ cents: z.number().int() });
export const roundToNearestConfigSchema = z.object({ cents: z.number().int().min(1).max(10000) });
export const minPriceConfigSchema = z.object({ cents: z.number().int().min(0) });
export const maxPriceConfigSchema = z.object({ cents: z.number().int().min(0) });

const CONFIG_SCHEMA_BY_RULE_TYPE = {
  condition_multiplier: conditionMultiplierConfigSchema,
  margin_percent: marginPercentConfigSchema,
  margin_fixed: marginFixedConfigSchema,
  round_to_nearest: roundToNearestConfigSchema,
  min_price: minPriceConfigSchema,
  max_price: maxPriceConfigSchema,
} satisfies Record<z.infer<typeof ruleTypeSchema>, z.ZodTypeAny>;

export const pricingRuleSchema = z
  .object({
    // Not a real uuid constraint -- `id` here is purely a client-side dnd-kit
    // tracking key (including for not-yet-saved default/placeholder rules
    // like "default-0"), never read by saveRules on the server, which always
    // replaces rows wholesale regardless of what the client sent as `id`.
    id: z.string().optional(),
    stepOrder: z.number().int().min(0),
    ruleType: ruleTypeSchema,
    config: z.record(z.string(), z.unknown()),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    // config was previously accepted as-is regardless of ruleType --
    // this actually enforces the per-type schemas defined above instead of
    // leaving them unused.
    const result = CONFIG_SCHEMA_BY_RULE_TYPE[rule.ruleType].safeParse(rule.config);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid config for rule type "${rule.ruleType}": ${result.error.issues[0]?.message ?? "invalid"}`,
        path: ["config"],
      });
    }
  });

export const saveRulesSchema = z.object({
  rules: z.array(pricingRuleSchema).max(50),
});

export type RuleType = z.infer<typeof ruleTypeSchema>;
export type PricingRule = z.infer<typeof pricingRuleSchema>;
export type SaveRulesInput = z.infer<typeof saveRulesSchema>;
