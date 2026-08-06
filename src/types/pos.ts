import { z } from "zod";

export const cartItemSchema = z.object({
  inventoryItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
  taxable: z.boolean().default(true),
  deductInventory: z.boolean().default(true),
});

export const customCartItemSchema = z.object({
  name: z.string().min(1).max(200),
  unitPriceCents: z.number().int().min(0),
  quantity: z.number().int().min(1).max(999),
  taxable: z.boolean().default(true),
});

export const createOrderSchema = z
  .object({
    tillId: z.string().uuid(),
    items: z.array(cartItemSchema).max(200).default([]),
    customItems: z.array(customCartItemSchema).max(200).default([]),
    discountCents: z.number().int().min(0).default(0),
    taxExempt: z.boolean().default(false),
  })
  .refine((v) => v.items.length + v.customItems.length > 0, { message: "Cart is empty" });

export const createPaymentIntentSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: z.number().int().min(1),
});

export const confirmCardPaymentSchema = z.object({
  orderId: z.string().uuid(),
  paymentIntentId: z.string().min(1),
});

export const completeCashPaymentSchema = z.object({
  orderId: z.string().uuid(),
  amountCents: z.number().int().min(1),
});

export const openTillSchema = z.object({
  name: z.string().min(1).max(80),
  openingCashCents: z.number().int().min(0),
});

export const closeTillSchema = z.object({
  tillId: z.string().uuid(),
  closingCashCents: z.number().int().min(0),
});

export const returnItemSchema = z.object({
  inventoryItemId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

export const processReturnSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(returnItemSchema).min(1).max(200),
  reason: z.string().max(500).nullable().optional(),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type CustomCartItem = z.infer<typeof customCartItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ProcessReturnInput = z.infer<typeof processReturnSchema>;
