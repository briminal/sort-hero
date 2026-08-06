import { z } from "zod";

export const kioskPinSchema = z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits");

export const verifyKioskPinSchema = z.object({
  storeSlug: z.string().min(1),
  pin: kioskPinSchema,
});

export const setKioskPinSchema = z.object({
  pin: kioskPinSchema,
});

export const kioskSortSchema = z.enum(["name_asc", "price_asc", "price_desc"]);

export const browseKioskInventorySchema = z.object({
  storeSlug: z.string().min(1),
  gameCode: z.string().min(1).optional(),
  query: z.string().max(200).optional(),
  setId: z.string().uuid().optional(),
  rarity: z.string().max(100).optional(),
  sort: kioskSortSchema.default("name_asc"),
  limit: z.number().int().min(1).max(48).default(24),
  offset: z.number().int().min(0).default(0),
});

export const kioskAvailableFiltersSchema = z.object({
  storeSlug: z.string().min(1),
  gameCode: z.string().min(1).optional(),
});

export const kioskReservationItemSchema = z.object({
  inventoryItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
});

export const submitKioskReservationSchema = z.object({
  storeSlug: z.string().min(1),
  customerNameOrPhone: z.string().min(1).max(200),
  items: z.array(kioskReservationItemSchema).min(1).max(100),
});

export const completeKioskReservationSchema = z.object({
  reservationId: z.string().uuid(),
});

export type VerifyKioskPinInput = z.infer<typeof verifyKioskPinSchema>;
export type BrowseKioskInventoryInput = z.infer<typeof browseKioskInventorySchema>;
export type SubmitKioskReservationInput = z.infer<typeof submitKioskReservationSchema>;
