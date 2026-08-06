import { z } from "zod";

export const platformSchema = z.enum(["shopify", "tcgplayer"]);

export const connectShopifySchema = z.object({
  shopDomain: z
    .string()
    .regex(/^[a-z0-9-]+\.myshopify\.com$/, "Must be a *.myshopify.com domain"),
  accessToken: z.string().min(1),
  webhookSecret: z.string().min(1),
});

export const connectTcgplayerSchema = z.object({
  storeKey: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

export const disconnectMarketplaceSchema = z.object({
  connectionId: z.string().uuid(),
});

export const updateConnectionSettingsSchema = z.object({
  connectionId: z.string().uuid(),
  autoSyncEnabled: z.boolean(),
});

export const triggerSyncNowSchema = z.object({
  connectionId: z.string().uuid(),
  jobType: z.enum(["push_listings", "pull_orders"]),
});

export type Platform = z.infer<typeof platformSchema>;
export type ConnectShopifyInput = z.infer<typeof connectShopifySchema>;
export type ConnectTcgplayerInput = z.infer<typeof connectTcgplayerSchema>;
