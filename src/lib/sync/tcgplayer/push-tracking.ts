import type { TcgplayerClient } from "./client";
import type { TrackingPushResult } from "../shopify/push-tracking";

/** Pushes a tracking number back to TCGplayer once a label is purchased.
 * Same caveat as tcgplayer/poll-orders.ts: I don't have confident knowledge
 * of TCGplayer's Seller API order-fulfillment contract (no real API access
 * this project), so this assumes a plausible order-update endpoint rather
 * than a confirmed one. Flagged explicitly for re-verification once real
 * TCGplayer API docs/access exist, not silently treated as correct. */
export async function pushTcgplayerTracking(
  client: TcgplayerClient,
  storeKey: string,
  externalOrderId: string,
  trackingNumber: string,
  carrierName: string,
): Promise<TrackingPushResult> {
  try {
    await client.request(`/order/${storeKey}/orders/${externalOrderId}/tracking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingNumber, carrier: carrierName }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not push tracking to TCGplayer" };
  }
}
