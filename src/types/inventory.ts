import { z } from "zod";

export const conditionSchema = z.enum(["NM", "LP", "MP", "HP", "DMG"]);

export const updateInventoryItemSchema = z.object({
  id: z.string().uuid(),
  quantity: z.number().int().min(0).max(999).optional(),
  condition: conditionSchema.optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  status: z.enum(["staged", "confirmed"]).optional(),
  // Optimistic-concurrency guard: the row's updated_at as of when the
  // caller loaded it. When provided, the write only applies if the row
  // hasn't changed since -- otherwise two staff editing the same item (one
  // stale) silently clobber each other instead of the second save failing
  // loudly. Optional so existing single-field callers that don't track it
  // keep working unchanged.
  expectedUpdatedAt: z.string().nullable().optional(),
});

export const idsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export const bulkEditSchema = z.object({
  edits: z.array(updateInventoryItemSchema).min(1).max(5000),
});

export type Condition = z.infer<typeof conditionSchema>;
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;
export type IdsInput = z.infer<typeof idsSchema>;
export type BulkEditInput = z.infer<typeof bulkEditSchema>;
