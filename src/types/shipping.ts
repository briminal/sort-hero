import { z } from "zod";

export const addressSchema = z.object({
  name: z.string().min(1),
  street1: z.string().min(1),
  street2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().min(2).max(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const connectShippoSchema = z.object({
  apiKey: z.string().min(1),
  fromAddress: addressSchema,
});

export const updateFromAddressSchema = z.object({
  connectionId: z.string().uuid(),
  fromAddress: addressSchema,
});

export const disconnectShippingSchema = z.object({
  connectionId: z.string().uuid(),
});

export const getShippingRatesSchema = z.object({
  marketplaceOrderId: z.string().uuid(),
});

export const purchaseLabelSchema = z.object({
  marketplaceOrderId: z.string().uuid(),
  shipmentId: z.string().min(1),
  rateObjectId: z.string().min(1),
});

export const getWebhookUrlSchema = z.object({
  connectionId: z.string().uuid(),
});

export type Address = z.infer<typeof addressSchema>;
export type ConnectShippoInput = z.infer<typeof connectShippoSchema>;
