import { z } from "zod";

// Not a fixed enum -- `games.code` is a DB-driven, extensible list (see
// src/lib/games.ts). Actual validity is enforced wherever a game code is
// used to look up a game row (a nonexistent code just resolves to zero
// results, not a security issue -- these values are always passed as
// query parameters, never interpolated into raw SQL).
export const gameCodeSchema = z.string().min(1).max(50);

export const searchCardsSchema = z.object({
  gameCode: gameCodeSchema,
  query: z.string().min(2).max(200),
});

export const confirmScanSchema = z.object({
  cardId: z.string().uuid(),
  imageKey: z.string().min(1).nullable(),
  quantity: z.number().int().min(1).max(999).default(1),
});

export const conditionSchema = z.enum(["NM", "LP", "MP", "HP", "DMG"]);
export const printingSchema = z.enum(["normal", "foil"]);

export const bulkScanItemSchema = z.object({
  cardId: z.string().uuid(),
  imageKey: z.string().min(1).nullable(),
  quantity: z.number().int().min(1).max(999).default(1),
  condition: conditionSchema.default("NM"),
  printing: printingSchema.default("normal"),
  language: z.string().min(1).max(10).default("EN"),
  notes: z.string().max(500).nullable().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
});

export const confirmBulkScanSchema = z.object({
  items: z.array(bulkScanItemSchema).min(1).max(200),
});

export const getSetsForGameSchema = z.object({
  gameCode: gameCodeSchema,
});

export const listCardAlternatesSchema = z.object({
  gameCode: gameCodeSchema,
  name: z.string().min(1).max(300),
});

export const marketPricesForCardsSchema = z.object({
  cardIds: z.array(z.string().uuid()).min(1).max(200),
});

export const updateHighValueThresholdSchema = z.object({
  thresholdCents: z.number().int().min(0).max(100_000_00),
});

export type GameCode = z.infer<typeof gameCodeSchema>;
export type SearchCardsInput = z.infer<typeof searchCardsSchema>;
export type ConfirmScanInput = z.infer<typeof confirmScanSchema>;
export type BulkScanItem = z.infer<typeof bulkScanItemSchema>;
export type ConfirmBulkScanInput = z.infer<typeof confirmBulkScanSchema>;
