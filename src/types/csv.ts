import { z } from "zod";
import { gameCodeSchema } from "./scanning";

export const mappedRowSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  quantity: z.number().int().min(0).optional(),
  condition: z.enum(["NM", "LP", "MP", "HP", "DMG"]).optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  cardId: z.string().uuid().nullable().optional(),
});

export const previewImportSchema = z.object({
  gameCode: gameCodeSchema,
  rows: z.array(mappedRowSchema).min(1).max(500),
});

export const commitImportSchema = z.object({
  gameCode: gameCodeSchema,
  rows: z.array(mappedRowSchema.extend({ cardId: z.string().uuid() })).min(1).max(500),
});

export type MappedRow = z.infer<typeof mappedRowSchema>;
export type PreviewImportInput = z.infer<typeof previewImportSchema>;
export type CommitImportInput = z.infer<typeof commitImportSchema>;
