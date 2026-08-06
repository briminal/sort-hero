import { z } from "zod";

export const updateStoreTaxSettingsSchema = z.object({
  taxRatePercent: z.number().min(0).max(100),
  roundToNearestCents: z.number().int().positive().nullable(),
});

export type UpdateStoreTaxSettingsInput = z.infer<typeof updateStoreTaxSettingsSchema>;
