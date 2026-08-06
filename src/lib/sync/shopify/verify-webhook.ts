import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies Shopify's X-Shopify-Hmac-Sha256 header against the shop's
 * webhook secret. Must run against the raw request body, before any JSON
 * parsing -- Shopify signs the exact bytes sent. */
export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null, webhookSecret: string): boolean {
  if (!hmacHeader) return false;

  const computed = createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("base64");

  const a = Buffer.from(computed);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
